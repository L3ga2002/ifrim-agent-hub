// M08 package A1: data relocation on SYNTHETIC folders inside .ifrim/tmp (never the real data). Copy + verification, stored-path
// rewrite, V1 entries left alone, the pointer and the V2_MOVED.json marker (never two active databases), refusals while a Hub
// answers, and both rollback paths.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import { tempDir } from "./helpers.mjs";
import { openDatabase } from "../server/storage/db.mjs";
import { resolveDataLocation, loadConfig, MOVED_MARKER, isV2DataEntry } from "../server/config.mjs";
import { plan, dryRun, apply, rollback, rewritePaths, isSyncedPath } from "../scripts/relocate-data.mjs";

const closedPort = 1; // nothing answers there

function makeTree() {
  const root = tempDir("reloc");
  const loc = { source: "test", dataDir: path.join(root, "old", "private"), backupDir: path.join(root, "old", "BACKUPS", "v2"), workDir: path.join(root, "old", "tmp", "v2"), dataRoot: null };
  for (const d of [loc.dataDir, loc.backupDir, loc.workDir]) fs.mkdirSync(d, { recursive: true });
  const db = openDatabase(path.join(loc.dataDir, "hub-v2.sqlite"));
  db.prepare("INSERT INTO backups (id, project_id, reason, status, archive_path, manifest_path, created_at) VALUES ('bkp_1', 'p', 'test', 'verified', ?, ?, ?)")
    .run(path.join(loc.backupDir, "a.zip"), path.join(loc.backupDir, "a.json"), new Date().toISOString());
  db.exec("PRAGMA foreign_keys = OFF");
  db.prepare("INSERT INTO factory_bundles (id, mission_id, change_set_id, change_set_sha, spec_version, manifest_json, sha256, status, file_path, created_at) VALUES ('bnd_1', 'mis_x', 'cs', 'sha', 1, '{}', 'x', 'READY_FOR_OWNER_ACCEPTANCE', ?, ?)")
    .run(path.relative(root, path.join(loc.workDir, "factory", "mis_x", "delivery", "bnd_1.md")), new Date().toISOString());
  db.close();
  fs.mkdirSync(path.join(loc.dataDir, "v2-attachments", "conv"), { recursive: true });
  fs.writeFileSync(path.join(loc.dataDir, "v2-attachments", "conv", "f.txt"), "attachment");
  fs.writeFileSync(path.join(loc.dataDir, "v2-hub.log"), "log");
  // V1 / OpenClaw files share the folder: they must never move.
  fs.writeFileSync(path.join(loc.dataDir, "agent-hub.sqlite"), "V1 database (synthetic)");
  fs.mkdirSync(path.join(loc.dataDir, "openclaw"), { recursive: true });
  fs.writeFileSync(path.join(loc.dataDir, "openclaw", "state.json"), "{}");
  fs.writeFileSync(path.join(loc.backupDir, "a.zip"), "zip");
  fs.writeFileSync(path.join(loc.backupDir, "a.json"), "{}");
  fs.mkdirSync(path.join(loc.workDir, "factory", "mis_x", "delivery"), { recursive: true });
  fs.writeFileSync(path.join(loc.workDir, "factory", "mis_x", "delivery", "bnd_1.md"), "# bundle");
  return { root, loc, target: path.join(root, "new-root"), pointer: path.join(root, "data-location.json") };
}

test("D-A1: the V2 entry filter keeps V1 and OpenClaw files out", () => {
  for (const n of ["hub-v2.sqlite", "hub-v2.sqlite-wal", "v2-attachments", "v2-hub.log", "browser-evidence", "sales-imports"]) assert.equal(isV2DataEntry(n), true, n);
  for (const n of ["agent-hub.sqlite", "openclaw", "agent-hub.sqlite-wal", ".env", "secrets.json"]) assert.equal(isV2DataEntry(n), false, n);
  assert.equal(isSyncedPath("C:\\Users\\x\\OneDrive\\Desktop\\a"), true);
  assert.equal(isSyncedPath("C:\\Users\\x\\IfrimHub\\hub-data"), false);
});

