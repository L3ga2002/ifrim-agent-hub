// 2.12.2 — P0-R3 (the owner's requirement): a per-turn wall-clock limit for every Software Factory model step, separate from the mission
// deadline. The run manager (server/runtime/runs.mjs, turnTimeoutMs) arms it at admission (a backstop before the turn) and again, once and
// with the full limit, when the turn reaches the model; at the deadline the adapter's own interruption ends the turn, the run is recorded
// `failed / turn_timeout` (an attempt: it reached the model — never forgiven like an owner's interruption) and the lease follows the run.
// The factory (server/factory/factory.mjs) treats it as TIMEOUT, its own outcome: ONE re-dispatch after a cooldown of at least 60 s while
// the plan still has attempts (fired by tick(), through the ordinary dispatch path), the owner's decision once they are spent. Pause, Stop,
// Stop All and the mission deadline always win: no timer fires after them and a resumed step is a new run with a fresh deadline. The limits
// (writer 25 min, reviewer 15 min under BALANCED) live in the mission's limits, hashed into the scope and every plan, shown on the card.
// TT-01 … TT-09 are the owner's list; TT-10 … TT-12 cover the pieces around them.
// PASS_SIMULATED: fixture providers (fake Codex / Claude Code processes) or a controllable fake adapter, the software authenticator, test
// projects, a test clock for the cooldown; the per-turn limits are scaled down in test mode only. No model, no network, no live Hub.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeTestHub, enableLive, enrolOwner, prepareLiveWithoutGrants, waitFor } from "./helpers.mjs";
import { materializeFixture, demoSpec } from "../server/factory/fixtures.mjs";
import { TURN_TIMEOUTS, planRecord } from "../server/policy/run-plan.mjs";
import { normalizeLimits, normalizeTurnTimeouts, turnTimeoutsOf, profileTurnTimeouts, TURN_TIMEOUT_BOUNDS } from "../server/factory/plan.mjs";
import { TURN_RETRY_COOLDOWN_MS } from "../server/factory/factory.mjs";
import { runTurnTimeoutMin } from "../server/owner/envelopes.mjs";
import { hashCanonical } from "../server/core/canonical.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const V2 = path.join(here, "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dispatch = (hub, type, payload, channel = "test", extra = {}) => hub.commands.dispatch({ type, payload, channel, actor: "test", ...extra });
const events = (hub, type) => hub.db.prepare("SELECT payload_json, run_id, scope_id, created_at FROM events WHERE type = ? ORDER BY seq").all(type)
  .map((r) => ({ ...JSON.parse(r.payload_json || "{}"), _run: r.run_id, _scope: r.scope_id, _at: r.created_at }));
const leaseOfRun = (hub, runId) => hub.db.prepare("SELECT * FROM leases WHERE run_id = ? ORDER BY acquired_at DESC LIMIT 1").get(runId);
const MODELS = { writerModel: "gpt-fake-sol", reviewerModel: "sonnet" };
const SETTLED = ["DELIVERY_READY", "NEEDS_OWNER_DECISION", "BLOCKED", "PAUSED", "CANCELLED", "ACCEPTED", "REJECTED"];
// Test mode only: the writer's 25 min become 2 s and the reviewer's 15 min 1.2 s on the wire; the plan's minutes stay 25 / 15.
const SCALE = 2000 / (25 * 60000);
const WRITER_MS = Math.round(25 * 60000 * SCALE);

/** A test clock the cooldown and the mission deadline read (the turn timers are real time). */
function testClock() { const offset = { ms: 0 }; return { offset, now: () => new Date(Date.now() + offset.ms), advance: (ms) => { offset.ms += ms; } }; }

/** A Software Factory test Hub (bug-demo test project, manual grants) with the given clock. */
async function factoryHub({ fixture = "bug-demo", attempts = 5, clock = null } = {}) {
  const t = await makeTestHub({ queues: true, ...(clock ? { clock: clock.now } : {}) });
  await enableLive(t.hub, { provider: "codex", access: "workspace-write", attempts: 1 });
  const dir = path.join(t.dataDir, `factory-${fixture}`);
  materializeFixture(fixture, dir);
  const project = (await dispatch(t.hub, "project.register_test", { path: dir })).result;
  t.hub.bus.transaction(() => {
    t.hub.grants.create({ provider: "codex", projectId: project.id, access: "workspace-write", maxAttempts: attempts, maxDurationS: 900, ttlMinutes: 480 }, "test");
    t.hub.grants.create({ provider: "claude", projectId: project.id, access: "read-only", maxAttempts: attempts, maxDurationS: 900, ttlMinutes: 480 }, "test");
  });
  return { ...t, project, dir, clock };
}
const prepare = async (t, { limits } = {}) => (await dispatch(t.hub, "factory.prepare", { projectId: t.project.id, ...demoSpec("bug-demo"), limits: { ...MODELS, ...(limits || {}) } })).result;
async function approveAndStart(t, missionId) {
  const requested = await dispatch(t.hub, "factory.start", t.hub.factory.view(missionId).scope);
  await dispatch(t.hub, "approval.decide", { approvalId: requested.approval.id, decision: "approved", displayedHash: requested.approval.payloadHash });
  return t.hub.commands.executeApproved(requested.command.id, "user");
}
const view = (t, id) => t.hub.factory.view(id);
const untilStage = (t, id, stages, ms = 90000) => waitFor(() => (stages.includes(view(t, id).factory.stage) ? view(t, id) : null), ms, 50);
const untilWait = (t, id, waitReason, ms = 60000) => waitFor(() => (view(t, id).factory.waitReason === waitReason ? view(t, id) : null), ms, 30);
const idle = (t, id, ms = 30000) => Promise.race([t.hub.factory.idle(id), new Promise((_, reject) => setTimeout(() => reject(new Error("factory.idle() did not settle")), ms).unref())]);
const stageDispatches = (t, id, stage) => view(t, id).dispatches.filter((d) => d.stage === stage);
/** The active run of the mission once its turn reached the model (its deadline re-armed with the full limit). */
const turnRunning = (t, exceptRunId = null) => waitFor(() => t.hub.runs.activeRuns().find((r) => r.runId !== exceptRunId && r.turnDeadline?.phase === "turn") || null, 60000, 20);
async function tickAt(t, id, advanceMs = 0) { if (advanceMs) t.clock.advance(advanceMs); await t.hub.factory.tick(); await idle(t, id); }

/**
 * The codex adapter's startTurn replaced by a controllable fake (no process): the turn reaches the model asynchronously (as a real
 * adapter reports it), a fake supervisor record stands for the process (it exits when the turn settles). Per-start modes: completeAfterMs
 * (the answer arrives), interruptDelayMs (the interruption takes that long to settle), onInterrupt (the result the interruption yields),
 * approvalAfterMs (the provider asks for an approval after the turn was sent).
 */
