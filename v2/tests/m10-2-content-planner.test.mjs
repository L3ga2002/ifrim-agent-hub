// M10.2 U10 — Content Studio planner (no model, nothing generated; owner decision 5) plus import from a named folder, the latest clip
// and correction targeting by the server-held last target. Covered here:
//  - a promo request on an empty library → ONE honest explanation (STUDIO_NO_MATERIAL) and a preserved work request; asked again →
//    the one line; zero ops plans, missions, runs, grants or mode changes — with the execution gate suspended (it gates model runs);
//  - „Importă din Descărcări/Pachet promo” (outside the import roots) → ONE card with a folder decision that needs a fresh
//    re-authentication; the one-time access is consumed by the import; the import finishing re-plans the preserved request into ONE
//    content plan (fără model, never-list = NEVER_IN_PLANS, the tools pin listed inside it); confirming it → pin + draft render + QA;
//  - „Importă din Videos/Ifrim Studio” inside the roots (no decision), a name found under a root, several folders → one question
//    answered by the id the Hub offered, not found, a cookie-less request refused for a folder outside the roots;
//  - „Arată-mi ultimul clip” → the newest content project; a correction with two open clips targets the last one acted on;
//  - the studio_overview data provider; the import executor consumes the one-time access even when the manifest is invalid.
// Real ffmpeg/ffprobe parts report SKIPPED_ENV when the tools are absent. No network, no model.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeTestHub, enrolOwner, tempDir, waitFor } from "./helpers.mjs";
import { realLaunchers, makeSyntheticMedia } from "./media-helpers.mjs";
import { parseImportFolder } from "../server/ops/intent-actions.mjs";
import { NEVER_IN_PLANS } from "../server/ops/plans.mjs";
import { BUNDLE_FORMAT, BUNDLE_VERSION, BUNDLE_FILE } from "../server/media/project-bundle.mjs";
import { durationOfIr } from "../server/owner/planners/content.mjs";

const launchers = realLaunchers();
const needTools = launchers.available ? false : "SKIPPED_ENV: ffmpeg/ffprobe absent";
const as = (t, owner, type, payload) => t.hub.commands.dispatch({ type, payload, channel: "test", actor: "owner:test", ownerSession: owner?.session || null }).then((r) => r.result);
const intent = (t, owner, payload, extra = {}) => t.hub.commands.dispatch({ type: "owner.intent", payload: { source: "typed", ...payload }, channel: "owner", actor: `owner:${owner.session.id}`, ownerSession: owner.session, ...extra }).then((r) => r.result);
const onUi = (t, payload) => t.hub.commands.dispatch({ type: "owner.intent", payload: { source: "typed", ...payload }, channel: "ui", actor: "user" }).then((r) => r.result);
const count = (t, sql, ...args) => t.hub.db.prepare(sql).get(...args).n;
const setPolicy = (t, patch) => t.hub.bus.transaction(() => t.hub.settings.set("mediaPolicy", { ...t.hub.settings.get("mediaPolicy"), ...patch }, "test"));
const liveEvents = (hub) => { const events = []; hub.live.subscribe((e) => events.push(e)); return events; };
const PROMO = "Fă un videoclip de promovare de 30 de secunde";

const irOf = (assetVersionId, { frames = 60, content = "Un singur plan, o confirmare" } = {}) => ({
  irVersion: 1, fps: { num: 30, den: 1 }, canvas: { width: 640, height: 360, background: "#0B0D10" }, preset: { id: "ifrim-tech", version: 1 }, language: "ro",
  tracks: [
    { id: "v1", kind: "video", clips: [{ id: "c1", assetVersionId, sourceIn: 0, sourceOut: frames, start: 0, label: "SIMULATION" }] },
    { id: "t1", kind: "text", items: [{ id: "lbl", start: 0, end: frames, text: "SIMULARE · date de test", style: "label", anchor: "top", x: 0.5, y: 0.06 }] },
    { id: "t2", kind: "text", items: [{ id: "txt", start: 0, end: frames, text: content, style: "hook", anchor: "bottom", x: 0.5, y: 0.8 }] },
  ],
  markers: [], loudness: { targetLufs: -14, maxTruePeakDb: -1 }, meta: { title: "Clip test", labels: ["SIMULATION"], author: "test", notes: "" } });

