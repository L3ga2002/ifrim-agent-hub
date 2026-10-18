import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { HubError } from "../core/errors.mjs";
import { newId } from "../core/ids.mjs";
import { hashCanonical } from "../core/canonical.mjs";
import { json, parse } from "../storage/db.mjs";
import { redactText } from "../security/redact.mjs";
import { parseCsv, parseXlsx, toCsv } from "./tabular.mjs";
import { foldDiacritics, normalizeName, normalizeFiscalCode, normalizeDomain, classifyUrl, isIdentityDomain, normalizePhone, checkEmail, matchCandidates, decideImportAction } from "./identity.mjs";
import { auditHtml, opportunitiesFromAudit } from "./audit.mjs";
import { createSourceRegistry, fixtureSiteAdapter, liveHttpAdapter } from "./research.mjs";
import { QUALIFICATION_FORMULA, qualify, applyOverride } from "./qualify.mjs";
import { renderProposal, renderContactDraft, findUnresolvedPlaceholders } from "./proposal.mjs";
import { allowedCatalogTexts, proposalFigures } from "./figures.mjs";

/**
 * Sales & Lead Generation (M04) on the Hub's own control plane. Everything commercial is local and evidence-based:
 * imports keep the source row, identities are only merged on proof or by the owner, every claim used for a
 * qualification, an audit or a proposal points to a labelled piece of evidence, and communication is DRAFT_ONLY — the
 * real transport is disabled, a draft is never "sent" without a delivery event, and a client is never "won" without an
 * acceptance recorded by the owner. No model is used here: validation, matching and scoring are deterministic.
 */
export const SALES_FIXTURE_SITES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "fixtures", "sales", "sites");
export const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
export const IMPORT_FIELDS = Object.freeze(["name", "fiscalCode", "website", "email", "phone", "city", "county", "address", "caen", "contactName", "contactRole",
  "turnover", "turnoverYear", "employees", "notes", "source", "ignore"]);
export const EVIDENCE_LABELS = Object.freeze(["USER_PROVIDED", "OBSERVED", "SOURCE_REPORTED", "INFERRED", "UNKNOWN"]);
export const SOURCE_KINDS = Object.freeze(["file", "url", "fixture", "manual"]);
/**
 * M12 C-03: what kind of datum a piece of evidence is, separate from its confidence label (EVIDENCE_LABELS stays as it was).
 * FIXTURE = produced by the fixture adapter or the synthetic generator; STATEMENT = said by the owner or a cited source, with that
 * source; INFERENCE = derived by the Hub (a rule) from named evidence or brief fields, with its reasoning. The kind is written once
 * and never changed (no code path updates sales_evidence); confirming an inference is a new STATEMENT row, never a relabel.
 * Rows written before M12, and rows of the M04 paths that do not declare a kind, keep NULL („nedeclarat (M04)”).
 */
