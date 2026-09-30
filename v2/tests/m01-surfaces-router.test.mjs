import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeTestHub, enableLive, waitFor } from "./helpers.mjs";
import { HubError } from "../server/core/errors.mjs";
import { SURFACE_OPERATIONS, OPERATION_SUPPORT } from "../server/domain/surfaces.mjs";
import { TELEMETRY_SOURCES } from "../server/runtime/telemetry.mjs";
import { ATTESTATION_TEXT } from "../server/policy/billing.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const readEcosystem = (name) => JSON.parse(fs.readFileSync(path.join(here, "..", "config", "ecosystem", `${name}.json`), "utf8"));
const SURFACES_CFG = readEcosystem("surfaces");
const ROUTING_CFG = readEcosystem("routing");
const CODEX = "openai.codex_app_server";
const CLAUDE = "anthropic.claude_code_headless";
const API_SURFACES = ["openai.agents_api", "openai.decisions_api"];
const PAID_BILLING = new Set(["api", "paid_plan", "cloud_provider"]);

const cmd = (hub, type, payload = {}) => hub.commands.dispatch({ type, payload, actor: "user", channel: "test" });
const route = async (hub, payload) => (await cmd(hub, "route.adhoc", payload)).result;
const alt = (decision, surfaceId) => decision.alternatives.find((a) => a.surfaceId === surfaceId);
const factor = (entry, id) => entry.factors.find((f) => f.id === id);
const decisionRow = (hub, id) => hub.db.prepare("SELECT * FROM route_decisions WHERE id = ?").get(id);

async function probe(hub, provider, withModels = false) {
  const { command, result } = await cmd(hub, "provider.probe", { provider, withModels });
  assert.equal(command.status, "executed");
  assert.equal(result.ok, true, `${provider} probe: ${result.error}`);
}
async function probeBoth(hub, { withModels = false } = {}) {
  await Promise.all([probe(hub, "codex", withModels), probe(hub, "claude")]);
}
async function attestBoth(hub) {
  for (const provider of ["codex", "claude"]) await cmd(hub, "billing.attest", { provider, confirmText: ATTESTATION_TEXT[provider] });
}

/** Expected normalized operations: string or {support, note}; anything missing is UNSUPPORTED. */
function expectedOperations(ops = {}) {
  return Object.fromEntries(SURFACE_OPERATIONS.map((op) => {
    const value = ops[op];
    const support = typeof value === "string" ? value : value?.support || "UNSUPPORTED";
    return [op, { support, note: typeof value === "object" && value?.note ? value.note : "" }];
  }));
}

