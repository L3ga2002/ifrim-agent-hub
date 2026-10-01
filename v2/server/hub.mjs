import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase } from "./storage/db.mjs";
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
import { newId } from "./core/ids.mjs";

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
  const db = openDatabase(config.dbPath);
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
  const providers = {
    codex: providerOverrides.codex || createCodexAdapter({ config, supervisor, homeDir }),
    claude: providerOverrides.claude || createClaudeAdapter({ config, supervisor, homeDir }),
  };
  const telemetry = createTelemetry({ db, bus, clock });
  let runs;
  let lega = null;
  // The exact paths the Codex profile denies on this machine; a recorded consent is valid only for this list.
  // Globs included (M03 R3): a consent given for the M02 list does not cover config.toml / history.jsonl.
  const codexIsolation = () => { const paths = codexDeniedEntries({ homeDir: homeDir || os.homedir(), extra: [config.dataDir, config.backupDir] }); return { paths, fingerprint: denyListFingerprint(paths) }; };
  const gate = createGate({ db, settings, projects, backups, leases, grants, breakers, providerState, clock, activeRunCount: () => runs.activeCount() + (lega?.active() ? 1 : 0), codexIsolation });
  runs = createRunManager({ db, bus, clock, settings, projects, conversations, missions, gate, leases, grants, backups, approvals, providers, breakers, usage, live, policy, skills, providerState,
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
  lega = createLega({ config, bus, live, clock, settings, gate, grants, projects, approvals, missions, missionKinds: Object.keys(MISSION_TEMPLATES),
    readApi: legaRead,
    runsApi: { activeRuns: () => runs.activeRuns(), getRun: (id) => runs.getRun(id), admitCodexUsage: (snapshot) => usage.admit("codex", snapshot),
      messageText: (id) => db.prepare("SELECT content FROM messages WHERE id = ?").get(id)?.content || "" },
    commandsApi: { dispatch: (request) => commands.dispatch(request) },
    codexRealtime: createCodexRealtime({ codex: providers.codex, supervisor }), refreshCodexConfig, codexConfig: () => providerState.get("codex")?.config || null, timeScale: config.legaTimeScale });
  runs.attachVoice(lega);
  // Software Factory (M03): a deterministic conductor over missions/runs; its runner uses the Codex sandbox, never Hub rights.
  const factoryRunner = createFactoryRunner({ config, supervisor, settings, providerState, codexIsolation, homeDir: homeDir || os.homedir() });
  const factory = createFactory({ db, bus, clock, config, settings, projects, conversations, missions, runs, supervisor, runner: factoryRunner, leases, browserLaunch });
  runs.attachFactory(factory);
  legaRead.factorySummary = (missionId) => factory.summary(missionId);
  handoffs.attachFactory(factory);

  const hub = { config, db, bus, live, settings, projects, conversations, missions, approvals, policy, leases, grants, providerState, usage, memory, leads,
    company, chiefOfStaff, surfaces, schedules, computer, skills, artifacts, integrations, nativeSessions, telemetry, router, commands, checkpoints,
    breakers, supervisor, backups, providers, gate, runs, handoffs, tools, roleConfig, skillConfig, capabilityConfig, codexIsolation, lega, refreshCodexConfig, factory, factoryRunner };
  registerCommands(commands, hub);

  const scheduler = createScheduler({ db, bus, clock, approvals, leases, runs,
    extraTick: () => Promise.all([schedules.tick((cmd) => commands.dispatch({ ...cmd, channel: "schedule", actor: "scheduler" }).then((r) => r.result)), factory.tick()]) });
  hub.scheduler = scheduler;

  // Post-commit reactions (each in its own transaction; never inside the writer's transaction).
  bus.subscribe((event) => {
    if (event.runId && ["run.completed", "run.failed", "run.interrupted"].includes(event.type)) {
      try { handoffs.checkAcknowledgement(event.runId); } catch { /* reported through handoff state */ }
      try { telemetry.recordRun(event.runId); } catch { /* telemetry never breaks a run */ }
      // A factory step finished: the conductor decides the next one (asynchronously, serialized per mission).
      factory.onRunFinished(event.runId).catch((error) => {
        try { bus.emit({ type: "factory.error", scopeType: "run", scopeId: event.runId, source: "factory", payload: { message: String(error.message).slice(0, 300) } }); } catch { /* shutting down */ }
      });
    }
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
    bootReport.factory = factory.recover();
    bootReport.seeded = { ...seeded, skills: skillImport };
    if (!config.testMode) scheduler.start();
    bus.emit({ type: "system.booted", scopeType: "system", scopeId: bootId, source: "hub", payload: { mode: settings.get("mode"), gate: settings.get("executionGate").status } });
    return bootReport;
  }

  async function close() {
    scheduler.stop();
    await factory.close();
    await lega.stopAll("shutdown").catch(() => {});
    await supervisor.stopAll();
    db.close();
  }

  return Object.assign(hub, { boot, close, bootId, getBootReport: () => bootReport });
}
