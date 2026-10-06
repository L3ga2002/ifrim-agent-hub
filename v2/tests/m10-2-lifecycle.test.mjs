// Milestone 10.2 — U11: the plan lifecycle (PASS_SIMULATED: fixture providers, software authenticator, test projects; no model).
// Expiry counted from the confirmation; revoke / expiry pause the mission; cumulative top-up of the plan's grants inside its budget;
// repair cycles shown on the card pre-authorized (owner decision 6), a cycle or an attempt beyond them confirmed as a delta that
// raises the plan's AND the factory's limit atomically; continuation plans for a started mission (expired plan, MATERIAL_CHANGE)
// with an audited rebind; Codex escalations declined inside a plan on the Windows route; „Continuă” after the owner's own pause
// (owner decision 13); operation plans: per-step authority, folder decisions, delta re-confirmation in a new session.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeTestHub, waitFor, enrolOwner, prepareLiveWithoutGrants, tempDir } from "./helpers.mjs";
import { materializeFixture, demoSpec } from "../server/factory/fixtures.mjs";
import { ENVELOPE_LIMITS } from "../server/owner/envelopes.mjs";
import { HubError } from "../server/core/errors.mjs";

const M09_MODELS = { writerModel: "gpt-fake-sol", reviewerModel: "sonnet" };
const SETTLED = ["DELIVERY_READY", "NEEDS_OWNER_DECISION", "BLOCKED", "PAUSED", "CANCELLED", "ACCEPTED", "REJECTED"];
// The bug-hang fixture's slow test returns at once when this marker exists (see tests/fixtures/factory-patches/make-patches.mjs).
const RELEASE = path.join(os.tmpdir(), "ifrim-factory-slow-release");
const dispatch = (hub, type, payload, extra = {}) => hub.commands.dispatch({ type, payload, channel: "test", actor: "test", ...extra });

async function ownerHub({ level = "TRUSTED", limits = {}, clock = null } = {}) {
  const t = await makeTestHub({ queues: true, ...(clock ? { clock } : {}) });
  await prepareLiveWithoutGrants(t.hub);
  const dir = path.join(t.dataDir, "factory-bug-demo");
  materializeFixture("bug-demo", dir);
  const project = (await dispatch(t.hub, "project.register_test", { path: dir })).result;
  const owner = await enrolOwner(t);
  await dispatch(t.hub, "owner.autonomy.set", { projectId: project.id, level }, { ownerSession: owner.reauth() });
  const { mission } = (await dispatch(t.hub, "factory.prepare", { projectId: project.id, ...demoSpec("bug-demo"), limits: { ...M09_MODELS, ...limits } })).result;
  return { ...t, project, dir, owner, mission };
}
const propose = async (t, extra = {}) => (await dispatch(t.hub, "envelope.propose", { projectId: t.project.id, ...extra })).result;
const confirm = (t, env) => dispatch(t.hub, "envelope.confirm", { envelopeId: env.id, nonce: env.nonce, displayedHash: env.envelopeHash }, { ownerSession: t.owner.session });
const asOwner = (t, type, payload) => t.hub.commands.dispatch({ type, payload, channel: "owner", actor: `owner:${t.owner.session.id}`, ownerSession: t.owner.session });
const view = (t, id) => t.hub.factory.view(id);
const stage = (t) => t.hub.factory.list().find((f) => f.missionId === t.mission.id)?.stage;
const untilStage = (t, id, stages, ms = 90000) => waitFor(() => (stages.includes(view(t, id).factory.stage) ? view(t, id) : null), ms, 100);
const untilEnvelope = (t, id, statuses, ms = 30000) => waitFor(() => (statuses.includes(t.hub.envelopes.get(id).status) ? t.hub.envelopes.view(id) : null), ms, 50);
const count = (t, sql, ...args) => t.hub.db.prepare(sql).get(...args).n;
const events = (t, type) => t.hub.db.prepare("SELECT payload_json FROM events WHERE type = ? ORDER BY seq").all(type).map((r) => JSON.parse(r.payload_json));
const writerGrants = (t, envId) => t.hub.grants.ofEnvelope(envId).filter((g) => g.binding?.role === "writer");
const activeWriter = (t) => waitFor(() => (t.hub.runs.activeRuns().some((r) => r.provider === "codex") ? true : null), 30000, 50);
async function stopAll(t) {
  await dispatch(t.hub, "system.stop_all", { reason: "test" }, { channel: "owner", ownerSession: t.owner.session });
  await waitFor(() => t.hub.runs.activeRuns().length === 0, 15000);
}

