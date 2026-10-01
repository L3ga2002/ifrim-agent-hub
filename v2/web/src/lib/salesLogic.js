// Pure helpers for the Sales screen (no DOM, no React) — covered by v2/tests/m04-ui-logic.test.mjs.
//
// The Sales REST API (contract §5 in .ifrim/M04_SALES_ARCHITECTURE.md, routes in server/http/routes.mjs, shapes in
// server/sales/sales.mjs) answers in camelCase. Every view still reads records through the `*View` functions below, which
// also accept raw SQLite columns (snake_case, *_json strings, 0/1 integers): a naming difference shows up as an empty
// field instead of a crashed screen, and the mapping is tested in one place (v2/tests/m04-ui-logic.test.mjs).

/* ---------------- generic accessors ---------------- */

/** First value among `names` that is neither undefined nor null. */
export function pick(obj, ...names) {
  if (!obj || typeof obj !== "object") return undefined;
  for (const name of names) { if (obj[name] !== undefined && obj[name] !== null) return obj[name]; }
  return undefined;
}

/** A JSON column read as a value: objects/arrays pass through, JSON text is parsed, anything else is the fallback. */
export function parseMaybeJson(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "string") return value;
  const t = value.trim();
  if (!(t.startsWith("{") || t.startsWith("[") || t === "null")) return fallback;
  try { const v = JSON.parse(t); return v === null ? fallback : v; } catch { return fallback; }
}

/** SQLite booleans arrive as 0/1; null/undefined stay null (unknown is not false). */
export function toBool(value) {
  if (value === undefined || value === null || value === "") return null;
  return value === true || value === 1 || value === "1" || value === "true";
}

const arr = (value) => { const v = parseMaybeJson(value, []); return Array.isArray(v) ? v : []; };
const obj = (value) => { const v = parseMaybeJson(value, {}); return v && typeof v === "object" && !Array.isArray(v) ? v : {}; };
const str = (value) => (value === undefined || value === null ? "" : String(value));

/** The list inside a response: `{ <key>: [...] }`, `{ items: [...] }` or a bare array. */
export function listOf(response, key) {
  if (Array.isArray(response)) return response;
  const v = pick(response, key, "items");
  return Array.isArray(v) ? v : [];
}

