// Pure policy checks plus explicitly invoked, metadata-only preflight operations. No work on import.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

export const STOP = "REHEARSAL_INTENTIONAL_STOP_BEFORE_WRITER";
export const MAIN_HUB = String.raw`C:\Users\mihai\OneDrive\Desktop\Ifrim Digital Proiecte\Ifrim Agent Hub`;
export const LIVE_DATA = String.raw`C:\Users\mihai\IfrimHub\hub-data`;
export const LIVE_FINGERPRINT = "0b85ddbd40f8b446";
export const HOME_ACL_APPROVAL = "2026-10-15T10:52:29Z";
export const HOME_ACL_APPROVAL_MESSAGE = "cmsg_01K9QSg2gnYKPNAzVSK811dNRJodqXTBP6rk51mLQTH4vg";
export const COMMIT_REPOSITORY = String.raw`C:\Users\mihai\hub-rc`;
export const CONSENT_PROVENANCE = Object.freeze({ kind: "AGENT_RECORDED_FROM_OWNER_TEXT",
  liveConsent: "0b85ddbd40f8b446 2026-10-03T18:29:02Z (home entries)",
  stagePrompt: "2026-10-15 §6: isolation only on experiment-dedicated paths" });
const pathApi = (p) => /^[a-z]:[\\/]|^\\\\/i.test(p) ? path.win32 : path;
export const pathKey = (p) => pathApi(p).resolve(p).replaceAll("\\", "/").replace(/\/$/, "").toLowerCase();
export const within = (root, target) => pathKey(target) === pathKey(root) || pathKey(target).startsWith(pathKey(root) + "/");
export const exactOrGlob = (rule, target) => {
  const source = pathKey(rule).split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*");
  return new RegExp(`^${source}$`).test(pathKey(target));
};
export const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");

export function classifyDenyEntries(entries, { parent, liveConsented = [] }) {
  const home = new Set(liveConsented.map(pathKey));
  return entries.map((entry) => ({ path: entry, classification: within(parent, entry) ? "dedicated" : home.has(pathKey(entry)) ? "home-consented" : "other" }));
}

export function ancestorPaths(target) {
  const api = pathApi(target), rows = [];
  for (let p = api.dirname(target); ; p = api.dirname(p)) {
    rows.push(p);
    if (api.dirname(p) === p) return rows;
  }
}

export function checkLayout({ parent, dedicatedRoot, hubRoot, projectDir, out, env = process.env, homeDir, realpath = null }) {
  if (!parent || !pathApi(parent).isAbsolute(parent)) throw new Error("--parent must be an absolute dedicated directory");
  const api = pathApi(parent);
  const forbidden = [String.raw`C:\Users\mihai\hub-rc`, String.raw`C:\Users\mihai\hub-rc2`, MAIN_HUB, LIVE_DATA,
    api.join(homeDir || String.raw`C:\Users\mihai`, "OneDrive"), env.OneDrive, env.OneDriveCommercial, env.OneDriveConsumer,
    env.LOCALAPPDATA, env.TEMP, env.TMP].filter(Boolean);
  forbidden.push(...[".codex", ".claude", ".openclaw", ".ssh", ".aws"].map((name) => api.join(homeDir || String.raw`C:\Users\mihai`, name)));
  // Also reject ancestors: sandbox ACLs on a parent must never encompass a protected project/home.
  const check = (p) => {
    if (forbidden.some((root) => within(root, p) || within(p, root)) || /(?:^|[\\/])OneDrive(?:[\\/]|$)/i.test(p))
      throw new Error(`Forbidden rehearsal parent: ${p}`);
  };
  check(parent);
  if (!dedicatedRoot || !api.isAbsolute(dedicatedRoot) || pathKey(api.dirname(parent)) !== pathKey(dedicatedRoot))
    throw new Error("Layout requires --dedicated-root <DEDICATED_ROOT> and --parent <DEDICATED_ROOT>/<run>");
  check(dedicatedRoot);
  const container = api.dirname(dedicatedRoot);
  if (pathKey(container) !== pathKey(homeDir || String.raw`C:\Users\mihai`) && container !== api.parse(container).root)
    throw new Error("Dedicated root must be directly under the home or drive root, created only for experiments");
  for (const [actual, name] of [[hubRoot, "hub"], [projectDir, "booking"], [out, "evidence"]]) {
    if (!actual || pathKey(actual) !== pathKey(api.join(parent, name))) throw new Error(`Layout requires <PARENT>/${name}`);
  }
  if (realpath) {
    if (pathKey(realpath(dedicatedRoot)) !== pathKey(dedicatedRoot)) throw new Error("Dedicated root must not resolve through a junction");
    check(realpath(parent));
    if (pathKey(realpath(parent)) !== pathKey(parent)) throw new Error("Rehearsal parent must not resolve through a junction");
    for (const actual of [hubRoot, projectDir, out]) if (pathKey(realpath(actual)) !== pathKey(actual)) throw new Error(`Layout resolves through a link: ${actual}`);
  }
  return { parent, dedicatedRoot, hubRoot, projectDir, out, forbidden, ancestors: ancestorPaths(parent) };
}

