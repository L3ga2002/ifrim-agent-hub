// M11 „Ifrim Delivery” end to end on a test Hub (PASS_SIMULATED for the models — fake Codex writer, fake Claude reviewer — and REAL
// for everything after DELIVERY_READY: the booking fixture's preview, Chromium capture at desktop and phone width, ffmpeg render, the
// vertical variant, QA, local exports and the commercial summary). ONE envelope confirmation covers the mission and the delivery
// phase; the delivery's plan is derived from it (never confirmed again). Then the owner's two revision tests (§24, §25).
// SKIPPED_ENV when Playwright/Chromium or ffmpeg/ffprobe are missing.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeTestHub, waitFor, enrolOwner, prepareLiveWithoutGrants, freePort, HUB_ROOT, tempDir } from "./helpers.mjs";
import { realLaunchers } from "./media-helpers.mjs";
import { materializeFixture, demoSpec, FACTORY_DEMOS } from "../server/factory/fixtures.mjs";
import { browserStatus } from "../server/tools/browser.mjs";
import { classify } from "../server/delivery/revision.mjs";

const launchers = realLaunchers();
const browser = browserStatus({ hubRoot: HUB_ROOT });
const skip = !launchers.available ? "SKIPPED_ENV: ffmpeg/ffprobe absent" : !(browser.installed && browser.cachedBrowsers.length) ? "SKIPPED_ENV: Playwright/Chromium absent" : false;
const MODELS = { writerModel: "gpt-fake-sol", reviewerModel: "sonnet" };
const dispatch = (hub, type, payload, extra = {}) => hub.commands.dispatch({ type, payload, channel: "test", actor: "test", ...extra });
const SETTLED = ["DELIVERY_READY", "NEEDS_OWNER_DECISION", "BLOCKED", "PAUSED", "CANCELLED", "ACCEPTED", "REJECTED", "FAILED"];

async function deliveryHub() {
  const t = await makeTestHub({ queues: true, configOverrides: { mediaTools: { launcher: launchers } } });
  await prepareLiveWithoutGrants(t.hub);
  // The owner's videos folder lives outside the Hub's data (a protected folder, as on the real computer).
  const importRoot = tempDir("videos");
  t.hub.bus.transaction(() => t.hub.settings.set("mediaPolicy", { ...(t.hub.settings.get("mediaPolicy") || {}), importRoots: [importRoot] }, "test", "exports folder for the test"));
  const port = await freePort();
  const dir = path.join(t.dataDir, "detailing-demo");
  materializeFixture("booking-demo", dir, { port });
  const project = (await dispatch(t.hub, "project.register_test", { path: dir })).result;
  const owner = await enrolOwner(t);
  await dispatch(t.hub, "owner.autonomy.set", { projectId: project.id, level: "TRUSTED" }, { ownerSession: owner.reauth() });
  const spec = demoSpec("booking-demo", { port });
  const { mission } = (await dispatch(t.hub, "factory.prepare", { projectId: project.id, ...spec, limits: { ...FACTORY_DEMOS["booking-demo"].limits, ...MODELS } })).result;
  return { ...t, project, dir, owner, mission, port, importRoot };
}
const factoryView = (t, id) => t.hub.factory.view(id);
const untilStage = (t, id, stages, ms = 180000) => waitFor(() => (stages.includes(factoryView(t, id).factory.stage) ? factoryView(t, id) : null), ms, 200);
const untilDelivery = (t, id, statuses, ms = 300000) => waitFor(() => (statuses.includes(t.hub.deliveries.get(id).status) ? t.hub.deliveries.get(id) : null), ms, 250);
const modelRuns = (t) => t.hub.db.prepare("SELECT COUNT(*) AS n FROM agent_runs").get().n;