test("M10.2-LC-01 expiry is counted from the confirmation; a resume under the plan never extends past it", async () => {
  let offset = 0;
  const t = await ownerHub({ clock: () => new Date(Date.now() + offset) });
  try {
    const { envelope } = await propose(t);
    const shownExpiry = Date.parse(envelope.expiresAt);
    offset = 14 * 60000; // the owner reads the card for 14 minutes
    t.queue("codex", "hang");
    const confirmed = (await confirm(t, envelope)).result.envelope;
    const span = (envelope.body.limits.maxDurationMin + ENVELOPE_LIMITS.slackMin) * 60000;
    assert.ok(Math.abs(Date.parse(confirmed.expiresAt) - (Date.parse(confirmed.confirmedAt) + span)) < 2000, "expires = confirmedAt + total + slack");
    assert.ok(Date.parse(confirmed.expiresAt) - shownExpiry > 13 * 60000, "the 14 minutes of reading did not eat the authorized time");
    for (const g of t.hub.grants.ofEnvelope(envelope.id)) assert.ok(Date.parse(g.expiresAt) <= Date.parse(confirmed.expiresAt) + 1000, "no derived grant outlives the plan");
    await activeWriter(t);
    // A resume after the mission's deadline opens a new window, but never past the plan.
    await dispatch(t.hub, "factory.pause", { missionId: t.mission.id }, { channel: "owner", ownerSession: t.owner.session });
    await untilStage(t, t.mission.id, ["PAUSED"]);
    const planEnd = new Date(Date.now() + offset + 20 * 60000).toISOString();
    t.hub.db.prepare("UPDATE mission_envelopes SET expires_at = ? WHERE id = ?").run(planEnd, envelope.id);
    t.hub.db.prepare("UPDATE factory_missions SET deadline_at = ? WHERE mission_id = ?").run(new Date(Date.now() + offset - 1000).toISOString(), t.mission.id);
    t.queue("codex", "hang");
    await dispatch(t.hub, "factory.resume", { missionId: t.mission.id }, { channel: "owner", ownerSession: t.owner.session });
    const f = t.hub.factory.list().find((x) => x.missionId === t.mission.id);
    assert.ok(Date.parse(f.deadlineAt) <= Date.parse(planEnd) + 1000, `deadline ${f.deadlineAt} capped by the plan ${planEnd}`);
    assert.equal(events(t, "factory.deadline_extended").at(-1).cappedByPlan, envelope.id);
    await stopAll(t);
  } finally { await t.cleanup(); }
});

test("M10.2-LC-02 revoke during a runner stage (checks) pauses the mission: the check is stopped, no model step starts afterwards", async () => {
  fs.rmSync(RELEASE, { force: true });
  const t = await ownerHub();
  try {
    const { envelope } = await propose(t);
    t.queue("codex", "factory-write:bug-hang");
    t.queue("claude", "review:pass");
    await confirm(t, envelope);
    await waitFor(() => (stage(t) === "CHECKING" && t.hub.supervisor.list().some((p) => p.key.startsWith(`factory-run-${t.mission.id}-CHECKING`)) ? true : null), 90000, 100);
    await dispatch(t.hub, "envelope.revoke", { envelopeId: envelope.id, reason: "test: revoke during checks" }, { channel: "voice", actor: "voice" });
    await waitFor(() => (t.hub.supervisor.list().some((p) => p.key.startsWith(`factory-run-${t.mission.id}-`)) ? null : true), 20000, 100);
    await new Promise((r) => setTimeout(r, 1500)); // time for a wrongly scheduled step to show up
    const v = view(t, t.mission.id);
    assert.equal(v.factory.stage, "PAUSED", v.factory.stageReason);
    assert.deepEqual(v.dispatches.map((d) => d.stage), ["IMPLEMENTING"], "no review / repair run after the revoke");
    assert.equal(t.hub.envelopes.get(envelope.id).status, "REVOKED");
    assert.ok(t.hub.grants.ofEnvelope(envelope.id).every((g) => g.status !== "active"), "derived grants revoked");
    await waitFor(() => (events(t, "envelope.mission_paused").length ? true : null), 5000);
    assert.equal(events(t, "envelope.mission_paused")[0].because, "REVOKED");
    // Resuming by hand finds no plan: the step is refused at the gate (plan mission → only plan grants), nothing reaches a model.
    fs.writeFileSync(RELEASE, "release");
  } finally { fs.writeFileSync(RELEASE, "release"); await t.cleanup(); }
});

test("M10.2-LC-03 revoke during a model turn pauses the mission and interrupts the turn; expiry does the same", async () => {
  const t = await ownerHub();
  try {
    const { envelope } = await propose(t);
    t.queue("codex", "hang");
    await confirm(t, envelope);
    await activeWriter(t);
    await dispatch(t.hub, "envelope.revoke", { envelopeId: envelope.id }, { channel: "owner", ownerSession: t.owner.session });
    await untilStage(t, t.mission.id, ["PAUSED"], 20000);
    await waitFor(() => (t.hub.runs.activeRuns().length === 0 ? true : null), 15000);
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM agent_runs"), 1, "no new run after the revoke");
    // Expiry (tick) pauses a mission of a second plan the same way (below).
  } finally { await t.cleanup(); }
  const u = await ownerHub();
  try {
    const { envelope } = await propose(u);
    u.queue("codex", "hang");
    await confirm(u, envelope);
    await activeWriter(u);
    u.hub.db.prepare("UPDATE mission_envelopes SET expires_at = ? WHERE id = ?").run(new Date(Date.now() - 1000).toISOString(), envelope.id);
    u.hub.envelopes.tick();
    assert.equal(u.hub.envelopes.get(envelope.id).status, "EXPIRED");
    await untilStage(u, u.mission.id, ["PAUSED"], 20000);
    await waitFor(() => (u.hub.runs.activeRuns().length === 0 ? true : null), 15000);
  } finally { await u.cleanup(); }
});

