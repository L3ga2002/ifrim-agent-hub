import { isPidAlive } from "./supervisor.mjs";
import { transitionTask } from "./state-machine.mjs";
import { nextSuspension, classifySuspension } from "../policy/gate-state.mjs";

/**
 * 2.12.2 (D1): the origin the boot records when it suspends an OPEN gate over a workspace the restart left reserved. Kind "shutdown"
 * (the Hub stopped with work in flight; precedence keeps a Stop All or a security record) and channel "recovery" — the owner's words
 * come from policy/gate-state.mjs (SUSPENSION_LABELS.shutdown „oprirea Hub-ului”, CHANNEL_LABELS.recovery „la repornirea Hub-ului”).
 */
export const RECOVERY_SUSPENSION = Object.freeze({ kind: "shutdown", channel: "recovery", actor: "recovery" });
const PROVIDER_LABEL = Object.freeze({ codex: "Codex", claude: "Claude" });
/** At most this many lease / run ids are copied into the suspension record and its event (the card lists every lease itself). */
const MAX_RECORDED = 20;

/**
 * Boot reconciliation. Guarantees a safe first start: mode returns to BUILD_SAFE, nothing is
 * restarted, runs interrupted by a restart are marked honestly, and leases of runs whose process
 * may still exist are retained until they are reconciled (runtime/lease-reconcile.mjs).
 * 2.12.2, review R1-F2: a run the restart found still open keeps its leases retained, whatever its recorded PID says. A dead
 * provider PID is not proof that the run's processes are gone: the Hub's exit ends only its direct children (libuv's kill-on-close
 * job; their own children break away silently) and no tree-kill ran, so a command the provider started may still write into the
 * workspace. The owner's rearm card lists such a lease as an "unknown" step (released only with the owner's acknowledgement, or after
 * the card's tree-kill of a live, Hub-tied PID); nothing is relaunched. `leasesReconciled` stays in the report (always empty here).
 * 2.12.2 (D1): that card is shown only while the gate is suspended (gateRearm.evaluate answers OPEN before it looks at leases). So when
 * a workspace is still reserved after the boot pass — the reconciler's sweep on system.recovered released what it could prove free —
 * and the gate is OPEN, the gate is suspended here (RECOVERY_SUSPENSION, see suspendGateForRetainedLeases): the owner's next request
 * shows the rearm card with the lease step, then Windows Hello reopens the gate in BUILD_SAFE. Nothing is resumed or relaunched, the
 * grants are left as they are (this is not a Stop All: no system.stop_all event), and a gate already suspended keeps its own record.
 */
