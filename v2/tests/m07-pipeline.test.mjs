// Milestone 07 — the Software Factory's E2E and review stages INSIDE the attested wsl-runner environment: the browser E2E
// runs in the preview's own local-only namespace (Chromium for Linux with its own sandbox, canary C19) and the read-only
// review runs as claude@wsl-runner in its own bwrap sandbox (canary C20). The argv of both is defined once
// (sandbox-profiles.mjs) and the canary attests exactly that argv. Everything here runs on the SIMULATED distro
// (tests/fixtures/fake-wsl.mjs: no namespace, a fake Playwright, fake-claude as the reviewer): PASS_SIMULATED only. The real
// measurement of the same argv is the canary (C18–C20 lines in the M07 report).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeTestHub, enableLive, waitFor, freePort } from "./helpers.mjs";
import { materializeFixture, demoSpec } from "../server/factory/fixtures.mjs";
import { localOnlyArgs, reviewerArgs, shellArray, REVIEWER_ENV, PW_PKG, PW_BROWSERS, CLAUDE_PKG, REVIEWER_CONFIG, CLAUDE_IN_SANDBOX } from "../server/environments/sandbox-profiles.mjs";
import { canaryPrelude, CANARY_CHECK_IDS, CANARY_OPTIONAL_IDS, CANARY_WORKSPACES } from "../server/environments/canary.mjs";
import { attestationStatusOf, fingerprintOf, FINGERPRINT_FIELDS } from "../server/environments/wsl-runner.mjs";
import { environmentOverview } from "../server/environments/overview.mjs";
import { BILLING_RISK_ENV } from "../server/policy/billing.mjs";
import { CLAUDE_GUARD_ENV } from "../server/providers/claude.mjs";
import { ENV_POLICY_TEXT, environmentCoverage, claudeLinuxDeniedReads } from "../server/policy/isolation.mjs";
import { measureChromiumSandbox } from "../server/tools/browser-core.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const dispatch = (hub, type, payload, channel = "test") => hub.commands.dispatch({ type, payload, actor: "test", channel }).then((r) => r.result);
const settled = (hub, id, ms = 90000) => waitFor(() => { const r = hub.runs.getRun(id); return ["completed", "failed", "blocked", "interrupted"].includes(r.status) ? r : null; }, ms, 100);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const SETTLED = ["BLOCKED", "NEEDS_OWNER_DECISION", "DELIVERY_READY", "CANCELLED", "PAUSED"];

/** What the M07 install adds to the inspection (the values measured in ifrim-runner on 2026-10-02). */
const INSTALLED = Object.freeze({ pw_version: "1.61.0", pw_chromium: "chromium_headless_shell-1228", pw_sha: "670ba079b7510774", pw_owner: "runner", claude_cli: "2.1.285",
  claude_path: "/home/runner/tools/claude/node_modules/@anthropic-ai/claude-code/bin/claude.exe", claude_sha: "33dad1ec615a2e08", claude_owner: "runner",
  reviewer_config: "present:700", reviewer_creds: "present:600", reviewer_settings: "absent" });
/** The fake distro's state always keeps the installed facts (a lost fact would change the fingerprint and void the attestation). */
const setState = (t, extra = {}) => t.wslState({ ...extra, facts: { ...INSTALLED, ...(extra.facts || {}) } });
const browserLog = (t) => { const f = path.join(t.dataDir, "fake-browser.log"); return fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []; };

async function envHub(state = {}, options = {}) {
  const t = await makeTestHub({ wsl: { ...state, facts: { ...INSTALLED, ...(state.facts || {}) } }, queues: true, ...options });
  await dispatch(t.hub, "environment.inspect", { environmentId: "wsl-runner" });
  const probe = await dispatch(t.hub, "environment.probe", { environmentId: "wsl-runner" });
  const att = await dispatch(t.hub, "environment.attest", { environmentId: "wsl-runner" });
  return { ...t, att, probe };
}
async function routedFixture(t, fixture = "service-request", { port = null, name = fixture } = {}) {
  await enableLive(t.hub, { provider: "codex", access: "workspace-write", attempts: 1 });
  const dir = path.join(t.dataDir, `factory-${name}`);
  materializeFixture(fixture, dir, { port });
  const project = await dispatch(t.hub, "project.register_test", { path: dir });
  await dispatch(t.hub, "project.environment.set", { projectId: project.id, environment: "wsl-runner" });
  return { project: t.hub.projects.get(project.id), dir };
}
const grant = (t, project, provider, access, attempts = 4) => t.hub.bus.transaction(() => t.hub.grants.create({ provider, projectId: project.id, access, maxAttempts: attempts, maxDurationS: 900, ttlMinutes: 60 }, "test"));
// M09: Claude runs only with an explicit model (sonnet here); a Codex run without one pins the account default.
async function startRun(t, project, g, { provider = "claude", access = "read-only", model = null } = {}) {
  const conv = t.hub.conversations.create({ projectId: project.id, title: "m07" }, "test");
  t.hub.conversations.addMessage({ conversationId: conv.id, role: "user", content: "verifică modificarea" }, "test");
  const { run } = await t.hub.runs.start({ conversationId: conv.id, provider, access, grantId: g.id, model: model ?? (provider === "claude" ? "sonnet" : ""), actor: "test" });
  return run;
}
async function startMission(t, project, port) {
  const { mission } = await dispatch(t.hub, "factory.prepare", { projectId: project.id, ...demoSpec("service-request", { port }), limits: { writerModel: "gpt-fake-sol", reviewerModel: "sonnet" } });
  const scope = t.hub.factory.view(mission.id).scope;
  const requested = await t.hub.commands.dispatch({ type: "factory.start", payload: scope, channel: "test", actor: "test" });
  await dispatch(t.hub, "approval.decide", { approvalId: requested.approval.id, decision: "approved", displayedHash: requested.approval.payloadHash });
  await t.hub.commands.executeApproved(requested.command.id, "user");
  return mission;
}
const untilStage = (t, missionId, stages = SETTLED, ms = 240000) => waitFor(() => { const v = t.hub.factory.view(missionId); return stages.includes(v.factory.stage) ? v : null; }, ms, 200);

