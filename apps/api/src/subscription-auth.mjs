import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { parse as parseToml } from "smol-toml";
import { isolatedProfileId, isolationPaths } from "./subscription-isolation.mjs";
import { inspectIsolatedPlugin } from "./isolated-plugin-evidence.mjs";

const exec = promisify(execFile);
export const subscriptionProfiles = { codex: isolatedProfileId, claude: "anthropic:claude-cli" };
const unsafe = /api.?key|api.?token|auth.?token|base.?url|custom.?headers|oauth.?token|file_descriptor|use_bedrock|use_vertex|use_foundry|preserve_env|load_shell_env/i;
export const digest = (value) => createHash("sha256").update(value).digest("hex");

export function validateStartupProfiles(store) {
  for (const [id, profile] of Object.entries(store?.profiles || {})) {
    if (profile.type !== "oauth" || !["openai", "anthropic"].includes(profile.provider)) {
      throw new Error(`Startup blocked: non-subscription credential is accessible (${profile.provider || "unknown"}/${id}); preserve it and isolate the runtime before restart`);
    }
  }
}

export function validateAuthConfiguration(config) {
  if (JSON.stringify(config).includes('"$include"')) throw new Error("Included configuration requires a separate subscription audit");
  if (config.env && Object.keys(config.env).length) throw new Error("Gateway environment overrides require a separate subscription audit");
  const server = config.plugins?.entries?.codex?.config?.appServer || {};
  if ((server.homeScope || "agent") !== "agent" || (server.transport || "stdio") !== "stdio" || server.args?.length) throw new Error("Codex subscription isolation was changed");
  if (!server.command || !path.isAbsolute(server.command)) throw new Error("Codex executable is not explicitly bound");
  if (Object.keys(config.models?.providers || {}).length) throw new Error("Custom provider configuration requires a separate subscription audit; API routes are not allowed");
}

export function validateClaudeStatus(status) {
  if (!status?.loggedIn || status.authMethod !== "claude.ai" || status.apiProvider !== "firstParty" || !["max", "pro"].includes(status.subscriptionType)) {
    throw new Error("Claude local subscription login is not usable");
  }
}

export function validateOAuthProfile(profile) {
  if (profile?.type !== "oauth" || profile.provider !== "openai" || !profile.access || !profile.refresh
    || !profile.accountId || !profile.chatgptPlanType || !Number.isFinite(profile.expires) || profile.expires <= Date.now()) {
    throw new Error("OpenClaw ChatGPT OAuth login needs refresh or reauthentication; API fallback is forbidden");
  }
}

