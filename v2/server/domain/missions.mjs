import { HubError } from "../core/errors.mjs";
import { newId } from "../core/ids.mjs";
import { json, parse } from "../storage/db.mjs";
import { transitionTask, TERMINAL_STATES } from "../runtime/state-machine.mjs";
import { canTransition } from "../runtime/lifecycles.mjs";

/** Mission templates: usable flows, each expanded into tasks with owner → reviewer → QA separation. */
export const MISSION_TEMPLATES = Object.freeze({
  development: { label: "Development", department: "engineering", tasks: [
    { key: "plan", title: "Plan scope and acceptance", role: "planner", stage: "owner", access: "read-only" },
    { key: "build", title: "Implement", role: "backend", stage: "owner", access: "workspace-write", after: ["plan"] },
    { key: "review", title: "Independent review", role: "reviewer", stage: "reviewer", access: "read-only", after: ["build"] },
    { key: "qa", title: "QA against acceptance criteria", role: "qa", stage: "qa", access: "read-only", after: ["review"] },
  ] },
  incident: { label: "Incident", department: "engineering", tasks: [
    { key: "reproduce", title: "Reproduce with authorized logs", role: "qa", stage: "owner", access: "read-only" },
    { key: "fix", title: "Root cause, fix and regression test", role: "backend", stage: "owner", access: "workspace-write", after: ["reproduce"] },
    { key: "review", title: "Independent review of the fix", role: "reviewer", stage: "reviewer", access: "read-only", after: ["fix"] },
    { key: "report", title: "Incident report", role: "documentation", stage: "owner", access: "read-only", after: ["review"] },
  ] },
  site_premium: { label: "Premium site", department: "engineering", tasks: [
    { key: "brief", title: "Brief and structure", role: "planner", stage: "owner", access: "read-only" },
    { key: "design", title: "Design direction and tokens", role: "design", stage: "owner", access: "read-only", after: ["brief"] },
    { key: "build", title: "Implementation", role: "frontend", stage: "owner", access: "workspace-write", after: ["design"] },
    { key: "qa", title: "Responsive and accessibility verification", role: "qa", stage: "qa", access: "read-only", after: ["build"] },
  ] },
  site_audit: { label: "Site audit", department: "sales", tasks: [
    { key: "identify", title: "Identify business and correct domain (sourced, dated)", role: "website-auditor", stage: "owner", access: "read-only" },
    { key: "audit", title: "Findings separated from suggestions", role: "website-auditor", stage: "owner", access: "read-only", after: ["identify"] },
    { key: "review", title: "Review findings for evidence", role: "reviewer", stage: "reviewer", access: "read-only", after: ["audit"] },
  ] },
  leads: { label: "Leads", department: "sales", tasks: [
    { key: "import", title: "Import and deduplicate leads", role: "sales-assistant", stage: "owner", access: "read-only" },
    { key: "research", title: "Verifiable research per lead", role: "research", stage: "owner", access: "read-only", after: ["import"] },
  ] },
  outreach: { label: "Outreach", department: "sales", tasks: [
    { key: "draft", title: "Contextual draft and offer (not sent)", role: "sales-assistant", stage: "owner", access: "read-only" },
    { key: "review", title: "Your review before any sending", role: "reviewer", stage: "reviewer", access: "read-only", after: ["draft"] },
  ] },
  project_management: { label: "Project management", department: "project-management", tasks: [
    { key: "map", title: "Tasks, dependencies and blockers", role: "project-manager", stage: "owner", access: "read-only" },
  ] },
  briefing: { label: "Briefing", department: "operations", tasks: [
    { key: "brief", title: "What finished, what is blocked, what needs approval", role: "project-manager", stage: "owner", access: "read-only" },
  ] },
  research: { label: "Research", department: "research", tasks: [
    { key: "question", title: "Define the question, sources allowed and decision it serves", role: "research", stage: "owner", access: "read-only", taskType: "research" },
    { key: "research", title: "Sourced, dated findings (native research surface preferred)", role: "research", stage: "owner", access: "read-only", after: ["question"], taskType: "research" },
    { key: "review", title: "Review every claim for a source", role: "reviewer", stage: "reviewer", access: "read-only", after: ["research"], taskType: "code_review" },
  ] },
  operations_routine: { label: "Operations routine", department: "operations", tasks: [
    { key: "check", title: "Check health, backups, schedules and allowance (no models)", role: "operations-coordinator", stage: "owner", access: "read-only", taskType: "operations" },
    { key: "report", title: "Record results and open incidents with evidence", role: "operations-coordinator", stage: "owner", access: "read-only", after: ["check"], taskType: "briefing" },
  ] },
  executive_review: { label: "Executive review", department: "executive", tasks: [
    { key: "collect", title: "Collect goals, blockers, approvals and results across departments", role: "chief-of-staff", stage: "owner", access: "read-only", taskType: "briefing" },
    { key: "decide", title: "Decisions needed from the owner, with options and evidence", role: "chief-of-staff", stage: "owner", access: "read-only", after: ["collect"], taskType: "briefing" },
  ] },
});

