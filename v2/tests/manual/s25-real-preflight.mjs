// Called ONLY by the explicit real driver. Importing this module performs no inspection or process launch.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { resolveCodexBinary, windowsCodexLauncher, CODEX_APP_SERVER_OVERRIDES } from "../../server/providers/codex.mjs";
import { windowsClaudeLauncher, claudeTurnLaunch, CLAUDE_FORBIDDEN_FLAGS } from "../../server/providers/claude.mjs";
import { codexDeniedEntries, denyListFingerprint, codexIsolationArgs } from "../../server/policy/isolation.mjs";
import { commandArgv, RUNNER_TIMEOUT_MS } from "../../server/factory/runner.mjs";
import { assembleTestFile, baselineGate } from "../../server/factory/test-first.mjs";
import { classifyDenyEntries, snapshotAcls, predictHomeAclChanges, requireHomeApproval, aclDiff,
  MAIN_HUB, LIVE_DATA, LIVE_FINGERPRINT, within, digest, codexHeadroom, validIso, exactOrGlob } from "./s25-parity-safety.mjs";

export function binaryIdentity(config) {
  const b = resolveCodexBinary(config);
  if (!b || b.prefixArgs.length) throw new Error("P2 requires a directly resolved Codex executable");
  const version = execFileSync(b.executable, ["--version"], { encoding: "utf8", windowsHide: true, timeout: 20000 }).trim();
  return { ...b, version, sha256: digest(fs.readFileSync(b.executable)),
    selection: process.env.HUB_CODEX_BIN ? "HUB_CODEX_BIN" : process.env.CODEX_CLI_PATH ? "environment CODEX_CLI_PATH" : /CODEX_CLI_PATH/.test(b.source || "") ? "registry CODEX_CLI_PATH" : "default" };
}

export function recipes({ config, homeDir, projectDir, mcpServerNames = [] }) {
  const host = windowsClaudeLauncher({ config, homeDir }), binary = host.resolve();
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
  };
  if (Object.values(assertions).some((v) => !v)) throw new Error("Launch recipe invariant failed");
  return { claudeTurnLaunch: { executable: author.executable, args: author.args, outputTokens: author.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS },
    appServer: { executable: reviewer.executable, args: reviewer.args, approvalsReviewer: "user (recipe; wire response recorded separately)" }, runner, assertions };
}

export function layoutIsolation({ hub, parent, homeDir, hubRoot, evidence }) {
  const live = codexDeniedEntries({ homeDir, hubRoot: MAIN_HUB, extra: [path.join(LIVE_DATA, "private"), path.join(LIVE_DATA, "backups", "v2")] });
  if (denyListFingerprint(live) !== LIVE_FINGERPRINT) throw new Error("P4 live home-consent list no longer matches 0b85ddbd40f8b446");
  const liveConsented = live.filter((p) => within(homeDir, p) && !within(MAIN_HUB, p) && !within(LIVE_DATA, p));
  const isolation = hub.codexIsolation();
  // The caller supplies the exact Hub list; independently applied list is checked in the driver using the real config.
  evidence.denyList = { ...isolation, liveConsented, classification: classifyDenyEntries(isolation.paths, { parent, liveConsented }) };
  if (evidence.denyList.classification.some((p) => p.classification === "other")) throw new Error("P4 deny entry outside dedicated/consented paths");
  if (isolation.paths.some((p) => within(p, path.join(parent, "booking")) || within(p, path.join(parent, "evidence")))) throw new Error("Project or evidence is under a denied path");
  const sentinels = [String.raw`C:\Users\mihai\hub-rc`, String.raw`C:\Users\mihai\hub-rc\.ifrim`, String.raw`C:\Users\mihai\hub-rc\.ifrim\tmp`,
    String.raw`C:\Users\mihai\hub-rc2`, String.raw`C:\Users\mihai\hub-rc2\.ifrim`, String.raw`C:\Users\mihai\hub-rc2\.ifrim\tmp`,
    MAIN_HUB, path.join(MAIN_HUB, ".ifrim", "BACKUPS"), homeDir, process.env.TEMP, parent, hubRoot, path.join(parent, "booking"), path.join(parent, "evidence")];
  const targets = [...isolation.paths, ...sentinels].filter(Boolean);
  evidence.aclBefore = snapshotAcls(targets);
  const unreadable = evidence.aclBefore.filter((r) => r.error);
  if (unreadable.length) throw new Error(`P5 ACL metadata refused: ${unreadable.map((r) => r.error).join("\n")}`);
  evidence.aclPrediction = predictHomeAclChanges(evidence.aclBefore.filter((r) => liveConsented.some((p) => exactOrGlob(p, r.path))), { parent });
  return { targets, allowed: [{ path: parent, recursive: true }, ...liveConsented] };
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
  });\n`;
  return { name, text: assembleTestFile({ body, needs: ["node:fs", "node:http", "node:sqlite"], harness: 2 }).text };
}

export async function runnerPreflight({ h, parent, project, evidence, acl, homeAclChangeApproved }) {
  requireHomeApproval(evidence.aclPrediction, homeAclChangeApproved);
  evidence.homeAclChangeApproved = { at: homeAclChangeApproved,
    source: "coordinator supplied explicit flag; owner approval 2026-10-15T10:52:29Z",
    message: "cmsg_01K9QSg2gnYKPNAzVSK811dNRJodqXTBP6rk51mLQTH4vg",
    scope: [path.join(h.homeDir, ".claude"), path.join(h.homeDir, ".openclaw")] };
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
  evidence.aclAfterPreflight = snapshotAcls(acl.targets);
  evidence.aclPreflightDiff = aclDiff(evidence.aclBefore, evidence.aclAfterPreflight, acl);
  evidence.homeAclReport = evidence.aclAfterPreflight.filter((r) => /[\\/]\.(claude|openclaw)$/.test(r.path));
  if (evidence.aclAfterPreflight.some((r) => r.error)) throw new Error("P8 ACL snapshot refused");
  if (!evidence.aclPreflightDiff.ok) throw new Error("P8 ACL changed outside allowed paths");
  if (result.status !== "PASS" || evidence.P7.gate !== null) throw new Error(`P7 real runner refused: ${result.reason}; ${result.outputTail}`);
  // The scratch test must not alter the mission's later project snapshot.
  fs.unlinkSync(target);
}
