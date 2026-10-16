// Milestone 11 „Ifrim Delivery” — Delivery Room UI (unit A9a: the screen, its panels and its pure logic; the route `#/livrare/:id`
// and the cockpit card are wired separately, so every part below drives the Room directly, with the JSON fixture or a fake client).
//
// Part A (pure, no browser, PASS_LOCAL): web/src/lib/deliveryLogic.js against the JSON fixture of the view contract
// (tests/fixtures/m11-delivery-view.json: READY after the reference clip revision, STALE after a workspace change) — honest evidence
// labels, the STALE banner, which players / screenshots / documents count as CURRENT evidence (a stale or superseded one never does,
// even if a status write were missed), the five separate decisions with the command each one sends (no publish), enabled states per
// owner session, acceptance disabled during a capture, marker timecodes, the phone-width wording, the summary diff and the ONE answer
// of a revision.
//
// Part B (source checks, no browser): every new .jsx parses (oxc, the transformer the build uses) and its relative imports resolve to
// real exports; the Room never fetches outside its client, never publishes, never embeds the preview.
//
// Part C (the real components, no browser): the Room is bundled for node into a throwaway temp folder (vite SSR build — nothing is
// written into the project, v2/web/dist is never touched) and rendered to static markup with the fixture: the six deliverables, the
// five decision groups, players only for current versions, the STALE banner, labelled controls. SKIPPED_ENV when vite / the React
// plugin cannot be loaded here.
//
// Part D (a REAL browser — headless Chromium through the project's Playwright; SKIPPED_ENV when it is missing): the same Room, built
// into the same throwaway temp folder and served from a loopback port chosen by the OS, driven with a FAKE client (no Hub, no model,
// nothing live): keyboard (Tab order, Enter sends the revision once, Shift+Enter is a new line), ONE clarification then ONE plan
// card, a double click on „Accept local” sends one request while every other write waits, unsaved summary edits refuse the approval,
// no horizontal overflow at 1280 px and at 390 px, old media is not requested until its collapsed block is opened, and
// http://127.0.0.1 is read-only with the way to http://localhost.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  deliveryRoute, deliveryHref, deliveryViewPath, deliveryListPath, deliveryActionPath, creativeDecisionPath, DELIVERY_ACTIONS, latestDelivery, deliveryReloadEvent,
  PHONE_WORDING, phoneWording, PHONE_CAVEAT, SYNTHETIC_BADGE, EVIDENCE_LABELS, evidenceLabel, evidenceChip, headerChips, isSimulated, verifyState,
  notCurrentReason, isCurrentEvidence, oldClipLabel, staleBanner, statusNotice, lineageLinks, safePreviewUrl, previewState, softwareCurrent, softwareView,
  isPhoneShot, safeShotSrc, shotRows, QA_KINDS, qaChips, clipLabelChip, creativeState, fmtClock, fmtDuration, markerRows, textItemRows, clipSlots, selectionFor,
  selectionValid, PLAYER_KEYS, LABEL_ITEM_ID, rightsView, versionChain, historyGroups, ownerSessionState, sessionGate, sessionLabel, SESSION_HINT, captureRunning, isCaptureStep,
  confirmationHint, CAPTURE_STEP_KIND, AUTO_SECTION_IDS, summaryApproval,
  DECISION_COMMANDS, DECISION_KEYS, PUBLISHING_ROW_TEXT, rightsHref, decisionRows, decisionGroups, decisionRequest, pendingDecisions, NOT_CONFIGURED_TEXT,
  SUMMARY_LIMITS, findPlaceholders, assertedFacts, summaryView, lineDiff, summaryDiff, summaryEditBody, bindableServices, REVISION_LIMITS, revisionAvailability,
  revisionBody, revisionOutcome, clarificationReply, revisionRows, planRows, repackageState, observationRows, spineTiles, currentEvidence, cockpitDeliveryCard, sentence,
} from "../web/src/lib/deliveryLogic.js";
import { NOT_CONFIGURED_TEXT as SALES_NOT_CONFIGURED } from "../web/src/lib/salesLogic.js";
import { groupDefects } from '../server/delivery/correction.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const V2 = path.resolve(here, "..");
const ROOT = path.resolve(V2, "..");
const source = (rel) => fs.readFileSync(path.join(V2, rel), "utf8");
const FIXTURE = JSON.parse(fs.readFileSync(path.join(here, "fixtures", "m11-delivery-view.json"), "utf8"));
const ready = () => structuredClone(FIXTURE.variants.READY);
const stale = () => structuredClone(FIXTURE.variants.STALE);

test("M11-UI-19 replacement links require a current descendant status in every UI path", () => {
  const view = stale(); view.delivery.childId = ready().delivery.id;
  for (const status of [null, "PLANNED", "STALE", "CLOSED", "CANCELLED", "EXPIRED", "FAILED"]) {
    view.delivery.childStatus = status;
    assert.equal(staleBanner(view).replacement, null);
    assert.ok(!lineageLinks(view).some(l => l.key === "child"));
    view.delivery.status = "CLOSED"; assert.equal(statusNotice(view).link, null); view.delivery.status = "STALE";
  }
  for (const status of ["READY", "ARMED", "ACTIVE", "NEEDS_OWNER"]) {
    view.delivery.childStatus = status;
    const label = status === "READY" ? "Deschide livrarea care o înlocuiește" : "Deschide livrarea nouă (în lucru)";
    assert.equal(staleBanner(view).replacement.label, label);
    assert.equal(lineageLinks(view).find(l => l.key === "child").label, label);
    view.delivery.status = "CLOSED"; assert.equal(statusNotice(view).link.label, label); view.delivery.status = "STALE";
  }
});
/** A changed copy of a variant. */
const variant = (base, change) => { const v = base(); change(v); return v; };
const rowOf = (view, key, ctx) => decisionRows(view, ctx).find((r) => r.key === key);
const UI_FILES = ["web/src/screens/DeliveryRoom.jsx", ...["SoftwarePanel", "PreviewPanel", "ClipPanel", "SummaryEditor", "DecisionsPanel", "ObservationsPanel"].map((n) => `web/src/screens/delivery/${n}.jsx`)];

// ---------------------------------------------------------------- Part A: pure logic against the fixture

test("M11-UI-01 the fixture holds exactly the documented view contract; routes and API paths accept only well-formed ids", () => {
  const keys = (o) => Object.keys(o).sort();
  for (const name of ["READY", "STALE"]) {
    const v = FIXTURE.variants[name];
    assert.deepEqual(keys(v), ["clip", "correction", "decisions", "delivery", "history", "observations", "plans", "preview", "revisions", "software", "summary"], `${name}: top-level keys`);
    assert.deepEqual(keys(v.delivery), ["childId", "childStatus", "generation", "id", "labels", "parentId", "projectId", "projectName", "status", "statusReason", "title", "verified"]);
    assert.deepEqual(keys(v.delivery.verified), ["at", "changedFiles", "equal"]);
    assert.deepEqual(keys(v.software), ["bundle", "changeSet", "criteria", "diff", "review", "spec", "tests"]);
    assert.deepEqual(keys(v.software.bundle), ["id", "sha", "shaPrefix", "status"]);
    assert.deepEqual(keys(v.software.tests[0]), ["command", "counts", "isolation", "runner", "status"]);
    assert.deepEqual(keys(v.software.criteria[0]), ["id", "note", "status", "text", "verify"]);
    assert.deepEqual(keys(v.preview), ["key", "running", "shots", "startCommand", "url"]);
    assert.deepEqual(keys(v.preview.shots[0]), ["criterion", "src", "status", "viewportLabel"]);
    assert.deepEqual(keys(v.clip), ["master", "rights", "vertical"]);
    for (const slot of ["master", "vertical"]) assert.deepEqual(keys(v.clip[slot]), ["assetVersionId", "creative", "durationMs", "editVersionId", "label", "markers", "qa", "src", "textItems"]);
    assert.deepEqual(keys(v.clip.master.qa), ["kinds", "status", "unjustified"]);
    assert.deepEqual(keys(v.summary), ["approval", "basis", "claimsToVerify", "documentId", "exports", "sections", "sha", "status", "version", "versions", "warnings"]);
    assert.deepEqual(keys(v.summary.sections[0]), ["heading", "id", "needsReview", "source", "text"]);
    assert.deepEqual(keys(v.decisions), ["creativeMaster", "creativeVertical", "publishing", "rightsPublic", "software", "summaryReady"]);
    assert.equal(v.decisions.publishing, "OFF");
    assert.deepEqual(keys(v.plans[0]), ["id", "kind", "status", "steps"]);
    assert.deepEqual(keys(v.history[0]), ["createdAt", "id", "kind", "role", "staleReason", "status", "supersedesId"]);
  }
  assert.deepEqual(keys(FIXTURE.variants.READY.revisions[0]), ["classes", "id", "planId", "source", "status", "text"]);

  assert.deepEqual(deliveryRoute("dlv_mv3k9q2a_7f3a9c1e2b", {}), { deliveryId: "dlv_mv3k9q2a_7f3a9c1e2b", projectId: null, invalid: false });
  assert.deepEqual(deliveryRoute(null, { projectId: "prj_abc123" }), { deliveryId: null, projectId: "prj_abc123", invalid: false });
  for (const bad of ["<script>", "../etc", "mis_abc123", "dlv_", "dlv_a b", "dlv_" + "x".repeat(90)]) assert.equal(deliveryRoute(bad, {}).invalid, true, `${bad} never reaches an API path`);
  assert.equal(deliveryRoute(null, { projectId: "a/b" }).projectId, null);
  assert.equal(deliveryHref("dlv_abc123"), "/livrare/dlv_abc123");
  assert.equal(deliveryViewPath("dlv_abc123"), "/api/deliveries/dlv_abc123");
  assert.equal(deliveryListPath("prj a&b"), "/api/deliveries?projectId=prj%20a%26b");
  assert.equal(deliveryActionPath("dlv_abc123", "softwareAccept"), "/api/deliveries/dlv_abc123/software-accept");
  assert.throws(() => deliveryActionPath("dlv_abc123", "publish"), /Acțiune necunoscută/);
  assert.equal(creativeDecisionPath("mev_1"), "/api/media/edit-versions/mev_1/decision");
  // One row per Hub command of the delivery service; nothing that publishes, uploads, releases or sends.
  assert.deepEqual(Object.values(DELIVERY_ACTIONS).map((a) => a.command).sort(), ["delivery.correction.propose", "delivery.package.propose", "delivery.preview.start", "delivery.preview.stop", "delivery.revise",
    "delivery.software.accept", "delivery.summary.approve", "delivery.summary.edit", "delivery.summary.service", "delivery.verify"]);
  for (const a of Object.values(DELIVERY_ACTIONS)) { assert.match(a.action, /^[a-z]+(-[a-z]+)*$/); assert.doesNotMatch(`${a.command} ${a.action}`, /publi|upload|release|manifest|send|post\b/i); }
  assert.deepEqual(Object.entries(DELIVERY_ACTIONS).filter(([, a]) => !a.session).map(([k]) => k).sort(), ["previewStop", "verify"], "only the fail-safe actions work without the owner session");

  assert.equal(latestDelivery({ deliveries: [{ id: "dlv_old111", createdAt: "2026-10-01T10:00:00Z" }, { id: "dlv_new222", createdAt: "2026-10-05T10:00:00Z" }, { id: "nope", createdAt: "2026-10-09T10:00:00Z" }] }), "dlv_new222");
  assert.equal(latestDelivery([]), null);
  assert.equal(latestDelivery(null), null);
  for (const type of ["delivery.updated", "factory.bundle.status", "factory.stage", "ops.plan.step", "media.render.done", "media.review.applied", "media.rights.revoked", "envelope.status", "sales.service.saved"]) assert.equal(deliveryReloadEvent({ type }), true, type);
  for (const type of ["run.activity.delta", "lega.voice", "backup.progress", ""]) assert.equal(deliveryReloadEvent({ type }), false, type);
  // With the view at hand: another delivery's events and another project's factory / envelope events are left alone; nothing is guessed.
  const shown = FIXTURE.variants.READY;
  assert.equal(deliveryReloadEvent({ type: "delivery.updated", scopeType: "delivery", scopeId: shown.delivery.id }, shown), true);
  assert.equal(deliveryReloadEvent({ type: "delivery.updated", scopeType: "delivery", scopeId: "dlv_other00001" }, shown), false);
  assert.equal(deliveryReloadEvent({ type: "factory.stage", scopeType: "mission", scopeId: "mis_x", projectId: "prj_other0001" }, shown), false);
  assert.equal(deliveryReloadEvent({ type: "factory.stage", scopeType: "mission", scopeId: "mis_x", projectId: shown.delivery.projectId }, shown), true);
  assert.equal(deliveryReloadEvent({ type: "factory.bundle.status", scopeType: "mission", scopeId: "mis_x", projectId: null }, shown), true, "an event that does not name its project still reloads");
  assert.equal(deliveryReloadEvent({ type: "media.render.done", scopeType: "media_render", scopeId: "mrj_1", projectId: "prj_other0001" }, shown), true, "the Studio is not project-bound");
});

test("M11-UI-02 honest evidence labels: unknown is never a pass, a simulation is at most PASS_SIMULATED, PASS_LIVE is never inferred, old evidence is never green", () => {
  assert.deepEqual([...EVIDENCE_LABELS], ["PASS_LOCAL", "PASS_SIMULATED", "PASS_LIVE", "FAIL", "BLOCKED", "NOT_RUN", "SKIPPED_ENV"]);
  for (const s of ["PASS", "PASS_EVIDENCE", "PASS_REVIEW", "PASS_LOCAL", "pass"]) assert.equal(evidenceLabel(s), "PASS_LOCAL", s);
  assert.equal(evidenceLabel("PASS_LIVE"), "PASS_LIVE", "only passed through when the Hub says it");
  assert.equal(evidenceLabel("PASS_SIMULATED"), "PASS_SIMULATED");
  for (const s of ["PASS", "PASS_EVIDENCE", "PASS_LOCAL", "PASS_LIVE"]) assert.equal(evidenceLabel(s, { simulation: true }), "PASS_SIMULATED", `${s} in a simulated delivery`);
  for (const s of ["FAIL", "FAILED", "REJECTED"]) assert.equal(evidenceLabel(s), "FAIL");
  for (const s of ["BLOCKED", "INCONCLUSIVE", "NEEDS_INSTALL_APPROVAL"]) assert.equal(evidenceLabel(s), "BLOCKED");
  for (const s of ["SKIPPED_ENV", "SKIPPED"]) assert.equal(evidenceLabel(s), "SKIPPED_ENV");
  for (const s of ["NOT_RUN", "NEVERIFICAT", "VERIFICARE_MANUALĂ", "", null, undefined, "OK", "PASSED?", "TRUE", 1, {}]) assert.equal(evidenceLabel(s), "NOT_RUN", `${String(s)} is not a pass`);
  for (const s of ["PASS", "FAIL", "weird", null]) assert.ok(EVIDENCE_LABELS.includes(evidenceLabel(s)));

  assert.deepEqual(evidenceChip("PASS"), { label: "PASS_LOCAL", tone: "ok", text: "PASS_LOCAL · trecut local", raw: "PASS", current: true });
  assert.equal(evidenceChip("PASS", { simulation: true }).text, "PASS_SIMULATED · trecut în simulare");
  assert.equal(evidenceChip("FAIL").tone, "error");
  const old = evidenceChip("PASS", { current: false });
  assert.equal(old.tone, "neutral", "old evidence is never green");
  assert.equal(old.text, "PASS_LOCAL · versiunea veche");

  // The Software panel of the fixture: every row labelled (the real spec: AC-1..AC-7, all with evidence).
  const sw = softwareView(ready());
  assert.deepEqual(sw.tests.map((t) => [t.evidence.label, t.countsText]), [["PASS_LOCAL", "9/9"], ["PASS_LOCAL", "7/7"]]);
  assert.deepEqual(sw.criteria.map((c) => [c.id, c.evidence.label, c.pass]), ["AC-1", "AC-2", "AC-3", "AC-4", "AC-5", "AC-6", "AC-7"].map((id) => [id, "PASS_LOCAL", true]));
  assert.deepEqual(sw.counts, { pass: 7, total: 7 });
  // A criterion the owner verifies by hand is NOT_RUN, never a pass.
  const manual = softwareView(variant(ready, (v) => { v.software.criteria.push({ id: "AC-9", text: "Textele sunt potrivite pentru o prezentare către client.", verify: "manual", status: "VERIFICARE_MANUALĂ", note: "Verifici tu la acceptare" }); }));
  assert.equal(manual.criteria.find((c) => c.id === "AC-9").evidence.label, "NOT_RUN");
  assert.equal(manual.criteria.find((c) => c.id === "AC-9").pass, false);
  assert.deepEqual(manual.counts, { pass: 7, total: 8 });
  assert.equal(softwareView(variant(ready, (v) => { v.software.tests[0].counts = null; })).tests[0].countsText, "—", "no counts → no invented progress");
  assert.equal(softwareView(variant(ready, (v) => { v.software.tests[0].counts = { tests: 7, pass: 5, fail: 2 }; })).tests[0].countsText, "5/7 · 2 picate");
  const sim = softwareView(variant(ready, (v) => { v.delivery.labels.push("SIMULATION"); }));
  assert.ok(sim.tests.every((t) => t.evidence.label === "PASS_SIMULATED"));
  assert.ok(sim.criteria.filter((c) => c.pass).every((c) => c.evidence.label === "PASS_SIMULATED"));
  // STALE: the same rows stay visible as OLD evidence.
  const oldSw = softwareView(stale());
  assert.equal(oldSw.current, false);
  assert.ok(oldSw.tests.every((t) => t.evidence.tone === "neutral" && /versiunea veche/.test(t.evidence.text)));
  assert.ok(oldSw.criteria.every((c) => c.evidence.tone === "neutral" && c.statusChip.tone === "neutral"));
  assert.deepEqual(oldSw.bundle.chip, { tone: "neutral", text: "acceptat local · versiunea veche" });
  assert.equal(oldSw.review.chip.tone, "neutral");
});

