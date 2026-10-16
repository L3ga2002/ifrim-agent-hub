// M11 „Ifrim Delivery” — provenance and staleness (pure). Every delivery item records the software snapshot it is evidence of and the
// items it derives from (upstream_json: real links, never inferred from kinds). This module walks those links.
//
//   bundle → e2e_shot, preview, capture, claim (and the whole summary document)
//   capture, brief, claim → edit(master)
//   edit(master) → render(master), variant          variant → render(vertical)
//   render → qa, export (and the video section of the summary)
//
// STALE      = the basis (software, rights, the file) changed: the item no longer proves anything. It never returns to CURRENT.
// SUPERSEDED = a newer version of the same role exists; the old one is still true for what it was made from.
//
// - cascade(items, rootIds, { mode, code, reason }) → the status updates of the roots and everything downstream (BFS). Idempotent;
//   it only ever moves CURRENT → SUPERSEDED → STALE, never back.
// - currentView(items, delivery) → what may be shown as current evidence: status CURRENT AND the item's snapshot is the delivery's
//   verified snapshot (the brief excepted) AND the delivery is not STALE or CLOSED. So an old clip is never current evidence for
//   different code, even if a status write were missed.
// - RULES + applyRule(trigger, state, ctx) → what each of the eleven triggers changes (items, variants to invalidate, documents,
//   the delivery's status). The delivery service applies the result in one transaction; nothing is written here.
// - variantsToInvalidate(updates), documentsToStale(updates, documents), documentsToRegenerate(updates, documents),
//   slotsComplete(items, delivery), previousOf(items, kind, role), linkProblems(items), DELIVERY_TRANSITIONS / canTransition.
// Items and documents are accepted as DB rows (snake_case, *_json strings) or as views (camelCase, parsed).
import { HubError } from "../core/errors.mjs";

export const ITEM_KINDS = Object.freeze(["bundle", "e2e_shot", "preview", "capture", "brief", "claim", "edit", "render", "variant", "qa", "export"]);
export const ITEM_STATUSES = Object.freeze(["CURRENT", "SUPERSEDED", "STALE"]);
export const STALE_CODES = Object.freeze(["SOFTWARE_CHANGED", "RIGHTS_REVOKED", "FILE_MISSING", "STUDIO_CORRECTED"]);
export const CASCADE_MODES = Object.freeze(["STALE", "SUPERSEDED"]);
/** The legal links: an item of kind K may list as upstream only items of UPSTREAM_KINDS[K]. */
export const UPSTREAM_KINDS = Object.freeze({
  bundle: Object.freeze([]), brief: Object.freeze([]),
  e2e_shot: Object.freeze(["bundle"]), preview: Object.freeze(["bundle"]), capture: Object.freeze(["bundle", "preview"]), claim: Object.freeze(["bundle", "e2e_shot"]),
  edit: Object.freeze(["capture", "brief", "claim"]), render: Object.freeze(["edit", "variant"]), variant: Object.freeze(["edit"]),
  qa: Object.freeze(["render"]), export: Object.freeze(["render"]),
});
/** The brief is the owner's direction (tone, kept choices), not evidence of the software: a software change never stales it. */
export const SOFTWARE_BOUND_KINDS = Object.freeze(ITEM_KINDS.filter((k) => k !== "brief"));
/** The slots a READY delivery has, each filled by a CURRENT item ([kind, role]; the bundle has no role). */
export const REQUIRED_SLOTS = Object.freeze([["bundle", null], ["capture", "desktop"], ["capture", "mobile"], ["edit", "master"], ["render", "master"], ["variant", "vertical"],
  ["render", "vertical"], ["qa", "master"], ["qa", "vertical"], ["export", "master"], ["export", "vertical"]].map((s) => Object.freeze(s)));
const RANK = Object.freeze({ CURRENT: 0, SUPERSEDED: 1, STALE: 2 });

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const parseJson = (value, fallback) => { if (typeof value !== "string") return value ?? fallback; try { return JSON.parse(value) ?? fallback; } catch { return fallback; } };

