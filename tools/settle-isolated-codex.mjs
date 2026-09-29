import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { isolationPaths, validateIsolatedPaths, assertPhysicalIsolationBoundary } from "../apps/api/src/subscription-isolation.mjs";
import { fingerprintIsolatedPluginArtifacts } from "../apps/api/src/isolated-plugin-evidence.mjs";

if (process.argv[2] !== "--approved-hub-018") throw new Error("HUB-018 approval required");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = isolationPaths(root);
const allowed = ["SystemRoot","WINDIR","COMSPEC","USERPROFILE","USERNAME","USERDOMAIN","APPDATA","LOCALAPPDATA","TEMP","TMP","ProgramFiles","ProgramFiles(x86)","ProgramData","HOMEDRIVE","HOMEPATH","PATH"];
for (const key of Object.keys(process.env)) if (!allowed.some(name=>name.toLowerCase()===key.toLowerCase())) delete process.env[key];
Object.assign(process.env, {OPENCLAW_STATE_DIR:target.state,OPENCLAW_CONFIG_PATH:target.config,OPENCLAW_LOAD_SHELL_ENV:"0",OPENCLAW_SKIP_CRON:"1"});
const env = process.env;
const dist = path.join(env.APPDATA,"npm","node_modules","openclaw","dist");
const load = file => import(pathToFileURL(path.join(dist,file)));
const { i: withMaintenance } = await load("doctor-sqlite-maintenance-lock-7TRGuHpb.mjs");
const { n: collect, i: settle } = await load("state-migrations.plugin-doctor-DlRpG3T4.mjs");
const { a: readPending } = await load("deferred-plugin-migrations-DZuh_dkr.mjs");
const { c: listContracts } = await load("doctor-contract-registry-Wpa1k0Ei.mjs");
const approvedInspectionIds = new Set(["codex","active-memory","canvas","crabbox","device-pair","memory-core","memory-wiki","reef","telegram","workboard"]);
const raw = await fs.readFile(target.config);
const config = JSON.parse(raw.toString("utf8"));
validateIsolatedPaths(config,root);
const fingerprint = await fingerprintIsolatedPluginArtifacts(root,env);
const globalFile = path.join(env.USERPROFILE,".openclaw","openclaw.json");
const globalDigest = createHash("sha256").update(await fs.readFile(globalFile)).digest("hex");
const assertStable = async () => {
  if (!raw.equals(await fs.readFile(target.config)) || !isDeepStrictEqual(fingerprint,await fingerprintIsolatedPluginArtifacts(root,env)) || createHash("sha256").update(await fs.readFile(globalFile)).digest("hex") !== globalDigest) throw new Error("Configuration/plugin/global checkpoint changed");
};
const paths = [target.config];
const inventory = async directory => {
  await assertPhysicalIsolationBoundary(root,directory);
  for (const entry of await fs.readdir(directory,{withFileTypes:true})) {
    const file = path.join(directory,entry.name);
    if (entry.isSymbolicLink()) {
      if (file === fingerprint.sdkDependency?.link && (await fs.realpath(file)).toLowerCase() === path.resolve(fingerprint.sdkDependency.target).toLowerCase()) continue;
      throw new Error("Maintenance inventory contains an unapproved link");
    }
    if (entry.isDirectory()) await inventory(file);
    else if (/(?:\.sqlite|\.db)(?:-wal|-shm)?$/i.test(entry.name)) {
      paths.push(file);
      if (!/-wal|-shm$/.test(entry.name)) paths.push(`${file}-wal`,`${file}-shm`);
    }
  }
};
await inventory(target.state);
const input = {config,env,stateDir:target.state,oauthDir:path.join(target.state,"credentials")};
const plugin = await import(pathToFileURL(path.join(fingerprint.record.installPath,"dist","doctor-contract-api.js")));
const normalized = plugin.normalizeCompatibilityConfig({cfg:config});
if (normalized.changes?.length || !isDeepStrictEqual(normalized.config,config)) throw new Error("Compatibility normalization requires separate review");
await withMaintenance({env,operation:"HUB-018 isolated Codex migration settlement",protectedPaths:[...new Set(paths)],run:async authority=>{
  authority.assertCurrent();
  await assertStable();
  const pending = readPending({env,artifactPreservingReadOnly:true});
  if (pending.length !== 1 || pending[0].pluginId !== "codex") throw new Error("Only the approved Codex obligation may be settled");
  for (const phase of [undefined,"after-session-repair"]) {
    const warnings = [];
    const detected = await collect(input,{includeDoctorOnly:true,phase,warnings});
    if (warnings.length || detected.plans.length || !isDeepStrictEqual([...detected.requiredPluginIds].sort(),[...approvedInspectionIds].sort())) {
      console.error(JSON.stringify({phase:phase||"initial",warningCount:warnings.length,plans:detected.plans.map(plan=>({plugin:plan.pluginId,id:plan.migration.id})),requiredPlugins:[...detected.requiredPluginIds]}));
      throw new Error("Fresh-state inspection found migration/repair work; preserve it for review");
    }
  }
  const contracts = listContracts({config,env});
  if (contracts.some(entry=>!approvedInspectionIds.has(entry.pluginId))) throw new Error("Unapproved native inspection contract");
  const plannedActions = contracts.filter(entry=>entry.migration.phase==="after-session-repair").map(entry=>({pluginId:entry.pluginId,id:entry.migration.id}));
  if (!isDeepStrictEqual(plannedActions,[{pluginId:"codex",id:"codex-app-server-orphaned-session-bindings"}])) throw new Error("Native action order differs from the approved snapshot");
  const result = await settle({config,env,maintenanceAuthority:authority,plannedActions,
    beforeCompletion:async (ids,assertCurrent)=>{assertCurrent();if(ids.some(id=>!approvedInspectionIds.has(id)))throw new Error("Unexpected completion owner");
      const currentPending=readPending({env,artifactPreservingReadOnly:true});
      if(currentPending.some(item=>item.pluginId!=="codex"))throw new Error("Unapproved pending owner");await assertStable();}});
  if (result.warnings?.length || result.changes?.length || readPending({env,artifactPreservingReadOnly:true}).length) throw new Error("Native migration did not settle without data changes");
  await assertStable();
}});
console.log(JSON.stringify({status:"isolated-codex-migration-settled",gatewayStarted:false,modelInvoked:false}));
