import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { acceptanceHub, seedReady, settle } from "./accept-helpers.mjs";
import { takeSnapshot } from "../server/factory/snapshot.mjs";
import { integrityDecision } from "../server/factory/bundle-integrity.mjs";
import { hashCanonical, sha256 } from "../server/core/canonical.mjs";
import { retireSuperseded, restoreRetired, readRetireJournal } from "../server/factory/factory.mjs";
import { createDeliveryExecutors } from "../server/delivery/executors.mjs";
import { captureBlockers } from "../server/delivery/capture-blockers.mjs";

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
    db.prepare("INSERT INTO factory_missions (mission_id, work_type, stage, limits_json, approved_spec_version, created_at, updated_at) VALUES (?,'FEATURE','CANCELLED','{}',1,?,?)").run(id, at, at);
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
  { name: "protected current test", tamper: "protected", code: "PROTECTED_INTEGRITY", stale: true },
  { name: "software and protected current test", tamper: "combined", code: "PROTECTED_INTEGRITY", stale: true },
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
  if (["software", "combined"].includes(scenario.tamper)) fs.appendFileSync(path.join(t.projectDir, "src/requests.js"), "\n// software change\n");
  if (scenario.tamper === "secret") fs.appendFileSync(path.join(t.projectDir, ".env"), "synthetic=longer\n");
  if (["protected", "combined"].includes(scenario.tamper)) fs.appendFileSync(path.join(t.projectDir, "test/acceptance.test.mjs"), "\n// altered\n");
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
  if (scenario.ok) {
    const event = t.hub.db.prepare("SELECT payload_json FROM events WHERE type = 'factory.bundle.status' AND json_extract(payload_json, '$.status') = 'OWNER_ACCEPTED'").get();
    assert.equal(JSON.parse(event.payload_json).integrity.decisionSha, verified.decisionSha);
  }
  assert.equal(t.hub.db.prepare("SELECT status FROM factory_bundles WHERE id = ?").get(b.bundleId).status, scenario.ok ? "OWNER_ACCEPTED" : scenario.stale ? "STALE" : "READY_FOR_OWNER_ACCEPTANCE");
  assert.equal(t.hub.deliveries.get(b.deliveryId).status, expected.unproven.length ? "STALE" : "READY");
  if (scenario.tamper === "historic") {
    assert.deepEqual(expected.unproven, []); assert.ok(verified.historicProblems.length);
    assert.deepEqual(t.hub.deliveries.get(b.deliveryId).verified.historicProblems, expected.historicProblems);
  }
  await settle();
});

test("INTEGRITY reconcile refuses terminally STALE bound bundle", async c => {
  const t = await acceptanceHub(); c.after(() => t.cleanup()); const b = await seedReady(t);
  t.hub.db.prepare("UPDATE factory_bundles SET status = 'STALE' WHERE id = ?").run(b.bundleId);
  t.hub.db.prepare("UPDATE deliveries SET status = 'STALE' WHERE id = ?").run(b.deliveryId);
  const result = t.hub.deliveries.reconcileStale(b.deliveryId, { actor: "test" });
  assert.equal(result.ok, false); assert.match(result.reasons.join(";"), /Pachetul legat/);
});

// Produce the later retirement with the real mover and a byte-bound base snapshot.
function retireAfterReady(t, ref) {
  const db = t.hub.db, at = t.config.now().toISOString(), sha = sha256(fs.readFileSync(path.join(t.projectDir, ref)));
  const spec = { supersedes: [{ testRef: ref, sha256: sha, missionId: "mis_origin", specVersion: 1, reason: "synthetic replacement" }] };
  db.prepare("INSERT INTO missions (id, project_id, kind, title, objective, created_at, updated_at) VALUES (?,?,'factory','Later','Later',?,?)").run(LATER, t.project.id, at, at);
  db.prepare("INSERT INTO factory_missions (mission_id, work_type, stage, limits_json, approved_spec_version, base_snapshot_id, created_at, updated_at) VALUES (?,'FEATURE','AUTHORING','{}',1,'snap_later',?,?)").run(LATER, at, at);
  const retired = retireSuperseded(LATER, spec, t.project);
  db.prepare("INSERT INTO factory_specs (id, mission_id, version, status, spec_json, sha256, protected_json, author, created_at) VALUES ('sp_later',?,1,'APPROVED',?,?,?,'test',?)")
    .run(LATER, JSON.stringify(spec), hashCanonical(spec), JSON.stringify({ retired }), at);
  const snap = takeSnapshot(t.projectDir, { mode: "walk" });
  db.prepare("INSERT INTO factory_snapshots (id, mission_id, seq, kind, manifest_json, stats_json, sha256, created_at) VALUES ('snap_later',?,1,'base',?,?,?,?)")
    .run(LATER, JSON.stringify(snap.files), JSON.stringify(snap.stats), snap.sha256, at);
  assert.equal(fs.existsSync(path.join(t.projectDir, ref)), false);
  assert.equal(sha256(fs.readFileSync(path.join(t.projectDir, retired[0].to))), sha);
  assert.equal(readRetireJournal(t.project, LATER).status, "MOVED");
  return retired;
}

