import { HubError } from "../core/errors.mjs";
import { newId } from "../core/ids.mjs";

/**
 * Exclusive resource leases (single writer per workspace). A partial unique index guarantees that
 * two holders can never be active on the same resource, even under concurrent requests.
 * `retained` = holder state unknown (e.g. crash mid-run); only a reconciliation releases it (runtime/lease-reconcile.mjs: once the
 * run is finished and its process provably gone, or the owner's rearm card — never by a timeout alone).
 */
export function createLeases(db, bus, clock = () => new Date()) {
  const active = db.prepare("SELECT * FROM leases WHERE resource = ? AND status IN ('active','retained')");

  function acquire({ resource, holder, taskId = null, runId = null, ttlSeconds = 900 }) {
    const current = active.get(resource);
    if (current) {
      if (current.status === "active" && new Date(current.expires_at) <= clock() && current.run_id === null) {
        release(current.id, "expired without run");
      } else {
        throw new HubError("conflict", `Resource is held by ${current.holder} (${current.status})`, { data: { leaseId: current.id, holder: current.holder, status: current.status } });
      }
    }
    const now = clock();
    const id = newId("lease");
    try {
      db.prepare(`INSERT INTO leases (id, resource, holder, task_id, run_id, status, acquired_at, heartbeat_at, expires_at)
        VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)`).run(id, resource, holder, taskId, runId, now.toISOString(), now.toISOString(),
        new Date(now.getTime() + ttlSeconds * 1000).toISOString());
    } catch (error) {
      if (/UNIQUE/i.test(error.message)) throw new HubError("conflict", "Resource was acquired concurrently by another writer");
      throw error;
    }
    bus.append({ type: "lease.acquired", scopeType: "resource", scopeId: resource, source: holder, runId, payload: { leaseId: id, taskId } });
    return db.prepare("SELECT * FROM leases WHERE id = ?").get(id);
  }

  function heartbeat(id, ttlSeconds = 900) {
    const now = clock();
    return db.prepare("UPDATE leases SET heartbeat_at = ?, expires_at = ? WHERE id = ? AND status = 'active'")
      .run(now.toISOString(), new Date(now.getTime() + ttlSeconds * 1000).toISOString(), id).changes === 1;
  }

  function attachRun(id, runId) {
    db.prepare("UPDATE leases SET run_id = ? WHERE id = ?").run(runId, id);
  }

  function release(id, reason) {
    const lease = db.prepare("SELECT * FROM leases WHERE id = ?").get(id);
    if (!lease || lease.status === "released") return false;
    db.prepare("UPDATE leases SET status = 'released', released_at = ?, release_reason = ? WHERE id = ?").run(clock().toISOString(), reason, id);
    bus.append({ type: "lease.released", scopeType: "resource", scopeId: lease.resource, source: "hub", runId: lease.run_id, payload: { leaseId: id, reason } });
    return true;
  }

  /**
   * Keeps an active lease whose holder's state is unknown. 2.12.2 (P0-R1): announced only when it really changed (a lease already
   * released is never "retained" again — no resurrection); `extra.processKey` / `extra.environment` tell the reconciler
   * (runtime/lease-reconcile.mjs, which follows lease.retained) which supervised process to watch.
   */
  function retain(id, reason, extra = {}) {
    const changed = db.prepare("UPDATE leases SET status = 'retained', release_reason = ? WHERE id = ? AND status = 'active'").run(reason, id).changes === 1;
    const lease = changed ? db.prepare("SELECT * FROM leases WHERE id = ?").get(id) : null;
    const more = {};
    if (extra?.processKey) more.processKey = String(extra.processKey).slice(0, 120);
    if (extra?.environment) more.environment = String(extra.environment).slice(0, 40);
    if (lease) bus.append({ type: "lease.retained", scopeType: "resource", scopeId: lease.resource, source: "hub", runId: lease.run_id, payload: { leaseId: id, reason, ...more } });
    return changed;
  }

  /**
   * 2.12.2 (P0-R1): ends a lease after reconciliation (runtime/lease-reconcile.mjs, runtime/recovery.mjs). Compare-and-set on the
   * status it was read with (default: retained), so two reconcilers — a follow-up timer, the scheduler tick, the owner's rearm — never
   * both release it. Appends lease.released and lease.reconciled { leaseId, runId, verdict, from, evidence }. True only for the call
   * that released it. It never touches the lease's run.
   */
  function reconcile(id, { reason = "reconciled", verdict = "released", evidence = {}, from = ["retained"] } = {}) {
    const lease = db.prepare("SELECT * FROM leases WHERE id = ?").get(id);
    // A released lease is final: never released (or announced) twice, whatever the caller asks.
    if (!lease || lease.status === "released" || !from.includes(lease.status)) return false;
    const why = String(reason || "reconciled").slice(0, 300);
    const changed = db.prepare("UPDATE leases SET status = 'released', released_at = ?, release_reason = ? WHERE id = ? AND status = ?")
      .run(clock().toISOString(), why, id, lease.status).changes === 1;
    if (!changed) return false;
    bus.append({ type: "lease.released", scopeType: "resource", scopeId: lease.resource, source: "hub", runId: lease.run_id, payload: { leaseId: id, reason: why } });
    bus.append({ type: "lease.reconciled", scopeType: "resource", scopeId: lease.resource, source: "hub", runId: lease.run_id,
      payload: { leaseId: id, runId: lease.run_id || null, verdict: String(verdict).slice(0, 40), from: lease.status, evidence: evidence && typeof evidence === "object" ? evidence : {} } });
    return true;
  }

  /** Transfers exclusivity to a new holder atomically (used by handoff step 6). */
  function transfer(id, newHolder, runId = null) {
    const lease = db.prepare("SELECT * FROM leases WHERE id = ? AND status = 'active'").get(id);
    if (!lease) throw new HubError("conflict", "Lease is not active; cannot transfer");
    db.prepare("UPDATE leases SET holder = ?, run_id = ?, heartbeat_at = ? WHERE id = ?").run(newHolder, runId, clock().toISOString(), id);
    bus.append({ type: "lease.transferred", scopeType: "resource", scopeId: lease.resource, source: "hub", payload: { leaseId: id, from: lease.holder, to: newHolder } });
    return db.prepare("SELECT * FROM leases WHERE id = ?").get(id);
  }

  const list = () => db.prepare("SELECT * FROM leases WHERE status IN ('active','retained') ORDER BY acquired_at").all();
  const current = (resource) => active.get(resource) || null;
  const get = (id) => db.prepare("SELECT * FROM leases WHERE id = ?").get(id) || null;
  return { acquire, heartbeat, attachRun, release, retain, reconcile, transfer, list, current, get };
}
