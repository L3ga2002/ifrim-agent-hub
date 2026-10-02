import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { HubError } from "../core/errors.mjs";
import { gitListFiles } from "../tools/git.mjs";
import { redactText } from "../security/redact.mjs";
import { isProtectedRelative } from "../security/paths.mjs";
import { SNAPSHOT_SKIP_DIRS, isControlPath } from "../factory/snapshot.mjs";


/**
 * Workspace transfer into an isolated environment and the validated way back (M05 §15–§17).
 *
 * In: the Hub selects the project files (git's view when the project is a repository, a walk otherwise), applies its own
 * exclusion policy on top (a .gitignore is not a security policy), reads each file once and records exactly what it sent
 * (path, size, sha256, executable bit). Nothing is mounted: the bytes travel as a tar stream.
 *
 * Out: what comes back is untrusted. validateExport() checks every entry against that baseline manifest (C14); only a fully
 * clean export becomes a change list. applyChanges() re-checks the project's current files against the same baseline (a
 * human edit in the meantime is a conflict, never overwritten), writes without following links, and rolls back on failure.
 */
export const TRANSFER_LIMITS = Object.freeze({ maxFiles: 20000, maxBytes: 256 * 1024 * 1024, maxFileBytes: 16 * 1024 * 1024 });
export const EXPORT_POLICY = Object.freeze({ maxChangedFiles: 500, maxChangedBytes: 64 * 1024 * 1024, maxDeletes: 50, maxPathChars: 400 });
/** Per-run scratch directory inside the environment workspace (TMPDIR for the run); never transferred back. */
export const RUN_TMP_DIR = ".ifrim-tmp";
/** Binary files the writer may add or change (assets); any other binary is refused (no executables or archives). */
export const BINARY_EXTENSIONS = Object.freeze(new Set(["png", "jpg", "jpeg", "gif", "webp", "ico", "bmp", "avif", "woff", "woff2", "ttf", "otf", "eot", "pdf"]));

const sha = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");
/**
 * Names that steer an agent, an editor or git when the owner opens the project: never written from an environment, at any
 * depth (a subfolder CLAUDE.md is loaded lazily by Claude Code; a .vscode task can run on folder open; a nested .git or
 * .gitmodules redirects git). Compared case-insensitively — Windows treats .GIT as .git.
 */
const GUARDED_SEGMENTS = new Set([".codex", ".claude", ".vscode", ".idea", ".devcontainer", ".husky", ".github", ".gitlab", ".circleci", ".ifrim"]);
// ".git" as a FILE is a gitfile redirect; a .git FOLDER (a writer's "git init") is ignored like a build folder (never applied).
const GUARDED_FILES = new Set([".git", "agents.md", "claude.md", ".mcp.json", ".gitmodules", ".gitattributes", ".ifrim-hub-test.json", "desktop.ini", "autorun.inf", ".npmrc", ".yarnrc", ".yarnrc.yml"]);
/** Files Windows Explorer or the shell acts on by themselves (an SMB fetch of an icon, a shortcut target): refused anywhere. */
const SHELL_ACTIVE = /\.(?:scf|url|lnk|pif|library-ms|search-ms|searchconnector-ms|settingcontent-ms|application|appref-ms|desklink)$/i;
const AGENT_CONFIG = /^(\.codex|\.claude)(\/|$)|^\.mcp\.json$/i;
const segmentsOf = (rel) => String(rel).split("/").map((s) => s.normalize("NFC").toLowerCase());
/** Why an exported path must never be written into the project (null when it may be): checked at every depth. */
export function guardedPath(rel) {
  const parts = segmentsOf(rel);
  if (parts.some((p) => /~\d/.test(p))) return "nume scurt 8.3 de Windows (de ex. GIT~1 = .git): ar putea ținti alt folder";
  if (parts.slice(0, -1).some((p) => GUARDED_SEGMENTS.has(p)) || GUARDED_SEGMENTS.has(parts.at(-1))) return `folder de control (${parts.find((p) => GUARDED_SEGMENTS.has(p))}) la orice adâncime`;
  if (GUARDED_FILES.has(parts.at(-1))) return `fișier de control (${parts.at(-1)}) la orice adâncime`;
  if (SHELL_ACTIVE.test(parts.at(-1))) return "fișier pe care Windows îl execută sau îl încarcă singur (scurtătură, .url, .scf, .library-ms…)";
  return null;
}

