// Milestone 10.2 — review group G1 (findings #1/#3/#31, #34, #35, #36, #2/#9, #10, #11, #12, #15). PASS_SIMULATED: fixture providers,
// the simulated ifrim-runner distro (tests/fixtures/fake-wsl.mjs), the software authenticator, test projects; no model, no live Hub.
//  - a plan blocked ONLY by automatic readiness: the steps needing no confirmation run before the proposal; a same-fingerprint
//    re-attestation runs under the plan's ONE confirmation, then the mission starts (or the plan closes FAILED_TO_START, honestly);
//  - a confirmed plan's mission BLOCKED on the environment resumes after the readiness pass clears it;
//  - an automatic attestation never attests a fingerprint that changed after the guard looked at it;
//  - every blocking billing entry is explained (never blocked:false while the gate refuses);
//  - revoking one derived grant from outside its plan revokes the plan (the top-up never re-derives it);
//  - a run plan whose turn died in a restart frees the project's open-plan slot at boot;
//  - an interrupted plan step gives its grant attempt back (bounded); an attempt delta raises only the exhausted stage;
//  - a held plan / a mission that is not waiting has no "difference" to confirm;
//  - an armed spoken confirmation is scoped to the armed plan even when another project's plan waits.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { makeTestHub, enrolOwner, prepareLiveWithoutGrants, waitFor } from "./helpers.mjs";
import { enrolVoice, speak, startDerivedLega } from "./voice-helpers.mjs";
import { materializeFixture, demoSpec } from "../server/factory/fixtures.mjs";
import { explain } from "../server/owner/blockers.mjs";
import { CANARY_VERSION } from "../server/environments/canary.mjs";
import { ENV_POLICY_TEXT } from "../server/policy/isolation.mjs";
import { ENVELOPE_LIMITS } from "../server/owner/envelopes.mjs";
import { grantBindingOf } from "../server/policy/model-binding.mjs";

const M09_MODELS = { writerModel: "gpt-fake-sol", reviewerModel: "sonnet" };
const OLD_CANARY = "m05-canary-1+e1fde725";
const BUG = "Repară bug-ul: un nume format doar din spații trece de validare. Testul de acceptanță e test/acceptance.test.mjs.";
const dispatch = (hub, type, payload, extra = {}) => hub.commands.dispatch({ type, payload, channel: "test", actor: "test", ...extra });
const count = (t, sql, ...args) => t.hub.db.prepare(sql).get(...args).n;
const events = (t, type) => t.hub.db.prepare("SELECT payload_json, source, scope_id FROM events WHERE type = ? ORDER BY seq").all(type).map((r) => ({ ...JSON.parse(r.payload_json), _source: r.source, _scope: r.scope_id }));
const confirm = (t, env, extra = {}) => dispatch(t.hub, "envelope.confirm", { envelopeId: env.id, nonce: env.nonce, displayedHash: env.envelopeHash, ...extra }, { ownerSession: t.owner.session });
const stageOf = (t, id) => t.hub.factory.view(id).factory;
const untilStage = (t, id, stages, ms = 60000) => waitFor(() => (stages.includes(stageOf(t, id).stage) ? stageOf(t, id) : null), ms, 100);
const activeRun = (t, provider = "codex") => waitFor(() => (t.hub.runs.activeRuns().some((r) => r.provider === provider) ? true : null), 30000, 50);
const noRuns = (t) => waitFor(() => (t.hub.runs.activeRuns().length === 0 ? true : null), 20000, 50);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function stopAll(t) {
  await dispatch(t.hub, "system.stop_all", { reason: "test" }, { channel: "owner", ownerSession: t.owner.session }).catch(() => {});
  await noRuns(t).catch(() => {});
}

