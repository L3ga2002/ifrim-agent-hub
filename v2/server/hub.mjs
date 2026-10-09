import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { openDatabase, preMigrationBackupOf } from "./storage/db.mjs";
import { HUB_VERSION } from "./config.mjs";
import { convertLegacyAttestations } from "./policy/billing-evidence.mjs";
import { createEventBus } from "./events/bus.mjs";
import { createSettings } from "./domain/settings.mjs";
import { createProjects } from "./domain/projects.mjs";
import { createConversations } from "./domain/conversations.mjs";
import { createMissions, MISSION_TEMPLATES } from "./domain/missions.mjs";
import { buildBriefing } from "./domain/briefing.mjs";
import { createBackupService } from "./domain/backups.mjs";
import { createGrants, createProviderState } from "./domain/grants.mjs";
import { createUsage } from "./domain/usage.mjs";
import { createMemory } from "./domain/memory.mjs";
import { createLeads } from "./domain/leads.mjs";
import { createSales } from "./sales/sales.mjs";
import { createCompany } from "./domain/company.mjs";
import { createChiefOfStaff } from "./domain/chief-of-staff.mjs";
import { createSurfaces } from "./domain/surfaces.mjs";
import { createSchedules } from "./domain/schedules.mjs";
import { createComputerRuntime } from "./domain/computer.mjs";
import { createSkills } from "./domain/skills.mjs";
import { createArtifacts } from "./domain/artifacts.mjs";
import { createIntegrations } from "./domain/integrations.mjs";
import { createApprovals } from "./policy/approvals.mjs";
import { createApprovalPolicy } from "./policy/approval-policy.mjs";
import { createGate, createBreakers } from "./policy/gate.mjs";
import { codexDeniedEntries, denyListFingerprint } from "./policy/isolation.mjs";
import { createCodexRealtime } from "./providers/codex-realtime.mjs";
import { createLega } from "./runtime/lega.mjs";
import { createLeases } from "./runtime/leases.mjs";
import { createSupervisor } from "./runtime/supervisor.mjs";
import { createRunManager } from "./runtime/runs.mjs";
import { createHandoffs } from "./runtime/handoff.mjs";
import { createCheckpoints } from "./runtime/checkpoints.mjs";
import { createTelemetry } from "./runtime/telemetry.mjs";
import { createRouter } from "./runtime/router.mjs";
import { createCommandBus } from "./runtime/commands.mjs";
import { registerCommands } from "./runtime/command-catalog.mjs";
import { recoverOnBoot, createScheduler } from "./runtime/recovery.mjs";
import { createCodexAdapter } from "./providers/codex.mjs";
import { createClaudeAdapter } from "./providers/claude.mjs";
import { createNativeSessionMirror } from "./providers/native-sessions.mjs";
import { createTools } from "./tools/registry.mjs";
import { createFactory } from "./factory/factory.mjs";
import { createFactoryRunner } from "./factory/runner.mjs";
import { createRoutedFactoryRunner } from "./factory/routed-runner.mjs";
import { createWslRunnerEnvironment } from "./environments/wsl-runner.mjs";
import { createWslFactoryRunner } from "./environments/wsl-factory-runner.mjs";
import { createEnvironmentRegistry } from "./environments/registry.mjs";
import { createWslCodexAdapter } from "./providers/codex-wsl.mjs";
import { createWslClaudeAdapter } from "./providers/claude-wsl.mjs";
import { newId } from "./core/ids.mjs";
import { createTrust, SESSION_DEFAULTS } from "./owner/trust.mjs";
import { createEnvelopes } from "./owner/envelopes.mjs";
import { registerRunPlanner } from "./owner/planners/run.mjs";
import { registerDeliveryPlanner } from "./owner/planners/delivery.mjs";
import { createArmedWindows } from "./owner/armed-window.mjs";
import { createCockpit } from "./owner/cockpit.mjs";
import { createInterrupts } from "./owner/interrupts.mjs";
import { createAdvisor } from "./owner/advisor.mjs";
import { createVoice } from "./owner/voice.mjs";
import { createVoiceEngine } from "./owner/voice-engine.mjs";
import { createSetup } from "./owner/setup.mjs";
import { createTwin } from "./intel/twin.mjs";
import { createWarRoom } from "./intel/warroom.mjs";
import { createAutopilot } from "./intel/autopilot.mjs";
import { createBoard } from "./intel/board.mjs";
import { createSimulations } from "./intel/simulation.mjs";
import { createLeague } from "./intel/league.mjs";
import { createSkillEvolution } from "./intel/skill-evolution.mjs";
import { createTeach } from "./intel/teach.mjs";
import { createDevices } from "./intel/devices.mjs";
import { createPackages } from "./intel/packages.mjs";
import { createMedia } from "./media/index.mjs";
import { createDesktopOperator } from "./desktop/operator.mjs";
import { createExecutors } from "./ops/executors.mjs";
import { createOpsPlans } from "./ops/plans.mjs";
import { createDeliveries, DELIVERY_PHASE_OPS } from "./delivery/delivery.mjs";
import { createDeliveryExecutors } from "./delivery/executors.mjs";
import { createOfficeExecutors } from "./delivery/office-executors.mjs";
import { createKnowledge } from "./owner/knowledge.mjs";
import { createDevProfileReader } from "./owner/dev-profile.mjs";
import { setExtraCommands } from "./factory/spec.mjs";
import { createProbe, registerProbeCommands } from "./owner/probe.mjs";
import { createWorkRequests, registerWorkRequestCommands } from "./owner/work-requests.mjs";
import { createReadinessRunner, collectFacts } from "./owner/readiness-runner.mjs";
import { explain as explainBlockers } from "./owner/blockers.mjs";
import { createBlockedRecorder } from "./owner/planners/engineering.mjs";
import { createGateRearm } from "./owner/gate-rearm.mjs"; // M10.2.1: contextual gate rearm (wired below, after the preserved requests)
import { createStopScope } from "./owner/stop-scope.mjs"; // 2.12.1 (D22): what a stop itself stopped (wired with the gate rearm)
import { createLeaseReconciler } from "./runtime/lease-reconcile.mjs"; // 2.12.2 (P0-R1): retained-lease reconciliation (wired below, after the scheduler)

