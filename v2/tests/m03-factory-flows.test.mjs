// Milestone 03 — Software Factory flows (PASS_SIMULATED): repair loops, review verdicts, integrity, limits, stop/pause,
// restart recovery, approvals and dispatch idempotency. Fixture providers and runner only; nothing outside .ifrim/tmp.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { makeTestHub, enableLive, waitFor } from "./helpers.mjs";
import { materializeFixture, demoSpec } from "../server/factory/fixtures.mjs";
import { createHub } from "../server/hub.mjs";
import { browserStatus } from "../server/tools/browser.mjs";

const dispatch = (hub, type, payload, channel = "test") => hub.commands.dispatch({ type, payload, channel, actor: "test" });

async function factoryHub(fixture = "bug-demo", { attempts = 4, port = null, hubOptions = {} } = {}) {
  const t = await makeTestHub({ queues: true, hubOptions });
  await enableLive(t.hub, { provider: "codex", access: "workspace-write", attempts: 1 });
  const dir = path.join(t.dataDir, `factory-${fixture}`);
  materializeFixture(fixture, dir, { port });
  const project = (await dispatch(t.hub, "project.register_test", { path: dir })).result;
  t.hub.bus.transaction(() => {
    t.hub.grants.create({ provider: "codex", projectId: project.id, access: "workspace-write", maxAttempts: attempts, maxDurationS: 900, ttlMinutes: 60 }, "test");
    t.hub.grants.create({ provider: "claude", projectId: project.id, access: "read-only", maxAttempts: attempts, maxDurationS: 900, ttlMinutes: 60 }, "test");
  });
  return { ...t, project, dir };
}
const prepare = async (t, fixture, { limits, port } = {}) => (await dispatch(t.hub, "factory.prepare", { projectId: t.project.id, ...demoSpec(fixture, { port }), ...(limits ? { limits } : {}) })).result;
async function approveAndStart(t, missionId, scope = t.hub.factory.view(missionId).scope) {
  const requested = await dispatch(t.hub, "factory.start", scope);
  await dispatch(t.hub, "approval.decide", { approvalId: requested.approval.id, decision: "approved", displayedHash: requested.approval.payloadHash });
  return { requested, started: await t.hub.commands.executeApproved(requested.command.id, "user") };
}
const view = (t, id) => t.hub.factory.view(id);
const untilStage = (t, id, stages, ms = 90000) => waitFor(() => (stages.includes(view(t, id).factory.stage) ? view(t, id) : null), ms, 100);
const SETTLED = ["DELIVERY_READY", "NEEDS_OWNER_DECISION", "BLOCKED", "PAUSED", "CANCELLED", "ACCEPTED", "REJECTED"];
// The bug-hang fixture's slow test returns at once when this marker exists (see make-patches.mjs).
const RELEASE = path.join(os.tmpdir(), "ifrim-factory-slow-release");

test("M03-FAC-02 Demo B (FEATURE): failing checks → bounded repair → review PASS → QA → preview from the verified version → bundle; reject stops the preview", async () => {
  const port = 46000 + Math.floor(Math.random() * 2500);
  const t = await factoryHub("service-request", { port });
  try {
    const { mission } = await prepare(t, "service-request", { port });
    t.queue("codex", "factory-write:feature-b-nodedupe", "factory-write:feature-b-dedupe");
    t.queue("claude", "review:pass");
    await approveAndStart(t, mission.id);
    const done = await untilStage(t, mission.id, SETTLED, 150000);
    assert.equal(done.factory.stage, "DELIVERY_READY", done.factory.stageReason);
    assert.equal(done.factory.repairCycles, 1, "one repair cycle");
    const qaFinding = done.findings.find((f) => f.source === "qa");
    assert.ok(qaFinding, "the failing check became a finding");
    assert.equal(qaFinding.status, "RESOLVED");
    assert.equal(done.changeSets.length, 2);
    assert.equal(done.changeSets[0].status, "SUPERSEDED");
    assert.ok(done.evidence.filter((e) => e.changeSetId === done.changeSets[0].id).every((e) => e.stale), "evidence of the old change set is stale");
    assert.ok(done.tasks.some((task) => /Remediere ciclul 1/.test(task.title)), "a repair task linked to the cycle");
    const preview = done.evidence.find((e) => e.stage === "PREVIEW");
    assert.equal(preview.status, "PASS", preview.detail.reason);
    assert.equal(preview.changeSetId, done.changeSets[1].id, "the preview runs the verified version");
    const manifest = JSON.parse(t.hub.db.prepare("SELECT manifest_json FROM factory_bundles WHERE mission_id = ?").get(mission.id).manifest_json);
    assert.equal(manifest.spec.criteria.find((c) => c.id === "AC-6").status, "PASS_EVIDENCE");
    // AC-7 (browser E2E): with Playwright installed the factory runs the approved steps in the real, isolated Chromium on the
    // verified preview (mobile 390 px); without it nothing is claimed.
    const e2e = done.evidence.find((e) => e.stage === "E2E");
    if (browserStatus({ hubRoot: t.config.hubRoot }).installed) {
      assert.equal(e2e?.status, "PASS", e2e?.outputTail);
      assert.equal(e2e.runner, "playwright");
      assert.equal(e2e.changeSetId, done.changeSets[1].id, "E2E ran on the verified version");
      assert.equal(e2e.detail.steps.length, 12);
      assert.ok(e2e.detail.screenshot, "a screenshot is kept as evidence");
      assert.equal(manifest.spec.criteria.find((c) => c.id === "AC-7").status, "PASS_EVIDENCE");
    } else assert.equal(manifest.spec.criteria.find((c) => c.id === "AC-7").status, "NEEDS_INSTALL_APPROVAL", "E2E is not claimed without Playwright");
    assert.ok(!manifest.changeSet.files.some((f) => f.path.startsWith("data/")), "runtime test databases are not part of the change set");
    // The approved E2E steps (exact texts and selectors) reached the writer and the reviewer.
    const withSteps = (conversationId) => t.hub.db.prepare("SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ? AND content LIKE ?").get(conversationId, "%Pașii E2E aprobați%Solicitarea a fost trimisă.%").n;
    assert.ok(withSteps(done.mission.conversationId) >= 2, "both writer briefs (implementation and repair) carry the E2E steps");
    assert.ok(withSteps(done.factory.reviewConversationId) >= 1, "the review brief carries the E2E steps");
    assert.ok(t.hub.supervisor.list().some((p) => p.key === `factory-preview-${mission.id}`), "preview process is tracked");
    const rejected = (await dispatch(t.hub, "factory.reject", { missionId: mission.id, note: "Vreau alt text pe buton" })).result;
    assert.equal(rejected.factory.stage, "REJECTED");
    assert.ok(!t.hub.supervisor.list().some((p) => p.key === `factory-preview-${mission.id}`), "preview stopped");
  } finally { await t.cleanup(); }
});

