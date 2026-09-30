import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { DatabaseSync, backup as sqliteBackup } from "node:sqlite";
import { createZipWriter, readZip } from "./zip.mjs";
import { isSecretLikeName } from "../security/paths.mjs";


export const BACKUP_RULES = Object.freeze({
  // Pruned before traversal (never descended into).
  prunedDirNames: ["node_modules", ".git", "dist", "build", ".next", ".vite", ".venv", "venv", "__pycache__", ".pytest_cache",
    ".playwright-cli", "coverage", ".cache", ".turbo", ".parcel-cache", ".gradle", ".expo"],
  // Relative paths (forward slashes, case-insensitive) pruned before traversal: backups (no recursion),
  // Hub private runtime (credentials; databases are snapshotted separately) and temp.
  prunedRelPaths: [".ifrim/backups", ".ifrim/private", ".ifrim/tmp"],
  // Directory names beginning with .env are pruned (V1 test fixtures, possible secrets).
  prunedDirPrefix: [".env"],
  // Files handled by the SQLite online backup API instead of raw copy.
  sqliteExtensions: [".sqlite", ".sqlite3", ".db"],
  sqliteSidecars: ["-wal", "-shm", "-journal"],
});

const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

function classifyDir(relPosix, name) {
  const lower = relPosix.toLowerCase();
  if (BACKUP_RULES.prunedDirNames.includes(name)) return `pruned-dir-name:${name}`;
  if (BACKUP_RULES.prunedDirPrefix.some((prefix) => name.toLowerCase().startsWith(prefix))) return "pruned-env-dir";
  if (BACKUP_RULES.prunedRelPaths.includes(lower)) return `pruned-path:${lower}`;
  return null;
}

/** Walks the project with pruning BEFORE traversal; symlinks/junctions are never followed. */
export async function collectFiles(root) {
  const files = [];
  const pruned = [];
  const reparsePoints = [];
  const excludedSecretLike = [];
  const sidecars = [];
  const dirs = [];
  async function walk(dir, relDir) {
    dirs.push(dir);
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); }
    catch (error) { files.push({ rel: relDir || ".", error: `readdir: ${error.code || error.message}` }); return; }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      let stat;
      try { stat = await fs.lstat(abs); } catch (error) { files.push({ rel, error: `lstat: ${error.code}` }); continue; }
      if (stat.isSymbolicLink()) { reparsePoints.push(rel); continue; }
      if (stat.isDirectory()) {
        const reason = classifyDir(rel, entry.name);
        if (reason) { pruned.push({ path: rel, reason }); continue; }
        await walk(abs, rel);
      } else if (stat.isFile()) {
        if (isSecretLikeName(entry.name)) { excludedSecretLike.push(rel); continue; }
        if (BACKUP_RULES.sqliteSidecars.some((suffix) => entry.name.endsWith(suffix)) && /\.(sqlite3?|db)-/.test(entry.name)) { sidecars.push(rel); continue; }
        const isSqlite = BACKUP_RULES.sqliteExtensions.some((ext) => entry.name.toLowerCase().endsWith(ext));
        files.push({ rel, abs, size: stat.size, mtime: stat.mtime, isSqlite });
      }
    }
  }
  await walk(root, "");
  return { files, pruned, reparsePoints, excludedSecretLike, sqliteSidecarsSkipped: sidecars, dirs };
}

// Offline (0x1000) or RecallOnDataAccess (0x400000): OneDrive "online-only" placeholders that are
// downloaded when read. Checked non-recursively in exactly the directories the walker visited, so
// pruned trees (backups, private runtime) are never enumerated.
const ONLINE_ONLY_SCRIPT = String.raw`$ErrorActionPreference = 'SilentlyContinue'
$dirs = [Console]::In.ReadToEnd() | ConvertFrom-Json
foreach ($d in $dirs) {
  Get-ChildItem -LiteralPath $d -File -Force | Where-Object { ($_.Attributes.value__ -band 0x401000) -ne 0 } | ForEach-Object { $_.FullName }
}`;

