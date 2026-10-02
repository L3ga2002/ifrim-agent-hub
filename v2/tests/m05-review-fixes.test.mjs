import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { makeTestHub, enableLive, waitFor, tempDir, makeProject } from "./helpers.mjs";
import { materializeFixture } from "../server/factory/fixtures.mjs";
import { createTarReader, tarEntry, tarEnd } from "../server/environments/tar.mjs";
import { validateExport, stageExportFile, selectTransferFiles, guardedPath } from "../server/environments/workspace.mjs";
import { takeGitSnapshot, diffManifests, gitEntryHash } from "../server/factory/snapshot.mjs";

// M05 adversarial review (security, correctness, honesty): one regression test per confirmed defect. Fixtures only.
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

async function wslHub(options = {}) {
  const t = await makeTestHub({ wsl: true, ...options });
  await dispatch(t.hub, "environment.inspect", { environmentId: "wsl-runner" });
  await dispatch(t.hub, "environment.probe", { environmentId: "wsl-runner" });
  await dispatch(t.hub, "environment.attest", { environmentId: "wsl-runner" });
  return t;
}
async function routed(t, { access = "workspace-write" } = {}) {
  await enableLive(t.hub, { provider: "codex", access, attempts: 1 });
  const dir = path.join(t.dataDir, "factory-bug-demo");
  materializeFixture("bug-demo", dir);
  const project = await dispatch(t.hub, "project.register_test", { path: dir });
  const grant = t.hub.bus.transaction(() => t.hub.grants.create({ provider: "codex", projectId: project.id, access, maxAttempts: 3, maxDurationS: 900, ttlMinutes: 60 }, "test"));
  await dispatch(t.hub, "project.environment.set", { projectId: project.id, environment: "wsl-runner" });
  const conv = t.hub.conversations.create({ projectId: project.id, title: "r" }, "test");
  t.hub.conversations.addMessage({ conversationId: conv.id, role: "user", content: "x" }, "test");
  return { project, grant, dir, conv };
}

test("M05-RV-01 (security F1, F3, F4) 8.3 names, nested/cased .git, Node_Modules, nested control files, CI and shell-active files never reach the project", () => {
  const baseline = { "src/app.js": { sha256: sha(Buffer.from("a\n")), size: 2, mode: 0o644 } };
  const { read, staged } = readParts([file("./src/app.js", "a\n"),
    file("./GIT~1/hooks/pre-commit", "#!/bin/sh\n"), file("./IFRIM~1/private/x", "x"), file("./sub/.GIT/config", "[core]\n"), file("./src/.git", "gitdir: ../evil\n"),
    file("./Node_Modules/.bin/x.cmd", "echo\n"), file("./DIST/a.js", "x\n"), file("./src/CLAUDE.md", "# x\n"), file("./docs/AGENTS.md", "# x\n"), file("./src/.codex/config.toml", "x\n"),
    file("./.vscode/tasks.json", "{}\n"), file("./.github/workflows/ci.yml", "on: push\n"), file("./x.scf", "[Shell]\n"), file("./link.url", "[InternetShortcut]\n"), file("./a/desktop.ini", "[.ShellClassInfo]\n"),
    file("./.gitmodules", "[submodule]\n"), tarEnd()], baseline);
  const v = validateExport({ read, baseline, staged });
  assert.equal(v.ok, false);
  const refused = (p) => v.refused.some((r) => r.path === p);
  for (const p of ["GIT~1/hooks/pre-commit", "IFRIM~1/private/x", "src/.git", "src/CLAUDE.md", "docs/AGENTS.md", "src/.codex/config.toml", ".vscode/tasks.json", ".github/workflows/ci.yml", "x.scf", "link.url", "a/desktop.ini", ".gitmodules"]) {
    assert.ok(refused(p), `${p} must be refused: ${JSON.stringify(v.refused)}`);
  }
  // Case variants of regenerable and git folders are ignored (never applied), not silently written.
  for (const p of ["sub/.GIT/config", "Node_Modules/.bin/x.cmd", "DIST/a.js"]) assert.ok(!v.changes.some((c) => c.path === p), `${p} must never be a change`);
  assert.equal(guardedPath("src/ok.js"), null);
});

