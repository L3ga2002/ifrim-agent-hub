// 2.20 — the owner's optional API-key route (PASS_SIMULATED / pure): off by default; a key saved encrypted in the instance's
// vault (test protector here, DPAPI in a real Hub), the exact consent in the owner session, a budget; every run admitted against
// the budget, its cost measured and booked, a run stopped at its limit; the key never in a log, an event, an answer or an argv.
// Fixture providers only; no model, no network, no live Hub.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeTestHub, enableLive, enrolOwner, waitFor } from "./helpers.mjs";
import { evaluateRoute, buildApiChildEnv, buildChildEnv } from "../server/policy/billing.mjs";
import { API_CONSENT_TEXT, normalizeBudget, codexPriceFor, codexCostUsd, createApiAccess, MIN_RUN_USD } from "../server/policy/api-access.mjs";
import { validateKeyShape, keyFingerprint, apiKeyIdentity, createApiKeyVault, testProtector } from "../server/policy/api-keys.mjs";
import { claudeTurnArgs, resolveClaudeBinary, formatBudget } from "../server/providers/claude.mjs";

const OPENAI_KEY = "sk-proj-TESTKEY0000000000000000000000000000000000AbCd";
const ANTHROPIC_KEY = "sk-ant-api03-TESTKEY000000000000000000000000000000WxYz";
const dispatch = (hub, type, payload, ownerSession = null) => hub.commands.dispatch({ type, payload, actor: "test", channel: "test", ownerSession });
function conversation(hub, project, text = "verifică") {
  const conv = hub.conversations.create({ projectId: project.id, title: "m20-api" }, "test");
  hub.conversations.addMessage({ conversationId: conv.id, role: "user", content: text }, "test");
  return conv;
}
const settled = (hub, id, ms = 60000) => waitFor(() => { const r = hub.runs.getRun(id); return ["completed", "failed", "blocked", "interrupted"].includes(r.status) ? r : null; }, ms, 50);
const allText = (hub) => [
  ...hub.db.prepare("SELECT payload_json, result_json, error FROM commands").all().map((r) => `${r.payload_json} ${r.result_json} ${r.error || ""}`),
  ...hub.db.prepare("SELECT payload_json FROM events").all().map((r) => r.payload_json),
  ...hub.db.prepare("SELECT value_json FROM settings").all().map((r) => r.value_json),
  ...hub.db.prepare("SELECT COALESCE(error_message, '') || ' ' || COALESCE(evidence_json, '') || ' ' || COALESCE(usage_json, '') AS t FROM agent_runs").all().map((r) => r.t),
].join("\n");

/** Saves the key, gives the consent with a budget, and runs the account check (no model) for `provider`. */
async function enableApi(t, owner, provider, key, budget = { monthlyUsd: 10, dailyUsd: 3, perRunUsd: 1 }) {
  const session = owner.reauth();
  await dispatch(t.hub, "api_route.key.set", { provider, key }, session);
  await dispatch(t.hub, "api_route.enable", { provider, confirmText: API_CONSENT_TEXT[provider], ...budget }, session);
  await dispatch(t.hub, "provider.probe", { provider, withModels: provider === "codex" });
}

// ---------- pure ----------

