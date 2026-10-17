import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeTestHub, enableLive, waitFor, tempDir, makeProject } from "./helpers.mjs";
import { loadConfig } from "../server/config.mjs";
import { createHub } from "../server/hub.mjs";
import { simulationOverrides, createSimulation } from "../server/sim/simulation.mjs";

const TERMINAL = ["completed", "failed", "blocked", "interrupted"];

/** One Codex run through the real run manager (gate, backup, adapter) against the fake app-server. */
async function codexRun(t, { model = "", access = "read-only" } = {}) {
  const { hub } = t;
  await enableLive(hub, { provider: "codex", access });
  const project = hub.projects.hub();
  const conversation = hub.bus.transaction(() => hub.conversations.create({ projectId: project.id, title: "Review fixes" }, "user"));
  hub.bus.transaction(() => hub.conversations.addMessage({ conversationId: conversation.id, role: "user", content: "Summarise the README." }, "user"));
  const { run } = await hub.runs.start({ conversationId: conversation.id, provider: "codex", access, model });
  return waitFor(() => { const r = hub.runs.getRun(run.id); return TERMINAL.includes(r.status) ? r : null; }, 20000);
}

const methods = (t, name) => t.readLog("codex").filter((e) => e.method === name);

test("M03-RF-01 Codex model check is exact: the requested id passes (case/space-normalised), a same-family variant stops before the turn", async () => {
  const exact = await makeTestHub();
  try {
    const run = await codexRun(exact, { model: "gpt-fake-sol" });
    assert.equal(run.status, "completed");
    assert.equal(methods(exact, "thread/start")[0].params.model, "gpt-fake-sol");
    assert.equal(methods(exact, "turn/start").length, 1);
  } finally { await exact.cleanup(); }

  // Codex echoing the same id in another case with surrounding spaces is the same model, not a swap.
  const echoed = await makeTestHub({ codex: "model-case" });
  try {
    const run = await codexRun(echoed, { model: "gpt-fake-sol" });
    assert.equal(run.status, "completed", run.errorMessage || "");
    assert.equal(methods(echoed, "turn/start").length, 1);
  } finally { await echoed.cleanup(); }

  // Regression: a prefix match accepted "gpt-5-mini" for a requested "gpt-5" (a silent downgrade the Hub must stop).
  const variant = await makeTestHub({ codex: "model-variant" });
  try {
    const run = await codexRun(variant, { model: "gpt-5" });
    assert.equal(run.status, "blocked", "a pre-turn policy stop is recorded as blocked");
    assert.equal(run.errorCategory, "policy");
    assert.equal(run.preInference, true);
    assert.match(run.errorMessage, /gpt-5-mini în loc de gpt-5/);
    assert.equal(methods(variant, "thread/start").length, 1, "the thread was opened, so the stop is the pre-turn check (not the gate)");
    assert.equal(methods(variant, "turn/start").length, 0, "no turn was started");
  } finally { await variant.cleanup(); }

  // No model requested. M02 left the choice to Codex's config default and skipped the check; M03 §09/T06 REPLACED that rule:
  // the Hub now sends the account default from model/list explicitly, so a variant reported for it stops before the turn too.
  const unrequested = await makeTestHub({ codex: "model-variant" });
  try {
    const run = await codexRun(unrequested);
    assert.equal(run.status, "blocked", "the default model is explicit now, so a substitute is caught");
    assert.match(run.errorMessage, /gpt-fake-sol-mini în loc de gpt-fake-sol/);
    assert.equal(methods(unrequested, "thread/start")[0].params.model, "gpt-fake-sol", "the account default from model/list was sent");
    assert.equal(run.plan.modelSource, "account_default_pinned", "M09: the default is pinned as an explicit, requested id");
    assert.equal(run.plan.requestedModel, "gpt-fake-sol");
    assert.equal(methods(unrequested, "turn/start").length, 0);
  } finally { await unrequested.cleanup(); }
});

