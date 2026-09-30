import test from "node:test";
import assert from "node:assert/strict";
import { makeTestHub, enableLive, waitFor } from "./helpers.mjs";
import { evaluateRoute, ATTESTATION_TEXT } from "../server/policy/billing.mjs";
import { CLAUDE_REFUSED_MODELS, CLAUDE_FORBIDDEN_FLAGS, CLAUDE_GUARD_ENV, CLAUDE_DENIED_READS, refusedModelReason } from "../server/providers/claude.mjs";
import { CODEX_APP_SERVER_OVERRIDES, inspectCodexConfig } from "../server/providers/codex.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const NOW = new Date("2026-09-30T08:00:00Z");
const att = { codex: { confirmedAt: NOW.toISOString() }, claude: { confirmedAt: NOW.toISOString() } };
const codexInspection = (planType, creditsReported = null) => ({ installed: true, binary: "codex.exe", version: "0.158", config: {}, auth: { accountType: "chatgpt", planType },
  usage: { windows: [{ name: "primary", usedPercent: 10 }], creditsReported } });

async function claudeTurn(t, { model = "", scenario = null } = {}) {
  const { hub } = t;
  await enableLive(hub, { provider: "claude" });
  const project = hub.projects.hub();
  const conversation = hub.bus.transaction(() => hub.conversations.create({ projectId: project.id, title: "Billing hardening" }, "user"));
  hub.bus.transaction(() => hub.conversations.addMessage({ conversationId: conversation.id, role: "user", content: "Read the README and summarise it." }, "user"));
  const { run } = await hub.runs.start({ conversationId: conversation.id, provider: "claude", model });
  const finished = await waitFor(() => { const r = hub.runs.getRun(run.id); return ["completed", "failed", "blocked", "interrupted"].includes(r.status) ? r : null; }, 20000);
  return { run: finished, scenario };
}

test("M01-BH-01 Claude: Fable/best and [1m] models are refused before any process starts", async () => {
  for (const model of ["fable", "best", "claude-fable-5-1", "Claude-Fable-5", "sonnet[1m]", "claude-sonnet-4-6[1m]", "opus[1M]"]) assert.ok(CLAUDE_REFUSED_MODELS.test(model), model);
  // Regression: "[1m]" must be a literal suffix, not a character class that refuses every id containing "1" or "m".
  for (const model of ["opus", "sonnet", "haiku", "opusplan", "claude-opus-5-5", "claude-sonnet-5-5", "claude-sonnet-4-1", "claude-haiku-4-5-20251001", "claude-opus-4-1-m"]) assert.ok(!CLAUDE_REFUSED_MODELS.test(model), model);
  assert.match(refusedModelReason("sonnet[1m]"), /1M/);
  assert.match(refusedModelReason("fable"), /Fable/);
  const t = await makeTestHub();
  try {
    const { run } = await claudeTurn(t, { model: "fable" });
    assert.equal(run.status, "blocked", "a pre-inference refusal is recorded as blocked");
    assert.equal(run.errorCategory, "billing");
    assert.equal(run.preInference, true);
    assert.match(run.errorMessage, /Fable/);
    assert.equal(t.readLog("claude").filter((e) => Array.isArray(e.args) && e.args.includes("-p")).length, 0, "no claude -p process was started");
  } finally { await t.cleanup(); }
});

test("M01-BH-02 Claude: an init event reporting an API key source stops the run before the model", async () => {
  const t = await makeTestHub({ claude: "init-apikey" });
  try {
    const { run } = await claudeTurn(t);
    assert.equal(run.errorCategory, "billing");
    assert.equal(run.preInference, true);
    assert.match(run.errorMessage, /apiKeySource=ANTHROPIC_API_KEY/);
    const message = t.hub.db.prepare("SELECT content FROM messages WHERE id = ?").get(run.outputMessageId).content;
    assert.doesNotMatch(message, /Claude simulated answer/, "no model output is kept");
  } finally { await t.cleanup(); }
});

test("M01-BH-03 Claude: an init event that resolved to a Fable model stops the run", async () => {
  const t = await makeTestHub({ claude: "init-fable" });
  try {
    const { run } = await claudeTurn(t);
    assert.equal(run.errorCategory, "billing");
    assert.match(run.errorMessage, /Fable/);
  } finally { await t.cleanup(); }
});

