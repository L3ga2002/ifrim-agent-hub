// Round G: real synthetic files + a freshly migrated DB; no Hub, provider, browser, server or Git process.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { openDatabase, migrate } from '../server/storage/db.mjs';
import { createEventBus } from '../server/events/bus.mjs';
import { hashCanonical, sha256 } from '../server/core/canonical.mjs';
import { createFactory, retireSuperseded, restoreRetired, readRetireJournal } from '../server/factory/factory.mjs';
import { takeSnapshot } from '../server/factory/snapshot.mjs';
import { createDeliveries } from '../server/delivery/delivery.mjs';

const M1 = 'mis_rl_old', M2 = 'mis_rl_later', D = 'dlv_rl';
const REF = 'test/hub/retired-abcdef.test.mjs', TEXT = '// synthetic Hub test\n';
const J1 = `.ifrim-hub/retired/${M1}/journal.json`, J2 = `.ifrim-hub/retired/${M2}/journal.json`;
const T1 = '2026-10-10T10:00:00.000Z', T2 = '2026-10-15T10:00:00.000Z', TS = '2026-10-15T11:00:00.000Z';
const clock = () => new Date('2026-10-16T10:00:00.000Z');
const json = JSON.stringify;
const settle = () => new Promise(resolve => setTimeout(resolve, 30));

