import { HubError } from "../core/errors.mjs";
import { newId } from "../core/ids.mjs";
import { containsSecretLikeContent } from "../security/redact.mjs";

export const MEMORY_SCOPES = Object.freeze(["GLOBAL", "COMPANY", "DEPARTMENT", "CLIENT", "PROJECT", "MISSION", "TASK", "AGENT_ROLE"]);
export const MEMORY_SOURCES = Object.freeze(["hub", "user", "claude_native", "openai_native", "hermes", "import", "v1"]);
export const SYNC_DIRECTIONS = Object.freeze(["none", "import_only", "export_only"]);
const ECHO_MARKER = /hub-memory-id:(mem_[a-z0-9_]+)/i;
export const MEMORY_TYPES = Object.freeze(["FACT", "USER_PREFERENCE", "DECISION", "ASSUMPTION", "HYPOTHESIS", "OUTDATED"]);

/**
 * Local memory with SQLite FTS5 (diacritics-insensitive). Agent-authored items can only be
 * ASSUMPTION/HYPOTHESIS until a person promotes them; secret-like content is rejected before indexing.
 * Edits create a new version and mark the previous one OUTDATED, so history is preserved.
 */
export function createMemory({ db, bus, clock }) {
  const rowTo = (row) => row && ({ id: row.id, scope: row.scope, scopeRef: row.scope_ref, type: row.type, title: row.title, body: row.body,
    sourceRef: row.source_ref, author: row.author, version: row.version, supersedesId: row.supersedes_id, status: row.status,
    retentionUntil: row.retention_until, sourceKind: row.source_kind || "hub", syncDirection: row.sync_direction || "none", createdAt: row.created_at, updatedAt: row.updated_at });

  function validateItem({ scope, scopeRef = "", type, title, body, author, sourceKind = "hub", syncDirection = "none", allowMissingScopeRef = false }) {
    if (!MEMORY_SCOPES.includes(scope)) throw new HubError("validation", "Unknown memory scope");
    if (!allowMissingScopeRef && scope !== "GLOBAL" && scope !== "COMPANY" && !String(scopeRef || "").trim()) throw new HubError("validation", `Scope ${scope} needs a scopeRef (id of the department/client/project/mission/task/role)`);
    if (!MEMORY_SOURCES.includes(sourceKind)) throw new HubError("validation", "Unknown memory source");
    if (!SYNC_DIRECTIONS.includes(syncDirection)) throw new HubError("validation", "Unknown sync direction");
    if (!MEMORY_TYPES.includes(type)) throw new HubError("validation", "Unknown memory type");
    if (!title?.trim() || !body?.trim()) throw new HubError("validation", "Title and body are required");
    if (containsSecretLikeContent(`${title}\n${body}`)) throw new HubError("policy", "Memory must not contain credentials or tokens");
    if (author !== "user" && ["FACT", "USER_PREFERENCE", "DECISION"].includes(type)) {
      throw new HubError("policy", "Agent-authored memory is stored as ASSUMPTION or HYPOTHESIS until you confirm it");
    }
  }

  function add(item) {
    validateItem(item);
    const id = newId("mem");
    const now = clock().toISOString();
    db.prepare(`INSERT INTO memory_items (id, scope, scope_ref, type, title, body, source_ref, author, version, supersedes_id, retention_until, source_kind, sync_direction, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, item.scope, item.scopeRef || "", item.type, item.title.trim(), item.body.trim(), item.sourceRef || "",
      item.author, item.version || 1, item.supersedesId || null, item.retentionUntil || null, item.sourceKind || "hub", item.syncDirection || "none", now, now);
    db.prepare("INSERT INTO memory_fts (item_id, title, body) VALUES (?, ?, ?)").run(id, item.title, item.body);
    bus.append({ type: "memory.added", scopeType: "memory", scopeId: id, source: item.author, payload: { scope: item.scope, type: item.type, title: item.title } });
    return get(id);
  }

  /** Correction = new version; the old one is kept and marked OUTDATED. */
  function revise(id, patch, author = "user") {
    const current = get(id);
    if (!current) throw new HubError("not_found", "Memory item not found");
    if (current.status !== "active") throw new HubError("conflict", "Only active items can be revised");
    const scopeRef = patch.scopeRef !== undefined ? String(patch.scopeRef).trim() : current.scopeRef;
    const next = add({ ...current, ...patch, scopeRef, author, version: current.version + 1, supersedesId: current.id, allowMissingScopeRef: !current.scopeRef && !scopeRef });
    db.prepare("UPDATE memory_items SET status = 'superseded', type = 'OUTDATED', updated_at = ? WHERE id = ?").run(clock().toISOString(), id);
    return next;
  }

  /** Authorized deletion: body removed from the index and content; a tombstone keeps the audit trail. */
  function remove(id, actor) {
    const current = get(id);
    if (!current) throw new HubError("not_found", "Memory item not found");
    db.prepare("DELETE FROM memory_fts WHERE item_id = ?").run(id);
    db.prepare("UPDATE memory_items SET status = 'deleted', body = '[deleted]', updated_at = ? WHERE id = ?").run(clock().toISOString(), id);
    bus.append({ type: "memory.deleted", scopeType: "memory", scopeId: id, source: actor, payload: { title: current.title } });
    return true;
  }

  const get = (id) => rowTo(db.prepare("SELECT * FROM memory_items WHERE id = ?").get(id));

  function search(query, { scope = null, scopeRef = null, limit = 20, includeInactive = false } = {}) {
    const terms = String(query || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").match(/[\p{L}\p{N}_-]{2,}/gu) || [];
    if (!terms.length) {
      return db.prepare(`SELECT * FROM memory_items WHERE ${includeInactive ? "1=1" : "status = 'active'"} ${scope ? "AND scope = ?" : ""} ${scopeRef ? "AND scope_ref = ?" : ""} ORDER BY updated_at DESC LIMIT ?`)
        .all(...(scope ? [scope] : []), ...(scopeRef ? [scopeRef] : []), limit).map(rowTo);
    }
    const match = terms.map((t) => `"${t.replaceAll('"', "")}"*`).join(" OR ");
    const rows = db.prepare(`SELECT m.*, bm25(memory_fts) AS rank FROM memory_fts JOIN memory_items m ON m.id = memory_fts.item_id
      WHERE memory_fts MATCH ? ${includeInactive ? "" : "AND m.status = 'active'"} ${scope ? "AND m.scope = ?" : ""} ${scopeRef ? "AND m.scope_ref = ?" : ""}
      ORDER BY rank LIMIT ?`).all(match, ...(scope ? [scope] : []), ...(scopeRef ? [scopeRef] : []), limit);
    return rows.map((row) => ({ ...rowTo(row), rank: row.rank }));
  }

  /** Items in the same scope with the same title but different active bodies are shown as contradictions. */
  function contradictions() {
    return db.prepare(`SELECT a.id AS a, b.id AS b, a.title FROM memory_items a JOIN memory_items b ON a.scope = b.scope AND a.scope_ref = b.scope_ref
      AND lower(a.title) = lower(b.title) AND a.id < b.id WHERE a.status = 'active' AND b.status = 'active' AND a.body <> b.body LIMIT 50`).all();
  }

  function exportAll() {
    return db.prepare("SELECT * FROM memory_items WHERE status <> 'deleted' ORDER BY created_at").all().map(rowTo);
  }

  /**
   * Export for a vendor memory surface (assisted: you paste it into Claude/ChatGPT memory or project
   * instructions). Each line carries a hub-memory-id marker so that re-importing the same text is
   * detected as an echo, preventing Hub → Claude → Hub duplication loops.
   */
  function exportForProvider(provider, { scope = null, scopeRef = null } = {}) {
    if (!["claude", "openai"].includes(provider)) throw new HubError("validation", "provider must be claude or openai");
    const items = db.prepare(`SELECT * FROM memory_items WHERE status = 'active' AND type IN ('FACT','USER_PREFERENCE','DECISION') ${scope ? "AND scope = ?" : ""} ${scopeRef ? "AND scope_ref = ?" : ""} ORDER BY scope, title`)
      .all(...(scope ? [scope] : []), ...(scopeRef ? [scopeRef] : [])).map(rowTo).filter((m) => m.sourceKind !== `${provider}_native`);
    const lines = items.map((m) => `- [${m.scope}${m.scopeRef ? `:${m.scopeRef}` : ""}] ${m.title}: ${m.body.replace(/\s+/g, " ").slice(0, 600)} (hub-memory-id:${m.id})`);
    return { provider, count: items.length, text: lines.join("\n"), note: "Export asistat: Hub-ul nu scrie în memoria vendorului. Markerul hub-memory-id previne buclele la reimport." };
  }

  /**
   * Controlled import from a vendor memory export (text you paste). Lines become ASSUMPTION items
   * (until you confirm them); echoes of Hub items and duplicates are skipped. Must run inside bus.transaction.
   */
  function importFromText({ sourceKind, text, scope = "GLOBAL", scopeRef = "" }, actor = "user") {
    if (!["claude_native", "openai_native", "hermes", "import"].includes(sourceKind)) throw new HubError("validation", "Unsupported import source");
    const result = { created: 0, echoes: 0, duplicates: 0, rejected: 0 };
    for (const raw of String(text || "").split(/\r?\n/)) {
      const line = raw.replace(/^[-*]\s*/, "").trim();
      if (line.length < 3) continue;
      if (ECHO_MARKER.test(line)) { result.echoes += 1; continue; }
      const [rawTitle, ...rest] = line.split(/\s*:\s+/);
      const title = rawTitle.trim();
      const body = (rest.join(": ") || rawTitle).trim();
      if (!title) { result.rejected += 1; continue; }
      const exists = db.prepare("SELECT 1 FROM memory_items WHERE status = 'active' AND scope = ? AND scope_ref = ? AND lower(title) = lower(?) AND body = ?").get(scope, scopeRef, title.slice(0, 200), body.slice(0, 20000));
      if (exists) { result.duplicates += 1; continue; }
      try { add({ scope, scopeRef, type: "ASSUMPTION", title: title.slice(0, 200), body: body.slice(0, 20000), sourceRef: `import:${sourceKind}`, author: actor === "user" ? "import" : actor, sourceKind, syncDirection: "import_only" }); result.created += 1; }
      catch { result.rejected += 1; }
    }
    bus.append({ type: "memory.imported", scopeType: "memory", scopeId: sourceKind, source: actor, payload: result });
    return result;
  }

  return { add, revise, remove, get, search, contradictions, exportAll, exportForProvider, importFromText };
}
