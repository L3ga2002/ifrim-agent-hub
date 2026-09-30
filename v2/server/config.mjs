import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const V2_ROOT = path.resolve(here, "..");
export const HUB_ROOT = path.resolve(V2_ROOT, "..");
export const PROJECTS_ROOT = path.resolve(HUB_ROOT, "..");

export const HUB_VERSION = "2.1.0-m01";
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
    hubRoot: overrides.hubRoot || HUB_ROOT,
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
    registryPath: overrides.registryPath || path.join(PROJECTS_ROOT, "PROJECTS.md"),
    roleRegistryPath: overrides.roleRegistryPath || path.join(PROJECTS_ROOT, ".ifrim-system", "AGENT_TEAM_V2.json"),
    now: overrides.now || (() => new Date()),
  };
  return Object.freeze(config);
}
