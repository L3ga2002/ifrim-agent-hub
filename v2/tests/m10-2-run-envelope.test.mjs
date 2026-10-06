// Milestone 10.2 — U12: run envelopes for ONE bounded model step and the "run" planner (propose_run's replacement under voice-first).
// PASS_SIMULATED: fixture providers (fake Codex / Claude Code), software authenticator, test projects; no model, no live Hub.
// One confirmation; the Hub stays in BUILD_SAFE; exactly one grant, bound to the plan's binding and to the plan itself; the run is
// admitted through the plan; no approval row (ENVELOPE_DECIDABLE stays {factory.scope}); the grant is gone at the end. A writing
// agent is refused where a plan may never give one, with the blocker explainer's words; a manual run and a plan run never share a grant.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { makeTestHub, waitFor, enrolOwner, prepareLiveWithoutGrants } from "./helpers.mjs";
import { materializeFixture } from "../server/factory/fixtures.mjs";
import { ENVELOPE_DECIDABLE, approvalHash } from "../server/policy/approvals.mjs";
import { runScopeKey, runEnvelopeIdOf } from "../server/domain/grants.mjs";
import { RUN_ENVELOPE_LIMITS, SCOPED_LIVE_TRANSITION } from "../server/owner/envelopes.mjs";
import { RUN_ROLE_DEFAULTS, runProviderOf, runModelOf } from "../server/owner/planners/run.mjs";

const dispatch = (hub, type, payload, extra = {}) => hub.commands.dispatch({ type, payload, channel: "test", actor: "test", ...extra });
const count = (t, sql, ...args) => t.hub.db.prepare(sql).get(...args).n;
const approvalsRows = (t) => count(t, "SELECT COUNT(*) AS n FROM approvals");
const modeEvents = (t) => count(t, "SELECT COUNT(*) AS n FROM events WHERE type = 'settings.changed' AND json_extract(payload_json, '$.key') = 'mode'");
const commandCount = (t, type) => count(t, "SELECT COUNT(*) AS n FROM commands WHERE type = ?", type);
const ownerCtx = (t) => ({ channel: "test", actor: "owner:test", ownerSession: t.owner.session });
const planRun = (t, { projectId, text, args = {}, ctx = ownerCtx(t) }) => t.hub.intake.plan({ kind: "run", text, projectId, args }, ctx);
const confirm = (t, env, extra = {}) => dispatch(t.hub, "envelope.confirm", { envelopeId: env.id, nonce: env.nonce, displayedHash: env.envelopeHash, ...extra }, { ownerSession: t.owner.session });
const untilEnvelope = (t, id, statuses, ms = 30000) => waitFor(() => (statuses.includes(t.hub.envelopes.get(id).status) ? t.hub.envelopes.view(id) : null), ms, 50);

/** A test Hub with live preconditions (no grant, BUILD_SAFE), the owner enrolled, the voice-first policy on. */
async function ownerHub({ queues = false } = {}) {
  const t = await makeTestHub({ queues });
  await prepareLiveWithoutGrants(t.hub);
  t.owner = await enrolOwner(t);
  t.hubProject = t.hub.projects.hub();
  return t;
}
/** Raising autonomy is the owner's inline decision (fresh session); the Hub project starts at OBSERVE like any real project. */
const raise = (t, projectId, level = "ASSISTED") => dispatch(t.hub, "owner.autonomy.set", { projectId, level }, { ownerSession: t.owner.reauth() });
async function testProject(t, name = "factory-bug-demo") {
  const dir = path.join(t.dataDir, name);
  materializeFixture("bug-demo", dir);
  return (await dispatch(t.hub, "project.register_test", { path: dir, name: `Demo ${name}` })).result;
}

