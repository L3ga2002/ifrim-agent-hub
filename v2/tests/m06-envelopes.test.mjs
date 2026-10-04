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
// M09: every factory mission names its models explicitly (without them it is a draft whose scope is incomplete).
const M09_MODELS = { writerModel: "gpt-fake-sol", reviewerModel: "sonnet" };
import { approvalHash } from "../server/policy/approvals.mjs";
import { enrolVoice, speak, OTHER_SPEAKER } from "./voice-helpers.mjs";

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
  const { mission } = (await dispatch(t.hub, "factory.prepare", { projectId: project.id, ...demoSpec(fixture), limits: M09_MODELS })).result;
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
    // M09: a derived grant names the binding (model, effort, hash) the plan confirmed for its role.
    const writerBinding = t.hub.envelopes.deriveGrants(env, t.mission.id).find((s) => s.role === "writer").binding;
    assert.equal(writerBinding.model, "gpt-fake-sol");
    const base = { role: "writer", provider: "codex", access: "workspace-write", maxAttempts: 2, ttlMinutes: 30, maxDurationS: 600, binding: writerBinding };
    assert.ok(t.hub.envelopes.assertWithin(env, base, { projectId: t.project.id }));
    for (const [bad, why] of [[{ binding: null }, /fără modelul confirmat/], [{ binding: { ...writerBinding, model: "gpt-5", bindingHash: "a".repeat(64) } }, /în afara planului/],
      [{ role: "reviewer", provider: "claude", access: "read-only" }, /model gpt-fake-sol în afara planului/]]) {
      assert.throws(() => t.hub.envelopes.assertWithin(env, { ...base, ...bad }, { projectId: t.project.id }), why);
    }
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
    const { mission } = (await dispatch(t.hub, "factory.prepare", { projectId: hubProject.id, ...demoSpec("bug-demo"), limits: M09_MODELS })).result;
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
    await dispatch(t.hub, "factory.prepare", { projectId: project.id, ...demoSpec("bug-demo"), limits: M09_MODELS });
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

test("M06-EN-11 voice confirmation needs the Hub's own local speaker check AND local transcript for THIS plan (M07: server-held utterance); a client's claim is refused", async () => {
  const t = await ownerHub({ level: "TRUSTED" });
  try {
    await enrolVoice(t, t.owner);
    const { envelope } = await propose(t);
    // No utterance, or a client-built "evidence" object (the M06 contract): refused before anything else.
    await assert.rejects(confirm(t, envelope, { modality: "voice" }), /segmentul vocal/);
    await assert.rejects(confirm(t, envelope, { modality: "voice", voice: { verifiedLocally: true, speaker: "MATCH", transcriptSource: "local" } }), /segmentul vocal|not allowed|necunoscut/i);
    // Another voice (not transcribed at all) and a "yes" recorded for another plan: refused.
    const other = await speak(t, t.owner, "Da, execută planul", { speaker: OTHER_SPEAKER, envelopeId: envelope.id });
    assert.equal(other.result, "NON_MATCH"); assert.equal(other.transcript, null);
    await assert.rejects(confirm(t, envelope, { modality: "voice", utteranceId: other.utteranceId }), /nu a fost recunoscută/);
    const elsewhere = await speak(t, t.owner, "Da, execută planul", { envelopeId: "env_other" });
    await assert.rejects(confirm(t, envelope, { modality: "voice", utteranceId: elsewhere.utteranceId }), /pentru planul acesta/);
    // The owner saying "yes, but don't start": not a confirmation.
    const notYet = await speak(t, t.owner, "Da, dar nu porni încă", { envelopeId: envelope.id });
    await assert.rejects(confirm(t, envelope, { modality: "voice", utteranceId: notYet.utteranceId }), /nu o confirmare clară/);
    assert.equal(t.hub.envelopes.get(envelope.id).status, "PROPOSED");
    // The real path: the owner's voice, the local transcript, this plan → ACTIVE; the evidence is the server's row.
    const yes = await speak(t, t.owner, "Da, execută planul", { envelopeId: envelope.id });
    assert.equal(yes.result, "MATCH"); assert.equal(yes.transcript, "Da, execută planul");
    t.queue("codex", "factory-write:bug-fix"); t.queue("claude", "review:pass");
    const ok = (await confirm(t, envelope, { modality: "voice", utteranceId: yes.utteranceId })).result;
    assert.equal(ok.envelope.consent.modality, "voice");
    assert.equal(ok.envelope.consent.voice.utteranceId, yes.utteranceId);
    assert.equal(ok.envelope.consent.voice.transcriptSource, "local");
    assert.equal(t.hub.db.prepare("SELECT consumed_by FROM voice_utterances WHERE id = ?").get(yes.utteranceId).consumed_by, envelope.id);
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
    // M09-A2: the route reads the billing evidence (the legacy attestations are no longer read).
    t.hub.bus.transaction(() => t.hub.settings.set("billingEvidence", {}, "test"));
    const out = await propose(t);
    assert.ok(out.readiness.blockers.some((b) => /billing_route/.test(b.id)), JSON.stringify(out.readiness.blockers));
    await assert.rejects(confirm(t, out.envelope), /billing_route|Nu pot porni/);
  } finally { await t.cleanup(); }
});

