import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { correctionEnv, master, baseline } from './correction-helpers.mjs';
import { hashCanonical } from '../server/core/canonical.mjs';
import { createDeliveries } from '../server/delivery/delivery.mjs';
import { registerDeliveryCommands } from '../server/delivery/delivery-commands.mjs';
import { registerDeliveryPlanner } from '../server/owner/planners/delivery.mjs';
import { createExecutors } from '../server/ops/executors.mjs';
import { packageSteps, PACKAGE_KIND, DELIVERY_LIMITS } from '../server/delivery/template.mjs';
import { factualCheck, QA_VERSION } from '../server/media/qa.mjs';
import { runClaimsOffline } from './run-claims-offline.mjs';

const envFor = async t => { const e = await correctionEnv(); t.after(() => e.cleanup()); return e; };
const stored = e => e.db.prepare("SELECT template_json, template_sha, ops_steps_json, ops_body_sha FROM deliveries WHERE id='dlv_correct'").get();
const variantStep = plan => plan.steps.find(s => s.kind === 'media.variant.render');

test('RCC-01 legacy revision and re-package cards hash generated overrides; executor derives exactly those texts', async t => {
  const e = await envFor(t), before = stored(e), d = e.deliveries.get('dlv_correct');
  const effective = e.deliveries.effectiveTemplate(d);
  assert.equal(effective.presentation.status, 'GENERATED');
  assert.equal(effective.presentation.origin, 'legacy-generated');
  assert.equal(effective.presentation.specSha, d.specSha);
  assert.deepEqual(effective.story.variant.overrides, { hookText: 'Demo local', ctaText: 'Hai să vorbim' });
  assert.equal(effective.story.variant.overridesSha, hashCanonical(effective.story.variant.overrides));
  assert.deepEqual(effective.story.texts.desktop.criteria, ['AC-8']);
  assert.notDeepEqual(effective.story.texts, baseline.delivery.texts);
  const commands = new Map(); registerDeliveryCommands((k, v) => commands.set(k, v), e);
  const ctx = { channel: 'test', actor: 'test', ownerSession: e.session };
  const revision = e.deliveries.recordRevision(d.id, { text: 'Revizie', classes: ['tone'], status: 'PROPOSED' });
  const plan = await commands.get('delivery.revision.propose').execute({ deliveryId: d.id, revisionId: revision.id }, ctx);
  const repack = await commands.get('delivery.package.propose').execute({ deliveryId: d.id }, ctx);
  for (const card of [plan, repack]) {
    assert.deepEqual(variantStep(card).params.overrides, effective.story.variant.overrides);
    const changed = structuredClone(card.body); changed.steps.find(s => s.kind === 'media.variant.render').params.overrides.hookText += '!';
    assert.notEqual(hashCanonical(changed), card.hash);
  }
  // The real variant service stores the derived IR; rendering/QA are stubbed to keep this offline and focused on authority.
  const media = { ...e.media, render: { request: () => ({ id: 'render' }), get: () => ({ id: 'render', status: 'DONE', outputAssetVersionId: 'mav_result' }) },
    qa: { run: async () => ({ status: 'PASS', reports: {} }) }, reviews: { list: () => [] } };
  const params = { ...variantStep(plan).params, masterVersionId: e.deliveries.currentItem(d.id, 'edit', 'master').refId };
  const paramsSha = hashCanonical(params), planSha = hashCanonical(plan.body);
  const result = await createExecutors({ media })['media.variant.render'].run({ params, planId: plan.id, authorize() {} });
  const ir = e.media.edits.getVersion(result.result.editVersionId).ir;
  for (const [id, key] of [['t-hook', 'hookText'], ['t-cta', 'ctaText']]) assert.equal(ir.tracks.flatMap(t => t.items || []).find(i => i.id === id).text, params.overrides[key]);
  assert.equal(hashCanonical(params), paramsSha); assert.equal(hashCanonical(plan.body), planSha);
  assert.deepEqual(stored(e), before);
});

test('RCC-02 real revision planner classifies legacy tone edits against generated on-screen texts', async t => {
  const e = await envFor(t), before = stored(e), d = e.deliveries.get('dlv_correct');
  let proposedOps;
  const media = { ...e.media, reviews: { ...e.media.reviews, proposeOps: args => { proposedOps = args.ops; return e.media.reviews.proposeOps(args); } } };
  const planner = registerDeliveryPlanner({ ...e, media }, { registerPlanner() {} });
  const result = await planner.revise({ text: 'Clipul este prea tehnic', lastTarget: { kind: 'delivery', id: d.id } });
  assert.equal(result.kind, 'ops', result.text);
  const effective = e.deliveries.effectiveTemplate(d);
  assert.ok(proposedOps.length > 0);
  for (const op of proposedOps) assert.equal(op.text, effective.story.texts[op.itemId.slice(2)].business);
  assert.ok(proposedOps.some(op => op.itemId === 't-hook' && op.text === 'Demo local: programare'));
  assert.deepEqual(variantStep(result.plan).params.overrides, effective.story.variant.overrides);
  assert.deepEqual(stored(e), before);
});

test('RCC-03 correction record takes precedence over legacy overlay for its plan and later applied revisions', async t => {
  const e = await envFor(t), before = stored(e), d = e.deliveries.get('dlv_correct');
  const out = await e.deliveries.proposeCorrection(d.id);
  const correction = out.revision.delta.correction;
  assert.equal(e.deliveries.effectiveTemplate(d).presentation.status, 'GENERATED');
  assert.deepEqual(e.deliveries.effectiveTemplate(d, { planId: out.plan.id }).story.variant.overrides, correction.story.overrides);
  assert.deepEqual(variantStep(out.plan).params.overrides, correction.story.overrides);
  e.deliveries.updateRevision(out.revision.id, { status: 'APPLIED' });
  assert.equal(e.deliveries.effectiveTemplate(d).presentation.key, 'phone-privacy');
  assert.deepEqual(e.deliveries.effectiveTemplate(d).story.texts, correction.story.texts);
  assert.deepEqual(stored(e), before);
});

