import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { classifyClaudeRetry, classifyText } from "./classify.mjs";
import { buildChildEnv, BILLING_RISK_ENV } from "../policy/billing.mjs";
import { claudeDeniedReads } from "../policy/isolation.mjs";

const execFileAsync = promisify(execFile);

/** Flags the Hub never passes: subscription-bypassing, permission-bypassing or fallback behaviour. */
export const CLAUDE_FORBIDDEN_FLAGS = Object.freeze(["--bare", "--fallback-model", "--dangerously-skip-permissions", "--allow-dangerously-skip-permissions", "--max-budget-usd"]);

/**
 * Models the Hub never selects: Fable draws on a separate weekly allowance and, in -p mode, a request
 * that would bill usage credits is billed WITHOUT a consent prompt (code.claude.com model-config);
 * "best" resolves to Fable where available. A "[1m]" suffix selects the 1M-context variant, which on
 * Max bills usage credits for the models the installed CLI resolves (e.g. sonnet[1m] = Sonnet 4.6 on 2.1.175).
 */
export const CLAUDE_REFUSED_MODELS = /(^|[^a-z0-9])(fable|best)([^a-z0-9]|$)|claude-fable|\[1m\]/i;

/** Why a model matched CLAUDE_REFUSED_MODELS, in the words shown to the owner. */
export function refusedModelReason(model) {
  return /\[1m\]/i.test(String(model))
    ? "varianta cu context 1M poate factura usage credits pe planul Max"
    : "Fable folosește o alocare separată și, în -p, poate factura usage credits fără confirmare";
}

/**
 * Environment guards for EVERY Claude Code process the Hub starts (-p turns, auth status, --version,
 * agents --json). Names verified in the official env-vars reference (Milestone 01 audit,
 * an-gap-cc-billing-guards / an-gap-cc-version-governance); an older CLI ignores unknown names.
 * Per process only: nothing is written to the user's settings.
 */
export const CLAUDE_GUARD_ENV = Object.freeze({
  CLAUDE_CODE_DISABLE_ADVISOR_TOOL: "1", // the advisor can call Fable
  CLAUDE_CODE_DISABLE_FAST_MODE: "1", // billed only from usage credits on subscriptions
  CLAUDE_CODE_DISABLE_1M_CONTEXT: "1", // [1m] variants can bill usage credits
  CLAUDE_CODE_DISABLE_WORKFLOWS: "1", // multi-agent workflows multiply plan usage
  DISABLE_EXTRA_USAGE_COMMAND: "1",
  DISABLE_UPGRADE_COMMAND: "1",
  DISABLE_LOGIN_COMMAND: "1",
  DISABLE_LOGOUT_COMMAND: "1",
  DISABLE_AUTOUPDATER: "1", // a Hub run must never update the global CLI
  CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1", // Hub memory is canonical; vendor auto memory stays the owner's (an-cc-memory)
  CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1", // nothing may outlive the Hub run that owns the task
  CLAUDE_CODE_DISABLE_CRON: "1", // native schedules are created by the owner (native_schedule.create is ALWAYS_ASK)
});

/**
 * Hard read denials for every Hub run. With --setting-sources user the project's own deny rules
 * (.claude/settings.json) are not loaded, so the Hub passes the protection itself: relative AND absolute
 * (//c/... form on Windows) rules for the protected project paths, .env anywhere, and credential directories
 * in the home folder. Claude Code applies Read rules to Grep/Glob and through symlinks/junctions.
 */
export const CLAUDE_DENIED_READS = Object.freeze(claudeDeniedReads(null));

const READ_ONLY_TOOLS = ["Read", "Glob", "Grep"];
const WRITE_TOOLS = ["Read", "Glob", "Grep", "Edit", "Write", "Bash"];
const SAFE_BASH = ["Bash(npm test)", "Bash(npm run build)", "Bash(npm run test:v2)", "Bash(git status *)", "Bash(git diff *)", "Bash(git log *)", "Bash(node --test *)"];

