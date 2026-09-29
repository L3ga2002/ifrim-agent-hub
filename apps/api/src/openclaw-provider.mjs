import { createHash } from "node:crypto";
import path from "node:path";
import { connectOpenClaw } from "./openclaw-gateway.mjs";
import { assertSubscriptionGate } from "./openclaw-subscription-gate.mjs";
import { subscriptionProfiles } from "./subscription-auth.mjs";

export function verifySessionBinding(created, options, key) {
  const entry = created.entry || {};
  const resolved = created.resolved || {};
  const cwd = entry.spawnedCwd || entry.sessionRoot || "";
  const paths = /^[A-Za-z]:[\\/]/.test(options.cwd) ? path.win32 : path;
  const samePath = cwd && paths.resolve(cwd).toLowerCase() === paths.resolve(options.cwd).toLowerCase();
  const runtime = options.provider === "codex" ? "codex" : "claude-cli";
  if (created.key !== key || !created.sessionId || created.runStarted) return "OpenClaw session identity or idle state not confirmed";
  if (!samePath || entry.permissionMode !== options.accessMode) return "OpenClaw workspace or permissions do not match";
  if (entry.agentRuntimeOverride !== runtime || `${resolved.modelProvider}/${resolved.model}` !== options.model || entry.thinkingLevel !== options.reasoning) return "OpenClaw session route does not match";
  if (entry.authProfileOverride !== subscriptionProfiles[options.provider] || entry.authProfileOverrideSource !== "user") return "OpenClaw subscription authentication binding does not match";
  return "";
}

export function hasUnknownLiveness(result) {
  const payload = result.result || result;
  const state = payload.meta?.livenessState || result.livenessState;
  return ["unknown", "paused", "running", "pending", "blocked"].includes(state) || payload.meta?.yielded === true || result.pendingError === true
    || ["pending", "accepted", "timeout"].includes(result.status);
}

export function isKnownPreAdmissionRejection(error, { submitted, admitted, gatewayRunId, streamed }) {
  return submitted === true && admitted === false && !gatewayRunId && !streamed
    && (error?.gatewayCode || error?.code) === "INVALID_REQUEST"
    && error?.message === "expectedExistingSessionId is reserved for backend callers.";
}

export async function connectCertifiedOpenClaw(onEvent, options, { certify = assertSubscriptionGate, connect = connectOpenClaw } = {}) {
  const verified = await certify(options);
  if ((options.accessMode ?? "read-only") === "read-only" && verified.config.agents?.defaults?.skipBootstrap !== true) {
    throw new Error("Read-only execution requires automatic workspace bootstrap to be disabled");
  }
  const client = await connect(onEvent, verified.config);
  try {
    const snapshot = await client.request("config.get", {}, { timeoutMs: 30000 });
    if (snapshot.valid !== true || snapshot.hash !== verified.gatewayConfigHash || !snapshot.configRevisionHash
      || !snapshot.appliedConfigHash || snapshot.appliedConfigHash !== snapshot.configRevisionHash) {
      throw new Error("OpenClaw applied gateway configuration is not the certified revision");
    }
    client.hubGatewayPort = verified.config.gateway?.port;
    return client;
  } catch (error) { await client.stopAndWait().catch(() => {}); throw error; }
}

export function verifyProviderResult(payload, options) {
  const meta = payload.meta || {};
  const agent = meta.agentMeta || {};
  const trace = meta.executionTrace;
  const canonical = (provider, model) => {
    const canonicalProvider = options.provider === "claude" && provider === "claude-cli" ? "anthropic" : provider;
    return String(model || "").includes("/") ? model : `${canonicalProvider}/${model}`;
  };
  const runtime = options.provider === "codex" ? "codex" : "claude-cli";
  if (meta.aborted || meta.error || payload.payloads?.some((part) => part.isError)) return "OpenClaw reported an aborted or failed turn";
  if (canonical(agent.provider, agent.model) !== options.model) return "OpenClaw reported a different or missing model";
  if (agent.agentHarnessId !== runtime) return "Native subscription runtime not verified";
  if (!trace || trace.fallbackUsed !== false || !trace.attempts?.length
    || canonical(trace.winnerProvider, trace.winnerModel) !== options.model
    || trace.attempts.some((attempt) => canonical(attempt.provider, attempt.model) !== options.model)) return "Fallback evidence is missing or unapproved";
  if (meta.requestShaping?.thinking !== options.reasoning) return "Reasoning effort not verified";
  return "";
}

