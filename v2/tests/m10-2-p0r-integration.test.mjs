// 2.12.2 — integration of the P0 round (R1 retained-lease reconciliation, R2 imperative stop intent, R3 per-turn timeout, R4 probe
// counters): the seams between the units and the wiring outside their own files.
//  - INT-01: the owner's HTTP route forwards the lease acknowledgement (POST /api/owner/gate/rearm ackLeases) — R1's card needs it;
//  - INT-02: the voice route under another authenticator's pause with a reserved workspace points to the cockpit card (never a dead end);
//  - INT-03: Stop All wins over an armed per-turn deadline when the turn's answer is lost (R1 lost-turn follow-up × R3 deadline);
//  - INT-04: a deadline that fired on a turn whose answer never arrives is settled by the lost-turn follow-up as turn_timeout (R3 × R1);
//  - INT-05: the version and the (unchanged, additive) API contract the server reports.
// PASS_SIMULATED: a fake provider adapter and fake supervisor records, a fake OS probe (no real PID is ever killed), seeded rows for the
// environment route (never wsl.exe), the software authenticator, loopback test servers; no model, no network, no live Hub.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { makeTestHub, enableLive, enrolOwner, prepareLiveWithoutGrants, waitFor } from "./helpers.mjs";
import { startDerivedLega } from "./voice-helpers.mjs";
import { createHttpServer } from "../server/http/server.mjs";
import { SESSION_COOKIE } from "../server/owner/trust.mjs";
import { HUB_VERSION, API_CONTRACT } from "../server/config.mjs";
import { LEASES_ACK_LABEL } from "../server/runtime/lease-reconcile.mjs";

const ADMIN_POINTERS = /OPEN GATE|Integrări → Avansat|Avansat|din Sistem|#\/system/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const gate = (hub) => hub.settings.get("executionGate");
const leaseRow = (hub, id) => hub.db.prepare("SELECT * FROM leases WHERE id = ?").get(id);
const leaseOfRun = (hub, runId) => hub.db.prepare("SELECT * FROM leases WHERE run_id = ? ORDER BY acquired_at DESC LIMIT 1").get(runId);
const eventsOf = (hub, type) => hub.db.prepare("SELECT payload_json, run_id FROM events WHERE type = ? ORDER BY seq").all(type).map((r) => ({ ...JSON.parse(r.payload_json || "{}"), _run: r.run_id }));
const ownerStop = (t) => t.hub.commands.dispatch({ type: "system.stop_all", payload: { reason: "test" }, channel: "owner", actor: `owner:${t.owner.session.id}`, ownerSession: t.owner.session }).then((r) => r.result);
const script = (list) => `lega-script:${Buffer.from(JSON.stringify(list)).toString("base64url")}`;

/** A fake OS probe: nothing is alive, nothing is ever killed for real (kill() only records the call). */
function fakeProbe() {
  const probe = { kind: "fake", kills: [], startQueries: [], alive: () => false,
    startTime: async (pid) => { probe.startQueries.push(pid); return null; },
    kill: async (pid) => { probe.kills.push(pid); return { ok: true, error: null }; } };
  return probe;
}

let seeded = 0;
/** A finished wsl-runner run whose reap never confirmed (the reconciler can never prove it gone) and its retained workspace lease. */
function seedUnknownLease(hub, label) {
  const runId = `run_int_${Date.now().toString(36)}_${++seeded}`;
  const now = new Date().toISOString();
  hub.db.prepare(`INSERT INTO agent_runs (id, provider, status, pid, pid_started_at, started_at, created_at, environment, evidence_json, finished_at)
    VALUES (?, 'codex', 'interrupted', NULL, NULL, ?, ?, 'wsl-runner', ?, ?)`).run(runId, now, now, JSON.stringify({ environment: { reap: { ok: false, remaining: 1 } } }), now);
  const lease = hub.bus.transaction(() => hub.leases.acquire({ resource: `workspace:int-${label}-${runId}`, holder: `codex:${runId}`, runId, ttlSeconds: 600 }));
  hub.db.prepare("UPDATE leases SET status = 'retained', release_reason = 'test' WHERE id = ?").run(lease.id);
  return { runId, leaseId: lease.id };
}

/**
 * The fixture codex adapter's startTurn replaced by a controllable fake (no process): the turn reaches the model at once (turn_sent),
 * a fake supervisor record stands for the process (its exit is the test's). settleOnInterrupt false: the turn's answer never arrives.
 */
