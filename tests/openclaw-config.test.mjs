import test from "node:test";
import assert from "node:assert/strict";
import { configuredAgentEntries, buildGpt6ConfigPatch } from "../apps/api/src/openclaw-config.mjs";

test("agent directory accepts legacy list and current keyed entries", () => {
  assert.deepEqual(configuredAgentEntries({ agents: { list: [{ id: "main" }] } }), [{ id: "main" }]);
  assert.deepEqual(configuredAgentEntries({ agents: { entries: { main: { model: "example", id: "wrong" } } } }), [{ id: "main", model: "example" }]);
  assert.deepEqual(configuredAgentEntries({}), []);
});

test("GPT6 patch preserves scope and does not contain secrets, channels or workspaces", () => {
  const ids = ["ifrim-backend", "ifrim-security", ...Array.from({ length: 21 }, (_, index) => `agent-${index}`)];
  const config = { agents: { entries: Object.fromEntries(ids.map((id) => [id, { workspace: "unchanged" }])),
    defaults: { modelPolicy: { allow: ["legacy"] } } }, gateway: { auth: { token: "secret" } } };
  const original = JSON.stringify(config);
  const patch = buildGpt6ConfigPatch(config, ids);
  assert.equal(JSON.stringify(config), original);
  assert.equal(Object.keys(patch.agents.entries).length, 23);
  assert.equal(patch.agents.entries[ids[0]].thinkingDefault, "high");
  assert.equal(patch.agents.entries[ids[1]].thinkingDefault, "xhigh");
  assert.equal(patch.agents.entries[ids[2]].thinkingDefault, "max");
  assert.equal(patch.agents.entries[ids[0]].model.primary, "openai/gpt-6-sol");
  assert.equal(patch.agents.entries[ids[1]].model.primary, "openai/gpt-6-astra");
  assert.deepEqual(patch.agents.entries[ids[0]].model.fallbacks, []);
  assert.ok(patch.agents.defaults.modelPolicy.allow.includes("legacy"));
  for (const model of Object.values(patch.agents.defaults.models)) assert.equal(model.agentRuntime.id, "codex");
  assert.doesNotMatch(JSON.stringify(patch), /secret|gateway|workspace|channels/);
  assert.throws(() => buildGpt6ConfigPatch(config, ids.slice(1)), /23/);
});