test("M11-UI-03 header: status in words, the synthetic-data badge always, SIMULARE only when simulated; „Verifică acum” shows equal ✓ / different ✗ with at most 20 files", () => {
  assert.deepEqual(headerChips(ready()).map((c) => c.text), ["Livrare gata", SYNTHETIC_BADGE]);
  assert.equal(SYNTHETIC_BADGE, "DATE SINTETICE · DEMO LOCAL");
  assert.equal(isSimulated(ready()), false);
  const sim = variant(ready, (v) => { v.delivery.labels = ["SIMULATION", "SYNTHETIC_DATA"]; v.delivery.generation = 2; });
  assert.deepEqual(headerChips(sim).map((c) => c.text), ["Livrare gata", "SIMULARE", SYNTHETIC_BADGE, "generația 2 de software"]);
  assert.equal(headerChips(stale())[0].tone, "error");
  assert.equal(headerChips(stale())[0].text, "Livrare învechită");
  assert.equal(headerChips(variant(ready, (v) => { v.delivery.status = "WHATEVER"; }))[0].tone, "neutral", "an unknown status is not painted as good");

  assert.deepEqual(verifyState(ready()), { known: true, equal: true, tone: "ok", text: "snapshot identic ✓", at: "2026-10-06T09:41:12.000Z", files: [], more: 0 });
  const diff = verifyState(stale());
  assert.equal(diff.equal, false);
  assert.equal(diff.text, "workspace diferit ✗ · 2 fișiere schimbate");
  assert.deepEqual(diff.files.map((f) => f.path), ["public/js/app.mjs", "public/styles.css"]);
  const many = verifyState(variant(stale, (v) => { v.delivery.verified.changedFiles = Array.from({ length: 27 }, (_, i) => ({ path: `src/f${i}.js`, status: "modified" })); }));
  assert.equal(many.files.length, 20);
  assert.equal(many.more, 7);
  assert.equal(verifyState(variant(ready, (v) => { v.delivery.verified = {}; })).text, "neverificat încă");
  assert.equal(verifyState({}).known, false);
});

test("M11-UI-04 the STALE banner: reason, changed files, what it means and a link only to a replacement that exists; READY has none", () => {
  assert.equal(staleBanner(ready()), null);
  const b = staleBanner(stale());
  assert.equal(b.tone, "error");
  assert.equal(b.title, "Livrare învechită");
  assert.equal(b.reason, "software-ul s-a schimbat: workspace-ul diferă de versiunea testată (2 fișiere)");
  assert.deepEqual(b.files.map((f) => f.path), ["public/js/app.mjs", "public/styles.css"]);
  assert.match(b.consequence, /bnd_mv3k1p0z_0d9e8f7a6b/);
  assert.match(b.consequence, /nu sunt dovezi pentru codul de acum/);
  assert.equal(b.replacement, null, "no child delivery → no invented link");
  const replaced = staleBanner(variant(stale, (v) => { v.delivery.childId = "dlv_mv4a1b2c_9d8e7f6a5b"; v.delivery.childStatus = "READY"; }));
  assert.deepEqual(replaced.replacement, { id: "dlv_mv4a1b2c_9d8e7f6a5b", href: "#/livrare/dlv_mv4a1b2c_9d8e7f6a5b", label: "Deschide livrarea care o înlocuiește" });
  assert.equal(staleBanner(variant(stale, (v) => { v.delivery.childId = "javascript:alert(1)"; })).replacement, null);
  // Drift seen by verify while the status still says READY (a missed write): the banner is there anyway.
  const drift = staleBanner(variant(ready, (v) => { v.delivery.verified = { at: "2026-10-06T12:00:00Z", equal: false, changedFiles: ["public/js/slots-view.mjs"] }; }));
  assert.equal(drift.title, "Workspace-ul diferă de versiunea verificată");
  assert.deepEqual(drift.files.map((f) => f.path), ["public/js/slots-view.mjs"]);
  assert.equal(staleBanner(variant(stale, (v) => { v.delivery.statusReason = ""; })).reason, "workspace-ul diferă de versiunea testată");
  // The Hub writes reasons as clauses; the Room shows them as sentences (diacritics included) without changing their words.
  assert.equal(sentence(b.reason), "Software-ul s-a schimbat: workspace-ul diferă de versiunea testată (2 fișiere).");
  assert.equal(sentence("înlocuită de livrarea nouă."), "Înlocuită de livrarea nouă.");
  assert.equal(sentence("  "), "");
  assert.equal(sentence(null), "");

  assert.equal(statusNotice(ready()), null);
  assert.equal(statusNotice(variant(ready, (v) => { v.delivery.status = "NEEDS_OWNER"; v.delivery.statusReason = "planul s-a oprit: sesiunea s-a închis"; })).text, "planul s-a oprit: sesiunea s-a închis");
  const closed = statusNotice(variant(ready, (v) => { v.delivery.status = "CLOSED"; v.delivery.childId = "dlv_mv4a1b2c_9d8e7f6a5b"; v.delivery.childStatus = "READY"; }));
  assert.equal(closed.link.href, "#/livrare/dlv_mv4a1b2c_9d8e7f6a5b");
  assert.deepEqual(lineageLinks(ready()), []);
  assert.deepEqual(lineageLinks(variant(ready, (v) => { v.delivery.parentId = "dlv_parent01"; })).map((l) => l.href), ["#/livrare/dlv_parent01"]);
});

test("M11-UI-05 current evidence: READY shows current players and screenshots; a STALE or superseded item is never presented as current — even when a status write was missed", () => {
  assert.deepEqual(currentEvidence(ready()), { software: true, shots: ["AC-6", "AC-7"], clips: ["master", "vertical"], summary: true });
  const r = clipSlots(ready());
  assert.deepEqual(r.map((s) => [s.key, s.mode, s.evidence, s.playable, s.collapsedLabel]), [["master", "current", true, true, ""], ["vertical", "current", true, true, ""]]);

  // STALE variant: nothing counts; both players sit behind the „old version” label; the screenshots and the summary are old too.
  const sView = stale();
  assert.deepEqual(currentEvidence(sView), { software: false, shots: [], clips: [], summary: false });
  const s = clipSlots(sView);
  assert.deepEqual(s.map((x) => x.mode), ["old", "old"]);
  assert.ok(s.every((x) => x.evidence === false));
  assert.equal(s[0].collapsedLabel, "Clip pentru versiunea veche (bnd_mv3k1p0z_0d9e8f7a6b) — nu dovedește codul nou");
  assert.equal(oldClipLabel(sView), s[0].collapsedLabel);
  assert.equal(oldClipLabel({}), "Clip pentru versiunea veche (bnd_…) — nu dovedește codul nou");
  assert.ok(shotRows(sView).every((row) => row.current === false && row.evidence.tone === "neutral" && /versiunea veche/.test(row.alt)));
  assert.equal(summaryView(sView).current, false);
  assert.deepEqual(summaryView(sView).exports, [], "no export links for an old summary");
  assert.equal(softwareCurrent(sView), false);
  assert.equal(notCurrentReason(sView, sView.clip.master).code, "DELIVERY_STALE");
  assert.equal(isCurrentEvidence(sView, sView.clip.master), false);

  // Each guard stands alone. The delivery status by itself (verify still says „equal”: a new bundle replaced the old one):
  const statusOnly = variant(ready, (v) => { v.delivery.status = "STALE"; v.delivery.statusReason = "pachetul a fost înlocuit de unul nou"; });
  assert.deepEqual(currentEvidence(statusOnly), { software: false, shots: [], clips: [], summary: false }, "the delivery status alone is enough");
  assert.deepEqual(notCurrentReason(statusOnly, statusOnly.clip.master), { code: "DELIVERY_STALE", text: "pachetul a fost înlocuit de unul nou" });
  // Guards that do not depend on the delivery status having been written.
  const drift = variant(ready, (v) => { v.delivery.verified.equal = false; });
  assert.deepEqual(currentEvidence(drift), { software: false, shots: [], clips: [], summary: false }, "verify saw another workspace");
  assert.equal(notCurrentReason(drift, drift.clip.master).code, "SNAPSHOT_DIFFERS");
  const itemStale = variant(ready, (v) => { v.clip.master.itemStatus = "STALE"; v.clip.master.staleReason = "drepturile materialului au fost revocate"; v.clip.master.staleCode = "RIGHTS_REVOKED"; });
  assert.deepEqual(clipSlots(itemStale).map((x) => x.mode), ["old", "current"], "one stale item does not hide the other format");
  assert.deepEqual(notCurrentReason(itemStale, itemStale.clip.master), { code: "RIGHTS_REVOKED", text: "drepturile materialului au fost revocate" });
  assert.deepEqual(currentEvidence(itemStale).clips, ["vertical"]);
  const superseded = clipSlots(variant(ready, (v) => { v.clip.vertical.itemStatus = "SUPERSEDED"; }))[1];
  assert.equal(superseded.mode, "old");
  assert.equal(superseded.collapsedLabel, "Versiune înlocuită (v2) — există una mai nouă");
  const invalidated = clipSlots(variant(ready, (v) => { v.clip.vertical.itemStatus = "INVALIDATED"; }))[1];
  assert.equal(invalidated.mode, "old");
  const mismatch = variant(ready, (v) => { v.delivery.snapshotSha = "aaaaaaaaaaaaaaaa1111"; v.clip.master.snapshotSha = "bbbbbbbbbbbbbbbb2222"; v.clip.vertical.snapshotShaPrefix = "aaaaaaaaaaaa"; });
  assert.deepEqual(clipSlots(mismatch).map((x) => x.mode), ["old", "current"], "an item made from another snapshot is never current; a matching prefix is");
  assert.equal(notCurrentReason(mismatch, mismatch.clip.master).code, "SNAPSHOT_MISMATCH");
  for (const status of ["CLOSED", "CANCELLED", "EXPIRED", "FAILED"]) assert.deepEqual(currentEvidence(variant(ready, (v) => { v.delivery.status = status; })).clips, [], status);
  assert.equal(notCurrentReason(ready(), null).code, "MISSING");
  assert.equal(isCurrentEvidence(ready(), undefined), false);

  // A QA FAIL does not hide the clip — and it never counts as evidence.
  const failed = variant(ready, (v) => { v.clip.master.qa.status = "FAIL"; v.clip.master.qa.kinds.factual = "FAIL"; });
  const fm = clipSlots(failed)[0];
  assert.equal(fm.mode, "current", "still shown openly, with its findings");
  assert.equal(fm.evidence, false);
  assert.match(fm.evidenceNote, /nu contează ca dovadă/);
  assert.equal(isCurrentEvidence(failed, failed.clip.master), false);
  assert.deepEqual(currentEvidence(failed).clips, ["vertical"]);
  // A current version without a render (corrected in Studio, not rendered yet): nothing to show as evidence.
  const noRender = clipSlots(variant(ready, (v) => { v.clip.master.assetVersionId = null; }))[0];
  assert.deepEqual([noRender.mode, noRender.playable, noRender.evidence], ["current", false, false]);
  assert.equal(clipSlots({})[0].mode, "missing");
  // A stale bundle / a rejected bundle: the software is not current evidence either.
  assert.equal(softwareCurrent(variant(ready, (v) => { v.software.bundle.status = "STALE"; })), false);
  assert.equal(softwareCurrent(variant(ready, (v) => { v.software.bundle.status = "REJECTED"; })), false);
});

test("M11-UI-06 five separate decisions → distinct commands; publishing has no command, no request and no button, whatever the view says", () => {
  const view = ready();
  const groups = decisionGroups(view, { session: "open" });
  assert.deepEqual(groups.map((g) => g.key), ["software", "creative", "rights", "summary", "publishing"], "FIVE decisions");
  assert.deepEqual(groups.map((g) => g.rows.map((r) => r.key)), [["software"], ["creativeMaster", "creativeVertical"], ["rightsPublic"], ["summaryReady"], ["publishing"]]);
  assert.deepEqual([...DECISION_KEYS], ["software", "creativeMaster", "creativeVertical", "rightsPublic", "summaryReady", "publishing"]);

  const actionable = DECISION_KEYS.filter((k) => k !== "publishing");
  const requests = actionable.map((k) => decisionRequest(view, k, { session: "open" }));
  assert.deepEqual(requests.map((r) => r.command), ["delivery.software.accept", "media.review.decide", "media.review.decide", "media.rights.record", "delivery.summary.approve"]);
  assert.deepEqual(actionable.map((k) => DECISION_COMMANDS[k]), requests.map((r) => r.command));
  assert.equal(new Set(requests.map((r) => r.command)).size, 4, "creative approval is one command, sent per version");
  assert.equal(new Set(requests.map((r) => JSON.stringify([r.path || r.href, r.body || null]))).size, 5, "five distinct dispatches");
  assert.deepEqual(requests[0], { command: "delivery.software.accept", method: "POST", path: "/api/deliveries/dlv_mv3k9q2a_7f3a9c1e2b/software-accept", body: { bundleId: "bnd_mv3k1p0z_0d9e8f7a6b", displayedBundleSha: "4c1f0a9be27d0000000000000000000000000000000000000000000000000000" } });
  assert.deepEqual(requests[1], { command: "media.review.decide", method: "POST", path: "/api/media/edit-versions/mev_mv3m2a9c_b2b2b2b2b2/decision", body: { kind: "CREATIVE_APPROVED", note: "" } });
  assert.equal(requests[2].path, "/api/media/edit-versions/mev_mv3m4k7e_d2d2d2d2d2/decision", "the vertical is approved on ITS edit version");
  assert.deepEqual(requests[3], { command: "media.rights.record", href: "#/studio/library" }, "rights are recorded in the existing Studio UI, not sent from the Room");
  assert.deepEqual(requests[4], { command: "delivery.summary.approve", method: "POST", path: "/api/deliveries/dlv_mv3k9q2a_7f3a9c1e2b/summary-approve",
    body: { documentId: "ddoc_mv3m6t1g_f2f2f2f2f2", version: 2, displayedSha: "7d0c3b5a9e1f42866b0a4d1c8e3f5a7b9c0d2e4f6a8b1c3d5e7f9a0b2c4d6e8f" } });
  // When the view carries the full bundle sha, that is what the acceptance is bound to.
  const full = variant(ready, (v) => { v.software.bundle.sha = "4c1f0a9be27d".padEnd(64, "0"); });
  assert.equal(decisionRequest(full, "software").body.displayedBundleSha, "4c1f0a9be27d".padEnd(64, "0"));
  assert.equal(rightsHref(variant(ready, (v) => { v.delivery.contentProjectId = "cpr_abc123"; })), "#/studio/cpr_abc123?sub=rights");
  assert.equal(rightsHref(variant(ready, (v) => { v.delivery.contentProjectId = "x\"><script>"; })), "#/studio/library");

  // Publishing: nothing to click, in every state the Hub could ever report.
  assert.equal(DECISION_COMMANDS.publishing, null);
  assert.equal(PUBLISHING_ROW_TEXT, "Publicare: oprită (politica media; nu se face din Hub în M11)");
  for (const value of ["OFF", "ON", "READY", "APPROVED", { state: "ON" }, null, undefined]) {
    const v = variant(ready, (x) => { x.decisions.publishing = value; });
    const row = rowOf(v, "publishing", { session: "open" });
    assert.equal(row.action, null, `publishing=${JSON.stringify(value)} → no action`);
    assert.equal(row.state, "OFF");
    assert.equal(row.title, PUBLISHING_ROW_TEXT);
    assert.equal(decisionRequest(v, "publishing"), null);
  }
  assert.match(rowOf(variant(ready, (x) => { x.decisions.publishing = "ON"; }), "publishing").anomaly, /tot nu publică nimic/);
  assert.equal(rowOf(view, "publishing").anomaly, "");
  for (const r of decisionRows(view)) assert.doesNotMatch(JSON.stringify(r.action || {}), /publish|upload|manifest|release/i);
  // Every row says what it does NOT mean.
  for (const r of decisionRows(view)) assert.ok(r.doesNot.length > 20, r.key);
  assert.equal(pendingDecisions(view), 4, "„Ai patru decizii separate”: rights are optional for an internal presentation");
});

test("M11-UI-07 the decisions are independent: changing ONE record changes only ITS row", () => {
  const ctx = { session: "open" };
  const base = decisionRows(ready(), ctx);
  const changes = {
    software: (v) => { v.software.bundle.status = "OWNER_ACCEPTED"; v.decisions.software = "ACCEPTED"; },
    creativeMaster: (v) => { v.clip.master.creative = "CREATIVE_APPROVED"; v.decisions.creativeMaster = "CREATIVE_APPROVED"; },
    creativeVertical: (v) => { v.clip.vertical.creative = "CREATIVE_APPROVED"; v.decisions.creativeVertical = "CREATIVE_APPROVED"; },
    rightsPublic: (v) => { for (const s of v.clip.rights.public) s.state = "CLEARED_FOR_SCOPE"; v.decisions.rightsPublic = "RECORDED"; },
    summaryReady: (v) => { v.summary.approval = { kind: "PRESENTATION_READY", sha: v.summary.sha, at: "2026-10-06T10:00:00Z" }; v.decisions.summaryReady = "APPROVED"; },
  };
  for (const [key, change] of Object.entries(changes)) {
    const rows = decisionRows(variant(ready, change), ctx);
    const mine = rows.find((r) => r.key === key);
    assert.equal(mine.state, "DONE", `${key} is done`);
    assert.equal(mine.action?.kind === "command" ? mine.action : null, null, `${key}: a decision already taken has no button`);
    for (const other of rows.filter((r) => r.key !== key)) assert.deepEqual(other, base.find((r) => r.key === other.key), `${key} done must not change ${other.key}`);
  }
  // All four taken: publishing is still OFF and still has nothing to click.
  const all = variant(ready, (v) => { for (const change of Object.values(changes)) change(v); });
  assert.deepEqual(decisionRows(all, ctx).map((r) => r.state), ["DONE", "DONE", "DONE", "DONE", "DONE", "OFF"]);
  assert.equal(rowOf(all, "publishing", ctx).action, null);
  assert.equal(pendingDecisions(all), 0);
  // The summary block alone never produces a decision the record does not show.
  const claimedOnly = variant(ready, (v) => { v.decisions = { software: "ACCEPTED", creativeMaster: "CREATIVE_APPROVED", creativeVertical: "CREATIVE_APPROVED", rightsPublic: "RECORDED", summaryReady: "APPROVED", publishing: "OFF" }; });
  assert.deepEqual(decisionRows(claimedOnly, ctx).map((r) => r.state), ["PENDING", "PENDING", "PENDING", "PENDING", "PENDING", "OFF"], "the records decide, not the summary block");
});

