import { HubError } from "../core/errors.mjs";
import { hashCanonical } from "../core/canonical.mjs";
import { buildDocx } from "../office/docx.mjs";
import { foldDiacritics } from "../sales/identity.mjs";
import { findCommercialFigures } from "../sales/figures.mjs";
import { findUnresolvedPlaceholders, NOT_CONFIGURED } from "../sales/proposal.mjs";
import { slugOf } from "../sales/dossier.mjs";

/**
 * M13 „Birou intern” — pure builders (no database, no clock, no write): the state of an Operations start record, the support
 * classification / sources / reply, the deviz, and the export files of each flow (Markdown / JSON / Word, README, manifest).
 * The same facts give the same bytes (README and manifest carry the time the ledger fixed for the operation), so a resume rebuilds
 * exactly what the first attempt wrote. Every text names what is synthetic, internal and unsent; an unknown stays „De stabilit”.
 */
export const DESK_SCHEMA = 1;
export const DESK_LABELS = Object.freeze(["SYNTHETIC_DATA", "LOCAL_ONLY", "INTERNAL_ONLY"]);
export const DESK_EXTS = Object.freeze(["md", "json", "docx", "pdf"]);
export const DESK_GENERATORS = Object.freeze({ opsMd: "desk-ops-start-md-v1", opsJson: "desk-ops-start-json-v1", opsSpec: "desk-ops-spec-draft-v1",
  caseMd: "desk-support-case-md-v1", caseJson: "desk-support-case-json-v1", replyMd: "desk-support-reply-md-v1", sources: "desk-support-sources-v1", supportSpec: "desk-support-spec-draft-v1",
  devizMd: "desk-deviz-md-v1", devizDocx: "desk-deviz-docx-v1", devizJson: "desk-deviz-json-v1", readme: "desk-readme-v1", pdf: "word-pdf-export" });
/** What the Hub never does in these flows (said on every card and in every README). */
export const DESK_NEVER = Object.freeze(["trimiterea sau publicarea a ceva", "contactarea clientului", "CONTACTED, WON sau acceptarea clientului", "predarea către Engineering sau pornirea Fabricii",
  "un model, un writer sau o rulare Engineering", "emitere fiscală, ANAF, e-Factura, bănci, plăți sau contabilitate", "ștergeri"]);
