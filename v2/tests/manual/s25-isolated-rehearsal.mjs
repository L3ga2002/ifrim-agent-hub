// Isolated Factory rehearsal. Importing this file never starts a provider. Default CLI mode is fake.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { makeTestHub, declareBillingFixture, waitFor, HUB_ROOT, FIXTURES } from "../helpers.mjs";
import { buildEngineeringSpec } from "../../server/owner/planners/engineering.mjs";
import { createClaudeAdapter } from "../../server/providers/claude.mjs";
import { createCodexAdapter, resolveCodexBinary, inspectCodexConfig, CODEX_APP_SERVER_OVERRIDES } from "../../server/providers/codex.mjs";
import { createSupervisor } from "../../server/runtime/supervisor.mjs";
import { classifyText } from "../../server/providers/classify.mjs";
import { AGENT_COMMANDS } from "../../server/runtime/commands.mjs";
import { baselineGate, TEST_FIRST_LIMITS } from "../../server/factory/test-first.mjs";
import { hubProtectedPaths, PROTECTED_HOME_PATHS } from "../../server/policy/isolation.mjs";

const exec = promisify(execFile);
export const S25_WORDS = "Telefonul rămâne obligatoriu și salvat corect, dar lista publică a zilei nu afișează și nu transmite telefonul. Programările valide și fluxurile existente continuă să funcționeze";
const DELEGATION = "aprobarea proprietarului 2026-10-14 10:09 UTC (thread Lipsuri de conținut și proba §25)";
const inside = (root, target) => { const r = path.relative(root, target); return !r || (!r.startsWith("..") && !path.isAbsolute(r)); };
const stamp = () => new Date().toISOString();
const jsonFile = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });

// CreationDate is the process identity: a reused PID is never a survivor or a cleanup target.
export function recordedProcessTree(records, snapshot) {
  const found = [];
  for (const record of records) {
    const row = snapshot.find((p) => p.pid === record.pid && (record.creationDate
      ? p.creationDate === record.creationDate
      : Date.parse(p.creationDate) >= Date.parse(record.startRequestedAt) && Date.parse(p.creationDate) <= Date.parse(record.startedAt)));
    if (row) { record.creationDate = row.creationDate; found.push(row); }
  }
  // Keep recorded ancestors in the chain even when they exited before this snapshot.
  const parents = [...records];
  for (let i = 0; i < parents.length; i++) {
    const record = parents[i];
    const replacement = snapshot.find((p) => p.pid === record.pid && p.creationDate !== record.creationDate);
    const end = record.exitedAt || replacement?.creationDate;
    for (const row of snapshot) {
      if (row.parentPid !== record.pid || found.some((p) => p.pid === row.pid)
        || Date.parse(row.creationDate) < Date.parse(record.creationDate || record.startRequestedAt)
        || (end && Date.parse(row.creationDate) >= Date.parse(end))) continue;
      found.push(row);
      const child = { ...row, root: false, startedAt: row.creationDate };
      records.push(child); parents.push(child);
    }
  }
  return found;
}

async function windowsProcesses() {
  const { stdout } = await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    "@(Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{ pid = $_.ProcessId; parentPid = $_.ParentProcessId; creationDate = $_.CreationDate.ToUniversalTime().ToString('o') } }) | ConvertTo-Json -Compress"],
  { windowsHide: true, timeout: 20000 });
  // Normalize sub-millisecond CIM precision to the JS timestamps recorded before/after spawn.
  return (stdout.trim() ? [].concat(JSON.parse(stdout)) : []).map((row) => ({ ...row, creationDate: new Date(row.creationDate).toISOString() }));
}

// Only an already recorded, still-live identity can be a kill target or survivor.
export function recordedSurvivors(records, snapshot) {
  return snapshot.filter((row) => records.some((record) => !record.exitedAt && record.creationDate
    && record.pid === row.pid && record.creationDate === row.creationDate));
}

