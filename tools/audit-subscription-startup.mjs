import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { validateAuthConfiguration, validateStartupProfiles } from "../apps/api/src/subscription-auth.mjs";
import { configuredAgentEntries } from "../apps/api/src/openclaw-config.mjs";

const home = path.join(process.env.USERPROFILE, ".openclaw");
const env = { USERPROFILE: process.env.USERPROFILE, APPDATA: process.env.APPDATA,
  LOCALAPPDATA: process.env.LOCALAPPDATA, OPENCLAW_STATE_DIR: home, OPENCLAW_CONFIG_PATH: path.join(home, "openclaw.json") };
try {
  const config = JSON.parse(await fs.readFile(env.OPENCLAW_CONFIG_PATH, "utf8"));
  validateAuthConfiguration(config);
  if (Object.keys(config.secrets || {}).length) throw new Error("Startup blocked: SecretRef sources require an independent no-API audit");
  const sdk = await import(pathToFileURL(path.join(env.APPDATA, "npm", "node_modules", "openclaw", "dist", "plugin-sdk", "agent-runtime.js")));
  sdk.clearRuntimeAuthProfileStoreSnapshots();
  const options = { config, readOnly: true, syncExternalCli: false, externalCli: { mode: "none" } };
  validateStartupProfiles(sdk.loadAuthProfileStoreForRuntime(undefined, options, env));
  for (const agent of configuredAgentEntries(config)) {
    const dir = sdk.resolveAgentDir(config, agent.id, env);
    validateStartupProfiles(sdk.loadAuthProfileStoreForRuntime(dir, options, env));
  }
  console.log(JSON.stringify({ startupAllowed: true, agentsAudited: configuredAgentEntries(config).length }));
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
}
