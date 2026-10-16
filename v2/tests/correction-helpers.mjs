import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { hashCanonical } from "../server/core/canonical.mjs";
import { criterionFingerprint as fp, criterionProof, criterionRef, parseCriterionRef, displaySha } from "../server/media/claims.mjs";
import { BOOKING_DEMO } from "../server/factory/booking-demo-def.mjs";
import { normalizePresentation, resolvePresentation, storyFromPresentation, provePresentation, presentationForTemplate } from "../server/delivery/presentation.mjs";
import { renderSummary, summaryFactCheck, editSummary, regenerateSummary } from "../server/delivery/summary.mjs";
import { buildTemplate, pickCaptureCriteria, captureScriptFrom } from "../server/delivery/template.mjs";
import { buildMaster } from "../server/delivery/clip-ir.mjs";
import { factualCheck, createMediaQa } from "../server/media/qa.mjs";
import { createContent } from "../server/media/content.mjs";
import { irHash } from "../server/media/ir.mjs";
import { deriveVariant } from "../server/media/variants.mjs";
import { deriveCriteria, withField, withoutField } from "../server/owner/planners/criteria.mjs";
import { createDeliveryExecutors } from "../server/delivery/executors.mjs";
import { createExecutors } from "../server/ops/executors.mjs";
import { createFactory } from "../server/factory/factory.mjs";
import { createDeliveries } from "../server/delivery/delivery.mjs";
import { registerDeliveryCommands } from "../server/delivery/delivery-commands.mjs";
import { makeMediaEnv, fakeLaunchers } from "./media-helpers.mjs";

const copy = v => structuredClone(v);
const spec = JSON.parse(fs.readFileSync(new URL("fixtures/s25-spec-a69b8e9f.json", import.meta.url)));
const baseline = JSON.parse(fs.readFileSync(new URL("fixtures/claims-baseline.json", import.meta.url)));
const catalog = BOOKING_DEMO.delivery.presentations;
const resolve = (s = spec, presentations = catalog) => resolvePresentation({ presentations, spec: s, specSha: hashCanonical(s), noun: "programare", captures: pickCaptureCriteria(s) });
function factsOf(s = spec) {
  const manifest = { spec: { sha256: hashCanonical(s), version: 1, protectedTests: {}, criteria: [] }, changeSet: { id: "cs_test", sha256: "c".repeat(64) }, start: { command: "node server.js" }, evidence: [], reviews: [] };
  const evidenceRows = [], reviewRows = [];
  for (const c of s.acceptance) {
    const id = "ev_" + c.id, review = c.verify === "review";
    manifest.spec.criteria.push({ ...copy(c), status: review ? "PASS_REVIEW" : "PASS_EVIDENCE", evidence: [id] });
    if (review) {
      manifest.reviews.push({ id, status: "VALID", verdict: "PASS", problems: [], changeSet: "c".repeat(12) });
      reviewRows.push({ id, status: "VALID", verdict: "PASS", change_set_id: "cs_test", validation_json: '{"problems":[]}' });
    } else {
      const stage = { test: "QA", e2e: "E2E", preview: "PREVIEW" }[c.verify];
      const command = c.verify === "test" ? `node --test ${c.testRef}` : c.verify === "e2e" ? `e2e ${c.id}` : "node server.js";
      const counts = { tests: 1, pass: 1, fail: 0, skipped: 0, todo: 0 };
      manifest.evidence.push({ id, stage, command, status: "PASS", counts });
      evidenceRows.push({ id, stage, command, status: "PASS", counts: copy(counts), stale: 0, change_set_id: "cs_test", detail: { criterion: c.id, steps: (c.steps || []).map(s => ({ kind: Object.keys(s)[0], ok: true })) } });
      if (c.testRef) manifest.spec.protectedTests[c.testRef] = "a".repeat(64);
    }
  }
  return { manifest, bundle: { id: "bnd_test", sha256: hashCanonical(manifest), status: "READY_FOR_OWNER_ACCEPTANCE", change_set_id: "cs_test" }, spec: s, specRow: { sha256: hashCanonical(s) }, evidenceRows, reviewRows };
}
const proof = (f, id) => criterionProof({ ...f, id, expectedFp: fp(f.spec.acceptance.find(c => c.id === id), { previewCommand: "node server.js" }) });
const docOf = (p = resolve(), f = factsOf()) => renderSummary({ presentation: p, proofs: provePresentation(p, f), manifest: f.manifest, bundleId: f.bundle.id, bundleSha: f.bundle.sha256, generatedAt: "2026-10-16T00:00:00Z", issue: f.spec.title });
const templateOf = (demo = BOOKING_DEMO) => buildTemplate({ demo, project: { id: "prj_test", name: "Test" }, marker: { fixture: "booking-demo", data: "synthetic" }, missionView: { mission: { id: "mis_test" }, spec: { spec, version: 1, sha256: hashCanonical(spec) } }, tools: { state: "PINNED", identity: { ffmpeg: { version: "1", sha256: "a".repeat(64) }, ffprobe: { version: "1", sha256: "b".repeat(64) } } }, chromium: { version: "test" }, exportsDir: path.resolve(".tmp-s25-a/exports"), day: "20261016" });
const captures = ["desktop", "mobile"].map((role, i) => ({ role, assetVersionId: "mav_" + role, durationMs: 22000, width: i ? 390 : 1280, height: 844, captureLabel: "ORIGINAL_RECORDING", markers: [] }));
function master(p = resolve()) {
  return buildMaster({ captures, texts: storyFromPresentation(p).texts, claimIdBySlot: { hook: "cl_hook", desktop: "cl_desktop", mobile: "cl_mobile", cta: "cl_cta" }, claimIdByRole: { desktop: "cl_capdesktop", mobile: "cl_capmobile" }, deliveryId: "dlv_test" }).ir;
}

