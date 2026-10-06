// Milestone 10.2 — U09: an engineering request in the owner's words becomes ONE Software Factory draft plus ONE envelope
// (PASS_SIMULATED: fixture providers, software authenticator, test projects; no model). No lega.mission_request card (owner
// decision 1); the models are explicit — the role defaults or the owner's per-project override — shown and hashed in the plan
// (decision 4); the Hub's own repository is refused (decision 10); a request that cannot be verified gets ONE question; a draft
// the planner made and nobody started is withdrawn when its plan is superseded / expires; factory.prepare from the UI is unchanged.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeTestHub, waitFor, enrolOwner, prepareLiveWithoutGrants } from "./helpers.mjs";
import { materializeFixture, demoSpec, FIXTURE_ROOT } from "../server/factory/fixtures.mjs";
import { ROLE_DEFAULT_BINDINGS, defaultModelLimits } from "../server/factory/plan.mjs";
import { PILOT_MODELS } from "../server/intel/packages.mjs";
import { workTypeOf, buildEngineeringSpec } from "../server/owner/planners/engineering.mjs";

const dispatch = (hub, type, payload, extra = {}) => hub.commands.dispatch({ type, payload, channel: "test", actor: "test", ...extra });
const SETTLED = ["DELIVERY_READY", "NEEDS_OWNER_DECISION", "BLOCKED", "PAUSED", "CANCELLED", "ACCEPTED", "REJECTED"];
const FORBIDDEN_WORDS = /LIVE_VALIDATION|grant|OPEN GATE/i;
const BUG = "Repară bug-ul: un nume format doar din spații trece de validare. Testul de acceptanță e test/acceptance.test.mjs.";

/** A test Hub whose Codex account lists the role-default writer model (gpt-6.1-sol), a bug-demo test project and the owner. */
async function plannerHub({ level = null, codexModels = [{ id: "gpt-6.1-sol", isDefault: true, efforts: ["medium", "high"] }, { id: "gpt-fake-sol", efforts: ["medium", "high"] }] } = {}) {
  const t = await makeTestHub({ queues: true });
  if (codexModels) fs.writeFileSync(`${t.logs.codex}.models.json`, JSON.stringify(codexModels));
  await prepareLiveWithoutGrants(t.hub);
  const dir = path.join(t.dataDir, "factory-bug-demo");
  materializeFixture("bug-demo", dir);
  const project = (await dispatch(t.hub, "project.register_test", { path: dir })).result;
  const owner = await enrolOwner(t);
  if (level) await dispatch(t.hub, "owner.autonomy.set", { projectId: project.id, level }, { ownerSession: owner.reauth() });
  const ctx = { channel: "owner", ownerSession: owner.session, actor: "owner" };
  return { ...t, project, dir, owner, ctx };
}
const plan = (t, input, ctx = t.ctx) => t.hub.intake.plan({ kind: "engineering", ...input }, ctx);
const count = (t, sql, ...args) => t.hub.db.prepare(sql).get(...args).n;
const commandCount = (t, type) => count(t, "SELECT COUNT(*) AS n FROM commands WHERE type = ?", type);
const view = (t, id) => t.hub.factory.view(id);
const untilStage = (t, id, stages, ms = 90000) => waitFor(() => (stages.includes(view(t, id).factory.stage) ? view(t, id) : null), ms, 100);

