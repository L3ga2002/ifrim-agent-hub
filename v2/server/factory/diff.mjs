import { readBlob } from "./snapshot.mjs";
import { redactText } from "../security/redact.mjs";

/**
 * Line diff (Myers, O((N+M)·D)) rendered as a unified diff. Used for change sets: snapshots keep text blobs, so the diff
 * of a writer's change is computed by the Hub itself, without git. Large inputs fall back to a whole-file replacement
 * (marked), never to a silently partial diff.
 */
const MAX_EDIT_DISTANCE = 4000;

function myers(a, b) {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace = [];
  for (let d = 0; d <= max; d += 1) {
    if (d > MAX_EDIT_DISTANCE) return null;
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x += 1; y += 1; }
      v[offset + k] = x;
      if (x >= n && y >= m) return backtrack(trace, a, b, offset, d);
    }
  }
  return null;
}

function backtrack(trace, a, b, offset, dFinal) {
  const ops = [];
  let x = a.length;
  let y = b.length;
  for (let d = dFinal; d >= 0; d -= 1) {
    const v = trace[d];
    const k = x - y;
    const prevK = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? k + 1 : k - 1;
    const prevX = d === 0 ? 0 : v[offset + prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) { ops.push({ op: " ", line: a[x - 1] }); x -= 1; y -= 1; }
    if (d > 0) {
      if (x === prevX) { ops.push({ op: "+", line: b[y - 1] }); y -= 1; }
      else { ops.push({ op: "-", line: a[x - 1] }); x -= 1; }
    }
  }
  return ops.reverse();
}

const NO_EOL = "\n\\ No newline at end of file";
/**
 * Lines of a text as git counts them: a final "\n" ends the last line (it is not an extra empty line), and a last line
 * without "\n" carries git's "No newline at end of file" marker, so the rendered diff applies byte-exact with `git apply`.
 */
function splitLines(text) {
  if (text === "") return [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  else lines[lines.length - 1] += NO_EOL;
  return lines;
}

/** Unified diff of two texts with `context` lines; `label` names the file; `status` added/deleted uses /dev/null like git. */
export function unifiedDiff(before, after, { label = "file", context = 3, status = "modified" } = {}) {
  const a = splitLines(before ?? "");
  const b = splitLines(after ?? "");
  let ops = myers(a, b);
  let note = "";
  if (!ops) {
    ops = [...a.map((line) => ({ op: "-", line })), ...b.map((line) => ({ op: "+", line }))];
    note = "# diff prea mare pentru calcul linie cu linie: fișier înlocuit integral\n";
  }
  const header = `--- ${status === "added" ? "/dev/null" : `a/${label}`}\n+++ ${status === "deleted" ? "/dev/null" : `b/${label}`}\n${note}`;
  const hunks = [];
  let aLine = 1;
  let bLine = 1;
  const positions = ops.map((o) => { const p = { ...o, a: aLine, b: bLine }; if (o.op !== "+") aLine += 1; if (o.op !== "-") bLine += 1; return p; });
  const changed = positions.map((p, idx) => (p.op === " " ? -1 : idx)).filter((idx) => idx >= 0);
  for (let c = 0; c < changed.length;) {
    const start = Math.max(0, changed[c] - context);
    let last = changed[c];
    c += 1;
    while (c < changed.length && changed[c] - last <= context * 2 + 1) { last = changed[c]; c += 1; }
    const end = Math.min(positions.length, last + 1 + context);
    const slice = positions.slice(start, end);
    const aCount = slice.filter((p) => p.op !== "+").length;
    const bCount = slice.filter((p) => p.op !== "-").length;
    const aStart = slice.find((p) => p.op !== "+")?.a ?? positions[start].a;
    const bStart = slice.find((p) => p.op !== "-")?.b ?? positions[start].b;
    hunks.push(`@@ -${aCount ? aStart : aStart - 1},${aCount} +${bCount ? bStart : bStart - 1},${bCount} @@\n${slice.map((p) => `${p.op}${p.line}`).join("\n")}`);
  }
  return hunks.length ? `${header}${hunks.join("\n")}\n` : "";
}

/**
 * Renders the diff of a change list from the blob store, redacted and bounded. Binary and secret-like files are listed,
 * never shown. Returns { text, truncated, added: [lines], removed: [lines] } (added/removed feed the integrity checks).
 */
export function renderChanges(changes, blobDir, { maxChars = 120000, readGit = null } = {}) {
  // A git-identified base entry ("git:<blob>", M05 git-backed snapshot) is read from the object database when available.
  const readSide = (side) => {
    if (!side) return "";
    if (String(side.sha256 || "").startsWith("git:")) return readGit ? readGit(side.sha256) : null;
    return side.text ? readBlob(blobDir, side.sha256) : null;
  };
  const parts = [];
  const added = [];
  const removed = [];
  for (const change of changes) {
    if (change.secretLike) { parts.push(`# ${change.status} ${change.path} (fișier sensibil: conținut neafișat)\n`); continue; }
    const beforeText = readSide(change.before);
    const afterText = readSide(change.after);
    if (beforeText === null || afterText === null) { parts.push(`# ${change.status} ${change.path} (binar sau indisponibil: doar hash ${change.after?.sha256?.slice(0, 12) || "—"})\n`); continue; }
    const diff = unifiedDiff(beforeText, afterText, { label: change.path, status: change.status });
    for (const line of diff.split("\n")) {
      if (line.startsWith("+") && !line.startsWith("+++ ")) added.push({ path: change.path, line: line.slice(1) });
      if (line.startsWith("-") && !line.startsWith("--- ")) removed.push({ path: change.path, line: line.slice(1) });
    }
    parts.push(diff);
  }
  const text = redactText(parts.join("\n"));
  return { text: text.slice(0, maxChars), truncated: text.length > maxChars, added, removed };
}
