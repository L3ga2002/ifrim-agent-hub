import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { classifyDenyEntries, aclDiff, checkLayout, exportManifest, verifyManifest, predictHomeAclChanges, requireHomeApproval, codexHeadroom, parseAclSnapshot, snapshotAcls, STOP } from "./manual/s25-parity-safety.mjs";
import { recipes, runnerPreflightSource } from "./manual/s25-real-preflight.mjs";
import { parseTapCases } from "../server/factory/test-first.mjs";
import { runRehearsal, classifyRehearsal, observeAdapter } from "./manual/s25-rehearsal-core.mjs";
import { registerCleanupGuard } from "./helpers.mjs";
registerCleanupGuard();
const root = () => fs.mkdtempSync(path.join(os.tmpdir(), "r-parity-"));
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
});
test("review guard refuses non-read-only before constructing adapter; forwarding preserves production handle", async () => {
  const e = { writerGuardHits: [], adapterTurns: [], declinedApprovals: [] };
  let calls = 0;
  const adapter = observeAdapter(() => { calls++; return { startTurn: () => ({ key: "one", done: Promise.resolve({ status: "completed" }) }) }; }, { provider: "codex", evidence: e });
  assert.equal((await adapter.startTurn({ access: "workspace-write", runId: "x" }).done).preInference, true);
  assert.equal(calls, 0); assert.equal(classifyRehearsal(e), "DEFECT_WRITER_REACHED");
  assert.equal((await adapter.startTurn({ access: "read-only", runId: "y" }).done).status, "completed"); assert.equal(calls, 1);
});

for (const scenario of ["success", "amend", "exhausted", "hang", "rate-overage", "review-write", "deny-other", "acl-outside", "preflight-only"]) {
  test(`R-PARITY fake ${scenario}`, { timeout: 180000 }, async () => {
    const parent = root();
    let e;
    try { e = await runRehearsal({ mode: "fake", parent, scenario: scenario === "preflight-only" ? "success" : scenario, preflightOnly: scenario === "preflight-only", calibrate: false }); }
    catch (error) { if (!["deny-other", "acl-outside"].includes(scenario)) throw error; e = error.evidence; }
    assert.equal(e.hubClosed, true);
    assert.ok(e.pidChecks.every((p) => p.gone));
    assert.equal(e.runs?.filter((r) => r.access === "workspace-write").length || 0, 0);
    assert.equal(e.dispatches?.filter((d) => ["IMPLEMENTING", "REPAIRING"].includes(d.stage)).length || 0, 0);
    if (["deny-other", "acl-outside"].includes(scenario)) {
      assert.equal(e.classification, "TECHNICAL_STOP"); assert.equal(e.adapterTurns.length, 0); return;
    }
    assert.equal(e.admin.mode, "BUILD_SAFE"); assert.equal(e.spec.authorLimits.turnTimeoutMin, 45);
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
