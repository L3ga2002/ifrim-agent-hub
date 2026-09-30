import { parse } from "../storage/db.mjs";

/**
 * Briefing computed from persisted state only: what finished, what is blocked, what needs your
 * approval, and system health. Progress uses the explicit completed/total task method.
 */
export function buildBriefing({ db, settings, missions, backups, projects, clock, sinceHours = 24 }) {
  const since = new Date(clock().getTime() - sinceHours * 3600000).toISOString();
  const completedTasks = db.prepare("SELECT t.id, t.title, t.mission_id FROM tasks t WHERE t.status = 'COMPLETED' AND t.updated_at >= ? ORDER BY t.updated_at DESC LIMIT 20").all(since);
  const blocked = db.prepare("SELECT id, title, status, status_reason, mission_id FROM tasks WHERE status IN ('BLOCKED','FAILED','WAITING_PROVIDER') ORDER BY updated_at DESC LIMIT 30").all();
  const pendingApprovals = db.prepare("SELECT id, action_kind, target, expires_at, permission_tier FROM approvals WHERE status = 'pending' ORDER BY created_at DESC").all();
  const runs = db.prepare("SELECT status, COUNT(*) AS n FROM agent_runs WHERE created_at >= ? GROUP BY status").all(since);
  const hub = projects.hub();
  const backup = hub ? backups.freshVerified(hub.id) : { ok: false, reason: "Hub project not registered" };
  const activeMissions = missions.list().filter((m) => !["COMPLETED", "CANCELLED", "FAILED"].includes(m.status)).slice(0, 10)
    .map((m) => ({ id: m.id, title: m.title, kind: m.kind, status: m.status, progress: missions.progress(m.id) }));
  const failures = db.prepare("SELECT id, provider, error_category, error_message, pre_inference, created_at FROM agent_runs WHERE status IN ('failed','blocked','interrupted_unknown','orphaned') AND created_at >= ? ORDER BY created_at DESC LIMIT 10").all(since);
  return {
    generatedAt: clock().toISOString(), windowHours: sinceHours,
    mode: settings.get("mode"), executionGate: settings.get("executionGate"),
    completed: completedTasks, blocked: blocked.map((t) => ({ ...t, reason: t.status_reason })),
    approvalsNeeded: pendingApprovals, runs: Object.fromEntries(runs.map((r) => [r.status, r.n])),
    failures: failures.map((f) => ({ ...f, preInference: Boolean(f.pre_inference) })),
    missions: activeMissions,
    backup: backup.ok ? { ok: true, id: backup.backup.id, createdAt: backup.backup.createdAt } : { ok: false, reason: backup.reason },
    legacy: parse(db.prepare("SELECT value_json FROM settings WHERE key = 'legacyImport'").get()?.value_json, null),
  };
}

export function briefingMarkdown(b) {
  const lines = [`# Briefing — ${b.generatedAt}`, "", `Mode: ${b.mode} · Execution gate: ${b.executionGate.status}${b.executionGate.status !== "open" ? ` (${b.executionGate.reason})` : ""}`, ""];
  lines.push("## Finished", ...(b.completed.length ? b.completed.map((t) => `- ${t.title}`) : ["- Nothing completed in this window."]), "");
  lines.push("## Blocked", ...(b.blocked.length ? b.blocked.map((t) => `- ${t.title} [${t.status}]: ${t.reason}`) : ["- Nothing blocked."]), "");
  lines.push("## Needs your approval", ...(b.approvalsNeeded.length ? b.approvalsNeeded.map((a) => `- ${a.action_kind} on ${a.target} (expires ${a.expires_at})`) : ["- No pending approvals."]), "");
  lines.push("## Missions", ...(b.missions.length ? b.missions.map((m) => `- ${m.title}: ${m.progress.completed}/${m.progress.total} tasks completed [${m.status}]`) : ["- No active missions."]), "");
  lines.push("## Backup", b.backup.ok ? `- Verified backup ${b.backup.id} at ${b.backup.createdAt}` : `- ${b.backup.reason}`);
  return lines.join("\n");
}