// ---------- M07: the plans' mode hold across a restart, several plans and the agent channel ----------
const agent = (t, type, payload) => t.hub.commands.dispatch({ type, payload, channel: "agent", actor: "agent", delegation: "proprietar în conversație, M07 §03" });
const hold = (t) => t.hub.settings.get("envelopeModeHold") || {};
const settle = () => new Promise((r) => setTimeout(r, 30));
/** What a boot does (recovery.mjs, in a transaction): BUILD_SAFE written by "recovery"; the plans' hold is then suspended, not dropped. */
async function simulateBoot(t) {
  // Exactly like recoverOnBoot: the write happens only when the mode is not already BUILD_SAFE.
  if (t.hub.settings.get("mode") !== "BUILD_SAFE") t.hub.bus.transaction(() => t.hub.settings.set("mode", "BUILD_SAFE", "recovery", "Every boot starts in BUILD_SAFE"));
  return waitFor(() => (hold(t).suspendedByBoot ? hold(t) : null), 5000, 10);
}
async function pausedMission(t, { by = "agent" } = {}) {
  const { envelope } = await propose(t);
  t.queue("codex", "hang");
  await confirm(t, envelope);
  await waitFor(() => t.hub.runs.activeRuns().length > 0, 20000);
  if (by === "agent") await agent(t, "factory.pause", { missionId: t.mission.id });
  else await dispatch(t.hub, "factory.pause", { missionId: t.mission.id });
  await untilStage(t, t.mission.id, ["PAUSED"]);
  await waitFor(() => t.hub.runs.activeRuns().length === 0, 15000);
  return envelope;
}

test("M07-EN-14 a restart only suspends the plan's LIVE_VALIDATION; an explicit resume restores exactly that, and the plan's end returns to BUILD_SAFE", async () => {
  // Found live (M07 D6): after a Hub restart the mission's resume ran with the mode back in BUILD_SAFE and no hold; the first fix
  // then wrote the restored mode as the agent, which the listener read as a manual change (the Hub stayed LIVE afterwards).
  const t = await ownerHub({ level: "TRUSTED" });
  try {
    const envelope = await pausedMission(t);
    const suspended = await simulateBoot(t);
    assert.equal(suspended.envelopeId, envelope.id);
    assert.ok(["ACTIVE", "WAITING_OWNER"].includes(t.hub.envelopes.get(envelope.id).status), "the plan itself is still in force");
    t.queue("codex", "factory-write:bug-fix");
    t.queue("claude", "review:pass");
    await agent(t, "factory.resume", { missionId: t.mission.id });
    assert.equal(t.hub.settings.get("mode"), "LIVE_VALIDATION", "the plan's LIVE_VALIDATION is back");
    await settle();
    assert.equal(hold(t).envelopeId, envelope.id, "and still held after the listener ran");
    assert.equal(hold(t).restored, true);
    const done = await untilStage(t, t.mission.id, SETTLED);
    assert.equal(done.factory.stage, "DELIVERY_READY", done.factory.stageReason);
    await untilEnvelope(t, envelope.id, ["COMPLETED"]);
    await waitFor(() => (t.hub.settings.get("mode") === "BUILD_SAFE" ? true : null), 10000);
    assert.deepEqual(hold(t), {});
    assert.equal(t.hub.envelopes.restoreModeHold(t.mission.id, "agent"), null, "a closed plan restores nothing");
  } finally { await t.cleanup(); }
});

