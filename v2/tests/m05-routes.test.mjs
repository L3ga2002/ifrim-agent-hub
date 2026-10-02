import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { makeTestHub, enableLive, waitFor, tempDir } from "./helpers.mjs";
import { materializeFixture } from "../server/factory/fixtures.mjs";
import { createHub } from "../server/hub.mjs";
import { WSL_RUNNER, wslArgs, linuxEnv } from "../server/environments/wsl.mjs";
import { boundaryProblems } from "../server/environments/wsl-runner.mjs";
import { takeSnapshot, diffManifests, readGitEntry } from "../server/factory/snapshot.mjs";
import { renderChanges } from "../server/factory/diff.mjs";
import { SOCKET_REFUSAL } from "../server/environments/wsl-factory-runner.mjs";

// M05 (T01–T05, T10–T13, T15, T17, T18): the wsl-runner route on the simulated distro (tests/fixtures/fake-wsl.mjs) and the
// git-backed snapshot. PASS_SIMULATED for the environment parts; nothing here starts WSL, a model or a network call.
const dispatch = (hub, type, payload, channel = "test", actor = "test") => hub.commands.dispatch({ type, payload, actor, channel }).then((r) => r.result);
const settled = (hub, id, ms = 60000) => waitFor(() => { const r = hub.runs.getRun(id); return ["completed", "failed", "blocked", "interrupted"].includes(r.status) ? r : null; }, ms);

async function wslHub(options = {}) {
  const t = await makeTestHub({ wsl: true, ...options });
  await dispatch(t.hub, "environment.inspect", { environmentId: "wsl-runner" });
  await dispatch(t.hub, "environment.probe", { environmentId: "wsl-runner" });
  const att = await dispatch(t.hub, "environment.attest", { environmentId: "wsl-runner" });
  assert.equal(att.status, "PASS_SIMULATED", JSON.stringify(att.byId));
  return t;
}
async function routedTestProject(t, { access = "workspace-write", attempts = 3, fixture = "bug-demo" } = {}) {
  const { hub } = t;
  await enableLive(hub, { provider: "codex", access, attempts: 1 });
  const dir = path.join(t.dataDir, `factory-${fixture}`);
  materializeFixture(fixture, dir);
  const project = await dispatch(hub, "project.register_test", { path: dir });
  const grant = hub.bus.transaction(() => hub.grants.create({ provider: "codex", projectId: project.id, access, maxAttempts: attempts, maxDurationS: 900, ttlMinutes: 60 }, "test"));
  await dispatch(hub, "project.environment.set", { projectId: project.id, environment: "wsl-runner" });
  return { project, grant, dir };
}
function conversation(hub, project, text = "lucrează") {
  const conv = hub.conversations.create({ projectId: project.id, title: "m05" }, "test");
  hub.conversations.addMessage({ conversationId: conv.id, role: "user", content: text }, "test");
  return conv;
}

