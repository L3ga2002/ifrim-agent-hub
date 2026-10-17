// Relocates the V2 Hub data (database, attachments, backups, work artefacts) out of the synced project folder (M08 decision
// package A1). Run from the Hub root, with the Hub STOPPED for --apply and --rollback:
//   node v2/scripts/relocate-data.mjs --plan
//   node v2/scripts/relocate-data.mjs --dry-run --to "C:\Users\<you>\IfrimHub\hub-data"
//   node v2/scripts/relocate-data.mjs --apply   --to "C:\Users\<you>\IfrimHub\hub-data"
//   node v2/scripts/relocate-data.mjs --rollback [--copy-back | --discard-new]
//
// What it guarantees:
// - only V2 entries move (isV2DataEntry); V1 and OpenClaw files in .ifrim/private stay where they are and are never opened;
// - the database is copied with SQLite's online backup and verified (integrity_check, row counts of every table, sha256 of every
//   other file); a failed verification leaves the source untouched and removes only what this run created;
// - the target root gets an access list restricted to your account and SYSTEM (no inherited group such as CodexSandboxUsers);
// - the pointer .ifrim/data-location.json is written only after the verification, and the OLD folder receives V2_MOVED.json, so a
//   V2 Hub can never open two databases; rollback reverses exactly that (and marks the new copy instead);
// - nothing is deleted: the old copies (local and in OneDrive's cloud) stay until you decide about them separately (package A3).
// Output is paths, counts, sizes and hashes — never row content.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import http from "node:http";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DatabaseSync, backup } from "node:sqlite";
import { HUB_ROOT, DATA_LOCATION_FILE, MOVED_MARKER, DEFAULT_PORT, isV2DataEntry, resolveDataLocation } from "../server/config.mjs";

const DB_FILE = "hub-v2.sqlite";
export const DEFAULT_TARGET = path.join(os.homedir(), "IfrimHub", "hub-data");

export function isSyncedPath(p, env = process.env) {
  const norm = path.resolve(String(p || "")).toLowerCase();
  const roots = [env.OneDrive, env.OneDriveConsumer, env.OneDriveCommercial].filter(Boolean).map((r) => path.resolve(r).toLowerCase());
  return roots.some((r) => norm === r || norm.startsWith(`${r}${path.sep}`)) || /[\\/]onedrive([\\/]|$)/i.test(norm);
}
const inside = (child, parent) => { const rel = path.relative(path.resolve(parent), path.resolve(child)); return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel)); };
const sha256File = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

/** Files under a folder (relative paths), skipping symbolic links (never followed). */
function listFiles(root, { filter = () => true } = {}) {
  const out = [];
  if (!fs.existsSync(root)) return out;
  const walk = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!rel && !filter(e.name)) continue;
      const p = path.join(dir, e.name);
      const r = rel ? path.join(rel, e.name) : e.name;
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) walk(p, r);
      else if (e.isFile()) out.push(r);
    }
  };
  walk(root, "");
  return out;
}
const sizeOf = (root, files) => files.reduce((n, f) => { try { return n + fs.statSync(path.join(root, f)).size; } catch { return n; } }, 0);

function tableCounts(db) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name);
  return Object.fromEntries(tables.map((t) => [t, db.prepare(`SELECT COUNT(*) AS n FROM "${t.replace(/"/g, '""')}"`).get().n]));
}

/** The three source parts (V2 only) and where each goes under the new root. */
export function sourceParts({ dataDir, backupDir, workDir }) {
  return [
    { key: "private", from: dataDir, to: "private", filter: (name) => isV2DataEntry(name) && name !== DB_FILE && !/^hub-v2\.sqlite-(wal|shm|journal)$/.test(name) && name !== "v2-hub.pid.json" },
    { key: "backups", from: backupDir, to: path.join("backups", "v2"), filter: () => true },
    { key: "work", from: workDir, to: "work", filter: () => true },
  ];
}

