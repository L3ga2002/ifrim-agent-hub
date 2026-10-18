import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { HubError } from "../core/errors.mjs";
import { hashCanonical } from "../core/canonical.mjs";
import { isSecretLikeName, isProtectedRelative } from "../security/paths.mjs";
import { gitIndexEntriesSync, gitChangedPathsSync, gitBlobSync, gitHeadSync, gitIgnoredFilesSync } from "../tools/git.mjs";

/**
 * Workspace snapshots for the Software Factory (M03 §13). A snapshot is a manifest of every file of the workspace
 * (path → sha256, size, text?) plus a content-addressed copy of each text file in the mission's blob store, so change sets,
 * reviews, QA evidence and the delivery bundle can name the exact version they saw — without any git write (v2/server
 * never runs a mutating git command) and without a commit.
 *
 * Never followed or copied: links/junctions, .git, dependency/build folders, the Hub's protected folders. Secret-like files
 * (.env, keys…) are recorded by size/mtime only (never read), so a writer that creates or edits one is still visible.
 * A tree over the limits is refused, not sampled.
 */
export const SNAPSHOT_LIMITS = Object.freeze({ maxFiles: 4000, maxBytes: 64 * 1024 * 1024, maxTextBytes: 512 * 1024, maxDepth: 12 });
export const SNAPSHOT_SKIP_DIRS = Object.freeze(new Set(["node_modules", ".git", "dist", "build", ".next", ".vite", "coverage", ".cache", ".turbo", "__pycache__", ".venv", "venv"]));

const sha = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");

/** Writes a blob once (content-addressed) and returns its sha256. */
function storeBlob(blobDir, buffer) {
  const digest = sha(buffer);
  const file = path.join(blobDir, digest.slice(0, 2), digest);
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, buffer);
  }
  return digest;
}

export function readBlob(blobDir, digest) {
  if (!/^[0-9a-f]{64}$/.test(String(digest || ""))) return null;
  try { return fs.readFileSync(path.join(blobDir, digest.slice(0, 2), digest), "utf8"); } catch { return null; }
}

/**
 * Takes a snapshot of `root`. Returns { files: {rel: entry}, skipped, stats, sha256 }. `blobDir` receives text contents.
 * Entries: { sha256, size, text: true } for text files, { sha256, size, text: false } for binaries,
 * { secretLike: true, size, mtimeMs } for secret-like names (not read).
 */
export function takeSnapshot(root, options = {}) {
  // A mission keeps the identity of its base snapshot: a git-backed base is compared only with git-backed snapshots and a
  // walked base only with walked ones (mixing them would report every clean file as modified).
  if (options.mode === "repository-index") return takeGitSnapshot(root, options);
  if (options.mode === "walk") return takeWalkSnapshot(root, options);
  try { return takeWalkSnapshot(root, options); }
  catch (error) {
    // A repository over the walk limit: the git-backed snapshot (M05 §15) reads only what git says may have changed.
    if (error.code === "SNAPSHOT_LIMIT" && fs.existsSync(path.join(root, ".git"))) return takeGitSnapshot(root, options);
    throw error;
  }
}

/** Limits of the git-backed snapshot: many tracked files, but only the changed/untracked ones are read and stored. */
export const GIT_SNAPSHOT_LIMITS = Object.freeze({ maxFiles: 50000, maxReadBytes: 64 * 1024 * 1024, maxTextBytes: 512 * 1024 });
const limitError = (message) => Object.assign(new HubError("validation", message), { code: "SNAPSHOT_LIMIT" });

/**
 * Git-backed snapshot (M05 §15): tracked files that git reports unchanged are identified by their index blob
 * ("git:<blob>", nothing read), every changed or untracked file is read, hashed and stored as in the walk snapshot. Same
 * exclusions (dependency/build folders, protected paths, secret-like names by size only, links never followed). The base
 * content of a git-identified file is read from the object database when a diff needs it (read-only git, no checkout).
 * The commit is recorded with the snapshot; nothing is committed, staged or reset.
 */
