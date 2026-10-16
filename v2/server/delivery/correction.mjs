// Pure correction compiler. All filesystem observations are supplied as facts by the service.
import { hashCanonical } from "../core/canonical.mjs";
import { citedCriteria } from "../media/claims.mjs";
import { resolvePresentation, freezePresentation, storyFromPresentation, provePresentation, claimState } from "./presentation.mjs";
import { captureScriptFrom, CAPTURE_PACING } from "./template.mjs";
import { E2E_RUN_TOKEN } from "../tools/browser-core.mjs";
import { summaryFactCheck, renderSummary } from "./summary.mjs";

export const CORRECTION_KIND = "delivery.correct";
export const LIVE_CORRECTION = ["PROPOSED", "CONFIRMED", "RUNNING", "PAUSED"];
const same = (a, b) => hashCanonical(a) === hashCanonical(b);
export function dedupeDefects(defects) {
  const seen = new Set();
  return defects.filter(d => {
    const key = JSON.stringify([d.code, d.where, d.itemId || null, d.text.replace(/^- /, '')]);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).sort((a, b) => Number(a.where.startsWith('summary.')) - Number(b.where.startsWith('summary.')));
}
// Owner-facing rows count affected texts; the audit retains every individual code.
export function groupDefects(defects) {
  const groups = new Map();
  for (const d of dedupeDefects(defects)) {
    const text = d.text.replace(/^- /, ''), key = JSON.stringify([d.where, d.itemId || null, text]);
    if (!groups.has(key)) groups.set(key, { ...d, text, reasons: [] });
    const group = groups.get(key);
    if (!group.reasons.some(r => r.code === d.code)) group.reasons.push({ code: d.code, plain: defectReason(d.code) });
  }
  return [...groups.values()].map(d => ({ ...d, plain: `${d.where}: ${d.text} — ${d.reasons.map(r => r.plain).join('; ')}` }));
}
function defectReason(code) {
  return ({
    SUMMARY_CITATION_UNBOUND: 'citarea nu corespunde afirmației aprobate',
    SUMMARY_LINE_NOT_CURATED: 'textul nu aparține prezentării aprobate',
    NARRATIVE_FROM_OTHER_SPEC: 'problema descrie altă specificație',
    TEXT_CITES_WRONG_CRITERION: 'textul citează alte criterii',
    TEXT_NOT_CURATED: 'textul nu aparține prezentării aprobate',
    CAPTURE_STEPS_OUTDATED: 'pașii capturați diferă de cei aprobați',
    CAPTURE_POSTCONDITION_FAILED: 'tastarea nu a produs valoarea cerută',
    CAPTURE_PROVENANCE: 'proveniența capturii nu este confirmată',
  })[code] || code;
}
export function irMetadata(ir) {
  const fps = (ir?.fps?.num || 30) / (ir?.fps?.den || 1);
  const textItems = (ir?.tracks || []).filter(t => t.kind === "text").flatMap(t => t.items).filter(i => /^t-/.test(i.id)).map(({ id, text, start, end }) => ({ id, text, start, end }));
  return { textItems, markers: (ir?.markers || []).map(m => ({ kind: m.kind, note: m.note, ms: Math.round(m.frame / fps * 1000) })),
    omitted: ['hook', 'desktop', 'mobile', 'cta'].filter(s => !textItems.some(i => i.id === 't-' + s)).map(s => ({ id: 't-' + s, reason: 'NOT_IN_VERSION' })),
    holds: Object.fromEntries((ir?.tracks || []).filter(t => t.kind === 'video').flatMap(t => t.clips).map(c => [c.id, (c.holds || []).length])) };
}
export function presentationAudit({ delivery, effectiveTemplate, spec, specSha, catalog, master, vertical, summary, captures = [], claimFacts }) {
  const t = effectiveTemplate || delivery.template;
  const presentation = resolvePresentation({ presentations: catalog, spec, specSha, noun: t.story.noun, captures: t.captures });
  const proofs = provePresentation(presentation, claimFacts), defects = [], recapture = {};
  const add = (code, where, text, extra = {}) => defects.push({ code, where, text, cited: citedCriteria(text), expected: [], plain: `${where}: ${text}`, ...extra });
  for (const [where, edit] of [["master", master], ["vertical", vertical]]) {
    for (const item of irMetadata(edit?.ir).textItems) {
      const slot = item.id.slice(2), claim = presentation.claims.find(c => c.key === `clip.${slot}`);
      const override = where === "vertical" && presentation.claims.find(c => c.key === `variant.${slot === "hook" ? "hookText" : slot === "cta" ? "ctaText" : ""}`);
      const shown = claim && claimState(claim, proofs).shown;
      const texts = shown ? (override && claimState(override, proofs).shown ? [override.texts.text] : Object.values(claim.texts)) : [];
      const cited = citedCriteria(item.text), expected = shown ? claim.needs.map(n => n.id) : [];
      const extra = { itemId: item.id, range: { start: item.start, end: item.end }, expected };
      if (cited.length && !same([...cited].sort(), [...expected].sort())) add("TEXT_CITES_WRONG_CRITERION", where, item.text, extra);
      if (!texts.includes(item.text)) add("TEXT_NOT_CURATED", where, item.text, extra);
    }
  }
  if (summary) {
    for (const f of summaryFactCheck({ doc: summary, presentation, proofs, spec }).findings) add(f.code, `summary.${f.sectionId}`, f.text);
    const fresh = renderSummary({ presentation, proofs, manifest: claimFacts.manifest, issue: t.issueTitle, generatedAt: "audit" });
    for (const section of summary.sections || []) {
      if (section.source === "owner" || !["problem", "demonstrated", "how", "benefits"].includes(section.id)) continue;
      const expected = fresh.sections.find(s => s.id === section.id)?.text.split("\n") || [];
      for (const line of section.text.split("\n").filter(Boolean)) if (!expected.includes(line)) add(section.id === "problem" ? "NARRATIVE_FROM_OTHER_SPEC" : "SUMMARY_LINE_NOT_CURATED", `summary.${section.id}`, line);
    }
  }
  for (const role of ["desktop", "mobile"]) {
    const cap = t.captures.find(c => c.role === role), item = captures.find(c => c.role === role);
    const criterion = spec.acceptance.find(c => c.id === cap?.criterion);
    const script = captureScriptFrom(criterion?.steps, { noun: t.story.noun, role, proofSelector: cap?.proofSelector });
    const reasons = [];
    const defect = (code, text) => { reasons.push(code); add(code, `capture.${role}`, text, { itemId: item?.id }); };
    // Compiler pacing/markers can change without invalidating old footage. Only repeated fills that
    // the current compiler collapses AND the frozen capture still typed require this correction.
    const repeatedTyping = script.collapsed.filter(c => c.kind === 'fill').some(c => {
      const fill = criterion.steps[c.step - 1].fill;
      const text = String(fill.value).split(E2E_RUN_TOKEN).join(CAPTURE_PACING.runWord);
      const count = steps => (steps || []).filter(s => s.type?.selector === fill.selector && s.type.text === text).length;
      return count(cap?.steps) > count(script.steps);
    });
    if (repeatedTyping && item?.meta?.stepsSha !== hashCanonical(script.steps)) defect("CAPTURE_STEPS_OUTDATED", "Captura a tastat o valoare de două ori; compilatorul actual elimină repetarea.");
    if ((item?.meta?.holdsRejected || []).some(h => h.code === "HOLD_POSTCONDITION_FAILED" && (h.reason === "typing" || h.reason === "type" || cap?.steps?.[h.step - 1]?.type))) defect("CAPTURE_POSTCONDITION_FAILED", "Tastarea nu a produs valoarea cerută.");
    if (!item?.actualSha || item.actualSha !== item.refSha) defect("CAPTURE_PROVENANCE", "Fișierul capturii lipsește sau amprenta lui diferă.");
    recapture[role] = { needed: reasons.length > 0, reasons };
  }
  return { defects: dedupeDefects(defects), presentation, recapture };
}

export function buildCorrectionRecord({ delivery: d, audit, base, version, summary, master, vertical, tone = 'both', summaryPreview, continuation = false, facts }) {
  const story = storyFromPresentation(audit.presentation), captures = {}, outputs = [];
  const proofs = facts && provePresentation(audit.presentation, facts);
  for (const [role, edit, format] of [["master", master, "16:9"], ["vertical", vertical, "9:16"]]) {
    for (const [slot, texts] of Object.entries(story.texts)) {
      const old = irMetadata(edit?.ir).textItems.find(i => i.id === "t-" + slot)?.text || "omis";
      const override = role === "vertical" && story.overrides[slot === "hook" ? "hookText" : slot === "cta" ? "ctaText" : ""];
      const chosen = tone === 'both' ? (['hook', 'cta'].includes(slot) ? 'business' : 'technical') : tone;
      const claim = audit.presentation.claims.find(c => c.key === 'clip.' + slot);
      const shown = !proofs || claimState(claim, proofs).shown;
      const text = shown ? override || texts[chosen] : 'omis', other = shown ? override || texts[chosen === 'business' ? 'technical' : 'business'] : 'omis';
      if (old !== text) outputs.push(`${slot} (${format}): «${old}» → «${text}»${other !== text ? ` (tonul celălalt: «${other}»)` : ''}`);
    }
  }
  if (!continuation) for (const section of summaryPreview?.sections || []) {
    if (section.text === summary?.sections.find(s => s.id === section.id)?.text) continue;
    const reason = section.id === 'video' ? 'clipuri noi' : section.id === 'provenance' ? 'trasabilitate'
      : audit.defects.some(d => d.where === 'summary.' + section.id && /CIT|CRITERION/.test(d.code)) ? 'citări corectate' : 'narațiune pentru specificația aprobată';
    outputs.push(`Rezumat, ${section.heading}: ${reason}`);
  }
  for (const role of ["desktop", "mobile"]) {
    const old = d.template.captures.find(c => c.role === role), r = audit.recapture[role];
    const criterion = audit.presentation.captures[role]?.id || old.criterion;
    captures[role] = { action: r.needed ? "recapture" : "reuse", reasons: r.reasons, criterion };
    if (r.needed) outputs.push(`Filmez din nou ${role === "mobile" ? "telefon" : "desktop"}: ${r.reasons.includes("CAPTURE_POSTCONDITION_FAILED") ? "tastarea telefonului era dublată" : "pașii sau proveniența capturii trebuie corectate"}`);
  }
  if (Object.values(captures).every(c => c.action === "reuse")) outputs.push("Refolosesc capturile (aceleași fișiere, sha verificat)");
  const n = (d.generation || 1) + (base.exportCount || 0), sn = (summary?.version || 0) + 1;
  if (!continuation) outputs.push(`Fișiere noi: demo-16x9-v${n}.mp4, demo-9x16-v${n}.mp4, rezumat-v${sn}.md/.html`);
  const extras = d.template.extras || [], indexed = extras.length || d.template.reused?.length;
  const office = { document: extras.includes("document") ? "rebuild-or-keep" : "none", campaign: extras.includes("campaign") ? "rebuild-or-keep" : "none", workbook: extras.includes("workbook") || d.template.reused?.some(r => r.kind === "workbook") ? "keep-by-proof" : "none", index: indexed ? "write-new" : "none" };
  if (office.document !== "none") outputs.push(`Prezentare demo v${version + 1}.docx + PDF, sau fișierele identice păstrate prin dovadă`);
  if (office.campaign !== "none") outputs.push(`Campanie v${version + 1}, sau fișierele identice păstrate prin dovadă`);
  if (indexed) outputs.push(`manifest-v${version + 1}.json, README-v${version + 1}.md`);
  outputs.push(`Software-ul, pachetul ${d.bundleId}, specificația și versiunile v1 rămân neschimbate; aprobările se dau din nou de tine.`);
  const { exportCount, ...frozenBase } = base;
  return { schema: 1, kind: "presentation-correction", version, deliveryId: d.id, reason: "Corectez afirmațiile și capturile după criteriile aprobate.", defects: audit.defects, base: frozenBase, presentation: audit.presentation, story: { ...story, overridesSha: hashCanonical(story.overrides) }, captures, office, outputs };
}

export function overlayCorrection(template, record) {
  if (!record) return template;
  return { ...template, presentation: record.presentation, story: { ...template.story, texts: record.story.texts, variant: { ...template.story.variant, overrides: record.story.overrides, overridesSha: record.story.overridesSha } },
    captures: template.captures.map(c => record.captures[c.role]?.action === "recapture" || record.captures[c.role]?.steps ? { ...c, ...record.captures[c.role] } : c) };
}
export function correctionSteps(template, deliveryId, revisionId, record) {
  const steps = [], add = (kind, title, params = {}) => { steps.push({ kind, title, params }); return steps.length; }, ref = (n, key) => `$pas:${n}.${key}`;
  const ids = { deliveryId, revisionId };
  add("delivery.correct.prepare", "Verifică baza corecturii confirmate", { ...ids, correctionSha: hashCanonical(record) });
  if (record.continuation) {
    for (const [key, kind] of [["document", "delivery.office.document"], ["campaign", "delivery.campaign"], ["index", "delivery.package.index"]]) if (record.office[key] !== "none") add(kind, `Actualizează ${key} fără suprascriere`, ids);
    add('delivery.finish', 'Încheie corectura și păstrează istoricul', { ...ids, mode: 'correction' });
    return freezePresentation(steps);
  }
  if (Object.values(record.captures).some(c => c.action === "recapture")) add("delivery.preview.ensure", "Pornește preview-ul versiunii verificate", ids);
  for (const role of ["desktop", "mobile"]) if (record.captures[role].action === "recapture") add("delivery.capture", `Filmează din nou ${role}`, { ...ids, role });
  const edit = add("delivery.edit.build", "Corectează afirmațiile în același proiect de montaj", ids);
  const render = add("media.render", "Randează 16:9 și verifică factual", { editVersionId: ref(edit, "editVersionId"), profile: "final", qaUse: "internal" });
  const variant = add("media.variant.render", "Randează 9:16 și verifică factual", { masterVersionId: ref(edit, "editVersionId"), platformKey: template.story.variant.platformKey, qaUse: "internal", overrides: record.story.overrides });
  add("delivery.export", "Exportă versiuni noi ale clipurilor", { ...ids, master: ref(render, "assetVersionId"), vertical: ref(variant, "assetVersionId") });
  add("delivery.summary.render", "Corectează rezumatul, păstrând textele tale", { ...ids, only: "correction" });
  for (const [key, kind] of [["document", "delivery.office.document"], ["campaign", "delivery.campaign"], ["index", "delivery.package.index"]]) if (record.office[key] !== "none") add(kind, `Actualizează ${key} fără suprascriere`, ids);
  add("delivery.finish", "Încheie corectura și păstrează istoricul", { ...ids, mode: "correction", render: ref(render, "renderJobId"), variant: ref(variant, "variantId"), verticalEdit: ref(variant, "editVersionId") });
  return freezePresentation(steps);
}
