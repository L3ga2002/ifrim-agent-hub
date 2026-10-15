import { killSingleAuthorFixture } from "./manual/s25-rehearsal-support.mjs";
import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { classifyDenyEntries, aclDiff, checkLayout, exportManifest, verifyManifest, predictHomeAclChanges, requireHomeApproval, codexHeadroom, parseAclSnapshot, snapshotAcls, STOP } from "./manual/s25-parity-safety.mjs";
import { recipes, runnerPreflightSource, layoutIsolation, runnerPreflight, assertLivePrivateProtection, assertHeadroom } from "./manual/s25-real-preflight.mjs";
import { LIVE_PRIVATE_PATHS } from "./manual/s25-parity-safety.mjs";
import { trackSupervisedProcess, recordedProcessTree, windowsProcesses } from "./manual/s25-isolated-rehearsal.mjs";
import { parseTapCases } from "../server/factory/test-first.mjs";
import { runRehearsal, classifyRehearsal, observeAdapter, calibrationGate, rehearsalGate, rehearsalAuthority, assertRealPreloadAbsent, wireRehearsalRuntime } from "./manual/s25-rehearsal-core.mjs";
import { registerCleanupGuard } from "./helpers.mjs";
registerCleanupGuard();
const roots = [];
const testBase = path.resolve(".ifrim/tmp/r-parity-round2");
fs.mkdirSync(testBase, { recursive: true });
const root = () => { const dir = fs.mkdtempSync(path.join(testBase, "run-")); roots.push(dir); return dir; };
after(() => { for (const dir of roots) { assert.equal(path.dirname(dir), testBase); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }); } });
const layout = (parent) => ({ parent, hubRoot: `${parent}/hub`, projectDir: `${parent}/booking`, out: `${parent}/evidence`, homeDir: "C:/Users/test",
  env: { LOCALAPPDATA: "C:/Users/test/AppData/Local", TEMP: "C:/Temp" } });