test("INTEGRITY a later byte-proven retirement of historic.active keeps the earlier delivery READY", async c => {
  const t = await acceptanceHub(); c.after(() => t.cleanup());
  fs.mkdirSync(path.dirname(path.join(t.projectDir, REF)), { recursive: true }); fs.writeFileSync(path.join(t.projectDir, REF), TEXT);
  const b = await seedReady(t);
  const active = [{ ref: REF, sha256: sha256(TEXT), missionId: "mis_origin" }];
  t.hub.db.prepare("UPDATE factory_specs SET protected_json = json_set(protected_json, '$.historic.active', json(?)) WHERE mission_id = ?").run(JSON.stringify(active), b.missionId);
  assert.equal(t.hub.factory.integrityFacts(b.missionId, b).spec.protected_json.includes(REF), true);
  retireAfterReady(t, REF);
  assert.deepEqual(t.hub.factory.historicViolations(b.missionId), []);
  const verified = t.hub.deliveries.verify(b.deliveryId);
  assert.equal(verified.equal, true); assert.deepEqual(verified.unproven, []);
  assert.equal(verified.accepted.find(x => x.path === REF).provenance, "retired_by_hub");
  assert.equal(t.hub.deliveries.get(b.deliveryId).status, "READY");
  await t.authenticate(); assert.equal((await t.request(b.room, { body: b.body })).status, 200);
  const event = t.hub.db.prepare("SELECT payload_json FROM events WHERE type = 'factory.bundle.status' AND json_extract(payload_json, '$.status') = 'OWNER_ACCEPTED'").get();
  assert.equal(JSON.parse(event.payload_json).integrity.decisionSha, verified.decisionSha);
});

for (const kind of ["linked", "unreadable"]) test(`INTEGRITY retired own-test ${kind} path is never absence`, async c => {
  const t = await acceptanceHub(); c.after(() => t.cleanup()); const ref = REF, file = path.join(t.projectDir, ref);
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, TEXT);
  const b = await seedReady(t);
  t.hub.db.prepare("UPDATE factory_specs SET protected_json = json_set(protected_json, '$.files', json(?)) WHERE mission_id = ?").run(JSON.stringify({ [ref]: sha256(TEXT) }), b.missionId);
  retireAfterReady(t, ref);
  assert.equal(t.hub.deliveries.verify(b.deliveryId).equal, true, "control: proven retirement is accepted");
  if (kind === "linked") {
    const target = path.join(t.root, "own-test-link"); fs.mkdirSync(target); fs.symlinkSync(target, file, "junction");
    assert.equal(fs.lstatSync(file).isSymbolicLink(), true);
  } else {
    fs.writeFileSync(file, "// unreadable replacement\n"); assert.equal(fs.existsSync(file), true);
    const lstat = fs.lstatSync, stat = fs.statSync;
    const denied = fn => function (p, ...args) { if (path.resolve(String(p)) === file) throw Object.assign(new Error("synthetic access denied"), { code: "EACCES" }); return fn.call(this, p, ...args); };
    fs.lstatSync = denied(lstat); fs.statSync = denied(stat);
    c.after(() => { fs.lstatSync = lstat; fs.statSync = stat; });
    assert.throws(() => fs.lstatSync(file), { code: "EACCES" });
  }
  const decision = t.hub.factory.bundleIntegrity(b.missionId, b);
  assert.equal(decision.ok, false); assert.ok(decision.protectedProblems.length);
  assert.ok(decision.unproven.some(x => x.path === ref));
  assert.equal(decision.accepted.some(x => x.path === ref), false);
});

