import { HubError } from "../core/errors.mjs";
import { redactText } from "../security/redact.mjs";

/**
 * Explainable lead qualification (M04 §2.4). The priority is an INTERNAL ordering aid for the owner, never a probability of
 * a sale. Every point carries the factor that produced it and the evidence ids behind it, so the owner can see why a lead
 * ranks where it does and override it with a reason.
 *
 * Why unknown is not zero: a site that was never audited is not a site without needs, and a company without a published
 * turnover is not a small company. Unknown components get `score: null` and the weights are renormalised over the known
 * ones; when nothing is known the priority itself is null. A financial filter that cannot be compared like for like
 * (same indicator, period and currency, with a source) is UNKNOWN and never excludes anyone.
 *
 * Pure module: no database, no network, no clock (except the default `at` of an override).
 */

/**
 * Versioned formula. A change of weights, factor points or rules is a new version (q-v2…); stored qualifications keep the
 * version they were computed with, so old results stay explainable.
 */
export const QUALIFICATION_FORMULA = Object.freeze({
  version: "q-v1",
  weights: Object.freeze({ serviceFit: 0.5, evidence: 0.3, completeness: 0.2 }),
});

/** Owner-facing description of q-v1 (shown next to every qualification). */
export const QUALIFICATION_FORMULA_DOC = Object.freeze([
  "Formula q-v1: prioritatea (0–100) este media ponderată a componentelor cunoscute: potrivire cu serviciile 50%, calitatea dovezilor 30%, completitudinea fișei 20%.",
  "Potrivire cu serviciile: fiecare oportunitate legată de un serviciu din catalog aduce 25 de puncte dacă problema a fost observată în audit (OBSERVED) și 10 puncte dacă nu e confirmată; maximum 100. Fără catalog sau fără audit și oportunități, componenta e necunoscută.",
  "Calitatea dovezilor: pentru fiecare afirmație se ia cea mai bună etichetă (OBSERVED 100, USER_PROVIDED 80, SOURCE_REPORTED 60, INFERRED 25), apoi se face media. Afirmațiile UNKNOWN nu se numără; fără nicio dovadă cunoscută, componenta e necunoscută.",
  "Completitudinea fișei: nume 10, CUI valid 20, oraș 10, site 20, e-mail 20, telefon 20. O fișă fără nicio dată de identificare e necunoscută.",
  "O componentă necunoscută nu valorează 0: ponderile se renormalizează pe componentele cunoscute. Dacă nicio componentă nu e cunoscută, prioritatea e necunoscută.",
  "Filtrul financiar compară doar același indicator, aceeași perioadă și aceeași monedă, cu sursă. Altfel rezultatul e UNKNOWN și firma nu e exclusă.",
  "Prioritatea e internă: nu e o probabilitate de vânzare.",
]);

/**
 * q-v2 (M12, C-04, S-04): the same weights and factor points as q-v1, with two rules: an inference adds no score as if it were a
 * confirmed piece of evidence, and every point names the recorded, non-inference evidence row behind it. What q-v1 scored from
 * inferences (the INFERRED reading in the evidence average, an opportunity the audit did not observe, a field of the record backed
 * only by an inference) is listed in `inferences`; what q-v1 scored without any evidence (a field present in the record, an observed
 * issue with no evidence row) is listed in `unproven`; both appear in `missing` („ce lipsește”), never as points. The inference
 * rule is neutral: taking every inference out of the data leaves the q-v2 components, unknowns and priority unchanged. On the same
 * data q-v2 can be above or below q-v1; only these rules are the contract.
 */
export const QUALIFICATION_FORMULA_V2 = Object.freeze({ version: "q-v2", weights: QUALIFICATION_FORMULA.weights });
/** Every formula a stored qualification may name. `qualify()` computes q-v1 unless q-v2 is asked for explicitly. */
export const QUALIFICATION_FORMULAS = Object.freeze({ "q-v1": QUALIFICATION_FORMULA, "q-v2": QUALIFICATION_FORMULA_V2 });

