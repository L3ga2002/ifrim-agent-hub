import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { makeTestHub, enableLive, waitFor } from "./helpers.mjs";
import { codexIsolationArgs, codexProfileToml, claudeDeniedReads, claudeAbsolute, evaluateIsolation, CODEX_PROFILE_BY_ACCESS, PROTECTED_PROJECT_PATHS, PROTECTED_HOME_PATHS,
  PROTECTED_CODEX_HOME_ENTRIES, CODEX_ACL_CONSENT_TEXT, hubProtectedPaths, codexDeniedPaths, denyListFingerprint } from "../server/policy/isolation.mjs";
import { resolveInScope, isProtectedRelative } from "../server/security/paths.mjs";

const TERMINAL = ["completed", "failed", "blocked", "interrupted"];
async function runOnce(t, { provider, access = "read-only", model = "" }) {
  const { hub } = t;
  await enableLive(hub, { provider, access });
  const project = hub.projects.hub();
  const conversation = hub.bus.transaction(() => hub.conversations.create({ projectId: project.id, title: "Isolation" }, "user"));
  hub.bus.transaction(() => hub.conversations.addMessage({ conversationId: conversation.id, role: "user", content: "Summarise the README." }, "user"));
  let runId;
  try { runId = (await hub.runs.start({ conversationId: conversation.id, provider, access, model })).run.id; }
  catch (error) {
    // A gate refusal records a blocked run and throws with the failed checks.
    if (error.category !== "gate") throw error;
    return { ...hub.runs.getRun(error.details?.runId), gateChecks: error.details?.checks || [] };
  }
  return waitFor(() => { const r = hub.runs.getRun(runId); return TERMINAL.includes(r.status) ? r : null; }, 20000);
}

test("M02-SEC-01 Codex profile: protected project paths, .env anywhere and credential dirs are denied; network stays off", () => {
  for (const access of ["read-only", "workspace-write"]) {
    const toml = codexProfileToml(access, { homeDir: "C:\\Users\\someone" });
    for (const p of PROTECTED_PROJECT_PATHS) assert.ok(toml.includes(`${JSON.stringify(p)}="deny"`), p);
    assert.ok(toml.includes(`"**/.env"="deny"`) && toml.includes(`"**/.env.*"="deny"`));
    for (const p of PROTECTED_HOME_PATHS) assert.ok(toml.includes(JSON.stringify(path.join("C:\\Users\\someone", ...p.split("/")))), p);
    for (const p of PROTECTED_CODEX_HOME_ENTRIES) assert.ok(toml.includes(JSON.stringify(path.join("C:\\Users\\someone", ...p.split("/")))), p);
    // ~/.codex itself is never denied: the sandbox runner lives in ~/.codex/.sandbox-bin and a child cannot re-allow it.
    assert.equal(toml.includes(`${JSON.stringify(path.join("C:\\Users\\someone", ".codex"))}="deny"`), false, "~/.codex directory is not denied");
    // The Hub's own private data is denied by absolute path, even when the workspace is another project.
    for (const p of hubProtectedPaths()) assert.ok(toml.includes(`${JSON.stringify(p)}="deny"`), `absolute ${p}`);
    assert.ok(toml.includes("network={enabled=false}"));
    assert.ok(toml.includes(`":root"="read"`), "the elevated Windows sandbox requires :root read; specific paths are denied instead");
    assert.equal(toml.includes(`"."="write"`), access === "workspace-write");
    assert.equal(toml.startsWith(`{extends=":workspace"`), access === "workspace-write");
  }
  const win = codexIsolationArgs("read-only", { platform: "win32", homeDir: "C:\\h" });
  assert.deepEqual(win.slice(0, 2), ["-c", 'windows.sandbox="elevated"']);
  assert.ok(win.includes(`default_permissions="${CODEX_PROFILE_BY_ACCESS["read-only"]}"`));
  assert.equal(codexIsolationArgs("read-only", { platform: "linux", homeDir: "/h" }).includes('windows.sandbox="elevated"'), false);
  assert.throws(() => codexIsolationArgs("danger-full-access"));
});

