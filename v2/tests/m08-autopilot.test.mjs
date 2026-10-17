// Milestone 08 — D3 Project Autopilot (PASS_SIMULATED: fixture providers, software authenticator, a synthetic test project).
// A finite objective of dependent tasks runs under ONE confirmed envelope (TRUSTED), task after task, to DELIVERY_READY, and
// stops there. Adversarial: a dependency cycle, a scope changed after the plan, the owner's pause, an exhausted plan, an attempt to
// smuggle trust fields, and the absence of any "resume" right under the autopilot's name.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeTestHub, waitFor, enrolOwner, prepareLiveWithoutGrants } from "./helpers.mjs";
import { materializeFixture, demoSpec } from "../server/factory/fixtures.mjs";
import { validateObjectivePlan, OBJECTIVE_LIMITS } from "../server/intel/autopilot.mjs";

const dispatch = (hub, type, payload, extra = {}) => hub.commands.dispatch({ type, payload, channel: "test", actor: "test", ...extra });
const SETTLED = ["DELIVERY_READY", "NEEDS_OWNER_DECISION", "BLOCKED", "PAUSED", "CANCELLED", "ACCEPTED", "REJECTED"];

async function ownerHub({ level = "TRUSTED" } = {}) {
  const t = await makeTestHub({ queues: true });
  await prepareLiveWithoutGrants(t.hub);
  const dir = path.join(t.dataDir, "factory-bug-demo");
  materializeFixture("bug-demo", dir);
  // t2 has its own acceptance test (it fails until t2 exists), outside the default node --test discovery so t1 stays green.
  fs.mkdirSync(path.join(dir, "acceptance"), { recursive: true });
  fs.writeFileSync(path.join(dir, "acceptance", "limits.mjs"), [
    `import test from "node:test";`, `import assert from "node:assert/strict";`, `import { nameTooLong } from "../src/limits.js";`, "",
    `test("AC-1: un nume de peste 80 de caractere este detectat", () => {`, `  assert.equal(nameTooLong("x".repeat(81)), true);`, `  assert.equal(nameTooLong("Ana"), false);`, "});", "",
  ].join("\n"));
  const project = (await dispatch(t.hub, "project.register_test", { path: dir })).result;
  const owner = await enrolOwner(t);
  if (level) await dispatch(t.hub, "owner.autonomy.set", { projectId: project.id, level }, { ownerSession: owner.reauth() });
  return { ...t, project, dir, owner };
}

/** Two dependent tasks on the bug-demo fixture: t1 = the reproducible bug, t2 = a small feature that needs t1 first. */
function objectiveInput(projectId) {
  const bug = demoSpec("bug-demo");
  const verification = { checks: ["node --test"], acceptance: ["node --test acceptance/limits.mjs"] };
  return {
    projectId, title: "Validare robustă a solicitărilor", criteria: ["Numele din spații e refuzat", "Numele prea lung e detectat"],
    // M09: the objective names its models; every task's mission is prepared with them explicitly.
    models: { writer: { model: "gpt-fake-sol" }, reviewer: { model: "sonnet" } },
    tasks: [
      { key: "t2", title: "Limită de lungime pentru nume", workType: "FEATURE", objective: "Adaugă detectarea numelui prea lung (peste 80 de caractere), cu test.", dependsOn: ["t1"],
        inScope: ["src/limits.js", "teste noi"], acceptance: [{ id: "AC-1", text: "Un nume de peste 80 de caractere este detectat", verify: "test", testRef: "acceptance/limits.mjs" }, { id: "AC-2", text: "Limita e explicată și revizuită", verify: "review" }], verification, maxDurationMin: 30 },
      { key: "t1", title: bug.title, workType: "BUGFIX", objective: bug.objective, inScope: bug.spec.inScope, outOfScope: bug.spec.outOfScope, acceptance: bug.spec.acceptance, verification: bug.spec.verification, maxDurationMin: 30 },
    ],
  };
}

