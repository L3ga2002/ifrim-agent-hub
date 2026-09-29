import test from "node:test";
import assert from "node:assert/strict";
import { startOpenClawProvider, gatewaySessionKey, verifyProviderResult, verifySessionBinding, hasUnknownLiveness, connectCertifiedOpenClaw } from "../apps/api/src/openclaw-provider.mjs";
import { selectConversationRoute } from "../apps/api/src/conversation-route.mjs";

test("create CLIENT_TIMEOUT preserves safe diagnostics without admitting an agent", async () => {
  const events = [];
  const calls = [];
  let closed = 0;
  const secret = "PRIVATE_SENTINEL_NOT_FOR_DIAGNOSTICS";
  const requestId = "00000000-0000-4000-8000-000000000001";
  const before = Date.now();
  const runtime = startOpenClawProvider({ ...options, prompt: secret, cwd: `C:\\${secret}`, onEvent: (event) => events.push(event) }, async () => ({
    request: async (method, params, flags) => {
      calls.push(method);
      assert.equal(flags.timeoutMs, 120000);
      flags.onSent(requestId);
      throw Object.assign(new Error("gateway request timeout for sessions.create"), {
        code: "CLIENT_TIMEOUT", method, timeoutMs: 120000, requestSent: true,
        params, token: secret, details: { authorization: secret }, responsePayload: secret,
      });
    },
    stopAndWait: async () => { closed += 1; },
  }));
  const result = await runtime.done;
  assert.equal(result.status, "failed");
  assert.equal(result.errorCategory, "OPENCLAW_ERROR");
  assert.deepEqual(calls, ["sessions.create"]);
  assert.equal(closed, 1);
  assert.deepEqual(result.rpcDiagnostics.error, { code: "CLIENT_TIMEOUT", method: "sessions.create", timeoutMs: 120000, requestSent: true });
  const [record] = result.rpcDiagnostics.requests;
  assert.deepEqual(Object.keys(record).sort(), ["method", "requestId", "sentAt"]);
  assert.equal(record.requestId, requestId);
  assert.ok(Date.parse(record.sentAt) >= before && Date.parse(record.sentAt) <= Date.now());
  assert.deepEqual(events.filter((event) => event.type === "rpc"), [{ type: "rpc", ...record }]);
  assert.deepEqual(events.filter((event) => event.type === "activity").map((event) => event.label),
    ["OpenClaw: verificare runtime si abonament", "OpenClaw: conexiune certificata"]);
  assert.equal(JSON.stringify({ diagnostics: result.rpcDiagnostics, events }).includes(secret), false);
});

test("create failure before send preserves false and emits no sent event", async () => {
  const events = [];
  const runtime = startOpenClawProvider({ ...options, onEvent: (event) => events.push(event) }, async () => ({
    request: async () => { throw Object.assign(new Error("not sent"), {
      code: "CLIENT_TIMEOUT", method: "sessions.create", timeoutMs: 120000, requestSent: false,
    }); },
    stopAndWait: async () => {},
  }));
  const result = await runtime.done;
  assert.deepEqual(result.rpcDiagnostics.requests, []);
  assert.equal(result.rpcDiagnostics.error.requestSent, false);
  assert.deepEqual(events.filter((event) => event.type === "rpc"), []);
  assert.deepEqual(events.filter((event) => event.type === "activity").map((event) => event.label),
    ["OpenClaw: verificare runtime si abonament", "OpenClaw: conexiune certificata"]);
});

test("failed certification emits progress but never claims a certified connection or sends RPC", async () => {
  const events = [];
  const runtime = startOpenClawProvider({ ...options, onEvent: (event) => events.push(event) }, async () => {
    throw new Error("Certification changed");
  });
  const result = await runtime.done;
  assert.equal(result.status, "failed");
  assert.deepEqual(result.rpcDiagnostics.requests, []);
  assert.deepEqual(events, [{ type: "activity", label: "OpenClaw: verificare runtime si abonament" }]);
});

test("malformed SDK error fields are bounded or omitted from diagnostics", async () => {
  const runtime = startOpenClawProvider(options, async () => ({
    request: async (_method, _params, flags) => {
      flags.onSent("x".repeat(200));
      throw Object.assign(new Error("failure"), { code: "c".repeat(100), method: {}, timeoutMs: Infinity, requestSent: "true", extra: "private" });
    },
    stopAndWait: async () => {},
  }));
  const result = await runtime.done;
  assert.equal(result.rpcDiagnostics.requests[0].requestId.length, 160);
  assert.deepEqual(result.rpcDiagnostics.error, { code: "c".repeat(80), method: "", timeoutMs: null, requestSent: null });
});

