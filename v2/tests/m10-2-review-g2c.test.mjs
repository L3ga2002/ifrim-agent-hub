// Milestone 10.2 — review group G2c (findings #33, #32). PASS_SIMULATED: fixture providers (fake Codex app-server for Lega), the
// software authenticator, test projects; no model, no live Hub.
//  - #33: a PLANNED / CONFIRMED preserved request whose plan closes without fulfilling it (expired, superseded, cancelled, revoked,
//    failed to start; ops plan expired / superseded / cancelled / failed) goes back to OPEN with its draft link (the draft is not
//    retired), and is re-proposed — never when the owner closed that plan himself, never over another waiting plan (no ping-pong
//    between two requests of one project), after an expiry only once; its own re-proposal is not mistaken for a loss;
//  - #32: a blocked typed analysis request and a blocked Lega propose_run are each kept as a work request with intent "run".
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeTestHub, waitFor, enrolOwner, prepareLiveWithoutGrants } from "./helpers.mjs";
import { materializeFixture } from "../server/factory/fixtures.mjs";
import { LEGA_CONSENT_VERSION } from "../server/policy/lega-policy.mjs";
import { createBlockedRecorder } from "../server/owner/planners/engineering.mjs";

const dispatch = (hub, type, payload, extra = {}) => hub.commands.dispatch({ type, payload, channel: "test", actor: "test", ...extra });
const count = (t, sql, ...args) => t.hub.db.prepare(sql).get(...args).n;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BUG = "Repară bug-ul: un nume format doar din spații trece de validare. Testul de acceptanță e test/acceptance.test.mjs.";
const reopened = (t, id) => t.hub.db.prepare("SELECT payload_json FROM events WHERE type = 'work_request.reopened' AND scope_id = ? ORDER BY seq").all(id).map((r) => JSON.parse(r.payload_json));
const envelopesOf = (t, projectId) => count(t, "SELECT COUNT(*) AS n FROM mission_envelopes WHERE project_id = ?", projectId);

/** Bug-demo test project, Codex listing the role-default writer model, the owner (voice-first), live preconditions without grants. */
async function plannerHub() {
  const t = await makeTestHub({ queues: true });
  fs.writeFileSync(`${t.logs.codex}.models.json`, JSON.stringify([{ id: "gpt-6.1-sol", isDefault: true, efforts: ["medium", "high"] }, { id: "gpt-fake-sol", efforts: ["medium", "high"] }]));
  await prepareLiveWithoutGrants(t.hub);
  const dir = path.join(t.dataDir, "factory-bug-demo");
  materializeFixture("bug-demo", dir);
  const project = (await dispatch(t.hub, "project.register_test", { path: dir })).result;
  const owner = await enrolOwner(t);
  return { ...t, project, owner, ctx: { channel: "owner", ownerSession: owner.session, actor: "owner" } };
}
/** An intake draft + its plan, and a preserved request that became that plan (PLANNED, plan_ref → the envelope + the draft). */
async function plannedRequest(t, text = BUG) {
  const out = await t.hub.intake.plan({ kind: "engineering", text, projectId: t.project.id }, t.ctx);
  const env = out.plan.envelope;
  const missionId = env.missionIds[0];
  const wr = t.hub.workRequests.create({ text, source: "typed", channel: "owner", projectId: t.project.id, intent: "engineering", planRef: { kind: "mission", missionId }, actor: "test" });
  t.hub.workRequests.markPlanned(wr.id, { kind: "envelope", id: env.id, missionId }, { headline: "Plan" });
  assert.equal(t.hub.workRequests.get(wr.id).status, "PLANNED");
  return { wr, env, missionId };
}
const expireEnvelope = (t, id) => { t.hub.db.prepare("UPDATE mission_envelopes SET confirm_by = ? WHERE id = ?").run(new Date(Date.now() - 1000).toISOString(), id); t.hub.envelopes.tick(); };
const stageOf = (t, missionId) => t.hub.factory.view(missionId).factory.stage;
const plannedNotice = (t, wrId) => t.hub.readiness.noticesFor(t.project.id).find((n) => n.kind === "work_request" && n.id === wrId && /plan pregătit/.test(n.text));

