// Milestone 09 — model/effort binding (PASS_SIMULATED: fixture providers and runner; nothing outside .ifrim/tmp).
// proposal → plan → confirmation → envelope → grant → dispatch carry ONE explicit model + effort per role, with the evidence of how
// it was resolved, checked again before any process (compareAtDispatch) and at the provider's report (Claude init). No silent
// fallback to the account default: a mission without models is a draft, a material change is refused before inference.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeTestHub, enableLive, waitFor, enrolOwner, prepareLiveWithoutGrants } from "./helpers.mjs";
import { materializeFixture, demoSpec } from "../server/factory/fixtures.mjs";
import { normalizeBindingRequest, resolveBinding, resolveRoleBindings, compareAtDispatch, compareAtInit, bindingHash, modelListHash, bindingLabel, claudeExpectation } from "../server/policy/model-binding.mjs";
import { resolveRunPlan } from "../server/policy/run-plan.mjs";
import { normalizeLimits } from "../server/factory/plan.mjs";
import { PILOT_MODELS, packageModelText, pilotModelLimits } from "../server/intel/packages.mjs";
import { normalizeObjectiveModels } from "../server/intel/autopilot.mjs";

const dispatch = (hub, type, payload, channel = "test", extra = {}) => hub.commands.dispatch({ type, payload, channel, actor: "test", ...extra });
const MODELS = { writerModel: "gpt-fake-sol", reviewerModel: "sonnet" };
const SETTLED = ["DELIVERY_READY", "NEEDS_OWNER_DECISION", "BLOCKED", "PAUSED", "CANCELLED", "ACCEPTED", "REJECTED"];
const codexState = { probedAt: "2026-10-03T08:00:00.000Z", models: [{ id: "gpt-a", model: "gpt-a", isDefault: true, efforts: ["low", "medium", "high"] }, { id: "gpt-b", model: "gpt-b", isDefault: false, efforts: ["medium"] }] };
const claudeState = { installation: { installed: true, version: "2.1.175 (Claude Code)", flags: ["--effort", "--model"] }, installationCheckedAt: "2026-10-03T08:00:00.000Z" };

async function factoryHub({ grants = { codex: true, claude: true }, attempts = 4, models = null } = {}) {
  const t = await makeTestHub({ queues: true });
  if (models) fs.writeFileSync(`${t.logs.codex}.models.json`, JSON.stringify(models));
  await enableLive(t.hub, { provider: "codex", access: "workspace-write", attempts: 1 });
  const dir = path.join(t.dataDir, "factory-bug-demo");
  materializeFixture("bug-demo", dir);
  const project = (await dispatch(t.hub, "project.register_test", { path: dir })).result;
  t.hub.bus.transaction(() => {
    if (grants.codex) t.hub.grants.create({ provider: "codex", projectId: project.id, access: "workspace-write", maxAttempts: attempts, maxDurationS: 900, ttlMinutes: 60 }, "test");
    if (grants.claude) t.hub.grants.create({ provider: "claude", projectId: project.id, access: "read-only", maxAttempts: attempts, maxDurationS: 900, ttlMinutes: 60 }, "test");
  });
  return { ...t, project, dir };
}
const prepare = async (t, limits = MODELS) => (await dispatch(t.hub, "factory.prepare", { projectId: t.project.id, ...demoSpec("bug-demo"), limits })).result;
async function approveAndStart(t, missionId, scope = t.hub.factory.view(missionId).scope) {
  const requested = await dispatch(t.hub, "factory.start", scope);
  await dispatch(t.hub, "approval.decide", { approvalId: requested.approval.id, decision: "approved", displayedHash: requested.approval.payloadHash });
  return t.hub.commands.executeApproved(requested.command.id, "user");
}
const view = (t, id) => t.hub.factory.view(id);
const untilStage = (t, id, stages, ms = 90000) => waitFor(() => (stages.includes(view(t, id).factory.stage) ? view(t, id) : null), ms, 100);
const idleWithin = (t, missionId, ms = 30000) => Promise.race([t.hub.factory.idle(missionId), new Promise((_, reject) => setTimeout(() => reject(new Error("factory.idle() did not settle")), ms).unref())]);
const claudeCalls = (t) => t.readLog("claude").filter((e) => Array.isArray(e.args) && e.args.includes("-p")).map((e) => e.args);
const argOf = (args, flag) => (args.indexOf(flag) >= 0 ? args[args.indexOf(flag) + 1] : null);
const codexRequests = (t, method) => t.readLog("codex").filter((e) => e.method === method).map((e) => e.params);
async function reprobeCodex(t) {
  const installation = await t.hub.providers.codex.inspectInstallation();
  const probe = await t.hub.providers.codex.probe({ withUsage: true, withModels: true });
  t.hub.providerState.set("codex", { ...probe, installation });
}

// ---------- pure ----------