export function takeGitSnapshot(root, { blobDir, ignore = [], limits = GIT_SNAPSHOT_LIMITS } = {}) {
  const ignored = (rel) => ignore.some((p) => rel.toLowerCase() === p.toLowerCase() || rel.toLowerCase().startsWith(`${p.toLowerCase()}/`));
  const realRoot = fs.realpathSync.native(root);
  const index = gitIndexEntriesSync(realRoot);
  const status = index ? gitChangedPathsSync(realRoot) : null;
  if (!index || !status) throw new HubError("validation", "Workspace prea mare pentru snapshot-ul clasic, iar starea git nu a putut fi citită");
  const files = {};
  const skipped = [];
  let readBytes = 0;
  let tracked = 0;
  const excluded = (rel) => rel.split("/").slice(0, -1).some((p) => SNAPSHOT_SKIP_DIRS.has(p)) || isProtectedRelative(rel) || ignored(rel);
  const entryFor = (rel) => {
    const abs = path.join(realRoot, ...rel.split("/"));
    let st;
    try { st = fs.lstatSync(abs); } catch { return null; }
    if (st.isSymbolicLink()) { skipped.push({ path: rel, reason: "link" }); return null; }
    // A junction in the MIDDLE of the path is invisible to lstat: the real path must be the expected one.
    let real;
    try { real = fs.realpathSync.native(abs); } catch { return null; }
    if ((process.platform === "win32" ? real.toLowerCase() !== abs.toLowerCase() : real !== abs)) { skipped.push({ path: rel, reason: "link in path" }); return null; }
    if (!st.isFile()) return null;
    if (isSecretLikeName(path.basename(rel))) return { secretLike: true, size: st.size, mtimeMs: Math.round(st.mtimeMs) };
    return { st, abs };
  };
  // Files git may skip by stat (same size + reset mtime on Windows), or that carry index flags, are always read when they
  // matter most: tests, agent-control files, flagged entries (M05 security review F5).
  const alwaysRead = (rel, trusted) => !trusted || isTestPath(rel) || isControlPath(rel);
  for (const { path: rel, blob, trusted } of index) {
    if (excluded(rel)) continue;
    if (status.changed.has(rel) || alwaysRead(rel, trusted)) { status.changed.add(rel); continue; } // read below
    const e = entryFor(rel);
    if (!e) continue;
    tracked += 1;
    files[rel] = e.secretLike ? e : { sha256: `git:${blob}`, size: e.st.size, text: null, gitBlob: blob };
  }
  // Ignored files are invisible to git status: secret-like and agent-control names among them are still recorded
  // (secret-like by size/mtime, never read), like the walk snapshot does (M05 correctness review 7).
  for (const rel of gitIgnoredFilesSync(realRoot) || []) {
    if (rel.endsWith("/") || ignored(rel)) continue;
    const name = path.basename(rel);
    if (!(isSecretLikeName(name) || isControlPath(rel))) continue;
    if (rel.split("/").slice(0, -1).some((p) => SNAPSHOT_SKIP_DIRS.has(p))) continue;
    status.changed.add(rel);
  }
  for (const rel of [...status.changed, ...status.untracked]) {
    const e0 = !excluded(rel) || isSecretLikeName(path.basename(rel)) ? entryFor(rel) : null;
    if (e0?.secretLike) { files[rel] = e0; continue; }
    if (excluded(rel)) { skipped.push({ path: rel, reason: "excluded" }); continue; }
    const e = e0;
    if (!e) continue; // deleted in the working tree
    readBytes += e.st.size;
    if (readBytes > limits.maxReadBytes) throw new HubError("validation", `Prea multe modificări necomise pentru snapshot (peste ${Math.round(limits.maxReadBytes / 1048576)} MB citiți)`);
    const buffer = fs.readFileSync(e.abs);
    const isText = buffer.length <= limits.maxTextBytes && !buffer.includes(0);
    files[rel] = { sha256: isText && blobDir ? storeBlob(blobDir, buffer) : sha(buffer), size: buffer.length, text: isText };
  }
  if (Object.keys(files).length > limits.maxFiles) throw new HubError("validation", `Workspace prea mare și pentru snapshot-ul git (peste ${limits.maxFiles} fișiere)`);
  const ordered = Object.fromEntries(Object.keys(files).sort().map((k) => [k, files[k]]));
  return { files: ordered, skipped: skipped.slice(0, 200), stats: { files: Object.keys(ordered).length, bytes: readBytes, skipped: skipped.length, mode: "repository-index", gitTracked: tracked },
    sha256: hashCanonical(ordered), git: { head: gitHeadSync(realRoot), mode: "git-backed" } };
}

/** sha256 of a git-identified entry's content (for diffManifests' resolver), cached per process. */
const gitHashCache = new Map();
export function gitEntryHash(root, entry) {
  const m = /^git:([0-9a-f]{40,64})$/.exec(String(entry || ""));
  if (!m) return entry;
  if (!gitHashCache.has(m[1])) { const b = gitBlobSync(root, m[1]); gitHashCache.set(m[1], b ? sha(b) : null); if (gitHashCache.size > 50000) gitHashCache.clear(); }
  return gitHashCache.get(m[1]);
}

/** The content of a git-identified manifest entry ("git:<blob>"), read from the object database; null otherwise. */
export function readGitEntry(root, sha256) {
  const m = /^git:([0-9a-f]{40,64})$/.exec(String(sha256 || ""));
  if (!m) return null;
  const buffer = gitBlobSync(root, m[1]);
  if (!buffer || buffer.length > GIT_SNAPSHOT_LIMITS.maxTextBytes || buffer.includes(0)) return null;
  return buffer.toString("utf8");
}

