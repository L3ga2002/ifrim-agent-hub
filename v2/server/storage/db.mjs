import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { MIGRATIONS } from "./migrations.mjs";

/** The pre-migration backup of the last openDatabase() per connection (null when no migration was pending). */
const backupsByDb = new WeakMap();
export const preMigrationBackupOf = (db) => backupsByDb.get(db) || null;

/**
 * Opens the V2 database and applies pending migrations.
 * M10: when the file already holds a schema and a migration is pending, a coherent copy is written FIRST
 * (`preMigrationBackupDir`): VACUUM INTO (a transactional snapshot that includes the WAL), then integrity_check and the schema
 * version are verified on the copy and a manifest is written next to it. If that fails the migration is refused and the database
 * is left exactly as it was (the Hub does not start on it). A new or up-to-date database never pays for a backup.
 */
export function openDatabase(dbPath, { preMigrationBackupDir = null, migrations = MIGRATIONS, appVersion = "" } = {}) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA synchronous = NORMAL");
  const state = schemaState(db, migrations);
  let backup = null;
  if (preMigrationBackupDir && state.existing && state.pending.length) {
    try {
      backup = backupBeforeMigration(db, { dir: preMigrationBackupDir, dbPath, fromVersion: state.current, toVersion: state.pending.at(-1).version, appVersion });
    } catch (error) {
      try { db.close(); } catch { /* already closed */ }
      const err = new Error(`Migrarea bazei a fost refuzată: backup-ul obligatoriu dinaintea migrării (${state.current} → ${state.pending.at(-1).version}) a eșuat: ${error.message}. Baza nu a fost modificată.`);
      err.code = "PRE_MIGRATION_BACKUP_FAILED";
      throw err;
    }
  }
  migrate(db, migrations);
  if (backup) backupsByDb.set(db, backup);
  return db;
}

/** { existing: the file already had applied migrations, current: highest applied version, pending: migrations not applied yet }. */
export function schemaState(db, migrations = MIGRATIONS) {
  const hasTable = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get());
  const applied = hasTable ? new Set(db.prepare("SELECT version FROM schema_migrations").all().map((row) => row.version)) : new Set();
  const current = applied.size ? Math.max(...applied) : 0;
  return { existing: applied.size > 0, current, pending: migrations.filter((m) => !applied.has(m.version)) };
}

/**
 * A verified copy of the open database before its schema changes. Never overwrites an earlier backup (a unique file name per run).
 * Returns the manifest: { file, manifestFile, bytes, sha256, schemaVersion, toVersion, tables, integrity, createdAt, appVersion }.
 */
export function backupBeforeMigration(db, { dir, dbPath = "", fromVersion, toVersion, appVersion = "", label = "pre-migration" }) {
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = `hub-v2.${label}.v${fromVersion}-to-v${toVersion}.${stamp}`;
  let file = path.join(dir, `${base}.sqlite`);
  for (let i = 2; fs.existsSync(file); i += 1) file = path.join(dir, `${base}.${i}.sqlite`);
  db.prepare("VACUUM INTO ?").run(file);
  const copy = new DatabaseSync(file, { readOnly: true });
  let integrity, schemaVersion, tables;
  try {
    integrity = Object.values(copy.prepare("PRAGMA integrity_check").get())[0];
    schemaVersion = copy.prepare("SELECT MAX(version) AS v FROM schema_migrations").get().v;
    tables = copy.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'").get().n;
  } finally { copy.close(); }
  if (integrity !== "ok") throw new Error(`copia nu trece integrity_check (${integrity})`);
  if (schemaVersion !== fromVersion) throw new Error(`copia are schema ${schemaVersion}, nu ${fromVersion}`);
  const bytes = fs.statSync(file).size;
  const sha256 = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  const manifest = { file, bytes, sha256, schemaVersion, toVersion, tables, integrity, createdAt: new Date().toISOString(), appVersion, source: dbPath ? path.basename(dbPath) : "" };
  const manifestFile = file.replace(/\.sqlite$/, ".manifest.json");
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2), { flag: "wx" });
  return { ...manifest, manifestFile };
}

/** Applies ordered, idempotent schema migrations; each runs in its own transaction. */
export function migrate(db, migrations = MIGRATIONS) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)`);
  const applied = new Set(db.prepare("SELECT version FROM schema_migrations").all().map((row) => row.version));
  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    tx(db, () => {
      migration.up(db);
      db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)")
        .run(migration.version, migration.name, new Date().toISOString());
    });
  }
}

const depths = new WeakMap();
/** Runs `fn` inside BEGIN IMMEDIATE / COMMIT; nested calls join the outer transaction. */
export function tx(db, fn) {
  const depth = depths.get(db) || 0;
  if (depth > 0) return fn();
  db.exec("BEGIN IMMEDIATE");
  depths.set(db, 1);
  try {
    const result = fn();
    depths.set(db, 0);
    db.exec("COMMIT");
    return result;
  } catch (error) {
    depths.set(db, 0);
    try { db.exec("ROLLBACK"); } catch { /* already rolled back */ }
    throw error;
  }
}

export const json = (value) => JSON.stringify(value ?? null);
export const parse = (text, fallback = null) => {
  if (text === null || text === undefined || text === "") return fallback;
  try { return JSON.parse(text); } catch { return fallback; }
};
