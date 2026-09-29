import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { previewSubscriptionGate, validateSubscriptionGate } from "../apps/api/src/openclaw-subscription-gate.mjs";
import { connectCertifiedOpenClaw } from "../apps/api/src/openclaw-provider.mjs";
import { buildIsolatedSubscriptionConfig, isolationPaths } from "../apps/api/src/subscription-isolation.mjs";

const digest = data => createHash("sha256").update(data).digest("hex");
const model = "openai/gpt-6-luna";
const roles = ["main", "ifrim-backend", ...Array.from({ length: 21 }, (_, i) => `ifrim-fixture-${String.fromCharCode(97 + i)}`)];

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hub-subscription-preview-test-"));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("hub-subscription-preview-test-"));
    await fs.rm(root, { recursive: true, force: true });
  });
  const isolated = isolationPaths(root);
  const evidencePath = path.join(root, ".ifrim/private/openclaw-codex-auth-evidence.json");
  const gatePath = path.join(root, ".ifrim/private/openclaw-subscription-gate.json");
  const config = buildIsolatedSubscriptionConfig({
    agents: { entries: Object.fromEntries(roles.map(id => [id, {}])) },
    plugins: { entries: { codex: { config: { appServer: { command: path.join(root, "absent-codex.exe") } } } } },
  }, root, "synthetic-token-".repeat(4));
  const evidence = { version: 1, provider: "codex", verifiedAt: new Date().toISOString(),
    agents: { "ifrim-backend": { sources: {} } }, receipt: { projectRoot: root } };
  const gate = { status: "approved", verifiedAt: new Date().toISOString(),
    gatewayConfigHash: "synthetic-gateway-hash", providers: { codex: {
      authMode: "local-subscription", apiBillingDisabled: true, evidencePath,
    } } };
  await fs.mkdir(isolated.state, { recursive: true });
  const value = { root, config, evidence, gate,
    options: { cwd: root, provider: "codex", agentId: "ifrim-backend", model, reasoning: "max", accessMode: "read-only" },
    async save() {
      const raw = JSON.stringify(config);
      const proof = JSON.stringify(evidence);
      gate.configSha256 = digest(raw);
      gate.providers.codex.evidenceSha256 = digest(proof);
      await fs.writeFile(isolated.config, raw);
      await fs.writeFile(evidencePath, proof);
      await fs.writeFile(gatePath, JSON.stringify(gate));
    }, evidencePath, gatePath, configPath: isolated.config };
  await value.save();
  return value;
}

test("preview accepts only certificate eligibility without runtime readiness, SDK or mutation", async t => {
  const f = await fixture(t);
  const files = [f.configPath, f.evidencePath, f.gatePath];
  const before = await Promise.all(files.map(file => fs.readFile(file)));
  assert.deepEqual(await previewSubscriptionGate(f.options), {
    eligible: true, ready: false, verification: "runtime_pending", blocker: "",
  });
  assert.deepEqual(await Promise.all(files.map(file => fs.readFile(file))), before);
  await assert.rejects(fs.access(path.join(f.root, "absent-codex.exe")), { code: "ENOENT" });
});

for (const [label, timestamp] of [
  ["missing", undefined], ["invalid", "invalid-date"],
  ["stale", () => new Date(Date.now() - 86460000).toISOString()],
  ["future", () => new Date(Date.now() + 60000).toISOString()],
]) {
  test(`preview rejects ${label} gate timestamp`, async t => {
    const f = await fixture(t);
    f.gate.verifiedAt = typeof timestamp === "function" ? timestamp() : timestamp;
    await f.save();
    await assert.rejects(previewSubscriptionGate(f.options), /not verified/);
  });
}

