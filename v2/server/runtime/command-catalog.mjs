import path from "node:path";
import { HubError } from "../core/errors.mjs";
import { newId } from "../core/ids.mjs";
import { ATTESTATION_TEXT } from "../policy/billing.mjs";
import { APPROVAL_POLICIES } from "../policy/approval-policy.mjs";
import { MISSION_TEMPLATES } from "../domain/missions.mjs";
import { MEMORY_SCOPES, MEMORY_TYPES } from "../domain/memory.mjs";
import { LEAD_STATUSES } from "../domain/leads.mjs";
import { SCHEDULE_BACKENDS } from "../domain/schedules.mjs";
import { VERIFICATION_LABELS } from "../domain/surfaces.mjs";
import { ARTIFACT_SOURCES } from "../domain/artifacts.mjs";
import { parseVoiceCommand } from "../domain/voice.mjs";
import { buildBriefing, briefingMarkdown } from "../domain/briefing.mjs";
import { snapshotLegacy, applyImport, revertImport } from "../storage/v1-import.mjs";
import { transitionTask } from "./state-machine.mjs";
import fs from "node:fs";

/** Commands a LOCAL_HUB schedule may run (non-AI, no external effects). */
export const SCHEDULE_COMMANDS = Object.freeze(new Set(["backup.run", "native.mirror", "surface.refresh", "briefing.generate", "checkpoint.create"]));
const UI = ["ui", "test"];
const UI_SCHED = ["ui", "test", "schedule"];

/**
 * The command catalog: every state change of the Hub, with its validation schema, the channels that
 * may issue it, the approval-policy action (when it touches something outside the Hub core) and the
 * handler. REST endpoints are thin adapters over these commands.
 */
