// Milestone 10.2 — U02: bound-only plan grants and envelope-scoped live authority (PASS_SIMULATED: fixture providers, software
// authenticator, test projects; no model). A confirmed plan admits its own bound steps while the Hub stays in BUILD_SAFE; the
// Hub's mode is never written; manual runs stay refused; a manual LIVE_VALIDATION grant never serves a plan step and a plan
// grant never serves a manual run; a revoked / expired / closed plan admits nothing; legacy holds are still released.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { makeTestHub, waitFor, enrolOwner, prepareLiveWithoutGrants } from "./helpers.mjs";
import { createHttpServer } from "../server/http/server.mjs";
import { materializeFixture, demoSpec } from "../server/factory/fixtures.mjs";
import { SCOPED_LIVE_TRANSITION, ENVELOPE_RESOLVES } from "../server/owner/envelopes.mjs";

const M09_MODELS = { writerModel: "gpt-fake-sol", reviewerModel: "sonnet" };
const dispatch = (hub, type, payload, extra = {}) => hub.commands.dispatch({ type, payload, channel: "test", actor: "test", ...extra });
const SETTLED = ["DELIVERY_READY", "NEEDS_OWNER_DECISION", "BLOCKED", "PAUSED", "CANCELLED", "ACCEPTED", "REJECTED"];

async function ownerHub({ level = "TRUSTED", scopedLive = true } = {}) {
  const t = await makeTestHub({ queues: true });
  await prepareLiveWithoutGrants(t.hub);
  if (!scopedLive) t.hub.bus.transaction(() => t.hub.settings.set("envelopeScopedLive", false, "test", "legacy mode-hold path"));
  const dir = path.join(t.dataDir, "factory-bug-demo");
  materializeFixture("bug-demo", dir);
  const project = (await dispatch(t.hub, "project.register_test", { path: dir })).result;
  const owner = await enrolOwner(t);
  await dispatch(t.hub, "owner.autonomy.set", { projectId: project.id, level }, { ownerSession: owner.reauth() });
  const { mission } = (await dispatch(t.hub, "factory.prepare", { projectId: project.id, ...demoSpec("bug-demo"), limits: M09_MODELS })).result;
  return { ...t, project, dir, owner, mission };
}
const propose = async (t) => (await dispatch(t.hub, "envelope.propose", { projectId: t.project.id })).result;
const confirm = (t, env) => dispatch(t.hub, "envelope.confirm", { envelopeId: env.id, nonce: env.nonce, displayedHash: env.envelopeHash }, { ownerSession: t.owner.session });
const view = (t, id) => t.hub.factory.view(id);
const untilStage = (t, id, stages, ms = 90000) => waitFor(() => (stages.includes(view(t, id).factory.stage) ? view(t, id) : null), ms, 100);
const untilEnvelope = (t, id, statuses, ms = 30000) => waitFor(() => (statuses.includes(t.hub.envelopes.get(id).status) ? t.hub.envelopes.view(id) : null), ms, 50);
const modeEvents = (t) => t.hub.db.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'settings.changed' AND json_extract(payload_json, '$.key') = 'mode'").get().n;
const commandCount = (t, type) => t.hub.db.prepare("SELECT COUNT(*) AS n FROM commands WHERE type = ?").get(type).n;
/** The plan object runs.boundPlan gives the gate for a role of the mission (what a factory step carries). */
const planOf = (envelope, missionId, role) => {
  const b = envelope.body.missions.find((m) => m.missionId === missionId).bindings[role];
  return { model: b.resolvedAlias, effort: b.effort, effortSource: b.effortSource, bindingHash: b.bindingHash, missionId, problem: null };
};
const gateFor = (t, envelope, role, extra = {}) => t.hub.gate.evaluate({ provider: role === "writer" ? "codex" : "claude", projectId: t.project.id, access: role === "writer" ? "workspace-write" : "read-only",
  plan: planOf(envelope, t.mission.id, role), ...extra });
const check = (decision, id) => decision.checks.find((c) => c.id === id);

function getJson(t, p) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: t.config.port, path: p, method: "GET", headers: { Host: `localhost:${t.config.port}` } }, (res) => {
      let text = ""; res.setEncoding("utf8"); res.on("data", (c) => { text += c; }); res.on("end", () => { try { resolve({ status: res.statusCode, json: JSON.parse(text) }); } catch (e) { reject(e); } });
    });
    req.on("error", reject); req.end();
  });
}

