import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { HubError } from "../core/errors.mjs";
import { newId } from "../core/ids.mjs";
import { json } from "../storage/db.mjs";
import { resolveInScope, isSecretLikeName } from "../security/paths.mjs";
import { redactText } from "../security/redact.mjs";
import { gitState, gitDiff, gitLog, prepareCommitProposal } from "./git.mjs";

/**
 * Shared tool registry. Every tool declares schema, permission tier, effects, timeout and what a
 * verifiable result looks like. Tools that are not available say so with the exact reason; there is
 * no universal shell or desktop endpoint.
 */
export const TOOL_DEFINITIONS = Object.freeze([
  { id: "files.list", tier: "READ_ONLY", effects: "none", timeoutMs: 5000, schema: { path: "string (relative)" }, result: "directory entries (secret-like names hidden)", status: "available" },
  { id: "files.read", tier: "READ_ONLY", effects: "none", timeoutMs: 5000, schema: { path: "string (relative)" }, result: "text (redacted), size, sha256 not exposed for private paths", status: "available" },
  { id: "git.status", tier: "READ_ONLY", effects: "none", timeoutMs: 10000, schema: {}, result: "branch, head, dirty, untracked", status: "available" },
  { id: "git.diff", tier: "READ_ONLY", effects: "none", timeoutMs: 10000, schema: {}, result: "redacted unified diff (secret paths excluded)", status: "available" },
  { id: "git.log", tier: "READ_ONLY", effects: "none", timeoutMs: 10000, schema: { limit: "integer" }, result: "commits", status: "available" },
  { id: "git.prepareCommit", tier: "READ_ONLY", effects: "none (proposal only)", timeoutMs: 10000, schema: { summary: "string" }, result: "commit message + file list; never executed", status: "available" },
  { id: "preview.check", tier: "READ_ONLY", effects: "local HTTP GET", timeoutMs: 8000, schema: { url: "http://127.0.0.1|localhost URL" }, result: "status code, latency, <title>", status: "available" },
  { id: "process.run", tier: "DEVELOPMENT_TOOLS", effects: "runs an npm script of the project locally", timeoutMs: 600000, schema: { script: "test | build | test:v2" }, result: "exit code, duration, output tail", status: "available (approval per exact command)" },
  { id: "process.list", tier: "READ_ONLY", effects: "none", timeoutMs: 1000, schema: {}, result: "Hub-owned child processes", status: "available" },
  { id: "browser.inspect", tier: "DEVELOPMENT_TOOLS", effects: "drives a local browser", timeoutMs: 120000, schema: { url: "local URL" }, result: "screenshots, console", status: "blocked", reason: "Playwright is not installed; installing it downloads browsers (~150 MB+) and needs your approval." },
  { id: "desktop.control", tier: "SENSITIVE_ACTIONS", effects: "mouse/keyboard on the shared desktop", timeoutMs: 0, schema: {}, result: "n/a", status: "blocked", reason: "A Windows desktop bridge is not built. It needs a native component, a single-controller lock and your approval." },
  { id: "screen.capture", tier: "SENSITIVE_ACTIONS", effects: "captures the screen", timeoutMs: 0, schema: {}, result: "n/a", status: "blocked", reason: "Screen capture is off; recording the screen needs explicit consent and retention rules." },
]);

const RUNNABLE_SCRIPTS = new Set(["test", "build", "test:v2", "build:v2"]);

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
    const def = TOOL_DEFINITIONS.find((t) => t.id === toolId);
    if (!def) throw new HubError("validation", "Unknown tool");
    if (def.status === "blocked") throw new HubError("policy", def.reason);
    const p = project(projectId);
    switch (toolId) {
      case "files.list": return record(toolId, args, runId, def.effects, () => {
        const dir = resolveInScope(p.path, args.path || ".");
        const entries = fs.readdirSync(dir, { withFileTypes: true })
          .filter((e) => !isSecretLikeName(e.name) && !(dir === fs.realpathSync.native(p.path) && e.name === ".git"))
          .map((e) => ({ name: e.name, type: e.isDirectory() ? "dir" : e.isFile() ? "file" : "other" }))
          .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));
        return { path: args.path || ".", entries: entries.slice(0, 1000) };
      });
      case "files.read": return record(toolId, args, runId, def.effects, () => {
        const file = resolveInScope(p.path, args.path || "");
        const stat = fs.statSync(file);
        if (!stat.isFile()) throw new HubError("validation", "Not a file");
        if (stat.size > 512 * 1024) throw new HubError("validation", "File larger than 512 KB; open it in your editor");
        return { path: args.path, size: stat.size, content: redactText(fs.readFileSync(file, "utf8")) };
      });
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

  return { definitions: TOOL_DEFINITIONS, invoke, executeApprovedScript };
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