test("M07-EN-15 two open plans: their LIVE_VALIDATION returns to BUILD_SAFE only when the LAST one closes, whichever closes first", async () => {
  const t = await ownerHub({ level: "TRUSTED" });
  try {
    const dir2 = path.join(t.dataDir, "factory-service-request");
    materializeFixture("service-request", dir2);
    const p2 = (await dispatch(t.hub, "project.register_test", { path: dir2 })).result;
    await dispatch(t.hub, "owner.autonomy.set", { projectId: p2.id, level: "TRUSTED" }, { ownerSession: t.owner.reauth() });
    await dispatch(t.hub, "factory.prepare", { projectId: p2.id, ...demoSpec("service-request"), limits: M09_MODELS });
    const { envelope: e1 } = await propose(t);
    t.queue("codex", "hang");
    await confirm(t, e1);
    assert.equal(t.hub.settings.get("mode"), "LIVE_VALIDATION");
    assert.equal(hold(t).envelopeId, e1.id);
    // The second plan is confirmed while the Hub is already LIVE: it shows no transition of its own and writes no hold.
    const e2 = (await dispatch(t.hub, "envelope.propose", { projectId: p2.id })).result.envelope;
    assert.equal(e2.body.modeTransition, null);
    t.queue("codex", "hang");
    await confirm(t, e2);
    // A resume of the first plan's mission while LIVE is held changes nothing (no overwrite of the holder).
    assert.equal(t.hub.envelopes.restoreModeHold(t.mission.id, "agent"), null);
    // The holder closes first: LIVE stays (the second plan is in force) and the hold passes to it.
    await dispatch(t.hub, "envelope.revoke", { envelopeId: e1.id });
    await untilEnvelope(t, e1.id, ["REVOKED"]);
    await waitFor(() => (hold(t).envelopeId === e2.id ? true : null), 5000, 10);
    assert.equal(t.hub.settings.get("mode"), "LIVE_VALIDATION");
    assert.equal(hold(t).handedOverFrom, e1.id);
    // The last plan closes: nothing is open, the Hub is back in BUILD_SAFE.
    await dispatch(t.hub, "envelope.revoke", { envelopeId: e2.id });
    await untilEnvelope(t, e2.id, ["REVOKED"]);
    await waitFor(() => (t.hub.settings.get("mode") === "BUILD_SAFE" ? true : null), 5000, 10);
    assert.deepEqual(hold(t), {});
    await dispatch(t.hub, "system.stop_all", { reason: "test" }, { channel: "owner", ownerSession: t.owner.session });
    await waitFor(() => t.hub.runs.activeRuns().length === 0, 15000);
  } finally { await t.cleanup(); }
});