/** Lists OneDrive online-only files among the directories to back up; diagnostic only (they are still read). */
export async function detectOnlineOnly(root, dirs, timeoutMs = 30000) {
  if (process.platform !== "win32" || !dirs.length) return { supported: process.platform === "win32", files: [] };
  const started = Date.now();
  return new Promise((resolve) => {
    const child = execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", ONLINE_ONLY_SCRIPT],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
        const files = String(stdout || "").split(/\r?\n/).filter(Boolean).map((line) => path.relative(root, line.trim()).replaceAll("\\", "/"));
        resolve({ supported: true, timedOut: Boolean(error?.killed), files, directoriesChecked: dirs.length, durationMs: Date.now() - started });
      });
    child.stdin.end(JSON.stringify(dirs));
  });
}

async function snapshotSqliteFile(sourceAbs, destAbs) {
  const source = new DatabaseSync(sourceAbs, { readOnly: true });
  try { await sqliteBackup(source, destAbs); } finally { source.close(); }
  return inspectSqlite(destAbs);
}

export function inspectSqlite(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const integrity = db.prepare("PRAGMA integrity_check").get().integrity_check;
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name);
    const counts = {};
    for (const table of tables) {
      try { counts[table] = db.prepare(`SELECT COUNT(*) AS n FROM "${table.replaceAll('"', '""')}"`).get().n; } catch { counts[table] = null; }
    }
    return { integrity, tables: counts };
  } finally { db.close(); }
}

/**
 * Creates a complete project backup:
 *  - ZIP of project files (pruned rules, secret-like names excluded and listed by name only),
 *  - project SQLite files captured through the online backup API (consistent even while in use),
 *  - extra SQLite databases (Hub V2 live DB, V1 DB) as separate private snapshots,
 *  - manifest with SHA-256 per entry.
 * Any read error makes the backup `incomplete`, which never satisfies the execution gate.
 */
export async function createBackup({ backupId, projectRoot, destDir, gitHead = "", extraDatabases = [], budgetMs = 300000, onProgress = () => {}, clock = () => new Date() }) {
  const started = Date.now();
  await fs.mkdir(destDir, { recursive: true });
  const stamp = clock().toISOString().replace(/[:.]/g, "-");
  const base = `${stamp}-${backupId}`;
  const archivePath = path.join(destDir, `${base}.zip`);
  const manifestPath = path.join(destDir, `${base}.manifest.json`);
  const scratch = path.join(destDir, `${base}.parts`);
  await fs.mkdir(scratch, { recursive: true });

  const collected = await collectFiles(projectRoot);
  const onlineOnly = await detectOnlineOnly(projectRoot, collected.dirs);

  const entries = [];
  const skipped = collected.files.filter((f) => f.error).map((f) => ({ path: f.rel, reason: f.error }));
  const zip = await createZipWriter(archivePath);
  let totalBytes = 0;
  let processed = 0;
  try {
    for (const file of collected.files.filter((f) => f.abs)) {
      if (Date.now() - started > budgetMs) {
        throw Object.assign(new Error(`Backup exceeded its ${Math.round(budgetMs / 1000)} s budget after ${processed} files (last: ${file.rel})`), { code: "BACKUP_BUDGET" });
      }
      try {
        let data;
        let sqlite = null;
        if (file.isSqlite) {
          const snap = path.join(scratch, `${processed}.sqlite`);
          try {
            sqlite = await snapshotSqliteFile(file.abs, snap);
            data = await fs.readFile(snap);
          } catch {
            data = await fs.readFile(file.abs); // Not a SQLite database after all; keep raw bytes.
          }
        } else {
          data = await fs.readFile(file.abs);
        }
        await zip.addFile(file.rel, data, file.mtime);
        entries.push({ path: file.rel, size: data.length, sha256: sha256(data), ...(sqlite ? { sqliteSnapshot: true, integrity: sqlite.integrity } : {}) });
        totalBytes += data.length;
      } catch (error) {
        if (error.code === "BACKUP_BUDGET") throw error;
        skipped.push({ path: file.rel, reason: error.code || error.message });
      }
      processed += 1;
      if (processed % 50 === 0) onProgress({ processed, total: collected.files.length, bytes: totalBytes });
    }
  } catch (error) {
    await zip.abort();
    await fs.rm(scratch, { recursive: true, force: true });
    return { status: "failed", error: error.message, archivePath, durationMs: Date.now() - started, processed };
  }
  const zipInfo = await zip.close();
  await fs.rm(scratch, { recursive: true, force: true });

  const databases = [];
  for (const extra of extraDatabases) {
    const file = path.join(destDir, `${base}.${extra.label}.sqlite`);
    try {
      if (extra.db) await sqliteBackup(extra.db, file);
      else await snapshotSqliteFile(extra.path, file);
      const buf = await fs.readFile(file);
      databases.push({ label: extra.label, file: path.basename(file), bytes: buf.length, sha256: sha256(buf), ...inspectSqlite(file), private: true });
    } catch (error) {
      skipped.push({ path: `[database:${extra.label}]`, reason: error.message });
    }
  }

  const manifest = {
    schema: "ifrim-hub-backup/1", backupId, projectRoot, createdAt: clock().toISOString(), gitHead,
    rules: BACKUP_RULES, archive: path.basename(archivePath), entries, skipped,
    pruned: collected.pruned, reparsePointsNotFollowed: collected.reparsePoints,
    excludedSecretLikeNames: collected.excludedSecretLike, sqliteSidecarsSkipped: collected.sqliteSidecarsSkipped,
    oneDriveOnlineOnly: onlineOnly, databases,
    totals: { files: entries.length, bytes: totalBytes, archiveBytes: zipInfo.bytes, durationMs: Date.now() - started },
    note: "Secret-like files are excluded by name and must be restored from their own protected source. Databases are consistent online-backup snapshots.",
  };
  const manifestText = JSON.stringify(manifest, null, 2);
  await fs.writeFile(manifestPath, manifestText, { flag: "wx" });
  return {
    status: skipped.length ? "incomplete" : "created",
    archivePath, manifestPath, manifestSha256: sha256(Buffer.from(manifestText)), manifest,
    fileCount: entries.length, totalBytes, archiveBytes: zipInfo.bytes, durationMs: Date.now() - started, skipped, databases,
  };
}

