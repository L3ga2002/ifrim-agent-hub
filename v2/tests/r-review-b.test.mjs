import { registerCleanupGuard } from "./helpers.mjs";
registerCleanupGuard();
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeTestHub, enableLive, enrolOwner, waitFor, tempDir } from "./helpers.mjs";
import { materializeFixture, demoSpec } from "../server/factory/fixtures.mjs";
import { createHub } from "../server/hub.mjs";
import { fakeLaunchers } from "./media-helpers.mjs";
import { finishShutdown } from "../server/runtime/production-shutdown.mjs";

const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const dispatch = (h, type, payload) => h.hub.commands.dispatch({ type, payload, channel: "test", actor: "test" });

for (const target of ["TEST_PROVING", "CHECKING", "QA"]) test(`review B: shutdown during ${target} cannot evaluate a partial stage`, { timeout: 60000 }, async (t) => {
  const h = await makeTestHub({ queues: true }); t.after(() => h.cleanup());
  await enableLive(h.hub, { access: "workspace-write" });
  const name = target === "TEST_PROVING" ? "bug-demo-test-first" : "bug-demo";
  const dir = path.join(h.dataDir, "stage-project"); materializeFixture(name, dir);
  const project = (await dispatch(h, "project.register_test", { path: dir })).result;
  h.hub.bus.transaction(() => { for (const provider of ["claude", "codex"]) h.hub.grants.create({ provider, projectId: project.id,
    access: provider === "claude" ? "read-only" : "workspace-write", maxAttempts: 5, maxDurationS: 900, ttlMinutes: 60 }, "test"); });
  const input = demoSpec(name);
  if (target !== "TEST_PROVING") input.spec.verification[target === "CHECKING" ? "checks" : "acceptance"] = ["node --test", "node --test test/acceptance.test.mjs"];
  const mission = (await dispatch(h, "factory.prepare", { projectId: project.id, ...input, limits: { writerModel: "gpt-fake-sol", reviewerModel: "sonnet" } })).result.mission;
  if (target === "TEST_PROVING") { h.queue("claude", "author:bug-ok"); h.queue("codex", "test-review:pass", "factory-write:bug-fix"); }
  else { h.queue("claude", "review:pass"); h.queue("codex", "factory-write:bug-fix"); }
  const entered = deferred(), release = deferred(); t.after(() => release.resolve());
  const runner = h.hub.factoryRunner.run; let commands = 0, before, after;
  h.hub.factoryRunner.run = async (input) => {
    const result = await runner(input);
    if (input.key.includes(`-${target}-`)) {
      commands++;
      if (commands === 1) { before = h.hub.factory.view(mission.id); entered.resolve(); await release.promise; }
    }
    return result;
  };
  const requested = await dispatch(h, "factory.start", h.hub.factory.view(mission.id).scope);
  await dispatch(h, "approval.decide", { approvalId: requested.approval.id, decision: "approved", displayedHash: requested.approval.payloadHash });
  await h.hub.commands.executeApproved(requested.command.id, "user");
  await waitFor(() => before, 45000, 20, { signal: t.signal });
  const closeDb = h.hub.db.close.bind(h.hub.db);
  h.hub.db.close = () => { after = h.hub.factory.view(mission.id); closeDb(); };
  const closing = h.hub.close();
  await Promise.resolve(); // factory.close raises its fence before the held command returns.
  release.resolve(); await closing;
  if (target === "TEST_PROVING") assert.ok(before.authoring?.candidate, "held a real candidate before classification");
  assert.equal(commands, 1, "second command never ran");
  assert.equal(after.factory.stage, target, "boot owns recovery; no BLOCKED or partial PASS");
  assert.deepEqual(after.authoring, before.authoring, "candidate/verdict/rewrite budget unchanged");
  assert.deepEqual(after.dispatches, before.dispatches, "no extra author/review dispatch");
  assert.deepEqual(after.findings, before.findings, "no finding resolved from partial checks");
  assert.deepEqual(after.tasks, before.tasks, "no task walked to VERIFYING");
  assert.deepEqual(after.bundles, before.bundles, "no QA bundle from partial evidence");
  const next = createHub(h.config, { homeDir: h.homeDir });
  try {
    await next.boot();
    assert.equal(next.db.prepare("SELECT COUNT(*) AS n FROM leases WHERE holder = ? AND status != 'released'").get(`factory-runner:${mission.id}`).n, 0, "runner lease released across reboot");
    await enableLive(next, { provider: "codex", access: "read-only" });
    next.bus.transaction(() => next.grants.create({ provider: "codex", projectId: project.id, access: "read-only", maxAttempts: 2, maxDurationS: 600, ttlMinutes: 30 }, "test"));
    h.queue("codex", "ok");
    const conversation = next.bus.transaction(() => next.conversations.create({ projectId: project.id, title: "After runner shutdown" }, "test"));
    next.bus.transaction(() => next.conversations.addMessage({ conversationId: conversation.id, role: "user", content: "Synthetic next admission" }, "test"));
    const { run } = await next.runs.start({ conversationId: conversation.id, provider: "codex", access: "read-only", model: "gpt-fake-sol", effort: "medium" });
    assert.notEqual(run.status, "blocked", "project admits its next run after reboot");
    await waitFor(() => next.runs.activeCount() === 0, 10000, 20, { signal: t.signal });
  } finally { await next.close(); }
});