test("M10.2-EP-01 a bug request on a test project → ONE draft + ONE envelope with the role-default models (shown, hashed); one click runs it in BUILD_SAFE with derived grants", async () => {
  const t = await plannerHub();
  try {
    const r = await plan(t, { text: `Lega, ${BUG}`, projectId: t.project.id });
    assert.equal(r.refused, undefined, JSON.stringify(r));
    const env = r.plan?.envelope;
    assert.ok(env?.id, JSON.stringify(r.message || r.plan));
    assert.equal(env.status, "PROPOSED");
    const missionId = env.missionIds[0];
    const draft = view(t, missionId);
    assert.equal(draft.factory.stage, "SPEC_DRAFT");
    assert.equal(draft.factory.workType, "BUGFIX");
    assert.equal(draft.spec.spec.acceptance[0].testRef, "test/acceptance.test.mjs");
    assert.deepEqual(draft.spec.spec.verification.acceptance, ["node --test test/acceptance.test.mjs"]);
    // Decision 4: the role defaults, explicit in the limits → in the scope hash → shown and hashed in the envelope.
    assert.deepEqual([draft.factory.limits.writerModel, draft.factory.limits.writerEffort, draft.factory.limits.reviewerModel, draft.factory.limits.reviewerEffort],
      [PILOT_MODELS.writer.model, PILOT_MODELS.writer.effort, PILOT_MODELS.reviewer.model, PILOT_MODELS.reviewer.effort]);
    assert.match(env.body.models[missionId].writer, /gpt-6\.1-sol/);
    assert.match(env.body.models[missionId].reviewer, /sonnet/);
    assert.match(r.plan.summary.models, /writer .*gpt-6\.1-sol.*reviewer .*sonnet/);
    assert.match(r.note, /implicite pe rol/);
    assert.match(r.note, /nu folosesc implicitul contului/);
    assert.ok(env.body.missions[0].scopeHash, "the models are part of the hashed scope");
    // Provenance (an event; factory_missions has no column for it) and no approval card of any kind (decision 1).
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM events WHERE type = 'factory.provenance' AND scope_id = ? AND json_extract(payload_json, '$.createdBy') = 'intake'", missionId) >= 1, true);
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM events WHERE type = 'factory.provenance' AND scope_id = ? AND json_extract(payload_json, '$.envelopeId') = ?", missionId, env.id), 1);
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM approvals"), 0, "no lega.mission_request (or any other) approval card");
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM agent_runs"), 0, "the draft runs nothing");
    assert.equal(t.hub.grants.ofEnvelope(env.id).length, 0, "no grant before the confirmation");

    // ONE confirmation (click) — then the plan runs its own steps while the Hub stays in BUILD_SAFE (U02).
    t.queue("codex", "factory-write:bug-fix");
    t.queue("claude", "review:pass");
    const modeBefore = count(t, "SELECT COUNT(*) AS n FROM events WHERE type = 'settings.changed' AND json_extract(payload_json, '$.key') = 'mode'");
    const confirmed = (await dispatch(t.hub, "envelope.confirm", { envelopeId: env.id, nonce: env.nonce, displayedHash: env.envelopeHash }, { ownerSession: t.owner.session })).result;
    assert.equal(confirmed.envelope.status, "ACTIVE");
    assert.equal(t.hub.settings.get("mode"), "BUILD_SAFE");
    const derived = t.hub.grants.ofEnvelope(env.id);
    assert.deepEqual(derived.map((g) => `${g.provider}:${g.access}`).sort(), ["claude:read-only", "codex:workspace-write"]);
    for (const g of derived) assert.ok(g.envelopeId === env.id && g.binding?.bindingHash, `derived grant bound to the plan and its model: ${JSON.stringify(g)}`);
    assert.equal(derived.find((g) => g.provider === "codex").binding.model, "gpt-6.1-sol");
    const approval = t.hub.db.prepare("SELECT * FROM approvals WHERE action_kind = 'factory.scope'").get();
    assert.equal(approval.decided_via, "owner_session", "factory.start decided by the envelope (decideByEnvelope), not a fictive click");
    const done = await untilStage(t, missionId, SETTLED);
    assert.equal(done.factory.stage, "DELIVERY_READY", done.factory.stageReason);
    const runs = t.hub.db.prepare("SELECT provider, grant_id, model FROM agent_runs").all();
    assert.ok(runs.length >= 2 && runs.every((x) => derived.some((g) => g.id === x.grant_id)), JSON.stringify(runs));
    assert.ok(runs.some((x) => x.provider === "codex" && x.model === "gpt-6.1-sol"), `the writer ran the shown model: ${JSON.stringify(runs)}`);
    assert.ok(runs.every((x) => ["codex", "claude"].includes(x.provider)), "checks / QA ran on the Hub runner, without a grant or a model run");
    assert.equal(t.hub.settings.get("mode"), "BUILD_SAFE");
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM events WHERE type = 'settings.changed' AND json_extract(payload_json, '$.key') = 'mode'"), modeBefore);
    for (const type of ["grant.create", "mode.set", "lega.propose_mission"]) assert.equal(commandCount(t, type), 0, type);
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM commands WHERE type = 'approval.decide' AND channel = 'ui'"), 0);
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM approvals WHERE decided_via = 'ui'"), 0);
  } finally { await t.cleanup(); }
});