test("M02-SEC-02 Claude denials: absolute //c/ form for the project, .env anywhere and home credential dirs", () => {
  if (process.platform === "win32") assert.equal(claudeAbsolute("C:\\Work\\Proj"), "//c/Work/Proj");
  const project = process.platform === "win32" ? "C:\\Work\\Proj" : "/work/proj";
  const home = process.platform === "win32" ? "C:\\Users\\someone" : "/home/someone";
  const rules = claudeDeniedReads(project, { homeDir: home });
  const abs = claudeAbsolute(project);
  for (const p of PROTECTED_PROJECT_PATHS) {
    assert.ok(rules.includes(`Read(./${p}/**)`), p);
    assert.ok(rules.includes(`Read(${abs}/${p}/**)`), `absolute ${p}`);
  }
  for (const rule of ["Read(//**/.env)", "Read(//**/.env.*)", "Read(./**/.env)"]) assert.ok(rules.includes(rule), rule);
  for (const p of [".codex", ".ssh", ".claude"]) assert.ok(rules.includes(`Read(${claudeAbsolute(path.join(home, p))}/**)`), p);
  for (const p of hubProtectedPaths()) assert.ok(rules.includes(`Read(${claudeAbsolute(p)}/**)`), `Hub ${p} denied by absolute path`);
});

test("M02-SEC-01b Hub protected paths: absolute, de-duplicated, nested entries dropped; consent fingerprint follows the exact list", () => {
  const root = process.platform === "win32" ? "C:\\Hub" : "/hub";
  const list = hubProtectedPaths({ hubRoot: root, extra: [path.join(root, ".ifrim", "private"), path.join(root, ".IFRIM", "private", "db"), path.join(root, "elsewhere")] });
  assert.deepEqual(list, [path.join(root, ".ifrim", "private"), path.join(root, ".ifrim", "BACKUPS"), path.join(root, ".ifrim", "tmp"), path.join(root, "elsewhere")]);
  const paths = codexDeniedPaths({ homeDir: root, hubRoot: root });
  assert.equal(denyListFingerprint(paths), denyListFingerprint([...paths].reverse()), "order does not matter");
  assert.notEqual(denyListFingerprint(paths), denyListFingerprint(paths.slice(1)), "a changed list needs a new consent");
});

test("M02-SEC-03 isolation matrix: Codex needs a ready sandbox and the Hub profile; Claude may only run read-only tools", () => {
  const ready = { readiness: "ready", profiles: [{ id: "ifrim_hub_ro", allowed: true }, { id: "ifrim_hub_rw", allowed: true }] };
  const consent = { confirmedAt: "2026-09-30T10:00:00Z", fingerprint: "abc" };
  assert.equal(evaluateIsolation({ provider: "codex", sandbox: ready, platform: "win32", consent, fingerprint: "abc" }).level, "os");
  assert.equal(evaluateIsolation({ provider: "codex", access: "workspace-write", sandbox: ready, platform: "win32", consent, fingerprint: "abc" }).ok, true);
  // Persistent ACEs need the owner's consent on Windows, for the exact current list.
  assert.match(evaluateIsolation({ provider: "codex", sandbox: ready, platform: "win32" }).detail, /NEEDS_LIVE_APPROVAL.*persistente/);
  assert.match(evaluateIsolation({ provider: "codex", sandbox: ready, platform: "win32", consent, fingerprint: "def" }).detail, /NEEDS_LIVE_APPROVAL.*schimbat/);
  assert.match(evaluateIsolation({ provider: "codex", sandbox: { ...ready, readiness: "notConfigured" }, platform: "win32" }).detail, /SECURITY_BLOCKER.*notConfigured/);
  assert.match(evaluateIsolation({ provider: "codex", sandbox: null, platform: "win32" }).detail, /neverificat/);
  assert.match(evaluateIsolation({ provider: "codex", sandbox: { readiness: "ready", profiles: [{ id: "ifrim_hub_ro", allowed: false }] }, platform: "win32" }).detail, /nepermis/);
  assert.equal(evaluateIsolation({ provider: "codex", sandbox: { profiles: ready.profiles }, platform: "linux" }).ok, true, "readiness is a Windows-only fact");
  assert.equal(evaluateIsolation({ provider: "claude", access: "read-only", platform: "win32" }).level, "tool");
  const write = evaluateIsolation({ provider: "claude", access: "workspace-write", platform: "win32" });
  assert.equal(write.ok, false);
  assert.match(write.detail, /Windows nativ/);
  assert.equal(evaluateIsolation({ provider: "claude", access: "workspace-write", platform: "linux" }).ok, false);
});