test("M10.2-RE-01 Claude read-only on the Hub project (Windows route): ONE confirmation, BUILD_SAFE kept, one bound grant, the run admitted, zero approvals, the grant gone at the end", async () => {
  const t = await ownerHub();
  try {
    const p = t.hubProject;
    assert.equal(t.hub.environments.routeFor(p.id, "claude"), "windows");
    // At OBSERVE the planner explains instead of proposing (the explainer's words, the request kept): no card, no grant.
    const observed = await planRun(t, { projectId: p.id, text: "Analizează structura proiectului și spune-mi ce module are", args: { provider: "claude" } });
    assert.ok(observed.blockedBy, "blocked at OBSERVE");
    assert.match(observed.blockedBy.signature, /AUTONOMY_OBSERVE/);
    assert.doesNotMatch(observed.message, /LIVE_VALIDATION|OPEN GATE|grant/i);
    assert.doesNotMatch(observed.blockedBy.signature, /HOST_R2_OPEN|HUB_SELF_TARGET/, "a Claude read-only turn is not blocked by R2 nor by the Hub-self rule");
    await raise(t, p.id, "ASSISTED");

    const approvalsBefore = approvalsRows(t);
    const modeBefore = modeEvents(t);
    const r = await planRun(t, { projectId: p.id, text: "Analizează structura proiectului și spune-mi ce module are", args: { provider: "claude" } });
    assert.ok(!r.refused && !r.error && !r.blockedBy, JSON.stringify(r).slice(0, 600));
    const env = r.plan.envelope;
    assert.equal(env.body.kind, "run");
    assert.deepEqual(env.missionIds, []);
    assert.deepEqual(env.body.missions, [], "mission readers iterate nothing");
    assert.equal(env.body.run.provider, "claude");
    assert.equal(env.body.run.access, "read-only");
    assert.equal(env.body.run.binding.role, "run");
    assert.equal(env.body.run.binding.resolvedAlias, RUN_ROLE_DEFAULTS.claude.model, "the role default, explicit");
    assert.equal(env.body.run.binding.effort, RUN_ROLE_DEFAULTS.claude.effort);
    assert.ok(!("probedAt" in env.body.run.binding.resolutionEvidence), "evidence timestamps are not plan content");
    assert.match(env.summary.models, /Claude sonnet/);
    assert.equal(env.summary.state, "PLAN_READY");
    assert.equal(env.body.modeTransition, SCOPED_LIVE_TRANSITION);
    assert.equal(env.status, "PROPOSED");
    assert.equal(t.hub.grants.ofEnvelope(env.id).length, 0, "a proposal grants nothing");
    assert.match(r.note, /nimic nu a pornit/);

    const confirmed = (await confirm(t, env)).result;
    assert.equal(confirmed.duplicate, false);
    const derived = t.hub.grants.ofEnvelope(env.id);
    assert.equal(derived.length, 1, "exactly one bound grant");
    const g = derived[0];
    assert.equal(g.provider, "claude");
    assert.equal(g.access, "read-only");
    assert.equal(g.maxAttempts, 1);
    assert.equal(g.binding.envelopeRunId, env.id);
    assert.equal(g.binding.missionId, undefined, "one scope per grant");
    assert.equal(g.binding.bindingHash, env.body.run.binding.bindingHash);
    assert.ok(Date.parse(g.expiresAt) <= Date.parse(t.hub.envelopes.get(env.id).expiresAt) + 1000, "never past the plan");

    const done = await untilEnvelope(t, env.id, ["COMPLETED"]);
    assert.match(done.closeReason, /Execuția s-a încheiat/);
    const runId = done.derived.runId;
    assert.ok(runId, "the run's id is recorded on the plan");
    const run = t.hub.runs.getRun(runId);
    assert.equal(run.status, "completed");
    assert.equal(run.grantId, g.id, "admitted with the plan's own grant");
    assert.equal(run.provider, "claude");
    assert.equal(run.model, "sonnet");
    assert.equal(run.plan.bindingHash, env.body.run.binding.bindingHash);
    const started = t.hub.db.prepare("SELECT payload_json FROM events WHERE type = 'run.started' AND run_id = ?").get(runId);
    assert.equal(JSON.parse(started.payload_json).grantId, g.id);
    assert.equal(t.hub.db.prepare("SELECT role, content FROM messages WHERE conversation_id = ? AND role = 'user'").get(done.derived.conversationId).content, env.body.run.task, "the conversation holds exactly the task the card showed");

    assert.equal(t.hub.settings.get("mode"), "BUILD_SAFE", "the Hub stays in BUILD_SAFE");
    assert.equal(modeEvents(t), modeBefore, "the mode was never written");
    assert.equal(approvalsRows(t), approvalsBefore, "zero approval rows");
    assert.equal(commandCount(t, "grant.create"), 0);
    assert.equal(commandCount(t, "mode.set"), 0);
    assert.equal(commandCount(t, "lega.propose_run"), 0);
    assert.ok(!["active"].includes(t.hub.grants.get(g.id).status), `the grant is not usable after the plan (${t.hub.grants.get(g.id).status})`);
    assert.equal(t.hub.grants.activeForProject(p.id).length, 0);
    assert.equal(t.hub.envelopes.liveScopes().length, 0, "nothing runs live after it");
  } finally { await t.cleanup(); }
});