test("M10.2-LC-04 cumulative top-up: cycles 2 × attempts 3 → writer attempts beyond 5 are topped up to 9, then refused; never BLOCKED 'grant' inside the budget", async () => {
  const t = await ownerHub({ limits: { maxRepairCycles: 2, maxAttemptsPerStage: 3 } });
  try {
    const { envelope } = await propose(t);
    t.queue("codex", "hang");
    await confirm(t, envelope);
    assert.equal(t.hub.envelopes.budgetOf(envelope.id, t.mission.id), 9);
    await activeWriter(t);
    const [g1] = writerGrants(t, envelope.id);
    assert.equal(g1.maxAttempts, 5, "one grant carries at most 5");
    await dispatch(t.hub, "factory.pause", { missionId: t.mission.id }, { channel: "owner", ownerSession: t.owner.session });
    await untilStage(t, t.mission.id, ["PAUSED"]);
    await waitFor(() => (t.hub.runs.activeRuns().length === 0 ? true : null), 15000);
    // Retries spend the first grant (simulated: the attempts a failing infrastructure would take).
    while (t.hub.grants.get(g1.id).attemptsUsed < g1.maxAttempts) t.hub.bus.transaction(() => t.hub.grants.consumeAttempt(g1.id));
    assert.equal(t.hub.grants.get(g1.id).status, "exhausted");
    t.queue("codex", "hang");
    await dispatch(t.hub, "factory.resume", { missionId: t.mission.id }, { channel: "owner", ownerSession: t.owner.session });
    await activeWriter(t);
    assert.notEqual(stage(t), "BLOCKED", "inside the budget the mission never waits for a grant");
    const after = writerGrants(t, envelope.id);
    assert.equal(after.length, 2);
    assert.equal(after[1].maxAttempts, 4, "the rest of the budget: 9 − 5");
    assert.equal(after[1].binding.bindingHash, g1.binding.bindingHash, "same binding");
    assert.equal(after[1].binding.missionId, t.mission.id, "same mission");
    assert.ok(Date.parse(after[1].expiresAt) <= Date.parse(t.hub.envelopes.get(envelope.id).expiresAt) + 1000, "never past the plan");
    const lastRun = t.hub.db.prepare("SELECT grant_id FROM agent_runs WHERE provider = 'codex' ORDER BY created_at DESC LIMIT 1").get();
    assert.equal(lastRun.grant_id, after[1].id, "the step used the topped-up grant");
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM commands WHERE type = 'grant.create'"), 0, "no grant form");
    // The budget is spent: nothing more is issued; the next step is refused at the gate (plan grants only), before any process.
    await dispatch(t.hub, "factory.pause", { missionId: t.mission.id }, { channel: "owner", ownerSession: t.owner.session });
    await untilStage(t, t.mission.id, ["PAUSED"]);
    await waitFor(() => (t.hub.runs.activeRuns().length === 0 ? true : null), 15000);
    const g2 = t.hub.grants.get(after[1].id);
    while (t.hub.grants.get(g2.id).attemptsUsed < g2.maxAttempts) t.hub.bus.transaction(() => t.hub.grants.consumeAttempt(g2.id));
    assert.deepEqual(t.hub.envelopes.topUp(t.mission.id, "writer", g1.binding.bindingHash), { exhausted: true });
    const env = t.hub.envelopes.get(envelope.id);
    assert.throws(() => t.hub.envelopes.assertWithin(env, { role: "writer", provider: "codex", access: "workspace-write", maxAttempts: 1, maxDurationS: 600, ttlMinutes: 10, binding: g1.binding },
      { projectId: t.project.id, missionId: t.mission.id, allocated: 9 }), /încercări peste plan/);
    const runsBefore = count(t, "SELECT COUNT(*) AS n FROM agent_runs WHERE status <> 'blocked'");
    await dispatch(t.hub, "factory.resume", { missionId: t.mission.id }, { channel: "owner", ownerSession: t.owner.session });
    const blocked = await untilStage(t, t.mission.id, ["BLOCKED", "NEEDS_OWNER_DECISION"], 30000);
    assert.equal(blocked.factory.stage, "BLOCKED");
    // In BUILD_SAFE the plan no longer admits the step (mode check names the plan and why); no manual grant could serve it either.
    assert.equal(blocked.factory.waitReason, "gate");
    assert.ok(blocked.factory.stageReason.includes(`planul ${envelope.id} nu admite acest pas (planul nu are un grant derivat activ`), blocked.factory.stageReason);
    assert.equal(writerGrants(t, envelope.id).reduce((n, g) => n + g.maxAttempts, 0), 9, "never more than the confirmed budget");
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM agent_runs WHERE status <> 'blocked'"), runsBefore, "no process started beyond the budget");
    assert.ok(events(t, "envelope.budget_exhausted").length >= 1);
  } finally { await t.cleanup(); }
});