/** Live (non-persisted) channel for token deltas; persisted state is always reloadable from the API. */
function createLiveChannel() {
  const listeners = new Set();
  return {
    publish(event) { for (const listener of listeners) { try { listener(event); } catch { /* ignore */ } } },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
}

/**
 * Assembles the Hub from its modules — the ONE control plane. Pure wiring: no network listener, no
 * provider call and no run is started here. `boot()` runs recovery (safe mode), seeds the company,
 * surfaces, integrations, computer environments and skills, and starts housekeeping.
 */
export function createHub(config, { providerOverrides = {}, homeDir, browserLaunch = null } = {}) {
  const clock = config.now;
  fs.mkdirSync(config.dataDir, { recursive: true });
  // M10: a pending migration on an existing database is preceded by a verified copy (refused, Hub not started, if it fails).
  const db = openDatabase(config.dbPath, { preMigrationBackupDir: config.preUpgradeDir, appVersion: HUB_VERSION });
  const preMigrationBackup = preMigrationBackupOf(db);
  const bus = createEventBus(db, clock);
  const live = createLiveChannel();
  const roleConfig = JSON.parse(fs.readFileSync(path.join(config.v2Root, "config", "roles.json"), "utf8"));
  const skillConfig = JSON.parse(fs.readFileSync(path.join(config.v2Root, "config", "skills.json"), "utf8"));
  const capabilityConfig = JSON.parse(fs.readFileSync(path.join(config.v2Root, "config", "capabilities.json"), "utf8"));

  const settings = createSettings(db, bus, clock);
  const projects = createProjects({ db, bus, config, clock });
  const conversations = createConversations({ db, bus, config, clock });
  const missions = createMissions({ db, bus, clock });
  const approvals = createApprovals(db, bus, clock);
  const policy = createApprovalPolicy({ db, bus, clock });
  const leases = createLeases(db, bus, clock);
  const grants = createGrants({ db, bus, clock });
  const providerState = createProviderState({ db, clock });
  const usage = createUsage({ db, settings, clock });
  const memory = createMemory({ db, bus, clock });
  const leads = createLeads({ db, bus, clock });
  const sales = createSales({ db, bus, clock, config, settings });
  const company = createCompany({ db, bus, clock, roleConfig });
  const chiefOfStaff = createChiefOfStaff({ db, company, missions, projects, approvals, clock });
  const surfaces = createSurfaces({ db, bus, clock, config, providerState });
  const schedules = createSchedules({ db, bus, clock, settings });
  const computer = createComputerRuntime({ db, bus, clock, config, leases, policy });
  const skills = createSkills({ db, bus, clock, config, roleConfig });
  const artifacts = createArtifacts({ db, bus, clock, projects });
  const breakers = createBreakers(clock);
  const supervisor = createSupervisor({ config, onEvent: (event) => live.publish({ type: `supervisor.${event.type}`, data: event }) });
  const backups = createBackupService({ db, bus, config, clock, projects });
  const nativeSessions = createNativeSessionMirror({ db, bus, clock, config, projects });
  // M09-A2: the random salt of the pseudonymous account identity, created once (at first use or at boot) and kept in settings.
  const identitySalt = () => {
    const current = settings.get("billingIdentitySecret");
    if (typeof current === "string" && /^[0-9a-f]{64}$/.test(current)) return current;
    const created = crypto.randomBytes(32).toString("hex");
    bus.transaction(() => settings.set("billingIdentitySecret", created, "hub", "Billing identity salt created"));
    return created;
  };
  const providers = {
    codex: providerOverrides.codex || createCodexAdapter({ config, supervisor, homeDir, identitySalt }),
    claude: providerOverrides.claude || createClaudeAdapter({ config, supervisor, homeDir, identitySalt }),
  };
  // M05: execution environments. The wsl-runner service only inspects, attests and moves workspaces; a project uses it
  // only after the owner selects that route for it (settings.projectEnvironments).
  const wslRunner = createWslRunnerEnvironment({ config, db, bus, clock, providerState, supervisor, homeDir: homeDir || os.homedir(), identitySalt });
  const environments = createEnvironmentRegistry({ settings, services: { "wsl-runner": wslRunner } });
  providers["codex@wsl-runner"] = providerOverrides["codex@wsl-runner"] || createWslCodexAdapter({ environment: wslRunner });
  // M07: the read-only reviewer inside the same environment (routed only when its readiness is ok; see environments/registry.mjs).
  providers["claude@wsl-runner"] = providerOverrides["claude@wsl-runner"] || createWslClaudeAdapter({ environment: wslRunner, config, supervisor });
  const telemetry = createTelemetry({ db, bus, clock });
  let runs;
  let lega = null;
  let voice = null; // M07: created after the envelopes' dependencies; Lega reads it late-bound (the voice-gate bypass check)
  // M10: the owner-session trust is created after Lega; Lega reads it late-bound (never during construction) for the derived
  // one-click voice authority. Until it is bound, every derivation is refused (fail-safe).
  let ownerTrust = null;
  /** The owner session behind a derived Lega start, re-read from the database: active, not expired, not idle, credential active, voice-first. */
  // `assumeTouched`: a preview (GET, which does not touch the session) computes the limit as the start POST will see it — that
  // request touches the session, so the idle deadline moves to now + idleMinutes. The validity checks are the same either way.
  const legaOwnerAuthority = (sessionId, { assumeTouched = false } = {}) => {
    const tr = ownerTrust;
    const policyActive = Boolean(tr?.policy()?.active);
    if (!tr || !sessionId) return { ok: false, reason: "no-session", policyActive };
    let s;
    try { s = tr.requireSession({ id: sessionId }, "pornirea Lega"); } catch { return { ok: false, reason: "session-ended", policyActive }; }
    const t = clock().getTime();
    const idleEnds = Date.parse(s.idleExpiresAt);
    if (!(idleEnds > t)) return { ok: false, reason: "session-idle", policyActive };
    if (tr.credential(s.credentialId)?.status !== "active") return { ok: false, reason: "credential-revoked", policyActive };
    if (!policyActive) return { ok: false, reason: "policy-legacy", policyActive };
    const idleLimit = assumeTouched ? t + SESSION_DEFAULTS.idleMinutes * 60000 : idleEnds;
    return { ok: true, sessionId: s.id, endsAt: Math.min(Date.parse(s.expiresAt), idleLimit), policyActive };
  };
  // The exact paths the Codex profile denies on this machine; a recorded consent is valid only for this list.
  // Globs included (M03 R3): a consent given for the M02 list does not cover config.toml / history.jsonl.
  const codexIsolation = () => { const paths = codexDeniedEntries({ homeDir: homeDir || os.homedir(), extra: [config.dataDir, config.backupDir] }); return { paths, fingerprint: denyListFingerprint(paths) }; };
  const gate = createGate({ db, settings, projects, backups, leases, grants, breakers, providerState, clock, activeRunCount: () => runs.activeCount() + (lega?.active() ? 1 : 0), codexIsolation, environments });
  runs = createRunManager({ db, bus, clock, settings, projects, conversations, missions, gate, leases, grants, backups, approvals, providers, breakers, usage, live, policy, skills, providerState, environments,
    supervisorRecord: (key) => supervisor.get(key) });
  const checkpoints = createCheckpoints({ db, bus, clock, projects, conversations, missions, approvals, leases, backups });
  const handoffs = createHandoffs({ db, bus, clock, conversations, missions, projects, leases, approvals, supervisor, runs, checkpoints });
  const tools = createTools({ db, bus, clock, projects, approvals, supervisor, config });
  const integrations = createIntegrations({ db, bus, clock, config, toolDefinitions: tools.definitions });
  const router = createRouter({ db, bus, clock, config, settings, surfaces, providerState, usage, projects, telemetry, computer, company, roleConfig });
  const commands = createCommandBus({ db, bus, clock, policy, approvals });
  // Lega (voice): a separate Codex app-server with GPT-Live; admitted by gate.evaluateVoice, stopped by Stop All.
  const refreshCodexConfig = () => {
    try { const current = providerState.get("codex") || {}; if (providers.codex.inspectConfig) providerState.set("codex", { ...current, config: providers.codex.inspectConfig() }); } catch { /* reported by the gate */ }
    try { const current = providerState.get("claude"); if (current && providers.claude.inspectConfig) providerState.set("claude", { ...current, config: providers.claude.inspectConfig() }); } catch { /* reported by the gate */ }
  };
  const legaRead = {
      briefing: () => buildBriefing({ db, settings, missions, backups, projects, clock }),
      recentRuns: (limit) => db.prepare(`SELECT r.provider, r.status, r.access, r.error_category, r.created_at, r.output_message_id, p.name AS project_name
        FROM agent_runs r LEFT JOIN conversations c ON c.id = r.conversation_id LEFT JOIN projects p ON p.id = c.project_id ORDER BY r.created_at DESC LIMIT ?`).all(limit)
        .map((r) => ({ provider: r.provider, status: r.status, access: r.access, errorCategory: r.error_category, createdAt: r.created_at, outputMessageId: r.output_message_id, projectName: r.project_name })),
    // Late-bound below: the factory is created after Lega (it needs the run manager's voice hook first).
    factorySummary: null,
  };
  // M10.2: the intake, the preserved requests and the blocker explainer are created after Lega; filled after registerCommands.
  const legaLate = { intake: null, recordBlocked: null, explain: null, cockpitBrief: null };
  lega = createLega({ config, bus, live, clock, settings, gate, grants, projects, approvals, missions, missionKinds: Object.keys(MISSION_TEMPLATES), db, late: legaLate,
    readApi: legaRead,
    runsApi: { activeRuns: () => runs.activeRuns(), getRun: (id) => runs.getRun(id), admitCodexUsage: (snapshot) => usage.admit("codex", snapshot),
      messageText: (id) => db.prepare("SELECT content FROM messages WHERE id = ?").get(id)?.content || "" },
    commandsApi: { dispatch: (request) => commands.dispatch(request) },
    codexRealtime: createCodexRealtime({ codex: providers.codex, supervisor }), refreshCodexConfig, codexConfig: () => providerState.get("codex")?.config || null, timeScale: config.legaTimeScale,
    voiceGateCheck: (sessionId) => ({ enabled: Boolean(settings.get("voiceGate")?.enabled), released: voice ? voice.recentGateRelease(sessionId) : false }),
    ownerAuthority: legaOwnerAuthority });
  runs.attachVoice(lega);
  // Software Factory (M03): a deterministic conductor over missions/runs; its runner uses the Codex sandbox, never Hub rights.
  const windowsRunner = createFactoryRunner({ config, supervisor, settings, providerState, codexIsolation, homeDir: homeDir || os.homedir() });
  const factoryRunner = createRoutedFactoryRunner({ windows: windowsRunner, environments, settings,
    runners: { "wsl-runner": createWslFactoryRunner({ config, supervisor, environment: wslRunner, settings }) } });
  const factory = createFactory({ db, bus, clock, config, settings, projects, conversations, missions, runs, supervisor, runner: factoryRunner, leases, browserLaunch });
  runs.attachFactory(factory);
  legaRead.factorySummary = (missionId) => factory.summary(missionId);
  legaRead.sales = sales;
  handoffs.attachFactory(factory);

  // M06 (Lega 2.0): the owner's trusted session, the product policy, Mission Authorization Envelopes, the project cockpit,
  // interruptions, quiet proactivity / recommendations / shadow reviews and the local voice profile. Built on the modules
  // above; the envelope service is the factory's authority hook (no envelope = M03–M05 behaviour).
  // Stage before M12: the local development profile is read from the instance's private data folder (tests inject config.devProfile).
  const trust = createTrust({ db, bus, clock, settings, config, devProfile: createDevProfileReader({ dataDir: config.dataDir, override: config.devProfile, clock }) });
  ownerTrust = trust; // M10: Lega's derived voice authority reads the owner session from here (late-bound above)
  // M07: the local voice engines (whisper.cpp + CAM++ in a supervised worker) and the server-held utterances; created before the
  // envelopes, which consume a spoken confirmation's utterance in the same transaction that confirms the plan.
  const voiceEngine = createVoiceEngine({ config, supervisor, clock, onEvent: (event) => live.publish(event) });
  voice = createVoice({ db, bus, clock, settings, config, trust, engine: voiceEngine });
  /*
   * M10.2 U13: ONE armed-window registry for envelopes and operation plans (owner/armed-window.mjs). Whether a plan may be armed for a
   * Lega session is decided HERE over server facts only: the voice-first policy; the live Lega session read from Lega's internals
   * (active, derived from an owner session that is still valid — never a page's claim); that owner session being the confirming one;
   * the global local voice gate on (owner decision 8) and this session started with it; an active profile of the current verifier;
   * local transcription available. Nothing is written by this check.
   */
  const armedWindows = createArmedWindows({ clock, bus,
    readUtterance: (id) => voice.peekUtterance(id),
    verifyLega: (legaSessionId, ownerSessionId = null) => {
      if (!trust.policy()?.active) return { ok: false, reason: "politica voice-first nu este activă" };
      const a = lega?.authorityOf ? lega.authorityOf(legaSessionId) : null;
      if (!a || a.status !== "active" || a.stopping) return { ok: false, reason: "fereastra vocală se deschide doar într-o sesiune Lega activă" };
      if (a.authority !== "owner_session" || !a.ownerSessionId) return { ok: false, reason: "sesiunea Lega nu e pornită din sesiunea ta de proprietar (calea veche, cu grant, nu confirmă prin voce)" };
      if (ownerSessionId && a.ownerSessionId !== ownerSessionId) return { ok: false, reason: "sesiunea Lega aparține altei sesiuni de proprietar" };
      const auth = legaOwnerAuthority(a.ownerSessionId);
      if (!auth.ok) return { ok: false, reason: "sesiunea ta de proprietar nu mai e validă" };
      const vs = voice.status();
      if (!vs.profile) return { ok: false, reason: "lipsește profilul tău vocal" };
      if (!vs.gate?.enabled || !a.gated) return { ok: false, reason: "filtrul vocal local nu rulează în această sesiune Lega" };
      if (!vs.localTranscription?.available) return { ok: false, reason: "transcrierea locală nu e disponibilă acum" };
      return { ok: true, ownerSessionId: a.ownerSessionId };
    } });
  // Gate segments of a Lega session are bound by the server to the plan armed for it (the page's tag is only advisory).
  voice.setArmedResolver((q) => armedWindows.planFor(q));
  const envelopes = createEnvelopes({ db, bus, clock, settings, projects, missions, grants, gate, approvals, commands, trust, factory, factoryRunner, environments, config, voice, armedWindows });
  factory.attachAuthority((missionId, step) => envelopes.authorityFor(missionId, step));
  // M10.2 (U12): a confirmed run plan starts its ONE step through the ordinary run manager (no approval, no factory).
  envelopes.attachRuns({ runs, conversations });
  // M10.2: a confirmed plan admits its own bound steps in BUILD_SAFE (the gate is created before the envelopes, so late-bound).
  gate.attachEnvelopeAuthority((missionId, bindingHash, ctx) => envelopes.liveAuthority(missionId, bindingHash, ctx));
  const cockpit = createCockpit({ db, bus, clock, settings, projects, missions, runs, factory, factoryRunner, envelopes, environments, providerState, company });
  const interrupts = createInterrupts({ db, bus, clock, settings, runs, factory, envelopes, checkpoints, projects, live });
  const advisor = createAdvisor({ db, bus, clock, settings, approvals, envelopes, runs, factory, conversations, projects, grants });

  // M08 (project autopilot & company intelligence): every service reads and writes through the modules above — one database, one
  // memory, one command bus, the same envelopes and grants. Nothing here starts a model by itself.
  const twin = createTwin({ db, bus, clock, projects, settings, envelopes, approvals });
  const warroom = createWarRoom({ db, bus, clock, projects, twin, missions, factory, commands });
  const autopilot = createAutopilot({ db, bus, clock, projects, factory, commands, envelopes });
  const simulations = createSimulations({ db, bus, clock });
  const league = createLeague({ db, config });
  const skillEvolution = createSkillEvolution({ db, bus, clock });
  skills.setOverlay((projectId) => skillEvolution.overlayFor(projectId));
  const teach = createTeach({ db, bus, clock, memory, projects });
  const voiceProfilesDir = config.testMode || !voiceEngine.paths?.root ? path.join(config.dataDir, "voice") : path.join(voiceEngine.paths.root, "profiles");
  const packages = createPackages({ db, bus, clock, config, settings, projects, environments, voiceProfilesDir });
  const board = createBoard({ db, bus, clock, settings, sales, factory, approvals, envelopes, warroom, autopilot, company, environments, packages });
  const devices = createDevices({ db, bus, clock, commands, factory, envelopes, warroom });
  // Owner-enabled extra verification commands (decision package B3) follow the setting.
  setExtraCommands(settings.get("factoryExtraCommands") || []);
  // M09 Content / Media / Growth: local production (library, edit plans, renders, QA, reviews, variants), hash-bound distribution
  // packs, measured analytics and the Content → Sales link. No model, capture, upload or publication starts from here by itself.
  const media = createMedia({ db, bus, live, clock, config, settings, supervisor, sales, runs, voiceEngine });
  // M10 Lega PC Operator + zero-form plans: the Desktop Operator is the one gate to the owner's desktop (a helper in the interactive
  // session, started on first use, never at boot); operation plans are shown once, confirmed once, and every step re-authorized.
  // 2.12.1 (D22): both read what a stop itself stopped through hub.stopScope (created below with the gate rearm; until then — and in a
  // partial hub — each falls back to its own read-only reader over the same database).
  let stopScopeRef = null;
  const desktop = createDesktopOperator({ db, bus, clock, config, supervisor, settings, trust, media, live, stopScope: () => stopScopeRef });
  const executors = createExecutors({ desktop, media, settings, live });
  const opsPlans = createOpsPlans({ db, bus, clock, settings, trust, voice, apps: desktop.apps, executors, live, desktop, armedWindows,
    folderContext: () => ({ allowed: desktop.allowedFolders(), forbidden: desktop.forbiddenFolders() }), stopScope: () => stopScopeRef });
  // M11 „Ifrim Delivery”: the delivery service (the four delivery tables), its plan steps merged into the executors map (opsPlans reads it
  // lazily) and the envelope as the parent a delivery package plan is DERIVED from — the owner's one confirmation of the envelope that
  // listed these exact steps (hashed). The parent check re-reads the envelope: same hash, confirmed, carrying this delivery.
  const deliveries = createDeliveries({ db, bus, clock, config, settings, projects, missions, factory, media, opsPlans, trust, sales });
  Object.assign(executors, createDeliveryExecutors({ deliveries, factory, media, projects, runner: factoryRunner, supervisor, opsPlans, config }));
  Object.assign(executors, createOfficeExecutors({ deliveries, factory, opsPlans, config }));
  opsPlans.registerParent("envelope", {
    allowedOps: DELIVERY_PHASE_OPS,
    verify: (parent) => {
      const env = envelopes.get(parent?.id);
      if (!env) return { ok: false, reason: "planul confirmat nu mai există" };
      if (env.envelopeHash !== parent.hash) return { ok: false, reason: "planul confirmat s-a schimbat" };
      if (!["ACTIVE", "CONFIRMED", "COMPLETED"].includes(env.status)) return { ok: false, reason: `planul confirmat e ${env.status}` };
      if (env.body?.delivery?.deliveryId !== parent.deliveryId) return { ok: false, reason: "planul confirmat nu conține această livrare" };
      if (!trust.policy?.()?.active) return { ok: false, reason: "politica voice-first nu e activă" };
      return { ok: true };
    },
  });
  envelopes.attachDelivery(deliveries);
  deliveries.attachEnvelopes(envelopes);

  // M10.2 U13: Lega arms a plan it has just SPOKEN (its bridge or its plan tool); the plan's service re-checks everything. A plan already
  // armed in this Lega session keeps its window (re-arming would make a "Da" said in between count as said before the window).
  legaLate.armPresented = ({ legaSessionId, planId, dryRun = false }) => {
    const ownerSessionId = lega.authorityOf(legaSessionId)?.ownerSessionId || null;
    const open = ownerSessionId ? armedWindows.armedFor(planId, ownerSessionId, legaSessionId) : null;
    if (open && !dryRun) return { armed: true, expiresAt: open.expiresAt, already: true };
    if (/^opp_/.test(String(planId))) return opsPlans.armForLega({ planId, legaSessionId, dryRun });
    if (/^env_/.test(String(planId))) return envelopes.armForLega({ envelopeId: planId, legaSessionId, dryRun });
    return { armed: false, reason: "plan necunoscut" };
  };

  const hub = { config, db, bus, live, settings, projects, conversations, missions, approvals, policy, leases, grants, providerState, usage, memory, leads, sales,
    company, chiefOfStaff, surfaces, schedules, computer, skills, artifacts, integrations, nativeSessions, telemetry, router, commands, checkpoints,
    breakers, supervisor, backups, providers, gate, runs, handoffs, tools, roleConfig, skillConfig, capabilityConfig, codexIsolation, lega, refreshCodexConfig, factory, factoryRunner,
    environments, wslRunner, trust, envelopes, armedWindows, cockpit, interrupts, advisor, voice, voiceEngine,
    twin, warroom, autopilot, simulations, league, skillEvolution, teach, packages, board, devices, media, desktop, opsPlans, executors, deliveries };
  registerCommands(commands, hub);
  // Stage before M12: what Lega knows about the system (read-only, from the real registries and tables).
  hub.knowledge = createKnowledge(hub);
  lega?.attachKnowledge?.(hub.knowledge);
  // M10.2 (U12): the "run" planner (one bounded model step → ONE run envelope; propose_run's replacement under voice-first).
  if (hub.intake) hub.runPlanner = registerRunPlanner(hub, hub.intake);
  // M11: the delivery planner (prepare / revise / open), next to the run planner.
  if (hub.intake) hub.deliveryPlanner = registerDeliveryPlanner(hub, hub.intake);
  // M10.2 probe counters (read-only, from the logs) + the owner.nav screen telemetry; observability only, no authority.
  hub.probe = createProbe({ db, bus, config }); registerProbeCommands((type, def) => commands.register(type, def));
  // M10.2 U06: preserved work requests (a blocked request is kept and re-proposed, never run by itself) and the automatic readiness
  // runner (inference-free steps on the automation channel; a same-fingerprint re-attestation only after a plan's confirmation).
  hub.workRequests = createWorkRequests({ db, bus, clock, live, trust, envelopes });
  hub.readiness = createReadinessRunner(hub, { workRequests: hub.workRequests });
  hub.workRequests.attachExplainer((request) => hub.readiness.explainRequest(request));
  registerWorkRequestCommands((type, def) => commands.register(type, def), hub);
  // ---------------------------------------------------------------- M10.2.1: contextual gate rearm (D14–D16)
  // The rearm service reads the recorded suspension and the preserved requests (it re-proposes only the request that showed the
  // card), so it is created after hub.workRequests and hub.envelopes; the commands gate.rearm.card / gate.rearm (owner-commands.mjs)
  // read it at execution time, and the cockpit's „De ce e blocat?” reads its eligibility. Nothing here opens the gate.
  hub.gateRearm = createGateRearm(hub);
  // 2.12.1 (D22): ONE read-only reader of what the current suspension's own stop stopped (the rearm card's facts, the intake's
  // „Continuă”, the plan and desktop resumes); it pauses, resumes and reopens nothing.
  hub.stopScope = stopScopeRef = createStopScope(hub);
  cockpit.attachGateRearm(hub.gateRearm);
  // ---------------------------------------------------------------- end M10.2.1 gate rearm
  // M10.2 U08: Lega on the intake. The voice bridge and lega.request_work reach the same planners as the owner's typed words; a
  // refusal Lega explains itself (propose_run) is kept with the same recorder the intake uses for a planner's "blocked" answer
  // (owner/planners/engineering.mjs: one live request per words, the one-time explanation of work-requests).
  const legaRecorder = createBlockedRecorder(hub);
  legaLate.intake = hub.intake;
  legaLate.recordBlocked = (request) => legaRecorder.recordBlocked(request);
  legaLate.explain = async ({ projectId, intent = "engineering" }) => explainBlockers(await collectFacts(hub, { projectId, intent }));
  // D23: a DERIVED Lega start refreshes a stale / failed / missing Codex account check by itself. This is the SAME inference-free
  // command as „Verifică contul”, issued as an automatic readiness step (channel "automation", actor "readiness:lega-start": the
  // probe counts it under automaticReadinessSteps). Only lega.start calls it — it decides when (derived starts only, once per
  // attempt, bounded and rate-limited; runtime/lega.mjs) and audits it; the ordinary admission then runs on the real facts.
  // The command is dispatched under the start's correlation id (lega.mjs lends it from its audit record), so the start row, this row
  // and its events join; the row exists before dispatch's first await, so its id is returned at once — the audit names it even when
  // the check fails or outlives the start's wait.
  const READINESS_ACTOR = "readiness:lega-start";
  legaLate.refreshAccount = ({ correlationId = null } = {}) => {
    const done = commands.dispatch({ type: "provider.probe", payload: { provider: "codex", withModels: true }, channel: "automation", actor: READINESS_ACTOR, correlationId,
      intentText: "pas automat de pregătire: verificarea contului Codex înainte de pornirea Lega (fără inferență)" });
    const row = commands.list({ type: "provider.probe", limit: 10 }).find((c) => c.correlationId === correlationId && c.actor === READINESS_ACTOR);
    return { commandId: row?.id || null, done };
  };
  // D13: a spoken „Pauză” in a session derived from the owner session is the owner's pause (credential recorded), audited as such.
  // lega.mjs verified the derived authority; the owner session is re-read here (a revoked one throws → the plain suspension runs).
  legaLate.ownerPause = async ({ ownerSessionId, legaSessionId }) => {
    const session = trust.requireSession({ id: ownerSessionId }, "pauza spusă către Lega");
    bus.emit({ type: "lega.owner_pause", scopeType: "system", scopeId: legaSessionId, source: "voice", payload: { ownerSessionId } });
    return interrupts.pause({ actor: `voice:${legaSessionId}`, reason: "Pauză (spusă către Lega)", session });
  };
  // The cockpit shows the environment's invalidation and the project's preserved requests (live facts, read-only).
  const baseProjectCockpit = cockpit.projectCockpit;
  cockpit.projectCockpit = async (projectId) => {
    const data = await baseProjectCockpit(projectId);
    if (data) { try { data.notices = hub.readiness.noticesFor(data.project.id); } catch { data.notices = []; } }
    // M11: the project's deliveries (open first, then the latest), each with the plain sentence Lega says about it — never ids or grants.
    if (data) {
      try {
        data.deliveries = deliveries.list({ projectId: data.project.id }).slice(0, 3).map((d) => ({ id: d.id, title: d.title, status: d.status, statusReason: d.statusReason, labels: d.labels,
          sentence: hub.deliveryPlanner ? hub.deliveryPlanner.summaryLine(deliveries.view(d.id)) : d.statusReason, href: `/livrare/${d.id}` }));
      } catch { data.deliveries = []; }
    }
    return data;
  };
  // M07: the resumable setup (ordered real steps; the automatic ones run on the Hub through the ordinary commands).
  hub.setup = createSetup(hub);

  const scheduler = createScheduler({ db, bus, clock, approvals, leases, runs,
    extraTick: () => Promise.all([schedules.tick((cmd) => commands.dispatch({ ...cmd, channel: "schedule", actor: "scheduler" }).then((r) => r.result)), factory.tick(), Promise.resolve().then(() => sales.tick()),
      Promise.resolve().then(() => envelopes.tick()), Promise.resolve().then(() => voice.tick()), Promise.resolve().then(() => media.tick()),
      Promise.resolve().then(() => lega.tick()), Promise.resolve().then(() => hub.workRequests.tick()), Promise.resolve().then(() => deliveries.tick())]) });
  hub.scheduler = scheduler;
  // ---------------------------------------------------------------- 2.12.2 (P0-R1): retained-lease reconciliation
  // A workspace lease kept after an unconfirmed stop (runs.finalize) or a restart (recovery) is released once its run is finished and its
  // provider process is provably gone: a bounded follow-up after lease.retained and the boot pass (system.recovered) — both subscribed by
  // the reconciler itself — and one more inference-free scheduler pass. It never relaunches anything. The gate rearm reads it at
  // evaluation time (hub.leaseReconciler): what cannot be proven becomes a step of the owner's card. Stop All never waits for it.
  hub.leaseReconciler = createLeaseReconciler(hub);
  scheduler.addTick(() => hub.leaseReconciler.tick());
  // ---------------------------------------------------------------- end 2.12.2 lease reconciliation

  // Post-commit reactions (each in its own transaction; never inside the writer's transaction).
  bus.subscribe((event) => {
    if (event.runId && ["run.completed", "run.failed", "run.interrupted"].includes(event.type)) {
      try { handoffs.checkAcknowledgement(event.runId); } catch { /* reported through handoff state */ }
      try { telemetry.recordRun(event.runId); } catch { /* telemetry never breaks a run */ }
      try { advisor.onRunFinished(event.runId); } catch { /* a shadow comparison never breaks a run */ }
      // A factory step finished: the conductor decides the next one (asynchronously, serialized per mission).
      factory.onRunFinished(event.runId).catch((error) => {
        try { bus.emit({ type: "factory.error", scopeType: "run", scopeId: event.runId, source: "factory", payload: { message: String(error.message).slice(0, 300) } }); } catch { /* shutting down */ }
      });
    }
    // M08 §17 / M10.2 U13: a gate segment's local transcript is final; the plan's service confirms only an ARMED plan, after all its
    // checks — routed by the plan id's prefix (env_ → envelopes, opp_ → operation plans).
    if (event.type === "voice.gate_final" && event.payload?.envelopeId) {
      const p = event.payload;
      const planId = String(p.envelopeId);
      setImmediate(() => {
        const q = { utteranceId: p.utteranceId, sessionId: p.sessionId, legaSessionId: p.legaSessionId || null };
        const out = /^opp_/.test(planId) ? opsPlans.confirmFromArmed({ ...q, planId }) : /^env_/.test(planId) ? envelopes.confirmFromArmed({ ...q, envelopeId: planId }) : null;
        // The outcome is said in the Hub's own words (never model text): a confirmation, or why a confirmation-like sentence did not count.
        Promise.resolve(out).then((r) => {
          if (!r || !p.legaSessionId) return;
          if (r.confirmed && !r.duplicate) lega.announce(p.legaSessionId, "Am auzit „Da, execută planul”: am confirmat planul și pornesc.").catch(() => {});
          else if (!r.confirmed && r.failures) lega.announce(p.legaSessionId, `Nu am confirmat planul: ${String(r.reason || "").replace(/\s+/g, " ").slice(0, 220)}${r.closed ? " Fereastra vocală s-a închis; confirmă cu butonul." : ""}`).catch(() => {});
        }).catch(() => {});
      });
    }
    // M10.2.1 (D18): the owner's verified spoken „Continuă” (a gate segment's final LOCAL transcript, the whole sentence) — the intake
    // re-checks everything and runs the typed executor as the owner session, once per utterance; the Hub says the outcome in its own
    // words (describeResults → speak). 2.12.1: ONE line per sentence, in the intake's words — `say` (a refused claim, a veto the bridge did
    // not already answer, a pointer to the cockpit, a plan waiting) or the intake's prefix (what was heard) + the description of the
    // result; a silent outcome (a duplicate, the session checks Lega's own line answers, a veto the bridge answered) says nothing.
    // M11 (owner decision 2026-10-07): a stop heard locally from an UNCERTAIN voice (never a resume or a start) — the same fail-safe
    // paths every channel has: Stop All on the voice channel, the pause without an owner session, Lega's own silence.
    if (event.type === "voice.stop_heard" && event.payload?.intent) {
      const p = event.payload;
      setImmediate(() => {
        Promise.resolve().then(async () => {
          if (p.intent === "stop_all") await commands.dispatch({ type: "system.stop_all", payload: { reason: "Oprește tot (spus; vocea nu a fost confirmată local, doar oprire)" }, channel: "voice", actor: `voice-local:${p.legaSessionId || "?"}` });
          else if (p.intent === "pause") await hub.interrupts.pause({ actor: `voice-local:${p.legaSessionId || "?"}`, reason: "Pauză (spusă; vocea nu a fost confirmată local, doar oprire)", channel: "voice" });
          else if (p.intent === "mute" && p.legaSessionId) live.publish({ type: "lega.silence", sessionId: p.legaSessionId });
        }).catch(() => {});
      });
    }
    if (event.type === "voice.continue_heard" && event.payload?.utteranceId) {
      const p = event.payload;
      setImmediate(() => {
        Promise.resolve().then(() => hub.intake?.continueFromVoice?.({ utteranceId: p.utteranceId, ownerSessionId: p.ownerSessionId || null, legaSessionId: p.legaSessionId || null }))
          .then((out) => {
            if (!out || out.duplicate || !p.legaSessionId) return null;
            if (out.say) return lega.announce(p.legaSessionId, out.say, { heard: out.heard || "", intents: ["ops_continue"], outcome: out.outcome || "message" });
            if (out.silent || !out.result) return null;
            return lega.announceResults(p.legaSessionId, [out.result], { prefix: out.prefix || "", heard: out.heard || "", intents: ["ops_continue"] });
          }).catch(() => {});
      });
    }
    if (event.type === "settings.changed" && event.payload?.key === "factoryExtraCommands") setExtraCommands(settings.get("factoryExtraCommands") || []);
    // M10.2 U06: an event that may clear a blocker re-explains the preserved requests (a re-proposal at most); a confirmed plan's
    // mission blocked on its environment gets one inference-free readiness pass.
    try { hub.workRequests.onEvent(event); } catch { /* a re-plan never breaks the writer */ }
    try { hub.readiness.onEvent(event); } catch { /* idem */ }
    if (event.scopeType === "task" && ["task.completed", "task.cancelled", "task.failed"].includes(event.type)) {
      try { telemetry.recordTaskOutcome(event.scopeId); } catch { /* ignore */ }
      try { bus.transaction(() => policy.revokeTaskScopes(event.scopeId, `task ${event.type.split(".")[1]}`)); } catch { /* ignore */ }
    }
  });

  function seedRoles() {
    const now = clock().toISOString();
    for (const role of roleConfig.roles) {
      db.prepare(`INSERT INTO agent_roles (id, name, definition_json, version, updated_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET name = excluded.name, definition_json = excluded.definition_json, version = excluded.version, updated_at = excluded.updated_at`)
        .run(role.id, role.name, JSON.stringify(role), roleConfig.version, now);
    }
  }

  /**
   * M09-A2 boot conversion (idempotent): legacy billingAttestations → declarations with source legacy_ui (the legacy key stays,
   * read-only, for rollback). Claude is latched (legacy_unbound): its inference waits for a declaration in the owner session;
   * Codex stays valid until its expiry. The identity salt is created here too, so the first probe never writes settings.
   */
  function convertLegacyBilling() {
    identitySalt();
    return bus.transaction(() => {
      const { evidence, converted } = convertLegacyAttestations({ attestations: settings.get("billingAttestations"), evidence: settings.get("billingEvidence"), now: clock() });
      if (!converted.length) return { converted: [] };
      settings.set("billingEvidence", evidence, "hub", `Legacy billing attestations converted (${converted.join(", ")})`);
      bus.append({ type: "billing.legacy_converted", scopeType: "billing", scopeId: "evidence", source: "hub",
        payload: { providers: converted, reverifyRequired: converted.filter((p) => p === "claude"), note: "Claude: declarația veche nu era legată de cont; reconfirmă în sesiunea de proprietar" } });
      if (converted.includes("claude")) bus.append({ type: "billing.reverify_required", scopeType: "provider", scopeId: "claude", source: "hub", payload: { provider: "claude", reason: "legacy_unbound" } });
      return { converted };
    });
  }

  const bootId = newId("boot");
  let bootReport = null;
  async function boot() {
    projects.syncFromRegistry();
    seedRoles();
    company.seed();
    const seeded = surfaces.seed();
    computer.seed();
    integrations.seed();
    const skillImport = skills.importAll("seed");
    surfaces.refreshAvailability();
    bootReport = await recoverOnBoot({ db, bus, clock, settings, approvals });
    // M10.2 review #10: a run plan whose one turn died with the previous process frees the project's open-plan slot now (grant revoked).
    try { bootReport.runEnvelopes = envelopes.recoverRuns(); } catch (error) { bootReport.runEnvelopes = { error: String(error?.message || error).slice(0, 300) }; }
    // M10: a derived Lega authority whose voice session died with the previous process is closed in the audit (nothing starts).
    try { bootReport.lega = lega.recover(); } catch (error) { bootReport.lega = { error: String(error?.message || error).slice(0, 300) }; }
    bootReport.billing = convertLegacyBilling();
    bootReport.factory = factory.recover();
    // M09: interrupted renders / captures / transcriptions / distribution attempts are marked, never resumed.
    try { bootReport.media = media.boot(); } catch (error) { bootReport.media = { error: String(error?.message || error).slice(0, 300) }; }
    try { deliveries.boot(); } catch (error) { bootReport.deliveries = { error: String(error?.message || error).slice(0, 300) }; }
    // Workspaces a crash left in the environment are marked orphaned and kept for inspection (never deleted at boot).
    bootReport.environments = { "wsl-runner": wslRunner.recover() };
    // M10.2: an attestation that this code no longer accepts (canary version, age) or a stale account check is ANNOUNCED once
    // (event + attention item + cockpit notice), never fixed at boot: no inspection, probe or attestation runs here (decision 3).
    try { bootReport.readiness = hub.readiness.announceAtBoot(); } catch (error) { bootReport.readiness = { error: String(error?.message || error).slice(0, 300) }; }
    // M10: a desktop session or a running plan left by a stop is ended / waits for the owner (never resumed by the boot).
    bootReport.desktop = desktop.recover();
    bootReport.ops = opsPlans.recover();
    bootReport.seeded = { ...seeded, skills: skillImport };
    // M10: the verified copy taken before this boot's migration (absent when nothing was pending).
    bootReport.storage = { preMigrationBackup: preMigrationBackup ? { file: preMigrationBackup.file, sha256: preMigrationBackup.sha256, bytes: preMigrationBackup.bytes,
      fromVersion: preMigrationBackup.schemaVersion, toVersion: preMigrationBackup.toVersion, integrity: preMigrationBackup.integrity, createdAt: preMigrationBackup.createdAt } : null };
    if (preMigrationBackup) bus.transaction(() => bus.append({ type: "storage.pre_migration_backup", scopeType: "system", scopeId: bootId, source: "hub",
      payload: { file: path.basename(preMigrationBackup.file), sha256: preMigrationBackup.sha256.slice(0, 16), fromVersion: preMigrationBackup.schemaVersion, toVersion: preMigrationBackup.toVersion } }));
    if (!config.testMode) scheduler.start();
    // Optional sandbox warm-up (M05 §21): off unless the owner enabled it; no model, no project code, never blocks the boot.
    if (!config.testMode && settings.get("environmentWarmup")?.onBoot) {
      Promise.resolve().then(() => factoryRunner.preflight("windows")).then((result) => bus.emit({ type: "environment.warmup", scopeType: "environment", scopeId: "windows", source: "hub",
        payload: { trigger: "boot", ok: result.ok, sandboxMs: result.sandboxMs ?? null, reason: result.reason || null } })).catch(() => {});
    }
    bus.emit({ type: "system.booted", scopeType: "system", scopeId: bootId, source: "hub", payload: { mode: settings.get("mode"), gate: settings.get("executionGate").status } });
    return bootReport;
  }

  async function close() {
    scheduler.stop();
    envelopes.close();
    await factory.close();
    await lega.stopAll("shutdown").catch(() => {});
    try { deliveries.close_(); } catch { /* closing */ }
    await media.close();
    await desktop.close().catch(() => {});
    await supervisor.stopAll();
    db.close();
  }

  return Object.assign(hub, { boot, close, bootId, getBootReport: () => bootReport, convertLegacyBilling });
}
