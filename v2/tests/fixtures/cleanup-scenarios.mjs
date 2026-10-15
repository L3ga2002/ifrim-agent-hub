// Intentionally failing/cancelled node:test subprocesses. Parent asserts their exact failure types and observer evidence.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as helpers from "../helpers.mjs";
import { buildEngineeringSpec } from "../../server/owner/planners/engineering.mjs";
import { createHub } from "../../server/hub.mjs";

const { makeTestHub, enableLive, waitFor, FIXTURES } = helpers;
assert.equal(typeof helpers.registerCleanupGuard, "function", "shutdown API missing: registerCleanupGuard");
helpers.registerCleanupGuard();
const mode = process.env.HUB_CLEANUP_CASE;
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const problems = [];
const uncaught = (e) => problems.push(String(e?.message || e));
process.on("uncaughtExceptionMonitor", uncaught);
process.on("unhandledRejection", uncaught);
let hubSnapshots = [];
const h = await makeTestHub({ configOverrides: { providerBinaries: {
  // RT-3b uses deterministic snapshot seams, within the fixture's actual 30 s lifetime.
  claude: { executable: process.execPath, prefixArgs: [path.join(FIXTURES, "cleanup-bounded.mjs"), "--life=30000"] },
  codex: { executable: process.execPath, prefixArgs: [path.join(FIXTURES, "fake-codex.mjs")] },
} }, hubOptions: mode === "RT-3b" ? { supervisorOptions: {
  treeKill: async () => { throw Object.assign(new Error("injected taskkill failure"), { code: "TEST_KILL" }); },
  killHandle: () => false,
  // Native PID/CreationDate verification is exercised separately by the native-tree tests.
  snapshot: async () => { const rows = child.exited ? [] : [{ pid: child.pid, parentPid: process.pid, creationDate: child.startedAt, name: "node.exe" }]; hubSnapshots.push(rows); return rows; },
} } : {} });
const hub = h.hub;
let modelStarts = 0;
for (const provider of Object.values(hub.providers)) {
  const startTurn = provider.startTurn;
  if (startTurn) provider.startTurn = (...args) => { modelStarts++; return startTurn(...args); };
}
assert.equal(typeof hub.runs.close, "function", "shutdown API missing: runs.close");
assert.equal(typeof hub.supervisor.close, "function", "shutdown API missing: supervisor.close");
const dispatch = (type, payload) => hub.commands.dispatch({ type, payload, channel: "test", actor: "test" });
await enableLive(hub, { access: "workspace-write" });
const dir = path.join(h.dataDir, "cleanup-project");
fs.cpSync(path.join(FIXTURES, "r-priv-booking"), dir, { recursive: true, filter: (s) => path.basename(s) !== "SOURCE.md" });
fs.writeFileSync(path.join(dir, ".ifrim-hub-test.json"), JSON.stringify({ createdBy: "ifrim-agent-hub", purpose: "live-validation", fixture: "booking-demo", data: "synthetic", name: "cleanup" }));
const project = (await dispatch("project.register_test", { path: dir })).result;
const grant = hub.bus.transaction(() => hub.grants.create({ provider: "claude", projectId: project.id, access: "read-only", maxAttempts: 5, maxDurationS: 7200, ttlMinutes: 240 }, "test"));
const built = buildEngineeringSpec({ text: "Telefonul rămâne obligatoriu și salvat corect, dar lista publică a zilei nu afișează și nu transmite telefonul. Programările valide și fluxurile existente continuă să funcționeze", project });
const mission = (await dispatch("factory.prepare", { projectId: project.id, ...built.input,
  limits: { writerModel: "gpt-fake-sol", writerEffort: "medium", reviewerModel: "sonnet", reviewerEffort: "medium", maxAttemptsPerStage: 1 } })).result.mission;
const held = deferred(), release = deferred();
const backup = hub.backups.run;
hub.backups.run = async (...args) => { const result = await backup(...args); held.resolve(); if (mode !== "RT-3b") await release.promise; return result; };
let closing = false, lateStarts = 0, proof = null, child = null, identity = null;
const originalStart = hub.supervisor.start;
hub.supervisor.start = (input) => { const record = originalStart(input); if (closing) lateStarts++; if (input.key.startsWith("run-")) child = record; return record; };
const originalFactoryClose = hub.factory.close;
hub.factory.close = () => { release.resolve(); return originalFactoryClose(); };
const originalDbClose = hub.db.close.bind(hub.db);
hub.db.close = () => {
  proof = { dispatches: hub.factory.view(mission.id).dispatches, runs: hub.runs.listRuns(), leases: hub.db.prepare("SELECT status, release_reason FROM leases").all(), grant: hub.grants.get(grant.id), gate: hub.settings.get("executionGate"), live: hub.supervisor.list() };
  return originalDbClose();
};
async function start() {
  const view = hub.factory.view(mission.id);
  assert.ok(view.scope, JSON.stringify({ problems: view.scopeProblems, spec: view.spec?.protected?.problems }));
  const response = await dispatch("factory.start", view.scope);
  await dispatch("approval.decide", { approvalId: response.approval.id, decision: "approved", displayedHash: response.approval.payloadHash });
  await hub.commands.executeApproved(response.command.id, "user");
  await waitFor(() => hub.runs.admittingCount() || child, 15000);
  await held.promise;
}
async function cleanup() { closing = true; if (mode === "RT-1") await hub.close(); else await h.cleanup(); }

