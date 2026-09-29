import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildIsolatedSubscriptionConfig, isolationPaths, isolatedProfileId, validateIsolatedPaths, assertPhysicalIsolationBoundary } from "../apps/api/src/subscription-isolation.mjs";
import { validateAuthConfiguration, validateOAuthProfile, validateStartupProfiles } from "../apps/api/src/subscription-auth.mjs";
import { configuredAgentEntries } from "../apps/api/src/openclaw-config.mjs";

if (process.argv[2] !== "--approved-hub-018") throw new Error("Explicit HUB-018 approval required");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = isolationPaths(root);
await assertPhysicalIsolationBoundary(root, target.state);
try { await fs.access(target.state); throw new Error("Isolated state already exists; preserve it and inspect before reuse"); }
catch (error) { if (error.code !== "ENOENT") throw error; }
const sourceHome = path.join(process.env.USERPROFILE, ".openclaw");
const sourceRaw = await fs.readFile(path.join(sourceHome, "openclaw.json"));
const source = JSON.parse(sourceRaw.toString("utf8"));
const runtime = path.join(process.env.APPDATA, "npm", "node_modules", "openclaw", "dist");
const sdk = await import(pathToFileURL(path.join(runtime, "plugin-sdk", "agent-runtime.js")));
const sourceEnv = { ...process.env, OPENCLAW_STATE_DIR: sourceHome };
const sourceDir = sdk.resolveAgentDir(source, "ifrim-backend", sourceEnv);
sdk.clearRuntimeAuthProfileStoreSnapshots();
const sourceStore = sdk.loadAuthProfileStoreForRuntime(sourceDir, { config: source, readOnly: true, syncExternalCli: false, externalCli: { mode: "none" } }, sourceEnv);
const profile = sourceStore.profiles?.[isolatedProfileId];
validateOAuthProfile(profile);
let email = profile.email;
if (!email) { try { const claims = JSON.parse(Buffer.from(profile.access.split(".")[1], "base64url").toString()); email = claims["https://api.openai.com/profile"]?.email || claims.email; } catch {} }
if (email !== "ifrimcatalin30@gmail.com") throw new Error("Authenticated subscription identity differs from the approved account");
const config = buildIsolatedSubscriptionConfig(source, root, randomBytes(32).toString("hex"));
validateAuthConfiguration(config);
validateIsolatedPaths(config, root);
const { upsertAuthProfileWithLock: upsert } = await import(pathToFileURL(path.join(runtime, "plugin-sdk", "provider-auth.js")));
if (typeof upsert !== "function") throw new Error("Installed SDK profile persistence contract changed");
await fs.mkdir(target.state, { recursive: true });
await assertPhysicalIsolationBoundary(root, target.state);
if (process.platform !== "win32") throw new Error("Windows private-state ACL preparation required");
await promisify(execFile)(path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
  ["-NoProfile", "-NonInteractive", "-File", path.join(root, "tools", "protect-subscription-state.ps1")],
  { windowsHide: true, timeout: 30000 });
await fs.writeFile(target.config, JSON.stringify(config, null, 2), { flag: "wx", mode: 0o600 });
// The SDK receives an explicit state root; historical stores are never replaced.
const shared = await upsert({ profileId: isolatedProfileId, credential: structuredClone(profile), stateDir: target.state });
if (!shared) throw new Error("Isolated shared profile persistence failed; keep the staged state for diagnosis");
validateStartupProfiles(shared);
if (!shared.profiles?.[isolatedProfileId]) throw new Error("Persisted isolated subscription profile missing");
for (const agent of configuredAgentEntries(config)) {
  await fs.mkdir(agent.agentDir, { recursive: true });
  await fs.mkdir(agent.workspace, { recursive: true });
}
await fs.mkdir(config.agents.defaults.workspace, { recursive: true });
const isolatedEnv = { ...process.env, OPENCLAW_STATE_DIR: target.state, OPENCLAW_CONFIG_PATH: target.config };
sdk.clearRuntimeAuthProfileStoreSnapshots();
const readOptions = { config, readOnly: true, syncExternalCli: false, externalCli: { mode: "none" } };
const checkProfile = (store) => {
  validateStartupProfiles(store);
  const saved = store.profiles?.[isolatedProfileId];
  validateOAuthProfile(saved);
  if (Object.keys(store.profiles).length !== 1 || ["access", "refresh", "accountId", "expires"].some((key) => saved[key] !== profile[key])) throw new Error("Isolated credential recitation differs from the approved subscription");
};
checkProfile(sdk.loadAuthProfileStoreForRuntime(undefined, readOptions, isolatedEnv));
for (const agent of configuredAgentEntries(config)) {
  await assertPhysicalIsolationBoundary(root, agent.agentDir);
  await assertPhysicalIsolationBoundary(root, agent.workspace);
  const dir = sdk.resolveAgentDir(config, agent.id, isolatedEnv);
  checkProfile(sdk.loadAuthProfileStoreForRuntime(dir, readOptions, isolatedEnv));
}
await promisify(execFile)(process.execPath, [path.join(root, "tools", "audit-subscription-isolation.mjs")], {
  env: isolatedEnv, cwd: root, windowsHide: true, timeout: 120000,
});
if (!sourceRaw.equals(await fs.readFile(path.join(sourceHome, "openclaw.json")))) throw new Error("Historical config changed during staging");
await fs.writeFile(path.join(target.state, "STAGED.json"), JSON.stringify({ status: "staged-not-started", profileId: isolatedProfileId,
  agents: configuredAgentEntries(config).length, createdAt: new Date().toISOString(), port: target.port }, null, 2), { flag: "wx" });
console.log(JSON.stringify({ status: "staged-not-started", agents: 23, port: target.port }));