test("review B D22: real media pin interrupted at close recovers plan and ACTIVE delivery on new boot", { timeout: 30000 }, async (t) => {
  const h = await makeTestHub({ configOverrides: { mediaTools: { launcher: fakeLaunchers({ FAKE_FFMPEG_MODE: "hang" }), ffmpeg: null, ffprobe: null } } });
  t.after(() => h.cleanup());
  const owner = await enrolOwner(h);
  const plan = await h.hub.opsPlans.propose({ kind: "test.pin", title: "Unelte", actor: "test", steps: [{ kind: "media.tools.pin", params: {} }] });
  await h.hub.opsPlans.confirm({ planId: plan.id, nonce: plan.nonce, displayedHash: plan.hash, session: owner.session });
  const at = new Date().toISOString();
  h.hub.db.prepare(`INSERT INTO deliveries (id, project_id, title, status, template_json, template_sha, ops_steps_json, ops_body_sha, ops_plan_id, created_by, created_at, updated_at)
    VALUES ('shutdown-delivery', ?, 'Unelte', 'ACTIVE', '{}', '', '[]', '', ?, 'test', ?, ?)`).run(h.hub.projects.hub().id, plan.id, at, at);
  await waitFor(() => h.hub.supervisor.list().some((r) => r.label.startsWith("media:")), 10000, 10, { signal: t.signal });
  let atClose;
  const closeDb = h.hub.db.close.bind(h.hub.db);
  h.hub.db.close = () => { atClose = { plan: h.hub.opsPlans.view(plan.id), delivery: h.hub.deliveries.get("shutdown-delivery") }; closeDb(); };
  await h.hub.close();
  assert.equal(atClose.plan.status, "RUNNING"); assert.equal(atClose.plan.steps[0].status, "RUNNING");
  assert.equal(atClose.delivery.status, "ACTIVE");
  const next = createHub(h.config, { homeDir: h.homeDir });
  try {
    await next.boot();
    assert.equal(next.opsPlans.view(plan.id).status, "NEEDS_OWNER");
    assert.equal(next.opsPlans.view(plan.id).steps[0].status, "UNCERTAIN");
    await waitFor(() => next.deliveries.get("shutdown-delivery").status === "NEEDS_OWNER", 1000);
    assert.match(next.opsPlans.view(plan.id).steps[0].error, /Hub repornit/);
  } finally { await next.close(); }
});

test("review B production shutdown logs AggregateError, removes only owned pid and exits zero", async (t) => {
  const dir = tempDir("shutdown-main"); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const pidFile = path.join(dir, "pid.json"), errors = [], exits = [];
  fs.writeFileSync(pidFile, JSON.stringify({ pid: process.pid }));
  await finishShutdown({ hub: { close: async () => { throw new AggregateError([new Error("first"), new Error("second")]); } },
    prepare: async () => {}, pidFile, log: (s) => errors.push(s), exit: (code) => exits.push(code) });
  assert.equal(fs.existsSync(pidFile), false); assert.deepEqual(exits, [0]); assert.equal(errors.length, 2);
  assert.ok(errors.every((s) => s.startsWith("[hub] Eroare la oprirea Hub-ului:")));
  fs.writeFileSync(pidFile, JSON.stringify({ pid: -1 }));
  await finishShutdown({ hub: { close: async () => {} }, prepare: async () => {}, pidFile, exit: () => {} });
  assert.equal(fs.existsSync(pidFile), true);
});