test("M05-RT-01 wsl invocation: validated argv, no shell, an explicit Linux environment; nothing Windows-side crosses (T01)", async () => {
  const args = wslArgs(WSL_RUNNER, { cwd: "/home/runner/ws/hub/x/repo", argv: ["/usr/local/bin/codex", "app-server"], vars: { TMPDIR: "/home/runner/ws/hub/x/repo/.ifrim-tmp" } });
  assert.deepEqual(args.slice(0, 9), ["-d", "ifrim-runner", "-u", "runner", "--cd", "/home/runner/ws/hub/x/repo", "--exec", "/usr/bin/env", "-i"]);
  assert.deepEqual(linuxEnv(WSL_RUNNER).map((v) => v.split("=")[0]), ["HOME", "USER", "LOGNAME", "LANG", "PATH", "NO_UPDATE_NOTIFIER"]);
  for (const bad of [{ cwd: "/home/runner/../etc" }, { cwd: "relative" }, { cwd: "/home/runner/a b" }, { argv: ["codex"] }, { argv: ["/bin/x", "a\0b"] }, { vars: { "BAD-NAME": "1" } }, { vars: { X: "a\nb" } }]) {
    assert.throws(() => wslArgs(WSL_RUNNER, { cwd: "/home/runner", argv: ["/bin/true"], ...bad }), /invalid|Variabil|Valoare|Comandă|Argument/i, JSON.stringify(bad));
  }
  assert.throws(() => wslArgs({ ...WSL_RUNNER, distro: "a b" }, { argv: ["/bin/true"] }), /distribuție/);
  // The Hub's own environment may carry keys and WSLENV: wsl.exe never receives them.
  const saved = { WSLENV: process.env.WSLENV, OPENAI_API_KEY: process.env.OPENAI_API_KEY, HTTPS_PROXY: process.env.HTTPS_PROXY };
  process.env.WSLENV = "USERPROFILE/p"; process.env.OPENAI_API_KEY = "sk-test-not-real"; process.env.HTTPS_PROXY = "http://proxy.invalid:1";
  const t = await makeTestHub({ wsl: true });
  try {
    await dispatch(t.hub, "environment.inspect", { environmentId: "wsl-runner" });
    const call = t.wslLog().find((e) => e.command?.[0] === "/bin/bash");
    assert.ok(call, "the inspection ran through wsl");
    assert.ok(!call.windowsEnv.some((n) => /^(WSLENV|OPENAI_API_KEY|HTTPS_PROXY)$/i.test(n)), JSON.stringify(call.windowsEnv));
    assert.deepEqual(call.linuxEnv, ["HOME", "LANG", "LOGNAME", "NO_UPDATE_NOTIFIER", "PATH", "USER"]);
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await t.cleanup();
  }
});

test("M05-RT-02 the account is verified through the environment, never inferred from the Windows client (T02)", async () => {
  const t = await makeTestHub({ wsl: true });
  try {
    const { hub } = t;
    await dispatch(hub, "environment.inspect", { environmentId: "wsl-runner" });
    const { project, grant } = await routedTestProject(t);
    // enableLive probed the WINDOWS client (ChatGPT, models): that says nothing about the environment's login.
    assert.equal(hub.providerState.get("codex").auth.accountType, "chatgpt");
    assert.equal(hub.providerState.get("codex@wsl-runner"), null);
    const decision = hub.gate.evaluate({ provider: "codex", projectId: project.id, access: "workspace-write", grantId: grant.id });
    assert.equal(decision.checks.find((c) => c.id === "billing_route").ok, false, "no environment probe → no billing route");
    assert.equal(decision.checks.find((c) => c.id === "isolation").ok, false);
    // NEEDS_AUTH in the environment is a blocking boundary problem.
    t.wslState({ facts: { auth_present: "no" } });
    const state = await hub.wslRunner.inspect();
    assert.ok(state.problems.some((p) => p.code === "needs_auth" && p.blocking && /NEEDS_AUTH/.test(p.detail)));
  } finally { await t.cleanup(); }
});

test("M05-RT-03 profiles, effort and MCP on the environment route: ro/rw profile per access, servers disabled by name, inline MCP refused (T03)", async () => {
  const t = await wslHub({ codex: "ok" });
  try {
    const { hub } = t;
    const { project } = await routedTestProject(t, { access: "read-only" });
    const g = hub.bus.transaction(() => hub.grants.create({ provider: "codex", projectId: project.id, access: "read-only", maxAttempts: 3, maxDurationS: 900, ttlMinutes: 60 }, "test"));
    t.wslState({ facts: { mcp_servers: "fs,git_tools," } });
    await dispatch(hub, "environment.inspect", { environmentId: "wsl-runner" });
    // MCP names in the environment's config change nothing in the fingerprint: still attested.
    const { run } = await hub.runs.start({ conversationId: conversation(hub, project).id, provider: "codex", access: "read-only", grantId: g.id, actor: "test" });
    const done = await settled(hub, run.id);
    assert.equal(done.status, "completed", `${done.errorCategory}: ${done.errorMessage}`);
    const launch = t.wslLog().filter((e) => e.command?.includes?.("app-server") && String(e.cwd).startsWith("/home/runner/ws/hub/")).at(-1);
    assert.ok(launch.command.includes('default_permissions="ifrim_runner_ro"'), "read-only profile for a read-only run");
    assert.ok(launch.command.includes("mcp_servers.fs.enabled=false") && launch.command.includes("mcp_servers.git_tools.enabled=false"));
    assert.ok(launch.command.includes('model_reasoning_effort="medium"'), "explicit effort");
    assert.ok(!launch.command.some((a) => a.includes("windows.sandbox")), "no Windows sandbox flags in Linux");
    assert.equal(done.evidence.environment.export.stats.added + done.evidence.environment.export.stats.modified, 0, "a read-only turn exports nothing");
    // Inline mcp_servers cannot be disabled per process: refused before the model.
    t.wslState({ facts: { mcp_inline: "1" } });
    await dispatch(hub, "environment.inspect", { environmentId: "wsl-runner" });
    const before = hub.grants.get(g.id).attemptsUsed;
    const second = await hub.runs.start({ conversationId: conversation(hub, project).id, provider: "codex", access: "read-only", grantId: g.id, actor: "test" }).catch((e) => e);
    if (second instanceof Error) assert.match(JSON.stringify(second.details?.checks || second.message), /mcp_inline|probleme/);
    else { const r = await settled(hub, second.run.id); assert.equal(r.preInference, true); assert.match(r.errorMessage, /mcp|MCP|probleme/); assert.equal(hub.grants.get(g.id).attemptsUsed, before, "refunded"); }
  } finally { await t.cleanup(); }
});

