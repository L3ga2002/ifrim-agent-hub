import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { hubAcceptanceScopes, targetHubAcceptanceCertificate } from "../apps/api/src/hub-acceptance-scope.mjs";
import { validateSuspendedDiagnosticCertificate } from "../apps/api/src/existing-session-diagnostic.mjs";

const now = Date.parse("2026-09-29T18:00:00Z");
function fixture(previous, provider = "claude") {
  const scope = hubAcceptanceScopes[provider];
  const cwd = path.resolve("synthetic-target-hub");
  const proof = { authMode: "local-subscription", apiBillingDisabled: true, evidencePath: "synthetic-evidence" };
  const gate = { ...(previous ? hubAcceptanceScopes[previous] : {}), status: "suspended",
    verifiedAt: new Date(now).toISOString(), configSha256: "synthetic-config", gatewayConfigHash: "synthetic-runtime",
    providers: { codex: { ...proof }, claude: { ...proof } } };
  const evidence = { version: 1, provider, verifiedAt: new Date(now).toISOString(),
    agents: { "ifrim-backend": { sources: {} } }, receipt: { projectRoot: cwd } };
  const options = { cwd, provider, agentId: "ifrim-backend", conversationId: scope.acceptanceConversationId,
    model: scope.acceptanceModel, reasoning: scope.acceptanceReasoning, accessMode: scope.acceptanceAccessMode };
  const config = { agents: { entries: { "ifrim-backend": { model: { fallbacks: [] } } }, defaults: {
    models: { [options.model]: { agentRuntime: { id: provider === "codex" ? "codex" : "claude-cli" } } },
    modelPolicy: { allow: [options.model] },
  } } };
  return { gate, evidence, options, config, configHash: "synthetic-config" };
}

function freeze(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function validate(f, target) {
  return validateSuspendedDiagnosticCertificate(target, f.evidence, f.config, f.configHash, f.options, now);
}

for (const previous of [undefined, "codex", "claude"]) {
  for (const provider of ["codex", "claude"]) {
    test(`${previous || "unscoped"} suspended to ${provider} validates a target copy without activation`, () => {
      const f = fixture(previous, provider);
      const before = structuredClone(f);
      freeze(f);
      const target = targetHubAcceptanceCertificate(f.gate, provider);
      assert.notEqual(target, f.gate);
      for (const [field, value] of Object.entries(hubAcceptanceScopes[provider])) assert.equal(target[field], value);
      assert.equal(target.status, "suspended");
      assert.equal(validate(f, target), true);
      assert.deepEqual(f, before);
    });
  }
}

for (const [label, change, expected] of [
  ["wrong provider", f => { f.evidence.provider = "codex"; }, /another route/],
  ["wrong version", f => { f.evidence.version = 2; }, /another route/],
  ["wrong project", f => { f.evidence.receipt.projectRoot = path.resolve("other-synthetic-hub"); }, /another route/],
  ["missing agent", f => { f.evidence.agents = {}; }, /another route/],
  ["stale evidence", f => { f.evidence.verifiedAt = new Date(now - 86400001).toISOString(); }, /expired or invalid/],
  ["future evidence", f => { f.evidence.verifiedAt = new Date(now + 1).toISOString(); }, /expired or invalid/],
  ["invalid evidence date", f => { f.evidence.verifiedAt = "invalid"; }, /expired or invalid/],
  ["changed config hash", f => { f.configHash = "changed"; }, /not verified/],
  ["missing Claude proof", f => { delete f.gate.providers.claude; }, /not verified/],
  ["Claude API proof", f => { f.gate.providers.claude.authMode = "api_key"; }, /not verified/],
  ["Claude API billing", f => { f.gate.providers.claude.apiBillingDisabled = false; }, /not verified/],
  ["wrong Claude runtime", f => { f.config.agents.defaults.models[f.options.model].agentRuntime.id = "codex"; }, /runtime/],
  ["model denied", f => { f.config.agents.defaults.modelPolicy.allow = []; }, /not approved/],
  ["fallback", f => { f.config.agents.entries["ifrim-backend"].model.fallbacks = ["other"]; }, /fallback/],
]) {
  test(`Codex to Claude target cannot bypass ${label}`, () => {
    const f = fixture("codex");
    change(f);
    const before = structuredClone(f);
    freeze(f);
    const target = targetHubAcceptanceCertificate(f.gate, "claude");
    const targetBefore = structuredClone(target);
    assert.throws(() => validate(f, target), expected);
    assert.deepEqual(f, before);
    assert.deepEqual(target, targetBefore);
    assert.equal(target.status, "suspended");
  });
}

for (const [label, change] of [
  ["mixed", gate => { gate.acceptanceProvider = "claude"; }],
  ["unknown", gate => { gate.acceptanceModel = "unknown-model"; }],
  ["empty", gate => { gate.acceptanceAccessMode = ""; }],
  ["null", gate => { gate.acceptanceReasoning = null; }],
  ...Object.keys(hubAcceptanceScopes.codex).map(field => [`partial missing ${field}`, gate => { delete gate[field]; }]),
]) {
  test(`target conversion rejects ${label} old scope without mutation`, () => {
    const f = fixture("codex");
    change(f.gate);
    const before = structuredClone(f.gate);
    freeze(f.gate);
    assert.throws(() => targetHubAcceptanceCertificate(f.gate, "claude"), /Unknown or mixed/);
    assert.deepEqual(f.gate, before);
  });
}

for (const status of ["approved", "blocked", undefined]) {
  test(`target conversion refuses gate status ${String(status)}`, () => {
    const f = fixture("codex");
    f.gate.status = status;
    assert.throws(() => targetHubAcceptanceCertificate(f.gate, "claude"), /Suspend admission/);
  });
}

for (const provider of ["unknown", "toString", "constructor", "__proto__"]) {
  test(`target conversion refuses unknown provider ${provider}`, () => {
    const f = fixture("codex");
    assert.throws(() => targetHubAcceptanceCertificate(f.gate, provider), /Suspend admission/);
  });
}