function takeWalkSnapshot(root, { blobDir, limits = SNAPSHOT_LIMITS, ignore = [] } = {}) {
  const ignored = (rel) => ignore.some((p) => rel.toLowerCase() === p.toLowerCase() || rel.toLowerCase().startsWith(`${p.toLowerCase()}/`));
  const realRoot = fs.realpathSync.native(root);
  const files = {};
  const skipped = [];
  let count = 0;
  let bytes = 0;
  const queue = [{ dir: realRoot, rel: "", depth: 0 }];
  for (let i = 0; i < queue.length; i += 1) {
    const { dir, rel, depth } = queue[i];
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { skipped.push({ path: rel || ".", reason: "unreadable" }); continue; }
    for (const entry of entries) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (ignored(childRel)) { skipped.push({ path: childRel, reason: "ignored by spec (runtime data)" }); continue; }
      if (entry.isSymbolicLink()) { skipped.push({ path: childRel, reason: "link" }); continue; }
      if (entry.isDirectory()) {
        if (SNAPSHOT_SKIP_DIRS.has(entry.name) || isProtectedRelative(childRel)) { skipped.push({ path: childRel, reason: "excluded folder" }); continue; }
        if (depth + 1 > limits.maxDepth) throw new HubError("validation", `Workspace prea adânc pentru un snapshot M03 (peste ${limits.maxDepth} niveluri)`);
        queue.push({ dir: path.join(dir, entry.name), rel: childRel, depth: depth + 1 });
        continue;
      }
      if (!entry.isFile()) { skipped.push({ path: childRel, reason: "not a file" }); continue; }
      count += 1;
      if (count > limits.maxFiles) throw limitError(`Workspace prea mare pentru un snapshot M03 (peste ${limits.maxFiles} fișiere, fără node_modules/dist)`);
      const abs = path.join(dir, entry.name);
      let stat;
      try { stat = fs.statSync(abs); } catch { skipped.push({ path: childRel, reason: "unreadable" }); continue; }
      if (isSecretLikeName(entry.name) || isProtectedRelative(childRel)) {
        files[childRel] = { secretLike: true, size: stat.size, mtimeMs: Math.round(stat.mtimeMs) };
        continue;
      }
      bytes += stat.size;
      if (bytes > limits.maxBytes) throw limitError(`Workspace prea mare pentru un snapshot M03 (peste ${Math.round(limits.maxBytes / 1048576)} MB)`);
      const buffer = fs.readFileSync(abs);
      const isText = buffer.length <= limits.maxTextBytes && !buffer.includes(0);
      files[childRel] = { sha256: isText && blobDir ? storeBlob(blobDir, buffer) : sha(buffer), size: buffer.length, text: isText };
    }
  }
  const ordered = Object.fromEntries(Object.keys(files).sort().map((k) => [k, files[k]]));
  const stats = { files: Object.keys(ordered).length, bytes, skipped: skipped.length };
  return { files: ordered, skipped: skipped.slice(0, 200), stats, sha256: hashCanonical(ordered) };
}

/**
 * M11 L5 (§5.3): what a snapshot never reads — the dependency, build and cache folders (SNAPSHOT_SKIP_DIRS, at any depth) and the parts
 * of .git a run could plant code in (hooks/, info/, config) — as { entries: { rel: "f:size:mtimeMs" | "d:mtimeMs" | "l" }, truncated }.
 * Stat only (nothing is read or followed: a link is recorded as one), bounded by `maxEntries` (then `truncated`). The two proof runs of
 * a Hub-written test are bracketed by it, so a write the snapshot cannot see (node_modules/x/index.js, .git/hooks/pre-commit, .cache/…)
 * still makes the proof NOT_HERMETIC. Folders ignored by the spec (runtime data) and the Hub's protected folders are not walked.
 */
