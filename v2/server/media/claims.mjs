// Criterion identity and proof are pure: callers supply the stored manifest and database rows.
import { hashCanonical } from "../core/canonical.mjs";
import { createHash } from "node:crypto";
import { normalizeRo } from "./captions.mjs";

export const displaySha = text => createHash("sha256").update(normalizeRo(text)).digest("hex");

export const CRITERION_FP_SCHEMA = "ifrim.criterion-fp/1";
export const normalizeCriterionText = (t) => String(t ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
export function criterionFingerprint(item, { previewCommand = null } = {}) {
  const verify = item.verify;
  return hashCanonical({ schema: CRITERION_FP_SCHEMA, verify, text: normalizeCriterionText(item.text),
    ...(verify === "test" ? { testRef: item.testRef ?? null, kind: item.kind ?? null, guard: item.guard === true, expectFailure: item.expectFailure ?? null } : {}),
    ...(verify === "e2e" ? { steps: item.steps ?? null } : {}), ...(verify === "preview" ? { previewCommand } : {}) });
}
export function citedCriteria(text) {
  return [...new Set((String(text ?? "").match(/(?<![A-Za-z0-9])AC-\d{1,3}(?!\d)/gi) || []).map((id) => id.toUpperCase()))];
}
export const criterionRef = (specSha, id) => `${specSha}#${id}`;
export function parseCriterionRef(ref) {
  const m = /^([a-f0-9]{64})#(AC-\d{1,3})$/.exec(String(ref ?? ""));
  return m ? { specSha: m[1], id: m[2] } : null;
}
// Exactly the statuses emitted by factory.buildBundle, per verification method.
export const PASS_BY_METHOD = Object.freeze({ test: Object.freeze(["PASS_EVIDENCE"]), e2e: Object.freeze(["PASS_EVIDENCE"]), preview: Object.freeze(["PASS_EVIDENCE"]), review: Object.freeze(["PASS_REVIEW"]) });
const parsed = (v, fallback) => { if (typeof v !== "string") return v ?? fallback; try { return JSON.parse(v); } catch { return fallback; } };
export function criterionProof({ manifest, bundle, id, expectedFp, evidenceRows = [], reviewRows = [], previewCommand = manifest?.start?.command ?? null }) {
  const problems = [], evidence = [];
  const bad = (code, message) => problems.push({ code, message });
  if (!manifest || hashCanonical(manifest) !== bundle?.sha256) bad("BUNDLE_CHANGED", "Amprenta pachetului nu corespunde manifestului.");
  if (!["READY_FOR_OWNER_ACCEPTANCE", "OWNER_ACCEPTED"].includes(bundle?.status)) bad("BUNDLE_NOT_READY", "Pachetul nu mai este verificat pentru livrare.");
  const matches = (manifest?.spec?.criteria || []).filter((c) => c.id === id);
  const item = matches.length === 1 ? matches[0] : null;
  const fpNow = item ? criterionFingerprint(item, { previewCommand }) : null;
  if (!item) bad(matches.length ? "CRITERION_AMBIGUOUS" : "CRITERION_MISSING", "Criteriul nu există o singură dată în pachet.");
  else {
    if (fpNow !== expectedFp) bad("CRITERION_CHANGED", "Conținutul criteriului s-a schimbat.");
    if (!PASS_BY_METHOD[item.verify]?.includes(item.status)) bad("CRITERION_NOT_PASS", "Criteriul nu are o verificare trecută prin metoda declarată.");
    if (!item.evidence?.length) bad("EVIDENCE_MISSING", "Criteriul nu are dovezi.");
    const review = item.verify === "review";
    const entries = review ? manifest.reviews || [] : manifest.evidence || [];
    const rows = review ? reviewRows : evidenceRows;
    const resolved = [];
    for (const ref of item.evidence || []) {
      const m = entries.find((e) => e.id === ref), row = rows.find((e) => e.id === ref);
      if (!m || !row) { bad("EVIDENCE_MISSING", `Dovada ${ref} lipsește din manifest sau din baza de date.`); continue; }
      if ((!review && row.stale !== 0) || (review && row.stale != null && row.stale !== 0)) bad("EVIDENCE_STALE", `Dovada ${ref} este învechită.`);
      if (row.change_set_id !== bundle.change_set_id) bad("EVIDENCE_STALE", `Dovada ${ref} aparține altei versiuni.`);
      evidence.push({ id: ref, stage: review ? "REVIEW" : row.stage, status: row.status });
      resolved.push({ m, row });
      if (review) {
        if (m.status !== "VALID" || m.verdict !== "PASS" || !Array.isArray(m.problems) || m.problems.length || m.changeSet !== manifest.changeSet?.sha256?.slice(0, 12)
          || row.status !== "VALID" || row.verdict !== "PASS" || parsed(row.validation_json ?? row.validation, {}).problems?.length) bad("EVIDENCE_NOT_PASS", "Review-ul independent al modificării nu este VALID/PASS.");
        continue;
      }
      const stage = { test: "QA", e2e: "E2E", preview: "PREVIEW" }[item.verify];
      if (!stage || m.stage !== stage || row.stage !== stage) bad("EVIDENCE_STAGE", `Dovada ${ref} nu este din etapa ${stage || item.verify}.`);
      if (m.status !== "PASS" || row.status !== "PASS") bad("EVIDENCE_NOT_PASS", `Dovada ${ref} nu a trecut.`);
      if (m.command !== row.command) bad("EVIDENCE_COMMAND", `Comanda dovezii ${ref} nu corespunde manifestului.`);
      if (item.verify === "test") {
        for (const counts of [m.counts, parsed(row.counts ?? row.counts_json, {})]) if (!(counts?.tests > 0 && counts.fail === 0 && counts.skipped === 0 && counts.todo === 0)) bad("EVIDENCE_NOT_PASS", "Testele trebuie să treacă fără eșecuri, omisiuni sau TODO.");
      } else if (item.verify === "e2e") {
        const detail = parsed(row.detail ?? row.detail_json, {});
        if (row.command !== `e2e ${id}`) bad("EVIDENCE_COMMAND", "Comanda E2E nu corespunde criteriului.");
        if (detail.criterion !== id || !Array.isArray(item.steps) || !item.steps.length || !Array.isArray(detail.steps) || detail.steps.length !== item.steps.length || detail.steps.some((s, i) => s?.ok !== true || s.kind !== Object.keys(item.steps[i] || {})[0])) bad("EVIDENCE_STEPS", "Pașii E2E nu corespund criteriului aprobat sau nu au trecut.");
      } else if (item.verify === "preview" && (row.command !== previewCommand || previewCommand !== manifest.start?.command)) bad("EVIDENCE_COMMAND", "Comanda preview nu corespunde specificației aprobate.");
    }
    if (item.verify === "test") {
      if (!resolved.some(({ row }) => row.command === `node --test ${item.testRef}`) || !manifest.spec?.protectedTests?.[item.testRef]) bad("EVIDENCE_MISSING", "Lipsește testul protejat executat prin comanda exactă.");
      if (item.provenance === "hub_authored") {
        const a = manifest.acceptanceTest, rid = a?.reviewer?.reviewId;
        const mr = manifest.reviews?.find((r) => r.id === rid), rr = reviewRows.find((r) => r.id === rid);
        if (a?.ref !== item.testRef || a?.sha !== manifest.spec.protectedTests[item.testRef] || a?.proof?.verdict !== "PROVEN"
          || mr?.status !== "VALID" || mr?.verdict !== "PASS" || !Array.isArray(mr?.problems) || mr.problems.length || rr?.status !== "VALID" || rr?.verdict !== "PASS"
          || parsed(rr?.validation_json ?? rr?.validation, {}).problems?.length || (rr?.stale != null && rr.stale !== 0)) bad("EVIDENCE_NOT_PASS", "Testul scris de Hub nu are proba și review-ul independent cerute.");
      }
    }
  }
  return { ok: !problems.length, id, fp: expectedFp, fpNow, verify: item?.verify ?? null, status: item?.status ?? null, evidence, problems };
}