test("D-A1: plan and dry run change nothing; the dry-run staging copy is verified and removed", async () => {
  const t = makeTree();
  const p = plan({ location: t.loc, target: t.target });
  assert.equal(p.database.exists, true);
  assert.equal(p.parts.find((x) => x.key === "private").files, 2); // the attachment and the log; never the V1 files
  assert.equal(p.notMoved.entriesInDataDir, 2);
  const r = await dryRun({ location: t.loc, target: t.target, test: true, hubRoot: t.root });
  assert.equal(r.ok, true);
  assert.equal(r.evidence.database.integrity, "ok");
  assert.equal(r.evidence.database.pathsRewritten["backups.archive_path"], 1);
  assert.equal(fs.existsSync(r.staging), false);
  assert.equal(fs.existsSync(t.target), false);
  assert.equal(fs.existsSync(t.pointer), false);
  assert.equal(fs.existsSync(path.join(t.loc.dataDir, MOVED_MARKER)), false);
});

test("D-A1: apply copies, verifies, rewrites stored paths, writes the pointer and marks the old folder", async () => {
  const t = makeTree();
  const out = await apply({ location: t.loc, target: t.target, test: true, port: closedPort, locationFile: t.pointer, hubRoot: t.root });
  assert.equal(out.ok, true);
  const newDb = path.join(t.target, "private", "hub-v2.sqlite");
  assert.equal(fs.existsSync(newDb), true);
  assert.equal(fs.existsSync(path.join(t.target, "private", "agent-hub.sqlite")), false, "V1 database never moves");
  assert.equal(fs.existsSync(path.join(t.target, "private", "openclaw")), false);
  assert.equal(fs.readFileSync(path.join(t.target, "private", "v2-attachments", "conv", "f.txt"), "utf8"), "attachment");
  assert.equal(fs.existsSync(path.join(t.target, "backups", "v2", "a.zip")), true);
  assert.equal(fs.existsSync(path.join(t.target, "work", "factory", "mis_x", "delivery", "bnd_1.md")), true);
  // The old data is untouched (nothing deleted), and the old folder can no longer be opened by a V2 Hub.
  assert.equal(fs.existsSync(path.join(t.loc.dataDir, "hub-v2.sqlite")), true);
  assert.equal(fs.existsSync(path.join(t.loc.dataDir, MOVED_MARKER)), true);
  assert.throws(() => loadConfig({ testMode: true, dataDir: t.loc.dataDir, port: 1 }), /mutate/);
  // Stored paths follow the move in the copy only.
  const db = new DatabaseSync(newDb, { readOnly: true });
  const b = db.prepare("SELECT archive_path FROM backups WHERE id = 'bkp_1'").get();
  const f = db.prepare("SELECT file_path FROM factory_bundles WHERE id = 'bnd_1'").get();
  db.close();
  assert.equal(b.archive_path, path.join(t.target, "backups", "v2", "a.zip"));
  assert.equal(path.resolve(t.root, f.file_path), path.join(t.target, "work", "factory", "mis_x", "delivery", "bnd_1.md"));
  const old = new DatabaseSync(path.join(t.loc.dataDir, "hub-v2.sqlite"), { readOnly: true });
  assert.equal(old.prepare("SELECT archive_path FROM backups WHERE id = 'bkp_1'").get().archive_path, path.join(t.loc.backupDir, "a.zip"));
  old.close();
  // The pointer resolves the new location (outside test mode); a second apply is refused.
  const resolved = resolveDataLocation({ env: {}, locationFile: t.pointer, testMode: false });
  assert.equal(resolved.source, "pointer");
  assert.equal(resolved.dataDir, path.join(t.target, "private"));
  await assert.rejects(apply({ location: t.loc, target: t.target, test: true, port: closedPort, locationFile: t.pointer, hubRoot: t.root }), /nu e goală/);
  await assert.rejects(apply({ location: { ...resolved }, target: path.join(t.root, "third"), test: true, port: closedPort, locationFile: t.pointer, hubRoot: t.root }), /deja mutate/);
  // Rollback without changes: the old folder is active again, the new copy is marked, the pointer is kept as a record.
  const rb = await rollback({ port: closedPort, locationFile: t.pointer, hubRoot: t.root });
  assert.equal(rb.ok, true);
  assert.equal(rb.changedAfterMove, false);
  assert.equal(fs.existsSync(t.pointer), false);
  assert.equal(fs.existsSync(path.join(t.loc.dataDir, MOVED_MARKER)), false);
  assert.equal(fs.existsSync(path.join(t.target, "private", MOVED_MARKER)), true);
  assert.equal(fs.existsSync(newDb), true, "rollback deletes nothing");
  assert.doesNotThrow(() => loadConfig({ testMode: true, dataDir: t.loc.dataDir, port: 1 }));
  assert.throws(() => loadConfig({ testMode: true, dataDir: path.join(t.target, "private"), port: 1 }), /mutate/);
});

