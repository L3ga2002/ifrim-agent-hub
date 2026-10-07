// M11 U2 — migration 12 `m11-deliveries` (PASS_LOCAL: temporary databases only). Purely additive on schema 11; the CHECK lists
// are the pure modules' own constants, so the database and stale.mjs / revision.mjs can never disagree on a status.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase } from "../server/storage/db.mjs";
import { MIGRATIONS } from "../server/storage/migrations.mjs";
import { dryRunMigration } from "../server/storage/upgrade.mjs";
import { ITEM_KINDS, ITEM_STATUSES, DELIVERY_STATUSES } from "../server/delivery/stale.mjs";
import { REVISION_RECORD_STATUS } from "../server/delivery/revision.mjs";

const tempDir = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
const NEW_TABLES = ["deliveries", "delivery_items", "delivery_documents", "delivery_revisions"];
/** The values inside `CHECK (<column> IN (...))` of a table's DDL. */
const checkValues = (db, table, column) => {
  const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table).sql;
  const m = sql.match(new RegExp(`${column} TEXT NOT NULL(?: DEFAULT '[A-Z]+')? CHECK \\(${column} IN \\(([^)]*)\\)\\)`));
  return m ? m[1].split(",").map((v) => v.trim().replace(/'/g, "")) : null;
};

test("M11-MG-01 migration 12 on schema 11: four new tables, no other table changes, rows kept (dry run on a copy, then for real)", async () => {
  const dir = tempDir("m11-mig");
  const file = path.join(dir, "hub-v2.sqlite");
  const db11 = openDatabase(file, { migrations: MIGRATIONS.filter((m) => m.version <= 11) });
  db11.prepare("INSERT INTO settings (key, value_json, updated_at) VALUES ('m11-probe', '\"kept\"', ?)").run(new Date().toISOString());
  const before = Object.fromEntries(db11.prepare("SELECT name, sql FROM sqlite_master WHERE type IN ('table','index') AND sql IS NOT NULL").all().map((r) => [r.name, r.sql]));
  db11.close();
  const r = await dryRunMigration({ dbPath: file, tmpDir: path.join(dir, "tmp") });
  assert.deepEqual([r.schemaBefore, r.schemaAfter, r.integrity, r.rowCountsUnchanged], [11, 12, "ok", true]);
  assert.deepEqual(r.pending, ["12:m11-deliveries"]);
  const db = openDatabase(file);
  try {
    const after = Object.fromEntries(db.prepare("SELECT name, sql FROM sqlite_master WHERE type IN ('table','index') AND sql IS NOT NULL").all().map((r) => [r.name, r.sql]));
    for (const [name, sql] of Object.entries(before)) assert.equal(after[name], sql, `${name} unchanged`);
    const added = Object.keys(after).filter((n) => !(n in before)).sort();
    assert.deepEqual(added, [...NEW_TABLES, "idx_deliveries_mission", "idx_deliveries_project", "idx_delivery_items_delivery", "idx_delivery_items_ref", "idx_delivery_revisions_delivery", "ux_deliveries_envelope", "ux_deliveries_open_project"].sort());
    assert.equal(db.prepare("SELECT value_json FROM settings WHERE key = 'm11-probe'").get().value_json, "\"kept\"");
  } finally { db.close(); }
});

test("M11-MG-02 the CHECK lists are the pure modules' constants", () => {
  const dir = tempDir("m11-mig-check");
  const db = openDatabase(path.join(dir, "hub-v2.sqlite"));
  try {
    assert.deepEqual(checkValues(db, "deliveries", "status"), DELIVERY_STATUSES);
    assert.deepEqual(checkValues(db, "delivery_items", "kind"), ITEM_KINDS);
    assert.deepEqual(checkValues(db, "delivery_items", "status"), ITEM_STATUSES);
    assert.deepEqual(checkValues(db, "delivery_documents", "status"), ITEM_STATUSES, "a document version follows the item statuses");
    const revision = checkValues(db, "delivery_revisions", "status");
    for (const s of new Set(Object.values(REVISION_RECORD_STATUS))) assert.ok(revision.includes(s), `revision status ${s} is allowed`);
  } finally { db.close(); }
});

test("M11-MG-03 one open delivery per project (ARMED/ACTIVE), one delivery per envelope; closed ones never block", () => {
  const dir = tempDir("m11-mig-ux");
  const db = openDatabase(path.join(dir, "hub-v2.sqlite"));
  try {
    const now = new Date().toISOString();
    db.prepare("PRAGMA foreign_keys = OFF").run();
    const add = (id, status, envelope = null, project = "prj_a") => db.prepare(`INSERT INTO deliveries (id, project_id, title, status, envelope_id, template_json, template_sha, ops_steps_json, ops_body_sha, created_by, created_at, updated_at)
      VALUES (?, ?, 't', ?, ?, '{}', 's', '[]', 'b', 'test', ?, ?)`).run(id, project, status, envelope, now, now);
    add("dlv_1", "ARMED", "env_1");
    assert.throws(() => add("dlv_2", "ACTIVE", "env_2"), /UNIQUE/, "a second open delivery on the same project");
    add("dlv_3", "CLOSED", "env_3");
    add("dlv_4", "READY", null);
    add("dlv_5", "ACTIVE", "env_5", "prj_b");
    assert.throws(() => add("dlv_6", "PLANNED", "env_1", "prj_c"), /UNIQUE/, "one delivery per envelope");
    assert.throws(() => add("dlv_7", "DONE"), /CHECK/);
    assert.throws(() => db.prepare("INSERT INTO delivery_items (id, delivery_id, kind, ref_table, ref_id, created_by, created_at, updated_at) VALUES ('i', 'dlv_1', 'video', 't', 'r', 'x', ?, ?)").run(now, now), /CHECK/);
  } finally { db.close(); }
});