test("M07-PL-01 one argv for production and canary: --share-net only for the reviewer, /work read-only for it, browser binds read-only, no Windows mount, no /etc write, no billing variable", () => {
  const ws = "/home/runner/ws/hub/pv-0123456789abcdef";
  const preview = localOnlyArgs({ repo: `${ws}/repo`, hostDir: `${ws}/host`, marker: "pv-0123456789abcdef" });
  const e2e = localOnlyArgs({ repo: `${ws}/repo`, hostDir: `${ws}/host`, marker: "pv-0123456789abcdef", browser: true });
  const rv = reviewerArgs({ repo: "/home/runner/ws/hub/run_abc/repo", marker: "run_abc" });
  const pairs = (args, flag) => args.flatMap((a, i) => (a === flag ? [[args[i + 1], args[i + 2]]] : []));
  // The network: shared only by the reviewer (its client must reach Anthropic); the preview and its E2E stay loopback-only.
  assert.ok(rv.includes("--share-net"));
  for (const args of [preview, e2e]) { assert.ok(!args.includes("--share-net")); assert.ok(args.includes("--unshare-all")); }
  // The reviewed copy is read-only for the reviewer, writable only for the preview (it is a throwaway copy).
  assert.deepEqual(pairs(rv, "--ro-bind").find(([, dest]) => dest === "/work"), ["/home/runner/ws/hub/run_abc/repo", "/work"]);
  assert.ok(!pairs(rv, "--bind").some(([, dest]) => dest === "/work"), "never a writable /work for the reviewer");
  // Its only writable bind is its own config dir, inside an otherwise empty home; nothing under /etc is ever writable.
  assert.deepEqual(pairs(rv, "--bind"), [[REVIEWER_CONFIG, "/rhome/.claude-config"]]);
  for (const args of [preview, e2e, rv]) {
    assert.ok(!pairs(args, "--bind").some(([, dest]) => dest.startsWith("/etc")), "no writable /etc entry");
    assert.ok(!args.some((a) => /^\/mnt(\/|$)/.test(a)), "nothing from Windows");
    assert.ok(args.includes("--clearenv") && args.includes("--die-with-parent") && args.includes("--new-session"));
  }
  assert.ok(pairs(rv, "--ro-bind-try").every(([src, dest]) => src === dest && dest.startsWith("/etc/")), "system files read-only, same path");
  assert.ok(pairs(rv, "--ro-bind-try").some(([, d]) => d === "/etc/passwd") && !pairs(rv, "--bind").some(([, d]) => d === "/etc/passwd"));
  assert.deepEqual(pairs(rv, "--ro-bind").find(([, d]) => d === "/opt/claude"), [CLAUDE_PKG, "/opt/claude"]);
  // No nested user namespaces for the reviewer; Chromium needs them for its own sandbox, so the E2E profile keeps them.
  assert.ok(rv.includes("--disable-userns") && rv.includes("--unshare-user"));
  assert.ok(!e2e.includes("--disable-userns"));
  // The browser binds exist only in the E2E variant, read-only.
  assert.deepEqual(pairs(e2e, "--ro-bind").filter(([, d]) => d.startsWith("/pw") || d === "/etc/fonts"), [[PW_PKG, "/pw/pkg"], [PW_BROWSERS, "/pw/browsers"], ["/etc/fonts", "/etc/fonts"]]);
  assert.ok(!preview.some((a) => a.startsWith("/pw")) && !preview.includes(PW_PKG));
  // The reviewer's environment: the Hub's Claude guards and the quiet switches; never a key, token or proxy.
  const env = Object.fromEntries(pairs(rv, "--setenv"));
  for (const [k, v] of Object.entries(CLAUDE_GUARD_ENV)) assert.equal(env[k], v, k);
  for (const k of ["CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "DISABLE_TELEMETRY", "DISABLE_ERROR_REPORTING", "DISABLE_AUTOUPDATER", "DISABLE_UPDATES"]) assert.equal(env[k], "1", k);
  assert.equal(env.ENABLE_CLAUDEAI_MCP_SERVERS, "false");
  assert.equal(env.HOME, "/rhome");
  assert.equal(env.CLAUDE_CONFIG_DIR, "/rhome/.claude-config");
  assert.equal(env.IFRIM_RUN, "run_abc", "the reaper finds the reviewer by its marker");
  assert.ok(!Object.keys(env).some((k) => BILLING_RISK_ENV.some((r) => r.toUpperCase() === k.toUpperCase())), "no API key / token / proxy variable");
  assert.deepEqual(REVIEWER_ENV, Object.fromEntries(Object.entries(env).filter(([k]) => k in REVIEWER_ENV)));
  // Validated paths and markers only.
  for (const bad of ["/home/runner/ws/hub/../repo", "/home/runner/ws/hub/./repo", "/home/runner/.codex/repo", "/home/runner/ws/hub/x/host", "/work"]) assert.throws(() => reviewerArgs({ repo: bad, marker: "abcd" }), /invalid/, bad);
  assert.throws(() => reviewerArgs({ repo: "/home/runner/ws/hub/x/repo", marker: "a b" }), /marcaj/);
  assert.throws(() => localOnlyArgs({ repo: "/home/runner/ws/hub/../repo", hostDir: "/home/runner/ws/hub/x/host", marker: "abcd" }), /invalid/);
  // The canary runs THESE arrays (generated, never a hand-written copy), on its fixed workspaces.
  const prelude = canaryPrelude().split("\n");
  assert.equal(prelude.find((l) => l.startsWith("E2E_ARGS=(")), shellArray("E2E_ARGS", localOnlyArgs({ repo: `${CANARY_WORKSPACES.e2e}/repo`, hostDir: `${CANARY_WORKSPACES.e2e}/host`, marker: "canary-e2e", browser: true })));
  assert.equal(prelude.find((l) => l.startsWith("RV_ARGS=(")), shellArray("RV_ARGS", reviewerArgs({ repo: `${CANARY_WORKSPACES.rv}/repo`, marker: "canary-rv" })));
  assert.ok(prelude.includes(`CLAUDE_IN='${CLAUDE_IN_SANDBOX}'`));
  const canary = fs.readFileSync(path.join(here, "..", "server", "environments", "scripts", "canary.sh"), "utf8");
  const c19 = canary.slice(canary.indexOf("# C19"), canary.indexOf("# C20"));
  const c20 = canary.slice(canary.indexOf("# C20"), canary.indexOf("# Fingerprint"));
  assert.ok(c19.includes('bwrap "${E2E_ARGS[@]}"') && c19.includes('ifrim_host_files "$E2/host"') && c19.includes("chromiumSandbox: true"));
  assert.ok(!/--no-sandbox["']/.test(c19) && !c19.includes("chromiumSandbox: false"));
  assert.ok(c20.includes('bwrap "${RV_ARGS[@]}"') && c20.includes('"$CLAUDE_IN" --version') && c20.includes('"$CLAUDE_IN" auth status'));
  assert.ok(!/claude[^\n]* -p\b/.test(c20), "the canary never starts a model");
  for (const id of ["C19a", "C19b", "C19c", "C19d", "C19e", "C19f", "C19g", "C19h", "C19i"]) assert.ok(c19.includes(`res ${id} `), id);
  for (const id of ["C20a", "C20b", "C20c", "C20d", "C20e", "C20f", "C20g", "C20h", "C20i", "C20j", "C20k"]) assert.ok(c20.includes(`res ${id} `), id);
  // A flag change invalidates the attestation: the canary version hashes the builders and the host files.
  const canaryMjs = fs.readFileSync(path.join(here, "..", "server", "environments", "canary.mjs"), "utf8");
  assert.match(canaryMjs, /update\(fs\.readFileSync\(path\.join\(here0, "sandbox-profiles\.mjs"\)\)\)\.update\(Object\.values\(HOST_FILES\)\.join\("\\0"\)\)\.update\(canaryPrelude\(\)\)/);
  // The reviewer's Linux deny rules keep Read/Glob/Grep inside the copy.
  const deny = claudeLinuxDeniedReads();
  for (const rule of ["Read(//rhome/**)", "Read(//proc/**)", "Read(//tmp/**)", "Read(//etc/**)", "Read(//opt/**)", "Read(//**/.env)", "Read(//work/.ifrim/private/**)", "Read(//**/*.pem)"]) assert.ok(deny.includes(rule), rule);
  assert.ok(!deny.some((r) => /^Read\(\/\/[a-z]\//.test(r)), "no Windows drive rule (//c/…)");
});

test("M07-PL-02 C19/C20 only add coverage: a failing or missing one never invalidates C1–C17, and stages are derived from what passed", () => {
  const ids = ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10", "C11", "C12", "C13", "C14", "C15", "C16", "C17", "C18", "C19", "C20"];
  const env = { ok: true, fingerprint: { hash: "abc" } };
  const canaryOf = (byId) => ({ byId: Object.fromEntries(ids.map((id) => [id, byId[id] || "PASS"])), lines: ids.map((id) => ({ id, sub: id, status: byId[id] === "FAIL" ? "FAIL" : byId[id] === "NOT_RUN" ? "NOT_RUN" : "PASS", detail: "" })) });
  assert.deepEqual([...CANARY_OPTIONAL_IDS], ["C18", "C19", "C20"]);
  assert.ok(CANARY_CHECK_IDS.includes("C19") && CANARY_CHECK_IDS.includes("C20"));
  const all = attestationStatusOf({ canary: canaryOf({}), before: env, after: env });
  assert.equal(all.status, "PASS_LOCAL");
  assert.ok(all.stages.includes("e2e-local-only") && all.stages.includes("review-environment"));
  const failed = attestationStatusOf({ canary: canaryOf({ C19: "FAIL", C20: "FAIL" }), before: env, after: env });
  assert.equal(failed.status, "PASS_LOCAL", "C1–C17 still attest the writer, checks, QA and export");
  assert.ok(!failed.stages.includes("e2e-local-only") && !failed.stages.includes("review-environment"));
  assert.ok(failed.stages.includes("writer-profile") && failed.stages.includes("preview-local-only"));
  assert.match(failed.summary, /E2E Chromium C19: EȘUAT/);
  assert.match(failed.summary, /reviewer C20: EȘUAT/);
  const missing = attestationStatusOf({ canary: canaryOf({ C19: "NOT_RUN", C20: "NOT_RUN" }), before: env, after: env });
  assert.equal(missing.status, "PASS_LOCAL");
  assert.match(missing.summary, /C19: nerulat.*C20: nerulat/);
  // E2E needs its preview: without C18 the E2E stage is not covered even with C19.
  assert.ok(!attestationStatusOf({ canary: canaryOf({ C18: "FAIL" }), before: env, after: env }).stages.includes("e2e-local-only"));
  // A required check still fails the attestation (control).
  assert.equal(attestationStatusOf({ canary: canaryOf({ C9: "FAIL" }), before: env, after: env }).status, "FAIL");
  // Coverage in the owner's words, from the recorded checks.
  const cover = (byId) => environmentCoverage({ latest: { checks: { byId } } });
  assert.match(cover({ C18: "PASS", C19: "PASS", C20: "PASS" }).text, /preview, E2E, review; nicio etapă/);
  assert.match(cover({ C18: "PASS", C19: "FAIL", C20: "NOT_RUN" }).text, /E2E, review rămân pe Windows/);
  assert.ok(ENV_POLICY_TEXT.length <= 1200, "the (b) form accepts at most 1200 characters");
  assert.match(ENV_POLICY_TEXT, /C18, C19, C20/);
  assert.match(ENV_POLICY_TEXT, /Claude Code/);
});

test("M07-PL-03 the fingerprint pins the browser and the reviewer: versions, binary hashes, config dir and credentials mode (never their content)", () => {
  for (const k of ["pwVersion", "pwChromium", "pwSha", "claude", "claudeSha", "reviewerConfig"]) assert.ok(FINGERPRINT_FIELDS.includes(k), k);
  const base = fingerprintOf({ ...INSTALLED, codex_version: "0.159.2" });
  assert.equal(base.reviewerConfig, "present:700;creds=present:600");
  for (const patch of [{ claude_sha: "ffffffffffffffff" }, { pw_sha: "ffffffffffffffff" }, { claude_cli: "2.1.286" }, { pw_chromium: "chromium_headless_shell-1229" }, { reviewer_creds: "present:644" }, { reviewer_config: "absent" }]) {
    assert.notEqual(fingerprintOf({ ...INSTALLED, codex_version: "0.159.2", ...patch }).hash, base.hash, JSON.stringify(patch));
  }
  // A settings change that is checked at every launch (fallbackModel, hooks…) is not a fingerprint change.
  assert.equal(fingerprintOf({ ...INSTALLED, codex_version: "0.159.2", reviewer_fallback: "yes" }).hash, base.hash);
  assert.ok(!Object.values(base).some((v) => /credentials|refresh|token/i.test(String(v))), "names and modes only");
  const inspect = fs.readFileSync(path.join(here, "..", "server", "environments", "scripts", "inspect.sh"), "utf8");
  assert.ok(inspect.includes('stat -c %a "$RC/.credentials.json"') && !/(cat|head|tail|node -e)[^\n]*\.credentials\.json/.test(inspect), "the credentials file is only stat-ed");
  assert.ok(!/claude[^\n]*--version|\$CLREAL"? /.test(inspect), "the inspection executes no client (versions come from package.json)");
});

test("M07-PL-04 measuring Chromium's sandbox from /proc: seccomp 2 + own user namespace + no --no-sandbox, or not active (with the reason)", () => {
  const proc = (entries) => ({
    readdirSync: () => Object.keys(entries).concat(["self", "net"]),
    readFileSync: (p) => { const [, pid, file] = p.match(/^\/proc\/(\d+)\/(\w+)$/) || []; const e = entries[pid]; if (!e) throw Object.assign(new Error("gone"), { code: "ENOENT" }); return file === "cmdline" ? e.cmdline : `Name:\tx\nNoNewPrivs:\t${e.nnp ?? 1}\nSeccomp:\t${e.seccomp}\n`; },
    readlinkSync: (p) => entries[p.match(/^\/proc\/(\d+)\//)[1]].ns,
  });
  const shell = "/pw/browsers/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell";
  const good = {
    14: { cmdline: [shell, "--headless", "--remote-debugging-pipe"].join("\0"), seccomp: 0, ns: "user:[1]" },
    17: { cmdline: "chrome-headless-shell --type=zygote --no-zygote-sandbox", seccomp: 0, ns: "user:[1]" }, // rewritten title: one string
    18: { cmdline: "chrome-headless-shell --type=zygote", seccomp: 0, ns: "user:[2]" },
    54: { cmdline: `${shell} --type=renderer --lang=en-US`, seccomp: 2, ns: "user:[2]" },
    2: { cmdline: ["/usr/local/bin/node", "/hub/preview-host.mjs"].join("\0"), seccomp: 0, ns: "user:[1]" },
  };
  const ok = measureChromiumSandbox(proc(good));
  assert.equal(ok.active, true, JSON.stringify(ok));
  assert.equal(ok.renderers, 1);
  assert.equal(ok.noSandboxFlag, false, "--no-zygote-sandbox is not --no-sandbox");
  assert.match(measureChromiumSandbox(proc({ ...good, 54: { ...good[54], seccomp: 0 } })).reason, /seccomp/);
  assert.match(measureChromiumSandbox(proc({ ...good, 54: { ...good[54], ns: "user:[1]" } })).reason, /namespace/);
  assert.match(measureChromiumSandbox(proc({ ...good, 14: { ...good[14], cmdline: [shell, "--no-sandbox"].join("\0") } })).reason, /--no-sandbox/);
  const noRenderer = { ...good }; delete noRenderer[54];
  assert.equal(measureChromiumSandbox(proc(noRenderer)).active, false);
  assert.equal(measureChromiumSandbox({ readdirSync: () => { throw Object.assign(new Error("x"), { code: "EACCES" }); } }).measured, false);
});

test("M07-PL-05 E2E inside the preview's namespace: PASS with the measured sandbox and a screenshot, FAIL on a step, BLOCKED when the sandbox is not active (host) or only simulated in a real environment (Hub), INTERRUPTED on abort; never the Windows browser", async () => {
  let windowsLaunches = 0;
  const t = await envHub({}, { hubOptions: { browserLaunch: async () => { windowsLaunches += 1; throw new Error("the Windows browser must not be used"); } } });
  const port = await freePort();
  const key = "m07-e2e-test";
  try {
    assert.equal(t.att.byId.C19, "PASS", JSON.stringify(t.att.byId));
    const { project, dir } = await routedFixture(t, "service-request", { port });
    const spec = demoSpec("service-request", { port }).spec;
    const url = spec.verification.preview.url;
    const steps = spec.acceptance.find((a) => a.verify === "e2e").steps;
    assert.equal(t.hub.factoryRunner.stageMap(project).stages.find((s) => s.stage === "e2e").boundary, "environment");
    const preview = await t.hub.factoryRunner.startPreview({ key, ws: dir, command: spec.verification.preview.command, url, project });
    assert.equal(preview.status, "PASS", `${preview.reason}\n${preview.outputTail}`);
    assert.equal(preview.runner, "bwrap-local-only@wsl-runner");
    assert.equal(preview.e2eProfile, true);
    const bw = t.wslLog().filter((e) => e.bwrap && e.bwrap.program?.[1] === "/hub/preview-host.mjs").at(-1).bwrap;
    const flags = bw.flags.join(" ");
    assert.ok(flags.includes(`--ro-bind ${PW_PKG} /pw/pkg`) && flags.includes(`--ro-bind ${PW_BROWSERS} /pw/browsers`), flags);
    assert.ok(!bw.flags.includes("--share-net"));
    assert.ok(bw.envNames.includes("PLAYWRIGHT_BROWSERS_PATH"));
    assert.deepEqual(t.wslLog().find((e) => e.previewHostFiles)?.previewHostFiles, ["preview-host.mjs", "browser-core.mjs", "redact.mjs"]);
    const e2e = t.hub.factoryRunner.e2eFor(project);
    const evidenceDir = path.join(t.dataDir, "e2e-evidence");

    const pass = await e2e({ key, url, steps, evidenceDir });
    assert.equal(pass.status, "PASS", JSON.stringify(pass).slice(0, 800));
    assert.equal(pass.runner, "playwright@wsl-runner");
    assert.equal(pass.steps.length, steps.length);
    assert.equal(pass.sandbox.simulated, true, "the fixture has no /proc: the sandbox is simulated, never claimed as measured");
    assert.match(pass.isolated, /namespace-ul preview-ului.*SIMULAT/);
    assert.ok(pass.screenshot && fs.readFileSync(path.join(evidenceDir, pass.screenshot)).subarray(0, 8).equals(PNG_SIGNATURE));
    const launch = browserLog(t).filter((e) => e.launch).at(-1).launch;
    assert.equal(launch.chromiumSandbox, true, "Chromium's own sandbox is requested");
    assert.ok(launch.args.includes("--disable-dev-shm-usage") && launch.args.some((a) => a.startsWith("--proxy-server=")) && launch.args.includes("--disable-quic"), JSON.stringify(launch.args));
    assert.ok(!launch.args.includes("--no-sandbox"));

    setState(t, { fakeBrowser: { failText: "Solicitarea a fost trimisă" } });
    const fail = await e2e({ key, url, steps, evidenceDir });
    assert.equal(fail.status, "FAIL", JSON.stringify(fail).slice(0, 600));
    const failedStep = fail.steps.find((s) => !s.ok);
    assert.equal(failedStep.kind, "expectText");
    assert.match(failedStep.error, /Timeout/);

    setState(t, { fakeBrowser: { sandbox: { active: false, reason: "un renderer nu e în modul seccomp-bpf (2)" } } });
    const inactive = await e2e({ key, url, steps, evidenceDir });
    assert.equal(inactive.status, "BLOCKED");
    assert.match(inactive.error, /sandbox-ul Chromium nu e activ: un renderer nu e în modul seccomp-bpf/);
    assert.equal(inactive.steps.length, 0, "no step of the project's page ran in an unsandboxed renderer");

    // The Hub's own check: a "simulated" sandbox is accepted only from the simulated environment.
    setState(t, {});
    t.hub.wslRunner.simulated = false;
    try {
      const notReal = await e2e({ key, url, steps, evidenceDir });
      assert.equal(notReal.status, "BLOCKED");
      assert.match(notReal.error, /simulat într-un mediu real/);
    } finally { t.hub.wslRunner.simulated = true; }

    setState(t, { fakeBrowser: { hang: true } });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 1500);
    const closedBefore = browserLog(t).filter((e) => e.closed).length;
    const interrupted = await e2e({ key, url, steps, evidenceDir, signal: controller.signal });
    assert.equal(interrupted.status, "INTERRUPTED", JSON.stringify(interrupted).slice(0, 400));
    assert.ok(interrupted.steps.every((s) => s.ok), "the interrupted step is not a failed step");
    await waitFor(() => browserLog(t).filter((e) => e.closed).length > closedBefore, 10000);
    // Steps that never validate do not reach the namespace.
    assert.equal((await e2e({ key, url, steps: [{ click: "#x" }], evidenceDir })).status, "BLOCKED");
    assert.equal(windowsLaunches, 0, "the Windows browser was never used");
    await t.hub.factoryRunner.stop(key);
    await waitFor(() => t.hub.wslRunner.listWorkspaces().filter((w) => w.purpose === "preview").every((w) => w.status === "released"), 20000);
    assert.equal((await e2e({ key, url, steps, evidenceDir })).status, "BLOCKED", "no host after the stop");
  } finally { await t.cleanup(); }
});

test("M07-PL-06 a failing C19 and C20 keep the attestation (C1–C17) but not the stages: the preview starts without the browser binds, its E2E is BLOCKED (never Windows), the review stays on Windows", async () => {
  const t = await envHub({ canaryFail: ["C19d", "C20e"] });
  const port = await freePort();
  try {
    assert.equal(t.att.status, "PASS_SIMULATED", "C19/C20 only add coverage");
    assert.equal(t.att.byId.C19, "FAIL");
    assert.equal(t.att.byId.C20, "FAIL");
    const stages = t.hub.wslRunner.attestationStatus().latest.stages;
    assert.ok(stages.includes("preview-local-only") && !stages.includes("e2e-local-only") && !stages.includes("review-environment"), stages.join(","));
    const { project, dir } = await routedFixture(t, "service-request", { port });
    const map = t.hub.factoryRunner.stageMap(project);
    const by = Object.fromEntries(map.stages.map((s) => [s.stage, s]));
    assert.equal(by.preview.boundary, "environment");
    assert.equal(by.e2e.boundary, "blocked");
    assert.match(by.e2e.where, /canary C19 FAIL/);
    assert.equal(by.review.boundary, "tool");
    assert.match(by.review.where, /reviewer-ul din wsl-runner nu e pregătit .*C20 FAIL/);
    assert.equal(map.realProjectEligible, false);
    assert.equal(t.hub.environments.routeFor(project.id, "claude"), "windows");
    const spec = demoSpec("service-request", { port }).spec;
    const preview = await t.hub.factoryRunner.startPreview({ key: "m07-noc19", ws: dir, command: spec.verification.preview.command, url: spec.verification.preview.url, project });
    assert.equal(preview.status, "PASS", preview.reason);
    assert.equal(preview.e2eProfile, false);
    const bw = t.wslLog().filter((e) => e.bwrap && e.bwrap.program?.[1] === "/hub/preview-host.mjs").at(-1).bwrap;
    assert.ok(!bw.flags.some((f) => f.startsWith("/pw")), "no browser binds without C19");
    const blocked = await t.hub.factoryRunner.e2eFor(project)({ key: "m07-noc19", url: spec.verification.preview.url, steps: spec.acceptance.find((a) => a.verify === "e2e").steps });
    assert.equal(blocked.status, "BLOCKED");
    assert.match(blocked.error, /C19/);
    assert.equal(browserLog(t).filter((e) => e.launch).length, 0, "no browser started anywhere");
    await t.hub.factoryRunner.stop("m07-noc19");
  } finally { await t.cleanup(); }
});

test("M07-PL-07 reviewer routing: claude@wsl-runner only when ready (installed, own login, C20, (b) for a real project), otherwise Windows with a tool boundary; read-only enforced by the gate and by the adapter", async () => {
  const t = await envHub();
  try {
    const { hub } = t;
    assert.equal(t.probe.reviewer.ok, true, JSON.stringify(t.probe.reviewer));
    assert.ok(t.probe.reviewer.lines.every((l) => / PASS /.test(l)), t.probe.reviewer.lines.join("\n"));
    const probe = hub.providerState.get("claude@wsl-runner");
    assert.equal(probe.auth.authMethod, "claude.ai");
    assert.equal(probe.fingerprintHash, hub.wslRunner.state().fingerprint.hash, "bound to the fingerprint");
    assert.ok(probe.installation.flags.includes("--effort"));
    assert.ok(t.wslLog().some((e) => e.bwrap?.program?.[0] === CLAUDE_IN_SANDBOX && e.bwrap.program[1] === "auth"), "the account check ran inside the reviewer sandbox");
    const { project, dir } = await routedFixture(t, "bug-demo");
    assert.equal(hub.environments.routeFor(project.id, "claude"), "wsl-runner");
    assert.equal(hub.environments.routeFor(project.id, "codex"), "wsl-runner");
    const map = hub.factoryRunner.stageMap(project);
    assert.equal(map.stages.find((s) => s.stage === "review").boundary, "environment");
    grant(t, project, "claude", "read-only");
    const ro = hub.gate.evaluate({ provider: "claude", projectId: project.id, access: "read-only" });
    assert.equal(ro.environment, "wsl-runner");
    const check = (d, id) => d.checks.find((c) => c.id === id);
    assert.equal(check(ro, "isolation").ok, true, check(ro, "isolation").detail);
    assert.equal(check(ro, "isolation").level, "os-linux");
    assert.equal(check(ro, "billing_route").ok, true, check(ro, "billing_route").detail);
    assert.match(check(ro, "billing_route").detail, /clientul din wsl-runner/);
    assert.equal(check(ro, "host_isolation").level, "environment-test");
    const rw = hub.gate.evaluate({ provider: "claude", projectId: project.id, access: "workspace-write" });
    assert.equal(check(rw, "isolation").ok, false);
    assert.match(check(rw, "isolation").detail, /doar în citire/);
    // The adapter refuses anything but read-only by itself (defence in depth), before any copy or process.
    const before = t.wslLog().length;
    const direct = await hub.providers["claude@wsl-runner"].startTurn({ runId: "run_m07_rw", cwd: dir, prompt: "x", access: "workspace-write", onEvent: () => {} }).done;
    assert.equal(direct.status, "failed");
    assert.equal(direct.preInference, true);
    assert.match(direct.error, /doar ca reviewer, doar în citire/);
    assert.equal(t.wslLog().length, before, "nothing ran in the environment");
    // The overview shows the reviewer and the stages the attestation covers.
    const ov = environmentOverview(hub).environments[0];
    assert.equal(ov.reviewer.ready, true);
    assert.match(ov.covers, /preview, E2E, review/);
    // A real project on the route: without (b) the reviewer stays on Windows exactly as before M07; with (b), the environment.
    const real = hub.projects.hub();
    await dispatch(hub, "project.environment.set", { projectId: real.id, environment: "wsl-runner" });
    assert.equal(hub.environments.routeFor(real.id, "claude"), "windows");
    const realGate = hub.gate.evaluate({ provider: "claude", projectId: real.id, access: "read-only" });
    assert.equal(realGate.environment, "windows");
    assert.equal(check(realGate, "host_isolation").level, "tool");
    await dispatch(hub, "environment.policy.approve", { confirmText: ENV_POLICY_TEXT, fingerprintHash: hub.wslRunner.state().fingerprint.hash });
    assert.equal(hub.environments.routeFor(real.id, "claude"), "wsl-runner");
    // Not ready → Windows again, with the reason in the stage map: a fallbackModel in the reviewer's settings, a lost login.
    setState(t, { facts: { reviewer_settings: "present", reviewer_fallback: "yes" } });
    await dispatch(hub, "environment.inspect", { environmentId: "wsl-runner" });
    assert.equal(hub.wslRunner.attestationStatus().valid, true, "a settings key is not a fingerprint change");
    assert.equal(hub.environments.routeFor(project.id, "claude"), "windows");
    assert.match(hub.factoryRunner.stageMap(project).stages.find((s) => s.stage === "review").where, /fallbackModel/);
    setState(t, { facts: { reviewer_creds: "absent" } });
    await dispatch(hub, "environment.inspect", { environmentId: "wsl-runner" });
    assert.equal(hub.environments.routeFor(project.id, "claude"), "windows");
    assert.match(hub.factoryRunner.stageMap(project).stages.find((s) => s.stage === "review").where, /NEEDS_AUTH/);
  } finally { await t.cleanup(); }
});

test("M07-PL-08 a read-only Claude run on the routed project runs in the reviewer sandbox: Windows flags, Linux deny rules, the guards, no export or apply, session files deleted, reaped; init refusals and the model allowlist still stop it before the model", async () => {
  const t = await envHub();
  try {
    const { hub } = t;
    const { project, dir } = await routedFixture(t, "bug-demo");
    // One fresh grant per run (a grant holds at most 5 attempts).
    const g = () => grant(t, project, "claude", "read-only", 1);
    const original = fs.readFileSync(path.join(dir, "src", "requests.js"), "utf8");
    const run = await startRun(t, project, g());
    const done = await settled(hub, run.id);
    assert.equal(done.environment, "wsl-runner");
    assert.equal(done.status, "completed", `${done.errorCategory}: ${done.errorMessage}`);
    const env = done.evidence.environment;
    assert.equal(env.role, "reviewer");
    assert.equal(env.apply.applied, 0);
    assert.equal(env.export, null, "never exported");
    assert.equal(env.reap.ok, true);
    assert.equal(env.sessionCleanup.ok, true);
    const wsId = run.id.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
    assert.ok(!t.wslLog().some((e) => e.command?.[0] === "/usr/bin/tar" && e.command.includes("-c") && String(e.cwd).includes(wsId)), "no export of the review workspace");
    const ws = hub.wslRunner.listWorkspaces().find((w) => w.runId === run.id);
    assert.equal(ws.purpose, "review");
    assert.equal(ws.status, "released");
    assert.equal(fs.readFileSync(path.join(dir, "src", "requests.js"), "utf8"), original, "the project is untouched");
    // The process: bwrap with the reviewer profile, then the CLI with the Windows reviewer's flags and Linux deny rules.
    const bw = t.wslLog().filter((e) => e.bwrap?.program?.[0] === CLAUDE_IN_SANDBOX && e.bwrap.program[1] === "-p").at(-1).bwrap;
    const flags = bw.flags.join(" ");
    assert.ok(flags.includes("--share-net") && flags.includes("--disable-userns") && flags.includes(`--ro-bind /home/runner/ws/hub/${wsId}/repo /work`), flags);
    for (const k of [...Object.keys(CLAUDE_GUARD_ENV), "CLAUDE_CONFIG_DIR", "HOME", "DISABLE_TELEMETRY", "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "IFRIM_RUN"]) assert.ok(bw.envNames.includes(k), k);
    const claudeLog = t.readLog("claude");
    const call = claudeLog.filter((e) => Array.isArray(e.args) && e.args.includes("-p")).at(-1).args;
    const after = (flag) => call[call.indexOf(flag) + 1];
    assert.equal(after("--tools"), "Read,Glob,Grep");
    assert.equal(after("--permission-mode"), "dontAsk");
    assert.equal(after("--setting-sources"), "user");
    assert.equal(after("--mcp-config"), JSON.stringify({ mcpServers: {} }));
    assert.ok(call.includes("--strict-mcp-config") && call.includes("--no-chrome") && call.includes("--session-id"));
    for (const rule of ["Read(//rhome/**)", "Read(//proc/**)", "Read(//tmp/**)", "Read(//**/.env)"]) assert.ok(call.includes(rule), rule);
    assert.ok(!call.some((a) => /^Read\(\/\/[a-z]\//.test(a)), "no Windows drive rule (//c/…) inside Linux");
    const envNames = claudeLog.filter((e) => e.envNames && /-p/.test(e.invocation || "")).at(-1).envNames;
    assert.ok(envNames.includes("CLAUDE_CONFIG_DIR") && !envNames.some((n) => BILLING_RISK_ENV.some((r) => r.toUpperCase() === n.toUpperCase())), envNames.join(","));
    assert.ok(t.wslLog().some((e) => e.reviewerCleanup === after("--session-id")), "the session's files were deleted from the reviewer's config dir");
    assert.ok(t.wslLog().some((e) => e.reap === `/home/runner/ws/hub/${wsId}`), "the workspace's processes were reaped");
    // The init refusals of the Windows reviewer apply unchanged through the environment launcher.
    for (const [scenario, category, pattern] of [["init-apikey", "billing", /apiKeySource=ANTHROPIC_API_KEY/], ["init-fable", "billing", /claude-fable-5/], ["init-mcp", "policy", /servere MCP/], ["fallback-fable", "billing", /comutat modelul/]]) {
      setState(t, { claudeScenario: scenario });
      const r = await settled(hub, (await startRun(t, project, g())).id);
      assert.equal(r.environment, "wsl-runner");
      assert.notEqual(r.status, "completed", scenario);
      assert.equal(r.errorCategory, category, `${scenario}: ${r.errorMessage}`);
      assert.match(r.errorMessage, pattern, scenario);
      assert.equal(r.evidence.environment.reap.ok, true, `${scenario}: reaped`);
    }
    // A model outside the reviewer's allowlist never reaches the CLI. M09: it is refused even earlier — by the run plan, so the gate
    // records the blocked run and no adapter (nor any environment copy) is involved; the adapter's own allowlist stays as a second line.
    setState(t, {});
    const calls = () => t.wslLog().filter((e) => e.bwrap?.program?.[0] === CLAUDE_IN_SANDBOX && e.bwrap.program[1] === "-p").length;
    const n = calls();
    await assert.rejects(startRun(t, project, g(), { model: "gpt-5-codex" }), (e) => e.category === "gate" && e.details.checks.some((c) => c.id === "run_plan" && /nu e permis pentru Claude/.test(c.detail)));
    const blocked = hub.runs.listRuns({ limit: 1 })[0];
    assert.deepEqual([blocked.status, blocked.preInference], ["blocked", true]);
    assert.equal(calls(), n, "no reviewer process for a refused model");
    // And the reviewer adapter itself refuses an empty model (never the CLI's account default).
    const direct = await hub.providers["claude@wsl-runner"].startTurn({ runId: "run_m09_empty", cwd: dir, prompt: "x", access: "read-only", model: "", onEvent: () => {} }).done;
    assert.deepEqual([direct.status, direct.errorCategory, direct.preInference], ["failed", "policy", true]);
    assert.match(direct.error, /doar cu un model explicit/);
    assert.equal(calls(), n);
  } finally { await t.cleanup(); }
});

test("M07-PL-09 (reap race) a Stop during a turn in the environment: the interrupt reap and the post-turn reap never overlap; the run ends interrupted with its lease released", async () => {
  const t = await envHub({}, { codex: "hang" });
  try {
    const { hub } = t;
    const { project, dir } = await routedFixture(t, "bug-demo");
    const g = grant(t, project, "codex", "workspace-write", 3);
    setState(t, { reapDelayMs: 1500 });
    const run = await startRun(t, project, g, { provider: "codex", access: "workspace-write" });
    await waitFor(() => hub.runs.getRun(run.id).timeline.turn_acknowledged, 60000);
    await hub.runs.interrupt(run.id, "user");
    const done = await settled(hub, run.id, 120000);
    const wsId = run.id.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
    const reaps = t.wslLog().filter((e) => e.reap === `/home/runner/ws/hub/${wsId}`);
    assert.equal(done.status, "interrupted");
    assert.equal(done.evidence.environment.reap.ok, true, JSON.stringify({ reap: done.evidence.environment.reap, reaps }));
    assert.equal(done.evidence.environment.reap.remaining, 0);
    assert.ok(reaps.length >= 2, "both the interrupt path and the post-turn path reaped");
    assert.ok(reaps.every((e) => !e.concurrent), `no reaper ran beside another: ${JSON.stringify(reaps)}`);
    assert.equal(hub.leases.current(`workspace:${path.resolve(dir).toLowerCase()}`), null, "the lease is released, not retained");
  } finally { await t.cleanup(); }
});

test("M07-PL-10 a factory mission on the environment route runs every code stage there — writer, checks, review (claude@wsl-runner), QA, preview, E2E — and the delivery bundle says so", async () => {
  const t = await envHub();
  const port = await freePort();
  try {
    const { hub } = t;
    const { project } = await routedFixture(t, "service-request", { port });
    grant(t, project, "codex", "workspace-write");
    grant(t, project, "claude", "read-only");
    const map = hub.factoryRunner.stageMap(project);
    assert.equal(map.realProjectEligible, true, map.blockers.join(" · "));
    assert.deepEqual(map.stages.filter((s) => s.stage !== "lega" && s.boundary !== "environment").map((s) => s.stage), []);
    t.queue("codex", "factory-write:feature-b");
    t.queue("claude", "review:pass");
    const mission = await startMission(t, project, port);
    const v = await untilStage(t, mission.id);
    assert.equal(v.factory.stage, "DELIVERY_READY", `${v.factory.stageReason}\n${JSON.stringify(v.evidence.map((e) => [e.stage, e.status, e.runner]))}`);
    const review = v.runs.find((r) => r.provider === "claude");
    const reviewRun = hub.runs.getRun(review.id || review.runId);
    assert.equal(reviewRun.environment, "wsl-runner", "the reviewer ran in the environment");
    assert.equal(reviewRun.evidence.environment.role, "reviewer");
    const by = (stage) => v.evidence.filter((e) => e.stage === stage && !e.stale);
    assert.equal(by("PREVIEW").at(-1).runner, "bwrap-local-only@wsl-runner");
    assert.equal(by("E2E").at(-1).runner, "playwright@wsl-runner");
    assert.equal(by("E2E").at(-1).status, "PASS");
    assert.equal(by("E2E").at(-1).detail.sandbox.simulated, true);
    assert.ok(by("QA").every((e) => /@wsl-runner/.test(e.runner)));
    const manifest = JSON.parse(hub.db.prepare("SELECT manifest_json FROM factory_bundles WHERE mission_id = ? ORDER BY created_at DESC LIMIT 1").get(mission.id).manifest_json);
    const limits = manifest.limitations.join("\n");
    assert.match(limits, /Preview-ul: au rulat în wsl-runner/);
    assert.match(limits, /E2E \(Chromium\): au rulat în wsl-runner/);
    assert.match(limits, /Review-ul Claude \(run_[^)]+\) a rulat în mediul wsl-runner SIMULAT/);
    assert.doesNotMatch(limits, /au rulat pe Windows|graniță de unealtă|R2 deschis: writer-ul/);
  } finally { await t.cleanup(); }
});

test("M07-PL-11 Pause and Stop during the E2E in the environment abort it: the browser in the namespace closes, no E2E evidence or finding, the preview's workspace is released; a resume runs it again", async () => {
  const t = await envHub({ fakeBrowser: { hang: true } });
  const port = await freePort();
  try {
    const { hub } = t;
    const { project } = await routedFixture(t, "service-request", { port });
    grant(t, project, "codex", "workspace-write");
    grant(t, project, "claude", "read-only");
    const e2eRunning = async (missionId) => {
      await waitFor(() => (browserLog(t).filter((e) => e.launch).length > launchesBefore || !["BASELINE", "IMPLEMENTING", "CHECKING", "REVIEWING", "REPAIRING", "QA", "PREVIEW", "PAUSED"].includes(hub.factory.view(missionId).factory.stage) ? true : null), 240000, 200);
      const v = hub.factory.view(missionId);
      assert.ok(browserLog(t).filter((e) => e.launch).length > launchesBefore, `the E2E did not start: ${v.factory.stage} ${v.factory.stageReason} ${JSON.stringify(v.evidence.map((e) => [e.stage, e.status, e.detail?.reason || e.outputTail?.slice(-200)]))}`);
      return v;
    };
    // Pause during the E2E.
    let launchesBefore = 0;
    t.queue("codex", "factory-write:feature-b");
    t.queue("claude", "review:pass");
    const first = await startMission(t, project, port);
    await e2eRunning(first.id);
    const closedBefore = browserLog(t).filter((e) => e.closed).length;
    const paused = await dispatch(hub, "factory.pause", { missionId: first.id }, "ui").catch((e) => { throw new Error(`pause: ${e.message}`); });
    assert.equal((paused.factory || paused).stage ?? hub.factory.view(first.id).factory.stage, "PAUSED");
    await waitFor(() => browserLog(t).filter((e) => e.closed).length > closedBefore, 15000);
    await hub.factory.idle(first.id);
    let v = hub.factory.view(first.id);
    assert.equal(v.factory.stage, "PAUSED");
    assert.ok(!v.evidence.some((e) => e.stage === "E2E"), "no E2E evidence from an interrupted run");
    assert.ok(!v.findings.some((f) => f.area === "e2e"));
    await waitFor(() => hub.wslRunner.listWorkspaces().filter((w) => w.purpose === "preview").every((w) => w.status === "released"), 20000).catch((e) => { throw new Error(`${e.message}: ${JSON.stringify(hub.wslRunner.listWorkspaces().map((w) => [w.id, w.purpose, w.status, w.stats]))} ${JSON.stringify(t.wslLog().filter((x) => x.reap || x.release || x.script === "env:release").slice(-8))} ${JSON.stringify(hub.supervisor.list())}`); });
    // Resume: QA, preview and E2E again (no model step), then Stop during that E2E.
    launchesBefore = browserLog(t).filter((e) => e.launch).length;
    await hub.factory.resume(first.id, { actor: "test" });
    const second = first;
    await e2eRunning(second.id);
    const closed2 = browserLog(t).filter((e) => e.closed).length;
    const t0 = Date.now();
    const stopped = await dispatch(hub, "factory.stop", { missionId: second.id }, "ui");
    const final = stopped.factory.stage === "CANCELLED" ? stopped : await untilStage(t, second.id, ["CANCELLED"], 30000);
    assert.equal(final.factory.stage, "CANCELLED");
    assert.ok(Date.now() - t0 < 30000, "the Stop is confirmed within the bound");
    await waitFor(() => browserLog(t).filter((e) => e.closed).length > closed2, 15000);
    v = hub.factory.view(second.id);
    assert.ok(!v.evidence.some((e) => e.stage === "E2E"));
    assert.ok(!v.findings.some((f) => f.area === "e2e"));
    await waitFor(() => hub.wslRunner.listWorkspaces().filter((w) => w.purpose === "preview").every((w) => w.status === "released"), 20000);
    assert.ok(!hub.supervisor.list().some((p) => p.key.startsWith("factory-preview-")), "no preview host left");
  } finally { await t.cleanup(); }
});

test("M07-PL-13 checks whose tests need a socket: refused by codex sandbox, re-run on a fresh copy in the attested local-only profile (C18); without C18 they stay BLOCKED", async () => {
  const t = await envHub();
  try {
    const { project, dir } = await routedFixture(t, "service-request", { name: "sock" });
    t.wslState({ ...JSON.parse(fs.readFileSync(t.wslFiles.state, "utf8")), sandboxSocketRefusal: true });
    const r = await t.hub.factoryRunner.run({ key: "m07-sock-1", ws: dir, command: "node --test test/unit.test.mjs", project });
    assert.equal(r.runner, "bwrap-local-only@wsl-runner", JSON.stringify(r).slice(0, 400));
    assert.match(r.fallbackFrom, /codex-sandbox@wsl-runner: socket refuzat/);
    assert.ok(["PASS", "FAIL"].includes(r.status), r.status);
    assert.match(r.isolation, /doar loopback/);
    const bw = t.wslLog().filter((e) => e.bwrap).at(-1).bwrap;
    assert.ok(bw.flags.includes("--unshare-all") && !bw.flags.includes("--share-net"), "own network namespace, loopback only");
    assert.ok(!bw.flags.some((f) => /\/pw\/|\/opt\/claude|ifrim-reviewer/.test(f)), "no browser or reviewer binds for a test command");
    assert.ok(t.hub.wslRunner.listWorkspaces().filter((w) => w.purpose === "runner").every((w) => w.status === "released"), "both copies released");
  } finally { await t.cleanup(); }
  // Without the local-only attestation the M05 behaviour stays: BLOCKED, never a code failure, never Windows.
  const u = await envHub({ noC18: true });
  try {
    const { project, dir } = await routedFixture(u, "service-request", { name: "sock2" });
    u.wslState({ ...JSON.parse(fs.readFileSync(u.wslFiles.state, "utf8")), sandboxSocketRefusal: true });
    const r = await u.hub.factoryRunner.run({ key: "m07-sock-2", ws: dir, command: "node --test test/unit.test.mjs", project });
    assert.equal(r.status, "BLOCKED");
    assert.match(r.reason, /socket/);
    assert.match(r.reason, /doar-local nu e disponibil/);
  } finally { await u.cleanup(); }
});
