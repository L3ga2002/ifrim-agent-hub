import path from "node:path";
import { HubError, PRE_INFERENCE_CATEGORIES } from "../core/errors.mjs";
import { newId } from "../core/ids.mjs";
import { json, parse } from "../storage/db.mjs";
import { transitionTask } from "./state-machine.mjs";
import { buildTurnPrompt } from "./prompt.mjs";
import { gitState } from "../tools/git.mjs";
import { redactText } from "../security/redact.mjs";
import { resolveRunPlan, planRecord, DEFAULT_PROFILE } from "../policy/run-plan.mjs";
import { compareAtDispatch, compareAtInit, claudeExpectation } from "../policy/model-binding.mjs";
import { createTimeline, summarizeTimeline } from "./timeline.mjs";
import { inspectionFromState } from "../policy/gate.mjs";
import { appendReport, applyLatch, buildProviderReport } from "../policy/billing-evidence.mjs";
import { composeSkills, COMPOSER_VERSION } from "../domain/skill-composer.mjs";
import { sha256 } from "../core/canonical.mjs";
import { runScopeKey } from "../domain/grants.mjs";
import { nextSuspension } from "../policy/gate-state.mjs";
import { stopScopeRecord } from "../owner/stop-scope.mjs";
import { drainWithin } from "./shutdown.mjs";

const PERSIST_INTERVAL_MS = 700;
/** The suspension kinds a Stop All may record (D17); a pause or a plain gate suspension never comes through here. */
const STOP_KINDS = new Set(["stop_all", "shutdown", "security"]);
const APPROVAL_WAIT_MINUTES = 15;
/** 2.12.2 (P0-R3): the longest per-turn limit a caller may ask for (a Software Factory writer turn allows at most 60 min). */
const TURN_TIMEOUT_MAX_MS = 6 * 3600000;
/**
 * A failure the adapter reports with a more specific cause than the deadline (a billing / quota / policy stop, a refused export…) keeps
 * that cause when both arrive together; only an interruption or a transport/task end the deadline itself caused becomes the timeout.
 */
const TIMEOUT_KEEPS = new Set(["billing", "quota", "policy", "authentication", "validation", "export", "tool", "model", "output_token_limit"]);
/**
 * Review R3-F5: on an execution environment the per-turn deadline bounds the provider's TURN, not the adapter's own work after it (reap,
 * post-inspection, export validation, apply: providers/codex-wsl.mjs, claude-wsl.mjs). When the deadline passes there while the
 * provider's process is still ending, it waits at most this long (once) for that process to go before it interrupts the turn.
 */
const ENV_TURN_SETTLE_GRACE_MS = 5000;
const fmtLimit =(ms) => (ms % 60000 === 0 ? `${ms / 60000} min` : ms >= 60000 ? `${(ms / 60000).toFixed(1).replace(".", ",")} min` : `${Math.max(1, Math.round(ms / 1000))} s`);

export const workspaceResource = (workspacePath) => `workspace:${path.resolve(workspacePath).toLowerCase()}`;

/**
 * M09: does the model a provider reported belong to what was sent? Codex: the exact id (the adapter already stops otherwise);
 * Claude: the bound family / dated id (or, for a manual run, the family of the explicit model). null when nothing was reported.
 */
function modelMatches(provider, plan, value) {
  if (!value) return null;
  if (provider === "codex") return value.trim().toLowerCase() === String(plan.model || "").trim().toLowerCase();
  const expectation = plan.resolutionEvidence ? plan.resolutionEvidence : claudeExpectation(plan.model);
  return expectation ? compareAtInit({ provider: "claude", resolvedAlias: plan.resolvedAlias || plan.model, resolutionEvidence: expectation }, value) === null : false;
}

/** Execution surface of the Hub-driven provider routes (the only PROGRAMMATIC model surfaces in this build). */
export const SURFACE_BY_PROVIDER = Object.freeze({ codex: "openai.codex_app_server", claude: "anthropic.claude_code_headless" });
/** Surfaces of the M05 execution environments (same provider, another process boundary). */
export const SURFACE_BY_ENVIRONMENT = Object.freeze({ "wsl-runner": { codex: "openai.codex_wsl_runner" } });

/**
 * Executes provider turns for the canonical conversation. Sequence:
 * gate → lease (single writer) → grant attempt → verified backup → run record → provider turn →
 * persisted result. A finished model turn moves its task to VERIFYING, never to COMPLETED.
 */