test("P4 exact home allowlist and dedicated descendants, case and separators", () => {
  assert.deepEqual(classifyDenyEntries(["C:/x/hub/.env.*", "C:\\Users\\test\\.claude", "C:/Users/test/.claude/extra", "C:/xyz", "C:/x/../other"],
    { parent: "c:/x", liveConsented: ["c:/users/test/.claude"] }).map((p) => p.classification), ["dedicated", "home-consented", "other", "other", "other"]);
});
test("P1 rejects development clones, OneDrive, temp, localappdata, ancestors and alias layout", () => {
  for (const parent of ["C:/Users/mihai/hub-rc", "C:/Users/mihai/hub-rc2/run", "C:/Users/test/OneDrive/run", "C:/Temp/run", "C:/Users/test/AppData/Local/run", "C:/Users", "C:/"])
    assert.throws(() => checkLayout(layout(parent)), /Forbidden/);
  assert.ok(checkLayout(layout("C:/isolated/run")));
  assert.throws(() => checkLayout({ ...layout("C:/isolated/run"), hubRoot: "C:/elsewhere/hub" }), /requires/);
  assert.throws(() => checkLayout({ ...layout("C:/isolated/run"), realpath: (p) => p.replace("isolated", "Temp") }), /Forbidden|junction/);
});
test("P1 manifest is commit-bound, content-sensitive, excludes only node_modules and refuses mismatch", () => {
  const dir = root();
  fs.writeFileSync(path.join(dir, "one.txt"), "one");
  const a = exportManifest(dir, "a".repeat(40));
  assert.equal(verifyManifest(a, a.sha256).verified, true);
  assert.throws(() => verifyManifest(a), /mismatch/);
  fs.writeFileSync(path.join(dir, "one.txt"), "two");
  assert.throws(() => verifyManifest(exportManifest(dir, "a".repeat(40)), a.sha256), /mismatch/);
  assert.notEqual(exportManifest(dir, "b".repeat(40)).sha256, a.sha256);
});
test("P8 ACL diff catches additions, deletions, missing targets and exact home scope", () => {
  const before = [{ path: "C:/outside", exists: true, aces: ["A:(R)"] }, { path: "C:/run/hub", exists: true, aces: [] }];
  const after = [{ path: "C:/outside", exists: true, aces: ["A:(DENY)(R)"] }, { path: "C:/run/hub", exists: true, aces: ["B:(RX)"] }];
  const diff = aclDiff(before, after, { allowed: [{ path: "C:/run", recursive: true }] });
  assert.equal(diff.ok, false); assert.deepEqual(diff.violations.map((x) => x.path), ["C:/outside"]);
  assert.equal(aclDiff(before, [], { allowed: [] }).ok, false);
  assert.equal(aclDiff(before, [...before].reverse(), { allowed: [] }).ok, true);
  assert.equal(aclDiff([], [{ path: "C:/home/.claude/other", aces: [] }], { allowed: ["C:/home/.claude"] }).ok, false);
});
test("P5 prediction preserves exact ALLOW removal and requires explicit approval", () => {
  const predicted = predictHomeAclChanges([{ path: "C:/Users/test/.claude", exists: true, aces: ["HOST\\CodexSandboxUsers:(OI)(CI)(RX)"] }], { parent: "C:/run" });
  assert.equal(predicted.length, 1); assert.equal(predicted[0].changes.length, 3);
  assert.match(predicted[0].undo[1], /\/grant/);
  assert.throws(() => requireHomeApproval(predicted), /before P7|Before P7/);
  assert.doesNotThrow(() => requireHomeApproval(predicted, "2026-10-15T10:52:29Z"));
});
test("P12 quota exhaustion, unknown allowance and credits fail closed", () => {
  const probe = { usage: { windows: [{ usedPercent: 2 }], limitReached: false, creditsReported: { hasCredits: false, unlimited: false } } };
  assert.equal(codexHeadroom(probe), true);
  for (const change of [{ windows: [] }, { windows: [{ usedPercent: 100 }] }, { limitReached: true }, { ordinaryUsageAllowed: false }, { creditsReported: { hasCredits: true, balance: 2 } }])
    assert.equal(codexHeadroom({ usage: { ...probe.usage, ...change } }), false);
  for (const balance of [null, undefined, "", " ", NaN, true, false, "unknown", 2]) {
    const bad = { usage: { ...probe.usage, creditsReported: { hasCredits: true, unlimited: false, balance } } };
    assert.equal(codexHeadroom(bad), false);
    assert.throws(() => assertHeadroom({ codex: { probe: bad } }, "2026-10-15T10:52:29Z"), /P12/);
  }
  for (const balance of [0, "0"]) assert.equal(codexHeadroom({ usage: { ...probe.usage, creditsReported: { hasCredits: true, unlimited: false, balance } } }), true);
});
test("review guard refuses non-read-only before constructing adapter; forwarding preserves production handle", async () => {
  const e = { writerGuardHits: [], adapterTurns: [], declinedApprovals: [] };
  let calls = 0;
  const adapter = observeAdapter(() => { calls++; return { startTurn: () => ({ key: "one", done: Promise.resolve({ status: "completed" }) }) }; }, { provider: "codex", evidence: e });
  assert.equal((await adapter.startTurn({ access: "workspace-write", runId: "x" }).done).preInference, true);
  assert.equal(calls, 0); assert.equal(classifyRehearsal(e), "DEFECT_WRITER_REACHED");
  assert.equal((await adapter.startTurn({ access: "read-only", runId: "y" }).done).status, "completed"); assert.equal(calls, 1);
});