/** Task type of a template task (router input); explicit `taskType` wins over the role heuristic. */
export const TASK_TYPE_BY_ROLE = Object.freeze({
  planner: "architecture", architect: "architecture", backend: "coding", frontend: "coding", mobile: "coding", database: "coding", design: "design_ui",
  reviewer: "code_review", qa: "testing_qa", security: "security_review", devops: "devops", research: "research", "website-auditor": "site_audit",
  "sales-assistant": "outreach_draft", "project-manager": "briefing", documentation: "documents", "chief-of-staff": "briefing", "operations-coordinator": "operations",
});

export function createMissions({ db, bus, clock }) {
  const rowToMission = (row) => row && ({ id: row.id, projectId: row.project_id, kind: row.kind, title: row.title, objective: row.objective,
    acceptance: parse(row.acceptance_json, []), constraints: parse(row.constraints_json, []), status: row.status, priority: row.priority,
    conversationId: row.conversation_id, companyId: row.company_id ?? null, departmentId: row.department_id ?? null, goalId: row.goal_id ?? null,
    objectiveId: row.objective_id ?? null, clientId: row.client_id ?? null, createdAt: row.created_at, updatedAt: row.updated_at, version: row.version, legacyId: row.legacy_id });
  const rowToTask = (row) => row && ({ id: row.id, missionId: row.mission_id, projectId: row.project_id, title: row.title, description: row.description,
    roleId: row.role_id, stage: row.stage, status: row.status, statusReason: row.status_reason, priority: row.priority,
    dependsOn: parse(row.depends_on_json, []), acceptance: parse(row.acceptance_json, []), attempts: row.attempts, maxAttempts: row.max_attempts,
    noProgressRetries: row.no_progress_retries, lastActivityAt: row.last_activity_at, lastProgressAt: row.last_progress_at,
    provider: row.provider, model: row.model, access: row.access, departmentId: row.department_id ?? null, taskType: row.task_type ?? "", routeDecisionId: row.route_decision_id ?? null,
    createdAt: row.created_at, updatedAt: row.updated_at, version: row.version, legacyId: row.legacy_id });

  function create({ projectId, kind, title, objective, acceptance = [], constraints = [], priority = 2, conversationId = null }, actor = "user") {
    const template = MISSION_TEMPLATES[kind];
    if (!template) throw new HubError("validation", `Unknown mission kind ${kind}`);
    const id = newId("mis");
    const now = clock().toISOString();
    db.prepare(`INSERT INTO missions (id, project_id, kind, title, objective, acceptance_json, constraints_json, status, priority, conversation_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?)`).run(id, projectId, kind, title, objective, json(acceptance), json(constraints), priority, conversationId, now, now);
    const keyToId = {};
    for (const spec of template.tasks) {
      const taskId = newId("task");
      keyToId[spec.key] = taskId;
      const deps = (spec.after || []).map((key) => keyToId[key]);
      db.prepare(`INSERT INTO tasks (id, mission_id, project_id, title, description, role_id, stage, status, status_reason, priority, depends_on_json, acceptance_json, access, task_type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'DRAFT', 'Created from mission template', ?, ?, ?, ?, ?, ?, ?)`)
        .run(taskId, id, projectId, spec.title, "", spec.role, spec.stage, priority, json(deps), json(acceptance), spec.access, spec.taskType || TASK_TYPE_BY_ROLE[spec.role] || "", now, now);
      for (const dep of deps) db.prepare("INSERT INTO task_dependencies (task_id, depends_on_task_id, created_at) VALUES (?, ?, ?)").run(taskId, dep, now);
    }
    bus.append({ type: "mission.created", scopeType: "mission", scopeId: id, projectId, source: actor, payload: { kind, title, tasks: template.tasks.length } });
    return get(id);
  }

  const get = (id) => rowToMission(db.prepare("SELECT * FROM missions WHERE id = ?").get(id));
  const list = (projectId = null) => (projectId
    ? db.prepare("SELECT * FROM missions WHERE project_id = ? ORDER BY updated_at DESC").all(projectId)
    : db.prepare("SELECT * FROM missions ORDER BY updated_at DESC LIMIT 200").all()).map(rowToMission);
  const tasks = (missionId) => db.prepare("SELECT * FROM tasks WHERE mission_id = ? ORDER BY created_at").all(missionId).map(rowToTask);
  const task = (id) => rowToTask(db.prepare("SELECT * FROM tasks WHERE id = ?").get(id));
  const transitions = (taskId) => db.prepare("SELECT * FROM task_transitions WHERE task_id = ? ORDER BY created_at").all(taskId);

  /** Progress method: count of COMPLETED tasks over all non-cancelled tasks. No estimated percentages. */
  function progress(missionId) {
    const all = tasks(missionId).filter((t) => t.status !== "CANCELLED");
    const done = all.filter((t) => t.status === "COMPLETED").length;
    return { method: "completed_tasks / non_cancelled_tasks", completed: done, total: all.length,
      blocked: all.filter((t) => ["BLOCKED", "FAILED"].includes(t.status)).length,
      waitingApproval: all.filter((t) => t.status === "WAITING_APPROVAL").length };
  }

  /** TaskDependency table is authoritative; the JSON column is a compatibility copy. */
  const dependencyIds = (taskId) => db.prepare("SELECT depends_on_task_id AS id FROM task_dependencies WHERE task_id = ?").all(taskId).map((r) => r.id);

  function dependenciesMet(t) {
    const ids = new Set([...dependencyIds(t.id), ...t.dependsOn]);
    return [...ids].every((depId) => task(depId)?.status === "COMPLETED");
  }

  /** Adds a finish-to-start dependency; rejects self-references and cycles. Must run inside bus.transaction. */
  function addDependency(taskId, dependsOnId, actor = "user") {
    const a = task(taskId); const b = task(dependsOnId);
    if (!a || !b) throw new HubError("not_found", "Task not found");
    if (taskId === dependsOnId) throw new HubError("validation", "A task cannot depend on itself");
    const seen = new Set(); const stack = [dependsOnId];
    while (stack.length) {
      const current = stack.pop();
      if (current === taskId) throw new HubError("validation", "Dependency would create a cycle");
      if (seen.has(current)) continue;
      seen.add(current);
      stack.push(...dependencyIds(current));
    }
    db.prepare("INSERT OR IGNORE INTO task_dependencies (task_id, depends_on_task_id, created_at) VALUES (?, ?, ?)").run(taskId, dependsOnId, clock().toISOString());
    const merged = [...new Set([...a.dependsOn, dependsOnId])];
    db.prepare("UPDATE tasks SET depends_on_json = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(json(merged), clock().toISOString(), taskId);
    bus.append({ type: "task.dependency_added", scopeType: "task", scopeId: taskId, source: actor, payload: { dependsOn: dependsOnId } });
    return task(taskId);
  }

  /** User commands on tasks. Each maps to a validated state transition with a reason. */
  function command(taskId, action, { reason = "", actor = "user", evidence = null } = {}) {
    const current = task(taskId);
    if (!current) throw new HubError("not_found", "Task not found");
    const map = {
      queue: () => {
        if (!dependenciesMet(current)) throw new HubError("task", "Dependencies are not completed yet");
        return "QUEUED";
      },
      pause: () => "PAUSED", resume: () => "QUEUED", cancel: () => "CANCELLED", block: () => "BLOCKED", retry: () => "QUEUED",
      verify: () => {
        if (current.status !== "VERIFYING") throw new HubError("task", "Only a task in VERIFYING can be completed");
        return "COMPLETED";
      },
      reject: () => "QUEUED",
    };
    if (!map[action]) throw new HubError("validation", `Unknown task action ${action}`);
    const to = map[action]();
    const updated = transitionTask(db, bus, clock, { taskId, to, reason: reason || `User ${action}`, actor, evidence });
    refreshMissionStatus(current.missionId);
    return rowToTask(updated);
  }

  function refreshMissionStatus(missionId) {
    if (!missionId) return;
    const all = tasks(missionId);
    const mission = get(missionId);
    let status = "ACTIVE";
    if (all.length && all.every((t) => TERMINAL_STATES.has(t.status))) status = all.some((t) => t.status === "FAILED") ? "FAILED" : all.every((t) => t.status === "CANCELLED") ? "CANCELLED" : "COMPLETED";
    else if (all.every((t) => t.status === "DRAFT")) status = "DRAFT";
    else if (all.some((t) => t.status === "BLOCKED" || t.status === "WAITING_APPROVAL")) status = "ATTENTION";
    if (mission && mission.status !== status) {
      if (!canTransition("mission", mission.status, status)) {
        bus.append({ type: "mission.status_rejected", scopeType: "mission", scopeId: missionId, source: "hub", payload: { from: mission.status, derived: status } });
        return;
      }
      db.prepare("UPDATE missions SET status = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(status, clock().toISOString(), missionId);
      bus.append({ type: "mission.status", scopeType: "mission", scopeId: missionId, projectId: mission.projectId, source: "hub", payload: { status } });
    }
  }

  const allTasks = (filter = {}) => {
    const where = [];
    const args = [];
    if (filter.status) { where.push("status = ?"); args.push(filter.status); }
    if (filter.projectId) { where.push("project_id = ?"); args.push(filter.projectId); }
    return db.prepare(`SELECT * FROM tasks ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY updated_at DESC LIMIT 500`).all(...args).map(rowToTask);
  };

  return { create, get, list, tasks, task, transitions, progress, command, refreshMissionStatus, allTasks, dependenciesMet, dependencyIds, addDependency, rowToTask };
}
