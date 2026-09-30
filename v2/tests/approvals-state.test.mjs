import test from "node:test";
import assert from "node:assert/strict";
import { makeTestHub } from "./helpers.mjs";
import { canTransition, transitionTask } from "../server/runtime/state-machine.mjs";

const action = (overrides = {}) => ({ actionKind: "process.run", target: "C:/p", payload: { command: "npm test" }, codeVersion: "abc", permissionTier: "DEVELOPMENT_TOOLS", scopeType: "project", scopeId: "prj_1", ...overrides });

test("T15 approval binds the exact action; any change invalidates it", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    const approval = hub.bus.transaction(() => hub.approvals.request({ ...action(), requestedBy: "test" }));
    hub.bus.transaction(() => hub.approvals.decide(approval.id, { decision: "approved", displayedHash: approval.payloadHash, channel: "ui" }));
    assert.throws(() => hub.approvals.consume(approval.id, action({ payload: { command: "npm test && rm -rf x" } })), /does not match/);
    assert.equal(hub.approvals.get(approval.id).status, "invalidated");
    const second = hub.bus.transaction(() => hub.approvals.request({ ...action(), requestedBy: "test" }));
    hub.bus.transaction(() => hub.approvals.decide(second.id, { decision: "approved", displayedHash: second.payloadHash, channel: "ui" }));
    assert.throws(() => hub.approvals.consume(second.id, action({ scopeId: "prj_other" })), /does not match/);
    const third = hub.bus.transaction(() => hub.approvals.request({ ...action(), requestedBy: "test" }));
    hub.bus.transaction(() => hub.approvals.decide(third.id, { decision: "approved", displayedHash: third.payloadHash, channel: "ui" }));
    hub.approvals.consume(third.id, action());
    assert.throws(() => hub.approvals.consume(third.id, action()), /consumed/);
  } finally { await t.cleanup(); }
});

test("T15 decision must match the hash the UI displayed; voice/automation cannot decide", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    const approval = hub.bus.transaction(() => hub.approvals.request({ ...action(), requestedBy: "test" }));
    assert.throws(() => hub.approvals.decide(approval.id, { decision: "approved", displayedHash: "0".repeat(64), channel: "ui" }), /changed/);
    assert.throws(() => hub.approvals.decide(approval.id, { decision: "approved", displayedHash: approval.payloadHash, channel: "voice" }), /cannot be decided/);
    assert.throws(() => hub.approvals.decide(approval.id, { decision: "approved", displayedHash: approval.payloadHash, channel: "automation" }), /cannot be decided/);
    assert.throws(() => hub.approvals.decide(approval.id, { decision: "rejected", displayedHash: approval.payloadHash, channel: "ui", note: "" }), /note/);
  } finally { await t.cleanup(); }
});

test("T15 expired approvals cannot be used", async () => {
  let current = new Date("2026-09-29T10:00:00Z");
  const t = await makeTestHub({ clock: () => current });
  try {
    const { hub } = t;
    const approval = hub.bus.transaction(() => hub.approvals.request({ ...action(), requestedBy: "test", ttlMinutes: 5 }));
    current = new Date("2026-09-29T10:06:00Z");
    assert.throws(() => hub.approvals.decide(approval.id, { decision: "approved", displayedHash: approval.payloadHash, channel: "ui" }), /expired/);
  } finally { await t.cleanup(); }
});

test("state machine: model turn end is not completion; completion needs evidence", async () => {
  assert.equal(canTransition("RUNNING", "COMPLETED"), false);
  assert.equal(canTransition("RUNNING", "VERIFYING"), true);
  assert.equal(canTransition("COMPLETED", "QUEUED"), false);
  const t = await makeTestHub();
  try {
    const { hub } = t;
    const project = hub.projects.hub();
    const mission = hub.bus.transaction(() => hub.missions.create({ projectId: project.id, kind: "development", title: "Test mission", objective: "Check the state machine" }));
    const [plan, build] = hub.missions.tasks(mission.id);
    assert.throws(() => hub.bus.transaction(() => hub.missions.command(build.id, "queue")), /Dependencies/);
    hub.bus.transaction(() => hub.missions.command(plan.id, "queue"));
    hub.bus.transaction(() => transitionTask(hub.db, hub.bus, () => new Date(), { taskId: plan.id, to: "RUNNING", reason: "test run", actor: "test" }));
    assert.throws(() => hub.bus.transaction(() => transitionTask(hub.db, hub.bus, () => new Date(), { taskId: plan.id, to: "COMPLETED", reason: "done", actor: "test" })), /not allowed/);
    hub.bus.transaction(() => transitionTask(hub.db, hub.bus, () => new Date(), { taskId: plan.id, to: "VERIFYING", reason: "turn finished", actor: "test" }));
    assert.throws(() => hub.bus.transaction(() => hub.missions.command(plan.id, "verify")), /evidence/);
    hub.bus.transaction(() => hub.missions.command(plan.id, "verify", { evidence: { manualVerification: "Read the plan and checked criteria" } }));
    assert.equal(hub.missions.task(plan.id).status, "COMPLETED");
    assert.equal(hub.missions.progress(mission.id).completed, 1);
    assert.equal(hub.missions.progress(mission.id).total, 4);
    assert.ok(hub.missions.transitions(plan.id).length >= 4);
  } finally { await t.cleanup(); }
});

test("T13 two writers cannot hold the same workspace; retained leases block", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    const first = hub.bus.transaction(() => hub.leases.acquire({ resource: "workspace:x", holder: "codex:1", runId: "r1" }));
    assert.throws(() => hub.bus.transaction(() => hub.leases.acquire({ resource: "workspace:x", holder: "claude:2" })), /held by codex:1/);
    hub.bus.transaction(() => hub.leases.retain(first.id, "crash"));
    assert.throws(() => hub.bus.transaction(() => hub.leases.acquire({ resource: "workspace:x", holder: "claude:2" })), /retained/);
    hub.bus.transaction(() => hub.leases.release(first.id, "reconciled"));
    const second = hub.bus.transaction(() => hub.leases.acquire({ resource: "workspace:x", holder: "claude:2" }));
    assert.equal(second.holder, "claude:2");
    // Even bypassing the check, the partial unique index refuses a second active row.
    assert.throws(() => hub.db.prepare("INSERT INTO leases (id, resource, holder, status, acquired_at, heartbeat_at, expires_at) VALUES ('x2','workspace:x','z','active','a','a','a')").run(), /UNIQUE/);
  } finally { await t.cleanup(); }
});