test("M20-API-01 key shapes, fingerprints and the vault round trip (test protector); a real Hub refuses a test-only file", async () => {
  assert.equal(validateKeyShape("codex", OPENAI_KEY), null);
  assert.equal(validateKeyShape("claude", ANTHROPIC_KEY), null);
  assert.match(validateKeyShape("codex", ANTHROPIC_KEY), /Anthropic/);
  assert.match(validateKeyShape("claude", OPENAI_KEY), /sk-ant-/);
  assert.match(validateKeyShape("codex", "sk- with space"), /spații/);
  const salt = "0123456789abcdef0123456789abcdef";
  const fp = keyFingerprint(salt, "codex", OPENAI_KEY);
  assert.match(fp, /^[0-9a-f]{16}$/);
  assert.notEqual(fp, keyFingerprint(salt, "claude", OPENAI_KEY), "bound to the provider");
  assert.notEqual(fp, keyFingerprint("fedcba9876543210fedcba9876543210", "codex", OPENAI_KEY), "bound to the instance salt");
  assert.deepEqual(apiKeyIdentity(fp), { scheme: "api-key-hmac:v1", value: fp, basis: "api_key", plan: "api" });

  const t = await makeTestHub();
  try {
    const dir = path.join(t.dataDir, "vault-test");
    const vault = createApiKeyVault({ config: { ...t.config, dataDir: dir }, salt: () => salt, protector: testProtector() });
    assert.deepEqual(vault.status("codex"), { present: false });
    const saved = await vault.set("codex", OPENAI_KEY);
    assert.equal(saved.last4, "AbCd");
    const file = fs.readFileSync(path.join(dir, "v2-api-keys", "codex.json"), "utf8");
    assert.equal(file.includes(OPENAI_KEY), false, "the file never holds the clear key");
    assert.equal(file.includes("TESTKEY"), false);
    assert.equal((await vault.reveal("codex")).key, OPENAI_KEY);
    // A real Hub (DPAPI protector) never reads a test-only file.
    const real = createApiKeyVault({ config: { ...t.config, dataDir: dir, testMode: false }, salt: () => salt, protector: { scheme: "dpapi-currentuser", protect: async () => "x", unprotect: async () => { throw new Error("never"); } } });
    assert.match(real.status("codex").problem, /altă protecție/);
    await assert.rejects(real.reveal("codex"), /nu poate fi folosită/);
    // Another instance (other salt) cannot use the file either.
    const other = createApiKeyVault({ config: { ...t.config, dataDir: dir }, salt: () => "fedcba9876543210fedcba9876543210", protector: testProtector() });
    await assert.rejects(other.reveal("codex"), /Amprenta/);
    assert.equal(vault.remove("codex"), true);
    assert.deepEqual(vault.status("codex"), { present: false });
  } finally { await t.cleanup(); }
});

test("M20-API-02 budgets, prices and the API route evaluation; the subscription route is unchanged when the API route is off", () => {
  assert.deepEqual(normalizeBudget({}), { monthlyUsd: 20, dailyUsd: 5, perRunUsd: 2 });
  assert.throws(() => normalizeBudget({ monthlyUsd: 5, dailyUsd: 10, perRunUsd: 1 }), /zilnic/);
  assert.throws(() => normalizeBudget({ monthlyUsd: 5000 }), /monthlyUsd/);
  assert.throws(() => normalizeBudget({ monthlyUsd: 10, dailyUsd: 2, perRunUsd: 3 }), /pe rulare/);
  assert.equal(codexPriceFor("gpt-5.5-pro").refused, true);
  assert.equal(codexPriceFor("gpt-5-codex").exact, true);
  const fallback = codexPriceFor("gpt-unknown-9");
  assert.equal(fallback.exact, false);
  assert.ok(fallback.output >= 30, "the fallback over-estimates");
  // 1M uncached input + 1M output at 1.25/10 = 11.25 USD; cached input at a tenth.
  assert.equal(codexCostUsd({ inputTokens: 1e6, outputTokens: 1e6 }, codexPriceFor("gpt-5-codex")), 11.25);
  assert.equal(Math.round(codexCostUsd({ inputTokens: 1e6, cachedInputTokens: 1e6, outputTokens: 0 }, codexPriceFor("gpt-5-codex")) * 1000) / 1000, 0.125);
  assert.equal(formatBudget(1.239), "1.23", "never rounded up");
  assert.throws(() => formatBudget(0), /pozitiv/);
  assert.deepEqual(claudeTurnArgs({ deniedReads: [], newSession: true, sessionId: "s", maxBudgetUsd: 0.5 }).slice(-2), ["--max-budget-usd", "0.50"]);
  assert.equal(claudeTurnArgs({ deniedReads: [], newSession: true, sessionId: "s" }).includes("--max-budget-usd"), false, "never on the subscription route");

  const fp = "0123456789abcdef";
  const api = { mode: "api_key", key: { fingerprint: fp, last4: "AbCd" }, identity: apiKeyIdentity(fp), consent: true, budget: { ok: true, detail: "ok" } };
  const codexOk = { installed: true, auth: { accountType: "apiKey", accountIdentity: apiKeyIdentity(fp) }, config: { present: true } };
  const r = evaluateRoute("codex", codexOk, { api });
  assert.equal(r.allowed, true, r.blockingReasons.join(" "));
  assert.equal(r.policy.mode, "owner_api_key_with_budget");
  assert.equal(evaluateRoute("codex", codexOk, { api, environment: "wsl-runner" }).allowed, false, "no API route inside an execution environment");
  assert.equal(evaluateRoute("codex", { ...codexOk, auth: { accountType: "chatgpt" } }, { api }).allowed, false);
  assert.equal(evaluateRoute("codex", { ...codexOk, auth: { accountType: "apiKey", accountIdentity: apiKeyIdentity("ffffffffffffffff") } }, { api }).allowed, false, "another key");
  assert.equal(evaluateRoute("codex", codexOk, { api: { ...api, consent: false } }).allowed, false);
  assert.equal(evaluateRoute("codex", codexOk, { api: { ...api, budget: { ok: false, detail: "Plafonul zilnic este atins" } } }).allowed, false);
  assert.equal(evaluateRoute("codex", { ...codexOk, config: { customProvider: "x" } }, { api }).allowed, false);
  const claudeOk = { installed: true, auth: { loggedIn: true, authMethod: "api_key", apiProvider: "firstParty", apiKeySource: "ANTHROPIC_API_KEY", accountIdentity: apiKeyIdentity(fp) }, config: { apiKeyHelper: false, riskyEnvInSettings: [] } };
  assert.equal(evaluateRoute("claude", claudeOk, { api }).allowed, true);
  assert.equal(evaluateRoute("claude", { ...claudeOk, config: { apiKeyHelper: true } }, { api }).allowed, false);
  // Without the API route, an API-key login stays refused exactly as before.
  assert.equal(evaluateRoute("codex", codexOk, {}).allowed, false);
  assert.match(evaluateRoute("codex", codexOk, {}).blockingReasons.join(" "), /API key/);

  // The only credential a child may receive is Claude's ANTHROPIC_API_KEY, only through buildApiChildEnv.
  assert.throws(() => buildChildEnv({ ANTHROPIC_API_KEY: "x" }), /billing-risk/);
  assert.equal(buildApiChildEnv("claude", ANTHROPIC_KEY, {}, { PATH: "p", OPENAI_API_KEY: "leak" }).ANTHROPIC_API_KEY, ANTHROPIC_KEY);
  assert.equal(buildApiChildEnv("claude", ANTHROPIC_KEY, {}, { PATH: "p", OPENAI_API_KEY: "leak" }).OPENAI_API_KEY, undefined);
  assert.throws(() => buildApiChildEnv("codex", OPENAI_KEY), /nu primește cheia prin mediu/);
});

