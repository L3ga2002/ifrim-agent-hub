import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync, backup } from "node:sqlite";

if (process.argv[2] !== "--approved-hub-018") throw new Error("HUB-018 approval required");
const home = path.join(process.env.USERPROFILE, ".openclaw");
const config = JSON.parse(await fs.readFile(path.join(home, "openclaw.json"), "utf8"));
const dir = path.join(process.env.LOCALAPPDATA, "IfrimDigital", "OpenClawBackups", `auth-${Date.now()}`);
await fs.mkdir(dir, { recursive: true });
const db = new DatabaseSync(path.join(home, "state", "openclaw.sqlite"), { readOnly: true });
try { await backup(db, path.join(dir, "openclaw.sqlite")); } finally { db.close(); }
const sdk = await import(pathToFileURL(path.join(process.env.APPDATA, "npm", "node_modules", "openclaw", "dist", "plugin-sdk", "agent-runtime.js")));
const agentDir = sdk.resolveAgentDir(config, "ifrim-backend");
const profileId = "openai:ifrim458@gmail.com";
const ownerAgentDir = sdk.resolvePersistedAuthProfileOwnerAgentDir({ agentDir, profileId });
const store = sdk.loadAuthProfileStoreForRuntime(agentDir, { readOnly: true });
const original = { ...store.profiles[profileId] };
if (store.profiles[profileId]?.type !== "oauth" || store.profiles[profileId]?.provider !== "openai") throw new Error("Subscription profile missing");
const ownerStore = sdk.loadAuthProfileStoreWithoutExternalProfiles(ownerAgentDir, { readOnly: true, syncExternalCli: false });
if (JSON.stringify(ownerStore.profiles[profileId]) !== JSON.stringify(original)) throw new Error("OAuth persistence owner does not match the selected credential");
const tokenRuntime = await import(pathToFileURL(path.join(process.env.APPDATA, "npm", "node_modules", "openclaw", "dist", "openai-chatgpt-oauth-token.runtime-CKpAwxLo.mjs")));
const result = await tokenRuntime.n(store.profiles[profileId].refresh);
if (result.type !== "success") {
  console.log(JSON.stringify({ status: "auth-refresh-required", reason: result.reason || result.code || result.type, httpStatus: result.status, backup: dir }));
  process.exitCode = 2;
} else {
  const { p: updateAuthProfileStoreWithLock } = await import(pathToFileURL(path.join(process.env.APPDATA, "npm", "node_modules", "openclaw", "dist", "store-runtime-Bn3edv44.mjs")));
  const persisted = await updateAuthProfileStoreWithLock({ agentDir: ownerAgentDir, sharedStoreWrite: !ownerAgentDir, profileId, updater: (current) => {
    if (JSON.stringify(current.profiles[profileId]) !== JSON.stringify(original)) throw new Error("OAuth profile changed during refresh");
    current.profiles[profileId] = { ...current.profiles[profileId], access: result.access, refresh: result.refresh, expires: result.expires };
    return true;
  } });
  if (!persisted) throw new Error("OAuth refresh persistence not confirmed");
  console.log(JSON.stringify({ status: "oauth-refreshed", provider: "openai", expires: result.expires, backup: dir }));
}
