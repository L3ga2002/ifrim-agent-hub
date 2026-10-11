#!/usr/bin/env node
// Simulated Codex app-server (JSONL JSON-RPC over stdio) for PASS_SIMULATED tests.
// It never contacts a network or a model. Scenario and log path come from argv.
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const opt = (name, fallback = "") => (args.find((a) => a.startsWith(`--${name}=`)) || "").split("=").slice(1).join("=") || fallback;
// Optional `--scenario-file=<path>`: a non-empty file overrides --scenario, so the simulator can switch scenarios per run.
const scenarioFromFile = () => { const file = opt("scenario-file"); try { return file ? fs.readFileSync(file, "utf8").trim() : ""; } catch { return ""; } };
// Optional `--scenario-queue=<path>`: each app-server process takes the FIRST line of the file (and removes it), so a whole
// multi-run flow (writer → reviewer → repair …) can be scripted in order. An empty queue falls back to the other options.
const scenarioFromQueue = () => {
  const file = opt("scenario-queue");
  if (!file || !args.includes("app-server")) return "";
  try {
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter((l) => l.trim());
    if (!lines.length) return "";
    fs.writeFileSync(file, lines.slice(1).join("\n"));
    return lines[0].trim();
  } catch { return ""; }
};
const scenario = scenarioFromQueue() || scenarioFromFile() || opt("scenario", "ok");
// The reasoning effort the Hub set for this process (-c model_reasoning_effort="…"); reported back by thread/start.
const effortOverride = ((args.find((a) => a.startsWith("model_reasoning_effort=")) || "").match(/"([^"]*)"/) || [])[1] || "";
const FACTORY_PATCHES = path.join(path.dirname(fileURLToPath(import.meta.url)), "factory-patches");
const logFile = opt("log");
const log = (entry) => { if (logFile) fs.appendFileSync(logFile, `${JSON.stringify(entry)}\n`); };
// M09: an optional model list override (see model/list below); a missing, empty or invalid file keeps the built-in list.
const modelsOverride = () => {
  const file = opt("models-file") || (logFile ? `${logFile}.models.json` : "");
  try {
    const list = file && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
    return Array.isArray(list) && list.length && list.every((m) => m && typeof m.id === "string") ? list : null;
  } catch { return null; }
};
// Optional `--log-env`: logs the NAMES (never the values) of the environment variables this process received.
if (args.includes("--log-env")) log({ envNames: Object.keys(process.env).sort(), invocation: args.includes("--version") ? "--version" : args.includes("app-server") ? "app-server" : "other" });

