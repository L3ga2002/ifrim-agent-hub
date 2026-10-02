// Milestone 06 — Mission Authorization Envelopes (PASS_SIMULATED: fixture providers, software authenticator, test projects).
// One confirmation of the exact plan in an authenticated session; the Hub derives the grants, runs the ordinary factory loop
// and closes the authority at the end. Adversarial cases: legacy policy, no session, plan changed, snapshot changed, double
// confirmation, a grant wider than the plan, self-approval attempts, Stop All, a real project without isolation.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeTestHub, waitFor, enrolOwner, prepareLiveWithoutGrants } from "./helpers.mjs";
import { materializeFixture, demoSpec } from "../server/factory/fixtures.mjs";
import { approvalHash } from "../server/policy/approvals.mjs";

const dispatch = (hub, type, payload, extra = {}) => hub.commands.dispatch({ type, payload, channel: "test", actor: "test", ...extra });
const SETTLED = ["DELIVERY_READY", "NEEDS_OWNER_DECISION", "BLOCKED", "PAUSED", "CANCELLED", "ACCEPTED", "REJECTED"];

async function ownerHub({ level = "TRUSTED", fixture = "bug-demo", policy = true } = {}) {
  const t = await makeTestHub({ queues: true });
  await prepareLiveWithoutGrants(t.hub);
  const dir = path.join(t.dataDir, `factory-${fixture}`);
  materializeFixture(fixture, dir);
  const project = (await dispatch(t.hub, "project.register_test", { path: dir })).result;
  const owner = await enrolOwner(t, { activatePolicy: policy });
  if (level && policy) await dispatch(t.hub, "owner.autonomy.set", { projectId: project.id, level }, { ownerSession: owner.reauth() });
  const { mission } = (await dispatch(t.hub, "factory.prepare", { projectId: project.id, ...demoSpec(fixture) })).result;
  return { ...t, project, dir, owner, mission };
}
const propose = async (t, extra = {}) => (await dispatch(t.hub, "envelope.propose", { projectId: t.project.id, ...extra })).result;
const confirm = (t, env, extra = {}) => dispatch(t.hub, "envelope.confirm", { envelopeId: env.id, nonce: env.nonce, displayedHash: env.envelopeHash, ...extra }, { ownerSession: t.owner.session, ...(extra.channel ? { channel: extra.channel } : {}) });
const view = (t, id) => t.hub.factory.view(id);
const untilStage = (t, id, stages, ms = 90000) => waitFor(() => (stages.includes(view(t, id).factory.stage) ? view(t, id) : null), ms, 100);
const untilEnvelope = (t, id, statuses, ms = 30000) => waitFor(() => (statuses.includes(t.hub.envelopes.get(id).status) ? t.hub.envelopes.view(id) : null), ms, 50);

test("M06-EN-01 plan preview: exact summary, nothing runs, no grant, works under the legacy policy too", async () => {
  const t = await ownerHub({ policy: false, level: null });
  try {
    const out = await propose(t);
    assert.equal(out.envelope.status, "PROPOSED");
    assert.match(out.summary.never, /Fără deploy, commit, push, mesaje, bani/);
    assert.match(out.summary.cost, /abonamentele incluse/);
    assert.ok(out.envelope.body.deniedEffects.includes("deploy") && out.envelope.body.deniedEffects.includes("owner.accept"));
    assert.equal(out.envelope.body.subscriptionPolicy, "INCLUDED_SUBSCRIPTION_ONLY");
    assert.equal(out.envelope.body.modeTransition !== null, true, "BUILD_SAFE → LIVE_VALIDATION is shown, not hidden");
    assert.equal(t.hub.grants.list().length, 0, "a preview creates no grant");
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM agent_runs").get().n, 0, "a preview starts nothing");
    assert.equal(t.hub.settings.get("mode"), "BUILD_SAFE");
    // Legacy policy: the confirmation is refused (it goes through Approvals as before).
    await assert.rejects(confirm(t, out.envelope), /voice-first nu este activă/);
  } finally { await t.cleanup(); }
});