/** Owner-facing description of q-v2. */
export const QUALIFICATION_FORMULA_DOC_V2 = Object.freeze([
  "Formula q-v2: aceleași ponderi și puncte ca q-v1 (potrivire cu serviciile 50%, calitatea dovezilor 30%, completitudinea fișei 20%), dar inferențele nu se punctează ca dovezi confirmate.",
  "Potrivire cu serviciile: doar o oportunitate a cărei problemă a fost observată în audit (OBSERVED) și are o dovadă înregistrată aduce 25 de puncte; o oportunitate dedusă, neconfirmată de audit, nu aduce puncte și apare la „ce lipsește”. Fără verificări observate în audit, componenta e necunoscută.",
  "Calitatea dovezilor: cea mai bună etichetă confirmată pe afirmație (OBSERVED 100, USER_PROVIDED 80, SOURCE_REPORTED 60), apoi media. Inferențele (INFERRED) nu intră nici în sumă, nici în numărul afirmațiilor; dacă există doar inferențe, componenta e necunoscută.",
  "Completitudinea fișei: aceleași puncte ca în q-v1, dar un câmp se punctează doar cu o dovadă înregistrată care nu e inferență; un câmp fără dovadă sau susținut doar de inferențe nu se punctează și apare la „ce lipsește”. Fără niciun câmp dovedit, componenta e necunoscută.",
  "Fiecare punct arată dovada lui: un punct fără o dovadă înregistrată (cu id) nu se acordă în q-v2.",
  "Neutralitate: dacă se scot toate inferențele din date, scorul q-v2 rămâne același. Calificările salvate își păstrează formula cu care au fost calculate.",
  "Prioritatea e internă: nu e o probabilitate de vânzare.",
]);
export const QUALIFICATION_FORMULA_DOCS = Object.freeze({ "q-v1": QUALIFICATION_FORMULA_DOC, "q-v2": QUALIFICATION_FORMULA_DOC_V2 });

const COMPONENTS = Object.freeze(["serviceFit", "evidence", "completeness"]);
const COMPONENT_LABEL = Object.freeze({ serviceFit: "potrivire cu serviciile", evidence: "calitatea dovezilor", completeness: "completitudinea fișei" });

/** Points per evidence label for the evidence-quality component. UNKNOWN is deliberately absent (it is not counted). */
const LABEL_POINTS = Object.freeze({ OBSERVED: 100, USER_PROVIDED: 80, SOURCE_REPORTED: 60, INFERRED: 25 });

const FIT_POINTS_OBSERVED = 25;
const FIT_POINTS_UNCONFIRMED = 10;

/** Completeness factors: points and the evidence claim names that back each field. */
const COMPLETENESS_FACTORS = Object.freeze([
  { key: "name", label: "nume firmă", points: 10, claims: ["name", "displayname", "nume"] },
  { key: "fiscalCode", label: "CUI valid", points: 20, claims: ["fiscalcode", "cui", "cif"] },
  { key: "city", label: "oraș", points: 10, claims: ["city", "oras", "oraș"] },
  { key: "website", label: "site", points: 20, claims: ["website", "domain", "site"] },
  { key: "email", label: "e-mail", points: 20, claims: ["email", "e-mail"] },
  { key: "phone", label: "telefon", points: 20, claims: ["phone", "telefon"] },
]);

const OVERRIDE_REASON_MIN = 5;
const OVERRIDE_REASON_MAX = 500;

const arr = (value) => (Array.isArray(value) ? value : []);
const text = (value, max = 200) => {
  if (value === null || value === undefined || typeof value === "object") return "";
  return String(redactText(String(value))).replace(/\s+/g, " ").trim().slice(0, max);
};
const round1 = (n) => Math.round(n * 10) / 10;
const pct = (w) => `${Math.round(w * 100)}%`;
const normLabel = (label) => (typeof label === "string" && Object.hasOwn(LABEL_POINTS, label.toUpperCase()) ? label.toUpperCase() : "UNKNOWN");
const isObservedCheck = (check) => check && check.label === "OBSERVED" && (check.status === "PASS" || check.status === "ISSUE");

/** Evidence rows that document an audit check: matched by claim or by a source reference naming the check id. */
function evidenceForCheck(evidence, checkId) {
  if (!checkId) return [];
  const id = String(checkId);
  return evidence.filter((e) => e && e.id && (e.claim === id || e.sourceRef === id || (typeof e.sourceRef === "string" && (e.sourceRef.endsWith(`#${id}`) || e.sourceRef.endsWith(`:${id}`))))).map((e) => String(e.id));
}

function evidenceForClaims(evidence, claimNames) {
  return evidence.filter((e) => e && e.id && typeof e.claim === "string" && claimNames.includes(e.claim.trim().toLowerCase())).map((e) => String(e.id));
}

