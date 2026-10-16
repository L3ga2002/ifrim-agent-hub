import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { correctionEnv, factsOf, resolve, docOf, master } from './correction-helpers.mjs';
import { BOOKING_DEMO } from '../server/factory/booking-demo-def.mjs';
import { captureScriptFrom, pickCaptureCriteria } from '../server/delivery/template.mjs';
import { presentationAudit, dedupeDefects, groupDefects, buildCorrectionRecord } from '../server/delivery/correction.mjs';
import { decisionsInbox } from '../server/delivery/inbox.mjs';
import { hashCanonical } from '../server/core/canonical.mjs';
import { irHash } from '../server/media/ir.mjs';
import { correctionDryRun } from './manual/correction-dry-run.mjs';
const id = 'dlv_correct';
const settle = () => new Promise(r => setTimeout(r, 30));
async function env(t, options = {}) { const e = await correctionEnv(options); t.after(() => e.cleanup()); return e; }

async function lateFailure(e) {
  const draft = e.deliveries.correctionDraft(id);
  for (const role of ['desktop', 'mobile']) {
    const c = e.deliveries.currentItem(id, 'capture', role);
    e.db.prepare('UPDATE delivery_items SET meta_json=? WHERE id=?').run(JSON.stringify({ ...c.meta, holdsRejected: [], stepsSha: draft.correction.captures[role].stepsSha }), c.id);
  }
  const first = await e.deliveries.proposeCorrection(id);
  const args = { params: { deliveryId: id, revisionId: first.revision.id, only: 'correction' }, planId: first.plan.id, authorize() {} };
  const edit = await e.executors['delivery.edit.build'].run(args);
  const variant = e.media.variants.derive({ masterVersionId: edit.result.editVersionId, platformKey: e.template.story.variant.platformKey, overrides: first.revision.delta.correction.story.overrides, actor: 'test' });
  e.deliveries.bindItem(id, { kind: 'variant', role: 'vertical', refTable: 'media_variants', refId: variant.variant.id, meta: { editVersionId: variant.version.id } }, 'plan:' + first.plan.id);
  // Render/QA slots are synthetic here; RCO-04 exercises the real browser and ffmpeg versions.
  for (const role of ['master', 'vertical']) {
    e.deliveries.bindItem(id, { kind: 'render', role, refTable: 'media_asset_versions', refId: 'mav_desktop', meta: { durationMs: 22000 } }, 'plan:' + first.plan.id);
    e.deliveries.bindItem(id, { kind: 'qa', role, refTable: 'media_qa', refId: 'qa_' + role, meta: { status: 'PASS', kinds: { factual: 'PASS' } } }, 'plan:' + first.plan.id);
  }
  await e.executors['delivery.summary.render'].run(args);
  e.db.prepare("UPDATE ops_plan_steps SET status='DONE', attempts=1 WHERE plan_id=? AND kind='delivery.summary.render'").run(first.plan.id);
  e.db.prepare("UPDATE ops_plans SET status='FAILED' WHERE id=?").run(first.plan.id);
  e.deliveries.onEvent({ type: 'ops.plan.failed', scopeId: first.plan.id, payload: { reason: 'after summary' } });
  assert.deepEqual(e.deliveries.view(id).correction.defects, []);
  return first;
}

test('RCD-01 tick offers a zero-defect late-failure continuation, confirms it and restores READY without media work', async t => {
  const e = await env(t), first = await lateFailure(e);
  await e.deliveries.tick();
  const row = e.db.prepare('SELECT ops_plan_id FROM delivery_revisions ORDER BY rowid DESC LIMIT 1').get();
  const recovery = e.opsPlans.view(row.ops_plan_id);
  assert.notEqual(recovery.id, first.plan.id);
  assert.deepEqual(recovery.steps.map(s => s.kind), ['delivery.correct.prepare', 'delivery.finish']);
  assert.equal((await e.deliveries.proposeCorrection(id)).plan.id, recovery.id, 'pending continuation remains idempotent');
  const finish = e.executors['delivery.finish'].run;
  e.executors['delivery.finish'].run = async () => { throw Error('another late failure'); };
  assert.equal((await e.confirm(recovery)).status, 'FAILED');
  await settle();
  e.executors['delivery.finish'].run = finish;
  const retry = await e.deliveries.proposeCorrection(id);
  assert.deepEqual(retry.plan.steps.map(s => s.kind), ['delivery.correct.prepare', 'delivery.finish']);
  assert.equal((await e.confirm(retry.plan)).status, 'DONE');
  assert.equal(e.deliveries.get(id).status, 'READY');
});

