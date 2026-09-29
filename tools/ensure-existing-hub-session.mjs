import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { connectOpenClaw } from "../apps/api/src/openclaw-gateway.mjs";
import { verifySessionBinding } from "../apps/api/src/openclaw-provider.mjs";
import { digest, inspectSubscriptionSources, subscriptionProfiles, verifyGatewayReceipt } from "../apps/api/src/subscription-auth.mjs";
import { isolationPaths, validateIsolatedPaths } from "../apps/api/src/subscription-isolation.mjs";
import { assertPhysicalIsolationBoundary } from "../apps/api/src/subscription-isolation.mjs";
import { validateSuspendedDiagnosticCertificate } from "../apps/api/src/existing-session-diagnostic.mjs";

if (process.argv[2] !== "--approved-hub-018") throw new Error("Approval required");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const privateDir = path.join(root, ".ifrim", "private");
const options = { cwd: root, provider: "codex", model: "openai/gpt-6-luna", reasoning: "max", accessMode: "read-only", agentId: "ifrim-backend" };
const key = "agent:ifrim-backend:ifrim-hub:d79b32fc58d1542d5d5439f8edd1d8a2";
const expectedId = "6273c92f-f187-48ea-a7df-a13d78f2b543";
const phase = (name) => console.log(JSON.stringify({ phase: name, at: new Date().toISOString() }));
const readJson = async (file) => JSON.parse((await fs.readFile(file, "utf8")).replace(/^\uFEFF/, ""));
const gate = await readJson(path.join(privateDir, "openclaw-subscription-gate.json"));
if (gate.status !== "suspended") throw new Error("Diagnostic requires suspended execution gate");
const raw = await fs.readFile(isolationPaths(root).config);
const config = JSON.parse(raw);
await assertPhysicalIsolationBoundary(root, isolationPaths(root).state);
validateIsolatedPaths(config, root);
const proof = gate.providers?.codex;
const evidencePath = path.join(privateDir, "openclaw-codex-auth-evidence.json");
if (!proof || path.resolve(proof.evidencePath) !== evidencePath || proof.authMode !== "local-subscription" || proof.apiBillingDisabled !== true) throw new Error("Subscription evidence missing");
const evidenceRaw = await fs.readFile(evidencePath);
if (digest(evidenceRaw) !== proof.evidenceSha256 || digest(raw) !== gate.configSha256) throw new Error("Certification changed");
const evidence = JSON.parse(evidenceRaw);
validateSuspendedDiagnosticCertificate(gate, evidence, config, digest(raw), options);
phase("receipt-verification");
await verifyGatewayReceipt(evidence.receipt);
phase("fresh-source-verification");
const current = await inspectSubscriptionSources(config, options, evidence.receipt.environment);
if (!isDeepStrictEqual(current, evidence.agents[options.agentId])) throw new Error("Authentication or runtime changed");
phase("gateway-connection");
const client = await connectOpenClaw(() => {}, config);
try {
  phase("applied-configuration-verification");
  const snapshot = await client.request("config.get", {}, { timeoutMs: 30000 });
  if (!snapshot.valid || snapshot.hash !== gate.gatewayConfigHash || !snapshot.appliedConfigHash || snapshot.appliedConfigHash !== snapshot.configRevisionHash) throw new Error("Applied configuration changed");
  phase("existing-identity-verification");
  const described = await client.request("sessions.describe", { key, agentId: options.agentId }, { timeoutMs: 30000 });
  if (described.session?.sessionId !== expectedId) throw new Error("Expected existing session not confirmed");
  if ((await readJson(path.join(privateDir, "openclaw-subscription-gate.json"))).status !== "suspended") throw new Error("Execution gate changed");
  // Optional global readiness projections cannot replace this exact-session capability check.
  const start = Date.now();
  const created = await client.request("sessions.create", { key, agentId: options.agentId, cwd: root,
    model: `${options.model}@${subscriptionProfiles.codex}`, agentRuntime: "codex", thinkingLevel: "max",
    permissionMode: "read-only", toolOverrides: { webSearch: false },
    displayName: "Ifrim Hub codex 0b18cf4ccb29", category: "Ifrim Agent Hub" },
    { timeoutMs: 120000, onSent: (requestId) => console.log(JSON.stringify({ phase: "ensure-sent", requestId, sentAt: new Date().toISOString() })) });
  const bindingError = verifySessionBinding(created, options, key);
  if (created.sessionId !== expectedId || created.runStarted !== false || bindingError) throw new Error("Existing session capability not confirmed");
  await verifyGatewayReceipt(evidence.receipt);
  if ((await readJson(path.join(privateDir, "openclaw-subscription-gate.json"))).status !== "suspended") throw new Error("Execution gate changed");
  console.log(JSON.stringify({ phase: "ensure-confirmed", elapsedMs: Date.now() - start, sessionId: created.sessionId, runStarted: false, model: options.model, reasoning: options.reasoning, accessMode: options.accessMode, gate: "suspended", modelTurnSubmitted: false }));
} catch (error) {
  console.log(JSON.stringify({ phase: "ensure-stopped", code: error.code || "", method: error.method || "", requestSent: error.requestSent ?? null, timeoutMs: error.timeoutMs ?? null }));
  process.exitCode = 1;
} finally { await client.stopAndWait(); }
