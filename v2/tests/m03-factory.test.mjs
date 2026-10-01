// Milestone 03 — Software Factory, simulated end to end (PASS_SIMULATED: fake Codex writer, fake Claude reviewer, fake
// sandbox runner). No model, no network, nothing outside .ifrim/tmp. Proves the orchestration and its guarantees, not the
// quality of a model.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeTestHub, enableLive, waitFor } from "./helpers.mjs";
import { materializeFixture, demoSpec } from "../server/factory/fixtures.mjs";

const dispatch = (hub, type, payload, channel = "test") => hub.commands.dispatch({ type, payload, channel, actor: "test" });

/** A test hub with scenario queues, a registered fixture test project and run grants for writer + reviewer. */
async function factoryHub(fixture = "bug-demo", { attempts = 4, port = null } = {}) {
  const t = await makeTestHub({ queues: true });
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

async function prepare(t, fixture, options = {}) {
  const view = (await dispatch(t.hub, "factory.prepare", { projectId: t.project.id, ...demoSpec(fixture, options) })).result;
  return view;
}

/** factory.start goes through the approval engine (ALWAYS_ASK): request → owner decides in the UI → execute. */
async function approveAndStart(t, missionId, scope = t.hub.factory.view(missionId).scope) {
  const requested = await dispatch(t.hub, "factory.start", scope);
  assert.equal(requested.approvalRequired, true, "starting a factory mission needs the owner's approval");
  await dispatch(t.hub, "approval.decide", { approvalId: requested.approval.id, decision: "approved", displayedHash: requested.approval.payloadHash });
  return t.hub.commands.executeApproved(requested.command.id, "user");
}

const stageOf = (t, missionId) => t.hub.factory.view(missionId).factory.stage;
const untilStage = (t, missionId, stages, ms = 60000) => waitFor(() => (stages.includes(stageOf(t, missionId)) ? t.hub.factory.view(missionId) : null), ms, 100);

test("M03-FAC-01 Demo A (BUGFIX) simulated: spec v1 → approved scope → red baseline → writer → checks → review PASS → QA → bundle → owner accepts", async () => {
  const t = await factoryHub("bug-demo");
  try {
    const prepared = await prepare(t, "bug-demo");
    const missionId = prepared.mission.id;
    assert.equal(prepared.factory.stage, "SPEC_DRAFT");
    assert.equal(prepared.spec.version, 1);
    assert.deepEqual(prepared.specs[0].problems, [], "the demo spec is complete");
    assert.equal(prepared.plan.steps.filter((s) => s.runner === "writer").length, 1, "one writer");
    assert.equal(prepared.plan.steps.find((s) => s.key === "review").provider, "claude");
    t.queue("codex", "factory-write:bug-fix");
    t.queue("claude", "review:pass");
    const started = await approveAndStart(t, missionId);
    assert.equal(started.result.factory.stage, "BASELINE");
    const done = await untilStage(t, missionId, ["DELIVERY_READY", "NEEDS_OWNER_DECISION", "BLOCKED"]);
    assert.equal(done.factory.stage, "DELIVERY_READY", done.factory.stageReason);

    const baseline = done.evidence.find((e) => e.stage === "BASELINE");
    assert.equal(baseline.status, "FAIL", "the independent acceptance test fails before the fix");
    assert.ok(baseline.counts.fail >= 1);
    const cs = done.changeSets.find((c) => c.status === "CURRENT");
    assert.deepEqual(cs.changes.map((c) => `${c.status} ${c.path}`).sort(), ["added test/regression.test.mjs", "modified src/requests.js"]);
    assert.match(cs.diffText, /input\.name\.trim\(\)/);
    assert.ok(done.evidence.filter((e) => e.stage === "CHECKING").every((e) => e.status === "PASS" && e.counts.tests > 0));
    assert.equal(done.reviews.length, 1);
    assert.equal(done.reviews[0].verdict, "PASS");
    assert.equal(done.reviews[0].status, "VALID");
    assert.equal(done.reviews[0].changeSetSha, cs.sha256, "the verdict is bound to the exact change set");
    assert.ok(done.evidence.filter((e) => e.stage === "QA").every((e) => e.status === "PASS"));
    assert.ok(done.evidence.every((e) => /SIMULATED/.test(e.isolation)), "fixture runner results are labelled as simulated");

    // Runs: explicit model/effort (BALANCED → medium), a timeline, one writer + one reviewer, both read from dispatch rows.
    assert.equal(done.runs.length, 2);
    const [writer, reviewer] = done.runs;
    assert.deepEqual([writer.provider, writer.access, writer.status], ["codex", "workspace-write", "completed"]);
    assert.deepEqual([reviewer.provider, reviewer.access, reviewer.status], ["claude", "read-only", "completed"]);
    assert.equal(writer.effort, "medium");
    assert.equal(writer.plan.effortSource, "profil BALANCED");
    assert.equal(writer.plan.reported.effort, "medium", "thread/start reported the effort the Hub set");
    assert.equal(writer.model, "gpt-fake-sol");
    for (const phase of ["dispatch", "gate_checked", "lease_acquired", "backup_ready", "process_spawned", "thread_ready", "mcp_checked", "turn_sent", "first_command_started", "first_file_change", "finished"]) {
      assert.ok(writer.timeline.phases.some((p) => p.phase === phase), `writer timeline has ${phase}`);
    }
    assert.ok(writer.timeline.keySpans.hubAdmissionMs >= 0);

    const bundle = done.bundles.at(-1);
    assert.equal(bundle.status, "READY_FOR_OWNER_ACCEPTANCE");
    assert.equal(bundle.change_set_sha, cs.sha256);
    assert.ok(fs.existsSync(path.join(t.config.hubRoot, bundle.file_path)), "the Markdown bundle exists");
    const manifest = JSON.parse(t.hub.db.prepare("SELECT manifest_json FROM factory_bundles WHERE id = ?").get(bundle.id).manifest_json);
    assert.equal(manifest.spec.criteria.find((c) => c.id === "AC-1").status, "PASS_EVIDENCE");
    assert.equal(manifest.spec.criteria.find((c) => c.id === "AC-3").status, "PASS_REVIEW");
    assert.ok(manifest.limitations.some((l) => /SIMULARE/.test(l)));

    const accepted = (await dispatch(t.hub, "factory.accept", { missionId, note: "Verificat în simulare" })).result;
    assert.equal(accepted.factory.stage, "ACCEPTED");
    assert.equal(accepted.bundles.at(-1).status, "OWNER_ACCEPTED");
    assert.ok(accepted.tasks.every((task) => task.status === "COMPLETED"), JSON.stringify(accepted.tasks.map((x) => [x.title, x.status])));
    assert.equal(t.hub.missions.get(missionId).status, "COMPLETED");
  } finally { await t.cleanup(); }
});