export const UNKNOWN_TEXT = "De stabilit";
const arr = (v) => (Array.isArray(v) ? v : []);
const line = (v, max = 400) => String(v ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const md = (lines) => Buffer.from(`${lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`, "utf8");
const js = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
const bullets = (text) => String(text || "").split("\n").map((x) => x.trim()).filter((x) => x.startsWith("- ")).map((x) => line(x.slice(2), 400)).filter(Boolean);
const section = (offer, id) => arr(offer?.content?.sections).find((s) => s.id === id) || null;
const tail = (id) => String(id || "").split("_").pop().toLowerCase().replace(/[^a-z0-9]/g, "").slice(-10) || "x";
const FOLDER_RE = /^[a-z0-9][a-z0-9-]{2,80}$/;

/** `<exports>\<root>\<prefix>-sintetic-<slug>-<tail>\revizia-<N>-<export tail>` — every segment checked (ASCII, no spaces). */
export function deskFolderNames({ root, prefix, name, subjectId, revision, exportId }) {
  const subject = `${prefix}-sintetic-${slugOf(name)}-${tail(subjectId)}`;
  const rev = `revizia-${Number(revision)}-${tail(exportId)}`;
  if (!Number.isInteger(Number(revision)) || Number(revision) < 1) throw new HubError("validation", "Revizia exportului e un număr de la 1");
  for (const s of [root, subject, rev]) if (!FOLDER_RE.test(s)) throw new HubError("validation", `Nume de folder invalid: ${s}`, { code: "DESK_FOLDER_NAME" });
  return { root, subject, revision: rev };
}

// ---------------------------------------------------------------- the offer an internal flow starts from
/**
 * The pinned facts of an internally approved offer (M12): id, version, full sha, the services it was rendered from (id@version),
 * its explicit prices and terms. Nothing here reads the current catalog: a deviz or a start dossier states the APPROVED offer.
 */
export function offerFacts({ proposal, opportunity, org }) {
  const c = proposal?.content || {};
  return { proposalId: proposal.id, version: proposal.version, contentSha: proposal.contentSha, approvedSha: proposal.approvedSha, approvedAt: proposal.approvedAt || null,
    title: line(c.title, 200), serviceIds: arr(c.serviceIds).map(String), serviceNames: arr(c.serviceNames).map((x) => line(x, 160)),
    pricing: arr(c.pricing).map((p) => ({ item: p.item === "price" ? "price" : "leadTime", serviceId: p.serviceId || null, status: p.status === "CONFIGURED" ? "CONFIGURED" : "UNKNOWN", text: line(p.text, 200), reason: line(p.reason, 120) })),
    opportunityId: opportunity.id, orgId: org.id, orgName: line(org.displayName, 200), synthetic: Boolean(org.synthetic && opportunity.synthetic) };
}

// ---------------------------------------------------------------- Operations: the start record
/**
 * The internal start state of a project from its approved offer: the checklist of what the client must send (the offer's own
 * „Materiale” lines — what was approved), all MISSING at creation (nothing was received); the open questions (the offer's questions +
 * what the offer leaves open) and the risks (each with its rule); the owner and the next action; the known and unknown deadlines.
 */
export function opsStartState({ offer, proposal, withSpec = false }) {
  const materials = bullets(section(proposal, "materials")?.text);
  const checklist = materials.map((text, i) => ({ id: `M${i + 1}`, text, status: "MISSING", receivedAt: null, note: "" }));
  const questions = [...bullets(section(proposal, "questions")?.text).map((text) => ({ text, source: "oferta aprobată (întrebări)" })),
    ...offer.pricing.filter((p) => p.status !== "CONFIGURED").map((p) => ({ text: `${p.item === "price" ? "Prețul" : "Termenul"} serviciului: ${UNKNOWN_TEXT} — îl stabilești tu (catalogul nu îl are configurat)`, source: "regulă: valoare neconfigurată în oferta aprobată" })),
    { text: "Când poate trimite clientul materialele?", source: "regulă: nicio dată primită" },
    ...(checklist.length ? [] : [{ text: `Ce materiale trebuie să primim de la client? (${UNKNOWN_TEXT}: oferta aprobată nu le enumeră)`, source: "regulă: listă goală" }])];
  const risks = [
    { text: "Aprobarea internă a ofertei nu e acceptarea clientului: pornirea rămâne internă, nu o vânzare încheiată.", rule: "M12: APPROVED_INTERNAL ≠ WON" },
    ...(checklist.length ? [{ text: `${checklist.length} materiale lipsesc de la client; fără ele lucrul nu poate începe.`, rule: "checklist: nimic primit" }] : []),
    ...offer.pricing.filter((p) => p.status !== "CONFIGURED").map((p) => ({ text: `${p.item === "price" ? "Prețul" : "Termenul"} e ${UNKNOWN_TEXT}: nu se promite nimic clientului.`, rule: "valoare necunoscută" })),
    ...(offer.synthetic ? [{ text: "Firma și oferta sunt sintetice (date de test).", rule: "SYNTHETIC_DATA" }] : []),
  ];
  const lead = offer.pricing.find((p) => p.item === "leadTime");
  const deadlines = [
    { what: "Termenul de livrare", status: lead?.status === "CONFIGURED" ? "KNOWN" : "UNKNOWN", value: lead?.status === "CONFIGURED" ? lead.text : `${UNKNOWN_TEXT} (${lead?.reason || "neconfigurat"})` },
    { what: "Data de start", status: "UNKNOWN", value: `${UNKNOWN_TEXT} (după primirea materialelor și acordul clientului)` },
    { what: "Primirea materialelor", status: "UNKNOWN", value: `${UNKNOWN_TEXT} (nicio dată primită)` },
  ];
  const state = { schema: DESK_SCHEMA, kind: "ops_start", offer: pick(offer), checklist, questions, risks, deadlines, owner: "proprietar", withSpec: Boolean(withSpec),
    scope: bullets(section(proposal, "scope")?.text), exclusions: bullets(section(proposal, "exclusions")?.text) };
  return { ...state, ...opsProgress(state) };
}
const pick = (offer) => ({ proposalId: offer.proposalId, version: offer.version, contentSha: offer.contentSha, title: offer.title, serviceIds: offer.serviceIds, serviceNames: offer.serviceNames,
  opportunityId: offer.opportunityId, orgId: offer.orgId, orgName: offer.orgName, pricing: offer.pricing, synthetic: offer.synthetic });
/** What is received / missing and the next action, always derived from the checklist (one rule; a change of an item moves both). */
export function opsProgress(state) {
  const items = arr(state.checklist);
  const received = items.filter((i) => i.status === "RECEIVED").map((i) => i.id);
  const missing = items.filter((i) => i.status !== "RECEIVED").map((i) => i.id);
  if (!items.length) return { received, missing, nextAction: `Stabilești cu clientul lista materialelor (oferta aprobată nu le enumeră: ${UNKNOWN_TEXT}); nimic nu se trimite de aici.` };
  const nextAction = missing.length
    ? `Ceri clientului ${missing.length === 1 ? "materialul lipsă" : `cele ${missing.length} materiale lipsă`} (în afara Hub-ului; de aici nu se trimite nimic), apoi le marchezi primite aici.`
    : "Toate materialele sunt primite: stabilești prețul, termenul și acordul clientului înainte de orice lucru Engineering (decizia ta, separat).";
  return { received, missing, nextAction };
}
/** The Engineering SPEC_DRAFT sketch (only when the confirmed plan names it): text in the dossier, never a Factory mission. */
export function opsSpecDraft(state) {
  return { status: "SPEC_DRAFT", created: false, why: "Schiță internă, nepornită; nu e creată în Fabrică: predarea către Engineering cere acceptarea clientului (WON), care nu există.",
    workType: "FEATURE", title: line(`${state.offer.orgName}: ${state.offer.serviceNames.join(", ") || state.offer.title}`, 160),
    objective: line(`Construirea serviciului din oferta aprobată intern ${state.offer.proposalId} v${state.offer.version}, după acordul clientului.`, 400),
    inScope: state.scope, outOfScope: state.exclusions, acceptance: state.scope.map((text) => ({ text, verify: "de stabilit" })), sources: [`oferta ${state.offer.proposalId} v${state.offer.version} (${state.offer.contentSha})`] };
}

// ---------------------------------------------------------------- Support: classification, sources, reply
const DEFECT = /\b(?:nu (?:mai )?(?:merge|functioneaza|porneste|se (?:incarca|deschide|salveaza|afiseaza)|apare|pot|accepta|salveaza|afiseaza)|eroare|erori|greseala|gresit|gresita|bug|defect|se blocheaza|blocat|blocata|crapa|nu raspunde|a disparut|dispar)\b/;
const NEW_REQUEST = /\b(?:adaugati|sa adaugati|se poate adauga|puteti adauga|o functie noua|functie noua|functionalitate noua|modul nou|am dori|as dori sa|vrem si|ne trebuie si|ar fi util|integrare cu|sa puteti face)\b/;
const QUESTION = /\?|\b(?:cum|unde|cand|se poate|pot|putem|poate|este posibil|e posibil|exista|ce se intampla|clientii pot)\b/;
/**
 * The class of a support request, by a declared rule (no model): DEFECT_REPORTED (a reported malfunction — never proof of a defect),
 * NEW_REQUEST (something outside what was delivered), QUESTION (otherwise). → { class, rule, matched }
 */
export function classifySupport(text) {
  const f = foldDiacritics(String(text || "")).toLowerCase();
  const hit = (re) => (f.match(re) || [])[0] || null;
  const d = hit(DEFECT), n = hit(NEW_REQUEST), q = hit(QUESTION);
  if (d) return { class: "DEFECT_REPORTED", rule: "cuvinte de defect raportat (nu dovedesc defectul)", matched: d.trim() };
  if (n) return { class: "NEW_REQUEST", rule: "cuvinte de cerere nouă (ceva în afara livrării)", matched: n.trim() };
  return { class: "QUESTION", rule: q ? "formă de întrebare" : "implicit: nici defect, nici cerere nouă", matched: q ? q.trim() : null };
}
export const SUPPORT_CLASS_RO = Object.freeze({ QUESTION: "întrebare", DEFECT_REPORTED: "defect raportat", NEW_REQUEST: "cerere nouă" });
/** Words of the request that say nothing specific about a capability (the domain's own vocabulary is everywhere in the criteria). */
const COMMON = new Set(["programare", "programarea", "programari", "programarile", "client", "clientul", "clientii", "clientilor", "site", "siteul", "pagina", "paginii", "aplicatia",
  "aplicatiei", "poate", "putem", "pentru", "dintr", "direct", "astfel", "foarte", "sintetic", "sintetica", "intreaba", "intrebare", "spune", "spun", "vrea", "doreste", "daca", "acum", "acest", "aceasta"]);
const stemsOf = (text) => [...new Set(foldDiacritics(String(text || "")).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 5 && !COMMON.has(w)).map((w) => (w.length === 5 ? w : w.slice(0, 6))))];
/**
 * The sources a reply may use: the PASS criteria of the project's accepted package (id, text, status, fingerprint), pinned with the
 * delivery, the package and the spec sha. → { delivery, criteria[], sha }
 */