/** A content project with one rights-cleared source and one edit plan (through the ordinary commands). */
async function clipProject(t, owner, root, title) {
  const inbox = path.join(root, "inbox", title.replace(/[^a-z0-9]+/gi, "-"));
  makeSyntheticMedia(inbox, { name: "demo.mp4", seconds: 2, width: 640, height: 360 });
  const project = await as(t, owner, "content.project.create", { fields: { title, format: "short", platforms: ["linkedin"] } });
  const pid = project.id || project.project?.id;
  const a = await as(t, owner, "media.asset.import", { sourcePath: path.join(inbox, "demo.mp4"), title: "Captură demo", category: "screen_recording", origin: "OWNED", captureLabel: "SIMULATION", contentProjectId: pid });
  await as(t, owner, "media.rights.record", { right: { assetId: a.asset.id, status: "CLEARED_FOR_SCOPE", holder: "Ifrim Digital", platforms: ["*"], uses: ["organic"], sourceKind: "manual", sourceRef: "test" } });
  const edit = await as(t, owner, "media.edit.create", { contentProjectId: pid, title: "Montaj", ir: irOf(a.version.id) });
  return { pid, asset: a, edit };
}
const studioHub = () => makeTestHub({ configOverrides: { mediaTools: { launcher: launchers } } });

test("U10-CP-01 promo request on an empty library: blocked once with the real options, the request kept; asked again → one line; nothing created", async () => {
  const t = await makeTestHub();
  try {
    const owner = await enrolOwner(t);
    assert.equal(t.hub.settings.get("executionGate").status, "suspended", "the gate stays as it is (it gates model runs, not Studio plans)");
    const live = liveEvents(t.hub);
    const before = { missions: count(t, "SELECT COUNT(*) AS n FROM missions"), grants: count(t, "SELECT COUNT(*) AS n FROM live_grants"), mode: t.hub.settings.get("mode") };
    const out = await intent(t, owner, { text: PROMO });
    const r = out.results[0];
    assert.equal(r.intent, "studio_create");
    assert.equal(r.blockedBy?.signature, "STUDIO_NO_MATERIAL", JSON.stringify(r));
    assert.deepEqual(r.blockedBy.options.map((o) => o.kind), ["owner_decision_inline", "owner_decision_separate"]);
    assert.match(r.message, /Biblioteca media e goală/);
    assert.match(r.message, /folder pe care îl numești tu/);
    assert.match(r.message, /MB1/);
    assert.doesNotMatch(r.message, /LIVE_VALIDATION|grant|OPEN GATE/);
    assert.ok(r.workRequest?.id, "a preserved request");
    assert.equal(r.workRequest.mode, "full");
    const row = t.hub.workRequests.get(r.workRequest.id);
    assert.equal(row.intent, "studio");
    assert.equal(row.status, "BLOCKED");
    assert.equal(row.projectId, null);
    assert.equal(row.blockerSignature, "STUDIO_NO_MATERIAL");
    // Asked again: the same request, one line, no second explanation.
    const again = (await intent(t, owner, { text: PROMO })).results[0];
    assert.equal(again.workRequest.id, r.workRequest.id);
    assert.equal(again.workRequest.mode, "short");
    assert.match(again.message, /^Încă blocat\b.*; cererea ta e păstrată\.$/);
    assert.doesNotMatch(again.message, /Biblioteca media e goală\. Nu am/, "the full explanation is not repeated");
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM work_requests"), 1);
    // Nothing else exists or changed.
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM ops_plans"), 0);
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM agent_runs"), 0);
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM missions"), before.missions);
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM live_grants"), before.grants);
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM approvals WHERE action_kind LIKE 'lega.%'"), 0);
    assert.equal(t.hub.settings.get("mode"), before.mode);
    assert.equal(live.filter((e) => e.type === "lega.plan").length, 0, "a blocker publishes no plan");
    // The overview says it plainly, without spawning a tool.
    const ov = t.hub.intake.studioOverview();
    assert.equal(ov.empty, true);
    assert.deepEqual(ov.counts, { contentProjects: 0, editProjects: 0, rendersDone: 0, rendersActive: 0, assets: 0 });
    assert.equal(ov.latestRender, null);
  } finally { await t.cleanup(); }
});