test("M07-EN-16 a resume never restores a LIVE_VALIDATION the owner gave up by hand or under an expired plan; a stale deferred drop never erases a newer hold", async () => {
  const t = await ownerHub({ level: "TRUSTED" });
  try {
    const envelope = await pausedMission(t);
    // The owner chooses BUILD_SAFE by hand: the plan no longer owns the mode — at once, in the same transaction — and no resume
    // brings LIVE back.
    await dispatch(t.hub, "mode.set", { mode: "BUILD_SAFE" });
    assert.deepEqual(hold(t), {}, "dropped synchronously with the manual change");
    assert.equal(t.hub.envelopes.restoreModeHold(t.mission.id, "agent"), null);
    await simulateBoot(t).catch(() => null);
    assert.equal(hold(t).envelopeId, undefined, "a boot has no hold to suspend after the owner's choice");
    assert.equal(t.hub.envelopes.restoreModeHold(t.mission.id, "agent"), null);
    assert.equal(t.hub.settings.get("mode"), "BUILD_SAFE");

    // A suspended hold under a plan whose time has passed (before the housekeeping tick closes it): nothing restored.
    t.hub.bus.transaction(() => t.hub.settings.set("envelopeModeHold", { envelopeId: envelope.id, since: new Date().toISOString(), suspendedByBoot: true }, "envelopes", "test"));
    const expiresAt = t.hub.envelopes.get(envelope.id).expiresAt;
    t.hub.db.prepare("UPDATE mission_envelopes SET expires_at = ? WHERE id = ?").run(new Date(Date.now() - 1000).toISOString(), envelope.id);
    assert.equal(t.hub.envelopes.restoreModeHold(t.mission.id, "agent"), null);
    assert.equal(t.hub.settings.get("mode"), "BUILD_SAFE");
    t.hub.db.prepare("UPDATE mission_envelopes SET expires_at = ? WHERE id = ?").run(expiresAt, envelope.id);
    // Back to the legacy policy (the owner's fail-safe): no plan restores LIVE_VALIDATION, whatever the hold says.
    const policy = t.hub.settings.get("ownerPolicy");
    await dispatch(t.hub, "owner.policy.deactivate", { reason: "test" });
    assert.equal(t.hub.envelopes.restoreModeHold(t.mission.id, "agent"), null);
    assert.equal(t.hub.settings.get("mode"), "BUILD_SAFE");
    t.hub.bus.transaction(() => t.hub.settings.set("ownerPolicy", policy, "test", "restore the voice-first policy for the rest of the test"));
    assert.equal(t.hub.envelopes.restoreModeHold(t.mission.id, "agent").envelopeId, envelope.id, "in force again: restored");
    assert.equal(t.hub.settings.get("mode"), "LIVE_VALIDATION");

    // Compare-and-set: a manual change queues the drop of the hold it saw; a newer hold written before the drop runs survives it.
    t.hub.bus.transaction(() => t.hub.settings.set("mode", "BUILD_SAFE", "user", "by hand"));
    const newer = { envelopeId: envelope.id, since: new Date(Date.now() + 5).toISOString(), restored: true, by: "agent" };
    t.hub.bus.transaction(() => t.hub.settings.set("envelopeModeHold", newer, "envelopes", "newer hold"));
    await settle();
    assert.deepEqual(hold(t), newer);
    // That hold is not one a boot suspended: no resume restores anything from it.
    t.hub.bus.transaction(() => t.hub.settings.set("mode", "BUILD_SAFE", "envelopes", "test"));
    assert.equal(t.hub.envelopes.restoreModeHold(t.mission.id, "agent"), null, "only a hold a boot suspended can be restored");
  } finally { await t.cleanup(); }
});

