import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { HUB_ROOT, declareBillingFixture, enrolOwner, waitFor } from "./s25-rehearsal-support.mjs";
import { createClaudeAdapter } from "../../server/providers/claude.mjs";
import { createCodexAdapter } from "../../server/providers/codex.mjs";
import { createSupervisor } from "../../server/runtime/supervisor.mjs";
import { createFactoryRunner } from "../../server/factory/runner.mjs";
import { baselineGate, proofSignature, buildAuthorBrief, lintDatasetBrief, compareInventory, assertionInventory, amendmentViolations } from "../../server/factory/test-first.mjs";
import { resolveRunPlan } from "../../server/policy/run-plan.mjs";
import { compareAtDispatch } from "../../server/policy/model-binding.mjs";
import { codexDeniedEntries, denyListFingerprint, CODEX_ACL_CONSENT_TEXT } from "../../server/policy/isolation.mjs";
import { s25Context } from "./s25-context.mjs";
import { makeRehearsalHub } from "./s25-rehearsal-hub.mjs";
import { calibrateS25 } from "./s25-calibrate.mjs";
import { STOP, CONSENT_PROVENANCE, checkLayout, physicalPath, verifyCommitExport, HOME_ACL_APPROVAL_MESSAGE, within, aclDiff, snapshotAcls, digest } from "./s25-parity-safety.mjs";
import { compareProcessIdentity } from "./s25-process-identity.mjs";
import { binaryIdentity, recipes, layoutIsolation, assertHeadroom, runnerPreflight, rehearsalClaudeLauncher, liveClaudeDenyRules, assertDenyClassification, assertAclDiff, recordAncestorChanges } from "./s25-real-preflight.mjs";
import { trackSupervisedProcess, recordedProcessTree, windowsProcesses, recordedSurvivors, cleanupRecordedProcesses, emergencyKillRecorded, sandboxProcessLimitations, canaryProcessEvidence } from "./s25-isolated-rehearsal.mjs";

import { boundedStep, cleanupSteps } from "./s25-rehearsal-cleanup.mjs";

const stamp = () => new Date().toISOString();
const jsonFile = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
const copy = (value) => JSON.parse(JSON.stringify(value));
export const technicalResult = (result) => result?.status === "BLOCKED" || /timeout|transport|rate.?limit|overage|quota|credit|billing|permission|EACCES|EPERM|access.denied|spawn/i.test(`${result?.errorCategory || ""} ${result?.error || ""} ${result?.reason || ""}`);

// Candidate execution timeouts are FAIL evidence for production proof/amend, not route failures.
export const runnerTechnicalResult = (result) => result?.status === "BLOCKED" ||
  (result?.reason !== "timeout" && technicalResult(result));

export function assertRealPreloadAbsent() {
  if (globalThis[Symbol.for("s25.fake.gitGuard")]) throw new Error("Real mode refuses s25-test-guard preload");
}

export function installEmergencyCleanup(records, { kill = emergencyKillRecorded, report = () => {} } = {}) {
  const emergencyKill = () => { const outcomes = kill(records); report(outcomes); };
  process.on("exit", emergencyKill);
  return () => process.removeListener("exit", emergencyKill);
}

// Both real rehearsals and fake-binary tests call this exact composition function.
export function wireRehearsalRuntime({ h, config, evidence, ready, beforeTurn, onEvent, forceWrite = false, supervisorOptions = {} }) {
  const shared = createSupervisor({ config, onEvent, ...supervisorOptions });
  Object.assign(h.hub.supervisor, shared);
  const salt = crypto.randomBytes(32).toString("hex");
  const author = createClaudeAdapter({ config, supervisor: h.hub.supervisor, homeDir: h.homeDir,
    launcher: rehearsalClaudeLauncher({ config, homeDir: h.homeDir }), identitySalt: () => salt });
  Object.assign(h.hub.providers.claude, observeAdapter(() => author, { provider: "claude", evidence, ready, beforeTurn }));
  Object.assign(h.hub.providers.codex, createRehearsalCodex({ config, supervisor: h.hub.supervisor, homeDir: h.homeDir,
    identitySalt: salt, evidence, ready, beforeTurn, forceWrite }));
  const runner = createFactoryRunner({ config, supervisor: h.hub.supervisor, settings: h.hub.settings,
    providerState: h.hub.providerState, codexIsolation: h.hub.codexIsolation, homeDir: h.homeDir });
  Object.assign(h.hub.factoryRunner, { run: runner.run, readiness: (project) => ({ ...runner.readiness(project), route: "windows" }), stop: runner.stop });
  evidence.wiring = { sharedSupervisor: true, supervisorTestMode: config.testMode, injectedSupervisor: Object.keys(supervisorOptions), runner: "production createFactoryRunner",
    adapter: "production createCodexAdapter", claudeLiveDenyRules: liveClaudeDenyRules() };
}

export function rehearsalAuthority({ missionId, evidence, getFailure, preflightOnly, gateBeforeDispatch, delegate }) {
  return (mid, step) => {
    if (mid === missionId && ["TEST_AUTHORING", "TEST_REVIEW", "IMPLEMENTING", "REPAIRING"].includes(step.stage)
        && (getFailure() || evidence.terminalTechnical)) return { reason: "REHEARSAL_TECHNICAL_STOP" };
    if (mid === missionId && ["IMPLEMENTING", "REPAIRING"].includes(step.stage)) {
      evidence.boundaryHits.push({ at: stamp(), ...step }); return { reason: STOP };
    }
    if (mid === missionId && step.stage === "TEST_AUTHORING") gateBeforeDispatch();
    if (mid === missionId && preflightOnly && ["TEST_AUTHORING", "TEST_REVIEW"].includes(step.stage)) return { reason: "REHEARSAL_PREFLIGHT_ONLY_COMPLETE" };
    return delegate(mid, step);
  };
}

