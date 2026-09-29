import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { isDeepStrictEqual } from "node:util";
import { connectOpenClaw } from "../apps/api/src/openclaw-gateway.mjs";
import { digest, verifyGatewayReceipt, validateAuthConfiguration } from "../apps/api/src/subscription-auth.mjs";
import { isolationPaths, validateIsolatedPaths, assertPhysicalIsolationBoundary } from "../apps/api/src/subscription-isolation.mjs";
import { configuredAgentEntries } from "../apps/api/src/openclaw-config.mjs";
import { validateSuspendedDiagnosticCertificate } from "../apps/api/src/existing-session-diagnostic.mjs";
import { exactHubAcceptanceScope, hubAcceptanceScopes, targetHubAcceptanceCertificate } from "../apps/api/src/hub-acceptance-scope.mjs";
import { bootstrapDisabledConfig } from "./disable-hub-workspace-bootstrap.mjs";
import { acquireSubscriptionMaintenanceLock } from "./subscription-maintenance-lock.mjs";

const hubRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checkpointSuffix = "2026-09-29T16-32-34.832Z";
const ownerLockId = "LOCK-mumsn13e-2kew8n";
const json = (raw) => JSON.parse(raw.toString("utf8").replace(/^\uFEFF/, ""));
const sameIdentity = (a, b) => ["dev", "ino", "mode", "nlink", "size", "mtimeMs", "ctimeMs"].every((key) => a[key] === b[key]);

export function assertBootstrapReconciliationDelta(previous, current) {
  if (!isDeepStrictEqual(bootstrapDisabledConfig(previous), current)) throw new Error("Only the approved skipBootstrap delta may be reconciled");
}

export function assertAppliedBootstrapConfiguration(snapshot, projectedConfig, baselineHash) {
  if (snapshot?.valid !== true || !snapshot.hash || snapshot.hash === baselineHash
    || !snapshot.configRevisionHash || snapshot.appliedConfigHash !== snapshot.configRevisionHash
    || snapshot.config?.agents?.defaults?.skipBootstrap !== true
    || !isDeepStrictEqual(snapshot.parsed, projectedConfig)) {
    throw new Error("The exact bootstrap-disabled configuration is not live and applied");
  }
}

export function bootstrapReconciledReceipt(receipt, configSha256, applied, checkpoints, at) {
  if (typeof configSha256 !== "string" || !/^[a-f0-9]{64}$/.test(configSha256)) {
    throw new Error("New receipt configuration SHA-256 must be a complete lowercase digest");
  }
  const candidate = { ...receipt, configSha256, configurationUpdate: {
    at, reason: "HUB-018 reconcile bootstrap configuration after native internal recovery",
    previousConfigSha256: receipt.configSha256,
    previousConfigurationUpdate: receipt.configurationUpdate ?? null,
    appliedConfigRevisionHash: applied.configRevisionHash, gatewayConfigHash: applied.hash,
    internalGatewayRecovery: true, osProcessIdentityUnchanged: true,
    recovery: { kind: "native-internal-SIGUSR2-recovery", observation: "owner-reported",
      sameProcessIdentityVerified: true, processReplaced: false },
    originalCheckpointSuffix: checkpointSuffix, ...checkpoints,
  } };
  const { configSha256: oldHash, configurationUpdate: _oldUpdate, ...originalIdentity } = receipt;
  const { configSha256: newHash, configurationUpdate: newUpdate, ...candidateIdentity } = candidate;
  if (!/^[a-f0-9]{64}$/i.test(newHash) || !isDeepStrictEqual(originalIdentity, candidateIdentity)
    || oldHash === newHash || !newUpdate || newHash !== configSha256) {
    throw new Error("Receipt identity or approved configuration delta changed");
  }
  return candidate;
}