test("review B finalize: a rolled-back conversation finalize is retried as failed/internal", async (t) => {
  const h = await makeTestHub(); t.after(() => h.cleanup());
  await enableLive(h.hub, { provider: "codex", access: "read-only" });
  const conversation = h.hub.bus.transaction(() => h.hub.conversations.create({ projectId: h.hub.projects.hub().id, title: "Finalize" }, "test"));
  h.hub.bus.transaction(() => h.hub.conversations.addMessage({ conversationId: conversation.id, role: "user", content: "Fixture only" }, "test"));
  const original = h.hub.conversations.finalize; let calls = 0;
  h.hub.conversations.finalize = (...args) => { if (++calls === 1) throw new Error("finalize sentinel"); return original(...args); };
  const { run } = await h.hub.runs.start({ conversationId: conversation.id, provider: "codex", access: "read-only", model: "gpt-fake-sol", effort: "medium" });
  await waitFor(() => h.hub.runs.getRun(run.id).status === "failed", 10000, 20, { signal: t.signal });
  const result = h.hub.runs.getRun(run.id);
  assert.equal(result.errorCategory, "internal"); assert.match(result.errorMessage, /finalize sentinel/); assert.equal(calls, 2);
  assert.equal(h.hub.db.prepare("SELECT COUNT(*) AS n FROM events WHERE run_id = ? AND type = 'run.failed'").get(run.id).n, 1);
  assert.equal(h.hub.runs.activeCount(), 0);
  await h.hub.close();
});


test("review B finalize: two failures remove active entry and report the persistence failure at close", async (t) => {
  const h = await makeTestHub(); t.after(() => h.cleanup());
  await enableLive(h.hub, { provider: "codex", access: "read-only" });
  const conversation = h.hub.bus.transaction(() => h.hub.conversations.create({ projectId: h.hub.projects.hub().id, title: "Double finalize" }, "test"));
  h.hub.bus.transaction(() => h.hub.conversations.addMessage({ conversationId: conversation.id, role: "user", content: "Fixture only" }, "test"));
  let calls = 0;
  h.hub.conversations.finalize = () => { calls++; throw new Error("double finalize sentinel"); };
  const { run } = await h.hub.runs.start({ conversationId: conversation.id, provider: "codex", access: "read-only", model: "gpt-fake-sol", effort: "medium" });
  await waitFor(() => calls === 2 && h.hub.runs.activeCount() === 0, 10000, 20, { signal: t.signal });
  assert.equal(h.hub.runs.getRun(run.id).status, "running", "failed persistence remains available to boot recovery");
  await assert.rejects(h.hub.close(), /double finalize sentinel/);
  h.hub.close = async () => {}; // expected error already asserted, fixture directory still removed
});

for (const provider of ["claude", "codex"]) test(`review B ${provider}: failed stop never reports interrupted true`, async (t) => {
  const h = await makeTestHub({ [provider]: "hang" }); t.after(() => h.cleanup());
  await enableLive(h.hub, { provider, access: "read-only" });
  const conversation = h.hub.bus.transaction(() => h.hub.conversations.create({ projectId: h.hub.projects.hub().id, title: "Stop result" }, "test"));
  h.hub.bus.transaction(() => h.hub.conversations.addMessage({ conversationId: conversation.id, role: "user", content: "Fixture only" }, "test"));
  const { run } = await h.hub.runs.start({ conversationId: conversation.id, provider, access: "read-only", model: provider === "codex" ? "gpt-fake-sol" : "sonnet", effort: "medium" });
  await waitFor(() => h.hub.runs.getRun(run.id).timeline.turn_sent, 10000, 20, { signal: t.signal });
  const stop = h.hub.supervisor.stop;
  h.hub.supervisor.stop = async () => ({ stopped: false, method: "handle", taskkill: { ok: false } });
  try {
    const result = await h.hub.runs.interrupt(run.id, "turn-timeout");
    assert.equal(result.interrupted, false); assert.equal(result.stop.stopped, false);
  } finally { h.hub.supervisor.stop = stop; }
});