export function calibrationGate(calibration) {
  const correct = calibration?.matrix?.filter((r) => r.name === "CORRECT") || [];
  const variants = calibration?.matrix?.filter((r) => r.name !== "CORRECT") || [];
  const assertion = (r) => r.verdict === "ASSERTION_REJECTION" && r.errors?.length > 0 && r.errors.every((x) => x.errorClass === "ERR_ASSERTION");
  return correct.length === 1 && correct[0].verdict === "PASS" && calibration.proof?.verdict === "PROVEN"
    && calibration.originalRuns?.length === 2 && calibration.originalRuns.every(assertion)
    && variants.length === 41 && new Set(variants.map((r) => r.name)).size === 41 && variants.every(assertion);
}
export function rehearsalGate(e) {
  const final = e.candidates.find((c) => c.sha === e.authoring?.candidate?.sha && c.cycle === e.authoring?.candidate?.cycle);
  return e.classification === "INTENTIONAL_STOP_BEFORE_WRITER" && Boolean(final && calibrationGate(final.calibration))
    && e.candidates.every((c) => c.noValidCheckLost);
}

// The only adapter intervention is observation and a fail-closed read-only boundary BEFORE inference.
export function observeAdapter(getAdapter, { provider, evidence, ready = () => true, forceWrite = false, onProbe = () => {}, beforeTurn = () => {} }) {
  return {
    inspectInstallation: (...args) => getAdapter().inspectInstallation(...args),
    async probe(options = { withModels: true }) {
      const record = { source: `Hub ${provider} probe; no thread, no turn, no command`, startedAt: stamp() };
      try { record.probe = await getAdapter().probe(options); return record.probe; }
      finally { record.finishedAt = stamp(); onProbe(record); }
    },
    startTurn(options) {
      const access = forceWrite ? "workspace-write" : options.access;
      const refuse = (error, category = "policy") => ({ key: `run-${options.runId}`, pid: null, interrupt: async () => ({}),
        done: Promise.resolve({ status: "failed", preInference: true, errorCategory: category, error, output: "" }) });
      if (access !== "read-only") {
        evidence.writerGuardHits.push({ at: stamp(), runId: options.runId, provider, access });
        return refuse("DEFECT_WRITER_REACHED: oprit înaintea writer-ului");
      }
      if (!ready()) return refuse("No-model preflight has not passed");
      beforeTurn(options);
      const record = { at: stamp(), provider, runId: options.runId, access, model: options.model, effort: options.effort,
        requestedThreadId: options.threadId || null, maxOutputTokens: options.maxOutputTokens || null, events: [], result: null };
      evidence.adapterTurns.push(record);
      const handle = getAdapter().startTurn({ ...options, onEvent(event) {
        record.events.push({ at: stamp(), ...event }); options.onEvent?.(event);
      }, requestApproval: async (...args) => {
        const decision = await options.requestApproval(...args);
        evidence.declinedApprovals.push({ runId: options.runId, at: stamp(), decision, source: "production envelope approval path" });
        return decision;
      } });
      return { ...handle, interrupt: async (...args) => {
        const result = await handle.interrupt(...args);
        (evidence.killOutcomes ||= []).push({ at: stamp(), provider, runId: options.runId, kind: "adapter.interrupt", result });
        return result;
      }, done: handle.done.then((result) => {
        record.result = result;
        if (technicalResult(result)) evidence.terminalTechnical = { at: stamp(), provider, runId: options.runId, result };
        return result;
      }) };
    },
  };
}

export function createRehearsalCodex({ config, supervisor, homeDir, identitySalt, codexAdapterFactory = createCodexAdapter,
  evidence = { writerGuardHits: [], adapterTurns: [], declinedApprovals: [] }, onProbe = () => {}, ready, beforeTurn, forceWrite } = {}) {
  let adapter;
  return observeAdapter(() => adapter ||= codexAdapterFactory({ config, supervisor, homeDir, identitySalt: () => identitySalt }),
    { provider: "codex", evidence, onProbe, ready, beforeTurn, forceWrite });
}

export async function probeRehearsalProviders({ providers, providerState, mode, evidence, signal }) {
  for (const provider of ["claude", "codex"]) {
    signal?.throwIfAborted();
    evidence.probes[provider] = { startedAt: stamp() };
    const probe = await providers[provider].probe(provider === "codex" ? { withModels: true } : undefined);
    evidence.probes[provider] = { ...evidence.probes[provider], probe };
    const auth = probe.auth;
    if (mode === "real" && provider === "claude" && !(probe.ok && auth?.loggedIn && auth.authMethod === "claude.ai" && auth.apiProvider === "firstParty" && ["pro", "max", "team", "enterprise"].includes(auth.subscriptionType))) throw new Error("Claude subscription precondition failed");
    if (mode === "real" && provider === "codex" && !(auth?.accountType === "chatgpt" && typeof auth.planType === "string" && auth.planType.trim())) throw new Error("Codex subscription precondition failed: Hub account/read must report ChatGPT and planType; stopped before any model or dispatch");
    const installation = await providers[provider].inspectInstallation();
    evidence.probes[provider].installation = installation;
    evidence.probes[provider].finishedAt = stamp();
    providerState.set(provider, { ...probe, installation });
    signal?.throwIfAborted();
    if (!probe.ok || !installation.installed) throw new Error(`${provider} probe/installation refused`);
    if (mode === "real" && provider === "codex") {
      if (probe.sandbox?.readiness !== "ready" || !["ifrim_hub_ro", "ifrim_hub_rw"].every((id) => probe.sandbox?.profiles?.some((p) => p.id === id && p.allowed))) throw new Error("P3 real sandbox profiles are not ready/allowed");
      if (!Array.isArray(probe.models) || !probe.models.some((m) => (m.model || m.id) === "gpt-6.1-sol" && m.efforts.includes("medium"))) throw new Error("P3 approved Codex model/effort unavailable");
      const rt = probe.config?.realtime;
      if (!rt || rt.riskyKeys?.length || rt.mcpServers !== rt.mcpServerNames?.length) throw new Error("P3 MCP/config inspection incomplete or unsafe");
    }
  }
}