export function physicalPath(target) {
  if (fs.existsSync(target)) return fs.realpathSync(target);
  const ancestor = path.dirname(target);
  if (ancestor === target) throw new Error(`Cannot resolve layout: ${target}`);
  return path.join(physicalPath(ancestor), path.basename(target));
}

// Export bytes and committed blobs use the same canonical manifest; no node_modules traversal.
export function exportManifest(root, commit) {
  if (!/^[a-f0-9]{40}$/i.test(commit || "")) throw new Error("--commit requires a full commit SHA");
  const files = [];
  function walk(dir, rel = "") {
    for (const item of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
      if (!rel && item.name === "node_modules") continue;
      if (item.name === ".git") throw new Error("Export must not contain .git");
      const ref = rel ? `${rel}/${item.name}` : item.name, file = path.join(dir, item.name);
      if (item.isSymbolicLink()) throw new Error(`Export contains link: ${ref}`);
      if (item.isDirectory()) walk(file, ref);
      else if (item.isFile()) files.push({ path: ref, sha256: digest(fs.readFileSync(file)) });
      else throw new Error(`Unsupported export entry: ${ref}`);
    }
  }
  walk(root);
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return { commit, files, sha256: digest(JSON.stringify({ commit, files })) };
}
export function verifyManifest(manifest, expected) {
  if (!/^[a-f0-9]{64}$/i.test(expected || "") || manifest.sha256 !== expected.toLowerCase())
    throw new Error(`Export manifest mismatch: computed ${manifest.sha256}; expected ${expected || "missing"}`);
  return { ...manifest, expected, verified: true };
}

export function committedManifest(commit, { execute = execFileSync } = {}) {
  if (!/^[a-f0-9]{40}$/.test(commit || "")) throw new Error("--commit requires a full lowercase commit SHA");
  const git = (args) => execute("git", ["-C", COMMIT_REPOSITORY, ...args],
    { windowsHide: true, timeout: 30000, maxBuffer: 64 * 1024 * 1024 });
  const object = String(git(["cat-file", "-p", commit]));
  const tree = object.match(/^tree ([a-f0-9]{40})\r?\n/)?.[1];
  if (!tree) throw new Error("P1 supplied object is not a commit");
  const files = String(git(["ls-tree", "-r", "-z", "--full-tree", tree])).split("\0").filter(Boolean).map((entry) => {
    const match = entry.match(/^(100644|100755) blob ([a-f0-9]{40})\t([\s\S]+)$/);
    if (!match) throw new Error("P1 unsupported committed entry (only regular blobs allowed)");
    const [, , oid, ref] = match;
    return { path: ref, sha256: digest(git(["cat-file", "blob", oid])) };
  }).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return { commit, tree, repository: COMMIT_REPOSITORY, files, sha256: digest(JSON.stringify({ commit, files })) };
}

