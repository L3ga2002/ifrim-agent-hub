// M10 upgrade runner: preflight (quiescence) → migration dry run on a copy → graceful stop → UI build for the code's contract →
// start (the server itself takes and verifies the pre-migration backup and refuses to migrate without it) → verification (version,
// contract, backup manifest, row counts). Every step is persisted in <dataDir>/upgrade/state.json, so an interrupted upgrade resumes
// from its last completed step. Run from the Hub root:
//   node v2/scripts/upgrade.mjs --plan      read-only: versions + dry run, changes nothing
//   node v2/scripts/upgrade.mjs --apply     the whole upgrade (refused while anything is running)
//   node v2/scripts/upgrade.mjs --resume    continue a failed/interrupted run from its failed step
//   node v2/scripts/upgrade.mjs --abandon   mark the current run abandoned (nothing is undone)
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { DATA_DIR, HUB_ROOT, request, readPid, pidAlive, sleep, health } from "./common.mjs";
import { HUB_VERSION, API_CONTRACT, loadConfig } from "../server/config.mjs";
import { buildOperator } from "./build-operator.mjs";
import { dryRunMigration, createUpgradeState, rowCounts, COUNTED_TABLES } from "../server/storage/upgrade.mjs";

const args = new Set(process.argv.slice(2));
const dbPath = path.join(DATA_DIR, "hub-v2.sqlite");
// The dry run's copy of the live database stays in the data folder (outside the repo and OneDrive): a copy of private data in a
// synced folder would be uploaded, even if deleted a moment later.
const tmpDir = path.join(DATA_DIR, "upgrade", "dry-run");
const state = createUpgradeState(DATA_DIR);
const log = (...a) => console.log("[upgrade]", ...a);

async function token() { return (await request("GET", "/api/session")).json?.token || null; }
async function get(p, t) { return (await request("GET", p, { token: t })).json; }

/** Nothing may be running: no run, no active grant, no factory mission in an active stage, no render, no desktop session. */
async function preflight() {
  const h = await health();
  if (!h?.ok) return { ok: true, running: false, note: "Hub-ul nu rulează: upgrade offline" };
  const t = await token();
  const runs = [];
  for (const status of ["running", "starting", "waiting_approval"]) runs.push(...(((await get(`/api/runs?status=${status}`, t))?.runs) || []));
  const grants = (((await get("/api/grants", t))?.grants) || []).filter((g) => g.status === "active");
  const ACTIVE = new Set(["BASELINE", "IMPLEMENTING", "CHECKING", "REVIEWING", "REPAIRING", "QA", "PREVIEW", "E2E"]);
  const factory = (((await get("/api/factory", t))?.missions) || []).filter((m) => ACTIVE.has(m.stage || m.factory?.stage));
  const media = await get("/api/media/status", t);
  const renders = media?.renders?.active?.length || 0;
  const desktop = (await get("/api/desktop/status", t))?.session || null;
  const blockers = [...runs.map((r) => `rulare ${r.provider}:${r.id}`), ...grants.map((g) => `grant activ ${g.id}`), ...factory.map((m) => `misiune ${m.missionId || m.id}`),
    ...(renders ? [`${renders} randări active`] : []), ...(desktop?.active ? [`sesiune desktop ${desktop.id}`] : [])];
  return { ok: blockers.length === 0, running: true, liveVersion: h.version, liveContract: h.apiContract, mode: h.mode, blockers };
}

async function stopHub() {
  const t = await token();
  if (!t) return { ok: true, note: "deja oprit" };
  const r = await request("POST", "/api/system/shutdown", { body: { force: false }, token: t });
  if (r.status !== 200) throw new Error(r.json?.error?.message || `oprirea a fost refuzată (${r.status})`);
  const pid = readPid()?.pid;
  for (let i = 0; i < 60; i += 1) { await sleep(300); if (!pid || !pidAlive(pid)) return { ok: true, pid }; }
  throw new Error("Oprirea a fost cerută, dar procesul încă rulează");
}

function build() {
  // vite directly through node (no .cmd shim); the output is v2/web/dist, served by the next start.
  const vite = path.join(HUB_ROOT, "node_modules", "vite", "bin", "vite.js");
  const r = spawnSync(process.execPath, [vite, "build", "--config", "v2/web/vite.config.js"], { cwd: HUB_ROOT, encoding: "utf8", timeout: 300000 });
  if (r.status !== 0) throw new Error(`build-ul UI a eșuat: ${(r.stderr || r.stdout || "").slice(-600)}`);
  const index = fs.readFileSync(path.join(HUB_ROOT, "v2", "web", "dist", "index.html"), "utf8");
  // M10: the Desktop Operator helper is rebuilt from the current source into the Hub's work dir (its manifest binds binary ↔ source;
  // the Hub refuses a stale helper). Not fatal: without the Windows C# compiler the operator reports OPERATOR_NOT_READY, the rest runs.
  let operator = null;
  try { const m = buildOperator(path.dirname(loadConfig({}).desktop.operatorExe)); operator = { ok: true, exe: m.exe, sha256: m.sha256.slice(0, 16) }; }
  catch (error) { operator = { ok: false, error: String(error.message).slice(0, 300) }; log(`helperul desktop nu s-a construit: ${operator.error}`); }
  return { ok: true, bundle: (index.match(/assets\/index-[\w-]+\.js/) || [null])[0], operator };
}

