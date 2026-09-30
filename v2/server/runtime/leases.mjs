import { HubError } from "../core/errors.mjs";
import { newId } from "../core/ids.mjs";

/**
 * Exclusive resource leases (single writer per workspace). A partial unique index guarantees that
 * two holders can never be active on the same resource, even under concurrent requests.
 * `retained` = holder state unknown (e.g. crash mid-run); only an explicit reconcile releases it.
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

  function retain(id, reason) {
    db.prepare("UPDATE leases SET status = 'retained', release_reason = ? WHERE id = ? AND status = 'active'").run(reason, id);
    const lease = db.prepare("SELECT * FROM leases WHERE id = ?").get(id);
    if (lease) bus.append({ type: "lease.retained", scopeType: "resource", scopeId: lease.resource, source: "hub", runId: lease.run_id, payload: { leaseId: id, reason } });
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
  return { acquire, heartbeat, attachRun, release, retain, transfer, list, current };
}
