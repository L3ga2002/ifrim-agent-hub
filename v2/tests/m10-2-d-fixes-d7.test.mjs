// 2.12.3 (D7) — one Studio correction ended up with two paths (live 2026-10-06): Lega proposed the correction as ONE plan (apply → draft
// render → QA), the Studio showed only its empty form, the owner re-typed the edit and applied it patch-only (v9: no render, no QA), and the
// Lega plan stayed PROPOSED for a review that could never be applied again.
// Now the plan's ONE confirmation in the owner session is the path for a review bound to a live plan (the cockpit card or the same card in
// the Studio); the Studio's direct apply refuses it (REVIEW_IN_PLAN), refuses a version a confirmed plan is correcting (EDIT_PLAN_ACTIVE),
// and closes the proposed correction plans its own apply / dismissal made obsolete. The edit-version read names each review's plan.
// PASS_SIMULATED: test Hubs (commands on the owner / ui / voice channels, the HTTP routes with the owner cookie), real ffmpeg/ffprobe for the
// live sequence (SKIPPED_ENV when absent), the pure Studio logic; no model, no live Hub, no network.
// Hand mutations (break → the named tests turn red → exact bytes restored → green), recorded here:
//  M1 the `if (own) throw … REVIEW_IN_PLAN` in media.edit.patch.apply → D7-01, D7-03, D7-04 · M2 supersedeCorrections({ editVersionId })
//  after a direct apply → D7-05 · M3 supersedeCorrections({ reviewId }) in dismiss → D7-02 · M4 the `plan` annotation in media-routes →
//  D7-03 · M5 the `review.plan` branch of proposalAction → D7-06 · M6 the EDIT_PLAN_ACTIVE check → D7-05.
// D7 review (2.12.3): the live sequence was „the same sentence retyped in the Studio, then Aplică” — a review with no plan on the version
// a PROPOSED plan is waiting to correct. That apply is refused too (EDIT_PLAN_PROPOSED; the plan stays, no version is created) until the
// plan is confirmed or closed with „Nu acum”; the Studio keeps the waiting plan's card instead of Aplică. Hand mutations: M7 drop the
// EDIT_PLAN_PROPOSED check → D7-07, D7-05 · M8 the "waiting" branch of proposalAction → D7-06.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import http from "node:http";
import { makeTestHub, enrolOwner, tempDir } from "./helpers.mjs";
import { asOwner, asChannel } from "./m10-helpers.mjs";
import { realLaunchers, makeSyntheticMedia } from "./media-helpers.mjs";
import { insertEditVersion } from "../server/media/review.mjs";
import { createHttpServer } from "../server/http/server.mjs";
import { SESSION_COOKIE } from "../server/owner/trust.mjs";
import { studioReviewParam, proposalAction, studioPlanReview, studioRoute, waitingCorrection, waitingStillWaits } from "../web/src/lib/studioLogic.js";

const launchers = realLaunchers();
const needTools = launchers.available ? false : "SKIPPED_ENV: ffmpeg/ffprobe absent";
const as = (t, owner, type, payload) => t.hub.commands.dispatch({ type, payload, channel: "test", actor: "owner:test", ownerSession: owner?.session || null }).then((r) => r.result);
const intent = (t, owner, payload) => t.hub.commands.dispatch({ type: "owner.intent", payload: { source: "typed", ...payload }, channel: "owner", actor: `owner:${owner.session.id}`, ownerSession: owner.session }).then((r) => r.result);
const setPolicy = (t, patch) => t.hub.bus.transaction(() => t.hub.settings.set("mediaPolicy", { ...t.hub.settings.get("mediaPolicy"), ...patch }, "test"));
const count = (t, sql, ...args) => t.hub.db.prepare(sql).get(...args).n;
const rejectsWith = (p, code, check = () => {}) => assert.rejects(p, (e) => { assert.equal(e.code, code, `${e.code}: ${e.message}`); check(e); return true; });
const versionsOf = (t, editProjectId) => count(t, "SELECT COUNT(*) AS n FROM media_edit_versions WHERE edit_project_id = ?", editProjectId);
const planStatus = (t, id) => t.hub.opsPlans.view(id).status;
const setPlanStatus = (t, id, status) => t.hub.bus.transaction(() => t.hub.db.prepare("UPDATE ops_plans SET status = ? WHERE id = ?").run(status, id));
const proposedOpsPlan = async (t) => (await t.hub.cockpit.projectCockpit(t.hub.projects.hub().id)).proposedOpsPlan;