test("M11-UI-08 enabled states: owner session wording, one write at a time, acceptance disabled during a capture, stale and unsaved edits refuse, approvals bound to the displayed sha / version", () => {
  // Session.
  assert.equal(ownerSessionState({ session: { id: "os_1" } }), "open");
  assert.equal(ownerSessionState({ session: null }), "closed");
  assert.equal(ownerSessionState(null), "closed");
  assert.equal(ownerSessionState({ bootstrapNeeded: true }), "unconfigured");
  assert.equal(ownerSessionState({ session: { id: "os_1" } }, { onLocalhost: false }), "unavailable");
  assert.equal(SESSION_HINT, "deschide sesiunea (Windows Hello)");
  assert.equal(sessionLabel("Accept local", "open"), "Accept local");
  assert.equal(sessionLabel("Accept local", "closed"), "Accept local — deschide sesiunea (Windows Hello)");
  assert.equal(sessionGate("closed").blocked, false, "a closed session is opened by the click, not refused");
  assert.equal(sessionGate("unavailable").blocked, true);

  const view = ready();
  const open = rowOf(view, "software", { session: "open" }).action;
  assert.deepEqual([open.enabled, open.label, open.needsSession, open.reason], [true, "Accept local", true, ""]);
  const closed = rowOf(view, "software", { session: "closed" }).action;
  assert.deepEqual([closed.enabled, closed.label], [true, "Accept local — deschide sesiunea (Windows Hello)"], "the button says what it needs instead of failing");
  const away = rowOf(view, "software", { session: "unavailable" }).action;
  assert.equal(away.enabled, false);
  assert.match(away.reason, /http:\/\/localhost/);
  assert.equal(rowOf(view, "summaryReady", { session: "unconfigured" }).action.enabled, false);
  for (const key of ["software", "creativeMaster", "creativeVertical", "summaryReady"]) assert.equal(rowOf(view, key, { session: "open", busy: true }).action.enabled, false, `${key}: one write at a time`);
  assert.equal(rowOf(view, "creativeMaster", { session: "open" }).action.fresh, true, "creative approval asks Windows Hello every time");
  assert.equal(rowOf(view, "rightsPublic", { session: "closed" }).action.kind, "link", "the rights link needs no session here");

  // Acceptance waits for captures. The steps are the REAL ones of the package plan (the fixture mirrors template.mjs packageSteps):
  // „Filmează demo-ul pe desktop (1280×720, date sintetice, browser izolat)” — first as the documented contract sends a step
  // ({ seq, title, status }: the title alone must be enough), then with the step kind.
  const realSteps = FIXTURE.variants.READY.plans[0].steps;
  assert.deepEqual(realSteps.filter((st) => st.kind === CAPTURE_STEP_KIND).map((st) => st.seq), [3, 4]);
  assert.match(realSteps[2].title, /^Filmează demo-ul pe desktop/);
  /** A RUNNING package plan whose step `seq` is the one running; `strip` drops the kinds (the title-only contract). */
  const runningAt = (seq, { strip = false, status = "RUNNING" } = {}) => variant(ready, (v) => {
    v.plans.push({ id: "opp_mv3z9y8x_3030303030", kind: "delivery.package", status,
      steps: realSteps.map((st) => { const step = { ...st, status: st.seq < seq ? "DONE" : st.seq === seq ? "RUNNING" : "PENDING" }; if (strip) delete step.kind; return step; }) });
  });
  for (const strip of [true, false]) {
    assert.deepEqual(realSteps.map((st) => captureRunning(runningAt(st.seq, { strip }))), [false, false, true, true, false, false, false, false, false, false],
      `${strip ? "title only" : "with kinds"}: exactly the two capture steps — not the montage built „din cele două capturi”`);
  }
  const capturing = runningAt(3, { strip: true });
  assert.equal(captureRunning(capturing), true);
  const waiting = rowOf(capturing, "software", { session: "open" }).action;
  assert.equal(waiting.enabled, false);
  assert.match(waiting.reason, /Aștept capturile sau oprește planul/);
  assert.equal(rowOf(runningAt(4), "software", { session: "open" }).action.enabled, false, "the phone-width capture blocks too");
  assert.equal(rowOf(capturing, "creativeMaster", { session: "open" }).action.enabled, true, "only the acceptance waits for the capture");
  assert.equal(rowOf(runningAt(5, { strip: true }), "software", { session: "open" }).action.enabled, true, "the montage step does not block the acceptance");
  assert.equal(captureRunning(ready()), false, "a finished capture step does not block");
  assert.equal(captureRunning(runningAt(3, { status: "PAUSED" })), false, "a paused plan is not filming");
  assert.equal(captureRunning(runningAt(3, { status: "CONFIRMED" })), true);
  // No step of a clip revision records the screen.
  const revising = FIXTURE.variants.READY.plans[1].steps;
  for (const strip of [true, false]) assert.ok(revising.every((st) => !isCaptureStep(strip ? { title: st.title } : st)), "a revision never captures");
  // The Hub's kind decides whenever a step has one; the title is read only for a step without a kind.
  assert.equal(CAPTURE_STEP_KIND, "delivery.capture");
  assert.equal(isCaptureStep({ kind: "delivery.capture", title: "x" }), true, "the step kind is enough");
  assert.equal(isCaptureStep({ kind: "media.render", title: "Captură desktop (1280×720)" }), false, "a render is not a capture, whatever its title says");
  assert.equal(isCaptureStep({ kind: "delivery.edit.build", title: "Filmează" }), false);
  // Titles, without diacritics and in any case: the step's own action is a capture word.
  for (const title of ["Filmează demo-ul pe desktop", "FILMEAZA demo-ul", "Filmez ecranul", "Captură desktop (1280×720)", "Captura la lățimea unui telefon", "Pornesc captura desktop", "Capturez desktopul",
    "Înregistrez demo-ul", "Inregistreaza demo-ul", "Înregistrare desktop", "Capturi: desktop și lățimea unui telefon"]) assert.equal(isCaptureStep({ title }), true, title);
  for (const title of ["Construiește montajul 16:9 din cele două capturi (fără model)", "Montez clipul din capturi și din faptele verificate", "Randare finală 16:9 + QA", "Randează filmul", "Exportă local cele două clipuri",
    "Leagă dovezile de versiunea verificată și încheie livrarea", "", null, undefined, 7]) assert.equal(isCaptureStep({ title }), false, String(title));
  assert.equal(isCaptureStep(null), false);

  // Software: only a bundle that waits for acceptance and still matches the code.
  assert.match(rowOf(variant(ready, (v) => { v.software.bundle.status = "STALE"; }), "software").action.reason, /nu mai corespunde codului/);
  assert.match(rowOf(variant(ready, (v) => { v.delivery.verified.equal = false; }), "software").action.reason, /workspace-ul diferă/);
  assert.match(rowOf(variant(ready, (v) => { v.software.bundle = {}; }), "software").action.reason, /Nu există încă un pachet/);
  assert.equal(rowOf(variant(ready, (v) => { v.software.bundle.status = "REJECTED"; }), "software").state, "REJECTED");
  assert.equal(rowOf(variant(ready, (v) => { v.software.bundle.status = "REJECTED"; }), "software").action, null);
  assert.equal(rowOf(variant(ready, (v) => { v.software.bundle.sha = ""; }), "software", { session: "open" }).action.enabled, false, "a prefix cannot bind acceptance to the displayed bundle");
  assert.equal(rowOf(variant(ready, (v) => { v.software.bundle.mismatch = true; }), "software", { session: "open" }).action.enabled, false, "a delivery bound to an older bundle cannot accept the latest one");

  // STALE variant: the past acceptance is historical, nothing new can be approved on old material.
  const sView = stale();
  const sRows = decisionRows(sView, { session: "open" });
  assert.deepEqual(sRows.map((r) => r.state), ["DONE", "DONE", "PENDING", "PENDING", "VOID", "OFF"]);
  assert.deepEqual(sRows[0].chip, { tone: "neutral", text: "acceptat local · pentru versiunea veche" });
  assert.equal(sRows[1].chip.text, "creație aprobată · pentru versiunea veche");
  assert.equal(sRows[2].action.enabled, false);
  assert.match(sRows[2].action.reason, /versiunea veche/);
  assert.equal(sRows[4].chip.text, "aprobarea era pentru versiunea veche");
  assert.equal(sRows[4].action.enabled, false);
  assert.match(sRows[4].action.reason, /refuzate până la o versiune nouă/);

  // Summary: approval bound to the displayed sha; unsaved edits refuse.
  assert.deepEqual(summaryApproval(view), { state: "none", text: "neaprobat" });
  const approved = variant(ready, (v) => { v.summary.approval = { kind: "PRESENTATION_READY", sha: v.summary.sha, at: "2026-10-06T10:00:00Z" }; });
  assert.equal(summaryApproval(approved).state, "approved");
  const otherSha = variant(ready, (v) => { v.summary.approval = { kind: "PRESENTATION_READY", sha: "f".repeat(64), at: "2026-10-06T10:00:00Z" }; });
  assert.equal(summaryApproval(otherSha).state, "other_version");
  const otherRow = rowOf(otherSha, "summaryReady", { session: "open" });
  assert.equal(otherRow.state, "PENDING", "an approval of another sha is not an approval of what is displayed");
  assert.equal(otherRow.chip.tone, "warn");
  assert.equal(otherRow.action.enabled, true);
  const dirty = rowOf(view, "summaryReady", { session: "open", summaryDirty: true }).action;
  assert.equal(dirty.enabled, false);
  assert.match(dirty.reason, /modificări nesalvate/);
  assert.equal(rowOf(variant(ready, (v) => { v.summary.status = "SUPERSEDED"; }), "summaryReady", { session: "open" }).action.enabled, false);

  // Creative: per version. An approval recorded for another edit version does not carry over; QA does not gate it but is said.
  const carried = variant(ready, (v) => { v.clip.master.creative = "CREATIVE_APPROVED"; v.decisions.creativeMaster = { state: "CREATIVE_APPROVED", editVersionId: "mev_mv3k0old_a1a1a1a1a1" }; });
  assert.equal(rowOf(carried, "creativeMaster", { session: "open" }).state, "PENDING", "v1's approval is not v2's");
  const qaFail = variant(ready, (v) => { v.clip.master.qa.status = "FAIL"; });
  const qaRow = rowOf(qaFail, "creativeMaster", { session: "open" }).action;
  assert.equal(qaRow.enabled, true, "the automated QA and the creative review are never merged");
  assert.match(qaRow.caution, /QA automat: picat/);
  assert.equal(rowOf(variant(ready, (v) => { v.clip.master = {}; }), "creativeMaster", { session: "open" }).action.enabled, false);
  assert.equal(rowOf(variant(ready, (v) => { v.clip.master.creative = "REJECTED"; }), "creativeMaster").state, "REJECTED");
  assert.equal(creativeState("CREATIVE_REVIEW_PENDING"), "PENDING");
  assert.equal(creativeState("whatever"), "PENDING", "anything unknown is still the owner's to decide");
  assert.equal(creativeState({ state: "CREATIVE_APPROVED" }), "APPROVED");
});

test("M11-UI-09 the clip: six QA chips, labels, marker timecodes that seek, text items in frames, selection only on the current version", () => {
  assert.equal(fmtClock(0), "0:00");
  assert.equal(fmtClock(10000), "0:10");
  assert.equal(fmtClock(18400), "0:18,4");
  assert.equal(fmtClock(75000), "1:15");
  assert.equal(fmtClock(59960), "1:00", "rounds to tenths, carries into the next second");
  assert.equal(fmtClock(3723400), "62:03,4");
  for (const bad of [null, undefined, "", -1, NaN, "x", true]) assert.equal(fmtClock(bad), "—", `fmtClock(${String(bad)})`);
  assert.equal(fmtDuration(37400), "37,4 s");
  assert.equal(fmtDuration(null), "—");

  const master = ready().clip.master;
  const markers = markerRows(master);
  assert.deepEqual(markers.map((m) => [m.clock, m.ms, m.label]), [["0:00", 0, "capitol — intro"], ["0:03,2", 3200, "demonstrație — programare desktop"], ["0:10", 10000, "demonstrație — programare mobil"],
    ["0:21,5", 21500, "dovadă — interval ocupat pe telefon"], ["0:34,9", 34900, "îndemn final"]]);
  // The clip's last marker is cta „final” (clip-ir.mjs): a note that only repeats the kind's own word is not said twice; another note is kept.
  assert.equal(master.markers.at(-1).note, "final");
  assert.deepEqual(markerRows({ markers: [{ kind: "cta", note: "", ms: 1 }, { kind: "cta", note: "Final", ms: 2 }, { kind: "cta", note: "sunați-ne", ms: 3 }] }).map((m) => m.label), ["îndemn final", "îndemn final", "îndemn final — sunați-ne"]);
  assert.equal(markers[2].aria, "Mergi la 0:10: demonstrație — programare mobil");
  const messy = markerRows({ durationMs: 20000, markers: [{ kind: "cta", ms: 19000 }, { kind: "demo", note: "x", ms: null }, { kind: "demo", ms: -5 }, { kind: "demo", ms: "abc" }, { kind: "chapter", note: "a", ms: 1000 }, { kind: "demo", ms: 25000 }, { kind: "zzz", ms: 1000 }] });
  assert.deepEqual(messy.map((m) => [m.ms, m.kindLabel]), [[1000, "capitol"], [1000, "zzz"], [19000, "îndemn final"]], "sorted, stable; null / negative / non-numeric / beyond the end dropped");
  assert.deepEqual(markerRows(null), []);

  const texts = textItemRows(master);
  assert.deepEqual(texts.map((t) => [t.id, t.range, t.selectable]), [["l-data", "0:00–0:37,4", false], ["t-hook", "0:00–0:03", true], ["t-desktop", "0:03,2–0:08", true], ["t-mobile", "0:21,5–0:27", true], ["t-cta", "0:34,9–0:37,4", true]]);
  // The mandatory label is known by its real id too (clip-ir.mjs LABEL_ITEM_ID), whatever its text or style says.
  assert.equal(LABEL_ITEM_ID, "l-data");
  assert.deepEqual(textItemRows({ textItems: [{ id: "l-data", text: "Demo", start: 0, end: 30 }, { id: "t-label-2", text: "Demo", start: 0, end: 30 }, { id: "t-x1", text: "Demo", style: "label", start: 0, end: 30 }] }).map((t) => t.selectable), [false, false, false]);
  assert.equal(textItemRows({ fps: { num: 25, den: 1 }, textItems: [{ id: "t-a11", text: "x", start: 25, end: 50 }] })[0].range, "0:01–0:02", "frames are read at the clip's fps");
  assert.equal(textItemRows({ textItems: [{ id: "t-a11", text: "x", startMs: 1500, endMs: 2500, start: 999, end: 999 }] })[0].range, "0:01,5–0:02,5", "milliseconds win when the view sends them");
  assert.equal(textItemRows({ textItems: [{ id: "bad id!", text: "x", start: 0, end: 1 }, { id: "t-sim", text: "SIMULARE · DATE SINTETICE", start: 0, end: 1 }] }).map((t) => t.selectable).join(), "false", "unsafe ids dropped; a disclosure label is never a target");

  const qa = qaChips(ready().clip.vertical.qa);
  assert.deepEqual(QA_KINDS.slice(), ["technical", "layout", "editorial", "legibility", "factual", "rights"]);
  assert.deepEqual(qa.kinds.map((k) => k.text), ["tehnic: PASS", "încadrare: WARN", "editorial: PASS", "lizibilitate: PASS", "factual: PASS", "drepturi: PASS"]);
  assert.deepEqual([qa.status, qa.tone, qa.text], ["WARN", "warn", "QA automat: WARN"]);
  assert.deepEqual(qa.unjustified.map((f) => [f.kindLabel, f.code]), [["încadrare", "EVIDENCE_REQUIRES_LETTERBOX"]]);
  assert.deepEqual(qaChips(null).kinds.map((k) => k.status), Array(6).fill("NOT_RUN"), "no report → six honest NOT_RUN chips");
  assert.equal(qaChips({ status: "GREAT" }).status, "NOT_RUN");
  assert.deepEqual(qaChips({ status: "PASS", kinds: [{ kind: "technical", status: "PASS" }] }).kinds.map((k) => k.status), ["PASS", "NOT_RUN", "NOT_RUN", "NOT_RUN", "NOT_RUN", "NOT_RUN"]);
  assert.deepEqual(clipLabelChip("SIMULATION"), { tone: "warn", text: "SIMULARE" });
  assert.equal(clipLabelChip("ORIGINAL_RECORDING").text, "ÎNREGISTRARE ORIGINALĂ a demo-ului local");
  assert.equal(clipLabelChip("").text, "fără etichetă");

  // Selection: a content text of the CURRENT version only.
  const view = ready();
  const [m, vert] = clipSlots(view);
  // The selection names the player it was picked in: the same text id (t-hook) exists in the 16:9 clip and in the 9:16 one.
  assert.deepEqual([...PLAYER_KEYS], ["master", "vertical"]);
  assert.deepEqual(selectionFor(m, "t-hook"), { kind: "text", id: "t-hook", versionId: "mev_mv3m2a9c_b2b2b2b2b2", player: "master" });
  assert.deepEqual(selectionFor(vert, "t-hook"), { kind: "text", id: "t-hook", versionId: "mev_mv3m4k7e_d2d2d2d2d2", player: "vertical" });
  assert.equal(selectionFor(m, "l-data"), null, "the mandatory label is never selected");
  assert.equal(selectionFor(m, "t-nope"), null);
  assert.equal(selectionValid(view, { kind: "text", id: "t-hook", versionId: "mev_mv3m2a9c_b2b2b2b2b2" }), true);
  assert.equal(selectionValid(view, selectionFor(m, "t-hook")), true);
  assert.equal(selectionValid(view, selectionFor(vert, "t-hook")), true);
  assert.equal(selectionValid(view, { ...selectionFor(m, "t-hook"), player: "vertical" }), false, "a 16:9 version is not in the 9:16 player");
  assert.equal(selectionValid(view, { ...selectionFor(m, "t-hook"), player: "summary" }), false, "an unknown player names no clip");
  assert.equal(selectionValid(view, { kind: "text", id: "t-hook", versionId: "mev_mv3k0old_a1a1a1a1a1" }), false, "a selection made on v1 is not valid on v2");
  assert.equal(selectionValid(view, { kind: "text", id: "t-desktop", versionId: "mev_mv3m4k7e_d2d2d2d2d2" }), false, "the vertical has no such text");
  assert.equal(selectionFor(clipSlots(stale())[0], "t-hook"), null, "nothing is selected on an old clip");
  assert.equal(selectionValid(stale(), { kind: "text", id: "t-hook", versionId: "mev_mv3m2a9c_b2b2b2b2b2" }), false);
  // Versions with real links (v2 replaced v1 after the reference revision).
  assert.deepEqual(m.versions.map((v) => [v.n, v.status, v.supersedes]), [[1, "SUPERSEDED", null], [2, "CURRENT", 1]]);
  assert.equal(m.version, 2);
  const rights = rightsView(view);
  assert.equal(rights.internalAllowed, true);
  assert.deepEqual(rights.scopes.map((s) => [s.label, s.text, s.cleared]), [["portofoliu / site", "neînregistrat", false], ["studiu de caz", "neînregistrat", false], ["postări organice", "neînregistrat", false]]);
  assert.equal(rightsView({ clip: { rights: { internal: "denied", public: [{ scope: "paid", state: "RESTRICTED" }, { scope: "organic", state: "???" }] } } }).scopes.map((s) => s.tone).join(), "error,neutral", "an unknown state is never „permis”");
});