function fakeProvider(t) {
  const hub = t.hub;
  const adapter = hub.providers.codex;
  const realStart = adapter.startTurn;
  const realGet = hub.supervisor.get;
  const realStop = hub.supervisor.stop;
  const records = new Map();
  const state = { starts: 0, handles: [] };
  let nextMode = {};
  hub.supervisor.get = (key) => records.get(key) || realGet.call(hub.supervisor, key);
  hub.supervisor.stop = async (key, options) => {
    const record = records.get(key);
    if (!record) return realStop.call(hub.supervisor, key, options);
    record.exited = true;
    return { stopped: true };
  };
  adapter.startTurn = (opts) => {
    state.starts += 1;
    const mode = { ...nextMode };
    const key = `run-${opts.runId}`;
    const record = { key, pid: null, exited: false };
    records.set(key, record);
    let settle;
    const done = new Promise((resolve) => { settle = resolve; });
    const handle = { key, pid: null, done, record, interrupts: [], settle: (result) => settle(result),
      interrupt: async (reason) => {
        handle.interrupts.push(reason);
        if (mode.settleOnInterrupt !== false) settle({ status: "interrupted", error: `interrupted (${reason})`, output: "", usage: {}, preInference: false });
        return { interrupted: mode.settleOnInterrupt !== false, graceful: false, reason };
      } };
    state.handles.push(handle);
    // As the real adapters report it: after startTurn returned (Codex on turn/start, Claude Code after its init event).
    setImmediate(() => { try { opts.onEvent({ type: "phase", phase: "turn_sent" }); } catch { /* timeline only */ } });
    return handle;
  };
  state.next = (mode) => { nextMode = mode || {}; };
  state.restore = () => { adapter.startTurn = realStart; hub.supervisor.get = realGet; hub.supervisor.stop = realStop; };
  return state;
}

async function runHub() {
  const t = await makeTestHub();
  await enableLive(t.hub, { provider: "codex", access: "read-only", attempts: 5 });
  t.owner = await enrolOwner(t);
  t.fake = fakeProvider(t);
  return t;
}
async function startRun(t, { turnTimeoutMs, mode = {} } = {}) {
  const project = t.hub.projects.hub();
  const conv = t.hub.bus.transaction(() => t.hub.conversations.create({ projectId: project.id, title: "Integrare" }, "user"));
  t.hub.bus.transaction(() => t.hub.conversations.addMessage({ conversationId: conv.id, role: "user", content: "Rezumă README-ul." }, "user"));
  t.fake.next(mode);
  const { run } = await t.hub.runs.start({ conversationId: conv.id, provider: "codex", access: "read-only", turnTimeoutMs });
  // The turn reached the model: its deadline was armed again, once, with the full limit.
  await waitFor(() => (t.hub.runs.activeRuns().find((r) => r.runId === run.id)?.turnDeadline?.phase === "turn" ? true : null), 5000, 5);
  return { run, handle: t.fake.handles.at(-1) };
}

/** Loopback HTTP against a test Hub's server, with the owner's session cookie (the UI's own request shape). */
function caller(t, token) {
  const host = `localhost:${t.config.port}`;
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(t.owner.token)}`;
  return (method, p, body = null) => new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request({ host: "127.0.0.1", port: t.config.port, method, path: p, headers: { Host: host, Origin: `http://${host}`, Cookie: cookie,
      ...(method !== "GET" ? { "X-Hub-Token": token } : {}), ...(data ? { "Content-Type": "application/json", "Content-Length": data.length } : {}) } }, (res) => {
      const chunks = []; res.on("data", (c) => chunks.push(c)); res.on("end", () => { let json = null; try { json = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { /* */ } resolve({ status: res.statusCode, json }); });
    });
    req.on("error", reject); if (data) req.write(data); req.end();
  });
}

