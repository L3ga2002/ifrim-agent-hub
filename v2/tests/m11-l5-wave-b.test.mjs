// M11 L5 wave B — the owner's side of test-first plans (design .ifrim/M11_L5_DESIGN.md §2, §4, §6, §7 „Unda B”, §8): the engineering
// planner's routing table A–J (owner/planners/engineering.mjs), the plan's step 0 in the hashed body, its card, budget, authority and
// deltas (owner/envelopes.mjs), the cockpit's stage label (owner/cockpit.mjs) and Lega's rule (policy/lega-policy.mjs).
// PASS_SIMULATED: test Hubs with the fake Codex / Claude Code (author:<name>, test-review:<name>, factory-write:<name>, review:<name>,
// lega-calls:<b64>), the software authenticator, the real `node --test` through the fake-codex sandbox; no model, no network, no live Hub.
//  - U1 golden: an ordinary plan's body / envelopeHash / scopeHash / card and the planner's bound specs are byte-identical to HEAD's code
//    (both modules are loaded from `git show HEAD:…` into a temp copy wired to the current tree; nothing is written to the repository);
//  - U9: body.testFirst and the card's lines, the budget (10 per role), authorityFor (read-only, reauthorMax, a plan without step 0), the
//    deltas of step 0 (one more attempt in the owner's words, never a repair cycle: NO_DELTA), budgetSpent by the stage's own role;
//  - I1 end to end through the intake: ONE plan card → ONE confirmation → DELIVERY_READY on bug-demo-test-first;
//  - I3 booking-demo FEATURE, I11 the plan's budget with a top-up beyond 5 attempts, I13 the table A–J (intake.plan, typed input, Lega
//    propose_mission; ProDelivery and a real project refused by the planner AND by factory.start with a hand-made spec), I14 regressions;
//  - PAUSABLE / advance with step 0 (a revoked plan pauses a mission writing its test; a resume into step 0 makes the plan ACTIVE again).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { makeTestHub, waitFor, enrolOwner, prepareLiveWithoutGrants } from "./helpers.mjs";
import { materializeFixture, demoSpec, FIXTURE_ROOT } from "../server/factory/fixtures.mjs";
import { TEST_PROJECT_MARKER } from "../server/domain/projects.mjs";
import { hashCanonical, canonicalJson, sha256 } from "../server/core/canonical.mjs";
import { buildEngineeringSpec, acceptanceCandidates, topicCandidates, namedTopic, nameHoldsTopic, workTypeOf, TEST_FIRST_MAX_DURATION_MIN } from "../server/owner/planners/engineering.mjs";
import { TEST_FIRST_EFFECT } from "../server/owner/envelopes.mjs";
import { T1, T1_ROUTE, T_SCRIPT_RUNS_STAGING, T_CARD_STEP0_NO_REWRITE, T_ROUTE_EXAMPLE_FIX, T_ROUTE_EXAMPLE_ADD, T_CARD_STEP0, T_CARD_PROVES, T_STEPS_PREFIX, T_MODELS_SUFFIX, T_PLANNER_NOTE, T_ROUTE_MISSING_TEST, T_ROUTE_ASK_BEHAVIOUR, T_ROUTE_REFACTOR, T_ALREADY_PASSES } from "../server/factory/test-first.mjs";
import { LEGA_CONSENT_VERSION, legaAgentInstructions } from "../server/policy/lega-policy.mjs";
import { resolveIntent } from "../server/owner/intents.mjs";
import { factoryStageLabel } from "../server/policy/factory-wait.mjs";

// The pre-L5 commit b0883ad (2.12.2 + M11 wave 0) is the golden base of U1 (pinned: HEAD now contains L5 itself).
const GOLDEN_BASE = "b0883ad";
// The repository is read from (U1). A mutation run from a copy of the tree (no .git there) points IFRIM_TEST_GIT_ROOT at the repository.
const REPO = process.env.IFRIM_TEST_GIT_ROOT ? path.resolve(process.env.IFRIM_TEST_GIT_ROOT) : path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const CODEX_MODELS = [{ id: "gpt-6.1-sol", isDefault: true, efforts: ["medium", "high"] }, { id: "gpt-fake-sol", efforts: ["medium", "high"] }];
const HAND_MODELS = { writerModel: "gpt-fake-sol", reviewerModel: "sonnet" };
const SETTLED = ["DELIVERY_READY", "NEEDS_OWNER_DECISION", "BLOCKED", "PAUSED", "CANCELLED", "ACCEPTED", "REJECTED"];
const OFFER = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n";
/** The pilot's words (design §10): a bug, no test named — on bug-demo-test-first the Hub writes the test (route H). */
const BUG_TF = "Repară validarea: un nume format doar din spații trece de validare";
const NO_FILE = /\.mjs|test\/hub|\.ifrim-hub|test\/acceptance/;

const dispatch = (hub, type, payload, extra = {}) => hub.commands.dispatch({ type, payload, channel: "test", actor: "test", ...extra });
const count = (t, sql, ...args) => t.hub.db.prepare(sql).get(...args).n;
const events = (t, type) => t.hub.db.prepare("SELECT scope_id, source, payload_json FROM events WHERE type = ? ORDER BY seq").all(type).map((r) => ({ scopeId: r.scope_id, source: r.source, payload: JSON.parse(r.payload_json || "{}") }));
const view = (t, id) => t.hub.factory.view(id);
const untilStage = (t, id, stages, ms = 180000) => waitFor(() => (stages.includes(view(t, id).factory.stage) ? view(t, id) : null), ms, 50);
const activeRun = (t, provider) => t.hub.runs.activeRuns().find((r) => r.provider === provider) || null;
const untilRun = (t, provider, id, stage, ms = 60000) => waitFor(() => (activeRun(t, provider) && view(t, id).factory.stage === stage ? activeRun(t, provider) : null), ms, 20);
const noRuns = (t) => waitFor(() => (t.hub.runs.activeRuns().length === 0 ? true : null), 30000, 50);
const plan = (t, input, ctx = t.ctx) => t.hub.intake.plan({ kind: "engineering", ...input }, ctx);
const asOwner = (t, payload) => t.hub.commands.dispatch({ type: "owner.intent", payload, channel: "owner", actor: `owner:${t.owner.session.id}`, ownerSession: t.owner.session }).then((r) => r.result);
const confirm = (t, env) => dispatch(t.hub, "envelope.confirm", { envelopeId: env.id, nonce: env.nonce, displayedHash: env.envelopeHash }, { ownerSession: t.owner.session }).then((r) => r.result);
const stopMission = async (t, id) => { await dispatch(t.hub, "factory.stop", { missionId: id }, { channel: "ui" }); await untilStage(t, id, ["CANCELLED"]); await noRuns(t); };
const exhaustGrant = (t, id) => t.hub.db.prepare("UPDATE live_grants SET attempts_used = max_attempts, status = 'exhausted' WHERE id = ?").run(id);
const b64 = (list) => Buffer.from(JSON.stringify(list)).toString("base64url");

/** A copy of a fixture project (booking-demo is not a registered demo: copied with its test-project marker). */
function materialize(fixture, dir, name) {
  if (fixture === "booking-demo") {
    fs.cpSync(path.join(FIXTURE_ROOT, "booking-demo"), dir, { recursive: true, errorOnExist: true });
    fs.writeFileSync(path.join(dir, TEST_PROJECT_MARKER), `${JSON.stringify({ createdBy: "ifrim-agent-hub", purpose: "live-validation", name, stack: "Node.js", fixture })}\n`);
  } else materializeFixture(fixture, dir);
}

/**
 * A test Hub whose Codex account lists the role-default writer model, the owner enrolled (voice-first policy) and the test projects
 * [[fixture, name, mutate?]…] (direct children of the projects root). `codex` is the default Codex scenario (a Lega script).
 */
async function waveBHub({ fixtures = [["bug-demo-test-first", "Factory Demo L5"]], codex = "ok", clock = null } = {}) {
  const t = await makeTestHub({ queues: true, codex, ...(clock ? { clock } : {}) });
  fs.writeFileSync(`${t.logs.codex}.models.json`, JSON.stringify(CODEX_MODELS));
  await prepareLiveWithoutGrants(t.hub);
  t.owner = await enrolOwner(t);
  t.p = {};
  for (const [fixture, name, mutate] of fixtures) {
    const dir = path.join(t.dataDir, `p-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`);
    materialize(fixture, dir, name);
    if (mutate) mutate(dir);
    const project = (await dispatch(t.hub, "project.register_test", { path: dir, name })).result;
    t.p[name] = { ...project, dir };
  }
  t.ctx = { channel: "owner", ownerSession: t.owner.session, actor: "owner" };
  return t;
}

/** A REAL (registry) project with runs enabled, as the owner enables one (its exact name typed). */
async function realProject(t, name = "Client Real") {
  const dir = path.join(t.dataDir, "client-real");
  fs.cpSync(path.join(FIXTURE_ROOT, "bug-demo"), dir, { recursive: true, filter: (src) => !/acceptance\.test\.mjs$/.test(src) });
  fs.writeFileSync(t.config.registryPath, `# Proiecte\n\n## ${name}\n- Path: ${dir}\n- Stack: Node.js\n`);
  await dispatch(t.hub, "projects.sync", {});
  const project = t.hub.projects.list().find((x) => x.name === name);
  assert.ok(project && project.source === "registry", JSON.stringify(project));
  await dispatch(t.hub, "project.execution.enable", { projectId: project.id, confirmName: name }, { channel: "ui" });
  return { ...t.hub.projects.get(project.id), dir };
}

