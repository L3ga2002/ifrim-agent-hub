// M11: a delivery writes its own files (the commercial summary .md/.html) next to its exported clips — never overwriting, inside the
// approved exports folder, read back and verified. Same rules as media/index.mjs exportLocal.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { HubError } from "../core/errors.mjs";

const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,80}\.(md|html|json)$/i;
const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const inside = (root, p) => { const r = path.resolve(root).toLowerCase(); const x = path.resolve(p).toLowerCase(); return x === r || x.startsWith(`${r}${path.sep}`); };

/**
 * `writeNew(dir, name, buffer, { root })` → { file, sha256, existing, versioned }. `name` is one path segment; `dir` must stay inside
 * `root` (the approved exports folder), also after resolving links. An existing file with the same content is reported as such; one
 * with other content is never touched: the next free „ (2)”, „ (3)”… name is used.
 */
export function writeNew(dir, name, buffer, { root }) {
  if (!NAME_RE.test(String(name || ""))) throw new HubError("validation", "Numele fișierului nu este valid.", { code: "DELIVERY_FILE_NAME" });
  if (!root || !inside(root, dir)) throw new HubError("policy", "Fișierul trebuie scris în folderul de exporturi aprobat.", { code: "DELIVERY_FILE_OUTSIDE" });
  fs.mkdirSync(dir, { recursive: true });
  if (!inside(fs.realpathSync(root), fs.realpathSync(dir))) throw new HubError("policy", "Folderul de export iese din folderul aprobat (legătură).", { code: "DELIVERY_FILE_OUTSIDE" });
  const want = sha(buffer);
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