const irOf = (assetVersionId, frames = 60) => ({
  irVersion: 1, fps: { num: 30, den: 1 }, canvas: { width: 640, height: 360, background: "#0B0D10" }, preset: { id: "ifrim-tech", version: 1 }, language: "ro",
  tracks: [
    { id: "v1", kind: "video", clips: [{ id: "c1", assetVersionId, sourceIn: 0, sourceOut: frames, start: 0, label: "SIMULATION" }] },
    { id: "t1", kind: "text", items: [{ id: "lbl", start: 0, end: frames, text: "SIMULARE · date de test", style: "label", anchor: "top", x: 0.5, y: 0.06 }] },
    { id: "t2", kind: "text", items: [{ id: "txt", start: 0, end: frames, text: "Un singur plan, o confirmare", style: "hook", anchor: "bottom", x: 0.5, y: 0.8 }] },
  ],
  markers: [], loudness: { targetLufs: -14, maxTruePeakDb: -1 }, meta: { title: "Clip test", labels: ["SIMULATION"], author: "test", notes: "" } });

/** A content project with ONE edit plan whose current version shows a text between 10 and 15 s (a fake asset: proposals and plans only). */
function seedClip(hub, title = "Demo corectură") {
  const project = hub.media.content.createProject({ title, platforms: ["youtube"] }, "test");
  const at = new Date().toISOString();
  const editId = `mep_test_${Math.random().toString(36).slice(2, 10)}`;
  hub.bus.transaction(() => hub.db.prepare("INSERT INTO media_edit_projects (id, content_project_id, title, current_version, created_by, created_at, updated_at) VALUES (?, ?, ?, 0, 'test', ?, ?)")
    .run(editId, project.id, `Montaj ${title}`, at, at));
  const ir = { irVersion: 1, fps: { num: 30, den: 1 }, canvas: { width: 1080, height: 1920, background: "#0B0D10" }, preset: { id: "ifrim-tech", version: 1 }, language: "ro",
    tracks: [
      { id: "v1", kind: "video", clips: [{ id: "c1", assetVersionId: "mav_fake_1", sourceIn: 0, sourceOut: 900, start: 0, speed: 1, fit: "cover" }] },
      { id: "t1", kind: "text", items: [{ id: "x1", start: 300, end: 450, text: "Butonul de plată", style: "title", anchor: "top", x: 0.5, y: 0.6, maxWidth: 0.86 }] },
    ],
    markers: [], evidenceRegions: [], loudness: { targetLufs: -14, maxTruePeakDb: -1 }, meta: { title, labels: [] } };
  const version = insertEditVersion(hub.db, hub.bus, () => new Date(), { editProjectId: editId, ir, changeKind: "initial", change: { reason: "test" }, validation: { ok: true }, actor: "test" });
  return { project, editId, version };
}
/** A correction proposed on a version (as Lega's sentence does: the review row with its patch). */
const review = (t, version, text = "La secunda 12 mută textul mai sus", timecodeMs = 12000) =>
  t.hub.media.reviews.propose({ editVersionId: version.id, text, timecodeMs, provenance: "owner-typed", actor: "test" });
/** The plan Lega proposes for that review — the exact step shape of ops/intent-actions.mjs editPlan (no tools needed to propose it). */
const correctionPlan = (t, owner, rv, version) => t.hub.opsPlans.propose({ kind: "studio.edit", title: "Corectură în „Demo corectură”",
  steps: [{ kind: "media.edit.correct", params: { editVersionId: version.id, text: rv.text, atSec: rv.timecodeMs != null ? rv.timecodeMs / 1000 : null, reviewId: rv.id, render: "draft" } }],
  actor: `owner:${owner.session.id}`, via: "owner" });