/** A delivery item as a plain view, whatever shape it came in. */
export function itemOf(row) {
  if (!isObject(row) || typeof row.id !== "string" || !row.id) throw new HubError("validation", "Element de livrare invalid (fără id).", { code: "DELIVERY_ITEM_INVALID" });
  const upstream = parseJson(row.upstream ?? row.upstream_json, []);
  return {
    id: row.id, deliveryId: row.deliveryId ?? row.delivery_id ?? null, kind: String(row.kind || ""), role: String(row.role || ""),
    refTable: String(row.refTable ?? row.ref_table ?? ""), refId: String(row.refId ?? row.ref_id ?? ""), refSha: String(row.refSha ?? row.ref_sha ?? ""),
    snapshotSha: String(row.snapshotSha ?? row.snapshot_sha ?? ""), generation: Number(row.generation ?? 1) || 1,
    upstream: Array.isArray(upstream) ? upstream.map(String) : [], supersedesId: row.supersedesId ?? row.supersedes_id ?? null,
    status: ITEM_STATUSES.includes(row.status) ? row.status : "CURRENT", staleCode: String(row.staleCode ?? row.stale_code ?? ""),
    statusReason: String(row.statusReason ?? row.status_reason ?? ""), meta: parseJson(row.meta ?? row.meta_json, {}) || {},
    createdAt: row.createdAt ?? row.created_at ?? null,
  };
}
const itemsOf = (items) => (Array.isArray(items) ? items : []).map(itemOf);

/**
 * `cascade(items, rootIds, { mode, code, reason, includeRoots = true })` → { updates, reached, missing }.
 * BFS from the roots along "is upstream of". Each update is { id, kind, role, refTable, refId, from, status, staleCode, statusReason }.
 * - mode "STALE": every reached item that is not STALE yet becomes STALE with `code` and `reason` (an item already STALE keeps its
 *   first code and reason: running the cascade twice changes nothing).
 * - mode "SUPERSEDED": only CURRENT items change; `code` (e.g. STUDIO_CORRECTED) is recorded on them when given.
 * - With code SOFTWARE_CHANGED a brief is never marked and never walked through.
 * Nothing is ever moved towards CURRENT.
 */
export function cascade(items, rootIds, { mode, code = "", reason = "", includeRoots = true } = {}) {
  if (!CASCADE_MODES.includes(mode)) throw new HubError("validation", `Mod de propagare necunoscut: ${String(mode).slice(0, 20)}.`, { code: "CASCADE_MODE_INVALID" });
  if (code && !STALE_CODES.includes(code)) throw new HubError("validation", `Cod de învechire necunoscut: ${String(code).slice(0, 30)}.`, { code: "CASCADE_CODE_INVALID" });
  if (mode === "STALE" && !code) throw new HubError("validation", "O învechire are nevoie de un cod (de ce nu mai dovedește nimic).", { code: "CASCADE_CODE_INVALID" });
  const list = itemsOf(items);
  const byId = new Map(list.map((i) => [i.id, i]));
  const children = new Map();
  for (const item of list) for (const up of item.upstream) { if (!children.has(up)) children.set(up, []); children.get(up).push(item.id); }
  const roots = [...new Set((Array.isArray(rootIds) ? rootIds : []).map(String))];
  const missing = roots.filter((id) => !byId.has(id));
  const skip = (item) => code === "SOFTWARE_CHANGED" && item.kind === "brief";
  const queue = roots.filter((id) => byId.has(id) && !skip(byId.get(id)));
  const seen = new Set(queue);
  const rootSet = new Set(queue);
  const updates = [];
  const text = String(reason || "").slice(0, 500);
  for (let i = 0; i < queue.length; i += 1) {
    const item = byId.get(queue[i]);
    if (includeRoots || !rootSet.has(item.id)) {
      const target = mode === "STALE" ? "STALE" : "SUPERSEDED";
      if (RANK[item.status] < RANK[target]) {
        updates.push({ id: item.id, kind: item.kind, role: item.role, refTable: item.refTable, refId: item.refId, from: item.status, status: target, staleCode: code, statusReason: text });
      }
    }
    for (const childId of children.get(item.id) || []) {
      const child = byId.get(childId);
      if (!child || seen.has(childId) || skip(child)) continue;
      seen.add(childId);
      queue.push(childId);
    }
  }
  return { updates, reached: queue, missing };
}

/** `items` with the updates applied (a copy; for chaining rules and for tests). An update can only raise an item's rank. */
export function applyUpdates(items, updates) {
  const byId = new Map((Array.isArray(updates) ? updates : []).map((u) => [u.id, u]));
  return itemsOf(items).map((item) => {
    const u = byId.get(item.id);
    return u && RANK[u.status] > RANK[item.status] ? { ...item, status: u.status, staleCode: u.staleCode || "", statusReason: u.statusReason || "" } : item;
  });
}

