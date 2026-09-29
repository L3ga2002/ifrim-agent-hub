import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { validateSuspendedDiagnosticCertificate } from "../apps/api/src/existing-session-diagnostic.mjs";

const now = Date.parse("2026-09-29T14:00:00.000Z");
const day = 86400000;
const model = "openai/gpt-6-luna";

function fixture() {
  const cwd = path.resolve("synthetic-hub-diagnostic-fixture");
  return {
    gate: {
      status: "suspended", verifiedAt: new Date(now).toISOString(),
      configSha256: "synthetic-config-hash", gatewayConfigHash: "synthetic-runtime-hash",
      providers: { codex: { authMode: "local-subscription", apiBillingDisabled: true,
        evidencePath: "synthetic-evidence.json" } },
    },
    evidence: { version: 1, provider: "codex", verifiedAt: new Date(now).toISOString(),
      agents: { "ifrim-backend": { sources: {} } }, receipt: { projectRoot: cwd } },
    config: { agents: { entries: { "ifrim-backend": { model: { fallbacks: [] } } },
      defaults: { models: { [model]: { agentRuntime: { id: "codex" } } },
        modelPolicy: { allow: [model] } } } },
    configHash: "synthetic-config-hash",
    options: { cwd, provider: "codex", agentId: "ifrim-backend", model,
      reasoning: "max", accessMode: "read-only" },
  };
}

function validate(value) {
  return validateSuspendedDiagnosticCertificate(value.gate, value.evidence, value.config,
    value.configHash, value.options, now);
}

function freezeDeep(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

test("valid suspended certificate is accepted without activating or mutating inputs", () => {
  const value = fixture();
  const before = structuredClone(value);
  freezeDeep(value);
  assert.equal(validate(value), true);
  assert.deepEqual(value, before);
  assert.equal(value.gate.status, "suspended");
});

for (const age of [0, day - 1, day]) {
  test(`gate and evidence age ${age}ms is within the inclusive 24h boundary`, () => {
    const value = fixture();
    value.gate.verifiedAt = value.evidence.verifiedAt = new Date(now - age).toISOString();
    assert.equal(validate(value), true);
    assert.equal(value.gate.status, "suspended");
  });
}

for (const field of ["gate", "evidence"]) {
  for (const [label, timestamp] of [
    ["missing", undefined], ["invalid", "not-a-date"],
    ["future", new Date(now + 1).toISOString()],
    ["stale", new Date(now - day - 1).toISOString()],
  ]) {
    test(`${field} rejects ${label} timestamp without changing suspension`, () => {
      const value = fixture();
      value[field].verifiedAt = timestamp;
      const before = structuredClone(value);
      assert.throws(() => validate(value), /expired or invalid/);
      assert.deepEqual(value, before);
      assert.equal(value.gate.status, "suspended");
    });
  }
}

const rejectedContracts = [
  ["evidence provider mismatch", v => { v.evidence.provider = "claude"; }, /another route/],
  ["unsupported evidence version", v => { v.evidence.version = 2; }, /another route/],
  ["wrong project", v => { v.evidence.receipt.projectRoot = path.resolve("another-synthetic-project"); }, /another route/],
  ["missing receipt", v => { delete v.evidence.receipt; }, /another route/],
  ["missing evidence agent roster", v => { delete v.evidence.agents; }, /another route/],
  ["selected agent absent in evidence", v => { v.evidence.agents = { "ifrim-qa": {} }; }, /another route/],
  ["selected agent absent in configuration", v => { v.config.agents.entries = {}; }, /fallback/],
  ["fallback enabled", v => { v.config.agents.entries["ifrim-backend"].model.fallbacks = ["other-model"]; }, /fallback/],
  ["fallback policy missing", v => { delete v.config.agents.entries["ifrim-backend"].model.fallbacks; }, /fallback/],
  ["wrong model runtime", v => { v.config.agents.defaults.models[model].agentRuntime.id = "claude-cli"; }, /runtime/],
  ["model denied", v => { v.config.agents.defaults.modelPolicy.allow = []; }, /not approved/],
  ["changed configuration hash", v => { v.configHash = "changed"; }, /not verified/],
  ["missing gateway configuration hash", v => { delete v.gate.gatewayConfigHash; }, /not verified/],
  ["provider proof missing", v => { v.gate.providers = {}; }, /not verified/],
  ["API authentication proof", v => { v.gate.providers.codex.authMode = "api_key"; }, /not verified/],
  ["API billing allowed", v => { v.gate.providers.codex.apiBillingDisabled = false; }, /not verified/],
  ["evidence path missing", v => { delete v.gate.providers.codex.evidencePath; }, /not verified/],
];

for (const [label, change, error] of rejectedContracts) {
  test(`diagnostic rejects ${label} and preserves every input`, () => {
    const value = fixture();
    change(value);
    const before = structuredClone(value);
    freezeDeep(value);
    assert.throws(() => validate(value), error);
    assert.deepEqual(value, before);
    assert.equal(value.gate.status, "suspended");
  });
}

for (const status of ["approved", "blocked", undefined]) {
  test(`diagnostic refuses non-suspended gate status ${String(status)}`, () => {
    const value = fixture();
    value.gate.status = status;
    const before = structuredClone(value);
    assert.throws(() => validate(value), /must stay suspended/);
    assert.deepEqual(value, before);
  });
}

test("missing gate fails closed", () => {
  const value = fixture();
  value.gate = null;
  assert.throws(() => validate(value), /must stay suspended/);
});