/** Windows route, hub-test bug-demo project, owner enrolled (voice-first), TRUSTED, one SPEC_DRAFT mission with explicit models. */
async function windowsHub({ level = "TRUSTED", limits = {}, codexModels = true } = {}) {
  const t = await makeTestHub({ queues: true });
  if (codexModels) (await import("node:fs")).default.writeFileSync(`${t.logs.codex}.models.json`, JSON.stringify([{ id: "gpt-6.1-sol", isDefault: true, efforts: ["medium", "high"] }, { id: "gpt-fake-sol", efforts: ["medium", "high"] }]));
  await prepareLiveWithoutGrants(t.hub);
  const dir = path.join(t.dataDir, "factory-bug-demo");
  materializeFixture("bug-demo", dir);
  const project = (await dispatch(t.hub, "project.register_test", { path: dir })).result;
  const owner = await enrolOwner(t);
  await dispatch(t.hub, "owner.autonomy.set", { projectId: project.id, level }, { ownerSession: owner.reauth() });
  return { ...t, project, dir, owner };
}
const prepareMission = async (t, limits = {}) => (await dispatch(t.hub, "factory.prepare", { projectId: t.project.id, ...demoSpec("bug-demo"), limits: { ...M09_MODELS, ...limits } })).result.mission;
/** The account check of a provider is gone (never probed / stale on the Windows route): billing identity "unverified". */
const dropAccount = (t, provider) => t.hub.providerState.set(provider, { ...t.hub.providerState.get(provider), auth: null });

/** The simulated distro attested, a routed test project, approval (b) on the attested fingerprint, the owner, a mission draft. */
async function envHub({ approveB = true } = {}) {
  const t = await makeTestHub({ wsl: true, queues: true });
  const { hub } = t;
  await dispatch(hub, "environment.inspect", { environmentId: "wsl-runner" });
  await dispatch(hub, "environment.probe", { environmentId: "wsl-runner" });
  const att = (await dispatch(hub, "environment.attest", { environmentId: "wsl-runner" })).result;
  assert.match(att.status, /^PASS/, JSON.stringify(att));
  await prepareLiveWithoutGrants(hub);
  const dir = path.join(t.dataDir, "factory-bug-demo");
  materializeFixture("bug-demo", dir);
  const project = (await dispatch(hub, "project.register_test", { path: dir })).result;
  await dispatch(hub, "project.environment.set", { projectId: project.id, environment: "wsl-runner" });
  const owner = await enrolOwner(t);
  await dispatch(hub, "owner.autonomy.set", { projectId: project.id, level: "TRUSTED" }, { ownerSession: owner.reauth() });
  if (approveB) await dispatch(hub, "environment.policy.approve", { confirmText: ENV_POLICY_TEXT, fingerprintHash: hub.wslRunner.state().fingerprint.hash }, { ownerSession: owner.session });
  const { mission } = (await dispatch(hub, "factory.prepare", { projectId: project.id, ...demoSpec("bug-demo"), limits: M09_MODELS })).result;
  /** An upgrade: the canary version moves (same fingerprint) and the account check through the environment ages past 24 h. */
  const invalidate = () => {
    hub.db.prepare("UPDATE environment_attestations SET canary_version = ?").run(OLD_CANARY);
    hub.providerState.set("codex@wsl-runner", { ...hub.providerState.get("codex@wsl-runner"), probedAt: new Date(Date.now() - 30 * 3600000).toISOString() });
  };
  return { ...t, project, owner, mission, invalidate };
}

// ---------------------------------------------------------------- #3 / #31 (a): steps needing no confirmation run before the proposal
test("G1-01 (#3/#31a) a stale account check (Windows) is refreshed by the Hub BEFORE proposing: the plan is PLAN_READY and confirms in one click", async () => {
  const t = await windowsHub();
  try {
    dropAccount(t, "codex");
    const pre = explain(await (await import("../server/owner/readiness-runner.mjs")).collectFacts(t.hub, { projectId: t.project.id, intent: "engineering", plan: false }));
    assert.deepEqual(pre.causes, ["ACCOUNT_CHECK_STALE"], "precondition: only the automatic account check blocks");
    const r = await t.hub.intake.plan({ kind: "engineering", text: BUG, projectId: t.project.id }, { channel: "owner", ownerSession: t.owner.session, actor: "owner" });
    const env = r.plan?.envelope;
    assert.ok(env?.id, JSON.stringify(r).slice(0, 600));
    assert.equal(r.plan.summary.state, "PLAN_READY", (r.plan.summary.blockers || []).join(" · "));
    assert.doesNotMatch(r.note, /După confirmare fac singur/, "nothing left for after the confirmation");
    const probes = t.hub.db.prepare("SELECT actor, channel FROM commands WHERE type = 'provider.probe' AND channel = 'automation'").all();
    assert.equal(probes.length, 1, "one inference-free account check on the automation channel");
    assert.match(probes[0].actor, /^readiness:/);
    t.queue("codex", "hang");
    const confirmed = (await confirm(t, env)).result.envelope;
    assert.equal(confirmed.status, "ACTIVE");
    await activeRun(t);
    await stopAll(t);
  } finally { await t.cleanup(); }
});

