// Migration dry run on a COPY of the live V2 database (M05: migration 5; M08: migration 8; M10.2: migration 11) before a Hub restart. Run from the Hub root:
//   node v2/scripts/migration-dry-run.mjs
// The live database is opened read-only and copied with SQLite's online backup into <dataDir>/upgrade/dry-run; the migrations run on the
// copy only; the output is counts and versions (no row content); the copy is deleted. The live Hub may keep running.
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, backup } from "node:sqlite";
import { DATA_DIR, HUB_ROOT } from "./common.mjs";
import { MIGRATIONS } from "../server/storage/migrations.mjs";
import { openDatabase } from "../server/storage/db.mjs";

const source = path.join(DATA_DIR, "hub-v2.sqlite");
if (!fs.existsSync(source)) { console.error("No live V2 database found."); process.exit(1); }
// The copy stays in the data folder (outside the repo and OneDrive, M10): private data never lands in a synced folder.
const dir = path.join(DATA_DIR, "upgrade", "dry-run", `migration-dry-run-${Date.now().toString(36)}`);
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
  const ownerTables = migrated.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('owner_credentials','owner_challenges','owner_sessions','mission_envelopes','owner_visits','shadow_evaluations','voice_profiles','voice_utterances')").all().map((r) => r.name);
  const grantCols = migrated.prepare("PRAGMA table_info(live_grants)").all().map((c) => c.name);
  // M08 (migration 8): company intelligence tables, all new and empty after the migration.
  const M08 = ["twin_claims", "incidents", "incident_entries", "autopilot_objectives", "board_meetings", "board_items", "simulations", "skill_candidates", "lessons", "devices", "device_pairings", "device_commands", "decision_packages"];
  const m08Tables = migrated.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${M08.map(() => "?").join(",")})`).all(...M08).map((r) => r.name);
  // M09 (migration 9): media / content tables plus the core-correction columns.
  const M09 = ["media_assets", "media_asset_versions", "media_rights", "media_transcripts", "content_style_presets", "content_campaigns", "content_ideas", "content_projects", "content_briefs", "content_claims", "content_scripts", "content_storyboards", "media_capture_sessions", "media_edit_projects", "media_edit_versions", "media_render_jobs", "media_render_cache", "media_qa_reports", "media_reviews", "media_variants", "content_manifests", "content_release_attempts", "content_metrics", "content_experiments", "content_insights", "content_funnel_events", "run_skill_usage"];
  const m09Tables = migrated.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${M09.map(() => "?").join(",")})`).all(...M09).map((r) => r.name);
  const missionCols = migrated.prepare("PRAGMA table_info(factory_missions)").all().map((c) => c.name);
  // M10 (migration 10): operation plans, the Desktop Operator registry / sessions / actions, project imports and import folders.
  const M10 = ["ops_plans", "ops_plan_steps", "desktop_apps", "desktop_sessions", "desktop_actions", "media_project_imports", "media_import_grants"];
  const m10Tables = migrated.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${M10.map(() => "?").join(",")})`).all(...M10).map((r) => r.name);
  // M10.2 (migration 11): preserved work requests (new and empty after the migration).
  const M11 = ["work_requests"];
  const m11Tables = migrated.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${M11.map(() => "?").join(",")})`).all(...M11).map((r) => r.name);
  // M11 (migration 12; the "M11" group above already means migration 11): deliveries, their items, documents and revisions.
  const M12 = ["deliveries", "delivery_items", "delivery_documents", "delivery_revisions"];
  const m12Tables = migrated.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${M12.map(() => "?").join(",")})`).all(...M12).map((r) => r.name);
  // M13 (migration 14 m13-desk): the „Birou intern” records, documents, exports and plan ledger (new and empty after the migration).
  const M13 = ["desk_records", "desk_artifacts", "desk_exports", "desk_plan_ops"];
  const m13Tables = migrated.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${M13.map(() => "?").join(",")})`).all(...M13).map((r) => r.name);
  const integrity = migrated.prepare("PRAGMA integrity_check").get();
  const copyCounts = counts(migrated);
  migrated.close();
  console.log(JSON.stringify({
    schemaBefore: before, schemaAfter: after, latestKnown: MIGRATIONS.at(-1).version, durationMs: Date.now() - started,
    agentRunsHasEnvironment: cols.includes("environment"), environmentTables: tables, ownerTables, liveGrantsHasEnvelope: grantCols.includes("envelope_id"), m08Tables, m09Tables, m09Complete: m09Tables.length === M09.length && missionCols.includes("bindings_json") && grantCols.includes("binding_json") && cols.includes("prompt_sha256"), m08Complete: m08Tables.length === M08.length, m10Tables, m10Complete: m10Tables.length === M10.length, m11Tables, m11Complete: m11Tables.length === M11.length, m12Tables, m12Complete: m12Tables.length === M12.length, m13Tables, m13Complete: m13Tables.length === M13.length,
    integrity: Object.values(integrity)[0],
    rowCountsUnchanged: JSON.stringify(liveCounts) === JSON.stringify(copyCounts), rowCounts: copyCounts,
  }, null, 2));
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