/** Is a V2 Hub answering (or its pid alive)? --apply and --rollback refuse while it runs. */
export async function hubRunning({ dataDir, port = DEFAULT_PORT }) {
  const answered = await new Promise((resolve) => {
    const req = http.request({ host: "127.0.0.1", port, path: "/api/health", method: "GET", timeout: 2500, headers: { Host: `127.0.0.1:${port}` } }, (res) => { res.resume(); resolve(true); });
    req.on("timeout", () => { req.destroy(); resolve(false); });
    req.on("error", () => resolve(false));
    req.end();
  });
  if (answered) return { running: true, reason: `Hub-ul răspunde pe portul ${port}` };
  try {
    const pid = JSON.parse(fs.readFileSync(path.join(dataDir, "v2-hub.pid.json"), "utf8"))?.pid;
    if (pid) { try { process.kill(pid, 0); return { running: true, reason: `procesul Hub ${pid} e viu` }; } catch (error) { if (error.code === "EPERM") return { running: true, reason: `procesul Hub ${pid} e viu` }; } }
  } catch { /* no pid file */ }
  return { running: false };
}

/** Where things are now and what would move (paths, counts, sizes). Reads no content. */
export function plan({ location, target = DEFAULT_TARGET } = {}) {
  const loc = location || resolveDataLocation({});
  const parts = sourceParts(loc).map((p) => { const files = listFiles(p.from, { filter: p.filter }); return { key: p.key, from: p.from, to: path.join(target, p.to), files: files.length, bytes: sizeOf(p.from, files), synced: isSyncedPath(p.from) }; });
  const db = path.join(loc.dataDir, DB_FILE);
  const stayed = fs.existsSync(loc.dataDir) ? fs.readdirSync(loc.dataDir).filter((n) => !isV2DataEntry(n) && n !== MOVED_MARKER).length : 0;
  return {
    current: { source: loc.source, dataRoot: loc.dataRoot || null, dataDir: loc.dataDir, backupDir: loc.backupDir, workDir: loc.workDir },
    database: { path: db, exists: fs.existsSync(db), bytes: fs.existsSync(db) ? fs.statSync(db).size : 0, synced: isSyncedPath(db) },
    parts, target, targetSynced: isSyncedPath(target), targetExists: fs.existsSync(target),
    notMoved: { entriesInDataDir: stayed, note: "Intrările care nu sunt ale V2 (baza V1, OpenClaw) rămân în .ifrim/private; nu sunt deschise sau listate." },
    afterwards: ["pointerul .ifrim/data-location.json → noua rădăcină", `${MOVED_MARKER} în folderul vechi (un Hub V2 nu-l mai deschide)`, "lista de negare Codex conține noile căi: Hub-ul îți cere din nou consimțământul de izolare (R3) înainte de o rulare Codex pe Windows", "copiile vechi rămân (local și în OneDrive) până decizi separat (A3)"],
  };
}

function validateTarget(target, loc, { test = false } = {}) {
  if (!target || !path.isAbsolute(target)) throw new Error("--to trebuie să fie o cale absolută");
  if (!test && isSyncedPath(target)) throw new Error(`Ținta ${target} e într-un folder sincronizat (OneDrive); alege una în afara lui`);
  if (!test && inside(target, HUB_ROOT)) throw new Error("Ținta nu poate fi în folderul proiectului");
  for (const p of [loc.dataDir, loc.backupDir, loc.workDir].filter(Boolean)) {
    if (inside(target, p) || inside(p, target)) throw new Error(`Ținta se suprapune cu ${p}`);
  }
  if (test) {
    const tmp = path.join(HUB_ROOT, ".ifrim", "tmp");
    if (!inside(target, tmp)) throw new Error("--test acceptă doar ținte în .ifrim/tmp");
  }
}

/** Restricts a folder to the current user and SYSTEM (no inheritance), then reads it back. Windows only. */
// The Windows tools by full path: from Git Bash (or any shell with GNU tools first on PATH) "whoami" is the GNU one (review M08).
const SYSTEM32 = path.join(process.env.SystemRoot || process.env.windir || "C:\\Windows", "System32");
const WHOAMI = path.join(SYSTEM32, "whoami.exe");
const ICACLS = path.join(SYSTEM32, "icacls.exe");
export function restrictAcl(dir) {
  if (process.platform !== "win32") return { applied: false, reason: "doar pe Windows" };
  const who = execFileSync(WHOAMI, ["/user", "/fo", "csv", "/nh"], { encoding: "utf8", windowsHide: true }).trim();
  const sid = (who.match(/"(S-1-[0-9-]+)"/) || [])[1];
  if (!sid) throw new Error("Nu pot citi SID-ul contului curent");
  execFileSync(ICACLS, [dir, "/inheritance:r", "/grant:r", `*${sid}:(OI)(CI)F`, "*S-1-5-18:(OI)(CI)F"], { encoding: "utf8", windowsHide: true });
  const out = execFileSync(ICACLS, [dir], { encoding: "utf8", windowsHide: true });
  const wide = /codexsandboxusers|\\users:|everyone|authenticated users|\(I\)/i.test(out.replace(dir, ""));
  if (wide) throw new Error("ACL-ul țintei are încă intrări moștenite sau grupuri largi după restrângere");
  return { applied: true, principals: ["contul tău", "SYSTEM"] };
}

