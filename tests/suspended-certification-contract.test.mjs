import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const read = () => fs.readFile(new URL("../tools/certify-openclaw-subscription.mjs", import.meta.url), "utf8");

test("suspended certification and legacy certification require explicit CLI approvals", async () => {
  const source = await read();
  assert.match(source, /const suspendedMode = process\.argv\[2\] === "--approved-suspended-hub-018"/);
  assert.match(source, /if \(!suspendedMode && process\.argv\[2\] !== "--approved-hub-018"\) throw new Error\("Approval required"\)/);
  assert.ok(source.indexOf('throw new Error("Approval required")') < source.indexOf("await acquireSubscriptionMaintenanceLock(root)"));
});

test("suspended mode requires exact scope and zero leases/provider/manual running work", async () => {
  const source = await read();
  const guards = source.slice(source.indexOf("if (suspendedMode) {"), source.indexOf("const target = isolationPaths(root)"));
  assert.match(guards, /previousGate\.status !== "suspended" \|\| !exactHubAcceptanceScope\(previousGate\)/);
  assert.match(guards, /new DatabaseSync\([^\n]+\{ readOnly: true \}\)/);
  assert.match(guards, /FROM hub_leases/);
  assert.doesNotMatch(guards, /FROM hub_leases WHERE/);
  assert.match(guards, /FROM hub_provider_runs WHERE status='running'/);
  assert.match(guards, /FROM execution_attempts WHERE status='running'/);
  assert.match(guards, /finally \{ db\.close\(\); \}/);
});

test("three original certificates are checkpointed exclusively before audits", async () => {
  const source = await read();
  assert.match(source, /for \(const file of \[gateFile, \.\.\.\["codex", "claude"\]\.map/);
  assert.match(source, /!stat\.isFile\(\) \|\| stat\.isSymbolicLink\(\)/);
  assert.match(source, /originalEvidence\[file\] = file === gateFile \? originalGate : await fs\.readFile\(file\)/);
  assert.match(source, /digest\(await fs\.readFile\(file\)\) !== digest\(originalEvidence\[file\]\)/);
  assert.match(source, /await fs\.writeFile\(`\$\{file\}\.checkpoint-recert-\$\{stamp\}`, originalEvidence\[file\], \{ flag: "wx" \}\)/);
  const compare = source.indexOf('throw new Error("Certificate changed before checkpoint")');
  const backup = source.indexOf("await fs.writeFile(`${file}.checkpoint-recert-");
  assert.ok(compare >= 0 && compare < backup && backup < source.indexOf("const pluginEvidence = await inspectIsolatedPlugin("));
});

test("both providers and all 23 unique roles including main must pass before connect", async () => {
  const source = await read();
  assert.match(source, /agents\.length !== 23 \|\| new Set\(agents\)\.size !== 23 \|\| !agents\.includes\("main"\)/);
  assert.match(source, /for \(const provider of \["codex", "claude"\]\)/);
  assert.match(source, /for \(const agentId of agents\) evidence\.agents\[agentId\]/);
  assert.match(source, /suspendedMode && Object\.keys\(providers\)\.length !== 2/);
  assert.ok(source.indexOf('throw new Error("Both subscriptions must be certified; gate remains suspended")') < source.indexOf("await connectOpenClaw("));
});

test("suspended mode defers evidence publication and preserves status and previous scope", async () => {
  const source = await read();
  assert.match(source, /if \(suspendedMode\) pendingEvidence\[evidencePath\] = data;\s*else await fs\.writeFile\(evidencePath, data\)/);
  assert.match(source, /const gate = \{ \.\.\.\(previousGate \|\| \{\}\), status: suspendedMode \? "suspended" : "approved"/);
  assert.match(source, /suspendedMode && config\.agents\?\.defaults\?\.skipBootstrap !== true/);
});

test("second credential audit compares every role and keeps fresh plugin and receipt checks", async () => {
  const source = await read();
  const second = source.slice(source.indexOf("const gate ="), source.indexOf("for (const [file, data]"));
  assert.match(second, /for \(const provider of \["codex", "claude"\]\)/);
  assert.match(second, /for \(const agentId of agents\)/);
  assert.match(second, /inspectSubscriptionCredentialSources\(config/);
  assert.match(second, /!isDeepStrictEqual\(current, saved\.agents\[agentId\]\)/);
  assert.match(second, /await verifyGatewayReceipt\(receipt\)/);
  assert.equal((source.match(/await inspectIsolatedPlugin\(root, receipt\.environment\)/g) || []).length, 3);
  assert.match(source, /!isDeepStrictEqual\(pluginEvidence, await inspectIsolatedPlugin/);
  const credentials = second.indexOf("!isDeepStrictEqual(current, saved.agents[agentId])");
  const plugin = second.indexOf("!isDeepStrictEqual(pluginEvidence, await inspectIsolatedPlugin(");
  assert.ok(credentials >= 0 && credentials < plugin && plugin < second.indexOf("await verifyGatewayReceipt(receipt)"));
});

test("all certificate and config bytes are checked for concurrency before staging", async () => {
  const source = await read();
  const start = source.indexOf("for (const [file, initial] of Object.entries(originalEvidence))");
  const stage = source.indexOf("for (const [file, data] of");
  assert.ok(start >= 0 && start < stage);
  const checks = source.slice(start, stage);
  assert.match(checks, /digest\(await fs\.readFile\(file\)\) !== digest\(initial\)/);
  assert.match(checks, /digest\(await fs\.readFile\(target\.config\)\) !== digest\(raw\)/);
});

test("exclusive staging publishes both evidence files before the gate last", async () => {
  const source = await read();
  assert.match(source, /for \(const \[file, data\] of \[\.\.\.Object\.entries\(pendingEvidence\), \[gateFile, JSON\.stringify\(gate, null, 2\)\]\]\)/);
  assert.match(source, /await fs\.writeFile\(temporary, data, \{ flag: "wx" \}\)/);
  assert.match(source, /await fs\.rename\(temporary, file\)/);
});

test("final applied-config validation must reject valid=false before publication", async () => {
  const source = await read();
  const final = source.slice(source.indexOf('const final = await client.request("config.get"'), source.indexOf("for (const [file, initial] of Object.entries(originalEvidence))"));
  assert.match(final, /final\.valid !== true/);
  assert.match(final, /final\.hash !== snapshot\.hash/);
  assert.match(final, /final\.appliedConfigHash !== final\.configRevisionHash/);
});

test("certification has no agent request and always closes client and maintenance lock", async () => {
  const source = await read();
  assert.doesNotMatch(source, /\.request\("(?:agent|sessions\.create|chat\.abort)"/);
  assert.match(source, /modelStarted: false/);
  assert.match(source, /finally \{ await client\.stopAndWait\(\); \}/);
  assert.match(source, /finally \{ await releaseMaintenanceLock\(\); \}/);
});
