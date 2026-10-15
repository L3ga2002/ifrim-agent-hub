import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { classifyClaudeRetry, classifyText, claudeOutputTokenMaximum } from "./classify.mjs";
import { buildChildEnv, BILLING_RISK_ENV } from "../policy/billing.mjs";
import { deriveAccountIdentity, normalizeClaudeRateLimit, classifyClaudeRateLimit } from "../policy/billing-evidence.mjs";
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

/**
 * The Claude models the Hub may ASK for (M09, shared by the factory, envelopes, manual runs and the reviewer in wsl-runner): an
 * alias (sonnet, opus, haiku) or a dated id of those families. Anything else (an empty model = the account default, "best",
 * Fable, the [1m] variants, an unknown name) is refused before any process starts.
 */
export const CLAUDE_MODEL_ALLOWLIST = /^(?:sonnet|opus|haiku|claude-(?:sonnet|opus|haiku)-[0-9][0-9a-z.-]{0,40})$/i;

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

export const READ_ONLY_TOOLS = Object.freeze(["Read", "Glob", "Grep"]);
const WRITE_TOOLS = ["Read", "Glob", "Grep", "Edit", "Write", "Bash"];
const SAFE_BASH = ["Bash(npm test)", "Bash(npm run build)", "Bash(npm run test:v2)", "Bash(git status *)", "Bash(git diff *)", "Bash(git log *)", "Bash(node --test *)"];
/** The flags the Hub relies on, as `--help` lists them (installation check; the run plan requires --effort). */
export const CLAUDE_KNOWN_FLAGS = Object.freeze(["--output-format", "--include-partial-messages", "--session-id", "--resume", "--permission-mode", "--tools", "--strict-mcp-config", "--effort", "--permission-prompts", "--setting-sources", "--no-chrome"]);

/**
 * The exact argv of one Hub turn of Claude Code after the binary (M07: shared by the Windows client and the reviewer inside
 * the wsl-runner environment, so both run with the same flags; only the deny rules carry their own platform's paths).
 */
export function claudeTurnArgs({ access = "read-only", deniedReads, newSession, sessionId, model = "", effort = "" }) {
  const tools = access === "workspace-write" ? WRITE_TOOLS : READ_ONLY_TOOLS;
  return ["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages",
    "--permission-mode", access === "workspace-write" ? "acceptEdits" : "dontAsk",
    "--tools", tools.join(","),
    "--strict-mcp-config", "--mcp-config", JSON.stringify({ mcpServers: {} }),
    "--setting-sources", "user",
    "--no-chrome", // Claude in Chrome acts in the owner's browser: never from a Hub run (computer runtime policy)
    "--disallowedTools", ...deniedReads,
    ...(access === "workspace-write" ? ["--allowedTools", ...SAFE_BASH] : []),
    ...(newSession ? ["--session-id", sessionId] : ["--resume", sessionId]),
    ...(model ? ["--model", model] : []), ...(effort ? ["--effort", effort] : [])];
}

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

/**
 * Pure launch recipe shared with isolated rehearsals. Pass the parent's environment explicitly; launcher facts are already
 * resolved (prefixArgs includes any platform wrapper). Without the option this is exactly the supervisor's former child env.
 * Revert: remove authorLimits handling and the one env assignment below; there is no global state or settings to clean up.
 */