function fixture(t, { invalid = null, differentOriginal = false, two = false } = {}) {
  const root = path.resolve('.ifrim/tmp/round-g');
  fs.mkdirSync(root, { recursive: true });
  const dir = fs.mkdtempSync(path.join(root, 'retire-'));
  const project = { id: 'prj_rl', path: path.join(dir, 'project'), source: 'hub-test' };
  fs.mkdirSync(project.path);
  const db = openDatabase(path.join(dir, 'test.sqlite')); migrate(db);
  const bus = createEventBus(db, clock);
  const write = (ref, bytes) => { const file = path.join(project.path, ref); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes); };
  const read = ref => fs.readFileSync(path.join(project.path, ref));
  const remove = ref => fs.unlinkSync(path.join(project.path, ref));
  const refs = two ? [REF, 'test/hub/second-abcdef.test.mjs'] : [REF];
  const spec = { supersedes: refs.map(testRef => ({ testRef, sha256: sha256(TEXT), missionId: 'mis_origin', specVersion: 1, reason: 'synthetic replacement' })) };
  db.prepare("INSERT INTO projects (id, slug, name, path, source, created_at, updated_at) VALUES (?, 'rl', 'RL', ?, 'hub-test', ?, ?)").run(project.id, project.path, T1, T1);
  for (const [id, at] of [[M1, T1], [M2, invalid === 'older' ? '2026-10-09T10:00:00.000Z' : invalid === 'same-time' ? T1 : T2]]) {
    db.prepare("INSERT INTO missions (id, project_id, kind, title, objective, created_at, updated_at) VALUES (?,?,'factory','RL','RL',?,?)").run(id, project.id, at, at);
    db.prepare("INSERT INTO factory_missions (mission_id, work_type, stage, limits_json, approved_spec_version, created_at, updated_at) VALUES (?,'FEATURE',?,'{}',1,?,?)").run(id, id === M1 ? 'CANCELLED' : 'DELIVERY_READY', at, at);
    db.prepare("INSERT INTO factory_specs (id, mission_id, version, status, spec_json, sha256, author, created_at) VALUES (?,?,1,'APPROVED',?,?,'test',?)").run('sp_' + id, id, json(spec), hashCanonical(spec), at);
  }
  for (const ref of refs) write(ref, TEXT);
  const retired = retireSuperseded(M1, spec, project);
  assert.equal(restoreRetired(retired, project, { missionId: M1 }).complete, true);
  const protectedOld = { retired, restored: retired.map(r => ({ ...r, cause: 'stopped before writer' })), restoreBlocked: false };
  const saveOld = () => db.prepare('UPDATE factory_specs SET protected_json=? WHERE mission_id=?').run(json(protectedOld), M1);
  saveOld();
  const later = retireSuperseded(M2, spec, project);
  db.prepare('UPDATE factory_specs SET protected_json=? WHERE mission_id=?').run(json({ retired: later }), M2);
  if (invalid === 'no-later') { remove(J2); for (const r of later) remove(r.to); db.prepare('UPDATE factory_specs SET protected_json=? WHERE mission_id=?').run('{}', M2); }
  if (invalid === 'not-approved') db.prepare("UPDATE factory_specs SET status='DRAFT' WHERE mission_id=?").run(M2);
  if (invalid === 'copy-changed') write(later[0].to, 'other bytes');
  if (invalid === 'copy-missing') remove(later[0].to);
  if (invalid === 'no-journal') remove(J2);
  if (invalid === 'not-moved') { const j = readRetireJournal(project, M2); j.status = 'MOVING'; write(J2, json(j)); }
  if (invalid === 'no-record') db.prepare('UPDATE factory_specs SET protected_json=? WHERE mission_id=?').run('{}', M2);
  if (invalid === 'wrong-sha') db.prepare('UPDATE factory_specs SET protected_json=? WHERE mission_id=?').run(json({ retired: later.map(r => ({ ...r, sha256: 'a'.repeat(64) })) }), M2);
  if (invalid === 'other-project') {
    fs.mkdirSync(path.join(dir, 'other'));
    db.prepare("INSERT INTO projects (id, slug, name, path, source, created_at, updated_at) VALUES ('prj_other','other','Other',?,'hub-test',?,?)").run(path.join(dir, 'other'), T1, T1);
  }
  if (invalid === 'wrong-restored-cycle') { protectedOld.restored = retired.map(r => ({ ...r, cycle: 2 })); saveOld(); }
  if (invalid === 'missing-restored-item') { protectedOld.restored = retired.slice(1); saveOld(); }
  if (invalid === 'mixed-problem') write(later[1].to, 'other bytes');
  if (invalid === 'mixed-old-copy') { write(later[1].to, 'other bytes'); write(retired[1].to, TEXT); }
  if (invalid === 'original-changed') { remove(J2); write(REF, 'unexplained new bytes'); }
  if (differentOriginal) write(REF, 'legitimate newer test bytes');

  // The delivery's real file snapshot is taken before the old journal is corrupted.
  const snap = takeSnapshot(project.path, { mode: 'walk' });
  db.prepare("INSERT INTO factory_snapshots (id, mission_id, seq, kind, manifest_json, stats_json, sha256, created_at) VALUES ('snap_rl',?,1,'base',?,?,?,?)").run(M2, json(snap.files), json(snap.stats), snap.sha256, TS);
  db.prepare("UPDATE factory_missions SET base_snapshot_id='snap_rl' WHERE mission_id=?").run(M2);
  const csSha = hashCanonical({ snapshot: snap.sha256, changes: [] });
  db.prepare("INSERT INTO factory_change_sets (id, mission_id, seq, snapshot_id, changes_json, sha256, status, created_at) VALUES ('cs_rl',?,1,'snap_rl','[]',?,'CURRENT',?)").run(M2, csSha, TS);
  const manifest = { spec: { sha256: hashCanonical(spec) }, changeSet: { id: 'cs_rl', sha256: csSha, snapshot: snap.sha256 } };
  const bundle = Buffer.from('synthetic verified bundle'), bundleSha = hashCanonical(manifest);
  fs.writeFileSync(path.join(dir, 'bundle.json'), bundle);
  db.prepare("INSERT INTO factory_bundles (id, mission_id, change_set_id, change_set_sha, spec_version, manifest_json, sha256, status, file_path, created_at) VALUES ('bnd_rl',?,'cs_rl',?,1,?,?,'READY_FOR_OWNER_ACCEPTANCE','bundle.json',?)").run(M2, csSha, json(manifest), bundleSha, TS);
  db.prepare("INSERT INTO deliveries (id, project_id, title, status, mission_id, template_json, template_sha, ops_steps_json, ops_body_sha, bundle_id, bundle_sha, snapshot_sha, change_set_id, created_by, created_at, updated_at) VALUES (?,?,'RL','READY',?,'{}',?,'[]',?,'bnd_rl',?,?,'cs_rl','test',?,?)").run(D, project.id, M2, hashCanonical({}), hashCanonical([]), bundleSha, snap.sha256, TS, TS);
  const projects = { get: id => db.prepare('SELECT * FROM projects WHERE id=?').get(id) };
  const missions = { get: id => { const r = db.prepare('SELECT * FROM missions WHERE id=?').get(id); return { id, projectId: r.project_id }; } };
  const config = { testMode: true, hubRoot: dir };
  const factory = createFactory({ db, bus, clock, config, projects, missions });
  const deliveries = createDeliveries({ db, bus, clock, config, projects, missions, factory });
  deliveries.bindItem(D, { kind: 'bundle', refTable: 'factory_bundles', refId: 'bnd_rl', refSha: bundleSha, meta: { fileSha: sha256(bundle) } });
  t.after(async () => {
    deliveries.close_(); await settle(); db.close();
    assert.ok(path.resolve(dir).startsWith(root + path.sep));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const events = type => db.prepare('SELECT payload_json FROM events WHERE type=? AND scope_id=? ORDER BY seq').all(type, M1).map(r => JSON.parse(r.payload_json));
  const protection = () => db.prepare('SELECT protected_json FROM factory_specs WHERE mission_id=?').get(M1).protected_json;
  const corrupt = () => {
    const j = readRetireJournal(project, M1);
    const previous = { status: j.status, items: j.items, problems: j.problems, cycle: j.cycle, at: j.at };
    // Exact legacy writeJournal shape, including the repeated missing-original problem and history.
    const problems = retired.map(r => `Testul anterior ${r.from} nu mai este cel din planul confirmat (lipsește); nu îl mut`);
    const items = retired.map(r => ({ from: r.from, to: r.to, sha256: r.sha256, missionId: r.missionId, specVersion: r.specVersion, reason: r.reason, state: 'incomplete' }));
    const at = '2026-10-16T00:48:00.000Z';
    const damaged = { ...j, status: 'RESTORE_INCOMPLETE', items, problems, history: [...j.history, previous, { status: 'RESTORE_INCOMPLETE', items, problems, cycle: j.cycle, at }], at: '2026-10-16T06:38:00.000Z' };
    write(J1, JSON.stringify(damaged, null, 2));
    protectedOld.restoreBlocked = true; saveOld();
    const checked = deliveries.verify(D);
    assert.deepEqual(checked.changedFiles, [J1]);
    assert.equal(deliveries.get(D).status, 'STALE');
    if (invalid === 'other-project') db.prepare("UPDATE missions SET project_id='prj_other' WHERE id=?").run(M2);
    return damaged;
  };
  return { db, bus, project, factory, deliveries, read, write, protection, events, corrupt, retired, later };
}

test('RL-01 boot leaves a restored journal and READY delivery unchanged after a legitimate later retirement', async t => {
  for (const differentOriginal of [false, true]) await t.test(differentOriginal ? 'original has newer bytes' : 'original missing', async t => {
    const e = fixture(t, { differentOriginal });
    const before = e.read(J1), prot = e.protection(), changes = e.db.prepare('SELECT total_changes() n').get().n;
    const result = e.factory.recover().find(r => r.missionId === M1);
    assert.equal(result.state, 'already_restored');
    assert.equal(result.retireRestored, true);
    assert.equal(result.items[0].state, 'retired_later'); assert.equal(result.items[0].by, M2);
    assert.deepEqual(e.read(J1), before); assert.equal(e.protection(), prot);
    assert.equal(e.db.prepare('SELECT total_changes() n').get().n, changes, 'recovery does not write DB rows');
    assert.deepEqual(e.events('factory.retire_restored'), []); assert.deepEqual(e.events('factory.retire_restore_refused'), []);
    assert.equal(e.deliveries.verify(D).equal, true); assert.equal(e.deliveries.get(D).status, 'READY');
  });
});

test('RL-02 boot repairs the legacy corruption and reconciles STALE through live listener and boot replay', async t => {
  for (const scenario of ['live listener', 'boot replay', 'multiple items']) await t.test(scenario, async t => {
    const replay = scenario === 'boot replay';
    const e = fixture(t, { two: scenario === 'multiple items' }), old = e.corrupt();
    const hashes = () => e.db.prepare('SELECT sha256 FROM factory_specs ORDER BY id').all();
    const storedHashes = hashes();
    if (!replay) e.deliveries.boot();
    const report = e.factory.recover().find(r => r.missionId === M1);
    assert.equal(report.state, 'repaired_after_later_retirement');
    const repaired = readRetireJournal(e.project, M1);
    assert.equal(repaired.status, 'RESTORED'); assert.equal(repaired.cycle, old.cycle);
    assert.deepEqual(repaired.history.slice(0, old.history.length), old.history);
    assert.deepEqual(repaired.history.at(-2).problems, old.problems);
    assert.deepEqual(repaired.history.at(-1).laterRetiredBy, [M2]);
    assert.ok(repaired.history.at(-1).repairedAt);
    assert.equal(repaired.history.at(-1).cause, `retras ulterior de ${M2}; jurnalul fusese rescris greșit ca incomplet`);
    const [event] = e.events('factory.retire_restored');
    assert.equal(e.events('factory.retire_restored').length, 1);
    assert.equal(event.complete, true); assert.equal(event.state, report.state); assert.equal(event.sha256, sha256(e.read(J1)));
    assert.equal(JSON.parse(e.protection()).restoreBlocked, false);
    if (replay) { assert.equal(e.deliveries.get(D).status, 'STALE'); e.deliveries.boot(); }
    await settle();
    assert.equal(e.deliveries.get(D).status, 'READY');
    assert.deepEqual(e.deliveries.get(D).verified.reconciled.evidence.paths, [{ path: J1, provenance: 'hub_retire_journal' }]);
    assert.equal(e.deliveries.items(D)[0].status, 'CURRENT');
    const bytes = e.read(J1), prot = e.protection(), changes = e.db.prepare('SELECT total_changes() n').get().n;
    e.factory.recover(); await settle();
    assert.deepEqual(e.read(J1), bytes); assert.equal(e.protection(), prot);
    assert.equal(e.db.prepare('SELECT total_changes() n').get().n, changes);
    assert.deepEqual(hashes(), storedHashes, 'stored spec hashes stay stable');
    assert.equal(e.events('factory.retire_restored').length, 1); assert.deepEqual(e.events('factory.retire_restore_refused'), []);
  });
});

test('RL-03 genuine problems and incomplete provenance remain refused and STALE', async t => {
  for (const invalid of ['no-later', 'not-approved', 'copy-changed', 'copy-missing', 'older', 'same-time', 'no-journal', 'not-moved', 'no-record', 'wrong-sha', 'other-project', 'wrong-restored-cycle', 'missing-restored-item', 'mixed-problem', 'mixed-old-copy', 'original-changed']) {
    await t.test(invalid, async t => {
      const e = fixture(t, { invalid, two: invalid.startsWith('mixed-') || invalid === 'missing-restored-item' });
      e.corrupt(); e.deliveries.boot();
      const result = e.factory.recover().find(r => r.missionId === M1);
      assert.equal(result.retireRestored, false);
      assert.equal(readRetireJournal(e.project, M1).status, 'RESTORE_INCOMPLETE');
      assert.equal(JSON.parse(e.protection()).restoreBlocked, true);
      assert.ok(e.events('factory.retire_restore_refused').length);
      const writes = e.events('factory.retire_restored');
      assert.ok(writes.length, 'the incomplete journal rewrite records its bytes');
      assert.ok(writes.every(r => !r.complete && r.state === 'restore_incomplete' && r.sha256 === sha256(e.read(J1))), 'the write record is not a successful restore');
      await settle(); assert.equal(e.deliveries.get(D).status, 'STALE');
      assert.equal(e.deliveries.reconcileStale(D, { actor: 'test' }).ok, false);
      if (invalid === 'original-changed') assert.equal(e.read(REF).toString(), 'unexplained new bytes');
      else assert.equal(fs.existsSync(path.join(e.project.path, REF)), false, 'never resurrect the later retired test');
    });
  }
});

test('RL-04 only the repaired, consistent RESTORED journal has Hub drift provenance', t => {
  const e = fixture(t); e.corrupt();
  assert.deepEqual(e.factory.driftProvenance(e.project.id, [J1]), { software: [J1], hub: [] });
  e.factory.recover();
  assert.deepEqual(e.factory.snapshotCheck(M2).changedFiles, [J1], 'repair bytes differ from the delivery snapshot');
  assert.deepEqual(e.factory.driftProvenance(e.project.id, [J1]), { software: [], hub: [{ path: J1, provenance: 'hub_retire_journal' }] });
});

test('RL-05 RESTORED with originals present reconciles missing records for the journal cycle', async t => {
  for (const scenario of ['absent', 'empty', 'partial', 'older cycle', 'unblocked']) await t.test(scenario, t => {
    const e = fixture(t, { invalid: 'no-later', two: true });
    for (const r of e.retired) e.write(r.from, TEXT);
    const journal = readRetireJournal(e.project, M1);
    journal.cycle = 2;
    e.write(J1, json(journal));
    const prot = JSON.parse(e.protection());
    delete prot.restored;
    if (scenario === 'empty') prot.restored = [];
    if (scenario === 'partial') prot.restored = [{ ...e.retired[0], cycle: 2 }];
    if (scenario === 'older cycle') prot.restored = e.retired.map(r => ({ ...r, cycle: 1 }));
    prot.restoreBlocked = scenario !== 'unblocked';
    e.db.prepare('UPDATE factory_specs SET protected_json=? WHERE mission_id=?').run(json(prot), M1);
    const before = e.read(J1);
    const report = e.factory.recover().find(r => r.missionId === M1);
    assert.equal(report.state, 'already_restored'); assert.equal(report.retireRestored, true);
    const after = JSON.parse(e.protection());
    assert.equal(after.restoreBlocked, false);
    for (const r of e.retired) assert.equal(after.restored.filter(x => x.from === r.from && x.to === r.to && x.sha256 === r.sha256 && x.cycle === 2).length, 1);
    for (const r of prot.restored || []) assert.ok(after.restored.some(x => json(x) === json(r)), 'existing records are preserved');
    const events = e.events('factory.retire_restored');
    assert.equal(events.length, 1);
    assert.equal(events[0].complete, true); assert.equal(events[0].state, 'already_restored');
    assert.equal(events[0].sha256, sha256(before));
    assert.deepEqual(e.read(J1), before);
    assert.deepEqual(e.events('factory.retire_restore_refused'), []);
    const changes = e.db.prepare('SELECT total_changes() n').get().n, settled = e.protection();
    e.factory.recover();
    assert.equal(e.db.prepare('SELECT total_changes() n').get().n, changes);
    assert.equal(e.protection(), settled); assert.deepEqual(e.read(J1), before);
    assert.equal(e.events('factory.retire_restored').length, 1);
  });
});

test('RL-06 boot completes a repair whose journal write survived but DB transaction was lost', async t => {
  for (const mode of ['live listener', 'boot replay']) await t.test(mode, async t => {
    const e = fixture(t); e.corrupt();
    const prot = e.protection();
    // Run the actual repair in a transaction that rolls back after its filesystem write.
    assert.throws(() => e.bus.transaction(() => {
      assert.equal(e.factory.compensateRetirement(M1, 'crash simulation').state, 'repaired_after_later_retirement');
      assert.equal(e.events('factory.retire_restored').length, 1);
      throw new Error('lost DB step');
    }), /lost DB step/);
    assert.equal(readRetireJournal(e.project, M1).status, 'RESTORED');
    assert.equal(e.protection(), prot); assert.equal(JSON.parse(prot).restoreBlocked, true);
    assert.deepEqual(e.events('factory.retire_restored'), []);
    assert.equal(e.deliveries.get(D).status, 'STALE');
    const repaired = e.read(J1);
    if (mode === 'live listener') e.deliveries.boot();
    const report = e.factory.recover().find(r => r.missionId === M1);
    assert.equal(report.state, 'already_restored'); assert.equal(report.retireRestored, true);
    assert.equal(report.items[0].state, 'retired_later');
    const after = JSON.parse(e.protection());
    assert.equal(after.restoreBlocked, false);
    assert.deepEqual(after.restored, JSON.parse(prot).restored, 'flag-only reconciliation does not duplicate records');
    const events = e.events('factory.retire_restored');
    assert.equal(events.length, 1); assert.equal(events[0].complete, true);
    assert.equal(events[0].state, 'already_restored'); assert.equal(events[0].sha256, sha256(repaired));
    assert.deepEqual(e.read(J1), repaired);
    if (mode === 'boot replay') e.deliveries.boot();
    await settle();
    assert.equal(e.deliveries.get(D).status, 'STALE', 'an attestation cannot replace the rolled-back journal-write record');
    assert.equal(e.deliveries.reconcileStale(D, { actor: 'test' }).ok, false);
    const changes = e.db.prepare('SELECT total_changes() n').get().n, settled = e.protection();
    e.factory.recover(); await settle();
    assert.equal(e.db.prepare('SELECT total_changes() n').get().n, changes);
    assert.equal(e.protection(), settled); assert.deepEqual(e.read(J1), repaired);
    assert.equal(e.events('factory.retire_restored').length, 1);
    assert.deepEqual(e.events('factory.retire_restore_refused'), []);
  });
});
