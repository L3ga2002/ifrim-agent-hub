import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { correctionEnv, spec, catalog, baseline, resolve } from './correction-helpers.mjs';
import { correctionSteps, presentationAudit, overlayCorrection } from '../server/delivery/correction.mjs';
import { hashCanonical, sha256 } from '../server/core/canonical.mjs';
import { captureScriptFrom, revisionSteps } from '../server/delivery/template.mjs';
import { storyFromPresentation, provePresentation } from '../server/delivery/presentation.mjs';
import { renderSummary, summaryFactCheck } from '../server/delivery/summary.mjs';
import { registerDeliveryCommands } from '../server/delivery/delivery-commands.mjs';
import { PLAN_KIND_LABELS, REVISION_CLASS_LABELS, revisionRows } from '../web/src/lib/deliveryLogic.js';
import { realLaunchers, HUB_ROOT } from './media-helpers.mjs';
import { browserStatus } from '../server/tools/browser.mjs';
import { classify } from '../server/delivery/revision.mjs';
import { verifyPackageFolder } from '../server/delivery/office-executors.mjs';
const envFor = async t => { const e = await correctionEnv(); t.after(() => e.cleanup()); return e; };

test('RCO-08 dry-run opens only a stopped synthetic copy, writes no rows or exports, rejects live roots and pid/port records', async t => {
  const { correctionDryRun, safeCopyRoot } = await import('./manual/correction-dry-run.mjs');
  assert.throws(() => safeCopyRoot('C:\\Users\\mihai\\IfrimHub\\hub-data'), /LIVE_DATA_REFUSED/);
  assert.throws(() => safeCopyRoot('C:\\Users\\mihai\\IfrimHub\\hub-data\\child'), /LIVE_DATA_REFUSED/);
  const e = await envFor(t);
  await assert.rejects(correctionDryRun({ dataRoot: e.config.dataDir, deliveryId: 'dlv_correct', out: 'C:/Users/mihai/correction-output-refused.json' }), /OUTPUT_OUTSIDE_WORKSPACE/);
  const count = e.db.prepare('SELECT total_changes() n').get().n;
  const files = fs.readdirSync(e.folder).map(n => [n, sha256(fs.readFileSync(path.join(e.folder,n)))]);
  const out = path.join(e.dir, 'dry.json'), draft = e.deliveries.correctionDraft('dlv_correct');
  const dry = await correctionDryRun({ dataRoot: e.config.dataDir, deliveryId: 'dlv_correct', out });
  assert.equal(dry.correctionSha, draft.correctionSha); assert.ok(dry.steps.length <= 16); assert.equal(dry.planBodySha.length, 64);
  assert.equal(e.db.prepare('SELECT total_changes() n').get().n, count);
  assert.equal(e.db.prepare('SELECT count(*) n FROM delivery_revisions').get().n, 0);
  assert.deepEqual(fs.readdirSync(e.folder).map(n => [n, sha256(fs.readFileSync(path.join(e.folder,n)))]), files);
  const pid = path.join(e.config.dataDir, 'v2-hub.pid.json'); fs.writeFileSync(pid, JSON.stringify({ pid: process.pid }));
  assert.throws(() => safeCopyRoot(e.config.dataDir), /LIVE_PROCESS_REFUSED/);
  fs.writeFileSync(pid, JSON.stringify({ port: 8011 })); assert.throws(() => safeCopyRoot(e.config.dataDir), /RECORDED_PORT_REFUSED_OFFLINE/);
});