async function httpHub(opts = {}) {
  const t = await makeTestHub(opts);
  const { server, token } = createHttpServer(t.hub);
  await new Promise((r) => server.listen(t.config.port, "127.0.0.1", r));
  const host = `localhost:${t.config.port}`;
  const call = (method, p, { body, cookie = null } = {}) => new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request({ host: "127.0.0.1", port: t.config.port, method, path: p, headers: { Host: host, Origin: `http://${host}`, ...(method !== "GET" ? { "X-Hub-Token": token } : {}),
      ...(cookie ? { Cookie: `${SESSION_COOKIE}=${cookie}` } : {}), ...(data ? { "Content-Type": "application/json", "Content-Length": data.length } : {}) } }, (res) => {
      const chunks = []; res.on("data", (c) => chunks.push(c)); res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json = null; try { json = JSON.parse(text); } catch { /* */ }
        resolve({ status: res.statusCode, json, text });
      });
    });
    req.on("error", reject); if (data) req.write(data); req.end();
  });
  return { ...t, call, stop: async () => { server.closeAllConnections?.(); await new Promise((r) => server.close(r)); await t.cleanup(); } };
}

test("D7-01 a direct apply of a review bound to a PROPOSED plan is refused on the owner and ui channels; nothing changes", async () => {
  const t = await makeTestHub();
  try {
    const owner = await enrolOwner(t);
    const { editId, version } = seedClip(t.hub);
    const rv = review(t, version);
    assert.ok((rv.patch?.ops || []).length, JSON.stringify(rv.patch));
    const plan = await correctionPlan(t, owner, rv, version);
    const check = (e) => {
      assert.equal(e.details?.planId, plan.id);
      assert.equal(e.details?.status, "PROPOSED");
      assert.match(e.message, /confirmi o dată/);
      assert.doesNotMatch(e.message, /opp_|mrv_/, "no ids in the owner's text");
    };
    await rejectsWith(asOwner(t, owner, "media.edit.patch.apply", { reviewId: rv.id }), "REVIEW_IN_PLAN", check);
    await rejectsWith(asChannel(t, "ui", "media.edit.patch.apply", { reviewId: rv.id }), "REVIEW_IN_PLAN", check);
    assert.equal(versionsOf(t, editId), 1);
    assert.equal(t.hub.media.reviews.get(rv.id).status, "OPEN");
    assert.equal(planStatus(t, plan.id), "PROPOSED");
    const bound = t.hub.opsPlans.correctionPlans({ reviewId: rv.id });
    assert.deepEqual(bound, [{ id: plan.id, status: "PROPOSED", reviewId: rv.id, editVersionId: version.id, expired: false }]);
    assert.ok(!("nonce" in bound[0]) && !("hash" in bound[0]));
    assert.deepEqual(t.hub.opsPlans.correctionPlans({}), [], "no arguments → nothing");
  } finally { await t.cleanup(); }
});

test("D7-02 dismiss: closes the proposed plan with it (any channel); a confirmed / waiting plan keeps both dismiss and apply refused", async () => {
  const t = await makeTestHub();
  try {
    const owner = await enrolOwner(t);
    const { version } = seedClip(t.hub);
    const rv = review(t, version);
    const plan = await correctionPlan(t, owner, rv, version);
    assert.ok(await proposedOpsPlan(t), "the card waits in the cockpit");
    const out = await asChannel(t, "voice", "media.edit.patch.dismiss", { reviewId: rv.id });
    assert.equal(out.status, "DISMISSED");
    const p = t.hub.opsPlans.view(plan.id);
    assert.equal(p.status, "SUPERSEDED");
    assert.match(p.statusReason, /renunțat/);
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM events WHERE type = 'ops.plan.superseded' AND scope_id = ?", plan.id), 1);
    assert.equal(await proposedOpsPlan(t), null, "no orphaned card");
    // A second review whose plan waits for the owner (NEEDS_OWNER): its card decides, never a separate dismiss or apply.
    const rv2 = review(t, version, "La secunda 11 mută textul mai jos", 11000);
    const plan2 = await correctionPlan(t, owner, rv2, version);
    setPlanStatus(t, plan2.id, "NEEDS_OWNER");
    const check = (e) => { assert.equal(e.details?.planId, plan2.id); assert.equal(e.details?.status, "NEEDS_OWNER"); };
    await rejectsWith(asChannel(t, "voice", "media.edit.patch.dismiss", { reviewId: rv2.id }), "REVIEW_IN_PLAN", check);
    await rejectsWith(asOwner(t, owner, "media.edit.patch.apply", { reviewId: rv2.id }), "REVIEW_IN_PLAN", check);
    assert.equal(t.hub.media.reviews.get(rv2.id).status, "OPEN");
  } finally { await t.cleanup(); }
});

