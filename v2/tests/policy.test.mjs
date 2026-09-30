import test from "node:test";
import assert from "node:assert/strict";
import { evaluateRoute, buildChildEnv, scanEnvironment, BILLING_POLICY, ATTESTATION_TEXT } from "../server/policy/billing.mjs";
import { CODEX_ALLOWED_METHODS } from "../server/providers/codex.mjs";
import { CLAUDE_FORBIDDEN_FLAGS } from "../server/providers/claude.mjs";
import { makeTestHub } from "./helpers.mjs";

const now = new Date("2026-09-29T12:00:00Z");
const attested = { codex: { confirmedAt: "2026-09-29T10:00:00Z" }, claude: { confirmedAt: "2026-09-29T10:00:00Z" } };
const codexOk = { installed: true, auth: { accountType: "chatgpt", planType: "pro" }, config: { customProvider: null, apiKeyAuthPreferred: false } };

test("T07 BillingPolicy constants deny every paid path", () => {
  for (const [key, value] of Object.entries(BILLING_POLICY)) if (key !== "mode") assert.equal(value, "deny", key);
  assert.equal(BILLING_POLICY.mode, "included_subscription_only");
});

test("T07 Codex API-key account is refused as paid API billing", () => {
  const result = evaluateRoute("codex", { ...codexOk, auth: { accountType: "apiKey" } }, { attestations: attested, now });
  assert.equal(result.allowed, false);
  assert.match(result.blockingReasons.join(" "), /API key/);
});

test("T07 custom model_provider or API-key preference in config.toml is refused", () => {
  assert.equal(evaluateRoute("codex", { ...codexOk, config: { customProvider: "azure" } }, { attestations: attested, now }).allowed, false);
  assert.equal(evaluateRoute("codex", { ...codexOk, config: { apiKeyAuthPreferred: true } }, { attestations: attested, now }).allowed, false);
});

test("T07 usage-based plans are never treated as included", () => {
  const result = evaluateRoute("codex", { ...codexOk, auth: { accountType: "chatgpt", planType: "self_serve_business_usage_based" } }, { attestations: attested, now });
  assert.equal(result.allowed, false);
});

test("T07 Claude API key, apiKeyHelper or console auth are refused", () => {
  const base = { installed: true, auth: { loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty", subscriptionType: "max" }, config: { apiKeyHelper: false, riskyEnvInSettings: [] } };
  assert.equal(evaluateRoute("claude", base, { attestations: attested, now }).allowed, true);
  assert.equal(evaluateRoute("claude", { ...base, auth: { ...base.auth, authMethod: "api_key" } }, { attestations: attested, now }).allowed, false);
  assert.equal(evaluateRoute("claude", { ...base, config: { apiKeyHelper: true, riskyEnvInSettings: [] } }, { attestations: attested, now }).allowed, false);
  assert.equal(evaluateRoute("claude", { ...base, config: { apiKeyHelper: false, riskyEnvInSettings: ["ANTHROPIC_API_KEY"] } }, { attestations: attested, now }).allowed, false);
});

test("T07 unverifiable provider-side overage setting blocks until you record the manual check", () => {
  const result = evaluateRoute("codex", codexOk, { attestations: {}, now });
  assert.equal(result.allowed, false);
  assert.match(result.blockingReasons.join(" "), /provider_side_overage_setting/);
  const expired = evaluateRoute("codex", codexOk, { attestations: { codex: { confirmedAt: "2026-07-01T00:00:00Z" } }, now });
  assert.equal(expired.allowed, false);
  assert.ok(ATTESTATION_TEXT.codex.length > 20 && ATTESTATION_TEXT.claude.length > 20);
});

test("T07/T12 allowance at the reserve ceiling blocks instead of falling back", () => {
  const usage = { windows: [{ usedPercent: 85 }], ordinaryUsageAllowed: true };
  const result = evaluateRoute("codex", codexOk, { attestations: attested, now, usage, reservePercent: 20 });
  assert.equal(result.allowed, false);
  assert.match(result.blockingReasons.join(" "), /ceiling/);
});

test("T07 provider child environment never carries keys, tokens or proxies", () => {
  const env = { PATH: "C:\\bin", USERPROFILE: "C:\\Users\\x", OPENAI_API_KEY: "sk-test-1234567890abcdef", ANTHROPIC_API_KEY: "sk-ant-xxxxxxxxxxxxxxxx", HTTPS_PROXY: "http://proxy", NODE_OPTIONS: "--require x", RANDOM_SECRET: "1" };
  const child = buildChildEnv({}, env);
  assert.deepEqual(Object.keys(child).sort(), ["NO_UPDATE_NOTIFIER", "PATH", "USERPROFILE"].sort());
  assert.throws(() => buildChildEnv({ OPENAI_API_KEY: "x" }, env), /billing-risk/);
  const scan = scanEnvironment(env);
  assert.deepEqual(scan.riskyVariablesPresent.sort(), ["ANTHROPIC_API_KEY", "HTTPS_PROXY", "OPENAI_API_KEY"].sort());
  assert.ok(!JSON.stringify(scan).includes("sk-test"));
});

test("T07 Codex client cannot call credit, login, config-write or delete methods", () => {
  for (const method of ["account/rateLimitResetCredit/consume", "account/sendAddCreditsNudgeEmail", "account/login/start", "account/logout", "config/value/write", "config/batchWrite", "thread/delete", "plugin/install", "marketplace/add", "feedback/upload"]) {
    assert.equal(CODEX_ALLOWED_METHODS.has(method), false, method);
  }
  for (const flag of ["--bare", "--fallback-model", "--dangerously-skip-permissions"]) assert.ok(CLAUDE_FORBIDDEN_FLAGS.includes(flag));
});

test("T05/T06 fresh boot is BUILD_SAFE with a suspended gate; runs are refused before any provider starts", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    assert.equal(hub.settings.get("mode"), "BUILD_SAFE");
    assert.equal(hub.settings.get("executionGate").status, "suspended");
    const project = hub.projects.hub();
    const conv = hub.bus.transaction(() => hub.conversations.create({ projectId: project.id, title: "Gate" }));
    hub.bus.transaction(() => hub.conversations.addMessage({ conversationId: conv.id, role: "user", content: "hi" }));
    await assert.rejects(hub.runs.start({ conversationId: conv.id, provider: "codex" }), (error) => error.category === "gate");
    const run = hub.runs.listRuns({ conversationId: conv.id })[0];
    assert.equal(run.status, "blocked");
    assert.equal(run.preInference, true);
    assert.equal(t.readLog("codex").length, 0, "no provider process was contacted");
    assert.equal(hub.leases.list().length, 0);
  } finally { await t.cleanup(); }
});

test("T06 a restart resets LIVE_VALIDATION to BUILD_SAFE", async () => {
  const t = await makeTestHub();
  try {
    t.hub.bus.transaction(() => t.hub.settings.set("mode", "LIVE_VALIDATION", "test"));
    const { recoverOnBoot } = await import("../server/runtime/recovery.mjs");
    const report = await recoverOnBoot({ db: t.hub.db, bus: t.hub.bus, clock: () => new Date(), settings: t.hub.settings, approvals: t.hub.approvals });
    assert.equal(report.modeReset, true);
    assert.equal(t.hub.settings.get("mode"), "BUILD_SAFE");
  } finally { await t.cleanup(); }
});