// ---------------------------------------------------------------- #33
test("G2c-33a an expired plan reopens its PLANNED request (draft kept, no false „plan pregătit”); re-proposed once, then it stays OPEN", async () => {
  const t = await plannerHub();
  try {
    const { wr, env, missionId } = await plannedRequest(t);
    expireEnvelope(t, env.id);
    assert.equal(t.hub.envelopes.get(env.id).status, "EXPIRED");
    // Synchronous in the same subscriber pass: no longer PLANNED behind the expired plan, draft link kept, signature cleared.
    const now = t.hub.workRequests.get(wr.id);
    assert.ok(now.status !== "PLANNED" || now.planRef?.id !== env.id, `not PLANNED behind the expired plan (${now.status} ${JSON.stringify(now.planRef)})`);
    assert.deepEqual(reopened(t, wr.id).map((p) => [p.from, p.planStatus, p.planId]), [["PLANNED", "EXPIRED", env.id]]);
    await sleep(400); // the draft cleanup's setImmediate and the one re-proposal ran
    assert.equal(stageOf(t, missionId), "SPEC_DRAFT", "the draft the request points to is not retired");
    const after = t.hub.workRequests.get(wr.id);
    assert.equal(after.planRef?.missionId, missionId, "the draft link survives");
    // Re-proposed once (nothing blocks this test project): a NEW plan over the same draft, waiting for the owner (the notice is true now).
    assert.equal(after.status, "PLANNED", JSON.stringify(after).slice(0, 300));
    assert.notEqual(after.planRef.id, env.id);
    const env2 = t.hub.envelopes.get(after.planRef.id);
    assert.equal(env2.status, "PROPOSED");
    assert.deepEqual(env2.missionIds, [missionId]);
    // That one is ignored too: the request goes back to OPEN and is NOT re-presented again (no plan every 15 minutes for a week).
    const before = envelopesOf(t, t.project.id);
    expireEnvelope(t, env2.id);
    await sleep(400);
    assert.equal(envelopesOf(t, t.project.id), before, "no third plan after a second expiry");
    const last = t.hub.workRequests.get(wr.id);
    assert.equal(last.status, "OPEN");
    assert.equal(last.blockerSignature, "", "the next mention is explained in full");
    assert.equal(stageOf(t, missionId), "SPEC_DRAFT");
    assert.equal(plannedNotice(t, wr.id), undefined, "no „plan pregătit” notice while no plan waits");
  } finally { await t.cleanup(); }
});

test("G2c-33b a plan superseded by ANOTHER request's plan reopens the request without re-proposing over the newer plan (no ping-pong)", async () => {
  const t = await plannerHub();
  try {
    const a = await plannedRequest(t);
    const before = envelopesOf(t, t.project.id);
    // Another request on the same project presents its plan: it supersedes A's (one pending plan per project).
    const b = await t.hub.intake.plan({ kind: "engineering", text: "Refactorizează validarea solicitărilor; testul e test/unit.test.mjs", projectId: t.project.id }, t.ctx);
    assert.equal(t.hub.envelopes.get(a.env.id).status, "SUPERSEDED");
    await sleep(500);
    assert.equal(t.hub.workRequests.get(a.wr.id).status, "OPEN", "A is no longer PLANNED behind a superseded plan");
    assert.equal(t.hub.envelopes.get(b.plan.envelope.id).status, "PROPOSED", "the newer plan the owner sees is left alone");
    assert.equal(envelopesOf(t, t.project.id), before + 1, "A was not re-proposed over B's plan");
    assert.equal(stageOf(t, a.missionId), "SPEC_DRAFT", "A's draft is held by A (OPEN)");
  } finally { await t.cleanup(); }
});

test("G2c-33c the owner cancelling / revoking the plan reopens the request but never re-proposes it", async () => {
  const t = await plannerHub();
  try {
    const { wr, env, missionId } = await plannedRequest(t);
    const before = envelopesOf(t, t.project.id);
    t.hub.envelopes.revoke(env.id, { actor: "owner", reason: "Nu acum" });
    assert.equal(t.hub.envelopes.get(env.id).status, "CANCELLED");
    await sleep(400);
    const r = t.hub.workRequests.get(wr.id);
    assert.equal(r.status, "OPEN");
    assert.deepEqual(r.planRef, { kind: "mission", missionId });
    assert.equal(envelopesOf(t, t.project.id), before, "the owner's cancel is not undone by a re-proposal");
    assert.equal(stageOf(t, missionId), "SPEC_DRAFT");
    // A cancelled request lets its draft go (the existing cleanup path, unchanged).
    t.hub.workRequests.cancel(wr.id, "owner");
    await waitFor(() => stageOf(t, missionId) === "CANCELLED", 5000);
  } finally { await t.cleanup(); }
});