export function supportSources({ project, delivery, binding }) {
  const criteria = arr(binding?.criteria).filter((c) => String(c.status || "").startsWith("PASS")).map((c) => ({ id: String(c.id), text: line(c.text, 600), status: String(c.status), fingerprint: c.fingerprint || null }));
  const pinned = { project: { id: project.id, name: line(project.name, 160) }, delivery: { id: delivery.id, status: delivery.status, missionId: delivery.missionId, bundleId: binding.bundleId, bundleSha: binding.bundleSha,
    bundleStatus: binding.bundleStatus, specSha: binding.specSha || null }, criteria };
  return { ...pinned, sha: hashCanonical(pinned) };
}
/** The criteria that share a specific word (5-letter stem) with the request; the rest of the request stays unconfirmed. */
export function matchCriteria(request, sources) {
  const want = stemsOf(request);
  const matched = arr(sources.criteria).map((c, i) => ({ c, i, hits: want.filter((s) => stemsOf(c.text).includes(s)) })).filter((x) => x.hits.length)
    .sort((a, b) => b.hits.length - a.hits.length || a.i - b.i).map((x) => ({ ...x.c, hits: x.hits }));
  const covered = new Set(matched.flatMap((m) => m.hits));
  return { matched, unconfirmed: want.filter((s) => !covered.has(s)) };
}
const firstSentence = (t) => { const x = line(String(t || "").split(/(?<=[.;])\s/)[0], 400); return x.length > 220 ? `${x.slice(0, 217).replace(/\s+\S*$/, "")}…` : x; };
/**
 * The draft reply (DRAFT_ONLY, never sent): only what the project's accepted package verified, named by criterion; what the sources do
 * not confirm is said as such. A reported defect is acknowledged, never confirmed; a new request is called new. No figure, no promise.
 */