/** A fixture in a temp folder (removed by the caller), for the pure planner checks. */
function fixtureCopy(name = "bug-demo") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ifrim-l5b-"));
  const dir = path.join(root, name);
  if (name === "booking-demo") fs.cpSync(path.join(FIXTURE_ROOT, name), dir, { recursive: true });
  else materializeFixture(name, dir);
  return { dir, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

let headN = 0;
/**
 * HEAD's version of a repository module (the code before wave B), loaded from `git show HEAD:<rel>` into a temp copy whose relative
 * imports point at the current tree. Read-only: nothing in the repository is written.
 */
async function headModule(rel) {
  const text = execFileSync("git", ["-C", REPO, "show", `${GOLDEN_BASE}:${rel}`], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  const dir = path.dirname(path.join(REPO, ...rel.split("/")));
  const wired = text.replace(/(\bfrom\s*|\bimport\s*\(\s*)"(\.{1,2}\/[^"]+)"/g, (_, lead, spec) => `${lead}${JSON.stringify(pathToFileURL(path.resolve(dir, spec)).href)}`);
  const tmp = path.join(os.tmpdir(), `ifrim-l5b-head-${process.pid}-${headN++}.mjs`);
  fs.writeFileSync(tmp, wired);
  try { return await import(pathToFileURL(tmp).href); } finally { fs.rmSync(tmp, { force: true }); }
}

// ------------------------------------------------------------------------------------------------------------------------------ U1
test("U1 golden: an ordinary plan's body, envelopeHash, scopeHash and card are byte-identical to HEAD's code; the planner's bound specs (A, C, E) and an ordinary request's identity and deadline are unchanged", async () => {
  const oldPlanner = await headModule("v2/server/owner/planners/engineering.mjs");
  const oldEnvelopes = await headModule("v2/server/owner/envelopes.mjs");
  const a = fixtureCopy("bug-demo");
  try {
    const project = { path: a.dir };
    for (const text of ["Repară bug-ul: un nume format doar din spații trece de validare. Testul de acceptanță e test/acceptance.test.mjs.", "Repară bugul; testul e test/unit.test.mjs",
      "Repară testul de acceptanță din Factory Demo M10.2", "Implementează ce cere acceptance test-ul pentru nume", "Repară validarea numelui: spațiile trec de verificare",
      "Refactorizează validarea solicitărilor; testul e test/unit.test.mjs"]) {
      const before = oldPlanner.buildEngineeringSpec({ text, project });
      const after = buildEngineeringSpec({ text, project });
      assert.ok(after.testRef, text);
      assert.deepEqual({ input: after.input, problems: after.problems, testRef: after.testRef, workType: after.workType, autoBound: after.autoBound }, before, text);
      assert.equal(canonicalJson(after.input), canonicalJson(before.input), text);
      assert.equal(after.testFirst, null, text);
    }
  } finally { a.cleanup(); }

  const t = await waveBHub({ fixtures: [["bug-demo", "Factory Demo M10.2"]] });
  try {
    const p = t.p["Factory Demo M10.2"];
    const r = await plan(t, { text: "Repară testul de acceptanță din Factory Demo M10.2", projectId: p.id });
    assert.ok(r.plan?.envelope?.id, JSON.stringify(r).slice(0, 300));
    const missionId = r.plan.envelope.missionIds[0];
    const v = view(t, missionId);
    // The request's identity (requestHash: a repeated request finds its draft) and the default deadline: as before wave B.
    const models = t.hub.engineeringPlanner.defaultsFor(p.id).limits;
    const prov = events(t, "factory.provenance").find((e) => e.scopeId === missionId && e.payload.requestHash);
    assert.equal(prov.payload.requestHash, hashCanonical({ projectId: p.id, workType: "BUGFIX", objective: v.spec.spec.objective, testRef: "test/acceptance.test.mjs", models }).slice(0, 32));
    assert.equal(v.factory.limits.maxDurationMin, 120);
    assert.equal(v.spec.spec.authoring, undefined);
    // The same mission planned by HEAD's envelope service and by this one: the same bytes.
    const h = t.hub;
    const old = oldEnvelopes.createEnvelopes({ db: h.db, bus: h.bus, clock: h.config.now, settings: h.settings, projects: h.projects, missions: h.missions, grants: h.grants, gate: h.gate,
      approvals: h.approvals, commands: h.commands, trust: h.trust, factory: h.factory, factoryRunner: h.factoryRunner, environments: h.environments, config: h.config, voice: h.voice });
    try {
      const before = await old.propose({ projectId: p.id, missionIds: [missionId] });
      const after = await h.envelopes.propose({ projectId: p.id, missionIds: [missionId] });
      assert.equal(canonicalJson(after.envelope.body), canonicalJson(before.envelope.body), "body");
      assert.equal(after.envelope.envelopeHash, before.envelope.envelopeHash, "envelopeHash");
      assert.equal(after.envelope.body.missions[0].scopeHash, before.envelope.body.missions[0].scopeHash, "scopeHash");
      assert.deepEqual(after.summary, before.summary, "the card");
      assert.equal(after.envelope.body.testFirst, undefined);
      assert.equal(after.envelope.body.missions[0].testFirst, undefined);
      assert.ok(!after.envelope.body.allowedEffects.includes(TEST_FIRST_EFFECT));
      assert.equal(h.envelopes.budgetOf(after.envelope.id, missionId), 6, "(1 + 2) × 2 without step 0");
    } finally { old.close(); }
  } finally { await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ U9
test("U9 body and card: body.testFirst (top level and in the mission entry), one more allowed effect, 180 min, the step-0 lines without any path, budget 10 per role", async () => {
  const t = await waveBHub();
  try {
    const p = t.p["Factory Demo L5"];
    const r = await plan(t, { text: BUG_TF, projectId: p.id });
    const env = r.plan?.envelope;
    assert.ok(env?.id, JSON.stringify(r).slice(0, 400));
    const missionId = env.missionIds[0];
    const v = view(t, missionId);
    const a = v.spec.spec.authoring;
    assert.deepEqual([a.mode, a.criteria, a.reauthorMax, a.proofRuns, a.controls, a.author, a.testReviewer], ["hub", ["AC-1"], 1, 2, "bugfix", "claude", "codex"]);
    assert.match(a.testRef, /^test\/hub\/repara-validarea-un-nume-format-[0-9a-f]{6}\.test\.mjs$/);
    assert.equal(a.stagingRef, a.testRef.replace(/^test\/hub\//, ".ifrim-hub/staging/").replace(/\.test\.mjs$/, ".mjs"));
    assert.deepEqual(v.spec.spec.verification.acceptance, [`node --test ${a.testRef}`]);
    assert.deepEqual(v.spec.protected.problems, []);
    const tf = env.body.testFirst;
    assert.deepEqual(tf, { testRef: a.testRef, criteria: [{ id: "AC-1", text: v.spec.spec.acceptance[0].text }], author: { provider: "claude", model: "sonnet", effort: "medium" },
      testReviewer: { provider: "codex", model: "gpt-6.1-sol", effort: "medium" }, reauthorMax: 1, proofRuns: 2, mustFail: true, protectedAfterReview: true, remainingAuthoring: 2, missionId });
    const { missionId: _m, ...entryTf } = tf;
    assert.deepEqual(env.body.missions[0].testFirst, entryTf, "the mission entry carries the same step 0 (budget, authority)");
    assert.equal(env.body.allowedEffects.at(-1), TEST_FIRST_EFFECT);
    assert.equal(env.body.allowedEffects.filter((e) => e === TEST_FIRST_EFFECT).length, 1);
    assert.equal(env.body.limits.maxDurationMin, TEST_FIRST_MAX_DURATION_MIN);
    assert.equal(v.factory.limits.maxDurationMin, 180);
    const s = r.plan.summary;
    assert.equal(s.state, "PLAN_READY", JSON.stringify(s.blockers));
    assert.ok(s.steps.startsWith(`${T_STEPS_PREFIX}implementare (Codex), verificări, review (Claude, doar citire), până la 2 cicluri de remediere`), s.steps);
    assert.ok(s.models.endsWith(`${T_MODELS_SUFFIX}. Verificate din nou înainte de fiecare pornire; o schimbare oprește execuția înainte de model.`), s.models);
    assert.deepEqual(s.testFirst, { step0: T_CARD_STEP0, proves: T_CARD_PROVES(tf.criteria), criteria: tf.criteria, missions: [missionId] });
    assert.match(s.limits, /termen misiune 180 min/);
    assert.match(s.stops, /^Mă opresc la 180 min/);
    for (const line of [s.headline, s.where, s.steps, s.models, s.stops, s.limits, s.files, s.testFirst.step0, s.testFirst.proves, r.note]) assert.doesNotMatch(line, NO_FILE, line);
    assert.ok(r.note.includes(T_PLANNER_NOTE), r.note);
    assert.match(r.note, /termen misiune 180 min/);
    assert.equal(t.hub.envelopes.budgetOf(env.id, missionId), 10, "(1 + 2 cycles + 2 author cycles) × 2 attempts");
    assert.equal(t.hub.db.prepare("SELECT expires_at FROM mission_envelopes WHERE id = ?").get(env.id).expires_at,
      new Date(Date.parse(env.issuedAt) + (180 + 30) * 60000).toISOString(), "the plan's window: 180 + 30 min");
    // readiness also checks the test's reviewer (Codex, read-only): nothing fails here, nothing is listed.
    assert.deepEqual(t.hub.envelopes.readiness(t.hub.projects.get(p.id), [v]).blockers, []);
  } finally { await t.cleanup(); }
});

test("U9 authorityFor: under the plan, step 0 runs only read-only, at most reauthorMax rewrites, and only when the plan shows step 0; the other stages are unaffected", async () => {
  const t = await waveBHub();
  try {
    const p = t.p["Factory Demo L5"];
    const r = await plan(t, { text: BUG_TF, projectId: p.id });
    const env = r.plan.envelope;
    const missionId = env.missionIds[0];
    t.queue("claude", "hang");
    await confirm(t, env);
    await untilRun(t, "claude", missionId, "TEST_AUTHORING");
    const b = view(t, missionId).factory.bindings;
    const auth = (x) => t.hub.envelopes.authorityFor(missionId, x);
    const review = { stage: "TEST_REVIEW", cycle: 0, role: "writer", bindingHash: b.writer.bindingHash };
    const author = { stage: "TEST_AUTHORING", role: "reviewer", bindingHash: b.reviewer.bindingHash };
    assert.equal(auth({ ...review, access: "workspace-write" })?.reason, "Verificarea testului: pasul 0 rulează doar în citire (testul îl scrie Hub-ul); planul confirmat nu admite un pas care scrie în proiect");
    assert.match(auth({ ...review })?.reason || "", /doar în citire.*un pas cu acces nedeclarat$/, "no access given → refused");
    assert.equal(auth({ ...review, access: "read-only" }), null);
    assert.equal(auth({ ...author, cycle: 1, access: "read-only" }), null);
    assert.match(auth({ ...author, cycle: 2, access: "read-only" })?.reason || "", /^Testul \(pasul 0\): rescrierea 2 depășește planul confirmat \(cel mult 1\)/);
    assert.equal(auth({ stage: "IMPLEMENTING", cycle: 0, role: "writer", bindingHash: b.writer.bindingHash, access: "workspace-write" }), null, "ordinary stages: unchanged");
    assert.match(auth({ ...review, bindingHash: "0".repeat(64), access: "read-only" })?.reason || "", /nu este cel confirmat/, "the binding check still applies first");
    // The running author turn: read-only, under a derived grant of THIS plan (the reviewer's binding).
    const run = t.hub.db.prepare("SELECT access, grant_id FROM agent_runs WHERE provider = 'claude'").get();
    assert.equal(run.access, "read-only");
    assert.ok(t.hub.grants.ofEnvelope(env.id).some((g) => g.id === run.grant_id));
    // A plan whose body does not show step 0 (stored before wave B, or tampered) admits no step-0 turn.
    const row = t.hub.db.prepare("SELECT body_json FROM mission_envelopes WHERE id = ?").get(env.id);
    const body = JSON.parse(row.body_json);
    const stripped = { ...body, missions: body.missions.map(({ testFirst: _tf, ...m }) => m) };
    t.hub.db.prepare("UPDATE mission_envelopes SET body_json = ? WHERE id = ?").run(JSON.stringify(stripped), env.id);
    assert.match(auth({ ...review, access: "read-only" })?.reason || "", /planul confirmat nu are pasul 0/);
    t.hub.db.prepare("UPDATE mission_envelopes SET body_json = ? WHERE id = ?").run(row.body_json, env.id);
    await stopMission(t, missionId);
  } finally { await t.cleanup(); }
});

test("U9 deltas in step 0: the only difference is one more attempt, named in the owner's words; a repair cycle is refused (NO_DELTA) before anything changes; an outcome a resume cannot change has none; the cockpit says the stage in words", async () => {
  const t = await waveBHub({ fixtures: [["bug-demo-test-first", "Factory Demo L5"], ["bug-demo-test-first", "Factory Demo L5 B"]] });
  try {
    // (a) Two unreadable answers of the author: the step's attempts are spent → the plan waits; its difference: ONE more attempt.
    const p = t.p["Factory Demo L5"];
    const r = await plan(t, { text: BUG_TF, projectId: p.id });
    const env = r.plan.envelope;
    const missionId = env.missionIds[0];
    t.queue("claude", "ok", "ok", "hang");
    await confirm(t, env);
    const stuck = await untilStage(t, missionId, SETTLED);
    assert.equal(stuck.factory.stage, "NEEDS_OWNER_DECISION", stuck.factory.stageReason);
    await waitFor(() => t.hub.envelopes.get(env.id).status === "WAITING_OWNER", 10000);
    const d = t.hub.envelopes.deltaOf(env.id, missionId);
    assert.deepEqual([d.kind, d.stage], ["attempt", "TEST_AUTHORING"]);
    assert.equal(d.text, "O încercare în plus pentru etapa „Testul (pasul 0)” (2/2 folosite), în același plan și aceleași limite de timp.");
    assert.doesNotMatch(d.text, /TEST_AUTHORING/, "never the stage's code");
    assert.deepEqual(t.hub.envelopes.view(env.id).delta, d);
    const deltasBefore = count(t, "SELECT COUNT(*) AS n FROM events WHERE type = 'envelope.delta_confirmed'");
    const derivedBefore = t.hub.envelopes.get(env.id).derived;
    await assert.rejects(Promise.resolve().then(() => t.hub.envelopes.confirmDelta({ envelopeId: env.id, missionId, session: t.owner.session, kind: "cycle" })),
      (e) => e.code === "NO_DELTA" && /^Etapa 0 nu are cicluri de remediere/.test(e.message));
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM events WHERE type = 'envelope.delta_confirmed'"), deltasBefore, "nothing confirmed");
    assert.deepEqual(t.hub.envelopes.get(env.id).derived, derivedBefore, "nothing changed in the plan");
    assert.equal(view(t, missionId).factory.limits.maxRepairCycles, 2, "nothing changed in the mission");
    // The shown difference (one more attempt) is the real one: confirmed, the author runs again inside the same plan.
    const out = t.hub.envelopes.confirmDelta({ envelopeId: env.id, missionId, session: t.owner.session });
    assert.equal(out.delta.kind, "attempt");
    await untilRun(t, "claude", missionId, "TEST_AUTHORING");
    await stopMission(t, missionId);

    // (b) A test that already passes: an outcome a resume cannot change — no difference to confirm; a cycle is refused (NO_DELTA).
    const q = t.p["Factory Demo L5 B"];
    const r2 = await plan(t, { text: BUG_TF, projectId: q.id });
    const env2 = r2.plan.envelope;
    const m2 = env2.missionIds[0];
    t.queue("claude", "author:bug-already-passes");
    await confirm(t, env2);
    const held = await untilStage(t, m2, SETTLED);
    assert.equal(held.factory.stageReason, T_ALREADY_PASSES);
    await waitFor(() => t.hub.envelopes.get(env2.id).status === "WAITING_OWNER", 10000);
    assert.equal(t.hub.envelopes.deltaOf(env2.id, m2), null);
    assert.equal(t.hub.envelopes.view(env2.id).delta, null, "the card offers no „confirm the difference”");
    await assert.rejects(Promise.resolve().then(() => t.hub.envelopes.confirmDelta({ envelopeId: env2.id, missionId: m2, session: t.owner.session })), (e) => e.code === "NO_DELTA");
    // The cockpit: the stage in words (never NEEDS_OWNER_DECISION), and the honest next step (stop, or a new plan).
    const why = t.hub.cockpit.whyBlocked({ missionId: m2 }).items[0];
    assert.match(why.what, /· Decizia ta \(Așteaptă decizia ta\)$/);
    assert.doesNotMatch(why.what, /NEEDS_OWNER_DECISION/);
    assert.match(why.action, /^Decizia ta: oprește misiunea sau cere un plan nou, cu cerința spusă altfel/);
    await stopMission(t, m2);
  } finally { await t.cleanup(); }
});

test("U9 budgetSpent reads the stage's own role: the author's (reviewer binding) plan budget spent while the mission is BLOCKED → one more attempt of „Testul (pasul 0)”, never the writer's grants", async () => {
  const t = await waveBHub();
  try {
    const p = t.p["Factory Demo L5"];
    const r = await plan(t, { text: BUG_TF, projectId: p.id });
    const env = r.plan.envelope;
    const missionId = env.missionIds[0];
    t.queue("claude", "hang");
    await confirm(t, env);
    await untilRun(t, "claude", missionId, "TEST_AUTHORING");
    await dispatch(t.hub, "factory.pause", { missionId }, { channel: "ui" });
    await untilStage(t, missionId, ["PAUSED"]);
    await noRuns(t);
    // The interrupted turn is archived (and its grant attempt given back) before the grants are arranged below.
    await waitFor(() => events(t, "factory.late_result").some((e) => e.scopeId === missionId), 15000);
    await t.hub.factory.idle(missionId);
    // The reviewer role's whole plan budget spent (10 attempts, two grants), the writer's untouched; the mission stopped at the gate.
    const reviewerHash = view(t, missionId).factory.bindings.reviewer.bindingHash;
    const claudeGrants = () => t.hub.grants.ofEnvelope(env.id).filter((g) => g.provider === "claude");
    for (const g of claudeGrants()) exhaustGrant(t, g.id);
    const top = t.hub.envelopes.topUp(missionId, "reviewer", reviewerHash);
    assert.equal(top?.attempts, 5, JSON.stringify(top));
    for (const g of claudeGrants()) exhaustGrant(t, g.id);
    assert.deepEqual(t.hub.envelopes.topUp(missionId, "reviewer", reviewerHash), { exhausted: true });
    t.hub.db.prepare("UPDATE factory_missions SET stage = 'BLOCKED', wait_reason = 'grant' WHERE mission_id = ?").run(missionId);
    const d = t.hub.envelopes.deltaOf(env.id, missionId);
    assert.deepEqual([d?.kind, d?.stage, d?.budget], ["attempt", "TEST_AUTHORING", true], JSON.stringify(d));
    assert.equal(d.text, "O încercare în plus pentru etapa „Testul (pasul 0)” (încercările confirmate în plan s-au epuizat), în același plan și aceleași limite de timp.");
    assert.ok(t.hub.grants.ofEnvelope(env.id).some((g) => g.provider === "codex" && g.status === "active"), "the writer's grant still has room: it is not the author's role");
    t.hub.db.prepare("UPDATE factory_missions SET stage = 'PAUSED', wait_reason = '' WHERE mission_id = ?").run(missionId);
    await stopMission(t, missionId);
  } finally { await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ I1
test("I1 end to end through the intake: ONE test-first plan card from the owner's words → ONE confirmation → step 0 (Claude writes, the Hub proves twice, Codex reviews, read-only) → protected → DELIVERY_READY; one envelope.confirmed, factory.scope decided by the plan, no mode write, derived grants only; a later bug is never bound to the Hub-written test", async () => {
  const t = await waveBHub();
  try {
    const p = t.p["Factory Demo L5"];
    const modeEvents = () => count(t, "SELECT COUNT(*) AS n FROM events WHERE type = 'settings.changed' AND json_extract(payload_json, '$.key') = 'mode'");
    const modeBefore = modeEvents();
    const r = await plan(t, { text: BUG_TF, projectId: p.id });
    assert.equal(r.refused, undefined);
    assert.equal(r.clarification, undefined, "no question: the Hub writes the test");
    const env = r.plan?.envelope;
    assert.ok(env?.body?.testFirst, JSON.stringify(r).slice(0, 400));
    const missionId = env.missionIds[0];
    assert.equal(view(t, missionId).factory.stage, "SPEC_DRAFT");
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM agent_runs"), 0, "the card runs nothing");
    assert.equal(t.hub.grants.ofEnvelope(env.id).length, 0, "no grant before the confirmation");
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM approvals"), 0, "no approval card of any kind");
    t.queue("claude", "author:bug-ok", "review:pass");
    t.queue("codex", "test-review:pass", "factory-write:bug-fix");
    const confirmed = await confirm(t, env);
    assert.equal(confirmed.envelope.status, "ACTIVE");
    const done = await untilStage(t, missionId, SETTLED, 240000);
    assert.equal(done.factory.stage, "DELIVERY_READY", done.factory.stageReason);
    const stages = events(t, "factory.stage").filter((e) => e.scopeId === missionId).map((e) => e.payload.stage).filter((s, i, all) => s !== all[i - 1]);
    assert.deepEqual(stages, ["SPEC_DRAFT", "TEST_AUTHORING", "TEST_PROVING", "TEST_REVIEW", "BASELINE", "IMPLEMENTING", "CHECKING", "REVIEWING", "QA", "DELIVERY_READY"].slice(1));
    // ONE confirmation: the plan decided the factory.scope approval; nothing wrote the mode; every run used a derived grant of THIS plan.
    assert.equal(events(t, "envelope.confirmed").length, 1);
    const approvals = t.hub.db.prepare("SELECT action_kind, decided_via, decision_note FROM approvals").all().map((x) => ({ ...x }));
    assert.deepEqual(approvals, [{ action_kind: "factory.scope", decided_via: "owner_session", decision_note: `envelope ${env.id}` }]);
    assert.equal(modeEvents(), modeBefore, "the Hub's mode is never written");
    assert.equal(t.hub.settings.get("mode"), "BUILD_SAFE");
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM commands WHERE type IN ('mode.set','grant.create','approval.decide')"), 0);
    const derived = new Set(t.hub.grants.ofEnvelope(env.id).map((g) => g.id));
    const runRows = t.hub.db.prepare("SELECT provider, access, grant_id FROM agent_runs ORDER BY created_at").all();
    assert.equal(runRows.length, 4);
    assert.ok(runRows.every((x) => derived.has(x.grant_id)), "only derived grants");
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM live_grants WHERE envelope_id IS NULL"), 0, "no manual grant");
    const byStage = Object.fromEntries(done.runs.map((x) => [x.dispatchStage, x]));
    assert.deepEqual([byStage.TEST_AUTHORING.provider, byStage.TEST_AUTHORING.access], ["claude", "read-only"]);
    assert.deepEqual([byStage.TEST_REVIEW.provider, byStage.TEST_REVIEW.access], ["codex", "read-only"]);
    assert.deepEqual([byStage.IMPLEMENTING.provider, byStage.IMPLEMENTING.access], ["codex", "workspace-write"]);
    // The test was written by the Hub, proven, reviewed and protected; the base moved; the bundle names its provenance.
    const a = done.authoring;
    assert.deepEqual([a.status, a.proof.verdict, a.testRef], ["PROTECTED", "PROVEN", env.body.testFirst.testRef]);
    assert.ok(fs.existsSync(path.join(p.dir, ...a.testRef.split("/"))));
    assert.deepEqual(done.spec.protected.files, { [a.testRef]: a.protectedSha });
    const manifest = JSON.parse(t.hub.db.prepare("SELECT manifest_json FROM factory_bundles WHERE mission_id = ?").get(missionId).manifest_json);
    assert.equal(manifest.acceptanceTest.ref, a.testRef);
    await waitFor(() => t.hub.envelopes.get(env.id).status === "COMPLETED", 10000);

    // I14 (critique B2): a later bug on the same project is never bound to the Hub-written test (D21 skips test/hub/): step 0 again.
    assert.deepEqual(acceptanceCandidates(p.dir), []);
    const later = await plan(t, { text: "Repară validarea emailului: o adresă fără domeniu trece de validare", projectId: p.id });
    assert.ok(later.plan?.envelope?.body?.testFirst, JSON.stringify(later).slice(0, 300));
    assert.notEqual(later.plan.envelope.body.testFirst.testRef, a.testRef);
    assert.ok(!JSON.stringify(view(t, later.plan.envelope.missionIds[0]).spec.spec.acceptance).includes(a.testRef), "the protected Hub test is not this request's test");
  } finally { await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ I3
test("I3 booking-demo, a FEATURE on a project that already has an acceptance test: test-first, not D21 — the existing test is neither bound nor protected, the ignore comes from .gitignore; a described bug there still binds it", async () => {
  const t = await waveBHub({ fixtures: [["booking-demo", "Demo Livrare L5"]] });
  try {
    const p = t.p["Demo Livrare L5"];
    assert.deepEqual(acceptanceCandidates(p.dir), ["test/acceptance.test.mjs"]);
    const r = await plan(t, { text: "Adaugă filtrarea programărilor după serviciu în lista de sloturi", projectId: p.id });
    assert.equal(r.clarification, undefined);
    const env = r.plan?.envelope;
    assert.ok(env?.body?.testFirst, JSON.stringify(r).slice(0, 400));
    const s = view(t, env.missionIds[0]).spec.spec;
    assert.equal(s.workType, "FEATURE");
    assert.equal(s.authoring.controls, "none", "a FEATURE has no control cases");
    assert.ok(!JSON.stringify(s).includes("test/acceptance.test.mjs"), "the existing acceptance test is not this request's test");
    assert.deepEqual(s.workspace.ignore, ["data"], "from .gitignore (node_modules is never ignored by the spec)");
    assert.deepEqual(s.verification, { checks: ["node --test"], acceptance: [`node --test ${s.authoring.testRef}`], preview: null });
    assert.equal(r.plan.summary.state, "PLAN_READY", JSON.stringify(r.plan.summary.blockers));
    // A described bug on the same project: D21 binds the ONLY acceptance test (no step 0).
    const bug = await plan(t, { text: "Repară afișarea sloturilor ocupate: pe telefon apar ca libere", projectId: p.id });
    assert.equal(bug.plan?.envelope?.body?.testFirst, undefined);
    assert.equal(view(t, bug.plan.envelope.missionIds[0]).spec.spec.acceptance[0].testRef, "test/acceptance.test.mjs");
  } finally { await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ I11
test("I11 the plan's budget: two author cycles (an unreadable answer and a lint refusal) plus two repair cycles under ONE plan never meet a grant refusal — the author's role tops up beyond 5 attempts; the budget is exactly 10 per role", async () => {
  const t = await waveBHub({ fixtures: [["bug-demo-test-first", "Factory Demo L5"], ["bug-demo-test-first", "Factory Demo L5 B"]] });
  try {
    const p = t.p["Factory Demo L5"];
    const r = await plan(t, { text: BUG_TF, projectId: p.id });
    const env = r.plan.envelope;
    const missionId = env.missionIds[0];
    assert.equal(t.hub.envelopes.budgetOf(env.id, missionId), 10);
    t.queue("claude", "ok", "author:bug-tautology", "ok", "author:bug-ok", "review:changes-dedupe", "review:pass");
    t.queue("codex", "test-review:pass", "factory-write:bug-partial", "factory-write:bug-fix", "factory-write:bug-fix-v2");
    await confirm(t, env);
    const done = await untilStage(t, missionId, SETTLED, 300000);
    assert.equal(done.factory.stage, "DELIVERY_READY", done.factory.stageReason);
    assert.deepEqual([done.authoring.cycle, done.factory.repairCycles], [1, 2], "two author cycles, two repair cycles");
    assert.deepEqual(done.dispatches.filter((x) => x.stage === "TEST_AUTHORING").map((x) => [x.request.cycle, x.request.attempt]), [[0, 1], [0, 2], [1, 1], [1, 2]]);
    const stages = events(t, "factory.stage").filter((e) => e.scopeId === missionId).map((e) => e.payload.stage);
    assert.ok(!stages.includes("BLOCKED") && !stages.includes("NEEDS_OWNER_DECISION"), stages.join(" → "));
    assert.equal(events(t, "factory.dispatch_failed").length, 0, "no start refused");
    assert.equal(events(t, "envelope.budget_exhausted").length, 0);
    const grants = t.hub.grants.ofEnvelope(env.id);
    const claude = grants.filter((g) => g.provider === "claude");
    const codex = grants.filter((g) => g.provider === "codex");
    assert.deepEqual([claude.length, claude.reduce((n, g) => n + g.attemptsUsed, 0)], [2, 6], "six Claude turns: the first grant (5) and a top-up");
    assert.deepEqual([codex.length, codex.reduce((n, g) => n + g.attemptsUsed, 0)], [1, 4]);
    assert.ok(events(t, "envelope.grants_derived").some((e) => e.scopeId === env.id && e.payload.topUp === true && e.payload.grants.some((g) => g.role === "reviewer")), "the top-up beyond 5");

    // The whole budget, for one role, with no turn: the first grant (5), a top-up (5), then nothing — exactly 10.
    const q = t.p["Factory Demo L5 B"];
    const r2 = await plan(t, { text: BUG_TF, projectId: q.id });
    const env2 = r2.plan.envelope;
    const m2 = env2.missionIds[0];
    t.queue("claude", "hang");
    await confirm(t, env2);
    await untilRun(t, "claude", m2, "TEST_AUTHORING");
    const writerHash = view(t, m2).factory.bindings.writer.bindingHash;
    const writerGrants = () => t.hub.grants.ofEnvelope(env2.id).filter((g) => g.provider === "codex");
    for (const g of writerGrants()) exhaustGrant(t, g.id);
    assert.equal(t.hub.envelopes.topUp(m2, "writer", writerHash)?.attempts, 5);
    for (const g of writerGrants()) exhaustGrant(t, g.id);
    assert.deepEqual(t.hub.envelopes.topUp(m2, "writer", writerHash), { exhausted: true });
    assert.equal(writerGrants().reduce((n, g) => n + g.maxAttempts, 0), 10, "never more than the card showed: (1 + 2 + 2) × 2");
    await stopMission(t, m2);
  } finally { await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ I13
test("I13 the routing table A–J through intake.plan: bound (A, C, E, G), a plain message or question with nothing kept (B, D, I, J), test-first (F, G, H); ProDelivery, a real project, another route and a test script over the work area are refused", async () => {
  const withLogin = (dir) => fs.writeFileSync(path.join(dir, "test", "login.test.mjs"), "// fictiv\n");
  const t = await waveBHub({ fixtures: [["bug-demo", "Factory Demo L5", withLogin], ["bug-demo-test-first", "Factory Demo Fara Test"], ["bug-demo-test-first", "ProDelivery"]] });
  try {
    const p = t.p["Factory Demo L5"];
    const nt = t.p["Factory Demo Fara Test"];
    const pd = t.p.ProDelivery;
    assert.equal(pd.slug, "prodelivery");
    const real = await realProject(t);
    const drafts = () => count(t, "SELECT COUNT(*) AS n FROM factory_missions");
    const kept = () => count(t, "SELECT COUNT(*) AS n FROM work_requests");
    const specOf = (r) => view(t, r.plan.envelope.missionIds[0]).spec.spec;
    /** A plain answer: no plan, no draft, nothing kept (and no file name the owner did not say). */
    const plain = async (text, projectId, expected, kind = "message") => {
      const before = [drafts(), kept()];
      const r = await plan(t, { text, projectId });
      assert.equal(r.plan, undefined, `${text}: ${JSON.stringify(r).slice(0, 300)}`);
      if (kind === "question") assert.deepEqual([r.clarification?.question, r.clarification?.options], [expected, []], text);
      else { assert.equal(r.message, expected, text); assert.equal(r.clarification, undefined, text); }
      assert.equal(r.workRequest, undefined, `${text}: nothing kept`);
      assert.deepEqual([drafts(), kept()], before, `${text}: no draft, no kept request`);
      return r;
    };
    // A: a named test that exists → bound and protected.
    const A = await plan(t, { text: "Repară validarea numelui; testul e test/unit.test.mjs", projectId: p.id });
    assert.deepEqual([specOf(A).acceptance[0].testRef, specOf(A).authoring, A.plan.envelope.body.testFirst], ["test/unit.test.mjs", undefined, undefined]);
    // B: a named test that does not exist → never replaced by another one.
    await plain("Repară validarea numelui; testul e test/lipsa.test.mjs", p.id, T_ROUTE_MISSING_TEST("test/lipsa.test.mjs"));
    // C: the acceptance test named, the project's only one → bound (probe step D).
    const C = await plan(t, { text: "Repară testul de acceptanță din Factory Demo L5", projectId: p.id });
    assert.equal(specOf(C).acceptance[0].testRef, "test/acceptance.test.mjs");
    assert.match(C.note, /singurul test de acceptanță al proiectului, ales fără întrebare/);
    // D: the acceptance test named, none or several → ONE plain question without file names.
    await plain("Repară testul de acceptanță", nt.id, T_ROUTE_ASK_BEHAVIOUR, "question");
    fs.writeFileSync(path.join(p.dir, "test", "acceptanta-login.test.mjs"), "// fictiv\n");
    await plain("Repară testul de acceptanță din Factory Demo L5", p.id, T_ROUTE_ASK_BEHAVIOUR, "question");
    fs.rmSync(path.join(p.dir, "test", "acceptanta-login.test.mjs"));
    // E: a described bug, the only acceptance test → bound.
    const E = await plan(t, { text: "Repară validarea numelui: spațiile trec de verificare", projectId: p.id });
    assert.equal(specOf(E).acceptance[0].testRef, "test/acceptance.test.mjs");
    // F: „Adaugă un test de acceptanță…” → test-first; the existing acceptance test never bound or protected.
    const F = await plan(t, { text: "Adaugă un test de acceptanță pentru validarea numelui", projectId: p.id });
    assert.ok(F.plan.envelope.body.testFirst && specOf(F).authoring);
    assert.ok(!JSON.stringify(specOf(F)).includes("test/acceptance.test.mjs"));
    // G: a bug naming another test → the one file with that topic (named by its topic on the card, never by its path) …
    const G = await plan(t, { text: "Repară testul de login care pică", projectId: p.id });
    assert.equal(specOf(G).acceptance[0].testRef, "test/login.test.mjs");
    assert.match(G.note, /Testul automat despre „login” \(singurul test al proiectului cu acest nume, ales fără întrebare\) devine testul de acceptanță și e protejat/);
    assert.doesNotMatch(G.note, /\.mjs/);
    // … no file with it → test-first.
    const G2 = await plan(t, { text: "Repară testul de export care pică", projectId: p.id });
    assert.ok(G2.plan.envelope.body.testFirst);
    // H: any other bug / feature → test-first, no question.
    const H = await plan(t, { text: "Adaugă verificarea emailului în formular", projectId: p.id });
    assert.ok(H.plan.envelope.body.testFirst && !H.clarification);
    // I: a refactor with no test → the characterization test is L5b.
    await plain("Refactorizează validarea solicitărilor", p.id, T_ROUTE_REFACTOR);
    // J: ProDelivery (a test project by registration, named explicitly), a real project, another route, a test script over the work area.
    await plain("Repară validarea numelui: spațiile trec de verificare", pd.id, T1("ProDelivery"));
    await plain("Adaugă verificarea emailului în formular", real.id, T1("Client Real"));
    const routeOf = t.hub.factoryRunner.routeOf;
    t.hub.factoryRunner.routeOf = (project) => (project?.id === nt.id ? "wsl-runner" : routeOf(project));
    // Review wave B (authority #4): a TEST project on another route → the route is the reason (T1_ROUTE), not „proiectele reale”.
    try { await plain("Repară validarea numelui: spațiile trec de verificare", nt.id, T1_ROUTE("Factory Demo Fara Test")); } finally { t.hub.factoryRunner.routeOf = routeOf; }
    const pkg = path.join(nt.dir, "package.json");
    const original = fs.readFileSync(pkg, "utf8");
    fs.writeFileSync(pkg, JSON.stringify({ ...JSON.parse(original), scripts: { test: "node --test test .ifrim-hub" } }));
    try {
      const r = await plain("Repară validarea numelui: spațiile trec de verificare", nt.id, "Pe Factory Demo Fara Test comanda de teste a proiectului rulează și zona de lucru a Hub-ului, așa că un test scris de Hub ar rula înainte să fie verificat; acum nu pot propune planul. Nu trebuie să scrii sau să numești niciun test. Nimic nu e păstrat.");
      assert.doesNotMatch(r.message, NO_FILE);
    } finally { fs.writeFileSync(pkg, original); }
    // B on a real project / for a refactor: the missing test is said, then why the Hub cannot write it there.
    await plain("Repară validarea numelui; testul e test/lipsa.test.mjs", real.id, `Nu găsesc testul „test/lipsa.test.mjs”; nu îl înlocuiesc cu altul. ${T1("Client Real", { neutral: true })}`);
    await plain("Refactorizează validarea; testul e test/lipsa.test.mjs", p.id, `Nu găsesc testul „test/lipsa.test.mjs”; nu îl înlocuiesc cu altul. ${T_ROUTE_REFACTOR}`);
    assert.ok(T_ROUTE_MISSING_TEST("x").startsWith("Nu găsesc testul „x”; nu îl înlocuiesc cu altul. "), "the same first sentence as route B");

    // The factory refuses the same with a hand-made spec (critique B3), and the plan card shows it as a blocker (test_first_scope).
    for (const target of [pd, real]) {
      const mission = (await dispatch(t.hub, "factory.prepare", { projectId: target.id, ...demoSpec("bug-demo-test-first", { projectId: target.id }), limits: HAND_MODELS })).result.mission;
      const v = view(t, mission.id);
      assert.ok(v.scope, JSON.stringify(v.scopeProblems));
      const blockers = t.hub.envelopes.readiness(t.hub.projects.get(target.id), [v]).blockers;
      assert.ok(blockers.some((x) => x.id === "test_first_scope" && x.detail === T1(target.name)), JSON.stringify(blockers));
      const proposal = await t.hub.envelopes.propose({ projectId: target.id, missionIds: [mission.id] });
      assert.notEqual(proposal.summary.state, "PLAN_READY");
      assert.ok(proposal.summary.blockers.includes(T1(target.name)), JSON.stringify(proposal.summary.blockers));
      const requested = await dispatch(t.hub, "factory.start", v.scope);
      await dispatch(t.hub, "approval.decide", { approvalId: requested.approval.id, decision: "approved", displayedHash: requested.approval.payloadHash });
      await assert.rejects(t.hub.commands.executeApproved(requested.command.id, "user"), (e) => e.message === T1(target.name) && e.code === "TEST_FIRST_SCOPE");
      assert.equal(view(t, mission.id).factory.stage, "SPEC_DRAFT", "nothing started");
    }
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM agent_runs"), 0, "nothing ran");
  } finally { await t.cleanup(); }
});

test("I13 the same table through typed input (owner.intent) and Lega's propose_mission: test-first card, T1, the refactor and the missing test said once, nothing kept, no approval card", async () => {
  const calls = [
    { tool: "propose_mission", args: { project: "Factory Demo L5", kind: "eng_feature", title: "Verificarea emailului", objective: "Adaugă verificarea emailului în formularul de solicitare" } },
    { tool: "propose_mission", args: { project: "ProDelivery", kind: "eng_bugfix", title: "Validarea numelui", objective: "Repară validarea numelui: spațiile trec de verificare" } },
    { tool: "propose_mission", args: { project: "Factory Demo L5", kind: "eng_refactor", title: "Curățenie", objective: "Refactorizează validarea solicitărilor" } },
    { tool: "propose_mission", args: { project: "Factory Demo L5", kind: "eng_bugfix", title: "Validare", objective: "Repară validarea numelui; testul e test/lipsa.test.mjs" } },
  ];
  const t = await waveBHub({ codex: `lega-calls:${b64(calls)}`, fixtures: [["bug-demo-test-first", "Factory Demo L5"], ["bug-demo-test-first", "ProDelivery"]] });
  try {
    const p = t.p["Factory Demo L5"];
    const pd = t.p.ProDelivery;
    // Typed in the owner session.
    const typed = async (text, projectId) => (await asOwner(t, { text, projectId })).results.find((x) => x.intent === "engineering_request");
    const h = await typed("Adaugă validarea emailului în formular", p.id);
    assert.ok(h?.plan?.envelope?.body?.testFirst, JSON.stringify(h).slice(0, 300));
    assert.equal(h.clarification, undefined);
    const j = await typed("Repară validarea numelui: spațiile trec de verificare", pd.id);
    assert.equal(j.message, T1("ProDelivery"));
    const i = await typed("Refactorizează validarea solicitărilor", p.id);
    assert.equal(i.message, T_ROUTE_REFACTOR);
    const b = await typed("Repară validarea numelui; testul e test/lipsa.test.mjs", p.id);
    assert.equal(b.message, T_ROUTE_MISSING_TEST("test/lipsa.test.mjs"));
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM work_requests"), 0, "nothing kept");
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM factory_missions WHERE mission_id IN (SELECT id FROM missions WHERE project_id = ?)", pd.id), 0);

    // Lega's propose_mission under voice-first (a session derived from the owner session): the same planner, never an approval card.
    t.hub.bus.transaction(() => t.hub.settings.set("legaConsent", { version: LEGA_CONSENT_VERSION, confirmedAt: new Date().toISOString() }, "test"));
    t.hub.refreshCodexConfig();
    const plansBefore = count(t, "SELECT COUNT(*) AS n FROM mission_envelopes");
    const s = (await t.hub.commands.dispatch({ type: "lega.session.start", channel: "owner", actor: `owner:${t.owner.session.id}`, ownerSession: t.owner.session, payload: { sdp: OFFER } })).result;
    await t.hub.commands.dispatch({ type: "lega.session.connected", channel: "ui", actor: "user", payload: { sessionId: s.sessionId } });
    await waitFor(() => t.readLog("codex").some((l) => l.callsDone), 30000);
    const replies = t.readLog("codex").filter((l) => l.toolReply && l.tool === "propose_mission").map((l) => l.toolReply.contentItems?.[0]?.text || "");
    assert.equal(replies.length, 4, JSON.stringify(replies));
    assert.ok(replies[1].includes(T1("ProDelivery")), replies[1]);
    assert.ok(replies[2].includes(T_ROUTE_REFACTOR), replies[2]);
    assert.ok(replies[3].includes(T_ROUTE_MISSING_TEST("test/lipsa.test.mjs")), replies[3]);
    const lega = t.hub.db.prepare("SELECT body_json FROM mission_envelopes ORDER BY created_at DESC LIMIT 1").get();
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM mission_envelopes"), plansBefore + 1, "ONE plan: the feature's");
    const body = JSON.parse(lega.body_json);
    assert.ok(body.testFirst?.testRef, "the feature became a test-first plan");
    assert.equal(body.missions[0].workType, "FEATURE");
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM approvals"), 0, "no approval card");
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM commands WHERE type = 'lega.propose_mission'"), 0);
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM work_requests"), 0, "nothing kept");
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM agent_runs WHERE provider = 'claude'"), 0, "nothing ran");
  } finally { await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ I14
test("I14 probe step D still binds the existing acceptance test with no step 0; a programmer's path within 2 minutes replans (after them, it is a new request); a Hub-written test is never bound by D21 or by topic", async () => {
  // Real time plus an offset the test moves (the billing declarations of the fixture accounts are written at real time).
  const offset = { ms: 0 };
  const t = await waveBHub({ fixtures: [["bug-demo", "Factory Demo M10.2"]], clock: () => new Date(Date.now() + offset.ms) });
  try {
    const p = t.p["Factory Demo M10.2"];
    // Probe step D (typed, as the owner said it live): the existing acceptance test, bound and protected; no step 0 anywhere.
    const out = await asOwner(t, { text: "Repară testul de acceptanță din Factory Demo M10.2" });
    const step = out.results.find((x) => x.intent === "engineering_request");
    const env = step?.plan?.envelope;
    assert.ok(env?.id, JSON.stringify(out.results).slice(0, 400));
    const s = view(t, env.missionIds[0]);
    assert.deepEqual([s.spec.spec.acceptance[0].testRef, s.spec.spec.authoring, env.body.testFirst, s.factory.limits.maxDurationMin], ["test/acceptance.test.mjs", undefined, undefined, 120]);
    assert.ok(!env.body.allowedEffects.includes(TEST_FIRST_EFFECT));
    assert.ok(step.plan.summary.steps.startsWith("Implementare (Codex)"), step.plan.summary.steps);
    assert.equal(step.plan.summary.testFirst, undefined);
    assert.match(step.note, /e protejat: writer-ul repară implementarea, nu testul/);

    // The 2-minute window after a test-first card: a programmer's bare path rebuilds the plan with THAT file; the test-first plan is
    // replaced and its draft (made by the planner, never started) withdrawn.
    const tf = await plan(t, { text: "Adaugă verificarea emailului în formular", projectId: p.id });
    const tfEnv = tf.plan.envelope;
    assert.ok(tfEnv.body.testFirst);
    const replanned = await plan(t, { text: "test/unit.test.mjs", projectId: p.id });
    const rv = view(t, replanned.plan.envelope.missionIds[0]);
    assert.deepEqual([rv.spec.spec.acceptance[0].testRef, rv.spec.spec.objective, replanned.plan.envelope.body.testFirst], ["test/unit.test.mjs", "Adaugă verificarea emailului în formular", undefined]);
    assert.equal(t.hub.envelopes.get(tfEnv.id).status, "SUPERSEDED");
    await waitFor(() => view(t, tfEnv.missionIds[0]).factory.stage === "CANCELLED", 10000);
    // After the 2 minutes the same path is a request of its own (it no longer completes the earlier words).
    const again = await plan(t, { text: "Adaugă validarea numelui în formular", projectId: p.id });
    assert.ok(again.plan.envelope.body.testFirst);
    offset.ms += 2 * 60 * 1000 + 1000;
    const late = await plan(t, { text: "test/unit.test.mjs", projectId: p.id });
    assert.equal(view(t, late.plan.envelope.missionIds[0]).spec.spec.objective, "test/unit.test.mjs", "not the earlier request");
  } finally { await t.cleanup(); }

  // A Hub-written test under test/hub/ (an earlier mission's, even one whose name says acceptance or holds the topic) is never bound.
  const a = fixtureCopy("bug-demo");
  try {
    fs.mkdirSync(path.join(a.dir, "test", "hub"), { recursive: true });
    fs.writeFileSync(path.join(a.dir, "test", "hub", "acceptance-nume-a1b2c3.test.mjs"), "// scris de Hub\n");
    fs.writeFileSync(path.join(a.dir, "test", "hub", "repara-login-d4e5f6.test.mjs"), "// scris de Hub\n");
    const project = { path: a.dir };
    assert.deepEqual(acceptanceCandidates(a.dir), ["test/acceptance.test.mjs"], "test/hub/ is not a candidate");
    const e = buildEngineeringSpec({ text: "Repară validarea numelui: spațiile trec de verificare", project });
    assert.deepEqual([e.route, e.testRef, e.autoBound], ["E", "test/acceptance.test.mjs", "described"], "D21 still binds the project's own acceptance test");
    assert.deepEqual(topicCandidates(a.dir, "login"), []);
    const g = buildEngineeringSpec({ text: "Repară testul de login care pică", project });
    assert.deepEqual([g.route, g.testRef], ["G", null]);
    assert.ok(g.testFirst?.ok, "no topic binding to a Hub-written test: the Hub writes a new one");
    fs.rmSync(path.join(a.dir, "test", "acceptance.test.mjs"));
    const h = buildEngineeringSpec({ text: "Repară validarea numelui: spațiile trec de verificare", project });
    assert.deepEqual([h.route, h.testRef], ["H", null], "only a Hub-written acceptance-named test left: never bound");
    assert.ok(h.testFirst?.ok);
  } finally { a.cleanup(); }
});

test("I14 pure routing details: the topic a request names, a 2nd and 3rd path for the Hub's test, the Hub's own leftover staging file reused only at its recorded bytes", () => {
  assert.equal(namedTopic("repara testul de login care pica"), "login");
  assert.equal(namedTopic("repara testul nou de export"), "export");
  assert.equal(namedTopic("repara testele care pica"), null);
  assert.equal(namedTopic("repara testul de acceptanta"), null);
  assert.equal(namedTopic("repara bugul de la pagina principala"), null);
  const a = fixtureCopy("bug-demo-test-first");
  try {
    const project = { path: a.dir, id: "prj_l5b" };
    const first = buildEngineeringSpec({ text: BUG_TF, project });
    assert.equal(first.route, "H");
    const { testRef, stagingRef } = first.testFirst;
    // An unknown file on the staging path: the next path is chosen (-2); with the Hub's own recorded bytes there: reused.
    const staging = path.join(a.dir, ...stagingRef.split("/"));
    fs.mkdirSync(path.dirname(staging), { recursive: true });
    fs.writeFileSync(staging, "// necunoscut\n");
    const second = buildEngineeringSpec({ text: BUG_TF, project });
    assert.equal(second.testFirst.testRef, testRef.replace(/\.test\.mjs$/, "-2.test.mjs"));
    assert.equal(second.testFirst.stagingRef, stagingRef.replace(/\.mjs$/, "-2.mjs"));
    const recorded = { [stagingRef]: sha256(fs.readFileSync(staging)) };
    const reused = buildEngineeringSpec({ text: BUG_TF, project, hubWrites: recorded });
    assert.deepEqual([reused.testFirst.testRef, reused.testFirst.stagingRef], [testRef, stagingRef]);
    // A file already at the final path: never overwritten — the next path.
    fs.mkdirSync(path.join(a.dir, "test", "hub"), { recursive: true });
    fs.writeFileSync(path.join(a.dir, ...testRef.split("/")), "// ocupat\n");
    assert.equal(buildEngineeringSpec({ text: BUG_TF, project, hubWrites: recorded }).testFirst.testRef, testRef.replace(/\.test\.mjs$/, "-2.test.mjs"));
  } finally { a.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ PAUSABLE / advance
test("step 0 under a plan: Pause makes the plan WAITING_OWNER and a resume into TEST_AUTHORING makes it ACTIVE again (advance); a revoked plan pauses a mission that writes its test (PAUSABLE)", async () => {
  const t = await waveBHub();
  try {
    const p = t.p["Factory Demo L5"];
    const r = await plan(t, { text: BUG_TF, projectId: p.id });
    const env = r.plan.envelope;
    const missionId = env.missionIds[0];
    t.queue("claude", "hang", "hang");
    await confirm(t, env);
    await untilRun(t, "claude", missionId, "TEST_AUTHORING");
    await dispatch(t.hub, "factory.pause", { missionId }, { channel: "ui" });
    await untilStage(t, missionId, ["PAUSED"]);
    await noRuns(t);
    await waitFor(() => t.hub.envelopes.get(env.id).status === "WAITING_OWNER", 10000);
    await dispatch(t.hub, "factory.resume", { missionId }, { channel: "ui" });
    await untilRun(t, "claude", missionId, "TEST_AUTHORING");
    await waitFor(() => t.hub.envelopes.get(env.id).status === "ACTIVE", 10000);
    // The owner revokes the plan while the test is being written: its grants go and the mission pauses (the turn is interrupted).
    await dispatch(t.hub, "envelope.revoke", { envelopeId: env.id, reason: "test" }, { channel: "owner", ownerSession: t.owner.session });
    await untilStage(t, missionId, ["PAUSED"], 20000);
    await noRuns(t);
    // Recorded once factory.pause has finished interrupting the turn (after the stage already shows PAUSED).
    await waitFor(() => events(t, "envelope.mission_paused").some((e) => e.scopeId === env.id && e.payload.from === "TEST_AUTHORING"), 15000);
    assert.ok(t.hub.grants.ofEnvelope(env.id).every((g) => g.status !== "active"));
    await stopMission(t, missionId);
  } finally { await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ Lega
test("Lega's instructions (§7): no acceptance test → the plan's step 0 is the Hub writing it; never ask the owner to name, pick or write a test file — in the legacy ENGINEERING line and in ONE QUESTION", () => {
  const rule = "If no acceptance test exists, the plan's step 0 is the Hub writing it from the owner's words; never ask the owner to name, pick or write a test file.";
  const legacy = legaAgentInstructions({});
  const voiceFirst = legaAgentInstructions({ voiceFirst: true });
  assert.ok(legacy.split("\n").find((l) => l.startsWith("ENGINEERING (Software Factory):")).includes(rule));
  assert.doesNotMatch(legacy, /the owner completes the spec/);
  assert.ok(voiceFirst.split("\n").find((l) => l.startsWith("ONE QUESTION:")).endsWith(rule));
  assert.ok(voiceFirst.split("\n").some((l) => l.startsWith("PREVIEW:")) && voiceFirst.split("\n").some((l) => l.startsWith("DESKTOP:")), "the other batch's lines are kept");
});

// ------------------------------------------------------------------------------------------------------------------------------ review repairs (wave B)
test("review flow #1: after a test-first card, the answer to the resolver's project question („Factory Demo Beta”) is a NEW request on that project — never a test named after the project's id, never the old request replanned elsewhere; a bare path counts only on the same project", async () => {
  const t = await waveBHub({ fixtures: [["bug-demo-test-first", "Factory Demo L5"], ["bug-demo", "Factory Demo Beta"]] });
  try {
    const p = t.p["Factory Demo L5"];
    const beta = t.p["Factory Demo Beta"];
    const eng = (out) => out.results.find((x) => x.intent === "engineering_request");
    const first = eng(await asOwner(t, { text: BUG_TF, projectId: p.id }));
    assert.ok(first?.plan?.envelope?.body?.testFirst, JSON.stringify(first).slice(0, 300));
    const asked = eng(await asOwner(t, { text: "Repară bug-ul de login din Factory Demo M10.3" }));
    assert.match(asked?.message || "", /Te referi la Factory Demo Beta sau Factory Demo L5\?/, JSON.stringify(asked).slice(0, 300));
    const answered = eng(await asOwner(t, { text: "Factory Demo Beta" }));
    assert.ok(answered?.plan?.envelope, JSON.stringify(answered).slice(0, 400));
    assert.doesNotMatch(JSON.stringify(answered), /Nu găsesc testul|„prj_/, "the project's id is never read as a test name");
    assert.equal(answered.plan.envelope.projectId, beta.id);
    const s = view(t, answered.plan.envelope.missionIds[0]).spec.spec;
    assert.equal(s.objective, "Repară bug-ul de login din Factory Demo M10.3", "the owner's NEW request, not the first one");
    const objectives = (projectId) => t.hub.factory.list().filter((f) => f.projectId === projectId).map((f) => view(t, f.missionId).spec.spec.objective);
    assert.ok(!objectives(beta.id).includes(BUG_TF), "the first request is not replanned on Beta");
    // A bare path said within the 2 minutes, but with another project in focus: not an answer to the L5 request.
    const again = eng(await asOwner(t, { text: BUG_TF, projectId: p.id }));
    assert.ok(again?.plan?.envelope?.body?.testFirst);
    const before = objectives(p.id).length;
    await plan(t, { text: "test/unit.test.mjs", projectId: beta.id });
    assert.equal(objectives(p.id).length, before, "no L5 draft replanned from Beta");
    assert.ok(!objectives(beta.id).includes(BUG_TF));
  } finally { await t.cleanup(); }
});

test("review flow #2: the route D question and the route B message say how to answer with a sentence the resolver sends to the planner; answering D that way (typed) gives the test-first card", async () => {
  const ctx = { projects: [], currentProjectId: "prj_x", missions: [], departments: [], pendingEnvelopes: [] };
  for (const example of [T_ROUTE_EXAMPLE_FIX, T_ROUTE_EXAMPLE_ADD]) assert.deepEqual(resolveIntent(example, ctx).steps.map((x) => x.intent), ["engineering_request"], example);
  assert.ok(T_ROUTE_ASK_BEHAVIOUR.includes(`„${T_ROUTE_EXAMPLE_FIX}”`) && T_ROUTE_MISSING_TEST("x").includes(`„${T_ROUTE_EXAMPLE_FIX}”`) && T_ROUTE_MISSING_TEST("x").includes(`„${T_ROUTE_EXAMPLE_ADD}”`));
  assert.doesNotMatch(T_ROUTE_ASK_BEHAVIOUR + T_ROUTE_MISSING_TEST("x"), /\.mjs|test\/hub/);
  const t = await waveBHub();
  try {
    const p = t.p["Factory Demo L5"];
    const eng = (out) => out.results.find((x) => x.intent === "engineering_request");
    const d = eng(await asOwner(t, { text: "Repară testul de acceptanță", projectId: p.id }));
    assert.equal(d?.message, T_ROUTE_ASK_BEHAVIOUR, JSON.stringify(d).slice(0, 300));
    const answer = eng(await asOwner(t, { text: "Repară bug-ul: un nume format doar din spații trece de validare", projectId: p.id }));
    assert.ok(answer?.plan?.envelope?.body?.testFirst, JSON.stringify(answer).slice(0, 400));
    assert.equal(view(t, answer.plan.envelope.missionIds[0]).spec.spec.workType, "BUGFIX");
  } finally { await t.cleanup(); }
});

test("review flow #3, #4, #7 and authority #1 (pure planner): Lega's template type is a hint; „Fă testul de acceptanță să treacă” binds the existing test; a test-first criterion is the owner's words; a topic matches a whole word of the file name", () => {
  assert.deepEqual(["eng_bugfix", "eng_feature", "eng_refactor", "ENG_REFACTOR"].map((k) => workTypeOf("Curățenie în cod", k)), ["BUGFIX", "FEATURE", "REFACTOR", "REFACTOR"]);
  const tf = fixtureCopy("bug-demo-test-first");
  try {
    const project = { path: tf.dir, id: "prj_l5r" };
    const refactor = buildEngineeringSpec({ text: "Curățenie. Simplifică funcția de validare", args: { missionKind: "eng_refactor" }, project });
    assert.deepEqual([refactor.workType, refactor.route, refactor.testFirst], ["REFACTOR", "I", null], "a refactor never becomes a test-first plan");
    const bug = buildEngineeringSpec({ text: "Validare. Numele format doar din spații trece de validare", args: { missionKind: "eng_bugfix" }, project });
    assert.deepEqual([bug.workType, bug.route, bug.testFirst?.ok], ["BUGFIX", "H", true]);
    // #7: the Hub-written test's criterion is the owner's words (design §2), without the „Cerința ta este îndeplinită:” prefix.
    const h = buildEngineeringSpec({ text: BUG_TF, project });
    assert.equal(h.input.spec.acceptance[0].text, BUG_TF);
    assert.equal(T_CARD_PROVES([{ id: "AC-1", text: h.input.spec.acceptance[0].text }]), `Ce va dovedi testul: AC-1 — „${BUG_TF}”.`);
  } finally { tf.cleanup(); }
  const bd = fixtureCopy("bug-demo");
  try {
    const project = { path: bd.dir, id: "prj_l5r2" };
    for (const text of ["Fă testul de acceptanță să treacă", "Fă testul de acceptanță să fie verde", "Make the acceptance test pass"]) {
      const r = buildEngineeringSpec({ text, project });
      assert.deepEqual([r.route, r.testRef, r.testFirst], ["C", "test/acceptance.test.mjs", null], text);
    }
    const create = buildEngineeringSpec({ text: "Adaugă un test de acceptanță care să treacă doar când numele e valid", project });
    assert.equal(create.route, "F", "„care să treacă” after the noun still creates a test");
    // #7: a bound (existing) test keeps its criterion byte for byte (U1).
    const e = buildEngineeringSpec({ text: "Repară validarea numelui: spațiile trec de verificare", project });
    assert.equal(e.input.spec.acceptance[0].text, "Cerința ta este îndeplinită: Repară validarea numelui: spațiile trec de verificare");
  } finally { bd.cleanup(); }
  // Authority #1: „testul de log” never binds catalog.test.mjs; a whole word (or, from 4 letters, the start of one) does.
  for (const [name, topic, holds] of [["catalog.test.mjs", "log", false], ["log.test.mjs", "log", true], ["logout.test.mjs", "log", false], ["api-log.test.mjs", "log", true],
    ["logins.test.mjs", "login", true], ["login_flow.test.mjs", "login", true], ["relogin.test.mjs", "login", false], ["export.test.mjs", "exp", false]]) assert.equal(nameHoldsTopic(name, topic), holds, `${name} / ${topic}`);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ifrim-l5r-"));
  try {
    fs.mkdirSync(path.join(root, "test"), { recursive: true });
    fs.writeFileSync(path.join(root, "test", "catalog.test.mjs"), "// fictiv\n");
    assert.deepEqual(topicCandidates(root, "log"), []);
    const g = buildEngineeringSpec({ text: "Repară testul de log care pică", project: { path: root, id: "prj_l5r3" } });
    assert.deepEqual([g.route, g.testRef, g.autoBound], ["G", null, null], "no unrelated test protected without asking");
    assert.ok(g.testFirst?.ok);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("review authority #4, #5: T1 names the real reason (a test project on another route; „not a single test” when tests may exist), and a test script over the work area is refused by readiness and by factory.start too, not only by the planner", async () => {
  const t = await waveBHub({ fixtures: [["bug-demo-test-first", "Factory Demo Fara Test"]] });
  try {
    const nt = t.p["Factory Demo Fara Test"];
    assert.match(T1_ROUTE("X"), /^Pe X nu există încă un test automat care să arate când cerința e gata\. Proiectul lucrează în alt mediu decât Windows/);
    assert.doesNotMatch(T1_ROUTE("X"), /proiectele reale/);
    assert.match(T1("X", { neutral: true }), /^Pe X nu găsesc un singur test automat care să arate când cerința e gata\./);
    // The test project on another route, through the planner: the route is the reason.
    const routeOf = t.hub.factoryRunner.routeOf;
    t.hub.factoryRunner.routeOf = (project) => (project?.id === nt.id ? "wsl-runner" : routeOf(project));
    try { assert.equal((await plan(t, { text: BUG_TF, projectId: nt.id })).message, T1_ROUTE(nt.name)); } finally { t.hub.factoryRunner.routeOf = routeOf; }
    // Route D on a real project with two acceptance tests: the opening does not claim that none exists.
    const real = await realProject(t);
    for (const f of ["acceptance.test.mjs", "acceptanta-login.test.mjs"]) fs.writeFileSync(path.join(real.dir, "test", f), "// fictiv\n");
    const d = await plan(t, { text: "Repară testul de acceptanță", projectId: real.id });
    assert.equal(d.message, T1("Client Real", { neutral: true }));
    // The test script over the Hub's work area, with a hand-made spec: the plan card shows it, and factory.start refuses it.
    const pkg = path.join(nt.dir, "package.json");
    fs.writeFileSync(pkg, JSON.stringify({ ...JSON.parse(fs.readFileSync(pkg, "utf8")), scripts: { test: "node --test test .ifrim-hub" } }));
    const mission = (await dispatch(t.hub, "factory.prepare", { projectId: nt.id, ...demoSpec("bug-demo-test-first", { projectId: nt.id }), limits: HAND_MODELS })).result.mission;
    const v = view(t, mission.id);
    assert.ok(v.scope, JSON.stringify(v.scopeProblems));
    const blockers = t.hub.envelopes.readiness(t.hub.projects.get(nt.id), [v]).blockers;
    assert.ok(blockers.some((x) => x.id === "test_first_scope" && x.detail === T_SCRIPT_RUNS_STAGING(nt.name)), JSON.stringify(blockers));
    const requested = await dispatch(t.hub, "factory.start", v.scope);
    await dispatch(t.hub, "approval.decide", { approvalId: requested.approval.id, decision: "approved", displayedHash: requested.approval.payloadHash });
    await assert.rejects(t.hub.commands.executeApproved(requested.command.id, "user"), (e) => e.message === T_SCRIPT_RUNS_STAGING(nt.name) && e.code === "TEST_FIRST_SCOPE");
    assert.equal(view(t, mission.id).factory.stage, "SPEC_DRAFT", "nothing started");
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM agent_runs"), 0, "nothing ran");
  } finally { await t.cleanup(); }
});

test("review flow #6, authority #2, #3: during step 0 the cockpit's summary and activity carry the stage in words; a continuation names the stage in words; a spec without a rewrite gets a card without that promise", async () => {
  const t = await waveBHub({ fixtures: [["bug-demo-test-first", "Factory Demo L5"], ["bug-demo-test-first", "Factory Demo L5 B"]] });
  try {
    const p = t.p["Factory Demo L5"];
    const r = await plan(t, { text: BUG_TF, projectId: p.id });
    const env = r.plan.envelope;
    const missionId = env.missionIds[0];
    t.queue("claude", "ok", "ok", "hang");
    await confirm(t, env);
    const stuck = await untilStage(t, missionId, SETTLED);
    assert.equal(stuck.factory.stage, "NEEDS_OWNER_DECISION", stuck.factory.stageReason);
    const c = await t.hub.cockpit.projectCockpit(p.id);
    const items = JSON.parse(JSON.stringify(c), (k, v) => v);
    const found = [];
    const walk = (x) => { if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === "object") { if (x.missionId === missionId && "stage" in x) found.push(x); Object.values(x).forEach(walk); } };
    walk(items);
    assert.ok(found.length > 0, JSON.stringify(c).slice(0, 600));
    for (const x of found) assert.equal(x.stageLabel, factoryStageLabel(x.stage), JSON.stringify(x));
    // A continuation plan (the first plan expired while the mission waits): headline and „Rămân:” in words, never the stage's code.
    await waitFor(() => t.hub.envelopes.get(env.id).status === "WAITING_OWNER", 10000);
    t.hub.db.prepare("UPDATE mission_envelopes SET expires_at = ? WHERE id = ?").run(new Date(Date.now() - 1000).toISOString(), env.id);
    t.hub.envelopes.tick();
    assert.equal(t.hub.envelopes.get(env.id).status, "EXPIRED");
    const cont = await t.hub.envelopes.propose({ projectId: p.id, missionIds: [missionId] });
    assert.ok(cont.envelope, JSON.stringify(cont.summary));
    assert.ok(cont.summary.headline.startsWith("Continuare: ") && cont.summary.headline.endsWith(`(din etapa „${factoryStageLabel("NEEDS_OWNER_DECISION")}”)`), cont.summary.headline);
    assert.match(cont.summary.continuation.remaining, /plus o încercare pentru etapa „Testul \(pasul 0\)”/);
    assert.doesNotMatch(cont.summary.headline + cont.summary.continuation.remaining, /TEST_AUTHORING|NEEDS_OWNER_DECISION/);
    await stopMission(t, missionId);

    // Activity while the author writes: the stage in words next to its code.
    const q = t.p["Factory Demo L5 B"];
    const r2 = await plan(t, { text: BUG_TF, projectId: q.id });
    t.queue("claude", "hang");
    await confirm(t, r2.plan.envelope);
    const m2 = r2.plan.envelope.missionIds[0];
    await untilRun(t, "claude", m2, "TEST_AUTHORING");
    const active = t.hub.cockpit.status({ projectId: q.id }).missions.find((x) => x.missionId === m2);
    assert.deepEqual([active.stage, active.stageLabel], ["TEST_AUTHORING", "Testul (pasul 0)"]);
    await stopMission(t, m2);
  } finally { await t.cleanup(); }

  // Authority #3: a hand-made test-first spec with reauthorMax 0 → the plan's card does not promise the rewrite.
  const u = await waveBHub({ fixtures: [["bug-demo-test-first", "Factory Demo L5"]] });
  try {
    const p = u.p["Factory Demo L5"];
    const spec = demoSpec("bug-demo-test-first", { projectId: p.id });
    spec.spec.authoring = { ...spec.spec.authoring, reauthorMax: 0 };
    const mission = (await dispatch(u.hub, "factory.prepare", { projectId: p.id, ...spec, limits: HAND_MODELS })).result.mission;
    assert.equal(view(u, mission.id).spec.spec.authoring.reauthorMax, 0);
    const proposal = await u.hub.envelopes.propose({ projectId: p.id, missionIds: [mission.id] });
    assert.equal(proposal.summary.testFirst.step0, T_CARD_STEP0_NO_REWRITE);
    assert.equal(proposal.envelope.body.testFirst.reauthorMax, 0);
  } finally { await u.cleanup(); }
});
