// M09 media library: import, derivatives, search, quota and derivative cleanup. Metadata lives in SQLite; the files live under
// config.mediaDir with content-addressed names (originals/<sha[0..2]>/<sha>.<ext>). Originals are immutable: no API updates
// their path or hash, the file is written once and marked read-only, and every edit produces a derivative that names its
// inputs (derived_from_json) so rights and provenance follow it.
// Import only reads a regular file whose REAL path is inside one of the allowed roots and that is reached without a symlink or
// junction below that root; the type comes from the file's magic bytes (never its name or extension), and a file ffprobe
// cannot decode is kept QUARANTINED (stored, never rendered or served as media).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pipeline } from "node:stream/promises";
import { HubError } from "../core/errors.mjs";
import { newId } from "../core/ids.mjs";
import { json, parse } from "../storage/db.mjs";
import { isProtectedRelative, isSecretLikeName } from "../security/paths.mjs";
import { isInsideDir, freeBytesAt } from "./paths.mjs";

export const ASSET_KINDS = Object.freeze(["video", "audio", "image", "caption", "font", "document", "other"]);
export const ASSET_CATEGORIES = Object.freeze(["raw", "screen_recording", "b_roll", "music", "sfx", "voice", "generated", "brand", "proxy", "render", "export", "thumbnail", "caption", "font"]);
/** Categories an imported ORIGINAL may have (proxies, renders and exports are always derivatives). */
export const ORIGINAL_CATEGORIES = Object.freeze(ASSET_CATEGORIES.filter((c) => !["proxy", "render", "export"].includes(c)));
export const ASSET_ORIGINS = Object.freeze(["OWNED", "LICENSED", "CLIENT_PROVIDED", "AI_GENERATED", "UNKNOWN"]);
export const CAPTURE_LABELS = Object.freeze(["ORIGINAL_RECORDING", "REPLAY", "RECONSTRUCTION", "SIMULATION", "GENERATED", "NOT_APPLICABLE"]);
/** Derivative categories the cleanup may remove (regenerable caches); never originals, renders or exports. */
export const CLEANABLE_CATEGORIES = Object.freeze(["proxy", "thumbnail"]);
export const DEFAULT_MAX_BYTES = 4 * 1024 ** 3;
const GIB = 1024 ** 3;
const PROBED_KINDS = new Set(["video", "audio", "image"]);
// A derivative's origin column: the most restrictive of its inputs (rights evaluation still walks every input).
const ORIGIN_RANK = ["UNKNOWN", "CLIENT_PROVIDED", "LICENSED", "AI_GENERATED", "OWNED"];
// A derivative's capture label: the most "artificial" input label wins, so a SIMULATION never becomes an ORIGINAL_RECORDING.
const LABEL_RANK = ["GENERATED", "SIMULATION", "RECONSTRUCTION", "REPLAY", "ORIGINAL_RECORDING", "NOT_APPLICABLE"];

const MIME = { mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", mkv: "video/x-matroska", avi: "video/x-msvideo", ts: "video/mp2t",
  wav: "audio/wav", mp3: "audio/mpeg", flac: "audio/flac", ogg: "audio/ogg", m4a: "audio/mp4", aac: "audio/aac",
  png: "image/png", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif", heic: "image/heic",
  srt: "application/x-subrip", vtt: "text/vtt", ttf: "font/ttf", otf: "font/otf", woff: "font/woff", woff2: "font/woff2" };

const fold = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Identifies a file from its first bytes. Returns `{ kind, ext, mime }`, `{ refused: code, message }` for types the library never
 * accepts (executables, archives, scripts, documents), or null when unknown.
 */
export function sniffMagic(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 4) return null;
  const ascii = (s, e) => buf.subarray(s, Math.min(e, buf.length)).toString("latin1");
  const at = (i, ...bytes) => bytes.every((b, k) => buf[i + k] === b);
  const out = (kind, ext) => ({ kind, ext, mime: MIME[ext] || "application/octet-stream" });
  if (at(0, 0x4d, 0x5a)) return { refused: "EXECUTABLE", message: "Fișierul este un program executabil, nu un fișier media." };
  if (at(0, 0x7f, 0x45, 0x4c, 0x46)) return { refused: "EXECUTABLE", message: "Fișierul este un program executabil, nu un fișier media." };
  if (ascii(0, 2) === "#!") return { refused: "SCRIPT", message: "Fișierul este un script, nu un fișier media." };
  if (at(0, 0x50, 0x4b, 0x03, 0x04) || at(0, 0x52, 0x61, 0x72, 0x21) || at(0, 0x37, 0x7a, 0xbc, 0xaf)) return { refused: "ARCHIVE", message: "Arhivele nu se importă în biblioteca media; dezarhivează și importă fișierele media." };
  if (ascii(0, 4) === "%PDF") return { refused: "DOCUMENT", message: "Documentele nu se importă în biblioteca media în această versiune." };
  if (buf.length >= 12 && ascii(4, 8) === "ftyp") {
    const brand = ascii(8, 12);
    if (/^qt/.test(brand)) return out("video", "mov");
    if (/^(M4A|M4B|F4A)/.test(brand)) return out("audio", "m4a");
    if (/^(avif|avis)/.test(brand)) return out("image", "avif");
    if (/^(heic|heix|mif1|msf1)/.test(brand)) return out("image", "heic");
    return out("video", "mp4");
  }
  if (at(0, 0x1a, 0x45, 0xdf, 0xa3)) return ascii(0, 64).includes("webm") ? out("video", "webm") : out("video", "mkv");
  if (ascii(0, 4) === "RIFF" && buf.length >= 12) {
    const t = ascii(8, 12);
    if (t === "WAVE") return out("audio", "wav");
    if (t === "AVI ") return out("video", "avi");
    if (t === "WEBP") return out("image", "webp");
    return null;
  }
  if (ascii(0, 4) === "OggS") return out("audio", "ogg");
  if (ascii(0, 4) === "fLaC") return out("audio", "flac");
  if (ascii(0, 3) === "ID3") return out("audio", "mp3");
  if (buf[0] === 0xff && (buf[1] & 0xf6) === 0xf0) return out("audio", "aac"); // ADTS (layer bits 00)
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0 && (buf[1] & 0x06) !== 0) return out("audio", "mp3");
  if (buf[0] === 0x47 && buf.length > 188 && buf[188] === 0x47) return out("video", "ts");
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return out("image", "png");
  if (at(0, 0xff, 0xd8, 0xff)) return out("image", "jpg");
  if (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a") return out("image", "gif");
  if (at(0, 0x00, 0x01, 0x00, 0x00, 0x00) || ascii(0, 4) === "true") return out("font", "ttf");
  if (ascii(0, 4) === "OTTO") return out("font", "otf");
  if (ascii(0, 4) === "wOFF") return out("font", "woff");
  if (ascii(0, 4) === "wOF2") return out("font", "woff2");
  if (!buf.includes(0)) {
    const text = buf.toString("utf8").replace(/^﻿/, "");
    if (/^WEBVTT(\s|$)/.test(text)) return out("caption", "vtt");
    if (/^\s*\d+\s*\r?\n\s*\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*-->/.test(text)) return out("caption", "srt");
  }
  return null;
}

