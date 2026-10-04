import test from "node:test";
import assert from "node:assert/strict";
import { makeTestHub, enableLive, waitFor } from "./helpers.mjs";
import { createHub } from "../server/hub.mjs";

const finished = (hub, id) => waitFor(() => { const r = hub.runs.getRun(id); return ["completed", "failed", "blocked", "interrupted"].includes(r.status) ? r : null; }, 30000);

function conversationWithMessage(hub, projectId, content = "Continue the task") {
  const conv = hub.bus.transaction(() => hub.conversations.create({ projectId, title: "Run test" }));
  hub.bus.transaction(() => hub.conversations.addMessage({ conversationId: conv.id, role: "user", content }));
  return conv;
}

test("T10/T14 run persists messages, provider session and moves its task to VERIFYING (not COMPLETED)", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    const { project, grant } = await enableLive(hub);
    const mission = hub.bus.transaction(() => hub.missions.create({ projectId: project.id, kind: "development", title: "Mission", objective: "Build the thing" }));
    const [plan] = hub.missions.tasks(mission.id);
    hub.bus.transaction(() => hub.missions.command(plan.id, "queue"));
    const conv = conversationWithMessage(hub, project.id);
    const { run } = await hub.runs.start({ conversationId: conv.id, provider: "codex", taskId: plan.id, stage: "owner", roleId: "planner" });
    const done = await finished(hub, run.id);
    assert.equal(done.status, "completed");
    assert.equal(done.grantId, grant.id);
    assert.ok(done.backupId, "every run is bound to a verified backup");
    assert.ok(done.codeVersion.length === 40, "run is bound to the code version");
    assert.equal(hub.missions.task(plan.id).status, "VERIFYING");
    assert.equal(hub.grants.get(grant.id).attemptsUsed, 1);
    assert.equal(hub.leases.list().length, 0, "lease released");
    const messages = hub.conversations.messages(conv.id);
    assert.equal(messages.at(-1).content, "Codex simulated answer.");
    assert.equal(messages.at(-1).status, "final");
    assert.equal(hub.conversations.providerSessions(conv.id)[0].nativeSessionId, "thr_fake_1");

    // T10: a new Hub process over the same database sees everything.
    const reopened = createHub(hub.config);
    await reopened.boot();
    assert.equal(reopened.conversations.messages(conv.id).length, 2);
    assert.equal(reopened.missions.task(plan.id).status, "VERIFYING");
    assert.equal(reopened.runs.getRun(run.id).status, "completed");
    await reopened.close();
  } finally { await t.cleanup(); }
});

test("T14 reviewer must be a different session: owner and reviewer runs keep separate evidence", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    const { project } = await enableLive(hub, { attempts: 5 });
    hub.bus.transaction(() => hub.grants.create({ provider: "claude", projectId: project.id, access: "read-only", maxAttempts: 2, maxDurationS: 600, ttlMinutes: 30 }, "test"));
    const conv = conversationWithMessage(hub, project.id, "Implement");
    const owner = await hub.runs.start({ conversationId: conv.id, provider: "codex", stage: "owner" });
    await finished(hub, owner.run.id);
    hub.bus.transaction(() => hub.conversations.addMessage({ conversationId: conv.id, role: "user", content: "Review it independently" }));
    const handoff = hub.handoffs.begin({ conversationId: conv.id, toProvider: "claude" });
    await hub.handoffs.advance(handoff.id);
    const reviewer = await hub.runs.start({ conversationId: conv.id, provider: "claude", model: "sonnet", stage: "reviewer" }); // M09: explicit Claude model
    const r = await finished(hub, reviewer.run.id);
    assert.equal(r.status, "completed");
    const ownerRun = hub.runs.getRun(owner.run.id);
    assert.notEqual(ownerRun.provider, r.provider);
    assert.notEqual(ownerRun.nativeThreadId, r.nativeThreadId);
    assert.notEqual(ownerRun.id, r.id);
  } finally { await t.cleanup(); }
});

