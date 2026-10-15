import { execFile } from "node:child_process";
import { HubError } from "../core/errors.mjs";
import { parse } from "../storage/db.mjs";
import { suspendGateForRetainedLeases, RUNTIME_LEASE_SUSPENSION } from "./recovery.mjs";

/**
 * 2.12.2 (owner requirement P0-R1): workspace leases retained after Stop All or a restart. Before it, runs.finalize kept a lease
 * whenever the provider process did not confirm its exit, boot recovery kept every lease of a run active at the restart (even with its
 * PID gone), and nothing owner-facing ever released them: the rearm card refused with LEASES and the gate could stay closed for good.
 *
 * A retained lease is released here (leases.reconcile → lease.released + lease.reconciled { leaseId, runId, verdict, evidence }) only
 * when ALL hold:
 *  - its run is in a terminal status (completed / failed / interrupted / blocked / interrupted_unknown / orphaned) — a run still
 *    starting, running or waiting for an approval, or one this Hub still runs, is never touched ("still_held");
 *  - the provider process is provably gone: its supervisor record (this Hub process's own child) exited — the same evidence a run's
 *    normal end uses — and, for an environment run, the run's own reap evidence says its in-distro processes were ended (never wsl.exe
 *    from here; an unknown reap stays "unknown").
 *  - Review R1-F2: a Windows provider this Hub process did NOT supervise (no supervisor record: a run of another boot, the crash case)
 *    whose recorded PID is dead, or now belongs to another process, proves only that the provider itself is gone. Windows does not end
 *    a process's children with it (libuv's kill-on-close job only reaches the Hub's direct children; theirs break away), so a command
 *    the provider started (a test run, a dev server) may still write into the workspace. That lease is "unknown" (treeUnknown): never
 *    released by itself, only by the owner's acknowledgement on the card — or after the card's own tree-kill of the live, Hub-tied PID.
 * Inference-free and bounded: a follow-up after lease.retained (FOLLOW_UP_MS), the boot pass (system.recovered) and the scheduler tick
 * (hub.mjs). It never relaunches, never marks a run completed, never changes a factory, plan or task state.
 * Review F3: a lease still unproven when its follow-up ends, with the gate OPEN, suspends the gate (escalate → recovery.mjs
 * RUNTIME_LEASE_SUSPENSION) — the card below is shown only for a suspended gate. It only ever closes the gate, never opens it.
 *
 * What cannot be proven stays for the owner's rearm card (owner/gate-rearm.mjs), as a step INCLUDED in that one decision:
 *  - "process_alive": an orphaned process the Hub's own records tie to that run — its supervisor record, or agent_runs.pid whose
 *    process start matches the recorded spawn (START_TOLERANCE_MS) — is stopped (terminateOrphan, owner session only; tree-kill), then
 *    the lease released. Never an arbitrary PID: the start evidence is read again right before a PID kill;
 *  - "unknown": released only with the owner's explicit acknowledgement bound into the card (ackLeases), after stopping a Hub-tied
 *    process if there is one.
 */
export const TERMINAL_RUN_STATUSES = Object.freeze(["completed", "failed", "interrupted", "blocked", "interrupted_unknown", "orphaned"]);
export const VERDICTS = Object.freeze(["released", "still_held", "process_alive", "unknown"]);
/** The bounded follow-up after a lease is retained (then the scheduler tick takes over). */
export const FOLLOW_UP_MS = Object.freeze([2000, 10000, 30000]);
/** A live PID is the run's process only when the OS start time falls in [pid_started_at − before, pid_started_at + after]. */
export const START_TOLERANCE_MS = Object.freeze({ before: 120000, after: 5000 });
/** The owner's acknowledgement for a lease whose outcome cannot be proven (the card's checkbox; web/src/lib/rearmLogic.js). */
export const LEASES_ACK_LABEL = "Am înțeles, eliberează spațiul de lucru";

const TERMINAL = new Set(TERMINAL_RUN_STATUSES);
const LIVE = new Set(["starting", "running", "waiting_approval"]);
const MAX_SWEEP = 100;
const MAX_VERIFY_AT_ONCE = 3;
const VERIFY_RETRY_MS = 5 * 60000;
const GONE_WAIT_MS = 8000;
const MAX_FOLLOWED = 200;
const PROVIDER_LABEL = Object.freeze({ codex: "Codex", claude: "Claude" });