for (const caller of ["verify", "executor"]) test(`INTEGRITY ACTIVE item drift is marked STALE through ${caller}`, async c => {
  const t = await acceptanceHub(); c.after(() => t.cleanup()); const b = await seedReady(t), db = t.hub.db;
  db.prepare("UPDATE deliveries SET status = 'ACTIVE', ops_plan_id = 'op_drift' WHERE id = ?").run(b.deliveryId);
  const capture = t.hub.deliveries.bindItem(b.deliveryId, { kind: "capture", role: "desktop", refTable: "media_capture_sessions", refId: "cap_drift" });
  assert.equal(capture.status, "CURRENT");
  assert.equal(db.prepare("SELECT status FROM delivery_items WHERE delivery_id = ? AND kind = 'bundle'").get(b.deliveryId).status, "CURRENT");
  fs.appendFileSync(path.join(t.projectDir, "src/requests.js"), "\n// unproven source drift\n");
  assert.ok(t.hub.factory.bundleIntegrity(b.missionId, b).unproven.some(x => x.path === "src/requests.js"));
  if (caller === "verify") assert.equal(t.hub.deliveries.verify(b.deliveryId).equal, false);
  else {
    const ex = createDeliveryExecutors({ deliveries: { ...t.hub.deliveries, effectiveTemplate: d => d.template }, factory: t.hub.factory });
    await assert.rejects(ex["delivery.prepare"].run({ params: { deliveryId: b.deliveryId }, planId: "op_drift", authorize() {} }), { code: "SNAPSHOT_DRIFT" });
  }
  const items = db.prepare("SELECT status, stale_code FROM delivery_items WHERE delivery_id = ?").all(b.deliveryId);
  assert.equal(items.length, 2); assert.ok(items.every(x => x.status === "STALE" && x.stale_code === "SOFTWARE_CHANGED"));
  assert.equal(t.hub.deliveries.get(b.deliveryId).status, "ACTIVE");
});

test("INTEGRITY reconciliation never promotes a delivery that became STALE from NEEDS_OWNER", async c => {
  const t = await acceptanceHub(); c.after(() => t.cleanup()); const b = await seedReady(t);
  t.hub.db.prepare("UPDATE deliveries SET status = 'NEEDS_OWNER' WHERE id = ?").run(b.deliveryId);
  t.hub.deliveries.trigger(b.deliveryId, "software_changed", { changedFiles: [] }, "test");
  assert.equal(t.hub.deliveries.get(b.deliveryId).status, "STALE");
  const result = t.hub.deliveries.reconcileStale(b.deliveryId, { actor: "test" });
  assert.equal(result.ok, false); assert.match(result.reasons.join(";"), /nu a devenit STALE din READY/);
  assert.equal(t.hub.deliveries.get(b.deliveryId).status, "STALE");
});

for (const status of ["PLANNED", "ARMED", "ACTIVE"]) test(`INTEGRITY verification and preview refusal preserve ${status}`, async c => {
  const t = await acceptanceHub(); c.after(() => t.cleanup()); const b = await seedReady(t);
  t.hub.db.prepare("UPDATE deliveries SET status = ? WHERE id = ?").run(status, b.deliveryId);
  fs.appendFileSync(path.join(t.projectDir, "src/requests.js"), "\n// external change\n");
  assert.equal(t.hub.deliveries.verify(b.deliveryId).equal, false);
  const before = JSON.stringify(t.hub.deliveries.get(b.deliveryId));
  await assert.rejects(t.hub.deliveries.startPreview(b.deliveryId, { runner: t.hub.factoryRunner }), { code: "SNAPSHOT_DRIFT" });
  assert.equal(JSON.stringify(t.hub.deliveries.get(b.deliveryId)), before);
  assert.equal(t.hub.deliveries.get(b.deliveryId).status, status);
});