test("M02-SEC-04 gate: a Codex run without a ready sandbox is blocked before any thread (fake app-server)", async () => {
  const t = await makeTestHub({ codex: "sandbox-not-ready" });
  try {
    const run = await runOnce(t, { provider: "codex" });
    assert.equal(run.status, "blocked");
    assert.match(run.errorMessage, /isolation|SECURITY_BLOCKER/);
    assert.equal(t.readLog("codex").filter((e) => e.method === "thread/start" || e.method === "turn/start").length, 0);
    const probe = t.hub.providerState.get("codex");
    assert.equal(probe.sandbox.readiness, "notConfigured");
  } finally { await t.cleanup(); }
});

test("M02-SEC-05 gate: a Codex run whose Hub profile is not listed as allowed is blocked", async () => {
  const t = await makeTestHub({ codex: "no-profile" });
  try {
    const run = await runOnce(t, { provider: "codex" });
    assert.equal(run.status, "blocked");
    assert.match(run.errorMessage, /ifrim_hub_ro/);
  } finally { await t.cleanup(); }
});

test("M02-SEC-06 Codex: a thread reporting full access stops before the turn; normal runs carry the profile, not legacy sandbox params", async () => {
  const t = await makeTestHub({ codex: "full-access" });
  try {
    const run = await runOnce(t, { provider: "codex" });
    assert.equal(run.errorCategory, "policy");
    assert.equal(run.preInference, true);
    assert.match(run.errorMessage, /dangerFullAccess/);
    assert.equal(t.readLog("codex").filter((e) => e.method === "turn/start").length, 0);
  } finally { await t.cleanup(); }
  const ok = await makeTestHub();
  try {
    const run = await runOnce(ok, { provider: "codex" });
    assert.equal(run.status, "completed");
    const launch = ok.readLog("codex").find((e) => Array.isArray(e.launchArgs)).launchArgs;
    assert.ok(launch.includes('default_permissions="ifrim_hub_ro"'));
    if (process.platform === "win32") assert.ok(launch.includes('windows.sandbox="elevated"'));
    const start = ok.readLog("codex").find((e) => e.method === "thread/start");
    assert.equal(start.params.sandbox, undefined);
  } finally { await ok.cleanup(); }
});

test("M02-SEC-07 gate: Claude with shell access is blocked on native Windows (no OS sandbox); read-only runs pass the isolation check", async () => {
  const t = await makeTestHub();
  try {
    const project = t.hub.projects.hub();
    await enableLive(t.hub, { provider: "claude", access: "workspace-write" });
    const write = t.hub.gate.evaluate({ provider: "claude", projectId: project.id, access: "workspace-write" }).checks.find((c) => c.id === "isolation");
    const read = t.hub.gate.evaluate({ provider: "claude", projectId: project.id, access: "read-only" }).checks.find((c) => c.id === "isolation");
    assert.equal(read.ok, true);
    assert.equal(read.level, "tool");
    assert.equal(write.ok, false);
    assert.match(write.detail, /SECURITY_BLOCKER/);
  } finally { await t.cleanup(); }
});

test("M02-SEC-08 Claude -p receives absolute denials for the project's protected paths and the home credential dirs", async () => {
  const t = await makeTestHub();
  try {
    const run = await runOnce(t, { provider: "claude", model: "sonnet" });
    assert.equal(run.status, "completed");
    const args = t.readLog("claude").find((e) => Array.isArray(e.args) && e.args.includes("-p")).args;
    const i = args.indexOf("--disallowedTools");
    const rules = args.slice(i + 1, args.findIndex((a, k) => k > i && a.startsWith("--")));
    const abs = claudeAbsolute(fs.realpathSync.native(t.projectDir));
    assert.ok(rules.includes(`Read(${abs}/.ifrim/private/**)`) || rules.includes(`Read(${claudeAbsolute(t.projectDir)}/.ifrim/private/**)`), rules.join(" "));
    assert.ok(rules.includes(`Read(${claudeAbsolute(path.join(t.homeDir, ".codex"))}/**)`));
    assert.ok(rules.includes("Read(//**/.env)"));
  } finally { await t.cleanup(); }
});

