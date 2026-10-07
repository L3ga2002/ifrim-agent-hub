import { redactText } from "../security/redact.mjs";

/**
 * Proposal and first-contact texts (M04 §2.4), rendered deterministically from verified data only. No model writes these:
 * a model would happily invent a price, a deadline, a testimonial or a "we analysed your site" sentence, and a draft with
 * such a claim reaches a real company. Here every sentence is either fixed template text or a value with provenance:
 *   - observations come only from OBSERVED and USER_PROVIDED evidence (with their source) and OBSERVED audit checks;
 *   - price and lead time come only from a catalog service whose status is CONFIGURED;
 *   - portfolio, testimonials, results or discounts appear only when the owner listed them in `owner.materials`;
 *   - every claim that was not OBSERVED is listed in `claimsToVerify` for the owner before anything is approved;
 *   - names of people are never invented: a generic address (office@, info@…) gets a generic greeting.
 * Values coming from sites, imports or sources are untrusted text: they are redacted, flattened, truncated and placeholder
 * syntax in them is neutralised, so they can never read as an instruction or as an unresolved template field.
 *
 * Pure module: no database, no network, no clock.
 */

const NOT_CONFIGURED = "De stabilit (neconfigurat)";
const VERIFIED_FOR_TEXT = new Set(["OBSERVED", "USER_PROVIDED"]);
const KNOWN_LABELS = new Set(["OBSERVED", "USER_PROVIDED", "SOURCE_REPORTED", "INFERRED", "UNKNOWN"]);
const MAX_DRAFT_OBSERVATIONS = 3;

/** Local mailbox names that denote a shared inbox, not a person (kept in sync with identity.mjs `checkEmail`). */
const GENERIC_LOCAL_PARTS = new Set([
  "info", "office", "contact", "contacts", "sales", "vanzari", "hello", "comenzi", "comanda", "admin", "secretariat",
  "support", "suport", "service", "servicii", "receptie", "reception", "mail", "email", "team", "echipa", "hr", "jobs",
  "cariere", "marketing", "noreply", "no-reply", "office1", "contabilitate", "facturare", "billing",
]);

const arr = (value) => (Array.isArray(value) ? value : []);

/** Untrusted value → one safe line of text ("" for nothing; never "undefined", "null" or "[object Object]"). */
function clean(value, max = 300) {
  if (value === null || value === undefined || typeof value === "object" || typeof value === "function") return "";
  if (typeof value === "number" && !Number.isFinite(value)) return "";
  let out = String(redactText(String(value)))
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    // Placeholder syntax inside data is neutralised so it can never pass for an unfilled template field.
    .replace(/\{\{|\}\}|\$\{|\[\[|\]\]/g, (m) => m.split("").join(" "));
  if (out.length > max) out = `${out.slice(0, max - 1).trimEnd()}…`;
  return out;
}

/** Detects unresolved template fields left in a rendered text (exported for callers that store or approve texts). */
export function findUnresolvedPlaceholders(textValue) {
  const found = String(textValue ?? "").match(/\{\{[^}]*\}\}|\$\{[^}]*\}|\[\[[^\]]*\]\]|<(?:nume|name|firma|company|oras|city|pret|price)>|\bundefined\b|\bNaN\b|\[object Object\]|\bTODO\b|\bXXX\b|\bnull\b/gi);
  return found ? [...new Set(found)] : [];
}

const labelOf = (e) => (typeof e?.label === "string" && KNOWN_LABELS.has(e.label.toUpperCase()) ? e.label.toUpperCase() : "UNKNOWN");
const isObservedCheck = (check) => check && check.label === "OBSERVED" && (check.status === "PASS" || check.status === "ISSUE");
const hasObservedAudit = (audit) => arr(audit?.checks).some(isObservedCheck);
const isSynthetic = (org) => org?.synthetic === true || org?.synthetic === 1;
const bullets = (items) => items.map((item) => `- ${item}`).join("\n");

function auditHost(audit) {
  const raw = clean(audit?.url, 300);
  if (!raw) return "";
  try { return new URL(raw).host; } catch { return raw; }
}

