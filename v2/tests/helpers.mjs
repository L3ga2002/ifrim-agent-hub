import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../server/config.mjs";
import { createHub } from "../server/hub.mjs";
import { ATTESTATION_TEXT } from "../server/policy/billing.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURES = path.join(here, "fixtures");
export const HUB_ROOT = path.resolve(here, "..", "..");
export const TEST_TMP = path.join(HUB_ROOT, ".ifrim", "tmp", "v2-tests");

/** Creates an isolated temp directory inside .ifrim/tmp (never outside the project). */
export function tempDir(label = "t") {
  const dir = path.join(TEST_TMP, `${label}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** A small git repository used as the "Agent Hub" project in tests. */
export function makeProject(dir) {
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.writeFileSync(path.join(dir, "README.md"), "# Fixture project\n");
  fs.writeFileSync(path.join(dir, "src", "app.js"), "export const answer = 42;\n");
  const git = (...args) => execFileSync("git", ["-C", dir, "-c", "user.email=test@example.invalid", "-c", "user.name=Test", "-c", "commit.gpgsign=false", ...args], { stdio: "pipe" });
  git("init", "-q");
  git("add", ".");
  git("commit", "-q", "-m", "fixture");
  return dir;
}

export async function makeTestHub({ codex = "ok", claude = "ok", port = 0, clock } = {}) {
  const dataDir = tempDir("hub");
  const projectDir = makeProject(path.join(dataDir, "project"));
  const homeDir = path.join(dataDir, "home");
  fs.mkdirSync(path.join(homeDir, ".codex"), { recursive: true });
  fs.mkdirSync(path.join(homeDir, ".claude"), { recursive: true });
  const logs = { codex: path.join(dataDir, "codex.log"), claude: path.join(dataDir, "claude.log") };
  const config = loadConfig({
    testMode: true, dataDir, hubRoot: projectDir, projectsRoot: dataDir, registryPath: path.join(dataDir, "no-registry.md"),
    legacyDbPath: path.join(dataDir, "no-legacy.sqlite"), port: port || 18000 + Math.floor(Math.random() * 900),
    providerBinaries: {
      codex: { executable: process.execPath, prefixArgs: [path.join(FIXTURES, "fake-codex.mjs"), `--scenario=${codex}`, `--log=${logs.codex}`] },
      claude: { executable: process.execPath, prefixArgs: [path.join(FIXTURES, "fake-claude.mjs"), `--fake-scenario=${claude}`, `--fake-log=${logs.claude}`] },
    },
    ...(clock ? { now: clock } : {}),
  });
  const hub = createHub(config, { homeDir });
  await hub.boot();
  const readLog = (name) => (fs.existsSync(logs[name]) ? fs.readFileSync(logs[name], "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
  const cleanup = async () => {
    await hub.close();
    try { fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* Windows may hold a file briefly; left in .ifrim/tmp */ }
  };
  return { hub, config, dataDir, projectDir, homeDir, logs, readLog, cleanup };
}

/** Puts a test hub into a state where a run is admissible (all through public module APIs). */
export async function enableLive(hub, { provider = "codex", access = "read-only", attempts = 3 } = {}) {
  const project = hub.projects.hub();
  hub.bus.transaction(() => {
    hub.settings.set("mode", "LIVE_VALIDATION", "test");
    hub.settings.set("executionGate", { status: "open", reason: "test", changedAt: new Date().toISOString(), changedBy: "test" }, "test");
    hub.settings.set("billingAttestations", { codex: { confirmedAt: new Date().toISOString(), text: ATTESTATION_TEXT.codex }, claude: { confirmedAt: new Date().toISOString(), text: ATTESTATION_TEXT.claude } }, "test");
  });
  for (const id of ["codex", "claude"]) {
    const installation = await hub.providers[id].inspectInstallation();
    const probe = await hub.providers[id].probe({ withUsage: true });
    hub.providerState.set(id, { ...probe, installation });
  }
  const grant = hub.bus.transaction(() => hub.grants.create({ provider, projectId: project.id, access, maxAttempts: attempts, maxDurationS: 600, ttlMinutes: 30 }, "test"));
  return { project, grant };
}

export const waitFor = async (predicate, timeoutMs = 15000, stepMs = 50) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await predicate();
    if (value) return value;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  throw new Error("waitFor timed out");
};