test("real wiring merges the shared supervisor and assigns guarded adapters and the production runner", async () => {
  const dir = root(), evidence = { writerGuardHits: [], adapterTurns: [], declinedApprovals: [] };
  const supervisor = {}, codex = {}, claude = {}, oldRun = () => assert.fail("old runner reached"), factoryRunner = { run: oldRun };
  const config = { testMode: false, providerBinaries: { codex: { executable: process.execPath, prefixArgs: [] }, claude: { executable: process.execPath, prefixArgs: [] } },
    dataDir: dir, backupDir: path.join(dir, "backups") };
  const h = { homeDir: dir, hub: { supervisor, providers: { codex, claude }, factoryRunner,
    settings: { get: () => null }, providerState: new Map(), codexIsolation: () => ({ fingerprint: "fake" }) } };
  wireRehearsalRuntime({ h, config, evidence, ready: () => false, onEvent: () => {} });
  assert.equal(h.hub.supervisor, supervisor); assert.equal(h.hub.providers.codex, codex); assert.equal(h.hub.providers.claude, claude);
  assert.equal(h.hub.factoryRunner, factoryRunner); assert.notEqual(factoryRunner.run, oldRun);
  assert.equal(typeof factoryRunner.stop, "function"); assert.equal(factoryRunner.readiness().route, "windows");
  const refusal = await codex.startTurn({ access: "workspace-write", runId: "forbidden" }).done;
  assert.match(refusal.error, /DEFECT_WRITER_REACHED/); assert.equal(refusal.preInference, true);
  assert.equal(classifyRehearsal(evidence), "DEFECT_WRITER_REACHED");
  assert.match((await codex.startTurn({ access: "read-only", runId: "before-preflight" }).done).error, /preflight/);
  assert.equal(evidence.adapterTurns.length, 0);
  assert.equal((await factoryRunner.run({ command: "NOT_ALLOWED" })).status, "BLOCKED");
  const record = supervisor.start({ key: "fixture", executable: process.execPath, args: ["-e", ""], cwd: dir });
  assert.equal(supervisor.get("fixture"), record); assert.equal(supervisor.list()[0].pid, record.pid);
  await record.exit;
  assert.deepEqual((await supervisor.close()).survivors, []);
});

