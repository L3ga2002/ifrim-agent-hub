// 2.12.2 — P0-R1 (the owner's requirement): workspace leases retained after Stop All or a restart never keep the gate closed for good.
// The reconciler (server/runtime/lease-reconcile.mjs) releases a lease once its run is finished and its provider process is provably gone
// — a bounded follow-up after lease.retained, the boot pass, the scheduler tick — and never relaunches anything. What cannot be proven
// becomes a step INCLUDED in the owner's rearm card (server/owner/gate-rearm.mjs): an orphaned process the Hub's own records tie to the run
// is stopped inside the same ceremony (fresh Windows Hello), an unknown outcome is released only with the owner's acknowledgement bound
// into the card hash. Stop All never waits for any of it. LR-01 … LR-10 are the owner's list; LR-11 … LR-13 cover the pieces around them.
// PASS_SIMULATED: a fake provider adapter and fake supervisor records, a fake OS probe (no real PID is ever killed), the software
// authenticator, seeded rows for the environment route (never wsl.exe); no model, no network, no live Hub.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeTestHub, enableLive, enrolOwner, waitFor } from "./helpers.mjs";
import { createHub } from "../server/hub.mjs";
import { createProcessProbe, parseCreationDate, startEvidenceMatches, FOLLOW_UP_MS, START_TOLERANCE_MS, LEASES_ACK_LABEL, TERMINAL_RUN_STATUSES } from "../server/runtime/lease-reconcile.mjs";
import { LEASES_ACK_LABEL as UI_LEASES_ACK_LABEL, rearmRequestBody, rearmReady, rearmErrorAction, rearmOutcome, rearmLeaseSteps, rearmLeasesAckRequired,
  rearmLeasesOnly, continueAfterFetch, sameDisplayedCard } from "../web/src/lib/rearmLogic.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const V2 = path.join(here, "..");
const ADMIN_POINTERS = /OPEN GATE|Integrări → Avansat|Avansat|din Sistem|#\/system/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const gate = (hub) => hub.settings.get("executionGate");
const count = (hub, sql, ...args) => hub.db.prepare(sql).get(...args).n;
const events = (hub, type) => hub.db.prepare("SELECT payload_json, run_id FROM events WHERE type = ? ORDER BY seq").all(type).map((r) => ({ ...JSON.parse(r.payload_json || "{}"), _run: r.run_id }));
const leaseRow = (hub, id) => hub.db.prepare("SELECT * FROM leases WHERE id = ?").get(id);
const leaseOfRun = (hub, runId) => hub.db.prepare("SELECT * FROM leases WHERE run_id = ? ORDER BY acquired_at DESC LIMIT 1").get(runId);
const asOwner = (hub, session, type, payload = {}) => hub.commands.dispatch({ type, payload, channel: "owner", actor: `owner:${session.id}`, ownerSession: session }).then((r) => r.result);
const card = (t, session = t.owner.session, hub = t.hub) => asOwner(hub, session, "gate.rearm.card", {});
const rearm = (t, c, extra = {}, session = t.owner.reauth(), hub = t.hub) => asOwner(hub, session, "gate.rearm", { nonce: c.nonce, hash: c.hash, ...extra });
const ownerStop = (t) => t.hub.commands.dispatch({ type: "system.stop_all", payload: { reason: "test" }, channel: "owner", actor: `owner:${t.owner.session.id}`, ownerSession: t.owner.session }).then((r) => r.result);
const codeOf = (e) => e?.details?.code || null;
const stale = (hub, session) => hub.db.prepare("UPDATE owner_sessions SET reauth_at = ? WHERE id = ?").run(new Date(Date.now() - 10 * 60000).toISOString(), session.id);

/**
 * The fixture codex adapter's startTurn replaced by a controllable fake (no process): each turn gets a fake supervisor record (the Hub's
 * process evidence) whose exit the test decides. Modes: exitOnInterrupt (the process confirms its exit at the Stop), settleOnInterrupt
 * (false: the turn's answer never arrives), pid. supervisor.get/stop answer for these records only (the real ones for anything else).
 */
function fakeProvider(t) {
  const hub = t.hub;
  const adapter = hub.providers.codex;
  const realStart = adapter.startTurn;
  const realGet = hub.supervisor.get;
  const realStop = hub.supervisor.stop;
  const records = new Map();
  const state = { starts: 0, handles: [], stops: [], records };
  let nextMode = {};
  hub.supervisor.get = (key) => records.get(key) || realGet.call(hub.supervisor, key);
  hub.supervisor.stop = async (key, options) => {
    const record = records.get(key);
    if (!record) return realStop.call(hub.supervisor, key, options);
    state.stops.push(key);
    if (record.stopDelayMs) await sleep(record.stopDelayMs);
    if (record.stoppable !== false) record.exited = true;
    return record.stopResult || { stopped: record.exited, method: "taskkill", taskkill: { ok: true } };
  };
  adapter.startTurn = (opts) => {
    state.starts += 1;
    const mode = { ...nextMode };
    const key = `run-${opts.runId}`;
    const record = { key, pid: mode.pid ?? null, exited: false, stoppable: mode.stoppable !== false, stopDelayMs: 0 };
    records.set(key, record);
    let settle;
    const done = new Promise((resolve) => { settle = resolve; });
    const handle = { key, pid: mode.pid ?? null, done, record, opts, interrupts: [], settle: (result) => settle(result),
      interrupt: async (reason) => {
        handle.interrupts.push(reason);
        if (mode.exitOnInterrupt) record.exited = true;
        if (mode.settleOnInterrupt !== false) settle({ status: "interrupted", error: `interrupted (${reason})`, output: "", usage: {}, preInference: false });
        return { interrupted: mode.settleOnInterrupt !== false, graceful: false, reason };
      } };
    state.handles.push(handle);
    try { opts.onEvent({ type: "phase", phase: "turn_sent" }); } catch { /* timeline only */ }
    return handle;
  };
  state.next = (mode) => { nextMode = mode || {}; };
  state.restore = () => { adapter.startTurn = realStart; hub.supervisor.get = realGet; hub.supervisor.stop = realStop; };
  return state;
}

/** A fake OS probe: which PIDs are alive, their start times; kill() only records the call and marks the PID gone (never a real kill). */
function fakeProbe({ alive = [], starts = {} } = {}) {
  const live = new Set(alive);
  const probe = { kind: "fake", kills: [], startQueries: [], live,
    alive: (pid) => live.has(pid),
    startTime: async (pid) => { probe.startQueries.push(pid); await sleep(5); return starts[pid] ?? null; },
    kill: async (pid) => { probe.kills.push(pid); live.delete(pid); return { ok: true, error: null }; } };
  return probe;
}

