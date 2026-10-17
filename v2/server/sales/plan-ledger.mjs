import crypto from "node:crypto";
import { HubError } from "../core/errors.mjs";
import { canonicalJson, sha256 } from "../core/canonical.mjs";
import { json, parse } from "../storage/db.mjs";

/**
 * M12 C-01: the idempotency ledger of the Sales preparation plan (table sales_plan_ops, migration 13). One row per operation of ONE
 * owner-confirmed plan: the key is derived from the confirmed root plan (its id AND its hash: two plans with the same text hash the
 * same, so the id keeps them apart), the operation and its normalised parameters — never from a text or a time.
 *
 *   op_key = sha256(canonicalJson({ v: 1, root: { planId, planHash }, op, params: normalize(keyParams) }))
 *
 * The root is the owner-confirmed `sales.prepare` plan, also for the derived phase B and for a continuation card, so a re-activation
 * or a continuation finds the operations already done and never repeats them (no duplicate row, file or event).
 * - Synchronous operations (`runSync`): the ledger row, the effect and its events in ONE transaction; a second identical call (also
 *   two concurrent calls, Promise.all) finds the DONE row and gets the stored result (`duplicate: true`), with no new event.
 * - Asynchronous operations (`claim` → `complete`): the row is claimed IN_PROGRESS with a token before the I/O; the effect commits
 *   with a compare-and-swap on that token. A crash leaves IN_PROGRESS with no effect: a later claim takes it over (never a duplicate).
 * - The same key with different recorded parameters is refused (IDEMPOTENCY_CONFLICT): the inputs changed under an existing key.
 * `fixed_at` is the time the operation first ran: what it writes uses it (never the clock), so a retry produces the same bytes.
 */
export const PLAN_LEDGER_VERSION = 1;
/** Parameter keys compared case-insensitively (a domain, an e-mail address, a host). */
const LOWER_KEYS = new Set(["domain", "email", "host"]);

/** NFC, trimmed, single spaces; domain / e-mail / host in lower case; undefined dropped (canonicalJson sorts the keys). */
export function normalizeParams(value, key = "") {
  if (typeof value === "string") {
    const s = value.normalize("NFC").trim().replace(/\s+/g, " ");
    return LOWER_KEYS.has(key) ? s.toLowerCase() : s;
  }
  if (Array.isArray(value)) return value.map((v) => normalizeParams(v, key));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).map(([k, v]) => [k, normalizeParams(v, k)]));
  }
  return value === undefined ? null : value;
}

/** The C-01 key of an operation of a confirmed root plan. */
export function opKeyOf(root, op, keyParams) {
  const planId = String(root?.planId || "");
  const planHash = String(root?.planHash || "");
  if (!/^opp_[A-Za-z0-9_]+$/.test(planId) || !/^[0-9a-f]{64}$/.test(planHash)) throw new HubError("validation", "Cheia operației cere planul confirmat (id și hash)", { code: "LEDGER_ROOT" });
  if (!String(op || "").trim()) throw new HubError("validation", "Cheia operației cere operația");
  return sha256(canonicalJson({ v: PLAN_LEDGER_VERSION, root: { planId, planHash }, op: String(op), params: normalizeParams(keyParams ?? {}) }));
}