test('RCO-01 deterministic frozen record and plan; describe reads only the immutable revision', async t => {
  const e = await envFor(t), draft = e.deliveries.correctionDraft('dlv_correct');
  const r = e.deliveries.recordRevision('dlv_correct', { text: 'test', classes: ['correction'], delta: { correction: draft.correction, correctionSha: draft.correctionSha }, status: 'PROPOSED' });
  const steps = correctionSteps(e.template, 'dlv_correct', r.id, draft.correction);
  assert.ok(steps.length <= 16); assert.deepEqual(steps, correctionSteps(e.template, 'dlv_correct', r.id, draft.correction));
  const body = await e.opsPlans.buildBody({ kind: 'delivery.correct', title: 'Corectură', steps });
  assert.deepEqual(body.outputs.slice(0, draft.correction.outputs.length), draft.correction.outputs);
  assert.ok(body.steps.find(s => s.kind === 'delivery.edit.build').params.revisionId);
  assert.ok(body.steps.find(s => s.kind === 'delivery.finish').params.revisionId);
  const original = e.deliveries.get;
  e.deliveries.get = () => { throw Error('poisoned live state'); };
  assert.deepEqual(e.executors['delivery.correct.prepare'].describe(steps[0].params).outputs, draft.correction.outputs);
  e.deliveries.get = original;
  for (const mutate of [c => c.story.overrides.hookText += '!', c => c.captures.mobile.action = 'reuse', c => c.outputs.push('alt rezultat')]) {
    const c = structuredClone(draft.correction); mutate(c);
    assert.notEqual(hashCanonical(correctionSteps(e.template, 'dlv_correct', r.id, c)), hashCanonical(steps));
  }
  const before = e.deliveries.getRevision(r.id).delta;
  e.deliveries.updateRevision(r.id, { delta: {}, status: 'PROPOSED' }); assert.deepEqual(e.deliveries.getRevision(r.id).delta, before);
});

test('RCO-02 proposal status, idempotence, owner authority, independent revision card and tick cancellation', async t => {
  const e = await envFor(t), d = e.deliveries;
  for (const status of ['STALE', 'CLOSED', 'ACTIVE', 'PLANNED']) {
    e.db.prepare("UPDATE deliveries SET status = ? WHERE id = 'dlv_correct'").run(status);
    await assert.rejects(d.proposeCorrection('dlv_correct'), x => x.code === 'CORRECTION_STATUS');
  }
  e.db.prepare("UPDATE deliveries SET status = 'READY' WHERE id = 'dlv_correct'").run();
  const own = await e.opsPlans.propose({ kind: 'delivery.revise', title: 'Owner', steps: [{ kind: 'delivery.preview.ensure', params: { deliveryId: 'dlv_correct' } }] });
  const a = await d.proposeCorrection('dlv_correct', { actor: 'hub', via: 'correction' });
  assert.equal(a.revision.source, 'hub'); assert.equal(a.plan.consent, null); assert.equal(a.plan.authority, null);
  assert.equal(e.opsPlans.view(own.id).status, 'PROPOSED');
  assert.equal((await d.proposeCorrection('dlv_correct')).plan.id, a.plan.id);
  assert.equal(e.db.prepare("SELECT count(*) n FROM events WHERE type = 'ops.plan.consent'").get().n, 0);
  await assert.rejects(e.opsPlans.confirm({ planId: a.plan.id, nonce: a.plan.nonce, displayedHash: a.plan.hash, session: null }), /session/);
  const commands = new Map(); registerDeliveryCommands((k,v) => commands.set(k,v), e);
  assert.deepEqual(commands.get('delivery.correction.propose').channels, ['owner', 'test']);
  for (const channel of ['agent', 'cli', 'ui', 'schedule']) assert.throws(() => commands.get('delivery.correction.propose').execute({ deliveryId: 'dlv_correct' }, { channel, ownerSession: e.session }), /session/);
  await d.tick(); assert.equal(e.db.prepare("SELECT count(*) n FROM delivery_revisions WHERE source='hub'").get().n, 1);
  e.opsPlans.cancel(a.plan.id, { actor: 'owner' });
  await new Promise(r => setTimeout(r, 20));
  e.db.prepare("UPDATE deliveries SET status = 'READY' WHERE id = 'dlv_correct'").run();
  await d.tick(); assert.equal(e.db.prepare("SELECT count(*) n FROM delivery_revisions WHERE source='hub'").get().n, 1);
  assert.equal(e.db.prepare('SELECT count(*) n FROM agent_runs').get().n, 0);
  assert.equal(e.db.prepare('SELECT count(*) n FROM factory_dispatches').get().n, 0);
});

