import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isolationPaths, assertPhysicalIsolationBoundary, validateIsolatedPaths } from "../apps/api/src/subscription-isolation.mjs";
import { validateAuthConfiguration, digest } from "../apps/api/src/subscription-auth.mjs";
import { acquireSubscriptionMaintenanceLock } from "./subscription-maintenance-lock.mjs";

if (process.argv[2] !== "--approved-hub-018" || process.platform !== "win32") throw new Error("Approved Windows HUB-018 maintenance required");
const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseMaintenanceLock = await acquireSubscriptionMaintenanceLock(root);
try {
const target = isolationPaths(root);
await assertPhysicalIsolationBoundary(root, target.state);
const configStat = await fs.lstat(target.config);
if (!configStat.isFile() || configStat.isSymbolicLink()) throw new Error("Configuration must be a regular file");
const raw = await fs.readFile(target.config);
const config = JSON.parse(raw.toString("utf8"));
validateIsolatedPaths(config, root);
validateAuthConfiguration(config);
const gate = JSON.parse(await fs.readFile(path.join(root, ".ifrim/private/openclaw-subscription-gate.json"), "utf8"));
if (gate.status !== "suspended") throw new Error("Execution gate must be suspended during maintenance");
const receipt = JSON.parse((await fs.readFile(path.join(root, ".ifrim/private/subscription-gateway-receipt.json"), "utf8")).replace(/^\uFEFF/, ""));
if (receipt.projectRoot !== root || receipt.configSha256 !== digest(raw)) throw new Error("Configuration differs from checkpointed launch receipt");
if (!Number.isSafeInteger(receipt.pid) || receipt.pid <= 0) throw new Error("Invalid prior Gateway identity");
async function assertStopped() {
const { stdout: listeners } = await exec("powershell.exe", ["-NoProfile", "-Command",
  `$ErrorActionPreference='Stop'; if(Get-CimInstance Win32_Process -Filter 'ProcessId=${receipt.pid}' -ErrorAction Stop){throw 'Prior Gateway process must exit'}; if(Get-CimInstance Win32_Process -Filter 'ParentProcessId=${receipt.pid}' -ErrorAction Stop){throw 'Prior Gateway children must exit'}; $p=Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object LocalPort -In 18789,18790; if($p){throw 'Gateway must be stopped'}; Write-Output 'stopped'`], { windowsHide: true, timeout: 60000 });
if (listeners.trim() !== "stopped") throw new Error("Listener absence was not verified");
}
await assertStopped();
const packages = path.join(target.state, "npm/projects/openclaw-codex-8902d781d4/node_modules");
const pkg = JSON.parse(await fs.readFile(path.join(packages, "@openai/codex/package.json"), "utf8"));
if (pkg.name !== "@openai/codex" || pkg.version !== "0.155.1") throw new Error("Supported native runtime revision differs");
const binary = path.join(packages, "@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe");
await assertPhysicalIsolationBoundary(root, path.dirname(binary));
if (!(await fs.lstat(binary)).isFile() || (await fs.lstat(binary)).isSymbolicLink()) throw new Error("Native executable must be a regular file");
const { stdout: version } = await exec(binary, ["--version"], { windowsHide: true, timeout: 30000 });
if (version.trim() !== "codex-cli 0.155.1") throw new Error("Native binary version differs");
const previous = config.plugins.entries.codex.config.appServer.command;
if (previous !== path.join(process.env.LOCALAPPDATA, "OpenAI/Codex/bin/faa963e871dd422c/codex.exe")) throw new Error("Unexpected prior native command; review required");
config.plugins.entries.codex.config.appServer.command = binary;
validateAuthConfiguration(config);
validateIsolatedPaths(config, root);
if (digest(await fs.readFile(target.config)) !== digest(raw)) throw new Error("Configuration changed during maintenance");
const checkpoint = path.join(target.state, "checkpoints", `supported-codex-${Date.now()}`);
await assertPhysicalIsolationBoundary(root, checkpoint);
await fs.mkdir(checkpoint);
await assertPhysicalIsolationBoundary(root, checkpoint);
await fs.writeFile(path.join(checkpoint, "openclaw.json"), raw, { flag: "wx" });
const temporary = path.join(target.state, `openclaw-supported-${Date.now()}.json`);
await fs.writeFile(temporary, JSON.stringify(config, null, 2) + "\n", { flag: "wx" });
const currentStat = await fs.lstat(target.config);
if (!currentStat.isFile() || currentStat.isSymbolicLink() || digest(await fs.readFile(target.config)) !== digest(raw)) throw new Error("Configuration changed before atomic replacement");
const currentGate = JSON.parse(await fs.readFile(path.join(root, ".ifrim/private/openclaw-subscription-gate.json"), "utf8"));
if (currentGate.status !== "suspended") throw new Error("Execution gate changed during maintenance");
await assertStopped();
await fs.rename(temporary, target.config);
console.log(JSON.stringify({ status: "supported-native-command-selected", version: version.trim(), checkpoint, gatewayStarted: false, modelInvoked: false }));
} finally {
  await releaseMaintenanceLock();
}