export async function recoverOnBoot({ db, bus, clock, settings, approvals }) {
  const report = { modeReset: false, runs: [], tasks: [], leases: [], leasesReconciled: [], approvalsExpired: 0 };
  const now = clock().toISOString();

  if (settings.get("mode") !== "BUILD_SAFE") {
    bus.transaction(() => settings.set("mode", "BUILD_SAFE", "recovery", "Every boot starts in BUILD_SAFE"));
    report.modeReset = true;
  }

  const open = db.prepare("SELECT * FROM agent_runs WHERE status IN ('starting','running','waiting_approval')").all();
  for (const run of open) {
    const alive = await isPidAlive(run.pid);
    const status = alive ? "orphaned" : "interrupted_unknown";
    bus.transaction(() => {
      db.prepare("UPDATE agent_runs SET status = ?, error_category = 'task', error_message = ?, finished_at = COALESCE(finished_at, ?) WHERE id = ?")
        .run(status, alive ? `Hub restarted; process ${run.pid} is still alive and no longer supervised` : "Hub restarted during the run; provider state unknown", now, run.id);
      if (run.output_message_id) {
        db.prepare("UPDATE messages SET status = 'interrupted', finalized_at = ? WHERE id = ? AND status = 'streaming'").run(now, run.output_message_id);
      }
      const leases = db.prepare("SELECT * FROM leases WHERE run_id = ? AND status = 'active'").all(run.id);
      for (const lease of leases) {
        db.prepare("UPDATE leases SET status = 'retained', release_reason = ? WHERE id = ?").run("Hub restarted mid-run; reconcile before reuse", lease.id);
        report.leases.push(lease.id);
      }
      bus.append({ type: "run.recovered", scopeType: "conversation", scopeId: run.conversation_id || "unknown", source: "recovery", runId: run.id, payload: { status, pid: run.pid, alive } });
    });
    report.runs.push({ id: run.id, status, pid: run.pid });
  }

  const busy = db.prepare("SELECT * FROM tasks WHERE status IN ('RUNNING','PLANNING','WAITING_APPROVAL','VERIFYING')").all();
  for (const task of busy) {
    if (task.status === "VERIFYING") continue; // verification waits for evidence, not a process
    bus.transaction(() => transitionTask(db, bus, clock, { taskId: task.id, to: "BLOCKED", reason: "Hub restarted during execution; reconcile before any retry", actor: "recovery" }));
    report.tasks.push(task.id);
  }
  db.prepare("UPDATE conversations SET status = 'attention' WHERE status IN ('running')").run();
  report.approvalsExpired = approvals.expireStale();
  // The Hub's lease reconciler (when wired) runs its boot sweep synchronously inside this emit: a lease it can prove free is released
  // before the decision below. Without a reconciler every retained lease counts (fail-safe: the gate is suspended, never opened).
  bus.emit({ type: "system.recovered", scopeType: "system", scopeId: "hub", source: "recovery", payload: report });
  // 2.12.2 (D1): a workspace still reserved with the gate open would be a dead end (no card): the gate is suspended for the owner's card.
  try {
    report.gateSuspended = suspendGateForRetainedLeases({ db, bus, clock, settings, openRunIds: report.runs.map((r) => r.id) });
  } catch (error) {
    report.gateSuspended = { suspended: false, reason: "error", error: String(error?.message || error).slice(0, 300) };
    try { bus.emit({ type: "recovery.gate_suspend_failed", scopeType: "system", scopeId: "gate", source: "recovery", payload: { error: report.gateSuspended.error } }); } catch { /* the database is closing */ }
  }
  return report;
}

/** The run as the rearm card's lease step names it (runtime/lease-reconcile.mjs labelOf): „Codex · Proiect”, „Codex (wsl-runner) · …”. */
function runLabel(row) {
  if (!row?.provider) return null;
  const env = row.environment && row.environment !== "windows" ? ` (${row.environment})` : "";
  return `${PROVIDER_LABEL[row.provider] || row.provider}${env}${row.project_name ? ` · ${String(row.project_name).slice(0, 80)}` : ""}`;
}

/** The distinct runs of these lease rows, as labels (order kept; a lease whose run is gone has none). */
const runLabels = (rows) => [...new Map(rows.filter((r) => r.run_id && runLabel(r)).map((r) => [r.run_id, runLabel(r)])).values()];

/**
 * The gate's reason for the boot suspension, in the owner's words (short, speakable): the runs the restart found in flight first; a
 * workspace reserved since an earlier boot otherwise.
 */
export function retainedLeasesReason(rows, openRunIds = []) {
  const open = new Set(openRunIds);
  const inFlight = runLabels(rows.filter((r) => open.has(r.run_id)));
  if (inFlight.length === 1) return `La repornire, execuția „${inFlight[0]}” era în curs; verific spațiul de lucru înainte să-l refolosesc.`;
  if (inFlight.length === 2) return `La repornire, execuțiile „${inFlight[0]}” și „${inFlight[1]}” erau în curs; verific spațiile de lucru înainte să le refolosesc.`;
  if (inFlight.length > 2) return `La repornire, ${inFlight.length} execuții erau în curs („${inFlight[0]}”, „${inFlight[1]}” și încă ${inFlight.length - 2}); verific spațiile de lucru înainte să le refolosesc.`;
  if (rows.length === 1) {
    const [label] = runLabels(rows);
    return label ? `La repornire, spațiul de lucru al execuției „${label}” era încă rezervat; îl verific înainte să-l refolosesc.`
      : "La repornire, un spațiu de lucru era încă rezervat; îl verific înainte să-l refolosesc.";
  }
  return `La repornire, ${rows.length} spații de lucru erau încă rezervate; le verific înainte să le refolosesc.`;
}

