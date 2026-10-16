// Convert historical test data into a curated catalog without changing its expected rendered prose.
import { hashCanonical } from "../../server/core/canonical.mjs";
import { criterionFingerprint } from "../../server/media/claims.mjs";
export function presentationFromBlock(spec, block) {
  const reference = { label: "Test reference", specSha: hashCanonical(spec), previewCommand: spec.verification.preview.command,
    criteria: Object.fromEntries(spec.acceptance.map(c => [c.id, { verify: c.verify, fp: criterionFingerprint(c, { previewCommand: spec.verification.preview.command }) }])) };
  const summary = block.summary || {};
  const lines = list => (list || []).map(c => ({ needs: c.criteria, text: c.text }));
  return { key: "booking-mobile-fix", version: 1, label: "Test booking", reference, anchors: ["AC-1"],
    clip: Object.fromEntries(Object.entries(block.texts).map(([slot, c]) => [slot, { needs: c.criteria, business: c.business,
      technical: c.technical.replace(/AC-1 \+ AC-6|AC-1/g, "{cite}") }])), variant: block.variant.overrides,
    summary: { problem: summary.problem ? { needs: ["AC-1"], text: summary.problem } : null, demonstrates: lines(summary.demonstrates),
      how: summary.how ? { needs: summary.how.criteria, lines: summary.how.lines } : null, benefits: lines(summary.benefits), limits: [], questions: summary.questions || [] } };
}
