import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { hubAcceptanceScopes, exactHubAcceptanceScope } from "../apps/api/src/hub-acceptance-scope.mjs";

const conversation = "conversation-e6fbedfd-3b88-4bb5-8808-0b18cf4ccb29";
const expected = {
  codex: { acceptanceConversationId: conversation, acceptanceProvider: "codex",
    acceptanceModel: "openai/gpt-6-luna", acceptanceReasoning: "max", acceptanceAccessMode: "read-only" },
  claude: { acceptanceConversationId: conversation, acceptanceProvider: "claude",
    acceptanceModel: "anthropic/claude-sonnet-5", acceptanceReasoning: "medium", acceptanceAccessMode: "read-only" },
};

test("only the two exact reviewed routes are defined and deeply frozen", () => {
  assert.deepEqual(hubAcceptanceScopes, expected);
  assert.deepEqual(Object.keys(hubAcceptanceScopes), ["codex", "claude"]);
  assert.equal(Object.isFrozen(hubAcceptanceScopes), true);
  for (const scope of Object.values(hubAcceptanceScopes)) assert.equal(Object.isFrozen(scope), true);
  assert.throws(() => { hubAcceptanceScopes.codex.acceptanceAccessMode = "workspace-write"; }, TypeError);
});

for (const provider of ["codex", "claude"]) {
  test(`exact ${provider} scope matches without activation or mutation`, () => {
    const gate = { ...expected[provider], status: "suspended", providers: { synthetic: true } };
    const before = structuredClone(gate);
    assert.equal(exactHubAcceptanceScope(gate), hubAcceptanceScopes[provider]);
    assert.deepEqual(gate, before);
    assert.equal(gate.status, "suspended");
  });
}

for (const field of Object.keys(expected.codex)) {
  for (const [label, value] of [["empty", ""], ["null", null], ["undefined", undefined],
    ["false", false], ["number", 1], ["unknown", "unreviewed-value"]]) {
    test(`${field} ${label} cannot match an acceptance scope`, () => {
      for (const provider of ["codex", "claude"]) {
        const gate = { ...expected[provider], [field]: value };
        const before = structuredClone(gate);
        assert.equal(exactHubAcceptanceScope(gate), null);
        assert.deepEqual(gate, before);
      }
    });
  }
  test(`missing ${field} cannot match either scope`, () => {
    for (const provider of ["codex", "claude"]) {
      const gate = { ...expected[provider] };
      delete gate[field];
      assert.equal(exactHubAcceptanceScope(gate), null);
    }
  });
}

for (const field of ["acceptanceProvider", "acceptanceModel", "acceptanceReasoning"]) {
  test(`mixing ${field} between Codex and Claude is rejected`, () => {
    for (const [left, right] of [["codex", "claude"], ["claude", "codex"]]) {
      assert.equal(exactHubAcceptanceScope({ ...expected[left], [field]: expected[right][field] }), null);
    }
  });
}

test("missing, empty, legacy and unknown scope objects never select a default", () => {
  for (const gate of [null, undefined, {}, { status: "approved" }, { acceptanceProvider: "unknown" }]) {
    assert.equal(exactHubAcceptanceScope(gate), null);
  }
});

const source = () => fs.readFile(new URL("../tools/scope-hub-acceptance.mjs", import.meta.url), "utf8");

test("CLI rejects absent or unknown approval before any filesystem or lock action", async () => {
  const text = await source();
  assert.match(text, /if \(!\["--approved-hub-018-codex", "--approved-hub-018-claude", "--suspend-hub-018"\]\.includes\(mode\)\) throw new Error\("Approval required"\)/);
  assert.ok(text.indexOf('throw new Error("Approval required")') < text.indexOf("await assertPhysicalIsolationBoundary("));
  assert.ok(text.indexOf('throw new Error("Approval required")') < text.indexOf("await acquireSubscriptionMaintenanceLock("));
  assert.match(text, /mode === "--suspend-hub-018" \? exactHubAcceptanceScope\(gate\)/);
  assert.match(text, /if \(!scope\) throw new Error/);
});

test("all lease, provider and manual run checks apply to activation only", async () => {
  const text = await source();
  const branch = text.indexOf('if (mode !== "--suspend-hub-018")');
  const activation = text.indexOf('Object.assign(gate, scope, { status: "approved"');
  const checks = text.slice(branch, activation);
  assert.ok(branch >= 0 && activation > branch);
  assert.match(checks, /new db\.DatabaseSync\([^\n]+\{ readOnly: true \}\)/);
  assert.match(checks, /SELECT COUNT\(\*\) AS n FROM hub_leases/);
  assert.doesNotMatch(checks, /FROM hub_leases WHERE/);
  assert.match(checks, /FROM hub_provider_runs WHERE status='running'/);
  assert.match(checks, /FROM execution_attempts WHERE status='running'/);
  assert.match(checks, /finally \{ state\.close\(\); \}/);
  assert.match(text, /\} else \{\s*gate\.status = "suspended";\s*\}/);
});

test("activation binds provider-specific certificate and full suspended guards before approval", async () => {
  const text = await source();
  assert.match(text, /provider: scope\.acceptanceProvider, model: scope\.acceptanceModel/);
  assert.match(text, /reasoning: scope\.acceptanceReasoning, accessMode: "read-only"/);
  assert.ok(text.includes('`openclaw-${options.provider}-auth-evidence.json`'));
  assert.match(text, /gate\.providers\?\.\[options\.provider\]\?\.evidencePath !== evidencePath/);
  assert.match(text, /digest\(evidenceRaw\) !== gate\.providers\[options\.provider\]\.evidenceSha256/);
  const target = text.indexOf("const targetGate = targetHubAcceptanceCertificate(gate, options.provider)");
  const suspended = text.indexOf("validateSuspendedDiagnosticCertificate(targetGate, evidence, config, digest(raw), options)");
  const receipt = text.indexOf("await verifyGatewayReceipt(evidence.receipt)");
  const activate = text.indexOf('Object.assign(gate, scope, { status: "approved"');
  const approved = text.indexOf("validateSubscriptionGate(gate, config, digest(raw), options)");
  const write = text.indexOf("await fs.writeFile(");
  assert.ok(target >= 0 && target < suspended && suspended < receipt && receipt < activate && activate < approved && approved < write);
});

test("CLI preserves checkpoint and exclusive writes without automatic model or RPC activity", async () => {
  const text = await source();
  assert.match(text, /isSymbolicLink\(\)/);
  assert.match(text, /digest\(await fs\.readFile\(gateFile\)\) !== digest\(original\)/);
  assert.match(text, /await fs\.copyFile\(gateFile, backup, fs\.constants\.COPYFILE_EXCL\)/);
  assert.match(text, /await fs\.writeFile\(temporary, JSON\.stringify\(gate, null, 2\), \{ flag: "wx" \}\)/);
  assert.ok(text.indexOf("await fs.copyFile(") < text.indexOf("await fs.rename(temporary, gateFile)"));
  assert.match(text, /finally \{ await release\(\); \}/);
  assert.match(text, /modelStarted: false/);
  assert.doesNotMatch(text, /connectOpenClaw|connectCertifiedOpenClaw|\.request\(|startOpenClawProvider|sessions\.create|chat\.abort/);
});