/** Collapses whitespace and cuts long text; sales data is always rendered as plain text, never as HTML. */
export function textExcerpt(value, max = 200) {
  const t = str(value).replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, Math.max(0, max - 1)).trimEnd()}…` : t;
}

/* ---------------- status vocabularies ---------------- */

export const ORG_STATUSES = Object.freeze(["NEW", "NEEDS_RESEARCH", "QUALIFIED", "AUDITED", "OPPORTUNITY", "ON_HOLD", "DISQUALIFIED", "DO_NOT_CONTACT"]);
export const OPP_STATUSES = Object.freeze(["IDENTIFIED", "PROPOSAL_DRAFT", "READY_FOR_OWNER_REVIEW", "APPROVED_INTERNAL", "CONTACTED", "IN_DISCUSSION", "WON", "LOST", "ON_HOLD"]);
export const DRAFT_STATUSES = Object.freeze(["DRAFT", "CONTENT_APPROVED", "SEND_AUTHORIZED", "SENT", "SUPERSEDED", "CANCELLED"]);

// [Romanian label, tone]. Tone feeds the existing .chip classes; the label is always shown, colour is never the only signal.
const STATUS_META = {
  org: {
    NEW: ["Nouă", "neutral"], NEEDS_RESEARCH: ["Necesită research", "info"], QUALIFIED: ["Calificată", "info"], AUDITED: ["Auditată", "info"],
    OPPORTUNITY: ["Oportunitate", "ok"], ON_HOLD: ["În așteptare", "warn"], DISQUALIFIED: ["Descalificată", "neutral"], DO_NOT_CONTACT: ["Nu contacta", "error"],
  },
  opp: {
    IDENTIFIED: ["Identificată", "neutral"], PROPOSAL_DRAFT: ["Propunere în lucru", "info"], READY_FOR_OWNER_REVIEW: ["De revizuit de tine", "approval"],
    APPROVED_INTERNAL: ["Aprobată intern", "ok"], CONTACTED: ["Contactată", "info"], IN_DISCUSSION: ["În discuție", "info"], WON: ["Câștigată", "ok"],
    LOST: ["Pierdută", "neutral"], ON_HOLD: ["În așteptare", "warn"],
  },
  draft: {
    DRAFT: ["Ciornă", "neutral"], CONTENT_APPROVED: ["Conținut aprobat", "ok"], SEND_AUTHORIZED: ["Trimitere autorizată", "warn"], SENT: ["Trimis", "ok"],
    SUPERSEDED: ["Înlocuită", "neutral"], CANCELLED: ["Anulată", "neutral"], PENDING_APPROVAL: ["Așteaptă aprobare", "approval"],
  },
  proposal: {
    DRAFT: ["Ciornă", "neutral"], PENDING_APPROVAL: ["Așteaptă aprobare", "approval"], APPROVED_INTERNAL: ["Aprobată intern", "ok"], APPROVED: ["Aprobată", "ok"],
    SUPERSEDED: ["Înlocuită", "neutral"], REJECTED: ["Respinsă", "error"], CANCELLED: ["Anulată", "neutral"],
  },
  batch: {
    UPLOADED: ["Încărcat", "neutral"], MAPPED: ["Mapat", "info"], PREVIEWED: ["Previzualizat", "info"], IMPORTING: ["Import întrerupt (se reia)", "warn"],
    IMPORTED: ["Importat", "ok"], FAILED: ["Eșuat", "error"], ROLLED_BACK: ["Anulat (rollback)", "neutral"], CANCELLED: ["Anulat", "neutral"],
  },
  // Preview statuses (CREATE, MATCH, …) and stored ones after the import (CREATED, MATCHED, …), as in server/sales/sales.mjs.
  row: {
    PENDING: ["În așteptare", "neutral"], CREATE: ["Firmă nouă", "ok"], CREATED: ["Creată", "ok"], MATCH: ["Potrivire sigură", "info"],
    MATCHED: ["Potrivită", "info"], NEEDS_REVIEW: ["De revizuit", "approval"], INVALID: ["Invalid", "error"], SKIPPED: ["Sărit", "neutral"],
    DUPLICATE_IN_FILE: ["Duplicat în fișier", "warn"], SUPPRESSED: ["Nu contacta (suprimat)", "error"],
  },
  followup: {
    PENDING: ["Programat", "info"], SCHEDULED: ["Programat", "info"], DUE: ["Scadent", "approval"], SUSPENDED: ["Suspendat", "warn"], DONE: ["Făcut", "ok"],
    CANCELLED: ["Anulat", "neutral"], EXPIRED: ["Expirat", "neutral"],
  },
  audit: { PASS: ["În regulă", "ok"], ISSUE: ["Problemă", "warn"], UNKNOWN: ["Necunoscut", "neutral"], NOT_APPLICABLE: ["Nu se aplică", "neutral"] },
  evidence: {
    USER_PROVIDED: ["Furnizat de tine", "info"], OBSERVED: ["Observat", "ok"], SOURCE_REPORTED: ["Raportat de sursă", "info"], INFERRED: ["Dedus", "warn"], UNKNOWN: ["Necunoscut", "neutral"],
  },
  handoff: { DRAFT_CREATED: ["Pachet creat", "ok"], SUPERSEDED: ["Depășit de o propunere nouă", "warn"] },
  freshness: { CURRENT: ["Actuală", "ok"], NEEDS_RECHECK: ["Necesită reverificare", "warn"], SUPERSEDED: ["Înlocuită", "neutral"], ROLLED_BACK: ["Anulată (rollback)", "neutral"] },
  contactEvent: {
    MANUAL_RECORDED: ["Contact făcut de tine", "info"], REPLY_RECORDED: ["Răspuns înregistrat", "ok"], OPT_OUT: ["Opoziție la contact", "error"],
    SENT_VIA_HUB: ["Trimis prin Hub", "ok"],
  },
};

/** `{ label, tone }` for a status of a given kind; unknown statuses keep their raw code (never hidden). */
export function statusMeta(kind, status) {
  const hit = STATUS_META[kind]?.[status];
  if (hit) return { label: hit[0], tone: hit[1] };
  return { label: status ? String(status) : "—", tone: "neutral" };
}

export const EVIDENCE_LABELS = Object.freeze(["USER_PROVIDED", "OBSERVED", "SOURCE_REPORTED", "INFERRED", "UNKNOWN"]);

export const DOMAIN_KIND_RO = Object.freeze({
  organization_site: "site propriu", social_profile: "profil social (nu identifică firma)", marketplace_listing: "listare marketplace",
  directory: "director de firme", article: "articol (nu e site de firmă)", shared_hosting: "găzduire partajată", invalid: "adresă invalidă",
});

export const AUDIT_CHECK_RO = Object.freeze({
  identity_name: "Numele firmei apare pe site", title_present: "Titlul paginii", services_described: "Serviciile sunt descrise", navigation: "Navigare",
  contact_phone: "Telefon de contact", contact_email: "E-mail de contact", contact_address: "Adresă", contact_form: "Formular de contact",
  form_labels: "Etichete în formular", mobile_viewport: "Afișare pe mobil (viewport)", https: "HTTPS", lang_attr: "Limba paginii declarată",
  images_alt: "Text alternativ la imagini", internal_anchors: "Legături interne",
});

export const COMPONENT_RO = Object.freeze({ serviceFit: "Potrivire cu serviciile", evidence: "Calitatea dovezilor", completeness: "Completitudinea datelor" });
export const FINANCIAL_FILTER_RO = Object.freeze({ PASS: "trece", FAIL: "nu trece", UNKNOWN: "necunoscut (nu exclude firma)" });
export const CONTACT_KIND_RO = Object.freeze({ email: "E-mail", phone: "Telefon", person: "Persoană", website: "Site" });
/** Channels of a contact the owner made outside the Hub (free text on the server, max 40 characters). */
export const CONTACT_CHANNELS = Object.freeze([["phone", "Telefon"], ["email", "E-mail trimis de tine, în afara Hub-ului"], ["meeting", "Întâlnire"], ["other", "Alt canal"]]);
export const contactChannelLabel = (channel) => CONTACT_CHANNELS.find(([id]) => id === channel)?.[1] || CONTACT_KIND_RO[channel] || String(channel || "");

/** Fiscal code (CUI) validity as text: valid / invalid (control digit) / missing. */
export function fiscalCodeText(value, valid) {
  if (!value) return { text: "lipsă", tone: "neutral" };
  if (valid === true) return { text: "valid (cifră de control corectă)", tone: "ok" };
  if (valid === false) return { text: "invalid (cifra de control nu se potrivește)", tone: "error" };
  return { text: "neverificat", tone: "neutral" };
}

/** Internal priority, never a sale probability; null means no component was known. */
export function priorityText(priority) {
  if (priority === null || priority === undefined || priority === "" || !Number.isFinite(Number(priority))) return "necunoscută";
  return `${Math.round(Number(priority))}/100`;
}

/* ---------------- record views ---------------- */

export function orgView(raw = {}) {
  const o = raw || {};
  return {
    id: str(pick(o, "id")),
    name: str(pick(o, "displayName", "display_name", "name")),
    legalForm: str(pick(o, "legalForm", "legal_form")),
    fiscalCode: str(pick(o, "fiscalCode", "fiscal_code")),
    fiscalCodeValid: toBool(pick(o, "fiscalCodeValid", "fiscal_code_valid")),
    website: str(pick(o, "website")),
    domain: str(pick(o, "domain")),
    domainKind: str(pick(o, "domainKind", "domain_kind")),
    city: str(pick(o, "city")),
    county: str(pick(o, "county")),
    address: str(pick(o, "address")),
    caen: str(pick(o, "caen")),
    status: str(pick(o, "status")),
    synthetic: toBool(pick(o, "synthetic")) === true,
    version: Number(pick(o, "version")) || 1,
    needsReview: toBool(pick(o, "needsReview", "needs_review")) === true,
    priority: pick(o, "priority") ?? null,
    mergedInto: str(pick(o, "mergedInto", "merged_into")),
    archivedAt: str(pick(o, "archivedAt", "archived_at")),
    updatedAt: str(pick(o, "updatedAt", "updated_at")),
    createdAt: str(pick(o, "createdAt", "created_at")),
  };
}

export function contactView(raw = {}) {
  return {
    id: str(pick(raw, "id")), kind: str(pick(raw, "kind")), value: str(pick(raw, "value")), raw: str(pick(raw, "raw")),
    generic: toBool(pick(raw, "generic")) === true, personName: str(pick(raw, "personName", "person_name")), role: str(pick(raw, "role")),
    warnings: arr(pick(raw, "warnings", "warnings_json")).map(String), status: str(pick(raw, "status")) || "ACTIVE",
    evidenceId: str(pick(raw, "evidenceId", "evidence_id")),
  };
}

export function evidenceView(raw = {}) {
  // `value` is the decoded value; `value_json` is the raw column, which may hold any JSON scalar ("\"text\"", 42, null).
  let value = pick(raw, "value");
  if (value === undefined) {
    const encoded = pick(raw, "value_json");
    try { value = typeof encoded === "string" ? JSON.parse(encoded) : encoded; } catch { value = encoded; }
  }
  return {
    id: str(pick(raw, "id")), claim: str(pick(raw, "claim")), value: value === undefined || value === null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value),
    label: str(pick(raw, "label")) || "UNKNOWN", sourceKind: str(pick(raw, "sourceKind", "source_kind")), sourceRef: str(pick(raw, "sourceRef", "source_ref")),
    retrievedAt: str(pick(raw, "retrievedAt", "retrieved_at")), excerpt: str(pick(raw, "excerpt")), method: str(pick(raw, "method")),
    verifiedAt: str(pick(raw, "verifiedAt", "verified_at")), recheckAfter: str(pick(raw, "recheckAfter", "recheck_after")),
    // Freshness is computed by the Hub (CURRENT | NEEDS_RECHECK | SUPERSEDED); nothing is deleted, superseded items stay as history.
    freshness: str(pick(raw, "freshness")) || "CURRENT", freshnessReason: str(pick(raw, "freshnessReason")),
    conflictsWith: arr(pick(raw, "conflictsWith")).map(String),
    synthetic: toBool(pick(raw, "synthetic")) === true, createdAt: str(pick(raw, "createdAt", "created_at")),
  };
}

/** `evidenceStatus` of the company sheet: counters and the contradictions (both sides keep their evidence). */
export function evidenceStatusView(raw = {}) {
  const o = obj(raw);
  return {
    current: Number(o.current) || 0, needsRecheck: Number(o.needsRecheck) || 0, superseded: Number(o.superseded) || 0, rolledBack: Number(o.rolledBack) || 0,
    contradictions: arr(o.contradictions).map((c) => ({ id: str(c?.id), claim: str(c?.claim), conflictsWith: arr(c?.conflictsWith).map(String) })),
  };
}

/** Evidence no longer used by the Hub (kept as history): a newer reading superseded it, or its import batch was rolled back. */
export const isHistoricalEvidence = (e) => ["SUPERSEDED", "ROLLED_BACK"].includes(str(e?.freshness));

/** Evidence ordered for reading: current first, then the ones to recheck, then the history (superseded, rolled back; each newest first). */
export function orderEvidence(list = []) {
  const rank = { CURRENT: 0, NEEDS_RECHECK: 1, SUPERSEDED: 2, ROLLED_BACK: 3 };
  return list.map((e, i) => [e, i]).sort((a, b) => (rank[a[0].freshness] ?? 0) - (rank[b[0].freshness] ?? 0) || b[1] - a[1]).map(([e]) => e);
}

export function auditView(raw = {}) {
  const result = obj(pick(raw, "result", "result_json"));
  const checks = arr(pick(result, "checks") ?? pick(raw, "checks"));
  return {
    id: str(pick(raw, "id")), url: str(pick(raw, "url") ?? pick(result, "url")), sourceKind: str(pick(raw, "sourceKind", "source_kind") ?? pick(result, "sourceKind")),
    version: str(pick(raw, "version") ?? pick(result, "version")), createdAt: str(pick(raw, "createdAt", "created_at", "fetchedAt", "fetched_at")),
    checks: checks.map((c) => ({
      id: str(c?.id), area: str(c?.area), status: str(c?.status) || "UNKNOWN", observation: str(c?.observation), label: str(c?.label),
      evidence: { selector: str(c?.evidence?.selector), excerpt: str(c?.evidence?.excerpt), method: str(c?.evidence?.method) },
    })),
    limits: arr(pick(result, "limits") ?? pick(raw, "limits")).map(String),
    opportunities: arr(pick(raw, "opportunities", "opportunities_json")),
    synthetic: toBool(pick(raw, "synthetic")) === true,
  };
}

const componentView = (c) => {
  const score = c?.score;
  return { score: score === null || score === undefined || !Number.isFinite(Number(score)) ? null : Number(score),
    contributions: arr(c?.contributions).map((x) => ({ factor: str(x?.factor), points: Number(x?.points) || 0, evidenceIds: arr(x?.evidenceIds).map(String) })) };
};

export function qualificationView(raw = {}) {
  if (!raw) return null;
  const result = obj(pick(raw, "result", "result_json"));
  const base = Object.keys(result).length ? result : raw;
  const components = obj(pick(base, "components"));
  const override = parseMaybeJson(pick(raw, "override", "override_json") ?? pick(base, "override"), null);
  const priority = pick(raw, "priority") ?? pick(base, "priority") ?? null;
  // After an override `priority` is the owner's value; the formula's own result stays in `computedPriority`
  // (server/sales/qualify.mjs applyOverride), or in the override entry as `previousPriority`.
  const computed = pick(base, "computedPriority") ?? (override && typeof override === "object" ? pick(override, "previousPriority") : undefined) ?? priority;
  const num = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
  return {
    id: str(pick(raw, "id")), version: str(pick(base, "version") ?? pick(raw, "formulaVersion", "formula_version")),
    components: Object.fromEntries(["serviceFit", "evidence", "completeness"].map((k) => [k, componentView(components[k])])),
    priority: num(priority), computedPriority: num(computed),
    unknowns: arr(pick(base, "unknowns")).map(String), explanation: arr(pick(base, "explanation")).map(String),
    financialFilter: obj(pick(base, "financialFilter")),
    override: override && typeof override === "object" ? override : null,
    history: arr(pick(base, "overrides") ?? pick(override || {}, "history") ?? pick(base, "history")),
    createdAt: str(pick(raw, "createdAt", "created_at")),
  };
}

export function transitionView(raw = {}) {
  return { id: str(pick(raw, "id")), from: str(pick(raw, "from", "fromStatus", "from_status")), to: str(pick(raw, "to", "toStatus", "to_status")),
    actor: str(pick(raw, "actor")), reason: str(pick(raw, "reason")), at: str(pick(raw, "createdAt", "created_at", "at")) };
}

export function oppView(input = {}) {
  const raw = input || {};
  return {
    id: str(pick(raw, "id")), orgId: str(pick(raw, "orgId", "org_id")), orgName: str(pick(raw, "orgName", "org_name") ?? pick(raw.org || {}, "displayName", "display_name", "name")),
    title: str(pick(raw, "title")), need: str(pick(raw, "need")), serviceId: str(pick(raw, "serviceId", "service_id")), status: str(pick(raw, "status")),
    nextAction: str(pick(raw, "nextAction", "next_action")), nextActionAt: str(pick(raw, "nextActionAt", "next_action_at")),
    synthetic: toBool(pick(raw, "synthetic")) === true, version: Number(pick(raw, "version")) || 1,
    updatedAt: str(pick(raw, "updatedAt", "updated_at")), createdAt: str(pick(raw, "createdAt", "created_at")),
  };
}

/** Internally approved in its current form: APPROVED_INTERNAL and the approval bound to the exact content hash. */
export function proposalApproved(p) {
  const v = p && typeof p.sha === "string" && "approvedSha" in p ? p : proposalView(p);
  return ["APPROVED_INTERNAL", "APPROVED"].includes(v.status) && Boolean(v.approvedSha) && (!v.sha || v.approvedSha === v.sha);
}

export function proposalView(raw = {}) {
  const content = obj(pick(raw, "content", "content_json"));
  return {
    id: str(pick(raw, "id")), version: Number(pick(raw, "version")) || 1, status: str(pick(raw, "status")),
    // `sha` is the server's `contentSha`: the exact text the owner sees and approves (sent back as `displayedSha`).
    sha: str(pick(raw, "contentSha", "content_sha", "sha")), approvedSha: str(pick(raw, "approvedSha", "approved_sha")),
    approvedAt: str(pick(raw, "approvedAt", "approved_at")), approvalId: str(pick(raw, "approvalId", "approval_id")),
    title: str(pick(content, "title") ?? pick(raw, "title")),
    sections: arr(pick(content, "sections") ?? pick(raw, "sections")).map((s) => ({ id: str(s?.id), heading: str(s?.heading), text: str(s?.text) })),
    claimsToVerify: arr(pick(content, "claimsToVerify") ?? pick(raw, "claimsToVerify")).map(String),
    warnings: arr(pick(content, "warnings") ?? pick(raw, "warnings")).map(String),
    usedEvidenceIds: arr(pick(content, "usedEvidenceIds") ?? pick(raw, "usedEvidenceIds")).map(String),
    text: str(pick(content, "text") ?? pick(raw, "text")),
    createdAt: str(pick(raw, "createdAt", "created_at")),
  };
}

export function draftView(raw = {}) {
  const meta = obj(pick(raw, "meta", "meta_json"));
  return {
    id: str(pick(raw, "id")), version: Number(pick(raw, "version")) || 1, status: str(pick(raw, "status")), channel: str(pick(raw, "channel")) || "email",
    subject: str(pick(raw, "subject")), body: str(pick(raw, "body")), sha: str(pick(raw, "contentSha", "content_sha", "sha")),
    approvedSha: str(pick(raw, "approvedSha", "approved_sha")), contactId: str(pick(raw, "contactId", "contact_id")), proposalId: str(pick(raw, "proposalId", "proposal_id")),
    recipients: arr(pick(raw, "recipients", "recipients_json")).map((r) => (typeof r === "string" ? r : str(r?.value || r?.email))),
    claimsToVerify: arr(pick(raw, "claimsToVerify") ?? meta.claimsToVerify).map(String),
    personalizationBasis: arr(pick(raw, "personalizationBasis") ?? meta.personalizationBasis).map((p) => ({ text: str(p?.text ?? p), evidenceId: str(p?.evidenceId) })),
    proposalSha: str(pick(raw, "proposalSha") ?? meta.proposalSha), followupId: str(meta.followupId),
    createdAt: str(pick(raw, "createdAt", "created_at")), updatedAt: str(pick(raw, "updatedAt", "updated_at")),
  };
}

export function serviceView(raw = {}) {
  return {
    id: str(pick(raw, "id")), name: str(pick(raw, "name")), description: str(pick(raw, "description")),
    scope: arr(pick(raw, "scope", "scope_json")).map(String), exclusions: arr(pick(raw, "exclusions", "exclusions_json")).map(String),
    tags: arr(pick(raw, "tags", "tags_json")).map(String),
    price: { status: "NOT_CONFIGURED", ...obj(pick(raw, "price", "price_json")) },
    leadTime: { status: "NOT_CONFIGURED", ...obj(pick(raw, "leadTime", "lead_time", "lead_time_json")) },
    active: toBool(pick(raw, "active")) !== false, synthetic: toBool(pick(raw, "synthetic")) === true, version: Number(pick(raw, "version")) || 1,
    updatedAt: str(pick(raw, "updatedAt", "updated_at")),
  };
}

export function batchView(raw = {}) {
  return {
    id: str(pick(raw, "id")), fileName: str(pick(raw, "fileName", "file_name")), fileKind: str(pick(raw, "fileKind", "file_kind")),
    sizeBytes: Number(pick(raw, "sizeBytes", "size_bytes")) || 0, encoding: str(pick(raw, "encoding")), delimiter: str(pick(raw, "delimiter")),
    sheet: str(pick(raw, "sheet")), sheets: arr(pick(raw, "sheets", "sheets_json")).map(String), headers: arr(pick(raw, "headers", "headers_json")).map(String),
    suggested: obj(pick(raw, "suggestedMapping", "suggested", "suggested_json")), mapping: obj(pick(raw, "mapping", "mapping_json")),
    warnings: arr(pick(raw, "warnings", "warnings_json")).map(String), status: str(pick(raw, "status")),
    synthetic: toBool(pick(raw, "synthetic")) === true, rowCount: Number(pick(raw, "rowCount", "row_count")) || 0,
    counts: obj(pick(raw, "counts", "counts_json")), createdAt: str(pick(raw, "createdAt", "created_at")),
    importedAt: str(pick(raw, "importedAt", "imported_at")), rolledBackAt: str(pick(raw, "rolledBackAt", "rolled_back_at")),
  };
}

/**
 * An import row: a stored row (GET /api/sales/imports/:id → rows.items, the record under `normalized.record` once
 * processed) or a preview row (POST …/preview → rows, the record at top level). `record` is the normalized company.
 */
export function importRowView(raw = {}) {
  const normalized = obj(pick(raw, "normalized", "normalized_json"));
  const rowIndex = Number(pick(raw, "rowIndex", "row_index")) || 0;
  const record = obj(pick(raw, "record") ?? normalized.record);
  return {
    id: str(pick(raw, "id")), rowIndex, sheetRow: Number(pick(raw, "sheetRow")) || rowIndex + 2, status: str(pick(raw, "status")),
    raw: parseMaybeJson(pick(raw, "raw", "raw_json"), []), normalized, record,
    errors: arr(pick(raw, "errors", "errors_json")).map(String), warnings: arr(pick(raw, "warnings", "warnings_json")).map(String),
    matches: arr(pick(raw, "matches", "match", "match_json")), orgId: str(pick(raw, "orgId", "org_id")),
  };
}

/** The list and total inside a paged answer: `{ items, total }`, a bare array, or `{ <key>: { items, total } }`. */
export function pagedOf(response, key) {
  const inner = key && response && typeof response === "object" && !Array.isArray(response) ? response[key] : response;
  if (Array.isArray(inner)) return { items: inner, total: inner.length };
  const items = Array.isArray(inner?.items) ? inner.items : [];
  return { items, total: Number.isFinite(Number(inner?.total)) ? Number(inner.total) : items.length };
}

/** A hand-off record of GET /api/sales/opportunities/:id (or the creation answer `{ handoffId, missionId, … }`). */
export function handoffView(raw = {}) {
  return {
    id: str(pick(raw, "id", "handoffId")), status: str(pick(raw, "status")) || "DRAFT_CREATED", missionId: str(pick(raw, "missionId", "mission_id")),
    proposalSha: str(pick(raw, "proposalSha", "proposal_sha")), packageSha: str(pick(raw, "packageSha", "package_sha")),
    outdated: toBool(pick(raw, "outdated")) === true, note: str(pick(raw, "note")), createdAt: str(pick(raw, "createdAt", "created_at")),
  };
}

export function followupView(raw = {}) {
  return {
    id: str(pick(raw, "id")), opportunityId: str(pick(raw, "opportunityId", "opportunity_id")), orgId: str(pick(raw, "orgId", "org_id")),
    orgName: str(pick(raw, "orgName", "org_name")), oppTitle: str(pick(raw, "opportunityTitle", "opportunity_title", "title")),
    dueAt: str(pick(raw, "dueAt", "due_at")), basis: str(pick(raw, "basis")), status: str(pick(raw, "status")), reason: str(pick(raw, "reason")),
    draftId: str(pick(raw, "draftId", "draft_id")), expiresAt: str(pick(raw, "expiresAt", "expires_at")),
  };
}

/* ---------------- overview ---------------- */

export const COUNT_LABELS = Object.freeze({
  orgs: "firme", total: "total", needsReview: "de revizuit", contacts: "contacte", audits: "audituri", qualified: "calificate",
  opportunities: "oportunități", openOpportunities: "oportunități deschise", proposals: "propuneri", drafts: "ciorne",
  draftsAwaitingReview: "ciorne de revizuit", followups: "follow-up-uri", followupsDue: "follow-up scadente", imports: "importuri",
  batches: "loturi de import", suppressed: "suprimate", suppressions: "suprimări (nu contacta)", services: "servicii", won: "câștigate", lost: "pierdute",
  synthetic: "sintetice", configured: "cu preț configurat", configuredPrices: "cu preț configurat", missingWebsite: "fără site", missingContact: "fără contact",
  matchedContacts: "contacte adăugate la firme existente",
  // Import summaries (preview: CREATE, MATCH, …; after the import: CREATED, MATCHED, …).
  CREATE: "firme noi", MATCH: "potriviri sigure", NEEDS_REVIEW: "de revizuit", DUPLICATE_IN_FILE: "duplicate în fișier", INVALID: "invalide",
  SUPPRESSED: "suprimate (nu contacta)", warnings: "cu avertismente", CREATED: "create", MATCHED: "potrivite", SKIPPED: "sărite", PENDING: "neprocesate încă",
});

/** Numeric counters of an object as `{ key, label, value }` (nested objects and non-numbers are skipped). */
export function countEntries(counts) {
  const o = obj(counts);
  return Object.entries(o).filter(([, v]) => typeof v === "number" && Number.isFinite(v)).map(([key, value]) => ({ key, label: COUNT_LABELS[key] || key, value }));
}

/** `{ STATUS: n }` or `[{ status, count }]` → `[[status, n]]`. */
export function normalizeCounts(value) {
  if (Array.isArray(value)) return value.filter((x) => x && (x.status || x.key)).map((x) => [String(x.status ?? x.key), Number(x.count ?? x.n ?? x.value) || 0]);
  return Object.entries(obj(value)).filter(([, v]) => typeof v === "number").map(([k, v]) => [k, v]);
}

/** Catalog summary from the overview: an array of services or `{ services, configured }`. */
export function catalogSummary(catalog) {
  if (Array.isArray(catalog)) {
    const services = catalog.map(serviceView);
    return { services: services.length, configured: services.filter((s) => s.price.status === "CONFIGURED").length };
  }
  const o = obj(catalog);
  return { services: Number(o.services ?? o.total ?? o.count) || 0, configured: Number(o.configuredPrices ?? o.configured ?? o.priced) || 0 };
}

/** Counters of an import batch: what the import did when it ran, else what the preview found (`counts.imported|preview`). */
export function batchCounts(batch) {
  const counts = obj(batch?.counts);
  const pickOne = counts.imported && Object.keys(obj(counts.imported)).length ? counts.imported : counts.preview || counts;
  return countEntries(pickOne);
}

export const SYNTHETIC_BANNER = "Date sintetice: firmele, contactele și site-urile afișate aici sunt fictive (domenii .test), generate pentru test. Nu sunt firme reale și nu se contactează.";
export const SYNTHETIC_MIXED_BANNER = "Atenție: baza conține și date sintetice (fictive, domenii .test). Fiecare înregistrare sintetică are eticheta „sintetic”.";

/**
 * Banner text for the overview's `synthetic` field (boolean, count, or `{ any|count, all|total }`); null when no synthetic data.
 * The banner is persistent: it stays on every Sales tab while synthetic records exist.
 */
export function syntheticBannerText(synthetic) {
  if (synthetic === true || synthetic === 1) return SYNTHETIC_BANNER;
  if (typeof synthetic === "number") return synthetic > 0 ? SYNTHETIC_MIXED_BANNER : null;
  const o = obj(synthetic);
  if (o.all === true || o.only === true) return SYNTHETIC_BANNER;
  const count = Number(o.count ?? o.orgs ?? o.synthetic ?? 0);
  const total = Number(o.total ?? 0);
  if (o.any === true || count > 0) return total > 0 && count >= total ? SYNTHETIC_BANNER : SYNTHETIC_MIXED_BANNER;
  return null;
}

/**
 * Banner for GET /api/sales/overview → `synthetic` (true when ANY synthetic record exists) and the number of real
 * (non-synthetic) companies, when known: "everything is fictive" only when there is no real company; mixed otherwise or
 * while that number is unknown.
 */
export function syntheticBannerFor(synthetic, realOrgs = null) {
  if (synthetic !== true) return syntheticBannerText(synthetic);
  return realOrgs === 0 ? SYNTHETIC_BANNER : SYNTHETIC_MIXED_BANNER;
}

/** Real (non-synthetic) companies from the overview: `counts.orgs - syntheticOrgs`; null when the server does not say. */
export function realOrgCount(overview) {
  const total = Number(overview?.counts?.orgs);
  const synthetic = Number(overview?.syntheticOrgs);
  if (!Number.isFinite(total) || overview?.syntheticOrgs === undefined || overview?.syntheticOrgs === null || !Number.isFinite(synthetic)) return null;
  return Math.max(0, total - synthetic);
}

export const OUTREACH_DISABLED_CODE = "OUTREACH_DISABLED";
export const OUTREACH_DISABLED_REASON = "Trimiterea e dezactivată în M04 (OUTREACH_DISABLED): Hub-ul pregătește doar ciorne. Contactul real îl faci tu, în afara Hub-ului, și îl înregistrezi aici manual.";

/** Outreach is DISABLED unless the server explicitly says otherwise (it cannot in M04); the Send button stays disabled. */
export function outreachState(overview) {
  const value = pick(overview || {}, "outreach");
  const mode = typeof value === "string" ? value : str(pick(value || {}, "status", "mode")) || "DISABLED";
  return { mode, sendEnabled: false, reason: OUTREACH_DISABLED_REASON };
}

/* ---------------- pipeline ---------------- */

/** Opportunities grouped by status in lifecycle order (empty groups kept), unknown statuses appended; counts per group. */
export function groupPipeline(opportunities = []) {
  const groups = new Map(OPP_STATUSES.map((s) => [s, []]));
  for (const raw of opportunities || []) {
    const o = oppView(raw);
    const key = o.status || "UNKNOWN";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(o);
  }
  return [...groups.entries()].map(([status, items]) => {
    const sorted = items.slice().sort((a, b) => (a.nextActionAt || "9999").localeCompare(b.nextActionAt || "9999") || a.title.localeCompare(b.title, "ro"));
    return { status, ...statusMeta("opp", status), count: items.length, items: sorted };
  });
}

/**
 * Manual opportunity moves, the same table as the server (OPPORTUNITY_TRANSITIONS in server/sales/sales.mjs).
 * APPROVED_INTERNAL, CONTACTED and WON are never offered: they follow the proposal approval, a contact event and the
 * client's acceptance.
 */
const OPP_MANUAL = Object.freeze({
  IDENTIFIED: ["PROPOSAL_DRAFT", "ON_HOLD", "LOST"],
  PROPOSAL_DRAFT: ["READY_FOR_OWNER_REVIEW", "ON_HOLD", "LOST"],
  READY_FOR_OWNER_REVIEW: ["PROPOSAL_DRAFT", "ON_HOLD", "LOST"],
  APPROVED_INTERNAL: ["PROPOSAL_DRAFT", "ON_HOLD", "LOST"],
  CONTACTED: ["IN_DISCUSSION", "ON_HOLD", "LOST"],
  IN_DISCUSSION: ["ON_HOLD", "LOST"],
  ON_HOLD: ["IDENTIFIED", "PROPOSAL_DRAFT", "IN_DISCUSSION", "LOST"],
});
export function oppManualTargets(status, { realContact = true } = {}) {
  // IN_DISCUSSION needs a real contact event (SENT_VIA_HUB or MANUAL_RECORDED), as the server checks.
  return (OPP_MANUAL[status] || []).filter((s) => s !== "IN_DISCUSSION" || realContact);
}

/**
 * Manual organisation moves allowed by the server (LEAD_TRANSITIONS). AUDITED and OPPORTUNITY follow an audit and a new
 * opportunity; DO_NOT_CONTACT goes through the suppression form (with a reason) and only an approved lift leaves it.
 */
const ORG_MANUAL = Object.freeze({
  NEW: ["NEEDS_RESEARCH", "QUALIFIED", "ON_HOLD", "DISQUALIFIED"],
  NEEDS_RESEARCH: ["QUALIFIED", "ON_HOLD", "DISQUALIFIED"],
  QUALIFIED: ["NEEDS_RESEARCH", "ON_HOLD", "DISQUALIFIED"],
  AUDITED: ["QUALIFIED", "NEEDS_RESEARCH", "ON_HOLD", "DISQUALIFIED"],
  OPPORTUNITY: ["ON_HOLD", "DISQUALIFIED"],
  ON_HOLD: ["NEW", "NEEDS_RESEARCH", "QUALIFIED", "DISQUALIFIED"],
  DISQUALIFIED: ["NEEDS_RESEARCH"],
});
export function orgManualTargets(status) {
  return [...(ORG_MANUAL[status] || [])];
}

/** Reasons the server requires (minimum length) for a status change, a suppression and its lift. */
export const REASON_MIN = Object.freeze({ transition: 3, suppress: 3, lift: 5, override: 5 });

/* ---------------- filters / paging ---------------- */

export const ORG_PAGE_SIZE = 50;
export const ORG_SORTS = Object.freeze([["updated_desc", "Actualizate recent"], ["name_asc", "Nume A → Z"], ["priority_desc", "Prioritate (internă)"], ["created_desc", "Adăugate recent"]]);
const SORT_IDS = new Set(ORG_SORTS.map(([id]) => id));

const intIn = (value, lo, hi, fallback) => { const n = Number(value); return Number.isInteger(n) && n >= lo && n <= hi ? n : fallback; };

/** Filters from the hash query (`#/sales?tab=orgs&q=…`); unknown values fall back to defaults. */
export function parseOrgFilters(query = {}) {
  const q = query || {};
  return {
    q: str(q.q).slice(0, 120), status: ORG_STATUSES.includes(q.status) ? q.status : "", city: str(q.city).slice(0, 80),
    synthetic: ["1", "0"].includes(q.synthetic) ? q.synthetic : "", needsReview: q.needsReview === "1" || q.needsReview === "true",
    sort: SORT_IDS.has(q.sort) ? q.sort : "updated_desc", offset: intIn(q.offset, 0, 10_000_000, 0), limit: ORG_PAGE_SIZE,
  };
}