for (const status of ['EXPIRED', 'SUPERSEDED', 'CANCELLED']) test(`RCF-01 ${status} unstarted continuation remains recoverable and confirms to READY`, async t => {
  let time = Date.now();
  const e = await env(t, { testClock: () => new Date(time) });
  await lateFailure(e);
  await e.deliveries.tick();
  const card = e.deliveries.view(id).correction.plan;
  assert.ok(e.deliveries.revisionOfPlan(id, card.id).delta.correction.continuation);
  assert.ok(e.opsPlans.view(card.id).steps.every(s => s.status === 'PENDING'));
  if (status === 'CANCELLED') { e.opsPlans.cancel(card.id); await settle(); }
  else e.db.prepare('UPDATE ops_plans SET status=? WHERE id=?').run(status, card.id);
  assert.equal(e.deliveries.get(id).status, 'NEEDS_OWNER');
  assert.equal(e.deliveries.view(id).correction.available, true);
  time += 600001; await e.deliveries.tick();
  let replacement = e.deliveries.view(id).correction.plan;
  if (status === 'CANCELLED') {
    assert.equal(replacement, null, 'tick never reoffers a cancelled card');
  } else {
    assert.ok(replacement); assert.notEqual(replacement.id, card.id);
    e.db.prepare("UPDATE ops_plans SET status='EXPIRED' WHERE id=?").run(replacement.id);
    time += 600001; await e.deliveries.tick();
    assert.equal(e.deliveries.view(id).correction.plan, null, 'automatic reoffer is once per version');
  }
  replacement = (await e.deliveries.proposeCorrection(id)).plan;
  assert.deepEqual(replacement.steps.map(s => s.kind), ['delivery.correct.prepare', 'delivery.finish']);
  assert.equal((await e.confirm(replacement)).status, 'DONE');
  assert.equal(e.deliveries.get(id).status, 'READY');
});

test('RCF-02 background verification detects tracked file drift despite a live correction and respects ten minutes', async t => {
  let time = Date.now(); const e = await env(t, { testClock: () => new Date(time) });
  const file = path.join(e.project.path, 'tracked.txt'); fs.writeFileSync(file, 'approved');
  const base = e.factory.snapshotCheck(); let checks = 0;
  e.factory.snapshotCheck = () => { checks++; const changed = fs.readFileSync(file, 'utf8') !== 'approved'; return { ...base, actual: changed ? 'changed' : base.actual, changedFiles: changed ? ['tracked.txt'] : [] }; };
  e.factory.driftProvenance = (project, files) => ({ software: files, hub: [] });
  await e.deliveries.proposeCorrection(id);
  await e.deliveries.tick(); const initial = checks;
  fs.writeFileSync(file, 'changed outside Hub');
  time += 599999; await e.deliveries.tick();
  assert.equal(checks, initial); assert.equal(e.deliveries.get(id).status, 'READY');
  time += 2; await e.deliveries.tick();
  assert.equal(e.deliveries.get(id).status, 'STALE');
  assert.equal(checks, initial + 1);
  assert.deepEqual(e.deliveries.get(id).verified.changedFiles, ['tracked.txt']);
  assert.equal(e.deliveries.get(id).verified.by, 'hub');
});