test("M10.2-EP-02 the Hub's own project: blocked with the factory-refuses-Hub and R2 explanation, no draft; the request is kept once (full text once, then short)", async () => {
  const t = await plannerHub();
  try {
    const hubProject = t.hub.projects.hub();
    assert.ok(hubProject);
    const r = await plan(t, { text: "Adaugă un buton nou în cockpit; testul e test/acceptance.test.mjs", projectId: hubProject.id });
    assert.ok(r.blockedBy, JSON.stringify(r));
    assert.match(r.blockedBy.signature, /HUB_SELF_TARGET/);
    assert.match(r.blockedBy.signature, /HOST_R2_OPEN/);
    assert.match(r.message, /Software Factory nu lucrează pe Hub-ul însuși/);
    assert.match(r.message, /[Cc]ererea ta rămâne păstrată/);
    assert.doesNotMatch(r.message, FORBIDDEN_WORDS);
    assert.ok(r.blockedBy.options.some((o) => o.kind === "refused" && o.code === "HUB_SELF_TARGET"));
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM factory_missions"), 0, "no draft");
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM mission_envelopes"), 0, "no plan");
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM approvals"), 0);
    // Preserved: one work request, BLOCKED with the signature; asked again → the same row, the short line.
    assert.ok(r.workRequest?.id, JSON.stringify(r.workRequest || r.workRequestError));
    const row = t.hub.workRequests.get(r.workRequest.id);
    assert.equal(row.status, "BLOCKED");
    assert.equal(row.blockerSignature, r.blockedBy.signature);
    const again = await plan(t, { text: "Adaugă un buton nou în cockpit; testul e test/acceptance.test.mjs", projectId: hubProject.id });
    assert.equal(again.workRequest.id, r.workRequest.id, "the same request is not stored twice");
    assert.match(again.message, /Încă blocat/);
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM work_requests"), 1);
  } finally { await t.cleanup(); }
});

test("M10.2-EP-03 not verifiable → ONE question (no draft); the answer (a choice id or the path said alone) builds the plan; no project → ONE question first", async () => {
  const t = await plannerHub();
  try {
    // M10.2.1 (D21): a bug described without a test file binds the project's ONLY acceptance-named test, with no question …
    const bound = await plan(t, { text: "Repară validarea numelui: spațiile trec de verificare", projectId: t.project.id });
    assert.ok(bound.plan?.envelope?.id, JSON.stringify(bound));
    assert.equal(view(t, bound.plan.envelope.missionIds[0]).spec.spec.acceptance[0].testRef, "test/acceptance.test.mjs");
    // … a request that neither names the acceptance test nor describes a bug (a feature) still gets ONE question.
    const drafts = count(t, "SELECT COUNT(*) AS n FROM factory_missions");
    const q = await plan(t, { text: "Adaugă verificarea numelui: spațiile trec de verificare", projectId: t.project.id });
    assert.ok(q.clarification, JSON.stringify(q));
    assert.match(q.clarification.question, /test de acceptanță/);
    assert.deepEqual(q.clarification.options.map((o) => o.id), ["test/acceptance.test.mjs", "test/unit.test.mjs"], "existing tests, acceptance first");
    assert.equal(q.clarification.forIntent, "engineering");
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM factory_missions"), drafts, "a question creates no draft");
    const answered = await plan(t, { text: "", projectId: t.project.id, args: { chosenId: "test/acceptance.test.mjs" } });
    assert.ok(answered.plan?.envelope?.id, JSON.stringify(answered));
    const m = view(t, answered.plan.envelope.missionIds[0]);
    assert.match(m.spec.spec.objective, /spațiile trec de verificare/, "the original words, not the answer, are the objective");
    assert.equal(m.spec.spec.acceptance[0].testRef, "test/acceptance.test.mjs");

    // The path said alone answers too; a test that does not exist is never bound (the question is asked again).
    const q2 = await plan(t, { text: "Adaugă validarea emailului în solicitări", projectId: t.project.id });
    assert.ok(q2.clarification);
    const missing = await plan(t, { text: "test/nu-exista.test.mjs", projectId: t.project.id });
    assert.ok(missing.clarification, "a missing file is not an answer");
    const said = await plan(t, { text: "testul e test/unit.test.mjs", projectId: t.project.id });
    assert.ok(said.plan?.envelope?.id, JSON.stringify(said));
    assert.equal(view(t, said.plan.envelope.missionIds[0]).factory.workType, "FEATURE");

    // No project: ONE question with the projects that may run (never the Hub itself), then the request continues.
    const p = await plan(t, { text: BUG });
    assert.ok(p.clarification, JSON.stringify(p));
    assert.ok(p.clarification.options.some((o) => o.id === t.project.id));
    assert.ok(!p.clarification.options.some((o) => o.id === t.hub.projects.hub().id), "the Hub is not offered");
    const chosen = await plan(t, { text: "", args: { chosenId: t.project.id } });
    assert.ok(chosen.plan?.envelope?.id, JSON.stringify(chosen));
    assert.equal(chosen.plan.envelope.projectId, t.project.id);
  } finally { await t.cleanup(); }
});

