import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { makeTestHub, enableLive, waitFor, tempDir } from "./helpers.mjs";
import { materializeFixture } from "../server/factory/fixtures.mjs";
import { createTarReader, tarEntry, tarEnd } from "../server/environments/tar.mjs";
import { validateExport, stageExportFile } from "../server/environments/workspace.mjs";
import { environmentBlocked, TEST_NODE_OPTIONS } from "../server/environments/wsl-factory-runner.mjs";
import { buildTurnPrompt } from "../server/runtime/prompt.mjs";

// M05 pre-probe review (2026-10-02): the defects a read-only multi-agent check found before the first live wsl-runner probe,
// each confirmed against the real ifrim-runner without a model. Fixtures only here; the real measurements are in
// .ifrim/M05_TEST_REPORT.md ("Verificări înainte de proba live").
const here = path.dirname(fileURLToPath(import.meta.url));
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const dispatch = (hub, type, payload, channel = "test") => hub.commands.dispatch({ type, payload, actor: "test", channel }).then((r) => r.result);
const settled = (hub, id, ms = 60000) => waitFor(() => { const r = hub.runs.getRun(id); return ["completed", "failed", "blocked", "interrupted"].includes(r.status) ? r : null; }, ms);
const made = [];
const scratch = (label) => { const d = tempDir(label); made.push(d); return d; };
test.afterEach(() => { for (const d of made.splice(0)) { try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* held */ } } });

function readParts(parts, baseline = {}) {
  const stagingDir = scratch("staging");
  const staged = {};
  const reader = createTarReader({ onFile: stageExportFile({ stagingDir, baseline, staged }) });
  reader.push(Buffer.concat(parts));
  return { read: reader.end(), staged };
}
const file = (name, text, extra = {}) => tarEntry({ name, data: Buffer.from(text), ...extra });
const dir = (name) => tarEntry({ name, type: "5" });
const base = (entries) => Object.fromEntries(Object.entries(entries).map(([rel, text]) => [rel, { sha256: sha(Buffer.from(text)), size: Buffer.byteLength(text), mode: 0o644 }]));

async function wslHub(options = {}) {
  const t = await makeTestHub({ wsl: true, ...options });
  await dispatch(t.hub, "environment.inspect", { environmentId: "wsl-runner" });
  await dispatch(t.hub, "environment.probe", { environmentId: "wsl-runner" });
  await dispatch(t.hub, "environment.attest", { environmentId: "wsl-runner" });
  return t;
}
async function routedProject(t, { access = "workspace-write" } = {}) {
  await enableLive(t.hub, { provider: "codex", access, attempts: 1 });
  const root = path.join(t.dataDir, "factory-bug-demo");
  materializeFixture("bug-demo", root);
  const project = await dispatch(t.hub, "project.register_test", { path: root });
  const grant = t.hub.bus.transaction(() => t.hub.grants.create({ provider: "codex", projectId: project.id, access, maxAttempts: 3, maxDurationS: 900, ttlMinutes: 60 }, "test"));
  await dispatch(t.hub, "project.environment.set", { projectId: project.id, environment: "wsl-runner" });
  return { project, grant, root };
}

// TAP exactly as node --test --test-isolation=none printed it inside the ifrim-runner sandbox (2026-10-02).
const TAP_REAL_FAILURE = ["TAP version 13", "# Subtest: respinge numele gol", "not ok 1 - respinge numele gol", "  ---", "  duration_ms: 1.2",
  "  failureType: 'testCodeFailure'", "  error: |-", "    The input did not match the regular expression /nume obligatoriu/. Input:", "    'Error: altceva'", "  ...", "ok 2 - trece", "1..2", "# tests 2", "# pass 1", "# fail 1"];
const TAP_SOCKET = ["TAP version 13", "not ok 1 - server local", "  ---", "  failureType: 'testCodeFailure'", "  error: 'listen EPERM: operation not permitted 127.0.0.1'", "  code: 'EPERM'", "  ...", "1..1", "# tests 1", "# pass 0", "# fail 1"];
const TAP_MIXED = [...TAP_REAL_FAILURE.slice(0, 11), "not ok 3 - server local", "  ---", "  error: 'listen EPERM: operation not permitted 127.0.0.1'", "  code: 'EPERM'", "  ...", "1..3", "# tests 3", "# pass 1", "# fail 2"];
const TAP_NESTED = ["# Subtest: suita", "    # Subtest: server local", "    not ok 1 - server local", "      ---", "      error: 'listen EPERM: operation not permitted 127.0.0.1'", "      ...",
  "not ok 1 - suita", "  ---", "  type: 'suite'", "  failureType: 'subtestsFailed'", "  error: '1 subtest failed'", "  ...", "# tests 1", "# fail 1"];

