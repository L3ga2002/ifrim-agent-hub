import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parse as parseToml } from "smol-toml";
import { createJsonRpcPeer } from "./jsonrpc.mjs";
import { classifyCodexTurnError, classifyText } from "./classify.mjs";
import { buildChildEnv } from "../policy/billing.mjs";
import { codexIsolationArgs, CODEX_PROFILE_BY_ACCESS } from "../policy/isolation.mjs";
import { HUB_VERSION } from "../config.mjs";
import { KNOWN_EFFORTS } from "../policy/run-plan.mjs";

const execFileAsync = promisify(execFile);

/**
 * Methods the Hub may call on the Codex app-server (schema verified against codex-cli
 * 0.158.0-alpha.2.1 and regenerated on 0.159.x `generate-json-schema`). windowsSandbox/readiness and
 * permissionProfile/list are read-only inspections used by the isolation check (Milestone 02). Everything else — including
 * account/rateLimitResetCredit/consume, account/sendAddCreditsNudgeEmail, login/logout, config
 * writes, plugin/marketplace installs and thread deletion — is refused client-side.
 */
export const CODEX_ALLOWED_METHODS = new Set([
  "initialize", "thread/start", "thread/resume", "thread/read", "turn/start", "turn/interrupt",
  "model/list", "account/read", "account/rateLimits/read",
  "windowsSandbox/readiness", "permissionProfile/list", "mcpServerStatus/list",
]);

/**
 * Per-process reasoning effort (M03 §09): the thread default then comes from the Hub, not from the owner's config.toml
 * (found live: both Hub runs reported "max"). thread/start reports it back, and a different value stops the run before the
 * turn. Only known effort names reach the command line.
 */
export function effortArgs(effort = "") {
  if (!effort) return [];
  if (!KNOWN_EFFORTS.includes(effort)) throw Object.assign(new Error(`Unsupported effort ${effort}`), { category: "validation", preInference: true });
  return ["-c", `model_reasoning_effort="${effort}"`];
}

/** Per-process args that disable each named MCP server (only names addressable as a dotted path; any other stays active and is refused by the MCP check). */
export function mcpDisableArgs(names = []) {
  return names.filter((n) => MCP_NAME_ADDRESSABLE.test(n)).flatMap((n) => ["-c", `mcp_servers.${n}.enabled=false`]);
}

const MCP_LIST_MAX_PAGES = 20;
const mcpUnverifiable = (why) => Object.assign(new Error(`Hub-ul nu poate confirma că niciun server MCP nu e activ (${why}); oprit înainte de model`), { category: "policy", preInference: true });

/**
 * The MCP servers still active for a thread (anything not reported "disabled"), over every page (the list is paginated
 * with a server-defined page size, schema 0.159.2). Fails closed: an unknown response shape or too many pages throws a
 * policy error, never "no servers". The Hub allows none for its processes: an MCP server runs outside the sandbox.
 */
export async function activeMcpServers(peer, threadId) {
  const active = [];
  let cursor = null;
  for (let page = 0; page < MCP_LIST_MAX_PAGES; page += 1) {
    const listed = await peer.request("mcpServerStatus/list", { threadId, detail: "toolsAndAuthOnly", ...(cursor ? { cursor } : {}) }, 20000);
    if (!Array.isArray(listed?.data)) throw mcpUnverifiable("răspuns mcpServerStatus/list necunoscut");
    for (const server of listed.data) if (server?.runtimeStatus !== "disabled") active.push(String(server?.name || "?").slice(0, 80));
    cursor = typeof listed.nextCursor === "string" && listed.nextCursor ? listed.nextCursor : null;
    if (!cursor) return active;
  }
  throw mcpUnverifiable(`peste ${MCP_LIST_MAX_PAGES} pagini de servere`);
}

/**
 * MCP plan for one Codex process, decided BEFORE it starts (an MCP server runs outside the sandbox as soon as the thread
 * exists, so refusing after thread/start would be too late). Returns { names, problem }: the owner's config servers to
 * disable by name, or why the run must not start: an unreadable ~/.codex/config.toml, a server name that cannot be
 * addressed per process, or a project .codex/config.toml (its MCP servers, hooks or providers are not under Hub control,
 * and a workspace-write run could have written it for the next run).
 */
