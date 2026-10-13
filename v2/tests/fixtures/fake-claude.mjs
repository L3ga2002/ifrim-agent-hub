#!/usr/bin/env node
// Simulated Claude Code CLI (stream-json) for PASS_SIMULATED tests. No network, no model.
import fs from "node:fs";
import crypto from "node:crypto";

const argv = process.argv.slice(2);
const opt = (name, fallback = "") => (argv.find((a) => a.startsWith(`--fake-${name}=`)) || "").split("=").slice(1).join("=") || fallback;
// Optional `--fake-scenario-file=<path>`: a non-empty file overrides --fake-scenario, so a test can switch scenarios between invocations.
const scenarioFromFile = () => { const file = opt("scenario-file"); try { return file ? fs.readFileSync(file, "utf8").trim() : ""; } catch { return ""; } };
// Optional `--fake-scenario-queue=<path>`: each `-p` process takes the FIRST line of the file (and removes it), so a
// multi-run flow (review → re-review …) can be scripted in order. An empty queue falls back to the other options.
const scenarioFromQueue = () => {
  const file = opt("scenario-queue");
  if (!file || !argv.includes("-p")) return "";
  try {
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter((l) => l.trim());
    if (!lines.length) return "";
    fs.writeFileSync(file, lines.slice(1).join("\n"));
    return lines[0].trim();
  } catch { return ""; }
};
const scenario = scenarioFromQueue() || scenarioFromFile() || opt("scenario", "ok");
const REVIEWS = new URL("./factory-reviews/", import.meta.url);

/**
 * Software Factory reviewer fixture (`review:<name>`): answers with tests/fixtures/factory-reviews/<name>.json as the final
 * JSON block, bound to the CHANGE_SET marker of the prompt unless the file names another one. previousFindings
 * "ALL_RESOLVED" / "ALL_STILL_OPEN" classify every open code listed in the prompt.
 */
function reviewAnswer(name, prompt) {
  const data = JSON.parse(fs.readFileSync(new URL(`${name.replace(/[^a-z0-9-]/gi, "")}.json`, REVIEWS), "utf8"));
  // The CURRENT request is last in the prompt (earlier briefs of the same conversation come first, as transcript).
  const marker = [...prompt.matchAll(/CHANGE_SET ([0-9a-f]{12})/g)].at(-1)?.[1] || "";
  const current = prompt.slice(prompt.lastIndexOf("# Review independent"));
  const section = current.split("## Findings deschise din review-ul anterior")[1]?.split("\n## ")[0] || "";
  const codes = [...section.matchAll(/^- ([A-Z]-\d{3}) /gm)].map((m) => m[1]);
  const state = data.previousFindings === "ALL_RESOLVED" ? "resolved" : data.previousFindings === "ALL_STILL_OPEN" ? "still_open" : null;
  const answer = { changeSet: data.changeSet || marker, verdict: data.verdict, summary: data.summary, findings: data.findings || [], missingContext: data.missingContext || [],
    ...(state && codes.length ? { previousFindings: Object.fromEntries(codes.map((c) => [c, state])) } : {}) };
  return `SIMULARE (review fixture ${name}).\n\n\`\`\`json\n${JSON.stringify(answer, null, 2)}\n\`\`\`\n`;
}
const AUTHORED = new URL("./factory-authored/", import.meta.url);

/**
 * M11 L5 author fixture (`author:<name>`; `author-slow:<name>` = the same answer after 4 s): answers like the author of the Hub-written
 * acceptance test (Claude, read-only) with tests/fixtures/factory-authored/<name>.json — { body: string | [lines], manifest: { needs, api,
 * cases }, slot?: "wrong" } — as a ```js block (the body) and a ```json block (the manifest), bound to the LAST `testSlot <slot>` marker
 * of the prompt (the current request) unless `slot` is "wrong". It writes nothing; no model.
 */
