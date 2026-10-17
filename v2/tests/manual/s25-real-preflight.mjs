// Called ONLY by the explicit real driver. Importing this module performs no inspection or process launch.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { resolveCodexBinary, windowsCodexLauncher, CODEX_APP_SERVER_OVERRIDES } from "../../server/providers/codex.mjs";
import { windowsClaudeLauncher, claudeTurnLaunch, CLAUDE_FORBIDDEN_FLAGS } from "../../server/providers/claude.mjs";
import { codexDeniedEntries, denyListFingerprint, codexIsolationArgs, claudeAbsolute } from "../../server/policy/isolation.mjs";
import { commandArgv, RUNNER_TIMEOUT_MS } from "../../server/factory/runner.mjs";
import { assembleTestFile, baselineGate } from "../../server/factory/test-first.mjs";
import { classifyDenyEntries, snapshotAcls, predictHomeAclChanges, requireHomeApproval, aclDiff,
  MAIN_HUB, LIVE_DATA, LIVE_FINGERPRINT, HOME_ACL_APPROVAL_MESSAGE, within, digest, codexHeadroom, validIso, exactOrGlob, ancestorPaths, pathKey } from "./s25-parity-safety.mjs";
import { boundedStep } from "./s25-rehearsal-cleanup.mjs";

// Coordinator-supplied live pointer facts (SPEC C / confirmed R3); no live config or credential reads.
// Same mapping as resolveDataLocation(pointer): private and backups/v2, never the data root.
export function consentedLivePaths(homeDir = String.raw`C:\Users\mihai`) {
  const location = { source: "coordinator live data-location pointer facts", dataRoot: LIVE_DATA,
    dataDir: path.join(LIVE_DATA, "private"), backupDir: path.join(LIVE_DATA, "backups", "v2") };
  const live = codexDeniedEntries({ homeDir, hubRoot: MAIN_HUB, extra: [location.dataDir, location.backupDir] });
  if (denyListFingerprint(live) !== LIVE_FINGERPRINT) throw new Error("P4 live home-consent list no longer matches 0b85ddbd40f8b446");
  const privatePaths = live.filter((p) => within(path.join(MAIN_HUB, ".ifrim"), p) || within(location.dataRoot, p));
  return { live, privatePaths, location };
}

// Read rules only: this wrapper never changes the filesystem or Codex ACL profiles.
export const liveClaudeDenyRules = () => [...consentedLivePaths().privatePaths, LIVE_DATA].map((p) => `Read(${claudeAbsolute(p)}/**)`);
export function rehearsalClaudeLauncher(options) {
  const host = windowsClaudeLauncher(options);
  return { ...host, deniedReads: (cwd) => [...new Set([...host.deniedReads(cwd), ...liveClaudeDenyRules()])] };
}
export function assertDenyClassification(entries, options, evidence) {
  const classification = classifyDenyEntries(entries, options);
  evidence.denyList = { ...evidence.denyList, classification };
  if (classification.some((p) => p.classification === "other")) throw new Error("P4 deny entry outside dedicated/consented paths");
  return classification;
}
export function assertAclDiff(before, after, acl, evidence) {
  evidence.aclAfterPreflight = after;
  evidence.aclPreflightDiff = aclDiff(before, after, acl);
  const ancestors = recordAncestorChanges(evidence.aclPreflightDiff, evidence, "preflight");
  if (after.some((r) => r.error)) throw new Error("P8 ACL snapshot refused");
  if (!evidence.aclPreflightDiff.ok || ancestors.changes.length) throw new Error(`P8 ACL changed outside allowed paths${ancestors.changes.length ? `; DEFECT ancestors: ${ancestors.paths.join(", ")}` : ""}`);
  return evidence.aclPreflightDiff;
}
export function recordAncestorChanges(diff, evidence, phase) {
  const ancestors = evidence.aclAncestors?.outsideDedicatedRoot || [];
  const changes = diff.changes.filter((r) => ancestors.some((p) => pathKey(p) === pathKey(r.path)));
  const report = { phase, status: changes.length ? "DEFECT" : "no outside ancestor change observed", paths: changes.map((r) => r.path), changes };
  (evidence.aclAncestorReports ||= []).push(report);
  if (phase === "preflight" && evidence.P7) evidence.P7.ancestorChanges = report;
  if (changes.length) evidence.aclDefect = { kind: "DEFECT_ANCESTOR_ACL_CHANGED", ...report };
  return report;
}
export function assertLivePrivateProtection(rows, evidence, { privatePaths = consentedLivePaths().privatePaths, claudeRules = liveClaudeDenyRules() } = {}) {
  const paths = privatePaths.map((target) => {
    const row = rows.find((r) => exactOrGlob(target, r.path));
    const group = row?.aces?.filter((a) => /(?:\\|^)CodexSandboxUsers:/i.test(a)) || [];
    return { path: target, classification: "live-consented-existing-ACE", profileMutation: false,
      claudeReadDenied: claudeRules.includes(`Read(${claudeAbsolute(target)}/**)`),
      protected: row?.exists === true && !row.error && group.some((a) => /\(DENY\)\(R\)/.test(a))
        && group.some((a) => /\(OI\)\(CI\)\(IO\)\(DENY\)\(R,GR\)/.test(a)) };
  });
  evidence.livePrivateProtection = { claudeRules, codex: paths, source: "existing owner-consented ACE metadata; no ACL mutation" };
  if (paths.some((p) => !p.protected || !p.claudeReadDenied)) throw new Error("P5 live Hub private data protection unverified; stop before any model");
}