function assertIdleOwner(database, root) {
  const db = new DatabaseSync(database, { readOnly: true });
  try {
    if (db.prepare("SELECT COUNT(*) AS n FROM hub_leases").get().n
      || db.prepare("SELECT COUNT(*) AS n FROM hub_provider_runs WHERE status='running'").get().n
      || db.prepare("SELECT COUNT(*) AS n FROM execution_attempts WHERE status='running'").get().n) throw new Error("Active work prevents receipt reconciliation");
    const lock = db.prepare("SELECT id,project_slug,task_id,lock_type,status,owner,expires_at,created_at,updated_at FROM locks WHERE id=?").get(ownerLockId);
    const task = db.prepare("SELECT id,project_slug,status FROM tasks WHERE id=?").get("HUB-018");
    if (root !== hubRoot || lock?.project_slug !== "ifrim-agent-hub" || lock.task_id !== "HUB-018"
      || lock.lock_type !== "exclusive" || lock.status !== "active" || !lock.owner
      || lock.expires_at && (!Number.isFinite(Date.parse(lock.expires_at)) || Date.parse(lock.expires_at) <= Date.now())
      || task?.project_slug !== "ifrim-agent-hub" || task.status !== "in_progress"
      || db.prepare("SELECT COUNT(*) AS n FROM locks WHERE project_slug='ifrim-agent-hub' AND lock_type='exclusive' AND status='active' AND id<>?").get(ownerLockId).n) {
      throw new Error("Exact active HUB-018 owner lock required");
    }
    return { lock, task };
  } finally { db.close(); }
}

async function projectInstalledConfiguration(config, receipt) {
  const dist = path.join(receipt.environment.APPDATA, "npm/node_modules/openclaw/dist");
  const { t: redactConfigObject } = await import(pathToFileURL(path.join(dist, "redact-snapshot-BpJeMUTt.mjs")).href);
  return redactConfigObject(config);
}

