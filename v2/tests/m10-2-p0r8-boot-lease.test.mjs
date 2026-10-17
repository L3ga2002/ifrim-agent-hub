// 2.12.2 — P0-R8 (unit D: the runtime follow-ups of the P0-R1 / R3 / R4 batch).
//  - BL-01 … BL-05 (D1, decision (a), the owner's „Hub restart after Stop” and „leases reach a terminal / reconciled state”): after a crash
//    restart a lease whose run's outcome is unknown stays retained (review R1-F2: a dead PID is no proof). With the gate OPEN nothing
//    showed the owner a way to release it — the rearm card exists only for a suspended gate. The boot now suspends an open gate (kind
//    "shutdown", channel "recovery", labelled „la repornirea Hub-ului”) when a lease is still retained after its boot pass; the owner's
//    contextual card releases it (the "unknown" step with the acknowledgement, or the stop of a live Hub-tied process), Windows Hello, the
//    gate reopens in BUILD_SAFE; nothing is resumed or relaunched. A clean restart never closes the gate; a gate already suspended keeps
//    its own (stronger or owner's) record.
//  - BL-06 (D2, review R4-F8, runtime half): system.stop_all records the stop's own requested kind (stopKind) next to the kind the
//    suspension record kept (precedence) — a shutdown is never an owner's Stop All for the probe or „ieri am spus oprește tot”.
//  - BL-07 (D3, review R3-F5 leftover): the wsl-runner adapters (Codex writer, Claude reviewer) report turn_settled as soon as their
//    provider's turn settles, so the per-turn deadline never cuts the reap / export / apply after it.
// PASS_SIMULATED: seeded run rows (dead PIDs, or this test process's own PID behind a fake OS probe that never kills), the software
// authenticator, the fixture Codex for the shutdown path, fake environment objects and a fake supervisor (never wsl.exe); no model, no
// network, no live Hub.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { makeTestHub, enableLive, enrolOwner, waitFor, tempDir } from "./helpers.mjs";
import { createHub } from "../server/hub.mjs";
import { workspaceResource } from "../server/runtime/runs.mjs";
import { RECOVERY_SUSPENSION, retainedLeasesReason, suspendGateForRetainedLeases } from "../server/runtime/recovery.mjs";
import { classifySuspension, CHANNEL_LABELS, SUSPENSION_LABELS } from "../server/policy/gate-state.mjs";
import { stopForShutdown, closeProposalsFromBeforeStop } from "../server/owner/stop-scope.mjs";
import { createWslCodexAdapter } from "../server/providers/codex-wsl.mjs";
import { createWslClaudeAdapter } from "../server/providers/claude-wsl.mjs";
import { WSL_RUNNER } from "../server/environments/wsl.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ADMIN_POINTERS = /OPEN GATE|Integrări → Avansat|Avansat|din Sistem|#\/system/;
const gate = (hub) => hub.settings.get("executionGate");
const count = (hub, sql, ...args) => hub.db.prepare(sql).get(...args).n;
const events = (hub, type) => hub.db.prepare("SELECT payload_json, source FROM events WHERE type = ? ORDER BY seq").all(type).map((r) => ({ ...JSON.parse(r.payload_json || "{}"), _source: r.source }));
const leaseRow = (hub, id) => hub.db.prepare("SELECT * FROM leases WHERE id = ?").get(id);
const liveRuns = (hub) => count(hub, "SELECT COUNT(*) AS n FROM agent_runs WHERE status IN ('starting','running','waiting_approval')");
const activeGrants = (hub) => count(hub, "SELECT COUNT(*) AS n FROM live_grants WHERE status = 'active'");
const asOwner = (hub, session, type, payload = {}) => hub.commands.dispatch({ type, payload, channel: "owner", actor: `owner:${session.id}`, ownerSession: session }).then((r) => r.result);
const card = (hub, session) => asOwner(hub, session, "gate.rearm.card", {});
const rearm = (hub, session, c, extra = {}) => asOwner(hub, session, "gate.rearm", { nonce: c.nonce, hash: c.hash, ...extra });
const ownerStop = (hub, session) => asOwner(hub, session, "system.stop_all", { reason: "test" });
const codeOf = (e) => e?.details?.code || null;
const removeDir = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* left in .ifrim/tmp */ } };