function evidenceForCheck(evidence, checkId) {
  if (!checkId) return null;
  const id = String(checkId);
  const hit = evidence.find((e) => e && e.id && (e.claim === id || e.sourceRef === id || (typeof e.sourceRef === "string" && (e.sourceRef.endsWith(`#${id}`) || e.sourceRef.endsWith(`:${id}`)))));
  return hit ? String(hit.id) : null;
}

function describeEvidence(e) {
  const claim = clean(e.claim, 120);
  const value = clean(e.value, 300);
  const source = clean(e.sourceRef, 200) || clean(e.sourceKind, 60) || "sursă nespecificată";
  const when = clean(e.verifiedAt, 40);
  return { claim, value, source, when, line: `${claim}${value ? `: ${value}` : ""}` };
}

/** Price text only from a CONFIGURED price with a finite amount and a currency; anything else is "not configured". */
function priceText(service) {
  const p = service?.price;
  if (!p || p.status !== "CONFIGURED") return null;
  const amount = typeof p.amount === "number" ? (Number.isFinite(p.amount) && p.amount >= 0 ? String(p.amount) : "") : clean(p.amount, 40);
  const currency = clean(p.currency, 10).toUpperCase();
  if (!amount || !/^\d+(?:[.,]\d+)?$/.test(amount) || !currency) return null;
  const unit = clean(p.unit, 60);
  return `${amount} ${currency}${unit ? ` / ${unit}` : ""}`;
}

function leadTimeText(service) {
  const l = service?.leadTime;
  if (!l || l.status !== "CONFIGURED") return null;
  return clean(l.text, 200) || null;
}

/** Owner materials (portfolio, testimonials, case studies…) as text lines; only these may mention such things. */
function materialLines(owner) {
  return arr(owner?.materials).map((m) => {
    if (typeof m === "string") return clean(m, 200);
    if (!m || typeof m !== "object") return "";
    const title = clean(m.title ?? m.name ?? m.label, 160);
    const ref = clean(m.url ?? m.ref, 200);
    const kind = clean(m.kind ?? m.type, 40);
    if (!title && !ref) return "";
    return `${kind ? `${kind}: ` : ""}${title || ref}${title && ref ? ` (${ref})` : ""}`;
  }).filter(Boolean);
}

function pickServices(opportunity, services) {
  const list = arr(services).filter((s) => s && typeof s === "object" && s.id);
  const wanted = opportunity?.serviceId === null || opportunity?.serviceId === undefined ? "" : String(opportunity.serviceId);
  if (wanted) return { chosen: list.filter((s) => String(s.id) === wanted), wanted };
  // No service on the opportunity: only an explicit single-service selection is used, never the whole catalog.
  return { chosen: list.length === 1 ? list : [], wanted: "" };
}

/**
 * Proposal text for one opportunity.
 * @returns {{ title: string, sections: { id: string, heading: string, text: string }[], claimsToVerify: string[],
 *   usedEvidenceIds: string[], warnings: string[], text: string,
 *   observations: { text: string, evidenceId: string|null, checkId?: string, label: string }[], serviceNames: string[] }}
 * `observations` and `serviceNames` are additive fields read by `renderContactDraft` (personalization with provenance).
 */
