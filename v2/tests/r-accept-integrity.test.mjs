import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { acceptanceHub, seedReady, settle } from "./accept-helpers.mjs";
import { integrityDecision } from "../server/factory/bundle-integrity.mjs";
import { hashCanonical, sha256 } from "../server/core/canonical.mjs";
import { retireSuperseded, restoreRetired, readRetireJournal } from "../server/factory/factory.mjs";

test("INTEGRITY pure decision: raw hashes, per-path closure, identity, protected and historic failures", () => {
  const originalManifest = { "src/a.js": { sha256: "a".repeat(64) } }, snapshotSha = hashCanonical(originalManifest);
  const specBody = { acceptance: [] }, specSha = hashCanonical(specBody), csSha = hashCanonical({ snapshot: snapshotSha, changes: [] });
  const manifest = { spec: { sha256: specSha }, changeSet: { id: "cs_test", sha256: csSha, snapshot: snapshotSha } };
  const bSha = hashCanonical(manifest);
  const facts = { target: { missionId: "mis_test", bundleId: "bnd_test", bundleSha: bSha },
    bundle: { id: "bnd_test", mission_id: "mis_test", sha256: bSha, change_set_id: "cs_test", change_set_sha: csSha, spec_version: 1 }, manifest,
    changeSet: { id: "cs_test", mission_id: "mis_test", status: "CURRENT", sha256: csSha }, changeSetSha: csSha,
    spec: { mission_id: "mis_test", status: "APPROVED", version: 1, sha256: specSha }, specBody, approvedSpecVersion: 1,
    snapshot: { mission_id: "mis_test", sha256: snapshotSha }, originalManifest, current: { sha256: "f".repeat(64) }, changes: [], provenance: {} };
  // Git representations can differ while diffManifests says the bytes are the same.
  assert.equal(integrityDecision(facts).ok, true);
  const ref = ".ifrim-hub/retired/mis_old/journal.json", record = { kind: "factory.retire_restored", ref: "42", sha256: "b".repeat(64) };
  for (const [name, patch, ok] of [
    ["journal proven", { changes: [{ path: ref, status: "modified" }], provenance: { [ref]: { valid: true, provenance: "hub_retire_journal", record } } }, true],
    ["journal unproven", { changes: [{ path: ref, status: "modified" }], provenance: { [ref]: { valid: false, reason: "octeți diferiți" } } }, false],
    ["software", { changes: [{ path: "src/a.js", status: "modified" }] }, false],
    ["secret-like", { changes: [{ path: ".env", status: "modified" }] }, false],
    ["protected", { protectedProblems: ["test changed"] }, false],
    ["historic", { historicProblems: ["historic changed"] }, false],
    ["identity", { changeSetSha: "wrong" }, false],
  ]) {
    const decision = integrityDecision({ ...facts, ...patch });
    assert.equal(decision.ok, ok, name);
    assert.equal(decision.expectedSha, snapshotSha); assert.equal(decision.actualSha, facts.current.sha256);
    assert.equal(decision.changed.length, decision.accepted.length + decision.unproven.length);
    const { decisionSha, ...body } = decision; assert.equal(decisionSha, hashCanonical(body));
  }
});