test("G1-02 (#3/#31a) the run planner refreshes a stale Claude account check before proposing; the run plan is PLAN_READY", async () => {
  const t = await windowsHub({ level: "ASSISTED" });
  try {
    dropAccount(t, "claude");
    const r = await t.hub.intake.plan({ kind: "run", text: "Analizează structura proiectului și spune-mi ce module are", projectId: t.project.id, args: { provider: "claude" } },
      { channel: "test", actor: "owner:test", ownerSession: t.owner.session });
    assert.ok(!r.blockedBy, JSON.stringify(r.blockedBy || r.message || "").slice(0, 400));
    assert.equal(r.plan?.envelope?.body?.kind, "run");
    assert.equal(r.plan.summary.state, "PLAN_READY");
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM commands WHERE type = 'provider.probe' AND channel = 'automation' AND payload_json LIKE '%claude%'"), 1);
  } finally { await t.cleanup(); }
});

// ---------------------------------------------------------------- #1 / #31 (b): the re-attestation under the ONE confirmation
test("G1-03 (#1/#31b) canary changed + C16 stale on the same fingerprint: the plan is confirmable; its one confirmation re-attests, re-checks and starts the mission", async () => {
  const t = await envHub();
  try {
    const { hub } = t;
    t.invalidate();
    assert.equal(hub.wslRunner.attestationStatus().valid, false);
    const proposed = (await dispatch(hub, "envelope.propose", { projectId: t.project.id, missionIds: [t.mission.id] })).result;
    assert.equal(proposed.summary.state, "PLAN_READY_AFTER_READINESS", JSON.stringify(proposed.summary.blockers));
    assert.deepEqual(proposed.summary.blockers, [], "no disabling blockers on the card");
    assert.ok(proposed.summary.preSteps.some((s) => /Re-atestez/.test(s)), JSON.stringify(proposed.summary.preSteps));
    const env = proposed.envelope;
    t.queue("codex", "hang");
    const out = (await confirm(t, env)).result.envelope;
    assert.equal(out.status, "ACTIVE", out.closeReason || "");
    assert.ok(out.consent.afterReadiness, "the consent names the readiness pre-steps it covered");
    const att = hub.wslRunner.attestationStatus();
    assert.equal(att.valid, true);
    assert.equal(att.latest.canaryVersion, CANARY_VERSION);
    assert.equal(att.latest.channel, "automation");
    assert.equal(att.latest.actor, `readiness:${env.id}`);
    assert.equal(events(t, "envelope.confirmed").length, 1, "ONE confirmation, never a second one");
    assert.equal(events(t, "envelope.readiness_cleared").length, 1);
    assert.notEqual(stageOf(t, t.mission.id).stage, "SPEC_DRAFT", "the mission started under the same consent");
    assert.equal(hub.settings.get("mode"), "BUILD_SAFE");
    await stopAll(t);
  } finally { await t.cleanup(); }
});

test("G1-04 (#1/#31b) without approval (b) the re-attestation is the owner's step: the card stays blocked and confirm records nothing; a pre-step that fails closes FAILED_TO_START", async () => {
  const t = await envHub({ approveB: false });
  try {
    const { hub } = t;
    t.invalidate();
    const proposed = (await dispatch(hub, "envelope.propose", { projectId: t.project.id, missionIds: [t.mission.id] })).result;
    assert.notEqual(proposed.summary.state, "PLAN_READY_AFTER_READINESS");
    await assert.rejects(confirm(t, proposed.envelope), /Nu pot porni/);
    assert.equal(events(t, "envelope.confirmed").length, 0, "no consent recorded");
    assert.equal(hub.envelopes.get(proposed.envelope.id).status, "PROPOSED");
  } finally { await t.cleanup(); }
  const u = await envHub();
  try {
    u.invalidate();
    u.wslState({ canaryFail: ["C3"] }); // the automatic attestation fails (never retried): nothing may start
    const proposed = (await dispatch(u.hub, "envelope.propose", { projectId: u.project.id, missionIds: [u.mission.id] })).result;
    assert.equal(proposed.summary.state, "PLAN_READY_AFTER_READINESS");
    await assert.rejects(confirm(u, proposed.envelope), /pașii de pregătire nu au deblocat planul/);
    const env = u.hub.envelopes.get(proposed.envelope.id);
    assert.equal(env.status, "FAILED_TO_START");
    assert.equal(stageOf(u, u.mission.id).stage, "SPEC_DRAFT", "nothing started");
    assert.equal(count(u, "SELECT COUNT(*) AS n FROM agent_runs"), 0);
    assert.ok(u.hub.grants.ofEnvelope(env.id).every((g) => g.status !== "active"));
  } finally { await u.cleanup(); }
});