export async function reconcileHubBootstrapReceipt(root, {
  files = fs, boundary = assertPhysicalIsolationBoundary, acquireLock = acquireSubscriptionMaintenanceLock,
  verifyReceipt = verifyGatewayReceipt, connect = connectOpenClaw, idleOwner = assertIdleOwner,
  projectConfig = projectInstalledConfiguration, now = () => new Date(),
} = {}) {
  root = path.resolve(root);
  if (root !== hubRoot) throw new Error("Receipt reconciliation is restricted to this Hub checkout");
  const target = isolationPaths(root);
  const privateDir = path.join(root, ".ifrim/private");
  const receiptFile = path.join(privateDir, "subscription-gateway-receipt.json");
  const gateFile = path.join(privateDir, "openclaw-subscription-gate.json");
  const database = path.join(privateDir, "agent-hub.sqlite");
  const lockFile = path.join(target.state, "maintenance.lock");
  const originals = { config: `${target.config}.checkpoint-bootstrap-${checkpointSuffix}`,
    receipt: `${receiptFile}.checkpoint-bootstrap-${checkpointSuffix}`,
    gate: `${gateFile}.checkpoint-bootstrap-${checkpointSuffix}` };
  const sources = new Map();
  let client;
  const regular = async (file) => {
    await boundary(root, path.dirname(file));
    const stat = await files.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1
      || (await files.realpath(file)).toLowerCase() !== path.resolve(file).toLowerCase()) throw new Error("Maintenance source must be a physical regular single-link file");
    return stat;
  };
  const read = async (file, tracked = true) => {
    const before = await regular(file);
    const raw = await files.readFile(file);
    if (!sameIdentity(before, await regular(file))) throw new Error("Maintenance source changed during read");
    if (tracked) sources.set(file, { raw, stat: before });
    return raw;
  };
  const unchanged = async () => {
    for (const [file, initial] of sources) {
      const before = await regular(file);
      if (!sameIdentity(before, initial.stat) || digest(await files.readFile(file)) !== digest(initial.raw)
        || !sameIdentity(before, await regular(file))) throw new Error("Maintenance sources changed concurrently");
    }
  };
  await boundary(root, target.state);
  const release = await acquireLock(root);
  try {
    await read(lockFile);
    await regular(database);
    const owner = idleOwner(database, root);
    const configRaw = await read(target.config), receiptRaw = await read(receiptFile), gateRaw = await read(gateFile);
    const previousRaw = await read(originals.config), previousReceiptRaw = await read(originals.receipt), previousGateRaw = await read(originals.gate);
    if (!receiptRaw.equals(previousReceiptRaw) || !gateRaw.equals(previousGateRaw)) throw new Error("Original receipt/gate checkpoints no longer match");
    const previous = json(previousRaw), config = json(configRaw), receipt = json(receiptRaw), gate = json(gateRaw);
    if (receipt.projectRoot !== root || receipt.pid !== 23596 || !receipt.startedAt
      || receipt.configSha256 !== digest(previousRaw) || gate.configSha256 !== digest(previousRaw)
      || exactHubAcceptanceScope(gate) !== hubAcceptanceScopes.claude || gate.status !== "suspended"
      || !gate.gatewayConfigHash) throw new Error("Original suspended Claude baseline is not bound to the owned receipt");
    const redactorFile = path.join(receipt.environment.APPDATA, "npm/node_modules/openclaw/dist/redact-snapshot-BpJeMUTt.mjs");
    const redactorBefore = await files.lstat(redactorFile);
    if (!redactorBefore.isFile() || redactorBefore.isSymbolicLink() || redactorBefore.nlink !== 1) throw new Error("Official redaction module changed");
    const redactorDigest = digest(await files.readFile(redactorFile));
    assertBootstrapReconciliationDelta(previous, config);
    validateIsolatedPaths(previous, root); validateAuthConfiguration(previous);
    validateIsolatedPaths(config, root); validateAuthConfiguration(config);
    const agents = configuredAgentEntries(config).map((entry) => entry.id);
    if (agents.length !== 23 || new Set(agents).size !== 23 || !agents.includes("main") || !agents.includes("ifrim-backend")) throw new Error("All 23 native roles must be preserved");
    for (const provider of ["codex", "claude"]) {
      const evidenceFile = path.join(privateDir, `openclaw-${provider}-auth-evidence.json`);
      const proof = gate.providers?.[provider];
      const evidenceRaw = await read(evidenceFile), evidence = json(evidenceRaw);
      if (proof?.evidencePath !== evidenceFile || proof.evidenceSha256 !== digest(evidenceRaw)
        || !isDeepStrictEqual(evidence.receipt, receipt) || !isDeepStrictEqual(Object.keys(evidence.agents || {}).sort(), [...agents].sort())) {
        throw new Error("Original subscription certificate/receipt roster changed");
      }
      const scope = hubAcceptanceScopes[provider];
      validateSuspendedDiagnosticCertificate(targetHubAcceptanceCertificate(gate, provider), evidence, previous, digest(previousRaw), {
        cwd: root, provider, agentId: "ifrim-backend", conversationId: scope.acceptanceConversationId,
        model: scope.acceptanceModel, reasoning: scope.acceptanceReasoning, accessMode: scope.acceptanceAccessMode,
      });
    }
    for (const relative of ["tools/reconcile-hub-bootstrap-receipt.mjs", "tools/disable-hub-workspace-bootstrap.mjs",
      "tools/subscription-maintenance-lock.mjs", "apps/api/src/subscription-auth.mjs", "apps/api/src/subscription-isolation.mjs",
      "apps/api/src/openclaw-gateway.mjs", "apps/api/src/openclaw-config.mjs", "apps/api/src/hub-acceptance-scope.mjs",
      "apps/api/src/existing-session-diagnostic.mjs", "apps/api/src/openclaw-subscription-gate.mjs",
      "tools/hidden-gateway-preload.mjs", "apps/api/src/hidden-child-process.mjs", "apps/api/src/gateway-rpc-diagnostics.mjs"]) await read(path.join(root, relative));
    const at = now().toISOString(), stamp = at.replaceAll(":", "-");
    const checkpoints = { configBackup: `${target.config}.checkpoint-reconcile-bootstrap-${stamp}`,
      receiptBackup: `${receiptFile}.checkpoint-reconcile-bootstrap-${stamp}`, gateBackup: `${gateFile}.checkpoint-reconcile-bootstrap-${stamp}` };
    // The old receipt deliberately binds the pre-change config. Verify only a narrowly derived candidate against the live process.
    const identityCandidate = { ...receipt, configSha256: digest(configRaw) };
    await unchanged();
    await verifyReceipt(identityCandidate);
    const projected = await projectConfig(config, receipt);
    client = await connect(() => {}, config);
    const applied = await client.request("config.get", {}, { timeoutMs: 30000 });
    assertAppliedBootstrapConfiguration(applied, projected, gate.gatewayConfigHash);
    const candidate = bootstrapReconciledReceipt(receipt, digest(configRaw), applied, { ...checkpoints,
      originalConfigBackup: originals.config, originalReceiptBackup: originals.receipt, originalGateBackup: originals.gate,
      ownerLockId }, at);
    await verifyReceipt(candidate);
    await unchanged();
    if (!isDeepStrictEqual(owner, idleOwner(database, root))) throw new Error("Owner lock/task changed during reconciliation");
    for (const [file, backup] of [[target.config, checkpoints.configBackup], [receiptFile, checkpoints.receiptBackup], [gateFile, checkpoints.gateBackup]]) {
      await boundary(root, path.dirname(backup));
      await files.copyFile(file, backup, fs.constants.COPYFILE_EXCL);
      if (!(await read(backup)).equals(sources.get(file).raw)) throw new Error("Reconciliation checkpoint changed");
    }
    const temporary = `${checkpoints.receiptBackup}.next`;
    const data = Buffer.from(JSON.stringify(candidate, null, 2) + "\n");
    await boundary(root, path.dirname(temporary));
    const handle = await files.open(temporary, "wx", 0o600);
    try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
    if (!(await read(temporary)).equals(data)) throw new Error("Pending receipt changed");
    const final = await client.request("config.get", {}, { timeoutMs: 30000 });
    assertAppliedBootstrapConfiguration(final, projected, gate.gatewayConfigHash);
    if (final.hash !== applied.hash || final.configRevisionHash !== applied.configRevisionHash) throw new Error("Applied revision changed during reconciliation");
    await verifyReceipt(candidate);
    await regular(database);
    if (!sameIdentity(redactorBefore, await files.lstat(redactorFile)) || digest(await files.readFile(redactorFile)) !== redactorDigest) {
      throw new Error("Official redaction module changed during reconciliation");
    }
    if (!isDeepStrictEqual(owner, idleOwner(database, root))) throw new Error("Owner lock/task changed before receipt publication");
    await unchanged();
    await files.rename(temporary, receiptFile);
    return { status: "receipt-reconciled-gate-suspended", pid: candidate.pid, startedAt: candidate.startedAt,
      skipBootstrap: true, recovery: "native-internal-SIGUSR2-owner-reported", sameProcessIdentityVerified: true,
      internalGatewayRecovery: true, osProcessIdentityUnchanged: true,
      ...checkpoints, modelStarted: false, subscriptionsRecertified: false };
  } finally {
    try { if (client) await client.stopAndWait(); } finally { await release(); }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] !== "--approved-hub-018" || process.argv.length !== 3 || process.platform !== "win32") throw new Error("Explicit Windows HUB-018 reconciliation approval required");
  try { console.log(JSON.stringify(await reconcileHubBootstrapReceipt(hubRoot))); }
  catch { console.error("HUB-018 receipt reconciliation failed; gate remains suspended. Review guarded source/checkpoints; do not retry automatically."); process.exitCode = 1; }
}