test('RCO-03 exact legacy booking prose on the privacy spec; corrected facts audit cleanly', async t => {
  const e = await envFor(t), draft = e.deliveries.correctionDraft('dlv_correct'), defects = draft.audit.defects;
  for (const where of ['master', 'vertical']) for (const itemId of ['t-desktop', 't-mobile']) assert.ok(defects.some(f => f.where === where && f.itemId === itemId && f.code === 'TEXT_NOT_CURATED'));
  for (const where of ['master', 'vertical']) assert.ok(defects.some(f => f.where === where && f.itemId === 't-mobile' && f.code === 'TEXT_CITES_WRONG_CRITERION'));
  assert.ok(defects.some(f => f.code === 'NARRATIVE_FROM_OTHER_SPEC'));
  for (const section of ['demonstrated', 'how', 'benefits']) assert.ok(defects.some(f => f.where === 'summary.' + section && f.code === 'SUMMARY_LINE_NOT_CURATED'));
  for (const role of ['desktop', 'mobile']) for (const code of ['CAPTURE_STEPS_OUTDATED', 'CAPTURE_POSTCONDITION_FAILED']) assert.ok(defects.some(f => f.where === 'capture.' + role && f.code === code));
  const p = draft.audit.presentation, story = storyFromPresentation(p);
  const edit = (vertical = false) => ({ ir: { fps: { num: 30, den: 1 }, tracks: [{ kind: 'text', items: Object.entries(story.texts).map(([slot, text]) => ({ id: 't-' + slot, text: vertical && story.overrides[slot === 'hook' ? 'hookText' : slot === 'cta' ? 'ctaText' : ''] || text.technical, start: 0, end: 10 })) }] } });
  const cleanCaptures = draft.captures.map(c => ({ ...c, meta: { ...c.meta, stepsSha: draft.correction.captures[c.role].stepsSha, holdsRejected: [] } }));
  const summary = renderSummary({ presentation: p, proofs: provePresentation(p, draft.facts), manifest: draft.facts.manifest, issue: draft.template.issueTitle, generatedAt: 'test' });
  assert.deepEqual(presentationAudit({ ...draft, delivery: draft.delivery, effectiveTemplate: draft.template, spec, specSha: hashCanonical(spec), catalog, master: edit(), vertical: edit(true), summary, captures: cleanCaptures, claimFacts: draft.facts }).defects, []);
  cleanCaptures[0].actualSha = 'changed';
  assert.ok(presentationAudit({ ...draft, spec, specSha: hashCanonical(spec), catalog, master: edit(), vertical: edit(true), summary, captures: cleanCaptures, claimFacts: draft.facts }).defects.some(f => f.code === 'CAPTURE_PROVENANCE'));
});

test('RCO-05 middle-step stop records NEEDS_OWNER and a new base can be proposed', async t => {
  const e = await envFor(t), out = await e.deliveries.proposeCorrection('dlv_correct');
  e.executors['delivery.preview.ensure'].run = async () => { throw Error('injected middle failure'); };
  const done = await e.confirm(out.plan); assert.equal(done.status, 'FAILED');
  await new Promise(r => setTimeout(r, 25));
  assert.equal(e.deliveries.get('dlv_correct').status, 'NEEDS_OWNER');
  assert.ok(e.db.prepare("SELECT 1 FROM events WHERE type='delivery.correction_failed'").get());
  const again = await e.deliveries.proposeCorrection('dlv_correct'); assert.notEqual(again.plan.id, out.plan.id);
  assert.notEqual(again.revision.id, out.revision.id);
});

test('RCO-06 effective correction feeds subsequent tone and revision plans without changing stored hashes', async t => {
  const e = await envFor(t), out = await e.deliveries.proposeCorrection('dlv_correct'), before = e.db.prepare("SELECT template_json, template_sha, ops_body_sha FROM deliveries WHERE id='dlv_correct'").get();
  e.deliveries.updateRevision(out.revision.id, { status: 'APPLIED' });
  const d = e.deliveries.get('dlv_correct'), template = e.deliveries.effectiveTemplate(d);
  assert.equal(template.presentation.key, 'phone-privacy');
  assert.deepEqual(template.story.texts, out.revision.delta.correction.story.texts);
  assert.deepEqual(revisionSteps(template, d.id, 'drv_later').find(s => s.kind === 'media.variant.render').params.overrides, out.revision.delta.correction.story.overrides);
  const old = e.deliveries.currentItem(d.id, 'edit', 'master'), ir = e.media.edits.getVersion(old.refId).ir;
  const tone = classify('Clipul este prea tehnic', { master: { versionId: old.refId, ir }, texts: template.story.texts, tone: 'both' });
  assert.equal(tone.status, 'PROPOSE');
  for (const op of tone.media.ops) assert.equal(op.text, template.story.texts[op.itemId.slice(2)].business);
  const review = e.media.reviews.proposeOps({ editVersionId: old.refId, ops: tone.media.ops, text: 'Clipul este prea tehnic', provenance: 'lega', actor: 'test' });
  const revision = e.deliveries.recordRevision(d.id, { text: 'Ton comercial', classes: ['tone'], reviewId: review.id, delta: { prefs: { tone: 'business' } }, status: 'PROPOSED' });
  e.deliveries.updateRevision(revision.id, { opsPlanId: 'op_tone' });
  await e.executors['delivery.revise.apply'].run({ params: { deliveryId: d.id, revisionId: revision.id }, planId: 'op_tone', authorize: () => {} });
  const edited = e.deliveries.currentItem(d.id, 'edit', 'master');
  for (const op of tone.media.ops) assert.equal(edited.meta.textItems.find(i => i.id === op.itemId).text, op.text);
  assert.deepEqual(e.db.prepare("SELECT template_json, template_sha, ops_body_sha FROM deliveries WHERE id='dlv_correct'").get(), before);
});