// ---------------------------------------------------------------- #34: resume after a readiness pass clears a confirmed plan's block
test("G1-05 (#34) a confirmed plan's mission BLOCKED on the environment (C16 stale + canary changed) resumes by itself after the readiness pass", async () => {
  const t = await envHub();
  try {
    const { hub } = t;
    const env = (await dispatch(hub, "envelope.propose", { projectId: t.project.id, missionIds: [t.mission.id] })).result.envelope;
    assert.equal(env.summary.state, "PLAN_READY");
    t.queue("codex", "hang");
    await confirm(t, env);
    await activeRun(t);
    await dispatch(hub, "factory.pause", { missionId: t.mission.id }, { channel: "owner", ownerSession: t.owner.session });
    await untilStage(t, t.mission.id, ["PAUSED"]);
    await noRuns(t);
    t.invalidate();
    t.queue("codex", "hang", "hang");
    await dispatch(hub, "factory.resume", { missionId: t.mission.id }, { channel: "owner", ownerSession: t.owner.session });
    // Refused at the gate (isolation: stale account check / canary) → BLOCKED "gate" → the pass → the same plan resumes the mission.
    const resumed = await waitFor(() => events(t, "readiness.mission_resumed")[0] || null, 120000, 200);
    assert.equal(resumed.missionId, t.mission.id);
    assert.equal(resumed.waitReason, "gate");
    await activeRun(t);
    assert.equal(hub.wslRunner.attestationStatus().valid, true);
    assert.ok(["ACTIVE", "WAITING_OWNER"].includes(hub.envelopes.get(env.id).status));
    assert.equal(events(t, "envelope.confirmed").length, 1, "no new confirmation, no new plan");
    await stopAll(t);
  } finally { await t.cleanup(); }
});

// ---------------------------------------------------------------- #35: the automatic attestation is bound to the guarded fingerprint
test("G1-06 (#35) an automatic re-attestation refuses a fingerprint that changed after the guard looked at it (before the canary)", async () => {
  const t = await envHub();
  try {
    const { hub } = t;
    t.invalidate();
    const before = count(t, "SELECT COUNT(*) AS n FROM environment_attestations");
    const canaries = () => t.wslLog().filter((l) => l.script === "env:canary").length;
    const canariesBefore = canaries();
    t.wslState({ facts: { codex_version: "0.160.0" } }); // the distro changes; svc.state() still shows the approved fingerprint
    hub.readiness.reattestAllowed = () => ({ ok: true, kind: "envelope", id: "env_test", projectId: t.project.id });
    await assert.rejects(dispatch(hub, "environment.attest", { environmentId: "wsl-runner", readinessFor: "envelope:env_test", allowRestart: true }, { channel: "automation", actor: "readiness:env_test" }),
      /Amprenta mediului s-a schimbat între verificare și atestare/);
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM environment_attestations"), before, "nothing attested on the automation channel");
    assert.equal(canaries(), canariesBefore, "refused before the canary (no C15 restart)");
    // The owner's own attestation (UI) is not bound: a new fingerprint is the owner's decision.
    const own = (await dispatch(hub, "environment.attest", { environmentId: "wsl-runner" })).result;
    assert.match(own.status, /^PASS/);
  } finally { await t.cleanup(); }
});

