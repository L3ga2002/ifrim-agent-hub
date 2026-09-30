import path from "node:path";
import { HubError, PRE_INFERENCE_CATEGORIES } from "../core/errors.mjs";
import { newId } from "../core/ids.mjs";
import { json, parse } from "../storage/db.mjs";
import { transitionTask } from "./state-machine.mjs";
import { buildTurnPrompt } from "./prompt.mjs";
import { gitState } from "../tools/git.mjs";
import { redactText } from "../security/redact.mjs";

const PERSIST_INTERVAL_MS = 700;
const APPROVAL_WAIT_MINUTES = 15;

export const workspaceResource = (workspacePath) => `workspace:${path.resolve(workspacePath).toLowerCase()}`;

/** Execution surface of the Hub-driven provider routes (the only PROGRAMMATIC model surfaces in this build). */
export const SURFACE_BY_PROVIDER = Object.freeze({ codex: "openai.codex_app_server", claude: "anthropic.claude_code_headless" });

/**
 * Executes provider turns for the canonical conversation. Sequence:
 * gate → lease (single writer) → grant attempt → verified backup → run record → provider turn →
 * persisted result. A finished model turn moves its task to VERIFYING, never to COMPLETED.
 */
export function createRunManager(deps) {
  const { db, bus, clock, settings, projects, conversations, missions, gate, leases, grants, backups, approvals, providers, breakers, usage, live } = deps;
  const surfaceOf = (provider) => SURFACE_BY_PROVIDER[provider] || null;
  const active = new Map(); // runId -> { handle, conversationId, provider, leaseId, taskId }
  const approvalWaiters = new Map(); // approvalId -> resolve
  const starting = new Set(); // conversationId currently being admitted

  const rowToRun = (row) => row && ({ id: row.id, taskId: row.task_id, conversationId: row.conversation_id, roleId: row.role_id, stage: row.stage,
    provider: row.provider, model: row.model, effort: row.effort, access: row.access, status: row.status, providerSessionId: row.provider_session_id,
    nativeThreadId: row.native_thread_id, nativeTurnId: row.native_turn_id, pid: row.pid, inputMessageId: row.input_message_id, outputMessageId: row.output_message_id,
    codeVersion: row.code_version, backupId: row.backup_id, approvalId: row.approval_id, grantId: row.grant_id, errorCategory: row.error_category,
    errorMessage: row.error_message, preInference: Boolean(row.pre_inference), usage: parse(row.usage_json, {}), evidence: parse(row.evidence_json, {}),
    lastEventAt: row.last_event_at, startedAt: row.started_at, finishedAt: row.finished_at, createdAt: row.created_at, legacyId: row.legacy_id });

  const getRun = (id) => rowToRun(db.prepare("SELECT * FROM agent_runs WHERE id = ?").get(id));
  const listRuns = ({ conversationId = null, taskId = null, status = null, limit = 100 } = {}) => {
    const where = []; const args = [];
    if (conversationId) { where.push("conversation_id = ?"); args.push(conversationId); }
    if (taskId) { where.push("task_id = ?"); args.push(taskId); }
    if (status) { where.push("status = ?"); args.push(status); }
    return db.prepare(`SELECT * FROM agent_runs ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC LIMIT ?`).all(...args, limit).map(rowToRun);
  };

  function recordBlockedRun({ conversation, provider, access, taskId, stage, roleId, inputMessageId, category, message, evidence }) {
    const id = newId("run");
    const now = clock().toISOString();
    bus.transaction(() => {
      db.prepare(`INSERT INTO agent_runs (id, task_id, conversation_id, role_id, stage, provider, access, status, input_message_id, error_category, error_message, pre_inference, evidence_json, created_at, finished_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'blocked', ?, ?, ?, 1, ?, ?, ?)`).run(id, taskId, conversation.id, roleId || "", stage || "assist", provider, access, inputMessageId, category, message, json(evidence), now, now);
      bus.append({ type: "run.blocked", scopeType: "conversation", scopeId: conversation.id, projectId: conversation.projectId, source: "hub", runId: id,
        payload: { provider, category, message, preInference: true } });
    });
    return getRun(id);
  }

  async function start({ conversationId, provider, access = "read-only", model = "", effort = "", taskId = null, stage = "assist", roleId = "", grantId = null, actor = "user", correlationId = null }) {
    const adapter = providers[provider];
    if (!adapter) throw new HubError("validation", `Unknown provider ${provider}`);
    const conversation = conversations.get(conversationId);
    if (!conversation) throw new HubError("not_found", "Conversation not found");
    const project = projects.get(conversation.projectId);
    const openHandoff = db.prepare("SELECT id, to_provider, status, step FROM handoffs WHERE conversation_id = ? AND status IN ('in_progress','waiting','ready') ORDER BY created_at DESC LIMIT 1").get(conversationId);
    if (openHandoff && openHandoff.to_provider !== provider) {
      throw new HubError("task", `A handoff to ${openHandoff.to_provider} is in progress for this conversation`);
    }
    if (openHandoff && openHandoff.status !== "ready") {
      throw new HubError("task", `Handoff ${openHandoff.id} is at step ${openHandoff.step}; finish it before starting ${provider}`);
    }
    const lastUser = db.prepare("SELECT * FROM messages WHERE conversation_id = ? AND role = 'user' ORDER BY position DESC LIMIT 1").get(conversationId);
    if (!lastUser) throw new HubError("validation", "Send a message before starting a run");
    const duplicate = db.prepare("SELECT * FROM agent_runs WHERE conversation_id = ? AND input_message_id = ? AND provider = ? AND status IN ('starting','running','waiting_approval')").get(conversationId, lastUser.id, provider);
    if (duplicate) return { run: rowToRun(duplicate), duplicate: true };
    if (starting.has(conversationId) || [...active.values()].some((a) => a.conversationId === conversationId)) {
      throw new HubError("conflict", "This conversation already has a run starting or running");
    }
    const resource = workspaceResource(project.path);
    const decision = gate.evaluate({ provider, projectId: project.id, access, grantId, workspaceResource: resource });
    if (!decision.allowed) {
      const failed = decision.checks.filter((c) => !c.ok);
      const run = recordBlockedRun({ conversation, provider, access, taskId, stage, roleId, inputMessageId: lastUser.id, category: "gate",
        message: failed.map((c) => `${c.id}: ${c.detail}`).join(" · "), evidence: { gate: decision } });
      throw new HubError("gate", "Execution gate refused the run", { data: { runId: run.id, checks: decision.checks } });
    }

    starting.add(conversationId);
    let lease = null;
    const runId = newId("run");
    try {
      lease = bus.transaction(() => leases.acquire({ resource, holder: `${provider}:${runId}`, taskId, runId: null, ttlSeconds: 1800 }));
      const grantCheck = decision.checks.find((c) => c.id === "live_grant");
      const grant = grantCheck?.grantId ? bus.transaction(() => grants.consumeAttempt(grantCheck.grantId)) : null;

      let backup = backups.freshVerified(project.id);
      if (!backup.ok) {
        const created = await backups.run(project.id, `pre-run ${runId}`, "hub");
        if (created?.status !== "verified") {
          bus.transaction(() => leases.release(lease.id, "backup gate failed"));
          const run = recordBlockedRun({ conversation, provider, access, taskId, stage, roleId, inputMessageId: lastUser.id, category: "gate",
            message: `Backup gate: ${created?.status || "failed"} ${created?.error || ""}`.trim(), evidence: { backupId: created?.id } });
          throw new HubError("gate", "Backup gate failed; the model was not started", { data: { runId: run.id, backupId: created?.id } });
        }
        backup = { ok: true, backup: created };
      }

      const git = await gitState(project.path);
      const now = clock().toISOString();
      const sessionId = conversations.latestSession(conversationId, provider);
      let outputMessage;
      const taskRow = taskId ? db.prepare("SELECT department_id, route_decision_id FROM tasks WHERE id = ?").get(taskId) : null;
      const skillVersions = roleId && deps.skills ? deps.skills.forRole(roleId) : [];
      bus.transaction(() => {
        db.prepare(`INSERT INTO agent_runs (id, task_id, conversation_id, role_id, stage, provider, model, effort, access, status, provider_session_id, input_message_id,
          code_version, backup_id, grant_id, last_event_at, started_at, created_at, surface_id, department_id, route_decision_id, correlation_id, skill_versions_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(runId, taskId, conversationId, roleId, stage, provider, model, effort, access, sessionId || null, lastUser.id, git.head || "", backup.backup.id, grant?.id || null, now, now, now,
            surfaceOf(provider), taskRow?.department_id || null, taskRow?.route_decision_id || null, correlationId || runId, json(skillVersions));
        leases.attachRun(lease.id, runId);
        outputMessage = conversations.addMessage({ conversationId, role: "assistant", content: "", provider, model, runId, status: "streaming", metadata: { access } }, "hub");
        db.prepare("UPDATE agent_runs SET output_message_id = ? WHERE id = ?").run(outputMessage.id, runId);
        conversations.update(conversationId, { status: "running", writerProvider: provider }, "hub");
        if (taskId) transitionTask(db, bus, clock, { taskId, to: "RUNNING", reason: `Run ${runId} started on ${provider}`, actor });
        bus.append({ type: "run.started", scopeType: "conversation", scopeId: conversationId, projectId: project.id, source: actor, runId,
          payload: { provider, model, effort, access, backupId: backup.backup.id, grantId: grant?.id || null, codeVersion: git.head } });
      });

      const prompt = buildTurnPrompt({ db, conversations, conversation, project, git, provider, runId });
      let content = "";
      let lastPersist = 0;
      const handle = adapter.startTurn({
        runId, cwd: project.path, prompt: prompt.text, access, model, effort,
        threadId: provider === "codex" ? sessionId : undefined, sessionId: provider === "claude" ? sessionId : undefined,
        trustedWorkspace: project.trustedConfig,
        admitUsage: (snapshot) => usage.admit(provider, snapshot),
        requestApproval: (request) => waitForApproval({ runId, conversation, project, provider, request, taskId }),
        onEvent: (event) => onProviderEvent(runId, conversationId, event, (text) => {
          content += text;
          if (Date.now() - lastPersist > PERSIST_INTERVAL_MS) { conversations.updateStreaming(outputMessage.id, content); lastPersist = Date.now(); }
        }),
      });
      active.set(runId, { handle, conversationId, provider, leaseId: lease.id, taskId, outputMessageId: outputMessage.id, promptPackage: prompt.packageRef });
      db.prepare("UPDATE agent_runs SET pid = ?, pid_started_at = ? WHERE id = ?").run(handle.pid || null, clock().toISOString(), runId);
      handle.done.then((result) => finalize(runId, result, () => content)).catch((error) => finalize(runId, { status: "failed", errorCategory: "internal", error: error.message, output: content }, () => content));
      return { run: getRun(runId), gate: decision };
    } catch (error) {
      if (lease && !active.has(runId)) {
        const held = db.prepare("SELECT status FROM leases WHERE id = ?").get(lease.id);
        if (held?.status === "active") bus.transaction(() => leases.release(lease.id, `start aborted: ${error.message}`));
      }
      throw error;
    } finally {
      starting.delete(conversationId);
    }
  }

  function onProviderEvent(runId, conversationId, event, appendText) {
    const now = clock().toISOString();
    db.prepare("UPDATE agent_runs SET last_event_at = ? WHERE id = ?").run(now, runId);
    if (event.type === "delta") {
      appendText(event.text);
      live.publish({ type: "run.delta", conversationId, runId, text: event.text });
      return;
    }
    if (event.type === "session") {
      db.prepare("UPDATE agent_runs SET native_thread_id = ?, provider_session_id = COALESCE(provider_session_id, ?) WHERE id = ?").run(event.nativeSessionId || null, event.nativeSessionId || null, runId);
      if (event.model) db.prepare("UPDATE agent_runs SET model = CASE WHEN model = '' THEN ? ELSE model END WHERE id = ?").run(String(event.model), runId);
    }
    if (event.type === "turn") db.prepare("UPDATE agent_runs SET native_turn_id = ? WHERE id = ?").run(event.turnId || null, runId);
    if (event.type === "usage") {
      db.prepare("UPDATE agent_runs SET usage_json = ? WHERE id = ?").run(json(event.usage), runId);
      if (event.usage?.rateLimits) usage.record(getRun(runId).provider, event.usage.rateLimits);
    }
    const persisted = ["session", "turn", "activity", "notice", "plan", "auth"].includes(event.type);
    if (persisted) {
      bus.emit({ type: `run.${event.type}`, scopeType: "conversation", scopeId: conversationId, source: "provider", runId,
        payload: event.type === "activity" ? { label: redactText(event.label) } : event.type === "notice" ? { level: event.level, text: redactText(event.text) } : event });
    } else {
      live.publish({ type: `run.${event.type}`, conversationId, runId, data: event.type === "diff" ? { length: event.diff.length } : event });
    }
  }

  async function waitForApproval({ runId, conversation, project, provider, request, taskId }) {
    const payload = request.kind === "command" ? { command: request.command, cwd: request.cwd, reason: request.reason } : { changes: request.changes, reason: request.reason };
    const actionKind = `provider.${request.kind}`;
    // Hub approval policy first; a provider/vendor approval prompt never replaces it.
    const policyDecision = deps.policy ? deps.policy.evaluate({ actionKind, surfaceId: surfaceOf(provider) || "*", projectId: project.id, taskId, target: project.path }) : { decision: "ask" };
    if (policyDecision.decision === "deny" || policyDecision.decision === "allow") {
      bus.transaction(() => {
        if (policyDecision.scopeId) deps.policy.useTaskScope(policyDecision.scopeId);
        bus.append({ type: policyDecision.decision === "allow" ? "approval.policy_allowed" : "approval.policy_denied", scopeType: "run", scopeId: runId, source: "policy", runId,
          payload: { actionKind, policy: policyDecision.policy, reason: policyDecision.reason, scopeId: policyDecision.scopeId || null } });
      });
      return policyDecision.decision === "allow" ? "accept" : "decline";
    }
    const approval = bus.transaction(() => {
      const created = approvals.request({ actionKind: `provider.${request.kind}`, target: project.path, payload, codeVersion: getRun(runId).codeVersion,
        permissionTier: request.kind === "command" ? "DEVELOPMENT_TOOLS" : "WORKSPACE_EDIT", scopeType: "run", scopeId: runId,
        requestedBy: `${provider}:${runId}`, ttlMinutes: APPROVAL_WAIT_MINUTES });
      db.prepare("UPDATE agent_runs SET status = 'waiting_approval' WHERE id = ?").run(runId);
      if (taskId) transitionTask(db, bus, clock, { taskId, to: "WAITING_APPROVAL", reason: `${provider} requested ${request.kind} approval`, actor: "hub" });
      return created;
    });
    const decision = await new Promise((resolve) => {
      approvalWaiters.set(approval.id, resolve);
      setTimeout(() => { if (approvalWaiters.delete(approval.id)) resolve("decline"); }, APPROVAL_WAIT_MINUTES * 60000).unref?.();
    });
    bus.transaction(() => {
      db.prepare("UPDATE agent_runs SET status = 'running' WHERE id = ? AND status = 'waiting_approval'").run(runId);
      if (taskId) transitionTask(db, bus, clock, { taskId, to: "RUNNING", reason: `Approval ${approval.id}: ${decision}`, actor: "user" });
    });
    return decision;
  }

  /** Called after the user decides an approval in the UI. Consumes the approval against the exact action. */
  function resolveApproval(approvalId, decision) {
    const resolve = approvalWaiters.get(approvalId);
    if (!resolve) return false;
    approvalWaiters.delete(approvalId);
    if (decision === "approved") {
      const approval = approvals.get(approvalId);
      try {
        approvals.consume(approvalId, { actionKind: approval.actionKind, target: approval.target, payload: approval.payload,
          codeVersion: approval.codeVersion, permissionTier: approval.permissionTier, scopeType: approval.scopeType, scopeId: approval.scopeId });
        const run = approval.scopeType === "run" ? getRun(approval.scopeId) : null;
        if (run?.taskId && deps.policy) {
          const policyNow = deps.policy.evaluate({ actionKind: approval.actionKind, surfaceId: surfaceOf(run.provider) || "*", projectId: projects.get(conversations.get(run.conversationId)?.projectId)?.id || "*", taskId: run.taskId, target: approval.target });
          if (policyNow.policy === "ASK_ONCE_FOR_TASK") {
            bus.transaction(() => deps.policy.grantTaskScope({ taskId: run.taskId, actionKind: approval.actionKind, target: approval.target, surfaceId: surfaceOf(run.provider) || "*", approvalId }));
          }
        }
        resolve("accept");
      } catch { resolve("decline"); }
    } else resolve("decline");
    return true;
  }

  function finalize(runId, result, getContent) {
    const entry = active.get(runId);
    active.delete(runId);
    const run = getRun(runId);
    if (!run || !["running", "waiting_approval", "starting"].includes(run.status)) return;
    const content = result.output || getContent() || "";
    const pre = Boolean(result.preInference) || PRE_INFERENCE_CATEGORIES.has(result.errorCategory);
    const status = result.status === "completed" ? "completed" : result.status === "interrupted" ? "interrupted" : pre ? "blocked" : "failed";
    const record = entry ? deps.supervisorRecord?.(entry.handle.key) : null;
    const processGone = !record || record.exited;
    bus.transaction(() => {
      db.prepare(`UPDATE agent_runs SET status = ?, error_category = ?, error_message = ?, pre_inference = ?, finished_at = ?, native_thread_id = COALESCE(native_thread_id, ?),
        native_turn_id = COALESCE(native_turn_id, ?), usage_json = ?, evidence_json = ? WHERE id = ?`)
        .run(status, result.errorCategory || null, result.error ? redactText(String(result.error)).slice(0, 2000) : null, pre ? 1 : 0, clock().toISOString(),
          result.threadId || result.sessionId || null, result.turnId || null, json(result.usage || run.usage), json({ ...run.evidence, permissionDenials: result.permissionDenials, numTurns: result.numTurns, promptPackage: entry?.promptPackage }), runId);
      if (entry?.outputMessageId) {
        conversations.finalize(entry.outputMessageId, { content: content || (result.error ? `Run ${status}: ${redactText(String(result.error))}` : ""), status: status === "completed" ? "final" : status,
          metadata: { runStatus: status, errorCategory: result.errorCategory || null, preInference: pre } });
      }
      const nativeId = result.threadId || result.sessionId;
      if (nativeId && (status === "completed" || status === "interrupted")) conversations.upsertProviderSession(run.conversationId, run.provider, nativeId, runId, surfaceOf(run.provider));
      if (entry?.leaseId) {
        if (processGone) leases.release(entry.leaseId, `run ${status}`);
        else leases.retain(entry.leaseId, "provider process did not confirm exit");
      }
      conversations.update(run.conversationId, { status: status === "completed" ? "idle" : "attention" }, "hub");
      if (run.taskId) {
        const target = status === "completed" ? "VERIFYING" : status === "interrupted" ? (result.error?.includes("quota") ? "WAITING_PROVIDER" : "PAUSED")
          : result.errorCategory === "quota" ? "WAITING_PROVIDER" : pre ? "BLOCKED" : "BLOCKED";
        const reason = status === "completed" ? "Model turn finished; verification required before completion" : `${status}: ${result.errorCategory || ""} ${result.error || ""}`.trim();
        try { transitionTask(db, bus, clock, { taskId: run.taskId, to: target, reason: reason.slice(0, 500), actor: "hub" }); } catch { /* task may have been cancelled meanwhile */ }
        db.prepare("UPDATE tasks SET attempts = attempts + 1, last_activity_at = ? WHERE id = ?").run(clock().toISOString(), run.taskId);
        missions.refreshMissionStatus(missions.task(run.taskId)?.missionId);
      }
      bus.append({ type: status === "completed" ? "run.completed" : status === "interrupted" ? "run.interrupted" : "run.failed", scopeType: "conversation",
        scopeId: run.conversationId, source: "hub", runId, payload: { provider: run.provider, status, errorCategory: result.errorCategory || null, preInference: pre } });
    });
    breakers.record(run.provider, status === "completed" ? null : result.errorCategory || null);
  }

  async function interrupt(runId, reason = "user") {
    const entry = active.get(runId);
    if (!entry) throw new HubError("conflict", "Run is not active in this Hub process");
    return entry.handle.interrupt(reason);
  }

  /** Stop All: no new work (gate suspended, grants revoked), interrupt every controllable run. */
  async function stopAll(actor = "user", reason = "Stop All") {
    bus.transaction(() => {
      settings.set("executionGate", { status: "suspended", reason, changedAt: clock().toISOString(), changedBy: actor }, actor, reason);
      grants.revokeAll(actor, reason);
      deps.policy?.revokeTaskScopes(null, reason, actor);
    });
    const interrupted = [];
    for (const [runId, entry] of [...active.entries()]) {
      const result = await entry.handle.interrupt("stop-all").catch((error) => ({ interrupted: false, error: error.message }));
      interrupted.push({ runId, provider: entry.provider, ...result });
    }
    for (const [approvalId, resolve] of approvalWaiters) { approvalWaiters.delete(approvalId); resolve("decline"); }
    bus.emit({ type: "system.stop_all", scopeType: "system", scopeId: "hub", source: actor, payload: { reason, interrupted: interrupted.length } });
    return { gate: "suspended", interrupted, cloudTasksUnconfirmed: [], irreversibleEffects: [],
      note: "No cloud tasks or external effects are started by this Hub build; only local provider processes were interrupted." };
  }

  const activeRuns = () => [...active.entries()].map(([runId, entry]) => ({ runId, provider: entry.provider, conversationId: entry.conversationId, pid: entry.handle.pid }));
  return { start, interrupt, stopAll, resolveApproval, getRun, listRuns, activeRuns, activeCount: () => active.size + starting.size, rowToRun };
}