test("M11-UI-10 the narrow viewport is always „lățimea unui telefon (390 px) în Chromium”; screenshots come only from the delivery's evidence route", () => {
  assert.equal(PHONE_WORDING, "lățimea unui telefon (390 px) în Chromium");
  assert.equal(phoneWording(412), "lățimea unui telefon (412 px) în Chromium");
  assert.equal(phoneWording("x"), PHONE_WORDING);
  assert.match(PHONE_CAVEAT, /nu este un telefon real/);
  const rows = shotRows(ready());
  assert.deepEqual(rows.map((r) => [r.criterion, r.phone, r.wording, r.evidence.label, r.current]), [["AC-6", true, PHONE_WORDING, "PASS_LOCAL", true], ["AC-7", false, "desktop 1280×800", "PASS_LOCAL", true]]);
  assert.equal(rows[0].caveat, PHONE_CAVEAT);
  assert.equal(rows[0].alt, `Captură E2E AC-6 — ${PHONE_WORDING}`);
  assert.equal(isPhoneShot({ viewport: { width: 390, height: 844 } }), true);
  assert.equal(isPhoneShot({ viewport: { width: 1280, height: 800 }, viewportLabel: "telefon" }), false, "the measured width wins over a label");
  assert.equal(isPhoneShot({ viewportLabel: "mobil" }), true);
  assert.equal(isPhoneShot({ viewportLabel: "desktop" }), false);
  assert.equal(shotRows({ preview: { shots: [{ criterion: "AC-9", viewport: { width: 360, height: 740 }, status: "FAIL", src: "x" }] } })[0].wording, "lățimea unui telefon (360 px) în Chromium");
  assert.equal(shotRows({ preview: { shots: [{ criterion: "AC-9", viewport: { width: 1440, height: 900 }, status: "PASS" }] } })[0].wording, "desktop 1440×900");

  assert.equal(safeShotSrc("/api/deliveries/dlv_abc123/evidence/fev_abc123/screenshot"), "/api/deliveries/dlv_abc123/evidence/fev_abc123/screenshot");
  for (const bad of ["https://evil.example/x.png", "//evil.example/x.png", "/api/deliveries/dlv_abc123/evidence/../../secret", "javascript:alert(1)", "/api/media/files/mav_1", "", null, "data:image/png;base64,AAAA"]) assert.equal(safeShotSrc(bad), null, String(bad));
  assert.equal(shotRows({ preview: { shots: [{ criterion: "AC-1", status: "PASS", src: "https://evil.example/x.png", viewportLabel: "desktop" }] } })[0].src, null);

  // The Room's own strings never say „pe telefon / pe mobil / dispozitiv mobil” (the fixture's and the server's notes are data, not ours).
  for (const rel of [...UI_FILES, "web/src/lib/deliveryLogic.js"]) {
    const code = source(rel).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
    const hit = /pe (un )?telefon\b|pe mobil\b|dispozitiv mobil|telefoane reale/i.exec(code);
    assert.equal(hit && code.slice(Math.max(0, hit.index - 40), hit.index + 40), null, rel);
  }
  assert.match(source("web/src/screens/delivery/PreviewPanel.jsx"), /PHONE_WORDING/);
});

test("M11-UI-11 the local demo: a link only to a loopback preview that is not the Hub; start only from the verified snapshot", () => {
  assert.equal(safePreviewUrl("http://127.0.0.1:4620/"), "http://127.0.0.1:4620/");
  assert.equal(safePreviewUrl("http://localhost:4620/programari"), "http://localhost:4620/programari");
  for (const bad of ["https://127.0.0.1:4620/", "http://example.com:4620/", "http://127.0.0.1/", "http://user:pw@127.0.0.1:4620/", "javascript:alert(1)", "http://192.168.1.10:4620/", "", null, "notaurl"]) assert.equal(safePreviewUrl(bad), null, String(bad));
  assert.equal(safePreviewUrl("http://127.0.0.1:8011/", { hubOrigin: "http://localhost:8011" }), null, "never a link that opens the Hub itself");
  assert.equal(safePreviewUrl("http://127.0.0.1:4620/", { hubOrigin: "http://localhost:8011" }), "http://127.0.0.1:4620/");

  const running = previewState(ready(), { hubOrigin: "http://localhost:8011", session: "open" });
  assert.deepEqual([running.running, running.open.enabled, running.start.enabled, running.stop.enabled, running.startCommand], [true, true, false, true, "node server.js"]);
  const stopped = previewState(variant(ready, (v) => { v.preview.running = false; }), { session: "closed" });
  assert.deepEqual([stopped.open.enabled, stopped.start.enabled, stopped.start.label], [false, true, "Pornește preview-ul versiunii verificate — deschide sesiunea (Windows Hello)"]);
  assert.equal(previewState(variant(ready, (v) => { v.preview.running = false; }), { session: "open", busy: true }).start.enabled, false);
  const old = previewState(stale(), { session: "open" });
  assert.equal(old.start.enabled, false);
  assert.match(old.start.reason, /doar din versiunea verificată/);
  const refused = previewState(variant(ready, (v) => { v.preview.url = "http://example.com/"; }), {});
  assert.deepEqual([refused.url, refused.urlRefused, refused.open.enabled], [null, true, false], "a preview address that is not local is shown as refused, never linked");
  assert.equal(previewState({}, {}).start.reason, "Nu există încă o versiune verificată de pornit.");
  assert.equal(previewState(variant(ready, (v) => { v.preview.running = false; }), { session: "unavailable" }).start.enabled, false);
});

test("M11-UI-12 the commercial summary: sections by source, „De stabilit (neconfigurat)”, the diff a save would make, the Hub's own refusals, approval and exports", () => {
  assert.equal(NOT_CONFIGURED_TEXT, "De stabilit (neconfigurat)");
  assert.equal(NOT_CONFIGURED_TEXT, SALES_NOT_CONFIGURED, "the same words as the sales catalog");
  const view = ready();
  const sv = summaryView(view);
  assert.deepEqual([sv.present, sv.current, sv.version, sv.shaPrefix, sv.status], [true, true, 2, "7d0c3b5a9e1f", "CURRENT"]);
  assert.deepEqual(sv.sections.map((s) => s.id), ["context", "delivered", "fixed", "not_verified", "video", "scope", "exclusions", "price_terms", "next_step", "provenance"]);
  assert.deepEqual(sv.sections.filter((s) => s.notConfigured).map((s) => s.id), ["scope", "exclusions", "price_terms"]);
  const video = sv.sections.find((s) => s.id === "video");
  assert.deepEqual([video.auto, video.editable, video.sourceLabel], [true, false, "automat"], "the video section is regenerated, so it is not offered for editing");
  assert.equal(sv.sections.find((s) => s.id === "next_step").sourceLabel, "editat de tine");
  // „Trasabilitate” is generated too (the facts of the verified bundle): locked exactly like the video section, with its own honest note
  // that says where the owner's remarks go instead. The Hub refuses the same two (delivery/revision.mjs SUMMARY_SECTIONS auto).
  assert.deepEqual([...AUTO_SECTION_IDS], ["video", "provenance"]);
  const provenance = sv.sections.find((s) => s.id === "provenance");
  assert.deepEqual([provenance.auto, provenance.editable, provenance.sourceLabel], [true, false, "automat"]);
  assert.match(provenance.autoNote, /se generează din faptele pachetului verificat .* nu se editează de mână\. Observațiile tale le scrii într-o secțiune editabilă/);
  assert.match(video.autoNote, /se regenerează la fiecare versiune de clip/);
  assert.deepEqual(sv.sections.filter((s) => !s.editable).map((s) => s.id), ["video", "provenance"]);
  assert.equal(sv.sections.filter((s) => s.editable).length, 8);
  assert.ok(sv.sections.filter((s) => s.editable).every((s) => s.autoNote === ""));
  // A view that claims a generated section is editable is not believed; a section the Hub itself marks `auto` is locked as well.
  const claimed = summaryView(variant(ready, (v) => { for (const sec of v.summary.sections) { sec.editable = true; sec.auto = false; } }));
  assert.deepEqual(claimed.sections.filter((s) => !s.editable).map((s) => s.id), ["video", "provenance"]);
  const hubAuto = summaryView(variant(ready, (v) => { v.summary.sections[0].auto = true; })).sections[0];
  assert.deepEqual([hubAuto.editable, hubAuto.autoNote], [false, "Secțiune automată: se generează din starea curentă a livrării și nu se editează de mână."]);
  assert.deepEqual(sv.basisLines, ["Pachet: bnd_mv3k1p0z_0d9e8f7a6b (sha 4c1f0a9be27d)", "Serviciu din catalog: neconfigurat"]);
  assert.deepEqual(sv.exports.map((e) => [e.format, e.href, e.file]), [["md", "/api/deliveries/dlv_mv3k9q2a_7f3a9c1e2b/summary/2.md", "rezumat-v2.md"], ["html", "/api/deliveries/dlv_mv3k9q2a_7f3a9c1e2b/summary/2.html", "rezumat-v2.html"]]);
  assert.equal(summaryView(variant(ready, (v) => { v.summary.basis.serviceRefs = [{ id: "svc_detailing", version: 3 }]; })).basisLines[1], "Serviciu din catalog: svc_detailing@3");
  assert.equal(summaryView({}).present, false);
  const old = summaryView(stale());
  assert.equal(old.sections.every((s) => !s.editable), true, "an old summary is read-only");
  assert.equal(old.sections.find((s) => s.id === "next_step").needsReview, true);

  // Diff.
  assert.deepEqual(lineDiff("a\nb\nc", "a\nx\nc"), [{ op: "same", text: "a" }, { op: "del", text: "b" }, { op: "add", text: "x" }, { op: "same", text: "c" }]);
  assert.deepEqual(lineDiff("", "nou").filter((l) => l.op !== "same").map((l) => l.op), ["del", "add"]);
  assert.deepEqual(summaryDiff(sv.sections, {}), { changes: [], changed: 0, valid: false, errors: [] });
  assert.equal(summaryDiff(sv.sections, { next_step: `${sv.sections[8].text}  \n` }).changed, 0, "whitespace-only edits are not a new version");
  assert.equal(summaryDiff(sv.sections, { nope: "x", context: 7 }).changed, 0, "unknown sections and non-text drafts are ignored");
  const one = summaryDiff(sv.sections, { next_step: "Hai să discutăm joi, la atelier." });
  assert.deepEqual([one.changed, one.valid, one.changes[0].id, one.changes[0].error], [1, true, "next_step", null]);
  assert.deepEqual(one.changes[0].lines.map((l) => l.op), ["del", "add"]);
  assert.deepEqual(summaryDiff(sv.sections, { next_step: "   " }).errors, ["Următorul pas: O secțiune editată nu poate fi goală."], "an empty section is refused");
  assert.deepEqual(summaryDiff(sv.sections, { next_step: "Salut {{nume}}, vezi TODO" }).errors, ["Următorul pas: Textul are câmpuri necompletate: {{nume}}, TODO."], "an unfilled placeholder is refused");
  assert.deepEqual(summaryDiff(sv.sections, { next_step: "x".repeat(SUMMARY_LIMITS.sectionMax + 1) }).errors, ["Următorul pas: Cel mult 4000 de caractere pe secțiune (acum 4001)."], "more than 4000 characters are refused");
  assert.equal(summaryDiff(sv.sections, { next_step: "x".repeat(SUMMARY_LIMITS.sectionMax) }).valid, true);
  assert.deepEqual(summaryDiff(sv.sections, { video: "alt text" }).errors, ["Materiale video: Această secțiune nu se editează aici."], "the automatic section is not edited");
  assert.deepEqual(summaryDiff(sv.sections, { provenance: "Pachet verificat de mine" }).errors, ["Trasabilitate: Această secțiune nu se editează aici."], "traceability is generated, not hand-written");
  const mixed = summaryDiff(sv.sections, { next_step: "Un pas nou.", context: "" });
  assert.deepEqual([mixed.changed, mixed.valid], [2, false], "one invalid section blocks the save");
  assert.deepEqual(findPlaceholders("ok ${x} [[y]] <pret> undefined"), ["${x}", "[[y]]", "<pret>", "undefined"]);
  assert.deepEqual(findPlaceholders("Text curat."), []);

  // The body of delivery.summary.edit: only what changed, bound to the displayed version.
  assert.deepEqual(summaryEditBody(view, { next_step: "Un pas nou.\n", context: sv.sections[0].text }), { sections: [{ id: "next_step", text: "Un pas nou." }], displayedSha: sv.sha });
  assert.equal(summaryEditBody(view, {}), null);
  assert.equal(summaryEditBody(view, { next_step: "" }), null);
  assert.equal(summaryEditBody(stale(), { next_step: "Un pas nou." }), null, "an old summary is not edited");
  // No edit body is ever built for a generated section — alone or next to a valid edit (the Hub would refuse it: SUMMARY_SECTION_AUTO).
  for (const id of AUTO_SECTION_IDS) {
    assert.equal(summaryEditBody(view, { [id]: "Pachet verificat de mine" }), null, id);
    assert.equal(summaryEditBody(view, { [id]: "Pachet verificat de mine", next_step: "Un pas nou." }), null, `${id} next to a valid edit`);
  }
  assert.ok(sv.sections.filter((s) => s.editable).every((s) => summaryEditBody(view, { [s.id]: "Text nou, scris de mine." })?.sections[0].id === s.id), "every other section is edited as before");

  // Facts only the owner (or a configured service) may state are pointed out, not blocked.
  assert.deepEqual(assertedFacts("Costă 1.500 lei și e gata în 5 zile, garantat, cu 20% reducere."), ["preț", "procent", "termen", "garanție"]);
  assert.deepEqual(assertedFacts("O discuție scurtă în care stabilim ce vă este util."), []);
  assert.deepEqual(one.changes[0].facts, []);

  // Catalog services: only something CONFIGURED can be bound; the catalog decides the words.
  const services = bindableServices({ services: [
    { id: "svc_full", name: "Detailing complet", version: 2, active: true, price: { status: "CONFIGURED", amount: 1500, currency: "RON", unit: "project" }, leadTime: { status: "CONFIGURED", text: "5 zile lucrătoare" } },
    { id: "svc_none", name: "Schiță", version: 1, active: true, price: { status: "NOT_CONFIGURED" }, leadTime: { status: "NOT_CONFIGURED" } },
    { id: "svc_off", name: "Vechi", version: 1, active: false, price: { status: "CONFIGURED", amount: 10, currency: "RON" }, leadTime: { status: "NOT_CONFIGURED" } },
  ] });
  assert.deepEqual(services.map((s) => [s.id, s.bindable]), [["svc_full", true], ["svc_none", false]], "inactive services are not offered; unconfigured ones cannot be bound");
  assert.match(services[0].label, /Detailing complet \(v2\) · preț: 1\.500 RON \/ proiect · termen: 5 zile lucrătoare/);
  assert.match(services[1].reason, /neconfigurat/);
  assert.equal(services[1].priceText, NOT_CONFIGURED_TEXT);
  assert.deepEqual(bindableServices(null), []);
});