test("M08-D3-01 plan validation: order by dependencies, cycles, self/orphan dependencies, budget, duplicate keys, missing criteria", () => {
  const ok = validateObjectivePlan({ title: "x y z", criteria: ["c"], tasks: [{ key: "a", title: "A", workType: "FEATURE", acceptance: [{ text: "ok" }], dependsOn: ["b"] }, { key: "b", title: "B", workType: "BUGFIX", acceptance: [{ text: "ok" }] }] });
  assert.equal(ok.ok, true, ok.problems.join("; "));
  assert.deepEqual(ok.order, ["b", "a"]);
  const cyc = validateObjectivePlan({ title: "x y z", criteria: ["c"], tasks: [{ key: "a", title: "A", workType: "FEATURE", acceptance: [{ text: "ok" }], dependsOn: ["b"] }, { key: "b", title: "B", workType: "FEATURE", acceptance: [{ text: "ok" }], dependsOn: ["a"] }] });
  assert.equal(cyc.ok, false); assert.match(cyc.problems.join(" "), /ciclu|circular/i);
  const self = validateObjectivePlan({ title: "x y z", criteria: ["c"], tasks: [{ key: "a", title: "A", workType: "FEATURE", acceptance: [{ text: "ok" }], dependsOn: ["a", "zz"] }] });
  assert.equal(self.ok, false);
  const many = validateObjectivePlan({ title: "x y z", criteria: ["c"], tasks: Array.from({ length: OBJECTIVE_LIMITS.maxTasks + 1 }, (_, i) => ({ key: `k${i}`, title: `T${i}`, workType: "FEATURE", acceptance: [{ text: "ok" }] })) });
  assert.equal(many.ok, false);
  const dup = validateObjectivePlan({ title: "x y z", criteria: ["c"], tasks: [{ key: "a", title: "A", workType: "FEATURE", acceptance: [{ text: "ok" }] }, { key: "a", title: "B", workType: "FEATURE", acceptance: [{ text: "ok" }] }] });
  assert.equal(dup.ok, false);
  const noCriteria = validateObjectivePlan({ title: "x y z", criteria: [], tasks: [{ key: "a", title: "A", workType: "FEATURE", acceptance: [] }] });
  assert.equal(noCriteria.ok, false);
});