function fakeAdapter(t) {
  const hub = t.hub;
  const adapter = hub.providers.codex;
  const realStart = adapter.startTurn;
  const realGet = hub.supervisor.get;
  const realStop = hub.supervisor.stop;
  const records = new Map();
  const state = { handles: [], next: {} };
  hub.supervisor.get = (key) => records.get(key) || realGet.call(hub.supervisor, key);
  hub.supervisor.stop = async (key, options) => { const r = records.get(key); if (!r) return realStop.call(hub.supervisor, key, options); r.exited = true; return { stopped: true }; };
  adapter.startTurn = (opts) => {
    const mode = { ...state.next };
    const key = `run-${opts.runId}`;
    const record = { key, pid: null, exited: false };
    records.set(key, record);
    let resolveDone;
    const done = new Promise((resolve) => { resolveDone = resolve; });
    const handle = { key, pid: null, done, record, opts, interrupts: [], settled: false, approvals: [],
      settle(result) { if (handle.settled) return; handle.settled = true; record.exited = true; resolveDone(result); },
      async interrupt(reason) {
        handle.interrupts.push(reason);
        const result = mode.onInterrupt ? mode.onInterrupt(reason) : { status: "interrupted", error: `interrupted (${reason})`, output: "", usage: {}, preInference: false };
        if (mode.interruptDelayMs) setTimeout(() => handle.settle(result), mode.interruptDelayMs); else handle.settle(result);
        return { interrupted: true, graceful: false, reason };
      } };
    state.handles.push(handle);
    setTimeout(() => {
      try { opts.onEvent({ type: "phase", phase: "turn_sent" }); } catch { /* timeline only */ }
      if (mode.completeAfterMs != null) setTimeout(() => handle.settle({ status: "completed", output: "Răspuns complet.", usage: {} }), mode.completeAfterMs);
      if (mode.approvalAfterMs != null) setTimeout(() => { handle.approvals.push(Promise.resolve(opts.requestApproval({ kind: "command", command: "npm test", cwd: opts.cwd, reason: "teste" }))); }, mode.approvalAfterMs);
    }, mode.turnSentAfterMs ?? 20);
    return handle;
  };
  state.restore = () => { adapter.startTurn = realStart; hub.supervisor.get = realGet; hub.supervisor.stop = realStop; };
  return state;
}
async function runHub(options = {}) {
  const t = await makeTestHub(options);
  const live = await enableLive(t.hub, { provider: "codex", access: "read-only", attempts: 5 });
  t.grant = live.grant;
  return t;
}
function conversation(t, title = "Analiză") {
  const project = t.hub.projects.hub();
  const c = t.hub.bus.transaction(() => t.hub.conversations.create({ projectId: project.id, title }, "user"));
  t.hub.bus.transaction(() => t.hub.conversations.addMessage({ conversationId: c.id, role: "user", content: "Rezumă README-ul." }, "user"));
  return c;
}
const startRun = async (t, extra = {}) => (await t.hub.runs.start({ conversationId: conversation(t).id, provider: "codex", access: "read-only", ...extra })).run;
const untilRun = (t, runId, statuses, ms = 30000) => waitFor(() => (statuses.includes(t.hub.runs.getRun(runId)?.status) ? t.hub.runs.getRun(runId) : null), ms, 20);

// ------------------------------------------------------------------------------------------------------------------------------ TT-01
test("TT-01 a turn that never completes is interrupted at its deadline through the adapter's own path: failed / turn_timeout, run.turn_timeout, process gone, lease released", async () => {
  const t = await runHub({ codex: "hang" });
  try {
    const run = await startRun(t, { turnTimeoutMs: 1500 });
    assert.equal(run.plan.turnTimeoutMs, 1500, "the limit is recorded with the run's plan");
    const active = await turnRunning(t);
    assert.equal(active.turnDeadline.limitMs, 1500);
    const done = await untilRun(t, run.id, ["failed", "interrupted", "completed", "blocked"], 20000);
    assert.equal(done.status, "failed", "a timeout is not an owner's interruption");
    assert.equal(done.errorCategory, "turn_timeout");
    assert.equal(done.preInference, false, "the turn reached the model: an attempt");
    assert.ok(done.timeline.turn_sent, "the turn had been sent");
    const ev = done.evidence.turnTimeout;
    assert.equal(ev.limitMs, 1500);
    assert.equal(ev.phase, "turn");
    assert.equal(ev.turnSent, true);
    assert.equal(ev.outcome, "turn_timeout");
    assert.ok(ev.elapsedMs >= 1450 && ev.elapsedMs < 6000, `elapsed ${ev.elapsedMs} ms`);
    assert.ok(Date.parse(ev.firedAt) - Date.parse(done.timeline.turn_sent) >= 1400, "measured from the moment the turn reached the model");
    assert.match(done.errorMessage, /a depășit limita de 2 s pe tură/);
    const fired = events(t.hub, "run.turn_timeout").filter((e) => e._run === run.id);
    assert.equal(fired.length, 1);
    assert.equal(fired[0].limitMs, 1500);
    assert.equal(fired[0].phase, "turn");
    // The adapter's own interruption (turn/interrupt), then the process is gone and the lease follows the run.
    assert.ok(t.readLog("codex").some((l) => l.method === "turn/interrupt"), "Codex received turn/interrupt");
    await waitFor(() => (t.hub.supervisor.list().some((p) => p.key === `run-${run.id}`) ? null : true), 15000, 50);
    await waitFor(() => (leaseOfRun(t.hub, run.id)?.status === "released" ? true : null), 15000, 50);
    assert.equal(t.hub.runs.activeRuns().length, 0);
    // A timeout reached the model: the grant attempt is spent (never refunded like a stop before inference).
    assert.equal(t.hub.grants.get(t.grant.id).attemptsUsed, 1);
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'grant.refunded' AND scope_id = ?").get(t.grant.id).n, 0);
  } finally { await t.cleanup(); }
});