export function renderProposal({ org = null, opportunity = null, services = [], evidence = [], audit = null, owner = {} } = {}) {
  const ev = arr(evidence).filter((e) => e && typeof e === "object");
  const warnings = [];
  const claims = [];
  const usedEvidenceIds = [];
  const observations = [];
  const orgName = clean(org?.displayName, 160);
  if (!orgName) warnings.push("Fișa firmei nu are nume: propunerea folosește o formulare generală.");
  if (isSynthetic(org)) warnings.push("Date sintetice: propunerea nu se trimite unei firme reale.");

  const { chosen, wanted } = pickServices(opportunity, services);
  if (wanted && !chosen.length) warnings.push(`Serviciul ${clean(wanted, 80)} al oportunității nu există în catalog.`);
  if (!wanted && !chosen.length) warnings.push("Oportunitatea nu are niciun serviciu configurat.");

  // Context: the record the proposal is addressed to.
  const contextLines = [];
  contextLines.push(`Firmă: ${orgName || "nespecificată în fișă"}`);
  if (clean(org?.city, 80)) contextLines.push(`Oraș: ${clean(org.city, 80)}`);
  if (org?.fiscalCodeValid === true && clean(org?.fiscalCode, 20)) contextLines.push(`CUI: ${clean(org.fiscalCode, 20)}`);
  const site = clean(org?.website, 200) || clean(org?.domain, 200);
  if (site) contextLines.push(`Site: ${site}`);

  // Observations: OBSERVED / USER_PROVIDED evidence with source; every other label goes to the owner's verification list.
  const obsLines = [];
  for (const e of ev) {
    const label = labelOf(e);
    const d = describeEvidence(e);
    if (!d.claim && !d.value) continue;
    if (VERIFIED_FOR_TEXT.has(label)) {
      obsLines.push(`${d.line} (sursa: ${d.source}${d.when ? `, verificat la ${d.when}` : ""}; ${label})`);
      if (e.id) usedEvidenceIds.push(String(e.id));
      observations.push({ text: d.line, evidenceId: e.id ? String(e.id) : null, label });
    }
    if (label !== "OBSERVED") claims.push(`${d.line} (${label}, sursa: ${d.source})`);
  }

  // The audit check behind the opportunity: stated as an observation only when the static audit OBSERVED it.
  const checkId = clean(opportunity?.checkId, 80);
  const check = checkId ? arr(audit?.checks).find((c) => c && String(c.id) === checkId) : null;
  const oppObservation = clean(opportunity?.observation, 300);
  if (check && isObservedCheck(check) && check.status === "ISSUE") {
    const what = clean(check.observation, 300) || oppObservation;
    const host = auditHost(audit);
    const linked = evidenceForCheck(ev, checkId);
    if (what) {
      obsLines.push(`${what} (sursa: verificare statică a paginii${host ? ` ${host}` : ""}${clean(check.evidence?.selector, 80) ? `, element ${clean(check.evidence.selector, 80)}` : ""}; OBSERVED)`);
      observations.push({ text: what, evidenceId: linked, checkId, label: "OBSERVED" });
      if (linked && !usedEvidenceIds.includes(linked)) usedEvidenceIds.push(linked);
    }
  } else if (oppObservation) {
    claims.push(`${oppObservation} (neconfirmat de un audit OBSERVED)`);
  }
  const effect = clean(opportunity?.possibleEffect, 300);
  if (effect) claims.push(`Efect posibil (dedus, nu observat): ${effect}`);
  if (!hasObservedAudit(audit)) warnings.push("Nu există un audit cu verificări observate: propunerea nu afirmă că site-ul a fost analizat.");

  // Solution, scope, exclusions, materials and price come only from the owner's catalog.
  const solutionLines = [];
  const scope = [];
  const exclusions = [];
  const neededMaterials = [];
  const priceLines = [];
  for (const s of chosen) {
    const name = clean(s.name, 120) || clean(s.id, 80);
    const description = clean(s.description, 600);
    solutionLines.push(`${name}${description ? `: ${description}` : ""}`);
    for (const item of arr(s.scope)) if (clean(item)) scope.push(clean(item));
    for (const item of arr(s.exclusions)) if (clean(item)) exclusions.push(clean(item));
    for (const item of arr(s.materials)) if (clean(item)) neededMaterials.push(clean(item));
    const price = priceText(s);
    const lead = leadTimeText(s);
    if (!price) warnings.push(`Prețul serviciului ${name} nu e configurat.`);
    if (!lead) warnings.push(`Termenul serviciului ${name} nu e configurat.`);
    priceLines.push(`${name}: preț ${price || NOT_CONFIGURED}; termen ${lead || NOT_CONFIGURED}`);
  }
  if (effect) solutionLines.push(`Efect posibil, de confirmat împreună: ${effect}`);
  if (!chosen.length) solutionLines.unshift("Serviciul potrivit se stabilește după o discuție cu dumneavoastră.");

  const questions = arr(opportunity?.conditionsToConfirm).map((q) => clean(q, 300)).filter(Boolean);
  questions.push("Care este obiectivul principal pe care îl urmăriți în perioada următoare?");
  questions.push("Cine din echipa dumneavoastră se ocupă de acest subiect?");

  const sections = [
    { id: "context", heading: "Context verificat", text: bullets(contextLines) },
    { id: "observations", heading: "Observații", text: obsLines.length ? bullets(obsLines) : "Nu există încă observații verificate; le stabilim împreună." },
    { id: "solution", heading: "Soluție propusă", text: bullets(solutionLines) },
    { id: "scope", heading: "Ce include", text: scope.length ? bullets(scope) : NOT_CONFIGURED },
    { id: "exclusions", heading: "Ce nu include", text: exclusions.length ? bullets(exclusions) : NOT_CONFIGURED },
    { id: "materials", heading: "Materiale necesare de la dumneavoastră", text: neededMaterials.length ? bullets(neededMaterials) : "Le stabilim împreună după confirmarea nevoilor." },
    { id: "questions", heading: "Întrebări", text: bullets(questions) },
    { id: "next_step", heading: "Următorul pas", text: "O discuție scurtă în care confirmăm observațiile și nevoile. După confirmare, trimitem oferta finală." },
    { id: "price_terms", heading: "Preț și termen", text: priceLines.length ? bullets(priceLines) : `Preț: ${NOT_CONFIGURED}. Termen: ${NOT_CONFIGURED}.` },
  ];
  const presentation = materialLines(owner);
  if (presentation.length) sections.push({ id: "owner_materials", heading: "Materiale de prezentare", text: bullets(presentation) });

  const sender = clean(owner?.companyName, 160);
  if (!sender) warnings.push("Numele firmei tale (owner.companyName) nu e configurat.");
  const serviceTitle = chosen.length === 1 ? clean(chosen[0].name, 120) : "";
  const title = `${isSynthetic(org) ? "[DATE SINTETICE] " : ""}Propunere${serviceTitle ? ` ${serviceTitle}` : ""}${orgName ? ` pentru ${orgName}` : ""}`;
  const signature = [clean(owner?.signatureName, 120), sender].filter(Boolean);
  const text = [title, ...sections.map((s) => `${s.heading}\n${s.text}`), signature.length ? `Cu stimă,\n${signature.join("\n")}` : "Cu stimă"].join("\n\n");

  const leftovers = findUnresolvedPlaceholders(text);
  if (leftovers.length) warnings.push(`Textul conține câmpuri nerezolvate: ${leftovers.join(", ")}.`);

  return {
    title,
    sections,
    claimsToVerify: [...new Set(claims)],
    usedEvidenceIds: [...new Set(usedEvidenceIds)],
    warnings: [...new Set(warnings)],
    text,
    observations,
    serviceNames: chosen.map((s) => clean(s.name, 120) || clean(s.id, 80)),
  };
}

