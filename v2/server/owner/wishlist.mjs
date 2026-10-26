import { HubError } from "../core/errors.mjs";
import { newId } from "../core/ids.mjs";
import { redactText } from "../security/redact.mjs";

/**
 * The owner's wishlist (2026-10-26, after the owner's L3ga session of 2026-10-25: „trece asta pe un wishlist”, „fă un wishlist nou”).
 * What the owner wants the Hub or L3ga to do and it cannot do yet, in his own words, kept until he marks it done or removes it.
 * A note, never a task: nothing starts, nothing is planned, no model runs from an item. Written from the conversation (typed or the
 * voice session's derived owner authority, intake intent wishlist_add) and from the L3ga screen (commands wishlist.add / wishlist.status).
 * Statuses: OPEN → DONE (or back to OPEN); REMOVED is final for the list (the row and its history stay, never deleted).
 */
export const WISHLIST_STATUSES = Object.freeze(["OPEN", "DONE", "REMOVED"]);
export const WISHLIST_SOURCES = Object.freeze(["typed", "voice", "ui"]);
export const WISHLIST_LIMITS = Object.freeze({ textMax: 300, textMin: 3, openMax: 200, listMax: 200 });

const fold = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/** The item's own words: one line, redacted, without the quotes or the final punctuation around it. */
export function cleanWishText(text) {
  return redactText(String(text || "")).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim()
    .replace(/^[„“”"«»':,;.\s-]+|[„“”"«»':,;.!?\s-]+$/g, "").slice(0, WISHLIST_LIMITS.textMax).trim();
}

export function createWishlist({ db, bus, clock = () => new Date() }) {
  const now = () => clock().toISOString();
  const row = (r) => r && ({ id: r.id, text: r.text, status: r.status, source: r.source, origin: r.origin || null, projectId: r.project_id || null,
    createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at, doneAt: r.done_at || null });
  const get = (id) => row(db.prepare("SELECT * FROM wishlist_items WHERE id = ?").get(String(id || "")));

  /** Items in the order they were added (newest last); REMOVED only when asked. */
  function list({ status = null, includeRemoved = false } = {}) {
    const rows = status
      ? db.prepare("SELECT * FROM wishlist_items WHERE status = ? ORDER BY created_at, id LIMIT ?").all(status, WISHLIST_LIMITS.listMax)
      : db.prepare(`SELECT * FROM wishlist_items ${includeRemoved ? "" : "WHERE status <> 'REMOVED'"} ORDER BY created_at, id LIMIT ?`).all(WISHLIST_LIMITS.listMax);
    return rows.map(row);
  }

  /**
   * Adds one item. The same words already OPEN are not added twice (→ { item, duplicate: true }); the same words DONE or REMOVED come
   * back as a new OPEN item (the owner asked again).
   */
  function add({ text, source = "typed", origin = null, projectId = null, actor = "owner" }) {
    const clean = cleanWishText(text);
    if (clean.length < WISHLIST_LIMITS.textMin) throw new HubError("validation", "Ce pun pe wishlist? Spune-mi în câteva cuvinte.");
    if (!WISHLIST_SOURCES.includes(source)) throw new HubError("validation", `Sursă necunoscută: ${source}`);
    const key = fold(clean);
    const open = db.prepare("SELECT * FROM wishlist_items WHERE status = 'OPEN' ORDER BY created_at").all();
    const same = open.find((r) => fold(r.text) === key);
    if (same) return { item: row(same), duplicate: true, openCount: open.length };
    if (open.length >= WISHLIST_LIMITS.openMax) throw new HubError("conflict", `Wishlist-ul are deja ${WISHLIST_LIMITS.openMax} idei deschise; marchează câteva ca făcute.`);
    const id = newId("wsh");
    const at = now();
    const originText = origin ? cleanWishText(origin) : null;
    bus.transaction(() => {
      db.prepare(`INSERT INTO wishlist_items (id, text, status, source, origin, project_id, created_by, created_at, updated_at) VALUES (?, ?, 'OPEN', ?, ?, ?, ?, ?, ?)`)
        .run(id, clean, source, originText && originText !== clean ? originText : null, projectId || null, String(actor || "owner").slice(0, 120), at, at);
      bus.emit({ type: "wishlist.added", scopeType: "wishlist", scopeId: id, projectId: projectId || null, source: source === "voice" ? "lega" : "owner", payload: { id, source, length: clean.length } });
    });
    return { item: get(id), duplicate: false, openCount: open.length + 1 };
  }

  function setStatus({ id, status, actor = "owner" }) {
    if (!WISHLIST_STATUSES.includes(status)) throw new HubError("validation", `Stare necunoscută: ${status}`);
    const item = get(id);
    if (!item) throw new HubError("not_found", "Ideea nu mai e pe wishlist");
    if (item.status === "REMOVED") throw new HubError("conflict", "Ideea a fost scoasă de pe wishlist");
    if (item.status === status) return { item, changed: false };
    const at = now();
    bus.transaction(() => {
      db.prepare("UPDATE wishlist_items SET status = ?, updated_at = ?, done_at = ? WHERE id = ?").run(status, at, status === "DONE" ? at : null, item.id);
      bus.emit({ type: "wishlist.status", scopeType: "wishlist", scopeId: item.id, projectId: item.projectId, source: "owner", payload: { id: item.id, from: item.status, to: status, actor: String(actor || "owner").slice(0, 120) } });
    });
    return { item: get(item.id), changed: true };
  }

  return { list, add, setStatus, get };
}