const OLD = "mis_accept_old", LATER = "mis_accept_later", REF = "test/hub/previous-abcdef.test.mjs";
const JOURNAL = `.ifrim-hub/retired/${OLD}/journal.json`, TEXT = "// previous synthetic Hub test\n";
function retiredHistory(t) {
  const db = t.hub.db, project = t.project, digest = sha256(TEXT);
  const spec = { supersedes: [{ testRef: REF, sha256: digest, missionId: "mis_origin", specVersion: 1, reason: "synthetic replacement" }] };
  for (const [id, at] of [[OLD, "2026-10-10T10:00:00.000Z"], [LATER, "2026-10-15T10:00:00.000Z"]]) {
    db.prepare("INSERT INTO missions (id, project_id, kind, title, objective, created_at, updated_at) VALUES (?,?,'factory','Retire synthetic','Retire synthetic',?,?)").run(id, project.id, at, at);
    db.prepare("INSERT INTO factory_missions (mission_id, work_type, stage, approved_spec_version, created_at, updated_at) VALUES (?,'FEATURE','CANCELLED',1,?,?)").run(id, at, at);
    db.prepare("INSERT INTO factory_specs (id, mission_id, version, status, spec_json, sha256, author, created_at) VALUES (?,?,1,'APPROVED',?,?,'test',?)").run(`sp_${id}`, id, JSON.stringify(spec), hashCanonical(spec), at);
  }
  const file = path.join(project.path, REF); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, TEXT);
  const retired = retireSuperseded(OLD, spec, project);
  assert.equal(restoreRetired(retired, project, { missionId: OLD }).complete, true);
  db.prepare("UPDATE factory_specs SET protected_json = ? WHERE mission_id = ?").run(JSON.stringify({ retired, restored: retired, restoreBlocked: false }), OLD);
  const later = retireSuperseded(LATER, spec, project);
  db.prepare("UPDATE factory_specs SET protected_json = ? WHERE mission_id = ?").run(JSON.stringify({ retired: later }), LATER);
}
function repairJournal(t) {
  const j = readRetireJournal(t.project, OLD);
  fs.writeFileSync(path.join(t.projectDir, JOURNAL), JSON.stringify({ ...j, status: "RESTORE_INCOMPLETE", problems: ["legacy false incomplete"], items: j.items.map(i => ({ ...i, state: "incomplete" })) }));
  t.hub.db.prepare("UPDATE factory_specs SET protected_json = json_set(protected_json, '$.restoreBlocked', json('true')) WHERE mission_id = ?").run(OLD);
  const r = t.hub.factory.compensateRetirement(OLD, "synthetic later-retirement repair");
  assert.equal(r.state, "repaired_after_later_retirement");
  const event = t.hub.db.prepare("SELECT payload_json FROM events WHERE type = 'factory.retire_restored' AND scope_id = ? ORDER BY seq DESC LIMIT 1").get(OLD);
  assert.equal(JSON.parse(event.payload_json).sha256, sha256(fs.readFileSync(path.join(t.projectDir, JOURNAL))));
}