test('RCO-07 read-only view, vertical texts, approvals and Hub attribution', async t => {
  const e = await envFor(t), out = await e.deliveries.proposeCorrection('dlv_correct', { actor: 'hub' });
  const before = e.db.prepare('SELECT total_changes() n').get().n, v = e.deliveries.view('dlv_correct');
  assert.equal(e.db.prepare('SELECT total_changes() n').get().n, before);
  assert.equal(v.correction.available, true); assert.equal(v.correction.plan.id, out.plan.id); assert.equal(v.correction.defects.length, v.correction.defectCount);
  assert.ok(v.clip.vertical.textItems.length); assert.ok(v.summary.versions[0].approval);
  assert.equal(revisionRows(v)[0].sourceLabel, 'propusă de Hub');
  assert.equal(PLAN_KIND_LABELS['delivery.correct'], 'Corectură afirmații (clip + rezumat)'); assert.equal(REVISION_CLASS_LABELS.correction, 'corectură');
  assert.throws(() => e.deliveries.approveDocument('dlv_correct', { displayedSha: v.summary.sha, session: e.session }), x => x.code === 'SUMMARY_FACT_CHECK');
  e.db.prepare("UPDATE deliveries SET status='STALE' WHERE id='dlv_correct'").run();
  assert.ok(e.deliveries.view('dlv_correct').observations.some(o => /citări de criterii greșite/.test(o.text || o)));
});