for (const scenario of ["success", "amend", "exhausted", "hang", "rate-overage", "review-write", "deny-other", "acl-outside", "preflight-only"]) {
  test(`R-PARITY fake ${scenario}`, { timeout: 180000 }, async () => {
    const parent = root();
    let e;
    try { e = await runRehearsal({ mode: "fake", parent, scenario: scenario === "preflight-only" ? "success" : scenario, preflightOnly: scenario === "preflight-only", calibrate: false, fakeSeams: ["hang", "rate-overage"].includes(scenario) ? { supervisor: { treeKill: killSingleAuthorFixture } } : {} }); }
    catch (error) { if (!["deny-other", "acl-outside"].includes(scenario)) throw error; e = error.evidence; }
    assert.equal(e.hubClosed, true);
    assert.equal(fs.existsSync(e.isolation.dataDir), false);
    assert.equal(e.wiring.supervisorTestMode, false);
    assert.equal(e.wiring.sharedSupervisor, true);
    assert.ok(e.killOutcomes.some((r) => r.kind === "supervisor.close"));
    assert.ok(e.pidChecks.every((p) => p.gone));
    assert.equal(e.runs?.filter((r) => r.access === "workspace-write").length || 0, 0);
    assert.equal(e.dispatches?.filter((d) => ["IMPLEMENTING", "REPAIRING"].includes(d.stage)).length || 0, 0);
    if (["deny-other", "acl-outside"].includes(scenario)) {
      assert.equal(e.classification, "TECHNICAL_STOP"); assert.equal(e.adapterTurns.length, 0); return;
    }
    assert.equal(e.admin.mode, "BUILD_SAFE"); assert.equal(e.spec.authorLimits.turnTimeoutMin, 45);
    assert.equal(e.outcome.limits.maxAttemptsPerStage, 1); assert.equal(e.outcome.limits.maxDurationMin, 180);
    assert.equal(Date.parse(e.deadline_at) - Date.parse(e.outcome.startedAt), 180 * 60000);
    assert.equal(e.envelope.expiresAt, e.expiresAt);
    assert.equal(e.budget, 5);
    assert.deepEqual(e.grants.map((g) => [g.provider, g.access, g.maxAttempts, g.maxDurationS]).sort(), [["claude", "read-only", 5, 7200], ["codex", "workspace-write", 5, 7200]]);
    for (const g of e.grants) { assert.ok(g.binding.bindingHash && g.binding.missionId); assert.ok(Date.parse(g.expiresAt) <= Date.parse(e.expiresAt)); }
    assert.ok(e.grantExpiryParity.rows.every((r) => r.deltaMs >= 0 && r.deltaMs <= 60000));
    assert.equal(e.preflight.negativeWorkspaceWrite.allowed, false);
    if (["success", "amend"].includes(scenario)) {
      assert.equal(e.classification, "INTENTIONAL_STOP_BEFORE_WRITER", JSON.stringify({ outcome: e.outcome, baseline: e.baselineGate, reviews: e.testReviews }));
      assert.equal(e.writerStarted, false); assert.equal(e.boundaryHits.length, 1); assert.equal(e.outcome.stageReason, STOP);
      assert.equal(e.baselineGate.length, 1); assert.equal(e.baselineGate[0].result, null); assert.equal(e.baselineGate[0].current, true);
      assert.equal(e.authoring.status, "PROTECTED");
      assert.deepEqual(e.dispatches.map((d) => [d.stage, JSON.parse(d.request_json).cycle, d.status]),
        (scenario === "amend" ? [0, 1] : [0]).flatMap((cycle) => [["TEST_AUTHORING", cycle, "DONE"], ["TEST_REVIEW", cycle, "DONE"]]));
      for (const turn of e.adapterTurns.filter((r) => r.provider === "claude")) assert.equal(turn.maxOutputTokens, 64000);
      const threads = e.stream.filter((r) => r.thread).map((r) => r.thread);
      assert.equal(threads.length, scenario === "amend" ? 2 : 1);
      for (const thread of threads) {
        assert.equal(thread.approvalsReviewer, "user"); assert.equal(thread.model, "gpt-6.1-sol");
        assert.equal(thread.reasoningEffort, "medium"); assert.equal(thread.sandbox.type, "readOnly");
        assert.equal(thread.nativeSessionId, thread.id);
      }
      assert.ok(e.launchAssertions.some((r) => r.assertions.rwProfile && r.assertions.dedicatedWorkspace));
      assert.ok(e.launchAssertions.some((r) => r.assertions.livePrivateReadDenied));
      assert.ok(e.runnerResults.every((r) => r.result.runner === "codex-sandbox"));
      if (scenario === "amend") { assert.equal(e.reviewThreadReuse, true); assert.equal(e.candidates.length, 2); }
    } else if (scenario === "exhausted") {
      assert.equal(e.classification, "STEP0_STOPPED"); assert.equal(e.boundaryHits.length, 0);
      assert.deepEqual(e.testReviews.map((r) => r.verdict), ["CHANGES_REQUESTED", "CHANGES_REQUESTED"]);
    } else if (scenario === "hang") { assert.equal(e.classification, "TECHNICAL_STOP"); assert.equal(e.runs[0].error_category, "turn_timeout"); }
    else if (scenario === "rate-overage") { assert.equal(e.classification, "TECHNICAL_STOP"); assert.equal(e.adapterTurns.length, 1); assert.equal(e.boundaryHits.length, 0); assert.ok(e.terminalTechnical); }
    else if (scenario === "review-write") { assert.equal(e.classification, "DEFECT_WRITER_REACHED"); assert.equal(e.writerGuardHits.length, 1); }
    else { assert.equal(e.classification, "PREFLIGHT_ONLY_PASSED"); assert.equal(e.adapterTurns.length, 0); assert.equal(e.dispatches.length, 0); }
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(e.out, "evidence.json"), "utf8")), e);
  });
}

test("ACL metadata preserves account spaces, individual glob identities and exact scope", () => {
  const target = "C:\\fictive\\.env.*";
  const raw = "C:\\fictive\\.env.one NT AUTHORITY\\SYSTEM:(I)(F)\r\n                     HOST\\CodexSandboxUsers:(DENY)(R)\r\nC:\\fictive\\.env.two BUILTIN\\Users:(R)\r\nSuccessfully processed 2 files; Failed processing 0 files";
  const rows = parseAclSnapshot(raw, target);
  assert.equal(rows.length, 2); assert.equal(rows[0].aces[0], "NT AUTHORITY\\SYSTEM:(I)(F)");
  assert.equal(rows[1].aces.length, 1);
  assert.equal(parseAclSnapshot(raw.replaceAll("fictive", "fictive with spaces"), target.replace("fictive", "fictive with spaces"))[0].path, "C:\\fictive with spaces\\.env.one");
  assert.equal(aclDiff([], rows, { allowed: [target] }).ok, true);
  assert.equal(aclDiff([], [{ path: "C:/fictive/.env.two/child", aces: [] }], { allowed: [target] }).ok, false);
  assert.equal(snapshotAcls([target], { execute: () => raw }).length, 2);
  const error = Object.assign(new Error("Access denied"), { stderr: "exact refusal" });
  assert.match(snapshotAcls(["C:/fictive"], { execute: () => { throw error; } })[0].error, /exact refusal/);
  assert.throws(() => requireHomeApproval([], undefined), /explicit/);
});