export function codexMcpLaunchPlan({ homeDir, cwd }) {
  const user = inspectCodexConfig(homeDir);
  if (user.unreadable) return { names: [], problem: "~/.codex/config.toml nu poate fi citit, deci serverele MCP din el nu pot fi oprite; oprit înainte de pornire" };
  const rt = user.realtime || { mcpServers: 0, mcpServerNames: [] };
  if ((rt.mcpServers || 0) !== (rt.mcpServerNames || []).length) {
    return { names: [], problem: "Un server MCP din ~/.codex/config.toml are un nume care nu poate fi oprit per proces (doar litere, cifre, - și _); oprit înainte de pornire" };
  }
  if (cwd && fs.existsSync(path.join(cwd, ".codex", "config.toml"))) {
    return { names: [], problem: "Proiectul are .codex/config.toml: Codex l-ar încărca (servere MCP, hook-uri sau alt provider, în afara controlului Hub-ului); mută-l din proiect înainte de execuție" };
  }
  return { names: [...rt.mcpServerNames], problem: null };
}

/**
 * Per-process config overrides for every Hub app-server (never written to ~/.codex/config.toml).
 * Feature names checked with `codex features list` on 0.159.0 (all stable, enabled by default):
 * - fast_mode: a persisted Fast selection draws the allowance ~2.5x faster (agent-configuration/speed);
 * - image_generation: draws the allowance 3-5x faster, then credits (image-generation);
 * - skill_mcp_dependency_install: may install packages for skills (no installs without approval);
 * - apps: ChatGPT app connectors can act on external accounts (connector.write is ALWAYS_ASK in the Hub);
 * - computer_use, browser_use*, in_app_browser: visual/browser control belongs to the Hub computer runtime
 *   (computer.visual_control and browser.native are ALWAYS_ASK and locked);
 * - memories: Hub memory is canonical; vendor memories stay the owner's (the owner's config may enable them);
 * - multi_agent: subagents multiply plan usage beyond the Hub concurrency limit;
 * - plugins, remote_plugin: plugins bring their own MCP servers (Computer Use's cua_repl). MCP servers run OUTSIDE the
 *   Codex sandbox, so none may serve a Hub process: plugins are off here and every MCP server of the owner's config is
 *   disabled by name per process (mcpDisableArgs), then verified with mcpServerStatus/list before any turn. Found live on
 *   2026-09-30: a workspace-write run called cua_repl/js three times; only runs had been left without this.
 * web_search is a hosted tool that bypasses the sandbox network setting (web-search): disabled.
 * project_doc_max_bytes=0 + project_root_markers=[]: no AGENTS.md discovery at thread/start. With deny-read entries in the
 * Hub profile every discovery probe runs through the Windows sandbox (setup refresh + ACL sync per probe, no timeout), which
 * pushed the first live thread/start past 120 s (codex-rs 0.159.2 core/src/agents_md.rs). The Hub sends its own context
 * package, so project-controlled AGENTS.md text no longer reaches the model implicitly either.
 */
export const CODEX_APP_SERVER_OVERRIDES = Object.freeze([
  "-c", "features.fast_mode=false",
  "-c", "features.image_generation=false",
  "-c", "features.skill_mcp_dependency_install=false",
  "-c", "features.apps=false",
  "-c", "features.computer_use=false",
  "-c", "features.browser_use=false",
  "-c", "features.browser_use_external=false",
  "-c", "features.browser_use_full_cdp_access=false",
  "-c", "features.in_app_browser=false",
  "-c", "features.memories=false",
  "-c", "features.multi_agent=false",
  "-c", "features.plugins=false",
  "-c", "features.remote_plugin=false",
  "-c", 'web_search="disabled"',
  "-c", "project_doc_max_bytes=0",
  "-c", "project_root_markers=[]",
]);

/**
 * The Hub overrides for one app-server process. Only Lega's voice process may turn web search on (cached/indexed/live): its
 * agent has no shell and no file tools, so the hosted search reaches no local file. Run processes always keep it disabled.
 */
export function codexBaseOverrides({ webSearch = "disabled" } = {}) {
  if (webSearch === "disabled") return CODEX_APP_SERVER_OVERRIDES;
  if (!["cached", "indexed", "live"].includes(webSearch)) throw Object.assign(new Error(`Unsupported web search mode ${webSearch}`), { category: "validation", preInference: true });
  return CODEX_APP_SERVER_OVERRIDES.map((arg) => (arg === 'web_search="disabled"' ? `web_search="${webSearch}"` : arg));
}

const ACTIVITY_ITEMS = new Set(["commandExecution", "fileChange", "mcpToolCall", "webSearch", "imageView", "imageGeneration", "collabAgentToolCall", "subAgentActivity"]);

