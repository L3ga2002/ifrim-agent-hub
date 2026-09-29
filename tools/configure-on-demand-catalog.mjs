import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { acquireSubscriptionMaintenanceLock } from "./subscription-maintenance-lock.mjs";
import { isolationPaths, validateIsolatedPaths } from "../apps/api/src/subscription-isolation.mjs";
import { digest, validateAuthConfiguration } from "../apps/api/src/subscription-auth.mjs";

if (process.argv[2] !== "--approved-hub-018" || process.platform !== "win32") throw new Error("Approved Windows maintenance required");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = isolationPaths(root);
const release = await acquireSubscriptionMaintenanceLock(root);
try {
  const assertStopped = async () => {
    const gate = JSON.parse(await fs.readFile(path.join(root, ".ifrim/private/openclaw-subscription-gate.json"), "utf8"));
    if (gate.status !== "suspended") throw new Error("Suspend execution before catalog maintenance");
    const receipt = JSON.parse((await fs.readFile(path.join(root, ".ifrim/private/subscription-gateway-receipt.json"), "utf8")).replace(/^\uFEFF/, ""));
    if (receipt.projectRoot !== root || !Number.isSafeInteger(receipt.pid) || receipt.pid <= 0) throw new Error("Invalid isolated receipt");
    const command = `$ErrorActionPreference='Stop'; if(Get-CimInstance Win32_Process -Filter 'ProcessId=${receipt.pid}' -ErrorAction Stop){throw 'Gateway alive'}; if(Get-CimInstance Win32_Process -Filter 'ParentProcessId=${receipt.pid}' -ErrorAction Stop){throw 'Children alive'}; if(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object LocalPort -In 18789,18790){throw 'Gateway listener alive'}; Write-Output 'stopped'`;
    const result = await promisify(execFile)("powershell.exe", ["-NoProfile", "-Command", command], { windowsHide: true, timeout: 60000 });
    if (result.stdout.trim() !== "stopped") throw new Error("Gateway stop is unverified");
  };
  await assertStopped();
  const raw = await fs.readFile(target.config);
  const config = JSON.parse(raw.toString("utf8"));
  config.plugins.entries.codex.config.sessionCatalog = { ...config.plugins.entries.codex.config.sessionCatalog, enabled: false };
  validateIsolatedPaths(config, root);
  validateAuthConfiguration(config);
  const temporary = path.join(target.state, `on-demand-catalog-${Date.now()}.json`);
  await fs.writeFile(temporary, JSON.stringify(config, null, 2) + "\n", { flag: "wx" });
  await assertStopped();
  const stat = await fs.lstat(target.config);
  if (!stat.isFile() || stat.isSymbolicLink() || digest(await fs.readFile(target.config)) !== digest(raw)) throw new Error("Configuration changed during maintenance");
  await fs.rename(temporary, target.config);
  console.log(JSON.stringify({ status: "native-import-disabled", roles: 23, gatewayStarted: false, modelInvoked: false }));
} finally { await release(); }