export function registerCommands(commands, hub) {
  const { db, bus, settings, projects, conversations, missions, approvals, grants, providerState, usage, memory, leads, backups, providers, runs, handoffs,
    tools, company, chiefOfStaff, schedules, surfaces, nativeSessions, computer, skills, checkpoints, artifacts, policy, router, config } = hub;
  const clock = config.now;
  const need = (value, what) => { if (!value) throw new HubError("not_found", `${what} not found`); return value; };
  const reg = (type, def) => commands.register(type, def);

  // ---------- projects ----------
  reg("projects.sync", { describe: "Resincronizează proiectele din PROJECTS.md (citire; scrie doar registrul Hub)", async: true, schema: {},
    execute: async () => ({ projects: projects.syncFromRegistry() }) });

  // ---------- conversations & runs ----------
  reg("conversation.create", { describe: "Conversație nouă într-un proiect", schema: { projectId: { required: true }, title: { required: true, min: 2, max: 160 } },
    execute: (input, ctx) => { const project = need(projects.get(input.projectId), "Project"); return conversations.create({ ...input, projectId: project.id }, ctx.actor); } });
  reg("conversation.message", { describe: "Mesaj în conversația canonică", schema: { conversationId: { required: true }, content: { required: true, max: 100000, trim: false },
    clientMessageId: { max: 100 }, attachmentIds: { type: "array", max: 10, items: "string" } }, channels: ["ui", "test", "companion"],
    execute: (input, ctx) => {
      if (!input.content.trim()) throw new HubError("validation", "Message is empty");
      const m = conversations.addMessage({ conversationId: input.conversationId, role: "user", content: input.content, clientMessageId: input.clientMessageId || null }, ctx.actor);
      if (!m.duplicate && input.attachmentIds?.length) conversations.linkAttachments(m.id, input.attachmentIds);
      return m;
    } });
  reg("conversation.attachment", { describe: "Atașament (stocat local, fără conținut în jurnalul de comenzi)", schema: { conversationId: { required: true }, filename: { required: true, max: 200 },
    mime: { required: true, max: 100 }, base64: { required: true, trim: false } }, logPayload: (i) => ({ conversationId: i.conversationId, filename: i.filename, mime: i.mime, base64Length: i.base64.length }),
    execute: (input) => conversations.saveAttachment(input) });
  reg("run.start", { describe: "Pornește un turn de model prin poarta de execuție", async: true, schema: { conversationId: { required: true }, provider: { enum: ["codex", "claude"], required: true },
    access: { enum: ["read-only", "workspace-write"], default: "read-only" }, model: { max: 80 }, effort: { enum: ["low", "medium", "high", "xhigh", "max"] }, taskId: { max: 80 }, grantId: { max: 80 } },
    execute: async (input, ctx) => {
      const task = input.taskId ? missions.task(input.taskId) : null;
      return runs.start({ ...input, stage: task?.stage || "assist", roleId: task?.roleId || "", actor: ctx.actor, correlationId: ctx.correlationId });
    } });
  reg("run.interrupt", { describe: "Întrerupe o execuție activă", async: true, schema: { runId: { required: true } }, channels: ["ui", "test", "voice", "companion"],
    execute: (input, ctx) => runs.interrupt(input.runId, ctx.actor) });
  reg("system.stop_all", { describe: "Stop All: poartă suspendată, granturi revocate, execuții întrerupte", async: true, schema: { reason: { max: 300 } }, channels: ["ui", "test", "voice", "companion"],
    execute: (input, ctx) => runs.stopAll(ctx.channel === "voice" ? "voice" : ctx.actor, input.reason || (ctx.channel === "voice" ? "Voice: Stop" : "Stop All")) });

  // ---------- handoffs ----------
  reg("handoff.begin", { describe: "Handoff Codex ↔ Claude (pașii 1–6)", async: true, schema: { conversationId: { required: true }, toProvider: { enum: ["codex", "claude"], required: true }, taskId: { max: 80 } },
    execute: async (input, ctx) => { const h = handoffs.begin({ ...input, taskId: input.taskId || null, actor: ctx.actor }); return handoffs.advance(h.id); } });
  reg("handoff.advance", { describe: "Continuă handoff-ul", async: true, schema: { handoffId: { required: true } }, execute: (input) => handoffs.advance(input.handoffId) });
  reg("handoff.cancel", { describe: "Anulează handoff-ul", async: true, schema: { handoffId: { required: true } }, execute: (input, ctx) => handoffs.cancel(input.handoffId, ctx.actor) });

  // ---------- missions & tasks ----------
  reg("mission.create", { describe: "Misiune din șablon (+ conversație canonică)", schema: { projectId: { required: true }, kind: { enum: Object.keys(MISSION_TEMPLATES), required: true },
    title: { required: true, min: 3, max: 160 }, objective: { required: true, min: 5, max: 4000 }, acceptance: { type: "array", max: 30, items: "string" }, constraints: { type: "array", max: 30, items: "string" },
    priority: { type: "integer", min: 1, max: 3 }, departmentKey: { max: 40 }, goalId: { max: 80 }, objectiveId: { max: 80 } },
    execute: (input, ctx) => {
      // Accepts the project id or slug; everything is stored under the canonical project id.
      const project = need(projects.get(input.projectId), "Project");
      const conversation = conversations.create({ projectId: project.id, title: input.title }, ctx.actor);
      const mission = missions.create({ ...input, projectId: project.id, conversationId: conversation.id }, ctx.actor);
      conversations.update(conversation.id, { activeMissionId: mission.id }, ctx.actor);
      if (input.departmentKey) need(company.department(input.departmentKey), "Department");
      const deptKey = input.departmentKey || MISSION_TEMPLATES[input.kind].department || departmentForRole(hub, MISSION_TEMPLATES[input.kind].tasks[0].role);
      company.linkMission(mission.id, { departmentId: deptKey ? company.department(deptKey)?.id || null : null, goalId: input.goalId || null, objectiveId: input.objectiveId || null }, ctx.actor);
      return missions.get(mission.id);
    } });
  reg("task.command", { describe: "Comandă pe task (coadă, pauză, verificare…)", schema: { taskId: { required: true }, action: { enum: ["queue", "pause", "resume", "cancel", "block", "retry", "verify", "reject"], required: true },
    reason: { max: 500 }, evidence: { type: "object" } }, channels: ["ui", "test", "companion"],
    execute: (input, ctx) => {
      let evidence = input.evidence;
      if (input.action === "verify") {
        const task = need(missions.task(input.taskId), "Task");
        const manual = evidence?.manualVerification;
        if (!manual || String(manual).trim().length < 10) throw new HubError("validation", "Describe what you verified (at least 10 characters)");
        evidence = { manualVerification: String(manual).slice(0, 2000), runs: runs.listRuns({ taskId: task.id, limit: 50 }).map((r) => r.id).slice(0, 10) };
      }
      return missions.command(input.taskId, input.action, { reason: input.reason, evidence, actor: ctx.actor });
    } });
  reg("task.add_dependency", { describe: "Dependență finish-to-start între taskuri", schema: { taskId: { required: true }, dependsOn: { required: true } },
    execute: (input, ctx) => missions.addDependency(input.taskId, input.dependsOn, ctx.actor) });

  // ---------- approvals & policy ----------
  reg("approval.decide", { describe: "Decizia ta asupra unei aprobări (doar din UI, cu hash-ul afișat)", async: true, schema: { approvalId: { required: true },
    decision: { enum: ["approved", "rejected"], required: true }, displayedHash: { required: true, max: 128 }, note: { max: 500, default: "" } },
    execute: async (input) => {
      const approval = bus.transaction(() => approvals.decide(input.approvalId, { decision: input.decision, displayedHash: input.displayedHash, note: input.note, channel: "ui", actor: "user" }));
      runs.resolveApproval(input.approvalId, input.decision);
      return approval;
    } });
  reg("approval.execute_script", { describe: "Rulează scriptul npm aprobat", async: true, schema: { approvalId: { required: true } }, execute: (input) => tools.executeApprovedScript(input.approvalId) });
  reg("policy.set_rule", { describe: "Regulă de aprobare (poate fi doar cel mult atât de permisivă cât permite catalogul)", schema: { actionKind: { required: true, max: 80 },
    surfaceId: { max: 80, default: "*" }, projectId: { max: 80, default: "*" }, policy: { enum: APPROVAL_POLICIES, required: true }, reason: { required: true, min: 3, max: 300 } },
    execute: (input, ctx) => policy.setRule(input, ctx.actor) });
  reg("policy.remove_rule", { describe: "Șterge o regulă a ta", schema: { ruleId: { required: true } }, execute: (input, ctx) => policy.removeRule(input.ruleId, ctx.actor) });

  // ---------- settings, mode, gate, grants, billing ----------
  reg("settings.update", { describe: "Setări (voce, rezervă, UI, concurență, preferințe de rutare)", schema: { voice: { type: "object" }, usageReservePercent: { type: "number" }, ui: { type: "object" },
    maxConcurrentAiRuns: { type: "integer" }, routingPreferences: { type: "object" } },
    execute: (input, ctx) => {
      for (const [key, value] of Object.entries(input)) {
        if (value === undefined) continue;
        if (key === "usageReservePercent" && !(value >= 5 && value <= 80)) throw new HubError("validation", "Reserve must be 5..80%");
        if (key === "maxConcurrentAiRuns" && !(value >= 1 && value <= 2)) throw new HubError("validation", "Concurrency is limited to 1..2 in this build");
        if (key === "voice" && value.wakeWord) throw new HubError("policy", "Wake word is not implemented; push-to-talk only");
        if (key === "routingPreferences") validateRoutingPreferences(value, router);
        settings.set(key, value, ctx.actor);
      }
      return settings.all();
    } });
  reg("mode.set", { describe: "Mod: BUILD_SAFE / LIVE_VALIDATION", schema: { mode: { enum: ["BUILD_SAFE", "LIVE_VALIDATION", "OPERATIONAL"], required: true }, confirm: { max: 40 } },
    execute: (input, ctx) => {
      if (input.mode === "OPERATIONAL") throw new HubError("policy", "OPERATIONAL mode is not enabled in this build; it needs per-mission policies you approve");
      if (input.mode === "LIVE_VALIDATION" && input.confirm !== "LIVE_VALIDATION") throw new HubError("validation", "Type LIVE_VALIDATION to confirm");
      settings.set("mode", input.mode, ctx.actor, input.mode === "BUILD_SAFE" ? "Returned to safe mode" : "Live validation enabled; runs still need a scoped grant");
      return { mode: settings.get("mode") };
    } });
  reg("gate.set", { describe: "Deschide/suspendă poarta de execuție", schema: { action: { enum: ["open", "suspend"], required: true }, reason: { max: 300 }, confirm: { max: 40 } },
    channels: ["ui", "test", "voice", "companion"],
    execute: (input, ctx) => {
      if (input.action === "open") {
        if (ctx.channel !== "ui" && ctx.channel !== "test") throw new HubError("policy", "The gate can only be opened from the UI");
        if (input.confirm !== "OPEN GATE") throw new HubError("validation", "Type OPEN GATE to confirm");
        const retained = hub.leases.list().filter((l) => l.status === "retained");
        if (retained.length) throw new HubError("gate", `Reconcile ${retained.length} retained lease(s) before opening the gate`);
      }
      const value = { status: input.action === "open" ? "open" : "suspended", reason: input.reason || (input.action === "open" ? "Opened by user" : "Suspended by user"), changedAt: clock().toISOString(), changedBy: ctx.channel === "voice" ? "voice" : ctx.actor };
      settings.set("executionGate", value, ctx.actor, value.reason);
      return { executionGate: value };
    } });
  reg("grant.create", { describe: "Grant de validare live (provider, proiect, încercări, durată)", schema: { provider: { enum: ["codex", "claude"], required: true }, projectId: { required: true },
    access: { enum: ["read-only", "workspace-write"], required: true }, maxAttempts: { type: "integer", required: true, min: 1, max: 5 }, maxDurationS: { type: "integer", default: 900, min: 60, max: 7200 },
    ttlMinutes: { type: "integer", default: 60, min: 5, max: 480 }, note: { max: 500, default: "" } },
    execute: (input, ctx) => {
      if (settings.get("mode") !== "LIVE_VALIDATION") throw new HubError("policy", "Grants can only be created in LIVE_VALIDATION mode");
      const project = need(projects.get(input.projectId), "Project");
      return grants.create({ ...input, projectId: project.id }, ctx.actor);
    } });
  reg("grant.revoke", { describe: "Revocă un grant", schema: { grantId: { required: true } }, channels: ["ui", "test", "voice", "companion"], execute: (input, ctx) => grants.revoke(input.grantId, ctx.actor) });
  reg("billing.attest", { describe: "Verificarea ta manuală a setării de facturare peste plan", schema: { provider: { enum: ["codex", "claude"], required: true }, confirmText: { required: true, max: 400 } },
    execute: (input, ctx) => {
      if (input.confirmText !== ATTESTATION_TEXT[input.provider]) throw new HubError("validation", "Confirmation text does not match");
      const value = { ...settings.get("billingAttestations"), [input.provider]: { confirmedAt: clock().toISOString(), text: ATTESTATION_TEXT[input.provider] } };
      settings.set("billingAttestations", value, ctx.actor, `Manual billing check recorded for ${input.provider}`);
      return { attestations: value };
    } });
  reg("provider.inspect", { describe: "Inspectează instalarea providerului (fără inferență)", async: true, schema: { provider: { enum: ["codex", "claude"], required: true } },
    execute: async (input, ctx) => {
      const adapter = providers[input.provider];
      const installation = await adapter.inspectInstallation();
      const current = providerState.get(input.provider) || {};
      bus.transaction(() => {
        providerState.set(input.provider, { ...current, installation, config: adapter.inspectConfig(), installationCheckedAt: clock().toISOString() });
        bus.append({ type: "provider.inspected", scopeType: "provider", scopeId: input.provider, source: ctx.actor, payload: { installed: installation.installed, version: installation.version } });
      });
      surfaces.refreshAvailability();
      return { installed: installation.installed, version: installation.version };
    } });
  reg("provider.probe", { describe: "Verifică contul (handshake/auth status, fără inferență)", async: true, schema: { provider: { enum: ["codex", "claude"], required: true }, withModels: { type: "boolean", default: false } },
    execute: async (input, ctx) => {
      const adapter = providers[input.provider];
      const installation = await adapter.inspectInstallation();
      if (!installation.installed) throw new HubError("transport", installation.reason);
      const result = await adapter.probe({ withModels: Boolean(input.withModels), withUsage: true });
      bus.transaction(() => {
        providerState.set(input.provider, { ...result, installation, config: adapter.inspectConfig() });
        if (result.usage && !result.usage.error) usage.record(input.provider, result.usage);
        bus.append({ type: result.ok ? "provider.probed" : "provider.unavailable", scopeType: "provider", scopeId: input.provider, source: ctx.actor,
          payload: { ok: result.ok, accountType: result.auth?.accountType || result.auth?.authMethod || null, error: result.error || null } });
      });
      surfaces.refreshAvailability();
      return { ok: result.ok, error: result.error || null };
    } });

  // ---------- backups, checkpoints, artifacts ----------
  reg("backup.run", { describe: "Backup complet + verificare prin restaurare", async: true, schema: { projectId: { required: true } }, channels: UI_SCHED,
    execute: (input, ctx) => backups.run(input.projectId, ctx.channel === "schedule" ? "scheduled backup" : "manual backup", ctx.actor) });
  reg("checkpoint.create", { describe: "Checkpoint operațional cross-provider (referințe native incluse)", async: true, channels: UI_SCHED,
    schema: { scopeType: { enum: ["conversation", "mission", "task", "project", "hub"], default: "project" }, scopeId: { max: 80 }, label: { max: 200, default: "" }, nextAction: { max: 500, default: "" },
      kind: { enum: ["operational", "milestone"], default: "operational" } },
    execute: (input, ctx) => checkpoints.create({ ...input, scopeId: input.scopeId || projects.hub().id, scopeType: input.scopeId ? input.scopeType : "project" }, ctx.actor) });
  reg("artifact.register", { describe: "Referință de artefact (fișier local sau artefact nativ)", schema: { projectId: { required: true }, missionId: { max: 80 }, taskId: { max: 80 },
    kind: { required: true, max: 60 }, title: { required: true, max: 200 }, source: { enum: ARTIFACT_SOURCES, default: "hub" }, surfaceId: { max: 80 }, nativeRef: { max: 500 },
    filePath: { max: 400 }, description: { max: 2000 }, owner: { max: 80, default: "user" } },
    execute: (input, ctx) => artifacts.register(input, ctx.actor) });

  // ---------- memory, decisions, leads ----------
  reg("memory.add", { describe: "Element de memorie canonică", schema: { scope: { enum: MEMORY_SCOPES, required: true }, scopeRef: { max: 120 }, type: { enum: MEMORY_TYPES, required: true },
    title: { required: true, max: 200 }, body: { required: true, max: 20000 }, sourceRef: { max: 500 }, retentionUntil: { max: 40 } },
    execute: (input) => memory.add({ ...input, author: "user", sourceKind: "user" }) });
  reg("memory.revise", { describe: "Versiune nouă a unui element", schema: { memoryId: { required: true }, title: { max: 200 }, body: { max: 20000 }, type: { enum: MEMORY_TYPES }, sourceRef: { max: 500 }, scopeRef: { max: 120 } },
    execute: (input, ctx) => { const { memoryId, ...patch } = input; return memory.revise(memoryId, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)), ctx.actor); } });
  reg("memory.delete", { describe: "Ștergere autorizată (păstrează tombstone de audit)", schema: { memoryId: { required: true } }, execute: (input, ctx) => ({ deleted: memory.remove(input.memoryId, ctx.actor) }) });
  reg("memory.import", { describe: "Import controlat din memoria unui vendor (ca ipoteze)", schema: { sourceKind: { enum: ["claude_native", "openai_native", "hermes", "import"], required: true },
    text: { required: true, max: 200000, trim: false }, scope: { enum: MEMORY_SCOPES, default: "GLOBAL" }, scopeRef: { max: 120, default: "" } },
    logPayload: (i) => ({ sourceKind: i.sourceKind, scope: i.scope, lines: i.text.split(/\r?\n/).length }),
    execute: (input, ctx) => memory.importFromText(input, ctx.actor) });
  reg("decision.record", { describe: "Decizie cu sursă", schema: { projectId: { max: 80 }, conversationId: { max: 80 }, title: { required: true, max: 200 }, decision: { required: true, max: 5000 },
    rationale: { max: 5000 }, sourceRef: { max: 500 } },
    execute: (input, ctx) => {
      const id = newId("dec");
      db.prepare("INSERT INTO decisions (id, project_id, conversation_id, title, decision, rationale, source_ref, author, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(id, input.projectId || null, input.conversationId || null, input.title, input.decision, input.rationale || "", input.sourceRef || "", ctx.actor, clock().toISOString());
      bus.append({ type: "decision.recorded", scopeType: input.conversationId ? "conversation" : "project", scopeId: input.conversationId || input.projectId || "global", source: ctx.actor, payload: { decisionId: id, title: input.title } });
      return { id };
    } });
  reg("lead.import", { describe: "Import lead-uri (deduplicate)", schema: { text: { required: true, max: 200000, trim: false }, source: { max: 120, default: "manual-import" }, demo: { type: "boolean", default: false } },
    logPayload: (i) => ({ source: i.source, demo: i.demo, lines: i.text.split(/\r?\n/).length }),
    execute: (input) => leads.importText(input.text, { source: input.source, demo: input.demo }) });
  reg("lead.evidence", { describe: "Dovadă cu sursă pentru un lead", async: true, schema: { leadId: { required: true }, claim: { required: true, max: 500 }, sourceUrl: { required: true, max: 500 }, observedAt: { required: true, max: 40 } },
    execute: async (input) => leads.addEvidence(input.leadId, { claim: input.claim, sourceUrl: input.sourceUrl, observedAt: input.observedAt }) });
  reg("lead.status", { describe: "Stare lead", async: true, schema: { leadId: { required: true }, status: { enum: LEAD_STATUSES, required: true }, notes: { max: 2000 } },
    execute: async (input) => leads.setStatus(input.leadId, input.status, input.notes ?? null) });

  // ---------- company runtime & chief of staff ----------
  reg("company.department_status", { describe: "Stare departament (active/planned/paused)", schema: { departmentKey: { required: true, max: 40 }, status: { enum: ["active", "planned", "paused"], required: true }, reason: { required: true, min: 3, max: 300 } },
    execute: (input, ctx) => company.setDepartmentStatus(input.departmentKey, input.status, input.reason, ctx.actor) });
  reg("goal.create", { describe: "Obiectiv de companie", schema: { title: { required: true, min: 3, max: 200 }, description: { max: 4000, default: "" }, departmentKey: { max: 40 },
    priority: { type: "integer", min: 1, max: 3, default: 2 }, ownerRoleId: { max: 60 }, dueAt: { max: 40 }, successMetrics: { type: "array", max: 20, items: "string" } },
    execute: (input, ctx) => company.createGoal({ ...input, departmentId: input.departmentKey ? need(company.department(input.departmentKey), "Department").id : null }, ctx.actor) });
  reg("goal.transition", { describe: "Schimbă starea unui obiectiv", schema: { goalId: { required: true }, to: { enum: ["DRAFT", "ACTIVE", "AT_RISK", "BLOCKED", "ACHIEVED", "ABANDONED"], required: true },
    reason: { required: true, min: 3, max: 500 }, evidence: { type: "object" }, expectedVersion: { type: "integer" } },
    execute: (input, ctx) => company.transitionGoal(input.goalId, input.to, { reason: input.reason, actor: ctx.actor, evidence: input.evidence || null, expectedVersion: input.expectedVersion ?? null }) });
  reg("objective.create", { describe: "Rezultat-cheie măsurabil", schema: { goalId: { required: true }, title: { required: true, min: 3, max: 200 }, keyResult: { max: 500, default: "" },
    targetValue: { type: "number" }, unit: { max: 40, default: "" }, departmentKey: { max: 40 } },
    execute: (input, ctx) => company.createObjective({ ...input, departmentId: input.departmentKey ? need(company.department(input.departmentKey), "Department").id : null }, ctx.actor) });
  reg("objective.update", { describe: "Progres măsurat / stare", schema: { objectiveId: { required: true }, currentValue: { type: "number" }, status: { enum: ["OPEN", "IN_PROGRESS", "MET", "MISSED", "DROPPED"] }, reason: { max: 500, default: "" } },
    execute: (input, ctx) => company.updateObjective(input.objectiveId, input, ctx.actor) });
  reg("mission.link", { describe: "Leagă o misiune de departament/obiectiv", schema: { missionId: { required: true }, departmentKey: { max: 40 }, goalId: { max: 80 }, objectiveId: { max: 80 } },
    execute: (input, ctx) => { need(missions.get(input.missionId), "Mission"); company.linkMission(input.missionId, { departmentId: input.departmentKey ? need(company.department(input.departmentKey), "Department").id : null, goalId: input.goalId || null, objectiveId: input.objectiveId || null }, ctx.actor); return missions.get(input.missionId); } });
  reg("cos.intake", { describe: "Chief of Staff: obiectiv → propunere (obiectiv DRAFT + rezultate-cheie; misiunile doar propuse)", schema: { objective: { required: true, min: 5, max: 4000 },
    departmentKey: { max: 40 }, projectId: { max: 80 }, priority: { type: "integer", min: 1, max: 3, default: 2 }, dueAt: { max: 40 } }, channels: ["ui", "test", "companion"],
    execute: (input, ctx) => {
      const plan = chiefOfStaff.analyze({ objective: input.objective, departmentHint: input.departmentKey || null, projectId: input.projectId || null });
      const goal = company.createGoal({ title: plan.goal.title, description: plan.goal.description, priority: input.priority, dueAt: input.dueAt || null, source: "chief-of-staff",
        departmentId: plan.missions.length === 1 ? company.department(plan.missions[0].departmentKey)?.id || null : company.department("executive")?.id || null, ownerRoleId: "chief-of-staff" }, ctx.actor);
      const objectives = plan.objectives.map((o) => company.createObjective({ goalId: goal.id, title: o.title, keyResult: o.keyResult, targetValue: o.targetValue, unit: o.unit,
        departmentId: company.department(o.departmentKey)?.id || null }, ctx.actor));
      return { goal, objectives, proposal: plan };
    } });
  reg("cos.apply_plan", { describe: "Creează misiunile DRAFT confirmate din propunere", schema: { goalId: { required: true }, missions: { type: "array", max: 12 } },
    execute: (input, ctx) => {
      const goal = need(company.goal(input.goalId), "Goal");
      const created = [];
      for (const m of input.missions || []) {
        if (!MISSION_TEMPLATES[m.missionKind]) throw new HubError("validation", `Unknown mission kind ${m.missionKind}`);
        const dept = need(company.department(m.departmentKey), "Department");
        const project = need(projects.get(m.projectId || projects.hub().id), "Project");
        const objective = company.objectivesOf(goal.id).find((o) => o.departmentId === dept.id) || null;
        const title = String(m.title || `${dept.name}: ${goal.title}`).slice(0, 160);
        const conversation = conversations.create({ projectId: project.id, title }, ctx.actor);
        const mission = missions.create({ projectId: project.id, kind: m.missionKind, title, objective: goal.description || goal.title, acceptance: [], constraints: [], priority: goal.priority, conversationId: conversation.id }, ctx.actor);
        conversations.update(conversation.id, { activeMissionId: mission.id }, ctx.actor);
        company.linkMission(mission.id, { departmentId: dept.id, goalId: goal.id, objectiveId: objective?.id || null }, ctx.actor);
        created.push(missions.get(mission.id));
      }
      return { goalId: goal.id, missions: created, note: "Misiunile sunt DRAFT; nimic nu pornește fără comanda ta și fără poarta de execuție." };
    } });

  // ---------- routing ----------
  reg("route.task", { describe: "Rutare task → departament/rol/provider/model/suprafață/unelte", schema: { taskId: { required: true }, dataSensitivity: { enum: ["normal", "confidential", "secret"], default: "normal" },
    preferredProvider: { enum: ["openai", "anthropic"] }, override: { type: "object" } },
    execute: (input, ctx) => {
      const task = need(missions.task(input.taskId), "Task");
      if (!task.taskType) throw new HubError("validation", "Task has no task type");
      const dept = task.departmentId ? db.prepare("SELECT key FROM departments WHERE id = ?").get(task.departmentId)?.key : null;
      return router.route({ subjectType: "task", subjectId: task.id, taskType: task.taskType, roleId: task.roleId, departmentKey: dept, dataSensitivity: input.dataSensitivity,
        preferredProvider: input.preferredProvider || null, projectId: task.projectId, override: input.override || null }, ctx.actor);
    } });
  reg("route.adhoc", { describe: "Explică rutarea unui tip de task (fără execuție)", schema: { taskType: { required: true, max: 60 }, dataSensitivity: { enum: ["normal", "confidential", "secret"], default: "normal" },
    preferredProvider: { enum: ["openai", "anthropic"] }, requireAutomation: { type: "boolean" }, projectId: { max: 80 } },
    execute: (input, ctx) => router.route({ subjectType: "adhoc", taskType: input.taskType, dataSensitivity: input.dataSensitivity, preferredProvider: input.preferredProvider || null,
      requireAutomation: input.requireAutomation ?? null, projectId: input.projectId || null }, ctx.actor) });
  reg("assisted.prepare", { describe: "Pregătește un task pentru o suprafață ASISTATĂ (brief + artefact; rulezi tu în aplicația vendorului)", schema: { taskId: { required: true }, surfaceId: { required: true, max: 80 } },
    execute: (input, ctx) => prepareAssisted(hub, input, ctx) });

  // ---------- surfaces, native mirror, capabilities ----------
  reg("surface.refresh", { describe: "Reîmprospătează disponibilitatea suprafețelor din inspecții locale", async: true, schema: {}, channels: UI_SCHED,
    execute: async () => ({ updates: surfaces.refreshAvailability(nativeSessions.last()) }) });
  reg("native.mirror", { describe: "Citește sesiunile Claude native (claude agents --json, read-only)", async: true, schema: {}, channels: UI_SCHED,
    action: () => ({ actionKind: "native.mirror", target: "claude agents --json" }),
    execute: async (input, ctx) => { const r = await nativeSessions.refresh(ctx.actor); surfaces.refreshAvailability(r); return r; } });
  reg("capability.verify", { describe: "Înregistrează o verificare de capabilitate (cu dovadă)", schema: { capabilityId: { max: 80 }, surfaceId: { max: 80 },
    method: { enum: ["doc_read", "local_cli", "account_probe", "live_run", "simulated_test", "manual"], required: true }, label: { enum: VERIFICATION_LABELS, required: true },
    summary: { required: true, min: 5, max: 1000 }, evidence: { type: "object" } },
    execute: (input, ctx) => {
      if (!input.capabilityId && !input.surfaceId) throw new HubError("validation", "capabilityId or surfaceId is required");
      if (input.label === "PASS_LIVE" && input.method !== "live_run") throw new HubError("validation", "PASS_LIVE requires a live_run method");
      return { id: surfaces.recordVerification(input, ctx.actor) };
    } });

  // ---------- schedules ----------
  reg("schedule.create", { describe: "Programare cu un singur proprietar (LOCAL_HUB / CLAUDE_NATIVE / OPENAI_NATIVE)", schema: { name: { required: true, min: 3, max: 120 }, description: { max: 2000, default: "" },
    cadence: { required: true, max: 40 }, backend: { enum: SCHEDULE_BACKENDS, default: "LOCAL_HUB" }, departmentKey: { max: 40 }, action: { type: "object", required: true },
    usesAi: { type: "boolean", default: false }, externalEffects: { type: "boolean", default: false }, intentKey: { max: 200 } },
    execute: (input, ctx) => {
      if (input.backend === "LOCAL_HUB" && !SCHEDULE_COMMANDS.has(input.action.command)) throw new HubError("policy", `LOCAL_HUB poate rula doar: ${[...SCHEDULE_COMMANDS].join(", ")}`);
      return schedules.create({ ...input, departmentId: input.departmentKey ? company.department(input.departmentKey)?.id || null : null }, ctx.actor);
    } });
  reg("schedule.transition", { describe: "Activează / pune pe pauză / retrage o programare", schema: { scheduleId: { required: true }, to: { enum: ["ACTIVE", "PAUSED", "RETIRED"], required: true }, reason: { required: true, min: 3, max: 300 } },
    execute: (input, ctx) => schedules.transition(input.scheduleId, input.to, { reason: input.reason, actor: ctx.actor, allowedLocalCommands: SCHEDULE_COMMANDS }) });
  reg("schedule.link_native", { describe: "Leagă ID-ul programării native pe care ai creat-o tu", schema: { scheduleId: { required: true }, nativeId: { required: true, min: 3, max: 200 }, nativeLabel: { max: 200, default: "" } },
    execute: (input, ctx) => schedules.linkNative(input.scheduleId, input, ctx.actor) });
  reg("briefing.generate", { describe: "Generează briefingul (Markdown local în Hub)", schema: { hours: { type: "integer", min: 1, max: 168, default: 24 } }, channels: UI_SCHED,
    execute: (input, ctx) => {
      const briefing = buildBriefing({ db, settings, missions, backups, projects, clock, sinceHours: input.hours });
      const dir = path.join(config.workDir, "briefings");
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `briefing-${clock().toISOString().replace(/[:.]/g, "-")}.md`);
      fs.writeFileSync(file, briefingMarkdown(briefing));
      bus.append({ type: "briefing.generated", scopeType: "system", scopeId: "briefing", source: ctx.actor, payload: { file: path.basename(file), completed: briefing.completed.length, blocked: briefing.blocked.length } });
      return { file: path.relative(config.hubRoot, file), completed: briefing.completed.length, blocked: briefing.blocked.length };
    } });

  // ---------- computer runtime, skills ----------
  reg("computer.acquire", { describe: "Lock de controller unic pe un mediu de calcul (și fereastră)", schema: { envId: { required: true, max: 80 }, holder: { required: true, min: 3, max: 120 },
    windowRef: { max: 200 }, taskId: { max: 80 }, ttlSeconds: { type: "integer", min: 60, max: 7200, default: 900 } },
    execute: (input) => computer.acquire(input) });
  reg("computer.release", { describe: "Eliberează lock-urile de computer", schema: { leaseIds: { type: "array", max: 4, items: "string", required: true }, reason: { max: 200, default: "released" } },
    execute: (input) => computer.release(input.leaseIds, input.reason) });
  reg("skill.import", { describe: "Rescanează v2/skills (versiuni noi doar la schimbare de conținut)", async: true, schema: {}, execute: async (input, ctx) => skills.importAll(ctx.actor) });
  reg("skill.export", { describe: "Pachet local Claude Code plugin / Agent Skills (neinstalat)", async: true, schema: { format: { enum: ["claude-code-plugin", "agent-skills"], default: "claude-code-plugin" } },
    execute: async (input) => skills.exportBundle(input) });

  // ---------- tools, legacy, voice ----------
  reg("tool.invoke", { describe: "Unealtă Hub (citire locală sau cerere de aprobare pentru script)", async: true, schema: { toolId: { required: true, max: 60 }, projectId: { required: true }, args: { type: "object", default: {} } },
    execute: (input) => tools.invoke(input.toolId, input.projectId, input.args || {}) });
  reg("legacy.snapshot", { describe: "Snapshot coerent al bazei V1", async: true, schema: {}, execute: () => snapshotLegacy(config.legacyDbPath, legacyDir(config)) });
  reg("legacy.apply", { describe: "Aplică importul V1 (legat de SHA-256 al snapshotului)", async: true, schema: { snapshotPath: { required: true, max: 600 }, sha256: { required: true, max: 64 } },
    execute: (input) => applyImport({ snapshotPath: assertSnapshot(config, input.snapshotPath), expectedSha256: input.sha256, v2db: db, bus, projects, clock }) });
  reg("legacy.revert", { describe: "Revert al unui lot de import", async: true, schema: { batchId: { required: true, max: 80 } }, execute: (input) => revertImport({ batchId: input.batchId, v2db: db, bus }) });
  reg("voice.command", { describe: "Comandă vocală (transcrierea nu poate aproba nimic)", async: true, schema: { transcript: { required: true, max: 2000 } }, channels: ["ui", "test", "voice"],
    execute: async (input) => {
      const parsed = parseVoiceCommand(input.transcript);
      bus.emit({ type: "voice.command", scopeType: "system", scopeId: "voice", source: "voice", payload: { kind: parsed.kind, command: parsed.command || null } });
      if (parsed.kind === "command" && parsed.command === "stop_all") return { ...parsed, result: (await commands.dispatch({ type: "system.stop_all", channel: "voice", actor: "voice", payload: {} })).result };
      if (parsed.kind === "command" && parsed.command === "pause") {
        const r = await commands.dispatch({ type: "gate.set", channel: "voice", actor: "voice", payload: { action: "suspend", reason: "Voice: pause (no new runs)" } });
        return { ...parsed, result: { gate: r.result.executionGate.status, activeRunsContinue: runs.activeRuns().length } };
      }
      return parsed;
    } });
}