export function gatewaySessionKey({ conversationId, provider, agentId, accessMode, model, reasoning }) {
  if (!conversationId || !["codex", "claude"].includes(provider) || !/^ifrim-[a-z-]+$/.test(agentId)) throw new Error("Invalid OpenClaw session binding");
  const id = createHash("sha256").update(JSON.stringify([conversationId, provider, accessMode, model, reasoning])).digest("hex").slice(0, 32);
  return `agent:${agentId}:ifrim-hub:${id}`;
}

export function startOpenClawProvider(options, connect = (onEvent) => connectCertifiedOpenClaw(onEvent, options)) {
  const { cwd, prompt, provider, model, reasoning, agentId, conversationId, runId,
    accessMode = "read-only", onEvent = () => {}, timeoutSeconds = 1800 } = options;
  const key = gatewaySessionKey({ conversationId, provider, agentId, accessMode, model, reasoning });
  let client;
  let gatewayRunId = "";
  let cancelled = false;
  let admitted = false;
  let submitted = false;
  let settled = false;
  let streamed = "";
  let fatalError = "";
  const rpcDiagnostics = { requests: [], error: null };
  const recordRequest = (method, requestId) => {
    const record = { method, requestId: String(requestId || "").slice(0, 160), sentAt: new Date().toISOString() };
    rpcDiagnostics.requests.push(record);
    onEvent({ type: "rpc", ...record });
  };
  const done = (async () => {
    try {
      onEvent({ type: "activity", label: "OpenClaw: verificare runtime si abonament" });
      client = await connect((event) => {
        const data = event.payload || {};
        if (data.sessionKey !== key || (gatewayRunId && data.runId && data.runId !== gatewayRunId)) return;
        if (event.event === "agent" && data.stream === "assistant") {
          const delta = typeof data.data?.delta === "string" ? data.data.delta : "";
          if (delta) { streamed = (streamed + delta).slice(-200000); onEvent({ type: "delta", text: delta }); }
        }
        if (event.event === "agent" && data.stream === "tool") onEvent({ type: "activity", label: `OpenClaw: ${String(data.data?.name || "tool").slice(0, 60)}` });
      });
      onEvent({ type: "activity", label: "OpenClaw: conexiune certificata" });
      if (cancelled) return { status: "cancelled", output: "", nativeSessionId: key, usage: { status: "unknown" } };
      const pinnedModel = `${model}@${subscriptionProfiles[provider]}`;
      const created = await client.request("sessions.create", { key, agentId, cwd, model: pinnedModel,
        agentRuntime: provider === "codex" ? "codex" : "claude-cli", thinkingLevel: reasoning,
        permissionMode: accessMode, toolOverrides: { webSearch: false },
        displayName: `Ifrim Hub ${provider} ${conversationId.slice(-12)}`, category: "Ifrim Agent Hub" },
        { timeoutMs: 120000, onSent: (requestId) => recordRequest("sessions.create", requestId) });
      const bindingError = verifySessionBinding(created, options, key);
      if (bindingError) {
        if (created.runStarted) return { status: "blocked", output: "", retainLease: true, error: bindingError, errorCategory: "REMOTE_STATE_UNKNOWN", usage: { status: "unknown" } };
        throw new Error(bindingError);
      }
      if (cancelled) return { status: "cancelled", output: "", nativeSessionId: key, usage: { status: "unknown" } };
      onEvent({ type: "binding", sessionKey: key, sessionId: created.sessionId, gatewayPort: client.hubGatewayPort, transport: "openclaw" });
      const result = await client.request("agent", { agentId, sessionKey: key,
        sessionId: created.sessionId, expectedExistingSessionId: created.sessionId, message: prompt, model: pinnedModel, thinking: reasoning,
        deliver: false, disableMessageTool: true, timeout: timeoutSeconds, idempotencyKey: runId,
      }, { expectFinal: true, timeoutMs: (timeoutSeconds + 300) * 1000,
        onSent: (requestId) => { submitted = true; recordRequest("agent", requestId); },
        onAccepted: (receipt) => {
          gatewayRunId = receipt?.runId || ""; admitted = true;
          onEvent({ type: "binding", sessionKey: key, sessionId: created.sessionId, gatewayRunId, gatewayPort: client.hubGatewayPort, transport: "openclaw" });
          onEvent({ type: "activity", label: "OpenClaw: run admitted" });
          if (cancelled) client.request("chat.abort", { sessionKey: key, agentId, ...(gatewayRunId ? { runId: gatewayRunId } : {}) }, { timeoutMs: 30000 }).catch(() => {});
        } });
      const payload = result.result || result;
      if (hasUnknownLiveness(result)) return { status: "blocked", output: streamed, nativeSessionId: key, gatewayRunId,
        retainLease: true, error: "Remote terminal state is not confirmed", errorCategory: "REMOTE_STATE_UNKNOWN", usage: { status: "unknown" } };
      const meta = payload.meta?.agentMeta || {};
      const output = (payload.payloads || []).map((part) => part.text || "").join("\n") || streamed;
      const actual = { provider: meta.provider || "", model: meta.model || "", reasoning: payload.meta?.requestShaping?.thinking || "",
        harness: meta.agentHarnessId || "", fallbackUsed: payload.meta?.executionTrace?.fallbackUsed };
      const failure = result.status !== "ok" || !output ? "OpenClaw did not complete with a response"
        : verifyProviderResult(payload, options);
      actual.verified = !failure;
      settled = true;
      return { status: cancelled ? "cancelled" : failure ? "failed" : "completed", output,
        nativeSessionId: key, gatewaySessionId: created.sessionId, gatewayRunId, actual,
        usage: meta.usage ? { status: "reported", ...meta.usage } : { status: "unknown" },
        error: failure, errorCategory: failure ? "MODEL_VERIFICATION" : "" };
    } catch (error) {
      fatalError = error.message;
      rpcDiagnostics.error = {
        code: typeof error.code === "string" ? error.code.slice(0, 80) : "",
        method: typeof error.method === "string" ? error.method.slice(0, 80) : "",
        timeoutMs: Number.isFinite(error.timeoutMs) ? error.timeoutMs : null,
        requestSent: typeof error.requestSent === "boolean" ? error.requestSent : null,
      };
      if (isKnownPreAdmissionRejection(error, { submitted, admitted, gatewayRunId, streamed })) {
        return { status: "failed", output: "", nativeSessionId: key, error: fatalError,
          errorCategory: "PRE_ADMISSION_REJECTED", rpcDiagnostics, usage: { status: "not_started" } };
      }
      // Never release a lease on a transport failure while remote work may still be alive.
      if ((admitted || submitted) && !settled && client) {
        try {
          await client.request("chat.abort", { sessionKey: key, agentId, ...(gatewayRunId ? { runId: gatewayRunId } : {}) }, { timeoutMs: 30000 });
          const terminal = gatewayRunId ? await client.request("agent.wait", { runId: gatewayRunId, timeoutMs: 30000 }, { timeoutMs: 35000 }) : null;
          if (!terminal || hasUnknownLiveness(terminal) || !terminal.endedAt || !["ok", "error", "cancelled", "aborted"].includes(terminal.status)) throw new Error("Terminal state not confirmed");
        } catch { return { status: "blocked", output: streamed, nativeSessionId: key, error: fatalError, errorCategory: "REMOTE_STATE_UNKNOWN", rpcDiagnostics, retainLease: true, usage: { status: "unknown" } }; }
      }
      return { status: cancelled ? "cancelled" : "failed", output: streamed, nativeSessionId: key,
        error: fatalError, errorCategory: "OPENCLAW_ERROR", rpcDiagnostics, usage: { status: "unknown" } };
    } finally { if (client) await client.stopAndWait().catch(() => {}); }
  })();
  return { pid: 0, sessionKey: key, done, stop: async () => {
    cancelled = true;
    if (client && admitted && !settled) {
      const result = await client.request("chat.abort", { sessionKey: key, agentId, ...(gatewayRunId ? { runId: gatewayRunId } : {}) }, { timeoutMs: 30000 });
      if (!result.ok && !result.aborted) return false;
    }
    let timer;
    const result = await Promise.race([done, new Promise((resolve) => { timer = setTimeout(() => resolve({ retainLease: true }), 35000); })]);
    clearTimeout(timer);
    return !result.retainLease;
  } };
}