test("launch recipes use production ro reviewer, rw runner and author-only 64000 without executing a CLI", () => {
  const config = { providerBinaries: { claude: { executable: process.execPath, prefixArgs: [] }, codex: { executable: process.execPath, prefixArgs: [] } }, dataDir: "C:/dedicated/hub/.ifrim/tmp", backupDir: "C:/dedicated/hub/.ifrim/BACKUPS" };
  const r = recipes({ config, homeDir: "C:/fictive-home", projectDir: "C:/dedicated/booking", mcpServerNames: ["synthetic"] });
  assert.ok(Object.values(r.assertions).every(Boolean));
  assert.equal(r.runner.timeoutMs, 180000);
  assert.ok(r.appServer.args.includes("app-server")); assert.ok(r.appServer.args.includes("mcp_servers.synthetic.enabled=false"));
});

test("P7 scratch runs real loopback, SQLite and header cleanup; DENY is explicitly simulated", () => {
  const dir = root(), { text } = runnerPreflightSource("FICTIVE-CANARY");
  const source = text.replace('fs.readFileSync("FICTIVE-CANARY")', '(() => { throw Object.assign(new Error("SIMULATED DENY"), { code: "EACCES" }); })()');
  assert.notEqual(text, source);
  fs.writeFileSync(path.join(dir, "shape.mjs"), source);
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, ["--test", "--test-reporter=tap", "shape.mjs"], { cwd: dir, env, encoding: "utf8", timeout: 20000, windowsHide: true });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const tap = parseTapCases(r.stdout.split(/\r?\n/));
  assert.equal(tap.cases.length, 1); assert.equal(tap.cases[0].cleanup.ok, true); assert.equal(tap.fileCleanup.ok, true);
});

test("classification requires matching VALID review, current FAIL baseline, one boundary and no writer evidence", () => {
  const e = { writerStarted: false, authoring: { status: "PROTECTED", candidate: { sha: "a" }, proof: { verdict: "PROVEN", signature: "p" } },
    testReviews: [{ verdict: "PASS", status: "VALID", change_set_sha: "a" }], baselineGate: [{ result: null, status: "FAIL", signature: "p", current: true }],
    outcome: { stage: "NEEDS_OWNER_DECISION", stageReason: STOP }, boundaryHits: [{}] };
  assert.equal(classifyRehearsal(e), "INTENTIONAL_STOP_BEFORE_WRITER");
  for (const delta of [{ testReviews: [{ verdict: "PASS", status: "INVALID", change_set_sha: "a" }] }, { boundaryHits: [{}, {}] }, { baselineGate: [] }, { baselineGate: [{ ...e.baselineGate[0], current: false }] }])
    assert.equal(classifyRehearsal({ ...e, ...delta }), "BASELINE_REFUSED");
  assert.equal(classifyRehearsal({ ...e, runs: [{ access: "workspace-write" }] }), "DEFECT_WRITER_REACHED");
});

test("P4 real layout decision rejects an outside entry before any ACL snapshot or runner", () => {
  const evidence = {};
  assert.throws(() => layoutIsolation({ hub: { codexIsolation: () => ({ paths: ["C:/not-consented/private"] }) },
    parent: "C:/dedicated", homeDir: "C:/Users/mihai", hubRoot: "C:/dedicated/hub", evidence,
    snapshot: () => assert.fail("P4 must stop before P5/P7") }), /P4 deny entry/);
  assert.equal(evidence.denyList.classification[0].classification, "other");
});