export function classifyRehearsal(e) {
  if (e.writerGuardHits?.length || e.writerStarted || e.dispatches?.some((r) => ["IMPLEMENTING", "REPAIRING"].includes(r.stage)) || e.runs?.some((r) => r.access === "workspace-write")) return "DEFECT_WRITER_REACHED";
  const technical = e.error || e.terminalTechnical || e.cleanupErrors?.length || e.runs?.some((r) => ["turn_timeout", "transport", "rate_limit", "quota", "overage", "billing", "gate"].includes(r.error_category))
    || e.adapterTurns?.some((t) => /rate.?limit|overage|quota|credit|transport/i.test(`${t.result?.errorCategory || ""} ${t.result?.error || ""}`))
    || e.runnerResults?.some((r) => runnerTechnicalResult(r.result))
    || ["BLOCKED", "PAUSED"].includes(e.outcome?.stage) || /Limita de timp|deadline/i.test(e.outcome?.stageReason || "");
  if (technical) return "TECHNICAL_STOP";
  if (e.preflightOnly && e.preflight?.passedAt && !e.adapterTurns?.length && !e.dispatches?.length) return "PREFLIGHT_ONLY_PASSED";
  const a = e.authoring;
  if (a?.status !== "PROTECTED") return "STEP0_STOPPED";
  const validReview = e.testReviews?.some((r) => r.verdict === "PASS" && r.status === "VALID" && r.change_set_sha === a.candidate?.sha);
  if (e.outcome?.stage === "NEEDS_OWNER_DECISION" && e.outcome.stageReason === STOP && e.boundaryHits?.length === 1 && validReview
      && a.proof?.verdict === "PROVEN" && e.baselineGate?.length > 0 && e.baselineGate.every((r) => r.result === null && r.status === "FAIL" && r.signature === a.proof.signature && r.current)
      && e.writerStarted === false) return "INTENTIONAL_STOP_BEFORE_WRITER";
  return "BASELINE_REFUSED";
}

export function reviewResumeEvidence(turns) {
  const reviews = turns.filter((r) => r.provider === "codex");
  const actual = (r) => r.events.filter((v) => v.type === "session" && v.nativeSessionId).at(-1)?.nativeSessionId || null;
  const sessions = reviews.map((r) => ({ runId: r.runId, requestedThreadId: r.requestedThreadId, actualThreadId: actual(r),
    sessionEvents: r.events.filter((v) => v.type === "session"), notices: r.events.filter((v) => v.type === "notice") }));
  return { sessions, reused: reviews.length < 2 ? "not applicable" : Boolean(actual(reviews[0]) && actual(reviews[1]) === actual(reviews[0])) };
}

