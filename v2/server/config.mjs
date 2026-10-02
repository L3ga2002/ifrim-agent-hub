import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const V2_ROOT = path.resolve(here, "..");
export const HUB_ROOT = path.resolve(V2_ROOT, "..");
export const PROJECTS_ROOT = path.resolve(HUB_ROOT, "..");

export const HUB_VERSION = "2.6.0-m05"; // M05: execution environments (wsl-runner: copy-in, Codex in ifrim-runner, C14-validated export, attestation C1–C17 bound to a fingerprint, policy (b) owner-only), robustness (Stop in QA, RT-07, warm-up, Lega diagnostics) // M04: Sales & Lead Generation (import → identity → evidence → audit → qualification → proposal → draft → Engineering hand-off), DRAFT_ONLY // M03: runtime readiness (explicit model/effort, run timeline, R2/R3 gate) + Software Factory (spec → change set → review → QA → bundle)
export const DEFAULT_PORT = 8011;
export const DEFAULT_HOST = "127.0.0.1";

/**
 * Builds an immutable runtime configuration. Tests pass `dataDir` inside `.ifrim/tmp` so they never
 * touch the real database, backups or provider homes.
 */
export function loadConfig(overrides = {}, env = process.env) {
  const testMode = Boolean(overrides.testMode ?? env.HUB_V2_TEST === "1");
  const dataDir = path.resolve(overrides.dataDir || env.HUB_V2_DATA_DIR || path.join(HUB_ROOT, ".ifrim", "private"));
  const tmpRoot = path.join(HUB_ROOT, ".ifrim", "tmp");
  if (testMode) {
    const rel = path.relative(tmpRoot, dataDir);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error("Test mode requires an isolated data directory inside .ifrim/tmp");
    }
  }
  const port = Number(overrides.port ?? env.HUB_V2_PORT ?? DEFAULT_PORT);
  const config = {
    testMode,
    // Simulator process (M02 §23): test mode + synthetic demo project + fixture providers only.
    simulation: Boolean(overrides.simulation) && testMode,
    hubProjectName: overrides.hubProjectName || "Ifrim Agent Hub",
    hubRoot: overrides.hubRoot || HUB_ROOT,
    // M04 Sales: a fake transport is accepted only in test mode (the real outreach transport does not exist in M04).
    salesTransport: overrides.testMode && overrides.salesTransport ? overrides.salesTransport : null,
    salesFixtureSites: overrides.salesFixtureSites || null,
    // Where Playwright is resolved from (Browser Workspace, factory E2E): the Hub itself; a test may point it elsewhere.
    browserRoot: overrides.browserRoot || overrides.hubRoot || HUB_ROOT,
    projectsRoot: overrides.projectsRoot || PROJECTS_ROOT,
    v2Root: V2_ROOT,
    dataDir,
    dbPath: path.join(dataDir, overrides.dbFile || "hub-v2.sqlite"),
    legacyDbPath: overrides.legacyDbPath || path.join(HUB_ROOT, ".ifrim", "private", "agent-hub.sqlite"),
    backupDir: overrides.backupDir || (testMode ? path.join(dataDir, "backups") : path.join(HUB_ROOT, ".ifrim", "BACKUPS", "v2")),
    workDir: overrides.workDir || (testMode ? path.join(dataDir, "work") : path.join(tmpRoot, "v2")),
    attachmentsDir: path.join(dataDir, "v2-attachments"),
    webDist: path.join(V2_ROOT, "web", "dist"),
    host: DEFAULT_HOST,
    port,
    allowedOrigins: new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`,
      ...(overrides.devOrigins || [`http://127.0.0.1:3011`, `http://localhost:3011`])]),
    maxConcurrentAiRuns: Number(overrides.maxConcurrentAiRuns ?? 2),
    // Test mode refuses to spawn any executable outside this directory (fake providers only).
    allowedTestBinaryDir: path.join(V2_ROOT, "tests", "fixtures"),
    providerBinaries: overrides.providerBinaries || {},
    // M05: the wsl.exe used for the wsl-runner environment; tests point it at the fixture (tests/fixtures/fake-wsl.mjs).
    wsl: overrides.wsl || null,
    // Test mode only: shrinks Lega's idle/max/negotiation timers so they can be exercised quickly.
    legaTimeScale: testMode && Number(overrides.legaTimeScale) > 0 ? Number(overrides.legaTimeScale) : 1,
    registryPath: overrides.registryPath || path.join(PROJECTS_ROOT, "PROJECTS.md"),
    roleRegistryPath: overrides.roleRegistryPath || path.join(PROJECTS_ROOT, ".ifrim-system", "AGENT_TEAM_V2.json"),
    now: overrides.now || (() => new Date()),
  };
  return Object.freeze(config);
}