async function start() {
  const r = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(HUB_ROOT, "v2", "scripts", "start-detached.ps1")], { cwd: HUB_ROOT, encoding: "utf8", timeout: 120000 });
  // The first boot on new code takes the verified backup and migrates before it listens: wait up to 3 more minutes.
  let h = await health();
  for (let i = 0; i < 180 && !h?.ok; i += 1) { await sleep(1000); h = await health(); }
  if (!h?.ok) throw new Error(`Hub-ul nu a pornit: ${(r.stdout || "").trim().slice(-300)} ${(r.stderr || "").trim().slice(-300)} (vezi v2-hub.log; dacă backup-ul dinaintea migrării a eșuat, baza nu a fost modificată)`);
  return { ok: true, version: h.version, apiContract: h.apiContract };
}

async function verify(dry) {
  const h = await health();
  if (h?.version !== HUB_VERSION || h?.apiContract !== API_CONTRACT) throw new Error(`Hub-ul servește ${h?.version}/${h?.apiContract}, nu ${HUB_VERSION}/${API_CONTRACT}`);
  const t = await token();
  const st = await get("/api/state", t);
  const backupInfo = st?.boot?.storage?.preMigrationBackup || null;
  if ((dry?.pending || []).length && (!backupInfo || backupInfo.integrity !== "ok")) throw new Error("Migrarea a rulat, dar boot-ul nu raportează backup-ul verificat dinaintea ei");
  const db = new DatabaseSync(dbPath, { readOnly: true });
  let counts;
  try { counts = rowCounts(db, COUNTED_TABLES); } finally { db.close(); }
  // Rows can only be added by the boot itself (events, seeded rows); a table that existed must not have LOST rows.
  const lost = Object.entries(dry?.liveCounts || {}).filter(([k, n]) => n !== null && counts[k] !== null && counts[k] < n).map(([k, n]) => `${k}: ${n} → ${counts[k]}`);
  if (lost.length) throw new Error(`Rânduri pierdute după migrare: ${lost.join(", ")}`);
  return { ok: true, version: h.version, apiContract: h.apiContract, preMigrationBackup: backupInfo, counts };
}

async function main() {
  if (args.has("--abandon")) { log(JSON.stringify(state.abandon("abandonat manual"))); return; }
  if (args.has("--plan")) {
    const pre = await preflight();
    const dry = await dryRunMigration({ dbPath, tmpDir });
    log(JSON.stringify({ codeVersion: HUB_VERSION, codeContract: API_CONTRACT, preflight: pre, dryRun: dry }, null, 2));
    return;
  }
  let s;
  if (args.has("--resume")) s = state.resume();
  else if (args.has("--apply")) {
    const h = await health();
    s = state.begin({ fromVersion: h?.version || null, toVersion: HUB_VERSION, codeVersion: HUB_VERSION });
  } else { console.log("Folosește --plan, --apply, --resume sau --abandon."); process.exitCode = 2; return; }
  const run = {
    preflight: async () => { const r = await preflight(); if (!r.ok) throw new Error(`Hub-ul nu e liniștit: ${r.blockers.join(", ")}`); return r; },
    dry_run: async () => { const r = await dryRunMigration({ dbPath, tmpDir }); if (r.integrity !== "ok" || !r.rowCountsUnchanged || r.schemaAfter !== r.latestKnown) throw new Error(`dry-run-ul nu e curat: ${JSON.stringify(r)}`); return r; },
    stop: stopHub,
    build: async () => build(),
    start,
    verify: async () => verify(s.steps.dry_run),
  };
  while (s.next) {
    const step = s.next;
    log(`→ ${step}`);
    try { s = state.complete(s, step, await run[step]()); log(`✓ ${step}`); }
    catch (error) { s = state.fail(s, step, error); log(`✗ ${step}: ${error.message}`); log("Reia cu: node v2/scripts/upgrade.mjs --resume (pașii făcuți nu se repetă)"); process.exitCode = 1; return; }
  }
  state.finish(s);
  log(JSON.stringify({ id: s.id, status: s.status, from: s.fromVersion, to: s.toVersion, verify: s.steps.verify }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