test("U10-CP-02 Flow A: import by named folder (ONE card, step-up) → the kept request re-plans into ONE content plan → pin + draft render + QA", { skip: needTools }, async () => {
  const base = tempDir("u10-flow");
  const videos = path.join(base, "Videos");
  const received = path.join(base, "Downloads", "Pachet promo");
  // The bundle comes from another Hub (an exported Studio project), so this Hub starts with an empty library.
  const src = await studioHub();
  try {
    const so = await enrolOwner(src);
    setPolicy(src, { importRoots: [path.join(base, "src"), path.join(base, "Downloads")], diskReserveGb: 0, interactivePriority: false });
    const p = await clipProject(src, so, path.join(base, "src"), "Promo Hub");
    await as(src, so, "media.project.export", { contentProjectId: p.pid, dir: received });
  } finally { await src.cleanup(); }
  assert.ok(fs.existsSync(path.join(received, BUNDLE_FILE)));

  const t = await studioHub();
  try {
    const owner = await enrolOwner(t);
    setPolicy(t, { importRoots: [videos], diskReserveGb: 0, interactivePriority: false });
    fs.mkdirSync(videos, { recursive: true });
    const live = liveEvents(t.hub);
    const blocked = (await intent(t, owner, { text: PROMO })).results[0];
    assert.equal(blocked.blockedBy?.signature, "STUDIO_NO_MATERIAL");
    const wrId = blocked.workRequest.id;

    // „Importă din Descărcări/Pachet promo”: outside the roots → ONE card with ONE folder decision.
    const card = (await intent(t, owner, { text: "Importă din Descărcări/Pachet promo" })).results[0];
    assert.equal(card.intent, "studio_import_folder");
    assert.ok(card.opsPlan, JSON.stringify(card));
    assert.equal(path.resolve(card.folder).toLowerCase(), path.resolve(received).toLowerCase());
    assert.deepEqual(card.opsPlan.decisions.map((d) => d.kind), ["folder.plan"]);
    assert.match(card.note, /o singură dată/);
    const presented = { planId: card.opsPlan.id, nonce: card.opsPlan.nonce, hash: card.opsPlan.hash };
    // Step-up: a session whose last verification is old is refused; a fresh re-authentication confirms it.
    t.hub.db.prepare("UPDATE owner_sessions SET reauth_at = ? WHERE id = ?").run(new Date(Date.now() - 3600_000).toISOString(), owner.session.id);
    const stale = await intent(t, owner, { text: "Da", presented }).catch((error) => ({ error }));
    assert.ok(stale.error || stale.results?.[0]?.error, "a stale session cannot widen access");
    assert.match(String(stale.error?.message || stale.results?.[0]?.error?.message), /confirmă din nou cu autentificatorul/);
    assert.equal(t.hub.opsPlans.view(card.opsPlan.id).status, "PROPOSED");
    const fresh = owner.reauth();
    const yes = await intent(t, { ...owner, session: fresh }, { text: "Da", presented });
    assert.ok(yes.results[0].confirmed, JSON.stringify(yes.results[0]));
    const imported = await t.hub.opsPlans.idle(card.opsPlan.id);
    assert.equal(imported.status, "DONE", `${imported.statusReason} ${imported.steps[0].error}`);
    assert.equal(t.hub.db.prepare("SELECT status FROM media_import_grants WHERE plan_id = ?").get(card.opsPlan.id).status, "USED", "the one-time access is consumed");
    assert.ok(!t.hub.media.importRoots().some((x) => x.toLowerCase().includes("pachet promo")), "the allowlist is never widened");

    // The import finishing re-plans the kept request: ONE content plan, proposed, announced, nothing started.
    await waitFor(() => t.hub.workRequests.get(wrId).status === "PLANNED", 30000);
    const wr = t.hub.workRequests.get(wrId);
    assert.equal(wr.planRef.kind, "ops");
    const plan = t.hub.opsPlans.view(wr.planRef.id);
    assert.equal(plan.status, "PROPOSED");
    assert.equal(plan.kind, "studio.create");
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM ops_plans WHERE kind = 'studio.create'"), 1, "ONE content plan");
    assert.ok(live.some((e) => e.type === "lega.plan" && e.data?.planRef?.id === plan.id), "announced as lega.plan");
    assert.equal(plan.body.model, null);
    assert.equal(plan.summary.model, "fără model");
    assert.deepEqual(plan.body.never, [...NEVER_IN_PLANS]);
    assert.deepEqual(plan.body.decisions, [], "no new access: the render works inside the library");
    assert.deepEqual(plan.steps.map((s) => s.kind), ["media.tools.pin", "media.render"], "the pin is a step of the same card");
    assert.ok(!plan.steps.some((s) => /model|run\.start/.test(s.kind)));
    assert.equal(plan.steps[1].params.profile, "draft");
    assert.equal(plan.proposedBy, `readiness:${wrId}`);

    // ONE confirmation → tools pinned by the plan, a draft render and an automated QA result; creative review stays the owner's.
    const go = await intent(t, { ...owner, session: fresh }, { text: "Da", presented: { planId: plan.id, nonce: plan.nonce, hash: plan.hash } });
    assert.ok(go.results[0].confirmed, JSON.stringify(go.results[0]));
    const done = await t.hub.opsPlans.idle(plan.id);
    assert.equal(done.status, "DONE", `${done.statusReason} ${done.steps.map((s) => s.error).join(" | ")}`);
    const pins = t.hub.settings.get("mediaToolPins");
    assert.equal(pins.ffmpeg.pinnedBy, `plan:${plan.id}`);
    assert.equal(pins.ffmpeg.sha256, plan.steps[0].params.expect.ffmpeg.sha256, "exactly the identity shown on the card");
    const render = done.steps[1].result;
    assert.ok(render.assetVersionId, "draft rendered");
    assert.ok(["PASS", "WARN", "FAIL"].includes(render.qa.status));
    assert.equal(render.review.creative, "CREATIVE_REVIEW_PENDING");
    // No model, gate, mode or grant anywhere in the flow.
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM agent_runs"), 0);
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM live_grants"), 0);
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM mission_envelopes"), 0);
    assert.equal(t.hub.settings.get("mode"), "BUILD_SAFE");
    const ov = t.hub.intake.studioOverview();
    assert.equal(ov.counts.rendersDone, 1);
    assert.ok(ov.latestRender?.contentProjectId);
    assert.equal(ov.empty, false);
  } finally { await t.cleanup(); }
});