/** Query string for GET /api/sales/orgs: empty filters are omitted, paging is clamped. */
export function buildOrgQuery(filters = {}) {
  const p = new URLSearchParams();
  const q = str(filters.q).trim();
  if (q) p.set("q", q.slice(0, 120));
  if (filters.status) p.set("status", filters.status);
  const city = str(filters.city).trim();
  if (city) p.set("city", city.slice(0, 80));
  if (filters.synthetic === "1" || filters.synthetic === "0") p.set("synthetic", filters.synthetic);
  if (filters.needsReview === true) p.set("needsReview", "1");
  if (filters.sort && SORT_IDS.has(filters.sort)) p.set("sort", filters.sort);
  p.set("offset", String(intIn(filters.offset, 0, 10_000_000, 0)));
  p.set("limit", String(intIn(filters.limit, 1, 200, ORG_PAGE_SIZE)));
  return p.toString();
}

/** Paging summary in Romanian ("1–50 din 230"), with previous/next offsets. */
export function pageInfo({ total = 0, offset = 0, limit = ORG_PAGE_SIZE } = {}) {
  const t = Math.max(0, Number(total) || 0);
  const l = Math.max(1, Number(limit) || ORG_PAGE_SIZE);
  const o = Math.min(Math.max(0, Number(offset) || 0), Math.max(0, t - 1));
  const from = t ? o + 1 : 0;
  const to = Math.min(t, o + l);
  return { from, to, total: t, page: Math.floor(o / l) + 1, pages: Math.max(1, Math.ceil(t / l)), hasPrev: o > 0, hasNext: o + l < t,
    prevOffset: Math.max(0, o - l), nextOffset: o + l, label: t ? `${from}–${to} din ${t}` : "0 rezultate" };
}