/** partial fix → repair cycle 1 (partial again) → the mission's limit (1 cycle) → NEEDS_OWNER_DECISION. */
async function toCycleLimit(t) {
  t.queue("codex", "factory-write:bug-partial", "factory-write:bug-partial2", "factory-write:bug-fix");
  t.queue("claude", "review:pass");
  const { envelope, summary } = await propose(t);
  await confirm(t, envelope);
  const stuck = await untilStage(t, t.mission.id, SETTLED);
  return { envelope, summary, stuck };
}

test("M10.2-LC-05 ASSISTED (decision 6): the cycle shown on the card runs without asking; one more is a delta; „Reia cu ciclu suplimentar” alone stays held", async () => {
  const t = await ownerHub({ level: "ASSISTED", limits: { maxRepairCycles: 1 } });
  try {
    const { envelope, summary, stuck } = await toCycleLimit(t);
    assert.equal(envelope.body.limits.maxRepairCycles[t.mission.id], 1, "the ASSISTED card shows (and authorizes) the mission's cycle");
    assert.match(summary.steps, /1 cicluri de remediere incluse/);
    assert.equal(stuck.factory.stage, "NEEDS_OWNER_DECISION", stuck.factory.stageReason);
    assert.equal(stuck.factory.repairCycles, 1, "cycle 1 ran without a confirmation");
    assert.equal(events(t, "envelope.delta_confirmed").length, 0);
    // The old factory decision cannot widen a plan.
    await assert.rejects(dispatch(t.hub, "factory.resume", { missionId: t.mission.id, allowExtraCycle: true }, { channel: "owner", ownerSession: t.owner.session }), (e) => e.code === "PLAN_DELTA_REQUIRED");
    assert.equal(stage(t), "NEEDS_OWNER_DECISION");
    assert.equal(events(t, "factory.extra_cycle").length, 0);
    assert.equal(t.hub.envelopes.deltaOf(envelope.id, t.mission.id).kind, "cycle");
    const out = (await asOwner(t, "envelope.confirm_delta", { envelopeId: envelope.id, missionId: t.mission.id })).result;
    assert.equal(out.delta.kind, "cycle");
    assert.equal(out.resuming, true);
    // The resume runs after the command's commit: wait for the confirmed cycle to start before waiting for the end.
    await waitFor(() => (view(t, t.mission.id).factory.repairCycles >= 2 ? true : null), 60000, 100);
    const done = await untilStage(t, t.mission.id, ["DELIVERY_READY", "NEEDS_OWNER_DECISION", "BLOCKED"]);
    assert.equal(done.factory.stage, "DELIVERY_READY", done.factory.stageReason);
    assert.equal(done.factory.repairCycles, 2);
    const derived = t.hub.grants.ofEnvelope(envelope.id);
    const runs = t.hub.db.prepare("SELECT grant_id FROM agent_runs WHERE status <> 'blocked'").all();
    assert.ok(runs.every((r) => derived.some((g) => g.id === r.grant_id)), "every step ran on a grant derived from the plan");
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM commands WHERE type = 'grant.create'"), 0);
    assert.equal(events(t, "factory.extra_cycle").at(-1).envelopeId, envelope.id, "the factory limit was raised by the plan's delta");
  } finally { await t.cleanup(); }
});

test("M10.2-LC-06 TRUSTED at the cycle limit: the delta raises the plan's and the factory's limit atomically (M06 deadlock regression); its bound holds", async () => {
  const t = await ownerHub({ level: "TRUSTED", limits: { maxRepairCycles: 1 } });
  try {
    const { envelope, stuck } = await toCycleLimit(t);
    assert.equal(stuck.factory.stage, "NEEDS_OWNER_DECISION", stuck.factory.stageReason);
    const limitOf = () => t.hub.factory.list().find((f) => f.missionId === t.mission.id).limits.maxRepairCycles;
    // Bound: at the cap nothing changes — neither the plan nor the factory.
    t.hub.db.prepare("UPDATE mission_envelopes SET derived_json = ? WHERE id = ?").run(JSON.stringify({ extraCycles: { [t.mission.id]: ENVELOPE_LIMITS.maxDeltaCycles } }), envelope.id);
    await assert.rejects(asOwner(t, "envelope.confirm_delta", { envelopeId: envelope.id, missionId: t.mission.id }), (e) => e.code === "DELTA_LIMIT");
    assert.equal(limitOf(), 1, "factory limit untouched by a refused delta");
    t.hub.db.prepare("UPDATE mission_envelopes SET derived_json = ? WHERE id = ?").run(JSON.stringify({}), envelope.id);
    // Not from a provider transcript or the UI channel without the session.
    await assert.rejects(dispatch(t.hub, "envelope.confirm_delta", { envelopeId: envelope.id, missionId: t.mission.id }, { channel: "voice", actor: "voice" }), /cannot be issued through voice/);
    const out = (await asOwner(t, "envelope.confirm_delta", { envelopeId: envelope.id, missionId: t.mission.id })).result;
    // Both raised by the same synchronous call (one transaction): read before the resume even starts.
    assert.equal(limitOf(), 2, "factory limit raised");
    assert.equal(t.hub.envelopes.get(envelope.id).derived.extraCycles[t.mission.id], 1, "plan limit raised");
    assert.deepEqual(out.delta.factoryLimits, { maxRepairCycles: 2 });
    await waitFor(() => (view(t, t.mission.id).factory.repairCycles >= 2 ? true : null), 60000, 100);
    const done = await untilStage(t, t.mission.id, ["DELIVERY_READY", "NEEDS_OWNER_DECISION", "BLOCKED"]);
    assert.equal(done.factory.stage, "DELIVERY_READY", done.factory.stageReason);
    assert.equal(done.factory.repairCycles, 2);
  } finally { await t.cleanup(); }
});