const rejected = [
  ["suspended gate", f => { f.gate.status = "suspended"; }, /not verified/],
  ["wrong evidence project", f => { f.evidence.receipt.projectRoot = path.join(f.root, "other-project"); }, /another project/],
  ["wrong evidence provider", f => { f.evidence.provider = "claude"; }, /selected agent/],
  ["wrong evidence version", f => { f.evidence.version = 2; }, /selected agent/],
  ["uncovered agent", f => { f.evidence.agents = {}; }, /selected agent/],
  ["wrong provider route", f => { f.options.provider = "claude"; }, /not verified/],
  ["unapproved model route", f => { f.options.model = "openai/other-model"; }, /runtime/],
  ["fallback route", f => { f.config.agents.entries["ifrim-backend"].model.fallbacks = ["other-model"]; }, /fallback/],
  ["API authentication", f => { f.gate.providers.codex.authMode = "api_key"; }, /not verified/],
  ["API billing enabled", f => { f.gate.providers.codex.apiBillingDisabled = false; }, /not verified/],
  ["evidence path outside fixture certificate", f => { f.gate.providers.codex.evidencePath = path.join(f.root, "wrong-evidence.json"); }, /outside/],
];
for (const [label, change, error] of rejected) {
  test(`preview rejects ${label}`, async t => {
    const f = await fixture(t);
    change(f);
    await f.save();
    await assert.rejects(previewSubscriptionGate(f.options), error);
  });
}

for (const target of ["evidencePath", "configPath"]) {
  test(`preview rejects changed ${target} bytes without recertification`, async t => {
    const f = await fixture(t);
    await fs.appendFile(f[target], " ");
    await assert.rejects(previewSubscriptionGate(f.options), target === "evidencePath" ? /evidence changed/ : /not verified/);
  });
}

test("default full certification rejects fake receipt before connect or SDK inspection", async t => {
  const f = await fixture(t);
  assert.equal((await previewSubscriptionGate(f.options)).eligible, true);
  let connections = 0;
  await assert.rejects(connectCertifiedOpenClaw(() => {}, f.options, {
    connect: async () => { connections++; throw new Error("connect must not run"); },
  }), /Controlled Gateway launch evidence is missing/);
  assert.equal(connections, 0);
});

test("certified connection invokes full audit hook exactly once before one connection", async () => {
  const events = [];
  const options = { cwd: "synthetic-workspace" };
  const config = { gateway: { port: 18790 }, agents: { defaults: { skipBootstrap: true } } };
  const callback = () => {};
  const client = { async request(method, params, settings) {
    events.push("config.get");
    assert.equal(method, "config.get");
    assert.deepEqual(params, {});
    assert.equal(settings.timeoutMs, 30000);
    return { valid: true, hash: "certified", appliedConfigHash: "revision", configRevisionHash: "revision" };
  } };
  const result = await connectCertifiedOpenClaw(callback, options, {
    certify: async supplied => { assert.equal(supplied, options); events.push("full-audit"); return { config, gatewayConfigHash: "certified" }; },
    connect: async (onEvent, supplied) => { assert.equal(onEvent, callback); assert.equal(supplied, config); events.push("connect"); return client; },
  });
  assert.equal(result, client);
  assert.equal(client.hubGatewayPort, 18790);
  assert.deepEqual(events, ["full-audit", "connect", "config.get"]);
});

test("audit hook failure cannot reach connect", async () => {
  let audits = 0;
  let connections = 0;
  await assert.rejects(connectCertifiedOpenClaw(() => {}, {}, {
    certify: async () => { audits++; throw new Error("synthetic audit rejected"); },
    connect: async () => { connections++; },
  }), /synthetic audit rejected/);
  assert.equal(audits, 1);
  assert.equal(connections, 0);
});

