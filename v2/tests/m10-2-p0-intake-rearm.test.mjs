// Milestone 10.2.1 — G2 (intake side of D14/D15, D19 on the intake, D20): a request that meets a suspended gate gets the contextual rearm
// card (owner session; bound to the preserved request it re-proposes after the rearm) or the honest reason (voice, the UI without the
// session) — never the old administration pointer; „Continuă” resumes NOTHING while the gate is stopped by anything but the owner's own
// pause (operation plans, the desktop session and missions stay paused until a „Continuă” AFTER the rearm); „Pornește Lega” and
// „Redeschide poarta” answer with the card; a typed „Continuă” after an expired plan points to its continuation plan. PASS_SIMULATED:
// fixture providers, software authenticator, test projects; no model, no network.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeTestHub, enrolOwner, prepareLiveWithoutGrants, waitFor } from "./helpers.mjs";
import { materializeFixture, demoSpec } from "../server/factory/fixtures.mjs";
import { classifySuspension } from "../server/policy/gate-state.mjs";

const M09_MODELS = { writerModel: "gpt-fake-sol", reviewerModel: "sonnet" };
const ADMIN_POINTERS = /OPEN GATE|Integrări → Avansat|Avansat|din Sistem|#\/system/;
const BUG = "Repară bug-ul de validare a numelui format doar din spații, cu testul de acceptanță test/acceptance.test.mjs";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dispatch = (hub, type, payload, extra = {}) => hub.commands.dispatch({ type, payload, channel: "test", actor: "test", ...extra });
const gate = (t) => t.hub.settings.get("executionGate");
const count = (t, sql, ...args) => t.hub.db.prepare(sql).get(...args).n;
const events = (t, type) => t.hub.db.prepare("SELECT payload_json FROM events WHERE type = ? ORDER BY seq").all(type).map((r) => JSON.parse(r.payload_json || "{}"));
const asOwner = (t, type, payload = {}, session = t.owner.session) => t.hub.commands.dispatch({ type, payload, channel: "owner", actor: `owner:${session.id}`, ownerSession: session }).then((r) => r.result);
const say = (t, text, extra = {}) => asOwner(t, "owner.intent", { text, projectId: t.project.id, ...extra });
const sayVoice = (t, text, extra = {}) => t.hub.commands.dispatch({ type: "owner.intent", channel: "voice", actor: "voice", payload: { text, ...extra } }).then((r) => r.result);
const rearm = (t, card, extra = {}) => asOwner(t, "gate.rearm", { nonce: card.nonce, hash: card.hash, ...extra }, t.owner.reauth());
/**
 * The owner's Stop All, then one turn of the event loop: its deferred post-commit reactions (envelopes closed, the preserved requests
 * re-explained) run before the owner's next request, as they do between two real HTTP requests.
 */
const ownerStop = async (t) => {
  const out = (await t.hub.commands.dispatch({ type: "system.stop_all", payload: { reason: "test" }, channel: "owner", actor: `owner:${t.owner.session.id}`, ownerSession: t.owner.session })).result;
  await sleep(100);
  return out;
};
/** The plan left PAUSED again: resumed (the step re-runs or, when it had finished before the pause, the plan completes). */
const resumedPlan = (t, id) => waitFor(() => (["RUNNING", "CONFIRMED", "DONE"].includes(t.hub.opsPlans.view(id).status) && events(t, "ops.plan.resumed").length ? true : null), 5000);
const text = (r) => JSON.stringify([r.message || "", r.blockedBy?.text || "", r.gateRearm || null, r.gateStopped || null]);