test("M08-D3-02 one confirmation (TRUSTED) runs both dependent tasks in order under one envelope to DELIVERY_READY, then stops; nothing accepted", async () => {
  const t = await ownerHub({ level: "TRUSTED" });
  try {
    const draft = (await dispatch(t.hub, "autopilot.draft", { ...objectiveInput(t.project.id), testProject: false, owner: true, environmentVerified: true })).result;
    assert.equal(draft.status, "DRAFT");
    assert.deepEqual(draft.plan.order, ["t1", "t2"], "t2 depends on t1");
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM factory_missions").get().n, 0, "a draft creates nothing in the factory");
    const prep = (await dispatch(t.hub, "autopilot.prepare", { objectiveId: draft.id }, { ownerSession: t.owner.session })).result;
    assert.deepEqual(prep.incomplete, [], prep.note);
    assert.equal(prep.objective.status, "PREPARED");
    assert.ok(prep.objective.tasks.every((x) => x.stage === "SPEC_DRAFT"));
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM agent_runs").get().n, 0, "preparing starts nothing");
    const proposal = (await dispatch(t.hub, "autopilot.propose", { objectiveId: draft.id }, { ownerSession: t.owner.session })).result;
    const env = proposal.plan.envelope;
    assert.ok(env, JSON.stringify(proposal.plan.summary?.blockers || proposal.plan.error || {}));
    assert.equal(proposal.plan.summary.state, "PLAN_READY", (proposal.plan.summary.blockers || []).join("; "));
    assert.deepEqual(env.missionIds, prep.objective.tasks.map((x) => x.missionId), "one envelope over the tasks in dependency order");
    assert.equal(env.body.continuationPolicy.nextMissionWithoutConfirmation, true);
    assert.equal(env.body.objective.id, draft.id);
    assert.match(proposal.plan.summary.headline, /Validare robustă/);
    t.queue("codex", "factory-write:bug-fix", "factory-write:objective-t2");
    t.queue("claude", "review:pass", "review:pass");
    const confirmed = (await dispatch(t.hub, "envelope.confirm", { envelopeId: env.id, nonce: env.nonce, displayedHash: env.envelopeHash }, { ownerSession: t.owner.session })).result;
    assert.equal(confirmed.envelope.status, "ACTIVE");
    const [m1, m2] = env.missionIds;
    const first = await waitFor(() => (SETTLED.includes(t.hub.factory.view(m1).factory.stage) ? t.hub.factory.view(m1) : null), 120000, 100);
    assert.equal(first.factory.stage, "DELIVERY_READY", first.factory.stageReason);
    const second = await waitFor(() => (SETTLED.includes(t.hub.factory.view(m2).factory.stage) ? t.hub.factory.view(m2) : null), 120000, 100);
    assert.equal(second.factory.stage, "DELIVERY_READY", second.factory.stageReason);
    const closed = await waitFor(() => (t.hub.envelopes.get(env.id).status === "COMPLETED" ? t.hub.envelopes.view(env.id) : null), 30000, 50);
    assert.match(closed.closeReason, /nimic nu e acceptat/);
    const v = t.hub.autopilot.view(draft.id);
    assert.equal(v.status, "DELIVERED");
    assert.deepEqual(v.progress, { delivered: 2, total: 2 });
    // UX: the owner confirmed ONCE for two tasks; no grant forms, no approval clicks.
    const ownerCommands = t.hub.db.prepare("SELECT type FROM commands WHERE type IN ('grant.create','approval.decide','envelope.confirm','mode.set')").all().map((r) => r.type);
    assert.deepEqual(ownerCommands, ["envelope.confirm"]);
    // The trust fields the client sent were ignored (nothing in the stored objective).
    const row = t.hub.db.prepare("SELECT * FROM autopilot_objectives WHERE id = ?").get(draft.id);
    assert.doesNotMatch(row.plan_json + row.limits_json, /environmentVerified|testProject|"owner"/);
    await waitFor(() => t.hub.settings.get("mode") === "BUILD_SAFE", 10000);
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM factory_bundles WHERE status = 'OWNER_ACCEPTED'").get().n, 0, "nothing accepted automatically");
  } finally { await t.cleanup(); }
});

test("M08-D3-03 ASSISTED: the objective's plan covers only the next task; the following task needs its own plan", async () => {
  const t = await ownerHub({ level: "ASSISTED" });
  try {
    const draft = (await dispatch(t.hub, "autopilot.draft", objectiveInput(t.project.id))).result;
    await dispatch(t.hub, "autopilot.prepare", { objectiveId: draft.id }, { ownerSession: t.owner.session });
    const proposal = (await dispatch(t.hub, "autopilot.propose", { objectiveId: draft.id }, { ownerSession: t.owner.session })).result;
    assert.equal(proposal.plan.envelope.missionIds.length, 1);
    assert.equal(proposal.plan.envelope.body.continuationPolicy.nextMissionWithoutConfirmation, false);
  } finally { await t.cleanup(); }
});