test("D7-03 HTTP: the edit-version read names each review's plan ({ id, status } only, no nonce); the Studio's apply gets an honest 409", async () => {
  const t = await httpHub();
  try {
    const owner = await enrolOwner(t);
    const { version } = seedClip(t.hub);
    const bound = review(t, version);
    const free = review(t, version, "La secunda 13 mută textul mai jos", 13000);
    const plan = await correctionPlan(t, owner, bound, version);
    const got = await t.call("GET", `/api/media/edit-versions/${version.id}`, { cookie: owner.token });
    assert.equal(got.status, 200, got.text);
    const byId = Object.fromEntries(got.json.reviews.map((r) => [r.id, r]));
    assert.deepEqual(byId[bound.id].plan, { id: plan.id, status: "PROPOSED" });
    assert.equal(byId[free.id].plan, null);
    assert.ok(!got.text.includes("nonce"), "no nonce in the Studio's read");
    const apply = await t.call("POST", `/api/media/reviews/${bound.id}/apply`, { body: {}, cookie: owner.token });
    assert.equal(apply.status, 409, apply.text);
    assert.equal(apply.json.error.code, "REVIEW_IN_PLAN");
    assert.equal(apply.json.error.details.planId, plan.id);
  } finally { await t.stop(); }
});

/** The M10-ST-09 setup: pinned tools, a real synthetic clip, one edit plan (v1). */
async function liveStudio(t) {
  const owner = await enrolOwner(t);
  await as(t, owner, "media.tools.pin", {});
  const root = path.join(tempDir("d7-studio"), "Videos");
  setPolicy(t, { importRoots: [root], diskReserveGb: 0, interactivePriority: false });
  const inbox = path.join(root, "in");
  makeSyntheticMedia(inbox, { name: "a.mp4", seconds: 2, width: 640, height: 360 });
  const project = await as(t, owner, "content.project.create", { fields: { title: "Corectură D7", format: "short", platforms: ["linkedin"] } });
  const pid = project.id || project.project?.id;
  const a = await as(t, owner, "media.asset.import", { sourcePath: path.join(inbox, "a.mp4"), title: "a", category: "screen_recording", origin: "OWNED", captureLabel: "SIMULATION", contentProjectId: pid });
  const edit = await as(t, owner, "media.edit.create", { contentProjectId: pid, title: "Montaj", ir: irOf(a.version.id) });
  return { owner, pid, edit, editId: edit.version.editProjectId, v1: edit.version };
}

test("D7-04 the live sequence: the Studio apply of Lega's correction is refused; the card's ONE confirmation applies, renders and runs QA; never twice", { skip: needTools }, async () => {
  const t = await makeTestHub({ configOverrides: { mediaTools: { launcher: launchers } } });
  try {
    const { owner, pid, editId, v1 } = await liveStudio(t);
    const r = (await intent(t, owner, { text: "La secunda 1 mută textul mai sus" })).results[0];
    const reviewId = r.studio?.reviewId;
    assert.ok(reviewId && r.opsPlan, JSON.stringify(r));
    assert.ok(r.navigate.endsWith(`/studio/${pid}?t=1&review=${reviewId}`), r.navigate);
    // The owner, in the Studio, presses the old Aplică: refused, nothing written.
    await rejectsWith(asOwner(t, owner, "media.edit.patch.apply", { reviewId }), "REVIEW_IN_PLAN");
    assert.equal(versionsOf(t, editId), 1);
    // The card's confirmation (the Studio's OpsPlanCard posts exactly this).
    const shown = t.hub.opsPlans.view(r.opsPlan.id);
    await asOwner(t, owner, "ops.plan.confirm", { planId: shown.id, nonce: shown.nonce, displayedHash: shown.hash });
    const done = await t.hub.opsPlans.idle(shown.id);
    assert.equal(done.status, "DONE", `${done.statusReason} ${done.steps.at(-1)?.error}`);
    assert.equal(versionsOf(t, editId), 2);
    const v2 = t.hub.db.prepare("SELECT id, change_json FROM media_edit_versions WHERE edit_project_id = ? AND version = 2").get(editId);
    assert.equal(JSON.parse(v2.change_json).reviewId, reviewId);
    const rv = t.hub.media.reviews.get(reviewId);
    assert.equal(rv.status, "APPLIED");
    assert.equal(rv.resultVersionId, v2.id);
    assert.equal(rv.editVersionId, v1.id);
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM media_render_jobs WHERE edit_version_id = ? AND status = 'DONE' AND profile = 'draft'", v2.id), 1);
    assert.ok(count(t, "SELECT COUNT(*) AS n FROM media_qa_reports WHERE edit_version_id = ?", v2.id) >= 1);
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM ops_plans WHERE status = 'PROPOSED'"), 0);
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM events WHERE type = 'ops.plan.consent' AND scope_id = ?", shown.id), 1);
    // The cockpit's stale „Da” for the same card: refused, nothing applied twice.
    await assert.rejects(asOwner(t, owner, "ops.plan.confirm", { planId: shown.id, nonce: shown.nonce, displayedHash: shown.hash }), /nu mai așteaptă confirmarea/);
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM events WHERE type = 'ops.plan.consent' AND scope_id = ?", shown.id), 1);
    assert.equal(versionsOf(t, editId), 2);
  } finally { await t.cleanup(); }
});

