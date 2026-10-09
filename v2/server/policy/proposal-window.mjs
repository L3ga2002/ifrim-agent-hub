// Stage before M12 (§7 cards): how long a PROPOSED plan stays on the server, visible and confirmable in every eligible page of the owner.
//
// The display window of a proposal is separate from the authority a confirmation derives: the authority is still computed from the
// plan's own maximum duration at the moment of confirmation (envelopes / ops plans), and every confirmation re-checks the plan's hash,
// nonce and readiness. A longer display window only means the owner does not have to send the sentence again after a normal absence.
//
//   setting `proposalWindowMin` (5–1440)   the owner's explicit choice, when set
//   local development profile active        1440 min (24 h)
//   otherwise                               the historical 15 min
export const PROPOSAL_WINDOW = Object.freeze({ defaultMin: 15, devProfileMin: 24 * 60, minMin: 5, maxMin: 24 * 60 });

export function proposalWindowMin({ settings = null, trust = null } = {}) {
  let explicit = null;
  try { explicit = settings?.get?.("proposalWindowMin"); } catch { explicit = null; }
  if (Number.isInteger(explicit) && explicit >= PROPOSAL_WINDOW.minMin && explicit <= PROPOSAL_WINDOW.maxMin) return explicit;
  let dev = false;
  try { dev = Boolean(trust?.devProfile?.()?.enabled); } catch { dev = false; }
  return dev ? PROPOSAL_WINDOW.devProfileMin : PROPOSAL_WINDOW.defaultMin;
}