test("M02-SEC-09 Hub file routes: protected dirs, secret names and junctions into them are refused server-side (fictive canaries)", async () => {
  const t = await makeTestHub();
  try {
    const dir = t.projectDir;
    const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
    put(".ifrim/private/canary.txt", "CANARY-PRIVATE-FICTIVE");
    put(".ifrim/BACKUPS/canary.txt", "CANARY-BACKUP-FICTIVE");
    put(".ifrim/tmp/canary.txt", "CANARY-TMP-FICTIVE");
    put(".env", "CANARY_ENV=fictive");
    put("docs/notes.md", "public");
    const outside = path.join(path.dirname(dir), `outside-${Date.now()}`);
    fs.mkdirSync(outside, { recursive: true }); fs.writeFileSync(path.join(outside, "x.md"), "CANARY-OUTSIDE-FICTIVE");
    // Junctions need no privilege on Windows (symlinks elsewhere); a test is skipped only when creation itself throws.
    const link = (target, rel) => { try { fs.symlinkSync(target, path.join(dir, ...rel.split("/")), "junction"); return true; } catch { return false; } };
    const junction = link(path.join(dir, ".ifrim", "private"), "linked");
    const outLink = link(outside, "out-link");
    const innerLink = link(path.join(dir, ".ifrim", "private"), "docs/inner-link");
    const dangling = link(path.join(dir, "gone"), "dangling-link");
    const docsLink = link(path.join(dir, "docs"), "docs-link");
    for (const rel of [".ifrim/private/canary.txt", ".ifrim/BACKUPS/canary.txt", ".ifrim/tmp/canary.txt", ".env", ".IFRIM\\Private\\canary.txt", "docs/../.ifrim/private/canary.txt", ...(junction ? ["linked/canary.txt"] : [])]) {
      assert.throws(() => resolveInScope(dir, rel), /protected|Secret/i, rel);
    }
    assert.ok(resolveInScope(dir, "docs/notes.md").endsWith("notes.md"));
    const invoke = async (toolId, args) => (await t.hub.commands.dispatch({ type: "tool.invoke", payload: { toolId, projectId: t.hub.projects.hub().id, args }, actor: "user", channel: "test" })).result;
    await assert.rejects(invoke("files.read", { path: ".ifrim/private/canary.txt" }), /protected/);
    if (junction) await assert.rejects(invoke("files.read", { path: "linked/canary.txt" }), /protected/);
    const root = await invoke("files.list", { path: "." });
    const listed = (root.result || root).entries;
    const names = listed.map((e) => e.name);
    assert.ok(!names.includes(".env") && !names.includes(".git"));
    // A link is judged by where it really leads: into a protected location, out of the project or nowhere, even its name is hidden.
    if (junction) assert.ok(!names.includes("linked"), "a junction into .ifrim/private is not listed");
    if (outLink) assert.ok(!names.includes("out-link"), "a junction out of the project is not listed");
    if (dangling) assert.ok(!names.includes("dangling-link"), "a dangling junction is not listed");
    if (innerLink) assert.ok(!(await invoke("files.list", { path: "docs" })).entries.some((e) => e.name === "inner-link"), "the check applies in subfolders too");
    if (docsLink) {
      assert.deepEqual(listed.find((e) => e.name === "docs-link"), { name: "docs-link", type: "dir", link: true }, "a link that stays in scope is listed as what it leads to");
      assert.deepEqual((await invoke("files.list", { path: "docs-link" })).entries.map((e) => e.name).filter((n) => n === "notes.md"), ["notes.md"]);
    }
    await assert.rejects(invoke("files.list", { path: "docs/notes.md" }), (e) => e.category === "validation", "a file is not listed as a folder");
    const ifrim = await invoke("files.list", { path: ".ifrim" });
    assert.deepEqual((ifrim.result || ifrim).entries.map((e) => e.name).filter((n) => ["private", "BACKUPS", "tmp"].includes(n)), [], "protected directories are not even listed");
    for (const rel of [".ifrim/private", ".ifrim/BACKUPS/x.zip", "a/.env.local", ".git"]) assert.ok(isProtectedRelative(rel), rel);
    for (const rel of ["src/app.js", ".ifrim/V2_SPEC.md", "docs/.env.example"]) assert.ok(!isProtectedRelative(rel), rel);
  } finally { await t.cleanup(); }
});