// ------------------------------------------------------------------------------------------------------------------------------ INT-01
test("INT-01 the owner's HTTP rearm route forwards ackLeases: without it the card's unknown lease is refused (LEASES_ACK, nothing changes); with it the lease is released as acknowledged and the gate reopens", async () => {
  const t = await makeTestHub();
  const { server, token } = createHttpServer(t.hub);
  await new Promise((r) => server.listen(t.config.port, "127.0.0.1", r));
  let restore = null;
  try {
    t.owner = await enrolOwner(t);
    await ownerStop(t);
    const probe = fakeProbe();
    restore = t.hub.leaseReconciler.useProbe(probe);
    const { leaseId } = seedUnknownLease(t.hub, "http");
    const call = caller(t, token);
    const got = await call("POST", "/api/owner/gate/rearm/card", {});
    assert.equal(got.status, 200, JSON.stringify(got.json));
    const card = got.json;
    assert.deepEqual([card.kind, card.eligible, card.leases?.ackRequired, card.leases?.ackLabel], ["gate_rearm", true, true, LEASES_ACK_LABEL]);
    assert.deepEqual(card.leases.steps.map((s) => [s.leaseId, s.verdict, s.ack]), [[leaseId, "unknown", true]]);
    t.owner.reauth(); // the fresh verification the rearm needs (the same session the cookie names)
    const refused = await call("POST", "/api/owner/gate/rearm", { nonce: card.nonce, hash: card.hash, modality: "click" });
    assert.ok(refused.status >= 400 && refused.status < 500, JSON.stringify(refused.json));
    assert.equal(refused.json.error.details.code, "LEASES_ACK");
    assert.deepEqual([gate(t.hub).status, leaseRow(t.hub, leaseId).status], ["suspended", "retained"]);
    // The same card, now with the acknowledgement ticked (the page sends the boolean true only for such a card).
    const out = await call("POST", "/api/owner/gate/rearm", { nonce: card.nonce, hash: card.hash, ackLeases: true, modality: "click" });
    assert.equal(out.status, 200, JSON.stringify(out.json));
    assert.equal(out.json.reopened, true);
    assert.deepEqual(out.json.leases.map((l) => [l.leaseId, l.released, l.acknowledged]), [[leaseId, true, true]]);
    assert.deepEqual([gate(t.hub).status, leaseRow(t.hub, leaseId).status], ["open", "released"]);
    assert.deepEqual(eventsOf(t.hub, "lease.reconciled").filter((e) => e.leaseId === leaseId).map((e) => [e.verdict, e.evidence?.ack]), [["acknowledged", true]]);
    const logged = t.hub.db.prepare("SELECT payload_json, channel FROM commands WHERE type = 'gate.rearm' ORDER BY rowid").all().map((r) => [r.channel, JSON.parse(r.payload_json).ackLeases]);
    assert.deepEqual(logged, [["owner", false], ["owner", true]], "the command log shows the acknowledgement as the route passed it");
    assert.deepEqual([probe.kills, probe.startQueries], [[], []], "no process to stop, nothing asked of the OS");
  } finally {
    restore?.();
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
    await t.cleanup();
  }
});