export function binaryIdentity(config) {
  const b = resolveCodexBinary(config);
  if (!b || b.prefixArgs.length) throw new Error("P2 requires a directly resolved Codex executable");
  const version = execFileSync(b.executable, ["--version"], { encoding: "utf8", windowsHide: true, timeout: 20000 }).trim();
  return { ...b, version, sha256: digest(fs.readFileSync(b.executable)),
    selection: process.env.HUB_CODEX_BIN ? "HUB_CODEX_BIN" : process.env.CODEX_CLI_PATH ? "environment CODEX_CLI_PATH" : /CODEX_CLI_PATH/.test(b.source || "") ? "registry CODEX_CLI_PATH" : "default" };
}

export function recipes({ config, homeDir, projectDir, mcpServerNames = [] }) {
  const host = rehearsalClaudeLauncher({ config, homeDir }), binary = host.resolve();
  if (!binary) throw new Error("Claude binary missing");
  const spawned = host.spawn({ binary, args: [], cwd: projectDir });
  const input = { binary: { executable: spawned.executable, prefixArgs: spawned.args }, cwd: projectDir,
    deniedReads: host.deniedReads(projectDir), access: "read-only", model: "sonnet", effort: "medium", newSession: true,
    sessionId: "00000000-0000-4000-8000-000000000000", environment: "windows", parentEnv: {}, launcherEnv: spawned.env };
  const author = claudeTurnLaunch({ ...input, maxOutputTokens: 64000 }), nonAuthor = claudeTurnLaunch(input);
  if (mcpServerNames.some((name) => !/^[A-Za-z0-9_-]{1,64}$/.test(name))) throw new Error("Unaddressable MCP name");
  const reviewer = windowsCodexLauncher({ config, homeDir }).spawn({ cwd: projectDir, access: "read-only", base: CODEX_APP_SERVER_OVERRIDES,
    extraArgs: [...mcpServerNames.flatMap((name) => ["-c", `mcp_servers.${name}.enabled=false`]), "-c", 'model_reasoning_effort="medium"'] });
  const runner = { args: ["sandbox", ...codexIsolationArgs("workspace-write", { homeDir, extra: [config.dataDir, config.backupDir] }),
    "-P", "ifrim_hub_rw", "-C", projectDir, "--", ...commandArgv("node --test .ifrim-hub/preflight/shape.mjs")], timeoutMs: RUNNER_TIMEOUT_MS };
  const assertions = {
    readOnlyTools: author.args[author.args.indexOf("--tools") + 1] === "Read,Glob,Grep",
    dontAsk: author.args[author.args.indexOf("--permission-mode") + 1] === "dontAsk",
    noForbiddenFlags: !author.args.some((arg) => CLAUDE_FORBIDDEN_FLAGS.includes(arg)),
    authorOutput64000: author.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS === "64000", nonAuthorOutputAbsent: !nonAuthor.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS,
    reviewerProfile: reviewer.args.includes('default_permissions="ifrim_hub_ro"'), runnerProfile: runner.args.includes('default_permissions="ifrim_hub_rw"'),
    livePrivateReadDenied: liveClaudeDenyRules().every((rule) => author.args.includes(rule)),
  };
  if (Object.values(assertions).some((v) => !v)) throw new Error("Launch recipe invariant failed");
  return { claudeTurnLaunch: { executable: author.executable, args: author.args, outputTokens: author.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS },
    appServer: { executable: reviewer.executable, args: reviewer.args, approvalsReviewer: "user (recipe; wire response recorded separately)" }, runner, assertions };
}