test("D7-05 the Studio's own correction: refused while Lega's plan waits; after „Nu acum” applied (M09); a busy version refused; an expired plan no longer binds and is closed", { skip: needTools }, async () => {
  const clock = { now: Date.now() };
  const t = await makeTestHub({ clock: () => new Date(clock.now), configOverrides: { mediaTools: { launcher: launchers } } });
  try {
    const { owner, editId, v1 } = await liveStudio(t);
    const r = (await intent(t, owner, { text: "La secunda 1 mută textul mai sus" })).results[0];
    const P = r.opsPlan.id;
    assert.equal(planStatus(t, P), "PROPOSED");
    // The live sequence: the SAME sentence retyped in the Studio (a review with no plan) on the version P is waiting to correct → refused.
    const B = await asOwner(t, owner, "media.edit.patch.propose", { editVersionId: v1.id, text: "La secunda 1 mută textul mai sus", timecodeMs: 1000 });
    assert.deepEqual(t.hub.opsPlans.correctionPlans({ reviewId: B.id }), []);
    await rejectsWith(asOwner(t, owner, "media.edit.patch.apply", { reviewId: B.id }), "EDIT_PLAN_PROPOSED", (e) => {
      assert.equal(e.details?.planId, P);
      assert.equal(e.details?.reviewId, r.studio.reviewId);
      assert.match(e.message, /Nu acum/);
      assert.doesNotMatch(e.message, /opp_|mrv_/);
    });
    assert.equal(versionsOf(t, editId), 1, "no version without its render and QA");
    assert.equal(planStatus(t, P), "PROPOSED");
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM media_render_jobs"), 0);
    // „Nu acum” on the card (ops.plan.cancel): now the Studio's own correction is the M09 apply.
    await asOwner(t, owner, "ops.plan.cancel", { planId: P, reason: "Anulat din card" });
    assert.equal(planStatus(t, P), "CANCELLED");
    const applied = await asOwner(t, owner, "media.edit.patch.apply", { reviewId: B.id });
    const v2 = applied.version;
    assert.equal(versionsOf(t, editId), 2);
    assert.equal(await proposedOpsPlan(t), null);
    const presented = { planId: P, nonce: r.opsPlan.nonce, displayedHash: r.opsPlan.hash };
    await assert.rejects(asOwner(t, owner, "ops.plan.confirm", presented), /nu mai așteaptă confirmarea/);
    // A plan on v2 that the owner confirmed and that is paused now: another Studio correction on v2 waits for it.
    const C = review(t, v2, "La secunda 1 mută textul mai sus", 1000);
    const Q = await correctionPlan(t, owner, C, v2);
    setPlanStatus(t, Q.id, "PAUSED");
    const D = await asOwner(t, owner, "media.edit.patch.propose", { editVersionId: v2.id, text: "La secunda 1 mută textul mai jos", timecodeMs: 1000 });
    await rejectsWith(asOwner(t, owner, "media.edit.patch.apply", { reviewId: D.id }), "EDIT_PLAN_ACTIVE", (e) => { assert.equal(e.details?.planId, Q.id); assert.equal(e.details?.status, "PAUSED"); });
    assert.equal(versionsOf(t, editId), 2);
    // Expiry: a plan not confirmed within its window no longer binds its review; the M09 apply then closes it.
    setPlanStatus(t, Q.id, "CANCELLED");
    const E = review(t, v2, "La secunda 1 mută textul mai sus", 1000);
    const R = await correctionPlan(t, owner, E, v2);
    clock.now += 16 * 60000;
    assert.deepEqual(t.hub.opsPlans.correctionPlans({ reviewId: E.id }).map((x) => [x.id, x.expired]), [[R.id, true]]);
    const late = await asOwner(t, owner, "media.edit.patch.apply", { reviewId: E.id });
    assert.ok(late.version?.id);
    assert.equal(versionsOf(t, editId), 3);
    assert.equal(planStatus(t, R.id), "SUPERSEDED");
    assert.match(t.hub.opsPlans.view(R.id).statusReason, /corectată direct în Studio/);
    // An EXPIRED plan of another review on the same version never blocks the Studio's own correction; the apply closes it.
    const v3 = late.version;
    const F = review(t, v3, "La secunda 1 mută textul mai sus", 1000);
    const S = await correctionPlan(t, owner, F, v3);
    clock.now += 16 * 60000;
    const G = await asOwner(t, owner, "media.edit.patch.propose", { editVersionId: v3.id, text: "La secunda 1 mută textul mai jos", timecodeMs: 1000 });
    const own = await asOwner(t, owner, "media.edit.patch.apply", { reviewId: G.id });
    assert.ok(own.version?.id);
    assert.equal(versionsOf(t, editId), 4);
    assert.equal(planStatus(t, S.id), "SUPERSEDED");
  } finally { await t.cleanup(); }
});

