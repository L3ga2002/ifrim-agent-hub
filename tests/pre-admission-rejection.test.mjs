import test from "node:test";
import assert from "node:assert/strict";
import { isKnownPreAdmissionRejection, startOpenClawProvider } from "../apps/api/src/openclaw-provider.mjs";

const message = "expectedExistingSessionId is reserved for backend callers.";
const idle = { submitted: true, admitted: false, gatewayRunId: "", streamed: "" };
const rejection = fields => Object.assign(new Error(message), { code: "INVALID_REQUEST", ...fields });

test("classifier accepts exact official rejection through code or gatewayCode only", () => {
  assert.equal(isKnownPreAdmissionRejection(rejection(), idle), true);
  assert.equal(isKnownPreAdmissionRejection(rejection({ code: "RPC_ERROR", gatewayCode: "INVALID_REQUEST" }), idle), true);
});

for (const [label, error, state] of [
  ["timeout", rejection({ code: "CLIENT_TIMEOUT" }), idle],
  ["other gateway code", rejection({ gatewayCode: "FORBIDDEN" }), idle],
  ["missing error", null, idle],
  ["different message", { code: "INVALID_REQUEST", message: "another rejection" }, idle],
  ["message suffix", { code: "INVALID_REQUEST", message: message + " extra" }, idle],
  ["message only", { message }, idle],
  ["not submitted", rejection(), { ...idle, submitted: false }],
  ["truthy submitted", rejection(), { ...idle, submitted: 1 }],
  ["admitted", rejection(), { ...idle, admitted: true }],
  ["unknown admission", rejection(), { ...idle, admitted: undefined }],
  ["remote run id", rejection(), { ...idle, gatewayRunId: "remote-run" }],
  ["streamed output", rejection(), { ...idle, streamed: "partial" }],
]) {
  test(`classifier refuses ${label}`, () => {
    assert.equal(isKnownPreAdmissionRejection(error, state), false);
  });
}

const options = { cwd: "C:\\SyntheticHub", prompt: "synthetic-only", provider: "codex",
  model: "openai/gpt-6-luna", reasoning: "max", agentId: "ifrim-qa",
  conversationId: "synthetic-conversation", runId: "synthetic-run", accessMode: "read-only" };

async function simulatedRun({ error = rejection(), submitted = true, accepted = false, streamed = false } = {}) {
  const calls = [];
  const events = [];
  let stopped = 0;
  const sessionId = "exact-synthetic-existing-session";
  const runtime = startOpenClawProvider({ ...options, onEvent: event => events.push(event) }, async onEvent => ({
    request: async (method, params, flags) => {
      calls.push({ method, params });
      if (method === "sessions.create") {
        flags.onSent("create-request");
        const separator = params.model.indexOf("@");
        const route = params.model.slice(0, separator);
        const profile = params.model.slice(separator + 1);
        const [modelProvider, model] = route.split("/");
        return { key: params.key, sessionId, runStarted: false,
          entry: { spawnedCwd: params.cwd, permissionMode: params.permissionMode,
            agentRuntimeOverride: params.agentRuntime, thinkingLevel: params.thinkingLevel,
            authProfileOverride: profile, authProfileOverrideSource: "user" },
          resolved: { modelProvider, model } };
      }
      if (method === "agent") {
        assert.equal(params.expectedExistingSessionId, sessionId);
        assert.equal(params.deliver, false);
        assert.equal(params.disableMessageTool, true);
        if (submitted) flags.onSent("agent-request");
        if (accepted) flags.onAccepted(accepted === "no-id" ? {} : { runId: "remote-run" });
        if (streamed) onEvent({ event: "agent", payload: {
          sessionKey: params.sessionKey, stream: "assistant", data: { delta: "partial" },
        } });
        throw error;
      }
      if (method === "chat.abort") throw new Error("Synthetic terminal state unavailable");
      throw new Error("Unexpected simulated request");
    },
    stopAndWait: async () => { stopped++; },
  }));
  const result = await runtime.done;
  return { result, calls, events, stopped };
}

for (const [label, error] of [
  ["official code", rejection()],
  ["official gatewayCode", rejection({ code: "RPC_ERROR", gatewayCode: "INVALID_REQUEST" })],
]) {
  test(`runtime ${label} fails pre-admission without abort or retained lease`, async () => {
    const { result, calls, events, stopped } = await simulatedRun({ error });
    assert.equal(result.status, "failed");
    assert.equal(result.errorCategory, "PRE_ADMISSION_REJECTED");
    assert.equal(result.usage.status, "not_started");
    assert.equal(result.output, "");
    assert.notEqual(result.retainLease, true);
    assert.deepEqual(calls.map(call => call.method), ["sessions.create", "agent"]);
    assert.deepEqual(result.rpcDiagnostics.requests.map(item => item.method), ["sessions.create", "agent"]);
    assert.equal(events.some(event => event.label === "OpenClaw: run admitted"), false);
    assert.equal(stopped, 1);
  });
}

for (const [label, scenario] of [
  ["timeout", { error: rejection({ code: "CLIENT_TIMEOUT" }) }],
  ["other official message", { error: Object.assign(new Error("Other INVALID_REQUEST"), { code: "INVALID_REQUEST" }) }],
  ["other error code", { error: rejection({ code: "FORBIDDEN" }) }],
  ["accepted with run id", { accepted: true }],
  ["accepted without run id", { accepted: "no-id" }],
  ["streamed output", { streamed: true }],
]) {
  test(`runtime ${label} cannot shortcut unknown remote custody`, async () => {
    const { result, calls, stopped } = await simulatedRun(scenario);
    assert.equal(result.status, "blocked");
    assert.equal(result.errorCategory, "REMOTE_STATE_UNKNOWN");
    assert.equal(result.retainLease, true);
    assert.equal(result.usage.status, "unknown");
    assert.deepEqual(calls.map(call => call.method), ["sessions.create", "agent", "chat.abort"]);
    assert.equal(result.output, scenario.streamed ? "partial" : "");
    if (scenario.accepted === true) assert.equal(calls[2].params.runId, "remote-run");
    assert.equal(stopped, 1);
  });
}

test("runtime unsent rejection is not classified as submitted pre-admission proof", async () => {
  const { result, calls, stopped } = await simulatedRun({ submitted: false });
  assert.equal(result.status, "failed");
  assert.equal(result.errorCategory, "OPENCLAW_ERROR");
  assert.deepEqual(calls.map(call => call.method), ["sessions.create", "agent"]);
  assert.deepEqual(result.rpcDiagnostics.requests.map(item => item.method), ["sessions.create"]);
  assert.equal(stopped, 1);
});