test("P8 real runner preflight decision rejects an outside ACL diff after the injected runner", async () => {
  const parent = root(), project = { path: path.join(parent, "booking") };
  const evidence = { aclPrediction: [], aclBefore: [{ path: "C:/outside", exists: true, aces: ["A:(R)"] }] };
  let runs = 0, snapshots = 0;
  const h = { homeDir: "C:/Users/mihai", hub: { factoryRunner: { run: async (options) => {
    runs++; assert.equal(options.key, "s25-preflight"); assert.equal(options.timeoutMs, 180000);
    return { status: "PASS", counts: {} };
  } } } };
  await assert.rejects(runnerPreflight({ h, parent, project, evidence, homeAclChangeApproved: "2026-10-15T10:52:29Z",
    acl: { targets: ["C:/outside"], allowed: [{ path: parent, recursive: true }] }, snapshot: () => {
      snapshots++; return [{ path: "C:/outside", exists: true, aces: ["A:(DENY)(R)"] }];
    } }), /P8 ACL changed outside/);
  assert.equal(runs, 1); assert.equal(snapshots, 1); assert.equal(evidence.aclPreflightDiff.violations.length, 1);
});

test("P5 live private data requires existing DENY ACEs and records separate non-mutating Claude/Codex protection", () => {
  const rows = LIVE_PRIVATE_PATHS.map((p) => ({ path: p, exists: true,
    aces: ["HOST\\CodexSandboxUsers:(DENY)(R)", "HOST\\CodexSandboxUsers:(OI)(CI)(IO)(DENY)(R,GR)"] }));
  const evidence = {};
  assertLivePrivateProtection(rows, evidence);
  assert.equal(evidence.livePrivateProtection.claudeRules.length, 4);
  assert.ok(evidence.livePrivateProtection.codex.every((p) => p.protected && !p.profileMutation));
  for (const after of [rows.slice(1), rows.map((r) => ({ ...r, aces: ["HOST\\CodexSandboxUsers:(OI)(CI)(RX)"] }))])
    assert.throws(() => assertLivePrivateProtection(after, {}), /before any model/);
});

test("P10 one bounded snapshot, no owner queries; short-lived roots, conhost and unrelated sandbox PIDs", async () => {
  const at = (n) => new Date(1790000000000 + n).toISOString();
  const records = [{ pid: 10, root: true, startRequestedAt: at(0), startedAt: at(10), exitedAt: at(25) },
    { pid: 20, root: true, startRequestedAt: at(0), startedAt: at(10), exitedAt: at(5) }];
  const rows = [
    { pid: 11, parentPid: 10, creationDate: at(15), name: "conhost.exe" },
    { pid: 12, parentPid: 11, creationDate: at(20), name: "node.exe" },
    { pid: 99, parentPid: 1, creationDate: at(15), name: "codex.exe", owner: "CodexSandboxUnrelated" },
  ];
  let calls = 0;
  const snapshot = await windowsProcesses({ execute: async (file, args, options) => {
    calls++; assert.equal(file, "powershell.exe"); assert.doesNotMatch(args.at(-1), /GetOwner|Invoke-CimMethod/);
    assert.equal((args.at(-1).match(/Get-CimInstance/g) || []).length, 1); assert.equal(options.timeout, 10000);
    return { stdout: JSON.stringify(rows) };
  } });
  assert.equal(calls, 1); assert.deepEqual(recordedProcessTree(records, snapshot).map((r) => r.pid), [11, 12]);
  assert.equal(records.some((r) => r.pid === 99), false);
});

test("launch records use shared supervisor identities without executing an identity query", async () => {
  const at = "2026-10-15T00:00:00.000Z", records = [];
  const record = { pid: 10, key: "short-lived", startRequestedAt: at, startedAt: at, exit: Promise.resolve() };
  const row = trackSupervisedProcess(records, record, at);
  assert.equal(row.supervisorRecord, record);
  recordedProcessTree(records, [{ pid: 10, parentPid: 1, creationDate: at }]);
  assert.equal(record.creationDate, at); assert.equal(row.creationDate, at);
  await record.exit; assert.ok(row.exitedAt);
  assert.equal(JSON.parse(JSON.stringify(row)).supervisorRecord, undefined);
  const missed = trackSupervisedProcess(records, { ...record, pid: 11, creationDate: undefined }, at);
  await Promise.resolve(); assert.ok(missed.exitedAt); assert.equal(missed.creationDate, null);
});

