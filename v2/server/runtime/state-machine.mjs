import { HubError } from "../core/errors.mjs";
import { newId } from "../core/ids.mjs";

export const TASK_STATES = Object.freeze(["DRAFT", "QUEUED", "PLANNING", "RUNNING", "WAITING_APPROVAL", "WAITING_PROVIDER",
  "BLOCKED", "PAUSED", "VERIFYING", "COMPLETED", "FAILED", "CANCELLED"]);

export const TERMINAL_STATES = Object.freeze(new Set(["COMPLETED", "FAILED", "CANCELLED"]));

/**
 * Allowed transitions. RUNNING never goes straight to COMPLETED: a finished model turn only moves
 * the task to VERIFYING, and completion needs verification evidence (tests/review/QA).
 */
const TRANSITIONS = {
  DRAFT: ["QUEUED", "PLANNING", "CANCELLED"],
  QUEUED: ["PLANNING", "RUNNING", "WAITING_APPROVAL", "WAITING_PROVIDER", "BLOCKED", "PAUSED", "CANCELLED"],
  PLANNING: ["QUEUED", "RUNNING", "WAITING_APPROVAL", "BLOCKED", "PAUSED", "CANCELLED", "FAILED"],
  RUNNING: ["VERIFYING", "WAITING_APPROVAL", "WAITING_PROVIDER", "BLOCKED", "PAUSED", "FAILED", "CANCELLED"],
  WAITING_APPROVAL: ["QUEUED", "RUNNING", "BLOCKED", "PAUSED", "CANCELLED"],
  WAITING_PROVIDER: ["QUEUED", "RUNNING", "BLOCKED", "PAUSED", "CANCELLED", "FAILED"],
  BLOCKED: ["QUEUED", "PLANNING", "PAUSED", "CANCELLED", "FAILED"],
  PAUSED: ["QUEUED", "CANCELLED"],
  VERIFYING: ["COMPLETED", "QUEUED", "BLOCKED", "FAILED", "CANCELLED"],
  COMPLETED: [],
  FAILED: ["QUEUED"],
  CANCELLED: [],
};

export function canTransition(from, to) {
  return Boolean(TRANSITIONS[from]?.includes(to));
}

/**
 * Validated, persisted transition with optimistic concurrency. Must run inside bus.transaction.
 * `evidence` is required for VERIFYING -> COMPLETED.
 */
export function transitionTask(db, bus, clock, { taskId, to, reason, actor, expectedVersion = null, evidence = null }) {
  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId);
  if (!task) throw new HubError("not_found", "Task not found");
  if (expectedVersion !== null && task.version !== expectedVersion) throw new HubError("conflict", "Task changed; reload and retry");
  if (task.status === to) return task;
  if (!canTransition(task.status, to)) throw new HubError("task", `Transition ${task.status} -> ${to} is not allowed`);
  if (!reason || reason.length < 3) throw new HubError("validation", "A transition needs a reason");
  if (to === "COMPLETED" && !(evidence && (evidence.tests?.length || evidence.reviewRunId || evidence.qaRunId || evidence.manualVerification))) {
    throw new HubError("task", "Completion requires verification evidence (tests, independent review/QA or recorded manual verification)");
  }
  const now = clock().toISOString();
  const result = db.prepare("UPDATE tasks SET status = ?, status_reason = ?, updated_at = ?, version = version + 1 WHERE id = ? AND version = ?")
    .run(to, reason, now, taskId, task.version);
  if (result.changes !== 1) throw new HubError("conflict", "Task changed concurrently");
  db.prepare("INSERT INTO task_transitions (id, task_id, from_status, to_status, reason, actor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(newId("trn"), taskId, task.status, to, reason, actor, now);
  bus.append({ type: `task.${to.toLowerCase()}`, scopeType: "task", scopeId: taskId, projectId: task.project_id, source: actor,
    payload: { from: task.status, to, reason, missionId: task.mission_id, evidence: evidence || undefined } });
  return db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId);
}