/** A factory test project (bug-demo, TRUSTED, one SPEC_DRAFT mission), the owner (voice-first policy), BUILD_SAFE, the gate open. */
async function ownerHub() {
  const t = await makeTestHub({ queues: true });
  // The role defaults of an engineering draft (writer gpt-6.1-sol) are in the account's model list.
  fs.writeFileSync(`${t.logs.codex}.models.json`, JSON.stringify([{ id: "gpt-6.1-sol", isDefault: true, efforts: ["medium", "high"] }, { id: "gpt-fake-sol", efforts: ["medium", "high"] }]));
  await prepareLiveWithoutGrants(t.hub);
  const dir = path.join(t.dataDir, "intake-rearm-alfa");
  materializeFixture("bug-demo", dir);
  const project = (await dispatch(t.hub, "project.register_test", { path: dir, name: "Intake Rearm Alfa" })).result;
  const owner = await enrolOwner(t);
  await dispatch(t.hub, "owner.autonomy.set", { projectId: project.id, level: "TRUSTED" }, { ownerSession: owner.reauth() });
  const { mission } = (await dispatch(t.hub, "factory.prepare", { projectId: project.id, ...demoSpec("bug-demo"), limits: M09_MODELS })).result;
  return { ...t, project, owner, mission };
}

/** An operation plan that waits until released (the m10-ops-plans pattern), confirmed in the owner session and RUNNING. */
async function runningOpsPlan(t) {
  const release = { open: false };
  t.hub.executors["test.wait"] = {
    describe: () => ({ title: "Așteaptă", params: {}, ops: [{ op: "media.render" }], observed: [], transmitted: [], outputs: [] }),
    run: async ({ authorize, abort }) => { authorize({ op: "media.render" }); while (!release.open && !abort.aborted) await sleep(15); return { result: { waited: true } }; },
  };
  const plan = await asOwner(t, "ops.plan.propose", { kind: "intake.rearm.test", title: "Randare de test", steps: [{ kind: "test.wait", params: {} }], limits: {} });
  await asOwner(t, "ops.plan.confirm", { planId: plan.id, nonce: plan.nonce, displayedHash: plan.hash });
  await waitFor(() => t.hub.opsPlans.view(plan.id).steps.some((s) => s.status === "RUNNING"));
  return { plan, release };
}