test("M05-RV-02 (security F2) a junction inside a git repository is never followed by the transfer", async () => {
  const root = makeProject(scratch("junction-repo"));
  const outside = scratch("outside");
  fs.writeFileSync(path.join(outside, "note.txt"), "secret outside the project\n");
  fs.symlinkSync(outside, path.join(root, "link"), "junction");
  const listed = execFileSync("git", ["-C", root, "ls-files", "--others", "--exclude-standard"], { encoding: "utf8" });
  const selection = await selectTransferFiles(root);
  assert.ok(!selection.files.some((f) => f.rel.startsWith("link/")), `nothing through the junction (git listed: ${listed.trim().replace(/\n/g, ", ")})`);
});

test("M05-RV-03 (security F7, F8) secrets by content and by new names stay out; tracked source under build/ travels, new build output is reported", async () => {
  const root = makeProject(scratch("secrets-repo"));
  fs.writeFileSync(path.join(root, "notes.txt"), "-----BEGIN PRIVATE KEY-----\nMIIfake\n-----END PRIVATE KEY-----\n");
  fs.writeFileSync(path.join(root, "prod.tfvars"), "x = 1\n");
  fs.writeFileSync(path.join(root, ".git-credentials"), "https://u:p@example.invalid\n");
  fs.mkdirSync(path.join(root, "src", "build"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "build", "index.js"), "export const b = 1;\n");
  execFileSync("git", ["-C", root, "-c", "user.email=t@e.invalid", "-c", "user.name=T", "add", "src/build/index.js"]);
  execFileSync("git", ["-C", root, "-c", "user.email=t@e.invalid", "-c", "user.name=T", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "b"]);
  const selection = await selectTransferFiles(root);
  const rels = selection.files.map((f) => f.rel);
  assert.ok(rels.includes("src/build/index.js"), "tracked source under build/ is sent");
  assert.ok(!rels.includes("prod.tfvars") && !rels.includes(".git-credentials"), "new secret names stay out");
  const manifest = {};
  const { transferStream } = await import("../server/environments/workspace.mjs");
  for await (const f of transferStream(selection, manifest)) void f;
  assert.equal(manifest["notes.txt"], undefined, "a file whose content is a private key is not sent");
  assert.ok(Object.keys(selection.skipped).some((k) => /secret/.test(k)));
  // Export: a change to the tracked build file is a normal change; a NEW file in a build folder is ignored and reported.
  const baseline = { "src/build/index.js": { sha256: sha(Buffer.from("export const b = 1;\n")), size: 20, mode: 0o644 } };
  const { read, staged } = readParts([file("./src/build/index.js", "export const b = 2;\n"), file("./src/build/new.js", "x\n"), tarEnd()], baseline);
  const v = validateExport({ read, baseline, staged });
  assert.deepEqual(v.changes.map((c) => `${c.status}:${c.path}`), ["modified:src/build/index.js"]);
  assert.deepEqual(v.stats.ignoredNewFiles, ["src/build/new.js"]);
});