test('RCF-03 original-spec STALE history ignores pacing/marker differences; observations name only actual defect kinds', async t => {
  const e = await env(t), spec = BOOKING_DEMO.spec, facts = factsOf(spec), presentation = resolve(spec);
  e.factory.claimFacts = () => facts;
  e.factory.deliveryBinding = () => ({ bundleId: facts.bundle.id, bundleSha: facts.bundle.sha256, criteria: facts.manifest.spec.criteria, manifest: facts.manifest });
  const template = structuredClone(e.template);
  template.captures = Object.entries(pickCaptureCriteria(spec)).map(([role, criterion]) => {
    const cap = { role, criterion: criterion.id };
    const script = captureScriptFrom(criterion.steps, { role, noun: template.story.noun, proofSelector: '[data-state="success"]', pacing: { typeDelayMs: 81 } });
    assert.equal(script.collapsed.filter(c => c.kind === 'fill').length, 0);
    const steps = [...script.steps, { marker: { kind: 'chapter', note: 'old compiler' } }];
    return { ...cap, ...script, steps, stepsSha: hashCanonical(steps) };
  });
  e.db.prepare("UPDATE deliveries SET template_json=?, template_sha=?, status='STALE' WHERE id=?").run(JSON.stringify(template), hashCanonical(template), id);
  for (const cap of template.captures) {
    const item = e.deliveries.currentItem(id, 'capture', cap.role);
    e.db.prepare('UPDATE delivery_items SET meta_json=? WHERE id=?').run(JSON.stringify({ ...item.meta, holdsRejected: [], stepsSha: cap.stepsSha }), item.id);
  }
  const ir = master(presentation), edit = e.deliveries.currentItem(id, 'edit', 'master');
  e.db.prepare('UPDATE media_edit_versions SET ir_json=?, ir_sha256=? WHERE id=?').run(JSON.stringify(ir), irHash(ir), edit.refId);
  const variant = e.media.variants.derive({ masterVersionId: edit.refId, platformKey: template.story.variant.platformKey, overrides: BOOKING_DEMO.delivery.presentations[0].variant, actor: 'test' });
  e.deliveries.bindItem(id, { kind: 'variant', role: 'vertical', refTable: 'media_variants', refId: variant.variant.id, meta: { editVersionId: variant.version.id } });
  const summary = docOf(presentation, facts);
  e.db.prepare("UPDATE delivery_documents SET sections_json=? WHERE id='ddoc_old'").run(JSON.stringify(summary.sections));
  const immutable = e.db.prepare('SELECT template_json, template_sha FROM deliveries WHERE id=?').get(id);
  assert.deepEqual(e.deliveries.view(id).correction.defects, []);
  assert.deepEqual(e.deliveries.view(id).observations.filter(o => o.kind === 'correction'), []);
  const cap = e.deliveries.currentItem(id, 'capture', 'desktop');
  e.db.prepare('UPDATE delivery_items SET meta_json=? WHERE id=?').run(JSON.stringify({ ...cap.meta, holdsRejected: [{ code: 'HOLD_POSTCONDITION_FAILED', reason: 'typing' }] }), cap.id);
  let observation = e.deliveries.view(id).observations.find(o => o.kind === 'correction');
  assert.match(observation.text, /capturile au tastat o valoare de două ori/);
  assert.doesNotMatch(observation.text, /citări de criterii greșite/);
  ir.tracks.flatMap(t => t.items || []).find(i => i.id === 't-desktop').text = 'AC-99: greșit';
  e.db.prepare('UPDATE media_edit_versions SET ir_json=? WHERE id=?').run(JSON.stringify(ir), edit.refId);
  observation = e.deliveries.view(id).observations.find(o => o.kind === 'correction');
  assert.match(observation.text, /citări de criterii greșite/);
  assert.match(observation.text, /capturile au tastat o valoare de două ori/);
  assert.deepEqual(e.db.prepare('SELECT template_json, template_sha FROM deliveries WHERE id=?').get(id), immutable);
});

test('RCF-03b outdated steps require currently collapsed fill still typed in the frozen capture', async t => {
  const e = await env(t), input = e.deliveries.correctionFacts(id);
  const check = template => presentationAudit({ ...input, effectiveTemplate: template, spec: input.facts.spec, specSha: input.facts.specRow.sha256, catalog: BOOKING_DEMO.delivery.presentations, claimFacts: input.facts });
  const old = structuredClone(e.template);
  assert.ok(check(old).defects.some(d => d.code === 'CAPTURE_STEPS_OUTDATED'));
  for (const cap of old.captures) {
    const criterion = input.facts.spec.acceptance.find(c => c.id === cap.criterion);
    const script = captureScriptFrom(criterion.steps, { role: cap.role, noun: old.story.noun, proofSelector: cap.proofSelector, pacing: { typeDelayMs: 87 } });
    assert.ok(script.collapsed.some(c => c.kind === 'fill'));
    cap.steps = [...script.steps, { marker: { kind: 'chapter', note: 'different compiler' } }];
  }
  const audit = check(old);
  assert.ok(!audit.defects.some(d => d.code === 'CAPTURE_STEPS_OUTDATED'));
  assert.ok(audit.defects.some(d => d.code === 'CAPTURE_POSTCONDITION_FAILED'));
  // Only the value actually collapsed by this compiler is eligible, even on the same selector.
  for (const cap of old.captures) {
    const criterion = input.facts.spec.acceptance.find(c => c.id === cap.criterion);
    const type = { selector: "[name='phone']", text: '0700 999 999', delayMs: 60 };
    criterion.steps.push({ click: 'button' }, { fill: { selector: type.selector, value: type.text } });
    cap.steps.push({ type }, { type });
  }
  assert.ok(!check(old).defects.some(d => d.code === 'CAPTURE_STEPS_OUTDATED'));
  input.captures[0].actualSha = 'wrong';
  assert.ok(check(old).defects.some(d => d.code === 'CAPTURE_PROVENANCE'));
});

