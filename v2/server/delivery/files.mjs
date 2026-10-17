// M11: a delivery writes its own files (the commercial summary .md/.html) next to its exported clips — never overwriting, inside the
// approved exports folder, read back and verified. Same rules as media/index.mjs exportLocal.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { HubError } from "../core/errors.mjs";

const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,80}\.(md|html|json)$/i;
const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const inside = (root, p) => { const r = path.resolve(root).toLowerCase(); const x = path.resolve(p).toLowerCase(); return x === r || x.startsWith(`${r}${path.sep}`); };
/** M12 opt-in: a caller may allow other extensions (the Sales dossier: .docx, .pdf); without it the M11 list above applies. */
const nameRe = (exts) => (exts ? new RegExp(`^[a-z0-9][a-z0-9._-]{0,80}\\.(${exts.map((e) => String(e).replace(/[^a-z0-9]/gi, "")).filter(Boolean).join("|")})$`, "i") : NAME_RE);

/**
 * `writeNew(dir, name, buffer, { root })` → { file, sha256, existing, versioned }. `name` is one path segment; `dir` must stay inside
 * `root` (the approved exports folder), also after resolving links. An existing file with the same content is reported as such; one
 * with other content is never touched: the next free „ (2)”, „ (3)”… name is used.
 *
 * M12 opt-in options (without them the M11 behaviour above is unchanged):
 * - `exts`: the allowed extensions instead of md / html / json;
 * - `exclusive`: one exact name, never a „ (2)” copy. The bytes go to a temporary file first and are published under the name with a
 *   hard link, which fails when the name exists: nothing is ever overwritten and a crash never leaves a half-written file under the
 *   final name. An existing file with the same content counts as written (a resume); one with other content refuses (DELIVERY_FILE_TAKEN).
 */
export function writeNew(dir, name, buffer, { root, exts = null, exclusive = false }) {
  if (!nameRe(exts).test(String(name || ""))) throw new HubError("validation", "Numele fișierului nu este valid.", { code: "DELIVERY_FILE_NAME" });
  if (!root || !inside(root, dir)) throw new HubError("policy", "Fișierul trebuie scris în folderul de exporturi aprobat.", { code: "DELIVERY_FILE_OUTSIDE" });
  fs.mkdirSync(dir, { recursive: true });
  if (!inside(fs.realpathSync(root), fs.realpathSync(dir))) throw new HubError("policy", "Folderul de export iese din folderul aprobat (legătură).", { code: "DELIVERY_FILE_OUTSIDE" });
  const want = sha(buffer);
  if (exclusive) return writeExclusive(path.join(dir, name), buffer, want);
  const ext = path.extname(name);
  const base = name.slice(0, -ext.length);
  for (let i = 1; i < 1000; i += 1) {
    const file = path.join(dir, `${base}${i > 1 ? ` (${i})` : ""}${ext}`);
    let fd;
    try { fd = fs.openSync(file, "wx"); }
    catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (sha(fs.readFileSync(file)) === want) return { file, sha256: want, existing: true, versioned: i > 1 };
      continue;
    }
    try { fs.writeSync(fd, buffer); } finally { fs.closeSync(fd); }
    if (sha(fs.readFileSync(file)) !== want) { fs.rmSync(file, { force: true }); throw new HubError("tool", "Fișierul scris nu corespunde conținutului; l-am șters.", { code: "DELIVERY_FILE_VERIFY" }); }
    return { file, sha256: want, existing: false, versioned: i > 1 };
  }
  throw new HubError("conflict", "Prea multe fișiere cu același nume.", { code: "DELIVERY_FILE_NAME" });
}

/** The exclusive publication (`exclusive` above): a temporary file, verified, then a link that never replaces an existing name. */
function writeExclusive(file, buffer, want) {
  const taken = () => new HubError("conflict", `Există deja ${path.basename(file)} cu alt conținut; nu îl suprascriu.`, { code: "DELIVERY_FILE_TAKEN" });
  const same = () => { try { return sha(fs.readFileSync(file)) === want; } catch { return false; } };
  const existing = { file, sha256: want, existing: true, versioned: false };
  if (fs.existsSync(file)) { if (same()) return existing; throw taken(); }
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  const fd = fs.openSync(tmp, "wx");
  try { fs.writeSync(fd, buffer); } finally { fs.closeSync(fd); }
  try {
    if (sha(fs.readFileSync(tmp)) !== want) throw new HubError("tool", "Fișierul temporar nu corespunde conținutului.", { code: "DELIVERY_FILE_VERIFY" });
    try { fs.linkSync(tmp, file); }
    catch (error) {
      if (error.code === "EEXIST") { if (same()) return existing; throw taken(); }
      // A file system without hard links: an exclusive copy (it refuses an existing name too).
      if (!["EPERM", "ENOTSUP", "EXDEV", "EINVAL", "ENOSYS", "EACCES"].includes(error.code)) throw error;
      try { fs.copyFileSync(tmp, file, fs.constants.COPYFILE_EXCL); }
      catch (copyError) { if (copyError.code === "EEXIST") { if (same()) return existing; throw taken(); } throw copyError; }
    }
  } finally { fs.rmSync(tmp, { force: true }); }
  if (!same()) throw new HubError("tool", "Fișierul publicat nu corespunde conținutului.", { code: "DELIVERY_FILE_VERIFY" });
  return { file, sha256: want, existing: false, versioned: false };
}