test("TT-01b the admission backstop: a provider that never sends the turn is stopped at the limit too — blocked before the model, nothing counted, the grant attempt given back", async () => {
  const t = await runHub({ codex: "slow-thread" }); // thread/start answers after 1.5 s: the turn cannot be sent before the 500 ms limit
  try {
    const run = await startRun(t, { turnTimeoutMs: 500 });
    const done = await untilRun(t, run.id, ["failed", "interrupted", "completed", "blocked"], 20000);
    assert.equal(done.status, "blocked", "nothing reached the model");
    assert.equal(done.errorCategory, "turn_timeout");
    assert.equal(done.preInference, true);
    assert.ok(!done.timeline.turn_sent);
    assert.equal(done.evidence.turnTimeout.phase, "admission");
    assert.equal(done.evidence.turnTimeout.turnSent, false);
    assert.match(done.errorMessage, /nu a trimis tura modelului/);
    assert.equal(events(t.hub, "run.turn_timeout").filter((e) => e._run === run.id)[0]?.phase, "admission");
    await waitFor(() => (t.hub.grants.get(t.grant.id).attemptsUsed === 0 ? true : null), 10000, 50);
    await waitFor(() => (leaseOfRun(t.hub, run.id)?.status === "released" ? true : null), 15000, 50);
  } finally { await t.cleanup(); }
});