/**
 * Restores the archive into a private scratch directory and verifies every entry hash and every
 * database snapshot. No provider is contacted. The scratch copy is removed after verification.
 */
export async function verifyRestore({ archivePath, manifestPath, scratchRoot, keep = false }) {
  const started = Date.now();
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  const target = path.join(scratchRoot, `restore-verify-${manifest.backupId}-${Date.now()}`);
  await fs.mkdir(target, { recursive: true });
  const problems = [];
  let restored = 0;
  try {
    const zipEntries = await readZip(archivePath);
    const byName = new Map(zipEntries.map((entry) => [entry.name, entry]));
    for (const expected of manifest.entries) {
      const entry = byName.get(expected.path);
      if (!entry) { problems.push(`missing in archive: ${expected.path}`); continue; }
      let content;
      try { content = entry.read(); } catch (error) { problems.push(error.message); continue; }
      if (sha256(content) !== expected.sha256) { problems.push(`hash mismatch: ${expected.path}`); continue; }
      const out = path.join(target, ...expected.path.split("/"));
      if (!out.startsWith(target)) { problems.push(`unsafe entry path: ${expected.path}`); continue; }
      await fs.mkdir(path.dirname(out), { recursive: true });
      await fs.writeFile(out, content);
      if (expected.sqliteSnapshot) {
        const check = inspectSqlite(out);
        if (check.integrity !== "ok") problems.push(`sqlite integrity failed after restore: ${expected.path}`);
      }
      restored += 1;
    }
    if (zipEntries.length !== manifest.entries.length) problems.push(`archive has ${zipEntries.length} entries, manifest ${manifest.entries.length}`);
    for (const database of manifest.databases || []) {
      const file = path.join(path.dirname(archivePath), database.file);
      const buf = await fs.readFile(file).catch(() => null);
      if (!buf) { problems.push(`database snapshot missing: ${database.label}`); continue; }
      if (sha256(buf) !== database.sha256) { problems.push(`database hash mismatch: ${database.label}`); continue; }
      const copy = path.join(target, `__db_${database.label}.sqlite`);
      await fs.writeFile(copy, buf);
      const check = inspectSqlite(copy);
      if (check.integrity !== "ok") problems.push(`database integrity failed: ${database.label}`);
      for (const [table, count] of Object.entries(database.tables || {})) {
        if (check.tables[table] !== count) problems.push(`row count differs for ${database.label}.${table}`);
      }
    }
  } finally {
    if (!keep) await fs.rm(target, { recursive: true, force: true });
  }
  return { ok: problems.length === 0, restoredFiles: restored, databases: (manifest.databases || []).length, problems, durationMs: Date.now() - started, verifiedAt: new Date().toISOString() };
}