test("M20-API-03 reservations: concurrent runs share the budget; no report books the whole reservation; boot books what a dead process left", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    const vault = { status: () => ({ present: true, valid: true, fingerprint: "0123456789abcdef", last4: "AbCd" }), reveal: async () => ({ key: OPENAI_KEY, fingerprint: "0123456789abcdef" }) };
    const access = createApiAccess({ settings: hub.settings, vault, bus: hub.bus, clock: () => new Date("2026-11-23T12:00:00Z") });
    assert.equal(access.mode("codex"), "subscription", "off by default");
    access.setRoute("codex", { enabled: true, consent: { textVersion: (await import("../server/policy/api-access.mjs")).textVersion(API_CONSENT_TEXT.codex), at: "2026-11-23T11:00:00Z" }, budget: { monthlyUsd: 10, dailyUsd: 2, perRunUsd: 1.5 } }, "test", "t");
    assert.equal(access.mode("codex"), "api_key");
    const a = await access.admit("codex", "run_a");
    assert.equal(a.maxUsd, 1.5);
    const b = await access.admit("codex", "run_b");
    assert.equal(b.maxUsd, 0.5, "the second run gets only what the first one's reservation leaves for the day");
    await assert.rejects(access.admit("codex", "run_c"), /zilnic/);
    access.settle("run_a", { usd: 0.4, model: "gpt-5-codex" });
    assert.equal(access.release("run_b"), true);
    assert.equal(access.budgetState("codex").spent.today, 0.4);
    const c = await access.admit("codex", "run_c");
    const booked = access.settle("run_c", { usd: null });
    assert.equal(booked.usd, c.maxUsd);
    assert.equal(booked.estimated, true);
    // A process that dies with a reservation: the next one books it at its maximum.
    await access.admit("codex", "run_d");
    const reborn = createApiAccess({ settings: hub.settings, vault, bus: hub.bus, clock: () => new Date("2026-11-23T12:05:00Z") });
    const recovered = reborn.recoverPending();
    assert.equal(recovered.length, 1);
    assert.equal(recovered[0].runId, "run_d");
    assert.equal(recovered[0].estimated, true);
    assert.deepEqual(hub.settings.get("apiSpend").pending, []);
    assert.ok(reborn.budgetState("codex").spent.today > 0.4 + c.maxUsd - 0.0001);
    assert.ok(MIN_RUN_USD > 0);
  } finally { await t.cleanup(); }
});

