import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { HubError } from "../core/errors.mjs";
import { validate } from "../core/validate.mjs";
import { redactDeep, redactText } from "../security/redact.mjs";
import { evaluateRoute, scanEnvironment, ATTESTATION_TEXT, BILLING_POLICY } from "../policy/billing.mjs";
import { TASK_STATES } from "../runtime/state-machine.mjs";
import { describeLifecycles } from "../runtime/lifecycles.mjs";
import { inspectionFromState } from "../policy/gate.mjs";
import { resolveRunPlan } from "../policy/run-plan.mjs";
import { evaluateIsolation, evaluateHostIsolation, CODEX_ACL_CONSENT_TEXT, CODEX_PROFILE_BY_ACCESS, R2_ACCEPT_TEXT, R2_MAX_ACCEPT_DAYS } from "../policy/isolation.mjs";
import { LEGA_CONSENT_TEXT, LEGA_CONSENT_VERSION, LEGA_VOICES, LEGA_COST_PER_MINUTE_USD, LEGA_DEFAULTS } from "../policy/lega-policy.mjs";
import { MISSION_TEMPLATES } from "../domain/missions.mjs";
import { MEMORY_SCOPES, MEMORY_TYPES, MEMORY_SOURCES } from "../domain/memory.mjs";
import { LEAD_STATUSES } from "../domain/leads.mjs";
import { SCHEDULE_BACKENDS } from "../domain/schedules.mjs";
import { SCHEDULE_COMMANDS } from "../runtime/command-catalog.mjs";
import { readEcosystemConfig } from "../domain/surfaces.mjs";
import { buildBriefing, briefingMarkdown } from "../domain/briefing.mjs";
import { planImport, readLegacyTable } from "../storage/v1-import.mjs";
import { gitState } from "../tools/git.mjs";
import { HUB_VERSION } from "../config.mjs";

const execFileAsync = promisify(execFile);
const redactMessage = (m) => ({ ...m, content: redactText(m.content) });
const ECOSYSTEM_FILES = new Set(["openai", "anthropic", "standards", "matrix", "frameworks", "surfaces", "routing", "computer", "integrations", "ownership", "systems"]);
/** A live-stream client that stops reading is cut off once this much waits in memory (it reconnects and replays). */
const SSE_MAX_BUFFERED_BYTES = 4 * 1024 * 1024;

/**
 * HTTP adapter. Reads come straight from the modules; every state change is dispatched as a command
 * (channel "ui") so it is validated, policy-checked, logged and evented in one place.
 */