function departmentForRole(hub, roleId) {
  return hub.roleConfig.roles.find((r) => r.id === roleId)?.department || null;
}

function validateRoutingPreferences(value, router) {
  const known = new Set(router.taskTypes().map((t) => t.id));
  for (const [taskType, pref] of Object.entries(value || {})) {
    if (!known.has(taskType)) throw new HubError("validation", `Unknown task type ${taskType}`);
    if (pref?.provider && !["openai", "anthropic"].includes(pref.provider)) throw new HubError("validation", "provider must be openai or anthropic");
  }
}

const legacyDir = (config) => path.join(config.hubRoot, ".ifrim", "BACKUPS", "v2-rebuild");
function assertSnapshot(config, file) {
  const resolved = path.resolve(String(file || ""));
  if (!resolved.startsWith(path.resolve(legacyDir(config))) || !resolved.endsWith(".sqlite") || !fs.existsSync(resolved)) throw new HubError("validation", "Snapshot must be a V1 snapshot in .ifrim/BACKUPS/v2-rebuild");
  return resolved;
}

/**
 * ExecutionSurfaceAdapter.start for ASSISTED surfaces: the Hub prepares a brief (objective, criteria,
 * constraints, context references, how to return the result) and records it as an artifact; the owner
 * runs it in the vendor app. The task waits (WAITING_PROVIDER) until a result artifact is registered
 * and verified. Nothing is sent to the vendor by the Hub.
 */
