#!/usr/bin/env node
// Simulated Claude Code CLI (stream-json) for PASS_SIMULATED tests. No network, no model.
import fs from "node:fs";

const argv = process.argv.slice(2);
const opt = (name, fallback = "") => (argv.find((a) => a.startsWith(`--fake-${name}=`)) || "").split("=").slice(1).join("=") || fallback;
// Optional `--fake-scenario-file=<path>`: a non-empty file overrides --fake-scenario, so a test can switch scenarios between invocations.
const scenarioFromFile = () => { const file = opt("scenario-file"); try { return file ? fs.readFileSync(file, "utf8").trim() : ""; } catch { return ""; } };
const scenario = scenarioFromFile() || opt("scenario", "ok");
const logFile = opt("log");
const args = argv.filter((a) => !a.startsWith("--fake-"));
const log = (entry) => { if (logFile) fs.appendFileSync(logFile, `${JSON.stringify(entry)}\n`); };
const out = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
// Optional `--fake-log-env`: logs the NAMES (never the values) of the environment variables this process received.
if (argv.includes("--fake-log-env")) log({ envNames: Object.keys(process.env).sort(), invocation: args.slice(0, 2).join(" ") });

if (args[0] === "--version") { console.log("2.1.175 (Claude Code)"); process.exit(0); }
if (args[0] === "--help") { console.log("--output-format --include-partial-messages --session-id --resume --permission-mode --tools --strict-mcp-config --effort --setting-sources --no-chrome"); process.exit(0); }
if (args[0] === "auth" && args[1] === "status") {
  const status = scenario === "apikey" ? { loggedIn: true, authMethod: "api_key", apiProvider: "firstParty" } : { loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty", email: "x@example.com", subscriptionType: "max" };
  console.log(JSON.stringify(status));
  process.exit(0);
}
if (args[0] === "agents" && args.includes("--json")) {
  // Simulated `claude agents --json` (read-only session listing). `--fake-agents-cwd=` sets the project cwd.
  const cwd = opt("agents-cwd", process.cwd());
  if (scenario === "agents-broken") { console.log("not json"); process.exit(0); }
  if (scenario === "agents-object") { console.log(JSON.stringify({ sessions: [] })); process.exit(0); } // valid JSON, but not a list
  const sessions = scenario === "agents-empty" ? [] : [
    { pid: 111, cwd, kind: "interactive", startedAt: 1790000000000, sessionId: "11111111-1111-4111-8111-111111111111", name: "Hub project session", status: scenario === "agents-idle" ? "idle" : "busy" },
    { pid: 222, cwd: "C:\\Elsewhere\\private-project", kind: "interactive", startedAt: 1790000000001, sessionId: "22222222-2222-4222-8222-222222222222", name: "Other project", status: "idle" },
  ];
  log({ args, agents: sessions.length });
  console.log(JSON.stringify(sessions));
  process.exit(0);
}
if (!args.includes("-p")) { console.error("fake-claude: unsupported"); process.exit(2); }

let prompt = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { prompt += chunk; });
process.stdin.on("end", async () => {
  const sessionArg = args.indexOf("--session-id") >= 0 ? args[args.indexOf("--session-id") + 1] : args[args.indexOf("--resume") + 1];
  log({ args, promptLength: prompt.length, promptHead: prompt.slice(0, 200) });
  // init-apikey: the session reports an API key source; init-fable: the session resolved to a Fable model.
  out({ type: "system", subtype: "init", session_id: sessionArg, model: scenario === "init-fable" ? "claude-fable-5" : "claude-fake",
    apiKeySource: scenario === "init-apikey" ? "ANTHROPIC_API_KEY" : "none", tools: scenario === "init-mcp" ? ["Read", "mcp__cua__click"] : ["Read"],
    mcp_servers: scenario === "init-mcp" ? [{ name: "cua", status: "connected" }] : [], capabilities: [] });
  if (scenario === "billing") {
    out({ type: "system", subtype: "api_retry", attempt: 1, max_retries: 3, retry_delay_ms: 1000, error_status: 402, error: "billing_error", session_id: sessionArg });
    await new Promise((r) => setTimeout(r, 5000));
  }
  if (scenario === "hang") { await new Promise((r) => setTimeout(r, 60000)); }
  if (scenario === "autherror") {
    out({ type: "result", subtype: "error_during_execution", is_error: true, result: "Not logged in · Please run /login", session_id: sessionArg });
    process.exit(1);
  }
  const ack = (prompt.match(/HANDOFF_ACK \S+ \S+/) || [""])[0];
  const text = `${ack ? `${ack}\n` : ""}Claude simulated answer.`;
  for (const part of text.match(/.{1,8}/gs)) out({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: part } }, session_id: sessionArg });
  out({ type: "assistant", message: { content: [{ type: "text", text }] }, session_id: sessionArg });
  out({ type: "result", subtype: "success", is_error: false, result: text, session_id: sessionArg, usage: { input_tokens: 10, output_tokens: 5 }, total_cost_usd: 0.01, num_turns: 1 });
  process.exit(0);
});
