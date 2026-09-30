#!/usr/bin/env node
// Simulated Codex app-server (JSONL JSON-RPC over stdio) for PASS_SIMULATED tests.
// It never contacts a network or a model. Scenario and log path come from argv.
import fs from "node:fs";
import readline from "node:readline";

const args = process.argv.slice(2);
const opt = (name, fallback = "") => (args.find((a) => a.startsWith(`--${name}=`)) || "").split("=").slice(1).join("=") || fallback;
// Optional `--scenario-file=<path>`: a non-empty file overrides --scenario, so the simulator can switch scenarios per run.
const scenarioFromFile = () => { const file = opt("scenario-file"); try { return file ? fs.readFileSync(file, "utf8").trim() : ""; } catch { return ""; } };
const scenario = scenarioFromFile() || opt("scenario", "ok");
const logFile = opt("log");
const log = (entry) => { if (logFile) fs.appendFileSync(logFile, `${JSON.stringify(entry)}\n`); };
// Optional `--log-env`: logs the NAMES (never the values) of the environment variables this process received.
if (args.includes("--log-env")) log({ envNames: Object.keys(process.env).sort(), invocation: args.includes("--version") ? "--version" : args.includes("app-server") ? "app-server" : "other" });

if (args.includes("--version")) { console.log("codex-cli 0.0.0-fake"); process.exit(0); }
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
        ...(scenario === "no-profile" ? [] : [{ id: "ifrim_hub_ro", allowed: true }, { id: "ifrim_hub_rw", allowed: true }])], nextCursor: null } });
    case "model/list":
      return send({ id: msg.id, result: { data: [{ id: "gpt-fake-sol", model: "gpt-fake-sol", displayName: "Fake Sol", isDefault: true, hidden: false, description: "", supportedReasoningEfforts: [{ reasoningEffort: "medium" }, { reasoningEffort: "high" }], defaultReasoningEffort: "medium" }] } });
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
      const requestedModel = msg.params.model || "gpt-fake-sol";
      const reportedModel = scenario === "model-swap" ? "gpt-fake-legacy" : scenario === "model-variant" ? `${requestedModel}-mini` : scenario === "model-case" ? ` ${requestedModel.toUpperCase()} ` : requestedModel;
      // sandbox-write: the thread projects workspaceWrite whatever access the Hub profile grants (a read-only run must stop).
      // external-sandbox: Codex applies no sandbox of its own (the Hub provides no outer one, so the run must stop).
      const sandboxType = scenario === "full-access" ? "dangerFullAccess" : scenario === "sandbox-write" ? "workspaceWrite" : scenario === "external-sandbox" ? "externalSandbox" : "readOnly";
      return send({ id: msg.id, result: { thread: { id: threadId, environments }, model: reportedModel, modelProvider: "openai", cwd: msg.params.cwd,
        approvalPolicy: "on-request", approvalsReviewer: scenario === "auto-reviewer" ? "auto_review" : "user", sandbox: { type: sandboxType }, reasoningEffort: "medium" } });
    case "turn/start": {
      const turnId = "turn_fake_1";
      send({ id: msg.id, result: { turn: { id: turnId, status: "inProgress", items: [] } } });
      send({ method: "turn/started", params: { threadId, turn: { id: turnId, status: "inProgress", items: [] } } });
      if (scenario === "approval") {
        const id = serverRequestId++;
        const reply = await new Promise((resolve) => { pendingServer.set(id, resolve); send({ id, method: "item/commandExecution/requestApproval", params: { threadId, turnId, itemId: "i1", command: "npm test", cwd: msg.params.cwd, reason: "run tests" } }); });
        log({ approvalReply: reply.result });
      }
      if (scenario === "hang") return; // waits for turn/interrupt
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

async function delegatedTurn(tool, args, n = 1) {
  const turnId = `turn_lega_${n}`;
  // Real ordering: the turn is admitted BEFORE the client sees the handoff item.
  send({ method: "turn/started", params: { threadId, turn: { id: turnId, status: "inProgress", items: [] } } });
  send({ method: "thread/realtime/itemAdded", params: { threadId, item: { type: "handoff_request", handoff_id: "h1", item_id: "i1", input_transcript: `fake: ${tool}`, active_transcript: [] } } });
  const reply = await serverRequest("item/tool/call", { threadId, turnId, callId: `call_${n}`, namespace: "lega", tool, arguments: args });
  log({ toolReply: reply.result || reply.error, tool });
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
}