if (args.includes("--version")) { console.log("codex-cli 0.0.0-fake"); process.exit(0); }
// `codex sandbox … -C <dir> -- <command…>` (QA runner): runs the command in <dir> WITHOUT any real sandbox (fixture only) and
// logs the profile flags it received, so tests can check what the Hub would pass to the real sandbox.
if (args.includes("sandbox")) {
  const sep = args.indexOf("--");
  const cwdIndex = args.indexOf("-C");
  const command = sep >= 0 ? args.slice(sep + 1) : [];
  log({ sandbox: { profile: args[args.indexOf("-P") + 1] || null, cwd: cwdIndex >= 0 ? args[cwdIndex + 1] : null, command, windowsSandbox: args.some((a) => a.startsWith("windows.sandbox=")),
    networkOff: args.some((a) => a.includes("network={enabled=false}")) } });
  if (!command.length) { console.error("fake-codex sandbox: no command"); process.exit(2); }
  const r = spawnSync(command[0], command.slice(1), { cwd: cwdIndex >= 0 ? args[cwdIndex + 1] : process.cwd(), encoding: "utf8", windowsHide: true, timeout: 120000 });
  process.stdout.write(r.stdout || "");
  process.stderr.write(r.stderr || "");
  process.exit(r.status ?? 1);
}
if (!args.includes("app-server")) { console.error("fake-codex: unsupported"); process.exit(2); }
log({ launchArgs: args.filter((a) => !a.startsWith("--scenario=") && !a.startsWith("--log=")) });

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
let initialized = false;
let experimental = false;
let legaProject = "";
let threadId = "";
let serverRequestId = 1000;
const pendingServer = new Map();

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", async (line) => {
  const msg = JSON.parse(line);
  if (msg.id !== undefined && !msg.method) {
    const resolve = pendingServer.get(msg.id);
    if (resolve) { pendingServer.delete(msg.id); resolve(msg); }
    return;
  }
  log({ method: msg.method, params: msg.params });
  if (msg.method === "initialized") return;
  if (msg.method === "initialize") {
    initialized = true;
    experimental = Boolean(msg.params?.capabilities?.experimentalApi);
    return send({ id: msg.id, result: { codexHome: "C:\\fake", platformFamily: "windows", platformOs: "windows", userAgent: "fake/0" } });
  }
  if (!initialized) return send({ id: msg.id, error: { code: -32002, message: "Not initialized" } });
  // Realtime (Lega) is EXPERIMENTAL: refused unless initialize opted in, like the real app-server.
  if (String(msg.method).startsWith("thread/realtime/") && !experimental) return send({ id: msg.id, error: { code: -32600, message: `${msg.method} requires experimentalApi capability` } });
  if (String(msg.method).startsWith("thread/realtime/")) return realtime(msg);
  switch (msg.method) {
    case "account/read":
      if (scenario === "apikey") return send({ id: msg.id, result: { account: { type: "apiKey" }, requiresOpenaiAuth: true } });
      if (scenario === "noauth") return send({ id: msg.id, result: { account: null, requiresOpenaiAuth: true } });
      return send({ id: msg.id, result: { account: { type: "chatgpt", email: "someone@example.com", planType: "pro" }, requiresOpenaiAuth: true } });
    case "account/rateLimits/read": {
      const used = scenario === "quota" ? 95 : 12;
      return send({ id: msg.id, result: { rateLimits: { primary: { usedPercent: used, windowDurationMins: 300, resetsAt: 1790000000 }, secondary: { usedPercent: 5, windowDurationMins: 10080 }, planType: "pro", credits: { hasCredits: false, unlimited: false } }, ordinaryUsageAllowed: true } });
    }
    case "windowsSandbox/readiness":
      return send({ id: msg.id, result: { status: scenario === "sandbox-not-ready" ? "notConfigured" : "ready" } });
    case "permissionProfile/list":
      return send({ id: msg.id, result: { data: [{ id: ":read-only", allowed: true }, { id: ":workspace", allowed: true },
        ...(scenario === "no-profile" ? [] : [{ id: "ifrim_hub_ro", allowed: true }, { id: "ifrim_hub_rw", allowed: true }, { id: "ifrim_runner_ro", allowed: true }, { id: "ifrim_runner_rw", allowed: true }])], nextCursor: null } });
    case "model/list": {
      // A second, non-default model ("gpt-5") lets the model-variant scenario reach the adapter's exact-id check past the gate's run plan.
      // M09: `--models-file=<path>` (or `<log>.models.json` next to the log) replaces the list — a JSON array of
      // { id, isDefault, efforts: [..] } — so a test can switch the account default or remove a model between plan and dispatch.
      const custom = modelsOverride();
      if (custom) return send({ id: msg.id, result: { data: custom.map((m) => ({ id: m.id, model: m.id, displayName: m.displayName || m.id, isDefault: Boolean(m.isDefault), hidden: false, description: "",
        supportedReasoningEfforts: (m.efforts || ["medium"]).map((e) => ({ reasoningEffort: e })), defaultReasoningEffort: (m.efforts || ["medium"])[0] })) } });
      return send({ id: msg.id, result: { data: [{ id: "gpt-fake-sol", model: "gpt-fake-sol", displayName: "Fake Sol", isDefault: true, hidden: false, description: "", supportedReasoningEfforts: [{ reasoningEffort: "medium" }, { reasoningEffort: "high" }], defaultReasoningEffort: "medium" },
        { id: "gpt-5", model: "gpt-5", displayName: "Fake 5", isDefault: false, hidden: false, description: "", supportedReasoningEfforts: [{ reasoningEffort: "medium" }], defaultReasoningEffort: "medium" }] } });
    }
    case "thread/start":
    case "thread/resume":
      threadId = msg.params.threadId || "thr_fake_1";
      legaProject = msg.params.dynamicTools?.[0]?.tools?.find((t) => t.name === "propose_run")?.inputSchema?.properties?.project?.enum?.[0] || "";
      if (scenario === "lega-full-access") return send({ id: msg.id, result: { thread: { id: threadId, environments: [] }, model: "gpt-fake-sol", cwd: msg.params.cwd, approvalsReviewer: "user", sandbox: { type: "dangerFullAccess" } } });
      if (scenario === "lega-slow-start" || scenario === "slow-thread") await new Promise((r) => setTimeout(r, 1500)); // a start that is still in flight when Stop arrives
      send({ method: "thread/started", params: { thread: { id: threadId } } });
      // Like 0.159.2, the response reports the selected turn environments: [] when the client asked for none,
      // the default environment otherwise (or a Codex that ignores the field: lega-env-ignored).
      const environments = scenario === "lega-env-ignored" ? [{ id: "local" }] : Array.isArray(msg.params.environments) ? msg.params.environments : [{ id: "local" }];
      // auto-reviewer: the owner's config routes approvals to auto_review; model-swap: Codex substitutes another model;
      // model-variant: a same-family model that only a prefix match would accept (requested "gpt-5" → "gpt-5-mini");
      // model-case: the requested id echoed back in another case with surrounding spaces (the same model).
      const requestedModel = msg.params.model || modelsOverride()?.find((m) => m.isDefault)?.id || "gpt-fake-sol";
      const reportedModel = scenario === "model-swap" ? "gpt-fake-legacy" : scenario === "model-variant" ? `${requestedModel}-mini` : scenario === "model-case" ? ` ${requestedModel.toUpperCase()} ` : requestedModel;
      // sandbox-write: the thread projects workspaceWrite whatever access the Hub profile grants (a read-only run must stop).
      // external-sandbox: Codex applies no sandbox of its own (the Hub provides no outer one, so the run must stop).
      const sandboxType = scenario === "full-access" ? "dangerFullAccess" : scenario === "sandbox-write" ? "workspaceWrite" : scenario === "external-sandbox" ? "externalSandbox" : "readOnly";
      // effort-ignored: Codex keeps the config's "max" whatever the Hub set; effort-resume-max: only a RESUMED thread reports it.
      const reasoningEffort = scenario === "effort-ignored" || (scenario === "effort-resume-max" && msg.method === "thread/resume") ? "max" : effortOverride || "medium";
      return send({ id: msg.id, result: { thread: { id: threadId, environments }, model: reportedModel, modelProvider: "openai", cwd: msg.params.cwd,
        approvalPolicy: "on-request", approvalsReviewer: scenario === "auto-reviewer" ? "auto_review" : "user", sandbox: { type: sandboxType }, reasoningEffort } });
    case "turn/start": {
      const turnId = "turn_fake_1";
      send({ id: msg.id, result: { turn: { id: turnId, status: "inProgress", items: [] } } });
      send({ method: "turn/started", params: { threadId, turn: { id: turnId, status: "inProgress", items: [] } } });
      if (scenario === "approval") {
        const id = serverRequestId++;
        const reply = await new Promise((resolve) => { pendingServer.set(id, resolve); send({ id, method: "item/commandExecution/requestApproval", params: { threadId, turnId, itemId: "i1", command: "npm test", cwd: msg.params.cwd, reason: "run tests" } }); });
        log({ approvalReply: reply.result });
      }
      // M05: a command that asks for more than its profile (network, extra permissions).
      if (scenario === "approval-escalate") {
        const id = serverRequestId++;
        const reply = await new Promise((resolve) => { pendingServer.set(id, resolve); send({ id, method: "item/commandExecution/requestApproval", params: { threadId, turnId, itemId: "i1", command: "curl https://example.com", cwd: msg.params.cwd, reason: "needs network",
          additionalPermissions: { network: { enabled: true } } } }); });
        log({ approvalReply: reply.result });
      }
      if (scenario === "hang") return; // waits for turn/interrupt
      if (scenario.startsWith("factory-write:")) return factoryWrite(msg, turnId, scenario.slice("factory-write:".length));
      if (/^test-review(-slow)?:/.test(scenario)) return testReview(msg, turnId, scenario.replace(/^test-review(-slow)?:/, ""), scenario.startsWith("test-review-slow:"));
      if (scenario === "mcp-tool-completed") {
        // Only the completed item arrives (e.g. a call that failed at once): it must stop the run too.
        return send({ method: "item/completed", params: { threadId, turnId, item: { type: "mcpToolCall", id: "mcp2", server: "node_repl", tool: "js", status: "failed", arguments: {} } } });
      }
      if (scenario === "mcp-tool") {
        // A Codex that still calls an MCP tool during a run (the Hub must stop the turn at once).
        return send({ method: "item/started", params: { threadId, turnId, item: { type: "mcpToolCall", id: "mcp1", server: "node_repl", tool: "js", status: "inProgress", arguments: {} } } });
      }
      if (scenario === "autherror") {
        // An expired/revoked ChatGPT session: the model request answers 401 before any output; Codex sends an `error`
        // notification (no retry) and fails the turn with codexErrorInfo "unauthorized" (TurnError shape, schema 0.159).
        const error = { message: "unexpected status 401 Unauthorized: Provided authentication token is expired. Please try signing in again.", codexErrorInfo: "unauthorized", additionalDetails: null };
        send({ method: "error", params: { error, willRetry: false, threadId, turnId } });
        return send({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "failed", items: [], error } } });
      }
      if (scenario === "slow") {
        // Simulator: a long, clearly labelled fixture answer streamed over ~40 s, with tool activity items.
        const lines = ["SIMULARE — răspuns generat de fixture-ul fake-codex, nu de un model.", "", "## Plan", "1. Citesc `src/app.js` și testele.",
          "2. Rulez testele deterministe.", "3. Propun un diff mic.", "", "```js", "export const answer = 42;", "```", "", "Rezultat: fixture, fără inferență."];
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        send({ method: "item/started", params: { threadId, turnId, item: { type: "commandExecution", id: "c1", command: "npm test", status: "inProgress" } } });
        await sleep(3000);
        send({ method: "item/completed", params: { threadId, turnId, item: { type: "commandExecution", id: "c1", command: "npm test", status: "completed", exitCode: 0 } } });
        for (const line of lines) { for (const part of `${line}
`.match(/.{1,6}/gs)) { send({ method: "item/agentMessage/delta", params: { threadId, turnId, itemId: "m1", delta: part } }); await sleep(180); } }
        return send({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "completed", items: [] } } });
      }
      const prompt = msg.params.input?.[0]?.text || "";
      const ack = (prompt.match(/HANDOFF_ACK \S+ \S+/) || [""])[0];
      const text = `${ack ? `${ack}\n` : ""}Codex simulated answer.`;
      for (const part of text.match(/.{1,8}/gs)) send({ method: "item/agentMessage/delta", params: { threadId, turnId, itemId: "m1", delta: part } });
      send({ method: "thread/tokenUsage/updated", params: { threadId, turnId, tokenUsage: { total: { inputTokens: 10, outputTokens: 5 } } } });
      if (scenario === "fail") return send({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "failed", items: [], error: { message: "usage limit", codexErrorInfo: "usageLimitExceeded" } } } });
      return send({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "completed", items: [] } } });
    }
    case "mcpServerStatus/list": {
      // Servers disabled per process arrive as `-c mcp_servers.<name>.enabled=false`; lega-mcp-active keeps one running
      // (what an empty `mcp_servers={}` override really does: Codex deep-merges layers, so nothing is removed).
      const disabled = args.map((a) => (a.match(/^mcp_servers\.([A-Za-z0-9_-]+)\.enabled=false$/) || [])[1]).filter(Boolean);
      // A plugin-provided server (like Computer Use's cua_repl) stays up unless plugins are disabled for the process.
      const pluginsOff = args.includes("features.plugins=false");
      // mcp-paged: the list is paginated and the active server is on page 2; mcp-shape: an unknown response shape.
      if (scenario === "mcp-shape") return send({ id: msg.id, result: { servers: [] } });
      if (scenario === "mcp-paged") {
        if (!msg.params?.cursor) return send({ id: msg.id, result: { data: disabled.map((name) => ({ name, runtimeStatus: "disabled" })), nextCursor: "page-2" } });
        return send({ id: msg.id, result: { data: [{ name: "late_server", runtimeStatus: "connected" }], nextCursor: null } });
      }
      const data = [...disabled.map((name) => ({ name, runtimeStatus: "disabled" })), ...(scenario === "lega-mcp-active" || scenario === "mcp-active" ? [{ name: "fs", runtimeStatus: "connected" }] : []),
        ...(pluginsOff ? [] : [{ name: "cua_repl", runtimeStatus: "connected" }])];
      return send({ id: msg.id, result: { data, nextCursor: null } });
    }
    case "turn/interrupt":
      send({ id: msg.id, result: {} });
      return send({ method: "turn/completed", params: { threadId, turn: { id: msg.params.turnId, status: "interrupted", items: [] } } });
    default:
      return send({ id: msg.id, error: { code: -32601, message: `fake: unknown ${msg.method}` } });
  }
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Software Factory writer fixture: applies tests/fixtures/factory-patches/<name>.json ({ write: {path: text}, delete: [path] })
 * inside the turn's cwd, like a writer that edits files and runs a command, then completes the turn. Paths are relative and
 * may not leave the cwd. No model, no network.
 */
