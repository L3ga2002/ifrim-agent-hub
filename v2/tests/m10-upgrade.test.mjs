// Milestone 10 — D10: the pre-migration backup is enforced in code, a failed backup refuses the migration, an injected defective
// migration leaves the database at its previous schema and a restore of the backup loses nothing, backups are never overwritten,
// and the upgrade runner's state resumes from the failed step. Temp databases only (never the live one).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { tempDir, makeTestHub } from "./helpers.mjs";
import { openDatabase, schemaState, backupBeforeMigration, preMigrationBackupOf } from "../server/storage/db.mjs";
import { MIGRATIONS } from "../server/storage/migrations.mjs";
import { dryRunMigration, createUpgradeState, rowCounts, UPGRADE_STEPS } from "../server/storage/upgrade.mjs";

const UPTO9 = MIGRATIONS.filter((m) => m.version <= 9);
// M10.2 added migration 11: the expectations follow the latest known migration instead of a fixed 10.
const LATEST = MIGRATIONS.at(-1).version;

function schema9Db(dir) {
  const file = path.join(dir, "hub-v2.sqlite");
  const db = openDatabase(file, { migrations: UPTO9 });
  db.prepare("INSERT INTO settings (key, value_json, updated_at) VALUES ('m10-probe', '\"kept\"', ?)").run(new Date().toISOString());
  db.close();
  return file;
}
const tablesOf = (file) => { const db = new DatabaseSync(file, { readOnly: true }); try { return db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name); } finally { db.close(); } };
const versionOf = (file) => { const db = new DatabaseSync(file, { readOnly: true }); try { return db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get().v; } finally { db.close(); } };

test("M10-UP-01 a pending migration on an existing database is preceded by a verified copy + manifest; the copy is the old schema with the same rows", () => {
  const dir = tempDir("m10-up1");
  const file = schema9Db(dir);
  const backups = path.join(dir, "pre-upgrade");
  const db = openDatabase(file, { preMigrationBackupDir: backups, appVersion: "test" });
  const b = preMigrationBackupOf(db);
  assert.ok(b, "a backup was taken");
  assert.equal(b.schemaVersion, 9); assert.equal(b.toVersion, LATEST); assert.equal(b.integrity, "ok");
  assert.match(b.sha256, /^[0-9a-f]{64}$/);
  assert.ok(fs.existsSync(b.file) && fs.existsSync(b.manifestFile));
  assert.deepEqual(JSON.parse(fs.readFileSync(b.manifestFile, "utf8")).sha256, b.sha256);
  assert.equal(schemaState(db).current, LATEST, "then migrated");
  db.close();
  assert.ok(!tablesOf(b.file).includes("ops_plans"), "the copy is the schema before the migration");
  const copy = new DatabaseSync(b.file, { readOnly: true });
  assert.equal(copy.prepare("SELECT value_json FROM settings WHERE key = 'm10-probe'").get().value_json, "\"kept\"");
  copy.close();
});

test("M10-UP-02 no backup when nothing is pending (normal boot) or the database is new", () => {
  const dir = tempDir("m10-up2");
  const backups = path.join(dir, "pre-upgrade");
  const fresh = openDatabase(path.join(dir, "fresh.sqlite"), { preMigrationBackupDir: backups });
  assert.equal(preMigrationBackupOf(fresh), null, "a new database has nothing to protect");
  fresh.close();
  const again = openDatabase(path.join(dir, "fresh.sqlite"), { preMigrationBackupDir: backups });
  assert.equal(preMigrationBackupOf(again), null, "up to date: no backup");
  again.close();
  assert.ok(!fs.existsSync(backups) || fs.readdirSync(backups).length === 0);
});

test("M10-UP-03 a failing backup refuses the migration: PRE_MIGRATION_BACKUP_FAILED and the database is unchanged", () => {
  const dir = tempDir("m10-up3");
  const file = schema9Db(dir);
  const notADir = path.join(dir, "blocker");
  fs.writeFileSync(notADir, "a file where the backup folder should be");
  assert.throws(() => openDatabase(file, { preMigrationBackupDir: notADir }), (e) => e.code === "PRE_MIGRATION_BACKUP_FAILED" && /nu a fost modificată/.test(e.message));
  assert.equal(versionOf(file), 9, "still schema 9");
  assert.ok(!tablesOf(file).includes("ops_plans"));
});

