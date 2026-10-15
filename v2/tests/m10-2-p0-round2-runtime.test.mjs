// Milestone 10.2.1 — P0 round 2, unit R1 "runtime + gate core". (AS-01) a start still being admitted when Stop All lands never reaches its
// model (the stop epoch + the pre-model recheck of the execution gate and of the grant it took); the rearm card waits for it. (SM-01) a
// confirmed plan's mission the gate refused (BLOCKED „gate”) is resumed by „Continuă” once the gate is open again, and the card counts
// it. (SM-02) a readiness pass never resumes what the gate blocked when the gate was suspended or reopened while it ran. (SM-05) the
// shutdown runs the stop's deferred closure of plans waiting for a confirmation before the services close; a boot defence closes what a
// previous process left. (SM-08 / REG-05) the security list is newest first with the true count, its hash cannot saturate, and the scan
// is cached per suspension. (REG-02) the typed OPEN GATE refusal names the authenticator enrolment when none exists. (REG-04) API
// contract 12. (D22) owner/stop-scope.mjs: what a stop itself stopped is held until the rearm; anything paused for another reason is not.
// PASS_SIMULATED: fixture providers, the simulated distro, the software authenticator, test projects; no model, no network, no live Hub.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { makeTestHub, enableLive, enrolOwner, prepareLiveWithoutGrants, waitFor } from "./helpers.mjs";
import { materializeFixture, demoSpec } from "../server/factory/fixtures.mjs";
import { HubError } from "../server/core/errors.mjs";
import { ENV_POLICY_TEXT } from "../server/policy/isolation.mjs";
import { API_CONTRACT } from "../server/config.mjs";
import { createHub } from "../server/hub.mjs";
import { createHttpServer } from "../server/http/server.mjs";
import { SECURITY_EVENT_TYPES, classifySuspension } from "../server/policy/gate-state.mjs";
import { createStopScope, stopForShutdown, closeProposalsFromBeforeStop, stopScopeRecord, STOP_HOLD_CLASSES } from "../server/owner/stop-scope.mjs";