const validPid = (pid) => Number.isInteger(pid) && pid > 0 && pid < 2 ** 31;
const sleep = (ms) => new Promise((resolve) => { const t = setTimeout(resolve, ms); t.unref?.(); });

function execText(file, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, timeout: timeoutMs, maxBuffer: 64 * 1024 }, (error, stdout) => (error ? reject(error) : resolve(String(stdout || ""))));
  });
}

/** The first non-empty line of a process start query, as an ISO date (null when it is not a date). */
export function parseCreationDate(text) {
  const line = String(text || "").split(/\r?\n/).map((l) => l.trim()).find(Boolean) || "";
  const ms = Date.parse(line);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** true / false when both times are known; null when either is missing (cannot be decided). */
export function startEvidenceMatches({ processStartedAt, pidStartedAt, tolerance = START_TOLERANCE_MS } = {}) {
  const p = Date.parse(String(processStartedAt || ""));
  const r = Date.parse(String(pidStartedAt || ""));
  if (!Number.isFinite(p) || !Number.isFinite(r)) return null;
  return p >= r - tolerance.before && p <= r + tolerance.after;
}

/**
 * The OS facts the reconciler reads. alive(pid) is a signal-0 check (never kills); startTime(pid) asks Windows for the process creation
 * time (CIM, read-only); kill(pid) ends the process tree (taskkill /T /F). In test mode — as the supervisor refuses binaries outside the
 * fixtures — no PowerShell or taskkill is ever started: startTime is unknown and a kill by PID is refused (tests inject a fake probe).
 * Outside Windows the start time is unknown (the Hub runs on Windows; an unknown start never allows a PID kill).
 */
export function createProcessProbe({ testMode = false, platform = process.platform, run = execText } = {}) {
  function alive(pid) {
    if (!validPid(pid)) return false;
    try { process.kill(pid, 0); return true; } catch (error) { return error?.code === "EPERM"; }
  }
  async function startTime(pid) {
    if (!validPid(pid) || testMode || platform !== "win32") return null;
    // Single quotes only: the argument reaches PowerShell unchanged through Windows argv quoting.
    const script = `$p = Get-CimInstance -ClassName Win32_Process -Filter 'ProcessId = ${pid}' -ErrorAction SilentlyContinue; if ($p -and $p.CreationDate) { $p.CreationDate.ToUniversalTime().ToString('o') }`;
    const out = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], 15000).catch(() => null);
    return out === null ? null : parseCreationDate(out);
  }
  async function kill(pid) {
    if (!validPid(pid)) return { ok: false, error: "PID invalid" };
    if (testMode) return { ok: false, error: "modul de test nu oprește procese după PID" };
    if (platform === "win32") {
      const out = await run("taskkill", ["/PID", String(pid), "/T", "/F"], 10000).then(() => null, (error) => String(error?.message || error).slice(0, 200));
      return { ok: out === null, error: out };
    }
    try { process.kill(pid, "SIGKILL"); return { ok: true, error: null }; } catch (error) { return { ok: false, error: String(error?.message || error).slice(0, 200) }; }
  }
  return { kind: testMode ? "system:test" : "system", alive, startTime, kill };
}

/**
 * The reconciler. `subscribe` (the Hub's own instance) follows lease.retained and the boot's system.recovered; a private instance (a
 * partial hub, a reader) does not. `probe` replaces the OS probe (tests).
 */
