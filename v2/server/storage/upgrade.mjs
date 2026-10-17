// M10 upgrade support (no Hub needed): the migration dry run on a COPY, the row counts compared after a real migration, and the
// persisted state of an upgrade run (so an interrupted upgrade resumes from its last completed step instead of guessing).
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, backup } from "node:sqlite";
import { MIGRATIONS } from "./migrations.mjs";
import { openDatabase, schemaState } from "./db.mjs";

/** Tables whose row counts must be identical before and after a migration (a migration adds structure, it never loses rows). */
export const COUNTED_TABLES = Object.freeze(["agent_runs", "missions", "factory_missions", "events", "settings", "live_grants", "media_assets", "content_projects"]);

export function rowCounts(db, tables = COUNTED_TABLES) {
  return Object.fromEntries(tables.map((t) => {
    try { return [t, db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n]; } catch { return [t, null]; }
  }));
}

/**
 * Copies the database (online backup, read-only source) into `tmpDir`, applies every pending migration to the copy and reports
 * versions, integrity and row counts. The copy is deleted. The source may be in use: the backup API is consistent.
 */
export async function dryRunMigration({ dbPath, tmpDir, migrations = MIGRATIONS }) {
  if (!fs.existsSync(dbPath)) throw new Error("No V2 database found.");
  const dir = path.join(tmpDir, `migration-dry-run-${Date.now().toString(36)}`);
  fs.mkdirSync(dir, { recursive: true });
  const copy = path.join(dir, "copy.sqlite");
  try {
    const live = new DatabaseSync(dbPath, { readOnly: true });
    const before = schemaState(live, migrations);
    await backup(live, copy);
    const liveCounts = rowCounts(live);
    live.close();
    const started = Date.now();
    const migrated = openDatabase(copy, { migrations }); // the copy needs no pre-migration backup of its own
    const after = schemaState(migrated, migrations);
    const integrity = Object.values(migrated.prepare("PRAGMA integrity_check").get())[0];
    const copyCounts = rowCounts(migrated);
    migrated.close();
    return { schemaBefore: before.current, schemaAfter: after.current, latestKnown: migrations.at(-1).version, pending: before.pending.map((m) => `${m.version}:${m.name}`),
      durationMs: Date.now() - started, integrity, rowCountsUnchanged: JSON.stringify(liveCounts) === JSON.stringify(copyCounts), rowCounts: copyCounts, liveCounts };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export const UPGRADE_STEPS = Object.freeze(["preflight", "dry_run", "stop", "build", "start", "verify"]);

/** The persisted state of upgrade runs: <dataDir>/upgrade/state.json (the current run) + runs.jsonl (history). */
export function createUpgradeState(dataDir) {
  const dir = path.join(dataDir, "upgrade");
  const file = path.join(dir, "state.json");
  const history = path.join(dir, "runs.jsonl");
  const read = () => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } };
  function write(state) {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, file);
    return state;
  }
  function begin({ fromVersion, toVersion, codeVersion }) {
    const current = read();
    if (current && !["DONE", "FAILED", "ABANDONED"].includes(current.status)) throw new Error(`O rulare de upgrade e deja în curs (${current.id}, pasul ${current.next}); reia-o cu --resume sau marcheaz-o abandonată cu --abandon.`);
    return write({ id: `upg_${Date.now().toString(36)}`, status: "RUNNING", fromVersion, toVersion, codeVersion, startedAt: new Date().toISOString(), done: [], next: UPGRADE_STEPS[0], steps: {} });
  }
  function complete(state, step, result) {
    const done = [...new Set([...state.done, step])];
    const next = UPGRADE_STEPS.find((s) => !done.includes(s)) || null;
    return write({ ...state, done, next, steps: { ...state.steps, [step]: { ...result, at: new Date().toISOString() } }, status: next ? "RUNNING" : "DONE", ...(next ? {} : { finishedAt: new Date().toISOString() }) });
  }
  function fail(state, step, error) {
    const next = write({ ...state, status: "FAILED", failedStep: step, error: String(error?.message || error).slice(0, 1000), steps: { ...state.steps, [step]: { ok: false, error: String(error?.message || error).slice(0, 1000), at: new Date().toISOString() } } });
    archive(next);
    return next;
  }
  function archive(state) { fs.mkdirSync(dir, { recursive: true }); fs.appendFileSync(history, `${JSON.stringify(state)}\n`); }
  function finish(state) { archive(state); return state; }
  function abandon(reason = "abandonat") { const s = read(); if (!s) return null; const next = write({ ...s, status: "ABANDONED", abandonedReason: reason, finishedAt: new Date().toISOString() }); archive(next); return next; }
  /** Re-entering a FAILED run continues it from the failed step (the steps already done are not repeated). */
  function resume() {
    const s = read();
    if (!s) throw new Error("Nu există o rulare de upgrade de reluat.");
    if (s.status === "DONE") throw new Error(`Rularea ${s.id} e deja terminată.`);
    if (s.status === "ABANDONED") throw new Error(`Rularea ${s.id} a fost abandonată; pornește una nouă.`);
    return write({ ...s, status: "RUNNING", next: UPGRADE_STEPS.find((st) => !s.done.includes(st)), resumedAt: new Date().toISOString() });
  }
  return { file, read, begin, complete, fail, finish, abandon, resume };
}