const M09_MODELS = { writerModel: "gpt-fake-sol", reviewerModel: "sonnet" };
const OLD_CANARY = "m05-canary-1+e1fde725";
const OPEN_ENVELOPE = new Set(["CONFIRMED", "ACTIVE", "WAITING_OWNER"]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dispatch = (hub, type, payload, extra = {}) => hub.commands.dispatch({ type, payload, channel: "test", actor: "test", ...extra });
const gate = (t) => t.hub.settings.get("executionGate");
const count = (t, sql, ...args) => t.hub.db.prepare(sql).get(...args).n;
const events = (t, type) => t.hub.db.prepare("SELECT payload_json, source, scope_id FROM events WHERE type = ? ORDER BY seq").all(type)
  .map((r) => ({ ...JSON.parse(r.payload_json || "{}"), _source: r.source, _scope: r.scope_id }));
const lastStopEvent = (t) => JSON.parse(t.hub.db.prepare("SELECT payload_json FROM events WHERE type = 'system.stop_all' ORDER BY seq DESC LIMIT 1").get().payload_json);
const asOwner = (t, type, payload = {}, session = t.owner.session) =>
  t.hub.commands.dispatch({ type, payload, channel: "owner", actor: `owner:${session.id}`, ownerSession: session }).then((r) => r.result);
const card = (t, payload = {}, session = t.owner.session) => asOwner(t, "gate.rearm.card", payload, session);
const rearm = (t, c, extra = {}, session = t.owner.reauth()) => asOwner(t, "gate.rearm", { nonce: c.nonce, hash: c.hash, ...extra }, session);
const ownerStop = (t) => t.hub.commands.dispatch({ type: "system.stop_all", payload: { reason: "test" }, channel: "owner", actor: `owner:${t.owner.session.id}`, ownerSession: t.owner.session }).then((r) => r.result);
const paletteSuspend = (t) => t.hub.commands.dispatch({ type: "gate.set", channel: "ui", actor: "user", payload: { action: "suspend", reason: "Pauză (paletă)" } });
const stageOf = (t, id) => t.hub.factory.view(id).factory;
const untilStage = (t, id, stages, ms = 60000) => waitFor(() => (stages.includes(stageOf(t, id).stage) ? stageOf(t, id) : null), ms, 20);
const activeRun = (t, provider = "codex") => waitFor(() => (t.hub.runs.activeRuns().some((r) => r.provider === provider) ? true : null), 30000, 50);
const noRuns = (t) => waitFor(() => (t.hub.runs.activeRuns().length === 0 ? true : null), 20000, 50);
const confirmEnvelope = (t, env) => dispatch(t.hub, "envelope.confirm", { envelopeId: env.id, nonce: env.nonce, displayedHash: env.envelopeHash }, { ownerSession: t.owner.session });
const propose = async (t, projectId, missionId) => (await dispatch(t.hub, "envelope.propose", { projectId, missionIds: [missionId] })).result.envelope;

/** A factory test project (bug-demo, TRUSTED) with one SPEC_DRAFT mission; the owner enrolled (voice-first); BUILD_SAFE; gate open. */
async function ownerHub({ clock = null, second = false } = {}) {
  const t = await makeTestHub({ queues: true, ...(clock ? { clock } : {}) });
  await prepareLiveWithoutGrants(t.hub);
  const register = async (label, name) => {
    const dir = path.join(t.dataDir, label);
    materializeFixture("bug-demo", dir);
    return (await dispatch(t.hub, "project.register_test", { path: dir, name })).result;
  };
  const project = await register("r1-alfa", "Runtime Alfa");
  const other = second ? await register("r1-beta", "Runtime Beta") : null;
  const owner = await enrolOwner(t);
  for (const p of [project, other].filter(Boolean)) await dispatch(t.hub, "owner.autonomy.set", { projectId: p.id, level: "TRUSTED" }, { ownerSession: owner.reauth() });
  const { mission } = (await dispatch(t.hub, "factory.prepare", { projectId: project.id, ...demoSpec("bug-demo"), limits: M09_MODELS })).result;
  return { ...t, project, other, owner, mission };
}
const prepare = async (t, projectId) => (await dispatch(t.hub, "factory.prepare", { projectId, ...demoSpec("bug-demo"), limits: M09_MODELS })).result.mission;

/** The simulated distro attested, a routed test project, approval (b) on the attested fingerprint, the owner, a mission draft. */
async function envHub() {
  const t = await makeTestHub({ wsl: true, queues: true });
  const { hub } = t;
  await dispatch(hub, "environment.inspect", { environmentId: "wsl-runner" });
  await dispatch(hub, "environment.probe", { environmentId: "wsl-runner" });
  const att = (await dispatch(hub, "environment.attest", { environmentId: "wsl-runner" })).result;
  assert.match(att.status, /^PASS/, JSON.stringify(att));
  await prepareLiveWithoutGrants(hub);
  const dir = path.join(t.dataDir, "r1-env");
  materializeFixture("bug-demo", dir);
  const project = (await dispatch(hub, "project.register_test", { path: dir })).result;
  await dispatch(hub, "project.environment.set", { projectId: project.id, environment: "wsl-runner" });
  const owner = await enrolOwner(t);
  await dispatch(hub, "owner.autonomy.set", { projectId: project.id, level: "TRUSTED" }, { ownerSession: owner.reauth() });
  await dispatch(hub, "environment.policy.approve", { confirmText: ENV_POLICY_TEXT, fingerprintHash: hub.wslRunner.state().fingerprint.hash }, { ownerSession: owner.session });
  const { mission } = (await dispatch(hub, "factory.prepare", { projectId: project.id, ...demoSpec("bug-demo"), limits: M09_MODELS })).result;
  /** An upgrade: the canary version moves (same fingerprint) and the account check through the environment ages past 24 h. */
  const invalidate = () => {
    hub.db.prepare("UPDATE environment_attestations SET canary_version = ?").run(OLD_CANARY);
    hub.providerState.set("codex@wsl-runner", { ...hub.providerState.get("codex@wsl-runner"), probedAt: new Date(Date.now() - 30 * 3600000).toISOString() });
  };
  return { ...t, project, owner, mission, invalidate };
}

/** A conversation on the fixture Hub project with one user message (a run needs it). */
function conversationWithMessage(t) {
  const project = t.hub.projects.hub();
  const conversation = t.hub.bus.transaction(() => t.hub.conversations.create({ projectId: project.id, title: "Admitere" }, "user"));
  t.hub.bus.transaction(() => t.hub.conversations.addMessage({ conversationId: conversation.id, role: "user", content: "Rezumă README-ul." }, "user"));
  return { project, conversation };
}
/** Holds the pre-run backup of the next start until released: the start waits in admission (the window AS-01 is about). */
function holdBackup(t) {
  const realRun = t.hub.backups.run;
  const realFresh = t.hub.backups.freshVerified;
  let release = null;
  const held = new Promise((r) => { release = r; });
  let reached = false;
  t.hub.backups.freshVerified = () => ({ ok: false, reason: "test: un backup nou e cerut" });
  t.hub.backups.run = async (...args) => { reached = true; await held; return realRun.apply(t.hub.backups, args); };
  return { reached: () => reached, release: () => release(), restore: () => { t.hub.backups.run = realRun; t.hub.backups.freshVerified = realFresh; } };
}
/** Holds every automation-channel command (the readiness pass's steps) until released: the pass stays in flight. */
function holdAutomation(hub) {
  const real = hub.commands.dispatch;
  let release = null;
  const held = new Promise((r) => { release = r; });
  let reached = 0;
  hub.commands.dispatch = async (request) => { if (request?.channel === "automation") { reached += 1; await held; } return real.call(hub.commands, request); };
  return { reached: () => reached, release: () => release(), restore: () => { hub.commands.dispatch = real; } };
}
/** Test executors for operation plans: one that waits until stopped, one the owner's intervention stops (USER_INPUT → NEEDS_OWNER). */
function testExecutors(t) {
  t.hub.executors["test.wait"] = {
    describe: () => ({ title: "Așteaptă", params: {}, ops: [{ op: "media.render" }], observed: [], transmitted: [], outputs: [] }),
    run: async ({ authorize, abort }) => { authorize({ op: "media.render" }); while (!abort.aborted && !t.finishWaitingStep) await sleep(15); return { result: { waited: true } }; },
  };
  t.hub.executors["test.intervene"] = {
    describe: () => ({ title: "Intervenție", params: {}, ops: [{ op: "media.render" }], observed: [], transmitted: [], outputs: [] }),
    run: async ({ authorize }) => { authorize({ op: "media.render" }); throw new HubError("conflict", "Ai intervenit (tastatură/mouse)", { code: "USER_INPUT" }); },
  };
}
async function runningPlan(t, title, kind = "test.wait") {
  const op = await asOwner(t, "ops.plan.propose", { kind: "r1.test", title, steps: [{ kind, params: {} }], limits: {} });
  await asOwner(t, "ops.plan.confirm", { planId: op.id, nonce: op.nonce, displayedHash: op.hash });
  if (kind === "test.wait") await waitFor(() => t.hub.opsPlans.view(op.id).steps.some((s) => s.status === "RUNNING"));
  return op;
}

// ------------------------------------------------------------------------------------------------------------------------------ AS-01
test("R1-01 (AS-01) a start still in admission when Stop All lands never reaches its model — even with the gate reopened meanwhile: refused at the pre-model recheck, lease released, the attempt refunded, the grant stays revoked; the rearm card says RUNS_ACTIVE while it is admitted", async () => {
  const t = await makeTestHub();
  try {
    const { grant } = await enableLive(t.hub, { provider: "codex", access: "read-only", attempts: 1 });
    t.owner = await enrolOwner(t);
    const { conversation } = conversationWithMessage(t);
    const turns = () => t.readLog("codex").filter((e) => e.method === "turn/start").length;
    const turns0 = turns();
    const hold = holdBackup(t);
    const started = t.hub.runs.start({ conversationId: conversation.id, provider: "codex", access: "read-only" }).then((r) => ({ r }), (error) => ({ error }));
    await waitFor(() => hold.reached());
    assert.equal(t.hub.runs.admittingCount(), 1);
    assert.equal(t.hub.runs.activeRuns().length, 0, "a start in admission is not an active run");
    assert.equal(t.hub.grants.get(grant.id).status, "exhausted", "its only attempt is taken, so Stop All's revokeAll skips it");

    const stop = await ownerStop(t);
    assert.equal(stop.admissionsStopped, 1);
    assert.equal(lastStopEvent(t).admissionsStopped, 1);
    const waiting = await card(t);
    assert.deepEqual([waiting.eligible, waiting.code], [false, "RUNS_ACTIVE"]);
    assert.match(waiting.reason, /Încă se oprește o execuție \(una e încă în admitere și nu ajunge la model\)/);
    assert.match(waiting.reason, /o redeschizi tu, aici în cockpit, pe cardul „Redeschide poarta”, cu Windows Hello — nu se redeschide singură/);
    assert.equal(t.hub.gateRearm.eligibility().code, "RUNS_ACTIVE");

    // The typed diagnostic OPEN GATE does not wait for admissions: the stop epoch still refuses this start.
    await dispatch(t.hub, "gate.set", { action: "open", confirm: "OPEN GATE" });
    assert.equal(gate(t).status, "open");
    hold.release();
    const out = await started;
    assert.ok(out.error, "the start is refused");
    assert.equal(out.error.category, "gate");
    assert.equal(out.error.details.stopAll, true);
    assert.equal(turns(), turns0, "no turn reached the provider");
    const rows = t.hub.db.prepare("SELECT status, error_category, error_message FROM agent_runs WHERE conversation_id = ?").all(conversation.id);
    assert.deepEqual(rows.map((r) => [r.status, r.error_category]), [["blocked", "gate"]]);
    assert.match(rows[0].error_message, /Stop All în timpul admiterii/);
    assert.equal(t.hub.runs.admittingCount(), 0, "the admission ended");
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM leases WHERE status = 'active'"), 0, "the workspace lease is released");
    const g = t.hub.grants.get(grant.id);
    assert.equal(g.attemptsUsed, 0, "the attempt that never reached the model is given back");
    assert.equal(g.status, "revoked", "Stop All's revocation stands: the refund never revives the grant");
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM events WHERE type = 'grant.refunded' AND scope_id = ?", grant.id), 1);
    hold.restore();
  } finally { await t.cleanup(); }
});

test("R1-02 (AS-01) a palette suspension or the revocation of the grant during admission refuses the start before its model (the attempt given back where it can be); with nothing in between the same start reaches its turn", async () => {
  const t = await makeTestHub();
  try {
    const { project, grant } = await enableLive(t.hub, { provider: "codex", access: "read-only", attempts: 3 });
    const { conversation } = conversationWithMessage(t);
    const turns = () => t.readLog("codex").filter((e) => e.method === "turn/start").length;
    const turns0 = turns();
    const start = () => t.hub.runs.start({ conversationId: conversation.id, provider: "codex", access: "read-only" }).then((r) => ({ r }), (error) => ({ error }));

    // (a) The gate suspended (no Stop All: grants are not revoked) while the backup runs.
    let hold = holdBackup(t);
    let pending = start();
    await waitFor(() => hold.reached());
    assert.equal(t.hub.grants.get(grant.id).attemptsUsed, 1);
    await paletteSuspend(t);
    hold.release();
    let out = await pending;
    hold.restore();
    assert.equal(out.error?.category, "gate");
    assert.equal(out.error.details.stopAll, false);
    assert.deepEqual([out.error.details.checks[0].id, out.error.details.checks[0].ok], ["execution_gate", false]);
    assert.match(out.error.details.checks[0].detail, /Suspendată/);
    let g = t.hub.grants.get(grant.id);
    assert.deepEqual([g.attemptsUsed, g.status], [0, "active"], "the attempt is given back; a suspension revokes nothing");

    // (b) The gate open, the grant this start took is revoked while it waits.
    await dispatch(t.hub, "gate.set", { action: "open", confirm: "OPEN GATE" });
    hold = holdBackup(t);
    pending = start();
    await waitFor(() => hold.reached());
    await dispatch(t.hub, "grant.revoke", { grantId: grant.id });
    hold.release();
    out = await pending;
    hold.restore();
    assert.equal(out.error?.category, "gate");
    assert.deepEqual([out.error.details.checks[0].id, out.error.details.stopAll], ["live_grant", false]);
    assert.match(out.error.details.checks[0].detail, /a fost revocat în timpul admiterii/);
    assert.equal(t.hub.grants.get(grant.id).status, "revoked");
    assert.equal(turns(), turns0, "neither start reached the provider");
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM leases WHERE status = 'active'"), 0);
    assert.deepEqual(t.hub.db.prepare("SELECT status FROM agent_runs WHERE conversation_id = ? ORDER BY created_at").all(conversation.id).map((r) => r.status), ["blocked", "blocked"]);

    // (c) Control: a fresh grant, nothing in between → the start reaches its turn (the refusals above were the guard, not the harness).
    t.hub.bus.transaction(() => t.hub.grants.create({ provider: "codex", projectId: project.id, access: "read-only", maxAttempts: 2, maxDurationS: 600, ttlMinutes: 30 }, "test"));
    const ok = await t.hub.runs.start({ conversationId: conversation.id, provider: "codex", access: "read-only" });
    assert.equal(ok.run.status, "running");
    await waitFor(() => (["completed", "failed", "blocked", "interrupted"].includes(t.hub.runs.getRun(ok.run.id).status) ? true : null), 20000);
    assert.equal(t.hub.runs.getRun(ok.run.id).status, "completed");
    assert.equal(turns(), turns0 + 1);
  } finally { await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ SM-01
test("R1-03 (SM-01) a confirmed plan's mission the gate refused during a palette suspension (BLOCKED „gate”): the rearm card counts it; after the rearm „Continuă” resumes it inside the same plan", async () => {
  const t = await ownerHub();
  try {
    const env = await propose(t, t.project.id, t.mission.id);
    t.queue("codex", "hang");
    await confirmEnvelope(t, env);
    await activeRun(t);
    await asOwner(t, "factory.pause", { missionId: t.mission.id });
    await untilStage(t, t.mission.id, ["PAUSED"]);
    await noRuns(t);
    await paletteSuspend(t);
    t.queue("codex", "hang", "hang");
    await asOwner(t, "factory.resume", { missionId: t.mission.id });
    const blocked = await untilStage(t, t.mission.id, ["BLOCKED"]);
    assert.equal(blocked.waitReason, "gate");
    assert.ok(OPEN_ENVELOPE.has(t.hub.envelopes.get(env.id).status), "the plan is still in force");
    // While the gate is suspended the check refuses (nothing starts under a closed gate).
    assert.equal(t.hub.interrupts.planResumeCheck(t.mission.id, t.owner.session).ok, false);

    const c = await card(t);
    assert.equal(c.code, "ELIGIBLE");
    assert.ok(c.stays.some((l) => /o misiune oprită la poartă/.test(l) && /„Continuă” după redeschidere/.test(l)), JSON.stringify(c.stays));
    assert.equal((await rearm(t, c)).reopened, true);
    await sleep(300);
    assert.equal(stageOf(t, t.mission.id).stage, "BLOCKED", "the rearm restarts nothing by itself");
    const check = t.hub.interrupts.planResumeCheck(t.mission.id, t.owner.session);
    assert.equal(check.ok, true, check.why);

    const said = await asOwner(t, "owner.intent", { text: "Continuă" });
    assert.doesNotMatch(JSON.stringify(said), /așteaptă o verificare a porții/);
    const resumed = await waitFor(() => events(t, "factory.resumed").find((e) => e._scope === t.mission.id && e.from === "BLOCKED" && /^owner:/.test(e._source)) || null, 15000, 50);
    assert.ok(resumed);
    await activeRun(t);
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM events WHERE type = 'envelope.confirmed'"), 1, "the same plan: no new confirmation");
    await ownerStop(t);
    await noRuns(t);
  } finally { await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ SM-02
test("R1-04 (SM-02) a readiness pass that started under a suspended gate does not resume the mission after the owner rearms during it; only the owner's „Continuă” does", async () => {
  const t = await envHub();
  const { hub } = t;
  let hold = null;
  try {
    const env = await propose(t, t.project.id, t.mission.id);
    t.queue("codex", "hang");
    await confirmEnvelope(t, env);
    await activeRun(t);
    await asOwner(t, "factory.pause", { missionId: t.mission.id });
    await untilStage(t, t.mission.id, ["PAUSED"]);
    await noRuns(t);
    t.invalidate();
    await paletteSuspend(t);
    hold = holdAutomation(hub);
    t.queue("codex", "hang", "hang");
    await asOwner(t, "factory.resume", { missionId: t.mission.id });
    assert.equal((await untilStage(t, t.mission.id, ["BLOCKED"])).waitReason, "gate");
    await waitFor(() => (hold.reached() > 0 ? true : null), 60000, 20); // the pass is in flight, held at its first automatic step
    assert.ok(hub.readiness.running().length, "the readiness pass is running");
    const c = await card(t);
    assert.equal(c.code, "ELIGIBLE");
    assert.equal((await rearm(t, c)).reopened, true);
    hold.release();
    const done = await waitFor(() => events(t, "readiness.completed").find((e) => e._scope === env.id) || null, 120000, 100);
    assert.equal(done.cleared, true, "the pass cleared its own causes (account check, canary)");
    hold.restore();
    hold = null;
    await sleep(800);
    assert.equal(events(t, "readiness.mission_resumed").length, 0, "the pass did not restart what the gate blocked");
    assert.equal(stageOf(t, t.mission.id).stage, "BLOCKED");
    // The owner's explicit „Continuă” after the rearm is the way (SM-01), inside the same plan.
    await asOwner(t, "owner.intent", { text: "Continuă" });
    await waitFor(() => events(t, "factory.resumed").find((e) => e._scope === t.mission.id && e.from === "BLOCKED" && /^owner:/.test(e._source)) || null, 15000, 50);
    await ownerStop(t);
    await noRuns(t).catch(() => {});
  } finally { if (hold) { hold.release(); hold.restore(); } await t.cleanup(); }
});

test("R1-05 (SM-02) a pass that started with the gate open, during which the gate was suspended and rearmed, resumes nothing by itself (a reopening never restarts old work)", async () => {
  const t = await envHub();
  const { hub } = t;
  let hold = null;
  try {
    const env = await propose(t, t.project.id, t.mission.id);
    t.queue("codex", "hang");
    await confirmEnvelope(t, env);
    await activeRun(t);
    await asOwner(t, "factory.pause", { missionId: t.mission.id });
    await untilStage(t, t.mission.id, ["PAUSED"]);
    await noRuns(t);
    t.invalidate();
    hold = holdAutomation(hub);
    t.queue("codex", "hang", "hang");
    await asOwner(t, "factory.resume", { missionId: t.mission.id });
    assert.equal((await untilStage(t, t.mission.id, ["BLOCKED"])).waitReason, "gate", "refused by the stale account check / canary");
    await waitFor(() => (hold.reached() > 0 ? true : null), 60000, 20);
    assert.equal(gate(t).status, "open", "the pass started with the gate open");
    await paletteSuspend(t);
    const c = await card(t);
    assert.equal((await rearm(t, c)).reopened, true);
    hold.release();
    const done = await waitFor(() => events(t, "readiness.completed").find((e) => e._scope === env.id) || null, 120000, 100);
    assert.equal(done.cleared, true);
    hold.restore();
    hold = null;
    await sleep(800);
    assert.equal(events(t, "readiness.mission_resumed").length, 0, "the gate changed while the pass ran: no resume by itself");
    assert.equal(stageOf(t, t.mission.id).stage, "BLOCKED");
    await ownerStop(t);
  } finally { if (hold) { hold.release(); hold.restore(); } await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ SM-05
test("R1-06 (SM-05) the shutdown with work in flight: the stop's closure of plans waiting for a confirmation runs before the services close; the operation plans left running are recorded as interrupted and wait for the rearm after the boot", async () => {
  const t = await ownerHub({ second: true });
  let op = null, rebooted = null, closed = false;
  try {
    const env1 = await propose(t, t.project.id, t.mission.id);
    t.queue("codex", "hang");
    await confirmEnvelope(t, env1);
    await activeRun(t);
    const env2 = await propose(t, t.other.id, await prepare(t, t.other.id).then((m) => m.id));
    assert.equal(t.hub.envelopes.get(env2.id).status, "PROPOSED");
    testExecutors(t);
    op = await runningPlan(t, "Plan Gama");

    const out = await stopForShutdown(t.hub, "SIGTERM");
    t.hub.envelopes.close(); // hub.close()'s first synchronous step, right after the shutdown stop
    assert.equal(out.stopped, true);
    assert.equal(gate(t).suspendedBy.kind, "shutdown");
    assert.equal(t.hub.envelopes.get(env2.id).status, "REVOKED", "the card shown before the stop is closed, never confirmable after a rearm");
    assert.equal(t.hub.envelopes.get(env2.id).closeReason, "Stop All");
    assert.equal(t.hub.envelopes.get(env1.id).status, "REVOKED");
    const scope = lastStopEvent(t).scope;
    assert.deepEqual(scope.plansInterrupted, [op.id]);
    assert.deepEqual(scope.plansPaused, []);
    assert.equal(t.hub.opsPlans.view(op.id).status, "RUNNING", "never paused at exit: the boot reconciles its running step");
    const stopScope = createStopScope(t.hub);
    assert.equal(stopScope.heldByStop({ kind: "ops", id: op.id }).held, false, "not stopped yet");
    let atClose;
    const closeDb = t.hub.db.close.bind(t.hub.db);
    t.hub.db.close = () => { atClose = t.hub.opsPlans.view(op.id); closeDb(); };
    const closing = t.hub.close(); closed = true;
    t.finishWaitingStep = true; // let the held fixture finish; close must not rewrite its interrupted step.
    await closing;
    assert.equal(atClose.status, "RUNNING"); assert.equal(atClose.steps[0].status, "RUNNING");
    rebooted = createHub(t.config, { homeDir: t.homeDir }); await rebooted.boot();
    assert.equal(rebooted.opsPlans.view(op.id).status, "NEEDS_OWNER");
    assert.equal(rebooted.opsPlans.view(op.id).steps[0].status, "UNCERTAIN");
    const h = createStopScope(rebooted).heldByStop({ kind: "ops", id: op.id });
    assert.deepEqual([h.held, h.cls, h.code], [true, "shutdown", "GATE_REARM_REQUIRED"]);
    assert.match(h.reason, /„Plan Gama” a fost oprit la oprirea Hub-ului/);
  } finally {
    // The plan's step is still waiting in this process (a real exit would have ended it): end it and let its loop finish before closing.
    if (rebooted) await rebooted.close();
    if (!closed && op) { try { t.hub.opsPlans.cancel(op.id, { reason: "test", actor: "test" }); await t.hub.opsPlans.idle(op.id); } catch { /* already settled */ } }
    if (!closed) await noRuns(t).catch(() => {});
    await t.cleanup();
  }
});

test("R1-07 (SM-05) boot defence: a plan still waiting for its confirmation from before the stop that holds the gate (its closure lost with the process) is closed; one proposed after the stop is never touched; idempotent", async () => {
  const t = await ownerHub({ second: true });
  try {
    const env1 = await propose(t, t.project.id, t.mission.id);
    t.queue("codex", "hang");
    await confirmEnvelope(t, env1);
    await activeRun(t);
    const env2 = await propose(t, t.other.id, await prepare(t, t.other.id).then((m) => m.id));
    // The order of the old shutdown: the stop, then envelopes.close() before its deferred closure ran → the card survives.
    await t.hub.runs.stopAll("system", "Hub shutdown (SIGTERM)", { kind: "shutdown", channel: "system", actor: "system" });
    t.hub.envelopes.close();
    await sleep(200);
    assert.equal(t.hub.envelopes.get(env2.id).status, "PROPOSED", "the lost closure (the condition the defence is for)");
    assert.equal(classifySuspension(gate(t)).cls, "shutdown");
    // A card stamped after the stop is not the stop's.
    const created = t.hub.db.prepare("SELECT created_at FROM mission_envelopes WHERE id = ?").get(env2.id).created_at;
    t.hub.db.prepare("UPDATE mission_envelopes SET created_at = ? WHERE id = ?").run(new Date(Date.now() + 3600000).toISOString(), env2.id);
    assert.deepEqual(closeProposalsFromBeforeStop(t.hub).closed, []);
    assert.equal(t.hub.envelopes.get(env2.id).status, "PROPOSED");
    t.hub.db.prepare("UPDATE mission_envelopes SET created_at = ? WHERE id = ?").run(created, env2.id);
    const first = closeProposalsFromBeforeStop(t.hub);
    assert.deepEqual(first.closed, [env2.id]);
    const closed = t.hub.envelopes.get(env2.id);
    assert.equal(closed.status, "CANCELLED");
    assert.equal(closed.closeReason, "Stop All");
    assert.equal(events(t, "recovery.stop_proposals_closed").at(-1).count, 1);
    assert.deepEqual(closeProposalsFromBeforeStop(t.hub).closed, [], "idempotent");
    // With the gate open nothing is touched.
    await dispatch(t.hub, "gate.set", { action: "open", confirm: "OPEN GATE" }).catch(() => {});
    if (gate(t).status === "open") assert.deepEqual(closeProposalsFromBeforeStop(t.hub), { closed: [], cls: "open" });
  } finally { await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ SM-08 / REG-05
test("R1-08 (SM-08 / REG-05) the security list: newest first, the true total (past the hash cap), a hash that changes with any new event; the scan is cached per suspension (later evaluations read only new events) and a rolled-back event never stays", async () => {
  const t = await ownerHub();
  const prepareSql = t.hub.db.prepare;
  try {
    const securityTypes = SECURITY_EVENT_TYPES.map(() => "?").join(",");
    const ids = () => t.hub.db.prepare(`SELECT id FROM events WHERE type IN (${securityTypes}) ORDER BY seq`).all(...SECURITY_EVENT_TYPES).map((r) => r.id);
    // 505 security events right before the stop (one transaction): more than the 500 ids the hash binds.
    t.hub.bus.transaction(() => { for (let i = 0; i < 505; i++) t.hub.bus.append({ type: SECURITY_EVENT_TYPES[i % SECURITY_EVENT_TYPES.length], scopeType: "system", scopeId: "test", source: "test", payload: { i } }); });
    await ownerStop(t);
    const c = await card(t);
    assert.equal(c.code, "SECURITY");
    assert.equal(c.security.total, 505, "the true count, not the hash cap");
    assert.equal(c.security.truncated, true);
    assert.equal(c.security.order, "newest_first");
    assert.deepEqual(c.security.events.map((e) => e.id), ids().slice(-20).reverse(), "the 20 newest, newest first");

    // Cached: later evaluations of the same suspension never scan the window again (only the rowid range of new events).
    const sql = [];
    t.hub.db.prepare = function prepare(text) { sql.push(String(text)); return prepareSql.call(this, text); };
    const e1 = t.hub.gateRearm.eligibility();
    t.hub.gateRearm.eligibility();
    t.hub.cockpit.whyBlocked({});
    assert.equal(sql.filter((s) => /COUNT\(\*\) AS n, MAX\(seq\)/.test(s)).length, 0, "no full scan of the events window");
    delete t.hub.db.prepare;
    assert.equal(e1.security.total, 505);

    // A new event after the card: listed first, the total moves, the hash changes (the old card is refused).
    t.hub.bus.emit({ type: "owner.credential_revoked", scopeType: "owner", scopeId: "credentials", source: "test", payload: { test: true } });
    const e2 = t.hub.gateRearm.eligibility();
    assert.equal(e2.security.total, 506);
    assert.equal(e2.security.events[0].type, "owner.credential_revoked");
    assert.equal(e2.security.events[0].id, ids().at(-1));
    assert.notEqual(e2.security.hash, e1.security.hash);
    await assert.rejects(rearm(t, c, { ackSecurity: true }), (e) => e.details?.code === "CARD_CHANGED");

    // An event seen inside a transaction that rolls back is never kept by the cache.
    assert.throws(() => t.hub.bus.transaction(() => {
      t.hub.bus.append({ type: "lega.session.violation", scopeType: "system", scopeId: "test", source: "test", payload: { rolledBack: true } });
      assert.equal(t.hub.gateRearm.eligibility().security.total, 507, "visible inside the transaction");
      throw new Error("rollback");
    }), /rollback/);
    assert.equal(t.hub.gateRearm.eligibility().security.total, 506, "gone after the rollback");
    const fresh = await card(t);
    assert.equal(fresh.security.total, 506);
    assert.equal((await rearm(t, fresh, { ackSecurity: true })).reopened, true);
  } finally { if (Object.prototype.hasOwnProperty.call(t.hub.db, "prepare")) delete t.hub.db.prepare; await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ REG-02
test("R1-09 (REG-02) the typed OPEN GATE next to a security event with no authenticator enrolled: still refused, and the refusal says to enrol Windows Hello / the key first (Lega → Configurare → Identitate), the place given as data", async () => {
  const t = await makeTestHub();
  try {
    assert.equal(t.hub.trust.status().bootstrapNeeded, true);
    t.hub.bus.emit({ type: "lega.session.violation", scopeType: "system", scopeId: "lega_test", source: "test", payload: { kind: "forbidden_item" } });
    await t.hub.commands.dispatch({ type: "system.stop_all", payload: { reason: "test" }, channel: "ui", actor: "user" });
    const openGate = () => dispatch(t.hub, "gate.set", { action: "open", confirm: "OPEN GATE" }).then(() => null, (e) => e);
    const first = await openGate();
    assert.ok(first, "refused");
    assert.equal(first.category, "policy");
    assert.equal(first.details.code, "SECURITY_ACK");
    assert.equal(first.details.bootstrapNeeded, true);
    assert.deepEqual(first.details.setup, { href: "#/lega/setup", panel: "identity", label: "Lega → Configurare → Identitate" });
    assert.match(first.message, /nu ai încă niciun autentificator înregistrat/);
    assert.match(first.message, /Lega → Configurare → Identitate/);
    assert.equal(gate(t).status, "suspended", "the typed path stays refused (D16)");
    // With an authenticator the refusal is the ordinary one: the cockpit card, with the acknowledged events.
    t.owner = await enrolOwner(t, { activatePolicy: false });
    const second = await openGate();
    assert.equal(second.details.code, "SECURITY_ACK");
    assert.equal(second.details.bootstrapNeeded, undefined);
    assert.doesNotMatch(second.message, /niciun autentificator/);
    assert.equal(gate(t).status, "suspended");
  } finally { await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ REG-04
test("R1-10 (REG-04) the current API contract (13 since M11): reported by the server; a UI built for contract 11 is refused (409 UI_STALE) on the rearm routes", async () => {
  assert.equal(API_CONTRACT, 13);
  const t = await makeTestHub();
  const { server, token } = createHttpServer(t.hub);
  await new Promise((resolve) => server.listen(t.config.port, "127.0.0.1", resolve));
  const req = (p, { method = "GET", body = null, headers = {} } = {}) => new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const r = http.request({ host: "127.0.0.1", port: t.config.port, path: p, method, headers: { Host: `localhost:${t.config.port}`, ...(method !== "GET" ? { "X-Hub-Token": token } : {}), ...(data ? { "Content-Type": "application/json" } : {}), ...headers } }, (res) => {
      let text = ""; res.setEncoding("utf8"); res.on("data", (c) => { text += c; }); res.on("end", () => { let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ } resolve({ status: res.statusCode, json, headers: res.headers }); });
    });
    r.on("error", reject); if (data) r.write(data); r.end();
  });
  try {
    const session = await req("/api/session");
    assert.equal(session.json.apiContract, 13);
    assert.equal(session.headers["x-hub-contract"], "13");
    for (const route of ["/api/owner/gate/rearm/card", "/api/owner/gate/rearm"]) {
      const stale = await req(route, { method: "POST", body: {}, headers: { "X-Hub-UI-Contract": "11" } });
      assert.equal(stale.status, 409, route);
      assert.equal(stale.json.error.code, "UI_STALE", route);
    }
  } finally { await new Promise((resolve) => server.close(resolve)); await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ D22
test("R1-11 (D22) an operation plan Stop All paused is held until the rearm (a weaker suspension keeps the hold); a plan stopped later by its own intervention is not; after the rearm, a new Stop All holds only what it paused", async () => {
  const t = await ownerHub();
  try {
    testExecutors(t);
    const scope = createStopScope(t.hub);
    const op = await runningPlan(t, "Plan Alfa");
    assert.deepEqual(scope.heldByStop({ kind: "ops", id: op.id }), { held: false, cls: "open", code: null, reason: null });
    const stopped = await ownerStop(t);
    await t.hub.opsPlans.idle(op.id);
    assert.deepEqual(stopped.plansPaused, [op.id]);
    assert.deepEqual(lastStopEvent(t).scope.plansPaused, [op.id], "the stop records what it paused");
    const h = scope.heldByStop({ kind: "ops", id: op.id });
    assert.deepEqual([h.held, h.cls, h.code], [true, "stop_all", "GATE_REARM_REQUIRED"]);
    assert.match(h.reason, /Planul de operare „Plan Alfa” a fost oprit de Stop All: îl reiei cu „Continuă” după ce redeschizi poarta aici, în cockpit, pe cardul „Redeschide poarta”, cu Windows Hello\./);
    assert.ok(scope.stoppedSet().ops.has(op.id));
    // A weaker suspension afterwards keeps the Stop All record (D17): still the stop's.
    await paletteSuspend(t);
    assert.equal(classifySuspension(gate(t)).cls, "stop_all");
    assert.equal(scope.heldByStop({ kind: "ops", id: op.id }).held, true);
    // New operation plans after Stop All stay allowed (M10-OP-12); one stopped by the owner's own intervention is not the stop's.
    const op2 = await runningPlan(t, "Plan Beta", "test.intervene");
    await waitFor(() => (t.hub.opsPlans.view(op2.id).status === "NEEDS_OWNER" ? true : null));
    assert.equal(scope.heldByStop({ kind: "ops", id: op2.id }).held, false);
    assert.equal(scope.stoppedSet().ops.has(op2.id), false);
    // The card names what the stop holds.
    const c = await card(t);
    assert.ok(c.stays.some((l) => /^Ce e oprit \(un plan de operare\) rămâne oprit până spui „Continuă” după redeschidere\.$/.test(l)), JSON.stringify(c.stays));
    assert.ok(c.lines.includes("Un plan de operare a fost oprit."), JSON.stringify(c.lines));
    assert.equal((await rearm(t, c)).reopened, true);
    assert.equal(scope.heldByStop({ kind: "ops", id: op.id }).held, false, "the gate is open: the rearm ended the hold");
    assert.equal(t.hub.opsPlans.view(op.id).status, "PAUSED", "and restarted nothing");
    await ownerStop(t);
    assert.equal(scope.heldByStop({ kind: "ops", id: op.id }).held, false, "the new stop did not pause it");
    assert.deepEqual(lastStopEvent(t).scope.plansPaused, []);
  } finally { await t.cleanup(); }
});

test("R1-12 (D22) a palette suspension never holds an operation plan or the desktop session (whatever paused them); the card says such a plan resumes with „Continuă” before the rearm", async () => {
  const t = await ownerHub();
  try {
    testExecutors(t);
    const scope = createStopScope(t.hub);
    const op = await runningPlan(t, "Plan Delta");
    await paletteSuspend(t);
    assert.equal(t.hub.opsPlans.view(op.id).status, "RUNNING", "a palette suspension never pauses an operation plan");
    t.hub.opsPlans.pause(op.id, { reason: "Pauză", actor: "owner" });
    await t.hub.opsPlans.idle(op.id);
    const s = t.hub.desktop.ensureSession({ controller: "owner" });
    await t.hub.desktop.stop({ actor: "owner", reason: "Stop" });
    assert.equal(t.hub.desktop.sessionStatus().status, "PAUSED");
    assert.equal(classifySuspension(gate(t)).cls, "suspend");
    assert.equal(STOP_HOLD_CLASSES.has("suspend"), false);
    assert.deepEqual(scope.heldByStop({ kind: "ops", id: op.id }), { held: false, cls: "suspend", code: null, reason: null });
    assert.equal(scope.heldByStop({ kind: "desktop" }).held, false);
    assert.equal(scope.heldByStop({ kind: "desktop", id: s.id }).held, false);
    const set = scope.stoppedSet();
    assert.deepEqual([set.cls, set.ops.size, set.desktop, set.missions.size], ["suspend", 0, false, 0]);
    const c = await card(t);
    assert.ok(c.stays.some((l) => /Un plan de operare pus pe pauză din alt motiv decât această oprire îl reiei cu „Continuă” și înainte de redeschidere/.test(l)), JSON.stringify(c.stays));
  } finally { await t.cleanup(); }
});

test("R1-13 (D22) the desktop session: one ACTIVE at Stop All is held; once it ran again and its own stop paused it, it is not; one an intervention had paused before the stop stays the intervention's", async () => {
  const t = await ownerHub();
  try {
    const scope = createStopScope(t.hub);
    const s = t.hub.desktop.ensureSession({ controller: "owner" });
    await ownerStop(t);
    assert.equal(lastStopEvent(t).scope.desktopSessionId, s.id);
    const h = scope.heldByStop({ kind: "desktop" });
    assert.deepEqual([h.held, h.cls, h.code], [true, "stop_all", "GATE_REARM_REQUIRED"]);
    assert.match(h.reason, /Operatorul desktop a fost oprit de Stop All: îl reiei cu „Continuă” după ce redeschizi poarta/);
    assert.equal(scope.stoppedSet().desktop, true);
    const c = await card(t);
    assert.ok(c.lines.includes("Operatorul desktop a fost oprit (aplicațiile au rămas deschise)."), JSON.stringify(c.lines));
    assert.ok(c.stays.some((l) => /^Ce e oprit \(sesiunea desktop\)/.test(l)), JSON.stringify(c.stays));
    // It runs again (what desktop.resume writes) and its own „Oprește” pauses it: that later pause is not the stop's.
    t.hub.db.prepare("UPDATE desktop_sessions SET status = 'ACTIVE', end_reason = NULL WHERE id = ?").run(s.id);
    await t.hub.desktop.stop({ actor: "owner", reason: "Stop" });
    assert.equal(scope.heldByStop({ kind: "desktop" }).held, false);
    // A session an intervention paused BEFORE the next stop is not recorded by that stop.
    t.hub.desktop.endSession("test", "test");
    const s2 = t.hub.desktop.ensureSession({ controller: "owner" });
    await t.hub.desktop.stop({ actor: "desktop", reason: "ai intervenit (tastatură/mouse)" });
    await ownerStop(t);
    assert.equal(lastStopEvent(t).scope.desktopSessionId, null);
    assert.equal(scope.heldByStop({ kind: "desktop", id: s2.id }).held, false);
    assert.equal(scope.stoppedSet().desktop, false);
  } finally { await t.cleanup(); }
});

test("R1-14 (D22) a mission Stop All cancelled is the stop's (held, it stays stopped); one it never touched is not", async () => {
  const t = await ownerHub();
  try {
    const scope = createStopScope(t.hub);
    const env = await propose(t, t.project.id, t.mission.id);
    t.queue("codex", "hang");
    await confirmEnvelope(t, env);
    await activeRun(t);
    const untouched = await prepare(t, t.project.id);
    await ownerStop(t);
    await untilStage(t, t.mission.id, ["CANCELLED"]);
    assert.deepEqual(lastStopEvent(t).scope.missions, [t.mission.id]);
    const h = scope.heldByStop({ kind: "mission", id: t.mission.id });
    assert.deepEqual([h.held, h.cls, h.code], [true, "stop_all", "GATE_REARM_REQUIRED"]);
    assert.match(h.reason, /a fost oprită de Stop All și rămâne oprită/);
    assert.ok(scope.stoppedSet().missions.has(t.mission.id));
    assert.equal(scope.heldByStop({ kind: "mission", id: untouched.id }).held, false);
    assert.equal(scope.stoppedSet().missions.has(untouched.id), false);
  } finally { await t.cleanup(); }
});

test("R1-16 (D22) a plan the stop paused that ran again afterwards (the plan service recorded its resume) and stopped for its own reason is no longer the stop's", async () => {
  const t = await ownerHub();
  try {
    testExecutors(t);
    const scope = createStopScope(t.hub);
    const op = await runningPlan(t, "Plan Epsilon");
    await ownerStop(t);
    await t.hub.opsPlans.idle(op.id);
    assert.equal(scope.heldByStop({ kind: "ops", id: op.id }).held, true);
    // The evidence a resume leaves (ops.plan.resumed, then ops.plan.running) after the stop's record; the plan is stopped again by its own
    // step afterwards (status PAUSED / NEEDS_OWNER): that stop is not the Stop All's.
    t.hub.bus.emit({ type: "ops.plan.resumed", scopeType: "ops_plan", scopeId: op.id, source: `owner:${t.owner.session.id}`, payload: { session: t.owner.session.id } });
    assert.equal(t.hub.opsPlans.view(op.id).status, "PAUSED");
    assert.equal(scope.heldByStop({ kind: "ops", id: op.id }).held, false);
    assert.equal(scope.stoppedSet().ops.has(op.id), false);
  } finally { await t.cleanup(); }
});

test("R1-15 (D22) a suspension without a recorded origin (legacy_unknown) holds what was paused at or before it; the record normalizes what a stop writes; an unknown kind is refused", async () => {
  let offset = 0;
  const t = await ownerHub({ clock: () => new Date(Date.now() + offset) });
  try {
    testExecutors(t);
    const scope = createStopScope(t.hub);
    const before = await runningPlan(t, "Plan Vechi");
    t.hub.opsPlans.pause(before.id, { reason: "Pauză", actor: "owner" });
    await t.hub.opsPlans.idle(before.id);
    offset += 2000;
    const at = t.hub.config.now().toISOString();
    t.hub.bus.transaction(() => t.hub.settings.set("executionGate", { status: "suspended", reason: "Stop All", changedAt: at, changedBy: "user" }, "test"));
    assert.equal(classifySuspension(gate(t)).cls, "legacy_unknown");
    offset += 2000;
    const after = await runningPlan(t, "Plan Nou");
    t.hub.opsPlans.pause(after.id, { reason: "Pauză", actor: "owner" });
    await t.hub.opsPlans.idle(after.id);
    const h = scope.heldByStop({ kind: "ops", id: before.id });
    assert.deepEqual([h.held, h.cls], [true, "legacy_unknown"]);
    assert.match(h.reason, /înainte de suspendarea porții/);
    assert.equal(scope.heldByStop({ kind: "ops", id: after.id }).held, false, "paused after the suspension: not the stop's");
    assert.deepEqual([...scope.stoppedSet().ops], [before.id]);
    assert.throws(() => scope.heldByStop({ kind: "plan", id: before.id }), (e) => e.category === "validation");
    assert.deepEqual(stopScopeRecord({ missions: ["mis_1", "mis_1", "nu e id!", null, ""], plansPaused: "opp_x", plansInterrupted: ["opp_2"], desktopSessionId: "dss 1" }),
      { v: 1, missions: ["mis_1"], plansPaused: [], plansInterrupted: ["opp_2"], desktopSessionId: null });
  } finally { await t.cleanup(); }
});