test("INTEGRITY git project: real retire, later retire, repair accepts exactly the untracked journal", async c => {
  let now = new Date("2026-10-16T10:00:00.000Z");
  const t = await acceptanceHub({ clock: () => now }); c.after(() => t.cleanup());
  const git = args => {
    const r = spawnSync("git", args, { cwd: t.projectDir, encoding: "utf8", env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: path.join(t.root, "no-gitconfig") } });
    assert.ifError(r.error); assert.equal(r.status, 0, r.stderr); return r.stdout;
  };
  git(["init"]); git(["add", "."]);
  git(["-c", "user.name=Synthetic", "-c", "user.email=synthetic@example.invalid", "-c", "commit.gpgsign=false", "commit", "-m", "Synthetic project baseline"]);
  retiredHistory(t); const b = await seedReady(t, { mode: "repository-index" });
  assert.equal(JSON.parse(t.hub.db.prepare("SELECT stats_json FROM factory_snapshots WHERE id = ?").get(b.snapId).stats_json).mode, "repository-index");
  assert.equal(git(["ls-files", ".ifrim-hub/"]).trim(), "");
  const files = JSON.parse(t.hub.db.prepare("SELECT manifest_json FROM factory_snapshots WHERE id = ?").get(b.snapId).manifest_json);
  assert.ok(Object.values(files).some(entry => entry.sha256?.startsWith("git:")), "committed blob entries exercise git comparison");
  now = new Date(now.getTime() + 1000); repairJournal(t);
  const decision = t.hub.factory.bundleIntegrity(b.missionId, b);
  assert.equal(decision.ok, true, JSON.stringify(decision));
  assert.deepEqual(decision.accepted.map(x => x.path), [JOURNAL]);
  assert.deepEqual(decision.unproven, []);
  assert.notEqual(decision.expectedSha, decision.actualSha, "journal bytes really differ");
  await t.authenticate(); assert.equal((await t.request(b.room, { body: b.body })).status, 200);
  const verified = t.hub.deliveries.verify(b.deliveryId);
  const event = t.hub.db.prepare("SELECT payload_json FROM events WHERE type = 'factory.bundle.status' AND json_extract(payload_json, '$.status') = 'OWNER_ACCEPTED'").get();
  assert.equal(JSON.parse(event.payload_json).integrity.decisionSha, verified.decisionSha);
});

test("INTEGRITY software_revision uses the shared verdict: proven journal keeps READY, unproven software stales", async c => {
  let now = new Date("2026-10-16T10:00:00.000Z");
  const t = await acceptanceHub({ clock: () => now }); c.after(() => t.cleanup());
  retiredHistory(t); const b = await seedReady(t); now = new Date(now.getTime() + 1000); repairJournal(t);
  t.hub.db.prepare("INSERT INTO factory_change_sets (id, mission_id, seq, snapshot_id, changes_json, sha256, status, created_at) VALUES ('cs_later_revision',?,1,?,?,'synthetic','CURRENT',?)")
    .run(LATER, b.snapId, JSON.stringify([{ path: JOURNAL, status: "modified" }]), now.toISOString());
  const emit = async () => {
    t.hub.bus.emit({ type: "factory.change_set", scopeType: "mission", scopeId: LATER, source: "test", payload: { missionId: LATER, changeSetId: "cs_later_revision", files: 1 } });
    await settle();
  };
  await emit();
  assert.equal(t.hub.deliveries.verify(b.deliveryId).equal, true);
  assert.equal(t.hub.deliveries.get(b.deliveryId).status, "READY");
  fs.appendFileSync(path.join(t.projectDir, "src/requests.js"), "\n// actual software revision\n");
  await emit();
  assert.equal(t.hub.deliveries.get(b.deliveryId).status, "STALE");
  const e = t.hub.db.prepare("SELECT payload_json FROM events WHERE type = 'delivery.status' AND scope_id = ? ORDER BY seq DESC LIMIT 1").get(b.deliveryId);
  assert.deepEqual(JSON.parse(e.payload_json).changedFiles, ["src/requests.js"]);
});