async function hangingPlan(t) {
  const { envelope } = await propose(t);
  t.queue("codex", "hang");
  await confirm(t, envelope);
  await waitFor(() => t.hub.runs.activeRuns().length > 0, 20000);
  return envelope;
}
async function stopAll(t) {
  await dispatch(t.hub, "system.stop_all", { reason: "test" }, { channel: "owner", ownerSession: t.owner.session });
  await waitFor(() => t.hub.runs.activeRuns().length === 0, 15000);
}

test("M10.2-EA-01 a plan confirmed in BUILD_SAFE runs writer and reviewer with its derived grants; the Hub's mode is never written", async () => {
  const t = await ownerHub();
  try {
    assert.equal(t.hub.settings.get("envelopeScopedLive"), true, "envelope-scoped authority is on by default");
    assert.ok(ENVELOPE_RESOLVES.has("mode") && ENVELOPE_RESOLVES.has("live_grant"), "exported for the blocker explainer");
    const { envelope, summary } = await propose(t);
    assert.equal(envelope.body.modeTransition, SCOPED_LIVE_TRANSITION, "shown and hashed");
    assert.match(summary.mode, /Hub-ul rămâne în BUILD_SAFE/);
    const modeBefore = modeEvents(t);
    t.queue("codex", "factory-write:bug-fix");
    t.queue("claude", "review:pass");
    const confirmed = (await confirm(t, envelope)).result;
    assert.equal(confirmed.envelope.status, "ACTIVE");
    assert.equal(t.hub.settings.get("mode"), "BUILD_SAFE");
    assert.deepEqual(t.hub.settings.get("envelopeModeHold"), {});
    const done = await untilStage(t, t.mission.id, SETTLED);
    assert.equal(done.factory.stage, "DELIVERY_READY", done.factory.stageReason);
    const derived = t.hub.grants.ofEnvelope(envelope.id);
    const runs = t.hub.db.prepare("SELECT provider, grant_id, status FROM agent_runs ORDER BY created_at").all();
    assert.ok(runs.some((r) => r.provider === "codex") && runs.some((r) => r.provider === "claude"), JSON.stringify(runs));
    assert.ok(runs.every((r) => derived.some((g) => g.id === r.grant_id)), "every step used a grant derived from this plan");
    assert.ok(derived.every((g) => g.attemptsUsed >= 1), "each step consumed its plan grant's attempt");
    await untilEnvelope(t, envelope.id, ["COMPLETED"]);
    assert.equal(t.hub.settings.get("mode"), "BUILD_SAFE");
    assert.equal(modeEvents(t), modeBefore, "zero settings.changed key=mode events");
    assert.equal(commandCount(t, "mode.set"), 0, "zero mode.set commands");
    assert.equal(commandCount(t, "grant.create"), 0, "zero grant forms");
  } finally { await t.cleanup(); }
});