test("M03-RF-02 Codex: a read-only run whose thread reports workspaceWrite stops before turn/start; a workspace-write run with the same thread proceeds", async () => {
  const t = await makeTestHub({ codex: "sandbox-write" });
  try {
    const run = await codexRun(t);
    assert.equal(run.status, "blocked");
    assert.equal(run.errorCategory, "policy");
    assert.equal(run.preInference, true);
    assert.match(run.errorMessage, /sandbox workspaceWrite pentru acces read-only/);
    assert.equal(methods(t, "thread/start").length, 1, "the gate admitted the run; the thread projection stopped it");
    assert.equal(methods(t, "turn/start").length, 0, "no turn was started");
    const launch = t.readLog("codex").filter((e) => Array.isArray(e.launchArgs)).at(-1).launchArgs;
    assert.ok(launch.includes('default_permissions="ifrim_hub_ro"'), "the run process carried the read-only Hub profile");
  } finally { await t.cleanup(); }

  // The stop is scoped to access: workspaceWrite is the expected projection of a workspace-write grant.
  const write = await makeTestHub({ codex: "sandbox-write" });
  try {
    const run = await codexRun(write, { access: "workspace-write" });
    assert.equal(run.status, "completed", run.errorMessage || "");
    assert.equal(methods(write, "turn/start").length, 1);
  } finally { await write.cleanup(); }
});

/** A simulator Hub built from the real simulationOverrides (scenario file, fixture binaries, demo project), no HTTP listener. */
async function makeSimHub() {
  const dataDir = tempDir("sim");
  const overrides = simulationOverrides({ HUB_V2_DATA_DIR: dataDir, HUB_V2_PORT: String(18900 + Math.floor(Math.random() * 90)) });
  makeProject(overrides.hubRoot);
  const homeDir = path.join(dataDir, "home");
  fs.mkdirSync(path.join(homeDir, ".codex"), { recursive: true });
  fs.mkdirSync(path.join(homeDir, ".claude"), { recursive: true });
  const config = loadConfig(overrides);
  const hub = createHub(config, { homeDir });
  await hub.boot();
  const sim = createSimulation(hub);
  const codexLog = () => {
    const file = path.join(dataDir, "codex.log");
    return fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  };
  const cleanup = async () => {
    await hub.close();
    try { fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* Windows may hold a file briefly; left in .ifrim/tmp */ }
  };
  return { hub, sim, dataDir, codexLog, cleanup };
}

test("M03-RF-03 simulator: the 'error' action (banner 'Eroare auth') ends in an authentication failure, not a quota one", async () => {
  const s = await makeSimHub();
  try {
    assert.equal(s.hub.config.simulation, true);
    await enableLive(s.hub, { provider: "codex" });
    const result = await s.sim.action("error");
    assert.ok(result.runId, "the action started a run");
    const run = s.hub.runs.getRun(result.runId);
    assert.equal(run.provider, "codex");
    assert.equal(run.errorCategory, "authentication");
    assert.notEqual(run.errorCategory, "quota");
    assert.equal(run.status, "blocked", "an authentication failure is pre-inference in the Hub taxonomy");
    assert.equal(result.status, run.status);
    assert.match(run.errorMessage, /401 Unauthorized/);
    assert.equal(s.codexLog().filter((e) => e.method === "turn/start").length, 1, "the fixture refused the turn itself, like an expired ChatGPT session");
    assert.equal(fs.readFileSync(path.join(s.dataDir, "codex.scenario"), "utf8"), "ok", "the scenario file is reset after the action");
  } finally { await s.cleanup(); }
});

test("M03-RF-10 a grant past its expiry is listed and judged as expired, never as active", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    await enableLive(hub, { provider: "codex" });
    const project = hub.projects.hub();
    const grant = hub.bus.transaction(() => hub.grants.create({ provider: "codex", projectId: project.id, access: "read-only", maxAttempts: 1, maxDurationS: 600, ttlMinutes: 30 }, "test"));
    hub.db.prepare("UPDATE live_grants SET expires_at = ? WHERE id = ?").run(new Date(Date.now() - 60000).toISOString(), grant.id);
    assert.equal(hub.grants.get(grant.id).status, "expired");
    assert.equal(hub.grants.list().find((g) => g.id === grant.id).status, "expired");
    assert.equal(hub.grants.problem(hub.grants.get(grant.id), { provider: "codex", projectId: project.id, access: "read-only", now: new Date() }), "Grantul a expirat");
  } finally { await t.cleanup(); }
});
