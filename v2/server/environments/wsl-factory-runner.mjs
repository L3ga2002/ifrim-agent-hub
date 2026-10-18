import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { redactText, redactDeep } from "../security/redact.mjs";
import { isAllowedCommand, isAllowedPreviewCommand } from "../factory/spec.mjs";
import { parseTestOutput, testStatus, createRunCaseReader, RUNNER_TIMEOUT_MS } from "../factory/runner.mjs";
import { validateE2ESteps } from "../tools/browser-core.mjs";
import { resolveWsl, wslArgs, runInDistro, runScript } from "./wsl.mjs";
import { BWRAP, localOnlyArgs, HOST_FILES, heredocFiles, PW_IN_SANDBOX } from "./sandbox-profiles.mjs";

const OUTPUT_LINES = 300;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** The in-namespace preview host (M06-A, M07 v2); written into the run workspace by a versioned script, never edited per run. */
export const PREVIEW_HOST = HOST_FILES["preview-host.mjs"];
/** The bwrap profiles live in sandbox-profiles.mjs (one definition for production and the canary); re-exported for callers. */
export { BWRAP, localOnlyArgs };
const E2E_STEP_TIMEOUT_MS = 10000;
/** An E2E answer from the host is awaited at most this long: the same bound as the Windows browser (runE2EBounded). */
export const e2eDeadlineMs = (steps, stepMs = E2E_STEP_TIMEOUT_MS) => 60000 + steps.reduce((ms, step) => ms + (Object.keys(step || {})[0] === "goto" ? stepMs * 2 * 3 : stepMs), 0) + 45000;

/** The preview command mapped to the environment's own Node/npm (the same shapes the spec accepts). */
export function previewArgv(command, env) {
  const parts = String(command).trim().split(/\s+/);
  if (!isAllowedPreviewCommand(command)) return null;
  if (parts[0] === "node") return [env.node, ...parts.slice(1)];
  if (parts[0] === "npm" && parts[1] === "run") return [env.npm, "run", parts[2]];
  return null;
}

/**
 * Writes the preview host files (the host, the shared E2E core, the redaction) into ONE run workspace, read-only for the
 * sandbox afterwards. The files are the Hub's own (HOST_FILES), never edited per run.
 */
const previewHostScript = () => `# ifrim-env:previewhost v2 — writes the preview host into ONE run workspace (read-only for the sandbox afterwards).
set -eu
D="$1"
case "$D" in /home/runner/ws/hub/?*/host) ;; *) echo "error=host dir outside the Hub root"; exit 2 ;; esac
case "$D" in */../*|*//*) echo "error=invalid path"; exit 2 ;; esac
umask 077
mkdir -p "$D"
${heredocFiles("$D")}
chmod 500 "$D"
echo "ok=1"
`;

/**
 * node --test runs every test file in a child process read through a pipe by default, and the network-off Linux sandbox loses
 * that child's output: only "not ok 1 - <file>" came back, without the failure text or the per-test lines (measured in
 * ifrim-runner, 2026-10-02). In-process isolation keeps every line (and an EPERM in its own test). Through NODE_OPTIONS it also
 * covers `npm test` / `npm run`; other node commands ignore it. Difference from Windows: test files share one process.
 */
export const TEST_NODE_OPTIONS = "--test-isolation=none";

/** The allowed factory commands mapped to the environment's own Node/npm (never a Windows binary). */
export function wslCommandArgv(command, env) {
  const parts = String(command).trim().split(/\s+/);
  if (parts[0] === "node" && parts[1] === "--test") return [env.node, "--test", "--test-reporter=tap", ...parts.slice(2)];
  if (parts[0] === "node") return [env.node, ...parts.slice(1)];
  if (parts[0] === "npm" && parts[1] === "test") return [env.npm, "test"];
  if (parts[0] === "npm" && parts[1] === "run") return [env.npm, "run", parts[2]];
  // M08 (owner-enabled, package B3): the standard library's unittest on relative .py files, nothing installed. Only when the spec
  // check still allows it now (the setting can be turned off after the plan); verbose, so every test prints its own result line.
  if (parts[0] === "python3" && parts[1] === "-m" && parts[2] === "unittest" && isAllowedCommand(command)) return ["/usr/bin/python3", "-m", "unittest", "-v", ...parts.slice(3)];
  return null;
}