test("M10.2-LC-07 continuation: plan A EXPIRED, mission PAUSED → a plan of only what remains → confirm → factory.resume on new bound grants; no factory.start, no factory.scope approval", async () => {
  const t = await ownerHub();
  try {
    const { envelope: a } = await propose(t);
    t.queue("codex", "hang");
    await confirm(t, a);
    await activeWriter(t);
    // Paused while plan A is in force (same bindings): a new plan is refused — „Continuă” / a delta continue it.
    await dispatch(t.hub, "factory.pause", { missionId: t.mission.id }, { channel: "owner", ownerSession: t.owner.session });
    await untilStage(t, t.mission.id, ["PAUSED"], 20000);
    await waitFor(() => (t.hub.runs.activeRuns().length === 0 ? true : null), 15000);
    await assert.rejects(propose(t, { missionIds: [t.mission.id] }), (e) => e.code === "PLAN_IN_FORCE");
    // Plan A expires while the mission waits (LC-03 covers the expiry pausing a running mission).
    t.hub.db.prepare("UPDATE mission_envelopes SET expires_at = ? WHERE id = ?").run(new Date(Date.now() - 1000).toISOString(), a.id);
    t.hub.envelopes.tick();
    assert.equal(t.hub.envelopes.get(a.id).status, "EXPIRED");
    const starts = count(t, "SELECT COUNT(*) AS n FROM commands WHERE type = 'factory.start'");
    const scopes = count(t, "SELECT COUNT(*) AS n FROM approvals WHERE action_kind = 'factory.scope'");
    const out = await propose(t, { missionIds: [t.mission.id] });
    const b = out.envelope;
    assert.ok(b, JSON.stringify(out.summary));
    assert.deepEqual(b.body.continuation, { fromEnvelopeId: a.id, missionId: t.mission.id });
    assert.equal(b.body.missions[0].continuation.stage, "PAUSED");
    assert.match(out.summary.headline, /^Continuare: /);
    assert.match(out.summary.continuation.remaining, /Rămân: 2 cicluri de remediere/);
    assert.deepEqual(out.summary.continuation.rebind, [], "nothing to rebind");
    t.queue("codex", "factory-write:bug-fix");
    t.queue("claude", "review:pass");
    const confirmed = (await confirm(t, b)).result.envelope;
    assert.equal(confirmed.status, "ACTIVE");
    const done = await untilStage(t, t.mission.id, ["DELIVERY_READY", "NEEDS_OWNER_DECISION", "BLOCKED"]);
    assert.equal(done.factory.stage, "DELIVERY_READY", done.factory.stageReason);
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM commands WHERE type = 'factory.start'"), starts, "no factory.start");
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM approvals WHERE action_kind = 'factory.scope'"), scopes, "no new factory.scope approval");
    const derivedB = t.hub.grants.ofEnvelope(b.id);
    assert.ok(derivedB.length >= 2 && derivedB.every((g) => g.binding?.missionId === t.mission.id));
    const lastRuns = t.hub.db.prepare("SELECT grant_id FROM agent_runs WHERE status <> 'blocked' ORDER BY created_at DESC LIMIT 2").all();
    assert.ok(lastRuns.every((r) => derivedB.some((g) => g.id === r.grant_id)), "the continued steps used plan B's grants");
    assert.ok(t.hub.grants.ofEnvelope(a.id).every((g) => g.status !== "active"), "plan A's grants stay revoked");
    assert.equal(events(t, "envelope.mission_continued").length, 1);
    assert.equal(t.hub.settings.get("mode"), "BUILD_SAFE");
  } finally { await t.cleanup(); }
});