test("M05-RT-04 a fingerprint change between the gate and the dispatch stops the run before the model and refunds the attempt (T04)", async () => {
  const t = await wslHub({ codex: "factory-write:bug-fix" });
  try {
    const { hub } = t;
    const { project, grant, dir } = await routedTestProject(t);
    const before = fs.readFileSync(path.join(dir, "src", "requests.js"), "utf8");
    // The stored inspection (gate) still shows the attested environment; the distro changes before the adapter re-inspects.
    t.wslState({ facts: { config: "ffffffffffffffff" } });
    const { run } = await hub.runs.start({ conversationId: conversation(hub, project).id, provider: "codex", access: "workspace-write", grantId: grant.id, actor: "test" });
    const done = await settled(hub, run.id);
    assert.equal(done.status, "blocked");
    assert.equal(done.preInference, true);
    assert.match(done.errorMessage, /Amprenta mediului s-a schimbat/);
    assert.match(done.errorMessage, /fără trecere pe Windows/);
    assert.equal(hub.grants.get(grant.id).attemptsUsed, 0, "the attempt is given back");
    assert.equal(fs.readFileSync(path.join(dir, "src", "requests.js"), "utf8"), before, "nothing changed in the project");
    assert.ok(!t.readLog("codex").some((e) => e.method === "turn/start"), "no turn");
  } finally { await t.cleanup(); }
});

test("M05-RT-05 the attestation expires, (b) can be revoked, and two dispatches on one project never run at once (T05)", async () => {
  let offset = 0;
  const clock = () => new Date(Date.now() + offset);
  const t = await wslHub({ codex: "hang", clock });
  try {
    const { hub } = t;
    const { project, grant } = await routedTestProject(t);
    const first = await hub.runs.start({ conversationId: conversation(hub, project).id, provider: "codex", access: "workspace-write", grantId: grant.id, actor: "test" });
    await assert.rejects(hub.runs.start({ conversationId: conversation(hub, project, "a doua").id, provider: "codex", access: "workspace-write", grantId: grant.id, actor: "test" }),
      (e) => e.category === "gate" && e.details.checks.some((c) => c.id === "workspace_lease" && !c.ok));
    await hub.runs.interrupt(first.run.id, "test");
    await settled(hub, first.run.id);
    offset = 15 * 86400000;
    assert.equal(hub.wslRunner.attestationStatus(clock()).valid, false);
    assert.match(hub.wslRunner.attestationStatus(clock()).reason, /zile/);
    const decision = hub.gate.evaluate({ provider: "codex", projectId: project.id, access: "workspace-write", grantId: grant.id });
    assert.match(decision.checks.find((c) => c.id === "host_isolation").detail, /ENV_NOT_ATTESTED/);
    await dispatch(hub, "environment.policy.revoke", { environmentId: "wsl-runner" }, "voice");
    assert.equal(hub.settings.get("environmentPolicy")["wsl-runner"], undefined);
  } finally { await t.cleanup(); }
});