/* ---------------- import mapping ---------------- */

export const MAPPING_FIELDS = Object.freeze([
  ["name", "Nume firmă"], ["fiscalCode", "CUI / cod fiscal"], ["website", "Site"], ["email", "E-mail"], ["phone", "Telefon"], ["city", "Oraș"],
  ["county", "Județ"], ["address", "Adresă"], ["caen", "Cod CAEN"], ["contactName", "Persoană de contact"], ["contactRole", "Rolul persoanei"],
  ["turnover", "Cifră de afaceri"], ["turnoverYear", "Anul cifrei de afaceri"], ["employees", "Număr de angajați"], ["notes", "Note"],
  ["source", "Sursa datelor"], ["ignore", "Ignoră coloana"],
]);
const FIELD_IDS = new Set(MAPPING_FIELDS.map(([id]) => id));
/**
 * Fields that may come from several columns. The Hub maps every field except "ignore" to one column only
 * (server/sales/sales.mjs normalizeMapping refuses a field on two columns); a cell may still hold several
 * e-mails or phones separated by `;` or `,`.
 */
const MULTI_FIELDS = new Set(["ignore"]);

export const mappingFieldLabel = (field) => MAPPING_FIELDS.find(([id]) => id === field)?.[1] || String(field || "—");

/**
 * Mapping keyed by column index ("0", "1", …), as the Hub stores and suggests it (two columns may share a header).
 * Every column gets a field: the saved mapping, else the server's suggestion, else "ignore"; keys given as header
 * text are accepted too.
 */