test("M11-DF-01 ONE confirmation: mission → DELIVERY_READY → derived delivery plan → captures, clip 16:9 + 9:16, QA, exports, summary → READY; no model after DELIVERY_READY", { timeout: 900000, skip }, async () => {
  const t = await deliveryHub();
  try {
    // The planner's order: the delivery row first (PLANNED: frozen template + the exact package steps), then ONE envelope that carries it.
    const planned = await t.hub.deliveries.createPlanned({ projectId: t.project.id, missionId: t.mission.id, actor: "test" });
    assert.equal(planned.status, "PLANNED");
    const { envelope, summary } = (await dispatch(t.hub, "envelope.propose", { projectId: t.project.id, missionIds: [t.mission.id], deliveryId: planned.id, constraints: { noPublish: true } })).result;
    assert.ok(envelope.body.delivery, "the delivery section is in the hashed body");
    assert.equal(envelope.body.delivery.deliveryId, planned.id);
    assert.ok(summary.delivery.steps.length >= 10, "the card lists the delivery steps");
    assert.ok(envelope.body.delivery.never.includes("publicare"));
    t.queue("codex", "factory-write:booking-fix");
    t.queue("claude", "review:pass");
    const confirmed = (await dispatch(t.hub, "envelope.confirm", { envelopeId: envelope.id, nonce: envelope.nonce, displayedHash: envelope.envelopeHash }, { ownerSession: t.owner.session })).result;
    assert.equal(confirmed.envelope.status, "ACTIVE");
    assert.equal(t.hub.deliveries.get(planned.id).status, "ARMED", "armed in the confirmation transaction");
    const done = await untilStage(t, t.mission.id, SETTLED);
    assert.equal(done.factory.stage, "DELIVERY_READY", done.factory.stageReason);
    const runsAtReady = modelRuns(t);
    const ready = await untilDelivery(t, planned.id, ["READY", "FAILED", "NEEDS_OWNER", "EXPIRED", "CANCELLED"]);
    const d = t.hub.deliveries.get(planned.id);
    const plan = d.opsPlanId ? t.hub.opsPlans.view(d.opsPlanId) : null;
    assert.equal(ready.status, "READY", `${ready.statusReason} · ${JSON.stringify(plan?.steps.map((s) => [s.seq, s.kind, s.status, s.error]))}`);
    assert.equal(modelRuns(t), runsAtReady, "no model run after DELIVERY_READY");
    assert.equal(plan.consent.modality, "derived");
    assert.equal(plan.consent.derivedFrom.id, envelope.id);
    const consents = t.hub.db.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'ops.plan.consent' AND scope_id = ?").get(plan.id).n;
    assert.equal(consents, 0, "the delivery plan was never confirmed again");
    const v = t.hub.deliveries.view(planned.id);
    assert.ok(v.clip.master?.src && v.clip.vertical?.src, "16:9 and 9:16 rendered");
    assert.equal(v.decisions.software, "PENDING", "nothing accepted on the owner's behalf");
    assert.equal(v.decisions.publishing, "OFF");
    assert.equal(v.summary.version, 1);
    assert.deepEqual(v.summary.sections.slice(0, 7).map((s) => s.heading), ["Problema", "Ce demonstrăm", "Cum funcționează", "Ce beneficii putem afirma", "Ce nu putem afirma", "Întrebări pentru client", "Următorul pas"]);
    assert.match(v.summary.sections.find((s) => s.id === "price_terms").text, /De stabilit \(neconfigurat\)/);
    assert.ok(fs.existsSync(v.summary.exports.md.file) && fs.existsSync(v.summary.exports.html.file));
    const files = fs.readdirSync(path.join(d.template.exports.dir, d.template.exports.folder));
    assert.ok(files.some((f) => /^demo-16x9-v1/.test(f)) && files.some((f) => /^demo-9x16-v1/.test(f)), files.join(", "));
    // Capture provenance: the exact preview, the bound snapshot, the synthetic label.
    const captures = t.hub.deliveries.items(planned.id).filter((i) => i.kind === "capture");
    assert.deepEqual(captures.map((c) => c.role).sort(), ["desktop", "mobile"]);
    for (const c of captures) assert.equal(c.snapshotSha, d.snapshotSha, "T09: the capture is evidence of the exact verified version");

    // §24 — „Site-ul e bine, dar clipul e prea tehnic. După secunda 10 arată direct programarea.”: only the media chain is redone.
    const editVersionId = v.clip.master.editVersionId;
    const masterIr = t.hub.db.prepare("SELECT ir_json FROM media_edit_versions WHERE id = ?").get(editVersionId).ir_json;
    const out = classify("Site-ul e bine, dar clipul e prea tehnic. După secunda 10 arată direct programarea.", { master: { versionId: editVersionId, ir: JSON.parse(masterIr) }, texts: d.template.story.texts, tone: "both" });
    assert.ok(out.media?.ops?.length, JSON.stringify(out).slice(0, 400));
    assert.ok(!out.software, "no software request");
    const review = t.hub.media.reviews.proposeOps({ editVersionId, ops: out.media.ops, text: "clip prea tehnic; salt la programare", provenance: "owner_ui", actor: "test" });
    const rev = t.hub.deliveries.recordRevision(planned.id, { text: "Site-ul e bine, dar clipul e prea tehnic. După secunda 10 arată direct programarea.", classes: out.classes, delta: { prefs: { tone: "business" } }, status: "PROPOSED", reviewId: review.id });
    const runsBefore = modelRuns(t);
    const capturesBefore = t.hub.db.prepare("SELECT COUNT(*) AS n FROM media_capture_sessions").get().n;
    const docBefore = t.hub.deliveries.currentDoc(planned.id);
    const card = (await dispatch(t.hub, "delivery.revision.propose", { deliveryId: planned.id, revisionId: rev.id }, { channel: "owner", ownerSession: t.owner.session })).result;
    await dispatch(t.hub, "ops.plan.confirm", { planId: card.id, nonce: card.nonce, displayedHash: card.hash }, { channel: "owner", ownerSession: t.owner.session });
    await waitFor(() => ["DONE", "FAILED", "NEEDS_OWNER"].includes(t.hub.opsPlans.view(card.id).status) ? true : null, 300000, 250);
    const revised = t.hub.opsPlans.view(card.id);
    assert.equal(revised.status, "DONE", JSON.stringify(revised.steps.map((s) => [s.seq, s.kind, s.status, s.error])));
    assert.equal(modelRuns(t), runsBefore, "no Codex writer, no reviewer, no model");
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM media_capture_sessions").get().n, capturesBefore, "no new capture");
    const after = t.hub.deliveries.items(planned.id);
    const cur = (kind, role) => after.filter((i) => i.kind === kind && i.role === role && i.status === "CURRENT");
    assert.equal(cur("bundle", "")[0]?.refId, d.bundleId, "CODE: VALID");
    assert.equal(cur("capture", "desktop").length, 1, "captures VALID");
    assert.ok(after.some((i) => i.kind === "edit" && i.status === "SUPERSEDED"), "TIMELINE: new version (old superseded)");
    assert.ok(after.some((i) => i.kind === "render" && i.role === "master" && i.status === "SUPERSEDED"), "RENDER: regenerated");
    assert.equal(t.hub.deliveries.get(planned.id).status, "READY");
    const docAfter = t.hub.deliveries.currentDoc(planned.id);
    assert.equal(docAfter.version, docBefore.version + 1, "summary: only a new video section");
    for (const s of docAfter.sections) if (s.id !== "video") assert.equal(s.text, docBefore.sections.find((x) => x.id === s.id).text, `${s.id} unchanged`);

    // T13 — a copy-only change: a new summary version, no plan, no model, no Engineering.
    const plansBefore = t.hub.db.prepare("SELECT COUNT(*) AS n FROM ops_plans").get().n;
    const copy = await t.hub.deliveryPlanner.revise({ step: { intent: "delivery_revise", args: {} }, text: "În rezumat, la Următorul pas scrie «O discuție scurtă la atelier, apoi oferta.»", projectId: t.project.id, session: t.owner.session });
    assert.match(copy.text, /versiunea 3 a rezumatului/, JSON.stringify(copy));
    assert.equal(t.hub.deliveries.currentDoc(planned.id).sections.find((s) => s.id === "next_step").text, "O discuție scurtă la atelier, apoi oferta.");
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM ops_plans").get().n, plansBefore, "no plan for a copy edit");
    assert.equal(modelRuns(t), runsBefore, "no model for a copy edit");

    // §25 — „Butonul de programare trebuie să facă altceva.”: the difference is shown, nothing runs before a confirmation.
    const sw = await t.hub.deliveryPlanner.revise({ step: { intent: "delivery_revise", args: {} }, text: "Butonul de programare trebuie să facă altceva.", projectId: t.project.id, session: t.owner.session });
    const swText = JSON.stringify(sw);
    assert.match(swText, /criteriile de acceptanță trebuie revăzute/);
    assert.match(swText, /nu încep nimic până nu confirmi/);
    assert.equal(modelRuns(t), runsBefore, "the new scope is not executed by itself");
    assert.equal(t.hub.deliveries.get(planned.id).status, "READY", "nothing is stale before the new mission starts");

    // T15 — nothing published anywhere: no publish / upload operation in any delivery plan, publishing OFF in the Room.
    const ops = t.hub.db.prepare("SELECT body_json FROM ops_plans").all().flatMap((r) => JSON.parse(r.body_json).steps.flatMap((s) => s.ops.map((o) => o.op)));
    assert.ok(!ops.some((op) => ["publish", "upload", "send"].includes(op)), ops.join(","));

    // T11 — the code changes after delivery: everything software-bound becomes STALE (the brief keeps the owner's choices).
    fs.appendFileSync(path.join(t.dir, "public", "js", "slots-view.mjs"), "\n// schimbare după livrare\n");
    const verified = t.hub.deliveries.verify(planned.id, { by: "test" });
    assert.equal(verified.equal, false);
    assert.ok(verified.changedFiles.includes("public/js/slots-view.mjs"), verified.changedFiles.join(","));
    const stale = t.hub.deliveries.items(planned.id);
    assert.equal(t.hub.deliveries.get(planned.id).status, "STALE");
    for (const kind of ["bundle", "capture", "edit", "render", "variant", "export"]) assert.ok(stale.filter((i) => i.kind === kind && i.status === "CURRENT").length === 0, `${kind} no longer current`);
    assert.equal(stale.filter((i) => i.kind === "brief" && i.status === "CURRENT").length, 1, "the brief (tone, jump) stays");
    assert.equal(t.hub.deliveries.currentDoc(planned.id).status, "STALE", "the summary no longer states facts about this code");
    const variantRow = t.hub.db.prepare("SELECT status FROM media_variants ORDER BY created_at DESC LIMIT 1").get();
    assert.equal(variantRow.status, "INVALIDATED");
    assert.throws(() => t.hub.deliveries.approveDocument(planned.id, { displayedSha: t.hub.deliveries.currentDoc(planned.id).contentSha, session: t.owner.session }), /curentă|învechit/);
  } finally { await t.cleanup(); }
});