export function supportReply({ request, classification, sources, caseNo }) {
  const m = matchCriteria(request, sources);
  const facts = m.matched.map((c) => ({ id: c.id, text: firstSentence(c.text), status: c.status })).filter((f) => !findCommercialFigures(f.text).length).slice(0, 3);
  const intro = { QUESTION: "Vă mulțumim pentru întrebare. Mai jos sunt doar lucrurile verificate în versiunea livrată și acceptată.",
    DEFECT_REPORTED: "Vă mulțumim pentru semnalare. Am înregistrat-o și o verificăm; nu confirmăm încă un defect.",
    NEW_REQUEST: "Vă mulțumim pentru propunere. Ce descrieți nu face parte din versiunea livrată; o putem discuta separat, ca o cerere nouă." }[classification.class];
  const body = [`Bună ziua,`, "", intro, "",
    ...(facts.length ? ["Ce este verificat în versiunea livrată:", ...facts.map((f) => `- ${f.text} (criteriul ${f.id}, verificat)`)] : ["Nu găsesc în versiunea livrată o funcție verificată care să răspundă direct la ce ați întrebat."]),
    "", classification.class === "DEFECT_REPORTED" ? "Revenim după ce verificăm situația descrisă." : facts.length ? "Pentru orice altceva revenim după verificare." : "Verificăm și revenim cu un răspuns.",
    "", "Cu stimă,", "Ifrim Digital"].join("\n");
  const subject = line(`[DATE SINTETICE] Răspuns la solicitarea ${caseNo}`, 200);
  return { schema: DESK_SCHEMA, kind: "support_reply", subject, body, facts, unconfirmed: m.unconfirmed, classification: classification.class,
    sources: { deliveryId: sources.delivery.id, bundleId: sources.delivery.bundleId, bundleSha: sources.delivery.bundleSha, sourcesSha: sources.sha },
    labels: ["SYNTHETIC_DATA", "DRAFT_ONLY", "NOT_SENT"], sent: false };
}
/** For a reported defect: a correction proposal (SPEC_DRAFT text in the case), never a mission, never a run. */
export function supportSpecDraft({ request, sources, caseNo }) {
  return { status: "SPEC_DRAFT", created: false, why: "Propunere de corecție, nepornită; nu e creată în Fabrică (defectul nu e dovedit; o misiune cere decizia ta separată).",
    workType: "BUGFIX", title: line(`${sources.project.name}: verificarea sesizării ${caseNo}`, 160), objective: line(`Reproducerea și, dacă se confirmă, corectarea situației raportate: ${request}`, 600),
    acceptance: [{ text: "Situația raportată este reprodusă (sau infirmată) pe versiunea livrată, cu dovadă", verify: "manual" }, { text: "Criteriile deja verificate ale livrării rămân verificate", verify: "manual" }],
    sources: [`livrarea ${sources.delivery.id}`, `pachetul ${sources.delivery.bundleId} (${sources.delivery.bundleSha})`] };
}