test("M10.2-RE-02 a writing agent is refused where a plan may never give one, with the explainer's words; no card, no grant", async () => {
  const t = await ownerHub();
  try {
    const hubP = t.hubProject;
    await raise(t, hubP.id, "ASSISTED");
    // Codex workspace-write on the Hub's own repository.
    const self = await planRun(t, { projectId: hubP.id, text: "Repară bug-ul din src/app.js", args: { provider: "codex", access: "workspace-write", model: "gpt-fake-sol" } });
    assert.ok(self.blockedBy, "blocked");
    assert.match(self.blockedBy.signature, /HUB_SELF_TARGET/);
    assert.match(self.message, /Hub-ul nu se modifică singur|Cererea ta rămâne păstrată|Încă blocat/);
    assert.doesNotMatch(self.message, /LIVE_VALIDATION|OPEN GATE|Creează grant/);
    assert.ok(self.workRequest?.id, "the request is kept");
    const direct = await t.hub.envelopes.proposeRun({ projectId: hubP.id, provider: "codex", access: "workspace-write", task: "Repară bug-ul", model: "gpt-fake-sol", effort: "medium" });
    assert.equal(direct.envelope, null, "the envelope service refuses it too (defence in depth)");
    assert.equal(direct.refusal.code, "HUB_SELF_TARGET");
    assert.equal(direct.summary.state, "PLAN_REFUSED");
    assert.ok(direct.readiness.blockers.some((b) => b.kind === "refused"));

    // Codex workspace-write on a REAL project on the Windows route (R2 open) — even with a time-boxed R2 acceptance.
    const real = await testProject(t, "real-demo");
    t.hub.db.prepare("UPDATE projects SET source = 'registry' WHERE id = ?").run(real.id);
    await raise(t, real.id, "ASSISTED");
    const { R2_ACCEPT_TEXT } = await import("../server/policy/isolation.mjs");
    t.hub.bus.transaction(() => t.hub.settings.set("r2Acceptance", { [real.id]: { confirmedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString(), projectPath: real.path, text: R2_ACCEPT_TEXT } }, "test"));
    const r2 = await planRun(t, { projectId: real.id, text: "Repară bug-ul de numărare", args: { provider: "codex", access: "workspace-write", model: "gpt-fake-sol" } });
    assert.ok(r2.blockedBy);
    assert.match(r2.blockedBy.signature, /HOST_R2_OPEN/);
    const r2direct = await t.hub.envelopes.proposeRun({ projectId: real.id, provider: "codex", access: "workspace-write", task: "Repară bug-ul", model: "gpt-fake-sol" });
    assert.equal(r2direct.refusal.code, "HOST_R2_OPEN", "a risk accepted is not an isolation");

    // Claude never writes from a plan.
    const claudeWrite = await planRun(t, { projectId: real.id, text: "Rescrie modulul de numărare", args: { provider: "claude", access: "workspace-write" } });
    assert.ok(claudeWrite.blockedBy);
    assert.match(claudeWrite.blockedBy.signature, /RUN_CLAUDE_WRITE/);
    assert.equal((await t.hub.envelopes.proposeRun({ projectId: real.id, provider: "claude", access: "workspace-write", task: "Rescrie", model: "sonnet" })).refusal.code, "CLAUDE_READ_ONLY");

    // Codex workspace-write on a sanitized hub-test project is allowed (a card, still nothing granted).
    const testP = await testProject(t, "test-demo");
    const ok = await planRun(t, { projectId: testP.id, text: "Repară bug-ul de numărare", args: { provider: "codex", access: "workspace-write", model: "gpt-fake-sol" } });
    assert.ok(ok.plan?.envelope, JSON.stringify(ok).slice(0, 400));
    assert.equal(ok.plan.envelope.body.run.access, "workspace-write");
    assert.ok(ok.plan.envelope.body.baseSnapshot, "a writing turn is bound to the repository state shown");

    assert.equal(count(t, "SELECT COUNT(*) AS n FROM mission_envelopes WHERE project_id IN (?, ?)", hubP.id, real.id), 0, "no card for a plan that can never run");
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM live_grants"), 0);
    assert.equal(approvalsRows(t), 0);
  } finally { await t.cleanup(); }
});