function sha256OfFile(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    fs.createReadStream(file).on("error", reject).on("data", (c) => hash.update(c)).on("end", () => resolve(hash.digest("hex")));
  });
}

const lowerPath = (p) => (process.platform === "win32" ? p.toLowerCase() : p);

function makeWritable(file) { try { fs.chmodSync(file, 0o666); } catch { /* already gone */ } }
function unlinkQuiet(file) { try { makeWritable(file); fs.unlinkSync(file); } catch { /* already gone */ } }

/**
 * `createMediaAssets({ db, bus, clock, paths, tools, settings, maxBytes })`.
 */
export function createMediaAssets({ db, bus, clock = () => new Date(), paths, tools, settings = null, maxBytes = DEFAULT_MAX_BYTES }) {
  if (!db || !bus || !paths) throw new Error("createMediaAssets requires db, bus and paths");
  const now = () => clock().toISOString();
  const policy = () => ({ libraryQuotaGb: 40, diskReserveGb: 15, ...(settings?.get("mediaPolicy") || {}) });

  const selAsset = db.prepare("SELECT * FROM media_assets WHERE id = ?");
  const selVersionsOf = db.prepare("SELECT * FROM media_asset_versions WHERE asset_id = ? ORDER BY version");
  const selVersion = db.prepare(`SELECT v.*, a.origin, a.capture_label, a.kind, a.category, a.title, a.content_project_id, a.project_id
    FROM media_asset_versions v JOIN media_assets a ON a.id = v.asset_id WHERE v.id = ?`);
  const selBySha = db.prepare(`SELECT v.*, a.id AS a_id FROM media_asset_versions v JOIN media_assets a ON a.id = v.asset_id
    WHERE v.sha256 = ? AND v.is_original = 1 AND v.status IN ('READY','QUARANTINED') ORDER BY v.created_at, v.rowid`);
  const selByRel = db.prepare("SELECT id FROM media_asset_versions WHERE rel_path = ? AND status != 'REMOVED_DERIVATIVE'");
  const insAsset = db.prepare(`INSERT INTO media_assets (id, project_id, content_project_id, kind, category, title, description, tags_json, origin, capture_label,
    current_version, created_by, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 1)`);
  const insVersion = db.prepare(`INSERT INTO media_asset_versions (id, asset_id, version, sha256, bytes, rel_path, mime, probe_json, is_original, derived_from_json, status, created_by, created_at)
    VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  // ---------- mapping ----------
  const mapAsset = (r) => r && ({ id: r.id, projectId: r.project_id, contentProjectId: r.content_project_id, kind: r.kind, category: r.category, title: r.title,
    description: r.description, tags: parse(r.tags_json, []), origin: r.origin, captureLabel: r.capture_label, capture_label: r.capture_label,
    currentVersion: r.current_version, createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at, version: r.version });
  const mapVersion = (r) => r && ({ id: r.id, assetId: r.asset_id, version: r.version, sha256: r.sha256, bytes: r.bytes, relPath: r.rel_path, mime: r.mime,
    probe: parse(r.probe_json, {}), isOriginal: r.is_original === 1, derivedFrom: parse(r.derived_from_json, []), status: r.status,
    createdBy: r.created_by, createdAt: r.created_at,
    ...(r.origin !== undefined ? { origin: r.origin, captureLabel: r.capture_label, capture_label: r.capture_label, kind: r.kind, category: r.category,
      title: r.title, contentProjectId: r.content_project_id, projectId: r.project_id } : {}) });

  function get(id) {
    const row = selAsset.get(String(id || ""));
    if (!row) return null;
    const versions = selVersionsOf.all(row.id).map(mapVersion);
    return { ...mapAsset(row), versions, current: versions.find((v) => v.version === row.current_version) || versions[versions.length - 1] || null };
  }
  const getVersion = (versionId) => mapVersion(selVersion.get(String(versionId || ""))) || null;

  // ---------- validation ----------
  const requireActor = (actor) => {
    if (typeof actor !== "string" || !actor.trim() || actor.length > 120) throw new HubError("validation", "Lipsește autorul operației (actor).", { code: "ACTOR_REQUIRED" });
    return actor.trim();
  };
  function cleanText(value, { label, max, required = false, fallback = "" }) {
    if (value === undefined || value === null || value === "") {
      if (required) throw new HubError("validation", `Câmpul „${label}” este obligatoriu.`, { code: "FIELD_REQUIRED" });
      return fallback;
    }
    if (typeof value !== "string") throw new HubError("validation", `Câmpul „${label}” trebuie să fie text.`, { code: "FIELD_INVALID" });
    const t = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
    if (required && !t) throw new HubError("validation", `Câmpul „${label}” este obligatoriu.`, { code: "FIELD_REQUIRED" });
    if (t.length > max) throw new HubError("validation", `Câmpul „${label}” depășește ${max} de caractere.`, { code: "FIELD_TOO_LONG" });
    return t;
  }
  function cleanTags(tags) {
    if (tags === undefined || tags === null) return [];
    if (!Array.isArray(tags) || tags.length > 30) throw new HubError("validation", "Etichetele trebuie să fie o listă de cel mult 30 de elemente.", { code: "FIELD_INVALID" });
    const out = [];
    for (const t of tags) {
      const v = cleanText(t, { label: "etichetă", max: 50 });
      if (v && !out.includes(v)) out.push(v);
    }
    return out;
  }
  function oneOf(value, list, label, fallback) {
    const v = value === undefined || value === null || value === "" ? fallback : value;
    if (!list.includes(v)) throw new HubError("validation", `Valoare invalidă pentru ${label}: ${String(v).slice(0, 40)}.`, { code: "FIELD_INVALID" });
    return v;
  }
  function checkKindCategory(kind, category) {
    if ((kind === "font") !== (category === "font")) throw new HubError("validation", "Fonturile au categoria „font” și doar ele.", { code: "CATEGORY_MISMATCH" });
    if ((kind === "caption") !== (category === "caption")) throw new HubError("validation", "Subtitrările au categoria „caption” și doar ele.", { code: "CATEGORY_MISMATCH" });
  }
  const optionalId = (v, label) => {
    if (v === undefined || v === null || v === "") return null;
    if (typeof v !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(v)) throw new HubError("validation", `Identificator invalid pentru ${label}.`, { code: "FIELD_INVALID" });
    return v;
  };

  /**
   * The source must be a regular file whose real path is inside an allowed root and equals the lexical path below that root
   * (a junction/symlink BELOW the root changes the real path; a junction above it — the operator's choice of root — is tolerated).
   */
  function resolveSource(sourcePath, allowedRoots) {
    if (typeof sourcePath !== "string" || !sourcePath.trim() || sourcePath.includes("\0")) throw new HubError("validation", "Calea fișierului de importat este invalidă.", { code: "MEDIA_PATH_INVALID" });
    if (!path.isAbsolute(sourcePath)) throw new HubError("validation", "Calea fișierului de importat trebuie să fie absolută.", { code: "MEDIA_PATH_INVALID" });
    if (!Array.isArray(allowedRoots) || !allowedRoots.length || allowedRoots.length > 20) throw new HubError("policy", "Nu există dosare permise pentru import.", { code: "MEDIA_NO_ALLOWED_ROOTS" });
    const lexical = path.resolve(sourcePath);
    if (isSecretLikeName(path.basename(lexical))) throw new HubError("policy", "Fișierul are un nume de tip secret (cheie, parolă, .env) și nu se importă.", { code: "MEDIA_SECRET_REFUSED" });
    if (isInsideDir(paths.root, lexical) || isInsideDir(paths.work, lexical)) throw new HubError("policy", "Fișierul este deja în biblioteca media sau în dosarul ei de lucru.", { code: "MEDIA_ALREADY_IN_LIBRARY" });
    // The path must lie (textually) inside an allowed root BEFORE the filesystem is touched: no stat of a UNC / remote path that
    // was never allowed (an outbound SMB request from a refused import).
    const textuallyAllowed = allowedRoots.some((root) => {
      if (typeof root !== "string" || !path.isAbsolute(root) || root.includes("\0")) return false;
      if (isInsideDir(path.resolve(root), lexical)) return true;
      try { return isInsideDir(fs.realpathSync.native(root), lexical); } catch { return false; }
    });
    if (!textuallyAllowed) throw new HubError("policy", "Fișierul nu este în niciunul dintre dosarele permise pentru import.", { code: "MEDIA_OUTSIDE_ALLOWED_ROOTS" });
    let st;
    try { st = fs.lstatSync(lexical); }
    catch (error) {
      if (error.code === "ENOENT" || error.code === "ENOTDIR") throw new HubError("not_found", "Fișierul de importat nu există.", { code: "MEDIA_FILE_MISSING" });
      throw new HubError("validation", `Fișierul de importat nu poate fi citit (${error.code || "eroare"}).`, { code: "MEDIA_FILE_UNREADABLE" });
    }
    if (st.isSymbolicLink()) throw new HubError("policy", "Fișierul este o legătură simbolică; importă fișierul original.", { code: "MEDIA_LINK_REFUSED" });
    if (!st.isFile()) throw new HubError("validation", "Calea nu indică un fișier obișnuit.", { code: "MEDIA_NOT_A_FILE" });
    const real = fs.realpathSync.native(lexical);
    let sawRoot = false;
    for (const root of allowedRoots) {
      if (typeof root !== "string" || !path.isAbsolute(root) || root.includes("\0")) continue;
      let rootReal;
      try { rootReal = fs.realpathSync.native(root); if (!fs.statSync(rootReal).isDirectory()) continue; } catch { continue; }
      const rootLex = path.resolve(root);
      let rel = null;
      if (isInsideDir(rootLex, lexical)) rel = path.relative(rootLex, lexical);
      else if (isInsideDir(rootReal, lexical)) rel = path.relative(rootReal, lexical);
      if (rel === null) continue;
      sawRoot = true;
      if (lowerPath(path.join(rootReal, rel)) !== lowerPath(real) || !isInsideDir(rootReal, real)) {
        throw new HubError("policy", "Calea trece printr-o legătură simbolică sau o joncțiune din dosarul permis; importă fișierul din locația lui reală.", { code: "MEDIA_LINK_REFUSED" });
      }
      if (isProtectedRelative(rel)) throw new HubError("policy", "Fișierul este într-un dosar protejat (date private, copii de siguranță, Git) sau are un nume de tip secret.", { code: "MEDIA_PROTECTED_REFUSED" });
      return { real, size: st.size };
    }
    throw new HubError("policy", sawRoot ? "Fișierul nu este într-un dosar permis pentru import." : "Fișierul nu este în niciunul dintre dosarele permise pentru import.", { code: "MEDIA_OUTSIDE_ALLOWED_ROOTS" });
  }

  function readHead(file, n = 4100) {
    const fd = fs.openSync(file, "r");
    try { const b = Buffer.alloc(n); const read = fs.readSync(fd, b, 0, n, 0); return b.subarray(0, read); } finally { fs.closeSync(fd); }
  }

  // ---------- quota ----------
  const selUsed = db.prepare(`SELECT COALESCE(SUM(b), 0) AS used FROM (SELECT rel_path, MAX(bytes) AS b FROM media_asset_versions
    WHERE status IN ('READY','QUARANTINED') GROUP BY rel_path)`);
  function quota() {
    const p = policy();
    const usedBytes = Number(selUsed.get().used) || 0;
    const quotaBytes = Math.max(0, Number(p.libraryQuotaGb) || 0) * GIB;
    const reserveBytes = Math.max(0, Number(p.diskReserveGb) || 0) * GIB;
    const status = paths.status();
    const freeBytes = status.freeBytes;
    const warnings = [];
    if (usedBytes > quotaBytes) warnings.push("quota_exceeded");
    else if (quotaBytes > 0 && usedBytes >= 0.9 * quotaBytes) warnings.push("quota_near");
    if (freeBytes === null) warnings.push("disk_unknown");
    else if (freeBytes < reserveBytes) warnings.push("disk_reserve");
    if (status.synced) warnings.push("synced_library");
    return { usedBytes, quotaBytes, freeBytes, reserveBytes, ok: usedBytes <= quotaBytes && (freeBytes === null || freeBytes >= reserveBytes), warnings };
  }
  function assertSpace(bytes) {
    const q = quota();
    if (q.usedBytes + bytes > q.quotaBytes) throw new HubError("quota", `Cota bibliotecii media ar fi depășită (${(q.usedBytes / GIB).toFixed(2)} GiB folosiți din ${(q.quotaBytes / GIB).toFixed(0)} GiB).`, { code: "MEDIA_QUOTA" });
    if (q.freeBytes !== null && q.freeBytes - bytes < q.reserveBytes) throw new HubError("quota", `Spațiul liber pe disc ar scădea sub rezerva de ${(q.reserveBytes / GIB).toFixed(0)} GiB.`, { code: "DISK_RESERVE" });
  }

  /** Copies `src` to a fresh temp file under the library while hashing; refuses growth beyond `cap`. */
  async function copyWithHash(src, cap) {
    paths.ensure();
    const temp = path.join(paths.root, ".incoming", `${newId("inc")}.partial`);
    const hash = crypto.createHash("sha256");
    let bytes = 0;
    try {
      await pipeline(fs.createReadStream(src), async function* hashing(source) {
        for await (const chunk of source) {
          bytes += chunk.length;
          if (bytes > cap) throw new HubError("validation", "Fișierul a depășit limita de mărime în timpul copierii.", { code: "FILE_TOO_LARGE" });
          hash.update(chunk);
          yield chunk;
        }
      }, fs.createWriteStream(temp, { flags: "wx", flush: true }));
    } catch (error) {
      unlinkQuiet(temp);
      if (error instanceof HubError) throw error;
      throw new HubError("internal", `Copierea fișierului în bibliotecă a eșuat (${error.code || error.message}).`, { code: "MEDIA_COPY_FAILED" });
    }
    return { temp, sha256: hash.digest("hex"), bytes };
  }

  /** Moves a verified temp file to its content-addressed place (or reuses an identical file already there). Returns `{ abs, created }`. */
  async function placeContentAddressed(temp, sha256, target) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    paths.assertUnder(paths.root, target);
    if (fs.existsSync(target)) {
      const existing = await sha256OfFile(target).catch(() => null);
      if (existing === sha256) { unlinkQuiet(temp); return { abs: target, created: false }; }
      unlinkQuiet(target); // a damaged orphan from an interrupted import: replaced by the verified copy
    }
    try { fs.renameSync(temp, target); }
    catch (error) {
      if (fs.existsSync(target) && (await sha256OfFile(target).catch(() => null)) === sha256) { unlinkQuiet(temp); return { abs: target, created: false }; }
      unlinkQuiet(temp);
      throw new HubError("internal", `Fișierul nu a putut fi mutat în bibliotecă (${error.code || error.message}).`, { code: "MEDIA_COPY_FAILED" });
    }
    try { fs.chmodSync(target, 0o444); } catch { /* best effort: immutability is also enforced by the API */ }
    return { abs: target, created: true };
  }

  async function probeOrQuarantine(abs, kind) {
    if (!PROBED_KINDS.has(kind)) return { status: "READY", probe: {} };
    if (!tools) throw new HubError("tool", "Uneltele media nu sunt configurate.", { code: "TOOL_MISSING" });
    try {
      const probe = await tools.probe(abs);
      return { status: "READY", probe };
    } catch (error) {
      if (error?.code === "TOOL_MISSING" || error?.code === "HUB_SHUTDOWN") throw error;
      return { status: "QUARANTINED", probe: { error: error?.code || "UNDECODABLE", message: String(error?.message || "").slice(0, 600) } };
    }
  }

  function refineKind(kind, probe) {
    if (!probe || probe.error || !PROBED_KINDS.has(kind)) return kind;
    if (probe.isImage) return "image";
    if (!probe.hasVideo && probe.hasAudio) return "audio";
    if (probe.hasVideo && kind === "audio") return "video";
    return kind;
  }

  /**
   * Imports one local file. Returns `{ asset, version, duplicateOf }`; a file whose bytes are already stored is not copied
   * again: the NEW asset row (its own title, context and rights) points to the same file and `duplicateOf` names the first asset.
   */
  async function ingestFile(input = {}) {
    const actor = requireActor(input.actor);
    const category = oneOf(input.category, ORIGINAL_CATEGORIES, "categorie", "raw");
    const origin = oneOf(input.origin, ASSET_ORIGINS, "origine", "UNKNOWN");
    const captureLabel = oneOf(input.captureLabel, CAPTURE_LABELS, "eticheta de captură", origin === "AI_GENERATED" ? "GENERATED" : "NOT_APPLICABLE");
    const description = cleanText(input.description, { label: "descriere", max: 4000 });
    const tags = cleanTags(input.tags);
    const contentProjectId = optionalId(input.contentProjectId, "proiect de conținut");
    const projectId = optionalId(input.projectId, "proiect");
    const cap = Math.min(maxBytes, Number(input.maxBytes) > 0 ? Number(input.maxBytes) : maxBytes);

    const src = resolveSource(input.sourcePath, input.allowedRoots);
    if (src.size === 0) throw new HubError("validation", "Fișierul este gol.", { code: "MEDIA_EMPTY" });
    if (src.size > cap) throw new HubError("validation", `Fișierul depășește limita de ${(cap / GIB >= 1 ? `${(cap / GIB).toFixed(1)} GiB` : `${Math.ceil(cap / 1024 / 1024)} MiB`)}.`, { code: "FILE_TOO_LARGE", status: 413 });
    const sniff = sniffMagic(readHead(src.real));
    if (!sniff) throw new HubError("validation", "Tipul fișierului nu este recunoscut ca media (video, audio, imagine, subtitrare sau font).", { code: "MEDIA_TYPE_UNKNOWN" });
    if (sniff.refused) throw new HubError("policy", sniff.message, { code: `MEDIA_${sniff.refused}_REFUSED` });
    checkKindCategory(sniff.kind, category);
    // The title may come from the file name (display only); the physical name never does.
    const title = cleanText(input.title, { label: "titlu", max: 200, fallback: "" }) || cleanText(path.parse(src.real).name.slice(0, 200), { label: "titlu", max: 200 }) || "Fișier media";

    assertSpace(src.size);
    const copy = await copyWithHash(src.real, cap);
    if (copy.bytes !== src.size) { unlinkQuiet(copy.temp); throw new HubError("conflict", "Fișierul s-a modificat în timpul importului; încearcă din nou după ce s-a terminat scrierea lui.", { code: "MEDIA_SOURCE_CHANGED" }); }

    const existing = selBySha.all(copy.sha256).find((row) => { try { return fs.existsSync(paths.resolveRel(row.rel_path)); } catch { return false; } });
    let relPath; let status; let probe; let created = false; let abs;
    if (existing) {
      unlinkQuiet(copy.temp);
      relPath = existing.rel_path; abs = paths.resolveRel(relPath);
      status = existing.status; probe = parse(existing.probe_json, {});
    } else {
      const placed = await placeContentAddressed(copy.temp, copy.sha256, paths.originalPath(copy.sha256, sniff.ext));
      abs = placed.abs; created = placed.created; relPath = paths.relOf(abs);
      try { ({ status, probe } = await probeOrQuarantine(abs, sniff.kind)); }
      catch (error) {
        // No tool: nothing is recorded, and a file this import created (and nobody references) is removed again.
        if (created && !selByRel.get(relPath)) { unlinkQuiet(abs); try { fs.rmdirSync(path.dirname(abs)); } catch { /* not empty */ } }
        throw error;
      }
    }
    const kind = refineKind(sniff.kind, probe);
    const assetId = newId("mas");
    const versionId = newId("mav");
    const at = now();
    const duplicateOf = existing ? existing.asset_id : null;
    bus.transaction(() => {
      insAsset.run(assetId, projectId, contentProjectId, kind, category, title, description, json(tags), origin, captureLabel, actor, at, at);
      insVersion.run(versionId, assetId, copy.sha256, copy.bytes, relPath, sniff.mime, json(probe), 1, "[]", status, actor, at);
      bus.append({ type: status === "QUARANTINED" ? "media.asset.quarantined" : "media.asset.imported", scopeType: "media_asset", scopeId: assetId, source: actor,
        projectId: projectId || undefined,
        payload: { assetId, versionId, kind, category, origin, captureLabel, sha256: copy.sha256, bytes: copy.bytes, status, duplicateOf,
          sourceName: path.basename(src.real).slice(0, 200), reason: status === "QUARANTINED" ? probe.error : undefined } });
    });
    return { asset: get(assetId), version: getVersion(versionId), duplicateOf };
  }

  /**
   * Registers a derived file (render, proxy, thumbnail, export…) produced from library versions. A file already under the
   * library root (e.g. renders/<jobId>.mp4) stays in place; a file in the scratch root is copied to derivatives/<category>/<sha>.<ext>.
   */
  async function registerDerivative(input = {}) {
    const actor = requireActor(input.actor);
    const ids = input.inputVersionIds;
    if (!Array.isArray(ids) || !ids.length || ids.length > 200) throw new HubError("validation", "Un derivat trebuie să numească între 1 și 200 de versiuni de intrare.", { code: "DERIVATIVE_INPUTS" });
    const inputs = [...new Set(ids)].map((id) => {
      const v = getVersion(id);
      if (!v) throw new HubError("not_found", `Versiunea de intrare ${String(id).slice(0, 60)} nu există.`, { code: "DERIVATIVE_INPUT_MISSING" });
      return v;
    });
    const op = cleanText(input.op, { label: "operație", max: 64, required: true });
    if (!/^[a-z0-9_.:-]+$/i.test(op)) throw new HubError("validation", "Numele operației conține caractere nepermise.", { code: "FIELD_INVALID" });
    const params = input.params === undefined ? {} : input.params;
    if (params === null || typeof params !== "object" || json(params).length > 16384) throw new HubError("validation", "Parametrii derivatului trebuie să fie un obiect JSON de cel mult 16 KiB.", { code: "FIELD_INVALID" });
    const category = oneOf(input.category, ASSET_CATEGORIES, "categorie", "render");
    const kind = oneOf(input.kind, ASSET_KINDS, "tip", "video");
    checkKindCategory(kind, category);
    const title = cleanText(input.title, { label: "titlu", max: 200, fallback: `${op} (${inputs.length} intrări)` });
    const description = cleanText(input.description, { label: "descriere", max: 4000 });
    const tags = cleanTags(input.tags);
    const contentProjectId = optionalId(input.contentProjectId, "proiect de conținut") || inputs.find((v) => v.contentProjectId)?.contentProjectId || null;
    const projectId = optionalId(input.projectId, "proiect") || inputs.find((v) => v.projectId)?.projectId || null;

    paths.ensure();
    const file = paths.assertRegularFile(input.absPath);
    let abs; let sha256;
    if (paths.isLibraryPath(file.real)) {
      const rel = paths.relOf(file.real);
      if (rel.startsWith("originals/")) throw new HubError("policy", "Un original nu poate fi înregistrat ca derivat (originalele sunt imuabile).", { code: "ORIGINAL_IMMUTABLE" });
      if (selByRel.get(rel)) throw new HubError("conflict", "Fișierul este deja înregistrat în bibliotecă.", { code: "DERIVATIVE_DUPLICATE" });
      abs = file.real; sha256 = await sha256OfFile(abs);
    } else if (paths.isWorkPath(file.real)) {
      assertSpace(file.size);
      const head = sniffMagic(readHead(file.real));
      const ext = head && !head.refused ? head.ext : String(path.extname(file.real).slice(1)).toLowerCase();
      if (!/^[a-z0-9]{1,8}$/.test(ext)) throw new HubError("validation", "Extensia derivatului nu este recunoscută.", { code: "MEDIA_EXT_INVALID" });
      const copy = await copyWithHash(file.real, maxBytes);
      sha256 = copy.sha256;
      ({ abs } = await placeContentAddressed(copy.temp, sha256, paths.derivativePath(category, sha256, ext)));
      if (selByRel.get(paths.relOf(abs))) throw new HubError("conflict", "Un derivat identic este deja înregistrat.", { code: "DERIVATIVE_DUPLICATE", data: { versionId: selByRel.get(paths.relOf(abs)).id } });
    } else {
      throw new HubError("policy", "Derivatele se înregistrează doar din biblioteca media sau din dosarul ei de lucru.", { code: "MEDIA_PATH_OUTSIDE" });
    }
    const relPath = paths.relOf(abs);
    const bytes = fs.statSync(abs).size;
    const sniff = sniffMagic(readHead(abs));
    const mime = sniff && !sniff.refused ? sniff.mime : "application/octet-stream";
    const { status, probe } = await probeOrQuarantine(abs, kind);
    const origin = ORIGIN_RANK.find((o) => inputs.some((v) => v.origin === o)) || "UNKNOWN";
    const captureLabel = LABEL_RANK.find((l) => inputs.some((v) => v.captureLabel === l)) || "NOT_APPLICABLE";
    const derivedFrom = inputs.map((v) => ({ versionId: v.id, assetId: v.assetId, sha256: v.sha256, op, params }));
    const assetId = newId("mas");
    const versionId = newId("mav");
    const at = now();
    bus.transaction(() => {
      insAsset.run(assetId, projectId, contentProjectId, refineKind(kind, probe), category, title, description, json(tags), origin, captureLabel, actor, at, at);
      insVersion.run(versionId, assetId, sha256, bytes, relPath, mime, json(probe), 0, json(derivedFrom), status, actor, at);
      bus.append({ type: "media.asset.derivative_registered", scopeType: "media_asset", scopeId: assetId, source: actor,
        payload: { assetId, versionId, op, category, kind, origin, captureLabel, sha256, bytes, status, inputs: inputs.map((v) => v.id) } });
    });
    return { asset: get(assetId), version: getVersion(versionId) };
  }

  /**
   * Absolute path of a version's file (READY only by default). A file that vanished is marked MISSING (with an event) and refused.
   */
  function versionPath(versionId, { allowStatuses = ["READY"] } = {}) {
    const v = getVersion(versionId);
    if (!v) throw new HubError("not_found", "Versiunea media nu există.", { code: "MEDIA_VERSION_MISSING" });
    if (!allowStatuses.includes(v.status)) throw new HubError("conflict", `Versiunea media nu poate fi folosită (stare ${v.status}).`, { code: `MEDIA_${v.status}` });
    const abs = paths.resolveRel(v.relPath);
    try { paths.assertRegularFile(abs); }
    catch (error) {
      if (error?.code === "MEDIA_FILE_MISSING" && v.status !== "REMOVED_DERIVATIVE") {
        bus.transaction(() => {
          db.prepare("UPDATE media_asset_versions SET status = 'MISSING' WHERE id = ? AND status IN ('READY','QUARANTINED')").run(v.id);
          bus.append({ type: "media.asset.missing", scopeType: "media_asset", scopeId: v.assetId, source: "media-assets", payload: { versionId: v.id, relPath: v.relPath } });
        });
      }
      throw error;
    }
    return abs;
  }

  /** Metadata edits only (title, description, tags, category, origin, capture label, project links); never the file or its hash. */
  function updateMetadata(assetId, patch = {}, actor, { expectedVersion = null } = {}) {
    const who = requireActor(actor);
    const row = selAsset.get(String(assetId || ""));
    if (!row) throw new HubError("not_found", "Assetul media nu există.", { code: "MEDIA_ASSET_MISSING" });
    if (expectedVersion !== null && Number(expectedVersion) !== row.version) throw new HubError("conflict", "Assetul a fost modificat între timp; reîncarcă și încearcă din nou.", { code: "STALE_VERSION" });
    const forbidden = Object.keys(patch).filter((k) => ["relPath", "rel_path", "sha256", "bytes", "status", "kind", "derivedFrom", "isOriginal"].includes(k));
    if (forbidden.length) throw new HubError("policy", "Fișierul, amprenta și tipul unui asset nu se modifică; o editare produce un derivat nou.", { code: "ORIGINAL_IMMUTABLE" });
    const next = {
      title: patch.title !== undefined ? cleanText(patch.title, { label: "titlu", max: 200, required: true }) : row.title,
      description: patch.description !== undefined ? cleanText(patch.description, { label: "descriere", max: 4000 }) : row.description,
      tags: patch.tags !== undefined ? cleanTags(patch.tags) : parse(row.tags_json, []),
      category: patch.category !== undefined ? oneOf(patch.category, ASSET_CATEGORIES, "categorie") : row.category,
      origin: patch.origin !== undefined ? oneOf(patch.origin, ASSET_ORIGINS, "origine") : row.origin,
      captureLabel: patch.captureLabel !== undefined ? oneOf(patch.captureLabel, CAPTURE_LABELS, "eticheta de captură") : row.capture_label,
      contentProjectId: patch.contentProjectId !== undefined ? optionalId(patch.contentProjectId, "proiect de conținut") : row.content_project_id,
      projectId: patch.projectId !== undefined ? optionalId(patch.projectId, "proiect") : row.project_id,
    };
    checkKindCategory(row.kind, next.category);
    const versions = selVersionsOf.all(row.id);
    if (versions.some((v) => v.is_original === 1) && ["proxy", "render", "export"].includes(next.category)) throw new HubError("validation", "Un original nu poate primi o categorie de derivat.", { code: "CATEGORY_MISMATCH" });
    const changed = {};
    const before = { title: row.title, description: row.description, tags: parse(row.tags_json, []), category: row.category, origin: row.origin,
      captureLabel: row.capture_label, contentProjectId: row.content_project_id, projectId: row.project_id };
    for (const k of Object.keys(next)) if (JSON.stringify(next[k]) !== JSON.stringify(before[k])) changed[k] = { from: before[k], to: next[k] };
    if (!Object.keys(changed).length) return get(row.id);
    bus.transaction(() => {
      const r = db.prepare(`UPDATE media_assets SET title = ?, description = ?, tags_json = ?, category = ?, origin = ?, capture_label = ?, content_project_id = ?, project_id = ?,
        updated_at = ?, version = version + 1 WHERE id = ? AND version = ?`).run(next.title, next.description, json(next.tags), next.category, next.origin, next.captureLabel,
        next.contentProjectId, next.projectId, now(), row.id, row.version);
      if (r.changes !== 1) throw new HubError("conflict", "Assetul a fost modificat între timp; reîncarcă și încearcă din nou.", { code: "STALE_VERSION" });
      // Description text can be long; the event keeps only which fields changed (and origin/label values, which matter for rights).
      bus.append({ type: "media.asset.updated", scopeType: "media_asset", scopeId: row.id, source: who,
        payload: { fields: Object.keys(changed), origin: changed.origin, captureLabel: changed.captureLabel, category: changed.category } });
    });
    return get(row.id);
  }

  /** Library listing with filters (content project, project, category, kind) and a diacritics-insensitive text filter. */
  function list({ contentProjectId = null, projectId = null, category = null, kind = null, q = null, limit = 100, offset = 0 } = {}) {
    const where = []; const args = [];
    if (contentProjectId) { where.push("a.content_project_id = ?"); args.push(String(contentProjectId)); }
    if (projectId) { where.push("a.project_id = ?"); args.push(String(projectId)); }
    if (category) { where.push("a.category = ?"); args.push(oneOf(category, ASSET_CATEGORIES, "categorie")); }
    if (kind) { where.push("a.kind = ?"); args.push(oneOf(kind, ASSET_KINDS, "tip")); }
    const lim = Math.min(500, Math.max(1, Number(limit) || 100));
    const off = Math.max(0, Number(offset) || 0);
    const rows = db.prepare(`SELECT a.*, v.id AS v_id, v.status AS v_status, v.bytes AS v_bytes, v.sha256 AS v_sha, v.probe_json AS v_probe, v.is_original AS v_orig
      FROM media_assets a LEFT JOIN media_asset_versions v ON v.asset_id = a.id AND v.version = a.current_version
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY a.created_at DESC, a.rowid DESC LIMIT ? OFFSET ?`).all(...args, q ? 5000 : lim, q ? 0 : off);
    let out = rows.map((r) => ({ ...mapAsset(r), current: r.v_id ? { id: r.v_id, status: r.v_status, bytes: r.v_bytes, sha256: r.v_sha, isOriginal: r.v_orig === 1,
      durationMs: parse(r.v_probe, {})?.durationMs ?? null } : null }));
    if (q) {
      const needle = fold(String(q).trim());
      if (needle) out = out.filter((a) => fold(`${a.title} ${a.description} ${a.tags.join(" ")}`).includes(needle));
      out = out.slice(off, off + lim);
    }
    return out;
  }

  /** A transcript segment in whatever shape the transcriber stored: { fromMs, toMs } | { startMs, endMs } | whisper { offsets } | seconds. */
  function segmentRange(seg) {
    const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
    if (n(seg?.fromMs) !== null) return [n(seg.fromMs), n(seg.toMs) ?? n(seg.fromMs)];
    if (n(seg?.startMs) !== null) return [n(seg.startMs), n(seg.endMs) ?? n(seg.startMs)];
    if (seg?.offsets && n(seg.offsets.from) !== null) return [n(seg.offsets.from), n(seg.offsets.to) ?? n(seg.offsets.from)];
    if (n(seg?.start) !== null) return [Math.round(n(seg.start) * 1000), Math.round((n(seg.end) ?? n(seg.start)) * 1000)];
    return null;
  }

  /**
   * Searches titles/tags/descriptions, final media transcripts (segment intervals) and capture-session markers. Returns
   * `[{ assetId, versionId, fromMs, toMs, text, source }]` with source "metadata" | "transcript" | "marker".
   */
  function search({ q, limit = 100, contentProjectId = null } = {}) {
    const raw = typeof q === "string" ? q.trim() : "";
    if (raw.length < 2 || raw.length > 200) throw new HubError("validation", "Căutarea are nevoie de 2–200 de caractere.", { code: "SEARCH_QUERY_INVALID" });
    const needle = fold(raw);
    const lim = Math.min(500, Math.max(1, Number(limit) || 100));
    const results = [];
    const scope = contentProjectId ? " AND a.content_project_id = ?" : "";
    const scopeArgs = contentProjectId ? [String(contentProjectId)] : [];

    for (const r of db.prepare(`SELECT a.id, a.title, a.description, a.tags_json, v.id AS v_id, v.probe_json FROM media_assets a
      LEFT JOIN media_asset_versions v ON v.asset_id = a.id AND v.version = a.current_version WHERE 1 = 1${scope} ORDER BY a.created_at DESC LIMIT 5000`).all(...scopeArgs)) {
      const tags = parse(r.tags_json, []);
      const hit = [r.title, ...tags, r.description].find((t) => fold(t).includes(needle));
      if (hit === undefined) continue;
      results.push({ assetId: r.id, versionId: r.v_id, fromMs: 0, toMs: parse(r.probe_json, {})?.durationMs ?? null, text: String(hit).slice(0, 300), source: "metadata" });
    }
    for (const r of db.prepare(`SELECT t.id AS t_id, t.segments_json, t.text, v.id AS v_id, a.id AS a_id FROM media_transcripts t
      JOIN media_asset_versions v ON v.id = t.asset_version_id JOIN media_assets a ON a.id = v.asset_id
      WHERE t.status = 'final'${scope} ORDER BY t.created_at DESC LIMIT 2000`).all(...scopeArgs)) {
      const segments = parse(r.segments_json, []);
      if (!Array.isArray(segments)) continue;
      for (const seg of segments) {
        const text = typeof seg?.text === "string" ? seg.text : "";
        if (!text || !fold(text).includes(needle)) continue;
        const range = segmentRange(seg);
        if (!range) continue;
        results.push({ assetId: r.a_id, versionId: r.v_id, fromMs: range[0], toMs: Math.max(range[0], range[1]), text: text.trim().slice(0, 300), source: "transcript", transcriptId: r.t_id });
      }
    }
    for (const r of db.prepare(`SELECT s.id AS s_id, s.markers_json, a.id AS a_id, v.id AS v_id, v.probe_json FROM media_capture_sessions s
      JOIN media_assets a ON a.id = s.output_asset_id LEFT JOIN media_asset_versions v ON v.asset_id = a.id AND v.version = a.current_version
      WHERE s.output_asset_id IS NOT NULL${scope} ORDER BY s.created_at DESC LIMIT 2000`).all(...scopeArgs)) {
      const markers = (parse(r.markers_json, []) || []).filter((m) => m && Number.isFinite(Number(m.atMs))).sort((x, y) => Number(x.atMs) - Number(y.atMs));
      const duration = parse(r.probe_json, {})?.durationMs ?? null;
      markers.forEach((m, i) => {
        const text = `${m.kind || ""} ${m.note || ""}`.trim();
        if (!text || !fold(text).includes(needle)) return;
        const from = Number(m.atMs);
        const next = markers[i + 1] ? Number(markers[i + 1].atMs) : duration;
        results.push({ assetId: r.a_id, versionId: r.v_id, fromMs: from, toMs: next !== null && next >= from ? next : from, text: text.slice(0, 300), source: "marker", sessionId: r.s_id });
      });
    }
    const order = { metadata: 0, transcript: 1, marker: 2 };
    results.sort((a, b) => order[a.source] - order[b.source] || String(a.assetId).localeCompare(String(b.assetId)) || a.fromMs - b.fromMs);
    return results.slice(0, lim);
  }

  /**
   * Removes regenerable derivatives (proxies, thumbnails) older than `olderThanDays`. Dry run by default: lists what would go.
   * Never touches originals, renders, exports, a version an edit references, or a file another kept version shares.
   */
  function cleanupDerivatives({ olderThanDays = 30, dryRun = true, actor = null } = {}) {
    const days = Number(olderThanDays);
    if (!Number.isFinite(days) || days < 0 || days > 3650) throw new HubError("validation", "Vechimea minimă trebuie să fie între 0 și 3650 de zile.", { code: "FIELD_INVALID" });
    const who = dryRun ? (actor || "dry-run") : requireActor(actor);
    const cutoff = new Date(clock().getTime() - days * 86400000).toISOString();
    const rows = db.prepare(`SELECT v.*, a.category FROM media_asset_versions v JOIN media_assets a ON a.id = v.asset_id
      WHERE v.is_original = 0 AND v.status = 'READY' AND a.category IN (${CLEANABLE_CATEGORIES.map(() => "?").join(",")}) AND v.created_at < ?
      ORDER BY v.created_at`).all(...CLEANABLE_CATEGORIES, cutoff);
    const referenced = db.prepare("SELECT 1 FROM media_edit_versions WHERE instr(ir_json, ?) > 0 LIMIT 1");
    const sharers = db.prepare("SELECT id FROM media_asset_versions WHERE rel_path = ? AND status != 'REMOVED_DERIVATIVE'");
    const ids = new Set(rows.map((r) => r.id));
    const candidates = [];
    const skipped = [];
    for (const r of rows) {
      if (!/^(derivatives|cache|thumbnails)\//.test(r.rel_path)) { skipped.push({ versionId: r.id, reason: "outside_derivative_folders" }); continue; }
      if (referenced.get(`"${r.id}"`)) { skipped.push({ versionId: r.id, reason: "referenced_by_edit" }); continue; }
      if (sharers.all(r.rel_path).some((s) => !ids.has(s.id))) { skipped.push({ versionId: r.id, reason: "shared_file" }); continue; }
      candidates.push({ versionId: r.id, assetId: r.asset_id, category: r.category, relPath: r.rel_path, bytes: r.bytes, createdAt: r.created_at });
    }
    const totalBytes = candidates.reduce((s, c) => s + (c.bytes || 0), 0);
    if (dryRun) return { dryRun: true, olderThanDays: days, candidates, skipped, totalBytes };
    const removed = [];
    const files = new Set();
    for (const c of candidates) {
      let abs;
      try { abs = paths.resolveRel(c.relPath); } catch { skipped.push({ versionId: c.versionId, reason: "path_refused" }); continue; }
      if (!files.has(abs)) { unlinkQuiet(abs); files.add(abs); }
      if (fs.existsSync(abs)) { skipped.push({ versionId: c.versionId, reason: "delete_failed" }); continue; }
      bus.transaction(() => {
        db.prepare("UPDATE media_asset_versions SET status = 'REMOVED_DERIVATIVE' WHERE id = ? AND status = 'READY' AND is_original = 0").run(c.versionId);
        bus.append({ type: "media.asset.derivative_removed", scopeType: "media_asset", scopeId: c.assetId, source: who, payload: { versionId: c.versionId, category: c.category, bytes: c.bytes } });
      });
      removed.push(c);
    }
    return { dryRun: false, olderThanDays: days, removed, skipped, totalBytes: removed.reduce((s, c) => s + (c.bytes || 0), 0) };
  }

  return { ingestFile, registerDerivative, get, getVersion, versionPath, updateMetadata, list, search, quota, cleanupDerivatives, sniffMagic };
}