export function emergencyKillRecorded(records, { execSync = execFileSync } = {}) {
  for (const record of records) {
    if (record.exitedAt || !record.creationDate || !Number.isSafeInteger(record.pid) || record.pid <= 0) continue;
    try {
      const output = execSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
        `$p = Get-CimInstance Win32_Process -Filter 'ProcessId=${record.pid}'; if ($p) { $p.CreationDate.ToUniversalTime().ToString('o') }`],
      { windowsHide: true, timeout: 10000, encoding: "utf8" });
      const date = String(output).trim();
      if (!date || !recordedSurvivors([record], [{ pid: record.pid, creationDate: new Date(date).toISOString() }]).length) continue;
      execSync("taskkill", ["/PID", String(record.pid), "/T", "/F"], { windowsHide: true, timeout: 10000, stdio: "ignore" });
    } catch { /* Missing/unreadable identity or failed kill: best effort at synchronous exit. */ }
  }
}

export async function cleanupRecordedProcesses(records, { exec: execute = exec, snapshot = windowsProcesses } = {}) {
  const results = [];
  for (const record of records) {
    const current = await snapshot();
    if (!recordedSurvivors([record], current).length) {
      results.push({ pid: record.pid, root: record.root, skipped: "original process absent (CreationDate checked)" });
      continue;
    }
    try {
      await execute("taskkill", ["/PID", String(record.pid), "/T", "/F"], { windowsHide: true, timeout: 10000 });
      results.push({ pid: record.pid, root: record.root, exitCode: 0 });
    } catch (error) { results.push({ pid: record.pid, root: record.root, exitCode: error.code ?? null }); }
  }
  return results;
}

export function createRehearsalStop({ controller, emergencyKill, exit = (code) => process.exit(code) }) {
  let stopping = false;
  return () => {
    if (stopping) {
      try { emergencyKill(); } finally { exit(130); }
      return;
    }
    stopping = true;
    controller.abort(new Error("Stop cerut din terminal"));
  };
}

export function codexReviewArgs({ model, effort, output, mcpServerNames = [] }) {
  if (mcpServerNames.some((name) => !/^[A-Za-z0-9_-]{1,64}$/.test(name))) throw new Error("Nume MCP neadresabil; repetiția se oprește înainte de model");
  return ["exec", "-m", model, "-c", `model_reasoning_effort=${JSON.stringify(effort)}`, "-s", "read-only", "--skip-git-repo-check",
    ...CODEX_APP_SERVER_OVERRIDES, ...mcpServerNames.flatMap((name) => ["-c", `mcp_servers.${name}.enabled=false`]),
    "-c", 'model_provider="openai"', "-c", 'forced_login_method="chatgpt"', "-c", 'approval_policy="never"', "-o", output, "-"];
}