test("M10.2-EA-02 while a plan runs in BUILD_SAFE: /api/state shows it; a manual run, Lega's run preview and a shadow review stay refused", async () => {
  const t = await ownerHub();
  const { server } = createHttpServer(t.hub);
  await new Promise((res) => server.listen(t.config.port, "127.0.0.1", res));
  try {
    const envelope = await hangingPlan(t);
    const state = (await getJson(t, "/api/state")).json;
    assert.equal(state.mode, "BUILD_SAFE");
    assert.equal(state.liveScopes.length, 1, JSON.stringify(state.liveScopes));
    assert.deepEqual([state.liveScopes[0].envelopeId, state.liveScopes[0].missionId, state.liveScopes[0].projectId], [envelope.id, t.mission.id, t.project.id]);
    assert.ok(Date.parse(state.liveScopes[0].expiresAt) > Date.now());
    // The plan's own writer step is admitted by the plan, with its derived grant.
    const own = gateFor(t, envelope, "writer");
    assert.equal(check(own, "mode").ok, true);
    assert.match(check(own, "mode").detail, new RegExp(`BUILD_SAFE; pas admis de planul ${envelope.id}`));
    assert.equal(check(own, "mode").authority, `envelope:${envelope.id}`);
    assert.ok(t.hub.grants.ofEnvelope(envelope.id).some((g) => g.id === check(own, "live_grant").grantId));
    // A manual run on the same project: refused on mode, before any process (recorded as a blocked gate run).
    const conv = (await dispatch(t.hub, "conversation.create", { projectId: t.project.id, title: "manual" })).result;
    await dispatch(t.hub, "conversation.message", { conversationId: conv.id, content: "fă ceva" });
    await assert.rejects(dispatch(t.hub, "run.start", { conversationId: conv.id, provider: "codex", access: "workspace-write", model: "gpt-fake-sol" }), /Execution gate refused the run/);
    const refused = t.hub.db.prepare("SELECT error_message, grant_id FROM agent_runs WHERE conversation_id = ? AND status = 'blocked' AND error_category = 'gate'").get(conv.id);
    assert.match(refused.error_message, /mode: BUILD_SAFE: fără inferență/);
    assert.equal(refused.grant_id, null, "no grant touched");
    // What lega.propose_run asks before preparing a card (gate.evaluate without a plan): mode refused too.
    const lega = t.hub.gate.evaluate({ provider: "claude", projectId: t.project.id, access: "read-only" });
    assert.equal(check(lega, "mode").ok, false);
    // A shadow review (unbound, read-only) finds no grant it may use: the plan's reviewer grant is bound to the plan.
    const unbound = t.hub.grants.findUsable("claude", t.project.id, "read-only");
    assert.match(String(t.hub.grants.problem(unbound, { provider: "claude", projectId: t.project.id, access: "read-only", now: new Date() })), /legat de modelul confirmat|fără modelul aprobat/);
    assert.equal(t.hub.settings.get("mode"), "BUILD_SAFE");
    await stopAll(t);
    const after = (await getJson(t, "/api/state")).json;
    await waitFor(() => (t.hub.envelopes.liveScopes().length === 0 ? true : null), 5000);
    assert.ok(Array.isArray(after.liveScopes));
  } finally { server.close(); await t.cleanup(); }
});

test("M10.2-EA-03 LIVE_VALIDATION with an unbound manual grant: the plan's steps use only their bound grants (manual 0/3); without one they are refused, never served by the manual grant", async () => {
  const t = await ownerHub();
  try {
    await dispatch(t.hub, "mode.set", { mode: "LIVE_VALIDATION", confirm: "LIVE_VALIDATION" });
    // Like grant_muu67o8g: codex, workspace-write, 3 attempts, created by hand on the same project.
    const manual = await dispatch(t.hub, "grant.create", { provider: "codex", projectId: t.project.id, access: "workspace-write", maxAttempts: 3, ttlMinutes: 120, note: "manual" });
    const manualId = manual.result.id;
    const { envelope } = await propose(t);
    assert.equal(envelope.body.modeTransition, null, "no transition: the Hub is already LIVE_VALIDATION");
    t.queue("codex", "factory-write:bug-fix");
    t.queue("claude", "review:pass");
    await confirm(t, envelope);
    const done = await untilStage(t, t.mission.id, SETTLED);
    assert.equal(done.factory.stage, "DELIVERY_READY", done.factory.stageReason);
    const derived = t.hub.grants.ofEnvelope(envelope.id);
    const runs = t.hub.db.prepare("SELECT provider, grant_id FROM agent_runs").all();
    assert.ok(runs.length >= 2 && runs.every((r) => derived.some((g) => g.id === r.grant_id)), JSON.stringify(runs));
    assert.equal(t.hub.grants.get(manualId).attemptsUsed, 0, "the manual grant's attempts stay 0/3");
    await untilEnvelope(t, envelope.id, ["COMPLETED"]);
    // The plan is closed (its grants revoked): its next writer step finds no bound grant and is refused — the active manual grant
    // on the same project and provider is never chosen, and never accepted when named explicitly.
    const writerPlan = planOf(envelope, t.mission.id, "writer");
    const found = t.hub.grants.findUsable("codex", t.project.id, "workspace-write", "run", { bindingHash: writerPlan.bindingHash, missionId: t.mission.id });
    assert.ok(!found || found.envelopeId === envelope.id, "only the plan's own grant is a candidate");
    const decision = gateFor(t, envelope, "writer");
    assert.equal(check(decision, "live_grant").ok, false);
    assert.notEqual(check(decision, "live_grant").grantId, manualId);
    const named = gateFor(t, envelope, "writer", { grantId: manualId });
    assert.equal(check(named, "live_grant").ok, false);
    assert.match(check(named, "live_grant").detail, /Execuția planului folosește doar grantul derivat din plan/);
    assert.equal(t.hub.grants.get(manualId).attemptsUsed, 0);
    // A manual (unbound) run still uses the manual grant: the manual path is untouched.
    const manualRun = t.hub.gate.evaluate({ provider: "codex", projectId: t.project.id, access: "workspace-write" });
    assert.equal(check(manualRun, "live_grant").grantId, manualId);
    assert.equal(check(manualRun, "live_grant").ok, true);
  } finally { await t.cleanup(); }
});

