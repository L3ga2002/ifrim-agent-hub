import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HubError } from "../core/errors.mjs";
import { ATTESTATION_TEXT } from "../policy/billing.mjs";
import { R2_ACCEPT_TEXT } from "../policy/isolation.mjs";
import { materializeFixture, demoSpec } from "../factory/fixtures.mjs";

/**
 * Deterministic simulator for visual review and state testing (Milestone 02 §23).
 *
 * It is a SEPARATE Hub process (port 8012 by default) with its own database inside .ifrim/tmp, a synthetic demo
 * project and test mode on: the supervisor refuses to spawn anything outside v2/tests/fixtures, so only the fake
 * Codex/Claude fixtures can run. It cannot reach the real Hub's database, gate or providers. Every screen shows the
 * persistent banner SIM_BANNER; conversations and answers produced here are labelled as fixtures.
 */
export const SIM_BANNER = "SIMULARE — FĂRĂ MODELE REALE";

const V2_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const HUB_ROOT = path.resolve(V2_ROOT, "..");
const FIXTURES = path.join(V2_ROOT, "tests", "fixtures");

/** Config overrides for the simulator process. The data directory must be inside .ifrim/tmp (test-mode rule). */
export function simulationOverrides(env = process.env) {
  const dataDir = path.resolve(env.HUB_V2_DATA_DIR || path.join(HUB_ROOT, ".ifrim", "tmp", "v2-sim", "data"));
  const demo = path.join(dataDir, "demo-project");
  const file = (name) => path.join(dataDir, name);
  return {
    testMode: true, simulation: true, dataDir, hubRoot: demo, projectsRoot: dataDir, hubProjectName: "Proiect demo (SIMULARE)",
    registryPath: file("no-registry.md"), roleRegistryPath: file("no-roles.json"), legacyDbPath: file("no-legacy.sqlite"),
    port: Number(env.HUB_V2_PORT || 8012),
    providerBinaries: {
      codex: { executable: process.execPath, prefixArgs: [path.join(FIXTURES, "fake-codex.mjs"), "--scenario=ok", `--scenario-file=${file("codex.scenario")}`, `--scenario-queue=${file("codex.queue")}`, `--log=${file("codex.log")}`] },
      claude: { executable: process.execPath, prefixArgs: [path.join(FIXTURES, "fake-claude.mjs"), "--fake-scenario=ok", `--fake-scenario-file=${file("claude.scenario")}`, `--fake-scenario-queue=${file("claude.queue")}`, `--fake-log=${file("claude.log")}`] },
    },
  };
}

/**
 * The synthetic demo project is created by v2/scripts/sim.mjs (scripts may run git; v2/server never commits).
 * The server only checks that it exists before a simulator boot.
 */
export function assertDemoProject(dir) {
  if (!fs.existsSync(path.join(dir, ".git")) || !fs.existsSync(path.join(dir, "README.md"))) {
    throw new Error(`Simulator demo project missing at ${dir}; start the simulator with "npm run v2:sim"`);
  }
  return dir;
}