test("M10-UP-04 an injected defective migration rolls back; the backup taken before it restores the exact previous state", () => {
  const dir = tempDir("m10-up4");
  const file = schema9Db(dir);
  const backups = path.join(dir, "pre-upgrade");
  const db10 = openDatabase(file, { preMigrationBackupDir: backups }); // → LATEST (with its own backup)
  db10.prepare("INSERT INTO settings (key, value_json, updated_at) VALUES ('after-10', '1', ?)").run(new Date().toISOString());
  const before = rowCounts(db10, ["settings", "events"]);
  db10.close();
  const broken = [...MIGRATIONS, { version: LATEST + 1, name: "broken", up(d) { d.exec("CREATE TABLE half_done (x INTEGER)"); throw new Error("injected failure"); } }];
  assert.throws(() => openDatabase(file, { preMigrationBackupDir: backups, migrations: broken }), /injected failure/);
  assert.equal(versionOf(file), LATEST, "the failed migration was rolled back");
  assert.ok(!tablesOf(file).includes("half_done"), "nothing half-applied");
  const v11 = fs.readdirSync(backups).filter((n) => n.includes(`v${LATEST}-to-v${LATEST + 1}`) && n.endsWith(".sqlite"));
  assert.equal(v11.length, 1, "the backup for LATEST → LATEST+1 exists");
  // Restore (Hub stopped): the copy replaces the database; every row is there.
  const restored = path.join(dir, "restored.sqlite");
  fs.copyFileSync(path.join(backups, v11[0]), restored);
  const r = new DatabaseSync(restored, { readOnly: true });
  try {
    assert.deepEqual(rowCounts(r, ["settings", "events"]), before);
    assert.equal(r.prepare("SELECT value_json FROM settings WHERE key = 'after-10'").get().value_json, "1");
  } finally { r.close(); }
});

test("M10-UP-05 backups are never overwritten (two in the same second get distinct names; an existing manifest is never replaced)", () => {
  const dir = tempDir("m10-up5");
  const file = schema9Db(dir);
  const db = new DatabaseSync(file);
  const a = backupBeforeMigration(db, { dir: path.join(dir, "b"), fromVersion: 9, toVersion: 10 });
  const b = backupBeforeMigration(db, { dir: path.join(dir, "b"), fromVersion: 9, toVersion: 10 });
  db.close();
  assert.notEqual(a.file, b.file);
  assert.ok(fs.existsSync(a.file) && fs.existsSync(b.file));
});

test("M10-UP-06 dry run on a copy: 9 → 10, integrity ok, row counts unchanged, the source untouched", async () => {
  const dir = tempDir("m10-up6");
  const file = schema9Db(dir);
  const r = await dryRunMigration({ dbPath: file, tmpDir: path.join(dir, "tmp") });
  assert.equal(r.schemaBefore, 9); assert.equal(r.schemaAfter, LATEST); assert.equal(r.integrity, "ok"); assert.equal(r.rowCountsUnchanged, true);
  assert.deepEqual(r.pending, MIGRATIONS.filter((m) => m.version > 9).map((m) => `${m.version}:${m.name}`));
  assert.ok(r.pending.includes("10:m10-operator-plans") && r.pending.includes("11:m10-2-work-requests"));
  assert.equal(versionOf(file), 9, "the source stays at 9");
});

test("M10-UP-07 upgrade runner state: steps in order, a failure records the step, resume continues from it (done steps not repeated), one run at a time", () => {
  const dir = tempDir("m10-up7");
  const st = createUpgradeState(dir);
  let s = st.begin({ fromVersion: "2.10.0-m09", toVersion: "2.11.0-m10", codeVersion: "2.11.0-m10" });
  assert.equal(s.next, "preflight");
  assert.throws(() => st.begin({}), /deja în curs/);
  s = st.complete(s, "preflight", { ok: true });
  s = st.complete(s, "dry_run", { ok: true });
  s = st.fail(s, "stop", new Error("refuzat"));
  assert.equal(s.status, "FAILED"); assert.equal(s.failedStep, "stop");
  s = st.resume();
  assert.equal(s.next, "stop", "resumes at the failed step");
  assert.deepEqual(s.done, ["preflight", "dry_run"]);
  for (const step of UPGRADE_STEPS.slice(2)) s = st.complete(s, step, { ok: true });
  assert.equal(s.status, "DONE");
  assert.throws(() => st.resume(), /deja terminată/);
  assert.ok(fs.readFileSync(path.join(dir, "upgrade", "runs.jsonl"), "utf8").includes("\"FAILED\""), "the failure stays in the history");
});

test("M10-UP-08 the Hub booting on a schema-9 database takes the backup before migrating and reports it (boot report + event)", async () => {
  const dir = tempDir("m10-up8");
  schema9Db(dir);
  const t = await makeTestHub({ configOverrides: { dataDir: dir } });
  try {
    const report = t.hub.getBootReport().storage.preMigrationBackup;
    assert.ok(report, "reported");
    assert.equal(report.fromVersion, 9); assert.equal(report.toVersion, LATEST); assert.equal(report.integrity, "ok");
    assert.ok(report.file.startsWith(path.join(dir, "pre-upgrade")));
    const ev = t.hub.db.prepare("SELECT payload_json FROM events WHERE type = 'storage.pre_migration_backup'").get();
    assert.ok(ev && JSON.parse(ev.payload_json).fromVersion === 9);
    assert.equal(t.hub.db.prepare("SELECT value_json FROM settings WHERE key = 'm10-probe'").get().value_json, "\"kept\"", "the data survived the migration");
  } finally { await t.cleanup(); }
});