function isGenericContact(contact) {
  if (!contact) return true;
  if (contact.generic === true) return true;
  const value = String(contact.value || "").trim().toLowerCase();
  const at = value.indexOf("@");
  if (at > 0 && GENERIC_LOCAL_PARTS.has(value.slice(0, at).replace(/[0-9._-]+$/, ""))) return true;
  return false;
}

/**
 * First-contact draft (DRAFT_ONLY in M04: nothing is sent). "Am analizat site-ul" appears only when the audit itself has
 * OBSERVED checks; personalization is limited to issues the static audit OBSERVED (at most three), each naming its audit
 * check and the evidence row behind it when one exists. Imported or source-reported facts never personalise a first message.
 * @returns {{ subject: string, body: string, claimsToVerify: string[], personalizationBasis: { text: string, evidenceId: string|null, checkId?: string }[], warnings: string[] }}
 */
export function renderContactDraft({ org = null, contact = null, proposal = null, audit = null, owner = {} } = {}) {
  const warnings = [];
  const orgName = clean(org?.displayName, 160);
  const sender = clean(owner?.companyName, 160);
  if (!sender) warnings.push("Numele firmei tale (owner.companyName) nu e configurat.");
  if (isSynthetic(org)) warnings.push("Date sintetice: draftul nu se trimite unei firme reale.");
  if (!contact) warnings.push("Nu e ales niciun contact.");
  else if (String(contact.kind || "").toLowerCase() !== "email") warnings.push("Contactul ales nu e o adresă de e-mail.");

  // A person's name is used only when the contact is personal and the record carries the name; never guessed.
  const personName = !isGenericContact(contact) ? clean(contact?.name, 80) : "";
  const greeting = personName ? `Bună ziua, ${personName},` : "Bună ziua,";

  const observed = hasObservedAudit(audit);
  const basis = [];
  if (observed) {
    for (const o of arr(proposal?.observations)) {
      if (basis.length >= MAX_DRAFT_OBSERVATIONS) break;
      // Only checks the given audit itself OBSERVED as issues: a proposal object cannot vouch for a check on its own.
      if (o?.label !== "OBSERVED" || !o.checkId || !arr(audit?.checks).some((c) => isObservedCheck(c) && c.status === "ISSUE" && String(c.id) === String(o.checkId))) continue;
      const t = clean(o.text, 240);
      if (t) basis.push({ text: t, evidenceId: o.evidenceId ? String(o.evidenceId) : null, checkId: String(o.checkId) });
    }
    for (const c of arr(audit?.checks)) {
      if (basis.length >= MAX_DRAFT_OBSERVATIONS) break;
      if (!isObservedCheck(c) || c.status !== "ISSUE") continue;
      const t = clean(c.observation, 240);
      if (t && !basis.some((b) => b.checkId === String(c.id) || b.text === t)) basis.push({ text: t, evidenceId: null, checkId: String(c.id) });
    }
  }

  const serviceName = arr(proposal?.serviceNames).map((n) => clean(n, 120)).filter(Boolean).join(", ");

  const lines = [greeting, ""];
  const intro = `Vă scriu din partea ${sender || "firmei noastre"}${orgName ? `, cu o propunere pentru ${orgName}` : ""}.`;
  lines.push(intro);
  if (basis.length) {
    const host = auditHost(audit);
    lines.push("", `Am analizat site-ul${host ? ` ${host}` : ""} printr-o verificare automată a paginii publice și am observat:`);
    lines.push(bullets(basis.map((b) => b.text)));
  }
  lines.push("", serviceName
    ? `Am pregătit o propunere scurtă pentru ${serviceName}. Dacă vă interesează, putem discuta pe scurt ce v-ar fi util și ce nu.`
    : "Dacă vă interesează, putem discuta pe scurt ce v-ar fi util și ce nu.");
  lines.push("", "Dacă nu doriți să mai primiți mesaje de la noi, răspundeți cu „Nu” și nu vă vom mai contacta.");
  const signature = [clean(owner?.signatureName, 120), sender].filter(Boolean);
  lines.push("", "Cu stimă,", ...(signature.length ? signature : []));
  const body = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();

  const subject = `${isSynthetic(org) ? "[DATE SINTETICE] " : ""}${serviceName ? `Propunere ${serviceName}` : "Propunere de colaborare"}${orgName ? ` pentru ${orgName}` : ""}`;
  const claimsToVerify = [...new Set(arr(proposal?.claimsToVerify).map((c) => clean(c, 400)).filter(Boolean))];
  if (personName) claimsToVerify.push(`Numele persoanei de contact: ${personName} (din fișă; de verificat înainte de trimitere)`);
  const leftovers = findUnresolvedPlaceholders(`${subject}\n${body}`);
  if (leftovers.length) warnings.push(`Textul conține câmpuri nerezolvate: ${leftovers.join(", ")}.`);

  return { subject, body, claimsToVerify, personalizationBasis: basis, warnings };
}

// M11: the commercial summary of a delivery (delivery/summary.mjs) reuses the same rules for untrusted text, price and term.
export { NOT_CONFIGURED, clean, priceText, leadTimeText, materialLines };