export function initialMapping(headers = [], saved = {}, suggested = {}) {
  const s = obj(saved); const g = obj(suggested);
  const fieldOf = (m, i, h) => (FIELD_IDS.has(m[String(i)]) ? m[String(i)] : FIELD_IDS.has(m[h]) ? m[h] : null);
  return Object.fromEntries(headers.map((h, i) => [String(i), fieldOf(s, i, h) || fieldOf(g, i, h) || "ignore"]));
}

/** Column name for messages: the header, or "coloana N" when it has none. */
const columnName = (headers, key) => {
  const i = /^\d+$/.test(String(key)) ? Number(key) : -1;
  if (!headers) return String(key);
  return i >= 0 && i < headers.length ? (str(headers[i]).trim() || `coloana ${i + 1}`) : String(key);
};

/** Blocking problems (errors) and advice (warnings) for an index-keyed mapping, before it is sent to the Hub. */
export function validateMapping(mapping = {}, headers = null) {
  const errors = []; const warnings = [];
  const inRange = (col) => !headers || (/^\d+$/.test(String(col)) && Number(col) < headers.length);
  const entries = Object.entries(obj(mapping)).filter(([col]) => inRange(col));
  const byField = new Map();
  for (const [col, field] of entries) {
    if (!FIELD_IDS.has(field)) { errors.push(`Câmp necunoscut pentru coloana „${columnName(headers, col)}”: ${field}`); continue; }
    if (!byField.has(field)) byField.set(field, []);
    byField.get(field).push(columnName(headers, col));
  }
  if (!byField.has("name")) errors.push("Alege coloana cu numele firmei (obligatoriu).");
  for (const [field, cols] of byField) {
    if (cols.length > 1 && !MULTI_FIELDS.has(field)) errors.push(`Câmpul „${mappingFieldLabel(field)}” e ales pentru mai multe coloane: ${cols.join(", ")}. Hub-ul acceptă o singură coloană pe câmp.`);
  }
  if (!byField.has("fiscalCode") && !byField.has("website") && !byField.has("email")) warnings.push("Fără CUI, site sau e-mail, duplicatele se pot recunoaște doar după nume și oraș.");
  if (byField.has("turnover") && !byField.has("turnoverYear")) warnings.push("Cifra de afaceri fără an nu poate fi folosită de filtrul financiar (rezultatul rămâne necunoscut).");
  return { ok: errors.length === 0, errors, warnings };
}

