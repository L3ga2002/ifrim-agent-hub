// Curated prose binds to exact stored criterion contents, never to the spelling of its id.
import { hashCanonical } from "../core/canonical.mjs";
import { criterionFingerprint, criterionProof } from "../media/claims.mjs";
import { normalizeRo } from "../media/captions.mjs";
import { factsIn } from "./summary.mjs";
import { textViolations } from "./capture-guard.mjs";

const slots = ["hook", "desktop", "mobile", "cta"];
const clone = (v) => JSON.parse(JSON.stringify(v));
export function freezePresentation(v) { if (v && typeof v === "object") { Object.values(v).forEach(freezePresentation); Object.freeze(v); } return v; }
export function normalizePresentation(input) {
  const problems = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) return { presentation: null, problems: ["presentations: definiție lipsă"] };
  const p = clone(input), refs = p.reference?.criteria || {};
  const fail = (at, why) => problems.push(`${p.key || "presentation"}.${at}: ${why}`);
  const object = v => v && typeof v === "object" && !Array.isArray(v);
  if (!object(p.reference) || !object(refs) || !object(p.clip) || !object(p.summary)
    || (p.variant !== undefined && !object(p.variant))
    || slots.some(slot => !object(p.clip?.[slot]))
    || Object.values(refs).some(r => !object(r))
    || ["problem", "how"].some(k => p.summary?.[k] != null && !object(p.summary[k]))
    || (p.summary?.how != null && !Array.isArray(p.summary.how.lines))
    || ["demonstrates", "benefits"].some(k => p.summary?.[k] !== undefined && (!Array.isArray(p.summary[k]) || p.summary[k].some(c => !object(c))))
    || ["limits", "questions"].some(k => p.summary?.[k] != null && !Array.isArray(p.summary[k]))) {
    fail("shape", "structura prezentării este invalidă"); return { presentation: p, problems };
  }
  if (!/^[a-z][a-z0-9-]{1,60}$/.test(p.key || "") || !Number.isInteger(p.version) || p.version < 1 || !p.label) fail("key/version/label", "identitate invalidă");
  if (!/^[a-f0-9]{64}$/.test(p.reference?.specSha || "") || !p.reference?.label) fail("reference", "referință invalidă");
  for (const [id, r] of Object.entries(refs)) if (!/^AC-\d{1,3}$/.test(id) || !/^[a-f0-9]{64}$/.test(r.fp || "") || !["test", "e2e", "preview", "review"].includes(r.verify)) fail("reference.criteria", "criteriu invalid");
  const needs = (list, at, anchor = false) => {
    if (!Array.isArray(list) || (anchor && !list.length) || new Set(list).size !== list.length) { fail(at, "listă de criterii distincte necesară"); return []; }
    for (const id of list) if (!refs[id]) fail(at, `criteriul ${id} nu există în referință`);
    if (!anchor && list.length > 1 && list.some(id => ["review", "preview"].includes(refs[id]?.verify))) fail(at, "un review sau preview dovedește doar propria verificare și apare singur");
    return list;
  };
  const line = (text, at, ns = [], clip = false) => {
    if (typeof text !== "string" || /[\r\n\u0000-\u001f\u007f]/.test(text)) fail(at, "text simplu, pe un rând");
    const t = normalizeRo(String(text ?? ""));
    if (!t || t.length > (clip ? 120 : 240) || /[\r\n\u0000-\u001f\u007f]/.test(t)) fail(at, `text de 1–${clip ? 120 : 240} de caractere, pe un rând`);
    if (/AC-\d/i.test(t)) fail(at, "textul nu poate numi un criteriu literal; folosește {cite}");
    if (t.includes("{cite}") && (!clip || !ns.length)) fail(at, "{cite} este permis doar în clipuri cu criterii");
    if (textViolations(t).length) fail(at, "textul nu poate conține secrete, căi de pe calculator sau adrese reale");
    if (!clip && factsIn(t).length) fail(at, "textul afirmă fapte fără sursă");
    return t;
  };
  p.anchors = needs(p.anchors, "anchors", true);
  for (const slot of slots) {
    const c = p.clip?.[slot];
    if (!c) { fail(`clip.${slot}`, "lipsește"); continue; }
    c.needs = needs(c.needs, `clip.${slot}.needs`);
    for (const tone of ["business", "technical"]) c[tone] = line(c[tone], `clip.${slot}.${tone}`, c.needs, true);
  }
  for (const [k, t] of Object.entries(p.variant || {})) {
    if (!["hookText", "ctaText"].includes(k)) fail(`variant.${k}`, "doar hookText și ctaText se pot schimba în varianta verticală");
    p.variant[k] = line(t, `variant.${k}`, p.clip?.[k === "hookText" ? "hook" : "cta"]?.needs || [], true);
  }
  const check = (c, at) => {
    if (!c) return;
    c.needs = needs(c.needs, `${at}.needs`);
    if (Array.isArray(c.lines)) c.lines = c.lines.map((t) => line(t, at));
    else c.text = line(c.text, at);
  };
  check(p.summary?.problem, "summary.problem"); check(p.summary?.how, "summary.how");
  for (const k of ["demonstrates", "benefits"]) (p.summary?.[k] || []).forEach((c, i) => check(c, `summary.${k}.${i}`));
  for (const k of ["limits", "questions"]) if (p.summary?.[k]) p.summary[k] = p.summary[k].map(t => line(t, `summary.${k}`));
  if (p.summary?.questions?.length > 8) fail("summary.questions", "cel mult 8 întrebări");
  return { presentation: p, problems };
}