const deliveryOf = (delivery) => ({ id: delivery?.id ?? null, status: String(delivery?.status || ""), snapshotSha: String(delivery?.snapshotSha ?? delivery?.snapshot_sha ?? ""),
  envelopeId: delivery?.envelopeId ?? delivery?.envelope_id ?? null });

/** Why an item is not current evidence of this delivery, or null when it is. */
export function notCurrentReason(item, delivery) {
  const i = itemOf(item), d = deliveryOf(delivery);
  if (d.status === "STALE") return "DELIVERY_STALE";
  if (d.status === "CLOSED") return "DELIVERY_CLOSED";
  if (i.status !== "CURRENT") return i.status;
  if (i.kind !== "brief" && (!d.snapshotSha || i.snapshotSha !== d.snapshotSha)) return "SNAPSHOT_MISMATCH";
  return null;
}
/** `currentView(items, delivery)` → { current: [item], hidden: [{ id, kind, role, why }] } (see the header). */
export function currentView(items, delivery) {
  const current = [], hidden = [];
  for (const item of itemsOf(items)) {
    const why = notCurrentReason(item, delivery);
    if (why) hidden.push({ id: item.id, kind: item.kind, role: item.role, why }); else current.push(item);
  }
  return { current, hidden };
}

/**
 * `slotsComplete(items, delivery?)` → { complete, missing: ["render:vertical", …], slots }. With a delivery, only items that are
 * current evidence of it count (currentView); without one, items with status CURRENT.
 */
export function slotsComplete(items, delivery = null) {
  const pool = delivery ? currentView(items, delivery).current : itemsOf(items).filter((i) => i.status === "CURRENT");
  const slots = {}, missing = [];
  for (const [kind, role] of REQUIRED_SLOTS) {
    const key = role ? `${kind}:${role}` : kind;
    const hit = pool.find((i) => i.kind === kind && (role === null || i.role === role));
    slots[key] = hit ? hit.id : null;
    if (!hit) missing.push(key);
  }
  return { complete: missing.length === 0, missing, slots };
}

/** The item a new item of this kind and role supersedes: the newest one that is not STALE (CURRENT first), or null. */
export function previousOf(items, kind, role = "") {
  const same = itemsOf(items).filter((i) => i.kind === kind && i.role === String(role || "") && i.status !== "STALE");
  const byAge = (a, b) => (b.generation - a.generation) || String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
  return same.filter((i) => i.status === "CURRENT").sort(byAge)[0] || same.sort(byAge)[0] || null;
}