/**
 * The Linux sandbox with the network off refuses every socket (TCP and Unix, listen and connect) and loses the output of a
 * child process read through a socket pair (measured on Codex 0.159.2, M05). A test that needs one of those is an
 * environment limit, not a product failure: it is reported BLOCKED with the reason, so it never starts a repair cycle.
 */
export const SOCKET_REFUSAL = /\b(EPERM|EACCES)\b[^\n]{0,120}\b(listen|connect|bind|socket|spawn|pipe)\b|\b(listen|connect|bind|spawn)\b[^\n]{0,80}\b(EPERM|EACCES)\b|operation not permitted[^\n]{0,60}socket/i;

/**
 * Whether a failed command failed ONLY because of the sandbox's socket refusal. Each failing TAP test is one block (from its
 * "not ok" line to the next result line); a parent that failed only because its subtests failed is skipped. BLOCKED needs
 * at least one failing block and every failing block showing the refusal: a real product failure next to a socket test stays
 * a FAIL (it must reach the repair loop). Without itemized failures (a crash before any TAP line), any refusal line decides.
 */
export function environmentBlocked(lines) {
  const blocks = [];
  let current = null;
  for (const line of lines) {
    const result = line.match(/^(?:\[stderr\] )?\s*(not ok|ok) \d+ - /);
    if (result) { current = result[1] === "not ok" ? { lines: [line] } : null; if (current) blocks.push(current); continue; }
    if (/^\s*# (tests|suites|pass|fail)\b/.test(line)) { current = null; continue; }
    if (current) current.lines.push(line);
  }
  const failing = blocks.filter((b) => !b.lines.some((l) => /failureType: 'subtestsFailed'/.test(l)));
  if (!failing.length) return lines.some((l) => SOCKET_REFUSAL.test(l));
  return failing.every((b) => b.lines.some((l) => SOCKET_REFUSAL.test(l)));
}

/**
 * Factory runner (checks, QA) inside the wsl-runner environment (M05 §13). Each command gets a fresh copy of the project's
 * current files in a new workspace, runs through `codex sandbox -P ifrim_runner_rw` (the attested profile, network off),
 * then the workspace's processes are reaped and the workspace removed. Nothing from the run comes back to the project:
 * checks only produce evidence. The Codex sandbox refuses sockets, so the preview runs in the separate LOCAL-ONLY bwrap
 * profile (M06-A, C18) and its browser E2E inside that same namespace (M07, C19); without those attestations they are
 * refused here, never moved to Windows by this runner.
 */
export function createWslFactoryRunner({ config, supervisor, environment, settings }) {
  const env = environment.env;
  const profile = env.profiles["workspace-write"];
  const owned = new Map(); // supervisor key → workspace id
  const hosts = new Map(); // supervisor key → { wsId, record, waiters: Map(e2e id → resolve), browser } of a preview host (M06-A, M07)
  const releases = new Map(); // supervisor key → the in-flight release of its preview workspace
  const aborts = new Map(); // supervisor key → AbortController of a copy in progress

  function readiness(project = null) {
    const state = environment.state();
    if (!state?.installed) return { ok: false, isolation: "none", detail: `Mediul ${env.id} nu a fost inspectat sau nu există (Sistem → Medii)` };
    if (!state.ok) return { ok: false, isolation: "none", detail: `Mediul ${env.id} raportează probleme de graniță: ${(state.problems || []).filter((p) => p.blocking).map((p) => p.detail).slice(0, 2).join("; ")}` };
    const attestation = environment.attestationStatus();
    if (!attestation.valid) return { ok: false, isolation: "none", detail: `ENV_NOT_ATTESTED: ${attestation.reason}` };
    if (project && project.source !== "hub-test") {
      const policy = settings.get("environmentPolicy")?.[env.id];
      if (!policy?.approvedAt || policy.fingerprintHash !== state.fingerprint?.hash) return { ok: false, isolation: "none", detail: "NEEDS_OWNER_APPROVAL: proiectele reale cer aprobarea (b) pentru amprenta curentă a mediului" };
    }
    return { ok: true, isolation: `${environment.simulated ? "SIMULATED: fixture fake-wsl, fără sandbox real · " : ""}${env.id}: sandbox Linux + profil ${profile} (amprenta ${state.fingerprint.hash}), copie a proiectului, rețea și socket-uri oprite` };
  }

  /**
   * Checks and QA commands. First through `codex sandbox` (the attested writer-side profile, network off). When the project's
   * tests need a socket (a local HTTP server, a child process over a pipe) that sandbox refuses them and the result is an
   * environment limit, not a product failure (M05). M07: if the LOCAL-ONLY profile is attested (C18: bwrap, own network
   * namespace with loopback only, /usr read-only, a fresh copy at /work), the same command runs again there, on a NEW copy —
   * loopback works, the internet, the Windows host, ~/.codex and the other workspaces stay unreachable. Without C18 the result
   * stays BLOCKED, as before. The evidence names the profile that ran.
   */
  function run({ key, ws: projectRoot, command, project = null, timeoutMs = RUNNER_TIMEOUT_MS, shouldStop = () => false }) {
    const started = Date.now();
    // cases / fileLevelFailure / overflow: M11 L5, read from every line of the attempt that produced the result (createRunCaseReader).
    const base = { command, runner: `codex-sandbox@${env.id}`, durationMs: 0, exitCode: null, counts: {}, failures: [], outputTail: "", cases: [], fileLevelFailure: null, overflow: 0 };
    if (!isAllowedCommand(command)) return Promise.resolve({ ...base, status: "BLOCKED", reason: "comandă în afara listei acceptate", isolation: "none" });
    const argv = wslCommandArgv(command, env);
    const binary = resolveWsl(config); // wsl.exe (or the test fixture): the environment's launcher
    if (!argv || !binary) return Promise.resolve({ ...base, status: "BLOCKED", reason: "comanda sau wsl.exe nu pot fi pregătite", isolation: "none" });
    const idOf = (suffix) => `rn-${crypto.createHash("sha256").update(`${key}:${started}:${suffix}`).digest("hex").slice(0, 16)}`;

    /** One attempt on a fresh copy: "sandbox" (codex sandbox, network off) or "local-only" (bwrap, loopback only). */
    async function attempt(mode, isolation) {
      const wsId = mode === "sandbox" ? idOf("sb") : idOf("lo");
      let prepared;
      const copyAbort = new AbortController();
      aborts.set(key, copyAbort);
      try { prepared = await environment.prepareWorkspace({ id: wsId, projectRoot, projectId: project?.id || "", purpose: "runner", signal: copyAbort.signal }); }
      catch (error) { return { ...base, status: "BLOCKED", reason: `copia proiectului în ${env.id} a eșuat: ${String(error.message).slice(0, 200)}`, isolation, durationMs: Date.now() - started }; }
      finally { aborts.delete(key); }
      owned.set(key, wsId);
      // A Stop / Pause during the copy: the command never starts (the caller records it as interrupted).
      if (shouldStop() || copyAbort.signal.aborted) {
        owned.delete(key);
        await environment.release(wsId).catch(() => {});
        return { ...base, status: "BLOCKED", reason: "oprit înainte de pornirea comenzii", isolation, durationMs: Date.now() - started, stopped: true };
      }
      const out = [];
      const reader = createRunCaseReader();
      let timedOut = false;
      try {
        let inner;
        if (mode === "sandbox") {
          inner = [env.codex, "sandbox", "-P", profile, "-C", prepared.repo, "--", ...argv];
        } else {
          // The profile's read-only /hub is an empty host dir here (the command runs from the copy only).
          const hostDir = `${prepared.ws}/host`;
          const mk = await runInDistro(config, env, { cwd: env.home, argv: ["/bin/mkdir", "-p", "-m", "700", hostDir], timeoutMs: 60000 });
          if (mk.code !== 0) return { ...base, status: "BLOCKED", reason: `profilul doar-local nu a putut fi pregătit: ${String(mk.stderr).slice(0, 160)}`, isolation };
          inner = [BWRAP, ...localOnlyArgs({ repo: prepared.repo, hostDir, marker: wsId }), "--setenv", "NODE_ENV", "test", "--setenv", "CI", "1", ...argv];
        }
        const vars = mode === "sandbox"
          ? { TMPDIR: prepared.tmp, IFRIM_RUN: wsId, NODE_ENV: "test", CI: "1", NODE_OPTIONS: TEST_NODE_OPTIONS, npm_config_cache: `${prepared.tmp}/npm-cache`, npm_config_update_notifier: "false" }
          : { IFRIM_RUN: wsId };
        let record;
        try {
          record = supervisor.start({ key, label: `runner@${env.id}${mode === "sandbox" ? "" : " (doar-local)"}: ${command}`, executable: binary.executable,
            args: [...binary.prefixArgs, ...wslArgs(env, { cwd: prepared.repo, argv: inner, vars })],
            cwd: config.hubRoot, onStdoutLine: (line) => {
              const clean = redactText(line).slice(0, 500);
              reader.push(clean); // every line, before the tail window below can drop it
              out.push(clean);
              if (out.length > OUTPUT_LINES) out.shift();
            } });
        } catch (error) { return { ...base, status: "BLOCKED", reason: `runner-ul nu a pornit: ${error.message}`, isolation }; }
        const timer = setTimeout(() => { timedOut = true; supervisor.stop(key, { graceMs: 500 }).catch(() => {}); }, timeoutMs);
        timer.unref?.();
        const exit = await record.exit;
        clearTimeout(timer);
        supervisor.forget(key);
        const lines = [...out, ...record.stderrTail.map((l) => `[stderr] ${l}`)];
        const { counts, failures } = parseTestOutput(lines);
        const verdict = testStatus({ exitCode: exit.code, counts, timedOut });
        return { ...base, ...verdict, runner: mode === "sandbox" ? base.runner : `bwrap-local-only@${env.id}`, exitCode: exit.code, counts, failures, ...reader.finish(record.stderrTail), durationMs: Date.now() - started,
          outputTail: lines.slice(-120).join("\n"), isolation, socketRefused: mode === "sandbox" && verdict.status !== "PASS" && environmentBlocked(lines) };
      } finally {
        owned.delete(key);
        if (mode !== "sandbox") await environment.reap(wsId, { marker: wsId }).catch(() => {});
        await environment.release(wsId).catch(() => {});
      }
    }

    return (async () => {
      // The environment as it is now (an inspection older than 10 min is repeated): a changed fingerprint blocks the command.
      const last = environment.state();
      if (!last?.inspectedAt || Date.now() - new Date(last.inspectedAt).getTime() > 10 * 60000) await environment.inspect().catch(() => {});
      const ready = readiness(project);
      if (!ready.ok) return { ...base, status: "BLOCKED", reason: ready.detail, isolation: ready.isolation };
      const first = await attempt("sandbox", ready.isolation);
      if (!first.socketRefused) { const { socketRefused, ...rest } = first; return rest; }
      const local = localOnlyReadiness(project);
      if (!local.ok || shouldStop()) {
        const { socketRefused, ...rest } = first;
        return { ...rest, status: "BLOCKED", reason: `sandbox-ul Linux din ${env.id} refuză socket-urile și procesele copil cu pipe-uri (rețea oprită); testul are nevoie de ele${local.ok ? "" : ` și profilul doar-local nu e disponibil (${local.detail})`}` };
      }
      const second = await attempt("local-only", local.isolation);
      const { socketRefused, ...rest } = second;
      return { ...rest, fallbackFrom: `codex-sandbox@${env.id}: socket refuzat (${first.durationMs} ms)` };
    })();
  }

  /**
   * Whether the local-only profile may run project code here: the environment as for checks, plus an attestation whose
   * canary measured the profile (C18) and bwrap present in the fingerprint. Without it the preview is not offered here.
   */
  function localOnlyReadiness(project = null) {
    const base = readiness(project);
    if (!base.ok) return base;
    const att = environment.attestationStatus();
    const byId = att.latest?.checks?.byId || {};
    if (byId.C18 !== "PASS") return { ok: false, isolation: "none", detail: `Profilul doar-local (bwrap, rețea doar loopback) nu e atestat: canary C18 ${byId.C18 || "NOT_RUN"}; refă atestarea mediului` };
    if (!environment.state()?.fingerprint?.bwrap) return { ok: false, isolation: "none", detail: "bwrap lipsește din amprenta mediului" };
    return { ok: true, isolation: `${environment.simulated ? "SIMULATED: fixture fake-wsl, fără namespace real · " : ""}${env.id}: bwrap ${environment.state().fingerprint.bwrap}, namespace de rețea propriu (doar loopback), /usr doar-citire, copie a proiectului (atestat C18)` };
  }

  /**
   * E2E needs a browser INSIDE the preview's namespace (the Windows browser cannot reach it): Playwright's Chromium for Linux
   * in the fingerprint and an attestation whose canary launched it in this very profile with its own sandbox (C19).
   * Otherwise BLOCKED, with the reason — it never moves to the Windows browser.
   */
  function e2eReadiness(project = null) {
    const lo = localOnlyReadiness(project);
    if (!lo.ok) return { ok: false, detail: lo.detail };
    const facts = environment.state()?.facts || {};
    if (!facts.pw_chromium || !facts.pw_version) return { ok: false, detail: `Chromium pentru Linux nu este instalat în ${env.id}: E2E nu poate rula în namespace-ul preview-ului (instalare cerută în pachetul M06-A; nu se trece pe browserul Windows)` };
    const byId = environment.attestationStatus().latest?.checks?.byId || {};
    if (byId.C19 !== "PASS") return { ok: false, detail: `Chromium ${facts.pw_chromium} există, dar pornirea lui în bwrap cu sandbox-ul propriu nu e atestată: canary C19 ${byId.C19 || "NOT_RUN"}; refă atestarea mediului (E2E rămâne blocat, nu trece pe browserul Windows)` };
    return { ok: true, detail: `${environment.simulated ? "SIMULATED: fixture fake-wsl, fără Chromium real · " : ""}Playwright ${facts.pw_version}, ${facts.pw_chromium} în namespace-ul preview-ului, cu sandbox-ul Chromium propriu măsurat la fiecare rulare (atestat C19)` };
  }

  /** Answers the waiting E2E of a host (by id); a second answer for the same id is ignored. */
  function settle(host, id, fact) {
    const waiter = host?.waiters.get(id);
    if (!waiter) return;
    host.waiters.delete(id);
    waiter(fact);
  }
  const failWaiters = (host, error) => { for (const id of [...host.waiters.keys()]) settle(host, id, { kind: "e2e", id, status: "BLOCKED", steps: [], error }); };

  /**
   * Ends a preview host's workspace once: pending E2E answered, processes reaped (marker), workspace removed. Idempotent: a
   * second caller (the host's exit and a Stop racing) gets the release already in flight, so a Stop returns only after it.
   */
  function releaseHost(key, reason) {
    const host = hosts.get(key);
    if (!host) return releases.get(key) || Promise.resolve();
    hosts.delete(key);
    if (owned.get(key) === host.wsId) owned.delete(key);
    failWaiters(host, reason);
    const done = (async () => {
      await environment.reap(host.wsId, { marker: host.wsId }).catch(() => {});
      await environment.release(host.wsId).catch(() => {});
    })().finally(() => { if (releases.get(key) === done) releases.delete(key); });
    releases.set(key, done);
    return done;
  }

  /**
   * Preview of the verified version inside the local-only profile: a fresh copy, the host scripts, bwrap. The preview is
   * probed from INSIDE the namespace; the result (HTTP status, title) and the measured isolation are the evidence. With the
   * E2E profile attested (C19) the same namespace also gets Playwright and the headless shell read-only (M07), so the E2E
   * of this preview runs next to it (e2e()).
   */
  async function startPreview({ key, ws: projectRoot, command, url, waitMs = 20000, project = null }) {
    const started = Date.now();
    if (!isAllowedPreviewCommand(command)) return { status: "BLOCKED", reason: "comandă de preview neacceptată", isolation: "none" };
    const ready = localOnlyReadiness(project);
    if (!ready.ok) return { status: "BLOCKED", reason: ready.detail, isolation: ready.isolation };
    const argv = previewArgv(command, env);
    const binary = resolveWsl(config);
    if (!argv || !binary) return { status: "BLOCKED", reason: "comanda sau wsl.exe nu pot fi pregătite", isolation: "none" };
    const withBrowser = e2eReadiness(project).ok;
    const runner = `bwrap-local-only@${env.id}`;
    const wsId = `pv-${crypto.createHash("sha256").update(`${key}:${started}`).digest("hex").slice(0, 16)}`;
    let prepared;
    try { prepared = await environment.prepareWorkspace({ id: wsId, projectRoot, projectId: project?.id || "", purpose: "preview" }); }
    catch (error) { return { status: "BLOCKED", reason: `copia proiectului în ${env.id} a eșuat: ${String(error.message).slice(0, 200)}`, isolation: ready.isolation, runner }; }
    owned.set(key, wsId);
    const host = { wsId, record: null, waiters: new Map(), browser: withBrowser };
    hosts.set(key, host);
    const hostDir = `${prepared.ws}/host`;
    try {
      const written = await runScript(config, env, previewHostScript(), [hostDir], { timeoutMs: 60000 });
      if (written.code !== 0) throw new Error(written.text.slice(0, 200) || written.stderr.slice(0, 200));
    } catch (error) {
      await stop(key).catch(() => {});
      return { status: "BLOCKED", reason: `gazda preview-ului nu a putut fi scrisă în mediu: ${String(error.message).slice(0, 200)}`, isolation: ready.isolation, runner };
    }
    const facts = [];
    const out = [];
    let resolveDone;
    const done = new Promise((r) => { resolveDone = r; });
    let record;
    try {
      record = supervisor.start({ key, label: `preview@${env.id} (doar-local${withBrowser ? " + E2E" : ""}): ${command}`, executable: binary.executable,
        args: [...binary.prefixArgs, ...wslArgs(env, { cwd: prepared.repo, vars: { IFRIM_RUN: wsId },
          argv: [BWRAP, ...localOnlyArgs({ repo: prepared.repo, hostDir, marker: wsId, browser: withBrowser }), env.node, "/hub/preview-host.mjs", "--url", url, "--wait-ms", String(waitMs),
            "--fake", environment.simulated ? "1" : "0", ...(withBrowser ? ["--pw", PW_IN_SANDBOX] : []), "--", ...argv] })],
        cwd: config.hubRoot,
        onStdoutLine: (line) => {
          const m = String(line).match(/^IFRIM (\{.*\})$/);
          if (m) {
            let fact;
            try { fact = JSON.parse(m[1]); } catch { return; }
            if (fact?.kind === "e2e") { settle(host, String(fact.id || ""), fact); return; }
            facts.push(fact);
            if (["ready", "failed", "error"].includes(fact.kind)) resolveDone(fact);
            return;
          }
          out.push(redactText(line).slice(0, 300)); if (out.length > 60) out.shift();
        } });
    } catch (error) {
      await stop(key).catch(() => {});
      return { status: "BLOCKED", reason: `preview-ul nu a pornit: ${error.message}`, isolation: ready.isolation, runner };
    }
    host.record = record;
    // Whatever ends the host (Stop from the factory, a crash, the preview dying), its workspace goes with it.
    record.exit.then((exit) => { resolveDone({ kind: "exited", exited: exit }); releaseHost(key, `gazda preview-ului s-a oprit (${exit.code ?? "?"})`).catch(() => {}); });
    const timer = setTimeout(() => resolveDone({ kind: "timeout" }), waitMs + 30000);
    timer.unref?.();
    const result = await done;
    clearTimeout(timer);
    const iso = facts.find((f) => f.kind === "isolation") || null;
    const ok = result.kind === "ready" && result.check?.status >= 200 && result.check?.status < 400;
    const isolationOk = iso?.simulated || iso?.ok === true;
    if (!ok || !isolationOk) await stop(key).catch(() => {});
    const tail = [...out, ...(result.tail || []), ...(record.stderrTail || [])].slice(-40).join("\n");
    if (ok && !isolationOk) return { status: "BLOCKED", reason: `izolarea măsurată în namespace nu corespunde profilului: ${JSON.stringify(iso).slice(0, 200)}`, url, key, isolation: ready.isolation, outputTail: tail, durationMs: Date.now() - started, inEnvironment: true, runner };
    return { status: ok ? "PASS" : result.kind === "error" ? "BLOCKED" : "FAIL", url, key, inEnvironment: true, isolationCheck: iso, runner, e2eProfile: withBrowser,
      reason: ok ? `HTTP ${result.check.status}${result.check.title ? ` · ${result.check.title}` : ""} (verificat din namespace-ul preview-ului)` : result.kind === "timeout" ? "preview-ul nu a răspuns la timp" : result.kind === "exited" ? `gazda preview-ului s-a oprit (${result.exited?.code ?? "?"})` : result.reason || `URL-ul nu răspunde (${result.check?.error || result.check?.status || "—"})`,
      check: result.check || null, isolation: `${ready.isolation}${withBrowser ? "; profil E2E: Playwright + Chromium doar-citire (C19)" : ""}`, outputTail: tail, durationMs: Date.now() - started };
  }

  /**
   * One E2E criterion inside the preview's namespace (M07, option A): the steps go to the running preview host over its
   * stdin, the host runs the Hub's E2E core with Chromium from /pw (own sandbox, measured on every run) and answers with one
   * line. The wait is bounded like the Windows browser; `signal` (Stop / Pause) sends an abort and the answer is INTERRUPTED.
   * A result whose Chromium sandbox was not measured active is BLOCKED (a fixture may report "simulated" only in a simulated
   * environment). The screenshot comes back as base64 and is written to `evidenceDir` only after its PNG signature is
   * checked. Nothing here ever falls back to the Windows browser.
   */
  async function e2e({ key, url, steps, signal = null, evidenceDir = null, project = null, stepTimeoutMs = E2E_STEP_TIMEOUT_MS }) {
    const started = Date.now();
    const runner = `playwright@${env.id}`;
    const ready = e2eReadiness(project);
    const chromium = environment.state()?.facts?.pw_chromium || "Chromium";
    const where = `${env.id}: namespace-ul preview-ului (bwrap doar-local)`;
    const blocked = (error, status = "BLOCKED") => ({ status, steps: [], consoleErrors: [], error: String(error).slice(0, 400), runner, screenshot: null, network: null, sandbox: null,
      isolated: `${where}; ${ready.ok ? `${chromium}, nerulat` : "browser nedisponibil"}`, durationMs: Date.now() - started });
    if (!ready.ok) return blocked(ready.detail);
    const problems = validateE2ESteps(steps);
    if (problems.length) return blocked(`pași E2E invalizi: ${problems.join("; ")}`);
    const host = hosts.get(key);
    if (!host?.record || host.record.exited) return blocked("preview-ul din mediu nu rulează pentru această etapă");
    if (!host.browser) return blocked("preview-ul a pornit fără profilul E2E (C19 nu era atestat la pornire); reia etapa după atestare");
    if (signal?.aborted) return blocked("E2E oprit înainte de pornire", "INTERRUPTED");
    const id = `e2e${crypto.randomBytes(8).toString("hex")}`;
    const answer = new Promise((resolve) => host.waiters.set(id, resolve));
    const send = (msg) => { try { host.record.child.stdin.write(`${JSON.stringify(msg)}\n`); return true; } catch { return false; } };
    if (!send({ cmd: "e2e", id, url, steps, stepTimeoutMs })) { host.waiters.delete(id); return blocked("gazda preview-ului nu primește comenzi"); }
    const deadlineMs = e2eDeadlineMs(steps, stepTimeoutMs);
    let abortTimer = null;
    const onAbort = () => {
      send({ cmd: "abort", id });
      // The host closes the browser and answers INTERRUPTED; a host that does not answer does not hold the Stop.
      abortTimer = setTimeout(() => settle(host, id, { kind: "e2e", id, status: "INTERRUPTED", steps: [], error: "oprit (gazda nu a confirmat la timp)" }), 8000);
      abortTimer.unref?.();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => { send({ cmd: "abort", id }); settle(host, id, { kind: "e2e", id, status: "BLOCKED", steps: [], error: `E2E a depășit ${Math.round(deadlineMs / 1000)} s` }); }, deadlineMs);
    timer.unref?.();
    let fact;
    try { fact = await answer; } finally { clearTimeout(timer); clearTimeout(abortTimer); signal?.removeEventListener("abort", onAbort); host.waiters.delete(id); }
    const sandbox = fact.sandbox && typeof fact.sandbox === "object" ? redactDeep(fact.sandbox) : null;
    const sandboxOk = sandbox?.active === true || (sandbox?.simulated === true && environment.simulated);
    let status = ["PASS", "FAIL", "INTERRUPTED", "BLOCKED"].includes(fact.status) ? fact.status : "BLOCKED";
    let error = fact.error ? redactText(String(fact.error)).slice(0, 400) : null;
    if ((status === "PASS" || status === "FAIL") && !sandboxOk) {
      status = "BLOCKED";
      error = `sandbox-ul Chromium nu a fost măsurat activ în namespace (${sandbox?.reason || (sandbox?.simulated ? "simulat într-un mediu real" : "fără măsurătoare")}); rezultatul nu e acceptat`;
    }
    let screenshot = null;
    if (fact.screenshotB64 && evidenceDir && (status === "PASS" || status === "FAIL")) {
      const png = Buffer.from(String(fact.screenshotB64), "base64");
      if (png.length > 8 && png.length <= 2 * 1024 * 1024 && png.subarray(0, 8).equals(PNG_SIGNATURE)) {
        fs.mkdirSync(evidenceDir, { recursive: true });
        fs.writeFileSync(path.join(evidenceDir, `${id}.png`), png);
        screenshot = `${id}.png`;
      }
    }
    const stepRows = (Array.isArray(fact.steps) ? fact.steps : []).slice(0, 30).map((s) => ({ i: Number(s?.i) || 0, kind: String(s?.kind || "").slice(0, 30), ok: s?.ok === true, ms: Number(s?.ms) || 0,
      ...(s?.error ? { error: redactText(String(s.error)).slice(0, 300) } : {}) }));
    return { id, status, url, steps: stepRows, consoleErrors: (Array.isArray(fact.consoleErrors) ? fact.consoleErrors : []).slice(0, 50).map((c) => ({ type: String(c?.type || "").slice(0, 20), text: redactText(String(c?.text || "")).slice(0, 500) })),
      screenshot, durationMs: Date.now() - started, network: fact.network ? redactDeep(fact.network) : null, sandbox, runner, ...(error ? { error } : {}),
      isolated: `${where}: ${chromium}, sandbox Chromium ${sandbox?.active ? "măsurat activ (renderer seccomp-bpf, namespace de utilizator propriu, fără --no-sandbox)" : sandbox?.simulated ? "SIMULAT (fixture)" : "NEMĂSURAT"}` };
  }

  async function stop(key) {
    aborts.get(key)?.abort();
    const host = hosts.get(key) || null;
    // A preview host stops gracefully when its stdin ends (supervisor.stop ends it first): the browser closes, the group ends.
    const result = await supervisor.stop(key, { graceMs: host ? 2500 : 500 });
    if (host || releases.has(key)) { await releaseHost(key, "preview-ul a fost oprit"); return result; }
    const wsId = owned.get(key);
    if (wsId) await environment.reap(wsId, { marker: wsId }).catch(() => {});
    return result;
  }

  /** Warm-up / preflight (M05 §21): a trivial command through the same sandbox in an empty workspace; no project code, no model. */
  async function preflight() {
    const started = Date.now();
    const state = environment.state();
    if (!state?.installed) return { ok: false, environment: env.id, reason: "mediul nu a fost inspectat" };
    const binary = resolveWsl(config);
    const id = `pf-${crypto.randomBytes(6).toString("hex")}`;
    const ws = `${env.workspaceRoot}/${id}`;
    try {
      const prep = await runInDistro(config, env, { cwd: env.home, argv: ["/bin/mkdir", "-p", "-m", "700", `${ws}/repo`], timeoutMs: 120000 });
      if (prep.code !== 0) return { ok: false, environment: env.id, reason: prep.stderr.slice(0, 200), durationMs: Date.now() - started };
      const t0 = Date.now();
      const r = await runInDistro(config, env, { cwd: `${ws}/repo`, argv: [env.codex, "sandbox", "-P", env.profiles["read-only"], "-C", `${ws}/repo`, "--", "/bin/true"], timeoutMs: 300000 });
      return { ok: r.code === 0, environment: env.id, sandboxMs: Date.now() - t0, durationMs: Date.now() - started, reason: r.code === 0 ? null : `exit ${r.code}: ${r.stderr.slice(0, 160)}`, launcher: Boolean(binary) };
    } finally {
      await runInDistro(config, env, { cwd: env.home, argv: ["/bin/rm", "-rf", "--", ws], timeoutMs: 60000 }).catch(() => {});
    }
  }

  return { environment: env.id, readiness, run, startPreview, stop, preflight, localOnlyReadiness, e2eReadiness, e2e };
}