/**
 * Inside a dependency/build folder (the same list the factory snapshot skips) or the run's scratch folder: never sent in,
 * and ignored (counted, not applied) when it comes back — like the Windows snapshot, which does not see these folders either.
 */
export const isRegenerablePath = (rel) => {
  // Case-insensitive (Windows: Node_Modules IS node_modules) and NFC-normalized.
  const parts = segmentsOf(rel);
  return parts.slice(0, -1).some((p) => SNAPSHOT_SKIP_DIRS.has(p)) || parts[0] === RUN_TMP_DIR;
};

/**
 * Why a project-relative path never enters the environment (and therefore can never come back), or null.
 * Order matters only for the reported reason.
 */
export function transferExclusion(rel, { allowRegenerable = false } = {}) {
  if (!allowRegenerable && isRegenerablePath(rel)) return "dependențe, artefacte de build sau directorul temporar al rulării (regenerabile)";
  if (rel.split("/")[0].toLowerCase() === RUN_TMP_DIR) return "nume rezervat pentru directorul temporar al mediului";
  if (/^\.ifrim(\/|$)/i.test(rel)) return "date ale Hub-ului";
  if (isProtectedRelative(rel)) return "protejat (date private, .git sau fișier de tip secret)";
  if (AGENT_CONFIG.test(rel)) return "configurație de agent (nu se încarcă în mediu)";
  return null;
}


function walkFileList(root, limit, skip) {
  const out = [];
  const queue = [""];
  while (queue.length) {
    const rel = queue.shift();
    let items;
    try { items = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { continue; }
    for (const item of items) {
      const childRel = rel ? `${rel}/${item.name}` : item.name;
      if (item.isDirectory()) {
        // A whole excluded folder (dependencies, .git, Hub data) is counted once, not walked.
        const why = transferExclusion(childRel) || (isRegenerablePath(`${childRel}/x`) ? "dependențe, artefacte de build sau directorul temporar al rulării (regenerabile)" : null);
        if (why) skip(`${why} (director)`); else queue.push(childRel);
        continue;
      }
      out.push(childRel);
      if (out.length > limit * 2) return out; // the limit check below reports it
    }
  }
  return out;
}

/**
 * The files that will enter the environment: [{ rel, abs, size, mode }], plus what was left out and why (counts only for
 * secret-like names: their names are not listed).
 */
export async function selectTransferFiles(projectRoot, { limits = TRANSFER_LIMITS } = {}) {
  const root = fs.realpathSync.native(projectRoot);
  const isRepo = fs.existsSync(path.join(root, ".git"));
  const skipped = {};
  const skip = (reason) => { skipped[reason] = (skipped[reason] || 0) + 1; };
  let candidates;
  let source = isRepo ? "repository" : "walk";
  let tracked = new Set();
  if (isRepo) {
    try {
      const lists = await gitListFiles(root, { split: true });
      tracked = new Set(lists.tracked);
      candidates = [...new Set([...lists.tracked, ...lists.others])];
    }
    catch (error) { throw new HubError("validation", `Lista de fișiere git nu a putut fi citită (${String(error.message).slice(0, 160)}); transferul nu pornește`); }
  } else candidates = walkFileList(root, limits.maxFiles, (reason) => skip(reason));
  const files = [];
  let bytes = 0;
  for (const raw of candidates) {
    const rel = raw.replace(/\\/g, "/");
    // A file the repository tracks under a build-like folder (src/build/x.js) is source: it travels (F8). Everything else
    // regenerable, and every protected or secret path, stays out.
    const trackedSource = tracked.has(rel) && !segmentsOf(rel).some((p) => p === "node_modules" || p === ".git");
    const why = transferExclusion(rel, { allowRegenerable: trackedSource });
    if (why) { skip(why); continue; }
    let st;
    try { st = fs.lstatSync(path.join(root, rel)); } catch { skip("lipsă din working tree"); continue; }
    if (st.isSymbolicLink()) { skip("legătură simbolică sau junction (nu se urmează)"); continue; }
    // lstat sees only the last component: a junction in the MIDDLE of the path (git lists files through it) would be
    // followed. The real path must be exactly the expected one inside the project (F2).
    if (!sameRealPath(root, rel)) { skip("cale prin junction sau legătură (nu se urmează)"); continue; }
    if (!st.isFile()) { skip("nu este fișier obișnuit"); continue; }
    if (st.size > limits.maxFileBytes) { skip(`fișier peste ${Math.round(limits.maxFileBytes / 1048576)} MB`); continue; }
    files.push({ rel, abs: path.join(root, rel), size: st.size, mode: st.mode & 0o111 ? 0o755 : 0o644 });
    bytes += st.size;
  }
  if (files.length > limits.maxFiles) throw new HubError("validation", `Proiectul are ${files.length} fișiere de transferat (limita ${limits.maxFiles}); transferul nu pornește`);
  if (bytes > limits.maxBytes) throw new HubError("validation", `Proiectul are ${Math.round(bytes / 1048576)} MB de transferat (limita ${Math.round(limits.maxBytes / 1048576)} MB); transferul nu pornește`);
  return { root, source, files: files.sort((a, b) => a.rel.localeCompare(b.rel)), skipped, bytes };
}

/** True when the real path of root/rel is exactly root/rel (case-insensitive on Windows): no link or junction on the way. */
export function sameRealPath(root, rel) {
  const expected = path.join(root, ...rel.split("/"));
  let real;
  try { real = fs.realpathSync.native(expected); } catch { return false; }
  return process.platform === "win32" ? real.toLowerCase() === expected.toLowerCase() : real === expected;
}

/** A secret written inside an ordinary-looking file (a PEM key, an API token…): the Hub's redaction patterns find it. */
const looksSecret = (data) => { if (data.length > 2 * 1024 * 1024) return false; const text = data.toString("utf8"); return redactText(text) !== text || /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text); };

