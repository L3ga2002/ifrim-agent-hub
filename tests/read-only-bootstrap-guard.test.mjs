import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { connectCertifiedOpenClaw, startOpenClawProvider } from "../apps/api/src/openclaw-provider.mjs";
import { subscriptionProfiles } from "../apps/api/src/subscription-auth.mjs";

for (const mode of ["explicit", "omitted"]) {
  for (const [label, flag] of [["false", false], ["missing", undefined], ["null", null], ["string", "true"], ["number", 1], ["missing defaults", "no-defaults"]]) {
    test(`${mode} read-only refuses ${label} bootstrap guard before connect/RPC`, async () => {
      const options = mode === "explicit" ? { accessMode: "read-only" } : {};
      const config = flag === "no-defaults" ? {} : { agents: { defaults: { skipBootstrap: flag } } };
      let audits = 0, connections = 0, requests = 0;
      await assert.rejects(connectCertifiedOpenClaw(() => {}, options, {
        certify: async () => { audits++; return { config, gatewayConfigHash: "certified" }; },
        connect: async () => { connections++; return { request: async () => { requests++; } }; },
      }), /Read-only execution requires automatic workspace bootstrap to be disabled/);
      assert.equal(audits, 1); assert.equal(connections, 0); assert.equal(requests, 0);
    });
  }
  test(`${mode} read-only accepts true flag with exact applied config binding`, async () => {
    const options = mode === "explicit" ? { accessMode: "read-only" } : {};
    const config = { gateway: { port: 18790 }, agents: { defaults: { skipBootstrap: true } } };
    const calls = [];
    const client = { request: async method => {
      calls.push(method);
      return { valid: true, hash: "certified", configRevisionHash: "revision", appliedConfigHash: "revision" };
    } };
    assert.equal(await connectCertifiedOpenClaw(() => {}, options, {
      certify: async () => ({ config, gatewayConfigHash: "certified" }),
      connect: async (_event, supplied) => { assert.equal(supplied, config); calls.push("connect"); return client; },
    }), client);
    assert.deepEqual(calls, ["connect", "config.get"]);
  });
}

test("certified read-only runtime preserves exact existing-session ID and native route", async () => {
  const options = { accessMode: "read-only", cwd: "C:\\SyntheticHub", provider: "codex", model: "openai/gpt-6-luna",
    reasoning: "max", agentId: "ifrim-qa", conversationId: "synthetic-conversation", runId: "synthetic-run", prompt: "synthetic" };
  const config = { gateway: { port: 18790 }, agents: { defaults: { skipBootstrap: true } } };
  const id = "exact-synthetic-existing-session";
  const calls = [];
  let stops = 0;
  const runtime = startOpenClawProvider(options, onEvent => connectCertifiedOpenClaw(onEvent, options, {
    certify: async () => ({ config, gatewayConfigHash: "certified" }),
    connect: async () => ({ request: async (method, params, settings) => {
      calls.push(method);
      if (method === "config.get") return { valid: true, hash: "certified", configRevisionHash: "revision", appliedConfigHash: "revision" };
      if (method === "sessions.create") return { key: params.key, sessionId: id, runStarted: false,
        entry: { spawnedCwd: options.cwd, permissionMode: "read-only", agentRuntimeOverride: "codex", thinkingLevel: "max",
          authProfileOverride: subscriptionProfiles.codex, authProfileOverrideSource: "user" }, resolved: { modelProvider: "openai", model: "gpt-6-luna" } };
      assert.equal(method, "agent");
      assert.equal(params.expectedExistingSessionId, id);
      assert.equal(params.deliver, false); assert.equal(params.disableMessageTool, true);
      settings.onSent("synthetic-request"); settings.onAccepted({ runId: "synthetic-remote" });
      return { status: "ok", result: { payloads: [{ text: "synthetic-ok" }], meta: {
        agentMeta: { provider: "openai", model: "gpt-6-luna", agentHarnessId: "codex" }, requestShaping: { thinking: "max" },
        executionTrace: { winnerProvider: "openai", winnerModel: "gpt-6-luna", fallbackUsed: false,
          attempts: [{ provider: "openai", model: "gpt-6-luna" }] },
      } } };
    }, stopAndWait: async () => { stops++; } }),
  }));
  const result = await runtime.done;
  assert.equal(result.status, "completed"); assert.equal(result.actual.verified, true);
  assert.deepEqual(calls, ["config.get", "sessions.create", "agent"]);
  assert.equal(stops, 1);
});

test("production default-mode bootstrap guard remains before connect", async () => {
  const text = await fs.readFile(new URL("../apps/api/src/openclaw-provider.mjs", import.meta.url), "utf8");
  const guard = text.indexOf('(options.accessMode ?? "read-only") === "read-only"');
  assert.ok(guard >= 0 && guard < text.indexOf("const client = await connect(onEvent, verified.config)"));
  assert.match(text, /verified\.config\.agents\?\.defaults\?\.skipBootstrap !== true/);
});