// ---------------------------------------------------------------- #36: every blocking billing entry is explained
test("G1-07 (#36) a billing_route refused only for an unreported plan type / an uninspected config is explained (never blocked:false)", () => {
  const project = { id: "p", name: "T", source: "hub-test", route: "windows" };
  const check = (billing) => ({ role: "writer", provider: "codex", id: "billing_route", ok: false, detail: "x", billing });
  const plan = explain({ intent: "engineering", project, gate: { status: "open" }, autonomy: "ASSISTED", checks: [check([{ id: "plan", status: "unverified", detail: "Tipul planului nu este raportat" }, { id: "allowance", status: "unverified", detail: "n/a" }])] });
  assert.equal(plan.blocked, true);
  assert.deepEqual(plan.causes, ["BILLING_UNVERIFIED"]);
  assert.match(plan.text, /Tipul planului nu este raportat/);
  assert.equal(plan.options[0].kind, "admin", "an unknown plan is never assumed included");
  assert.equal(plan.automaticOnly, false);
  const config = explain({ intent: "engineering", project, gate: { status: "open" }, autonomy: "ASSISTED", checks: [check([{ id: "config", status: "unverified", detail: "Configurația Codex nu a fost inspectată" }])] });
  assert.equal(config.automaticOnly, true);
  assert.deepEqual(config.steps.map((s) => [s.command, s.payload.provider]), [["provider.probe", "codex"]]);
  // Entries an earlier branch explains are not repeated; allowance / credits never block.
  const stale = explain({ intent: "engineering", project, gate: { status: "open" }, autonomy: "ASSISTED", checks: [check([{ id: "identity", status: "unverified", detail: "i" }, { id: "provider_side_overage_setting", status: "unverified", detail: "d" }, { id: "credits", status: "unverified", detail: "c" }])] });
  assert.deepEqual(stale.causes, ["ACCOUNT_CHECK_STALE"]);
});

// ---------------------------------------------------------------- #2 / #9: an external revoke of a derived grant revokes the plan
test("G1-08 (#2/#9) grant.revoke of a plan's derived grant (UI fail-safe) revokes the plan and pauses the mission; the top-up never re-derives it", async () => {
  const t = await windowsHub();
  try {
    const mission = await prepareMission(t);
    const env = (await dispatch(t.hub, "envelope.propose", { projectId: t.project.id, missionIds: [mission.id] })).result.envelope;
    t.queue("codex", "hang");
    await confirm(t, env);
    await activeRun(t);
    const g1 = t.hub.grants.ofEnvelope(env.id).find((g) => g.binding?.role === "writer");
    // Defence in depth, synchronously (before the post-commit listener runs): the top-up refuses to mint a new grant.
    t.hub.bus.transaction(() => t.hub.grants.revoke(g1.id, "owner:direct"));
    assert.deepEqual(t.hub.envelopes.topUp(mission.id, "writer", g1.binding.bindingHash), { held: true });
    const derivedBefore = events(t, "envelope.grants_derived").length;
    const revoked = await waitFor(() => (t.hub.envelopes.get(env.id).status === "REVOKED" ? t.hub.envelopes.get(env.id) : null), 15000, 50);
    assert.match(revoked.closeReason, /Grantul derivat/);
    await untilStage(t, mission.id, ["PAUSED"], 20000);
    await noRuns(t);
    assert.ok(t.hub.grants.ofEnvelope(env.id).every((g) => g.status !== "active"), "every other derived grant revoked too");
    assert.equal(events(t, "envelope.grants_derived").length, derivedBefore, "no new grant derived");
    const started = () => count(t, "SELECT COUNT(*) AS n FROM agent_runs WHERE status <> 'blocked'");
    const before = started();
    await dispatch(t.hub, "factory.resume", { missionId: mission.id }, { channel: "owner", ownerSession: t.owner.session }).catch(() => {});
    await sleep(1500);
    assert.equal(events(t, "envelope.grants_derived").length, derivedBefore, "a resume does not revive the plan's authority");
    assert.equal(started(), before, "no model step started");
  } finally { await stopAll(t); await t.cleanup(); }
});

