// M13 — migration 14 `m13-desk` (temporary databases only; no Hub is constructed). Purely additive on schema 13: four new tables (the desk
// records, their documents, their exports and the C-01 ledger of their plans), synthetic only, the record status list equal to the
// constant in desk/desk.mjs. A schema-13 database gets a verified pre-migration backup; the dry run on a copy leaves the source at 13 and
// adds only these tables and indexes; the schema-13 code's own tables are untouched.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { tempDir } from "./helpers.mjs";
import { openDatabase, schemaState, preMigrationBackupOf } from "../server/storage/db.mjs";
import { MIGRATIONS } from "../server/storage/migrations.mjs";
import { dryRunMigration } from "../server/storage/upgrade.mjs";
import { RECORD_STATUSES } from "../server/desk/desk.mjs";

const UPTO13 = MIGRATIONS.filter((m) => m.version <= 13);
const NEW_TABLES = ["desk_artifacts", "desk_exports", "desk_plan_ops", "desk_records"];
const NEW_INDEXES = ["idx_desk_exports_record", "idx_desk_plan_ops_root", "idx_desk_records_kind", "idx_desk_records_opp", "ux_desk_records_root"];
const NOW = "2026-10-22T08:00:00.000Z";
const dir = (t, label) => { const d = tempDir(label); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };
const checkValues = (db, table, column) => {
  const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table).sql;
  const m = sql.match(new RegExp(`${column} TEXT NOT NULL CHECK \\(${column} IN \\(([^)]*)\\)\\)`));
  return m ? m[1].split(",").map((v) => v.trim().replace(/'/g, "")) : null;
};
const master = (db) => Object.fromEntries(db.prepare("SELECT name, sql FROM sqlite_master WHERE type IN ('table','index') AND sql IS NOT NULL").all().map((r) => [r.name, r.sql]));
function schema13Db(d) {
  const file = path.join(d, "hub-v2.sqlite");
  const db = openDatabase(file, { migrations: UPTO13 });
  db.prepare("INSERT INTO sales_plan_ops (op_key, root_plan_id, root_plan_hash, op, params_json, status, fixed_at, synthetic, created_at, updated_at) VALUES ('k13', 'opp_x', 'h', 'sales.synthetic', '{}', 'DONE', ?, 1, ?, ?)").run(NOW, NOW, NOW);
  db.close();
  return file;
}

test("M13-MIG-01 fresh database: schema 14 m13-desk, the four desk tables, the status list equal to RECORD_STATUSES, synthetic only, one record per root plan", (t) => {
  const db = openDatabase(path.join(dir(t, "m13-mig1"), "hub-v2.sqlite"));
  try {
    // M14 adds migration 15 (m14-backup-owner): migration 14 stays m13-desk, applied with every later one.
    assert.equal(schemaState(db).current, MIGRATIONS.at(-1).version);
    assert.equal(MIGRATIONS.find((m) => m.version === 14).name, "m13-desk");
    assert.deepEqual(checkValues(db, "desk_records", "status"), RECORD_STATUSES);
    assert.deepEqual(checkValues(db, "desk_records", "kind"), ["ops_start", "support_case", "finance_doc"]);
    assert.deepEqual(checkValues(db, "desk_records", "department"), ["operations", "customer-success", "finance-admin"]);
    for (const table of NEW_TABLES) assert.match(db.prepare("SELECT sql FROM sqlite_master WHERE name = ?").get(table).sql, /synthetic INTEGER NOT NULL DEFAULT 1 CHECK \(synthetic = 1\)/, table);
    db.prepare("PRAGMA foreign_keys = OFF").run();
    const rec = (id, root, { synthetic = 1, status = "PLANNED", no = id } = {}) => db.prepare(`INSERT INTO desk_records (id, kind, department, internal_no, title, status, root_plan_id, root_plan_hash, synthetic, created_by, created_at, updated_at)
      VALUES (?, 'ops_start', 'operations', ?, 't', ?, ?, 'h', ?, 'test', ?, ?)`).run(id, no, status, root, synthetic, NOW, NOW);
    rec("dsk_1", "opp_1");
    assert.throws(() => rec("dsk_2", "opp_1"), /UNIQUE/, "one record per confirmed root plan");
    assert.throws(() => rec("dsk_3", "opp_3", { no: "dsk_1" }), /UNIQUE/, "one internal number");
    assert.throws(() => rec("dsk_4", "opp_4", { synthetic: 0 }), /CHECK/, "never a real row in M13");
    assert.throws(() => rec("dsk_5", "opp_5", { status: "DONE" }), /CHECK/);
    const art = (id, version, status = "DRAFT") => db.prepare(`INSERT INTO desk_artifacts (id, record_id, kind, version, content_json, content_sha, status, created_by, created_at, updated_at)
      VALUES (?, 'dsk_1', 'deviz', ?, '{}', 's', ?, 'test', ?, ?)`).run(id, version, status, NOW, NOW);
    art("dar_1", 1);
    assert.throws(() => art("dar_2", 1), /UNIQUE/, "one row per version");
    assert.throws(() => art("dar_3", 2, "SENT"), /CHECK/, "no sent state exists");
    const exp = (id, revision, key, status = "WRITING") => db.prepare(`INSERT INTO desk_exports (id, record_id, revision, folder, status, op_key, created_by, created_at, updated_at)
      VALUES (?, 'dsk_1', ?, 'C:/x', ?, ?, 'test', ?, ?)`).run(id, revision, status, key, NOW, NOW);
    exp("dex_1", 1, "e1");
    assert.throws(() => exp("dex_2", 1, "e2"), /UNIQUE/, "one folder per revision");
    assert.throws(() => exp("dex_3", 2, "e1"), /UNIQUE/, "one export per op key");
    assert.throws(() => exp("dex_4", 3, "e4", "CURRENT"), /CHECK/);
  } finally { db.close(); }
});

test("M13-MIG-02 schema 13 → 14: a verified pre-migration backup first; the M12 tables and rows unchanged; the new tables start empty", (t) => {
  const d = dir(t, "m13-mig2");
  const file = schema13Db(d);
  const db = openDatabase(file, { preMigrationBackupDir: path.join(d, "pre-upgrade"), appVersion: "test" });
  try {
    const b = preMigrationBackupOf(db);
    assert.ok(b, "a backup was taken before migration 14");
    assert.deepEqual([b.schemaVersion, b.toVersion, b.integrity], [13, MIGRATIONS.at(-1).version, "ok"]);
    assert.ok(path.basename(b.file).includes(`v13-to-v${MIGRATIONS.at(-1).version}`));
    assert.equal(schemaState(db).current, MIGRATIONS.at(-1).version);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sales_plan_ops WHERE op_key = 'k13'").get().n, 1);
    for (const table of NEW_TABLES) assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0, table);
  } finally { db.close(); }
});