test("M05-RT-06 checks and QA follow the route (codex sandbox in the environment); preview stays on Windows; a socket refusal is BLOCKED, not a code failure (T10)", async () => {
  const t = await wslHub();
  try {
    const { hub } = t;
    const { project, dir } = await routedTestProject(t);
    const result = await hub.factoryRunner.run({ key: "m05-check-1", ws: dir, command: "node --test test/unit.test.mjs", project });
    assert.equal(result.runner, "codex-sandbox@wsl-runner");
    assert.ok(["PASS", "FAIL"].includes(result.status), JSON.stringify(result));
    const sandbox = t.wslLog().find((e) => e.sandbox)?.sandbox;
    assert.equal(sandbox.profile, "ifrim_runner_rw");
    assert.match(sandbox.cwd, /^\/home\/runner\/ws\/hub\/rn-[0-9a-f]{16}\/repo$/);
    assert.equal(sandbox.command[0], "/usr/local/bin/node", "the environment's node, never a Windows binary");
    assert.ok(hub.wslRunner.listWorkspaces().filter((w) => w.purpose === "runner").every((w) => w.status === "released"));
    const map = hub.factoryRunner.stageMap(project);
    assert.equal(map.route, "wsl-runner");
    assert.equal(map.stages.find((s) => s.stage === "checks").boundary, "environment");
    assert.equal(map.stages.find((s) => s.stage === "preview").boundary, "windows-sandbox");
    assert.equal(map.realProjectEligible, false);
    assert.ok(map.blockers.some((b) => /Preview/.test(b)) && map.blockers.some((b) => /Review/.test(b)));
    t.wslState({ sandboxSocketRefusal: true });
    const refused = await hub.factoryRunner.run({ key: "m05-check-2", ws: dir, command: "node --test test/unit.test.mjs", project });
    assert.equal(refused.status, "BLOCKED");
    assert.match(refused.reason, /socket/);
    assert.ok(SOCKET_REFUSAL.test("Error: listen EPERM: operation not permitted 127.0.0.1:4000"));
  } finally { await t.cleanup(); }
});

test("M05-RT-07 a real project's code never runs on the Windows runner without the R2 acceptance; the reviewer keeps its own route (T10, T11)", async () => {
  const t = await makeTestHub({ wsl: true });
  try {
    const { hub } = t;
    const real = hub.projects.hub();
    const ready = hub.factoryRunner.readiness(real);
    assert.equal(ready.ok, false);
    assert.match(ready.detail, /R2_OPEN/);
    // With the owner's R2 acceptance the Windows route works as before (M03 behaviour kept).
    await enableLive(hub, { provider: "codex", access: "workspace-write" });
    assert.equal(hub.factoryRunner.readiness(real).ok, true);
    // Claude is never routed: its review stays on Windows at tool level, whatever the project route is.
    await dispatch(hub, "project.environment.set", { projectId: real.id, environment: "wsl-runner" });
    const claude = hub.gate.evaluate({ provider: "claude", projectId: real.id, access: "read-only" });
    assert.equal(claude.environment, "windows");
    assert.equal(claude.checks.find((c) => c.id === "host_isolation").level, "tool");
  } finally { await t.cleanup(); }
});

test("M05-RT-08 Stop during a turn in the environment: interrupted, the workspace processes are reaped, nothing is applied (T12)", async () => {
  const t = await wslHub({ codex: "hang" });
  try {
    const { hub } = t;
    const { project, grant, dir } = await routedTestProject(t);
    const before = fs.readFileSync(path.join(dir, "src", "requests.js"), "utf8");
    const { run } = await hub.runs.start({ conversationId: conversation(hub, project).id, provider: "codex", access: "workspace-write", grantId: grant.id, actor: "test" });
    await waitFor(() => hub.runs.getRun(run.id).timeline.turn_acknowledged, 30000);
    const t0 = Date.now();
    await hub.runs.interrupt(run.id, "user");
    const requestedMs = Date.now() - t0;
    const done = await settled(hub, run.id);
    assert.equal(done.status, "interrupted");
    // Measured unloaded: interrupt answered in ~0.3 s, run finalized ~1.7 s after the request (simulated distro). The bounds are
    // generous because every simulated wsl call is a new Node process and the suite may run beside other heavy tests.
    assert.ok(requestedMs < 15000, `the Stop request returned in ${requestedMs} ms`);
    assert.ok(Date.now() - t0 < 60000, "finalized within the bound");
    assert.ok(t.wslLog().some((e) => e.reap && e.reap.includes(run.id.toLowerCase().replace(/[^a-z0-9_-]/g, "-"))), "the workspace's processes were reaped");
    assert.ok(!done.timeline.export_applied, "nothing applied");
    assert.equal(fs.readFileSync(path.join(dir, "src", "requests.js"), "utf8"), before);
    const ws = hub.wslRunner.listWorkspaces().find((w) => w.runId === run.id);
    assert.equal(ws.status, "exported", "validated for the record, never applied");
    assert.ok(ws.stats.releasedAt);
    assert.equal(hub.supervisor.list().length, 0, "no supervised process left");
  } finally { await t.cleanup(); }
});