test("G2c-33d a CONFIRMED request's plan expiring reopens it without its consent; a FAILED ops plan reopens its request", async () => {
  const t = await plannerHub();
  try {
    const { wr, env } = await plannedRequest(t);
    t.hub.db.prepare("UPDATE work_requests SET status = 'CONFIRMED', consent_json = ? WHERE id = ?").run(JSON.stringify({ channel: "owner_session", sessionId: t.owner.session.id, envelopeId: env.id }), wr.id);
    assert.ok(t.hub.workRequests.confirmedForReadiness(wr.id));
    expireEnvelope(t, env.id);
    const r = t.hub.workRequests.get(wr.id);
    assert.notEqual(r.status, "CONFIRMED");
    assert.equal(r.consent, null, "the consent referred to the closed plan");
    assert.equal(t.hub.workRequests.confirmedForReadiness(wr.id), null, "no readiness authority survives the closed plan");
    assert.equal(reopened(t, wr.id)[0].from, "CONFIRMED");

    const other = t.hub.workRequests.create({ text: "o operație", source: "typed", channel: "owner", intent: "other", actor: "test" });
    t.hub.workRequests.markPlanned(other.id, { kind: "ops", id: "opp_g2c_failed" }, { headline: "Op" });
    t.hub.bus.transaction(() => t.hub.bus.append({ type: "ops.plan.failed", scopeType: "ops_plan", scopeId: "opp_g2c_failed", source: "ops", payload: {} }));
    const o = t.hub.workRequests.get(other.id);
    assert.ok(["OPEN", "BLOCKED"].includes(o.status), o.status);
    assert.equal(o.planRef, null);
    assert.equal(reopened(t, other.id)[0].planStatus, "FAILED");
    // An unrelated ops plan closing touches nothing.
    const third = t.hub.workRequests.create({ text: "altă operație", source: "typed", channel: "owner", intent: "other", actor: "test" });
    t.hub.workRequests.markPlanned(third.id, { kind: "ops", id: "opp_g2c_keep" }, { headline: "Op" });
    t.hub.bus.transaction(() => t.hub.bus.append({ type: "ops.plan.expired", scopeType: "ops_plan", scopeId: "opp_g2c_unrelated", source: "ops", payload: {} }));
    assert.equal(t.hub.workRequests.get(third.id).status, "PLANNED");
  } finally { await t.cleanup(); }
});

test("G2c-33e a CONFIRMED request re-planning supersedes its own old plan: that is its re-proposal, not a loss (still afterReadiness)", async () => {
  const t = await plannerHub();
  try {
    const { wr, env } = await plannedRequest(t);
    t.hub.db.prepare("UPDATE work_requests SET status = 'CONFIRMED', consent_json = ? WHERE id = ?").run(JSON.stringify({ channel: "owner_session", sessionId: t.owner.session.id, envelopeId: env.id, body: { attestationRefs: [] } }), wr.id);
    const seen = [];
    const off = t.hub.bus.subscribe((e) => { if (e.type === "lega.plan" && e.scopeId === wr.id) seen.push(e.payload); });
    const out = await t.hub.workRequests.replan(wr.id);
    off();
    assert.equal(t.hub.envelopes.get(env.id).status, "SUPERSEDED", "the re-proposal superseded the old plan");
    assert.equal(reopened(t, wr.id).length, 0, "its own re-proposal does not reopen it");
    if (out.status === "PLANNED") {
      assert.notEqual(t.hub.workRequests.get(wr.id).planRef.id, env.id);
      assert.equal(seen.at(-1)?.afterReadiness, true, "announced as the plan after the readiness the owner confirmed");
    } else assert.equal(out.status, "CONFIRMED", JSON.stringify(out).slice(0, 300));
  } finally { await t.cleanup(); }
});

test("G2c-33f the draft cleanup keeps a draft a PLANNED request still points to", async () => {
  const t = await plannerHub();
  try {
    const { wr, env, missionId } = await plannedRequest(t);
    // The plan is gone without an event the service saw (e.g. a direct row change): the request is still PLANNED → held.
    t.hub.db.prepare("UPDATE mission_envelopes SET status = 'EXPIRED' WHERE id = ?").run(env.id);
    assert.equal(t.hub.workRequests.get(wr.id).status, "PLANNED");
    const out = await t.hub.engineeringPlanner.cleanupDraft(missionId, "test");
    assert.equal(out.skipped, "kept by a preserved request");
    assert.equal(stageOf(t, missionId), "SPEC_DRAFT");
  } finally { await t.cleanup(); }
});