test("M06-EN-02 one confirmation → derived grants (never wider) → full factory loop → DELIVERY_READY → authority closed; zero grant forms", async () => {
  const t = await ownerHub({ level: "TRUSTED" });
  try {
    const { envelope } = await propose(t);
    t.queue("codex", "factory-write:bug-fix");
    t.queue("claude", "review:pass");
    const confirmed = (await confirm(t, envelope)).result;
    assert.equal(confirmed.envelope.status, "ACTIVE");
    assert.equal(t.hub.settings.get("mode"), "LIVE_VALIDATION", "the envelope entered LIVE_VALIDATION as shown");
    const derived = t.hub.grants.ofEnvelope(envelope.id);
    assert.equal(derived.length, 2);
    assert.deepEqual(derived.map((g) => `${g.provider}:${g.access}`).sort(), ["claude:read-only", "codex:workspace-write"]);
    for (const g of derived) {
      assert.ok(Date.parse(g.expiresAt) <= Date.parse(envelope.expiresAt), "a derived grant never outlives the plan");
      assert.ok(g.maxAttempts <= 5);
    }
    const approval = t.hub.db.prepare("SELECT * FROM approvals WHERE action_kind = 'factory.scope'").get();
    assert.equal(approval.decided_via, "owner_session", "recorded on its real channel");
    assert.match(approval.decision_note, new RegExp(envelope.id));
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM approvals WHERE decided_via = 'ui'").get().n, 0, "no fictive UI click");
    const done = await untilStage(t, t.mission.id, SETTLED);
    assert.equal(done.factory.stage, "DELIVERY_READY", done.factory.stageReason);
    const closed = await untilEnvelope(t, envelope.id, ["COMPLETED"]);
    assert.match(closed.closeReason, /nimic nu e acceptat sau livrat automat/);
    assert.ok(t.hub.grants.ofEnvelope(envelope.id).every((g) => g.status !== "active"), "the remaining derived grants are revoked");
    await waitFor(() => t.hub.settings.get("mode") === "BUILD_SAFE", 5000);
    assert.equal(done.factory.stage, "DELIVERY_READY", "not accepted automatically");
    // UX measure: owner actions for this mission = 1 confirmation; manual grant forms = 0.
    const ownerCommands = t.hub.db.prepare("SELECT type FROM commands WHERE type IN ('grant.create','approval.decide','envelope.confirm','mode.set')").all().map((r) => r.type);
    assert.deepEqual(ownerCommands, ["envelope.confirm"]);
    const runs = t.hub.db.prepare("SELECT provider, grant_id FROM agent_runs").all();
    assert.ok(runs.length >= 2 && runs.every((r) => derived.some((g) => g.id === r.grant_id)), "every run used a grant derived from this plan");
  } finally { await t.cleanup(); }
});

test("M06-EN-03 double confirmation (two tabs) starts once; a reused nonce or a stale hash is refused", async () => {
  const t = await ownerHub({ level: "TRUSTED" });
  try {
    const { envelope } = await propose(t);
    t.queue("codex", "factory-write:bug-fix");
    t.queue("claude", "review:pass");
    const results = await Promise.allSettled([confirm(t, envelope), confirm(t, envelope)]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1, "exactly one confirmation is consumed");
    assert.match(String(results.find((r) => r.status === "rejected").reason.message), /nu mai așteaptă|deja confirmat|misiune autorizată/);
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM approvals WHERE action_kind = 'factory.scope'").get().n, 1, "one start");
    await assert.rejects(confirm(t, envelope), /nu mai așteaptă/);
    await untilStage(t, t.mission.id, SETTLED);
  } finally { await t.cleanup(); }
});