test("M11-DF-02 (pilot 2026-10-08) the delivery-only card: software already DELIVERY_READY → ONE ops confirmation starts the PLANNED delivery → READY; no model", { timeout: 900000, skip }, async () => {
  const t = await deliveryHub();
  try {
    // As in the pilot: a delivery row was planned, but the envelope the owner confirmed carried no delivery section.
    const orphan = await t.hub.deliveries.createPlanned({ projectId: t.project.id, missionId: t.mission.id, actor: "test" });
    const { envelope } = (await dispatch(t.hub, "envelope.propose", { projectId: t.project.id, missionIds: [t.mission.id], constraints: { noPublish: true } })).result;
    assert.equal(envelope.body.delivery, undefined);
    t.queue("codex", "factory-write:booking-fix");
    t.queue("claude", "review:pass");
    await dispatch(t.hub, "envelope.confirm", { envelopeId: envelope.id, nonce: envelope.nonce, displayedHash: envelope.envelopeHash }, { ownerSession: t.owner.session });
    const done = await untilStage(t, t.mission.id, SETTLED);
    assert.equal(done.factory.stage, "DELIVERY_READY", done.factory.stageReason);
    assert.equal(t.hub.deliveries.get(orphan.id).status, "PLANNED", "never armed by an envelope without the delivery");
    const runsAtReady = modelRuns(t);
    // The owner's sentence again → the delivery-only card for the same PLANNED row.
    const card = await t.hub.deliveryPlanner.prepare({ step: { intent: "delivery_prepare", args: {}, constraints: { noPublish: true } }, text: "Pregătește demo-ul de detailing pentru prezentare. Nu publica nimic.", projectId: t.project.id });
    assert.equal(card.kind, "ops", JSON.stringify(card).slice(0, 400));
    const plan = card.plan;
    assert.equal(t.hub.deliveries.get(orphan.id).opsPlanId, plan.id, "the card is bound to the delivery it starts");
    await dispatch(t.hub, "ops.plan.confirm", { planId: plan.id, nonce: plan.nonce, displayedHash: plan.hash }, { channel: "owner", ownerSession: t.owner.session });
    const ready = await untilDelivery(t, orphan.id, ["READY", "FAILED", "NEEDS_OWNER", "EXPIRED", "CANCELLED"]);
    const pv = t.hub.opsPlans.view(plan.id);
    assert.equal(ready.status, "READY", `${ready.statusReason} · ${JSON.stringify(pv.steps.map((s) => [s.seq, s.kind, s.status, s.error]))}`);
    assert.equal(modelRuns(t), runsAtReady, "no model after DELIVERY_READY");
    const v = t.hub.deliveries.view(orphan.id);
    assert.ok(v.clip.master?.src && v.clip.vertical?.src, "16:9 and 9:16 rendered");
    assert.equal(v.decisions.software, "PENDING");
    assert.equal(v.summary.version, 1);
    // A plan that is not this delivery's still cannot touch it.
    assert.throws(() => t.hub.deliveries.startDirect(orphan.id, "ops_other"), /nu aparține planului/);
  } finally { await t.cleanup(); }
});