export function layoutIsolation({ hub, parent, dedicatedRoot, homeDir, hubRoot, evidence, snapshot = snapshotAcls }) {
  const { live, privatePaths, location } = consentedLivePaths(homeDir);
  const liveConsented = live.filter((p) => within(homeDir, p) && !within(MAIN_HUB, p) && !within(LIVE_DATA, p));
  const isolation = hub.codexIsolation();
  // The caller supplies the exact Hub list; independently applied list is checked in the driver using the real config.
  evidence.denyList = { ...isolation, liveConsented, livePrivatePaths: privatePaths, liveLocation: location };
  assertDenyClassification(isolation.paths, { parent, liveConsented }, evidence);
  if (isolation.paths.some((p) => within(p, path.join(parent, "booking")) || within(p, path.join(parent, "evidence")))) throw new Error("Project or evidence is under a denied path");
  const sentinels = [String.raw`C:\Users\mihai\hub-rc`, String.raw`C:\Users\mihai\hub-rc\.ifrim`, String.raw`C:\Users\mihai\hub-rc\.ifrim\tmp`,
    String.raw`C:\Users\mihai\hub-rc2`, String.raw`C:\Users\mihai\hub-rc2\.ifrim`, String.raw`C:\Users\mihai\hub-rc2\.ifrim\tmp`,
    MAIN_HUB, path.join(MAIN_HUB, ".ifrim", "BACKUPS"), homeDir, process.env.TEMP, parent, hubRoot, path.join(parent, "booking"), path.join(parent, "evidence")];
  const ancestors = ancestorPaths(parent);
  evidence.aclAncestors = { dedicatedRoot, paths: ancestors, outsideDedicatedRoot: ancestors.filter((p) => !within(dedicatedRoot || parent, p)) };
  const targets = [...isolation.paths, path.join(homeDir, ".codex"), ...sentinels, ...privatePaths, ...ancestors].filter(Boolean);
  evidence.aclBefore = snapshot(targets);
  evidence.aclInspectionLimitations = evidence.aclBefore.filter((r) => r.notInspected || r.status?.includes("not expanded"))
    .map((r) => ({ path: r.path, status: r.status, verification: "UNVERIFIED; no enumeration or child metadata read" }));
  const unreadable = evidence.aclBefore.filter((r) => r.error);
  if (unreadable.length) throw new Error(`P5 ACL metadata refused: ${unreadable.map((r) => r.error).join("\n")}`);
  assertLivePrivateProtection(evidence.aclBefore, evidence, { privatePaths });
  evidence.aclPrediction = predictHomeAclChanges(evidence.aclBefore.filter((r) => liveConsented.some((p) => exactOrGlob(p, r.path))), { parent });
  return { targets, allowed: [{ path: dedicatedRoot || parent, recursive: true }, ...liveConsented] };
}

export function assertHeadroom(probes, checked) {
  if (!codexHeadroom(probes.codex.probe)) throw new Error("P12 Codex allowance unknown/exhausted or credits may be used");
  if (!validIso(checked)) throw new Error("P12 --claude-headroom-checked <ISO> required");
  return { codex: probes.codex.probe.usage, claude: probes.claude.probe.usage || "nedemonstrat: CLI exposes no weekly headroom",
    claudeManual: { source: "coordinator manual check; not provider-verified", checkedAt: checked } };
}