export function createRunManager(deps) {
  const { db, bus, clock, settings, projects, conversations, missions, gate, leases, grants, backups, approvals, providers, breakers, usage, live, providerState = null } = deps;
  const surfaceOf = (provider, environment = "windows") => (environment !== "windows" ? SURFACE_BY_ENVIRONMENT[environment]?.[provider] : SURFACE_BY_PROVIDER[provider]) || null;
  const routeOf = (projectId, provider) => (deps.environments ? deps.environments.routeFor(projectId, provider) : "windows");
  const active = new Map(); // runId -> { handle, conversationId, provider, leaseId, taskId }
  const approvalWaiters = new Map(); // approvalId -> resolve
  const starting = new Set(); // conversationId currently being admitted
  // 2.12.1 (AS-01): bumped by every Stop All, synchronously, before anything else. A start still being admitted (waiting for its
  // backup or its git state) compares it at the pre-model recheck: a stop that landed meanwhile wins, even if the gate is open again.
  let stopEpoch = 0;
  let closed = false, detached = false;
  const admissions = new Set(), completions = new Map();
  const turnTimers = deps.turnTimers || { setTimeout, clearTimeout, now: () => performance.now() };
  const shutdownError = () => new HubError("policy", "Hub-ul se oprește; nicio operație nouă nu pornește", { code: "HUB_SHUTDOWN" });
  function close() {
    if (closed) return;
    closed = true; stopEpoch += 1;
    for (const entry of active.values()) clearTurnDeadline(entry, "shutdown");
    for (const [id, resolve] of approvalWaiters) { approvalWaiters.delete(id); resolve("decline"); }
  }
  const drain = (ms = 10000) => drainWithin(Promise.allSettled([...admissions]), ms, "runs admissions");
  // Only owned process work needs an exit drain. A synthetic/lost handle with no owned child may deliberately never settle
  // (crash recovery keeps its row uncertain); detach below fences its late callbacks without rewriting that persisted state.
  const settle = (ms = 5000) => drainWithin(Promise.all([...completions].filter(([, owned]) => owned).map(([pending]) => pending)), ms, "runs completion");
  // A failed bounded drain is reported by hub.close. Late callbacks may no longer use its database.
  const detach = () => { detached = true; for (const entry of active.values()) clearTurnDeadline(entry, "shutdown"); };
  function start(input) {
    if (closed) return Promise.reject(shutdownError());
    const pending = startAdmission(input);
    admissions.add(pending);
    pending.then(() => admissions.delete(pending), () => admissions.delete(pending));
    return pending;
  }
  let voice = null; // Lega session manager (late-bound): Stop All must end the voice session too
  let factory = null; // Software Factory (late-bound): Stop All stops its missions before the next stage can start

  const rowToRun = (row) => row && ({ id: row.id, taskId: row.task_id, conversationId: row.conversation_id, roleId: row.role_id, stage: row.stage,
    provider: row.provider, model: row.model, effort: row.effort, access: row.access, status: row.status, providerSessionId: row.provider_session_id,
    nativeThreadId: row.native_thread_id, nativeTurnId: row.native_turn_id, pid: row.pid, inputMessageId: row.input_message_id, outputMessageId: row.output_message_id,
    codeVersion: row.code_version, backupId: row.backup_id, approvalId: row.approval_id, grantId: row.grant_id, errorCategory: row.error_category,
    errorMessage: row.error_message, preInference: Boolean(row.pre_inference), usage: parse(row.usage_json, {}), evidence: parse(row.evidence_json, {}),
    lastEventAt: row.last_event_at, startedAt: row.started_at, finishedAt: row.finished_at, createdAt: row.created_at, legacyId: row.legacy_id,
    timeline: parse(row.timeline_json, {}), plan: parse(row.plan_json, {}), environment: row.environment || "windows",
    // M09-A3: what the run received (pinned skill versions + body hashes) and the hash/size of the exact prompt sent.
    skillVersions: parse(row.skill_versions_json, []), skillContext: parse(row.skill_context_json, {}), promptSha256: row.prompt_sha256 || null, promptChars: row.prompt_chars ?? null });

  const getRun = (id) => rowToRun(db.prepare("SELECT * FROM agent_runs WHERE id = ?").get(id));
  const listRuns = ({ conversationId = null, taskId = null, status = null, limit = 100 } = {}) => {
    const where = []; const args = [];
    if (conversationId) { where.push("conversation_id = ?"); args.push(conversationId); }
    if (taskId) { where.push("task_id = ?"); args.push(taskId); }
    if (status) { where.push("status = ?"); args.push(status); }
    return db.prepare(`SELECT * FROM agent_runs ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC LIMIT ?`).all(...args, limit).map(rowToRun);
  };

  function recordBlockedRun({ conversation, provider, access, taskId, stage, roleId, inputMessageId, category, message, evidence, timeline = null, plan = null, environment = "windows" }) {
    const id = newId("run");
    const now = clock().toISOString();
    // A gate refusal never arms a timer, but still records why the requested deadline had no active lifetime.
    const turnDeadline = plan?.turnTimeoutMs ? { limitMs: plan.turnTimeoutMs, admissionArmedAt: null, admissionDeadlineAt: null,
      turnSentAt: null, turnArmedAt: null, deadlineAt: null, fired: false, firedAt: null, clearedBy: "blocked",
      admissionArms: 0, turnArms: 0, noticesAfterTurnSent: 0, apiRetriesAfterTurnSent: 0 } : null;
    if (turnDeadline) evidence = { ...evidence, turnDeadline };
    bus.transaction(() => {
      db.prepare(`INSERT INTO agent_runs (id, task_id, conversation_id, role_id, stage, provider, model, effort, access, status, input_message_id, error_category, error_message, pre_inference, evidence_json,
        timeline_json, plan_json, created_at, finished_at, environment)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'blocked', ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`).run(id, taskId, conversation.id, roleId || "", stage || "assist", provider, plan?.model || "", plan?.effort || "", access,
        inputMessageId, category, message, json(evidence), json(timeline ? timeline.toJSON() : {}), json(plan ? planRecord(plan) : {}), now, now, environment);
      bus.append({ type: "run.blocked", scopeType: "conversation", scopeId: conversation.id, projectId: conversation.projectId, source: "hub", runId: id,
        payload: { provider, category, message, preInference: true } });
      if (turnDeadline) bus.append({ type: "run.turn_deadline", scopeType: "conversation", scopeId: conversation.id, source: "hub", runId: id, payload: turnDeadline });
    });
    return getRun(id);
  }

  /**
   * M09: a run dispatched under an approved binding (Software Factory role) sends exactly the bound model and effort. They are
   * resolved again NOW from the same route and compared (compareAtDispatch): any material change (model gone from model/list,
   * effort, Claude CLI version, route) becomes the plan's problem, so the gate refuses the start before any process — category
   * gate, pre-inference, no grant attempt taken, not counted as a factory attempt.
   */
  function boundPlan({ binding, provider, environment, state }) {
    const fresh = resolveRunPlan({ provider, model: binding.resolvedAlias, effort: binding.effort, profile: binding.profile, providerState: state });
    const change = binding.provider !== provider ? { code: "MATERIAL_CHANGE", reasons: [`legătura este pentru ${binding.provider}, nu pentru ${provider}`] } : compareAtDispatch(binding, fresh, state, { environment });
    const plan = { ...fresh, requestedModel: binding.requestedModel, requestedEffort: binding.requestedEffort, modelSource: "binding", effortSource: binding.effortSource,
      bindingHash: binding.bindingHash, bindingRole: binding.role, resolvedAlias: binding.resolvedAlias, resolutionEvidence: binding.resolutionEvidence, problem: null };
    if (change) {
      plan.problem = `Schimbare materială față de modelul aprobat (${binding.role}): ${change.reasons.join("; ")}; nimic nu a pornit — e nevoie de o confirmare nouă`;
      plan.materialChange = change;
    }
    return plan;
  }

  /**
   * `profile` picks the Hub effort profile when no explicit effort is given (M03 §09); `requestedAt` / `approval` let the
   * timeline start at the owner's request instead of at admission (M03 §08). Both are optional for older callers.
   * `binding` (M09): the approved model/effort binding of a Software Factory role; it overrides model/effort/profile.
   * `turnTimeoutMs` (2.12.2, P0-R3): an absolute wall-clock limit for this turn (absent = none, the behaviour before). It is armed when
   * the run is admitted — a backstop for the phases before the turn — and armed again, once and with the FULL limit, when the turn
   * reaches the model (turn_sent). At the deadline the adapter's own interruption ends the turn; the run is recorded `failed` with
   * errorCategory `turn_timeout` (an attempt: it reached the model) — or, when the turn never reached the model, `blocked` before
   * inference (its grant attempt given back). A Pause, a Stop, an interruption and Stop All clear it; it never fires after the run ended.
   */
  async function startAdmission({ conversationId, provider, access = "read-only", model = "", effort = "", profile = DEFAULT_PROFILE, taskId = null, stage = "assist", roleId = "", grantId = null,
    actor = "user", correlationId = null, requestedAt = null, approval = null, exportPolicy = null, binding = null, turnTimeoutMs = null, maxOutputTokens = null }) {
    if (!providers[provider]) throw new HubError("validation", `Unknown provider ${provider}`);
    const turnLimitMs = turnTimeoutMs === null || turnTimeoutMs === undefined ? null : Number(turnTimeoutMs);
    if (turnLimitMs !== null && !(Number.isFinite(turnLimitMs) && turnLimitMs >= 1 && turnLimitMs <= TURN_TIMEOUT_MAX_MS)) {
      throw new HubError("validation", `Limita pe tură trebuie să fie între 1 ms și ${TURN_TIMEOUT_MAX_MS / 3600000} h`);
    }
    const authorDispatch = correlationId && db.prepare("SELECT * FROM factory_dispatches WHERE id = ? AND json_extract(request_json, '$.turnTimeoutSource') = 'authorLimits'").get(correlationId);
    if (authorDispatch) {
      const request = parse(authorDispatch.request_json, {});
      const expected = actor === "factory" && authorDispatch.status === "CLAIMED" && authorDispatch.stage === "TEST_AUTHORING"
        && authorDispatch.task_id === taskId ? factory?.dispatchTurnLimit(authorDispatch.mission_id, authorDispatch.stage) : null;
      if (expected?.source !== "authorLimits" || request.turnTimeoutMin !== expected.min || turnLimitMs !== expected.ms) {
        throw new HubError("validation", "Limita autorului testului nu corespunde dispatch-ului aprobat și scalei Factory");
      }
    }
    const conversation = conversations.get(conversationId);
    if (!conversation) throw new HubError("not_found", "Conversation not found");
    let taskMission = null;
    if (taskId) {
      const taskRow = db.prepare("SELECT project_id, mission_id FROM tasks WHERE id = ?").get(String(taskId));
      if (!taskRow?.project_id) throw new HubError("not_found", "Task not found");
      if (taskRow.project_id !== conversation.projectId) throw new HubError("validation", "Sarcina aparține altui proiect decât conversația");
      taskMission = taskRow.mission_id || null;
    }
    const project = projects.get(conversation.projectId);
    // M05: the project route decides the adapter (Windows client or an execution environment); the gate checks the same route.
    const environment = routeOf(project?.id, provider);
    const adapter = environment === "windows" ? providers[provider] : providers[`${provider}@${environment}`] || null;
    const stateKey = environment === "windows" ? provider : `${provider}@${environment}`;
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
    // M09: under an approved binding the binding decides (never the request's loose model/effort fields).
    const state = providerState?.get(stateKey) || null;
    // A bound run names its mission too: a grant derived for one mission of a plan serves only that mission (same model or not).
    // M10.2 (U12): a run envelope's single step names its plan instead ("envrun:<id>"): the gate admits it through that plan only and
    // its grant serves nothing else. Such a run is never a factory task (the binding comes from the envelope service, never a payload).
    if (binding?.envelopeRunId && taskMission) throw new HubError("validation", "O execuție din planul unei singure execuții nu aparține unei sarcini Software Factory");
    const plan = binding ? { ...boundPlan({ binding, provider, environment, state }), missionId: binding.envelopeRunId ? runScopeKey(binding.envelopeRunId) : taskMission }
      : resolveRunPlan({ provider, model, effort, profile: profile || DEFAULT_PROFILE, providerState: state });
    if (turnLimitMs) plan.turnTimeoutMs = Math.round(turnLimitMs); // recorded with the plan (plan_json): the limit this turn ran under
    if (!plan.problem) timeline.mark("plan_resolved");
    if (plan.materialChange) bus.emit({ type: "run.material_change", scopeType: "conversation", scopeId: conversationId, projectId: project?.id || null, source: "hub",
      payload: { provider, role: binding?.role || null, bindingHash: binding?.bindingHash || null, reasons: plan.materialChange.reasons.slice(0, 5) } });
    // What Claude Code must report at init: the bound family / dated id, or (manual run) the family of the explicit model.
    const expectedModel = provider !== "claude" ? null : binding ? { provider: "claude", resolvedAlias: binding.resolvedAlias, resolutionEvidence: binding.resolutionEvidence }
      : (() => { const e = claudeExpectation(plan.model); return e ? { provider: "claude", resolvedAlias: plan.model, resolutionEvidence: e } : null; })();
    const resource = workspaceResource(project.path);
    const decision = gate.evaluate({ provider, projectId: project.id, access, grantId, workspaceResource: resource, plan, environment });
    timeline.mark("gate_checked");
    if (!decision.allowed) {
      const failed = decision.checks.filter((c) => !c.ok);
      const run = recordBlockedRun({ conversation, provider, access, taskId, stage, roleId, inputMessageId: lastUser.id, category: "gate",
        message: failed.map((c) => `${c.id}: ${c.detail}`).join(" · "), evidence: { gate: decision }, timeline, plan, environment });
      throw new HubError("gate", "Execution gate refused the run", { data: { runId: run.id, checks: decision.checks } });
    }
    if (!adapter) throw new HubError("validation", `No adapter for ${provider} in ${environment}`);

    // Everything above is synchronous: a Stop All cannot land between the gate's decision and this admission mark.
    const admittedAtEpoch = stopEpoch;
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
        if (detached) throw shutdownError();
        if (created?.status !== "verified") {
          bus.transaction(() => leases.release(lease.id, "backup gate failed"));
          // Nothing reached a provider: the attempt taken above goes back (bounded, see refundPreInference).
          if (grant) refundPreInference(grant.id, `backup gate failed before ${runId} started`);
          const run = recordBlockedRun({ conversation, provider, access, taskId, stage, roleId, inputMessageId: lastUser.id, category: "gate",
            message: `Backup gate: ${created?.status || "failed"} ${created?.error || ""}`.trim(), evidence: { backupId: created?.id }, timeline, plan, environment });
          throw new HubError("gate", "Backup gate failed; the model was not started", { data: { runId: run.id, backupId: created?.id } });
        }
        backup = { ok: true, backup: created, created: true };
      }
      timeline.mark("backup_ready");

      const git = closed ? {} : await gitState(project.path);
      if (detached) throw shutdownError();
      timeline.mark("git_state");
      // M09 review: the billing evidence can change while this run waited for the backup / git state (the owner withdrew the
      // declaration, a concurrent run's report latched re-verification). The billing route is checked again here, the last moment
      // before anything reaches the provider (only that check: the lease and the attempt are already this run's).
      const recheck = gate.evaluate({ provider, projectId: project.id, access, grantId, workspaceResource: resource, plan, environment });
      // 2.12.1 (AS-01, the kill switch): a Stop All (or any suspension of the gate, or the revocation of the grant this start took)
      // while it waited for the backup / git state means the start never reaches its model — even when the gate was reopened in
      // between (the stop epoch). Only these checks are read here: the lease, the concurrency slot and the attempt are already this
      // start's own. The lease is released, the attempt given back (bounded), the refusal recorded as a blocked run, and a grant a
      // Stop All would have revoked (an exhausted one, or one the refund made usable again) is revoked: Stop All's revocation stands.
      const stoppedSince = closed || stopEpoch !== admittedAtEpoch;
      const gateNow = recheck.checks.find((c) => c.id === "execution_gate");
      const heldGrant = grant ? grants.get(grant.id) : null;
      const grantRevoked = Boolean(grant) && (!heldGrant || heldGrant.status === "revoked");
      if (stoppedSince || (gateNow && !gateNow.ok) || grantRevoked) {
        const failed = stoppedSince ? { id: "execution_gate", ok: false, detail: closed ? "Hub-ul se oprește în timpul admiterii: execuția nu ajunge la model" : "Stop All în timpul admiterii: execuția nu ajunge la model" }
          : gateNow && !gateNow.ok ? gateNow : { id: "live_grant", ok: false, detail: `Grantul ${grant.id} a fost revocat în timpul admiterii` };
        bus.transaction(() => leases.release(lease.id, closed ? "Hub-ul se oprește înainte de pornire" : stoppedSince ? "Stop All before start" : "gate closed before start"));
        if (grant) {
          refundPreInference(grant.id, `${failed.id} closed before ${runId} started`);
          const after = grants.get(grant.id);
          if (!closed && stoppedSince && after?.status === "active") bus.transaction(() => grants.revoke(after.id, "stop-all"));
        }
        const run = recordBlockedRun({ conversation, provider, access, taskId, stage, roleId, inputMessageId: lastUser.id, category: "gate",
          message: `${failed.id}: ${failed.detail}`, evidence: { gate: { checks: [failed] }, recheck: true, stopAll: !closed && stoppedSince, shutdown: closed }, timeline, plan, environment });
        throw new HubError("gate", closed ? "Hub-ul se oprește în timpul admiterii; modelul nu a pornit" : stoppedSince ? "Stop All landed while the run was being admitted; the model was not started" : "The execution gate closed before the run started; the model was not started",
          { data: { runId: run.id, checks: [failed], stopAll: !closed && stoppedSince, shutdown: closed } });
      }
      const billingNow = recheck.checks.find((c) => c.id === "billing_route");
      if (billingNow && !billingNow.ok) {
        bus.transaction(() => leases.release(lease.id, "billing evidence changed before start"));
        if (grant) refundPreInference(grant.id, `billing evidence changed before ${runId} started`);
        const run = recordBlockedRun({ conversation, provider, access, taskId, stage, roleId, inputMessageId: lastUser.id, category: "gate",
          message: `billing_route: ${billingNow.detail}`, evidence: { gate: { checks: [billingNow] }, recheck: true }, timeline, plan, environment });
        throw new HubError("gate", "Billing evidence changed before the run started; the model was not started", { data: { runId: run.id, checks: [billingNow] } });
      }
      const now = clock().toISOString();
      // A native thread lives in ONE client installation: an environment run never resumes a Windows thread (or vice versa).
      const sessionId = environment === "windows" ? conversations.latestSession(conversationId, provider) : null;
      let outputMessage;
      const taskRow = taskId ? db.prepare("SELECT department_id, route_decision_id FROM tasks WHERE id = ?").get(taskId) : null;
      // M09-A3: the skill composer decides ONCE, from Hub rows, which approved procedures this run receives; the record and the
      // prompt are both built from this one object (the version recorded is the version sent). Skills grant nothing: the
      // composition never reaches access, model, effort, grants, the gate or the adapter options. A composer failure means no
      // procedures (never a guess), and it is reported.
      let skillPlan;
      try {
        skillPlan = deps.skills ? composeSkills({ db, skills: deps.skills, projectId: project.id, taskId, roleId, access }) : { records: [], usage: [], section: "", context: {} };
      } catch (error) {
        skillPlan = { records: [], usage: [], section: "", context: { composerVersion: COMPOSER_VERSION, error: String(error?.message || error).slice(0, 300) } };
        bus.emit({ type: "run.skills_failed", scopeType: "conversation", scopeId: conversationId, projectId: project.id, source: "hub", payload: { error: skillPlan.context.error } });
      }
      const prompt = buildTurnPrompt({ db, conversations, conversation, project, git, provider, runId, environment, access, skillSection: skillPlan.section });
      const promptSha256 = sha256(prompt.text);
      timeline.mark("run_recorded");
      bus.transaction(() => {
        db.prepare(`INSERT INTO agent_runs (id, task_id, conversation_id, role_id, stage, provider, model, effort, access, status, provider_session_id, input_message_id,
          code_version, backup_id, grant_id, last_event_at, started_at, created_at, surface_id, department_id, route_decision_id, correlation_id, skill_versions_json, timeline_json, plan_json, environment,
          prompt_sha256, prompt_chars, skill_context_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(runId, taskId, conversationId, roleId, stage, provider, plan.model, plan.effort, access, sessionId || null, lastUser.id, git.head || "", backup.backup.id, grant?.id || null, now, now, now,
            surfaceOf(provider, environment), taskRow?.department_id || null, taskRow?.route_decision_id || null, correlationId || runId, json(skillPlan.records), json(timeline.toJSON()), json(planRecord(plan)), environment,
            promptSha256, prompt.text.length, json(skillPlan.context));
        const usageRow = db.prepare(`INSERT INTO run_skill_usage (run_id, skill_id, version, sha256, body_sha256, source, candidate_id, chars, applied, reason, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        for (const u of skillPlan.usage) usageRow.run(runId, u.skillId, u.version, u.sha256, u.bodySha256 || null, u.source, u.candidateId || null, u.chars || 0, u.applied ? 1 : 0, u.reason || "", now);
        leases.attachRun(lease.id, runId);
        outputMessage = conversations.addMessage({ conversationId, role: "assistant", content: "", provider, model: plan.model, runId, status: "streaming", metadata: { access } }, "hub");
        db.prepare("UPDATE agent_runs SET output_message_id = ? WHERE id = ?").run(outputMessage.id, runId);
        conversations.update(conversationId, { status: "running", writerProvider: provider }, "hub");
        if (taskId) transitionTask(db, bus, clock, { taskId, to: "RUNNING", reason: `Run ${runId} started on ${provider}`, actor });
        bus.append({ type: "run.started", scopeType: "conversation", scopeId: conversationId, projectId: project.id, source: actor, runId,
          payload: { provider, environment, model: plan.model, effort: plan.effort, effortSource: plan.effortSource, modelSource: plan.modelSource, profile: plan.profile, access, backupId: backup.backup.id, backupCreated: Boolean(backup.created),
            grantId: grant?.id || null, codeVersion: git.head, bindingHash: plan.bindingHash || null, turnTimeoutMs: plan.turnTimeoutMs || null,
            skills: skillPlan.records.filter((r) => r.applied).map((r) => ({ id: r.id, version: r.version, source: r.source, applied: true })), promptSha256 } });
      });

      let content = "";
      let lastPersist = 0;
      const handle = adapter.startTurn({
        runId, cwd: project.path, prompt: prompt.text, access, model: plan.model, effort: plan.effort,
        // The option belongs only to a real Factory author dispatch, never to manual/chat/reviewer runs.
        ...(maxOutputTokens === 64000 && actor === "factory" && provider === "claude" && environment === "windows"
          && db.prepare("SELECT 1 FROM factory_dispatches WHERE id = ? AND stage = 'TEST_AUTHORING' AND status = 'CLAIMED' AND json_extract(request_json, '$.maxOutputTokens') = 64000").get(correlationId)
          ? { maxOutputTokens: 64000 } : {}),
        threadId: provider === "codex" ? sessionId : undefined, sessionId: provider === "claude" ? sessionId : undefined,
        trustedWorkspace: project.trustedConfig, projectId: project.id, exportPolicy: exportPolicy || {},
        // M09: Claude's init model is compared with the bound (or explicitly requested) model; a mismatch stops before the model.
        ...(expectedModel ? { verifyInitModel: (reported) => compareAtInit(expectedModel, reported) } : {}),
        admitUsage: (snapshot) => usage.admit(provider, snapshot),
        requestApproval: (request) => waitForApproval({ runId, conversation, project, provider, request, taskId }),
        onEvent: (event) => onProviderEvent(runId, conversationId, event, (text) => {
          content += text;
          if (Date.now() - lastPersist > PERSIST_INTERVAL_MS) { conversations.updateStreaming(outputMessage.id, content); lastPersist = Date.now(); }
        }),
      });
      active.set(runId, { handle, conversationId, provider, environment, leaseId: lease.id, taskId, outputMessageId: outputMessage.id, promptPackage: prompt.packageRef, startedAt: clock().toISOString(), lastEventAt: null, firstOutputAt: null, timeline,
        turnLimitMs: plan.turnTimeoutMs || null, turnDeadline: null, admissionDeadline: null, admissionArms: 0, turnArms: 0,
        noticesAfterTurnSent: 0, apiRetriesAfterTurnSent: 0 });
      // 2.12.2 (P0-R3): armed now (the backstop before the turn); onProviderEvent arms it again with the full limit at turn_sent.
      if (plan.turnTimeoutMs) armTurnDeadline(runId, timeline.has("turn_sent") ? "turn" : "admission");
      if (handle.pid) markPhase(runId, "process_spawned");
      db.prepare("UPDATE agent_runs SET pid = ?, pid_started_at = ? WHERE id = ?").run(handle.pid || null, clock().toISOString(), runId);
      const completion = handle.done.then((result) => finalize(runId, result, () => content))
        .catch((error) => finalize(runId, { status: "failed", errorCategory: "internal", error: error.message, output: content }, () => content));
      completions.set(completion, Boolean(deps.supervisorRecord?.(handle.key)?.child) || environment !== "windows");
      completion.then(() => completions.delete(completion), () => { completions.set(completion, true); }); // retain finalization errors for shutdown
      return { run: getRun(runId), gate: decision };
    } catch (error) {
      if (!detached && lease && !active.has(runId)) {
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

  // ---------- 2.12.2 (P0-R3): the per-turn deadline ----------
  // limita turei: armată la admitere, rearmată o singură dată la turn_sent; reîncercările CLI de după turn_sent intră în același termen
  /**
   * Arms the turn's deadline: "admission" when the run is admitted (a backstop: a process start, an account or thread check that
   * hangs is bounded too), then "turn" ONCE when the turn reaches the model, with the full limit from that moment. A deadline that
   * fired, or that an interruption cleared, is never armed again (a resumed step is a new run with a fresh deadline).
   */
  function armTurnDeadline(runId, phase) {
    const entry = active.get(runId);
    if (!entry?.turnLimitMs || stoppedRuns.has(runId)) return null;
    const prev = entry.turnDeadline;
    if (prev && (prev.fired || prev.cleared || prev.phase === "turn")) return prev;
    if (prev?.timer) turnTimers.clearTimeout(prev.timer);
    const at = clock();
    const deadline = { phase, limitMs: entry.turnLimitMs, armedAt: at.toISOString(), deadlineAt: new Date(at.getTime() + entry.turnLimitMs).toISOString(),
      startedPerf: turnTimers.now(), fired: false, cleared: false, clearedBy: null, timer: null };
    deadline.timer = turnTimers.setTimeout(() => onTurnDeadline(runId, deadline), entry.turnLimitMs);
    deadline.timer.unref?.();
    entry.turnDeadline = deadline;
    if (phase === "admission") { entry.admissionDeadline = deadline; entry.admissionArms += 1; }
    else entry.turnArms += 1;
    return deadline;
  }

  /** Additive parity evidence, including successful and interrupted turns; the legacy timeout evidence keeps its shape. */
  function turnDeadlineEvidence(entry) {
    const d = entry?.turnDeadline;
    if (!d) return null;
    return { limitMs: d.limitMs, admissionArmedAt: entry.admissionDeadline?.armedAt || null,
      admissionDeadlineAt: entry.admissionDeadline?.deadlineAt || null, turnSentAt: entry.timeline?.toJSON().turn_sent || null,
      turnArmedAt: d.phase === "turn" ? d.armedAt : null, deadlineAt: d.deadlineAt, fired: d.fired, firedAt: d.firedAt || null,
      clearedBy: d.clearedBy, admissionArms: entry.admissionArms, turnArms: entry.turnArms,
      noticesAfterTurnSent: entry.noticesAfterTurnSent, apiRetriesAfterTurnSent: entry.apiRetriesAfterTurnSent };
  }

  /** Ends a deadline that has not fired (Pause, Stop, an interruption, Stop All, the run's own end): its timer can no longer fire. */
  function clearTurnDeadline(entry, by) {
    const d = entry?.turnDeadline;
    if (!d || d.fired || d.cleared) return;
    if (d.timer) turnTimers.clearTimeout(d.timer);
    d.timer = null;
    d.cleared = true;
    d.clearedBy = String(by || "").slice(0, 40);
  }

  /**
   * The deadline passed on a run that is still this deadline's (never after its end, an interruption, Stop All or a re-arm): the turn
   * is interrupted through the adapter's own path (Codex: turn/interrupt, then the process after its grace; Claude: the process), as a
   * Stop would, and a provider approval it still waits for is declined. The lease follows the run's end (released, or retained and
   * reconciled by runtime/lease-reconcile.mjs); a turn whose answer never arrives after its process is gone is settled by the bounded
   * lost-turn follow-up. Nothing is retried or relaunched here: a retry is the caller's decision (the factory's, bounded by its plan).
   */
  function onTurnDeadline(runId, deadline) {
    const entry = active.get(runId);
    if (!entry || entry.turnDeadline !== deadline || deadline.cleared || deadline.fired || stoppedRuns.has(runId)) return;
    // Review R3-F5: an execution environment's adapter keeps working after its provider's turn settled (reap, post-inspection, export
    // validation, apply). Interrupting it then would quarantine a COMPLETED writer's export and record a timeout — on Windows a
    // completed turn always stays completed (TT-09). The provider's own process (the supervisor record the inner adapter keeps under
    // the run's key and forgets only after its turn settled) decides: gone → the turn settled, the deadline ends here ("turn_settled");
    // still ending → one bounded wait for it, then the turn is cut as before. Before the turn reached the model the backstop is unchanged.
    if ((entry.environment || "windows") !== "windows" && (deadline.phase === "turn" || entry.timeline?.has("turn_sent"))) {
      const settled = providerTurnSettled(entry);
      if (settled) { clearTurnDeadline(entry, "turn_settled"); return; }
      if (settled === false && !deadline.graceMs) {
        deadline.graceMs = Math.max(1, Math.min(ENV_TURN_SETTLE_GRACE_MS, deadline.limitMs));
        deadline.timer = turnTimers.setTimeout(() => onTurnDeadline(runId, deadline), deadline.graceMs);
        deadline.timer.unref?.();
        return;
      }
    }
    deadline.fired = true;
    deadline.timer = null;
    deadline.elapsedMs = Math.round(turnTimers.now() - deadline.startedPerf);
    deadline.turnSent = deadline.phase === "turn" || Boolean(entry.timeline?.has("turn_sent"));
    try { deadline.firedAt = clock().toISOString(); } catch { deadline.firedAt = null; }
    try { Promise.resolve(entry.handle.interrupt("turn-timeout")).catch(() => {}); } catch { /* the lost-turn follow-up below settles it */ }
    try {
      for (const [approvalId, resolve] of [...approvalWaiters]) {
        if (approvals.get(approvalId)?.scopeId === runId) { approvalWaiters.delete(approvalId); resolve("decline"); }
      }
    } catch { /* the database is closing */ }
    try {
      bus.emit({ type: "run.turn_timeout", scopeType: "conversation", scopeId: entry.conversationId, source: "hub", runId,
        payload: { provider: entry.provider, environment: entry.environment || "windows", limitMs: deadline.limitMs, elapsedMs: deadline.elapsedMs, phase: deadline.phase,
          turnSent: deadline.turnSent, deadlineAt: deadline.deadlineAt, ...(deadline.graceMs ? { settleGraceMs: deadline.graceMs } : {}) } });
    } catch { /* the database is closing: the run ends with its process */ }
    try { scheduleLostTurnChecks([runId]); } catch { /* timers only */ }
  }

  /**
   * R3-F5: whether an environment run's provider turn has settled — true when the provider's process (supervisor record under the run's
   * key) is gone or exited, false while it still runs, null when this manager cannot tell (no supervisor access: the deadline then cuts
   * the turn as before — never a silent loss of the limit).
   */
  function providerTurnSettled(entry) {
    if (typeof deps.supervisorRecord !== "function") return null;
    let record;
    try { record = deps.supervisorRecord(entry.handle?.key); } catch { return null; }
    return !record || Boolean(record.exited);
  }

  /** At the run's end: the deadline that fired (the outcome is a timeout), or null — a deadline still armed is cleared here. */
  function settleTurnDeadline(entry) {
    const d = entry?.turnDeadline;
    if (!d) return null;
    if (d.fired) return d;
    clearTurnDeadline(entry, "finished");
    return null;
  }

  /**
   * The outcome of a run whose deadline fired. A COMPLETED turn stays completed (its answer arrived while the process was ending: never
   * a timeout); a more specific stop the adapter reported keeps its cause; anything else — the interruption the deadline caused — is
   * `turn_timeout`: an attempt when the turn had reached the model (failed, counted, never forgiven like an owner's interruption), a stop
   * before inference otherwise (blocked, the grant attempt given back). The evidence { limitMs, elapsedMs, … } is kept on the run.
   */
  function turnTimeoutOutcome(result, d, entry) {
    const r = result || {};
    const reached = Boolean(d.turnSent) || Boolean(entry?.timeline?.has("turn_sent"));
    const evidence = { limitMs: d.limitMs, elapsedMs: d.elapsedMs ?? null, phase: d.phase, turnSent: reached, armedAt: d.armedAt, deadlineAt: d.deadlineAt, firedAt: d.firedAt || null };
    if (r.status === "completed") return { ...r, turnTimeout: { ...evidence, outcome: "completed" } };
    if (r.status === "failed" && TIMEOUT_KEEPS.has(r.errorCategory)) return { ...r, turnTimeout: { ...evidence, outcome: r.errorCategory } };
    return { ...r, status: "failed", errorCategory: "turn_timeout", preInference: !reached,
      error: reached ? `Tura a depășit limita de ${fmtLimit(d.limitMs)} pe tură; procesul providerului a fost oprit (încercarea a ajuns la model)`
        : `Providerul nu a trimis tura modelului în limita de ${fmtLimit(d.limitMs)}; procesul a fost oprit înainte de model (nimic nu a ajuns la model)`,
      turnTimeout: { ...evidence, outcome: "turn_timeout" } };
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

  /** Stores a provider report (and, for an overage signal, the reverify latch) in settings.billingEvidence. Never throws into the stream. */
  function recordBillingEvidence(runId, event) {
    try {
      const run = getRun(runId);
      const provider = run?.provider;
      if (provider !== "claude" && provider !== "codex") return;
      const environment = run.environment || "windows";
      const now = clock();
      const state = providerState ? providerState.get(environment === "windows" ? provider : `${provider}@${environment}`) : null;
      const identity = inspectionFromState(state, now)?.auth?.accountIdentity || null;
      const report = buildProviderReport({ id: newId("bpr"), provider, source: event.report?.source || "provider", snapshot: event.report || {}, identity, now, runId, signals: Array.isArray(event.signals) ? event.signals : [] });
      const latch = event.reverify === true && event.reason === "provider_report_overage";
      bus.transaction(() => {
        let next = appendReport(settings.get("billingEvidence"), provider, report);
        if (latch) next = applyLatch(next, provider, { reason: "provider_report_overage", now, by: `run:${runId}` });
        settings.set("billingEvidence", next, "provider", latch ? `Provider reported overage for ${provider}; re-declaration required` : `Provider billing report recorded for ${provider}`);
        bus.append({ type: latch ? "billing.reverify_required" : "billing.provider_report", scopeType: "provider", scopeId: provider, source: "provider", runId,
          payload: { provider, environment, reason: latch ? "provider_report_overage" : null, signals: report.signals, status: report.fields.status || null, errorCode: report.fields.errorCode || null, reportId: report.id } });
      });
    } catch (error) {
      try { bus.emit({ type: "billing.report_failed", scopeType: "provider", scopeId: "billing", source: "hub", runId, payload: { error: String(error?.message || error).slice(0, 300) } }); } catch { /* never breaks the run */ }
    }
  }

  function onProviderEvent(runId, conversationId, event, appendText) {
    if (detached) return;
    const now = clock().toISOString();
    db.prepare("UPDATE agent_runs SET last_event_at = ? WHERE id = ?").run(now, runId);
    // Observable phase only (no progress is inferred): waiting for the provider until the first output arrives.
    const entry = active.get(runId);
    if (entry) { entry.lastEventAt = now; if (event.type === "delta" && !entry.firstOutputAt) entry.firstOutputAt = now; }
    if (entry?.timeline?.has("turn_sent") && event.type === "notice") {
      entry.noticesAfterTurnSent += 1;
      if (event.subtype === "api_retry" || /^Claude API retry \d+\/\d+:/u.test(event.text || "")) entry.apiRetriesAfterTurnSent += 1;
    }
    if (event.type === "phase") {
      markPhase(runId, event.phase, event.at || null);
      // 2.12.2 (P0-R3): the turn reached the model: its deadline restarts once, with the full limit from now.
      if (event.phase === "turn_sent") armTurnDeadline(runId, "turn");
      return;
    }
    // Review R3-F5: an adapter that says its provider's turn has settled (the work after it — an environment's reap and export — is
    // not the turn) ends the turn's deadline at once. Never a run status of its own.
    if (event.type === "turn_settled") { if (entry) clearTurnDeadline(entry, "turn_settled"); return; }
    // An environment adapter starts its provider process after the workspace is ready: its pid arrives as an event.
    if (event.type === "pid") { db.prepare("UPDATE agent_runs SET pid = ?, pid_started_at = ? WHERE id = ?").run(event.pid || null, now, runId); markPhase(runId, "process_spawned"); return; }
    if (entry?.timeline?.has("turn_acknowledged") && event.type !== "usage") markPhase(runId, "first_event");
    if (event.type === "delta") {
      markPhase(runId, "first_output");
      appendText(event.text);
      live.publish({ type: "run.delta", conversationId, runId, text: event.text });
      return;
    }
    if (event.type === "session") {
      db.prepare("UPDATE agent_runs SET native_thread_id = ?, provider_session_id = COALESCE(provider_session_id, ?) WHERE id = ?").run(event.nativeSessionId || null, event.nativeSessionId || null, runId);
      // What the provider reported for this thread, next to what the Hub sent (the adapters stop the run on a mismatch). M09: the
      // record's model is never back-filled from the report (a run with no explicit model used to look explicit afterwards);
      // the report is kept as `verified` = { value, matched, at } beside the requested and sent values.
      const row = db.prepare("SELECT provider, plan_json FROM agent_runs WHERE id = ?").get(runId);
      const plan = parse(row?.plan_json, {});
      const value = event.model ? String(event.model).slice(0, 80) : null;
      const source = row?.provider === "codex" ? "thread/start" : "init";
      db.prepare("UPDATE agent_runs SET plan_json = ? WHERE id = ?").run(json({ ...plan, reported: { model: value,
        effort: event.reasoningEffort ? String(event.reasoningEffort).slice(0, 20) : null, source },
        verified: { value, matched: modelMatches(row?.provider, plan, value), at: now, source } }), runId);
    }
    // M09: the Claude adapter stopped at init because the reported model is outside the bound one (no session event follows).
    if (event.type === "model_verified") {
      const plan = parse(db.prepare("SELECT plan_json FROM agent_runs WHERE id = ?").get(runId)?.plan_json, {});
      db.prepare("UPDATE agent_runs SET plan_json = ? WHERE id = ?").run(json({ ...plan, verified: { value: event.value ? String(event.value).slice(0, 80) : null, matched: Boolean(event.matched),
        reason: event.reason ? String(event.reason).slice(0, 300) : null, at: now, source: "init" } }), runId);
    }
    // M09-A2: a provider report about the plan (Claude rate_limit_event with credit fields). Recorded as billing evidence; an
    // explicit overage signal latches the reverify in the same transaction (the adapter already stopped the run).
    if (event.type === "billing_evidence") { recordBillingEvidence(runId, event); return; }
    if (event.type === "turn") db.prepare("UPDATE agent_runs SET native_turn_id = ? WHERE id = ?").run(event.turnId || null, runId);
    if (event.type === "usage") {
      db.prepare("UPDATE agent_runs SET usage_json = ? WHERE id = ?").run(json(event.usage), runId);
      if (event.usage?.rateLimits) usage.record(getRun(runId).provider, event.usage.rateLimits);
    }
    const persisted = ["session", "turn", "activity", "notice", "plan", "auth", "model_verified"].includes(event.type);
    if (persisted) {
      bus.emit({ type: `run.${event.type}`, scopeType: "conversation", scopeId: conversationId, source: "provider", runId,
        payload: event.type === "activity" ? { label: redactText(event.label) } : event.type === "notice" ? { level: event.level, text: redactText(event.text) } : event });
    } else {
      live.publish({ type: `run.${event.type}`, conversationId, runId, data: event.type === "diff" ? { length: event.diff.length } : event });
    }
  }

  async function waitForApproval({ runId, conversation, project, provider, request, taskId }) {
    if (closed || detached) return "decline";
    const payload = request.kind === "command" ? { command: request.command, cwd: request.cwd, reason: request.reason } : { changes: request.changes, reason: request.reason };
    const actionKind = `provider.${request.kind}`;
    // 2.12.2 (P0-R1, LR-06): a provider callback arriving after its run ended (finalized) or after a Stop All interrupted it never brings
    // the run back: no approval card, no waiting_approval status, no task transition — declined at once.
    if (!active.has(runId) || stoppedRuns.has(runId)) return "decline";
    // 2.12.2 (P0-R3): nor after its turn ran out of time (the deadline fired; the turn is being interrupted).
    if (active.get(runId)?.turnDeadline?.fired) return "decline";
    // M10.2 (U11): a run admitted by a confirmed plan (its grant was derived from an envelope) never asks mid-plan. Under the
    // workspace-write profile Codex asks only to go BEYOND it (unsandboxed, outside the workspace, network); the plan the owner
    // confirmed is the boundary, so the request is declined at once — on the Windows route too, as the execution environments do —
    // with a notice on the run, no approval card and no task scope granted. The step then fails or under-delivers, which becomes
    // a finding, a repair inside the plan or an owner decision: safer than an implicit widening or a card the owner did not expect.
    const planRun = getRun(runId);
    const planGrant = planRun?.grantId ? grants.get(planRun.grantId) : null;
    if (planGrant?.envelopeId) {
      const what = request.kind === "command" ? `comanda ${JSON.stringify(request.command || "").slice(0, 120)}` : "o modificare de fișiere";
      bus.transaction(() => {
        bus.append({ type: "run.notice", scopeType: "conversation", scopeId: conversation.id, source: "hub", runId,
          payload: { level: "warning", text: redactText(`${provider} a cerut aprobare pentru ${what} dincolo de profilul planului ${planGrant.envelopeId}${request.reason ? ` (${String(request.reason).slice(0, 120)})` : ""}; refuzat automat (planul confirmat e limita)`) } });
        bus.append({ type: "approval.plan_declined", scopeType: "run", scopeId: runId, source: "policy", runId, projectId: project.id, payload: { actionKind, envelopeId: planGrant.envelopeId } });
      });
      return "decline";
    }
    // Hub approval policy first; a provider/vendor approval prompt never replaces it.
    const runEnv = planRun?.environment || "windows";
    const policyDecision = deps.policy ? deps.policy.evaluate({ actionKind, surfaceId: surfaceOf(provider, runEnv) || "*", projectId: project.id, taskId, target: project.path }) : { decision: "ask" };
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
    if (closed || detached) return "decline";
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
          const policyNow = deps.policy.evaluate({ actionKind: approval.actionKind, surfaceId: surfaceOf(run.provider, run.environment) || "*", projectId: projects.get(conversations.get(run.conversationId)?.projectId)?.id || "*", taskId: run.taskId, target: approval.target });
          if (policyNow.policy === "ASK_ONCE_FOR_TASK") {
            bus.transaction(() => deps.policy.grantTaskScope({ taskId: run.taskId, actionKind: approval.actionKind, target: approval.target, surfaceId: surfaceOf(run.provider, run.environment) || "*", approvalId }));
          }
        }
        resolve("accept");
      } catch { resolve("decline"); }
    } else resolve("decline");
    return true;
  }

  function finalize(runId, result, getContent) {
    if (detached) return;
    const entry = active.get(runId);
    // 2.12.2 (P0-R3): the turn's deadline ends with the run; one that fired makes the outcome a timeout (turnTimeoutOutcome).
    const firedDeadline = settleTurnDeadline(entry);
    const turnDeadline = turnDeadlineEvidence(entry);
    if (firedDeadline) result = turnTimeoutOutcome(result, firedDeadline, entry);
    const run = getRun(runId);
    if (!run || !["running", "waiting_approval", "starting"].includes(run.status)) { active.delete(runId); stoppedRuns.delete(runId); return; }
    const content = result.output || getContent() || "";
    const pre = Boolean(result.preInference) || PRE_INFERENCE_CATEGORIES.has(result.errorCategory);
    const status = result.status === "completed" ? "completed" : result.status === "interrupted" ? "interrupted" : pre ? "blocked" : "failed";
    const record = entry ? deps.supervisorRecord?.(entry.handle.key) : null;
    // An environment run also needs its in-distro processes confirmed gone (reap); otherwise the lease is retained.
    const processGone = (!record || (record.exited && !record.treeUnverified)) && result.environment?.reap?.ok !== false;
    if (entry?.timeline) entry.timeline.mark("finished");
    const turnSent = Boolean(entry?.timeline?.has("turn_sent"));
    bus.transaction(() => {
      if (entry?.timeline) db.prepare("UPDATE agent_runs SET timeline_json = ? WHERE id = ?").run(json(entry.timeline.toJSON()), runId);
      db.prepare(`UPDATE agent_runs SET status = ?, error_category = ?, error_message = ?, pre_inference = ?, finished_at = ?, native_thread_id = COALESCE(native_thread_id, ?),
        native_turn_id = COALESCE(native_turn_id, ?), usage_json = ?, evidence_json = ? WHERE id = ?`)
        .run(status, result.errorCategory || null, result.error ? redactText(String(result.error)).slice(0, 2000) : null, pre ? 1 : 0, clock().toISOString(),
          result.threadId || result.sessionId || null, result.turnId || null, json(result.usage || run.usage), json({ ...run.evidence, permissionDenials: result.permissionDenials, numTurns: result.numTurns, promptPackage: entry?.promptPackage, ...(result.environment ? { environment: result.environment } : {}),
          ...(result.authorOutputLimit ? { authorOutputLimit: result.authorOutputLimit } : {}),
          ...(turnDeadline ? { turnDeadline } : {}),
          ...(result.turnTimeout ? { turnTimeout: result.turnTimeout } : {}) }), runId);
      if (turnDeadline) bus.append({ type: "run.turn_deadline", scopeType: "conversation", scopeId: run.conversationId, source: "hub", runId, payload: turnDeadline });
      if (entry?.outputMessageId) {
        conversations.finalize(entry.outputMessageId, { content: content || (result.error ? `Run ${status}: ${redactText(String(result.error))}` : ""), status: status === "completed" ? "final" : status,
          metadata: { runStatus: status, errorCategory: result.errorCategory || null, preInference: pre } });
      }
      const nativeId = result.threadId || result.sessionId;
      // Environment threads are not resumed (each run gets a fresh workspace), so they are never offered to a later run.
      if (nativeId && (status === "completed" || status === "interrupted") && (entry?.environment || "windows") === "windows") conversations.upsertProviderSession(run.conversationId, run.provider, nativeId, runId, surfaceOf(run.provider));
      if (entry?.leaseId) {
        if (processGone) leases.release(entry.leaseId, `run ${status}`);
        // 2.12.2 (P0-R1): the reconciler (runtime/lease-reconcile.mjs) follows lease.retained and releases the lease once the process
        // is provably gone; the supervisor key tells it which process to watch. Nothing here waits for it.
        else leases.retain(entry.leaseId, "provider process did not confirm exit", { processKey: entry.handle?.key || null, environment: entry.environment || "windows" });
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
    // Keep the entry through the transaction: a rolled-back finalize retries with the same
    // conversation, lease and deadline evidence, rather than abandoning an unfinished message.
    active.delete(runId);
    stoppedRuns.delete(runId);
    breakers.record(run.provider, status === "completed" ? null : result.errorCategory || null);
    // A start that stopped before any turn reached the model (policy/MCP/model/effort checks, auth, quota) gives its grant
    // attempt back; the evidence is the timeline (no turn_sent) plus the pre-inference flag. An uncertain outcome never does.
    if (run.grantId && pre && !turnSent && status !== "completed") refundPreInference(run.grantId, `${runId} stopped before inference (${result.errorCategory || status})`);
  }

  async function interrupt(runId, reason = "user") {
    const entry = active.get(runId);
    if (!entry) throw new HubError("conflict", "Run is not active in this Hub process");
    // 2.12.2 (P0-R3): an interruption (Pause, Stop, „Oprește”, a plan's own pause) ends the turn's deadline first: no timeout after it.
    clearTurnDeadline(entry, reason);
    return entry.handle.interrupt(reason);
  }

  /**
   * 2.12.2 (P0-R1, LR-03): after Stop All, a Windows run whose provider process is provably gone but whose turn never settled (its final
   * answer was lost) would keep its slot and its lease for good — the rearm card waits for it (RUNS_ACTIVE). A bounded follow-up
   * (timers only: nothing in Stop All's path waits for it) ends such a run as interrupted, as its adapter would have: an uncertain
   * outcome (no grant refund), the lease released (or retained when the process is not provably gone), nothing retried or relaunched.
   * A run whose process still runs is left to its own turn, and so is an environment run (its reap and export outlive the process).
   */
  const LOST_TURN_CHECKS_MS = [3000, 30000];
  const stoppedRuns = new Set(); // runs a Stop All interrupted: a provider callback arriving afterwards never asks the owner again
  const pidAlive = (pid) => { if (!Number.isInteger(pid) || pid <= 0) return false; try { process.kill(pid, 0); return true; } catch (error) { return error?.code === "EPERM"; } };
  function settleLostTurn(runId) {
    const entry = active.get(runId);
    if (!entry || (entry.environment || "windows") !== "windows") return false;
    const record = deps.supervisorRecord?.(entry.handle?.key) || null;
    if (record ? !record.exited : pidAlive(Number(entry.handle?.pid) || 0)) return false;
    const sofar = entry.outputMessageId ? db.prepare("SELECT content FROM messages WHERE id = ?").get(entry.outputMessageId)?.content || "" : "";
    finalize(runId, { status: "interrupted", errorCategory: null, preInference: false, output: sofar,
      error: "interrupted (stop-all): procesul providerului s-a oprit, dar răspunsul lui final nu a mai sosit" }, () => sofar);
    return true;
  }
  function scheduleLostTurnChecks(runIds) {
    if (!runIds.length) return;
    for (const ms of LOST_TURN_CHECKS_MS) {
      const timer = setTimeout(() => { for (const id of runIds) { try { settleLostTurn(id); } catch { /* the database is closing */ } } }, ms);
      timer.unref?.();
    }
  }

  /**
   * Stop All: no new work (gate suspended, grants revoked), interrupt every controllable run. M10.2.1 (D17): `origin` records who
   * stopped — { kind: stop_all | shutdown | security, channel, actor, credential (hash prefix), sessionId, deviceId } — in
   * executionGate.suspendedBy (precedence: a weaker kind keeps a stronger record). Without it the record says only the actor.
   * 2.12.1: every start still being admitted is refused before its model (the stop epoch, AS-01); `alsoStop` (the system.stop_all
   * command, the shutdown) stops what lives outside this manager — the desktop operator, the operation plans — and returns what it
   * stopped; that and the missions the factory cancelled are recorded in the system.stop_all event (payload.scope, D22), so a later
   * resume can tell work THIS stop stopped (held until the rearm, owner/stop-scope.mjs) from work paused for another reason.
   */
  async function stopAll(actor = "user", reason = "Stop All", origin = null, { alsoStop = null } = {}) {
    stopEpoch += 1;
    const admitting = starting.size;
    // The voice session ends first (the browser is told to close its microphone at once), in parallel with the run
    // interrupts; starting it before the grant revocation keeps "stop-all" as its recorded reason.
    const voicePromise = voice ? voice.stopAll("stop-all").catch((error) => ({ error: error.message })) : null;
    const o = origin && typeof origin === "object" ? origin : {};
    // Review R4-F8 (2.12.2): the kind THIS stop asked for (the Hub's shutdown passes "shutdown"; anything unknown is a Stop All). The
    // suspension record may keep a stronger one (precedence), so the system.stop_all event carries both: `kind` (the record's) and
    // `stopKind` (this stop's own) — the probe and „ieri am spus oprește tot” read stopKind, never a shutdown as the owner's Stop All.
    const stopKind = STOP_KINDS.has(o.kind) ? o.kind : "stop_all";
    let suspension = null;
    bus.transaction(() => {
      const at = clock().toISOString();
      suspension = nextSuspension(settings.get("executionGate"), { kind: stopKind, at,
        channel: o.channel || (actor === "system" ? "system" : null), actor: o.actor || actor, credential: o.credential || null, sessionId: o.sessionId || null, deviceId: o.deviceId || null });
      settings.set("executionGate", { status: "suspended", reason, changedAt: at, changedBy: actor, suspendedBy: suspension }, actor, reason);
      grants.revokeAll(actor, reason);
      deps.policy?.revokeTaskScopes(null, reason, actor);
    });
    // 2.12.2 (P0-R1), after the suspension and the revocation: the runs this stop interrupts are marked (a late provider callback — an
    // approval request — never brings them back) and given the lost-turn follow-up. Timers only; never awaited here.
    try {
      const stopping = [...active.keys()];
      for (const id of stopping) stoppedRuns.add(id);
      scheduleLostTurnChecks(stopping);
    } catch { /* never in the way of the stop */ }
    // 2.12.2 (P0-R3): no turn deadline fires after Stop All (the interruptions below are the stop's own, never a timeout). Synchronous.
    try { for (const entry of active.values()) clearTurnDeadline(entry, "stop-all"); } catch { /* never in the way of the stop */ }
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
    if (detached) return { interrupted, voiceSession, factoryMissions, shutdown: true };
    // What lives outside the run manager (desktop operator, operation plans): stopped by the caller's hook, its ids recorded below.
    let others = null;
    if (typeof alsoStop === "function") {
      try { others = await alsoStop(); } catch (error) { others = { error: String(error?.message || error).slice(0, 300) }; }
    }
    const scope = stopScopeRecord({ missions: (Array.isArray(factoryMissions) ? factoryMissions : []).map((m) => m?.missionId).filter(Boolean),
      plansPaused: others?.plansPaused, plansInterrupted: others?.plansInterrupted, desktopSessionId: others?.desktopSessionId });
    bus.emit({ type: "system.stop_all", scopeType: "system", scopeId: "hub", source: actor, payload: { reason, interrupted: interrupted.length, voiceStopped: Boolean(voiceSession), factoryMissions: factoryMissions.length,
      suspensionId: suspension?.id || null, kind: suspension?.kind || null, stopKind, admissionsStopped: admitting, scope } });
    return { gate: "suspended", suspensionId: suspension?.id || null, interrupted, voiceSession, factoryMissions, admissionsStopped: admitting, scope, cloudTasksUnconfirmed: [], irreversibleEffects: [],
      note: "No cloud tasks or external effects are started by this Hub build; only local provider processes were interrupted." };
  }

  const activeRuns = () => [...active.entries()].map(([runId, entry]) => ({ runId, provider: entry.provider, environment: entry.environment || "windows", conversationId: entry.conversationId, pid: entry.handle.pid, taskId: entry.taskId || null,
    startedAt: entry.startedAt || null, lastEventAt: entry.lastEventAt || null, firstOutputAt: entry.firstOutputAt || null, phase: entry.firstOutputAt ? "streaming" : "waiting_provider",
    timeline: entry.timeline ? entry.timeline.toJSON() : {},
    // 2.12.2 (P0-R3): when this turn is cut (null: no limit, or an interruption already cleared it).
    turnDeadline: entry.turnDeadline && !entry.turnDeadline.cleared ? { at: entry.turnDeadline.deadlineAt, phase: entry.turnDeadline.phase, limitMs: entry.turnDeadline.limitMs, fired: entry.turnDeadline.fired } : null }));
  /**
   * M09: the route and provider facts a run of `provider` on this project would use NOW (the same route and state key start()
   * uses), so a binding is resolved against the installation that will run it.
   */
  const bindingContext = (projectId, provider) => {
    const environment = routeOf(projectId, provider);
    const stateKey = environment === "windows" ? provider : `${provider}@${environment}`;
    return { environment, stateKey, providerState: providerState?.get(stateKey) || null };
  };
  return { start, close, drain, settle, detach, interrupt, stopAll, resolveApproval, getRun, listRuns, activeRuns, activeCount: () => active.size + starting.size,
    // 2.12.1 (AS-01): starts still being admitted (backup / git state); the rearm card waits for them (RUNS_ACTIVE).
    admittingCount: () => starting.size, rowToRun, attachVoice: (v) => { voice = v; }, attachFactory: (f) => { factory = f; },
    timelineOf: (runId) => summarizeTimeline(getRun(runId)?.timeline || {}), refundPreInference, bindingContext };
}