const real = realLaunchers(), browser = browserStatus({ hubRoot: HUB_ROOT });
const skipReal = !real.available ? 'SKIPPED_ENV: ffmpeg/ffprobe absent' : !(browser.installed && browser.cachedBrowsers.length) ? 'SKIPPED_ENV: Playwright/Chromium absent' : false;
test('RCO-04 real Chromium captures and ffmpeg correction: recapture then byte-identical reuse, Office history and no agents', { skip: skipReal, timeout: 1200000 }, async t => {
  const { createServer } = await import('node:http');
  const typed = [];
  const html = `<!doctype html><html lang="ro"><meta charset="utf-8"><style>body{font:20px sans-serif;margin:15px}label,input,button{display:block;margin:8px 0}input{max-width:90%}[data-demo-banner]{background:#eea;padding:8px}.slot{padding:10px}</style><div data-demo-banner>DEMO — date sintetice</div><h1>Programări demo</h1><label data-service="spalare-exterior">Spălare exterior</label><button data-day="1">Mâine</button><div class="slot" data-booked="true" aria-disabled="true">10:00 ocupat</div><button class="slot" data-booked="false" aria-disabled="false">11:00 liber</button><form><label>Nume<input name="name"></label><label>Mașina<input name="vehicle"></label><label>Telefon<input name="phone" required></label><button type="submit">Confirmă</button></form><div id="result"></div><script>document.querySelector('form').onsubmit=async e=>{e.preventDefault();await fetch('/typed',{method:'POST',body:document.querySelector('[name=phone]').value});document.querySelector('#result').innerHTML='<p data-state="success">Programare confirmată</p>'}</script></html>`;
  const server = createServer((req, res) => { if (req.url === '/typed') { let body = ''; req.on('data', c => body += c); req.on('end', () => { typed.push(body); res.end('ok'); }); } else if (req.url === '/api/health') { res.writeHead(404); res.end('not hub'); } else { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html); } });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => new Promise(r => server.close(r)));
  const e = await correctionEnv({ launchers: real, previewUrl: `http://127.0.0.1:${server.address().port}/`, extras: ['document', 'workbook', 'campaign'] }); t.after(() => e.cleanup());
  // Seed v1 Office through the same executors, on a separately confirmed test-only package plan.
  const office = await e.opsPlans.propose({ kind: 'delivery.package', title: 'Test initial office', steps: ['delivery.office.document', 'delivery.office.workbook', 'delivery.campaign', 'delivery.package.index'].map(kind => ({ kind, params: { deliveryId: 'dlv_correct' } })) });
  e.deliveries.patch('dlv_correct', { ops_plan_id: office.id });
  const officeDone = await e.confirm(office); assert.equal(officeDone.status, 'DONE', JSON.stringify(officeDone.steps.map(s => [s.kind, s.error])));
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(x => x.isDirectory() ? walk(path.join(dir, x.name)) : [path.join(dir, x.name)]);
  const oldFiles = Object.fromEntries(walk(e.folder).map(p => [p, sha256(fs.readFileSync(p))]));
  const immutable = e.db.prepare("SELECT template_json, template_sha, spec_sha, bundle_sha, snapshot_sha FROM deliveries WHERE id='dlv_correct'").get();
  const bundle = e.db.prepare('SELECT * FROM factory_bundles').all();
  const oldMaster = e.deliveries.currentItem('dlv_correct', 'edit', 'master').refId;
  // Preserve an owner-written section in the seeded v1, including its historical approval.
  const oldDoc = e.deliveries.currentDoc('dlv_correct');
  const sections = structuredClone(oldDoc.sections); Object.assign(sections.find(s => s.id === 'next_step'), { text: 'Discutăm împreună pașii următori.', source: 'owner' });
  e.db.prepare("UPDATE delivery_documents SET sections_json=? WHERE id='ddoc_old'").run(JSON.stringify(sections));
  const oldRow = e.db.prepare("SELECT sections_json, content_sha, approval_json FROM delivery_documents WHERE id='ddoc_old'").get();
  const first = await e.deliveries.proposeCorrection('dlv_correct');
  const done = await e.confirm(first.plan); assert.equal(done.status, 'DONE', JSON.stringify(done.steps.map(s => [s.seq, s.kind, s.status, s.error])));
  assert.deepEqual(typed, ['0700 123 456', '0700 123 456']);
  const current = e.deliveries.items('dlv_correct').filter(i => i.status === 'CURRENT'), captured = current.filter(i => i.kind === 'capture');
  for (const c of captured) {
    assert.ok(!c.meta.holdsRejected.some(h => h.reason === 'typing' && h.code === 'HOLD_POSTCONDITION_FAILED'), JSON.stringify(c.meta.holdsRejected));
    assert.equal(first.revision.delta.correction.captures[c.role].steps.filter(s => s.type?.selector === "[name='phone']").length, 1);
  }
  assert.equal(e.media.edits.getVersion(current.find(i => i.kind === 'edit').refId).parentVersionId, oldMaster);
  for (const [file, sha] of Object.entries(oldFiles)) assert.equal(sha256(fs.readFileSync(file)), sha, file);
  const v = e.deliveries.view('dlv_correct'); assert.equal(v.delivery.status, 'READY'); assert.equal(v.summary.version, 2); assert.equal(v.correction.available, false, JSON.stringify(v.correction.defects));
  assert.equal(v.summary.basis.factual.status, 'PASS'); assert.equal(v.clip.master.qa.kinds.factual, 'PASS'); assert.equal(v.clip.vertical.qa.kinds.factual, 'PASS');
  assert.equal(v.summary.sections.find(s => s.id === 'next_step').needsReview, true); assert.match(v.summary.sections.find(s => s.id === 'next_step').reviewReason, /corectura v1/);
  assert.deepEqual(e.db.prepare("SELECT sections_json, content_sha, approval_json FROM delivery_documents WHERE id='ddoc_old'").get(), oldRow);
  assert.equal(v.summary.approval, null); assert.equal(e.deliveries.getRevision(first.revision.id).status, 'APPLIED');
  assert.equal(e.db.prepare('SELECT count(*) n FROM agent_runs').get().n, 0); assert.equal(e.db.prepare('SELECT count(*) n FROM factory_dispatches').get().n, 0);
  assert.deepEqual(e.db.prepare('SELECT * FROM factory_bundles').all(), bundle); assert.deepEqual(e.db.prepare("SELECT template_json, template_sha, spec_sha, bundle_sha, snapshot_sha FROM deliveries WHERE id='dlv_correct'").get(), immutable);
  const manifest = JSON.parse(fs.readFileSync(path.join(e.folder, 'manifest-v2.json'))); assert.equal(manifest.verification.workbook, 'FILE_CHECKED');
  assert.equal(manifest.files.find(f => f.path === 'demo-16x9-v1.mp4').status, 'SUPERSEDED'); assert.ok(verifyPackageFolder(e.folder).ok);
  // A second defect in a current text uses the valid captured bytes, with no new capture session.
  const ir = structuredClone(e.media.edits.getVersion(v.clip.master.editVersionId).ir); ir.tracks.filter(t => t.kind === 'text').flatMap(t => t.items).find(i => i.id === 't-desktop').text = baseline.delivery.texts.desktop.technical;
  const bad = e.media.edits.addVersion({ editProjectId: e.deliveries.get('dlv_correct').editProjectId, parentVersionId: v.clip.master.editVersionId, ir, changeKind: 'patch', change: { test: true }, actor: 'test' });
  e.deliveries.bindItem('dlv_correct', { kind: 'edit', role: 'master', refTable: 'media_edit_versions', refId: bad.version.id, refSha: bad.version.irSha256 });
  const captureCount = e.db.prepare('SELECT count(*) n FROM media_capture_sessions').get().n, capturesBefore = captured.map(c => [c.refId, c.refSha]);
  const second = await e.deliveries.proposeCorrection('dlv_correct'); assert.ok(Object.values(second.revision.delta.correction.captures).every(c => c.action === 'reuse'));
  e.db.prepare("UPDATE deliveries SET status='NEEDS_OWNER' WHERE id='dlv_correct'").run();
  const campaignRun = e.executors['delivery.campaign'].run;
  e.executors['delivery.campaign'].run = async () => { throw Error('round D: fail after summary and document'); };
  const stopped = await e.confirm(second.plan); assert.equal(stopped.status, 'FAILED');
  await new Promise(r => setTimeout(r, 25));
  assert.equal(e.deliveries.get('dlv_correct').status, 'NEEDS_OWNER');
  const recoveryView = e.deliveries.view('dlv_correct');
  assert.deepEqual(recoveryView.correction.defects, []);
  assert.equal(recoveryView.correction.available, true);
  assert.match(recoveryView.correction.reason, /Corectura anterioară nu s-a încheiat/);
  e.executors['delivery.campaign'].run = campaignRun;
  const recovery = await e.deliveries.proposeCorrection('dlv_correct');
  assert.deepEqual(recovery.plan.steps.map(s => s.kind), ['delivery.correct.prepare', 'delivery.office.document', 'delivery.campaign', 'delivery.package.index', 'delivery.finish']);
  assert.equal(recovery.revision.delta.correction.base.master.editVersionId, e.deliveries.currentItem('dlv_correct', 'edit', 'master').refId);
  const again = await e.confirm(recovery.plan); assert.equal(again.status, 'DONE', JSON.stringify(again.steps.map(s => [s.kind, s.error])));
  assert.equal(again.steps.find(s => s.kind === 'delivery.office.document').result.keptByProof.planId, second.plan.id);
  for (const cap of e.deliveries.effectiveTemplate(e.deliveries.get('dlv_correct')).captures) {
    assert.equal(cap.stepsSha, first.revision.delta.correction.captures[cap.role].stepsSha);
    assert.deepEqual(cap.steps, first.revision.delta.correction.captures[cap.role].steps);
  }
  assert.equal(e.deliveries.get('dlv_correct').status, 'READY');
  assert.equal(e.db.prepare('SELECT count(*) n FROM media_capture_sessions').get().n, captureCount);
  assert.deepEqual(e.deliveries.items('dlv_correct').filter(i => i.status === 'CURRENT' && i.kind === 'capture').map(c => [c.refId, c.refSha]), capturesBefore);
  assert.ok(verifyPackageFolder(e.folder).ok);
});

