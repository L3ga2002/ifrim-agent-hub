import path from "node:path";
import { HubError, PRE_INFERENCE_CATEGORIES } from "../core/errors.mjs";
import { newId } from "../core/ids.mjs";
import { json, parse } from "../storage/db.mjs";
import { transitionTask } from "./state-machine.mjs";
import { buildTurnPrompt } from "./prompt.mjs";
import { gitState } from "../tools/git.mjs";
import { redactText } from "../security/redact.mjs";
import { resolveRunPlan, planRecord, DEFAULT_PROFILE } from "../policy/run-plan.mjs";
import { createTimeline, summarizeTimeline } from "./timeline.mjs";

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
  const { db, bus, clock, settings, projects, conversations, missions, gate, leases, grants, backups, approvals, providers, breakers, usage, live, providerState = null } = deps;
  const surfaceOf = (provider) => SURFACE_BY_PROVIDER[provider] || null;
  const active = new Map(); // runId -> { handle, conversationId, provider, leaseId, taskId }
  const approvalWaiters = new Map(); // approvalId -> resolve
  const starting = new Set(); // conversationId currently being admitted
  let voice = null; // Lega session manager (late-bound): Stop All must end the voice session too
  let factory = null; // Software Factory (late-bound): Stop All stops its missions before the next stage can start

  const rowToRun = (row) => row && ({ id: row.id, taskId: row.task_id, conversationId: row.conversation_id, roleId: row.role_id, stage: row.stage,
    provider: row.provider, model: row.model, effort: row.effort, access: row.access, status: row.status, providerSessionId: row.provider_session_id,
    nativeThreadId: row.native_thread_id, nativeTurnId: row.native_turn_id, pid: row.pid, inputMessageId: row.input_message_id, outputMessageId: row.output_message_id,
    codeVersion: row.code_version, backupId: row.backup_id, approvalId: row.approval_id, grantId: row.grant_id, errorCategory: row.error_category,
    errorMessage: row.error_message, preInference: Boolean(row.pre_inference), usage: parse(row.usage_json, {}), evidence: parse(row.evidence_json, {}),
    lastEventAt: row.last_event_at, startedAt: row.started_at, finishedAt: row.finished_at, createdAt: row.created_at, legacyId: row.legacy_id,
    timeline: parse(row.timeline_json, {}), plan: parse(row.plan_json, {}) });

  const getRun = (id) => rowToRun(db.prepare("SELECT * FROM agent_runs WHERE id = ?").get(id));
  const listRuns = ({ conversationId = null, taskId = null, status = null, limit = 100 } = {}) => {
    const where = []; const args = [];
    if (conversationId) { where.push("conversation_id = ?"); args.push(conversationId); }
    if (taskId) { where.push("task_id = ?"); args.push(taskId); }
    if (status) { where.push("status = ?"); args.push(status); }
    return db.prepare(`SELECT * FROM agent_runs ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC LIMIT ?`).all(...args, limit).map(rowToRun);
  };

  function recordBlockedRun({ conversation, provider, access, taskId, stage, roleId, inputMessageId, category, message, evidence, timeline = null, plan = null }) {
    const id = newId("run");
    const now = clock().toISOString();
    bus.transaction(() => {
      db.prepare(`INSERT INTO agent_runs (id, task_id, conversation_id, role_id, stage, provider, model, effort, access, status, input_message_id, error_category, error_message, pre_inference, evidence_json,
        timeline_json, plan_json, created_at, finished_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'blocked', ?, ?, ?, 1, ?, ?, ?, ?, ?)`).run(id, taskId, conversation.id, roleId || "", stage || "assist", provider, plan?.model || "", plan?.effort || "", access,
        inputMessageId, category, message, json(evidence), json(timeline ? timeline.toJSON() : {}), json(plan ? planRecord(plan) : {}), now, now);
      bus.append({ type: "run.blocked", scopeType: "conversation", scopeId: conversation.id, projectId: conversation.projectId, source: "hub", runId: id,
        payload: { provider, category, message, preInference: true } });
    });
    return getRun(id);
  }

  /**
   * `profile` picks the Hub effort profile when no explicit effort is given (M03 §09); `requestedAt` / `approval` let the
   * timeline start at the owner's request instead of at admission (M03 §08). Both are optional for older callers.
   */
  async function start({ conversationId, provider, access = "read-only", model = "", effort = "", profile = DEFAULT_PROFILE, taskId = null, stage = "assist", roleId = "", grantId = null,
    actor = "user", correlationId = null, requestedAt = null, approval = null }) {
    const adapter = providers[provider];
    if (!adapter) throw new HubError("validation", `Unknown provider ${provider}`);
    const conversation = conversations.get(conversationId);
    if (!conversation) throw new HubError("not_found", "Conversation not found");
    const project = projects.get(conversation.projectId);
    const timeline = createTimeline(clock);
    if (requestedAt) timeline.mark("requested", requestedAt);
    if (approval?.createdAt) timeline.mark("approval_requested", approval.createdAt);
    if (approval?.decidedAt) timeline.mark("approval_decided", approval.decidedAt);
    timeline.mark("dispatch");
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
    // Model and effort are decided here, explicitly, before the gate: nothing is left to the provider's config defaults.
    // The gate reports it as one of its checks (run_plan), so every reason a run cannot start is shown together.
    const plan = resolveRunPlan({ provider, model, effort, profile: profile || DEFAULT_PROFILE, providerState: providerState?.get(provider) || null });
    if (!plan.problem) timeline.mark("plan_resolved");
    const resource = workspaceResource(project.path);
    const decision = gate.evaluate({ provider, projectId: project.id, access, grantId, workspaceResource: resource, plan });
    timeline.mark("gate_checked");
    if (!decision.allowed) {
      const failed = decision.checks.filter((c) => !c.ok);
      const run = recordBlockedRun({ conversation, provider, access, taskId, stage, roleId, inputMessageId: lastUser.id, category: "gate",
        message: failed.map((c) => `${c.id}: ${c.detail}`).join(" · "), evidence: { gate: decision }, timeline, plan });
      throw new HubError("gate", "Execution gate refused the run", { data: { runId: run.id, checks: decision.checks } });
    }

    starting.add(conversationId);
    let lease = null;
    let grant = null;
    const runId = newId("run");
    try {
      lease = bus.transaction(() => leases.acquire({ resource, holder: `${provider}:${runId}`, taskId, runId: null, ttlSeconds: 1800 }));
      timeline.mark("lease_acquired");
      const grantCheck = decision.checks.find((c) => c.id === "live_grant");
      grant = grantCheck?.grantId ? bus.transaction(() => grants.consumeAttempt(grantCheck.grantId)) : null;
      if (grant) timeline.mark("grant_consumed");

      let backup = backups.freshVerified(project.id);
      if (!backup.ok) {
        const created = await backups.run(project.id, `pre-run ${runId}`, "hub");
        if (created?.status !== "verified") {
          bus.transaction(() => leases.release(lease.id, "backup gate failed"));
          // Nothing reached a provider: the attempt taken above goes back (bounded, see refundPreInference).
          if (grant) refundPreInference(grant.id, `backup gate failed before ${runId} started`);
          const run = recordBlockedRun({ conversation, provider, access, taskId, stage, roleId, inputMessageId: lastUser.id, category: "gate",
            message: `Backup gate: ${created?.status || "failed"} ${created?.error || ""}`.trim(), evidence: { backupId: created?.id }, timeline, plan });
          throw new HubError("gate", "Backup gate failed; the model was not started", { data: { runId: run.id, backupId: created?.id } });
        }
        backup = { ok: true, backup: created, created: true };
      }
      timeline.mark("backup_ready");

      const git = await gitState(project.path);
      timeline.mark("git_state");
      const now = clock().toISOString();
      const sessionId = conversations.latestSession(conversationId, provider);
      let outputMessage;
      const taskRow = taskId ? db.prepare("SELECT department_id, route_decision_id FROM tasks WHERE id = ?").get(taskId) : null;
      const skillVersions = roleId && deps.skills ? deps.skills.forRole(roleId) : [];
      timeline.mark("run_recorded");
      bus.transaction(() => {
        db.prepare(`INSERT INTO agent_runs (id, task_id, conversation_id, role_id, stage, provider, model, effort, access, status, provider_session_id, input_message_id,
          code_version, backup_id, grant_id, last_event_at, started_at, created_at, surface_id, department_id, route_decision_id, correlation_id, skill_versions_json, timeline_json, plan_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(runId, taskId, conversationId, roleId, stage, provider, plan.model, plan.effort, access, sessionId || null, lastUser.id, git.head || "", backup.backup.id, grant?.id || null, now, now, now,
            surfaceOf(provider), taskRow?.department_id || null, taskRow?.route_decision_id || null, correlationId || runId, json(skillVersions), json(timeline.toJSON()), json(planRecord(plan)));
        leases.attachRun(lease.id, runId);
        outputMessage = conversations.addMessage({ conversationId, role: "assistant", content: "", provider, model: plan.model, runId, status: "streaming", metadata: { access } }, "hub");
        db.prepare("UPDATE agent_runs SET output_message_id = ? WHERE id = ?").run(outputMessage.id, runId);
        conversations.update(conversationId, { status: "running", writerProvider: provider }, "hub");
        if (taskId) transitionTask(db, bus, clock, { taskId, to: "RUNNING", reason: `Run ${runId} started on ${provider}`, actor });
        bus.append({ type: "run.started", scopeType: "conversation", scopeId: conversationId, projectId: project.id, source: actor, runId,
          payload: { provider, model: plan.model, effort: plan.effort, effortSource: plan.effortSource, profile: plan.profile, access, backupId: backup.backup.id, backupCreated: Boolean(backup.created),
            grantId: grant?.id || null, codeVersion: git.head } });
      });

      const prompt = buildTurnPrompt({ db, conversations, conversation, project, git, provider, runId });
      let content = "";
      let lastPersist = 0;
      const handle = adapter.startTurn({
        runId, cwd: project.path, prompt: prompt.text, access, model: plan.model, effort: plan.effort,
        threadId: provider === "codex" ? sessionId : undefined, sessionId: provider === "claude" ? sessionId : undefined,
        trustedWorkspace: project.trustedConfig,
        admitUsage: (snapshot) => usage.admit(provider, snapshot),
        requestApproval: (request) => waitForApproval({ runId, conversation, project, provider, request, taskId }),
        onEvent: (event) => onProviderEvent(runId, conversationId, event, (text) => {
          content += text;
          if (Date.now() - lastPersist > PERSIST_INTERVAL_MS) { conversations.updateStreaming(outputMessage.id, content); lastPersist = Date.now(); }
        }),
      });
      active.set(runId, { handle, conversationId, provider, leaseId: lease.id, taskId, outputMessageId: outputMessage.id, promptPackage: prompt.packageRef, startedAt: clock().toISOString(), lastEventAt: null, firstOutputAt: null, timeline });
      if (handle.pid) markPhase(runId, "process_spawned");
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

  /** Records one timeline phase of an active run (first observation only) and persists the timeline. */
  function markPhase(runId, phase, at = null) {
    const entry = active.get(runId);
    if (!entry?.timeline) return;
    if (entry.timeline.mark(phase, at)) db.prepare("UPDATE agent_runs SET timeline_json = ? WHERE id = ?").run(json(entry.timeline.toJSON()), runId);
  }

  /**
   * Gives a grant attempt back after a start that provably never reached the model (no turn was sent). Bounded: at most
   * `maxAttempts` refunds per grant, so a start that keeps failing before inference cannot loop on one grant forever.
   * This is the Hub's own attempt counter, not a refund of provider usage.
   */
  function refundPreInference(grantId, reason) {
    const current = grants.get(grantId);
    if (!current) return null;
    const refunds = db.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'grant.refunded' AND scope_id = ?").get(grantId).n;
    if (refunds >= current.maxAttempts) {
      bus.emit({ type: "grant.refund_refused", scopeType: "grant", scopeId: grantId, source: "hub", payload: { reason: "refund cap reached", refunds } });
      return current;
    }
    return bus.transaction(() => grants.refundAttempt(grantId, "hub", reason));
  }

  function onProviderEvent(runId, conversationId, event, appendText) {
    const now = clock().toISOString();
    db.prepare("UPDATE agent_runs SET last_event_at = ? WHERE id = ?").run(now, runId);
    // Observable phase only (no progress is inferred): waiting for the provider until the first output arrives.
    const entry = active.get(runId);
    if (entry) { entry.lastEventAt = now; if (event.type === "delta" && !entry.firstOutputAt) entry.firstOutputAt = now; }
    if (event.type === "phase") { markPhase(runId, event.phase, event.at || null); return; }
    if (entry?.timeline?.has("turn_acknowledged") && event.type !== "usage") markPhase(runId, "first_event");
    if (event.type === "delta") {
      markPhase(runId, "first_output");
      appendText(event.text);
      live.publish({ type: "run.delta", conversationId, runId, text: event.text });
      return;
    }
    if (event.type === "session") {
      db.prepare("UPDATE agent_runs SET native_thread_id = ?, provider_session_id = COALESCE(provider_session_id, ?) WHERE id = ?").run(event.nativeSessionId || null, event.nativeSessionId || null, runId);
      if (event.model) db.prepare("UPDATE agent_runs SET model = CASE WHEN model = '' THEN ? ELSE model END WHERE id = ?").run(String(event.model), runId);
      // What the provider reported for this thread, next to what the Hub sent (the adapter stops the run on a mismatch).
      const plan = parse(db.prepare("SELECT plan_json FROM agent_runs WHERE id = ?").get(runId)?.plan_json, {});
      db.prepare("UPDATE agent_runs SET plan_json = ? WHERE id = ?").run(json({ ...plan, reported: { model: event.model ? String(event.model).slice(0, 80) : null,
        effort: event.reasoningEffort ? String(event.reasoningEffort).slice(0, 20) : null, source: entry?.provider === "codex" ? "thread/start" : "init" } }), runId);
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
    if (entry?.timeline) entry.timeline.mark("finished");
    const turnSent = Boolean(entry?.timeline?.has("turn_sent"));
    bus.transaction(() => {
      if (entry?.timeline) db.prepare("UPDATE agent_runs SET timeline_json = ? WHERE id = ?").run(json(entry.timeline.toJSON()), runId);
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
    // A start that stopped before any turn reached the model (policy/MCP/model/effort checks, auth, quota) gives its grant
    // attempt back; the evidence is the timeline (no turn_sent) plus the pre-inference flag. An uncertain outcome never does.
    if (run.grantId && pre && !turnSent && status !== "completed") refundPreInference(run.grantId, `${runId} stopped before inference (${result.errorCategory || status})`);
  }

  async function interrupt(runId, reason = "user") {
    const entry = active.get(runId);
    if (!entry) throw new HubError("conflict", "Run is not active in this Hub process");
    return entry.handle.interrupt(reason);
  }

  /** Stop All: no new work (gate suspended, grants revoked), interrupt every controllable run. */
  async function stopAll(actor = "user", reason = "Stop All") {
    // The voice session ends first (the browser is told to close its microphone at once), in parallel with the run
    // interrupts; starting it before the grant revocation keeps "stop-all" as its recorded reason.
    const voicePromise = voice ? voice.stopAll("stop-all").catch((error) => ({ error: error.message })) : null;
    bus.transaction(() => {
      settings.set("executionGate", { status: "suspended", reason, changedAt: clock().toISOString(), changedBy: actor }, actor, reason);
      grants.revokeAll(actor, reason);
      deps.policy?.revokeTaskScopes(null, reason, actor);
    });
    // Factory missions are marked cancelled FIRST, so a run that ends below cannot trigger the next stage.
    const factoryPromise = factory ? factory.stopAll(reason).catch((error) => [{ error: error.message }]) : null;
    const interrupted = [];
    for (const [runId, entry] of [...active.entries()]) {
      const result = await entry.handle.interrupt("stop-all").catch((error) => ({ interrupted: false, error: error.message }));
      interrupted.push({ runId, provider: entry.provider, ...result });
    }
    for (const [approvalId, resolve] of approvalWaiters) { approvalWaiters.delete(approvalId); resolve("decline"); }
    const voiceSession = voicePromise ? await voicePromise : null;
    const factoryMissions = factoryPromise ? await factoryPromise : [];
    bus.emit({ type: "system.stop_all", scopeType: "system", scopeId: "hub", source: actor, payload: { reason, interrupted: interrupted.length, voiceStopped: Boolean(voiceSession), factoryMissions: factoryMissions.length } });
    return { gate: "suspended", interrupted, voiceSession, factoryMissions, cloudTasksUnconfirmed: [], irreversibleEffects: [],
      note: "No cloud tasks or external effects are started by this Hub build; only local provider processes were interrupted." };
  }

  const activeRuns = () => [...active.entries()].map(([runId, entry]) => ({ runId, provider: entry.provider, conversationId: entry.conversationId, pid: entry.handle.pid, taskId: entry.taskId || null,
    startedAt: entry.startedAt || null, lastEventAt: entry.lastEventAt || null, firstOutputAt: entry.firstOutputAt || null, phase: entry.firstOutputAt ? "streaming" : "waiting_provider",
    timeline: entry.timeline ? entry.timeline.toJSON() : {} }));
  return { start, interrupt, stopAll, resolveApproval, getRun, listRuns, activeRuns, activeCount: () => active.size + starting.size, rowToRun, attachVoice: (v) => { voice = v; }, attachFactory: (f) => { factory = f; },
    timelineOf: (runId) => summarizeTimeline(getRun(runId)?.timeline || {}), refundPreInference };
}
