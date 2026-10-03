import { HubError } from "../core/errors.mjs";
import { newId } from "../core/ids.mjs";
import { validate } from "../core/validate.mjs";
import { json, parse } from "../storage/db.mjs";
import { redactDeep } from "../security/redact.mjs";

// "cli" (M05): a local script acting through the API (inference-free checks only); recorded as such, never as the owner's UI.
// "owner" (M06): the owner's authenticated session (WebAuthn); a command on it carries the verified session, never a claim.
// "agent" (M07): an engineering agent executing an operation the owner delegated in conversation. It is recorded as the agent
// (actor "agent", the delegation reference in intent_text), never as a click of the owner, and only the commands below accept it.
// It never reaches the owner channel: envelope confirmations, the voice-first policy and autonomy need the owner's session.
export const COMMAND_CHANNELS = Object.freeze(["ui", "voice", "automation", "schedule", "companion", "recovery", "test", "cli", "owner", "agent"]);
export const AGENT_COMMANDS = Object.freeze(new Set([
  "backup.run", "environment.inspect", "environment.probe", "environment.attest", "environment.warmup", "environment.reconcile",
  // Approving policy (b) is the owner's decision (it was delegated once, for M07; re-approval after a fingerprint change is yours);
  // revoking it is a fail-safe and stays delegated.
  "environment.policy.revoke", "project.environment.set", "project.register_test",
  "mode.set", "grant.create", "grant.revoke", "factory.prepare", "factory.limits", "factory.start", "factory.stop", "factory.pause",
  "approval.decide", "run.interrupt", "system.stop_all",
  // The bounded live probes (a read-only reviewer run on a test project): still behind the gate, a scoped grant and the budget.
  "conversation.create", "conversation.message", "run.start",
  // A plain resume of a mission the owner already authorized (after an infrastructure stop): no widening (checked in the handler).
  "factory.resume",
]));
/** An HTTP header can carry only Latin-1: a delegation may arrive percent-encoded (UTF-8) and is decoded here. */
export function decodeDelegation(header) {
  const raw = String(header || "");
  try { return decodeURIComponent(raw); } catch { return raw; }
}
/** The delegation reference an agent command must carry: who authorized it, where (printable, bounded). */
export function checkDelegation(text) {
  const value = String(text || "").trim();
  if (value.length < 8 || value.length > 300 || /[\x00-\x1f\x7f]/.test(value)) throw new HubError("policy", "Canalul agent cere o referință de delegare (X-Hub-Delegation: cine a autorizat, unde), 8–300 caractere");
  return value;
}
const RESULT_LIMIT = 20000;

/**
 * Command bus: USER/EVENT → INTENT → COMMAND → POLICY → ROUTING → EXECUTION SURFACE → EXECUTION →
 * EVENT → PERSISTENCE. Every state change requested from outside the Hub core (UI, voice, automations,
 * schedules, companion surfaces) is a named command with a validated payload, an approval-policy
 * decision, an optional route decision and a persisted log row. The UI never writes state directly.
 *
 * Handlers: { schema, channels, describe, action(input, ctx) → {actionKind, target, projectId, taskId, surfaceId}|null,
 *   route(input, ctx) → routeDecision|null, execute(input, ctx), async: boolean }
 * Synchronous handlers run inside one transaction together with the command log and its event.
 */
/**
 * Delegated commands that create authority or start work on ONE project. The owner's M07 delegation covers live probes on test
 * projects only (M07 review: an agent could otherwise create a workspace-write grant, a route or a run on a real project and,
 * with policy (b) approved, reach it). Fail-safe commands (pause, stop, interrupt, revoke, Stop All) are never restricted.
 */
export const AGENT_TEST_PROJECT_ONLY = Object.freeze(new Set(["project.environment.set", "grant.create", "factory.prepare", "factory.limits", "factory.start", "factory.resume",
  "approval.decide", "conversation.create", "conversation.message", "run.start"]));

/**
 * Every project an agent's command names, one entry per project-naming field PRESENT in the payload (projectId by id or slug,
 * missionId, conversationId, taskId, approvalId through its scope or target). M07 review round 2: checking only the first field
 * let a forged extra field (projectId of a test project) pass while the handler acted on the real conversation or mission.
 * An unresolvable field yields "" (refused). Returns [{ field, projectId }].
 */