if (mode === "RT-4") {
  // Complete expensive setup/admission first; only the deliberately suspended body has a short timeout.
  await start();
  test("RT-4 original timed-out body", { timeout: 100 }, async (t) => {
    t.after(cleanup);
    await waitFor(() => false, 10000, 10, { signal: t.signal });
  });
} else {
  test(`${mode} original body error`, { timeout: mode === "RT-3b" ? 75000 : 45000 }, async (t) => {
    t.after(cleanup);
    await start();
    if (mode === "RT-3b") {
      await waitFor(() => child && hub.runs.activeRuns().some((r) => r.timeline.turn_sent), 15000, 20, { signal: t.signal });
      identity = { pid: child.pid, creationDate: child.startedAt }; // synthetic identity for the injected snapshot
    }
    throw new Error("ORIGINAL_BODY_ERROR");
  });
}

test(`${mode} observer`, { timeout: mode === "RT-3b" ? 75000 : 45000 }, async (t) => {
  if (mode === "RT-1") t.after(() => h.cleanup());
  assert.ok(proof, "db.close always called");
  assert.equal(lateStarts, 0, "no start succeeded after cleanup began");
  assert.equal(hub.runs.admittingCount(), 0);
  if (mode === "RT-3b") {
    assert.equal(helpers.cleanupFailures.length, 1, "cleanup error retained for the separate file guard");
    const error = helpers.cleanupFailures[0].error;
    assert.ok(error instanceof AggregateError);
    assert.match(error.message, new RegExp(`pid=${child.pid}`));
    assert.ok(error.message.includes(child.startedAt));
    if (identity) {
      assert.equal(hubSnapshots.length, 2, "one failure-tree snapshot and one fresh close verification");
      assert.ok(hubSnapshots[0].some((r) => r.pid === child.pid && r.creationDate === identity.creationDate));
      assert.ok(error.message.includes(identity.creationDate));
    }
    assert.equal(child.child.stdout.listenerCount("data"), 0, "survivor's DB consumers detached");
    await child.exit; // bounded fixture self-exits; never hide a survivor with unref or a force exit
  } else {
    const run = proof.runs.find((r) => r.provider === "claude");
    assert.equal(run?.status, "blocked"); assert.equal(run.preInference, true);
    assert.match(run.errorMessage, /Hub-ul se oprește/); assert.equal(run.pid, null);
    assert.equal(modelStarts, 0, "refused at pre-model recheck, before adapter.startTurn");
    assert.equal(run.evidence.recheck, true);
    assert.equal(run.evidence.shutdown, true);
    assert.equal(run.evidence.stopAll, false);
    assert.ok(proof.leases.some((r) => r.release_reason === "Hub-ul se oprește înainte de pornire"));
    assert.ok(proof.leases.every((r) => r.status === "released"));
    assert.equal(proof.dispatches.length, 1);
    assert.equal(proof.dispatches[0].status, "CANCELLED", "shutdown admission cannot leave CLAIMED");
    assert.equal(proof.dispatches[0].runId, run.id, "blocked run remains linked to dispatch");
    assert.equal(proof.grant.attemptsUsed, 0, "pre-inference attempt refunded");
    assert.equal(proof.grant.status, "active", "close did not persist Stop All revocation");
    assert.equal(proof.gate.status, "open", "close did not persist a gate suspension");
    assert.deepEqual(proof.live, []);
    assert.equal(child, null, "no process was launched for the blocked author");
  }
  assert.deepEqual(hub.supervisor.list(), []);
  if (child) assert.equal(child.exited, true, "owned fixture exit observed");
  if (mode === "RT-1") {
    const next = createHub(h.config, { homeDir: h.homeDir });
    try {
      await next.boot();
      await enableLive(next, { access: "workspace-write" });
      assert.equal(next.factory.view(mission.id).dispatches[0].status, "CANCELLED");
      await next.factory.resume(mission.id);
      await waitFor(() => next.factory.view(mission.id).dispatches.some((d) => d.status === "STARTED"), 15000, 20, { signal: t.signal });
      const resumed = next.factory.view(mission.id);
      assert.equal(resumed.factory.limits.maxAttemptsPerStage, 1);
      assert.equal(resumed.dispatches.length, 2);
      assert.equal(resumed.dispatches[1].request.counted, 1, "interrupted admission did not consume the sole model attempt");
    } finally {
      try { await next.close(); } catch (error) { helpers.cleanupFailures.push({ dataDir: h.dataDir, error }); }
    }
  }
  await sleep(1000);
  assert.deepEqual(problems, []);
  console.log(`CLEANUP_OBSERVER_OK ${mode}`);
});