test("M13-MIG-03 dry run on a copy: 13 → 14, only additions (four tables, five indexes), row counts unchanged, source left at 13", async (t) => {
  const d = dir(t, "m13-mig3");
  const file = schema13Db(d);
  const db13 = new DatabaseSync(file, { readOnly: true });
  const before = master(db13);
  db13.close();
  const r = await dryRunMigration({ dbPath: file, tmpDir: path.join(d, "tmp") });
  // M14: migration 15 (m14-backup-owner) follows 14 in the same run; it only adds columns to backups and one index (M14-BKP-03).
  assert.deepEqual([r.schemaBefore, r.schemaAfter, r.integrity, r.rowCountsUnchanged], [13, MIGRATIONS.at(-1).version, "ok", true]);
  // 2.19.1: migration 16 (l3ga-wishlist) follows; it only adds the wishlist table and one index.
  assert.deepEqual(r.pending, ["14:m13-desk", "15:m14-backup-owner", "16:l3ga-wishlist"]);
  const source = new DatabaseSync(file, { readOnly: true });
  try { assert.equal(source.prepare("SELECT MAX(version) AS v FROM schema_migrations").get().v, 13); } finally { source.close(); }
  const db = openDatabase(file);
  try {
    const after = master(db);
    for (const [name, sql] of Object.entries(before)) if (name !== "backups") assert.equal(after[name], sql, `${name} unchanged`);
    assert.deepEqual(Object.keys(after).filter((n) => !(n in before)).sort(), [...NEW_TABLES, ...NEW_INDEXES, "idx_backups_status", "wishlist_items", "idx_wishlist_status"].sort());
  } finally { db.close(); }
});