test("M05-RV-04 (security F5, correctness 6) the git-backed snapshot always reads tests; equal content under two identities is not a change", () => {
  const root = makeProject(scratch("spoof-repo"));
  fs.mkdirSync(path.join(root, "test"), { recursive: true });
  fs.writeFileSync(path.join(root, "test", "a.test.mjs"), "assert(1)\n");
  execFileSync("git", ["-C", root, "add", "."]);
  execFileSync("git", ["-C", root, "-c", "user.email=t@e.invalid", "-c", "user.name=T", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "t"]);
  const before = takeGitSnapshot(root, {});
  const target = path.join(root, "test", "a.test.mjs");
  const stat = fs.statSync(target);
  fs.writeFileSync(target, "assert(0)\n"); // same size
  fs.utimesSync(target, stat.atime, stat.mtime); // mtime reset: git's stat check would call it unchanged
  const after = takeGitSnapshot(root, {});
  assert.deepEqual(diffManifests(before.files, after.files).map((c) => `${c.status}:${c.path}`), ["modified:test/a.test.mjs"]);
  // A git identity and a content hash of the same bytes are equal with the resolver.
  const app = before.files["src/app.js"];
  assert.match(app.sha256, /^git:/);
  const hashed = { "src/app.js": { sha256: sha(fs.readFileSync(path.join(root, "src", "app.js"))), size: app.size, text: true } };
  assert.equal(diffManifests({ "src/app.js": app }, hashed, { resolve: (s) => gitEntryHash(root, s) }).length, 0);
  assert.equal(diffManifests({ "src/app.js": app }, hashed).length, 1, "without the resolver they differ (identity, not content)");
});

test("M05-RV-05 (correctness 1) a Stop while the export is read: nothing is applied, the run is interrupted", async () => {
  const t = await wslHub({ codex: "factory-write:bug-fix" });
  try {
    const { hub } = t;
    const { grant, dir, conv } = await routed(t);
    const before = fs.readFileSync(path.join(dir, "src", "requests.js"), "utf8");
    t.wslState({ exportDelayMs: 4000 });
    const { run } = await hub.runs.start({ conversationId: conv.id, provider: "codex", access: "workspace-write", grantId: grant.id, actor: "test" });
    const wsId = run.id.toLowerCase();
    await waitFor(() => (t.wslLog().some((e) => e.command?.[0] === "/usr/bin/tar" && e.command.includes("-c") && String(e.cwd).includes(wsId)) ? true : null), 60000, 100);
    await hub.runs.interrupt(run.id, "user");
    const done = await settled(hub, run.id);
    assert.equal(done.status, "interrupted", JSON.stringify({ err: done.errorMessage, env: done.evidence.environment }).slice(0, 1500));
    assert.ok(!done.timeline.export_applied);
    assert.equal(fs.readFileSync(path.join(dir, "src", "requests.js"), "utf8"), before, "the project is untouched");
    assert.match(done.evidence.environment.apply.reason, /oprit înainte de aplicare/);
  } finally { await t.cleanup(); }
});

test("M05-RV-06 (correctness 2) a Stop during the copy-in aborts it; the answer waits for the run to settle; the attempt is refunded", async () => {
  const t = await wslHub({ codex: "ok" });
  try {
    const { hub } = t;
    const { grant, conv } = await routed(t);
    t.wslState({ prepareDelayMs: 20000 });
    const { run } = await hub.runs.start({ conversationId: conv.id, provider: "codex", access: "workspace-write", grantId: grant.id, actor: "test" });
    await waitFor(() => (t.wslLog().some((e) => e.script === "env:prepare") ? true : null), 30000, 50);
    const t0 = Date.now();
    const answer = await hub.runs.interrupt(run.id, "user");
    assert.equal(answer.interrupted, true);
    const done = await settled(hub, run.id);
    assert.ok(Date.now() - t0 < 15000, "the 20 s copy was aborted, not awaited");
    assert.equal(done.status, "interrupted");
    assert.equal(done.preInference, true);
    assert.equal(hub.grants.get(grant.id).attemptsUsed, 0);
  } finally { await t.cleanup(); }
});