// ---------------------------------------------------------------- Finance-Admin: the deviz (draft)
/**
 * The deviz in draft from the APPROVED offer: one line per service of the offer, the price and the term exactly as the offer states them
 * (an UNKNOWN stays „De stabilit”, never 0), no total computed on unknown values. A configured price in the catalog after the approval
 * is NOT taken: the offer is the source (a newer price makes the offer STALE, and the deviz with it).
 */
export function devizContent({ offer, internalNo }) {
  const priceOf = (svc, item) => offer.pricing.find((p) => p.item === item && (!svc || !p.serviceId || p.serviceId === svc)) || null;
  const refs = offer.serviceIds.length ? offer.serviceIds : [""];
  const lines = refs.map((ref, i) => {
    const svc = ref ? ref.split("@")[0] : null;
    const price = priceOf(svc, "price"), term = priceOf(svc, "leadTime");
    const v = (p) => (p && p.status === "CONFIGURED" ? { status: "KNOWN", text: p.text } : { status: "UNKNOWN", text: UNKNOWN_TEXT, reason: p?.reason || "neconfigurat în oferta aprobată" });
    return { no: i + 1, service: offer.serviceNames[i] || svc || offer.title || "Lucrarea din ofertă", serviceRef: ref || null, quantity: "un serviciu", unitPrice: v(price), term: v(term), lineTotal: { status: "UNKNOWN", text: UNKNOWN_TEXT, reason: "nu se calculează pe valori necunoscute" } };
  });
  const unknown = lines.some((l) => l.unitPrice.status !== "KNOWN");
  return { schema: DESK_SCHEMA, kind: "deviz", docType: "Deviz", state: "CIORNĂ", internalNo, notFiscal: true, title: line(`[DATE SINTETICE] Deviz (ciornă) ${internalNo} — ${offer.orgName}`, 200),
    client: { orgId: offer.orgId, name: offer.orgName, synthetic: offer.synthetic }, source: { proposalId: offer.proposalId, version: offer.version, contentSha: offer.contentSha, approvedSha: offer.approvedSha, serviceIds: offer.serviceIds },
    lines, total: unknown ? { status: "UNKNOWN", text: UNKNOWN_TEXT, reason: "nu se calculează pe valori necunoscute" } : { status: "UNKNOWN", text: UNKNOWN_TEXT, reason: "totalul îl stabilești tu" },
    currency: null, configured: lines.flatMap((l) => [...(l.unitPrice.status === "KNOWN" ? [`${l.service}: preț`] : []), ...(l.term.status === "KNOWN" ? [`${l.service}: termen`] : [])]),
    unknown: lines.flatMap((l) => [...(l.unitPrice.status !== "KNOWN" ? [`${l.service}: preț`] : []), ...(l.term.status !== "KNOWN" ? [`${l.service}: termen`] : []), `${l.service}: valoare și total`]),
    notes: ["Document intern în ciornă: nu e factură, nu e emis fiscal, nu e trimis clientului și nu înseamnă acceptarea clientului sau o încasare.",
      `Valorile necunoscute rămân „${UNKNOWN_TEXT}”; niciun total nu e calculat pe valori presupuse.`,
      `Sursa: oferta aprobată intern ${offer.proposalId}, versiunea ${offer.version}.`], labels: ["SYNTHETIC_DATA", "DRAFT", "NOT_FISCAL", "NOT_SENT"] };
}
const devizLines = (c) => arr(c.lines).map((l) => `${l.no}. ${l.service} — cantitate: ${l.quantity}; preț unitar: ${l.unitPrice.text}; termen: ${l.term.text}; valoare: ${l.lineTotal.text}`);
/** The client-facing text of the deviz (scanned for commercial figures: only the configured catalog texts may appear). */
export const devizText = (c) => [c.title, ...devizLines(c), `Total: ${c.total.text}`, ...arr(c.notes)].join("\n");
export function devizDocxModel(c, { approval = null } = {}) {
  return { title: line(c.title, 200), subtitle: "[DATE SINTETICE] Ciornă internă — nu e document fiscal, nu e trimisă", author: "Ifrim Agent Hub", blocks: [
    { type: "note", text: c.notes[0] },
    { type: "h1", text: "Client" }, { type: "p", text: `${c.client.name}${c.client.synthetic ? " (sintetic)" : ""}` },
    { type: "h1", text: "Servicii" },
    { type: "table", header: ["Nr.", "Serviciu", "Cantitate", "Preț unitar", "Termen", "Valoare"], rows: arr(c.lines).map((l) => [String(l.no), l.service, l.quantity, l.unitPrice.text, l.term.text, l.lineTotal.text]) },
    { type: "p", text: `Total: ${c.total.text} (${c.total.reason})` },
    { type: "h1", text: "Stare și surse" },
    ...arr(c.notes).slice(1).map((text) => ({ type: "bullet", text })),
    { type: "bullet", text: `Număr intern ${c.internalNo} (nu e un număr fiscal)` },
    ...(approval ? [{ type: "bullet", text: `Aprobat intern la ${approval.at} (conținut ${approval.sha}); aprobarea internă nu e emitere, trimitere sau acceptare` }] : []),
  ] };
}

