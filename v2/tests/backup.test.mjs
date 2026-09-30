import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createBackup, verifyRestore, collectFiles } from "../server/backup/backup.mjs";
import { readZip } from "../server/backup/zip.mjs";
import { tempDir, makeTestHub } from "./helpers.mjs";

/** Fixture reproducing the HUB-018 failure shape: nested BACKUPS with archives, private runtime, env files. */
function makeFixture() {
  const root = tempDir("bkp");
  const project = path.join(root, "project");
  const write = (rel, content) => { fs.mkdirSync(path.dirname(path.join(project, rel)), { recursive: true }); fs.writeFileSync(path.join(project, rel), content); };
  write("src/index.js", "console.log('hi');\n");
  write("README.md", "# fixture\n");
  write(".env", "API_KEY=should-not-be-copied\n");
  write(".env.local", "X=1\n");
  write(".env.example", "API_KEY=\n");
  write("certs/server.pem", "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n");
  write("node_modules/pkg/index.js", "module.exports = 1;\n");
  write(".git/HEAD", "ref: refs/heads/main\n");
  write(".ifrim/BACKUPS/old.zip", Buffer.alloc(2 * 1024 * 1024, 7));
  write(".ifrim/BACKUPS/nested/older.zip", Buffer.alloc(1024, 1));
  write(".ifrim/private/credentials.json", "{\"token\":\"secret\"}");
  write(".ifrim/private/agent-hub.sqlite", "not copied raw");
  write(".ifrim/tmp/scratch.txt", "tmp");
  write(".ifrim/NEXT_SESSION.md", "# memory\n");
  write(".env.hub016-fixture/cfg.json", "{}");
  write("output/report.png", Buffer.from([1, 2, 3]));
  const dbFile = path.join(project, "data", "app.sqlite");
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  const db = new DatabaseSync(dbFile);
  db.exec("PRAGMA journal_mode = WAL; CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO items (name) VALUES ('a'), ('b');");
  // Keep the database open (WAL active) to prove the snapshot is taken through the backup API.
  return { root, project, db, destDir: path.join(root, "out"), scratch: path.join(root, "scratch") };
}

test("T03 backup excludes recursion, private runtime, secrets and regenerable dirs; keeps restore data", async () => {
  const fx = makeFixture();
  try {
    const result = await createBackup({ backupId: "bkp_test1", projectRoot: fx.project, destDir: fx.destDir });
    assert.equal(result.status, "created", JSON.stringify(result.skipped));
    const names = result.manifest.entries.map((e) => e.path).sort();
    assert.deepEqual(names, [".env.example", ".ifrim/NEXT_SESSION.md", "README.md", "data/app.sqlite", "output/report.png", "src/index.js"]);
    assert.ok(result.manifest.excludedSecretLikeNames.includes(".env"));
    assert.ok(result.manifest.excludedSecretLikeNames.includes("certs/server.pem"));
    const prunedPaths = result.manifest.pruned.map((p) => p.path);
    for (const p of ["node_modules", ".git", ".ifrim/BACKUPS", ".ifrim/private", ".ifrim/tmp", ".env.hub016-fixture"]) assert.ok(prunedPaths.includes(p), p);
    assert.ok(result.archiveBytes < 100000, "old archives were not re-archived");
    const sqliteEntry = result.manifest.entries.find((e) => e.path === "data/app.sqlite");
    assert.equal(sqliteEntry.sqliteSnapshot, true);
    assert.equal(sqliteEntry.integrity, "ok");
    const zip = await readZip(result.archivePath);
    assert.equal(zip.length, 6);
    const verify = await verifyRestore({ archivePath: result.archivePath, manifestPath: result.manifestPath, scratchRoot: fx.scratch, keep: true });
    assert.equal(verify.ok, true, verify.problems.join("; "));
    const restoredDb = new DatabaseSync(fs.readdirSync(fx.scratch).map((d) => path.join(fx.scratch, d, "data", "app.sqlite"))[0], { readOnly: true });
    assert.equal(restoredDb.prepare("SELECT COUNT(*) AS n FROM items").get().n, 2);
    restoredDb.close();
  } finally { fx.db.close(); }
});

test("T03 tampered archive fails restore verification", async () => {
  const fx = makeFixture();
  try {
    const result = await createBackup({ backupId: "bkp_test2", projectRoot: fx.project, destDir: fx.destDir });
    const manifest = JSON.parse(fs.readFileSync(result.manifestPath, "utf8"));
    manifest.entries[0].sha256 = "0".repeat(64);
    fs.writeFileSync(result.manifestPath, JSON.stringify(manifest));
    const verify = await verifyRestore({ archivePath: result.archivePath, manifestPath: result.manifestPath, scratchRoot: fx.scratch });
    assert.equal(verify.ok, false);
    assert.match(verify.problems.join(" "), /hash mismatch/);
  } finally { fx.db.close(); }
});

test("T03 time budget produces a failed backup, never a partial 'created' one", async () => {
  const fx = makeFixture();
  try {
    const result = await createBackup({ backupId: "bkp_test3", projectRoot: fx.project, destDir: fx.destDir, budgetMs: -1 });
    assert.equal(result.status, "failed");
    assert.match(result.error, /budget/);
  } finally { fx.db.close(); }
});

test("T03 directory junctions are not followed (Windows reparse point)", async (t) => {
  const fx = makeFixture();
  try {
    const outside = path.join(fx.root, "outside");
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(outside, "secret.txt"), "outside data");
    try { fs.symlinkSync(outside, path.join(fx.project, "linked"), "junction"); }
    catch (error) { t.skip(`junction creation not permitted: ${error.code}`); return; }
    const collected = await collectFiles(fx.project);
    assert.ok(collected.reparsePoints.includes("linked"));
    assert.ok(!collected.files.some((f) => f.rel.startsWith("linked/")));
  } finally { fx.db.close(); }
});

test("T25 file symlink branch (needs Windows symlink privilege)", async (t) => {
  const fx = makeFixture();
  try {
    try { fs.symlinkSync(path.join(fx.project, "README.md"), path.join(fx.project, "readme-link.md"), "file"); }
    catch (error) { t.skip(`NOT_RUN: file symlink creation denied (${error.code}); branch covered by the junction test and source review`); return; }
    const collected = await collectFiles(fx.project);
    assert.ok(collected.reparsePoints.includes("readme-link.md"));
  } finally { fx.db.close(); }
});

test("T04 backup service: pre-run gate backup is verified, recorded and includes the live V2 database snapshot", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    const project = hub.projects.hub();
    const backup = await hub.backups.run(project.id, "test", "test");
    assert.equal(backup.status, "verified", JSON.stringify(backup.restoreReport));
    assert.ok(backup.restoreVerifiedAt);
    assert.equal(backup.databases[0].label, "hub-v2");
    assert.equal(backup.databases[0].integrity, "ok");
    assert.equal(hub.backups.freshVerified(project.id).ok, true);
    const events = hub.bus.since(0).map((e) => e.type);
    assert.ok(events.includes("backup.started") && events.includes("backup.verified"));
  } finally { await t.cleanup(); }
});