test("M10.2-RE-03 a manual run never consumes a run-plan grant and a plan run never consumes a manual grant; revoke interrupts the turn", async () => {
  const t = await ownerHub({ queues: true });
  try {
    const p = t.hubProject;
    await raise(t, p.id, "ASSISTED");
    // The owner's manual LIVE_VALIDATION residue: mode + an unbound Claude read-only grant on the same project.
    t.hub.bus.transaction(() => t.hub.settings.set("mode", "LIVE_VALIDATION", "test", "manual residue"));
    const manual = t.hub.bus.transaction(() => t.hub.grants.create({ provider: "claude", projectId: p.id, access: "read-only", maxAttempts: 3, maxDurationS: 600, ttlMinutes: 30 }, "test"));
    const r = await planRun(t, { projectId: p.id, text: "Citește README și rezumă-l", args: { provider: "claude", model: "sonnet", effort: "medium" } });
    const env = r.plan.envelope;
    assert.equal(env.body.modeTransition, null, "proposed in LIVE_VALIDATION: no transition is shown");
    t.queue("claude", "hang");
    await confirm(t, env);
    const derived = t.hub.grants.ofEnvelope(env.id)[0];
    await waitFor(() => t.hub.runs.activeRuns().length === 1, 20000);
    const runId = await waitFor(() => t.hub.envelopes.get(env.id).derived.runId, 10000);
    assert.equal(t.hub.runs.getRun(runId).grantId, derived.id, "the plan run took its derived grant");
    assert.equal(t.hub.grants.get(manual.id).attemptsUsed, 0, "the manual grant stays untouched");

    // The run plan's step at the gate: admitted only through its own grant (explicit manual grant refused).
    const plan = { model: "sonnet", effort: "medium", effortSource: "owner", bindingHash: env.body.run.binding.bindingHash, missionId: runScopeKey(env.id), problem: null };
    assert.equal(runEnvelopeIdOf(plan.missionId), env.id);
    const viaManual = t.hub.gate.evaluate({ provider: "claude", projectId: p.id, access: "read-only", grantId: manual.id, plan });
    assert.match(viaManual.checks.find((c) => c.id === "live_grant").detail, /Execuția planului folosește doar grantul derivat din plan/);
    // A manual (unbound) request never takes a plan's grant. The running plan's one attempt is spent (exhausted), so an ACTIVE run-plan
    // grant is made here directly (same shape issueRunGrant writes) to show the rule itself: findUsable offers it, problem() refuses it.
    t.hub.bus.transaction(() => t.hub.grants.revoke(manual.id, "test"));
    const active = t.hub.bus.transaction(() => t.hub.grants.create({ provider: "claude", projectId: p.id, access: "read-only", maxAttempts: 1, maxDurationS: 600, ttlMinutes: 30,
      expiresAt: t.hub.envelopes.get(env.id).expiresAt, envelopeId: env.id, binding: { ...derived.binding, envelopeRunId: env.id } }, `envelope:${env.id}`));
    const manualNow = t.hub.gate.evaluate({ provider: "claude", projectId: p.id, access: "read-only" });
    const lg = manualNow.checks.find((c) => c.id === "live_grant");
    assert.equal(lg.ok, false, "the plan's grant does not admit a manual run");
    assert.equal(lg.grantId, active.id, "offered (the only active grant), and refused");
    assert.match(lg.detail, /legat de modelul confirmat în plan/);
    assert.match(t.hub.grants.problem(active, { provider: "claude", projectId: p.id, access: "read-only", now: new Date(), bindingHash: derived.binding.bindingHash, missionId: "mis_some_factory_mission" }), /execuția planului/);
    assert.equal(t.hub.grants.problem(active, { provider: "claude", projectId: p.id, access: "read-only", now: new Date(), bindingHash: derived.binding.bindingHash, missionId: runScopeKey(env.id) }), null, "only its own plan's step");
    assert.throws(() => t.hub.grants.create({ provider: "claude", projectId: p.id, access: "read-only", maxAttempts: 1, maxDurationS: 600, ttlMinutes: 30, envelopeId: "env_x", binding: { ...derived.binding, envelopeRunId: env.id } }, "test"), /doar planul care l-a derivat/);
    // And in BUILD_SAFE: the plan step is admitted by the plan (scoped), a manual run is refused on mode.
    t.hub.bus.transaction(() => t.hub.settings.set("mode", "BUILD_SAFE", "test", "back to BUILD_SAFE"));
    const scoped = t.hub.gate.evaluate({ provider: "claude", projectId: p.id, access: "read-only", plan });
    assert.equal(scoped.checks.find((c) => c.id === "mode").ok, true);
    assert.match(scoped.checks.find((c) => c.id === "mode").detail, new RegExp(`pas admis de planul ${env.id}`));
    assert.equal(scoped.checks.find((c) => c.id === "live_grant").grantId, active.id, "admitted only through an active grant of this plan");
    const otherPlan = t.hub.gate.evaluate({ provider: "claude", projectId: p.id, access: "read-only", plan: { ...plan, missionId: runScopeKey("env_other") } });
    assert.equal(otherPlan.checks.find((c) => c.id === "mode").ok, false, "another plan's scope admits nothing");
    const writeAsk = t.hub.gate.evaluate({ provider: "claude", projectId: p.id, access: "workspace-write", plan });
    assert.equal(writeAsk.checks.find((c) => c.id === "mode").ok, false, "a read-only plan never admits a write");
    assert.equal(t.hub.gate.evaluate({ provider: "claude", projectId: p.id, access: "read-only" }).checks.find((c) => c.id === "mode").ok, false, "manual run refused on mode");
    assert.equal(t.hub.envelopes.liveScopes()[0].kind, "run");
    t.hub.bus.transaction(() => t.hub.grants.revoke(active.id, "test"));

    // Revoke (fail-safe, any owner-facing channel): the turn in flight is interrupted and the grant revoked.
    await dispatch(t.hub, "envelope.revoke", { envelopeId: env.id, reason: "test" });
    await waitFor(() => t.hub.runs.activeRuns().length === 0, 20000);
    assert.equal(t.hub.envelopes.get(env.id).status, "REVOKED");
    assert.equal(t.hub.grants.get(derived.id).status !== "active", true);
    await waitFor(() => ["interrupted", "failed"].includes(t.hub.runs.getRun(runId).status), 10000);
  } finally { await t.cleanup(); }
});