test("M02-SEC-10 artifacts: protected locations are judged relative to the project (a Hub living under .ifrim/tmp still works); junctions into them are refused", async () => {
  const t = await makeTestHub();
  try {
    const dir = t.projectDir;
    assert.ok(/[\\/]\.ifrim[\\/]tmp[\\/]/i.test(dir), "the test project itself lives under .ifrim/tmp");
    const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
    put("docs/report.md", "# Public report\n");
    put(".ifrim/tmp/canary.txt", "CANARY-TMP-FICTIVE");
    put(".ifrim/BACKUPS/canary.txt", "CANARY-BACKUP-FICTIVE");
    const register = async (filePath) => (await t.hub.commands.dispatch({ type: "artifact.register", payload: { projectId: t.hub.projects.hub().id, kind: "doc", title: filePath, source: "local_file", filePath }, actor: "user", channel: "test" })).result;
    assert.equal((await register("docs/report.md")).path, "docs/report.md");
    for (const rel of [".ifrim/tmp/canary.txt", ".ifrim/BACKUPS/canary.txt", ".IFRIM/Tmp/canary.txt"]) await assert.rejects(register(rel), (e) => e.category === "policy", rel);
    let junction = false;
    try { fs.symlinkSync(path.join(dir, ".ifrim", "tmp"), path.join(dir, "shortcut"), "junction"); junction = true; } catch { /* platform without junctions */ }
    if (junction) await assert.rejects(register("shortcut/canary.txt"), (e) => e.category === "policy");
    const outside = path.join(path.dirname(dir), `outside-${Date.now()}`);
    fs.mkdirSync(outside, { recursive: true }); fs.writeFileSync(path.join(outside, "x.md"), "outside");
    let outJunction = false;
    try { fs.symlinkSync(outside, path.join(dir, "out-link"), "junction"); outJunction = true; } catch { /* platform without junctions */ }
    if (outJunction) await assert.rejects(register("out-link/x.md"), (e) => e.category === "policy");
  } finally { await t.cleanup(); }
});

test("M02-SEC-11 integration registry: a Hub tool that still needs an install approval is never reported as available", async () => {
  const { hubToolStatus } = await import("../server/domain/integrations.mjs");
  assert.equal(hubToolStatus("NEEDS_INSTALL_APPROVAL"), "needs_setup");
  assert.equal(hubToolStatus("blocked"), "blocked");
  assert.equal(hubToolStatus("available (approval per URL)"), "available");
  const t = await makeTestHub();
  try {
    const row = t.hub.integrations.list().find((i) => i.name === "browser.inspect");
    assert.equal(row.status, t.hub.tools.browserStatus().installed ? "available" : "needs_setup");
    assert.equal(row.approvalPolicy.policy, "ALWAYS_ASK");
  } finally { await t.cleanup(); }
});

test("M02-SEC-12 Codex ACL consent: exact text + current list fingerprint; the gate blocks a Codex run without it and after a revoke", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    await enableLive(hub, { provider: "codex", isolationConsent: false });
    const project = hub.projects.hub();
    const verdict = hub.gate.evaluate({ provider: "codex", projectId: project.id, access: "read-only" });
    const iso = verdict.checks.find((c) => c.id === "isolation");
    if (process.platform === "win32") { assert.equal(iso.ok, false); assert.match(iso.detail, /NEEDS_LIVE_APPROVAL/); }
    const dispatch = async (type, payload) => (await hub.commands.dispatch({ type, payload, actor: "user", channel: "ui" })).result;
    const { fingerprint } = hub.codexIsolation();
    await assert.rejects(dispatch("isolation.consent", { provider: "codex", confirmText: "da", fingerprint }), (e) => e.category === "validation");
    await assert.rejects(dispatch("isolation.consent", { provider: "codex", confirmText: CODEX_ACL_CONSENT_TEXT, fingerprint: "0000000000000000" }), (e) => e.category === "conflict");
    await assert.rejects(hub.commands.dispatch({ type: "isolation.consent", payload: { provider: "codex", confirmText: CODEX_ACL_CONSENT_TEXT, fingerprint }, actor: "user", channel: "voice" }), (e) => e.category === "policy", "voice cannot consent");
    const recorded = await dispatch("isolation.consent", { provider: "codex", confirmText: CODEX_ACL_CONSENT_TEXT, fingerprint });
    assert.equal(recorded.consent.fingerprint, fingerprint);
    assert.ok(recorded.consent.paths.length >= 10);
    assert.equal(hub.gate.evaluate({ provider: "codex", projectId: project.id, access: "read-only" }).checks.find((c) => c.id === "isolation").ok, true);
    await hub.commands.dispatch({ type: "isolation.revoke", payload: { provider: "codex" }, actor: "user", channel: "voice" });
    if (process.platform === "win32") assert.equal(hub.gate.evaluate({ provider: "codex", projectId: project.id, access: "read-only" }).checks.find((c) => c.id === "isolation").ok, false);
  } finally { await t.cleanup(); }
});