const TERMINAL = new Set(["completed", "failed", "blocked", "interrupted"]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createSimulation(hub) {
  const { config } = hub;
  if (!config.simulation || !config.testMode) throw new Error("The simulator runs only in a simulation (test-mode) process");
  const scenarioFile = (provider) => path.join(config.dataDir, `${provider}.scenario`);
  const setScenario = (provider, name) => fs.writeFileSync(scenarioFile(provider), name);
  const cmd = async (type, payload) => (await hub.commands.dispatch({ type, payload, actor: "simulator", channel: "test" })).result;
  const project = () => hub.projects.hub();

  async function waitRun(runId, timeoutMs = 20000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const run = hub.runs.getRun(runId);
      if (run && TERMINAL.has(run.status)) return run;
      await sleep(100);
    }
    return hub.runs.getRun(runId);
  }

  async function startRun(conversationId, provider, content, scenario, { wait = true, taskId = null } = {}) {
    setScenario(provider, scenario);
    await cmd("conversation.message", { conversationId, content });
    try {
      const task = taskId ? hub.missions.task(taskId) : null;
      const { run } = await hub.runs.start({ conversationId, provider, access: "read-only", actor: "simulator", ...(task ? { taskId, stage: task.stage, roleId: task.roleId } : {}) });
      return wait ? await waitRun(run.id) : run;
    } catch (error) {
      if (error.category === "gate") return hub.runs.getRun(error.details?.runId);
      throw error;
    } finally {
      if (wait) setScenario(provider, "ok");
    }
  }

  /** The fixture reads its scenario at process start: reset the file once the run is active or finished. */
  function resetWhenStarted(provider, runId, timeoutMs = 90000) {
    const started = Date.now();
    const timer = setInterval(() => {
      const active = hub.runs.activeRuns().some((r) => r.runId === runId);
      const done = TERMINAL.has(hub.runs.getRun(runId)?.status);
      if (active || done || Date.now() - started > timeoutMs) { clearInterval(timer); setTimeout(() => setScenario(provider, "ok"), 1500).unref?.(); }
    }, 200);
    timer.unref?.();
  }

  function openGateForFixtures() {
    // Simulation process only: fixture binaries are the only executables the supervisor accepts here.
    const now = new Date().toISOString();
    hub.bus.transaction(() => {
      hub.settings.set("mode", "LIVE_VALIDATION", "simulator", "Simulare: fixture-uri, fără modele");
      hub.settings.set("executionGate", { status: "open", reason: "Simulare: doar fixture-uri", changedAt: now, changedBy: "simulator" }, "simulator");
      hub.settings.set("billingAttestations", { codex: { confirmedAt: now, text: ATTESTATION_TEXT.codex }, claude: { confirmedAt: now, text: ATTESTATION_TEXT.claude } }, "simulator");
      // Fixture providers only: no real sandbox writes ACEs here; the consent mirrors the real flow for the UI.
      hub.settings.set("isolationConsent", { codex: { confirmedAt: now, fingerprint: hub.codexIsolation().fingerprint, simulated: true } }, "simulator");
      // The synthetic demo project is a registry project; the R2 acceptance mirrors the real flow (fixtures only, no host access).
      const demo = project();
      hub.settings.set("r2Acceptance", { [demo.id]: { confirmedAt: now, expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(), projectPath: demo.path, text: R2_ACCEPT_TEXT, simulated: true } }, "simulator");
    });
  }

  async function probeFixtures() {
    for (const id of ["codex", "claude"]) {
      const installation = await hub.providers[id].inspectInstallation();
      const probe = await hub.providers[id].probe({ withUsage: true, withModels: id === "codex" });
      hub.providerState.set(id, { ...probe, installation });
    }
    hub.surfaces.refreshAvailability();
    const p = project();
    hub.bus.transaction(() => {
      for (const provider of ["codex", "claude"]) hub.grants.create({ provider, projectId: p.id, access: "read-only", maxAttempts: 5, maxDurationS: 900, ttlMinutes: 480, note: "Simulare (fixture-uri)" }, "simulator");
    });
  }

  /** Deterministic baseline: mission with varied task states, results, a quota failure, a pending approval and a ready handoff. */
  async function seed() {
    assertDemoProject(config.hubRoot);
    openGateForFixtures();
    await probeFixtures();
    const p = project();
    try { await hub.backups.run(p.id, "simulare: backup inițial", "simulator"); } catch { /* the gate creates one before the first run */ }

    const mission = await cmd("mission.create", { projectId: p.id, kind: "development", title: "Pagină de contact (SIMULARE)",
      objective: "Formular de contact validat, cu test automat și review, pe proiectul demo.",
      acceptance: ["Câmpurile obligatorii sunt validate", "Testul `npm test` trece", "Diff revizuit de alt provider"], constraints: ["Doar proiectul demo", "Fără date reale"] });
    const missionId = mission.id;
    const tasks = hub.missions.tasks(missionId);
    const conversationId = mission.conversationId;

    const safe = async (fn) => { try { return await fn(); } catch (error) { console.error(`[sim] ${error.message}`); return null; } };
    // Task 1: queued → run (fixture) → VERIFYING → verified → COMPLETED (real state machine).
    if (tasks[0]) {
      await safe(() => cmd("task.command", { taskId: tasks[0].id, action: "queue" }));
      await startRun(conversationId, "codex", "Planifică validarea câmpurilor din src/app.js. Doar citire.", "ok", { taskId: tasks[0].id });
      await safe(() => cmd("task.command", { taskId: tasks[0].id, action: "verify", evidence: { manualVerification: "Simulare: planul fixture a fost verificat vizual." } }));
    }
    // Task 2: queued, then blocked by a simulated quota.
    if (tasks[1]) {
      await safe(() => cmd("task.command", { taskId: tasks[1].id, action: "queue" }));
      await safe(() => cmd("task.command", { taskId: tasks[1].id, action: "block", reason: "Cotă simulată: fereastra de 5 ore a atins plafonul Hub" }));
    }
    // Task 3 (review) stays DRAFT: it depends on the blocked implementation task (real dependency rule).

    const failures = await cmd("conversation.create", { projectId: p.id, title: "Eșecuri simulate" });
    await startRun(failures.id, "codex", "Rulează o analiză mică (scenariu cotă).", "quota");
    await startRun(failures.id, "claude", "Rezumă README (scenariu autentificare).", "autherror");

    const handoffConv = await cmd("conversation.create", { projectId: p.id, title: "Handoff Codex → Claude (SIMULARE)" });
    await startRun(handoffConv.id, "codex", "Pregătește contextul pentru review.", "ok");
    await cmd("handoff.begin", { conversationId: handoffConv.id, toProvider: "claude" }).catch(() => null);

    // Last: a conversation-level run that waits for an approval (the fixture asks to run `npm test`).
    const approvalRun = await safe(() => startRun(conversationId, "codex", "Rulează testele proiectului demo.", "approval", { wait: false }));
    if (approvalRun?.id) resetWhenStarted("codex", approvalRun.id); else setScenario("codex", "ok");
    return { missionId, conversationId };
  }

  /**
   * Software Factory demos (M03 §25–§27): a fixture copied into the simulator's projects root, registered as a test project,
   * with fixture grants and the writer/reviewer scripts queued. The mission is prepared with its spec; YOU approve the scope
   * in Misiuni (nothing starts before that click). Labelled SIMULARE everywhere: fixture writer, reviewer and runner.
   */
  async function factoryDemo(fixture, { codex, claude }) {
    const dir = path.join(config.dataDir, `factory-${fixture}-${Date.now().toString(36)}`);
    const port = fixture === "service-request" ? 46000 + Math.floor(Math.random() * 2500) : null;
    materializeFixture(fixture, dir, { port });
    const projectRow = await cmd("project.register_test", { path: dir });
    hub.bus.transaction(() => {
      hub.grants.create({ provider: "codex", projectId: projectRow.id, access: "workspace-write", maxAttempts: 4, maxDurationS: 900, ttlMinutes: 240, note: "Simulare (fixture-uri)" }, "simulator");
      hub.grants.create({ provider: "claude", projectId: projectRow.id, access: "read-only", maxAttempts: 4, maxDurationS: 900, ttlMinutes: 240, note: "Simulare (fixture-uri)" }, "simulator");
    });
    fs.appendFileSync(path.join(config.dataDir, "codex.queue"), `${codex.join("\n")}\n`);
    fs.appendFileSync(path.join(config.dataDir, "claude.queue"), `${claude.join("\n")}\n`);
    const view = await cmd("factory.prepare", { projectId: projectRow.id, ...demoSpec(fixture, { port }) });
    return { missionId: view.mission.id, projectId: projectRow.id, next: "Deschide misiunea și apasă „Cere aprobarea scope-ului”, apoi „Aprobă și pornește”" };
  }

  const ACTIONS = {
    // Demo A: bug with regression (writer fixes, reviewer passes). Demo B: feature with one repair cycle and a preview.
    // Demo C: review round-trip (CHANGES_REQUESTED → repair → re-review PASS) on Demo A's fixture.
    "factory-a": () => factoryDemo("bug-demo", { codex: ["factory-write:bug-fix"], claude: ["review:pass"] }),
    "factory-b": () => factoryDemo("service-request", { codex: ["factory-write:feature-b-nodedupe", "factory-write:feature-b-dedupe"], claude: ["review:pass"] }),
    "factory-c": () => factoryDemo("bug-demo", { codex: ["factory-write:bug-fix", "factory-write:bug-fix-v2"], claude: ["review:changes-dedupe", "review:pass"] }),
    async execute() {
      const conv = await cmd("conversation.create", { projectId: project().id, title: `Execuție simulată ${new Date().toLocaleTimeString("ro-RO")}` });
      const run = await startRun(conv.id, "codex", "Implementează validarea (scenariu lung, fixture).", "slow", { wait: false });
      if (run?.id) resetWhenStarted("codex", run.id); else setScenario("codex", "ok");
      return { conversationId: conv.id, runId: run?.id };
    },
    async approval() {
      const conv = await cmd("conversation.create", { projectId: project().id, title: "Aprobare simulată" });
      const run = await startRun(conv.id, "codex", "Rulează testele (cere aprobare).", "approval", { wait: false });
      if (run?.id) resetWhenStarted("codex", run.id); else setScenario("codex", "ok");
      return { conversationId: conv.id, runId: run?.id };
    },
    async quota() {
      const conv = await cmd("conversation.create", { projectId: project().id, title: "Cotă simulată" });
      const run = await startRun(conv.id, "codex", "Analiză (cotă epuizată).", "quota");
      return { conversationId: conv.id, runId: run?.id, status: run?.status };
    },
    /** Banner "Eroare auth": an expired ChatGPT session (fixture turn fails with 401/unauthorized → category authentication). */
    async error() {
      const conv = await cmd("conversation.create", { projectId: project().id, title: "Eroare de autentificare simulată" });
      const run = await startRun(conv.id, "codex", "Analiză (scenariu autentificare: sesiune expirată).", "autherror");
      return { conversationId: conv.id, runId: run?.id, status: run?.status };
    },
    async handoff() {
      const conv = await cmd("conversation.create", { projectId: project().id, title: "Handoff simulat" });
      await startRun(conv.id, "claude", "Pregătește pachetul.", "ok");
      const h = await cmd("handoff.begin", { conversationId: conv.id, toProvider: "codex" });
      return { conversationId: conv.id, handoffId: h?.id, status: h?.status };
    },
    async "drop-stream"() {
      const dropped = hub.dropStreams?.() || 0;
      return { dropped };
    },
  };

  async function action(name) {
    const fn = ACTIONS[name];
    if (!fn) throw new HubError("validation", `Unknown simulation action ${name}`);
    return fn();
  }

  return { seed, action, actions: Object.keys(ACTIONS), banner: SIM_BANNER };
}