test("M09-MB-01 validation: ineligible models and efforts are refused by syntax, before any provider fact (fable, sonnet[1m], best, unknown effort, empty factory model)", () => {
  for (const model of ["fable", "sonnet[1m]", "best", "claude-fable-5", "opus[1M]"]) {
    const r = normalizeBindingRequest({ role: "reviewer", model });
    assert.equal(r.ok, false, model);
    assert.match(r.problem, /refuzat|Fable|1M/, model);
  }
  for (const model of ["sonet", "default", "gpt-5", "--model x", "opusplan"]) assert.equal(normalizeBindingRequest({ role: "reviewer", model }).ok, false, model);
  assert.match(normalizeBindingRequest({ role: "writer", model: "gpt-a", effort: "turbo" }).problem, /Efort necunoscut/);
  assert.match(normalizeBindingRequest({ role: "writer", model: "" }).problem, /nu are un model ales.*model\/list/);
  assert.match(normalizeBindingRequest({ role: "reviewer", model: "" }).problem, /sonnet, opus sau haiku/);
  assert.match(normalizeBindingRequest({ role: "writer", provider: "claude", model: "sonnet" }).problem, /rulează pe Codex/);
  assert.match(normalizeBindingRequest({ role: "writer", model: "gpt a; rm" }).problem, /format invalid/);
  // A manual Codex run may leave the model empty (the default is pinned at the start); a manual Claude run may not.
  assert.equal(normalizeBindingRequest({ role: "run", provider: "codex", model: "" }).ok, true);
  assert.equal(normalizeBindingRequest({ role: "run", provider: "claude", model: "" }).ok, false);
  assert.equal(normalizeBindingRequest({ role: "reviewer", model: "Sonnet" }).request.model, "sonnet", "aliases are normalised");
  assert.equal(normalizeBindingRequest({ role: "reviewer", model: "claude-sonnet-4-5-20250929" }).request.model, "claude-sonnet-4-5-20250929");
  // The factory limits refuse them with a validation error (never at the provider).
  for (const bad of [{ reviewerModel: "fable" }, { reviewerModel: "sonnet[1m]" }, { reviewerModel: "best" }, { writerEffort: "turbo" }, { writerModel: "gpt-a", writerEffort: "ultra" }, { reviewerModel: 7 }]) {
    assert.throws(() => normalizeLimits(bad), (e) => e.category === "validation", JSON.stringify(bad));
  }
  assert.deepEqual(normalizeLimits({ writerModel: "gpt-a", writerEffort: "HIGH", reviewerModel: "Haiku" }).reviewerModel, "haiku");
  assert.equal(normalizeLimits({}).writerModel, undefined, "a draft without models is accepted (its scope stays incomplete)");
});

test("M09-MB-02 resolution: Codex model/list evidence (exact id, effort, list hash), Claude alias evidence (family, CLI version); the hash ignores timestamps", () => {
  const w = resolveBinding({ role: "writer", requestedModel: "gpt-a", requestedEffort: "high", providerState: codexState });
  assert.equal(w.ok, true, w.problem);
  assert.deepEqual([w.binding.resolvedAlias, w.binding.effort, w.binding.effortSource, w.binding.resolutionEvidence.source], ["gpt-a", "high", "owner", "model/list"]);
  assert.match(w.binding.bindingHash, /^[0-9a-f]{64}$/);
  const fromProfile = resolveBinding({ role: "writer", requestedModel: "gpt-a", profile: "ECONOMIC", providerState: codexState }).binding;
  assert.deepEqual([fromProfile.effort, fromProfile.effortSource], ["low", "profil ECONOMIC"]);
  assert.match(resolveBinding({ role: "writer", requestedModel: "gpt-z", providerState: codexState }).problem, /nu apare în model\/list/);
  assert.match(resolveBinding({ role: "writer", requestedModel: "gpt-b", requestedEffort: "high", providerState: codexState }).problem, /nu e suportat de gpt-b/);
  assert.match(resolveBinding({ role: "writer", requestedModel: "gpt-a", providerState: {} }).problem, /model\/list.*nu e salvată/);
  // The list hash covers ids and efforts only: the default flag, the order and the names do not change it.
  const flipped = { models: [{ ...codexState.models[1], isDefault: true }, { ...codexState.models[0], isDefault: false, displayName: "x" }] };
  assert.equal(modelListHash(flipped.models), modelListHash(codexState.models));
  const r = resolveBinding({ role: "reviewer", requestedModel: "sonnet", providerState: claudeState });
  assert.equal(r.ok, true, r.problem);
  assert.deepEqual([r.binding.resolvedAlias, r.binding.resolutionEvidence.family, r.binding.resolutionEvidence.exactId, r.binding.resolutionEvidence.cliVersion], ["sonnet", "sonnet", null, "2.1.175 (Claude Code)"]);
  assert.equal(resolveBinding({ role: "reviewer", requestedModel: "claude-haiku-4-5-20251001", providerState: claudeState }).binding.resolutionEvidence.exactId, "claude-haiku-4-5-20251001");
  assert.match(resolveBinding({ role: "reviewer", requestedModel: "sonnet", providerState: null }).problem, /nu a fost inspectat/);
  assert.match(resolveBinding({ role: "reviewer", requestedModel: "sonnet", providerState: { installation: { version: "2.1.0", flags: ["--model"] } } }).problem, /--effort/);
  // A re-probe with the same facts keeps the hash (probedAt is evidence metadata); another CLI version does not.
  const later = resolveBinding({ role: "reviewer", requestedModel: "sonnet", providerState: { ...claudeState, installationCheckedAt: "2026-10-04T00:00:00.000Z" } }).binding;
  assert.equal(later.bindingHash, r.binding.bindingHash);
  assert.notEqual(resolveBinding({ role: "reviewer", requestedModel: "sonnet", providerState: { installation: { ...claudeState.installation, version: "2.1.200 (Claude Code)" } } }).binding.bindingHash, r.binding.bindingHash);
  assert.equal(bindingHash({ ...r.binding, bindingHash: undefined }), r.binding.bindingHash);
  const both = resolveRoleBindings({ writerModel: "gpt-a", reviewerModel: "opus", profile: "BALANCED" }, { writer: { providerState: codexState }, reviewer: { providerState: claudeState } });
  assert.deepEqual(both.problems, []);
  assert.deepEqual([both.bindings.writer.effort, both.bindings.reviewer.effort], ["medium", "medium"]);
  assert.equal(resolveRoleBindings({ writerModel: "gpt-a" }, { writer: { providerState: codexState }, reviewer: { providerState: claudeState } }).problems.length, 1);
  assert.match(bindingLabel(r.binding), /^Claude sonnet \(familia sonnet, Claude Code 2\.1\.175\) · medium$/);
  assert.equal(bindingLabel(w.binding), "Codex gpt-a · high");
  assert.deepEqual(claudeExpectation("opus"), { family: "opus", exactId: null });
  assert.equal(claudeExpectation("fable"), null);
});