// ---------- through the Hub (fixture providers) ----------

test("M20-API-04 Codex on the API route: owner-only key and consent, in-memory login, cost booked; the key is nowhere in the Hub's records", async () => {
  const t = await makeTestHub({ queues: true });
  try {
    const { hub } = t;
    const { project, grant } = await enableLive(hub, { provider: "codex", attempts: 5 });
    // The key can be saved only in the owner session.
    await assert.rejects(dispatch(hub, "api_route.key.set", { provider: "codex", key: OPENAI_KEY }), /sesiun|session/i);
    const owner = await enrolOwner(t);
    await assert.rejects(dispatch(hub, "api_route.enable", { provider: "codex", confirmText: API_CONSENT_TEXT.codex }, owner.reauth()), /Salvează întâi cheia/);
    await dispatch(hub, "api_route.key.set", { provider: "codex", key: OPENAI_KEY }, owner.reauth());
    await assert.rejects(dispatch(hub, "api_route.enable", { provider: "codex", confirmText: "accept" }, owner.reauth()), /nu corespunde/);
    // Enabled but not yet checked: the gate refuses (the probe still names the ChatGPT account).
    await dispatch(hub, "api_route.enable", { provider: "codex", confirmText: API_CONSENT_TEXT.codex, monthlyUsd: 10, dailyUsd: 3, perRunUsd: 1 }, owner.reauth());
    const before = hub.gate.evaluate({ provider: "codex", projectId: project.id, access: "read-only", grantId: grant.id });
    assert.equal(before.checks.find((c) => c.id === "billing_route").ok, false);
    await dispatch(hub, "provider.probe", { provider: "codex", withModels: true });
    assert.equal(hub.providerState.get("codex").auth.accountType, "apiKey");
    const gate = hub.gate.evaluate({ provider: "codex", projectId: project.id, access: "read-only", grantId: grant.id });
    const billing = gate.checks.find((c) => c.id === "billing_route");
    assert.equal(billing.ok, true, billing.detail);
    assert.match(billing.detail, /Ruta API cu cheia ta/);

    t.queue("codex", "ok");
    const { run } = await hub.runs.start({ conversationId: conversation(hub, project).id, provider: "codex", access: "read-only", grantId: grant.id, model: "gpt-5", actor: "test" });
    const done = await settled(hub, run.id);
    assert.equal(done.status, "completed", done.errorMessage);
    const log = t.readLog("codex");
    const launch = log.filter((e) => e.launchArgs).at(-1).launchArgs;
    assert.ok(launch.includes('cli_auth_credentials_store="ephemeral"'), "the API process keeps its credential in memory only");
    assert.equal(launch.some((a) => a.includes("TESTKEY")), false, "never in argv");
    assert.equal(log.filter((e) => e.method === "account/login/start").at(-1).params.apiKey, OPENAI_KEY, "the key reached the provider through stdin");
    const spend = hub.settings.get("apiSpend");
    assert.equal(spend.runs.at(-1).runId, run.id);
    assert.ok(spend.runs.at(-1).usd > 0);
    assert.deepEqual(spend.pending, []);
    // Nothing the Hub records holds the key.
    assert.equal(allText(hub).includes(OPENAI_KEY), false);
    assert.equal(allText(hub).includes("TESTKEY0000"), false);
    const summary = hub.apiAccess.summary().providers.codex;
    assert.equal(summary.key.last4, "AbCd");
    assert.equal(JSON.stringify(summary).includes("TESTKEY"), false);

    // Disabling (fail-safe, any owner channel) returns Codex to the subscription rules: an API-key login is refused again.
    await dispatch(hub, "api_route.disable", { provider: "codex", reason: "test" });
    assert.equal(hub.apiAccess.mode("codex"), "subscription");
    const after = hub.gate.evaluate({ provider: "codex", projectId: project.id, access: "read-only", grantId: grant.id });
    assert.equal(after.checks.find((c) => c.id === "billing_route").ok, false);
  } finally { await t.cleanup(); }
});