test("authority delegates GRANT and INTERRUPTED accounting after a terminal technical stop", () => {
  const calls = [], evidence = { terminalTechnical: { result: { reason: "transport" } }, boundaryHits: [] };
  const authority = rehearsalAuthority({ missionId: "m", evidence, getFailure: () => null, gateBeforeDispatch: () => assert.fail("no new model"),
    delegate: (mid, step) => { calls.push([mid, step.stage]); return { allowed: true }; } });
  for (const stage of ["GRANT", "INTERRUPTED"]) assert.deepEqual(authority("m", { stage }), { allowed: true });
  for (const stage of ["TEST_AUTHORING", "TEST_REVIEW", "IMPLEMENTING", "REPAIRING"]) assert.match(authority("m", { stage }).reason, /TECHNICAL_STOP/);
  assert.deepEqual(calls, [["m", "GRANT"], ["m", "INTERRUPTED"]]); assert.equal(evidence.boundaryHits.length, 0);
});

const passingCalibration = () => {
  const rejection = (name) => ({ name, verdict: "ASSERTION_REJECTION", errors: [{ errorClass: "ERR_ASSERTION" }] });
  return { ok: false, proof: { verdict: "PROVEN" }, originalRuns: [rejection("original"), rejection("original")],
    matrix: [{ name: "CORRECT", verdict: "PASS" }, ...Array.from({ length: 41 }, (_, i) => rejection(`v${i}`))],
    correctionProbes: { defects: [{ verdict: "PASS" }], preconditions: [{ verdict: "PRECONDITION_NOT_DEMONSTRATED" }] } };
};
test("calibration gate is final PASS candidate only; 41 assertion rejections, corrections reported separately", () => {
  const calibration = passingCalibration();
  assert.equal(calibrationGate(calibration), true);
  const e = { classification: "INTENTIONAL_STOP_BEFORE_WRITER", authoring: { candidate: { sha: "final", cycle: 1 } }, candidates: [
    { sha: "rejected", cycle: 0, calibration: { ok: false }, noValidCheckLost: true },
    { sha: "final", cycle: 1, calibration, noValidCheckLost: true } ] };
  assert.equal(rehearsalGate(e), true);
  for (const delta of [{ matrix: calibration.matrix.slice(1) }, { matrix: calibration.matrix.slice(0, 41) },
    { originalRuns: calibration.originalRuns.slice(0, 1) }, { proof: { verdict: "INCONCLUSIVE" } }])
    assert.equal(calibrationGate({ ...calibration, ...delta }), false);
  calibration.matrix[1].errors[0].errorClass = "TypeError";
  assert.equal(rehearsalGate(e), false);
});

test("candidate timeout preserves second production proof and exactly one R-AMEND", { timeout: 180000 }, async () => {
  let proofs = 0;
  const e = await runRehearsal({ parent: root(), calibrate: false, fakeSeams: { runner: (run) => async (options) => {
    const result = await run(options);
    if (options.key.includes("TEST_PROVING") && proofs++ < 2) return { ...result, status: "FAIL", reason: "timeout", counts: {}, cases: [], outputTail: "", exitCode: null };
    return result;
  } } });
  assert.equal(e.classification, "INTENTIONAL_STOP_BEFORE_WRITER"); assert.equal(e.terminalTechnical, undefined);
  assert.equal(e.runnerResults.filter((r) => r.result.reason === "timeout").length, 2);
  assert.equal(proofs, 4); assert.equal(e.candidates.length, 2);
  assert.deepEqual(e.dispatches.map((r) => [r.stage, JSON.parse(r.request_json).cycle, r.status]),
    [["TEST_AUTHORING", 0, "DONE"], ["TEST_AUTHORING", 1, "DONE"], ["TEST_REVIEW", 1, "DONE"]]);
});