for (const kind of ["linked", "unreadable", "missing"]) for (const refs of [false, true]) test(`INTEGRITY R-HIST ${kind} test/hub with refs=${refs}`, async c => {
  const t = await acceptanceHub(); c.after(() => t.cleanup()); const b = await seedReady(t);
  if (refs) t.hub.db.prepare("UPDATE factory_specs SET protected_json = json_set(protected_json, '$.historic.active', json(?)) WHERE mission_id = ?")
    .run(JSON.stringify([{ ref: REF, sha256: sha256(TEXT), missionId: "mis_origin" }]), b.missionId);
  const suite = path.join(t.projectDir, "test/hub");
  if (kind === "linked") {
    const target = path.join(t.root, "linked-suite"); fs.mkdirSync(target);
    fs.symlinkSync(target, suite, "junction");
  } else if (kind === "unreadable") {
    fs.mkdirSync(suite); const readdir = fs.readdirSync;
    fs.readdirSync = function (folder, ...args) {
      if (path.resolve(String(folder)) === suite) throw Object.assign(new Error("synthetic access denied"), { code: "EACCES" });
      return readdir.call(this, folder, ...args);
    };
    c.after(() => { fs.readdirSync = readdir; });
  }
  const historic = t.hub.factory.historicViolations(b.missionId);
  assert.equal(historic.length > 0, refs);
  if (refs) assert.match(historic.join(";"), kind === "missing" ? /șters/ : /test\/hub nu poate fi verificat/);
  // Snapshot walking independently refuses unreadable folders; this case isolates the historic reader.
  if (kind !== "unreadable") assert.deepEqual(t.hub.factory.integrityFacts(b.missionId, b).historicProblems, historic);
});

test("INTEGRITY read-only preflight: real repair exits 0, tampered journal exits 2", async c => {
  let now = new Date("2026-10-16T10:00:00.000Z");
  const t = await acceptanceHub({ clock: () => now }); c.after(() => t.cleanup());
  retiredHistory(t); const b = await seedReady(t); now = new Date(now.getTime() + 1000); repairJournal(t);
  // A read-only WAL reader may change the -shm index. DB and -wal bytes must remain identical.
  assert.ok(fs.existsSync(`${t.config.dbPath}-wal`), "the no-write check includes an existing WAL");
  const state = () => ({ db: sha256(fs.readFileSync(t.config.dbPath)), wal: fs.existsSync(`${t.config.dbPath}-wal`) ? sha256(fs.readFileSync(`${t.config.dbPath}-wal`)) : null, mtime: fs.statSync(t.config.dbPath).mtimeMs,
    tree: hashCanonical(takeSnapshot(t.projectDir, { mode: "walk" })) });
  const run = (args = ["v2/scripts/accept-preflight.mjs", "--delivery", b.deliveryId, "--data-dir", t.config.dataDir]) => {
    const before = state();
    const result = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 30000 });
    assert.deepEqual(state(), before, "child preflight must preserve DB bytes + mtime and project tree");
    return result;
  };
  const before = t.hub.db.prepare("SELECT total_changes() n").get().n, first = run();
  assert.ifError(first.error); assert.equal(first.status, 0, first.stdout + first.stderr);
  assert.equal(JSON.parse(first.stdout).ok, true);
  assert.equal(JSON.parse(first.stdout).dbPath, path.resolve(t.config.dbPath));
  assert.equal(JSON.parse(first.stdout).dataLocationSource, "override");
  const journalSha = sha256(fs.readFileSync(path.join(t.projectDir, JOURNAL)));
  fs.appendFileSync(path.join(t.projectDir, JOURNAL), "\n ");
  assert.notEqual(sha256(fs.readFileSync(path.join(t.projectDir, JOURNAL))), journalSha, "tamper changes actual bytes");
  const second = run(); assert.ifError(second.error); assert.equal(second.status, 2, second.stdout + second.stderr);
  assert.equal(JSON.parse(second.stdout).ok, false); assert.equal(t.hub.db.prepare("SELECT total_changes() n").get().n, before);
  fs.writeFileSync(path.join(t.config.dataDir, "V2_MOVED.json"), "{}");
  const moved = run(); assert.ifError(moved.error); assert.equal(moved.status, 2);
  assert.match(JSON.parse(moved.stdout).reasons.join(";"), /V2_MOVED.json/);
  // The real resolver selects the default (no pointer/env); inject its directory inside this synthetic root.
  const fallback = run(["--input-type=module", "-e", `import { runPreflight } from './v2/scripts/accept-preflight.mjs'; import { resolveDataLocation } from './v2/server/config.mjs'; runPreflight({ ...${JSON.stringify({ args: ["--delivery", b.deliveryId], env: {}, locationFile: path.join(t.root, "no-pointer.json") })}, resolveLocation: options => ({ ...resolveDataLocation(options), dataDir: ${JSON.stringify(path.join(t.root, "default-data"))} }) });`]);
  assert.ifError(fallback.error); assert.equal(fallback.status, 2);
  assert.equal(JSON.parse(fallback.stdout).dataLocationSource, "default");
  assert.equal(JSON.parse(fallback.stdout).dbPath, path.join(t.root, "default-data", "hub-v2.sqlite"));
  assert.match(JSON.parse(fallback.stdout).problems.join(";"), /Locația implicită este refuzată/);
});

