import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { HubError } from "../core/errors.mjs";
import { newId } from "../core/ids.mjs";
import { json } from "../storage/db.mjs";
import { resolveInScope, isSecretLikeName, isProtectedRelative } from "../security/paths.mjs";
import { redactText } from "../security/redact.mjs";
import { gitState, gitDiff, gitLog, prepareCommitProposal } from "./git.mjs";
import { browserStatus, validateBrowserUrl, inspectPage } from "./browser.mjs";

/**
 * Shared tool registry. Every tool declares schema, permission tier, effects, timeout and what a
 * verifiable result looks like. Tools that are not available say so with the exact reason; there is
 * no universal shell or desktop endpoint.
 */
export const TOOL_DEFINITIONS = Object.freeze([
  { id: "files.list", tier: "READ_ONLY", effects: "none", timeoutMs: 5000, schema: { path: "string (relative)" }, result: "directory entries (secret-like names, protected paths and links leading out of scope hidden)", status: "available" },
  { id: "files.read", tier: "READ_ONLY", effects: "none", timeoutMs: 5000, schema: { path: "string (relative)", offset: "integer (bytes, default 0)", limit: "integer (bytes, ≤ 256 KB)" }, result: "one page of text (redacted), size, nextOffset", status: "available" },
  { id: "files.search", tier: "READ_ONLY", effects: "none", timeoutMs: 15000, schema: { query: "literal text (2–200 chars)", path: "string (relative, default .)", maxResults: "integer ≤ 200" }, result: "matching lines (redacted); protected paths, binaries and files > 1 MB are skipped", status: "available" },
  { id: "git.status", tier: "READ_ONLY", effects: "none", timeoutMs: 10000, schema: {}, result: "branch, head, dirty, untracked", status: "available" },
  { id: "git.diff", tier: "READ_ONLY", effects: "none", timeoutMs: 10000, schema: {}, result: "redacted unified diff (secret paths excluded)", status: "available" },
  { id: "git.log", tier: "READ_ONLY", effects: "none", timeoutMs: 10000, schema: { limit: "integer" }, result: "commits", status: "available" },
  { id: "git.prepareCommit", tier: "READ_ONLY", effects: "none (proposal only)", timeoutMs: 10000, schema: { summary: "string" }, result: "commit message + file list; never executed", status: "available" },
  { id: "preview.check", tier: "READ_ONLY", effects: "local HTTP GET", timeoutMs: 8000, schema: { url: "http://127.0.0.1|localhost URL" }, result: "status code, latency, <title>", status: "available" },
  { id: "process.run", tier: "DEVELOPMENT_TOOLS", effects: "runs an npm script of the project locally", timeoutMs: 600000, schema: { script: "test | build | test:v2" }, result: "exit code, duration, output tail", status: "available (approval per exact command)" },
  { id: "process.list", tier: "READ_ONLY", effects: "none", timeoutMs: 1000, schema: {}, result: "Hub-owned child processes", status: "available" },
  { id: "browser.inspect", tier: "DEVELOPMENT_TOOLS", effects: "runs a headless local browser in a fresh isolated context", timeoutMs: 120000, schema: { url: "local URL with port (not the Hub)" }, result: "HTTP status, title, console errors, one screenshot, requests blocked outside the local origin", status: "dynamic" },
  { id: "desktop.control", tier: "SENSITIVE_ACTIONS", effects: "mouse/keyboard on the shared desktop", timeoutMs: 0, schema: {}, result: "n/a", status: "blocked", reason: "A Windows desktop bridge is not built. It needs a native component, a single-controller lock and your approval." },
  { id: "screen.capture", tier: "SENSITIVE_ACTIONS", effects: "captures the screen", timeoutMs: 0, schema: {}, result: "n/a", status: "blocked", reason: "Screen capture is off; recording the screen needs explicit consent and retention rules." },
]);

const RUNNABLE_SCRIPTS = new Set(["test", "build", "test:v2", "build:v2"]);

const SEARCH_SKIP_DIRS = new Set(["node_modules", "dist", "build", ".next", ".vite", "coverage", ".cache", ".turbo", "__pycache__", ".venv", "venv"]);

