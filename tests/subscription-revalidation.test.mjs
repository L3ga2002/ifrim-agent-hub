import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { revalidateSubscriptionCertificate, validateSubscriptionGate } from "../apps/api/src/openclaw-subscription-gate.mjs";
import { connectCertifiedOpenClaw } from "../apps/api/src/openclaw-provider.mjs";

const now = Date.parse("2026-09-29T16:00:00Z");
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function fixture() {
  const options = { cwd: "synthetic-hub", conversationId: "synthetic-conversation", provider: "codex",
    agentId: "ifrim-backend", model: "openai/gpt-6-luna", reasoning: "max", accessMode: "read-only" };
  const config = { gateway: { port: 18790 }, agents: {
    entries: { "ifrim-backend": { model: { fallbacks: [] } } }, defaults: { skipBootstrap: true,
      models: { [options.model]: { agentRuntime: { id: "codex" } } }, modelPolicy: { allow: [options.model] },
    },
  } };
  const evidence = { version: 1, provider: "codex", agents: { "ifrim-backend": { sources: {} } },
    receipt: { marker: "synthetic-receipt" } };
  const gate = { status: "approved", verifiedAt: new Date(now).toISOString(),
    configSha256: digest(config), gatewayConfigHash: "synthetic-runtime",
    providers: { codex: { authMode: "local-subscription", apiBillingDisabled: true,
      evidencePath: "synthetic-evidence", evidenceSha256: digest(evidence) } },
    acceptanceConversationId: options.conversationId, acceptanceProvider: options.provider,
    acceptanceModel: options.model, acceptanceReasoning: options.reasoning, acceptanceAccessMode: options.accessMode };
  return { options, initial: { config, gate, evidence } };
}

function validateLatest(snapshot, options) {
  validateSubscriptionGate(snapshot.gate, snapshot.config, digest(snapshot.config), options, now);
  if (snapshot.gate.providers.codex.evidenceSha256 !== digest(snapshot.evidence)) {
    throw new Error("Synthetic evidence hash changed");
  }
  return snapshot;
}

test("same snapshot revalidates receipt then fresh certificate without mutating inputs", async () => {
  const { initial, options } = fixture();
  const before = structuredClone(initial);
  const events = [];
  await revalidateSubscriptionCertificate(initial, options, async supplied => {
    assert.equal(supplied, options);
    events.push("fresh-read");
    return validateLatest(structuredClone(initial), supplied);
  }, async receipt => { assert.equal(receipt, initial.evidence.receipt); events.push("receipt"); });
  assert.deepEqual(events, ["receipt", "fresh-read"]);
  assert.deepEqual(initial, before);
});

const mutations = [
  ["suspension", s => { s.gate.status = "suspended"; }, /not verified/],
  ...["acceptanceConversationId", "acceptanceProvider", "acceptanceModel", "acceptanceReasoning", "acceptanceAccessMode"]
    .map(field => [field, s => { s.gate[field] = "another-route"; }, /acceptance scope/]),
  ["evidence hash", s => { s.evidence.agents["ifrim-backend"].sources.changed = true; }, /evidence hash/],
  ["recertified evidence snapshot", s => {
    s.evidence.agents["ifrim-backend"].sources.changed = true;
    s.gate.providers.codex.evidenceSha256 = digest(s.evidence);
  }, /changed during verification/],
  ["configuration hash", s => { s.config.gateway.marker = "changed"; }, /not verified/],
  ["recertified configuration snapshot", s => {
    s.config.gateway.marker = "changed"; s.gate.configSha256 = digest(s.config);
  }, /changed during verification/],
  ["expiry", s => { s.gate.verifiedAt = new Date(now - 86400001).toISOString(); }, /not verified/],
  ["future timestamp", s => { s.gate.verifiedAt = new Date(now + 1).toISOString(); }, /not verified/],
  ["invalid timestamp", s => { s.gate.verifiedAt = "invalid"; }, /not verified/],
  ["receipt snapshot", s => {
    s.evidence.receipt.marker = "different-receipt";
    s.gate.providers.codex.evidenceSha256 = digest(s.evidence);
  }, /changed during verification/],
];