export function resolveClaudeBinary(config) {
  if (config.providerBinaries.claude) return config.providerBinaries.claude;
  if (config.testMode) return null;
  if (process.env.HUB_CLAUDE_BIN) return { executable: process.env.HUB_CLAUDE_BIN, prefixArgs: [] };
  const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  // The npm `claude.exe` in %APPDATA%\npm is a shim; use the real, unmodified binary shipped in the package.
  const real = path.join(appData, "npm", "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe");
  if (fs.existsSync(real)) return { executable: real, prefixArgs: [], source: "npm global @anthropic-ai/claude-code" };
  return null;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

/** Reports whether Claude settings could select a separately billed credential. Names only. */
export function inspectClaudeConfig(homeDir, projectDir = null) {
  const files = [path.join(homeDir, ".claude", "settings.json"), path.join(homeDir, ".claude", "settings.local.json")];
  if (projectDir) files.push(path.join(projectDir, ".claude", "settings.json"), path.join(projectDir, ".claude", "settings.local.json"));
  let apiKeyHelper = false;
  const riskyEnvInSettings = new Set();
  const inspected = [];
  for (const file of files) {
    const data = readJson(file);
    if (!data) continue;
    inspected.push(path.relative(homeDir, file) || file);
    if (data.apiKeyHelper) apiKeyHelper = true;
    for (const name of Object.keys(data.env || {})) if (BILLING_RISK_ENV.some((risk) => risk.toUpperCase() === name.toUpperCase())) riskyEnvInSettings.add(name);
  }
  const anthropicDir = path.join(process.env.APPDATA || path.join(homeDir, "AppData", "Roaming"), "Anthropic");
  const federationProfile = fs.existsSync(path.join(anthropicDir, "active_config"));
  return { inspectedFiles: inspected.length, apiKeyHelper, riskyEnvInSettings: [...riskyEnvInSettings], anthropicActiveProfilePresent: federationProfile };
}

/**
 * Lists workspace-controlled startup behaviour (`claude -p` runs project hooks and MCP servers
 * without a trust prompt). Untrusted projects with hooks/MCP are blocked before launch.
 */
export function inspectWorkspaceStartup(projectDir) {
  const found = [];
  for (const rel of [".claude/settings.json", ".claude/settings.local.json"]) {
    const data = readJson(path.join(projectDir, rel));
    if (data?.hooks && Object.keys(data.hooks).length) found.push({ file: rel, kind: "hooks", events: Object.keys(data.hooks) });
    if (data?.enabledMcpjsonServers || data?.enableAllProjectMcpServers) found.push({ file: rel, kind: "mcp-enable" });
  }
  if (fs.existsSync(path.join(projectDir, ".mcp.json"))) found.push({ file: ".mcp.json", kind: "mcp-servers" });
  for (const dir of [".claude/agents", ".claude/commands", ".claude/skills"]) {
    try { if (fs.readdirSync(path.join(projectDir, dir)).length) found.push({ file: dir, kind: "definitions" }); } catch { /* none */ }
  }
  return found;
}

export function createClaudeAdapter({ config, supervisor, homeDir = os.homedir() }) {
  const id = "claude";

  async function run(args, timeout = 30000) {
    const binary = resolveClaudeBinary(config);
    if (!binary) throw Object.assign(new Error("Claude Code not installed"), { category: "transport" });
    const { stdout } = await execFileAsync(binary.executable, [...binary.prefixArgs, ...args], { env: buildChildEnv(CLAUDE_GUARD_ENV), windowsHide: true, timeout, maxBuffer: 1024 * 1024 });
    return stdout;
  }

  async function inspectInstallation() {
    const binary = resolveClaudeBinary(config);
    if (!binary) return { provider: id, installed: false, reason: "Claude Code binary not found" };
    try {
      const version = (await run(["--version"], 20000)).trim();
      const help = await run(["--help"], 20000);
      const flags = ["--output-format", "--include-partial-messages", "--session-id", "--resume", "--permission-mode", "--tools", "--strict-mcp-config", "--effort", "--permission-prompts", "--setting-sources", "--no-chrome"]
        .filter((flag) => help.includes(flag));
      return { provider: id, installed: true, binary: binary.executable, source: binary.source || "configured", version, flags };
    } catch (error) {
      return { provider: id, installed: false, binary: binary.executable, reason: `--version failed: ${error.code || error.message}` };
    }
  }

  /** Official, local `claude auth status --json` with the exact controlled environment used for runs. */
  async function probe() {
    const out = { provider: id, probedAt: new Date().toISOString(), config: inspectClaudeConfig(homeDir) };
    try {
      const status = JSON.parse(await run(["auth", "status", "--json"], 30000));
      out.auth = { loggedIn: Boolean(status.loggedIn), authMethod: status.authMethod || null, apiProvider: status.apiProvider || null, subscriptionType: status.subscriptionType || null };
      out.ok = true;
    } catch (error) {
      out.ok = false;
      out.error = error.message;
      out.errorCategory = classifyText(error.message);
    }
    return out;
  }

  /**
   * One headless turn: `claude -p` with stream-json output, prompt on stdin, pre-assigned session id
   * for new sessions (so a crash can be reconciled by id), `--resume` for continuation.
   */
  function startTurn({ runId, cwd, prompt, access = "read-only", model = "", effort = "", sessionId = "", trustedWorkspace = false, onEvent }) {
    const binary = resolveClaudeBinary(config);
    const key = `run-${runId}`;
    if (!binary) return failedHandle(key, "transport", "Claude Code not installed");
    const startup = inspectWorkspaceStartup(cwd);
    if (!trustedWorkspace && startup.some((item) => item.kind !== "definitions")) {
      return failedHandle(key, "policy", `Workspace defines startup hooks/MCP (${startup.map((s) => s.file).join(", ")}); mark the project trusted after review`);
    }
    if (model && CLAUDE_REFUSED_MODELS.test(model)) {
      return failedHandle(key, "billing", `Modelul ${model} este refuzat: ${refusedModelReason(model)}`);
    }
    const newSession = !sessionId;
    const nativeSessionId = sessionId || crypto.randomUUID();
    const tools = access === "workspace-write" ? WRITE_TOOLS : READ_ONLY_TOOLS;
    const args = [...binary.prefixArgs, "-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages",
      "--permission-mode", access === "workspace-write" ? "acceptEdits" : "dontAsk",
      "--tools", tools.join(","),
      "--strict-mcp-config", "--mcp-config", JSON.stringify({ mcpServers: {} }),
      "--setting-sources", "user",
      "--no-chrome", // Claude in Chrome acts in the owner's browser: never from a Hub run (computer runtime policy)
      "--disallowedTools", ...claudeDeniedReads(cwd, { homeDir, extra: [config.dataDir, config.backupDir] }),
      ...(access === "workspace-write" ? ["--allowedTools", ...SAFE_BASH] : []),
      ...(newSession ? ["--session-id", nativeSessionId] : ["--resume", nativeSessionId]),
      ...(model ? ["--model", model] : []), ...(effort ? ["--effort", effort] : [])];
    if (args.some((arg) => CLAUDE_FORBIDDEN_FLAGS.includes(arg))) return failedHandle(key, "policy", "Forbidden Claude flag");

    let output = "";
    let usage = {};
    let resultEvent = null;
    let billingStop = false;
    let initSeen = false;
    let initStop = null;
    const record = supervisor.start({ key, label: "claude -p", executable: binary.executable, args, cwd,
      env: CLAUDE_GUARD_ENV,
      onStdoutLine: (line) => {
        let event;
        try { event = JSON.parse(line); } catch { return; }
        if (event.type === "system" && event.subtype === "init") {
          // Last check before any model call: the session must use the subscription and a non-Fable model.
          if (event.apiKeySource && event.apiKeySource !== "none") initStop = { category: "billing", message: `Claude Code a raportat apiKeySource=${event.apiKeySource}: rută API refuzată înainte de model` };
          else if (event.model && CLAUDE_REFUSED_MODELS.test(String(event.model))) initStop = { category: "billing", message: `Claude Code a selectat modelul ${event.model}: oprit înainte de model (${refusedModelReason(event.model)})` };
          if (initStop) {
            supervisor.stop(key, { graceMs: 100 }).catch(() => {});
            return;
          }
          initSeen = true;
          onEvent({ type: "session", nativeSessionId: event.session_id || nativeSessionId, model: event.model, tools: event.tools, mcpServers: (event.mcp_servers || []).map((s) => s.name), capabilities: event.capabilities || [] });
        } else if (initStop) {
          return;
        } else if (event.type === "stream_event" && event.event?.type === "content_block_delta" && event.event.delta?.type === "text_delta") {
          output += event.event.delta.text || "";
          onEvent({ type: "delta", text: event.event.delta.text || "" });
        } else if (event.type === "assistant" && Array.isArray(event.message?.content)) {
          for (const block of event.message.content) {
            if (block.type === "tool_use") onEvent({ type: "activity", label: `Claude tool: ${String(block.name).slice(0, 60)}` });
          }
        } else if (event.type === "system" && event.subtype === "api_retry") {
          const category = classifyClaudeRetry(event.error);
          onEvent({ type: "notice", level: "warning", text: `Claude API retry ${event.attempt}/${event.max_retries}: ${event.error}` });
          if (category === "billing") {
            billingStop = true;
            supervisor.stop(key, { graceMs: 200 }).catch(() => {});
          }
        } else if (event.type === "system" && event.subtype === "permission_denied") {
          onEvent({ type: "activity", label: `Claude permission denied: ${String(event.tool_name || event.tool || "").slice(0, 60)}` });
        } else if (event.type === "result") {
          resultEvent = event;
          if (event.usage) usage = { tokens: event.usage, clientEstimateUsd: event.total_cost_usd ?? null, note: "total_cost_usd is a client-side estimate, not a subscription charge" };
          if (!output && typeof event.result === "string") { output = event.result; onEvent({ type: "delta", text: event.result }); }
          onEvent({ type: "usage", usage });
        }
      } });
    try {
      record.child.stdin.write(prompt);
      record.child.stdin.end();
    } catch { /* process failed to start; exit handler reports it */ }

    let interruptedBy = null;
    const done = record.exit.then((exit) => {
      supervisor.forget(key);
      const stderr = record.stderrTail.slice(-5).join(" | ");
      if (initStop) return { status: "failed", errorCategory: initStop.category, preInference: true, error: initStop.message, output: "", usage: {}, sessionId: nativeSessionId };
      if (billingStop) return { status: "failed", errorCategory: "billing", preInference: false, error: "Stopped: provider reported a billing error", output, usage, sessionId: nativeSessionId };
      if (interruptedBy) return { status: "interrupted", errorCategory: null, preInference: !initSeen, error: `interrupted (${interruptedBy}); turn left unfinished, session resumable`, output, usage, sessionId: nativeSessionId };
      if (resultEvent && !resultEvent.is_error && exit.code === 0) {
        return { status: "completed", output, usage, sessionId: resultEvent.session_id || nativeSessionId, permissionDenials: resultEvent.permission_denials || [], numTurns: resultEvent.num_turns };
      }
      const message = resultEvent?.result || stderr || exit.error || `claude exited ${exit.code}`;
      return { status: "failed", errorCategory: classifyText(message), preInference: !initSeen, error: String(message).slice(0, 2000), output, usage, sessionId: nativeSessionId };
    });

    async function interrupt(reason = "user") {
      interruptedBy = reason;
      const result = await supervisor.stop(key, { graceMs: 300 });
      return { interrupted: result.stopped, graceful: false, reason };
    }

    return { key, pid: record.pid, nativeSessionId, newSession, done, interrupt };
  }

  function failedHandle(key, category, message) {
    return { key, pid: null, done: Promise.resolve({ status: "failed", errorCategory: category, preInference: true, error: message, output: "", usage: {} }), interrupt: async () => ({ interrupted: true }) };
  }

  return { id, displayName: "Claude Code (Claude plan)", inspectInstallation, probe, startTurn, inspectConfig: () => inspectClaudeConfig(homeDir) };
}