test("M08-D3-04 adversarial: an amended scope is a new version (the old plan is superseded and cannot cover it); a running objective cannot be amended; no autopilot resume right exists", async () => {
  const t = await ownerHub({ level: "TRUSTED" });
  try {
    const draft = (await dispatch(t.hub, "autopilot.draft", objectiveInput(t.project.id))).result;
    await dispatch(t.hub, "autopilot.prepare", { objectiveId: draft.id }, { ownerSession: t.owner.session });
    const proposal = (await dispatch(t.hub, "autopilot.propose", { objectiveId: draft.id }, { ownerSession: t.owner.session })).result;
    const amended = (await dispatch(t.hub, "autopilot.amend", { objectiveId: draft.id, changes: { title: "Validare robustă v2" } })).result;
    assert.notEqual(amended.id, draft.id);
    assert.equal(amended.status, "DRAFT");
    assert.equal(t.hub.db.prepare("SELECT status FROM autopilot_objectives WHERE id = ?").get(draft.id).status, "SUPERSEDED");
    // The old plan was for the old objective: proposing again over the superseded objective is refused.
    await assert.rejects(dispatch(t.hub, "autopilot.propose", { objectiveId: draft.id }, { ownerSession: t.owner.session }), /SUPERSEDED|nu mai/i);
    // The plan shown BEFORE the amendment can no longer be confirmed: it stood for an objective that is not current any more.
    const old = proposal.plan.envelope;
    await assert.rejects(dispatch(t.hub, "envelope.confirm", { envelopeId: old.id, nonce: old.nonce, displayedHash: old.envelopeHash }, { ownerSession: t.owner.session }), /nu mai e valabil|nu mai e curent/);
    assert.equal(t.hub.envelopes.get(old.id).status, "SUPERSEDED");
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM agent_runs").get().n, 0);
    // There is no command that gives the autopilot a right to resume, retry or approve on its own.
    const names = [...t.hub.commands.catalog().map((c) => c.type || c.name || c)];
    assert.ok(!names.some((n) => /^autopilot\.(resume|retry|approve|confirm|continue)/.test(String(n))), names.filter((n) => String(n).startsWith("autopilot.")).join(","));
    // The agent and CLI channels cannot drive the autopilot.
    for (const channel of ["agent", "cli", "voice"]) await assert.rejects(dispatch(t.hub, "autopilot.draft", objectiveInput(t.project.id), { channel }), /channel|canal|not allowed|cannot be issued/i);
  } finally { await t.cleanup(); }
});

test("M08-D3-05 the owner's pause stops the objective at WAITING_OWNER; the plan never resumes by itself", async () => {
  const t = await ownerHub({ level: "TRUSTED" });
  try {
    const draft = (await dispatch(t.hub, "autopilot.draft", objectiveInput(t.project.id))).result;
    await dispatch(t.hub, "autopilot.prepare", { objectiveId: draft.id }, { ownerSession: t.owner.session });
    const { plan } = (await dispatch(t.hub, "autopilot.propose", { objectiveId: draft.id }, { ownerSession: t.owner.session })).result;
    t.queue("codex", "hang");
    await dispatch(t.hub, "envelope.confirm", { envelopeId: plan.envelope.id, nonce: plan.envelope.nonce, displayedHash: plan.envelope.envelopeHash }, { ownerSession: t.owner.session });
    const m1 = plan.envelope.missionIds[0];
    await waitFor(() => t.hub.db.prepare("SELECT 1 FROM agent_runs WHERE status IN ('running','starting')").get(), 30000, 100);
    await dispatch(t.hub, "factory.pause", { missionId: m1 });
    await waitFor(() => t.hub.factory.view(m1).factory.stage === "PAUSED", 30000, 100);
    await waitFor(() => t.hub.envelopes.get(plan.envelope.id).status === "WAITING_OWNER", 10000, 50);
    assert.equal(t.hub.autopilot.view(draft.id).status, "WAITING_OWNER");
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal(t.hub.factory.view(m1).factory.stage, "PAUSED", "no resume without the owner");
    assert.equal(t.hub.factory.view(plan.envelope.missionIds[1]).factory.stage, "SPEC_DRAFT", "the dependent task never started");
    await dispatch(t.hub, "system.stop_all", { reason: "test end" });
  } finally { await t.cleanup(); }
});
