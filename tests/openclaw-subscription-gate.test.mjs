import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { validateSubscriptionGate } from "../apps/api/src/openclaw-subscription-gate.mjs";

test("legacy launch and compilation bind the executable and environment to the certified receipt", async () => {
  const source = await fs.readFile(new URL("../apps/api/src/server.mjs", import.meta.url), "utf8");
  const launch = source.slice(source.indexOf("async function startOpenClawExecution("), source.indexOf("async function launchManualExecution("));
  const compile = source.slice(source.indexOf("async function compileWithPromptArchitect("), source.indexOf("function listTaskDrafts("));
  for (const body of [launch, compile]) {
    assert.ok(body.indexOf("await assertSubscriptionGate(") < body.indexOf("await fs.writeFile("));
    assert.match(body, /certified\.cli\.executable/);
    assert.match(body, /certified\.cli\.entrypoint/);
    assert.match(body, /env: certified\.cli\.environment/);
    assert.doesNotMatch(body, /\.\.\.process\.env|powershell\.exe|findCommand\(|resolveOpenClawCli\(/);
  }
  assert.match(source, /env: options\.env \|\|/);
});

test("subscription gate rejects absent, stale, changed and API-auth proof before execution", () => {
  const now = Date.now();
  const config = { agents: { entries: { "ifrim-qa": { model: { fallbacks: [] } } }, defaults: {
    models: { "openai/gpt-6-luna": { agentRuntime: { id: "codex" } } }, modelPolicy: { allow: ["openai/gpt-6-luna"] } } } };
  const options = { provider: "codex", agentId: "ifrim-qa", model: "openai/gpt-6-luna" };
  const proof = { authMode: "local-subscription", apiBillingDisabled: true, evidencePath: "private-evidence.json" };
  const gate = { status: "approved", configSha256: "current", gatewayConfigHash: "certified-gateway-revision", verifiedAt: new Date(now).toISOString(), providers: { codex: proof } };
  assert.throws(() => validateSubscriptionGate(null, config, "current", options, now), /not verified/);
  assert.equal(validateSubscriptionGate(gate, config, "current", options, now), true);
  assert.throws(() => validateSubscriptionGate({ ...gate, status: "suspended" }, config, "current", options, now), /not verified/);
  assert.throws(() => validateSubscriptionGate(gate, config, "changed", options, now), /not verified/);
  assert.throws(() => validateSubscriptionGate(gate, config, "current", options, now + 86400001), /not verified/);
  assert.throws(() => validateSubscriptionGate({ ...gate, providers: { codex: { ...proof, authMode: "api_key" } } }, config, "current", options, now), /not verified/);
  config.agents.entries["ifrim-qa"].model.fallbacks.push("old-model");
  assert.throws(() => validateSubscriptionGate(gate, config, "current", options, now), /fallback/);
});