test("U10-CP-03 a content project exists: ONE plan from the existing executors (question when several; choice; vertical → variant; duration never faked)", { skip: needTools }, async () => {
  const t = await studioHub();
  try {
    const owner = await enrolOwner(t);
    await as(t, owner, "media.tools.pin", {});
    const root = path.join(tempDir("u10-plan"), "Videos");
    setPolicy(t, { importRoots: [root], diskReserveGb: 0, interactivePriority: false });
    const a = await clipProject(t, owner, root, "Lansare Hub");
    const only = (await intent(t, owner, { text: PROMO })).results[0];
    assert.ok(only.opsPlan, JSON.stringify(only));
    assert.deepEqual(only.opsPlan.summary.steps.length, 1, "tools already pinned: no pin step");
    assert.equal(only.opsPlan.summary.model, "fără model");
    assert.match(only.note, /Durata cerută \(30 s\) nu o impun: montajul are ~2 s/);
    assert.match(only.note, /Nu generez material nou/);
    assert.equal(t.hub.opsPlans.view(only.opsPlan.id).steps[0].params.editVersionId, a.edit.version.id);
    // Two clips → ONE question; the choice (the id the Hub offered) presents the plan for that clip.
    const b = await clipProject(t, owner, root, "Demo vânzări");
    const q = (await intent(t, owner, { text: "Fă un clip de prezentare" })).results[0];
    assert.ok(q.clarification, JSON.stringify(q));
    assert.equal(q.clarification.forIntent, "studio_create");
    assert.deepEqual(q.clarification.options.map((o) => o.id).sort(), [a.pid, b.pid].sort());
    const chosen = (await intent(t, owner, { choice: { forIntent: "studio_create", id: b.pid } })).results[0];
    assert.ok(chosen.opsPlan, JSON.stringify(chosen));
    assert.equal(t.hub.opsPlans.view(chosen.opsPlan.id).steps[0].params.editVersionId, b.edit.version.id);
    // A forged choice is refused (it does not answer an open question).
    await assert.rejects(intent(t, owner, { choice: { forIntent: "studio_create", id: a.pid } }), /nu mai corespunde/);
    // A named clip and a vertical request: the variant executor (final render + QA), still no model.
    const v = (await intent(t, owner, { text: "Fă un clip vertical pentru TikTok despre lansare hub" })).results[0];
    const vp = t.hub.opsPlans.view(v.opsPlan.id);
    assert.deepEqual(vp.steps.map((s) => s.kind), ["media.variant.render"]);
    assert.equal(vp.steps[0].params.masterVersionId, a.edit.version.id);
    assert.equal(vp.steps[0].params.platformKey, "tiktok_9x16");
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM agent_runs"), 0);
    assert.equal(durationOfIr(irOf("x", { frames: 90 })), 3);
  } finally { await t.cleanup(); }
});