const cases = [
  { name: "legitimate repaired journal", journal: true, ok: true },
  { name: "schema-valid edited journal", journal: true, tamper: "edit", code: "HUB_RECORD_UNPROVEN" },
  { name: "journal without write record", journal: true, tamper: "no-record", code: "HUB_RECORD_UNPROVEN" },
  { name: "attestation alone", journal: true, tamper: "attestation", code: "HUB_RECORD_UNPROVEN" },
  { name: "real software change", tamper: "software", code: "SNAPSHOT_DRIFT", stale: true },
  { name: "secret-like size/mtime change", tamper: "secret", code: "SNAPSHOT_DRIFT", stale: true },
  { name: "protected current test", tamper: "protected", code: "PROTECTED_INTEGRITY" },
  { name: "historic test affected", tamper: "historic", code: "HISTORIC_INTEGRITY" },
];
for (const scenario of cases) for (const route of ["room", "panel"]) test(`INTEGRITY ${route}: ${scenario.name} agrees with delivery verification`, async c => {
  let now = new Date("2026-10-16T10:00:00.000Z");
  const t = await acceptanceHub({ clock: () => now }); c.after(() => t.cleanup());
  if (scenario.journal) retiredHistory(t);
  if (scenario.tamper === "secret") fs.writeFileSync(path.join(t.projectDir, ".env"), "synthetic=one\n");
  const b = await seedReady(t);
  now = new Date(now.getTime() + 1000);
  if (scenario.journal) repairJournal(t);
  if (scenario.tamper === "edit") { const file = path.join(t.projectDir, JOURNAL), j = JSON.parse(fs.readFileSync(file)); fs.writeFileSync(file, JSON.stringify({ ...j, extra: "schema-valid unrecorded edit" })); }
  if (scenario.tamper === "no-record") t.hub.db.prepare("DELETE FROM events WHERE type = 'factory.retire_restored' AND scope_id = ?").run(OLD);
  if (scenario.tamper === "attestation") t.hub.db.prepare("UPDATE events SET payload_json = json_set(payload_json, '$.state', 'already_restored') WHERE type = 'factory.retire_restored' AND scope_id = ?").run(OLD);
  if (scenario.tamper === "software") fs.appendFileSync(path.join(t.projectDir, "src/requests.js"), "\n// software change\n");
  if (scenario.tamper === "secret") fs.appendFileSync(path.join(t.projectDir, ".env"), "synthetic=longer\n");
  if (scenario.tamper === "protected") fs.appendFileSync(path.join(t.projectDir, "test/acceptance.test.mjs"), "\n// altered\n");
  if (scenario.tamper === "historic") {
    t.hub.db.prepare("UPDATE factory_specs SET protected_json = json_set(protected_json, '$.historic', json(?)) WHERE mission_id = ?").run(JSON.stringify({ active: [{ ref: "src/requests.js", sha256: "a".repeat(64), missionId: "mis_historic" }], retired: [] }), b.missionId);
  }
  const expected = t.hub.factory.bundleIntegrity(b.missionId, b);
  assert.equal(expected.ok, Boolean(scenario.ok), JSON.stringify(expected));
  if (scenario.journal) assert.equal(expected.changed.some(x => x.path === JOURNAL), true);
  if (scenario.ok) assert.equal(expected.accepted.find(x => x.path === JOURNAL).record.kind, "factory.retire_restored");
  await t.authenticate();
  const r = await t.request(b[route], { body: b.body });
  assert.equal(r.status, scenario.ok ? 200 : 409, JSON.stringify(r.json));
  if (!scenario.ok) { assert.equal(r.json.code || r.json.error?.code, scenario.code, JSON.stringify(r.json)); assert.match(JSON.stringify(r.json), new RegExp(expected.decisionSha)); }
  const verified = t.hub.deliveries.verify(b.deliveryId);
  assert.equal(verified.equal, Boolean(scenario.ok)); assert.equal(verified.decisionSha, expected.decisionSha);
  assert.deepEqual(verified.accepted, expected.accepted);
  assert.equal(t.hub.db.prepare("SELECT status FROM factory_bundles WHERE id = ?").get(b.bundleId).status, scenario.ok ? "OWNER_ACCEPTED" : scenario.stale ? "STALE" : "READY_FOR_OWNER_ACCEPTANCE");
  assert.equal(t.hub.deliveries.get(b.deliveryId).status, scenario.ok ? "READY" : "STALE");
  await settle();
});

test("INTEGRITY reconcile refuses terminally STALE bound bundle", async c => {
  const t = await acceptanceHub(); c.after(() => t.cleanup()); const b = await seedReady(t);
  t.hub.db.prepare("UPDATE factory_bundles SET status = 'STALE' WHERE id = ?").run(b.bundleId);
  t.hub.db.prepare("UPDATE deliveries SET status = 'STALE' WHERE id = ?").run(b.deliveryId);
  const result = t.hub.deliveries.reconcileStale(b.deliveryId, { actor: "test" });
  assert.equal(result.ok, false); assert.match(result.reasons.join(";"), /Pachetul legat/);
});

test("INTEGRITY read-only preflight: real repair exits 0, tampered journal exits 2", async c => {
  let now = new Date("2026-10-16T10:00:00.000Z");
  const t = await acceptanceHub({ clock: () => now }); c.after(() => t.cleanup());
  retiredHistory(t); const b = await seedReady(t); now = new Date(now.getTime() + 1000); repairJournal(t);
  const run = () => spawnSync(process.execPath, ["v2/scripts/accept-preflight.mjs", "--delivery", b.deliveryId, "--data-dir", t.config.dataDir], { encoding: "utf8", timeout: 30000 });
  const before = t.hub.db.prepare("SELECT total_changes() n").get().n, first = run();
  assert.ifError(first.error); assert.equal(first.status, 0, first.stdout + first.stderr);
  assert.equal(JSON.parse(first.stdout).ok, true);
  fs.appendFileSync(path.join(t.projectDir, JOURNAL), "\n ");
  const second = run(); assert.ifError(second.error); assert.equal(second.status, 2, second.stdout + second.stderr);
  assert.equal(JSON.parse(second.stdout).ok, false); assert.equal(t.hub.db.prepare("SELECT total_changes() n").get().n, before);
});