test("calibration exceptions affect rehearsal gate only and TEMP/TMP are restored", { timeout: 180000 }, async () => {
  const prior = { TEMP: process.env.TEMP, TMP: process.env.TMP }, parent = root(); let calls = 0;
  const e = await runRehearsal({ parent, calibrate: true, fakeSeams: { calibrate: async ({ candidate }) => {
    calls++; assert.equal(process.env.TEMP, path.join(parent, "evidence")); assert.equal(process.env.TMP, process.env.TEMP);
    assert.ok(fs.existsSync(candidate)); throw new Error("injected calibration failure");
  } } });
  assert.equal(calls, 1); assert.equal(e.classification, "INTENTIONAL_STOP_BEFORE_WRITER"); assert.equal(e.rehearsalGate, false);
  assert.equal(e.cleanupErrors, undefined); assert.match(e.candidates[0].calibrationError.message, /injected/);
  assert.deepEqual({ TEMP: process.env.TEMP, TMP: process.env.TMP }, prior);
});

test("real calibrator path on fake dataset-reference candidate records native result separately", { timeout: 900000 }, async () => {
  const prior = { TEMP: process.env.TEMP, TMP: process.env.TMP };
  const e = await runRehearsal({ parent: root(), calibrate: true });
  const c = e.candidates[0];
  assert.equal(e.classification, "INTENTIONAL_STOP_BEFORE_WRITER");
  assert.ok(c.calibration && typeof c.calibration === "object", JSON.stringify(c.calibrationError));
  assert.ok(fs.existsSync(path.join(e.out, `${c.file}.calibration.json`)));
  assert.deepEqual(c.correctionProbes, c.calibration.correctionProbes);
  assert.equal(e.rehearsalGate, calibrationGate(c.calibration));
  assert.deepEqual({ TEMP: process.env.TEMP, TMP: process.env.TMP }, prior);
  // Keep the native OS limitation visible even when this orchestration test passes.
  const summary = { classification: e.classification, rehearsalGate: e.rehearsalGate, calibration: c.calibration };
  fs.writeFileSync(path.join(testBase, "native-calibration.json"), JSON.stringify(summary, null, 2));
});

test("technical runner route failure terminates before a second proof or rewrite", { timeout: 180000 }, async () => {
  let calls = 0;
  const e = await runRehearsal({ parent: root(), calibrate: false, fakeSeams: { runner: (run) => async (options) => {
    const result = await run(options); calls++;
    return { ...result, status: "BLOCKED", reason: "injected route unavailable" };
  } } });
  assert.equal(calls, 1); assert.equal(e.classification, "TECHNICAL_STOP"); assert.ok(e.terminalTechnical);
  assert.equal(e.adapterTurns.length, 1); assert.equal(e.boundaryHits.length, 0);
});

test("plain node crash and rejection run the driver's exit emergency handler without a test harness", () => {
  const url = new URL("./manual/s25-rehearsal-core.mjs", import.meta.url).href;
  for (const crash of ['setImmediate(() => { throw new Error("test crash"); });', 'Promise.reject(new Error("test rejection"));']) {
    const source = `import { installEmergencyCleanup } from ${JSON.stringify(url)};
      installEmergencyCleanup([], { kill: () => { process.stdout.write("EXIT_EMERGENCY_CALLED\\n"); return []; } }); ${crash}`;
    const env = { ...process.env }; delete env.NODE_TEST_CONTEXT; delete env.NODE_OPTIONS;
    const r = spawnSync(process.execPath, ["--input-type=module", "-e", source], { env, encoding: "utf8", windowsHide: true, timeout: 15000 });
    assert.equal(r.status, 1, r.stderr); assert.match(r.stdout, /EXIT_EMERGENCY_CALLED/); assert.doesNotMatch(r.stdout, /tests 0/);
  }
});

test("real mode refuses the test guard preload before layout, probes or models", async () => {
  assert.ok(globalThis[Symbol.for("s25.fake.gitGuard")], "run this suite with --import ./v2/tests/manual/s25-test-guard.mjs");
  assert.throws(assertRealPreloadAbsent, /refuses s25-test-guard/);
});