test("M05-LR-01 a failure is BLOCKED (environment limit) only when every failing test shows the socket refusal; a real failure next to it stays FAIL", () => {
  assert.equal(environmentBlocked(TAP_REAL_FAILURE), false, "a product failure is never an environment limit");
  assert.equal(environmentBlocked(TAP_SOCKET), true);
  assert.equal(environmentBlocked(TAP_MIXED), false, "the real failure must reach the repair loop, not hide behind the socket test");
  assert.equal(environmentBlocked(TAP_NESTED), true, "a parent that failed only because of its subtests does not count");
  assert.equal(environmentBlocked(["[stderr] Error: listen EPERM: operation not permitted 127.0.0.1:4000"]), true, "no TAP at all: the refusal line decides");
  assert.equal(environmentBlocked(["[stderr] Error: Cannot find module 'x'"]), false);
  assert.equal(TEST_NODE_OPTIONS, "--test-isolation=none");
});

test("M05-LR-02 checks in the environment run node --test in-process (the sandbox loses a child's piped output) and classify the measured outputs", async () => {
  const t = await wslHub();
  try {
    const { hub } = t;
    const { project, root } = await routedProject(t);
    const ok = await hub.factoryRunner.run({ key: "lr-02-a", ws: root, command: "node --test test/unit.test.mjs", project });
    assert.equal(ok.runner, "codex-sandbox@wsl-runner");
    const sandbox = t.wslLog().find((e) => e.sandbox)?.sandbox;
    assert.equal(sandbox.nodeOptions, "--test-isolation=none", "without it only 'not ok 1 - <file>' came back from the real sandbox, no failure text");
    assert.deepEqual(sandbox.command.slice(0, 3), ["/usr/local/bin/node", "--test", "--test-reporter=tap"]);

    t.wslState({ sandboxOutput: `${TAP_MIXED.join("\n")}\n`, sandboxExit: 1 });
    const mixed = await hub.factoryRunner.run({ key: "lr-02-b", ws: root, command: "node --test", project });
    assert.equal(mixed.status, "FAIL", JSON.stringify(mixed));
    assert.ok(mixed.failures.includes("respinge numele gol"), "the failing test is named, so a repair brief can quote it");
    t.wslState({ sandboxOutput: `${TAP_SOCKET.join("\n")}\n`, sandboxExit: 1 });
    const socket = await hub.factoryRunner.run({ key: "lr-02-c", ws: root, command: "node --test", project });
    assert.equal(socket.status, "BLOCKED");
    assert.match(socket.reason, /socket/);
  } finally { await t.cleanup(); }
});

test("M05-LR-03 on the environment route EVERY command approval is declined without asking (a plain 'retry without sandbox' carries no permission fields)", async () => {
  const t = await wslHub({ codex: "approval" });
  try {
    const { hub } = t;
    const { project, grant } = await routedProject(t);
    const conv = hub.conversations.create({ projectId: project.id, title: "lr-03" }, "test");
    hub.conversations.addMessage({ conversationId: conv.id, role: "user", content: "rulează testele" }, "test");
    const { run } = await hub.runs.start({ conversationId: conv.id, provider: "codex", access: "workspace-write", grantId: grant.id, actor: "test" });
    await settled(hub, run.id);
    const reply = t.readLog("codex").find((e) => e.approvalReply)?.approvalReply;
    assert.deepEqual(reply, { decision: "decline" });
    assert.equal(hub.db.prepare("SELECT COUNT(*) AS n FROM approvals WHERE action_kind = ?").get("provider.command").n, 0, "the owner was not asked to approve an escalation");
    assert.ok(hub.bus.query({ typePrefix: "run.", limit: 500 }).some((e) => e.runId === run.id && /dincolo de profilul mediului/.test(JSON.stringify(e.payload || {}))), "the refusal is visible in the run");
  } finally { await t.cleanup(); }
});