test("M11-UI-13 the revision box: what is sent, and the Hub's answer reduced to ONE difference card or ONE clarification", () => {
  assert.deepEqual(revisionAvailability(ready()), { enabled: true, reason: "" });
  assert.equal(revisionAvailability(stale()).enabled, true, "a software change is requested exactly when the delivery is stale");
  assert.equal(revisionAvailability(variant(ready, (v) => { v.delivery.status = "ACTIVE"; })).enabled, false);
  assert.equal(revisionAvailability(variant(ready, (v) => { v.delivery.status = "CLOSED"; })).enabled, false);

  const view = ready();
  const sentence = "Site-ul e bine. Clipul este prea tehnic; după secunda zece arată direct programarea.";
  assert.deepEqual(revisionBody({ text: `  ${sentence}\n` }, view), { ok: true, body: { text: sentence } }, "no selection and no timecode unless the owner attached them");
  const sel = { kind: "text", id: "t-hook", versionId: "mev_mv3m2a9c_b2b2b2b2b2" };
  // The selection goes out with the player that holds it (read from the view, so the Hub maps it to the right clip) …
  assert.deepEqual(revisionBody({ text: "Fă textul mai scurt", selection: sel, timecodeMs: 12345.6 }, view).body, { text: "Fă textul mai scurt", selection: { ...sel, player: "master" }, timecodeMs: 12346 });
  const [slotM, slotV] = clipSlots(view);
  assert.deepEqual(revisionBody({ text: "Schimbă titlul în «Programări simple»", selection: selectionFor(slotV, "t-hook") }, view).body,
    { text: "Schimbă titlul în «Programări simple»", selection: { kind: "text", id: "t-hook", versionId: "mev_mv3m4k7e_d2d2d2d2d2", player: "vertical" } });
  assert.equal("selection" in revisionBody({ text: "Fă textul mai scurt", selection: { ...selectionFor(slotM, "t-hook"), player: "vertical" } }, view).body, false, "a selection that names the wrong player is not sent");
  assert.deepEqual(revisionBody({ text: "Fă textul mai scurt", selection: { ...sel, player: "vertical", extra: "x" } }).body.selection, { ...sel, player: "vertical" }, "without a view: the player the selection names, and nothing else");
  assert.deepEqual(revisionBody({ text: "Fă textul mai scurt", selection: { ...sel, player: "nope" } }).body.selection, sel);
  // … and a moment goes out with the player it was taken in: a moment of the 9:16 player targets the vertical variant.
  assert.deepEqual(revisionBody({ text: "Mută textul mai sus", timecodeMs: 2040, player: "vertical" }, view).body, { text: "Mută textul mai sus", timecodeMs: 2040, player: "vertical" });
  assert.deepEqual(revisionBody({ text: "Mută textul mai sus", timecodeMs: 2040, player: "master" }, view).body, { text: "Mută textul mai sus", timecodeMs: 2040, player: "master" });
  assert.deepEqual(revisionBody({ text: "Mută textul mai sus", timecodeMs: 2040, player: "summary" }, view).body, { text: "Mută textul mai sus", timecodeMs: 2040 }, "an unknown player is not sent");
  assert.deepEqual(revisionBody({ text: "Mută textul mai sus", player: "vertical" }, view).body, { text: "Mută textul mai sus" }, "a player without a moment says nothing");
  const verticalOld = variant(ready, (v) => { v.clip.vertical.itemStatus = "SUPERSEDED"; });
  assert.deepEqual(revisionBody({ text: "Mută textul mai sus", timecodeMs: 2040, player: "vertical" }, verticalOld).body, { text: "Mută textul mai sus" }, "a moment of a player that no longer shows the current version is not sent");
  assert.deepEqual(revisionBody({ text: "Mută textul mai sus", timecodeMs: 2040, player: "master" }, verticalOld).body, { text: "Mută textul mai sus", timecodeMs: 2040, player: "master" });
  assert.equal("selection" in revisionBody({ text: "Fă textul mai scurt", selection: { ...sel, versionId: "mev_mv3k0old_a1a1a1a1a1" } }, view).body, false, "a selection of an older version is not sent");
  assert.equal("selection" in revisionBody({ text: "Fă textul mai scurt", selection: { kind: "text", id: "l-data", versionId: sel.versionId } }, view).body, false);
  for (const t of [null, "", -1, "abc"]) assert.equal("timecodeMs" in revisionBody({ text: "Mută titlul mai sus", timecodeMs: t }, view).body, false, `timecode ${String(t)}`);
  assert.equal(revisionBody({ text: "Mută titlul mai sus", timecodeMs: 0 }, view).body.timecodeMs, 0);
  assert.equal(revisionBody({ text: "ab" }).ok, false);
  assert.equal(revisionBody({ text: "x".repeat(REVISION_LIMITS.max + 1) }).ok, false);
  assert.equal(revisionBody({ text: "x".repeat(REVISION_LIMITS.max) }).ok, true);

  // ONE clarification (≤ 3 options); it wins over anything else in the answer.
  const q = revisionOutcome({ revision: { id: "drv_abc123", status: "CLARIFY", classes: ["clip", "summary"] }, clarification: { question: "Titlul clipului sau titlul rezumatului?", options: [{ id: "clip", label: "Titlul clipului" }, { id: "summary", label: "Titlul rezumatului" }, "a treia", "a patra"] },
    opsPlan: { id: "opp_shouldnotshow1", status: "PROPOSED" } });
  assert.equal(q.kind, "question");
  assert.equal(q.question, "Titlul clipului sau titlul rezumatului?");
  assert.deepEqual(q.options.map((o) => o.label), ["Titlul clipului", "Titlul rezumatului", "a treia"], "at most three options");
  assert.equal("plan" in q, false, "never a card next to an open question");
  assert.equal(q.revisionId, "drv_abc123");
  assert.equal(revisionOutcome({ revision: { id: "drv_abc123", status: "CLARIFY" } }).question, "Poți preciza la ce te referi?");
  assert.deepEqual(clarificationReply(q, q.options[0], { body: { text: "Schimbă titlul" } }), { text: "Schimbă titlul", choice: { id: "clip", forIntent: "delivery_revise" }, revisionId: "drv_abc123" });

  // ONE difference card: an operation plan (media / summary revision) or an envelope (software change).
  const plan = { id: "opp_mv3m1c8d_2020202020", kind: "delivery.revise", title: "Revizie de clip", status: "PROPOSED", nonce: "n".repeat(32), hash: "h".repeat(64), summary: {} };
  const ops = revisionOutcome({ revision: { id: "drv_abc123", status: "PROPOSED", classes: ["feedback", "tone", "clip"] }, opsPlan: plan, notes: ["Notat că site-ul e bine. Acceptarea software rămâne butonul „Accept local” din camera de livrare."] });
  assert.equal(ops.kind, "ops");
  assert.equal(ops.plan, plan);
  assert.deepEqual(ops.notes, ["Notat că site-ul e bine. Acceptarea software rămâne butonul „Accept local” din camera de livrare."], "the feedback is a note, never a second card");
  assert.equal(revisionOutcome({ card: { opsPlan: plan } }).kind, "ops");
  assert.equal(revisionOutcome({ plan }).kind, "ops");
  const env = revisionOutcome({ revision: { id: "drv_abc124", status: "ROUTED_SOFTWARE", classes: ["software"] }, plan: { envelope: { id: "env_mv3n0a1b_7070707070", nonce: "x", envelopeHash: "y" }, summary: { headline: "Adaug câmpul" } } });
  assert.equal(env.kind, "envelope");
  assert.equal(env.plan.envelope.id, "env_mv3n0a1b_7070707070");
  assert.equal(env.plan.summary.headline, "Adaug câmpul");
  // Intake-shaped answers (several step results): still one thing; the other results become notes.
  const multi = revisionOutcome({ results: [{ message: "Notat că site-ul e bine." }, { opsPlan: plan, note: "Plan afișat; o singură confirmare." }] });
  assert.equal(multi.kind, "ops");
  assert.deepEqual(multi.notes, ["Plan afișat; o singură confirmare.", "Notat că site-ul e bine."]);
  assert.equal(revisionOutcome({ results: [{ opsPlan: plan }, { clarification: { question: "Care?", options: [] } }] }).kind, "question");
  // Notes, refusals, nothing.
  const noted = revisionOutcome({ revision: { id: "drv_abc125", status: "NOTED", classes: ["feedback"] }, message: "Notat că site-ul e bine. Acceptarea software rămâne butonul „Accept local”." });
  assert.deepEqual([noted.kind, noted.tone], ["message", "info"]);
  assert.equal(revisionOutcome({ refused: "Livrarea e învechită: clipul nu se mai revizuiește." }).tone, "warn");
  assert.equal(revisionOutcome({ error: { message: "Sesiunea s-a închis." } }).message, "Sesiunea s-a închis.");
  for (const nothing of [null, undefined, {}, { results: [] }, "text", 7]) assert.equal(revisionOutcome(nothing).kind, "empty");
  assert.equal(revisionOutcome({ opsPlan: { id: "not-a-plan-id" } }).kind, "empty", "an id that is not an operation plan is not presented as one");
  for (const answer of [q, ops, env, multi, noted]) assert.equal(["question", "ops", "envelope", "message", "empty"].filter((k) => k === answer.kind).length, 1);

  assert.deepEqual(revisionRows(view), [{ id: "drv_mv3m0a2b_3030303030", source: "owner", sourceLabel: "cerută de tine", text: sentence, status: "APPLIED", tone: "ok", statusText: "aplicat", classes: ["feedback", "ton", "clip"], planId: "opp_mv3m1c8d_2020202020" }]);
  assert.deepEqual(revisionRows(stale()), []);
});

test("M11-UI-14 versions with real links only, plans, observations, the progress spine and the cockpit card", () => {
  const view = ready();
  // Real links: v2 names v1 through supersedesId; a link to an item the view does not carry is shown as missing, never invented.
  assert.deepEqual(versionChain(view.history, "render", "master").map((v) => [v.n, v.text, v.supersedes, v.linked]), [[1, "înlocuită", null, true], [2, "curentă", 1, true]]);
  assert.deepEqual(versionChain(view.history, "bundle").map((v) => [v.n, v.supersedes]), [[1, null]]);
  const broken = versionChain([{ kind: "edit", role: "master", id: "a2", status: "CURRENT", supersedesId: "gone", createdAt: "2026-10-06T10:00:00Z" }, { kind: "edit", role: "master", id: "a1", status: "SUPERSEDED", supersedesId: null, createdAt: "2026-10-06T09:00:00Z" }], "edit", "master");
  assert.deepEqual(broken.map((v) => [v.id, v.n, v.supersedes, v.linked]), [["a1", 1, null, true], ["a2", 2, null, false]], "created order numbers the versions; the missing link is flagged");
  const selfLoop = versionChain([{ kind: "edit", role: "master", id: "a1", status: "CURRENT", supersedesId: "a1", createdAt: "2026-10-06T09:00:00Z" }], "edit", "master");
  assert.deepEqual([selfLoop[0].supersedes, selfLoop[0].linked], [null, false], "an item never supersedes itself or a later one");
  assert.deepEqual(versionChain(null, "edit", "master"), []);
  const groups = historyGroups(view);
  assert.deepEqual(groups.slice(0, 3).map((g) => g.label), ["Pachet software", "Captură E2E · AC-6", "Captură E2E · AC-7"]);
  assert.equal(groups.find((g) => g.key === "capture|mobile").label, `Captură video · ${PHONE_WORDING}`);
  assert.equal(groups.filter((g) => g.notable).length, 9);
  assert.equal(historyGroups(stale()).find((g) => g.key === "bundle|").versions[0].staleReason, "software-ul s-a schimbat: workspace-ul diferă de versiunea testată (2 fișiere)");

  // Plans.
  const plans = planRows(view);
  assert.deepEqual(plans.map((p) => [p.kindLabel, p.statusLabel, p.open, p.progress.done, p.progress.total]), [["Pachetul de livrare: captură, clip, rezumat", "gata (verificat)", false, 10, 10], ["Revizie de clip", "gata (verificat)", false, 6, 6]]);
  const active = variant(ready, (v) => { v.delivery.status = "ACTIVE"; v.clip.master = {}; v.clip.vertical = {}; v.summary = {}; v.plans = [{ id: "opp_mv3z9y8x_3030303030", kind: "delivery.package", status: "RUNNING", steps: [{ seq: 1, title: "Verific versiunea testată", status: "DONE" }, { seq: 5, title: "Montez clipul din capturi", status: "RUNNING" }, { seq: 6, title: "Randare finală", status: "PENDING" }] }]; });
  assert.deepEqual([planRows(active)[0].open, planRows(active)[0].running.title], [true, "Montez clipul din capturi"]);
  assert.equal(repackageState(ready()).offered, false);
  assert.deepEqual([repackageState(stale(), { session: "closed" }).offered, repackageState(stale(), { session: "closed" }).enabled, repackageState(stale(), { session: "closed" }).label], [true, true, "Pregătește un plan nou de împachetare — deschide sesiunea (Windows Hello)"]);
  assert.equal(repackageState(variant(stale, (v) => { v.plans[0].status = "PAUSED"; })).offered, false, "an open plan is continued on its own card, not replaced");
  assert.equal(repackageState(stale(), { session: "unavailable" }).enabled, false);

  // Observations: most severe first, stable; targets only where the Hub named one.
  const obs = observationRows(view);
  assert.deepEqual(obs.map((o) => [o.severityLabel, o.kindLabel, o.target?.kind || null]), [["avertisment", "QA media", "clip"], ["de știut", "de verificat", "summary"], ["de știut", "de știut", null]]);
  assert.deepEqual(obs[0].target, { kind: "clip", role: "vertical", ms: 3200, label: "mergi la 0:03,2" });
  // A criterion that still needs the owner points at the software panel, and sorts with the warnings (stable: after the earlier one).
  const withCriterion = observationRows(variant(ready, (v) => { v.observations.push({ kind: "criterion", severity: "warning", text: "AC-9: VERIFICARE_MANUALĂ — Verifici tu la acceptare", ref: { kind: "criterion", id: "AC-9" } }); }));
  assert.deepEqual(withCriterion.map((o) => [o.severityLabel, o.kindLabel, o.target?.kind || null]).slice(0, 2), [["avertisment", "QA media", "clip"], ["avertisment", "criteriu", "software"]]);
  assert.deepEqual(withCriterion[1].target, { kind: "software", id: "AC-9", label: "vezi criteriul" });
  assert.equal(observationRows(stale())[0].tone, "error");
  assert.deepEqual(observationRows({ observations: [{ kind: "x", severity: "info", text: " " }, { kind: "qa", severity: "error", text: "A", ref: { kind: "clip", ms: null } }, null] }).map((o) => [o.text, o.target]), [["A", null]]);

  // The spine: five tiles, each in exactly one state said in words.
  const tiles = spineTiles(view);
  assert.deepEqual(tiles.map((t) => [t.key, t.state]), [["software", "done"], ["shots", "done"], ["clip", "done"], ["summary", "done"], ["decisions", "waiting"]]);
  assert.equal(tiles[1].text, `desktop + ${PHONE_WORDING}`);
  assert.equal(tiles[4].text, "4 decizii deschise, separate");
  assert.deepEqual(spineTiles(stale()).map((t) => t.state), ["stale", "stale", "stale", "stale", "stale"]);
  assert.deepEqual(spineTiles(active).map((t) => [t.key, t.state]), [["software", "done"], ["shots", "done"], ["clip", "working"], ["summary", "pending"], ["decisions", "pending"]]);
  assert.equal(spineTiles(active)[2].text, "Montez clipul din capturi", "the running step, in its own words");
  assert.equal(spineTiles(variant(ready, (v) => { v.preview.shots.pop(); }))[1].state, "blocked");
  assert.match(spineTiles(variant(ready, (v) => { v.preview.shots.shift(); }))[1].text, /lipsește captura la lățimea unui telefon \(390 px\) în Chromium/);
  assert.equal(spineTiles(variant(ready, (v) => { v.clip.master.qa.status = "FAIL"; }))[2].state, "blocked");
  for (const t of [...tiles, ...spineTiles(stale()), ...spineTiles({})]) { assert.ok(t.stateLabel.length > 2 && t.text.length > 2); assert.match(t.target, /^livrare-/); }

  // The compact cockpit card (rendered later from the same view).
  assert.deepEqual(cockpitDeliveryCard(view), { id: "dlv_mv3k9q2a_7f3a9c1e2b", title: "Demo de prezentare: programări detailing", href: "#/livrare/dlv_mv3k9q2a_7f3a9c1e2b",
    chips: headerChips(view), line: "4 decizii separate te așteaptă", pendingDecisions: 4, stale: false });
  const staleCard = cockpitDeliveryCard(stale());
  assert.deepEqual([staleCard.stale, staleCard.pendingDecisions], [true, 0]);
  assert.match(staleCard.line, /^Livrare învechită: software-ul s-a schimbat/);
  assert.equal(cockpitDeliveryCard({ delivery: { id: "bad id" } }).href, null);
});