async function factoryWrite(msg, turnId, name) {
  const cwd = msg.params.cwd;
  let patch;
  try { patch = JSON.parse(fs.readFileSync(path.join(FACTORY_PATCHES, `${name.replace(/[^a-z0-9-]/gi, "")}.json`), "utf8")); }
  catch { return send({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "failed", items: [], error: { message: `fake: patch ${name} missing` } } } }); }
  const inside = (rel) => { const abs = path.resolve(cwd, rel); return abs.startsWith(path.resolve(cwd) + path.sep) ? abs : null; };
  // M11 L5: "{PROTECTED_TEST}" in a patch path stands for the protected acceptance test the CURRENT writer brief names (a Hub-written
  // test's path is derived from the project at run time).
  const protectedTest = [...String(msg.params.input?.[0]?.text || "").matchAll(/PROTEJATE \([^)]*\): ([^\s,]+)/g)].at(-1)?.[1] || "";
  const pathOf = (rel) => (rel.includes("{PROTECTED_TEST}") ? (protectedTest ? rel.replace("{PROTECTED_TEST}", protectedTest) : "") : rel);
  send({ method: "item/started", params: { threadId, turnId, item: { type: "commandExecution", id: "c1", command: "node --test", status: "inProgress" } } });
  await sleep(30);
  send({ method: "item/completed", params: { threadId, turnId, item: { type: "commandExecution", id: "c1", command: "node --test", status: "completed", exitCode: 0 } } });
  const changed = [];
  for (const [rawRel, text] of Object.entries(patch.write || {})) {
    const rel = pathOf(rawRel);
    if (!rel) continue;
    const abs = inside(rel);
    if (!abs) continue;
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text);
    changed.push(rel);
  }
  // Binary files (a test database the project's tests leave behind, M07): base64 in the patch.
  for (const [rel, b64] of Object.entries(patch.writeBase64 || {})) {
    const abs = inside(rel);
    if (!abs) continue;
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, Buffer.from(b64, "base64"));
    changed.push(rel);
  }
  for (const rel of patch.delete || []) { const abs = inside(rel); if (abs) { fs.rmSync(abs, { force: true }); changed.push(rel); } }
  send({ method: "item/started", params: { threadId, turnId, item: { type: "fileChange", id: "f1", changes: changed.map((p) => ({ path: p })), status: "inProgress" } } });
  send({ method: "item/completed", params: { threadId, turnId, item: { type: "fileChange", id: "f1", changes: changed.map((p) => ({ path: p })), status: "completed" } } });
  const text = `SIMULARE (fixture ${name}): am modificat ${changed.length} fișiere: ${changed.join(", ")}. ${patch.summary || ""}`;
  for (const part of text.match(/.{1,12}/gs)) send({ method: "item/agentMessage/delta", params: { threadId, turnId, itemId: "m1", delta: part } });
  return send({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "completed", items: [] } } });
}