/**
 * Literal text search inside a project. Protected paths (.ifrim/private, BACKUPS, tmp, .git, secret-like names),
 * dependency/build folders, symlinks/junctions, binaries and files over 1 MB are skipped; lines are redacted.
 */
export function searchFiles(rootPath, { query, path: start = ".", maxResults = 100 } = {}) {
  const needle = String(query || "");
  if (needle.length < 2 || needle.length > 200) throw new HubError("validation", "Search text must be 2–200 characters");
  const root = fs.realpathSync.native(rootPath);
  const base = resolveInScope(root, start);
  const limit = Math.max(1, Math.min(200, Number(maxResults) || 100));
  const lowerNeedle = needle.toLowerCase();
  const matches = [];
  let scanned = 0; let skipped = 0; let truncated = false;
  const stack = [base];
  const started = Date.now();
  while (stack.length && !truncated) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { skipped += 1; continue; }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      const rel = path.relative(root, abs);
      if (entry.isSymbolicLink() || isProtectedRelative(rel) || isSecretLikeName(entry.name)) { skipped += 1; continue; }
      if (entry.isDirectory()) { if (!SEARCH_SKIP_DIRS.has(entry.name)) stack.push(abs); continue; }
      if (!entry.isFile()) continue;
      let stat;
      try { stat = fs.statSync(abs); } catch { skipped += 1; continue; }
      if (stat.size > 1024 * 1024) { skipped += 1; continue; }
      const buffer = fs.readFileSync(abs);
      if (buffer.includes(0)) { skipped += 1; continue; }
      scanned += 1;
      const lines = buffer.toString("utf8").split(/\r?\n/);
      for (let i = 0; i < lines.length; i += 1) {
        if (!lines[i].toLowerCase().includes(lowerNeedle)) continue;
        matches.push({ path: rel.split(path.sep).join("/"), line: i + 1, text: redactText(lines[i].slice(0, 300)) });
        if (matches.length >= limit) { truncated = true; break; }
      }
      if (truncated || Date.now() - started > 10000) { truncated = true; break; }
    }
  }
  return { query: needle, matches, scanned, skipped, truncated };
}

/**
 * One directory level of a project. Secret-like names and protected paths are hidden by name; a symlink/junction is judged
 * by where it really leads (resolved with resolveInScope, never opened or read): one into a protected location, outside the
 * project or dangling is hidden too, so even its name does not leak. A link that stays in scope is listed with its target's
 * type and `link: true`, and can be opened because resolveInScope accepts it.
 */
export function listDirectory(rootPath, relative = ".") {
  const root = fs.realpathSync.native(rootPath);
  const dir = resolveInScope(root, relative);
  if (!fs.statSync(dir).isDirectory()) throw new HubError("validation", "Not a directory");
  const entries = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = path.relative(root, path.join(dir, entry.name));
    if (isSecretLikeName(entry.name) || isProtectedRelative(rel)) continue;
    if (entry.isSymbolicLink()) {
      let target;
      try { target = fs.statSync(resolveInScope(root, rel)); } catch { continue; }
      entries.push({ name: entry.name, type: target.isDirectory() ? "dir" : target.isFile() ? "file" : "other", link: true });
      continue;
    }
    entries.push({ name: entry.name, type: entry.isDirectory() ? "dir" : entry.isFile() ? "file" : "other" });
  }
  entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));
  return { path: relative, entries: entries.slice(0, 1000) };
}