test("M07-EN-17 an agent resumes only inside what the owner confirmed: not the owner's pause, not a new time window, not one more attempt; a refused resume leaves no LIVE_VALIDATION behind", async () => {
  const t = await ownerHub({ level: "TRUSTED" });
  try {
    await pausedMission(t, { by: "owner" });
    await simulateBoot(t);
    await assert.rejects(agent(t, "factory.resume", { missionId: t.mission.id }), /Pauza a fost decizia ta/);
    assert.equal(t.hub.settings.get("mode"), "BUILD_SAFE", "the restored mode was undone");
    assert.equal(hold(t).suspendedByBoot, true, "and the hold is suspended again, as before the refused resume");
    assert.equal(view(t, t.mission.id).factory.stage, "PAUSED");
    // The owner resumes (their decision); then the agent pauses; past the time limit the agent may not open a new window.
    t.queue("codex", "hang");
    await dispatch(t.hub, "factory.resume", { missionId: t.mission.id });
    assert.equal(t.hub.settings.get("mode"), "LIVE_VALIDATION");
    await waitFor(() => t.hub.runs.activeRuns().length > 0, 20000);
    await agent(t, "factory.pause", { missionId: t.mission.id });
    await untilStage(t, t.mission.id, ["PAUSED"]);
    await waitFor(() => t.hub.runs.activeRuns().length === 0, 15000);
    const deadline = t.hub.db.prepare("SELECT deadline_at FROM factory_missions WHERE mission_id = ?").get(t.mission.id).deadline_at;
    t.hub.db.prepare("UPDATE factory_missions SET deadline_at = ? WHERE mission_id = ?").run(new Date(Date.now() - 1000).toISOString(), t.mission.id);
    await assert.rejects(agent(t, "factory.resume", { missionId: t.mission.id }), /fereastră nouă de timp e decizia ta/);
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'factory.deadline_extended' AND scope_id = ?").get(t.mission.id).n, 0);
    t.hub.db.prepare("UPDATE factory_missions SET deadline_at = ? WHERE mission_id = ?").run(deadline, t.mission.id);
    await dispatch(t.hub, "system.stop_all", { reason: "test" }, { channel: "owner", ownerSession: t.owner.session });
    await waitFor(() => t.hub.runs.activeRuns().length === 0, 15000);
  } finally { await t.cleanup(); }
  // Exhausted attempts: a writer turn that keeps failing ends at NEEDS_OWNER_DECISION; one more attempt is the owner's call.
  const u = await ownerHub({ level: "TRUSTED" });
  try {
    const { envelope } = await propose(u);
    for (let i = 0; i < 3; i += 1) u.queue("codex", "factory-write:none");
    await confirm(u, envelope);
    // A failed writer turn is BLOCKED; the agent may resume it while attempts remain (inside the confirmed limit of 2).
    assert.equal((await untilStage(u, u.mission.id, SETTLED)).factory.stage, "BLOCKED");
    await agent(u, "factory.resume", { missionId: u.mission.id });
    await waitFor(() => (view(u, u.mission.id).factory.stage === "BLOCKED" && u.hub.runs.activeRuns().length === 0 ? true : null), 30000);
    // The next resume finds both attempts used: the factory stops at the owner's decision.
    await agent(u, "factory.resume", { missionId: u.mission.id });
    const stuck = await untilStage(u, u.mission.id, ["NEEDS_OWNER_DECISION"]);
    assert.match(stuck.factory.stageReason, /2 încercări folosite/);
    await assert.rejects(agent(u, "factory.resume", { missionId: u.mission.id }), /Misiunea așteaptă decizia ta \(IMPLEMENTING: 2 încercări folosite/);
    assert.equal(u.hub.db.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'factory.extra_attempt' AND scope_id = ?").get(u.mission.id).n, 0, "no attempt was added");
  } finally { await u.cleanup(); }
});

test("M07-EN-18 only the plans that hold LIVE_VALIDATION keep it: after the owner's manual choice, a later plan's end returns to BUILD_SAFE even with an older plan open", async () => {
  const t = await ownerHub({ level: "TRUSTED" });
  try {
    const dir2 = path.join(t.dataDir, "factory-service-request");
    materializeFixture("service-request", dir2);
    const p2 = (await dispatch(t.hub, "project.register_test", { path: dir2 })).result;
    await dispatch(t.hub, "owner.autonomy.set", { projectId: p2.id, level: "TRUSTED" }, { ownerSession: t.owner.reauth() });
    await dispatch(t.hub, "factory.prepare", { projectId: p2.id, ...demoSpec("service-request"), limits: M09_MODELS });
    const { envelope: e1 } = await propose(t);
    t.queue("codex", "hang");
    await confirm(t, e1);
    assert.deepEqual(hold(t).holders, [e1.id]);
    // The owner takes the Hub off LIVE by hand while E1 is still open: E1 no longer holds anything.
    await dispatch(t.hub, "mode.set", { mode: "BUILD_SAFE" });
    assert.deepEqual(hold(t), {});
    // A second plan enters LIVE on its own transition; it is the only holder.
    const e2 = (await dispatch(t.hub, "envelope.propose", { projectId: p2.id })).result.envelope;
    assert.ok(e2.body.modeTransition);
    t.queue("codex", "hang");
    await confirm(t, e2);
    assert.deepEqual(hold(t).holders, [e2.id]);
    // E2 ends: the Hub returns to BUILD_SAFE although E1 is still open (it did not hold the mode any more).
    await dispatch(t.hub, "envelope.revoke", { envelopeId: e2.id });
    await untilEnvelope(t, e2.id, ["REVOKED"]);
    await waitFor(() => (t.hub.settings.get("mode") === "BUILD_SAFE" ? true : null), 5000, 10);
    assert.deepEqual(hold(t), {});
    assert.ok(["ACTIVE", "WAITING_OWNER", "CONFIRMED"].includes(t.hub.envelopes.get(e1.id).status), "E1 is still open");
    await dispatch(t.hub, "system.stop_all", { reason: "test" }, { channel: "owner", ownerSession: t.owner.session });
    await waitFor(() => t.hub.runs.activeRuns().length === 0, 15000);
  } finally { await t.cleanup(); }
});

/** Two plans on two projects: X (the fixture's mission, paused by the agent, then a boot) and A on a second project (confirmed after the boot). */
async function suspendedThenNewPlan(t) {
  const dir2 = path.join(t.dataDir, "factory-service-request");
  materializeFixture("service-request", dir2);
  const p2 = (await dispatch(t.hub, "project.register_test", { path: dir2 })).result;
  await dispatch(t.hub, "owner.autonomy.set", { projectId: p2.id, level: "TRUSTED" }, { ownerSession: t.owner.reauth() });
  await dispatch(t.hub, "factory.prepare", { projectId: p2.id, ...demoSpec("service-request"), limits: M09_MODELS });
  const x = await pausedMission(t);
  await simulateBoot(t);
  assert.deepEqual([hold(t).envelopeId, hold(t).suspendedByBoot], [x.id, true]);
  const a = (await dispatch(t.hub, "envelope.propose", { projectId: p2.id })).result.envelope;
  t.queue("codex", "hang");
  await confirm(t, a);
  return { x, a };
}

test("M07-EN-19 a plan confirmed after a boot holds LIVE_VALIDATION alone; when it ends, the plans the boot suspended stay suspended (BUILD_SAFE)", async () => {
  const t = await ownerHub({ level: "TRUSTED" });
  try {
    const { x, a } = await suspendedThenNewPlan(t);
    assert.equal(t.hub.settings.get("mode"), "LIVE_VALIDATION");
    assert.deepEqual(hold(t).holders, [a.id], "only the confirming plan holds the mode");
    assert.deepEqual(hold(t).suspended.holders, [x.id], "the suspended plan waits beside it");
    await dispatch(t.hub, "envelope.revoke", { envelopeId: a.id });
    await untilEnvelope(t, a.id, ["REVOKED"]);
    await waitFor(() => (t.hub.settings.get("mode") === "BUILD_SAFE" ? true : null), 5000, 10);
    assert.deepEqual([hold(t).envelopeId, hold(t).suspendedByBoot, hold(t).holders], [x.id, true, [x.id]], "the boot-suspended hold is back as it was");
    // Only an explicit resume of X restores its LIVE_VALIDATION.
    t.queue("codex", "hang");
    await agent(t, "factory.resume", { missionId: t.mission.id });
    assert.equal(t.hub.settings.get("mode"), "LIVE_VALIDATION");
    await dispatch(t.hub, "system.stop_all", { reason: "test" }, { channel: "owner", ownerSession: t.owner.session });
    await waitFor(() => t.hub.runs.activeRuns().length === 0, 15000);
  } finally { await t.cleanup(); }
});

test("M07-EN-20 a suspended plan resumed while a newer plan holds LIVE_VALIDATION joins the holders; the mode then lasts until the last of them ends", async () => {
  const t = await ownerHub({ level: "TRUSTED" });
  try {
    const { x, a } = await suspendedThenNewPlan(t);
    t.queue("codex", "hang");
    await agent(t, "factory.resume", { missionId: t.mission.id });
    assert.deepEqual([...hold(t).holders].sort(), [a.id, x.id].sort(), "X holds the mode again, beside A");
    assert.equal(hold(t).suspended, undefined);
    await dispatch(t.hub, "envelope.revoke", { envelopeId: a.id });
    await untilEnvelope(t, a.id, ["REVOKED"]);
    await waitFor(() => (hold(t).envelopeId === x.id ? true : null), 5000, 10);
    assert.equal(t.hub.settings.get("mode"), "LIVE_VALIDATION", "X still holds it");
    await dispatch(t.hub, "envelope.revoke", { envelopeId: x.id });
    await untilEnvelope(t, x.id, ["REVOKED"]);
    await waitFor(() => (t.hub.settings.get("mode") === "BUILD_SAFE" ? true : null), 5000, 10);
    assert.deepEqual(hold(t), {});
    await dispatch(t.hub, "system.stop_all", { reason: "test" }, { channel: "owner", ownerSession: t.owner.session });
    await waitFor(() => t.hub.runs.activeRuns().length === 0, 15000);
  } finally { await t.cleanup(); }
});