const TEST_REVIEWS = path.join(path.dirname(fileURLToPath(import.meta.url)), "factory-test-reviews");
/**
 * M11 L5 test-review fixture (`test-review:<name>`, `test-review-slow:<name>` = the same answer after 4 s): the independent reviewer of
 * the Hub-written acceptance test (Codex, read-only) answers with tests/fixtures/factory-test-reviews/<name>.json as the final ```json
 * block, bound to the LAST CHANGE_SET marker of the current brief unless the file names another one. `criteria: "ALL"` repeats
 * `criterion` for every criterion the brief lists; previousFindings "ALL_RESOLVED" / "ALL_STILL_OPEN" classify every open code it lists.
 * It writes nothing; no model.
 */
async function testReview(msg, turnId, name, slow) {
  let data;
  try { data = JSON.parse(fs.readFileSync(path.join(TEST_REVIEWS, `${name.replace(/[^a-z0-9-]/gi, "")}.json`), "utf8")); }
  catch { return send({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "failed", items: [], error: { message: `fake: test review ${name} missing` } } } }); }
  const prompt = String(msg.params.input?.[0]?.text || "");
  const current = prompt.slice(Math.max(0, prompt.lastIndexOf("# Verificarea testului de acceptanță")));
  const marker = [...current.matchAll(/CHANGE_SET ([0-9a-f]{12})/g)].at(-1)?.[1] || "";
  const ids = [...(current.split("## Criteriile")[1]?.split("\n## ")[0] || "").matchAll(/^- (AC-\d{1,3})(?: \([^\n]*\))?:/gm)].map((m) => m[1]);
  const section = current.split("## Findings deschise din verificarea anterioară")[1]?.split("\n## ")[0] || "";
  const codes = [...section.matchAll(/^- ([A-Z]-\d{3}) /gm)].map((m) => m[1]);
  const state = data.previousFindings === "ALL_RESOLVED" ? "resolved" : data.previousFindings === "ALL_STILL_OPEN" ? "still_open" : null;
  const answer = { changeSet: data.changeSet || marker, verdict: data.verdict, summary: data.summary || "",
    criteria: data.criteria === "ALL" ? ids.map((id) => ({ id, ...(data.criterion || {}) })) : data.criteria || [],
    findings: data.findings || [], missingContext: data.missingContext || [], ...(state && codes.length ? { previousFindings: Object.fromEntries(codes.map((c) => [c, state])) } : {}) };
  if (data.previousChecks === "ALL_REPLACED_CORRECTLY") {
    const removed = current.split("## Verificări eliminate sau înlocuite")[1]?.split("\n## ")[0] || "";
    answer.previousChecks = Object.fromEntries([...removed.matchAll(/"id":\s*"(P\d+)"/g)].map((m) => [m[1], "replaced_correctly"]));
  }
  if (slow) await sleep(4000);
  const text = `SIMULARE (test review fixture ${name}).\n\n\`\`\`json\n${JSON.stringify(answer, null, 2)}\n\`\`\`\n`;
  for (const part of text.match(/.{1,24}/gs)) send({ method: "item/agentMessage/delta", params: { threadId, turnId, itemId: "m1", delta: part } });
  return send({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "completed", items: [] } } });
}
const serverRequest = (method, params) => new Promise((resolve) => { const id = serverRequestId++; pendingServer.set(id, resolve); send({ id, method, params }); });

