import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildIsolatedSubscriptionConfig } from "../apps/api/src/subscription-isolation.mjs";
import { digest } from "../apps/api/src/subscription-auth.mjs";
import { assertBootstrapReconciliationDelta, assertAppliedBootstrapConfiguration,
  bootstrapReconciledReceipt, reconcileHubBootstrapReceipt } from "../tools/reconcile-hub-bootstrap-receipt.mjs";

function fixture() {
  const root = path.resolve("synthetic-hub");
  const ids = ["main", "ifrim-backend", ...Array.from({ length: 21 }, (_, i) => `ifrim-fixture-${String.fromCharCode(97+i)}`)];
  const previous = buildIsolatedSubscriptionConfig({ agents: { entries: Object.fromEntries(ids.map(id => [id, {}])) },
    plugins: { entries: { codex: { config: { appServer: { command: path.join(root, "codex.exe") } } } } } }, root, "synthetic-token".repeat(4));
  delete previous.agents.defaults.skipBootstrap;
  const current = structuredClone(previous);
  current.agents.defaults.skipBootstrap = true;
  const receipt = { pid: 23596, startedAt: "synthetic-start", port: 18790, projectRoot: root,
    environment: { APPDATA: "synthetic-appdata" }, configSha256: digest(JSON.stringify(previous)),
    customIdentity: "preserve" };
  const applied = { valid: true, hash: "new-applied-hash", configRevisionHash: "new-revision",
    appliedConfigHash: "new-revision", config: structuredClone(current), sourceConfig: structuredClone(current), parsed: structuredClone(current) };
  return { previous, current, receipt, applied };
}

test("exact one-field bootstrap delta succeeds without input mutation", () => {
  const f = fixture(); const before = structuredClone(f);
  assert.doesNotThrow(() => assertBootstrapReconciliationDelta(f.previous, f.current));
  assert.deepEqual(f, before);
});

for (const [label, modify] of [
  ["missing flag", f => { delete f.current.agents.defaults.skipBootstrap; }],
  ["false flag", f => { f.current.agents.defaults.skipBootstrap = false; }],
  ["wrong flag type", f => { f.current.agents.defaults.skipBootstrap = "true"; }],
  ["changed model", f => { f.current.agents.defaults.model.primary = "openai/other"; }],
  ["changed role", f => { f.current.agents.entries.main.model.primary = "openai/other"; }],
  ["added env", f => { f.current.env = { API_KEY: "synthetic" }; }],
  ["changed port", f => { f.current.gateway.port = 18789; }],
]) {
  test(`bootstrap delta rejects ${label}`, () => {
    const f = fixture(); modify(f);
    assert.throws(() => assertBootstrapReconciliationDelta(f.previous, f.current), /Only the approved/);
  });
}

test("live applied snapshot accepts exact projected configuration and changed revision", () => {
  const f = fixture(); const before = structuredClone(f);
  assert.doesNotThrow(() => assertAppliedBootstrapConfiguration(f.applied, f.current, "old-applied-hash"));
  assert.deepEqual(f, before);
});

test("official redacted snapshot may differ from raw sourceConfig only by uiHints", () => {
  const f = fixture();
  const projected = structuredClone(f.current);
  projected.gateway.auth.token = "[redacted]";
  const snapshot = { ...f.applied, config: { ...structuredClone(projected), uiHints: { "synthetic-only": "display" } },
    sourceConfig: structuredClone(f.current), parsed: structuredClone(projected) };
  const before = structuredClone(snapshot);
  assert.doesNotThrow(() => assertAppliedBootstrapConfiguration(snapshot, projected, "old-applied-hash"));
  assert.notDeepEqual(snapshot.config, snapshot.sourceConfig);
  assert.notDeepEqual(snapshot.parsed, snapshot.sourceConfig);
  assert.deepEqual(snapshot, before);
});

test("uiHints allowance cannot hide an alternate parsed configuration delta", () => {
  const f = fixture();
  const projected = structuredClone(f.current);
  projected.gateway.auth.token = "[redacted]";
  const snapshot = { ...f.applied, config: { ...structuredClone(projected), uiHints: { "synthetic-only": "display" } },
    sourceConfig: structuredClone(f.current), parsed: { ...structuredClone(projected), gateway: { ...projected.gateway, port: 18789 } } };
  assert.throws(() => assertAppliedBootstrapConfiguration(snapshot, projected, "old-applied-hash"), /exact bootstrap-disabled/);
});

for (const [label, modify] of [
  ["invalid", f => { f.applied.valid = false; }],
  ["same hash", f => { f.applied.hash = "old-applied-hash"; }],
  ["missing hash", f => { delete f.applied.hash; }],
  ["missing revision", f => { delete f.applied.configRevisionHash; }],
  ["stale applied revision", f => { f.applied.appliedConfigHash = "stale"; }],
  ["bootstrap still enabled", f => { f.applied.config.agents.defaults.skipBootstrap = false; }],
  ["extra parsed delta", f => { f.applied.parsed.gateway.port = 18789; }],
  ["missing parsed", f => { delete f.applied.parsed; }],
]) {
  test(`live applied check rejects ${label}`, () => {
    const f = fixture(); modify(f);
    assert.throws(() => assertAppliedBootstrapConfiguration(f.applied, f.current, "old-applied-hash"), /exact bootstrap-disabled/);
  });
}