export function resolvePresentation({ presentations = [], spec, specSha, noun = "demo", captures = {} }) {
  const catalog = presentations.map(p => normalizePresentation(p)).filter(p => !p.problems.length).map(p => p.presentation);
  const catalogSha = hashCanonical(presentations.map(p => normalizePresentation(p).presentation));
  const items = spec?.acceptance || [], previewCommand = spec?.verification?.preview?.command ?? null;
  const fps = new Map();
  for (const c of items) { const fp = criterionFingerprint(c, { previewCommand }); fps.set(fp, [...(fps.get(fp) || []), c.id]); }
  const applies = catalog.filter(p => p.anchors.every(id => fps.get(p.reference.criteria[id].fp)?.length === 1));
  const p = applies.length === 1 ? applies[0] : null;
  const captureClaims = {};
  const capOf = role => Array.isArray(captures) ? captures.find(c => c.role === role) : captures[role];
  for (const role of ["desktop", "mobile"]) {
    const cap = capOf(role), item = items.find(c => c.id === (cap?.criterion || cap?.id));
    if (item?.verify === "e2e") captureClaims[role] = { id: item.id, fp: criterionFingerprint(item), verify: "e2e", text: `${item.id}: ${item.text}` };
  }
  const out = { schema: 1, status: p ? "CURATED" : "GENERATED", key: p?.key ?? null, version: p?.version ?? null,
    reason: p ? null : { code: applies.length ? "AMBIGUOUS" : "NONE", keys: applies.map(p => p.key) }, catalogSha, specSha, referenceSpecSha: p?.reference.specSha ?? null,
    claims: [], captures: captureClaims, limits: p?.summary?.limits || [], questions: p?.summary?.questions ?? null };
  const bind = (key, refs, texts, reference) => {
    let reason = null;
    const needs = refs.map(refId => {
      const r = reference[refId], ids = fps.get(r.fp) || [];
      if (ids.length !== 1 && !reason) reason = { code: ids.length ? "CRITERION_AMBIGUOUS" : "CRITERION_MISSING", refId,
        plain: `criteriul de referință ${refId} ${ids.length ? "se potrivește cu mai multe criterii" : "nu există cu același conținut în specificația aprobată"}` };
      return { refId, id: ids.length === 1 ? ids[0] : null, fp: r.fp, verify: r.verify };
    });
    const cite = needs.map(n => n.id).filter(Boolean).join(" + ");
    const render = t => reason ? t : t.replaceAll("{cite}", cite);
    out.claims.push({ key, needs, status: reason ? "UNBOUND" : "BOUND", reason, texts: Object.fromEntries(Object.entries(texts).map(([k, t]) => [k, Array.isArray(t) ? t.map(render) : render(t)])) });
  };
  if (p) {
    for (const slot of slots) { const c = p.clip[slot]; bind(`clip.${slot}`, c.needs, { business: c.business, technical: c.technical }, p.reference.criteria); }
    for (const [key, text] of Object.entries(p.variant || {})) bind(`variant.${key}`, p.clip[key === "hookText" ? "hook" : "cta"].needs, { text }, p.reference.criteria);
    for (const key of ["problem", "how"]) { const c = p.summary?.[key]; if (c) bind(`summary.${key}`, c.needs, c.lines ? { lines: c.lines } : { text: c.text }, p.reference.criteria); }
    for (const key of ["demonstrates", "benefits"]) (p.summary?.[key] || []).forEach((c, i) => bind(`summary.${key}.${i}`, c.needs, { text: c.text }, p.reference.criteria));
  } else {
    bind("clip.hook", [], { business: `Demo local: ${noun}`, technical: `Demo local: ${noun}` }, {});
    for (const role of ["desktop", "mobile"]) {
      const c = captureClaims[role], item = items.find(i => i.id === c?.id);
      const vp = item?.steps?.find(s => s.viewport)?.viewport || { width: 1280, height: 800 };
      if (c) out.claims.push({ key: `clip.${role}`, needs: [{ refId: c.id, id: c.id, fp: c.fp, verify: c.verify }], status: "BOUND", reason: null,
        texts: { business: role === "desktop" ? "Fluxul pe desktop, verificat în browser" : "Același flux la lățimea unui telefon",
          technical: role === "desktop" ? `${c.id}: E2E desktop ${vp.width}×${vp.height} trecut` : `${c.id}: E2E ${vp.width} px trecut` } });
    }
    bind("clip.cta", [], { business: "Hai să discutăm", technical: "Pachet local, gata de verificare" }, {});
    bind("variant.hookText", [], { text: "Demo local" }, {}); bind("variant.ctaText", [], { text: "Hai să vorbim" }, {});
  }
  return freezePresentation(clone(out));
}

