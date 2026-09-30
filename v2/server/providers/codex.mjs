import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parse as parseToml } from "smol-toml";
import { createJsonRpcPeer } from "./jsonrpc.mjs";
import { classifyCodexTurnError, classifyText } from "./classify.mjs";
import { buildChildEnv } from "../policy/billing.mjs";
import { HUB_VERSION } from "../config.mjs";

const execFileAsync = promisify(execFile);

/**
 * Methods the Hub may call on the Codex app-server (schema verified against codex-cli
 * 0.158.0-alpha.2.1 `generate-json-schema`). Everything else — including
 * account/rateLimitResetCredit/consume, account/sendAddCreditsNudgeEmail, login/logout, config
 * writes, plugin/marketplace installs and thread deletion — is refused client-side.
 */
export const CODEX_ALLOWED_METHODS = new Set([
  "initialize", "thread/start", "thread/resume", "thread/read", "turn/start", "turn/interrupt",
  "model/list", "account/read", "account/rateLimits/read",
]);

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
 * - multi_agent: subagents multiply plan usage beyond the Hub concurrency limit.
 * web_search is a hosted tool that bypasses the sandbox network setting (web-search): disabled.
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
  "-c", 'web_search="disabled"',
]);

const ACTIVITY_ITEMS = new Set(["commandExecution", "fileChange", "mcpToolCall", "webSearch", "imageView", "collabToolCall"]);

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
  if (!fs.existsSync(file)) return { present: false, customProvider: null, apiKeyAuthPreferred: false };
  try {
    const data = parseToml(fs.readFileSync(file, "utf8"));
    const provider = typeof data.model_provider === "string" && data.model_provider !== "openai" ? data.model_provider : null;
    const prefersKey = [data.preferred_auth_method, data.forced_login_method].some((v) => typeof v === "string" && /api/i.test(v));
    // Informative: Hub app-servers override it per process (CODEX_APP_SERVER_OVERRIDES).
    const fastTierPersisted = typeof data.service_tier === "string" && /fast|priority/i.test(data.service_tier);
    return { present: true, customProvider: provider, apiKeyAuthPreferred: prefersKey, definesProviders: Boolean(data.model_providers), fastTierPersisted };
  } catch (error) {
    return { present: true, unreadable: true, customProvider: null, apiKeyAuthPreferred: false, error: "config.toml could not be parsed" };
  }
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
  function openSession({ cwd, key, onNotification, onServerRequest, onExit }) {
    const binary = resolveCodexBinary(config);
    if (!binary) throw Object.assign(new Error("Codex client not installed"), { category: "transport", preInference: true });
    let peer;
    const record = supervisor.start({
      key, label: "codex app-server", executable: binary.executable, args: [...binary.prefixArgs, ...CODEX_APP_SERVER_OVERRIDES, "app-server"], cwd,
      onStdoutLine: (line) => peer.handleLine(line),
    });
    peer = createJsonRpcPeer({
      write: (text) => { try { record.child.stdin.write(`${text}\n`); } catch { /* process gone */ } },
      allowedMethods: CODEX_ALLOWED_METHODS, onNotification, onServerRequest,
    });
    record.exit.then((exit) => {
      peer.failAll(Object.assign(new Error(`codex app-server exited (${exit.code})${record.stderrTail.length ? `: ${record.stderrTail.slice(-3).join(" | ")}` : ""}`), { category: "transport" }));
      onExit?.(exit);
    });
    const ready = (async () => {
      const init = await peer.request("initialize", { clientInfo: { name: "ifrim_agent_hub", title: "Ifrim Agent Hub", version: HUB_VERSION }, capabilities: { experimentalApi: false } }, 30000);
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
      } else if (method === "item/started" && ACTIVITY_ITEMS.has(params.item?.type)) {
        onEvent({ type: "activity", label: describeItem(params.item) });
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
      if (method === "item/commandExecution/requestApproval" || method === "execCommandApproval") {
        const decision = await requestApproval({ kind: "command", command: params.command || params.parsedCmd || params, cwd: params.cwd || cwd, reason: params.reason || "" });
        return { result: { decision: decision === "accept" ? "accept" : "decline" } };
      }
      if (method === "item/fileChange/requestApproval" || method === "applyPatchApproval") {
        const decision = await requestApproval({ kind: "fileChange", changes: params.changes || params.fileChanges || params, reason: params.reason || "" });
        return { result: { decision: decision === "accept" ? "accept" : "decline" } };
      }
      if (method === "mcpServer/elicitation/request") return { result: { action: "decline" } };
      if (method === "item/tool/requestUserInput") return { result: { answers: {} } };
      // Permission escalations (network/filesystem), token refresh, attestation and dynamic tools are refused.
      return { error: { code: -32000, message: `Ifrim Agent Hub declines ${method}` } };
    };

    let interruptReason = null;
    const session = openSession({ cwd, key, onNotification, onServerRequest,
      onExit: (exit) => finish(interruptReason
        ? { status: "interrupted", output, usage, threadId: currentThread, turnId, errorCategory: null, error: `interrupted (${interruptReason})`, preInference: !turnId }
        : { status: "failed", output, usage, threadId: currentThread, turnId, errorCategory: "transport", error: `app-server exited (${exit.code})`, preInference: !turnId }) });

    async function interrupt(reason = "user") {
      interruptReason = reason;
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
        const account = normalizeAccount(await session.peer.request("account/read", {}, 30000));
        onEvent({ type: "auth", auth: account });
        if (account.accountType !== "chatgpt") {
          return { status: "failed", errorCategory: account.accountType === "apiKey" ? "billing" : "authentication", preInference: true,
            error: `Codex account type ${account.accountType || "none"} is not the ChatGPT subscription route`, output, usage, threadId: currentThread };
        }
        const limits = normalizeRateLimits(await session.peer.request("account/rateLimits/read", {}, 30000));
        usage = { rateLimits: limits };
        onEvent({ type: "usage", usage });
        const verdict = admitUsage?.(limits) || { ok: true };
        if (!verdict.ok) return { status: "failed", errorCategory: "quota", preInference: true, error: verdict.reason, output, usage, threadId: currentThread };

        // approvalsReviewer "user": approvals come to the Hub as server requests, never to an auto_review subagent
        // selected in the owner's config (schema 0.159.0: user | auto_review | guardian_subagent).
        const threadParams = { cwd, approvalPolicy: "on-request", approvalsReviewer: "user", sandbox: access === "workspace-write" ? "workspace-write" : "read-only", serviceName: "ifrim_agent_hub", ...(model ? { model } : {}) };
        let thread = null;
        if (currentThread) {
          thread = await session.peer.request("thread/resume", { threadId: currentThread, ...threadParams }, 60000).catch((error) => {
            onEvent({ type: "notice", level: "warning", text: `Could not resume Codex thread (${error.message}); starting a new thread with the Hub context package` });
            return null;
          });
        }
        if (!thread) thread = await session.peer.request("thread/start", threadParams, 120000);
        currentThread = thread?.thread?.id || currentThread;
        if (!currentThread) throw Object.assign(new Error("Codex did not return a thread id"), { category: "transport" });
        onEvent({ type: "session", nativeSessionId: currentThread, model: thread.model, reasoningEffort: thread.reasoningEffort, sandbox: thread.sandbox });
        // Last checks before turn/start (no model call yet): the Hub stays the approver and gets the model it asked for.
        if (thread.approvalsReviewer && thread.approvalsReviewer !== "user") {
          return { status: "failed", errorCategory: "policy", preInference: true, output, usage, threadId: currentThread,
            error: `Codex a raportat approvalsReviewer=${thread.approvalsReviewer}: aprobările nu ar mai ajunge la Hub; oprit înainte de turn` };
        }
        if (model && thread.model && !String(thread.model).toLowerCase().startsWith(String(model).toLowerCase())) {
          return { status: "failed", errorCategory: "policy", preInference: true, output, usage, threadId: currentThread,
            error: `Codex a ales modelul ${thread.model} în loc de ${model}; oprit înainte de turn (fără substituire tăcută)` };
        }

        const sandboxPolicy = access === "workspace-write"
          ? { type: "workspaceWrite", writableRoots: [cwd], networkAccess: false }
          : { type: "readOnly", networkAccess: false };
        const turn = await session.peer.request("turn/start", { threadId: currentThread, input: [{ type: "text", text: prompt }], cwd,
          approvalPolicy: "on-request", approvalsReviewer: "user", sandboxPolicy, ...(model ? { model } : {}), ...(effort ? { effort } : {}) }, 60000);
        turnId = turn?.turn?.id || "";
        onEvent({ type: "turn", turnId });
        return await completion;
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

  return { id, displayName: "Codex (ChatGPT plan)", inspectInstallation, probe, startTurn, inspectConfig: () => inspectCodexConfig(homeDir) };
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