// ---------------------------------------------------------------- export files
const add = (out, p, buf, generator, inputs, clientText = null) => out.push({ path: p, buf, generator, inputsSha: hashCanonical({ generator, inputs }), ...(clientText ? { clientText } : {}) });
/** The files of an Operations start dossier (its current state, exactly). */
export function opsExportFiles({ record, state }) {
  const out = [];
  const inputs = { recordId: record.id, state };
  const s = state;
  add(out, "dosar-pornire.md", md([`# Dosarul de pornire a proiectului — ${line(record.internalNo, 20)}`, "",
    "> [DATE SINTETICE] Pregătire INTERNĂ: aprobarea internă a ofertei nu e acceptarea clientului; nimic nu a fost trimis; nicio lucrare Engineering nu a pornit.", "",
    `- Oferta: ${s.offer.proposalId}, versiunea ${s.offer.version}, SHA-256 ${s.offer.contentSha}`, `- Serviciul: ${s.offer.serviceNames.join(", ") || "—"} (${s.offer.serviceIds.join(", ") || "—"})`,
    `- Clientul: ${s.offer.orgName}${s.offer.synthetic ? " (sintetic)" : ""}`, `- Responsabil: ${s.owner}`, `- Starea pregătirii: pregătire internă — materiale primite ${s.received.length} din ${s.checklist.length}${s.checklist.length ? "" : ` (lista e ${UNKNOWN_TEXT})`}, ${s.questions.length} întrebări deschise, ${s.risks.length} riscuri; nimic trimis, clientul nu a acceptat nimic prin acest dosar`,
    `- Următoarea acțiune: ${line(s.nextAction, 400)}`, "",
    "## Materiale necesare de la client", "", ...s.checklist.map((i) => `- [${i.status === "RECEIVED" ? "x" : " "}] ${i.id}. ${i.text} — ${i.status === "RECEIVED" ? `PRIMIT${i.receivedAt ? ` (${String(i.receivedAt).slice(0, 10)})` : ""}` : "LIPSEȘTE"}${i.note ? ` — ${line(i.note, 200)}` : ""}`), "",
    `Primit: ${s.received.length ? s.received.join(", ") : "nimic încă"} · Lipsește: ${s.missing.length ? s.missing.join(", ") : "nimic"}`, "",
    "## Întrebări deschise", "", ...s.questions.map((q) => `- ${line(q.text, 300)} (sursa: ${line(q.source, 120)})`), "",
    "## Riscuri", "", ...s.risks.map((r) => `- ${line(r.text, 300)} (regula: ${line(r.rule, 120)})`), "",
    "## Termene", "", ...s.deadlines.map((d) => `- ${d.what}: ${d.value} (${d.status === "KNOWN" ? "cunoscut" : "NECUNOSCUT"})`), "",
    "## Ce include oferta aprobată", "", ...s.scope.map((x) => `- ${x}`), "", "## Ce nu include", "", ...s.exclusions.map((x) => `- ${x}`)]), DESK_GENERATORS.opsMd, inputs);
  add(out, "dosar-pornire.json", js({ schema: DESK_SCHEMA, kind: "desk-ops-start", recordId: record.id, internalNo: record.internalNo, stateSha: hashCanonical(s), ...s }), DESK_GENERATORS.opsJson, inputs);
  if (s.withSpec) add(out, "misiune-spec-draft.json", js({ schema: DESK_SCHEMA, kind: "desk-spec-draft", ...opsSpecDraft(s) }), DESK_GENERATORS.opsSpec, inputs);
  return out;
}
/** The files of a support case: the case, the approved draft reply (still unsent), the sources and, for a defect, the proposal. */
export function supportExportFiles({ record, state, reply }) {
  const out = [];
  const inputs = { recordId: record.id, state, reply: { id: reply.id, version: reply.version, contentSha: reply.contentSha, approvedSha: reply.approvedSha, status: reply.status } };
  const c = reply.content;
  add(out, "caz.md", md([`# Caz de suport ${line(record.internalNo, 20)} — [DATE SINTETICE]`, "",
    "> Solicitare SINTETICĂ (de test), nu a unui client real. Clasificarea nu dovedește un defect; aprobarea răspunsului nu închide și nu rezolvă cazul.", "",
    `- Proiectul: ${state.sources.project.name} (${state.sources.project.id})`, `- Cererea originală: „${line(state.request, 1000)}”`,
    `- Clasificare: ${SUPPORT_CLASS_RO[state.classification.class]} (${state.classification.class}; regula: ${state.classification.rule}${state.classification.matched ? `; „${state.classification.matched}”` : ""})`,
    `- Starea cazului: ${state.caseStatus} — ${line(state.caseStatusText, 300)}`, `- Responsabil: ${state.owner}`, `- Următoarea acțiune: ${line(state.nextAction, 400)}`, "",
    "## Surse folosite (doar citire)", "", `- Livrarea ${state.sources.delivery.id} (${state.sources.delivery.status}), pachetul ${state.sources.delivery.bundleId} (${state.sources.delivery.bundleStatus}), SHA-256 ${state.sources.delivery.bundleSha}`,
    ...state.sources.criteria.map((x) => `- ${x.id} (${x.status}): ${line(x.text, 300)}`)]), DESK_GENERATORS.caseMd, inputs);
  add(out, "caz.json", js({ schema: DESK_SCHEMA, kind: "desk-support-case", recordId: record.id, internalNo: record.internalNo, stateSha: hashCanonical(state), ...state }), DESK_GENERATORS.caseJson, inputs);
  add(out, "raspuns-ciorna.md", md([`# Răspuns — DRAFT_ONLY — NETRIMIS (v${reply.version})`, "",
    `- Răspunsul ${reply.id}, versiunea ${reply.version}, SHA-256 ${reply.contentSha}; ${reply.status === "APPROVED_INTERNAL" ? `text aprobat intern (${reply.approvedSha}) — netrimis` : "neaprobat"}`,
    `- Subiect: ${c.subject}`, "", "## Text", "", String(c.body || "").trim(), "",
    "## Ce nu e confirmat de surse", "", ...(arr(c.unconfirmed).length ? [`- cuvintele cererii fără o sursă verificată: ${c.unconfirmed.join(", ")} (rădăcini)`] : ["- nimic semnalat"])]),
  DESK_GENERATORS.replyMd, inputs, `${c.subject}\n${c.body}`);
  add(out, "surse.json", js({ schema: DESK_SCHEMA, kind: "desk-support-sources", ...state.sources }), DESK_GENERATORS.sources, inputs);
  if (state.specDraft) add(out, "propunere-corectie-spec-draft.json", js({ schema: DESK_SCHEMA, kind: "desk-spec-draft", ...state.specDraft }), DESK_GENERATORS.supportSpec, inputs);
  return out;
}
/** The files of a deviz version: Markdown, Word (the PDF is Word's own export, added by the step) and JSON. */
export function devizExportFiles({ record, artifact }) {
  const out = [];
  const c = artifact.content;
  const approval = artifact.status === "APPROVED_INTERNAL" ? { at: artifact.approvedAt, sha: artifact.approvedSha } : null;
  const inputs = { recordId: record.id, artifact: { id: artifact.id, version: artifact.version, contentSha: artifact.contentSha, approvedSha: artifact.approvedSha, approvedAt: artifact.approvedAt, status: artifact.status } };
  const v = artifact.version;
  add(out, `deviz-v${v}.md`, md([`# ${line(c.title, 200)}`, "", `> ${c.notes[0]}`, "",
    `- Tip: ${c.docType} · stare: ${c.state} · număr intern ${c.internalNo} (nu e număr fiscal)`, `- Documentul ${artifact.id}, versiunea ${v}, SHA-256 ${artifact.contentSha}`,
    approval ? `- Conținut aprobat intern la ${approval.at} (SHA ${approval.sha}); nu e emitere, trimitere, acceptare sau încasare` : "- Conținut neaprobat",
    `- Sursa: oferta ${c.source.proposalId}, versiunea ${c.source.version}, SHA-256 ${c.source.contentSha}; servicii ${c.source.serviceIds.join(", ")}`, "",
    "## Servicii", "", "| Nr. | Serviciu | Cantitate | Preț unitar | Termen | Valoare |", "|---|---|---|---|---|---|",
    ...arr(c.lines).map((l) => `| ${l.no} | ${l.service} | ${l.quantity} | ${l.unitPrice.text} | ${l.term.text} | ${l.lineTotal.text} |`), "",
    `Total: ${c.total.text} (${c.total.reason})`, "", "## Necunoscute (De stabilit)", "", ...(c.unknown.length ? c.unknown.map((x) => `- ${x}`) : ["- niciuna"]), "",
    "## Note", "", ...arr(c.notes).map((x) => `- ${x}`)]), DESK_GENERATORS.devizMd, inputs, devizText(c));
  add(out, `deviz-v${v}.docx`, buildDocx(devizDocxModel(c, { approval }), { created: new Date(artifact.createdAt) }), DESK_GENERATORS.devizDocx, { ...inputs, model: hashCanonical(devizDocxModel(c, { approval })) });
  add(out, `deviz-v${v}.json`, js({ schema: DESK_SCHEMA, kind: "desk-deviz", documentId: artifact.id, version: v, contentSha: artifact.contentSha, status: artifact.status, approval, content: c }), DESK_GENERATORS.devizJson, inputs);
  return out;
}

