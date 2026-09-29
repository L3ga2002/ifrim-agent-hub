import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isolationPaths, isolatedProfileId, validateIsolatedPaths, assertPhysicalIsolationBoundary } from "../apps/api/src/subscription-isolation.mjs";
import { validateAuthConfiguration, validateOAuthProfile, validateStartupProfiles } from "../apps/api/src/subscription-auth.mjs";
import { configuredAgentEntries } from "../apps/api/src/openclaw-config.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = isolationPaths(root);
process.env.OPENCLAW_STATE_DIR = target.state;
process.env.OPENCLAW_CONFIG_PATH = target.config;
process.env.OPENCLAW_LOAD_SHELL_ENV = "0";
process.env.OPENCLAW_SKIP_CRON = "1";
try {
  await assertPhysicalIsolationBoundary(root, target.state);
  const config = JSON.parse(await fs.readFile(target.config, "utf8"));
  validateIsolatedPaths(config, root);
  validateAuthConfiguration(config);
  const sdk = await import(pathToFileURL(path.join(process.env.APPDATA, "npm", "node_modules", "openclaw", "dist", "plugin-sdk", "agent-runtime.js")));
  sdk.clearRuntimeAuthProfileStoreSnapshots();
  const options = { config, readOnly: true, syncExternalCli: false, externalCli: { mode: "none" } };
  const shared = sdk.loadAuthProfileStoreForRuntime(undefined, options, process.env);
  validateStartupProfiles(shared);
  if (Object.keys(shared.profiles).length !== 1) throw new Error("Isolated shared store must contain only the approved profile");
  validateOAuthProfile(shared.profiles[isolatedProfileId]);
  const agents = configuredAgentEntries(config);
  for (const agent of agents) {
    await assertPhysicalIsolationBoundary(root, agent.agentDir);
    await assertPhysicalIsolationBoundary(root, agent.workspace);
    const dir = sdk.resolveAgentDir(config, agent.id, process.env);
    const store = sdk.loadAuthProfileStoreForRuntime(dir, options, process.env);
    validateStartupProfiles(store);
    if (Object.keys(store.profiles).length !== 1) throw new Error("Unexpected credential accessible to isolated agent");
    validateOAuthProfile(store.profiles[isolatedProfileId]);
    if (["access", "refresh", "accountId", "expires"].some((key) => store.profiles[isolatedProfileId][key] !== shared.profiles[isolatedProfileId][key])) throw new Error("Effective credential differs from isolated shared credential");
    if (sdk.resolvePersistedAuthProfileOwnerAgentDir({ agentDir: dir, profileId: isolatedProfileId })) throw new Error("Effective credential owner is not isolated shared state");
  }
  console.log(JSON.stringify({ status: "isolated-stores-verified-not-started", agents: agents.length, profileId: isolatedProfileId, port: target.port }));
} catch (error) { console.error(error.message); process.exitCode = 2; }
