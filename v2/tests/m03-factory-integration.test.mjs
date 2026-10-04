// Milestone 03 — Software Factory integration: handoff package with the factory context, delivery bundle bound to the
// tested version, Lega as the voice entry point without authority, and static guards. PASS_SIMULATED (fixtures only).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeTestHub, enableLive, waitFor } from "./helpers.mjs";
import { materializeFixture, demoSpec } from "../server/factory/fixtures.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const dispatch = (hub, type, payload, channel = "test") => hub.commands.dispatch({ type, payload, channel, actor: "test" });

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
  await dispatch(t.hub, "approval.decide", { approvalId: requested.approval.id, decision: "approved", displayedHash: requested.approval.payloadHash });
  return t.hub.commands.executeApproved(requested.command.id, "user");
}
const untilStage = (t, id, stages, ms = 90000) => waitFor(() => (stages.includes(t.hub.factory.view(id).factory.stage) ? t.hub.factory.view(id) : null), ms, 100);

test("M03-FI-01 handoff after delivery carries the factory context (spec, criteria, exact change set, findings); a changed workspace makes the bundle STALE at acceptance", async () => {
  const t = await factoryHub();
  try {
    const { mission } = (await dispatch(t.hub, "factory.prepare", { projectId: t.project.id, ...demoSpec("bug-demo"), limits: { writerModel: "gpt-fake-sol", reviewerModel: "sonnet" } })).result;
    t.queue("codex", "factory-write:bug-fix");
    t.queue("claude", "review:pass");
    await approveAndStart(t, mission.id);
    const ready = await untilStage(t, mission.id, ["DELIVERY_READY", "NEEDS_OWNER_DECISION", "BLOCKED"]);
    assert.equal(ready.factory.stage, "DELIVERY_READY", ready.factory.stageReason);
    const cs = ready.changeSets.find((c) => c.status === "CURRENT");

    const handoff = (await dispatch(t.hub, "handoff.begin", { conversationId: mission.conversationId, toProvider: "claude" })).result;
    assert.equal(handoff.status, "ready");
    const pkg = handoff.package;
    assert.equal(pkg.factory.mission_id, mission.id);
    assert.equal(pkg.factory.change_set.sha256, cs.sha256, "the target continues on the exact tested version");
    assert.equal(pkg.factory.spec_version, 1);
    assert.deepEqual(pkg.factory.protected_tests, ["test/acceptance.test.mjs"]);
    assert.ok(pkg.factory.acceptance.length >= 2);
    await dispatch(t.hub, "handoff.cancel", { handoffId: handoff.id });

    // The workspace changes after QA: the bundle no longer describes it, acceptance is refused.
    fs.appendFileSync(path.join(t.dir, "src", "requests.js"), "\n// modificare după QA\n");
    await assert.rejects(dispatch(t.hub, "factory.accept", { missionId: mission.id, note: "ok" }), /STALE/);
    const after = t.hub.factory.view(mission.id);
    assert.equal(after.bundles.at(-1).status, "STALE");
    assert.equal(after.factory.stage, "DELIVERY_READY", "nothing is accepted on a changed workspace");
  } finally { await t.cleanup(); }
});

test("M03-FI-02 no manual handoff while the factory's writer is active (never two writers); stop first", async () => {
  const t = await factoryHub();
  try {
    const { mission } = (await dispatch(t.hub, "factory.prepare", { projectId: t.project.id, ...demoSpec("bug-demo"), limits: { writerModel: "gpt-fake-sol", reviewerModel: "sonnet" } })).result;
    t.queue("codex", "hang");
    await approveAndStart(t, mission.id);
    await waitFor(() => t.hub.factory.view(mission.id).factory.stage === "IMPLEMENTING" && t.hub.runs.activeRuns().length === 1, 60000);
    await assert.rejects(dispatch(t.hub, "handoff.begin", { conversationId: mission.conversationId, toProvider: "claude" }), /pauză sau oprește/);
    await dispatch(t.hub, "factory.stop", { missionId: mission.id }, "ui");
    await untilStage(t, mission.id, ["CANCELLED"]);
  } finally { await t.cleanup(); }
});

test("M03-FI-03 Lega proposes an engineering mission (owner click creates spec v1 as a draft); Lega cannot start, accept or approve it", async () => {
  const t = await factoryHub();
  try {
    const proposal = await dispatch(t.hub, "lega.propose_mission", { projectId: t.project.id, kind: "eng_bugfix", title: "Repară validarea numelui",
      objective: "Numele format doar din spații trece de validare; repară cu test de regresie.", acceptance: ["Numele din spații e refuzat"] }, "voice");
    assert.equal(proposal.approvalRequired, true, "a voice proposal waits for the owner's click");
    await dispatch(t.hub, "approval.decide", { approvalId: proposal.approval.id, decision: "approved", displayedHash: proposal.approval.payloadHash });
    const mission = (await t.hub.commands.executeApproved(proposal.command.id, "user")).result;
    const view = t.hub.factory.view(mission.id);
    assert.equal(view.factory.stage, "SPEC_DRAFT");
    assert.ok(view.specs[0].problems.some((p) => /testRef|verification/.test(p)), "a sentence is a draft, not an approvable spec");
    assert.equal(view.scope, null, "no scope to approve until the spec is complete");
    // Every decision is UI-only: voice cannot start, accept, reject, resume, or mark findings.
    for (const [type, payload] of [["factory.start", { missionId: mission.id, specVersion: 1, specSha: "x", planSha: "y", limits: {}, routes: {}, commands: {} }],
      ["factory.accept", { missionId: mission.id }], ["factory.reject", { missionId: mission.id, note: "nu" }], ["factory.resume", { missionId: mission.id }],
      ["factory.spec.revise", { missionId: mission.id, spec: {} }], ["factory.finding", { missionId: mission.id, code: "F-001", status: "FALSE_POSITIVE", note: "motiv lung" }]]) {
      await assert.rejects(dispatch(t.hub, type, payload, "voice"), /cannot be issued through voice/, type);
    }
    // Lega reports the factory stage from the mission detail tool.
    const lines = t.hub.lega && typeof t.hub.factory.summary === "function" ? t.hub.factory.summary(mission.id) : null;
    assert.equal(lines.stage, "SPEC_DRAFT");
    assert.match(lines.spec, /BUGFIX/);
  } finally { await t.cleanup(); }
});

test("M03-FI-04 static guards: the factory never imports child_process (processes only through the supervisor) and runs no mutating git", () => {
  const dir = path.join(here, "..", "server", "factory");
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".mjs"))) {
    const text = fs.readFileSync(path.join(dir, file), "utf8");
    assert.ok(!/from "node:child_process"/.test(text), `${file} spawns only through the supervisor`);
    assert.ok(!/\bgit\s+(commit|push|add|reset|checkout|merge|rebase|stash|tag)\b/.test(text.replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, "")), `${file} runs no mutating git`);
  }
  const fixtures = path.join(here, "fixtures", "factory-patches");
  for (const file of fs.readdirSync(fixtures).filter((f) => f.endsWith(".json"))) {
    const patch = JSON.parse(fs.readFileSync(path.join(fixtures, file), "utf8"));
    for (const rel of [...Object.keys(patch.write || {}), ...(patch.delete || [])]) assert.ok(!rel.includes("..") && !path.isAbsolute(rel), `${file}: ${rel} stays inside the workspace`);
  }
});