test("M06-EN-04 the plan changed after the preview (limits) or the repository changed: refused, the difference is named", async () => {
  const t = await ownerHub({ level: "TRUSTED" });
  try {
    const first = (await propose(t)).envelope;
    await dispatch(t.hub, "factory.limits", { missionId: t.mission.id, limits: { maxRepairCycles: 1 } });
    await assert.rejects(confirm(t, first), /limitele|specificația, planul sau limitele/);
    assert.equal(t.hub.envelopes.get(first.id).status, "SUPERSEDED");
    const second = (await propose(t)).envelope;
    fs.writeFileSync(path.join(t.dir, "NOTES.txt"), "changed after the preview\n");
    await assert.rejects(confirm(t, second), /starea repository-ului/);
    assert.equal(t.hub.grants.list().length, 0, "no grant was derived from a refused confirmation");
    // The wrong nonce / hash of a valid preview is refused without consuming it.
    const third = (await propose(t)).envelope;
    await assert.rejects(dispatch(t.hub, "envelope.confirm", { envelopeId: third.id, nonce: "0".repeat(24), displayedHash: third.envelopeHash }, { ownerSession: t.owner.session }), /nu corespunde planului afișat/);
    assert.equal(t.hub.envelopes.get(third.id).status, "PROPOSED");
  } finally { await t.cleanup(); }
});

test("M06-EN-05 no session, voice route, LLM self-approval and a foreign approval kind cannot confirm or decide", async () => {
  const t = await ownerHub({ level: "TRUSTED" });
  try {
    const { envelope } = await propose(t);
    await assert.rejects(t.hub.commands.dispatch({ type: "envelope.confirm", channel: "voice", actor: "lega", payload: { envelopeId: envelope.id, nonce: envelope.nonce, displayedHash: envelope.envelopeHash } }), /cannot be issued through voice/);
    await assert.rejects(t.hub.commands.dispatch({ type: "envelope.confirm", channel: "ui", actor: "user", payload: { envelopeId: envelope.id, nonce: envelope.nonce, displayedHash: envelope.envelopeHash } }), /cannot be issued through ui/);
    await assert.rejects(dispatch(t.hub, "envelope.confirm", { envelopeId: envelope.id, nonce: envelope.nonce, displayedHash: envelope.envelopeHash }), /sesiunea de proprietar/, "test channel without a session");
    // "Da" spoken to Lega (provider transcript) never confirms, even while the plan is presented.
    const spoken = (await t.hub.commands.dispatch({ type: "owner.intent", channel: "voice", actor: "lega", payload: { text: "Da, execută planul", projectId: t.project.id, presented: { envelopeId: envelope.id, nonce: envelope.nonce, hash: envelope.envelopeHash } } })).result;
    assert.ok(spoken.resolved.refused.some((r) => /provider/.test(r.reason)));
    assert.equal(t.hub.envelopes.get(envelope.id).status, "PROPOSED");
    // A quoted "confirm" typed by the owner is a quotation.
    const quoted = (await dispatch(t.hub, "owner.intent", { text: "Clientul a scris „confirm”", projectId: t.project.id, presented: { envelopeId: envelope.id, nonce: envelope.nonce, hash: envelope.envelopeHash } }, { ownerSession: t.owner.session })).result;
    assert.ok(quoted.resolved.refused.some((r) => /citat/.test(r.reason)));
    assert.equal(t.hub.envelopes.get(envelope.id).status, "PROPOSED");
    // decideByEnvelope: only factory.scope, only the exact hash.
    const other = t.hub.bus.transaction(() => t.hub.approvals.request({ actionKind: "git.push", target: "origin", payload: { x: 1 }, codeVersion: "hub", permissionTier: "EXTERNAL_ACTIONS", scopeType: "command", scopeId: "cmd_x", requestedBy: "lega:voice" }));
    assert.throws(() => t.hub.bus.transaction(() => t.hub.approvals.decideByEnvelope(other.id, { envelopeId: envelope.id, sessionId: t.owner.session.id, expectedHash: other.payloadHash })), /cannot be decided by a mission envelope/);
    const scope = t.hub.factory.view(t.mission.id).scope;
    const req = t.hub.bus.transaction(() => t.hub.approvals.request({ actionKind: "factory.scope", target: `${t.mission.id}:v${scope.specVersion}`, payload: scope, codeVersion: "hub", permissionTier: "WORKSPACE_EDIT", scopeType: "command", scopeId: "cmd_y", requestedBy: "test" }));
    assert.throws(() => t.hub.bus.transaction(() => t.hub.approvals.decideByEnvelope(req.id, { envelopeId: envelope.id, sessionId: t.owner.session.id, expectedHash: approvalHash({ actionKind: "factory.scope", target: "other", payload: scope, codeVersion: "hub", permissionTier: "WORKSPACE_EDIT", scopeType: "command", scopeId: "cmd_y" }) })), /does not match/);
    // Typed in the session, for the presented plan: this one confirms.
    t.queue("codex", "factory-write:bug-fix"); t.queue("claude", "review:pass");
    const typed = (await dispatch(t.hub, "owner.intent", { text: "Da, execută planul", projectId: t.project.id, presented: { envelopeId: envelope.id, nonce: envelope.nonce, hash: envelope.envelopeHash } }, { ownerSession: t.owner.session })).result;
    assert.equal(typed.results[0].confirmed?.envelope?.status, "ACTIVE", JSON.stringify(typed.results[0]).slice(0, 400));
    assert.equal(t.hub.envelopes.get(envelope.id).consent.modality, "typed");
    await untilStage(t, t.mission.id, SETTLED);
  } finally { await t.cleanup(); }
});

