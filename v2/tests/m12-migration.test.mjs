// M12 WP4 — migration 13 `m12-sales-prep` (temporary databases only; no Hub is constructed). Purely additive on schema 12: the C-03
// data kind on sales_evidence (legacy rows stay NULL, never rewritten) and three new tables whose CHECK lists are the constants of
// sales.mjs; everything they hold is synthetic. A schema-12 database gets a verified pre-migration backup, the dry run on a copy
// leaves the source at 12, the logon boot guard reports the migration as pending, and the schema-12 code's evidence insert still works.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { tempDir, TEST_TMP } from "./helpers.mjs";
import { openDatabase, schemaState, preMigrationBackupOf } from "../server/storage/db.mjs";
import { MIGRATIONS } from "../server/storage/migrations.mjs";
import { dryRunMigration } from "../server/storage/upgrade.mjs";
import { DATA_KINDS, PREPARATION_STATUSES, DOSSIER_STATUSES, PLAN_OP_STATUSES } from "../server/sales/sales.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const UPTO12 = MIGRATIONS.filter((m) => m.version <= 12);
// M13: these tests describe migration 13 exactly; migration 14 (m13-desk) is tested in m13-migration.test.mjs.
const UPTO13 = MIGRATIONS.filter((m) => m.version <= 13);
const NEW_TABLES = ["sales_dossiers", "sales_plan_ops", "sales_preparations"];
const NEW_INDEXES = ["idx_sales_dossiers_opp", "idx_sales_plan_ops_root", "idx_sales_preparations_opp", "ux_sales_preparations_root"];
const NOW = "2026-10-17T08:00:00.000Z";