/**
 * Paths the database stores under the data, backup or work folders, moved with them (same row count; only the prefix changes):
 * attachments.storage_path (absolute), backups.archive_path / manifest_path (absolute), factory_bundles.file_path (relative to
 * the Hub root). Returns how many rows changed per column.
 */
export function rewritePaths(dbFile, from, to, hubRoot = HUB_ROOT) {
  const db = new DatabaseSync(dbFile);
  const counts = {};
  const has = (t) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t));
  const move = (abs) => {
    for (const [a, b] of [[from.dataDir, to.dataDir], [from.backupDir, to.backupDir], [from.workDir, to.workDir]]) {
      if (a && b && abs && inside(abs, a)) return path.join(b, path.relative(a, abs));
    }
    return null;
  };
  try {
    db.exec("BEGIN");
    const absolute = [["attachments", "storage_path"], ["backups", "archive_path"], ["backups", "manifest_path"]];
    for (const [t, c] of absolute) {
      if (!has(t)) continue;
      let n = 0;
      for (const r of db.prepare(`SELECT rowid AS rid, ${c} AS p FROM ${t} WHERE ${c} IS NOT NULL AND ${c} <> ''`).all()) {
        const next = move(path.resolve(r.p));
        if (next) { db.prepare(`UPDATE ${t} SET ${c} = ? WHERE rowid = ?`).run(next, r.rid); n += 1; }
      }
      counts[`${t}.${c}`] = n;
    }
    if (has("factory_bundles")) {
      let n = 0;
      for (const r of db.prepare("SELECT rowid AS rid, file_path AS p FROM factory_bundles WHERE file_path <> ''").all()) {
        const next = move(path.resolve(hubRoot, r.p));
        if (next) { db.prepare("UPDATE factory_bundles SET file_path = ? WHERE rowid = ?").run(path.relative(hubRoot, next), r.rid); n += 1; }
      }
      counts["factory_bundles.file_path"] = n;
    }
    db.exec("COMMIT");
    const integrity = Object.values(db.prepare("PRAGMA integrity_check").get())[0];
    if (integrity !== "ok") throw new Error(`integrity_check după rescrierea căilor: ${integrity}`);
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* already committed */ }
    throw error;
  } finally { db.close(); }
  return counts;
}
const newLocation = (root) => ({ dataDir: path.join(root, "private"), backupDir: path.join(root, "backups", "v2"), workDir: path.join(root, "work") });

/** Copies every part into `root` and verifies it. Returns the evidence; throws on the first mismatch. */
async function copyAndVerify(loc, root, { hubRoot = HUB_ROOT } = {}) {
  const evidence = { database: null, parts: [] };
  fs.mkdirSync(path.join(root, "private"), { recursive: true });
  const srcDb = path.join(loc.dataDir, DB_FILE);
  if (fs.existsSync(srcDb)) {
    const src = new DatabaseSync(srcDb, { readOnly: true });
    const destDb = path.join(root, "private", DB_FILE);
    try {
      await backup(src, destDb);
      const before = tableCounts(src);
      const copy = new DatabaseSync(destDb, { readOnly: true });
      try {
        const integrity = Object.values(copy.prepare("PRAGMA integrity_check").get())[0];
        const after = tableCounts(copy);
        const schema = copy.prepare("SELECT MAX(version) AS v FROM schema_migrations").get()?.v ?? null;
        if (integrity !== "ok") throw new Error(`integrity_check pe copie: ${integrity}`);
        if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error("Numărul de rânduri diferă între sursă și copie");
        evidence.database = { integrity, tables: Object.keys(after).length, rows: Object.values(after).reduce((a, b) => a + b, 0), schema, sha256: null };
      } finally { copy.close(); }
      // The copy's stored paths follow the move; the sha recorded in the pointer is the one AFTER this step.
      evidence.database.pathsRewritten = rewritePaths(destDb, loc, newLocation(root), hubRoot);
      evidence.database.sha256 = sha256File(destDb);
    } finally { src.close(); }
  }
  for (const part of sourceParts(loc)) {
    const files = listFiles(part.from, { filter: part.filter });
    const dest = path.join(root, part.to);
    fs.mkdirSync(dest, { recursive: true });
    let bytes = 0;
    for (const rel of files) {
      const s = path.join(part.from, rel);
      const d = path.join(dest, rel);
      fs.mkdirSync(path.dirname(d), { recursive: true });
      fs.copyFileSync(s, d, fs.constants.COPYFILE_EXCL);
      const [a, b] = [sha256File(s), sha256File(d)];
      if (a !== b) throw new Error(`sha diferit la ${part.key}/${rel}`);
      bytes += fs.statSync(d).size;
    }
    evidence.parts.push({ key: part.key, files: files.length, bytes, sha256Verified: true });
  }
  return evidence;
}

