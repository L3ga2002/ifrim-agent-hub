import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { isDeepStrictEqual } from "node:util";
import { connectOpenClaw } from "../apps/api/src/openclaw-gateway.mjs";
import { digest, verifyGatewayReceipt, validateAuthConfiguration } from "../apps/api/src/subscription-auth.mjs";
import { isolationPaths, validateIsolatedPaths, assertPhysicalIsolationBoundary } from "../apps/api/src/subscription-isolation.mjs";
import { acquireSubscriptionMaintenanceLock } from "./subscription-maintenance-lock.mjs";

export function bootstrapDisabledConfig(config) {
  if (!config?.agents?.defaults || ![undefined, false].includes(config.agents.defaults.skipBootstrap)) throw new Error("Expected existing bootstrap-enabled configuration");
  return { ...config, agents: { ...config.agents, defaults: { ...config.agents.defaults, skipBootstrap: true } } };
}

export async function disableHubWorkspaceBootstrap(root, { verifyReceipt = verifyGatewayReceipt, connect = connectOpenClaw,
  acquireLock = acquireSubscriptionMaintenanceLock, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), attempts = 60 } = {}) {
  const target = isolationPaths(root);
  const receiptFile = path.join(root, ".ifrim/private/subscription-gateway-receipt.json");
  const gateFile = path.join(root, ".ifrim/private/openclaw-subscription-gate.json");
  for (const file of [target.config, receiptFile, gateFile, path.join(root, ".ifrim/private/agent-hub.sqlite")]) {
    await assertPhysicalIsolationBoundary(root, path.dirname(file));
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Maintenance source must be a regular file");
  }
  const release = await acquireLock(root);
  let client;
  try {
    const gateRaw = await fs.readFile(gateFile);
    if (JSON.parse(gateRaw).status !== "suspended") throw new Error("Suspend execution before bootstrap maintenance");
    const db = new DatabaseSync(path.join(root, ".ifrim/private/agent-hub.sqlite"), { readOnly: true });
    try {
      if (db.prepare("SELECT COUNT(*) AS n FROM hub_leases").get().n
        || db.prepare("SELECT COUNT(*) AS n FROM hub_provider_runs WHERE status='running'").get().n
        || db.prepare("SELECT COUNT(*) AS n FROM execution_attempts WHERE status='running'").get().n) throw new Error("Active work prevents maintenance");
    } finally { db.close(); }
    const raw = await fs.readFile(target.config);
    const receiptRaw = await fs.readFile(receiptFile);
    const receipt = JSON.parse(receiptRaw.toString("utf8").replace(/^\uFEFF/, ""));
    await verifyReceipt(receipt);
    client = await connect(() => {}, JSON.parse(raw));
    const baseline = await client.request("config.get", {}, { timeoutMs: 30000 });
    if (baseline.valid !== true || baseline.hash !== JSON.parse(gateRaw).gatewayConfigHash
      || !baseline.configRevisionHash || baseline.appliedConfigHash !== baseline.configRevisionHash) throw new Error("Original applied configuration is not certified");
    const config = bootstrapDisabledConfig(JSON.parse(raw));
    validateIsolatedPaths(config, root); validateAuthConfiguration(config);
    const data = JSON.stringify(config, null, 2) + "\n";
    const stamp = new Date().toISOString().replaceAll(":", "-");
    const configBackup = `${target.config}.checkpoint-bootstrap-${stamp}`;
    const receiptBackup = `${receiptFile}.checkpoint-bootstrap-${stamp}`;
    const gateBackup = `${gateFile}.checkpoint-bootstrap-${stamp}`;
    for (const [file, backup] of [[target.config, configBackup], [receiptFile, receiptBackup], [gateFile, gateBackup]]) await fs.copyFile(file, backup, fs.constants.COPYFILE_EXCL);
    const pending = `${configBackup}.next`;
    await fs.writeFile(pending, data, { flag: "wx" });
    for (const [file, initial] of [[target.config, raw], [receiptFile, receiptRaw], [gateFile, gateRaw]]) {
      if (digest(await fs.readFile(file)) !== digest(initial)) throw new Error("Maintenance sources changed concurrently");
    }
    await fs.rename(pending, target.config);
    let applied;
    const deadline = Date.now() + 120000;
    for (let count = 0; count < attempts; count++) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error("Live bootstrap configuration deadline reached; gate remains suspended");
      applied = await client.request("config.get", {}, { timeoutMs: Math.min(30000, remaining) });
      if (applied.valid === true && applied.config?.agents?.defaults?.skipBootstrap === true
        && applied.configRevisionHash && applied.configRevisionHash !== baseline.configRevisionHash
        && applied.appliedConfigHash === applied.configRevisionHash) {
        if (!isDeepStrictEqual(applied.config, bootstrapDisabledConfig(baseline.config))) throw new Error("Live configuration has an unapproved delta");
        break;
      }
      if (count === attempts - 1) throw new Error("Live bootstrap configuration not confirmed; gate remains suspended");
      await wait(1000);
    }
    const candidate = { ...receipt, configSha256: digest(data),
      configurationUpdate: { at: new Date().toISOString(), reason: "HUB-018 disable automatic workspace templates",
        previousConfigSha256: receipt.configSha256, appliedConfigRevisionHash: applied.configRevisionHash, configBackup, receiptBackup } };
    await verifyReceipt(candidate);
    const final = await client.request("config.get", {}, { timeoutMs: 30000 });
    if (final.valid !== true || final.hash !== applied.hash || final.configRevisionHash !== applied.configRevisionHash
      || final.appliedConfigHash !== final.configRevisionHash || final.config?.agents?.defaults?.skipBootstrap !== true) throw new Error("Live configuration changed during maintenance");
    for (const [file, initial] of [[target.config, Buffer.from(data)], [receiptFile, receiptRaw], [gateFile, gateRaw]]) {
      if (digest(await fs.readFile(file)) !== digest(initial)) throw new Error("Maintenance sources changed concurrently");
    }
    const receiptPending = `${receiptBackup}.next`;
    await fs.writeFile(receiptPending, JSON.stringify(candidate, null, 2), { flag: "wx" });
    await fs.rename(receiptPending, receiptFile);
    return { status: "suspended", skipBootstrap: true, pid: candidate.pid, configBackup, receiptBackup, gateBackup, gatewayRestarted: false, modelStarted: false };
  } finally { try { if (client) await client.stopAndWait().catch(() => {}); } finally { await release(); } }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] !== "--approved-hub-018") throw new Error("Approval required");
  console.log(JSON.stringify(await disableHubWorkspaceBootstrap(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."))));
}