test("D7-06 pure Studio logic: the review deep link, the panel's action (the plan's card vs the M09 apply), the proposal it opens with", () => {
  assert.equal(studioReviewParam({ review: "mrv_abc123" }), "mrv_abc123");
  for (const bad of [{ review: "../x" }, { review: "<b>" }, {}, null, { review: 12 }]) assert.equal(studioReviewParam(bad), null, JSON.stringify(bad));
  assert.deepEqual(Object.keys(studioRoute("cp_1", { t: "12", review: "mrv_abc123" })).sort(), ["projectId", "sub", "tMs", "tab", "versionId"], "studioRoute keeps its shape");
  const ops = { ops: [{ op: "text.move" }], preview: { valid: true } };
  assert.deepEqual(proposalAction({ id: "r1", status: "OPEN", patch: ops, plan: { id: "opp_1", status: "PROPOSED" } }), { kind: "plan", planId: "opp_1", status: "PROPOSED" });
  assert.deepEqual(proposalAction({ id: "r1", status: "APPLIED", patch: ops, plan: { id: "opp_1", status: "RUNNING" } }), { kind: "plan", planId: "opp_1", status: "RUNNING" });
  assert.deepEqual(proposalAction({ id: "r1", status: "OPEN", patch: ops, plan: null }), { kind: "apply" });
  assert.deepEqual(proposalAction({ id: "r1", status: "OPEN", patch: { ops: ops.ops, preview: { valid: false } } }), { kind: "none" });
  assert.deepEqual(proposalAction({ id: "r1", status: "OPEN", patch: { ops: [], clarification: "Care text?" } }), { kind: "none" });
  assert.deepEqual(proposalAction({ id: "r1", status: "DISMISSED", patch: ops }), { kind: "none" });
  assert.deepEqual(proposalAction(null), { kind: "none" });
  // D7 review: another proposal of the version waits for its plan → the waiting plan decides first (never the M09 Aplică).
  const waitingA = { id: "a", status: "OPEN", patch: ops, plan: { id: "opp_a", status: "PROPOSED" } };
  const typedB = { id: "b", status: "OPEN", patch: ops, plan: null };
  assert.deepEqual(proposalAction(typedB, [waitingA, typedB]), { kind: "waiting", planId: "opp_a", status: "PROPOSED", reviewId: "a" });
  assert.deepEqual(proposalAction(typedB, [{ ...waitingA, plan: { id: "opp_a", status: "CANCELLED" } }, typedB]), { kind: "apply" }, "a closed plan no longer waits");
  assert.deepEqual(proposalAction(typedB, [{ ...waitingA, status: "DISMISSED" }, typedB]), { kind: "apply" });
  assert.deepEqual(proposalAction(waitingA, [waitingA, typedB]), { kind: "plan", planId: "opp_a", status: "PROPOSED" }, "its own plan's card");
  assert.equal(waitingCorrection([waitingA, typedB], "a"), null);
  assert.equal(waitingCorrection([waitingA, typedB], "b"), waitingA);
  const waitingAction = { kind: "waiting", planId: "opp_a" };
  assert.equal(waitingStillWaits(waitingAction, null), true, "no live view yet → still waiting");
  assert.equal(waitingStillWaits(waitingAction, { id: "opp_other", status: "CANCELLED" }), true, "another plan's view says nothing");
  assert.equal(waitingStillWaits(waitingAction, { id: "opp_a", status: "PROPOSED", confirmBy: new Date(Date.now() + 60000).toISOString() }), true);
  assert.equal(waitingStillWaits(waitingAction, { id: "opp_a", status: "PROPOSED", confirmBy: new Date(Date.now() - 1000).toISOString() }), false, "expired");
  for (const st of ["CANCELLED", "CONFIRMED", "RUNNING", "SUPERSEDED", "EXPIRED"]) assert.equal(waitingStillWaits(waitingAction, { id: "opp_a", status: st }), false, st);
  assert.equal(waitingStillWaits({ kind: "apply" }, null), false);
  const a = { id: "a", status: "OPEN", plan: { id: "opp_a", status: "PROPOSED" } };
  const b = { id: "b", status: "OPEN", plan: null };
  const c = { id: "c", status: "OPEN", plan: { id: "opp_c", status: "PROPOSED" } };
  const applied = { id: "d", status: "APPLIED", plan: null };
  assert.equal(studioPlanReview([a, b, applied], "d"), applied, "the deep link wins");
  assert.equal(studioPlanReview([a, b], "missing"), a, "a deep link not on this version → the one waiting plan");
  assert.equal(studioPlanReview([a, b]), a);
  assert.equal(studioPlanReview([a, b, c]), null, "two waiting plans: none is guessed");
  assert.equal(studioPlanReview([b]), null);
  assert.equal(studioPlanReview(undefined), null);
});

