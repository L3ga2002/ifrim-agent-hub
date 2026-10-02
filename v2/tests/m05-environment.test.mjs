import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeTestHub, enableLive, waitFor } from "./helpers.mjs";
import { ENV_POLICY_TEXT } from "../server/policy/isolation.mjs";
import { materializeFixture } from "../server/factory/fixtures.mjs";

/**
 * M05 — the wsl-runner environment end to end on the simulated distro (tests/fixtures/fake-wsl.mjs): inspection and
 * fingerprint, account check through the environment (C16), attestation (C1–C17), the gate on the project route, a Codex run
 * through the environment (copy in → turn → reap → export → C14 → apply), and the refusals. PASS_SIMULATED only.
 */
const dispatch = (hub, type, payload, channel = "test") => hub.commands.dispatch({ type, payload, actor: "test", channel }).then((r) => r.result);

async function readyHub(options = {}) {
  const t = await makeTestHub({ wsl: true, ...options });
  const { hub } = t;
  await dispatch(hub, "environment.inspect", { environmentId: "wsl-runner" });
  await dispatch(hub, "environment.probe", { environmentId: "wsl-runner" });
  const att = await dispatch(hub, "environment.attest", { environmentId: "wsl-runner" });
  return { ...t, att };
}

/** The fixture project routed to the environment, live mode, a grant: what a run needs (through public module APIs). */
async function routeProject(hub, { provider = "codex", access = "workspace-write" } = {}) {
  const { project, grant } = await enableLive(hub, { provider, access, attempts: 3 });
  await dispatch(hub, "project.environment.set", { projectId: project.id, environment: "wsl-runner" });
  return { project, grant };
}

/** A sanitized hub-test project (the Demo bug fixture) routed to the environment, with a Codex grant: the (c) probe shape. */
async function testProject(t, { fixture = "bug-demo", attempts = 3 } = {}) {
  const { hub } = t;
  await enableLive(hub, { provider: "codex", access: "workspace-write", attempts: 1 });
  const dir = path.join(t.dataDir, `factory-${fixture}`);
  materializeFixture(fixture, dir);
  const project = await dispatch(hub, "project.register_test", { path: dir });
  const grant = hub.bus.transaction(() => hub.grants.create({ provider: "codex", projectId: project.id, access: "workspace-write", maxAttempts: attempts, maxDurationS: 900, ttlMinutes: 60 }, "test"));
  await dispatch(hub, "project.environment.set", { projectId: project.id, environment: "wsl-runner" });
  return { project, grant, dir };
}

test("M05-ENV-01 inspection, account check through the environment and a complete attestation (simulated)", async () => {
  const t = await readyHub();
  try {
    const { hub, att } = t;
    const state = hub.wslRunner.state();
    assert.equal(state.ok, true, JSON.stringify(state.problems));
    assert.equal(state.fingerprint.line, "distro=ifrim-runner wslconf=b8890b2f40e0327e codex=0.159.2 config=4a7c12306a171922 kernel=6.6.114.1-microsoft-standard-WSL2");
    const probe = hub.providerState.get("codex@wsl-runner");
    assert.equal(probe.auth.accountType, "chatgpt");
    assert.equal(probe.environment, "wsl-runner");
    assert.equal(probe.sandbox.readiness, "not_applicable", "no Windows sandbox question in a Linux environment");
    // The fixture distro is labelled for what it is: never PASS_LOCAL (a real WSL proof).
    assert.equal(att.status, "PASS_SIMULATED", JSON.stringify(att.byId));
    for (const id of ["C1", "C7", "C13", "C14", "C15", "C16", "C17"]) assert.equal(att.byId[id], "PASS", id);
    assert.equal(hub.wslRunner.attestationStatus().valid, true);
    // No thread and no turn were started by the account check or the attestation.
    assert.ok(!t.readLog("codex").some((e) => ["thread/start", "turn/start"].includes(e.method)), "inference-free");
  } finally { await t.cleanup(); }
});

test("M05-ENV-02 a Codex run on a routed project goes through the environment and its validated export is applied", async () => {
  const t = await readyHub({ codex: "factory-write:bug-fix", queues: false });
  try {
    const { hub } = t;
    const { project, grant } = await testProject(t);
    const conv = hub.conversations.create({ projectId: project.id, title: "wsl run" }, "test");
    hub.conversations.addMessage({ conversationId: conv.id, role: "user", content: "fă modificarea" }, "test");
    const { run } = await hub.runs.start({ conversationId: conv.id, provider: "codex", access: "workspace-write", grantId: grant.id, actor: "test" })
      .catch((error) => { throw new Error(`refuzat: ${JSON.stringify((error.details?.checks || []).filter((c) => !c.ok))}`); });
    const done = await waitFor(() => { const r = hub.runs.getRun(run.id); return ["completed", "failed", "blocked", "interrupted"].includes(r.status) ? r : null; }, 60000);
    assert.equal(done.environment, "wsl-runner");
    assert.equal(done.status, "completed", `${done.errorCategory}: ${done.errorMessage}`);
    const envEvidence = done.evidence.environment;
    assert.equal(envEvidence.export.ok, true, JSON.stringify(envEvidence.export));
    assert.ok(envEvidence.apply.applied > 0);
    for (const phase of ["environment_checked", "workspace_prepared", "turn_sent", "export_validated", "export_applied"]) assert.ok(done.timeline[phase], phase);
    // The provider process ran with the explicit Linux environment only; no Windows variable crossed.
    const launch = t.wslLog().find((e) => e.command?.[0] === "/usr/local/bin/codex" && e.command.includes("app-server") && String(e.cwd).startsWith("/home/runner/ws/hub/"));
    assert.deepEqual(launch.linuxEnv, ["HOME", "IFRIM_RUN", "LANG", "LOGNAME", "NO_UPDATE_NOTIFIER", "PATH", "TMPDIR", "USER"]);
    assert.ok(!launch.windowsEnv.includes("WSLENV") && !launch.windowsEnv.some((n) => /OPENAI|ANTHROPIC|PROXY/i.test(n)));
    assert.ok(launch.command.includes("-c") && t.wslLog().some((e) => e.command?.some?.((a) => a === 'default_permissions="ifrim_runner_rw"')));
    // The workspace is gone afterwards.
    const ws = hub.wslRunner.listWorkspaces().find((w) => w.runId === run.id);
    assert.equal(ws.status, "applied", "the outcome stays the status");
    assert.ok(ws.stats.releasedAt, "and the workspace was released after it");
  } finally { await t.cleanup(); }
});