test("M10.2-EP-04 cleanup: a superseded or expired plan withdraws its intake draft; a repeated request re-presents the same draft; owner drafts and started drafts are never touched", async () => {
  const t = await plannerHub();
  try {
    // An owner-made draft with its own plan: superseded below, but never cancelled (no intake provenance).
    const ownerDraft = (await dispatch(t.hub, "factory.prepare", { projectId: t.project.id, ...demoSpec("bug-demo"), limits: { writerModel: "gpt-fake-sol", reviewerModel: "sonnet" } })).result;
    await dispatch(t.hub, "envelope.propose", { projectId: t.project.id, missionIds: [ownerDraft.mission.id] });
    const a = await plan(t, { text: BUG, projectId: t.project.id });
    const aMission = a.plan.envelope.missionIds[0];
    // The same words again: the same draft, a new plan over it (the old one superseded), the draft kept.
    const a2 = await plan(t, { text: BUG, projectId: t.project.id });
    assert.equal(a2.plan.envelope.missionIds[0], aMission, "no second draft for the same request");
    assert.notEqual(a2.plan.envelope.id, a.plan.envelope.id);
    assert.equal(t.hub.envelopes.get(a.plan.envelope.id).status, "SUPERSEDED");
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(view(t, aMission).factory.stage, "SPEC_DRAFT", "still offered by the newer plan");
    assert.equal(view(t, ownerDraft.mission.id).factory.stage, "SPEC_DRAFT", "the owner's draft is never withdrawn by the planner");
    // Another request supersedes a2 → its draft (intake, unstarted, offered by nothing) is withdrawn.
    const b = await plan(t, { text: "Refactorizează validarea solicitărilor; testul e test/unit.test.mjs", projectId: t.project.id });
    assert.equal(view(t, b.plan.envelope.missionIds[0]).factory.workType, "REFACTOR");
    await waitFor(() => view(t, aMission).factory.stage === "CANCELLED", 5000);
    const why = t.hub.db.prepare("SELECT payload_json FROM events WHERE type = 'factory.stage' AND scope_id = ? AND json_extract(payload_json, '$.stage') = 'CANCEL_REQUESTED'").get(aMission);
    assert.match(JSON.parse(why.payload_json).reason, /înlocuit.*retrasă.*nu a rulat nimic/);
    // Expiry of a PROPOSED plan withdraws its draft too.
    const bMission = b.plan.envelope.missionIds[0];
    t.hub.db.prepare("UPDATE mission_envelopes SET confirm_by = ? WHERE id = ?").run(new Date(Date.now() - 1000).toISOString(), b.plan.envelope.id);
    t.hub.envelopes.tick();
    await waitFor(() => view(t, bMission).factory.stage === "CANCELLED", 5000);
    assert.equal(view(t, ownerDraft.mission.id).factory.stage, "SPEC_DRAFT");
    // A started draft is never cancelled by the cleanup.
    const c = await plan(t, { text: "Repară mesajul de eroare pentru numele gol; testul e test/acceptance.test.mjs", projectId: t.project.id });
    t.queue("codex", "hang");
    await dispatch(t.hub, "envelope.confirm", { envelopeId: c.plan.envelope.id, nonce: c.plan.envelope.nonce, displayedHash: c.plan.envelope.envelopeHash }, { ownerSession: t.owner.session });
    const cMission = c.plan.envelope.missionIds[0];
    await waitFor(() => view(t, cMission).factory.stage !== "SPEC_DRAFT", 10000);
    const skipped = await t.hub.engineeringPlanner.cleanupDraft(cMission, "test");
    assert.equal(skipped.skipped, "started or gone");
    await dispatch(t.hub, "system.stop_all", { reason: "test" }, { channel: "owner", ownerSession: t.owner.session });
    await waitFor(() => t.hub.runs.activeRuns().length === 0, 15000);
  } finally { await t.cleanup(); }
});