function agentNamedProjects(db, payload = {}) {
  const one = (sql, id) => db.prepare(sql).get(String(id ?? ""))?.project_id || "";
  const missionProject = (id) => one("SELECT project_id FROM missions WHERE id = ?", id);
  const out = [];
  if (payload.projectId !== undefined) out.push({ field: "projectId", projectId: db.prepare("SELECT id FROM projects WHERE id = ? OR slug = ?").get(String(payload.projectId), String(payload.projectId))?.id || "" });
  if (payload.missionId !== undefined) out.push({ field: "missionId", projectId: missionProject(payload.missionId) });
  if (payload.conversationId !== undefined) out.push({ field: "conversationId", projectId: one("SELECT project_id FROM conversations WHERE id = ?", payload.conversationId) });
  if (payload.taskId !== undefined && payload.taskId !== null && payload.taskId !== "") out.push({ field: "taskId", projectId: one("SELECT project_id FROM tasks WHERE id = ?", payload.taskId) });
  if (payload.approvalId !== undefined) {
    const a = db.prepare("SELECT scope_type, scope_id, target FROM approvals WHERE id = ?").get(String(payload.approvalId));
    const projectId = !a ? "" : a.scope_type === "project" ? a.scope_id : a.scope_type === "mission" ? missionProject(a.scope_id) : missionProject(String(a.target || "").split(":")[0]);
    out.push({ field: "approvalId", projectId });
  }
  return out;
}

/** Refuses an agent's authority- or work-creating command unless every project it names is a test project (and it names one). */
export function assertAgentScope(db, type, payload) {
  if (!AGENT_TEST_PROJECT_ONLY.has(type)) return;
  const named = agentNamedProjects(db, payload || {});
  const sourceOf = (id) => (id ? db.prepare("SELECT source FROM projects WHERE id = ?").get(id)?.source : null);
  const bad = named.find((n) => sourceOf(n.projectId) !== "hub-test");
  if (!named.length || bad) throw new HubError("policy", `${type}: delegarea acoperă doar proiectele de test; pe un proiect real (sau fără proiect) decizi tu${bad ? ` (${bad.field})` : ""}`);
}