export function createPlanLedger({ db, bus, clock }) {
  const now = () => clock().toISOString();
  /** In-process claims: op_key → { token, promise, resolve } (a second caller in this process waits for the first). */
  const held = new Map();
  const rowOf = (key) => db.prepare("SELECT * FROM sales_plan_ops WHERE op_key = ?").get(String(key || ""));
  const view = (r) => r && ({ opKey: r.op_key, rootPlanId: r.root_plan_id, rootPlanHash: r.root_plan_hash, op: r.op, params: parse(r.params_json, {}), status: r.status,
    result: parse(r.result_json, null), fixedAt: r.fixed_at, createdAt: r.created_at, updatedAt: r.updated_at });

  function prepare({ root, op, keyParams, params }) {
    const key = opKeyOf(root, op, keyParams);
    const full = normalizeParams({ ...(params || {}), ...(keyParams || {}) });
    return { key, paramsJson: json(full) };
  }
  function sameParams(row, op, paramsJson) {
    if (row.op !== op || row.params_json !== paramsJson) {
      throw new HubError("conflict", "Operația planului există deja cu alți parametri: intrările s-au schimbat sub aceeași cheie", { code: "IDEMPOTENCY_CONFLICT", data: { opKey: row.op_key, op } });
    }
  }

  /**
   * A synchronous operation: `effect({ key, fixedAt })` runs at most once per key, in the same transaction as the ledger row and its
   * events. `after(result, { duplicate, key, fixedAt })` runs in that transaction in both cases (state that must be true after the
   * operation, e.g. the preparation's status, written only when it differs). → { duplicate, key, result, fixedAt, after }
   */
  function runSync({ root, op, keyParams, params = null, effect, after = null }) {
    const { key, paramsJson } = prepare({ root, op, keyParams, params });
    return bus.transaction(() => {
      const existing = rowOf(key);
      if (existing) {
        sameParams(existing, op, paramsJson);
        if (existing.status !== "DONE") throw new HubError("conflict", "Operația planului e încă în curs", { code: "LEDGER_IN_PROGRESS", data: { opKey: key, op } });
        const result = parse(existing.result_json, null);
        const out = after ? after(result, { duplicate: true, key, fixedAt: existing.fixed_at }) : undefined;
        return { duplicate: true, key, result, fixedAt: existing.fixed_at, after: out };
      }
      const at = now();
      db.prepare(`INSERT INTO sales_plan_ops (op_key, root_plan_id, root_plan_hash, op, params_json, status, claim_token, result_json, fixed_at, synthetic, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'IN_PROGRESS', NULL, NULL, ?, 1, ?, ?)`).run(key, String(root.planId), String(root.planHash), op, paramsJson, at, at, at);
      const result = effect({ key, fixedAt: at });
      db.prepare("UPDATE sales_plan_ops SET status = 'DONE', result_json = ?, updated_at = ? WHERE op_key = ? AND status = 'IN_PROGRESS'").run(json(result ?? null), now(), key);
      const out = after ? after(result, { duplicate: false, key, fixedAt: at }) : undefined;
      return { duplicate: false, key, result, fixedAt: at, after: out };
    });
  }

  /**
   * An asynchronous operation, step 1: claim the key before the I/O. → { done, result, fixedAt } when it already ran;
   * { inProgress, promise } when another caller of THIS process holds it (await the promise, then claim again);
   * { claimed, key, token, fixedAt } otherwise. An IN_PROGRESS row no caller of this process holds (left by a crash) or a FAILED row
   * is taken over with a new token (compare-and-swap); its `fixed_at` stays, so the retry writes the same content.
   */
  function claim({ root, op, keyParams, params = null }) {
    const { key, paramsJson } = prepare({ root, op, keyParams, params });
    const mine = held.get(key);
    if (mine) return { inProgress: true, key, promise: mine.promise };
    const token = crypto.randomBytes(12).toString("hex");
    const out = bus.transaction(() => {
      const existing = rowOf(key);
      if (existing) {
        sameParams(existing, op, paramsJson);
        if (existing.status === "DONE") return { done: true, key, result: parse(existing.result_json, null), fixedAt: existing.fixed_at };
        const n = db.prepare("UPDATE sales_plan_ops SET status = 'IN_PROGRESS', claim_token = ?, updated_at = ? WHERE op_key = ? AND status = ? AND claim_token IS ?")
          .run(token, now(), key, existing.status, existing.claim_token).changes;
        if (n !== 1) throw new HubError("conflict", "Operația planului a fost preluată între timp", { code: "LEDGER_IN_PROGRESS", data: { opKey: key, op } });
        return { claimed: true, key, token, fixedAt: existing.fixed_at, takenOver: true };
      }
      const at = now();
      db.prepare(`INSERT INTO sales_plan_ops (op_key, root_plan_id, root_plan_hash, op, params_json, status, claim_token, result_json, fixed_at, synthetic, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'IN_PROGRESS', ?, NULL, ?, 1, ?, ?)`).run(key, String(root.planId), String(root.planHash), op, paramsJson, token, at, at, at);
      return { claimed: true, key, token, fixedAt: at, takenOver: false };
    });
    if (out.claimed) {
      let resolve;
      const promise = new Promise((r) => { resolve = r; });
      held.set(key, { token, promise, resolve });
    }
    return out;
  }
  const releaseHeld = (key, token) => {
    const h = held.get(key);
    if (h && h.token === token) { held.delete(key); h.resolve(); }
  };

  /**
   * Step 2: the effect commits with the ledger row in ONE transaction: the claim is checked, `effect()` runs (its events too) and its
   * result is stored with a compare-and-swap on the claim token. A lost claim refuses before the effect; nothing is written.
   */
  function complete({ key, token, effect }) {
    const lost = () => new HubError("conflict", "Operația planului nu mai e a acestui pas (preluată sau încheiată)", { code: "LEDGER_CLAIM_LOST", data: { opKey: key } });
    try {
      return bus.transaction(() => {
        if (!db.prepare("SELECT 1 FROM sales_plan_ops WHERE op_key = ? AND status = 'IN_PROGRESS' AND claim_token = ?").get(key, token)) throw lost();
        const result = effect();
        const n = db.prepare("UPDATE sales_plan_ops SET status = 'DONE', result_json = ?, claim_token = NULL, updated_at = ? WHERE op_key = ? AND status = 'IN_PROGRESS' AND claim_token = ?")
          .run(json(result ?? null), now(), key, token).changes;
        if (n !== 1) throw lost();
        return result;
      });
    } finally { releaseHeld(key, token); }
  }
  /** The claim ends without an effect: FAILED (a refusal that stays recorded; a retry may take it over) or left IN_PROGRESS (`keep`). */
  function release({ key, token, failed = false, error = "" }) {
    try {
      if (failed) bus.transaction(() => db.prepare("UPDATE sales_plan_ops SET status = 'FAILED', claim_token = NULL, result_json = ?, updated_at = ? WHERE op_key = ? AND status = 'IN_PROGRESS' AND claim_token = ?")
        .run(json({ error: String(error).slice(0, 300) }), now(), key, token));
    } finally { releaseHeld(key, token); }
  }

  /** What a resume needs: the operation ran (DONE, with its result) or not. */
  function status({ root, op, keyParams, params = null }) {
    const { key } = prepare({ root, op, keyParams, params });
    const r = rowOf(key);
    return { key, status: r?.status || null, result: r ? parse(r.result_json, null) : null, fixedAt: r?.fixed_at || null, held: held.has(key) };
  }
  const get = (key) => view(rowOf(key));
  const ofRoot = (rootPlanId) => db.prepare("SELECT * FROM sales_plan_ops WHERE root_plan_id = ? ORDER BY created_at, rowid").all(String(rootPlanId || "")).map(view);

  return { key: opKeyOf, runSync, claim, complete, release, status, get, ofRoot, isHeld: (key) => held.has(key) };
}
