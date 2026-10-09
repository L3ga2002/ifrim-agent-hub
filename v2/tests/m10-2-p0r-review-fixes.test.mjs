// 2.12.2 — the review round over R1/R2/R3 (findings R1-F1, R1-F2, R3-F3, R3-F4, R3-F5, R2-F1 … R2-F5): one regression test per finding,
// each written from the reviewer's reproduction, plus in-file mutation checks for the intent guards (the runtime guards were
// mutation-checked by hand: break → this file fails for the right reason → exact bytes restored → green).
//  - RF-01 (R1-F1): the lease acknowledgement covers only the steps that asked for it; a step that promised to stop a Hub-tied process and
//    stopped nothing (its start time could not be read again) is never released — the rearm stops with a new card, the gate stays closed;
//  - RF-02 (R1-F2): a crash leaves a command the provider started alive and writing (Windows: real processes, cmd.exe standing in for the
//    provider). A dead provider PID is no proof: the lease stays retained at boot and in every sweep; the owner's card releases it only
//    with the acknowledgement;
//  - RF-03 (R3-F5): on wsl-runner the turn deadline bounds the provider's turn, not the export validation after it: a completed writer turn
//    is applied, never recorded as a timeout; a hung turn is still cut; an adapter's turn_settled ends the deadline;
//  - RF-04 (R3-F3): ONE automatic re-dispatch per step, whatever maxAttemptsPerStage allows; then the owner decides, with an honest text;
//  - RF-05 (R3-F4): a Pause landing while the deadline's interruption settles: the factory counts the timed-out attempt like the run and
//    the grant do (FAILED), no automatic retry;
//  - RF-06 … RF-10 (R2-F1 … R2-F5): the review's phrasings — the real commands stop (typed, voice-local, provider transcript, through
//    owner.intent), talk about the command never does — with a mutation check per new guard.
// PASS_SIMULATED except RF-02's local processes (cmd.exe + node, killed at the end): fake providers and supervisor records, a fake OS
// probe, a fake environment object (never wsl.exe), the software authenticator, a test clock; no model, no network, no live Hub.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { makeTestHub, enableLive, enrolOwner, prepareLiveWithoutGrants, waitFor } from "./helpers.mjs";
import { createHub } from "../server/hub.mjs";
import { workspaceResource } from "../server/runtime/runs.mjs";
import { createWslCodexAdapter } from "../server/providers/codex-wsl.mjs";
import { materializeFixture, demoSpec } from "../server/factory/fixtures.mjs";
import { resolveIntent, interruptMood } from "../server/owner/intents.mjs";
import { parseVoiceCommand } from "../server/domain/voice.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const gate = (hub) => hub.settings.get("executionGate");
const codeOf = (e) => e?.details?.code || null;
const leaseRow = (hub, id) => hub.db.prepare("SELECT * FROM leases WHERE id = ?").get(id);
const events = (hub, type) => hub.db.prepare("SELECT payload_json, run_id, scope_id FROM events WHERE type = ? ORDER BY seq").all(type)
  .map((r) => ({ ...JSON.parse(r.payload_json || "{}"), _run: r.run_id, _scope: r.scope_id }));
const dispatch = (hub, type, payload, channel = "test", extra = {}) => hub.commands.dispatch({ type, payload, channel, actor: "test", ...extra });
const asOwner = (hub, session, type, payload = {}) => hub.commands.dispatch({ type, payload, channel: "owner", actor: `owner:${session.id}`, ownerSession: session }).then((r) => r.result);
const card = (hub, session) => asOwner(hub, session, "gate.rearm.card", {});
const rearm = (hub, session, c, extra = {}) => asOwner(hub, session, "gate.rearm", { nonce: c.nonce, hash: c.hash, ...extra });
const ownerStop = (hub, session) => hub.commands.dispatch({ type: "system.stop_all", payload: { reason: "test" }, channel: "owner", actor: `owner:${session.id}`, ownerSession: session });
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };

let seeded = 0;
/** A run row as another boot or a crash left it (seeded: no provider process is involved). */
function seedRun(hub, { status = "interrupted", pid = null, pidStartedAt = null, environment = "windows", evidence = {} } = {}) {
  const id = `run_rfseed_${Date.now().toString(36)}_${++seeded}`;
  const now = new Date().toISOString();
  hub.db.prepare(`INSERT INTO agent_runs (id, provider, status, pid, pid_started_at, started_at, created_at, environment, evidence_json, finished_at)
    VALUES (?, 'codex', ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, status, pid, pidStartedAt, now, now, environment, JSON.stringify(evidence), ["running", "starting", "waiting_approval"].includes(status) ? null : now);
  return id;
}
function seedLease(hub, runId, resource) {
  const lease = hub.bus.transaction(() => hub.leases.acquire({ resource, holder: `codex:${runId}`, runId, ttlSeconds: 600 }));
  hub.db.prepare("UPDATE leases SET status = 'retained', release_reason = 'test' WHERE id = ?").run(lease.id);
  return lease.id;
}
/** A fake OS probe: live PIDs and their start times; kill() records the call and ends the PID (never a real kill). */
function fakeProbe({ alive: pids = [], starts = {} } = {}) {
  const live = new Set(pids);
  const probe = { kind: "fake", kills: [], startQueries: [], live, starts,
    alive: (pid) => live.has(pid),
    startTime: async (pid) => { probe.startQueries.push(pid); await sleep(5); return starts[pid] ?? null; },
    kill: async (pid) => { probe.kills.push(pid); live.delete(pid); return { ok: true, error: null }; } };
  return probe;
}
/** The owner's fresh verification on a restarted Hub (same database, same authenticator, same session). */
function reauthOn(hub, owner) {
  const c = hub.trust.beginAuthentication({ origin: owner.origin, purpose: "reauth" });
  hub.trust.finishAuthentication({ origin: owner.origin, challengeId: c.challengeId, credential: owner.auth.get({ challenge: c.publicKey.challenge }), currentToken: owner.token });
  return hub.trust.resolveSession(owner.token, { origin: owner.origin });
}

// ------------------------------------------------------------------------------------------------------------------------------ RF-01
test("RF-01 (R1-F1) the acknowledgement is per step: a Hub-tied orphan whose start time cannot be read again at the kill is never released by another step's ack — CARD_CHANGED, the gate stays closed, nothing killed", async () => {
  const t = await makeTestHub();
  try {
    await enableLive(t.hub, { provider: "codex", access: "read-only", attempts: 5 });
    const owner = await enrolOwner(t);
    await ownerStop(t.hub, owner.session);
    const spawned = new Date(Date.now() - 60000).toISOString();
    const probe = fakeProbe({ alive: [4242, 4343, 4444], starts: { 4242: spawned, 4343: spawned, 4444: spawned } });
    const restore = t.hub.leaseReconciler.useProbe(probe);
    // The reviewer's card: a Windows orphan (Hub-tied by its start evidence: "process_alive", no ack) and an environment run whose reap
    // never confirmed ("unknown": the ack is required for the card).
    const orphanLease = seedLease(t.hub, seedRun(t.hub, { pid: 4242, pidStartedAt: spawned }), "workspace:rf01-orphan");
    const envLease = seedLease(t.hub, seedRun(t.hub, { environment: "wsl-runner", evidence: { environment: { reap: { ok: false, remaining: 1 } } } }), "workspace:rf01-env");
    await t.hub.leaseReconciler.tick(); // the start check: 4242 is the Hub's own process
    const calls = [];
    const realTerminate = t.hub.leaseReconciler.terminateOrphan;
    t.hub.leaseReconciler.terminateOrphan = (leaseId, options) => { calls.push({ leaseId, ack: options.ack, expected: options.expected }); return realTerminate(leaseId, options); };
    const c = await card(t.hub, owner.session);
    const steps = Object.fromEntries(c.leases.steps.map((s) => [s.leaseId, s]));
    assert.deepEqual([steps[orphanLease].verdict, steps[orphanLease].tie, steps[orphanLease].ack], ["process_alive", "pid", false]);
    assert.match(steps[orphanLease].text, /^Opresc procesul rămas al execuției „Codex” \(PID 4242, pornit de Hub\)/);
    assert.deepEqual([steps[envLease].verdict, steps[envLease].ack, c.leases.ackRequired], ["unknown", true, true]);
    // At apply the kill-time re-read of the start time fails (a CIM timeout or error → null).
    delete probe.starts[4242];
    await assert.rejects(rearm(t.hub, owner.reauth(), c, { ackLeases: true }), (e) => codeOf(e) === "CARD_CHANGED" && /nu l-am mai putut verifica chiar înainte de oprire/.test(e.message));
    assert.equal(gate(t.hub).status, "suspended", "the gate stays closed");
    assert.equal(leaseRow(t.hub, orphanLease).status, "retained", "the orphan's workspace stays reserved");
    assert.equal(events(t.hub, "lease.reconciled").some((e) => e.leaseId === orphanLease), false, "never released 'acknowledged'");
    assert.deepEqual(probe.kills, [], "no unverified PID is ever killed");
    assert.equal(probe.live.has(4242), true);
    assert.equal(events(t.hub, "gate.rearmed").length, 0);
    // Guard A (gate-rearm): the orphan's step got NO acknowledgement and the card's verdict as `expected`, whatever ackLeases said.
    const orphanCall = calls.find((x) => x.leaseId === orphanLease);
    assert.deepEqual([orphanCall.ack, orphanCall.expected], [false, { verdict: "process_alive", tie: "pid" }]);
    // The new card says what is true now: the PID can no longer be verified — the owner decides on that, knowingly.
    const c2 = await card(t.hub, owner.session);
    const s2 = c2.leases.steps.find((s) => s.leaseId === orphanLease);
    assert.deepEqual([s2.verdict, s2.tie, s2.ack], ["unknown", "unverified", true]);
    assert.match(s2.text, /verific întâi PID-ul: îl opresc doar dacă e procesul pornit de Hub/);
    const s2env = c2.leases.steps.find((s) => s.leaseId === envLease);
    if (s2env) assert.equal(s2env.ack, true);

    // Guard B (lease-reconcile): called directly with an acknowledgement, a promised stop that did not happen still never releases.
    const direct = seedLease(t.hub, seedRun(t.hub, { pid: 4343, pidStartedAt: spawned }), "workspace:rf01-direct");
    await t.hub.leaseReconciler.verify(direct);
    assert.equal(t.hub.leaseReconciler.assess(direct).verdict, "process_alive");
    delete probe.starts[4343];
    await assert.rejects(realTerminate(direct, { ownerSession: owner.session, ack: true, expected: { verdict: "process_alive", tie: "pid" } }), (e) => codeOf(e) === "LEASE_STATE_CHANGED");
    probe.starts[4343] = spawned; await t.hub.leaseReconciler.verify(direct); delete probe.starts[4343];
    await assert.rejects(realTerminate(direct, { ownerSession: owner.session, ack: true }), (e) => codeOf(e) === "LEASE_STATE_CHANGED", "the default `expected` is the lease's state when the call starts");
    assert.equal(leaseRow(t.hub, direct).status, "retained");
    assert.deepEqual(probe.kills, []);

    // An ackLeases the card did not ask for (only a process_alive step: ackRequired false) changes nothing.
    t.hub.db.prepare("UPDATE leases SET status = 'released' WHERE id IN (?, ?, ?)").run(orphanLease, envLease, direct);
    const only = seedLease(t.hub, seedRun(t.hub, { pid: 4444, pidStartedAt: spawned }), "workspace:rf01-only");
    await t.hub.leaseReconciler.verify(only);
    const c3 = await card(t.hub, owner.session);
    assert.deepEqual([c3.leases.total, c3.leases.ackRequired, c3.leases.steps[0].verdict], [1, false, "process_alive"]);
    delete probe.starts[4444];
    calls.length = 0;
    await assert.rejects(rearm(t.hub, owner.reauth(), c3, { ackLeases: true }), (e) => codeOf(e) === "CARD_CHANGED");
    assert.deepEqual(calls.map((x) => x.ack), [false]);
    assert.deepEqual([leaseRow(t.hub, only).status, gate(t.hub).status, probe.kills.length], ["retained", "suspended", 0]);
    // With the start time readable again, the same card flow stops the Hub-tied process (tree-kill) and only then reopens.
    probe.starts[4444] = spawned;
    await t.hub.leaseReconciler.verify(only);
    const c4 = await card(t.hub, owner.session);
    const out = await rearm(t.hub, owner.reauth(), c4, { ackLeases: true });
    assert.equal(out.reopened, true);
    assert.deepEqual(probe.kills, [4444]);
    const rec = events(t.hub, "lease.reconciled").find((e) => e.leaseId === only);
    assert.deepEqual([rec.verdict, rec.evidence.terminated, rec.evidence.tree], ["released", true, "tree-kill"]);
    t.hub.leaseReconciler.terminateOrphan = realTerminate;
    restore();
  } finally { await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ RF-02
test("RF-02 (R1-F2) a crash: the provider's PID is dead but the command it started still writes into the workspace — the lease stays retained at boot and in every sweep; the card releases it only with the acknowledgement", { skip: process.platform !== "win32" ? "Windows only (the kill-on-close semantics are Windows')" : false, timeout: 90000 }, async () => {
  const t = await makeTestHub();
  let hub2 = null;
  let command = null;
  try {
    const owner = await enrolOwner(t);
    // A command a provider started (here: node started by cmd.exe, which stands in for the provider process).
    const script = path.join(t.dataDir, "rf02-command.cjs");
    fs.writeFileSync(script, [
      "const fs = require('fs');", "const file = process.argv[2];", "fs.writeFileSync(file + '.pid', String(process.pid));",
      "setInterval(() => fs.writeFileSync(file, String(Date.now())), 100);", "setTimeout(() => process.exit(0), 60000);"].join("\n"));
    const beat = path.join(t.projectDir, "rf02-heartbeat.txt");
    const provider = spawn("cmd.exe", ["/d", "/c", "node", script, beat], { stdio: "ignore", windowsHide: true });
    const startedAt = new Date().toISOString();
    await waitFor(() => fs.existsSync(`${beat}.pid`), 15000, 100);
    command = Number(fs.readFileSync(`${beat}.pid`, "utf8"));
    // The provider dies the way the Hub's exit ends it (only the Hub's direct children; theirs break away): no tree-kill runs.
    process.kill(provider.pid);
    await waitFor(() => !alive(provider.pid), 10000, 50);
    assert.equal(alive(command), true, "the command it started survived");
    // The crash left the run 'running' with its workspace lease active (no finalize ran).
    const project = t.hub.projects.hub();
    const runId = `run_rf02_${Date.now().toString(36)}`;
    t.hub.db.prepare("INSERT INTO agent_runs (id, provider, status, pid, pid_started_at, started_at, created_at, environment) VALUES (?, 'codex', 'running', ?, ?, ?, ?, 'windows')")
      .run(runId, provider.pid, startedAt, startedAt, startedAt);
    const lease = t.hub.bus.transaction(() => t.hub.leases.acquire({ resource: workspaceResource(project.path), holder: `codex:${runId}`, runId, ttlSeconds: 1800 }));
    await t.hub.close();
    hub2 = createHub(t.config, { homeDir: t.homeDir });
    const report = await hub2.boot(); // the boot pass (system.recovered) sweeps as well
    assert.deepEqual(report.leasesReconciled, [], "nothing released at boot");
    assert.deepEqual(report.leases, [lease.id]);
    assert.equal(leaseRow(hub2, lease.id).status, "retained", "a dead provider PID is no proof that what it started is gone");
    const b1 = fs.readFileSync(beat, "utf8"); await sleep(400); const b2 = fs.readFileSync(beat, "utf8");
    assert.notEqual(b1, b2, "the old command still writes into the workspace — the reason the lease must stay");
    await hub2.leaseReconciler.tick();
    assert.equal(leaseRow(hub2, lease.id).status, "retained", "nor in a scheduler sweep");
    const v = hub2.leaseReconciler.assess(lease.id);
    assert.deepEqual([v.verdict, v.treeUnknown, v.tie, v.evidence.process.why, v.evidence.process.tree], ["unknown", true, null, "pid_not_alive", "unknown"]);
    assert.ok(hub2.leases.current(workspaceResource(project.path)), "the workspace stays reserved: no next writer");
    // The owner's card (after a Stop All on the restarted Hub) lists it as an unknown step and says why; released only with the ack.
    const session = reauthOn(hub2, owner);
    await ownerStop(hub2, session);
    const c = await card(hub2, session);
    const step = c.leases.steps.find((s) => s.leaseId === lease.id);
    assert.deepEqual([step.verdict, step.tie, step.ack, c.leases.ackRequired], ["unknown", null, true, true]);
    assert.match(step.text, new RegExp(`procesul providerului \\(PID ${provider.pid}\\) nu mai rulează, dar nu l-a oprit acest Hub \\(a repornit în timpul execuției\\): comenzile pornite de el \\(teste, servere\\) pot rula încă\\..*fără să opresc vreun proces`));
    await assert.rejects(rearm(hub2, reauthOn(hub2, owner), c), (e) => codeOf(e) === "LEASES_ACK");
    assert.equal(leaseRow(hub2, lease.id).status, "retained");
    const out = await rearm(hub2, reauthOn(hub2, owner), c, { ackLeases: true });
    assert.equal(out.reopened, true);
    const rec = events(hub2, "lease.reconciled").find((e) => e.leaseId === lease.id);
    assert.deepEqual([rec.verdict, rec.evidence.ack, rec.evidence.process.tree], ["acknowledged", true, "unknown"]);
    assert.equal(hub2.runs.getRun(runId).status, "interrupted_unknown", "never relaunched, never marked completed");
  } finally {
    if (command && alive(command)) { try { process.kill(command); } catch { /* gone */ } }
    if (hub2) await hub2.close().catch(() => {});
    await sleep(300);
    try { fs.rmSync(t.dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* left in .ifrim/tmp */ }
  }
});

// ------------------------------------------------------------------------------------------------------------------------------ RF-03
/**
 * The real wsl-runner Codex adapter (providers/codex-wsl.mjs) over a fake environment object (never wsl.exe). The inner provider is a
 * fake that keeps a supervisor record under the run's key while its process lives and forgets it when its turn settles (as
 * providers/codex.mjs does). The gate's decision is forced open for these runs only (the finding is downstream of the gate).
 */
function envRig(t, { exportMs = 10 } = {}) {
  const hub = t.hub;
  const records = new Map();
  const realGet = hub.supervisor.get;
  hub.supervisor.get = (key) => records.get(key) || realGet.call(hub.supervisor, key);
  const rig = { records, marks: [], inners: [], next: null, exportMs };
  const mark = (what) => rig.marks.push([what, Date.now()]);
  const inner = { startTurn: (opts) => {
    const mode = rig.next || {};
    const key = `run-${opts.runId}`;
    const record = { key, pid: null, exited: false };
    records.set(key, record);
    let resolveDone;
    const done = new Promise((r) => { resolveDone = r; });
    const h = { key, pid: null, done, interrupts: [], settled: false };
    h.finish = (result) => { if (h.settled) return; h.settled = true; record.exited = true; records.delete(key); resolveDone(result); };
    h.interrupt = async (reason) => { h.interrupts.push(reason); h.finish({ status: "interrupted", error: `interrupted (${reason})`, output: "", usage: {}, preInference: false }); return { interrupted: true }; };
    setTimeout(() => { mark("turn_sent"); try { opts.onEvent({ type: "phase", phase: "turn_sent" }); } catch { /* */ } }, 20);
    // The model's answer (its turn ends) and the provider process's exit (record forgotten, done resolved) — the latter later when set.
    if (mode.answerAtMs != null) setTimeout(() => { mark("model_answer"); setTimeout(() => h.finish({ status: "completed", output: "Gata: fișierele modificate.", usage: {}, threadId: "th", turnId: "tu", preInference: false }), mode.exitAfterAnswerMs || 0); }, mode.answerAtMs);
    rig.inners.push(h);
    return h;
  } };
  const environment = { simulated: true, codex: inner, env: { id: "wsl-runner", distro: "fake", codex: "codex" },
    inspect: async () => ({ ok: true, fingerprint: { hash: "fp1" } }), state: () => null,
    attestationStatus: () => ({ valid: true, latest: { id: "att_fake", status: "PASS_LOCAL" } }),
    prepareWorkspace: async () => ({ ws: "ws1", stats: {}, repo: "/home/runner/ws1/repo", tmp: "/home/runner/ws1/tmp" }),
    reap: async () => ({ ok: true, remaining: 0 }), inUse: () => [],
    collectExport: async () => { mark("export_started"); await sleep(rig.exportMs); mark("export_validated"); return { ok: true, stats: {}, refused: [], problems: [], changes: [{ path: "src/app.js", status: "modified" }] }; },
    applyExport: () => { mark("export_applied"); return { applied: 1, conflicts: [] }; },
    release: async () => {}, launcher: { inspectConfig: () => ({}) }, probeAccount: async () => ({}) };
  hub.providers["codex@wsl-runner"] = createWslCodexAdapter({ environment });
  const realRoute = hub.environments.routeFor;
  hub.environments.routeFor = () => "wsl-runner";
  const realEval = hub.gate.evaluate;
  hub.gate.evaluate = (args) => { const d = realEval(args); return { ...d, allowed: true, checks: d.checks.map((c) => ({ ...c, ok: true })) }; };
  rig.restore = () => { hub.supervisor.get = realGet; delete hub.providers["codex@wsl-runner"]; hub.environments.routeFor = realRoute; hub.gate.evaluate = realEval; };
  return rig;
}
async function envRun(t, turnTimeoutMs = 800) {
  const project = t.hub.projects.hub();
  const conv = t.hub.bus.transaction(() => t.hub.conversations.create({ projectId: project.id, title: "RF-03" }, "user"));
  t.hub.bus.transaction(() => t.hub.conversations.addMessage({ conversationId: conv.id, role: "user", content: "Repară bug-ul." }, "user"));
  const { run } = await t.hub.runs.start({ conversationId: conv.id, provider: "codex", access: "workspace-write", turnTimeoutMs });
  return waitFor(() => { const r = t.hub.runs.getRun(run.id); return ["completed", "failed", "interrupted", "blocked"].includes(r.status) ? r : null; }, 30000, 20);
}

test("RF-03 (R3-F5) wsl-runner: a writer turn that completed in time is applied even when export validation outlives the deadline; a turn whose process is still ending gets one bounded wait; a hung turn is still cut; turn_settled ends the deadline", async () => {
  const t = await makeTestHub();
  let rig = null;
  try {
    await enableLive(t.hub, { provider: "codex", access: "workspace-write", attempts: 5 });
    rig = envRig(t);
    const timeouts = () => events(t.hub, "run.turn_timeout");
    // (a) The reviewer's case: the answer at ~200 ms (limit 800 ms), export validation 1.5 s → completed, applied, no timeout.
    rig.next = { answerAtMs: 200 }; rig.exportMs = 1500; rig.marks.length = 0;
    const a = await envRun(t);
    const at = (w) => rig.marks.find(([x]) => x === w)?.[1];
    assert.ok(at("export_validated") - at("turn_sent") > 800, "the export validation ran past the turn's limit");
    assert.deepEqual([a.status, a.errorCategory], ["completed", null], a.errorMessage || "");
    assert.equal(a.evidence.environment.apply.applied, 1, "the completed writer's export was applied");
    assert.ok(at("export_applied"), "applied");
    assert.equal(a.evidence.turnTimeout, undefined);
    assert.deepEqual(rig.inners.at(-1).interrupts, [], "the adapter was never interrupted");
    assert.equal(timeouts().length, 0);
    // (b) The model's answer at 780 ms, the provider's process exits 370 ms later (still ending at the deadline): one bounded wait for
    // it, then completed and applied — never a timeout.
    rig.next = { answerAtMs: 780, exitAfterAnswerMs: 370 }; rig.exportMs = 10; rig.marks.length = 0;
    const b = await envRun(t);
    assert.deepEqual([b.status, b.evidence.environment.apply.applied], ["completed", 1], b.errorMessage || "");
    assert.deepEqual(rig.inners.at(-1).interrupts, []);
    assert.equal(timeouts().length, 0);
    // (c) A turn that never ends is still cut: after the limit and the bounded wait, through the adapter's interruption → turn_timeout.
    rig.next = {}; rig.marks.length = 0;
    const started = Date.now();
    const c = await envRun(t);
    assert.deepEqual([c.status, c.errorCategory, c.preInference], ["failed", "turn_timeout", false]);
    assert.deepEqual(rig.inners.at(-1).interrupts, ["turn-timeout"]);
    assert.match(c.evidence.environment.apply.reason, /turn interrupted|oprit înainte de aplicare|carantină/);
    const [ev] = timeouts();
    assert.deepEqual([ev.environment, ev.limitMs, ev.settleGraceMs, ev.turnSent], ["wsl-runner", 800, 800, true]);
    assert.ok(Date.now() - started >= 1500, "limit + the bounded wait");
    // (d) An adapter that reports its provider's turn settled (turn_settled) ends the deadline at once, whatever runs after it.
    rig.restore(); rig = null;
    const records = new Map();
    const realGet = t.hub.supervisor.get;
    t.hub.supervisor.get = (key) => records.get(key) || realGet.call(t.hub.supervisor, key);
    const handles = [];
    t.hub.providers["codex@wsl-runner"] = { id: "codex", environment: "wsl-runner", inspectInstallation: async () => ({ installed: true }), probe: async () => ({}), inspectConfig: () => ({}),
      startTurn: (opts) => {
        const key = `run-${opts.runId}`;
        records.set(key, { key, pid: null, exited: false });
        let resolveDone; const done = new Promise((r) => { resolveDone = r; });
        const h = { key, pid: null, done, interrupts: [], interrupt: async (reason) => { h.interrupts.push(reason); records.delete(key); resolveDone({ status: "interrupted", error: `interrupted (${reason})`, output: "", usage: {}, preInference: false, environment: { reap: { ok: true } } }); return { interrupted: true }; } };
        setTimeout(() => opts.onEvent({ type: "phase", phase: "turn_sent" }), 20);
        setTimeout(() => opts.onEvent({ type: "turn_settled" }), 150);
        setTimeout(() => { records.delete(key); resolveDone({ status: "completed", output: "Gata.", usage: {}, preInference: false, environment: { reap: { ok: true } } }); }, 2400);
        handles.push(h);
        return h;
      } };
    const realRoute = t.hub.environments.routeFor;
    t.hub.environments.routeFor = () => "wsl-runner";
    const realEval = t.hub.gate.evaluate;
    t.hub.gate.evaluate = (args) => { const dd = realEval(args); return { ...dd, allowed: true, checks: dd.checks.map((x) => ({ ...x, ok: true })) }; };
    try {
      const d = await envRun(t);
      assert.deepEqual([d.status, handles.at(-1).interrupts], ["completed", []]);
      assert.equal(timeouts().length, 1, "no new timeout");
    } finally { t.hub.supervisor.get = realGet; t.hub.environments.routeFor = realRoute; t.hub.gate.evaluate = realEval; delete t.hub.providers["codex@wsl-runner"]; }
  } finally { if (rig) rig.restore(); await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ RF-04/05
const MODELS = { writerModel: "gpt-fake-sol", reviewerModel: "sonnet" };
const SCALE = 2000 / (25 * 60000);
function testClock() { const offset = { ms: 0 }; return { offset, now: () => new Date(Date.now() + offset.ms), advance: (ms) => { offset.ms += ms; } }; }
async function factoryHub({ clock = null } = {}) {
  const t = await makeTestHub({ queues: true, ...(clock ? { clock: clock.now } : {}) });
  await enableLive(t.hub, { provider: "codex", access: "workspace-write", attempts: 1 });
  const dir = path.join(t.dataDir, "factory-bug-demo");
  materializeFixture("bug-demo", dir);
  const project = (await dispatch(t.hub, "project.register_test", { path: dir })).result;
  let writerGrant;
  t.hub.bus.transaction(() => {
    writerGrant = t.hub.grants.create({ provider: "codex", projectId: project.id, access: "workspace-write", maxAttempts: 5, maxDurationS: 900, ttlMinutes: 480 }, "test");
    t.hub.grants.create({ provider: "claude", projectId: project.id, access: "read-only", maxAttempts: 5, maxDurationS: 900, ttlMinutes: 480 }, "test");
  });
  return { ...t, project, dir, clock, writerGrant };
}
async function approveAndStart(t, missionId) {
  const requested = await dispatch(t.hub, "factory.start", t.hub.factory.view(missionId).scope);
  await dispatch(t.hub, "approval.decide", { approvalId: requested.approval.id, decision: "approved", displayedHash: requested.approval.payloadHash });
  return t.hub.commands.executeApproved(requested.command.id, "user");
}
const view = (t, id) => t.hub.factory.view(id);
const writes = (t, id) => view(t, id).dispatches.filter((d) => d.stage === "IMPLEMENTING");
const idle = (t, id, ms = 30000) => Promise.race([t.hub.factory.idle(id), new Promise((_, reject) => setTimeout(() => reject(new Error("factory.idle() did not settle")), ms).unref())]);

test("RF-04 (R3-F3) maxAttemptsPerStage 3: ONE automatic re-dispatch per step; the second timeout of the same step waits for the owner with an honest reason; the owner's resume gives the last attempt", async () => {
  const clock = testClock();
  const t = await factoryHub({ clock });
  try {
    t.hub.factory.setTurnTimeScaleForTests(SCALE);
    const mission = (await dispatch(t.hub, "factory.prepare", { projectId: t.project.id, ...demoSpec("bug-demo"), limits: { ...MODELS, maxAttemptsPerStage: 3 } })).result.mission;
    t.queue("codex", "hang", "hang", "hang");
    await approveAndStart(t, mission.id);
    const first = await waitFor(() => (view(t, mission.id).factory.waitReason === "retry" ? view(t, mission.id) : null), 60000, 30);
    assert.match(first.factory.stageReason, /\(încercarea 1 din 3\); o reiau o singură dată peste 60 s/);
    clock.advance(61000); await t.hub.factory.tick(); await idle(t, mission.id);
    // The re-dispatched turn hangs too: its own timeout → the owner decides (no second automatic re-dispatch).
    const after = await waitFor(() => { const v = view(t, mission.id); return v.factory.stage === "NEEDS_OWNER_DECISION" || (v.factory.waitReason === "retry" && v.turnRetry?.attempt === 2) ? v : null; }, 60000, 30);
    assert.equal(after.factory.stage, "NEEDS_OWNER_DECISION", `a second automatic retry was scheduled: ${after.factory.stageReason}`);
    assert.equal(after.factory.stageReason, "Etapa IMPLEMENTING (writer) a depășit limita de 25 min pe tură (încercarea 2 din 3); am reluat-o deja automat o dată, așa că nu o mai reiau singur — decide dacă o reiei (în limita confirmată mai e o încercare)");
    const retries = events(t.hub, "factory.turn_retry").filter((e) => e._scope === mission.id);
    assert.equal(retries.length, 1);
    assert.deepEqual([retries[0].stage, retries[0].cycle, retries[0].changeSeq], ["IMPLEMENTING", 0, writes(t, mission.id)[0].request.changeSeq]);
    const last = events(t.hub, "factory.turn_timeout").filter((e) => e._scope === mission.id).at(-1);
    assert.deepEqual([last.retry, last.autoRetryUsed, last.attempt, last.limit], [false, true, 2, 3]);
    for (let i = 0; i < 3; i++) { clock.advance(61000); await t.hub.factory.tick(); await idle(t, mission.id); }
    assert.deepEqual(writes(t, mission.id).map((d) => [d.request.counted, d.status]), [[1, "FAILED"], [2, "FAILED"]], "nothing more without the owner");
    // The owner's resume: the last confirmed attempt (counted 3), no extra attempt granted.
    await dispatch(t.hub, "factory.resume", { missionId: mission.id }, "ui");
    const third = await waitFor(() => writes(t, mission.id)[2] || null, 30000, 30);
    assert.deepEqual([third.request.attempt, third.request.counted], [3, 3]);
    assert.equal(events(t.hub, "factory.extra_attempt").length, 0);
    await dispatch(t.hub, "factory.stop", { missionId: mission.id }, "ui");
  } finally { await t.cleanup(); }
});

/** R3's fake adapter, reduced: a turn that hangs; its interruption settles `interruptDelayMs` later; a fake supervisor record. */
function slowInterruptAdapter(t, interruptDelayMs) {
  const hub = t.hub;
  const adapter = hub.providers.codex;
  const realStart = adapter.startTurn; const realGet = hub.supervisor.get; const realStop = hub.supervisor.stop;
  const records = new Map(); const handles = [];
  hub.supervisor.get = (key) => records.get(key) || realGet.call(hub.supervisor, key);
  hub.supervisor.stop = async (key, o) => { const r = records.get(key); if (!r) return realStop.call(hub.supervisor, key, o); r.exited = true; return { stopped: true }; };
  adapter.startTurn = (opts) => {
    const key = `run-${opts.runId}`; const record = { key, pid: null, exited: false }; records.set(key, record);
    let resolveDone; const done = new Promise((r) => { resolveDone = r; });
    const handle = { key, pid: null, done, interrupts: [], settled: false,
      settle(result) { if (handle.settled) return; handle.settled = true; record.exited = true; resolveDone(result); },
      async interrupt(reason) { handle.interrupts.push(reason); setTimeout(() => handle.settle({ status: "interrupted", error: `interrupted (${reason})`, output: "", usage: {}, preInference: false }), interruptDelayMs); return { interrupted: true }; } };
    handles.push(handle);
    setTimeout(() => { try { opts.onEvent({ type: "phase", phase: "turn_sent" }); } catch { /* */ } }, 20);
    return handle;
  };
  return { handles, restore: () => { adapter.startTurn = realStart; hub.supervisor.get = realGet; hub.supervisor.stop = realStop; } };
}

test("RF-05 (R3-F4) a Pause landing while the deadline's interruption settles: the factory counts the timed-out attempt like the run and the grant do (FAILED), schedules no retry; the resumed step is the next attempt", async () => {
  const t = await factoryHub();
  const fake = slowInterruptAdapter(t, 1500);
  try {
    t.hub.factory.setTurnTimeScaleForTests(SCALE);
    const mission = (await dispatch(t.hub, "factory.prepare", { projectId: t.project.id, ...demoSpec("bug-demo"), limits: { ...MODELS, maxAttemptsPerStage: 2 } })).result.mission;
    await approveAndStart(t, mission.id);
    await waitFor(() => (t.hub.db.prepare("SELECT 1 FROM events WHERE type = 'run.turn_timeout'").get() ? true : null), 60000, 10);
    await dispatch(t.hub, "factory.pause", { missionId: mission.id }, "ui");
    await waitFor(() => (t.hub.runs.activeRuns().length === 0 && view(t, mission.id).factory.stage === "PAUSED" ? true : null), 20000, 20);
    await idle(t, mission.id);
    const [d] = writes(t, mission.id);
    const run = t.hub.runs.getRun(d.runId);
    assert.deepEqual([run.status, run.errorCategory, run.preInference, Boolean(run.timeline.turn_sent)], ["failed", "turn_timeout", false, true]);
    assert.deepEqual(fake.handles[0].interrupts, ["turn-timeout", "factory-pause"]);
    assert.equal(d.status, "FAILED", "the factory counts it as the attempt it was");
    assert.match(d.error, /^turn_timeout: limita de 25 min pe tură, depășită înainte de oprirea ta \(încercarea se numără\)$/);
    assert.equal(t.hub.grants.get(t.writerGrant.id).attemptsUsed, 1);
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'grant.refunded' AND scope_id = ?").get(t.writerGrant.id).n, 0, "never refunded or forgiven");
    const late = events(t.hub, "factory.late_result").filter((e) => e._scope === mission.id).at(-1);
    assert.deepEqual([late.errorCategory, late.counted], ["turn_timeout", true]);
    assert.equal(events(t.hub, "factory.turn_timeout").filter((e) => e._scope === mission.id && e.retry).length, 0, "no automatic retry while paused");
    assert.equal(view(t, mission.id).factory.stage, "PAUSED");
    await dispatch(t.hub, "factory.resume", { missionId: mission.id }, "ui");
    const second = await waitFor(() => writes(t, mission.id)[1] || null, 30000, 20);
    assert.deepEqual([second.request.attempt, second.request.counted], [2, 2], "the resumed step is the second (last) attempt, as the run and the grant say");
    await dispatch(t.hub, "factory.stop", { missionId: mission.id }, "ui");
  } finally { fake.restore(); await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ RF-06 … RF-10
const SOURCES = ["typed", "voice-local", "voice-provider"];
const ctx = (source) => ({ projects: [{ id: "pd", name: "ProDelivery", slug: "prodelivery" }], currentProjectId: "pd", source });
const intents = (mod, text, source = "typed") => mod.resolveIntent(text, ctx(source)).steps;
const stops = (mod, text, source = "typed") => intents(mod, text, source).some((s) => s.intent === "stop_all");
const moodOf = (mod, text) => { const s = intents(mod, text).find((x) => x.intent === "explain_stop"); return s ? `${s.args.mood}/${s.args.about}` : intents(mod, text).map((x) => x.intent).join(","); };

const INTENTS_PATH = fileURLToPath(new URL("../server/owner/intents.mjs", import.meta.url));
const EFFECT_CLASS_URL = pathToFileURL(fileURLToPath(new URL("../server/policy/effect-class.mjs", import.meta.url))).href;
let mutationN = 0;
/** A copy of intents.mjs with ONE guard broken (the repository file is never touched), its relative import pointed at the real file. */
async function intentsWith(find, replace, ...more) {
  const src = fs.readFileSync(INTENTS_PATH, "utf8");
  let changed = src;
  for (const [f, r] of [[find, replace], ...more]) {
    assert.ok(changed.includes(f), `the mutation must apply: ${f.slice(0, 100)}`);
    changed = changed.replace(f, r);
  }
  changed = changed.replace('from "../policy/effect-class.mjs"', `from ${JSON.stringify(EFFECT_CLASS_URL)}`).replace('from "./typos.mjs"', 'from ' + JSON.stringify(new URL("../server/owner/typos.mjs", import.meta.url).href));
  const tmp = path.join(os.tmpdir(), `ifrim-rf-mut-${process.pid}-${mutationN++}.mjs`);
  fs.writeFileSync(tmp, changed);
  try { return await import(pathToFileURL(tmp).href); } finally { fs.rmSync(tmp, { force: true }); }
}
const REAL = { resolveIntent };

/** Through owner.intent (the owner session typed, and a provider transcript on the voice channel): how many Stop Alls / pauses each sentence made. */
async function throughIntake(t, owner, text) {
  const out = [];
  for (const via of ["owner", "voice"]) {
    if (gate(t.hub).status !== "open") t.hub.bus.transaction(() => t.hub.settings.set("executionGate", { status: "open", reason: "test", changedAt: new Date().toISOString(), changedBy: "test" }, "test"));
    const before = t.hub.db.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'system.stop_all'").get().n;
    const r = (await t.hub.commands.dispatch(via === "owner"
      ? { type: "owner.intent", channel: "owner", actor: `owner:${owner.session.id}`, ownerSession: owner.session, payload: { text } }
      : { type: "owner.intent", channel: "voice", actor: "voice", payload: { text } })).result;
    out.push({ via, stops: t.hub.db.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'system.stop_all'").get().n - before, gate: gate(t.hub).status, intents: (r.results || []).map((x) => x.intent) });
  }
  return out;
}

test("RF-06 (R2-F1) a condition holds the stop only when it directly follows the command: „până când”, „chiar / indiferent dacă”, „dacă tot”, „când poți”, a past event and a later clause with its own verb never do", async () => {
  const STOP = ["Oprește tot până când verific eu", "Oprește tot până când mă uit pe loguri", "Oprește tot până verific eu", "Oprește tot, indiferent dacă termină testul",
    "Oprește tot chiar dacă pierd munca", "Oprește tot imediat ce poți", "Oprește tot când poți", "Când poți, oprește tot", "Oprește tot, a dat eroare când a rulat testele",
    "Oprește tot, după ce am văzut logurile nu mai am încredere", "După ce am văzut logurile, oprește tot", "Oprește tot și când se termină anunță-mă", "Oprește tot, dacă tot nu merge",
    "Oprește tot ce a pornit după ce am plecat", "Până când verific eu, oprește tot"];
  const HELD = { "Oprește tot dacă pică testele": "conditional", "Oprește tot, doar dacă pică testele": "conditional", "Oprește tot în caz că pică testele": "conditional",
    "Oprește tot imediat ce termini testul": "conditional", "Imediat ce termini, oprește tot": "conditional", "Oprește tot după ce termini testul": "conditional",
    "Dacă pică testele, oprește tot": "conditional", "Ce se întâmplă dacă pică testele, oprește tot": "conditional", "Oprește tot te rog dacă pică testele": "conditional" };
  for (const source of SOURCES) {
    for (const text of STOP) assert.equal(stops(REAL, text, source), true, `${source}: ${text} → ${moodOf(REAL, text)}`);
    for (const [text, mood] of Object.entries(HELD)) { assert.equal(stops(REAL, text, source), false, `${source}: ${text}`); assert.equal(moodOf(REAL, text), `${mood}/stop_all`, text); }
  }
  // The same rule for the pause and a named worker (the trailing condition is anchored for every interruption).
  assert.deepEqual(intents(REAL, "Lega, pune totul pe pauză chiar dacă pierd munca").map((s) => s.intent), ["pause"]);
  assert.deepEqual(intents(REAL, "Lega, pune totul pe pauză când termini").map((s) => [s.intent, s.args.mood]), [["explain_stop", "conditional"]]);
  assert.deepEqual(intents(REAL, "Oprește Codex dacă se blochează").map((s) => [s.intent, s.args.mood]), [["explain_stop", "conditional"]]);
  // Mutation checks: each new guard, broken alone, brings the hold back for its phrase.
  // („chiar dacă” after the command is already free by the anchoring; NOT_COND matters for „dacă tot” after it and for a lead-in.)
  const noNotCond = await intentsWith("const r = softTrim(String(tail || \"\").replace(NOT_COND, \" \"));", "const r = softTrim(String(tail || \"\"));");
  assert.equal(stops(noNotCond, "Oprește tot, dacă tot nu merge"), false, "without NOT_COND „dacă tot” holds the stop");
  const noNotCondLead = await intentsWith("const hasCond = (s) => COND_ANY.test(String(s || \"\").replace(NOT_COND, \" \"));", "const hasCond = (s) => COND_ANY.test(String(s || \"\"));");
  assert.equal(stops(noNotCondLead, "Până când verific eu, oprește tot"), false, "without NOT_COND „până când” leading into the command holds it");
  const noPast = await intentsWith("return STOP_COND_LEAD.test(r) && !PAST_EVENT.test(r);", "return STOP_COND_LEAD.test(r);");
  assert.equal(stops(noPast, "Oprește tot, după ce am văzut logurile nu mai am încredere"), false, "without PAST_EVENT a past event holds the stop");
  const unanchored = await intentsWith("return STOP_COND_LEAD.test(r) && !PAST_EVENT.test(r);", "return COND_ANY.test(r) && !PAST_EVENT.test(r);");
  assert.equal(stops(unanchored, "Oprește tot, a dat eroare când a rulat testele"), false, "a condition word anywhere holds the stop again (the live defect)");
  // „când poți” is a polite word in both lists (the clause's tail, and the lead of what follows the command): broken together, it is
  // read as a condition again; each alone is masked by the other.
  const noPolite = await intentsWith("|daca nu te superi|cand poti|cand puteti|imediat ce poti|imediat ce puteti)$/;", "|daca nu te superi)$/;",
    ["|mai bine|cand poti|cand puteti|cat poti de repede|", "|mai bine|cat poti de repede|"]);
  assert.equal(stops(noPolite, "Oprește tot când poți"), false, "without the polite „când poți” it is read as a condition");
});

test("RF-07 (R2-F2) a „?” belongs to the chained clause it closes: „Oprește tot și arată-mi ce s-a executat?” stops, then answers — typed, as a transcript and through owner.intent; a question about the stop itself still asks", async () => {
  const CHAINED = { "Oprește tot și arată-mi ce s-a executat?": ["stop_all", "last_run"], "Oprește tot și arată-mi testele?": ["stop_all", "show_tests"],
    "Oprește tot și deschide ProDelivery?": ["stop_all", "open_project"], "Oprește tot și spune-mi de ce a picat?": ["stop_all", "replay"] };
  for (const source of SOURCES) for (const [text, want] of Object.entries(CHAINED)) assert.deepEqual(intents(REAL, text, source).map((s) => s.intent), want, `${source}: ${text}`);
  // The „?” of a question about the stop itself stays a question; a modal opener keeps the whole sentence a question.
  assert.deepEqual(intents(REAL, "Oprește tot? Și arată-mi testele").map((s) => [s.intent, s.args.mood]).slice(0, 1), [["explain_stop", "ask"]]);
  assert.equal(stops(REAL, "Poți să oprești tot și să-mi arăți testele?"), false);
  assert.equal(stops(REAL, "Oprești tot și îmi arăți testele?"), false);
  // D20 is unchanged: a „?” anywhere still holds „Continuă”.
  assert.ok(intents(REAL, "Continuă și arată-mi testele?").every((s) => s.intent !== "ops_continue"));
  // Through the intake: one real Stop All, and the read answered.
  const t = await makeTestHub();
  try {
    await prepareLiveWithoutGrants(t.hub);
    const owner = await enrolOwner(t);
    for (const r of await throughIntake(t, owner, "Oprește tot și arată-mi ce s-a executat?")) {
      assert.deepEqual([r.stops, r.gate, r.intents], [1, "suspended", ["stop_all", "last_run"]], JSON.stringify(r));
    }
  } finally { await t.cleanup(); }
  const copyAsks = await intentsWith("subs.forEach((text, j) => clauses.push({ text, asks: asks && j === subs.length - 1 }));", "subs.forEach((text) => clauses.push({ text, asks }));");
  assert.equal(stops(copyAsks, "Oprește tot și arată-mi ce s-a executat?"), false, "with the „?” copied onto every chained clause the stop is held again");
});

test("RF-08 (R2-F3) the command first, then a tag or a question of its own; an exclamation or a bare repeated lead-in before it — the stop (the review's safe direction, pending the owner's confirmation); a question about the command, an indicative verb and a report still never stop", async () => {
  const STOP = ["Oprește tot, ce faci?", "Oprește tot, ce naiba faci?", "Oprește tot, da?", "Oprește tot, ok?", "Oprește tot, nu?", "Oprește tot, m-ai auzit?", "Te rog, oprește tot, ce aștepți?",
    "Ce naiba faci, oprește tot!", "Ce faci acolo, oprește tot", "Ce se întâmplă aici, oprește tot!", "Ți-am zis, oprește tot!", "Cum ți-am spus, oprește tot", "Am zis oprește tot!",
    "Nu, ți-am zis, oprește tot", "V-am spus deja, opriți tot"];
  const NOT = { "Oprește tot?": "ask/stop_all", "Oprește tot, ce înseamnă?": "ask/stop_all", "Oprește tot, ce face?": "ask/stop_all", "Oprește tot, ce se întâmplă după?": "ask/stop_all",
    "Oprești tot, da?": "ask/stop_all", "Poți să oprești tot, da?": "ask/stop_all", "Ce urmează, oprește tot": "question/stop_all", "Ieri am zis, oprește tot": "reported/stop_all",
    "Am zis oprește tot din greșeală": "reported/stop_all", "Ți-am zis ieri să oprești tot": "reported/stop_all", "Mai devreme am zis oprește tot": "reported/stop_all" };
  for (const source of SOURCES) {
    for (const text of STOP) assert.equal(stops(REAL, text, source), true, `${source}: ${text} → ${moodOf(REAL, text)}`);
    for (const [text, mood] of Object.entries(NOT)) { assert.equal(stops(REAL, text, source), false, `${source}: ${text}`); assert.equal(moodOf(REAL, text), mood, text); }
  }
  // The voice fast path never takes a „?” (TALK_MARKS): such a command reaches the Stop through the bridge's intake — checked end to end.
  assert.equal(parseVoiceCommand("Oprește tot, da?", { legaPrefix: true }).kind, "message");
  const t = await makeTestHub();
  try {
    await prepareLiveWithoutGrants(t.hub);
    const owner = await enrolOwner(t);
    for (const text of ["Oprește tot, ce faci?", "Ți-am zis, oprește tot!"]) for (const r of await throughIntake(t, owner, text)) assert.deepEqual([r.stops, r.gate], [1, "suspended"], `${text} ${JSON.stringify(r)}`);
  } finally { await t.cleanup(); }
  const noTag = await intentsWith("if (at === 0 && asks && !modal && !conjugated && !MODAL_ASK.test(s)) {", "if (false) {");
  assert.equal(stops(noTag, "Oprește tot, da?"), false, "without the tag rule a tag question holds the stop (the live defect)");
  const noConjugated = await intentsWith("if (at === 0 && asks && !modal && !conjugated && !MODAL_ASK.test(s)) {", "if (at === 0 && asks && !modal && !MODAL_ASK.test(s)) {");
  assert.equal(stops(noConjugated, "Oprești tot, da?"), true, "without the indicative check „Oprești tot, da?” would stop");
  const noAbout = await intentsWith("!later.some((p) => ABOUT_IT.test(softTrim(p)) || STOP_MENTION.test(p))", "true");
  assert.equal(stops(noAbout, "Oprește tot, ce înseamnă?"), true, "without ABOUT_IT a question about the command would stop");
  const exactExclamation = await intentsWith("&& !EXCLAMATION_LEAD.test(x.soft) && !BARE_REPEAT.test(x.soft))) return \"question\";", "&& !EXCLAMATION.test(x.soft) && !BARE_REPEAT.test(x.soft))) return \"question\";");
  assert.equal(stops(exactExclamation, "Ce naiba faci, oprește tot!"), false, "an exact-match exclamation holds „Ce naiba faci, …” again");
  const noRepeat = await intentsWith("if (REPEAT_LEAD.test(s) && !REPORTED_CONTEXT.test(s)) {", "if (false) {");
  assert.equal(stops(noRepeat, "Am zis oprește tot!"), false, "without the repeated lead-in „Am zis oprește tot!” is a report");
  const noBare = await intentsWith("if (before.some((x) => REPORTED.test(x.soft) && !BARE_REPEAT.test(x.soft))) return \"reported\";", "if (before.some((x) => REPORTED.test(x.soft))) return \"reported\";");
  assert.equal(stops(noBare, "Nu, ți-am zis, oprește tot"), false, "a bare „ți-am zis,” before the command counts as a report again");
});

test("RF-09 (R2-F4) a leading interjection without its comma still stops; the command behind a subject or a frame stays a mention", async () => {
  const STOP = ["Te rog mult oprește tot", "Chiar acum oprește tot", "Lega ascultă oprește tot", "Băi oprește tot", "Măi Lega oprește tot", "Bun oprește tot", "Și acum oprește tot",
    "Destul oprește tot", "Doamne oprește tot", "Hai repede oprește tot", "Bre oprește tot", "Băi oprește tot ce rulează"];
  const MENTION = ["Butonul oprește tot", "Claude opreste tot", "Hub-ul oprește tot", "Scriptul ăsta oprește tot", "Fă un clip în care Lega oprește tot", "La secunda 5 oprește tot sunetul",
    "Codex oprește tot ce face?", "Bre oprește tot sunetul"];
  for (const source of SOURCES) {
    for (const text of STOP) assert.equal(stops(REAL, text, source), true, `${source}: ${text} → ${moodOf(REAL, text)}`);
    for (const text of MENTION) assert.equal(stops(REAL, text, source), false, `${source}: ${text}`);
  }
  assert.equal(moodOf(REAL, "Butonul oprește tot"), "mention/stop_all");
  const t = await makeTestHub();
  try {
    await prepareLiveWithoutGrants(t.hub);
    const owner = await enrolOwner(t);
    for (const r of await throughIntake(t, owner, "Te rog mult oprește tot")) assert.deepEqual([r.stops, r.gate], [1, "suspended"], JSON.stringify(r));
  } finally { await t.cleanup(); }
  const noFallback = await intentsWith("if (lead && !SUBJECT_OR_FRAME.test(lead) && (!tail || /^ce\\b/.test(tail)) && !PREDICATE.test(tail)) return \"imperative\";", "");
  assert.equal(stops(noFallback, "Bre oprește tot"), false, "without the fallback an unknown interjection makes the stop a mention (the live defect)");
  const subjectsIgnored = await intentsWith("if (lead && !SUBJECT_OR_FRAME.test(lead) &&", "if (lead &&");
  assert.equal(stops(subjectsIgnored, "Butonul oprește tot"), true, "without the subject check a mention would stop");
  const noDestul = await intentsWith("|gata|destul|stai|", "|gata|stai|");
  assert.equal(stops(noDestul, "Destul oprește tot"), false, "„destul” reads like a noun subject unless it is a known interjection");
  // „Măi / Băi Lega” as an address: without it the command is no longer the sentence's first part, so a tag question holds it again
  // (comma-less, the fallback reads „Lega” at the end of the lead as the address anyway).
  assert.equal(stops(REAL, "Măi Lega, oprește tot, da?"), true);
  const noAddress = await intentsWith("(?:(?:hei|hey|buna|alo|bai|mai) )?lega|", "(?:(?:hei|hey|buna|alo) )?lega|");
  assert.equal(stops(noAddress, "Măi Lega, oprește tot, da?"), false, "without „măi Lega” as an address the command is not the first part");
});

test("RF-10 (R2-F5) the command's name in a statement („Stop All-ul nu merge”, „Oprește tot n-a eliberat lease-urile”, „Pauza de masă e la 12”) never stops or pauses — resolver and intake; the commands still do", async () => {
  const NOUN = { "Stop All-ul nu merge": null, "Stop all-ul de ieri a lăsat lease-uri": "reported/stop_all", "Stop All e butonul roșu": "mention/stop_all", "Stop All e în bara de sus": "mention/stop_all",
    "Oprește tot nu a mers ieri": "reported/stop_all", "Oprește tot n-a eliberat lease-urile": "mention/stop_all", "Oprește tot e butonul roșu din bara de sus": "mention/stop_all",
    "Stop All-ul a oprit și Lega": "mention/stop_all", "Stop all a mers bine ieri": "reported/stop_all", "Oprește tot a funcționat azi dimineață": "reported/stop_all" };
  const pauses = (mod, text, source) => intents(mod, text, source).some((s) => s.intent === "pause");
  for (const source of SOURCES) {
    for (const [text, mood] of Object.entries(NOUN)) {
      assert.equal(stops(REAL, text, source), false, `${source}: ${text}`);
      if (mood) assert.equal(moodOf(REAL, text), mood, text);
    }
    for (const text of ["Pauza de masă e la 12", "Pauza a fost bună", "Pauza mea de ieri a fost lungă"]) assert.equal(pauses(REAL, text, source), false, `${source}: ${text}`);
    for (const text of ["Pauză", "Pauză acum", "Pauză, te rog", "Lega, pauză la tot", "Pune totul pe pauză"]) assert.deepEqual(intents(REAL, text, source).map((s) => s.intent), ["pause"], `${source}: ${text}`);
    for (const text of ["Oprește tot", "Stop all", "Oprește tot e urgent", "Oprește tot nu mai vreau nimic", "Oprește tot ce rulează"]) assert.equal(stops(REAL, text, source), true, `${source}: ${text}`);
  }
  for (const text of Object.keys(NOUN)) assert.notEqual(parseVoiceCommand(text, { legaPrefix: true }).command, "stop_all", text);
  assert.notEqual(parseVoiceCommand("Pauza de masă e la 12", { legaPrefix: true }).command, "pause");
  const t = await makeTestHub();
  try {
    await prepareLiveWithoutGrants(t.hub);
    const owner = await enrolOwner(t);
    for (const text of ["Stop All-ul nu merge", "Oprește tot n-a eliberat lease-urile", "Pauza de masă e la 12"]) {
      for (const r of await throughIntake(t, owner, text)) assert.deepEqual([r.stops, r.gate], [0, "open"], `${text} ${JSON.stringify(r)}`);
    }
  } finally { await t.cleanup(); }
  assert.equal(interruptMood("stop all-ul nu merge"), "mention");
  // The article guard in STOP_START and the „-ul” alternative of PREDICATE overlap (defence in depth): broken together, the live defect
  // is back; each alone is masked by the other.
  const src = fs.readFileSync(INTENTS_PATH, "utf8");
  const startGuard = "|stop[ -]?all\\b(?!-?ul\\b))`);\n/** The same command anywhere";
  assert.ok(src.includes(startGuard) && src.includes("const PREDICATE = /^(?:-?ul\\b|"));
  const noArticleGuard = await intentsWith(startGuard, "|stop[ -]?all\\b)`);\n/** The same command anywhere");
  assert.equal(stops(noArticleGuard, "Stop All-ul nu merge"), false, "the predicate's „-ul” still holds it");
  const noArticleEither = await (async () => {
    const changed = src.replace(startGuard, "|stop[ -]?all\\b)`);\n/** The same command anywhere").replace("const PREDICATE = /^(?:-?ul\\b|", "const PREDICATE = /^(?:")
      .replace('from "../policy/effect-class.mjs"', `from ${JSON.stringify(EFFECT_CLASS_URL)}`).replace('from "./typos.mjs"', 'from ' + JSON.stringify(new URL("../server/owner/typos.mjs", import.meta.url).href));
    const tmp = path.join(os.tmpdir(), `ifrim-rf-mut-${process.pid}-${mutationN++}.mjs`);
    fs.writeFileSync(tmp, changed);
    try { return await import(pathToFileURL(tmp).href); } finally { fs.rmSync(tmp, { force: true }); }
  })();
  assert.equal(stops(noArticleEither, "Stop All-ul nu merge"), true, "without both article guards „Stop All-ul …” is the command again (the live defect)");
  const noPredicate = await intentsWith("if (restSame && PREDICATE.test(restSame)) return REPORTED_CONTEXT.test(restSame) ? \"reported\" : \"mention\";", "");
  assert.equal(stops(noPredicate, "Oprește tot n-a eliberat lease-urile"), true, "without the predicate check a report about the command stops everything");
  const widePause = await intentsWith("start: /^(?:(?:pauza|pause)(?: (?:acum|imediat|la tot|tot|totul|te rog))?$|", "start: /^(?:(?:pauza|pause)\\b|");
  assert.equal(pauses(widePause, "Pauza de masă e la 12", "typed"), true, "a „Pauză …” prefix pauses the Hub again");
});