test("M10.2-LC-08 MATERIAL_CHANGE mid-plan (Claude Code version): refused before inference; the continuation rebinds; the scope hash is updated and audited", async () => {
  const t = await ownerHub();
  try {
    const { envelope: a } = await propose(t);
    t.queue("codex", "hang");
    await confirm(t, a);
    await activeWriter(t);
    const state = t.hub.providerState.get("claude");
    t.hub.providerState.set("claude", { ...state, installation: { ...state.installation, version: "9.9.9-test" } });
    await dispatch(t.hub, "factory.pause", { missionId: t.mission.id }, { channel: "owner", ownerSession: t.owner.session });
    await untilStage(t, t.mission.id, ["PAUSED"]);
    await waitFor(() => (t.hub.runs.activeRuns().length === 0 ? true : null), 15000);
    t.queue("codex", "factory-write:bug-fix");
    await dispatch(t.hub, "factory.resume", { missionId: t.mission.id }, { channel: "owner", ownerSession: t.owner.session });
    const blocked = await untilStage(t, t.mission.id, ["BLOCKED", "NEEDS_OWNER_DECISION", "DELIVERY_READY"]);
    assert.equal(blocked.factory.stage, "BLOCKED", blocked.factory.stageReason);
    assert.match(blocked.factory.stageReason, /versiunea Claude Code s-a schimbat/);
    assert.ok(events(t, "run.material_change").length >= 1);
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM agent_runs WHERE provider = 'claude' AND status <> 'blocked'"), 0, "the reviewer never started");
    const scopeBefore = t.hub.factory.list().find((f) => f.missionId === t.mission.id).scopeHash;
    const out = await propose(t, { missionIds: [t.mission.id] });
    const b = out.envelope;
    assert.ok(b, JSON.stringify(out.summary));
    assert.deepEqual(b.body.missions[0].continuation.rebind, ["reviewer"]);
    assert.match(out.summary.continuation.rebind[0], /^reviewer: /);
    assert.equal(b.body.missions[0].bindings.reviewer.resolutionEvidence.cliVersion, "9.9.9-test");
    t.queue("claude", "review:pass");
    await confirm(t, b);
    assert.equal(t.hub.envelopes.get(a.id).status, "SUPERSEDED", "plan A (still in force, waiting) replaced in the same transaction");
    const override = events(t, "factory.model_override").at(-1);
    assert.equal(override.role, "reviewer");
    assert.equal(override.envelopeId, b.id);
    assert.equal(override.via, "continuation");
    const scopeAfter = t.hub.factory.list().find((f) => f.missionId === t.mission.id).scopeHash;
    assert.notEqual(scopeAfter, scopeBefore, "scope hash recomputed");
    assert.equal(scopeAfter, b.body.missions[0].scopeHash, "…to exactly the scope the owner confirmed");
    const done = await untilStage(t, t.mission.id, ["DELIVERY_READY", "NEEDS_OWNER_DECISION", "BLOCKED"]);
    assert.equal(done.factory.stage, "DELIVERY_READY", done.factory.stageReason);
  } finally { await t.cleanup(); }
});

test("M10.2-LC-09 Windows-route plan: a Codex escalation request is declined automatically with a notice; no approval card", async () => {
  const t = await ownerHub();
  try {
    const { envelope } = await propose(t);
    assert.equal(envelope.body.workspaceScope.route, "windows");
    t.queue("codex", "approval");
    await confirm(t, envelope);
    await untilStage(t, t.mission.id, SETTLED);
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM approvals WHERE action_kind LIKE 'provider.%'"), 0, "no provider approval card mid-plan");
    const declined = events(t, "approval.plan_declined");
    assert.equal(declined.length, 1);
    assert.equal(declined[0].envelopeId, envelope.id);
    assert.ok(t.hub.db.prepare("SELECT payload_json FROM events WHERE type = 'run.notice'").all().some((r) => /refuzat automat/.test(JSON.parse(r.payload_json).text)));
    const reply = t.readLog("codex").find((l) => l.approvalReply);
    assert.equal(reply?.approvalReply?.decision, "decline");
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM task_approval_scopes"), 0, "no task scope granted implicitly");
  } finally { await t.cleanup(); }
});

