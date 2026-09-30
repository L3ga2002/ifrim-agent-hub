import { hashCanonical } from "../core/canonical.mjs";
import { HubError } from "../core/errors.mjs";
import { newId } from "../core/ids.mjs";
import { json, parse } from "../storage/db.mjs";

export const PERMISSION_TIERS = Object.freeze(["READ_ONLY", "WORKSPACE_EDIT", "DEVELOPMENT_TOOLS", "EXTERNAL_ACTIONS", "SENSITIVE_ACTIONS"]);

/** Channels allowed to decide approvals. Voice and automation payloads can never approve. */
const DECISION_CHANNELS = new Set(["ui"]);

export function approvalHash({ actionKind, target, payload, codeVersion, permissionTier, scopeType, scopeId }) {
  return hashCanonical({ actionKind, target, payload, codeVersion, permissionTier, scopeType, scopeId });
}

/**
 * Approvals bind: action kind, exact target, exact payload (command/diff/params), code version,
 * permission tier, scope and expiry. Any change produces a different hash, so an old approval
 * cannot be reused for a modified action or another task.
 */
export function createApprovals(db, bus, clock = () => new Date()) {
  const byId = db.prepare("SELECT * FROM approvals WHERE id = ?");

  function request({ actionKind, target, payload, codeVersion, permissionTier, scopeType, scopeId, requestedBy, ttlMinutes = 60, singleUse = true }) {
    if (!PERMISSION_TIERS.includes(permissionTier)) throw new HubError("validation", "Unknown permission tier");
    const payloadHash = approvalHash({ actionKind, target, payload, codeVersion, permissionTier, scopeType, scopeId });
    const existing = db.prepare("SELECT * FROM approvals WHERE payload_hash = ? AND status = 'pending'").get(payloadHash);
    if (existing && new Date(existing.expires_at) > clock()) return rowToApproval(existing);
    const id = newId("apr");
    const now = clock();
    const expiresAt = new Date(now.getTime() + ttlMinutes * 60000).toISOString();
    db.prepare(`INSERT INTO approvals (id, action_kind, target, payload_json, payload_hash, code_version, permission_tier, scope_type, scope_id,
      status, requested_by, single_use, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`)
      .run(id, actionKind, target, json(payload), payloadHash, codeVersion, permissionTier, scopeType, scopeId, requestedBy, singleUse ? 1 : 0, expiresAt, now.toISOString());
    bus.append({ type: "approval.requested", scopeType, scopeId, source: requestedBy, payload: { approvalId: id, actionKind, target, permissionTier, expiresAt } });
    return rowToApproval(byId.get(id));
  }

  /** `displayedHash` is the hash the UI showed next to the exact action; a mismatch means the action changed. */
  function decide(id, { decision, displayedHash, channel, actor = "user", note = "" }) {
    if (!DECISION_CHANNELS.has(channel)) throw new HubError("policy", `Approvals cannot be decided through ${channel}`);
    const row = byId.get(id);
    if (!row) throw new HubError("not_found", "Approval not found");
    const approval = rowToApproval(row);
    if (approval.status !== "pending") throw new HubError("conflict", `Approval is ${approval.status}`);
    if (new Date(approval.expiresAt) <= clock()) {
      expire(id);
      throw new HubError("conflict", "Approval expired");
    }
    if (displayedHash !== approval.payloadHash) throw new HubError("conflict", "The action changed since it was displayed; review it again");
    if (!["approved", "rejected"].includes(decision)) throw new HubError("validation", "decision must be approved or rejected");
    if (decision === "rejected" && note.trim().length < 3) throw new HubError("validation", "A rejection needs a short note");
    db.prepare("UPDATE approvals SET status = ?, decided_by = ?, decided_via = ?, decision_note = ?, decided_at = ? WHERE id = ? AND status = 'pending'")
      .run(decision, actor, channel, note, clock().toISOString(), id);
    bus.append({ type: `approval.${decision}`, scopeType: approval.scopeType, scopeId: approval.scopeId, source: actor, payload: { approvalId: id, actionKind: approval.actionKind } });
    return rowToApproval(byId.get(id));
  }

  /**
   * Verifies an approval against the action about to execute and marks single-use approvals consumed.
   * Runs its own transactions (callers must not wrap it) so that an invalidation or expiry is
   * persisted even though the call then throws.
   */
  function consume(id, action) {
    const row = byId.get(id);
    if (!row) throw new HubError("gate", "Approval missing");
    const approval = rowToApproval(row);
    if (approval.status !== "approved") throw new HubError("gate", `Approval is ${approval.status}`);
    if (new Date(approval.expiresAt) <= clock()) { bus.transaction(() => expire(id)); throw new HubError("gate", "Approval expired"); }
    const hash = approvalHash(action);
    if (hash !== approval.payloadHash) {
      bus.transaction(() => {
        db.prepare("UPDATE approvals SET status = 'invalidated' WHERE id = ?").run(id);
        bus.append({ type: "approval.invalidated", scopeType: approval.scopeType, scopeId: approval.scopeId, source: "hub", payload: { approvalId: id, reason: "action changed" } });
      });
      throw new HubError("gate", "Approval does not match the action (changed target, payload, version or scope)");
    }
    if (approval.singleUse) {
      const changed = bus.transaction(() => {
        const result = db.prepare("UPDATE approvals SET status = 'consumed', consumed_at = ? WHERE id = ? AND status = 'approved'").run(clock().toISOString(), id);
        if (result.changes === 1) bus.append({ type: "approval.consumed", scopeType: approval.scopeType, scopeId: approval.scopeId, source: "hub", payload: { approvalId: id } });
        return result.changes;
      });
      if (changed !== 1) throw new HubError("gate", "Approval was already consumed");
    }
    return approval;
  }

  function expire(id) {
    db.prepare("UPDATE approvals SET status = 'expired' WHERE id = ? AND status IN ('pending','approved')").run(id);
  }

  function expireStale() {
    const now = clock().toISOString();
    return db.prepare("UPDATE approvals SET status = 'expired' WHERE status IN ('pending','approved') AND expires_at <= ?").run(now).changes;
  }

  const list = (status = null) => (status
    ? db.prepare("SELECT * FROM approvals WHERE status = ? ORDER BY created_at DESC LIMIT 200").all(status)
    : db.prepare("SELECT * FROM approvals ORDER BY created_at DESC LIMIT 200").all()).map(rowToApproval);

  return { request, decide, consume, expireStale, list, get: (id) => { const r = byId.get(id); return r ? rowToApproval(r) : null; } };
}

export function rowToApproval(row) {
  return { id: row.id, actionKind: row.action_kind, target: row.target, payload: parse(row.payload_json, {}), payloadHash: row.payload_hash,
    codeVersion: row.code_version, permissionTier: row.permission_tier, scopeType: row.scope_type, scopeId: row.scope_id,
    status: row.status, requestedBy: row.requested_by, decidedBy: row.decided_by, decidedVia: row.decided_via,
    decisionNote: row.decision_note, singleUse: Boolean(row.single_use), expiresAt: row.expires_at, createdAt: row.created_at,
    decidedAt: row.decided_at, consumedAt: row.consumed_at };
}
