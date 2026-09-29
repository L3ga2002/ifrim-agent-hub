import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connectOpenClaw } from "../apps/api/src/openclaw-gateway.mjs";
import { inspectSubscriptionCredentialSources, verifyGatewayReceipt, digest } from "../apps/api/src/subscription-auth.mjs";
import { isDeepStrictEqual } from "node:util";
import { configuredAgentEntries } from "../apps/api/src/openclaw-config.mjs";
import { isolationPaths, validateIsolatedPaths, assertPhysicalIsolationBoundary } from "../apps/api/src/subscription-isolation.mjs";
import { inspectIsolatedPlugin } from "../apps/api/src/isolated-plugin-evidence.mjs";
import { acquireSubscriptionMaintenanceLock } from "./subscription-maintenance-lock.mjs";
import { DatabaseSync } from "node:sqlite";
import { exactHubAcceptanceScope } from "../apps/api/src/hub-acceptance-scope.mjs";

const suspendedMode = process.argv[2] === "--approved-suspended-hub-018";
if (!suspendedMode && process.argv[2] !== "--approved-hub-018") throw new Error("Approval required");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseMaintenanceLock = await acquireSubscriptionMaintenanceLock(root);
try {
const privateDir = path.join(root, ".ifrim", "private");
await assertPhysicalIsolationBoundary(root, privateDir);
const gateFile = path.join(privateDir, "openclaw-subscription-gate.json");
const originalGate = suspendedMode ? await fs.readFile(gateFile) : null;
const previousGate = originalGate ? JSON.parse(originalGate) : null;
const originalEvidence = {};
if (suspendedMode) {
  if (previousGate.status !== "suspended" || !exactHubAcceptanceScope(previousGate)) throw new Error("Exact suspended acceptance scope required");
  const db = new DatabaseSync(path.join(privateDir, "agent-hub.sqlite"), { readOnly: true });
  try {
    if (db.prepare("SELECT COUNT(*) AS n FROM hub_leases").get().n
      || db.prepare("SELECT COUNT(*) AS n FROM hub_provider_runs WHERE status='running'").get().n
      || db.prepare("SELECT COUNT(*) AS n FROM execution_attempts WHERE status='running'").get().n) throw new Error("Active work prevents certification");
  } finally { db.close(); }
  const stamp = new Date().toISOString().replaceAll(":", "-");
  for (const file of [gateFile, ...["codex", "claude"].map((provider) => path.join(privateDir, `openclaw-${provider}-auth-evidence.json`))]) {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Certificate must be a regular file");
    originalEvidence[file] = file === gateFile ? originalGate : await fs.readFile(file);
    if (digest(await fs.readFile(file)) !== digest(originalEvidence[file])) throw new Error("Certificate changed before checkpoint");
    await fs.writeFile(`${file}.checkpoint-recert-${stamp}`, originalEvidence[file], { flag: "wx" });
  }
}
const target = isolationPaths(root);
await assertPhysicalIsolationBoundary(root, target.state);
for (const file of [target.config, path.join(privateDir, "subscription-gateway-receipt.json")]) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Runtime source must be a regular file");
}
const raw = await fs.readFile(target.config);
const config = JSON.parse(raw.toString("utf8"));
validateIsolatedPaths(config, root);
if (suspendedMode && config.agents?.defaults?.skipBootstrap !== true) throw new Error("Automatic workspace bootstrap must be disabled");
const receipt = JSON.parse((await fs.readFile(path.join(privateDir, "subscription-gateway-receipt.json"), "utf8")).replace(/^\uFEFF/, ""));
await verifyGatewayReceipt(receipt);
if (receipt.configSha256 !== digest(raw)) throw new Error("Gateway was started with a different configuration");
const pluginEvidence = await inspectIsolatedPlugin(root, receipt.environment);
const agents = configuredAgentEntries(config).map((entry) => entry.id);
if (agents.length !== 23 || new Set(agents).size !== 23 || !agents.includes("main")) throw new Error("Certification requires all 23 configured roles, including main");
const providers = {};
const failures = {};
const pendingEvidence = {};
for (const provider of ["codex", "claude"]) {
  try {
    const evidence = { version: 1, provider, receipt, agents: {}, verifiedAt: new Date().toISOString() };
    const common = provider === "claude" ? await inspectSubscriptionCredentialSources(config, { cwd: root, provider, agentId: agents[0] }, receipt.environment) : null;
    for (const agentId of agents) evidence.agents[agentId] = { ...(common || await inspectSubscriptionCredentialSources(config, { cwd: root, provider, agentId }, receipt.environment)), pluginEvidence };
    const evidencePath = path.join(privateDir, `openclaw-${provider}-auth-evidence.json`);
    const data = JSON.stringify(evidence, null, 2);
    if (suspendedMode) pendingEvidence[evidencePath] = data;
    else await fs.writeFile(evidencePath, data);
    providers[provider] = { authMode: "local-subscription", apiBillingDisabled: true, evidencePath, evidenceSha256: digest(data) };
  } catch (error) { failures[provider] = error.message; }
}
if (suspendedMode && Object.keys(providers).length !== 2) throw new Error("Both subscriptions must be certified; gate remains suspended");
const client = await connectOpenClaw(() => {}, config);
try {
  const snapshot = await client.request("config.get", {}, { timeoutMs: 120000 });
  if (!snapshot.valid || !snapshot.appliedConfigHash || snapshot.appliedConfigHash !== snapshot.configRevisionHash) throw new Error("Applied config is not ready");
  await verifyGatewayReceipt(receipt);
  if (!suspendedMode && !isDeepStrictEqual(pluginEvidence, await inspectIsolatedPlugin(root, receipt.environment))) throw new Error("Native plugin changed during certification");
  if (digest(await fs.readFile(target.config)) !== digest(raw)) throw new Error("Configuration changed during certification");
  const gate = { ...(previousGate || {}), status: suspendedMode ? "suspended" : "approved", verifiedAt: new Date().toISOString(), configSha256: digest(raw), gatewayConfigHash: snapshot.hash, providers };
  if (suspendedMode) {
    for (const provider of ["codex", "claude"]) {
      const saved = JSON.parse(pendingEvidence[path.join(privateDir, `openclaw-${provider}-auth-evidence.json`)]);
      const common = provider === "claude" ? await inspectSubscriptionCredentialSources(config, { cwd: root, provider, agentId: agents[0] }, receipt.environment) : null;
      for (const agentId of agents) {
        const current = { ...(common || await inspectSubscriptionCredentialSources(config, { cwd: root, provider, agentId }, receipt.environment)), pluginEvidence };
        if (!isDeepStrictEqual(current, saved.agents[agentId])) throw new Error("Subscription changed during certification");
      }
    }
    if (!isDeepStrictEqual(pluginEvidence, await inspectIsolatedPlugin(root, receipt.environment))) throw new Error("Native plugin changed during certification");
    await verifyGatewayReceipt(receipt);
    const final = await client.request("config.get", {}, { timeoutMs: 30000 });
    if (final.valid !== true || final.hash !== snapshot.hash || final.configRevisionHash !== snapshot.configRevisionHash
      || final.appliedConfigHash !== final.configRevisionHash || final.config?.agents?.defaults?.skipBootstrap !== true) throw new Error("Applied configuration changed during certification");
    for (const [file, initial] of Object.entries(originalEvidence)) if (digest(await fs.readFile(file)) !== digest(initial)) throw new Error("Certificate changed concurrently");
    if (digest(await fs.readFile(target.config)) !== digest(raw)) throw new Error("Configuration changed during certification");
    for (const [file, data] of [...Object.entries(pendingEvidence), [gateFile, JSON.stringify(gate, null, 2)]]) {
      const temporary = `${file}.pending-${Date.now()}`;
      await fs.writeFile(temporary, data, { flag: "wx" });
      await fs.rename(temporary, file);
    }
  } else if (Object.keys(providers).length) await fs.writeFile(gateFile, JSON.stringify(gate, null, 2));
  console.log(JSON.stringify({ status: gate.status, certifiedProviders: Object.keys(providers), agents: agents.length, failures, modelStarted: false }));
} finally { await client.stopAndWait(); }
} finally { await releaseMaintenanceLock(); }