test("M09-MB-03 compareAtDispatch / compareAtInit: what counts as a material change, and the init family check", () => {
  const w = resolveBinding({ role: "writer", requestedModel: "gpt-a", requestedEffort: "medium", providerState: codexState }).binding;
  const plan = (state, model = "gpt-a", effort = "medium") => resolveRunPlan({ provider: "codex", model, effort, providerState: state });
  assert.equal(compareAtDispatch(w, plan(codexState), codexState), null, "unchanged");
  // The account default flipped, the bound model is still listed: not a change (the bound model is sent, never the new default).
  const flipped = { models: [{ ...codexState.models[1], isDefault: true }, { ...codexState.models[0], isDefault: false }] };
  assert.equal(compareAtDispatch(w, plan(flipped), flipped), null);
  // The bound model left the list (the account default changed to another model): refused, named.
  const gone = { models: [{ id: "gpt-b", model: "gpt-b", isDefault: true, efforts: ["medium"] }] };
  const change = compareAtDispatch(w, plan(gone), gone);
  assert.equal(change.code, "MATERIAL_CHANGE");
  assert.ok(change.reasons.some((r) => /nu mai apare în model\/list/.test(r)), change.reasons.join(" | "));
  const noEffort = { models: [{ ...codexState.models[0], efforts: ["low", "high"] }] };
  assert.ok(compareAtDispatch(w, plan(noEffort), noEffort).reasons.some((r) => /efortul aprobat medium nu mai e suportat/.test(r)));
  assert.ok(compareAtDispatch(w, plan(codexState, "gpt-b"), codexState).reasons.some((r) => /nu e cel aprobat/.test(r)), "another model to send");
  assert.ok(compareAtDispatch(w, plan(codexState), codexState, { environment: "wsl-runner" }).reasons.some((r) => /ruta s-a schimbat/.test(r)));
  const r = resolveBinding({ role: "reviewer", requestedModel: "sonnet", providerState: claudeState }).binding;
  const claudePlan = (state) => resolveRunPlan({ provider: "claude", model: "sonnet", effort: "medium", providerState: state });
  assert.equal(compareAtDispatch(r, claudePlan(claudeState), claudeState), null);
  const upgraded = { installation: { ...claudeState.installation, version: "2.1.300 (Claude Code)" } };
  assert.ok(compareAtDispatch(r, claudePlan(upgraded), upgraded).reasons.some((x) => /versiunea Claude Code s-a schimbat/.test(x)));
  assert.equal(compareAtDispatch(null, null, null).code, "MATERIAL_CHANGE", "no binding at all is never accepted");
  // Init: the reported model must belong to the bound family (or equal the bound dated id).
  assert.equal(compareAtInit(r, "claude-sonnet-4-5-20250929"), null);
  assert.equal(compareAtInit(r, "claude-sonnet-fake"), null);
  assert.match(compareAtInit(r, "claude-opus-5-5"), /în afara modelului aprobat sonnet/);
  assert.match(compareAtInit(r, ""), /nu a raportat modelul/);
  assert.match(compareAtInit(r, "sonnet-but-not-claude"), /în afara/);
  const dated = resolveBinding({ role: "reviewer", requestedModel: "claude-sonnet-4-5-20250929", providerState: claudeState }).binding;
  assert.equal(compareAtInit(dated, "claude-sonnet-4-5-20250929"), null);
  assert.match(compareAtInit(dated, "claude-sonnet-4-6-20260101"), /în loc de claude-sonnet-4-5-20250929/);
  assert.equal(compareAtInit(w, "anything"), null, "Codex is compared by its adapter at thread/start");
});

test("M09-MB-04 packages and objectives carry structured models; ineligible objective models are refused", () => {
  assert.equal(packageModelText(PILOT_MODELS.writer), "Codex gpt-6.1-sol · medium (abonament)");
  assert.equal(packageModelText(PILOT_MODELS.reviewer), "Claude sonnet · medium (abonament)");
  assert.equal(packageModelText("text dintr-un pachet vechi"), "text dintr-un pachet vechi");
  assert.deepEqual(pilotModelLimits(), { writerModel: "gpt-6.1-sol", writerEffort: "medium", reviewerModel: "sonnet", reviewerEffort: "medium" });
  assert.deepEqual(normalizeObjectiveModels({ writer: { model: "gpt-a", effort: "high" }, reviewer: { model: "haiku" } }).models,
    { writer: { provider: "codex", model: "gpt-a", effort: "high" }, reviewer: { provider: "claude", model: "haiku", effort: "" } });
  assert.match(normalizeObjectiveModels({ reviewer: { model: "fable" } }).problems.join(" "), /refuzat/);
  assert.match(normalizeObjectiveModels({ writer: { provider: "claude", model: "sonnet" } }).problems.join(" "), /rulează pe codex/);
  assert.deepEqual(normalizeObjectiveModels(null), { models: null, problems: [] });
});

// ---------- factory ----------

