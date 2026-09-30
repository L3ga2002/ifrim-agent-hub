import fs from "node:fs";
import { resolveInScope } from "../security/paths.mjs";
import { redactText } from "../security/redact.mjs";

/**
 * The only project files Lega reads, by fixed relative path: the project's own notes for humans. Never `.ifrim/private`,
 * backups, `.env`, credentials or source code; the list is not extensible from a request.
 */
export const PROJECT_NOTE_FILES = Object.freeze(["README.md", ".ifrim/PROJECT_STATE.md", ".ifrim/NEXT_SESSION.md", ".ifrim/OPEN_ISSUES.md"]);

const MAX_READ_BYTES = 64 * 1024;

/**
 * Reads a project's notes, bounded and redacted. Paths go through `resolveInScope`: a link or junction that leaves the
 * project or lands in a protected location is refused and reported by name only. At most 64 KB per file is read from disk.
 * Returns { notes: [{ file, text, truncated }], skipped: [{ file, reason }] }.
 */
export function readProjectNotes(projectPath, { perFile = 1800, total = 5000 } = {}) {
  const notes = []; const skipped = [];
  try { fs.realpathSync.native(projectPath); } catch { return { notes, skipped: [{ file: ".", reason: "project folder not found" }] }; }
  let used = 0;
  for (const rel of PROJECT_NOTE_FILES) {
    if (used >= total) { skipped.push({ file: rel, reason: "budget" }); continue; }
    let real;
    try { real = resolveInScope(projectPath, rel); }
    catch (error) { if (error.category !== "not_found") skipped.push({ file: rel, reason: "refused: outside the project or protected" }); continue; }
    let raw; let size;
    try {
      const stat = fs.statSync(real);
      if (!stat.isFile()) continue;
      size = stat.size;
      const fd = fs.openSync(real, "r");
      try {
        const buffer = Buffer.alloc(Math.min(size, MAX_READ_BYTES));
        const read = fs.readSync(fd, buffer, 0, buffer.length, 0);
        raw = buffer.subarray(0, read).toString("utf8");
      } finally { fs.closeSync(fd); }
    } catch { skipped.push({ file: rel, reason: "unreadable" }); continue; }
    const clean = redactText(raw.replace(/\r/g, "")).replace(/\n{3,}/g, "\n\n").trim();
    if (!clean) continue;
    const room = Math.min(perFile, total - used);
    const truncated = clean.length > room || size > MAX_READ_BYTES;
    const text = clean.length > room ? `${clean.slice(0, room - 1)}…` : clean;
    notes.push({ file: rel, text, truncated });
    used += text.length;
  }
  return { notes, skipped };
}