/** serviceFit: does what we observed about the company match a service the owner actually offers? */
function scoreServiceFit({ audit, opportunities, catalog, evidence }) {
  const catalogIds = new Set(catalog.filter((s) => s && s.id).map((s) => String(s.id)));
  if (!catalogIds.size) return { score: null, contributions: [], unknown: "potrivirea cu serviciile e necunoscută: catalogul de servicii e gol" };
  const checks = arr(audit?.checks);
  const observed = checks.filter(isObservedCheck);
  if (!observed.length && !opportunities.length) {
    return { score: null, contributions: [], unknown: "potrivirea cu serviciile e necunoscută: site-ul nu are un audit cu verificări observate și nu există oportunități" };
  }
  const contributions = [];
  const seen = new Set();
  let total = 0;
  for (const opp of opportunities) {
    if (!opp || typeof opp !== "object") continue;
    const checkId = text(opp.checkId, 80);
    const serviceId = opp.serviceId === null || opp.serviceId === undefined ? "" : String(opp.serviceId);
    const key = `${checkId}|${serviceId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const evidenceIds = evidenceForCheck(evidence, checkId);
    const what = text(opp.observation, 160) || checkId || "oportunitate";
    if (!serviceId) {
      contributions.push({ factor: `${what}: niciun serviciu configurat`, points: 0, evidenceIds });
      continue;
    }
    if (!catalogIds.has(serviceId)) {
      contributions.push({ factor: `${what}: serviciul ${text(serviceId, 80)} nu există în catalog`, points: 0, evidenceIds });
      continue;
    }
    const backed = checks.some((c) => isObservedCheck(c) && c.status === "ISSUE" && String(c.id) === checkId);
    const points = backed ? FIT_POINTS_OBSERVED : FIT_POINTS_UNCONFIRMED;
    contributions.push({ factor: `${what} → serviciul ${text(serviceId, 80)} (${backed ? "observat în audit" : "neconfirmat de audit"})`, points, evidenceIds });
    total += points;
  }
  if (!contributions.length) {
    contributions.push({ factor: `auditul (${observed.length} verificări observate) nu a indicat nevoi acoperite de serviciile configurate`, points: 0, evidenceIds: [] });
  }
  if (total > 100) {
    contributions.push({ factor: "plafonare la 100 de puncte", points: 100 - total, evidenceIds: [] });
    total = 100;
  }
  return { score: total, contributions };
}

/** evidence: how reliable is what we know? Best label per claim, then the average; UNKNOWN claims are not counted. */
function scoreEvidence({ evidence }) {
  const byClaim = new Map();
  for (const e of evidence) {
    if (!e || typeof e !== "object") continue;
    const label = normLabel(e.label);
    if (label === "UNKNOWN") continue;
    const claim = text(e.claim, 120).toLowerCase() || `#${text(e.id, 80)}`;
    const current = byClaim.get(claim);
    if (!current || LABEL_POINTS[label] > LABEL_POINTS[current.label]) byClaim.set(claim, { label, ids: e.id ? [String(e.id)] : [] });
    else if (current.label === label && e.id) current.ids.push(String(e.id));
  }
  if (!byClaim.size) return { score: null, contributions: [], unknown: "calitatea dovezilor e necunoscută: nu există dovezi cu etichetă cunoscută" };
  const n = byClaim.size;
  const groups = new Map();
  for (const { label, ids } of byClaim.values()) {
    const g = groups.get(label) || { count: 0, ids: [] };
    g.count += 1;
    g.ids.push(...ids);
    groups.set(label, g);
  }
  const contributions = [];
  let sum = 0;
  for (const label of Object.keys(LABEL_POINTS)) {
    const g = groups.get(label);
    if (!g) continue;
    sum += LABEL_POINTS[label] * g.count;
    contributions.push({ factor: `${g.count} ${g.count === 1 ? "afirmație" : "afirmații"} ${label} (${LABEL_POINTS[label]} puncte fiecare, din ${n})`, points: round1((LABEL_POINTS[label] * g.count) / n), evidenceIds: g.ids });
  }
  return { score: Math.round(sum / n), contributions };
}

/** completeness: can the owner identify and reach the company from the record alone? */
function scoreCompleteness({ org, evidence }) {
  if (!org || typeof org !== "object") return { score: null, contributions: [], unknown: "completitudinea e necunoscută: lipsește fișa firmei" };
  const contacts = arr(org.contacts).filter((c) => c && text(c.value));
  const kind = (c) => String(c.kind || "").toLowerCase();
  const present = {
    name: Boolean(text(org.displayName)),
    fiscalCode: org.fiscalCodeValid === true && Boolean(text(org.fiscalCode)),
    city: Boolean(text(org.city)),
    website: Boolean(text(org.website) || text(org.domain)),
    email: contacts.some((c) => kind(c) === "email"),
    phone: contacts.some((c) => kind(c) === "phone"),
  };
  const anyData = present.name || present.city || present.website || contacts.length > 0 || Boolean(text(org.fiscalCode));
  if (!anyData) return { score: null, contributions: [], unknown: "completitudinea e necunoscută: fișa nu are nicio dată de identificare" };
  const contributions = [];
  let total = 0;
  for (const f of COMPLETENESS_FACTORS) {
    const ok = present[f.key];
    let factor = `${f.label}: ${ok ? "prezent" : "lipsă"}`;
    if (f.key === "fiscalCode" && !ok && text(org.fiscalCode)) factor = org.fiscalCodeValid === false ? "CUI invalid (cifra de control nu se potrivește)" : "CUI nevalidat";
    const points = ok ? f.points : 0;
    total += points;
    contributions.push({ factor, points, evidenceIds: evidenceForClaims(evidence, f.claims) });
  }
  return { score: total, contributions };
}

