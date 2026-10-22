// M14: a backup a stopped Hub left 'running' is reconciled at the next boot from its owner (boot id, process, computer, last sign of
// life) — interrupted when its process is gone, left alone when a live instance owns it, OWNER_UNKNOWN when it cannot be established
// (a row from before M14, another computer, a process still there but silent). Nothing becomes a backup, nothing is deleted, the
// screens stop counting a dead row as „in progress”. Synthetic test hubs only (data under .ifrim/tmp).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { makeTestHub } from "./helpers.mjs";
import { createHub } from "../server/hub.mjs";
import { MIGRATIONS } from "../server/storage/migrations.mjs";
import { BACKUP_STALE_MS } from "../server/domain/backups.mjs";

/** A pid that existed and is gone (a short child process that already exited). */
function deadPid() {
  const r = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf8" });
  return Number(r.stdout);
}

test("M14-BKP-01 a backup this Hub runs records its owner (boot id, pid, computer) and a sign of life; finished, it is verified and nothing counts as running", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    const project = hub.projects.hub();
    const backup = await hub.backups.run(project.id, "test", "test");
    assert.equal(backup.status, "verified", JSON.stringify(backup.restoreReport));
    assert.deepEqual(backup.owner, { bootId: hub.bootId, pid: process.pid, host: os.hostname() });
    assert.ok(backup.heartbeatAt);
    assert.equal(hub.backups.runningNow(), 0);
    const started = hub.bus.since(0).find((e) => e.type === "backup.started");
    assert.deepEqual(started.payload.owner, backup.owner);
    assert.equal(MIGRATIONS.at(-1).name, "m14-backup-owner");
  } finally { await t.cleanup(); }
});

test("M14-BKP-02 restart after an interrupted backup: the dead owner's row → interrupted (leftovers listed, kept); a live instance's row → untouched and still running; no owner / another computer / a silent live pid → owner_unknown; the gate still needs a verified backup; repeated boots change nothing more", async () => {
  const t = await makeTestHub();
  let second = null;
  try {
    const project = t.hub.projects.hub();
    const at = (msAgo) => new Date(Date.now() - msAgo).toISOString();
    const rows = {
      dead: { owner_boot_id: "boot_old_dead", owner_pid: deadPid(), owner_host: os.hostname(), heartbeat_at: at(5 * 60_000) },
      live: { owner_boot_id: "boot_other_live", owner_pid: process.pid, owner_host: os.hostname(), heartbeat_at: at(5_000) },
      legacy: { owner_boot_id: null, owner_pid: null, owner_host: null, heartbeat_at: null },
      silent: { owner_boot_id: "boot_other_silent", owner_pid: process.pid, owner_host: os.hostname(), heartbeat_at: at(BACKUP_STALE_MS + 60_000) },
      elsewhere: { owner_boot_id: "boot_far", owner_pid: deadPid(), owner_host: `${os.hostname()}-altul`, heartbeat_at: at(5 * 60_000) },
    };
    const ids = {};
    const insert = t.hub.db.prepare("INSERT INTO backups (id, project_id, reason, status, created_at, owner_boot_id, owner_pid, owner_host, heartbeat_at) VALUES (?, ?, 'test', 'running', ?, ?, ?, ?, ?)");
    for (const [k, r] of Object.entries(rows)) { ids[k] = `bkp_m14_${k}`; insert.run(ids[k], project.id, at(10 * 60_000), r.owner_boot_id, r.owner_pid, r.owner_host, r.heartbeat_at); }
    // What the stopped backup left next to its archive: kept and listed, never deleted.
    fs.mkdirSync(t.config.backupDir, { recursive: true });
    const leftover = path.join(t.config.backupDir, `2026-10-22T00-00-00-000Z-${ids.dead}.zip.parts`);
    fs.mkdirSync(leftover);
    // Before the restart the screens already stop counting the dead rows: only the live owner's backup is „in progress”.
    assert.equal(t.hub.backups.runningNow(), 1);
    await t.hub.close();
    second = createHub(t.config, { homeDir: t.homeDir });
    await second.boot();
    const status = (k) => second.backups.get(ids[k]).status;
    assert.deepEqual(Object.keys(ids).map((k) => [k, status(k)]), [["dead", "interrupted"], ["live", "running"], ["legacy", "owner_unknown"], ["silent", "owner_unknown"], ["elsewhere", "owner_unknown"]]);
    const report = second.getBootReport().backups;
    assert.deepEqual(report.interrupted.map((x) => x.id), [ids.dead]);
    assert.deepEqual(report.interrupted[0].leftovers, [leftover]);
    assert.ok(fs.existsSync(leftover), "the leftovers are kept");
    assert.deepEqual(report.protected.map((x) => x.id), [ids.live]);
    assert.deepEqual(report.unknown.map((x) => x.id).sort(), [ids.legacy, ids.silent, ids.elsewhere].sort());
    assert.match(second.backups.get(ids.dead).error, /s-a oprit în timpul backup-ului/);
    assert.match(second.backups.get(ids.legacy).error, /nu înregistra instanța/);
    assert.match(second.backups.get(ids.silent).error, /poate fi alt proces cu același PID/);
    assert.match(second.backups.get(ids.elsewhere).error, /alt calculator/);
    const events = second.bus.since(0).filter((e) => ["backup.interrupted", "backup.owner_unknown"].includes(e.type));
    assert.equal(events.length, 4);
    assert.equal(second.backups.freshVerified(project.id).ok, false, "none of them is a backup");
    assert.equal(second.backups.runningNow(), 1, "only the live instance's backup is in progress");
    // The owner of the live row is protected on every boot; nothing else changes again.
    await second.close();
    second = createHub(t.config, { homeDir: t.homeDir });
    await second.boot();
    assert.equal(status("live"), "running");
    assert.deepEqual(second.getBootReport().backups.interrupted, []);
    assert.deepEqual(second.getBootReport().backups.unknown, []);
  } finally {
    try { await second?.close(); } catch { /* closed */ }
    t.hub.close = async () => {};
    await t.cleanup();
  }
});

test("M14-BKP-03 migration 15 on a version-14 database: the four owner columns added, every row kept, the old rows' owner unknown", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE backups (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, reason TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL)");
  db.prepare("INSERT INTO backups VALUES ('bkp_old', 'prj', 'manual', 'running', '2026-10-01T00:00:00.000Z')").run();
  const m = MIGRATIONS.find((x) => x.version === 15);
  m.up(db);
  const cols = db.prepare("PRAGMA table_info(backups)").all().map((c) => c.name);
  for (const c of ["owner_boot_id", "owner_pid", "owner_host", "heartbeat_at"]) assert.ok(cols.includes(c), c);
  assert.deepEqual({ ...db.prepare("SELECT id, status, owner_boot_id, heartbeat_at FROM backups").get() }, { id: "bkp_old", status: "running", owner_boot_id: null, heartbeat_at: null });
  db.close();
});

test("M14-BKP-04 review: a backup another boot called owner_unknown (its live owner was only busy) that then finishes is recorded with its real result, the earlier verdict named in the event", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    const project = hub.projects.hub();
    const off = hub.bus.subscribe((e) => { if (e.type === "backup.started") hub.db.prepare("UPDATE backups SET status = 'owner_unknown' WHERE id = ?").run(e.payload.backupId); });
    const backup = await hub.backups.run(project.id, "test", "test");
    off();
    assert.equal(backup.status, "verified");
    const done = hub.bus.since(0).find((e) => e.type === "backup.verified" && e.payload.backupId === backup.id);
    assert.equal(done.payload.reconciledAs, "owner_unknown");
  } finally { await t.cleanup(); }
});
