// Migration dry run on a COPY of the live V2 database (M05: migration 5 before a Hub restart). Run from the Hub root:
//   node v2/scripts/migration-dry-run.mjs
// The live database is opened read-only and copied with SQLite's online backup into .ifrim/tmp; the migrations run on the
// copy only; the output is counts and versions (no row content); the copy is deleted. The live Hub may keep running.
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, backup } from "node:sqlite";
import { DATA_DIR, HUB_ROOT } from "./common.mjs";
import { MIGRATIONS } from "../server/storage/migrations.mjs";
import { openDatabase } from "../server/storage/db.mjs";

const source = path.join(DATA_DIR, "hub-v2.sqlite");
if (!fs.existsSync(source)) { console.error("No live V2 database found."); process.exit(1); }
const dir = path.join(HUB_ROOT, ".ifrim", "tmp", `migration-dry-run-${Date.now().toString(36)}`);
fs.mkdirSync(dir, { recursive: true });
const copy = path.join(dir, "copy.sqlite");
const counts = (db) => Object.fromEntries(["agent_runs", "missions", "factory_missions", "events", "settings", "live_grants"].map((t) => {
  try { return [t, db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n]; } catch { return [t, null]; }
}));
try {
  const live = new DatabaseSync(source, { readOnly: true });
  const before = live.prepare("SELECT MAX(version) AS v FROM schema_migrations").get().v;
  await backup(live, copy);
  const liveCounts = counts(live);
  live.close();
  const started = Date.now();
  const migrated = openDatabase(copy); // applies every pending migration, each in its own transaction
  const after = migrated.prepare("SELECT MAX(version) AS v FROM schema_migrations").get().v;
  const cols = migrated.prepare("PRAGMA table_info(agent_runs)").all().map((c) => c.name);
  const tables = migrated.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'environment_%'").all().map((r) => r.name);
  const integrity = migrated.prepare("PRAGMA integrity_check").get();
  const copyCounts = counts(migrated);
  migrated.close();
  console.log(JSON.stringify({
    schemaBefore: before, schemaAfter: after, latestKnown: MIGRATIONS.at(-1).version, durationMs: Date.now() - started,
    agentRunsHasEnvironment: cols.includes("environment"), environmentTables: tables, integrity: Object.values(integrity)[0],
    rowCountsUnchanged: JSON.stringify(liveCounts) === JSON.stringify(copyCounts), rowCounts: copyCounts,
  }, null, 2));
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