test("M11-UI-18 the fixture mirrors the REAL booking delivery: plan steps (kind + title) of template.mjs, criteria and start command of BOOKING_DEMO, the files of the reference fix, the label id and marker notes of clip-ir.mjs", async () => {
  // The Room's logic was once tested only against illustrative values (a capture step titled „Captură desktop”, a label called
  // t-label, a manual AC-8): each unit passed alone and they did not line up. These values now come from the units themselves.
  const [{ BOOKING_DEMO: def }, { checkSpec, specHash }, tpl, { slugify }, clipIr] = await Promise.all([import("../server/factory/booking-demo-def.mjs"), import("../server/factory/spec.mjs"),
    import("../server/delivery/template.mjs"), import("../server/domain/projects.mjs"), import("../server/delivery/clip-ir.mjs")]);
  const R = FIXTURE.variants.READY, S = FIXTURE.variants.STALE;
  const checked = checkSpec({ workType: def.workType, title: def.title, objective: def.objective, ...def.spec });
  assert.deepEqual(checked.problems, []);
  assert.equal(R.delivery.projectName, def.name);
  // The frozen template of this delivery: the fixture's own project, mission and day (paths below are never created).
  const base = path.resolve(ROOT, "..");
  const identity = { ffmpeg: { version: "7.1", sha256: "f".repeat(64), libsSha256: "1".repeat(64) }, ffprobe: { version: "7.1", sha256: "e".repeat(64), libsSha256: "1".repeat(64) } };
  const template = tpl.buildTemplate({
    project: { id: R.delivery.projectId, name: R.delivery.projectName, slug: slugify(R.delivery.projectName), source: "hub-test", path: path.join(base, "m11-ui-fixture-root", def.dirName) },
    marker: { createdBy: "ifrim-agent-hub", purpose: "live-validation", name: def.name, stack: def.stack, fixture: def.key, data: def.data, createdAt: "2026-10-06T08:00:00.000Z" },
    missionView: { mission: { id: R.preview.key.replace("factory-preview-", ""), title: def.title }, spec: { version: R.software.spec.version, sha256: specHash(checked.spec), spec: checked.spec } },
    demo: def, tools: { state: "PINNED", identity }, chromium: { version: "1.61.0" }, exportsDir: path.join(base, "m11-ui-fixture-videos", "Exporturi"), simulation: false, day: R.delivery.verified.at.slice(0, 10),
    config: { testMode: true, port: 45123, allowedOrigins: new Set(), projectsRoot: path.join(base, "m11-ui-fixture-root"), hubRoot: path.join(base, "m11-ui-fixture-root", "Ifrim Agent Hub"), dataDir: path.join(base, "m11-ui-fixture-data", "private") },
  });
  const rows = (steps) => steps.map((s) => [s.kind, s.title]);

  // Plans: the package plan (both variants) and the revision plan, step by step.
  const pack = rows(tpl.packageSteps(template, R.delivery.id));
  assert.equal(pack.length, 10);
  for (const v of [R, S]) {
    assert.deepEqual(rows(v.plans[0].steps), pack);
    assert.deepEqual(v.plans[0].steps.map((s) => s.seq), pack.map((_, i) => i + 1));
    assert.equal(v.plans[0].kind, tpl.PACKAGE_KIND);
  }
  assert.deepEqual(rows(R.plans[1].steps), rows(tpl.revisionSteps(template, R.delivery.id, R.revisions[0].id)));
  assert.deepEqual([R.plans[1].kind, R.plans[1].id], [tpl.REVISE_KIND, R.revisions[0].planId]);
  for (const plan of [...R.plans, ...S.plans]) for (const step of plan.steps) assert.deepEqual(Object.keys(step), ["seq", "kind", "title", "status"]);
  // The capture steps the Room must recognise are the template's own kind.
  assert.deepEqual(tpl.packageSteps(template, R.delivery.id).filter((s) => isCaptureStep(s)).map((s) => s.params.role), ["desktop", "mobile"]);
  assert.deepEqual(tpl.packageSteps(template, R.delivery.id).filter((s) => isCaptureStep({ title: s.title })).map((s) => s.params.role), ["desktop", "mobile"], "by title alone too");

  // Software: the criteria of the approved spec (AC-1..AC-7, nothing manual), the preview command, the files of the reference fix.
  assert.deepEqual(R.software.criteria.map((c) => [c.id, c.text, c.verify]), checked.spec.acceptance.map((a) => [a.id, a.text, a.verify]));
  assert.deepEqual(R.software.criteria.map((c) => c.id), ["AC-1", "AC-2", "AC-3", "AC-4", "AC-5", "AC-6", "AC-7"]);
  const byId = new Map(checked.spec.acceptance.map((a) => [a.id, a]));
  for (const c of S.software.criteria) assert.deepEqual([c.text, c.verify], [byId.get(c.id).text, byId.get(c.id).verify], c.id);
  const fix = JSON.parse(fs.readFileSync(path.join(here, "fixtures", "factory-patches", "booking-fix.json"), "utf8"));
  for (const v of [R, S]) {
    assert.equal(v.preview.startCommand, checked.spec.verification.preview.command);
    assert.equal(v.preview.startCommand, "node server.js");
    assert.equal(v.preview.url, checked.spec.verification.preview.url);
    assert.deepEqual(v.software.changeSet.files.map((f) => f.path), Object.keys(fix.write));
    for (const f of v.software.changeSet.files) assert.ok(v.software.diff.text.includes(`+++ b/${f.path}\n`), `the diff shows ${f.path}`);
    assert.deepEqual(v.preview.shots.map((s) => s.criterion).sort(), template.captures.map((c) => c.criterion).sort());
  }
  assert.ok(checked.spec.inScope.includes("public/js/slots-view.mjs") && R.software.changeSet.files[0].path === "public/js/slots-view.mjs");
  assert.equal(template.preview.command, R.preview.startCommand);
  for (const file of S.delivery.verified.changedFiles) assert.ok(fs.existsSync(path.join(V2, "fixtures", "factory", "booking-demo", file)), `${file} exists in the fixture project`);

  // The clip: the label id and the marker (kind, note) list of a master built by clip-ir.mjs from this template's captures.
  const simulate = (cap) => {
    let t = 0;
    const markers = [];
    for (const step of cap.steps) {
      if (step.marker) markers.push({ kind: step.marker.kind, atMs: t, note: step.marker.note });
      if (step.highlight) { markers.push({ kind: "highlight", atMs: t, note: step.highlight.selector, rect: { x: 0.2, y: 0.4, w: 0.2, h: 0.06 } }); t += step.highlight.ms; }
      t += step.wait ?? (step.type ? step.type.text.length * step.type.delayMs : step.goto ? 1000 : 150);
    }
    return { role: cap.role, assetVersionId: `mav_${cap.role}`, durationMs: t + 1000, width: cap.viewport.width * cap.dsf, height: cap.viewport.height * cap.dsf, captureLabel: cap.captureLabel, markers,
      evidenceSelectors: [...cap.evidenceSelectors], proofSelector: cap.proofSelector };
  };
  const built = clipIr.buildMaster({ captures: template.captures.map(simulate), texts: template.story.texts, tone: "business", passed: checked.spec.acceptance.map((a) => a.id), noun: template.story.noun, evidenceNote: template.story.evidenceNote });
  assert.deepEqual(R.clip.master.markers.map((m) => [m.kind, m.note]), built.markers.map((m) => [m.kind, m.note]));
  assert.deepEqual(built.markers.map((m) => m.note), ["intro", "programare desktop", "programare mobil", "interval ocupat pe telefon", "final"]);
  const builtIds = built.ir.tracks.filter((track) => track.kind === "text").flatMap((track) => track.items).map((i) => i.id);
  assert.deepEqual(R.clip.master.textItems.map((i) => i.id), builtIds);
  assert.equal(LABEL_ITEM_ID, clipIr.LABEL_ITEM_ID);
  for (const v of [R, S]) for (const slot of ["master", "vertical"]) {
    const items = v.clip[slot].textItems;
    if (items.length) assert.deepEqual([items[0].id, items[0].text], [clipIr.LABEL_ITEM_ID, clipIr.CLIP_LABEL_TEXT], `${slot}: the label`);
    assert.ok(items.slice(1).every((i) => Object.values(clipIr.TEXT_IDS).includes(i.id)), `${slot}: story text ids`);
  }
  // Nothing of the old illustrative values is left.
  assert.doesNotMatch(JSON.stringify(FIXTURE), /t-label|AC-8|server\.mjs|public\/app\.js|src\/slots\.mjs|Captură desktop/);
});

// ---------------------------------------------------------------- Part B: source checks (no browser)

/** vite (the project's own build tool) — its oxc transformer and its SSR build; null when it cannot be loaded here. */
let viteLoad = null;
const loadVite = () => (viteLoad ||= import("vite").then((vite) => import("@vitejs/plugin-react").then((plugin) => ({ vite, react: plugin.default }))).catch((error) => ({ error })));

const exportsOf = (file) => {
  const src = fs.readFileSync(file, "utf8");
  const names = new Set();
  for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z0-9_$]+)/g)) names.add(m[1]);
  if (/export\s+default\b/.test(src)) names.add("default");
  return names;
};