test("INTEGRITY preflight checks every delivery/acceptance precondition and fails closed on import", async c => {
  const t = await acceptanceHub(); c.after(() => t.cleanup()); const b = await seedReady(t), db = t.hub.db;
  const script = path.resolve("v2/scripts/accept-preflight.mjs");
  const run = (deliveryId = b.deliveryId, entry = script) => {
    const result = spawnSync(process.execPath, [entry, "--delivery", deliveryId, "--data-dir", t.config.dataDir], { encoding: "utf8", timeout: 30000 });
    assert.ifError(result.error); assert.ok(result.stdout.trim(), result.stderr); return { status: result.status, json: JSON.parse(result.stdout) };
  };
  const good = run(); assert.equal(good.status, 0); assert.equal(good.json.ok, true);
  assert.deepEqual([good.json.deliveryId, good.json.bundleId, good.json.missionId], [b.deliveryId, b.bundleId, b.missionId]);
  assert.deepEqual([good.json.deliveryStatus, good.json.bundleStatus, good.json.missionStage], ["READY", "READY_FOR_OWNER_ACCEPTANCE", "DELIVERY_READY"]);
  assert.equal(good.json.decisionSha, t.hub.deliveries.verify(b.deliveryId).decisionSha);
  const fail = (reason, deliveryId) => { const result = run(deliveryId); assert.equal(result.status, 2, JSON.stringify(result)); assert.equal(result.json.ok, false); assert.match(result.json.problems.join(";"), reason); return result.json; };
  fail(/Livrarea nu există/, "dlv_missing");
  for (const [table, idColumn, id, column, value, original, reason] of [
    ["deliveries", "id", b.deliveryId, "status", "ACTIVE", "READY", /Livrarea nu este READY/],
    ["deliveries", "id", b.deliveryId, "bundle_id", "bnd_missing", b.bundleId, /Pachetul sau misiunea/],
    ["deliveries", "id", b.deliveryId, "bundle_sha", "f".repeat(64), b.bundleSha, /Identitatea pachetului/],
    ["deliveries", "id", b.deliveryId, "snapshot_sha", "f".repeat(64), good.json.expectedSha, /Snapshot-ul/],
    ["deliveries", "id", b.deliveryId, "change_set_id", "cs_other", b.csId, /change set-ul/],
    ["factory_bundles", "id", b.bundleId, "status", "STALE", "READY_FOR_OWNER_ACCEPTANCE", /Pachetul nu este READY_FOR_OWNER_ACCEPTANCE/],
    ["factory_missions", "mission_id", b.missionId, "stage", "CANCELLED", "DELIVERY_READY", /Misiunea nu este DELIVERY_READY/],
  ]) {
    db.prepare(`UPDATE ${table} SET ${column} = ? WHERE ${idColumn} = ?`).run(value, id);
    assert.equal(db.prepare(`SELECT ${column} AS value FROM ${table} WHERE ${idColumn} = ?`).get(id).value, value);
    fail(reason); db.prepare(`UPDATE ${table} SET ${column} = ? WHERE ${idColumn} = ?`).run(original, id);
  }
  db.prepare(`INSERT INTO factory_bundles (id, mission_id, change_set_id, change_set_sha, spec_version, manifest_json, sha256, status, created_at)
    SELECT 'bnd_preflight_replacement', mission_id, change_set_id, change_set_sha, spec_version, manifest_json, sha256, status, created_at FROM factory_bundles WHERE id = ?`).run(b.bundleId);
  assert.equal(db.prepare("SELECT id FROM factory_bundles WHERE mission_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1").get(b.missionId).id, "bnd_preflight_replacement");
  fail(/ultimul pachet/); db.prepare("DELETE FROM factory_bundles WHERE id = 'bnd_preflight_replacement'").run();
  const at = t.config.now().toISOString();
  db.prepare("INSERT INTO media_capture_sessions (id, kind, status, scope_json, created_by, created_at, updated_at) VALUES ('cap_preflight','browser_demo','RECORDING',?,'test',?,?)")
    .run(JSON.stringify({ deliveryId: b.deliveryId }), at, at);
  assert.equal(captureBlockers(db, { missionId: b.missionId, projectId: t.project.id }).sessionId, "cap_preflight");
  assert.equal(fail(/Captură în curs/).captureBlockers.sessionId, "cap_preflight");
  db.prepare("DELETE FROM media_capture_sessions WHERE id = 'cap_preflight'").run();
  db.prepare("INSERT INTO ops_plans (id, kind, title, body_json, plan_hash, nonce, status, proposed_by, proposed_via, confirm_by, expires_at, created_at, updated_at) VALUES ('op_preflight','delivery.package','capture','{}',?,'test','RUNNING','test','test',?,?,?,?)").run("a".repeat(64), at, at, at, at);
  db.prepare("INSERT INTO ops_plan_steps (id, plan_id, seq, kind, status, updated_at) VALUES ('step_preflight','op_preflight',1,'delivery.capture','RUNNING',?)").run(at);
  db.prepare("UPDATE deliveries SET ops_plan_id = 'op_preflight' WHERE id = ?").run(b.deliveryId);
  assert.equal(captureBlockers(db, { missionId: b.missionId, projectId: t.project.id }).planId, "op_preflight");
  assert.equal(fail(/Captură în curs/).captureBlockers.planId, "op_preflight");
  db.prepare("UPDATE ops_plans SET status = 'PAUSED' WHERE id = 'op_preflight'").run();
  assert.equal(run().status, 0, "inactive plan control");
  // Node itself requires the .mjs extension in lower case, even on Windows.
  if (process.platform === "win32") assert.equal(run(b.deliveryId, path.join(path.dirname(script).toUpperCase(), path.basename(script))).status, 0, "Windows case-insensitive main detection");
  for (const entry of ["", "process.argv[1] = 'missing-entry.mjs';"]) {
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", `${entry} await import('./v2/scripts/accept-preflight.mjs');`], { encoding: "utf8", timeout: 30000 });
    assert.ifError(result.error); assert.equal(result.status, 2); assert.equal(result.stdout.trim(), "", "import never claims a successful check");
  }
});