test("M10.2-RE-04 approvals.decideByEnvelope still refuses lega.run_request; ENVELOPE_DECIDABLE is exactly {factory.scope}", async () => {
  const t = await ownerHub();
  try {
    assert.deepEqual([...ENVELOPE_DECIDABLE], ["factory.scope"]);
    const p = t.hubProject;
    await raise(t, p.id, "ASSISTED");
    const r = await planRun(t, { projectId: p.id, text: "Analizează fișierul README", args: { provider: "claude" } });
    const env = r.plan.envelope;
    const legacy = await dispatch(t.hub, "lega.propose_run", { projectId: p.id, provider: "claude", access: "read-only", task: "Analizează fișierul README", model: "sonnet" });
    assert.equal(legacy.approvalRequired, true);
    const a = legacy.approval;
    const expected = approvalHash({ actionKind: a.actionKind, target: a.target, payload: a.payload, codeVersion: a.codeVersion, permissionTier: a.permissionTier, scopeType: a.scopeType, scopeId: a.scopeId });
    assert.throws(() => t.hub.approvals.decideByEnvelope(a.id, { envelopeId: env.id, sessionId: t.owner.session.id, expectedHash: expected }), /cannot be decided by a mission envelope/);
    assert.equal(t.hub.approvals.get(a.id).status, "pending");
  } finally { await t.cleanup(); }
});

