// M11 L5 wave A — step 0 of a test-first plan inside the Software Factory (v2/server/factory/factory.mjs; design .ifrim/M11_L5_DESIGN.md
// §3–§6, §8): the integration scenarios I1, I2, I4–I12 and U11 on temp copies of the bug-demo / service-request fixtures, with test-first
// specs made by hand (the planner that builds them is wave B). PASS_SIMULATED: the fake Claude Code (author:<name>, review:<name>), the
// fake Codex (test-review:<name>, factory-write:<name>), the real `node --test` through the fake-codex sandbox, the software
// authenticator and test clocks — no model, no network, no live Hub. A "crash" is simulated the way M03-FAC-10 does it: the Hub closes
// with the rows a crash leaves at that point, then a new Hub boots on the same data.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeTestHub, enableLive, waitFor, enrolOwner, prepareLiveWithoutGrants } from "./helpers.mjs";
import { createHub } from "../server/hub.mjs";
import { materializeFixture, demoSpec } from "../server/factory/fixtures.mjs";
import { ACTIVE_STAGES, STAGE_ZERO, ROLE_OF_STAGE, FACTORY_STAGES, TURN_RETRY_COOLDOWN_MS } from "../server/factory/factory.mjs";
import { plannedTestRefs, deriveIgnore, T1, T1_ROUTE, T_STAGE, T_ALREADY_PASSES, T_STOP_STAGE0, T_NOT_HERMETIC, T_PROJECT_CHANGED, T_LINT, T_WRONG_REASON,
  T_REVIEW_INCONCLUSIVE, PROOF_CAUSES, REVIEW_CAUSES } from "../server/factory/test-first.mjs";
import { sha256 } from "../server/core/canonical.mjs";