test("G1-09 (#2/#9) the same through the grant.revoke command on the ui channel (no direct call)", async () => {
  const t = await windowsHub();
  try {
    const mission = await prepareMission(t);
    const env = (await dispatch(t.hub, "envelope.propose", { projectId: t.project.id, missionIds: [mission.id] })).result.envelope;
    t.queue("codex", "hang");
    await confirm(t, env);
    await activeRun(t);
    const g1 = t.hub.grants.ofEnvelope(env.id).find((g) => g.binding?.role === "writer");
    await dispatch(t.hub, "grant.revoke", { grantId: g1.id }, { channel: "ui", actor: "user" });
    await waitFor(() => (t.hub.envelopes.get(env.id).status === "REVOKED" ? true : null), 15000, 50);
    await untilStage(t, mission.id, ["PAUSED"], 20000);
    // A second click on the already revoked grant of a closed plan changes nothing.
    await dispatch(t.hub, "grant.revoke", { grantId: g1.id }, { channel: "ui", actor: "user" });
    await sleep(300);
    assert.equal(events(t, "envelope.revoked").length, 1);
  } finally { await stopAll(t); await t.cleanup(); }
});

// ---------------------------------------------------------------- #10: boot reconciliation of run plans
test("G1-10 (#10) an open run plan whose turn died with the previous process is closed at boot (grant revoked); a new plan on the project confirms", async () => {
  const t = await windowsHub({ level: "ASSISTED" });
  try {
    const planRun = () => t.hub.envelopes.proposeRun({ projectId: t.project.id, provider: "claude", access: "read-only", task: "Analizează structura proiectului", model: "sonnet", effort: "" });
    const a = (await planRun()).envelope;
    assert.ok(a?.id);
    // The state the previous process left: ACTIVE, confirmed in the owner session, its bound grant, a run that no longer exists.
    t.hub.db.prepare("UPDATE mission_envelopes SET status = 'ACTIVE', confirmed_at = ?, owner_session_id = ?, consent_json = ?, derived_json = ? WHERE id = ?")
      .run(new Date().toISOString(), t.owner.session.id, JSON.stringify({ channel: "owner_session" }), JSON.stringify({ runId: "run_died_in_restart" }), a.id);
    const g = t.hub.bus.transaction(() => t.hub.grants.create({ provider: "claude", projectId: t.project.id, access: "read-only", maxAttempts: 1, maxDurationS: 600, ttlMinutes: 30,
      expiresAt: new Date(Date.now() + 30 * 60000).toISOString(), envelopeId: a.id, binding: { ...grantBindingOf(a.body.run.binding), envelopeRunId: a.id } }, `envelope:${a.id}`));
    const report = t.hub.envelopes.recoverRuns();
    assert.deepEqual(report.map((r) => [r.envelopeId, r.status]), [[a.id, "COMPLETED"]]);
    assert.equal(t.hub.grants.get(g.id).status, "revoked");
    assert.match(t.hub.envelopes.get(a.id).closeReason, /Hub-ul a repornit/);
    // The project's open-plan slot is free: a new run plan confirms (the fixture Claude finishes the turn at once).
    const b = (await planRun()).envelope;
    const confirmed = (await confirm(t, b)).result.envelope;
    assert.equal(confirmed.status === "ACTIVE" || confirmed.status === "COMPLETED", true, confirmed.status);
    // Not yet started at all (no runId recorded) → FAILED_TO_START.
    await waitFor(() => (t.hub.envelopes.get(b.id).status === "COMPLETED" ? true : null), 30000, 50);
    const c = (await planRun()).envelope;
    t.hub.db.prepare("UPDATE mission_envelopes SET status = 'CONFIRMED', confirmed_at = ?, derived_json = '{}' WHERE id = ?").run(new Date().toISOString(), c.id);
    assert.deepEqual(t.hub.envelopes.recoverRuns().map((r) => r.status), ["FAILED_TO_START"]);
    assert.ok(t.hub.getBootReport() === null || "runEnvelopes" in t.hub.getBootReport(), "the boot report carries the reconciliation");
  } finally { await stopAll(t); await t.cleanup(); }
});