test("M10.2-RE-05 the model is always explicit: role defaults per provider, a model the account does not list blocks (never the account default)", async () => {
  assert.equal(runProviderOf({}, "Analizează codul"), "claude");
  assert.equal(runProviderOf({}, "Folosește Codex să citească testele"), "codex");
  assert.equal(runProviderOf({ provider: "codex" }, "claude"), "codex");
  assert.deepEqual(runModelOf("codex", {}), { model: RUN_ROLE_DEFAULTS.codex.model, effort: RUN_ROLE_DEFAULTS.codex.effort, source: "role_default" });
  assert.deepEqual(runModelOf("claude", { model: "opus" }), { model: "opus", effort: "", source: "request" });
  const t = await ownerHub();
  try {
    const testP = await testProject(t);
    // The Codex role default (gpt-6.1-sol) is not in the fixture account's model/list: blocked, the request kept; nothing proposed.
    const r = await planRun(t, { projectId: testP.id, text: "Citește testele și spune ce acoperă", args: { provider: "codex" } });
    assert.ok(r.blockedBy, JSON.stringify(r).slice(0, 400));
    assert.equal(r.blockedBy.signature, "RUN_MODEL_UNRESOLVED");
    assert.match(r.message, /nu apare în model\/list|nu folosesc implicitul contului|păstrată/);
    // The service itself never falls back to the account default: an empty model is incomplete.
    const empty = await t.hub.envelopes.proposeRun({ projectId: testP.id, provider: "codex", access: "read-only", task: "Citește testele", model: "" });
    assert.equal(empty.envelope, null);
    assert.equal(empty.summary.state, "PLAN_INCOMPLETE");
    assert.match(empty.summary.blockers.join(" "), /fixat explicit/);
    const claudeEmpty = await t.hub.envelopes.proposeRun({ projectId: testP.id, provider: "claude", access: "read-only", task: "Citește testele", model: "" });
    assert.equal(claudeEmpty.envelope, null);
    // Refused models stay refused.
    const fable = await t.hub.envelopes.proposeRun({ projectId: testP.id, provider: "claude", access: "read-only", task: "Citește testele", model: "fable" });
    assert.equal(fable.envelope, null);
    // Validation: too short, too long, secret-looking task.
    await assert.rejects(() => t.hub.envelopes.proposeRun({ projectId: testP.id, provider: "claude", task: "x", model: "sonnet" }), /prea scurtă/);
    await assert.rejects(() => t.hub.envelopes.proposeRun({ projectId: testP.id, provider: "claude", task: "a".repeat(RUN_ENVELOPE_LIMITS.taskMax + 1), model: "sonnet" }), /caractere/);
    await assert.rejects(() => t.hub.envelopes.proposeRun({ projectId: testP.id, provider: "claude", task: "Citește cheia sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", model: "sonnet" }), /secret/);
    // An explicit Codex model from the list gives a card with exactly that model.
    const ok = await planRun(t, { projectId: testP.id, text: "Citește testele și spune ce acoperă", args: { provider: "codex", model: "gpt-fake-sol", effort: "high" } });
    assert.equal(ok.plan.envelope.body.run.binding.resolvedAlias, "gpt-fake-sol");
    assert.equal(ok.plan.envelope.body.run.binding.effort, "high");
  } finally { await t.cleanup(); }
});