function authorAnswer(name, prompt) {
  const reference = name === "existing-reference-noneeds" ? "existing-reference" : name;
  const data = ["json-reference", "existing-reference"].includes(reference) ? {
    body: fs.readFileSync(new URL(`./stage0-s25/${reference}.body.mjs.txt`, import.meta.url), "utf8"),
    manifest: JSON.parse(fs.readFileSync(new URL(`./stage0-s25/${reference}.manifest.json`, import.meta.url), "utf8")),
  } : JSON.parse(fs.readFileSync(new URL(`${name.replace(/[^a-z0-9-]/gi, "")}.json`, AUTHORED), "utf8"));
  if (name === "existing-reference-noneeds") data.manifest.needs = [];
  const slot = data.slot === "wrong" ? "000000000000" : [...prompt.matchAll(/testSlot ([0-9a-f]{12})/g)].at(-1)?.[1] || "";
  const body = Array.isArray(data.body) ? data.body.join("\n") : String(data.body || "");
  const markerIndex = prompt.lastIndexOf("# Test de acceptanță");
  const current = markerIndex < 0 ? "" : prompt.slice(markerIndex);
  const amends = current.match(/Repari varianta anterioară \(sha ([0-9a-f]{64})\)/)?.[1];
  const manifest = { testSlot: slot, needs: [], api: "", ...(amends ? { amends } : {}), ...(data.manifest || {}) };
  return `SIMULARE (author fixture ${name}).\n\n\`\`\`js\n${body}\n\`\`\`\n\n\`\`\`json\n${JSON.stringify(manifest, null, 2)}\n\`\`\`\n`;
}
const logFile = opt("log");
const args = argv.filter((a) => !a.startsWith("--fake-"));
const log = (entry) => { if (logFile) fs.appendFileSync(logFile, `${JSON.stringify(entry)}\n`); };
const out = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
// Optional `--fake-log-env`: logs the NAMES (never the values) of the environment variables this process received.
if (argv.includes("--fake-log-env")) log({ envNames: Object.keys(process.env).sort(), invocation: args.slice(0, 2).join(" ") });

