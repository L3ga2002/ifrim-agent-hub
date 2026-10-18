// M09 media library paths. Every media file lives under config.mediaDir (the library root) or config.mediaWorkDir (render and
// transcription scratch); the database stores paths RELATIVE to the library root. Physical names are content-addressed
// (originals/<sha[0..2]>/<sha>.<ext>) or id-based (renders/<jobId>.<ext>), never derived from an imported file name, so a name
// like "-i http:…" or "../../x" can never reach an argv or escape the root. Symlinks and junctions inside the root are refused:
// a link could make the Hub read or serve a file outside the library.
import fs from "node:fs";
import path from "node:path";
import { HubError } from "../core/errors.mjs";

export const MEDIA_FOLDERS = Object.freeze(["originals", "derivatives", "renders", "cache", "exports", "packs", "transcripts", "thumbnails", "capture"]);

const SHA256 = /^[0-9a-f]{64}$/;
const EXT = /^[a-z0-9]{1,8}$/;
const SAFE_SEGMENT = /^[A-Za-z0-9_-]{1,128}$/;
const KIND = /^[a-z0-9_-]{1,32}$/;

const lower = (p) => (process.platform === "win32" ? p.toLowerCase() : p);
const strip = (p) => path.resolve(p).replace(/[\\/]+$/, "") || path.resolve(p);

/** Pure prefix containment (case-insensitive on Windows). */
export function isInsideDir(root, candidate) {
  const r = lower(strip(root));
  const c = lower(strip(candidate));
  return c === r || c.startsWith(r.endsWith(path.sep) ? r : `${r}${path.sep}`);
}

/** True for a folder synchronised by a cloud client (OneDrive, Dropbox, Google Drive, iCloud): media there is uploaded behind the Hub's back. */
export function isSyncedPath(p, env = process.env) {
  const norm = lower(path.resolve(String(p || "")));
  const roots = [env.OneDrive, env.OneDriveConsumer, env.OneDriveCommercial].filter(Boolean).map((r) => lower(path.resolve(r)));
  if (roots.some((r) => norm === r || norm.startsWith(`${r}${path.sep}`))) return true;
  return /[\\/](onedrive[^\\/]*|dropbox|google drive|icloud ?drive|iclouddrive)([\\/]|$)/i.test(norm);
}

/** Nearest existing ancestor of `p` (itself included); used for statfs and for realpath of a file not yet written. */
function nearestExisting(p) {
  let current = path.resolve(p);
  for (;;) {
    if (fs.existsSync(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) return current;
    current = parent;
  }
}

/** Free bytes for unprivileged writers on the volume holding `p` (null when the platform refuses statfs). */
export function freeBytesAt(p) {
  try {
    const s = fs.statfsSync(nearestExisting(p));
    return Number(s.bavail) * Number(s.bsize);
  } catch { return null; }
}

/**
 * Refuses a symlink or junction anywhere between `root` (exclusive) and `abs` (inclusive), for the components that exist.
 * On Windows `lstat().isSymbolicLink()` is true for junctions and symlinks alike.
 */
function assertNoLinksBetween(root, abs) {
  const rel = path.relative(root, abs);
  if (!rel) return;
  let current = root;
  for (const part of rel.split(path.sep)) {
    current = path.join(current, part);
    let st;
    try { st = fs.lstatSync(current); } catch (error) { if (error.code === "ENOENT") return; throw error; }
    if (st.isSymbolicLink()) throw new HubError("policy", "Biblioteca media refuză legăturile simbolice și joncțiunile (un fișier din afara bibliotecii nu poate fi citit sau servit prin ele).", { code: "MEDIA_LINK_REFUSED" });
  }
}

/**
 * Checks that `abs` is a regular file reached without any link: lstat says file (not symlink), and the real path equals the
 * lexical path (a junction on a parent folder changes the real path). Returns `{ real, size, mtimeMs, nlink }`.
 */
export function assertRegularFile(abs) {
  if (typeof abs !== "string" || !abs || abs.includes("\0")) throw new HubError("validation", "Cale de fișier invalidă.", { code: "MEDIA_PATH_INVALID" });
  const lexical = path.resolve(abs);
  let st;
  try { st = fs.lstatSync(lexical); }
  catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") throw new HubError("not_found", "Fișierul media nu există.", { code: "MEDIA_FILE_MISSING" });
    throw new HubError("validation", `Fișierul media nu poate fi citit (${error.code || "eroare"}).`, { code: "MEDIA_FILE_UNREADABLE" });
  }
  if (st.isSymbolicLink()) throw new HubError("policy", "Fișierul este o legătură simbolică; importă fișierul original, nu o scurtătură spre el.", { code: "MEDIA_LINK_REFUSED" });
  if (!st.isFile()) throw new HubError("validation", "Calea nu indică un fișier obișnuit (dosar, dispozitiv sau alt tip).", { code: "MEDIA_NOT_A_FILE" });
  const real = fs.realpathSync.native(lexical);
  if (lower(real) !== lower(lexical)) throw new HubError("policy", "Calea trece printr-o legătură simbolică sau o joncțiune; folosește calea reală a fișierului.", { code: "MEDIA_LINK_REFUSED" });
  return { real, size: st.size, mtimeMs: st.mtimeMs, nlink: st.nlink };
}