test('RCO-09 base changes refuse before any artifact; concurrent proposals share one record; expired tick offers once per Hub version', async t => {
  const e = await envFor(t);
  const [a,b] = await Promise.all([e.deliveries.proposeCorrection('dlv_correct', { actor: 'hub' }), e.deliveries.proposeCorrection('dlv_correct', { actor: 'hub' })]);
  assert.equal(a.plan.id, b.plan.id); assert.equal(e.db.prepare('SELECT count(*) n FROM delivery_revisions').get().n, 1);
  const cap = e.deliveries.currentItem('dlv_correct', 'capture', 'desktop'), file = path.join(e.config.mediaDir, e.media.assets.getVersion(cap.refId).relPath), bytes = fs.readFileSync(file);
  fs.writeFileSync(file, 'changed after proposal');
  await assert.rejects(e.deliveries.checkCorrection('dlv_correct', a.revision.delta.correction), x => x.code === 'CORRECTION_BASE_CHANGED');
  assert.equal(e.db.prepare('SELECT count(*) n FROM delivery_documents').get().n, 1);
  fs.writeFileSync(file, bytes);
  e.db.prepare("UPDATE ops_plans SET status='EXPIRED' WHERE id=?").run(a.plan.id);
  await e.deliveries.tick(); assert.equal(e.db.prepare('SELECT count(*) n FROM delivery_revisions').get().n, 2);
  assert.deepEqual(e.db.prepare("SELECT json_extract(delta_json,'$.correction.version') v FROM delivery_revisions ORDER BY rowid").all().map(r => r.v), [1, 2]);
  await e.deliveries.tick(); assert.equal(e.db.prepare('SELECT count(*) n FROM delivery_revisions').get().n, 2);
});

