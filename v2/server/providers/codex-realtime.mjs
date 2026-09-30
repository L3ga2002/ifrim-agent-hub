import { normalizeAccount, normalizeRateLimits, mcpDisableArgs, activeMcpServers } from "./codex.mjs";

export { mcpDisableArgs };
import { classifyText } from "./classify.mjs";
import { redactText } from "../security/redact.mjs";
import { legaDynamicTools, legaAgentInstructions, legaVoicePrompt, LEGA_VOICES } from "../policy/lega-policy.mjs";

/**
 * GPT-Live voice through codex app-server (thread/realtime/*, EXPERIMENTAL on codex-cli 0.159.2), for Lega.
 *
 * A SEPARATE app-server process, never a run process:
 * - experimentalApi:true only here; its own allowlist (no turn/start, no thread/resume, no appendAudio/appendText, no config or
 *   account writes);
 * - same Hub overrides + read-only isolation profile + controlled environment (API keys stripped) as runs;
 * - the thread has NO turn environments (`environments: []`, verified in the thread/start response): delegated turns get no
 *   shell, file or patch tools, only the `lega` dynamic tools, which the Hub answers through its command bus;
 * - every MCP server from the owner's config is disabled by name (`mcp_servers.<name>.enabled=false`; an empty
 *   `mcp_servers={}` override is a no-op because Codex deep-merges config layers), then `mcpServerStatus/list` must report
 *   no active server before voice starts; subagents are off (`agents.enabled=false`);
 * - transport is always WebRTC v3 (the default websocket transport needs an API key); the browser owns the peer connection
 *   and the audio never passes through the Hub.
 * - web search (hosted, no local reach) only when the owner has it on for Lega; every search is shown and logged.
 * Anything other than messages, reasoning, plans, `lega` tool calls and allowed web searches on the Lega thread (or any
 * activity on another thread) is a violation: the process is killed at once.
 */
export const CODEX_VOICE_ALLOWED_METHODS = new Set([
  "initialize", "account/read", "account/rateLimits/read", "thread/start", "mcpServerStatus/list",
  "thread/realtime/start", "thread/realtime/stop", "thread/realtime/appendSpeech", "thread/realtime/listVoices", "turn/interrupt",
]);

export const CODEX_VOICE_EXTRA_ARGS = Object.freeze([
  "-c", 'experimental_realtime_ws_backend_prompt=""', // a config prompt would replace the Lega persona
  "-c", "agents.enabled=false", // no subagents behind Lega (they would escape the Hub's accounting)
  // Plugins (and their MCP servers, e.g. Computer Use's cua_repl) are off for every Hub process: CODEX_APP_SERVER_OVERRIDES.
]);


/**
 * Item types allowed on the Lega thread; every other type (commands, files, MCP, images, subagents, review) ends the session.
 * `webSearch` is added only while the owner has web search on for Lega (a hosted tool that reaches no local file).
 */
export const LEGA_ALLOWED_ITEMS = new Set(["agentMessage", "reasoning", "dynamicToolCall", "userMessage", "plan", "contextCompaction", "functionCallOutput", "hookPrompt", "sleep"]);
export const legaAllowedItems = (webSearch = "disabled") => (webSearch === "disabled" ? LEGA_ALLOWED_ITEMS : new Set([...LEGA_ALLOWED_ITEMS, "webSearch"]));
const webSearchText = (item) => {
  const action = item.action || {};
  const text = action.type === "openPage" ? `deschide ${action.url || ""}` : action.type === "findInPage" ? `caută „${action.pattern || ""}” în ${action.url || "pagină"}` : item.query || action.query || (action.queries || []).join(" · ");
  return redactText(String(text || "")).replace(/\s+/g, " ").trim().slice(0, 300);
};
const V2_APPROVALS = new Set(["item/commandExecution/requestApproval", "item/fileChange/requestApproval"]);
const LEGACY_APPROVALS = new Set(["execCommandApproval", "applyPatchApproval"]);
const TOOL_REPLY_TIMEOUT_MS = 5000;
const TOOL_REPLY_MAX = 6000;

