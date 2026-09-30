import { isPidAlive } from "./supervisor.mjs";
import { transitionTask } from "./state-machine.mjs";

/**
 * Boot reconciliation. Guarantees a safe first start: mode returns to BUILD_SAFE, nothing is
 * restarted, runs interrupted by a restart are marked honestly, and leases of runs whose process
 * may still exist are retained until you reconcile them.
 */
export async function recoverOnBoot({ db, bus, clock, settings, approvals }) {
  const report = { modeReset: false, runs: [], tasks: [], leases: [], approvalsExpired: 0 };
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
  bus.emit({ type: "system.recovered", scopeType: "system", scopeId: "hub", source: "recovery", payload: report });
  return report;
}

/**
 * Periodic housekeeping without models: expire approvals, flag runs with no events (no progress ≠ no
 * new text), keep leases of active runs alive. Never starts AI work.
 */
export function createScheduler({ db, bus, clock, approvals, leases, runs, staleMinutes = 10, extraTick = null }) {
  let timer = null;
  let extraRunning = false;
  const flagged = new Set();
  function tick() {
    approvals.expireStale();
    // LOCAL_HUB schedules (non-AI routines); one pass at a time, slots are idempotent in SQLite.
    if (extraTick && !extraRunning) {
      extraRunning = true;
      Promise.resolve().then(extraTick).catch((error) => bus.emit({ type: "schedule.tick_failed", scopeType: "system", scopeId: "scheduler", source: "scheduler", payload: { error: String(error.message || error).slice(0, 300) } }))
        .finally(() => { extraRunning = false; });
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
  };
}