test("M09-MB-05 a mission without both models is a draft: no scope, the plan is PLAN_INCOMPLETE (no placeholder); unknown Codex id / unsupported effort / ineligible alias are refused before any approval", async () => {
  const t = await factoryHub();
  try {
    const { mission } = await prepare(t, {});
    let v = view(t, mission.id);
    assert.equal(v.scope, null, "no scope without models");
    assert.equal(v.scopeProblems.length, 2);
    assert.match(v.scopeProblems.join(" | "), /Writer-ul \(Codex\) nu are un model ales/);
    assert.match(v.scopeProblems.join(" | "), /Reviewer-ul \(Claude\) nu are un model ales/);
    const plan = (await dispatch(t.hub, "envelope.propose", { projectId: t.project.id, missionIds: [mission.id] })).result;
    assert.equal(plan.envelope, null);
    assert.equal(plan.summary.state, "PLAN_INCOMPLETE");
    assert.match(plan.summary.blockers.join(" "), /modelele nu sunt fixate/);
    assert.ok(!JSON.stringify(plan).includes("implicit (fix în plan)"));
    await assert.rejects(dispatch(t.hub, "factory.start", { missionId: mission.id, specVersion: 1, specSha: "x", planSha: "y", limits: {}, routes: {}, bindings: {}, commands: {} }).then(async (r) => {
      await dispatch(t.hub, "approval.decide", { approvalId: r.approval.id, decision: "approved", displayedHash: r.approval.payloadHash });
      return t.hub.commands.executeApproved(r.command.id, "user");
    }), /Modelele misiunii nu sunt fixate|s-a schimbat/);
    for (const limits of [{ reviewerModel: "fable" }, { reviewerModel: "sonnet[1m]" }, { reviewerModel: "best" }, { writerEffort: "turbo" }]) {
      await assert.rejects(dispatch(t.hub, "factory.limits", { missionId: mission.id, limits }), /refuzat|nu e permis|Efort necunoscut/, JSON.stringify(limits));
    }
    await dispatch(t.hub, "factory.limits", { missionId: mission.id, limits: { writerModel: "gpt-zzz", reviewerModel: "sonnet" } });
    assert.match(view(t, mission.id).scopeProblems.join(" "), /gpt-zzz nu apare în model\/list/);
    await dispatch(t.hub, "factory.limits", { missionId: mission.id, limits: { writerModel: "gpt-5", writerEffort: "high" } });
    assert.match(view(t, mission.id).scopeProblems.join(" "), /Efortul high .* nu e suportat de gpt-5/);
    await dispatch(t.hub, "factory.limits", { missionId: mission.id, limits: { writerModel: "gpt-fake-sol", writerEffort: "high", reviewerModel: "haiku", reviewerEffort: "low" } });
    v = view(t, mission.id);
    assert.ok(v.scope, v.scopeProblems.join(" | "));
    assert.deepEqual([v.scope.bindings.writer.resolvedAlias, v.scope.bindings.writer.effort, v.scope.bindings.reviewer.resolvedAlias, v.scope.bindings.reviewer.effort], ["gpt-fake-sol", "high", "haiku", "low"]);
    assert.equal(v.models.writer.approved, false, "before the start the models are the draft's resolution");
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM agent_runs").get().n, 0, "nothing ran");
  } finally { await t.cleanup(); }
});

test("M09-MB-06 two stages with two different models: each role is dispatched with its own binding (request, argv, thread/start) and the provider's report is recorded as verified", async () => {
  const t = await factoryHub();
  try {
    const { mission } = await prepare(t, { writerModel: "gpt-fake-sol", writerEffort: "high", reviewerModel: "haiku", reviewerEffort: "low" });
    t.queue("codex", "factory-write:bug-fix");
    t.queue("claude", "review:pass");
    await approveAndStart(t, mission.id);
    const done = await untilStage(t, mission.id, SETTLED);
    assert.equal(done.factory.stage, "DELIVERY_READY", done.factory.stageReason);
    const stored = done.factory.bindings;
    assert.deepEqual([stored.writer.resolvedAlias, stored.writer.effort, stored.reviewer.resolvedAlias, stored.reviewer.effort], ["gpt-fake-sol", "high", "haiku", "low"]);
    assert.equal(done.models.reviewer.approved, true);
    const writer = done.dispatches.find((d) => d.stage === "IMPLEMENTING");
    const review = done.dispatches.find((d) => d.stage === "REVIEWING");
    assert.deepEqual([writer.request.model, writer.request.effort, writer.request.bindingHash], ["gpt-fake-sol", "high", stored.writer.bindingHash]);
    assert.deepEqual([review.request.model, review.request.effort, review.request.bindingHash], ["haiku", "low", stored.reviewer.bindingHash]);
    const args = claudeCalls(t).at(-1);
    assert.deepEqual([argOf(args, "--model"), argOf(args, "--effort")], ["haiku", "low"]);
    assert.equal(codexRequests(t, "thread/start").at(-1).model, "gpt-fake-sol");
    assert.equal(codexRequests(t, "turn/start").at(-1).effort, "high");
    const runs = done.runs;
    const w = runs.find((r) => r.provider === "codex");
    const c = runs.find((r) => r.provider === "claude");
    assert.equal(w.plan.bindingHash, stored.writer.bindingHash);
    assert.equal(c.plan.bindingHash, stored.reviewer.bindingHash);
    assert.deepEqual([w.plan.verified.value, w.plan.verified.matched], ["gpt-fake-sol", true]);
    assert.deepEqual([c.plan.verified.value, c.plan.verified.matched], ["claude-haiku-fake", true]);
    assert.equal(c.model, "haiku", "the run record keeps what was sent (no back-fill from the report)");
    assert.equal(c.plan.modelSource, "binding");
    assert.equal(t.hub.bus.query({ typePrefix: "factory.bindings", limit: 5 }).length, 1);
  } finally { await t.cleanup(); }
});