test("M05-RT-09 restart: orphaned workspaces are marked (kept), nothing starts, no grant is created, mode is BUILD_SAFE (T13)", async () => {
  const t = await wslHub();
  try {
    const { project, dir } = await routedTestProject(t);
    await t.hub.wslRunner.prepareWorkspace({ id: "ews_orphan_test", projectRoot: dir, projectId: project.id, purpose: "run" });
    const grantsBefore = t.hub.grants.list().length;
    await t.hub.close();
    const hub2 = createHub(t.config, { homeDir: t.homeDir });
    const report = await hub2.boot();
    try {
      assert.equal(report.environments["wsl-runner"].orphaned, 1);
      assert.equal(hub2.wslRunner.getWorkspace("ews_orphan_test").status, "orphaned");
      assert.equal(hub2.settings.get("mode"), "BUILD_SAFE");
      assert.equal(hub2.grants.list().length, grantsBefore);
      assert.equal(hub2.runs.activeRuns().length, 0);
      assert.ok(fs.existsSync(path.join(t.wslFiles.root, "home", "runner", "ws", "hub", "ews_orphan_test")), "kept for inspection");
      const rec = await dispatch(hub2, "environment.reconcile", { environmentId: "wsl-runner" }, "cli", "cli");
      assert.equal(rec.reconciled, 1);
    } finally { await hub2.close(); }
  } finally { try { fs.rmSync(t.dataDir, { recursive: true, force: true }); } catch { /* held */ } }
});

test("M05-RT-10 warm-up and preparation failures: preflight reports the sandbox time; a failed copy-in stops before the model and refunds (T15)", async () => {
  const t = await wslHub({ codex: "factory-write:bug-fix" });
  try {
    const { hub } = t;
    const warm = await dispatch(hub, "environment.warmup", { route: "wsl-runner" }, "cli", "cli");
    assert.equal(warm.ok, true, JSON.stringify(warm));
    assert.equal(typeof warm.sandboxMs, "number");
    assert.equal(hub.settings.get("environmentWarmup").onBoot, false, "boot warm-up stays off unless the owner enables it");
    const { project, grant } = await routedTestProject(t);
    t.wslState({ prepareFails: true });
    const { run } = await hub.runs.start({ conversationId: conversation(hub, project).id, provider: "codex", access: "workspace-write", grantId: grant.id, actor: "test" });
    const done = await settled(hub, run.id);
    assert.equal(done.preInference, true);
    assert.match(done.errorMessage, /Workspace-ul nu a putut fi creat/);
    assert.equal(hub.grants.get(grant.id).attemptsUsed, 0);
  } finally { await t.cleanup(); }
});