for (const kind of ["identity", "protected"]) test(`INTEGRITY non-path ${kind} problems are recorded without a STALE cascade`, async c => {
  const t = await acceptanceHub(); c.after(() => t.cleanup()); const b = await seedReady(t), db = t.hub.db;
  if (kind === "identity") db.prepare("UPDATE factory_bundles SET manifest_json = '{}' WHERE id = ?").run(b.bundleId);
  else db.prepare("UPDATE factory_specs SET protected_json = json_set(protected_json, '$.files', json(?)) WHERE mission_id = ?").run(JSON.stringify({ "test/acceptance.test.mjs": "f".repeat(64) }), b.missionId);
  const verified = t.hub.deliveries.verify(b.deliveryId);
  assert.equal(verified.equal, false); assert.deepEqual(verified.unproven, []);
  assert.ok(verified[`${kind}Problems`].length);
  const d = t.hub.deliveries.get(b.deliveryId); assert.equal(d.status, "READY"); assert.deepEqual(d.verified, verified);
  assert.equal(db.prepare("SELECT status FROM delivery_items WHERE delivery_id = ?").get(b.deliveryId).status, "CURRENT");
  await assert.rejects(t.hub.deliveries.startPreview(b.deliveryId, { runner: t.hub.factoryRunner }), { code: "SNAPSHOT_DRIFT" });
});