test("M09-MB-07 the account default changed between plan and dispatch (the bound model left model/list): refused before inference, not an attempt, no grant taken; restored (default still flipped) the retry keeps the bound model", async () => {
  const t = await factoryHub({ grants: { codex: false, claude: true } });
  try {
    const { mission } = await prepare(t, { ...MODELS, maxAttemptsPerStage: 1 });
    // The writer's scenario is queued after the re-probes below (each account check is an app-server process that takes a line).
    t.queue("claude", "review:pass");
    await approveAndStart(t, mission.id);
    const noGrant = await untilStage(t, mission.id, ["BLOCKED", "NEEDS_OWNER_DECISION", "DELIVERY_READY"]);
    await idleWithin(t, mission.id);
    assert.equal(noGrant.factory.waitReason, "grant", noGrant.factory.stageReason);
    const bound = noGrant.factory.bindings.writer;
    // The account now lists another default and no longer the bound model.
    fs.writeFileSync(`${t.logs.codex}.models.json`, JSON.stringify([{ id: "gpt-5", isDefault: true, efforts: ["medium"] }]));
    await reprobeCodex(t);
    const grant = t.hub.bus.transaction(() => t.hub.grants.create({ provider: "codex", projectId: t.project.id, access: "workspace-write", maxAttempts: 2, maxDurationS: 900, ttlMinutes: 60 }, "test"));
    await dispatch(t.hub, "factory.resume", { missionId: mission.id }, "ui");
    const refused = await untilStage(t, mission.id, ["BLOCKED", "NEEDS_OWNER_DECISION", "DELIVERY_READY"]);
    await idleWithin(t, mission.id);
    assert.equal(refused.factory.stage, "BLOCKED");
    assert.equal(refused.factory.waitReason, "gate");
    assert.match(refused.factory.stageReason, /Schimbare materială/);
    assert.match(refused.factory.stageReason, /gpt-fake-sol nu mai apare în model\/list/);
    assert.equal(codexRequests(t, "thread/start").length, 0, "no Codex thread was started for the writer");
    const blockedRun = t.hub.db.prepare("SELECT * FROM agent_runs WHERE provider = 'codex' ORDER BY created_at DESC LIMIT 1").get();
    assert.equal(blockedRun.status, "blocked");
    assert.equal(blockedRun.pre_inference, 1);
    assert.equal(blockedRun.error_category, "gate");
    assert.ok(JSON.parse(blockedRun.plan_json).materialChange.reasons.length > 0);
    assert.equal(t.hub.grants.get(grant.id).attemptsUsed, 0, "the grant attempt was not taken");
    assert.ok(t.hub.bus.query({ typePrefix: "run.material_change", limit: 5 }).length >= 1);
    // The bound model is back, but the account default stays the other one: the retry sends the BOUND model (never the default).
    fs.writeFileSync(`${t.logs.codex}.models.json`, JSON.stringify([{ id: "gpt-5", isDefault: true, efforts: ["medium"] }, { id: "gpt-fake-sol", isDefault: false, efforts: ["medium", "high"] }]));
    await reprobeCodex(t);
    t.queue("codex", "factory-write:bug-fix");
    await dispatch(t.hub, "factory.resume", { missionId: mission.id }, "ui");
    const done = await untilStage(t, mission.id, ["DELIVERY_READY", "NEEDS_OWNER_DECISION", "BLOCKED"]);
    assert.equal(done.factory.stage, "DELIVERY_READY", done.factory.stageReason);
    const writers = done.dispatches.filter((d) => d.stage === "IMPLEMENTING");
    assert.ok(writers.every((d) => d.request.model === "gpt-fake-sol" && d.request.bindingHash === bound.bindingHash), "every attempt carried the same binding");
    assert.equal(writers.at(-1).request.counted, 1, "refused starts are not attempts (limit 1 still allowed the real one)");
    assert.equal(codexRequests(t, "thread/start").at(-1).model, "gpt-fake-sol");
  } finally { await t.cleanup(); }
});