/** Hub app-server probe only (no thread/turn/command); review turns use exec read-only without a Hub profile. */
export function createRehearsalCodex({ config, supervisor, dataDir, homeDir, identitySalt, codexAdapterFactory = createCodexAdapter, onProbe = () => {} }) {
  let adapter;
  const hubAdapter = () => adapter ||= codexAdapterFactory({ config, supervisor, homeDir, identitySalt: () => identitySalt });
  const binary = () => { const b = resolveCodexBinary(config); if (!b) throw new Error("Codex CLI lipsește"); return b; };
  const inspectInstallation = () => hubAdapter().inspectInstallation();
  const probe = async () => {
    const record = { source: "Hub real Codex probe: codex app-server; no thread, no turn, no command execution", startedAt: stamp() };
    try {
      record.probe = await hubAdapter().probe({ withModels: true });
      return record.probe;
    } catch (error) { record.error = error.message; throw error; }
    finally { record.finishedAt = stamp(); onProbe(record); }
  };
  return { id: "codex", environment: "windows", inspectInstallation, probe,
    startTurn({ runId, cwd, prompt, access, model, effort, onEvent }) {
      const key = `run-${runId}`;
      const fail = (errorCategory, error) => ({ key, pid: null, interrupt: async () => ({}), done: Promise.resolve({ status: "failed", preInference: true, errorCategory, error, output: "" }) });
      if (access !== "read-only") return fail("policy", "repetiția se oprește înaintea writer-ului");
      const config = inspectCodexConfig(homeDir);
      if (config.unreadable || config.realtime?.riskyKeys?.length) return fail("policy", "Configurația Codex nu poate fi restrânsă pentru repetiție; oprit înainte de model");
      try {
      const b = binary(), output = path.join(dataDir, `${runId}.review.txt`);
      const record = supervisor.start({ key, executable: b.executable, args: [...b.prefixArgs, ...codexReviewArgs({ model, effort, output, mcpServerNames: config.realtime?.mcpServerNames || [] })], cwd, label: "rehearsal Codex read-only review",
        onStderrLine: (text) => onEvent({ type: "notice", level: "info", text }) });
      // Asynchronous like the regular adapter: runtime has installed the active entry before the phase arrives.
      queueMicrotask(() => { if (record.pid) { onEvent({ type: "phase", phase: "turn_sent" }); record.child.stdin.end(prompt); } });
      let interrupted = false;
      return { key, pid: record.pid, interrupt: async () => { interrupted = true; return supervisor.stop(key, { graceMs: 100 }); },
        done: record.exit.then(({ code, error }) => {
          const text = fs.existsSync(output) ? fs.readFileSync(output, "utf8") : "";
          const message = error || record.stderrTail.join("\n");
          return { status: interrupted ? "interrupted" : code === 0 ? "completed" : "failed", output: text,
            ...(code !== 0 && !interrupted ? { errorCategory: classifyText(message), error: message, preInference: !record.pid } : {}) };
        }) };
      } catch (error) { return fail("transport", error.message); }
    } };
}

/** Shared preflight boundary: all provider checks finish before any rehearsal command dispatch. */
export async function probeRehearsalProviders({ providers, providerState, mode, evidence, signal }) {
  signal?.throwIfAborted();
  const cp = await providers.claude.probe(); evidence.probes.claude = { probe: cp };
  signal?.throwIfAborted();
  if (mode === "real" && !(cp.ok && cp.auth?.loggedIn && cp.auth.authMethod === "claude.ai" && cp.auth.apiProvider === "firstParty" && ["pro", "max", "team", "enterprise"].includes(cp.auth.subscriptionType))) throw new Error("Claude subscription precondition failed");
  for (const provider of ["claude", "codex"]) {
    const probe = provider === "claude" ? cp : await providers.codex.probe({ withModels: true });
    evidence.probes[provider] = { ...evidence.probes[provider], probe };
    signal?.throwIfAborted();
    if (mode === "real" && provider === "codex" && (probe.auth?.accountType !== "chatgpt" || typeof probe.auth?.planType !== "string" || !probe.auth.planType.trim())) {
      throw new Error("Codex subscription precondition failed: Hub account/read must report ChatGPT and planType; stopped before any model or dispatch");
    }
    const installation = await providers[provider].inspectInstallation();
    signal?.throwIfAborted();
    evidence.probes[provider].installation = installation;
    providerState.set(provider, { ...probe, installation });
    if (mode === "real" && (!probe.ok || !installation.installed)) throw new Error(`${provider}: precondiția locală a clientului nu este îndeplinită`);
  }
}