test("agent sent diagnostics follow a verified create without exposing the prompt", async () => {
  const events = [];
  const runtime = startOpenClawProvider({ ...options, prompt: "PRIVATE_PROMPT", onEvent: (event) => events.push(event) }, async () => ({
    request: async (method, params, flags) => {
      flags.onSent(method === "sessions.create" ? "create-id" : "agent-id");
      if (method === "sessions.create") return createdSession(params);
      return { status: "ok", result: { payloads: [{ text: "accepted" }], meta: {
        agentMeta: { provider: "openai", model: "gpt-6-luna", agentHarnessId: "codex" },
        requestShaping: { thinking: "max" },
        executionTrace: { winnerProvider: "openai", winnerModel: "gpt-6-luna", fallbackUsed: false, attempts: [{ provider: "openai", model: "gpt-6-luna" }] },
      } } };
    },
    stopAndWait: async () => {},
  }));
  assert.equal((await runtime.done).status, "completed");
  const sent = events.filter((event) => event.type === "rpc");
  assert.deepEqual(sent.map(({ method, requestId }) => ({ method, requestId })), [
    { method: "sessions.create", requestId: "create-id" }, { method: "agent", requestId: "agent-id" },
  ]);
  assert.ok(events.findIndex((event) => event.type === "binding") < events.findIndex((event) => event.method === "agent"));
  assert.equal(JSON.stringify(sent).includes("PRIVATE_PROMPT"), false);
});

test("unconfirmed agent timeout retains both the lease and RPC diagnostics", async () => {
  const runtime = startOpenClawProvider(options, async () => ({
    request: async (method, params, flags) => {
      if (method === "sessions.create") { flags.onSent("create-id"); return createdSession(params); }
      if (method === "agent") {
        flags.onSent("agent-id");
        throw Object.assign(new Error("agent timeout"), { code: "CLIENT_TIMEOUT", method, timeoutMs: 2100000, requestSent: true });
      }
      throw new Error("abort unavailable");
    },
    stopAndWait: async () => {},
  }));
  const result = await runtime.done;
  assert.equal(result.retainLease, true);
  assert.equal(result.errorCategory, "REMOTE_STATE_UNKNOWN");
  assert.equal(result.rpcDiagnostics?.error?.code, "CLIENT_TIMEOUT");
  assert.deepEqual(result.rpcDiagnostics.requests.map((record) => record.method), ["sessions.create", "agent"]);
});

test("conversation routing keeps Luna preference and adapts Sol/Astra effort", () => {
  assert.equal(selectConversationRoute("codex", {}, "simple status").model, "openai/gpt-6-luna");
  assert.equal(selectConversationRoute("codex", {}, "simple status").reasoning, "max");
  assert.equal(selectConversationRoute("codex", {}, "simple status", { model: "openai/gpt-6-astra" }).reasoning, "low");
  assert.equal(selectConversationRoute("codex", {}, "multi-file integration", { model: "openai/gpt-6-sol" }).reasoning, "high");
  assert.throws(() => selectConversationRoute("codex", {}, "", { model: "old-model" }), /Unsupported/);
});

const options = { cwd: "C:\\Hub", prompt: "read-only probe", provider: "codex", model: "openai/gpt-6-luna", reasoning: "max",
  agentId: "ifrim-qa", conversationId: "conversation-1", runId: "run-1", accessMode: "read-only" };
function createdSession(params, sessionId = "session-1") {
  const delimiter = params.model.indexOf("@");
  const canonical = delimiter < 0 ? params.model : params.model.slice(0, delimiter);
  const profile = delimiter < 0 ? "" : params.model.slice(delimiter + 1);
  const [modelProvider, model] = canonical.split("/");
  return { key: params.key, sessionId, entry: { spawnedCwd: params.cwd, permissionMode: params.permissionMode,
    authProfileOverride: profile || "openai:ifrimcatalin30@gmail.com", authProfileOverrideSource: "user", agentRuntimeOverride: params.agentRuntime, thinkingLevel: params.thinkingLevel }, resolved: { modelProvider, model } };
}