/** Simulated GPT-Live session (thread/realtime/*): signaling only, scripted by scenario; never any network or audio. */
async function realtime(msg) {
  const p = msg.params || {};
  switch (msg.method) {
    case "thread/realtime/start": {
      if (p.transport?.type !== "webrtc" || !String(p.transport?.sdp || "").startsWith("v=0")) return send({ id: msg.id, error: { code: -32602, message: "fake: webrtc transport with an SDP offer required" } });
      send({ id: msg.id, result: {} });
      if (scenario === "lega-error") { send({ method: "thread/realtime/error", params: { threadId, message: "fake realtime failure" } }); return send({ method: "thread/realtime/closed", params: { threadId, reason: "error" } }); }
      send({ method: "thread/realtime/started", params: { threadId, realtimeSessionId: "rt_fake_1", version: p.version || "v1" } });
      if (scenario === "lega-no-sdp") return;
      send({ method: "thread/realtime/sdp", params: { threadId, sdp: "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=fake-answer\r\n" } });
      await sleep(400);
      return legaScript();
    }
    case "thread/realtime/appendSpeech":
      log({ spoke: p.text });
      return send({ id: msg.id, result: {} });
    case "thread/realtime/stop":
      send({ id: msg.id, result: {} });
      return send({ method: "thread/realtime/closed", params: { threadId, reason: "requested" } });
    case "thread/realtime/listVoices":
      return send({ id: msg.id, result: { voices: { v1: ["cove", "juniper"], v2: [], defaultV1: "cove", defaultV2: "" } } });
    default:
      return send({ id: msg.id, error: { code: -32601, message: `fake: unknown ${msg.method}` } });
  }
}