test("T11 handoff Codex → Claude → Codex keeps objective, constraints and files; acknowledgement is verified", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    const { project } = await enableLive(hub, { attempts: 5 });
    hub.bus.transaction(() => hub.grants.create({ provider: "claude", projectId: project.id, access: "read-only", maxAttempts: 3, maxDurationS: 600, ttlMinutes: 30 }, "test"));
    const mission = hub.bus.transaction(() => hub.missions.create({ projectId: project.id, kind: "development", title: "Handoff mission", objective: "Add a greeting endpoint",
      acceptance: ["GET /hello returns 200"], constraints: ["Do not touch the database schema"] }));
    const conv = conversationWithMessage(hub, project.id, "Start the work");
    hub.bus.transaction(() => hub.conversations.update(conv.id, { activeMissionId: mission.id }));
    const first = await hub.runs.start({ conversationId: conv.id, provider: "codex" });
    await finished(hub, first.run.id);
    // Dirty file so the package must carry the real diff.
    const fs = await import("node:fs");
    fs.writeFileSync(`${t.projectDir}/src/app.js`, "export const answer = 43; // token=supersecretvalue123\n");

    const h1 = hub.handoffs.begin({ conversationId: conv.id, toProvider: "claude" });
    assert.throws(() => hub.handoffs.begin({ conversationId: conv.id, toProvider: "claude" }), /already open/);
    await assert.rejects(hub.runs.start({ conversationId: conv.id, provider: "codex" }), /handoff to claude/);
    const ready = await hub.handoffs.advance(h1.id);
    assert.equal(ready.status, "ready");
    const pkg = ready.package;
    for (const key of ["schema_version", "conversation_id", "objective", "acceptance_criteria", "user_constraints", "decisions_with_sources", "completed_work", "remaining_work",
      "blockers", "next_safe_action", "repo", "worktree", "branch", "commit", "dirty_diff", "untracked_manifest", "test_results", "running_processes",
      "unresolved_side_effects", "pending_approvals", "artifacts", "source_session", "target_provider", "context_references"]) assert.ok(key in pkg, key);
    assert.equal(pkg.objective, "Add a greeting endpoint");
    assert.ok(pkg.user_constraints.includes("Do not touch the database schema"));
    assert.match(pkg.dirty_diff, /answer = 43/);
    assert.ok(!JSON.stringify(pkg).includes("supersecretvalue123"), "secrets are redacted from the package");
    assert.equal(pkg.source_session.native_session_id, "thr_fake_1");

    hub.bus.transaction(() => hub.conversations.addMessage({ conversationId: conv.id, role: "user", content: "Continue on Claude" }));
    const second = await hub.runs.start({ conversationId: conv.id, provider: "claude", model: "sonnet" }); // M09: explicit Claude model
    await finished(hub, second.run.id);
    const acked = await waitFor(() => { const h = hub.handoffs.get(h1.id); return h.status === "completed" ? h : null; });
    assert.equal(acked.step, "continued");
    const call = t.readLog("claude").find((e) => e.args);
    assert.match(call.promptHead, /continuing work inside Ifrim Agent Hub/);

    // And back to Codex in the same conversation and same worktree.
    hub.bus.transaction(() => hub.conversations.addMessage({ conversationId: conv.id, role: "user", content: "Back to Codex" }));
    const h2 = hub.handoffs.begin({ conversationId: conv.id, toProvider: "codex" });
    const ready2 = await hub.handoffs.advance(h2.id);
    assert.equal(ready2.package.worktree, pkg.worktree);
    const third = await hub.runs.start({ conversationId: conv.id, provider: "codex" });
    await finished(hub, third.run.id);
    assert.equal((await waitFor(() => { const h = hub.handoffs.get(h2.id); return h.status === "completed" ? h : null; })).step, "continued");
    assert.equal(hub.conversations.messages(conv.id).filter((m) => m.role === "assistant").length, 3, "one visible conversation");
  } finally { await t.cleanup(); }
});