const MODELS = { writerModel: "gpt-fake-sol", reviewerModel: "sonnet" };
const SETTLED = ["DELIVERY_READY", "NEEDS_OWNER_DECISION", "BLOCKED", "PAUSED", "CANCELLED", "ACCEPTED", "REJECTED"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dispatch = (hub, type, payload, channel = "test", extra = {}) => hub.commands.dispatch({ type, payload, channel, actor: "test", ...extra });
const view = (t, id) => t.hub.factory.view(id);
const untilStage = (t, id, stages, ms = 120000) => waitFor(() => (stages.includes(view(t, id).factory.stage) ? view(t, id) : null), ms, 50);
const untilWait = (t, id, waitReason, ms = 60000) => waitFor(() => (view(t, id).factory.waitReason === waitReason ? view(t, id) : null), ms, 30);
const idle = (t, id) => Promise.race([t.hub.factory.idle(id), new Promise((_, reject) => setTimeout(() => reject(new Error("factory.idle() did not settle")), 60000).unref())]);
const events = (t, type, missionId = null) => t.hub.db.prepare(`SELECT payload_json, run_id FROM events WHERE type = ?${missionId ? " AND scope_id = ?" : ""} ORDER BY seq`)
  .all(...(missionId ? [type, missionId] : [type])).map((r) => ({ ...JSON.parse(r.payload_json || "{}"), _run: r.run_id }));
const stagesOf = (t, missionId) => events(t, "factory.stage", missionId).map((e) => e.stage).filter((s, i, all) => s !== all[i - 1]);
const stageDispatches = (t, id, stage) => view(t, id).dispatches.filter((d) => d.stage === stage);
const fileAt = (dir, rel) => path.join(dir, ...rel.split("/"));
const shaOf = (file) => (fs.existsSync(file) ? sha256(fs.readFileSync(file)) : null);
const briefsOf = (t, conversationId) => t.hub.db.prepare("SELECT content FROM messages WHERE conversation_id = ? AND role = 'user' ORDER BY position").all(conversationId).map((r) => r.content);
const count = (t, sql, ...args) => t.hub.db.prepare(sql).get(...args).n;
/** The step-0 record as stored (protected_json.authoring of the approved spec). */
const stored = (t, missionId) => {
  const row = t.hub.db.prepare("SELECT id, protected_json FROM factory_specs WHERE mission_id = ? AND status = 'APPROVED'").get(missionId);
  return { specId: row.id, prot: JSON.parse(row.protected_json) };
};
const store = (t, specId, prot) => t.hub.db.prepare("UPDATE factory_specs SET protected_json = ? WHERE id = ?").run(JSON.stringify(prot), specId);
const activeRun = (t, provider) => t.hub.runs.activeRuns().find((r) => r.provider === provider) || null;
const untilRun = (t, provider, missionId, stage, ms = 60000) => waitFor(() => (activeRun(t, provider) && view(t, missionId).factory.stage === stage ? activeRun(t, provider) : null), ms, 20);
const noRuns = (t) => waitFor(() => (t.hub.runs.activeRuns().length === 0 ? true : null), 30000, 50);

const grantsFor = (t, project, attempts = 5) => t.hub.bus.transaction(() => {
  t.hub.grants.create({ provider: "codex", projectId: project.id, access: "workspace-write", maxAttempts: attempts, maxDurationS: 900, ttlMinutes: 480 }, "test");
  t.hub.grants.create({ provider: "claude", projectId: project.id, access: "read-only", maxAttempts: attempts, maxDurationS: 900, ttlMinutes: 480 }, "test");
});

/** A Software Factory test Hub with one test project made from `fixture` (`mutate` edits the copy first); manual grants, gate open. */
async function stageZeroHub({ fixture = "bug-demo-test-first", attempts = 5, clock = null, mutate = null, name = null, wsl = null } = {}) {
  const t = await makeTestHub({ queues: true, ...(clock ? { clock: clock.now } : {}), ...(wsl ? { wsl } : {}) });
  await enableLive(t.hub, { provider: "codex", access: "workspace-write", attempts: 1 });
  const dir = path.join(t.dataDir, `factory-${fixture}`);
  materializeFixture(fixture, dir);
  if (mutate) mutate(dir);
  const project = (await dispatch(t.hub, "project.register_test", { path: dir, ...(name ? { name } : {}) })).result;
  grantsFor(t, project, attempts);
  return { ...t, project, dir, clock };
}

/** The pilot's spec (fixtures.mjs bug-demo-test-first): the Hub-written test's paths derive from the registered project's id. */
const tfInput = (t) => demoSpec("bug-demo-test-first", { projectId: t.project.id });
async function prepare(t, { limits = {}, input = tfInput(t) } = {}) {
  return (await dispatch(t.hub, "factory.prepare", { projectId: t.project.id, ...input, limits: { ...MODELS, ...limits } })).result.mission;
}
async function approveAndStart(t, missionId) {
  const requested = await dispatch(t.hub, "factory.start", view(t, missionId).scope);
  await dispatch(t.hub, "approval.decide", { approvalId: requested.approval.id, decision: "approved", displayedHash: requested.approval.payloadHash });
  return t.hub.commands.executeApproved(requested.command.id, "user");
}
const stopAndConfirm = async (t, missionId) => { await dispatch(t.hub, "factory.stop", { missionId }, "ui"); return untilStage(t, missionId, ["CANCELLED"]); };

/** A test clock the cooldown and the deadline read (the turn timers stay real time). */
function testClock() { const offset = { ms: 0 }; return { offset, now: () => new Date(Date.now() + offset.ms), advance: (ms) => { offset.ms += ms; } }; }
async function tickAt(t, id, advanceMs = 0) { if (advanceMs) t.clock.advance(advanceMs); await t.hub.factory.tick(); await idle(t, id); }

/**
 * A Hub that restarts on the same data (the crash simulation of M03-FAC-10: the conductor never sees the end of the run in flight).
 * With `live`, the live preconditions are set again (every boot is BUILD_SAFE and a shutdown suspends the gate).
 */
async function restart(t, { live = true } = {}) {
  t.hub.factory.onRunFinished = async () => null;
  await t.hub.close();
  const hub = createHub(t.config, { homeDir: t.homeDir });
  const report = await hub.boot();
  if (live) await enableLive(hub, { provider: "codex", access: "workspace-write", attempts: 1 });
  return { hub, report };
}
const dropData = (t) => { try { fs.rmSync(t.dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* left in .ifrim/tmp */ } };

/**
 * The rows of a mission whose test review PASSED and whose protection did not commit (§5.5): the test is un-protected in the database
 * (status, protected files, base, the baseline and the writer's steps after it) — the files are left as the caller arranges them.
 */
function unprotect(t, missionId, specId, prot, stage) {
  const { protectedAt: _at, protectedSha: _sha, baseSnapshotId: _base, summary: _summary, ...authoring } = prot.authoring;
  store(t, specId, { ...prot, files: {}, authoring: { ...authoring, status: "AUTHORING", lastHubWrite: { path: authoring.stagingRef, sha: authoring.candidate.sha },
    candidate: { ...authoring.candidate, status: "REVIEWED" } } });
  t.hub.db.prepare("UPDATE factory_missions SET base_snapshot_id = ?, stage = ? WHERE mission_id = ?").run(authoring.preTestSnapshotId, stage, missionId);
  t.hub.db.prepare("DELETE FROM factory_snapshots WHERE mission_id = ? AND kind = 'base'").run(missionId);
  t.hub.db.prepare("DELETE FROM factory_evidence WHERE mission_id = ? AND stage = 'BASELINE'").run(missionId);
  t.hub.db.prepare("DELETE FROM factory_dispatches WHERE mission_id = ? AND stage IN ('IMPLEMENTING','REPAIRING','REVIEWING')").run(missionId);
}
/** Pauses a mission and waits until nothing of it runs or is queued. */
async function pauseQuiet(t, missionId) {
  await dispatch(t.hub, "factory.pause", { missionId }, "ui");
  await untilStage(t, missionId, ["PAUSED"]);
  await noRuns(t);
  await idle(t, missionId);
}

/** A test project with the owner enrolled (voice-first policy, TRUSTED): plans are confirmed in the owner session. */
async function ownerProject(fixture = "bug-demo-test-first") {
  const t = await makeTestHub({ queues: true });
  await prepareLiveWithoutGrants(t.hub);
  t.dir = path.join(t.dataDir, "factory-owner");
  materializeFixture(fixture, t.dir);
  t.project = (await dispatch(t.hub, "project.register_test", { path: t.dir })).result;
  t.owner = await enrolOwner(t);
  await dispatch(t.hub, "owner.autonomy.set", { projectId: t.project.id, level: "TRUSTED" }, "test", { ownerSession: t.owner.reauth() });
  return t;
}
const asOwner = (t, type, payload = {}, session = t.owner.session) => t.hub.commands.dispatch({ type, payload, channel: "owner", actor: `owner:${session.id}`, ownerSession: session }).then((r) => r.result);
async function planAndConfirm(t) {
  const { envelope } = (await dispatch(t.hub, "envelope.propose", { projectId: t.project.id })).result;
  await dispatch(t.hub, "envelope.confirm", { envelopeId: envelope.id, nonce: envelope.nonce, displayedHash: envelope.envelopeHash }, "test", { ownerSession: t.owner.session });
  return envelope;
}

/** service-request without its acceptance test: a FEATURE with zero tests, test-first by hand (wave B's planner builds the same spec). */
function srInput(t, { ignore = null } = {}) {
  const demo = demoSpec("service-request");
  const refs = plannedTestRefs({ projectId: t.project.id, workType: "FEATURE", objective: demo.objective, title: demo.title });
  return { workType: "FEATURE", title: demo.title, objective: demo.objective, spec: {
    inScope: ["src/server-app.js"], outOfScope: demo.spec.outOfScope, constraints: demo.spec.constraints,
    acceptance: [
      { id: "AC-1", text: "O solicitare validă se salvează și primește răspunsul 201", verify: "test", testRef: refs.testRef },
      { id: "AC-2", text: "Implementarea e explicată și revizuită independent", verify: "review" },
    ],
    verification: { checks: ["node --test"], acceptance: [`node --test ${refs.testRef}`] },
    workspace: { ignore: ignore ?? deriveIgnore(fs.readFileSync(path.join(t.dir, ".gitignore"), "utf8")) },
    authoring: { mode: "hub", testRef: refs.testRef, stagingRef: refs.stagingRef, criteria: ["AC-1"] },
    sources: { user: ["Formular de solicitare cu listă și protecție la dubluri."] },
  } };
}
const withoutTests = (dir) => fs.rmSync(path.join(dir, "test"), { recursive: true, force: true });

// ------------------------------------------------------------------------------------------------------------------------------ shape
test("stages and roles: step 0 is in FACTORY_STAGES and ACTIVE_STAGES; the author runs under the reviewer binding, the test review under the writer's", () => {
  for (const stage of ["TEST_AUTHORING", "TEST_PROVING", "TEST_REVIEW"]) {
    assert.ok(FACTORY_STAGES.includes(stage) && ACTIVE_STAGES.has(stage) && STAGE_ZERO.has(stage), stage);
  }
  assert.ok(FACTORY_STAGES.indexOf("TEST_REVIEW") < FACTORY_STAGES.indexOf("BASELINE"));
  assert.deepEqual([ROLE_OF_STAGE.TEST_AUTHORING, ROLE_OF_STAGE.TEST_REVIEW, ROLE_OF_STAGE.REVIEWING, ROLE_OF_STAGE.IMPLEMENTING], ["reviewer", "writer", "reviewer", "writer"]);
  assert.equal(ROLE_OF_STAGE.TEST_PROVING, undefined, "the proof runs no model");
  assert.ok(Object.isFrozen(ROLE_OF_STAGE));
});

// ------------------------------------------------------------------------------------------------------------------------------ I1
test("I1 happy path under ONE plan: Claude writes the test (read-only), the Hub proves it twice, Codex reviews it (read-only), the Hub protects it, the mission reaches DELIVERY_READY; one confirmation, derived grants only, the base moved, provenance in the bundle", async () => {
  const t = await makeTestHub({ queues: true });
  try {
    await prepareLiveWithoutGrants(t.hub);
    const dir = path.join(t.dataDir, "factory-i1");
    materializeFixture("bug-demo-test-first", dir);
    t.project = (await dispatch(t.hub, "project.register_test", { path: dir })).result;
    const owner = await enrolOwner(t);
    await dispatch(t.hub, "owner.autonomy.set", { projectId: t.project.id, level: "TRUSTED" }, "test", { ownerSession: owner.reauth() });
    const mission = await prepare(t);
    const planned = tfInput(t).spec.authoring;
    const draft = view(t, mission.id);
    assert.equal(draft.authoring.status, "PLANNED");
    assert.equal(draft.authoring.testRef, planned.testRef);
    assert.equal(draft.grantsNeeded[0].attempts, 1 + 2 + 2, "grants needed include the author cycles ahead (1 + reauthorMax)");
    const modeEvents = () => count(t, "SELECT COUNT(*) AS n FROM events WHERE type = 'settings.changed' AND json_extract(payload_json, '$.key') = 'mode'");
    const modeBefore = modeEvents();
    const { envelope } = (await dispatch(t.hub, "envelope.propose", { projectId: t.project.id })).result;
    assert.ok(envelope, "the plan exists");
    t.queue("claude", "author:bug-ok", "review:pass");
    t.queue("codex", "test-review:pass", "factory-write:bug-fix");
    const confirmed = (await dispatch(t.hub, "envelope.confirm", { envelopeId: envelope.id, nonce: envelope.nonce, displayedHash: envelope.envelopeHash }, "test", { ownerSession: owner.session })).result;
    assert.equal(confirmed.envelope.status, "ACTIVE");
    const done = await untilStage(t, mission.id, SETTLED, 180000);
    assert.equal(done.factory.stage, "DELIVERY_READY", done.factory.stageReason);
    assert.deepEqual(stagesOf(t, mission.id), ["SPEC_DRAFT", "TEST_AUTHORING", "TEST_PROVING", "TEST_REVIEW", "BASELINE", "IMPLEMENTING", "CHECKING", "REVIEWING", "QA", "DELIVERY_READY"].filter((s) => s !== "SPEC_DRAFT"));
    // ONE confirmation: the factory.scope approval decided by the plan; no mode write, no grant form; every run used a derived grant.
    assert.equal(events(t, "envelope.confirmed").length, 1);
    const approvals = t.hub.db.prepare("SELECT decided_via, decision_note FROM approvals WHERE action_kind = 'factory.scope'").all().map((r) => ({ ...r }));
    assert.deepEqual(approvals, [{ decided_via: "owner_session", decision_note: `envelope ${envelope.id}` }]);
    assert.equal(modeEvents(), modeBefore, "the Hub's mode is never written");
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM commands WHERE type IN ('mode.set','grant.create')"), 0);
    const derived = new Set(t.hub.grants.ofEnvelope(envelope.id).map((g) => g.id));
    const runRows = t.hub.db.prepare("SELECT id, provider, access, grant_id, conversation_id FROM agent_runs ORDER BY created_at").all();
    assert.equal(runRows.length, 4);
    assert.ok(runRows.every((r) => derived.has(r.grant_id)), "only derived grants");
    // Who ran what, with which access, where (step 0 never writes; each step has its own conversation).
    const a = done.authoring;
    const byStage = Object.fromEntries(done.runs.map((r) => [r.dispatchStage, r]));
    assert.deepEqual(Object.keys(byStage).sort(), ["IMPLEMENTING", "REVIEWING", "TEST_AUTHORING", "TEST_REVIEW"]);
    assert.deepEqual([byStage.TEST_AUTHORING.provider, byStage.TEST_AUTHORING.access], ["claude", "read-only"]);
    assert.deepEqual([byStage.TEST_REVIEW.provider, byStage.TEST_REVIEW.access], ["codex", "read-only"], "the writer's binding narrowed to read-only");
    assert.deepEqual([byStage.IMPLEMENTING.provider, byStage.IMPLEMENTING.access], ["codex", "workspace-write"]);
    assert.equal(byStage.TEST_REVIEW.plan.bindingRole, "writer");
    assert.equal(byStage.TEST_AUTHORING.plan.bindingRole, "reviewer");
    const convOf = (runId) => runRows.find((r) => r.id === runId).conversation_id;
    assert.equal(convOf(byStage.TEST_AUTHORING.id), a.authorConversationId);
    assert.equal(convOf(byStage.TEST_REVIEW.id), a.testReviewConversationId);
    assert.equal(new Set([a.authorConversationId, a.testReviewConversationId, done.mission.conversationId, done.factory.reviewConversationId]).size, 4);
    const testReviewDispatch = stageDispatches(t, mission.id, "TEST_REVIEW")[0];
    assert.equal(testReviewDispatch.request.access, "read-only");
    // Protected: the test moved to test/hub with the reviewed sha; staging empty; the base moved to a NEW snapshot (pre-test kept).
    assert.equal(a.status, "PROTECTED");
    assert.equal(a.proof.verdict, "PROVEN");
    assert.equal(shaOf(fileAt(dir, a.testRef)), a.protectedSha);
    assert.equal(fs.existsSync(fileAt(dir, a.stagingRef)), false);
    assert.deepEqual(done.spec.protected.files, { [a.testRef]: a.protectedSha });
    const { prot } = stored(t, mission.id);
    const snaps = t.hub.db.prepare("SELECT id, kind FROM factory_snapshots WHERE mission_id = ? ORDER BY seq").all(mission.id);
    assert.deepEqual(snaps.slice(0, 2).map((s) => s.kind), ["pre_test", "base"]);
    assert.equal(prot.authoring.preTestSnapshotId, snaps[0].id);
    assert.equal(done.factory.baseSnapshotId, snaps[1].id, "base_snapshot_id moved to the new base");
    // The writer's change set is relative to the new base: the protected test is not in it, and nothing was flagged.
    const cs = done.changeSets.at(-1);
    assert.deepEqual(cs.changes.map((c) => c.path).sort(), ["src/requests.js", "test/regression.test.mjs"]);
    assert.equal(done.findings.filter((f) => f.source === "integrity").length, 0);
    const baseline = done.evidence.find((e) => e.stage === "BASELINE");
    assert.deepEqual([baseline.command, baseline.status], [`node --test ${a.testRef}`, "FAIL"]);
    // The writer brief names the Hub-written, verified and protected test.
    const writerBrief = briefsOf(t, done.mission.conversationId).at(-1);
    assert.match(writerBrief, new RegExp(`PROTEJATE[^\\n]*${a.testRef.replace(/[.]/g, "\\.")}`));
    assert.match(writerBrief, /a fost scris de Hub din criteriile proprietarului, verificat \(pică azi din motivul potrivit, review independent\) și protejat: repari implementarea, nu testul\./);
    // Step 0's tasks were added and completed; its events are there.
    const stage0Tasks = done.tasks.filter((x) => ["Test de acceptanță scris de Hub", "Verificare independentă a testului"].includes(x.title));
    assert.deepEqual(stage0Tasks.map((x) => x.status), ["COMPLETED", "COMPLETED"]);
    const [protectedEvent] = events(t, "factory.acceptance_protected", mission.id);
    assert.deepEqual([protectedEvent.ref, protectedEvent.sha], [a.testRef, a.protectedSha]);
    assert.match(a.summary, /^Testul de acceptanță e gata și protejat\. Ce verifică: AC-1 — „/);
    // The bundle: provenance, hub_authored criterion, rollback with the pre-test base and the test's removal, honest limitations.
    const bundle = t.hub.db.prepare("SELECT manifest_json, file_path FROM factory_bundles WHERE mission_id = ?").get(mission.id);
    const manifest = JSON.parse(bundle.manifest_json);
    assert.equal(manifest.acceptanceTest.ref, a.testRef);
    assert.match(manifest.acceptanceTest.line, /textul propus de Claude \([^)]+, doar citire\) din cerința ta; pe codul de dinainte: 2 teste, 1 eșuate, din motivul corect \(2 rulări identice\); verificat de Codex \([^)]+, doar citire\), review rev_\w+ PASS; protejat la /);
    assert.equal(manifest.spec.criteria.find((c) => c.id === "AC-1").provenance, "hub_authored");
    assert.equal(manifest.spec.criteria.find((c) => c.id === "AC-2").provenance, undefined);
    assert.equal(manifest.rollback.preTestBase, a.preTestSha);
    assert.ok(manifest.rollback.files.includes(`șterge ${a.testRef} (testul scris de Hub)`));
    assert.ok(manifest.limitations.some((l) => /^Testul de acceptanță: propus de Claude \(run_\w+, doar citire/.test(l)));
    assert.ok(manifest.limitations.some((l) => /^Testul de acceptanță: verificat de Codex \(run_\w+, doar citire/.test(l)));
    assert.ok(manifest.runs.every((r) => r.dispatchStage));
    const md = fs.readFileSync(path.join(t.config.hubRoot, bundle.file_path), "utf8");
    assert.match(md, /## Testul de acceptanță \(scris de Hub\)/);
    assert.match(md, new RegExp(`- șterge ${a.testRef.replace(/[.]/g, "\\.")} \\(testul scris de Hub\\)`));
    assert.equal(done.grantsNeeded[0].attempts, 1 + 2, "no author cycle left after the protection");
  } finally { await t.cleanup(); }
});

test("I1 a writer that touches the protected Hub-written test stops at protected_test_changed (critical); the change set shows it MODIFIED against the new base; nothing is checked", async () => {
  const t = await stageZeroHub();
  try {
    const mission = await prepare(t);
    t.queue("claude", "author:bug-ok");
    t.queue("codex", "test-review:pass", "factory-write:hub-test-tamper");
    await approveAndStart(t, mission.id);
    const stopped = await untilStage(t, mission.id, SETTLED);
    assert.equal(stopped.factory.stage, "NEEDS_OWNER_DECISION");
    assert.match(stopped.factory.stageReason, /protected_test_changed/);
    const ref = stopped.authoring.testRef;
    assert.ok(stopped.findings.some((f) => f.severity === "critical" && f.file === ref && /protected_test_changed/.test(f.fingerprint)));
    assert.deepEqual(stopped.changeSets.at(-1).changes.map((c) => [c.path, c.status]), [[ref, "modified"]]);
    assert.equal(stopped.evidence.filter((e) => e.stage === "CHECKING").length, 0);
  } finally { await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ I2
test("I2 service-request, a FEATURE with zero tests: the Hub-written test writes data/*.sqlite at every run and stays hermetic through the ignore derived from .gitignore (S1); without it the same proof is NOT_HERMETIC", async () => {
  const t = await stageZeroHub({ fixture: "service-request", mutate: withoutTests });
  try {
    const input = srInput(t);
    assert.deepEqual(input.spec.workspace.ignore, ["data"], "deriveIgnore(.gitignore)");
    const mission = await prepare(t, { input });
    t.queue("claude", "author:sr-feature-ok", "review:pass");
    t.queue("codex", "test-review:pass", "factory-write:feature-b-dedupe");
    await approveAndStart(t, mission.id);
    const done = await untilStage(t, mission.id, SETTLED, 180000);
    assert.equal(done.factory.stage, "DELIVERY_READY", done.factory.stageReason);
    assert.equal(done.authoring.proof.verdict, "PROVEN");
    assert.equal(done.authoring.candidate.cases.length, 1, "a FEATURE needs no control case");
    assert.ok(fs.existsSync(path.join(t.dir, "data", "hub-proof.sqlite")), "the test wrote its runtime data in the project");
    assert.ok(!done.changeSets.at(-1).changes.some((c) => c.path.startsWith("data/")));
    const proof = done.evidence.filter((e) => e.stage === "TEST_PROVING");
    assert.deepEqual(proof.map((e) => e.status), ["FAIL", "FAIL"]);
    // The API shape the test fixes reached the writer as part of the requirement.
    assert.match(briefsOf(t, done.mission.conversationId).at(-1), /forma API pe care o fixează \(„createApp\(\{ dbFile, publicDir \}\)/);
    assert.ok(done.evidence.some((e) => e.stage === "QA" && e.status === "PASS"));
  } finally { await t.cleanup(); }
  const s = await stageZeroHub({ fixture: "service-request", mutate: withoutTests });
  try {
    const mission = await prepare(s, { input: srInput(s, { ignore: [] }) });
    s.queue("claude", "author:sr-feature-ok");
    await approveAndStart(s, mission.id);
    const stopped = await untilStage(s, mission.id, SETTLED);
    assert.equal(stopped.factory.stage, "NEEDS_OWNER_DECISION");
    assert.equal(stopped.authoring.proof.verdict, "NOT_HERMETIC");
    assert.equal(stopped.factory.stageReason, T_NOT_HERMETIC(["data/hub-proof.sqlite"]));
    assert.equal(stageDispatches(s, mission.id, "TEST_AUTHORING").length, 1, "never rewritten");
    assert.equal(stageDispatches(s, mission.id, "TEST_REVIEW").length, 0);
  } finally { await s.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ I4
test("I4 a body that breaks the lint is refused before anything is written: rewritten once with the reasons quoted as data, then the owner decides; the code is never touched and a resume runs nothing", async () => {
  const t = await stageZeroHub();
  try {
    const before = shaOf(fileAt(t.dir, "src/requests.js"));
    const mission = await prepare(t);
    t.queue("claude", "author:bug-tautology", "author:bug-process-env");
    await approveAndStart(t, mission.id);
    const stopped = await untilStage(t, mission.id, SETTLED);
    assert.equal(stopped.factory.stage, "NEEDS_OWNER_DECISION");
    assert.equal(stopped.factory.stageReason, T_LINT("testul folosește ceva interzis"));
    assert.deepEqual(stageDispatches(t, mission.id, "TEST_AUTHORING").map((d) => d.request.cycle), [0, 1]);
    assert.deepEqual(stopped.authoring.rejected.map((r) => [r.cycle, r.kind]), [[0, "lint"], [1, "lint"]]);
    assert.equal(stopped.authoring.blocked.kind, "exhausted");
    assert.equal(stopped.evidence.filter((e) => e.stage === "TEST_PROVING").length, 0);
    assert.equal(fs.existsSync(fileAt(t.dir, stopped.authoring.stagingRef)), false, "a refused body is never written");
    assert.equal(fs.existsSync(fileAt(t.dir, stopped.authoring.testRef)), false);
    assert.equal(shaOf(fileAt(t.dir, "src/requests.js")), before);
    const [, second] = briefsOf(t, stopped.authoring.authorConversationId);
    assert.match(second, /## Varianta anterioară a fost respinsă \(date, citate de Hub\)[\s\S]*o aserțiune compară valori fixe/);
    // „Reia" keeps the owner's decision (no rewrite beyond the plan); one more repair cycle does not exist in step 0.
    await assert.rejects(dispatch(t.hub, "factory.resume", { missionId: mission.id, allowExtraCycle: true }, "ui"), /Etapa 0 nu are cicluri de remediere/);
    await dispatch(t.hub, "factory.resume", { missionId: mission.id }, "ui");
    await idle(t, mission.id);
    assert.equal(view(t, mission.id).factory.stage, "NEEDS_OWNER_DECISION");
    assert.equal(stageDispatches(t, mission.id, "TEST_AUTHORING").length, 2);
  } finally { await t.cleanup(); }
});

test("I4 a hidden extra test is refused, then a test that fails on a TypeError is the wrong reason: the owner decides with the plain cause; the candidate stays only in the Hub's work area", async () => {
  const t = await stageZeroHub();
  try {
    const before = shaOf(fileAt(t.dir, "src/requests.js"));
    const mission = await prepare(t);
    t.queue("claude", "author:bug-hidden-extra", "author:bug-typeerror");
    await approveAndStart(t, mission.id);
    const stopped = await untilStage(t, mission.id, SETTLED);
    assert.equal(stopped.factory.stage, "NEEDS_OWNER_DECISION");
    assert.equal(stopped.factory.stageReason, T_WRONG_REASON(PROOF_CAUSES.code_error));
    const a = stopped.authoring;
    assert.deepEqual(a.rejected.map((r) => [r.cycle, r.kind, r.verdict]), [[0, "lint", null], [1, "proof", "WRONG_REASON"]]);
    assert.ok(a.rejected[0].plain.includes("cazurile din test nu sunt exact cele anunțate"));
    const check = a.proof.table.find((r) => r.kind === "check");
    assert.deepEqual([check.today, check.code, check.errorName], ["fail", "ERR_TEST_FAILURE", "TypeError"]);
    assert.equal(shaOf(fileAt(t.dir, a.stagingRef)), a.candidate.sha, "the Hub's file, in its work area");
    assert.equal(fs.existsSync(fileAt(t.dir, a.testRef)), false, "never under test/");
    assert.equal(shaOf(fileAt(t.dir, "src/requests.js")), before);
    assert.deepEqual(stopped.evidence.filter((e) => e.stage === "TEST_PROVING").map((e) => e.changeSetId), [`acceptance:${a.candidate.sha.slice(0, 12)}`, `acceptance:${a.candidate.sha.slice(0, 12)}`]);
    assert.equal(stageDispatches(t, mission.id, "TEST_REVIEW").length, 0);
  } finally { await t.cleanup(); }
});

test("I4 an unreadable answer is a new attempt of the SAME cycle (counted), not a rewrite; a test that already passes stops at once (ALREADY_PASSES: never kept, never rewritten)", async () => {
  const t = await stageZeroHub();
  try {
    const mission = await prepare(t);
    t.queue("claude", "ok", "author:bug-already-passes");
    await approveAndStart(t, mission.id);
    const stopped = await untilStage(t, mission.id, SETTLED);
    assert.equal(stopped.factory.stage, "NEEDS_OWNER_DECISION");
    assert.equal(stopped.factory.stageReason, T_ALREADY_PASSES);
    const authors = stageDispatches(t, mission.id, "TEST_AUTHORING");
    assert.deepEqual(authors.map((d) => [d.request.cycle, d.request.attempt, d.request.counted]), [[0, 1, 1], [0, 2, 2]]);
    assert.equal(events(t, "factory.test_unreadable", mission.id).length, 1);
    assert.match(briefsOf(t, stopped.authoring.authorConversationId)[1], /lipsește blocul '''js cu corpul testului/, "the parse problem, quoted (fences neutralized)");
    assert.deepEqual(stopped.authoring.rejected, [], "an already-passing test is not rewritten");
    assert.deepEqual([stopped.authoring.proof.verdict, stopped.authoring.blocked.kind], ["ALREADY_PASSES", "already_passes"]);
    assert.equal(fs.existsSync(fileAt(t.dir, stopped.authoring.testRef)), false, "not added to the tests");
    assert.equal(stageDispatches(t, mission.id, "TEST_REVIEW").length, 0);
    await dispatch(t.hub, "factory.resume", { missionId: mission.id }, "ui");
    await idle(t, mission.id);
    assert.equal(view(t, mission.id).factory.stage, "NEEDS_OWNER_DECISION");
    assert.equal(view(t, mission.id).evidence.filter((e) => e.stage === "TEST_PROVING").length, 2, "a resume runs nothing");
  } finally { await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ I5
test("I5 CHANGES_REQUESTED on the test → rewritten (the reviewer's reasons quoted to the author) → PASS on the new bytes; T-prefixed findings, resolved by the second review; a Stop after the protection before the writer moves the test back to the work area (never left under test/)", async () => {
  const t = await stageZeroHub();
  try {
    const mission = await prepare(t);
    t.queue("claude", "author:bug-ok", "author:bug-ok-v2");
    t.queue("codex", "test-review:changes", "test-review:pass", "hang");
    t.hub.factory.setStartFaultForTests((point) => { if (point === "protect_record") t.hub.factory.pause(mission.id).catch(() => {}); });
    await approveAndStart(t, mission.id);
    await waitFor(() => view(t, mission.id).authoring?.status === "PROTECTED", 120000, 30);
    await t.hub.factory.idle(mission.id);
    assert.equal(t.hub.factory.writerStarted(mission.id), false);
    const v = view(t, mission.id);
    const reviews = v.reviews.filter((r) => r.changeSetId.startsWith("acceptance:"));
    assert.deepEqual(reviews.map((r) => [r.verdict, r.status]), [["CHANGES_REQUESTED", "VALID"], ["PASS", "VALID"]]);
    assert.notEqual(reviews[0].changeSetSha, reviews[1].changeSetSha, "the rewrite has other bytes");
    assert.ok(reviews.every((r) => r.changeSetId === `acceptance:${r.changeSetSha.slice(0, 12)}`));
    assert.equal(v.authoring.protectedSha, reviews[1].changeSetSha);
    const finding = v.findings.find((f) => f.source === "test_review");
    assert.deepEqual([finding.code, finding.severity, finding.status], ["T-001", "high", "RESOLVED"]);
    assert.deepEqual(stageDispatches(t, mission.id, "TEST_REVIEW").map((d) => [d.request.cycle, d.request.access]), [[0, "read-only"], [1, "read-only"]]);
    const authorBriefs = briefsOf(t, v.authoring.authorConversationId);
    assert.match(authorBriefs[1], /AC-1: nu poate trece niciodată/);
    assert.match(authorBriefs[1], /rezumatul verificatorului: Testul cere un mesaj/);
    assert.match(briefsOf(t, v.authoring.testReviewConversationId)[1], /## Findings deschise din verificarea anterioară\n[^\n]*\n- T-001 \[high\]/);
    // Repair F2: a definitive stop before the writer withdraws the protected test to the Hub's work
    // area (a rename of exactly the protected bytes, never a delete) instead of staying under test/ where a later mission would run it.
    const done = await stopAndConfirm(t, mission.id);
    const a = done.authoring;
    assert.equal(a.status, "ABANDONED");
    assert.deepEqual([a.abandoned.ref, a.abandoned.sha, a.abandoned.wasProtected, a.abandoned.withdrawnFrom, a.abandoned.problem], [a.stagingRef, a.protectedSha, true, a.testRef, null]);
    assert.equal(fs.existsSync(fileAt(t.dir, a.testRef)), false, "no longer under test/");
    assert.equal(shaOf(fileAt(t.dir, a.stagingRef)), a.protectedSha, "the same bytes, in the work area");
    assert.deepEqual(events(t, "factory.test_abandoned", mission.id).map((e) => [e.ref, e.withdrawnFrom]), [[a.stagingRef, a.testRef]]);
    assert.ok(done.factory.stageReason.endsWith(`Testul scris de Hub a fost mutat înapoi din ${a.testRef} în zona de lucru a Hub-ului (${a.stagingRef}): nu mai face parte din teste și nu rulează.`), done.factory.stageReason);
    assert.deepEqual(t.hub.factory.hubWrites(t.project.id), { [a.stagingRef]: a.protectedSha }, "a later plan may reuse the path for exactly these bytes");
  } finally { await t.cleanup(); }
});

test("I5 an INCONCLUSIVE test review waits for the owner (never protects an unverified test); „Reia” asks for the review again on the same bytes", async () => {
  const t = await stageZeroHub();
  try {
    const mission = await prepare(t);
    t.queue("claude", "author:bug-ok");
    t.queue("codex", "test-review:inconclusive", "test-review:pass", "hang");
    await approveAndStart(t, mission.id);
    const waiting = await untilStage(t, mission.id, SETTLED);
    assert.equal(waiting.factory.stage, "NEEDS_OWNER_DECISION");
    assert.equal(waiting.factory.stageReason, T_REVIEW_INCONCLUSIVE(REVIEW_CAUSES.unreadable));
    assert.equal(waiting.reviews[0].status, "INVALID");
    assert.equal(fs.existsSync(fileAt(t.dir, waiting.authoring.testRef)), false);
    await dispatch(t.hub, "factory.resume", { missionId: mission.id }, "ui");
    await untilRun(t, "codex", mission.id, "IMPLEMENTING", 90000);
    const v = view(t, mission.id);
    assert.equal(v.authoring.status, "PROTECTED");
    assert.deepEqual(stageDispatches(t, mission.id, "TEST_REVIEW").map((d) => [d.request.cycle, d.request.attempt]), [[0, 1], [0, 2]]);
    assert.equal(new Set(v.reviews.map((r) => r.changeSetSha)).size, 1, "the same bytes reviewed again");
    await stopAndConfirm(t, mission.id);
  } finally { await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ I6
test("I6 the staging file edited while Codex reviews it: the review is STALE, step 0 stops at the owner, nothing is protected, a resume runs nothing; the unknown file then refuses the next start", async () => {
  const t = await stageZeroHub();
  try {
    const mission = await prepare(t);
    t.queue("claude", "author:bug-ok");
    t.queue("codex", "test-review-slow:pass");
    await approveAndStart(t, mission.id);
    await untilRun(t, "codex", mission.id, "TEST_REVIEW");
    const { stagingRef, testRef } = view(t, mission.id).authoring;
    fs.appendFileSync(fileAt(t.dir, stagingRef), "\n// editat în timpul verificării\n");
    const stopped = await untilStage(t, mission.id, SETTLED);
    assert.equal(stopped.factory.stage, "NEEDS_OWNER_DECISION");
    assert.equal(stopped.factory.stageReason, T_PROJECT_CHANGED([stagingRef]));
    assert.deepEqual(stopped.reviews.map((r) => r.status), ["STALE"]);
    assert.equal(stopped.authoring.blocked.kind, "changed");
    assert.equal(fs.existsSync(fileAt(t.dir, testRef)), false, "nothing protected");
    await dispatch(t.hub, "factory.resume", { missionId: mission.id }, "ui");
    await idle(t, mission.id);
    assert.equal(view(t, mission.id).factory.stage, "NEEDS_OWNER_DECISION");
    assert.equal(stageDispatches(t, mission.id, "TEST_REVIEW").length, 1);
    // Stopped, the edited file is not the Hub's write: a new plan with the same paths refuses to start (it is never overwritten).
    const cancelled = await stopAndConfirm(t, mission.id);
    assert.equal(cancelled.authoring.abandoned.hubWritten, false);
    const next = await prepare(t);
    await assert.rejects(approveAndStart(t, next.id), /există deja în zona de lucru a Hub-ului, cu un conținut pe care Hub-ul nu l-a scris/);
    assert.equal(view(t, next.id).factory.stage, "SPEC_DRAFT");
  } finally { await t.cleanup(); }
});

test("I6 a file outside the work area changed while Claude writes the test: the project changed — the owner decides before any proof runs", async () => {
  const t = await stageZeroHub();
  try {
    const mission = await prepare(t);
    t.queue("claude", "author-slow:bug-ok");
    await approveAndStart(t, mission.id);
    await untilRun(t, "claude", mission.id, "TEST_AUTHORING");
    fs.writeFileSync(path.join(t.dir, "src", "extra.js"), "export const extra = 1;\n");
    const stopped = await untilStage(t, mission.id, SETTLED);
    assert.equal(stopped.factory.stage, "NEEDS_OWNER_DECISION");
    assert.equal(stopped.factory.stageReason, T_PROJECT_CHANGED(["src/extra.js"]));
    assert.equal(stopped.evidence.filter((e) => e.stage === "TEST_PROVING").length, 0, "no proof on a changed project");
    assert.equal(stopped.authoring.candidate, null);
    assert.ok(stopped.authoring.pending, "the candidate written ahead stays on record");
  } finally { await t.cleanup(); }
});

test("I6 a proof that leaves a file in the project is NOT_HERMETIC: the owner decides at once, the test is never rewritten", async () => {
  const t = await stageZeroHub();
  try {
    const mission = await prepare(t);
    t.queue("claude", "author:bug-writes-project");
    await approveAndStart(t, mission.id);
    const stopped = await untilStage(t, mission.id, SETTLED);
    assert.equal(stopped.factory.stage, "NEEDS_OWNER_DECISION");
    assert.equal(stopped.factory.stageReason, T_NOT_HERMETIC(["hub-proof-left.txt"]));
    assert.deepEqual([stopped.authoring.proof.verdict, stopped.authoring.blocked.kind], ["NOT_HERMETIC", "not_hermetic"]);
    assert.equal(stageDispatches(t, mission.id, "TEST_AUTHORING").length, 1);
    assert.ok(stopped.authoring.candidate.signals.some((s) => /node:fs/.test(s)), "the soft signal is kept for the reviewer");
  } finally { await t.cleanup(); }
});

test("I6 the reviewed bytes changed before the protection (the mission stopped between the review and the move): the protection refuses on the sha, nothing reaches test/hub", async () => {
  const t = await stageZeroHub();
  try {
    const mission = await prepare(t);
    t.queue("claude", "author:bug-ok");
    t.queue("codex", "test-review:pass", "hang");
    await approveAndStart(t, mission.id);
    await untilRun(t, "codex", mission.id, "IMPLEMENTING");
    await pauseQuiet(t, mission.id);
    const { specId, prot } = stored(t, mission.id);
    const a = prot.authoring;
    fs.renameSync(fileAt(t.dir, a.testRef), fileAt(t.dir, a.stagingRef));
    fs.appendFileSync(fileAt(t.dir, a.stagingRef), "// schimbat după verificare\n");
    unprotect(t, mission.id, specId, prot, "PAUSED");
    await dispatch(t.hub, "factory.resume", { missionId: mission.id }, "ui");
    const stopped = await untilStage(t, mission.id, SETTLED);
    assert.equal(stopped.factory.stage, "NEEDS_OWNER_DECISION");
    assert.equal(stopped.factory.stageReason, T_PROJECT_CHANGED([a.stagingRef]));
    assert.equal(fs.existsSync(fileAt(t.dir, a.testRef)), false, "the changed bytes were not moved under test/");
    assert.notEqual(shaOf(fileAt(t.dir, a.stagingRef)), a.candidate.sha);
    assert.deepEqual(stopped.spec.protected.files, {});
    assert.equal(stopped.evidence.filter((e) => e.stage === "BASELINE").length, 0);
  } finally { await t.cleanup(); }
});

test("BASELINE of a test-first mission: the protected test failing differently from its two proof runs is unstable — the owner decides before any writer turn", async () => {
  const marker = path.join(os.tmpdir(), "ifrim-l5-baseline-flip");
  fs.rmSync(marker, { force: true });
  const t = await stageZeroHub();
  try {
    const mission = await prepare(t);
    t.queue("claude", "author:bug-env-flip");
    t.queue("codex", "test-review-slow:pass");
    await approveAndStart(t, mission.id);
    await untilRun(t, "codex", mission.id, "TEST_REVIEW");
    // The test's environment changes after the proof (outside the project, so nothing in the project changed).
    fs.writeFileSync(marker, "x");
    const stopped = await untilStage(t, mission.id, SETTLED);
    assert.equal(stopped.factory.stage, "NEEDS_OWNER_DECISION");
    assert.match(stopped.factory.stageReason, /^Testul de acceptanță scris de Hub a dat la baseline alt rezultat decât la cele două rulări de probă \(cele două rulări au dat rezultate diferite\); un test instabil nu ajunge la implementare/);
    assert.equal(stopped.authoring.status, "PROTECTED");
    assert.equal(stopped.evidence.find((e) => e.stage === "BASELINE").status, "FAIL");
    assert.equal(stageDispatches(t, mission.id, "IMPLEMENTING").length, 0, "no writer turn on an unstable test");
    assert.equal(events(t, "factory.acceptance_unstable", mission.id).length, 1);
  } finally { fs.rmSync(marker, { force: true }); await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ I7
test("I7 Pause in TEST_AUTHORING and in TEST_REVIEW: the turn is interrupted (never an attempt) and „Reia” repeats the step; a Stop in TEST_AUTHORING before anything was written leaves nothing on disk", async () => {
  const t = await stageZeroHub();
  try {
    const mission = await prepare(t);
    t.queue("claude", "hang", "author:bug-ok");
    t.queue("codex", "hang", "test-review:pass", "hang");
    await approveAndStart(t, mission.id);
    await untilRun(t, "claude", mission.id, "TEST_AUTHORING");
    await pauseQuiet(t, mission.id);
    await dispatch(t.hub, "factory.resume", { missionId: mission.id }, "ui");
    await untilRun(t, "codex", mission.id, "TEST_REVIEW");
    await pauseQuiet(t, mission.id);
    await dispatch(t.hub, "factory.resume", { missionId: mission.id }, "ui");
    await untilRun(t, "codex", mission.id, "IMPLEMENTING");
    assert.deepEqual(stageDispatches(t, mission.id, "TEST_AUTHORING").map((d) => [d.status, d.request.cycle, d.request.counted]), [["INTERRUPTED", 0, 1], ["DONE", 0, 1]], "the interrupted turn is not an attempt");
    assert.deepEqual(stageDispatches(t, mission.id, "TEST_REVIEW").map((d) => [d.status, d.request.counted]), [["INTERRUPTED", 1], ["DONE", 1]]);
    assert.equal(view(t, mission.id).authoring.status, "PROTECTED");
    await stopAndConfirm(t, mission.id);
  } finally { await t.cleanup(); }
  const s = await stageZeroHub();
  try {
    const mission = await prepare(s);
    s.queue("claude", "hang");
    await approveAndStart(s, mission.id);
    await untilRun(s, "claude", mission.id, "TEST_AUTHORING");
    const done = await stopAndConfirm(s, mission.id);
    // Review finding 5: nothing was written, so the owner is not told about a leftover file.
    assert.equal(done.factory.stageReason, "Oprire confirmată: nicio execuție sau proces al misiunii nu mai rulează");
    assert.ok(!done.factory.stageReason.includes(T_STOP_STAGE0));
    assert.deepEqual([done.authoring.status, done.authoring.abandoned.sha], ["ABANDONED", null]);
    assert.deepEqual(events(s, "factory.test_abandoned", mission.id).map((e) => [e.ref, e.sha]), [[done.authoring.stagingRef, null]]);
    assert.equal(fs.existsSync(fileAt(s.dir, done.authoring.stagingRef)), false, "nothing was written");
  } finally { await s.cleanup(); }
});

test("I7 DONE_LATE in TEST_AUTHORING and TEST_REVIEW: an answer that completed after the Pause is evaluated at „Reia”, never redone", async () => {
  const t = await stageZeroHub();
  try {
    const mission = await prepare(t);
    t.queue("claude", "author-slow:bug-ok");
    t.queue("codex", "test-review-slow:pass", "hang");
    await approveAndStart(t, mission.id);
    const lateAnswer = async (provider, stage) => {
      await untilRun(t, provider, mission.id, stage);
      // The Pause lands while the turn can no longer be stopped: the dispatch is INTERRUPTED, the answer still arrives (DONE_LATE).
      const interrupt = t.hub.runs.interrupt;
      t.hub.runs.interrupt = async () => ({ interrupted: false });
      try {
        await dispatch(t.hub, "factory.pause", { missionId: mission.id }, "ui");
        await waitFor(() => (stageDispatches(t, mission.id, stage).at(-1)?.status === "DONE_LATE" ? true : null), 30000, 50);
      } finally { t.hub.runs.interrupt = interrupt; }
      assert.equal(view(t, mission.id).factory.stage, "PAUSED");
      await dispatch(t.hub, "factory.resume", { missionId: mission.id }, "ui");
    };
    await lateAnswer("claude", "TEST_AUTHORING");
    await lateAnswer("codex", "TEST_REVIEW");
    await untilRun(t, "codex", mission.id, "IMPLEMENTING");
    assert.deepEqual(stageDispatches(t, mission.id, "TEST_AUTHORING").map((d) => d.status), ["DONE"], "evaluated, not redone");
    assert.deepEqual(stageDispatches(t, mission.id, "TEST_REVIEW").map((d) => d.status), ["DONE"]);
    assert.equal(view(t, mission.id).authoring.status, "PROTECTED");
    assert.ok(events(t, "factory.late_result", mission.id).length >= 2);
    await stopAndConfirm(t, mission.id);
  } finally { await t.cleanup(); }
});

test("I7 Pause and Stop in TEST_PROVING: the runner process is stopped, the proof is INTERRUPTED and stale (never classified), „Reia” runs it again; the Stop is confirmed once the process is gone and abandons the staged test in the work area", async () => {
  const t = await stageZeroHub();
  try {
    const mission = await prepare(t);
    t.queue("claude", "author:bug-slow");
    await approveAndStart(t, mission.id);
    const proving = () => waitFor(() => (view(t, mission.id).factory.stage === "TEST_PROVING" && t.hub.supervisor.list().some((p) => p.key.startsWith(`factory-run-${mission.id}-TEST_PROVING-`)) ? true : null), 60000, 20);
    await proving();
    await dispatch(t.hub, "factory.pause", { missionId: mission.id }, "ui");
    await untilStage(t, mission.id, ["PAUSED"]);
    await idle(t, mission.id);
    const interrupted = view(t, mission.id).evidence.filter((e) => e.stage === "TEST_PROVING");
    assert.ok(interrupted.length >= 1 && interrupted.every((e) => e.status === "INTERRUPTED" && e.stale), JSON.stringify(interrupted.map((e) => [e.status, e.stale])));
    assert.equal(view(t, mission.id).authoring.proof, null, "an interrupted proof is never classified");
    await dispatch(t.hub, "factory.resume", { missionId: mission.id }, "ui");
    await proving();
    const requested = (await dispatch(t.hub, "factory.stop", { missionId: mission.id }, "ui")).result;
    assert.ok(["CANCEL_REQUESTED", "CANCELLED"].includes(requested.factory.stage));
    const done = await untilStage(t, mission.id, ["CANCELLED"]);
    assert.equal(t.hub.supervisor.list().filter((p) => p.key.startsWith(`factory-run-${mission.id}-`)).length, 0);
    assert.deepEqual([done.authoring.status, done.authoring.abandoned.sha], ["ABANDONED", done.authoring.candidate.sha]);
    assert.equal(stageDispatches(t, mission.id, "TEST_REVIEW").length, 0);
  } finally { await t.cleanup(); }
});

test("I7 Stop in TEST_REVIEW: CANCELLED, the unfinished test stays only in .ifrim-hub/staging (ABANDONED, never deleted); a new mission on the same project then passes CHECKING — plain node --test never runs it (B1)", async () => {
  const t = await stageZeroHub();
  try {
    const mission = await prepare(t);
    t.queue("claude", "author:bug-ok");
    t.queue("codex", "hang");
    await approveAndStart(t, mission.id);
    await untilRun(t, "codex", mission.id, "TEST_REVIEW");
    const done = await stopAndConfirm(t, mission.id);
    const a = done.authoring;
    assert.ok(done.factory.stageReason.endsWith(T_STOP_STAGE0));
    assert.deepEqual([a.status, a.abandoned.sha, a.abandoned.hubWritten], ["ABANDONED", a.candidate.sha, true]);
    assert.deepEqual(events(t, "factory.test_abandoned", mission.id).map((e) => [e.ref, e.sha]), [[a.stagingRef, a.candidate.sha]]);
    assert.equal(shaOf(fileAt(t.dir, a.stagingRef)), a.candidate.sha, "left in the work area, never deleted by the Hub");
    assert.equal(fs.existsSync(fileAt(t.dir, a.testRef)), false);
    assert.deepEqual(t.hub.factory.hubWrites(t.project.id), { [a.stagingRef]: a.candidate.sha });
    // The next mission: an ordinary BUGFIX with the owner's own acceptance test; its checks run plain `node --test`.
    fs.writeFileSync(path.join(t.dir, "test", "single-space.test.mjs"), ['import test from "node:test";', 'import assert from "node:assert/strict";',
      'import { validateRequest } from "../src/requests.js";', "", 'test("un singur spațiu nu e un nume", () => {',
      '  assert.equal(validateRequest({ name: " ", email: "ana@example.ro", service: "audit" }).ok, false);', "});", ""].join("\n"));
    const next = await prepare(t, { input: { workType: "BUGFIX", title: "Un singur spațiu nu e un nume", objective: "Un nume format dintr-un singur spațiu trece de validare; trebuie refuzat.",
      spec: { inScope: ["src/requests.js"], acceptance: [{ id: "AC-1", text: "Un nume format dintr-un singur spațiu este refuzat", verify: "test", testRef: "test/single-space.test.mjs" }],
        verification: { checks: ["node --test"], acceptance: ["node --test test/single-space.test.mjs"] } } } });
    t.queue("codex", "factory-write:bug-partial");
    t.queue("claude", "review:pass");
    await approveAndStart(t, next.id);
    const delivered = await untilStage(t, next.id, SETTLED);
    assert.equal(delivered.factory.stage, "DELIVERY_READY", delivered.factory.stageReason);
    const checks = delivered.evidence.find((e) => e.stage === "CHECKING");
    assert.deepEqual([checks.command, checks.status, checks.counts.tests], ["node --test", "PASS", 4], "3 unit tests + the owner's test; the abandoned Hub test never ran");
  } finally { await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ I8
test("I8 crash between the author's answer and the staging write (write-ahead): after the restart nothing resumes by itself; „Reia” writes the file from the Hub's copy (same sha) without asking the author again", async () => {
  const t = await stageZeroHub();
  let second = null;
  try {
    const mission = await prepare(t);
    t.queue("claude", "author:bug-ok");
    t.queue("codex", "hang");
    await approveAndStart(t, mission.id);
    await untilRun(t, "codex", mission.id, "TEST_REVIEW");
    await pauseQuiet(t, mission.id);
    // The rows a crash right after the write-ahead record leaves (§5.1): `pending` recorded, the file not written, step 0 active.
    const { specId, prot } = stored(t, mission.id);
    const a = prot.authoring;
    const sha = a.candidate.sha;
    store(t, specId, { ...prot, authoring: { ...a, pending: { sha, cycle: a.candidate.cycle, runId: a.candidate.runId, manifest: a.candidate.manifest, lint: a.candidate.lint },
      candidate: null, proof: null, lastHubWrite: null } });
    t.hub.db.prepare("DELETE FROM factory_dispatches WHERE mission_id = ? AND stage = 'TEST_REVIEW'").run(mission.id);
    t.hub.db.prepare("DELETE FROM factory_evidence WHERE mission_id = ? AND stage = 'TEST_PROVING'").run(mission.id);
    t.hub.db.prepare("UPDATE factory_missions SET stage = 'TEST_AUTHORING' WHERE mission_id = ?").run(mission.id);
    fs.rmSync(fileAt(t.dir, a.stagingRef));
    ({ hub: second } = await restart(t));
    const s = { hub: second };
    const blocked = second.factory.view(mission.id);
    assert.equal(blocked.factory.stage, "BLOCKED");
    assert.match(blocked.factory.stageReason, /repornit în etapa TEST_AUTHORING/);
    assert.equal(fs.existsSync(fileAt(t.dir, a.stagingRef)), false, "nothing resumed by itself");
    t.queue("codex", "test-review:pass", "factory-write:bug-fix");
    t.queue("claude", "review:pass");
    await dispatch(second, "factory.resume", { missionId: mission.id }, "ui");
    const done = await untilStage(s, mission.id, SETTLED);
    assert.equal(done.factory.stage, "DELIVERY_READY", done.factory.stageReason);
    assert.equal(done.dispatches.filter((d) => d.stage === "TEST_AUTHORING").length, 1, "the author was not asked again");
    assert.equal(done.authoring.protectedSha, sha, "the same bytes, written from the Hub's copy");
    assert.equal(events(s, "factory.test_staged", mission.id).at(-1).sha, sha);
  } finally {
    if (second) await second.close(); else await t.hub.close().catch(() => {});
    dropData(t);
  }
});

test("I8 crash between the move to test/hub and the protection's transaction: „Reia” finishes the protection idempotently (no second move), then the baseline and the writer run on a new base", async () => {
  const t = await stageZeroHub();
  let second = null;
  try {
    const mission = await prepare(t);
    t.queue("claude", "author:bug-ok");
    t.queue("codex", "test-review:pass", "hang");
    await approveAndStart(t, mission.id);
    await untilRun(t, "codex", mission.id, "IMPLEMENTING");
    await pauseQuiet(t, mission.id);
    const { specId, prot } = stored(t, mission.id);
    const a = prot.authoring;
    unprotect(t, mission.id, specId, prot, "TEST_REVIEW");
    assert.equal(shaOf(fileAt(t.dir, a.testRef)), a.candidate.sha, "the file had already been moved");
    ({ hub: second } = await restart(t));
    const s = { hub: second };
    assert.equal(second.factory.view(mission.id).factory.stage, "BLOCKED");
    t.queue("codex", "factory-write:bug-fix");
    t.queue("claude", "review:pass");
    await dispatch(second, "factory.resume", { missionId: mission.id }, "ui");
    const done = await untilStage(s, mission.id, SETTLED);
    assert.equal(done.factory.stage, "DELIVERY_READY", done.factory.stageReason);
    assert.equal(done.authoring.status, "PROTECTED");
    assert.equal(shaOf(fileAt(t.dir, a.testRef)), a.candidate.sha);
    assert.equal(fs.existsSync(fileAt(t.dir, a.stagingRef)), false);
    assert.deepEqual(done.spec.protected.files, { [a.testRef]: a.candidate.sha });
    assert.equal(second.db.prepare("SELECT kind FROM factory_snapshots WHERE id = ?").get(done.factory.baseSnapshotId).kind, "base");
    assert.notEqual(done.factory.baseSnapshotId, a.preTestSnapshotId);
    assert.deepEqual(done.changeSets.at(-1).changes.map((c) => c.path).sort(), ["src/requests.js", "test/regression.test.mjs"], "the test is in the new base, not in the change set");
  } finally {
    if (second) await second.close(); else await t.hub.close().catch(() => {});
    dropData(t);
  }
});

// ------------------------------------------------------------------------------------------------------------------------------ I9
// Test mode only: the writer's 25 min become 2 s and the reviewer's 15 min 1.2 s on the wire; the plan's minutes stay 25 / 15.
const SCALE = 2000 / (25 * 60000);
test("I9 per-turn limits in step 0: the author runs under the REVIEWER's limit (15 min), the test review under the WRITER's (25 min); a timeout is retried exactly once, after the cooldown, then the owner decides", async () => {
  const clock = testClock();
  const t = await stageZeroHub({ clock });
  try {
    t.hub.factory.setTurnTimeScaleForTests(SCALE);
    const mission = await prepare(t, { limits: { maxAttemptsPerStage: 3 } });
    t.queue("claude", "hang", "hang");
    await approveAndStart(t, mission.id);
    const waiting = await untilWait(t, mission.id, "retry");
    assert.equal(waiting.factory.stage, "TEST_AUTHORING");
    assert.match(waiting.factory.stageReason, /^Etapa TEST_AUTHORING \(reviewer\) a depășit limita de 15 min pe tură \(încercarea 1 din 3\); o reiau o singură dată peste 60 s/);
    const [first] = events(t, "factory.turn_timeout", mission.id);
    assert.deepEqual([first.stage, first.role, first.limitMin, first.retry], ["TEST_AUTHORING", "reviewer", 15, true]);
    assert.equal(first.limitMs, Math.round(15 * 60000 * SCALE));
    await tickAt(t, mission.id);
    await tickAt(t, mission.id, TURN_RETRY_COOLDOWN_MS - 5000);
    assert.equal(stageDispatches(t, mission.id, "TEST_AUTHORING").length, 1, "never before the cooldown");
    await tickAt(t, mission.id, 6000);
    const decided = await untilStage(t, mission.id, ["NEEDS_OWNER_DECISION"]);
    assert.match(decided.factory.stageReason, /am reluat-o deja automat o dată/);
    assert.equal(stageDispatches(t, mission.id, "TEST_AUTHORING").length, 2, "exactly one automatic retry");
    await stopAndConfirm(t, mission.id);
    // The test review: Codex under the writer's limit.
    t.hub.factory.setTurnTimeScaleForTests(1);
    const second = await prepare(t);
    t.queue("claude", "author:bug-ok");
    t.queue("codex", "hang", "test-review:pass", "hang");
    await approveAndStart(t, second.id);
    await waitFor(() => (view(t, second.id).factory.stage === "TEST_PROVING" ? true : null), 60000, 5);
    t.hub.factory.setTurnTimeScaleForTests(SCALE);
    const retry = await untilWait(t, second.id, "retry");
    assert.equal(retry.factory.stage, "TEST_REVIEW");
    assert.match(retry.factory.stageReason, /^Etapa TEST_REVIEW \(writer\) a depășit limita de 25 min pe tură \(încercarea 1 din 2\)/);
    const [timeout] = events(t, "factory.turn_timeout", second.id);
    assert.deepEqual([timeout.role, timeout.limitMin], ["writer", 25]);
    t.hub.factory.setTurnTimeScaleForTests(1);
    await tickAt(t, second.id, TURN_RETRY_COOLDOWN_MS + 1000);
    await untilRun(t, "codex", second.id, "IMPLEMENTING");
    assert.equal(stageDispatches(t, second.id, "TEST_REVIEW").length, 2);
    assert.equal(view(t, second.id).authoring.status, "PROTECTED");
    await stopAndConfirm(t, second.id);
  } finally { await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ I10
test("I10 Stop All during TEST_REVIEW under a plan: CANCELLED and ABANDONED in the work area, the plan REVOKED, the gate suspended; after the owner's rearm (D22) a new plan on the same project reuses that path (the Hub's own bytes) and protects a new test", async () => {
  const t = await ownerProject();
  try {
    const mission = await prepare(t);
    t.queue("claude", "author:bug-ok");
    t.queue("codex", "hang");
    const envelope = await planAndConfirm(t);
    await untilRun(t, "codex", mission.id, "TEST_REVIEW");
    await dispatch(t.hub, "system.stop_all", { reason: "test" });
    // The Hub's deferred reactions to the stop (envelopes: setImmediate) run before the owner's next click, as they would over HTTP.
    await sleep(100);
    const cancelled = await untilStage(t, mission.id, ["CANCELLED"]);
    const a = cancelled.authoring;
    assert.deepEqual([a.status, a.abandoned.sha], ["ABANDONED", a.candidate.sha]);
    assert.equal(t.hub.envelopes.get(envelope.id).status, "REVOKED");
    assert.equal(t.hub.settings.get("executionGate").status, "suspended");
    await assert.rejects(dispatch(t.hub, "factory.resume", { missionId: mission.id }, "ui"), /CANCELLED/);
    // D22: only the owner's rearm (session + a fresh verification) reopens the gate; nothing old restarts by it.
    const card = await asOwner(t, "gate.rearm.card", {});
    await asOwner(t, "gate.rearm", { nonce: card.nonce, hash: card.hash }, t.owner.reauth());
    assert.equal(t.hub.settings.get("executionGate").status, "open");
    assert.equal(view(t, mission.id).factory.stage, "CANCELLED");
    const next = await prepare(t);
    t.queue("claude", "author:bug-ok-v2");
    t.queue("codex", "test-review:pass", "hang");
    await planAndConfirm(t);
    await untilRun(t, "codex", next.id, "IMPLEMENTING", 120000);
    const b = view(t, next.id).authoring;
    assert.equal(b.stagingRef, a.stagingRef, "the same work-area path, reused at the recorded sha");
    assert.notEqual(b.protectedSha, a.candidate.sha);
    assert.equal(shaOf(fileAt(t.dir, b.testRef)), b.protectedSha);
    assert.equal(stored(t, next.id).prot.authoring.lastHubWrite, null, "after the protection nothing of the Hub's is left in its work area");
    await stopAndConfirm(t, next.id);
  } finally { await t.cleanup(); }
});

test("I10 restart during the test review's turn: recover() leaves the mission BLOCKED (INTERRUPTED_UNKNOWN), no provider starts by itself; „Reia” repeats the review on the same bytes", async () => {
  const t = await stageZeroHub();
  let second = null;
  try {
    const mission = await prepare(t);
    t.queue("claude", "author:bug-ok");
    t.queue("codex", "hang");
    await approveAndStart(t, mission.id);
    await untilRun(t, "codex", mission.id, "TEST_REVIEW");
    await waitFor(() => t.hub.runs.activeRuns()[0]?.timeline?.turn_acknowledged, 30000);
    const launches = () => t.readLog("codex").filter((l) => l.launchArgs).length;
    const before = launches();
    let report;
    ({ hub: second, report } = await restart(t, { live: false }));
    const s = { hub: second };
    assert.ok(report.factory.some((r) => r.missionId === mission.id && r.stage === "TEST_REVIEW"));
    const v = second.factory.view(mission.id);
    assert.equal(v.factory.stage, "BLOCKED");
    assert.match(v.factory.stageReason, /repornit în etapa TEST_REVIEW/);
    assert.equal(v.dispatches.at(-1).status, "INTERRUPTED_UNKNOWN");
    await sleep(1500);
    assert.equal(launches(), before, "no provider process started after the restart");
    await enableLive(second, { provider: "codex", access: "workspace-write", attempts: 1 });
    t.queue("codex", "test-review:pass", "hang");
    await dispatch(second, "factory.resume", { missionId: mission.id }, "ui");
    await untilRun(s, "codex", mission.id, "IMPLEMENTING");
    const reviews = second.factory.view(mission.id).dispatches.filter((d) => d.stage === "TEST_REVIEW");
    assert.deepEqual(reviews.map((d) => [d.status, d.request.attempt, d.request.counted]), [["INTERRUPTED_UNKNOWN", 1, 1], ["DONE", 2, 2]]);
    await dispatch(second, "factory.stop", { missionId: mission.id }, "ui");
    await untilStage(s, mission.id, ["CANCELLED"]);
  } finally {
    if (second) await second.close(); else await t.hub.close().catch(() => {});
    dropData(t);
  }
});

test("I10 the plan revoked while the proof runs: nothing new reaches a model after the revocation (the next step is refused at the gate, or the mission paused)", async () => {
  const t = await ownerProject();
  try {
    const mission = await prepare(t);
    t.queue("claude", "author:bug-slow");
    t.queue("codex", "test-review:pass");
    const envelope = await planAndConfirm(t);
    await waitFor(() => (view(t, mission.id).factory.stage === "TEST_PROVING" && t.hub.supervisor.list().some((p) => p.key.startsWith(`factory-run-${mission.id}-TEST_PROVING-`)) ? true : null), 60000, 20);
    await dispatch(t.hub, "envelope.revoke", { envelopeId: envelope.id });
    const settled = await untilStage(t, mission.id, SETTLED);
    // Wave A: owner/envelopes.mjs PAUSABLE does not list step 0 yet, so the proof finishes and the review is refused at the gate (the
    // plan is closed); wave B adds the stages and the revocation pauses the proof at once. Either way no turn reaches Codex.
    assert.ok(["BLOCKED", "PAUSED"].includes(settled.factory.stage), settled.factory.stageReason);
    assert.ok(t.hub.db.prepare("SELECT status FROM agent_runs WHERE provider = 'codex'").all().every((r) => r.status === "blocked"));
    assert.equal(t.readLog("codex").filter((l) => l.method === "turn/start").length, 0, "no turn was sent to Codex");
    assert.equal(fs.existsSync(fileAt(t.dir, settled.authoring.testRef)), false);
  } finally { await t.cleanup(); }
});

test("I10 the mission's deadline passes during TEST_AUTHORING: tick() interrupts the turn and the owner decides", async () => {
  const clock = testClock();
  const t = await stageZeroHub({ clock });
  try {
    const mission = await prepare(t, { limits: { maxDurationMin: 10 } });
    t.queue("claude", "hang");
    await approveAndStart(t, mission.id);
    await untilRun(t, "claude", mission.id, "TEST_AUTHORING");
    await tickAt(t, mission.id, 11 * 60000);
    const waiting = await untilStage(t, mission.id, ["NEEDS_OWNER_DECISION"]);
    assert.match(waiting.factory.stageReason, /Limita de timp a misiunii a fost atinsă/);
    await noRuns(t);
    assert.equal(stageDispatches(t, mission.id, "TEST_AUTHORING")[0].status, "INTERRUPTED");
  } finally { await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ I11
test("I11 budget at the factory level: grantsNeeded counts the author cycles still ahead; two author cycles plus two repair cycles finish inside grants of exactly that size (never refused); step 0's notes never reach a repair brief", async () => {
  const t = await stageZeroHub({ attempts: 5 });
  try {
    const mission = await prepare(t, { limits: { maxAttemptsPerStage: 1 } });
    const needed = view(t, mission.id).grantsNeeded;
    assert.deepEqual(needed.map((g) => [g.provider, g.access, g.attempts]), [["codex", "workspace-write", 5], ["claude", "read-only", 5]]);
    assert.match(needed[0].why, /verificarea testului scris de Hub \(doar citire, cel mult 2\)/);
    assert.match(needed[1].why, /scrierea testului de acceptanță \(doar citire, cel mult 2\)/);
    assert.equal(t.hub.factory.remainingAuthoring(mission.id), 2);
    t.queue("claude", "author:bug-ok", "author:bug-ok-v2", "review:changes-dedupe", "review:pass");
    t.queue("codex", "test-review:changes", "test-review:pass-note", "factory-write:bug-partial", "factory-write:bug-fix", "factory-write:bug-fix-v2");
    await approveAndStart(t, mission.id);
    const done = await untilStage(t, mission.id, SETTLED, 240000);
    assert.equal(done.factory.stage, "DELIVERY_READY", done.factory.stageReason);
    assert.equal(done.factory.repairCycles, 2);
    assert.equal(done.authoring.cycle, 1, "two author cycles");
    assert.ok(done.dispatches.every((d) => d.status === "DONE" && d.request.counted === 1), JSON.stringify(done.dispatches.map((d) => [d.stage, d.status, d.request.counted])));
    const grants = Object.fromEntries(t.hub.db.prepare("SELECT provider, attempts_used, max_attempts FROM live_grants WHERE project_id = ?").all(t.project.id).map((g) => [g.provider, [g.attempts_used, g.max_attempts]]));
    assert.deepEqual(grants, { codex: [5, 5], claude: [4, 5] }, "two test reviews + three writer turns; two authors + two code reviews");
    assert.equal(t.hub.factory.remainingAuthoring(mission.id), 0);
    assert.equal(done.grantsNeeded[0].attempts, 3);
    const notes = done.findings.filter((f) => f.source === "test_review").map((f) => [f.code, f.severity, f.status]);
    assert.deepEqual(notes, [["T-001", "high", "RESOLVED"], ["T-002", "info", "SUPERSEDED"]]);
    const repairBriefs = briefsOf(t, done.mission.conversationId).filter((b) => /^# Remediere ciclul/.test(b));
    assert.equal(repairBriefs.length, 2);
    assert.ok(repairBriefs.every((b) => !/\bT-00\d\b/.test(b)), "step 0's findings never reach a repair brief");
  } finally { await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ I12
test("I12 a manual handoff from either step-0 conversation is refused while the mission works (one writer); after a Pause it is allowed again", async () => {
  const t = await stageZeroHub();
  try {
    const mission = await prepare(t);
    t.queue("claude", "hang", "author:bug-ok");
    t.queue("codex", "hang");
    await approveAndStart(t, mission.id);
    await untilRun(t, "claude", mission.id, "TEST_AUTHORING");
    const a = view(t, mission.id).authoring;
    await assert.rejects(dispatch(t.hub, "handoff.begin", { conversationId: a.authorConversationId, toProvider: "codex" }), /etapa TEST_AUTHORING.*pauză sau oprește/);
    await assert.rejects(dispatch(t.hub, "handoff.begin", { conversationId: a.testReviewConversationId, toProvider: "claude" }), /etapa TEST_AUTHORING.*pauză sau oprește/);
    await pauseQuiet(t, mission.id);
    const allowed = (await dispatch(t.hub, "handoff.begin", { conversationId: a.authorConversationId, toProvider: "codex" })).result;
    await dispatch(t.hub, "handoff.cancel", { handoffId: allowed.id });
    await dispatch(t.hub, "factory.resume", { missionId: mission.id }, "ui");
    await untilRun(t, "codex", mission.id, "TEST_REVIEW");
    await assert.rejects(dispatch(t.hub, "handoff.begin", { conversationId: a.testReviewConversationId, toProvider: "claude" }), /etapa TEST_REVIEW.*pauză sau oprește/);
    await stopAndConfirm(t, mission.id);
  } finally { await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ U11
test("U11 safe write (S2): a junction on .ifrim-hub refuses the start; a junction on test/hub refuses the protection — nothing goes through a link, the test stays in the work area", async () => {
  const t = await stageZeroHub();
  try {
    const outside = path.join(t.dataDir, "outside-a");
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(t.dir, ".ifrim-hub"), "junction");
    const mission = await prepare(t);
    await assert.rejects(approveAndStart(t, mission.id), /legătură \(link sau joncțiune\)/);
    assert.equal(view(t, mission.id).factory.stage, "SPEC_DRAFT");
    assert.deepEqual(fs.readdirSync(outside), [], "nothing created through the junction");
  } finally { await t.cleanup(); }
  const s = await stageZeroHub();
  try {
    const mission = await prepare(s);
    s.queue("claude", "author:bug-ok");
    s.queue("codex", "test-review-slow:pass");
    await approveAndStart(s, mission.id);
    await untilRun(s, "codex", mission.id, "TEST_REVIEW");
    const outside = path.join(s.dataDir, "outside-b");
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(s.dir, "test", "hub"), "junction");
    const stopped = await untilStage(s, mission.id, SETTLED);
    assert.equal(stopped.factory.stage, "NEEDS_OWNER_DECISION");
    const a = stopped.authoring;
    assert.equal(stopped.factory.stageReason, T_PROJECT_CHANGED([a.testRef]));
    assert.match(a.blocked.details.join(" "), /legătură \(link sau joncțiune\)/);
    assert.deepEqual(fs.readdirSync(outside), [], "nothing moved through the junction");
    assert.equal(shaOf(fileAt(s.dir, a.stagingRef)), a.candidate.sha, "the test stays in the work area");
    assert.equal(a.status, "AUTHORING");
  } finally { await s.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ scope
test("assertStartable: a test-first spec is refused with T1 on a real project, on a test project registered as ProDelivery and on the ifrim-runner route — whatever built the spec", async () => {
  const t = await stageZeroHub({ name: "ProDelivery" });
  try {
    assert.equal(t.project.slug, "prodelivery");
    const mission = await prepare(t);
    await assert.rejects(approveAndStart(t, mission.id), (e) => e.message === T1("ProDelivery"));
    assert.equal(view(t, mission.id).factory.stage, "SPEC_DRAFT");
    const real = t.hub.projects.hub();
    assert.notEqual(real.source, "hub-test");
    const r = { ...t, project: real };
    const realMission = await prepare(r);
    await assert.rejects(approveAndStart(r, realMission.id), (e) => e.message === T1(real.name));
    assert.equal(view(t, realMission.id).factory.stage, "SPEC_DRAFT");
  } finally { await t.cleanup(); }
  const s = await stageZeroHub({ wsl: true });
  try {
    await dispatch(s.hub, "environment.inspect", { environmentId: "wsl-runner" });
    await dispatch(s.hub, "environment.probe", { environmentId: "wsl-runner" });
    await dispatch(s.hub, "environment.attest", { environmentId: "wsl-runner" });
    await dispatch(s.hub, "project.environment.set", { projectId: s.project.id, environment: "wsl-runner" });
    const mission = await prepare(s);
    assert.ok(view(s, mission.id).scope, JSON.stringify(view(s, mission.id).scopeProblems));
    // Review wave B (authority #4): a TEST project on another route is refused with the route as the reason (T1_ROUTE), not as a real project.
    await assert.rejects(approveAndStart(s, mission.id), (e) => e.message === T1_ROUTE(s.project.name) && e.code === "TEST_FIRST_SCOPE");
  } finally { await s.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ wave A repair
// Regressions for the wave A review (state findings 1–6, security findings 1–10), PASS_SIMULATED like everything above.

/** Calls `fire()` once, right after the Hub renames its staged test into test/hub/ (inside the protection, before its transaction). */
function onMoveToTestHub(fire) {
  const original = fs.renameSync;
  let fired = false;
  fs.renameSync = function patched(from, to) {
    const out = original.apply(this, arguments);
    if (!fired && /[\\/]test[\\/]hub[\\/][^\\/]+\.test\.mjs$/.test(String(to)) && !/\.tmp$/.test(String(from))) { fired = true; fire(); }
    return out;
  };
  return { restore: () => { fs.renameSync = original; }, fired: () => fired };
}

test("repair 1: a Pause or a Stop that lands while the test is being protected is kept — the test is protected, the writer never starts; „Reia” goes on to the baseline, the Stop withdraws the test", async () => {
  const t = await stageZeroHub();
  try {
    const mission = await prepare(t);
    t.queue("claude", "author:bug-ok");
    t.queue("codex", "test-review:pass", "hang");
    const hook = onMoveToTestHub(() => { t.hub.factory.pause(mission.id, { actor: "user" }).catch(() => {}); });
    try {
      await approveAndStart(t, mission.id);
      await waitFor(() => (hook.fired() ? true : null), 120000, 20);
      await idle(t, mission.id);
    } finally { hook.restore(); }
    const paused = view(t, mission.id);
    assert.equal(paused.factory.stage, "PAUSED", paused.factory.stageReason);
    assert.equal(paused.authoring.status, "PROTECTED", "the protection's rows committed (never a half-protected test)");
    assert.equal(stageDispatches(t, mission.id, "IMPLEMENTING").length, 0, "no writer turn after the Pause");
    assert.equal(paused.evidence.filter((e) => e.stage === "BASELINE").length, 0);
    assert.ok(!stagesOf(t, mission.id).includes("BASELINE"), "the Pause was never overwritten by BASELINE");
    await dispatch(t.hub, "factory.resume", { missionId: mission.id }, "ui");
    await untilRun(t, "codex", mission.id, "IMPLEMENTING", 90000);
    assert.equal(view(t, mission.id).evidence.filter((e) => e.stage === "BASELINE").length, 1, "the resume ran the baseline, then the writer");
    await stopAndConfirm(t, mission.id);
  } finally { await t.cleanup(); }
  const s = await stageZeroHub();
  try {
    const mission = await prepare(s);
    s.queue("claude", "author:bug-ok");
    s.queue("codex", "test-review:pass", "hang");
    const hook = onMoveToTestHub(() => { s.hub.factory.stop(mission.id, { actor: "user" }).catch(() => {}); });
    let done;
    try {
      await approveAndStart(s, mission.id);
      done = await untilStage(s, mission.id, ["CANCELLED"], 120000);
    } finally { hook.restore(); }
    await idle(s, mission.id);
    const a = view(s, mission.id).authoring;
    assert.equal(stageDispatches(s, mission.id, "IMPLEMENTING").length, 0, "no writer turn after the Stop");
    assert.ok(!stagesOf(s, mission.id).includes("BASELINE"));
    assert.deepEqual([a.status, a.abandoned.wasProtected, a.abandoned.withdrawnFrom], ["ABANDONED", true, a.testRef]);
    assert.equal(fs.existsSync(fileAt(s.dir, a.testRef)), false, "the test is not left under test/");
    assert.equal(shaOf(fileAt(s.dir, a.stagingRef)), a.protectedSha);
    assert.match(done.factory.stageReason, /a fost mutat înapoi din test\/hub\//);
  } finally { await s.cleanup(); }
});

test("repair 2: two unreadable author answers (or a second INCONCLUSIVE test review) are an exhausted step — „Reia” gives it one more attempt instead of looping at the owner", async () => {
  const t = await stageZeroHub();
  try {
    const mission = await prepare(t);
    t.queue("claude", "ok", "ok", "author:bug-ok");
    t.queue("codex", "test-review:pass", "hang");
    await approveAndStart(t, mission.id);
    const stuck = await untilStage(t, mission.id, SETTLED);
    assert.equal(stuck.factory.stage, "NEEDS_OWNER_DECISION");
    assert.match(stuck.factory.stageReason, /^TEST_AUTHORING: 2 încercări folosite/);
    assert.deepEqual(t.hub.factory.exhaustedStep(mission.id), { stage: "TEST_AUTHORING", counted: 2, limit: 2 }, "a plan can offer the one more attempt");
    assert.deepEqual(t.hub.factory.continuationScope(mission.id).exhausted, { stage: "TEST_AUTHORING", counted: 2, limit: 2 });
    await dispatch(t.hub, "factory.resume", { missionId: mission.id }, "ui");
    await untilRun(t, "codex", mission.id, "IMPLEMENTING", 120000);
    assert.deepEqual(stageDispatches(t, mission.id, "TEST_AUTHORING").map((d) => [d.request.cycle, d.request.counted]), [[0, 1], [0, 2], [0, 3]]);
    assert.equal(events(t, "factory.extra_attempt", mission.id).at(-1).stage, "TEST_AUTHORING");
    assert.equal(view(t, mission.id).authoring.status, "PROTECTED");
    await stopAndConfirm(t, mission.id);
  } finally { await t.cleanup(); }
  const s = await stageZeroHub();
  try {
    const mission = await prepare(s);
    s.queue("claude", "author:bug-ok");
    s.queue("codex", "test-review:inconclusive", "test-review:inconclusive", "test-review:pass", "hang");
    await approveAndStart(s, mission.id);
    await untilStage(s, mission.id, ["NEEDS_OWNER_DECISION"]);
    assert.equal(s.hub.factory.exhaustedStep(mission.id), null, "one review used, one left");
    await dispatch(s.hub, "factory.resume", { missionId: mission.id }, "ui");
    await idle(s, mission.id);
    await untilStage(s, mission.id, ["NEEDS_OWNER_DECISION"]);
    assert.equal(stageDispatches(s, mission.id, "TEST_REVIEW").length, 2);
    // Before the repair the next „Reia” hit the limit without a dispatch row, again and again.
    assert.deepEqual(s.hub.factory.exhaustedStep(mission.id), { stage: "TEST_REVIEW", counted: 2, limit: 2 });
    await dispatch(s.hub, "factory.resume", { missionId: mission.id }, "ui");
    await untilRun(s, "codex", mission.id, "IMPLEMENTING", 120000);
    assert.deepEqual(stageDispatches(s, mission.id, "TEST_REVIEW").map((d) => d.request.counted), [1, 2, 3]);
    assert.equal(view(s, mission.id).authoring.status, "PROTECTED");
    await stopAndConfirm(s, mission.id);
  } finally { await s.cleanup(); }
});

test("repair 3: a reviewed test left under test/hub by a crash before the protection's record is moved back on Stop; a rejected delivery withdraws its protected test; another file in the way moves nothing and says so", async () => {
  const t = await stageZeroHub();
  try {
    const mission = await prepare(t);
    t.queue("claude", "author:bug-ok");
    t.queue("codex", "test-review:pass", "hang");
    t.hub.factory.setStartFaultForTests((point) => { if (point === "protect_record") t.hub.factory.pause(mission.id).catch(() => {}); });
    await approveAndStart(t, mission.id);
    await waitFor(() => view(t, mission.id).authoring?.status === "PROTECTED", 30000, 30);
    await t.hub.factory.idle(mission.id);
    assert.equal(t.hub.factory.writerStarted(mission.id), false);
    // The rows a crash between the move and the protection's transaction leaves (as in I8); the owner then stops instead of resuming.
    const { specId, prot } = stored(t, mission.id);
    const a = prot.authoring;
    unprotect(t, mission.id, specId, prot, "BLOCKED");
    assert.equal(shaOf(fileAt(t.dir, a.testRef)), a.candidate.sha);
    const done = await stopAndConfirm(t, mission.id);
    const ab = done.authoring.abandoned;
    assert.deepEqual([ab.ref, ab.sha, ab.withdrawnFrom, ab.wasProtected, ab.problem], [a.stagingRef, a.candidate.sha, a.testRef, false, null]);
    assert.equal(fs.existsSync(fileAt(t.dir, a.testRef)), false, "never left unprotected under test/ (§5.5)");
    assert.equal(shaOf(fileAt(t.dir, a.stagingRef)), a.candidate.sha);
    assert.ok(done.factory.stageReason.endsWith(`Testul scris de Hub a fost mutat înapoi din ${a.testRef} în zona de lucru a Hub-ului (${a.stagingRef}): nu mai face parte din teste și nu rulează.`), done.factory.stageReason);
  } finally { await t.cleanup(); }
  const s = await stageZeroHub();
  try {
    const mission = await prepare(s);
    s.queue("claude", "author:bug-ok", "review:pass");
    s.queue("codex", "test-review:pass", "factory-write:bug-fix");
    await approveAndStart(s, mission.id);
    const ready = await untilStage(s, mission.id, SETTLED, 180000);
    assert.equal(ready.factory.stage, "DELIVERY_READY", ready.factory.stageReason);
    const rejected = (await dispatch(s.hub, "factory.reject", { missionId: mission.id, note: "Nu vreau schimbarea asta" })).result;
    const a = rejected.authoring;
    assert.equal(rejected.factory.stage, "REJECTED");
    assert.equal(s.hub.factory.writerStarted(mission.id), true);
    assert.deepEqual([a.status, a.abandoned.why, a.abandoned.withdrawnFrom], ["ABANDONED", "reject", a.testRef]);
    assert.equal(fs.existsSync(fileAt(s.dir, a.testRef)), false);
    assert.equal(shaOf(fileAt(s.dir, a.stagingRef)), a.protectedSha);
    assert.match(rejected.factory.stageReason, /^Respins de proprietar: Nu vreau schimbarea asta\. Testul scris de Hub a fost mutat înapoi/);
    assert.equal(events(s, "factory.test_abandoned", mission.id).length, 1);
  } finally { await s.cleanup(); }
  const u = await stageZeroHub();
  try {
    const mission = await prepare(u);
    u.queue("claude", "author:bug-ok");
    u.queue("codex", "test-review:pass", "hang");
    u.hub.factory.setStartFaultForTests((point) => { if (point === "protect_record") u.hub.factory.pause(mission.id).catch(() => {}); });
    await approveAndStart(u, mission.id);
    await waitFor(() => view(u, mission.id).authoring?.status === "PROTECTED", 30000, 30);
    await u.hub.factory.idle(mission.id);
    assert.equal(u.hub.factory.writerStarted(mission.id), false);
    const a = view(u, mission.id).authoring;
    fs.writeFileSync(fileAt(u.dir, a.stagingRef), "// fișierul altcuiva\n");
    const done = await stopAndConfirm(u, mission.id);
    assert.equal(shaOf(fileAt(u.dir, a.testRef)), a.protectedSha, "left where it was");
    assert.deepEqual([done.authoring.abandoned.ref, done.authoring.abandoned.withdrawnFrom], [a.testRef, null]);
    assert.match(done.factory.stageReason, new RegExp(`Testul scris de Hub a rămas în ${a.testRef.replace(/[.]/g, "\\.")}: nu l-am putut muta înapoi .*e deja ocupat\\)\\. Nu îl șterg`));
  } finally { await u.cleanup(); }
});

test("repair 4: on a test-first mission a writer change that reads NODE_ENV goes back to the writer before any check (high test_switch_added), then the honest fix is delivered; the writer brief states the rule", async () => {
  const t = await stageZeroHub();
  try {
    const mission = await prepare(t);
    t.queue("claude", "author:bug-ok", "review:pass");
    t.queue("codex", "test-review:pass", "factory-write:bug-env-switch", "factory-write:bug-fix");
    await approveAndStart(t, mission.id);
    const done = await untilStage(t, mission.id, SETTLED, 180000);
    assert.equal(done.factory.stage, "DELIVERY_READY", done.factory.stageReason);
    const [cheat, fixed] = done.changeSets;
    const leak = done.findings.find((f) => f.source === "integrity" && f.changeSetId === cheat.id);
    assert.deepEqual([leak.fingerprint, leak.severity, leak.file], ["integrity:test_switch_added:src/requests.js", "high", "src/requests.js"]);
    assert.equal(done.evidence.filter((e) => e.changeSetId === cheat.id).length, 0, "nothing was checked on the cheating version");
    assert.deepEqual(stagesOf(t, mission.id).slice(4), ["IMPLEMENTING", "REPAIRING", "CHECKING", "REVIEWING", "QA", "DELIVERY_READY"]);
    assert.equal(done.factory.repairCycles, 1);
    assert.equal(done.findings.filter((f) => f.source === "integrity" && f.changeSetId === fixed.id).length, 0);
    const briefs = briefsOf(t, done.mission.conversationId);
    assert.match(briefs.find((b) => /^# Implementare/.test(b)), /nu citi felul în care e rulat codul \(NODE_ENV, process\.argv, node:test, CI\)/);
    assert.match(briefs.at(-1), /^# Remediere ciclul 1[\s\S]*I-\d{3} \[high\] src\/requests\.js: Un fișier sursă a început să citească felul în care e rulat/);
  } finally { await t.cleanup(); }
});

test("repair 5: a proof run that plants a file under node_modules (a folder the snapshot never reads) is NOT_HERMETIC — the owner decides, nothing is rewritten", async () => {
  const t = await stageZeroHub();
  try {
    const mission = await prepare(t);
    t.queue("claude", "author:bug-writes-deps");
    await approveAndStart(t, mission.id);
    const stopped = await untilStage(t, mission.id, SETTLED);
    assert.equal(stopped.factory.stage, "NEEDS_OWNER_DECISION");
    assert.deepEqual([stopped.authoring.proof.verdict, stopped.authoring.blocked.kind], ["NOT_HERMETIC", "not_hermetic"]);
    assert.ok(stopped.authoring.blocked.files.includes("node_modules/hub-proof/index.js"), JSON.stringify(stopped.authoring.blocked.files));
    assert.match(stopped.factory.stageReason, /^Testul a lăsat fișiere în proiect \(.*node_modules/);
    assert.equal(stageDispatches(t, mission.id, "TEST_AUTHORING").length, 1);
    assert.equal(stageDispatches(t, mission.id, "TEST_REVIEW").length, 0);
  } finally { await t.cleanup(); }
});

test("repair 6: the route checked again in step 0 — moved off Windows before the proof, the mission waits (no proof runs); back on Windows, „Reia” proves and protects", async () => {
  const t = await stageZeroHub();
  try {
    const mission = await prepare(t);
    t.queue("claude", "author-slow:bug-ok");
    t.queue("codex", "test-review:pass", "hang");
    await approveAndStart(t, mission.id);
    await untilRun(t, "claude", mission.id, "TEST_AUTHORING");
    const original = t.hub.factoryRunner.routeOf;
    t.hub.factoryRunner.routeOf = () => "wsl-runner";
    let waiting;
    try { waiting = await untilStage(t, mission.id, SETTLED); } finally { t.hub.factoryRunner.routeOf = original; }
    assert.equal(waiting.factory.stage, "NEEDS_OWNER_DECISION");
    assert.match(waiting.factory.stageReason, /^Ruta de execuție a proiectului s-a schimbat în timpul pasului 0 \(acum wsl-runner\)/);
    assert.equal(waiting.evidence.filter((e) => e.stage === "TEST_PROVING").length, 0, "no proof on another route");
    assert.equal(waiting.authoring.blocked, null, "not a hold: a resume runs the step again");
    await dispatch(t.hub, "factory.resume", { missionId: mission.id }, "ui");
    await untilRun(t, "codex", mission.id, "IMPLEMENTING", 120000);
    assert.equal(view(t, mission.id).authoring.status, "PROTECTED");
    await stopAndConfirm(t, mission.id);
  } finally { await t.cleanup(); }
});