test("M10.2-LC-10 „Pauză” then typed „Continuă” (same credential) reopens the gate and resumes; a provider transcript is refused; after Stop All it does not reopen", async () => {
  const t = await ownerHub();
  try {
    const intent = (text, channel = "owner") => t.hub.commands.dispatch({ type: "owner.intent", payload: { text, projectId: t.project.id }, channel, actor: channel === "voice" ? "voice" : `owner:${t.owner.session.id}`, ...(channel === "owner" ? { ownerSession: t.owner.session } : {}) }).then((r) => r.result);
    const { envelope } = await propose(t);
    t.queue("codex", "hang");
    await confirm(t, envelope);
    await activeWriter(t);
    await intent("Pauză");
    await untilStage(t, t.mission.id, ["PAUSED"]);
    const gate = t.hub.settings.get("executionGate");
    assert.equal(gate.status, "suspended");
    assert.equal(gate.suspendedBy.kind, "pause");
    assert.ok(gate.suspendedBy.credential && !gate.suspendedBy.credential.includes(t.owner.session.credentialId), "only a credential reference is stored");
    assert.deepEqual(gate.suspendedBy.missions, [t.mission.id]);
    await waitFor(() => (t.hub.runs.activeRuns().length === 0 ? true : null), 15000);
    // A provider transcript: refused by the effect class before any handler; the gate stays suspended.
    const fromProvider = await intent("Continuă", "voice");
    assert.ok(fromProvider.results.some((r) => r.refused), JSON.stringify(fromProvider.results));
    assert.equal(t.hub.settings.get("executionGate").status, "suspended");
    t.queue("codex", "factory-write:bug-fix");
    t.queue("claude", "review:pass");
    const typed = await intent("Continuă");
    const r = typed.results[0];
    assert.equal(r.interrupt?.reopened, true, JSON.stringify(r));
    assert.match(r.message, /Am redeschis poarta după pauza ta; 1 misiune reluată/);
    assert.equal(t.hub.settings.get("executionGate").status, "open");
    const done = await untilStage(t, t.mission.id, ["DELIVERY_READY", "NEEDS_OWNER_DECISION", "BLOCKED"]);
    assert.equal(done.factory.stage, "DELIVERY_READY", done.factory.stageReason);
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM commands WHERE type = 'gate.set'"), 0, "no OPEN GATE form");
    // Pause, then Stop All: „Continuă” no longer reopens (admin path).
    await intent("Pauză");
    assert.equal(t.hub.settings.get("executionGate").status, "suspended");
    await t.hub.commands.dispatch({ type: "system.stop_all", payload: { reason: "test" }, channel: "owner", actor: "owner", ownerSession: t.owner.session });
    const after = await intent("Continuă");
    assert.notEqual(after.results[0].interrupt?.reopened, true);
    assert.equal(t.hub.settings.get("executionGate").status, "suspended");
    assert.match(String(after.results[0].message), /Stop All|Sistem/);
    // A suspension recorded for another credential is not reopened either (service level).
    t.hub.bus.transaction(() => t.hub.settings.set("executionGate", { status: "suspended", reason: "Pauză (fără pași noi)", changedAt: new Date().toISOString(), changedBy: "x",
      suspendedBy: { kind: "pause", credential: "0".repeat(24), at: new Date().toISOString(), missions: [] } }, "test"));
    const other = await t.hub.interrupts.resumeOwnPause({ session: t.owner.session, actor: "test" });
    assert.equal(other.reopened, false);
    await assert.rejects(t.hub.interrupts.resumeOwnPause({ session: null, actor: "test" }), (e) => e instanceof HubError && e.category === "authentication");
  } finally { await t.cleanup(); }
});

// ---------------------------------------------------------------- operation plans
function opsExecutors(t) {
  const gate = { open: false };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  t.hub.executors["test.probe"] = {
    describe: ({ n = 1, ops = ["media.render"] }) => ({ title: `Sondă ${n}`, params: { n, ops }, ops: ops.map((op) => ({ op })), observed: [], transmitted: [], outputs: [] }),
    run: async ({ params, authorize }) => { for (const op of params.ops) authorize({ op }); return { result: { n: params.n } }; },
  };
  // Step 1 declares only a render, then tries an operation that belongs to step 2.
  t.hub.executors["test.cross"] = {
    describe: () => ({ title: "Doar randare", params: {}, ops: [{ op: "media.render" }], observed: [], transmitted: [], outputs: [] }),
    run: async ({ authorize }) => { authorize({ op: "media.render" }); authorize({ op: "export.local" }); return { result: {} }; },
  };
  // A step whose description names no folder but whose operation reads one outside the approved folders (→ folder.plan decision).
  t.hub.executors["test.import"] = {
    describe: ({ folder }) => ({ title: "Import", params: { folder }, folders: [], ops: [{ op: "media.import", path: folder }], observed: ["nume de fișiere"], transmitted: [], outputs: [] }),
    run: async ({ params, authorize }) => { authorize({ op: "media.import", path: params.folder }); return { result: { imported: 0 } }; },
  };
  t.hub.executors["test.wait"] = {
    describe: () => ({ title: "Așteaptă", params: {}, ops: [{ op: "media.render" }], observed: [], transmitted: [], outputs: [] }),
    run: async ({ authorize, abort }) => { authorize({ op: "media.render" }); while (!gate.open && !abort.aborted) await sleep(15); authorize({ op: "media.render" }); return { result: { waited: true } }; },
  };
  return { gate };
}
const opsAs = (t, owner, type, payload) => t.hub.commands.dispatch({ type, payload, channel: "owner", actor: `owner:${owner.session.id}`, ownerSession: owner.session }).then((r) => r.result);
async function againSession(t, owner) {
  const a = t.hub.trust.beginAuthentication({ origin: owner.origin });
  const opened = t.hub.trust.finishAuthentication({ origin: owner.origin, challengeId: a.challengeId, credential: owner.auth.get({ challenge: a.publicKey.challenge }) });
  return { ...owner, session: t.hub.trust.resolveSession(opened.token, { origin: owner.origin }), token: opened.token };
}