test('RCO-10 factual FAIL blocks either clip in package, revision and correction before export', async t => {
  const e = await envFor(t), view = e.opsPlans.view;
  for (const kind of ['delivery.package', 'delivery.revise', 'delivery.correct']) {
    const planId = 'op_gate_' + kind.split('.').at(-1);
    if (kind === 'delivery.package') e.deliveries.patch('dlv_correct', { ops_plan_id: planId });
    else {
      const r = e.deliveries.recordRevision('dlv_correct', { text: 'QA gate', classes: [kind === 'delivery.correct' ? 'correction' : 'tone'], status: 'PROPOSED' });
      e.deliveries.updateRevision(r.id, { opsPlanId: planId });
    }
    for (const failed of ['media.render', 'media.variant.render']) {
      e.opsPlans.view = id => id === planId ? { kind, steps: ['media.render', 'media.variant.render'].map(k => ({ kind: k, status: 'DONE', result: { qa: { kinds: { factual: k === failed ? 'FAIL' : 'PASS' } } } })) } : view(id);
      await assert.rejects(e.executors['delivery.export'].run({ params: { deliveryId: 'dlv_correct' }, planId, authorize: () => { throw Error('must refuse before writing'); } }), x => x.code === 'DELIVERY_FACTUAL_QA_FAIL');
    }
  }
});

test('RCO-11 identical Office bytes kept without writes or COM; changed clip refs are visible; foreign bundle refused', async t => {
  const e = await correctionEnv({ extras: ['document', 'campaign'] }); t.after(() => e.cleanup());
  const kinds = ['delivery.office.document', 'delivery.campaign'];
  const first = await e.opsPlans.propose({ kind: 'delivery.package', title: 'Office proof', steps: kinds.map(kind => ({ kind, params: { deliveryId: 'dlv_correct' } })) });
  e.deliveries.patch('dlv_correct', { ops_plan_id: first.id });
  assert.equal((await e.confirm(first)).status, 'DONE');
  const correction = await e.deliveries.proposeCorrection('dlv_correct');
  for (const kind of kinds) {
    const kept = await e.executors[kind].run({ params: { deliveryId: 'dlv_correct' }, planId: correction.plan.id, authorize: () => { throw Error('kept proof must not write or invoke COM'); } });
    assert.equal(kept.result.keptByProof.planId, first.id); assert.equal(kept.result.inputsSha.length, 64);
  }
  const old = e.deliveries.currentItem('dlv_correct', 'export', 'master');
  e.deliveries.bindItem('dlv_correct', { ...old, id: undefined, refId: old.refId + '.new', refSha: 'f'.repeat(64) });
  const office = e.deliveries.view('dlv_correct').office;
  for (const kind of kinds) assert.equal(office.items.find(i => i.kind === kind).state, 'REFERS_OLD_VERSION');
  e.factory.deliveryBinding = () => ({ bundleId: 'foreign', bundleSha: 'foreign' });
  await assert.rejects(e.executors[kinds[0]].run({ params: { deliveryId: 'dlv_correct' }, planId: correction.plan.id, authorize: () => {} }), x => x.code === 'CORRECTION_BASE_CHANGED');
});