const withTimeout = (promise, ms, label) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error(`${label} timed out after ${ms} ms`), { category: "transport", timeout: true })), ms))]);
const cancelled = () => Object.assign(new Error("Pornirea Lega a fost anulată"), { category: "cancelled", preInference: true });

export function createCodexRealtime({ codex, supervisor }) {
  /**
   * Opens a voice session and returns the SDP answer for the browser. `onEvent` receives normalized events; `onToolCall`
   * answers `lega.*` tool calls ({ok, text}); `admitUsage` applies the plan-reserve ceiling; `signal` cancels a start in
   * flight (the process is killed and no realtime call is created after the abort).
   */
  async function openVoice({ sessionId, cwd, offerSdp, voice = "cove", projects = [], context = {}, webSearch = "disabled", ownerName = "", mcpServerNames = [], signal, onEvent = () => {}, onToolCall, admitUsage }) {
    if (!LEGA_VOICES.includes(voice)) throw Object.assign(new Error(`Unsupported voice ${voice}`), { category: "validation", preInference: true });
    const allowedItems = legaAllowedItems(webSearch);
    const key = `voice-${sessionId}`;
    let threadId = "";
    let stopped = false;
    let stopping = null;
    let realtimeRequested = false;
    const activeTurns = new Set();
    const turnText = new Map(); // turnId -> streamed agent text
    const deferred = () => { let resolve; let reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); promise.catch(() => {}); return { promise, resolve, reject }; };
    const startedD = deferred(); const sdpD = deferred();
    // Rejecting after a resolve is a no-op, so late errors/closes never break an established session here.
    const rejectStart = (error) => { startedD.reject(error); sdpD.reject(error); };
    const violation = (itemType) => onEvent({ type: "forbidden_item", itemType });

    const onNotification = (method, params) => {
      // Activity on any other thread (subagents, spawned threads) is never allowed behind Lega.
      if (params?.threadId && threadId && params.threadId !== threadId) {
        if (method === "turn/started" || method === "item/started") violation(`other-thread:${params.item?.type || "turn"}`);
        return;
      }
      switch (method) {
        case "thread/realtime/started": startedD.resolve({ realtimeSessionId: params.realtimeSessionId || null, version: params.version || null }); break;
        case "thread/realtime/sdp": sdpD.resolve(String(params.sdp || "")); break;
        case "thread/realtime/transcript/delta": onEvent({ type: "transcript.delta", role: params.role, delta: String(params.delta || "") }); break;
        case "thread/realtime/transcript/done": onEvent({ type: "transcript.done", role: params.role, text: String(params.text || "") }); break;
        case "thread/realtime/itemAdded":
          if (params.item?.type === "handoff_request") onEvent({ type: "delegation", handoffId: params.item.handoff_id || null, text: String(params.item.input_transcript || "") });
          break;
        case "thread/realtime/error": {
          const message = redactText(String(params.message || "realtime error")).slice(0, 500);
          rejectStart(Object.assign(new Error(message), { category: classifyText(message) }));
          onEvent({ type: "error", message });
          break;
        }
        case "thread/realtime/closed":
          rejectStart(Object.assign(new Error(`realtime closed (${params.reason || "no reason"})`), { category: "transport" }));
          onEvent({ type: "closed", reason: params.reason || null });
          break;
        case "turn/started": if (params.turn?.id) { activeTurns.add(params.turn.id); onEvent({ type: "turn.started", turnId: params.turn.id }); } break;
        case "item/agentMessage/delta": if (params.turnId) turnText.set(params.turnId, (turnText.get(params.turnId) || "") + String(params.delta || "")); break;
        case "item/started":
        case "item/completed":
          if (params.item?.type && !allowedItems.has(params.item.type)) { violation(params.item.type); break; }
          if (method === "item/completed" && params.item?.type === "webSearch") onEvent({ type: "web.search", text: webSearchText(params.item) });
          if (method === "item/completed" && params.item?.type === "agentMessage" && typeof params.item.text === "string" && params.turnId) turnText.set(params.turnId, params.item.text);
          break;
        case "turn/completed": {
          const turn = params.turn || {};
          activeTurns.delete(turn.id);
          onEvent({ type: "turn.completed", turnId: turn.id, status: turn.status, text: turnText.get(turn.id) || "", error: turn.error?.message || null });
          turnText.delete(turn.id);
          break;
        }
        case "account/rateLimits/updated": {
          const verdict = admitUsage?.(normalizeRateLimits(params));
          if (verdict && !verdict.ok) onEvent({ type: "quota", reason: verdict.reason });
          break;
        }
        default: break;
      }
    };

    const onServerRequest = async (method, params) => {
      if (method === "item/tool/call") {
        if (params.namespace !== "lega" || !onToolCall) return { result: { contentItems: [{ type: "inputText", text: "Unealtă necunoscută pentru Lega." }], success: false } };
        try {
          const reply = await withTimeout(Promise.resolve(onToolCall({ tool: String(params.tool || ""), args: params.arguments || {}, turnId: params.turnId, callId: params.callId })), TOOL_REPLY_TIMEOUT_MS, "lega tool");
          return { result: { contentItems: [{ type: "inputText", text: String(reply?.text || "").slice(0, TOOL_REPLY_MAX) }], success: Boolean(reply?.ok) } };
        } catch (error) {
          return { result: { contentItems: [{ type: "inputText", text: `Eroare Hub: ${String(error.message).slice(0, 300)}` }], success: false } };
        }
      }
      if (method === "currentTime/read") return { result: { currentTimeAt: Math.floor(Date.now() / 1000) } };
      // Nothing that asks for execution is ever allowed behind Lega: refuse with the method's own shape and end the session.
      if (V2_APPROVALS.has(method)) { violation(method); return { result: { decision: "decline" } }; }
      if (LEGACY_APPROVALS.has(method)) { violation(method); return { result: { decision: "abort" } }; }
      if (method === "item/permissions/requestApproval") { violation(method); return { result: { permissions: {}, scope: "turn" } }; }
      if (method === "mcpServer/elicitation/request") return { result: { action: "decline" } };
      if (method === "item/tool/requestUserInput") return { result: { answers: {} } };
      return { error: { code: -32000, message: `Ifrim Agent Hub (Lega) declines ${method}` } };
    };

    if (signal?.aborted) throw cancelled();
    const session = codex.openSession({ cwd, key, access: "read-only", experimentalApi: true, allowedMethods: CODEX_VOICE_ALLOWED_METHODS,
      extraArgs: [...CODEX_VOICE_EXTRA_ARGS, ...mcpDisableArgs(mcpServerNames)], webSearch, label: "codex app-server (Lega)", onNotification, onServerRequest,
      onExit: (exit) => { rejectStart(Object.assign(new Error(`codex app-server (Lega) exited (${exit.code})`), { category: "transport" })); if (!stopped) onEvent({ type: "closed", reason: `process exited (${exit.code})` }); } });
    const alive = () => !session.record.exited && !session.peer.isClosed?.();

    async function interruptTurns() {
      if (!alive()) return;
      await Promise.all([...activeTurns].map((turnId) => session.peer.request("turn/interrupt", { threadId, turnId }, 5000).catch(() => {})));
    }

    /** Graceful stop (realtime/stop → interrupt → end process). Every caller gets the same in-flight promise. */
    function stop() {
      if (stopping) return stopping;
      stopped = true;
      stopping = (async () => {
        if (threadId && alive()) await session.peer.request("thread/realtime/stop", { threadId }, 5000).catch(() => {});
        await interruptTurns();
        const result = await supervisor.stop(key, { graceMs: 1500 });
        supervisor.forget(key);
        return result;
      })();
      return stopping;
    }

    /** Immediate stop for violations: the process is killed first (no grace), cleanup follows. */
    async function kill() {
      stopped = true;
      const result = await supervisor.stop(key, { graceMs: 0 });
      supervisor.forget(key);
      stopping = stopping || Promise.resolve(result);
      return result;
    }

    const onAbort = () => { kill().catch(() => {}); };
    signal?.addEventListener("abort", onAbort, { once: true });
    const check = () => { if (signal?.aborted) throw cancelled(); };

    try {
      await session.ready; check();
      const account = normalizeAccount(await session.peer.request("account/read", {}, 30000)); check();
      if (account.accountType !== "chatgpt") {
        throw Object.assign(new Error(`Codex account type ${account.accountType || "none"} is not the ChatGPT subscription route`), { category: account.accountType === "apiKey" ? "billing" : "authentication", preInference: true });
      }
      const limits = normalizeRateLimits(await session.peer.request("account/rateLimits/read", {}, 30000)); check();
      const verdict = admitUsage?.(limits) || { ok: true };
      if (!verdict.ok) throw Object.assign(new Error(verdict.reason), { category: "quota", preInference: true });

      const thread = await session.peer.request("thread/start", { cwd, approvalPolicy: "on-request", approvalsReviewer: "user", serviceName: "ifrim_agent_hub_lega",
        ephemeral: true, environments: [], dynamicTools: legaDynamicTools({ projects, ...context }), developerInstructions: legaAgentInstructions({ projects, ...context, webSearch }) }, 60000);
      check();
      threadId = thread?.thread?.id || "";
      if (!threadId) throw Object.assign(new Error("Codex did not return a thread id"), { category: "transport", preInference: true });
      if (thread.approvalsReviewer && thread.approvalsReviewer !== "user") {
        throw Object.assign(new Error(`approvalsReviewer=${thread.approvalsReviewer}: aprobările nu ar ajunge la Hub`), { category: "policy", preInference: true });
      }
      const projected = thread.sandbox?.type || "";
      if (projected === "dangerFullAccess" || projected === "workspaceWrite") {
        throw Object.assign(new Error(`Codex a raportat sandbox ${projected} pentru Lega (doar citire)`), { category: "policy", preInference: true });
      }
      // The no-shell guarantee rests on an empty environment list; a Codex version that ignored the field must not pass.
      const envs = thread.thread?.environments;
      if (!Array.isArray(envs) || envs.length !== 0) {
        throw Object.assign(new Error(`Thread-ul Lega nu a confirmat „fără medii de execuție” (${Array.isArray(envs) ? `${envs.length} medii` : "câmp absent"})`), { category: "policy", preInference: true });
      }
      // Every page, fail-closed (the shared check of every Hub Codex process).
      const activeMcp = await activeMcpServers(session.peer, threadId); check();
      if (activeMcp.length) {
        throw Object.assign(new Error(`Servere MCP încă active pentru Lega: ${activeMcp.slice(0, 5).join(", ")}`), { category: "policy", preInference: true });
      }

      check();
      realtimeRequested = true; // from here a GPT-Live call may exist; earlier failures created none
      await session.peer.request("thread/realtime/start", { threadId, outputModality: "audio", transport: { type: "webrtc", sdp: offerSdp }, version: "v3", voice,
        prompt: legaVoicePrompt({ ownerName, webSearch }), clientManagedHandoffs: true, includeStartupContext: false, flushTranscriptTailOnSessionEnd: false, backendReasoningStatus: false }, 30000);
      const info = await withTimeout(startedD.promise, 20000, "thread/realtime/started");
      const answerSdp = await withTimeout(sdpD.promise, 20000, "thread/realtime/sdp");
      check();
      if (!answerSdp.startsWith("v=0")) throw Object.assign(new Error("Codex returned an invalid SDP answer"), { category: "transport" });
      signal?.removeEventListener("abort", onAbort);
      return {
        answerSdp, threadId, realtimeSessionId: info.realtimeSessionId, version: info.version, pid: session.record.pid, key,
        appendSpeech: (text) => (alive() ? session.peer.request("thread/realtime/appendSpeech", { threadId, text }, 10000) : Promise.resolve(null)),
        interruptTurns, stop, kill, activeTurnCount: () => activeTurns.size,
      };
    } catch (error) {
      signal?.removeEventListener("abort", onAbort);
      await stop().catch(() => {});
      if (signal?.aborted) throw Object.assign(cancelled(), { realtimeRequested });
      throw Object.assign(error, { category: error.category || classifyText(error.message), realtimeRequested });
    }
  }

  return { openVoice };
}