test("TT-01c opt-in and validated: a run without turnTimeoutMs keeps today's behaviour; an invalid limit is refused before anything starts", async () => {
  const t = await runHub();
  const fake = fakeAdapter(t);
  try {
    fake.next = { completeAfterMs: 50 };
    const plain = await startRun(t);
    assert.equal(plain.plan.turnTimeoutMs, undefined);
    assert.equal(t.hub.runs.activeRuns().find((r) => r.runId === plain.id)?.turnDeadline ?? null, null, "no deadline without a limit");
    await untilRun(t, plain.id, ["completed"]);
    const rows = () => t.hub.db.prepare("SELECT COUNT(*) AS n FROM agent_runs").get().n;
    const before = rows();
    for (const bad of [0, -5, "abc", Number.NaN, 7 * 3600000]) {
      await assert.rejects(startRun(t, { turnTimeoutMs: bad }), (e) => e.category === "validation" && /Limita pe tură/.test(e.message), String(bad));
    }
    assert.equal(rows(), before, "a refused limit records no run");
    assert.deepEqual(planRecord({ profile: "BALANCED", turnTimeoutMs: 900000 }).turnTimeoutMs, 900000);
    assert.equal("turnTimeoutMs" in planRecord({ profile: "BALANCED" }), false);
  } finally { fake.restore(); await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ TT-02
test("TT-02 the factory treats a turn timeout as TIMEOUT, distinct from a failure: its own event and reason; a provider failure stays a failure", async () => {
  const t = await factoryHub();
  try {
    t.hub.factory.setTurnTimeScaleForTests(SCALE);
    const { mission } = await prepare(t, { limits: { maxAttemptsPerStage: 1 } });
    t.queue("codex", "hang", "fail");
    await approveAndStart(t, mission.id);
    const waiting = await untilStage(t, mission.id, SETTLED);
    assert.equal(waiting.factory.stage, "NEEDS_OWNER_DECISION", waiting.factory.stageReason);
    assert.match(waiting.factory.stageReason, /^Etapa IMPLEMENTING \(writer\) a depășit limita de 25 min pe tură \(încercarea 1 din 1\); încercările confirmate s-au epuizat/);
    const [timeout] = events(t.hub, "factory.turn_timeout").filter((e) => e._scope === mission.id);
    assert.deepEqual([timeout.stage, timeout.role, timeout.limitMin, timeout.reachedModel, timeout.retry, timeout.attempt, timeout.limit], ["IMPLEMENTING", "writer", 25, true, false, 1, 1]);
    assert.equal(timeout.limitMs, WRITER_MS, "the scaled limit on the wire (test mode only)");
    const [d] = stageDispatches(t, mission.id, "IMPLEMENTING");
    assert.equal(d.status, "FAILED");
    assert.match(d.error, /^turn_timeout: limita de 25 min pe tură \(writer\)/, "the dispatch says TIMEOUT");
    assert.equal(d.request.turnTimeoutMin, 25, "the dispatch records the plan's minutes");
    const run = t.hub.runs.getRun(d.runId);
    assert.deepEqual([run.status, run.errorCategory], ["failed", "turn_timeout"]);
    assert.equal(run.plan.turnTimeoutMs, WRITER_MS);
    assert.equal(t.hub.factory.exhaustedStep(mission.id)?.stage, "IMPLEMENTING", "the owner's 'one more attempt' applies to it");
    await dispatch(t.hub, "factory.stop", { missionId: mission.id }, "ui");
    await untilStage(t, mission.id, ["CANCELLED"]);

    // A provider failure on the same step: the ordinary failure path, no TIMEOUT.
    const { mission: second } = await prepare(t, { limits: { maxAttemptsPerStage: 1 } });
    await approveAndStart(t, second.id);
    const failed = await untilStage(t, second.id, SETTLED);
    assert.equal(failed.factory.stage, "BLOCKED", failed.factory.stageReason);
    assert.doesNotMatch(failed.factory.stageReason, /pe tură/);
    assert.equal(events(t.hub, "factory.turn_timeout").filter((e) => e._scope === second.id).length, 0);
    assert.notEqual(t.hub.runs.getRun(stageDispatches(t, second.id, "IMPLEMENTING")[0].runId).errorCategory, "turn_timeout");
    await dispatch(t.hub, "factory.stop", { missionId: second.id }, "ui");
  } finally { await t.cleanup(); }
});

test("TT-02b a reviewer turn that runs out of its 15 min is a reviewer TIMEOUT (role, limit, one retry scheduled), never a review verdict", async () => {
  const t = await factoryHub();
  try {
    const { mission } = await prepare(t);
    t.queue("codex", "factory-write:bug-fix");
    t.queue("claude", "hang");
    await approveAndStart(t, mission.id);
    // The writer runs with its full limit; the review is dispatched after the checks, under the scaled limit.
    await waitFor(() => (stageDispatches(t, mission.id, "IMPLEMENTING").some((x) => ["STARTED", "DONE"].includes(x.status)) ? true : null), 60000, 10);
    t.hub.factory.setTurnTimeScaleForTests(SCALE);
    const waiting = await untilWait(t, mission.id, "retry", 90000);
    assert.equal(waiting.factory.stage, "REVIEWING");
    assert.match(waiting.factory.stageReason, /^Etapa REVIEWING \(reviewer\) a depășit limita de 15 min pe tură \(încercarea 1 din 2\); o reiau o singură dată peste 60 s/);
    const [timeout] = events(t.hub, "factory.turn_timeout").filter((e) => e._scope === mission.id);
    assert.deepEqual([timeout.stage, timeout.role, timeout.limitMin, timeout.retry], ["REVIEWING", "reviewer", 15, true]);
    assert.equal(waiting.reviews.length, 0, "a timed-out review records no verdict");
    const [review] = stageDispatches(t, mission.id, "REVIEWING");
    assert.equal(t.hub.runs.getRun(review.runId).provider, "claude");
    assert.equal(t.hub.runs.getRun(review.runId).errorCategory, "turn_timeout");
    await dispatch(t.hub, "factory.stop", { missionId: mission.id }, "ui");
    await untilStage(t, mission.id, ["CANCELLED"]);
  } finally { await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ TT-03
test("TT-03 a retry the plan allows: exactly ONE re-dispatch, after the cooldown and not before, whatever the number of ticks; the mission then completes", async () => {
  const clock = testClock();
  const t = await factoryHub({ clock });
  try {
    t.hub.factory.setTurnTimeScaleForTests(SCALE);
    const { mission } = await prepare(t);
    t.queue("codex", "hang", "factory-write:bug-fix");
    t.queue("claude", "review:pass");
    await approveAndStart(t, mission.id);
    const waiting = await untilWait(t, mission.id, "retry");
    const deadlineAt = waiting.factory.deadlineAt;
    assert.equal(waiting.factory.stage, "IMPLEMENTING", "it waits in its stage: Pause, Stop and the deadline still apply");
    assert.equal(waiting.turnRetry.attempt, 1);
    const [scheduled] = events(t.hub, "factory.turn_timeout").filter((e) => e._scope === mission.id);
    assert.deepEqual([scheduled.retry, scheduled.attempt, scheduled.limit, scheduled.limitMin], [true, 1, 2, 25]);
    assert.ok(Math.abs(Date.parse(scheduled.retryAt) - Date.parse(waiting.factory.updatedAt) - TURN_RETRY_COOLDOWN_MS) < 100, "retryAt = the timeout + the cooldown");
    assert.ok(TURN_RETRY_COOLDOWN_MS >= 60000);
    // Not before the cooldown, however many ticks.
    for (const step of [0, 0, 30000, 29000]) await tickAt(t, mission.id, step);
    assert.equal(stageDispatches(t, mission.id, "IMPLEMENTING").length, 1, "no re-dispatch before the cooldown");
    assert.equal(view(t, mission.id).factory.waitReason, "retry");
    // After it: exactly one, even with concurrent ticks.
    t.hub.factory.setTurnTimeScaleForTests(1);
    clock.advance(2000);
    await Promise.all([t.hub.factory.tick(), t.hub.factory.tick(), t.hub.factory.tick()]);
    await idle(t, mission.id);
    assert.equal(stageDispatches(t, mission.id, "IMPLEMENTING").length, 2, "exactly one re-dispatch");
    assert.equal(events(t.hub, "factory.turn_retry").filter((e) => e._scope === mission.id).length, 1);
    const done = await untilStage(t, mission.id, SETTLED, 120000);
    assert.equal(done.factory.stage, "DELIVERY_READY", done.factory.stageReason);
    for (let i = 0; i < 5; i++) await tickAt(t, mission.id, 61000);
    const writes = stageDispatches(t, mission.id, "IMPLEMENTING");
    assert.deepEqual(writes.map((d) => [d.request.attempt, d.request.counted, d.status]), [[1, 1, "FAILED"], [2, 2, "DONE"]], "the timeout counted as an attempt");
    assert.equal(t.hub.runs.getRun(writes[1].runId).plan.turnTimeoutMs, 25 * 60000, "the retried turn has its own full deadline");
    assert.equal(view(t, mission.id).factory.deadlineAt, deadlineAt, "a turn timeout never moves the mission's deadline");
    assert.equal(events(t.hub, "factory.deadline_extended").length, 0);
  } finally { await t.cleanup(); }
});

test("TT-03b a scheduled retry never goes through a suspended gate (and a reopened gate restarts nothing), nor after a Pause in the cooldown", async () => {
  const clock = testClock();
  const t = await factoryHub({ clock });
  const setGate = (status) => t.hub.bus.transaction(() => t.hub.settings.set("executionGate", { status, reason: `test ${status}`, changedAt: new Date().toISOString(), changedBy: "test" }, "test"));
  try {
    t.hub.factory.setTurnTimeScaleForTests(SCALE);
    const { mission } = await prepare(t, { limits: { maxAttemptsPerStage: 3 } });
    t.queue("codex", "hang", "hang");
    await approveAndStart(t, mission.id);
    await untilWait(t, mission.id, "retry");
    setGate("suspended");
    await tickAt(t, mission.id, 61000);
    const blocked = view(t, mission.id);
    assert.deepEqual([blocked.factory.stage, blocked.factory.waitReason], ["BLOCKED", "gate"]);
    assert.match(blocked.factory.stageReason, /poarta de execuție e suspendată/);
    assert.equal(stageDispatches(t, mission.id, "IMPLEMENTING").length, 1, "nothing dispatched through a suspended gate");
    setGate("open");
    for (let i = 0; i < 3; i++) await tickAt(t, mission.id, 61000);
    assert.equal(view(t, mission.id).factory.stage, "BLOCKED", "a reopened gate restarts nothing by itself");
    assert.equal(stageDispatches(t, mission.id, "IMPLEMENTING").length, 1);
    // The owner continues it: a new attempt, which times out too → a second retry scheduled (3 attempts in the plan).
    await dispatch(t.hub, "factory.resume", { missionId: mission.id }, "ui");
    const again = await waitFor(() => { const v = view(t, mission.id); return v.factory.waitReason === "retry" && stageDispatches(t, mission.id, "IMPLEMENTING").length === 2 ? v : null; }, 60000, 30);
    assert.equal(again.turnRetry.attempt, 2);
    await dispatch(t.hub, "factory.pause", { missionId: mission.id }, "ui");
    for (let i = 0; i < 3; i++) await tickAt(t, mission.id, 61000);
    assert.equal(view(t, mission.id).factory.stage, "PAUSED", "a Pause in the cooldown wins");
    assert.equal(stageDispatches(t, mission.id, "IMPLEMENTING").length, 2, "no re-dispatch after the Pause");
    assert.equal(events(t.hub, "factory.turn_retry").length, 0);
    await dispatch(t.hub, "factory.stop", { missionId: mission.id }, "ui");
  } finally { await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ TT-04
test("TT-04 attempts exhausted by timeouts: NEEDS_OWNER_DECISION with the honest reason, no further dispatch however long the clock runs and however many ticks", async () => {
  const clock = testClock();
  const t = await factoryHub({ clock });
  try {
    t.hub.factory.setTurnTimeScaleForTests(SCALE);
    const { mission } = await prepare(t);
    t.queue("codex", "hang", "hang", "factory-write:bug-fix");
    await approveAndStart(t, mission.id);
    await untilWait(t, mission.id, "retry");
    await tickAt(t, mission.id, 61000);
    const decided = await untilStage(t, mission.id, ["NEEDS_OWNER_DECISION", "BLOCKED", "PAUSED", "CANCELLED"], 60000);
    assert.equal(decided.factory.stage, "NEEDS_OWNER_DECISION");
    assert.match(decided.factory.stageReason, /a depășit limita de 25 min pe tură \(încercarea 2 din 2\); încercările confirmate s-au epuizat — decide dacă reiei/);
    const timeouts = events(t.hub, "factory.turn_timeout").filter((e) => e._scope === mission.id);
    assert.deepEqual(timeouts.map((e) => [e.attempt, e.retry]), [[1, true], [2, false]]);
    for (let i = 0; i < 12; i++) await tickAt(t, mission.id, 5 * 60000);
    const after = view(t, mission.id);
    assert.equal(after.factory.stage, "NEEDS_OWNER_DECISION");
    assert.equal(stageDispatches(t, mission.id, "IMPLEMENTING").length, 2, "no loop: the attempts are spent");
    assert.equal(events(t.hub, "factory.turn_retry").length, 1, "one automatic retry in all");
    assert.equal(t.hub.runs.activeRuns().length, 0);
    assert.deepEqual(t.hub.factory.exhaustedStep(mission.id), { stage: "IMPLEMENTING", counted: 2, limit: 2 });
  } finally { await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ TT-05
test("TT-05 Pause during the turn: its deadline is cleared (no timeout fires), and the resumed step gets a fresh, full deadline of its own", async () => {
  const clock = testClock();
  const t = await factoryHub({ clock });
  try {
    t.hub.factory.setTurnTimeScaleForTests(SCALE);
    const { mission } = await prepare(t);
    t.queue("codex", "hang", "hang");
    await approveAndStart(t, mission.id);
    const first = await turnRunning(t);
    assert.equal(first.turnDeadline.limitMs, WRITER_MS);
    await dispatch(t.hub, "factory.pause", { missionId: mission.id }, "ui");
    await waitFor(() => (view(t, mission.id).factory.stage === "PAUSED" && t.hub.runs.activeRuns().length === 0 ? true : null), 20000, 20);
    await sleep(WRITER_MS + 800); // past the first turn's deadline
    assert.equal(events(t.hub, "run.turn_timeout").length, 0, "no timeout after the Pause");
    assert.deepEqual([t.hub.runs.getRun(first.runId).status, t.hub.runs.getRun(first.runId).errorCategory], ["interrupted", null]);
    assert.equal(events(t.hub, "factory.turn_timeout").length, 0);
    await dispatch(t.hub, "factory.resume", { missionId: mission.id }, "ui");
    const second = await turnRunning(t, first.runId);
    const run2 = t.hub.runs.getRun(second.runId);
    assert.equal(second.turnDeadline.limitMs, WRITER_MS, "the full limit again");
    assert.ok(Math.abs(Date.parse(second.turnDeadline.at) - Date.parse(run2.timeline.turn_sent) - WRITER_MS) < 300, "counted from the resumed turn, not the paused one");
    await waitFor(() => (events(t.hub, "run.turn_timeout").length ? true : null), 20000, 20);
    const fired = events(t.hub, "run.turn_timeout");
    assert.deepEqual(fired.map((e) => e._run), [second.runId], "only the resumed turn timed out");
    assert.ok(fired[0].elapsedMs >= WRITER_MS - 50);
    // The paused attempt did not count: the timed-out one is attempt 1 of 2, so one retry is scheduled.
    const waiting = await untilWait(t, mission.id, "retry");
    assert.equal(waiting.turnRetry.attempt, 1);
    await dispatch(t.hub, "factory.stop", { missionId: mission.id }, "ui");
    await untilStage(t, mission.id, ["CANCELLED"]);
  } finally { await t.cleanup(); }
});

test("TT-05b an interruption clears the deadline even when the turn takes longer than the remaining time to settle (run manager)", async () => {
  const t = await runHub();
  const fake = fakeAdapter(t);
  try {
    fake.next = { interruptDelayMs: 900 }; // the interrupted turn settles after its deadline would have passed
    const run = await startRun(t, { turnTimeoutMs: 600 });
    await turnRunning(t);
    await sleep(250);
    await t.hub.runs.interrupt(run.id, "factory-pause");
    const done = await untilRun(t, run.id, ["interrupted", "failed", "completed", "blocked"], 10000);
    assert.equal(done.status, "interrupted", "the owner's interruption, never a timeout");
    assert.equal(done.errorCategory, null);
    assert.equal(done.evidence.turnTimeout, undefined);
    await sleep(300);
    assert.equal(events(t.hub, "run.turn_timeout").length, 0);
    assert.deepEqual(fake.handles[0].interrupts, ["factory-pause"], "one interruption: the owner's");
  } finally { fake.restore(); await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ TT-06
test("TT-06 Stop All during the turn: no timeout after the stop, no retry scheduled or fired, the mission cancelled", async () => {
  const clock = testClock();
  const t = await factoryHub({ clock });
  try {
    t.hub.factory.setTurnTimeScaleForTests(SCALE);
    const { mission } = await prepare(t);
    t.queue("codex", "hang", "hang");
    await approveAndStart(t, mission.id);
    const running = await turnRunning(t);
    const out = await t.hub.runs.stopAll("test", "Stop All (TT-06)");
    assert.equal(out.gate, "suspended");
    assert.equal(t.hub.settings.get("executionGate").status, "suspended");
    await untilStage(t, mission.id, ["CANCELLED"], 30000);
    await sleep(WRITER_MS + 800);
    assert.equal(events(t.hub, "run.turn_timeout").length, 0, "no timeout after Stop All");
    assert.equal(t.hub.runs.getRun(running.runId).status, "interrupted");
    assert.notEqual(t.hub.runs.getRun(running.runId).errorCategory, "turn_timeout");
    for (let i = 0; i < 3; i++) await tickAt(t, mission.id, 61000);
    assert.equal(events(t.hub, "factory.turn_timeout").length, 0);
    assert.equal(events(t.hub, "factory.turn_retry").length, 0);
    assert.equal(stageDispatches(t, mission.id, "IMPLEMENTING").length, 1);
    assert.equal(view(t, mission.id).factory.stage, "CANCELLED");
  } finally { await t.cleanup(); }
});

test("TT-06b Stop All clears every armed deadline synchronously, even when the stopped turn settles after its deadline (run manager)", async () => {
  const t = await runHub();
  const fake = fakeAdapter(t);
  try {
    fake.next = { interruptDelayMs: 900 };
    const run = await startRun(t, { turnTimeoutMs: 600 });
    await turnRunning(t);
    await sleep(250);
    await t.hub.runs.stopAll("test", "Stop All (TT-06b)");
    const done = await untilRun(t, run.id, ["interrupted", "failed", "completed", "blocked"], 10000);
    assert.equal(done.status, "interrupted");
    assert.equal(done.evidence.turnTimeout, undefined);
    await sleep(300);
    assert.equal(events(t.hub, "run.turn_timeout").length, 0);
    assert.deepEqual(fake.handles[0].interrupts, ["stop-all"]);
  } finally { fake.restore(); await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ TT-07
test("TT-07 values and bounds: BALANCED writer 25 / reviewer 15 (ECONOMIC 15/8, DEEP 45/25), resolved from the profile unless set, refused outside 5–60 / 3–40", () => {
  assert.deepEqual(TURN_TIMEOUTS, { writer: { ECONOMIC: 15, BALANCED: 25, DEEP: 45 }, reviewer: { ECONOMIC: 8, BALANCED: 15, DEEP: 25 } });
  assert.deepEqual(TURN_TIMEOUT_BOUNDS, { writer: [5, 60], reviewer: [3, 40] });
  assert.deepEqual(normalizeLimits({}).turnTimeoutMin, { writer: 25, reviewer: 15, source: "profile" });
  assert.deepEqual(normalizeLimits({ profile: "ECONOMIC" }).turnTimeoutMin, { writer: 15, reviewer: 8, source: "profile" });
  assert.deepEqual(normalizeLimits({ profile: "DEEP" }).turnTimeoutMin, { writer: 45, reviewer: 25, source: "profile" });
  assert.equal(normalizeLimits({}).maxDurationMin, 120, "the mission deadline stays its own limit");
  assert.deepEqual(normalizeLimits({ turnTimeoutMin: { writer: 30 } }).turnTimeoutMin, { writer: 30, reviewer: 15, source: "explicit", explicit: ["writer"] });
  assert.deepEqual(normalizeLimits({ turnTimeoutMin: { writer: "40", reviewer: 10 } }).turnTimeoutMin, { writer: 40, reviewer: 10, source: "explicit", explicit: ["writer", "reviewer"] });
  // A role resolved from the profile follows a changed profile (factory.limits merges the stored limits with the change); a set one stays.
  assert.deepEqual(normalizeLimits({ ...normalizeLimits({}), profile: "DEEP" }).turnTimeoutMin, { writer: 45, reviewer: 25, source: "profile" });
  assert.deepEqual(normalizeLimits({ ...normalizeLimits({ turnTimeoutMin: { writer: 30 } }), profile: "DEEP" }).turnTimeoutMin, { writer: 30, reviewer: 25, source: "explicit", explicit: ["writer"] });
  assert.deepEqual(normalizeTurnTimeouts({ writer: 59, reviewer: 39, source: "profile" }), { writer: 25, reviewer: 15, source: "profile" }, "a profile-resolved object carries no choice");
  for (const [ok, role] of [[5, "writer"], [60, "writer"], [3, "reviewer"], [40, "reviewer"]]) assert.equal(normalizeTurnTimeouts({ [role]: ok })[role], ok);
  for (const bad of [{ writer: 4 }, { writer: 61 }, { writer: 2.5 }, { writer: "x" }, { writer: true }, { reviewer: 2 }, { reviewer: 41 }, { reviewer: -1 }, "25", [25, 15]]) {
    assert.throws(() => normalizeLimits({ turnTimeoutMin: bad }), (e) => e.category === "validation" && /tur/.test(e.message), JSON.stringify(bad));
  }
  // Limits written before 2.12.2 run with their profile's values (never without a limit, never a looser one).
  assert.deepEqual(turnTimeoutsOf({}), { writer: 25, reviewer: 15, source: "profile" });
  assert.deepEqual(turnTimeoutsOf({ profile: "DEEP", maxDurationMin: 120 }), { writer: 45, reviewer: 25, source: "profile" });
  assert.deepEqual(turnTimeoutsOf({ profile: "BALANCED", turnTimeoutMin: { writer: 999 } }), { writer: 25, reviewer: 15, source: "profile" }, "an unreadable stored value falls back to the profile");
  assert.deepEqual(profileTurnTimeouts("NOPE"), { writer: 25, reviewer: 15 });
  // Run plans: a read-only turn like a reviewer, a write turn like a writer.
  assert.equal(runTurnTimeoutMin("read-only"), 15);
  assert.equal(runTurnTimeoutMin("workspace-write"), 25);
  assert.equal(runTurnTimeoutMin("read-only", { profile: "DEEP" }), 25);
});

/** A test Hub whose Codex account lists the role-default writer model, the bug-demo test project and the owner (voice-first active). */
async function plannerHub() {
  const t = await makeTestHub({ queues: true });
  fs.writeFileSync(`${t.logs.codex}.models.json`, JSON.stringify([{ id: "gpt-6.1-sol", isDefault: true, efforts: ["medium", "high"] }, { id: "gpt-fake-sol", efforts: ["medium", "high"] }]));
  await prepareLiveWithoutGrants(t.hub);
  const dir = path.join(t.dataDir, "factory-bug-demo");
  materializeFixture("bug-demo", dir);
  const project = (await dispatch(t.hub, "project.register_test", { path: dir })).result;
  const owner = await enrolOwner(t);
  return { ...t, project, dir, owner };
}

test("TT-07b the plan shows and binds them: planner note and card line (writer 25 / reviewer 15 / mission 120 for the bug demo), body limits hashed; a changed turn limit changes the plan", async () => {
  const t = await plannerHub();
  try {
    const BUG = "Repară bug-ul: un nume format doar din spații trece de validare. Testul de acceptanță e test/acceptance.test.mjs.";
    const r = await t.hub.intake.plan({ kind: "engineering", text: `Lega, ${BUG}`, projectId: t.project.id }, { channel: "owner", ownerSession: t.owner.session, actor: "owner" });
    const env = r.plan?.envelope;
    assert.ok(env?.id, JSON.stringify(r).slice(0, 500));
    const missionId = env.missionIds[0];
    assert.match(r.note, /Limită pe tură: writer 25 min, reviewer 15 min; termen misiune 120 min \(legate în plan\)/);
    assert.match(r.plan.summary.limits, /^Limită pe tură: writer 25 min, reviewer 15 min; termen misiune 120 min\. O tură care depășește limita e oprită; o reiau automat doar în încercările din plan/);
    assert.deepEqual(env.body.limits.turnTimeoutMin, { writer: 25, reviewer: 15 });
    assert.deepEqual(env.body.missions[0].limits.turnTimeoutMin, { writer: 25, reviewer: 15, source: "profile" }, "in the mission's limits, so in its scope hash");
    assert.deepEqual(view(t, missionId).turnLimits, { writer: 25, reviewer: 15, source: "profile", missionMin: 120 });

    // A mission the owner prepared: the same values; changing its turn limit changes the scope, refuses the shown plan, changes the hash.
    const { mission } = (await dispatch(t.hub, "factory.prepare", { projectId: t.project.id, ...demoSpec("bug-demo"), limits: MODELS })).result;
    const shown = (await dispatch(t.hub, "envelope.propose", { projectId: t.project.id, missionIds: [mission.id] })).result.envelope;
    assert.deepEqual(shown.body.limits.turnTimeoutMin, { writer: 25, reviewer: 15 });
    const scopeBefore = hashCanonical(view(t, mission.id).scope);
    await assert.rejects(dispatch(t.hub, "factory.limits", { missionId: mission.id, limits: { turnTimeoutMin: { writer: 61 } } }), /între 5 și 60 min/);
    await assert.rejects(dispatch(t.hub, "factory.limits", { missionId: mission.id, limits: { turnTimeoutMin: { reviewer: 2 } } }), /între 3 și 40 min/);
    await dispatch(t.hub, "factory.limits", { missionId: mission.id, limits: { turnTimeoutMin: { writer: 30 } } });
    assert.notEqual(hashCanonical(view(t, mission.id).scope), scopeBefore, "the scope hash covers the turn limits");
    await assert.rejects(dispatch(t.hub, "envelope.confirm", { envelopeId: shown.id, nonce: shown.nonce, displayedHash: shown.envelopeHash }, "test", { ownerSession: t.owner.session }), /limitele/);
    assert.equal(t.hub.envelopes.get(shown.id).status, "SUPERSEDED");
    const again = (await dispatch(t.hub, "envelope.propose", { projectId: t.project.id, missionIds: [mission.id] })).result;
    assert.notEqual(again.envelope.envelopeHash, shown.envelopeHash);
    assert.deepEqual(again.envelope.body.limits.turnTimeoutMin, { writer: 30, reviewer: 15 });
    assert.match(again.summary.limits, /^Limită pe tură: writer 30 min, reviewer 15 min; termen misiune 120 min\./);
    // The card renders the line (the plan-limits rendering only).
    const cards = fs.readFileSync(path.join(V2, "web", "src", "screens", "lega", "cards.jsx"), "utf8");
    assert.match(cards, /\{summary\.limits && <li>\{summary\.limits\}<\/li>\}/);
  } finally { await t.cleanup(); }
});

test("TT-07c a run plan binds its turn limit too (15 min for a read-only analysis) and its one turn runs under it", async () => {
  const t = await makeTestHub();
  try {
    await prepareLiveWithoutGrants(t.hub);
    t.owner = await enrolOwner(t);
    const p = t.hub.projects.hub();
    await dispatch(t.hub, "owner.autonomy.set", { projectId: p.id, level: "ASSISTED" }, "test", { ownerSession: t.owner.reauth() });
    const r = await t.hub.intake.plan({ kind: "run", text: "Analizează structura proiectului și spune-mi ce module are", projectId: p.id, args: { provider: "claude" } },
      { channel: "test", actor: "owner:test", ownerSession: t.owner.session });
    const env = r.plan?.envelope;
    assert.ok(env?.id, JSON.stringify(r).slice(0, 500));
    assert.equal(env.body.limits.turnTimeoutMin, 15);
    assert.match(r.plan.summary.limits, /^Limită pe tură: 15 min; termen plan 30 min\./);
    await dispatch(t.hub, "envelope.confirm", { envelopeId: env.id, nonce: env.nonce, displayedHash: env.envelopeHash }, "test", { ownerSession: t.owner.session });
    const runId = await waitFor(() => t.hub.envelopes.get(env.id).derived?.runId || null, 20000, 20);
    assert.equal(t.hub.runs.getRun(runId).plan.turnTimeoutMs, 15 * 60000);
  } finally { await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ TT-08
test("TT-08 the mission deadline stays independent: a 10-minute mission is paused at its deadline while the turn's own 25-minute limit has not passed", async () => {
  const clock = testClock();
  const t = await factoryHub({ clock });
  try {
    const { mission } = await prepare(t, { limits: { maxDurationMin: 10 } });
    assert.deepEqual(view(t, mission.id).turnLimits, { writer: 25, reviewer: 15, source: "profile", missionMin: 10 });
    t.queue("codex", "hang");
    await approveAndStart(t, mission.id);
    const running = await turnRunning(t);
    assert.equal(running.turnDeadline.limitMs, 25 * 60000, "the turn's limit is longer than the mission's whole window");
    await tickAt(t, mission.id, 11 * 60000);
    const decided = await untilStage(t, mission.id, ["NEEDS_OWNER_DECISION", "BLOCKED", "CANCELLED"], 30000);
    assert.equal(decided.factory.stage, "NEEDS_OWNER_DECISION");
    assert.match(decided.factory.stageReason, /Limita de timp a misiunii a fost atinsă/);
    await waitFor(() => (t.hub.runs.activeRuns().length === 0 ? true : null), 20000, 20);
    assert.deepEqual([t.hub.runs.getRun(running.runId).status, t.hub.runs.getRun(running.runId).errorCategory], ["interrupted", null], "the deadline's pause, not a turn timeout");
    assert.equal(events(t.hub, "run.turn_timeout").length, 0);
    assert.equal(events(t.hub, "factory.turn_timeout").length, 0);
  } finally { await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ TT-09
test("TT-09 races at the deadline: a turn that completes just before it is never a timeout; one whose answer arrives while the deadline interrupts it stays completed", async () => {
  const t = await runHub();
  const fake = fakeAdapter(t);
  try {
    fake.next = { completeAfterMs: 120 };
    const early = await startRun(t, { turnTimeoutMs: 700 });
    const a = await untilRun(t, early.id, ["completed", "failed", "interrupted", "blocked"], 10000);
    assert.equal(a.status, "completed");
    await sleep(900); // past the deadline it had
    assert.equal(events(t.hub, "run.turn_timeout").filter((e) => e._run === early.id).length, 0, "its deadline was cleared with the run");
    assert.equal(a.evidence.turnTimeout, undefined);
    assert.deepEqual(fake.handles[0].interrupts, [], "never interrupted");

    // The deadline fires, but the turn's answer is what settles it: the answer counts, the run is completed (not a timeout).
    fake.next = { onInterrupt: () => ({ status: "completed", output: "Răspuns sosit la limită.", usage: {} }) };
    const late = await startRun(t, { turnTimeoutMs: 300 });
    const b = await untilRun(t, late.id, ["completed", "failed", "interrupted", "blocked"], 10000);
    assert.equal(b.status, "completed");
    assert.equal(b.errorCategory, null);
    assert.equal(b.evidence.turnTimeout.outcome, "completed", "the deadline is recorded as evidence, not as the outcome");
    assert.deepEqual(fake.handles[1].interrupts, ["turn-timeout"]);
    assert.equal(t.hub.db.prepare("SELECT status FROM messages WHERE id = ?").get(b.outputMessageId).status, "final");

    // A more specific stop the provider reports at the same moment (here: the plan's quota) keeps its own cause.
    fake.next = { onInterrupt: () => ({ status: "failed", errorCategory: "quota", error: "Alocarea planului este epuizată", output: "", usage: {}, preInference: false }) };
    const quota = await startRun(t, { turnTimeoutMs: 300 });
    const c = await untilRun(t, quota.id, ["completed", "failed", "interrupted", "blocked"], 10000);
    assert.deepEqual([c.status, c.errorCategory], ["failed", "quota"]);
    assert.equal(c.evidence.turnTimeout.outcome, "quota");

    fake.next = { onInterrupt: () => ({ status: "failed", errorCategory: "output_token_limit", error: "Bugetul de ieșire este epuizat", output: "Răspuns parțial", usage: {}, preInference: false }) };
    const limited = await startRun(t, { turnTimeoutMs: 300 });
    const d = await untilRun(t, limited.id, ["completed", "failed", "interrupted", "blocked"], 10000);
    assert.deepEqual([d.status, d.errorCategory], ["failed", "output_token_limit"]);
    assert.equal(d.evidence.turnTimeout.outcome, "output_token_limit");
    assert.ok(d.evidence.turnTimeout.firedAt);
    assert.equal(events(t.hub, "run.turn_timeout").filter((e) => e._run === limited.id).length, 1);
    assert.deepEqual(fake.handles[3].interrupts, ["turn-timeout"]);
    assert.equal(d.errorMessage, "Bugetul de ieșire este epuizat");
  } finally { fake.restore(); await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ TT-12
test("TT-12 a factory turn stopped by its limit before it reached the model is not an attempt and is never retried by itself (BLOCKED, the owner continues)", async () => {
  const clock = testClock();
  const t = await factoryHub({ clock });
  try {
    t.hub.factory.setTurnTimeScaleForTests(500 / (25 * 60000)); // writer: 500 ms, shorter than the fixture's 1.5 s thread start
    const { mission } = await prepare(t);
    t.queue("codex", "slow-thread");
    await approveAndStart(t, mission.id);
    const blocked = await untilStage(t, mission.id, SETTLED, 60000);
    assert.deepEqual([blocked.factory.stage, blocked.factory.waitReason], ["BLOCKED", "owner_decision"], blocked.factory.stageReason);
    assert.match(blocked.factory.stageReason, /providerul nu a trimis tura modelului în limita de 25 min pe tură; nimic nu a ajuns la model, încercarea nu se numără/);
    const [timeout] = events(t.hub, "factory.turn_timeout").filter((e) => e._scope === mission.id);
    assert.deepEqual([timeout.reachedModel, timeout.retry], [false, false]);
    const [d] = stageDispatches(t, mission.id, "IMPLEMENTING");
    assert.deepEqual([t.hub.runs.getRun(d.runId).status, t.hub.runs.getRun(d.runId).errorCategory], ["blocked", "turn_timeout"]);
    for (let i = 0; i < 3; i++) await tickAt(t, mission.id, 61000);
    assert.equal(stageDispatches(t, mission.id, "IMPLEMENTING").length, 1, "never retried by itself");
    // Nothing reached the model: the grant attempt the start took is given back (not counted, not spent).
    const writerGrant = t.hub.grants.list().find((g) => g.projectId === t.project.id && g.provider === "codex");
    await waitFor(() => (t.hub.grants.get(writerGrant.id).attemptsUsed === 0 ? true : null), 10000, 50);
    await dispatch(t.hub, "factory.stop", { missionId: mission.id }, "ui");
  } finally { await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ TT-10
test("TT-10 a provider approval still waiting when the deadline passes is declined at once, and a later one is never asked", async () => {
  const t = await runHub();
  const fake = fakeAdapter(t);
  try {
    // Asked 50 ms after the turn reached the model; the turn's limit is 500 ms.
    fake.next = { approvalAfterMs: 50, interruptDelayMs: 400 };
    const run = await startRun(t, { turnTimeoutMs: 500 });
    await waitFor(() => (t.hub.runs.getRun(run.id)?.status === "waiting_approval" ? true : null), 10000, 10);
    const answer = await Promise.race([fake.handles[0].approvals[0], sleep(3000).then(() => "still waiting")]);
    assert.equal(answer, "decline", "declined by the deadline, not left to the owner for 15 minutes");
    // Asked again while the timed-out turn is ending: declined without a card.
    const cards = t.hub.db.prepare("SELECT COUNT(*) AS n FROM approvals WHERE scope_id = ?").get(run.id).n;
    const again = await Promise.race([Promise.resolve(fake.handles[0].opts.requestApproval({ kind: "command", command: "npm test", cwd: fake.handles[0].opts.cwd, reason: "din nou" })), sleep(2000).then(() => "still waiting")]);
    assert.equal(again, "decline");
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM approvals WHERE scope_id = ?").get(run.id).n, cards, "no new approval card");
    const done = await untilRun(t, run.id, ["failed", "interrupted", "completed", "blocked"], 10000);
    assert.deepEqual([done.status, done.errorCategory], ["failed", "turn_timeout"]);
  } finally { fake.restore(); await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ TT-11
test("TT-11 the test-only time scale is refused outside test mode and outside (0, 1]", async () => {
  const t = await makeTestHub();
  try {
    for (const bad of [0, -1, 2, "x", Number.NaN]) assert.throws(() => t.hub.factory.setTurnTimeScaleForTests(bad), (e) => e.category === "validation", String(bad));
    assert.equal(t.hub.factory.setTurnTimeScaleForTests(0.5), 0.5);
    assert.equal(t.hub.factory.setTurnTimeScaleForTests(1), 1);
  } finally { await t.cleanup(); }
  // Outside test mode the factory refuses it (a live Hub never shortens a confirmed limit).
  const { createFactory } = await import("../server/factory/factory.mjs");
  const f = createFactory({ db: null, bus: null, clock: () => new Date(), config: { testMode: false }, settings: null, projects: null, conversations: null, missions: null, runs: null, supervisor: null, runner: null, leases: null });
  assert.throws(() => f.setTurnTimeScaleForTests(0.5), (e) => e.category === "policy");
});