test("M05-RT-11 the cli channel is recorded as such and can never decide for the owner (T17)", async () => {
  const t = await makeTestHub({ wsl: true });
  try {
    const { hub } = t;
    await dispatch(hub, "environment.inspect", { environmentId: "wsl-runner" }, "cli", "cli");
    const row = hub.db.prepare("SELECT actor, channel FROM commands WHERE type = 'environment.inspect' ORDER BY created_at DESC LIMIT 1").get();
    assert.deepEqual({ ...row }, { actor: "cli", channel: "cli" });
    for (const [type, payload] of [["project.environment.set", { projectId: hub.projects.hub().id, environment: "wsl-runner" }], ["environment.policy.approve", { confirmText: "x", fingerprintHash: "x" }],
      ["environment.warmup.configure", { onBoot: true }], ["approval.decide", { approvalId: "apr_x", decision: "approved", displayedHash: "x" }], ["gate.set", { action: "open" }]]) {
      await assert.rejects(dispatch(hub, type, payload, "cli", "cli"), (e) => e.category === "policy" || e.category === "validation", type);
    }
    const overview = (await import("../server/environments/overview.mjs")).environmentOverview(hub);
    assert.equal(overview.environments[0].live.completed, 0, "no live status without a recorded run");
    assert.equal(overview.environments[0].ladder.find((l) => l.step === "live").ok, false);
  } finally { await t.cleanup(); }
});

test("M05-RT-12 a repository over the old 4000-file limit gets a git-backed snapshot; a small change set renders against git (T18)", () => {
  const root = tempDir("large-repo");
  try {
    for (let i = 0; i < 4200; i += 1) { const d = path.join(root, "src", `m${i % 40}`); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, `f${i}.js`), `export const v${i} = ${i};\n`); }
    const git = (...args) => execFileSync("git", ["-C", root, "-c", "user.email=t@e.invalid", "-c", "user.name=T", "-c", "commit.gpgsign=false", ...args], { stdio: "pipe" });
    git("init", "-q"); git("add", "."); git("commit", "-q", "-m", "base");
    const blobDir = path.join(root, "..", `${path.basename(root)}-blobs`);
    const before = takeSnapshot(root, { blobDir });
    assert.equal(before.stats.mode, "repository-index");
    assert.equal(before.stats.files, 4200);
    fs.writeFileSync(path.join(root, "src", "m1", "f1.js"), "export const v1 = 100; // schimbat\n");
    fs.writeFileSync(path.join(root, "src", "nou.js"), "export const nou = true;\n");
    fs.rmSync(path.join(root, "src", "m2", "f2.js"));
    const after = takeSnapshot(root, { blobDir });
    const changes = diffManifests(before.files, after.files);
    assert.deepEqual(changes.map((c) => `${c.status}:${c.path}`), ["modified:src/m1/f1.js", "deleted:src/m2/f2.js", "added:src/nou.js"]);
    const rendered = renderChanges(changes, blobDir, { readGit: (sha) => readGitEntry(root, sha) });
    assert.match(rendered.text, /-export const v1 = 1;/);
    assert.match(rendered.text, /\+export const v1 = 100; \/\/ schimbat/);
    assert.equal(execFileSync("git", ["-C", root, "status", "--porcelain"], { encoding: "utf8" }).split("\n").filter(Boolean).length, 3, "the snapshot changed nothing in git");
    fs.rmSync(blobDir, { recursive: true, force: true });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("M05-RT-13 the boundary inspection refuses an environment that lost its isolation (drives, interop, sudo, profiles, binary owner)", () => {
  const good = { user: "runner", uid: "1000", "wslconf.automount.enabled": "false", "wslconf.interop.enabled": "false", "wslconf.interop.appendWindowsPath": "false",
    profiles: "ifrim_runner_ro,ifrim_runner_rw,", auth_present: "yes", auth_mode: "600", codex_version: "0.159.2", codex_owner: "root", mcp_inline: "0", drvfs_mounts: "0" };
  assert.deepEqual(boundaryProblems(good).filter((p) => p.blocking), []);
  for (const [patch, code] of [[{ mnt_drives: "c," }, "drives"], [{ interop_cmd: "found" }, "interop"], [{ sudo: "allowed" }, "sudo"], [{ uid: "0" }, "root"],
    [{ "wslconf.automount.enabled": "true" }, "wslconf"], [{ profiles: "ifrim_runner_ro," }, "profile"], [{ codex_owner: "runner" }, "codex_owner"],
    [{ config_keys: "model_provider," }, "custom_provider"], [{ forced_login_method: "api" }, "api_login"], [{ auth_mode: "644" }, "auth_mode"]]) {
    assert.ok(boundaryProblems({ ...good, ...patch }).some((p) => p.code === code && p.blocking), code);
  }
});
