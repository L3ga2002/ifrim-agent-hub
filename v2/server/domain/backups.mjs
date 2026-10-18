import path from "node:path";
import { HubError } from "../core/errors.mjs";
import { newId } from "../core/ids.mjs";
import { json, parse } from "../storage/db.mjs";
import { createBackup, verifyRestore } from "../backup/backup.mjs";
import { gitState } from "../tools/git.mjs";
import { redactText } from "../security/redact.mjs";

const FRESH_MINUTES = 30;

/**
 * Backup service: create → record → restore-verify. Only a backup that is complete (no skipped
 * files), restore-verified and recent satisfies the execution gate for its project.
 */
export function createBackupService({ db, bus, config, clock, projects }) {
  const inFlight = new Map();

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
        db.prepare("INSERT INTO backups (id, project_id, reason, status, created_at) VALUES (?, ?, ?, 'running', ?)").run(id, projectId, reason, createdAt);
        bus.append({ type: "backup.started", scopeType: "project", scopeId: projectId, projectId, source: actor, payload: { backupId: id, reason } });
      });
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
      }
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

  return { run, get, list, freshVerified };
}

export function rowToBackup(row) {
  return { id: row.id, projectId: row.project_id, reason: row.reason, status: row.status, archivePath: row.archive_path,
    manifestPath: row.manifest_path, databases: parse(row.sqlite_json, []), fileCount: row.file_count, totalBytes: row.total_bytes,
    archiveBytes: row.archive_bytes, durationMs: row.duration_ms, skipped: parse(row.skipped_json, []), manifestSha256: row.manifest_sha256,
    gitHead: row.git_head, restoreVerifiedAt: row.restore_verified_at, restoreReport: parse(row.restore_report_json, {}), error: row.error,
    createdAt: row.created_at, legacyId: row.legacy_id };
}
