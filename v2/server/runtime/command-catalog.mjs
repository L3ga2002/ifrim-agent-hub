import path from "node:path";
import { HubError } from "../core/errors.mjs";
import { newId } from "../core/ids.mjs";
import { ATTESTATION_TEXT } from "../policy/billing.mjs";
import { buildDeclaration, applyDeclaration } from "../policy/billing-evidence.mjs";
import { inspectionFromState } from "../policy/gate.mjs";
import { nextSuspension, originFields, classifySuspension, suspensionKey } from "../policy/gate-state.mjs";
import { CODEX_ACL_CONSENT_TEXT, R2_ACCEPT_TEXT, R2_MAX_ACCEPT_DAYS } from "../policy/isolation.mjs";
import { LEGA_CONSENT_TEXT, LEGA_CONSENT_VERSION, LEGA_VOICES, LEGA_TASK_MAX, LEGA_WEB_SEARCH_MODES, LEGA_DEFAULTS } from "../policy/lega-policy.mjs";
import { APPROVAL_POLICIES } from "../policy/approval-policy.mjs";
import { OWNER_DECIDED } from "../policy/approvals.mjs";
import { EFFORT_PROFILES } from "../policy/run-plan.mjs";
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
import { registerSalesCommands } from "../sales/sales-commands.mjs";
import { registerDeskCommands } from "../desk/desk-commands.mjs";
import { registerEnvironmentCommands } from "../environments/environment-commands.mjs";
import { registerOwnerCommands } from "../owner/owner-commands.mjs";
import { registerIntelCommands } from "../intel/intel-commands.mjs";
import { registerMediaCommands } from "../media/media-commands.mjs";
import { registerOpsCommands } from "../ops/ops-commands.mjs";
import { registerDeliveryCommands } from "../delivery/delivery-commands.mjs";
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
  /**
   * M10.2.1 (D17): who suspends the gate, from the command context — the channel, the actor (a paired phone's device:<id>), and for
   * the owner channel the credential behind the session, re-read from the database (an ended or expired session records none).
   */
  const suspensionOrigin = (ctx) => {
    const s = ctx.ownerSession?.id ? db.prepare("SELECT credential_id, status, expires_at FROM owner_sessions WHERE id = ?").get(String(ctx.ownerSession.id)) : null;
    const live = s && s.status === "active" && new Date(s.expires_at) > clock();
    return originFields({ channel: ctx.channel, actor: ctx.channel === "voice" ? "voice" : ctx.actor, credentialId: live ? s.credential_id : null, sessionId: live ? ctx.ownerSession.id : null });
  };

  /** When the owner asked (command log) and, for approved commands, when the approval was requested and decided (run timeline). */
  function requestTiming(ctx) {
    const command = ctx.commandId ? commands.get(ctx.commandId) : null;
    const approval = command?.approvalId ? approvals.get(command.approvalId) : null;
    return { requestedAt: command?.createdAt || null, approval: approval ? { createdAt: approval.createdAt, decidedAt: approval.decidedAt } : null };
  }

  /** Mission from a template + its canonical conversation + company links. Shared by mission.create and Lega's approved proposals. */
  function createMission(input, actor) {
    // Accepts the project id or slug; everything is stored under the canonical project id.
    const project = need(projects.get(input.projectId), "Project");
    if (input.departmentKey) need(company.department(input.departmentKey), "Department");
    const conversation = conversations.create({ projectId: project.id, title: input.title }, actor);
    const mission = missions.create({ ...input, projectId: project.id, conversationId: conversation.id }, actor);
    conversations.update(conversation.id, { activeMissionId: mission.id }, actor);
    const deptKey = input.departmentKey || MISSION_TEMPLATES[input.kind].department || departmentForRole(hub, MISSION_TEMPLATES[input.kind].tasks[0].role);
    company.linkMission(mission.id, { departmentId: deptKey ? company.department(deptKey)?.id || null : null, goalId: input.goalId || null, objectiveId: input.objectiveId || null }, actor);
    // Software Factory kinds (eng_*): factory state + spec v1 as DRAFT, in the same transaction (a refusal rolls it all back).
    if (MISSION_TEMPLATES[input.kind].factory) hub.factory.initialize(missions.get(mission.id), { spec: input.spec, limits: input.limits }, actor);
    return missions.get(mission.id);
  }

  // ---------- projects ----------
  reg("projects.sync", { describe: "Resincronizează proiectele din PROJECTS.md (citire; scrie doar registrul Hub)", async: true, schema: {},
    execute: async () => ({ projects: projects.syncFromRegistry() }) });
  // Sanitized test projects for live validation (created by v2/scripts/create-test-project.mjs). UI/test channels only.
  reg("project.register_test", { describe: "Înregistrează un proiect de TEST sanitizat (creat de scriptul Hub) pentru validarea live", schema: { path: { required: true, max: 500 }, name: { min: 2, max: 80 } },
    execute: (input, ctx) => projects.registerTest(input, ctx.actor) });
  reg("project.retire_test", { describe: "Retrage execuția unui proiect de test (fișierele și istoricul rămân)", schema: { projectId: { required: true, max: 80 } },
    channels: ["ui", "test", "voice", "companion"], execute: (input, ctx) => projects.retireTest(input.projectId, ctx.actor) });
  // Enabling runs on a company project is the owner's decision: UI only, with the project's exact name typed. Withdrawing
  // is fail-safe, so voice and companion may do it too; it also revokes that project's active run grants.
  reg("project.execution.enable", { describe: "Permite execuții de agenți pe un proiect al companiei (tastezi numele exact)", schema: { projectId: { required: true, max: 80 }, confirmName: { required: true, max: 200 } },
    execute: (input, ctx) => projects.setExecution(input.projectId, true, { confirmName: input.confirmName, actor: ctx.actor }) });
  reg("project.execution.disable", { describe: "Retrage execuțiile de pe un proiect (revocă și grant-urile lui active)", schema: { projectId: { required: true, max: 80 }, reason: { max: 300, default: "" } },
    channels: ["ui", "test", "voice", "companion"],
    execute: (input, ctx) => {
      const project = projects.setExecution(input.projectId, false, { actor: ctx.actor, reason: input.reason });
      const revoked = grants.activeForProject(project.id).filter((g) => g.kind !== "voice").map((g) => grants.revoke(g.id, ctx.actor).id);
      return { ...project, revokedGrants: revoked };
    } });

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
    access: { enum: ["read-only", "workspace-write"], default: "read-only" }, model: { max: 80 }, effort: { enum: ["low", "medium", "high", "xhigh", "max"] },
    profile: { enum: Object.keys(EFFORT_PROFILES) }, taskId: { max: 80 }, grantId: { max: 80 } },
    execute: async (input, ctx) => {
      const task = input.taskId ? missions.task(input.taskId) : null;
      return runs.start({ ...input, stage: task?.stage || "assist", roleId: task?.roleId || "", actor: ctx.actor, correlationId: ctx.correlationId, ...requestTiming(ctx) });
    } });
  reg("run.interrupt", { describe: "Întrerupe o execuție activă", async: true, schema: { runId: { required: true } }, channels: ["ui", "test", "voice", "companion"],
    execute: (input, ctx) => runs.interrupt(input.runId, ctx.actor) });
  reg("system.stop_all", { describe: "Stop All: poartă suspendată, granturi revocate, execuții întrerupte", async: true, schema: { reason: { max: 300 } }, channels: ["ui", "test", "voice", "companion", "owner"],
    execute: async (input, ctx) => {
      const reason = input.reason || (ctx.channel === "voice" ? "Voice: Stop" : "Stop All");
      // M10: Stop All also stops the desktop operator's input (held keys released) and pauses every running operation plan.
      // Applications and unsaved projects stay open: nothing is force-closed to satisfy a stop.
      // 2.12.1 (D22): this runs inside runs.stopAll (alsoStop), so the stop's own event records WHAT it stopped: the plans it paused
      // and the desktop session it paused — only one that was ACTIVE; a session an intervention had already paused stays that
      // intervention's. A later resume holds exactly these until the rearm (owner/stop-scope.mjs).
      let desktopStop = null;
      const plansPaused = [];
      const alsoStop = async () => {
        let before = null;
        try { before = hub.desktop?.sessionStatus ? hub.desktop.sessionStatus() : null; } catch { before = null; }
        desktopStop = hub.desktop ? await hub.desktop.stop({ actor: ctx.actor, reason }).catch((error) => ({ error: error.message })) : null;
        for (const p of hub.opsPlans ? hub.opsPlans.active().filter((x) => ["RUNNING", "CONFIRMED"].includes(x.status)) : []) {
          try { hub.opsPlans.pause(p.id, { reason, actor: ctx.actor }); plansPaused.push(p.id); } catch { /* reported by the plan's own status */ }
        }
        const after = desktopStop?.session || null;
        return { plansPaused, desktopSessionId: before?.status === "ACTIVE" && after?.id === before.id && after.status === "PAUSED" ? after.id : null };
      };
      // M10.2.1 (D17): the stop records its origin (channel, actor, device, the owner's credential reference), so the cockpit can
      // offer the contextual rearm and say who stopped what — never inferred from the reason text.
      const out = await runs.stopAll(ctx.channel === "voice" ? "voice" : ctx.actor, reason, { kind: "stop_all", ...suspensionOrigin(ctx) }, { alsoStop });
      return { ...out, desktop: desktopStop ? { stopped: Boolean(desktopStop.stopped), helperPaused: Boolean(desktopStop.helperPaused), error: desktopStop.error || null } : null, plansPaused };
    } });

  // ---------- handoffs ----------
  reg("handoff.begin", { describe: "Handoff Codex ↔ Claude (pașii 1–6)", async: true, schema: { conversationId: { required: true }, toProvider: { enum: ["codex", "claude"], required: true }, taskId: { max: 80 } },
    execute: async (input, ctx) => { const h = handoffs.begin({ ...input, taskId: input.taskId || null, actor: ctx.actor }); return handoffs.advance(h.id); } });
  reg("handoff.advance", { describe: "Continuă handoff-ul", async: true, schema: { handoffId: { required: true } }, execute: (input) => handoffs.advance(input.handoffId) });
  reg("handoff.cancel", { describe: "Anulează handoff-ul", async: true, schema: { handoffId: { required: true } }, execute: (input, ctx) => handoffs.cancel(input.handoffId, ctx.actor) });

  // ---------- missions & tasks ----------
  reg("mission.create", { describe: "Misiune din șablon (+ conversație canonică)", schema: { projectId: { required: true }, kind: { enum: Object.keys(MISSION_TEMPLATES), required: true },
    title: { required: true, min: 3, max: 160 }, objective: { required: true, min: 5, max: 4000 }, acceptance: { type: "array", max: 30, items: "string" }, constraints: { type: "array", max: 30, items: "string" },
    priority: { type: "integer", min: 1, max: 3 }, departmentKey: { max: 40 }, goalId: { max: 80 }, objectiveId: { max: 80 }, spec: { type: "object" }, limits: { type: "object" } },
    execute: (input, ctx) => createMission(input, ctx.actor) });
  // ---------- Software Factory (M03) ----------
  // Preparing, revising and stopping are ordinary commands; starting is bound to the exact scope by an approval (ALWAYS_ASK),
  // and accepting/rejecting the result, extra repair cycles and owner overrides are UI-only decisions. Voice can stop/pause.
  const FACTORY_KINDS = { BUGFIX: "eng_bugfix", FEATURE: "eng_feature", REFACTOR: "eng_refactor" };
  /**
   * M10.2 (U09): the body of factory.prepare, shared by the command and by the intake's engineering planner (the same pattern as
   * autopilot.prepare): a DRAFT mission + spec v1, nothing runs. `provenance` ({ createdBy, workRequestId, envelopeId, requestHash,
   * source, channel }) is recorded as a `factory.provenance` event in the same transaction — factory_missions has no column for
   * it, and the event is what lets the planner later cancel ONLY its own still-unstarted drafts (never one the owner made or ran).
   */
  function prepareFactoryMission(input, { actor = "owner", provenance = null } = {}) {
    if (!FACTORY_KINDS[input.workType]) throw new HubError("validation", `Tip de lucrare necunoscut: ${String(input.workType).slice(0, 20)}`);
    const acceptance = (Array.isArray(input.spec?.acceptance) ? input.spec.acceptance : []).map((a) => String(typeof a === "string" ? a : a?.text || "").slice(0, 300)).filter(Boolean).slice(0, 20);
    return bus.transaction(() => {
      const mission = createMission({ projectId: input.projectId, kind: FACTORY_KINDS[input.workType], title: input.title, objective: input.objective, acceptance, spec: input.spec || {}, limits: input.limits || {} }, actor);
      if (provenance) {
        bus.append({ type: "factory.provenance", scopeType: "mission", scopeId: mission.id, projectId: mission.projectId, source: actor,
          payload: { createdBy: String(provenance.createdBy || "unknown").slice(0, 40), workRequestId: provenance.workRequestId || null, envelopeId: provenance.envelopeId || null,
            requestHash: provenance.requestHash ? String(provenance.requestHash).slice(0, 64) : null, source: provenance.source ? String(provenance.source).slice(0, 40) : null,
            channel: provenance.channel ? String(provenance.channel).slice(0, 20) : null } });
      }
      return hub.factory.view(mission.id);
    });
  }
  // Late-bound for the intake's planners (owner/planners/engineering.mjs); the command below stays the UI's path, unchanged.
  hub.prepareFactoryMission = prepareFactoryMission;
  reg("factory.prepare", { describe: "Software Factory: cerință → misiune de engineering cu specificație v1 (ciornă, nimic nu rulează)",
    // M08: also from the owner's authenticated session (autopilot tasks, War Room remediation, package B4 — review M08).
    channels: ["ui", "owner", "test"],
    schema: { projectId: { required: true, max: 80 }, workType: { enum: Object.keys(FACTORY_KINDS), required: true }, title: { required: true, min: 3, max: 160 },
      objective: { required: true, min: 10, max: 4000 }, spec: { type: "object", default: {} }, limits: { type: "object", default: {} } },
    execute: (input, ctx) => prepareFactoryMission(input, { actor: ctx.actor }) });
  reg("factory.spec.revise", { describe: "Versiune nouă a specificației (o versiune aprobată nu se editează; scope-ul schimbat cere aprobare nouă)",
    schema: { missionId: { required: true, max: 80 }, spec: { type: "object", required: true } }, execute: (input, ctx) => hub.factory.reviseSpec(input.missionId, input.spec, ctx.actor) });
  // M09: model + effort per role are fixed here (validated; an ineligible model is refused); also from the owner's session, like prepare.
  reg("factory.limits", { describe: "Limitele misiunii (cicluri de remediere ≤ 2, durată, încercări, profil de efort, model/efort pe rol)", channels: ["ui", "owner", "test"],
    schema: { missionId: { required: true, max: 80 }, limits: { type: "object", required: true } }, execute: (input, ctx) => hub.factory.setLimits(input.missionId, input.limits, ctx.actor) });
  reg("factory.start", { describe: "Pornește misiunea pe scope-ul aprobat (specificație, plan, rute, limite, comenzi); fiecare pas trece apoi prin poarta de execuție",
    async: true, schema: { missionId: { required: true, max: 80 }, specVersion: { type: "integer", required: true }, specSha: { required: true, max: 64 }, planSha: { required: true, max: 64 },
      limits: { type: "object", required: true }, routes: { type: "object", required: true }, bindings: { type: "object", required: true }, commands: { type: "object", required: true } }, channels: ["ui", "test", "owner"],
    action: (input) => ({ actionKind: "factory.scope", target: `${input.missionId}:v${input.specVersion}`, projectId: missions.get(input.missionId)?.projectId || "*" }),
    execute: async (input, ctx) => {
      const command = ctx.commandId ? commands.get(ctx.commandId) : null;
      return hub.factory.startApproved(input.missionId, input, { approvalId: command?.approvalId || null, actor: ctx.actor });
    } });
  reg("factory.stop", { describe: "Oprește misiunea: nicio etapă nouă, execuția ei întreruptă, confirmare când nu mai rulează nimic", async: true,
    schema: { missionId: { required: true, max: 80 }, reason: { max: 300, default: "Stop" } }, channels: ["ui", "test", "voice", "companion", "owner"],
    execute: (input, ctx) => hub.factory.stop(input.missionId, { reason: input.reason, actor: ctx.actor }) });
  reg("factory.pause", { describe: "Pauză: etapa curentă se întrerupe, următoarea nu pornește până reiei", async: true,
    schema: { missionId: { required: true, max: 80 } }, channels: ["ui", "test", "voice", "companion", "owner"], execute: (input, ctx) => hub.factory.pause(input.missionId, { actor: ctx.actor }) });
  reg("factory.resume", { describe: "Reia misiunea de unde au rămas dovezile (opțional: încă un ciclu de remediere sau QA după un review neconcludent — decizia ta)", async: true,
    schema: { missionId: { required: true, max: 80 }, allowExtraCycle: { type: "boolean", default: false }, proceedToQa: { type: "boolean", default: false }, reviewerModel: { max: 64, default: "" } }, channels: ["ui", "test", "owner"],
    execute: async (input, ctx) => {
      // An agent (M07 delegation) may only resume a mission where it stopped: never an extra repair cycle, a jump to QA or
      // another reviewer model — those widen what the owner confirmed and stay the owner's decisions (the factory refuses the
      // rest: a new time window, one more attempt, the end of the owner's pause).
      if (ctx.channel === "agent" && (input.allowExtraCycle || input.proceedToQa || input.reviewerModel)) throw new HubError("policy", "Ciclul suplimentar, trecerea la QA și alt model de review sunt decizii ale tale; agentul poate doar relua misiunea de unde a rămas");
      // The LIVE_VALIDATION the open plans held before a restart comes back with an explicit resume (M07); undone if refused.
      // M10.2: only a hold written before envelope-scoped authority exists can be restored (new plans never write one).
      const restored = (settings.get("envelopeModeHold") || {}).envelopeId ? hub.envelopes?.restoreModeHold?.(input.missionId, ctx.actor) || null : null;
      try {
        return await hub.factory.resume(input.missionId, { actor: ctx.actor, allowExtraCycle: input.allowExtraCycle, proceedToQa: input.proceedToQa, reviewerModel: input.reviewerModel, byAgent: ctx.channel === "agent" });
      } catch (error) {
        hub.envelopes?.undoRestore?.(restored);
        throw error;
      }
    } });
  reg("factory.accept", { describe: "Accepți local pachetul de livrare (OWNER_ACCEPTED; fără commit, push sau deploy)", async: true, channels: ["owner", "test"],
    schema: { missionId: { required: true, max: 80 }, bundleId: { required: true, max: 80, pattern: /^bnd_[A-Za-z0-9_-]+$/ }, bundleSha: { required: true, pattern: /^[0-9a-f]{64}$/, trim: false },
      deliveryId: { max: 80 }, via: { enum: ["delivery_room", "factory_panel"] }, note: { max: 500, default: "" } },
    execute: (input, ctx) => {
      const authenticated = ctx.channel === "owner" || Boolean(ctx.ownerSession);
      if (authenticated) hub.trust.requireFresh(ctx.ownerSession, "acceptarea software-ului");
      return hub.factory.accept(input.missionId, { ...input, ...ctx,
        sessionCheck: authenticated ? () => hub.trust.requireSession(ctx.ownerSession, "acceptarea software-ului") : null });
    } });
  // 2.15.1: a rejection is the owner's terminal decision like the acceptance: the owner channel with a fresh session (re-read again by the
  // factory after the preview stops and right before the decision commits) or the bounded test channel, on the exact displayed target.
  reg("factory.reject", { describe: "Respingi rezultatul afișat (cu motiv): versiunea misiunii și pachetul exact", async: true, channels: ["owner", "test"],
    schema: { missionId: { required: true, max: 80 }, note: { required: true, min: 3, max: 500 }, displayedVersion: { type: "integer", required: true, min: 1 },
      bundleId: { max: 80, pattern: /^bnd_[A-Za-z0-9_-]+$/ }, bundleSha: { pattern: /^[0-9a-f]{64}$/, trim: false } },
    execute: (input, ctx) => {
      const authenticated = ctx.channel === "owner" || Boolean(ctx.ownerSession);
      if (authenticated) hub.trust.requireFresh(ctx.ownerSession, "respingerea rezultatului");
      return hub.factory.reject(input.missionId, { note: input.note, displayedVersion: input.displayedVersion, bundleId: input.bundleId ?? null, bundleSha: input.bundleSha ?? null,
        actor: ctx.actor, channel: ctx.channel, commandId: ctx.commandId, correlationId: ctx.correlationId,
        sessionCheck: authenticated ? () => hub.trust.requireSession(ctx.ownerSession, "respingerea rezultatului") : null });
    } });
  reg("factory.finding", { describe: "Marchezi un finding (fals pozitiv, contestat, acceptat ca atare) cu motiv",
    schema: { missionId: { required: true, max: 80 }, code: { required: true, max: 20 }, status: { enum: ["FALSE_POSITIVE", "DISPUTED", "OPEN", "WONTFIX"], required: true }, note: { required: true, min: 5, max: 500 } },
    execute: (input, ctx) => hub.factory.setFindingStatus(input.missionId, input.code, { status: input.status, note: input.note, actor: ctx.actor }) });

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
    execute: async (input, ctx) => {
      if (ctx.channel === "test" && !hub.config.testMode) throw new HubError("policy", "Canal de test în afara modului de test");
      if (ctx.channel === "test" && hub.config.testMode && OWNER_DECIDED.has(approvals.get(input.approvalId)?.actionKind)) {
        const approval = approvals.decideByOwner(input.approvalId, { ...input, channel: "test" });
        runs.resolveApproval(input.approvalId, input.decision);
        return approval;
      }
      // The decision row records who decided: the owner's UI, or an agent on a recorded delegation (M07), never a fake click.
      // An agent decides only the kinds the owner delegated (the Software Factory start of a test mission), never sensitive,
      // external, sales or Lega approvals.
      if (ctx.channel === "agent") {
        const kind = approvals.get(input.approvalId)?.actionKind;
        if (kind !== "factory.scope") throw new HubError("policy", `Aprobările ${kind || "necunoscute"} nu sunt delegate agentului; le decizi tu în Aprobări`);
      }
      const via = ctx.channel === "agent" ? { channel: "agent", actor: "agent", note: `${input.note ? `${input.note} · ` : ""}[delegat] ${ctx.delegation}`.slice(0, 500) } : { channel: "ui", actor: "user", note: input.note };
      const approval = bus.transaction(() => approvals.decide(input.approvalId, { decision: input.decision, displayedHash: input.displayedHash, note: via.note, channel: via.channel, actor: via.actor }));
      runs.resolveApproval(input.approvalId, input.decision);
      return approval;
    } });
  reg("approval.owner_decide", { describe: "Decizia ta asupra unei aprobări rezervate proprietarului", channels: ["owner", "test"],
    schema: { approvalId: { required: true, max: 80 }, decision: { enum: ["approved", "rejected"], required: true },
      displayedHash: { required: true, pattern: /^[0-9a-f]{64}$/, trim: false }, note: { max: 500, default: "" } },
    execute: (input, ctx) => {
      const what = OWNER_DECIDED.get(approvals.get(input.approvalId)?.actionKind);
      if (!what) throw new HubError("policy", "Doar aprobările rezervate proprietarului se decid aici");
      const approval = approvals.decideByOwner(input.approvalId, { ...input, channel: ctx.channel,
        sessionCheck: () => hub.trust.requireFresh(ctx.ownerSession, what) });
      runs.resolveApproval(input.approvalId, input.decision);
      return approval;
    } });
  reg("approval.execute_script", { describe: "Rulează scriptul npm aprobat", async: true, schema: { approvalId: { required: true } }, execute: (input) => tools.executeApprovedScript(input.approvalId) });
  reg("approval.execute_browser", { describe: "Rulează inspecția de browser aprobată (URL local exact)", async: true, schema: { approvalId: { required: true } }, execute: (input) => tools.executeApprovedBrowser(input.approvalId) });
  reg("policy.set_rule", { describe: "Regulă de aprobare (poate fi doar cel mult atât de permisivă cât permite catalogul)", schema: { actionKind: { required: true, max: 80 },
    surfaceId: { max: 80, default: "*" }, projectId: { max: 80, default: "*" }, policy: { enum: APPROVAL_POLICIES, required: true }, reason: { required: true, min: 3, max: 300 } },
    execute: (input, ctx) => policy.setRule(input, ctx.actor) });
  reg("policy.remove_rule", { describe: "Șterge o regulă a ta", schema: { ruleId: { required: true } }, execute: (input, ctx) => policy.removeRule(input.ruleId, ctx.actor) });

  // ---------- settings, mode, gate, grants, billing ----------
  reg("settings.update", { describe: "Setări (voce, rezervă, UI, concurență, preferințe de rutare)", schema: { voice: { type: "object" }, usageReservePercent: { type: "number" }, ui: { type: "object" },
    maxConcurrentAiRuns: { type: "integer" }, routingPreferences: { type: "object" }, lega: { type: "object" } },
    execute: (input, ctx) => {
      for (const [key, value] of Object.entries(input)) {
        if (value === undefined) continue;
        if (key === "usageReservePercent" && !(value >= 5 && value <= 80)) throw new HubError("validation", "Reserve must be 5..80%");
        if (key === "maxConcurrentAiRuns" && !(value >= 1 && value <= 2)) throw new HubError("validation", "Concurrency is limited to 1..2 in this build");
        if (key === "voice") {
          if (value.wakeWord) throw new HubError("policy", "Wake word is not implemented; push-to-talk only");
          if (value.rate !== undefined && !(value.rate >= 0.5 && value.rate <= 2)) throw new HubError("validation", "Voice rate must be 0.5..2");
          if (value.volume !== undefined && !(value.volume >= 0 && value.volume <= 1)) throw new HubError("validation", "Voice volume must be 0..1");
          if (value.language !== undefined && !/^[a-z]{2}-[A-Z]{2}$/.test(String(value.language))) throw new HubError("validation", "Language must look like ro-RO");
        }
        if (key === "routingPreferences") validateRoutingPreferences(value, router);
        if (key === "lega") {
          const merged = { ...settings.get("lega"), ...value };
          if (!LEGA_VOICES.includes(merged.voice)) throw new HubError("validation", "Unknown Lega voice");
          if (!(Number.isInteger(merged.maxSessionMinutes) && merged.maxSessionMinutes >= 1 && merged.maxSessionMinutes <= 30)) throw new HubError("validation", "Lega session cap must be 1..30 minutes");
          if (!(Number.isInteger(merged.idleTimeoutS) && merged.idleTimeoutS >= 30 && merged.idleTimeoutS <= 600)) throw new HubError("validation", "Lega idle timeout must be 30..600 s");
          const webSearch = merged.webSearch ?? LEGA_DEFAULTS.webSearch;
          if (!LEGA_WEB_SEARCH_MODES.includes(webSearch)) throw new HubError("validation", `Lega web search must be one of ${LEGA_WEB_SEARCH_MODES.join(", ")}`);
          settings.set("lega", { voice: merged.voice, maxSessionMinutes: merged.maxSessionMinutes, idleTimeoutS: merged.idleTimeoutS, webSearch }, ctx.actor);
          continue;
        }
        settings.set(key, value, ctx.actor);
      }
      // M09 review: the identity salt never leaves the Hub (not in this result, not in the commands log).
      const { billingIdentitySecret, ...visible } = settings.all();
      return visible;
    } });
  reg("mode.set", { describe: "Mod: BUILD_SAFE / LIVE_VALIDATION", schema: { mode: { enum: ["BUILD_SAFE", "LIVE_VALIDATION", "OPERATIONAL"], required: true }, confirm: { max: 40 } },
    execute: (input, ctx) => {
      if (input.mode === "OPERATIONAL") throw new HubError("policy", "OPERATIONAL mode is not enabled in this build; it needs per-mission policies you approve");
      if (input.mode === "LIVE_VALIDATION" && input.confirm !== "LIVE_VALIDATION") throw new HubError("validation", "Type LIVE_VALIDATION to confirm");
      settings.set("mode", input.mode, ctx.actor, input.mode === "BUILD_SAFE" ? "Returned to safe mode" : "Live validation enabled; runs still need a scoped grant");
      // A mode chosen by hand belongs to the owner from this moment: the plans' hold is dropped in the same transaction (a resume
      // or an undo landing right after can never bring the plans' LIVE_VALIDATION back over this choice).
      if ((settings.get("envelopeModeHold") || {}).envelopeId) settings.set("envelopeModeHold", {}, "envelopes", `Mode changed by hand (${ctx.actor})`);
      return { mode: settings.get("mode") };
    } });
  reg("gate.set", { describe: "Deschide/suspendă poarta de execuție", schema: { action: { enum: ["open", "suspend"], required: true }, reason: { max: 300 }, confirm: { max: 40 } },
    channels: ["ui", "test", "voice", "companion"],
    execute: (input, ctx) => {
      if (input.action === "open") {
        if (ctx.channel !== "ui" && ctx.channel !== "test") throw new HubError("policy", "The gate can only be opened from the UI");
        if (input.confirm !== "OPEN GATE") throw new HubError("validation", "Type OPEN GATE to confirm");
        const retained = hub.leases.list().filter((l) => l.status === "retained");
        // 2.12.2 (P0-R1): the owner's way out is the cockpit card, never a developer action.
        if (retained.length) throw new HubError("gate", `${retained.length === 1 ? "Un spațiu de lucru e încă rezervat" : `${retained.length} spații de lucru sunt încă rezervate`} după o oprire neconfirmată (lease-uri reținute): ${retained.length === 1 ? "îl eliberezi" : "le eliberezi"} din cockpit, pe cardul „Redeschide poarta”, cu Windows Hello — oprește procesul rămas pornit de Hub sau eliberează rezervarea, apoi redeschide poarta.`);
        // 2.12.1 (D16): a suspension next to a security event is never reopened by the typed admin path (a per-boot token is not the
        // owner): only the cockpit rearm, in the owner session, with a fresh verification and the acknowledged events.
        const security = settings.get("executionGate")?.status === "open" ? null : hub.gateRearm?.eligibility?.()?.security;
        if (security) {
          // REG-02: without any active authenticator (the legacy policy never required one) the cockpit card cannot open a session yet:
          // the refusal names the step that comes first — enrolling Windows Hello / the key — and gives its place as data for the UI.
          // The typed path itself stays refused (D16): a per-boot token is not the owner.
          let bootstrapNeeded = false;
          try { bootstrapNeeded = Boolean(hub.trust?.status?.()?.bootstrapNeeded); } catch { bootstrapNeeded = false; }
          if (bootstrapNeeded) {
            throw new HubError("policy", "Poarta a fost oprită lângă un eveniment de securitate și nu ai încă niciun autentificator înregistrat: înregistrează întâi Windows Hello / cheia ta (Lega → Configurare → Identitate), apoi redeschizi poarta din cockpit, în sesiunea ta, după ce confirmi că ai văzut evenimentele.",
              { data: { code: "SECURITY_ACK", securityAckRequired: true, bootstrapNeeded: true, setup: { href: "#/lega/setup", panel: "identity", label: "Lega → Configurare → Identitate" } } });
          }
          throw new HubError("policy", "Poarta a fost oprită lângă un eveniment de securitate: o redeschizi din cockpit, în sesiunea ta, cu Windows Hello, după ce confirmi că ai văzut evenimentele.", { data: { code: "SECURITY_ACK", securityAckRequired: true } });
        }
      }
      const value = { status: input.action === "open" ? "open" : "suspended", reason: input.reason || (input.action === "open" ? "Opened by user" : "Suspended by user"), changedAt: clock().toISOString(), changedBy: ctx.channel === "voice" ? "voice" : ctx.actor };
      // M10.2.1 (D17): a suspension records its origin (kind "suspend"; a stronger record — Stop All, security — is kept); an opening
      // carries no suspension record and names what it reopened (the typed OPEN GATE stays the legacy / diagnostic admin path).
      const current = settings.get("executionGate");
      if (input.action === "suspend") value.suspendedBy = nextSuspension(current, { kind: "suspend", at: value.changedAt, ...suspensionOrigin(ctx) });
      else if (current?.status !== "open") value.reopenedAfter = { cls: classifySuspension(current).cls, key: suspensionKey(current), via: "open_gate", at: value.changedAt };
      settings.set("executionGate", value, ctx.actor, value.reason);
      return { executionGate: value };
    } });
  reg("grant.create", { describe: "Grant de validare live (provider, proiect, încercări, durată)", schema: { provider: { enum: ["codex", "claude"], required: true }, projectId: { required: true },
    access: { enum: ["read-only", "workspace-write"], required: true }, maxAttempts: { type: "integer", required: true, min: 1, max: 5 }, maxDurationS: { type: "integer", default: 900, min: 60, max: 7200 },
    ttlMinutes: { type: "integer", default: 60, min: 5, max: 480 }, note: { max: 500, default: "" }, kind: { enum: ["run", "voice"], default: "run" } },
    execute: (input, ctx) => {
      if (settings.get("mode") !== "LIVE_VALIDATION") throw new HubError("policy", "Grants can only be created in LIVE_VALIDATION mode");
      const project = need(projects.get(input.projectId), "Project");
      return grants.create({ ...input, projectId: project.id }, ctx.actor);
    } });
  reg("grant.revoke", { describe: "Revocă un grant", schema: { grantId: { required: true } }, channels: ["ui", "test", "voice", "companion"], execute: (input, ctx) => grants.revoke(input.grantId, ctx.actor) });
  // M09-A2: the legacy attestation exists only for tests (channel "test"). The owner declares in the owner session
  // (billing.declare, owner-commands.mjs); POST /api/billing/attest answers with a policy error naming that route. On the test
  // channel it records a declaration bound to the account of the current fresh probe (or unbound when there is none).
  reg("billing.attest", { describe: "Declarație de facturare de test (proprietarul declară în sesiunea lui: billing.declare)", channels: ["test"],
    schema: { provider: { enum: ["codex", "claude"], required: true }, confirmText: { required: true, max: 400 } },
    execute: (input, ctx) => {
      if (input.confirmText !== ATTESTATION_TEXT[input.provider]) throw new HubError("validation", "Textul declarației nu corespunde exact");
      const now = clock();
      const identity = inspectionFromState(providerState.get(input.provider), now)?.auth?.accountIdentity || null;
      const declaration = buildDeclaration({ id: newId("bde"), provider: input.provider, text: ATTESTATION_TEXT[input.provider], identity, now, source: "test:legacy_attest",
        recordedBy: { channel: ctx.channel, actor: ctx.actor, sessionId: null, credentialId10: null } });
      const value = applyDeclaration(settings.get("billingEvidence"), input.provider, declaration);
      settings.set("billingEvidence", value, ctx.actor, `Test billing declaration recorded for ${input.provider}`);
      return { provider: input.provider, declaration: { id: declaration.id, recordedAt: declaration.recordedAt, expiresAt: declaration.expiresAt, bound: Boolean(declaration.accountIdentity) } };
    } });
  reg("isolation.consent", { describe: "Acordul tău pentru ACL-urile DENY persistente scrise de sandbox-ul Codex pe căile protejate", schema: { provider: { enum: ["codex"], required: true }, confirmText: { required: true, max: 600 }, fingerprint: { required: true, max: 64 } },
    execute: (input, ctx) => {
      if (input.confirmText !== CODEX_ACL_CONSENT_TEXT) throw new HubError("validation", "Confirmation text does not match");
      const current = hub.codexIsolation();
      // The consent names the exact list the owner saw; a stale page cannot approve a different list.
      if (input.fingerprint !== current.fingerprint) throw new HubError("conflict", "The protected path list changed; reload and review it again");
      const value = { ...settings.get("isolationConsent"), codex: { confirmedAt: clock().toISOString(), text: CODEX_ACL_CONSENT_TEXT, fingerprint: current.fingerprint, paths: current.paths } };
      settings.set("isolationConsent", value, ctx.actor, "Consent to persistent Codex sandbox DENY ACEs recorded");
      return { consent: value.codex };
    } });
  // R2 (M03 §05): accepting the open risk is the owner's decision (UI only, exact text, one project, limited time). It never
  // closes R2 and is not isolation; withdrawing it is fail-safe and may come from voice or companion too.
  reg("isolation.r2_accept", { describe: "Accepți, pentru un proiect și pentru cel mult 7 zile, că R2 (citire cross-proiect de către Codex) rămâne deschis", schema: { projectId: { required: true, max: 80 },
    confirmText: { required: true, max: 600 }, days: { type: "integer", min: 1, max: R2_MAX_ACCEPT_DAYS, default: 1 } },
    execute: (input, ctx) => {
      if (input.confirmText !== R2_ACCEPT_TEXT) throw new HubError("validation", "Confirmation text does not match");
      const project = need(projects.get(input.projectId), "Project");
      if (project.source === "hub-test") throw new HubError("validation", "Proiectele de test nu au nevoie de acceptare R2");
      const now = clock();
      const value = { ...settings.get("r2Acceptance"), [project.id]: { confirmedAt: now.toISOString(), expiresAt: new Date(now.getTime() + input.days * 86400000).toISOString(),
        projectPath: project.path, projectName: project.name, text: R2_ACCEPT_TEXT } };
      settings.set("r2Acceptance", value, ctx.actor, `R2 risk accepted for ${project.name} (${input.days} d)`);
      return { acceptance: value[project.id] };
    } });
  reg("isolation.r2_revoke", { describe: "Retrage acceptarea R2 pentru un proiect (Codex se blochează din nou pe el)", schema: { projectId: { required: true, max: 80 } }, channels: ["ui", "test", "voice", "companion"],
    execute: (input, ctx) => {
      const project = need(projects.get(input.projectId), "Project");
      const value = { ...settings.get("r2Acceptance") }; delete value[project.id];
      settings.set("r2Acceptance", value, ctx.actor, `R2 acceptance withdrawn for ${project.name}`);
      return { revoked: project.id };
    } });
  reg("isolation.revoke", { describe: "Retrage acordul pentru ACL-urile Codex (nu elimină ACE-urile deja scrise)", schema: { provider: { enum: ["codex"], required: true } }, channels: ["ui", "test", "voice", "companion"],
    execute: (input, ctx) => {
      const value = { ...settings.get("isolationConsent") }; delete value[input.provider];
      settings.set("isolationConsent", value, ctx.actor, `Isolation consent revoked for ${input.provider}`);
      return { revoked: input.provider };
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
  // M10.2: `automation` = the readiness runner refreshing a stale account check before a plan step (actor readiness:<id>; no inference).
  reg("provider.probe", { describe: "Verifică contul (handshake/auth status, lista de modele; fără inferență)", async: true, channels: ["ui", "test", "automation"], schema: { provider: { enum: ["codex", "claude"], required: true }, withModels: { type: "boolean", default: true } },
    execute: async (input, ctx) => {
      const adapter = providers[input.provider];
      const installation = await adapter.inspectInstallation();
      if (!installation.installed) throw new HubError("transport", installation.reason);
      const result = await adapter.probe({ withModels: Boolean(input.withModels), withUsage: true });
      // A check without the model list keeps the last list (found in M05: "Verifică contul" erased it and the run plan failed).
      const previous = providerState.get(input.provider);
      const models = result.models === undefined && Array.isArray(previous?.models) ? { models: previous.models, modelsCheckedAt: previous.modelsCheckedAt || previous.probedAt } : {};
      bus.transaction(() => {
        providerState.set(input.provider, { ...result, ...models, ...(result.models !== undefined ? { modelsCheckedAt: result.probedAt } : {}), installation, config: adapter.inspectConfig() });
        if (result.usage && !result.usage.error) usage.record(input.provider, result.usage);
        bus.append({ type: result.ok ? "provider.probed" : "provider.unavailable", scopeType: "provider", scopeId: input.provider, source: ctx.actor,
          payload: { ok: result.ok, accountType: result.auth?.accountType || result.auth?.authMethod || null, error: result.error || null } });
      });
      surfaces.refreshAvailability();
      return { ok: result.ok, error: result.error || null };
    } });

  // ---------- backups, checkpoints, artifacts ----------
  reg("backup.run", { describe: "Backup complet + verificare prin restaurare", async: true, schema: { projectId: { required: true } }, channels: [...UI_SCHED, "cli"],
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
  // ---------- Sales & Lead Generation (M04): the department's commands; the M01 registry above stays for compatibility ----------
  registerSalesCommands(reg, hub, { createMission });
  // M13 „Birou intern”: the owner's approval of the exact reply / deviz, the checklist update, continue and cancel.
  registerDeskCommands(reg, hub);
  registerEnvironmentCommands(reg, hub);
  registerOwnerCommands(reg, hub);
  registerIntelCommands(reg, hub);
  registerMediaCommands(reg, hub);
  registerOpsCommands(reg, hub);
  // M11 „Ifrim Delivery”: the Delivery Room's commands (owner session for every decision; fail-safe verify / stop / cancel).
  if (hub.deliveries) registerDeliveryCommands(reg, hub);

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
  // M10.2: re-checks the registry against v2/skills without a restart (a commit made after boot left a version 'untracked').
  // It imports only drifted folders and never approves anything itself: approval stays the git facts of the owner's commit (or
  // skill.candidate.approve on the owner channel). automation = the readiness runner (actor readiness:<id>).
  reg("skill.reconcile", { describe: "Reconciliază registrul de skill-uri cu v2/skills (doar ce diferă; nu aprobă nimic)", async: true,
    channels: ["ui", "owner", "test", "automation"], schema: { dryRun: { type: "boolean", default: false } },
    execute: async (input, ctx) => skills.reconcile({ actor: ctx.actor, dryRun: input.dryRun === true }) });
  reg("skill.export", { describe: "Pachet local Claude Code plugin / Agent Skills (neinstalat)", async: true, schema: { format: { enum: ["claude-code-plugin", "agent-skills"], default: "claude-code-plugin" } },
    execute: async (input) => skills.exportBundle(input) });

  // ---------- tools, legacy, voice ----------
  reg("tool.invoke", { describe: "Unealtă Hub (citire locală sau cerere de aprobare pentru script)", async: true, schema: { toolId: { required: true, max: 60 }, projectId: { required: true }, args: { type: "object", default: {} } },
    execute: (input) => tools.invoke(input.toolId, input.projectId, input.args || {}) });
  reg("legacy.snapshot", { describe: "Snapshot coerent al bazei V1", async: true, schema: {}, execute: () => snapshotLegacy(config.legacyDbPath, legacyDir(config)) });
  reg("legacy.apply", { describe: "Aplică importul V1 (legat de SHA-256 al snapshotului)", async: true, schema: { snapshotPath: { required: true, max: 600 }, sha256: { required: true, max: 64 } },
    execute: (input) => applyImport({ snapshotPath: assertSnapshot(config, input.snapshotPath), expectedSha256: input.sha256, v2db: db, bus, projects, clock }) });
  reg("legacy.revert", { describe: "Revert al unui lot de import", async: true, schema: { batchId: { required: true, max: 80 } }, execute: (input) => revertImport({ batchId: input.batchId, v2db: db, bus }) });
  // ---------- Lega (voice assistant: GPT-Live through Codex) ----------
  reg("lega.consent", { describe: "Acordul tău pentru Lega: audio la OpenAI, consum din plan, doar transcriere text păstrată", schema: { confirmText: { required: true, max: 600 } },
    execute: (input, ctx) => {
      if (input.confirmText !== LEGA_CONSENT_TEXT) throw new HubError("validation", "Confirmation text does not match");
      const value = { version: LEGA_CONSENT_VERSION, confirmedAt: clock().toISOString(), text: LEGA_CONSENT_TEXT };
      settings.set("legaConsent", value, ctx.actor, "Lega consent recorded");
      return value;
    } });
  reg("lega.consent_revoke", { describe: "Retrage acordul pentru Lega (oprește și sesiunea activă)", async: true, schema: {}, channels: ["ui", "test", "voice", "companion"],
    execute: async (input, ctx) => {
      bus.transaction(() => settings.set("legaConsent", {}, ctx.actor, "Lega consent revoked"));
      await hub.lega.stopAll("consent-revoked");
      return { revoked: true };
    } });
  // M10: on the owner channel (the server-resolved owner session) the start derives its own one-session voice authority; the ui
  // channel keeps the old path (LIVE_VALIDATION + a voice grant by hand). The session id comes only from ctx.ownerSession.
  reg("lega.session.start", { describe: "Pornește o sesiune Lega (voce GPT-Live prin Codex); oferta SDP a browserului nu este jurnalizată", async: true, channels: ["ui", "owner", "test"],
    schema: { sdp: { required: true, max: 65536, trim: false }, voice: { enum: [...LEGA_VOICES] }, expectWebSearch: { max: 20 } },
    logPayload: (i) => ({ sdpLength: String(i.sdp || "").length, voice: i.voice || null, expectWebSearch: i.expectWebSearch || null }),
    // The SDP answer (remote candidates, DTLS fingerprint) goes back to the browser only; the command log keeps its length.
    logResult: (r) => ({ sessionId: r?.sessionId, voice: r?.voice, maxDurationS: r?.maxDurationS, idleTimeoutS: r?.idleTimeoutS, authority: r?.authority, answerSdpLength: String(r?.answerSdp || "").length }),
    execute: async (input, ctx) => hub.lega.start({ sdp: input.sdp, voice: input.voice, actor: ctx.actor, ownerSessionId: ctx.ownerSession?.id || null, expectWebSearch: input.expectWebSearch || null }) });
  reg("lega.session.connected", { describe: "Browserul confirmă conexiunea audio (pornește cronometrul sesiunii)", schema: { sessionId: { required: true, max: 80 } },
    execute: (input) => hub.lega.connected(input.sessionId) });
  reg("lega.session.stop", { describe: "Oprește sesiunea Lega", async: true, schema: { sessionId: { max: 80 }, reason: { max: 80, default: "user" } }, channels: ["ui", "test", "voice", "companion"],
    // "current" stops whatever session is live (the browser may not know the id yet while a start is in flight).
    execute: async (input, ctx) => (hub.lega.active() ? hub.lega.stop(input.sessionId && input.sessionId !== "current" ? input.sessionId : undefined, input.reason || "user", ctx.actor) : hub.lega.state()) });
  reg("lega.propose_run", { describe: "Execuție propusă de Lega: pornește doar după aprobarea ta prin click, apoi trece prin poarta de execuție", async: true,
    // M09: the model is part of what the owner approves (Claude requires an explicit alias; an empty Codex model is the account
    // default pinned at the start, as for a manual run).
    schema: { projectId: { required: true, max: 80 }, provider: { enum: ["codex", "claude"], required: true }, access: { enum: ["read-only", "workspace-write"], default: "read-only" },
      task: { required: true, min: 3, max: LEGA_TASK_MAX }, legaSessionId: { max: 80 }, model: { max: 80, default: "" }, effort: { enum: ["low", "medium", "high", "xhigh", "max"] } },
    channels: ["voice", "test"],
    action: (input) => ({ actionKind: "lega.run_request", target: `${input.provider}:${input.projectId}:${input.access}` }),
    execute: async (input, ctx) => {
      const project = need(projects.get(input.projectId), "Project");
      if (!project.executionAllowed) throw new HubError("policy", `${project.name} nu este activat pentru execuții`);
      const conversation = bus.transaction(() => conversations.create({ projectId: project.id, title: `Lega · ${input.task.replace(/\s+/g, " ").slice(0, 60)}` }, "lega"));
      bus.transaction(() => conversations.addMessage({ conversationId: conversation.id, role: "user", content: input.task }, "lega"));
      try {
        const started = await runs.start({ conversationId: conversation.id, provider: input.provider, access: input.access, model: input.model || "", effort: input.effort || "", actor: "lega", correlationId: ctx.correlationId, ...requestTiming(ctx) });
        if (input.legaSessionId) hub.lega.trackRun(started.run.id, { sessionId: input.legaSessionId, task: input.task });
        return { conversationId: conversation.id, runId: started.run.id };
      } catch (error) {
        if (input.legaSessionId) hub.lega.proposalFailed(input.legaSessionId, String(error.message).slice(0, 200)).catch(() => {});
        throw error;
      }
    } });
  reg("lega.propose_mission", { describe: "Misiune propusă de Lega: se creează (ciornă, fără execuții) doar după aprobarea ta prin click",
    schema: { projectId: { required: true, max: 80 }, kind: { enum: Object.keys(MISSION_TEMPLATES), required: true }, title: { required: true, min: 3, max: 160 },
      objective: { required: true, min: 5, max: LEGA_TASK_MAX }, acceptance: { type: "array", max: 10, items: "string" }, legaSessionId: { max: 80 } },
    channels: ["voice", "test"],
    action: (input) => ({ actionKind: "lega.mission_request", target: `${input.projectId}:${input.kind}` }),
    execute: (input, ctx) => {
      const acceptance = (input.acceptance || []).map((a) => String(a).slice(0, 300));
      const mission = createMission({ projectId: input.projectId, kind: input.kind, title: input.title, objective: input.objective, acceptance }, ctx.actor);
      if (input.legaSessionId) hub.lega.announce(input.legaSessionId, `Misiunea „${input.title.slice(0, 60)}” a fost creată, ca ciornă.`).catch(() => {});
      return mission;
    } });
  reg("voice.command", { describe: "Comandă vocală (transcrierea nu poate aproba nimic)", async: true, schema: { transcript: { required: true, max: 2000 } }, channels: ["ui", "test", "voice"],
    execute: async (input) => {
      const parsed = parseVoiceCommand(input.transcript);
      bus.emit({ type: "voice.command", scopeType: "system", scopeId: "voice", source: "voice", payload: { kind: parsed.kind, command: parsed.command || null } });
      if (parsed.kind === "command" && parsed.command === "stop_all") return { ...parsed, result: (await commands.dispatch({ type: "system.stop_all", channel: "voice", actor: "voice", payload: {} })).result };
      if (parsed.kind === "command" && parsed.command === "pause") {
        const r = await commands.dispatch({ type: "gate.set", channel: "voice", actor: "voice", payload: { action: "suspend", reason: "Voice: pause (no new runs)" } });
        // M10.2 (#7): every pause path pauses the running operation plans too (fail-safe; resuming still needs the owner session).
        try { hub.interrupts?.pauseOpsPlans?.({ actor: "voice", reason: "Pauză (voce)" }); } catch { /* a pause never fails because of a plan */ }
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
