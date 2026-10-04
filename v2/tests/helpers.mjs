import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import net from "node:net";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../server/config.mjs";
import { createHub } from "../server/hub.mjs";
import { ATTESTATION_TEXT } from "../server/policy/billing.mjs";
import { buildDeclaration, applyDeclaration } from "../server/policy/billing-evidence.mjs";
import { R2_ACCEPT_TEXT } from "../server/policy/isolation.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURES = path.join(here, "fixtures");
export const HUB_ROOT = path.resolve(here, "..", "..");
export const TEST_TMP = path.join(HUB_ROOT, ".ifrim", "tmp", "v2-tests");
// The built UI the browser tests drive: the same folder the server serves (HUB_V2_WEB_DIST lets a new build be tested while the
// live Hub keeps serving v2/web/dist built for its own contract).
export const WEB_DIST = process.env.HUB_V2_WEB_DIST ? path.resolve(process.env.HUB_V2_WEB_DIST) : path.join(HUB_ROOT, "v2", "web", "dist");

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

/** A port the OS reports free right now (a random port in a fixed range can collide with a service already running). */
export function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => { const { port } = server.address(); server.close(() => resolve(port)); });
  });
}

export async function makeTestHub({ codex = "ok", claude = "ok", port = 0, clock, configOverrides = {}, queues = false, hubOptions = {}, wsl = null } = {}) {
  const dataDir = tempDir("hub");
  const projectDir = makeProject(path.join(dataDir, "project"));
  const homeDir = path.join(dataDir, "home");
  fs.mkdirSync(path.join(homeDir, ".codex"), { recursive: true });
  fs.mkdirSync(path.join(homeDir, ".claude"), { recursive: true });
  const logs = { codex: path.join(dataDir, "codex.log"), claude: path.join(dataDir, "claude.log") };
  // Optional scenario queues (one line per provider process, consumed in order) for multi-run flows (Software Factory).
  const queueFiles = { codex: path.join(dataDir, "codex.queue"), claude: path.join(dataDir, "claude.queue") };
  const codexPrefix = [path.join(FIXTURES, "fake-codex.mjs"), `--scenario=${codex}`, `--log=${logs.codex}`, ...(queues ? [`--scenario-queue=${queueFiles.codex}`] : [])];
  // M05: an optional simulated wsl.exe + ifrim-runner distro (tests/fixtures/fake-wsl.mjs); its codex is the same fake.
  const wslFiles = wsl ? { root: path.join(dataDir, "wslroot"), state: path.join(dataDir, "wsl-state.json"), log: path.join(dataDir, "wsl.log") } : null;
  if (wslFiles) fs.writeFileSync(wslFiles.state, JSON.stringify(wsl === true ? {} : wsl));
  const config = loadConfig({
    testMode: true, dataDir, hubRoot: projectDir, projectsRoot: dataDir, registryPath: path.join(dataDir, "no-registry.md"),
    legacyDbPath: path.join(dataDir, "no-legacy.sqlite"), port: port || await freePort(),
    providerBinaries: {
      codex: { executable: process.execPath, prefixArgs: codexPrefix },
      claude: { executable: process.execPath, prefixArgs: [path.join(FIXTURES, "fake-claude.mjs"), `--fake-scenario=${claude}`, `--fake-log=${logs.claude}`, ...(queues ? [`--fake-scenario-queue=${queueFiles.claude}`] : [])] },
    },
    ...(wslFiles ? { wsl: { executable: process.execPath, prefixArgs: [path.join(FIXTURES, "fake-wsl.mjs"), `--fake-root=${wslFiles.root}`, `--fake-state=${wslFiles.state}`, `--fake-log=${wslFiles.log}`,
      `--fake-codex=${JSON.stringify([process.execPath, ...codexPrefix])}`] } } : {}),
    ...(clock ? { now: clock } : {}),
    ...configOverrides,
  });
  const hub = createHub(config, { homeDir, ...hubOptions });
  await hub.boot();
  const readLog = (name) => (fs.existsSync(logs[name]) ? fs.readFileSync(logs[name], "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
  const cleanup = async () => {
    await hub.close();
    try { fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* Windows may hold a file briefly; left in .ifrim/tmp */ }
  };
  const queue = (provider, ...lines) => fs.appendFileSync(queueFiles[provider], `${lines.join("\n")}\n`);
  const wslState = (value) => fs.writeFileSync(wslFiles.state, JSON.stringify(value));
  const wslLog = () => (wslFiles && fs.existsSync(wslFiles.log) ? fs.readFileSync(wslFiles.log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
  return { hub, config, dataDir, projectDir, homeDir, logs, readLog, cleanup, queue, wslFiles, wslState, wslLog };
}

/** Puts a test hub into a state where a run is admissible (all through public module APIs). */
export async function enableLive(hub, { provider = "codex", access = "read-only", attempts = 3, isolationConsent = true, r2Accept = true } = {}) {
  const project = hub.projects.hub();
  hub.bus.transaction(() => {
    hub.settings.set("mode", "LIVE_VALIDATION", "test");
    hub.settings.set("executionGate", { status: "open", reason: "test", changedAt: new Date().toISOString(), changedBy: "test" }, "test");
    if (isolationConsent) hub.settings.set("isolationConsent", { codex: { confirmedAt: new Date().toISOString(), fingerprint: hub.codexIsolation().fingerprint } }, "test");
    // The fixture "Hub" project is a registry project: Codex needs the owner's R2 acceptance on it (M03 host isolation).
    if (r2Accept) hub.settings.set("r2Acceptance", { [project.id]: { confirmedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString(), projectPath: project.path, text: R2_ACCEPT_TEXT } }, "test");
  });
  for (const id of ["codex", "claude"]) {
    const installation = await hub.providers[id].inspectInstallation();
    const probe = await hub.providers[id].probe({ withUsage: true, withModels: id === "codex" });
    hub.providerState.set(id, { ...probe, installation });
  }
  declareBillingFixture(hub);
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

/**
 * M06: registers a SOFTWARE test authenticator as the owner's credential, opens a session and (optionally) activates the
 * voice-first policy. PASS_SIMULATED only: it exercises the Hub's checks, not Windows Hello.
 */
export async function enrolOwner(t, { activatePolicy = true } = {}) {
  const { createTestAuthenticator } = await import("../server/owner/webauthn.mjs");
  const { OWNER_SETUP_TEXT, OWNER_POLICY_TEXT } = await import("../server/owner/trust.mjs");
  const origin = `http://localhost:${t.config.port}`;
  const auth = createTestAuthenticator({ origin });
  const begin = t.hub.trust.beginRegistration({ origin, setupText: OWNER_SETUP_TEXT });
  t.hub.trust.finishRegistration({ origin, challengeId: begin.challengeId, credential: auth.create({ challenge: begin.publicKey.challenge }) });
  const a = t.hub.trust.beginAuthentication({ origin });
  const opened = t.hub.trust.finishAuthentication({ origin, challengeId: a.challengeId, credential: auth.get({ challenge: a.publicKey.challenge }) });
  const session = t.hub.trust.resolveSession(opened.token, { origin });
  if (activatePolicy) await t.hub.commands.dispatch({ type: "owner.policy.activate", channel: "test", actor: "test", ownerSession: session, payload: { text: OWNER_POLICY_TEXT } });
  /** Re-authenticates the same session (fresh window) with the same authenticator. */
  const reauth = () => {
    const c = t.hub.trust.beginAuthentication({ origin, purpose: "reauth" });
    t.hub.trust.finishAuthentication({ origin, challengeId: c.challengeId, credential: auth.get({ challenge: c.publicKey.challenge }), currentToken: opened.token });
    return t.hub.trust.resolveSession(opened.token, { origin });
  };
  return { auth, session, token: opened.token, origin, reauth };
}

/** M06: live preconditions WITHOUT any grant and WITHOUT leaving BUILD_SAFE (a confirmed envelope arranges both). */
export async function prepareLiveWithoutGrants(hub) {
  hub.bus.transaction(() => {
    hub.settings.set("executionGate", { status: "open", reason: "test", changedAt: new Date().toISOString(), changedBy: "test" }, "test");
    hub.settings.set("isolationConsent", { codex: { confirmedAt: new Date().toISOString(), fingerprint: hub.codexIsolation().fingerprint } }, "test");
  });
  for (const id of ["codex", "claude"]) {
    const installation = await hub.providers[id].inspectInstallation();
    const probe = await hub.providers[id].probe({ withUsage: true, withModels: id === "codex" });
    hub.providerState.set(id, { ...probe, installation });
  }
  declareBillingFixture(hub);
}

/**
 * M09-A2: billing declarations for the fixture accounts, bound to the pseudonymous identity the fake clients' probes produced
 * (the fake e-mails, salted). Written directly (test only), as the owner's billing.declare would record them; a later probe of
 * another account (or a missing probe) therefore blocks exactly as in production.
 */
export function declareBillingFixture(hub, { providers = ["codex", "claude"], at = new Date() } = {}) {
  hub.bus.transaction(() => {
    let evidence = hub.settings.get("billingEvidence");
    for (const id of providers) {
      const identity = hub.providerState.get(id)?.auth?.accountIdentity || null;
      evidence = applyDeclaration(evidence, id, buildDeclaration({ id: `bde_fixture_${id}`, provider: id, text: ATTESTATION_TEXT[id], identity, now: at, source: "test:fixture",
        recordedBy: { channel: "test", actor: "test" } }));
    }
    hub.settings.set("billingEvidence", evidence, "test", "Fixture billing declarations");
  });
}
