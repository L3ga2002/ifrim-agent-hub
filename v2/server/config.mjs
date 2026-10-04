import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const V2_ROOT = path.resolve(here, "..");
export const HUB_ROOT = path.resolve(V2_ROOT, "..");
export const PROJECTS_ROOT = path.resolve(HUB_ROOT, "..");

export const HUB_VERSION = "2.11.1-m10"; // 2.11.1: Lega zero-form start (voice authority derived from the owner session for one voice session; no mode or grant by hand). M10: Desktop Operator (authenticated UIA helper, observe → act → verify, Stop / Preiau eu), zero-form operation plans (one confirmation, internal derived authority), Studio completion (project import, import folders, text target, legibility, enforced pre-migration backup). Before: 2.10.0-m09 — M09: Content / Media / Growth department (library, edit plans, local renders, QA, reviews, variants, distribution packs, analytics, Content → Sales) + core corrections (model binding, billing evidence, skill composer, voice path hardening)
/**
 * The UI–API contract (M07): a built UI carries the number it was built against (vite define __UI_CONTRACT__) and sends it on
 * every mutating request; the server answers 409 UI_STALE when they differ, so new assets never drive an older backend (or the
 * reverse). Bump it whenever a request or response shape the UI depends on changes.
 */
export const API_CONTRACT = 10;
export const DEFAULT_PORT = 8011;
export const DEFAULT_HOST = "127.0.0.1";

/** Where the relocated data root is recorded (a path pointer only; no data). Written by v2/scripts/relocate-data.mjs. */
export const DATA_LOCATION_FILE = path.join(HUB_ROOT, ".ifrim", "data-location.json");
/**
 * Marker the relocation leaves in the OLD data folder: a V2 Hub that would open it refuses to start (never two active databases).
 * V2-specific name: `.ifrim/private` is shared with V1, which keeps running there and ignores this file.
 */
export const MOVED_MARKER = "V2_MOVED.json";
/**
 * The entries of the data folder that belong to V2 (moved by the relocation). Everything else in `.ifrim/private` — the V1
 * database and its files, OpenClaw state — is not V2's and is never moved, opened or listed by content.
 */
export function isV2DataEntry(name) {
  return /^hub-v2\.sqlite(-wal|-shm|-journal)?$/.test(name) || /^v2-/.test(name) || ["browser-evidence", "sales-imports", "voice"].includes(name);
}

/**
 * Resolves where the Hub keeps its data (M08 §05). Precedence: an explicit override, HUB_V2_DATA_DIR, the relocation pointer
 * (.ifrim/data-location.json → a data root outside the synced folder, with private/, backups/v2 and work/ under it), then the
 * historical default (.ifrim/private, .ifrim/BACKUPS/v2, .ifrim/tmp/v2). Returns the three folders and where they came from.
 */
export function resolveDataLocation({ overrides = {}, env = process.env, locationFile = DATA_LOCATION_FILE, testMode = false } = {}) {
  const tmpRoot = path.join(HUB_ROOT, ".ifrim", "tmp");
  if (overrides.dataDir || env.HUB_V2_DATA_DIR) {
    const dataDir = path.resolve(overrides.dataDir || env.HUB_V2_DATA_DIR);
    return { source: overrides.dataDir ? "override" : "env", dataDir, backupDir: null, workDir: null, dataRoot: null };
  }
  if (!testMode && locationFile && fs.existsSync(locationFile)) {
    let pointer = null;
    try { pointer = JSON.parse(fs.readFileSync(locationFile, "utf8")); } catch { throw new Error(`${locationFile} nu este JSON valid; corectează-l sau rulează relocate-data --rollback`); }
    const root = String(pointer?.dataRoot || "");
    if (!root || !path.isAbsolute(root)) throw new Error(`${locationFile}: dataRoot trebuie să fie o cale absolută`);
    return { source: "pointer", dataRoot: path.resolve(root), dataDir: path.join(root, "private"), backupDir: path.join(root, "backups", "v2"), workDir: path.join(root, "work") };
  }
  return { source: "default", dataRoot: null, dataDir: path.join(HUB_ROOT, ".ifrim", "private"), backupDir: path.join(HUB_ROOT, ".ifrim", "BACKUPS", "v2"), workDir: path.join(tmpRoot, "v2") };
}

/**
 * Builds an immutable runtime configuration. Tests pass `dataDir` inside `.ifrim/tmp` so they never
 * touch the real database, backups or provider homes.
 */