test("D7-07 Lega's plan P waits; the same sentence retyped as review B on the same version: apply B is refused (owner, ui, HTTP 409); no version; P stays PROPOSED", async () => {
  const t = await httpHub();
  try {
    const owner = await enrolOwner(t);
    const { editId, version } = seedClip(t.hub);
    const A = review(t, version);
    const P = await correctionPlan(t, owner, A, version);
    const B = review(t, version);
    assert.notEqual(B.id, A.id);
    assert.deepEqual(t.hub.opsPlans.correctionPlans({ reviewId: B.id }), [], "B has no plan of its own");
    assert.deepEqual(t.hub.opsPlans.correctionPlans({ reviewId: B.id, editVersionId: version.id }).map((x) => x.id), [P.id], "P is found through the version");
    const check = (e) => {
      assert.equal(e.details?.planId, P.id);
      assert.equal(e.details?.status, "PROPOSED");
      assert.equal(e.details?.reviewId, A.id);
      assert.match(e.message, /Planul afișat corectează deja această versiune/);
      assert.doesNotMatch(e.message, /opp_|mrv_/, "no ids in the owner's text");
    };
    await rejectsWith(asOwner(t, owner, "media.edit.patch.apply", { reviewId: B.id }), "EDIT_PLAN_PROPOSED", check);
    await rejectsWith(asChannel(t, "ui", "media.edit.patch.apply", { reviewId: B.id }), "EDIT_PLAN_PROPOSED", check);
    const http409 = await t.call("POST", `/api/media/reviews/${B.id}/apply`, { body: {}, cookie: owner.token });
    assert.equal(http409.status, 409, http409.text);
    assert.equal(http409.json.error.code, "EDIT_PLAN_PROPOSED");
    assert.equal(http409.json.error.details.planId, P.id);
    assert.equal(versionsOf(t, editId), 1);
    assert.equal(t.hub.media.reviews.get(B.id).status, "OPEN");
    assert.equal(planStatus(t, P.id), "PROPOSED");
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM events WHERE type = 'ops.plan.superseded' AND scope_id = ?", P.id), 0);
    // Dismissing B stays possible and leaves P alone.
    await asChannel(t, "ui", "media.edit.patch.dismiss", { reviewId: B.id });
    assert.equal(planStatus(t, P.id), "PROPOSED");
  } finally { await t.stop(); }
});