export async function dryRun({ location, target, test = false, hubRoot = HUB_ROOT } = {}) {
  const loc = location || resolveDataLocation({});
  validateTarget(target, loc, { test });
  const staging = `${target}.dryrun-${Date.now().toString(36)}`;
  if (fs.existsSync(staging)) throw new Error(`${staging} există deja`);
  fs.mkdirSync(staging, { recursive: true });
  try {
    const acl = test ? { applied: false, reason: "test" } : restrictAcl(staging);
    const evidence = await copyAndVerify(loc, staging, { hubRoot });
    return { ok: true, staging, acl, evidence, note: "Copia de probă a fost verificată și apoi ștearsă (doar ce a creat această rulare). Nimic nu s-a schimbat." };
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

export async function apply({ location, target, test = false, port = DEFAULT_PORT, locationFile = DATA_LOCATION_FILE, now = () => new Date(), hubRoot = HUB_ROOT } = {}) {
  const loc = location || resolveDataLocation({});
  if (loc.source === "pointer") throw new Error(`Datele sunt deja mutate (${loc.dataRoot}); rulează întâi --rollback dacă vrei altă locație`);
  validateTarget(target, loc, { test });
  const running = await hubRunning({ dataDir: loc.dataDir, port });
  if (running.running) throw new Error(`Oprește întâi Hub-ul (${running.reason})`);
  if (fs.existsSync(target) && fs.readdirSync(target).length) throw new Error(`Ținta ${target} nu e goală`);
  const created = !fs.existsSync(target);
  fs.mkdirSync(target, { recursive: true });
  let evidence;
  try {
    const acl = test ? { applied: false, reason: "test" } : restrictAcl(target);
    evidence = { ...(await copyAndVerify(loc, target, { hubRoot })), acl };
  } catch (error) {
    // Only what this run created goes away; the source was only read.
    if (created) fs.rmSync(target, { recursive: true, force: true });
    else for (const n of fs.readdirSync(target)) fs.rmSync(path.join(target, n), { recursive: true, force: true });
    throw error;
  }
  // A Hub started during the copy would keep writing to the old database: check again before switching (review M08).
  const startedMeanwhile = await hubRunning({ dataDir: loc.dataDir, port });
  if (startedMeanwhile.running) {
    // Only what this run created goes away (the target was verified empty at the start).
    if (created) fs.rmSync(target, { recursive: true, force: true });
    else for (const n of fs.readdirSync(target)) fs.rmSync(path.join(target, n), { recursive: true, force: true });
    throw new Error(`Hub-ul a pornit în timpul copierii (${startedMeanwhile.reason}); nu am schimbat nimic — oprește-l și reia`);
  }
  const at = now().toISOString();
  const pointer = { version: 1, dataRoot: path.resolve(target), movedAt: at, from: { dataDir: loc.dataDir, backupDir: loc.backupDir, workDir: loc.workDir }, dbSha256AtMove: evidence.database?.sha256 || null };
  fs.writeFileSync(path.join(loc.dataDir, MOVED_MARKER), JSON.stringify({ movedTo: pointer.dataRoot, at, by: "relocate-data.mjs", note: "Datele V2 au fost mutate. Fișierele V1 din acest folder nu au fost atinse." }, null, 2));
  fs.writeFileSync(locationFile, JSON.stringify(pointer, null, 2));
  return { ok: true, pointer, evidence, next: ["pornește Hub-ul (citește pointerul)", "verifică în Sistem: locația datelor = pointer, integritatea bazei", "reconfirmă izolarea Codex (căile de negare s-au schimbat)", "copiile vechi rămân până la decizia ta (A3)"] };
}

export async function rollback({ copyBack = false, discardNew = false, port = DEFAULT_PORT, locationFile = DATA_LOCATION_FILE, now = () => new Date(), hubRoot = HUB_ROOT } = {}) {
  if (!fs.existsSync(locationFile)) throw new Error("Nu există un pointer de locație; datele sunt în locul implicit");
  const pointer = JSON.parse(fs.readFileSync(locationFile, "utf8"));
  const newRoot = pointer.dataRoot;
  const old = pointer.from || {};
  if (!newRoot || !old.dataDir) throw new Error("Pointerul nu conține locația veche; nu pot reveni automat");
  const running = await hubRunning({ dataDir: path.join(newRoot, "private"), port });
  if (running.running) throw new Error(`Oprește întâi Hub-ul (${running.reason})`);
  const newDb = path.join(newRoot, "private", DB_FILE);
  // Rows a Hub committed but never checkpointed live in the -wal file: fold them into the main file first (the Hub is stopped), so
  // "changed since the move" sees them (review M08: a crash/shutdown left post-move rows in the WAL and rollback dropped them).
  // A damaged or unreadable new database counts as "changed" (so a plain rollback asks for a choice); --discard-new never needs it
  // and --copy-back refuses it explicitly (review M08 round 2: the checkpoint threw and blocked --discard-new).
  let unreadable = false;
  if (fs.existsSync(newDb)) {
    try {
      const db = new DatabaseSync(newDb);
      try {
        db.exec("PRAGMA busy_timeout = 2000");
        const cp = db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get() || {};
        if (Number(cp.busy) !== 0) throw new Error("baza nouă e încă folosită (checkpoint incomplet)");
      } finally { db.close(); }
    } catch (error) {
      if (/încă folosită/.test(error.message)) throw new Error(`Nu pot verifica baza nouă: ${error.message}; oprește orice proces care o folosește și reia`);
      unreadable = true;
    }
  }
  const oldDbFile = path.join(old.dataDir, DB_FILE);
  const changed = unreadable || Boolean(fs.existsSync(newDb) && pointer.dbSha256AtMove && sha256File(newDb) !== pointer.dbSha256AtMove);
  if (copyBack && (!fs.existsSync(newDb) || unreadable)) throw new Error(`--copy-back nu are ce aduce: baza din noua locație ${unreadable ? "nu poate fi citită" : "lipsește"}; folosește --discard-new sau rămâi pe locația nouă`);
  // The old location must still hold a database to become active again (else the Hub would start on an empty one).
  if (!fs.existsSync(oldDbFile) && !copyBack) throw new Error(`Folderul vechi nu mai are baza ${DB_FILE}; rulează --rollback --copy-back (aduce baza din noua locație) sau rămâi pe locația nouă`);
  if (changed && !copyBack && !discardNew) {
    throw new Error("Baza din noua locație s-a schimbat după mutare. Alege: --copy-back (aduce înapoi datele noi, după verificare; versiunile vechi se păstrează cu sufix) sau --discard-new (revii la datele de dinainte de mutare; copia nouă rămâne marcată, neștearsă)");
  }
  const at = now().toISOString();
  const stamp = at.replace(/[:.]/g, "-");
  let restored = null;
  // --copy-back brings the current data back whenever it is asked for (not only when the hash differs).
  if (copyBack && fs.existsSync(newDb)) {
    const loc = newLocation(newRoot);
    const oldDb = path.join(old.dataDir, DB_FILE);
    if (fs.existsSync(oldDb)) fs.renameSync(oldDb, `${oldDb}.pre-rollback-${stamp}`);
    for (const suffix of ["-wal", "-shm"]) if (fs.existsSync(oldDb + suffix)) fs.renameSync(oldDb + suffix, `${oldDb}${suffix}.pre-rollback-${stamp}`);
    const src = new DatabaseSync(newDb, { readOnly: true });
    try {
      await backup(src, oldDb);
      const copy = new DatabaseSync(oldDb, { readOnly: true });
      try {
        const integrity = Object.values(copy.prepare("PRAGMA integrity_check").get())[0];
        if (integrity !== "ok" || JSON.stringify(tableCounts(src)) !== JSON.stringify(tableCounts(copy))) throw new Error("Copia înapoi nu trece verificarea; baza veche e păstrată cu sufixul .pre-rollback");
        restored = { integrity, rows: Object.values(tableCounts(copy)).reduce((a, b) => a + b, 0) };
      } finally { copy.close(); }
    } finally { src.close(); }
    restored.pathsRewritten = rewritePaths(oldDb, newLocation(newRoot), { dataDir: old.dataDir, backupDir: old.backupDir, workDir: old.workDir }, hubRoot);
    // Files written after the move (attachments, backups, work) come back too; an older file with the same name is kept aside.
    for (const part of sourceParts(loc)) {
      const back = { private: old.dataDir, backups: old.backupDir, work: old.workDir }[part.key];
      if (!back) continue;
      for (const rel of listFiles(part.from, { filter: part.filter })) {
        const d = path.join(back, rel);
        const s = path.join(part.from, rel);
        if (fs.existsSync(d) && sha256File(d) === sha256File(s)) continue;
        if (fs.existsSync(d)) fs.renameSync(d, `${d}.pre-rollback-${stamp}`);
        fs.mkdirSync(path.dirname(d), { recursive: true });
        fs.copyFileSync(s, d);
      }
    }
  }
  // A Hub started while we copied back would be writing the new database: never switch under it (review M08 round 2).
  const startedDuringRollback = await hubRunning({ dataDir: path.join(newRoot, "private"), port });
  if (startedDuringRollback.running) throw new Error(`Hub-ul a pornit în timpul revenirii (${startedDuringRollback.reason}); nu am comutat nimic — oprește-l și reia`);
  // The new copy can never be opened as a second active database: it gets the marker the old folder loses.
  fs.mkdirSync(path.join(newRoot, "private"), { recursive: true });
  fs.writeFileSync(path.join(newRoot, "private", MOVED_MARKER), JSON.stringify({ movedTo: old.dataDir, at, by: "relocate-data.mjs --rollback", note: "Revenit la locația veche; această copie nu se mai deschide." }, null, 2));
  fs.rmSync(path.join(old.dataDir, MOVED_MARKER), { force: true });
  fs.renameSync(locationFile, locationFile.replace(/\.json$/, `.rolled-back-${stamp}.json`));
  return { ok: true, activeAgain: old.dataDir, newCopyMarked: path.join(newRoot, "private", MOVED_MARKER), changedAfterMove: Boolean(changed), copiedBack: Boolean(copyBack && restored), restored,
    note: "Nimic nu a fost șters. Copia din noua locație e marcată și poate fi ștearsă de tine, separat, după verificare." };
}

// ---------- CLI ----------
async function main(argv) {
  const has = (f) => argv.includes(f);
  const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
  const test = has("--test");
  // --test points every folder at a scratch tree in .ifrim/tmp (used by the test suite); never the real data.
  const location = test ? { source: "test", dataDir: path.resolve(val("--data")), backupDir: path.resolve(val("--backups")), workDir: path.resolve(val("--work")), dataRoot: null } : undefined;
  const locationFile = test ? path.resolve(val("--pointer")) : DATA_LOCATION_FILE;
  const port = Number(val("--port") || DEFAULT_PORT);
  const target = val("--to") ? path.resolve(val("--to")) : null;
  let out;
  if (has("--plan")) out = plan({ location, target: target || DEFAULT_TARGET });
  else if (has("--dry-run")) out = await dryRun({ location, target: target || DEFAULT_TARGET, test });
  else if (has("--apply")) { if (!target) throw new Error("--apply cere --to <cale>"); out = await apply({ location, target, test, port, locationFile }); }
  else if (has("--rollback")) out = await rollback({ copyBack: has("--copy-back"), discardNew: has("--discard-new"), port, locationFile });
  else { console.log("Folosire: --plan | --dry-run --to <cale> | --apply --to <cale> | --rollback [--copy-back|--discard-new]"); return 2; }
  console.log(JSON.stringify(out, null, 2));
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (error) => { console.error(`Refuzat: ${error.message}`); process.exit(1); });
}