/**
 * Async iterable for writeTar(): reads each selected file once and records what was actually sent in `manifest`
 * (rel → { sha256, size, mode }). A file that disappeared meanwhile is recorded as skipped, never invented.
 */
export function transferStream(selection, manifest, skipped = selection.skipped) {
  const skip = (why) => { skipped[why] = (skipped[why] || 0) + 1; };
  return (async function* stream() {
    for (const file of selection.files) {
      let data;
      // Checked again right before the read: a junction swapped in after the selection is not followed.
      if (!sameRealPath(selection.root, file.rel)) { skip("cale prin junction sau legătură (nu se urmează)"); continue; }
      try { data = await fs.promises.readFile(file.abs); } catch { skip("dispărut în timpul transferului"); continue; }
      if (looksSecret(data)) { skip("conținut de tip secret (cheie, token) — nu e trimis în mediu"); continue; }
      manifest[file.rel] = { sha256: sha(data), size: data.length, mode: file.mode };
      yield { name: file.rel, data, mode: file.mode };
    }
  })();
}

const RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$)(\..*)?$/i;

/**
 * Normalizes one tar entry name from the environment to a project-relative path, or explains why it is refused.
 * Returns { rel } | { root: true } | { problem }.
 */
export function normalizeExportName(rawName, { maxPathChars = EXPORT_POLICY.maxPathChars } = {}) {
  const name = String(rawName ?? "");
  if (name.includes("�")) return { problem: "nume care nu este UTF-8 valid" };
  if (/[\x00-\x1f\x7f]/.test(name)) return { problem: "nume cu caractere de control" };
  if (name.startsWith("/")) return { problem: "cale absolută" };
  if (name.includes("\\")) return { problem: "backslash în nume (separator Windows)" };
  let rel = name.replace(/^(\.\/)+/, "").replace(/\/+$/, "");
  if (rel === "" || rel === ".") return { root: true };
  if (rel.length > maxPathChars) return { problem: `cale mai lungă de ${maxPathChars} caractere` };
  const parts = rel.split("/");
  for (const part of parts) {
    if (part === "") return { problem: "segment gol în cale" };
    if (part === "." || part === "..") return { problem: "segment . sau .. (ieșire din workspace)" };
    if (/[<>:"|?*]/.test(part)) return { problem: part.includes(":") ? "„:” în nume (unitate de disc sau alternate data stream)" : "caracter interzis pe Windows în nume" };
    if (/[. ]$/.test(part)) return { problem: "nume terminat în punct sau spațiu (Windows l-ar redenumi)" };
    if (RESERVED.test(part)) return { problem: "nume rezervat de dispozitiv Windows" };
    if (Buffer.byteLength(part, "utf8") > 255) return { problem: "segment mai lung de 255 octeți" };
  }
  return { rel: parts.join("/") };
}

const caseKey = (rel) => rel.normalize("NFC").toLowerCase();
/** Binary = a NUL byte early on, or bytes that are not valid UTF-8 (files here are at most a few MB). */
export const isBinary = (data) => data.subarray(0, 8192).includes(0) || !isUtf8(data);
function isUtf8(buf) {
  try { new TextDecoder("utf-8", { fatal: true }).decode(buf); return true; } catch { return false; }
}
const extensionOf = (rel) => (rel.match(/\.([A-Za-z0-9]{1,8})$/)?.[1] || "").toLowerCase();

/**
 * C14 — the export validator. `read` is the tar reader result; `baseline` the manifest recorded at transfer; `staged` the
 * rel → { sha256, binary } map filled while reading (content stored by hash in the staging area). `protectedPaths` are the
 * project-relative files the writer must never change (approved acceptance tests). Returns
 * { ok, changes:[{ path, status, before, after }], refused:[{ path, reason }], problems:[], stats }.
 */
export function validateExport({ read, baseline, staged = {}, protectedPaths = [], policy = EXPORT_POLICY }) {
  const refused = [];
  const problems = [...(read.problems || [])];
  const refuse = (p, reason) => { if (refused.length < 200) refused.push({ path: String(p).slice(0, 300), reason }); };
  if (!read.complete) problems.push(read.aborted ? `export întrerupt: ${read.aborted}` : "exportul nu s-a terminat corect");
  const protectedSet = new Set(protectedPaths.map((p) => caseKey(String(p).replace(/\\/g, "/").replace(/^\.\//, ""))));
  const seen = new Map(); // caseKey → rel
  const exported = new Map(); // rel → entry
  let ignored = 0;
  const ignoredPaths = [];
  const baselineKeys = new Set(Object.keys(baseline).map(caseKey));
  // Folders that were sent in (every parent of a baseline file): their directory entries come back from tar even when
  // nothing in them changed (./.github/), and a directory carries no content of its own.
  const baselineDirs = new Set();
  for (const rel of Object.keys(baseline)) {
    const parts = rel.split("/");
    for (let i = 1; i < parts.length; i += 1) baselineDirs.add(caseKey(parts.slice(0, i).join("/")));
  }
  for (const entry of read.entries || []) {
    const n = normalizeExportName(entry.rawName, policy);
    if (n.root) continue;
    if (n.problem) { refuse(String(entry.rawName).replace(/^(\.\/)+/, ""), n.problem); continue; }
    const rel = n.rel;
    // Dependency/build output is regenerable and never applied (the Windows snapshot does not see it either); links and
    // other special entries there are still refused: they would be the same escape anywhere.
    const guarded = guardedPath(rel);
    // A regenerable folder (dependencies, build output, the run's scratch) is ignored — unless the file was sent in (tracked
    // source under such a folder) or the name is guarded (a .git there is still refused, never silently ignored).
    if (!guarded && !baselineKeys.has(caseKey(rel)) && (isRegenerablePath(rel) || (entry.typeName === "directory" && isRegenerablePath(`${rel}/x`)))) {
      if (entry.typeName !== "file" && entry.typeName !== "directory") refuse(rel, `tip ${entry.typeName} refuzat (doar fișiere obișnuite pot ieși din mediu)`);
      else { ignored += 1; if (ignoredPaths.length < 20 && entry.typeName === "file") ignoredPaths.push(rel); }
      continue;
    }
    // A .git FOLDER made in the environment (git init) is the environment's own scratch: ignored, never applied (its files are
    // regenerable above). A .git FILE (a gitdir redirect) stays refused below. Found before the first live probe: tar emits
    // "./.git/" as a directory entry, and that entry alone used to refuse the whole export.
    if (guarded && entry.typeName === "directory" && !baselineDirs.has(caseKey(rel)) && caseKey(rel.split("/").pop()) === ".git") { ignored += 1; continue; }
    // A guarded path that came back exactly as it was sent (an unchanged AGENTS.md, the ./.github/ folder entry of files that
    // were sent in) is not a change; anything else is refused.
    const unchangedGuarded = guarded && ((entry.typeName === "directory" && baselineDirs.has(caseKey(rel)))
      || (entry.typeName === "file" && baseline[rel] && baseline[rel].sha256 === entry.sha256 && Boolean(entry.mode & 0o111) === Boolean(baseline[rel].mode & 0o111)));
    if (guarded && !unchangedGuarded) { refuse(rel, guarded); continue; }
    const key = caseKey(rel);
    if (seen.has(key)) { refuse(rel, seen.get(key) === rel ? "intrare duplicată în arhivă" : `coliziune de majuscule/normalizare cu ${seen.get(key)} (pe Windows ar fi același fișier)`); continue; }
    seen.set(key, rel);
    for (const problem of entry.problems || []) refuse(rel, problem);
    if (entry.typeName === "directory") continue;
    if (entry.typeName !== "file") { refuse(rel, `tip ${entry.typeName} refuzat (doar fișiere obișnuite pot ieși din mediu)`); continue; }
    exported.set(rel, entry);
  }
  // Directory entries may name a path that is also a file elsewhere in the archive; files inside an exported "file" path are refused.
  const fileKeys = new Set([...exported.keys()].map(caseKey));
  for (const rel of exported.keys()) {
    const parts = rel.split("/");
    for (let i = 1; i < parts.length; i += 1) if (fileKeys.has(caseKey(parts.slice(0, i).join("/")))) refuse(rel, "cale sub un fișier (conflict fișier/director)");
  }

  const baselineByKey = new Map(Object.keys(baseline).map((rel) => [caseKey(rel), rel]));
  const changes = [];
  let changedBytes = 0;
  for (const [rel, entry] of exported) {
    const before = baseline[rel] || null;
    const caseTwin = !before && baselineByKey.get(caseKey(rel));
    if (caseTwin) { refuse(rel, `diferă doar prin majuscule de ${caseTwin} (pe Windows ar suprascrie alt fișier)`); continue; }
    const execNow = Boolean(entry.mode & 0o111);
    if (before && before.sha256 === entry.sha256) {
      if (execNow !== Boolean(before.mode & 0o111)) refuse(rel, "schimbare a bitului de execuție (permisiunile nu se modifică prin export)");
      continue;
    }
    // A file that was sent in (tracked source under a build-like folder) may change; a new one there was ignored above.
    const why = transferExclusion(rel, { allowRegenerable: Boolean(before) });
    if (why) { refuse(rel, `${why}: nu poate fi creat sau modificat din mediu`); continue; }
    if (isControlPath(rel) || guardedPath(rel)) { refuse(rel, guardedPath(rel) || "fișier de control al agenților (AGENTS.md, CLAUDE.md, .ifrim-hub-test.json…)"); continue; }
    if (protectedSet.has(caseKey(rel))) { refuse(rel, "test de acceptanță protejat (aprobat în specificație)"); continue; }
    if (before && execNow !== Boolean(before.mode & 0o111)) { refuse(rel, "schimbare a bitului de execuție (permisiunile nu se modifică prin export)"); continue; }
    if (entry.size > (policy.maxFileBytes ?? Infinity)) { refuse(rel, "fișier peste limită"); continue; }
    const stagedEntry = staged[rel];
    if (!stagedEntry || stagedEntry.sha256 !== entry.sha256) { refuse(rel, "conținutul nu a fost păstrat în zona de staging"); continue; }
    if (stagedEntry.binary && !BINARY_EXTENSIONS.has(extensionOf(rel))) { refuse(rel, `fișier binar cu extensia „${extensionOf(rel) || "—"}” (sunt acceptate doar imagini, fonturi și PDF)`); continue; }
    changedBytes += entry.size;
    changes.push({ path: rel, status: before ? "modified" : "added", before: before ? { sha256: before.sha256, size: before.size } : null,
      after: { sha256: entry.sha256, size: entry.size, binary: Boolean(stagedEntry.binary) } });
  }
  const exportedKeys = new Set([...exported.keys()].map(caseKey));
  const deletions = Object.keys(baseline).filter((rel) => !exportedKeys.has(caseKey(rel)));
  for (const rel of deletions) {
    if (isControlPath(rel) || guardedPath(rel)) { refuse(rel, `ștergerea unui fișier protejat (${guardedPath(rel) || "control al agenților"})`); continue; }
    if (protectedSet.has(caseKey(rel))) { refuse(rel, "ștergerea unui test de acceptanță protejat"); continue; }
    changes.push({ path: rel, status: "deleted", before: { sha256: baseline[rel].sha256, size: baseline[rel].size }, after: null });
  }
  const added = changes.filter((c) => c.status === "added").length;
  const modified = changes.filter((c) => c.status === "modified").length;
  const deleted = changes.filter((c) => c.status === "deleted").length;
  if (changes.length > policy.maxChangedFiles) problems.push(`${changes.length} fișiere schimbate (limita ${policy.maxChangedFiles})`);
  if (changedBytes > policy.maxChangedBytes) problems.push(`${Math.round(changedBytes / 1048576)} MB schimbați (limita ${Math.round(policy.maxChangedBytes / 1048576)} MB)`);
  if (deleted > policy.maxDeletes) problems.push(`${deleted} ștergeri (limita ${policy.maxDeletes})`);
  const ok = problems.length === 0 && refused.length === 0;
  return { ok, changes: changes.sort((a, b) => a.path.localeCompare(b.path)), refused, problems,
    stats: { entries: (read.entries || []).length, files: exported.size, ignoredRegenerable: ignored, ignoredNewFiles: ignoredPaths, added, modified, deleted, changedBytes, archiveBytes: read.bytes || 0 } };
}

/** Records one exported file in the staging area (content-addressed) when it differs from the baseline. */
export function stageExportFile({ stagingDir, baseline, staged }) {
  return (entry, data) => {
    const n = normalizeExportName(entry.rawName);
    if (!n.rel) return;
    if (baseline[n.rel]?.sha256 === entry.sha256) return; // unchanged: nothing to keep
    const file = path.join(stagingDir, "blobs", entry.sha256);
    if (!fs.existsSync(file)) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data, { flag: "wx" }); }
    staged[n.rel] = { sha256: entry.sha256, binary: isBinary(data) };
  };
}

/**
 * Resolves `rel` under `rootReal` component by component: every existing component must be a real directory (no link,
 * junction or reparse point) and the final one, if present, a regular file. Returns { target, exists }.
 */
export function safeTarget(rootReal, rel) {
  const parts = rel.split("/");
  let current = rootReal;
  for (let i = 0; i < parts.length; i += 1) {
    current = path.join(current, parts[i]);
    let st;
    try { st = fs.lstatSync(current); } catch (error) {
      if (error.code === "ENOENT") return { target: path.join(rootReal, ...parts), exists: false };
      throw error;
    }
    if (st.isSymbolicLink()) throw new HubError("policy", `${parts.slice(0, i + 1).join("/")} este o legătură sau junction: exportul nu scrie prin ea`);
    if (i < parts.length - 1 && !st.isDirectory()) throw new HubError("policy", `${parts.slice(0, i + 1).join("/")} nu este director`);
    if (i === parts.length - 1 && !st.isFile()) throw new HubError("policy", `${rel} există dar nu este fișier obișnuit`);
  }
  return { target: current, exists: true };
}

/** A different-case sibling already on disk (Windows would treat it as the same file). */
function caseSibling(target) {
  try {
    const base = path.basename(target);
    const found = fs.readdirSync(path.dirname(target)).find((name) => name !== base && caseKey(name) === caseKey(base));
    return found || null;
  } catch { return null; }
}

/**
 * Applies validated changes to the project. Every touched path is checked against the baseline FIRST (human edits since
 * the transfer are conflicts: nothing is written); originals are kept in staging; any write failure rolls back what was
 * written. Returns { applied, conflicts:[{ path, reason }], rolledBack }.
 */
export function applyChanges({ projectRoot, changes, stagingDir }) {
  const rootReal = fs.realpathSync.native(projectRoot);
  const conflicts = [];
  const plan = [];
  for (const change of changes) {
    let resolved;
    try { resolved = safeTarget(rootReal, change.path); } catch (error) { conflicts.push({ path: change.path, reason: error.message }); continue; }
    const current = resolved.exists ? sha(fs.readFileSync(resolved.target)) : null;
    if (change.status === "added") {
      if (resolved.exists) { conflicts.push({ path: change.path, reason: "fișierul a apărut în proiect după transfer" }); continue; }
      const twin = caseSibling(resolved.target);
      if (twin) { conflicts.push({ path: change.path, reason: `există deja ${twin} (diferă doar prin majuscule)` }); continue; }
    } else if (current !== change.before.sha256) {
      conflicts.push({ path: change.path, reason: resolved.exists ? "fișierul a fost modificat în proiect după transfer" : "fișierul a fost șters din proiect după transfer" });
      continue;
    }
    plan.push({ change, target: resolved.target, exists: resolved.exists });
  }
  if (conflicts.length) return { applied: 0, conflicts, rolledBack: false };

  const origDir = path.join(stagingDir, "orig");
  fs.mkdirSync(origDir, { recursive: true });
  const done = [];
  try {
    plan.forEach((step, i) => {
      if (step.exists) fs.copyFileSync(step.target, path.join(origDir, String(i)));
      const createdDirs = [];
      if (step.change.status !== "deleted") {
        // Parent directories are created one by one and re-checked: a link swapped in meanwhile is refused.
        const rel = path.relative(rootReal, path.dirname(step.target));
        let dir = rootReal;
        for (const part of rel ? rel.split(path.sep) : []) {
          dir = path.join(dir, part);
          try { const st = fs.lstatSync(dir); if (st.isSymbolicLink() || !st.isDirectory()) throw new HubError("policy", `${part}: nu este director obișnuit`); }
          catch (error) { if (error.code !== "ENOENT") throw error; fs.mkdirSync(dir); createdDirs.push(dir); }
        }
        const data = fs.readFileSync(path.join(stagingDir, "blobs", step.change.after.sha256));
        if (sha(data) !== step.change.after.sha256) throw new HubError("integrity", `${step.change.path}: conținutul din staging nu mai corespunde hash-ului validat`);
        const tmp = `${step.target}.ifrim-apply-${crypto.randomBytes(4).toString("hex")}`;
        try { fs.writeFileSync(tmp, data, { flag: "wx" }); fs.renameSync(tmp, step.target); }
        catch (error) { fs.rmSync(tmp, { force: true }); for (const dir of createdDirs.reverse()) { try { fs.rmdirSync(dir); } catch { /* not empty */ } } throw error; }
      } else {
        // Re-checked right before the delete: a junction swapped in after planning is never followed.
        safeTarget(rootReal, step.change.path);
        fs.unlinkSync(step.target);
      }
      done.push({ ...step, index: i, createdDirs });
    });
  } catch (error) {
    for (const step of done.reverse()) {
      try {
        if (step.exists) fs.copyFileSync(path.join(origDir, String(step.index)), step.target);
        else fs.rmSync(step.target, { force: true });
        for (const dir of step.createdDirs.reverse()) { try { fs.rmdirSync(dir); } catch { /* not empty */ } }
      } catch { /* reported below */ }
    }
    return { applied: 0, conflicts: [{ path: "*", reason: `aplicarea a eșuat și a fost anulată: ${String(error.message).slice(0, 200)}` }], rolledBack: true };
  }
  // Read back: what is on disk now is exactly what was validated; otherwise everything is rolled back.
  const mismatch = plan.find((step) => (step.change.status === "deleted" ? fs.existsSync(step.target) : (() => { try { return sha(fs.readFileSync(step.target)) !== step.change.after.sha256; } catch { return true; } })()));
  if (mismatch) {
    for (const step of done.reverse()) {
      try { if (step.exists) fs.copyFileSync(path.join(origDir, String(step.index)), step.target); else fs.rmSync(step.target, { force: true }); } catch { /* reported */ }
    }
    return { applied: 0, conflicts: [{ path: mismatch.change.path, reason: "conținutul de pe disc diferă după aplicare; totul a fost anulat" }], rolledBack: true };
  }
  return { applied: plan.length, conflicts: [], rolledBack: false };
}