test("M10.2-EP-05 factory.defaults.set: owner session only, both roles explicit, validated; the override is shown and hashed in the next plan; clear returns to the role defaults", async () => {
  const t = await plannerHub({ codexModels: null });
  try {
    const set = (payload, extra = {}) => dispatch(t.hub, "factory.defaults.set", { projectId: t.project.id, ...payload }, { channel: "owner", ownerSession: t.owner.reauth(), ...extra });
    await assert.rejects(dispatch(t.hub, "factory.defaults.set", { projectId: t.project.id, writerModel: "gpt-fake-sol", writerEffort: "medium", reviewerModel: "sonnet", reviewerEffort: "medium" }, { channel: "ui" }), /cannot be issued through ui/);
    await assert.rejects(set({ writerModel: "gpt-fake-sol", reviewerModel: "sonnet" }), /efort explicite|lipsește/);
    await assert.rejects(set({ writerModel: "gpt-fake-sol", writerEffort: "medium", reviewerModel: "fable", reviewerEffort: "medium" }), /Modele invalide/);
    await assert.rejects(set({ writerModel: "gpt-fake-sol", writerEffort: "turbo", reviewerModel: "sonnet", reviewerEffort: "medium" }), /Modele invalide|Efort/);
    assert.deepEqual(t.hub.settings.get("factoryDefaultBindings"), {});
    // Without an override the role defaults are used; this account lists no gpt-6.1-sol → the plan cannot be bound, said honestly.
    const unresolved = await plan(t, { text: BUG, projectId: t.project.id });
    assert.ok(unresolved.blockedBy, JSON.stringify(unresolved));
    assert.equal(unresolved.blockedBy.signature, "PLAN_MODELS_UNRESOLVED");
    assert.match(unresolved.message, /gpt-6\.1-sol/);
    assert.match(unresolved.message, /nu folosesc implicitul contului/);
    // The owner's override (fresh session).
    const ok = (await set({ writerModel: "gpt-fake-sol", writerEffort: "high", reviewerModel: "sonnet", reviewerEffort: "medium" })).result;
    assert.equal(ok.source, "owner");
    const stored = t.hub.settings.get("factoryDefaultBindings")[t.project.id];
    assert.deepEqual([stored.writer, stored.reviewer], [{ model: "gpt-fake-sol", effort: "high" }, { model: "sonnet", effort: "medium" }]);
    assert.match(stored.setBy, /^session:/);
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM events WHERE type = 'factory.defaults_set'"), 1);
    const r = await plan(t, { text: "Adaugă validarea emailului; testul e test/acceptance.test.mjs", projectId: t.project.id });
    assert.ok(r.plan?.envelope?.id, JSON.stringify(r));
    const mid = r.plan.envelope.missionIds[0];
    assert.match(r.plan.envelope.body.models[mid].writer, /gpt-fake-sol · high/);
    assert.match(r.note, /alese de tine/);
    // The preserved request of the unresolved attempt points at its own draft (kept for a later re-plan).
    assert.ok(unresolved.workRequest?.id);
    // Clear → back to the role defaults.
    const cleared = (await set({ clear: true })).result;
    assert.equal(cleared.source, "role_default");
    assert.deepEqual(t.hub.settings.get("factoryDefaultBindings"), {});
    assert.deepEqual(t.hub.engineeringPlanner.defaultsFor(t.project.id).limits, defaultModelLimits(null).limits);
  } finally { await t.cleanup(); }
});