for (const [label, mutate, expected] of mutations) {
  test(`final ${label} revocation prevents connect, create and agent`, async () => {
    const { initial, options } = fixture();
    const latest = structuredClone(initial);
    mutate(latest);
    const before = structuredClone(initial);
    const events = [];
    const calls = { scans: 0, connect: 0, create: 0, agent: 0 };
    await assert.rejects(connectCertifiedOpenClaw(() => {}, options, {
      certify: async supplied => {
        calls.scans++;
        await revalidateSubscriptionCertificate(initial, supplied, async currentOptions => {
          events.push("fresh-read");
          return validateLatest(latest, currentOptions);
        }, async () => { events.push("receipt"); });
        return { config: initial.config, gatewayConfigHash: initial.gate.gatewayConfigHash };
      },
      connect: async () => {
        calls.connect++;
        return { request: async method => {
          if (method === "sessions.create") calls.create++;
          if (method === "agent") calls.agent++;
          throw new Error("Unexpected simulated RPC");
        } };
      },
    }), expected);
    assert.deepEqual(calls, { scans: 1, connect: 0, create: 0, agent: 0 });
    assert.deepEqual(events, ["receipt", "fresh-read"]);
    assert.deepEqual(initial, before);
  });
}

test("receipt verification failure rejects before fresh read and before connect", async () => {
  const { initial, options } = fixture();
  const events = [];
  let connections = 0;
  await assert.rejects(connectCertifiedOpenClaw(() => {}, options, {
    certify: async supplied => {
      await revalidateSubscriptionCertificate(initial, supplied, async () => {
        events.push("unexpected-read"); return initial;
      }, async () => { events.push("receipt"); throw new Error("Synthetic receipt invalidated"); });
    },
    connect: async () => { connections++; },
  }), /receipt invalidated/);
  assert.deepEqual(events, ["receipt"]);
  assert.equal(connections, 0);
});

test("unchanged certificate permits one simulated scan and connection only after final checks", async () => {
  const { initial, options } = fixture();
  const events = [];
  const client = { async request(method) {
    assert.equal(method, "config.get"); events.push("config.get");
    return { valid: true, hash: initial.gate.gatewayConfigHash,
      configRevisionHash: "revision", appliedConfigHash: "revision" };
  } };
  const connected = await connectCertifiedOpenClaw(() => {}, options, {
    certify: async supplied => {
      events.push("one-source-scan");
      await revalidateSubscriptionCertificate(initial, supplied, async current => {
        events.push("fresh-read"); return validateLatest(structuredClone(initial), current);
      }, async () => { events.push("receipt"); });
      return { config: initial.config, gatewayConfigHash: initial.gate.gatewayConfigHash };
    },
    connect: async () => { events.push("connect"); return client; },
  });
  assert.equal(connected, client);
  assert.deepEqual(events, ["one-source-scan", "receipt", "fresh-read", "connect", "config.get"]);
});

test("production source performs one fresh scan then awaited revocation guard before returning", async () => {
  const source = await fs.readFile(new URL("../apps/api/src/openclaw-subscription-gate.mjs", import.meta.url), "utf8");
  const actual = source.slice(source.indexOf("export async function assertSubscriptionGate("));
  assert.equal((actual.match(/await inspectSubscriptionSources\(/g) || []).length, 1);
  const scan = actual.indexOf("await inspectSubscriptionSources(");
  const compare = actual.indexOf("JSON.stringify(actual)");
  const guard = actual.indexOf("await revalidateSubscriptionCertificate({ config, gate, evidence }, options)");
  const result = actual.indexOf("return { config");
  assert.ok(scan >= 0 && scan < compare && compare < guard && guard < result);
  const revalidate = source.slice(source.indexOf("export async function revalidateSubscriptionCertificate("), source.indexOf("export async function assertSubscriptionGate("));
  assert.match(revalidate, /readLatest = readSubscriptionCertificate, verifyReceipt = verifyGatewayReceipt/);
  assert.ok(revalidate.indexOf("await verifyReceipt(") < revalidate.indexOf("await readLatest("));
  assert.match(revalidate, /JSON\.stringify\(latest\) !== JSON\.stringify\(initial\)/);
  assert.doesNotMatch(revalidate, /inspectSubscriptionSources\(/);
});