// ---------------------------------------------------------------- #11: interrupted plan steps and the attempt delta
test("G1-11 (#11) an interrupted plan step gives its grant attempt back (once, recorded); an attempt delta raises only the exhausted stage", async () => {
  const t = await windowsHub();
  try {
    const mission = await prepareMission(t);
    const env = (await dispatch(t.hub, "envelope.propose", { projectId: t.project.id, missionIds: [mission.id] })).result.envelope;
    t.queue("codex", "hang");
    await confirm(t, env);
    await activeRun(t);
    const g1 = t.hub.grants.ofEnvelope(env.id).find((g) => g.binding?.role === "writer");
    await waitFor(() => (t.hub.grants.get(g1.id).attemptsUsed === 1 ? true : null), 10000, 50);
    // The turn reached the provider (a start stopped before it is refunded by the run manager itself, never forgiven twice).
    await waitFor(() => t.hub.db.prepare("SELECT 1 FROM agent_runs WHERE grant_id = ? AND json_extract(timeline_json, '$.turn_sent') IS NOT NULL").get(g1.id) || null, 15000, 50);
    await dispatch(t.hub, "factory.pause", { missionId: mission.id }, { channel: "owner", ownerSession: t.owner.session });
    await untilStage(t, mission.id, ["PAUSED"]);
    await noRuns(t);
    const forgiven = await waitFor(() => events(t, "envelope.attempt_forgiven")[0] || null, 15000, 50);
    assert.equal(forgiven.missionId, mission.id);
    assert.equal(forgiven.role, "writer");
    assert.equal(t.hub.grants.get(g1.id).attemptsUsed, 0, "the interrupted turn is not an attempt for the plan either");
    // Idempotent per run: the same interruption reported again gives nothing more.
    const run = t.hub.db.prepare("SELECT id FROM agent_runs WHERE grant_id = ? ORDER BY created_at DESC LIMIT 1").get(g1.id);
    t.hub.envelopes.authorityFor(mission.id, { stage: "INTERRUPTED", grantId: g1.id, runId: run.id });
    assert.equal(events(t, "envelope.attempt_forgiven").length, 1);
    assert.equal(ENVELOPE_LIMITS.maxForgivenAttempts, 3);

    // The attempt delta: the step's attempts are exhausted (simulated: its dispatch failed after the turn, limit 1).
    const f = t.hub.factory.list().find((x) => x.missionId === mission.id);
    t.hub.db.prepare("UPDATE factory_missions SET stage = 'NEEDS_OWNER_DECISION', wait_reason = 'owner_decision', limits_json = ? WHERE mission_id = ?").run(JSON.stringify({ ...f.limits, maxAttemptsPerStage: 1 }), mission.id);
    t.hub.db.prepare("UPDATE factory_dispatches SET status = 'FAILED' WHERE mission_id = ?").run(mission.id);
    t.hub.db.prepare("UPDATE agent_runs SET timeline_json = json_set(COALESCE(timeline_json, '{}'), '$.turn_sent', 1) WHERE id = ?").run(run.id);
    const step = t.hub.factory.exhaustedStep(mission.id);
    assert.equal(step?.stage, "IMPLEMENTING", JSON.stringify(step));
    const out = t.hub.factory.raiseLimits(mission.id, { attempt: true, envelopeId: env.id });
    const limits = t.hub.factory.list().find((x) => x.missionId === mission.id).limits;
    assert.equal(limits.maxAttemptsPerStage, 1, "the other stages keep their limit (the plan's budget grew by one attempt only)");
    assert.equal(limits.stageAttempts.IMPLEMENTING, 2);
    assert.equal(out.stage, "IMPLEMENTING");
    assert.equal(t.hub.factory.exhaustedStep(mission.id), null, "the exhausted step has its one more attempt");
  } finally { await stopAll(t); await t.cleanup(); }
});