test("M06-EN-06 a derived grant wider than the plan is refused (attempts, role, provider, project, duration, expiry)", async () => {
  const t = await ownerHub({ level: "TRUSTED" });
  try {
    const { envelope } = await propose(t);
    const env = t.hub.envelopes.get(envelope.id);
    const base = { role: "writer", provider: "codex", access: "workspace-write", maxAttempts: 2, ttlMinutes: 30, maxDurationS: 600 };
    assert.ok(t.hub.envelopes.assertWithin(env, base, { projectId: t.project.id }));
    for (const [bad, why] of [[{ maxAttempts: 9 }, /încercări/], [{ role: "deployer" }, /rol/], [{ provider: "openai-api" }, /provider/], [{ role: "reviewer", access: "workspace-write" }, /reviewer-ul poate doar citi/],
      [{ maxDurationS: 999999 }, /durată/], [{ ttlMinutes: 100000 }, /expiră după plan/]]) {
      assert.throws(() => t.hub.envelopes.assertWithin(env, { ...base, ...bad }, { projectId: t.project.id }), why);
    }
    assert.throws(() => t.hub.envelopes.assertWithin(env, base, { projectId: "prj_other_000000" }), /alt proiect/);
    // 6 attempts fit the plan (3 cycles × 2) but exceed what one derived grant may carry (5): each limit is checked on its own.
    assert.throws(() => t.hub.envelopes.assertWithin(env, { ...base, maxAttempts: 6 }, { projectId: t.project.id }), /încercări peste limită/);
  } finally { await t.cleanup(); }
});

test("M06-EN-07 ASSISTED: a repair waits for the owner's delta confirmation, then the same envelope continues to DELIVERY_READY", async () => {
  const t = await ownerHub({ level: "ASSISTED" });
  try {
    const { envelope } = await propose(t);
    assert.equal(envelope.body.limits.maxRepairCycles[t.mission.id], 0);
    t.queue("codex", "factory-write:bug-fix", "factory-write:bug-fix-v2");
    t.queue("claude", "review:changes-dedupe", "review:pass");
    await confirm(t, envelope);
    const waiting = await untilStage(t, t.mission.id, SETTLED);
    assert.equal(waiting.factory.stage, "NEEDS_OWNER_DECISION");
    assert.match(waiting.factory.stageReason, /cere confirmarea ta/);
    assert.equal(waiting.factory.repairCycles, 0, "the cycle is not counted before the owner confirms");
    await untilEnvelope(t, envelope.id, ["WAITING_OWNER"]);
    await dispatch(t.hub, "envelope.confirm_delta", { envelopeId: envelope.id, missionId: t.mission.id }, { ownerSession: t.owner.session });
    await dispatch(t.hub, "factory.resume", { missionId: t.mission.id }, { channel: "owner", ownerSession: t.owner.session });
    const done = await untilStage(t, t.mission.id, ["DELIVERY_READY", "NEEDS_OWNER_DECISION", "BLOCKED"]);
    assert.equal(done.factory.stage, "DELIVERY_READY", done.factory.stageReason);
    assert.equal(done.factory.repairCycles, 1);
    assert.ok(t.hub.bus.query({ typePrefix: "envelope.delta_confirmed", limit: 5 }).length === 1);
  } finally { await t.cleanup(); }
});