/** The owner's fresh verification on a restarted Hub (same database, same authenticator, same session). */
function reauthOn(hub, owner) {
  const c = hub.trust.beginAuthentication({ origin: owner.origin, purpose: "reauth" });
  hub.trust.finishAuthentication({ origin: owner.origin, challengeId: c.challengeId, credential: owner.auth.get({ challenge: c.publicKey.challenge }), currentToken: owner.token });
  return hub.trust.resolveSession(owner.token, { origin: owner.origin });
}
function conversation(hub, projectId, title = "Rezervare") {
  return hub.bus.transaction(() => hub.conversations.create({ projectId, title }, "user"));
}
let seeded = 0;
/** A run row as a crash or an earlier boot left it (seeded: no provider process is involved). */
function seedRun(hub, { status = "running", pid = null, pidStartedAt = null, environment = "windows", evidence = {}, conversationId = null } = {}) {
  const id = `run_p0r8_${Date.now().toString(36)}_${++seeded}`;
  const now = new Date().toISOString();
  hub.db.prepare(`INSERT INTO agent_runs (id, conversation_id, provider, status, pid, pid_started_at, started_at, created_at, environment, evidence_json, finished_at)
    VALUES (?, ?, 'codex', ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, conversationId, status, pid, pidStartedAt, now, now, environment, JSON.stringify(evidence),
    ["running", "starting", "waiting_approval"].includes(status) ? null : now);
  return id;
}
/** The run's workspace lease (holder `codex:<run>`): ACTIVE as a crash leaves it, or retained as an earlier boot left it. */
function seedLease(hub, runId, { resource, status = "active" } = {}) {
  const lease = hub.bus.transaction(() => hub.leases.acquire({ resource, holder: `codex:${runId}`, runId, ttlSeconds: 1800 }));
  if (status === "retained") hub.db.prepare("UPDATE leases SET status = 'retained', release_reason = 'test' WHERE id = ?").run(lease.id);
  return lease.id;
}
/** A fake OS probe: live PIDs and their start times; kill() records the call and ends the PID (never a real kill). */
function fakeProbe({ alive = [], starts = {} } = {}) {
  const live = new Set(alive);
  const probe = { kind: "fake", kills: [], live, alive: (pid) => live.has(pid), startTime: async (pid) => { await sleep(5); return starts[pid] ?? null; },
    kill: async (pid) => { probe.kills.push(pid); live.delete(pid); return { ok: true, error: null }; } };
  return probe;
}
/** The crash: the Hub goes away with the rows as they are; a new Hub process boots on the same database. */
async function restart(t) {
  await t.hub.close();
  const hub2 = createHub(t.config, { homeDir: t.homeDir });
  const report = await hub2.boot();
  return { hub2, report };
}
/** A test Hub with the gate OPEN (LIVE_VALIDATION, a Codex grant) and the owner enrolled. */
async function openHub(options = {}) {
  const t = await makeTestHub(options);
  await enableLive(t.hub, { provider: "codex", access: "read-only", attempts: 5 });
  t.owner = await enrolOwner(t);
  t.project = t.hub.projects.hub();
  return t;
}

// ------------------------------------------------------------------------------------------------------------------------------ BL-01
test("BL-01 crash restart with an open run (dead PID, no supervisor record) and the gate OPEN: the boot suspends the gate (shutdown / recovery), the lease stays retained, the run interrupted_unknown; the owner's next request shows the card with the unknown step; the rearm with the acknowledgement releases it and reopens in BUILD_SAFE; nothing relaunched", async () => {
  const t = await openHub();
  let hub2 = null;
  try {
    assert.equal(gate(t.hub).status, "open");
    const conv = conversation(t.hub, t.project.id);
    const runId = seedRun(t.hub, { status: "running", pid: 999999, pidStartedAt: new Date().toISOString(), conversationId: conv.id });
    const lease = seedLease(t.hub, runId, { resource: workspaceResource(t.project.path) });
    const grantsBefore = activeGrants(t.hub);
    const turns = t.readLog("codex").filter((e) => e.method === "turn/start").length;
    const restarted = await restart(t);
    hub2 = restarted.hub2;
    const report = restarted.report;
    assert.deepEqual(report.runs.map((r) => [r.id, r.status]), [[runId, "interrupted_unknown"]]);
    assert.deepEqual(report.leases, [lease]);
    assert.deepEqual(report.leasesReconciled, [], "nothing released at boot");
    assert.equal(leaseRow(hub2, lease).status, "retained", "a dead provider PID proves nothing about what it started (R1-F2)");
    assert.equal(hub2.runs.getRun(runId).status, "interrupted_unknown");
    // The suspension: the existing record kind "shutdown", channel "recovery", the run named in plain Romanian.
    const g = gate(hub2);
    const label = `Codex · ${t.project.name}`;
    const reason = `La repornire, execuția „${label}” era în curs; verific spațiul de lucru înainte să-l refolosesc.`;
    assert.equal(g.status, "suspended");
    assert.deepEqual([g.suspendedBy.kind, g.suspendedBy.channel, g.suspendedBy.actor, g.changedBy], [RECOVERY_SUSPENSION.kind, "recovery", "recovery", "recovery"]);
    assert.equal(g.reason, reason);
    assert.deepEqual(g.suspendedBy.retained, { runs: [runId], leases: [lease], count: 1 });
    assert.equal(g.suspendedBy.since, g.suspendedBy.at, "a fresh record on an open gate");
    const c0 = classifySuspension(g);
    assert.deepEqual([c0.cls, c0.channel], ["shutdown", "recovery"]);
    assert.equal(CHANNEL_LABELS[c0.channel], "la repornirea Hub-ului");
    assert.deepEqual(report.gateSuspended, { suspended: true, suspensionId: g.suspendedBy.id, kind: "shutdown", channel: "recovery", reason, runs: [runId], leases: [lease], count: 1 });
    const ev = events(hub2, "recovery.gate_suspended");
    assert.equal(ev.length, 1);
    assert.deepEqual([ev[0].suspensionId, ev[0].kind, ev[0].channel, ev[0].runs, ev[0].leases, ev[0]._source], [g.suspendedBy.id, "shutdown", "recovery", [runId], [lease], "recovery"]);
    // Not a Stop All: no system.stop_all (the probe never counts it), the grants are left as they are, BUILD_SAFE as every boot.
    assert.equal(count(hub2, "SELECT COUNT(*) AS n FROM events WHERE type = 'system.stop_all'"), 0);
    assert.equal(activeGrants(hub2), grantsBefore, "the boot suspension revokes nothing");
    assert.equal(hub2.settings.get("mode"), "BUILD_SAFE");
    // Idempotent: a second pass over the suspended gate writes nothing (the record is kept).
    const again = suspendGateForRetainedLeases({ db: hub2.db, bus: hub2.bus, clock: () => new Date(), settings: hub2.settings, openRunIds: [runId] });
    assert.deepEqual([again.suspended, again.reason, again.cls], [false, "gate_suspended", "shutdown"]);
    assert.equal(gate(hub2).suspendedBy.id, g.suspendedBy.id);
    assert.equal(events(hub2, "recovery.gate_suspended").length, 1);

    // The owner's next request: „Redeschide poarta” answers with the existing contextual card (the unknown step + the acknowledgement).
    const session = reauthOn(hub2, t.owner);
    const asked = (await asOwner(hub2, session, "owner.intent", { text: "Redeschide poarta", projectId: t.project.id })).results[0];
    const c = asked.gateRearm;
    assert.equal(c?.kind, "gate_rearm", JSON.stringify(asked).slice(0, 600));
    assert.deepEqual([c.eligible, c.code, c.cls, c.via], [true, "ELIGIBLE", "shutdown", "la repornirea Hub-ului"]);
    assert.match(c.headline, /^Poarta de execuție e suspendată la oprirea Hub-ului \(.+, la repornirea Hub-ului\)\. O redeschid aici, cu Windows Hello\?$/);
    assert.deepEqual([c.leases.total, c.leases.ackRequired, c.leases.terminate], [1, true, 0]);
    const step = c.leases.steps[0];
    assert.deepEqual([step.leaseId, step.runId, step.verdict, step.tie, step.ack, step.label], [lease, runId, "unknown", null, true, label]);
    assert.match(step.text, /procesul providerului \(PID 999999\) nu mai rulează, dar nu l-a oprit acest Hub \(a repornit în timpul execuției\)/);
    for (const text of [c.headline, ...c.lines, ...c.stays, step.text, asked.message || ""]) assert.doesNotMatch(text, ADMIN_POINTERS);
    // The boot's suspension revoked nothing: the card says what happened and never claims a revocation (no system.stop_all for it).
    assert.ok(c.lines.includes("Poarta de execuție a fost suspendată la repornirea Hub-ului: un spațiu de lucru a rămas rezervat de o execuție întreruptă."), JSON.stringify(c.lines));
    assert.ok(!c.lines.some((l) => /autorizările active au fost revocate/.test(l)), JSON.stringify(c.lines));
    // Plans proposed before the crash are closed at boot with the truthful reason, not „Stop All” (the owner never pressed Stop).
    const reasons = [];
    const fakeHub = (g) => ({ settings: { get: () => g }, bus: { emit: () => {} }, envelopes: { revoke: (id, o) => { reasons.push(o.reason); return { status: "REVOKED" }; } },
      db: { prepare: (sql) => ({ get: () => null, all: () => (/mission_envelopes/.test(sql) ? [{ id: "env_before_crash" }] : []) }) } });
    assert.deepEqual(closeProposalsFromBeforeStop(fakeHub(gate(hub2))).closed, ["env_before_crash"]);
    assert.deepEqual(reasons, ["Hub-ul a repornit în timpul unei execuții"]);
    // Without the acknowledgement: refused, nothing changes.
    await assert.rejects(rearm(hub2, reauthOn(hub2, t.owner), c), (e) => codeOf(e) === "LEASES_ACK");
    assert.deepEqual([gate(hub2).status, leaseRow(hub2, lease).status], ["suspended", "retained"]);
    // With it (fresh Windows Hello): the lease released as acknowledged, the gate open, BUILD_SAFE, nothing relaunched.
    const out = await rearm(hub2, reauthOn(hub2, t.owner), c, { ackLeases: true });
    assert.equal(out.reopened, true);
    assert.match(out.summary, new RegExp(`^Am eliberat spațiul de lucru rezervat\\. Am redeschis poarta după ${SUSPENSION_LABELS.shutdown}\\.`));
    assert.equal(gate(hub2).status, "open");
    assert.deepEqual([gate(hub2).reopenedAfter.cls, gate(hub2).reopenedAfter.key], ["shutdown", g.suspendedBy.id]);
    assert.equal(leaseRow(hub2, lease).status, "released");
    const rec = events(hub2, "lease.reconciled").find((e) => e.leaseId === lease);
    assert.deepEqual([rec.verdict, rec.evidence.ack, rec.evidence.process.why, rec.evidence.process.tree], ["acknowledged", true, "pid_not_alive", "unknown"]);
    assert.equal(hub2.settings.get("mode"), "BUILD_SAFE");
    assert.equal(hub2.runs.getRun(runId).status, "interrupted_unknown", "never marked completed");
    assert.equal(liveRuns(hub2), 0, "nothing relaunched");
    assert.equal(t.readLog("codex").filter((e) => e.method === "turn/start").length, turns, "no turn after the restart");
    assert.ok(!hub2.leases.current(workspaceResource(t.project.path)), "the workspace is free again");
  } finally {
    if (hub2) await hub2.close().catch(() => {});
    removeDir(t.dataDir);
  }
});

// ------------------------------------------------------------------------------------------------------------------------------ BL-02
test("BL-02 crash restart with the provider still alive (the Hub-tied PID, start evidence matching) and the gate OPEN: the boot suspends the gate; the card's step stops that process (no acknowledgement needed), releases the lease, then reopens", async () => {
  const t = await openHub();
  let hub2 = null;
  try {
    const spawned = new Date(Date.now() - 60000).toISOString();
    const conv = conversation(t.hub, t.project.id);
    // The provider outlives the Hub: here its PID is this test process (alive for real; the fake probe never kills it).
    const runId = seedRun(t.hub, { status: "running", pid: process.pid, pidStartedAt: spawned, conversationId: conv.id });
    const lease = seedLease(t.hub, runId, { resource: workspaceResource(t.project.path) });
    const r = await restart(t);
    hub2 = r.hub2;
    assert.deepEqual(r.report.runs.map((x) => [x.id, x.status]), [[runId, "orphaned"]]);
    assert.equal(leaseRow(hub2, lease).status, "retained");
    assert.deepEqual([gate(hub2).status, gate(hub2).suspendedBy.kind, gate(hub2).suspendedBy.channel], ["suspended", "shutdown", "recovery"]);
    assert.equal(gate(hub2).reason, `La repornire, execuția „Codex · ${t.project.name}” era în curs; verific spațiul de lucru înainte să-l refolosesc.`);
    const probe = fakeProbe({ alive: [process.pid], starts: { [process.pid]: new Date(Date.parse(spawned) - 400).toISOString() } });
    const restore = hub2.leaseReconciler.useProbe(probe);
    await hub2.leaseReconciler.tick(); // the background start-time check: the PID is the run's own process
    const c = await card(hub2, reauthOn(hub2, t.owner));
    assert.deepEqual([c.eligible, c.cls, c.leases.ackRequired, c.leases.terminate], [true, "shutdown", false, 1]);
    const step = c.leases.steps[0];
    assert.deepEqual([step.leaseId, step.verdict, step.tie, step.pid, step.ack], [lease, "process_alive", "pid", process.pid, false]);
    assert.match(step.text, new RegExp(`^Opresc procesul rămas al execuției „Codex · .+” \\(PID ${process.pid}, pornit de Hub\\)`));
    const out = await rearm(hub2, reauthOn(hub2, t.owner), c);
    assert.equal(out.reopened, true);
    assert.match(out.summary, /^Am oprit procesul rămas și am eliberat spațiul de lucru rezervat\. Am redeschis poarta după oprirea Hub-ului/);
    assert.deepEqual(probe.kills, [process.pid], "only the PID the Hub's own records tie to the run");
    const rec = events(hub2, "lease.reconciled").find((e) => e.leaseId === lease);
    assert.deepEqual([rec.verdict, rec.evidence.terminated, rec.evidence.tree], ["released", true, "tree-kill"]);
    assert.deepEqual([gate(hub2).status, hub2.settings.get("mode")], ["open", "BUILD_SAFE"]);
    assert.equal(hub2.runs.getRun(runId).status, "orphaned", "the run's status is never rewritten");
    assert.equal(liveRuns(hub2), 0);
    restore();
  } finally {
    if (hub2) await hub2.close().catch(() => {});
    removeDir(t.dataDir);
  }
});

// ------------------------------------------------------------------------------------------------------------------------------ BL-03
test("BL-03 a restart that leaves nothing retained never closes the gate: an environment run open at the restart whose reap had confirmed is released by the boot pass (the decision comes after it); then a plain restart", async () => {
  const t = await openHub();
  let hub2 = null;
  let hub3 = null;
  try {
    const before = gate(t.hub);
    assert.equal(before.status, "open");
    const envRun = seedRun(t.hub, { status: "running", environment: "wsl-runner", evidence: { environment: { reap: { ok: true, remaining: 0 } } } });
    const envLease = seedLease(t.hub, envRun, { resource: "workspace:p0r8-env-reaped" });
    const r = await restart(t);
    hub2 = r.hub2;
    assert.deepEqual(r.report.leases, [envLease], "recovery retained it first");
    assert.equal(leaseRow(hub2, envLease).status, "released", "the boot pass proved it free (the reap confirmed)");
    assert.equal(events(hub2, "lease.reconciled").filter((e) => e.leaseId === envLease).length, 1);
    assert.deepEqual(gate(hub2), before, "the gate is untouched");
    assert.deepEqual(r.report.gateSuspended, { suspended: false, reason: "no_retained_lease", leases: [] });
    assert.equal(events(hub2, "recovery.gate_suspended").length, 0);
    // A plain restart (nothing open, nothing retained): the gate stays as the owner left it.
    await hub2.close();
    hub3 = createHub(t.config, { homeDir: t.homeDir });
    const report3 = await hub3.boot();
    assert.deepEqual([report3.runs, report3.leases], [[], []]);
    assert.deepEqual(gate(hub3), before);
    assert.equal(report3.gateSuspended.suspended, false);
    assert.equal(events(hub3, "recovery.gate_suspended").length, 0);
    hub2 = null;
  } finally {
    if (hub2) await hub2.close().catch(() => {});
    if (hub3) await hub3.close().catch(() => {});
    removeDir(t.dataDir);
  }
});

// ------------------------------------------------------------------------------------------------------------------------------ BL-04
test("BL-04 a restart with the gate already suspended by Stop All keeps that record (stop_all, same id, same reason); the card still offers the lease step", async () => {
  const t = await openHub();
  let hub2 = null;
  try {
    await ownerStop(t.hub, t.owner.session);
    const stopped = gate(t.hub);
    assert.equal(stopped.suspendedBy.kind, "stop_all");
    const conv = conversation(t.hub, t.project.id);
    const runId = seedRun(t.hub, { status: "running", pid: 999999, pidStartedAt: new Date().toISOString(), conversationId: conv.id });
    const lease = seedLease(t.hub, runId, { resource: workspaceResource(t.project.path) });
    const r = await restart(t);
    hub2 = r.hub2;
    assert.equal(leaseRow(hub2, lease).status, "retained");
    const g = gate(hub2);
    assert.deepEqual([g.suspendedBy.kind, g.suspendedBy.id, g.reason, g.changedAt], [stopped.suspendedBy.kind, stopped.suspendedBy.id, stopped.reason, stopped.changedAt], "the stronger record is kept as it was");
    assert.deepEqual([r.report.gateSuspended.suspended, r.report.gateSuspended.reason, r.report.gateSuspended.cls], [false, "gate_suspended", "stop_all"]);
    assert.equal(events(hub2, "recovery.gate_suspended").length, 0);
    const c = await card(hub2, reauthOn(hub2, t.owner));
    assert.deepEqual([c.eligible, c.cls, c.leases.ackRequired], [true, "stop_all", true]);
    assert.match(c.headline, /^Poarta de execuție e oprită de Stop All/);
    assert.deepEqual(c.leases.steps.map((s) => [s.leaseId, s.verdict, s.ack]), [[lease, "unknown", true]]);
    const out = await rearm(hub2, reauthOn(hub2, t.owner), c, { ackLeases: true });
    assert.equal(out.reopened, true);
    assert.equal(leaseRow(hub2, lease).status, "released");
  } finally {
    if (hub2) await hub2.close().catch(() => {});
    removeDir(t.dataDir);
  }
});

test("BL-04b a restart under the owner's own pause keeps the pause (never replaced by the boot's record); the owner's card releases only the reservation and leaves the pause to „Continuă”", async () => {
  const t = await openHub();
  let hub2 = null;
  try {
    await asOwner(t.hub, t.owner.session, "owner.interrupt", { kind: "pause", reason: "Pauză" });
    const paused = gate(t.hub);
    assert.equal(paused.suspendedBy.kind, "pause");
    const runId = seedRun(t.hub, { status: "running", pid: 999999, pidStartedAt: new Date().toISOString(), conversationId: conversation(t.hub, t.project.id).id });
    const lease = seedLease(t.hub, runId, { resource: workspaceResource(t.project.path) });
    const r = await restart(t);
    hub2 = r.hub2;
    const g = gate(hub2);
    assert.deepEqual([g.suspendedBy.kind, g.suspendedBy.id, g.suspendedBy.credential], [paused.suspendedBy.kind, paused.suspendedBy.id, paused.suspendedBy.credential], "a weaker record is never upgraded by the boot");
    assert.deepEqual([r.report.gateSuspended.suspended, r.report.gateSuspended.cls], [false, "owner_pause"]);
    const c = await card(hub2, reauthOn(hub2, t.owner));
    assert.deepEqual([c.eligible, c.scope, c.leases.steps[0].leaseId, c.leases.ackRequired], [true, "leases", lease, true]);
    const out = await rearm(hub2, reauthOn(hub2, t.owner), c, { ackLeases: true });
    assert.deepEqual([out.reopened, out.scope], [false, "leases"]);
    assert.equal(leaseRow(hub2, lease).status, "released");
    assert.equal(gate(hub2).suspendedBy.kind, "pause", "„Continuă” reopens the owner's pause, not the card");
  } finally {
    if (hub2) await hub2.close().catch(() => {});
    removeDir(t.dataDir);
  }
});

// ------------------------------------------------------------------------------------------------------------------------------ BL-05
test("BL-05 a workspace still reserved since an earlier boot (no run in flight) with the gate OPEN is no dead end either: the boot suspends with its own sentence; the reason texts (pure)", async () => {
  const t = await openHub();
  let hub2 = null;
  try {
    const conv = conversation(t.hub, t.project.id);
    const older = seedRun(t.hub, { status: "interrupted", pid: 999997, conversationId: conv.id });
    const lease = seedLease(t.hub, older, { resource: "workspace:p0r8-older", status: "retained" });
    const r = await restart(t);
    hub2 = r.hub2;
    assert.deepEqual(r.report.runs, [], "no run was in flight");
    assert.equal(leaseRow(hub2, lease).status, "retained");
    const g = gate(hub2);
    assert.deepEqual([g.status, g.suspendedBy.kind, g.suspendedBy.channel], ["suspended", "shutdown", "recovery"]);
    assert.equal(g.reason, `La repornire, spațiul de lucru al execuției „Codex · ${t.project.name}” era încă rezervat; îl verific înainte să-l refolosesc.`);
    assert.deepEqual(g.suspendedBy.retained, { runs: [], leases: [lease], count: 1 });
    const c = await card(hub2, reauthOn(hub2, t.owner));
    assert.deepEqual([c.eligible, c.leases.steps[0].leaseId, c.leases.steps[0].verdict], [true, lease, "unknown"]);
  } finally {
    if (hub2) await hub2.close().catch(() => {});
    removeDir(t.dataDir);
  }
  // The sentences, short and speakable, with diacritics; no jargon (never "lease").
  const row = (id, runId, provider = "codex", project = "Alfa", environment = "windows") => ({ id, run_id: runId, provider, environment, project_name: project });
  assert.equal(retainedLeasesReason([row("l1", "r1"), row("l2", "r2", "claude", "Beta", "wsl-runner")], ["r1", "r2"]),
    "La repornire, execuțiile „Codex · Alfa” și „Claude (wsl-runner) · Beta” erau în curs; verific spațiile de lucru înainte să le refolosesc.");
  assert.equal(retainedLeasesReason([row("l1", "r1"), row("l2", "r2", "codex", "Beta"), row("l3", "r3", "codex", "Gama")], ["r1", "r2", "r3"]),
    "La repornire, 3 execuții erau în curs („Codex · Alfa”, „Codex · Beta” și încă 1); verific spațiile de lucru înainte să le refolosesc.");
  assert.equal(retainedLeasesReason([row("l1", "r1"), row("l1b", "r1")], ["r1"]), "La repornire, execuția „Codex · Alfa” era în curs; verific spațiul de lucru înainte să-l refolosesc.", "one run, two leases: named once");
  assert.equal(retainedLeasesReason([{ id: "l9", run_id: null }], []), "La repornire, un spațiu de lucru era încă rezervat; îl verific înainte să-l refolosesc.");
  assert.equal(retainedLeasesReason([row("l1", "r1"), row("l2", "r2")], []), "La repornire, 2 spații de lucru erau încă rezervate; le verific înainte să le refolosesc.");
  assert.equal(retainedLeasesReason([row("l1", "r1"), row("l2", "old")], ["r1"]), "La repornire, execuția „Codex · Alfa” era în curs; verific spațiul de lucru înainte să-l refolosesc.", "the run in flight is named first");
  for (const s of ["La repornire", "execuția", "spațiul", "înainte"]) assert.ok(retainedLeasesReason([row("l1", "r1")], ["r1"]).includes(s));
  assert.doesNotMatch(retainedLeasesReason([row("l1", "r1")], ["r1"]), /lease|grant|envelope|gate/i);
});

// ------------------------------------------------------------------------------------------------------------------------------ BL-06
test("BL-06 (D2, R4-F8) system.stop_all carries the stop's own stopKind next to the record's kind: the shutdown path with work in flight, the owner's Stop All, a shutdown landing on it, an unknown kind, a security record", async () => {
  const t = await openHub({ codex: "hang" });
  try {
    const stops = () => events(t.hub, "system.stop_all");
    // The real shutdown path (main.mjs → stopForShutdown) with a run in flight on an OPEN gate.
    const conv = conversation(t.hub, t.project.id, "Oprire");
    t.hub.bus.transaction(() => t.hub.conversations.addMessage({ conversationId: conv.id, role: "user", content: "Rezumă README-ul." }, "user"));
    await t.hub.runs.start({ conversationId: conv.id, provider: "codex", access: "read-only" });
    await waitFor(() => t.readLog("codex").some((e) => e.method === "turn/start"), 30000);
    const shut = await stopForShutdown(t.hub, "SIGTERM");
    assert.equal(shut.stopped, true);
    let last = stops().at(-1);
    assert.deepEqual([last.kind, last.stopKind, last._source, last.suspensionId], ["shutdown", "shutdown", "system", shut.suspensionId]);
    await waitFor(() => (t.hub.runs.activeRuns().length === 0 ? true : null), 30000);
    // The owner's Stop All (stronger than the shutdown record: a new record).
    await ownerStop(t.hub, t.owner.session);
    last = stops().at(-1);
    assert.deepEqual([last.kind, last.stopKind], ["stop_all", "stop_all"]);
    // A shutdown landing on the unrearmed Stop All: the record keeps stop_all (precedence); the stop itself was a shutdown.
    await t.hub.runs.stopAll("system", "Hub shutdown (test)", { kind: "shutdown", channel: "system", actor: "system" });
    last = stops().at(-1);
    assert.deepEqual([last.kind, last.stopKind, gate(t.hub).suspendedBy.kind], ["stop_all", "shutdown", "stop_all"]);
    // An unknown requested kind is a Stop All — what the record applied.
    await t.hub.runs.stopAll("test", "test", { kind: "pause" });
    last = stops().at(-1);
    assert.deepEqual([last.kind, last.stopKind], ["stop_all", "stop_all"]);
    // A security record, then an owner Stop All landing on it: the record stays security, the stop says stop_all.
    await t.hub.runs.stopAll("test", "security test", { kind: "security", channel: "test", actor: "test" });
    assert.deepEqual([stops().at(-1).kind, stops().at(-1).stopKind], ["security", "security"]);
    await ownerStop(t.hub, t.owner.session);
    last = stops().at(-1);
    assert.deepEqual([last.kind, last.stopKind, gate(t.hub).suspendedBy.kind], ["security", "stop_all", "security"]);
    // Every system.stop_all of this build carries a stopKind.
    assert.ok(stops().every((e) => ["stop_all", "shutdown", "security"].includes(e.stopKind)));
  } finally { await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ BL-07
/** A fake wsl-runner environment for the Codex writer (never wsl.exe): `log` gets each step in order. */
function fakeCodexEnvironment(log, { answerAtMs = 30, exportMs = 5 } = {}) {
  const inner = { startTurn: (opts) => {
    let resolveDone;
    const done = new Promise((r) => { resolveDone = r; });
    const h = { key: `run-${opts.runId}`, pid: null, done, settled: false };
    h.finish = (result) => { if (h.settled) return; h.settled = true; log.push("inner_done"); resolveDone(result); };
    h.interrupt = async (reason) => { h.finish({ status: "interrupted", error: `interrupted (${reason})`, output: "", usage: {}, preInference: false }); return { interrupted: true }; };
    setTimeout(() => { try { opts.onEvent({ type: "phase", phase: "turn_sent" }); } catch { /* */ } }, 5);
    if (answerAtMs != null) setTimeout(() => h.finish({ status: "completed", output: "Gata.", usage: {}, threadId: "th", turnId: "tu", preInference: false }), answerAtMs);
    return h;
  } };
  return { simulated: true, codex: inner, env: { id: "wsl-runner", distro: "fake", codex: "codex" },
    inspect: async () => ({ ok: true, fingerprint: { hash: "fp1" } }), state: () => null,
    attestationStatus: () => ({ valid: true, latest: { id: "att_fake", status: "PASS_LOCAL" } }),
    prepareWorkspace: async () => ({ ws: "ws1", stats: {}, repo: "/home/runner/ws/hub/ws1/repo", tmp: "/home/runner/ws/hub/ws1/tmp" }),
    inUse: () => [], reap: async () => { log.push("reap"); return { ok: true, remaining: 0 }; },
    collectExport: async () => { log.push("export"); await sleep(exportMs); return { ok: true, stats: {}, refused: [], problems: [], changes: [{ path: "src/app.js", status: "modified" }] }; },
    applyExport: () => { log.push("apply"); return { applied: 1, conflicts: [] }; },
    release: async () => {}, launcher: { inspectConfig: () => ({}) }, probeAccount: async () => ({}) };
}
const onEventInto = (log) => (e) => log.push(e.type === "phase" ? `phase:${e.phase}` : e.type);

test("BL-07a (D3) the wsl-runner Codex adapter reports turn_settled once, right after its provider's turn settles and before the reap / export / apply (a completed turn, and a turn the owner stopped)", async () => {
  const log = [];
  const adapter = createWslCodexAdapter({ environment: fakeCodexEnvironment(log) });
  const h = adapter.startTurn({ runId: "run_bl07a", cwd: "C:\\fake\\project", projectId: "prj_fake", access: "workspace-write", prompt: "Repară.", onEvent: onEventInto(log), exportPolicy: {} });
  const result = await h.done;
  assert.deepEqual([result.status, result.environment.apply.applied], ["completed", 1], result.error || "");
  assert.equal(log.filter((x) => x === "turn_settled").length, 1, log.join(" > "));
  const at = (x) => log.indexOf(x);
  assert.ok(at("phase:turn_sent") < at("inner_done") && at("inner_done") < at("turn_settled") && at("turn_settled") < at("reap") && at("reap") < at("export") && at("export") < at("apply"), log.join(" > "));
  // A Stop during the provider's turn: the turn settles (interrupted) — reported once, then nothing is applied.
  const log2 = [];
  const adapter2 = createWslCodexAdapter({ environment: fakeCodexEnvironment(log2, { answerAtMs: null }) });
  const h2 = adapter2.startTurn({ runId: "run_bl07a2", cwd: "C:\\fake\\project", projectId: "prj_fake", access: "workspace-write", prompt: "Repară.", onEvent: onEventInto(log2), exportPolicy: {} });
  await waitFor(() => (log2.includes("phase:turn_sent") ? true : null), 5000, 5);
  await h2.interrupt("user");
  const r2 = await h2.done;
  assert.equal(r2.status, "interrupted");
  assert.equal(log2.filter((x) => x === "turn_settled").length, 1, log2.join(" > "));
  assert.ok(log2.indexOf("inner_done") < log2.indexOf("turn_settled"));
  assert.equal(log2.includes("apply"), false);
});

test("BL-07b (D3) the wsl-runner Claude reviewer adapter reports turn_settled once, after the CLI's exit and before the reap and the session cleanup (fake supervisor: no process, never wsl.exe)", async () => {
  const dir = tempDir("p0r8-review");
  try {
    fs.writeFileSync(`${dir}/README.md`, "# Recenzie\n");
    const log = [];
    const supervisor = {
      started: [],
      start(spec) {
        this.started.push(spec);
        let resolveExit;
        const exit = new Promise((r) => { resolveExit = r; });
        setTimeout(() => {
          spec.onStdoutLine(JSON.stringify({ type: "system", subtype: "init", apiKeySource: "none", model: "claude-sonnet-4-5", session_id: "ses_bl07b", tools: ["Read"], mcp_servers: [] }));
          spec.onStdoutLine(JSON.stringify({ type: "result", is_error: false, result: "Recenzie: PASS", session_id: "ses_bl07b", usage: { input_tokens: 1, output_tokens: 1 }, modelUsage: { "claude-sonnet-4-5": {} } }));
          log.push("cli_exit");
          resolveExit({ code: 0 });
        }, 15);
        return { pid: 4321, child: { stdin: { write() {}, end() {} } }, exit, stderrTail: [] };
      },
      forget() {}, stop: async () => ({ stopped: true }), get: () => null,
    };
    const environment = { simulated: true, env: WSL_RUNNER,
      state: () => ({ installed: true, facts: { claude_cli: "2.1.285", claude_sha: "abc" } }),
      inspect: async () => ({ ok: true, fingerprint: { hash: "fp1" } }), attestationStatus: () => ({ valid: true, latest: { id: "att_fake", status: "PASS_LOCAL" } }),
      reviewerReadiness: () => ({ ok: true }),
      prepareWorkspace: async () => ({ ws: "ws2", stats: {}, repo: "/home/runner/ws/hub/ws2/repo", tmp: "/home/runner/ws/hub/ws2/tmp" }),
      inUse: () => [], reap: async () => { log.push("reap"); return { ok: true, remaining: 0 }; },
      cleanupReviewerSession: async () => { log.push("session_cleanup"); return { ok: true }; },
      release: async () => {}, probeReviewer: async () => ({}) };
    const config = { testMode: true, hubRoot: dir, wsl: { executable: process.execPath, prefixArgs: [] } };
    const adapter = createWslClaudeAdapter({ environment, config, supervisor });
    const h = adapter.startTurn({ runId: "run_bl07b", cwd: dir, projectId: "prj_fake", access: "read-only", model: "sonnet", prompt: "Recenzează.", onEvent: onEventInto(log) });
    const result = await h.done;
    assert.equal(result.status, "completed", result.error || "");
    assert.equal(supervisor.started.length, 1, "the CLI was started through the (fake) supervisor only");
    assert.equal(log.filter((x) => x === "turn_settled").length, 1, log.join(" > "));
    const at = (x) => log.indexOf(x);
    assert.ok(at("phase:turn_sent") < at("cli_exit") && at("cli_exit") < at("turn_settled") && at("turn_settled") < at("reap") && at("reap") < at("session_cleanup"), log.join(" > "));
  } finally { removeDir(dir); }
});

/** The run manager over the real wsl-runner Codex adapter and a fake environment (the RF-03 rig's shape; the gate forced open for these runs only). */
function envRig(t, { answerAtMs, exitAfterAnswerMs, exportMs }) {
  const hub = t.hub;
  const records = new Map();
  const realGet = hub.supervisor.get;
  hub.supervisor.get = (key) => records.get(key) || realGet.call(hub.supervisor, key);
  const log = [];
  const environment = fakeCodexEnvironment(log, { answerAtMs, exportMs });
  const innerStart = environment.codex.startTurn;
  environment.codex.startTurn = (opts) => {
    const key = `run-${opts.runId}`;
    // The provider's process: its supervisor record outlives the turn's answer (the process is still ending).
    records.set(key, { key, pid: null, exited: false });
    setTimeout(() => records.delete(key), answerAtMs + exitAfterAnswerMs);
    return innerStart(opts);
  };
  // The run manager's onEvent, observed: where the adapter's turn_settled lands in the order of the steps.
  const adapter = createWslCodexAdapter({ environment });
  const realStartTurn = adapter.startTurn;
  adapter.startTurn = (opts) => realStartTurn({ ...opts, onEvent: (e) => { if (e?.type === "turn_settled") log.push("turn_settled"); return opts.onEvent(e); } });
  hub.providers["codex@wsl-runner"] = adapter;
  const realRoute = hub.environments.routeFor;
  hub.environments.routeFor = () => "wsl-runner";
  const realEval = hub.gate.evaluate;
  hub.gate.evaluate = (args) => { const d = realEval(args); return { ...d, allowed: true, checks: d.checks.map((c) => ({ ...c, ok: true })) }; };
  return { log, records, restore: () => { hub.supervisor.get = realGet; delete hub.providers["codex@wsl-runner"]; hub.environments.routeFor = realRoute; hub.gate.evaluate = realEval; } };
}

test("BL-07c (D3, end to end) a completed wsl-runner writer turn whose provider process is still ending past the limit and the bounded wait, while the export runs: turn_settled ends the deadline — completed and applied, never a timeout", async () => {
  const t = await makeTestHub();
  let rig = null;
  try {
    await enableLive(t.hub, { provider: "codex", access: "workspace-write", attempts: 5 });
    // Limit 800 ms (bounded wait 800 ms); the answer at 150 ms; the process record stays until 3.2 s; the export takes 2 s.
    rig = envRig(t, { answerAtMs: 150, exitAfterAnswerMs: 3000, exportMs: 2000 });
    const conv = conversation(t.hub, t.hub.projects.hub().id, "BL-07c");
    t.hub.bus.transaction(() => t.hub.conversations.addMessage({ conversationId: conv.id, role: "user", content: "Repară bug-ul." }, "user"));
    const { run } = await t.hub.runs.start({ conversationId: conv.id, provider: "codex", access: "workspace-write", turnTimeoutMs: 800 });
    const done = await waitFor(() => { const r = t.hub.runs.getRun(run.id); return ["completed", "failed", "interrupted", "blocked"].includes(r.status) ? r : null; }, 30000, 20);
    assert.deepEqual([done.status, done.errorCategory], ["completed", null], done.errorMessage || "");
    assert.equal(done.evidence.environment.apply.applied, 1, "the completed writer's export was applied");
    assert.equal(done.evidence.turnTimeout, undefined);
    assert.equal(events(t.hub, "run.turn_timeout").filter((e) => e.limitMs === 800).length, 0, "no timeout");
    assert.ok(rig.log.indexOf("turn_settled") > rig.log.indexOf("inner_done") && rig.log.indexOf("turn_settled") < rig.log.indexOf("export"), rig.log.join(" > "));
  } finally { if (rig) rig.restore(); await t.cleanup(); }
});