// ------------------------------------------------------------------------------------------------------------------------------ INT-02
test("INT-02 by voice, another authenticator's pause with a reserved workspace is never a dead end: the answer names Lega first and the cockpit card (never by voice), no card on the voice route, nothing reopened or released", async () => {
  const t = await makeTestHub({ queues: true, codex: script([{ sleep: 120000 }]) });
  try {
    await prepareLiveWithoutGrants(t.hub);
    const owner = await enrolOwner(t, { activatePolicy: true });
    const lega = await startDerivedLega(t, owner);
    const at = new Date().toISOString();
    t.hub.bus.transaction(() => t.hub.settings.set("executionGate", { status: "suspended", reason: "Pauză (fără pași noi)", changedAt: at, changedBy: "x",
      suspendedBy: { kind: "pause", id: `sus_int_${Date.now().toString(36)}`, credential: "0".repeat(24), at, since: at, missions: [] } }, "test"));
    const { leaseId } = seedUnknownLease(t.hub, "voice");
    const ask = (await t.hub.commands.dispatch({ type: "owner.intent", channel: "voice", actor: "voice", payload: { text: "Lega, redeschide poarta", legaSessionId: lega } })).result.results[0];
    assert.equal(ask.intent, "gate_rearm");
    assert.equal(ask.gateRearm, undefined, "never a card on the voice route");
    assert.equal(ask.gateStopped?.code, "LEASES", JSON.stringify(ask.gateStopped));
    assert.equal(ask.message, "Poarta e oprită printr-o pauză din altă sesiune a ta (alt autentificator) și un spațiu de lucru e încă rezervat după o oprire neconfirmată: după ce închizi Lega, o redeschizi în cockpit, pe cardul „Redeschide poarta”, cu Windows Hello — nu prin voce; nimic nu se redeschide singur. Pe card vezi și ce fac cu spațiul rezervat.");
    assert.doesNotMatch(ask.message, /până nu e eliberat|lease-uri/);
    assert.doesNotMatch(ask.message, ADMIN_POINTERS);
    await sleep(100);
    assert.deepEqual([gate(t.hub).status, leaseRow(t.hub, leaseId).status], ["suspended", "retained"]);
    assert.equal(eventsOf(t.hub, "gate.rearmed").length, 0);
  } finally { await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ INT-03
test("INT-03 Stop All wins over an armed per-turn deadline when the turn's answer is lost: no turn_timeout fires after the stop; the lost-turn follow-up ends the run interrupted (never turn_timeout), releases the lease, retries nothing", async () => {
  const t = await runHub();
  try {
    const { run, handle } = await startRun(t, { turnTimeoutMs: 1500, mode: { settleOnInterrupt: false } });
    const lease = leaseOfRun(t.hub, run.id);
    assert.equal(t.hub.runs.activeRuns()[0].turnDeadline?.phase, "turn", "armed with the full limit at turn_sent");
    handle.record.exited = true; // the provider process is gone; its final answer never reaches the Hub
    const stop = await ownerStop(t);
    assert.equal(stop.gate, "suspended");
    assert.deepEqual(handle.interrupts, ["stop-all"]);
    assert.equal(t.hub.runs.activeRuns()[0]?.turnDeadline ?? null, null, "Stop All cleared the deadline synchronously");
    await sleep(1900); // past the deadline
    assert.equal(eventsOf(t.hub, "run.turn_timeout").length, 0, "no timeout after the stop");
    await waitFor(() => (t.hub.runs.getRun(run.id).status !== "running" ? true : null), 8000, 50);
    const r = t.hub.runs.getRun(run.id);
    assert.equal(r.status, "interrupted");
    assert.notEqual(r.errorCategory, "turn_timeout");
    assert.match(r.errorMessage, /răspunsul lui final nu a mai sosit/);
    assert.equal(r.evidence?.turnTimeout, undefined, "the run carries no timeout evidence");
    assert.equal(leaseRow(t.hub, lease.id).status, "released");
    assert.equal(t.hub.runs.activeRuns().length, 0);
    assert.equal(t.fake.starts, 1, "never retried");
  } finally { t.fake.restore(); await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ INT-04
test("INT-04 a deadline that fired on a turn whose answer never arrives (process gone): the lost-turn follow-up R3 schedules settles it as failed / turn_timeout, the lease is released, nothing is retried", async () => {
  const t = await runHub();
  try {
    const { run, handle } = await startRun(t, { turnTimeoutMs: 400, mode: { settleOnInterrupt: false } });
    const lease = leaseOfRun(t.hub, run.id);
    handle.record.exited = true; // the provider process ended on its own; its answer was lost
    await waitFor(() => (eventsOf(t.hub, "run.turn_timeout").some((e) => e._run === run.id) ? true : null), 5000, 25);
    assert.deepEqual(handle.interrupts, ["turn-timeout"], "the adapter's own interruption");
    assert.equal(gate(t.hub).status, "open", "a timeout is not a stop");
    await waitFor(() => (t.hub.runs.getRun(run.id).status !== "running" ? true : null), 8000, 50);
    const r = t.hub.runs.getRun(run.id);
    assert.deepEqual([r.status, r.errorCategory, r.preInference], ["failed", "turn_timeout", false], "an attempt: the turn had reached the model");
    assert.equal(r.evidence?.turnTimeout?.outcome, "turn_timeout");
    assert.equal(r.evidence?.turnTimeout?.limitMs, 400);
    assert.equal(leaseRow(t.hub, lease.id).status, "released", "the process is provably gone: released with the run");
    assert.equal(t.hub.runs.activeRuns().length, 0);
    // The answer arriving late changes nothing (finalize runs once); the run manager never retries.
    handle.settle({ status: "completed", output: "răspuns târziu", usage: {} });
    await sleep(100);
    assert.equal(t.hub.runs.getRun(run.id).status, "failed");
    assert.equal(t.fake.starts, 1);
  } finally { t.fake.restore(); await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ INT-05
test("INT-05 the server reports 2.15.5-m12 with API contract 17 (2.15.5: the catalog reaches the M12 offer; the contract of the Sales decisions bound to the owner session unchanged)", () => {
  assert.equal(HUB_VERSION, "2.15.5-m12");
  assert.equal(API_CONTRACT, 17);
});

test("INT-05-HTTP the session route reports the pinned version and contract", async () => {
  const t = await makeTestHub();
  const { server } = createHttpServer(t.hub);
  await new Promise((r) => server.listen(t.config.port, "127.0.0.1", r));
  try {
    const got = await new Promise((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port: t.config.port, method: "GET", path: "/api/session", headers: { Host: `localhost:${t.config.port}` } }, (res) => {
        let text = ""; res.setEncoding("utf8"); res.on("data", (c) => { text += c; }); res.on("end", () => resolve({ status: res.statusCode, json: JSON.parse(text), headers: res.headers }));
      });
      req.on("error", reject); req.end();
    });
    assert.equal(got.status, 200);
    assert.deepEqual([got.json.version, got.json.apiContract, got.headers["x-hub-contract"]], ["2.15.5-m12", 17, "17"]);
  } finally { await new Promise((r) => server.close(r)); await t.cleanup(); }
});