// ---------------------------------------------------------------- #32 (already fixed: intent "run" accepted, analysis_request mapped)
test("G2c-32a the recorder keeps run / analysis_request as intent „run” (the work-request service accepts it)", async () => {
  const t = await makeTestHub();
  try {
    const rec = createBlockedRecorder(t.hub);
    for (const intent of ["analysis_request", "run"]) {
      const kept = rec.recordBlocked({ text: `Analizează proiectul (${intent})`, intent, blocker: { signature: "HOST_R2_OPEN", text: "Blocat de R2." }, actor: "test" });
      assert.ok(kept?.id, intent);
      assert.equal(t.hub.workRequests.get(kept.id).intent, "run", intent);
    }
  } finally { await t.cleanup(); }
});

test("G2c-32b a blocked typed analysis request is kept once with intent „run”", async () => {
  const t = await makeTestHub();
  try {
    await prepareLiveWithoutGrants(t.hub);
    const owner = await enrolOwner(t);
    const hubP = t.hub.projects.hub();
    const ask = () => t.hub.commands.dispatch({ type: "owner.intent", payload: { text: "Analizează structura proiectului și rezumă modulele", projectId: hubP.id }, channel: "owner",
      actor: `owner:${owner.session.id}`, ownerSession: owner.session }).then((r) => r.result);
    const first = await ask();
    const steps = first.results || [first];
    const step = steps.find((s) => s.workRequest || s.blockedBy) || steps[0];
    assert.ok(step.blockedBy, JSON.stringify(first).slice(0, 600));
    assert.ok(step.workRequest?.id, `kept (${step.workRequestError || ""})`);
    assert.equal(t.hub.workRequests.get(step.workRequest.id).intent, "run");
    const again = await ask();
    const step2 = (again.results || [again]).find((s) => s.workRequest) || {};
    assert.equal(step2.workRequest?.id, step.workRequest.id, "the same request, not a second one");
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM work_requests WHERE intent = 'run'"), 1);
  } finally { await t.cleanup(); }
});

const OFFER = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n";
const calls = (list) => `lega-calls:${Buffer.from(JSON.stringify(list)).toString("base64url")}`;

test("G2c-32c a blocked Lega propose_run is kept as a work request with intent „run”", async () => {
  const probe = await makeTestHub({ codex: "lega-ok" });
  const hubName = probe.hub.projects.hub().name;
  await probe.cleanup();
  const t = await makeTestHub({ codex: calls([{ tool: "propose_run", args: { project: hubName, provider: "codex", task: "Citește README și rezumă-l." } }]) });
  try {
    const owner = await enrolOwner(t, { activatePolicy: true });
    await prepareLiveWithoutGrants(t.hub);
    t.hub.bus.transaction(() => t.hub.settings.set("legaConsent", { version: LEGA_CONSENT_VERSION, confirmedAt: new Date().toISOString() }, "test"));
    t.hub.refreshCodexConfig();
    const s = (await t.hub.commands.dispatch({ type: "lega.session.start", channel: "owner", actor: `owner:${owner.session.id}`, ownerSession: owner.session, payload: { sdp: OFFER } })).result;
    await t.hub.commands.dispatch({ type: "lega.session.connected", channel: "ui", actor: "user", payload: { sessionId: s.sessionId } });
    await waitFor(() => t.readLog("codex").some((l) => l.callsDone), 20000);
    const reply = t.readLog("codex").find((l) => l.toolReply && l.tool === "propose_run");
    assert.equal(reply?.toolReply?.success, false, "refused (blocked)");
    const kept = t.hub.db.prepare("SELECT * FROM work_requests WHERE channel = 'voice'").all();
    assert.equal(kept.length, 1, "the refused run is kept once");
    assert.equal(kept[0].intent, "run");
    const ev = t.hub.db.prepare("SELECT payload_json FROM events WHERE type = 'lega.work_request' ORDER BY seq DESC").get();
    assert.equal(JSON.parse(ev.payload_json).workRequestId, kept[0].id);
  } finally { await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }
});