test("D-A1: a changed new database needs an explicit rollback choice; --copy-back brings the data and the paths back", async () => {
  const t = makeTree();
  await apply({ location: t.loc, target: t.target, test: true, port: closedPort, locationFile: t.pointer, hubRoot: t.root });
  const newDb = path.join(t.target, "private", "hub-v2.sqlite");
  const db = new DatabaseSync(newDb);
  db.prepare("INSERT INTO backups (id, project_id, reason, status, archive_path, created_at) VALUES ('bkp_2', 'p', 'after-move', 'verified', ?, ?)").run(path.join(t.target, "backups", "v2", "b.zip"), new Date().toISOString());
  db.close();
  fs.writeFileSync(path.join(t.target, "backups", "v2", "b.zip"), "zip2");
  await assert.rejects(rollback({ port: closedPort, locationFile: t.pointer, hubRoot: t.root }), /s-a schimbat după mutare/);
  const rb = await rollback({ copyBack: true, port: closedPort, locationFile: t.pointer, hubRoot: t.root });
  assert.equal(rb.copiedBack, true);
  assert.equal(rb.restored.integrity, "ok");
  const old = new DatabaseSync(path.join(t.loc.dataDir, "hub-v2.sqlite"), { readOnly: true });
  const rows = old.prepare("SELECT id, archive_path FROM backups ORDER BY id").all();
  old.close();
  assert.deepEqual(rows.map((r) => r.id), ["bkp_1", "bkp_2"]);
  assert.equal(rows[0].archive_path, path.join(t.loc.backupDir, "a.zip"));
  assert.equal(rows[1].archive_path, path.join(t.loc.backupDir, "b.zip"));
  assert.equal(fs.readFileSync(path.join(t.loc.backupDir, "b.zip"), "utf8"), "zip2");
  assert.ok(fs.readdirSync(t.loc.dataDir).some((n) => n.startsWith("hub-v2.sqlite.pre-rollback-")), "the pre-move database is kept aside");
});

test("D-A1: refusals — a Hub that answers, a synced or overlapping target, a target outside .ifrim/tmp in test mode", async () => {
  const t = makeTree();
  const server = http.createServer((req, res) => { res.end("{}"); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    await assert.rejects(apply({ location: t.loc, target: t.target, test: true, port: server.address().port, locationFile: t.pointer, hubRoot: t.root }), /Oprește întâi Hub-ul/);
  } finally { await new Promise((r) => server.close(r)); }
  assert.equal(fs.existsSync(t.target), false);
  await assert.rejects(apply({ location: t.loc, target: path.join(t.loc.dataDir, "inner"), test: true, port: closedPort, locationFile: t.pointer }), /suprapune/);
  await assert.rejects(apply({ location: t.loc, target: "relative/path", test: true, port: closedPort, locationFile: t.pointer }), /absolută/);
  await assert.rejects(apply({ location: t.loc, target: path.join(process.env.TEMP || "C:\\Temp", "m08-x"), test: true, port: closedPort, locationFile: t.pointer }), /\.ifrim\/tmp/);
  await assert.rejects(dryRun({ location: t.loc, target: "C:\\Users\\x\\OneDrive\\data", test: false }), /sincronizat/);
});

test("D-A1: rewritePaths only touches prefixes under the moved folders", () => {
  const root = tempDir("rewrite");
  const file = path.join(root, "x.sqlite");
  const db = openDatabase(file);
  db.prepare("INSERT INTO backups (id, project_id, reason, status, archive_path, created_at) VALUES ('a', 'p', 'r', 's', ?, ?), ('b', 'p', 'r', 's', ?, ?)")
    .run(path.join(root, "old", "b", "1.zip"), "t", path.join(root, "elsewhere", "2.zip"), "t");
  db.close();
  const counts = rewritePaths(file, { dataDir: path.join(root, "old", "d"), backupDir: path.join(root, "old", "b"), workDir: path.join(root, "old", "w") },
    { dataDir: path.join(root, "new", "d"), backupDir: path.join(root, "new", "b"), workDir: path.join(root, "new", "w") }, root);
  assert.equal(counts["backups.archive_path"], 1);
  const check = new DatabaseSync(file, { readOnly: true });
  assert.deepEqual(check.prepare("SELECT archive_path FROM backups ORDER BY id").all().map((r) => r.archive_path), [path.join(root, "new", "b", "1.zip"), path.join(root, "elsewhere", "2.zip")]);
  check.close();
});