export function createLeaseReconciler(hub, { subscribe = true, probe = null } = {}) {
  const { db, bus, leases } = hub;
  const clock = hub.config?.now || (() => new Date());
  let processProbe = probe || createProcessProbe({ testMode: Boolean(hub.config?.testMode) });
  const startEvidence = new Map(); // leaseId → { pid, startedAt, match: true|false|null, checkedAt }
  const processKeys = new Map(); // leaseId → supervisor key (from lease.retained)
  const followed = new Map(); // leaseId → timers
  const verifying = new Map(); // leaseId → Promise (one start-time query at a time per lease)
  const terminating = new Map(); // leaseId → Promise (one termination at a time per lease: never a double kill)
  const stats = { checks: 0, sweeps: 0, verifies: 0, kills: 0, released: 0, lastWorkAt: null };
  const work = () => { stats.lastWorkAt = Date.now(); };

  const runQuery = db.prepare(`SELECT r.id, r.provider, r.status, r.pid, r.pid_started_at, r.started_at, r.created_at, r.environment, r.evidence_json, p.name AS project_name
    FROM agent_runs r LEFT JOIN conversations c ON c.id = r.conversation_id LEFT JOIN projects p ON p.id = c.project_id WHERE r.id = ?`);
  const runOf = (id) => (id ? runQuery.get(String(id)) || null : null);
  const activeRunIds = () => { try { return new Set((hub.runs?.activeRuns?.() || []).map((r) => r.runId)); } catch { return new Set(); } };
  const labelOf = (run) => {
    const env = run.environment && run.environment !== "windows" ? ` (${run.environment})` : "";
    return `${PROVIDER_LABEL[run.provider] || run.provider || "execuție"}${env}${run.project_name ? ` · ${String(run.project_name).slice(0, 80)}` : ""}`;
  };
  const spawnedAt = (run) => run?.pid_started_at || run?.started_at || run?.created_at || null;
  const expired = (lease) => Date.parse(String(lease.expires_at || "")) <= clock().getTime();
  /** Retained leases and stale ACTIVE run leases (TTL passed, run_id set): the only ones ever considered. */
  const candidates = () => db.prepare("SELECT * FROM leases WHERE status = 'retained' OR (status = 'active' AND run_id IS NOT NULL AND expires_at <= ?) ORDER BY acquired_at LIMIT ?")
    .all(clock().toISOString(), MAX_SWEEP);

  /** The verdict for one lease row, from the Hub's own facts only. Writes nothing. */
  function assess(lease) {
    const base = { leaseId: lease.id, runId: lease.run_id || null, status: lease.status };
    if (lease.status === "released") return { ...base, verdict: "released", releasable: false, reason: "rezervarea e deja eliberată", evidence: {} };
    // An ACTIVE lease is someone's current reservation; only a stale one (TTL passed) of a finished run is ever reconciled.
    if (lease.status === "active" && !expired(lease)) return { ...base, verdict: "still_held", reason: "rezervarea e activă", evidence: { leaseStatus: "active" } };
    if (!lease.run_id) return { ...base, verdict: "unknown", tie: null, pid: null, label: "fără execuție", reason: "rezervarea nu e legată de nicio execuție înregistrată", evidence: { run: null } };
    const run = runOf(lease.run_id);
    if (!run) return { ...base, verdict: "unknown", tie: null, pid: null, label: String(lease.run_id).slice(0, 40), reason: "execuția rezervării nu mai există în baza de date", evidence: { run: "missing" } };
    const label = labelOf(run);
    const env = run.environment || "windows";
    const evidence = { runStatus: run.status, environment: env };
    // A run the Hub still runs, or one that still looks live, is never touched: its own turn (or the next boot) ends it.
    const inManager = activeRunIds().has(run.id);
    if (inManager || LIVE.has(run.status)) return { ...base, label, verdict: "still_held", reason: `execuția „${label}” figurează încă în lucru (${run.status})`, evidence: { ...evidence, active: inManager } };
    if (!TERMINAL.has(run.status)) return { ...base, label, verdict: "unknown", tie: null, pid: null, reason: `starea execuției („${run.status}”) nu e una finală`, evidence };
    // A stale ACTIVE lease counts only when it is that run's own lease (never a factory, computer or handoff lock).
    if (lease.status === "active" && !String(lease.holder || "").endsWith(`:${run.id}`)) return { ...base, label, verdict: "still_held", reason: "rezervarea aparține altui deținător", evidence };

    // The Windows-side process: the provider, or wsl.exe for an environment run.
    const key = processKeys.get(lease.id) || `run-${run.id}`;
    let record = null;
    try { record = hub.supervisor?.get?.(key) || null; } catch { record = null; }
    const pid = Number(run.pid) || null;
    let proc;
    if (record && !record.exited) proc = { state: "alive", tie: "supervisor", pid: record.pid || pid, key };
    else if (record) proc = { state: "gone", pid: record.pid || pid, why: "supervisor_exited" };
    else if (!pid) proc = { state: "none", pid: null };
    else if (!processProbe.alive(pid)) proc = { state: "gone", pid, why: "pid_not_alive" };
    else {
      const cached = startEvidence.get(lease.id);
      const known = cached && cached.pid === pid ? cached : null;
      if (known?.match === true) proc = { state: "alive", tie: "pid", pid, startedAt: known.startedAt };
      else if (known?.match === false) proc = { state: "gone", pid, why: "pid_reused", startedAt: known.startedAt };
      else proc = { state: "unverified", pid };
    }
    evidence.process = { state: proc.state, pid: proc.pid || null, tie: proc.tie || null, why: proc.why || null,
      ...(proc.startedAt ? { processStartedAt: proc.startedAt, pidStartedAt: spawnedAt(run) } : {}) };
    const tie = proc.state === "alive" ? proc.tie : proc.state === "unverified" ? "unverified" : null;

    // An environment run: its in-distro processes must have been confirmed gone by the run's own reap (never checked from here).
    if (env !== "windows") {
      const reap = parse(run.evidence_json, {})?.environment?.reap || null;
      evidence.reap = reap ? { ok: reap.ok === true, remaining: Number.isFinite(Number(reap.remaining)) ? Number(reap.remaining) : null } : null;
      if (reap?.ok !== true) {
        return { ...base, label, verdict: "unknown", tie, pid: tie ? proc.pid : null, key: proc.key || null, needsVerify: tie === "unverified",
          reason: `procesele din mediul ${env} nu au fost confirmate ca oprite (${reap ? "curățarea lor a eșuat" : "curățarea lor nu a rulat"})`, evidence };
      }
      // The reap ran after the run's app-server was stopped (codex-wsl.mjs): with no Windows-side process on record, nothing is left.
      if (proc.state === "none") proc = { state: "gone", pid: null, why: "reaped" };
      evidence.process.state = proc.state;
      evidence.process.why = proc.why || evidence.process.why;
    }
    if (proc.state === "alive") return { ...base, label, verdict: "process_alive", tie: proc.tie, pid: proc.pid, key: proc.key || null, reason: `procesul pornit de Hub (PID ${proc.pid}) încă rulează`, evidence };
    // Review R1-F2: a Windows provider this Hub process never supervised (another boot) — its own end proves nothing about the commands
    // it started. Unknown: the owner's acknowledgement on the card, never a release by itself (no PID to stop: tie null).
      if (proc.state === "gone" && env === "windows" && (proc.why !== "supervisor_exited" || record?.treeUnverified)) {
      evidence.process.tree = "unknown";
      return { ...base, label, verdict: "unknown", tie: null, pid: null, treeUnknown: true,
        reason: proc.why === "pid_reused"
          ? `procesul providerului s-a oprit (PID-ul ${proc.pid} aparține acum altui proces), dar nu l-a oprit acest Hub: comenzile pornite de el (teste, servere) pot rula încă`
          : `procesul providerului (PID ${proc.pid}) nu mai rulează, dar nu l-a oprit acest Hub (a repornit în timpul execuției): comenzile pornite de el (teste, servere) pot rula încă`,
        evidence };
    }
    if (proc.state === "gone") return { ...base, label, verdict: "released", releasable: true, pid: proc.pid,
      reason: proc.why === "pid_reused" ? `PID-ul ${proc.pid} aparține acum altui proces: procesul execuției s-a oprit` : "procesul execuției nu mai rulează", evidence };
    if (proc.state === "unverified") return { ...base, label, verdict: "unknown", tie: "unverified", pid: proc.pid, needsVerify: true,
      reason: `PID-ul ${proc.pid} e încă folosit, dar nu pot verifica (încă) dacă e procesul pornit de Hub`, evidence };
    return { ...base, label, verdict: "unknown", tie: null, pid: null, reason: "Hub-ul nu are PID-ul procesului acestei execuții", evidence };
  }

  function forget(leaseId) {
    const timers = followed.get(leaseId);
    if (timers) for (const timer of timers) clearTimeout(timer);
    followed.delete(leaseId);
    startEvidence.delete(leaseId);
    processKeys.delete(leaseId);
  }

  /** Releases a lease that is provably free (CAS in leases.reconcile). True only when this call released it. */
  function releaseNow(lease, a, why, extra = {}) {
    const changed = bus.transaction(() => leases.reconcile(lease.id, { reason: why, verdict: extra.verdict || "released", evidence: { ...a.evidence, ...(extra.evidence || {}) }, from: [lease.status] }));
    if (changed) { stats.released += 1; forget(lease.id); }
    return changed;
  }

  /** One lease: released when provably free; a stale active lease whose process may still run becomes retained (the card shows it). */
  function check(leaseId, { reason = "check" } = {}) {
    stats.checks += 1; work();
    const lease = leases.get(leaseId);
    if (!lease) return { leaseId, runId: null, verdict: "released", changed: false, reason: "rezervarea nu mai există", evidence: {} };
    const a = assess(lease);
    if (a.releasable) return { ...a, verdict: "released", changed: releaseNow(lease, a, `reconciled (${reason}): ${a.reason}`) };
    if (lease.status === "active" && (a.verdict === "process_alive" || a.verdict === "unknown")) {
      bus.transaction(() => leases.retain(lease.id, `stale lease of finished run ${lease.run_id}: ${a.reason}`.slice(0, 300), { processKey: a.key || null }));
    }
    return { ...a, changed: false };
  }

  const slim = (a) => ({ leaseId: a.leaseId, runId: a.runId, verdict: a.verdict, reason: a.reason, ...(a.pid ? { pid: a.pid } : {}), ...(a.tie ? { tie: a.tie } : {}) });

  /** Every candidate once (synchronous, cheap: database rows, the supervisor's records, signal-0 checks, cached start evidence). */
  function sweep({ reason = "sweep" } = {}) {
    stats.sweeps += 1; work();
    const rows = candidates();
    const released = [];
    const remaining = [];
    for (const lease of rows) {
      let out;
      try { out = check(lease.id, { reason }); }
      catch (error) { out = { leaseId: lease.id, runId: lease.run_id || null, verdict: "unknown", reason: `verificarea a eșuat: ${String(error?.message || error).slice(0, 160)}`, evidence: {} }; }
      if (out.verdict === "released") { if (out.changed) released.push(slim(out)); continue; }
      remaining.push(out);
    }
    return { reason, checked: rows.length, released, remaining };
  }

  /** The start time of a live recorded PID, compared with the run's spawn (async: a CIM query). One query per lease at a time. */
  function verify(leaseId) {
    if (verifying.has(leaseId)) return verifying.get(leaseId);
    const asked = processProbe; // an answer of a probe replaced meanwhile is never cached (useProbe)
    const pending = (async () => {
      stats.verifies += 1; work();
      const lease = leases.get(leaseId);
      if (!lease) return null;
      const run = lease.run_id ? runOf(lease.run_id) : null;
      const pid = Number(run?.pid) || null;
      if (lease.status !== "released" && pid && asked.alive(pid)) {
        const startedAt = await Promise.resolve().then(() => asked.startTime(pid)).catch(() => null);
        const match = startedAt ? startEvidenceMatches({ processStartedAt: startedAt, pidStartedAt: spawnedAt(run) }) : null;
        if (asked === processProbe) startEvidence.set(leaseId, { pid, startedAt: startedAt || null, match, checkedAt: Date.now() });
      }
      return check(leaseId, { reason: "verify" });
    })().finally(() => { if (verifying.get(leaseId) === pending) verifying.delete(leaseId); });
    verifying.set(leaseId, pending);
    return pending;
  }
  /** A bounded number of start-time checks for the leases that need one (an undecidable answer is asked again after VERIFY_RETRY_MS). */
  function kickVerify(list, { force = false } = {}) {
    const due = (list || []).filter((a) => a?.needsVerify).filter((a) => {
      const cached = startEvidence.get(a.leaseId);
      return force || !cached || cached.pid !== a.pid || Date.now() - cached.checkedAt >= VERIFY_RETRY_MS;
    }).slice(0, MAX_VERIFY_AT_ONCE);
    return due.map((a) => verify(a.leaseId).catch(() => null));
  }

  /**
   * Review F3 (2.12.2): the follow-up is over and the lease is still retained — its outcome unknown (a failed reap), or a Hub-tied process
   * still alive. With the gate OPEN nothing would show the owner a way to release it (the rearm card exists for a suspended gate), so the
   * gate is suspended (recovery.mjs RUNTIME_LEASE_SUSPENSION: compare-and-set on the open gate, one transaction); a suspended gate keeps
   * its own record. Nothing is stopped, resumed or relaunched. → the suspension's result, or { suspended: false, reason }.
   */
  function escalate(leaseId) {
    const lease = leases.get(leaseId);
    if (!lease || lease.status !== "retained") return { suspended: false, reason: "not_retained" };
    const a = assess(lease);
    if (a.releasable) return check(leaseId, { reason: "escalate" }).verdict === "released" ? { suspended: false, reason: "released" } : { suspended: false, reason: a.verdict };
    if (a.verdict !== "unknown" && a.verdict !== "process_alive") return { suspended: false, reason: a.verdict };
    if (!hub.settings) return { suspended: false, reason: "no_settings" };
    return suspendGateForRetainedLeases({ db, bus, clock, settings: hub.settings, origin: RUNTIME_LEASE_SUSPENSION });
  }

  /** The bounded follow-up after a lease was retained: checks at FOLLOW_UP_MS, then the escalation (review F3). Timers only. */
  function followUp(leaseId, { delaysMs = FOLLOW_UP_MS } = {}) {
    if (!leaseId || followed.has(leaseId) || followed.size >= MAX_FOLLOWED) return false;
    const timers = [];
    followed.set(leaseId, timers);
    delaysMs.forEach((ms, index) => {
      const timer = setTimeout(() => {
        try {
          const lease = leases.get(leaseId);
          if (!lease || lease.status !== "retained") { forget(leaseId); return; }
          const out = check(leaseId, { reason: "follow-up" });
          if (out.verdict === "released") return;
          const verifying = out.needsVerify ? kickVerify([out]) : [];
          if (index === delaysMs.length - 1) {
            followed.delete(leaseId);
            // Review F3: still reserved after the last check (and its start-time check, if one was due): the owner's card, via the gate.
            Promise.all(verifying).then(() => escalate(leaseId)).catch(() => { /* the database is closing: the boot pass decides next time */ });
          }
        } catch { /* the database is closing, or a transient error: the scheduler tick tries again */ }
      }, ms);
      timer.unref?.();
      timers.push(timer);
    });
    return true;
  }

  /**
   * The scheduler tick: one sweep, then a bounded number of start-time checks. Review F3: a retained lease no follow-up watches any more
   * (its follow-up ended while the gate was closed, or was never scheduled) and still unproven escalates the same way.
   */
  async function tick() {
    const s = sweep({ reason: "tick" });
    await Promise.all(kickVerify(s.remaining));
    const stuck = s.remaining.filter((a) => a.status === "retained" && (a.verdict === "unknown" || a.verdict === "process_alive") && !followed.has(a.leaseId));
    if (stuck.length && (hub.settings?.get?.("executionGate") || {}).status === "open") { try { escalate(stuck[0].leaseId); } catch { /* the next tick tries again */ } }
    return { checked: s.checked, released: s.released.length, remaining: s.remaining.length };
  }

  /** A card step (owner/gate-rearm.mjs) for a lease the owner's decision must include. */
  function stepOf(a) {
    const ack = a.verdict !== "process_alive";
    let text;
    if (a.verdict === "process_alive") text = `Opresc procesul rămas al execuției „${a.label}” (PID ${a.pid}, pornit de Hub) și eliberez spațiul de lucru.`;
    else if (a.tie === "supervisor" || a.tie === "pid") text = `Nu pot dovedi că execuția „${a.label}” s-a oprit de tot: ${a.reason}. Cu „${LEASES_ACK_LABEL}” opresc procesul rămas (PID ${a.pid}, pornit de Hub) și eliberez spațiul de lucru.`;
    else if (a.tie === "unverified") text = `Nu pot dovedi că execuția „${a.label}” s-a oprit: ${a.reason}. Cu „${LEASES_ACK_LABEL}” verific întâi PID-ul: îl opresc doar dacă e procesul pornit de Hub, altfel eliberez spațiul de lucru fără să opresc nimic.`;
    else text = `Nu pot dovedi că execuția „${a.label}” s-a oprit: ${a.reason}. Cu „${LEASES_ACK_LABEL}” eliberez spațiul de lucru fără să opresc vreun proces (nu am niciunul legat sigur de Hub).`;
    return { leaseId: a.leaseId, runId: a.runId || null, verdict: a.verdict, tie: a.tie || null, pid: a.pid || null, label: a.label || null, reason: a.reason, ack, text };
  }

  /**
   * What the owner's rearm card must include: { steps, held }. `write` (the card, the rearm): a sweep first (provably free leases are
   * released now) and a bounded start-time check in the background; otherwise (eligibility, a read) nothing is written and a provably
   * free lease is simply not listed (the next sweep releases it).
   */
  function pendingSteps({ write = true, reason = "rearm" } = {}) {
    let list;
    if (write) {
      list = sweep({ reason }).remaining;
      kickVerify(list);
    } else {
      list = candidates().map((lease) => { try { return assess(lease); } catch (error) { return { leaseId: lease.id, runId: lease.run_id || null, verdict: "unknown", reason: String(error?.message || error).slice(0, 160), evidence: {} }; } })
        .filter((a) => !a.releasable && a.verdict !== "released");
    }
    const held = list.filter((a) => a.verdict === "still_held").map((a) => ({ ...slim(a), label: a.label || null }));
    const steps = list.filter((a) => a.verdict === "process_alive" || a.verdict === "unknown").map(stepOf);
    return { steps, held };
  }

  async function waitGone(pid) {
    for (let waited = 0; waited < GONE_WAIT_MS; waited += 100) {
      if (!processProbe.alive(pid)) return true;
      await sleep(100);
    }
    return !processProbe.alive(pid);
  }

  /**
   * The owner's included step (owner session only; called by the rearm after its fresh verification): stops an orphaned process the
   * Hub's own records tie to this lease's run — its supervisor record (tree-kill), or its recorded PID with matching start evidence, read
   * again right before the kill — and releases the lease once the process is gone. A lease whose outcome stays unknown is released only
   * with `ack` (the owner's acknowledgement on the card). One termination per lease at a time: a second call shares the first.
   * Review R1-F1: `ack` is the acknowledgement of THIS step (the rearm passes it only for a step that asked for it), and `expected` is
   * what the card showed for it ({ verdict, tie }; default: this lease's state when the call starts). A step that promised to stop a
   * Hub-tied process ("process_alive", or a supervisor / PID tie) and stopped nothing — e.g. the start time could not be read again
   * right before the kill — is never released: LEASE_STATE_CHANGED (the rearm shows a new card that says what is true now).
   */
  function terminateOrphan(leaseId, { ownerSession = null, ack = false, expected = null } = {}) {
    const s = hub.trust.requireSession(ownerSession, "oprirea procesului rămas al unei execuții");
    if (terminating.has(leaseId)) return terminating.get(leaseId);
    const by = `owner:${s.id}`;
    const pending = (async () => {
      const done = (extra) => ({ leaseId, released: true, terminated: false, pid: null, ...extra });
      const first = leases.get(leaseId);
      if (!first || first.status === "released") return done({ runId: first?.run_id || null, already: true });
      let a = assess(first);
      const shown = expected && typeof expected === "object" ? expected : { verdict: a.verdict, tie: a.tie || null };
      const promisedStop = shown.verdict === "process_alive" || shown.tie === "supervisor" || shown.tie === "pid";
      if (a.verdict === "still_held") throw new HubError("conflict", `Nu ating execuția „${a.label || a.runId || "?"}”: ${a.reason}.`, { data: { code: "LEASE_HELD", leaseId } });
      if (a.tie === "unverified") {
        await verify(leaseId);
        const again = leases.get(leaseId);
        if (!again || again.status === "released") return done({ runId: a.runId });
        a = assess(again);
      }
      let terminated = false;
      let killedPid = null;
      let treeStopped = false, stopResult = null;
      if (!a.releasable && a.tie === "supervisor" && a.key) {
        // The Hub's own child: the supervisor ends the whole tree (taskkill /T on Windows) and waits for its exit.
        stats.kills += 1; work();
        stopResult = await hub.supervisor.stop(a.key, { graceMs: 0 });
        terminated = stopResult?.stopped === true;
        treeStopped = terminated && stopResult.method === "taskkill" && stopResult.taskkill?.ok === true;
        killedPid = terminated ? a.pid || null : null;
        if (!terminated || (stopResult.method === "handle" && stopResult.taskkill?.ok !== true)) {
          throw new HubError("conflict", "Oprirea arborelui de procese nu este confirmată; spațiul de lucru rămâne rezervat.",
            { data: { code: "LEASE_STATE_CHANGED", leaseId, stopResult } });
        }
      } else if (!a.releasable && a.tie === "pid" && a.pid) {
        // A recorded PID (another boot): its start evidence is read again right before the kill — a PID reused since is never killed.
        const run = runOf(a.runId);
        const startedAt = await Promise.resolve().then(() => processProbe.startTime(a.pid)).catch(() => null);
        const match = startedAt ? startEvidenceMatches({ processStartedAt: startedAt, pidStartedAt: spawnedAt(run) }) : null;
        startEvidence.set(leaseId, { pid: a.pid, startedAt: startedAt || null, match, checkedAt: Date.now() });
        if (match === true) {
          stats.kills += 1; work();
          await processProbe.kill(a.pid);
          terminated = true; killedPid = a.pid;
          await waitGone(a.pid);
          treeStopped = true;
        }
      }
      const now = leases.get(leaseId);
      if (!now || now.status === "released") return done({ runId: a.runId, terminated, pid: killedPid });
      const after = assess(now);
      const evidence = { terminated, ...(killedPid ? { killedPid } : {}), ...(stopResult ? { stopResult } : {}), by };
      if (after.releasable) {
        releaseNow(now, after, `${terminated ? "process stopped, " : ""}reconciled by the owner's rearm (${by}): ${after.reason}`.slice(0, 300), { evidence });
        return done({ runId: a.runId, terminated, pid: killedPid });
      }
      // R1-F2: the tree-kill just ran on the live, Hub-tied provider (taskkill /T while it was alive): what it had started went with it.
      if (treeStopped && after.treeUnknown) {
        releaseNow(now, after, `process tree stopped by the owner's rearm (${by}, tree-kill while it was alive)`.slice(0, 300), { evidence: { ...evidence, tree: "tree-kill" } });
        return done({ runId: a.runId, terminated, pid: killedPid });
      }
      // R1-F1: the card promised to stop a Hub-tied process and nothing was stopped: never released (an acknowledgement given for
      // another step, or a degraded state, never stands in for that stop) — the owner gets a new card that says what is true now.
      if (promisedStop && !terminated) {
        throw new HubError("conflict", `Nu am putut opri procesul rămas al execuției „${after.label || a.label || after.runId || "?"}”${a.pid ? ` (PID ${a.pid})` : ""}: nu l-am mai putut verifica chiar înainte de oprire (${after.reason}); spațiul de lucru rămâne rezervat.`,
          { data: { code: "LEASE_STATE_CHANGED", leaseId, verdict: after.verdict } });
      }
      if (after.verdict === "unknown" && ack === true) {
        releaseNow(now, after, `released with the owner's acknowledgement (${by}), outcome unknown: ${after.reason}`.slice(0, 300), { verdict: "acknowledged", evidence: { ...evidence, ack: true } });
        return done({ runId: a.runId, terminated, pid: killedPid, acknowledged: true });
      }
      if (after.verdict === "unknown") {
        throw new HubError("conflict", `Nu pot dovedi că execuția „${after.label || after.runId || "?"}” s-a oprit (${after.reason}); fără confirmarea ta („${LEASES_ACK_LABEL}”) spațiul de lucru rămâne rezervat.`,
          { data: { code: "LEASE_STATE_CHANGED", leaseId, verdict: after.verdict } });
      }
      throw new HubError("conflict", `Nu am putut opri procesul rămas al execuției „${after.label || after.runId || "?"}”${after.pid ? ` (PID ${after.pid})` : ""}; spațiul de lucru rămâne rezervat și poarta rămâne oprită.`,
        { data: { code: "LEASE_TERMINATE_FAILED", leaseId, verdict: after.verdict } });
    })().finally(() => terminating.delete(leaseId));
    terminating.set(leaseId, pending);
    return pending;
  }

  if (subscribe) {
    bus.subscribe((event) => {
      if (event.type === "lease.retained" && event.payload?.leaseId) {
        // Timers only: nothing here may delay the writer (a Stop All among them).
        if (event.payload.processKey) processKeys.set(event.payload.leaseId, String(event.payload.processKey).slice(0, 120));
        followUp(event.payload.leaseId);
      } else if (event.type === "system.recovered") {
        // The boot pass: leases retained before this boot whose run is finished and whose process is gone are released now; a PID that is
        // still alive gets its start evidence read in the background (never killed here).
        try { kickVerify(sweep({ reason: "boot" }).remaining); } catch { /* the scheduler tick tries again */ }
      }
    });
  }

  return {
    /** The verdict for a lease id without writing anything (null when the lease does not exist). */
    assess: (leaseId) => { const lease = leases.get(leaseId); return lease ? assess(lease) : null; },
    check, sweep, verify, tick, followUp, escalate, pendingSteps, terminateOrphan,
    /** Replaces the OS probe (tests); clears the cached start evidence. Returns the restore function. */
    useProbe(next) {
      const swap = (probe) => { processProbe = probe; startEvidence.clear(); verifying.clear(); };
      const previous = processProbe;
      swap(next);
      return () => swap(previous);
    },
    stats: () => ({ ...stats, followed: followed.size, verifying: verifying.size, terminating: terminating.size }),
  };
}