test("M03-FAC-03 review CHANGES_REQUESTED → repair brief carries the finding → re-review classifies it resolved; old review is STALE", async () => {
  const t = await factoryHub("bug-demo");
  try {
    const { mission } = await prepare(t, "bug-demo");
    t.queue("codex", "factory-write:bug-fix", "factory-write:bug-fix-v2");
    t.queue("claude", "review:changes-dedupe", "review:pass");
    await approveAndStart(t, mission.id);
    const done = await untilStage(t, mission.id, SETTLED);
    assert.equal(done.factory.stage, "DELIVERY_READY", done.factory.stageReason);
    const [first, second] = done.reviews;
    assert.equal(first.verdict, "CHANGES_REQUESTED");
    assert.equal(first.status, "STALE", "a later change set makes the old review historical");
    assert.equal(second.verdict, "PASS");
    const finding = done.findings.find((f) => f.source === "reviewer" && f.severity === "high");
    assert.equal(finding.status, "RESOLVED");
    const briefs = t.hub.db.prepare("SELECT content FROM messages WHERE conversation_id = ? AND role = 'user' ORDER BY position").all(mission.conversationId).map((r) => r.content);
    assert.match(briefs.at(-1), new RegExp(`Remediere ciclul 1[\\s\\S]*${finding.code}`), "the repair brief names the finding");
  } finally { await t.cleanup(); }
});

test("M03-FAC-04 INCONCLUSIVE review (missing context or another change set) waits for the owner; the owner may proceed to QA explicitly", async () => {
  const t = await factoryHub("bug-demo");
  try {
    const { mission } = await prepare(t, "bug-demo");
    t.queue("codex", "factory-write:bug-fix");
    t.queue("claude", "review:wrong-cs");
    await approveAndStart(t, mission.id);
    const waiting = await untilStage(t, mission.id, SETTLED);
    assert.equal(waiting.factory.stage, "NEEDS_OWNER_DECISION");
    assert.equal(waiting.reviews[0].verdict, "INCONCLUSIVE");
    assert.match(waiting.reviews[0].validation.problems.join(" "), /change set/);
    assert.equal(waiting.reviews[0].validation.claimedVerdict, "PASS", "a PASS for another version is not accepted");
    // Voice cannot take the owner's decision.
    await assert.rejects(dispatch(t.hub, "factory.resume", { missionId: mission.id, proceedToQa: true }, "voice"), /cannot be issued through voice/);
    await dispatch(t.hub, "factory.resume", { missionId: mission.id, proceedToQa: true }, "ui");
    const done = await untilStage(t, mission.id, ["DELIVERY_READY", "NEEDS_OWNER_DECISION", "BLOCKED"]);
    assert.equal(done.factory.stage, "DELIVERY_READY");
    const manifest = JSON.parse(t.hub.db.prepare("SELECT manifest_json FROM factory_bundles WHERE mission_id = ?").get(mission.id).manifest_json);
    assert.equal(manifest.spec.criteria.find((c) => c.id === "AC-3").status, "NEVERIFICAT", "review criterion stays unverified");
    assert.ok(t.hub.bus.query({ typePrefix: "factory.owner_override", limit: 5 }).length === 1);
  } finally { await t.cleanup(); }
});

test("M03-FAC-05 integrity: a writer that weakens the protected acceptance test is stopped before checks; a skipped test is never a pass", async () => {
  const t = await factoryHub("bug-demo");
  try {
    const { mission } = await prepare(t, "bug-demo");
    t.queue("codex", "factory-write:bug-tamper");
    await approveAndStart(t, mission.id);
    const tampered = await untilStage(t, mission.id, SETTLED);
    assert.equal(tampered.factory.stage, "NEEDS_OWNER_DECISION");
    assert.match(tampered.factory.stageReason, /protected_test_changed/);
    assert.ok(tampered.findings.some((f) => f.code.startsWith("I-") && f.severity === "critical"));
    assert.equal(tampered.evidence.filter((e) => e.stage === "CHECKING").length, 0, "no check ran on a tampered change set");
    assert.equal(tampered.reviews.length, 0);
  } finally { await t.cleanup(); }
  const s = await factoryHub("bug-demo");
  try {
    const { mission } = await prepare(s, "bug-demo", { limits: { maxRepairCycles: 0 } });
    s.queue("codex", "factory-write:bug-skip");
    await approveAndStart(s, mission.id);
    const skipped = await untilStage(s, mission.id, SETTLED);
    assert.equal(skipped.factory.stage, "NEEDS_OWNER_DECISION", "maxRepairCycles 0: no repair");
    assert.ok(skipped.findings.some((f) => f.source === "integrity" && /skip_added/.test(f.fingerprint)), "skip flagged by integrity");
    const check = skipped.evidence.find((e) => e.stage === "CHECKING" && e.counts.skipped > 0);
    assert.ok(check, "the runner counted the skipped test");
    assert.ok(skipped.findings.some((f) => f.source === "qa" && /sărite/.test(f.observation)));
  } finally { await s.cleanup(); }
});

test("M03-FAC-06 a repair without measurable progress stops; the owner's extra cycle then completes the mission", async () => {
  const t = await factoryHub("bug-demo");
  try {
    const { mission } = await prepare(t, "bug-demo");
    t.queue("codex", "factory-write:bug-partial", "factory-write:bug-partial2", "factory-write:bug-fix");
    t.queue("claude", "review:pass");
    await approveAndStart(t, mission.id);
    const stuck = await untilStage(t, mission.id, SETTLED);
    assert.equal(stuck.factory.stage, "NEEDS_OWNER_DECISION");
    assert.match(stuck.factory.stageReason, /fără progres/);
    assert.equal(stuck.factory.repairCycles, 1);
    await dispatch(t.hub, "factory.resume", { missionId: mission.id, allowExtraCycle: true }, "ui");
    const done = await untilStage(t, mission.id, ["DELIVERY_READY", "NEEDS_OWNER_DECISION", "BLOCKED"]);
    assert.equal(done.factory.stage, "DELIVERY_READY", done.factory.stageReason);
    assert.equal(done.factory.repairCycles, 2);
    assert.ok(t.hub.bus.query({ typePrefix: "factory.extra_cycle", limit: 5 }).length === 1);
  } finally { await t.cleanup(); }
});