test("M02-SEC-13 test projects: only a marked, direct child of the projects root without secrets or links can be registered for execution; retire withdraws it", async () => {
  const { TEST_PROJECT_MARKER } = await import("../server/domain/projects.mjs");
  const t = await makeTestHub();
  try {
    const { hub, config } = t;
    const root = config.projectsRoot;
    const marker = JSON.stringify({ createdBy: "ifrim-agent-hub", purpose: "live-validation", name: "Test Proj" });
    const mk = (rel, withMarker = true, extra = {}) => {
      const dir = path.join(root, ...rel.split("/"));
      fs.mkdirSync(dir, { recursive: true });
      if (withMarker) fs.writeFileSync(path.join(dir, TEST_PROJECT_MARKER), marker);
      for (const [f, text] of Object.entries(extra)) fs.writeFileSync(path.join(dir, f), text);
      return dir;
    };
    const run = async (type, payload, channel = "ui") => (await hub.commands.dispatch({ type, payload, actor: "user", channel })).result;
    const refused = async (payload, category, label) => assert.rejects(run("project.register_test", payload), (e) => e.category === category, label);
    await refused({ path: mk("no-marker", false), name: "No Marker" }, "policy", "marker required");
    await refused({ path: mk("outer/nested"), name: "Nested" }, "policy", "direct child only");
    await refused({ path: config.hubRoot, name: "Hub" }, "policy", "hub refused");
    await refused({ path: mk("with-secret", true, { ".env": "CANARY=fictive" }), name: "Secret" }, "policy", "secret-like file refused");
    await refused({ path: path.join(path.dirname(root), "outside-root"), name: "Outside" }, "policy", "outside the projects root");
    const good = mk("live-test");
    let junction = false;
    try { fs.symlinkSync(good, path.join(root, "linked-test"), "junction"); junction = true; } catch { /* no junctions */ }
    if (junction) await refused({ path: path.join(root, "linked-test"), name: "Linked" }, "policy", "junction refused");
    await assert.rejects(run("project.register_test", { path: good, name: "Test Proj" }, "voice"), (e) => e.category === "policy", "voice cannot register");
    const p = await run("project.register_test", { path: good, name: "Test Proj" });
    assert.equal(p.executionAllowed, true);
    assert.equal(p.source, "hub-test");
    assert.equal((await run("project.register_test", { path: good, name: "Test Proj" })).alreadyRegistered, true, "idempotent");
    await refused({ path: mk("other-test"), name: "Test Proj" }, "conflict", "slug collision");
    const scope = hub.gate.evaluate({ provider: "claude", projectId: p.id, access: "read-only" }).checks.find((c) => c.id === "project_scope");
    assert.equal(scope.ok, true, "the gate accepts the test project scope");
    assert.equal((await run("project.retire_test", { projectId: p.id })).executionAllowed, false);
    assert.equal(hub.gate.evaluate({ provider: "claude", projectId: p.id, access: "read-only" }).checks.find((c) => c.id === "project_scope").ok, false);
    await assert.rejects(run("project.retire_test", { projectId: hub.projects.hub().id }), (e) => e.category === "policy", "regular projects cannot be retired here");
  } finally { await t.cleanup(); }
});