test("M11-UI-15 the new components parse and import only what exists; the Room reads through its client, never publishes, never embeds the preview", async (t) => {
  const env = await loadVite();
  if (env.error) t.diagnostic(`SKIPPED_ENV (partial): vite is not loadable here (${String(env.error.message).slice(0, 120)}) — the JSX parse check did not run`);
  for (const rel of UI_FILES) {
    const file = path.join(V2, rel);
    const src = fs.readFileSync(file, "utf8");
    if (!env.error) await assert.doesNotReject(env.vite.transformWithOxc(src, file, { lang: "jsx" }), `${rel} parses`);
    for (const m of src.matchAll(/import\s+(?:([A-Za-z0-9_$]+)\s*,?\s*)?(?:\{([^}]*)\})?\s*(?:from\s*)?["']([^"']+)["']/g)) {
      const [, def, named, spec] = m;
      if (!spec.startsWith(".")) { assert.ok(["react", "lucide-react"].includes(spec), `${rel}: only react and lucide-react come from packages (no new dependency), got ${spec}`); continue; }
      const target = path.resolve(path.dirname(file), spec);
      assert.ok(fs.existsSync(target), `${rel}: ${spec} exists`);
      if (spec.endsWith(".css")) continue;
      const have = exportsOf(target);
      if (def) assert.ok(have.has("default"), `${rel}: ${spec} has a default export`);
      for (const n of (named || "").split(",").map((x) => x.trim().split(/\s+as\s+/)[0]).filter(Boolean)) assert.ok(have.has(n), `${rel}: ${spec} exports ${n}`);
    }
  }
  const room = source("web/src/screens/DeliveryRoom.jsx");
  const panels = UI_FILES.slice(1).map((rel) => [rel, source(rel)]);
  // Data access: one injectable client built on the existing api helper; panels never call the API or fetch by themselves.
  assert.match(room, /import \{ api, fmt \} from "\.\.\/api\.js";/);
  assert.match(room, /export function createDeliveryClient\(request = api\)/);
  assert.match(room, /export default function DeliveryRoom\(\{ id, query, go, client = defaultClient \}\)/);
  for (const [rel, src] of panels) { assert.doesNotMatch(src, /\bfetch\(|from "\.\.\/\.\.\/api\.js"|\bapi\(/, `${rel} goes through the Room's client`); assert.doesNotMatch(src, /localStorage|sessionStorage/, rel); }
  assert.doesNotMatch(room, /\bfetch\(|localStorage|sessionStorage/);
  // Owner-session commands run the existing ceremony helper; a refusal is never retried with more authority.
  assert.match(room, /import \{ withReauth, onLocalhost \} from "\.\.\/lib\/ownerSession\.js";/);
  assert.match(room, /if \(lock\.current\) return undefined;/, "one write at a time (ref lock, not render state)");
  // Reuse, not re-implementation.
  assert.match(source("web/src/screens/delivery/ClipPanel.jsx"), /import \{ Player \} from "\.\.\/studio\/Player\.jsx";/);
  assert.match(source("web/src/screens/delivery/ClipPanel.jsx"), /import \{ OpsPlanCard \} from "\.\.\/lega\/OpsPlanCard\.jsx";/);
  assert.match(source("web/src/screens/delivery/SummaryEditor.jsx"), /import \{ Markdown \} from "\.\.\/\.\.\/components\/Markdown\.jsx";/);
  // The revision box sends a moment with the player it was taken in (so a moment of the 9:16 player targets the vertical variant) and
  // offers it only while that player still shows the current version; a generated summary section shows its own note, never an editor.
  const clipPanel = source("web/src/screens/delivery/ClipPanel.jsx");
  assert.match(clipPanel, /revisionBody\(\{ text, selection, timecodeMs: atMoment && moment \? moment\.ms : null, player: atMoment && moment \? moment\.key : null \}, room\.view\)/);
  assert.match(clipPanel, /const momentCurrent = Boolean\(moment\) && slots\.some\(\(s\) => s\.key === moment\.key && s\.mode === "current"\);/);
  assert.match(clipPanel, /<RevisionBox room=\{room\} moment=\{momentCurrent && moment\.ms > 0 \? moment : null\} \/>/);
  assert.match(clipPanel, /room\.setSelection\(selectionFor\(slot, t\.id\)\)/, "the selection is built by the logic module (with its player), not by hand");
  assert.match(source("web/src/screens/delivery/SummaryEditor.jsx"), /\{section\.auto && <p className="faint small">\{section\.autoNote\}<\/p>\}/);
  assert.match(source("web/src/screens/delivery/SummaryEditor.jsx"), /editing=\{s\.editable && open\.includes\(s\.id\)\}/, "a section that is not editable never opens an editor, even with a stored draft");
  // Nothing publishes, uploads or sends; the generated demo is never framed inside the Hub page; new tabs do not get an opener.
  for (const [rel, src] of [["web/src/screens/DeliveryRoom.jsx", room], ...panels]) {
    assert.doesNotMatch(src, /<iframe|dangerouslySetInnerHTML|innerHTML/, rel);
    assert.doesNotMatch(src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, ""), /apiRelease|manifests?\/|\/api\/content\/|["'`][^"'`]*\b(upload|publish)\b/i, `${rel}: no publish / upload path`);
    for (const m of src.matchAll(/<a\b[^>]*target="_blank"[^>]*>/g)) assert.match(m[0], /rel="noopener noreferrer"/, `${rel}: ${m[0].slice(0, 60)}`);
    // The app routes by hash: an in-page anchor would leave the Room.
    assert.doesNotMatch(src, /href="#livrare-|href=\{`#livrare-/, rel);
  }
  // Old material is collapsed and its media is not requested until opened.
  assert.match(source("web/src/screens/delivery/ClipPanel.jsx"), /\{open && slot\.playable && <div/);
  assert.match(source("web/src/screens/delivery/PreviewPanel.jsx"), /\{open && <Shot row=\{row\} \/>\}/);
  // Styles: tokens only, panels stack below 900 px, long labels wrap instead of widening the page.
  const css = source("web/src/styles/m11.css");
  assert.match(css, /@media \(max-width: 900px\)/);
  assert.match(css, /\.delivery \.btn:not\(\.icon\) \{ white-space: normal;/);
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ""), /#[0-9a-fA-F]{3,8}\b/, "no hard-coded colours outside the tokens");
});

// ---------------------------------------------------------------- Part C: the real components rendered in node (no browser)

let scratch = null;
after(() => { if (scratch) fs.rmSync(scratch, { recursive: true, force: true }); });
/** One throwaway folder under the OS temp dir for both builds (removed after the run); never a path inside the project. */
const scratchDir = () => (scratch ||= fs.mkdtempSync(path.join(os.tmpdir(), "ifrim-m11-ui-")));
const posix = (p) => p.replace(/\\/g, "/");
let bundleLoad = null;
/** Bundles the Room for node into a throwaway temp folder (never into the project) and imports it. */
function loadRoomBundle() {
  return (bundleLoad ||= (async () => {
    const env = await loadVite();
    if (env.error) return { skip: `SKIPPED_ENV: vite / @vitejs/plugin-react cannot be loaded here (${String(env.error.message).slice(0, 120)})` };
    const entry = path.join(scratchDir(), "entry.jsx");
    fs.writeFileSync(entry, [
      `export { default as DeliveryRoom, DeliveryRoomView, createDeliveryClient } from ${JSON.stringify(posix(path.join(V2, "web/src/screens/DeliveryRoom.jsx")))};`,
      `export { renderToStaticMarkup } from ${JSON.stringify(posix(path.join(ROOT, "node_modules/react-dom/server.node.js")))};`,
      `export { createElement } from ${JSON.stringify(posix(path.join(ROOT, "node_modules/react/index.js")))};`,
    ].join("\n"));
    const outDir = path.join(scratch, "out");
    await env.vite.build({
      configFile: false, root: scratch, cacheDir: path.join(scratch, ".vite"), logLevel: "silent", plugins: [env.react()],
      define: { __UI_VERSION__: JSON.stringify("m11-ui-test"), __UI_CONTRACT__: "14" }, ssr: { noExternal: true },
      build: { ssr: entry, outDir, emptyOutDir: true, minify: false, rollupOptions: { output: { format: "esm", entryFileNames: "room.mjs" } } },
    });
    return { mod: await import(pathToFileURL(path.join(outDir, "room.mjs")).href) };
  })().catch((error) => ({ skip: `SKIPPED_ENV: the Room could not be bundled for node here (${String(error.message).slice(0, 160)})` })));
}
const fakeClient = { view: async () => null, list: async () => ({ deliveries: [] }), owner: async () => null, services: async () => ({ services: [] }), act: async () => ({}), send: async () => ({}) };
const OWNER_OPEN = { session: { id: "os_test", expiresAt: "2026-10-06T18:00:00.000Z" }, policy: { active: true } };
const count = (html, re) => (html.match(re) || []).length;
const textOf = (html) => html.replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<[^>]+>/g, " ").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");

test("M11-UI-16 the Room renders the six deliverables and five decisions from the fixture; a STALE delivery shows the banner and no current player", async (t) => {
  const bundle = await loadRoomBundle();
  if (bundle.skip) { t.skip(bundle.skip); return; }
  const { DeliveryRoom, DeliveryRoomView, renderToStaticMarkup, createElement } = bundle.mod;
  const render = (view, owner = OWNER_OPEN) => renderToStaticMarkup(createElement(DeliveryRoomView, { view, owner, client: fakeClient }));
  const headings = (html) => [...html.matchAll(/<h2 id="[^"]+-h">(?:<svg[\s\S]*?<\/svg>)?([^<]+)/g)].map((m) => m[1]);

  const correction = variant(ready, v => {
    v.correction = { available: true, defects: [{ plain: 'Citarea mobilă este greșită.' }], plan: null, applied: [] };
    v.revisions = [{ id: 'drv_hub', text: 'Corectură automată propusă', status: 'PROPOSED', classes: ['correction'], source: 'hub' }];
    v.summary.basis = { ...v.summary.basis, correction: { version: 1 } };
    v.summary.versions = [{ version: 1, status: 'SUPERSEDED', approval: { kind: 'PRESENTATION_READY' }, createdBy: 'owner' }, { version: 2, status: 'CURRENT', approval: null, createdBy: 'delivery' }];
    v.summary.sections[0].needsReview = true; v.summary.sections[0].reviewReason = 'corectura v1 a schimbat faptele';
  });
  const correctedHtml = render(correction), correctedText = textOf(correctedHtml);
  for (const phrase of ['Pregătește corectura', 'Citarea mobilă este greșită.', 'propusă de Hub', 'Versiunile rezumatului', 'aprobată de tine', 'neaprobată', 'corectura v1 a schimbat faptele']) assert.ok(correctedText.includes(phrase), phrase);
  assert.ok(!correctedText.includes('Ce ai cerut până acum'), 'Hub corrections are never attributed to the owner');
  for (const label of ['Aprobă creația 16:9', 'Aprobă creația 9:16', 'Gata de prezentare']) assert.match(correctedHtml, new RegExp('<button[^>]*disabled=""[^>]*>' + label + '</button>'));
  const grouped = groupDefects(['SUMMARY_CITATION_UNBOUND', 'SUMMARY_LINE_NOT_CURATED'].map(code => ({ code, where: 'summary.how', text: 'Text defect unic AC-99' })));
  const groupedView = structuredClone(correction);
  groupedView.correction.defects = grouped; groupedView.correction.defectCount = grouped.length;
  const groupedText = textOf(render(groupedView));
  assert.ok(groupedText.includes('(1 probleme)'));
  assert.equal(groupedText.split('Text defect unic AC-99').length - 1, 1);
  for (const reason of grouped[0].reasons) assert.ok(groupedText.includes(reason.plain));
  correction.correction.plan = { id: 'opp_hub', status: 'PROPOSED' };
  assert.ok(!textOf(render(correction)).includes('Pregătește corectura'), 'a live card is not duplicated');
  correction.correction.plan = null; correction.delivery.status = 'NEEDS_OWNER';
  correction.correction.defects = [];
  correction.correction.reason = 'Corectura anterioară nu s-a încheiat; o reiau de la ultimul pas reușit';
  assert.ok(textOf(render(correction)).includes('Pregătește din nou corectura'));
  assert.ok(textOf(render(correction)).includes(correction.correction.reason));
  assert.ok(!textOf(render(correction)).includes('(0 probleme)'));
  correction.delivery.status = 'STALE'; correction.correction.available = false;
  correction.observations.push({ kind: 'correction', severity: 'warn', text: 'Conține citări de criterii greșite (păstrată ca istoric)', ref: 'dlv_current123' });
  assert.match(render(correction), /href="\/livrare\/dlv_current123">Deschide livrarea curentă/);

  // READY (owner session open).
  const html = render(ready());
  assert.deepEqual(headings(html), ["1 · Demo local", "2 · Software verificat", `3 · Preview pe desktop și la ${PHONE_WORDING}`, "4 · Clipul", "5 · Rezumat comercial", "6 · Observații rămase", "6 · Deciziile tale (cinci, separate)"]);
  assert.equal(count(html, /<h1/g), 1);
  assert.equal(count(html, /class="delivery-stale"/g), 0);
  assert.equal(count(html, /<video/g), 2, "the two current players");
  assert.equal(count(html, /data-mode="current" data-evidence="current"/g), 2);
  assert.match(html, /src="\/api\/media\/files\/mav_mv3m3f1d_c2c2c2c2c2"/);
  assert.equal(count(html, /<img /g), 2, "the two E2E screenshots");
  assert.match(html, /alt="Captură E2E AC-6 — lățimea unui telefon \(390 px\) în Chromium"/);
  assert.deepEqual([...html.matchAll(/data-decision="([^"]+)"/g)].map((m) => m[1]), ["software", "creativeMaster", "creativeVertical", "rightsPublic", "summaryReady", "publishing"]);
  assert.equal(count(html, /id="livrare-grup-/g), 5, "five decision groups");
  const text = textOf(html);
  for (const phrase of ["DATE SINTETICE · DEMO LOCAL", "Verifică acum", "snapshot identic ✓", "PASS_LOCAL · trecut local", "Deschide preview-ul", "node server.js", "v2 · curentă", "înlocuiește v1",
    "0:10 demonstrație — programare mobil", "Spune ce schimbi", "De stabilit (neconfigurat)", "Gata de prezentare", "Accept local", "Aprobă creația 16:9", "Aprobă creația 9:16", "Înregistrează dreptul (în Studio)",
    PUBLISHING_ROW_TEXT, "Nu înseamnă:", "4 decizii deschise, separate", "0:34,9 îndemn final", "public/js/slots-view.mjs", "test/regression.test.mjs",
    "Filmează demo-ul pe desktop (1280×720, date sintetice, browser izolat)"]) assert.ok(text.includes(phrase), `READY shows „${phrase}”`);
  assert.ok(!text.includes("îndemn final — final"), "the last marker is not said twice");
  // A criterion the owner verifies by hand is shown as NOT_RUN, never as a pass.
  assert.ok(textOf(render(variant(ready, (v) => { v.software.criteria.push({ id: "AC-9", text: "Verificare de mână", verify: "manual", status: "VERIFICARE_MANUALĂ", note: "" }); }))).includes("NOT_RUN · nerulat"));
  // The summary: eight sections can be edited; the two generated ones („Materiale video”, „Trasabilitate”) have no editor, each with its own note.
  assert.deepEqual([...html.matchAll(/aria-label="Editează secțiunea ([^"]+)"/g)].map((x) => x[1]), ["Ce am pregătit", "Ce funcționează (verificat)", "Problema rezolvată", "Ce nu am verificat", "Ce include", "Ce nu include", "Preț și termen", "Următorul pas"]);
  for (const id of ["video", "provenance"]) {
    // The section's own markup: up to the next section (its text may hold list items), or to the end of the list after the last one.
    const from = html.indexOf(`data-section="${id}"`);
    const next = html.indexOf('data-section="', from + 1);
    const block = html.slice(from, next === -1 ? html.indexOf("</li></ul>", from) : next);
    assert.ok(from > 0 && block.length > 50, `${id} is rendered`);
    assert.doesNotMatch(block, /<button|<textarea/, `${id} has no editor`);
    assert.match(textOf(block), /sursă: automat/);
    assert.match(textOf(block), id === "video" ? /Secțiune automată: se regenerează la fiecare versiune de clip/ : /Secțiune automată: se generează din faptele pachetului verificat/);
  }
  // Publishing: text only. No control anywhere offers to publish, upload or send.
  for (const m of html.matchAll(/<(button|a)\b[^>]*>([\s\S]*?)<\/\1>/g)) assert.doesNotMatch(textOf(m[2]), /^\s*(Public[aă]|Încarc[aă]|Trimite (clientului|rezumatul))/i, m[0].slice(0, 80));
  const publishing = html.slice(html.indexOf('data-decision="publishing"'), html.indexOf("</li>", html.indexOf('data-decision="publishing"')));
  assert.doesNotMatch(publishing, /<button|<a /, "the publishing row has no control");
  // The preview opens in a new tab, never inside the Hub page.
  assert.match(html, /<a class="btn primary" href="http:\/\/127\.0\.0\.1:4620\/" target="_blank" rel="noopener noreferrer">/);
  assert.doesNotMatch(html, /<iframe/);
  // Labelled controls: every button has a name, every image an alt, every field a label; one polite live region for status changes.
  for (const m of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) assert.ok(/aria-label="[^"]+"/.test(m[1]) || textOf(m[2]).trim().length > 0, `button without a name: ${m[0].slice(0, 100)}`);
  for (const m of html.matchAll(/<img\b[^>]*>/g)) assert.match(m[0], /alt="[^"]+"/);
  assert.match(html, /<label class="field"><span>(?:<svg[\s\S]*?<\/svg>)? ?Spune ce schimbi<\/span><textarea/);
  assert.match(html, /<p class="sr-only" aria-live="polite">Livrare gata<\/p>/);
  assert.equal(count(html, /<nav class="delivery-spine"/g), 1);
  // Ids are unique, and every aria-labelledby / aria-describedby points at an element that exists.
  const idsOf = (markup) => [...markup.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const checkIds = (markup, name) => {
    const ids = idsOf(markup);
    assert.deepEqual(ids.filter((id, i) => ids.indexOf(id) !== i), [], `${name}: duplicate ids`);
    for (const m of markup.matchAll(/aria-(?:labelledby|describedby)="([^"]+)"/g)) for (const id of m[1].split(/\s+/)) assert.ok(ids.includes(id), `${name}: aria reference to a missing id ${id}`);
  };
  checkIds(html, "READY");
  for (const id of ["livrare-demo", "livrare-software", "livrare-capturi", "livrare-clip", "livrare-rezumat", "livrare-decizii"]) assert.match(html, new RegExp(`<div id="${id}" tabindex="-1" class="delivery-section`), `${id} is reachable by the spine`);
  assert.ok(html.indexOf('id="livrare-demo"') < html.indexOf('id="livrare-software"') && html.indexOf('id="livrare-clip"') < html.indexOf('id="livrare-rezumat"') && html.indexOf('id="livrare-rezumat"') < html.indexOf('id="livrare-decizii"'), "DOM (focus) order follows the numbering");

  // A closed owner session: the buttons say what they need.
  const closedText = textOf(render(ready(), { session: null, policy: { active: true } }));
  for (const phrase of ["Accept local — deschide sesiunea (Windows Hello)", "Gata de prezentare — deschide sesiunea (Windows Hello)", "Trimite — deschide sesiunea (Windows Hello)"]) assert.ok(closedText.includes(phrase), phrase);

  // STALE.
  const old = render(stale());
  assert.equal(count(old, /class="delivery-stale" role="alert"/g), 1);
  const oldText = textOf(old);
  for (const phrase of ["Livrare învechită", "software-ul s-a schimbat: workspace-ul diferă de versiunea testată (2 fișiere)", "public/js/app.mjs", "public/styles.css", "nu sunt dovezi pentru codul de acum",
    "Clip pentru versiunea veche (bnd_mv3k1p0z_0d9e8f7a6b) — nu dovedește codul nou", "Captură pentru versiunea veche — nu dovedește codul nou", "PASS_LOCAL · versiunea veche", "Dovezi pentru versiunea veche",
    "Rezumat pentru versiunea veche", "acceptat local · pentru versiunea veche", "aprobarea era pentru versiunea veche", PUBLISHING_ROW_TEXT]) assert.ok(oldText.includes(phrase), `STALE shows „${phrase}”`);
  assert.equal(count(old, /<video/g), 0, "no stale player is presented (collapsed; the video is not even requested)");
  assert.equal(count(old, /<img /g), 0, "no stale screenshot is presented");
  assert.equal(count(old, /data-evidence="current"/g), 0);
  assert.equal(count(old, /data-mode="old" data-evidence="none"/g), 2);
  assert.equal(count(old, /<details class="delivery-old"(?! open)/g), 4, "two clips and two screenshots, all collapsed");
  assert.doesNotMatch(oldText, /PASS_LOCAL · trecut local|dovadă curentă/, "nothing old reads as current proof");
  assert.doesNotMatch(old, /<button[^>]*>Accept local/, "the historical acceptance offers no new acceptance");
  assert.match(old, /<button type="button" class="btn approve" disabled=""[^>]*>Gata de prezentare<\/button>/);
  assert.doesNotMatch(old, />Editează<\/button>/, "an old summary is not edited");
  checkIds(old, "STALE");

  // QA FAIL on the current master: still shown, never as evidence.
  const failed = render(variant(ready, (v) => { v.clip.master.qa.status = "FAIL"; v.clip.master.qa.kinds.factual = "FAIL"; }));
  assert.equal(count(failed, /<video/g), 2);
  assert.match(failed, /data-clip="master" data-mode="current" data-evidence="none"/);
  assert.ok(textOf(failed).includes("nu contează ca dovadă"));

  // Sparse and unexpected views do not crash the Room.
  for (const view of [{ delivery: { id: "dlv_x1y2z3", title: "T", status: "ACTIVE" } }, { delivery: { id: "dlv_x1y2z3", status: "NEEDS_OWNER", statusReason: "planul s-a oprit" }, software: null, clip: null, summary: null, plans: "x", history: 7 }]) {
    const sparse = render(view, null);
    assert.ok(textOf(sparse).includes("Încă nu există un pachet de livrare"));
    assert.equal(count(sparse, /<video|<img /g), 0);
  }
  // Route states of the screen itself (nothing is loaded in a static render).
  const screen = (props) => textOf(renderToStaticMarkup(createElement(DeliveryRoom, { go() {}, client: fakeClient, query: {}, ...props })));
  assert.ok(screen({ id: "<script>" }).includes("Adresă de livrare nevalidă"));
  assert.ok(screen({ id: null }).includes("Niciun proiect ales"));
  assert.ok(screen({ id: "dlv_abc123" }).includes("Se încarcă livrarea"));
});

// ---------------------------------------------------------------- Part D: the Room in a real browser, with a fake client

/** The page the browser opens: the app's base styles, the Room for `?v=READY|STALE`, and a client that records calls and answers locally. */
const clientMain = () => {
  const web = (rel) => JSON.stringify(posix(path.join(V2, "web/src", rel)));
  const pkg = (rel) => JSON.stringify(posix(path.join(ROOT, "node_modules", rel)));
  return `
import { createElement } from ${pkg("react/index.js")};
import { createRoot } from ${pkg("react-dom/client.js")};
${["app", "m02", "m06", "m07", "m10"].map((name) => `import ${web(`styles/${name}.css`)};`).join("\n")}
import DeliveryRoom, { DeliveryRoomView } from ${web("screens/DeliveryRoom.jsx")};
import fixture from ${JSON.stringify(posix(path.join(here, "fixtures", "m11-delivery-view.json")))};
const params = new URLSearchParams(location.search);
const view = fixture.variants[params.get("v") || "READY"];
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
window.__calls = [];
window.__reloads = 0;
window.__views = 0;
/** What the Hub would answer for GET /api/deliveries/:id — one id fails once (offline), one does not exist. */
const loadView = async (id) => {
  window.__views += 1;
  await wait(50);
  if (id === "dlv_flaky00001" && window.__views === 1) throw Object.assign(new Error("Hub server is not reachable (offline)"), { status: 0, category: "transport" });
  if (id === "dlv_missing0001") throw Object.assign(new Error("Livrarea nu există"), { status: 404, category: "not_found" });
  return view;
};
const plan = { id: "opp_mv3m1c8d_9090909090", kind: "delivery.revise", title: "Revizie de clip", status: "PROPOSED", nonce: "n".repeat(32), hash: "h".repeat(64),
  summary: { steps: ["Aplic revizia", "Randare finală 16:9 + QA"], apps: [], folders: [], observed: [], transmitted: ["nimic"], outputs: ["clip v3"], model: null, limits: "cel mult 20 de minute", never: ["publicare", "cod nou"] } };
const client = {
  view: loadView, owner: async () => ({ session: { id: "os_test" }, policy: { active: true } }), services: async () => ({ services: [] }),
  list: async (projectId) => ({ deliveries: projectId === view.delivery.projectId ? [{ id: "dlv_older000001", createdAt: "2026-10-01T08:00:00.000Z" }, { id: view.delivery.id, createdAt: "2026-10-06T08:50:00.000Z" }] : [] }),
  act: async (id, key, body) => {
    window.__calls.push({ kind: "act", id, key, body });
    await wait(200);
    if (key === "revise" && !body.choice) return { revision: { id: "drv_q1q1q1", status: "CLARIFY" }, clarification: { question: "Titlul clipului sau titlul rezumatului?", options: [{ id: "clip", label: "Titlul clipului" }, { id: "summary", label: "Titlul rezumatului" }] } };
    if (key === "revise") return { revision: { id: "drv_p1p1p1", status: "PROPOSED", classes: ["clip"] }, opsPlan: plan, notes: ["Notat că site-ul e bine."] };
    return {};
  },
  send: async (path, body) => { window.__calls.push({ kind: "send", path, body }); await wait(350); return {}; },
};
const owner = { session: params.get("session") === "closed" ? null : { id: "os_test" }, policy: { active: true }, webauthnOrigin: "http://localhost:" + location.port };
// ?screen=1 renders the screen itself (the route component with its loader); otherwise the Room for the fixture view.
const room = params.get("screen")
  ? createElement(DeliveryRoom, { id: params.get("id"), query: { projectId: params.get("projectId") || undefined }, go: (to) => { location.hash = to; }, client })
  : createElement(DeliveryRoomView, { view, owner, client, reload: () => { window.__reloads += 1; } });
createRoot(document.getElementById("root")).render(createElement("div", { className: "main", id: "main", style: { height: "100vh" } }, room));
`;
};

/** Chromium availability, read the same way the Hub does (the project's Playwright + a cached Chromium); nothing is downloaded here. */
async function chromiumOrSkip() {
  try {
    const { browserStatus, browserLaunchOptions } = await import("../server/tools/browser.mjs");
    const status = browserStatus({ hubRoot: ROOT });
    if (!status.installed || !status.cachedBrowsers.length) return { skip: "SKIPPED_ENV: Playwright/Chromium is missing" };
    return { pw: createRequire(path.join(ROOT, "package.json"))("playwright"), browserLaunchOptions };
  } catch (error) { return { skip: `SKIPPED_ENV: Playwright cannot be loaded here (${String(error.message).slice(0, 120)})` }; }
}

test("M11-UI-17 in a real browser: keyboard and focus, ONE answer per request, one write at a time, no horizontal overflow at 390 px, old media stays unrequested", { timeout: 180000 }, async (t) => {
  const env = await loadVite();
  if (env.error) { t.skip(`SKIPPED_ENV: vite / @vitejs/plugin-react cannot be loaded here (${String(env.error.message).slice(0, 120)})`); return; }
  const chromium = await chromiumOrSkip();
  if (chromium.skip) { t.skip(chromium.skip); return; }
  // A scratch client build (never v2/web/dist) of the Room alone, with the fake client.
  const app = path.join(scratchDir(), "client");
  fs.mkdirSync(app, { recursive: true });
  fs.writeFileSync(path.join(app, "index.html"), '<!doctype html><html lang="ro"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Camera de livrare</title></head><body><div id="root"></div><script type="module" src="./main.jsx"></script></body></html>');
  fs.writeFileSync(path.join(app, "main.jsx"), clientMain());
  const dist = path.join(scratchDir(), "client-dist");
  await env.vite.build({ configFile: false, root: app, cacheDir: path.join(scratchDir(), ".vite-client"), logLevel: "silent", plugins: [env.react()],
    define: { __UI_VERSION__: JSON.stringify("m11-ui-test"), __UI_CONTRACT__: "14" }, build: { outDir: dist, emptyOutDir: true, minify: false, chunkSizeWarningLimit: 10000 } });
  const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css" };
  const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
  const requested = [];
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, "http://x").pathname;
    if (pathname.startsWith("/api/")) requested.push(pathname);
    if (/^\/api\/deliveries\/[^/]+\/evidence\/[^/]+\/screenshot$/.test(pathname)) { res.writeHead(200, { "Content-Type": "image/png" }); res.end(PNG); return; }
    // No Hub behind this page: every other API path answers 404 (the videos included).
    if (pathname.startsWith("/api/")) { res.writeHead(404, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: { message: "fără Hub în acest test", category: "not_found" } })); return; }
    const file = path.join(dist, pathname === "/" ? "index.html" : pathname);
    if (!file.startsWith(dist) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
    res.end(fs.readFileSync(file));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const origin = `http://localhost:${port}`;
  // The Hub's own launch options (no network beyond loopback); this page is also opened on 127.0.0.1, so that address bypasses the proxy too.
  const options = chromium.browserLaunchOptions(origin);
  options.args = options.args.map((a) => (a.startsWith("--proxy-bypass-list=") ? `${a};127.0.0.1:${port}` : a));
  const browser = await chromium.pw.chromium.launch(options);
  const pageErrors = [];
  const open = async (viewport, query, base = origin) => {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    page.on("pageerror", (e) => pageErrors.push(`${query}: ${e.message}`));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) pageErrors.push(`${query}: console ${m.text().slice(0, 200)}`); });
    await page.goto(`${base}/?${query}`);
    await page.waitForSelector(".delivery h1");
    return { context, page };
  };
  /** Horizontal overflow of the page and of the scrolling main area, plus anything sticking out that is not inside its own scroll box. */
  const overflow = (page) => page.evaluate(() => {
    const main = document.getElementById("main");
    const wide = [...document.querySelectorAll(".delivery *")].filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1 && !el.closest(".table-wrap, pre, .sr-only")).slice(0, 5).map((el) => `${el.tagName}.${String(el.className).slice(0, 40)}`);
    return { doc: document.documentElement.scrollWidth - window.innerWidth, main: main.scrollWidth - main.clientWidth, wide };
  });
  const calls = (page, key) => page.evaluate((k) => window.__calls.filter((c) => (c.key || c.kind) === k), key);
  try {
    // ---- 1280 px, owner session open
    let s = await open({ width: 1280, height: 900 }, "v=READY");
    assert.deepEqual(await overflow(s.page), { doc: 0, main: 0, wide: [] }, "no horizontal overflow at 1280 px");
    assert.deepEqual(await s.page.evaluate(() => { const ids = [...document.querySelectorAll("[id]")].map((el) => el.id); return ids.filter((id, i) => ids.indexOf(id) !== i); }), [], "ids are unique in the live DOM");
    // Tab order: the project, „Verifică acum”, the five tiles in order, then the first deliverable.
    const stops = [];
    for (let i = 0; i < 8; i += 1) { await s.page.keyboard.press("Tab"); stops.push(await s.page.evaluate(() => { const a = document.activeElement; return (a.getAttribute("aria-label") || a.textContent || "").trim().replace(/\s+/g, " "); })); }
    [/^Demo Livrare — Detailing \(programări\)$/, /^Verifică acum$/, /^Repar și verific: gata\./, /^Desktop și lățime de telefon: gata\./, /^Clip: gata\./, /^Rezumat: gata\./, /^Deciziile tale: te așteaptă\. 4 decizii deschise/, /^Deschide preview-ul/]
      .forEach((expected, i) => assert.match(stops[i], expected, `tab stop ${i + 1}`));
    // A tile is a button that moves the focus to its panel (the app routes by hash, so there are no anchors).
    await s.page.keyboard.press("Shift+Tab");
    await s.page.keyboard.press("Enter");
    assert.equal(await s.page.evaluate(() => document.activeElement.id), "livrare-decizii");
    assert.equal(await s.page.evaluate(() => location.hash), "", "jumping inside the Room never changes the route");

    // The revision box: Enter sends ONCE (a second Enter while it is in flight is ignored); the answer is ONE question.
    await s.page.fill(".delivery-revise textarea", "Schimbă titlul");
    await s.page.keyboard.press("Enter");
    await s.page.keyboard.press("Enter");
    await s.page.waitForSelector('[data-answer="question"]');
    assert.deepEqual((await calls(s.page, "revise")).map((c) => c.body), [{ text: "Schimbă titlul" }]);
    assert.deepEqual(await s.page.evaluate(() => [...document.querySelectorAll('[data-answer="question"] .studio-options button')].map((b) => b.textContent)), ["Titlul clipului", "Titlul rezumatului"]);
    assert.equal(await s.page.locator(".delivery-answer .cockpit-card").count(), 0, "a question, and no card next to it");
    // Answering it: the same sentence + the choice → ONE plan card (the question is gone), confirmed on the card itself.
    await s.page.click('[data-answer="question"] .studio-options button >> nth=0');
    await s.page.waitForSelector('[data-answer="ops"] .cockpit-card');
    assert.deepEqual((await calls(s.page, "revise"))[1].body, { text: "Schimbă titlul", choice: { id: "clip", forIntent: "delivery_revise" }, revisionId: "drv_q1q1q1" });
    assert.equal(await s.page.locator('[data-answer="question"]').count(), 0);
    assert.equal(await s.page.locator(".delivery-answer .cockpit-card").count(), 1, "ONE difference card");
    assert.equal(await s.page.locator('.delivery-answer button:has-text("Confirmă planul")').count(), 1);
    assert.ok((await s.page.locator(".delivery-answer").textContent()).includes("Notat că site-ul e bine."), "the feedback is a note next to the card");
    assert.equal((await calls(s.page, "send")).length, 0, "showing a plan confirms nothing");
    // Shift+Enter is a new line, never a send.
    await s.page.fill(".delivery-revise textarea", "Prima linie");
    await s.page.keyboard.press("Shift+Enter");
    assert.equal(await s.page.inputValue(".delivery-revise textarea"), "Prima linie\n");
    assert.equal((await calls(s.page, "revise")).length, 2);
    await s.page.fill(".delivery-revise textarea", "");
    // Picking an on-screen text makes it the Room selection (shown, removable); the mandatory label is not a button.
    await s.page.click(".delivery-texts button >> nth=0");
    assert.equal(await s.page.locator('.delivery-texts button[aria-pressed="true"]').count(), 1);
    assert.equal((await s.page.locator(".delivery-attach").textContent()).trim(), "text ales: t-hook · 16:9");
    assert.equal(await s.page.locator('.delivery-texts button:has-text("DATE SINTETICE")').count(), 0);
    // The same text id exists in the 9:16 clip: picking it there moves the selection to that player (one pressed button, never two) …
    await s.page.click(".delivery-clip.is-vertical .delivery-texts button >> nth=0");
    assert.deepEqual(await s.page.evaluate(() => [...document.querySelectorAll('.delivery-texts button[aria-pressed="true"]')].map((b) => b.closest(".delivery-clip").className.includes("is-vertical"))), [true]);
    assert.equal((await s.page.locator(".delivery-attach").textContent()).trim(), "text ales: t-hook · 9:16");
    // … and the sentence goes out with that selection and its player, so the Hub targets the vertical variant without asking.
    await s.page.fill(".delivery-revise textarea", "Schimbă titlul în «Programări simple»");
    await s.page.keyboard.press("Enter");
    await s.page.waitForFunction(() => window.__calls.filter((c) => c.key === "revise").length === 3);
    assert.deepEqual((await calls(s.page, "revise"))[2].body, { text: "Schimbă titlul în «Programări simple»", selection: { kind: "text", id: "t-hook", versionId: "mev_mv3m4k7e_d2d2d2d2d2", player: "vertical" } });
    await s.page.waitForSelector('[data-answer="question"]');
    await s.page.waitForFunction(() => !document.querySelector(".delivery-verify button").disabled);

    // „Accept local” activated twice in the SAME task (before React has re-rendered the button as disabled — a scripted or assistive
    // double activation): the Room's in-flight lock lets ONE request through, bound to the displayed bundle; every other write waits.
    await s.page.evaluate(() => { const button = document.querySelector('[data-decision="software"] button.approve'); button.click(); button.click(); });
    assert.deepEqual(await s.page.evaluate(() => ({ sends: window.__calls.filter((c) => c.kind === "send").length, label: document.querySelector('[data-decision="software"] button.approve').textContent,
      others: [...document.querySelectorAll('[data-decision="creativeMaster"] button.approve, [data-decision="summaryReady"] button.approve, .delivery-verify button')].map((b) => b.disabled) })),
    { sends: 1, label: "Se verifică și se acceptă…", others: [true, true, true] });
    await s.page.waitForFunction(() => !document.querySelector('[data-decision="software"] button.approve').disabled);
    assert.deepEqual(await calls(s.page, "send"), [{ kind: "send", path: "/api/deliveries/dlv_mv3k9q2a_7f3a9c1e2b/software-accept", body: { bundleId: "bnd_mv3k1p0z_0d9e8f7a6b", displayedBundleSha: "4c1f0a9be27d0000000000000000000000000000000000000000000000000000" } }]);
    assert.equal(await s.page.evaluate(() => window.__reloads), 4, "the view is read again after every command (three revision answers, one acceptance)");

    // The summary: an edited section shows what a save would change; the approval refuses while the edit is unsaved; saving sends only the change.
    await s.page.click('[data-section="next_step"] button:has-text("Editează")');
    await s.page.fill('[data-section="next_step"] textarea', "Hai să discutăm joi, la atelier.");
    assert.deepEqual(await s.page.evaluate(() => [...document.querySelectorAll(".delivery-diff div")].map((d) => d.textContent)), ["− O discuție de 20 de minute, la tine la atelier, în care stabilim ce vă este util.", "+ Hai să discutăm joi, la atelier."]);
    assert.deepEqual(await s.page.evaluate(() => [...document.querySelectorAll("button.approve")].filter((b) => /Gata de prezentare/.test(b.textContent)).map((b) => b.disabled)), [true, true], "both „Gata de prezentare” buttons wait for the save");
    assert.ok((await s.page.locator("#livrare-decizie-summaryReady-motiv").textContent()).includes("modificări nesalvate"));
    await s.page.click('.delivery-savebar button:has-text("Salvează ca versiune nouă (v3)")');
    await s.page.waitForFunction(() => window.__calls.some((c) => c.key === "summaryEdit"));
    assert.deepEqual((await calls(s.page, "summaryEdit"))[0].body, { sections: [{ id: "next_step", text: "Hai să discutăm joi, la atelier." }], displayedSha: FIXTURE.variants.READY.summary.sha });
    await s.page.waitForSelector(".delivery-savebar", { state: "detached" });
    await s.context.close();

    // ---- 390 px (the width the demo itself is checked at), owner session closed
    s = await open({ width: 390, height: 844 }, "v=READY&session=closed");
    assert.deepEqual(await overflow(s.page), { doc: 0, main: 0, wide: [] }, "READY: no horizontal overflow at 390 px");
    assert.ok((await s.page.locator('[data-decision="software"] button.approve').textContent()).includes("deschide sesiunea (Windows Hello)"));
    assert.equal(await s.page.locator('[data-decision="software"] button.approve').isEnabled(), true, "a closed session is opened by the click, not refused up front");
    await s.context.close();

    const mark = requested.length;
    s = await open({ width: 390, height: 844 }, "v=STALE");
    assert.deepEqual(await overflow(s.page), { doc: 0, main: 0, wide: [] }, "STALE: no horizontal overflow at 390 px");
    assert.equal(await s.page.locator(".delivery-stale").count(), 1);
    assert.deepEqual(await s.page.evaluate(() => ({ videos: document.querySelectorAll("video").length, imgs: document.querySelectorAll("img").length, open: document.querySelectorAll("details.delivery-old[open]").length })), { videos: 0, imgs: 0, open: 0 });
    await s.page.waitForTimeout(200);
    assert.deepEqual(requested.slice(mark).filter((p) => p.startsWith("/api/media/files/") || p.endsWith("/screenshot")), [], "no old clip or screenshot is requested while its block is collapsed");
    // Opening the collapsed block is the owner's choice: the old clip plays there, still labelled old, still not evidence.
    await s.page.click('details.delivery-old[data-clip="master"] > summary');
    await s.page.waitForSelector('details.delivery-old[data-clip="master"] video');
    assert.deepEqual(await s.page.evaluate(() => ({ videos: document.querySelectorAll("video").length, current: document.querySelectorAll('[data-evidence="current"]').length, accept: document.querySelectorAll('[data-decision="software"] button').length })), { videos: 1, current: 0, accept: 0 });
    await s.context.close();

    // ---- http://127.0.0.1: the owner session cannot open there, so the Room is read-only and shows the way to localhost.
    s = await open({ width: 1280, height: 900 }, "v=READY", `http://127.0.0.1:${port}`);
    assert.deepEqual(await s.page.evaluate(() => ({ link: document.querySelector(".delivery > .notice a")?.getAttribute("href") || null, textarea: document.querySelector(".delivery-revise textarea").disabled,
      accept: document.querySelector('[data-decision="software"] button.approve').disabled, verify: document.querySelector(".delivery-verify button").disabled })),
    { link: `http://localhost:${port}/`, textarea: true, accept: true, verify: false });
    assert.ok((await s.page.locator("#livrare-decizie-software-motiv").textContent()).includes("http://localhost"));
    await s.context.close();

    // ---- the screen itself (`#/livrare/:id`): loading through the client, an honest error with a retry, not found, and the latest delivery.
    const screen = async (query) => { const context = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const page = await context.newPage(); page.on("pageerror", (e) => pageErrors.push(`${query}: ${e.message}`)); await page.goto(`${origin}/?screen=1&${query}`); return { context, page }; };
    s = await screen("id=dlv_flaky00001");
    await s.page.waitForSelector(".notice.error");
    assert.ok((await s.page.locator(".notice.error").textContent()).includes("Offline"), "the first load failed: said, not hidden");
    assert.equal(await s.page.locator(".delivery-spine").count(), 0);
    await s.page.click('.notice.error button:has-text("Reîncearcă")');
    await s.page.waitForSelector(".delivery-spine");
    assert.equal((await s.page.locator(".delivery h1").textContent()).trim(), "Demo de prezentare: programări detailing");
    assert.equal(await s.page.locator('[data-decision="software"] button.approve').isEnabled(), true, "the owner session state comes from the client too");
    await s.context.close();
    s = await screen("id=dlv_missing0001");
    await s.page.waitForSelector(".empty");
    assert.ok((await s.page.locator(".empty").textContent()).includes("Livrarea nu există pe acest Hub"));
    await s.context.close();
    s = await screen(`projectId=${FIXTURE.variants.READY.delivery.projectId}`);
    await s.page.waitForFunction(() => location.hash.startsWith("#/livrare/"));
    assert.equal(await s.page.evaluate(() => location.hash), `#/livrare/${FIXTURE.variants.READY.delivery.id}`, "`#/livrare` without an id opens the project's latest delivery");
    await s.context.close();

    assert.deepEqual(pageErrors, [], "no page or console errors");
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});


test("M11-UI acceptance hints reflect recent confirmation and the local dev profile", () => {
  for (const key of ["software", "creativeMaster", "creativeVertical"]) {
    const action = decisionRows(ready()).find(row => row.key === key).action;
    assert.match(confirmationHint(action, { devProfile: { enabled: false } }), /confirmare recentă/);
    assert.doesNotMatch(confirmationHint(action, { devProfile: { enabled: true } }), /Windows Hello/);
    assert.equal(confirmationHint({ ...action, enabled: false }, {}), "");
  }
});

test("M11-UI capture blocker rule covers plan lifecycle and recording sessions", () => {
  for (const status of ["RUNNING", "CONFIRMED", "PAUSED", "CANCELLED", "DONE"]) {
    const view = { plans: [{ status, steps: [{ kind: "delivery.capture", status: "RUNNING" }] }] };
    assert.equal(captureRunning(view), ["RUNNING", "CONFIRMED"].includes(status));
  }
  assert.equal(captureRunning({ captureBlockers: { planId: "op_other_delivery" } }), true);
  assert.equal(captureRunning({ captureSessions: [{ status: "RECORDING" }] }), true);
  assert.equal(captureRunning({ captureSessions: [{ status: "DONE" }] }), false);
});