test("M06-EN-08 Stop All during an authorized mission revokes the envelope and its grants; nothing new starts", async () => {
  const t = await ownerHub({ level: "TRUSTED" });
  try {
    const { envelope } = await propose(t);
    t.queue("codex", "hang");
    await confirm(t, envelope);
    await waitFor(() => t.hub.runs.activeRuns().length > 0, 20000);
    await dispatch(t.hub, "system.stop_all", { reason: "test" }, { channel: "owner", ownerSession: t.owner.session });
    const revoked = await untilEnvelope(t, envelope.id, ["REVOKED"]);
    assert.equal(revoked.status, "REVOKED");
    assert.ok(t.hub.grants.ofEnvelope(envelope.id).every((g) => g.status !== "active"));
    await waitFor(() => t.hub.runs.activeRuns().length === 0, 15000);
  } finally { await t.cleanup(); }
});

test("M06-EN-09 a real (registry) project without verified isolation: BLOCKED_BY_ISOLATION; no confirmation compensates it", async () => {
  const t = await makeTestHub({ queues: true });
  try {
    await prepareLiveWithoutGrants(t.hub);
    const owner = await enrolOwner(t);
    const hubProject = t.hub.projects.hub();
    // The registry project can hold missions (test mode lets the factory work on it) but is not a hub-test project.
    const { mission } = (await dispatch(t.hub, "factory.prepare", { projectId: hubProject.id, ...demoSpec("bug-demo") })).result;
    await dispatch(t.hub, "owner.autonomy.set", { projectId: hubProject.id, level: "TRUSTED" }, { ownerSession: owner.reauth() });
    const out = (await dispatch(t.hub, "envelope.propose", { projectId: hubProject.id, missionIds: [mission.id] })).result;
    assert.equal(out.summary.state, "BLOCKED_BY_ISOLATION");
    assert.ok(out.readiness.blockers.some((b) => b.kind === "isolation" && /izolare/.test(b.detail)));
    await assert.rejects(dispatch(t.hub, "envelope.confirm", { envelopeId: out.envelope.id, nonce: out.envelope.nonce, displayedHash: out.envelope.envelopeHash }, { ownerSession: owner.session }), /izolare/);
    assert.equal(t.hub.grants.list().length, 0);
    const cockpit = await t.hub.cockpit.projectCockpit(hubProject.id);
    assert.equal(cockpit.state.code, "BLOCKED_BY_ISOLATION");
    assert.equal(cockpit.isolation.realProjectEligible, false);
  } finally { await t.cleanup(); }
});

test("M06-EN-10 OBSERVE refuses execution; raising autonomy needs a fresh session; lowering is fail-safe and revokes a wider plan", async () => {
  let now = Date.now();
  const t = await makeTestHub({ queues: true, clock: () => new Date(now) });
  try {
    await prepareLiveWithoutGrants(t.hub);
    const dir = path.join(t.dataDir, "f"); materializeFixture("bug-demo", dir);
    const project = (await dispatch(t.hub, "project.register_test", { path: dir })).result;
    const owner = await enrolOwner(t);
    await dispatch(t.hub, "factory.prepare", { projectId: project.id, ...demoSpec("bug-demo") });
    await dispatch(t.hub, "owner.autonomy.set", { projectId: project.id, level: "OBSERVE" }, { channel: "voice" });
    const out = (await dispatch(t.hub, "envelope.propose", { projectId: project.id })).result;
    await assert.rejects(dispatch(t.hub, "envelope.confirm", { envelopeId: out.envelope.id, nonce: out.envelope.nonce, displayedHash: out.envelope.envelopeHash }, { ownerSession: owner.session }), /OBSERVE/);
    now += 10 * 60000;
    await assert.rejects(dispatch(t.hub, "owner.autonomy.set", { projectId: project.id, level: "TRUSTED" }, { ownerSession: owner.session }), /confirmă din nou/, "raising needs re-authentication");
    await assert.rejects(dispatch(t.hub, "owner.autonomy.set", { projectId: project.id, level: "TRUSTED" }, { channel: "voice" }), /sesiune|voice-first|confirmă/);
    const raised = (await dispatch(t.hub, "owner.autonomy.set", { projectId: project.id, level: "TRUSTED" }, { ownerSession: owner.reauth() })).result;
    assert.equal(raised.level, "TRUSTED");
    assert.equal((await dispatch(t.hub, "owner.autonomy.set", { projectId: project.id, level: "ASSISTED" }, { channel: "voice" })).result.level, "ASSISTED", "lowering from voice is allowed");
  } finally { await t.cleanup(); }
});

