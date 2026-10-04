// Milestone 05 (T12, M05 §20) — Stop during a QA command: the command (and its child) is killed, the evidence row is
// INTERRUPTED and stale, CANCELLED is confirmed only after the command is gone, and no preview/E2E/bundle follows.
// Fixture providers and runner only (PASS_SIMULATED); nothing outside .ifrim/tmp.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { makeTestHub, enableLive, waitFor } from "./helpers.mjs";
import { materializeFixture, demoSpec } from "../server/factory/fixtures.mjs";
import { isPidAlive } from "../server/runtime/supervisor.mjs";

const dispatch = (hub, type, payload, channel = "test") => hub.commands.dispatch({ type, payload, channel, actor: "test" });
// The bug-hang fixture's slow test returns at once when this marker exists (see make-patches.mjs).
const RELEASE = path.join(os.tmpdir(), "ifrim-factory-slow-release");

async function factoryHub(fixture = "bug-demo") {
  const t = await makeTestHub({ queues: true });
  await enableLive(t.hub, { provider: "codex", access: "workspace-write", attempts: 1 });
  const dir = path.join(t.dataDir, `factory-${fixture}`);
  materializeFixture(fixture, dir);
  const project = (await dispatch(t.hub, "project.register_test", { path: dir })).result;
  t.hub.bus.transaction(() => {
    t.hub.grants.create({ provider: "codex", projectId: project.id, access: "workspace-write", maxAttempts: 4, maxDurationS: 900, ttlMinutes: 60 }, "test");
    t.hub.grants.create({ provider: "claude", projectId: project.id, access: "read-only", maxAttempts: 4, maxDurationS: 900, ttlMinutes: 60 }, "test");
  });
  return { ...t, project, dir };
}
async function approveAndStart(t, missionId) {
  const requested = await dispatch(t.hub, "factory.start", t.hub.factory.view(missionId).scope);
  await dispatch(t.hub, "approval.decide", { approvalId: requested.approval.id, decision: "approved", displayedHash: requested.approval.payloadHash }, "ui");
  return t.hub.commands.executeApproved(requested.command.id, "user");
}
const view = (t, id) => t.hub.factory.view(id);
const idleWithin = (t, missionId, ms = 30000) => Promise.race([t.hub.factory.idle(missionId), new Promise((_, reject) => setTimeout(() => reject(new Error("factory.idle() did not settle")), ms).unref())]);

test("M05-FAC-01 Stop during a QA command: killed, INTERRUPTED + stale, CANCELLED only after it is gone; no repair, preview, E2E or bundle", async () => {
  fs.rmSync(RELEASE, { force: true });
  const t = await factoryHub("bug-demo");
  try {
    const input = demoSpec("bug-demo");
    input.spec.verification.checks = ["node --test test/unit.test.mjs"];
    input.spec.verification.acceptance = ["node --test test/acceptance.test.mjs", "node --test test/slow.test.mjs"];
    const { mission } = (await dispatch(t.hub, "factory.prepare", { projectId: t.project.id, ...input, limits: { writerModel: "gpt-fake-sol", reviewerModel: "sonnet" } })).result; // M09: explicit models
    t.queue("codex", "factory-write:bug-hang");
    t.queue("claude", "review:pass");
    await approveAndStart(t, mission.id);
    const key = `factory-run-${mission.id}-QA-1`;
    const proc = await waitFor(() => t.hub.supervisor.list().find((p) => p.key === key) || null, 120000, 100);
    assert.equal(view(t, mission.id).factory.stage, "QA");
    const t0 = Date.now();
    const stopped = (await dispatch(t.hub, "factory.stop", { missionId: mission.id, reason: "test" }, "ui")).result;
    assert.ok(["CANCEL_REQUESTED", "CANCELLED"].includes(stopped.factory.stage), stopped.factory.stage);
    await waitFor(() => (view(t, mission.id).factory.stage === "CANCELLED" ? true : null), 30000, 100);
    await idleWithin(t, mission.id);
    const stopMs = Date.now() - t0;
    assert.ok(!t.hub.supervisor.list().some((p) => p.key.startsWith(`factory-run-${mission.id}-`)), "no runner process left");
    assert.equal(await isPidAlive(proc.pid), false, "the QA process tree is gone");
    const v = view(t, mission.id);
    const qa = v.evidence.filter((e) => e.stage === "QA");
    assert.equal(qa[0].status, "PASS");
    const interrupted = qa.find((e) => e.command === "node --test test/slow.test.mjs");
    assert.equal(interrupted.status, "INTERRUPTED");
    assert.equal(interrupted.stale, true);
    assert.match(interrupted.detail.reason, /oprit de Stop\/Pauză/);
    assert.ok(!v.findings.some((f) => f.area === "qa" || f.source === "qa"), "an interrupted command is never a finding");
    assert.deepEqual(v.dispatches.map((d) => d.stage), ["IMPLEMENTING", "REVIEWING"], "no repair after the Stop");
    assert.ok(!v.evidence.some((e) => ["PREVIEW", "E2E"].includes(e.stage)), "no preview or E2E after the Stop");
    assert.equal(v.bundles.length, 0);
    assert.ok(!t.hub.leases.current(`workspace:${path.resolve(t.dir).toLowerCase()}`), "the runner lease is released");
    await assert.rejects(dispatch(t.hub, "factory.resume", { missionId: mission.id }, "ui"), /CANCELLED|anulat|final/i);
    assert.ok(stopMs < 30000, `Stop → CANCELLED in ${stopMs} ms`);
  } finally { fs.rmSync(RELEASE, { force: true }); await t.cleanup(); }
});