async function runHub() {
  const t = await makeTestHub();
  await enableLive(t.hub, { provider: "codex", access: "read-only", attempts: 5 });
  t.owner = await enrolOwner(t);
  t.fake = fakeProvider(t);
  return t;
}
function conversation(t, title = "Rezervare") {
  const project = t.hub.projects.hub();
  const c = t.hub.bus.transaction(() => t.hub.conversations.create({ projectId: project.id, title }, "user"));
  t.hub.bus.transaction(() => t.hub.conversations.addMessage({ conversationId: c.id, role: "user", content: "Rezumă README-ul." }, "user"));
  return c;
}
async function startRun(t, mode = {}) {
  const conv = conversation(t);
  t.fake.next(mode);
  const { run } = await t.hub.runs.start({ conversationId: conv.id, provider: "codex", access: "read-only" });
  return { run, conv, handle: t.fake.handles.at(-1) };
}
let seeded = 0;
/** A run row as a crash or another boot left it (seeded directly: the environment route is never exercised for real here). */
function seedRun(hub, { status = "interrupted", pid = null, pidStartedAt = null, environment = "windows", evidence = {}, provider = "codex" } = {}) {
  const id = `run_lrseed_${Date.now().toString(36)}_${++seeded}`;
  const now = new Date().toISOString();
  hub.db.prepare(`INSERT INTO agent_runs (id, provider, status, pid, pid_started_at, started_at, created_at, environment, evidence_json, finished_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, provider, status, pid, pidStartedAt, now, now, environment, JSON.stringify(evidence), ["running", "starting", "waiting_approval"].includes(status) ? null : now);
  return id;
}
/** A run lease (holder `codex:<run>`), optionally retained (directly: no follow-up is scheduled) and with a given expiry. */
function seedLease(hub, runId, { status = "retained", resource = `workspace:lr-${runId}`, expiresAt = null, holder = `codex:${runId}` } = {}) {
  const lease = hub.bus.transaction(() => hub.leases.acquire({ resource, holder, runId, ttlSeconds: 600 }));
  if (status === "retained") hub.db.prepare("UPDATE leases SET status = 'retained', release_reason = 'test' WHERE id = ?").run(lease.id);
  if (expiresAt) hub.db.prepare("UPDATE leases SET expires_at = ? WHERE id = ?").run(expiresAt, lease.id);
  return lease.id;
}
/** A second owner session (same authenticator): two cockpit tabs. */
function secondSession(t) {
  const { origin, auth } = t.owner;
  const a = t.hub.trust.beginAuthentication({ origin });
  const opened = t.hub.trust.finishAuthentication({ origin, challengeId: a.challengeId, credential: auth.get({ challenge: a.publicKey.challenge }) });
  const reauth = () => {
    const c = t.hub.trust.beginAuthentication({ origin, purpose: "reauth" });
    t.hub.trust.finishAuthentication({ origin, challengeId: c.challengeId, credential: auth.get({ challenge: c.publicKey.challenge }), currentToken: opened.token });
    return t.hub.trust.resolveSession(opened.token, { origin });
  };
  return { session: t.hub.trust.resolveSession(opened.token, { origin }), reauth };
}
/** The owner's fresh verification on a restarted Hub (same database, same authenticator, same session). */
function reauthOn(hub, owner) {
  const c = hub.trust.beginAuthentication({ origin: owner.origin, purpose: "reauth" });
  hub.trust.finishAuthentication({ origin: owner.origin, challengeId: c.challengeId, credential: owner.auth.get({ challenge: c.publicKey.challenge }), currentToken: owner.token });
  return hub.trust.resolveSession(owner.token, { origin: owner.origin });
}
/** Holds the pre-run backup of the next start until released: the start waits in admission. */
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
const removeDir = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* left in .ifrim/tmp */ } };

// ------------------------------------------------------------------------------------------------------------------------------ LR-01
test("LR-01 Stop during admission: the start never reaches its provider, its lease is released at once — nothing retained, nothing left to reconcile; the card has no lease step", async () => {
  const t = await runHub();
  try {
    const conv = conversation(t);
    const hold = holdBackup(t);
    const started = t.hub.runs.start({ conversationId: conv.id, provider: "codex", access: "read-only" }).then((r) => ({ r }), (error) => ({ error }));
    await waitFor(() => hold.reached());
    assert.equal(count(t.hub, "SELECT COUNT(*) AS n FROM leases WHERE status = 'active'"), 1, "the admission holds the workspace");
    const stop = await ownerStop(t);
    assert.equal(stop.admissionsStopped, 1);
    hold.release();
    const out = await started;
    hold.restore();
    assert.equal(out.error?.category, "gate");
    assert.equal(out.error.details.stopAll, true);
    assert.equal(t.fake.starts, 0, "the provider was never started");
    assert.equal(count(t.hub, "SELECT COUNT(*) AS n FROM leases WHERE status IN ('active','retained')"), 0, "no lease leaks");
    assert.equal(events(t.hub, "lease.retained").length, 0, "nothing retained");
    assert.deepEqual(t.hub.leaseReconciler.sweep({ reason: "test" }), { reason: "test", checked: 0, released: [], remaining: [] });
    const c = await card(t);
    assert.deepEqual([c.eligible, c.code, c.leases], [true, "ELIGIBLE", undefined]);
    assert.equal((await rearm(t, c)).reopened, true);
    assert.equal(t.fake.starts, 0, "the rearm restarted nothing");
    assert.equal(events(t.hub, "lease.reconciled").length, 0);
  } finally { t.fake.restore(); await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ LR-02
test("LR-02 Stop during a worker turn whose process exits a bit later: the lease is retained, the card lists the orphan as an included step; the follow-up reconciles it by itself (no kill); the gate reopens from a new card; nothing relaunched", async () => {
  const t = await runHub();
  try {
    const { run, handle, conv } = await startRun(t);
    const lease = leaseOfRun(t.hub, run.id);
    await ownerStop(t);
    await waitFor(() => (t.hub.runs.getRun(run.id).status === "interrupted" ? true : null));
    assert.equal(leaseRow(t.hub, lease.id).status, "retained", "the process did not confirm its exit");
    const retained = events(t.hub, "lease.retained").find((e) => e.leaseId === lease.id);
    assert.equal(retained.processKey, handle.key, "the reconciler is told which supervised process to watch");
    // Right away: the card stays rearmable — the orphaned Hub process is a step INCLUDED in the same decision.
    const c1 = await card(t);
    assert.deepEqual([c1.eligible, c1.code], [true, "ELIGIBLE"]);
    assert.equal(c1.leases.steps.length, 1);
    const step = c1.leases.steps[0];
    assert.deepEqual([step.leaseId, step.runId, step.verdict, step.tie, step.ack], [lease.id, run.id, "process_alive", "supervisor", false]);
    assert.match(step.text, /^Opresc procesul rămas al execuției „Codex · .+” \(PID .+, pornit de Hub\) și eliberez spațiul de lucru\.$/);
    assert.equal(c1.leases.ackRequired, false);
    for (const text of [c1.headline, ...c1.lines, step.text]) assert.doesNotMatch(text, ADMIN_POINTERS);
    // The process exits a bit later: the bounded follow-up (FOLLOW_UP_MS[0]) releases the lease without anyone asking — and kills nothing.
    setTimeout(() => { handle.record.exited = true; }, 300);
    await waitFor(() => (leaseRow(t.hub, lease.id).status === "released" ? true : null), FOLLOW_UP_MS[0] + 4000, 50);
    const rec = events(t.hub, "lease.reconciled").filter((e) => e.leaseId === lease.id);
    assert.equal(rec.length, 1);
    assert.deepEqual([rec[0].verdict, rec[0].from, rec[0].runId, rec[0].evidence.process.state, rec[0].evidence.process.why], ["released", "retained", run.id, "gone", "supervisor_exited"]);
    assert.deepEqual(t.fake.stops, [], "the reconciler never stops a process by itself");
    // The card on screen no longer matches (its lease list changed): refused; a new card has no lease step and reopens the gate.
    await assert.rejects(rearm(t, c1), (e) => codeOf(e) === "CARD_CHANGED");
    assert.equal(gate(t.hub).status, "suspended");
    const c2 = await card(t);
    assert.equal(c2.leases, undefined);
    assert.equal((await rearm(t, c2)).reopened, true);
    assert.equal(t.fake.starts, 1, "no relaunch");
    assert.equal(count(t.hub, "SELECT COUNT(*) AS n FROM agent_runs WHERE conversation_id = ?", conv.id), 1);
    assert.equal(t.hub.runs.getRun(run.id).status, "interrupted", "the run is never marked completed");
  } finally { t.fake.restore(); await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ LR-03
test("LR-03 the worker already finished but its answer was lost (process gone, run still running at Stop): the bounded follow-up ends it as interrupted, releases the lease, refunds nothing and retries nothing; the late answer changes nothing", async () => {
  const t = await runHub();
  try {
    const { run, handle, conv } = await startRun(t, { settleOnInterrupt: false });
    const lease = leaseOfRun(t.hub, run.id);
    handle.record.exited = true; // the provider process is already gone; its final answer never reached the Hub
    await ownerStop(t);
    assert.deepEqual(handle.interrupts, ["stop-all"]);
    assert.equal(t.hub.runs.activeRuns().length, 1, "no answer yet: the run still counts as stopping");
    assert.equal((await card(t)).code, "RUNS_ACTIVE");
    await waitFor(() => (t.hub.runs.getRun(run.id).status === "interrupted" ? true : null), 8000, 50);
    const r = t.hub.runs.getRun(run.id);
    assert.match(r.errorMessage, /răspunsul lui final nu a mai sosit/);
    assert.equal(r.preInference, false, "an uncertain outcome");
    assert.equal(leaseRow(t.hub, lease.id).status, "released", "the process is provably gone: released at once");
    assert.equal(events(t.hub, "lease.retained").length, 0);
    assert.equal(t.hub.runs.activeRuns().length, 0);
    assert.equal(count(t.hub, "SELECT COUNT(*) AS n FROM events WHERE type = 'grant.refunded' AND scope_id = ?", r.grantId), 0, "no attempt given back");
    // The lost answer arriving late: the run stays interrupted (finalize runs once).
    handle.settle({ status: "completed", output: "răspuns târziu", usage: {} });
    await sleep(100);
    assert.equal(t.hub.runs.getRun(run.id).status, "interrupted");
    const c = await card(t);
    assert.deepEqual([c.eligible, c.code, c.leases], [true, "ELIGIBLE", undefined]);
    assert.equal((await rearm(t, c)).reopened, true);
    assert.equal(t.fake.starts, 1, "never retried");
    assert.equal(count(t.hub, "SELECT COUNT(*) AS n FROM agent_runs WHERE conversation_id = ?", conv.id), 1);
  } finally { t.fake.restore(); await t.cleanup(); }
});

test("LR-03b the lost-turn follow-up never ends a run whose process still runs: it stays active (its own turn settles it), and a Stop All's late approval request is declined without a card", async () => {
  const t = await runHub();
  try {
    const { run, handle } = await startRun(t, { settleOnInterrupt: false });
    await ownerStop(t);
    // Past the first follow-up: the process is alive (the record has not exited), so the run is left to its own turn.
    await sleep(3600);
    assert.equal(t.hub.runs.getRun(run.id).status, "running");
    assert.equal(t.hub.runs.activeRuns().length, 1);
    // A provider callback after the Stop: declined at once — no approval card, the run never shows waiting_approval.
    const answer = await Promise.race([handle.opts.requestApproval({ kind: "command", command: "git status", cwd: t.hub.projects.hub().path, reason: "după stop" }), sleep(2000).then(() => "still waiting")]);
    assert.equal(answer, "decline");
    assert.equal(count(t.hub, "SELECT COUNT(*) AS n FROM approvals WHERE scope_id = ?", run.id), 0);
    assert.equal(t.hub.runs.getRun(run.id).status, "running");
    // Its own turn ends it.
    handle.record.exited = true;
    handle.settle({ status: "interrupted", error: "interrupted (stop-all)", output: "", usage: {} });
    await waitFor(() => (t.hub.runs.getRun(run.id).status === "interrupted" ? true : null));
    assert.equal(leaseOfRun(t.hub, run.id).status, "released");
  } finally { t.fake.restore(); await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ LR-04
test("LR-04 an expired lease (TTL passed while retained or active) is reconciled consistently: released only when its run is finished and its process gone, never resurrected; TTL alone frees nothing; a live run's or another holder's lease is untouched", async () => {
  const t = await makeTestHub();
  try {
    const past = new Date(Date.now() - 3600000).toISOString();
    const spawned = new Date(Date.now() - 600000).toISOString();
    const probe = fakeProbe({ alive: [5151, 5252], starts: { 5151: new Date(Date.parse(spawned) - 500).toISOString() } });
    const restore = t.hub.leaseReconciler.useProbe(probe);
    // Review R1-F2 (2.12.2, deliberate change): "gone" needs this Hub process's own evidence — the provider's supervisor record exited
    // (the same evidence a run's normal end uses). a and b have one; a2 and b2 (the same dead PIDs from another boot) do not.
    const exitedRecords = new Map();
    const realGet = t.hub.supervisor.get;
    t.hub.supervisor.get = (key) => exitedRecords.get(key) || realGet.call(t.hub.supervisor, key);
    const aRun = seedRun(t.hub, { status: "interrupted", pid: 4141 });
    const bRun = seedRun(t.hub, { status: "failed", pid: 4242 });
    for (const [id, pid] of [[aRun, 4141], [bRun, 4242]]) exitedRecords.set(`run-${id}`, { key: `run-${id}`, pid, exited: true });
    const a = seedLease(t.hub, aRun, { status: "retained", expiresAt: past }); // gone
    const b = seedLease(t.hub, bRun, { status: "active", expiresAt: past }); // leaked active, gone
    const cRun = seedRun(t.hub, { status: "interrupted", pid: 5151, pidStartedAt: spawned });
    const c = seedLease(t.hub, cRun, { status: "retained", expiresAt: past }); // its process still runs
    const d = seedLease(t.hub, seedRun(t.hub, { status: "running", pid: 4343 }), { status: "active", expiresAt: past }); // a live run
    const e = seedLease(t.hub, seedRun(t.hub, { status: "failed", pid: 4444 }), { status: "active" }); // not expired
    const f = seedLease(t.hub, seedRun(t.hub, { status: "failed", pid: 4545 }), { status: "active", expiresAt: past, holder: "factory-runner:m1" }); // another holder
    const a2 = seedLease(t.hub, seedRun(t.hub, { status: "interrupted", pid: 4646 }), { status: "retained", expiresAt: past }); // dead PID, another boot
    const b2 = seedLease(t.hub, seedRun(t.hub, { status: "failed", pid: 4747 }), { status: "active", expiresAt: past }); // the same, leaked active
    await t.hub.leaseReconciler.tick(); // one sweep + the start-time check of 5151
    assert.deepEqual([a, b, c, d, e, f, a2, b2].map((id) => leaseRow(t.hub, id).status), ["released", "released", "retained", "active", "active", "active", "retained", "retained"]);
    const rec = events(t.hub, "lease.reconciled");
    assert.deepEqual(rec.map((r) => [r.leaseId, r.from, r.verdict]).sort(), [[a, "retained", "released"], [b, "active", "released"]].sort());
    assert.equal(t.hub.leaseReconciler.assess(c).verdict, "process_alive", "a passed TTL never frees a lease whose process still runs");
    for (const id of [a2, b2]) {
      const v = t.hub.leaseReconciler.assess(id);
      assert.deepEqual([v.verdict, v.treeUnknown, v.tie, v.evidence.process.why, v.evidence.process.tree], ["unknown", true, null, "pid_not_alive", "unknown"], "a dead PID of another boot proves nothing about what it started");
    }
    assert.deepEqual(probe.kills, [], "nothing killed");
    // Never resurrected: a late retain or heartbeat changes nothing, a second sweep releases nothing twice, the workspace is free again.
    assert.equal(t.hub.bus.transaction(() => t.hub.leases.retain(a, "late")), false);
    assert.equal(t.hub.leases.heartbeat(a, 1800), false);
    assert.equal(t.hub.bus.transaction(() => t.hub.leases.reconcile(a, { reason: "late", from: ["retained", "active", "released"] })), false, "a released lease is never released again");
    t.hub.leaseReconciler.sweep({ reason: "again" });
    await t.hub.leaseReconciler.tick();
    assert.equal(leaseRow(t.hub, a).status, "released");
    assert.equal(events(t.hub, "lease.reconciled").length, 2);
    assert.deepEqual(events(t.hub, "lease.retained").map((r) => r.leaseId), [b2], "only the stale active lease whose outcome is unknown became retained (once)");
    const fresh = t.hub.bus.transaction(() => t.hub.leases.acquire({ resource: leaseRow(t.hub, a).resource, holder: "codex:next" }));
    assert.equal(fresh.status, "active");
    t.hub.supervisor.get = realGet;
    restore();
  } finally { await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ LR-05
test("LR-05 two concurrent rearms (two tabs) → exactly one stop of the orphan, one release, one reopening; the other is refused REARM_BUSY; two terminations, two start checks or two sweeps of one lease never act twice", async () => {
  const t = await runHub();
  try {
    const { run, handle } = await startRun(t);
    const lease = leaseOfRun(t.hub, run.id);
    await ownerStop(t);
    await waitFor(() => (leaseRow(t.hub, lease.id).status === "retained" ? true : null));
    handle.record.stopDelayMs = 200; // the tree-kill takes a moment
    const second = secondSession(t);
    const c1 = await card(t);
    const c2 = await card(t, second.session);
    assert.equal(c1.leases.steps[0].verdict, "process_alive");
    assert.equal(c2.leases.steps[0].verdict, "process_alive");
    const results = await Promise.allSettled([rearm(t, c1, {}, t.owner.reauth()), rearm(t, c2, {}, second.reauth())]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const refused = results.filter((r) => r.status === "rejected");
    assert.equal(ok.length, 1, JSON.stringify(results.map((r) => r.reason?.message || r.value?.summary)));
    assert.equal(ok[0].value.reopened, true);
    assert.match(ok[0].value.summary, /^Am oprit procesul rămas și am eliberat spațiul de lucru rezervat\. Am redeschis poarta/);
    assert.equal(codeOf(refused[0].reason), "REARM_BUSY");
    assert.deepEqual(t.fake.stops, [handle.key], "one stop of the orphaned process");
    assert.equal(events(t.hub, "lease.reconciled").filter((e) => e.leaseId === lease.id).length, 1);
    assert.equal(count(t.hub, "SELECT COUNT(*) AS n FROM events WHERE type = 'gate.rearmed'"), 1);
    assert.deepEqual(events(t.hub, "gate.rearmed")[0].leases, [{ leaseId: lease.id, terminated: true, acknowledged: false }]);
    assert.equal(gate(t.hub).status, "open");

    // The reconciler's own guards, below the card: one termination, one start-time query and one release per lease at a time.
    const spawned = new Date(Date.now() - 60000).toISOString();
    const probe = fakeProbe({ alive: [6161, 6262], starts: { 6161: spawned, 6262: spawned } });
    const restore = t.hub.leaseReconciler.useProbe(probe);
    const x = seedLease(t.hub, seedRun(t.hub, { status: "orphaned", pid: 6161, pidStartedAt: spawned }));
    await t.hub.leaseReconciler.verify(x);
    const [k1, k2] = await Promise.all([t.hub.leaseReconciler.terminateOrphan(x, { ownerSession: t.owner.session }), t.hub.leaseReconciler.terminateOrphan(x, { ownerSession: t.owner.session })]);
    assert.deepEqual(probe.kills, [6161], "never a double kill");
    assert.deepEqual([k1.released, k2.released, k1.terminated], [true, true, true]);
    assert.equal(events(t.hub, "lease.reconciled").filter((e) => e.leaseId === x).length, 1);
    const y = seedLease(t.hub, seedRun(t.hub, { status: "orphaned", pid: 6262, pidStartedAt: spawned }));
    const before = probe.startQueries.length;
    await Promise.all([t.hub.leaseReconciler.verify(y), t.hub.leaseReconciler.verify(y)]);
    assert.equal(probe.startQueries.length - before, 1, "one start-time query at a time");
    // Two sweeps of a provably free lease (R1-F2: a confirmed reap; a dead Windows PID of another boot is no longer "free") release it once.
    const z = seedLease(t.hub, seedRun(t.hub, { status: "interrupted", environment: "wsl-runner", evidence: { environment: { reap: { ok: true, remaining: 0 } } } }), { resource: "workspace:lr05-z" });
    t.hub.leaseReconciler.sweep({ reason: "a" });
    t.hub.leaseReconciler.sweep({ reason: "b" });
    assert.equal(events(t.hub, "lease.reconciled").filter((e) => e.leaseId === z).length, 1, "two sweeps, one release");
    assert.equal(leaseRow(t.hub, y).status, "retained", "y's process still runs");
    restore();
  } finally { t.fake.restore(); await t.cleanup(); }
});

for (const stopResult of [{ stopped: false, method: "handle", taskkill: { ok: false } }, { stopped: true, method: "handle", taskkill: { ok: false } }])
test(`review B lease: stop outcome ${stopResult.stopped} with root-only fallback cannot release workspace`, async () => {
  const t = await runHub();
  try {
    const { run, handle } = await startRun(t);
    const lease = leaseOfRun(t.hub, run.id);
    await ownerStop(t);
    await waitFor(() => leaseRow(t.hub, lease.id).status === "retained");
    handle.record.stopResult = stopResult;
    handle.record.stoppable = false;
    const c = await card(t);
    await assert.rejects(rearm(t, c), (e) => e.details?.code === "CARD_CHANGED" && /arborelui de procese/.test(e.message));
    await assert.rejects(t.hub.leaseReconciler.terminateOrphan(lease.id, { ownerSession: t.owner.session }),
      (e) => e.details?.code === "LEASE_STATE_CHANGED" && e.details.stopResult === stopResult);
    assert.equal(leaseRow(t.hub, lease.id).status, "retained");
    assert.equal(events(t.hub, "lease.reconciled").some((e) => e.leaseId === lease.id), false);
  } finally { t.fake.restore(); await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ LR-06
test("LR-06 reconnects after Stop resume nothing and re-acquire nothing: late provider callbacks (approval request, session, turn, delta, the answer) and the page's re-reads (eligibility, card, blockers, reconciler passes)", async () => {
  const t = await runHub();
  try {
    const { run, handle, conv } = await startRun(t, { exitOnInterrupt: true });
    const lease = leaseOfRun(t.hub, run.id);
    await ownerStop(t);
    await waitFor(() => (t.hub.runs.getRun(run.id).status === "interrupted" ? true : null));
    assert.equal(leaseRow(t.hub, lease.id).status, "released", "the process confirmed its exit at the stop");
    const acquired = events(t.hub, "lease.acquired").length;
    const message = t.hub.db.prepare("SELECT status, content FROM messages WHERE id = ?").get(t.hub.runs.getRun(run.id).outputMessageId);
    // The provider "reconnects" after the stop.
    const answer = await Promise.race([handle.opts.requestApproval({ kind: "fileChange", changes: [{ path: "README.md" }], reason: "reconectare" }), sleep(2000).then(() => "still waiting")]);
    assert.equal(answer, "decline");
    for (const ev of [{ type: "session", nativeSessionId: "thr_tarziu", model: "gpt-fake-sol" }, { type: "turn", turnId: "turn_tarziu" }, { type: "delta", text: "text târziu" }, { type: "phase", phase: "first_output" }]) handle.opts.onEvent(ev);
    handle.settle({ status: "completed", output: "răspuns târziu", usage: {} });
    await sleep(100);
    // The page reconnects (SSE / reload): it reads everything again, several times.
    for (let i = 0; i < 3; i++) {
      t.hub.gateRearm.eligibility();
      await card(t);
      t.hub.cockpit.whyBlocked({});
      t.hub.leaseReconciler.sweep({ reason: "reconnect" });
      await t.hub.leaseReconciler.tick();
    }
    assert.equal(gate(t.hub).status, "suspended", "nothing reopened");
    assert.equal(t.hub.runs.getRun(run.id).status, "interrupted", "the run was not brought back");
    assert.equal(count(t.hub, "SELECT COUNT(*) AS n FROM approvals WHERE scope_id = ?", run.id), 0, "no approval card after the stop");
    assert.equal(t.hub.runs.activeRuns().length, 0);
    assert.equal(t.fake.starts, 1, "nothing restarted");
    assert.equal(events(t.hub, "lease.acquired").length, acquired, "no lease re-acquired");
    assert.equal(count(t.hub, "SELECT COUNT(*) AS n FROM leases WHERE status IN ('active','retained')"), 0);
    assert.equal(count(t.hub, "SELECT COUNT(*) AS n FROM agent_runs WHERE conversation_id = ?", conv.id), 1);
    assert.equal(count(t.hub, "SELECT COUNT(*) AS n FROM events WHERE type = 'gate.rearmed'"), 0);
    const after = t.hub.db.prepare("SELECT status, content FROM messages WHERE id = ?").get(t.hub.runs.getRun(run.id).outputMessageId);
    assert.deepEqual(after, message, "the finalized answer is not rewritten by a late delta or answer");
  } finally { t.fake.restore(); await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ LR-07
// Review R1-F2 (deliberate change): a dead provider PID after a restart no longer releases the lease at boot — the commands the provider
// started may have outlived it (no tree-kill ran); every lease the restart left is an "unknown" step of the card, released with the ack.
test("LR-07 Hub restart after Stop with a dead PID: the boot pass keeps every lease retained (a dead provider PID proves nothing about what it started), the run stays interrupted_unknown, nothing is relaunched; the card lists them as unknown steps and rearms with the acknowledgement", async () => {
  const t = await runHub();
  let hub2 = null;
  try {
    const { run } = await startRun(t, { settleOnInterrupt: false });
    const lease = leaseOfRun(t.hub, run.id);
    await ownerStop(t);
    // The crash: the process is gone, the run row still says running, the lease is active (no finalize happened).
    t.hub.db.prepare("UPDATE agent_runs SET status = 'running', pid = 999999, pid_started_at = ? WHERE id = ?").run(new Date().toISOString(), run.id);
    const envRun = seedRun(t.hub, { status: "running", pid: 999998, environment: "wsl-runner" });
    const envLease = seedLease(t.hub, envRun, { status: "active", resource: "workspace:lr07-env" });
    // And a Windows run whose PID was never recorded: nothing proves its process is gone.
    const noPid = seedRun(t.hub, { status: "running", pid: null });
    const noPidLease = seedLease(t.hub, noPid, { status: "active", resource: "workspace:lr07-nopid" });
    // A lease retained before the restart by a run that had already finished (its process has gone since, under no supervision of hub2).
    const older = seedLease(t.hub, seedRun(t.hub, { status: "interrupted", pid: 999997 }), { status: "retained", resource: "workspace:lr07-older" });
    const turns = t.readLog("codex").filter((e) => e.method === "turn/start").length;
    t.fake.restore();
    await t.hub.close();
    hub2 = createHub(t.config, { homeDir: t.homeDir });
    const report = await hub2.boot();
    assert.deepEqual(report.runs.map((r) => [r.id, r.status]).sort(), [[run.id, "interrupted_unknown"], [envRun, "interrupted_unknown"], [noPid, "interrupted_unknown"]].sort());
    assert.deepEqual(report.leasesReconciled, [], "nothing released at boot");
    assert.deepEqual([...report.leases].sort(), [lease.id, envLease, noPidLease].sort(), "the dead-PID run, the environment run (never reaped) and the run without a PID: retained");
    assert.equal(events(hub2, "lease.reconciled").length, 0);
    assert.equal(hub2.runs.getRun(run.id).status, "interrupted_unknown");
    assert.equal(gate(hub2).status, "suspended");
    assert.equal(gate(hub2).suspendedBy.kind, "stop_all");
    await hub2.leaseReconciler.tick();
    assert.deepEqual([lease.id, envLease, noPidLease, older].map((id) => leaseRow(hub2, id).status), ["retained", "retained", "retained", "retained"],
      "the tick never releases a dead PID of another boot, an unknown reap or a run without a PID");
    // The card on the restarted Hub (the owner's fresh verification): all four are included steps that need the acknowledgement.
    const c = await card(t, reauthOn(hub2, t.owner), hub2);
    assert.deepEqual([c.eligible, c.leases.total, c.leases.ackRequired, c.leases.terminate], [true, 4, true, 0]);
    assert.deepEqual(c.leases.steps.map((s) => [s.leaseId, s.verdict, s.tie, s.ack]).sort(),
      [[lease.id, "unknown", null, true], [envLease, "unknown", null, true], [noPidLease, "unknown", null, true], [older, "unknown", null, true]].sort());
    assert.match(c.leases.steps.find((s) => s.leaseId === noPidLease).text, /Hub-ul nu are PID-ul procesului acestei execuții/);
    assert.match(c.leases.steps.find((s) => s.leaseId === lease.id).text, /procesul providerului \(PID 999999\) nu mai rulează, dar nu l-a oprit acest Hub \(a repornit în timpul execuției\): comenzile pornite de el \(teste, servere\) pot rula încă\. Cu „Am înțeles, eliberează spațiul de lucru” eliberez spațiul de lucru fără să opresc vreun proces/);
    await assert.rejects(rearm(t, c, {}, reauthOn(hub2, t.owner), hub2), (e) => codeOf(e) === "LEASES_ACK");
    const out = await rearm(t, c, { ackLeases: true }, reauthOn(hub2, t.owner), hub2);
    assert.equal(out.reopened, true);
    const rec = events(hub2, "lease.reconciled").find((e) => e.leaseId === lease.id);
    assert.deepEqual([rec.from, rec.verdict, rec.evidence.ack, rec.evidence.process.why, rec.evidence.process.tree], ["retained", "acknowledged", true, "pid_not_alive", "unknown"]);
    assert.equal(hub2.runs.getRun(run.id).status, "interrupted_unknown", "never marked completed");
    assert.equal(count(hub2, "SELECT COUNT(*) AS n FROM agent_runs WHERE status IN ('starting','running','waiting_approval')"), 0, "nothing relaunched");
    assert.equal(t.readLog("codex").filter((e) => e.method === "turn/start").length, turns, "no turn after the restart");
  } finally {
    if (hub2) await hub2.close().catch(() => {});
    removeDir(t.dataDir);
  }
});

// ------------------------------------------------------------------------------------------------------------------------------ LR-08
test("LR-08 an orphaned process alive after the restart: the card lists the included terminate step; only a fresh verification applies it; it kills ONLY the Hub-tied PID (start evidence), never a reused or unrelated one, then reopens", async () => {
  const t = await runHub();
  let hub2 = null;
  try {
    const { run } = await startRun(t, { settleOnInterrupt: false });
    const leaseA = leaseOfRun(t.hub, run.id);
    await ownerStop(t);
    const spawned = new Date(Date.now() - 60000).toISOString();
    // The crash. Run A's provider outlives the Hub — here its PID is this test process (alive for real; the fake probe never kills it).
    t.hub.db.prepare("UPDATE agent_runs SET status = 'running', pid = ?, pid_started_at = ? WHERE id = ?").run(process.pid, spawned, run.id);
    // Run B's PID now belongs to a process started an hour after B's own (here: the parent test runner): a reused PID.
    const runB = seedRun(t.hub, { status: "running", pid: process.ppid, pidStartedAt: spawned });
    const leaseB = seedLease(t.hub, runB, { status: "active", resource: "workspace:lr08-b" });
    t.fake.restore();
    await t.hub.close();
    hub2 = createHub(t.config, { homeDir: t.homeDir });
    const report = await hub2.boot();
    assert.deepEqual(report.runs.map((r) => r.status), ["orphaned", "orphaned"], "both PIDs answer, so recovery keeps both leases");
    assert.deepEqual([...report.leases].sort(), [leaseA.id, leaseB].sort());
    assert.deepEqual(report.leasesReconciled, []);
    const probe = fakeProbe({ alive: [process.pid, process.ppid, 4242],
      starts: { [process.pid]: new Date(Date.parse(spawned) - 400).toISOString(), [process.ppid]: new Date(Date.parse(spawned) + 3600000).toISOString(), 4242: spawned } });
    const restore = hub2.leaseReconciler.useProbe(probe);
    await hub2.leaseReconciler.tick(); // the background start-time checks
    // Review R1-F2 (deliberate change): B's PID was reused — its provider is gone, but what it started is unknown: never released by
    // itself, an "unknown" step of the card (no PID to stop: the live one is not B's).
    assert.equal(leaseRow(hub2, leaseB).status, "retained", "B's PID was reused: its provider is gone, what it started is unknown");
    assert.deepEqual([hub2.leaseReconciler.assess(leaseB).verdict, hub2.leaseReconciler.assess(leaseB).evidence.process.why], ["unknown", "pid_reused"]);
    assert.equal(leaseRow(hub2, leaseA.id).status, "retained");
    const c = await card(t, reauthOn(hub2, t.owner), hub2);
    assert.deepEqual(c.leases.steps.map((s) => [s.leaseId, s.verdict, s.tie, s.pid, s.ack]).sort(), [[leaseA.id, "process_alive", "pid", process.pid, false], [leaseB, "unknown", null, null, true]].sort());
    const stepA = c.leases.steps.find((s) => s.leaseId === leaseA.id);
    assert.match(stepA.text, new RegExp(`^Opresc procesul rămas al execuției „Codex · .+” \\(PID ${process.pid}, pornit de Hub\\)`));
    assert.match(c.leases.steps.find((s) => s.leaseId === leaseB).text, /aparține acum altui proces\), dar nu l-a oprit acest Hub: comenzile pornite de el \(teste, servere\) pot rula încă\. .*fără să opresc vreun proces/);
    assert.equal(c.leases.ackRequired, true);
    // Without a fresh verification: an authentication error, nothing killed, nothing released.
    const s = hub2.trust.requireSession({ id: t.owner.session.id });
    stale(hub2, s);
    await assert.rejects(asOwner(hub2, s, "gate.rearm", { nonce: c.nonce, hash: c.hash, ackLeases: true }), (e) => e.category === "authentication");
    assert.deepEqual(probe.kills, []);
    assert.equal(leaseRow(hub2, leaseA.id).status, "retained");
    await assert.rejects(rearm(t, c, {}, reauthOn(hub2, t.owner), hub2), (e) => codeOf(e) === "LEASES_ACK", "B needs the acknowledgement");
    // With it: the start evidence is read again, the Hub-tied PID is stopped (tree-kill), its lease released; B released as acknowledged.
    const out = await rearm(t, c, { ackLeases: true }, reauthOn(hub2, t.owner), hub2);
    assert.equal(out.reopened, true);
    assert.deepEqual(probe.kills, [process.pid], "only the PID the Hub's own records tie to the run");
    const rec = events(hub2, "lease.reconciled").find((e) => e.leaseId === leaseA.id);
    assert.deepEqual([rec.verdict, rec.evidence.terminated, rec.evidence.killedPid, rec.evidence.by, rec.evidence.tree], ["released", true, process.pid, `owner:${t.owner.session.id}`, "tree-kill"]);
    assert.equal(events(hub2, "lease.reconciled").find((e) => e.leaseId === leaseB).verdict, "acknowledged");
    assert.equal(hub2.runs.getRun(run.id).status, "orphaned", "the run's status is never rewritten");
    assert.equal(count(hub2, "SELECT COUNT(*) AS n FROM agent_runs WHERE status IN ('starting','running','waiting_approval')"), 0);
    restore();
  } finally {
    if (hub2) await hub2.close().catch(() => {});
    removeDir(t.dataDir);
  }
});

// ------------------------------------------------------------------------------------------------------------------------------ LR-09
test("LR-09 an unknown WSL reap: never released by the reconciler (no wsl.exe); the card says what is unknown and requires ackLeases bound to its hash — refused without it, CARD_CHANGED for a lease it never showed; released as acknowledged with it", async () => {
  const t = await runHub();
  try {
    await ownerStop(t);
    const probe = fakeProbe();
    const restore = t.hub.leaseReconciler.useProbe(probe);
    const failedReap = seedRun(t.hub, { status: "interrupted", environment: "wsl-runner", evidence: { environment: { reap: { ok: false, remaining: 1 } } } });
    const l1 = seedLease(t.hub, failedReap, { resource: "workspace:lr09-a" });
    // The positive case: a reap that confirmed (and no Windows-side process) is released by the sweep.
    const reaped = seedLease(t.hub, seedRun(t.hub, { status: "interrupted", environment: "wsl-runner", evidence: { environment: { reap: { ok: true, remaining: 0 } } } }), { resource: "workspace:lr09-ok" });
    t.hub.leaseReconciler.sweep({ reason: "test" });
    await t.hub.leaseReconciler.tick();
    assert.equal(leaseRow(t.hub, reaped).status, "released");
    assert.equal(leaseRow(t.hub, l1).status, "retained", "an unknown reap is never released by the reconciler");
    const c = await card(t);
    assert.deepEqual([c.eligible, c.code, c.leases.ackRequired, c.leases.ackLabel], [true, "ELIGIBLE", true, LEASES_ACK_LABEL]);
    const step = c.leases.steps[0];
    assert.deepEqual([step.leaseId, step.verdict, step.ack], [l1, "unknown", true]);
    assert.match(step.text, /procesele din mediul wsl-runner nu au fost confirmate ca oprite \(curățarea lor a eșuat\)/);
    assert.match(step.text, /fără să opresc vreun proces/);
    for (const text of [c.headline, ...c.lines, step.text]) assert.doesNotMatch(text, ADMIN_POINTERS);
    // Without the acknowledgement: refused, nothing changes, the same card stays usable.
    await assert.rejects(rearm(t, c), (e) => e.category === "validation" && codeOf(e) === "LEASES_ACK" && e.details.leasesAckRequired === true);
    await assert.rejects(rearm(t, c, { ackLeases: false }), (e) => codeOf(e) === "LEASES_ACK");
    assert.deepEqual([gate(t.hub).status, leaseRow(t.hub, l1).status], ["suspended", "retained"]);
    // A lease the card never showed (a second unknown reap): the hash binds the list — CARD_CHANGED, the new lease is not released.
    const l2 = seedLease(t.hub, seedRun(t.hub, { status: "interrupted", environment: "wsl-runner" }), { resource: "workspace:lr09-b" });
    await assert.rejects(rearm(t, c, { ackLeases: true }), (e) => codeOf(e) === "CARD_CHANGED");
    assert.deepEqual([leaseRow(t.hub, l1).status, leaseRow(t.hub, l2).status, gate(t.hub).status], ["retained", "retained", "suspended"]);
    const c2 = await card(t);
    assert.deepEqual(c2.leases.steps.map((s) => s.leaseId).sort(), [l1, l2].sort());
    assert.match(c2.leases.steps.find((s) => s.leaseId === l2).text, /curățarea lor nu a rulat/);
    // The page side: the body carries ackLeases only for such a card, true only when ticked; not ready until ticked.
    assert.deepEqual(rearmLeaseSteps(c2).map((s) => s.leaseId), c2.leases.steps.map((s) => s.leaseId));
    assert.equal(rearmLeasesAckRequired(c2), true);
    assert.equal(UI_LEASES_ACK_LABEL, LEASES_ACK_LABEL, "the page and the Hub use the same words");
    assert.equal(rearmReady(c2, { now: Date.now() }).why, "ack_leases");
    assert.equal(rearmRequestBody(c2).ackLeases, false);
    assert.equal(rearmRequestBody(c2, { ackLeases: "true" }).ackLeases, false, "only the boolean true");
    const out = await asOwner(t.hub, t.owner.reauth(), "gate.rearm", rearmRequestBody(c2, { ackLeases: true, modality: "keyboard" }));
    assert.equal(out.reopened, true);
    const rec = events(t.hub, "lease.reconciled").filter((e) => [l1, l2].includes(e.leaseId));
    assert.deepEqual(rec.map((r) => [r.verdict, r.evidence.ack]), [["acknowledged", true], ["acknowledged", true]]);
    assert.deepEqual([probe.kills, probe.startQueries], [[], []], "no process to stop, nothing asked of the OS");
    restore();
  } finally { t.fake.restore(); await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ LR-10
test("LR-10 Stop All timing is unaffected: it returns with the gate suspended and the grants revoked before any reconciliation work (the follow-up is only scheduled); its body awaits nothing of the reconciler", async () => {
  const t = await runHub();
  try {
    const { run, handle } = await startRun(t);
    const lease = leaseOfRun(t.hub, run.id);
    const before = t.hub.leaseReconciler.stats();
    const started = performance.now();
    const stop = await ownerStop(t);
    const elapsed = performance.now() - started;
    const after = t.hub.leaseReconciler.stats();
    assert.equal(stop.gate, "suspended");
    assert.equal(gate(t.hub).status, "suspended");
    assert.equal(count(t.hub, "SELECT COUNT(*) AS n FROM live_grants WHERE status = 'active'"), 0);
    assert.equal(leaseRow(t.hub, lease.id).status, "retained", "the interrupted turn retained its lease inside the stop");
    assert.deepEqual([after.checks, after.sweeps, after.verifies, after.kills, after.released], [before.checks, before.sweeps, before.verifies, before.kills, before.released],
      "no reconciliation work ran inside Stop All");
    assert.ok(after.followed >= 1, "the follow-up is only scheduled");
    assert.ok(elapsed < 2500, `Stop All took ${Math.round(elapsed)} ms`);
    // The work happens after Stop All returned.
    handle.record.exited = true;
    await waitFor(() => (leaseRow(t.hub, lease.id).status === "released" ? true : null), FOLLOW_UP_MS[0] + 4000, 50);
    assert.ok(t.hub.leaseReconciler.stats().checks > before.checks);
    // Source: Stop All's body never awaits the reconciler or the lost-turn follow-up; it schedules it after the suspension.
    const src = fs.readFileSync(path.join(V2, "server", "runtime", "runs.mjs"), "utf8");
    const body = src.slice(src.indexOf("async function stopAll("), src.indexOf("const activeRuns ="));
    assert.doesNotMatch(body, /await[^\n;]*(reconcil|leaseReconciler|LostTurn|followUp|sweep)/i);
    assert.match(body, /\n\s+scheduleLostTurnChecks\(stopping\);/);
    assert.ok(body.indexOf("scheduleLostTurnChecks(stopping)") > body.indexOf("grants.revokeAll("), "after the suspension and the revocation");
  } finally { t.fake.restore(); await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ LR-11
test("LR-11 the owner's own pause with a reserved workspace: „Continuă” refuses with a pointer to the cockpit card (rearm), the card only releases the reservation (the pause stays), then „Continuă” reopens; the typed OPEN GATE points to the card too", async () => {
  const t = await runHub();
  try {
    await asOwner(t.hub, t.owner.session, "owner.interrupt", { kind: "pause", reason: "Pauză" });
    const paused = gate(t.hub).suspendedBy;
    assert.equal(paused.kind, "pause");
    const spawned = new Date(Date.now() - 60000).toISOString();
    const probe = fakeProbe({ alive: [7171], starts: { 7171: spawned } });
    const restore = t.hub.leaseReconciler.useProbe(probe);
    const lease = seedLease(t.hub, seedRun(t.hub, { status: "interrupted", pid: 7171, pidStartedAt: spawned }), { resource: "workspace:lr11" });
    await t.hub.leaseReconciler.verify(lease);
    const refused = await t.hub.interrupts.resumeOwnPause({ session: t.owner.session, actor: `owner:${t.owner.session.id}` });
    assert.deepEqual([refused.reopened, refused.code, refused.rearm], [false, "LEASES", true]);
    assert.match(refused.reason, /Îl eliberezi aici, în cockpit, pe cardul de redeschidere, cu Windows Hello/);
    assert.doesNotMatch(refused.reason, ADMIN_POINTERS);
    assert.equal(t.hub.gateRearm.eligibility().code, "OWNER_PAUSE", "the session-less view still says „Continuă”");
    // A security event near the pause: the reservation card reopens nothing, so it neither lists nor asks to acknowledge the events.
    t.hub.bus.emit({ type: "lega.session.violation", scopeType: "system", scopeId: "lr11", source: "test", payload: { test: true } });
    const c = await card(t);
    assert.deepEqual([c.eligible, c.code, c.scope, c.leases.steps[0].verdict, c.security], [true, "OWNER_PAUSE", "leases", "process_alive", null]);
    assert.match(c.headline, /^Hub-ul e pe pauza ta, dar un spațiu de lucru a rămas rezervat/);
    assert.equal(rearmLeasesOnly(c), true);
    const out = await rearm(t, c);
    assert.deepEqual([out.reopened, out.scope], [false, "leases"]);
    assert.match(out.summary, /^Am oprit procesul rămas și eliberat spațiul de lucru rezervat\. Poarta rămâne pe pauza ta/);
    assert.match(rearmOutcome(out).toast, /rămâne pe pauza ta/);
    assert.deepEqual(probe.kills, [7171]);
    assert.equal(gate(t.hub).status, "suspended");
    assert.equal(gate(t.hub).suspendedBy.id, paused.id, "the owner's pause is untouched");
    assert.equal(count(t.hub, "SELECT COUNT(*) AS n FROM events WHERE type = 'gate.rearmed'"), 0);
    assert.equal((await t.hub.interrupts.resumeOwnPause({ session: t.owner.session, actor: `owner:${t.owner.session.id}` })).reopened, true);
    // The typed diagnostic OPEN GATE with a reserved workspace: refused, pointing to the cockpit card (never a developer action).
    await ownerStop(t);
    seedLease(t.hub, seedRun(t.hub, { status: "interrupted", environment: "wsl-runner" }), { resource: "workspace:lr11-b" });
    await assert.rejects(t.hub.commands.dispatch({ type: "gate.set", channel: "ui", actor: "user", payload: { action: "open", confirm: "OPEN GATE" } }),
      (e) => e.category === "gate" && /din cockpit, pe cardul „Redeschide poarta”, cu Windows Hello/.test(e.message) && !/Reconcile/.test(e.message));
    restore();
  } finally { t.fake.restore(); await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ LR-12
test("LR-12 the guards below the card: a lease of a run that still looks live is never touched (LEASES, not eligible); terminateOrphan needs the owner session; the test-mode probe never kills by PID; the start evidence window; the page's error handling", async () => {
  const t = await runHub();
  try {
    await ownerStop(t);
    const probe = fakeProbe({ alive: [] });
    const restore = t.hub.leaseReconciler.useProbe(probe);
    // A retained lease whose run row still says running (and whose PID is gone): never released, never offered — the card waits.
    const live = seedLease(t.hub, seedRun(t.hub, { status: "running", pid: 8181 }), { resource: "workspace:lr12-live" });
    t.hub.leaseReconciler.sweep({ reason: "test" });
    assert.equal(leaseRow(t.hub, live).status, "retained");
    assert.equal(t.hub.leaseReconciler.assess(live).verdict, "still_held");
    const held = await card(t);
    assert.deepEqual([held.eligible, held.code], [false, "LEASES"]);
    assert.match(held.reason, /figurează încă în lucru/);
    assert.match(held.reason, /o redeschizi tu, aici în cockpit/);
    assert.doesNotMatch(held.reason, ADMIN_POINTERS);
    await assert.rejects(t.hub.leaseReconciler.terminateOrphan(live, { ownerSession: t.owner.session }), (e) => codeOf(e) === "LEASE_HELD");
    t.hub.db.prepare("UPDATE leases SET status = 'released' WHERE id = ?").run(live);
    // terminateOrphan only in the owner session.
    const orphan = seedLease(t.hub, seedRun(t.hub, { status: "orphaned", pid: 8282 }), { resource: "workspace:lr12-o" });
    assert.throws(() => t.hub.leaseReconciler.terminateOrphan(orphan, { ownerSession: null }), (e) => e.category === "authentication");
    assert.throws(() => t.hub.leaseReconciler.terminateOrphan(orphan, {}), (e) => e.category === "authentication");
    assert.deepEqual(probe.kills, []);
    // The start evidence is read again right before a kill: a PID reused since the card was shown is never killed (its own process is gone).
    const spawned = new Date(Date.now() - 60000).toISOString();
    const starts = { 8383: spawned };
    probe.live.add(8383);
    probe.startTime = async (pid) => { probe.startQueries.push(pid); return starts[pid] ?? null; };
    const reused = seedLease(t.hub, seedRun(t.hub, { status: "orphaned", pid: 8383, pidStartedAt: spawned }), { resource: "workspace:lr12-r" });
    await t.hub.leaseReconciler.verify(reused);
    assert.equal(t.hub.leaseReconciler.assess(reused).verdict, "process_alive");
    starts[8383] = new Date(Date.parse(spawned) + 3600000).toISOString();
    // Review R1-F1/F2 (deliberate change): the stop it promised did not happen (the PID is no longer the run's) — never released on
    // that: LEASE_STATE_CHANGED (the rearm shows a new card); the lease is now an "unknown" step, released only with the acknowledgement.
    await assert.rejects(t.hub.leaseReconciler.terminateOrphan(reused, { ownerSession: t.owner.session }), (e) => codeOf(e) === "LEASE_STATE_CHANGED");
    assert.deepEqual(probe.kills, [], "the reused PID is not killed");
    assert.equal(leaseRow(t.hub, reused).status, "retained");
    assert.deepEqual([t.hub.leaseReconciler.assess(reused).verdict, t.hub.leaseReconciler.assess(reused).evidence.process.why], ["unknown", "pid_reused"]);
    const out = await t.hub.leaseReconciler.terminateOrphan(reused, { ownerSession: t.owner.session, ack: true, expected: { verdict: "unknown", tie: null } });
    assert.deepEqual([out.released, out.terminated, out.acknowledged], [true, false, true]);
    assert.deepEqual(probe.kills, [], "still nothing killed");
    const recR = events(t.hub, "lease.reconciled").find((e) => e.leaseId === reused);
    assert.deepEqual([recR.verdict, recR.evidence.process.why], ["acknowledged", "pid_reused"]);
    restore();
    // The test-mode probe (the Hub's default here): signal-0 only, no start time, never a kill by PID — nothing is ever started (the
    // command runner is a spy, so a regression could not reach a real process either).
    const started = [];
    const sys = createProcessProbe({ testMode: true, platform: "win32", run: async (file, args) => { started.push([file, ...args]); return "2026-10-06T00:00:00Z"; } });
    assert.equal(sys.alive(process.pid), true);
    assert.equal(sys.alive(0), false);
    assert.equal(sys.alive(-5), false);
    assert.equal(await sys.startTime(process.pid), null);
    assert.equal((await sys.kill(process.pid)).ok, false);
    assert.deepEqual(started, [], "no PowerShell, no taskkill in test mode");
    // Outside test mode the same probe asks exactly CIM (read-only) and taskkill /T /F for a valid PID only (spied here).
    const real = createProcessProbe({ testMode: false, platform: "win32", run: async (file, args) => { started.push([file, ...args]); return "\r\n2026-10-06T09:59:58.1234567Z\r\n"; } });
    assert.equal(await real.startTime(1234), "2026-10-06T09:59:58.123Z");
    assert.equal((await real.kill(1234)).ok, true);
    assert.equal((await real.kill(-1)).ok, false);
    assert.deepEqual(started.map((c) => c[0]), ["powershell.exe", "taskkill"]);
    assert.match(started[0].at(-1), /^\$p = Get-CimInstance -ClassName Win32_Process -Filter 'ProcessId = 1234'/);
    assert.deepEqual(started[1].slice(1), ["/PID", "1234", "/T", "/F"]);
    // The start evidence window.
    const at = "2026-10-06T10:00:00.000Z";
    const shift = (ms) => new Date(Date.parse(at) + ms).toISOString();
    assert.equal(startEvidenceMatches({ processStartedAt: shift(-1000), pidStartedAt: at }), true);
    assert.equal(startEvidenceMatches({ processStartedAt: shift(-START_TOLERANCE_MS.before), pidStartedAt: at }), true);
    assert.equal(startEvidenceMatches({ processStartedAt: shift(-START_TOLERANCE_MS.before - 1), pidStartedAt: at }), false);
    assert.equal(startEvidenceMatches({ processStartedAt: shift(START_TOLERANCE_MS.after + 1), pidStartedAt: at }), false, "a process started after the run's own: a reused PID");
    assert.equal(startEvidenceMatches({ processStartedAt: null, pidStartedAt: at }), null);
    assert.equal(parseCreationDate("\r\n2026-10-06T09:59:58.1234567Z\r\n"), "2026-10-06T09:59:58.123Z");
    assert.equal(parseCreationDate("Get-CimInstance : error"), null);
    assert.deepEqual(TERMINAL_RUN_STATUSES, ["completed", "failed", "interrupted", "blocked", "interrupted_unknown", "orphaned"]);
    // The page's reading of the new refusals.
    const apiError = (code, extra = {}) => Object.assign(new Error("x"), { details: { code, ...extra } });
    assert.equal(rearmErrorAction(apiError("LEASES_ACK", { leasesAckRequired: true })).action, "ack");
    assert.equal(rearmErrorAction(apiError("REARM_BUSY")).action, "wait");
    assert.equal(rearmErrorAction(apiError("LEASE_TERMINATE_FAILED")).action, "error");
    // A card without leases keeps the exact body and readiness it always had.
    const plain = { kind: "gate_rearm", eligible: true, nonce: "a".repeat(32), hash: "b".repeat(64), expiresAt: new Date(Date.now() + 60000).toISOString() };
    assert.deepEqual(rearmRequestBody(plain), { nonce: plain.nonce, hash: plain.hash, ackSecurity: false, modality: "click" });
    assert.deepEqual(rearmLeaseSteps(plain), []);
    const withLeases = { ...plain, leases: { ackRequired: true, steps: [{ leaseId: "lease_1", verdict: "unknown", ack: true, text: "pas" }] } };
    assert.equal(sameDisplayedCard(plain, withLeases), false);
    assert.equal(continueAfterFetch({ previous: withLeases, next: withLeases, ackLeases: false }), false);
    assert.equal(continueAfterFetch({ previous: withLeases, next: withLeases, ackLeases: true }), true);
  } finally { t.fake.restore(); await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ LR-13
test("LR-13 the system probe outside test mode reads this process's start time from Windows (read-only CIM query) and it matches its own start", { skip: process.platform !== "win32" ? "Windows only" : false, timeout: 60000 }, async () => {
  const sys = createProcessProbe({ testMode: false });
  const started = await sys.startTime(process.pid);
  assert.match(String(started), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  const ownStart = Date.now() - process.uptime() * 1000;
  assert.ok(Math.abs(Date.parse(started) - ownStart) < 60000, `${started} vs ${new Date(ownStart).toISOString()}`);
  assert.equal(await sys.startTime(0), null);
});

test("review B lease: same-boot unverified tree never claims that the Hub rebooted", async () => {
  const t = await runHub();
  try {
    const { run, handle } = await startRun(t);
    const lease = leaseOfRun(t.hub, run.id);
    await ownerStop(t);
    await waitFor(() => leaseRow(t.hub, lease.id).status === "retained");
    handle.record.exited = true;
    handle.record.treeUnverified = true;
    const assessment = t.hub.leaseReconciler.assess(lease.id);
    assert.equal(assessment.treeUnknown, true);
    assert.match(assessment.reason, /oprirea arborelui lui de procese nu a fost confirmată/);
    assert.doesNotMatch(assessment.reason, /a repornit|nu l-a oprit acest Hub/);
  } finally { t.fake.restore(); await t.cleanup(); }
});