export function registerRoutes(router, hub, { token }) {
  // Open SSE responses: the simulator can drop them to demonstrate reconnect + replay (Last-Event-ID).
  const openStreams = new Set();
  hub.dropStreams = () => { const n = openStreams.size; for (const res of openStreams) { try { res.end(); } catch { /* gone */ } } openStreams.clear(); return n; };
  const { db, bus, settings, projects, conversations, missions, approvals, leases, grants, providerState, usage, memory, leads, backups,
    providers, gate, runs, handoffs, tools, supervisor, config, commands, company, chiefOfStaff, surfaces, schedules, computer, skills,
    checkpoints, artifacts, integrations, nativeSessions, telemetry, policy } = hub;
  const clock = config.now;
  const get = (p, h) => router.add("GET", p, h);
  const post = (p, h, o) => router.add("POST", p, h, o);
  const patch = (p, h) => router.add("PATCH", p, h);
  const del = (p, h) => router.add("DELETE", p, h);
  const need = (value, what) => { if (!value) throw new HubError("not_found", `${what} not found`); return value; };

  /** Dispatches a command from the UI; 202 when it waits for an approval, 201 for creations. */
  async function dispatch(req, type, payload, { created = false } = {}) {
    const result = await commands.dispatch({ type, payload, actor: "user", channel: "ui", idempotencyKey: req.headers["idempotency-key"] || null });
    if (result.approvalRequired) return { __status: 202, body: { approvalRequired: true, approval: result.approval, commandId: result.command.id } };
    return created ? { __status: 201, body: result.result } : result.result;
  }
  const cmd = (type, map = ({ body }) => body, options) => (ctx) => dispatch(ctx.req, type, map(ctx), options);

  // ---------- session, health, state ----------
  get("/api/health", () => ({ ok: true, version: HUB_VERSION, bootId: hub.bootId, mode: settings.get("mode"), gate: settings.get("executionGate").status, time: clock().toISOString(), simulation: Boolean(config.simulation) }));

  // ---------- simulator (only inside a simulation process; the real Hub answers 404) ----------
  get("/api/sim", () => {
    if (!config.simulation || !hub.simulation) throw new HubError("not_found", "Not a simulation process");
    return { banner: hub.simulation.banner, actions: hub.simulation.actions };
  });
  post("/api/sim/:action", async ({ params }) => {
    if (!config.simulation || !hub.simulation) throw new HubError("not_found", "Not a simulation process");
    return hub.simulation.action(params.action);
  });
  get("/api/session", ({ req }) => {
    const site = req.headers["sec-fetch-site"];
    if (site && !["same-origin", "same-site", "none"].includes(site)) throw new HubError("policy", "Cross-site session request refused");
    return { token, bootId: hub.bootId, version: HUB_VERSION };
  });

  get("/api/state", async () => {
    const hubProject = projects.hub();
    const pending = approvals.list("pending");
    const activeMissions = missions.list().filter((m) => !["COMPLETED", "CANCELLED", "FAILED"].includes(m.status)).slice(0, 8)
      .map((m) => ({ ...m, progress: missions.progress(m.id) }));
    const blockedTasks = missions.allTasks().filter((t) => ["BLOCKED", "FAILED", "WAITING_PROVIDER", "WAITING_APPROVAL"].includes(t.status)).slice(0, 12);
    const surfaceList = surfaces.list();
    return {
      version: HUB_VERSION, bootId: hub.bootId, mode: settings.get("mode"), executionGate: settings.get("executionGate"),
      activeRuns: runs.activeRuns(), pendingApprovals: pending.length, approvals: pending.slice(0, 6),
      missions: activeMissions, blockedTasks, leases: leases.list(),
      providers: ["codex", "claude"].map((id) => providerSummary(id)),
      usage: usage.overview(), backup: hubProject ? backups.freshVerified(hubProject.id) : null,
      legacy: settings.get("legacyImport"), processes: supervisor.list(), boot: hub.getBootReport(),
      breakers: { codex: hub.breakers.state("codex"), claude: hub.breakers.state("claude") },
      lastSeq: bus.lastSeq(), voiceSettings: settings.get("voice"), lega: hub.lega.state(),
      verifyingTasks: db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE status = 'VERIFYING'").get().n,
      backupRunning: db.prepare("SELECT COUNT(*) AS n FROM backups WHERE status = 'running'").get().n,
      recentFailures: db.prepare("SELECT id, provider, error_category AS category, error_message AS message, pre_inference AS preInference, created_at AS createdAt FROM agent_runs WHERE (status IN ('failed','interrupted_unknown','orphaned') OR (status = 'blocked' AND COALESCE(error_category, '') <> 'gate')) AND created_at >= ? ORDER BY created_at DESC LIMIT 5")
        .all(new Date(clock().getTime() - 30 * 60000).toISOString()),
      company: { name: company.company()?.name, activeDepartments: company.departments().filter((d) => d.status === "active").length,
        openGoals: db.prepare("SELECT COUNT(*) AS n FROM goals WHERE status NOT IN ('ACHIEVED','ABANDONED')").get().n,
        // Configured structure (not work done): departments and roles; runs are counted separately.
        departments: company.departments().map((d) => ({ key: d.key, name: d.name, status: d.status, roles: hub.roleConfig.roles.filter((r) => r.department === d.key).length })),
        roles: hub.roleConfig.roles.length },
      simulation: Boolean(config.simulation), serverTime: clock().toISOString(),
      // "Unde continui?": latest conversations and the latest finished runs (results), newest first.
      recentConversations: db.prepare(`SELECT c.id, c.title, c.status, c.writer_provider AS writerProvider, c.active_mission_id AS missionId, c.updated_at AS updatedAt, p.name AS projectName
        FROM conversations c LEFT JOIN projects p ON p.id = c.project_id ORDER BY c.updated_at DESC LIMIT 6`).all(),
      recentResults: db.prepare(`SELECT id, provider, status, stage, model, conversation_id AS conversationId, task_id AS taskId, error_category AS errorCategory, pre_inference AS preInference,
        finished_at AS finishedAt, created_at AS createdAt FROM agent_runs WHERE status IN ('completed','failed','interrupted','blocked') ORDER BY COALESCE(finished_at, created_at) DESC LIMIT 6`).all(),
      surfaces: { total: surfaceList.length, available: surfaceList.filter((s) => s.availability === "available").length, assisted: surfaceList.filter((s) => s.availability === "assisted").length },
      schedules: { active: db.prepare("SELECT COUNT(*) AS n FROM schedules WHERE status = 'ACTIVE'").get().n },
      nativeSessions: db.prepare("SELECT COUNT(*) AS n FROM native_sessions WHERE status <> 'ended'").get().n,
      counts: {
        conversations: db.prepare("SELECT COUNT(*) AS n FROM conversations").get().n,
        missions: db.prepare("SELECT COUNT(*) AS n FROM missions").get().n,
        memory: db.prepare("SELECT COUNT(*) AS n FROM memory_items WHERE status = 'active'").get().n,
      },
    };
  });

  function providerSummary(id) {
    const state = providerState.get(id);
    const inspection = inspectionFromState(state, clock());
    const route = evaluateRoute(id, inspection, { attestations: settings.get("billingAttestations"), now: clock(), usage: inspection?.usage || null, reservePercent: settings.get("usageReservePercent") });
    return { id, displayName: providers[id].displayName, installation: state?.installation || null, auth: state?.auth || null, probedAt: state?.probedAt || null,
      probeOk: state?.ok ?? null, probeError: state?.error || null, models: Array.isArray(state?.models) ? state.models : null, route };
  }

  // ---------- events: replay + SSE ----------
  get("/api/events", ({ query }) => ({ events: bus.since(Number(query.after) || 0, Math.min(1000, Number(query.limit) || 300)), lastSeq: bus.lastSeq() }));
  get("/api/events/query", ({ query }) => ({ events: bus.query({ typePrefix: query.type || null, taskId: query.taskId || null, correlationId: query.correlationId || null,
    runId: query.runId || null, limit: Number(query.limit) || 300 }) }));

  get("/api/stream", ({ req, res, query }) => {
    res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    let lastSent = Number(req.headers["last-event-id"] || query.after || 0);
    openStreams.add(res);
    let closed = false;
    let draining = false;
    // Backpressure: persisted events pause until the socket drains and then continue (they stay in SQLite meanwhile).
    // Only a client that stops reading altogether is cut off, once 4 MB wait in memory; it reconnects with ?after and
    // replays. Closing at the first full buffer (~16 KB) made a client behind by a few hundred events crawl through
    // reconnect backoffs (review 2026-09-30).
    const write = (text) => {
      if (closed || res.writableEnded || res.destroyed) { closed = true; return false; }
      res.write(text);
      if (res.writableLength > SSE_MAX_BUFFERED_BYTES) { res.end(); closed = true; return false; }
      return res.writableLength < res.writableHighWaterMark;
    };
    // Drains the whole backlog in batches of 500, pausing on backpressure, so a reconnect far behind catches up at once
    // instead of waiting for the next event to be appended.
    const flushPersisted = () => {
      if (draining || closed) return;
      for (;;) {
        const batch = bus.since(lastSent, 500);
        for (const event of batch) {
          const ok = write(`id: ${event.seq}\nevent: hub\ndata: ${JSON.stringify(event)}\n\n`);
          if (closed) return;
          lastSent = event.seq;
          if (!ok) { draining = true; res.once("drain", () => { draining = false; flushPersisted(); }); return; }
        }
        if (batch.length < 500) return;
      }
    };
    write(`retry: 2000\nevent: hello\ndata: ${JSON.stringify({ lastSeq: bus.lastSeq(), bootId: hub.bootId })}\n\n`);
    flushPersisted();
    const offBus = bus.subscribe((event) => { if (event.seq > lastSent) flushPersisted(); });
    const offLive = hub.live.subscribe((event) => write(`event: live\ndata: ${JSON.stringify(event)}\n\n`));
    const ping = setInterval(() => write(": ping\n\n"), 20000);
    req.on("close", () => { closed = true; openStreams.delete(res); offBus(); offLive(); clearInterval(ping); });
    return undefined;
  });

  // ---------- commands (generic) ----------
  get("/api/commands", ({ query }) => ({ commands: commands.list({ limit: Number(query.limit) || 100, type: query.type || null, status: query.status || null }) }));
  get("/api/commands/catalog", () => ({ commands: commands.catalog(), channels: ["ui", "voice", "automation", "schedule", "companion"], scheduleCommands: [...SCHEDULE_COMMANDS] }));
  post("/api/commands", async ({ req, body }) => {
    const input = validate(body, { type: { required: true, max: 80 }, payload: { type: "object", default: {} }, intentText: { max: 2000 } });
    if (!commands.has(input.type)) throw new HubError("validation", `Unknown command ${input.type}`);
    const result = await commands.dispatch({ type: input.type, payload: input.payload, intentText: input.intentText || "", actor: "user", channel: "ui", idempotencyKey: req.headers["idempotency-key"] || null });
    return result.approvalRequired ? { __status: 202, body: result } : result;
  });
  post("/api/commands/:id/execute", async ({ params }) => commands.executeApproved(params.id, "user"));

  // ---------- settings, mode, gate, stop ----------
  get("/api/settings", () => ({ settings: settings.all(), billingPolicy: BILLING_POLICY, attestationText: ATTESTATION_TEXT, environment: scanEnvironment() }));
  patch("/api/settings", async ({ req, body }) => {
    const allowed = ["voice", "usageReservePercent", "ui", "maxConcurrentAiRuns", "routingPreferences", "lega"];
    for (const key of Object.keys(body || {})) if (!allowed.includes(key)) throw new HubError("policy", `${key} cannot be changed here`);
    return { settings: await dispatch(req, "settings.update", body) };
  });
  post("/api/mode", cmd("mode.set"));
  post("/api/gate", cmd("gate.set"));
  post("/api/stop-all", cmd("system.stop_all", ({ body }) => ({ reason: body?.reason })));
  post("/api/system/shutdown", ({ body }) => {
    const active = runs.activeRuns();
    if (active.length && body?.force !== true) throw new HubError("conflict", `${active.length} run(s) active; stop them first or pass force`, { data: { active } });
    if (typeof hub.shutdown !== "function") throw new HubError("conflict", "Shutdown is not available in this process");
    setTimeout(() => hub.shutdown("api"), 100).unref?.();
    return { stopping: true, activeRunsInterrupted: active.length };
  });

  // ---------- projects & tools ----------
  get("/api/projects", () => ({ projects: projects.list() }));
  post("/api/projects/sync", cmd("projects.sync", () => ({})));
  post("/api/projects/test", cmd("project.register_test", ({ body }) => body, { created: true }));
  post("/api/projects/:id/retire-test", cmd("project.retire_test", ({ params }) => ({ projectId: params.id })));
  post("/api/projects/:id/execution/enable", cmd("project.execution.enable", ({ params, body }) => ({ projectId: params.id, confirmName: body?.confirmName })));
  post("/api/projects/:id/execution/disable", cmd("project.execution.disable", ({ params, body }) => ({ projectId: params.id, reason: body?.reason })));
  get("/api/projects/:id", async ({ params }) => {
    const project = need(projects.get(params.id), "Project");
    const readable = fs.existsSync(project.path);
    return { project, git: readable ? await gitState(project.path) : null, backups: backups.list(project.id, 10),
      conversations: conversations.list(project.id).length, missions: missions.list(project.id).length, artifacts: artifacts.list({ projectId: project.id, limit: 30 }),
      nativeSessions: nativeSessions.list().filter((s) => s.projectId === project.id),
      instructions: readable ? ["CLAUDE.md", "AGENTS.md", ".ifrim/NEXT_SESSION.md", ".ifrim/PROJECT_STATE.md", ".ifrim/OPEN_ISSUES.md", ".ifrim/PREVIEW.md"].filter((f) => fs.existsSync(path.join(project.path, f))) : [] };
  });
  get("/api/tools", () => ({ tools: tools.definitions }));
  get("/api/browser/status", () => tools.browserStatus());
  post("/api/browser/:approvalId/execute", cmd("approval.execute_browser", ({ params }) => ({ approvalId: params.approvalId })));
  get("/api/browser/evidence/:file", ({ params }) => {
    if (!/^shot_[a-z0-9_]+\.png$/i.test(params.file)) throw new HubError("validation", "Invalid evidence name");
    const file = path.join(config.dataDir, "browser-evidence", params.file);
    if (!fs.existsSync(file)) throw new HubError("not_found", "Screenshot not found");
    return { __raw: true, contentType: "image/png", body: fs.readFileSync(file) };
  });
  // Tool call history (e.g. process.run = test/build runs): time, command, exit code, duration, redacted output tail.
  get("/api/tool-calls", ({ query }) => {
    const limit = Math.min(100, Number(query.limit) || 20);
    const rows = db.prepare(`SELECT id, run_id AS runId, tool, args_json AS args, effects, status, result_json AS result, started_at AS startedAt, finished_at AS finishedAt
      FROM tool_calls WHERE (? IS NULL OR tool = ?) ORDER BY started_at DESC LIMIT ?`).all(query.tool || null, query.tool || null, limit);
    return { calls: rows.map((r) => redactDeep({ ...r, args: JSON.parse(r.args || "{}"), result: JSON.parse(r.result || "{}") })) };
  });
  post("/api/tools/:toolId", cmd("tool.invoke", ({ params, body }) => ({ toolId: params.toolId, projectId: body.projectId, args: body.args || {} })));

  // ---------- conversations & runs ----------
  get("/api/conversations", ({ query }) => {
    const names = new Map(projects.list().map((pr) => [pr.id, pr.name]));
    return { conversations: conversations.list(query.projectId || null).map((c) => ({ ...c, projectName: names.get(c.projectId) || null })) };
  });
  post("/api/conversations", cmd("conversation.create", ({ body }) => body, { created: true }));
  get("/api/conversations/:id", ({ params, query }) => {
    const conversation = need(conversations.get(params.id), "Conversation");
    return { conversation, messages: conversations.messages(conversation.id, { after: Number(query.after) || 0, limit: 1000 }).map(redactMessage),
      sessions: conversations.providerSessions(conversation.id), runs: runs.listRuns({ conversationId: conversation.id, limit: 50 }),
      attachments: conversations.attachments(conversation.id), handoffs: handoffs.list(conversation.id), project: projects.get(conversation.projectId) };
  });
  post("/api/conversations/:id/messages", async ({ req, params, body }) => {
    const result = await dispatch(req, "conversation.message", { ...body, conversationId: params.id }, { created: true });
    return result.__status ? { ...result, body: redactMessage(result.body) } : result;
  });
  post("/api/conversations/:id/attachments", cmd("conversation.attachment", ({ params, body }) => ({ ...body, conversationId: params.id }), { created: true }), { maxBytes: 15 * 1024 * 1024 });
  post("/api/conversations/:id/runs", cmd("run.start", ({ params, body }) => ({ ...body, conversationId: params.id }), { created: true }));
  get("/api/runs", ({ query }) => ({ runs: runs.listRuns({ status: query.status || null, conversationId: query.conversationId || null, taskId: query.taskId || null, limit: 200 }), active: runs.activeRuns() }));
  get("/api/runs/:id", ({ params }) => ({ run: need(runs.getRun(params.id), "Run"), events: bus.query({ runId: params.id, limit: 300 }).reverse(), telemetry: telemetry.get(params.id),
    timeline: runs.timelineOf(params.id) }));
  post("/api/runs/:id/interrupt", cmd("run.interrupt", ({ params }) => ({ runId: params.id })));

  // ---------- handoffs ----------
  post("/api/conversations/:id/handoffs", cmd("handoff.begin", ({ params, body }) => ({ ...body, conversationId: params.id }), { created: true }));
  post("/api/handoffs/:id/advance", cmd("handoff.advance", ({ params }) => ({ handoffId: params.id })));
  post("/api/handoffs/:id/cancel", cmd("handoff.cancel", ({ params }) => ({ handoffId: params.id })));
  get("/api/handoffs", () => ({ handoffs: db.prepare("SELECT id, conversation_id AS conversationId, from_provider AS fromProvider, to_provider AS toProvider, from_surface AS fromSurface, to_surface AS toSurface, status, step, package_sha256 AS packageSha256, checkpoint_id AS checkpointId, error, created_at AS createdAt, updated_at AS updatedAt FROM handoffs ORDER BY created_at DESC LIMIT 100").all() }));
  get("/api/handoffs/:id", ({ params }) => need(handoffs.get(params.id), "Handoff"));

  // ---------- Software Factory (M03) ----------
  get("/api/factory", () => ({ missions: hub.factory.list(), runner: hub.factoryRunner.readiness() }));
  get("/api/factory/:id", ({ params }) => need(hub.factory.view(params.id), "Factory mission"));
  get("/api/factory/:id/change-sets/:seq", ({ params }) => {
    const row = db.prepare("SELECT id, seq, sha256, status, changes_json, delta_json, diff_text, diff_truncated, integrity_json, created_at FROM factory_change_sets WHERE mission_id = ? AND seq = ?").get(params.id, Number(params.seq));
    const cs = need(row, "Change set");
    return { id: cs.id, seq: cs.seq, sha256: cs.sha256, status: cs.status, changes: JSON.parse(cs.changes_json), delta: JSON.parse(cs.delta_json), diff: cs.diff_text, truncated: Boolean(cs.diff_truncated),
      integrity: JSON.parse(cs.integrity_json), createdAt: cs.created_at };
  });
  post("/api/factory", cmd("factory.prepare", ({ body }) => body, { created: true }));
  post("/api/factory/:id/spec", cmd("factory.spec.revise", ({ params, body }) => ({ missionId: params.id, spec: body?.spec })));
  post("/api/factory/:id/limits", cmd("factory.limits", ({ params, body }) => ({ missionId: params.id, limits: body?.limits })));
  post("/api/factory/:id/start", cmd("factory.start", ({ params, body }) => ({ ...body, missionId: params.id })));
  post("/api/factory/:id/stop", cmd("factory.stop", ({ params, body }) => ({ missionId: params.id, reason: body?.reason })));
  post("/api/factory/:id/pause", cmd("factory.pause", ({ params }) => ({ missionId: params.id })));
  post("/api/factory/:id/resume", cmd("factory.resume", ({ params, body }) => ({ missionId: params.id, allowExtraCycle: Boolean(body?.allowExtraCycle), proceedToQa: Boolean(body?.proceedToQa), reviewerModel: String(body?.reviewerModel || "") })));
  post("/api/factory/:id/accept", cmd("factory.accept", ({ params, body }) => ({ missionId: params.id, note: body?.note || "" })));
  post("/api/factory/:id/reject", cmd("factory.reject", ({ params, body }) => ({ missionId: params.id, note: body?.note })));
  post("/api/factory/:id/findings/:code", cmd("factory.finding", ({ params, body }) => ({ missionId: params.id, code: params.code, status: body?.status, note: body?.note })));
  post("/api/isolation/r2/:projectId/accept", cmd("isolation.r2_accept", ({ params, body }) => ({ projectId: params.projectId, confirmText: body?.confirmText, days: body?.days })));
  post("/api/isolation/r2/:projectId/revoke", cmd("isolation.r2_revoke", ({ params }) => ({ projectId: params.projectId })));

  // ---------- missions & tasks ----------
  get("/api/missions", ({ query }) => ({ missions: missions.list(query.projectId || null).map((m) => ({ ...m, progress: missions.progress(m.id) })), templates: MISSION_TEMPLATES, taskStates: TASK_STATES }));
  post("/api/missions", cmd("mission.create", ({ body }) => body, { created: true }));
  get("/api/missions/:id", ({ params }) => {
    const mission = need(missions.get(params.id), "Mission");
    const taskList = missions.tasks(mission.id);
    return { mission, tasks: taskList.map((t) => ({ ...t, transitions: missions.transitions(t.id), runs: runs.listRuns({ taskId: t.id, limit: 20 }), dependenciesMet: missions.dependenciesMet(t),
        dependencies: missions.dependencyIds(t.id), route: t.routeDecisionId ? hub.router.get(t.routeDecisionId) : null })),
      progress: missions.progress(mission.id), department: mission.departmentId ? company.department(mission.departmentId) : null, goal: mission.goalId ? company.goal(mission.goalId) : null,
      events: bus.since(0, 5000).filter((e) => e.missionId === mission.id || e.scopeId === mission.id || taskList.some((t) => t.id === e.scopeId)).slice(-200) };
  });
  get("/api/tasks", ({ query }) => ({ tasks: missions.allTasks({ status: query.status, projectId: query.projectId }) }));
  post("/api/tasks/:id/command", cmd("task.command", ({ params, body }) => ({ ...body, taskId: params.id })));
  post("/api/tasks/:id/dependencies", cmd("task.add_dependency", ({ params, body }) => ({ taskId: params.id, dependsOn: body.dependsOn })));
  post("/api/tasks/:id/route", cmd("route.task", ({ params, body }) => ({ ...body, taskId: params.id })));
  post("/api/tasks/:id/assisted", cmd("assisted.prepare", ({ params, body }) => ({ taskId: params.id, surfaceId: body.surfaceId })));

  // ---------- company runtime & chief of staff ----------
  get("/api/company", () => company.overview());
  get("/api/company/org", () => company.orgChart());
  post("/api/company/departments/:key/status", cmd("company.department_status", ({ params, body }) => ({ ...body, departmentKey: params.key })));
  get("/api/goals", ({ query }) => ({ goals: company.goals({ status: query.status || null }).map((g) => ({ ...g, objectives: company.objectivesOf(g.id) })) }));
  post("/api/goals", cmd("goal.create", ({ body }) => body, { created: true }));
  get("/api/goals/:id", ({ params }) => chiefOfStaff.aggregate(params.id));
  post("/api/goals/:id/transition", cmd("goal.transition", ({ params, body }) => ({ ...body, goalId: params.id })));
  post("/api/goals/:id/objectives", cmd("objective.create", ({ params, body }) => ({ ...body, goalId: params.id }), { created: true }));
  post("/api/objectives/:id", cmd("objective.update", ({ params, body }) => ({ ...body, objectiveId: params.id })));
  post("/api/missions/:id/link", cmd("mission.link", ({ params, body }) => ({ ...body, missionId: params.id })));
  get("/api/cos/analyze", ({ query }) => chiefOfStaff.analyze({ objective: String(query.objective || ""), departmentHint: query.department || null, projectId: query.projectId || null }));
  post("/api/cos/intake", cmd("cos.intake", ({ body }) => body, { created: true }));
  post("/api/cos/apply", cmd("cos.apply_plan", ({ body }) => body, { created: true }));
  get("/api/cos/overview", () => ({ priorities: chiefOfStaff.priorities(), blockers: chiefOfStaff.blockers(), escalations: chiefOfStaff.escalations() }));

  // ---------- agents, skills ----------
  get("/api/agents", () => ({ roles: hub.roleConfig.roles, principles: hub.roleConfig.principles, activeRuns: runs.activeRuns(),
    recentRuns: runs.listRuns({ limit: 40 }), providers: ["codex", "claude"].map((id) => providerSummary(id)), org: company.orgChart() }));
  get("/api/skills", () => ({ skills: skills.list(), directory: path.relative(config.hubRoot, skills.dir), format: "Agent Skills (SKILL.md)",
    proposals: db.prepare("SELECT * FROM skill_proposals ORDER BY created_at DESC LIMIT 50").all() }));
  get("/api/skills/:id/versions", ({ params }) => ({ versions: skills.versions(params.id) }));
  post("/api/skills/import", cmd("skill.import", () => ({})));
  post("/api/skills/export", cmd("skill.export", ({ body }) => body));

  // ---------- approvals & policies ----------
  get("/api/approvals", ({ query }) => ({ approvals: approvals.list(query.status || null) }));
  post("/api/approvals/:id/decide", cmd("approval.decide", ({ params, body }) => ({ ...body, approvalId: params.id })));
  // Executes an approved local action; the command is chosen by the approval's action kind (script or browser check).
  post("/api/approvals/:id/execute", ({ req, params }) => {
    const approval = approvals.get(params.id);
    if (!approval) throw new HubError("not_found", "Approval not found");
    const type = approval.actionKind === "browser.inspect" ? "approval.execute_browser" : "approval.execute_script";
    return dispatch(req, type, { approvalId: params.id });
  });
  get("/api/policies", () => policy.list());
  get("/api/policies/evaluate", ({ query }) => policy.evaluate({ actionKind: String(query.actionKind || ""), surfaceId: query.surfaceId || "*", projectId: query.projectId || "*", taskId: query.taskId || null, target: query.target || "" }));
  post("/api/policies", cmd("policy.set_rule", ({ body }) => body, { created: true }));
  del("/api/policies/:id", cmd("policy.remove_rule", ({ params }) => ({ ruleId: params.id })));

  // ---------- providers, surfaces, capabilities, billing, grants, usage ----------
  get("/api/integrations", () => ({ capabilities: hub.capabilityConfig, providers: ["codex", "claude"].map((id) => providerSummary(id)),
    billingPolicy: BILLING_POLICY, attestationText: ATTESTATION_TEXT, environment: scanEnvironment(), grants: grants.list() }));
  get("/api/integrations/registry", ({ query }) => ({ integrations: integrations.list({ kind: query.kind || null }) }));
  post("/api/providers/:id/inspect", async ({ req, params }) => { await dispatch(req, "provider.inspect", { provider: params.id }); return providerSummary(params.id); });
  // model/list is inference-free and the run plan needs it (explicit model/effort): asked for unless the caller opts out.
  post("/api/providers/:id/probe", async ({ req, params, body }) => { await dispatch(req, "provider.probe", { provider: params.id, withModels: body?.withModels !== false }); return providerSummary(params.id); });
  post("/api/billing/attest", cmd("billing.attest"));
  // Workspace isolation (M02 §05): what each provider's model tools are denied, and the Codex ACL consent state.
  get("/api/isolation", () => {
    const codex = hub.codexIsolation();
    const consent = settings.get("isolationConsent") || {};
    const sandbox = inspectionFromState(providerState.get("codex"), clock())?.sandbox || null;
    const evaluate = (provider, access) => evaluateIsolation({ provider, access, sandbox: provider === "codex" ? sandbox : null, consent: consent[provider] || null, fingerprint: provider === "codex" ? codex.fingerprint : null });
    return {
      codex: { profiles: CODEX_PROFILE_BY_ACCESS, paths: codex.paths, fingerprint: codex.fingerprint, consent: consent.codex || null, consentText: CODEX_ACL_CONSENT_TEXT,
        consentCurrent: Boolean(consent.codex && consent.codex.fingerprint === codex.fingerprint), sandbox,
        reversal: 'icacls "<cale>" /remove:d CodexSandboxUsers', readOnly: evaluate("codex", "read-only"), workspaceWrite: evaluate("codex", "workspace-write") },
      claude: { readOnly: evaluate("claude", "read-only"), workspaceWrite: evaluate("claude", "workspace-write") },
      // R2 (M03): host isolation per enabled project; an acceptance is the owner's time-limited decision, never isolation.
      r2: { status: "OPEN", acceptText: R2_ACCEPT_TEXT, maxDays: R2_MAX_ACCEPT_DAYS,
        projects: projects.list().filter((p) => p.executionAllowed).map((p) => ({ id: p.id, name: p.name, source: p.source, acceptance: settings.get("r2Acceptance")?.[p.id] || null,
          codex: evaluateHostIsolation({ provider: "codex", project: p, acceptance: settings.get("r2Acceptance")?.[p.id] || null, now: clock() }) })) },
    };
  });
  // ---------- Lega (voice assistant) ----------
  // Status + gate preview for the Lega panel (the Codex config is re-read locally, key names only).
  get("/api/lega", () => {
    hub.refreshCodexConfig();
    const consent = settings.get("legaConsent") || {};
    return { session: hub.lega.state(), consent: { recorded: consent.version === LEGA_CONSENT_VERSION, confirmedAt: consent.confirmedAt || null, version: LEGA_CONSENT_VERSION },
      consentText: LEGA_CONSENT_TEXT, settings: { ...LEGA_DEFAULTS, ...(settings.get("lega") || {}) }, voices: LEGA_VOICES, costPerMinuteUsd: LEGA_COST_PER_MINUTE_USD,
      preview: gate.evaluateVoice({ voiceActive: hub.lega.active() }) };
  });
  post("/api/lega/sessions", cmd("lega.session.start", ({ body }) => body, { created: true }), { maxBytes: 80 * 1024 });
  post("/api/lega/sessions/:id/connected", cmd("lega.session.connected", ({ params }) => ({ sessionId: params.id })));
  post("/api/lega/sessions/:id/stop", cmd("lega.session.stop", ({ params, body }) => ({ sessionId: params.id, reason: body?.reason || "user" })));
  post("/api/lega/consent", cmd("lega.consent"));
  post("/api/lega/consent/revoke", cmd("lega.consent_revoke", () => ({})));
  post("/api/isolation/consent", cmd("isolation.consent"));
  post("/api/isolation/revoke", cmd("isolation.revoke"));
  get("/api/grants", () => ({ grants: grants.list() }));
  post("/api/grants", cmd("grant.create", ({ body }) => body, { created: true }));
  post("/api/grants/:id/revoke", cmd("grant.revoke", ({ params }) => ({ grantId: params.id })));
  get("/api/gate/preview", ({ query }) => {
    const project = need(projects.get(query.projectId || "ifrim-agent-hub"), "Project");
    const provider = query.provider || "codex";
    // The same model/effort plan a run would resolve (profile BALANCED unless asked), so a missing model/list shows here first.
    const plan = resolveRunPlan({ provider, model: query.model || "", effort: query.effort || "", profile: query.profile || "BALANCED", providerState: providerState.get(provider) || null });
    return gate.evaluate({ provider, projectId: project.id, access: query.access || "read-only", workspaceResource: `workspace:${path.resolve(project.path).toLowerCase()}`, plan });
  });
  get("/api/usage", () => ({ overview: usage.overview(), reservePercent: settings.get("usageReservePercent"),
    note: "Only provider-reported numbers are shown. Allowances of different providers are never summed." }));
  get("/api/surfaces", ({ query }) => ({ surfaces: surfaces.list({ provider: query.provider || null }) }));
  get("/api/surfaces/:id", ({ params }) => ({ surface: need(surfaces.get(params.id), "Surface"), verifications: surfaces.verifications({ surfaceId: params.id, limit: 50 }),
    capabilities: surfaces.capabilities().filter((c) => c.surfaceId === params.id), artifacts: artifacts.list({ surfaceId: params.id, limit: 20 }) }));
  post("/api/surfaces/refresh", cmd("surface.refresh", () => ({})));
  get("/api/capabilities", ({ query }) => ({ capabilities: surfaces.capabilities({ provider: query.provider || null, category: query.category || null }) }));
  get("/api/capabilities/verifications", ({ query }) => ({ verifications: surfaces.verifications({ capabilityId: query.capabilityId || null, surfaceId: query.surfaceId || null }) }));
  post("/api/capabilities/verify", cmd("capability.verify", ({ body }) => body, { created: true }));
  get("/api/ecosystem/:name", ({ params }) => {
    if (!ECOSYSTEM_FILES.has(params.name)) throw new HubError("not_found", "Unknown ecosystem document");
    return readEcosystemConfig(config.v2Root, params.name) || { missing: true };
  });
  get("/api/native-sessions", ({ query }) => ({ sessions: nativeSessions.list({ includeEnded: query.all === "1" }), last: nativeSessions.last(), codex: nativeSessions.codex }));
  post("/api/native-sessions/refresh", cmd("native.mirror", () => ({})));

  // ---------- routing, telemetry, lifecycles ----------
  get("/api/routes", ({ query }) => ({ decisions: hub.router.list({ subjectId: query.subjectId || null }), taskTypes: hub.router.taskTypes() }));
  post("/api/routes/explain", cmd("route.adhoc"));
  get("/api/telemetry", () => ({ runs: telemetry.list({ limit: 200 }), outcomes: telemetry.outcomes(), sources: ["MEASURED", "PROVIDER_REPORTED", "DERIVED", "UNKNOWN"] }));
  get("/api/lifecycles", () => ({ lifecycles: describeLifecycles() }));

  // ---------- schedules, computer, checkpoints, artifacts ----------
  get("/api/schedules", () => ({ schedules: schedules.list(), backends: SCHEDULE_BACKENDS, localCommands: [...SCHEDULE_COMMANDS] }));
  get("/api/schedules/:id", ({ params }) => ({ schedule: need(schedules.get(params.id), "Schedule"), refs: schedules.refsOf(params.id), runs: schedules.runs(params.id), setup: schedules.nativeSetupInstructions(params.id) }));
  post("/api/schedules", cmd("schedule.create", ({ body }) => body, { created: true }));
  post("/api/schedules/:id/transition", cmd("schedule.transition", ({ params, body }) => ({ ...body, scheduleId: params.id })));
  post("/api/schedules/:id/link", cmd("schedule.link_native", ({ params, body }) => ({ ...body, scheduleId: params.id })));
  get("/api/computer", () => ({ environments: computer.list(), useCases: computer.useCases(), locks: computer.locks() }));
  get("/api/computer/plan/:useCase", ({ params }) => computer.plan(params.useCase));
  post("/api/computer/acquire", cmd("computer.acquire", ({ body }) => body, { created: true }));
  post("/api/computer/release", cmd("computer.release"));
  get("/api/checkpoints", () => ({ checkpoints: checkpoints.list({ limit: 50 }) }));
  get("/api/checkpoints/:id", ({ params }) => need(checkpoints.get(params.id), "Checkpoint"));
  post("/api/checkpoints", cmd("checkpoint.create", ({ body }) => body, { created: true }));
  get("/api/artifacts", ({ query }) => ({ artifacts: artifacts.list({ projectId: query.projectId || null, taskId: query.taskId || null, surfaceId: query.surfaceId || null }) }));
  post("/api/artifacts", cmd("artifact.register", ({ body }) => body, { created: true }));

  // ---------- backups ----------
  get("/api/backups", ({ query }) => ({ backups: backups.list(query.projectId || null, 50) }));
  post("/api/backups", cmd("backup.run", ({ body }) => ({ projectId: body.projectId }), { created: true }));

  // ---------- memory, decisions, leads ----------
  get("/api/memory", ({ query }) => ({ items: memory.search(query.q || "", { scope: query.scope || null, scopeRef: query.scopeRef || null, includeInactive: query.all === "1" }), scopes: MEMORY_SCOPES, types: MEMORY_TYPES,
    sources: MEMORY_SOURCES, contradictions: memory.contradictions() }));
  post("/api/memory", cmd("memory.add", ({ body }) => body, { created: true }));
  post("/api/memory/:id/revise", cmd("memory.revise", ({ params, body }) => ({ ...body, memoryId: params.id })));
  del("/api/memory/:id", cmd("memory.delete", ({ params }) => ({ memoryId: params.id })));
  post("/api/memory/import", cmd("memory.import"));
  get("/api/memory/export", () => ({ __raw: true, contentType: "application/json; charset=utf-8", body: JSON.stringify(redactDeep(memory.exportAll()), null, 2) }));
  get("/api/memory/export/:provider", ({ params, query }) => memory.exportForProvider(params.provider, { scope: query.scope || null, scopeRef: query.scopeRef || null }));
  get("/api/decisions", ({ query }) => ({ decisions: db.prepare(`SELECT * FROM decisions ${query.projectId ? "WHERE project_id = ?" : ""} ORDER BY created_at DESC LIMIT 200`).all(...(query.projectId ? [query.projectId] : [])) }));
  post("/api/decisions", cmd("decision.record", ({ body }) => body, { created: true }));
  get("/api/leads", () => ({ leads: leads.list(), statuses: LEAD_STATUSES }));
  post("/api/leads/import", cmd("lead.import"));
  post("/api/leads/:id/evidence", cmd("lead.evidence", ({ params, body }) => ({ ...body, leadId: params.id })));
  post("/api/leads/:id/status", cmd("lead.status", ({ params, body }) => ({ ...body, leadId: params.id })));
  // ---------- Sales & Lead Generation (M04): reads here, every change through the sales.* commands ----------
  const sales = hub.sales;
  get("/api/sales/overview", () => sales.overview());
  get("/api/sales/imports", () => ({ batches: sales.listBatches() }));
  post("/api/sales/imports", cmd("sales.import.create", ({ body }) => body, { created: true }), { maxBytes: 30 * 1024 * 1024 });
  get("/api/sales/imports/:id", ({ params, query }) => ({ batch: sales.getBatch(params.id), rows: sales.batchRows(params.id, { status: query.status || null, offset: query.offset, limit: query.limit }) }));
  post("/api/sales/imports/:id/mapping", cmd("sales.import.mapping", ({ params, body }) => ({ batchId: params.id, mapping: body?.mapping })));
  post("/api/sales/imports/:id/preview", cmd("sales.import.preview", ({ params, body }) => ({ batchId: params.id, ...(body?.limit ? { limit: body.limit } : {}) })));
  post("/api/sales/imports/:id/confirm", cmd("sales.import.confirm", ({ params, body }) => ({ batchId: params.id, ...(body?.maxRows ? { maxRows: body.maxRows } : {}) })));
  post("/api/sales/imports/:id/rollback-preview", ({ params }) => sales.rollbackPreview(params.id));
  post("/api/sales/imports/:id/rollback", cmd("sales.import.rollback", ({ params, body }) => ({ batchId: params.id, reason: body?.reason || "" })));
  get("/api/sales/review", ({ query }) => sales.reviewRows({ offset: query.offset, limit: query.limit }));
  post("/api/sales/import-rows/:id/resolve", cmd("sales.import_row.resolve", ({ params, body }) => ({ ...body, rowId: params.id })));
  get("/api/sales/orgs", ({ query }) => sales.listOrgs({ q: query.q || "", status: query.status || "", city: query.city || "", synthetic: query.synthetic || "",
    needsReview: query.needsReview === "1" || query.needsReview === "true", offset: query.offset, limit: query.limit, sort: query.sort || "updated" }));
  get("/api/sales/orgs/:id", ({ params }) => sales.getOrg(params.id));
  post("/api/sales/orgs/:id/transition", cmd("sales.org.transition", ({ params, body }) => ({ ...body, orgId: params.id })));
  post("/api/sales/orgs/:id/update", cmd("sales.org.update", ({ params, body }) => ({ ...body, orgId: params.id })));
  post("/api/sales/orgs/:id/evidence", cmd("sales.evidence.add", ({ params, body }) => ({ ...body, subjectType: "org", subjectId: params.id })));
  post("/api/sales/orgs/:id/audit", cmd("sales.org.audit", ({ params, body }) => ({ orgId: params.id, sourceKind: body?.sourceKind || "fixture" })));
  post("/api/sales/orgs/:id/qualify", cmd("sales.org.qualify", ({ params, body }) => ({ orgId: params.id, filters: body?.filters || {} })));
  post("/api/sales/orgs/:id/qualification/override", cmd("sales.qualification.override", ({ params, body }) => ({ ...body, orgId: params.id })));
  post("/api/sales/orgs/:id/suppress", cmd("sales.org.suppress", ({ params, body }) => ({ orgId: params.id, reason: body?.reason })));
  post("/api/sales/orgs/:id/suppression/lift", cmd("sales.suppression.lift", ({ params, body }) => ({ orgId: params.id, reason: body?.reason })));
  post("/api/sales/orgs/:id/merge", cmd("sales.org.merge", ({ params, body }) => ({ ...body, orgId: params.id })));
  post("/api/sales/merges/:id/revert", cmd("sales.merge.revert", ({ params }) => ({ mergeId: params.id })));
  get("/api/sales/services", ({ query }) => ({ services: sales.listServices({ activeOnly: query.all !== "1" }) }));
  post("/api/sales/services", cmd("sales.service.save", ({ body }) => body, { created: true }));
  post("/api/sales/services/:id", cmd("sales.service.save", ({ params, body }) => ({ ...body, serviceId: params.id })));
  get("/api/sales/opportunities", ({ query }) => sales.listOpportunities({ status: query.status || "", offset: query.offset, limit: query.limit }));
  post("/api/sales/opportunities", cmd("sales.opportunity.create", ({ body }) => body, { created: true }));
  get("/api/sales/opportunities/:id", ({ params }) => sales.getOpportunity(params.id));
  post("/api/sales/opportunities/:id/transition", cmd("sales.opportunity.transition", ({ params, body }) => ({ ...body, opportunityId: params.id })));
  post("/api/sales/opportunities/:id/proposals", cmd("sales.proposal.create", ({ params, body }) => ({ opportunityId: params.id, ...(body?.edits ? { edits: body.edits } : {}) }), { created: true }));
  post("/api/sales/proposals/:id/approve", cmd("sales.proposal.approve", ({ params, body }) => ({ proposalId: params.id, displayedSha: body?.displayedSha || body?.contentSha || body?.sha })));
  post("/api/sales/opportunities/:id/drafts", cmd("sales.draft.create", ({ params, body }) => ({ ...body, opportunityId: params.id }), { created: true }));
  post("/api/sales/drafts/:id/revise", cmd("sales.draft.revise", ({ params, body }) => ({ ...body, draftId: params.id })));
  post("/api/sales/drafts/:id/approve-content", cmd("sales.draft.approve_content", ({ params, body }) => ({ draftId: params.id, displayedSha: body?.displayedSha || body?.contentSha || body?.sha })));
  post("/api/sales/drafts/:id/send", cmd("sales.draft.send", ({ params, body }) => ({ draftId: params.id, idempotencyKey: body?.idempotencyKey })));
  post("/api/sales/opportunities/:id/contact-events", cmd("sales.contact_event.record", ({ params, body }) => ({ ...body, confirmText: body?.confirmText ?? body?.confirmation, opportunityId: params.id })));
  post("/api/sales/opportunities/:id/acceptance", cmd("sales.acceptance.record", ({ params, body }) => ({ ...body, confirmText: body?.confirmText ?? body?.confirmation, opportunityId: params.id })));
  post("/api/sales/opportunities/:id/handoff", cmd("sales.handoff.create", ({ params, body }) => ({ opportunityId: params.id, ...(body?.projectId ? { projectId: body.projectId } : {}) })));
  get("/api/sales/followups", ({ query }) => ({ followups: sales.listFollowups({ status: query.status || "" }) }));
  post("/api/sales/opportunities/:id/followups", cmd("sales.followup.schedule", ({ params, body }) => ({ ...body, basis: body?.basis === "manual" ? "explicit_date" : body?.basis, opportunityId: params.id }), { created: true }));
  post("/api/sales/followups/:id/draft", cmd("sales.followup.draft", ({ params }) => ({ followupId: params.id })));
  post("/api/sales/followups/:id/:action", cmd("sales.followup.action", ({ params, body }) => ({ followupId: params.id, action: params.action, reason: body?.reason || "" })));
  get("/api/sales/owner", () => settings.get("salesOwner"));
  post("/api/sales/owner", cmd("sales.owner.save"));
  // CSV export of the organization list: formula injection neutralized, filters as in the list.
  get("/api/sales/export/orgs.csv", ({ query }) => ({ __raw: true, contentType: "text/csv; charset=utf-8",
    body: sales.exportOrgsCsv({ q: query.q || "", status: query.status || "", city: query.city || "", synthetic: query.synthetic || "", sort: query.sort || "name" }) }));


  // ---------- briefing, voice ----------
  get("/api/briefing", ({ query }) => {
    const briefing = buildBriefing({ db, settings, missions, backups, projects, clock, sinceHours: Number(query.hours) || 24 });
    return query.format === "md" ? { __raw: true, contentType: "text/markdown; charset=utf-8", body: briefingMarkdown(briefing) } : briefing;
  });
  post("/api/briefing/generate", cmd("briefing.generate"));
  post("/api/voice/command", async ({ body }) => (await commands.dispatch({ type: "voice.command", payload: body, actor: "voice", channel: "voice" })).result);

  // ---------- legacy V1 ----------
  const legacyDir = path.join(config.hubRoot, ".ifrim", "BACKUPS", "v2-rebuild");
  const assertSnapshot = (file) => {
    const resolved = path.resolve(String(file || ""));
    if (!resolved.startsWith(path.resolve(legacyDir)) || !resolved.endsWith(".sqlite") || !fs.existsSync(resolved)) throw new HubError("validation", "Snapshot must be a V1 snapshot in .ifrim/BACKUPS/v2-rebuild");
    return resolved;
  };
  get("/api/legacy", () => ({ import: settings.get("legacyImport"), snapshots: fs.existsSync(legacyDir) ? fs.readdirSync(legacyDir).filter((f) => f.endsWith(".sqlite")).sort().reverse().map((f) => path.join(legacyDir, f)) : [],
    batches: db.prepare("SELECT id, source, source_sha256, status, created_at, reverted_at FROM import_batches ORDER BY created_at DESC").all() }));
  post("/api/legacy/snapshot", cmd("legacy.snapshot", () => ({}), { created: true }));
  post("/api/legacy/plan", ({ body }) => planImport(assertSnapshot(body.snapshotPath), db, projects));
  post("/api/legacy/apply", cmd("legacy.apply", ({ body }) => ({ snapshotPath: body.snapshotPath, sha256: String(body.sha256 || "") })));
  post("/api/legacy/revert", cmd("legacy.revert", ({ body }) => ({ batchId: String(body.batchId || "") })));
  get("/api/legacy/table/:name", ({ params, query }) => {
    const result = readLegacyTable(assertSnapshot(query.snapshot), params.name, { limit: Number(query.limit) || 100, offset: Number(query.offset) || 0 });
    return { ...result, rows: redactDeep(result.rows).map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === "string" && v.length > 4000 ? `${v.slice(0, 4000)}… [${v.length} chars]` : v]))) };
  });

  // ---------- health, diagnostics, audit, export ----------
  get("/api/health/processes", async () => {
    let listeners = [];
    if (process.platform === "win32") {
      try {
        const { stdout } = await execFileAsync("netstat", ["-ano", "-p", "TCP"], { windowsHide: true, timeout: 8000 });
        listeners = stdout.split(/\r?\n/).map((line) => line.match(/TCP\s+(127\.0\.0\.1|0\.0\.0\.0):(\d+)\s+\S+\s+LISTENING\s+(\d+)/))
          .filter(Boolean).map((m) => ({ address: m[1], port: Number(m[2]), pid: Number(m[3]) }))
          .filter((l) => [3004, 8004, 3011, 8011, 18789, 18790].includes(l.port))
          .map((l) => ({ ...l, role: { 3004: "V1 UI (Vite)", 8004: "V1 API", 3011: "V2 dev UI", 8011: "V2 Hub", 18789: "OpenClaw global gateway", 18790: "OpenClaw isolated gateway (V1)" }[l.port] }));
      } catch { listeners = []; }
    }
    return { hubPid: process.pid, uptimeS: Math.round(process.uptime()), memoryMb: Math.round(process.memoryUsage().rss / 1048576), supervised: supervisor.list(), listeners,
      note: "Listeners are observed, not controlled. V2 never stops processes it did not start." };
  });
  get("/api/diagnostics", () => {
    const count = (sql, ...args) => db.prepare(sql).get(...args).n;
    return {
      generatedAt: clock().toISOString(),
      company: { departments: count("SELECT COUNT(*) AS n FROM departments"), activeDepartments: count("SELECT COUNT(*) AS n FROM departments WHERE status = 'active'"),
        goals: count("SELECT COUNT(*) AS n FROM goals"), objectives: count("SELECT COUNT(*) AS n FROM objectives"), roles: hub.roleConfig.roles.length,
        managerRelationships: count("SELECT COUNT(*) AS n FROM manager_relationships"), clients: count("SELECT COUNT(*) AS n FROM clients") },
      work: { projects: count("SELECT COUNT(*) AS n FROM projects"), conversations: count("SELECT COUNT(*) AS n FROM conversations"), missions: count("SELECT COUNT(*) AS n FROM missions"),
        tasks: count("SELECT COUNT(*) AS n FROM tasks"), dependencies: count("SELECT COUNT(*) AS n FROM task_dependencies"), runs: count("SELECT COUNT(*) AS n FROM agent_runs"),
        activeRuns: runs.activeRuns().length, handoffs: count("SELECT COUNT(*) AS n FROM handoffs"), checkpoints: count("SELECT COUNT(*) AS n FROM checkpoints"),
        artifacts: count("SELECT COUNT(*) AS n FROM artifacts"), routeDecisions: count("SELECT COUNT(*) AS n FROM route_decisions") },
      control: { pendingApprovals: approvals.list("pending").length, policyRules: count("SELECT COUNT(*) AS n FROM approval_policies"),
        taskScopes: count("SELECT COUNT(*) AS n FROM task_approval_scopes WHERE status = 'active'"), locks: leases.list().length,
        retainedLocks: leases.list().filter((l) => l.status === "retained").length, grantsActive: grants.list().filter((g) => g.status === "active").length, commands: count("SELECT COUNT(*) AS n FROM commands") },
      ecosystem: { surfaces: count("SELECT COUNT(*) AS n FROM execution_surfaces"), capabilities: count("SELECT COUNT(*) AS n FROM capability_registry"),
        verifications: count("SELECT COUNT(*) AS n FROM capability_verifications"), integrations: count("SELECT COUNT(*) AS n FROM integrations"),
        computerEnvironments: count("SELECT COUNT(*) AS n FROM computer_environments"), nativeSessions: count("SELECT COUNT(*) AS n FROM native_sessions WHERE status <> 'ended'") },
      knowledge: { memory: count("SELECT COUNT(*) AS n FROM memory_items WHERE status = 'active'"), skills: count("SELECT COUNT(*) AS n FROM skills"),
        skillVersions: count("SELECT COUNT(*) AS n FROM skill_versions"), decisions: count("SELECT COUNT(*) AS n FROM decisions"), leads: count("SELECT COUNT(*) AS n FROM leads") },
      operations: { schedules: count("SELECT COUNT(*) AS n FROM schedules"), activeSchedules: count("SELECT COUNT(*) AS n FROM schedules WHERE status = 'ACTIVE'"),
        backups: count("SELECT COUNT(*) AS n FROM backups"), verifiedBackups: count("SELECT COUNT(*) AS n FROM backups WHERE status = 'verified'"),
        telemetry: count("SELECT COUNT(*) AS n FROM execution_telemetry"), events: bus.lastSeq(),
        schemaVersion: db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get().v },
      backupGate: projects.hub() ? backups.freshVerified(projects.hub().id) : null,
      mode: settings.get("mode"), gate: settings.get("executionGate"),
    };
  });
  get("/api/audit", ({ query }) => ({ events: bus.since(Math.max(0, bus.lastSeq() - (Number(query.limit) || 300)), 1000).reverse() }));
  get("/api/export", () => ({ __raw: true, contentType: "application/json; charset=utf-8", body: JSON.stringify(redactDeep({
    exportedAt: clock().toISOString(), version: HUB_VERSION,
    company: company.overview(),
    conversations: conversations.list().map((c) => ({ ...c, messages: conversations.messages(c.id, { limit: 5000 }) })),
    decisions: db.prepare("SELECT * FROM decisions").all(), missions: missions.list().map((m) => ({ ...m, tasks: missions.tasks(m.id) })),
    memory: memory.exportAll(), skills: skills.list(), schedules: schedules.list(),
  }), null, 2) }));
}