test("M10.2-LC-11 operation plans: per-step authority (a step-2 op in step 1 is OUT_OF_PLAN); a folder decided in the card is in the plan's authority", async () => {
  const t = await makeTestHub();
  try {
    const owner = await enrolOwner(t);
    opsExecutors(t);
    const p = await opsAs(t, owner, "ops.plan.propose", { kind: "test.cross", title: "Pași separați", steps: [{ kind: "test.cross", params: {} }, { kind: "test.probe", params: { n: 2, ops: ["export.local"] } }] });
    await opsAs(t, owner, "ops.plan.confirm", { planId: p.id, nonce: p.nonce, displayedHash: p.hash });
    const done = await t.hub.opsPlans.idle(p.id);
    assert.deepEqual(done.authority.steps["1"].ops, ["media.render"]);
    assert.deepEqual(done.authority.steps["2"].ops, ["export.local"]);
    assert.ok(done.authority.ops.includes("export.local"), "the plan as a whole includes it");
    assert.notEqual(done.status, "DONE");
    assert.match(done.steps[0].error, /OUT_OF_PLAN: Operația „export.local” nu face parte din pasul 1/);
    assert.equal(done.steps[1].status, "PENDING", "step 2 never ran");
    // A folder outside the approved ones, named only by the operation: a folder.plan decision → in the plan's (and the step's) folders.
    const folder = tempDir("lc11-folder");
    const q = await opsAs(t, owner, "ops.plan.propose", { kind: "test.import", title: "Import din folder", steps: [{ kind: "test.import", params: { folder } }] });
    assert.ok(q.body.decisions.some((d) => d.kind === "folder.plan"), JSON.stringify(q.body.decisions));
    assert.ok(!q.body.folders.some((f) => f === folder), "the description itself names no folder");
    const fresh = { ...owner, session: owner.reauth() };
    await opsAs(t, fresh, "ops.plan.confirm", { planId: q.id, nonce: q.nonce, displayedHash: q.hash });
    const imported = await t.hub.opsPlans.idle(q.id);
    assert.equal(imported.status, "DONE", imported.statusReason);
    assert.ok(imported.authority.folders.some((f) => f === folder));
    assert.ok(imported.authority.steps["1"].folders.some((f) => f === folder));
  } finally { await t.cleanup(); }
});

test("M10.2-LC-12 operation plan resumed after the owner session closed: a delta re-confirm in a new session of the same credential; same expiry and budget", async () => {
  const t = await makeTestHub();
  try {
    const owner = await enrolOwner(t);
    const { gate } = opsExecutors(t);
    const first = await againSession(t, owner);
    const p = await opsAs(t, first, "ops.plan.propose", { kind: "test.wait", title: "Așteaptă", steps: [{ kind: "test.wait", params: {} }] });
    await opsAs(t, first, "ops.plan.confirm", { planId: p.id, nonce: p.nonce, displayedHash: p.hash });
    await waitFor(() => t.hub.opsPlans.view(p.id).steps.some((s) => s.status === "RUNNING"));
    t.hub.trust.endSession(first.session, "test idle");
    gate.open = true;
    const stopped = await t.hub.opsPlans.idle(p.id);
    assert.equal(stopped.status, "NEEDS_OWNER");
    assert.match(stopped.steps[0].error, /SESSION_CLOSED/);
    const before = t.hub.opsPlans.view(p.id);
    const second = await againSession(t, owner);
    let card = null;
    await assert.rejects(opsAs(t, second, "ops.plan.resume", { planId: p.id }), (e) => { card = e.details?.reconfirm; return e.code === "RECONFIRM_DELTA"; });
    assert.ok(card?.nonce && card.hash === before.hash);
    assert.deepEqual(card.changed, ["sesiunea de proprietar (aceeași cheie, sesiune nouă)"]);
    assert.equal(card.unchanged.expiresAt, before.expiresAt);
    await assert.rejects(opsAs(t, second, "ops.plan.reconfirm", { planId: p.id, nonce: "0".repeat(24), displayedHash: card.hash }), /nu corespunde/);
    await assert.rejects(t.hub.commands.dispatch({ type: "ops.plan.reconfirm", payload: { planId: p.id, nonce: card.nonce, displayedHash: card.hash }, channel: "voice", actor: "voice" }), /cannot be issued through voice/);
    const resumed = await opsAs(t, second, "ops.plan.reconfirm", { planId: p.id, nonce: card.nonce, displayedHash: card.hash });
    assert.equal(resumed.authority.sessionId, second.session.id);
    assert.equal(resumed.authority.expiresAt, before.authority.expiresAt, "same expiry");
    assert.equal(resumed.authority.maxActions, before.authority.maxActions, "same budget");
    assert.deepEqual(resumed.authority.steps, before.authority.steps, "same per-step authority");
    const done = await t.hub.opsPlans.idle(p.id);
    assert.equal(done.status, "DONE", done.statusReason);
    assert.equal(events(t, "ops.plan.reconfirmed").length, 1);
    // The card is single-use.
    await assert.rejects(opsAs(t, second, "ops.plan.reconfirm", { planId: p.id, nonce: card.nonce, displayedHash: card.hash }), /nu e oprit/);
  } finally { await t.cleanup(); }
});
