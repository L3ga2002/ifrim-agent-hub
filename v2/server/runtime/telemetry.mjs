import { newId } from "../core/ids.mjs";
import { json, parse } from "../storage/db.mjs";

export const TELEMETRY_SOURCES = Object.freeze(["MEASURED", "PROVIDER_REPORTED", "DERIVED", "UNKNOWN"]);

/**
 * Execution telemetry: one row per AgentRun (plus verification outcome of its task), with every field
 * labelled MEASURED (Hub clock/DB), PROVIDER_REPORTED (from the provider stream), DERIVED (computed by
 * the Hub from other facts) or UNKNOWN. The router reads only aggregated, labelled outcomes.
 */
export function createTelemetry({ db, bus, clock }) {
  function recordRun(runId) {
    const run = db.prepare("SELECT * FROM agent_runs WHERE id = ?").get(runId);
    if (!run) return null;
    const task = run.task_id ? db.prepare("SELECT t.*, m.company_id, COALESCE(t.department_id, m.department_id) AS dept FROM tasks t LEFT JOIN missions m ON m.id = t.mission_id WHERE t.id = ?").get(run.task_id) : null;
    const events = db.prepare("SELECT type FROM events WHERE run_id = ?").all(runId).map((e) => e.type);
    const tools = db.prepare("SELECT tool, status FROM tool_calls WHERE run_id = ?").all(runId);
    const approvalsDecided = db.prepare("SELECT COUNT(*) AS n FROM approvals WHERE scope_type = 'run' AND scope_id = ? AND decided_by IS NOT NULL").get(runId).n;
    const handoffs = run.conversation_id ? db.prepare("SELECT COUNT(*) AS n FROM handoffs WHERE conversation_id = ? AND created_at >= ?").get(run.conversation_id, run.created_at).n : 0;
    const usage = parse(run.usage_json, {});
    const hasUsage = usage && Object.keys(usage).length > 0;
    const durationMs = run.started_at && run.finished_at ? new Date(run.finished_at) - new Date(run.started_at) : null;
    const modelReported = events.includes("run.session") && run.model;
    const sources = {
      provider: "MEASURED", surface: run.surface_id ? "MEASURED" : "DERIVED", model: modelReported ? "PROVIDER_REPORTED" : run.model ? "DERIVED" : "UNKNOWN",
      duration: durationMs === null ? "UNKNOWN" : "MEASURED", attempts: "MEASURED", interruptions: "MEASURED", tools: "MEASURED", tests: "MEASURED",
      findings: "UNKNOWN", humanInterventions: "MEASURED", handoffs: "MEASURED", failure: run.error_category ? "PROVIDER_REPORTED" : "DERIVED",
      verifiedOutcome: "DERIVED", usage: hasUsage ? "PROVIDER_REPORTED" : "UNKNOWN", skillVersions: "MEASURED",
    };
    const row = {
      runId, taskId: run.task_id, companyId: task?.company_id || null, departmentId: run.department_id || task?.dept || null, roleId: run.role_id || task?.role_id || "",
      taskType: task?.task_type || run.stage || "", provider: run.provider, model: run.model || "", surfaceId: run.surface_id || defaultSurface(run.provider),
      skillVersions: run.skill_versions_json || "[]", startedAt: run.started_at, finishedAt: run.finished_at, durationMs,
      // Attempts: runs of the same task and provider; without a task, retries of the same user message.
      attempts: run.task_id
        ? db.prepare("SELECT COUNT(*) AS n FROM agent_runs WHERE task_id = ? AND provider = ? AND created_at <= ?").get(run.task_id, run.provider, run.created_at).n
        : db.prepare("SELECT COUNT(*) AS n FROM agent_runs WHERE task_id IS NULL AND conversation_id IS ? AND input_message_id IS ? AND provider = ? AND created_at <= ?").get(run.conversation_id, run.input_message_id, run.provider, run.created_at).n,
      interruptions: events.filter((t) => t === "run.interrupted").length,
      tools: json(tools.map((t) => ({ tool: t.tool, status: t.status }))), tests: json(tools.filter((t) => t.tool.startsWith("process.test")).map((t) => t.status)),
      humanInterventions: approvalsDecided, handoffs, failure: ["completed"].includes(run.status) ? null : run.error_category || run.status,
      verifiedOutcome: task?.status === "COMPLETED" ? "verified" : task?.status === "FAILED" || task?.status === "CANCELLED" ? "rejected" : "unverified",
      usage: json(hasUsage ? usage : {}), sources: json(sources),
    };
    const now = clock().toISOString();
    db.prepare(`INSERT INTO execution_telemetry (id, run_id, task_id, company_id, department_id, role_id, task_type, provider, model, surface_id, skill_versions_json,
        started_at, finished_at, duration_ms, attempts, interruptions, tools_json, tests_json, human_interventions, handoffs, failure_category, verified_outcome, usage_json, sources_json, created_at, updated_at)
      VALUES (@id, @runId, @taskId, @companyId, @departmentId, @roleId, @taskType, @provider, @model, @surfaceId, @skillVersions, @startedAt, @finishedAt, @durationMs, @attempts,
        @interruptions, @tools, @tests, @humanInterventions, @handoffs, @failure, @verifiedOutcome, @usage, @sources, @now, @now)
      ON CONFLICT(run_id) DO UPDATE SET model = excluded.model, finished_at = excluded.finished_at, duration_ms = excluded.duration_ms, interruptions = excluded.interruptions,
        tools_json = excluded.tools_json, tests_json = excluded.tests_json, human_interventions = excluded.human_interventions, handoffs = excluded.handoffs,
        failure_category = excluded.failure_category, verified_outcome = excluded.verified_outcome, usage_json = excluded.usage_json, sources_json = excluded.sources_json, updated_at = excluded.updated_at`)
      .run({ ...row, id: newId("tel"), now });
    return get(runId);
  }

  /** Task verified/rejected after the run: updates the outcome of every run of that task. */
  function recordTaskOutcome(taskId) {
    const task = db.prepare("SELECT status FROM tasks WHERE id = ?").get(taskId);
    if (!task) return 0;
    const outcome = task.status === "COMPLETED" ? "verified" : ["FAILED", "CANCELLED"].includes(task.status) ? "rejected" : "unverified";
    return db.prepare("UPDATE execution_telemetry SET verified_outcome = ?, updated_at = ? WHERE task_id = ?").run(outcome, clock().toISOString(), taskId).changes;
  }

  const get = (runId) => {
    const r = db.prepare("SELECT * FROM execution_telemetry WHERE run_id = ?").get(runId);
    return r && rowTo(r);
  };

  function list({ limit = 200 } = {}) {
    return db.prepare("SELECT * FROM execution_telemetry ORDER BY created_at DESC LIMIT ?").all(limit).map(rowTo);
  }

  /** Outcomes per (task type, surface). Only verified/rejected count; unverified runs are reported separately. */
  function outcomes({ taskType = null } = {}) {
    return db.prepare(`SELECT task_type AS taskType, surface_id AS surfaceId, provider, COUNT(*) AS runs,
        SUM(CASE WHEN verified_outcome = 'verified' THEN 1 ELSE 0 END) AS verified,
        SUM(CASE WHEN verified_outcome = 'rejected' THEN 1 ELSE 0 END) AS rejected,
        SUM(CASE WHEN failure_category IS NOT NULL THEN 1 ELSE 0 END) AS failures,
        AVG(duration_ms) AS avgDurationMs, SUM(interruptions) AS interruptions, SUM(human_interventions) AS humanInterventions
      FROM execution_telemetry ${taskType ? "WHERE task_type = ?" : ""} GROUP BY task_type, surface_id, provider ORDER BY runs DESC`).all(...(taskType ? [taskType] : []))
      .map((r) => ({ ...r, successRate: r.verified + r.rejected > 0 ? r.verified / (r.verified + r.rejected) : null, source: "DERIVED" }));
  }

  return { recordRun, recordTaskOutcome, get, list, outcomes };
}

const defaultSurface = (provider) => (provider === "codex" ? "openai.codex_app_server" : provider === "claude" ? "anthropic.claude_code_headless" : null);

function rowTo(r) {
  return { id: r.id, runId: r.run_id, taskId: r.task_id, companyId: r.company_id, departmentId: r.department_id, roleId: r.role_id, taskType: r.task_type,
    provider: r.provider, model: r.model, surfaceId: r.surface_id, skillVersions: parse(r.skill_versions_json, []), startedAt: r.started_at, finishedAt: r.finished_at,
    durationMs: r.duration_ms, attempts: r.attempts, interruptions: r.interruptions, tools: parse(r.tools_json, []), tests: parse(r.tests_json, []),
    findings: parse(r.findings_json, []), humanInterventions: r.human_interventions, handoffs: r.handoffs, failureCategory: r.failure_category,
    verifiedOutcome: r.verified_outcome, usage: parse(r.usage_json, {}), sources: parse(r.sources_json, {}), updatedAt: r.updated_at };
}