export async function runRehearsal({ mode = "fake", out, parent, dedicatedRoot, scenario = "success", fakeTurnMs = 8000, commit, manifestSha256,
  isolationConsent, homeAclChangeApproved, claudeHeadroomChecked, signal, realProcesses = [], calibrate = true, preflightOnly = false, fakeSeams = {} } = {}) {
  signal?.throwIfAborted();
  if (!["fake", "real"].includes(mode)) throw new Error("mode must be fake or real");
  if (mode === "real" && (scenario !== "success" || calibrate !== true || Object.keys(fakeSeams).length)) throw new Error("Real mode forbids scenario overrides or skipped calibration");
  if (mode === "real") assertRealPreloadAbsent();
  if (mode === "fake") await import("./s25-test-guard.mjs");
  if (out && fs.existsSync(path.resolve(out)) && fs.readdirSync(path.resolve(out)).length) throw new Error("Evidence directory must be empty");
  const autoParent = !parent && mode === "fake";
  if (autoParent) {
    const base = path.join(HUB_ROOT, ".ifrim", "tmp"); fs.mkdirSync(base, { recursive: true });
    parent = fs.mkdtempSync(path.join(base, "s25-parity-"));
    out ||= path.join(HUB_ROOT, ".ifrim", "s25-evidence", path.basename(parent));
  }
  if (!parent) throw new Error("--parent is required");
  parent = path.resolve(parent); out = path.resolve(out || path.join(parent, "evidence"));
  const projectDir = path.join(parent, "booking");
  if (mode === "real") checkLayout({ parent, dedicatedRoot, hubRoot: HUB_ROOT, projectDir, out, homeDir: os.homedir(), realpath: physicalPath });
  if (fs.existsSync(out) && fs.readdirSync(out).length) throw new Error("Evidence directory must be empty");
  if (fs.existsSync(projectDir)) throw new Error("Project copy already exists; no relaunch or reuse");
  fs.mkdirSync(out, { recursive: true });
  const e = { schema: "s25-isolated-rehearsal/v2", mode, scenario, preflightOnly, parent, dedicatedRoot: dedicatedRoot || null, dedicatedRootDeclaration: "--dedicated-root is coordinator's declaration: folder created only for experiments", out, projectDir, startedAt: stamp(), commit: commit || "PASS_SIMULATED: no commit claim",
    runtime: { node: process.version, executable: process.execPath, platform: process.platform },
    gitAvailability: globalThis[Symbol.for("s25.fake.gitGuard")] ? "PASS_SIMULATED: test preload returns ENOENT for git; no git command executes" : "not overridden",
    runner: mode === "real" ? "production codex sandbox, ifrim_hub_rw, 180 s" : "PASS_SIMULATED: fake-codex executes host Node, no OS isolation",
    codexRoute: "production createCodexAdapter app-server / ifrim_hub_ro" + (mode === "fake" ? "; PASS_SIMULATED fake binary" : ""),
    billingDeclaration: { source: "test:fixture", boundTo: "probe account identities" }, ownerSession: "PASS_SIMULATED: enrolOwner software authenticator",
    probes: {}, processes: [], pidChecks: [], boundaryHits: [], writerGuardHits: [], adapterTurns: [], declinedApprovals: [], runnerResults: [], candidates: [],
    stream: [], preflight: {}, configuration: { author: { model: "sonnet", effort: "medium", access: "read-only", maxOutputTokens: 64000, turnTimeoutMin: 45 },
      reviewer: { model: "gpt-6.1-sol", effort: "medium", access: "read-only" }, maxAttemptsPerStage: 1, reauthorMax: 1, maxDurationMin: 180,
      deadlineSource: "coordinator decision: live test-first plan 180 min", runnerTimeoutMs: 180000, waitLimitMin: 185 } };
  let h, missionId, timer, scanTimer, failure, realConfig, acl, baselineProcesses = [], scanPending, pendingTick, canaryCapture, preflightPassed = false;
  e.homeAclChangeApproved = { at: homeAclChangeApproved ?? null, message: HOME_ACL_APPROVAL_MESSAGE };
  e.realProcessCleanup = { records: realProcesses, survivors: [], verified: false, recordedIdentitiesVerified: false,
    scope: "recorded process identities only", unidentifiedProcesses: "UNVERIFIED: user not resolvable without elevation" };
  const processSnapshot = mode === "fake" && fakeSeams.processSnapshot || windowsProcesses;
  const checkpoints = new Set();
  let closing = false;
  const scan = async (phase = "cleanup") => {
    if (scanPending) return scanPending;
    scanPending = (async () => {
      const activeAtStart = realProcesses.filter((r) => r.root && !r.exitedAt && !r.absentAt).map((r) => ({ pid: r.pid, key: r.key }));
      const observedAt = stamp(), rows = await boundedStep("process snapshot", processSnapshot, 12000);
      recordedProcessTree(realProcesses, rows, observedAt);
      (e.processLimitations ||= []).push({ at: observedAt, ...sandboxProcessLimitations(baselineProcesses, rows, realProcesses) });
      e.processScans.push({ startedAt: observedAt, at: stamp(), phase, activeAtStart, total: rows.length, owned: realProcesses.length });
      return rows;
    })().finally(() => { scanPending = null; });
    return scanPending;
  };
  e.processScans = [];
  const removeEmergency = mode === "real" ? installEmergencyCleanup(realProcesses, { report: (outcomes) => {
    fs.writeFileSync(path.join(out, "emergency-kill.json"), JSON.stringify({ at: stamp(), outcomes }));
  } }) : () => {};
  const phaseScan = async (phase = "phase boundary") => {
    if (closing || (mode !== "real" && !fakeSeams.processSnapshot)) return;
    try { await scan(phase); } catch (error) { (e.processScanErrors ||= []).push({ at: stamp(), phase, message: error.message }); }
  };
  function authoring() {
    if (!missionId) return null;
    const row = h?.hub.db.prepare("SELECT protected_json FROM factory_specs WHERE mission_id = ? ORDER BY version DESC LIMIT 1").get(missionId);
    return row ? JSON.parse(row.protected_json).authoring : null;
  }
  function captureCandidate() {
    const a = authoring();
    for (const c of [...(a?.rejected || []).map((r) => r.candidate), a?.candidate].filter(Boolean)) {
    if (e.candidates.some((x) => x.cycle === c.cycle && x.sha === c.sha)) continue;
    if (!/^[a-f0-9]{64}$/.test(c.sha)) throw new Error("Invalid candidate blob identity");
    // Read only this throwaway mission's content-addressed evidence, including lint-rejected candidates.
    const blob = path.join(h.config.workDir, "factory", missionId, "blobs", c.sha.slice(0, 2), c.sha);
    const text = fs.readFileSync(blob, "utf8"), file = `candidate-c${c.cycle}-${c.sha.slice(0, 12)}.test.mjs`;
    if (digest(text) !== c.sha) throw new Error("Candidate bytes changed before evidence capture");
    fs.writeFileSync(path.join(out, file), text, { flag: "wx" });
    const previous = e.candidates.at(-1);
    const inventory = assertionInventory(text, c.manifest, { sha: c.sha, headerLines: c.headerLines });
    const comparison = previous ? compareInventory(previous.inventory, { text, manifest: c.manifest, headerLines: c.headerLines, sha: c.sha }) : { removed: [], matched: [], initial: true };
    const checks = previous ? h.hub.db.prepare("SELECT validation_json FROM factory_reviews WHERE mission_id = ? AND change_set_sha = ? AND status = 'VALID' ORDER BY created_at DESC LIMIT 1").get(missionId, previous.sha) : null;
    const violations = previous ? amendmentViolations(comparison.removed, c.removedDeclared || [], checks ? JSON.parse(checks.validation_json).checks : []) : [];
    e.candidates.push({ ...copy(c), file, inventory, comparison, inventoryViolations: violations, noValidCheckLost: violations.length === 0 });
    }
  }
  function captureOutcome() {
    if (!missionId) return;
    const v = h.hub.factory.view(missionId);
    e.outcome = v.factory; e.authoring = copy(authoring()); e.proofs = v.evidence; e.writerStarted = h.hub.factory.writerStarted(missionId);
    e.dispatches = h.hub.db.prepare("SELECT * FROM factory_dispatches WHERE mission_id = ? ORDER BY created_at").all(missionId);
    e.runs = h.hub.db.prepare("SELECT r.* FROM agent_runs r JOIN tasks t ON r.task_id = t.id WHERE t.mission_id = ? ORDER BY r.created_at").all(missionId);
    e.testReviews = h.hub.db.prepare("SELECT * FROM factory_reviews WHERE mission_id = ? AND json_extract(validation_json, '$.kind') = 'acceptance_test' ORDER BY created_at").all(missionId)
      .map((r) => ({ ...r, parsed: { verdict: r.verdict, ...JSON.parse(r.validation_json) } }));
    e.events = h.hub.db.prepare("SELECT * FROM events ORDER BY seq").all().filter((r) => r.scope_id === missionId || r.mission_id === missionId || e.runs.some((run) => run.id === r.run_id));
    const baselines = e.runnerResults.filter((r) => r.key.includes("-BASELINE-"));
    e.baselineGate = v.evidence.filter((row) => row.stage === "BASELINE").map((row, index) => {
      const result = baselines[index]?.result || {};
      return { evidenceId: row.id, status: row.status, signature: proofSignature(result),
        result: baselineGate(result, { manifest: e.authoring?.candidate?.manifest, harness: e.authoring?.candidate?.harness || 2 }),
        current: !row.stale && row.changeSetId === "base" && row.command === baselines[index]?.command && row.status === result.status
          && JSON.stringify(row.counts) === JSON.stringify(result.counts) && baselines.length === v.evidence.filter((r) => r.stage === "BASELINE").length };
    });
    e.grantsAfter = e.envelope ? copy(h.hub.grants.ofEnvelope(e.envelope.id)) : [];
    captureCandidate();
    e.deadlines = e.runs.map((r) => ({ runId: r.id, turnDeadline: JSON.parse(r.evidence_json).turnDeadline }));
    e.reviewResumeEvidence = reviewResumeEvidence(e.adapterTurns);
    e.reviewThreadReuse = e.reviewResumeEvidence.reused;
    e.classification = classifyRehearsal(e);
  }
  try {
    if (mode === "real") {
      e.codeIdentity = verifyCommitExport(HUB_ROOT, commit, manifestSha256);
      if (process.platform !== "win32") throw new Error("Real rehearsal requires Windows");
    }
    const ctx = s25Context(parent);
    if (mode === "real") checkLayout({ parent, dedicatedRoot, hubRoot: HUB_ROOT, projectDir, out, homeDir: os.homedir(), realpath: fs.realpathSync });
    h = await makeRehearsalHub({ parent, mode, scenario });
    e.isolation = { dataDir: h.dataDir, listener: false, scheduler: "off; explicit scheduler.tick every 15 seconds", turnTimeScale: 1 };
    const recordProcess = (event) => { e.processes.push({ ...event, at: stamp() }); };
    h.hub.live.subscribe((event) => { if (event.type?.startsWith("supervisor.")) recordProcess(event.data); });
    if (mode === "real") {
      // P10 begins before probes/P7, so short-lived and sandbox-account roots are covered too.
      baselineProcesses = await boundedStep("baseline snapshot", processSnapshot, 12000); e.processBaseline = baselineProcesses;
      e.processLimitations = [{ at: stamp(), phase: "baseline", ...sandboxProcessLimitations(baselineProcesses, baselineProcesses, realProcesses) }];
    }
    realConfig = { ...h.config, testMode: false, ...(mode === "real" ? { providerBinaries: {}, hubRoot: HUB_ROOT } : {}) };
    wireRehearsalRuntime({ h, config: realConfig, evidence: e, onEvent: recordProcess,
      ready: () => preflightPassed && !e.terminalTechnical && !failure,
      supervisorOptions: mode === "fake" ? fakeSeams.supervisor : undefined,
      beforeTurn: () => { captureCandidate(); }, forceWrite: mode === "fake" && scenario === "review-write" });
    if (mode === "real") e.binaryBefore = binaryIdentity(realConfig);
    for (const method of ["stop", "stopAll", "close"]) {
      const original = h.hub.supervisor[method];
      h.hub.supervisor[method] = async (...args) => {
        const result = await original(...args);
        (e.killOutcomes ||= []).push({ at: stamp(), kind: `supervisor.${method}`, key: args[0] || null, result });
        return result;
      };
    }
    const start = h.hub.supervisor.start;
    h.hub.supervisor.start = (options) => {
      const args = options.args || [], value = (key) => args[args.indexOf(key) + 1];
      const assertions = args.includes("app-server") ? { roProfile: args.includes('default_permissions="ifrim_hub_ro"') }
        : args.includes("sandbox") ? { rwProfile: args.includes('default_permissions="ifrim_hub_rw"'), dedicatedWorkspace: within(parent, options.cwd) }
        : options.label === "claude -p" ? { tools: value("--tools") === "Read,Glob,Grep", permissionMode: value("--permission-mode") === "dontAsk",
          output64000: options.env?.CLAUDE_CODE_MAX_OUTPUT_TOKENS === "64000", livePrivateReadDenied: liveClaudeDenyRules().every((rule) => args.includes(rule)) } : {};
      (e.launchAssertions ||= []).push({ at: stamp(), key: options.key, executable: options.executable, cwd: options.cwd, assertions });
      if (Object.values(assertions).some((ok) => !ok)) throw new Error("Effective provider launch differs from preflight recipe");
      const startRequestedAt = stamp(), stdout = options.onStdoutLine;
      const record = start({ ...options, onStdoutLine(line) {
        const canary = mode === "real" && options.key === "s25-preflight" && line.match(/S25_PREFLIGHT_READY (\d+)/);
        if (canary && !canaryCapture) canaryCapture = scan("P7 R7 marker").then((rows) => canaryProcessEvidence(realProcesses, rows, Number(canary[1])))
          .catch((error) => ({ verified: false, error: error.message }));
        // Observe only protocol metadata, never save prompts, auth responses or complete raw streams.
        try {
          const m = JSON.parse(line), msg = m.message || m.event?.message;
          if (["assistant", "result", "system"].includes(m.type) || m.event?.type === "message_start" || m.event?.type === "message_delta")
            e.stream.push({ key: options.key, at: stamp(), type: m.type, subtype: m.subtype || null, attempt: m.attempt || null, retryDelayMs: m.retry_delay_ms || null,
              stop_reason: msg?.stop_reason ?? m.event?.delta?.stop_reason ?? m.stop_reason ?? "nedemonstrat", usage: msg?.usage ?? m.event?.usage ?? m.usage ?? "nedemonstrat" });
          if (m.result?.thread) e.stream.push({ key: options.key, at: stamp(), thread: { id: m.result.thread.id, nativeSessionId: m.result.thread.id, model: m.result.model,
            reasoningEffort: m.result.reasoningEffort, sandbox: m.result.sandbox, approvalsReviewer: m.result.approvalsReviewer ?? "nedemonstrat" } });
          if (m.id !== undefined && m.method) (e.serverRequests ||= []).push({ key: options.key, at: stamp(), id: m.id, method: m.method,
            source: "app-server request; response recorded on stdin" });
        } catch { /* non-JSON CLI line */ }
        stdout?.(line);
      } });
      if (record.pid) {
        // Capture shared supervisor fields only; no synchronous WMI/launch identity query.
        trackSupervisedProcess(realProcesses, record, startRequestedAt);
        // Checkpoint after launch while provider/runner is alive. Orphans remain report-only.
        if (mode === "real" || fakeSeams.processSnapshot) {
          const checkpoint = setTimeout(() => {
            checkpoints.delete(checkpoint);
            if (!record.exitedAt && !closing) void phaseScan(`alive checkpoint: ${options.key}`);
          }, mode === "fake" ? 0 : 250);
          checkpoints.add(checkpoint);
        }
        const write = record.child.stdin.write.bind(record.child.stdin);
        record.child.stdin.write = (chunk, ...args) => {
          try {
            const reply = JSON.parse(String(chunk)), request = e.serverRequests?.find((r) => r.key === options.key && r.id === reply.id);
            if (request && !reply.method) request.response = { result: reply.result, error: reply.error };
          } catch { /* partial protocol line */ }
          return write(chunk, ...args);
        };
      }
      return record;
    };
    if (mode === "real") scanTimer = setInterval(() => {
      if (realProcesses.some((r) => r.root && !r.exitedAt && !r.absentAt)) void phaseScan("alive periodic checkpoint");
    }, 5000);
    const runProof = mode === "fake" && fakeSeams.runner ? fakeSeams.runner(h.hub.factoryRunner.run) : h.hub.factoryRunner.run;
    h.hub.factoryRunner.run = async (options) => {
      captureCandidate();
      const result = failure || e.terminalTechnical
        ? { status: "BLOCKED", reason: "REHEARSAL_TECHNICAL_STOP: no subsequent runner launch", runner: "codex-sandbox", isolation: "not launched",
          command: options.command, durationMs: 0, counts: {}, failures: [], cases: [], outputTail: "", exitCode: null }
        : await runProof(options);
      e.runnerResults.push({ at: stamp(), key: options.key, command: options.command, result });
      if (runnerTechnicalResult(result)) e.terminalTechnical = { at: stamp(), key: options.key, result };
      return result;
    };
    if (mode === "fake" && scenario === "hang") { h.hub.factory.setTurnTimeScaleForTests(fakeTurnMs / (45 * 60000)); e.isolation.turnTimeScale = fakeTurnMs / (45 * 60000); }
    await probeRehearsalProviders({ providers: h.hub.providers, providerState: h.hub.providerState, mode, evidence: e, signal });
    if (mode === "real") await phaseScan();
    if (mode === "real") {
      e.recipes = recipes({ config: realConfig, homeDir: h.homeDir, projectDir, mcpServerNames: e.probes.codex.probe.config.realtime.mcpServerNames });
      e.headroom = assertHeadroom(e.probes, claudeHeadroomChecked);
      const applied = codexDeniedEntries({ homeDir: h.homeDir, extra: [h.config.dataDir, h.config.backupDir] });
      if (denyListFingerprint(applied) !== h.hub.codexIsolation().fingerprint) throw new Error("Applied/gate fingerprint mismatch");
      acl = layoutIsolation({ hub: h.hub, parent, dedicatedRoot, homeDir: h.homeDir, hubRoot: HUB_ROOT, evidence: e });
    } else {
      e.denyList = { ...h.hub.codexIsolation(), label: "PASS_SIMULATED: fake home; no ACL operation" };
      if (scenario === "deny-other") {
        assertDenyClassification([path.join(parent, "..", "other-project")], { parent }, e);
      }
      if (scenario === "acl-outside") {
        assertAclDiff([{ path: "C:/outside", exists: true, aces: [] }], [{ path: "C:/outside", exists: true, aces: ["CodexSandboxUsers:(DENY)(R)"] }], { allowed: [{ path: parent, recursive: true }] }, e);
      }
    }
    console.log(`S25 deny-list fingerprint: ${e.denyList.fingerprint}`);
    if (mode === "real" && isolationConsent !== e.denyList.fingerprint) throw new Error("P6 --isolation-consent must equal this layout's fingerprint");
    const dispatch = (type, payload, extra = {}) => h.hub.commands.dispatch({ type, payload, channel: "test", actor: "test", ...extra });
    await dispatch("isolation.consent", { provider: "codex", confirmText: CODEX_ACL_CONSENT_TEXT, fingerprint: e.denyList.fingerprint });
    e.consent = { ...h.hub.settings.get("isolationConsent").codex, provenance: mode === "real" ? CONSENT_PROVENANCE : { kind: "PASS_SIMULATED" }, ownerClick: false };
    h.hub.bus.transaction(() => {
      h.hub.settings.set("mode", "BUILD_SAFE", "test");
      h.hub.settings.set("executionGate", { status: "open", reason: "throwaway admin path", changedAt: stamp(), changedBy: "test" }, "test");
    });
    e.admin = { label: "throwaway admin path", channel: "test", mode: "BUILD_SAFE", executionGate: h.hub.settings.get("executionGate") };
    declareBillingFixture(h.hub);
    const project = (await dispatch("project.register_test", { path: projectDir, name: "Repetiție izolată §25" })).result;
    if (mode === "real") await runnerPreflight({ h, parent, project, evidence: e, acl, homeAclChangeApproved,
      processEvidence: async () => canaryCapture ? await canaryCapture : { verified: false, reason: "No live canary marker/snapshot" } });
    signal?.throwIfAborted();
    const limits = { writerModel: "gpt-6.1-sol", writerEffort: "medium", reviewerModel: "sonnet", reviewerEffort: "medium", maxAttemptsPerStage: 1, maxDurationMin: 180 };
    const prepared = (await dispatch("factory.prepare", { projectId: project.id, ...ctx.built.input, limits })).result;
    missionId = prepared.mission.id;
    const view = () => h.hub.factory.view(missionId), spec = view().spec;
    e.spec = { sha256: spec.sha256, dataset: ctx.spec.dataset, authorLimits: ctx.spec.authoring.authorLimits };
    const brief = buildAuthorBrief({ mission: { id: missionId, title: prepared.mission.title }, spec: spec.spec, specVersion: spec.version, specSha: spec.sha256,
      authoring: { testRef: spec.spec.authoring.testRef }, facts: ctx.facts, harness: 2 });
    e.preflight.P11 = lintDatasetBrief(brief, { spec: spec.spec, facts: ctx.facts, ...spec.spec.authoring });
    fs.writeFileSync(path.join(out, "author-brief.txt"), brief, { flag: "wx" });
    if (!e.preflight.P11.lint?.ok) throw new Error("P11 shown skeleton lint failed before author dispatch");
    if (mode === "fake") {
      h.queue("claude", scenario === "rate-overage" ? "rate-overage" : "author:dataset-reference", "author:dataset-reference");
      h.queue("codex", ...(["amend", "exhausted"].includes(scenario) ? ["test-review:dataset-two", scenario === "exhausted" ? "test-review:changes-again" : "test-review:pass"] : ["test-review:pass"]));
    }
    const owner = await enrolOwner(h);
    const proposed = await h.hub.envelopes.propose({ projectId: project.id, missionIds: [missionId] });
    if (!proposed.envelope) throw new Error(`Envelope refused: ${JSON.stringify(proposed.readiness)}`);
    const env = proposed.envelope;
    function gateBeforeDispatch() {
      if (preflightPassed) return;
      if (failure) throw failure;
      const confirmed = h.hub.envelopes.get(env.id);
      e.envelope = copy(confirmed); e.grants = copy(h.hub.grants.ofEnvelope(env.id));
      e.budget = h.hub.envelopes.budgetOf(confirmed.id, missionId);
      e.deadline_at = view().factory.deadlineAt; e.expiresAt = confirmed.expiresAt;
      e.grantExpiryParity = { exact: e.grants.every((g) => g.expiresAt === confirmed.expiresAt),
        rows: e.grants.map((g) => ({ id: g.id, expiresAt: g.expiresAt, planExpiresAt: confirmed.expiresAt, deltaMs: Date.parse(confirmed.expiresAt) - Date.parse(g.expiresAt) })),
        explanation: "Production deriveGrants floors remaining TTL to whole minutes; actual expiry is capped by plan expiry and can be up to 60s earlier. No grants rewritten." };
      for (const role of ["reviewer", "writer"]) {
        const binding = view().factory.bindings[role], state = h.hub.providerState.get(binding.provider);
        const fresh = resolveRunPlan({ provider: binding.provider, model: binding.resolvedAlias, effort: binding.effort, profile: binding.profile, providerState: state });
        const change = compareAtDispatch(binding, fresh, state, { environment: "windows" });
        const plan = { ...fresh, bindingHash: binding.bindingHash, missionId, problem: change ? change.reasons.join("; ") : fresh.problem };
        e.preflight[binding.provider] = h.hub.gate.evaluate({ provider: binding.provider, projectId: project.id, access: "read-only", plan });
      }
      // Deliberately UNBOUND workspace-write request: the real plan grant must never admit a manual writer.
      e.preflight.negativeWorkspaceWrite = h.hub.gate.evaluate({ provider: "codex", projectId: project.id, access: "workspace-write" });
      e.preflight.negativeWorkspaceWrite.scope = "unbound request; bound writer is stopped by factory authority";
      if (![e.preflight.claude, e.preflight.codex].every((r) => r.allowed && r.checks.some((c) => c.id === "run_plan" && c.ok)) || e.preflight.negativeWorkspaceWrite.allowed) throw new Error("P9 bound gate or negative writer check failed");
      if (e.grants.length !== 2) throw new Error("P9 expected exactly two production envelope grants");
      for (const [provider, access] of [["claude", "read-only"], ["codex", "workspace-write"]]) {
        const grant = e.grants.find((g) => g.provider === provider);
        if (!grant || grant.access !== access || grant.maxAttempts !== 5 || grant.maxDurationS !== 7200 || grant.binding?.missionId !== missionId || !grant.binding?.bindingHash
          || !grant.binding?.model || Date.parse(grant.expiresAt) > Date.parse(confirmed.expiresAt) || Date.parse(confirmed.expiresAt) - Date.parse(grant.expiresAt) > 60000)
          throw new Error("P9 production envelope grant bounds differ from the required plan");
      }
      preflightPassed = true; e.preflight.passedAt = stamp();
    }
    const authority = rehearsalAuthority({ missionId, evidence: e, getFailure: () => failure, preflightOnly,
      gateBeforeDispatch, delegate: (mid, step) => h.hub.envelopes.authorityFor(mid, step) });
    // confirm starts background work synchronously; install BEFORE confirm, repeat immediately after for the requested boundary.
    h.hub.factory.attachAuthority(authority);
    await dispatch("envelope.confirm", { envelopeId: env.id, nonce: env.nonce, displayedHash: env.envelopeHash }, { ownerSession: owner.session });
    h.hub.factory.attachAuthority(authority);
    e.confirmationOrdering = "authority/P9 installed before confirm (factory.start schedules immediately), reattached after confirm, before first tick";
    const tick = () => {
      if (pendingTick) return;
      pendingTick = Promise.resolve().then(() => h.hub.scheduler.tick()).catch((error) => { failure ||= error; e.error = { message: error.message }; }).finally(() => { pendingTick = null; });
    };
    tick(); timer = setInterval(tick, 15000);
    await waitFor(() => { signal?.throwIfAborted(); if (failure) throw failure; return ["BLOCKED", "NEEDS_OWNER_DECISION", "PAUSED", "CANCELLED"].includes(view().factory.stage); }, mode === "fake" ? 120000 : 185 * 60000, 100, { signal });
    await h.hub.factory.idle(missionId); captureOutcome();
    clearInterval(timer);
  } catch (error) {
    failure = error; e.error = { message: error.message, stack: error.stack };
    if (h && missionId) { try { captureOutcome(); } catch (captureError) { e.captureError = captureError.message; } }
  } finally {
    closing = true; clearInterval(timer); clearInterval(scanTimer);
    for (const checkpoint of checkpoints) clearTimeout(checkpoint);
    const cleanup = cleanupSteps(e, (error) => { failure ||= error; });
    try {
    await cleanup("pending scheduler tick", () => pendingTick, 15000);
    await cleanup("pending process scan", () => scanPending, 12000);
    if (mode === "real" && h) await cleanup("process scan", scan);
    if (h) {
      if (missionId) await cleanup("factory.stop", () => h.hub.factory.stop(missionId, { actor: "test", reason: "End of isolated rehearsal; no relaunch" }));
      await cleanup("hub.close", async () => { await h.hub.close(); e.hubClosed = true; });
      await cleanup("PID checks", async () => { for (const row of realProcesses) {
        let pidCurrentlyAbsent = false;
        try { process.kill(row.pid, 0); } catch (error) { pidCurrentlyAbsent = error.code === "ESRCH"; }
        // start().exit identifies the original child. An unrelated child may already reuse its numeric PID.
        e.pidChecks.push({ pid: row.pid, gone: Boolean(row.exitedAt) || pidCurrentlyAbsent, originalExited: Boolean(row.exitedAt), pidCurrentlyAbsent,
          checkedAt: stamp(), evidence: "public supervisor start().exit for original child + PID liveness; real mode additionally requires CreationDate" });
      } });
    }
    if (mode === "real" && h) {
      await cleanup("CreationDate cleanup", async () => {
        e.realProcessCleanup.taskkill = await cleanupRecordedProcesses(realProcesses, { snapshot: scan });
      }, Math.max(30000, realProcesses.length * 11000 + 12000));
      await cleanup("CreationDate verification", async () => {
        const snapshot = { rows: await scan(), error: null };
        e.realProcessCleanup.survivors = recordedSurvivors(realProcesses, snapshot.rows);
        if (e.realProcessCleanup.survivors.length) throw new Error("Recorded process identities survived; unresolved sandbox users are not covered");
        e.realProcessCleanup.identities = realProcesses.map((r) => ({ pid: r.pid, ...(r.exitedAt ? { gone: true, source: "shared supervisor observed exit" } : compareProcessIdentity({ ...r, startTimeSource: r.creationDate ? "Win32_Process.CreationDate" : null }, snapshot)) }));
        if (e.realProcessCleanup.identities.some((r) => !r.gone)) throw new Error("OS process identity/exit could not be verified");
        e.realProcessCleanup.recordedIdentitiesVerified = true;
        e.realProcessCleanup.verified = false;
      }, 15000);
      if (acl) await cleanup("final ACL diff", async () => {
        e.aclAfter = snapshotAcls(acl.targets); e.aclFinalDiff = aclDiff(e.aclBefore, e.aclAfter, acl);
        const ancestors = recordAncestorChanges(e.aclFinalDiff, e, "post-run");
        if (!e.aclFinalDiff.ok && !ancestors.changes.length) e.aclDefect = { kind: "ACL_CHANGED_OUTSIDE_ALLOWED_SCOPE", phase: "post-run", violations: e.aclFinalDiff.violations };
        e.homeAclReport = e.aclAfter.filter((r) => /[\\/]\.(claude|openclaw)$/.test(r.path));
        if (e.aclAfter.some((r) => r.error) || !e.aclFinalDiff.ok || ancestors.changes.length) throw new Error("Post-run ACL metadata refused or changed outside allowed paths");
      });
      if (e.binaryBefore) await cleanup("binary unchanged", async () => {
        e.binaryAfter = binaryIdentity(realConfig); e.binaryUnchanged = JSON.stringify(e.binaryBefore) === JSON.stringify(e.binaryAfter);
        if (!e.binaryUnchanged) throw new Error("Codex binary changed during rehearsal; stop, never relaunch");
      });
    }
    if (mode === "real" && e.realProcessCleanup.recordedIdentitiesVerified) removeEmergency();
    // After Hub shutdown, independently calibrate every materialized candidate, including rejected ones.
    // Temporary environment redirection keeps the unmodified part-A calibrator's scratch inside evidence.
    for (const c of e.candidates) {
      if (!calibrate) { c.calibration = "NOT_RUN: explicit fake test option"; continue; }
      try {
        const prior = { TEMP: process.env.TEMP, TMP: process.env.TMP };
        try {
          process.env.TEMP = out; process.env.TMP = out;
          c.calibration = await boundedStep("candidate calibration", () => (mode === "fake" && fakeSeams.calibrate || calibrateS25)({ candidate: path.join(out, c.file), manifest: c.manifest }), 15 * 60000);
          jsonFile(path.join(out, `${c.file}.calibration.json`), c.calibration);
        } finally { for (const [key, value] of Object.entries(prior)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
      } catch (error) { c.calibrationError = { message: error.message }; }
      c.calibrationGate = calibrationGate(c.calibration);
      c.correctionProbes = c.calibration?.correctionProbes || null;
    }
    if (mode === "fake" && h?.dataDir) await cleanup("remove fake Hub data", async () => {
      if (!within(path.join(HUB_ROOT, ".ifrim", "tmp"), h.dataDir) || !path.basename(h.dataDir).startsWith("s25-parity-")) throw new Error("Unsafe fake data cleanup target");
      fs.rmSync(h.dataDir, { recursive: true, force: true, maxRetries: 5 });
    });
    if (autoParent) await cleanup("remove automatic fake parent", async () => {
      if (!within(path.join(HUB_ROOT, ".ifrim", "tmp"), parent) || within(parent, out)) throw new Error("Unsafe automatic parent cleanup target");
      fs.rmSync(parent, { recursive: true, force: true, maxRetries: 5 });
    });
    } catch (error) {
      failure ||= error; (e.cleanupErrors ||= []).push({ step: "cleanup orchestration", message: error.message });
    } finally {
      try {
        if (!e.stream.length) e.stopReasonEvidence = "nedemonstrat: no per-message stop_reason/usage exposed";
        e.finishedAt = stamp(); e.classification = classifyRehearsal(e);
        e.rehearsalGate = rehearsalGate(e);
      } catch (error) {
        failure ||= error; (e.cleanupErrors ||= []).push({ step: "final classification", message: error.message });
        e.classification = "TECHNICAL_STOP"; e.rehearsalGate = false;
      } finally { jsonFile(path.join(out, "evidence.json"), e); }
    }
  }
  if (failure) throw Object.assign(failure, { evidence: e });
  return copy(e);
}