export function resolveCodexBinary(config) {
  if (config.providerBinaries.codex) return config.providerBinaries.codex;
  if (config.testMode) return null;
  if (process.env.HUB_CODEX_BIN) return { executable: process.env.HUB_CODEX_BIN, prefixArgs: [] };
  const root = path.join(os.homedir(), "AppData", "Local", "OpenAI", "Codex", "bin");
  try {
    const candidates = fs.readdirSync(root).map((name) => path.join(root, name, "codex.exe"))
      .filter((file) => fs.existsSync(file)).map((file) => ({ file, mtime: fs.statSync(file).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    if (candidates[0]) return { executable: candidates[0].file, prefixArgs: [], source: "Codex desktop bundle" };
  } catch { /* not installed */ }
  return null;
}

/** Reads ~/.codex/config.toml and reports only billing-relevant booleans (no values, no secrets). */
export function inspectCodexConfig(homeDir) {
  const file = path.join(homeDir, ".codex", "config.toml");
  if (!fs.existsSync(file)) return { present: false, customProvider: null, apiKeyAuthPreferred: false, realtime: inspectRealtimeKeys({}) };
  try {
    const data = parseToml(fs.readFileSync(file, "utf8"));
    const provider = typeof data.model_provider === "string" && data.model_provider !== "openai" ? data.model_provider : null;
    const prefersKey = [data.preferred_auth_method, data.forced_login_method].some((v) => typeof v === "string" && /api/i.test(v));
    // Informative: Hub app-servers override it per process (CODEX_APP_SERVER_OVERRIDES).
    const fastTierPersisted = typeof data.service_tier === "string" && /fast|priority/i.test(data.service_tier);
    return { present: true, customProvider: provider, apiKeyAuthPreferred: prefersKey, definesProviders: Boolean(data.model_providers), fastTierPersisted, realtime: inspectRealtimeKeys(data) };
  } catch (error) {
    return { present: true, unreadable: true, customProvider: null, apiKeyAuthPreferred: false, error: "config.toml could not be parsed" };
  }
}

/**
 * Realtime/voice-relevant config keys, by NAME only (values are never returned). Base-URL overrides could send the Lega
 * call to another (possibly API-billed) endpoint; a non-conversational session type breaks WebRTC; MCP servers stay reachable
 * from delegated turns unless neutralized per process.
 */
export const REALTIME_RISKY_KEYS = Object.freeze(["experimental_realtime_ws_base_url", "experimental_realtime_webrtc_call_base_url", "openai_base_url", "chatgpt_base_url",
  "experimental_realtime_ws_model", "experimental_realtime_start_instructions"]);
/** MCP server names Lega can disable per process with -c mcp_servers.<name>.enabled=false (a dotted path cannot address others). */
export const MCP_NAME_ADDRESSABLE = /^[A-Za-z0-9_-]{1,64}$/;
export function inspectRealtimeKeys(data = {}) {
  const risky = REALTIME_RISKY_KEYS.filter((k) => data[k] !== undefined);
  const rt = data.realtime && typeof data.realtime === "object" ? data.realtime : {};
  // The real key is realtime.type (codex-rs 0.159.2); only a conversational session works over WebRTC.
  if (rt.type !== undefined && String(rt.type) !== "conversational") risky.push("realtime.type");
  const overriddenPerProcess = ["experimental_realtime_ws_backend_prompt", "experimental_realtime_ws_startup_context"].filter((k) => data[k] !== undefined);
  const mcpServerNames = data.mcp_servers && typeof data.mcp_servers === "object" ? Object.keys(data.mcp_servers) : [];
  for (const name of mcpServerNames) if (!MCP_NAME_ADDRESSABLE.test(name)) risky.push("mcp_servers.<nume neadresabil>");
  return { riskyKeys: [...new Set(risky)], overriddenPerProcess, mcpServers: mcpServerNames.length, mcpServerNames: mcpServerNames.filter((n) => MCP_NAME_ADDRESSABLE.test(n)) };
}

export function createCodexAdapter({ config, supervisor, homeDir = os.homedir() }) {
  const id = "codex";

  async function inspectInstallation() {
    const binary = resolveCodexBinary(config);
    if (!binary) return { provider: id, installed: false, reason: "codex.exe not found (Codex desktop bundle or HUB_CODEX_BIN)" };
    try {
      const { stdout } = await execFileAsync(binary.executable, [...binary.prefixArgs, "--version"], { env: buildChildEnv(), windowsHide: true, timeout: 20000 });
      return { provider: id, installed: true, binary: binary.executable, source: binary.source || "configured", version: stdout.trim() };
    } catch (error) {
      return { provider: id, installed: false, binary: binary.executable, reason: `--version failed: ${error.code || error.message}` };
    }
  }

  /** Starts an app-server, performs the initialize handshake and returns a session object. */
  /**
   * `experimentalApi`, `allowedMethods` and `extraArgs` exist for the Lega voice process only (codex-realtime.mjs): it is a
   * separate app-server with its own narrow allowlist. Every run/probe process keeps experimentalApi=false and the run allowlist.
   */
  function openSession({ cwd, key, access = "read-only", onNotification, onServerRequest, onExit, experimentalApi = false, allowedMethods = CODEX_ALLOWED_METHODS, extraArgs = [], webSearch = "disabled", label = "codex app-server" }) {
    const binary = resolveCodexBinary(config);
    if (!binary) throw Object.assign(new Error("Codex client not installed"), { category: "transport", preInference: true });
    const base = codexBaseOverrides({ webSearch });
    let peer;
    const record = supervisor.start({
      key, label, executable: binary.executable, args: [...binary.prefixArgs, ...base, ...extraArgs, ...codexIsolationArgs(access, { homeDir, extra: [config.dataDir, config.backupDir] }), "app-server"], cwd,
      onStdoutLine: (line) => peer.handleLine(line),
    });
    peer = createJsonRpcPeer({
      write: (text) => {
        const stdin = record.child.stdin;
        if (record.exited || !stdin || stdin.destroyed || stdin.writableEnded) return; // never write into a dead pipe
        try { stdin.write(`${text}\n`); } catch { /* process gone */ }
      },
      allowedMethods, onNotification, onServerRequest,
    });
    record.exit.then((exit) => {
      peer.failAll(Object.assign(new Error(`codex app-server exited (${exit.code})${record.stderrTail.length ? `: ${record.stderrTail.slice(-3).join(" | ")}` : ""}`), { category: "transport" }));
      onExit?.(exit);
    });
    const ready = (async () => {
      const init = await peer.request("initialize", { clientInfo: { name: "ifrim_agent_hub", title: "Ifrim Agent Hub", version: HUB_VERSION }, capabilities: { experimentalApi: Boolean(experimentalApi) } }, 30000);
      peer.notify("initialized", {});
      return init;
    })();
    return { peer, record, ready };
  }

  /**
   * Explicit, user-initiated probe: initialize + account/read (+ rate limits, + model list).
   * No turn is started, so no inference happens. Identity (email) is never returned.
   */
  async function probe({ withUsage = true, withModels = false, cwd = config.hubRoot } = {}) {
    const key = `probe-codex-${Date.now()}`;
    const session = openSession({ cwd, key });
    const out = { provider: id, probedAt: new Date().toISOString(), config: inspectCodexConfig(homeDir) };
    try {
      const init = await session.ready;
      out.protocol = { userAgent: String(init?.userAgent || "").slice(0, 120), platform: `${init?.platformFamily || ""}/${init?.platformOs || ""}` };
      const account = await session.peer.request("account/read", {}, 30000);
      out.auth = normalizeAccount(account);
      if (withUsage && out.auth.accountType === "chatgpt") {
        try { out.usage = normalizeRateLimits(await session.peer.request("account/rateLimits/read", {}, 30000)); }
        catch (error) { out.usage = { error: error.message }; }
      }
      // Isolation facts (no inference): is the elevated Windows sandbox ready and is the Hub profile selectable?
      out.sandbox = { profileId: CODEX_PROFILE_BY_ACCESS["read-only"] };
      try { out.sandbox.readiness = (await session.peer.request("windowsSandbox/readiness", null, 30000))?.status || null; }
      catch (error) { out.sandbox.readiness = process.platform === "win32" ? `error: ${error.message}` : "not_applicable"; }
      try {
        const listed = await session.peer.request("permissionProfile/list", { cwd }, 30000);
        out.sandbox.profiles = (listed?.data || []).map((p) => ({ id: p.id, allowed: Boolean(p.allowed) }));
      } catch (error) { out.sandbox.profiles = []; out.sandbox.profilesError = error.message; }
      if (withModels) {
        try {
          const models = await session.peer.request("model/list", { includeHidden: false }, 30000);
          out.models = (models?.data || []).map((m) => ({ id: m.id, model: m.model, displayName: m.displayName, isDefault: m.isDefault,
            efforts: (m.supportedReasoningEfforts || []).map((e) => e.reasoningEffort || e), defaultEffort: m.defaultReasoningEffort?.reasoningEffort || m.defaultReasoningEffort,
            serviceTiers: m.serviceTiers || [], additionalSpeedTiers: m.additionalSpeedTiers || [] }));
        } catch (error) { out.models = { error: error.message }; }
      }
      out.ok = true;
    } catch (error) {
      out.ok = false;
      out.error = error.message;
      out.errorCategory = error.category || classifyText(error.message);
    } finally {
      await supervisor.stop(key, { graceMs: 1500 });
      supervisor.forget(key);
    }
    return out;
  }

  /**
   * Runs one turn. Order: handshake → account/read (billing gate with the same env) → rate limits
   * (allowance ceiling) → thread start/resume → turn/start → events until turn/completed.
   * Nothing after a pre-inference failure is retried here.
   */
  function startTurn({ runId, cwd, prompt, access = "read-only", model = "", effort = "", threadId = "", onEvent, requestApproval, admitUsage }) {
    const key = `run-${runId}`;
    let policyStop = null; // set when the provider does something no Hub run may do; the run ends as a tool violation
    let turnRequested = false; // until turn/start is sent, a Stop kills the process: no model call may follow it
    // Decided before the process starts: an MCP server that is not disabled would already run outside the sandbox.
    const mcpPlan = codexMcpLaunchPlan({ homeDir, cwd });
    if (mcpPlan.problem) {
      return { key, pid: null, interrupt: async () => ({ interrupted: false, graceful: true, reason: "not started" }),
        done: Promise.resolve({ status: "failed", errorCategory: "policy", preInference: true, error: mcpPlan.problem, output: "", usage: {}, threadId }) };
    }
    let turnId = "";
    let currentThread = threadId;
    let output = "";
    let usage = {};
    let settle;
    const completion = new Promise((resolve) => { settle = resolve; });
    let finished = false;
    const finish = (result) => { if (!finished) { finished = true; settle(result); } };

    const onNotification = (method, params) => {
      if (method === "item/agentMessage/delta" && typeof params.delta === "string") {
        output += params.delta;
        onEvent({ type: "delta", text: params.delta });
      } else if ((method === "item/started" || method === "item/completed") && params.item?.type === "mcpToolCall") {
        // Defense in depth: every MCP server is disabled and verified before the turn, so a call means one escaped.
        if (!policyStop) {
          policyStop = `Codex a apelat unealta MCP ${String(params.item.server || "?").slice(0, 60)}/${String(params.item.tool || "?").slice(0, 60)}: serverele MCP rulează în afara sandbox-ului și sunt oprite pentru execuțiile Hub; execuția s-a oprit`;
          onEvent({ type: "notice", level: "error", text: policyStop });
          interrupt("policy").catch(() => {});
        }
      } else if (method === "item/started" && ACTIVITY_ITEMS.has(params.item?.type)) {
        if (params.item.type === "commandExecution") onEvent({ type: "phase", phase: "first_command_started" });
        if (params.item.type === "fileChange") onEvent({ type: "phase", phase: "first_file_change" });
        onEvent({ type: "activity", label: describeItem(params.item) });
      } else if (method === "item/completed" && params.item?.type === "commandExecution") {
        onEvent({ type: "phase", phase: "first_command_completed" });
      } else if (method === "item/completed" && params.item?.type === "agentMessage" && !output && typeof params.item.text === "string") {
        output = params.item.text;
      } else if (method === "turn/diff/updated") {
        onEvent({ type: "diff", diff: String(params.diff || "").slice(0, 200000) });
      } else if (method === "turn/plan/updated") {
        onEvent({ type: "plan", plan: (params.plan || []).map((p) => ({ step: String(p.step || "").slice(0, 300), status: p.status })) });
      } else if (method === "thread/tokenUsage/updated") {
        usage = { ...usage, tokens: params.tokenUsage || params };
        onEvent({ type: "usage", usage });
      } else if (method === "account/rateLimits/updated") {
        const snapshot = normalizeRateLimits(params);
        usage = { ...usage, rateLimits: snapshot };
        const verdict = admitUsage?.(snapshot);
        onEvent({ type: "usage", usage });
        if (verdict && !verdict.ok) {
          onEvent({ type: "activity", label: `Stopping: ${verdict.reason}` });
          interrupt("quota").catch(() => {});
        }
      } else if (method === "model/rerouted") {
        onEvent({ type: "notice", level: "warning", text: `Provider rerouted model ${params.fromModel} -> ${params.toModel} (${params.reason || "no reason"})` });
      } else if (method === "error") {
        onEvent({ type: "notice", level: "error", text: String(params.error?.message || params.message || "provider error").slice(0, 500) });
      } else if (method === "turn/completed") {
        const turn = params.turn || {};
        const status = turn.status === "completed" ? "completed" : turn.status === "interrupted" ? "interrupted" : "failed";
        finish({ status, output, usage, threadId: currentThread, turnId: turn.id || turnId,
          errorCategory: status === "failed" ? classifyCodexTurnError(turn.error) : null, error: turn.error?.message || null, preInference: false });
      }
    };

    const onServerRequest = async (method, params) => {
      // v2 item/* requests answer accept|decline; the legacy requests answer a ReviewDecision (approved | denied{rejection}).
      const legacy = method === "execCommandApproval" || method === "applyPatchApproval";
      const reply = (decision) => ({ result: { decision: legacy ? (decision === "accept" ? "approved" : { denied: { rejection: "Ifrim Agent Hub: refuzat" } }) : (decision === "accept" ? "accept" : "decline") } });
      if (method === "item/commandExecution/requestApproval" || method === "execCommandApproval") {
        return reply(await requestApproval({ kind: "command", command: params.command || params.parsedCmd || params, cwd: params.cwd || cwd, reason: params.reason || "" }));
      }
      if (method === "item/fileChange/requestApproval" || method === "applyPatchApproval") {
        return reply(await requestApproval({ kind: "fileChange", changes: params.changes || params.fileChanges || params, reason: params.reason || "" }));
      }
      if (method === "item/permissions/requestApproval") return { result: { permissions: {}, scope: "turn" } };
      if (method === "mcpServer/elicitation/request") return { result: { action: "decline" } };
      if (method === "item/tool/requestUserInput") return { result: { answers: {} } };
      // Permission escalations (network/filesystem), token refresh, attestation and dynamic tools are refused.
      return { error: { code: -32000, message: `Ifrim Agent Hub declines ${method}` } };
    };

    let interruptReason = null;
    let extraArgs;
    try { extraArgs = [...mcpDisableArgs(mcpPlan.names), ...effortArgs(effort)]; } catch (error) {
      return { key, pid: null, interrupt: async () => ({ interrupted: false, graceful: true, reason: "not started" }),
        done: Promise.resolve({ status: "failed", errorCategory: "validation", preInference: true, error: error.message, output: "", usage: {}, threadId }) };
    }
    const phase = (name) => { try { onEvent({ type: "phase", phase: name }); } catch { /* timeline never breaks a run */ } };
    // The owner's config MCP servers are disabled by name for this process (key names only are read from config.toml).
    const session = openSession({ cwd, key, access, extraArgs, onNotification, onServerRequest,
      onExit: (exit) => finish(interruptReason
        ? { status: "interrupted", output, usage, threadId: currentThread, turnId, errorCategory: null, error: `interrupted (${interruptReason})`, preInference: !turnId }
        : { status: "failed", output, usage, threadId: currentThread, turnId, errorCategory: "transport", error: `app-server exited (${exit.code})`, preInference: !turnId }) });

    async function interrupt(reason = "user") {
      interruptReason = reason;
      // Before turn/start nothing reached the model: end the process now (the done flow also checks interruptReason
      // right before turn/start), so a Stop can never be followed by a model call.
      if (!turnRequested) {
        const stopped = await supervisor.stop(key, { graceMs: 0 });
        finish({ status: "interrupted", output, usage, threadId: currentThread, turnId: "", errorCategory: null, error: `interrupted (${reason})`, preInference: true });
        return { interrupted: stopped.stopped, graceful: false, reason };
      }
      // If turn/start is in flight, wait briefly for its id so the turn can be interrupted properly.
      for (let waited = 0; !turnId && !finished && waited < 3000; waited += 50) await new Promise((r) => setTimeout(r, 50));
      if (currentThread && turnId) {
        await session.peer.request("turn/interrupt", { threadId: currentThread, turnId }, 5000).catch(() => {});
        const graceful = await Promise.race([completion.then(() => true), new Promise((r) => setTimeout(() => r(false), 5000))]);
        if (graceful) { await supervisor.stop(key, { graceMs: 1000 }); return { interrupted: true, graceful: true, reason }; }
      }
      const stopped = await supervisor.stop(key, { graceMs: 500 });
      finish({ status: "interrupted", output, usage, threadId: currentThread, turnId, errorCategory: null, error: `interrupted (${reason})`, preInference: !turnId });
      return { interrupted: stopped.stopped, graceful: false, reason };
    }

    const done = (async () => {
      try {
        await session.ready;
        phase("initialized");
        const account = normalizeAccount(await session.peer.request("account/read", {}, 30000));
        phase("account_checked");
        onEvent({ type: "auth", auth: account });
        if (account.accountType !== "chatgpt") {
          return { status: "failed", errorCategory: account.accountType === "apiKey" ? "billing" : "authentication", preInference: true,
            error: `Codex account type ${account.accountType || "none"} is not the ChatGPT subscription route`, output, usage, threadId: currentThread };
        }
        const limits = normalizeRateLimits(await session.peer.request("account/rateLimits/read", {}, 30000));
        phase("rate_limits_checked");
        usage = { rateLimits: limits };
        onEvent({ type: "usage", usage });
        const verdict = admitUsage?.(limits) || { ok: true };
        if (!verdict.ok) return { status: "failed", errorCategory: "quota", preInference: true, error: verdict.reason, output, usage, threadId: currentThread };

        // approvalsReviewer "user": approvals come to the Hub as server requests, never to an auto_review subagent
        // selected in the owner's config (schema 0.159.0: user | auto_review | guardian_subagent).
        // No legacy `sandbox`: the Hub permission profile (default_permissions, set per process) decides access, and
        // Codex does not compose profiles with sandbox_mode (learn.chatgpt.com/docs/permissions).
        const threadParams = { cwd, approvalPolicy: "on-request", approvalsReviewer: "user", serviceName: "ifrim_agent_hub", ...(model ? { model } : {}) };
        let thread = null;
        if (currentThread) {
          thread = await session.peer.request("thread/resume", { threadId: currentThread, ...threadParams }, 60000).catch((error) => {
            onEvent({ type: "notice", level: "warning", text: `Could not resume Codex thread (${error.message}); starting a new thread with the Hub context package` });
            return null;
          });
          // A thread created before M03 keeps the effort it was created with (e.g. the config's "max"); it is not continued
          // with another effort silently: a new thread starts with the Hub context package and the requested effort.
          const resumedEffort = String(thread?.reasoningEffort ?? "").trim().toLowerCase();
          if (thread && effort && resumedEffort && resumedEffort !== effort) {
            onEvent({ type: "notice", level: "warning", text: `Thread-ul reluat are efortul ${thread.reasoningEffort}; pornesc un thread nou cu efortul cerut ${effort} și pachetul de context al Hub-ului` });
            thread = null;
            currentThread = "";
          }
        }
        if (!thread) thread = await session.peer.request("thread/start", threadParams, 120000);
        currentThread = thread?.thread?.id || currentThread;
        if (!currentThread) throw Object.assign(new Error("Codex did not return a thread id"), { category: "transport" });
        phase("thread_ready");
        onEvent({ type: "session", nativeSessionId: currentThread, model: thread.model, reasoningEffort: thread.reasoningEffort, sandbox: thread.sandbox });
        // Last checks before turn/start (no model call yet): the Hub stays the approver and gets the model it asked for.
        if (thread.approvalsReviewer && thread.approvalsReviewer !== "user") {
          return { status: "failed", errorCategory: "policy", preInference: true, output, usage, threadId: currentThread,
            error: `Codex a raportat approvalsReviewer=${thread.approvalsReviewer}: aprobările nu ar mai ajunge la Hub; oprit înainte de turn` };
        }
        const projected = thread.sandbox?.type || "";
        // externalSandbox = Codex applies no sandbox of its own (it trusts an outer one the Hub does not provide).
        if (projected === "dangerFullAccess" || projected === "externalSandbox" || (access !== "workspace-write" && projected === "workspaceWrite")) {
          return { status: "failed", errorCategory: "policy", preInference: true, output, usage, threadId: currentThread,
            error: `Codex a raportat sandbox ${projected} pentru acces ${access}: profilul Hub nu este activ; oprit înainte de turn` };
        }
        // Exact id, normalised only for case and surrounding spaces: a prefix match let a requested "gpt-5" run as "gpt-5-mini".
        const modelId = (value) => String(value ?? "").trim().toLowerCase();
        const [wantedModel, reportedModel] = [modelId(model), modelId(thread.model)];
        if (wantedModel && reportedModel && reportedModel !== wantedModel) {
          return { status: "failed", errorCategory: "policy", preInference: true, output, usage, threadId: currentThread,
            error: `Codex a ales modelul ${thread.model} în loc de ${model}; oprit înainte de turn (fără substituire tăcută)` };
        }
        // The effort the thread will use must be the one the Hub set for this process (never the config's "max" by accident).
        const reportedEffort = String(thread.reasoningEffort ?? "").trim().toLowerCase();
        if (effort && reportedEffort && reportedEffort !== effort) {
          return { status: "failed", errorCategory: "policy", preInference: true, output, usage, threadId: currentThread,
            error: `Codex a raportat efortul ${thread.reasoningEffort} în loc de ${effort}; oprit înainte de turn (fără efort moștenit din config)` };
        }

        // No MCP server may be active for a Hub run: they run outside the sandbox (plugins and config servers are disabled
        // above; a name that cannot be addressed as a dotted path, or a Codex that ignores the override, stops here).
        const activeMcp = await activeMcpServers(session.peer, currentThread);
        phase("mcp_checked");
        if (activeMcp.length) {
          return { status: "failed", errorCategory: "policy", preInference: true, output, usage, threadId: currentThread,
            error: `Servere MCP încă active pentru execuție (${activeMcp.slice(0, 5).join(", ")}); rulează în afara sandbox-ului; oprit înainte de turn` };
        }
        if (interruptReason) return { status: "interrupted", errorCategory: null, preInference: true, error: `interrupted (${interruptReason})`, output, usage, threadId: currentThread, turnId: "" };
        turnRequested = true;
        phase("turn_sent");

        const turn = await session.peer.request("turn/start", { threadId: currentThread, input: [{ type: "text", text: prompt }], cwd,
          approvalPolicy: "on-request", approvalsReviewer: "user", ...(model ? { model } : {}), ...(effort ? { effort } : {}) }, 60000);
        turnId = turn?.turn?.id || "";
        phase("turn_acknowledged");
        onEvent({ type: "turn", turnId });
        const result = await completion;
        // "tool", not "policy": the model already ran (policy counts as a pre-inference stop in the run record).
        return policyStop ? { ...result, status: "failed", errorCategory: "tool", preInference: false, error: policyStop } : result;
      } catch (error) {
        if (interruptReason) return { status: "interrupted", errorCategory: null, preInference: !turnId, error: `interrupted (${interruptReason})`, output, usage, threadId: currentThread, turnId };
        const category = error.category || classifyText(error.message);
        return { status: "failed", errorCategory: category, preInference: !turnId, error: error.message, output, usage, threadId: currentThread, turnId };
      } finally {
        finish({ status: "failed", errorCategory: "task", error: "turn ended without completion", preInference: !turnId, output, usage, threadId: currentThread, turnId });
        await supervisor.stop(key, { graceMs: 1500 });
        supervisor.forget(key);
      }
    })();

    return { key, pid: session.record.pid, done, interrupt };
  }

  return { id, displayName: "Codex (ChatGPT plan)", inspectInstallation, probe, startTurn, openSession, inspectConfig: () => inspectCodexConfig(homeDir) };
}

export function normalizeAccount(response) {
  const account = response?.account || null;
  if (!account) return { accountType: "none", requiresOpenaiAuth: Boolean(response?.requiresOpenaiAuth) };
  const type = account.type === "apiKey" || account.type === "apikey" ? "apiKey" : account.type;
  return { accountType: type, planType: account.planType || null, requiresOpenaiAuth: Boolean(response?.requiresOpenaiAuth) };
}

export function normalizeRateLimits(response) {
  const snapshot = response?.rateLimits || response || {};
  const windows = [];
  for (const [name, win] of [["primary", snapshot.primary], ["secondary", snapshot.secondary]]) {
    if (win && typeof win.usedPercent === "number") windows.push({ name, usedPercent: win.usedPercent, windowMinutes: win.windowDurationMins ?? null, resetsAt: win.resetsAt ? new Date(Number(win.resetsAt) * 1000).toISOString() : null });
  }
  return {
    source: "codex app-server account/rateLimits", capturedAt: new Date().toISOString(), planType: snapshot.planType || null,
    windows, ordinaryUsageAllowed: response?.ordinaryUsageAllowed ?? null,
    limitReached: Boolean(snapshot.rateLimitReachedType), limitReachedType: snapshot.rateLimitReachedType || null,
    spendControlReached: snapshot.spendControlReached ?? null,
    creditsReported: snapshot.credits ? { hasCredits: snapshot.credits.hasCredits ?? null, unlimited: snapshot.credits.unlimited ?? null, balance: snapshot.credits.balance ?? null } : null,
  };
}

function describeItem(item) {
  if (item.type === "commandExecution") return `Codex command: ${String(item.command || "").slice(0, 120)}`;
  if (item.type === "fileChange") return `Codex file change (${(item.changes || []).length} files)`;
  if (item.type === "mcpToolCall") return `Codex MCP tool: ${item.server || ""}/${item.tool || ""}`;
  if (item.type === "webSearch") return "Codex web search";
  return `Codex ${item.type}`;
}