export function createCommandBus({ db, bus, clock, policy, approvals }) {
  const handlers = new Map();

  const rowTo = (row) => row && ({ id: row.id, type: row.type, actor: row.actor, channel: row.channel, intentText: row.intent_text,
    payload: parse(row.payload_json, {}), status: row.status, policy: parse(row.policy_json, {}), routeDecisionId: row.route_decision_id,
    approvalId: row.approval_id, result: parse(row.result_json, {}), error: row.error, errorCategory: row.error_category ?? null, correlationId: row.correlation_id,
    idempotencyKey: row.idempotency_key, createdAt: row.created_at, finishedAt: row.finished_at });
  const get = (id) => rowTo(db.prepare("SELECT * FROM commands WHERE id = ?").get(id));

  function register(type, handler) {
    if (handlers.has(type)) throw new Error(`Command ${type} already registered`);
    // Approval-gated commands must log the exact payload they will execute (the approval is bound to it).
    if (handler.logPayload && handler.action) throw new Error(`Command ${type}: logPayload cannot be combined with an approval action`);
    handlers.set(type, { channels: ["ui", "test"], schema: {}, async: false, ...handler });
  }

  function trimResult(result) {
    const safe = redactDeep(result ?? null);
    const text = json(safe);
    return text.length > RESULT_LIMIT ? json({ truncated: true, size: text.length }) : text;
  }

  function finish(id, status, { result = null, error = null, errorCategory = null } = {}) {
    db.prepare("UPDATE commands SET status = ?, result_json = ?, error = ?, error_category = ?, finished_at = ? WHERE id = ?")
      .run(status, result === null ? "{}" : trimResult(result), error, error ? errorCategory || "internal" : null, clock().toISOString(), id);
  }

  /** An idempotent replay reports the ORIGINAL outcome (result, pending approval or error), never a fake success. */
  function replay(existing) {
    const command = rowTo(existing);
    if (existing.status === "executed") return { command, result: parse(existing.result_json, {}), duplicate: true };
    if (existing.status === "pending_approval") return { command, approvalRequired: true, approval: approvals.get(existing.approval_id), duplicate: true };
    if (existing.status === "accepted") throw new HubError("conflict", "The same command is still being processed", { data: { commandId: existing.id } });
    const category = existing.status === "rejected" ? "policy" : existing.error_category || "internal";
    throw new HubError(category, existing.error || `Command ${existing.status}`, { data: { commandId: existing.id, duplicate: true, status: existing.status } });
  }

  /** Every event produced while a command runs carries the command's correlation id. */
  async function dispatch(request) {
    const id = newId("cmd");
    const correlationId = request.correlationId || id;
    return bus.withContext({ correlationId }, () => dispatchInner({ ...request, correlationId }, id));
  }

  async function dispatchInner({ type, payload = {}, actor = "user", channel = "ui", intentText = "", idempotencyKey = null, correlationId = null, ownerSession = null, delegation = null }, id) {
    const handler = handlers.get(type);
    if (!handler) throw new HubError("validation", `Unknown command ${type}`);
    if (!COMMAND_CHANNELS.includes(channel)) throw new HubError("validation", `Unknown channel ${channel}`);
    // The owner channel exists only with a session the HTTP layer (or the envelope service) resolved from the database.
    if (channel === "owner" && !ownerSession?.id) throw new HubError("authentication", "The owner channel needs an authenticated owner session");
    if (channel === "agent") {
      if (!AGENT_COMMANDS.has(type)) throw new HubError("policy", `Command ${type} cannot be issued through agent (not delegated)`);
      assertAgentScope(db, type, payload);
      delegation = checkDelegation(delegation);
      actor = "agent";
      intentText = `[delegat] ${delegation}${intentText ? ` · ${intentText}` : ""}`;
    } else if (!handler.channels.includes(channel)) throw new HubError("policy", `Command ${type} cannot be issued through ${channel}`);
    if (idempotencyKey) {
      const existing = db.prepare("SELECT * FROM commands WHERE idempotency_key = ?").get(String(idempotencyKey).slice(0, 120));
      if (existing) {
        if (existing.type !== type) throw new HubError("conflict", "Idempotency key reused for another command");
        return replay(existing);
      }
    }
    const input = validate(payload ?? {}, handler.schema, type);
    const corr = correlationId || id;
    const ctx = { actor, channel, commandId: id, correlationId: corr, ownerSession: channel === "owner" || channel === "test" ? ownerSession : null, delegation: channel === "agent" ? delegation : null };
    const action = handler.action ? handler.action(input, ctx) : null;
    const decision = action ? policy.evaluate(action) : { decision: "allow", policy: "AUTO_ALLOWED", reason: "Comandă internă a Hub-ului, fără efecte în afara lui" };

    bus.transaction(() => {
      db.prepare(`INSERT INTO commands (id, type, actor, channel, intent_text, payload_json, status, policy_json, correlation_id, idempotency_key, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'accepted', ?, ?, ?, ?)`).run(id, type, actor, channel, String(intentText || "").slice(0, 2000), json(redactDeep(handler.logPayload ? handler.logPayload(input) : input)),
        json(decision), corr, idempotencyKey ? String(idempotencyKey).slice(0, 120) : null, clock().toISOString());
      bus.append({ type: "command.accepted", scopeType: "command", scopeId: id, source: actor, correlationId: corr, taskId: action?.taskId || null,
        payload: { type, channel, policy: decision.policy, decision: decision.decision } });
      if (decision.decision === "allow" && decision.scopeId) policy.useTaskScope(decision.scopeId);
    });

    if (decision.decision === "deny") {
      bus.transaction(() => {
        finish(id, "rejected", { error: decision.reason, errorCategory: "policy" });
        bus.append({ type: "command.rejected", scopeType: "command", scopeId: id, source: "policy", correlationId: corr, payload: { type, reason: decision.reason } });
      });
      throw new HubError("policy", decision.reason, { data: { commandId: id, policy: decision } });
    }
    if (decision.decision === "ask") {
      const approval = bus.transaction(() => {
        const created = approvals.request({ actionKind: action.actionKind, target: action.target || type, payload: input, codeVersion: action.codeVersion || "hub",
          permissionTier: decision.tier, scopeType: action.taskId ? "task" : "command", scopeId: action.taskId || id, requestedBy: `${actor}:${channel}`, ttlMinutes: 60 });
        db.prepare("UPDATE commands SET status = 'pending_approval', approval_id = ? WHERE id = ?").run(created.id, id);
        return created;
      });
      return { command: get(id), approvalRequired: true, approval };
    }
    return execute(id, type, handler, input, ctx, decision);
  }

  async function execute(id, type, handler, input, ctx, decision) {
    let route = null;
    try {
      if (handler.route) {
        route = await handler.route(input, ctx);
        if (route?.id) db.prepare("UPDATE commands SET route_decision_id = ? WHERE id = ?").run(route.id, id);
      }
      const runCtx = { ...ctx, route, policy: decision };
      if (handler.async) {
        const result = await handler.execute(input, runCtx);
        bus.transaction(() => {
          finish(id, "executed", { result: handler.logResult ? handler.logResult(result) : result });
          bus.append({ type: "command.executed", scopeType: "command", scopeId: id, source: ctx.actor, correlationId: ctx.correlationId, payload: { type, ...(ctx.delegation ? { delegation: String(ctx.delegation).slice(0, 300) } : {}) } });
        });
        return { command: get(id), result };
      }
      const result = bus.transaction(() => {
        const out = handler.execute(input, runCtx);
        finish(id, "executed", { result: handler.logResult ? handler.logResult(out) : out });
        bus.append({ type: "command.executed", scopeType: "command", scopeId: id, source: ctx.actor, correlationId: ctx.correlationId, payload: { type, ...(ctx.delegation ? { delegation: String(ctx.delegation).slice(0, 300) } : {}) } });
        return out;
      });
      return { command: get(id), result };
    } catch (error) {
      bus.transaction(() => {
        finish(id, "failed", { error: String(error?.message || error).slice(0, 2000), errorCategory: error?.category || "internal" });
        bus.append({ type: "command.failed", scopeType: "command", scopeId: id, source: ctx.actor, correlationId: ctx.correlationId,
          payload: { category: error?.category || "internal", message: String(error?.message || error).slice(0, 500) } });
      });
      throw error;
    }
  }

  /**
   * Executes a command that waited for approval. The payload executed is the one stored in the approval
   * (the exact action you approved), not the redacted copy in the command log; the approval is consumed
   * against it. A missing, rejected, expired or invalidated approval ends the command as failed.
   */
  async function executeApproved(commandId, actor = "user", { delegation = null } = {}) {
    const command = get(commandId);
    if (!command) throw new HubError("not_found", "Command not found");
    return bus.withContext({ correlationId: command.correlationId }, async () => {
      const approval = command.approvalId ? approvals.get(command.approvalId) : null;
      if (command.status !== "pending_approval") {
        if (command.status === "failed" && approval && ["rejected", "invalidated", "expired"].includes(approval.status)) throw new HubError("gate", `Approval is ${approval.status}`);
        throw new HubError("conflict", `Command is ${command.status}`);
      }
      // Still waiting for your decision: nothing changes, the command can run after approval.
      if (approval?.status === "pending") throw new HubError("gate", "Approval is pending");
      const handler = handlers.get(command.type);
      const ctx = { actor, channel: command.channel, commandId, correlationId: command.correlationId, delegation };
      const failCommand = (error) => bus.transaction(() => {
        finish(commandId, "failed", { error: String(error?.message || error).slice(0, 2000), errorCategory: error?.category || "gate" });
        bus.append({ type: "command.failed", scopeType: "command", scopeId: commandId, source: actor, correlationId: command.correlationId,
          payload: { category: error?.category || "gate", message: String(error?.message || error).slice(0, 500), stage: "approval" } });
      });
      if (!approval) { const error = new HubError("gate", "Approval missing"); failCommand(error); throw error; }
      // The executed payload is the approved one; the command log must be exactly its redacted copy.
      const payload = approval.payload;
      if (json(redactDeep(payload)) !== json(command.payload)) {
        const error = new HubError("gate", "Approval does not match the action (the logged command changed after approval)");
        bus.transaction(() => {
          const changed = db.prepare("UPDATE approvals SET status = 'invalidated' WHERE id = ? AND status IN ('pending','approved')").run(approval.id).changes;
          if (changed) bus.append({ type: "approval.invalidated", scopeType: approval.scopeType, scopeId: approval.scopeId, source: "hub", payload: { approvalId: approval.id, reason: "command log changed" } });
        });
        failCommand(error);
        throw error;
      }
      if (delegation || command.channel === "agent") assertAgentScope(db, command.type, payload);
      const action = handler.action(payload, ctx);
      // Another click (second tab, double click) already consumed the approval and is running the command: this start is
      // a conflict, not a failure of the command that is running.
      if (approval.status === "consumed") throw new HubError("conflict", "Command is already starting");
      try {
        approvals.consume(command.approvalId, { actionKind: action.actionKind, target: action.target || command.type, payload,
          codeVersion: action.codeVersion || "hub", permissionTier: approval.permissionTier, scopeType: action.taskId ? "task" : "command", scopeId: action.taskId || commandId });
      } catch (error) {
        failCommand(error);
        throw error;
      }
      if (command.policy?.policy === "ASK_ONCE_FOR_TASK" && action.taskId) {
        bus.transaction(() => policy.grantTaskScope({ taskId: action.taskId, actionKind: action.actionKind, target: action.target || "", surfaceId: action.surfaceId || "*", approvalId: command.approvalId }));
      }
      const input = validate(payload ?? {}, handler.schema, command.type);
      return execute(commandId, command.type, handler, input, ctx, command.policy);
    });
  }

  function list({ limit = 100, type = null, status = null } = {}) {
    const where = []; const args = [];
    if (type) { where.push("type = ?"); args.push(type); }
    if (status) { where.push("status = ?"); args.push(status); }
    return db.prepare(`SELECT * FROM commands ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC LIMIT ?`).all(...args, Math.min(500, limit)).map(rowTo);
  }

  const catalog = () => [...handlers.entries()].map(([type, h]) => ({ type, describe: h.describe || "", channels: h.channels, schema: h.schema, async: h.async }));

  return { register, dispatch, executeApproved, get, list, catalog, has: (type) => handlers.has(type) };
}
