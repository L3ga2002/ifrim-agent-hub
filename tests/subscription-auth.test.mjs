import test from "node:test";
import assert from "node:assert/strict";
import { validateAuthConfiguration, validateClaudeStatus, validateOAuthProfile, inspectSubscriptionSources, validateStartupProfiles, verifyGatewayReceipt } from "../apps/api/src/subscription-auth.mjs";
import { isolationPaths } from "../apps/api/src/subscription-isolation.mjs";
import path from "node:path";

test("receipt rejects old/global Gateway identities before OS execution", async () => {
  const root = path.resolve("test-hub");
  const isolated = isolationPaths(root);
  const receipt = {pid:123,startedAt:new Date().toISOString(),environmentPolicy:"allowlist-subscription-only-v1",projectRoot:root,port:18790,
    workingDirectory:isolated.state,environment:{OPENCLAW_STATE_DIR:isolated.state,OPENCLAW_CONFIG_PATH:isolated.config,OPENCLAW_LOAD_SHELL_ENV:"0",OPENCLAW_SKIP_CRON:"1"}};
  for (const change of [{port:18789},{projectRoot:""},{workingDirectory:path.resolve("other")},
    {environment:{...receipt.environment,OPENCLAW_STATE_DIR:path.resolve("global")}},
    {environment:{...receipt.environment,OPENCLAW_CONFIG_PATH:path.resolve("global.json")}},
    {environment:{...receipt.environment,OPENAI_API_KEY:"opaque"}}]) {
    await assert.rejects(verifyGatewayReceipt({...receipt,...change}), /receipt|isolated|subscription-only/);
  }
});

test("startup refuses stored API, token and other-provider credentials without deleting them", () => {
  validateStartupProfiles({ profiles: { codex: { type: "oauth", provider: "openai" }, claude: { type: "oauth", provider: "anthropic" } } });
  for (const profile of [{ type: "api_key", provider: "openai", key: "opaque" }, { type: "api_key", provider: "anthropic", keyRef: { source: "file" } }, { type: "token", provider: "anthropic" }, { type: "oauth", provider: "other" }]) {
    const store = { profiles: { saved: profile } };
    const before = JSON.stringify(store);
    assert.throws(() => validateStartupProfiles(store), /Startup blocked/);
    assert.equal(JSON.stringify(store), before);
  }
});

test("native authentication inspection refuses missing Gateway environment before reading credentials", async () => {
  const config = { plugins: { entries: { codex: { config: { appServer: { command: "C:/Codex/codex.exe" } } } } } };
  for (const provider of ["codex", "claude"]) await assert.rejects(inspectSubscriptionSources(config, { provider, agentId: "ifrim-qa", cwd: "C:/Hub" }), /environment provenance/);
});

test("subscription-only configuration refuses includes, environment, API provider and home overrides", () => {
  const config = { plugins: { entries: { codex: { config: { appServer: { command: "C:/Codex/codex.exe" } } } } } };
  validateAuthConfiguration(config);
  for (const extra of [{ env: { vars: { OPENAI_API_KEY: "x" } } }, { $include: "override.json" }, { models: { providers: { anthropic: { apiKey: "x" } } } }, { models: { providers: { custom: { apiKey: "x" } } } }, { models: { providers: { custom: { credentials: { keyRef: "opaque" } } } } }]) {
    assert.throws(() => validateAuthConfiguration({ ...config, ...extra }), /audit|API/);
  }
  config.plugins.entries.codex.config.appServer.homeScope = "user";
  assert.throws(() => validateAuthConfiguration(config), /isolation/);
});

test("Claude requires native subscription, not API helper or third-party authentication", () => {
  const status = { loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty", subscriptionType: "max" };
  validateClaudeStatus(status);
  for (const change of [{ authMethod: "api_key" }, { authMethod: "api_key_helper" }, { apiProvider: "bedrock" }, { loggedIn: false }, { subscriptionType: "api" }]) {
    assert.throws(() => validateClaudeStatus({ ...status, ...change }), /subscription/);
  }
});

test("Codex requires usable pinned ChatGPT OAuth and cannot consume an API profile", () => {
  const profile = { type: "oauth", provider: "openai", access: "opaque", refresh: "opaque", expires: Date.now() + 60000, accountId: "account", chatgptPlanType: "pro" };
  validateOAuthProfile(profile);
  for (const change of [{ type: "api_key" }, { expires: 1 }, { refresh: "" }, { provider: "anthropic" }, { accountId: "" }]) {
    assert.throws(() => validateOAuthProfile({ ...profile, ...change }), /OAuth/);
  }
});
