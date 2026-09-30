import fs from "node:fs";
import path from "node:path";
import { openDatabase } from "./storage/db.mjs";
import { createEventBus } from "./events/bus.mjs";
import { createSettings } from "./domain/settings.mjs";
import { createProjects } from "./domain/projects.mjs";
import { createConversations } from "./domain/conversations.mjs";
import { createMissions } from "./domain/missions.mjs";
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
export function createHub(config, { providerOverrides = {}, homeDir } = {}) {
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
  const gate = createGate({ db, settings, projects, backups, leases, grants, breakers, providerState, clock, activeRunCount: () => runs.activeCount() });
  runs = createRunManager({ db, bus, clock, settings, projects, conversations, missions, gate, leases, grants, backups, approvals, providers, breakers, usage, live, policy, skills,
    supervisorRecord: (key) => supervisor.get(key) });
  const checkpoints = createCheckpoints({ db, bus, clock, projects, conversations, missions, approvals, leases, backups });
  const handoffs = createHandoffs({ db, bus, clock, conversations, missions, projects, leases, approvals, supervisor, runs, checkpoints });
  const tools = createTools({ db, bus, clock, projects, approvals, supervisor, config });
  const integrations = createIntegrations({ db, bus, clock, config, toolDefinitions: tools.definitions });
  const router = createRouter({ db, bus, clock, config, settings, surfaces, providerState, usage, projects, telemetry, computer, company, roleConfig });
  const commands = createCommandBus({ db, bus, clock, policy, approvals });

  const hub = { config, db, bus, live, settings, projects, conversations, missions, approvals, policy, leases, grants, providerState, usage, memory, leads,
    company, chiefOfStaff, surfaces, schedules, computer, skills, artifacts, integrations, nativeSessions, telemetry, router, commands, checkpoints,
    breakers, supervisor, backups, providers, gate, runs, handoffs, tools, roleConfig, skillConfig, capabilityConfig };
  registerCommands(commands, hub);

  const scheduler = createScheduler({ db, bus, clock, approvals, leases, runs,
    extraTick: () => schedules.tick((cmd) => commands.dispatch({ ...cmd, channel: "schedule", actor: "scheduler" }).then((r) => r.result)) });
  hub.scheduler = scheduler;

  // Post-commit reactions (each in its own transaction; never inside the writer's transaction).
  bus.subscribe((event) => {
    if (event.runId && ["run.completed", "run.failed", "run.interrupted"].includes(event.type)) {
      try { handoffs.checkAcknowledgement(event.runId); } catch { /* reported through handoff state */ }
      try { telemetry.recordRun(event.runId); } catch { /* telemetry never breaks a run */ }
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
    bootReport.seeded = { ...seeded, skills: skillImport };
    if (!config.testMode) scheduler.start();
    bus.emit({ type: "system.booted", scopeType: "system", scopeId: bootId, source: "hub", payload: { mode: settings.get("mode"), gate: settings.get("executionGate").status } });
    return bootReport;
  }

  async function close() {
    scheduler.stop();
    await supervisor.stopAll();
    db.close();
  }

  return Object.assign(hub, { boot, close, bootId, getBootReport: () => bootReport });
}