test('RCF-04 Hub correction preserves normal decisions and describes proposed versus active plans', async t => {
  const e = await env(t), out = await e.deliveries.proposeCorrection(id, { actor: 'hub' });
  for (const status of ['PROPOSED', 'CONFIRMED', 'RUNNING', 'PAUSED']) {
    e.db.prepare('UPDATE ops_plans SET status=? WHERE id=?').run(status, out.plan.id);
    const before = e.db.prepare('SELECT total_changes() n').get().n;
    const items = decisionsInbox({ db: e.db, deliveries: e.deliveries, factory: { list: () => [] }, projects: {} }).items;
    assert.ok(items.some(i => i.kind === 'delivery' && i.id === id));
    const card = items.find(i => i.kind === 'delivery_correction');
    if (status === 'PROPOSED') { assert.match(card.why, /Așteaptă confirmarea ta/); assert.equal(card.ifReject, 'Nimic nu pornește.'); }
    else { assert.match(card.why, /corectura rulează/i); assert.match(card.ifReject, /corectura rulează/i); assert.doesNotMatch(card.ifReject, /Nimic nu pornește/); }
    assert.equal(e.db.prepare('SELECT total_changes() n').get().n, before);
  }
});

test('RCD-02 untouched proposed/confirmed cancellation keeps READY; started cancellation requires owner; tick never reoffers', async t => {
  let time = Date.now();
  const e = await env(t, { testClock: () => new Date(time) });
  for (const status of ['PROPOSED', 'CONFIRMED']) {
    const out = await e.deliveries.proposeCorrection(id);
    e.db.prepare('UPDATE ops_plans SET status=? WHERE id=?').run(status, out.plan.id);
    assert.ok(e.opsPlans.view(out.plan.id).steps.every(s => s.status === 'PENDING'));
    e.opsPlans.cancel(out.plan.id, { reason: status === 'PROPOSED' ? 'Refuzat' : 'Anulat' });
    await settle();
    assert.equal(e.deliveries.get(id).status, 'READY');
    assert.equal(e.deliveries.getRevision(out.revision.id).status, 'CANCELLED');
    time += 600001; await e.deliveries.tick();
    assert.equal(e.db.prepare('SELECT count(*) n FROM delivery_revisions').get().n, status === 'PROPOSED' ? 1 : 2);
  }
  const out = await e.deliveries.proposeCorrection(id);
  e.db.prepare("UPDATE ops_plan_steps SET status='RUNNING', attempts=1, started_at=? WHERE plan_id=? AND seq=1").run(new Date(time).toISOString(), out.plan.id);
  e.opsPlans.cancel(out.plan.id); await settle();
  assert.equal(e.deliveries.get(id).status, 'NEEDS_OWNER');
  time += 600001; await e.deliveries.tick();
  assert.equal(e.db.prepare('SELECT count(*) n FROM delivery_revisions').get().n, 3);
  assert.ok((await e.deliveries.proposeCorrection(id)).proposed, 'owner may retry');
});

function cloneDelivery(e, target) {
  const clone = (table, where, params, transform) => {
    for (const original of e.db.prepare(`SELECT * FROM ${table} WHERE ${where}`).all(...params)) {
      const r = transform({ ...original });
      e.db.prepare(`INSERT INTO ${table} (${Object.keys(r).join(',')}) VALUES (${Object.keys(r).map(() => '?').join(',')})`).run(...Object.values(r));
    }
  };
  clone('deliveries', 'id=?', [id], r => ({ ...r, id: target }));
  clone('delivery_items', 'delivery_id=?', [id], r => ({ ...r, id: r.id + '_b', delivery_id: target }));
  clone('delivery_documents', 'delivery_id=?', [id], r => ({ ...r, id: r.id + '_b', delivery_id: target }));
}