export function verifyCommitExport(root, commit, suppliedDigest, options) {
  const expected = committedManifest(commit, options);
  const actual = exportManifest(root, commit);
  const verified = verifyManifest(actual, expected.sha256);
  if (suppliedDigest !== undefined) verifyManifest(actual, suppliedDigest);
  return { ...verified, tree: expected.tree, repository: expected.repository,
    suppliedDigest: suppliedDigest || null, source: "independent git ls-tree / cat-file commit objects" };
}

// Exact ACE sets are compared, including deletions and missing targets. Home approvals are exact targets, not ancestors.
export function aclDiff(before, after, { allowed = [] } = {}) {
  const a = new Map(before.map((r) => [pathKey(r.path), r])), b = new Map(after.map((r) => [pathKey(r.path), r]));
  const canonical = (r) => JSON.stringify(r ? { exists: r.exists, aces: [...(r.aces || [])].sort(), error: r.error || null } : null);
  const changes = [];
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    const left = a.get(key), right = b.get(key), target = right?.path || left.path;
    if (canonical(left) !== canonical(right)) changes.push({ path: target, before: left || null, after: right || null,
      allowed: allowed.some((rule) => typeof rule === "string" ? exactOrGlob(rule, target) : rule.recursive ? within(rule.path, target) : pathKey(rule.path) === key) });
  }
  return { ok: changes.every((c) => c.allowed), changes, violations: changes.filter((c) => !c.allowed) };
}

export function predictHomeAclChanges(rows, { parent }) {
  return rows.filter((row) => !within(parent, row.path)).flatMap((row) => {
    if (row.glob || row.notInspected) return [];
    const aces = row.aces || [], group = aces.filter((a) => /(?:\\|^)CodexSandboxUsers:/i.test(a));
    const changes = [];
    if (row.error || row.exists === null) changes.push("ACL state unreadable; change cannot be bounded");
    if (row.exists === false) changes.push("missing target will be created as a directory");
    if (!group.some((a) => /\(DENY\)\(R\)/.test(a))) changes.push("explicit DENY(R) will be added");
    if ((row.exists === false || aces.some((a) => /\(OI\)|\(CI\)/.test(a))) && !group.some((a) => /\(OI\)\(CI\)\(IO\)\(DENY\)\(R,GR\)/.test(a))) changes.push("inheritable DENY(R,GR) will be added (directory targets)");
    const allow = group.filter((a) => !/\(I\)|\(DENY\)/.test(a));
    if (allow.length) changes.push(...allow.map((ace) => `explicit ALLOW will be removed: ${ace}`));
    return changes.length ? [{ path: row.path, changes, undo: [`icacls "${row.path}" /remove:d CodexSandboxUsers`,
      ...(allow.length ? [`icacls "${row.path}" /grant "CodexSandboxUsers:(OI)(CI)RX"`] : [])],
      caveat: "Undo is advisory only; created directories and non-RX permissions need owner review. No ACL command is applied by this driver." }] : [];
  });
}
export const validIso = (s) => typeof s === "string" && /^\d{4}-\d\d-\d\dT/.test(s) && Number.isFinite(Date.parse(s)) && Date.parse(s) <= Date.now();
export function requireHomeApproval(predictions, approval) {
  if (approval !== HOME_ACL_APPROVAL) throw new Error(`Before P7: explicit --home-acl-change-approved must equal ${HOME_ACL_APPROVAL}`);
}

export function parseAclOutput(raw, target) {
  // The first ACE follows the full target; account names themselves can contain spaces.
  return String(raw).split(/\r?\n/).flatMap((line) => {
    let value = line.trim();
    if (value.toLowerCase().startsWith(target.toLowerCase() + " ")) value = value.slice(target.length).trim();
    return /^[^:]+:\([^\r\n]*\)$/.test(value) ? [value] : [];
  });
}