// ---------------------------------------------------------------- #12: no "difference" for a held plan or a mission that is not waiting
test("G1-12 (#12) a held plan or a delivered mission: deltaOf/view.delta are null and confirm_delta refuses NO_DELTA; a paused mission offers its delta", async () => {
  const t = await windowsHub();
  try {
    const mission = await prepareMission(t);
    const env = (await dispatch(t.hub, "envelope.propose", { projectId: t.project.id, missionIds: [mission.id] })).result.envelope;
    t.queue("codex", "hang");
    await confirm(t, env);
    await activeRun(t);
    assert.equal(t.hub.envelopes.view(env.id).delta, null, "a running mission has no difference to confirm");
    await dispatch(t.hub, "factory.pause", { missionId: mission.id }, { channel: "owner", ownerSession: t.owner.session });
    await untilStage(t, mission.id, ["PAUSED"]);
    await noRuns(t);
    await waitFor(() => (t.hub.envelopes.get(env.id).status === "WAITING_OWNER" ? true : null), 10000, 50);
    assert.equal(t.hub.envelopes.view(env.id).delta?.kind, "cycle", "a waiting mission: the view exposes the difference");
    const asOwner = () => t.hub.commands.dispatch({ type: "envelope.confirm_delta", payload: { envelopeId: env.id, missionId: mission.id }, channel: "owner", actor: `owner:${t.owner.session.id}`, ownerSession: t.owner.session });
    // A hold written by advance() (dependency not delivered / next mission did not start).
    const derived = t.hub.envelopes.get(env.id).derived;
    t.hub.db.prepare("UPDATE mission_envelopes SET derived_json = ? WHERE id = ?").run(JSON.stringify({ ...derived, hold: "Nu pornesc sarcina următoare: depinde de t1" }), env.id);
    assert.equal(t.hub.envelopes.deltaOf(env.id, mission.id), null);
    assert.equal(t.hub.envelopes.view(env.id).delta, null);
    await assert.rejects(asOwner(), (e) => e.code === "NO_DELTA" && /depinde de t1/.test(e.message));
    assert.equal(t.hub.envelopes.get(env.id).derived.hold, "Nu pornesc sarcina următoare: depinde de t1", "the hold is kept");
    // A mission that is already delivered.
    t.hub.db.prepare("UPDATE mission_envelopes SET derived_json = ? WHERE id = ?").run(JSON.stringify(derived), env.id);
    t.hub.db.prepare("UPDATE factory_missions SET stage = 'DELIVERY_READY' WHERE mission_id = ?").run(mission.id);
    assert.equal(t.hub.envelopes.deltaOf(env.id, mission.id), null);
    await assert.rejects(asOwner(), (e) => e.code === "NO_DELTA");
    assert.equal(events(t, "envelope.delta_confirmed").length, 0);
    assert.equal(events(t, "factory.extra_cycle").length, 0, "no factory limit raised");
  } finally { await stopAll(t); await t.cleanup(); }
});

// ---------------------------------------------------------------- #15: the armed confirmation is scoped to the armed plan
test("G1-13 (#15) 'Da, execută planul' in the armed window confirms the armed plan although another project's plan is still PROPOSED", async () => {
  const t = await windowsHub();
  try {
    const owner = t.owner;
    await enrolVoice(t, owner);
    await dispatch(t.hub, "voice.gate", { enabled: true }, { ownerSession: owner.session });
    const mission = await prepareMission(t);
    // Another project with its own waiting plan (propose only supersedes plans of the SAME project).
    const dir2 = path.join(t.dataDir, "factory-bug-demo-2");
    materializeFixture("bug-demo", dir2);
    const other = (await dispatch(t.hub, "project.register_test", { path: dir2, name: "Demo doi" })).result;
    await dispatch(t.hub, "owner.autonomy.set", { projectId: other.id, level: "TRUSTED" }, { ownerSession: owner.reauth() });
    await dispatch(t.hub, "factory.prepare", { projectId: other.id, ...demoSpec("bug-demo"), limits: M09_MODELS });
    const b = (await dispatch(t.hub, "envelope.propose", { projectId: other.id })).result.envelope;
    const a = (await dispatch(t.hub, "envelope.propose", { projectId: t.project.id, missionIds: [mission.id] })).result.envelope;
    assert.equal(t.hub.envelopes.pending().length, 2);
    const lega = await startDerivedLega(t, owner);
    const armed = t.hub.envelopes.armForLega({ envelopeId: a.id, legaSessionId: lega, session: owner.session });
    assert.equal(armed.armed, true);
    t.queue("codex", "hang");
    const g = await speak(t, owner, "Da, execută planul", { purpose: "gate", legaSessionId: lega });
    assert.equal(g.result, "MATCH");
    assert.equal(g.boundPlanId, a.id);
    const done = await waitFor(() => (["ACTIVE", "WAITING_OWNER", "COMPLETED"].includes(t.hub.envelopes.get(a.id).status) ? t.hub.envelopes.get(a.id) : null), 15000, 50);
    assert.equal(done.consent.modality, "voice");
    assert.equal(t.hub.envelopes.get(b.id).status, "PROPOSED", "the other project's plan is untouched");
    assert.equal(events(t, "envelope.armed_refused").length, 0, "no 'Care plan?' refusal");
  } finally { await t.hub.lega.stopAll("test").catch(() => {}); await stopAll(t); await t.cleanup(); }
});