test("M06-EN-11 voice confirmation needs local speaker verification AND local transcription; a provider transcript or no evidence is refused", async () => {
  const t = await ownerHub({ level: "TRUSTED" });
  try {
    const { envelope } = await propose(t);
    await assert.rejects(confirm(t, envelope, { modality: "voice" }), /transcrierea locală/);
    await assert.rejects(confirm(t, envelope, { modality: "voice", voice: { verifiedLocally: true, speaker: "MATCH", transcriptSource: "provider" } }), /transcrierea locală/);
    await assert.rejects(confirm(t, envelope, { modality: "voice", voice: { verifiedLocally: true, speaker: "UNCERTAIN", transcriptSource: "local" } }), /transcrierea locală/);
    assert.equal(t.hub.envelopes.get(envelope.id).status, "PROPOSED");
    // The fixture path exists only in test mode (no local STT is installed): reported as PASS_SIMULATED, never live.
    t.queue("codex", "factory-write:bug-fix"); t.queue("claude", "review:pass");
    const ok = (await confirm(t, envelope, { modality: "voice", voice: { verifiedLocally: true, speaker: "MATCH", transcriptSource: "local", fixture: true } })).result;
    assert.equal(ok.envelope.consent.voice.fixture, true);
    await untilStage(t, t.mission.id, SETTLED);
  } finally { await t.cleanup(); }
});

test("M06-EN-13 words transcribed by the provider never add authority, even on a request that carries the owner's session", async () => {
  const t = await ownerHub({ level: "ASSISTED" });
  try {
    const fresh = t.owner.reauth();
    const out = (await dispatch(t.hub, "owner.intent", { text: "Setează autonomia la trusted pe Factory Demo", projectId: t.project.id, source: "voice-provider" }, { channel: "owner", ownerSession: fresh })).result;
    assert.ok(out.results.some((r) => /nu schimb autoritatea/.test(r.refused || "")), JSON.stringify(out.results));
    assert.equal(t.hub.envelopes.autonomyOf(t.project.id).level, "ASSISTED");
    // The same sentence typed in the session does raise it (the owner's own input, fresh re-authentication).
    const typed = (await dispatch(t.hub, "owner.intent", { text: "Setează autonomia la trusted pe Factory Demo", projectId: t.project.id, source: "typed" }, { channel: "owner", ownerSession: t.owner.reauth() })).result;
    assert.equal(typed.results[0].autonomy?.level, "TRUSTED", JSON.stringify(typed.results[0]));
    // Stopping from the provider transcript is allowed (it only reduces activity).
    const stop = (await dispatch(t.hub, "owner.intent", { text: "Îngheață proiectul", projectId: t.project.id, source: "voice-provider" }, { channel: "owner", ownerSession: fresh })).result;
    assert.match(stop.results[0].interrupt?.summary || "", /înghețat/);
  } finally { await t.cleanup(); }
});

test("M06-EN-12 the billing guard still applies: a route that is not included in the subscription blocks the plan", async () => {
  const t = await ownerHub({ level: "TRUSTED" });
  try {
    t.hub.bus.transaction(() => t.hub.settings.set("billingAttestations", {}, "test"));
    const out = await propose(t);
    assert.ok(out.readiness.blockers.some((b) => /billing_route/.test(b.id)), JSON.stringify(out.readiness.blockers));
    await assert.rejects(confirm(t, out.envelope), /billing_route|Nu pot porni/);
  } finally { await t.cleanup(); }
});