test("M10.2-EP-06 a project without execution rights is refused before any draft; factory.prepare from the UI is unchanged (no provenance, same view)", async () => {
  const t = await plannerHub();
  try {
    const ui = (await dispatch(t.hub, "factory.prepare", { projectId: t.project.id, ...demoSpec("bug-demo"), limits: { writerModel: "gpt-fake-sol", reviewerModel: "sonnet" } }, { channel: "ui" })).result;
    assert.equal(ui.factory.stage, "SPEC_DRAFT");
    assert.equal(ui.mission.kind, "eng_bugfix");
    assert.ok(ui.scope, "a complete UI draft still has its scope");
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM events WHERE type = 'factory.provenance'"), 0, "the UI path records no intake provenance");
    assert.equal(typeof t.hub.prepareFactoryMission, "function");
    await assert.rejects(dispatch(t.hub, "factory.prepare", { projectId: t.project.id, workType: "DEPLOY", title: "x y z", objective: "nimic de făcut aici" }, { channel: "ui" }), /workType must be one of/);

    await dispatch(t.hub, "project.execution.disable", { projectId: t.project.id, reason: "test" }, { channel: "ui" });
    const before = count(t, "SELECT COUNT(*) AS n FROM factory_missions");
    const r = await plan(t, { text: BUG, projectId: t.project.id });
    assert.ok(r.blockedBy, JSON.stringify(r));
    assert.doesNotMatch(r.message, FORBIDDEN_WORDS);
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM factory_missions"), before, "no draft on a project without execution rights");
  } finally { await t.cleanup(); }
});

test("M10.2-EP-07 pure: work type from words / hints; the spec binds only an existing test; the role defaults are the pilot's models, explicit", () => {
  assert.equal(workTypeOf("Repară eroarea de la login"), "BUGFIX");
  assert.equal(workTypeOf("Nu merge salvarea formularului"), "BUGFIX");
  assert.equal(workTypeOf("Refactorizează modulul de rapoarte"), "REFACTOR");
  assert.equal(workTypeOf("Adaugă export CSV"), "FEATURE");
  assert.equal(workTypeOf("orice", "bug"), "BUGFIX");
  assert.equal(workTypeOf("orice", "REFACTOR"), "REFACTOR");
  assert.deepEqual(ROLE_DEFAULT_BINDINGS, PILOT_MODELS, "one source for the role defaults");
  const d = defaultModelLimits(null);
  assert.equal(d.source, "role_default");
  assert.deepEqual(d.limits, { writerModel: "gpt-6.1-sol", writerEffort: "medium", reviewerModel: "sonnet", reviewerEffort: "medium" });
  assert.throws(() => defaultModelLimits({ writer: { model: "gpt-6.1-sol", effort: "medium" }, reviewer: { model: "fable", effort: "medium" } }), /Modele invalide/);
  const project = { path: path.join(FIXTURE_ROOT, "bug-demo") };
  const ok = buildEngineeringSpec({ text: BUG, project });
  assert.equal(ok.testRef, "test/acceptance.test.mjs");
  assert.deepEqual(ok.problems, []);
  assert.equal(ok.input.spec.verification.checks[0], "node --test", "plain node:test script → node --test (no npm)");
  for (const bad of ["../escape.test.mjs", "C:/x/y.test.mjs", "test/missing.test.mjs", "src/requests.js"]) {
    assert.equal(buildEngineeringSpec({ text: "Repară ceva important", args: { testRef: bad }, project }).testRef, null, bad);
  }
});