test("M10.2-EA-04 a plan grant still cannot serve an unbound run, nor a bound run of another mission", async () => {
  const t = await ownerHub();
  try {
    const envelope = await hangingPlan(t);
    const writer = t.hub.grants.ofEnvelope(envelope.id).find((g) => g.provider === "codex");
    const base = { provider: "codex", projectId: t.project.id, access: "workspace-write", now: new Date() };
    assert.match(String(t.hub.grants.problem(writer, base)), /fără modelul aprobat/);
    assert.match(String(t.hub.grants.problem(writer, { ...base, bindingHash: writer.binding.bindingHash, missionId: "mis_other_0000" })), /derivat pentru misiunea/);
    assert.equal(t.hub.grants.problem(writer, { ...base, bindingHash: writer.binding.bindingHash, missionId: t.mission.id }), null);
    await stopAll(t);
  } finally { await t.cleanup(); }
});

test("M10.2-EA-05 a plan revoked, expired or closed between steps: the next model step fails the mode check before inference; no attempt is consumed", async () => {
  const t = await ownerHub();
  try {
    const envelope = await hangingPlan(t);
    assert.equal(check(gateFor(t, envelope, "reviewer"), "mode").ok, true, "in force: admitted");
    // Expired (before the housekeeping tick closes it): refused even though the derived grant itself has not expired yet.
    const expiresAt = t.hub.envelopes.get(envelope.id).expiresAt;
    t.hub.db.prepare("UPDATE mission_envelopes SET expires_at = ? WHERE id = ?").run(new Date(Date.now() - 1000).toISOString(), envelope.id);
    const expired = gateFor(t, envelope, "reviewer");
    assert.equal(check(expired, "mode").ok, false);
    assert.match(check(expired, "mode").detail, /timpul autorizat al planului s-a terminat/);
    t.hub.db.prepare("UPDATE mission_envelopes SET expires_at = ? WHERE id = ?").run(expiresAt, envelope.id);
    // Closed by any path that left a derived grant active (defence in depth): a closed plan admits nothing.
    t.hub.db.prepare("UPDATE mission_envelopes SET status = 'COMPLETED' WHERE id = ?").run(envelope.id);
    const closed = gateFor(t, envelope, "reviewer");
    assert.equal(check(closed, "mode").ok, false);
    assert.match(check(closed, "mode").detail, /planul este COMPLETED/);
    t.hub.db.prepare("UPDATE mission_envelopes SET status = 'ACTIVE' WHERE id = ?").run(envelope.id);
    // Back to the legacy policy (fail-safe): no plan admits a step in BUILD_SAFE.
    const policy = t.hub.settings.get("ownerPolicy");
    await dispatch(t.hub, "owner.policy.deactivate", { reason: "test" });
    assert.match(check(gateFor(t, envelope, "reviewer"), "mode").detail, /politica voice-first/);
    t.hub.bus.transaction(() => t.hub.settings.set("ownerPolicy", policy, "test", "restore"));
    // The real path: pause the mission, revoke the plan, the owner resumes — the factory's next step is refused at the gate.
    await dispatch(t.hub, "factory.pause", { missionId: t.mission.id });
    await untilStage(t, t.mission.id, ["PAUSED"]);
    await waitFor(() => t.hub.runs.activeRuns().length === 0, 15000);
    await dispatch(t.hub, "envelope.revoke", { envelopeId: envelope.id });
    await untilEnvelope(t, envelope.id, ["REVOKED"]);
    const used = Object.fromEntries(t.hub.grants.ofEnvelope(envelope.id).map((g) => [g.id, g.attemptsUsed]));
    const runsBefore = t.hub.db.prepare("SELECT COUNT(*) AS n FROM agent_runs").get().n;
    t.queue("codex", "factory-write:bug-fix");
    await dispatch(t.hub, "factory.resume", { missionId: t.mission.id }).catch(() => null);
    const blocked = await waitFor(() => t.hub.db.prepare("SELECT * FROM agent_runs WHERE status = 'blocked' AND error_category = 'gate' ORDER BY created_at DESC LIMIT 1").get() || null, 30000);
    assert.match(blocked.error_message, /mode: BUILD_SAFE: planul .* nu admite acest pas \(planul este REVOKED\)/, blocked.error_message);
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM agent_runs").get().n, runsBefore + 1, "only the refused (blocked) record, no process");
    assert.deepEqual(Object.fromEntries(t.hub.grants.ofEnvelope(envelope.id).map((g) => [g.id, g.attemptsUsed])), used, "no attempt consumed");
    assert.equal(t.hub.settings.get("mode"), "BUILD_SAFE");
    await stopAll(t);
  } finally { await t.cleanup(); }
});

