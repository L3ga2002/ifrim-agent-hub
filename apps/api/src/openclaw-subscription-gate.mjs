import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { configuredAgentEntries } from "./openclaw-config.mjs";
import { inspectSubscriptionSources, verifyGatewayReceipt, digest } from "./subscription-auth.mjs";
import { isolationPaths, validateIsolatedPaths, assertPhysicalIsolationBoundary } from "./subscription-isolation.mjs";

export function validateSubscriptionGate(gate, config, configHash, options, now = Date.now()) {
  for (const [field, option] of [["acceptanceConversationId", "conversationId"], ["acceptanceProvider", "provider"],
    ["acceptanceModel", "model"], ["acceptanceReasoning", "reasoning"], ["acceptanceAccessMode", "accessMode"]]) {
    if (Object.hasOwn(gate || {}, field) && (typeof gate[field] !== "string" || !gate[field].trim() || gate[field] !== options[option])) {
      throw new Error("Controlled acceptance scope does not match the requested execution");
    }
  }
  const proof = gate?.providers?.[options.provider];
  const age = now - Date.parse(gate?.verifiedAt || "");
  if (gate?.status !== "approved" || !gate.gatewayConfigHash || gate.configSha256 !== configHash || !Number.isFinite(age) || age < 0 || age > 86400000
    || proof?.authMode !== "local-subscription" || proof?.apiBillingDisabled !== true || !proof?.evidencePath) {
    throw new Error("OpenClaw subscription-only preflight is not verified for this configuration; live execution remains disabled");
  }
  const agent = configuredAgentEntries(config).find((item) => item.id === options.agentId);
  if (!agent || !Array.isArray(agent.model?.fallbacks) || agent.model.fallbacks.length) throw new Error("OpenClaw fallback policy is not fail-closed");
  const runtime = config.agents?.defaults?.models?.[options.model]?.agentRuntime?.id;
  if (runtime !== (options.provider === "codex" ? "codex" : "claude-cli")) throw new Error("Native subscription runtime is not configured");
  if (!config.agents?.defaults?.modelPolicy?.allow?.includes(options.model)) throw new Error("Model is not approved in OpenClaw");
  return true;
}

async function readSubscriptionCertificate(options) {
  const isolated = isolationPaths(options.cwd);
  await assertPhysicalIsolationBoundary(options.cwd, isolated.state);
  const raw = await fs.readFile(isolated.config);
  let gate;
  try { gate = JSON.parse(await fs.readFile(path.join(options.cwd, ".ifrim", "private", "openclaw-subscription-gate.json"), "utf8")); }
  catch { throw new Error("OpenClaw live route awaits subscription-only preflight and activation approval"); }
  const config = JSON.parse(raw.toString("utf8"));
  validateIsolatedPaths(config, options.cwd);
  validateSubscriptionGate(gate, config, createHash("sha256").update(raw).digest("hex"), options);
  const proof = gate.providers[options.provider];
  const expectedPath = path.join(options.cwd, ".ifrim", "private", `openclaw-${options.provider}-auth-evidence.json`);
  if (path.resolve(proof.evidencePath) !== path.resolve(expectedPath)) throw new Error("Subscription evidence is outside the private workspace");
  const evidenceRaw = await fs.readFile(expectedPath);
  if (digest(evidenceRaw) !== proof.evidenceSha256) throw new Error("Subscription evidence changed");
  const evidence = JSON.parse(evidenceRaw.toString("utf8"));
  if (path.resolve(evidence.receipt?.projectRoot || "") !== path.resolve(options.cwd)) throw new Error("Gateway evidence belongs to another project");
  if (evidence.version !== 1 || evidence.provider !== options.provider || !evidence.agents?.[options.agentId]) throw new Error("Subscription evidence does not cover the selected agent");
  return { config, gate, evidence };
}

export async function previewSubscriptionGate(options) {
  await readSubscriptionCertificate(options);
  return { eligible: true, ready: false, verification: "runtime_pending", blocker: "" };
}

export async function revalidateSubscriptionCertificate(initial, options, readLatest = readSubscriptionCertificate, verifyReceipt = verifyGatewayReceipt) {
  await verifyReceipt(initial.evidence.receipt);
  const latest = await readLatest(options);
  if (JSON.stringify(latest) !== JSON.stringify(initial)) throw new Error("Subscription certification changed during verification");
}

export async function assertSubscriptionGate(options) {
  const { config, gate, evidence } = await readSubscriptionCertificate(options);
  await verifyGatewayReceipt(evidence.receipt);
  const actual = await inspectSubscriptionSources(config, options, evidence.receipt.environment);
  if (JSON.stringify(actual) !== JSON.stringify(evidence.agents[options.agentId])) throw new Error("Authentication sources or runtime changed; recertification required");
  await revalidateSubscriptionCertificate({ config, gate, evidence }, options);
  return { config, gatewayConfigHash: gate.gatewayConfigHash,
    cli: { executable: evidence.receipt.executable, entrypoint: evidence.receipt.entrypoint,
      environment: { ...evidence.receipt.environment } } };
}