function prepareAssisted(hub, { taskId, surfaceId }, ctx) {
  const { surfaces, missions, projects, artifacts, db, bus, config } = hub;
  const { surface, support } = surfaces.requireOperation(surfaceId, "start");
  if (support !== "ASSISTED") throw new HubError("validation", `${surface.name} nu este o suprafață asistată; folosește run.start prin poarta de execuție`);
  const task = missions.task(taskId);
  if (!task) throw new HubError("not_found", "Task not found");
  const mission = task.missionId ? missions.get(task.missionId) : null;
  const project = projects.get(task.projectId);
  const brief = [
    `# Task asistat: ${task.title}`, "",
    `Suprafață: ${surface.name} (${surface.id}) — rulezi tu în aplicația vendorului; Hub-ul nu trimite nimic.`,
    `Proiect: ${project?.name || "—"} · Misiune: ${mission?.title || "—"} · Task: ${task.id}`, "",
    "## Obiectiv", mission?.objective || task.title, "",
    "## Criterii de acceptanță", ...(task.acceptance.length ? task.acceptance : mission?.acceptance || []).map((a) => `- ${a}`), "",
    "## Constrângeri",
    "- Fără secrete, parole sau chei în prompt.", "- Fără trimiteri externe, commit, push, plăți sau activare extra usage fără aprobarea ta.",
    "- Citează sursele (URL + dată) pentru orice afirmație factuală.", ...(mission?.constraints || []).map((c) => `- ${c}`), "",
    "## Returnare în Hub",
    `Înregistrează rezultatul în Hub → Artefacte (sursa nativă, link/ID, taskul ${task.id}); taskul se finalizează doar după verificarea ta.`,
  ].join("\n");
  const dir = path.join(config.workDir, "assisted");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${task.id}-${surface.id.replace(/\W+/g, "_")}.md`);
  fs.writeFileSync(file, brief);
  const art = artifacts.register({ projectId: task.projectId, missionId: task.missionId, taskId: task.id, kind: "assisted_brief", title: `Brief asistat: ${task.title}`.slice(0, 200),
    source: "hub", surfaceId: surface.id, description: `Pregătit pentru ${surface.name}` }, ctx.actor);
  if (task.status === "QUEUED") {
    transitionTask(db, bus, config.now, { taskId: task.id, to: "WAITING_PROVIDER", reason: `Asistat: rulezi în ${surface.name} și înregistrezi rezultatul`, actor: ctx.actor });
    missions.refreshMissionStatus(task.missionId);
  }
  bus.append({ type: "provider.native_task_prepared", scopeType: "task", scopeId: task.id, source: ctx.actor, payload: { surfaceId: surface.id, artifactId: art.id } });
  return { brief, briefFile: path.relative(config.hubRoot, file), artifact: art, surface: { id: surface.id, name: surface.name } };
}
