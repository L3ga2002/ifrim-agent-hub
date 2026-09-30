import { AsyncLocalStorage } from "node:async_hooks";
import { newId } from "../core/ids.mjs";

const ambientContext = new AsyncLocalStorage();
import { redactDeep } from "../security/redact.mjs";
import { tx, json, parse } from "../storage/db.mjs";

export const EVENT_SCHEMA_VERSION = 2;

/**
 * Versioned, append-only internal event bus. Events are written in the same transaction as the
 * projection they describe and published to live subscribers only after COMMIT, so a subscriber never
 * sees an event whose state change was rolled back. `seq` gives a total order for replay.
 *
 * Envelope v2 (Milestone 01): event_id, schema_version, timestamp, source, company_id, department_id,
 * project_id, mission_id, task_id, agent_run_id, correlation_id, raw_ref, payload. Missing context is
 * resolved from the task/mission/run the event is about, so producers only pass what they know.
 */
export function createEventBus(db, clock = () => new Date()) {
  const listeners = new Set();
  let pending = [];
  let defaultCompanyId = null;

  const insert = db.prepare(`INSERT INTO events (id, type, schema_version, scope_type, scope_id, project_id, source, run_id, payload_json, dedupe_key, created_at,
    company_id, department_id, mission_id, task_id, correlation_id, raw_ref)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const byDedupe = db.prepare("SELECT * FROM events WHERE dedupe_key = ?");
  const taskCtx = db.prepare("SELECT t.id, t.mission_id, t.project_id, COALESCE(t.department_id, m.department_id) AS department_id, m.company_id FROM tasks t LEFT JOIN missions m ON m.id = t.mission_id WHERE t.id = ?");
  const missionCtx = db.prepare("SELECT id, project_id, department_id, company_id FROM missions WHERE id = ?");
  const runCtx = db.prepare("SELECT task_id, correlation_id FROM agent_runs WHERE id = ?");

  function resolveContext(event) {
    const ambient = ambientContext.getStore() || {};
    const ctx = { companyId: event.companyId || null, departmentId: event.departmentId || null, missionId: event.missionId || null,
      taskId: event.taskId || null, projectId: event.projectId || null, correlationId: event.correlationId || ambient.correlationId || null };
    if (event.scopeType === "task" && !ctx.taskId) ctx.taskId = event.scopeId;
    if (event.scopeType === "mission" && !ctx.missionId) ctx.missionId = event.scopeId;
    if (event.runId && (!ctx.taskId || !ctx.correlationId)) {
      const run = runCtx.get(event.runId);
      if (run) { ctx.taskId ||= run.task_id; ctx.correlationId ||= run.correlation_id; }
    }
    if (ctx.taskId) {
      const t = taskCtx.get(ctx.taskId);
      if (t) { ctx.missionId ||= t.mission_id; ctx.projectId ||= t.project_id; ctx.departmentId ||= t.department_id; ctx.companyId ||= t.company_id; }
    }
    if (ctx.missionId && (!ctx.companyId || !ctx.departmentId || !ctx.projectId)) {
      const m = missionCtx.get(ctx.missionId);
      if (m) { ctx.projectId ||= m.project_id; ctx.departmentId ||= m.department_id; ctx.companyId ||= m.company_id; }
    }
    ctx.companyId ||= defaultCompanyId;
    return ctx;
  }

  function append(event) {
    const { type, scopeType, scopeId, source = "hub", runId = null, payload = {}, dedupeKey = null, rawRef = null } = event;
    if (!type || !scopeType || !scopeId) throw new Error("event requires type, scopeType, scopeId");
    if (dedupeKey) {
      const existing = byDedupe.get(dedupeKey);
      if (existing) return { ...rowToEvent(existing), duplicate: true };
    }
    const ctx = resolveContext(event);
    const id = newId("evt");
    const createdAt = clock().toISOString();
    const safePayload = redactDeep(payload);
    const result = insert.run(id, type, EVENT_SCHEMA_VERSION, scopeType, scopeId, ctx.projectId, source, runId, json(safePayload), dedupeKey, createdAt,
      ctx.companyId, ctx.departmentId, ctx.missionId, ctx.taskId, ctx.correlationId, rawRef);
    const out = { seq: Number(result.lastInsertRowid), id, type, schemaVersion: EVENT_SCHEMA_VERSION, scopeType, scopeId, projectId: ctx.projectId, source, runId,
      companyId: ctx.companyId, departmentId: ctx.departmentId, missionId: ctx.missionId, taskId: ctx.taskId, correlationId: ctx.correlationId, rawRef,
      payload: safePayload, createdAt };
    pending.push(out);
    return out;
  }

  function transaction(fn) {
    try {
      const result = tx(db, fn);
      const toPublish = pending;
      pending = [];
      for (const event of toPublish) for (const listener of listeners) {
        try { listener(event); } catch { /* a faulty listener must not break the writer */ }
      }
      return result;
    } catch (error) {
      pending = [];
      throw error;
    }
  }

  /** Convenience: append one event in its own transaction. */
  const emit = (event) => transaction(() => append(event));

  function since(seq, limit = 500, scope = null) {
    const rows = scope
      ? db.prepare("SELECT * FROM events WHERE seq > ? AND scope_type = ? AND scope_id = ? ORDER BY seq LIMIT ?").all(seq, scope.type, scope.id, limit)
      : db.prepare("SELECT * FROM events WHERE seq > ? ORDER BY seq LIMIT ?").all(seq, limit);
    return rows.map(rowToEvent);
  }

  /** Filtered read for diagnostics (type prefix, task, correlation). */
  function query({ after = 0, limit = 300, typePrefix = null, taskId = null, correlationId = null, runId = null } = {}) {
    const where = ["seq > ?"]; const args = [after];
    // Escape LIKE wildcards: event types contain "_" (goal.at_risk, provider.native_task_started…).
    if (typePrefix) { where.push("type LIKE ? ESCAPE '\\'"); args.push(`${String(typePrefix).replace(/[\\%_]/g, (c) => `\\${c}`)}%`); }
    if (taskId) { where.push("task_id = ?"); args.push(taskId); }
    if (correlationId) { where.push("correlation_id = ?"); args.push(correlationId); }
    if (runId) { where.push("run_id = ?"); args.push(runId); }
    return db.prepare(`SELECT * FROM events WHERE ${where.join(" AND ")} ORDER BY seq DESC LIMIT ?`).all(...args, Math.min(2000, limit)).map(rowToEvent);
  }

  const lastSeq = () => db.prepare("SELECT COALESCE(MAX(seq), 0) AS seq FROM events").get().seq;
  const subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };

  /** Runs `fn` (sync or async) with an ambient correlation id inherited by every event it appends. */
  const withContext = (context, fn) => ambientContext.run({ ...(ambientContext.getStore() || {}), ...context }, fn);

  return { append, transaction, emit, since, query, lastSeq, subscribe, withContext, listenerCount: () => listeners.size,
    setDefaultCompany: (id) => { defaultCompanyId = id; } };
}

export function rowToEvent(row) {
  return { seq: row.seq, id: row.id, type: row.type, schemaVersion: row.schema_version, scopeType: row.scope_type, scopeId: row.scope_id,
    projectId: row.project_id, source: row.source, runId: row.run_id, companyId: row.company_id ?? null, departmentId: row.department_id ?? null,
    missionId: row.mission_id ?? null, taskId: row.task_id ?? null, correlationId: row.correlation_id ?? null, rawRef: row.raw_ref ?? null,
    payload: parse(row.payload_json, {}), createdAt: row.created_at };
}
