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
const PASS = (c) => typeof c?.status === "string" && c.status.startsWith("PASS");
const bullets = (lines) => lines.map((l) => `- ${l}`).join("\n");

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
  if (c.verify === "test") return `test automat (${c.id})`;
  if (c.verify === "review") return `review independent (${c.id})`;
  if (c.verify === "preview") return `preview local pornit din versiunea verificată (${c.id})`;
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
  const { projectName = "", synthetic = true, simulation = false, manifest = {}, bundleId = "", bundleSha = "", issue = null, block = null, media = [], services = [], owner = {}, generatedAt } = input || {};
  if (!generatedAt) throw new HubError("validation", "Rezumatul are nevoie de momentul generării (generatedAt)");
  const criteria = Array.isArray(manifest.spec?.criteria) ? manifest.spec.criteria : [];
  const passed = new Set(criteria.filter(PASS).map((c) => c.id));
  const allPass = (ids) => ids.length > 0 && ids.every((id) => passed.has(id));
  const claims = [];
  const warnings = [];
  const sections = {};
  const tpl = (id, text) => { sections[id] = { id, heading: SECTION[id].heading, text, source: "template", auto: AUTO.has(id) }; };

  // Problem: the business problem of the block, else the agreed issue; the approved objective as the detail.
  const problemLine = clean(block?.summary?.problem || issue || manifest.mission?.title, 240);
  tpl("problem", [problemLine, "Demo local pentru prezentare, cu date sintetice; nu este un sistem în producție."].filter(Boolean).map((l) => assertNoInventedFacts(l, "problema")).join("\n"));

  const passLines = criteria.filter(PASS).map((c) => `${clean(c.text, 200)}: verificat ${verifiedHow(c)}.`);
  tpl("demonstrated", passLines.length ? bullets(passLines) : "Nimic nu este încă verificat în această versiune.");

  const how = block?.summary?.how;
  if (how?.lines?.length && allPass(how.criteria)) tpl("how", bullets(how.lines.map((l) => assertNoInventedFacts(l, "cum funcționează"))));
  else tpl("how", how?.lines?.length ? `Fluxul nu e verificat cap-coadă în această versiune (${how.criteria.filter((id) => !passed.has(id)).join(", ")} nu au trecut).` : "Fluxul se descrie după prezentare, pe baza demo-ului.");

  const benefits = (block?.summary?.benefits || []).filter((b) => allPass(b.criteria)).map((b) => `${assertNoInventedFacts(b.text, "beneficii")} (dovadă: ${b.criteria.join(", ")})`);
  tpl("benefits", benefits.length ? bullets(benefits) : "Niciun beneficiu nu poate fi afirmat încă: criteriile lui nu au trecut.");

  const notPassed = criteria.filter((c) => !PASS(c)).map((c) => `${c.id} ${clean(c.text, 160)}: ${c.status}${c.note ? ` (${clean(c.note, 120)})` : ""}`);
  for (const l of notPassed) claims.push(l);
  const priceConfigured = services.some((s) => priceText(s));
  const cannot = [...notPassed.map((l) => `Nu afirmăm: ${l}`), ...FIXED_CANNOT, ...(priceConfigured ? [] : ["Preț și termen: nu sunt configurate în catalog, deci nu le afirmăm."]),
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
      `Specificația v${manifest.spec?.version ?? "?"}`, `Generat ${generatedAt}`]) };

  const materials = materialLines(owner);
  for (const m of materials) claims.push(`Material de prezentare: ${m}`);
  if (!clean(owner?.companyName, 160)) warnings.push("Numele firmei tale (owner.companyName) nu e configurat.");
  if (synthetic) warnings.push("Date sintetice: demo-ul nu conține date de clienți.");

  const ordered = SUMMARY_SECTIONS.map((s) => sections[s.id]);
  const title = `${simulation ? "[SIMULARE] " : ""}${synthetic ? "[DATE SINTETICE] " : ""}Rezumat: ${clean(projectName, 120)}`;
  const basis = basisOf({ manifest, bundleSha, media, services, owner });
  return finish({ title, sections: ordered, claimsToVerify: claims, warnings, basis, authorKind: "template" });
}

function videoSection(media) {
  const current = (Array.isArray(media) ? media : []).filter((m) => m && m.role && m.file);
  const lines = current.map((m) => `${ROLE_LABEL[m.role] || clean(m.role, 40)}: ${clean(m.file, 160)}, ${fmtDuration(m.durationMs)}, ${m.label === "SIMULARE" ? "SIMULARE" : "ÎNREGISTRARE ORIGINALĂ a demo-ului local"}, QA: ${clean(m.qa || "neverificat", 30)}`);
  return { id: "video", heading: SECTION.video.heading, text: lines.length ? bullets(lines) : "Clipurile nu sunt gata încă.", source: "media", auto: true };
}

function basisOf({ manifest, bundleSha, media, services, owner }) {
  return {
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
    byId.set(id, { ...byId.get(id), text, source: "owner", needsReview: false });
  }
  const sections = SUMMARY_SECTIONS.map((s) => byId.get(s.id));
  const authorKind = sections.every((s) => s.source === "owner" || s.auto) ? "owner" : sections.some((s) => s.source === "owner") ? "mixed" : "template";
  return finish({ title: prev.title, sections, claimsToVerify: claims, warnings: prev.warnings || [], basis: prev.basis, authorKind });
}

/**
 * A new version after a change of one basis: `fresh` is renderSummary() on the new facts. Only the sections built from the changed basis
 * are replaced; an owner-written section on a changed basis keeps its text and is flagged needsReview (its facts may no longer hold).
 * @param {"software"|"media"|"services"} changed
 */
export function regenerateSummary(prev, fresh, changed) {
  if (!["software", "media", "services"].includes(changed)) throw new HubError("validation", `Schimbare necunoscută „${changed}”`);
  const old = new Map((prev?.sections || []).map((s) => [s.id, s]));
  const sections = fresh.sections.map((s) => {
    const before = old.get(s.id);
    if (SECTION_BASIS[s.id] !== changed || !before) return before || s;
    if (before.source === "owner") return { ...before, needsReview: true };
    return s;
  });
  const claims = changed === "software" ? fresh.claimsToVerify : prev.claimsToVerify;
  const authorKind = sections.some((s) => s.source === "owner") ? (sections.every((s) => s.source === "owner" || s.auto) ? "owner" : "mixed") : "template";
  return finish({ title: fresh.title, sections, claimsToVerify: [...claims, ...sections.filter((s) => s.needsReview).map((s) => `De revăzut: „${s.heading}” (faptele s-au schimbat după editarea ta)`)],
    warnings: fresh.warnings, basis: { ...prev.basis, [changed]: fresh.basis[changed] }, authorKind });
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