test("M03-FAC-07 Stop during the writer's turn: CANCEL_REQUESTED → interrupt confirmed → CANCELLED; no review, no second writer, late output archived", async () => {
  const t = await factoryHub("bug-demo");
  try {
    const { mission } = await prepare(t, "bug-demo");
    t.queue("codex", "hang");
    await approveAndStart(t, mission.id);
    await waitFor(() => t.hub.runs.activeRuns().some((r) => r.provider === "codex") && view(t, mission.id).factory.stage === "IMPLEMENTING", 60000);
    await waitFor(() => t.hub.runs.activeRuns()[0]?.timeline?.turn_acknowledged, 30000);
    const stopped = (await dispatch(t.hub, "factory.stop", { missionId: mission.id, reason: "Test stop" }, "voice")).result;
    assert.ok(["CANCEL_REQUESTED", "CANCELLED"].includes(stopped.factory.stage));
    const done = await untilStage(t, mission.id, ["CANCELLED"]);
    assert.equal(done.runs[0].status, "interrupted");
    assert.equal(done.reviews.length, 0, "the next stage never started");
    assert.equal(done.changeSets.length, 0, "no change set from a cancelled turn");
    assert.equal(t.hub.runs.activeRuns().length, 0);
    assert.ok(done.tasks.filter((x) => x.status !== "COMPLETED").every((x) => x.status === "CANCELLED"));
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM factory_dispatches WHERE mission_id = ? AND stage = 'IMPLEMENTING'").get(mission.id).n, 1, "one writer dispatch only");
    assert.ok(t.hub.bus.query({ typePrefix: "factory.late_result", limit: 5 }).length >= 1, "the interrupted turn is archived as late");
    await assert.rejects(dispatch(t.hub, "factory.resume", { missionId: mission.id }, "ui"), /CANCELLED/);
  } finally { await t.cleanup(); }
});

test("M03-FAC-08 Stop All during review cancels the mission, suspends the gate, and resume is refused by the gate (no new stage)", async () => {
  const t = await factoryHub("bug-demo");
  try {
    const { mission } = await prepare(t, "bug-demo");
    t.queue("codex", "factory-write:bug-fix");
    t.queue("claude", "hang");
    await approveAndStart(t, mission.id);
    await waitFor(() => view(t, mission.id).factory.stage === "REVIEWING" && t.hub.runs.activeRuns().some((r) => r.provider === "claude"), 90000);
    const result = (await dispatch(t.hub, "system.stop_all", { reason: "Test Stop All" })).result;
    assert.equal(result.gate, "suspended");
    assert.equal(result.factoryMissions.length, 1);
    const done = await untilStage(t, mission.id, ["CANCELLED"]);
    assert.equal(done.reviews.length, 0, "no verdict recorded from an interrupted review");
    assert.equal(t.hub.settings.get("executionGate").status, "suspended");
  } finally { await t.cleanup(); }
});

test("M03-FAC-09 Pause during the writer's turn → PAUSED (no next stage); resume re-dispatches the same step as a new attempt, not a new cycle", async () => {
  const t = await factoryHub("bug-demo");
  try {
    const { mission } = await prepare(t, "bug-demo");
    t.queue("codex", "hang", "factory-write:bug-fix");
    t.queue("claude", "review:pass");
    await approveAndStart(t, mission.id);
    await waitFor(() => t.hub.runs.activeRuns()[0]?.timeline?.turn_acknowledged, 60000);
    await dispatch(t.hub, "factory.pause", { missionId: mission.id }, "voice");
    const paused = await untilStage(t, mission.id, ["PAUSED"]);
    await waitFor(() => t.hub.runs.activeRuns().length === 0, 20000);
    assert.equal(paused.changeSets.length, 0);
    await dispatch(t.hub, "factory.resume", { missionId: mission.id }, "ui");
    const done = await untilStage(t, mission.id, ["DELIVERY_READY", "NEEDS_OWNER_DECISION", "BLOCKED"]);
    assert.equal(done.factory.stage, "DELIVERY_READY", done.factory.stageReason);
    assert.equal(done.factory.repairCycles, 0, "resuming is not a repair cycle");
    const writes = done.dispatches.filter((d) => d.stage === "IMPLEMENTING");
    assert.deepEqual(writes.map((d) => d.request.attempt), [1, 2]);
    assert.equal(new Set(writes.map((d) => d.idempotencyKey)).size, 2);
  } finally { await t.cleanup(); }
});