test('RCD-03 two deliveries keep independent cards; tick reoffers expired/superseded work once per Hub version', async t => {
  let time = Date.now(); const e = await env(t, { testClock: () => new Date(time) });
  cloneDelivery(e, 'dlv_other');
  await e.deliveries.tick();
  const cards = e.db.prepare("SELECT id FROM ops_plans WHERE kind='delivery.correct'").all();
  assert.equal(cards.length, 2);
  for (const c of cards) assert.equal(e.opsPlans.view(c.id).status, 'PROPOSED');
  for (const [i, c] of cards.entries()) e.db.prepare('UPDATE ops_plans SET status=? WHERE id=?').run(i ? 'EXPIRED' : 'SUPERSEDED', c.id);
  time += 600001; await e.deliveries.tick();
  const replacements = e.db.prepare("SELECT id FROM ops_plans WHERE status='PROPOSED' AND kind='delivery.correct'").all();
  assert.equal(replacements.length, 2);
  for (const c of replacements) e.db.prepare("UPDATE ops_plans SET status='EXPIRED' WHERE id=?").run(c.id);
  time += 600001; await e.deliveries.tick();
  assert.equal(e.db.prepare('SELECT count(*) n FROM delivery_revisions').get().n, 4);
  // Same-delivery replacement still supersedes, while another delivery's card survives.
  const a = await e.deliveries.proposeCorrection(id), b = await e.deliveries.proposeCorrection('dlv_other');
  await e.opsPlans.propose({ kind: 'delivery.correct', title: 'Replacement', steps: [{ kind: 'delivery.preview.ensure', params: { deliveryId: id } }] });
  assert.equal(e.opsPlans.view(a.plan.id).status, 'SUPERSEDED');
  assert.equal(e.opsPlans.view(b.plan.id).status, 'PROPOSED');
});

test('RCD-04 live confirmed/running/paused corrections are returned unchanged even when current facts differ', async t => {
  const e = await env(t), out = await e.deliveries.proposeCorrection(id, { actor: 'hub' });
  for (const status of ['CONFIRMED', 'PAUSED']) {
    e.db.prepare('UPDATE ops_plans SET status=? WHERE id=?').run(status, out.plan.id);
    assert.equal((await e.deliveries.proposeCorrection(id)).plan.id, out.plan.id);
    assert.equal(e.opsPlans.view(out.plan.id).status, status);
  }
  e.db.prepare("UPDATE ops_plans SET status='PROPOSED' WHERE id=?").run(out.plan.id);
  let release, entered;
  const gate = new Promise(r => { release = r; }), ready = new Promise(r => { entered = r; });
  const run = e.executors['delivery.correct.prepare'].run;
  e.executors['delivery.correct.prepare'].run = async args => { entered(); await gate; return run(args); };
  await e.opsPlans.confirm({ planId: out.plan.id, nonce: out.plan.nonce, displayedHash: out.plan.hash, session: e.session });
  await ready;
  try {
    const inbox = decisionsInbox({ db: e.db, deliveries: e.deliveries, factory: { list: () => [] }, projects: {} });
    // This executor is actually held RUNNING, rather than only setting its database status.
    assert.ok(inbox.items.some(i => i.kind === 'delivery' && i.id === id));
    assert.match(inbox.items.find(i => i.kind === 'delivery_correction').why, /corectura rulează/i);
    e.deliveries.bindItem(id, { kind: 'capture', role: 'desktop', refTable: 'media_asset_versions', refId: 'foreign' });
    assert.equal((await e.deliveries.proposeCorrection(id)).plan.id, out.plan.id);
    assert.equal((await e.opsPlans.supersedeDeliveryCorrection(out.plan.id, id)).status, 'RUNNING');
    assert.equal(e.db.prepare('SELECT count(*) n FROM delivery_revisions').get().n, 1);
  } finally { release(); await e.opsPlans.idle(out.plan.id); }
});

test('RCD-05 failed proposal cancels its orphan, hides it from Room and does not consume a version', async t => {
  const e = await env(t), propose = e.opsPlans.propose;
  e.opsPlans.propose = async () => { throw Error('describe refused'); };
  await assert.rejects(e.deliveries.proposeCorrection(id, { actor: 'hub' }), /describe refused/);
  const orphan = e.db.prepare('SELECT * FROM delivery_revisions').get();
  assert.equal(orphan.status, 'CANCELLED'); assert.equal(orphan.ops_plan_id, null);
  assert.deepEqual(e.deliveries.view(id).revisions, []);
  e.opsPlans.propose = propose;
  const out = await e.deliveries.proposeCorrection(id);
  assert.equal(out.revision.delta.correction.version, 1);
  assert.equal(e.deliveries.view(id).revisions.length, 1);
});

