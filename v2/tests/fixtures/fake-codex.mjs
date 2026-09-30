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
    return send({ id: msg.id, result: { codexHome: "C:\\fake", platformFamily: "windows", platformOs: "windows", userAgent: "fake/0" } });
  }
  if (!initialized) return send({ id: msg.id, error: { code: -32002, message: "Not initialized" } });
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
      send({ method: "thread/started", params: { thread: { id: threadId } } });
      // auto-reviewer: the owner's config routes approvals to auto_review; model-swap: Codex substitutes another model.
      return send({ id: msg.id, result: { thread: { id: threadId }, model: scenario === "model-swap" ? "gpt-fake-legacy" : msg.params.model || "gpt-fake-sol", modelProvider: "openai", cwd: msg.params.cwd,
        approvalPolicy: "on-request", approvalsReviewer: scenario === "auto-reviewer" ? "auto_review" : "user", sandbox: { type: scenario === "full-access" ? "dangerFullAccess" : "readOnly" }, reasoningEffort: "medium" } });
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
    case "turn/interrupt":
      send({ id: msg.id, result: {} });
      return send({ method: "turn/completed", params: { threadId, turn: { id: msg.params.turnId, status: "interrupted", items: [] } } });
    default:
      return send({ id: msg.id, error: { code: -32601, message: `fake: unknown ${msg.method}` } });
  }
});