/** Every caller must choose a mode; real is implemented for the coordinator and is never used by automated tests. */
export async function runRehearsal({ mode = "fake", out, scenario = "success", fakeTurnMs = 1600, isolationFixture = false, signal, realProcesses = [] } = {}) {
  signal?.throwIfAborted();
  if (!["fake", "real"].includes(mode)) throw new Error("mode must be fake or real");
  if (mode === "real" && scenario !== "success") throw new Error("Failure scenarios are fake-only");
  if (!out) throw new Error("--out is required, outside the repository");
  out = path.resolve(out);
  if (inside(HUB_ROOT, out)) throw new Error("Evidence must be outside the repository");
  fs.mkdirSync(out, { recursive: true });
  if (inside(fs.realpathSync(HUB_ROOT), fs.realpathSync(out))) throw new Error("Evidence resolves inside the repository");
  if (fs.readdirSync(out).length) throw new Error("Evidence directory must be empty");
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "s25-iso-")), projectDir = path.join(parent, "booking");
  const evidence = { schema: "s25-isolated-rehearsal/v1", mode, scenario, startedAt: stamp(), out, projectDir,
    runtime: { node: process.version, executable: process.execPath, platform: process.platform },
    runner: "PASS_SIMULATED: test-mode proof RUNNER executes node --test on the host without a sandbox, as in earlier rehearsals",
    codexRoute: mode === "real" ? "probe: Hub real Codex app-server (no thread/turn/command); TEST_REVIEW: codex exec -s read-only, no Hub permission profile" : "harness fake-codex",
    billingDeclaration: { source: "test:fixture", scope: "throwaway isolated DB only" }, probes: {}, processes: [], pidChecks: [] };
  let h, missionId, timer, supervisor, failure, processTimer, startRequestedAt;
  evidence.realProcessCleanup = { records: realProcesses, scans: [], taskkill: [], survivors: [] };
  let scanPending = null;
  const scanReal = () => {
    if (scanPending) return scanPending;
    scanPending = (async () => {
      const snapshot = await windowsProcesses();
      const found = recordedProcessTree(realProcesses, snapshot);
      evidence.realProcessCleanup.scans.push({ at: stamp(), found });
      return found;
    })().finally(() => { scanPending = null; });
    return scanPending;
  };
  const emergencyKill = () => emergencyKillRecorded(realProcesses);
  if (mode === "real") process.on("exit", emergencyKill);
  const recordProcess = (event) => evidence.processes.push({ ...event, at: stamp() });
  try {
    signal?.throwIfAborted();
    fs.cpSync(path.join(FIXTURES, "r-priv-booking"), projectDir, { recursive: true, filter: (src) => path.basename(src) !== "SOURCE.md" });
    jsonFile(path.join(projectDir, ".ifrim-hub-test.json"), { createdBy: "ifrim-agent-hub", purpose: "live-validation", fixture: "booking-demo", data: "synthetic" });
    signal?.throwIfAborted();
    const identitySalt = crypto.randomBytes(32).toString("hex");
    const providerOverrides = {};
    if (mode === "real") {
      supervisor = createSupervisor({ config: { testMode: false }, onEvent: (event) => {
        recordProcess(event);
        if (event.type === "process.started" && event.pid) {
          realProcesses.push({ pid: event.pid, key: event.key, root: true, startRequestedAt, startedAt: stamp(), exitedAt: null });
          if (process.platform === "win32") scanReal().catch((error) => { evidence.realProcessCleanup.scanError = error.message; });
        } else if (event.type === "process.exited") {
          const record = realProcesses.findLast((r) => r.pid === event.pid && r.key === event.key && !r.exitedAt);
          if (record) record.exitedAt = stamp();
        }
      } });
      const start = supervisor.start;
      supervisor.start = (options) => {
        startRequestedAt = stamp();
        const child = start(options);
        const record = realProcesses.findLast((r) => r.pid === child.pid && r.key === child.key);
        // 'close' can wait on pipes inherited by descendants after the root has already exited.
        child.child.once("exit", () => { if (record) record.exitedAt ||= stamp(); });
        return child;
      };
      if (process.platform === "win32") processTimer = setInterval(() => scanReal().catch((error) => { evidence.realProcessCleanup.scanError = error.message; }), 1000);
      let claude, codex;
      const realConfig = () => ({ ...h.config, testMode: false, providerBinaries: {}, hubRoot: HUB_ROOT, dataDir: h.dataDir });
      const realClaude = () => claude ||= createClaudeAdapter({ config: realConfig(), supervisor, homeDir: os.homedir(), identitySalt: () => identitySalt });
      const realCodex = () => codex ||= createRehearsalCodex({ config: realConfig(), supervisor, dataDir: h.dataDir, homeDir: os.homedir(), identitySalt,
        onProbe: (record) => { evidence.probes.codex = record; } });
      for (const [name, get] of [["claude", realClaude], ["codex", realCodex]]) providerOverrides[name] = Object.fromEntries(["probe", "inspectInstallation", "startTurn"].map((key) => [key, (...args) => get()[key](...args)]));
    }
    // "amend" (fake only): the reviewer asks for changes at cycle 0, the single R-AMEND rewrite runs and the second review passes — the
    // deterministic proof that the step-0 grants admit cycle 0, the rewrite and both Codex reviews before any real model.
    const passing = scenario === "success" || scenario === "amend";
    const failureBinary = mode === "fake" && !passing ? { executable: process.execPath, prefixArgs: [path.join(FIXTURES, "fake-turn.mjs"), `--turn-scenario=${scenario}`] } : null;
    signal?.throwIfAborted();
    h = await makeTestHub({ queues: true, configOverrides: { projectsRoot: parent, ...(failureBinary ? { providerBinaries: {
      claude: failureBinary, codex: { executable: process.execPath, prefixArgs: [path.join(FIXTURES, "fake-codex.mjs"), `--models-file=${path.join(parent, "models.json")}`] } } } : {}) }, hubOptions: { providerOverrides } });
    h.hub.scheduler.stop(); // no listener is ever opened; only the explicit Factory tick below runs.
    signal?.throwIfAborted();
    evidence.runnerResults = [];
    const runProof = h.hub.factoryRunner.run;
    h.hub.factoryRunner.run = async (options) => {
      const result = await runProof(options);
      evidence.runnerResults.push({ key: options.key, command: options.command, result });
      return result;
    };
    h.hub.live.subscribe((event) => { if (event.type?.startsWith("supervisor.")) recordProcess(event.data); });
    evidence.isolation = { dataDir: h.dataDir, scheduler: "off; factory.tick every 15 seconds", listener: false, turnTimeScale: 1 };
    const denied = [...hubProtectedPaths({ hubRoot: HUB_ROOT, extra: [h.dataDir, h.config.backupDir] }), ...[".codex", ...PROTECTED_HOME_PATHS].map((p) => path.join(os.homedir(), p))];
    if (denied.some((p) => inside(p, projectDir))) throw new Error("Rehearsal project overlaps an author's denied path");
    if (mode === "fake") {
      const models = [{ id: "gpt-6.1-sol", model: "gpt-6.1-sol", isDefault: true, efforts: ["medium"] }];
      jsonFile(`${h.logs.codex}.models.json`, models); jsonFile(path.join(parent, "models.json"), models);
      const scale = passing ? 1 : fakeTurnMs / (45 * 60000);
      h.hub.factory.setTurnTimeScaleForTests(scale); evidence.isolation.turnTimeScale = scale;
    }
    // Claude is checked first; a wrong account stops before the other provider or any mission work.
    await probeRehearsalProviders({ providers: h.hub.providers, providerState: h.hub.providerState, mode, evidence, signal });
    if (mode === "fake" && scenario === "amend") { h.queue("claude", "author:dataset-reference", "author:dataset-reference"); h.queue("codex", "test-review:dataset-two", "test-review:pass"); }
    else if (mode === "fake") { h.queue("claude", "author:dataset-reference"); h.queue("codex", "test-review:pass"); }
    signal?.throwIfAborted();
    if (mode === "real") {
      if (!isolationFixture) throw new Error("Ruta codex exec nu verifică profilul Hub cerut de poartă; folosește explicit --isolation-fixture pentru admitere simulată în această repetiție sau oprește aici");
      // The probe remains honest. Only the throwaway DB's admission facts use a labelled fixture; no production policy is changed.
      const sandbox = { readiness: "ready", profiles: [{ id: "ifrim_hub_ro", allowed: true }, { id: "ifrim_hub_rw", allowed: true }],
        source: "test:fixture; simulated Hub isolation admission, NOT a verified profile or ACL consent" };
      const state = h.hub.providerState.get("codex"); h.hub.providerState.set("codex", { ...state, sandbox });
      evidence.isolation.admissionFixture = sandbox;
    }
    h.hub.bus.transaction(() => {
      h.hub.settings.set("mode", "LIVE_VALIDATION", "test");
      h.hub.settings.set("executionGate", { status: "open", reason: "isolated rehearsal", changedAt: stamp(), changedBy: "test" }, "test");
      h.hub.settings.set("isolationConsent", { codex: { confirmedAt: stamp(), fingerprint: h.hub.codexIsolation().fingerprint, source: "test:fixture" } }, "test");
    });
    declareBillingFixture(h.hub);
    signal?.throwIfAborted();
    evidence.isolation.gateFixtures = {
      mode: { source: "test:fixture", value: h.hub.settings.get("mode") },
      executionGate: { source: "test:fixture", ...h.hub.settings.get("executionGate") },
      isolationConsent: { source: "test:fixture", fingerprint: h.hub.settings.get("isolationConsent").codex.fingerprint },
      billingDeclaration: { source: "test:fixture" },
    };
    const channel = ["factory.start", "approval.decide"].every((c) => AGENT_COMMANDS.has(c)) ? "agent" : "test";
    evidence.approval = { channel, delegation: DELEGATION };
    const dispatch = (type, payload) => h.hub.commands.dispatch({ type, payload, channel, actor: channel === "agent" ? "agent" : "test", delegation: DELEGATION });
    const project = (await dispatch("project.register_test", { path: projectDir, name: "Repetiție izolată §25" })).result;
    signal?.throwIfAborted();
    // Step 0 budget as a confirmed plan would derive it: one author turn and one test review per cycle (cycle 0 + the single R-AMEND rewrite);
    // maxAttemptsPerStage 1 still forbids any repeat of a cycle. A 1-attempt grant refused the reviewer-requested rewrite at live_grant (2026-10-14).
    const stepZeroTurns = 1 + TEST_FIRST_LIMITS.reauthorMax;
    evidence.grants = { claude: stepZeroTurns, codex: stepZeroTurns, basis: "cycle 0 + reauthorMax rewrite, read-only" };
    h.hub.bus.transaction(() => { for (const provider of ["claude", "codex"]) h.hub.grants.create({ provider, projectId: project.id, access: "read-only", maxAttempts: stepZeroTurns, maxDurationS: 7200, ttlMinutes: 240 }, "test"); });
    evidence.preflight = Object.fromEntries(["claude", "codex"].map((provider) => [provider, h.hub.gate.evaluate({ provider, projectId: project.id, access: "read-only" })]));
    if (Object.values(evidence.preflight).some((decision) => !decision.allowed)) throw new Error("Poarta refuză precondițiile repetiției; nimic nu a ajuns la model");
    const built = buildEngineeringSpec({ text: S25_WORDS, project });
    if (built.problems.length || !built.input.spec.dataset || built.input.spec.authoring?.authorLimits?.turnTimeoutMin !== 45) throw new Error("§25 dataset/author limit missing");
    const limits = { writerModel: "gpt-6.1-sol", writerEffort: "medium", reviewerModel: "sonnet", reviewerEffort: "medium", maxAttemptsPerStage: 1 };
    const prepared = (await dispatch("factory.prepare", { projectId: project.id, ...built.input, limits })).result;
    missionId = prepared.mission.id;
    signal?.throwIfAborted();
    const view = () => h.hub.factory.view(missionId);
    evidence.spec = { sha256: view().spec.sha256, dataset: built.input.spec.dataset, authorLimits: built.input.spec.authoring.authorLimits };
    const requested = await dispatch("factory.start", view().scope);
    signal?.throwIfAborted();
    await dispatch("approval.decide", { approvalId: requested.approval.id, decision: "approved", displayedHash: requested.approval.payloadHash, note: DELEGATION });
    signal?.throwIfAborted();
    await h.hub.commands.executeApproved(requested.command.id, channel === "agent" ? "agent" : "user", { channel, delegation: DELEGATION });
    timer = setInterval(() => h.hub.factory.tick().catch((error) => { evidence.tickError = error.message; }), 15000);
    await waitFor(() => { signal?.throwIfAborted(); return ["BLOCKED", "NEEDS_OWNER_DECISION", "PAUSED", "CANCELLED"].includes(view().factory.stage); }, mode === "fake" ? 120000 : 185 * 60000, 100);
    await h.hub.factory.idle(missionId);
    evidence.outcome = view().factory;
    evidence.authoring = JSON.parse(h.hub.db.prepare("SELECT protected_json FROM factory_specs WHERE mission_id = ? ORDER BY version DESC LIMIT 1").get(missionId).protected_json).authoring;
    const findings = h.hub.db.prepare("SELECT * FROM factory_findings WHERE mission_id = ? AND source = 'test_review' ORDER BY code").all(missionId);
    evidence.testReviews = h.hub.db.prepare("SELECT * FROM factory_reviews WHERE mission_id = ? AND json_extract(validation_json, '$.kind') = 'acceptance_test' ORDER BY created_at").all(missionId)
      .map((row) => ({ ...row, parsed: { verdict: row.verdict, summary: row.summary, ...JSON.parse(row.validation_json), findings: findings.filter((f) => f.review_id === row.id) } }));
    evidence.proofs = view().evidence;
    evidence.baselineGate = evidence.runnerResults.filter((e) => e.key.includes("-BASELINE-")).map((e) => ({ key: e.key, result: baselineGate(e.result, { manifest: evidence.authoring?.candidate?.manifest, harness: evidence.authoring?.candidate?.harness ?? 2 }) }));
    const candidate = evidence.authoring?.candidate;
    if (candidate) {
      for (const ref of [built.input.spec.authoring.testRef, built.input.spec.authoring.stagingRef]) if (fs.existsSync(path.join(projectDir, ref))) { fs.copyFileSync(path.join(projectDir, ref), path.join(out, "candidate.test.mjs"), fs.constants.COPYFILE_EXCL); break; }
      jsonFile(path.join(out, "manifest.json"), candidate.manifest);
      jsonFile(path.join(out, "lint.json"), candidate.lint);
      jsonFile(path.join(out, "proof.json"), evidence.authoring.proof || candidate.proof || null);
      jsonFile(path.join(out, "review.json"), evidence.testReviews);
    }
  } catch (error) { failure = error; evidence.error = { message: error.message, stack: error.stack }; }
  finally {
    clearInterval(timer);
    clearInterval(processTimer);
    // Scan before stopping roots so descendants remain attributable even after their parent exits.
    if (mode === "real" && process.platform === "win32") {
      try {
        await scanReal();
        evidence.realProcessCleanup.taskkill.push(...await cleanupRecordedProcesses(realProcesses, { snapshot: async () => {
          const current = await windowsProcesses();
          recordedProcessTree(realProcesses, current);
          return current;
        } }));
      } catch (error) { failure ||= error; evidence.realProcessCleanup.error = error.message; }
    }
    if (h) {
      const cleanup = async (name, fn) => {
        try { return await fn(); } catch (error) { failure ||= error; (evidence.cleanupErrors ||= []).push({ step: name, message: error.message }); }
      };
      if (missionId) await cleanup("factory.stop", () => h.hub.factory.stop(missionId, { actor: "agent", reason: "Sfârșitul repetiției izolate" }));
      if (supervisor) evidence.realSupervisorStop = await cleanup("real supervisor.stopAll", () => supervisor.stopAll());
      await cleanup("test supervisor.stopAll", () => h.hub.supervisor.stopAll());
      try {
        await waitFor(() => h.hub.runs.activeRuns().length === 0, 20000);
        if (missionId) {
          await h.hub.factory.idle(missionId);
          evidence.finalMission = h.hub.factory.view(missionId).factory;
          evidence.dispatches = h.hub.db.prepare("SELECT * FROM factory_dispatches WHERE mission_id = ? ORDER BY created_at").all(missionId);
          evidence.runs = h.hub.db.prepare("SELECT r.* FROM agent_runs r JOIN tasks t ON r.task_id = t.id WHERE t.mission_id = ? ORDER BY r.created_at").all(missionId);
          const ids = new Set(evidence.runs.map((r) => r.id));
          evidence.events = h.hub.db.prepare("SELECT * FROM events ORDER BY seq").all().filter((e) => e.scope_id === missionId || e.mission_id === missionId || ids.has(e.run_id));
        }
        for (const pid of new Set(evidence.processes.filter((p) => p.type === "process.started").map((p) => p.pid).filter(Boolean))) {
          let gone = false;
          try { process.kill(pid, 0); } catch (error) { gone = error.code === "ESRCH"; }
          evidence.pidChecks.push({ pid, gone, startedAt: evidence.processes.find((p) => p.type === "process.started" && p.pid === pid)?.at || null, checkedAt: stamp() });
        }
        if (process.platform === "win32" && evidence.pidChecks.length) {
          const snapshot = await windowsProcesses();
          evidence.win32Survivors = snapshot.filter((row) => evidence.pidChecks.some((p) => p.pid === row.pid && Date.parse(row.creationDate) <= Date.parse(p.startedAt)));
          for (const check of evidence.pidChecks) {
            const row = snapshot.find((p) => p.pid === check.pid);
            check.creationDate = row?.creationDate || null;
            check.pidReused = Boolean(row && Date.parse(row.creationDate) > Date.parse(check.startedAt));
            check.gone = !row || check.pidReused;
          }
          if (evidence.win32Survivors.length) throw new Error("A recorded process still exists in Win32_Process (CreationDate checked)");
        }
        if (evidence.pidChecks.some((p) => !p.gone)) throw new Error("A rehearsal child is still alive");
      } catch (error) { failure ||= error; evidence.cleanupError = error.message; }
      await cleanup("hub.close", async () => { await h.hub.close(); evidence.hubClosed = true; });
    } else if (supervisor) await supervisor.stopAll();
    if (mode === "real" && process.platform === "win32") {
      try {
        evidence.realProcessCleanup.survivors = recordedSurvivors(realProcesses, await scanReal());
        if (evidence.realProcessCleanup.survivors.length) throw new Error("A recorded real process or descendant survived cleanup (CreationDate checked)");
        evidence.realProcessCleanup.verified = true;
      } catch (error) { failure ||= error; evidence.realProcessCleanup.error = error.message; }
    }
    if (mode === "real" && evidence.realProcessCleanup.verified) process.removeListener("exit", emergencyKill);
    evidence.finishedAt = stamp();
    jsonFile(path.join(out, "evidence.json"), evidence);
    // Keep the isolated data/project paths in evidence for review; never remove an owner path.
  }
  if (failure) throw Object.assign(failure, { evidence });
  return JSON.parse(JSON.stringify(evidence));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), value = (key) => args[args.indexOf(key) + 1];
  if (args.includes("--real") && args.includes("--fake")) throw new Error("Choose one mode");
  const mode = args.includes("--real") ? "real" : "fake";
  const controller = new AbortController();
  const realProcesses = [];
  const emergencyKill = () => emergencyKillRecorded(realProcesses);
  const stop = createRehearsalStop({ controller, emergencyKill });
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
  process.on("SIGBREAK", stop); process.on("SIGHUP", stop);
  try {
    await runRehearsal({ mode, out: args.includes("--out") ? value("--out") : undefined, scenario: args.includes("--scenario") ? value("--scenario") : "success",
      isolationFixture: args.includes("--isolation-fixture"), signal: controller.signal, realProcesses });
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
  finally { for (const name of ["SIGINT", "SIGTERM", "SIGBREAK", "SIGHUP"]) process.removeListener(name, stop); }
}