test("M09-MB-08 the Claude CLI version changed after the approval: the review is refused before inference (the alias may name another model)", async () => {
  const t = await factoryHub({ grants: { codex: true, claude: false } });
  try {
    const { mission } = await prepare(t);
    t.queue("codex", "factory-write:bug-fix");
    t.queue("claude", "review:pass");
    await approveAndStart(t, mission.id);
    const waiting = await untilStage(t, mission.id, ["BLOCKED", "NEEDS_OWNER_DECISION", "DELIVERY_READY"], 120000);
    await idleWithin(t, mission.id);
    assert.equal(waiting.factory.waitReason, "grant", waiting.factory.stageReason);
    const original = t.hub.providerState.get("claude");
    t.hub.providerState.set("claude", { ...original, installation: { ...original.installation, version: "2.1.999 (Claude Code)" } });
    t.hub.bus.transaction(() => t.hub.grants.create({ provider: "claude", projectId: t.project.id, access: "read-only", maxAttempts: 2, maxDurationS: 900, ttlMinutes: 60 }, "test"));
    await dispatch(t.hub, "factory.resume", { missionId: mission.id }, "ui");
    const refused = await untilStage(t, mission.id, ["BLOCKED", "NEEDS_OWNER_DECISION", "DELIVERY_READY"]);
    await idleWithin(t, mission.id);
    assert.equal(refused.factory.stage, "BLOCKED");
    assert.match(refused.factory.stageReason, /versiunea Claude Code s-a schimbat \(2\.1\.175 \(Claude Code\) → 2\.1\.999/);
    assert.equal(claudeCalls(t).length, 0, "no Claude process");
    t.hub.providerState.set("claude", original);
    await dispatch(t.hub, "factory.resume", { missionId: mission.id }, "ui");
    const done = await untilStage(t, mission.id, ["DELIVERY_READY", "NEEDS_OWNER_DECISION", "BLOCKED"]);
    assert.equal(done.factory.stage, "DELIVERY_READY", done.factory.stageReason);
    assert.equal(argOf(claudeCalls(t).at(-1), "--model"), "sonnet");
  } finally { await t.cleanup(); }
});

test("M09-MB-09 Claude init reports a model outside the bound family: stopped before the model, recorded as verified=false, not an attempt", async () => {
  const t = await factoryHub();
  try {
    const { mission } = await prepare(t, { ...MODELS, maxAttemptsPerStage: 1 });
    t.queue("codex", "factory-write:bug-fix");
    t.queue("claude", "init-model:claude-opus-5-5", "review:pass");
    await approveAndStart(t, mission.id);
    const stopped = await untilStage(t, mission.id, ["BLOCKED", "NEEDS_OWNER_DECISION", "DELIVERY_READY"], 120000);
    await idleWithin(t, mission.id);
    assert.equal(stopped.factory.stage, "BLOCKED", stopped.factory.stageReason);
    assert.match(stopped.factory.stageReason, /claude-opus-5-5, în afara modelului aprobat sonnet/);
    const run = stopped.runs.find((r) => r.provider === "claude");
    assert.equal(run.status, "blocked");
    assert.equal(run.errorCategory, "policy");
    assert.deepEqual([run.plan.verified.value, run.plan.verified.matched], ["claude-opus-5-5", false]);
    assert.equal(run.timeline.phases?.some?.((p) => p.phase === "turn_sent") || false, false, "no turn was sent");
    assert.equal(stopped.reviews.length, 0, "nothing from that session is a review");
    assert.equal(argOf(claudeCalls(t)[0], "--model"), "sonnet", "the bound model was asked for");
    await dispatch(t.hub, "factory.resume", { missionId: mission.id }, "ui");
    const done = await untilStage(t, mission.id, ["DELIVERY_READY", "NEEDS_OWNER_DECISION", "BLOCKED"]);
    assert.equal(done.factory.stage, "DELIVERY_READY", done.factory.stageReason);
    assert.equal(done.dispatches.filter((d) => d.stage === "REVIEWING").at(-1).request.counted, 1, "the stopped start was not an attempt");
  } finally { await t.cleanup(); }
});

test("M09-MB-10 a mission started without bindings (before M09) never falls back to the account default: the dispatch waits for the owner", async () => {
  const t = await factoryHub({ grants: { codex: false, claude: true } });
  try {
    const { mission } = await prepare(t);
    t.queue("codex", "factory-write:bug-fix");
    await approveAndStart(t, mission.id);
    await untilStage(t, mission.id, ["BLOCKED", "NEEDS_OWNER_DECISION", "DELIVERY_READY"]);
    await idleWithin(t, mission.id);
    t.hub.db.prepare("UPDATE factory_missions SET bindings_json = '{}' WHERE mission_id = ?").run(mission.id);
    t.hub.bus.transaction(() => t.hub.grants.create({ provider: "codex", projectId: t.project.id, access: "workspace-write", maxAttempts: 2, maxDurationS: 900, ttlMinutes: 60 }, "test"));
    const before = t.hub.db.prepare("SELECT COUNT(*) AS n FROM agent_runs").get().n;
    await dispatch(t.hub, "factory.resume", { missionId: mission.id }, "ui");
    const held = await untilStage(t, mission.id, ["BLOCKED", "NEEDS_OWNER_DECISION", "DELIVERY_READY"]);
    await idleWithin(t, mission.id);
    assert.equal(held.factory.stage, "BLOCKED");
    assert.match(held.factory.stageReason, /nu are un model aprobat pentru writer/);
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM agent_runs").get().n, before, "no run, not even a refused one");
  } finally { await t.cleanup(); }
});

test("M09-MB-11 the package's models reach the dispatch: a mission prepared with the B4 limits sends gpt-6.1-sol to Codex and --model sonnet --effort medium to Claude", async () => {
  const t = await factoryHub({ models: [{ id: "gpt-6.1-sol", isDefault: false, efforts: ["low", "medium", "high"] }, { id: "gpt-fake-sol", isDefault: true, efforts: ["medium", "high"] }] });
  try {
    const { mission } = await prepare(t, { ...pilotModelLimits(PILOT_MODELS) });
    const v = view(t, mission.id);
    assert.ok(v.scope, v.scopeProblems.join(" | "));
    t.queue("codex", "factory-write:bug-fix");
    t.queue("claude", "review:pass");
    await approveAndStart(t, mission.id);
    const done = await untilStage(t, mission.id, SETTLED);
    assert.equal(done.factory.stage, "DELIVERY_READY", done.factory.stageReason);
    const args = claudeCalls(t).at(-1);
    assert.deepEqual([argOf(args, "--model"), argOf(args, "--effort")], ["sonnet", "medium"]);
    assert.equal(codexRequests(t, "thread/start").at(-1).model, "gpt-6.1-sol", "the package's writer model, not the account default");
  } finally { await t.cleanup(); }
});

// ---------- manual runs ----------

test("M09-MB-12 manual run.start: Codex without a model pins the account default as requested (verified at thread/start); Claude without a model is refused; an explicit alias is sent and verified at init", async () => {
  const t = await makeTestHub();
  try {
    const { project } = await enableLive(t.hub, { provider: "codex", attempts: 3 });
    t.hub.bus.transaction(() => t.hub.grants.create({ provider: "claude", projectId: project.id, access: "read-only", maxAttempts: 3, maxDurationS: 600, ttlMinutes: 30 }, "test"));
    const conv = (await dispatch(t.hub, "conversation.create", { projectId: project.id, title: "Manual" })).result;
    const say = (text) => dispatch(t.hub, "conversation.message", { conversationId: conv.id, content: text });
    const finished = (runId) => waitFor(() => { const r = t.hub.runs.getRun(runId); return ["completed", "failed", "blocked", "interrupted"].includes(r.status) ? r : null; }, 20000);
    await say("Rezumă README.");
    const codexRun = await finished((await dispatch(t.hub, "run.start", { conversationId: conv.id, provider: "codex" })).result.run.id);
    assert.equal(codexRun.status, "completed", codexRun.errorMessage);
    assert.deepEqual([codexRun.plan.modelSource, codexRun.plan.requestedModel, codexRun.plan.model], ["account_default_pinned", "gpt-fake-sol", "gpt-fake-sol"]);
    assert.equal(codexRun.plan.verified.matched, true);
    assert.equal(codexRun.plan.bindingHash, undefined, "a manual run has no envelope binding");
    await say("Rezumă din nou.");
    await assert.rejects(dispatch(t.hub, "run.start", { conversationId: conv.id, provider: "claude" }), (e) => e.category === "gate" && e.details.checks.some((c) => c.id === "run_plan" && /model explicit/.test(c.detail)));
    await assert.rejects(dispatch(t.hub, "run.start", { conversationId: conv.id, provider: "claude", model: "opusplan" }), (e) => e.category === "gate" && e.details.checks.some((c) => c.id === "run_plan" && /nu e permis/.test(c.detail)));
    assert.equal(claudeCalls(t).length, 0, "no Claude process for a refused plan");
    const claudeRun = await finished((await dispatch(t.hub, "run.start", { conversationId: conv.id, provider: "claude", model: "opus" })).result.run.id);
    assert.equal(claudeRun.status, "completed", claudeRun.errorMessage);
    assert.equal(argOf(claudeCalls(t).at(-1), "--model"), "opus");
    assert.deepEqual([claudeRun.model, claudeRun.plan.verified.value, claudeRun.plan.verified.matched], ["opus", "claude-opus-fake", true]);
  } finally { await t.cleanup(); }
});

// ---------- envelopes ----------

async function ownerHub() {
  const t = await makeTestHub({ queues: true });
  await prepareLiveWithoutGrants(t.hub);
  const dir = path.join(t.dataDir, "factory-bug-demo");
  materializeFixture("bug-demo", dir);
  const project = (await dispatch(t.hub, "project.register_test", { path: dir })).result;
  const owner = await enrolOwner(t);
  await dispatch(t.hub, "owner.autonomy.set", { projectId: project.id, level: "TRUSTED" }, "test", { ownerSession: owner.reauth() });
  const { mission } = (await dispatch(t.hub, "factory.prepare", { projectId: project.id, ...demoSpec("bug-demo"), limits: MODELS })).result;
  return { ...t, project, dir, owner, mission };
}
const confirmEnvelope = (t, env) => dispatch(t.hub, "envelope.confirm", { envelopeId: env.id, nonce: env.nonce, displayedHash: env.envelopeHash }, "test", { ownerSession: t.owner.session });

test("M09-MB-13 the envelope shows and binds the exact models: body.models / missions[].bindings / summary.models, derived grants carry the binding, the steps run with it", async () => {
  const t = await ownerHub();
  try {
    const { envelope, summary } = (await dispatch(t.hub, "envelope.propose", { projectId: t.project.id })).result;
    const models = envelope.body.models[t.mission.id];
    assert.equal(models.writer, "Codex gpt-fake-sol · medium");
    assert.match(models.reviewer, /^Claude sonnet \(familia sonnet, Claude Code 2\.1\.175\) · medium$/);
    assert.ok(!JSON.stringify(envelope.body).includes("implicit"), "no placeholder anywhere in the plan");
    const entry = envelope.body.missions[0];
    assert.deepEqual([entry.bindings.writer.resolvedAlias, entry.bindings.reviewer.resolvedAlias], ["gpt-fake-sol", "sonnet"]);
    assert.match(summary.models, /writer Codex gpt-fake-sol · medium; reviewer Claude sonnet/);
    t.queue("codex", "factory-write:bug-fix");
    t.queue("claude", "review:pass");
    await confirmEnvelope(t, envelope);
    const derived = t.hub.grants.ofEnvelope(envelope.id);
    const byProvider = Object.fromEntries(derived.map((g) => [g.provider, g]));
    assert.equal(byProvider.codex.binding.model, "gpt-fake-sol");
    assert.equal(byProvider.codex.binding.bindingHash, entry.bindings.writer.bindingHash);
    assert.equal(byProvider.claude.binding.model, "sonnet");
    assert.equal(byProvider.claude.binding.bindingHash, entry.bindings.reviewer.bindingHash);
    // A grant spec wider than the plan's binding is refused by the CapabilityIssuer.
    const env = t.hub.envelopes.get(envelope.id);
    const spec = t.hub.envelopes.deriveGrants(env, t.mission.id).find((s) => s.role === "reviewer");
    assert.throws(() => t.hub.envelopes.assertWithin(env, { ...spec, binding: { ...spec.binding, model: "opus", bindingHash: "f".repeat(64) } }, { projectId: env.projectId }), /în afara planului/);
    assert.throws(() => t.hub.envelopes.assertWithin(env, { ...spec, binding: null }, { projectId: env.projectId }), /fără modelul confirmat/);
    const done = await waitFor(() => (SETTLED.includes(view(t, t.mission.id).factory.stage) ? view(t, t.mission.id) : null), 120000, 100);
    assert.equal(done.factory.stage, "DELIVERY_READY", done.factory.stageReason);
    assert.equal(argOf(claudeCalls(t).at(-1), "--model"), "sonnet");
    const runs = t.hub.db.prepare("SELECT provider, grant_id, plan_json FROM agent_runs").all();
    for (const r of runs) assert.equal(JSON.parse(r.plan_json).bindingHash, derived.find((g) => g.id === r.grant_id)?.binding?.bindingHash, `${r.provider} ran on the grant of its own binding`);
  } finally { await t.cleanup(); }
});

test("M09-MB-14 UI–request conflict: a manual run with another (or the same) model cannot consume the plan's grants; resume with another reviewer under the open plan is refused", async () => {
  const t = await ownerHub();
  try {
    const { envelope } = (await dispatch(t.hub, "envelope.propose", { projectId: t.project.id })).result;
    t.queue("codex", "hang");
    await confirmEnvelope(t, envelope);
    await waitFor(() => t.hub.db.prepare("SELECT 1 FROM agent_runs WHERE provider = 'codex' AND status = 'running'").get(), 30000, 100);
    const conv = (await dispatch(t.hub, "conversation.create", { projectId: t.project.id, title: "Manual în timpul planului" })).result;
    await dispatch(t.hub, "conversation.message", { conversationId: conv.id, content: "Citește README." });
    // M10.2: the plan no longer switches the Hub to LIVE_VALIDATION (envelope-scoped authority): a manual run is refused on mode.
    for (const model of ["opus", "sonnet"]) {
      await assert.rejects(dispatch(t.hub, "run.start", { conversationId: conv.id, provider: "claude", model }), (e) => e.category === "gate"
        && e.details.checks.some((c) => c.id === "mode" && !c.ok && /BUILD_SAFE: fără inferență/.test(c.detail)), model);
    }
    // And with the owner's manual LIVE_VALIDATION, the plan's grants still cannot serve it (the M09 guard).
    await dispatch(t.hub, "mode.set", { mode: "LIVE_VALIDATION", confirm: "LIVE_VALIDATION" });
    for (const model of ["opus", "sonnet"]) {
      await assert.rejects(dispatch(t.hub, "run.start", { conversationId: conv.id, provider: "claude", model }), (e) => e.category === "gate"
        && e.details.checks.some((c) => c.id === "live_grant" && !c.ok && /legat de modelul confirmat în plan \(sonnet/.test(c.detail)), model);
    }
    const claudeGrant = t.hub.grants.ofEnvelope(envelope.id).find((g) => g.provider === "claude");
    assert.equal(claudeGrant.attemptsUsed, 0, "the plan's reviewer grant is untouched");
    assert.equal(claudeCalls(t).length, 0);
    // A different reviewer model under the open plan is a new plan, never a resume option.
    await dispatch(t.hub, "factory.pause", { missionId: t.mission.id });
    await waitFor(() => view(t, t.mission.id).factory.stage === "PAUSED", 30000, 100);
    await idleWithin(t, t.mission.id);
    await assert.rejects(dispatch(t.hub, "factory.resume", { missionId: t.mission.id, reviewerModel: "opus" }, "ui"), /nu se schimbă sub planul confirmat/);
    assert.equal(view(t, t.mission.id).factory.bindings.reviewer.resolvedAlias, "sonnet", "nothing changed");
    assert.equal(t.hub.bus.query({ typePrefix: "factory.model_override", limit: 5 }).length, 0);
    await dispatch(t.hub, "system.stop_all", { reason: "test" });
  } finally { await t.cleanup(); }
});

test("M09-MB-15 resume with another reviewer OUTSIDE a plan: the binding and the scope hash are recomputed, the old/new pair is recorded, the new model is sent", async () => {
  const t = await factoryHub();
  try {
    const { mission } = await prepare(t);
    t.queue("codex", "factory-write:bug-fix");
    t.queue("claude", "init-fable", "review:pass");
    await approveAndStart(t, mission.id);
    const refused = await untilStage(t, mission.id, ["BLOCKED", "NEEDS_OWNER_DECISION", "DELIVERY_READY"], 120000);
    await idleWithin(t, mission.id);
    assert.match(refused.factory.stageReason, /billing/);
    const oldHash = refused.factory.scopeHash;
    const oldBinding = refused.factory.bindings.reviewer;
    await dispatch(t.hub, "factory.resume", { missionId: mission.id, reviewerModel: "opus" }, "ui");
    const done = await untilStage(t, mission.id, ["DELIVERY_READY", "NEEDS_OWNER_DECISION", "BLOCKED"]);
    assert.equal(done.factory.stage, "DELIVERY_READY", done.factory.stageReason);
    assert.equal(done.factory.bindings.reviewer.resolvedAlias, "opus");
    assert.notEqual(done.factory.scopeHash, oldHash, "the approved scope hash follows the new binding");
    const [event] = t.hub.bus.query({ typePrefix: "factory.model_override", limit: 5 });
    assert.equal(event.payload.old.model, "sonnet");
    assert.equal(event.payload.old.bindingHash, oldBinding.bindingHash);
    assert.equal(event.payload.new.model, "opus");
    assert.equal(event.payload.new.bindingHash, done.factory.bindings.reviewer.bindingHash);
    assert.deepEqual(done.dispatches.filter((d) => d.stage === "REVIEWING").map((d) => [d.status, d.request.model]), [["FAILED", "sonnet"], ["DONE", "opus"]]);
    assert.equal(argOf(claudeCalls(t).at(-1), "--model"), "opus");
    assert.equal(done.factory.bindings.writer.bindingHash, refused.factory.bindings.writer.bindingHash, "the writer's binding is unchanged");
  } finally { await t.cleanup(); }
});