/** Links that do not follow the declared graph (an unknown id, a kind that may not be upstream of that kind, a self link). → [{ id, problem }] */
export function linkProblems(items) {
  const list = itemsOf(items);
  const byId = new Map(list.map((i) => [i.id, i]));
  const problems = [];
  for (const item of list) {
    if (!ITEM_KINDS.includes(item.kind)) { problems.push({ id: item.id, problem: `tip necunoscut „${item.kind}”` }); continue; }
    for (const up of item.upstream) {
      const source = byId.get(up);
      if (up === item.id) problems.push({ id: item.id, problem: "se leagă de el însuși" });
      else if (!source) problems.push({ id: item.id, problem: `legătură spre un element necunoscut (${up})` });
      else if (!UPSTREAM_KINDS[item.kind].includes(source.kind)) problems.push({ id: item.id, problem: `un element „${item.kind}” nu poate deriva dintr-un „${source.kind}”` });
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Variants and documents
// ---------------------------------------------------------------------------------------------------------------------------

/**
 * The media_variants ids to mark INVALIDATED: the variant items an update made STALE for a software or a rights reason — never for
 * a media revision, a missing file or a Studio correction.
 */
export function variantsToInvalidate(updates) {
  return [...new Set((Array.isArray(updates) ? updates : [])
    .filter((u) => u && u.kind === "variant" && u.status === "STALE" && ["SOFTWARE_CHANGED", "RIGHTS_REVOKED"].includes(u.staleCode) && u.refId)
    .map((u) => String(u.refId)))];
}

/** A summary document as a view: { id, status, version, itemIds (the items its video section used), bundleSha, serviceRefs }. */
export function documentOf(row) {
  const basis = parseJson(row?.basis ?? row?.basis_json, {}) || {};
  const ids = basis.videoItemIds ?? basis.video?.itemIds ?? basis.itemIds ?? [];
  const services = Array.isArray(basis.serviceRefs) ? basis.serviceRefs : [];
  return { id: String(row?.id || ""), status: String(row?.status || "CURRENT"), version: Number(row?.version ?? 1) || 1,
    itemIds: Array.isArray(ids) ? ids.map(String) : [], bundleSha: String(basis.bundleSha ?? basis.bundle?.sha ?? basis.bundle?.sha256 ?? ""),
    serviceRefs: services.map((s) => (isObject(s) ? `${s.id}@${s.version ?? ""}` : String(s))) };
}

/**
 * The CURRENT documents an update set makes STALE: the bundle became STALE (the whole document rests on it), or an item its video
 * section used became STALE. → [{ id, status: "STALE", reason }]
 */
export function documentsToStale(updates, documents = []) {
  const stale = (Array.isArray(updates) ? updates : []).filter((u) => u && u.status === "STALE");
  if (!stale.length) return [];
  const bundle = stale.find((u) => u.kind === "bundle");
  const staleIds = new Map(stale.map((u) => [u.id, u]));
  const out = [];
  for (const doc of (Array.isArray(documents) ? documents : []).map(documentOf)) {
    if (doc.status !== "CURRENT") continue;
    const hit = bundle || doc.itemIds.map((id) => staleIds.get(id)).find(Boolean);
    if (hit) out.push({ id: doc.id, status: "STALE", reason: hit.statusReason || "baza rezumatului s-a schimbat" });
  }
  return out;
}

/** The CURRENT documents whose video section used an item that was SUPERSEDED: a new version with only that section recomputed. */
export function documentsToRegenerate(updates, documents = []) {
  const superseded = new Set((Array.isArray(updates) ? updates : []).filter((u) => u && u.status === "SUPERSEDED").map((u) => u.id));
  if (!superseded.size) return [];
  return (Array.isArray(documents) ? documents : []).map(documentOf)
    .filter((doc) => doc.status === "CURRENT" && doc.itemIds.some((id) => superseded.has(id))).map((doc) => ({ id: doc.id, only: ["video"] }));
}

// ---------------------------------------------------------------------------------------------------------------------------
// The delivery status machine
// ---------------------------------------------------------------------------------------------------------------------------

export const DELIVERY_STATUSES = Object.freeze(["PLANNED", "ARMED", "ACTIVE", "READY", "NEEDS_OWNER", "STALE", "CLOSED", "CANCELLED", "EXPIRED", "FAILED"]);
export const DELIVERY_TRANSITIONS = Object.freeze({
  PLANNED: Object.freeze(["ARMED", "ACTIVE", "CANCELLED"]),
  ARMED: Object.freeze(["ARMED", "ACTIVE", "CANCELLED", "EXPIRED", "FAILED"]),
  ACTIVE: Object.freeze(["READY", "NEEDS_OWNER"]),
  // READY is permitted only through the verified correction finish path in the service.
  NEEDS_OWNER: Object.freeze(["ACTIVE", "STALE", "CLOSED", "ARMED", "READY"]),
  READY: Object.freeze(["NEEDS_OWNER", "STALE", "CLOSED"]),
  STALE: Object.freeze(["CLOSED"]),
  CLOSED: Object.freeze([]), CANCELLED: Object.freeze([]), EXPIRED: Object.freeze([]), FAILED: Object.freeze([]),
});
export const canTransition = (from, to) => Boolean(DELIVERY_TRANSITIONS[from]?.includes(to));

// ---------------------------------------------------------------------------------------------------------------------------
// Rules: trigger → what changes
// ---------------------------------------------------------------------------------------------------------------------------

const short = (v, n = 200) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
/**
 * One row per trigger of the stale rules. `mode`/`code`: the item cascade (null = no item changes). `roots`: which items start it.
 * `sweep`: also every software-bound item the links did not reach (a missed link must not leave an old clip CURRENT).
 * `variants`: INVALIDATE the variants the cascade staled. `documents`: STALE | REGENERATE_VIDEO | SERVICE (only documents citing the
 * service). `delivery`: { to, from[] } — applied only from one of `from`. `reason(ctx)`: the owner-facing reason.
 */
export const RULES = Object.freeze({
  software_changed: Object.freeze({ mode: "STALE", code: "SOFTWARE_CHANGED", roots: "bundle", sweep: true, variants: true, documents: "STALE",
    delivery: Object.freeze({ to: "STALE", from: Object.freeze(["READY", "NEEDS_OWNER"]) }), reason: (ctx) => `software-ul s-a schimbat: ${short(ctx.cause) || "versiunea verificată nu mai este cea din proiect"}` }),
  software_revision: Object.freeze({ mode: "STALE", code: "SOFTWARE_CHANGED", roots: "bundle", sweep: true, variants: true, documents: "STALE",
    delivery: Object.freeze({ to: "STALE", from: Object.freeze(["READY", "NEEDS_OWNER"]) }), reason: (ctx) => `revizie software în curs: misiunea ${short(ctx.missionId, 80) || "nouă"}` }),
  media_revision: Object.freeze({ mode: "SUPERSEDED", code: "", roots: "edit:master", sweep: false, variants: false, documents: "REGENERATE_VIDEO", delivery: null,
    reason: () => "înlocuit de o versiune nouă a montajului" }),
  vertical_revision: Object.freeze({ mode: "SUPERSEDED", code: "", roots: "variant", sweep: false, variants: false, documents: "REGENERATE_VIDEO", delivery: null,
    reason: () => "înlocuit de o versiune nouă a variantei verticale" }),
  studio_correction: Object.freeze({ mode: "SUPERSEDED", code: "STUDIO_CORRECTED", roots: "ref", sweep: false, variants: false, documents: null,
    delivery: Object.freeze({ to: "NEEDS_OWNER", from: Object.freeze(["READY"]) }), reason: () => "clipul a fost corectat în Studio; randez din nou?" }),
  rights_revoked: Object.freeze({ mode: "STALE", code: "RIGHTS_REVOKED", roots: "ref", sweep: false, variants: true, documents: "STALE",
    delivery: Object.freeze({ to: "NEEDS_OWNER", from: Object.freeze(["READY"]) }), reason: () => "drepturile unui material folosit au fost retrase" }),
  file_missing: Object.freeze({ mode: "STALE", code: "FILE_MISSING", roots: "ref", sweep: false, variants: false, documents: "STALE",
    delivery: Object.freeze({ to: "NEEDS_OWNER", from: Object.freeze(["READY"]) }), reason: () => "fișierul unui material lipsește de pe disc" }),
  catalog_changed: Object.freeze({ mode: null, code: "", roots: null, sweep: false, variants: false, documents: "SERVICE", delivery: null,
    reason: (ctx) => `serviciul ${short(ctx.serviceName || ctx.serviceId, 80) || "din catalog"} s-a schimbat` }),
  accepted: Object.freeze({ mode: null, code: "", roots: null, sweep: false, variants: false, documents: null, delivery: null, reason: () => "software acceptat de proprietar" }),
  plan_stopped: Object.freeze({ mode: null, code: "", roots: null, sweep: false, variants: false, documents: null,
    delivery: Object.freeze({ to: "NEEDS_OWNER", from: Object.freeze(["ACTIVE"]) }), reason: (ctx) => short(ctx.reason) || "planul de livrare s-a oprit" }),
  envelope_closed: Object.freeze({ mode: null, code: "", roots: null, sweep: false, variants: false, documents: null, delivery: null,
    reason: (ctx) => `planul confirmat s-a închis înainte de livrare (${short(ctx.envelopeStatus, 30) || "închis"})` }),
});
export const TRIGGERS = Object.freeze(Object.keys(RULES));

/** PLANNED / ARMED → CANCELLED or EXPIRED when ITS envelope closes before activation (a continuation that re-armed the row is not touched). */
function envelopeOutcome(delivery, ctx) {
  const d = deliveryOf(delivery);
  if (!ctx.envelopeId || d.envelopeId !== ctx.envelopeId) return null;
  const status = String(ctx.envelopeStatus || "");
  if (d.status === "PLANNED" && ["SUPERSEDED", "EXPIRED", "CANCELLED", "REVOKED"].includes(status)) return "CANCELLED";
  if (d.status === "ARMED" && status === "EXPIRED") return "EXPIRED";
  if (d.status === "ARMED" && ["REVOKED", "CANCELLED", "FAILED_TO_START"].includes(status)) return "CANCELLED";
  return null;
}

/**
 * `applyRule(trigger, { items, delivery, documents }, ctx)` →
 *   { trigger, reason, itemUpdates, orphans, variants, documentUpdates, documentRegenerations, delivery, bundleMeta }
 * ctx by trigger: software_changed { cause } · software_revision { missionId } · media_revision / vertical_revision { rootIds?,
 * keepIds? — the NEW items when they are already bound, so they are neither roots nor updated } ·
 * studio_correction / file_missing { refIds: [edit or asset version ids] } · rights_revoked { refIds: [asset or version ids from
 * rights.revocationImpact] } · catalog_changed { serviceId, version?, serviceName? } · accepted {} · plan_stopped { reason } ·
 * envelope_closed { envelopeId, envelopeStatus }.
 * `orphans` are the ids the sweep had to add (software-bound items no link reached): a signal of a missing link, not an error.
 * `delivery` is { status, reason } or null (no change, or the transition is not allowed from the current status).
 */
export function applyRule(trigger, { items = [], delivery = null, documents = [] } = {}, ctx = {}) {
  const rule = RULES[trigger];
  if (!rule) throw new HubError("validation", `Declanșator necunoscut: ${String(trigger).slice(0, 40)}.`, { code: "STALE_TRIGGER_UNKNOWN" });
  const list = itemsOf(items);
  const reason = rule.reason(ctx || {});
  let itemUpdates = [];
  const orphans = [];
  if (rule.mode) {
    const refIds = new Set((Array.isArray(ctx.refIds) ? ctx.refIds : []).map(String));
    const roots = Array.isArray(ctx.rootIds) && ctx.rootIds.length ? ctx.rootIds.map(String)
      : rule.roots === "bundle" ? list.filter((i) => i.kind === "bundle").map((i) => i.id)
        : rule.roots === "edit:master" ? list.filter((i) => i.kind === "edit" && i.role === "master" && i.status === "CURRENT").map((i) => i.id)
          : rule.roots === "variant" ? list.filter((i) => i.kind === "variant" && i.status === "CURRENT").map((i) => i.id)
            : list.filter((i) => refIds.has(i.refId) || (i.meta?.editVersionId && refIds.has(String(i.meta.editVersionId)))).map((i) => i.id);
    const keep = new Set((Array.isArray(ctx.keepIds) ? ctx.keepIds : []).map(String));
    itemUpdates = cascade(list.filter((i) => !keep.has(i.id)), roots.filter((id) => !keep.has(id)), { mode: rule.mode, code: rule.code, reason }).updates;
    if (rule.sweep) {
      const touched = new Set(itemUpdates.map((u) => u.id));
      for (const item of list) {
        if (touched.has(item.id) || keep.has(item.id) || item.status === "STALE" || !SOFTWARE_BOUND_KINDS.includes(item.kind)) continue;
        orphans.push(item.id);
        itemUpdates.push({ id: item.id, kind: item.kind, role: item.role, refTable: item.refTable, refId: item.refId, from: item.status, status: "STALE", staleCode: rule.code, statusReason: reason.slice(0, 500) });
      }
    }
    // A Studio correction supersedes the chain; only the RENDERS carry the code (they are what is no longer the corrected clip).
    if (trigger === "studio_correction") itemUpdates = itemUpdates.map((u) => (u.kind === "render" ? u : { ...u, staleCode: "" }));
  }
  const docs = (Array.isArray(documents) ? documents : []).map(documentOf);
  let documentUpdates = [];
  let documentRegenerations = [];
  if (rule.documents === "STALE") documentUpdates = documentsToStale(itemUpdates, documents);
  else if (rule.documents === "REGENERATE_VIDEO") documentRegenerations = documentsToRegenerate(itemUpdates, documents);
  else if (rule.documents === "SERVICE") {
    const id = String(ctx.serviceId || "");
    const exact = ctx.version === undefined || ctx.version === null ? null : `${id}@${ctx.version}`;
    documentUpdates = !id ? [] : docs.filter((d) => d.status === "CURRENT" && d.serviceRefs.some((r) => (exact ? r === exact : r === id || r.startsWith(`${id}@`))))
      .map((d) => ({ id: d.id, status: "STALE", reason }));
  }
  const d = deliveryOf(delivery);
  let next = null;
  if (trigger === "envelope_closed") { const to = envelopeOutcome(delivery, ctx || {}); if (to) next = { status: to, reason }; }
  else if (rule.delivery && rule.delivery.from.includes(d.status) && canTransition(d.status, rule.delivery.to)) {
    // A rule that changed nothing leaves the delivery alone (e.g. a missing file no item refers to).
    if (!rule.mode || itemUpdates.length) next = { status: rule.delivery.to, reason };
  }
  const bundleMeta = trigger === "accepted" ? list.filter((i) => i.kind === "bundle" && i.status === "CURRENT").map((i) => ({ id: i.id, meta: { ...i.meta, bundleStatus: "OWNER_ACCEPTED" } })) : [];
  return { trigger, reason, itemUpdates, orphans, variants: rule.variants ? variantsToInvalidate(itemUpdates) : [], documentUpdates, documentRegenerations, delivery: next, bundleMeta };
}