/**
 * `createMediaPaths({ config })` → helpers bound to the library root (config.mediaDir) and the scratch root (config.mediaWorkDir).
 * Every resolver refuses absolute paths, traversal, NUL bytes, links inside the roots and anything that resolves outside them.
 */
export function createMediaPaths({ config }) {
  if (!config?.mediaDir || !config?.mediaWorkDir) throw new Error("createMediaPaths requires config.mediaDir and config.mediaWorkDir");
  const root = path.resolve(config.mediaDir);
  const work = path.resolve(config.mediaWorkDir);
  let ensured = false;

  function ensure() {
    fs.mkdirSync(root, { recursive: true });
    for (const folder of MEDIA_FOLDERS) fs.mkdirSync(path.join(root, folder), { recursive: true });
    fs.mkdirSync(path.join(work, "jobs"), { recursive: true });
    fs.mkdirSync(path.join(root, ".incoming"), { recursive: true });
    for (const folder of [...MEDIA_FOLDERS, ".incoming"]) assertNoLinksBetween(root, path.join(root, folder));
    assertNoLinksBetween(work, path.join(work, "jobs"));
    ensured = true;
    return { root, work };
  }
  const ensureOnce = () => { if (!ensured) ensure(); };

  /** Real path of the library root (the root itself may sit behind a junction chosen by the operator; links BELOW it are refused). */
  const rootReal = () => { ensureOnce(); return fs.realpathSync.native(root); };

  /** Containment check for a path under `base`, lexical and real (nearest existing ancestor), with no link in between. */
  function assertUnder(base, abs) {
    const lexical = path.resolve(abs);
    if (!isInsideDir(base, lexical)) throw new HubError("policy", "Calea iese din biblioteca media.", { code: "MEDIA_PATH_OUTSIDE" });
    assertNoLinksBetween(base, lexical);
    const existing = nearestExisting(lexical);
    const real = fs.realpathSync.native(existing);
    if (!isInsideDir(fs.realpathSync.native(nearestExisting(base)), real)) throw new HubError("policy", "Calea iese din biblioteca media printr-o legătură.", { code: "MEDIA_PATH_OUTSIDE" });
    return lexical;
  }

  /** Resolves a library-relative path ("originals/ab/ab….mp4") to an absolute path under the root. */
  function resolveRel(rel, { allowMissing = true } = {}) {
    if (typeof rel !== "string" || !rel.trim() || rel.includes("\0")) throw new HubError("validation", "Cale relativă media invalidă.", { code: "MEDIA_PATH_INVALID" });
    if (path.isAbsolute(rel) || /^[a-z]:/i.test(rel) || /^[\\/]/.test(rel)) throw new HubError("policy", "Biblioteca media acceptă doar căi relative la rădăcina ei.", { code: "MEDIA_PATH_ABSOLUTE" });
    const parts = rel.split(/[\\/]+/).filter(Boolean);
    if (!parts.length || parts.some((p) => p === ".." || p === "." || /[<>:"|?*]/.test(p))) throw new HubError("policy", "Calea relativă media conține segmente nepermise („..”, „.” sau caractere rezervate).", { code: "MEDIA_PATH_TRAVERSAL" });
    ensureOnce();
    const abs = assertUnder(root, path.join(root, ...parts));
    if (!allowMissing && !fs.existsSync(abs)) throw new HubError("not_found", "Fișierul media lipsește din bibliotecă.", { code: "MEDIA_FILE_MISSING" });
    return abs;
  }

  /** Library-relative path ("/"-separated) of an absolute path under the root; refuses anything outside it. */
  function relOf(abs) {
    if (typeof abs !== "string" || !abs || abs.includes("\0")) throw new HubError("validation", "Cale media invalidă.", { code: "MEDIA_PATH_INVALID" });
    ensureOnce();
    const lexical = assertUnder(root, abs);
    const rel = path.relative(root, lexical);
    if (!rel) throw new HubError("policy", "Rădăcina bibliotecii nu este un fișier media.", { code: "MEDIA_PATH_INVALID" });
    return rel.split(path.sep).join("/");
  }

  function checkExt(ext) {
    const e = String(ext || "").replace(/^\./, "").toLowerCase();
    if (!EXT.test(e)) throw new HubError("validation", "Extensie media invalidă.", { code: "MEDIA_EXT_INVALID" });
    return e;
  }
  function checkSegment(value, label) {
    if (typeof value !== "string" || !SAFE_SEGMENT.test(value)) throw new HubError("validation", `Identificator invalid pentru ${label}.`, { code: "MEDIA_ID_INVALID" });
    return value;
  }

  /** Content-addressed path of an original: originals/<sha[0..2]>/<sha>.<ext>. */
  function originalPath(sha256, ext) {
    if (typeof sha256 !== "string" || !SHA256.test(sha256)) throw new HubError("validation", "Amprenta SHA-256 este invalidă.", { code: "MEDIA_SHA_INVALID" });
    return path.join(root, "originals", sha256.slice(0, 2), `${sha256}.${checkExt(ext)}`);
  }
  /** derivatives/<kind>/<key>.<ext> (key = a hash or an id; never a user file name). */
  function derivativePath(kind, key, ext) {
    if (typeof kind !== "string" || !KIND.test(kind)) throw new HubError("validation", "Tip de derivat invalid.", { code: "MEDIA_ID_INVALID" });
    return path.join(root, "derivatives", kind, `${checkSegment(key, "derivat")}.${checkExt(ext)}`);
  }
  const renderPath = (jobId, ext) => path.join(root, "renders", `${checkSegment(jobId, "randare")}.${checkExt(ext)}`);
  const cacheDir = () => path.join(root, "cache");
  const packDir = (id) => path.join(root, "packs", checkSegment(id, "pachet"));
  const jobDir = (jobId) => path.join(work, "jobs", checkSegment(jobId, "job"));
  const exportsDir = () => path.join(root, "exports");
  const folder = (name) => {
    if (!MEDIA_FOLDERS.includes(name)) throw new HubError("validation", `Dosar media necunoscut: ${name}.`, { code: "MEDIA_FOLDER_UNKNOWN" });
    return path.join(root, name);
  };
  /** True when `abs` is inside the scratch root (render/transcription job folders). */
  const isWorkPath = (abs) => isInsideDir(work, abs);
  const isLibraryPath = (abs) => isInsideDir(root, abs);

  /** `{ root, synced, freeBytes }`: a library in a synchronised folder is a production warning (media uploaded by the sync client). */
  const status = () => ({ root, work, synced: isSyncedPath(root), freeBytes: freeBytesAt(root) });

  return { root, work, ensure, rootReal, resolveRel, relOf, originalPath, derivativePath, renderPath, cacheDir, packDir, jobDir, exportsDir,
    folder, isWorkPath, isLibraryPath, assertUnder, assertRegularFile, status };
}
