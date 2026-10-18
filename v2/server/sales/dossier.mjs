import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { HubError } from "../core/errors.mjs";
import { hashCanonical } from "../core/canonical.mjs";
import { buildDocx, expectedDocxShape } from "../office/docx.mjs";
import { QUALIFICATION_FORMULA_DOCS } from "./qualify.mjs";
import { findUnresolvedPlaceholders, NOT_CONFIGURED } from "./proposal.mjs";
import { findCommercialFigures } from "./figures.mjs";

/**
 * M12 „Dosarul ofertei” (SPEC §6, S-06): the local folder of ONE internally approved synthetic offer — the offer (Markdown + Word), the
 * company sheet, the evidence with its provenance, the explained qualification, the contact draft (DRAFT_ONLY, never sent), a README
 * and a manifest with the sha256 of every file, written last. The name is deliberately not „pachet” / „predare” (that is the
 * Engineering hand-off after the client's acceptance, sales_handoffs): table sales_dossiers, ids sdo_.
 *
 * Pure builders: no database, no clock, no write. The same facts give the same bytes (the docx carries the offer's own creation date
 * and a fixed zip time; README / manifest carry the time the ledger recorded for the operation), so a retry or a rebuild produces
 * identical files — which is what makes the reuse of an artifact in a later revision provable (R-REV) and its copy safe (R-PACK).
 * The artifacts never carry the dossier's id, revision or time: only README and the manifest do.
 */
export const DOSSIER_SCHEMA = 1;
export const DOSSIER_LABELS = Object.freeze(["SYNTHETIC_DATA", "LOCAL_ONLY", "DRAFT_ONLY"]);
export const DOSSIER_EXTS = Object.freeze(["md", "json", "docx", "pdf"]);
export const DOSSIER_GENERATORS = Object.freeze({ offerMd: "sales-dossier-md-v1", offerDocx: "sales-dossier-docx-v1", org: "sales-dossier-org-v1", evidence: "sales-dossier-evidence-v1",
  qualification: "sales-dossier-qual-v1", draft: "sales-dossier-draft-v1", readme: "sales-dossier-readme-v1", pdf: "word-pdf-export" });