export function parseAclSnapshot(raw, target) {
  if (!/[*?]/.test(target)) return [{ path: target, exists: true, aces: parseAclOutput(raw, target) }];
  const rows = []; let current;
  for (const line of String(raw).split(/\r?\n/)) {
    // Domain-qualified principals disambiguate a target containing spaces from an account containing spaces.
    const start = line.match(/^([A-Za-z]:[\\/].*?)\s+(?=(?:NT AUTHORITY|APPLICATION PACKAGE AUTHORITY|BUILTIN|[^\s\\:]+)\\[^\\:]+:\()/)
      || line.match(/^([A-Za-z]:[\\/].*?)\s+(?=(?:Everyone|CREATOR OWNER|S-1-[0-9-]+):\()/);
    if (start) { current = { path: start[1], exists: true, aces: [] }; rows.push(current); }
    if (current) current.aces.push(...parseAclOutput(line, current.path));
  }
  if (rows.some((r) => !exactOrGlob(target, r.path))) throw new Error(`Unexpected icacls expansion for ${target}`);
  return rows;
}

// Enumerate names only, never file contents; called only by explicit real mode (or fictive tests).
export function expandAclGlob(target) {
  if (credentialFolder(target)) throw new Error("home-consented glob, not expanded (credential folder)");
  const api = pathApi(target), directory = api.dirname(target);
  if (/[*?]/.test(directory)) throw new Error("ACL glob directories must be literal");
  try { return fs.readdirSync(directory).map((name) => api.join(directory, name)).filter((p) => exactOrGlob(target, p)); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
}

const credentialFolder = (target) => pathKey(target).match(/^(.*\/\.(?:codex|claude))(?:\/|$)/)?.[1];

export function snapshotAcls(targets, { execute = execFileSync, expand = expandAclGlob } = {}) {
  const snapshot = (target) => {
    try {
      target = pathApi(target).normalize(target);
      const raw = execute("icacls.exe", [target], { windowsHide: true, timeout: 30000, encoding: "utf8" });
      if (/Failed processing [1-9]\d* files/i.test(String(raw))) throw new Error(String(raw));
      const rows = parseAclSnapshot(raw, target);
      if (!rows.length || rows.some((r) => !r.aces.length)) throw new Error(`No ACEs returned for ${target}`);
      return rows;
    } catch (error) {
      const exact = `${error.message}\n${error.stdout || ""}\n${error.stderr || ""}`.trim();
      // Concrete absent targets are legitimate preflight predictions (the sandbox creates them).
      // A failure count alone never proves absence; glob expressions never reach this call.
      const missing = /cannot find|not found|nu poate găsi/i.test(exact);
      return { path: target, exists: missing ? false : null, glob: /[*?]/.test(target), aces: [], ...(missing ? { missingText: exact } : { error: exact }) };
    }
  };
  return [...new Set(targets)].flatMap((target) => {
    const credential = credentialFolder(target);
    if (credential && /[*?]/.test(target)) return [{ path: target, glob: true,
      status: "home-consented glob, not expanded (credential folder)", aces: [] }];
    if (credential && pathKey(target) !== credential) return [{ path: target,
      status: "credential-folder child, not inspected; directory ACL only", notInspected: true, aces: [] }];
    if (!/[*?]/.test(target)) return snapshot(target);
    try {
      const matches = expand(target);
      if (matches.some((p) => !exactOrGlob(target, p))) throw new Error("Unexpected glob expansion");
      return [{ path: target, glob: true, status: `glob — expanded ${matches.length} matches`, matches, aces: [] }, ...matches.flatMap(snapshot)];
    } catch (error) { return [{ path: target, glob: true, status: "glob — expansion refused", aces: [], error: error.message }]; }
  });
}

export function codexHeadroom(probe) {
  const u = probe?.usage, credits = u?.creditsReported;
  return Boolean(u && !u.error && u.windows?.length && u.windows.every((w) => Number.isFinite(w.usedPercent) && w.usedPercent >= 0 && w.usedPercent < 100)
    && !u.limitReached && !u.spendControlReached && u.ordinaryUsageAllowed !== false
    && credits && credits.unlimited === false
    && (typeof credits.balance === "number" || typeof credits.balance === "string" && credits.balance.trim() !== "")
    && Number.isFinite(Number(credits.balance)) && Number(credits.balance) === 0);
}
