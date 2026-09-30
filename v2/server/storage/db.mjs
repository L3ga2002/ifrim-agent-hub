import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { MIGRATIONS } from "./migrations.mjs";

export function openDatabase(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA synchronous = NORMAL");
  migrate(db);
  return db;
}

/** Applies ordered, idempotent schema migrations; each runs in its own transaction. */
export function migrate(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)`);
  const applied = new Set(db.prepare("SELECT version FROM schema_migrations").all().map((row) => row.version));
  for (const migration of MIGRATIONS) {
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
