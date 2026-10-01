import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { HubError } from "../core/errors.mjs";
import { hashCanonical } from "../core/canonical.mjs";
import { isSecretLikeName, isProtectedRelative } from "../security/paths.mjs";

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
export function takeSnapshot(root, { blobDir, limits = SNAPSHOT_LIMITS, ignore = [] } = {}) {
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
      if (count > limits.maxFiles) throw new HubError("validation", `Workspace prea mare pentru un snapshot M03 (peste ${limits.maxFiles} fișiere, fără node_modules/dist)`);
      const abs = path.join(dir, entry.name);
      let stat;
      try { stat = fs.statSync(abs); } catch { skipped.push({ path: childRel, reason: "unreadable" }); continue; }
      if (isSecretLikeName(entry.name) || isProtectedRelative(childRel)) {
        files[childRel] = { secretLike: true, size: stat.size, mtimeMs: Math.round(stat.mtimeMs) };
        continue;
      }
      bytes += stat.size;
      if (bytes > limits.maxBytes) throw new HubError("validation", `Workspace prea mare pentru un snapshot M03 (peste ${Math.round(limits.maxBytes / 1048576)} MB)`);
      const buffer = fs.readFileSync(abs);
      const isText = buffer.length <= limits.maxTextBytes && !buffer.includes(0);
      files[childRel] = { sha256: isText && blobDir ? storeBlob(blobDir, buffer) : sha(buffer), size: buffer.length, text: isText };
    }
  }
  const ordered = Object.fromEntries(Object.keys(files).sort().map((k) => [k, files[k]]));
  const stats = { files: Object.keys(ordered).length, bytes, skipped: skipped.length };
  return { files: ordered, skipped: skipped.slice(0, 200), stats, sha256: hashCanonical(ordered) };
}

/** Test-file heuristic (path based): test/, tests/, __tests__/ folders and *.test.* / *.spec.* files. */
export const isTestPath = (rel) => /(^|\/)(test|tests|__tests__)\//i.test(rel) || /\.(test|spec)\.[cm]?[jt]sx?$/i.test(rel);

/**
 * Agent-control files a writer must not create or change (they would steer the next agent run or the Hub's checks):
 * provider configs, MCP definitions, agent instructions. A change is reported as a critical integrity finding.
 */
export const isControlPath = (rel) => /^(\.codex\/|\.claude\/|\.mcp\.json$|AGENTS\.md$|CLAUDE\.md$|\.ifrim-hub-test\.json$)/i.test(rel);

/** Changes between two manifests: [{ path, status: added|modified|deleted, testFile, controlFile, secretLike, before, after }]. */
export function diffManifests(before = {}, after = {}) {
  const changes = [];
  const same = (a, b) => (a?.secretLike || b?.secretLike ? a?.size === b?.size && a?.mtimeMs === b?.mtimeMs && Boolean(a?.secretLike) === Boolean(b?.secretLike) : a?.sha256 === b?.sha256);
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