test("U10-CP-04 named folders: inside the roots (no decision), by name under a root, several → one question + choice, not found, cookie-less outside refused", async () => {
  const t = await makeTestHub();
  try {
    const owner = await enrolOwner(t);
    const base = tempDir("u10-folders");
    const videos = path.join(base, "Videos");
    const writeBundle = (dir, title) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, BUNDLE_FILE), JSON.stringify({ format: BUNDLE_FORMAT, version: BUNDLE_VERSION, project: { title }, labels: [], documents: {}, claims: [], assets: [], edits: [], variants: [] })); };
    writeBundle(path.join(videos, "Ifrim Studio"), "Ifrim Studio");
    writeBundle(path.join(videos, "Clienti", "Promo"), "Promo A");
    writeBundle(path.join(videos, "Arhiva", "Promo"), "Promo B");
    writeBundle(path.join(base, "Downloads", "Primit"), "Primit");
    setPolicy(t, { importRoots: [videos] });

    // Inside the roots: the card shows what is imported, no decision, nothing imported yet.
    const inside = (await intent(t, owner, { text: "Importă din Videos/Ifrim Studio" })).results[0];
    assert.equal(inside.intent, "studio_import_folder");
    assert.ok(inside.opsPlan, JSON.stringify(inside));
    assert.deepEqual(inside.opsPlan.decisions, []);
    assert.equal(path.resolve(inside.folder).toLowerCase(), path.resolve(videos, "Ifrim Studio").toLowerCase());
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM content_projects"), 0);
    // By name, under a root (diacritics and case folded), and through the Lega prefix.
    const named = (await intent(t, owner, { text: "Lega, importă proiectul din folderul ifrim studio" })).results[0];
    assert.equal(path.resolve(named.folder).toLowerCase(), path.resolve(videos, "Ifrim Studio").toLowerCase());
    // Two folders named „Promo” → ONE question; the choice picks the candidate the Hub found (server-held), never a client path.
    const q = (await intent(t, owner, { text: "Importă din Promo" })).results[0];
    assert.equal(q.clarification?.forIntent, "studio_import_folder", JSON.stringify(q));
    assert.deepEqual(q.clarification.options.map((o) => o.id), ["f1", "f2"]);
    const second = q.clarification.options[1].label;
    const picked = (await intent(t, owner, { choice: { forIntent: "studio_import_folder", id: "f2" } })).results[0];
    assert.ok(picked.opsPlan, JSON.stringify(picked));
    assert.equal(path.resolve(picked.folder).toLowerCase(), path.resolve(second).toLowerCase());
    // Not found → an honest message; nothing proposed.
    const plansBefore = count(t, "SELECT COUNT(*) AS n FROM ops_plans");
    const missing = (await intent(t, owner, { text: "Importă din Videos/Nu Exista" })).results[0];
    assert.match(missing.message, /Nu găsesc folderul/);
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM ops_plans"), plansBefore);
    // Outside the roots: a cookie-less request is refused (names and counts of an arbitrary folder are read only in the owner session).
    const outsideUi = (await onUi(t, { text: `Importă din ${path.join(base, "Downloads", "Primit")}` })).results[0];
    assert.match(outsideUi.refused || "", /sesiunea ta de proprietar/);
    // … with the same answer for a folder that does not exist (existence outside the roots is not revealed).
    const ghostUi = (await onUi(t, { text: `Importă din ${path.join(base, "Downloads", "Nu Exista")}` })).results[0];
    assert.equal(ghostUi.refused.replace(/„[^”]*”/, "X"), outsideUi.refused.replace(/„[^”]*”/, "X"));
    const outsideOwner = (await intent(t, owner, { text: `Importă din ${path.join(base, "Downloads", "Primit")}` })).results[0];
    assert.deepEqual(outsideOwner.opsPlan?.decisions.map((d) => d.kind), ["folder.plan"]);
    // A folder inside the roots is fine from the ui channel too (a proposal; the confirmation is the owner's).
    const insideUi = (await onUi(t, { text: "Importă din Videos/Ifrim Studio" })).results[0];
    assert.ok(insideUi.opsPlan);
    // The deictic stays the Explorer path; the grammar of the raw words.
    assert.equal(parseImportFolder("Importă din folderul acesta"), null);
    assert.deepEqual(parseImportFolder("Te rog, importă materialele din C:\\Users\\x\\Videos\\Ifrim Studio."), { folderRef: "C:\\Users\\x\\Videos\\Ifrim Studio" });
    assert.deepEqual(parseImportFolder("Importa din „Ifrim Studio”"), { folderRef: "Ifrim Studio" });
    assert.equal(parseImportFolder("Deschide Videos"), null);
  } finally { await t.cleanup(); }
});