if (args[0] === "--version") { console.log("2.1.175 (Claude Code)"); process.exit(0); }
if (args[0] === "--help") { console.log("--output-format --include-partial-messages --session-id --resume --permission-mode --tools --strict-mcp-config --effort --setting-sources --no-chrome"); process.exit(0); }
if (args[0] === "auth" && args[1] === "status") {
  // M09-A2: "other-account" = another login on the same plan (another e-mail → another pseudonym); "no-email" = a CLI that
  // prints no identity field (the Hub falls back to the weak tuple basis).
  const status = scenario === "apikey" ? { loggedIn: true, authMethod: "api_key", apiProvider: "firstParty" }
    : { loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty", ...(scenario === "no-email" ? {} : { email: scenario === "other-account" ? "other@example.com" : "x@example.com" }), subscriptionType: "max" };
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
  // M09-A3: the sha256 of the exact prompt received (compared with agent_runs.prompt_sha256), the skill procedure headers and
  // any test markers (SKILL_MARKER_*), so a test can check what the reviewer side actually got without logging the whole prompt.
  log({ args, promptLength: prompt.length, promptHead: prompt.slice(0, 200), promptSha256: crypto.createHash("sha256").update(prompt, "utf8").digest("hex"),
    skillHeaders: [...prompt.matchAll(/^### ([a-z0-9-]+) v(\d+) \(sha ([0-9a-f]{12})\)$/gm)].map((m) => `${m[1]} v${m[2]} ${m[3]}`),
    skillSection: prompt.includes("Hub skill procedures (approved;"), markers: [...new Set([...prompt.matchAll(/\bSKILL_MARKER_[A-Za-z0-9]+\b/g)].map((m) => m[0]))] });
  // init-apikey: the session reports an API key source; init-fable: the session resolved to a Fable model; init-model:<id>: the
  // session reports exactly <id> whatever was asked (a CLI that resolved the alias to another model). Otherwise the model asked
  // with --model is echoed like the real CLI resolves it (sonnet → claude-sonnet-fake …; a dated id as is); none → "claude-fake".
  const askedModel = args.indexOf("--model") >= 0 ? String(args[args.indexOf("--model") + 1] || "") : "";
  const echoed = { sonnet: "claude-sonnet-fake", opus: "claude-opus-fake", haiku: "claude-haiku-fake" }[askedModel.toLowerCase()] || askedModel || "claude-fake";
  const initModel = scenario === "init-fable" ? "claude-fable-5" : scenario.startsWith("init-model:") ? scenario.slice("init-model:".length) : echoed;
  out({ type: "system", subtype: "init", session_id: sessionArg, model: initModel,
    apiKeySource: scenario === "init-apikey" ? "ANTHROPIC_API_KEY" : "none", tools: scenario === "init-mcp" ? ["Read", "mcp__cua__click"] : ["Read"],
    mcp_servers: scenario === "init-mcp" ? [{ name: "cua", status: "connected" }] : [], capabilities: [] });
  // M09-A2 rate_limit_event scenarios: rate-plain = an ordinary report (no credit fields); rate-overage = the CLI reports overage
  // in use (then would keep going — the Hub must stop it); rate-credits = the plan is exhausted and credits are required;
  // rate-unknown = only fields the Hub does not know (never a "verified").
  if (scenario === "rate-plain") out({ type: "rate_limit_event", rate_limit_info: { status: "allowed", resetsAt: 1790000000, rateLimitType: "five_hour", utilization: 0.42 }, session_id: sessionArg });
  if (scenario === "rate-unknown") out({ type: "rate_limit_event", rate_limit_info: { status: "allowed", creditsOff: true, weirdFlag: "yes" }, session_id: sessionArg });
  if (scenario === "rate-overage") {
    out({ type: "rate_limit_event", rate_limit_info: { status: "allowed_warning", resetsAt: 1790000000, rateLimitType: "overage", isUsingOverage: true, overageStatus: "allowed", utilization: 1 }, session_id: sessionArg });
    await new Promise((r) => setTimeout(r, 5000));
  }
  if (scenario === "rate-credits") {
    out({ type: "rate_limit_event", rate_limit_info: { status: "rejected", resetsAt: 1790000000, rateLimitType: "five_hour", errorCode: "credits_required", canUserPurchaseCredits: true, hasChargeableSavedPaymentMethod: false }, session_id: sessionArg });
    await new Promise((r) => setTimeout(r, 5000));
  }
  if (scenario === "billing") {
    out({ type: "system", subtype: "api_retry", attempt: 1, max_retries: 3, retry_delay_ms: 1000, error_status: 402, error: "billing_error", session_id: sessionArg });
    await new Promise((r) => setTimeout(r, 5000));
  }
  if (scenario === "hang") { await new Promise((r) => setTimeout(r, 60000)); }
  // fallback-fable: after a clean init the CLI switches the main model (a fallbackModel in the settings); the Hub must stop.
  if (scenario === "fallback-fable") {
    out({ type: "system", subtype: "model_fallback", original_model: "claude-fake", fallback_model: "claude-fable-5", session_id: sessionArg });
    await new Promise((r) => setTimeout(r, 5000));
  }
  if (scenario === "autherror") {
    out({ type: "result", subtype: "error_during_execution", is_error: true, result: "Not logged in · Please run /login", session_id: sessionArg });
    process.exit(1);
  }
  const ack = (prompt.match(/HANDOFF_ACK \S+ \S+/) || [""])[0];
  // review-slow:<name>: the same answer after 4 s (a test changes the workspace while the reviewer is still reading).
  if (scenario.startsWith("review-slow:") || scenario.startsWith("author-slow:")) await new Promise((r) => setTimeout(r, 4000));
  const text = /^review(-slow)?:/.test(scenario) ? reviewAnswer(scenario.replace(/^review(-slow)?:/, ""), prompt)
    : /^author(-slow)?:/.test(scenario) ? authorAnswer(scenario.replace(/^author(-slow)?:/, ""), prompt) : `${ack ? `${ack}\n` : ""}Claude simulated answer.`;
  for (const part of text.match(/.{1,8}/gs)) out({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: part } }, session_id: sessionArg });
  out({ type: "assistant", message: { content: [{ type: "text", text }] }, session_id: sessionArg });
  out({ type: "result", subtype: "success", is_error: false, result: text, session_id: sessionArg, usage: { input_tokens: 10, output_tokens: 5 }, total_cost_usd: 0.01, num_turns: 1 });
  process.exit(0);
});