test("gateway binds workspace before execution and never sends externally", async () => {
  const calls = [];
  const runtime = startOpenClawProvider(options, async () => ({
    request: async (method, params, flags) => {
      calls.push({ method, params });
      if (method === "sessions.create") return createdSession(params);
      flags.onAccepted({ runId: "remote-1" });
      return { status: "ok", result: { payloads: [{ text: "PASS" }], meta: { agentMeta: { provider: "openai", model: "gpt-6-luna", agentHarnessId: "codex" },
        requestShaping: { thinking: "max" }, executionTrace: { winnerProvider: "openai", winnerModel: "gpt-6-luna", fallbackUsed: false, attempts: [{ provider: "openai", model: "gpt-6-luna" }] } } } };
    }, stopAndWait: async () => {},
  }));
  const result = await runtime.done;
  assert.equal(result.status, "completed");
  assert.equal(calls[0].params.cwd, options.cwd);
  assert.equal(calls[0].params.permissionMode, "read-only");
  assert.equal(calls[1].params.deliver, false);
  assert.equal(calls[1].params.disableMessageTool, true);
  assert.equal("cwd" in calls[1].params, false);
  assert.equal(calls[1].params.expectedExistingSessionId, "session-1");
  assert.equal(calls[0].params.model, "openai/gpt-6-luna@openai:ifrimcatalin30@gmail.com");
  assert.equal(calls[1].params.model, calls[0].params.model);
});

test("wrong or automatic subscription binding never submits an agent turn", async () => {
  for (const provider of ["codex", "claude"]) {
    for (const change of [{ authProfileOverride: "openai:manual" }, { authProfileOverrideSource: "auto" }, { authProfileOverrideSource: undefined }]) {
      const calls = [];
      const route = { ...options, provider, ...(provider === "claude" ? { model: "anthropic/claude-sonnet-5", reasoning: "medium" } : {}) };
      const runtime = startOpenClawProvider(route, async () => ({ request: async (method, params) => {
        calls.push(method);
        assert.equal(method, "sessions.create");
        const created = createdSession(params);
        Object.assign(created.entry, change);
        return created;
      }, stopAndWait: async () => {} }));
      const result = await runtime.done;
      assert.equal(result.status, "failed");
      assert.match(result.error, /authentication/);
      assert.deepEqual(calls, ["sessions.create"]);
    }
  }
});

test("missing effort, API runtime and fallback cannot be reported as verified", () => {
  const payload = { meta: { agentMeta: { provider: "openai", model: "gpt-6-luna", agentHarnessId: "openclaw" } } };
  assert.match(verifyProviderResult(payload, options), /runtime/);
  payload.meta.agentMeta.agentHarnessId = "codex";
  assert.match(verifyProviderResult(payload, options), /Fallback/);
  payload.meta.executionTrace = { winnerProvider: "openai", winnerModel: "gpt-6-luna", fallbackUsed: false, attempts: [{ provider: "openai", model: "gpt-6-luna" }] };
  assert.match(verifyProviderResult(payload, options), /Reasoning/);
});

test("session identity isolates provider and permission mode", () => {
  const key = gatewaySessionKey(options);
  assert.notEqual(key, gatewaySessionKey({ ...options, provider: "claude" }));
  assert.notEqual(key, gatewaySessionKey({ ...options, accessMode: "workspace" }));
  assert.notEqual(key, gatewaySessionKey({ ...options, conversationId: "another" }));
  assert.notEqual(key, gatewaySessionKey({ ...options, model: "openai/gpt-6-sol" }));
  assert.notEqual(key, gatewaySessionKey({ ...options, reasoning: "high" }));
});

test("cancellation while connecting cannot admit an agent turn", async () => {
  const calls = [];
  let connected;
  const runtime = startOpenClawProvider(options, () => new Promise((resolve) => { connected = resolve; }));
  const stopped = runtime.stop();
  connected({ request: async (method) => { calls.push(method); }, stopAndWait: async () => {} });
  assert.equal(await stopped, true);
  assert.equal((await runtime.done).status, "cancelled");
  assert.deepEqual(calls, []);
});

test("a lost submitted request retains the lease even without acceptance receipt", async () => {
  const runtime = startOpenClawProvider(options, async () => ({
    request: async (method, params, flags) => {
      if (method === "sessions.create") return createdSession(params, "s");
      if (method === "agent") { flags.onSent(); throw new Error("Connection lost after send"); }
      return { ok: true };
    }, stopAndWait: async () => {},
  }));
  assert.equal((await runtime.done).retainLease, true);
});