function dir(t, label) {
  const d = tempDir(label);
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}
const columns = (db, table) => db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
/** The values inside `CHECK (<column> IN (...))` of a table's DDL. */
const checkValues = (db, table, column) => {
  const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table).sql;
  const m = sql.match(new RegExp(`${column} TEXT(?: NOT NULL)? CHECK \\((?:${column} IS NULL OR )?${column} IN \\(([^)]*)\\)\\)`));
  return m ? m[1].split(",").map((v) => v.trim().replace(/'/g, "")) : null;
};
const master = (db) => Object.fromEntries(db.prepare("SELECT name, sql FROM sqlite_master WHERE type IN ('table','index') AND sql IS NOT NULL").all().map((r) => [r.name, r.sql]));
/** The INSERT the schema-12 code (M04 addEvidenceRow) runs: the 19 columns it knows. */
const LEGACY_EVIDENCE_INSERT = `INSERT INTO sales_evidence (id, subject_type, subject_id, subject_version, claim, value_json, label, source_kind, source_ref, retrieved_at, excerpt,
  method, verified_at, recheck_after, contradicts_json, synthetic, batch_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
const legacyEvidence = (db, id) => db.prepare(LEGACY_EVIDENCE_INSERT).run(id, "org", "org_m12mig", 1, "website", "\"https://m12-mig.test\"", "OBSERVED", "fixture",
  "fixture:m12-mig.test", NOW, "", "static-html", null, null, "[]", 1, null, "test", NOW);

function schema12Db(d) {
  const file = path.join(d, "hub-v2.sqlite");
  const db = openDatabase(file, { migrations: UPTO12 });
  db.prepare("INSERT INTO sales_orgs (id, display_name, normalized_name, status, synthetic, created_at, updated_at) VALUES ('org_m12mig', 'Firma Migrare Sintetic SRL', 'firma migrare sintetic', 'NEW', 1, ?, ?)").run(NOW, NOW);
  legacyEvidence(db, "sev_m12mig_legacy");
  db.close();
  return file;
}

test("M12-MIG-01 fresh database: data kind on sales_evidence, the three M12 tables, CHECK lists equal to the sales.mjs constants, synthetic only", (t) => {
  const db = openDatabase(path.join(dir(t, "m12-mig1"), "hub-v2.sqlite"), { migrations: UPTO13 });
  try {
    assert.equal(schemaState(db, UPTO13).current, 13);
    assert.equal(UPTO13.at(-1).name, "m12-sales-prep");
    assert.deepEqual(columns(db, "sales_evidence").slice(-3), ["data_kind", "basis_json", "reasoning"]);
    assert.deepEqual(checkValues(db, "sales_evidence", "data_kind"), DATA_KINDS);
    for (const [table, cols] of Object.entries({
      sales_preparations: ["id", "root_plan_id", "root_plan_hash", "phase_b_plan_id", "brief_json", "brief_sha", "org_id", "opportunity_id", "proposal_id", "awaited_proposal_id", "awaited_proposal_sha", "status", "stale_reason", "synthetic", "created_at", "updated_at",
        // part 3: the plan whose consent governs (the root or a continuation), the reason of every status, the continuation window
        "plan_id", "status_reason", "activate_by"],
      sales_plan_ops: ["op_key", "root_plan_id", "root_plan_hash", "op", "params_json", "status", "claim_token", "result_json", "fixed_at", "synthetic", "created_at", "updated_at"],
      sales_dossiers: ["id", "preparation_id", "opportunity_id", "proposal_id", "proposal_sha", "revision", "folder", "files_json", "manifest_sha256", "verification_json", "status", "op_key", "synthetic",
        // part 3: what the dossier is evidence of (its company, draft and inputs) and the plan that wrote it
        "org_id", "draft_id", "draft_sha", "inputs_json", "inputs_sha", "ops_plan_id"],
    })) for (const c of cols) assert.ok(columns(db, table).includes(c), `${table}.${c}`);
    assert.deepEqual(checkValues(db, "sales_preparations", "status"), PREPARATION_STATUSES);
    assert.deepEqual(checkValues(db, "sales_dossiers", "status"), DOSSIER_STATUSES);
    assert.deepEqual(checkValues(db, "sales_plan_ops", "status"), PLAN_OP_STATUSES);
    for (const table of NEW_TABLES) assert.match(db.prepare("SELECT sql FROM sqlite_master WHERE name = ?").get(table).sql, /synthetic INTEGER NOT NULL DEFAULT 1 CHECK \(synthetic = 1\)/, table);
    assert.equal(columns(db, "sales_handoffs").includes("dossier_id"), false, "sales_handoffs is untouched");

    db.prepare("PRAGMA foreign_keys = OFF").run();
    const prep = (id, root, synthetic = 1, status = "PLANNED") => db.prepare(`INSERT INTO sales_preparations (id, root_plan_id, root_plan_hash, brief_json, brief_sha, status, synthetic, created_by, created_at, updated_at)
      VALUES (?, ?, 'h', '{}', 's', ?, ?, 'test', ?, ?)`).run(id, root, status, synthetic, NOW, NOW);
    prep("spp_1", "opp_plan_1");
    assert.throws(() => prep("spp_2", "opp_plan_1"), /UNIQUE/, "one preparation per confirmed root plan");
    assert.throws(() => prep("spp_3", "opp_plan_3", 0), /CHECK/, "never a real row");
    assert.throws(() => prep("spp_4", "opp_plan_4", 1, "DONE"), /CHECK/);
    const op = (key, status = "IN_PROGRESS", synthetic = 1) => db.prepare(`INSERT INTO sales_plan_ops (op_key, root_plan_id, root_plan_hash, op, params_json, status, fixed_at, synthetic, created_at, updated_at)
      VALUES (?, 'opp_plan_1', 'h', 'sales.synthetic', '{}', ?, ?, ?, ?, ?)`).run(key, status, NOW, synthetic, NOW, NOW);
    op("k1");
    assert.throws(() => op("k1", "DONE"), /UNIQUE|PRIMARY/, "one ledger row per op key");
    assert.throws(() => op("k2", "RUNNING"), /CHECK/);
    assert.throws(() => op("k3", "DONE", 0), /CHECK/);
    const dossier = (id, revision, key, status = "WRITING", synthetic = 1) => db.prepare(`INSERT INTO sales_dossiers (id, preparation_id, opportunity_id, proposal_id, proposal_sha, revision, folder, status, op_key, synthetic, created_by, created_at, updated_at)
      VALUES (?, 'spp_1', 'opp_1', 'spr_1', 'sha', ?, 'C:/x', ?, ?, ?, 'test', ?, ?)`).run(id, revision, status, key, synthetic, NOW, NOW);
    dossier("sdo_1", 1, "d1");
    assert.throws(() => dossier("sdo_2", 1, "d2"), /UNIQUE/, "one folder per revision");
    assert.throws(() => dossier("sdo_3", 2, "d1"), /UNIQUE/, "one dossier per op key");
    assert.throws(() => dossier("sdo_4", 3, "d4", "CURRENT"), /CHECK/);
    assert.throws(() => dossier("sdo_5", 4, "d5", "READY", 0), /CHECK/);
    assert.throws(() => db.prepare("INSERT INTO sales_evidence (id, subject_type, subject_id, claim, value_json, label, source_kind, source_ref, created_by, created_at, data_kind) VALUES ('sev_x', 'org', 'o', 'c', 'null', 'INFERRED', 'manual', 'r', 't', ?, 'GUESS')").run(NOW), /CHECK/);
  } finally { db.close(); }
});

test("M12-MIG-02 schema 12 → 13: verified pre-migration backup first; legacy evidence keeps its columns and an undeclared (NULL) kind", (t) => {
  const d = dir(t, "m12-mig2");
  const file = schema12Db(d);
  const before = new DatabaseSync(file, { readOnly: true });
  const legacyRow = before.prepare("SELECT * FROM sales_evidence WHERE id = 'sev_m12mig_legacy'").get();
  before.close();
  const backups = path.join(d, "pre-upgrade");
  const db = openDatabase(file, { preMigrationBackupDir: backups, appVersion: "test", migrations: UPTO13 });
  try {
    const b = preMigrationBackupOf(db);
    assert.ok(b, "a backup was taken before migration 13");
    assert.equal(b.schemaVersion, 12); assert.equal(b.toVersion, 13); assert.equal(b.integrity, "ok");
    assert.match(b.sha256, /^[0-9a-f]{64}$/);
    assert.equal(JSON.parse(fs.readFileSync(b.manifestFile, "utf8")).sha256, b.sha256);
    assert.ok(path.basename(b.file).includes("v12-to-v13"));
    const copy = new DatabaseSync(b.file, { readOnly: true });
    try {
      assert.equal(copy.prepare("SELECT MAX(version) AS v FROM schema_migrations").get().v, 12);
      assert.equal(columns(copy, "sales_evidence").includes("data_kind"), false, "the copy is the schema before the migration");
      assert.deepEqual(copy.prepare("SELECT * FROM sales_evidence WHERE id = 'sev_m12mig_legacy'").get(), legacyRow);
    } finally { copy.close(); }
    assert.equal(schemaState(db, UPTO13).current, 13);
    const after = db.prepare("SELECT * FROM sales_evidence WHERE id = 'sev_m12mig_legacy'").get();
    assert.deepEqual([after.data_kind, after.basis_json, after.reasoning], [null, null, null], "legacy evidence stays undeclared (nedeclarat M04)");
    for (const [key, value] of Object.entries(legacyRow)) assert.deepEqual(after[key], value, `legacy ${key} unchanged`);
    for (const table of NEW_TABLES) assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0, `${table} starts empty (no data rewrite)`);
  } finally { db.close(); }
});

test("M12-MIG-03 dry run on a copy: 12 → 13, only additions (three columns, three tables, four indexes), row counts unchanged, source left at 12", async (t) => {
  const d = dir(t, "m12-mig3");
  const file = schema12Db(d);
  const db12 = new DatabaseSync(file, { readOnly: true });
  const before = master(db12);
  const evidenceBefore = columns(db12, "sales_evidence");
  db12.close();
  const r = await dryRunMigration({ dbPath: file, tmpDir: path.join(d, "tmp"), migrations: UPTO13 });
  assert.deepEqual([r.schemaBefore, r.schemaAfter, r.integrity, r.rowCountsUnchanged], [12, 13, "ok", true]);
  assert.deepEqual(r.pending, ["13:m12-sales-prep"]);
  const source = new DatabaseSync(file, { readOnly: true });
  try { assert.equal(source.prepare("SELECT MAX(version) AS v FROM schema_migrations").get().v, 12, "the dry run never touches the source"); } finally { source.close(); }
  const db = openDatabase(file, { migrations: UPTO13 });
  try {
    const after = master(db);
    for (const [name, sql] of Object.entries(before)) if (name !== "sales_evidence") assert.equal(after[name], sql, `${name} unchanged`);
    assert.deepEqual(columns(db, "sales_evidence"), [...evidenceBefore, "data_kind", "basis_json", "reasoning"], "sales_evidence only gains three columns at the end");
    assert.deepEqual(Object.keys(after).filter((n) => !(n in before)).sort(), [...NEW_TABLES, ...NEW_INDEXES].sort());
  } finally { db.close(); }
});

test("M12-MIG-04 the logon boot guard reports 13:m12-sales-prep pending on a schema-12 database (temp data root), then nothing after the migration", (t) => {
  const d = dir(t, "m12-mig4");
  assert.ok(!path.relative(TEST_TMP, d).startsWith(".."), "the data root is a test folder");
  schema12Db(d);
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^HUB_/i.test(k))), HUB_V2_DATA_DIR: d };
  // Isolation preflight: the scripts' data root must resolve to this temp folder before the guard opens any database.
  const common = new URL("../scripts/common.mjs", import.meta.url).href;
  const resolved = spawnSync(process.execPath, ["--input-type=module", "-e", `import(${JSON.stringify(common)}).then((m) => console.log(m.DATA_DIR))`], { env, encoding: "utf8", timeout: 30000 });
  assert.equal(path.resolve(resolved.stdout.trim()), path.resolve(d), resolved.stderr);
  const guard = () => spawnSync(process.execPath, [path.join(here, "..", "scripts", "boot-guard.mjs")], { env, encoding: "utf8", timeout: 30000 });
  const pending = guard();
  assert.equal(pending.status, 3, pending.stderr);
  const later = MIGRATIONS.filter((m) => m.version > 12).map((m) => `${m.version}:${m.name}`);
  assert.ok(later.includes("13:m12-sales-prep"));
  assert.deepEqual(JSON.parse(pending.stdout.trim().split("\n").pop()), { ok: false, applied: 12, latest: MIGRATIONS.at(-1).version, pending: later });
  openDatabase(path.join(d, "hub-v2.sqlite")).close();
  const clear = guard();
  assert.equal(clear.status, 0, clear.stderr);
  assert.deepEqual(JSON.parse(clear.stdout.trim().split("\n").pop()), { ok: true, applied: MIGRATIONS.at(-1).version, latest: MIGRATIONS.at(-1).version, pending: [] });
});

test("M12-MIG-05 additive: the schema-12 code's evidence insert still works on schema 13 (a revert of the release runs on the migrated database)", (t) => {
  const db = openDatabase(path.join(dir(t, "m12-mig5"), "hub-v2.sqlite"));
  try {
    db.prepare("PRAGMA foreign_keys = OFF").run();
    legacyEvidence(db, "sev_m12mig_old_code");
    const row = db.prepare("SELECT data_kind, basis_json, reasoning, label FROM sales_evidence WHERE id = 'sev_m12mig_old_code'").get();
    assert.deepEqual({ ...row }, { data_kind: null, basis_json: null, reasoning: null, label: "OBSERVED" });
  } finally { db.close(); }
});