test("candidate changes only config binding and records internal recovery as owner-reported", () => {
  const f = fixture();
  const before = structuredClone(f.receipt);
  const hash = digest(JSON.stringify(f.current));
  const checkpoints = { configBackup: "synthetic-config-checkpoint", receiptBackup: "synthetic-receipt-checkpoint" };
  const candidate = bootstrapReconciledReceipt(f.receipt, hash, f.applied, checkpoints, "2026-09-29T17:00:00Z");
  const { configSha256, configurationUpdate, ...identity } = candidate;
  const { configSha256: oldHash, ...originalIdentity } = before;
  assert.deepEqual(identity, originalIdentity);
  assert.equal(configSha256, hash);
  assert.equal(configurationUpdate.previousConfigSha256, oldHash);
  assert.equal(configurationUpdate.appliedConfigRevisionHash, f.applied.configRevisionHash);
  assert.equal(configurationUpdate.gatewayConfigHash, f.applied.hash);
  assert.equal(configurationUpdate.internalGatewayRecovery, true);
  assert.deepEqual(configurationUpdate.recovery, { kind: "native-internal-SIGUSR2-recovery",
    observation: "owner-reported", sameProcessIdentityVerified: true, processReplaced: false });
  assert.equal(candidate.pid, 23596);
  assert.deepEqual(f.receipt, before);
});

for (const [label, modify] of [
  ["unchanged config hash", (f, state) => { state.hash = f.receipt.configSha256; }],
  ["missing config hash", (_f, state) => { state.hash = undefined; }],
]) {
  test(`candidate rejects ${label}`, () => {
    const f = fixture(); const state = { hash: digest(JSON.stringify(f.current)) }; modify(f, state);
    assert.throws(() => bootstrapReconciledReceipt(f.receipt, state.hash, f.applied, {}, "synthetic-time"),
      label === "missing config hash" ? /complete lowercase digest/ : /Receipt identity/);
  });
}

test("exported reconciliation rejects a temp checkout before hooks or filesystem writes", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hub-rebind-reject-test-"));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("hub-rebind-reject-test-"));
    await fs.rm(root, { recursive: true, force: true });
  });
  const marker = path.join(root, "preserved.txt");
  await fs.writeFile(marker, "preserve");
  let called = 0;
  const fail = async () => { called++; throw new Error("Hook must not run"); };
  await assert.rejects(reconcileHubBootstrapReceipt(root, {
    boundary: fail, acquireLock: fail, verifyReceipt: fail, connect: fail, idleOwner: fail, projectConfig: fail,
    files: { lstat: fail, readFile: fail, copyFile: fail, open: fail, rename: fail },
  }), /restricted to this Hub checkout/);
  assert.equal(called, 0);
  assert.equal(await fs.readFile(marker, "utf8"), "preserve");
});

test("static flow enforces old checkpoints, Claude suspended, idle custody and receipt-only publication", async () => {
  const source = await fs.readFile(new URL("../tools/reconcile-hub-bootstrap-receipt.mjs", import.meta.url), "utf8");
  assert.match(source, /checkpointSuffix = "2026-09-29T16-32-34\.832Z"/);
  assert.match(source, /root !== hubRoot/);
  assert.match(source, /receiptRaw\.equals\(previousReceiptRaw\) \|\| !gateRaw\.equals\(previousGateRaw\)/);
  assert.match(source, /receipt\.pid !== 23596/);
  assert.match(source, /exactHubAcceptanceScope\(gate\) !== hubAcceptanceScopes\.claude \|\| gate\.status !== "suspended"/);
  for (const sql of ["hub_leases", "hub_provider_runs WHERE status='running'", "execution_attempts WHERE status='running'"]) {
    assert.ok(source.includes(sql));
  }
  assert.match(source, /new DatabaseSync\(database, \{ readOnly: true \}\)/);
  assert.match(source, /await verifyReceipt\(identityCandidate\)/);
  assert.match(source, /await verifyReceipt\(candidate\)/);
  assert.match(source, /assertAppliedBootstrapConfiguration\(applied, projected, gate\.gatewayConfigHash\)/);
  assert.match(source, /assertAppliedBootstrapConfiguration\(final, projected, gate\.gatewayConfigHash\)/);
  assert.match(source, /await unchanged\(\);\s*await files\.rename\(temporary, receiptFile\)/);
  assert.doesNotMatch(source, /files\.rename\([^,]+,\s*(?:gateFile|target\.config)\)/);
  const backed = source.indexOf("await files.copyFile(file, backup, fs.constants.COPYFILE_EXCL)");
  const staged = source.indexOf("const handle = await files.open(temporary, \"wx\", 0o600)");
  const published = source.indexOf("await files.rename(temporary, receiptFile)");
  assert.ok(backed >= 0 && backed < staged && staged < published);
  assert.match(source, /process\.argv\[2\] !== "--approved-hub-018" \|\| process\.argv\.length !== 3 \|\| process\.platform !== "win32"/);
  assert.doesNotMatch(source, /\.request\("(?:agent|sessions\.create|chat\.abort)"/);
});