test("T11 handoff waits at the safe point while a run is active", async () => {
  const t = await makeTestHub({ codex: "hang" });
  try {
    const { hub } = t;
    const { project } = await enableLive(hub);
    const conv = conversationWithMessage(hub, project.id);
    const { run } = await hub.runs.start({ conversationId: conv.id, provider: "codex" });
    await waitFor(() => t.readLog("codex").some((e) => e.method === "turn/start"));
    const h = hub.handoffs.begin({ conversationId: conv.id, toProvider: "claude" });
    const waiting = await hub.handoffs.advance(h.id);
    assert.equal(waiting.status, "waiting");
    assert.equal(waiting.step, "safe_point");
    await hub.runs.interrupt(run.id);
    const r = await finished(hub, run.id);
    assert.equal(r.status, "interrupted");
    assert.equal((await hub.handoffs.advance(h.id)).status, "ready");
  } finally { await t.cleanup(); }
});

test("T16 crash mid-run: restart marks run interrupted, retains the lease, blocks the task and never retries", async () => {
  const t = await makeTestHub({ codex: "hang" });
  try {
    const { hub } = t;
    const { project } = await enableLive(hub);
    const mission = hub.bus.transaction(() => hub.missions.create({ projectId: project.id, kind: "development", title: "Crash", objective: "Crash test" }));
    const [plan] = hub.missions.tasks(mission.id);
    hub.bus.transaction(() => hub.missions.command(plan.id, "queue"));
    const conv = conversationWithMessage(hub, project.id);
    const { run } = await hub.runs.start({ conversationId: conv.id, provider: "codex", taskId: plan.id });
    await waitFor(() => t.readLog("codex").some((e) => e.method === "turn/start"));
    const startsBefore = t.readLog("codex").filter((e) => e.method === "turn/start").length;
    // Simulate a crash: kill the provider without letting the run manager finalize, then boot a new Hub.
    await hub.supervisor.stopAll();
    hub.db.prepare("UPDATE agent_runs SET status = 'running', pid = 999999 WHERE id = ?").run(run.id);
    hub.db.prepare("UPDATE leases SET status = 'active' WHERE run_id = ?").run(run.id);
    hub.db.prepare("UPDATE tasks SET status = 'RUNNING' WHERE id = ?").run(plan.id);
    const restarted = createHub(hub.config);
    const report = await restarted.boot();
    assert.equal(report.runs[0].status, "interrupted_unknown");
    assert.equal(restarted.runs.getRun(run.id).status, "interrupted_unknown");
    assert.equal(restarted.leases.list()[0].status, "retained");
    assert.equal(restarted.missions.task(plan.id).status, "BLOCKED");
    assert.equal(restarted.settings.get("mode"), "BUILD_SAFE");
    assert.equal(t.readLog("codex").filter((e) => e.method === "turn/start").length, startsBefore, "no automatic retry");
    await restarted.close();
  } finally { await t.cleanup(); }
});

test("T12 quota on Codex puts the task in WAITING_PROVIDER; Claude is not started", async () => {
  const t = await makeTestHub({ codex: "quota" });
  try {
    const { hub } = t;
    const { project } = await enableLive(hub);
    // The probe recorded 95% usage: the gate itself refuses at the ceiling.
    const conv = conversationWithMessage(hub, project.id);
    await assert.rejects(hub.runs.start({ conversationId: conv.id, provider: "codex" }), (e) => e.category === "gate" && /ceiling/.test(JSON.stringify(e.details)));
    assert.equal(t.readLog("claude").filter((e) => e.args).length, 0);
  } finally { await t.cleanup(); }
});

test("T16 duplicate start of the same turn returns the existing run", async () => {
  const t = await makeTestHub({ codex: "hang" });
  try {
    const { hub } = t;
    const { project } = await enableLive(hub);
    const conv = conversationWithMessage(hub, project.id);
    const first = await hub.runs.start({ conversationId: conv.id, provider: "codex" });
    const second = await hub.runs.start({ conversationId: conv.id, provider: "codex" });
    assert.equal(second.duplicate, true);
    assert.equal(second.run.id, first.run.id);
    await hub.runs.stopAll("test", "cleanup");
    assert.equal(hub.settings.get("executionGate").status, "suspended");
    assert.equal(hub.grants.list().every((g) => g.status !== "active"), true);
  } finally { await t.cleanup(); }
});