export function runnerPreflightSource(canary) {
  const name = "AC-1: loopback SQLite and deny canary";
  const body = `test(${JSON.stringify(name)}, async () => {
    const db = await setup("stocare", () => new sqlite.DatabaseSync(":memory:"));
    db.exec("CREATE TABLE witness(n INTEGER); INSERT INTO witness VALUES(7)");
    assert.equal(db.prepare("SELECT n FROM witness").get().n, 7);
    const server = await setup("server", async () => {
      const s = http.createServer((req, res) => res.end("seven"));
      await new Promise((resolve, reject) => { s.once("error", reject); s.listen(0, "127.0.0.1", resolve); });
      return s;
    });
    assert.equal(await (await fetch("http://127.0.0.1:" + server.address().port)).text(), "seven");
    assert.throws(() => fs.readFileSync(${JSON.stringify(canary)}), (e) => ["EACCES", "EPERM"].includes(e.code));
    console.log("S25_PREFLIGHT_READY " + process.pid);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  });\n`;
  return { name, text: assembleTestFile({ body, needs: ["node:fs", "node:http", "node:sqlite"], harness: 2 }).text };
}

export async function runnerPreflight({ h, parent, project, evidence, acl, homeAclChangeApproved, snapshot = snapshotAcls, processEvidence = async () => ({ verified: false, reason: "P7 process observation absent" }) }) {
  evidence.homeAclChangeApproved = { at: homeAclChangeApproved ?? null,
    source: "coordinator supplied explicit flag; checked against exact owner approval",
    message: HOME_ACL_APPROVAL_MESSAGE,
    scope: [path.join(h.homeDir, ".claude"), path.join(h.homeDir, ".openclaw")] };
  requireHomeApproval(evidence.aclPrediction, homeAclChangeApproved);
  if (evidence.aclPrediction.some((r) => !evidence.homeAclChangeApproved.scope.some((p) => exactOrGlob(p, r.path))))
    throw new Error("P5 predicted home ACL changes exceed the owner's approved .claude/.openclaw scope");
  const ref = ".ifrim-hub/preflight/shape.mjs", target = path.join(project.path, ref);
  const canary = path.join(parent, "hub", ".ifrim", "tmp", "s25-deny-canary.txt");
  fs.mkdirSync(path.dirname(target), { recursive: true }); fs.mkdirSync(path.dirname(canary), { recursive: true });
  fs.writeFileSync(canary, "FICTIVE S25 DENY CANARY\n", { flag: "wx" });
  const { text, name } = runnerPreflightSource(canary);
  fs.writeFileSync(target, text);
  const startedAt = new Date().toISOString(), t0 = performance.now();
  const result = await h.hub.factoryRunner.run({ key: "s25-preflight", ws: project.path, command: `node --test ${ref}`, timeoutMs: RUNNER_TIMEOUT_MS, project });
  evidence.P7 = { startedAt, durationMs: Math.round(performance.now() - t0), result,
    cleanup: result.fileCleanup, gate: baselineGate(result, { manifest: { cases: [{ name }] }, harness: 2 }) };
  try { evidence.P7.R7 = { ...await boundedStep("R7 observation", processEvidence, 12000), role: "EVIDENCE_ONLY; never a gate" }; }
  catch (error) { evidence.P7.R7 = { verified: false, observed: false, role: "EVIDENCE_ONLY; never a gate", error: error.message }; }
  assertAclDiff(evidence.aclBefore, snapshot(acl.targets), acl, evidence);
  evidence.homeAclReport = evidence.aclAfterPreflight.filter((r) => /[\\/]\.(claude|openclaw)$/.test(r.path));
  if (result.status !== "PASS" || evidence.P7.gate !== null) throw new Error(`P7 real runner refused: ${result.reason}; ${result.outputTail}`);
  // The scratch test must not alter the mission's later project snapshot.
  fs.unlinkSync(target);
}