test("source preserves fresh audits only on actual execution and cheap conversation previews", async () => {
  const read = file => fs.readFile(new URL(file, import.meta.url), "utf8");
  const gate = await read("../apps/api/src/openclaw-subscription-gate.mjs");
  const preview = gate.slice(gate.indexOf("export async function previewSubscriptionGate"), gate.indexOf("export async function assertSubscriptionGate"));
  const actual = gate.slice(gate.indexOf("export async function assertSubscriptionGate"));
  const cheap = gate.slice(gate.indexOf("async function readSubscriptionCertificate"), gate.indexOf("export async function previewSubscriptionGate"));
  assert.match(preview, /await readSubscriptionCertificate\(options\)/);
  assert.doesNotMatch(preview + cheap, /await (?:verifyGatewayReceipt|inspectSubscriptionSources)|import\(/);
  assert.match(actual, /await verifyGatewayReceipt\(evidence\.receipt\)/);
  assert.match(actual, /await inspectSubscriptionSources\(config, options, evidence\.receipt\.environment\)/);
  assert.ok(actual.indexOf("await verifyGatewayReceipt") < actual.indexOf("await inspectSubscriptionSources"));
  const provider = await read("../apps/api/src/openclaw-provider.mjs");
  assert.match(provider, /certify = assertSubscriptionGate, connect = connectOpenClaw/);
  assert.doesNotMatch(provider, /previewSubscriptionGate/);
  assert.ok(provider.indexOf("await certify(options)") < provider.indexOf("await connect(onEvent, verified.config)"));
  const server = await read("../apps/api/src/server.mjs");
  assert.equal((server.match(/await previewSubscriptionGate\(/g) || []).length, 2);
  assert.equal((server.match(/await assertSubscriptionGate\(/g) || []).length, 2);
  assert.equal((server.match(/await previewSubscriptionGate\(\{ \.\.\.route, cwd: conversation\.workspace, conversationId(?:: conversation\.id)? \}\)/g) || []).length, 2);
  const early = server.slice(server.indexOf("async function launchConversationRun("), server.indexOf("const run = conversationStore.createRun", server.indexOf("async function launchConversationRun(")));
  assert.match(early, /await previewSubscriptionGate/);
  assert.doesNotMatch(early, /await assertSubscriptionGate/);
  const ui = await read("../src/main.jsx");
  assert.match(ui, /!routeGate\?\.eligible/);
  assert.match(ui, /routeGate\.verification === "runtime_pending"/);
});

const scopes = [
  ["acceptanceConversationId", "conversationId"], ["acceptanceProvider", "provider"],
  ["acceptanceModel", "model"], ["acceptanceReasoning", "reasoning"],
  ["acceptanceAccessMode", "accessMode"],
];

function scopeFixture() {
  const now = Date.now();
  const options = { conversationId: "synthetic-conversation", provider: "codex", model,
    reasoning: "max", accessMode: "read-only", agentId: "ifrim-backend" };
  const gate = { status: "approved", verifiedAt: new Date(now).toISOString(),
    configSha256: "synthetic-config", gatewayConfigHash: "synthetic-runtime",
    providers: { codex: { authMode: "local-subscription", apiBillingDisabled: true,
      evidencePath: "synthetic-evidence.json" } } };
  const config = { agents: { entries: { "ifrim-backend": { model: { fallbacks: [] } } },
    defaults: { models: { [model]: { agentRuntime: { id: "codex" } } },
      modelPolicy: { allow: [model] } } } };
  return { gate, config, options, now };
}

function validateScope(f) {
  return validateSubscriptionGate(f.gate, f.config, "synthetic-config", f.options, f.now);
}

test("legacy certificate without optional acceptance scope remains compatible", () => {
  assert.equal(validateScope(scopeFixture()), true);
});

test("exact one-conversation Codex Luna max read-only scope passes without mutation", () => {
  const f = scopeFixture();
  for (const [field, option] of scopes) f.gate[field] = f.options[option];
  const before = structuredClone(f);
  assert.equal(validateScope(f), true);
  assert.deepEqual(f, before);
});

for (const [field, option] of scopes) {
  for (const [label, value] of [["null", null], ["empty", ""], ["whitespace", " "],
    ["false", false], ["number", 1], ["undefined", undefined], ["mismatch", "different-route"]]) {
    test(`${field} rejects present ${label} value`, () => {
      const f = scopeFixture();
      f.gate[field] = value;
      const before = structuredClone(f);
      assert.throws(() => validateScope(f), /Controlled acceptance scope/);
      assert.deepEqual(f, before);
    });
  }
  test(`${field} requires the matching option`, () => {
    const f = scopeFixture();
    f.gate[field] = f.options[option];
    delete f.options[option];
    assert.throws(() => validateScope(f), /Controlled acceptance scope/);
  });
}

test("Codex-scoped acceptance rejects Claude before other provider guards", () => {
  const f = scopeFixture();
  f.gate.acceptanceProvider = "codex";
  f.options.provider = "claude";
  assert.throws(() => validateScope(f), /Controlled acceptance scope/);
});

test("preview applies persisted acceptance scope and rejects another conversation", async t => {
  const f = await fixture(t);
  f.options.conversationId = "synthetic-conversation";
  for (const [field, option] of scopes) f.gate[field] = f.options[option];
  await f.save();
  assert.equal((await previewSubscriptionGate(f.options)).eligible, true);
  await assert.rejects(previewSubscriptionGate({ ...f.options, conversationId: "other-conversation" }), /Controlled acceptance scope/);
});