export function loadConfig(overrides = {}, env = process.env) {
  const testMode = Boolean(overrides.testMode ?? env.HUB_V2_TEST === "1");
  const location = resolveDataLocation({ overrides, env, locationFile: overrides.locationFile ?? DATA_LOCATION_FILE, testMode });
  const dataDir = location.dataDir;
  const tmpRoot = path.join(HUB_ROOT, ".ifrim", "tmp");
  // A folder the relocation left behind is never opened again (its marker names where the data went).
  if (fs.existsSync(path.join(dataDir, MOVED_MARKER))) throw new Error(`Datele Hub-ului au fost mutate din ${dataDir} (vezi ${MOVED_MARKER}); pornește cu pointerul de locație sau rulează relocate-data --rollback`);
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
    // M07: the local voice engines live under the user's profile (outside the repo and OneDrive); tests use a fixture worker
    // with the same JSON-lines protocol (deterministic transcripts and embeddings, no model).
    voiceRoot: overrides.voiceRoot || null,
    voiceWorker: testMode ? overrides.voiceWorker || path.join(V2_ROOT, "tests", "fixtures", "fake-voice-worker.mjs") : null,
    voiceWorkerEnv: testMode ? overrides.voiceWorkerEnv || {} : {},
    // M04 Sales: a fake transport is accepted only in test mode (the real outreach transport does not exist in M04).
    salesTransport: overrides.testMode && overrides.salesTransport ? overrides.salesTransport : null,
    salesFixtureSites: overrides.salesFixtureSites || null,
    // Where Playwright is resolved from (Browser Workspace, factory E2E): the Hub itself; a test may point it elsewhere.
    browserRoot: overrides.browserRoot || overrides.hubRoot || HUB_ROOT,
    projectsRoot: overrides.projectsRoot || PROJECTS_ROOT,
    v2Root: V2_ROOT,
    dataDir,
    dataLocation: { source: location.source, dataRoot: location.dataRoot },
    dbPath: path.join(dataDir, overrides.dbFile || "hub-v2.sqlite"),
    legacyDbPath: overrides.legacyDbPath || path.join(HUB_ROOT, ".ifrim", "private", "agent-hub.sqlite"),
    backupDir: overrides.backupDir || (testMode ? path.join(dataDir, "backups") : location.backupDir || path.join(HUB_ROOT, ".ifrim", "BACKUPS", "v2")),
    workDir: overrides.workDir || (testMode ? path.join(dataDir, "work") : location.workDir || path.join(tmpRoot, "v2")),
    attachmentsDir: path.join(dataDir, "v2-attachments"),
    // M09 Content Studio: the media library lives under the data root (outside the repo and OneDrive once relocated; the "v2-" prefix
    // makes it move with relocate-data). The database stores paths RELATIVE to mediaDir. Render scratch goes under the work dir.
    mediaDir: overrides.mediaDir || path.join(dataDir, "v2-media"),
    mediaWorkDir: overrides.mediaWorkDir || path.join(overrides.workDir || (testMode ? path.join(dataDir, "work") : location.workDir || path.join(tmpRoot, "v2")), "media"),
    // M09: ffmpeg/ffprobe (and whisper-cli for media transcription). null = resolved on PATH at first use and pinned by version + sha256.
    // Test mode: a node fixture proxy (tests/fixtures/ffmpeg-proxy.mjs) runs the real binary when present, so the supervisor's
    // fixture-only rule holds; a fake (tests/fixtures/fake-ffmpeg.mjs) injects failures.
    mediaTools: Object.freeze({ ffmpeg: overrides.mediaTools?.ffmpeg || env.HUB_V2_FFMPEG || null, ffprobe: overrides.mediaTools?.ffprobe || env.HUB_V2_FFPROBE || null,
      launcher: overrides.mediaTools?.launcher || null }),
    // M10: the verified copies taken before a schema migration (never overwritten; see storage/db.mjs).
    preUpgradeDir: overrides.preUpgradeDir || path.join(dataDir, "pre-upgrade"),
    // M10 Desktop Operator: the helper binary is built from v2/desktop/operator by `node v2/scripts/build-operator.mjs` into the work
    // dir (outside the repo and OneDrive once relocated; writers cannot reach it). Tests use a node fixture launcher instead.
    desktop: Object.freeze({
      operatorExe: overrides.desktop?.operatorExe || path.join(overrides.workDir || (testMode ? path.join(dataDir, "work") : location.workDir || path.join(tmpRoot, "v2")), "desktop", "IfrimOperator.exe"),
      launcher: overrides.desktop?.launcher || null,
    }),
    // M08: a separate UI build can be served by a side instance (simulator) without touching the live Hub's assets.
    webDist: overrides.webDist || env.HUB_V2_WEB_DIST || path.join(V2_ROOT, "web", "dist"),
    // M09-A3: the skills directory (default v2/skills). Tests point it at a temporary git repository; only versions git-tracked
    // and clean in the repository holding this folder are ever injected into worker prompts.
    skillsDir: overrides.skillsDir ? path.resolve(overrides.skillsDir) : null,
    host: DEFAULT_HOST,
    port,
    // M07: the owner's session (WebAuthn RP ID "localhost") lives only on this origin; page navigations to 127.0.0.1 are sent
    // here (307, documents only — never /api, scripts or iframes). Tests opt in explicitly.
    canonicalOrigin: `http://localhost:${port}`,
    canonicalRedirect: overrides.canonicalRedirect ?? !testMode,
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