let historySeq = 0;
function addOutcomes(hub, { surfaceId, provider, outcome, count, taskType = "coding" }) {
  const now = new Date().toISOString();
  const insert = hub.db.prepare(`INSERT INTO execution_telemetry (id, run_id, task_type, provider, surface_id, verified_outcome, sources_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (let i = 0; i < count; i += 1) {
    historySeq += 1;
    insert.run(`tel_hist_${historySeq}`, `run_hist_${historySeq}`, taskType, provider, surfaceId, outcome, JSON.stringify({ verifiedOutcome: "DERIVED" }), now, now);
  }
}

async function developmentMission(hub, title = "Routing mission") {
  const { result: mission } = await cmd(hub, "mission.create", { projectId: hub.projects.hub().id, kind: "development", title, objective: "Exercise the capability router" });
  return { mission, tasks: hub.missions.tasks(mission.id) };
}

// ---------------------------------------------------------------- execution surfaces

test("M01-surfaces-01 boot seed loads every surface declared in surfaces.json with its declared metadata", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    const declared = SURFACES_CFG.surfaces;
    assert.ok(declared.length >= 30, "the registry is not empty");
    assert.equal(new Set(declared.map((s) => s.id)).size, declared.length, "config ids are unique");
    assert.deepEqual(hub.surfaces.list().map((s) => s.id).sort(), declared.map((s) => s.id).sort());
    for (const s of declared) {
      const got = hub.surfaces.get(s.id);
      assert.equal(got.provider, s.provider, s.id);
      assert.equal(got.surfaceType, s.surfaceType, s.id);
      assert.equal(got.name, s.name, s.id);
      assert.equal(got.description, s.description || "", s.id);
      assert.equal(got.billingMode, s.billingMode || "unknown", s.id);
      assert.equal(got.programmaticControl, s.programmaticControl, s.id);
      assert.equal(got.location, s.location || "local", s.id);
      assert.equal(got.adapter, s.adapter || "none", s.id);
      assert.equal(got.availability, s.availability || "unknown", `${s.id}: baseline availability kept until a local verification`);
      assert.equal(got.availabilityReason, s.availabilityReason || "", s.id);
      assert.equal(got.hubDecision, s.hubDecision || "", s.id);
      assert.equal(got.authMode, s.authMode || "", s.id);
      assert.deepEqual(got.capabilities, s.capabilities || [], s.id);
      assert.deepEqual(got.safetyConstraints, s.safetyConstraints || [], s.id);
      assert.equal(got.configVersion, SURFACES_CFG.version, s.id);
      assert.equal(got.verifiedAt, null, `${s.id} is not runtime-verified on a fresh hub`);
    }
    assert.deepEqual(hub.surfaces.list({ provider: "openai" }).map((s) => s.id).sort(), declared.filter((s) => s.provider === "openai").map((s) => s.id).sort());
    assert.equal(hub.getBootReport().seeded.surfaces, declared.length);
    const seeded = hub.bus.query({ typePrefix: "surfaces.seeded" });
    assert.equal(seeded.length, 1);
    assert.equal(seeded[0].payload.surfaces, declared.length);

    const again = hub.surfaces.seed();
    assert.equal(again.surfaces, declared.length);
    assert.equal(hub.db.prepare("SELECT COUNT(*) AS n FROM execution_surfaces").get().n, declared.length, "seed is idempotent");
  } finally { await t.cleanup(); }
});

test("M01-surfaces-02 every surface exposes the nine adapter operations with a valid support level", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    assert.equal(SURFACE_OPERATIONS.length, 9);
    assert.deepEqual([...SURFACE_OPERATIONS].sort(), ["getArtifacts", "getStatus", "interrupt", "prepareHandoff", "resume", "sendInput", "start", "stop", "streamEvents"]);
    assert.deepEqual([...OPERATION_SUPPORT].sort(), ["ASSISTED", "PLANNED", "SUPPORTED", "UNSUPPORTED"]);
    for (const s of SURFACES_CFG.surfaces) {
      const { operations } = hub.surfaces.get(s.id);
      assert.deepEqual(Object.keys(operations).sort(), [...SURFACE_OPERATIONS].sort(), s.id);
      for (const op of SURFACE_OPERATIONS) {
        assert.ok(OPERATION_SUPPORT.includes(operations[op].support), `${s.id}.${op} = ${operations[op].support}`);
        assert.equal(typeof operations[op].note, "string", `${s.id}.${op}`);
      }
      assert.deepEqual(operations, expectedOperations(s.operations), s.id);
    }
    const codex = hub.surfaces.get(CODEX).operations;
    assert.equal(codex.start.support, "SUPPORTED");
    assert.equal(codex.sendInput.support, "UNSUPPORTED");
    assert.match(codex.sendInput.note, /turn\/steer/);
    assert.equal(hub.surfaces.get(CLAUDE).operations.sendInput.support, "PLANNED");
    assert.equal(hub.surfaces.get("openai.codex_cli").operations.resume.support, "UNSUPPORTED", "an operation missing from config is UNSUPPORTED");
    assert.ok(Object.values(hub.surfaces.get("openai.plugins").operations).every((o) => o.support === "UNSUPPORTED"));
  } finally { await t.cleanup(); }
});

test("M01-surfaces-03 requireOperation returns the support level or throws a validation error labelled UNSUPPORTED with details", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    const ok = hub.surfaces.requireOperation(CODEX, "start");
    assert.equal(ok.support, "SUPPORTED");
    assert.equal(ok.surface.id, CODEX);
    assert.equal(hub.surfaces.requireOperation("anthropic.claude_research", "start").support, "ASSISTED");

    const unsupported = (surfaceId, operation, support, extra = null) => (error) => {
      assert.ok(error instanceof HubError, String(error));
      assert.equal(error.category, "validation");
      assert.equal(error.status, 400);
      assert.match(error.message, /UNSUPPORTED/);
      assert.deepEqual(error.details, { surfaceId, operation, support });
      if (extra) assert.match(error.message, extra);
      return true;
    };
    assert.throws(() => hub.surfaces.requireOperation(CODEX, "sendInput"), unsupported(CODEX, "sendInput", "UNSUPPORTED", /turn\/steer/));
    assert.throws(() => hub.surfaces.requireOperation(CLAUDE, "sendInput"), unsupported(CLAUDE, "sendInput", "PLANNED"), "PLANNED is refused like UNSUPPORTED");
    assert.throws(() => hub.surfaces.requireOperation("openai.agents_api", "start"), unsupported("openai.agents_api", "start", "UNSUPPORTED"));
    assert.throws(() => hub.surfaces.requireOperation("anthropic.claude_code_background", "start"), unsupported("anthropic.claude_code_background", "start", "UNSUPPORTED"));
    assert.throws(() => hub.surfaces.requireOperation(CODEX, "teleport"), (e) => e.category === "validation" && /Unknown operation/.test(e.message) && e.details === undefined);
    assert.throws(() => hub.surfaces.requireOperation("openai.nope", "start"), (e) => e.category === "not_found");

    // The same contract error travels unchanged through the command bus.
    await assert.rejects(cmd(hub, "assisted.prepare", { taskId: "task_missing", surfaceId: "openai.agents_api" }), unsupported("openai.agents_api", "start", "UNSUPPORTED"));
    const logged = hub.commands.list({ type: "assisted.prepare" })[0];
    assert.equal(logged.status, "failed");
    assert.match(logged.error, /UNSUPPORTED/);
  } finally { await t.cleanup(); }
});

test("M01-surfaces-04 Agents API and Decisions API are registered as API-billed and blocked", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    for (const id of API_SURFACES) {
      const s = hub.surfaces.get(id);
      assert.ok(s, id);
      assert.equal(s.provider, "openai", id);
      assert.equal(s.billingMode, "api", id);
      assert.equal(s.availability, "blocked", id);
      assert.equal(s.hubDecision, "REJECT", id);
      assert.ok(s.safetyConstraints.some((c) => /paid_api_inference/.test(c)), id);
      assert.ok(Object.values(s.operations).every((o) => o.support === "UNSUPPORTED"), `${id} has no adapter operations`);
    }
    assert.equal(hub.surfaces.list().filter((s) => s.billingMode === "api").every((s) => s.availability === "blocked"), true, "every API-billed surface is blocked");
  } finally { await t.cleanup(); }
});

test("M01-surfaces-05 provider.probe through the command bus makes the local model surfaces available and records PASS_LOCAL verifications", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    for (const id of [CODEX, CLAUDE]) {
      const s = hub.surfaces.get(id);
      assert.equal(s.availability, "unknown", id);
      assert.equal(s.verifiedAt, null, id);
      assert.equal(hub.surfaces.verifications({ surfaceId: id }).length, 0, id);
    }
    await probeBoth(hub);
    assert.equal(hub.commands.list({ type: "provider.probe" }).filter((c) => c.status === "executed").length, 2);

    const codex = hub.surfaces.get(CODEX);
    assert.equal(codex.availability, "available");
    assert.ok(codex.verifiedAt);
    assert.match(codex.availabilityReason, /account\/read ChatGPT/);
    assert.equal(codex.evidence.version, "codex-cli 0.0.0-fake");
    assert.equal(codex.evidence.accountType, "chatgpt");
    assert.equal(codex.evidence.planType, "pro");
    const claude = hub.surfaces.get(CLAUDE);
    assert.equal(claude.availability, "available");
    assert.ok(claude.verifiedAt);
    assert.equal(claude.evidence.authMethod, "claude.ai");
    assert.equal(claude.evidence.subscriptionType, "max");

    for (const id of [CODEX, CLAUDE]) {
      const list = hub.surfaces.verifications({ surfaceId: id });
      assert.ok(list.length >= 1, id);
      assert.ok(list.every((v) => v.label === "PASS_LOCAL" && v.method === "account_probe" && v.verifiedBy === "hub"), id);
    }
    const verifiedEvents = hub.bus.query({ typePrefix: "capability.verified" });
    for (const id of [CODEX, CLAUDE]) assert.ok(verifiedEvents.some((e) => e.payload.surfaceId === id && e.payload.label === "PASS_LOCAL"), id);
    assert.ok(!JSON.stringify([codex, claude, hub.surfaces.verifications()]).includes("example.com"), "no account identity in surface evidence");

    for (const id of API_SURFACES) assert.equal(hub.surfaces.get(id).availability, "blocked", `${id} stays blocked after probes`);
    assert.equal(hub.surfaces.get("anthropic.claude_code_background").availability, "unknown", "no mirror was read");

    hub.surfaces.seed();
    const reseeded = hub.surfaces.get(CODEX);
    assert.equal(reseeded.availability, "available", "a re-seed keeps runtime-verified availability");
    assert.equal(reseeded.verifiedAt, codex.verifiedAt);
    assert.deepEqual(reseeded.evidence, codex.evidence);
  } finally { await t.cleanup(); }
});

test("M01-surfaces-06 a Codex API-key account leaves the Codex surface in needs_setup with FAIL and the router refuses it even when preferred", async () => {
  const t = await makeTestHub({ codex: "apikey" });
  try {
    const { hub } = t;
    await probeBoth(hub);
    const codex = hub.surfaces.get(CODEX);
    assert.equal(codex.availability, "needs_setup");
    assert.equal(codex.evidence.accountType, "apiKey");
    const verifications = hub.surfaces.verifications({ surfaceId: CODEX });
    assert.ok(verifications.length >= 1);
    assert.ok(verifications.every((v) => v.label === "FAIL" && v.method === "account_probe"));
    assert.equal(hub.surfaces.get(CLAUDE).availability, "available");

    await attestBoth(hub);
    const decision = await route(hub, { taskType: "coding", preferredProvider: "openai" });
    assert.equal(decision.surfaceId, CLAUDE);
    const codexAlt = alt(decision, CODEX);
    assert.equal(codexAlt.excluded, true);
    assert.equal(codexAlt.score, null);
    assert.equal(factor(codexAlt, "billing_route").effect, "exclude");
    assert.match(factor(codexAlt, "billing_route").detail, /API key/);
    assert.equal(factor(codexAlt, "preference").effect, "+30", "the preference was considered and still lost");

    assert.throws(() => hub.bus.transaction(() => hub.router.route({ taskType: "coding", override: { surfaceId: CODEX, reason: "Force Codex anyway" } }, "user")),
      (e) => e.category === "policy" && /Override refuzat/.test(e.message) && /API key/.test(e.message));
  } finally { await t.cleanup(); }
});

test("M01-surfaces-07 capability.verify records labelled evidence and refuses PASS_LIVE without a live_run", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    const verify = (payload) => cmd(hub, "capability.verify", payload);
    for (const method of ["doc_read", "local_cli", "account_probe", "simulated_test", "manual"]) {
      await assert.rejects(verify({ surfaceId: CODEX, method, label: "PASS_LIVE", summary: "Claims a live pass" }),
        (e) => e.category === "validation" && /PASS_LIVE requires a live_run/.test(e.message), method);
    }
    assert.equal(hub.surfaces.verifications({ surfaceId: CODEX }).length, 0, "no PASS_LIVE was recorded");
    assert.ok(hub.commands.list({ type: "capability.verify" }).every((c) => c.status === "failed"));
    await assert.rejects(verify({ method: "manual", label: "PASS_LOCAL", summary: "No subject given" }), (e) => e.category === "validation");
    await assert.rejects(verify({ surfaceId: CODEX, method: "manual", label: "GREAT", summary: "Unknown label" }), (e) => e.category === "validation");
    await assert.rejects(verify({ surfaceId: CODEX, method: "vibes", label: "PASS_LOCAL", summary: "Unknown method" }), (e) => e.category === "validation");

    const { result: simulated } = await verify({ surfaceId: CODEX, method: "simulated_test", label: "PASS_SIMULATED", summary: "Fake app-server turn passed", evidence: { test: "providers.test.mjs" } });
    const { result: live } = await verify({ surfaceId: CODEX, method: "live_run", label: "PASS_LIVE", summary: "Live run evidence recorded", evidence: { runId: "run_x" } });
    const recorded = hub.surfaces.verifications({ surfaceId: CODEX });
    assert.deepEqual(recorded.map((v) => v.id).sort(), [simulated.id, live.id].sort());
    const sim = recorded.find((v) => v.id === simulated.id);
    assert.equal(sim.label, "PASS_SIMULATED");
    assert.equal(sim.method, "simulated_test");
    assert.equal(sim.verifiedBy, "user");
    assert.equal(sim.summary, "Fake app-server turn passed");
    assert.deepEqual(sim.evidence, { test: "providers.test.mjs" });
    assert.equal(recorded.find((v) => v.id === live.id).method, "live_run");
    assert.ok(hub.bus.query({ typePrefix: "capability.verified" }).some((e) => e.payload.label === "PASS_SIMULATED" && e.source === "user"));

    assert.throws(() => hub.bus.transaction(() => hub.surfaces.recordVerification({ surfaceId: CODEX, method: "guess", label: "PASS_LOCAL", summary: "x" })),
      (e) => e.category === "validation");
  } finally { await t.cleanup(); }
});

// ---------------------------------------------------------------- router

test("M01-router-01 route.adhoc coding: blocked without provider facts, planned_only in BUILD_SAFE once a model surface wins, decision persisted", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    assert.equal(hub.settings.get("mode"), "BUILD_SAFE");
    const blocked = await route(hub, { taskType: "coding" });
    assert.equal(blocked.executionMode, "blocked");
    assert.equal(blocked.surfaceId, null);
    for (const id of [CLAUDE, CODEX]) {
      assert.ok(blocked.reason.includes(id), `the blocked reason names ${id}`);
      assert.equal(alt(blocked, id).excluded, true);
      assert.equal(factor(alt(blocked, id), "billing_route").effect, "exclude");
    }

    await probeBoth(hub);
    const unattested = await route(hub, { taskType: "coding" });
    assert.equal(unattested.executionMode, "planned_only");
    assert.ok([CLAUDE, CODEX].includes(unattested.surfaceId));
    assert.equal(factor(unattested, "billing_route").effect, "-15");
    assert.match(factor(unattested, "billing_route").detail, /provider_side_overage_setting/);

    await attestBoth(hub);
    const decision = await route(hub, { taskType: "coding" });
    assert.ok([CLAUDE, CODEX].includes(decision.surfaceId));
    assert.equal(decision.provider, decision.surfaceId === CODEX ? "codex" : "claude");
    assert.equal(decision.executionMode, "planned_only", "BUILD_SAFE only plans a model surface");
    assert.equal(decision.status, "proposed");
    assert.equal(decision.subjectType, "adhoc");
    assert.equal(decision.taskType, "coding");
    assert.equal(decision.roleId, ROUTING_CFG.taskTypes.coding.roles[0]);
    assert.equal(decision.departmentId, hub.company.department("engineering").id);
    assert.deepEqual(decision.tools, ROUTING_CFG.taskTypes.coding.tools);
    assert.equal(decision.manualOverride, false);
    assert.equal(factor(decision, "billing_route").effect, "0");
    for (const id of [CLAUDE, CODEX]) assert.equal(alt(decision, id).score, alt(unattested, id).score + 15, `${id}: attestation removes the -15 penalty`);

    const row = decisionRow(hub, decision.id);
    assert.equal(row.subject_type, "adhoc");
    assert.equal(row.subject_id, decision.id);
    assert.equal(row.execution_mode, "planned_only");
    assert.equal(row.surface_id, decision.surfaceId);
    assert.equal(row.manual_override, 0);
    assert.equal(row.status, "proposed");
    const factors = JSON.parse(row.factors_json);
    for (const id of ["availability", "billing", "billing_route", "usage_reserve", "history"]) assert.ok(factors.some((f) => f.id === id), `factor ${id} persisted`);
    for (const f of factors) for (const key of ["id", "effect", "detail"]) assert.equal(typeof f[key], "string", `${f.id}.${key}`);
    const alternatives = JSON.parse(row.alternatives_json);
    assert.deepEqual(alternatives.map((a) => a.surfaceId).sort(), ROUTING_CFG.taskTypes.coding.candidates.map((c) => c.surface).sort());
    for (const a of alternatives) {
      assert.equal(a.excluded, false, a.surfaceId);
      assert.equal(typeof a.score, "number", a.surfaceId);
      assert.ok(a.factors.length >= 5, a.surfaceId);
    }
    assert.ok(row.reason.includes(hub.surfaces.get(decision.surfaceId).name));
    assert.match(row.reason, /BUILD_SAFE/);
    const event = hub.bus.query({ typePrefix: "route.decided" }).find((e) => e.payload.routeId === decision.id);
    assert.ok(event);
    assert.equal(event.payload.executionMode, "planned_only");
    assert.equal(event.payload.surfaceId, decision.surfaceId);

    const local = await route(hub, { taskType: "operations" });
    assert.equal(local.surfaceId, "hub.local");
    assert.equal(local.executionMode, "programmatic", "local Hub tools without a model stay executable in BUILD_SAFE");
    assert.equal(local.provider, "hub");
    assert.equal(local.model, "");

    await cmd(hub, "mode.set", { mode: "LIVE_VALIDATION", confirm: "LIVE_VALIDATION" });
    assert.equal((await route(hub, { taskType: "coding" })).executionMode, "programmatic");
    await cmd(hub, "mode.set", { mode: "BUILD_SAFE" });
    assert.equal((await route(hub, { taskType: "coding" })).executionMode, "planned_only");
    await assert.rejects(route(hub, { taskType: "teleportation" }), (e) => e.category === "validation" && /Unknown task type/.test(e.message));
  } finally { await t.cleanup(); }
});

test("M01-router-02 an API-billed surface is never chosen, even with preferredProvider and an owner routing preference", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    await probeBoth(hub);
    await attestBoth(hub);
    await assert.rejects(cmd(hub, "settings.update", { routingPreferences: { teleportation: { provider: "openai" } } }), (e) => e.category === "validation");
    await cmd(hub, "settings.update", { routingPreferences: { coding: { provider: "openai" } } });
    const preferred = await route(hub, { taskType: "coding", preferredProvider: "openai" });
    assert.equal(preferred.surfaceId, CODEX);
    assert.deepEqual(preferred.factors.filter((f) => f.id === "preference").map((f) => f.effect).sort(), ["+25", "+30"]);

    // The same surface billed through an API is excluded however strongly it is preferred.
    hub.db.prepare("UPDATE execution_surfaces SET billing_mode = 'api' WHERE id = ?").run(CODEX);
    const refused = await route(hub, { taskType: "coding", preferredProvider: "openai" });
    assert.equal(refused.surfaceId, CLAUDE);
    const codexAlt = alt(refused, CODEX);
    assert.equal(codexAlt.excluded, true);
    assert.equal(codexAlt.score, null);
    assert.equal(factor(codexAlt, "billing").effect, "exclude");
    assert.match(factor(codexAlt, "billing").detail, /API/i);
    assert.equal(codexAlt.factors.filter((f) => f.id === "preference").length, 2);
    assert.throws(() => hub.bus.transaction(() => hub.router.route({ taskType: "coding", override: { surfaceId: CODEX, reason: "Owner insists" } }, "user")),
      (e) => e.category === "policy" && /Override refuzat/.test(e.message));

    for (const { id: taskType } of hub.router.taskTypes()) {
      for (const preferredProvider of ["openai", "anthropic"]) {
        const d = await route(hub, { taskType, preferredProvider });
        if (d.surfaceId) assert.ok(!PAID_BILLING.has(hub.surfaces.get(d.surfaceId).billingMode), `${taskType}/${preferredProvider} chose ${d.surfaceId}`);
        for (const a of d.alternatives) {
          const s = hub.surfaces.get(a.surfaceId);
          if (s && PAID_BILLING.has(s.billingMode)) {
            assert.ok(a.excluded && a.factors.some((f) => f.id === "billing" && f.effect === "exclude"), `${taskType}: ${a.surfaceId} must be excluded for billing`);
          }
        }
      }
    }
  } finally { await t.cleanup(); }
});

test("M01-router-03 dataSensitivity: confidential excludes cloud surfaces, secret blocks every model surface", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    await probeBoth(hub);
    await attestBoth(hub);
    const normal = await route(hub, { taskType: "research" });
    assert.equal(normal.surfaceId, "anthropic.claude_research");
    assert.equal(normal.executionMode, "assisted");

    const confidential = await route(hub, { taskType: "research", dataSensitivity: "confidential" });
    assert.equal(confidential.surfaceId, CLAUDE);
    assert.equal(hub.surfaces.get(confidential.surfaceId).location, "local");
    assert.equal(confidential.executionMode, "planned_only");
    for (const id of ["anthropic.claude_research", "openai.chatgpt_work"]) {
      assert.equal(alt(confidential, id).excluded, true, id);
      assert.equal(factor(alt(confidential, id), "data_sensitivity").effect, "exclude", id);
    }
    for (const { id: taskType } of hub.router.taskTypes()) {
      const d = await route(hub, { taskType, dataSensitivity: "confidential" });
      if (d.surfaceId) assert.notEqual(hub.surfaces.get(d.surfaceId).location, "cloud", `${taskType} chose ${d.surfaceId}`);
      for (const a of d.alternatives) {
        if (hub.surfaces.get(a.surfaceId)?.location === "cloud") {
          assert.ok(a.excluded && factor(a, "data_sensitivity")?.effect === "exclude", `${taskType}: ${a.surfaceId}`);
        }
      }
    }

    const secret = await route(hub, { taskType: "coding", dataSensitivity: "secret" });
    assert.equal(secret.executionMode, "blocked");
    assert.equal(secret.surfaceId, null);
    assert.equal(secret.provider, "");
    assert.equal(secret.model, "");
    for (const a of secret.alternatives) {
      assert.equal(a.excluded, true, a.surfaceId);
      assert.equal(factor(a, "data_sensitivity").effect, "exclude", a.surfaceId);
    }
    assert.equal(decisionRow(hub, secret.id).execution_mode, "blocked");
    await assert.rejects(route(hub, { taskType: "coding", dataSensitivity: "public" }), (e) => e.category === "validation");
  } finally { await t.cleanup(); }
});

test("M01-router-04 manual override: a billing-blocked target is refused, an eligible target is recorded with manual_override=1 and its reason", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    await probe(hub, "codex", true);
    await attestBoth(hub);
    const { tasks } = await developmentMission(hub, "Override mission");
    const build = tasks.find((x) => x.taskType === "coding");
    assert.ok(build, "the development template has a coding task");
    const decisionsFor = (taskId) => hub.db.prepare("SELECT COUNT(*) AS n FROM route_decisions WHERE subject_id = ?").get(taskId).n;

    for (const surfaceId of API_SURFACES) {
      await assert.rejects(cmd(hub, "route.task", { taskId: build.id, override: { surfaceId, reason: "Use the API harness" } }),
        (e) => e.category === "policy" && /Override refuzat/.test(e.message) && /API/.test(e.message), surfaceId);
    }
    await assert.rejects(cmd(hub, "route.task", { taskId: build.id, dataSensitivity: "secret", override: { surfaceId: CODEX, reason: "Secret but forced" } }),
      (e) => e.category === "policy" && /Override refuzat/.test(e.message));
    await assert.rejects(cmd(hub, "route.task", { taskId: build.id, override: { surfaceId: CODEX, reason: "x" } }),
      (e) => e.category === "validation" && /reason/.test(e.message));
    assert.equal(decisionsFor(build.id), 0, "refused overrides persist nothing");
    assert.equal(hub.missions.task(build.id).routeDecisionId, null);
    assert.equal(hub.commands.list({ type: "route.task" }).filter((c) => c.status === "failed").length, 4);

    const { result: forced } = await cmd(hub, "route.task", { taskId: build.id, override: { surfaceId: CODEX, reason: "Owner wants Codex for this change" } });
    assert.equal(forced.surfaceId, CODEX);
    assert.equal(forced.provider, "codex");
    assert.equal(forced.manualOverride, true);
    assert.equal(forced.overrideBy, "user");
    assert.equal(forced.executionMode, "planned_only");
    assert.equal(forced.model, "gpt-fake-sol");
    assert.match(forced.reason, /override: Owner wants Codex for this change/);
    const row = decisionRow(hub, forced.id);
    assert.equal(row.manual_override, 1);
    assert.equal(row.override_by, "user");
    assert.equal(row.subject_type, "task");
    assert.equal(row.subject_id, build.id);
    assert.match(row.reason, /Owner wants Codex for this change/);
    assert.equal(hub.missions.task(build.id).routeDecisionId, forced.id);
    const event = hub.bus.query({ typePrefix: "route.decided" }).find((e) => e.payload.routeId === forced.id);
    assert.equal(event.payload.manualOverride, true);
    assert.equal(event.scopeType, "task");
    assert.equal(event.scopeId, build.id);

    const { result: withModel } = await cmd(hub, "route.task", { taskId: build.id, override: { surfaceId: CODEX, reason: "Pin an explicit model", model: "gpt-fake-pinned" } });
    assert.equal(withModel.surfaceId, CODEX);
    assert.equal(withModel.model, "gpt-fake-pinned");
    assert.match(withModel.modelNote, /manual/);
    assert.equal(decisionRow(hub, withModel.id).model, "gpt-fake-pinned");
    assert.equal(hub.router.get(forced.id).status, "superseded");
  } finally { await t.cleanup(); }
});

test("M01-router-05 the Codex model comes from the reported model list when present, otherwise it stays empty with a note", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    await probe(hub, "codex");
    await attestBoth(hub);
    assert.equal(hub.providerState.get("codex").models, undefined);
    const noList = await route(hub, { taskType: "coding", preferredProvider: "openai" });
    assert.equal(noList.surfaceId, CODEX);
    assert.equal(noList.model, "");
    assert.match(noList.modelNote, /Lista de modele Codex/);
    assert.equal(decisionRow(hub, noList.id).model, "");

    await probe(hub, "codex", true);
    assert.equal(hub.providerState.get("codex").models[0].id, "gpt-fake-sol");
    const listed = await route(hub, { taskType: "coding", preferredProvider: "openai" });
    assert.equal(listed.surfaceId, CODEX);
    assert.equal(listed.model, "gpt-fake-sol");
    assert.match(listed.modelNote, /Fake Sol/);
    assert.equal(decisionRow(hub, listed.id).model, "gpt-fake-sol");
    assert.ok(listed.reason.includes("gpt-fake-sol"));

    const unmatched = await route(hub, { taskType: "testing_qa", preferredProvider: "openai" });
    assert.equal(unmatched.surfaceId, CODEX);
    assert.equal(unmatched.model, "", "a hint missing from model/list is not invented");
    assert.match(unmatched.modelNote, /luna/);
    assert.match(unmatched.modelNote, /model\/list/);
  } finally { await t.cleanup(); }
});

test("M01-router-06 route.task writes tasks.route_decision_id and supersedes only that task's older proposals", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    await probe(hub, "codex");
    await attestBoth(hub);
    const { tasks } = await developmentMission(hub);
    const build = tasks.find((x) => x.taskType === "coding");
    const review = tasks.find((x) => x.taskType === "code_review");
    const qa = tasks.find((x) => x.taskType === "testing_qa");

    const { result: first } = await cmd(hub, "route.task", { taskId: build.id });
    assert.equal(first.subjectType, "task");
    assert.equal(first.subjectId, build.id);
    assert.equal(first.taskType, "coding");
    assert.equal(first.roleId, build.roleId);
    assert.ok(build.departmentId);
    assert.equal(first.departmentId, build.departmentId);
    assert.equal(first.status, "proposed");
    assert.equal(hub.missions.task(build.id).routeDecisionId, first.id);

    const { result: reviewDecision } = await cmd(hub, "route.task", { taskId: review.id });
    const { result: adhoc } = await cmd(hub, "route.adhoc", { taskType: "coding" });
    const { result: second } = await cmd(hub, "route.task", { taskId: build.id, preferredProvider: "openai" });
    assert.equal(second.surfaceId, CODEX);
    assert.equal(hub.router.get(first.id).status, "superseded");
    assert.equal(hub.router.get(second.id).status, "proposed");
    assert.equal(hub.router.get(reviewDecision.id).status, "proposed", "another task's proposal is untouched");
    assert.equal(hub.router.get(adhoc.id).status, "proposed", "adhoc proposals are untouched");
    assert.equal(hub.missions.task(build.id).routeDecisionId, second.id);
    assert.equal(hub.missions.task(review.id).routeDecisionId, reviewDecision.id);
    assert.deepEqual(hub.router.list({ subjectId: build.id }).map((d) => d.id).sort(), [first.id, second.id].sort());
    assert.equal(hub.db.prepare("SELECT COUNT(*) AS n FROM route_decisions WHERE subject_id = ? AND status = 'proposed'").get(build.id).n, 1);

    hub.db.prepare("UPDATE tasks SET task_type = '' WHERE id = ?").run(qa.id);
    await assert.rejects(cmd(hub, "route.task", { taskId: qa.id }), (e) => e.category === "validation" && /task type/.test(e.message));
    await assert.rejects(cmd(hub, "route.task", { taskId: "task_missing" }), (e) => e.category === "not_found");
  } finally { await t.cleanup(); }
});

test("M01-router-07 verified outcome history moves a surface score once there are at least 3 verified/rejected outcomes", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    await probeBoth(hub);
    await attestBoth(hub);
    const history = (d, id) => factor(alt(d, id), "history");
    const baseline = await route(hub, { taskType: "coding" });
    const base = { codex: alt(baseline, CODEX).score, claude: alt(baseline, CLAUDE).score };
    assert.equal(history(baseline, CODEX).effect, "0");
    assert.match(history(baseline, CODEX).detail, /< 3/);

    addOutcomes(hub, { surfaceId: CODEX, provider: "codex", outcome: "verified", count: 2 });
    const two = await route(hub, { taskType: "coding" });
    assert.equal(history(two, CODEX).effect, "0", "two outcomes are not enough");
    assert.equal(alt(two, CODEX).score, base.codex);

    addOutcomes(hub, { surfaceId: CODEX, provider: "codex", outcome: "verified", count: 1 });
    const three = await route(hub, { taskType: "coding" });
    assert.equal(history(three, CODEX).effect, "+20");
    assert.match(history(three, CODEX).detail, /3\/3/);
    assert.equal(alt(three, CODEX).score, base.codex + 20);
    assert.equal(three.surfaceId, CODEX, "the verified history decides between equal surfaces");

    addOutcomes(hub, { surfaceId: CLAUDE, provider: "claude", outcome: "unverified", count: 3 });
    assert.equal(history(await route(hub, { taskType: "coding" }), CLAUDE).effect, "0", "unverified runs do not count");
    addOutcomes(hub, { surfaceId: CLAUDE, provider: "claude", outcome: "rejected", count: 3 });
    const rejected = await route(hub, { taskType: "coding" });
    assert.equal(history(rejected, CLAUDE).effect, "-20");
    assert.equal(alt(rejected, CLAUDE).score, base.claude - 20);

    addOutcomes(hub, { surfaceId: CODEX, provider: "codex", outcome: "rejected", count: 1 });
    const mixed = await route(hub, { taskType: "coding" });
    assert.equal(history(mixed, CODEX).effect, "+10", "3 of 4 verified");
    assert.match(history(mixed, CODEX).detail, /3\/4/);

    addOutcomes(hub, { surfaceId: CODEX, provider: "codex", outcome: "rejected", count: 3, taskType: "devops" });
    assert.equal(history(await route(hub, { taskType: "coding" }), CODEX).effect, "+10", "history is per task type");
    assert.equal(history(await route(hub, { taskType: "devops" }), CODEX).effect, "-20");

    const codexOutcome = hub.telemetry.outcomes({ taskType: "coding" }).find((o) => o.surfaceId === CODEX);
    assert.equal(codexOutcome.verified, 3);
    assert.equal(codexOutcome.rejected, 1);
    assert.equal(codexOutcome.successRate, 0.75);
    assert.equal(codexOutcome.source, "DERIVED");
  } finally { await t.cleanup(); }
});

// ---------------------------------------------------------------- telemetry

test("M01-telemetry-01 a fake Codex turn records labelled execution telemetry and task verification marks the outcome verified", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    const { project } = await enableLive(hub);
    const mission = hub.bus.transaction(() => hub.missions.create({ projectId: project.id, kind: "development", title: "Telemetry mission", objective: "Measure one run" }));
    const [plan] = hub.missions.tasks(mission.id);
    hub.bus.transaction(() => hub.missions.command(plan.id, "queue"));
    const conv = hub.bus.transaction(() => hub.conversations.create({ projectId: project.id, title: "Telemetry" }));
    hub.bus.transaction(() => hub.conversations.addMessage({ conversationId: conv.id, role: "user", content: "Plan the change" }));

    const { run } = await hub.runs.start({ conversationId: conv.id, provider: "codex", taskId: plan.id, stage: "owner", roleId: "planner" });
    const done = await waitFor(() => { const r = hub.runs.getRun(run.id); return ["completed", "failed", "blocked", "interrupted"].includes(r.status) ? r : null; }, 30000);
    assert.equal(done.status, "completed");
    assert.equal(hub.missions.task(plan.id).status, "VERIFYING");

    const tel = await waitFor(() => hub.telemetry.get(run.id));
    assert.equal(tel.surfaceId, CODEX);
    assert.equal(hub.db.prepare("SELECT surface_id FROM execution_telemetry WHERE run_id = ?").get(run.id).surface_id, CODEX);
    assert.equal(hub.db.prepare("SELECT COUNT(*) AS n FROM execution_telemetry WHERE run_id = ?").get(run.id).n, 1);
    assert.equal(tel.provider, "codex");
    assert.equal(tel.taskId, plan.id);
    assert.equal(tel.taskType, plan.taskType);
    assert.equal(tel.roleId, "planner");
    assert.equal(tel.model, "gpt-fake-sol");
    assert.equal(tel.attempts, 1);
    assert.equal(tel.failureCategory, null);
    assert.equal(tel.verifiedOutcome, "unverified");
    assert.equal(typeof tel.durationMs, "number");
    assert.ok(tel.durationMs >= 0);

    assert.equal(tel.sources.duration, "MEASURED");
    assert.equal(tel.sources.verifiedOutcome, "DERIVED");
    assert.ok(["PROVIDER_REPORTED", "UNKNOWN"].includes(tel.sources.usage));
    assert.equal(tel.sources.usage, Object.keys(tel.usage).length ? "PROVIDER_REPORTED" : "UNKNOWN");
    assert.equal(tel.sources.surface, "MEASURED");
    assert.equal(tel.sources.model, "PROVIDER_REPORTED");
    for (const [field, label] of Object.entries(tel.sources)) assert.ok(TELEMETRY_SOURCES.includes(label), `${field}=${label}`);

    await assert.rejects(cmd(hub, "task.command", { taskId: plan.id, action: "verify", evidence: { manualVerification: "ok" } }), (e) => e.category === "validation");
    assert.equal(hub.telemetry.get(run.id).verifiedOutcome, "unverified");
    await cmd(hub, "task.command", { taskId: plan.id, action: "verify", evidence: { manualVerification: "Read the plan output and checked it against the acceptance criteria" } });
    assert.equal(hub.missions.task(plan.id).status, "COMPLETED");
    const verified = await waitFor(() => { const x = hub.telemetry.get(run.id); return x.verifiedOutcome === "verified" ? x : null; });
    assert.equal(verified.verifiedOutcome, "verified");

    const outcome = hub.telemetry.outcomes({ taskType: plan.taskType }).find((o) => o.surfaceId === CODEX);
    assert.equal(outcome.verified, 1);
    assert.equal(outcome.rejected, 0);
    assert.equal(outcome.successRate, 1);
    assert.equal(outcome.source, "DERIVED");
  } finally { await t.cleanup(); }
});

test("M01-router-08 Codex model hint: whole token, hidden models skipped, the newest version wins", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    await probe(hub, "codex", true);
    await attestBoth(hub);
    // Provider state is persisted; replace the reported model list as a probe would.
    hub.providerState.set("codex", { ...hub.providerState.get("codex"), models: [
      { id: "gpt-5.6-sol", model: "gpt-5.6-sol", displayName: "GPT-5.6 Sol (legacy)", hidden: false },
      { id: "gpt-6.2-sol-preview", model: "gpt-6.2-sol-preview", displayName: "Hidden preview", hidden: true },
      { id: "gpt-6.1-sol", model: "gpt-6.1-sol", displayName: "GPT-6.1 Sol", hidden: false },
      { id: "gpt-6-console", model: "gpt-6-console", displayName: "Console helper", hidden: false },
    ] });
    const decision = await route(hub, { taskType: "coding", preferredProvider: "openai" });
    assert.equal(decision.surfaceId, CODEX);
    assert.equal(decision.model, "gpt-6.1-sol");
  } finally { await t.cleanup(); }
});