test("M05-LR-04 real tar directory entries: a .git folder made in the environment is ignored, unchanged sent-in folders pass, new guarded folders stay refused", () => {
  const baseline = base({ "src/app.js": "a\n", ".github/workflows/ci.yml": "on: push\n", "README.md": "# r\n" });
  // What GNU tar -c really emits: a directory entry before the files under it (the hand-made archives of M05-EXP-02 had none).
  const clean = readParts([dir("./"), dir("./src/"), file("./src/app.js", "b\n"), dir("./.github/"), dir("./.github/workflows/"), file("./.github/workflows/ci.yml", "on: push\n"),
    file("./README.md", "# r\n"), dir("./.git/"), dir("./.git/objects/"), file("./.git/config", "[core]\n"), file("./.git/HEAD", "ref: refs/heads/main\n"), dir("./sub/"), dir("./sub/.GIT/"), file("./sub/.GIT/config", "x\n"), tarEnd()], baseline);
  const v = validateExport({ read: clean.read, baseline, staged: clean.staged });
  assert.equal(v.ok, true, JSON.stringify(v.refused));
  assert.deepEqual(v.changes.map((c) => `${c.status}:${c.path}`), ["modified:src/app.js"]);
  assert.ok(v.stats.ignoredRegenerable >= 5, "the environment's .git is counted as ignored");

  const hostile = readParts([dir("./"), file("./src/app.js", "a\n"), dir("./.github/"), dir("./.github/workflows/"), file("./.github/workflows/ci.yml", "on: push\n"), file("./README.md", "# r\n"),
    dir("./.husky/"), file("./.husky/pre-commit", "#!/bin/sh\n"), dir("./.vscode/"), dir("./GIT~1/"), file("./src/.git", "gitdir: ../../evil\n"), file("./.github/workflows/evil.yml", "on: push\n"), tarEnd()], baseline);
  const h = validateExport({ read: hostile.read, baseline, staged: hostile.staged });
  assert.equal(h.ok, false);
  const refused = (p) => h.refused.some((r) => r.path === p);
  for (const p of [".husky", ".husky/pre-commit", ".vscode", "GIT~1", "src/.git", ".github/workflows/evil.yml"]) assert.ok(refused(p), `${p} must stay refused: ${JSON.stringify(h.refused)}`);
  assert.ok(!refused(".github") && !refused(".github/workflows") && !refused(".github/workflows/ci.yml"), "the unchanged sent-in folder is not a change");
});

test("M05-LR-05 the worker's prompt on the environment route names the Linux copy, never the Windows path; the Windows route is unchanged", async () => {
  const t = await makeTestHub({ wsl: true });
  try {
    const { hub } = t;
    const project = hub.projects.get("ifrim-agent-hub");
    const conv = hub.conversations.create({ projectId: project.id, title: "lr-05" }, "test");
    hub.conversations.addMessage({ conversationId: conv.id, role: "user", content: "verifică" }, "test");
    const conversation = hub.conversations.get(conv.id);
    const git = { branch: "main", head: "a".repeat(40), dirty: [], untracked: [] };
    const env = buildTurnPrompt({ db: hub.db, conversation, project, git, provider: "codex", runId: "r1", environment: "wsl-runner" }).text;
    assert.ok(!env.includes(project.path), "no Windows path for a worker that cannot reach it");
    assert.match(env, /copy of the project in your current working directory/);
    assert.match(env, /no \.git/);
    const win = buildTurnPrompt({ db: hub.db, conversation, project, git, provider: "codex", runId: "r2" }).text;
    assert.ok(win.includes(project.path));
  } finally { await t.cleanup(); }
});

test("M05-LR-06 the reaper never counts itself, and the attestation exercises it for real (C15r/C15s)", () => {
  // The real check (ifrim-runner, 2026-10-02): reap.sh v1 in "all" mode reported remaining=3 on an empty workspace (its own
  // subshells); v2 reported remaining=0 and ended the decoy processes. fake-wsl cannot run bash, so this guards the source.
  const reap = fs.readFileSync(path.join(here, "..", "server", "environments", "scripts", "reap.sh"), "utf8");
  assert.match(reap, /case "\$ANC" in \*" \$pid "\*\) continue/, "ancestors (wsl relay, env) are skipped");
  assert.match(reap, /mine "\$pid" && continue/, "descendants (the $(...) subshells, tr, wc, stat, sleep) are skipped");
  assert.ok(!reap.includes("\r"), "LF only: bash reads it from stdin");
  const canary = fs.readFileSync(path.join(here, "..", "server", "environments", "canary.mjs"), "utf8");
  assert.match(canary, /scripts", "reap\.sh"\)\)\)/, "editing the reaper invalidates older attestations");
  assert.match(canary, /exerciseReaper\(\{ config, env \}\)/, "the attestation runs the reaper check when the distro is idle");
});
