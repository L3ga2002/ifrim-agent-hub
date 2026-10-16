import { claimState } from "./presentation.mjs";
import { citedCriteria, PASS_BY_METHOD } from "../media/claims.mjs";
// M11 „Ifrim Delivery” — the commercial summary (pure, deterministic: no model, no clock, no network; `generatedAt` is passed in).
//
// It answers, for a conversation with a possible client (owner's brief §21): the problem, what the demo shows, how it works, the
// benefits we may state, what we may NOT state, the questions for the client and the next step; then the video files, price/term
// and the traceability of the verified package. Every sentence is fixed template text or a value with provenance:
//   - a criterion appears under „Ce demonstrăm” only with PASS evidence, and says how it was verified;
//   - a benefit or the flow description is shown only when every criterion it is gated on passed;
//   - price and term come only from a CONFIGURED catalog service, otherwise „De stabilit (neconfigurat)”;
//   - the fact guard refuses prices, percentages, deadlines and dates in template lines (an owner's own edit is kept, but listed in
//     claimsToVerify as stated by the owner).
// Versions: render() is v1; edit() is the owner's version (auto sections refused); regenerate() replaces only what its change touched.
import { hashCanonical } from "../core/canonical.mjs";
import { HubError } from "../core/errors.mjs";
import { NOT_CONFIGURED, clean, priceText, leadTimeText, materialLines, findUnresolvedPlaceholders } from "../sales/proposal.mjs";
import { SUMMARY_SECTIONS } from "./revision.mjs";

export const SUMMARY_TEMPLATE_ID = "commercial-summary-v2";
export const SUMMARY_LIMITS = Object.freeze({ sectionChars: 4000, lineChars: 240 });
const SECTION = Object.fromEntries(SUMMARY_SECTIONS.map((s) => [s.id, s]));
const AUTO = new Set(SUMMARY_SECTIONS.filter((s) => s.auto).map((s) => s.id));
/** What each section is built from: a change of that basis regenerates exactly these sections. */
export const SECTION_BASIS = Object.freeze({
  problem: "software", demonstrated: "software", how: "software", benefits: "software", cannot_claim: "software", questions: "template",
  next_step: "template", video: "media", price_terms: "services", provenance: "software",
});
const PASS = (c) => PASS_BY_METHOD[c?.verify]?.includes(c.status) === true;
export const SECTION_BASES = Object.freeze(Object.fromEntries(Object.entries(SECTION_BASIS).map(([k, v]) => [k, Object.freeze([v, ...(["software", "template"].includes(v) ? ["claims"] : [])])])));
const bullets = (lines) => lines.map((l) => `- ${l}`).join("\n");
const fallbackText = (value, max = 200) => { const s = String(value || '').trim(); if (s.length <= max) return s; const cut = s.slice(0, max + 1).lastIndexOf(' '); return s.slice(0, cut > 0 ? cut : max).trimEnd() + '…'; };

