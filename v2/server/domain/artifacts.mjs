import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { HubError } from "../core/errors.mjs";
import { newId } from "../core/ids.mjs";
import { isInside, isSecretLikeName, isProtectedRelative } from "../security/paths.mjs";

export const ARTIFACT_SOURCES = Object.freeze(["hub", "local_file", "claude_artifact", "claude_project", "claude_research", "claude_cowork", "openai_page",
  "openai_slides", "openai_space", "codex_cloud", "codex_review", "other"]);

/**
 * ArtifactReference: the Hub keeps source, version, owner, project, mission/task and the native
 * reference (URL/id) of work products — it does not claim to sync or export vendor artifacts.
 * Local files are hashed only when inside the project and not secret-like.
 */
export function createArtifacts({ db, bus, clock, projects }) {
  const rowTo = (r) => r && ({ id: r.id, projectId: r.project_id, missionId: r.mission_id, taskId: r.task_id, runId: r.run_id, kind: r.kind, title: r.title,
    path: r.path, sha256: r.sha256, size: r.size, description: r.description, source: r.source, surfaceId: r.surface_id, nativeRef: r.native_ref,
    version: r.version, owner: r.owner, createdAt: r.created_at });

  /** Must run inside bus.transaction. Same (project, source, nativeRef|path) → new version. */
  function register({ projectId, missionId = null, taskId = null, runId = null, kind, title, source = "hub", surfaceId = null, nativeRef = "", filePath = "", description = "", owner = "user" }, actor = "user") {
    const project = projects.get(projectId);
    if (!project) throw new HubError("not_found", "Project not found");
    if (!ARTIFACT_SOURCES.includes(source)) throw new HubError("validation", "Unknown artifact source");
    if (!kind || !title) throw new HubError("validation", "kind and title are required");
    // A native reference is either an https URL or an opaque id — never another URL scheme (javascript:, file:, data:).
    const httpsRef = /^https:\/\/[^\s<>"']+$/i.test(nativeRef);
    const opaqueId = /^[a-z0-9][a-z0-9_.-]{2,199}$/i.test(nativeRef);
    if (nativeRef && !(httpsRef || opaqueId)) throw new HubError("validation", "nativeRef must be an https URL or a native id");
    let sha = ""; let size = 0; let rel = "";
    if (filePath) {
      const abs = path.resolve(project.path, filePath);
      if (!isInside(project.path, abs)) throw new HubError("policy", "Artifact file must be inside the project");
      // Protected locations are judged relative to the project (and again on the real path, so a junction cannot hide them).
      const protectedHere = (root, target) => isProtectedRelative(path.relative(root, target));
      if (isSecretLikeName(path.basename(abs)) || protectedHere(project.path, abs)) throw new HubError("policy", "Secret-like files are not registered as artifacts");
      if (fs.existsSync(abs)) {
        const realRoot = fs.realpathSync.native(project.path); const realAbs = fs.realpathSync.native(abs);
        if (!isInside(realRoot, realAbs)) throw new HubError("policy", "Artifact file must be inside the project");
        if (protectedHere(realRoot, realAbs)) throw new HubError("policy", "Secret-like files are not registered as artifacts");
      }
      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw new HubError("validation", "Artifact file not found");
      const stat = fs.statSync(abs);
      size = stat.size;
      if (size <= 50 * 1024 * 1024) sha = crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex");
      rel = path.relative(project.path, abs).replaceAll("\\", "/");
    }
    const key = nativeRef || rel;
    const previous = key ? db.prepare("SELECT MAX(version) AS v FROM artifacts WHERE project_id = ? AND source = ? AND (native_ref = ? OR path = ?)").get(project.id, source, key, key)?.v || 0 : 0;
    const id = newId("art");
    db.prepare(`INSERT INTO artifacts (id, project_id, mission_id, task_id, run_id, kind, path, sha256, size, description, created_at, source, surface_id, native_ref, version, owner, title)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, project.id, missionId, taskId, runId, kind, rel, sha, size, description, clock().toISOString(),
      source, surfaceId, nativeRef, previous + 1, owner, title);
    bus.append({ type: "artifact.registered", scopeType: taskId ? "task" : "project", scopeId: taskId || project.id, projectId: project.id, missionId, taskId, source: actor,
      payload: { artifactId: id, kind, source, version: previous + 1, surfaceId } });
    return get(id);
  }

  const get = (id) => rowTo(db.prepare("SELECT * FROM artifacts WHERE id = ?").get(id));
  const list = ({ projectId = null, taskId = null, surfaceId = null, limit = 100 } = {}) => {
    const where = []; const args = [];
    if (projectId) { where.push("project_id = ?"); args.push(projectId); }
    if (taskId) { where.push("task_id = ?"); args.push(taskId); }
    if (surfaceId) { where.push("surface_id = ?"); args.push(surfaceId); }
    return db.prepare(`SELECT * FROM artifacts ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC LIMIT ?`).all(...args, limit).map(rowTo);
  };

  return { register, get, list };
}