/** A cell of an imported row: raw rows are arrays aligned with the columns (by index), or objects keyed by header. */
export function rawCell(raw, headers = [], column) {
  const row = parseMaybeJson(raw, raw);
  const index = typeof column === "number" ? column : headers.indexOf(column);
  if (Array.isArray(row)) return index >= 0 ? str(row[index]) : "";
  const header = typeof column === "number" ? headers[column] : column;
  return row && typeof row === "object" ? str(row[header]) : "";
}

/** Up to `max` distinct non-empty sample values per column index, to help the owner choose the field. */
export function columnSamples(rows = [], headers = [], max = 3) {
  return Object.fromEntries(headers.map((_, i) => {
    const seen = [];
    for (const r of rows) {
      const v = textExcerpt(rawCell(r?.raw ?? r?.raw_json ?? r, headers, i), 60);
      if (v && !seen.includes(v)) seen.push(v);
      if (seen.length >= max) break;
    }
    return [String(i), seen];
  }));
}

export const MATCH_STRENGTH_RO = Object.freeze({ STRONG: "potrivire sigură (același CUI)", CANDIDATE: "posibil duplicat", CONFLICT: "conflict (de verificat)" });

/* ---------------- files ---------------- */

export const IMPORT_MAX_BYTES = 20 * 1024 * 1024;
const IMPORT_EXT = Object.freeze({ csv: "csv", tsv: "csv", xlsx: "xlsx" });

/** Client check before upload (the Hub validates again): CSV/TSV/XLSX up to 20 MB; macros and legacy .xls refused. */
export function validateImportFile({ name = "", size = 0 } = {}) {
  const n = str(name).trim();
  if (!n) return { ok: false, reason: "Fișier fără nume" };
  if (n.length > 200) return { ok: false, reason: "Numele fișierului depășește 200 de caractere" };
  const ext = n.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() || "";
  if (["xlsm", "xltm", "xlsb"].includes(ext)) return { ok: false, reason: "Fișierele Excel cu macro-uri nu se acceptă. Salvează ca .xlsx sau .csv." };
  if (ext === "xls") return { ok: false, reason: "Formatul vechi .xls nu e suportat. Salvează ca .xlsx sau .csv." };
  const kind = IMPORT_EXT[ext];
  if (!kind) return { ok: false, reason: "Tip neacceptat: doar .csv, .tsv sau .xlsx" };
  if (!size) return { ok: false, reason: "Fișier gol" };
  if (size > IMPORT_MAX_BYTES) return { ok: false, reason: `Fișierul are ${(size / 1048576).toFixed(1).replace(".", ",")} MB; limita este 20 MB` };
  return { ok: true, kind };
}