test("M05-RV-07 (correctness 3) a runner command stopped during its copy never starts in the environment", async () => {
  const t = await wslHub();
  try {
    const { hub } = t;
    const { project, dir } = await routed(t);
    let stop = false;
    t.wslState({ prepareDelayMs: 1500 });
    setTimeout(() => { stop = true; }, 300);
    const result = await hub.factoryRunner.run({ key: "rv7", ws: dir, command: "node --test test/unit.test.mjs", project, shouldStop: () => stop });
    assert.equal(result.status, "BLOCKED");
    assert.match(result.reason, /oprit înainte de pornirea comenzii/);
    assert.ok(!t.wslLog().some((e) => e.sandbox), "no codex sandbox command started");
  } finally { await t.cleanup(); }
});

test("M05-RV-08 (correctness 4) while the attestation runs (it restarts the distro), no run may prepare a workspace or pass the gate", async () => {
  const t = await wslHub();
  try {
    const { hub } = t;
    const { project, grant, dir } = await routed(t);
    t.wslState({ prepareDelayMs: 3000 });
    const attesting = dispatch(hub, "environment.attest", { environmentId: "wsl-runner", allowRestart: false });
    await waitFor(() => (hub.wslRunner.attesting() ? true : null), 10000, 20);
    const decision = hub.gate.evaluate({ provider: "codex", projectId: project.id, access: "workspace-write", grantId: grant.id });
    assert.equal(decision.checks.find((c) => c.id === "environment_route").ok, false);
    assert.match(decision.checks.find((c) => c.id === "environment_route").detail, /Atestarea/);
    await assert.rejects(hub.wslRunner.prepareWorkspace({ id: "ews_during_attest", projectRoot: dir, projectId: project.id, purpose: "run" }), /Atestarea mediului rulează/);
    t.wslState({});
    await attesting;
  } finally { await t.cleanup(); }
});

test("M05-RV-09 (correctness 5, 9) an unconfirmed reap keeps the project lease; a gate-blocked run records its environment", async () => {
  const t = await wslHub({ codex: "factory-write:bug-fix" });
  try {
    const { hub } = t;
    const { project, grant, dir, conv } = await routed(t);
    t.wslState({ reapLeaves: true });
    const { run } = await hub.runs.start({ conversationId: conv.id, provider: "codex", access: "workspace-write", grantId: grant.id, actor: "test" });
    const done = await settled(hub, run.id);
    assert.equal(done.evidence.environment.reap.ok, false);
    const lease = hub.leases.current(`workspace:${path.resolve(dir).toLowerCase()}`);
    assert.ok(lease && lease.status === "retained", `lease retained (got ${JSON.stringify(lease)})`);
    // A blocked run on this route is recorded as such (the delivery bundle must not call it a Windows writer).
    hub.bus.transaction(() => hub.settings.set("mode", "BUILD_SAFE", "test"));
    const conv2 = hub.conversations.create({ projectId: project.id, title: "b" }, "test");
    hub.conversations.addMessage({ conversationId: conv2.id, role: "user", content: "x" }, "test");
    await assert.rejects(hub.runs.start({ conversationId: conv2.id, provider: "codex", access: "workspace-write", grantId: grant.id, actor: "test" }), (e) => e.category === "gate");
    const blocked = hub.runs.listRuns({ conversationId: conv2.id })[0];
    assert.equal(blocked.environment, "wsl-runner");
  } finally { await t.cleanup(); }
});

test("M05-RV-10 (security F6) on the environment route a command asking for extra permissions or network is declined without asking", async () => {
  const t = await wslHub({ codex: "approval-escalate" });
  try {
    const { hub } = t;
    const { grant, conv } = await routed(t);
    const { run } = await hub.runs.start({ conversationId: conv.id, provider: "codex", access: "workspace-write", grantId: grant.id, actor: "test" });
    await settled(hub, run.id);
    const reply = t.readLog("codex").find((e) => e.approvalReply)?.approvalReply;
    assert.deepEqual(reply, { decision: "decline" });
    assert.equal(hub.db.prepare("SELECT COUNT(*) AS n FROM approvals WHERE action_kind = ?").get("provider.command").n, 0, "the owner was not asked");
  } finally { await t.cleanup(); }
});