test('RCD-06 build/export/finish refuse changed master, vertical, summary and captures; this plan bindings remain valid', async t => {
  const e = await env(t), out = await e.deliveries.proposeCorrection(id);
  const record = out.revision.delta.correction;
  const changes = [
    ["UPDATE delivery_items SET ref_id='foreign' WHERE delivery_id=? AND kind='edit' AND status='CURRENT'", [id]],
    ["UPDATE delivery_items SET ref_id='foreign' WHERE delivery_id=? AND kind='variant' AND status='CURRENT'", [id]],
    ["UPDATE delivery_documents SET content_sha='foreign' WHERE delivery_id=?", [id]],
    ["UPDATE delivery_items SET ref_id='foreign' WHERE delivery_id=? AND kind='capture' AND role='desktop' AND status='CURRENT'", [id]],
  ];
  for (const [sql, params] of changes) for (const kind of ['delivery.edit.build', 'delivery.export', 'delivery.finish']) {
    e.db.exec('SAVEPOINT base_test'); e.db.prepare(sql).run(...params);
    try { await assert.rejects(e.executors[kind].run({ params: { deliveryId: id, revisionId: out.revision.id, mode: 'correction' }, planId: out.plan.id, authorize: () => { throw Error('must refuse before writes'); } }), x => x.code === 'CORRECTION_BASE_CHANGED', kind); }
    finally { e.db.exec('ROLLBACK TO base_test'); e.db.exec('RELEASE base_test'); }
  }
  const current = e.deliveries.currentItem(id, 'edit', 'master');
  e.deliveries.bindItem(id, { ...current, refId: 'this-plan-edit', refSha: 'new-sha' }, 'plan:' + out.plan.id);
  await e.deliveries.checkCorrection(id, record, { planId: out.plan.id });
  await assert.rejects(e.deliveries.checkCorrection(id, record, { planId: 'other-plan' }), x => x.code === 'CORRECTION_BASE_CHANGED');
});

test('RCD-07 two applied corrections fold capture scripts before a third running overlay without rewriting templates', async t => {
  const e = await env(t), first = await e.deliveries.proposeCorrection(id);
  e.deliveries.updateRevision(first.revision.id, { status: 'APPLIED' });
  e.db.prepare("UPDATE ops_plans SET status='DONE' WHERE id=?").run(first.plan.id);
  const secondRecord = structuredClone(first.revision.delta.correction);
  secondRecord.captures.desktop = { action: 'reuse' }; // Legacy record without a copied script.
  secondRecord.captures.mobile.steps = [{ marker: 'later mobile' }];
  secondRecord.captures.mobile.stepsSha = hashCanonical(secondRecord.captures.mobile.steps);
  const second = e.deliveries.recordRevision(id, { text: 'second', status: 'APPLIED', delta: { correction: secondRecord } });
  const before = e.db.prepare('SELECT template_json, template_sha FROM deliveries WHERE id=?').get(id);
  const template = e.deliveries.effectiveTemplate(e.deliveries.get(id));
  assert.deepEqual(template.captures.find(c => c.role === 'desktop').steps, first.revision.delta.correction.captures.desktop.steps);
  assert.equal(template.captures.find(c => c.role === 'desktop').stepsSha, first.revision.delta.correction.captures.desktop.stepsSha);
  assert.deepEqual(template.captures.find(c => c.role === 'mobile').steps, secondRecord.captures.mobile.steps);
  const thirdRecord = structuredClone(secondRecord); thirdRecord.captures = { desktop: { action: 'reuse' }, mobile: { action: 'reuse' } };
  const third = e.deliveries.recordRevision(id, { text: 'running', status: 'PROPOSED', delta: { correction: thirdRecord } });
  e.deliveries.updateRevision(third.id, { opsPlanId: 'op_third' });
  assert.deepEqual(e.deliveries.effectiveTemplate(e.deliveries.get(id), { planId: 'op_third' }).captures, template.captures);
  assert.deepEqual(e.db.prepare('SELECT template_json, template_sha FROM deliveries WHERE id=?').get(id), before);
});