/**
 * 2.12.2 (D1): after the boot pass, a lease still retained (its run's outcome unknown, or a Hub-tied process still alive) with the
 * execution gate OPEN leaves the owner no way to release it — the rearm card exists only for a suspended gate. In ONE transaction,
 * compare-and-set on the open gate, the gate is suspended with RECOVERY_SUSPENSION (a fresh record: nextSuspension on an open gate)
 * and a recovery.gate_suspended event names the runs and leases. Returns { suspended, reason, … }; writes nothing when no lease is
 * retained (a clean restart never closes the gate) or the gate is already suspended (whatever its kind: that record and its card stay —
 * the owner's own pause included, whose card releases the leases and leaves the pause to „Continuă”).
 */
export function suspendGateForRetainedLeases({ db, bus, clock, settings, openRunIds = [], origin = RECOVERY_SUSPENSION }) {
  const rows = db.prepare(`SELECT l.id, l.run_id, r.provider, r.environment, p.name AS project_name FROM leases l
    LEFT JOIN agent_runs r ON r.id = l.run_id LEFT JOIN conversations c ON c.id = r.conversation_id LEFT JOIN projects p ON p.id = c.project_id
    WHERE l.status = 'retained' ORDER BY l.acquired_at, l.id`).all();
  const leaseIds = rows.map((r) => r.id);
  if (!rows.length) return { suspended: false, reason: "no_retained_lease", leases: [] };
  const runtime = origin === RUNTIME_LEASE_SUSPENSION;
  const open = new Set(openRunIds);
  // At boot the runs the restart found in flight; at runtime (review F3) every run whose workspace stays reserved.
  const runs = [...new Set(rows.map((r) => r.run_id).filter((id) => id && (runtime || open.has(id))))];
  let out = null;
  bus.transaction(() => {
    const current = settings.get("executionGate") || {};
    if (current.status !== "open") {
      out = { suspended: false, reason: "gate_suspended", cls: classifySuspension(current).cls, leases: leaseIds.slice(0, MAX_RECORDED) };
      return;
    }
    const { kind, channel, actor } = runtime ? RUNTIME_LEASE_SUSPENSION : RECOVERY_SUSPENSION;
    const at = clock().toISOString();
    const text = runtime ? runtimeLeasesReason(rows) : retainedLeasesReason(rows, openRunIds);
    const retained = { runs: runs.slice(0, MAX_RECORDED), leases: leaseIds.slice(0, MAX_RECORDED), count: rows.length };
    const suspendedBy = nextSuspension(current, { kind, at, channel, actor, extra: { retained } });
    settings.set("executionGate", { status: "suspended", reason: text, changedAt: at, changedBy: actor, suspendedBy }, actor, text);
    bus.append({ type: runtime ? RUNTIME_LEASE_SUSPENSION.event : "recovery.gate_suspended", scopeType: "system", scopeId: "gate", source: actor,
      payload: { suspensionId: suspendedBy.id, kind, channel, reason: text, ...retained } });
    out = { suspended: true, suspensionId: suspendedBy.id, kind, channel, reason: text, ...retained };
  });
  return out;
}