export { factsOf, spec, baseline, templateOf, master, resolve, docOf, catalog, captures };

import { createMedia } from '../server/media/index.mjs';
import { createOpsPlans } from '../server/ops/plans.mjs';
import { createOfficeExecutors } from '../server/delivery/office-executors.mjs';
import { sha256 } from '../server/core/canonical.mjs';
import { TEST_PROJECT_MARKER } from '../server/domain/projects.mjs';
export async function correctionEnv({ launchers = fakeLaunchers(), previewUrl = 'http://127.0.0.1:39991/', extras = [] } = {}) {
  const env = makeMediaEnv({ launchers }), { db, bus, settings } = env;
  const at = new Date().toISOString(), clock = () => new Date(), f = factsOf();
  const config = { ...env.config, hubRoot: path.join(env.dir, 'test-hub'), projectsRoot: path.join(env.dir, 'projects'), port: 39990, allowedOrigins: ['http://localhost:39990'] };
  const project = { id: 'prj_correct', name: 'Corectură', path: path.join(config.projectsRoot, 'demo'), source: 'hub-test' };
  fs.mkdirSync(project.path, { recursive: true });
  fs.mkdirSync(config.hubRoot, { recursive: true });
  fs.writeFileSync(path.join(project.path, TEST_PROJECT_MARKER), JSON.stringify({ createdBy: 'ifrim-agent-hub', fixture: 'booking-demo', data: 'synthetic' }));
  const exportsDir = path.join(env.dir, 'exports'); fs.mkdirSync(exportsDir);
  settings.set('mediaPolicy', { ...settings.get('mediaPolicy'), exportsDir, importRoots: [env.dir], interactivePriority: false }, 'test', 'correction test');
  const media = createMedia({ ...env, config, voiceEngine: { activity: () => ({}), transcribe: () => { throw Error('No model allowed'); } } }); media.boot();
  const isReal = !launchers.paths.ffmpeg.endsWith('fake-ffmpeg.mjs');
  const inspected = isReal ? await media.tools.inspect() : { ffmpeg: { version: 'test', sha256: 'a'.repeat(64), libsSha256: null }, ffprobe: { version: 'test', sha256: 'b'.repeat(64), libsSha256: null } };
  if (isReal) await media.tools.pin({ expect: Object.fromEntries(['ffmpeg', 'ffprobe'].map(k => [k, inspected[k]])), actor: 'test' });
  else media.tools.inspect = async () => ({ ...inspected, states: { ffmpeg: 'PINNED', ffprobe: 'PINNED' } });
  const identity = Object.fromEntries(['ffmpeg', 'ffprobe'].map(k => [k, { version: inspected[k].version, sha256: inspected[k].sha256, libsSha256: inspected[k].libsSha256 || null }]));
  const template = copy(templateOf()); template.tools = { ...identity, chromium: { version: 'test' } }; template.exports = { dir: exportsDir, folder: 'corectura' }; template.preview = { ...template.preview, url: previewUrl, origin: new URL(previewUrl).origin };
  template.story.texts = baseline.delivery.texts; template.story.variant.overrides = baseline.delivery.variant.overrides; delete template.presentation;
  template.story.variant.overridesSha = hashCanonical(template.story.variant.overrides);
  template.extras = extras;
  // Record the pre-fix repeated phone typing, leaving the approved spec untouched.
  for (const cap of template.captures) { const i = cap.steps.findIndex(s => s.type?.selector === "[name='phone']"); cap.steps.splice(i + 1, 0, copy(cap.steps[i])); cap.stepsSha = hashCanonical(cap.steps); }
  db.prepare("INSERT INTO projects (id, slug, name, path, source, created_at, updated_at) VALUES (?, 'correct', ?, ?, 'hub-test', ?, ?)").run(project.id, project.name, project.path, at, at);
  db.prepare("INSERT INTO missions (id, project_id, kind, title, objective, created_at, updated_at) VALUES ('mis_correct',?,'factory','Corectură','Corectură',?,?)").run(project.id, at, at);
  db.prepare("INSERT INTO factory_missions (mission_id, work_type, stage, limits_json, created_at, updated_at) VALUES ('mis_correct','FEATURE','DELIVERY_READY','{}',?,?)").run(at, at);
  db.prepare("INSERT INTO factory_specs (id, mission_id, version, status, spec_json, sha256, author, created_at) VALUES ('sp_correct','mis_correct',1,'APPROVED',?,?,'test',?)").run(JSON.stringify(spec), hashCanonical(spec), at);
  db.prepare("INSERT INTO factory_bundles (id, mission_id, change_set_id, change_set_sha, spec_version, manifest_json, sha256, status, created_at) VALUES (?,'mis_correct','cs_test',?,1,?,?,?,?)").run(f.bundle.id, f.manifest.changeSet.sha256, JSON.stringify(f.manifest), f.bundle.sha256, f.bundle.status, at);
  for (const r of f.evidenceRows) db.prepare("INSERT INTO factory_evidence (id, mission_id, change_set_id, stage, kind, command, runner, isolation, status, counts_json, detail_json, created_at) VALUES (?,'mis_correct',?,?,'check',?,'node','test',?,?,?,?)").run(r.id, r.change_set_id, r.stage, r.command, r.status, JSON.stringify(r.counts), JSON.stringify(r.detail), at);
  for (const r of f.reviewRows) db.prepare("INSERT INTO factory_reviews (id, mission_id, change_set_id, change_set_sha, reviewer, verdict, validation_json, status, created_at) VALUES (?,'mis_correct',?,?,'reviewer',?,?,?,?)").run(r.id, r.change_set_id, f.manifest.changeSet.sha256, r.verdict, r.validation_json, r.status, at);
  const cp = media.content.createProject({ title: 'Corectură', audience: 'both', format: 'demo' }, 'test');
  const snapshot = 's'.repeat(64);
  db.prepare("INSERT INTO deliveries (id, project_id, title, status, mission_id, template_json, template_sha, ops_steps_json, ops_body_sha, bundle_id, bundle_sha, spec_sha, snapshot_sha, change_set_id, change_set_sha, content_project_id, created_by, created_at, updated_at) VALUES ('dlv_correct',?,'Corectură','READY','mis_correct',?,?,'[]',?,?,?,?,?,'cs_test',?,?,'test',?,?)").run(project.id, JSON.stringify(template), hashCanonical(template), '0'.repeat(64), f.bundle.id, f.bundle.sha256, hashCanonical(spec), snapshot, f.manifest.changeSet.sha256, cp.id, at, at);
  const realFactory = createFactory({ db, bus, config, clock });
  const factory = { ...realFactory, snapshotCheck: () => ({ expected: snapshot, actual: snapshot, bundleId: f.bundle.id, changeSetId: 'cs_test', changedFiles: [] }), driftProvenance: () => ({ software: [], hub: [] }),
    deliveryBinding: () => ({ bundleId: f.bundle.id, bundleSha: f.bundle.sha256, bundleStatus: f.bundle.status, specSha: hashCanonical(spec), criteria: f.manifest.spec.criteria, manifest: f.manifest, startUrl: previewUrl }), view: () => null, previewStatus: () => ({ running: false }) };
  const session = { id: 'owner_correct', credentialId: 'cred_test' };
  const trust = { requireSession: s => { if (s?.id !== session.id) throw Error('owner session required'); return session; }, confirmedAuthority: () => ({ ok: true }), requireFresh: s => s };
  const executors = {}, opsPlans = createOpsPlans({ db, bus, clock, settings, trust, executors, folderContext: () => ({ allowed: [exportsDir], forbidden: [] }) });
  const projects = { get: () => project };
  const deliveries = createDeliveries({ db, bus, config, clock, settings, projects, factory, media, opsPlans, trust });
  deliveries.boot();
  const supervisor = { get: key => key === 'delivery-preview-dlv_correct' ? { pid: process.pid, exited: false } : null, stop: async () => ({}) };
  const runner = { startPreview: async () => ({ status: 'PASS' }) };
  Object.assign(executors, createExecutors({ media, settings, variantOverridesFor: args => deliveries.variantOverridesFor(args) }), createDeliveryExecutors({ deliveries, factory, media, projects, runner, supervisor, opsPlans, config }), createOfficeExecutors({ deliveries, factory, opsPlans, config, appCheck: 'skip' }));
  const bundleItem = deliveries.bindItem('dlv_correct', { kind: 'bundle', refTable: 'factory_bundles', refId: f.bundle.id, refSha: f.bundle.sha256 });
  deliveries.bindItem('dlv_correct', { kind: 'brief', refTable: 'content_briefs', refId: 'brief_correct', meta: { prefs: { tone: 'both' } } });
  for (const cap of template.captures) {
    const relPath = cap.role + '.mp4', buf = Buffer.from('synthetic capture ' + cap.role); fs.writeFileSync(path.join(config.mediaDir, relPath), buf);
    const assetId = 'ma_' + cap.role, vid = 'mav_' + cap.role;
    db.prepare("INSERT INTO media_assets (id, kind, title, category, origin, capture_label, created_by, created_at, updated_at) VALUES (?,'video',?,'raw','OWNED','ORIGINAL_RECORDING','test',?,?)").run(assetId, cap.role, at, at);
    db.prepare("INSERT INTO media_asset_versions (id, asset_id, version, sha256, bytes, rel_path, mime, probe_json, is_original, status, created_by, created_at) VALUES (?,?,1,?,?,?,'video/mp4',?,1,'READY','test',?)").run(vid, assetId, sha256(buf), buf.length, relPath, JSON.stringify({ durationMs: 22000, width: cap.viewport.width, height: cap.viewport.height, fps: 30, hasVideo: true }), at);
    deliveries.bindItem('dlv_correct', { kind: 'capture', role: cap.role, refTable: 'media_asset_versions', refId: vid, refSha: sha256(buf), upstream: [bundleItem.id], meta: { durationMs: 22000, width: cap.viewport.width, height: cap.viewport.height, stepsSha: cap.stepsSha, holdsRejected: [{ code: 'HOLD_POSTCONDITION_FAILED', reason: 'typing', step: 1 }], markers: [], label: 'ORIGINAL_RECORDING' } });
  }
  const ir = buildMaster({ captures, texts: baseline.delivery.texts, deliveryId: 'dlv_correct', passed: spec.acceptance.map(c => c.id) }).ir;
  const old = media.edits.create({ contentProjectId: cp.id, title: 'Original', ir, actor: 'test' });
  deliveries.patch('dlv_correct', { edit_project_id: old.project.id });
  deliveries.bindItem('dlv_correct', { kind: 'edit', role: 'master', refTable: 'media_edit_versions', refId: old.version.id, refSha: old.version.irSha256 });
  const variant = media.variants.derive({ masterVersionId: old.version.id, platformKey: template.story.variant.platformKey, overrides: template.story.variant.overrides, actor: 'test' });
  deliveries.bindItem('dlv_correct', { kind: 'variant', role: 'vertical', refTable: 'media_variants', refId: variant.variant.id, meta: { editVersionId: variant.version.id } });
  const doc = renderSummary({ block: baseline.delivery, manifest: f.manifest, issue: spec.title, generatedAt: at });
  db.prepare("INSERT INTO delivery_documents (id, delivery_id, kind, version, sections_json, text, content_sha, basis_json, basis_sha, claims_to_verify_json, warnings_json, author_kind, status, approval_json, created_by, created_at) VALUES ('ddoc_old','dlv_correct','commercial_summary',1,?,?,?,?,?,'[]','[]','template','CURRENT',?,'test',?)").run(JSON.stringify(doc.sections), doc.text, doc.contentSha, JSON.stringify(doc.basis), doc.basisSha, JSON.stringify({ sha: doc.contentSha, kind: 'PRESENTATION_READY' }), at);
  deliveries.exportDocument('dlv_correct', 'ddoc_old');
  const folder = path.join(exportsDir, template.exports.folder);
  for (const role of ['master', 'vertical']) {
    const file = path.join(folder, role === 'master' ? 'demo-16x9-v1.mp4' : 'demo-9x16-v1.mp4'); fs.writeFileSync(file, 'original ' + role);
    deliveries.bindItem('dlv_correct', { kind: 'export', role, refTable: 'file', refId: file, refSha: sha256(fs.readFileSync(file)), meta: { file } });
  }
  return { ...env, config, project, f, template, media, factory, deliveries, opsPlans, executors, trust, session, folder,
    async confirm(plan) { await opsPlans.confirm({ planId: plan.id, nonce: plan.nonce, displayedHash: plan.hash, session }); await opsPlans.idle(plan.id); return opsPlans.view(plan.id); },
    async cleanup() { deliveries.close_(); opsPlans.close(); await media.close(); await env.cleanup(); } };
}