export function skippedTreeFingerprint(root, { ignore = [], maxEntries = 20000, maxDepth = 24 } = {}) {
  const ignored = (rel) => ignore.some((p) => rel.toLowerCase() === p.toLowerCase() || rel.toLowerCase().startsWith(`${p.toLowerCase()}/`));
  const realRoot = fs.realpathSync.native(root);
  const entries = {};
  let count = 0;
  let truncated = false;
  const record = (rel, value) => { if (count >= maxEntries) { truncated = true; return false; } entries[rel] = value; count += 1; return true; };
  // Directly inside a project's .git only these are recorded (git itself rewrites the index, logs and objects while the Hub reads it).
  const GIT_KEEP = new Set(["hooks", "info", "config"]);
  // inSkipped: under a recorded folder (everything below is recorded); gitTop: the entries directly in a .git folder.
  const queue = [{ dir: realRoot, rel: "", depth: 0, inSkipped: false, gitTop: false }];
  for (let i = 0; i < queue.length && !truncated; i += 1) {
    const { dir, rel, depth, inSkipped, gitTop } = queue[i];
    let list;
    try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { if (inSkipped) record(rel, "unreadable"); continue; }
    list.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of list) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (gitTop && !GIT_KEEP.has(entry.name)) continue;
      const regular = !inSkipped && !gitTop;
      // .git is a protected location for reading; here only its hooks/, info/ and config are stat-ed (never read).
      const isGit = regular && entry.isDirectory() && entry.name === ".git";
      if (regular && !isGit && (ignored(childRel) || isProtectedRelative(childRel))) continue;
      const recorded = inSkipped || gitTop || (regular && !isGit && entry.isDirectory() && SNAPSHOT_SKIP_DIRS.has(entry.name));
      if (entry.isSymbolicLink()) { if (recorded && !record(childRel, "l")) break; continue; }
      if (recorded) {
        let st;
        try { st = fs.lstatSync(path.join(dir, entry.name)); } catch { continue; }
        if (!record(childRel, st.isDirectory() ? `d:${Math.round(st.mtimeMs)}` : `f:${st.size}:${Math.round(st.mtimeMs)}`)) break;
      }
      if (entry.isDirectory() && depth + 1 <= maxDepth) queue.push({ dir: path.join(dir, entry.name), rel: childRel, depth: depth + 1, inSkipped: recorded, gitTop: isGit });
    }
  }
  return { entries, truncated };
}
/** The paths whose fingerprint differs (added, removed or changed); over a truncated side only the paths both recorded count. Sorted. */
export function skippedTreeChanges(before, after) {
  const a = before?.entries || {};
  const b = after?.entries || {};
  const partial = Boolean(before?.truncated || after?.truncated);
  const keys = partial ? Object.keys(a).filter((k) => Object.hasOwn(b, k)) : [...new Set([...Object.keys(a), ...Object.keys(b)])];
  return keys.filter((k) => a[k] !== b[k]).sort();
}

/** Test-file heuristic (path based): test/, tests/, __tests__/ folders and *.test.* / *.spec.* files. */
export const isTestPath = (rel) => /(^|\/)(test|tests|__tests__)\//i.test(rel) || /\.(test|spec)\.[cm]?[jt]sx?$/i.test(rel);

/**
 * Agent-control files a writer must not create or change (they would steer the next agent run or the Hub's checks):
 * provider configs, MCP definitions, agent instructions, and (M11 L5) the Hub's own work area .ifrim-hub/, where the Hub-written
 * acceptance test is staged before its review: a writer that created or changed it could swap the test the Hub then protects.
 * A change is reported as a critical integrity finding (the environment route refuses to apply it, workspace.mjs).
 */
export const isControlPath = (rel) => /^(\.codex\/|\.claude\/|\.mcp\.json$|AGENTS\.md$|CLAUDE\.md$|\.ifrim-hub-test\.json$|\.ifrim-hub\/)/i.test(rel);

/** Changes between two manifests: [{ path, status: added|modified|deleted, testFile, controlFile, secretLike, before, after }]. */
export function diffManifests(before = {}, after = {}, { resolve = null } = {}) {
  const changes = [];
  // A git-identified entry ("git:<blob>") and a content hash can name the same bytes: with a resolver the git side is
  // hashed (only for such pairs), so an owner's commit of an unchanged file is not a "modification".
  const content = (e) => (resolve && String(e?.sha256 || "").startsWith("git:") ? resolve(e.sha256) : e?.sha256);
  const same = (a, b) => (a?.secretLike || b?.secretLike ? a?.size === b?.size && a?.mtimeMs === b?.mtimeMs && Boolean(a?.secretLike) === Boolean(b?.secretLike)
    : a?.sha256 === b?.sha256 || (Boolean(resolve) && content(a) === content(b) && content(a) != null));
  for (const rel of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const a = before[rel];
    const b = after[rel];
    if (a && b && same(a, b)) continue;
    changes.push({ path: rel, status: !a ? "added" : !b ? "deleted" : "modified", testFile: isTestPath(rel), controlFile: isControlPath(rel),
      secretLike: Boolean(a?.secretLike || b?.secretLike), before: a ? { sha256: a.sha256 || null, size: a.size, text: Boolean(a.text) } : null,
      after: b ? { sha256: b.sha256 || null, size: b.size, text: Boolean(b.text) } : null });
  }
  return changes.sort((x, y) => x.path.localeCompare(y.path));
}