export function claudeTurnLaunch({ binary, cwd, deniedReads, access, model, effort, newSession, sessionId,
  parentEnv = {}, launcherEnv = CLAUDE_GUARD_ENV, environment = "windows", maxOutputTokens }) {
  const env = buildChildEnv(launcherEnv, parentEnv);
  if (environment === "windows" && maxOutputTokens === 64000) env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = "64000";
  return { executable: binary.executable, args: [...binary.prefixArgs, ...claudeTurnArgs({ access, deniedReads, model, effort, newSession, sessionId })], cwd, env };
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

/** Reports billing-risk names (never credentials) and the non-secret user-settings output-token override, read-only. */
export function inspectClaudeConfig(homeDir, projectDir = null) {
  const files = [path.join(homeDir, ".claude", "settings.json"), path.join(homeDir, ".claude", "settings.local.json")];
  if (projectDir) files.push(path.join(projectDir, ".claude", "settings.json"), path.join(projectDir, ".claude", "settings.local.json"));
  let apiKeyHelper = false;
  let fallbackModelSet = false;
  let outputTokenLimitOverride = null;
  const riskyEnvInSettings = new Set();
  const inspected = [];
  for (const [i, file] of files.entries()) {
    const data = readJson(file);
    if (!data) continue;
    // --setting-sources user loads settings.json; local/project files are not evidence of this override.
    if (i === 0 && data.env?.CLAUDE_CODE_MAX_OUTPUT_TOKENS !== undefined) {
      const value = data.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS;
      const scalar = typeof value === "string" || typeof value === "number";
      const text = scalar ? String(value).trim() : "";
      outputTokenLimitOverride = scalar && text.length <= 20 ? (typeof value === "string" ? text : value) : "invalid";
    }
    inspected.push(path.relative(homeDir, file) || file);
    if (data.apiKeyHelper) apiKeyHelper = true;
    // Only the user files count: Hub runs load --setting-sources user.
    if (i < 2 && data.fallbackModel !== undefined && data.fallbackModel !== null && String(data.fallbackModel) !== "") fallbackModelSet = true;
    for (const name of Object.keys(data.env || {})) if (BILLING_RISK_ENV.some((risk) => risk.toUpperCase() === name.toUpperCase())) riskyEnvInSettings.add(name);
  }
  const anthropicDir = path.join(process.env.APPDATA || path.join(homeDir, "AppData", "Roaming"), "Anthropic");
  const federationProfile = fs.existsSync(path.join(anthropicDir, "active_config"));
  return { inspectedFiles: inspected.length, apiKeyHelper, fallbackModelSet, outputTokenLimitOverride, riskyEnvInSettings: [...riskyEnvInSettings], anthropicActiveProfilePresent: federationProfile };
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

/**
 * Where a Hub turn of Claude Code runs and with which host-specific facts (M07). The Windows launcher is the behaviour the
 * Hub always had: the native binary, the Windows deny rules, the project's startup files and the user settings read on this
 * machine. The wsl-runner launcher (providers/claude-wsl.mjs) runs the same argv inside the reviewer's bwrap sandbox.
 *   resolve()                    → { executable, prefixArgs } | null
 *   deniedReads(cwd)             → the --disallowedTools rules for this platform
 *   startupProblem(cwd, trusted) → a refusal text when the workspace defines startup hooks/MCP, else null
 *   fallbackModelSet()           → whether the settings the run loads define fallbackModel
 *   outputTokenLimitOverride()   → optional, the output-token value in the loaded user settings
 *   spawn({ binary, args, cwd, launchVars }) → { executable, args, cwd, env } for the supervisor
 */
export function windowsClaudeLauncher({ config, homeDir = os.homedir() }) {
  return {
    environment: "windows",
    label: "claude -p",
    resolve: () => resolveClaudeBinary(config),
    deniedReads: (cwd) => claudeDeniedReads(cwd, { homeDir, extra: [config.dataDir, config.backupDir] }),
    startupProblem: (cwd, trusted) => {
      const startup = inspectWorkspaceStartup(cwd);
      return !trusted && startup.some((item) => item.kind !== "definitions") ? `Workspace defines startup hooks/MCP (${startup.map((s) => s.file).join(", ")}); mark the project trusted after review` : null;
    },
    fallbackModelSet: () => inspectClaudeConfig(homeDir).fallbackModelSet,
    outputTokenLimitOverride: () => inspectClaudeConfig(homeDir).outputTokenLimitOverride,
    spawn: ({ binary, args, cwd }) => ({ executable: binary.executable, args: [...binary.prefixArgs, ...args], cwd, env: CLAUDE_GUARD_ENV }),
  };
}

/**
 * `claude auth status --json` → the facts the Hub keeps (M07: four fields). M09-A2: with a salt, the account becomes a salted
 * pseudonym (`accountIdentity`): from the e-mail when the CLI reports one (plus an organisation id if present), otherwise from
 * the tuple authMethod/apiProvider/subscriptionType (basis "tuple": weak, it cannot tell apart two accounts on the same plan).
 * Which identity fields the real CLI prints is not verified in the repo; whatever it prints is used only here and discarded.
 */
export function claudeAuthFacts(status, { salt = null } = {}) {
  const s = status && typeof status === "object" ? status : {};
  const out = { loggedIn: Boolean(s.loggedIn), authMethod: s.authMethod || null, apiProvider: s.apiProvider || null, subscriptionType: s.subscriptionType || null };
  if (!salt || !out.loggedIn) return out;
  const pick = (...keys) => keys.map((k) => s[k]).find((v) => typeof v === "string" && v.trim()) || null;
  const email = pick("email", "emailAddress", "accountEmail");
  const org = pick("orgId", "organizationId", "organizationUuid", "orgUuid");
  const accountIdentity = deriveAccountIdentity({ salt, email, tuple: [out.authMethod, out.apiProvider, out.subscriptionType], extra: org ? [org] : [], plan: out.subscriptionType });
  if (accountIdentity) out.accountIdentity = accountIdentity;
  return out;
}

export function createClaudeAdapter({ config, supervisor, homeDir = os.homedir(), launcher = null, identitySalt = null }) {
  const id = "claude";
  const host = launcher || windowsClaudeLauncher({ config, homeDir });
  const salt = () => { try { return typeof identitySalt === "function" ? identitySalt() : null; } catch { return null; } };

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
      const flags = CLAUDE_KNOWN_FLAGS.filter((flag) => help.includes(flag));
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
      out.auth = claudeAuthFacts(status, { salt: salt() });
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
   * for new sessions (so a crash can be reconciled by id), `--resume` for continuation. `launchVars` (M07): variables of
   * the environment launcher (the run marker the reaper finds); the Windows launcher ignores them.
   */
  /*
   * `verifyInitModel(reportedModel)` (M09, given by the run manager): returns null when the model Claude Code reports at init is
   * the approved one (the bound family or dated id), otherwise the reason to stop before the model.
   */
  function startTurn({ runId, cwd, prompt, access = "read-only", model = "", effort = "", sessionId = "", trustedWorkspace = false, onEvent, launchVars = {}, verifyInitModel = null, maxOutputTokens = null }) {
    const binary = host.resolve();
    const key = `run-${runId}`;
    const requested = host.environment === "windows" && maxOutputTokens === 64000 ? 64000 : null;
    const settingsOverride = host.outputTokenLimitOverride?.() ?? null;
    const evidenceSuffix = settingsOverride !== null ? "; env din setările utilizatorului poate suprascrie variabila procesului" : "";
    const fail = (category, message) => {
      const handle = failedHandle(key, category, message);
      handle.done = handle.done.then((result) => ({ ...result, authorOutputLimit: { requested, settingsOverride, effective: null, evidence: "nedemonstrat" + evidenceSuffix } }));
      return handle;
    };
    if (!binary) return fail("transport", "Claude Code not installed");
    const startupProblem = host.startupProblem(cwd, trustedWorkspace);
    if (startupProblem) return fail("policy", startupProblem);
    if (model && CLAUDE_REFUSED_MODELS.test(model)) {
      return fail("billing", `Modelul ${model} este refuzat: ${refusedModelReason(model)}`);
    }
    // A fallbackModel in the user settings lets the CLI switch to another model by itself during the run (overload, model
    // not found): the same paid-fallback risk as the forbidden --fallback-model flag. Checked on every launch.
    if (host.fallbackModelSet()) {
      return fail("billing", "Setările Claude Code ale utilizatorului definesc fallbackModel: Claude ar putea comuta singur pe alt model (inclusiv Fable) în timpul execuției; oprit înainte de model. Scoate cheia fallbackModel din setări.");
    }
    const newSession = !sessionId;
    const nativeSessionId = sessionId || crypto.randomUUID();
    let spec;
    try {
      const launch = host.spawn({ binary, args: [], cwd, launchVars });
      spec = claudeTurnLaunch({ binary: { executable: launch.executable, prefixArgs: launch.args }, cwd: launch.cwd,
        access, deniedReads: host.deniedReads(cwd), newSession, sessionId: nativeSessionId, model, effort,
        parentEnv: process.env, launcherEnv: launch.env, environment: host.environment, maxOutputTokens });
    }
    catch (error) { return fail(error.category || "transport", String(error.message || error).slice(0, 300)); }
    if (spec.args.some((arg) => CLAUDE_FORBIDDEN_FLAGS.includes(arg))) return fail("policy", "Forbidden Claude flag");

    let output = "";
    let usage = {};
    let resultEvent = null;
    let terminalMaximum = null;
    let billingStop = false;
    let quotaStop = null;
    let initSeen = false;
    let initStop = null;
    let initMismatch = null;
    let lastAssistantStop = null;
    let largestMessageOutput = 0;
    const observeUsage = (tokens) => { if (Number.isSafeInteger(tokens) && tokens > largestMessageOutput) largestMessageOutput = tokens; };
    let record;
    try { record = supervisor.start({ key, label: host.label || "claude -p", executable: spec.executable, args: spec.args, cwd: spec.cwd,
      env: spec.env,
      onStdoutLine: (line) => {
        let event;
        try { event = JSON.parse(line); } catch { return; }
        if (event.type === "system" && event.subtype === "init") {
          // Last check before any model call: the session must use the subscription and a non-Fable model.
          if (event.apiKeySource && event.apiKeySource !== "none") initStop = { category: "billing", message: `Claude Code a raportat apiKeySource=${event.apiKeySource}: rută API refuzată înainte de model` };
          else if (event.model && CLAUDE_REFUSED_MODELS.test(String(event.model))) initStop = { category: "billing", message: `Claude Code a selectat modelul ${event.model}: oprit înainte de model (${refusedModelReason(event.model)})` };
          // M09: the model the CLI resolved must be the approved one (an alias resolves through the installed CLI); never a
          // silent substitution. Recorded on the run (model_verified) before the stop.
          else if (typeof verifyInitModel === "function" && (initMismatch = verifyInitModel(event.model))) {
            initStop = { category: "policy", message: initMismatch };
            try { onEvent({ type: "model_verified", value: event.model ? String(event.model).slice(0, 80) : null, matched: false, reason: initMismatch }); } catch { /* the record never breaks the stop */ }
          } else {
            // --strict-mcp-config with an empty config should leave no MCP server; a plugin or connector server that still
            // shows up would run outside any sandbox (native Windows has none for Claude Code), so the run stops here.
            const servers = (Array.isArray(event.mcp_servers) ? event.mcp_servers : []).map((s) => String(s?.name || s || "?").slice(0, 60));
            const mcpTools = (Array.isArray(event.tools) ? event.tools : []).filter((t) => String(t).startsWith("mcp__"));
            if (servers.length || mcpTools.length) initStop = { category: "policy", message: `Claude Code a pornit cu servere MCP (${[...servers, ...mcpTools].slice(0, 5).join(", ")}); rulează în afara sandbox-ului; oprit înainte de model` };
          }
          if (initStop) {
            supervisor.stop(key, { graceMs: 100 }).catch(() => {});
            return;
          }
          initSeen = true;
          // Timeline (M03): init is the last check before the model; the CLI sends the prompt to the model right after it.
          onEvent({ type: "phase", phase: "initialized" });
          onEvent({ type: "phase", phase: "turn_sent" });
          onEvent({ type: "session", nativeSessionId: event.session_id || nativeSessionId, model: event.model, tools: event.tools, mcpServers: (event.mcp_servers || []).map((s) => s.name), capabilities: event.capabilities || [] });
        } else if (initStop) {
          return;
        } else if (event.type === "stream_event" && event.event?.type === "content_block_delta" && event.event.delta?.type === "text_delta") {
          output += event.event.delta.text || "";
          onEvent({ type: "delta", text: event.event.delta.text || "" });
        } else if (event.type === "stream_event" && event.event?.type === "message_start") {
          lastAssistantStop = event.event.message?.stop_reason ?? null;
          observeUsage(event.event.message?.usage?.output_tokens);
        } else if (event.type === "stream_event" && event.event?.type === "message_delta") {
          if (event.event.delta?.stop_reason) lastAssistantStop = event.event.delta.stop_reason;
          observeUsage(event.event.usage?.output_tokens);
        } else if (event.type === "assistant") {
          lastAssistantStop = event.message?.stop_reason ?? null;
          observeUsage(event.message?.usage?.output_tokens);
          for (const block of Array.isArray(event.message?.content) ? event.message.content : []) {
            if (block.type === "tool_use") { onEvent({ type: "phase", phase: "first_command_started" }); onEvent({ type: "activity", label: `Claude tool: ${String(block.name).slice(0, 60)}` }); }
          }
        } else if (event.type === "system" && event.subtype === "api_retry") {
          const category = classifyClaudeRetry(event.error);
          onEvent({ type: "notice", level: "warning", text: `Claude API retry ${event.attempt}/${event.max_retries}: ${event.error}` });
          if (category === "billing") {
            billingStop = true;
            supervisor.stop(key, { graceMs: 200 }).catch(() => {});
          }
        } else if (event.type === "system" && /model_(refusal_)?fallback/.test(String(event.subtype || ""))) {
          // The CLI switched the main model during the run: never accepted (the reported model must stay the one checked
          // at init). Stopped at once, whatever the new model is.
          onEvent({ type: "notice", level: "warning", text: `Claude Code a comutat modelul ${String(event.original_model || "?").slice(0, 60)} → ${String(event.fallback_model || "?").slice(0, 60)}; execuția e oprită` });
          billingStop = `Claude Code a comutat modelul în timpul execuției (${String(event.original_model || "?").slice(0, 60)} → ${String(event.fallback_model || "?").slice(0, 60)}); oprit`;
          supervisor.stop(key, { graceMs: 0 }).catch(() => {});
        } else if (event.type === "rate_limit_event") {
          // M09-A2: what the provider reports about the plan, recorded as a provider report. A tripwire, never the
          // pre-inference proof (it arrives after the request). Only an explicit overage signal latches the reverify and stops
          // the run; credits_required is a quota stop; unknown or absent fields never mean "credits off".
          const snapshot = normalizeClaudeRateLimit(event.rate_limit_info ?? event.rateLimitInfo ?? null, new Date().toISOString());
          const verdict = classifyClaudeRateLimit(snapshot);
          onEvent({ type: "usage", usage: { rateLimits: snapshot } });
          if (verdict.overage) {
            onEvent({ type: "notice", level: "error", text: `Claude Code raportează consum peste plan (${verdict.signals.join(", ")}); execuția e oprită și declarația de facturare cere reconfirmare` });
            onEvent({ type: "billing_evidence", reverify: true, reason: "provider_report_overage", report: snapshot, signals: verdict.signals });
            billingStop = `Claude Code a raportat consum din usage credits / overage (${verdict.signals.join(", ")}); oprit, iar Claude rămâne blocat până la o declarație nouă în sesiunea de proprietar`;
            supervisor.stop(key, { graceMs: 0 }).catch(() => {});
          } else if (verdict.creditsRequired) {
            onEvent({ type: "notice", level: "warning", text: "Claude Code raportează alocarea planului epuizată (credits_required); nu se cumpără credite, execuția e oprită" });
            if (verdict.creditFields) onEvent({ type: "billing_evidence", reverify: false, report: snapshot, signals: [] });
            quotaStop = `Alocarea planului Claude este epuizată (rate_limit_event credits_required${snapshot.resetsAt ? `, resetare ${snapshot.resetsAt}` : ""}); oprit fără credite`;
            supervisor.stop(key, { graceMs: 100 }).catch(() => {});
          } else {
            if (snapshot.status === "allowed_warning" || snapshot.status === "rejected") onEvent({ type: "notice", level: "warning", text: `Claude Code: limită ${snapshot.status}${snapshot.rateLimitType ? ` (${snapshot.rateLimitType})` : ""}${snapshot.resetsAt ? `, resetare ${snapshot.resetsAt}` : ""}` });
            if (verdict.creditFields) onEvent({ type: "billing_evidence", reverify: false, report: snapshot, signals: [] });
          }
        } else if (event.type === "system" && event.subtype === "permission_denied") {
          onEvent({ type: "activity", label: `Claude permission denied: ${String(event.tool_name || event.tool || "").slice(0, 60)}` });
        } else if (event.type === "result") {
          resultEvent = event;
          const terminalText = [event.result, ...(Array.isArray(event.errors) ? event.errors : [])].filter((s) => typeof s === "string").join("\n");
          terminalMaximum = event.is_error ? claudeOutputTokenMaximum(terminalText) : null;
          const used = Object.keys(event.modelUsage || {});
          const refused = used.find((m) => CLAUDE_REFUSED_MODELS.test(m));
          if (refused) billingStop = `Rezultatul raportează folosirea modelului ${refused.slice(0, 60)}: rezultatul nu e acceptat`;
          if (event.usage) usage = { tokens: event.usage, clientEstimateUsd: event.total_cost_usd ?? null, note: "total_cost_usd is a client-side estimate, not a subscription charge" };
          if (!output && typeof event.result === "string") { output = event.result; onEvent({ type: "delta", text: event.result }); }
          onEvent({ type: "usage", usage });
        }
      } });
    } catch (error) { return fail("policy", String(error.message || error).slice(0, 300)); }
    try {
      record.child.stdin.write(prompt);
      record.child.stdin.end();
    } catch { /* process failed to start; exit handler reports it */ }

    let interruptedBy = null;
    const done = record.exit.then((exit) => {
      supervisor.forget(key);
      const stderr = record.stderrTail.slice(-5).join(" | ");
      if (initStop) return { status: "failed", errorCategory: initStop.category, preInference: true, error: initStop.message, output: "", usage: {}, sessionId: nativeSessionId };
      if (billingStop) return { status: "failed", errorCategory: "billing", preInference: false, error: typeof billingStop === "string" ? billingStop : "Stopped: provider reported a billing error", output, usage, sessionId: nativeSessionId };
      if (quotaStop) return { status: "failed", errorCategory: "quota", preInference: false, error: quotaStop, output, usage, sessionId: nativeSessionId };
      if (interruptedBy) return { status: "interrupted", errorCategory: null, preInference: !initSeen, error: `interrupted (${interruptedBy}); turn left unfinished, session resumable`, output, usage, sessionId: nativeSessionId };
      // Only the Windows author requesting 64000 may turn a successful CLI result into an output-limit failure.
      // A terminal CLI output-maximum error was already a failure for every run; only its category changes.
      if ((requested === 64000 && lastAssistantStop === "max_tokens") || terminalMaximum !== null) {
        return { status: "failed", errorCategory: "output_token_limit", preInference: !initSeen,
          error: "Modelul a folosit întregul buget de ieșire fără să încheie răspunsul (output_token_limit).", output, usage, sessionId: nativeSessionId };
      }
      if (resultEvent && !resultEvent.is_error && exit.code === 0) {
        return { status: "completed", output, usage, sessionId: resultEvent.session_id || nativeSessionId, permissionDenials: resultEvent.permission_denials || [], numTurns: resultEvent.num_turns };
      }
      const message = resultEvent?.result || stderr || exit.error || `claude exited ${exit.code}`;
      const category = classifyText(message);
      // An stderr fragment alone is not a verifiable terminal result.
      return { status: "failed", errorCategory: category === "output_token_limit" ? "model" : category, preInference: !initSeen, error: String(message).slice(0, 2000), output, usage, sessionId: nativeSessionId };
    }).then((result) => {
      const effective = terminalMaximum ?? (largestMessageOutput > 32000 ? largestMessageOutput : null);
      const proof = terminalMaximum !== null ? `CLI: exceeded the ${terminalMaximum} output token maximum`
        : effective !== null ? `at least ${effective} (usage.output_tokens al unui mesaj assistant)` : "nedemonstrat";
      return { ...result, authorOutputLimit: { requested, settingsOverride, effective,
        evidence: proof + evidenceSuffix } };
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