test("Claude evidence must identify the native CLI and exact requested effort", () => {
  const payload = { meta: { agentMeta: { provider: "anthropic", model: "claude-sonnet-5", agentHarnessId: "claude-cli" },
    requestShaping: { thinking: "medium" }, executionTrace: { winnerProvider: "anthropic", winnerModel: "claude-sonnet-5", fallbackUsed: false, attempts: [{ provider: "anthropic", model: "claude-sonnet-5" }] } } };
  const route = { provider: "claude", model: "anthropic/claude-sonnet-5", reasoning: "medium" };
  assert.equal(verifyProviderResult(payload, route), "");
  payload.meta.agentMeta.agentHarnessId = "openclaw";
  assert.match(verifyProviderResult(payload, route), /runtime/);
});

test("unconfirmed remote cancellation retains the lease", async () => {
  const runtime = startOpenClawProvider(options, async () => ({
    request: async (method, params, flags) => {
      if (method === "sessions.create") return createdSession(params, "s");
      if (method === "agent") { flags.onAccepted({ runId: "r" }); throw new Error("Connection lost"); }
      throw new Error("Disconnected");
    }, stopAndWait: async () => {},
  }));
  const result = await runtime.done;
  assert.equal(result.retainLease, true);
  assert.equal(result.errorCategory, "REMOTE_STATE_UNKNOWN");
});

test("wrong workspace, full permissions and runtime cannot admit a turn", () => {
  const key = gatewaySessionKey(options);
  const created = createdSession({ key, cwd: options.cwd, permissionMode: options.accessMode, agentRuntime: "codex", thinkingLevel: options.reasoning, model: options.model });
  assert.equal(verifySessionBinding(created, options, key), "");
  created.entry.authProfileOverride = "openai:manual";
  assert.match(verifySessionBinding(created, options, key), /authentication/);
  created.entry.authProfileOverride = "openai:ifrimcatalin30@gmail.com";
  created.entry.permissionMode = "full";
  assert.match(verifySessionBinding(created, options, key), /permissions/);
  created.entry.permissionMode = "read-only";
  created.entry.spawnedCwd = "C:\\OtherProject";
  assert.match(verifySessionBinding(created, options, key), /workspace/);
});

test("paused, unknown and observation timeout are not terminal proof", () => {
  assert.equal(hasUnknownLiveness({ status: "timeout", result: { meta: { livenessState: "unknown" } } }), true);
  assert.equal(hasUnknownLiveness({ status: "ok", result: { meta: { livenessState: "paused" } } }), true);
  assert.equal(hasUnknownLiveness({ status: "ok", endedAt: 1000 }), false);
});

test("Claude trace accepts only its explicit native CLI alias", () => {
  const payload = { meta: { agentMeta: { provider: "anthropic", model: "claude-sonnet-5", agentHarnessId: "claude-cli" },
    requestShaping: { thinking: "medium" }, executionTrace: { winnerProvider: "claude-cli", winnerModel: "claude-sonnet-5", fallbackUsed: false,
      attempts: [{ provider: "claude-cli", model: "claude-sonnet-5" }] } } };
  assert.equal(verifyProviderResult(payload, { provider: "claude", model: "anthropic/claude-sonnet-5", reasoning: "medium" }), "");
  payload.meta.executionTrace.winnerProvider = "unapproved";
  assert.match(verifyProviderResult(payload, { provider: "claude", model: "anthropic/claude-sonnet-5", reasoning: "medium" }), /Fallback/);
});

test("certified disk config with stale or missing applied gateway config cannot create a session", async () => {
  for (const appliedConfigHash of ["old-revision", ""]) {
    const calls = [];
    const runtime = startOpenClawProvider(options, (onEvent) => connectCertifiedOpenClaw(onEvent, options, {
      certify: async () => ({ config: { agents: { defaults: { skipBootstrap: true } } }, gatewayConfigHash: "certified" }),
      connect: async () => ({ request: async (method) => {
        calls.push(method);
        return { valid: true, hash: "certified", configRevisionHash: "new-revision", appliedConfigHash };
      }, stopAndWait: async () => {} }),
    }));
    assert.equal((await runtime.done).status, "failed");
    assert.deepEqual(calls, ["config.get"]);
  }
});