export function storyFromPresentation(p) {
  const texts = {}, overrides = {};
  for (const c of p.claims) {
    if (c.key.startsWith("clip.")) texts[c.key.slice(5)] = { criteria: c.needs.map(n => n.id).filter(Boolean), ...c.texts, claim: c.key, ...(c.status === "UNBOUND" ? { unbound: true } : {}) };
    if (c.key.startsWith("variant.") && c.status === "BOUND") overrides[c.key.slice(8)] = c.texts.text;
  }
  return { texts, overrides };
}
export function presentationForTemplate(template, facts) {
  return template.presentation || freezePresentation({ ...resolvePresentation({ presentations: [], spec: facts.spec, specSha: facts.specRow.sha256, noun: template.story.noun, captures: template.captures }), origin: "legacy-generated" });
}
export function provePresentation(p, facts) {
  const proofs = {};
  for (const item of facts.spec.acceptance) proofs[item.id] = criterionProof({ ...facts, id: item.id, expectedFp: criterionFingerprint(item, { previewCommand: facts.spec.verification?.preview?.command ?? null }), previewCommand: facts.spec.verification?.preview?.command ?? null });
  // Frozen expectations replace current fingerprints for all claims and footage.
  for (const need of [...p.claims.flatMap(c => c.needs), ...Object.values(p.captures)]) if (need.id) proofs[need.id] = criterionProof({ ...facts, id: need.id, expectedFp: need.fp, previewCommand: facts.spec.verification?.preview?.command ?? null });
  return proofs;
}
export function claimState(c, proofs = {}) {
  if (c.status !== "BOUND") return { shown: false, code: "CLAIM_UNBOUND", plain: c.reason?.plain || "afirmația nu este legată de criteriile aprobate" };
  for (const n of c.needs) {
    const p = proofs[n.id];
    if (!p?.ok || p.fpNow !== n.fp) return { shown: false, code: p?.problems?.[0]?.code || (p?.ok ? "CRITERION_CHANGED" : "EVIDENCE_MISSING"), plain: p?.problems?.[0]?.message || "criteriul nu are dovada corespunzătoare" };
  }
  return { shown: true };
}