async function delegatedTurn(tool, args, n = 1, heard = null, silent = false) {
  const turnId = `turn_lega_${n}`;
  // Real ordering: the turn is admitted BEFORE the client sees the handoff item.
  send({ method: "turn/started", params: { threadId, turn: { id: turnId, status: "inProgress", items: [] } } });
  send({ method: "thread/realtime/itemAdded", params: { threadId, item: { type: "handoff_request", handoff_id: "h1", item_id: "i1", input_transcript: heard ?? `fake: ${tool}`, active_transcript: [] } } });
  const reply = await serverRequest("item/tool/call", { threadId, turnId, callId: `call_${n}`, namespace: "lega", tool, arguments: args });
  log({ toolReply: reply.result || reply.error, tool });
  // `silent`: the turn ends without an answer (interrupted, no agent message) — the agent's pre-check followed by nothing said.
  if (silent) return send({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "interrupted", items: [] } } });
  const text = `[FINAL] Rezultat simulat pentru ${tool}: ${reply.result?.contentItems?.[0]?.text || ""}`;
  send({ method: "item/completed", params: { threadId, turnId, item: { type: "agentMessage", id: "m1", text } } });
  send({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "completed", items: [] } } });
}

async function legaScript() {
  const said = (role, text) => { send({ method: "thread/realtime/transcript/delta", params: { threadId, role, delta: text.slice(0, 5) } }); send({ method: "thread/realtime/transcript/done", params: { threadId, role, text } }); };
  if (scenario === "lega-stop-words") return said("user", "Lega, oprește tot");
  if (scenario === "lega-bare-stop") return said("user", "Oprește");
  if (scenario === "lega-tool-stopall") return delegatedTurn("stop_all", {});
  if (scenario === "lega-refused-words") return said("user", "aprobă tot și fă deploy");
  if (scenario === "lega-navigate-words") return said("user", "Lega, deschide aprobările");
  if (scenario === "lega-status") { said("user", "Lega, ce se întâmplă?"); return delegatedTurn("hub_status", {}); }
  if (scenario === "lega-navigate-tool") return delegatedTurn("navigate", { screen: "misiuni" });
  if (scenario === "lega-propose") return delegatedTurn("propose_run", { project: legaProject, provider: "codex", task: "Citește README și rezumă-l." });
  if (scenario === "lega-unknown-tool") return delegatedTurn("approve_everything", {});
  // `lega-calls:<base64url JSON [{tool, args}]>`: one delegated turn per call, in order (each reply is logged with its tool).
  if (scenario.startsWith("lega-calls:")) {
    const calls = JSON.parse(Buffer.from(scenario.slice("lega-calls:".length), "base64url").toString("utf8"));
    for (let i = 0; i < calls.length; i += 1) { await delegatedTurn(calls[i].tool, calls[i].args || {}, i + 1); await sleep(50); }
    return log({ callsDone: calls.length });
  }
  // M10.2 `lega-script:<base64url JSON [{sleep: ms} | {say: text, role?} | {tool, args, heard?, silent?}]>`: owner words (final transcripts), delegated
  // tool calls and pauses, in order (the voice bridge tests feed the owner's sentences through the provider's real event shape).
  if (scenario.startsWith("lega-script:")) {
    const script = JSON.parse(Buffer.from(scenario.slice("lega-script:".length), "base64url").toString("utf8"));
    let n = 0;
    for (const item of script) {
      if (item.sleep) await sleep(item.sleep);
      else if (item.say) said(item.role || "user", item.say);
      else if (item.tool) { n += 1; await delegatedTurn(item.tool, item.args || {}, n, item.heard ?? null, Boolean(item.silent)); }
      await sleep(30);
    }
    return log({ scriptDone: script.length });
  }
  if (scenario === "lega-web") {
    const turnId = "turn_web";
    send({ method: "turn/started", params: { threadId, turn: { id: turnId, status: "inProgress", items: [] } } });
    send({ method: "item/started", params: { threadId, turnId, item: { type: "webSearch", id: "ws1", query: "" } } });
    send({ method: "item/completed", params: { threadId, turnId, item: { type: "webSearch", id: "ws1", query: "curs euro azi token sk-proj-FAKEFAKEFAKEFAKEFAKEFAKE1234", action: { type: "search", query: "curs euro azi" } } } });
    send({ method: "item/completed", params: { threadId, turnId, item: { type: "agentMessage", id: "m1", text: "[FINAL] Cursul simulat este 5 lei." } } });
    return send({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "completed", items: [] } } });
  }
  if (scenario === "lega-forbidden") {
    send({ method: "turn/started", params: { threadId, turn: { id: "turn_bad", status: "inProgress", items: [] } } });
    return send({ method: "item/started", params: { threadId, turnId: "turn_bad", item: { type: "commandExecution", id: "c1", command: "type secrets.txt", status: "inProgress" } } });
  }
  if (scenario === "lega-approval-request") {
    const reply = await serverRequest("item/commandExecution/requestApproval", { threadId, turnId: "t", itemId: "c", command: "rm -rf x", cwd: "." });
    return log({ approvalReply: reply.result });
  }
  if (scenario === "lega-closed") { await sleep(200); return send({ method: "thread/realtime/closed", params: { threadId, reason: "remote" } }); }
  // M05: the provider fails AFTER the peer connected (the 2026-10-01 "closed: error" shape), with or without activity first.
  if (scenario === "lega-error-after-connect" || scenario === "lega-error-after-words") {
    if (scenario === "lega-error-after-words") said("user", "Lega");
    await sleep(300);
    send({ method: "error", params: { threadId, error: { message: "fake: upstream realtime failed (1011) token sk-proj-FAKEFAKEFAKEFAKEFAKEFAKE9999" }, willRetry: false } });
    send({ method: "thread/realtime/error", params: { threadId, message: "fake realtime failure after connect" } });
    return send({ method: "thread/realtime/closed", params: { threadId, reason: "error", code: 1011 } });
  }
}