test("M20-API-05 Codex stops at the run's API budget (tokens × prices) and books the cost", async () => {
  const t = await makeTestHub({ queues: true });
  try {
    const { hub } = t;
    const { project, grant } = await enableLive(hub, { provider: "codex", attempts: 5 });
    const owner = await enrolOwner(t);
    await enableApi(t, owner, "codex", OPENAI_KEY, { monthlyUsd: 10, dailyUsd: 3, perRunUsd: 0.5 });
    t.queue("codex", "api-expensive");
    const { run } = await hub.runs.start({ conversationId: conversation(hub, project).id, provider: "codex", access: "read-only", grantId: grant.id, model: "gpt-5", actor: "test" });
    const done = await settled(hub, run.id);
    assert.equal(done.status, "failed");
    assert.equal(done.errorCategory, "quota");
    assert.match(done.errorMessage, /plafonul ei pe ruta API/);
    const booked = hub.settings.get("apiSpend").runs.at(-1);
    assert.equal(booked.runId, run.id);
    assert.ok(booked.usd >= 0.5, "the measured cost (over the limit) is booked, never less than the limit");
  } finally { await t.cleanup(); }
});

test("M20-API-06 Claude on the API route: key through the environment only, --max-budget-usd, the CLI's cost booked; no report books the reservation", async () => {
  const t = await makeTestHub({ queues: true });
  try {
    const { hub } = t;
    const { project, grant } = await enableLive(hub, { provider: "claude", attempts: 5 });
    const owner = await enrolOwner(t);
    await enableApi(t, owner, "claude", ANTHROPIC_KEY, { monthlyUsd: 10, dailyUsd: 3, perRunUsd: 0.75 });
    assert.equal(hub.providerState.get("claude").auth.authMethod, "api_key");
    t.queue("claude", "api-cost:0.12");
    const { run } = await hub.runs.start({ conversationId: conversation(hub, project).id, provider: "claude", access: "read-only", grantId: grant.id, model: "sonnet", actor: "test" });
    const done = await settled(hub, run.id);
    assert.equal(done.status, "completed", done.errorMessage);
    const turn = t.readLog("claude").filter((e) => Array.isArray(e.args) && e.args.includes("-p")).at(-1);
    assert.equal(turn.apiKeyLast4, "WxYz");
    const i = turn.args.indexOf("--max-budget-usd");
    assert.equal(turn.args[i + 1], "0.75");
    assert.equal(turn.args.some((a) => a.includes("TESTKEY")), false);
    assert.equal(hub.settings.get("apiSpend").runs.at(-1).usd, 0.12);

    t.queue("claude", "api-nocost");
    const { run: r2 } = await hub.runs.start({ conversationId: conversation(hub, project).id, provider: "claude", access: "read-only", grantId: grant.id, model: "sonnet", actor: "test" });
    await settled(hub, r2.id);
    const second = hub.settings.get("apiSpend").runs.at(-1);
    assert.equal(second.runId, r2.id);
    assert.equal(second.usd, 0.75);
    assert.equal(second.estimated, true);

    // A CLI that does not use the Hub's key stops before the model (nothing booked).
    t.queue("claude", "api-source-none");
    const { run: r3 } = await hub.runs.start({ conversationId: conversation(hub, project).id, provider: "claude", access: "read-only", grantId: grant.id, model: "sonnet", actor: "test" });
    const third = await settled(hub, r3.id);
    assert.equal(third.status, "blocked");
    assert.match(third.errorMessage, /nu cheia transmisă de Hub/);
    assert.equal(hub.settings.get("apiSpend").runs.at(-1).runId, r2.id, "a stop before the model books nothing");
    assert.equal(allText(hub).includes(ANTHROPIC_KEY), false);
  } finally { await t.cleanup(); }
});

test("M20-API-07 the native Claude Code install (~/.local/bin) is found when the npm package is absent", () => {
  const home = process.env.USERPROFILE;
  const native = path.join(home, ".local", "bin", process.platform === "win32" ? "claude.exe" : "claude");
  const resolved = resolveClaudeBinary({ providerBinaries: {}, testMode: false });
  if (!resolved) { assert.equal(fs.existsSync(native), false); return; }
  assert.ok(fs.existsSync(resolved.executable));
});