test("U10-CP-05 „Arată-mi ultimul clip” opens the newest content project; a correction with two open clips targets the last one acted on", { skip: needTools }, async () => {
  const t = await studioHub();
  try {
    const owner = await enrolOwner(t);
    await as(t, owner, "media.tools.pin", {});
    const root = path.join(tempDir("u10-show"), "Videos");
    setPolicy(t, { importRoots: [root], diskReserveGb: 0, interactivePriority: false });
    const a = await clipProject(t, owner, root, "Clip alfa");
    const b = await clipProject(t, owner, root, "Clip beta");
    t.hub.db.prepare("UPDATE content_projects SET updated_at = ? WHERE id = ?").run("2030-01-01T00:00:00.000Z", a.pid);
    const latest = (await intent(t, owner, { text: "Arată-mi ultimul clip" })).results[0];
    assert.equal(latest.navigate, `/studio/${a.pid}`);
    // Without a last target (a fresh conversation on another channel) two open clips → ONE question.
    const ask = (await onUi(t, { text: "La secunda 1 mută textul mai sus" })).results[0];
    assert.match(ask.message || "", /Pe care clip/);
    // The owner looked at „Clip beta” → the correction goes to it, no question.
    const shown = (await intent(t, owner, { text: "Arată-mi clipul beta" })).results[0];
    assert.equal(shown.navigate, `/studio/${b.pid}`);
    const fix = (await intent(t, owner, { text: "La secunda 1 mută textul mai sus" })).results[0];
    assert.equal(fix.studio?.contentProjectId, b.pid, JSON.stringify(fix));
    assert.equal(fix.studio.applied, false, "a proposal; nothing applied by the sentence");
    assert.ok(fix.opsPlan, "ONE correction card");
  } finally { await t.cleanup(); }
});

test("U10-CP-06 the import step consumes the one-time folder access even when the manifest is invalid", async () => {
  const t = await makeTestHub();
  try {
    const owner = await enrolOwner(t);
    const base = tempDir("u10-badbundle");
    const videos = path.join(base, "Videos");
    fs.mkdirSync(videos, { recursive: true });
    const bad = path.join(base, "Downloads", "Stricat");
    fs.mkdirSync(bad, { recursive: true });
    fs.writeFileSync(path.join(bad, BUNDLE_FILE), "{ nu e json");
    setPolicy(t, { importRoots: [videos] });
    const card = (await intent(t, owner, { text: "Importă din Descărcări/Stricat" })).results[0];
    assert.deepEqual(card.opsPlan?.decisions.map((d) => d.kind), ["folder.plan"], JSON.stringify(card));
    const yes = await intent(t, owner, { text: "Da", presented: { planId: card.opsPlan.id, nonce: card.opsPlan.nonce, hash: card.opsPlan.hash } });
    assert.ok(yes.results[0].confirmed);
    const done = await t.hub.opsPlans.idle(card.opsPlan.id);
    assert.equal(done.status, "FAILED");
    assert.match(done.steps[0].error, /BUNDLE_INVALID/);
    assert.equal(t.hub.db.prepare("SELECT status FROM media_import_grants WHERE plan_id = ?").get(card.opsPlan.id).status, "USED");
    assert.ok(!t.hub.media.importRoots().some((x) => x.toLowerCase().includes("stricat")));
  } finally { await t.cleanup(); }
});