export function createTools({ db, bus, clock, projects, approvals, supervisor, config }) {
  function record(tool, args, runId, effects, fn) {
    const id = newId("tool");
    db.prepare("INSERT INTO tool_calls (id, run_id, tool, args_json, effects, status, started_at) VALUES (?, ?, ?, ?, ?, 'running', ?)")
      .run(id, runId, tool, json(args), effects, clock().toISOString());
    const finish = (status, result) => {
      db.prepare("UPDATE tool_calls SET status = ?, result_json = ?, finished_at = ? WHERE id = ?").run(status, json(result), clock().toISOString(), id);
      bus.emit({ type: status === "completed" ? "tool.completed" : "tool.failed", scopeType: "tool", scopeId: id, source: "hub", runId, payload: { tool, status } });
    };
    return Promise.resolve().then(fn).then((result) => { finish("completed", result); return { id, ...result }; },
      (error) => { finish("failed", { error: error.message }); throw error; });
  }

  function project(projectId) {
    const p = projects.get(projectId);
    if (!p) throw new HubError("not_found", "Project not found");
    return p;
  }

  async function invoke(toolId, projectId, args = {}, runId = null) {
    const def = definitions().find((t) => t.id === toolId);
    if (!def) throw new HubError("validation", "Unknown tool");
    if (def.status === "blocked" || def.status === "NEEDS_INSTALL_APPROVAL") throw new HubError("policy", def.reason);
    const p = project(projectId);
    switch (toolId) {
      case "browser.inspect": return requestBrowserRun(p, args.url);
      case "files.list": return record(toolId, args, runId, def.effects, () => listDirectory(p.path, args.path || "."));
      case "files.read": return record(toolId, args, runId, def.effects, () => {
        const file = resolveInScope(p.path, args.path || "");
        const stat = fs.statSync(file);
        if (!stat.isFile()) throw new HubError("validation", "Not a file");
        // Paged: large files and logs are read one window at a time, never loaded whole into the browser.
        const limit = Math.max(1024, Math.min(256 * 1024, Number(args.limit) || 128 * 1024));
        const offset = Math.max(0, Math.min(stat.size, Number(args.offset) || 0));
        const fd = fs.openSync(file, "r");
        try {
          const buffer = Buffer.alloc(Math.min(limit, stat.size - offset));
          const read = fs.readSync(fd, buffer, 0, buffer.length, offset);
          const slice = buffer.subarray(0, read);
          if (slice.includes(0)) throw new HubError("validation", "Binary file; not shown");
          const nextOffset = offset + read < stat.size ? offset + read : null;
          return { path: args.path, size: stat.size, offset, nextOffset, truncated: nextOffset !== null, content: redactText(slice.toString("utf8")) };
        } finally { fs.closeSync(fd); }
      });
      case "files.search": return record(toolId, args, runId, def.effects, () => searchFiles(p.path, args));
      case "git.status": return record(toolId, args, runId, def.effects, () => gitState(p.path));
      case "git.diff": return record(toolId, args, runId, def.effects, () => gitDiff(p.path));
      case "git.log": return record(toolId, args, runId, def.effects, async () => ({ commits: await gitLog(p.path, Number(args.limit) || 20) }));
      case "git.prepareCommit": return record(toolId, args, runId, def.effects, () => prepareCommitProposal(p.path, String(args.summary || "Update")));
      case "preview.check": return record(toolId, args, runId, def.effects, () => previewCheck(args.url));
      case "process.list": return { processes: supervisor.list() };
      case "process.run": return requestScriptRun(p, String(args.script || ""));
      default: throw new HubError("validation", "Tool not invocable");
    }
  }

  /** Running a project script needs an approval bound to the exact command, project and code version. */
  async function requestScriptRun(p, script) {
    if (!RUNNABLE_SCRIPTS.has(script)) throw new HubError("policy", `Only ${[...RUNNABLE_SCRIPTS].join(", ")} can be run from the Hub`);
    if (!p.executionAllowed) throw new HubError("policy", "Project not enabled for local execution");
    const state = await gitState(p.path);
    const action = { actionKind: "process.run", target: p.path, payload: { command: `npm run ${script}` }, codeVersion: state.head || "unknown",
      permissionTier: "DEVELOPMENT_TOOLS", scopeType: "project", scopeId: p.id };
    const approval = bus.transaction(() => approvals.request({ ...action, requestedBy: "user", ttlMinutes: 30 }));
    return { approvalRequired: true, approval };
  }

  /** Executes an approved script run after verifying the approval against the exact action. */
  async function executeApprovedScript(approvalId) {
    const approval = approvals.get(approvalId);
    if (!approval || approval.actionKind !== "process.run") throw new HubError("not_found", "Approval not found");
    const p = project(approval.scopeId);
    const state = await gitState(p.path);
    const script = String(approval.payload.command || "").replace(/^npm run /, "");
    approvals.consume(approvalId, { actionKind: "process.run", target: p.path, payload: { command: `npm run ${script}` },
      codeVersion: state.head || "unknown", permissionTier: "DEVELOPMENT_TOOLS", scopeType: "project", scopeId: p.id });
    const npmCli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
    return record(script.startsWith("test") ? "process.test" : "process.build", { script }, null, "local process", () => new Promise((resolve) => {
      const started = Date.now();
      const out = [];
      const rec = supervisor.start({ key: `tool-${approvalId}`, label: `npm run ${script}`, executable: process.execPath, args: [npmCli, "run", script], cwd: p.path,
        env: { NODE_ENV: "test", CI: "1" }, onStdoutLine: (line) => { out.push(redactText(line)); if (out.length > 400) out.shift(); } });
      const timer = setTimeout(() => supervisor.stop(rec.key), 600000);
      rec.exit.then((exit) => {
        clearTimeout(timer);
        supervisor.forget(rec.key);
        const tail = [...out, ...rec.stderrTail].slice(-120);
        resolve({ command: `npm run ${script}`, exitCode: exit.code, durationMs: Date.now() - started, outputTail: tail,
          summary: tail.filter((line) => /# (tests|pass|fail|skipped|todo)|✓|built in|error/i.test(line)).slice(-8) });
      });
    }));
  }

  /** Tool list with live status (browser.inspect depends on whether Playwright is installed). */
  function definitions() {
    return TOOL_DEFINITIONS.map((d) => {
      if (d.id !== "browser.inspect") return d;
      const s = browserStatus({ hubRoot: config.hubRoot });
      return { ...d, status: s.installed ? "available (approval per URL)" : "NEEDS_INSTALL_APPROVAL", reason: s.reason, approvalRequest: s.approvalRequest || null };
    });
  }

  const hubPorts = () => [config.port, 8011, 8012];

  /** A browser inspection needs an approval bound to the exact local URL (browser.inspect is ALWAYS_ASK). */
  function requestBrowserRun(p, rawUrl) {
    const url = validateBrowserUrl(rawUrl, { hubPorts: hubPorts() });
    const action = { actionKind: "browser.inspect", target: url, payload: { url }, codeVersion: "n/a", permissionTier: "DEVELOPMENT_TOOLS", scopeType: "project", scopeId: p.id };
    const approval = bus.transaction(() => approvals.request({ ...action, requestedBy: "user", ttlMinutes: 30 }));
    return { approvalRequired: true, approval };
  }

  async function executeApprovedBrowser(approvalId) {
    const approval = approvals.get(approvalId);
    if (!approval || approval.actionKind !== "browser.inspect") throw new HubError("not_found", "Approval not found");
    const url = validateBrowserUrl(approval.payload.url, { hubPorts: hubPorts() });
    approvals.consume(approvalId, { actionKind: "browser.inspect", target: url, payload: { url }, codeVersion: "n/a", permissionTier: "DEVELOPMENT_TOOLS", scopeType: "project", scopeId: approval.scopeId });
    return record("browser.inspect", { url }, null, "local headless browser", () => inspectPage({ url, hubRoot: config.hubRoot, hubPorts: hubPorts(), evidenceDir: path.join(config.dataDir, "browser-evidence") }));
  }

  return { get definitions() { return definitions(); }, invoke, executeApprovedScript, executeApprovedBrowser, browserStatus: () => browserStatus({ hubRoot: config.hubRoot }) };
}

function previewCheck(url) {
  let parsed;
  try { parsed = new URL(url); } catch { throw new HubError("validation", "Invalid URL"); }
  if (parsed.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)) {
    throw new HubError("policy", "Preview checks are limited to local http URLs");
  }
  return new Promise((resolve) => {
    const started = Date.now();
    const req = http.get(parsed, { timeout: 8000 }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { if (body.length < 65536) body += chunk; });
      res.on("end", () => resolve({ url: parsed.href, status: res.statusCode, latencyMs: Date.now() - started,
        title: (body.match(/<title>([^<]{0,200})<\/title>/i)?.[1] || "").trim(), contentType: res.headers["content-type"] || "" }));
    });
    req.on("timeout", () => { req.destroy(); resolve({ url: parsed.href, status: 0, error: "timeout", latencyMs: Date.now() - started }); });
    req.on("error", (error) => resolve({ url: parsed.href, status: 0, error: error.code || error.message, latencyMs: Date.now() - started }));
  });
}