test("M05-ENV-03 the gate refuses the routed project without attestation, and never falls back to Windows", async () => {
  const t = await makeTestHub({ wsl: true });
  try {
    const { hub } = t;
    const { project, grant } = await routeProject(hub);
    const decision = hub.gate.evaluate({ provider: "codex", projectId: project.id, access: "workspace-write", grantId: grant.id });
    assert.equal(decision.environment, "wsl-runner");
    assert.equal(decision.allowed, false);
    const host = decision.checks.find((c) => c.id === "host_isolation");
    assert.match(host.detail, /ENV_UNAVAILABLE|ENV_NOT_ATTESTED/);
    // The owner's R2 acceptance for Windows does not open the environment route.
    assert.ok(hub.settings.get("r2Acceptance")[project.id]);
  } finally { await t.cleanup(); }
});

test("M05-ENV-04 policy (b) is bound to the fingerprint: a changed environment invalidates attestation and approval", async () => {
  const t = await readyHub();
  try {
    const { hub } = t;
    const { project, grant } = await routeProject(hub);
    // The fixture Hub project is a registry (real) project: it needs (b).
    let decision = hub.gate.evaluate({ provider: "codex", projectId: project.id, access: "workspace-write", grantId: grant.id });
    assert.match(decision.checks.find((c) => c.id === "host_isolation").detail, /NEEDS_OWNER_APPROVAL/);
    const fp = hub.wslRunner.state().fingerprint.hash;
    await assert.rejects(dispatch(hub, "environment.policy.approve", { confirmText: "da", fingerprintHash: fp }), /Textul de confirmare/);
    await assert.rejects(dispatch(hub, "environment.policy.approve", { confirmText: ENV_POLICY_TEXT, fingerprintHash: fp }, "cli"), /channel|canal|cli/i);
    await dispatch(hub, "environment.policy.approve", { confirmText: ENV_POLICY_TEXT, fingerprintHash: fp });
    decision = hub.gate.evaluate({ provider: "codex", projectId: project.id, access: "workspace-write", grantId: grant.id });
    assert.equal(decision.checks.find((c) => c.id === "host_isolation").ok, true, decision.checks.find((c) => c.id === "host_isolation").detail);
    // Codex is updated in the environment: new fingerprint → attestation and (b) no longer apply until both are redone.
    t.wslState({ facts: { codex_version: "0.160.0", codex_sha: "ffffffffffffffff" } });
    await dispatch(hub, "environment.inspect", { environmentId: "wsl-runner" });
    decision = hub.gate.evaluate({ provider: "codex", projectId: project.id, access: "workspace-write", grantId: grant.id });
    assert.equal(decision.allowed, false);
    assert.match(decision.checks.find((c) => c.id === "host_isolation").detail, /Amprenta mediului s-a schimbat/);
    assert.equal(hub.wslRunner.attestationStatus().changed, true);
  } finally { await t.cleanup(); }
});

test("M05-ENV-05 an attestation produced by the test fixture is PASS_SIMULATED and never valid outside test mode (no fake proof)", async () => {
  const { loadConfig } = await import("../server/config.mjs");
  const { openDatabase } = await import("../server/storage/db.mjs");
  const { createEventBus } = await import("../server/events/bus.mjs");
  const { createProviderState } = await import("../server/domain/grants.mjs");
  const { createSupervisor } = await import("../server/runtime/supervisor.mjs");
  const { createWslRunnerEnvironment } = await import("../server/environments/wsl-runner.mjs");
  const { tempDir, FIXTURES } = await import("./helpers.mjs");
  const base = tempDir("env-nontest");
  const fixtureCodex = [process.execPath, path.join(FIXTURES, "fake-codex.mjs"), "--scenario=ok"];
  const config = loadConfig({ dataDir: path.join(base, "data"), workDir: path.join(base, "work"), port: 18995,
    wsl: { executable: process.execPath, prefixArgs: [path.join(FIXTURES, "fake-wsl.mjs"), `--fake-root=${path.join(base, "root")}`, `--fake-codex=${JSON.stringify(fixtureCodex)}`] } });
  assert.equal(config.testMode, false);
  const db = openDatabase(config.dbPath);
  const clock = () => new Date();
  const bus = createEventBus(db, clock);
  const supervisor = createSupervisor({ config });
  const svc = createWslRunnerEnvironment({ config, db, bus, clock, providerState: createProviderState({ db, clock }), supervisor, homeDir: base });
  try {
    assert.equal(svc.simulated, true);
    const att = await svc.attest({ actor: "test", channel: "test", allowRestart: true });
    assert.equal(att.status, "PASS_SIMULATED");
    assert.match(att.summary, /SIMULATĂ/);
    const status = svc.attestationStatus();
    assert.equal(status.valid, false, "a simulated attestation never opens the route outside tests");
    assert.match(status.reason, /PASS_SIMULATED/);
  } finally { await supervisor.stopAll(); db.close(); fs.rmSync(base, { recursive: true, force: true }); }
});