test('RCD-08 audit de-duplicates bullet/plain findings and orders clips/captures before summary; Room count agrees', async t => {
  const e = await env(t), draft = e.deliveries.correctionDraft(id);
  const sample = { code: 'SUMMARY_LINE_NOT_CURATED', where: 'summary.how', text: 'same' };
  assert.equal(dedupeDefects([sample, { ...sample, text: '- same' }]).length, 1);
  assert.equal(dedupeDefects([sample, { ...sample, code: 'different' }, { ...sample, where: 'other' }, { ...sample, itemId: 'other' }]).length, 4);
  assert.equal(draft.audit.defects.length, dedupeDefects(draft.audit.defects).length);
  const firstSummary = draft.audit.defects.findIndex(d => d.where.startsWith('summary.'));
  assert.ok(firstSummary > 0);
  assert.ok(draft.audit.defects.slice(firstSummary).every(d => d.where.startsWith('summary.')));
  assert.deepEqual(e.deliveries.view(id).correction.defects, groupDefects(draft.audit.defects));
  assert.deepEqual(draft.correction.defects, draft.audit.defects);
});

test('RCD-09 proposal scan is throttled per delivery and leaves delivery verification/timestamps untouched', async t => {
  // Keep the independent legacy verifier outside its >600000 ms window.
  let time = 0; const e = await env(t, { testClock: () => new Date(time) });
  let scans = 0; const check = e.factory.snapshotCheck;
  e.factory.snapshotCheck = (...args) => { scans++; return check(...args); };
  e.opsPlans.propose = async () => { throw Error('no card'); };
  const row = () => e.db.prepare('SELECT updated_at, verified_json FROM deliveries WHERE id=?').get(id), before = row();
  await e.deliveries.tick(); assert.equal(scans, 1);
  for (let n = 0; n < 5; n++) await e.deliveries.tick();
  assert.equal(scans, 1); time += 599999; await e.deliveries.tick(); assert.equal(scans, 1);
  time += 1; await e.deliveries.tick(); assert.equal(scans, 2);
  assert.deepEqual(row(), before);
  cloneDelivery(e, 'dlv_scan_other'); await e.deliveries.tick(); assert.equal(scans, 3);
  assert.deepEqual(row(), before);
});

test('RCD-10 replacement claims retain same-role lineage and explicitly retire only absent roles', async t => {
  const e = await env(t);
  const bind = (role, refId) => e.deliveries.bindItem(id, { kind: 'claim', role, refTable: 'content_claims', refId });
  const kept = bind('clip.hook', 'old-hook'), removed = bind('clip.desktop', 'old-desktop');
  let next;
  e.deliveries.replaceClaimItems(id, ['clip.hook'], () => { next = bind('clip.hook', 'new-hook'); });
  assert.equal(next.supersedesId, kept.id);
  const retired = e.deliveries.items(id).find(i => i.id === removed.id);
  assert.equal(retired.status, 'SUPERSEDED'); assert.match(retired.statusReason, /nu mai este inclusă/);
});

test('RCD-13 card shows one actual-tone change per slot; summary preview uses current proofs and only changed sections', async t => {
  const e = await env(t), draft = e.deliveries.correctionDraft(id);
  for (const tone of ['both', 'business', 'technical']) {
    const record = buildCorrectionRecord({ ...draft, version: 1, tone });
    for (const format of ['16:9', '9:16']) for (const slot of ['hook', 'desktop', 'mobile', 'cta']) {
      const lines = record.outputs.filter(s => s.startsWith(`${slot} (${format}):`));
      assert.ok(lines.length <= 1);
      const texts = record.story.texts[slot], selected = tone === 'both' ? (['hook', 'cta'].includes(slot) ? 'business' : 'technical') : tone;
      const override = format === '9:16' && record.story.overrides[slot === 'hook' ? 'hookText' : slot === 'cta' ? 'ctaText' : ''];
      if (lines.length) {
        assert.ok(lines[0].includes(`→ «${override || texts[selected]}»`));
        assert.equal(lines[0].includes('(tonul celălalt:'), !override && texts.business !== texts.technical);
      }
    }
    if (tone === 'both') assert.ok(!record.outputs.some(s => s.startsWith('cta (16:9):')));
  }
  const before = e.db.prepare('SELECT total_changes() n').get().n;
  const dry = await correctionDryRun({ dataRoot: e.config.dataDir, deliveryId: id });
  assert.equal(e.db.prepare('SELECT total_changes() n').get().n, before);
  assert.deepEqual(dry.summaryPreview.filter(s => s.id !== 'provenance'), draft.summaryPreview.sections.filter(s => s.id !== 'provenance'));
  assert.equal(dry.summaryPreview.find(s => s.id === 'video').text, '(după randare)');
  for (const section of draft.summaryPreview.sections) {
    const changed = section.text !== draft.summary.sections.find(s => s.id === section.id)?.text;
    assert.equal(dry.outputs.some(s => s.startsWith(`Rezumat, ${section.heading}:`)), changed);
  }
  for (const key of ['problem', 'demonstrated', 'how', 'benefits', 'cannot_claim', 'questions']) assert.ok(dry.summaryPreview.find(s => s.id === key)?.text);
  assert.deepEqual(dry.defects, dedupeDefects(dry.defects));
  e.db.prepare("UPDATE factory_evidence SET stale=1 WHERE id='ev_AC-1'").run();
  const unproven = await correctionDryRun({ dataRoot: e.config.dataDir, deliveryId: id });
  assert.notEqual(unproven.summaryPreview.find(s => s.id === 'problem').text, dry.summaryPreview.find(s => s.id === 'problem').text);
  assert.match(unproven.summaryPreview.find(s => s.id === 'cannot_claim').text, /Nu afirmăm:/);
  assert.ok(unproven.outputs.some(s => s.startsWith('hook (16:9):') && s.endsWith('→ «omis»')));
});