/** Accepts finite numbers and plain integer strings ("1 250 000"); anything locale-ambiguous ("1.234") is not guessed. */
function parseAmount(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const compact = value.replace(/[\s ]/g, "");
  return /^-?\d+$/.test(compact) ? Number(compact) : null;
}

const sameKey = (a, b) => String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();

/** Like-for-like turnover filter: only the same indicator, period and currency, with a source; otherwise UNKNOWN. */
function evaluateFinancialFilter(financials, filters) {
  const min = filters?.minTurnover;
  if (min === undefined || min === null) return { status: "PASS", reason: "Nu e configurat niciun filtru financiar." };
  if (typeof min !== "object") throw new HubError("validation", "Filtrul minTurnover trebuie să aibă indicator, valoare, monedă și perioadă.");
  const threshold = parseAmount(min.value);
  const indicator = text(min.indicator, 60);
  const currency = text(min.currency, 10).toUpperCase();
  const period = text(min.period, 20);
  if (threshold === null || !indicator || !currency || !period) {
    throw new HubError("validation", "Filtrul minTurnover trebuie să aibă indicator, valoare numerică, monedă și perioadă.");
  }
  const target = `${indicator} ${period} (${currency})`;
  const sameIndicator = financials.filter((f) => f && sameKey(f.indicator, indicator));
  const comparable = sameIndicator.filter((f) => sameKey(f.period, period) && sameKey(f.currency, currency));
  const sourced = comparable.filter((f) => text(f.sourceRef));
  const usable = sourced.map((f) => ({ f, amount: parseAmount(f.value) })).filter((x) => x.amount !== null);
  if (!usable.length) {
    let detail = "nu există date";
    if (sourced.length) detail = "valoarea găsită nu e un număr neambiguu";
    else if (comparable.length) detail = "valoarea găsită nu are sursă";
    else if (sameIndicator.length) {
      const others = [...new Set(sameIndicator.map((f) => `${text(f.period, 20)} ${text(f.currency, 10).toUpperCase()}`.trim()))].slice(0, 5).join(", ");
      detail = `există doar alte perioade sau monede (${others}); nu se convertesc și nu se extrapolează`;
    }
    return { status: "UNKNOWN", reason: `${target}: ${detail}. Firma nu e exclusă.` };
  }
  const outcomes = usable.map(({ f, amount }) => ({ pass: amount >= threshold, amount, source: text(f.sourceRef, 120) }));
  const passes = outcomes.filter((o) => o.pass);
  const fails = outcomes.filter((o) => !o.pass);
  const describe = (o) => `${o.amount} ${currency} (sursa: ${o.source})`;
  if (passes.length && fails.length) {
    return { status: "UNKNOWN", reason: `${target}: sursele se contrazic (${outcomes.map(describe).join("; ")}). Firma nu e exclusă.` };
  }
  if (passes.length) return { status: "PASS", reason: `${target}: ${describe(passes[0])} ≥ pragul de ${threshold} ${currency}.` };
  return { status: "FAIL", reason: `${target}: ${describe(fails[0])} < pragul de ${threshold} ${currency}.` };
}

/**
 * Qualifies one organization. Never throws on missing data (missing data becomes `unknowns`); throws a validation error
 * only for a malformed filter, which is configuration rather than data, or an unknown formula.
 * `formula` is "q-v1" (the default, M04) or "q-v2" (M12: inferences listed, never scored as confirmed evidence).
 * @returns {{ version: string, components: { serviceFit, evidence, completeness }, priority: number|null, unknowns: string[],
 *   explanation: string[], financialFilter: { status: "PASS"|"FAIL"|"UNKNOWN", reason: string }, weightsUsed: object }}
 *   q-v2 adds `inferences: { component, claim, evidenceIds, why, fields? }[]` and `missing: string[]` („ce lipsește”).
 */