test("M10.2-EA-06 legacy: a hold written by M07–M10 is still released to BUILD_SAFE when its last holder closes; a suspended one is never restored", async () => {
  const t = await ownerHub();
  try {
    const envelope = await hangingPlan(t);
    assert.equal(t.hub.settings.get("mode"), "BUILD_SAFE");
    // The state an M07–M10 confirmation left behind (written before the upgrade).
    t.hub.bus.transaction(() => {
      t.hub.settings.set("mode", "LIVE_VALIDATION", "envelopes", "legacy hold (test)");
      t.hub.settings.set("envelopeModeHold", { envelopeId: envelope.id, holders: [envelope.id], since: new Date().toISOString() }, "envelopes", "legacy hold (test)");
    });
    // A boot suspends it; an explicit resume no longer turns it back into a Hub-wide LIVE_VALIDATION (the plan admits its own steps).
    t.hub.bus.transaction(() => t.hub.settings.set("mode", "BUILD_SAFE", "recovery", "Every boot starts in BUILD_SAFE"));
    await waitFor(() => (t.hub.settings.get("envelopeModeHold").suspendedByBoot ? true : null), 5000, 10);
    assert.equal(t.hub.envelopes.restoreModeHold(t.mission.id, "owner"), null);
    assert.equal(t.hub.settings.get("mode"), "BUILD_SAFE");
    // Back to a live legacy hold: the plan's end releases it.
    t.hub.bus.transaction(() => {
      t.hub.settings.set("mode", "LIVE_VALIDATION", "envelopes", "legacy hold (test)");
      t.hub.settings.set("envelopeModeHold", { envelopeId: envelope.id, holders: [envelope.id], since: new Date().toISOString() }, "envelopes", "legacy hold (test)");
    });
    await dispatch(t.hub, "envelope.revoke", { envelopeId: envelope.id });
    await untilEnvelope(t, envelope.id, ["REVOKED"]);
    await waitFor(() => (t.hub.settings.get("mode") === "BUILD_SAFE" ? true : null), 5000, 10);
    assert.deepEqual(t.hub.settings.get("envelopeModeHold"), {});
    await stopAll(t);
  } finally { await t.cleanup(); }
});

test("M10.2-EA-07 a PROPOSED plan built under the legacy wording is superseded at confirmation ('modul Hub-ului'); the rollback flag keeps the M06–M10 hold", async () => {
  const t = await ownerHub({ scopedLive: false });
  try {
    const { envelope } = await propose(t);
    assert.match(envelope.body.modeTransition, /LIVE_VALIDATION/);
    t.hub.bus.transaction(() => t.hub.settings.set("envelopeScopedLive", true, "test", "upgrade"));
    await assert.rejects(confirm(t, envelope), /modul Hub-ului/);
    assert.equal(t.hub.envelopes.get(envelope.id).status, "SUPERSEDED");
    assert.equal(t.hub.grants.list().length, 0);
    // Flag off again (rollback): a confirmation enters LIVE_VALIDATION and holds it, exactly as before.
    t.hub.bus.transaction(() => t.hub.settings.set("envelopeScopedLive", false, "test", "rollback"));
    const legacy = (await propose(t)).envelope;
    t.queue("codex", "hang");
    await confirm(t, legacy);
    assert.equal(t.hub.settings.get("mode"), "LIVE_VALIDATION");
    assert.deepEqual(t.hub.settings.get("envelopeModeHold").holders, [legacy.id]);
    assert.equal(t.hub.envelopes.liveAuthority(t.mission.id, planOf(legacy, t.mission.id, "writer").bindingHash), null, "no scoped authority under the rollback flag");
    await stopAll(t);
  } finally { await t.cleanup(); }
});