async function optionalFile(file) {
  try { return await fs.readFile(file); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

export async function inspectSubscriptionSources(config, options, gatewayEnvironment) {
  validateAuthConfiguration(config);
  if (!gatewayEnvironment?.OPENCLAW_STATE_DIR || !gatewayEnvironment.APPDATA || !gatewayEnvironment.USERPROFILE) throw new Error("Gateway authentication environment provenance is missing");
  const pluginEvidence = await inspectIsolatedPlugin(options.cwd, gatewayEnvironment);
  return { ...await inspectSubscriptionCredentialSources(config, options, gatewayEnvironment), pluginEvidence };
}

// Certification batches share plugin evidence, but audit every agent's credentials.
export async function inspectSubscriptionCredentialSources(config, options, gatewayEnvironment) {
  validateAuthConfiguration(config);
  if (!gatewayEnvironment?.OPENCLAW_STATE_DIR || !gatewayEnvironment.APPDATA || !gatewayEnvironment.USERPROFILE) throw new Error("Gateway authentication environment provenance is missing");
  const home = gatewayEnvironment.OPENCLAW_STATE_DIR;
  if (await optionalFile(path.join(home, ".env"))) throw new Error("Global OpenClaw dotenv requires a separate environment audit");
  const sources = {};
  const openclaw = path.join(gatewayEnvironment.APPDATA, "npm", "node_modules", "openclaw");
  const pkg = JSON.parse(await fs.readFile(path.join(openclaw, "package.json"), "utf8"));
  if (pkg.version !== "2026.9.6") throw new Error("Native runtime revision requires recertification");
  for (const file of ["dist/cli-backend-CP9ybtr0.mjs", "dist/cli-constants-0f4y8Jm6.mjs", "dist/cli-backend-auth-policy-BJQR9lNK.mjs", "dist/execute.runtime-BL72Bi6q.mjs"]) {
    sources[path.join(openclaw, file)] = digest(await fs.readFile(path.join(openclaw, file)));
  }
  const binary = options.provider === "codex" ? config.plugins.entries.codex.config.appServer.command
    : path.join(gatewayEnvironment.APPDATA, "npm", "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe");
  sources[binary] = digest(await fs.readFile(binary));
  if (options.provider === "codex") {
    const sdk = await import(pathToFileURL(path.join(openclaw, "dist", "plugin-sdk", "agent-runtime.js")));
    const agentDir = sdk.resolveAgentDir(config, options.agentId, gatewayEnvironment);
    sdk.clearRuntimeAuthProfileStoreSnapshots();
    const store = sdk.loadAuthProfileStoreForRuntime(agentDir, { config, profileId: subscriptionProfiles.codex,
      readOnly: true, syncExternalCli: false, externalCli: { mode: "none" } }, gatewayEnvironment);
    validateStartupProfiles(store);
    if (Object.keys(store.profiles).length !== 1) throw new Error("Isolated credential store must contain only the approved subscription profile");
    const profile = store.profiles[subscriptionProfiles.codex];
    validateOAuthProfile(profile);
    for (const file of [path.join(agentDir, "codex-home", "config.toml"), path.join(options.cwd, ".codex", "config.toml")]) {
      const raw = await optionalFile(file);
      sources[file] = raw ? digest(raw) : "absent";
      if (raw) {
        if (raw.length > 65536) throw new Error("Codex configuration exceeds the subscription audit size limit");
        const settings = parseToml(raw.toString("utf8"), { unsafeKeyBehaviour: "throw" });
        if (settings.model_providers || settings.model_provider && settings.model_provider !== "openai" || settings.forced_login_method && settings.forced_login_method !== "chatgpt") throw new Error("Codex provider overrides require recertification");
      }
    }
  } else {
    for (const file of [path.join(gatewayEnvironment.USERPROFILE, ".claude", "settings.json"), path.join(gatewayEnvironment.USERPROFILE, ".claude.json"),
      path.join(gatewayEnvironment.ProgramFiles || "C:/Program Files", "ClaudeCode", "managed-settings.json"),
      path.join(options.cwd, ".claude", "settings.json"), path.join(options.cwd, ".claude", "settings.local.json")]) {
      const raw = await optionalFile(file);
      sources[file] = raw ? digest(raw) : "absent";
      if (raw) {
        const settings = JSON.parse(raw.toString("utf8"));
        if (settings.apiKeyHelper || settings.primaryApiKey || Object.keys(settings.env || {}).some((key) => unsafe.test(key))) throw new Error("Claude API authentication/settings override is not allowed");
      }
    }
    if (!gatewayEnvironment || gatewayEnvironment.CLAUDE_CONFIG_DIR) throw new Error("Native Claude environment provenance is missing");
    const spawn = await import(pathToFileURL(path.join(openclaw, "dist", "windows-spawn-CR3vyrK9.mjs")));
    const program = spawn.a({ command: "claude", env: gatewayEnvironment, packageName: "@anthropic-ai/claude-code", execPath: process.execPath });
    if (path.resolve(program.command).toLowerCase() !== path.resolve(binary).toLowerCase() || program.leadingArgv.length) throw new Error("Gateway Claude executable differs from the certified native binary");
    const { stdout } = await exec(binary, ["auth", "status", "--json"], { cwd: options.cwd, env: gatewayEnvironment, windowsHide: true, timeout: 10000 });
    validateClaudeStatus(JSON.parse(stdout));
  }
  return { sources, runtimeVersion: pkg.version, profileId: subscriptionProfiles[options.provider] };
}

export async function verifyGatewayReceipt(receipt) {
  if (!receipt?.pid || !receipt.startedAt || receipt.environmentPolicy !== "allowlist-subscription-only-v1") throw new Error("Controlled Gateway launch evidence is missing");
  if (receipt.port !== 18790 || !receipt.projectRoot) throw new Error("Isolated Gateway receipt is required");
  const isolated = isolationPaths(receipt.projectRoot);
  if (path.resolve(receipt.environment?.OPENCLAW_STATE_DIR || "") !== isolated.state || path.resolve(receipt.environment?.OPENCLAW_CONFIG_PATH || "") !== isolated.config || path.resolve(receipt.workingDirectory || "") !== isolated.state) throw new Error("Gateway receipt escapes isolated state");
  const allowed = new Set(['SystemRoot','WINDIR','COMSPEC','USERPROFILE','USERNAME','USERDOMAIN','APPDATA','LOCALAPPDATA','TEMP','TMP','ProgramFiles','ProgramFiles(x86)','ProgramData','HOMEDRIVE','HOMEPATH','PATH','OPENCLAW_STATE_DIR','OPENCLAW_CONFIG_PATH','OPENCLAW_LOAD_SHELL_ENV','OPENCLAW_SKIP_CRON','OPENCLAW_LIVE_CLI_BACKEND_PRESERVE_ENV'].map((key) => key.toLowerCase()));
  if (!receipt.environment || Object.keys(receipt.environment).some((key) => !allowed.has(key.toLowerCase()))
    || receipt.environment.OPENCLAW_LIVE_CLI_BACKEND_PRESERVE_ENV || receipt.environment.OPENCLAW_LOAD_SHELL_ENV !== '0' || receipt.environment.OPENCLAW_SKIP_CRON !== '1') throw new Error("Gateway launch environment is not subscription-only with scheduled runs disabled");
  const preload = path.join(receipt.projectRoot, "tools", "hidden-gateway-preload.mjs");
  if (receipt.preloadPath !== preload || !receipt.preloadSha256 || !receipt.childPolicySha256
    || digest(await fs.readFile(preload)) !== receipt.preloadSha256
    || digest(await fs.readFile(path.join(receipt.projectRoot, "apps/api/src/hidden-child-process.mjs"))) !== receipt.childPolicySha256) {
    throw new Error("Hidden isolated Gateway child policy is not certified");
  }
  if (!receipt.rpcDiagnosticsSha256 || digest(await fs.readFile(path.join(receipt.projectRoot, "apps/api/src/gateway-rpc-diagnostics.mjs"))) !== receipt.rpcDiagnosticsSha256) {
    throw new Error("Isolated Gateway diagnostic policy is not certified");
  }
  const script = `$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class HubCommandLine {
  [DllImport("shell32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern IntPtr CommandLineToArgvW(string text, out int count);
  [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr pointer);
  public static string[] Parse(string text) {
    int count; var pointer=CommandLineToArgvW(text,out count);
    if(pointer==IntPtr.Zero) throw new System.ComponentModel.Win32Exception();
    try {
      var args=new string[count];
      for(int i=0;i<count;i++) args[i]=Marshal.PtrToStringUni(Marshal.ReadIntPtr(pointer,i*IntPtr.Size));
      return args;
    } finally { LocalFree(pointer); }
  }
}
'@
$p=Get-Process -Id ${Number(receipt.pid)} -ErrorAction Stop
$w=Get-CimInstance Win32_Process -Filter 'ProcessId=${Number(receipt.pid)}' -ErrorAction Stop
$listener=Get-NetTCPConnection -LocalPort 18790 -State Listen -ErrorAction Stop
@{startedAt=$p.StartTime.ToUniversalTime().ToString('o');path=$p.Path;arguments=@([HubCommandLine]::Parse($w.CommandLine));owners=@($listener.OwningProcess)} | ConvertTo-Json -Compress`;
  const { stdout } = await exec("powershell.exe", ["-NoProfile", "-Command", script], { windowsHide: true, timeout: 60000 });
  const current = JSON.parse(stdout);
  if (Date.parse(current.startedAt) !== Date.parse(receipt.startedAt) || current.path.toLowerCase() !== receipt.executable.toLowerCase()
    || digest(await fs.readFile(current.path)) !== receipt.executableSha256 || !current.owners?.includes(receipt.pid)
    || !Array.isArray(current.arguments) || current.arguments.length !== 8
    || current.arguments.some((value, index) => value !== [receipt.executable, '--import', pathToFileURL(preload).href, receipt.entrypoint, 'gateway', 'run', '--port', '18790'][index])
    || digest(await fs.readFile(receipt.entrypoint)) !== receipt.entrypointSha256
    || digest(await fs.readFile(receipt.environment.OPENCLAW_CONFIG_PATH)) !== receipt.configSha256) throw new Error("Gateway restarted or runtime identity changed; recertification required");
}