// ---------- fact guard ----------
const FACT_PATTERNS = Object.freeze([
  { code: "PRICE", re: /\b\d+(?:[.,]\d+)?\s?(?:lei|ron|eur|euro|usd)\b|[€$£]\s?\d|\b(?:lei|ron|eur)\s?\d/i, text: "un preț" },
  { code: "PERCENT", re: /\d+(?:[.,]\d+)?\s?%|\bla sut[aă]\b/i, text: "un procent" },
  { code: "DEADLINE", re: /(?:^|[\s,(])în\s+\d+\s+(?:de\s+)?(?:zile|zi|săptămâni|săptămână|luni|lună|ore)(?![\p{L}])|(?:^|[\s,(])până\s+(?:la|pe|în)\s+\d|\bgarant\p{L}*/iu, text: "un termen sau o garanție" },
  { code: "DATE", re: /\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\s+(?:ianuarie|februarie|martie|aprilie|mai|iunie|iulie|august|septembrie|octombrie|noiembrie|decembrie)\b/i, text: "o dată calendaristică" },
  { code: "ROI", re: /\b(?:roi|profit|venit(?:uri)?\s+(?:în\s+plus|mai\s+mari)|clienți\s+noi\s+garantați|creștere\s+de)\b/i, text: "un rezultat de business nemăsurat" },
]);
/** The invented-fact kinds in a line ([] = clean). */
export function factsIn(line) {
  const s = String(line ?? "");
  return FACT_PATTERNS.filter((p) => p.re.test(s)).map((p) => ({ code: p.code, text: p.text }));
}
/** Refuses a template line that states a price, percentage, deadline, date or business result it has no source for. */
export function assertNoInventedFacts(line, where = "rezumat") {
  const found = factsIn(line);
  if (found.length) throw new HubError("validation", `Textul generat (${where}) ar afirma ${found.map((f) => f.text).join(", ")} fără o sursă configurată`, { data: { code: "SUMMARY_INVENTED_FACT", facts: found.map((f) => f.code) } });
  return line;
}

// ---------- the delivery block's summary part ----------
/**
 * The `summary` part of a fixture's delivery block, normalized: problem (the business problem, one line), how (the flow in plain words,
 * gated on its criteria), benefits [{ text, criteria }] and questions. Template text only: the fact guard runs here, so an invented
 * price or result in a fixture definition is refused before it can reach a client document.
 */
export function normalizeSummaryBlock(input, criteriaIds = []) {
  const problems = [];
  const known = new Set(criteriaIds.map((c) => String(c).toUpperCase()));
  const line = (v, where, max = SUMMARY_LIMITS.lineChars) => {
    const t = clean(v, max);
    if (!t) { problems.push(`${where}: text lipsă`); return null; }
    if (factsIn(t).length) { problems.push(`${where}: textul afirmă ${factsIn(t).map((f) => f.text).join(", ")} fără sursă`); return null; }
    return t;
  };
  const gate = (list, where) => {
    const ids = Array.isArray(list) ? list.map((c) => String(c).toUpperCase()) : [];
    if (!ids.length) problems.push(`${where}: cel puțin un criteriu (AC-n) de care depinde`);
    for (const id of ids) if (known.size && !known.has(id)) problems.push(`${where}: criteriul ${id} nu există în specificație`);
    return ids;
  };
  if (!input || typeof input !== "object") return { summary: null, problems: [] };
  const summary = {
    problem: input.problem === undefined ? null : line(input.problem, "summary.problem"),
    how: Array.isArray(input.how?.lines) ? { lines: input.how.lines.map((l, i) => line(l, `summary.how.lines[${i}]`)).filter(Boolean), criteria: gate(input.how.criteria, "summary.how.criteria") } : null,
    benefits: (Array.isArray(input.benefits) ? input.benefits : []).map((b, i) => ({ text: line(b?.text, `summary.benefits[${i}].text`), criteria: gate(b?.criteria, `summary.benefits[${i}].criteria`) })).filter((b) => b.text),
    // What the demo shows, in a client's words (each line gated on its criteria, like a benefit); the spec's technical criteria then
    // stay in „Trasabilitate”. Without it, the spec lines are shown (the earlier behaviour).
    demonstrates: (Array.isArray(input.demonstrates) ? input.demonstrates : []).map((b, i) => ({ text: line(b?.text, `summary.demonstrates[${i}].text`), criteria: gate(b?.criteria, `summary.demonstrates[${i}].criteria`) })).filter((b) => b.text),
    questions: (Array.isArray(input.questions) ? input.questions : []).map((q, i) => line(q, `summary.questions[${i}]`)).filter(Boolean),
  };
  if (summary.questions.length > 8) problems.push("summary.questions: cel mult 8 întrebări");
  return { summary, problems };
}

// ---------- rendering ----------
const DEFAULT_QUESTIONS = Object.freeze([
  "Ce problemă vreți să rezolvați mai întâi?",
  "Cine ar folosi zilnic sistemul și de pe ce dispozitiv?",
  "Ce date trebuie păstrate și cine are acces la ele?",
]);
const NEXT_STEP = "O discuție scurtă în care stabilim ce vă este util; oferta finală vine după.";
const FIXED_CANNOT = Object.freeze([
  "Rezultate de business (venituri, clienți noi, timp economisit): nu le-am măsurat.",
  "Niciun client real nu a folosit demo-ul: datele sunt sintetice.",
  "Verificarea pe telefon înseamnă lățimea unui telefon (390 px) în Chromium, fără telefoane reale sau atingere.",
]);

/** How one passed criterion was verified, in the owner's words. */
function verifiedHow(c) {
  if (c.verify === "test") return `prin test automat (${c.id})`;
  if (c.verify === "review") return `prin review independent (${c.id})`;
  if (c.verify === "preview") return `prin preview local pornit din versiunea verificată (${c.id})`;
  if (c.verify === "e2e") {
    const vp = (Array.isArray(c.steps) ? c.steps : []).find((s) => s && s.viewport)?.viewport;
    if (vp && vp.width <= 480) return `în browser, la lățimea unui telefon (${vp.width} px, Chromium) (${c.id})`;
    return `în browser${vp ? ` pe desktop (${vp.width}×${vp.height})` : ""} (${c.id})`;
  }
  return c.id;
}
const fmtDuration = (ms) => { const s = Math.max(0, Math.round(Number(ms) / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const ROLE_LABEL = { master: "Clip 16:9", vertical: "Variantă verticală 9:16" };

/**
 * The summary of one delivery from its verified facts.
 * @param {{ projectName: string, synthetic: boolean, simulation: boolean, manifest: object, bundleId: string, bundleSha: string,
 *   issue?: string|null, block?: object|null, media?: Array<{ id, role, file, durationMs, label, qa }>, services?: Array, owner?: object,
 *   generatedAt: string }} input
 */
export function renderSummary(input) {
  const { projectName = "", synthetic = true, simulation = false, manifest = {}, bundleId = "", bundleSha = "", issue = null, presentation = null, proofs = {}, media = [], services = [], owner = {}, generatedAt } = input || {};
  if (!generatedAt) throw new HubError("validation", "Rezumatul are nevoie de momentul generării (generatedAt)");
  const states = (presentation?.claims || []).map(c => ({ ...c, result: claimState(c, proofs) }));
  const shownClaim = key => states.find(c => c.key === key && c.result.shown);
  const group = prefix => states.filter(c => c.key.startsWith(prefix) && c.result.shown).map(c => ({ text: c.texts.text, criteria: c.needs.map(n => n.id) }));
  const pc = shownClaim("summary.problem"), hc = shownClaim("summary.how");
  const suffix = c => " (verificat: " + c.needs.map(n => n.id).join(", ") + ")";
  // The original booking story keeps its established problem/flow wording byte for byte.
  const compat = presentation?.key === "booking-mobile-fix";
  const block = presentation ? { summary: { problem: pc ? pc.texts.text + (compat ? "" : suffix(pc)) : null,
    demonstrates: group("summary.demonstrates."), benefits: group("summary.benefits."),
    how: hc ? { criteria: hc.needs.map(n => n.id), lines: hc.texts.lines.map(t => t + (compat ? "" : suffix(hc))) } : null,
    questions: presentation.questions } } : input?.block;
  const criteria = Array.isArray(manifest.spec?.criteria) ? manifest.spec.criteria : [];
  const passes = c => presentation ? proofs[c.id]?.ok === true : PASS(c);
  const passed = new Set(criteria.filter(passes).map((c) => c.id));
  const allPass = (ids) => ids.length > 0 && ids.every((id) => passed.has(id));
  const claims = [];
  const warnings = [];
  const sections = {};
  const tpl = (id, text) => { sections[id] = { id, heading: SECTION[id].heading, text, source: "template", auto: AUTO.has(id) }; };

  // Problem: the business problem of the block, else the agreed issue; the approved objective as the detail.
  const problemLine = pc ? block.summary.problem : clean(block?.summary?.problem || issue || manifest.mission?.title, 240);
  tpl("problem", [problemLine, "Demo local pentru prezentare, cu date sintetice; nu este un sistem în producție."].filter(Boolean).map((l) => assertNoInventedFacts(l, "problema")).join("\n"));

  const passLines = criteria.filter(passes).map((c) => `${presentation ? fallbackText(c.text) : clean(c.text, 200)}: verificat ${verifiedHow(c)}.`);
  const shown = (block?.summary?.demonstrates || []).filter((b) => allPass(b.criteria)).map((b) => `${assertNoInventedFacts(b.text, "ce demonstrăm")} (verificat: ${b.criteria.join(", ")})`);
  if (shown.length) tpl("demonstrated", `${bullets(shown)}\n\nVerificări tehnice trecute: ${passLines.length} din ${criteria.length} (lista e în „Trasabilitate”).`);
  else tpl("demonstrated", presentation?.status === "CURATED" ? "Nimic nu este încă verificat în această versiune." : passLines.length ? bullets(passLines) : "Nimic nu este încă verificat în această versiune.");

  const how = block?.summary?.how;
  if (how?.lines?.length && allPass(how.criteria)) tpl("how", bullets(how.lines.map((l) => assertNoInventedFacts(l, "cum funcționează"))));
  else tpl("how", how?.lines?.length ? `Fluxul nu e verificat cap-coadă în această versiune (${how.criteria.filter((id) => !passed.has(id)).join(", ")} nu au trecut).` : "Fluxul se descrie după prezentare, pe baza demo-ului.");

  const benefits = (block?.summary?.benefits || []).filter((b) => allPass(b.criteria)).map((b) => `${assertNoInventedFacts(b.text, "beneficii")} (dovadă: ${b.criteria.join(", ")})`);
  tpl("benefits", benefits.length ? bullets(benefits) : presentation && passed.size ? "Nicio afirmație curată nu se aplică acestei specificații; criteriile trecute sunt în „Ce demonstrăm” și „Trasabilitate”." : "Niciun beneficiu nu poate fi afirmat încă: criteriile lui nu au trecut.");

  const notPassed = criteria.filter((c) => !passes(c)).map((c) => `${c.id} ${clean(c.text, 160)}: ${c.status}${c.note ? ` (${clean(c.note, 120)})` : ""}`);
  for (const l of notPassed) claims.push(l);
  const priceConfigured = services.some((s) => priceText(s));
  const omitted = states.filter(c => c.key.startsWith("summary.") && !c.result.shown).map(c => `Nu afirmăm: «${c.texts.text || c.texts.lines?.join(" ") || ""}» — ${c.result.plain}`);
  const cannot = [...omitted, ...(presentation?.limits || []), ...notPassed.map((l) => `Nu afirmăm: ${l}`), ...FIXED_CANNOT, ...(priceConfigured ? [] : ["Preț și termen: nu sunt configurate în catalog, deci nu le afirmăm."]),
    ...(simulation ? ["SIMULARE: probă cu provideri fixture; nu arată calitatea unui model."] : [])];
  tpl("cannot_claim", bullets(cannot));

  const questions = (block?.summary?.questions?.length ? block.summary.questions : DEFAULT_QUESTIONS).map((q) => assertNoInventedFacts(q, "întrebări"));
  tpl("questions", bullets(questions));
  tpl("next_step", NEXT_STEP);
  sections.video = videoSection(media);

  const priceLines = [];
  for (const s of services) {
    const name = clean(s?.name, 120) || clean(s?.id, 80);
    const price = priceText(s); const lead = leadTimeText(s);
    if (!price) warnings.push(`Prețul serviciului ${name} nu e configurat.`);
    if (!lead) warnings.push(`Termenul serviciului ${name} nu e configurat.`);
    priceLines.push(`${name}: preț ${price || NOT_CONFIGURED}; termen ${lead || NOT_CONFIGURED}`);
  }
  sections.price_terms = { id: "price_terms", heading: SECTION.price_terms.heading, text: priceLines.length ? bullets(priceLines) : `Preț: ${NOT_CONFIGURED}. Termen: ${NOT_CONFIGURED}.`, source: priceLines.length ? "catalog" : "template", auto: false };
  if (!services.length) warnings.push("Prețul și termenul nu sunt configurate (catalogul de servicii nu are un serviciu legat de această livrare).");

  const cs = manifest.changeSet || {};
  const files = (cs.files || []).map((f) => clean(f.path, 120)).filter(Boolean);
  sections.provenance = { id: "provenance", heading: SECTION.provenance.heading, source: "bundle", auto: true,
    text: bullets([`Pachet verificat ${clean(bundleId, 60)} (${String(bundleSha).slice(0, 12)})`, `Set de modificări ${String(cs.sha256 || "").slice(0, 12)}, snapshot ${String(cs.snapshot || "").slice(0, 12)}${files.length ? `; fișiere: ${files.join(", ")}` : ""}`,
      `Specificația v${manifest.spec?.version ?? "?"}`, ...((shown.length || presentation) ? criteria.map((c) => `${c.id} ${clean(c.text, 200)}: ${c.status}${PASS(c) ? ` (verificat ${verifiedHow(c)})` : ""}`) : []), `Generat ${generatedAt}`]) };

  const materials = materialLines(owner);
  for (const m of materials) claims.push(`Material de prezentare: ${m}`);
  if (!clean(owner?.companyName, 160)) warnings.push("Numele firmei tale (owner.companyName) nu e configurat.");
  if (synthetic) warnings.push("Date sintetice: demo-ul nu conține date de clienți.");

  const ordered = SUMMARY_SECTIONS.map((s) => sections[s.id]);
  const title = `${simulation ? "[SIMULARE] " : ""}${synthetic ? "[DATE SINTETICE] " : ""}Rezumat: ${clean(projectName, 120)}`;
  const basis = basisOf({ manifest, bundleSha, media, services, owner, presentation, states });
  return finish({ title, sections: ordered, claimsToVerify: claims, warnings, basis, authorKind: "template" });
}

function videoSection(media) {
  const current = (Array.isArray(media) ? media : []).filter((m) => m && m.role && m.file);
  const lines = current.map((m) => `${ROLE_LABEL[m.role] || clean(m.role, 40)}: ${clean(m.file, 160)}, ${fmtDuration(m.durationMs)}, ${m.label === "SIMULARE" ? "SIMULARE" : "ÎNREGISTRARE ORIGINALĂ a demo-ului local"}, QA: ${clean(m.qa || "neverificat", 30)}`);
  return { id: "video", heading: SECTION.video.heading, text: lines.length ? bullets(lines) : "Clipurile nu sunt gata încă.", source: "media", auto: true };
}

function basisOf({ manifest, bundleSha, media, services, owner, presentation, states = [] }) {
  return {
    ...(presentation ? { claims: { key: presentation.key, status: presentation.status, catalogSha: presentation.catalogSha, specSha: presentation.specSha, shown: states.filter(c => c.result.shown).map(c => ({ key: c.key, ids: c.needs.map(n => n.id), fps: c.needs.map(n => n.fp) })), omitted: states.filter(c => !c.result.shown).map(c => ({ key: c.key, code: c.result.code })) }, ...(presentation.origin ? { origin: presentation.origin } : {}) } : {}),
    software: { bundleSha: String(bundleSha || ""), criteria: (manifest.spec?.criteria || []).map((c) => ({ id: c.id, status: c.status })) },
    media: (media || []).filter((m) => m?.id).map((m) => ({ id: m.id, role: m.role, qa: m.qa || null })),
    services: (services || []).filter((s) => s?.id).map((s) => `${s.id}@${s.version ?? 1}`),
    owner: hashCanonical({ companyName: owner?.companyName || null, signatureName: owner?.signatureName || null, materials: owner?.materials || [] }).slice(0, 16),
  };
}

function finish({ title, sections, claimsToVerify, warnings, basis, authorKind }) {
  const text = [title, ...sections.map((s) => `${s.heading}\n${s.text}`)].join("\n\n");
  const leftovers = findUnresolvedPlaceholders(text);
  const allWarnings = [...warnings];
  if (leftovers.length) allWarnings.push(`Textul conține câmpuri nerezolvate: ${leftovers.join(", ")}.`);
  return { template: SUMMARY_TEMPLATE_ID, title, sections, text, contentSha: hashCanonical({ title, sections: sections.map(({ id, text: t }) => ({ id, text: t })) }),
    claimsToVerify: [...new Set(claimsToVerify)], warnings: [...new Set(allWarnings)], basis, basisSha: hashCanonical(basis), authorKind };
}

/**
 * The owner's version: `edits` [{ id, text }] replace editable sections; a generated section (video, provenance) is refused, as are an
 * empty text, a leftover placeholder or more than 4000 characters. Facts the owner states (a price, a deadline) are kept — they are the
 * owner's — and listed in claimsToVerify as „afirmat de tine”.
 */
export function editSummary(prev, edits) {
  if (!prev?.sections) throw new HubError("validation", "Nu există o versiune a rezumatului de editat");
  const list = Array.isArray(edits) ? edits : [];
  if (!list.length) throw new HubError("validation", "Nicio secțiune de schimbat");
  const byId = new Map(prev.sections.map((s) => [s.id, { ...s }]));
  const claims = [...(prev.claimsToVerify || [])];
  for (const e of list) {
    const id = String(e?.id || "");
    if (!byId.has(id)) throw new HubError("validation", `Secțiune necunoscută „${id.slice(0, 40)}”`, { data: { code: "SUMMARY_SECTION_UNKNOWN" } });
    if (AUTO.has(id)) throw new HubError("validation", `„${SECTION[id].heading}” se generează din faptele livrării și nu se editează de mână`, { data: { code: "SUMMARY_SECTION_AUTO" } });
    const text = String(e?.text ?? "").replace(/\r\n/g, "\n").trim();
    if (!text) throw new HubError("validation", `Textul pentru „${SECTION[id].heading}” e gol`);
    if (text.length > SUMMARY_LIMITS.sectionChars) throw new HubError("validation", `„${SECTION[id].heading}”: cel mult ${SUMMARY_LIMITS.sectionChars} de caractere`);
    const left = findUnresolvedPlaceholders(text);
    if (left.length) throw new HubError("validation", `„${SECTION[id].heading}” conține câmpuri nerezolvate: ${left.join(", ")}`, { data: { code: "SUMMARY_PLACEHOLDER" } });
    for (const f of factsIn(text)) claims.push(`Afirmat de tine în „${SECTION[id].heading}”: ${f.text}`);
    byId.set(id, { ...byId.get(id), text, source: "owner", needsReview: false, reviewReason: null });
  }
  const sections = SUMMARY_SECTIONS.map((s) => byId.get(s.id));
  const authorKind = sections.every((s) => s.source === "owner" || s.auto) ? "owner" : sections.some((s) => s.source === "owner") ? "mixed" : "template";
  return finish({ title: prev.title, sections, claimsToVerify: claimsOf(sections, claims), warnings: prev.warnings || [], basis: prev.basis, authorKind });
}

/**
 * A new version after a change of one basis: `fresh` is renderSummary() on the new facts. Only the sections built from the changed basis
 * are replaced; an owner-written section on a changed basis keeps its text and is flagged needsReview (its facts may no longer hold).
 * @param {"software"|"media"|"services"} changed
 */
export function claimsOf(sections, templateClaims = []) {
  return [...templateClaims.filter(t => !t.startsWith("Afirmat de tine") && !t.startsWith("De revăzut:")),
    ...sections.filter(s => s.source === "owner").flatMap(s => factsIn(s.text).map(f => "Afirmat de tine în „" + s.heading + "”: " + f.text)),
    ...sections.filter(s => s.needsReview).map(s => "De revăzut: „" + s.heading + "” (faptele s-au schimbat după editarea ta)")];
}
export function regenerateSummary(prev, fresh, changed) {
  const changes = Array.isArray(changed) ? changed : [changed];
  if (changes.some(c => !["software", "media", "services", "claims", "template"].includes(c))) throw new HubError("validation", "Schimbare necunoscută");
  const old = new Map((prev?.sections || []).map(s => [s.id, s]));
  const sections = fresh.sections.map(s => {
    const before = old.get(s.id);
    if (!before) return s;
    if (!SECTION_BASES[s.id].some(b => changes.includes(b))) return before;
    return before.source === "owner" ? { ...before, needsReview: true, reviewReason: "Baza secțiunii s-a schimbat: " + changes.filter(c => SECTION_BASES[s.id].includes(c)).join(", ") } : s;
  });
  const authorKind = sections.some(s => s.source === "owner") ? (sections.every(s => s.source === "owner" || s.auto) ? "owner" : "mixed") : "template";
  const basis = { ...prev.basis, ...Object.fromEntries(changes.filter(c => fresh.basis[c] !== undefined).map(c => [c, fresh.basis[c]])) };
  if (fresh.basis.origin) basis.origin = fresh.basis.origin;
  return finish({ title: fresh.title, sections, claimsToVerify: claimsOf(sections, changes.includes("software") || changes.includes("claims") ? fresh.claimsToVerify : prev.claimsToVerify || []), warnings: fresh.warnings, basis, authorKind });
}

/** Deterministic citation check; owner sections remain explicitly owner-authored. */
export function summaryFactCheck({ doc, presentation, proofs = {}, spec }) {
  const allowed = new Map(["problem", "demonstrated", "how", "benefits"].map(k => [k, new Set()]));
  for (const c of presentation?.claims || []) {
    if (!claimState(c, proofs).shown || !c.key.startsWith("summary.")) continue;
    const part = c.key.split(".")[1], section = part === "demonstrates" ? "demonstrated" : part;
    if (!allowed.has(section)) continue;
    const ids = c.needs.map(n => n.id).join(", ");
    for (const text of c.texts.lines || [c.texts.text]) {
      for (const suffix of [" (verificat: " + ids + ")", " (dovadă: " + ids + ")"]) allowed.get(section).add(text + suffix);
      if (presentation.key === "booking-mobile-fix" && ["problem", "how"].includes(section)) allowed.get(section).add(text);
    }
  }
  if (presentation?.status === "GENERATED") for (const c of spec?.acceptance || []) if (proofs[c.id]?.ok) allowed.get("demonstrated").add(fallbackText(c.text) + ": verificat " + verifiedHow(c) + ".");
  // Fixed template prose is allowed by exact line; arbitrary claimless prose is not evidence.
  const criteria = spec?.acceptance || [];
  const generated = presentation ? renderSummary({ presentation, proofs, manifest: { spec: { criteria: criteria.map(c => ({ ...c, status: proofs[c.id]?.status || 'UNKNOWN' })) } }, issue: spec?.title, generatedAt: 'fact-check' }) : null;
  const fixed = new Map((generated?.sections || []).map(s => [s.id, new Set(s.text.split('\n').map(t => t.replace(/^- /, '').trim()).filter(Boolean))]));
  const findings = [];
  for (const section of doc.sections || []) {
    if (!allowed.has(section.id) || section.source === "owner") continue;
    for (const line of section.text.split("\n").map(t => t.replace(/^- /, "").trim()).filter(Boolean)) {
      if (citedCriteria(line).length && !allowed.get(section.id).has(line)) findings.push({ code: "SUMMARY_CITATION_UNBOUND", sectionId: section.id, text: line, ids: citedCriteria(line) });
      if (presentation && !allowed.get(section.id).has(line) && !fixed.get(section.id)?.has(line)) findings.push({ code: section.id === 'problem' ? 'NARRATIVE_FROM_OTHER_SPEC' : 'SUMMARY_LINE_NOT_CURATED', sectionId: section.id, text: line, ids: citedCriteria(line) });
    }
  }
  return { status: findings.length ? "FAIL" : "PASS", findings };
}

// ---------- export ----------
export function toMarkdown(doc) {
  return `# ${doc.title}\n\n${doc.sections.map((s) => `## ${s.heading}\n\n${s.text}`).join("\n\n")}\n`;
}
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
/** A self-contained, escaped HTML page (no script, no external resource). */
export function toHtml(doc) {
  const body = doc.sections.map((s) => {
    const lines = s.text.split("\n");
    const list = lines.every((l) => l.startsWith("- "));
    return `<h2>${esc(s.heading)}</h2>\n${list ? `<ul>${lines.map((l) => `<li>${esc(l.slice(2))}</li>`).join("")}</ul>` : lines.map((l) => `<p>${esc(l)}</p>`).join("\n")}`;
  }).join("\n");
  return `<!doctype html>\n<html lang="ro"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(doc.title)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:46rem;margin:2rem auto;padding:0 1rem;line-height:1.5;color:#1d1d1f}h1{font-size:1.5rem}h2{font-size:1.1rem;margin-top:1.6rem}</style></head>
<body><h1>${esc(doc.title)}</h1>\n${body}\n</body></html>\n`;
}