test("M10.2-RE-06 a run plan changed after it was shown (Claude CLI version) is superseded at confirmation; nothing runs", async () => {
  const t = await ownerHub();
  try {
    const testP = await testProject(t);
    const r = await planRun(t, { projectId: testP.id, text: "Analizează modulul de numărare", args: { provider: "claude" } });
    const env = r.plan.envelope;
    const state = t.hub.providerState.get("claude");
    t.hub.providerState.set("claude", { ...state, installation: { ...state.installation, version: "9.9.9 (Claude Code)" } });
    await assert.rejects(() => confirm(t, env), /s-a schimbat după ce l-ai văzut/);
    const after = t.hub.envelopes.get(env.id);
    assert.equal(after.status, "SUPERSEDED");
    assert.match(after.closeReason, /sarcina, providerul, accesul sau modelul execuției|legătura modelului/);
    assert.equal(t.hub.grants.ofEnvelope(env.id).length, 0);
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM agent_runs"), 0);
    // A plan whose nonce / hash the owner did not see is refused (the consumable confirmation is the same as for missions).
    t.hub.providerState.set("claude", state);
    const r2 = await planRun(t, { projectId: testP.id, text: "Analizează modulul de numărare", args: { provider: "claude" } });
    await assert.rejects(() => dispatch(t.hub, "envelope.confirm", { envelopeId: r2.plan.envelope.id, nonce: "0".repeat(24), displayedHash: r2.plan.envelope.envelopeHash }, { ownerSession: t.owner.session }), /nu corespunde planului afișat/);
    assert.equal(t.hub.envelopes.get(r2.plan.envelope.id).status, "PROPOSED");
  } finally { await t.cleanup(); }
});

test("M10.2-RE-07 a provider transcript may PROPOSE a run plan but never confirm it; no lega.run_request card under voice-first", async () => {
  const t = await ownerHub();
  try {
    const testP = await testProject(t);
    const r = await planRun(t, { projectId: testP.id, text: "Analizează modulul de numărare", args: { provider: "claude" }, ctx: { channel: "voice", actor: "lega" } });
    assert.ok(r.plan?.envelope, JSON.stringify(r).slice(0, 400));
    const env = r.plan.envelope;
    const said = await t.hub.intake.handle({ text: "Da, execută planul", presented: { envelopeId: env.id, nonce: env.nonce, hash: env.envelopeHash }, projectId: testP.id }, { channel: "voice", actor: "lega" });
    assert.ok(said.results.every((x) => !x.confirmed), "a provider transcript never confirms");
    assert.equal(t.hub.envelopes.get(env.id).status, "PROPOSED");
    assert.equal(t.hub.grants.ofEnvelope(env.id).length, 0);
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM approvals WHERE action_kind = 'lega.run_request'"), 0);
    // The planner is registered on the intake under its kind.
    assert.ok(t.hub.intake.planners().includes("run"));
  } finally { await t.cleanup(); }
});