/**
 * Review F3 (2.12.2): the same dead end at RUNTIME, with no restart and no Stop All — runs.finalize retains a lease when the provider did
 * not confirm its exit (an environment run whose reap failed, a Windows provider that never exits) and the gate stays OPEN, where no card
 * is shown. When the reconciler's bounded follow-up is over and the lease is still retained (runtime/lease-reconcile.mjs escalate), the
 * gate is suspended through suspendGateForRetainedLeases with this origin: kind "suspend" (any Stop All, shutdown or security record
 * outranks it), channel "automation" („automat, de Hub”). The owner's next request shows the rearm card with the lease step; Windows
 * Hello releases it and reopens the gate in BUILD_SAFE. Nothing is stopped, revoked, resumed or relaunched (no system.stop_all event).
 */
export const RUNTIME_LEASE_SUSPENSION = Object.freeze({ kind: "suspend", channel: "automation", actor: "lease-reconcile", event: "lease.gate_suspended" });

/** The gate's reason for the runtime suspension, in the owner's words (short, speakable). */
export function runtimeLeasesReason(rows) {
  const labels = runLabels(rows);
  if (labels.length === 1) return `Execuția „${labels[0]}” s-a încheiat fără să confirme că procesele ei s-au oprit; am suspendat poarta până verifici spațiul ei de lucru.`;
  if (labels.length > 1) return `${labels.length} execuții s-au încheiat fără să confirme că procesele lor s-au oprit („${labels[0]}” și altele); am suspendat poarta până verifici spațiile lor de lucru.`;
  return rows.length === 1 ? "O execuție s-a încheiat fără să confirme că procesele ei s-au oprit; am suspendat poarta până verifici spațiul ei de lucru."
    : `${rows.length} spații de lucru au rămas rezervate fără confirmarea că s-au eliberat; am suspendat poarta până le verifici.`;
}

/**
 * Periodic housekeeping without models: expire approvals, flag runs with no events (no progress ≠ no
 * new text), keep leases of active runs alive. Never starts AI work.
 */
export function createScheduler({ db, bus, clock, approvals, leases, runs, staleMinutes = 10, extraTick = null }) {
  let timer = null;
  // 2.12.2: the extra passes — the hub's extraTick and those added later (addTick: the lease reconciler); each runs one pass at a time.
  const extras = extraTick ? [{ fn: extraTick, running: false }] : [];
  const flagged = new Set();
  function tick() {
    approvals.expireStale();
    // LOCAL_HUB schedules (non-AI routines); one pass at a time, slots are idempotent in SQLite.
    for (const extra of extras) {
      if (extra.running) continue;
      extra.running = true;
      Promise.resolve().then(extra.fn).catch((error) => { try { bus.emit({ type: "schedule.tick_failed", scopeType: "system", scopeId: "scheduler", source: "scheduler", payload: { error: String(error?.message || error).slice(0, 300) } }); } catch { /* closing */ } })
        .finally(() => { extra.running = false; });
    }
    for (const active of runs.activeRuns()) {
      const run = runs.getRun(active.runId);
      const lease = db.prepare("SELECT id FROM leases WHERE run_id = ? AND status = 'active'").get(active.runId);
      if (lease) leases.heartbeat(lease.id, 1800);
      const idleMin = run?.lastEventAt ? (clock().getTime() - new Date(run.lastEventAt).getTime()) / 60000 : 0;
      if (idleMin >= staleMinutes && !flagged.has(active.runId)) {
        flagged.add(active.runId);
        bus.emit({ type: "run.stale", scopeType: "conversation", scopeId: active.conversationId, source: "scheduler", runId: active.runId,
          payload: { idleMinutes: Math.round(idleMin), note: "No provider events; this is lack of activity, not proof of failure" } });
      }
    }
  }
  return {
    start(intervalMs = 15000) { if (!timer) { timer = setInterval(tick, intervalMs); timer.unref?.(); } },
    stop() { if (timer) clearInterval(timer); timer = null; },
    tick,
    /** 2.12.2: one more inference-free pass per tick (the same rules as extraTick: never overlapping itself, a failure is an event). */
    addTick(fn) { if (typeof fn === "function") extras.push({ fn, running: false }); },
  };
}
