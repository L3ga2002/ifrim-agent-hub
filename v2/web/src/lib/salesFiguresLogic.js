// M12 final review (F8, T-S7): the figures the Sales overview shows (pure, no DOM, no React) — covered by v2/tests/m12-real-figures.test.mjs.
// Without synthetic data they are exactly the M04 figures (GET /api/sales/overview → counts, unchanged). With synthetic data present the
// tiles, the company statuses and the pipeline are the REAL figures only (the server's additive split: `split.real` and `split.detail.real`),
// and the synthetic figures come apart, labelled as such — a synthetic row never inflates a real figure on the owner's screen.
import { countEntries, normalizeCounts, ORG_STATUSES, OPP_STATUSES } from "./salesLogic.js";

const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const inOrder = (order) => (a, b) => order.indexOf(a[0]) - order.indexOf(b[0]);

/**
 * → { mixed, tiles: [{ key, label, value }], byStatus: [[status, n]], pipeline: [[status, n]], synthetic: null | { orgs, qualified,
 * opportunities, proposals, drafts, preparations, dossiers } }. `mixed` only when the server says synthetic data exists AND sends the split
 * with both sides (an older answer without it keeps the M04 figures).
 */
export function overviewFigures(data) {
  const d = obj(data);
  const counts = obj(d.counts);
  const split = obj(d.split);
  const detail = obj(split.detail);
  const mixed = Boolean(d.synthetic) && Object.keys(obj(split.real)).length > 0 && Object.keys(obj(split.synthetic)).length > 0
    && Object.keys(obj(detail.real)).length > 0 && Object.keys(obj(detail.synthetic)).length > 0;
  if (!mixed) {
    return { mixed: false, tiles: countEntries(counts), byStatus: normalizeCounts(counts.byStatus ?? counts.orgsByStatus ?? counts.status).sort(inOrder(ORG_STATUSES)),
      pipeline: normalizeCounts(counts.opportunities ?? d.pipeline).sort(inOrder(OPP_STATUSES)), synthetic: null };
  }
  const real = obj(split.real);
  const realDetail = obj(detail.real);
  // The same tiles, in the same order and with the same labels as the M04 screen; each value from the real side. `needsReview` (rows of an
  // import waiting for an identity decision) is an action count of the imports, not a business figure: it keeps its value.
  const realValue = { orgs: real.orgs, qualified: real.qualified, audits: realDetail.audits, missingWebsite: realDetail.missingWebsite, missingContact: realDetail.missingContact,
    suppressions: realDetail.suppressions };
  const tiles = countEntries(counts).map((t) => (Object.hasOwn(realValue, t.key) ? { ...t, value: num(realValue[t.key]) } : t));
  const s = obj(split.synthetic);
  return { mixed: true, tiles, byStatus: normalizeCounts(obj(realDetail.byStatus)).sort(inOrder(ORG_STATUSES)), pipeline: normalizeCounts(obj(real.opportunities)).sort(inOrder(OPP_STATUSES)),
    synthetic: { orgs: num(s.orgs), qualified: num(s.qualified), opportunities: normalizeCounts(obj(s.opportunities)).sort(inOrder(OPP_STATUSES)), proposals: normalizeCounts(obj(s.proposals)),
      drafts: normalizeCounts(obj(s.drafts)), preparations: normalizeCounts(obj(s.preparations)), dossiers: normalizeCounts(obj(s.dossiers)) } };
}

/** The title of an overview panel: with synthetic data present, it says its figures are the real ones only. */
export const realOnlyTitle = (title, figures) => (figures?.mixed ? `${title} (doar date reale)` : title);