/** No unresolved template field in a human text; no commercial figure in a client text beyond the configured catalog texts. */
export function checkExportTexts(files, { allow = [] } = {}) {
  const leftovers = files.flatMap((a) => (a.path.endsWith(".md") ? findUnresolvedPlaceholders(a.buf.toString("utf8")) : a.clientText ? findUnresolvedPlaceholders(a.clientText) : []));
  if (leftovers.length) throw new HubError("policy", `Exportul ar conține câmpuri nerezolvate: ${[...new Set(leftovers)].slice(0, 5).join(", ")}`, { code: "DESK_PLACEHOLDERS" });
  const figures = files.flatMap((a) => (a.clientText ? findCommercialFigures(a.clientText, { allow }).map((f) => `${a.path}: „${f.text}”`) : []));
  if (figures.length) throw new HubError("policy", `Exportul ar conține cifre comerciale neconfigurate (${figures.slice(0, 3).join(", ")}); nu îl scriu.`, { code: "DESK_FIGURES" });
}
/** README.md: what the folder is, what was NOT done, every file with its sha, the verification. */
export function deskReadme({ title, record, exportId, revision, createdAt, files, verification, facts = [] }) {
  const v = verification?.docx || null;
  return md([`# ${title} — revizia ${revision}`, "", `> [DATE SINTETICE] Pregătit de Ifrim Agent Hub dintr-un plan confirmat de tine. Nimic nu a fost trimis, publicat sau cheltuit; nicio lucrare Engineering nu a pornit. ${NOT_CONFIGURED} / ${UNKNOWN_TEXT} rămâne până îl stabilești tu.`, "",
    `- Înregistrarea: ${record.id} (${record.internalNo})`, `- Exportul: ${exportId} (revizia ${revision}), creat la ${createdAt}`, ...facts.map((f) => `- ${f}`), "",
    "## Fișiere", "", "| Fișier | Octeți | SHA-256 |", "|---|---|---|", ...files.map((f) => `| ${f.path} | ${f.bytes} | ${f.sha256} |`), "",
    ...(v ? ["## Verificări", "", `- Documentul Word: ${v.file || "FILE_CHECKED"} · ${v.app || "APP_NOT_RUN"}${v.note ? ` — ${line(v.note, 300)}` : ""}`, ""] : []),
    "## Ce nu face Hub-ul aici", "", ...DESK_NEVER.map((x) => `- ${x}`), "", `Etichete: ${DESK_LABELS.join(", ")}.`]);
}
/** manifest.json: relative paths, the sha256 of every file (README included), written last. */
export function deskManifest({ kind, record, exportId, revision, folderName, createdAt, artifact = null, plan, files, verification, sources }) {
  return js({ schema: DESK_SCHEMA, kind: `desk-export-${kind}`, exportId, revision, folderName, record: { id: record.id, internalNo: record.internalNo, kind: record.kind },
    ...(artifact ? { artifact: { id: artifact.id, kind: artifact.kind, version: artifact.version, contentSha: artifact.contentSha, approvedSha: artifact.approvedSha || null, status: artifact.status } } : {}),
    sources, plan, files, verification: verification || {}, labels: DESK_LABELS, synthetic: true, sent: false, published: false, spent: false, fiscal: false, createdAt });
}