test('RCE-04 Room and correction card count distinct texts once and retain both reasons without changing audit records', async t => {
  const sample = { code: 'SUMMARY_CITATION_UNBOUND', where: 'summary.how', text: 'same AC-99' };
  const input = [sample, { ...sample, text: '- same AC-99', code: 'SUMMARY_LINE_NOT_CURATED' }, sample,
    { ...sample, where: 'summary.benefits' }, { ...sample, itemId: 'other' }, { ...sample, text: 'other' }];
  const before = hashCanonical(input), grouped = groupDefects(input);
  assert.equal(grouped.length, 4);
  assert.deepEqual(grouped[0].reasons.map(r => r.code), ['SUMMARY_CITATION_UNBOUND', 'SUMMARY_LINE_NOT_CURATED']);
  assert.equal(grouped[0].plain.split('same AC-99').length - 1, 1);
  for (const reason of grouped[0].reasons) assert.ok(grouped[0].plain.includes(reason.plain));
  assert.equal(hashCanonical(input), before);
  const e = await env(t), draft = e.deliveries.correctionDraft(id), auditSha = hashCanonical(draft.audit.defects);
  await e.deliveries.proposeCorrection(id, { actor: 'hub' });
  const room = e.deliveries.view(id).correction;
  assert.equal(room.defectCount, new Set(draft.audit.defects.map(d => JSON.stringify([d.where, d.itemId || null, d.text.replace(/^- /, '')]))).size);
  assert.equal(room.defects.length, room.defectCount);
  assert.ok(room.defectCount < draft.audit.defects.length);
  assert.ok(room.defects.some(d => d.reasons.some(r => r.code === 'SUMMARY_CITATION_UNBOUND') && d.reasons.some(r => r.code === 'SUMMARY_LINE_NOT_CURATED')));
  const card = decisionsInbox({ db: e.db, deliveries: e.deliveries, factory: { list: () => [] }, projects: {} }).items.find(i => i.kind === 'delivery_correction');
  assert.deepEqual(card.effects, room.defects.map(d => d.plain));
  assert.equal(hashCanonical(draft.audit.defects), auditSha);
});

test('RCE-05 dry-run provenance shows runtime placeholder while persisted v1 and comparison stay unchanged', async t => {
  const e = await env(t), before = e.db.prepare('SELECT * FROM delivery_documents').all();
  const draft = e.deliveries.correctionDraft(id), dry = await correctionDryRun({ dataRoot: e.config.dataDir, deliveryId: id });
  const provenance = dry.summaryPreview.find(s => s.id === 'provenance').text;
  assert.equal(provenance.split('\n').filter(l => l.startsWith('- Generat ')).join('\n'), '- Generat (la rulare)');
  assert.notEqual(provenance, draft.summaryPreview.sections.find(s => s.id === 'provenance').text);
  assert.deepEqual(e.db.prepare('SELECT * FROM delivery_documents').all(), before);
  assert.equal(dry.correctionSha, draft.correctionSha);
  assert.deepEqual(dry.outputs, draft.correction.outputs);
});
