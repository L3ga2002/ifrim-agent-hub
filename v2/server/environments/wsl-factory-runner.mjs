import crypto from "node:crypto";
import { redactText } from "../security/redact.mjs";
import { isAllowedCommand } from "../factory/spec.mjs";
import { parseTestOutput, testStatus, RUNNER_TIMEOUT_MS } from "../factory/runner.mjs";
import { resolveWsl, wslArgs, runInDistro } from "./wsl.mjs";

const OUTPUT_LINES = 300;
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
 * checks only produce evidence. Preview is not offered here (no socket inside the sandbox): it stays on the Windows route.
 */
export function createWslFactoryRunner({ config, supervisor, environment, settings }) {
  const env = environment.env;
  const profile = env.profiles["workspace-write"];
  const owned = new Map(); // supervisor key → workspace id
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

  function run({ key, ws: projectRoot, command, project = null, timeoutMs = RUNNER_TIMEOUT_MS, shouldStop = () => false }) {
    const started = Date.now();
    const base = { command, runner: `codex-sandbox@${env.id}`, durationMs: 0, exitCode: null, counts: {}, failures: [], outputTail: "" };
    if (!isAllowedCommand(command)) return Promise.resolve({ ...base, status: "BLOCKED", reason: "comandă în afara listei acceptate", isolation: "none" });
    const argv = wslCommandArgv(command, env);
    const binary = resolveWsl(config); // wsl.exe (or the test fixture): the environment's launcher
    if (!argv || !binary) return Promise.resolve({ ...base, status: "BLOCKED", reason: "comanda sau wsl.exe nu pot fi pregătite", isolation: "none" });
    const wsId = `rn-${crypto.createHash("sha256").update(`${key}:${started}`).digest("hex").slice(0, 16)}`;
    return (async () => {
      // The environment as it is now (an inspection older than 10 min is repeated): a changed fingerprint blocks the command.
      const last = environment.state();
      if (!last?.inspectedAt || Date.now() - new Date(last.inspectedAt).getTime() > 10 * 60000) await environment.inspect().catch(() => {});
      const ready = readiness(project);
      if (!ready.ok) return { ...base, status: "BLOCKED", reason: ready.detail, isolation: ready.isolation };
      let prepared;
      const copyAbort = new AbortController();
      aborts.set(key, copyAbort);
      try { prepared = await environment.prepareWorkspace({ id: wsId, projectRoot, projectId: project?.id || "", purpose: "runner", signal: copyAbort.signal }); }
      catch (error) { return { ...base, status: "BLOCKED", reason: `copia proiectului în ${env.id} a eșuat: ${String(error.message).slice(0, 200)}`, isolation: ready.isolation, durationMs: Date.now() - started }; }
      finally { aborts.delete(key); }
      owned.set(key, wsId);
      // A Stop / Pause during the copy: the command never starts (the caller records it as interrupted).
      if (shouldStop() || copyAbort.signal.aborted) {
        owned.delete(key);
        await environment.release(wsId).catch(() => {});
        return { ...base, status: "BLOCKED", reason: "oprit înainte de pornirea comenzii", isolation: ready.isolation, durationMs: Date.now() - started };
      }
      const out = [];
      let timedOut = false;
      try {
        const vars = { TMPDIR: prepared.tmp, IFRIM_RUN: wsId, NODE_ENV: "test", CI: "1", NODE_OPTIONS: TEST_NODE_OPTIONS, npm_config_cache: `${prepared.tmp}/npm-cache`, npm_config_update_notifier: "false" };
        let record;
        try {
          record = supervisor.start({ key, label: `runner@${env.id}: ${command}`, executable: binary.executable,
            args: [...binary.prefixArgs, ...wslArgs(env, { cwd: prepared.repo, argv: [env.codex, "sandbox", "-P", profile, "-C", prepared.repo, "--", ...argv], vars })],
            cwd: config.hubRoot, onStdoutLine: (line) => { out.push(redactText(line).slice(0, 500)); if (out.length > OUTPUT_LINES) out.shift(); } });
        } catch (error) { return { ...base, status: "BLOCKED", reason: `runner-ul nu a pornit: ${error.message}`, isolation: ready.isolation }; }
        const timer = setTimeout(() => { timedOut = true; supervisor.stop(key, { graceMs: 500 }).catch(() => {}); }, timeoutMs);
        timer.unref?.();
        const exit = await record.exit;
        clearTimeout(timer);
        supervisor.forget(key);
        const lines = [...out, ...record.stderrTail.map((l) => `[stderr] ${l}`)];
        const { counts, failures } = parseTestOutput(lines);
        let verdict = testStatus({ exitCode: exit.code, counts, timedOut });
        if (verdict.status !== "PASS" && environmentBlocked(lines)) {
          verdict = { status: "BLOCKED", reason: `sandbox-ul Linux din ${env.id} refuză socket-urile și procesele copil cu pipe-uri (rețea oprită); testul are nevoie de ele — decizie separată (profil doar-local sau runner dedicat)` };
        }
        return { ...base, ...verdict, exitCode: exit.code, counts, failures, durationMs: Date.now() - started, outputTail: lines.slice(-120).join("\n"), isolation: ready.isolation };
      } finally {
        owned.delete(key);
        await environment.release(wsId).catch(() => {});
      }
    })();
  }

  async function startPreview() {
    return { status: "BLOCKED", isolation: "none",
      reason: `Preview-ul nu rulează în ${env.id}: sandbox-ul Linux cu rețeaua oprită refuză orice socket (EPERM la listen, măsurat pe Codex 0.159.2). Rămâne pe ruta Windows sau cere o decizie separată (profil de rețea doar-local / runner bwrap dedicat).` };
  }

  async function stop(key) {
    aborts.get(key)?.abort();
    const result = await supervisor.stop(key, { graceMs: 500 });
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

  return { environment: env.id, readiness, run, startPreview, stop, preflight };
}