/** Bytes → base64 in chunks (no call-stack overflow on large files). */
export function bytesToBase64(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  let binary = "";
  for (let i = 0; i < u8.length; i += 0x8000) binary += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** A browser File/Blob → base64 of its exact bytes (the Hub decodes and parses; nothing is read from disk paths). */
export async function fileToBase64(file) {
  if (!file || typeof file.arrayBuffer !== "function") throw new Error("Fișier invalid");
  return bytesToBase64(new Uint8Array(await file.arrayBuffer()));
}

/* ---------------- services ---------------- */

export const KNOWN_SERVICE_TAGS = Object.freeze(["website", "responsive", "contact", "seo-basic", "accessibility"]);
export const CURRENCIES = Object.freeze(["RON", "EUR", "USD"]);
export const PRICE_UNITS = Object.freeze([["project", "proiect"], ["month", "lună"], ["hour", "oră"], ["page", "pagină"]]);
export const LEAD_UNITS = Object.freeze([["days", "zile lucrătoare"], ["weeks", "săptămâni"]]);
export const NOT_CONFIGURED_TEXT = "De stabilit (neconfigurat)";

export const splitLines = (text) => str(text).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
export const splitTags = (text) => [...new Set(str(text).split(/[,;\n]/).map((s) => s.trim().toLowerCase()).filter(Boolean))];

/** Romanian number input: "1.500,50" → 1500.5, "1500" → 1500, "1.500" → 1500, "2.5" → 2.5; invalid → null. */
export function parseRoNumber(text) {
  let t = str(text).replace(/\s| /g, "");
  if (!t) return null;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const unitLabel = (list, id) => list.find(([k]) => k === id)?.[1] || id;

export function formatPrice(price) {
  const p = obj(price);
  if (p.status !== "CONFIGURED" || !Number.isFinite(Number(p.amount))) return NOT_CONFIGURED_TEXT;
  const amount = Number(p.amount).toLocaleString("ro-RO", { maximumFractionDigits: 2 });
  return `${amount} ${p.currency || ""}${p.unit ? ` / ${unitLabel(PRICE_UNITS, p.unit)}` : ""}`.replace(/\s+\//, " /").trim();
}

/** Lead time as stored by the Hub: `{ status: "CONFIGURED", text }` (free text, max 80); `value`/`unit` read too. */
export function formatLeadTime(leadTime) {
  const l = obj(leadTime);
  if (l.status !== "CONFIGURED") return NOT_CONFIGURED_TEXT;
  if (str(l.text).trim()) return str(l.text).trim();
  const value = Number(l.value ?? l.days);
  if (!Number.isFinite(value) || value <= 0) return NOT_CONFIGURED_TEXT;
  return `${value} ${unitLabel(LEAD_UNITS, l.unit || (l.days !== undefined ? "days" : ""))}`.trim();
}

/** Limits of the catalog command (sales.service.save) and of what the Hub keeps. */
export const SERVICE_LIMITS = Object.freeze({ nameMin: 3, nameMax: 120, description: 1000, lines: 20, lineMax: 200, tags: 10, tagMax: 40, leadText: 80 });

/** Editor form for a service (strings only, so inputs stay controlled). */
export function serviceToForm(raw) {
  const s = serviceView(raw || {});
  const leadText = s.leadTime.status === "CONFIGURED" ? formatLeadTime(s.leadTime) : "";
  return {
    name: s.name, description: s.description, scope: s.scope.join("\n"), exclusions: s.exclusions.join("\n"), tags: s.tags.join(", "),
    priceStatus: s.price.status === "CONFIGURED" ? "CONFIGURED" : "NOT_CONFIGURED",
    amount: s.price.amount === undefined || s.price.amount === null ? "" : String(s.price.amount).replace(".", ","),
    currency: CURRENCIES.includes(s.price.currency) ? s.price.currency : "RON", unit: s.price.unit || "project",
    leadStatus: s.leadTime.status === "CONFIGURED" ? "CONFIGURED" : "NOT_CONFIGURED",
    leadText: leadText === NOT_CONFIGURED_TEXT ? "" : leadText, active: s.active,
  };
}

/** Form → API payload, or the problems that block saving. A price exists only when CONFIGURED with an amount. */
export function serviceFormToPayload(form = {}) {
  const errors = [];
  const L = SERVICE_LIMITS;
  const name = str(form.name).trim();
  if (name.length < L.nameMin) errors.push(`Numele serviciului are cel puțin ${L.nameMin} caractere.`);
  if (name.length > L.nameMax) errors.push(`Numele serviciului are cel mult ${L.nameMax} de caractere.`);
  const description = str(form.description).trim();
  if (description.length > L.description) errors.push(`Descrierea are cel mult ${L.description} de caractere.`);
  let price = { status: "NOT_CONFIGURED" };
  if (form.priceStatus === "CONFIGURED") {
    const amount = parseRoNumber(form.amount);
    if (amount === null || amount <= 0) errors.push("Prețul configurat cere o sumă pozitivă (ex.: 1.500 sau 1500,50).");
    if (!CURRENCIES.includes(form.currency)) errors.push("Alege moneda (RON, EUR sau USD).");
    if (!PRICE_UNITS.some(([id]) => id === form.unit)) errors.push("Alege unitatea prețului.");
    price = { status: "CONFIGURED", amount, currency: form.currency, unit: form.unit };
  }
  let leadTime = { status: "NOT_CONFIGURED" };
  if (form.leadStatus === "CONFIGURED") {
    const text = str(form.leadText).replace(/\s+/g, " ").trim();
    if (text.length < 2 || text.length > L.leadText) errors.push(`Termenul configurat are între 2 și ${L.leadText} de caractere (ex.: „10 zile lucrătoare”).`);
    leadTime = { status: "CONFIGURED", text };
  }
  const tags = splitTags(form.tags);
  if (tags.some((t) => t.length > L.tagMax)) errors.push(`O etichetă are cel mult ${L.tagMax} de caractere.`);
  if (tags.length > L.tags) errors.push(`Cel mult ${L.tags} etichete.`);
  const scope = splitLines(form.scope);
  const exclusions = splitLines(form.exclusions);
  for (const [label, list] of [["„Ce include”", scope], ["„Ce nu include”", exclusions]]) {
    if (list.length > L.lines) errors.push(`${label} are cel mult ${L.lines} de rânduri.`);
    if (list.some((line) => line.length > L.lineMax)) errors.push(`Un rând din ${label} are peste ${L.lineMax} de caractere.`);
  }
  const payload = { name, description, scope, exclusions, tags, price, leadTime, active: form.active !== false };
  return { ok: errors.length === 0, errors, payload };
}

/* ---------------- follow-ups ---------------- */

const CLOSED_FOLLOWUP = new Set(["DONE", "CANCELLED", "EXPIRED"]);

/** overdue / due (within 24 h) / upcoming / suspended / closed, from the status and due date. */
export function followupState(raw, now = new Date()) {
  const f = followupView(raw);
  if (f.status === "SUSPENDED") return "suspended";
  if (CLOSED_FOLLOWUP.has(f.status)) return "closed";
  const due = Date.parse(f.dueAt);
  if (!Number.isFinite(due)) return "upcoming";
  const t = now instanceof Date ? now.getTime() : Number(now);
  if (due < t) return "overdue";
  if (due - t <= 24 * 3600 * 1000) return "due";
  return "upcoming";
}
export const FOLLOWUP_STATE_META = Object.freeze({
  overdue: { label: "Depășit", tone: "error" }, due: { label: "Scadent în 24 h", tone: "approval" }, upcoming: { label: "Programat", tone: "info" },
  suspended: { label: "Suspendat", tone: "warn" }, closed: { label: "Închis", tone: "neutral" },
});

/* ---------------- confirmations / readiness ---------------- */

/** Fallbacks only: the sentences checked by the Hub come from GET /api/sales/overview → `confirmations`. */
export const CONFIRMATION_TEXTS = Object.freeze({
  manualContact: "Confirm că am contactat această firmă în afara Hub-ului",
  clientAcceptance: "Confirm că clientul a acceptat această propunere",
});

/** The confirmation sentence the owner must type: the server's (overview.confirmations) when given, else the default. */
export function confirmationText(overview, kind) {
  const fromServer = pick(pick(overview || {}, "confirmations") || {}, kind);
  return typeof fromServer === "string" && fromServer.trim() ? fromServer.trim() : CONFIRMATION_TEXTS[kind] || "";
}

const normSentence = (t) => str(t).normalize("NFC").replace(/\s+/g, " ").trim().toLocaleLowerCase("ro-RO");
/** Typed confirmation equals the expected sentence (case and spacing aside; diacritics must match). */
export const confirmationMatches = (typed, expected) => Boolean(normSentence(expected)) && normSentence(typed) === normSentence(expected);

/** The newest proposal version (the only one the Hub approves, accepts or hands off). */
export const latestProposal = (proposals = []) => (proposals || []).map((p) => (p && typeof p.sha === "string" && "approvedSha" in p ? p : proposalView(p)))
  .sort((a, b) => b.version - a.version)[0] || null;

/**
 * Client acceptance, as the Hub checks it: for the LATEST proposal version, approved internally in its current form,
 * after a real contact (the opportunity is CONTACTED or IN_DISCUSSION).
 */
export function acceptanceReadiness(opp, proposals = [], contactEvents = null) {
  const o = oppView(opp);
  if (["WON", "LOST"].includes(o.status)) return { ok: false, reason: `Oportunitatea e deja ${statusMeta("opp", o.status).label.toLowerCase()}.` };
  if (Array.isArray(contactEvents) && !hasRealContact(contactEvents)) return { ok: false, reason: "Acceptarea vine după un contact real: înregistrează întâi contactul făcut de tine." };
  const latest = latestProposal(proposals);
  if (!latest) return { ok: false, reason: "Acceptarea cere o propunere aprobată de tine." };
  if (!proposalApproved(latest)) return { ok: false, reason: `Ultima versiune a propunerii (v${latest.version}) nu e aprobată intern; acceptarea se înregistrează doar pentru ea.` };
  if (!["CONTACTED", "IN_DISCUSSION"].includes(o.status)) return { ok: false, reason: "Acceptarea vine după un contact real: înregistrează întâi contactul făcut de tine." };
  return { ok: true, proposal: latest };
}

/**
 * Internal approval of a proposal (ALWAYS_ASK, bound to the displayed hash): only the latest DRAFT version, and only
 * once the opportunity is marked "ready for review" (READY_FOR_OWNER_REVIEW).
 */
export function proposalApprovalReadiness(opp, proposal, proposals = []) {
  const o = oppView(opp);
  const p = proposal && typeof proposal.sha === "string" && "approvedSha" in proposal ? proposal : proposalView(proposal);
  const latest = latestProposal(proposals);
  if (latest && latest.id !== p.id) return { ok: false, reason: "Există o versiune mai nouă; doar ultima versiune se aprobă." };
  if (proposalApproved(p)) return { ok: false, reason: "" };
  if (p.status !== "DRAFT") return { ok: false, reason: `Propunerea e ${statusMeta("proposal", p.status).label.toLowerCase()}.` };
  if (o.status === "PROPOSAL_DRAFT") return { ok: false, needsReview: true, reason: "Marchează întâi propunerea „gata de revizuire”; apoi ceri aprobarea." };
  if (o.status !== "READY_FOR_OWNER_REVIEW") return { ok: false, reason: `Aprobarea internă se cere din starea „${statusMeta("opp", "READY_FOR_OWNER_REVIEW").label}” (acum: „${statusMeta("opp", o.status).label}”).` };
  return { ok: true, reason: "" };
}

/** Follow-up from the last real contact needs one (sent via the Hub or recorded manually by the owner). */
export const hasRealContact = (contactEvents = []) => (contactEvents || []).some((e) => ["SENT_VIA_HUB", "MANUAL_RECORDED"].includes(str(e?.kind)));
export const FOLLOWUP_BASIS_RO = Object.freeze({ last_contact: "la N zile după ultimul contact real", explicit_date: "la o dată aleasă de tine" });
export const FOLLOWUP_DAYS = Object.freeze({ min: 1, max: 90 });

/**
 * Body for POST /api/sales/opportunities/:id/followups, or the reason it cannot be sent. `last_contact` needs a real
 * contact and 1..90 days; `explicit_date` needs a valid date.
 */
export function followupPayload({ basis, afterDays, dueAt } = {}, { contactEvents = [] } = {}) {
  if (basis === "last_contact") {
    if (!hasRealContact(contactEvents)) return { ok: false, reason: "Nu există încă un contact real înregistrat: alege o dată." };
    const days = Number(afterDays);
    if (!Number.isInteger(days) || days < FOLLOWUP_DAYS.min || days > FOLLOWUP_DAYS.max) return { ok: false, reason: `Zilele după contact: între ${FOLLOWUP_DAYS.min} și ${FOLLOWUP_DAYS.max}.` };
    return { ok: true, body: { basis: "last_contact", afterDays: days } };
  }
  if (basis === "explicit_date") {
    const t = Date.parse(str(dueAt));
    if (!Number.isFinite(t)) return { ok: false, reason: "Alege data follow-up-ului." };
    return { ok: true, body: { basis: "explicit_date", dueAt: new Date(t).toISOString() } };
  }
  return { ok: false, reason: "Alege baza follow-up-ului." };
}

/** A follow-up draft can be prepared while the follow-up is DUE or SCHEDULED (no message is sent). */
export const followupDraftable = (f) => ["DUE", "SCHEDULED"].includes(str(f?.status)) && !str(f?.draftId ?? f?.draft_id);

/** Manual contact record: not for closed opportunities or an organisation marked DO_NOT_CONTACT. */
export function contactReadiness(opp, org) {
  const o = oppView(opp);
  if (orgView(org).status === "DO_NOT_CONTACT") return { ok: false, reason: "Firma e marcată „Nu contacta”." };
  if (["WON", "LOST"].includes(o.status)) return { ok: false, reason: "Oportunitatea e închisă." };
  return { ok: true };
}

/**
 * Site audit in M04 reads local fixtures only (`<host>.html` for `.test` hosts); live collection is disabled, so an
 * organisation without a `.test` domain cannot be audited and the button says why instead of failing on the server.
 */
export function auditReadiness(org) {
  const o = orgView(org);
  const host = (o.domain || o.website.replace(/^[a-z]+:\/\//i, "").split(/[/?#]/)[0]).toLowerCase().replace(/^www\./, "");
  if (!host) return { ok: false, reason: "Firma nu are site sau domeniu cunoscut." };
  if (!/\.test$/.test(host)) return { ok: false, reason: "Colectarea live e dezactivată în M04 (LIVE_COLLECTION_DISABLED): auditul rulează doar pe fixture-uri locale (.test)." };
  return { ok: true, host };
}

/** Newest first by createdAt (records without a date keep their order at the end). */
export function newestFirst(items = []) {
  return items.map((x, i) => [x, i]).sort((a, b) => {
    const ta = Date.parse(a[0]?.createdAt || a[0]?.created_at || ""); const tb = Date.parse(b[0]?.createdAt || b[0]?.created_at || "");
    if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return tb - ta;
    if (Number.isFinite(ta) !== Number.isFinite(tb)) return Number.isFinite(ta) ? -1 : 1;
    return a[1] - b[1];
  }).map(([x]) => x);
}

/**
 * Engineering hand-off, as the server runs it (idempotent per accepted version): WON with a client acceptance of the latest
 * version. A current hand-off with a mission is done; a package-only one (no project chosen) can still get its mission —
 * the same row is completed when a project is sent (`needsProject`). One made outdated by a newer version does not count.
 */
export function handoffReadiness(opp, handoffs = [], { proposals = null, acceptances = null } = {}) {
  const o = oppView(opp);
  const current = (handoffs || []).map(handoffView).filter((h) => !h.outdated && h.status !== "SUPERSEDED");
  const withMission = current.find((h) => h.missionId);
  if (withMission) return { ok: false, reason: "Handoff-ul a fost deja creat.", current: withMission };
  if (o.status !== "WON") return { ok: false, reason: "Handoff-ul spre Engineering cere acceptarea clientului înregistrată (starea „Câștigată”)." };
  if (current.length) return { ok: true, needsProject: true, current: current[0], reason: "Pachetul de handoff există; alege proiectul ca să creezi ciorna Engineering pe același handoff." };
  if (proposals && acceptances) {
    const latest = latestProposal(proposals);
    const accepted = latest && acceptances.some((a) => str(pick(a, "proposalId", "proposal_id")) === latest.id && str(pick(a, "proposalSha", "proposal_sha")) === latest.sha);
    if (!accepted) return { ok: false, reason: "Ultima versiune a propunerii nu are acceptarea clientului: handoff-ul se face doar pentru versiunea acceptată." };
  }
  return { ok: true, needsProject: false };
}

/**
 * A contact draft is generated only from the LATEST proposal, approved internally in its current form, for an open
 * opportunity (not WON/LOST) of a company that may be contacted and has an active e-mail.
 */
export function draftReadiness(opp, proposals = [], { suppressed = false, orgStatus = "", emails = null } = {}) {
  const o = oppView(opp);
  if (suppressed || orgStatus === "DO_NOT_CONTACT") return { ok: false, reason: "Firma e marcată „Nu contacta”: nu se pregătesc ciorne." };
  if (["WON", "LOST"].includes(o.status)) return { ok: false, reason: `Oportunitatea e ${statusMeta("opp", o.status).label.toLowerCase()}: nu se mai pregătesc mesaje.` };
  const latest = latestProposal(proposals);
  if (!latest) return { ok: false, reason: "Ciorna se generează din propunere: generează și aprobă întâi propunerea." };
  if (!proposalApproved(latest)) return { ok: false, reason: `Ciorna se generează din ultima propunere aprobată intern: aprobă întâi propunerea v${latest.version}.` };
  if (Array.isArray(emails) && !emails.length) return { ok: false, reason: "Firma nu are un e-mail activ pentru ciornă." };
  return { ok: true, proposal: latest };
}

/** A draft stands only while it was built on the latest, still approved proposal of an open opportunity. */
export function draftBasis(draft, opp, proposals = []) {
  const o = oppView(opp);
  if (["WON", "LOST"].includes(o.status)) return { ok: false, reason: `Oportunitatea e ${statusMeta("opp", o.status).label.toLowerCase()}: ciorna nu se mai aprobă.` };
  const latest = latestProposal(proposals);
  const d = draft || {};
  if (!latest || !proposalApproved(latest) || (d.proposalId && d.proposalId !== latest.id) || (d.proposalSha && d.proposalSha !== latest.sha)) {
    return { ok: false, reason: "Propunerea s-a schimbat după ciornă: ciorna nu mai e valabilă. Pregătește una nouă." };
  }
  return { ok: true };
}

/** Mission id created by a hand-off response or record (`missionId`, `mission_id` or `mission.id`). */
export const handoffMissionId = (h) => str(pick(h || {}, "missionId", "mission_id") ?? pick(pick(h || {}, "mission") || {}, "id")) || null;

/* ---------------- approvals / events ---------------- */

/** `{ approval, commandId }` when an action answered 202 (approval required), else null. */
export function approvalFrom(result) {
  if (!result || result.approvalRequired !== true || !result.approval) return null;
  return { approval: result.approval, commandId: result.commandId || result.command?.id || null };
}

/** Events that should refresh Sales views: sales.* events, commands of type sales.*, approvals. */
export function isSalesEvent(event) {
  const type = str(event?.type);
  if (type.startsWith("sales.")) return true;
  if (type.startsWith("approval.")) return true;
  return type.startsWith("command.") && str(event?.payload?.type).startsWith("sales.");
}

/** Sales tabs: id and Romanian label, in desktop order. */
export const SALES_TABS = Object.freeze([
  ["overview", "Prezentare"], ["imports", "Importuri"], ["orgs", "Firme"], ["org", "Fișă firmă"], ["pipeline", "Pipeline"],
  ["opp", "Oportunitate"], ["followups", "Follow-up"], ["services", "Servicii"],
]);
const TAB_IDS = new Set(SALES_TABS.map(([id]) => id));

/** Tab order on a phone: search (Firme), the sheet and draft review (Oportunitate) come first. */
export const MOBILE_TAB_ORDER = Object.freeze(["orgs", "org", "opp", "pipeline", "overview", "followups", "imports", "services"]);

/** Active tab from the hash query; detail tabs need an id, otherwise their list is shown. */
export function salesRoute(query = {}, { defaultTab = "overview" } = {}) {
  const q = query || {};
  let tab = TAB_IDS.has(q.tab) ? q.tab : TAB_IDS.has(defaultTab) ? defaultTab : "overview";
  const id = str(q.id).slice(0, 80);
  if (tab === "org" && !id) tab = "orgs";
  if (tab === "opp" && !id) tab = "pipeline";
  return { tab, id: tab === "org" || tab === "opp" ? id : "" };
}

/** Hash path for a Sales view. */
export function salesHref(tab, params = {}) {
  const p = new URLSearchParams({ tab });
  for (const [k, v] of Object.entries(params)) { if (v !== undefined && v !== null && v !== "" && v !== false) p.set(k, v === true ? "1" : String(v)); }
  return `/sales?${p.toString()}`;
}