export function qualify(input, { formula = QUALIFICATION_FORMULA.version } = {}) {
  if (formula === QUALIFICATION_FORMULA.version) return qualifyV1(input);
  if (formula === QUALIFICATION_FORMULA_V2.version) return qualifyV2(input);
  throw new HubError("validation", `Formulă de calificare necunoscută: ${text(formula, 20) || "(lipsă)"} (cunoscute: ${Object.keys(QUALIFICATION_FORMULAS).join(", ")}).`);
}

function qualifyV1({ org = null, evidence = [], audit = null, opportunities = [], catalog = [], financials = [], filters = {} } = {}) {
  const ev = arr(evidence);
  const scored = {
    serviceFit: scoreServiceFit({ audit, opportunities: arr(opportunities), catalog: arr(catalog), evidence: ev }),
    evidence: scoreEvidence({ evidence: ev }),
    completeness: scoreCompleteness({ org, evidence: ev }),
  };
  const financialFilter = evaluateFinancialFilter(arr(financials), filters || {});
  const components = {};
  const unknowns = [];
  for (const name of COMPONENTS) {
    const { score, contributions, unknown } = scored[name];
    components[name] = { score, contributions };
    if (score === null && unknown) unknowns.push(unknown);
  }
  if (financialFilter.status === "UNKNOWN") unknowns.push(`filtrul financiar: ${financialFilter.reason}`);

  const known = COMPONENTS.filter((name) => components[name].score !== null);
  const weightSum = known.reduce((s, name) => s + QUALIFICATION_FORMULA.weights[name], 0);
  const weightsUsed = {};
  for (const name of known) weightsUsed[name] = QUALIFICATION_FORMULA.weights[name] / weightSum;
  const priority = known.length ? Math.round(known.reduce((s, name) => s + components[name].score * weightsUsed[name], 0)) : null;

  const explanation = [`Formula ${QUALIFICATION_FORMULA.version}: ${COMPONENTS.map((n) => `${COMPONENT_LABEL[n]} ${pct(QUALIFICATION_FORMULA.weights[n])}`).join(", ")}.`];
  for (const name of COMPONENTS) {
    const c = components[name];
    explanation.push(c.score === null ? `${COMPONENT_LABEL[name]}: necunoscută (nu se socotește ca 0).` : `${COMPONENT_LABEL[name]}: ${c.score}/100.`);
  }
  if (known.length && known.length < COMPONENTS.length) {
    explanation.push(`Ponderile au fost renormalizate pe componentele cunoscute: ${known.map((n) => `${COMPONENT_LABEL[n]} ${pct(weightsUsed[n])}`).join(", ")}.`);
  }
  explanation.push(priority === null ? "Prioritate: necunoscută (nicio componentă nu are date)." : `Prioritate: ${priority}/100 (internă; nu e o probabilitate de vânzare).`);
  explanation.push(`Filtru financiar: ${financialFilter.status}. ${financialFilter.reason}`);

  return { version: QUALIFICATION_FORMULA.version, components, priority, unknowns, explanation, financialFilter, weightsUsed };
}

/* ------------------------------------------------------------------ q-v2 */

/** An inference: labelled INFERRED, or declared INFERENCE (C-03 data kind). Either one is never scored as confirmed in q-v2. */
const isInference = (e) => normLabel(e?.label) === "INFERRED" || String(e?.dataKind ?? "").toUpperCase() === "INFERENCE";
/** M12 review R16: a reading labelled UNKNOWN (no verified value, e.g. „neverificat”) is never the evidence a q-v2 point names. */
const isProof = (e) => Boolean(e) && !isInference(e) && normLabel(e.label) !== "UNKNOWN";
/** Keys under which an evidence value object carries a record field (import provenance rows, owner edits, fixture identity). */
const FIELD_VALUE_KEYS = Object.freeze({ name: ["name", "displayName"], fiscalCode: ["fiscalCode", "cui"], city: ["city"], website: ["website", "domain"], email: ["email"], phone: ["phone"] });

/** q-v2 links an audit check to its evidence also through the `audit:<check>` claim the Sales service stores. */
function evidenceForCheckV2(evidence, checkId) {
  if (!checkId) return [];
  const id = String(checkId);
  return evidence.filter((e) => e && e.id && (e.claim === id || e.claim === `audit:${id}` || e.sourceRef === id
    || (typeof e.sourceRef === "string" && (e.sourceRef.endsWith(`#${id}`) || e.sourceRef.endsWith(`:${id}`))))).map((e) => String(e.id));
}

/**
 * Only opportunities the audit OBSERVED score, and only with a recorded evidence row: an inferred one is listed, never counted (and
 * leaves no trace in the components); an observed one without evidence scores 0 and is listed as unproven.
 */
