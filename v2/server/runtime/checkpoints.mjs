import { HubError } from "../core/errors.mjs";
import { newId } from "../core/ids.mjs";
import { json, parse } from "../storage/db.mjs";
import { gitState } from "../tools/git.mjs";
import { redactDeep } from "../security/redact.mjs";

/**
 * Hub operational checkpoint (cross-provider). Different from a Claude Code checkpoint (/rewind is
 * local to one Claude session and covers that session's file edits) and from a Codex thread: the Hub
 * checkpoint captures missions/tasks, approvals, workspace locks, provider sessions, tests,
 * artifacts, external effects and the next action, and REFERENCES native checkpoints/sessions instead
 * of copying them. Checkpoint ≠ Backup ≠ Migration ≠ Commit: it links the latest verified backup id.
 */
export function createCheckpoints({ db, bus, clock, projects, conversations, missions, approvals, leases, backups }) {
  const rowTo = (r) => r && ({ id: r.id, scopeType: r.scope_type, scopeId: r.scope_id, kind: r.kind, label: r.label, gitHead: r.git_head, gitBranch: r.git_branch,
    dirty: parse(r.dirty_json, []), manifest: parse(r.manifest_json, {}), hubState: parse(r.hub_state_json, {}), nativeRefs: parse(r.native_refs_json, []),
    nextAction: r.next_action, backupId: r.backup_id, createdBy: r.created_by, createdAt: r.created_at });

  function projectFor(scopeType, scopeId) {
    const found = (value) => { if (!value) throw new HubError("not_found", `Checkpoint scope ${scopeType} ${scopeId || ""} not found`.trim()); return value; };
    if (scopeType === "conversation") return projects.get(found(scopeId && conversations.get(scopeId)).projectId);
    if (scopeType === "mission") return projects.get(found(scopeId && missions.get(scopeId)).projectId);
    if (scopeType === "task") return projects.get(found(scopeId && missions.task(scopeId)).projectId);
    if (scopeType === "project") return scopeId ? projects.get(scopeId) : null;
    return projects.hub();
  }

  /** Native references: Codex threads / Claude sessions linked to the scope, plus mirrored native sessions. */
  function nativeRefs(scopeType, scopeId, project) {
    const convIds = scopeType === "conversation" ? [scopeId]
      : scopeType === "mission" ? [missions.get(scopeId)?.conversationId].filter(Boolean)
      : scopeType === "task" ? [missions.get(missions.task(scopeId)?.missionId)?.conversationId].filter(Boolean)
      : db.prepare("SELECT id FROM conversations WHERE project_id = ? ORDER BY updated_at DESC LIMIT 20").all(project?.id || "").map((r) => r.id);
    const refs = [];
    for (const conversationId of convIds) {
      for (const s of conversations.providerSessions(conversationId)) {
        refs.push({ kind: s.provider === "claude" ? "claude_code_session" : "codex_thread", provider: s.provider, nativeId: s.nativeSessionId || s.native_session_id, conversationId,
          note: s.provider === "claude" ? "Checkpointurile Claude Code (/rewind) sunt locale sesiunii și acoperă editările ei; Hub-ul doar le referențiază" : "Firul Codex păstrează istoricul nativ; Hub-ul îl referențiază" });
      }
    }
    for (const n of db.prepare("SELECT native_session_id, name, status FROM native_sessions WHERE project_id = ? AND status <> 'ended'").all(project?.id || "")) {
      refs.push({ kind: "claude_native_session", provider: "claude", nativeId: n.native_session_id, name: n.name, status: n.status, note: "Sesiune nativă oglindită (read-only)" });
    }
    return refs;
  }

  async function create({ scopeType = "project", scopeId = null, label = "", nextAction = "", kind = "operational" }, actor = "user") {
    if (!["conversation", "mission", "task", "project", "hub"].includes(scopeType)) throw new HubError("validation", "Unknown checkpoint scope");
    if (!["operational", "handoff", "milestone"].includes(kind)) throw new HubError("validation", "Unknown checkpoint kind");
    const project = projectFor(scopeType, scopeId);
    if (!project) throw new HubError("not_found", "Checkpoint scope not found");
    const git = await gitState(project.path).catch(() => ({ head: "", branch: "", dirty: [], untracked: [] }));
    const missionFilter = scopeType === "mission" ? "WHERE id = ?" : scopeType === "task" ? "WHERE id = (SELECT mission_id FROM tasks WHERE id = ?)" : "WHERE project_id = ?";
    const missionRows = db.prepare(`SELECT id, title, status FROM missions ${missionFilter} ORDER BY updated_at DESC LIMIT 50`).all(scopeType === "mission" || scopeType === "task" ? scopeId : project.id);
    const hubState = redactDeep({
      missions: missionRows.map((m) => ({ ...m, tasks: missions.tasks(m.id).map((t) => ({ id: t.id, title: t.title, status: t.status, roleId: t.roleId })) })),
      pendingApprovals: approvals.list("pending").map((a) => ({ id: a.id, actionKind: a.actionKind, scope: `${a.scopeType}:${a.scopeId}`, expiresAt: a.expiresAt })),
      locks: leases.list().map((l) => ({ id: l.id, resource: l.resource, holder: l.holder, status: l.status })),
      activeRuns: db.prepare("SELECT id, provider, status, surface_id AS surfaceId FROM agent_runs WHERE status IN ('starting','running','waiting_approval')").all(),
      tests: db.prepare("SELECT tool, status, finished_at AS finishedAt FROM tool_calls WHERE tool LIKE 'process.test%' AND json_extract(args_json, '$.projectId') = ? ORDER BY started_at DESC LIMIT 5").all(project.id),
      artifacts: db.prepare("SELECT id, kind, title, source, native_ref AS nativeRef, version FROM artifacts WHERE project_id = ? ORDER BY created_at DESC LIMIT 20").all(project.id),
      externalEffects: db.prepare("SELECT id, tool, status, effects FROM tool_calls WHERE effects NOT IN ('none','none (proposal only)') ORDER BY started_at DESC LIMIT 20").all(),
      git: { untrackedCount: git.untracked?.length || 0 },
    });
    const refs = nativeRefs(scopeType, scopeId, project);
    const backup = backups.freshVerified(project.id);
    const latestBackup = backup.backup || db.prepare("SELECT id FROM backups WHERE project_id = ? AND status = 'verified' ORDER BY created_at DESC LIMIT 1").get(project.id);
    const id = newId("ckpt");
    const next = nextAction || hubState.missions.flatMap((m) => m.tasks).find((t) => ["QUEUED", "DRAFT", "BLOCKED", "VERIFYING"].includes(t.status))?.title || "Inspectează starea și continuă ultima cerere";
    bus.transaction(() => {
      db.prepare(`INSERT INTO checkpoints (id, scope_type, scope_id, kind, git_head, git_branch, dirty_json, manifest_json, backup_id, label, hub_state_json, native_refs_json, next_action, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, scopeType, scopeId || project.id, kind, git.head || "", git.branch || "", json(git.dirty || []),
        json({ untracked: (git.untracked || []).slice(0, 200) }), latestBackup?.id || null, String(label).slice(0, 200), json(hubState), json(refs), next.slice(0, 500), actor, clock().toISOString());
      bus.append({ type: "checkpoint.created", scopeType: scopeType === "hub" ? "project" : scopeType, scopeId: scopeId || project.id, projectId: project.id, source: actor,
        payload: { checkpointId: id, kind, nativeRefs: refs.length, backupId: latestBackup?.id || null, backupFresh: backup.ok } });
    });
    return get(id);
  }

  const get = (id) => rowTo(db.prepare("SELECT * FROM checkpoints WHERE id = ?").get(id));
  const list = ({ limit = 50 } = {}) => db.prepare("SELECT * FROM checkpoints ORDER BY created_at DESC LIMIT ?").all(limit).map(rowTo);

  return { create, get, list, nativeRefs };
}