test("M02-SEC-14 test projects: the whole tree is checked (nested secrets, inner junctions, .ifrim/private, size bounds); the script's own shape is still accepted", async () => {
  const { TEST_PROJECT_MARKER, TEST_PROJECT_LIMITS, testProjectTreeProblem } = await import("../server/domain/projects.mjs");
  const t = await makeTestHub();
  try {
    const { hub, config } = t;
    const put = (dir, rel, text = "x") => { const file = path.join(dir, ...rel.split("/")); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
    const mk = (name, files = {}) => {
      const dir = path.join(config.projectsRoot, name);
      put(dir, TEST_PROJECT_MARKER, JSON.stringify({ createdBy: "ifrim-agent-hub", purpose: "live-validation", name, stack: "Node.js (node:test)" }));
      for (const [rel, text] of Object.entries(files)) put(dir, rel, text);
      return dir;
    };
    const register = async (dir, name) => (await hub.commands.dispatch({ type: "project.register_test", payload: { path: dir, name }, actor: "user", channel: "ui" })).result;
    const refused = (dir, pattern, label) => assert.rejects(register(dir, `Refused ${label}`), (e) => e.category === "policy" && pattern.test(e.message), label);
    await refused(mk("nested-env", { "src/.env": "CANARY=fictive" }), /secret-like files \(src\/\.env\)/, "nested .env");
    await refused(mk("deep-key", { "config/keys/server.pem": "fictive" }), /secret-like files \(config\/keys\/server\.pem\)/, "deep key file");
    await refused(mk("with-private", { ".ifrim/private/x.json": "{}" }), /\.ifrim\/private/, ".ifrim/private");
    await refused(mk("nested-private", { "tools/.IFRIM/Private/x.json": "{}" }), /\.ifrim\/private/i, "nested .ifrim/private, any case");
    const inner = mk("inner-link", { "src/app.js": "export {};\n", "shared/util.js": "export {};\n" });
    let junction = false;
    try { fs.symlinkSync(path.join(inner, "shared"), path.join(inner, "src", "shared-link"), "junction"); junction = true; } catch { /* platform without junctions */ }
    if (junction) await refused(inner, /links or junctions \(src\/shared-link\)/, "an inner junction, even to a harmless folder");
    const levels = (n) => Array.from({ length: n }, (_, i) => `d${i}`).join("/");
    await refused(mk("too-deep", { [`${levels(TEST_PROJECT_LIMITS.maxDepth)}/file.txt`]: "x" }), /Too large/, "deeper than the walk limit");
    assert.equal(testProjectTreeProblem(mk("deep-enough", { [`${levels(TEST_PROJECT_LIMITS.maxDepth - 1)}/file.txt`]: "x" })), null, "exactly at the depth limit is accepted");
    const counted = mk("counted", { "a.txt": "1", "b.txt": "2", "src/c.txt": "3" }); // marker + a + b + src + src/c = 5 entries
    assert.equal(testProjectTreeProblem(counted, { maxEntries: 5 }), null);
    assert.match(testProjectTreeProblem(counted, { maxEntries: 4 }), /Too large.*over 4 entries/, "more entries than the bound are refused, never sampled");
    assert.equal(TEST_PROJECT_LIMITS.maxEntries, 5000);
    assert.equal(hub.projects.list().filter((p) => p.source === "hub-test").length, 0, "no refused project was registered");

    // Same shape as v2/scripts/create-test-project.mjs (plus the Hub backups the gate writes into it), with its own git repo.
    const shaped = mk("ifrim-hub-live-test", {
      "README.md": "# Ifrim Hub Test\n", ".gitignore": "node_modules/\n.env\n.env.*\n.ifrim/BACKUPS/\n.ifrim/private/\n.ifrim/tmp/\n",
      "package.json": JSON.stringify({ name: "ifrim-hub-live-test", version: "0.1.0", private: true, type: "module", scripts: { test: "node --test" } }, null, 2),
      "src/validate.js": "export function validateContact() { return { ok: true, errors: {} }; }\n",
      "test/validate.test.js": "import test from \"node:test\";\ntest(\"ok\", () => {});\n",
      ".ifrim/BACKUPS/v2/bkp_fixture.zip": "fictive", ".ifrim/BACKUPS/v2/bkp_fixture.manifest.json": "{}",
    });
    const git = (...args) => execFileSync("git", ["-C", shaped, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", ...args], { stdio: "pipe" });
    git("init", "-q"); git("add", "."); git("commit", "-q", "-m", "fixture");
    const p = await register(shaped, "Ifrim Hub Test");
    assert.equal(p.source, "hub-test");
    assert.equal(p.executionAllowed, true);
    assert.equal((await register(shaped, "Ifrim Hub Test")).alreadyRegistered, true);

    // A marker that is a link would be read from elsewhere; only a real marker file counts.
    const linkedMarker = path.join(config.projectsRoot, "linked-marker");
    fs.mkdirSync(linkedMarker, { recursive: true });
    let fileLink = false;
    try { fs.symlinkSync(path.join(shaped, TEST_PROJECT_MARKER), path.join(linkedMarker, TEST_PROJECT_MARKER), "file"); fileLink = true; } catch { /* file symlinks need a privilege on Windows */ }
    if (fileLink) await refused(linkedMarker, /Missing/, "a linked marker");
  } finally { await t.cleanup(); }
});