export const DATA_KINDS = Object.freeze(["FIXTURE", "STATEMENT", "INFERENCE"]);
/** Which confidence labels each data kind may carry: an inference is only ever INFERRED (never OBSERVED or USER_PROVIDED). */
export const DATA_KIND_LABELS = Object.freeze({
  FIXTURE: Object.freeze(["OBSERVED", "USER_PROVIDED", "UNKNOWN"]),
  STATEMENT: Object.freeze(["USER_PROVIDED", "SOURCE_REPORTED", "UNKNOWN"]),
  INFERENCE: Object.freeze(["INFERRED"]),
});
/** M12 status sets: the CHECK lists of migration 13 are exactly these (the preparation and dossier flows use nothing else). */
export const PREPARATION_STATUSES = Object.freeze(["PLANNED", "PREPARING", "WAITING_OWNER", "PACKAGING", "READY", "STALE", "STOPPED", "EXPIRED", "CANCELLED", "FAILED"]);
export const DOSSIER_STATUSES = Object.freeze(["WRITING", "READY", "STALE", "SUPERSEDED", "INCOMPLETE"]);
export const PLAN_OP_STATUSES = Object.freeze(["IN_PROGRESS", "DONE", "FAILED"]);
/** What an inference may name as its basis: an evidence row, a field of the brief, or a check of a stored audit. */
const BASIS_REF = /^(?:sev_[A-Za-z0-9_]+|brief:[A-Za-z0-9_]+#[A-Za-z0-9_.]+|audit:sad_[A-Za-z0-9_]+#[A-Za-z0-9_]+)$/;
/** A statement is said by someone, somewhere: a Hub derivation (rule, evidence id, audit check) is never its source. */
const DERIVED_SOURCE = /^\s*(?:rule:|inference:|sev_|audit:)/i;
/** After how long a piece of evidence needs re-verification (days); a financial figure older than 2 years always does. */
export const EVIDENCE_RECHECK_DAYS = Object.freeze({ audit: 90, import: 365, manual: 365 });
const DAY_MS = 86400000;
const plusDays = (iso, days) => new Date(new Date(iso).getTime() + days * DAY_MS).toISOString();

/** Lead (prospect organization) life cycle. DO_NOT_CONTACT is left only by lifting the suppression (owner, approval). */
export const LEAD_TRANSITIONS = Object.freeze({
  NEW: ["NEEDS_RESEARCH", "QUALIFIED", "AUDITED", "OPPORTUNITY", "ON_HOLD", "DISQUALIFIED", "DO_NOT_CONTACT"],
  NEEDS_RESEARCH: ["QUALIFIED", "AUDITED", "OPPORTUNITY", "ON_HOLD", "DISQUALIFIED", "DO_NOT_CONTACT"],
  QUALIFIED: ["AUDITED", "OPPORTUNITY", "NEEDS_RESEARCH", "ON_HOLD", "DISQUALIFIED", "DO_NOT_CONTACT"],
  AUDITED: ["QUALIFIED", "OPPORTUNITY", "NEEDS_RESEARCH", "ON_HOLD", "DISQUALIFIED", "DO_NOT_CONTACT"],
  OPPORTUNITY: ["ON_HOLD", "DISQUALIFIED", "DO_NOT_CONTACT"],
  ON_HOLD: ["NEW", "NEEDS_RESEARCH", "QUALIFIED", "AUDITED", "OPPORTUNITY", "DISQUALIFIED", "DO_NOT_CONTACT"],
  DISQUALIFIED: ["NEEDS_RESEARCH", "DO_NOT_CONTACT"],
  DO_NOT_CONTACT: [],
});
/**
 * Opportunity life cycle. APPROVED_INTERNAL, CONTACTED, IN_DISCUSSION (from a reply) and WON are reached only through
 * their own events (proposal approval, a contact event, a recorded reply, the client's acceptance), never by a plain move.
 */
export const OPPORTUNITY_TRANSITIONS = Object.freeze({
  IDENTIFIED: ["PROPOSAL_DRAFT", "ON_HOLD", "LOST"],
  PROPOSAL_DRAFT: ["READY_FOR_OWNER_REVIEW", "ON_HOLD", "LOST"],
  READY_FOR_OWNER_REVIEW: ["PROPOSAL_DRAFT", "ON_HOLD", "LOST"],
  APPROVED_INTERNAL: ["PROPOSAL_DRAFT", "ON_HOLD", "LOST"],
  CONTACTED: ["IN_DISCUSSION", "ON_HOLD", "LOST"],
  IN_DISCUSSION: ["ON_HOLD", "LOST"],
  ON_HOLD: ["IDENTIFIED", "PROPOSAL_DRAFT", "IN_DISCUSSION", "LOST"],
  WON: [],
  LOST: [],
});
const EVENT_ONLY = { APPROVED_INTERNAL: "aprobarea propunerii", CONTACTED: "un eveniment de contact (trimitere reală sau înregistrare manuală)", WON: "acceptarea clientului înregistrată de tine" };
export const MANUAL_CONTACT_TEXT = "Confirm că am contactat această firmă în afara Hub-ului";
export const CLIENT_ACCEPTANCE_TEXT = "Confirm că clientul a acceptat această propunere";
export const OUTREACH_DISABLED = "OUTREACH_DISABLED: trimiterea reală e dezactivată în M04 (doar ciorne). Activarea cere configurarea canalului și o autorizare separată.";

/** Header synonyms (folded, no punctuation) → field, for the suggested mapping. */
const HEADER_SYNONYMS = [
  ["name", ["denumire", "denumire firma", "nume firma", "firma", "companie", "company", "company name", "nume", "societate", "client", "denumire societate"]],
  ["fiscalCode", ["cui", "cif", "cod fiscal", "cod unic", "cod unic de inregistrare", "vat", "tax id", "cui cif"]],
  ["website", ["site", "site web", "website", "web", "url", "pagina web", "adresa web"]],
  ["email", ["email", "e mail", "mail", "adresa email", "adresa de email"]],
  ["phone", ["telefon", "tel", "phone", "mobil", "nr telefon", "numar telefon", "telefon fix"]],
  ["city", ["oras", "localitate", "city", "municipiu", "localitatea"]],
  ["county", ["judet", "county", "regiune", "judetul"]],
  ["address", ["adresa", "address", "sediu", "adresa sediu"]],
  ["caen", ["caen", "cod caen", "activitate", "domeniu activitate"]],
  ["contactName", ["persoana contact", "persoana de contact", "nume contact", "reprezentant", "contact"]],
  ["contactRole", ["functie", "rol", "pozitie", "functia"]],
  ["turnover", ["cifra de afaceri", "ca", "turnover", "venituri", "cifra afaceri"]],
  ["turnoverYear", ["an", "anul", "an ca", "year", "an cifra de afaceri"]],
  ["employees", ["angajati", "nr angajati", "numar angajati", "salariati", "employees"]],
  ["notes", ["observatii", "note", "notes", "mentiuni", "comentarii"]],
  ["source", ["sursa", "source", "proveniență", "provenienta"]],
];
const foldHeader = (h) => foldDiacritics(String(h || "")).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function suggestMapping(headers) {
  const out = {};
  const used = new Set();
  headers.forEach((header, index) => {
    const folded = foldHeader(header);
    for (const [field, names] of HEADER_SYNONYMS) {
      if (used.has(field)) continue;
      if (names.includes(folded)) { out[String(index)] = field; used.add(field); return; }
    }
    out[String(index)] = "ignore";
  });
  return out;
}

/** Turns an owner mapping (keys: column index or header text) into { index: field }, checked. */
export function normalizeMapping(mapping, headers) {
  if (!mapping || typeof mapping !== "object") throw new HubError("validation", "Maparea coloanelor lipsește");
  const out = {};
  const used = new Map();
  for (const [key, field] of Object.entries(mapping)) {
    const index = /^\d+$/.test(key) ? Number(key) : headers.indexOf(key);
    if (index < 0 || index >= headers.length) throw new HubError("validation", `Coloana „${String(key).slice(0, 60)}” nu există în fișier`);
    if (!IMPORT_FIELDS.includes(field)) throw new HubError("validation", `Câmp necunoscut: ${String(field).slice(0, 40)}`);
    if (field !== "ignore") {
      if (used.has(field)) throw new HubError("validation", `Câmpul ${field} e mapat pe două coloane (${headers[used.get(field)]} și ${headers[index]})`);
      used.set(field, index);
    }
    out[String(index)] = field;
  }
  if (!used.has("name")) throw new HubError("validation", "Coloana cu numele firmei (name) trebuie mapată");
  return out;
}

const clip = (value, max = 300) => redactText(String(value ?? "")).trim().slice(0, max);
const nowIso = (clock) => clock().toISOString();
const sha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");

/**
 * One source row → normalized record + errors (row rejected) + warnings (kept, flagged). Values stay text; nothing is
 * turned into a number unless clearly numeric (turnover), and a phone stored as a number is flagged, not "fixed".
 */
export function normalizeImportRow(cells, mapping, { numericCols = new Set() } = {}) {
  const errors = [];
  const warnings = [];
  const value = (field) => {
    const entry = Object.entries(mapping).find(([, f]) => f === field);
    return entry ? String(cells[Number(entry[0])] ?? "").trim() : "";
  };
  const colOf = (field) => Number(Object.entries(mapping).find(([, f]) => f === field)?.[0] ?? -1);
  const name = value("name");
  if (!name) errors.push("Numele firmei lipsește");
  else if (name.length > 200) errors.push("Numele firmei are peste 200 de caractere");
  const n = name ? normalizeName(name) : { normalized: "", legalForm: "", tokens: [] };
  if (name && !n.normalized) errors.push("Numele firmei nu conține litere sau cifre");
  const fiscal = normalizeFiscalCode(value("fiscalCode"));
  if (value("fiscalCode") && fiscal.valid === false) warnings.push(`CUI invalid (${fiscal.reason || "cifra de control"}): păstrat ca text, nefolosit la potrivire`);
  const websiteRaw = value("website");
  let website = "";
  let domain = "";
  let domainKind = "";
  if (websiteRaw) {
    const kind = classifyUrl(websiteRaw);
    domainKind = kind.kind;
    if (kind.kind === "invalid") warnings.push(`Site invalid: ${websiteRaw.slice(0, 80)}`);
    else {
      website = websiteRaw.includes("://") ? websiteRaw : `https://${websiteRaw}`;
      domain = normalizeDomain(websiteRaw);
      if (kind.kind !== "organization_site") warnings.push(`Site-ul pare ${kind.kind} (${kind.reason}): nu e folosit ca identitate`);
    }
  }
  const emails = [];
  for (const part of value("email").split(/[;,\s]+/).filter(Boolean)) {
    const e = checkEmail(part);
    if (e.valid) emails.push({ value: e.value, generic: Boolean(e.generic) });
    else warnings.push(`E-mail invalid ignorat: ${part.slice(0, 60)}`);
  }
  const phones = [];
  for (const part of value("phone").split(/[;,/]+/).map((s) => s.trim()).filter(Boolean)) {
    const p = normalizePhone(part, { wasNumeric: numericCols.has(colOf("phone")) });
    for (const w of p.warnings || []) warnings.push(`Telefon ${part.slice(0, 30)}: ${w}`);
    phones.push({ value: p.value || part, raw: part, warnings: p.warnings || [] });
  }
  const turnoverRaw = value("turnover");
  let turnover = null;
  if (turnoverRaw) {
    const clean = turnoverRaw.replace(/\s|\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
    if (/^-?\d+(\.\d+)?$/.test(clean)) turnover = Number(clean);
    else warnings.push(`Cifra de afaceri nu e numerică: „${turnoverRaw.slice(0, 40)}” (păstrată ca text)`);
  }
  const year = value("turnoverYear");
  if (year && !/^(19|20)\d{2}$/.test(year)) warnings.push(`Anul cifrei de afaceri nu e valid: ${year.slice(0, 10)}`);
  return {
    errors, warnings,
    record: {
      name: clip(name, 200), normalizedName: n.normalized, legalForm: n.legalForm || "",
      fiscalCode: fiscal.value || "", fiscalCodeValid: fiscal.valid, fiscalRaw: value("fiscalCode").slice(0, 40),
      website, domain, domainKind, emails, phones,
      city: clip(value("city"), 80), county: clip(value("county"), 80), address: clip(value("address"), 300), caen: clip(value("caen"), 20),
      contactName: clip(value("contactName"), 120), contactRole: clip(value("contactRole"), 120),
      turnover, turnoverRaw: turnoverRaw.slice(0, 40), turnoverYear: /^(19|20)\d{2}$/.test(year) ? year : "",
      employees: clip(value("employees"), 20), notes: clip(value("notes"), 500), source: clip(value("source"), 200),
    },
  };
}

/** Identity keys used inside one file (duplicates) and against the database; shared platforms are never keys. */
const cuiOf = (r) => (r.fiscalCodeValid ? r.fiscalCode : "");
const identityKeys = (r) => [
  ...(r.fiscalCodeValid ? [`cui:${r.fiscalCode}`] : []),
  ...(r.domain && isIdentityDomain(r.domain) && r.domainKind === "organization_site" ? [`dom:${r.domain}`] : []),
  ...(r.normalizedName && r.city ? [`name:${r.normalizedName}|${foldDiacritics(r.city).toLowerCase()}`] : []),
];

export function createSales({ db, bus, clock, config, settings }) {
  const now = () => nowIso(clock);
  const importDir = path.join(config.dataDir, "sales-imports");
  // Sources: fixtures only (M04). The live adapter refuses every call; it exists so the contract is explicit.
  const sources = createSourceRegistry({ adapters: { fixture: fixtureSiteAdapter({ dir: config.salesFixtureSites || SALES_FIXTURE_SITES }), live: liveHttpAdapter() }, clock });
  const transport = config.testMode && config.salesTransport ? config.salesTransport : null; // only a test transport, never a real one in M04

  // ---------- rows ----------
  const rowToBatch = (r) => r && ({ id: r.id, fileName: r.file_name, fileSha256: r.file_sha256, fileKind: r.file_kind, sizeBytes: r.size_bytes, encoding: r.encoding,
    delimiter: r.delimiter, sheet: r.sheet, sheets: parse(r.sheets_json, []), headers: parse(r.headers_json, []), suggestedMapping: parse(r.suggested_json, {}),
    mapping: parse(r.mapping_json, {}), mappingHash: r.mapping_hash, warnings: parse(r.warnings_json, []), status: r.status, synthetic: Boolean(r.synthetic),
    rowCount: r.row_count, counts: parse(r.counts_json, {}), createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at, importedAt: r.imported_at,
    rolledBackAt: r.rolled_back_at });
  const rowToImportRow = (r) => r && ({ id: r.id, batchId: r.batch_id, rowIndex: r.row_index, sheetRow: r.row_index + 2, raw: parse(r.raw_json, []), normalized: parse(r.normalized_json, {}),
    status: r.status, orgId: r.org_id, errors: parse(r.errors_json, []), warnings: parse(r.warnings_json, []), matches: parse(r.match_json, []),
    resolution: parse(r.resolution_json, {}), processedAt: r.processed_at });
  const rowToOrg = (r) => r && ({ id: r.id, displayName: r.display_name, normalizedName: r.normalized_name, legalForm: r.legal_form, fiscalCode: r.fiscal_code,
    fiscalCodeValid: r.fiscal_code_valid === null ? null : Boolean(r.fiscal_code_valid), website: r.website, domain: r.domain, domainKind: r.domain_kind,
    city: r.city, county: r.county, address: r.address, caen: r.caen, status: r.status, synthetic: Boolean(r.synthetic), createdBatchId: r.created_batch_id,
    version: r.version, editedAfterImport: Boolean(r.edited_after_import), mergedInto: r.merged_into, archivedAt: r.archived_at, archiveReason: r.archive_reason,
    createdAt: r.created_at, updatedAt: r.updated_at });
  const rowToContact = (r) => r && ({ id: r.id, orgId: r.org_id, kind: r.kind, value: r.value, raw: r.raw, generic: Boolean(r.generic), personName: r.person_name,
    role: r.role, evidenceId: r.evidence_id, warnings: parse(r.warnings_json, []), status: r.status, createdAt: r.created_at });
  const rowToEvidence = (r) => r && ({ id: r.id, subjectType: r.subject_type, subjectId: r.subject_id, subjectVersion: r.subject_version, claim: r.claim,
    value: parse(r.value_json, null), label: r.label, sourceKind: r.source_kind, sourceRef: r.source_ref, retrievedAt: r.retrieved_at, excerpt: r.excerpt,
    method: r.method, verifiedAt: r.verified_at, recheckAfter: r.recheck_after, contradicts: parse(r.contradicts_json, []), synthetic: Boolean(r.synthetic),
    createdBy: r.created_by, createdAt: r.created_at, dataKind: r.data_kind ?? null, basis: parse(r.basis_json, []), reasoning: r.reasoning ?? "" });
  const rowToService = (r) => r && ({ id: r.id, name: r.name, description: r.description, scope: parse(r.scope_json, []), exclusions: parse(r.exclusions_json, []),
    tags: parse(r.tags_json, []), price: parse(r.price_json, { status: "NOT_CONFIGURED" }), leadTime: parse(r.lead_time_json, { status: "NOT_CONFIGURED" }),
    materials: parse(r.materials_json, []), synthetic: Boolean(r.synthetic), active: Boolean(r.active), version: r.version, createdAt: r.created_at, updatedAt: r.updated_at });
  const rowToOpp = (r) => r && ({ id: r.id, orgId: r.org_id, title: r.title, need: r.need, serviceId: r.service_id, status: r.status, owner: r.owner,
    nextAction: r.next_action, nextActionAt: r.next_action_at, evidence: parse(r.evidence_json, []), synthetic: Boolean(r.synthetic), version: r.version,
    createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at });
  const rowToProposal = (r) => r && ({ id: r.id, opportunityId: r.opportunity_id, version: r.version, content: parse(r.content_json, {}), contentSha: r.content_sha,
    status: r.status, approvalId: r.approval_id, approvedSha: r.approved_sha, approvedAt: r.approved_at, createdBy: r.created_by, createdAt: r.created_at });
  const rowToDraft = (r) => r && ({ id: r.id, opportunityId: r.opportunity_id, orgId: r.org_id, contactId: r.contact_id, proposalId: r.proposal_id, version: r.version,
    channel: r.channel, subject: r.subject, body: r.body, recipients: parse(r.recipients_json, []), meta: parse(r.meta_json, {}), contentSha: r.content_sha,
    status: r.status, approvalId: r.approval_id, approvedSha: r.approved_sha, approvedAt: r.approved_at, createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at });
  const rowToFollowup = (r) => r && ({ id: r.id, opportunityId: r.opportunity_id, orgId: r.org_id, dueAt: r.due_at, basis: r.basis, basisRef: r.basis_ref,
    status: r.status, reason: r.reason, draftId: r.draft_id, expiresAt: r.expires_at, createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at });

  const getBatch = (id) => rowToBatch(db.prepare("SELECT * FROM sales_import_batches WHERE id = ?").get(id));
  const needBatch = (id) => { const b = getBatch(id); if (!b) throw new HubError("not_found", "Lotul de import nu există"); return b; };
  const getOrgRow = (id) => rowToOrg(db.prepare("SELECT * FROM sales_orgs WHERE id = ?").get(id));
  const needOrg = (id) => { const o = getOrgRow(id); if (!o) throw new HubError("not_found", "Firma nu există"); return o; };
  const needOpp = (id) => { const o = rowToOpp(db.prepare("SELECT * FROM sales_opportunities WHERE id = ?").get(id)); if (!o) throw new HubError("not_found", "Oportunitatea nu există"); return o; };
  const contactsOf = (orgId) => db.prepare("SELECT * FROM sales_contacts WHERE org_id = ? ORDER BY created_at").all(orgId).map(rowToContact);
  const evidenceOf = (type, id) => annotateEvidence(db.prepare(`SELECT e.*, b.status AS batch_status FROM sales_evidence e LEFT JOIN sales_import_batches b ON b.id = e.batch_id
    WHERE e.subject_type = ? AND e.subject_id = ? ORDER BY e.created_at, e.rowid`).all(type, id).map((r) => ({ ...rowToEvidence(r), batchId: r.batch_id || null, batchRolledBack: r.batch_status === "ROLLED_BACK" })));
  /** Evidence that may feed a qualification, a proposal or a package: not superseded, not from a rolled-back import. */
  const usable = (e) => e.freshness !== "SUPERSEDED" && e.freshness !== "ROLLED_BACK";

  /**
   * Freshness and contradictions of evidence (nothing is deleted or rewritten): a newer reading of the same claim from the same
   * source makes the older one SUPERSEDED; a passed recheck date (or a financial period older than 2 years) makes it
   * NEEDS_RECHECK; two current readings of the same claim and period from different sources with different values are kept
   * both and point at each other in `conflictsWith`.
   */
  function annotateEvidence(list) {
    const nowMs = clock().getTime();
    const byClaim = new Map();
    // Evidence of a rolled-back import stays visible (history) but is compared with nothing and feeds nothing.
    for (const e of list) if (!e.batchRolledBack) (byClaim.get(e.claim) || byClaim.set(e.claim, []).get(e.claim)).push(e);
    const valueKey = (e) => JSON.stringify(e.claim.startsWith("audit:") ? e.value?.status ?? null : e.claim.startsWith("financial:") ? [e.value?.value ?? null, e.value?.raw ?? null] : e.value);
    const periodOf = (e) => (e.claim.startsWith("financial:") ? String(e.value?.period ?? "") : "");
    return list.map((e) => {
      if (e.batchRolledBack) return { ...e, freshness: "ROLLED_BACK", freshnessReason: "Lotul de import a fost anulat (rollback): dovada nu se mai folosește", conflictsWith: [] };
      const same = byClaim.get(e.claim);
      let freshness = "CURRENT";
      let freshnessReason = "";
      if (same.some((o) => o !== e && o.sourceRef === e.sourceRef && o.sourceKind === e.sourceKind && (o.createdAt > e.createdAt || (o.createdAt === e.createdAt && list.indexOf(o) > list.indexOf(e))))) {
        freshness = "SUPERSEDED"; freshnessReason = "Există o citire mai nouă din aceeași sursă";
      } else if (e.recheckAfter && Date.parse(e.recheckAfter) <= nowMs) {
        freshness = "NEEDS_RECHECK"; freshnessReason = `Termenul de reverificare (${e.recheckAfter.slice(0, 10)}) a trecut`;
      } else if (e.claim.startsWith("financial:")) {
        const year = Number(periodOf(e));
        if (!year) { freshness = "NEEDS_RECHECK"; freshnessReason = "Perioada cifrei nu e cunoscută"; }
        else if (year < new Date(nowMs).getUTCFullYear() - 2) { freshness = "NEEDS_RECHECK"; freshnessReason = `Cifra e din ${year}: e veche`; }
      }
      const conflictsWith = freshness === "SUPERSEDED" ? [] : same.filter((o) => o !== e && o.sourceRef !== e.sourceRef && periodOf(o) === periodOf(e) && valueKey(o) !== valueKey(e)
        && !same.some((n) => n !== o && n.sourceRef === o.sourceRef && n.createdAt > o.createdAt)).map((o) => o.id);
      return { ...e, freshness, freshnessReason, conflictsWith };
    });
  }
  const services = ({ activeOnly = true } = {}) => db.prepare(`SELECT * FROM sales_services${activeOnly ? " WHERE active = 1" : ""} ORDER BY name`).all().map(rowToService);
  /**
   * 2.15.5: the catalog entry an offer is rendered from — the opportunity's own service; for a preparation-bound offer (`bound`) of an
   * opportunity that names none (the M12 preparation creates it without one), the catalog's ONLY active service (the single-service rule of
   * renderProposal), never a pick among several. M04 offers keep exactly the opportunity's service. → service | null
   */
  function offerService(opp, { bound = false } = {}) {
    if (opp.serviceId) return rowToService(db.prepare("SELECT * FROM sales_services WHERE id = ?").get(opp.serviceId)) || null;
    if (!bound) return null;
    const active = services();
    return active.length === 1 ? active[0] : null;
  }
  const emit = (type, scopeId, payload, source = "sales") => bus.append({ type, scopeType: "sales", scopeId, source, payload });

  function transition(subjectType, subjectId, from, to, actor, reason, evidence = []) {
    db.prepare("INSERT INTO sales_transitions (id, subject_type, subject_id, from_status, to_status, actor, reason, evidence_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(newId("str"), subjectType, subjectId, from, to, actor, String(reason || "").slice(0, 500), json(evidence), now());
  }

  /**
   * C-03 rules for a row that declares its data kind (the M04 paths that declare none are unchanged and stay NULL):
   * - the label must be one the kind allows (an INFERENCE is only INFERRED; a STATEMENT or FIXTURE is never INFERRED);
   * - FIXTURE comes only from the fixture adapter or the synthetic generator (`origin`), on synthetic data, with a fixture source;
   *   a row added by hand is a STATEMENT or an INFERENCE;
   * - STATEMENT has a real source (who said it, where): never a fixture or a Hub derivation (rule, evidence id, audit check);
   * - INFERENCE names its basis (evidence rows, brief fields or stored audit checks, which must exist) and its reasoning;
   * - a STATEMENT whose basis names an inference confirms it: a confirmed label and its OWN source (copying the inference's source
   *   is refused). The inference row stays INFERENCE: a copy or a summary never turns an inference into a statement.
   * Returns the normalised basis.
   */
  function checkDataKind({ dataKind, label, sourceKind, sourceRef, synthetic, basis, reasoning }, origin, { orgId = null, preparationId = null } = {}) {
    if (!DATA_KINDS.includes(dataKind)) throw new HubError("validation", `Fel de dată necunoscut: ${dataKind}`);
    if (!DATA_KIND_LABELS[dataKind].includes(label)) {
      throw new HubError("validation", `O dată ${dataKind} nu poate avea eticheta ${label} (permise: ${DATA_KIND_LABELS[dataKind].join(", ")})`, { code: "DATA_KIND_LABEL_MISMATCH" });
    }
    const refs = Array.isArray(basis) ? basis.map((b) => String(b ?? "").trim()) : null;
    if (!refs || refs.length > 20 || refs.some((ref) => !BASIS_REF.test(ref))) {
      throw new HubError("validation", "Baza se dă prin id-uri de dovezi (sev_…), câmpuri din brief (brief:<id>#<câmp>) sau verificări de audit (audit:sad_…#<verificare>)");
    }
    // M12 review C4: every basis item exists AND is about this company — an evidence row of the same company, a field the brief really has
    // (of a preparation of this company, or of the one creating it), a check the stored audit of this company really made.
    const foreign = (ref) => new HubError("validation", `Baza ${ref} nu e despre această firmă`, { code: "INFERENCE_BASIS" });
    for (const ref of refs) {
      if (ref.startsWith("sev_")) {
        const row = db.prepare("SELECT subject_type, subject_id FROM sales_evidence WHERE id = ?").get(ref);
        if (!row) throw new HubError("not_found", `Dovada ${ref} din bază nu există`);
        const of = row.subject_type === "org" ? row.subject_id : row.subject_type === "opportunity" ? db.prepare("SELECT org_id FROM sales_opportunities WHERE id = ?").get(row.subject_id)?.org_id : null;
        if (!orgId || of !== orgId) throw foreign(ref);
      } else if (ref.startsWith("audit:")) {
        const audit = db.prepare("SELECT org_id, result_json FROM sales_audits WHERE id = ?").get(ref.slice(6, ref.indexOf("#")));
        if (!audit) throw new HubError("not_found", `Auditul din ${ref} nu există`);
        if (!orgId || audit.org_id !== orgId) throw foreign(ref);
        const check = ref.slice(ref.indexOf("#") + 1);
        if (!(parse(audit.result_json, {})?.checks || []).some((c) => String(c?.id) === check)) throw new HubError("not_found", `Auditul din ${ref} nu are verificarea ${check}`, { code: "INFERENCE_BASIS" });
      } else if (ref.startsWith("brief:")) {
        const [id, field] = ref.slice(6).split("#");
        const prep = db.prepare("SELECT id, org_id, brief_json FROM sales_preparations WHERE id = ?").get(id);
        if (!prep) throw new HubError("not_found", `Brieful din ${ref} nu există`, { code: "INFERENCE_BASIS" });
        const brief = parse(prep.brief_json, {});
        if (!(field === "request" ? String(brief?.request || "").trim() : brief?.fields?.[field])) throw new HubError("not_found", `Brieful din ${ref} nu are câmpul ${field}`, { code: "INFERENCE_BASIS" });
        if (!orgId || (prep.org_id ? prep.org_id !== orgId : prep.id !== preparationId)) throw foreign(ref);
      }
    }
    if (dataKind === "FIXTURE") {
      if (!["fixture", "synthetic"].includes(origin)) {
        throw new HubError("policy", "Datele FIXTURE vin doar din adaptorul de fixture sau din generatorul sintetic; o dovadă adăugată de mână e o afirmație (STATEMENT) sau o inferență", { code: "FIXTURE_ORIGIN" });
      }
      if (!synthetic || sourceKind !== "fixture") throw new HubError("policy", "O dată FIXTURE e sintetică și are sursa „fixture”", { code: "FIXTURE_ORIGIN" });
    }
    if (dataKind === "STATEMENT") {
      if (sourceKind === "fixture" || DERIVED_SOURCE.test(String(sourceRef))) {
        throw new HubError("validation", "O afirmație are sursa ei (cine a spus și unde), nu un fixture sau o deducție a Hub-ului", { code: "STATEMENT_SOURCE" });
      }
      const confirmed = refs.filter((ref) => ref.startsWith("sev_")).map((ref) => db.prepare("SELECT data_kind, label, source_ref FROM sales_evidence WHERE id = ?").get(ref))
        .filter((r) => r.data_kind === "INFERENCE" || r.label === "INFERRED");
      if (confirmed.length) {
        if (!["USER_PROVIDED", "SOURCE_REPORTED"].includes(label)) throw new HubError("validation", "Confirmarea unei inferențe e USER_PROVIDED sau SOURCE_REPORTED", { code: "DATA_KIND_LABEL_MISMATCH" });
        if (confirmed.some((r) => clip(r.source_ref, 500) === clip(sourceRef, 500))) {
          throw new HubError("validation", "O inferență nu devine afirmație prin copiere: confirmarea are sursa ei (cine a confirmat și unde)", { code: "INFERENCE_COPY" });
        }
      }
    }
    if (dataKind === "INFERENCE") {
      if (!refs.length) throw new HubError("validation", "Inferența cere baza: dovezile sau câmpurile din brief din care a fost dedusă", { code: "INFERENCE_BASIS" });
      if (!clip(reasoning, 400)) throw new HubError("validation", "Inferența cere raționamentul (de ce s-a dedus)", { code: "INFERENCE_BASIS" });
    }
    return refs;
  }

  function addEvidenceRow({ subjectType, subjectId, subjectVersion = 1, claim, value = null, label, sourceKind, sourceRef, retrievedAt = null, excerpt = "", method = "",
    verifiedAt = null, recheckAfter = null, contradicts = [], synthetic = false, batchId = null, actor, dataKind = null, basis = [], reasoning = "" }, { origin = "", preparationId = null } = {}) {
    if (!EVIDENCE_LABELS.includes(label)) throw new HubError("validation", `Etichetă de dovadă necunoscută: ${label}`);
    if (!SOURCE_KINDS.includes(sourceKind)) throw new HubError("validation", `Tip de sursă necunoscut: ${sourceKind}`);
    if (!String(claim || "").trim()) throw new HubError("validation", "Dovada are nevoie de o afirmație");
    if (!String(sourceRef || "").trim()) throw new HubError("validation", "Dovada are nevoie de sursă (fișier, URL sau înregistrare manuală)");
    const declared = dataKind !== null && dataKind !== undefined;
    const orgOfSubject = subjectType === "org" ? subjectId : subjectType === "opportunity" ? db.prepare("SELECT org_id FROM sales_opportunities WHERE id = ?").get(subjectId)?.org_id : null;
    const refs = declared ? checkDataKind({ dataKind, label, sourceKind, sourceRef, synthetic, basis, reasoning }, origin, { orgId: orgOfSubject || null, preparationId }) : null;
    const id = newId("sev");
    db.prepare(`INSERT INTO sales_evidence (id, subject_type, subject_id, subject_version, claim, value_json, label, source_kind, source_ref, retrieved_at, excerpt,
      method, verified_at, recheck_after, contradicts_json, synthetic, batch_id, created_by, created_at, data_kind, basis_json, reasoning)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, subjectType, subjectId, subjectVersion, clip(claim, 300), json(value), label, sourceKind, clip(sourceRef, 500), retrievedAt, clip(excerpt, 400),
        clip(method, 200), verifiedAt, recheckAfter, json(contradicts), synthetic ? 1 : 0, batchId, actor, now(),
        declared ? dataKind : null, declared ? json(refs) : null, declared ? clip(reasoning, 400) : null);
    // M12 (D7): new evidence for a company changes the inputs of an offer prepared for it (only preparation-bound offers react).
    if (orgOfSubject) invalidateBound([orgOfSubject], "o dovadă nouă pentru firmă");
    return id;
  }

  // ---------- M12 (D7): preparation-bound offers and what invalidates them ----------
  /**
   * The inputs an offer prepared by a confirmed plan was rendered from (stored as `content.basis`, so they are part of its content sha):
   * the brief, the company's usable evidence, its latest qualification and audit, the catalog entry of the opportunity, the owner's
   * proposal profile and whether the company may still be worked on. Pure read; no time inside, so the same state gives the same basis.
   */
  function preparationBasis(oppId, { briefSha = null } = {}) {
    const opp = needOpp(oppId);
    const org = needOrg(opp.orgId);
    const ids = (type, id) => evidenceOf(type, id).filter(usable).map((e) => e.id).sort();
    const audit = db.prepare("SELECT id FROM sales_audits WHERE org_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1").get(org.id)?.id || null;
    const svc = offerService(opp, { bound: true });
    const q = latestQualification(org.id);
    // Review R3/R8 / R7: the exact qualification row (id + its inputs sha) and the company fields the offer renders are inputs too.
    return { v: 1, briefSha: briefSha || null, orgId: org.id, opportunityId: opp.id, evidence: hashCanonical(ids("org", org.id)), opportunityEvidence: hashCanonical(ids("opportunity", opp.id)),
      qualificationId: q?.id || null, qualificationInputsSha: q?.inputsSha || null, auditId: audit, service: svc ? `${svc.id}@${svc.version}` : null, owner: hashCanonical(ownerProfile()),
      org: hashCanonical({ displayName: org.displayName, legalForm: org.legalForm, fiscalCode: org.fiscalCode, fiscalCodeValid: org.fiscalCodeValid, website: org.website, domain: org.domain,
        city: org.city, synthetic: org.synthetic }),
      workable: !org.mergedInto && !org.archivedAt && org.status !== "DO_NOT_CONTACT" && !contactSuppression(org.id) };
  }
  /** A bound offer whose recorded inputs are no longer the current ones (M04 offers have no basis: never stale). */
  function boundStale(p) {
    if (!p || !isPreparationBound(p.content)) return false;
    try { return hashCanonical(preparationBasis(p.opportunityId, { briefSha: p.content.basis.briefSha || null })) !== hashCanonical(p.content.basis); } catch { return true; }
  }
  const invalidationHooks = new Set();
  /** The preparation service listens here (synchronously, inside the writer's transaction): preparations and dossiers of the opportunity. */
  const onInvalidated = (fn) => { invalidationHooks.add(fn); return () => invalidationHooks.delete(fn); };
  function notifyInvalidated(orgId, opportunityId, reason) {
    for (const fn of invalidationHooks) fn({ orgId, opportunityId, reason });
  }
  /**
   * Called by every write that can change an offer's inputs (evidence, audit, qualification, override, suppression, merge, a new offer
   * or draft version). A preparation-bound offer (DRAFT or APPROVED_INTERNAL) whose inputs changed — or every bound one when `force` —
   * becomes STALE (never current again), its drafts are superseded and its opportunity goes back to PROPOSAL_DRAFT; then the
   * preparation service checks the preparations and dossiers of the opportunity. M04 offers (no basis) are untouched.
   */
  function invalidateBound(orgIds, reason, { force = false } = {}) {
    for (const orgId of [...new Set(orgIds)].filter(Boolean)) {
      for (const o of db.prepare("SELECT id FROM sales_opportunities WHERE org_id = ?").all(orgId)) {
        const p = latestProposal(o.id);
        if (p && isPreparationBound(p.content) && ["DRAFT", "APPROVED_INTERNAL"].includes(p.status) && (force || boundStale(p))) {
          if (db.prepare("UPDATE sales_proposals SET status = 'STALE' WHERE id = ? AND status IN ('DRAFT','APPROVED_INTERNAL')").run(p.id).changes === 1) {
            db.prepare("UPDATE sales_drafts SET status = 'SUPERSEDED', updated_at = ? WHERE proposal_id = ? AND status IN ('DRAFT','CONTENT_APPROVED','SEND_AUTHORIZED')").run(now(), p.id);
            const opp = needOpp(o.id);
            if (["READY_FOR_OWNER_REVIEW", "APPROVED_INTERNAL"].includes(opp.status)) setOppStatus(opp, "PROPOSAL_DRAFT", "hub", `Oferta v${p.version} nu mai corespunde intrărilor (${clip(reason, 120)})`);
            emit("sales.proposal.stale", o.id, { proposalId: p.id, version: p.version, opportunityId: o.id, reason: clip(reason, 160) }, "hub");
          }
        }
        notifyInvalidated(orgId, o.id, reason);
      }
    }
  }

  // ---------- suppression (do-not-contact) ----------
  function suppressionFor({ orgId = null, fiscalCode = "", domain = "", emails = [] }) {
    const checks = [["org", orgId], ["fiscal_code", fiscalCode], ["domain", domain], ...emails.map((e) => ["email", String(e).toLowerCase()])].filter(([, v]) => v);
    for (const [kind, value] of checks) {
      const hit = db.prepare("SELECT * FROM sales_suppressions WHERE kind = ? AND value = ? AND lifted_at IS NULL").get(kind, value);
      if (hit) return { kind, value, reason: hit.reason, id: hit.id };
    }
    return null;
  }

  /** Every org linked to `orgId` through merges, in both directions: a do-not-contact on one applies to all of them. */
  function mergeFamily(orgId) {
    const family = new Set();
    const visit = (id) => {
      if (!id || family.has(id)) return;
      family.add(id);
      visit(db.prepare("SELECT merged_into FROM sales_orgs WHERE id = ?").get(id)?.merged_into);
      for (const r of db.prepare("SELECT id FROM sales_orgs WHERE merged_into = ?").all(id)) visit(r.id);
    };
    visit(orgId);
    return [...family];
  }
  const identityDomainOf = (value) => { const d = normalizeDomain(String(value || "").trim()); return d && isIdentityDomain(d) ? d : ""; };

  /**
   * The do-not-contact check for every outward step (opportunity, draft, approval, send, follow-up, manual contact): the org
   * and its merge family by id, fiscal code and identity domain, then every recipient by address and by its own domain
   * (webmail domains are never identity domains, so a suppressed gmail address does not block every gmail user).
   */
  function contactSuppression(orgId, emails = []) {
    for (const id of mergeFamily(orgId)) {
      const o = getOrgRow(id);
      const hit = suppressionFor({ orgId: id, fiscalCode: o?.fiscalCodeValid ? o.fiscalCode : "", domain: o?.domain && isIdentityDomain(o.domain) ? o.domain : "" });
      if (hit) return hit;
    }
    for (const e of emails) {
      const value = String(e || "").trim().toLowerCase();
      const hit = suppressionFor({ emails: [value], domain: identityDomainOf(value) });
      if (hit) return hit;
    }
    return null;
  }
  /** Suppression of an incoming record (import row): fiscal code, identity domain of the site whatever the page kind, e-mails and their domains. */
  const recordSuppression = (record) => suppressionFor({ fiscalCode: record.fiscalCodeValid ? record.fiscalCode : "", domain: identityDomainOf(record.domain),
    emails: record.emails.map((e) => e.value) }) || record.emails.map((e) => suppressionFor({ domain: identityDomainOf(e.value) })).find(Boolean) || null;
  const assertWorkable = (org) => {
    if (org.mergedInto || org.archivedAt) throw new HubError("conflict", "Firma e unită în alta sau arhivată: lucrează pe fișa păstrată");
  };

  function suppress(orgId, { reason, source = "owner" }, actor) {
    needOrg(orgId);
    if (String(reason || "").trim().length < 3) throw new HubError("validation", "Motivul DO_NOT_CONTACT e obligatoriu");
    return bus.transaction(() => {
      const kinds = new Set();
      // The whole merge family: a merged company cannot be contacted through its survivor, nor the other way round.
      for (const id of mergeFamily(orgId)) {
        const org = getOrgRow(id);
        const keys = [["org", org.id], ["fiscal_code", org.fiscalCodeValid ? org.fiscalCode : ""], ["domain", org.domain && isIdentityDomain(org.domain) ? org.domain : ""],
          ...contactsOf(org.id).filter((c) => c.kind === "email").flatMap((c) => [["email", c.value.toLowerCase()], ["domain", identityDomainOf(c.value)]])].filter(([, v]) => v);
        for (const [kind, value] of keys) {
          kinds.add(kind);
          if (!db.prepare("SELECT 1 FROM sales_suppressions WHERE kind = ? AND value = ? AND lifted_at IS NULL").get(kind, value)) {
            db.prepare("INSERT INTO sales_suppressions (id, kind, value, org_id, reason, source, actor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
              .run(newId("ssp"), kind, value, org.id, clip(reason, 300), source, actor, now());
          }
        }
        if (org.status !== "DO_NOT_CONTACT") {
          db.prepare("UPDATE sales_orgs SET status = 'DO_NOT_CONTACT', version = version + 1, updated_at = ? WHERE id = ?").run(now(), org.id);
          transition("org", org.id, org.status, "DO_NOT_CONTACT", actor, reason);
        }
        // Everything that could lead to a message stops at once.
        db.prepare("UPDATE sales_followups SET status = 'SUSPENDED', reason = ?, updated_at = ? WHERE org_id = ? AND status IN ('SCHEDULED','DUE')").run("DO_NOT_CONTACT", now(), org.id);
        db.prepare("UPDATE sales_drafts SET status = 'CANCELLED', updated_at = ? WHERE org_id = ? AND status IN ('DRAFT','CONTENT_APPROVED','SEND_AUTHORIZED')").run(now(), org.id);
      }
      invalidateBound(mergeFamily(orgId), "DO_NOT_CONTACT", { force: true });
      emit("sales.suppressed", orgId, { keys: [...kinds], reason: clip(reason, 120) }, actor);
      return getOrg(orgId);
    });
  }

  function liftSuppression(orgId, { reason }, actor, decision = {}) {
    needOrg(orgId);
    if (String(reason || "").trim().length < 5) throw new HubError("validation", "Ridicarea DO_NOT_CONTACT cere un motiv (minimum 5 caractere)");
    const family = mergeFamily(orgId);
    const marks = `(${family.map(() => "?").join(",")})`;
    const active = db.prepare(`SELECT COUNT(*) AS n FROM sales_suppressions WHERE org_id IN ${marks} AND lifted_at IS NULL`).get(...family).n;
    if (!active && !family.some((id) => getOrgRow(id)?.status === "DO_NOT_CONTACT")) throw new HubError("conflict", "Firma nu e DO_NOT_CONTACT: nu e nimic de ridicat");
    return bus.transaction(() => {
      // 2.15.2: only the owner's decision lifts it (the owner session re-read here, the approval of this exact firm consumed).
      const auth = approvedDecision(decision, "sales.suppression_lift", "ridicarea DO_NOT_CONTACT", (p) => p.orgId === orgId);
      db.prepare(`UPDATE sales_suppressions SET lifted_at = ?, lifted_by = ?, lift_reason = ? WHERE org_id IN ${marks} AND lifted_at IS NULL`).run(now(), actor, clip(reason, 300), ...family);
      for (const id of family) {
        const org = getOrgRow(id);
        if (org.status !== "DO_NOT_CONTACT") continue;
        db.prepare("UPDATE sales_orgs SET status = 'ON_HOLD', version = version + 1, updated_at = ? WHERE id = ?").run(now(), org.id);
        transition("org", org.id, org.status, "ON_HOLD", actor, `DO_NOT_CONTACT ridicat: ${reason}`);
      }
      emit("sales.suppression_lifted", orgId, { reason: clip(reason, 120), ...auth }, actor);
      return getOrg(orgId);
    });
  }

  // ---------- imports ----------
  function createImport({ fileName, contentBase64, synthetic = false }, actor) {
    const name = path.basename(String(fileName || "")).slice(0, 200);
    const ext = path.extname(name).toLowerCase();
    if (![".csv", ".txt", ".xlsx"].includes(ext)) {
      throw new HubError("validation", ext === ".xlsm" || ext === ".xls" ? "Fișierele .xlsm/.xls nu sunt acceptate (macro-uri / format vechi); salvează ca .xlsx sau .csv" : "Acceptăm doar .csv și .xlsx");
    }
    const buffer = Buffer.from(String(contentBase64 || ""), "base64");
    if (!buffer.length) throw new HubError("validation", "Fișierul e gol");
    if (buffer.length > MAX_IMPORT_BYTES) throw new HubError("validation", `Fișierul depășește ${MAX_IMPORT_BYTES / 1024 / 1024} MB`);
    const fileSha = sha256(buffer);
    // The same file uploaded again returns the open batch (no second copy of the rows).
    const existing = db.prepare("SELECT * FROM sales_import_batches WHERE file_sha256 = ? AND status <> 'ROLLED_BACK' ORDER BY created_at DESC LIMIT 1").get(fileSha);
    if (existing) return { ...rowToBatch(existing), existing: true };
    const kind = ext === ".xlsx" ? "xlsx" : "csv";
    const parsed = kind === "xlsx" ? parseXlsx(buffer) : parseCsv(buffer);
    const headers = (parsed.headers || []).map((h, i) => String(h || "").trim() || `Coloana ${i + 1}`);
    if (!headers.length) throw new HubError("validation", "Fișierul nu are un rând de antet");
    const numeric = new Set((parsed.cellFlags?.numeric || []).map(([r, c]) => `${r}:${c}`));
    const formula = new Set((parsed.cellFlags?.formula || []).map(([r, c]) => `${r}:${c}`));
    fs.mkdirSync(importDir, { recursive: true });
    const stored = path.join(importDir, `${fileSha}${ext}`);
    if (!fs.existsSync(stored)) fs.writeFileSync(stored, buffer);
    const id = newId("sib");
    const t = now();
    const warnings = [...(parsed.warnings || [])];
    if (formula.size) warnings.push(`${formula.size} celule cu formule: folosită doar valoarea salvată în fișier, formula nu a fost evaluată`);
    bus.transaction(() => {
      db.prepare(`INSERT INTO sales_import_batches (id, file_name, file_sha256, file_kind, size_bytes, encoding, delimiter, sheet, sheets_json, headers_json, suggested_json,
        warnings_json, status, synthetic, row_count, stored_path, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'UPLOADED', ?, ?, ?, ?, ?, ?)`)
        .run(id, name, fileSha, kind, buffer.length, parsed.encoding || "", parsed.delimiter || "", parsed.sheet || "", json(parsed.sheets || []), json(headers),
          json(suggestMapping(headers)), json(warnings.slice(0, 50)), synthetic ? 1 : 0, parsed.rows.length, path.relative(config.dataDir, stored), actor, t, t);
      const insert = db.prepare("INSERT INTO sales_import_rows (id, batch_id, row_index, raw_json, normalized_json, status) VALUES (?, ?, ?, ?, ?, 'PENDING')");
      parsed.rows.forEach((cells, i) => {
        const cols = new Set(cells.map((_, c) => c).filter((c) => numeric.has(`${i}:${c}`)));
        insert.run(newId("sir"), id, i, json(cells.map((v) => String(v ?? ""))), json({ numericCols: [...cols] }));
      });
      emit("sales.import.uploaded", id, { file: name, kind, rows: parsed.rows.length, synthetic: Boolean(synthetic) }, actor);
    });
    return getBatch(id);
  }

  function setMapping(batchId, mapping, actor) {
    const batch = needBatch(batchId);
    if (!["UPLOADED", "MAPPED", "PREVIEWED"].includes(batch.status)) throw new HubError("conflict", `Lotul e în ${batch.status}: maparea nu se mai schimbă`);
    const normalized = normalizeMapping(mapping, batch.headers);
    bus.transaction(() => {
      db.prepare("UPDATE sales_import_batches SET mapping_json = ?, mapping_hash = ?, status = 'MAPPED', updated_at = ? WHERE id = ?")
        .run(json(normalized), hashCanonical(normalized), now(), batchId);
      emit("sales.import.mapped", batchId, { fields: Object.values(normalized).filter((f) => f !== "ignore") }, actor);
    });
    return getBatch(batchId);
  }

  /** Candidate orgs for a record (indexed lookups only: fiscal code, identity domain, normalized name). */
  function candidatesFor(record) {
    const rows = new Map();
    const add = (list) => { for (const r of list) rows.set(r.id, r); };
    if (record.fiscalCode) add(db.prepare("SELECT * FROM sales_orgs WHERE fiscal_code = ? AND archived_at IS NULL AND merged_into IS NULL LIMIT 20").all(record.fiscalCode));
    if (record.domain && isIdentityDomain(record.domain)) add(db.prepare("SELECT * FROM sales_orgs WHERE domain = ? AND archived_at IS NULL AND merged_into IS NULL LIMIT 20").all(record.domain));
    if (record.normalizedName) add(db.prepare("SELECT * FROM sales_orgs WHERE normalized_name = ? AND archived_at IS NULL AND merged_into IS NULL LIMIT 20").all(record.normalizedName));
    return [...rows.values()].map((r) => ({ id: r.id, name: r.display_name, fiscalCode: r.fiscal_code_valid ? r.fiscal_code : "", domain: r.domain_kind === "organization_site" ? r.domain : "",
      city: r.city, emails: db.prepare("SELECT value FROM sales_contacts WHERE org_id = ? AND kind = 'email'").all(r.id).map((c) => c.value) }));
  }
  const matchRecord = (record) => matchCandidates({ name: record.name, fiscalCode: record.fiscalCodeValid ? record.fiscalCode : "",
    domain: record.domainKind === "organization_site" ? record.domain : "", city: record.city, emails: record.emails.map((e) => e.value) }, candidatesFor(record));

  /** Classifies one row without writing anything (used by preview and by confirm). */
  function classifyRow(row, batch, seenKeys) {
    const numericCols = new Set(row.normalized.numericCols || []);
    const { record, errors, warnings } = normalizeImportRow(row.raw, batch.mapping, { numericCols });
    if (errors.length) return { status: "INVALID", record, errors, warnings, matches: [] };
    const keys = identityKeys(record);
    // Two rows with different valid fiscal codes are two companies even with the same name and city (the owner reviews it).
    const ownCui = record.fiscalCodeValid ? record.fiscalCode : "";
    const firstSeen = keys.map((k) => seenKeys.get(k)).find((seen) => seen && !(ownCui && seen.cui && seen.cui !== ownCui));
    if (firstSeen) return { status: "DUPLICATE_IN_FILE", record, errors, warnings: [...warnings, `Duplicat al rândului ${firstSeen.sheetRow} din același fișier`], matches: [], duplicateOf: firstSeen };
    const suppressed = recordSuppression(record);
    if (suppressed) return { status: "SUPPRESSED", record, errors, warnings: [...warnings, `DO_NOT_CONTACT (${suppressed.kind}): nu se importă`], matches: [] };
    const matches = matchRecord(record);
    const action = decideImportAction(matches);
    const status = action === "CREATE" ? "CREATE" : action === "MATCH_EXISTING" ? "MATCH" : "NEEDS_REVIEW";
    return { status, record, errors, warnings, matches };
  }

  /** Classifies every row without writing (only the batch summary). Async: it yields every 250 rows so a big file never blocks Stop All or the voice. */
  async function preview(batchId, { limit = 50 } = {}, actor = "user") {
    const batch = needBatch(batchId);
    if (!["MAPPED", "PREVIEWED"].includes(batch.status)) throw new HubError("conflict", batch.status === "UPLOADED" ? "Mapează întâi coloanele" : `Lotul e în ${batch.status}`);
    const rows = db.prepare("SELECT * FROM sales_import_rows WHERE batch_id = ? ORDER BY row_index").all(batchId).map(rowToImportRow);
    const seen = new Map();
    const summary = { total: rows.length, CREATE: 0, MATCH: 0, NEEDS_REVIEW: 0, DUPLICATE_IN_FILE: 0, INVALID: 0, SUPPRESSED: 0, warnings: 0 };
    const sample = [];
    for (const [index, row] of rows.entries()) {
      if (index && index % 250 === 0) {
        await new Promise((resolve) => setImmediate(resolve));
        const still = getBatch(batchId);
        if (!still || !still.mapping || JSON.stringify(still.mapping) !== JSON.stringify(batch.mapping) || !["MAPPED", "PREVIEWED"].includes(still.status)) {
          throw new HubError("conflict", "Lotul s-a schimbat în timpul previzualizării: reîncearcă");
        }
      }
      const c = classifyRow(row, batch, seen);
      summary[c.status] += 1;
      if (c.warnings.length) summary.warnings += 1;
      if (!["INVALID", "DUPLICATE_IN_FILE"].includes(c.status)) for (const k of identityKeys(c.record)) if (!seen.has(k)) seen.set(k, { sheetRow: row.sheetRow, rowId: row.id, cui: cuiOf(c.record) });
      if (sample.length < Math.min(Math.max(Number(limit) || 50, 1), 200)) sample.push({ rowIndex: row.rowIndex, sheetRow: row.sheetRow, status: c.status, record: c.record, errors: c.errors, warnings: c.warnings, matches: c.matches });
    }
    bus.transaction(() => {
      db.prepare("UPDATE sales_import_batches SET status = 'PREVIEWED', counts_json = ?, updated_at = ? WHERE id = ?").run(json({ preview: summary }), now(), batchId);
      emit("sales.import.previewed", batchId, summary, actor);
    });
    return { batch: getBatch(batchId), summary, rows: sample };
  }

  function createOrgFromRecord(record, { batch, row, actor }) {
    const id = newId("org");
    const t = now();
    db.prepare(`INSERT INTO sales_orgs (id, display_name, normalized_name, legal_form, fiscal_code, fiscal_code_valid, website, domain, domain_kind, city, county, address, caen,
      status, synthetic, created_batch_id, created_row_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'NEW', ?, ?, ?, ?, ?)`)
      .run(id, record.name, record.normalizedName, record.legalForm, record.fiscalCode, record.fiscalCodeValid === null ? null : record.fiscalCodeValid ? 1 : 0,
        record.website, record.domain, record.domainKind, record.city, record.county, record.address, record.caen, batch?.synthetic ? 1 : 0, batch?.id || null, row?.id || null, t, t);
    transition("org", id, null, "NEW", actor, batch ? `Importat din ${batch.fileName} (rândul ${row.sheetRow})` : "Creat manual");
    return id;
  }

  /** Attaches what a row brings (alias, contacts, provenance, financial figure) to an org; never overwrites fields. */
  function attachRecord(orgId, record, { batch, row, actor }) {
    const sourceRef = batch ? `${batch.fileName}#rând ${row.sheetRow}` : "manual";
    const synthetic = Boolean(batch?.synthetic);
    const t = now();
    const added = { contacts: [], evidence: [] };
    const evidenceId = addEvidenceRow({ subjectType: "org", subjectId: orgId, claim: `Date furnizate în ${batch ? "importul" : "înregistrarea"} ${sourceRef}`,
      value: { name: record.name, fiscalCode: record.fiscalRaw, website: record.website, city: record.city, county: record.county, caen: record.caen },
      label: "USER_PROVIDED", sourceKind: batch ? "file" : "manual", sourceRef, retrievedAt: t, method: batch ? `import ${batch.fileKind}` : "manual",
      recheckAfter: plusDays(t, batch ? EVIDENCE_RECHECK_DAYS.import : EVIDENCE_RECHECK_DAYS.manual), synthetic, batchId: batch?.id || null, actor });
    added.evidence.push(evidenceId);
    if (record.name && db.prepare("SELECT display_name FROM sales_orgs WHERE id = ?").get(orgId)?.display_name !== record.name) {
      db.prepare("INSERT OR IGNORE INTO sales_org_aliases (id, org_id, name, normalized, source, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(newId("sal"), orgId, record.name, record.normalizedName, sourceRef, t);
    }
    const addContact = (kind, value, extra = {}) => {
      const id = newId("sct");
      const res = db.prepare(`INSERT OR IGNORE INTO sales_contacts (id, org_id, kind, value, raw, generic, person_name, role, evidence_id, warnings_json, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?)`).run(id, orgId, kind, value, extra.raw || value, extra.generic ? 1 : 0, extra.personName || "", extra.role || "",
        evidenceId, json(extra.warnings || []), t);
      if (res.changes) added.contacts.push(id);
    };
    for (const e of record.emails) addContact("email", e.value, { generic: e.generic, personName: e.generic ? "" : record.contactName, role: e.generic ? "" : record.contactRole });
    for (const p of record.phones) addContact("phone", p.value, { raw: p.raw, warnings: p.warnings });
    if (record.turnover !== null || record.turnoverRaw) {
      added.evidence.push(addEvidenceRow({ subjectType: "org", subjectId: orgId, claim: "financial:turnover",
        value: { indicator: "turnover", value: record.turnover, raw: record.turnoverRaw, currency: null, period: record.turnoverYear || null },
        label: "USER_PROVIDED", sourceKind: batch ? "file" : "manual", sourceRef, retrievedAt: t, method: "coloană din import (monedă nespecificată)",
        recheckAfter: plusDays(t, EVIDENCE_RECHECK_DAYS.import), synthetic, batchId: batch?.id || null, actor }));
    }
    return added;
  }

  /**
   * Imports the mapped rows in chunks; idempotent (processed rows are skipped) and resumable after an interruption.
   * `maxRows` bounds one call (the UI repeats until done); the batch is IMPORTED when no row is PENDING.
   */
  function confirm(batchId, { maxRows = 500 } = {}, actor = "user") {
    const batch = needBatch(batchId);
    if (batch.status === "IMPORTED") return { batch, summary: batch.counts.imported || {}, done: true, alreadyImported: true };
    if (!["PREVIEWED", "IMPORTING"].includes(batch.status)) throw new HubError("conflict", batch.status === "MAPPED" ? "Fă întâi previzualizarea" : `Lotul e în ${batch.status}`);
    if (batch.status === "PREVIEWED") db.prepare("UPDATE sales_import_batches SET status = 'IMPORTING', updated_at = ? WHERE id = ?").run(now(), batchId);
    // In-file duplicates must also see the rows imported by earlier chunks.
    const seen = new Map();
    for (const r of db.prepare("SELECT * FROM sales_import_rows WHERE batch_id = ? AND status IN ('CREATED','MATCHED') ORDER BY row_index").all(batchId).map(rowToImportRow)) {
      for (const k of identityKeys(r.normalized.record || {})) if (!seen.has(k)) seen.set(k, { sheetRow: r.sheetRow, rowId: r.id, orgId: r.orgId, cui: cuiOf(r.normalized.record || {}) });
    }
    const pending = db.prepare("SELECT * FROM sales_import_rows WHERE batch_id = ? AND status = 'PENDING' ORDER BY row_index LIMIT ?").all(batchId, Math.max(1, Number(maxRows) || 1)).map(rowToImportRow);
    const update = db.prepare("UPDATE sales_import_rows SET status = ?, normalized_json = ?, org_id = ?, errors_json = ?, warnings_json = ?, match_json = ?, processed_at = ? WHERE id = ?");
    for (let i = 0; i < pending.length; i += 200) {
      bus.transaction(() => {
        for (const row of pending.slice(i, i + 200)) {
          const c = classifyRow(row, batch, seen);
          const normalized = { numericCols: row.normalized.numericCols || [], record: c.record };
          let status = c.status;
          let orgId = null;
          if (status === "CREATE") { orgId = createOrgFromRecord(c.record, { batch, row, actor }); attachRecord(orgId, c.record, { batch, row, actor }); status = "CREATED"; }
          else if (status === "MATCH") { orgId = c.matches.find((m) => m.strength === "STRONG").existingId; attachRecord(orgId, c.record, { batch, row, actor }); status = "MATCHED"; }
          else if (status === "DUPLICATE_IN_FILE") orgId = c.duplicateOf?.orgId || db.prepare("SELECT org_id FROM sales_import_rows WHERE id = ?").get(c.duplicateOf.rowId)?.org_id || null;
          update.run(status, json(normalized), orgId, json(c.errors), json(c.warnings), json(c.matches), now(), row.id);
          if (["CREATED", "MATCHED"].includes(status)) for (const k of identityKeys(c.record)) if (!seen.has(k)) seen.set(k, { sheetRow: row.sheetRow, rowId: row.id, orgId, cui: cuiOf(c.record) });
        }
      });
    }
    const counts = Object.fromEntries(db.prepare("SELECT status, COUNT(*) AS n FROM sales_import_rows WHERE batch_id = ? GROUP BY status").all(batchId).map((r) => [r.status, r.n]));
    const done = !counts.PENDING;
    bus.transaction(() => {
      db.prepare(`UPDATE sales_import_batches SET status = ?, counts_json = ?, imported_at = COALESCE(imported_at, ?), updated_at = ? WHERE id = ?`)
        .run(done ? "IMPORTED" : "IMPORTING", json({ ...getBatch(batchId).counts, imported: counts }), done ? now() : null, now(), batchId);
      emit(done ? "sales.import.completed" : "sales.import.progress", batchId, counts, actor);
    });
    return { batch: getBatch(batchId), summary: counts, done };
  }

  function batchRows(batchId, { status = null, offset = 0, limit = 50 } = {}) {
    needBatch(batchId);
    const where = status ? " AND status = ?" : "";
    const args = status ? [batchId, status] : [batchId];
    const total = db.prepare(`SELECT COUNT(*) AS n FROM sales_import_rows WHERE batch_id = ?${where}`).get(...args).n;
    const items = db.prepare(`SELECT * FROM sales_import_rows WHERE batch_id = ?${where} ORDER BY row_index LIMIT ? OFFSET ?`).all(...args, clampLimit(limit), Math.max(0, Number(offset) || 0)).map(rowToImportRow);
    return { items, total, offset: Number(offset) || 0, limit: clampLimit(limit) };
  }

  /** A NEEDS_REVIEW row decided by the owner: a new org, an existing one (chosen), or skipped. */
  function resolveRow(rowId, { action, orgId = null, reason = "" }, actor) {
    const row = rowToImportRow(db.prepare("SELECT * FROM sales_import_rows WHERE id = ?").get(rowId));
    if (!row) throw new HubError("not_found", "Rândul nu există");
    if (row.status !== "NEEDS_REVIEW") throw new HubError("conflict", `Rândul e ${row.status}, nu așteaptă o decizie`);
    const batch = needBatch(row.batchId);
    if (batch.status === "ROLLED_BACK") throw new HubError("conflict", "Lotul a fost anulat (rollback): rândurile lui nu se mai rezolvă");
    const record = row.normalized.record;
    // Today's do-not-contact list applies to a decision taken later, not only to the import itself.
    if (action !== "skip") {
      const s = recordSuppression(record);
      if (s) throw new HubError("policy", `DO_NOT_CONTACT (${s.kind}): rândul nu se importă; alege „skip”`);
    }
    // A valid fiscal code already in use is the same legal entity: "create" would make a second copy of it.
    if (action === "create" && record.fiscalCodeValid
      && db.prepare("SELECT 1 FROM sales_orgs WHERE fiscal_code = ? AND fiscal_code_valid = 1 AND archived_at IS NULL AND merged_into IS NULL").get(record.fiscalCode)) {
      throw new HubError("conflict", "Există deja o firmă cu același CUI valid: alege „match” pe ea");
    }
    return bus.transaction(() => {
      let status = "SKIPPED";
      let target = null;
      if (action === "create") { target = createOrgFromRecord(record, { batch, row, actor }); attachRecord(target, record, { batch, row, actor }); status = "CREATED"; }
      else if (action === "match") {
        const org = needOrg(orgId);
        assertWorkable(org);
        if (org.fiscalCodeValid && record.fiscalCodeValid && org.fiscalCode !== record.fiscalCode) throw new HubError("conflict", "CUI-uri valide diferite: sunt firme diferite, nu se pot asocia");
        target = org.id; attachRecord(target, record, { batch, row, actor }); status = "MATCHED";
      } else if (action !== "skip") throw new HubError("validation", "Acțiune: create | match | skip");
      db.prepare("UPDATE sales_import_rows SET status = ?, org_id = ?, resolution_json = ?, processed_at = ? WHERE id = ?")
        .run(status, target, json({ action, by: actor, reason: clip(reason, 200), at: now() }), now(), row.id);
      emit("sales.import.row_resolved", row.batchId, { rowId, action, orgId: target }, actor);
      return rowToImportRow(db.prepare("SELECT * FROM sales_import_rows WHERE id = ?").get(rowId));
    });
  }

  /** What a rollback would do: created orgs untouched since import are archived; the edited ones are kept and listed. */
  function rollbackPreview(batchId) {
    const batch = needBatch(batchId);
    if (!["IMPORTED", "IMPORTING"].includes(batch.status)) throw new HubError("conflict", `Lotul e în ${batch.status}`);
    const created = db.prepare("SELECT * FROM sales_orgs WHERE created_batch_id = ? AND archived_at IS NULL").all(batchId).map(rowToOrg);
    const removable = [];
    const conflicts = [];
    for (const org of created) {
      const reasons = [];
      if (org.editedAfterImport) reasons.push("editată după import");
      if (org.mergedInto) reasons.push("unită cu altă firmă");
      const opp = db.prepare("SELECT COUNT(*) AS n FROM sales_opportunities WHERE org_id = ?").get(org.id).n;
      if (opp) reasons.push(`${opp} oportunități`);
      const audits = db.prepare("SELECT COUNT(*) AS n FROM sales_audits WHERE org_id = ?").get(org.id).n;
      if (audits) reasons.push(`${audits} audituri`);
      const otherRows = db.prepare("SELECT COUNT(*) AS n FROM sales_import_rows WHERE org_id = ? AND batch_id <> ? AND status = 'MATCHED'").get(org.id, batchId).n;
      if (otherRows) reasons.push(`date și din ${otherRows} rânduri ale altor loturi`);
      if (org.status !== "NEW") reasons.push(`status ${org.status}`);
      (reasons.length ? conflicts : removable).push({ orgId: org.id, name: org.displayName, reasons });
    }
    // By batch id (never by file name: two files can share a name, and `_`/`%` would act as wildcards).
    const matchedContacts = db.prepare(`SELECT COUNT(*) AS n FROM sales_contacts c WHERE c.status = 'ACTIVE' AND c.evidence_id IN (SELECT id FROM sales_evidence WHERE batch_id = ?)
      AND c.org_id NOT IN (SELECT id FROM sales_orgs WHERE created_batch_id = ?)`).get(batchId, batchId).n;
    return { batchId, removable, conflicts, matchedContacts, note: "Rollback-ul arhivează (nu șterge) firmele neatinse create de lot; firmele modificate între timp rămân." };
  }

  function rollback(batchId, actor, { reason = "" } = {}, decision = {}) {
    const plan = rollbackPreview(batchId);
    const batch = needBatch(batchId);
    return bus.transaction(() => {
      // 2.15.2: only the owner's decision rolls a batch back (the owner session re-read here, the approval of this exact batch consumed).
      const auth = approvedDecision(decision, "sales.import_rollback", "rollback-ul importului", (p) => p.batchId === batchId);
      const t = now();
      for (const r of plan.removable) {
        db.prepare("UPDATE sales_orgs SET archived_at = ?, archive_reason = ?, updated_at = ? WHERE id = ? AND archived_at IS NULL").run(t, `rollback lot ${batch.fileName}`, t, r.orgId);
        transition("org", r.orgId, "NEW", "ARCHIVED", actor, `Rollback import ${batch.fileName}`);
      }
      db.prepare(`UPDATE sales_contacts SET status = 'ROLLED_BACK' WHERE status = 'ACTIVE' AND evidence_id IN (SELECT id FROM sales_evidence WHERE batch_id = ?)
        AND org_id NOT IN (SELECT id FROM sales_orgs WHERE created_batch_id = ?)`).run(batchId, batchId);
      // Rows still waiting for a decision are closed with the batch: nothing of a rolled-back file can enter later.
      db.prepare("UPDATE sales_import_rows SET status = 'SKIPPED', resolution_json = ?, processed_at = ? WHERE batch_id = ? AND status IN ('NEEDS_REVIEW','PENDING')")
        .run(json({ action: "skip", by: actor, reason: "rollback", at: t }), t, batchId);
      db.prepare("UPDATE sales_import_batches SET status = 'ROLLED_BACK', rolled_back_at = ?, counts_json = ?, updated_at = ? WHERE id = ?")
        .run(t, json({ ...batch.counts, rollback: { archived: plan.removable.length, kept: plan.conflicts.length, reason: clip(reason, 300), by: actor } }), t, batchId);
      emit("sales.import.rolled_back", batchId, { archived: plan.removable.length, kept: plan.conflicts.length, ...auth }, actor);
      return { ...plan, batch: getBatch(batchId) };
    });
  }

  // ---------- organizations ----------
  const clampLimit = (limit) => Math.min(Math.max(Number(limit) || 50, 1), 200);
  const rowToQualification = (r) => r && { id: r.id, formulaVersion: r.formula_version, result: parse(r.result_json, {}), priority: r.priority, override: parse(r.override_json, null),
    createdBy: r.created_by, createdAt: r.created_at, inputsSha: r.inputs_sha || "", orgId: r.org_id };
  function latestQualification(orgId) {
    return rowToQualification(db.prepare("SELECT * FROM sales_qualifications WHERE org_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1").get(orgId));
  }
  /** M12 review R3/R8: one exact qualification row (the one a preparation-bound offer is bound to), never „the latest”. */
  const qualificationById = (id) => rowToQualification(db.prepare("SELECT * FROM sales_qualifications WHERE id = ?").get(String(id || "")));

  function listOrgs({ q = "", status = "", city = "", synthetic = "", needsReview = false, offset = 0, limit = 50, sort = "updated" } = {}) {
    const where = ["o.archived_at IS NULL", "o.merged_into IS NULL"];
    const args = [];
    if (q) {
      const like = `%${foldDiacritics(String(q)).toLowerCase().slice(0, 80)}%`;
      where.push("(o.normalized_name LIKE ? OR lower(o.display_name) LIKE ? OR o.domain LIKE ? OR o.fiscal_code LIKE ?)");
      args.push(like, `%${String(q).toLowerCase().slice(0, 80)}%`, like, `%${String(q).replace(/\D/g, "") || "~"}%`);
    }
    if (status) { where.push("o.status = ?"); args.push(String(status)); }
    if (city) { where.push("lower(o.city) = lower(?)"); args.push(String(city)); }
    if (synthetic === "1" || synthetic === true) where.push("o.synthetic = 1");
    if (synthetic === "0") where.push("o.synthetic = 0");
    const order = { name: "o.normalized_name ASC", name_asc: "o.normalized_name ASC", priority: "priority IS NULL, priority DESC, o.normalized_name", priority_desc: "priority IS NULL, priority DESC, o.normalized_name",
      updated: "o.updated_at DESC", updated_desc: "o.updated_at DESC", created_desc: "o.created_at DESC" }[sort] || "o.updated_at DESC";
    const base = `FROM sales_orgs o WHERE ${where.join(" AND ")}`;
    const total = db.prepare(`SELECT COUNT(*) AS n ${base}`).get(...args).n;
    const lim = clampLimit(limit);
    const off = Math.max(0, Number(offset) || 0);
    const items = db.prepare(`SELECT o.*, (SELECT priority FROM sales_qualifications q WHERE q.org_id = o.id ORDER BY q.created_at DESC, q.rowid DESC LIMIT 1) AS priority,
      (SELECT COUNT(*) FROM sales_contacts c WHERE c.org_id = o.id AND c.status = 'ACTIVE') AS contacts ${base} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...args, lim, off)
      .map((r) => ({ ...rowToOrg(r), priority: r.priority, contacts: r.contacts }));
    const review = needsReview ? reviewRows({ limit: lim, offset: off }) : null;
    return { items, total, offset: off, limit: lim, ...(review ? { review } : {}) };
  }

  function reviewRows({ offset = 0, limit = 50 } = {}) {
    const open = "status = 'NEEDS_REVIEW' AND batch_id NOT IN (SELECT id FROM sales_import_batches WHERE status = 'ROLLED_BACK')";
    const total = db.prepare(`SELECT COUNT(*) AS n FROM sales_import_rows WHERE ${open}`).get().n;
    const items = db.prepare(`SELECT * FROM sales_import_rows WHERE ${open} ORDER BY processed_at LIMIT ? OFFSET ?`).all(clampLimit(limit), Math.max(0, Number(offset) || 0)).map(rowToImportRow);
    return { items, total };
  }

  function getOrg(id) {
    const org = needOrg(id);
    const audits = db.prepare("SELECT * FROM sales_audits WHERE org_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 5").all(id).map((r) => ({ id: r.id, url: r.url, sourceKind: r.source_kind,
      fetchedAt: r.fetched_at, version: r.version, result: parse(r.result_json, {}), opportunities: parse(r.opportunities_json, []), synthetic: Boolean(r.synthetic), createdAt: r.created_at }));
    const evidence = evidenceOf("org", id);
    const qualHistory = db.prepare("SELECT id, formula_version, priority, override_json, created_by, created_at FROM sales_qualifications WHERE org_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 10").all(id)
      .map((r) => ({ id: r.id, formulaVersion: r.formula_version, priority: r.priority, override: parse(r.override_json, null), createdBy: r.created_by, createdAt: r.created_at }));
    return {
      org, aliases: db.prepare("SELECT name, source, created_at AS createdAt FROM sales_org_aliases WHERE org_id = ?").all(id),
      contacts: contactsOf(id), evidence, audits, qualification: latestQualification(id), qualificationHistory: qualHistory,
      opportunities: db.prepare("SELECT * FROM sales_opportunities WHERE org_id = ? ORDER BY created_at DESC").all(id).map(rowToOpp),
      transitions: db.prepare("SELECT * FROM sales_transitions WHERE subject_type = 'org' AND subject_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 50").all(id)
        .map((r) => ({ from: r.from_status, to: r.to_status, actor: r.actor, reason: r.reason, at: r.created_at })),
      suppression: suppressionFor({ orgId: id }),
      contactEvents: db.prepare("SELECT * FROM sales_contact_events WHERE org_id = ? ORDER BY occurred_at DESC").all(id).map((r) => ({ id: r.id, kind: r.kind, occurredAt: r.occurred_at, channel: r.channel, note: r.note, actor: r.actor })),
      merges: db.prepare("SELECT id, survivor_id AS survivorId, merged_id AS mergedId, reason, created_at AS createdAt, reverted_at AS revertedAt FROM sales_merges WHERE survivor_id = ? OR merged_id = ? ORDER BY created_at DESC").all(id, id),
      importRows: db.prepare("SELECT r.id, r.status, r.row_index, b.file_name FROM sales_import_rows r JOIN sales_import_batches b ON b.id = r.batch_id WHERE r.org_id = ? ORDER BY r.processed_at").all(id)
        .map((r) => ({ id: r.id, status: r.status, sheetRow: r.row_index + 2, file: r.file_name })),
      unknowns: [!org.fiscalCode && "CUI", org.fiscalCodeValid === false && "CUI valid", !org.website && "site", !contactsOf(id).length && "contact", !org.city && "oraș"].filter(Boolean),
      evidenceStatus: evidenceStatusOf(evidence),
      lastVerifiedAt: evidence.filter(usable).map((e) => e.verifiedAt || e.retrievedAt).filter(Boolean).sort().pop() || null,
    };
  }

  const evidenceStatusOf = (evidence) => ({
    current: evidence.filter((e) => e.freshness === "CURRENT").length,
    needsRecheck: evidence.filter((e) => e.freshness === "NEEDS_RECHECK").length,
    superseded: evidence.filter((e) => e.freshness === "SUPERSEDED").length,
    rolledBack: evidence.filter((e) => e.freshness === "ROLLED_BACK").length,
    contradictions: evidence.filter((e) => e.conflictsWith.length).map((e) => ({ id: e.id, claim: e.claim, conflictsWith: e.conflictsWith })),
  });

  function transitionOrg(id, { to, reason = "" }, actor) {
    const org = needOrg(id);
    if (to === "DO_NOT_CONTACT") return suppress(id, { reason, source: "owner" }, actor);
    const allowed = LEAD_TRANSITIONS[org.status] || [];
    if (org.status === "DO_NOT_CONTACT") throw new HubError("conflict", "Firma e DO_NOT_CONTACT: doar ridicarea explicită a interdicției (cu aprobare) o poate scoate");
    if (!allowed.includes(to)) throw new HubError("conflict", `Tranziție nepermisă: ${org.status} → ${to}`);
    if (String(reason || "").trim().length < 3) throw new HubError("validation", "Spune pe scurt motivul (minimum 3 caractere)");
    return bus.transaction(() => {
      db.prepare("UPDATE sales_orgs SET status = ?, version = version + 1, edited_after_import = 1, updated_at = ? WHERE id = ?").run(to, now(), id);
      transition("org", id, org.status, to, actor, reason);
      emit("sales.org.transition", id, { from: org.status, to }, actor);
      // M12 review C3: the company sheet of „Dosarul ofertei” shows the status: a READY dossier of this company is re-checked (STALE).
      invalidateBound([id], `statusul firmei s-a schimbat (${org.status} → ${to})`);
      return getOrg(id);
    });
  }

  function updateOrg(id, fields, actor) {
    const org = needOrg(id);
    const allowed = { city: 80, county: 80, address: 300, caen: 20, website: 300 };
    const changes = {};
    for (const [key, max] of Object.entries(allowed)) if (fields[key] !== undefined) changes[key] = clip(fields[key], max);
    if (!Object.keys(changes).length) throw new HubError("validation", "Nimic de modificat");
    if (String(fields.reason || "").trim().length < 3) throw new HubError("validation", "Spune pe scurt sursa sau motivul modificării");
    return bus.transaction(() => {
      if (changes.website !== undefined) {
        const kind = changes.website ? classifyUrl(changes.website) : { kind: "" };
        changes.domain = changes.website ? normalizeDomain(changes.website) : "";
        changes.domain_kind = kind.kind;
      }
      const cols = Object.keys(changes);
      db.prepare(`UPDATE sales_orgs SET ${cols.map((c) => `${c} = ?`).join(", ")}, version = version + 1, edited_after_import = 1, updated_at = ? WHERE id = ?`).run(...cols.map((c) => changes[c]), now(), id);
      addEvidenceRow({ subjectType: "org", subjectId: id, subjectVersion: org.version + 1, claim: `Modificare: ${cols.join(", ")}`, value: changes, label: "USER_PROVIDED",
        sourceKind: "manual", sourceRef: clip(fields.reason, 300), retrievedAt: now(), method: "editare în Hub", synthetic: org.synthetic, actor });
      return getOrg(id);
    });
  }

  function addEvidence(subjectType, subjectId, input, actor) {
    if (subjectType === "org") needOrg(subjectId);
    else if (subjectType === "opportunity") needOpp(subjectId);
    else throw new HubError("validation", "Subiect necunoscut");
    const org = subjectType === "org" ? getOrgRow(subjectId) : null;
    return bus.transaction(() => {
      // Added by hand: a declared kind follows the C-03 rules, and FIXTURE is refused here (only the adapter and the generator make it).
      const id = addEvidenceRow({ ...input, subjectType, subjectId, subjectVersion: org?.version || 1, synthetic: Boolean(org?.synthetic), actor }, { origin: "manual" });
      emit("sales.evidence.added", subjectId, { evidenceId: id, label: input.label, ...(input.dataKind ? { dataKind: input.dataKind } : {}) }, actor);
      return rowToEvidence(db.prepare("SELECT * FROM sales_evidence WHERE id = ?").get(id));
    });
  }

  /** Merge only on the owner's decision; never two orgs with different valid fiscal codes. Reversible. */
  function mergeOrgs(mergedId, { intoId, reason }, actor) {
    const merged = needOrg(mergedId);
    const survivor = needOrg(intoId);
    if (merged.id === survivor.id) throw new HubError("validation", "O firmă nu se unește cu ea însăși");
    if (merged.mergedInto || survivor.mergedInto || merged.archivedAt || survivor.archivedAt) throw new HubError("conflict", "Una dintre firme e deja unită sau arhivată");
    if (merged.fiscalCodeValid && survivor.fiscalCodeValid && merged.fiscalCode !== survivor.fiscalCode) throw new HubError("conflict", "CUI-uri valide diferite: sunt firme diferite (filiale/branduri se păstrează separat)");
    if (String(reason || "").trim().length < 5) throw new HubError("validation", "Unirea cere un motiv (minimum 5 caractere)");
    return bus.transaction(() => {
      const id = newId("smg");
      const copied = [];
      for (const c of contactsOf(merged.id)) {
        const cid = newId("sct");
        const res = db.prepare(`INSERT OR IGNORE INTO sales_contacts (id, org_id, kind, value, raw, generic, person_name, role, evidence_id, warnings_json, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(cid, survivor.id, c.kind, c.value, c.raw, c.generic ? 1 : 0, c.personName, c.role, c.evidenceId, json(c.warnings), c.status, now());
        if (res.changes) copied.push(cid);
      }
      const alias = newId("sal");
      const aliasRes = db.prepare("INSERT OR IGNORE INTO sales_org_aliases (id, org_id, name, normalized, source, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(alias, survivor.id, merged.displayName, merged.normalizedName, `unire ${id}`, now());
      db.prepare("UPDATE sales_orgs SET merged_into = ?, version = version + 1, updated_at = ? WHERE id = ?").run(survivor.id, now(), merged.id);
      db.prepare("UPDATE sales_orgs SET version = version + 1, edited_after_import = 1, updated_at = ? WHERE id = ?").run(now(), survivor.id);
      db.prepare("INSERT INTO sales_merges (id, survivor_id, merged_id, reason, before_json, actor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(id, survivor.id, merged.id, clip(reason, 300), json({ copiedContacts: copied, aliasId: aliasRes.changes ? alias : null }), actor, now());
      transition("org", merged.id, merged.status, merged.status, actor, `Unită în ${survivor.displayName}: ${reason}`);
      // A do-not-contact on either side now covers both (it stays after a revert; lifting it needs its own approval).
      if (merged.status === "DO_NOT_CONTACT" || survivor.status === "DO_NOT_CONTACT" || suppressionFor({ orgId: merged.id }) || suppressionFor({ orgId: survivor.id })) {
        suppress(survivor.id, { reason: "Unire cu o firmă DO_NOT_CONTACT", source: "merge" }, actor);
      }
      invalidateBound([merged.id, survivor.id], "firma a fost unită cu alta", { force: true });
      emit("sales.org.merged", survivor.id, { mergeId: id, mergedId: merged.id }, actor);
      return { mergeId: id, survivor: getOrg(survivor.id) };
    });
  }

  function revertMerge(mergeId, actor) {
    const m = db.prepare("SELECT * FROM sales_merges WHERE id = ?").get(mergeId);
    if (!m) throw new HubError("not_found", "Unirea nu există");
    if (m.reverted_at) throw new HubError("conflict", "Unirea a fost deja anulată");
    const before = parse(m.before_json, {});
    return bus.transaction(() => {
      for (const cid of before.copiedContacts || []) db.prepare("DELETE FROM sales_contacts WHERE id = ? AND org_id = ?").run(cid, m.survivor_id);
      if (before.aliasId) db.prepare("DELETE FROM sales_org_aliases WHERE id = ?").run(before.aliasId);
      db.prepare("UPDATE sales_orgs SET merged_into = NULL, version = version + 1, updated_at = ? WHERE id = ?").run(now(), m.merged_id);
      db.prepare("UPDATE sales_merges SET reverted_at = ?, reverted_by = ? WHERE id = ?").run(now(), actor, mergeId);
      emit("sales.org.merge_reverted", m.survivor_id, { mergeId }, actor);
      return { survivor: getOrg(m.survivor_id), restored: getOrg(m.merged_id) };
    });
  }

  // ---------- audit & qualification ----------
  async function auditOrg(id, { sourceKind = "fixture" } = {}, actor) {
    const org = needOrg(id);
    if (!org.domain) throw new HubError("validation", "Firma nu are un site: auditul cere un domeniu");
    if (org.domainKind && org.domainKind !== "organization_site") throw new HubError("validation", `Site-ul înregistrat pare ${org.domainKind}: nu e site-ul firmei, auditul ar fi despre altceva`);
    if (sourceKind !== "fixture") await sources.fetch("live", org.website); // always refused in M04 (LIVE_COLLECTION_DISABLED)
    if (!org.domain.endsWith(".test")) throw new HubError("policy", "M04 rulează auditul doar pe site-uri fixture (.test); colectarea live de pe site-uri reale cere o autorizare separată");
    const fetched = await sources.fetch("fixture", org.domain);
    return recordAudit(id, org, fetched, actor);
  }

  /** The audit of a fixture page already read (sync, one transaction): the audit row, its labelled evidence and the org's status. */
  function recordAudit(id, org, fetched, actor) {
    const audit = auditHtml({ html: fetched.body, url: fetched.finalUrl || org.website, orgName: org.displayName, fetchedAt: fetched.fetchedAt || now(), sourceKind: "fixture" });
    const opportunities = opportunitiesFromAudit(audit, services());
    return bus.transaction(() => {
      const auditId = newId("sad");
      db.prepare("INSERT INTO sales_audits (id, org_id, url, source_kind, fetched_at, version, result_json, opportunities_json, synthetic, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(auditId, id, audit.url || org.website, "fixture", fetched.fetchedAt || now(), audit.version, json(audit), json(opportunities), 1, actor, now());
      for (const check of audit.checks.filter((c) => c.status === "PASS" || c.status === "ISSUE")) {
        // C-03 (M12): a check read directly from the fixture page is FIXTURE data; a check the audit deduced is an INFERENCE whose
        // basis is the stored audit check and whose reasoning is the audit's own observation.
        const inferred = check.label === "INFERRED";
        addEvidenceRow({ subjectType: "org", subjectId: id, subjectVersion: org.version, claim: `audit:${check.id}`, value: { status: check.status, observation: check.observation, auditId },
          label: inferred ? "INFERRED" : "OBSERVED", sourceKind: "fixture", sourceRef: `${audit.url || org.website} (fixture sintetic)`, retrievedAt: fetched.fetchedAt || now(),
          excerpt: check.evidence?.excerpt || "", method: `${check.evidence?.method || "static-html"}${check.evidence?.selector ? ` · ${check.evidence.selector}` : ""}`,
          recheckAfter: plusDays(fetched.fetchedAt || now(), EVIDENCE_RECHECK_DAYS.audit), synthetic: true, actor,
          dataKind: inferred ? "INFERENCE" : "FIXTURE", basis: inferred ? [`audit:${auditId}#${check.id}`] : [],
          reasoning: inferred ? (check.observation || `Dedus de verificarea statică ${check.id}`) : "" }, { origin: "fixture" });
      }
      // The page was read asynchronously: the org may have changed meanwhile (do-not-contact, merge). Only its CURRENT status moves.
      const cur = getOrgRow(id);
      if (!cur || cur.archivedAt || cur.mergedInto) throw new HubError("conflict", "Firma s-a schimbat în timpul auditului (unită sau arhivată)");
      if (["NEW", "NEEDS_RESEARCH", "QUALIFIED"].includes(cur.status)
        && db.prepare("UPDATE sales_orgs SET status = 'AUDITED', version = version + 1, updated_at = ? WHERE id = ? AND status = ?").run(now(), id, cur.status).changes) {
        transition("org", id, cur.status, "AUDITED", actor, `Audit ${audit.version} pe fixture`);
      }
      emit("sales.audit.completed", id, { auditId, issues: audit.checks.filter((c) => c.status === "ISSUE").length, opportunities: opportunities.length }, actor);
      return { auditId, audit, opportunities };
    });
  }

  // ---------- M12: what the confirmed preparation plan writes (its executors call these; none of them is a command) ----------
  // A value read through a typo (R-TYPO, review R13) is inferred from the request itself (`brief:<id>#request`), never from a statement.
  const BRIEF_SOURCE_FIELD = Object.freeze({ "R-SECTOR@1": "clientType", "R-PLACE@1": "place", "R-SERVICE@1": "problem", "R-TYPO@1": "request" });
  /**
   * M12 review R17: a synthetic identity is never one a company already has — its domain, fiscal code or e-mail in sales_orgs /
   * sales_contacts (synthetic or not), or on the DO_NOT_CONTACT list. The generator re-draws (deterministically) while this holds.
   */
  function syntheticIdentityTaken(identity) {
    const domain = normalizeDomain(String(identity?.domain || ""));
    const email = String(identity?.email || "").toLowerCase();
    const fiscal = String(identity?.fiscalCode || "");
    return Boolean(db.prepare("SELECT 1 FROM sales_orgs WHERE domain = ? OR fiscal_code = ? LIMIT 1").get(domain, fiscal)
      || db.prepare("SELECT 1 FROM sales_contacts WHERE lower(value) = ? LIMIT 1").get(email)
      || db.prepare("SELECT 1 FROM sales_suppressions WHERE (kind = 'domain' AND value = ?) OR (kind = 'email' AND value = ?) OR (kind = 'fiscal_code' AND value = ?) LIMIT 1").get(domain, email, fiscal));
  }
  /**
   * The synthetic client of a brief (S-02), in the caller's transaction: the company (synthetic = 1, `.test` domain, fiscal code 99…,
   * no record field taken from the brief), its identity as FIXTURE evidence (name, fiscal code, site, e-mail — so q-v2 scores only what a
   * recorded row backs), the generic `.test` mailbox the contact draft needs, what the owner said as STATEMENT evidence (source
   * `brief:<preparation>#<field>`) and what the brief inferred as INFERENCE evidence (basis: the owner's field, reasoning: the rule),
   * then the opportunity. Never matched or merged with another company. → { orgId, opportunityId, evidence: { field: id }, problemEvidenceId }
   */
  function createPreparationOrg({ identity, brief, preparationId, actor }) {
    if (!identity?.synthetic || !/\.test$/.test(String(identity.domain || "")) || !/^99\d{8}$/.test(String(identity.fiscalCode || ""))) {
      throw new HubError("policy", "Pregătirea M12 lucrează doar cu o firmă sintetică (.test, CUI 99…)", { code: "SALES_NOT_SYNTHETIC" });
    }
    if (!/^spp_[A-Za-z0-9_]+$/.test(String(preparationId || ""))) throw new HubError("validation", "Pregătirea nu are un id valid");
    return bus.transaction(() => {
      // R17: never a second company with the same domain, fiscal code or e-mail (the plan step re-draws before it comes here).
      if (syntheticIdentityTaken(identity)) throw new HubError("conflict", "Identitatea sintetică (domeniu, CUI sau e-mail) există deja la o firmă; nu o refolosesc.", { code: "SALES_SYNTHETIC_TAKEN" });
      const t = now();
      const n = normalizeName(identity.name);
      const orgId = newId("org");
      db.prepare(`INSERT INTO sales_orgs (id, display_name, normalized_name, legal_form, fiscal_code, fiscal_code_valid, website, domain, domain_kind, city, county, address, caen,
        status, synthetic, created_batch_id, created_row_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?, 'organization_site', '', '', '', '', 'NEW', 1, NULL, NULL, ?, ?)`)
        .run(orgId, clip(identity.name, 200), n.normalized, identity.legalForm || n.legalForm || "", identity.fiscalCode, identity.website, normalizeDomain(identity.domain), t, t);
      transition("org", orgId, null, "NEW", actor, `Firmă sintetică (${identity.generator}) pentru pregătirea ${preparationId}`);
      const evidence = {};
      const source = `${identity.generator}:${identity.seed} (fixture sintetic)`;
      const fixture = (claim, value) => addEvidenceRow({ subjectType: "org", subjectId: orgId, claim, value, label: "OBSERVED", sourceKind: "fixture", sourceRef: source,
        retrievedAt: t, method: `generator ${identity.generator}`, synthetic: true, actor, dataKind: "FIXTURE" }, { origin: "synthetic" });
      evidence.name = fixture("name", { name: identity.name });
      evidence.fiscalCode = fixture("fiscalCode", { fiscalCode: identity.fiscalCode });
      evidence.website = fixture("website", { website: identity.website, domain: identity.domain });
      evidence.email = fixture("email", { email: identity.email });
      db.prepare(`INSERT INTO sales_contacts (id, org_id, kind, value, raw, generic, person_name, role, evidence_id, warnings_json, status, created_at)
        VALUES (?, ?, 'email', ?, ?, 1, '', '', ?, '[]', 'ACTIVE', ?)`).run(newId("sct"), orgId, String(identity.email).toLowerCase(), identity.email, evidence.email, t);
      // What the owner said (verbatim) and what the brief deduced from it: evidence about the company, never record fields.
      for (const [field, f] of Object.entries(brief?.fields || {})) {
        if (!f || typeof f !== "object") continue;
        const value = Array.isArray(f.value) ? f.value.map((v) => clip(v, 200)) : clip(f.value, 300);
        if (f.provenance === "USER_PROVIDED") {
          // A need cut before its figures (brief R-NEED-CUT) keeps here, internally, the whole need the owner stated (`stated`).
          evidence[`brief:${field}`] = addEvidenceRow({ subjectType: "org", subjectId: orgId, claim: `brief:${field}`, value: { field, value, span: clip(f.span ?? "", 300), ...(f.stated ? { stated: clip(f.stated, 600) } : {}) },
            label: "USER_PROVIDED", sourceKind: "manual", sourceRef: `brief:${preparationId}#${field}`, retrievedAt: t, method: `brief ${brief.version}`, synthetic: true, actor,
            dataKind: "STATEMENT" }, { origin: "manual", preparationId });
        } else if (f.provenance === "INFERRED") {
          const from = Object.entries(brief.fields).find(([k, g]) => k !== field && g?.provenance === "USER_PROVIDED" && clip(g.value, 300) === clip(f.from, 300))?.[0] || BRIEF_SOURCE_FIELD[f.rule];
          if (!from || !(from === "request" ? String(brief.request || "").trim() : brief.fields[from])) continue;
          evidence[`brief:${field}`] = addEvidenceRow({ subjectType: "org", subjectId: orgId, claim: `brief:${field}`, value: { field, value, rule: f.rule || "" },
            label: "INFERRED", sourceKind: "manual", sourceRef: `rule:${f.rule || "brief"}`, retrievedAt: t, method: `brief ${brief.version}`, synthetic: true, actor,
            dataKind: "INFERENCE", basis: [`brief:${preparationId}#${from}`], reasoning: clip(f.reasoning || `dedus din „${f.from}”`, 400) }, { origin: "manual", preparationId });
        }
      }
      const said = (k) => (brief?.fields?.[k]?.provenance === "USER_PROVIDED" ? clip(brief.fields[k].value, 120) : "");
      const title = `Ofertă (sintetic): ${[said("clientType"), said("problem")].filter(Boolean).join(" — ") || "cerere de ofertă"}`;
      const opp = createOpportunity({ orgId, title, need: said("problem") }, actor);
      return { orgId, opportunityId: opp.opportunity.id, evidence, problemEvidenceId: evidence["brief:problem"] || null };
    });
  }

  /**
   * The research of a synthetic company's site (S-03): ONLY the fixture adapter. A generated `.test` host has no fixture page →
   * { found: false }; a `live` request is refused before anything (LIVE_COLLECTION_DISABLED). Reads only; nothing is written here.
   */
  async function fixturePage(host, { mode = "fixture" } = {}) {
    if (mode !== "fixture") await sources.fetch("live", host); // always refused (LIVE_COLLECTION_DISABLED)
    if (!/\.test$/.test(String(host || ""))) throw new HubError("policy", "Cercetarea M12 citește doar site-uri fixture (.test)", { code: "SALES_NOT_SYNTHETIC" });
    try { return { found: true, adapter: "fixture-v1", host, page: await sources.fetch("fixture", host) }; }
    catch (error) { if (error?.category === "not_found") return { found: false, adapter: "fixture-v1", host, reason: error.message }; throw error; }
  }
  /**
   * What the research found, in the caller's transaction: the fixture page's audit with its labelled evidence, or — no fixture page —
   * ONE evidence row UNKNOWN „neverificat: nu există pagina fixture” (FIXTURE kind, origin fixture). Nothing is invented. → { evidenceIds, auditId }
   */
  function recordResearch(orgId, research, actor) {
    const org = needOrg(orgId);
    if (!org.synthetic) throw new HubError("policy", "Cercetarea M12 e doar pentru firme sintetice", { code: "SALES_NOT_SYNTHETIC" });
    if (research?.found) {
      const out = recordAudit(orgId, org, research.page, actor);
      return { auditId: out.auditId, evidenceIds: db.prepare("SELECT id FROM sales_evidence WHERE subject_id = ? AND json_extract(value_json, '$.auditId') = ?").all(orgId, out.auditId).map((r) => r.id) };
    }
    return bus.transaction(() => {
      const t = now();
      const id = addEvidenceRow({ subjectType: "org", subjectId: orgId, subjectVersion: org.version, claim: "research:site", value: { host: research?.host || org.domain, adapter: research?.adapter || "fixture-v1", found: false },
        label: "UNKNOWN", sourceKind: "fixture", sourceRef: `fixture:${research?.host || org.domain} (fixture sintetic)`, retrievedAt: t, excerpt: "neverificat: nu există pagina fixture",
        method: "fixture-v1 · fără pagină", synthetic: true, actor, dataKind: "FIXTURE" }, { origin: "fixture" });
      return { auditId: null, evidenceIds: [id] };
    });
  }

  function financialsOf(orgId) {
    return evidenceOf("org", orgId).filter((e) => e.claim.startsWith("financial:") && usable(e))
      .map((e) => ({ ...(e.value || {}), sourceRef: e.sourceRef, verifiedAt: e.verifiedAt || e.retrievedAt, evidenceId: e.id, freshness: e.freshness, conflictsWith: e.conflictsWith }));
  }

  /** What a qualification is computed from (its stored inputs_sha): the company's evidence ids, its latest audit, the active catalog. */
  function qualificationInputsSha(id, sheet = getOrg(id)) {
    const latestAudit = sheet.audits[0] || null;
    return hashCanonical({ ev: sheet.evidence.map((e) => e.id), audit: latestAudit?.id || null, catalog: services().map((s) => `${s.id}@${s.version}`) });
  }
  /** `formula` defaults to q-v1 (M04); the M12 plan asks for q-v2 explicitly. A stored row keeps the version it was computed with. */
  function qualifyOrg(id, { filters = {}, formula = QUALIFICATION_FORMULA.version } = {}, actor) {
    const org = needOrg(id);
    const sheet = getOrg(id);
    const latestAudit = sheet.audits[0] || null;
    const input = { org: { ...org, contacts: sheet.contacts.filter((c) => c.status === "ACTIVE") }, evidence: sheet.evidence.filter(usable), audit: latestAudit ? latestAudit.result : null,
      opportunities: latestAudit ? latestAudit.opportunities : [], catalog: services(), financials: financialsOf(id), filters };
    const result = qualify(input, { formula });
    return bus.transaction(() => {
      const qid = newId("squ");
      db.prepare("INSERT INTO sales_qualifications (id, org_id, formula_version, result_json, priority, inputs_sha, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run(qid, id, result.version || QUALIFICATION_FORMULA.version, json(result), result.priority, qualificationInputsSha(id, sheet), actor, now());
      invalidateBound([id], "o calificare nouă");
      emit("sales.qualified", id, { qualificationId: qid, priority: result.priority }, actor);
      return latestQualification(id);
    });
  }

  function overrideQualification(id, { priority, reason, displayedQualificationId } = {}, actor, { channel, sessionCheck } = {}) {
    return bus.transaction(() => {
      const session = decisionSession(channel, sessionCheck, "suprascrierea calificării");
      needOrg(id);
      const current = latestQualification(id);
      if (!current) throw new HubError("conflict", "Calculează întâi calificarea");
      const updated = applyOverride(current.result, { priority, reason, actor, at: now() });
      const target = displayedQualificationId || (channel === "test" && config.testMode ? current.id : null);
      if (!target || !/^squ_[A-Za-z0-9_]+$/.test(target)) throw new HubError("validation", "Lipsește calificarea afișată (displayedQualificationId)");
      if (current.id !== target) {
        if (current.override?.basedOn === target && current.override.priority === updated.priority && current.override.reason === updated.override.reason) return { ...current, duplicate: true };
        throw new HubError("conflict", "Calificarea s-a schimbat; revizuiește rezultatul nou", { code: "QUALIFICATION_TARGET_STALE" });
      }
      const basis = db.prepare("SELECT inputs_sha FROM sales_qualifications WHERE id=?").get(target);
      const authority = { basedOn: target, sessionId: session?.id || null, credentialId: session?.credentialId || null, authority: session?.authority || "test", channel };
      updated.override = { ...updated.override, ...authority };
      updated.overrides[updated.overrides.length - 1] = updated.override;
      const qid = newId("squ");
      db.prepare("INSERT INTO sales_qualifications (id, org_id, formula_version, result_json, priority, override_json, inputs_sha, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(qid, id, current.formulaVersion, json(updated), updated.priority ?? null, json(updated.override), basis.inputs_sha, actor, now());
      invalidateBound([id], "calificarea a fost suprascrisă");
      emit("sales.qualification.override", id, { qualificationId: qid, priority, ...authority }, actor);
      return latestQualification(id);
    });
  }

  // ---------- services catalog ----------
  function saveService(input, actor, id = null, { channel, sessionCheck } = {}) {
    const name = clip(input.name, 120);
    if (name.length < 3) throw new HubError("validation", "Numele serviciului are minimum 3 caractere");
    const list = (v, n = 20) => (Array.isArray(v) ? v : String(v || "").split("\n")).map((s) => clip(s, 200)).filter(Boolean).slice(0, n);
    const price = input.price?.status === "CONFIGURED"
      ? (() => { const amount = Number(input.price.amount); if (!(amount > 0)) throw new HubError("validation", "Prețul configurat are nevoie de o sumă pozitivă"); return { status: "CONFIGURED", amount, currency: clip(input.price.currency || "RON", 3).toUpperCase(), unit: clip(input.price.unit || "proiect", 40) }; })()
      : { status: "NOT_CONFIGURED" };
    const leadTime = input.leadTime?.status === "CONFIGURED" && clip(input.leadTime.text, 80) ? { status: "CONFIGURED", text: clip(input.leadTime.text, 80) } : { status: "NOT_CONFIGURED" };
    const row = [name, clip(input.description, 1000), json(list(input.scope)), json(list(input.exclusions)), json(list(input.tags, 10).map((t) => t.toLowerCase())), json(price), json(leadTime), json(list(input.materials)), input.active === false ? 0 : 1];
    return bus.transaction(() => {
      // 2.15.2: the catalog (names, scope, prices and lead times that offers are rendered from) is written only in the owner session,
      // re-read in this transaction, or on the bounded test channel.
      const auth = ownerAuthority(decisionSession(channel, sessionCheck, "o modificare a catalogului de servicii"), channel);
      if (id) {
        const existing = rowToService(db.prepare("SELECT * FROM sales_services WHERE id = ?").get(id));
        if (!existing) throw new HubError("not_found", "Serviciul nu există");
        // 2.15.5 review: a save that changes nothing is no new version (and so invalidates no offer rendered from it).
        const stored = db.prepare("SELECT name, description, scope_json, exclusions_json, tags_json, price_json, lead_time_json, materials_json, active FROM sales_services WHERE id = ?").get(id);
        if (Object.values(stored).every((v, i) => String(v) === String(row[i]))) return { ...existing, unchanged: true };
        db.prepare("UPDATE sales_services SET name = ?, description = ?, scope_json = ?, exclusions_json = ?, tags_json = ?, price_json = ?, lead_time_json = ?, materials_json = ?, active = ?, version = version + 1, updated_at = ? WHERE id = ?")
          .run(...row, now(), id);
      } else {
        id = newId("svc");
        db.prepare("INSERT INTO sales_services (id, name, description, scope_json, exclusions_json, tags_json, price_json, lead_time_json, materials_json, active, synthetic, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .run(id, ...row, input.synthetic ? 1 : 0, now(), now());
      }
      emit("sales.service.saved", id, { name, ...auth }, actor);
      // 2.15.5: the catalog is an input of every preparation-bound offer rendered from it (preparationBasis): the offers whose inputs
      // changed become STALE with their preparations and dossiers (history kept; the owner continues with one card).
      invalidateBound(db.prepare("SELECT DISTINCT org_id FROM sales_opportunities").all().map((r) => r.org_id), `catalogul de servicii s-a schimbat (${clip(name, 80)})`);
      return rowToService(db.prepare("SELECT * FROM sales_services WHERE id = ?").get(id));
    });
  }

  // ---------- opportunities ----------
  function createOpportunity({ orgId, title, need = "", serviceId = null }, actor) {
    const org = needOrg(orgId);
    assertWorkable(org);
    if (org.status === "DO_NOT_CONTACT" || contactSuppression(orgId)) throw new HubError("policy", "Firma e DO_NOT_CONTACT: nu se deschid oportunități");
    if (String(title || "").trim().length < 3) throw new HubError("validation", "Titlul oportunității are minimum 3 caractere");
    if (serviceId && !rowToService(db.prepare("SELECT * FROM sales_services WHERE id = ?").get(serviceId))) throw new HubError("not_found", "Serviciul nu există în catalog");
    return bus.transaction(() => {
      const id = newId("opp");
      db.prepare(`INSERT INTO sales_opportunities (id, org_id, title, need, service_id, status, next_action, synthetic, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'IDENTIFIED', 'Pregătește o propunere', ?, ?, ?, ?)`).run(id, org.id, clip(title, 160), clip(need, 2000), serviceId, org.synthetic ? 1 : 0, actor, now(), now());
      transition("opportunity", id, null, "IDENTIFIED", actor, "Oportunitate creată");
      if (["NEW", "NEEDS_RESEARCH", "QUALIFIED", "AUDITED"].includes(org.status)) {
        db.prepare("UPDATE sales_orgs SET status = 'OPPORTUNITY', version = version + 1, updated_at = ? WHERE id = ?").run(now(), org.id);
        transition("org", org.id, org.status, "OPPORTUNITY", actor, `Oportunitate: ${clip(title, 80)}`);
      }
      emit("sales.opportunity.created", id, { orgId: org.id }, actor);
      return getOpportunity(id);
    });
  }

  function setOppStatus(opp, to, actor, reason) {
    db.prepare("UPDATE sales_opportunities SET status = ?, version = version + 1, updated_at = ? WHERE id = ?").run(to, now(), opp.id);
    transition("opportunity", opp.id, opp.status, to, actor, reason);
    if (["WON", "LOST", "ON_HOLD", "IN_DISCUSSION"].includes(to)) {
      db.prepare("UPDATE sales_followups SET status = 'SUSPENDED', reason = ?, updated_at = ? WHERE opportunity_id = ? AND status IN ('SCHEDULED','DUE')").run(`oportunitate ${to}`, now(), opp.id);
    }
    emit("sales.opportunity.transition", opp.id, { from: opp.status, to }, actor);
  }

  function transitionOpportunity(id, { to, reason = "" }, actor) {
    const opp = needOpp(id);
    if (EVENT_ONLY[to]) throw new HubError("conflict", `${to} se atinge doar prin ${EVENT_ONLY[to]}`);
    if (!(OPPORTUNITY_TRANSITIONS[opp.status] || []).includes(to)) throw new HubError("conflict", `Tranziție nepermisă: ${opp.status} → ${to}`);
    if (String(reason || "").trim().length < 3) throw new HubError("validation", "Spune pe scurt motivul (minimum 3 caractere)");
    if (to === "READY_FOR_OWNER_REVIEW" && !latestProposal(id)) throw new HubError("conflict", "Nu există o propunere de revizuit");
    // M12 review C5: an offer prepared by a plan whose inputs changed (STALE) can never be approved: the opportunity is not „ready for review”.
    if (to === "READY_FOR_OWNER_REVIEW" && latestProposal(id).status === "STALE") {
      throw new HubError("conflict", "Oferta pregătită nu mai corespunde datelor din care a fost făcută (STALE): nu poate fi revizuită; continuă pregătirea sau fă o versiune nouă", { code: "SALES_PROPOSAL_STALE" });
    }
    if (to === "IN_DISCUSSION" && !realContact(id)) throw new HubError("conflict", "IN_DISCUSSION cere un contact real înregistrat (trimis sau înregistrat manual)");
    return bus.transaction(() => { setOppStatus(opp, to, actor, reason); return getOpportunity(id); });
  }

  const realContact = (oppId) => db.prepare("SELECT 1 FROM sales_contact_events WHERE opportunity_id = ? AND kind IN ('SENT_VIA_HUB','MANUAL_RECORDED') LIMIT 1").get(oppId);
  const latestProposal = (oppId) => rowToProposal(db.prepare("SELECT * FROM sales_proposals WHERE opportunity_id = ? ORDER BY version DESC LIMIT 1").get(oppId));
  const latestDraft = (oppId) => rowToDraft(db.prepare("SELECT * FROM sales_drafts WHERE opportunity_id = ? ORDER BY version DESC LIMIT 1").get(oppId));

  function getOpportunity(id) {
    const opp = needOpp(id);
    const org = getOrgRow(opp.orgId);
    const proposals = db.prepare("SELECT * FROM sales_proposals WHERE opportunity_id = ? ORDER BY version DESC").all(id).map(rowToProposal);
    const handoffs = db.prepare("SELECT * FROM sales_handoffs WHERE opportunity_id = ? ORDER BY created_at DESC").all(id).map((r) => ({ id: r.id, proposalId: r.proposal_id, proposalSha: r.proposal_sha,
      acceptanceId: r.acceptance_id, missionId: r.mission_id, status: r.status, packageSha: r.package_sha, package: parse(r.package_json, {}), createdAt: r.created_at }));
    const latest = proposals[0] || null;
    return {
      opportunity: opp, org, service: opp.serviceId ? rowToService(db.prepare("SELECT * FROM sales_services WHERE id = ?").get(opp.serviceId)) : null,
      proposals, drafts: db.prepare("SELECT * FROM sales_drafts WHERE opportunity_id = ? ORDER BY version DESC").all(id).map(rowToDraft),
      acceptances: db.prepare("SELECT * FROM sales_client_acceptances WHERE opportunity_id = ? ORDER BY created_at DESC").all(id).map((r) => ({ id: r.id, proposalId: r.proposal_id, proposalSha: r.proposal_sha, acceptedAt: r.accepted_at, note: r.note, recordedBy: r.recorded_by })),
      contactEvents: db.prepare("SELECT * FROM sales_contact_events WHERE opportunity_id = ? ORDER BY occurred_at DESC").all(id).map((r) => ({ id: r.id, kind: r.kind, occurredAt: r.occurred_at, channel: r.channel, note: r.note, actor: r.actor, sendId: r.send_id })),
      followups: db.prepare("SELECT * FROM sales_followups WHERE opportunity_id = ? ORDER BY due_at").all(id).map(rowToFollowup),
      handoffs: handoffs.map((h) => ({ ...h, outdated: Boolean(latest && h.proposalSha !== latest.contentSha), note: latest && h.proposalSha !== latest.contentSha ? "Propunerea s-a schimbat după predare: e nevoie de o decizie nouă de scope" : "" })),
      transitions: db.prepare("SELECT * FROM sales_transitions WHERE subject_type = 'opportunity' AND subject_id = ? ORDER BY created_at DESC, rowid DESC").all(id).map((r) => ({ from: r.from_status, to: r.to_status, actor: r.actor, reason: r.reason, at: r.created_at })),
      suppression: contactSuppression(opp.orgId, contactsOf(opp.orgId).filter((c) => c.kind === "email" && c.status === "ACTIVE").map((c) => c.value)),
      contacts: contactsOf(opp.orgId).filter((c) => c.status === "ACTIVE"),
      outreach: transport ? "TEST_TRANSPORT" : "DISABLED",
    };
  }

  function listOpportunities({ status = "", offset = 0, limit = 100 } = {}) {
    const where = status ? "WHERE p.status = ?" : "";
    const args = status ? [status] : [];
    const total = db.prepare(`SELECT COUNT(*) AS n FROM sales_opportunities p ${where}`).get(...args).n;
    const items = db.prepare(`SELECT p.*, o.display_name AS org_name, o.synthetic AS org_synthetic FROM sales_opportunities p JOIN sales_orgs o ON o.id = p.org_id ${where} ORDER BY p.updated_at DESC LIMIT ? OFFSET ?`)
      .all(...args, clampLimit(limit), Math.max(0, Number(offset) || 0)).map((r) => ({ ...rowToOpp(r), orgName: r.org_name }));
    const byStatus = Object.fromEntries(db.prepare("SELECT status, COUNT(*) AS n FROM sales_opportunities GROUP BY status").all().map((r) => [r.status, r.n]));
    return { items, total, byStatus };
  }

  // ---------- proposals ----------
  function ownerProfile() {
    const s = settings.get("salesOwner") || {};
    return { companyName: s.companyName || "Ifrim Digital", signatureName: s.signatureName || "", materials: Array.isArray(s.materials) ? s.materials : [] };
  }
  /**
   * The owner's proposal profile (name, signature, confirmed materials): rendered into every offer, so — M12 review R7 — saving it is an
   * input change for the offers prepared by a plan (STALE hook, in the same transaction). M04 offers (no basis) are untouched.
   */
  function saveOwnerProfile({ companyName, signatureName = "", materials = [] }, actor) {
    return bus.transaction(() => {
      settings.set("salesOwner", { companyName, signatureName, materials }, actor, "Profil Sales actualizat");
      const orgs = db.prepare(`SELECT DISTINCT o.org_id AS id FROM sales_opportunities o JOIN sales_proposals p ON p.opportunity_id = o.id
        WHERE p.status IN ('DRAFT','APPROVED_INTERNAL') AND json_extract(p.content_json, '$.basis') IS NOT NULL`).all().map((r) => r.id);
      invalidateBound(orgs, "profilul tău Sales (numele firmei, semnătura sau materialele) s-a schimbat");
      return settings.get("salesOwner");
    });
  }

  /**
   * `brief` and `basis` are the M12 preparation path only (the confirmed plan's step; never a command): the brief's stated need becomes
   * the „Ce s-a cerut” section and `basis` (the input shas, preparationBasis) binds the offer to its preparation. Without them the
   * offer is exactly the M04 offer.
   */
  function createProposal(oppId, { edits = null, brief = null, basis = null } = {}, actor) {
    const view = getOpportunity(oppId);
    const opp = view.opportunity;
    // LOST is closed. WON stays WON: a new version after the acceptance is a scope change that makes the hand-off outdated.
    if (opp.status === "LOST") throw new HubError("conflict", "Oportunitatea e LOST");
    assertWorkable(view.org);
    if (view.suppression) throw new HubError("policy", "Firma e DO_NOT_CONTACT");
    if (basis !== null && (!basis || typeof basis !== "object" || Array.isArray(basis) || edits)) throw new HubError("validation", "Oferta unei pregătiri are baza ei și nu se editează de mână");
    const sheet = getOrg(opp.orgId);
    const one = offerService(opp, { bound: basis !== null });
    const svc = one ? [one] : [];
    const rendered = renderProposal({ org: { ...view.org, contacts: sheet.contacts.filter((c) => c.status === "ACTIVE") }, opportunity: opp, services: svc, evidence: evidenceForTexts(sheet),
      audit: sheet.audits[0]?.result || null, owner: ownerProfile(), ...(brief ? { brief } : {}) });
    let content = { ...rendered, serviceIds: svc.map((s) => `${s.id}@${s.version}`), ...(basis ? { basis } : {}) };
    if (edits && Array.isArray(edits.sections)) {
      if (edits.sections.some((sec) => sec?.id && !String(sec.text ?? "").trim())) throw new HubError("validation", "O secțiune editată nu poate fi goală");
      // Owner edits replace section texts by id; a placeholder or an empty text is refused.
      const byId = new Map(edits.sections.filter((s) => s && s.id).map((s) => [s.id, clip(s.text, 4000)]));
      const leftovers = findUnresolvedPlaceholders([...byId.values()].join(" "));
      if (leftovers.length) throw new HubError("validation", `Textul editat are câmpuri necompletate: ${leftovers.slice(0, 5).join(", ")}`);
      content = { ...content, sections: content.sections.map((s) => (byId.has(s.id) ? { ...s, text: byId.get(s.id), editedBy: actor } : s)) };
      content.text = content.sections.map((s) => `${s.heading}\n${s.text}`).join("\n\n");
    }
    const sha = hashCanonical(content);
    return bus.transaction(() => {
      const prev = latestProposal(oppId);
      const version = (prev?.version || 0) + 1;
      if (prev) db.prepare("UPDATE sales_proposals SET status = 'SUPERSEDED' WHERE opportunity_id = ? AND status <> 'SUPERSEDED'").run(oppId);
      const id = newId("spr");
      db.prepare("INSERT INTO sales_proposals (id, opportunity_id, version, content_json, content_sha, status, created_by, created_at) VALUES (?, ?, ?, ?, ?, 'DRAFT', ?, ?)")
        .run(id, oppId, version, json(content), sha, actor, now());
      // A new version invalidates the internal approval of the previous one (and of drafts built on it).
      if (["IDENTIFIED", "READY_FOR_OWNER_REVIEW", "APPROVED_INTERNAL"].includes(opp.status)) setOppStatus(opp, "PROPOSAL_DRAFT", actor, prev ? `Propunerea v${version} înlocuiește v${prev.version}` : "Prima propunere");
      db.prepare("UPDATE sales_drafts SET status = 'SUPERSEDED', updated_at = ? WHERE opportunity_id = ? AND status IN ('DRAFT','CONTENT_APPROVED','SEND_AUTHORIZED')").run(now(), oppId);
      db.prepare("UPDATE sales_handoffs SET status = 'SUPERSEDED' WHERE opportunity_id = ? AND status = 'DRAFT_CREATED' AND proposal_sha <> ?").run(oppId, sha);
      emit("sales.proposal.created", oppId, { proposalId: id, version }, actor);
      // M12: a preparation waiting for the previous version (or a dossier written from it) no longer matches the offer.
      notifyInvalidated(opp.orgId, oppId, `o versiune nouă a ofertei (v${version})`);
      return rowToProposal(db.prepare("SELECT * FROM sales_proposals WHERE id = ?").get(id));
    });
  }

  /** M12 (D7): a proposal written by a preparation records the shas of its inputs in `content.basis`; M04 proposals have none. */
  const isPreparationBound = (content) => Boolean(content?.basis && typeof content.basis === "object" && !Array.isArray(content.basis));
  /** The catalog entries a proposal was rendered from (`id@version`), only while that exact version is still the catalog's. */
  const catalogOf = (serviceIds) => (Array.isArray(serviceIds) ? serviceIds : []).map((ref) => {
    const [id, version] = String(ref).split("@");
    const s = rowToService(db.prepare("SELECT * FROM sales_services WHERE id = ?").get(id));
    return s && String(s.version) === version ? s : null;
  }).filter(Boolean);

  function decisionSession(channel, sessionCheck, what) {
    const testing = channel === "test" && config.testMode;
    if ((!testing && channel !== "owner") || typeof sessionCheck !== "function") throw new HubError("authentication", `Pentru ${what} deschide sesiunea proprietarului`, { data: { needSession: true } });
    const session = sessionCheck();
    if (!testing && (!session?.id || !session.credentialId || !["webauthn", "local_dev_profile"].includes(session.authority))) throw new HubError("authentication", "Sesiune de proprietar invalidă");
    return session;
  }
  /** What a Sales owner decision's event records about who decided (2.15.2): the authority, the session and authenticator, the channel. */
  const ownerAuthority = (session, channel, extra = {}) => ({ ...extra, authority: session?.authority || "test", sessionId: session?.id || null, credentialId: session?.credentialId || null, channel });
  /**
   * 2.15.2: the authority of a Sales owner decision taken through a reserved approval (a draft's text, lifting DO_NOT_CONTACT, an import
   * rollback), re-read inside the decision's own transaction: the owner session (or the bounded test channel) and the consumed approval
   * of exactly this action, decided in the owner session. Any other caller is refused before anything is written.
   */
  function approvedDecision({ channel, sessionCheck, approvalId } = {}, kind, what, matches) {
    const session = decisionSession(channel, sessionCheck, what);
    const row = approvalId ? db.prepare("SELECT * FROM approvals WHERE id=?").get(approvalId) : null;
    if (!row || row.action_kind !== kind || row.status !== "consumed" || !matches(parse(row.payload_json, {}))
      || (channel === "owner" ? row.decided_via !== "owner_session" : row.decided_via !== "test")) throw new HubError("policy", `Lipsește aprobarea ta legată de ${what}`);
    return ownerAuthority(session, channel, { approvalId, decidedVia: row.decided_via });
  }

  function approveProposal(proposalId, { displayedSha } = {}, actor, { channel, sessionCheck, approvalId } = {}) {
    if (!/^spr_[A-Za-z0-9_]+$/.test(proposalId || "") || typeof displayedSha !== "string" || !/^[0-9a-f]{64}$/.test(displayedSha)) throw new HubError("validation", "Aprobarea cere ID-ul și SHA-ul complet al versiunii afișate");
    return bus.transaction(() => {
      const p = rowToProposal(db.prepare("SELECT * FROM sales_proposals WHERE id=?").get(proposalId));
      if (!p) throw new HubError("not_found", "Propunerea nu există");
      // Keep the historical superseded-version refusal, including direct callers (M04).
      if (latestProposal(p.opportunityId)?.id !== p.id || p.status === "SUPERSEDED") throw new HubError("conflict", "Există o versiune mai nouă a propunerii: aprobarea nu se aplică");
      const session = decisionSession(channel, sessionCheck, "aprobarea internă a ofertei");
      if (displayedSha !== p.contentSha || hashCanonical(p.content) !== p.contentSha) throw new HubError("conflict", "Conținutul s-a schimbat față de ce ai văzut");
      // The result states what is true now: a repeat returns the original decision (approval id, time) with the CURRENT states
      // of the proposal and the opportunity (which may have moved on since, e.g. ON_HOLD and back to review), never a claimed one.
      const result = (duplicate, at, aid, proposalStatus, oppStatus) => ({ duplicate, approved: true, proposalId, version: p.version, contentSha: p.contentSha,
        status: proposalStatus, approvedAt: at, approvalId: aid, opportunity: { id: p.opportunityId, status: oppStatus } });
      if (p.status === "APPROVED_INTERNAL" && p.approvedSha === displayedSha) return result(true, p.approvedAt, p.approvalId, p.status, needOpp(p.opportunityId).status);
      // M12 (D7): a preparation-bound offer whose inputs changed is STALE (set by the invalidating writes) and is never approved; the
      // preparation's activation and its dossier re-check the inputs by sha before anything continues. Review R7: the input shas are
      // recomputed here too, in this final transaction (a write with no hook can never get a stale offer approved).
      if (p.status === "STALE" || (isPreparationBound(p.content) && boundStale(p))) {
        throw new HubError("conflict", "Oferta nu mai corespunde datelor din care a fost pregătită (STALE); cere o versiune nouă", { code: "SALES_PROPOSAL_STALE" });
      }
      const opp = needOpp(p.opportunityId);
      if (p.status !== "DRAFT" || opp.status !== "READY_FOR_OWNER_REVIEW") throw new HubError("conflict", "Marchează întâi propunerea „gata de revizuire”");
      // C-02 on the M12 path: an offer bound to a preparation is approved only without invented figures (amounts, terms, ROI,
      // discounts, approximations); the CONFIGURED catalog texts it was rendered from are the only figures allowed. M04 offers
      // (no `basis`) are not gated here.
      if (isPreparationBound(p.content)) {
        const figures = proposalFigures(p.content, { allow: allowedCatalogTexts(catalogOf(p.content.serviceIds)) });
        if (figures.length) {
          throw new HubError("policy", `Oferta conține cifre comerciale care nu vin din catalogul configurat (${figures.slice(0, 3).map((f) => `„${f.text}”`).join(", ")}): nu se aprobă`,
            { code: "COMMERCIAL_FIGURES", data: { figures: figures.slice(0, 20) } });
        }
      }
      const approval = approvalId && db.prepare("SELECT * FROM approvals WHERE id=?").get(approvalId);
      if (!approval || approval.action_kind !== "sales.proposal_approve" || approval.status !== "consumed"
        || parse(approval.payload_json, {}).proposalId !== proposalId || parse(approval.payload_json, {}).displayedSha !== displayedSha
        || (channel === "owner" ? approval.decided_via !== "owner_session" : approval.decided_via !== "test")) throw new HubError("policy", "Lipsește aprobarea legată de această ofertă");
      const at = now();
      if (db.prepare("UPDATE sales_proposals SET status='APPROVED_INTERNAL', approved_sha=?, approved_at=?, approval_id=? WHERE id=? AND status='DRAFT' AND content_sha=? AND approved_at IS NULL AND version=(SELECT MAX(version) FROM sales_proposals WHERE opportunity_id=?)")
        .run(displayedSha, at, approvalId, p.id, displayedSha, p.opportunityId).changes !== 1) throw new HubError("conflict", "Propunerea s-a schimbat");
      if (db.prepare("UPDATE sales_opportunities SET status='APPROVED_INTERNAL', version=version+1, updated_at=? WHERE id=? AND status='READY_FOR_OWNER_REVIEW' AND version=?")
        .run(at, opp.id, opp.version).changes !== 1) throw new HubError("conflict", "Oportunitatea s-a schimbat");
      transition("opportunity", opp.id, opp.status, "APPROVED_INTERNAL", actor, `Propunerea v${p.version} aprobată intern (nu e acceptarea clientului)`);
      emit("sales.opportunity.transition", opp.id, { from: opp.status, to: "APPROVED_INTERNAL" }, actor);
      emit("sales.proposal.approved", opp.id, { proposalId, version: p.version, contentSha: displayedSha, opportunityId: opp.id, approvalId,
        decidedVia: approval.decided_via, authority: session?.authority || "test", sessionId: session?.id || null, credentialId: session?.credentialId || null, channel }, actor);
      return result(false, at, approvalId, "APPROVED_INTERNAL", "APPROVED_INTERNAL");
    });
  }

  // ---------- drafts & contact ----------
  const draftSha = (d) => hashCanonical({ channel: d.channel, subject: d.subject, body: d.body, recipients: d.recipients, proposalId: d.proposalId || null, proposalSha: d.proposalSha || null });

  function createDraft(oppId, { contactId = null, proposalId = null, subject = null, body = null, followupId = null } = {}, actor) {
    const view = getOpportunity(oppId);
    assertWorkable(view.org);
    if (["WON", "LOST"].includes(view.opportunity.status)) throw new HubError("conflict", `Oportunitatea e ${view.opportunity.status}: nu se mai pregătesc mesaje`);
    if (view.suppression || view.org.status === "DO_NOT_CONTACT") throw new HubError("policy", "Firma e DO_NOT_CONTACT: nu se pregătesc mesaje");
    const contacts = contactsOf(view.org.id).filter((c) => c.status === "ACTIVE");
    const contact = contactId ? contacts.find((c) => c.id === contactId) : contacts.find((c) => c.kind === "email");
    if (!contact) throw new HubError("validation", "Alege un contact activ al firmei (e-mail)");
    if (contact.kind !== "email") throw new HubError("validation", "Ciornele de contact sunt pe e-mail în M04");
    if (contactSuppression(view.org.id, [contact.value])) throw new HubError("policy", "Adresa, domeniul sau firma e pe lista DO_NOT_CONTACT");
    // A message is built only from the latest proposal, and only once you approved it internally.
    const proposal = view.proposals[0] || null;
    if (proposalId && proposalId !== proposal?.id) throw new HubError("conflict", "Ciorna se face doar din ultima versiune a propunerii");
    if (!proposal || proposal.status !== "APPROVED_INTERNAL" || proposal.approvedSha !== proposal.contentSha) {
      throw new HubError("conflict", "Ciorna se generează din ultima propunere aprobată intern: aprob-o întâi");
    }
    const sheet = getOrg(view.org.id);
    const rendered = renderContactDraft({ org: { ...view.org, contacts: sheet.contacts.filter((c) => c.status === "ACTIVE") }, contact, proposal: proposal ? proposal.content : null, audit: sheet.audits[0]?.result || null, owner: ownerProfile() });
    const d = { channel: "email", subject: clip(subject ?? rendered.subject, 200), body: clip(body ?? rendered.body, 8000), recipients: [contact.value], proposalId: proposal?.id || null, proposalSha: proposal?.contentSha || null };
    const sha = draftSha(d);
    return bus.transaction(() => {
      const prev = latestDraft(oppId);
      const version = (prev?.version || 0) + 1;
      db.prepare("UPDATE sales_drafts SET status = 'SUPERSEDED', updated_at = ? WHERE opportunity_id = ? AND status IN ('DRAFT','CONTENT_APPROVED','SEND_AUTHORIZED')").run(now(), oppId);
      const id = newId("sdr");
      db.prepare(`INSERT INTO sales_drafts (id, opportunity_id, org_id, contact_id, proposal_id, version, channel, subject, body, recipients_json, meta_json, content_sha, status, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'email', ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?)`).run(id, oppId, view.org.id, contact.id, d.proposalId, version, d.subject, d.body, json(d.recipients),
        json({ claimsToVerify: rendered.claimsToVerify || [], personalizationBasis: rendered.personalizationBasis || [], proposalSha: d.proposalSha, followupId, edited: subject !== null || body !== null }),
        sha, actor, now(), now());
      if (followupId) db.prepare("UPDATE sales_followups SET draft_id = ?, updated_at = ? WHERE id = ?").run(id, now(), followupId);
      // M12: a dossier written from the previous draft no longer matches it.
      notifyInvalidated(view.org.id, oppId, `o ciornă nouă (v${version})`);
      emit("sales.draft.created", oppId, { draftId: id, version }, actor);
      return rowToDraft(db.prepare("SELECT * FROM sales_drafts WHERE id = ?").get(id));
    });
  }

  function reviseDraft(draftId, { subject, body }, actor) {
    const d = rowToDraft(db.prepare("SELECT * FROM sales_drafts WHERE id = ?").get(draftId));
    if (!d) throw new HubError("not_found", "Ciorna nu există");
    if (!["DRAFT", "CONTENT_APPROVED"].includes(d.status)) throw new HubError("conflict", `Ciorna e ${d.status}`);
    return createDraft(d.opportunityId, { contactId: d.contactId, proposalId: d.proposalId, subject: subject ?? d.subject, body: body ?? d.body, followupId: d.meta.followupId || null }, actor);
  }

  /** The draft still stands on the latest, internally approved proposal of a workable, open opportunity. */
  function assertDraftBasis(d) {
    const opp = needOpp(d.opportunityId);
    if (["WON", "LOST"].includes(opp.status)) throw new HubError("conflict", `Oportunitatea e ${opp.status}`);
    assertWorkable(needOrg(d.orgId));
    const latest = latestProposal(d.opportunityId);
    if (!latest || latest.id !== d.proposalId || latest.status !== "APPROVED_INTERNAL" || latest.approvedSha !== latest.contentSha || d.meta?.proposalSha !== latest.contentSha) {
      throw new HubError("conflict", "Propunerea s-a schimbat după ciornă: ciorna nu mai e valabilă");
    }
  }

  function approveDraftContent(draftId, { displayedSha }, actor, decision = {}) {
    const d = rowToDraft(db.prepare("SELECT * FROM sales_drafts WHERE id = ?").get(draftId));
    if (!d) throw new HubError("not_found", "Ciorna nu există");
    if (d.status !== "DRAFT") throw new HubError("conflict", `Ciorna e ${d.status}: doar o ciornă curentă se aprobă`);
    // 2.15.2: the exact text shown, by its full SHA (an empty or whitespace-only SHA no longer approves whatever the draft holds).
    if (typeof displayedSha !== "string" || !/^[0-9a-f]{64}$/.test(displayedSha)) throw new HubError("validation", "Aprobarea cere SHA-ul complet al textului afișat");
    if (displayedSha !== d.contentSha) throw new HubError("conflict", "Textul s-a schimbat față de ce ai văzut");
    if (contactSuppression(d.orgId, d.recipients)) throw new HubError("policy", "Firma, domeniul sau adresa e DO_NOT_CONTACT");
    assertDraftBasis(d);
    return bus.transaction(() => {
      // Only the owner's decision approves the text (the owner session re-read here, the approval of this draft and SHA consumed).
      const auth = approvedDecision(decision, "sales.draft_content", "aprobarea textului ciornei", (p) => p.draftId === draftId && p.displayedSha === displayedSha);
      if (db.prepare("UPDATE sales_drafts SET status = 'CONTENT_APPROVED', approved_sha = ?, approved_at = ?, updated_at = ? WHERE id = ? AND status = 'DRAFT'").run(d.contentSha, now(), now(), d.id).changes !== 1) {
        throw new HubError("conflict", "Ciorna s-a schimbat între timp");
      }
      emit("sales.draft.content_approved", d.opportunityId, { draftId: d.id, contentSha: d.contentSha, ...auth }, actor);
      // M12 review C3: a dossier states its draft's status; a READY dossier written from this draft is re-checked (STALE).
      notifyInvalidated(d.orgId, d.opportunityId, "statusul ciornei s-a schimbat (conținut aprobat)");
      return rowToDraft(db.prepare("SELECT * FROM sales_drafts WHERE id = ?").get(d.id));
    });
  }

  /**
   * Sending: in M04 the real transport is disabled (OUTREACH_DISABLED). A test hub may inject a fake transport; then a
   * send needs an approved, unchanged draft, no suppression, and an idempotency key (a double click never sends twice).
   * SENT is set only from the transport's DELIVERED result.
   */
  async function sendDraft(draftId, { idempotencyKey }, actor) {
    if (!transport) throw new HubError("policy", OUTREACH_DISABLED);
    const d = rowToDraft(db.prepare("SELECT * FROM sales_drafts WHERE id = ?").get(draftId));
    if (!d) throw new HubError("not_found", "Ciorna nu există");
    const key = String(idempotencyKey || "").slice(0, 120);
    if (!key) throw new HubError("validation", "Trimiterea cere o cheie de idempotență");
    const prior = db.prepare("SELECT * FROM sales_sends WHERE idempotency_key = ?").get(key);
    if (prior) {
      if (prior.draft_id !== d.id) throw new HubError("conflict", "Cheia de idempotență aparține altei ciorne");
      return { sendId: prior.id, status: prior.status, duplicate: true };
    }
    if (d.status !== "CONTENT_APPROVED" || d.approvedSha !== d.contentSha) throw new HubError("conflict", "Doar o ciornă cu conținutul aprobat (și neschimbat) se poate trimite");
    // Another click (other tab, other key) already started or delivered this draft: never a second message.
    // An ATTEMPTED left by a crash also blocks: whether it left is unknown, so it is not retried blindly.
    const open = db.prepare("SELECT status FROM sales_sends WHERE draft_id = ? AND status IN ('ATTEMPTED','DELIVERED') LIMIT 1").get(d.id);
    if (open) throw new HubError("conflict", `Ciorna are deja o trimitere ${open.status}`);
    if (contactSuppression(d.orgId, d.recipients)) {
      throw new HubError("policy", "DO_NOT_CONTACT: trimiterea e blocată");
    }
    assertDraftBasis(d);
    const contact = d.contactId ? rowToContact(db.prepare("SELECT * FROM sales_contacts WHERE id = ?").get(d.contactId)) : null;
    if (!contact || contact.status !== "ACTIVE") throw new HubError("conflict", "Contactul ciornei nu mai e activ (corectat sau anulat la un rollback)");
    const sendId = newId("ssd");
    bus.transaction(() => db.prepare("INSERT INTO sales_sends (id, draft_id, idempotency_key, transport, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'ATTEMPTED', ?, ?)").run(sendId, d.id, key, transport.id || "test", now(), now()));
    let result;
    try { result = await transport.send({ to: d.recipients, subject: d.subject, body: d.body, idempotencyKey: key }); }
    catch (error) { result = { status: "FAILED", error: String(error.message).slice(0, 300) }; }
    return bus.transaction(() => {
      db.prepare("UPDATE sales_sends SET status = ?, detail_json = ?, updated_at = ? WHERE id = ?").run(result.status === "DELIVERED" ? "DELIVERED" : "FAILED", json(result), now(), sendId);
      if (result.status === "DELIVERED") {
        db.prepare("UPDATE sales_drafts SET status = 'SENT', updated_at = ? WHERE id = ?").run(now(), d.id);
        db.prepare("INSERT INTO sales_contact_events (id, org_id, opportunity_id, kind, occurred_at, channel, note, send_id, actor, created_at) VALUES (?, ?, ?, 'SENT_VIA_HUB', ?, 'email', ?, ?, ?, ?)")
          .run(newId("sce"), d.orgId, d.opportunityId, result.deliveredAt || now(), `transport ${transport.id || "test"}`, sendId, actor, now());
        const opp = needOpp(d.opportunityId);
        if (opp.status === "APPROVED_INTERNAL") setOppStatus(opp, "CONTACTED", actor, "Mesaj livrat (eveniment de transport)");
      }
      emit("sales.draft.send", d.opportunityId, { draftId: d.id, sendId, status: result.status }, actor);
      return { sendId, status: result.status === "DELIVERED" ? "DELIVERED" : "FAILED" };
    });
  }

  function recordContactEvent(oppId, { kind, occurredAt, channel = "", note = "", confirmText = "" }, actor) {
    const opp = needOpp(oppId);
    const org = needOrg(opp.orgId);
    if (!["MANUAL_RECORDED", "REPLY_RECORDED", "OPT_OUT"].includes(kind)) throw new HubError("validation", "Tip: MANUAL_RECORDED | REPLY_RECORDED | OPT_OUT");
    const at = new Date(occurredAt || now());
    if (Number.isNaN(at.getTime()) || at > new Date(clock().getTime() + 60000)) throw new HubError("validation", "Data contactului e invalidă sau în viitor");
    if (kind === "MANUAL_RECORDED") {
      if (confirmText !== MANUAL_CONTACT_TEXT) throw new HubError("validation", `Scrie exact: „${MANUAL_CONTACT_TEXT}”`);
      assertWorkable(org);
      if (org.status === "DO_NOT_CONTACT" || contactSuppression(org.id)) throw new HubError("policy", "Firma e DO_NOT_CONTACT: nu se înregistrează un contact nou");
    }
    return bus.transaction(() => {
      db.prepare("INSERT INTO sales_contact_events (id, org_id, opportunity_id, kind, occurred_at, channel, note, actor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(newId("sce"), org.id, opp.id, kind, at.toISOString(), clip(channel, 40), clip(note, 1000), actor, now());
      if (kind === "MANUAL_RECORDED" && ["APPROVED_INTERNAL", "READY_FOR_OWNER_REVIEW", "PROPOSAL_DRAFT", "IDENTIFIED"].includes(opp.status)) setOppStatus(opp, "CONTACTED", actor, "Contact înregistrat manual de proprietar");
      if (kind === "REPLY_RECORDED" && ["CONTACTED"].includes(opp.status)) setOppStatus(opp, "IN_DISCUSSION", actor, "Răspuns înregistrat");
      if (kind === "REPLY_RECORDED") db.prepare("UPDATE sales_followups SET status = 'SUSPENDED', reason = 'răspuns primit', updated_at = ? WHERE opportunity_id = ? AND status IN ('SCHEDULED','DUE')").run(now(), opp.id);
      if (kind === "OPT_OUT") suppress(org.id, { reason: `Opoziție la contact${note ? `: ${note}` : ""}`, source: "opt-out" }, actor);
      emit("sales.contact_event", opp.id, { kind }, actor);
      return getOpportunity(opp.id);
    });
  }

  function recordClientAcceptance(oppId, { proposalId, acceptedAt, note = "", confirmText = "" }, actor) {
    const view = getOpportunity(oppId);
    const opp = view.opportunity;
    if (confirmText !== CLIENT_ACCEPTANCE_TEXT) throw new HubError("validation", `Scrie exact: „${CLIENT_ACCEPTANCE_TEXT}”`);
    const latest = view.proposals[0];
    if (!latest || latest.id !== proposalId) throw new HubError("conflict", "Acceptarea se înregistrează doar pentru ultima versiune a propunerii");
    if (latest.status !== "APPROVED_INTERNAL" || latest.approvedSha !== latest.contentSha) throw new HubError("conflict", "Propunerea trebuie să fie aprobată intern, în forma acceptată de client");
    if (!["CONTACTED", "IN_DISCUSSION"].includes(opp.status) || !realContact(opp.id)) throw new HubError("conflict", "Clientul nu a fost contactat: acceptarea vine după un contact real");
    const at = new Date(acceptedAt || now());
    if (Number.isNaN(at.getTime()) || at > new Date(clock().getTime() + 60000)) throw new HubError("validation", "Data acceptării e invalidă sau în viitor");
    return bus.transaction(() => {
      const id = newId("sca");
      db.prepare("INSERT INTO sales_client_acceptances (id, opportunity_id, proposal_id, proposal_sha, accepted_at, note, recorded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run(id, opp.id, latest.id, latest.contentSha, at.toISOString(), clip(note, 1000), actor, now());
      setOppStatus(opp, "WON", actor, `Acceptarea clientului înregistrată (propunerea v${latest.version})`);
      return getOpportunity(opp.id);
    });
  }

  /** The Engineering hand-off package (no grant, no run): from the accepted proposal version only. */
  /**
   * What a client-facing text may state as observed: the ISSUE checks of the latest audit, in plain words, with their source.
   * Internal provenance (import rows), PASS checks and financial figures stay in the company sheet.
   */
  function evidenceForTexts(sheet) {
    const latest = sheet.audits[0];
    if (!latest) return [];
    return sheet.evidence.filter(usable).filter((e) => e.claim.startsWith("audit:") && e.value?.status === "ISSUE" && e.value?.auditId === latest.id)
      .map((e) => ({ id: e.id, label: e.label, claim: clip(e.value.observation || e.claim, 300), value: null, sourceKind: e.sourceKind,
        sourceRef: `verificarea statică a paginii ${latest.url}${latest.synthetic ? " (fixture sintetic)" : ""}`, verifiedAt: String(e.verifiedAt || e.retrievedAt || "").slice(0, 10) }));
  }

  function buildHandoffPackage(oppId) {
    const view = getOpportunity(oppId);
    const latest = view.proposals[0];
    const acceptance = view.acceptances.find((a) => a.proposalId === latest?.id && a.proposalSha === latest?.contentSha);
    if (!latest || !acceptance) throw new HubError("conflict", "Handoff-ul cere acceptarea clientului pentru ultima versiune a propunerii");
    const sections = Object.fromEntries((latest.content.sections || []).map((s) => [s.id, s.text]));
    const sheet = getOrg(view.org.id);
    const pkg = {
      schema: 1,
      client: { orgId: view.org.id, name: view.org.displayName, fiscalCode: view.org.fiscalCode, fiscalCodeValid: view.org.fiscalCodeValid, website: view.org.website, synthetic: view.org.synthetic },
      sources: sheet.evidence.filter(usable).slice(0, 30).map((e) => ({ id: e.id, label: e.label, claim: e.claim, sourceRef: e.sourceRef })),
      proposal: { id: latest.id, version: latest.version, sha: latest.contentSha, title: latest.content.title },
      acceptance: { id: acceptance.id, acceptedAt: acceptance.acceptedAt },
      objectives: [view.opportunity.need || view.opportunity.title].filter(Boolean),
      deliverables: view.service?.scope || [],
      exclusions: view.service?.exclusions || [],
      acceptanceCriteria: (sections.scope ? [sections.scope] : []).concat(view.service?.scope || []).slice(0, 10),
      constraints: ["Fără date reale ale clientului în mediile de test", "Lucru doar după aprobarea scope-ului în Software Factory"],
      materials: view.service?.materials || [],
      openQuestions: latest.content.claimsToVerify || [],
    };
    return { view, latest, acceptance, pkg, sha: hashCanonical(pkg) };
  }

  const currentHandoff = (oppId, proposalSha) => {
    const r = db.prepare("SELECT * FROM sales_handoffs WHERE opportunity_id = ? AND proposal_sha = ? AND status = 'DRAFT_CREATED' ORDER BY created_at DESC, rowid DESC LIMIT 1").get(oppId, proposalSha);
    return r && { id: r.id, missionId: r.mission_id, package: parse(r.package_json, {}), packageSha: r.package_sha };
  };

  function recordHandoff(oppId, { pkg, sha, latest, acceptance }, missionId, actor, existingId = null) {
    return bus.transaction(() => {
      if (existingId) {
        db.prepare("UPDATE sales_handoffs SET mission_id = ? WHERE id = ? AND mission_id IS NULL").run(missionId, existingId);
        emit("sales.handoff.created", oppId, { handoffId: existingId, missionId }, actor);
        return { handoffId: existingId, missionId, package: pkg, packageSha: sha };
      }
      const id = newId("sho");
      db.prepare("INSERT INTO sales_handoffs (id, opportunity_id, proposal_id, proposal_sha, acceptance_id, package_json, package_sha, mission_id, status, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT_CREATED', ?, ?)")
        .run(id, oppId, latest.id, latest.contentSha, acceptance.id, json(pkg), sha, missionId, actor, now());
      emit("sales.handoff.created", oppId, { handoffId: id, missionId }, actor);
      return { handoffId: id, missionId, package: pkg, packageSha: sha };
    });
  }

  // ---------- follow-ups ----------
  function scheduleFollowup(oppId, { afterDays = null, dueAt = null, basis = "last_contact" }, actor) {
    const view = getOpportunity(oppId);
    assertWorkable(view.org);
    if (view.suppression) throw new HubError("policy", "Firma e DO_NOT_CONTACT");
    if (["WON", "LOST"].includes(view.opportunity.status)) throw new HubError("conflict", `Oportunitatea e ${view.opportunity.status}`);
    let due;
    let basisRef = "";
    if (basis === "last_contact") {
      const last = view.contactEvents.find((e) => ["SENT_VIA_HUB", "MANUAL_RECORDED"].includes(e.kind));
      if (!last) throw new HubError("conflict", "Nu există un contact real (trimis sau înregistrat manual): follow-up-ul se bazează pe o dată explicită");
      const days = Number(afterDays);
      if (!(days >= 1 && days <= 90)) throw new HubError("validation", "Zile după contact: 1..90");
      due = new Date(new Date(last.occurredAt).getTime() + days * 86400000);
      basisRef = last.id;
    } else if (basis === "explicit_date") {
      due = new Date(dueAt);
      if (Number.isNaN(due.getTime())) throw new HubError("validation", "Data follow-up-ului e invalidă");
    } else throw new HubError("validation", "Bază: last_contact | explicit_date");
    return bus.transaction(() => {
      const id = newId("sfu");
      const res = db.prepare(`INSERT OR IGNORE INTO sales_followups (id, opportunity_id, org_id, due_at, basis, basis_ref, status, expires_at, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'SCHEDULED', ?, ?, ?, ?)`).run(id, oppId, view.org.id, due.toISOString(), basis, basisRef, new Date(due.getTime() + 14 * 86400000).toISOString(), actor, now(), now());
      if (!res.changes) return { ...rowToFollowup(db.prepare("SELECT * FROM sales_followups WHERE opportunity_id = ? AND due_at = ?").get(oppId, due.toISOString())), duplicate: true };
      emit("sales.followup.scheduled", oppId, { followupId: id, dueAt: due.toISOString() }, actor);
      return rowToFollowup(db.prepare("SELECT * FROM sales_followups WHERE id = ?").get(id));
    });
  }

  function followupAction(id, action, { reason = "" } = {}, actor) {
    const f = rowToFollowup(db.prepare("SELECT * FROM sales_followups WHERE id = ?").get(id));
    if (!f) throw new HubError("not_found", "Follow-up-ul nu există");
    const to = { done: "DONE", suspend: "SUSPENDED", cancel: "CANCELLED", resume: "SCHEDULED" }[action];
    if (!to) throw new HubError("validation", "Acțiune: done | suspend | cancel | resume");
    if (action === "resume") {
      if (f.status !== "SUSPENDED") throw new HubError("conflict", "Doar un follow-up suspendat se reia");
      if (contactSuppression(f.orgId)) throw new HubError("policy", "Firma e DO_NOT_CONTACT");
      const opp = needOpp(f.opportunityId);
      if (["WON", "LOST"].includes(opp.status)) throw new HubError("conflict", `Oportunitatea e ${opp.status}`);
    } else if (!["SCHEDULED", "DUE", "SUSPENDED"].includes(f.status)) throw new HubError("conflict", `Follow-up-ul e ${f.status}`);
    bus.transaction(() => {
      db.prepare("UPDATE sales_followups SET status = ?, reason = ?, updated_at = ? WHERE id = ?").run(to, clip(reason, 200), now(), id);
      emit("sales.followup.updated", f.opportunityId, { followupId: id, status: to }, actor);
    });
    return rowToFollowup(db.prepare("SELECT * FROM sales_followups WHERE id = ?").get(id));
  }

  const FOLLOWUP_SELECT = "SELECT f.*, o.display_name AS org_name, p.title AS opp_title FROM sales_followups f JOIN sales_orgs o ON o.id = f.org_id JOIN sales_opportunities p ON p.id = f.opportunity_id";
  function listFollowups({ status = "" } = {}) {
    const rows = status ? db.prepare(`${FOLLOWUP_SELECT} WHERE f.status = ? ORDER BY f.due_at LIMIT 200`).all(status)
      : db.prepare(`${FOLLOWUP_SELECT} ORDER BY f.due_at LIMIT 200`).all();
    return rows.map((r) => ({ ...rowToFollowup(r), orgName: r.org_name, opportunityTitle: r.opp_title }));
  }
  const getFollowup = (id) => { const r = db.prepare(`${FOLLOWUP_SELECT} WHERE f.id = ?`).get(id); return r ? { ...rowToFollowup(r), orgName: r.org_name, opportunityTitle: r.opp_title } : null; };

  /** Scheduler tick (no message, no model): due follow-ups become DUE; stale DUE ones expire. Idempotent. */
  function tick() {
    const t = now();
    return bus.transaction(() => {
      const due = db.prepare("UPDATE sales_followups SET status = 'DUE', updated_at = ? WHERE status = 'SCHEDULED' AND due_at <= ?").run(t, t).changes;
      const expired = db.prepare("UPDATE sales_followups SET status = 'EXPIRED', updated_at = ? WHERE status = 'DUE' AND expires_at IS NOT NULL AND expires_at <= ?").run(t, t).changes;
      if (due || expired) emit("sales.followups.tick", "followups", { due, expired }, "scheduler");
      return { due, expired };
    });
  }

  // ---------- overview, export, Lega ----------
  function overview() {
    const count = (sql, ...a) => db.prepare(sql).get(...a).n;
    const group = (sql) => Object.fromEntries(db.prepare(sql).all().map((r) => [r.k, r.n]));
    const orgs = count("SELECT COUNT(*) AS n FROM sales_orgs WHERE archived_at IS NULL AND merged_into IS NULL");
    const synthetic = count("SELECT COUNT(*) AS n FROM sales_orgs WHERE synthetic = 1 AND archived_at IS NULL") + count("SELECT COUNT(*) AS n FROM sales_import_batches WHERE synthetic = 1 AND status <> 'ROLLED_BACK'");
    return {
      counts: {
        orgs, byStatus: group("SELECT status AS k, COUNT(*) AS n FROM sales_orgs WHERE archived_at IS NULL AND merged_into IS NULL GROUP BY status"),
        imports: group("SELECT status AS k, COUNT(*) AS n FROM sales_import_batches GROUP BY status"),
        importRows: group("SELECT status AS k, COUNT(*) AS n FROM sales_import_rows GROUP BY status"),
        needsReview: reviewRows({ limit: 1 }).total,
        evidence: group("SELECT label AS k, COUNT(*) AS n FROM sales_evidence GROUP BY label"),
        audits: count("SELECT COUNT(*) AS n FROM sales_audits"),
        qualified: count("SELECT COUNT(DISTINCT org_id) AS n FROM sales_qualifications"),
        opportunities: group("SELECT status AS k, COUNT(*) AS n FROM sales_opportunities GROUP BY status"),
        proposals: group("SELECT status AS k, COUNT(*) AS n FROM sales_proposals GROUP BY status"),
        drafts: group("SELECT status AS k, COUNT(*) AS n FROM sales_drafts GROUP BY status"),
        followups: group("SELECT status AS k, COUNT(*) AS n FROM sales_followups GROUP BY status"),
        suppressions: count("SELECT COUNT(*) AS n FROM sales_suppressions WHERE lifted_at IS NULL"),
        missingWebsite: count("SELECT COUNT(*) AS n FROM sales_orgs WHERE website = '' AND archived_at IS NULL AND merged_into IS NULL"),
        missingContact: count("SELECT COUNT(*) AS n FROM sales_orgs o WHERE archived_at IS NULL AND merged_into IS NULL AND NOT EXISTS (SELECT 1 FROM sales_contacts c WHERE c.org_id = o.id AND c.status = 'ACTIVE')"),
      },
      syntheticOrgs: count("SELECT COUNT(*) AS n FROM sales_orgs WHERE synthetic = 1 AND archived_at IS NULL AND merged_into IS NULL"),
      synthetic: synthetic > 0, outreach: transport ? "TEST_TRANSPORT" : "DISABLED", liveResearch: "DISABLED",
      confirmations: { manualContact: MANUAL_CONTACT_TEXT, clientAcceptance: CLIENT_ACCEPTANCE_TEXT },
      catalog: { services: count("SELECT COUNT(*) AS n FROM sales_services WHERE active = 1"), configuredPrices: count("SELECT COUNT(*) AS n FROM sales_services WHERE active = 1 AND price_json LIKE '%\"CONFIGURED\"%'") },
      metricsNote: "Activități numărate din date; ratele de răspuns, conversie și veniturile cer evenimente reale (nu se calculează din date sintetice).",
      split: splitCounts(),
    };
  }
  /**
   * M12 (T-S7), additive to overview(): the same activity split into real and synthetic rows. A row is synthetic when its company is (or
   * the row itself says so), so synthetic data never enters a real figure; the M12 preparations and dossiers (synthetic by CHECK) appear
   * only on the synthetic side. Counts only: no name, no contact value.
   */
  function splitCounts() {
    const side = (s) => (Number(s) ? "synthetic" : "real");
    const out = { real: { orgs: 0, qualified: 0, opportunities: {}, proposals: {}, drafts: {} }, synthetic: { orgs: 0, qualified: 0, opportunities: {}, proposals: {}, drafts: {}, preparations: {}, dossiers: {} } };
    for (const r of db.prepare("SELECT synthetic AS s, COUNT(*) AS n FROM sales_orgs WHERE archived_at IS NULL AND merged_into IS NULL GROUP BY synthetic").all()) out[side(r.s)].orgs += r.n;
    for (const r of db.prepare("SELECT o.synthetic AS s, COUNT(DISTINCT q.org_id) AS n FROM sales_qualifications q JOIN sales_orgs o ON o.id = q.org_id GROUP BY o.synthetic").all()) out[side(r.s)].qualified += r.n;
    const grouped = (key, sql) => { for (const r of db.prepare(sql).all()) { const g = out[side(r.s)][key]; g[r.k] = (g[r.k] || 0) + r.n; } };
    grouped("opportunities", "SELECT (op.synthetic = 1 OR o.synthetic = 1) AS s, op.status AS k, COUNT(*) AS n FROM sales_opportunities op JOIN sales_orgs o ON o.id = op.org_id GROUP BY 1, 2");
    grouped("proposals", "SELECT (op.synthetic = 1 OR o.synthetic = 1) AS s, p.status AS k, COUNT(*) AS n FROM sales_proposals p JOIN sales_opportunities op ON op.id = p.opportunity_id JOIN sales_orgs o ON o.id = op.org_id GROUP BY 1, 2");
    grouped("drafts", "SELECT o.synthetic AS s, d.status AS k, COUNT(*) AS n FROM sales_drafts d JOIN sales_orgs o ON o.id = d.org_id GROUP BY 1, 2");
    for (const r of db.prepare("SELECT status AS k, COUNT(*) AS n FROM sales_preparations GROUP BY status").all()) out.synthetic.preparations[r.k] = r.n;
    for (const r of db.prepare("SELECT status AS k, COUNT(*) AS n FROM sales_dossiers GROUP BY status").all()) out.synthetic.dossiers[r.k] = r.n;
    return { ...out, detail: splitDetail(side), note: "Rândurile sintetice (marcate „sintetic”) nu intră niciodată în cifrele reale." };
  }
  /**
   * M12 final review (F8), additive (a key of its own, so `real` / `synthetic` keep their shape): the rest of the figures the owner reads on
   * the Sales overview, per side — the company statuses, audits, follow-ups, companies without a site or an active contact, active
   * do-not-contact entries (one with no company is a real one) — so no synthetic row ever inflates a real figure on any screen.
   */
  function splitDetail(side) {
    const empty = () => ({ byStatus: {}, audits: 0, followups: {}, missingWebsite: 0, missingContact: 0, suppressions: 0 });
    const out = { real: empty(), synthetic: empty() };
    const add = (key, sql) => { for (const r of db.prepare(sql).all()) { const s = out[side(r.s)]; if (r.k === undefined) s[key] += r.n; else s[key][r.k] = (s[key][r.k] || 0) + r.n; } };
    add("byStatus", "SELECT synthetic AS s, status AS k, COUNT(*) AS n FROM sales_orgs WHERE archived_at IS NULL AND merged_into IS NULL GROUP BY 1, 2");
    add("audits", "SELECT (a.synthetic = 1 OR o.synthetic = 1) AS s, COUNT(*) AS n FROM sales_audits a JOIN sales_orgs o ON o.id = a.org_id GROUP BY 1");
    add("followups", "SELECT o.synthetic AS s, f.status AS k, COUNT(*) AS n FROM sales_followups f JOIN sales_orgs o ON o.id = f.org_id GROUP BY 1, 2");
    add("missingWebsite", "SELECT synthetic AS s, COUNT(*) AS n FROM sales_orgs WHERE website = '' AND archived_at IS NULL AND merged_into IS NULL GROUP BY 1");
    add("missingContact", `SELECT o.synthetic AS s, COUNT(*) AS n FROM sales_orgs o WHERE archived_at IS NULL AND merged_into IS NULL
      AND NOT EXISTS (SELECT 1 FROM sales_contacts c WHERE c.org_id = o.id AND c.status = 'ACTIVE') GROUP BY 1`);
    add("suppressions", "SELECT COALESCE(o.synthetic, 0) AS s, COUNT(*) AS n FROM sales_suppressions x LEFT JOIN sales_orgs o ON o.id = x.org_id WHERE x.lifted_at IS NULL GROUP BY 1");
    return out;
  }

  function exportOrgsCsv(filters = {}) {
    const headers = ["Denumire", "CUI", "CUI valid", "Site", "Oraș", "Județ", "Status", "Prioritate", "Sintetic", "Actualizat"];
    const rows = [];
    for (let offset = 0; ; offset += 200) {
      const page = listOrgs({ ...filters, offset, limit: 200 });
      for (const o of page.items) rows.push([o.displayName, o.fiscalCode, o.fiscalCodeValid === null ? "" : o.fiscalCodeValid ? "da" : "nu", o.website, o.city, o.county, o.status, o.priority ?? "", o.synthetic ? "da" : "nu", o.updatedAt]);
      if (offset + 200 >= page.total || offset > 20000) break;
    }
    return toCsv(headers, rows);
  }

  /** Short, bounded summaries for Lega (never the CRM, never contact values). */
  function legaPipelineSummary() {
    const o = overview();
    const top = db.prepare(`SELECT o.id, o.display_name, o.status, o.synthetic, q.priority FROM sales_orgs o JOIN sales_qualifications q ON q.org_id = o.id
      WHERE o.archived_at IS NULL AND o.merged_into IS NULL AND q.priority IS NOT NULL ORDER BY q.priority DESC LIMIT 5`).all();
    // M12 (T-S7): every item says whether it is synthetic, and the split real / synthetic travels with the totals (additive).
    return { orgs: o.counts.orgs, byStatus: o.counts.byStatus, opportunities: o.counts.opportunities, needsReview: o.counts.needsReview, drafts: o.counts.drafts,
      followupsDue: o.counts.followups.DUE || 0, synthetic: o.synthetic, outreach: o.outreach,
      topPriority: top.map((r) => ({ id: r.id, name: r.display_name, status: r.status, priority: r.priority, synthetic: Boolean(r.synthetic) })),
      split: { real: { orgs: o.split.real.orgs }, synthetic: { orgs: o.split.synthetic.orgs } },
      // M12 final review (F8), additive: every figure Lega says, per side — a synthetic row never inflates a real one.
      sides: Object.fromEntries(["real", "synthetic"].map((k) => [k, { orgs: o.split[k].orgs, byStatus: o.split.detail[k].byStatus, opportunities: o.split[k].opportunities,
        drafts: o.split[k].drafts, followupsDue: o.split.detail[k].followups.DUE || 0, ...(k === "synthetic" ? { preparations: o.split.synthetic.preparations } : {}) }])) };
  }
  /**
   * What Lega says for „cum stă pipeline-ul?” (its sales_overview read). Without synthetic data: the M04 sentence, unchanged. With
   * synthetic data (M12 final review F8): the real figures alone, then the synthetic ones apart and labelled — a synthetic row never
   * inflates a figure the owner hears as real. Every company named carries its own synthetic mark; never a contact value.
   */
  function legaPipelineText() {
    const o = legaPipelineSummary();
    const counts = (m, none) => Object.entries(m || {}).map(([k, v]) => `${k} ${v}`).join(", ") || none;
    const split = o.split ? ` (reale: ${o.split.real.orgs}, sintetice: ${o.split.synthetic.orgs})` : "";
    const outreach = `trimiterea: ${o.outreach === "DISABLED" ? "dezactivată (doar ciorne)" : o.outreach}`;
    const r = o.sides.real;
    const s = o.sides.synthetic;
    const parts = o.synthetic
      ? [`${o.orgs} firme în pipeline${split}`,
        `date REALE: ${r.orgs} firme; statusuri: ${counts(r.byStatus, "—")}; oportunități: ${counts(r.opportunities, "niciuna")}; ciorne: ${counts(r.drafts, "niciuna")}; follow-up-uri scadente: ${r.followupsDue}`,
        `date SINTETICE de test, separat (nu intră în cifrele reale): ${s.orgs} firme; oportunități: ${counts(s.opportunities, "niciuna")}; ciorne: ${counts(s.drafts, "niciuna")}; pregătiri de ofertă: ${counts(s.preparations, "niciuna")}`,
        `rânduri care așteaptă decizia ta de identitate: ${o.needsReview}`, outreach]
      : [`${o.orgs} firme în pipeline${split}`, `statusuri: ${counts(o.byStatus, "—")}`, `oportunități: ${counts(o.opportunities, "niciuna")}`,
        `rânduri care așteaptă decizia ta de identitate: ${o.needsReview}`, `ciorne: ${counts(o.drafts, "niciuna")}`, `follow-up-uri scadente: ${o.followupsDue}`, outreach];
    if (o.topPriority.length) parts.push(`prioritate internă (nu e șansă de vânzare): ${o.topPriority.map((t) => `${clip(t.name, 50)}${t.synthetic ? " (sintetic)" : ""} ${Math.round(t.priority)}`).join(", ")}`);
    return parts.join("; ") + ".";
  }
  function legaLeadDetail(idOrName) {
    let org = getOrgRow(String(idOrName || ""));
    if (!org) {
      const like = `%${foldDiacritics(String(idOrName || "")).toLowerCase().slice(0, 80)}%`;
      const r = db.prepare("SELECT * FROM sales_orgs WHERE normalized_name LIKE ? AND archived_at IS NULL AND merged_into IS NULL ORDER BY updated_at DESC LIMIT 1").get(like);
      org = rowToOrg(r);
    }
    if (!org) return { found: false };
    const sheet = getOrg(org.id);
    return { found: true, id: org.id, name: org.displayName, status: org.status, synthetic: org.synthetic, city: org.city, fiscalCodeValid: org.fiscalCodeValid,
      website: org.website, unknowns: sheet.unknowns, qualification: sheet.qualification ? { priority: sheet.qualification.priority, version: sheet.qualification.formulaVersion, explanation: (sheet.qualification.result.explanation || []).slice(0, 5) } : null,
      auditIssues: (sheet.audits[0]?.result.checks || []).filter((c) => c.status === "ISSUE").map((c) => c.observation).slice(0, 5),
      evidenceByLabel: sheet.evidence.reduce((m, e) => ({ ...m, [e.label]: (m[e.label] || 0) + 1 }), {}), opportunities: sheet.opportunities.map((p) => ({ title: p.title, status: p.status })),
      doNotContact: Boolean(sheet.suppression) };
  }
  function legaDrafts() {
    return db.prepare(`SELECT d.id, d.status, d.version, d.subject, o.display_name, o.synthetic FROM sales_drafts d JOIN sales_orgs o ON o.id = d.org_id WHERE d.status IN ('DRAFT','CONTENT_APPROVED') ORDER BY d.updated_at DESC LIMIT 10`).all()
      .map((r) => ({ id: r.id, org: r.display_name, status: r.status, version: r.version, subject: r.subject, sent: false, synthetic: Boolean(r.synthetic) }));
  }

  return {
    createImport, setMapping, preview, confirm, batchRows, resolveRow, rollbackPreview, rollback, getBatch: needBatch,
    listBatches: () => db.prepare("SELECT * FROM sales_import_batches ORDER BY created_at DESC LIMIT 100").all().map(rowToBatch),
    listOrgs, reviewRows, getOrg, transitionOrg, updateOrg, addEvidence, mergeOrgs, revertMerge, suppress, liftSuppression,
    auditOrg, qualifyOrg, overrideQualification,
    listServices: (opts) => services(opts), saveService,
    createOpportunity, transitionOpportunity, getOpportunity, listOpportunities,
    createProposal, approveProposal, createDraft, reviseDraft, approveDraftContent, sendDraft, recordContactEvent, recordClientAcceptance,
    buildHandoffPackage, recordHandoff,
    scheduleFollowup, followupAction, listFollowups, getFollowup, currentHandoff, tick,
    overview, exportOrgsCsv, legaPipelineSummary, legaPipelineText, legaLeadDetail, legaDrafts,
    latestProposal, latestDraft,
    // M12 preparation (written only by the confirmed plan's steps; no command reaches these directly).
    createPreparationOrg, fixturePage, recordResearch, preparationBasis, boundStale, isPreparationBound, onInvalidated, latestQualification,
    // M12 review fixes (parts 2–3): the exact bound qualification row, its inputs, synthetic identity uniqueness, the owner profile hook.
    qualificationById, qualificationInputsSha, syntheticIdentityTaken, saveOwnerProfile,
  };
}