// ------------------------------------------------------------------------------------------------------------------------------ IR-01
test("IR-01 an engineering request after Stop All: the request is kept and the rearm card carries it (requestId); one explanation, no admin pointer, nothing proposed", async () => {
  const t = await ownerHub();
  try {
    await ownerStop(t);
    assert.equal(classifySuspension(gate(t)).cls, "stop_all");
    const proposedBefore = count(t, "SELECT COUNT(*) AS n FROM mission_envelopes WHERE status = 'PROPOSED'");
    const out = await say(t, BUG);
    const r = out.results[0];
    assert.equal(r.intent, "engineering_request", JSON.stringify(out.resolved));
    assert.ok(r.blockedBy, `blocked by the gate: ${JSON.stringify(r).slice(0, 500)}`);
    assert.ok(String(r.blockedBy.signature).split("+").includes("GATE_SUSPENDED"), r.blockedBy.signature);
    assert.ok(r.workRequest?.id, "the request is preserved");
    assert.equal(t.hub.workRequests.get(r.workRequest.id).status, "BLOCKED");
    // The card: the owner session, bound to that preserved request.
    assert.equal(r.gateRearm?.kind, "gate_rearm", JSON.stringify(r.gateRearm || r.gateStopped));
    assert.equal(r.gateRearm.eligible, true);
    assert.equal(r.gateRearm.cls, "stop_all");
    assert.equal(r.gateRearm.requestId, r.workRequest.id);
    assert.equal(r.gateRearm.requiresFreshAuth, true);
    assert.equal(r.gateStopped, undefined);
    // Explained once, in Romanian, with no administration pointer; nothing proposed, nothing opened.
    assert.match(r.message, /cererea ta rămâne păstrată/);
    assert.match(r.message, /Stop All/);
    assert.doesNotMatch(text(r), ADMIN_POINTERS);
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM mission_envelopes WHERE status = 'PROPOSED'"), proposedBefore, "no PLAN_BLOCKED card over the stopped gate");
    assert.equal(gate(t).status, "suspended");
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM commands WHERE type = 'gate.set'"), 0, "no OPEN GATE");
    // The second mention: the one-line reminder (the one-time rule), the same request, a card again.
    const again = (await say(t, BUG)).results[0];
    assert.equal(again.workRequest?.id, r.workRequest.id);
    assert.match(again.message, /^Încă blocat/);
    assert.equal(again.gateRearm?.requestId, r.workRequest.id);
  } finally { await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ IR-02
test("IR-02 the rearm of that card re-proposes ONLY its request — a plan card that still needs its own confirmation; other kept requests wait", async () => {
  const t = await ownerHub();
  try {
    // An older kept request on the same project (BLOCKED): a gate sweep would re-propose it.
    const older = t.hub.workRequests.create({ text: "Repară altceva", source: "typed", channel: "owner", projectId: t.project.id, intent: "engineering", planRef: { kind: "mission", missionId: t.mission.id }, actor: "test" });
    t.hub.workRequests.explainOnce(older.id, { blocked: true, signature: "GATE_SUSPENDED", cause: "GATE_SUSPENDED", causes: ["GATE_SUSPENDED"], options: [], automaticOnly: false, text: "Nu pot porni încă.", short: "Încă blocat." });
    await ownerStop(t);
    const r = (await say(t, BUG)).results[0];
    assert.ok(r.gateRearm?.requestId, JSON.stringify(r).slice(0, 400));
    const runsBefore = count(t, "SELECT COUNT(*) AS n FROM agent_runs");
    const out = await rearm(t, r.gateRearm);
    assert.equal(out.reopened, true);
    assert.equal(gate(t).status, "open");
    assert.equal(gate(t).reopenedAfter.via, "rearm");
    assert.equal(out.reproposed?.requestId, r.workRequest.id, JSON.stringify(out.reproposed));
    assert.ok(out.reproposed.envelopeId, `the request became a plan: ${JSON.stringify(out.reproposed)}`);
    const env = t.hub.envelopes.get(out.reproposed.envelopeId);
    assert.equal(env.status, "PROPOSED", "a proposal: the plan still needs its own confirmation");
    assert.equal(t.hub.workRequests.get(r.workRequest.id).status, "PLANNED");
    await sleep(400); // time for a wrongly scheduled sweep or start to show up
    assert.equal(t.hub.workRequests.get(older.id).status, "BLOCKED", "no other request is swept by a rearm");
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM mission_envelopes WHERE status IN ('CONFIRMED','ACTIVE','WAITING_OWNER')"), 0, "nothing confirmed by itself");
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM agent_runs"), runsBefore, "no run");
    assert.equal(t.hub.settings.get("mode"), "BUILD_SAFE");
  } finally { await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ IR-03
test("IR-03 „Continuă” after Stop All resumes nothing (the operation plan and the desktop session stay PAUSED) and shows the card; after the rearm „Continuă” resumes them", async () => {
  const t = await ownerHub();
  let release = null;
  try {
    const running = await runningOpsPlan(t);
    release = running.release;
    // 2.12.1 (D22): the desktop session must really be the stop's (ACTIVE when Stop All lands, recorded in the stop's scope); a session
    // paused for another reason keeps its own resume (m10-2-p0-round2-voice).
    const desk = t.hub.desktop.ensureSession({ controller: "owner" });
    const stopped = await ownerStop(t);
    assert.deepEqual(stopped.plansPaused, [running.plan.id]);
    assert.equal(stopped.scope?.desktopSessionId, desk.id, "the stop recorded the desktop session it paused");
    await t.hub.opsPlans.idle(running.plan.id);
    assert.equal(t.hub.opsPlans.view(running.plan.id).status, "PAUSED");
    assert.equal(t.hub.desktop.sessionStatus().status, "PAUSED");
    // The desktop session Stop All paused (the operator's own state is covered by m10-desktop; here: never resumed by „Continuă”).
    let desktopResumes = 0;
    t.hub.desktop.resume = async () => { desktopResumes += 1; return { resumed: true }; };
    const r = (await say(t, "Continuă")).results[0];
    assert.equal(r.intent, "ops_continue");
    assert.ok(!r.error && !r.refused, JSON.stringify(r).slice(0, 400));
    assert.equal(r.gateRearm?.kind, "gate_rearm", JSON.stringify(r.gateRearm || r.gateStopped));
    assert.equal(r.gateRearm.cls, "stop_all");
    assert.equal(r.gateRearm.requestId, null, "„Continuă” is no preserved request");
    assert.match(r.message, /^Poarta e oprită de Stop All, așa că „Continuă” nu reia nimic acum: ce e pe pauză rămâne pe pauză \(un plan de operare, sesiunea desktop\)/);
    assert.match(r.message, /Windows Hello/);
    assert.doesNotMatch(text(r), ADMIN_POINTERS);
    assert.equal(r.plan, undefined);
    assert.notEqual(r.interrupt?.reopened, true);
    await sleep(300);
    assert.equal(t.hub.opsPlans.view(running.plan.id).status, "PAUSED", "the operation plan stays paused");
    assert.equal(desktopResumes, 0, "the desktop session stays paused");
    assert.equal(gate(t).status, "suspended");
    // The rearm reopens the gate and resumes nothing by itself …
    const out = await rearm(t, r.gateRearm);
    assert.equal(out.reopened, true);
    await sleep(300);
    assert.equal(t.hub.opsPlans.view(running.plan.id).status, "PAUSED", "nothing old restarts with the rearm");
    assert.equal(desktopResumes, 0);
    // … and the explicit „Continuă” afterwards resumes the plan (and the desktop session) within the same limits.
    const after = (await say(t, "Continuă")).results[0];
    assert.equal(after.plan?.id, running.plan.id, JSON.stringify(after).slice(0, 400));
    assert.equal(after.gateRearm, undefined);
    assert.equal(desktopResumes, 1);
    await resumedPlan(t, running.plan.id);
  } finally { if (release) release.open = true; await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ IR-04
test("IR-04 the owner's own pause: typed „Continuă” reopens the gate and resumes the operation plan as before; a pause of another authenticator is never reopened by „Continuă” (the card) — a plan stopped for its own reason still resumes (D22)", async () => {
  const t = await ownerHub();
  let release = null;
  try {
    const running = await runningOpsPlan(t);
    release = running.release;
    const paused = (await say(t, "Pauză")).results[0];
    assert.deepEqual(paused.plansPaused, [running.plan.id]);
    assert.equal(classifySuspension(gate(t)).cls, "owner_pause");
    await t.hub.opsPlans.idle(running.plan.id);
    const r = (await say(t, "Continuă")).results[0];
    assert.equal(r.interrupt?.reopened, true, JSON.stringify(r).slice(0, 400));
    assert.equal(r.plan?.id, running.plan.id);
    assert.equal(r.gateRearm, undefined);
    assert.equal(r.gateStopped, undefined);
    assert.equal(gate(t).status, "open");
    assert.equal(events(t, "gate.rearmed").length, 0, "„Continuă” is not a rearm");
    await resumedPlan(t, running.plan.id);
    // A pause recorded by ANOTHER authenticator is not this session's own pause: the gate is not reopened by „Continuă” (the card is). An
    // operation plan stopped for its own reason (not by a stop) still resumes, as before P0 — it never depends on the gate (2.12.1, D22).
    const second = await runningOpsPlan(t);
    t.hub.opsPlans.pause(second.plan.id, { reason: "test", actor: "test" });
    await t.hub.opsPlans.idle(second.plan.id);
    assert.equal(t.hub.opsPlans.view(second.plan.id).status, "PAUSED");
    const resumedBefore = events(t, "ops.plan.resumed").length;
    t.hub.bus.transaction(() => t.hub.settings.set("executionGate", { status: "suspended", reason: "Pauză (fără pași noi)", changedAt: new Date().toISOString(), changedBy: "x",
      suspendedBy: { kind: "pause", id: "sus_other_auth", credential: "0".repeat(24), at: new Date().toISOString(), since: new Date().toISOString(), missions: [] } }, "test"));
    const resumedPlanHere = (await say(t, "Continuă")).results[0];
    assert.equal(resumedPlanHere.plan?.id, second.plan.id, JSON.stringify(resumedPlanHere).slice(0, 400));
    assert.notEqual(resumedPlanHere.interrupt?.reopened, true);
    await waitFor(() => (events(t, "ops.plan.resumed").length > resumedBefore ? true : null), 5000);
    assert.equal(gate(t).status, "suspended", "the other authenticator's pause is not reopened by „Continuă”");
    assert.equal(classifySuspension(gate(t)).cls, "owner_pause");
    // With nothing stopped, the same „Continuă” is the card (never „spune Continuă”): nothing reopens.
    const other = (await say(t, "Continuă")).results[0];
    assert.equal(other.gateRearm?.kind, "gate_rearm", JSON.stringify(other).slice(0, 400));
    assert.equal(other.gateRearm.cls, "owner_pause");
    assert.match(other.message, /din altă sesiune a ta \(alt autentificator\)/);
    assert.doesNotMatch(other.message, /spune sau scrie „Continuă”/);
    assert.equal(other.plan, undefined);
    await sleep(200);
    assert.equal(gate(t).status, "suspended");
    assert.equal(events(t, "gate.rearmed").length, 0);
    second.release.open = true;
  } finally { if (release) release.open = true; await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ IR-05
test("IR-05 on the voice channel (no owner cookie) after Stop All or a gate suspension: the honest one-liner, never a card; a provider „Continuă” resumes nothing", async () => {
  const t = await ownerHub();
  let release = null;
  try {
    const running = await runningOpsPlan(t);
    release = running.release;
    await ownerStop(t);
    await t.hub.opsPlans.idle(running.plan.id);
    const cont = await sayVoice(t, "Continuă");
    assert.ok(cont.results.some((x) => x.refused), JSON.stringify(cont.results));
    assert.ok(cont.results.every((x) => !x.gateRearm), "never a card from a provider transcript");
    const eng = (await sayVoice(t, `${BUG}, pe proiectul Intake Rearm Alfa`)).results[0];
    assert.ok(eng.blockedBy, JSON.stringify(eng).slice(0, 400));
    assert.equal(eng.gateRearm, undefined, "no card on the voice channel");
    assert.equal(eng.gateStopped?.code, "OWNER_SESSION");
    assert.match(eng.message, /o redeschizi în cockpit, în sesiunea ta, cu Windows Hello — nu prin voce\.$/);
    assert.doesNotMatch(text(eng), ADMIN_POINTERS);
    const ask = (await sayVoice(t, "Redeschide poarta")).results[0];
    assert.equal(ask.intent, "gate_rearm");
    assert.equal(ask.gateRearm, undefined);
    assert.equal(ask.gateStopped?.code, "OWNER_SESSION");
    assert.match(ask.message, /^Poarta e oprită de Stop All: o redeschizi în cockpit/);
    assert.equal(t.hub.opsPlans.view(running.plan.id).status, "PAUSED");
    assert.equal(gate(t).status, "suspended");
    // A palette „Pauză” (gate.set suspend) on an open gate: the same answer, with its own cause.
    const c = await asOwner(t, "gate.rearm.card", {});
    await rearm(t, c);
    await t.hub.commands.dispatch({ type: "gate.set", channel: "ui", actor: "user", payload: { action: "suspend", reason: "Palette pause" } });
    const suspended = (await sayVoice(t, "Redeschide poarta")).results[0];
    assert.equal(suspended.gateStopped?.code, "OWNER_SESSION");
    assert.match(suspended.message, /printr-o suspendare a porții/);
    assert.doesNotMatch(text(suspended), ADMIN_POINTERS);
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM events WHERE type = 'gate.rearmed'"), 1, "only the owner's own rearm");
  } finally { if (release) release.open = true; await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ IR-06
test("IR-06 „Pornește Lega” and „Redeschide poarta” after Stop All show the card (no Lega start, no gate check text); after the owner's own pause „Continuă” is named", async () => {
  const t = await ownerHub();
  try {
    await ownerStop(t);
    const lega = (await say(t, "Pornește Lega")).results[0];
    assert.equal(lega.intent, "lega_start");
    assert.equal(lega.legaStart, undefined, "nothing to start while the gate is stopped");
    assert.equal(lega.gateRearm?.kind, "gate_rearm", JSON.stringify(lega).slice(0, 400));
    assert.match(lega.message, /^Lega nu pornește cât timp poarta de execuție e oprită de Stop All: o redeschizi aici, cu Windows Hello/);
    assert.match(lega.message, /„Pornește Lega”/);
    assert.doesNotMatch(text(lega), ADMIN_POINTERS);
    const ask = (await say(t, "Redeschide poarta")).results[0];
    assert.equal(ask.intent, "gate_rearm");
    assert.equal(ask.gateRearm?.kind, "gate_rearm");
    assert.match(ask.message, /O redeschid aici, cu Windows Hello\?/);
    assert.equal(gate(t).status, "suspended", "showing the card reopens nothing");
    assert.equal(t.hub.lega.active(), false);
    // The owner's own pause: no card; „Continuă” is the way.
    await rearm(t, ask.gateRearm);
    await say(t, "Pauză");
    const paused = (await say(t, "Pornește Lega")).results[0];
    assert.equal(paused.gateRearm, undefined);
    assert.equal(paused.gateStopped?.code, "OWNER_PAUSE");
    assert.match(paused.message, /„Continuă”/);
    const open = (await say(t, "Continuă")).results[0];
    assert.equal(open.interrupt?.reopened, true);
    const none = (await say(t, "Redeschide poarta")).results[0];
    assert.equal(none.message, "Poarta de execuție e deschisă; nu e nimic de redeschis.");
  } finally { await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ IR-07
test("IR-07 a typed „Continuă” after a confirmed plan EXPIRED points to „Reia misiunea „X”” (a continuation plan), never „Nu am niciun plan oprit”", async () => {
  const t = await ownerHub();
  try {
    const env = (await dispatch(t.hub, "envelope.propose", { projectId: t.project.id, missionIds: [t.mission.id] })).result.envelope;
    t.queue("codex", "hang");
    await dispatch(t.hub, "envelope.confirm", { envelopeId: env.id, nonce: env.nonce, displayedHash: env.envelopeHash }, { ownerSession: t.owner.session });
    await waitFor(() => (t.hub.runs.activeRuns().some((r) => r.provider === "codex") ? true : null), 30000, 50);
    t.hub.db.prepare("UPDATE mission_envelopes SET expires_at = ? WHERE id = ?").run(new Date(Date.now() - 1000).toISOString(), env.id);
    t.hub.envelopes.tick();
    assert.equal(t.hub.envelopes.get(env.id).status, "EXPIRED");
    await waitFor(() => (t.hub.factory.view(t.mission.id).factory.stage === "PAUSED" ? true : null), 30000, 50);
    await waitFor(() => (t.hub.runs.activeRuns().length === 0 ? true : null), 15000);
    const r = (await say(t, "Continuă")).results[0];
    assert.equal(r.intent, "ops_continue");
    assert.doesNotMatch(String(r.message), /Nu am niciun plan oprit/);
    assert.match(r.message, new RegExp(`Spune: Reia misiunea „${t.mission.title}”`));
    assert.match(r.message, /plan de continuare/);
    assert.deepEqual((r.expiredPlans || []).map((m) => m.missionId), [t.mission.id]);
    assert.equal(t.hub.factory.view(t.mission.id).factory.stage, "PAUSED", "the pointer resumes nothing");
    // The pointer's own words make the continuation plan (one confirmation of only what remains).
    const next = (await say(t, `Reia misiunea ${t.mission.title}`)).results[0];
    assert.ok(next.plan?.envelope?.id, JSON.stringify(next).slice(0, 400));
    assert.deepEqual(next.plan.envelope.body.continuation, { fromEnvelopeId: env.id, missionId: t.mission.id });
    // With that continuation waiting, „Continuă” no longer points at it again.
    const again = (await say(t, "Continuă")).results[0];
    assert.equal(again.expiredPlans, undefined);
  } finally { await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ IR-09
test("IR-09 the first start (the gate never opened, so nothing was stopped by it): „Continuă” still resumes an operation plan stopped for another reason; with nothing to resume it shows the card", async () => {
  const t = await makeTestHub({ queues: true });
  let release = null;
  try {
    t.owner = await enrolOwner(t);
    t.project = t.hub.projects.hub();
    assert.equal(classifySuspension(gate(t)).cls, "first_start");
    const running = await runningOpsPlan(t);
    release = running.release;
    t.hub.opsPlans.pause(running.plan.id, { reason: "test", actor: "test" });
    await t.hub.opsPlans.idle(running.plan.id);
    const r = (await say(t, "Continuă")).results[0];
    assert.equal(r.plan?.id, running.plan.id, JSON.stringify(r).slice(0, 400));
    assert.equal(r.gateRearm, undefined);
    await resumedPlan(t, running.plan.id);
    assert.equal(classifySuspension(gate(t)).cls, "first_start", "the gate is not touched");
    const none = (await say(t, "Continuă")).results[0];
    assert.equal(none.gateRearm?.kind, "gate_rearm", JSON.stringify(none).slice(0, 400));
    assert.equal(none.gateRearm.cls, "first_start");
    assert.match(none.message, /de la prima pornire/);
    assert.doesNotMatch(text(none), ADMIN_POINTERS);
  } finally { if (release) release.open = true; await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ IR-08
test("IR-08 „Pornește misiunea X” after Stop All is kept (no PLAN_BLOCKED card) and re-proposed by the rearm; „Reia misiunea X” is said again after the rearm", async () => {
  const t = await ownerHub();
  try {
    await ownerStop(t);
    const start = (await say(t, `Pornește misiunea ${t.mission.title}`)).results[0];
    assert.equal(start.intent, "start_mission");
    assert.equal(start.plan, undefined, "no card over the stopped gate");
    assert.ok(start.workRequest?.id, JSON.stringify(start).slice(0, 400));
    assert.equal(start.gateRearm?.requestId, start.workRequest.id);
    assert.equal(t.hub.workRequests.get(start.workRequest.id).planRef?.missionId, t.mission.id);
    assert.doesNotMatch(text(start), ADMIN_POINTERS);
    const resume = (await say(t, `Reia misiunea ${t.mission.title}`)).results[0];
    assert.equal(resume.intent, "resume_mission");
    assert.equal(resume.plan, undefined);
    assert.match(resume.message, /rămâne oprită: poarta de execuție e oprită de Stop All/);
    assert.equal(resume.gateRearm?.kind, "gate_rearm");
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM mission_envelopes WHERE status = 'PROPOSED'"), 0);
    const card = await asOwner(t, "gate.rearm.card", { requestId: start.workRequest.id });
    const out = await rearm(t, card);
    assert.equal(out.reproposed?.requestId, start.workRequest.id, JSON.stringify(out.reproposed));
    const env = t.hub.envelopes.get(out.reproposed.envelopeId);
    assert.equal(env.status, "PROPOSED");
    assert.deepEqual(env.missionIds, [t.mission.id]);
  } finally { await t.cleanup(); }
});