function scoreServiceFitV2({ audit, opportunities, catalog, evidence, inferences, unproven }) {
  const catalogIds = new Set(catalog.filter((s) => s && s.id).map((s) => String(s.id)));
  const byId = new Map(evidence.filter((e) => e && e.id).map((e) => [String(e.id), e]));
  const confirmedIds = (ids) => ids.filter((id) => isProof(byId.get(id)));
  const checks = arr(audit?.checks);
  const observed = checks.filter(isObservedCheck);
  const contributions = [];
  const seen = new Set();
  let total = 0;
  for (const opp of opportunities) {
    if (!opp || typeof opp !== "object") continue;
    const checkId = text(opp.checkId, 80);
    const serviceId = opp.serviceId === null || opp.serviceId === undefined ? "" : String(opp.serviceId);
    const key = `${checkId}|${serviceId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const linked = evidenceForCheckV2(evidence, checkId);
    const what = text(opp.observation, 160) || checkId || "oportunitate";
    if (!checks.some((c) => isObservedCheck(c) && c.status === "ISSUE" && String(c.id) === checkId)) {
      inferences.push({ component: "serviceFit", claim: what, evidenceIds: linked, why: "oportunitate dedusă, neconfirmată de un audit OBSERVED: nu se punctează în q-v2" });
      continue;
    }
    if (!catalogIds.size) continue;
    const evidenceIds = confirmedIds(linked);
    if (!serviceId) { contributions.push({ factor: `${what}: niciun serviciu configurat`, points: 0, evidenceIds }); continue; }
    if (!catalogIds.has(serviceId)) { contributions.push({ factor: `${what}: serviciul ${text(serviceId, 80)} nu există în catalog`, points: 0, evidenceIds }); continue; }
    if (!evidenceIds.length) {
      contributions.push({ factor: `${what} → serviciul ${text(serviceId, 80)} (observat în audit, fără dovadă înregistrată: nu se punctează în q-v2)`, points: 0, evidenceIds });
      unproven.push({ component: "serviceFit", claim: what, why: "observat în audit, dar fără o dovadă înregistrată" });
      continue;
    }
    contributions.push({ factor: `${what} → serviciul ${text(serviceId, 80)} (observat în audit)`, points: FIT_POINTS_OBSERVED, evidenceIds });
    total += FIT_POINTS_OBSERVED;
  }
  if (!catalogIds.size) return { score: null, contributions: [], unknown: "potrivirea cu serviciile e necunoscută: catalogul de servicii e gol" };
  if (!observed.length) return { score: null, contributions: [], unknown: "potrivirea cu serviciile e necunoscută: site-ul nu are un audit cu verificări observate" };
  if (!contributions.length) {
    contributions.push({ factor: `auditul (${observed.length} verificări observate) nu a indicat nevoi acoperite de serviciile configurate`, points: 0, evidenceIds: [] });
  }
  if (total > 100) {
    contributions.push({ factor: "plafonare la 100 de puncte", points: 100 - total, evidenceIds: [] });
    total = 100;
  }
  return { score: total, contributions };
}

/**
 * Completeness with the q-v1 points, but a field scores only when a recorded, non-inference evidence row backs it. A field backed
 * only by inferences reads as absent (and is listed as an inference); a field present without any evidence scores nothing and is
 * listed as unproven. When no field is proven, the component is unknown (never a 0 for unproven data).
 */
function scoreCompletenessV2({ org, evidence, inferences, unproven }) {
  if (!org || typeof org !== "object") return { score: null, contributions: [], unknown: "completitudinea e necunoscută: lipsește fișa firmei" };
  const byId = new Map(evidence.filter((e) => e && e.id).map((e) => [String(e.id), e]));
  const contacts = arr(org.contacts).filter((c) => c && text(c.value));
  const kind = (c) => String(c.kind || "").toLowerCase();
  const backing = (f) => {
    const ids = new Set(evidenceForClaims(evidence, f.claims));
    for (const e of evidence) {
      if (e?.id && e.value && typeof e.value === "object" && !Array.isArray(e.value) && FIELD_VALUE_KEYS[f.key].some((k) => text(e.value[k]))) ids.add(String(e.id));
    }
    if (f.key === "email" || f.key === "phone") for (const c of contacts) if (kind(c) === f.key && c.evidenceId && byId.has(String(c.evidenceId))) ids.add(String(c.evidenceId));
    const all = [...ids];
    return { confirmed: all.filter((id) => isProof(byId.get(id))), inferred: all.filter((id) => isInference(byId.get(id))) };
  };
  const raw = {
    name: Boolean(text(org.displayName)),
    fiscalCode: Boolean(text(org.fiscalCode)),
    city: Boolean(text(org.city)),
    website: Boolean(text(org.website) || text(org.domain)),
    email: contacts.some((c) => kind(c) === "email"),
    phone: contacts.some((c) => kind(c) === "phone"),
  };
  // A value present only because an inference put it there is not a datum of the record: it reads as absent. A value with no
  // evidence at all is unproven: it never scores.
  const links = Object.fromEntries(COMPLETENESS_FACTORS.map((f) => [f.key, backing(f)]));
  const state = Object.fromEntries(COMPLETENESS_FACTORS.map((f) => [f.key, !raw[f.key] ? "absent" : links[f.key].confirmed.length ? "proven"
    : links[f.key].inferred.length ? "inferred" : "unproven"]));
  for (const f of COMPLETENESS_FACTORS) {
    if (state[f.key] === "unproven") unproven.push({ component: "completeness", claim: f.label, why: "prezent în fișă, fără o dovadă înregistrată" });
    if (state[f.key] !== "inferred") continue;
    const ids = links[f.key].inferred;
    const listed = inferences.find((i) => i.component === "evidence" && i.evidenceIds.some((id) => ids.includes(id)));
    if (listed) listed.fields = [...new Set([...(listed.fields || []), f.label])];
    else inferences.push({ component: "completeness", claim: f.label, evidenceIds: ids, why: "câmp susținut doar de inferențe: nu se punctează în q-v2" });
  }
  if (!COMPLETENESS_FACTORS.some((f) => state[f.key] === "proven")) {
    return { score: null, contributions: [], unknown: COMPLETENESS_FACTORS.some((f) => state[f.key] === "unproven")
      ? "completitudinea e necunoscută: datele fișei nu au dovezi înregistrate" : "completitudinea e necunoscută: fișa nu are nicio dată de identificare" };
  }
  const contributions = [];
  let total = 0;
  for (const f of COMPLETENESS_FACTORS) {
    const proven = state[f.key] === "proven";
    const ok = proven && (f.key !== "fiscalCode" || org.fiscalCodeValid === true);
    let factor = `${f.label}: ${ok ? "prezent" : state[f.key] === "unproven" ? "prezent fără dovadă (nu se punctează în q-v2)" : "lipsă"}`;
    if (f.key === "fiscalCode" && proven && !ok) factor = org.fiscalCodeValid === false ? "CUI invalid (cifra de control nu se potrivește)" : "CUI nevalidat";
    const points = ok ? f.points : 0;
    total += points;
    contributions.push({ factor, points, evidenceIds: links[f.key].confirmed });
  }
  return { score: total, contributions };
}

function qualifyV2({ org = null, evidence = [], audit = null, opportunities = [], catalog = [], financials = [], filters = {} } = {}) {
  const ev = arr(evidence);
  const inferences = [];
  const unproven = [];
  // Evidence quality over confirmed readings with an id only (a point always names its evidence). An inferred claim without any
  // confirmed reading is listed for confirmation; a reading without an id is listed as unproven.
  const confirmed = ev.filter((e) => e && typeof e === "object" && !isInference(e) && text(e.id, 80));
  for (const e of ev) {
    if (e && typeof e === "object" && !isInference(e) && !text(e.id, 80) && normLabel(e.label) !== "UNKNOWN") {
      unproven.push({ component: "evidence", claim: text(e.claim, 120) || "dovadă", why: "dovadă fără identificator: nu se punctează în q-v2" });
    }
  }
  const confirmedClaims = new Set(confirmed.filter((e) => normLabel(e.label) !== "UNKNOWN").map((e) => text(e.claim, 120).toLowerCase() || `#${text(e.id, 80)}`));
  for (const e of ev) {
    if (!e || typeof e !== "object" || !isInference(e)) continue;
    const claim = text(e.claim, 120) || `#${text(e.id, 80)}`;
    if (confirmedClaims.has(claim.toLowerCase())) continue;
    const entry = inferences.find((i) => i.component === "evidence" && i.claim.toLowerCase() === claim.toLowerCase());
    if (entry) { if (e.id) entry.evidenceIds.push(String(e.id)); }
    else inferences.push({ component: "evidence", claim, evidenceIds: e.id ? [String(e.id)] : [], why: "inferență (INFERRED): nu se punctează ca dovadă confirmată în q-v2" });
  }
  const scored = {
    serviceFit: scoreServiceFitV2({ audit, opportunities: arr(opportunities), catalog: arr(catalog), evidence: ev, inferences, unproven }),
    evidence: scoreEvidence({ evidence: confirmed }),
    completeness: scoreCompletenessV2({ org, evidence: ev, inferences, unproven }),
  };
  const financialFilter = evaluateFinancialFilter(arr(financials), filters || {});
  const components = {};
  const unknowns = [];
  for (const name of COMPONENTS) {
    const { score, contributions, unknown } = scored[name];
    components[name] = { score, contributions };
    if (score === null && unknown) unknowns.push(unknown);
  }
  if (financialFilter.status === "UNKNOWN") unknowns.push(`filtrul financiar: ${financialFilter.reason}`);

  const weights = QUALIFICATION_FORMULA_V2.weights;
  const known = COMPONENTS.filter((name) => components[name].score !== null);
  const weightSum = known.reduce((s, name) => s + weights[name], 0);
  const weightsUsed = {};
  for (const name of known) weightsUsed[name] = weights[name] / weightSum;
  const priority = known.length ? Math.round(known.reduce((s, name) => s + components[name].score * weightsUsed[name], 0)) : null;

  const explanation = [`Formula ${QUALIFICATION_FORMULA_V2.version}: ${COMPONENTS.map((n) => `${COMPONENT_LABEL[n]} ${pct(weights[n])}`).join(", ")}; un punct se acordă doar cu o dovadă înregistrată care nu e inferență.`];
  for (const name of COMPONENTS) {
    const c = components[name];
    explanation.push(c.score === null ? `${COMPONENT_LABEL[name]}: necunoscută (nu se socotește ca 0).` : `${COMPONENT_LABEL[name]}: ${c.score}/100.`);
  }
  if (known.length && known.length < COMPONENTS.length) {
    explanation.push(`Ponderile au fost renormalizate pe componentele cunoscute: ${known.map((n) => `${COMPONENT_LABEL[n]} ${pct(weightsUsed[n])}`).join(", ")}.`);
  }
  explanation.push(priority === null ? "Prioritate: necunoscută (nicio componentă nu are date)." : `Prioritate: ${priority}/100 (internă; nu e o probabilitate de vânzare).`);
  explanation.push(`Filtru financiar: ${financialFilter.status}. ${financialFilter.reason}`);
  const describe = (i) => `${i.claim}${i.fields?.length ? ` (${i.fields.join(", ")})` : ""}`;
  if (inferences.length) explanation.push(`Inferențe (nu se punctează în q-v2): ${inferences.length} — ${inferences.slice(0, 5).map(describe).join("; ")}${inferences.length > 5 ? "; …" : ""}.`);
  if (unproven.length) explanation.push(`Fără dovadă înregistrată (nu se punctează în q-v2): ${unproven.length} — ${unproven.slice(0, 5).map((u) => u.claim).join("; ")}${unproven.length > 5 ? "; …" : ""}.`);
  const missing = [...unknowns, ...inferences.map((i) => `de confirmat: ${describe(i)}`), ...unproven.map((u) => `fără dovadă: ${u.claim}`)];

  return { version: QUALIFICATION_FORMULA_V2.version, components, priority, unknowns, explanation, financialFilter, weightsUsed, inferences, unproven, missing };
}

/**
 * Owner override of the computed priority. The reason is mandatory and every override is kept: the result returned carries
 * the full `overrides` history and the original `computedPriority`, so an override never hides what the formula said.
 * Does not mutate `result`.
 */
export function applyOverride(result, { priority, reason, actor, at } = {}) {
  if (!result || typeof result !== "object") throw new HubError("validation", "Lipsește rezultatul calificării de modificat.");
  const why = text(reason, OVERRIDE_REASON_MAX);
  if (why.length < OVERRIDE_REASON_MIN) throw new HubError("validation", `Motivul modificării e obligatoriu (cel puțin ${OVERRIDE_REASON_MIN} caractere).`);
  if (typeof priority !== "number" || !Number.isFinite(priority) || priority < 0 || priority > 100) {
    throw new HubError("validation", "Prioritatea modificată trebuie să fie un număr între 0 și 100.");
  }
  let when = at;
  if (when === undefined || when === null || when === "") when = new Date().toISOString();
  else if (Number.isNaN(Date.parse(String(when)))) throw new HubError("validation", "Data modificării (at) nu e validă.");
  const entry = {
    priority: Math.round(priority),
    previousPriority: result.priority ?? null,
    reason: why,
    actor: text(actor, 80) || null,
    at: String(when),
  };
  const overrides = [...arr(result.overrides), entry];
  const explanation = [...arr(result.explanation), `Prioritate modificată manual: ${entry.previousPriority ?? "necunoscută"} → ${entry.priority}${entry.actor ? ` (${entry.actor})` : ""}. Motiv: ${entry.reason}`];
  return {
    ...result,
    computedPriority: Object.hasOwn(result, "computedPriority") ? result.computedPriority : (result.priority ?? null),
    priority: entry.priority,
    override: entry,
    overrides,
    explanation,
  };
}