test('RCC-04 legacy ARMED activation compares and adopts its stored package body before binding facts', async t => {
  const e = await envFor(t), d = e.deliveries.get('dlv_correct');
  const steps = packageSteps(d.template, d.id);
  const body = await e.opsPlans.buildBody({ kind: PACKAGE_KIND, title: d.title, steps, limits: { maxDurationMin: DELIVERY_LIMITS.phaseMinutes, maxActions: DELIVERY_LIMITS.maxActions } });
  e.db.prepare("UPDATE deliveries SET status='ARMED', bundle_id=NULL, bundle_sha=NULL, ops_steps_json=?, ops_body_sha=? WHERE id=?").run(JSON.stringify(steps), hashCanonical(body), d.id);
  const before = stored(e);
  const binding = { ...e.factory.deliveryBinding(), changeSetId: d.changeSetId, changeSetSha: d.changeSetSha, snapshotSha: d.snapshotSha, specVersion: 1, e2e: [] };
  let adopted;
  const deliveries = createDeliveries({ ...e, clock: () => new Date(), projects: { get: () => e.project },
    factory: { ...e.factory, view: () => ({ factory: { stage: 'DELIVERY_READY' } }), snapshotCheck: () => ({ equal: true }), deliveryBinding: () => binding,
      claimFacts: () => { throw Error('Activation must not resolve presentation facts'); } },
    opsPlans: { buildBody: e.opsPlans.buildBody, adoptDerived: async input => { adopted = input; return { id: 'opp_armed' }; } } });
  t.after(() => deliveries.close_());
  // Descriptions also use the service with no available claim facts.
  const effective = e.deliveries.effectiveTemplate;
  e.deliveries.effectiveTemplate = () => { throw Error('Stored body descriptions must not generate a presentation'); };
  try { assert.equal((await deliveries.activate(d.id)).activated, true); }
  finally { e.deliveries.effectiveTemplate = effective; }
  assert.equal(adopted.expectedBodySha, hashCanonical(body)); assert.deepEqual(adopted.steps, steps);
  assert.deepEqual(variantStep(adopted).params.overrides, baseline.delivery.variant.overrides);
  assert.deepEqual(stored(e), before);
});

test('RCC-05 vocabulary-only unclaimed text warns in legacy/Studio IRs, errors in deliveries; citations always error', () => {
  assert.equal(QA_VERSION, 2);
  const cases = ['Flux testat', 'Flux verificat', 'PASS', 'E2E trecut', 'Revizuit independent', 'AC-8', 'Generat local: AC-8'].map(text => [text, 'body']);
  cases.push(['AC-8', 'label']);
  for (const author of [undefined, 'studio', 'delivery:dlv_test']) for (const [text, style] of cases) {
    const ir = master();
    if (author === undefined) delete ir.meta.author; else ir.meta.author = author;
    for (const track of ir.tracks) {
      for (const clip of track.clips || []) clip.claimIds = [];
      if (track.items) track.items = track.items.filter(i => i.id === 't-hook' || i.style === 'label');
    }
    ir.evidenceRegions = [];
    const item = ir.tracks.flatMap(t => t.items || []).find(i => i.id === 't-hook');
    item.text = text; item.style = style; delete item.claimIds;
    const before = hashCanonical(ir), report = factualCheck({ ir });
    const finding = report.findings.find(f => f.code === 'TEXT_CLAIM_MISSING');
    const error = author?.startsWith('delivery:') || text.includes('AC-8');
    assert.equal(finding?.severity, error ? 'error' : 'warning', `${author}: ${text}`);
    assert.equal(report.status, error ? 'FAIL' : 'WARN'); assert.equal(report.measurements.qaVersion, 2);
    assert.equal(finding.itemId, item.id); assert.equal(finding.range.fromFrame, item.start); assert.ok(finding.range.timecode);
    assert.equal(hashCanonical(ir), before);
  }
});

test('RCC-06 offline runner rejects zero tests and missing/partial summaries even with exit status zero', t => {
  const dir = fs.mkdtempSync(path.resolve('.tmp-s25-a/runner-review-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const summary = '# tests 1\n# pass 1\n# fail 0\n# skipped 0\n# cancelled 0\n';
  for (const [stdout, status, expected] of [[summary, 0, 0], [summary.replace('# tests 1', '# tests 0').replace('# pass 1', '# pass 0'), 0, 1],
    ['TAP version 13\n', 0, 1], [summary.replace('# cancelled 0\n', ''), 0, 1], [summary, 1, 1]]) {
    const code = runClaimsOffline(['r-claims'], { dir, log() {}, run: (node, args) => {
      assert.equal(node, 'C:/Program Files/nodejs/node.exe'); assert.ok(args.includes('--test-concurrency=1'));
      return { stdout, status };
    } });
    assert.equal(code, expected);
    const result = JSON.parse(fs.readFileSync(path.join(dir, 'r-claims.json')));
    if (!stdout.includes('# tests')) assert.equal(result.counts.tests, -1);
  }
  let count = 0;
  assert.equal(runClaimsOffline(['r-claims', 'm11-template'], { dir, log() {}, run: () => ({ status: 0, stdout: count++ ? summary : '' }) }), 1);
  assert.equal(count, 2, 'a later passing file cannot hide an invalid earlier file');
});
