import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { HubError } from "../core/errors.mjs";
import { newId } from "../core/ids.mjs";
import { json, parse } from "../storage/db.mjs";
import { createBackup, verifyRestore } from "../backup/backup.mjs";
import { gitState } from "../tools/git.mjs";
import { redactText } from "../security/redact.mjs";

const FRESH_MINUTES = 30;
// M14: a running backup says it is alive every HEARTBEAT_MS; a row whose last sign is older than STALE_MS is no longer counted as running
// (the screens), and at boot it is reconciled from its owner (see recover()).
export const BACKUP_HEARTBEAT_MS = 15_000;
export const BACKUP_STALE_MS = 120_000;

/**
 * Backup service: create → record → restore-verify. Only a backup that is complete (no skipped
 * files), restore-verified and recent satisfies the execution gate for its project.
 */
export function createBackupService({ db, bus, config, clock, projects, instance = {} }) {
  const inFlight = new Map();
  // M14: this Hub process (boot id, pid, computer), written on every backup it starts.
  const owner = { bootId: instance.bootId || null, pid: instance.pid ?? process.pid, host: instance.host || os.hostname() };

  async function run(projectRef, reason, actor = "user") {
    const resolved = projects.get(projectRef);
    if (!resolved) throw new HubError("not_found", "Project not found");
    const projectId = resolved.id;
    if (inFlight.has(projectId)) return inFlight.get(projectId);
    const promise = (async () => {
      const project = resolved;
      if (!project.executionAllowed) throw new HubError("policy", "Backups are written into the project; only projects enabled for V2 execution are backed up in this phase");
      const id = newId("bkp");
      const createdAt = clock().toISOString();
      bus.transaction(() => {
        db.prepare("INSERT INTO backups (id, project_id, reason, status, created_at, owner_boot_id, owner_pid, owner_host, heartbeat_at) VALUES (?, ?, ?, 'running', ?, ?, ?, ?, ?)")
          .run(id, projectId, reason, createdAt, owner.bootId, owner.pid, owner.host, createdAt);
        bus.append({ type: "backup.started", scopeType: "project", scopeId: projectId, projectId, source: actor, payload: { backupId: id, reason, owner } });
      });
      const beat = setInterval(() => {
        try { db.prepare("UPDATE backups SET heartbeat_at = ? WHERE id = ? AND status = 'running'").run(clock().toISOString(), id); } catch { /* the database is closing */ }
      }, BACKUP_HEARTBEAT_MS);
      beat.unref?.();
      try {
        const git = await gitState(project.path);
        const destDir = project.slug === "ifrim-agent-hub" ? config.backupDir : path.join(project.path, ".ifrim", "BACKUPS", "v2");
        const extraDatabases = project.slug === "ifrim-agent-hub"
          ? [{ label: "hub-v2", db }, ...(config.testMode ? [] : [{ label: "hub-v1", path: config.legacyDbPath }])]
          : [];
        const result = await createBackup({ backupId: id, projectRoot: project.path, destDir, gitHead: git.head, extraDatabases, clock,
          onProgress: (progress) => bus.emit({ type: "backup.progress", scopeType: "project", scopeId: projectId, projectId, source: "hub", payload: { backupId: id, ...progress }, dedupeKey: null }) });
        let verification = null;
        if (result.status === "created") {
          verification = await verifyRestore({ archivePath: result.archivePath, manifestPath: result.manifestPath, scratchRoot: config.workDir });
        }
        const status = result.status === "created" ? (verification.ok ? "verified" : "verification_failed") : result.status;
        bus.transaction(() => {
          db.prepare(`UPDATE backups SET status = ?, archive_path = ?, manifest_path = ?, sqlite_json = ?, file_count = ?, total_bytes = ?, archive_bytes = ?,
            duration_ms = ?, skipped_json = ?, manifest_sha256 = ?, git_head = ?, restore_verified_at = ?, restore_report_json = ?, error = ? WHERE id = ?`)
            .run(status, result.archivePath || null, result.manifestPath || null, json(result.databases || []), result.fileCount || 0,
              result.totalBytes || 0, result.archiveBytes || 0, result.durationMs || 0, json(result.skipped || []), result.manifestSha256 || "",
              git.head || "", verification?.ok ? verification.verifiedAt : null, json(verification || {}), result.error || null, id);
          bus.append({ type: status === "verified" ? "backup.verified" : "backup.failed", scopeType: "project", scopeId: projectId, projectId, source: "hub",
            payload: { backupId: id, status, fileCount: result.fileCount || 0, skipped: (result.skipped || []).length, durationMs: result.durationMs, problems: verification?.problems?.slice(0, 20) || [], error: result.error } });
        });
      } catch (error) {
        // A step that throws (git state, the archive writer, the restore check) ends the backup as failed with the reason; it never
        // stays „running” (which also counted as a backup in progress for the setup and diagnostics screens).
        const message = redactText(String(error?.message || error)).slice(0, 2000);
        try {
          bus.transaction(() => {
            if (db.prepare("UPDATE backups SET status = 'failed', error = ? WHERE id = ? AND status = 'running'").run(message, id).changes) {
              bus.append({ type: "backup.failed", scopeType: "project", scopeId: projectId, projectId, source: "hub", payload: { backupId: id, status: "failed", error: message.slice(0, 500) } });
            }
          });
        } catch { /* the original error is the one reported */ }
        throw error;
      } finally { clearInterval(beat); }
      return get(id);
    })();
    inFlight.set(projectId, promise);
    try { return await promise; } finally { inFlight.delete(projectId); }
  }

  function get(id) {
    const row = db.prepare("SELECT * FROM backups WHERE id = ?").get(id);
    return row ? rowToBackup(row) : null;
  }

  const keysOf = (ref) => { const p = projects.get(ref); return p ? [p.id, p.slug] : [ref, ref]; };
  const list = (projectId = null, limit = 50) => (projectId
    ? db.prepare("SELECT * FROM backups WHERE project_id IN (?, ?) ORDER BY created_at DESC LIMIT ?").all(...keysOf(projectId), limit)
    : db.prepare("SELECT * FROM backups ORDER BY created_at DESC LIMIT ?").all(limit)).map(rowToBackup);

  /** Gate helper: the newest verified, complete backup of the project within the freshness window. */
  function freshVerified(projectId) {
    const row = db.prepare("SELECT * FROM backups WHERE project_id IN (?, ?) AND status = 'verified' ORDER BY created_at DESC LIMIT 1").get(...keysOf(projectId));
    if (!row) return { ok: false, reason: "Niciun backup verificat pentru acest proiect" };
    const ageMin = (clock().getTime() - new Date(row.created_at).getTime()) / 60000;
    if (ageMin > FRESH_MINUTES) return { ok: false, reason: `Ultimul backup verificat are ${Math.round(ageMin)} min (limita ${FRESH_MINUTES})`, backup: rowToBackup(row) };
    return { ok: true, backup: rowToBackup(row) };
  }

  /** M14: the rows really in progress — this process's, or another's that showed a sign of life recently (a stale row is not „running”). */
  function runningNow() {
    const since = new Date(clock().getTime() - BACKUP_STALE_MS).toISOString();
    return db.prepare("SELECT COUNT(*) AS n FROM backups WHERE status = 'running' AND (owner_boot_id = ? OR heartbeat_at >= ?)").get(owner.bootId || "", since).n;
  }

  /** Files a stopped backup may have left next to its archive (the zip being written, the .parts folder): listed, never deleted. */
  function leftoversOf(row) {
    const project = projects.get(row.project_id);
    if (!project) return [];
    const dir = project.slug === "ifrim-agent-hub" ? config.backupDir : path.join(project.path, ".ifrim", "BACKUPS", "v2");
    try { return fs.readdirSync(dir).filter((name) => name.includes(row.id)).slice(0, 10).map((name) => path.join(dir, name)); } catch { return []; }
  }

  /**
   * M14 boot pass: every backup left 'running' by another boot is decided from its owner, never guessed —
   *  - same computer, its process gone → INTERRUPTED (the Hub stopped during the backup);
   *  - its process still there with a recent sign of life → left running (another live instance owns it; reported, untouched);
   *  - otherwise (no owner recorded — a backup started before M14 —, another computer, a process still there but silent) → OWNER_UNKNOWN.
   * Neither outcome is a backup: the execution gate keeps needing a verified one. Nothing is deleted; leftover files are listed.
   */
  async function recover({ isPidAlive = async () => false } = {}) {
    const report = { interrupted: [], unknown: [], protected: [] };
    const now = clock();
    for (const row of db.prepare("SELECT * FROM backups WHERE status = 'running' ORDER BY created_at").all()) {
      if (owner.bootId && row.owner_boot_id === owner.bootId) continue;
      const last = Date.parse(row.heartbeat_at || "");
      const silentS = Number.isFinite(last) ? Math.max(0, Math.round((now.getTime() - last) / 1000)) : null;
      const fresh = silentS !== null && silentS * 1000 < BACKUP_STALE_MS;
      let status = "owner_unknown";
      let why;
      if (!row.owner_boot_id) why = "Backup început de o versiune a Hub-ului care nu înregistra instanța; nu pot stabili dacă s-a terminat. Nu e un backup verificat.";
      else if (row.owner_host && row.owner_host !== owner.host) why = `Backup început pe alt calculator (${row.owner_host}); nu pot verifica procesul de aici. Nu e un backup verificat.`;
      else if (row.owner_pid && await isPidAlive(row.owner_pid)) {
        if (fresh) { report.protected.push({ id: row.id, ownerBootId: row.owner_boot_id, ownerPid: row.owner_pid, silentS }); continue; }
        why = `Procesul ${row.owner_pid} al Hub-ului care îl făcea (pornirea ${row.owner_boot_id}) există încă, dar nu a mai dat semn de ${silentS === null ? "la început" : `${silentS} s`}; poate fi alt proces cu același PID. Nu e un backup verificat.`;
      } else {
        status = "interrupted";
        why = `Hub-ul care îl făcea (pornirea ${row.owner_boot_id}, procesul ${row.owner_pid || "?"}) s-a oprit în timpul backup-ului. Nu e un backup verificat; fișierele rămase sunt păstrate.`;
      }
      const leftovers = leftoversOf(row);
      bus.transaction(() => {
        const changed = db.prepare("UPDATE backups SET status = ?, error = ? WHERE id = ? AND status = 'running' AND COALESCE(owner_boot_id, '') = ? AND COALESCE(heartbeat_at, '') = ?")
          .run(status, why, row.id, row.owner_boot_id || "", row.heartbeat_at || "").changes;
        if (!changed) return;
        bus.append({ type: status === "interrupted" ? "backup.interrupted" : "backup.owner_unknown", scopeType: "project", scopeId: row.project_id, projectId: row.project_id, source: "recovery",
          payload: { backupId: row.id, status, reason: why, owner: { bootId: row.owner_boot_id || null, pid: row.owner_pid || null, host: row.owner_host || null }, silentS, leftovers } });
        (status === "interrupted" ? report.interrupted : report.unknown).push({ id: row.id, ownerBootId: row.owner_boot_id || null, leftovers });
      });
    }
    return report;
  }

  return { run, get, list, freshVerified, runningNow, recover };
}

export function rowToBackup(row) {
  return { id: row.id, projectId: row.project_id, reason: row.reason, status: row.status, archivePath: row.archive_path,
    manifestPath: row.manifest_path, databases: parse(row.sqlite_json, []), fileCount: row.file_count, totalBytes: row.total_bytes,
    archiveBytes: row.archive_bytes, durationMs: row.duration_ms, skipped: parse(row.skipped_json, []), manifestSha256: row.manifest_sha256,
    gitHead: row.git_head, restoreVerifiedAt: row.restore_verified_at, restoreReport: parse(row.restore_report_json, {}), error: row.error,
    createdAt: row.created_at, legacyId: row.legacy_id,
    owner: row.owner_boot_id ? { bootId: row.owner_boot_id, pid: row.owner_pid, host: row.owner_host } : null, heartbeatAt: row.heartbeat_at || null };
}
