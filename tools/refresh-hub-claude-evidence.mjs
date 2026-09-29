import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { isDeepStrictEqual } from "node:util";
import { connectOpenClaw } from "../apps/api/src/openclaw-gateway.mjs";
import { inspectSubscriptionCredentialSources, verifyGatewayReceipt, digest } from "../apps/api/src/subscription-auth.mjs";
import { inspectIsolatedPlugin } from "../apps/api/src/isolated-plugin-evidence.mjs";
import { configuredAgentEntries } from "../apps/api/src/openclaw-config.mjs";
import { isolationPaths, validateIsolatedPaths, assertPhysicalIsolationBoundary } from "../apps/api/src/subscription-isolation.mjs";
import { validateSuspendedDiagnosticCertificate } from "../apps/api/src/existing-session-diagnostic.mjs";
import { hubAcceptanceScopes, exactHubAcceptanceScope } from "../apps/api/src/hub-acceptance-scope.mjs";
import { acquireSubscriptionMaintenanceLock } from "./subscription-maintenance-lock.mjs";

export function assertNarrowClaudeRefresh(previous, current, globalConfig) {
  if (!previous?.sources || !current?.sources || !Object.hasOwn(previous.sources, globalConfig)
    || !Object.hasOwn(current.sources, globalConfig)) throw new Error("Claude state provenance missing");
  const comparison = { ...current, sources: { ...current.sources, [globalConfig]: previous.sources[globalConfig] } };
  if (!isDeepStrictEqual(previous, comparison)) throw new Error("Only Claude application state may be recertified by this helper");
}

export async function refreshHubClaudeEvidence(root, { inspectCredentials = inspectSubscriptionCredentialSources,
  inspectPlugin = inspectIsolatedPlugin, verifyReceipt = verifyGatewayReceipt, connect = connectOpenClaw,
  acquireLock = acquireSubscriptionMaintenanceLock } = {}) {
  const privateDir = path.join(root, ".ifrim/private");
  await assertPhysicalIsolationBoundary(root, privateDir);
  const release = await acquireLock(root);
  let client;
  try {
    const gateFile = path.join(privateDir, "openclaw-subscription-gate.json");
    const evidenceFile = path.join(privateDir, "openclaw-claude-auth-evidence.json");
    const codexFile = path.join(privateDir, "openclaw-codex-auth-evidence.json");
    const database = path.join(privateDir, "agent-hub.sqlite");
    for (const file of [gateFile, evidenceFile, codexFile, database, isolationPaths(root).config]) {
      await assertPhysicalIsolationBoundary(root, path.dirname(file));
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Certificate source must be a regular file");
    }
    const db = new DatabaseSync(database, { readOnly: true });
    try {
      if (db.prepare("SELECT COUNT(*) AS n FROM hub_leases").get().n
        || db.prepare("SELECT COUNT(*) AS n FROM hub_provider_runs WHERE status='running'").get().n
        || db.prepare("SELECT COUNT(*) AS n FROM execution_attempts WHERE status='running'").get().n) throw new Error("Active execution prevents certification");
    } finally { db.close(); }
    const raw = await fs.readFile(isolationPaths(root).config);
    const originalGate = await fs.readFile(gateFile);
    const originalEvidence = await fs.readFile(evidenceFile);
    const originalCodex = await fs.readFile(codexFile);
    const gate = JSON.parse(originalGate);
    if (exactHubAcceptanceScope(gate) !== hubAcceptanceScopes.claude || gate.status !== "suspended") throw new Error("Exact suspended Claude scope required");
    const config = JSON.parse(raw);
    validateIsolatedPaths(config, root);
    const oldEvidence = JSON.parse(originalEvidence);
    if (gate.providers?.claude?.evidencePath !== evidenceFile || gate.providers.claude.evidenceSha256 !== digest(originalEvidence)) throw new Error("Claude certificate changed");
    const options = { cwd: root, provider: "claude", agentId: "ifrim-backend", conversationId: gate.acceptanceConversationId,
      model: gate.acceptanceModel, reasoning: gate.acceptanceReasoning, accessMode: gate.acceptanceAccessMode };
    validateSuspendedDiagnosticCertificate(gate, oldEvidence, config, digest(raw), options);
    const agents = configuredAgentEntries(config).map((item) => item.id);
    if (agents.length !== 23 || new Set(agents).size !== 23 || !agents.includes("main") || !agents.includes("ifrim-backend")) throw new Error("All 23 certified roles required");
    await verifyReceipt(oldEvidence.receipt);
    const credentials = await inspectCredentials(config, options, oldEvidence.receipt.environment);
    const plugin = await inspectPlugin(root, oldEvidence.receipt.environment);
    const globalConfig = path.join(oldEvidence.receipt.environment.USERPROFILE, ".claude.json");
    for (const id of agents) assertNarrowClaudeRefresh(oldEvidence.agents[id], { ...credentials, pluginEvidence: plugin }, globalConfig);
    client = await connect(() => {}, config);
    const applied = await client.request("config.get", {}, { timeoutMs: 30000 });
    if (applied.valid !== true || applied.hash !== gate.gatewayConfigHash || !applied.configRevisionHash
      || applied.appliedConfigHash !== applied.configRevisionHash) throw new Error("Applied gateway revision changed");
    await client.stopAndWait(); client = null;
    if (!isDeepStrictEqual(credentials, await inspectCredentials(config, options, oldEvidence.receipt.environment))
      || !isDeepStrictEqual(plugin, await inspectPlugin(root, oldEvidence.receipt.environment))) throw new Error("Claude sources changed during certification");
    await verifyReceipt(oldEvidence.receipt);
    for (const [file, initial] of [[gateFile, originalGate], [evidenceFile, originalEvidence], [codexFile, originalCodex], [isolationPaths(root).config, raw]]) {
      if (digest(await fs.readFile(file)) !== digest(initial)) throw new Error("Certification changed concurrently");
    }
    const evidence = { ...oldEvidence, verifiedAt: new Date().toISOString(),
      agents: Object.fromEntries(agents.map((id) => [id, { ...credentials, pluginEvidence: plugin }])) };
    const data = JSON.stringify(evidence, null, 2);
    const next = { ...gate, providers: { ...gate.providers, claude: { ...gate.providers.claude, evidenceSha256: digest(data) } } };
    const stamp = new Date().toISOString().replaceAll(":", "-");
    const evidenceBackup = `${evidenceFile}.checkpoint-${stamp}`;
    const gateBackup = `${gateFile}.checkpoint-${stamp}`;
    await fs.copyFile(evidenceFile, evidenceBackup, fs.constants.COPYFILE_EXCL);
    await fs.copyFile(gateFile, gateBackup, fs.constants.COPYFILE_EXCL);
    const pendingEvidence = `${evidenceBackup}.next`;
    const pendingGate = `${gateBackup}.next`;
    await fs.writeFile(pendingEvidence, data, { flag: "wx" });
    await fs.writeFile(pendingGate, JSON.stringify(next, null, 2), { flag: "wx" });
    await fs.rename(pendingEvidence, evidenceFile);
    await fs.rename(pendingGate, gateFile);
    return { status: "suspended", provider: "claude", certifiedAgents: agents.length, evidenceBackup, gateBackup,
      globalVerifiedAtUnchanged: next.verifiedAt === gate.verifiedAt, codexEvidenceUnchanged: true, modelStarted: false };
  } finally { try { if (client) await client.stopAndWait().catch(() => {}); } finally { await release(); } }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] !== "--approved-hub-018") throw new Error("Approval required");
  console.log(JSON.stringify(await refreshHubClaudeEvidence(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."))));
}