test("M01-BH-04 Claude: -p uses only user settings, disables the advisor tool and never passes forbidden flags", async () => {
  const t = await makeTestHub();
  try {
    t.config.providerBinaries.claude.prefixArgs.push("--fake-log-env");
    const { run } = await claudeTurn(t);
    assert.equal(run.status, "completed");
    const turn = t.readLog("claude").find((e) => Array.isArray(e.args) && e.args.includes("-p"));
    const i = turn.args.indexOf("--setting-sources");
    assert.ok(i >= 0 && turn.args[i + 1] === "user", "repository settings (env/apiKeyHelper) are not loaded in -p");
    for (const flag of CLAUDE_FORBIDDEN_FLAGS) assert.ok(!turn.args.includes(flag), flag);
    const envLine = t.readLog("claude").find((e) => Array.isArray(e.envNames) && /-p/.test(e.invocation || ""));
    assert.ok(envLine, "the fake logged the environment variable names of the turn");
    assert.ok(turn.args.includes("--no-chrome"), "Claude in Chrome is never enabled from a Hub run");
    const d = turn.args.indexOf("--disallowedTools");
    assert.ok(d > 0, "the project's read denials are passed explicitly (project settings are not loaded)");
    for (const rule of ["Read(./.ifrim/private/**)", "Read(./.ifrim/BACKUPS/**)", "Read(./.env)"]) assert.ok(CLAUDE_DENIED_READS.includes(rule) && turn.args.slice(d + 1, d + 1 + CLAUDE_DENIED_READS.length).includes(rule), rule);    for (const guard of ["CLAUDE_CODE_DISABLE_ADVISOR_TOOL", "CLAUDE_CODE_DISABLE_FAST_MODE", "CLAUDE_CODE_DISABLE_1M_CONTEXT", "CLAUDE_CODE_DISABLE_WORKFLOWS", "DISABLE_AUTOUPDATER", "DISABLE_EXTRA_USAGE_COMMAND", "DISABLE_UPGRADE_COMMAND", "DISABLE_LOGIN_COMMAND", "DISABLE_LOGOUT_COMMAND", "CLAUDE_CODE_DISABLE_AUTO_MEMORY", "CLAUDE_CODE_DISABLE_BACKGROUND_TASKS", "CLAUDE_CODE_DISABLE_CRON"]) {
      assert.equal(CLAUDE_GUARD_ENV[guard], "1", guard);
      assert.ok(envLine.envNames.includes(guard), `${guard} reaches the -p process`);
    }
    for (const risky of ["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "OPENAI_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"]) assert.ok(!envLine.envNames.includes(risky), risky);
  } finally { await t.cleanup(); }
});

test("M01-BH-05 BillingPolicy: Codex plan types from the audit (prolite, promax included; credit-based refused)", () => {
  const plan = (planType) => evaluateRoute("codex", codexInspection(planType), { attestations: att, now: NOW }).checks.find((c) => c.id === "plan");
  assert.equal(plan("prolite").status, "verified");
  assert.equal(plan("promax").status, "verified");
  assert.equal(plan("enterprise_cbp_automation").status, "failed");
  assert.equal(plan("self_serve_business_usage_based").status, "failed");
  assert.equal(plan("brand_new_tier").status, "unverified");
});

test("M01-BH-06 BillingPolicy: a positive or unlimited credit balance blocks Codex (no toggle prevents consumption)", () => {
  // Same call shape as the execution gate: the usage snapshot is passed separately.
  const route = (credits) => { const inspection = codexInspection("prolite", credits); return evaluateRoute("codex", inspection, { attestations: att, now: NOW, usage: inspection.usage }); };
  assert.equal(route({ hasCredits: false, unlimited: false, balance: 0 }).allowed, true);
  assert.equal(route(null).allowed, true, "no credit report: the allowance/reserve checks still apply");
  const positive = route({ hasCredits: true, unlimited: false, balance: 12.5 });
  assert.equal(positive.allowed, false);
  assert.match(positive.blockingReasons.join(" "), /credits: Sold de credite 12.5/);
  assert.equal(route({ hasCredits: true, unlimited: true, balance: null }).allowed, false);
  const unknownBalance = route({ hasCredits: true, unlimited: false, balance: null });
  assert.equal(unknownBalance.checks.find((c) => c.id === "credits").status, "unverified");
  assert.equal(unknownBalance.allowed, true, "an unknown balance is shown, the reserve ceiling still stops turns");
});

test("M01-BH-08 Codex: every Hub app-server disables fast mode, image generation, skill installs, apps, computer/browser use, memories, subagents and web search per process", async () => {
  const REQUIRED = ["features.fast_mode=false", "features.image_generation=false", "features.skill_mcp_dependency_install=false", "features.apps=false",
    "features.computer_use=false", "features.browser_use=false", "features.browser_use_external=false", "features.browser_use_full_cdp_access=false",
    "features.in_app_browser=false", "features.memories=false", "features.multi_agent=false", "features.plugins=false", "features.remote_plugin=false", 'web_search="disabled"',
    // M02 live finding: no sandboxed AGENTS.md discovery at thread/start (it exceeded the 120 s thread/start budget).
    "project_doc_max_bytes=0", "project_root_markers=[]"];
  assert.equal(CODEX_APP_SERVER_OVERRIDES.length, REQUIRED.length * 2);
  REQUIRED.forEach((value, i) => { assert.equal(CODEX_APP_SERVER_OVERRIDES[2 * i], "-c"); assert.equal(CODEX_APP_SERVER_OVERRIDES[2 * i + 1], value); });
  const t = await makeTestHub();
  try {
    const { hub } = t;
    await enableLive(hub, { provider: "codex" });
    const project = hub.projects.hub();
    const conversation = hub.bus.transaction(() => hub.conversations.create({ projectId: project.id, title: "Fast mode" }, "user"));
    hub.bus.transaction(() => hub.conversations.addMessage({ conversationId: conversation.id, role: "user", content: "Summarise the README." }, "user"));
    const { run } = await hub.runs.start({ conversationId: conversation.id, provider: "codex" });
    const finished = await waitFor(() => { const r = hub.runs.getRun(run.id); return ["completed", "failed", "blocked", "interrupted"].includes(r.status) ? r : null; }, 20000);
    assert.equal(finished.status, "completed");
    const launches = t.readLog("codex").filter((e) => Array.isArray(e.launchArgs));
    assert.ok(launches.length >= 1, "the fake logged its launch arguments");
    for (const { launchArgs } of launches) {
      for (const override of REQUIRED) {
        const i = launchArgs.indexOf(override);
        assert.ok(i > 0 && launchArgs[i - 1] === "-c" && i < launchArgs.indexOf("app-server"), `${override}: ${launchArgs.join(" ")}`);
      }
    }
  } finally { await t.cleanup(); }
});

test("M01-BH-09 Codex config inspection reports a persisted Fast tier (informative, overridden per process)", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "hub-codex-cfg-"));
  try {
    fs.mkdirSync(path.join(home, ".codex"));
    fs.writeFileSync(path.join(home, ".codex", "config.toml"), 'service_tier = "fast"\n[features]\nfast_mode = true\n');
    assert.equal(inspectCodexConfig(home).fastTierPersisted, true);
    fs.writeFileSync(path.join(home, ".codex", "config.toml"), 'model = "gpt-6-luna"\n');
    assert.equal(inspectCodexConfig(home).fastTierPersisted, false);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test("M01-BH-07 attestations describe the real provider controls; usage.admit refuses a positive credit balance", async () => {
  assert.match(ATTESTATION_TEXT.codex, /soldul de credite este 0/);
  assert.match(ATTESTATION_TEXT.codex, /automatic reload/);
  assert.match(ATTESTATION_TEXT.claude, /usage credits/);
  const t = await makeTestHub();
  try {
    const verdict = t.hub.usage.admit("codex", { windows: [{ name: "primary", usedPercent: 5 }], creditsReported: { hasCredits: true, unlimited: false, balance: 3 } });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /purchased credits/);
    assert.equal(t.hub.usage.admit("codex", { windows: [{ name: "primary", usedPercent: 5 }], creditsReported: { hasCredits: false, balance: 0 } }).ok, true);
  } finally { await t.cleanup(); }
});

async function codexTurn(t, { model = "" } = {}) {
  const { hub } = t;
  await enableLive(hub, { provider: "codex" });
  const project = hub.projects.hub();
  const conversation = hub.bus.transaction(() => hub.conversations.create({ projectId: project.id, title: "Codex guard" }, "user"));
  hub.bus.transaction(() => hub.conversations.addMessage({ conversationId: conversation.id, role: "user", content: "Summarise the README." }, "user"));
  const { run } = await hub.runs.start({ conversationId: conversation.id, provider: "codex", model });
  return waitFor(() => { const r = hub.runs.getRun(run.id); return ["completed", "failed", "blocked", "interrupted"].includes(r.status) ? r : null; }, 20000);
}

test("M01-BH-10 Codex: approvals are pinned to the Hub (approvalsReviewer user); an auto_review reviewer stops the run before the turn", async () => {
  const ok = await makeTestHub();
  try {
    const run = await codexTurn(ok);
    assert.equal(run.status, "completed");
    const requests = ok.readLog("codex").filter((e) => e.method === "thread/start" || e.method === "turn/start");
    assert.ok(requests.length >= 2);
    for (const r of requests) assert.equal(r.params.approvalsReviewer, "user", r.method);
  } finally { await ok.cleanup(); }
  const t = await makeTestHub({ codex: "auto-reviewer" });
  try {
    const run = await codexTurn(t);
    assert.equal(run.errorCategory, "policy");
    assert.equal(run.preInference, true);
    assert.match(run.errorMessage, /approvalsReviewer=auto_review/);
    assert.equal(t.readLog("codex").filter((e) => e.method === "turn/start").length, 0, "no turn was started");
  } finally { await t.cleanup(); }
});

test("M01-BH-11 Codex: a silently substituted model stops the run before the turn", async () => {
  const t = await makeTestHub({ codex: "model-swap" });
  try {
    const run = await codexTurn(t, { model: "gpt-fake-sol" });
    assert.equal(run.errorCategory, "policy");
    assert.equal(run.preInference, true);
    assert.match(run.errorMessage, /gpt-fake-legacy în loc de gpt-fake-sol/);
    assert.equal(t.readLog("codex").filter((e) => e.method === "turn/start").length, 0);
  } finally { await t.cleanup(); }
});