const FOLDER_RE = /^[a-z0-9][a-z0-9-]{2,80}$/;
const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const arr = (v) => (Array.isArray(v) ? v : []);
const line = (v, max = 400) => String(v ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const md = (lines) => Buffer.from(`${lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`, "utf8");
const js = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
/** A value for a human line: objects as „cheie: valoare” pairs, an empty or missing value as UNKNOWN (never the word null). */
const valueText = (v) => {
  if (v === null || v === undefined || v === "") return "UNKNOWN";
  if (Array.isArray(v)) return v.map(valueText).join(", ");
  if (typeof v === "object") return Object.entries(v).filter(([, x]) => x !== null && x !== undefined && x !== "").map(([k, x]) => `${k}: ${typeof x === "object" ? valueText(x) : line(x, 120)}`).join("; ") || "UNKNOWN";
  return line(v, 240);
};

/** ASCII slug of a company name (no diacritics, no spaces), at most `max` characters; „firma” when nothing is left. */
export function slugOf(name, max = 40) {
  const s = String(name || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max).replace(/-+$/g, "");
  return s || "firma";
}
const tail = (id) => String(id || "").split("_").pop().toLowerCase().replace(/[^a-z0-9]/g, "").slice(-10) || "x";

/**
 * `<exports>\vanzari\oferta-sintetic-<slug>-<opp tail>\revizia-<N>-<dossier tail>\` — every segment checked (ASCII, no spaces); the
 * day is not part of the name (two revisions of one day are two folders). Always „sintetic”: M12 writes only synthetic companies.
 */
export function dossierFolderNames({ orgName, opportunityId, revision, dossierId }) {
  const opportunity = `oferta-sintetic-${slugOf(orgName)}-${tail(opportunityId)}`;
  const rev = `revizia-${Number(revision)}-${tail(dossierId)}`;
  if (!Number.isInteger(Number(revision)) || Number(revision) < 1) throw new HubError("validation", "Revizia dosarului e un număr de la 1");
  for (const s of [opportunity, rev]) if (!FOLDER_RE.test(s)) throw new HubError("validation", `Nume de folder invalid: ${s}`, { code: "SALES_DOSSIER_FOLDER_NAME" });
  return { root: "vanzari", opportunity, revision: rev };
}

/** The Word model of the approved offer (headings = the offer's sections; „- ” lines become real bullets). */
export function proposalDocxModel({ proposal }) {
  const c = proposal.content || {};
  const blocks = [{ type: "note", text: "[DATE SINTETICE] Ciornă internă: aprobată intern (nu e acceptarea clientului), netrimisă. Ce nu e configurat în catalog rămâne „De stabilit (neconfigurat)”." }];
  for (const s of arr(c.sections)) {
    blocks.push({ type: "h1", text: line(s.heading, 160) });
    for (const l of String(s.text || "").split("\n").map((x) => x.trim()).filter(Boolean)) blocks.push(l.startsWith("- ") ? { type: "bullet", text: line(l.slice(2), 600) } : { type: "p", text: line(l, 600) });
  }
  const pricing = arr(c.pricing);
  if (pricing.length) {
    blocks.push({ type: "h1", text: "Prețuri și termene (stare explicită)" });
    for (const p of pricing) blocks.push({ type: "bullet", text: `${p.item === "price" ? "Preț" : "Termen"}: ${line(p.text, 200)}${p.status === "UNKNOWN" ? ` (UNKNOWN: ${line(p.reason, 80)})` : ""}` });
  }
  if (arr(c.claimsToVerify).length) {
    blocks.push({ type: "h1", text: "De verificat înainte de orice folosire" });
    for (const x of arr(c.claimsToVerify)) blocks.push({ type: "bullet", text: line(x, 600) });
  }
  blocks.push({ type: "h1", text: "Proveniență" });
  for (const x of provenanceLines(proposal)) blocks.push({ type: "bullet", text: x });
  return { title: line(c.title || "Ofertă", 200), subtitle: "[DATE SINTETICE] ofertă aprobată intern — netrimisă", author: "Ifrim Agent Hub", blocks };
}
function provenanceLines(p) {
  return [`Oferta ${p.id}, versiunea ${p.version}`, `SHA-256 al conținutului: ${p.contentSha}`, `Aprobată intern la ${p.approvedAt} (SHA aprobat: ${p.approvedSha})`,
    "APPROVED_INTERNAL: aprobarea ta internă, nu acceptarea clientului; nimic nu a fost trimis"];
}

/** The company sheet as rendered (identity fields, status, contacts without their values, what is unknown). */
const orgRender = ({ org, contacts, unknowns }) => ({ org: { id: org.id, displayName: org.displayName, legalForm: org.legalForm, fiscalCode: org.fiscalCode, fiscalCodeValid: org.fiscalCodeValid,
  website: org.website, domain: org.domain, city: org.city, county: org.county, caen: org.caen, status: org.status, synthetic: org.synthetic },
  contacts: arr(contacts).map((x) => ({ id: x.id, kind: x.kind, generic: Boolean(x.generic), status: x.status })), unknowns: arr(unknowns) });
/** The evidence as listed in dovezi.md / .json (label, kind, source, freshness — which moves with time — and its use in the offer). */
const evidenceRows = ({ evidence, proposal }) => {
  const used = new Set(arr(proposal?.content?.usedEvidenceIds));
  return arr(evidence).map((e) => ({ id: e.id, claim: e.claim, value: e.value ?? null, label: e.label, dataKind: e.dataKind || null, sourceKind: e.sourceKind, sourceRef: e.sourceRef,
    retrievedAt: e.retrievedAt || null, verifiedAt: e.verifiedAt || null, excerpt: line(e.excerpt, 400), freshness: e.freshness || "CURRENT", conflictsWith: arr(e.conflictsWith),
    basis: arr(e.basis), reasoning: e.reasoning || "", usedInProposal: used.has(e.id) }));
};
/** The qualification as rendered: the exact row (its id, formula, result) and the rows before it. */
const qualRender = ({ qualification, qualificationHistory }) => ({ id: qualification?.id || null, formulaVersion: qualification?.formulaVersion || null,
  result: hashCanonical(qualification?.result || {}), history: arr(qualificationHistory).map((h) => h.id) });

/**
 * Review R20 / C3: the sha of every value the files render beyond the offer, the draft and the brief — the company sheet (status and
 * contacts included), the evidence as listed, the exact qualification row. The dossier's inputs (and so its C-01 key) carry it: a change
 * gives a new revision and makes a READY dossier STALE; a resume of the same key rebuilds exactly the same bytes.
 */
export function dossierRenderedInputs(facts) {
  return hashCanonical({ org: orgRender(facts), evidence: evidenceRows(facts), qualification: qualRender(facts) });
}

/**
 * Every artifact of the dossier except README and the manifest: [{ path, buf, inputsSha, generator, clientText? }]. `facts` is the
 * synchronous read of the executor (offer, draft, company, evidence, qualification, brief). Refuses unresolved placeholders.
 */
export function dossierArtifacts(facts) {
  const { proposal, draft, org, qualification, brief } = facts;
  const v = proposal.version;
  const out = [];
  const add = (p, buf, generator, inputs, clientText = null) => out.push({ path: p, buf, generator, inputsSha: hashCanonical({ generator, inputs }), ...(clientText ? { clientText } : {}) });

  // The offer (Markdown and Word): the approved version exactly, its explicit prices, what to verify, its provenance.
  const offerInputs = { proposal: { id: proposal.id, version: v, contentSha: proposal.contentSha, approvedSha: proposal.approvedSha, approvedAt: proposal.approvedAt, createdAt: proposal.createdAt } };
  const c = proposal.content || {};
  const offerLines = [`# ${line(c.title, 200)}`, "",
    "> [DATE SINTETICE] Ciornă internă: aprobată intern (nu e acceptarea clientului), netrimisă. Ce nu e configurat în catalog rămâne „De stabilit (neconfigurat)”.", "",
    ...arr(c.sections).flatMap((s) => [`## ${line(s.heading, 160)}`, "", String(s.text || "").trim(), ""]),
    ...(arr(c.pricing).length ? ["## Prețuri și termene (stare explicită)", "", ...arr(c.pricing).map((p) => `- ${p.item === "price" ? "Preț" : "Termen"}: ${line(p.text, 200)}${p.status === "UNKNOWN" ? ` (UNKNOWN: ${line(p.reason, 80)})` : ""}`), ""] : []),
    ...(arr(c.claimsToVerify).length ? ["## De verificat înainte de orice folosire", "", ...arr(c.claimsToVerify).map((x) => `- ${line(x, 600)}`), ""] : []),
    "## Proveniență", "", ...provenanceLines(proposal).map((x) => `- ${x}`)];
  const offerText = [c.title, ...arr(c.sections).flatMap((s) => [s.heading, s.text])].map((x) => String(x || "")).join("\n");
  add(`oferta-v${v}.md`, md(offerLines), DOSSIER_GENERATORS.offerMd, offerInputs, offerText);
  const model = proposalDocxModel({ proposal });
  add(`oferta-v${v}.docx`, buildDocx(model, { created: new Date(proposal.createdAt) }), DOSSIER_GENERATORS.offerDocx, { ...offerInputs, model: hashCanonical(model) });

  // The synthetic company sheet: identity fields, never a contact value (those appear only in the draft).
  const orgInputs = { ...orgRender(facts), missing: arr(brief?.missing).map((m) => m.text) };
  add("fisa-firmei.md", md(["# Fișa firmei (sintetic)", "",
    "> DATE SINTETICE: firma nu există. Numele, domeniul .test și CUI-ul 99… sunt generate; ce a spus sau a dedus brieful e în dovezi.md, nu în fișă.", "",
    `- Denumire: ${line(org.displayName, 200)}`, `- Formă juridică: ${line(org.legalForm, 20) || "necunoscută"}`,
    `- CUI: ${line(org.fiscalCode, 20) || "UNKNOWN"} (${org.fiscalCodeValid === true ? "cifra de control validă" : "nevalidat"}; fictiv)`,
    `- Site: ${line(org.website, 200) || "UNKNOWN"}${org.domain ? ` (domeniu ${line(org.domain, 120)}, .test: nu se rezolvă)` : ""}`,
    `- Oraș / județ / CAEN în fișă: ${[org.city, org.county, org.caen].map((x) => line(x, 60)).filter(Boolean).join(" / ") || "necompletate (nimic dedus nu intră în fișă)"}`,
    `- Status: ${line(org.status, 40)}`,
    `- Contacte: ${orgInputs.contacts.length ? orgInputs.contacts.map((x) => `${x.kind}${x.generic ? " generic" : ""} (${x.status})`).join(", ") : "niciunul"} — adresele apar doar în ciorna-mesaj.md`, "",
    "## Ce lipsește (UNKNOWN, necompletat)", "", ...(orgInputs.unknowns.length || orgInputs.missing.length ? [...orgInputs.unknowns, ...orgInputs.missing].map((x) => `- ${line(x, 200)}`) : ["- nimic semnalat"])]),
    DOSSIER_GENERATORS.org, orgInputs);

  // The evidence, with its confidence label and its C-03 kind, source, date and bounded extract.
  const rows = evidenceRows(facts);
  const evInputs = { evidence: rows };
  add("dovezi.json", js({ schema: DOSSIER_SCHEMA, kind: "sales-dossier-evidence", orgId: org.id, note: "dataKind null = nedeclarat (M04)", evidence: rows }), DOSSIER_GENERATORS.evidence, evInputs);
  add("dovezi.md", md(["# Dovezi (cu proveniență)", "", "> Felul datei (FIXTURE / STATEMENT / INFERENCE) e separat de eticheta de încredere; o inferență nu devine afirmație.", "",
    ...rows.map((e) => `- [${e.dataKind || "nedeclarat (M04)"} · ${e.label}] ${line(e.claim, 120)}: ${line(valueText(e.value && typeof e.value === "object" && !Array.isArray(e.value) && Object.keys(e.value).length === 1 && Object.hasOwn(e.value, e.claim) ? e.value[e.claim] : e.value), 240)} — sursa: ${line(e.sourceRef, 200)}`
      + `${e.retrievedAt ? `, ${String(e.retrievedAt).slice(0, 10)}` : ""}${e.excerpt ? ` — „${line(e.excerpt, 160)}”` : ""}${e.basis.length ? ` — bază: ${e.basis.join(", ")}` : ""}${e.reasoning ? ` — raționament: ${line(e.reasoning, 200)}` : ""}`
      + `${e.freshness !== "CURRENT" ? ` (${e.freshness})` : ""}${e.usedInProposal ? " (folosită în ofertă)" : ""}`)]), DOSSIER_GENERATORS.evidence, evInputs);

  // The explained qualification: every point with its evidence ids, the inferences (no points), the overrides (reason kept).
  const q = qualification || null;
  const result = q?.result || {};
  const overrides = arr(result.overrides).map((o) => ({ priority: o.priority ?? null, reason: o.reason || "", at: o.at || null, authority: o.authority || null, basedOn: o.basedOn || null, by: "proprietar" }));
  const qualInputs = qualRender(facts);
  const doc = QUALIFICATION_FORMULA_DOCS[q?.formulaVersion] || [];
  add("calificare.json", js({ schema: DOSSIER_SCHEMA, kind: "sales-dossier-qualification", qualificationId: q?.id || null, formulaVersion: q?.formulaVersion || null, priority: q?.priority ?? null,
    computedPriority: result.computedPriority ?? null, components: result.components || {}, explanation: arr(result.explanation), unknowns: arr(result.unknowns), inferences: arr(result.inferences),
    unproven: arr(result.unproven), missing: arr(result.missing), financialFilter: result.financialFilter || null, overrides, formula: doc }), DOSSIER_GENERATORS.qualification, qualInputs);
  add("calificare.md", md([`# Calificare (${q?.formulaVersion || "necunoscută"})`, "", `Prioritate: ${q?.priority ?? "necunoscută"}/100 (internă; nu e o probabilitate de vânzare).`, "",
    "## Explicație", "", ...arr(result.explanation).map((x) => `- ${line(x, 400)}`), "",
    "## Puncte și dovezile lor", "", ...Object.entries(result.components || {}).flatMap(([name, comp]) => [`### ${name}: ${comp?.score ?? "necunoscută"}`, "",
      ...arr(comp?.contributions).map((x) => `- ${line(x.factor, 200)}: ${x.points} puncte${arr(x.evidenceIds).length ? ` (dovezi: ${arr(x.evidenceIds).join(", ")})` : " (fără dovadă: nu se punctează)"}`), ""]),
    "## Inferențe (nu se punctează)", "", ...(arr(result.inferences).length ? arr(result.inferences).map((i) => `- ${line(i.claim, 200)} (${arr(i.evidenceIds).join(", ") || "fără id"}): ${line(i.why, 200)}`) : ["- niciuna"]), "",
    "## Ce lipsește", "", ...(arr(result.missing).length ? arr(result.missing).map((x) => `- ${line(x, 200)}`) : ["- nimic"]), "",
    "## Suprascrieri ale proprietarului", "", ...(overrides.length ? overrides.map((o) => `- ${o.priority ?? "UNKNOWN"}: ${line(o.reason, 300)} (${[o.at, o.authority].filter(Boolean).join(", ")})`) : ["- niciuna"]), "",
    "## Formula", "", ...doc.map((x) => `- ${line(x, 400)}`)]), DOSSIER_GENERATORS.qualification, qualInputs);

  // The contact draft: DRAFT_ONLY, never sent (the transport is disabled); the synthetic .test address appears only here.
  const draftInputs = { draft: { id: draft.id, version: draft.version, contentSha: draft.contentSha, proposalSha: draft.meta?.proposalSha || null, subject: draft.subject, body: draft.body,
    recipients: arr(draft.recipients), claimsToVerify: arr(draft.meta?.claimsToVerify) } };
  add("ciorna-mesaj.md", md(["# CIORNĂ — DRAFT_ONLY — NETRIMISĂ (OUTREACH_DISABLED)", "",
    `- Ciorna ${draft.id}, versiunea ${draft.version}; sent: false; transport: DISABLED`, `- SHA-256 al conținutului: ${draft.contentSha}; oferta: ${draft.meta?.proposalSha || "UNKNOWN"}`,
    `- Destinatar (sintetic, .test, nu există): ${arr(draft.recipients).join(", ") || "UNKNOWN"}`, `- Subiect: ${line(draft.subject, 200)}`, "", "## Text", "", String(draft.body || "").trim(), "",
    "## De verificat înainte de orice trimitere (trimiterea e dezactivată)", "", ...(arr(draft.meta?.claimsToVerify).length ? arr(draft.meta.claimsToVerify).map((x) => `- ${line(x, 400)}`) : ["- nimic semnalat"])]),
    DOSSIER_GENERATORS.draft, draftInputs, `${draft.subject || ""}\n${draft.body || ""}`);

  // The human texts (Markdown) and the client texts carry no unresolved template field; JSON keeps its own null for an unknown value.
  const leftovers = out.flatMap((a) => (a.path.endsWith(".md") ? findUnresolvedPlaceholders(a.buf.toString("utf8")) : a.clientText ? findUnresolvedPlaceholders(a.clientText) : []));
  if (leftovers.length) throw new HubError("policy", `Dosarul ar conține câmpuri nerezolvate: ${[...new Set(leftovers)].slice(0, 5).join(", ")}`, { code: "SALES_DOSSIER_PLACEHOLDERS" });
  return out;
}

/** C-02 on the dossier: no commercial figure in the client texts (offer and draft) beyond the CONFIGURED catalog texts. */
export function dossierFigures(artifacts, { allow = [] } = {}) {
  const found = [];
  for (const a of artifacts) if (a.clientText) for (const f of findCommercialFigures(a.clientText, { allow })) found.push({ file: a.path, category: f.category, text: f.text });
  return found;
}

/**
 * R-REV for one artifact: reused only when the previous revision lists the same path and generator with an IDENTICAL inputsSha, the file
 * there still has its recorded sha256, and the artifact rebuilt now has exactly those bytes. → { buf (the previous bytes), reusedFrom } | null
 */
export function dossierArtifactReuse({ previous, artifact }) {
  if (!previous?.folder || !Array.isArray(previous.files)) return null;
  const prior = previous.files.find((f) => f.path === artifact.path && f.generator === artifact.generator && f.inputsSha === artifact.inputsSha);
  if (!prior) return null;
  let bytes;
  try { const st = fs.lstatSync(path.join(previous.folder, prior.path)); if (!st.isFile() || st.isSymbolicLink()) return null; bytes = fs.readFileSync(path.join(previous.folder, prior.path)); }
  catch { return null; }
  if (sha(bytes) !== prior.sha256 || sha(artifact.buf) !== prior.sha256) return null;
  return { buf: bytes, reusedFrom: { dossierId: previous.id, revision: previous.revision, file: prior.path, sha256: prior.sha256 } };
}

/** README.md: what the folder is, what was NOT done, every file with its sha, the verification levels, what was reused. */
export function dossierReadme({ dossierId, revision, createdAt, opportunityId, proposal, draft, files, verification, reused }) {
  const v = verification?.proposalDocx || {};
  return md([`# Dosarul ofertei — revizia ${revision}`, "",
    "> [DATE SINTETICE] Pregătit de Ifrim Agent Hub dintr-un singur plan confirmat. Nimic nu a fost trimis, publicat sau cheltuit; prețurile și termenele neconfigurate sunt „De stabilit (neconfigurat)”.", "",
    `- Dosarul: ${dossierId} (revizia ${revision}), creat la ${createdAt}`, `- Oportunitatea: ${opportunityId}`,
    `- Oferta: ${proposal.id}, versiunea ${proposal.version}, SHA-256 ${proposal.contentSha}, aprobată intern (APPROVED_INTERNAL, nu acceptarea clientului)`,
    `- Ciorna de contact: ${draft.id}, versiunea ${draft.version} — DRAFT_ONLY, netrimisă`, "",
    "## Fișiere", "", "| Fișier | Octeți | SHA-256 |", "|---|---|---|", ...files.map((f) => `| ${f.path} | ${f.bytes} | ${f.sha256} |`), "",
    "## Verificări", "", `- Documentul Word: ${v.file || "FILE_CHECKED"} · ${v.app || "APP_NOT_RUN"}${v.note ? ` — ${line(v.note, 300)}` : ""}`, "",
    ...(arr(reused).length ? ["## Refolosite din revizia anterioară (aceleași intrări, aceiași octeți, copiate aici)", "", ...arr(reused).map((r) => `- ${r.file} — sha256 ${r.sha256} — din dosarul ${r.source.dossierId} (revizia ${r.source.revision})`), ""] : []),
    `Etichete: ${DOSSIER_LABELS.join(", ")}. ${NOT_CONFIGURED} rămâne până când configurezi catalogul.`]);
}

/** manifest.json: relative paths only (a moved folder still verifies), the sha256 of every file (README included), written last. */
export function dossierManifest({ dossierId, revision, folderName, createdAt, opportunityId, orgId, proposal, draft, qualification, plan, files, reused, verification }) {
  return js({ schema: DOSSIER_SCHEMA, kind: "sales-dossier", dossierId, revision, opportunityId, orgId, folderName,
    proposal: { id: proposal.id, version: proposal.version, contentSha: proposal.contentSha, approvedSha: proposal.approvedSha, status: proposal.status },
    draft: { id: draft.id, version: draft.version, contentSha: draft.contentSha, status: draft.status, sent: false },
    qualification: qualification ? { id: qualification.id, formulaVersion: qualification.formulaVersion } : null,
    plan, files, ...(arr(reused).length ? { reused } : {}), verification,
    labels: DOSSIER_LABELS, synthetic: true, sent: false, published: false, spent: false, createdAt });
}

export { expectedDocxShape };