test("M03-FAC-10 restart during a writer turn: nothing resumes by itself; the dispatch is INTERRUPTED_UNKNOWN and the mission waits for the owner", async () => {
  const t = await factoryHub("bug-demo");
  let second = null;
  try {
    const { mission } = await prepare(t, "bug-demo");
    t.queue("codex", "hang");
    await approveAndStart(t, mission.id);
    await waitFor(() => t.hub.runs.activeRuns()[0]?.timeline?.turn_acknowledged, 60000);
    const codexLaunches = () => t.readLog("codex").filter((l) => l.launchArgs).length;
    const before = codexLaunches();
    // Simulated crash: the Hub goes away mid-turn before the conductor can react to the run's end (a real crash leaves
    // the stage and the dispatch exactly like this; a graceful shutdown would have paused the mission instead).
    t.hub.factory.onRunFinished = async () => null;
    await t.hub.close();
    second = createHub(t.config, { homeDir: t.homeDir });
    const report = await second.boot();
    assert.equal(report.factory.length, 1);
    const v = second.factory.view(mission.id);
    assert.equal(v.factory.stage, "BLOCKED");
    assert.match(v.factory.stageReason, /repornit/);
    assert.equal(v.dispatches.at(-1).status, "INTERRUPTED_UNKNOWN");
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal(codexLaunches(), before, "no provider process was started after the restart");
    assert.equal(second.settings.get("mode"), "BUILD_SAFE", "every boot starts in BUILD_SAFE");
  } finally {
    if (second) await second.close();
    try { fs.rmSync(t.dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* left in .ifrim/tmp */ }
  }
});

test("M03-FAC-11 approvals: the scope approval is single-use and bound to the exact scope; a revised spec or a double start never starts twice", async () => {
  const t = await factoryHub("bug-demo");
  try {
    const { mission } = await prepare(t, "bug-demo");
    const scope = view(t, mission.id).scope;
    // A spec revised after the approval was requested: the stale approval cannot start the new scope.
    const requested = await dispatch(t.hub, "factory.start", scope);
    await dispatch(t.hub, "approval.decide", { approvalId: requested.approval.id, decision: "approved", displayedHash: requested.approval.payloadHash });
    await dispatch(t.hub, "factory.spec.revise", { missionId: mission.id, spec: { constraints: ["Fix minim", "Fără dependențe noi", "Mesaj neschimbat"] } }, "ui");
    await assert.rejects(t.hub.commands.executeApproved(requested.command.id, "user"), /schimbat după aprobare/);
    assert.equal(view(t, mission.id).factory.stage, "SPEC_DRAFT");
    // The new scope, approved, then executed twice (double click / second tab): one start only.
    t.queue("codex", "factory-write:bug-fix");
    t.queue("claude", "review:pass");
    const fresh = view(t, mission.id).scope;
    assert.equal(fresh.specVersion, 2);
    const again = await dispatch(t.hub, "factory.start", fresh);
    await dispatch(t.hub, "approval.decide", { approvalId: again.approval.id, decision: "approved", displayedHash: again.approval.payloadHash });
    const [a, b] = await Promise.allSettled([t.hub.commands.executeApproved(again.command.id, "user"), t.hub.commands.executeApproved(again.command.id, "user")]);
    assert.equal([a, b].filter((r) => r.status === "fulfilled").length, 1, "exactly one start");
    assert.match(String([a, b].find((r) => r.status === "rejected").reason.message), /already starting|Command is executed|consumed|Command is/);
    const done = await untilStage(t, mission.id, ["DELIVERY_READY", "NEEDS_OWNER_DECISION", "BLOCKED"]);
    assert.equal(done.factory.stage, "DELIVERY_READY");
    assert.equal(done.dispatches.filter((d) => d.stage === "IMPLEMENTING").length, 1);
  } finally { await t.cleanup(); }
});

test("M03-FAC-12 a revoked grant between approval and dispatch blocks the writer at the gate (wait reason: grant), and resume continues once a grant exists", async () => {
  const t = await factoryHub("bug-demo");
  try {
    const { mission } = await prepare(t, "bug-demo");
    for (const g of t.hub.grants.activeForProject(t.project.id)) t.hub.bus.transaction(() => t.hub.grants.revoke(g.id, "test"));
    await approveAndStart(t, mission.id);
    const blocked = await untilStage(t, mission.id, SETTLED);
    assert.equal(blocked.factory.stage, "BLOCKED");
    assert.equal(blocked.factory.waitReason, "grant");
    assert.ok(blocked.runs.every((r) => r.status === "blocked"), "the refused start is recorded as blocked; no provider process ran");
    assert.equal(t.readLog("codex").filter((l) => l.launchArgs && l.launchArgs.includes("app-server") && l.launchArgs.some((a) => a.startsWith("model_reasoning_effort="))).length, 0);
    assert.equal(blocked.dispatches.at(-1).status, "FAILED");
    t.hub.bus.transaction(() => {
      t.hub.grants.create({ provider: "codex", projectId: t.project.id, access: "workspace-write", maxAttempts: 2, maxDurationS: 900, ttlMinutes: 60 }, "test");
      t.hub.grants.create({ provider: "claude", projectId: t.project.id, access: "read-only", maxAttempts: 2, maxDurationS: 900, ttlMinutes: 60 }, "test");
    });
    t.queue("codex", "factory-write:bug-fix");
    t.queue("claude", "review:pass");
    await dispatch(t.hub, "factory.resume", { missionId: mission.id }, "ui");
    const done = await untilStage(t, mission.id, ["DELIVERY_READY", "NEEDS_OWNER_DECISION", "BLOCKED"]);
    assert.equal(done.factory.stage, "DELIVERY_READY", done.factory.stageReason);
  } finally { await t.cleanup(); }
});

test("M03-FAC-13 one writer per workspace: a second factory mission on the same project cannot start while the first is active", async () => {
  const t = await factoryHub("bug-demo");
  try {
    const first = (await prepare(t, "bug-demo")).mission;
    const second = (await prepare(t, "bug-demo")).mission;
    t.queue("codex", "hang");
    await approveAndStart(t, first.id);
    await waitFor(() => view(t, first.id).factory.stage === "IMPLEMENTING", 60000);
    const requested = await dispatch(t.hub, "factory.start", view(t, second.id).scope);
    await dispatch(t.hub, "approval.decide", { approvalId: requested.approval.id, decision: "approved", displayedHash: requested.approval.payloadHash });
    await assert.rejects(t.hub.commands.executeApproved(requested.command.id, "user"), /un singur writer/);
    await dispatch(t.hub, "factory.stop", { missionId: first.id }, "ui");
    await untilStage(t, first.id, ["CANCELLED"]);
  } finally { await t.cleanup(); }
});


test("M03-FAC-14 Pause during a runner check (the checks hang): the mission stays PAUSED, the killed check is INTERRUPTED (not a failure) and no repair run starts", async () => {
  fs.rmSync(RELEASE, { force: true });
  const t = await factoryHub("bug-demo");
  try {
    const { mission } = await prepare(t, "bug-demo");
    t.queue("codex", "factory-write:bug-hang");
    t.queue("claude", "review:pass");
    await approveAndStart(t, mission.id);
    await waitFor(() => (view(t, mission.id).factory.stage === "CHECKING" && t.hub.supervisor.list().some((p) => p.key.startsWith(`factory-run-${mission.id}-CHECKING`)) ? true : null), 90000, 100);
    await dispatch(t.hub, "factory.pause", { missionId: mission.id }, "voice");
    await waitFor(() => (t.hub.supervisor.list().some((p) => p.key.startsWith(`factory-run-${mission.id}-`)) ? null : true), 20000, 100);
    await new Promise((r) => setTimeout(r, 1500)); // time for a wrongly scheduled repair to show up
    const paused = view(t, mission.id);
    assert.equal(paused.factory.stage, "PAUSED", paused.factory.stageReason);
    assert.deepEqual(paused.dispatches.map((d) => d.stage), ["IMPLEMENTING"], "no repair (model) run against the pause");
    const killed = paused.evidence.filter((e) => e.stage === "CHECKING");
    assert.equal(killed.length, 1);
    assert.equal(killed[0].status, "INTERRUPTED");
    assert.equal(killed[0].stale, true, "an interrupted check is never counted");
    assert.equal(paused.findings.filter((x) => x.source === "qa").length, 0, "no finding from a killed command");
    const stopped = (await dispatch(t.hub, "factory.stop", { missionId: mission.id }, "ui")).result;
    assert.equal(stopped.factory.stage, "CANCELLED");
  } finally { await t.cleanup(); }
});

test("M03-FAC-15 a browser that cannot start is an infrastructure problem: the mission is BLOCKED (runner), no E2E finding, no repair run", async () => {
  const port = 47000 + Math.floor(Math.random() * 1500);
  const launch = async () => { throw new Error("browserType.launch: Executable doesn't exist (simulated)"); };
  const t = await factoryHub("service-request", { port, hubOptions: { browserLaunch: launch } });
  try {
    const { mission } = await prepare(t, "service-request", { port });
    t.queue("codex", "factory-write:feature-b");
    t.queue("claude", "review:pass");
    await approveAndStart(t, mission.id);
    const done = await untilStage(t, mission.id, SETTLED, 150000);
    assert.equal(done.factory.stage, "BLOCKED", done.factory.stageReason);
    assert.equal(done.factory.waitReason, "runner");
    assert.match(done.factory.stageReason, /infrastructura browserului/);
    const e2e = done.evidence.find((e) => e.stage === "E2E");
    assert.equal(e2e.status, "BLOCKED");
    assert.equal(done.findings.filter((x) => x.area === "e2e").length, 0, "not reported as a product defect");
    assert.ok(!done.dispatches.some((d) => d.stage === "REPAIRING"), "no repair run for an infrastructure problem");
    assert.ok(!t.hub.supervisor.list().some((p) => p.key === `factory-preview-${mission.id}`), "the preview is stopped");
    assert.equal((await dispatch(t.hub, "factory.stop", { missionId: mission.id }, "ui")).result.factory.stage, "CANCELLED");
  } finally { await t.cleanup(); }
});

test("M03-FAC-16 a BLOCKED baseline (runner not ready) is run again on resume: the writer never starts without a complete baseline", async () => {
  const t = await factoryHub("bug-demo");
  try {
    const { mission } = await prepare(t, "bug-demo");
    t.queue("codex", "factory-write:bug-fix");
    t.queue("claude", "review:pass");
    // The first runner call answers like a sandbox that is not ready (e.g. the ACL consent is missing): nothing runs.
    const realRun = t.hub.factoryRunner.run;
    let refused = 0;
    t.hub.factoryRunner.run = (args) => (refused++ === 0 ? Promise.resolve({ command: args.command, runner: "codex-sandbox", status: "BLOCKED", reason: "NEEDS_LIVE_APPROVAL (simulat)", exitCode: null, counts: {}, failures: [], durationMs: 0, outputTail: "", isolation: "none" }) : realRun(args));
    await approveAndStart(t, mission.id);
    const blocked = await untilStage(t, mission.id, SETTLED);
    assert.equal(blocked.factory.stage, "BLOCKED");
    assert.equal(blocked.factory.waitReason, "runner");
    assert.equal(blocked.dispatches.length, 0, "no writer while the baseline did not run");
    const resumed = (await dispatch(t.hub, "factory.resume", { missionId: mission.id }, "ui")).result;
    assert.equal(resumed.factory.stage, "BASELINE", "resume runs the baseline again instead of starting the writer");
    const done = await untilStage(t, mission.id, ["DELIVERY_READY", "NEEDS_OWNER_DECISION", "BLOCKED"]);
    assert.equal(done.factory.stage, "DELIVERY_READY", done.factory.stageReason);
    const baseline = done.evidence.filter((e) => e.stage === "BASELINE");
    assert.deepEqual(baseline.map((e) => [e.status, e.stale]), [["BLOCKED", true], ["FAIL", false]], "the blocked attempt is superseded by a real red baseline");
    assert.equal(done.dispatches.filter((d) => d.stage === "IMPLEMENTING").length, 1);
  } finally { await t.cleanup(); }
});

test("M03-FAC-17 Pause during the 2nd of two checks, then resume: every check runs again on that change set before a single review", async () => {
  fs.rmSync(RELEASE, { force: true });
  const t = await factoryHub("bug-demo");
  try {
    const input = demoSpec("bug-demo");
    input.spec.verification.checks = ["node --test test/unit.test.mjs", "node --test"];
    const { mission } = (await dispatch(t.hub, "factory.prepare", { projectId: t.project.id, ...input })).result;
    t.queue("codex", "factory-write:bug-hang");
    t.queue("claude", "review:pass");
    await approveAndStart(t, mission.id);
    await waitFor(() => (t.hub.supervisor.list().some((p) => p.key === `factory-run-${mission.id}-CHECKING-1`) ? true : null), 90000, 100);
    await dispatch(t.hub, "factory.pause", { missionId: mission.id }, "ui");
    await waitFor(() => (t.hub.supervisor.list().some((p) => p.key.startsWith(`factory-run-${mission.id}-`)) ? null : true), 20000, 100);
    const paused = view(t, mission.id);
    assert.equal(paused.factory.stage, "PAUSED");
    assert.ok(paused.tasks.some((x) => x.status === "PAUSED") && !paused.tasks.some((x) => x.status === "RUNNING"), "the interrupted check task is PAUSED, not RUNNING");
    fs.writeFileSync(RELEASE, "1");
    const resumed = (await dispatch(t.hub, "factory.resume", { missionId: mission.id }, "ui")).result;
    assert.equal(resumed.factory.stage, "CHECKING", "a partial set of checks is never treated as complete");
    const done = await untilStage(t, mission.id, ["DELIVERY_READY", "NEEDS_OWNER_DECISION", "BLOCKED"], 120000);
    assert.equal(done.factory.stage, "DELIVERY_READY", done.factory.stageReason);
    const live = done.evidence.filter((e) => e.stage === "CHECKING" && !e.stale);
    assert.deepEqual(live.map((e) => [e.command, e.status]), [["node --test test/unit.test.mjs", "PASS"], ["node --test", "PASS"]]);
    assert.equal(done.dispatches.filter((d) => d.stage === "REVIEWING").length, 1, "exactly one review, after the complete checks");
  } finally { fs.rmSync(RELEASE, { force: true }); await t.cleanup(); }
});

test("M03-FAC-18 the time limit reached while a preview is starting: NEEDS_OWNER_DECISION holds; no preview, E2E or bundle afterwards; resume extends the limit", async () => {
  const port = 45500 + Math.floor(Math.random() * 400);
  const t = await factoryHub("service-request", { port });
  try {
    const { mission } = await prepare(t, "service-request", { port });
    t.queue("codex", "factory-write:feature-b");
    t.queue("claude", "review:pass");
    const realStart = t.hub.factoryRunner.startPreview;
    t.hub.factoryRunner.startPreview = async (args) => {
      t.hub.db.prepare("UPDATE factory_missions SET deadline_at = ? WHERE mission_id = ?").run(new Date(Date.now() - 1000).toISOString(), mission.id);
      await t.hub.factory.tick();
      return realStart(args);
    };
    await approveAndStart(t, mission.id);
    const waiting = await untilStage(t, mission.id, ["NEEDS_OWNER_DECISION", "DELIVERY_READY", "BLOCKED"], 150000);
    await idleWithin(t, mission.id); // the step that was in flight (the preview start) has finished
    assert.ok(!t.hub.supervisor.list().some((p) => p.key === `factory-preview-${mission.id}`), "the preview started after the deadline was stopped again");
    const after = view(t, mission.id);
    assert.equal(after.factory.stage, "NEEDS_OWNER_DECISION", after.factory.stageReason);
    assert.equal(waiting.factory.stage, "NEEDS_OWNER_DECISION");
    assert.ok(!after.evidence.some((e) => e.stage === "PREVIEW" || e.stage === "E2E"), "the step in flight is not interpreted");
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM factory_bundles WHERE mission_id = ?").get(mission.id).n, 0, "no bundle without the owner");
    t.hub.factoryRunner.startPreview = realStart;
    await dispatch(t.hub, "factory.resume", { missionId: mission.id }, "ui");
    assert.ok(new Date(view(t, mission.id).factory.deadlineAt) > new Date(), "resuming is the owner's decision to continue: a new time window");
    assert.equal(t.hub.bus.query({ typePrefix: "factory.deadline_extended", limit: 5 }).length, 1);
    await dispatch(t.hub, "factory.stop", { missionId: mission.id }, "ui");
    await untilStage(t, mission.id, ["CANCELLED"]);
  } finally { await t.cleanup(); }
});

/** factory.idle() resolves once the mission's chain has drained (bounded here so a regression fails instead of hanging). */
const idleWithin = (t, missionId, ms = 30000) => Promise.race([t.hub.factory.idle(missionId), new Promise((_, reject) => setTimeout(() => reject(new Error("factory.idle() did not settle")), ms).unref())]);

/** Makes the pre-run backup slow, so a Pause / Stop lands while runs.start is still in flight (the run is not visible yet). */
function slowBackups(t, ms = 2500) {
  const real = t.hub.backups.run;
  t.hub.backups.run = async (...args) => { await new Promise((r) => setTimeout(r, ms)); return real(...args); };
}
const startInFlight = (t, missionId) => waitFor(() => {
  const v = view(t, missionId);
  return v.dispatches.some((d) => d.status === "CLAIMED") && t.hub.runs.activeRuns().length === 0 ? true : null;
}, 60000, 20);

test("M03-FAC-19 Pause while the writer's run is still starting (slow backup): the run is interrupted as soon as it exists; resume makes a new attempt", async () => {
  const t = await factoryHub("bug-demo");
  try {
    const { mission } = await prepare(t, "bug-demo");
    t.queue("codex", "hang", "factory-write:bug-fix");
    t.queue("claude", "review:pass");
    slowBackups(t);
    await approveAndStart(t, mission.id);
    await startInFlight(t, mission.id);
    await dispatch(t.hub, "factory.pause", { missionId: mission.id }, "ui");
    // The run that appeared after the pause is interrupted at once: an owner interruption, not a failed attempt.
    const first = await waitFor(() => view(t, mission.id).dispatches.find((d) => d.stage === "IMPLEMENTING" && d.status === "INTERRUPTED" && d.runId) || null, 60000, 100);
    await idleWithin(t, mission.id);
    const paused = view(t, mission.id);
    assert.equal(paused.factory.stage, "PAUSED");
    assert.equal(paused.changeSets.length, 0);
    assert.equal(t.hub.runs.activeRuns().length, 0);
    assert.equal(t.hub.runs.getRun(first.runId).status, "interrupted");
    await dispatch(t.hub, "factory.resume", { missionId: mission.id }, "ui");
    const done = await untilStage(t, mission.id, ["DELIVERY_READY", "NEEDS_OWNER_DECISION", "BLOCKED"]);
    assert.equal(done.factory.stage, "DELIVERY_READY", done.factory.stageReason);
    assert.deepEqual(done.dispatches.filter((d) => d.stage === "IMPLEMENTING").map((d) => [d.request.attempt, d.request.counted, d.status]), [[1, 1, "INTERRUPTED"], [2, 1, "DONE"]], "the paused attempt does not count against the limit");
  } finally { await t.cleanup(); }
});

test("M03-FAC-20 Stop while the writer's run is still starting: CANCELLED is confirmed only after the run is gone and never turns into BLOCKED", async () => {
  const t = await factoryHub("bug-demo");
  try {
    const { mission } = await prepare(t, "bug-demo");
    t.queue("codex", "hang");
    slowBackups(t);
    await approveAndStart(t, mission.id);
    await startInFlight(t, mission.id);
    const stopping = (await dispatch(t.hub, "factory.stop", { missionId: mission.id }, "ui")).result;
    assert.equal(stopping.factory.stage, "CANCEL_REQUESTED", "the start in flight is not ignored");
    const done = await untilStage(t, mission.id, ["CANCELLED", "BLOCKED"], 60000);
    assert.equal(done.factory.stage, "CANCELLED");
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal(view(t, mission.id).factory.stage, "CANCELLED", "a late step cannot reopen a cancelled mission");
    assert.equal(t.hub.runs.activeRuns().length, 0);
    const stages = t.hub.bus.query({ typePrefix: "factory.stage", limit: 50 }).filter((e) => e.scopeId === mission.id).map((e) => e.payload.stage);
    assert.ok(!stages.includes("BLOCKED"), stages.join(" → "));
  } finally { await t.cleanup(); }
});

test("M03-FAC-21 a start refused before any process (adapter policy) is seen: the mission becomes BLOCKED with the real reason, not 'the model is working'", async () => {
  const t = await factoryHub("bug-demo");
  try {
    // The shape codex.mjs returns when the MCP launch plan has a problem: `done` is already settled when runs.start returns.
    t.hub.providers.codex.startTurn = ({ runId }) => ({ key: `run-${runId}`, pid: null, interrupt: async () => ({ interrupted: false }),
      done: Promise.resolve({ status: "failed", errorCategory: "policy", preInference: true, error: "MCP plan problem (simulated)", output: "", usage: {} }) });
    const { mission } = await prepare(t, "bug-demo");
    await approveAndStart(t, mission.id);
    const done = await untilStage(t, mission.id, SETTLED);
    await idleWithin(t, mission.id);
    const v = view(t, mission.id);
    assert.equal(v.factory.stage, "BLOCKED", v.factory.stageReason);
    assert.match(v.factory.stageReason, /policy/);
    assert.equal(done.dispatches.at(-1).status, "FAILED");
    assert.equal(t.hub.runs.activeRuns().length, 0);
  } finally { await t.cleanup(); }
});

test("M03-FAC-22 pauses are the owner's decisions, not attempts: with one attempt per stage, two pauses of the writer still leave a way forward", async () => {
  const t = await factoryHub("bug-demo");
  try {
    const { mission } = await prepare(t, "bug-demo", { limits: { maxAttemptsPerStage: 1 } });
    t.queue("codex", "hang", "hang", "factory-write:bug-fix");
    t.queue("claude", "review:pass");
    await approveAndStart(t, mission.id);
    for (let i = 0; i < 2; i += 1) {
      await waitFor(() => t.hub.runs.activeRuns()[0]?.timeline?.turn_acknowledged, 60000);
      await dispatch(t.hub, "factory.pause", { missionId: mission.id }, "ui");
      await untilStage(t, mission.id, ["PAUSED"]);
      await waitFor(() => (t.hub.runs.activeRuns().length === 0 ? true : null), 20000);
      await idleWithin(t, mission.id);
      const resumed = (await dispatch(t.hub, "factory.resume", { missionId: mission.id }, "ui")).result;
      assert.equal(resumed.factory.stage, "IMPLEMENTING", resumed.factory.stageReason);
    }
    const done = await untilStage(t, mission.id, ["DELIVERY_READY", "NEEDS_OWNER_DECISION", "BLOCKED"]);
    assert.equal(done.factory.stage, "DELIVERY_READY", done.factory.stageReason);
    assert.deepEqual(done.dispatches.filter((d) => d.stage === "IMPLEMENTING").map((d) => d.status), ["INTERRUPTED", "INTERRUPTED", "DONE"]);
  } finally { await t.cleanup(); }
});

test("M03-FAC-23 'one more cycle' after a failed QA runs the repair writer (not QA again on the same code) and the budget is never lowered", async () => {
  const t = await factoryHub("bug-demo");
  try {
    const input = demoSpec("bug-demo");
    input.spec.verification.checks = ["node --test test/unit.test.mjs"]; // the checks pass, the acceptance test (QA) does not
    const { mission } = (await dispatch(t.hub, "factory.prepare", { projectId: t.project.id, ...input, limits: { maxRepairCycles: 1 } })).result;
    t.queue("codex", "factory-write:bug-partial", "factory-write:bug-partial2", "factory-write:bug-fix");
    t.queue("claude", "review:pass", "review:pass", "review:pass");
    await approveAndStart(t, mission.id);
    const decision = await untilStage(t, mission.id, ["DELIVERY_READY", "NEEDS_OWNER_DECISION", "BLOCKED"]);
    await idleWithin(t, mission.id);
    assert.equal(decision.factory.stage, "NEEDS_OWNER_DECISION", decision.factory.stageReason);
    assert.equal(view(t, mission.id).factory.repairCycles, 1);
    const resumed = (await dispatch(t.hub, "factory.resume", { missionId: mission.id, allowExtraCycle: true }, "ui")).result;
    assert.equal(resumed.factory.stage, "REPAIRING", "the extra cycle goes to the writer");
    assert.equal(resumed.factory.limits.maxRepairCycles, 2);
    const done = await untilStage(t, mission.id, ["DELIVERY_READY", "NEEDS_OWNER_DECISION", "BLOCKED"]);
    assert.equal(done.factory.stage, "DELIVERY_READY", done.factory.stageReason);
    assert.equal(done.dispatches.filter((d) => d.stage === "REPAIRING").length, 2);
  } finally { await t.cleanup(); }
});

test("M03-FAC-24 a skipped test is never a pass, also on a plain resume: the mission stays with the owner, no review starts", async () => {
  const t = await factoryHub("bug-demo");
  try {
    const { mission } = await prepare(t, "bug-demo", { limits: { maxRepairCycles: 0 } });
    t.queue("codex", "factory-write:bug-skip");
    t.queue("claude", "review:pass");
    await approveAndStart(t, mission.id);
    const first = await untilStage(t, mission.id, ["DELIVERY_READY", "NEEDS_OWNER_DECISION", "BLOCKED"]);
    await idleWithin(t, mission.id);
    assert.equal(first.factory.stage, "NEEDS_OWNER_DECISION", first.factory.stageReason);
    const resumed = (await dispatch(t.hub, "factory.resume", { missionId: mission.id }, "ui")).result;
    await idleWithin(t, mission.id);
    const after = view(t, mission.id);
    assert.notEqual(resumed.factory.stage, "REVIEWING");
    assert.equal(after.factory.stage, "NEEDS_OWNER_DECISION", after.factory.stageReason);
    assert.ok(!after.dispatches.some((d) => d.stage === "REVIEWING"), "no review of a version with a skipped test");
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM factory_bundles WHERE mission_id = ?").get(mission.id).n, 0);
  } finally { await t.cleanup(); }
});

test("M03-FAC-25 attempts really used up: a plain resume is the owner's decision to allow one more attempt (never a dead end), recorded as an event", async () => {
  const t = await factoryHub("bug-demo");
  try {
    const { mission } = await prepare(t, "bug-demo", { limits: { maxAttemptsPerStage: 1 } });
    t.queue("codex", "fail", "factory-write:bug-fix");
    t.queue("claude", "review:pass");
    await approveAndStart(t, mission.id);
    const failed = await untilStage(t, mission.id, ["BLOCKED", "NEEDS_OWNER_DECISION", "DELIVERY_READY"]);
    await idleWithin(t, mission.id);
    assert.equal(failed.factory.stage, "BLOCKED", failed.factory.stageReason);
    await dispatch(t.hub, "factory.resume", { missionId: mission.id }, "ui");
    const exhausted = await untilStage(t, mission.id, ["NEEDS_OWNER_DECISION", "DELIVERY_READY", "BLOCKED"]);
    await idleWithin(t, mission.id);
    assert.equal(exhausted.factory.stage, "NEEDS_OWNER_DECISION");
    assert.match(exhausted.factory.stageReason, /încercări folosite/);
    const resumed = (await dispatch(t.hub, "factory.resume", { missionId: mission.id }, "ui")).result;
    assert.equal(resumed.factory.limits.maxAttemptsPerStage, 2);
    assert.equal(t.hub.bus.query({ typePrefix: "factory.extra_attempt", limit: 5 }).length, 1);
    const done = await untilStage(t, mission.id, ["DELIVERY_READY", "NEEDS_OWNER_DECISION", "BLOCKED"]);
    assert.equal(done.factory.stage, "DELIVERY_READY", done.factory.stageReason);
  } finally { await t.cleanup(); }
});

test("M03-FAC-26 the account's Claude default (Fable) is refused before the model; on resume the owner picks an allowed reviewer model, which is sent with --model; the refused start is not an attempt", async () => {
  const t = await factoryHub("bug-demo");
  try {
    const { mission } = await prepare(t, "bug-demo", { limits: { maxAttemptsPerStage: 1 } });
    t.queue("codex", "factory-write:bug-fix");
    t.queue("claude", "init-fable", "review:pass");
    await approveAndStart(t, mission.id);
    const refused = await untilStage(t, mission.id, ["BLOCKED", "NEEDS_OWNER_DECISION", "DELIVERY_READY"]);
    await idleWithin(t, mission.id);
    assert.equal(refused.factory.stage, "BLOCKED", refused.factory.stageReason);
    assert.match(refused.factory.stageReason, /billing/);
    for (const bad of ["fable", "best", "sonnet[1m]", "claude-fable-5", "--model x", "default", "fable5", "sonet"]) {
      await assert.rejects(dispatch(t.hub, "factory.resume", { missionId: mission.id, reviewerModel: bad }, "ui"), /nu e permis|validation/i, bad);
    }
    assert.equal(view(t, mission.id).factory.stage, "BLOCKED", "a refused choice changes nothing");
    // Chosen together with another decision of the same resume (an extra cycle): the model choice is kept.
    const resumed = (await dispatch(t.hub, "factory.resume", { missionId: mission.id, reviewerModel: "sonnet", allowExtraCycle: true }, "ui")).result;
    assert.equal(resumed.factory.limits.reviewerModel, "sonnet");
    assert.equal(view(t, mission.id).factory.limits.reviewerModel, "sonnet", "stored, not overwritten by the extra-cycle limits");
    const done = await untilStage(t, mission.id, ["DELIVERY_READY", "NEEDS_OWNER_DECISION", "BLOCKED"]);
    assert.equal(done.factory.stage, "DELIVERY_READY", done.factory.stageReason);
    const reviews = done.dispatches.filter((d) => d.stage === "REVIEWING");
    assert.deepEqual(reviews.map((d) => [d.status, d.request.model]), [["FAILED", ""], ["DONE", "sonnet"]]);
    assert.equal(reviews[1].request.counted, 1, "the start stopped before the model is not an attempt (limit 1 still allows the review)");
    const invocations = t.readLog("claude").filter((e) => Array.isArray(e.args) && e.args.includes("-p"));
    const last = invocations.at(-1).args;
    assert.equal(last[last.indexOf("--model") + 1], "sonnet", "the chosen model is sent explicitly");
    assert.equal(t.hub.bus.query({ typePrefix: "factory.model_override", limit: 5 }).length, 1);
  } finally { await t.cleanup(); }
});

test("M03-FAC-27 Claude can never switch models on its own: a fallbackModel in the user settings refuses the start before the model; a model switch during the run stops it at once", async () => {
  const t = await factoryHub("bug-demo");
  const settings = path.join(t.homeDir, ".claude", "settings.json");
  try {
    const { mission } = await prepare(t, "bug-demo");
    t.queue("codex", "factory-write:bug-fix");
    t.queue("claude", "fallback-fable", "review:pass");
    fs.writeFileSync(settings, JSON.stringify({ fallbackModel: ["fable"] }));
    await approveAndStart(t, mission.id);
    const refused = await untilStage(t, mission.id, ["BLOCKED", "NEEDS_OWNER_DECISION", "DELIVERY_READY"]);
    await idleWithin(t, mission.id);
    assert.equal(refused.factory.stage, "BLOCKED");
    assert.match(refused.factory.stageReason, /fallbackModel/);
    assert.equal(t.readLog("claude").filter((e) => Array.isArray(e.args) && e.args.includes("-p")).length, 0, "no Claude process was started");
    fs.rmSync(settings, { force: true });
    await dispatch(t.hub, "factory.resume", { missionId: mission.id, reviewerModel: "sonnet" }, "ui");
    const switched = await untilStage(t, mission.id, ["BLOCKED", "NEEDS_OWNER_DECISION", "DELIVERY_READY"]);
    await idleWithin(t, mission.id);
    assert.equal(switched.factory.stage, "BLOCKED");
    assert.match(switched.factory.stageReason, /comutat modelul/);
    assert.equal(switched.reviews.length, 0, "a review from a switched model is never recorded");
    await dispatch(t.hub, "factory.resume", { missionId: mission.id }, "ui");
    const done = await untilStage(t, mission.id, ["DELIVERY_READY", "NEEDS_OWNER_DECISION", "BLOCKED"]);
    assert.equal(done.factory.stage, "DELIVERY_READY", done.factory.stageReason);
  } finally { fs.rmSync(settings, { force: true }); await t.cleanup(); }
});

test("M03-FAC-28 a writer turn that changed nothing (live probe 2.3: its commands timed out on a cold sandbox): resume re-runs IMPLEMENTING, it does not check an empty change set", async () => {
  const t = await factoryHub("bug-demo");
  try {
    const { mission } = await prepare(t, "bug-demo");
    t.queue("codex", "ok", "factory-write:bug-fix");
    t.queue("claude", "review:pass");
    await approveAndStart(t, mission.id);
    const empty = await untilStage(t, mission.id, SETTLED);
    assert.equal(empty.factory.stage, "NEEDS_OWNER_DECISION");
    assert.match(empty.factory.stageReason || "", /nu a modificat niciun fișier/);
    const resumed = (await dispatch(t.hub, "factory.resume", { missionId: mission.id }, "ui")).result;
    assert.equal(resumed.factory.stage, "IMPLEMENTING", "the writer runs again");
    const done = await untilStage(t, mission.id, ["DELIVERY_READY", "NEEDS_OWNER_DECISION", "BLOCKED"]);
    assert.equal(done.factory.stage, "DELIVERY_READY", done.factory.stageReason);
    assert.equal(done.factory.repairCycles, 0, "no repair cycle was spent on the empty change set");
    assert.ok(!done.evidence.some((e) => e.stage === "CHECKING" && e.changeSetId === done.changeSets[0].id), "the empty change set was never checked");
  } finally { await t.cleanup(); }
});
