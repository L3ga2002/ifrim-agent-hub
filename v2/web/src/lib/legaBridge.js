/**
 * Hand-off between Lega's live events and the screens they concern. Lega's panel receives `lega.point` / `lega.prefill`
 * for its own session, navigates, then leaves the request here; the target screen may mount a moment later, so it reads
 * the pending request on mount and also listens for new ones. Requests expire so a stale one never surprises the owner.
 */
const MAX_AGE_MS = 30000;
let pendingPrefill = null;

/** Pre-fill of the "Grant nou" form (values only; creating the grant stays the owner's click). */
export function offerGrantPrefill(form) {
  pendingPrefill = { form, at: Date.now() };
  window.dispatchEvent(new CustomEvent("lega:prefill-grant"));
}
export function takeGrantPrefill() {
  const request = pendingPrefill;
  pendingPrefill = null;
  return request && Date.now() - request.at < MAX_AGE_MS ? request.form : null;
}

/** Highlights one `[data-lega-target]` element with an arrow and a label (see Spotlight). */
export const pointAt = (target, label) => window.dispatchEvent(new CustomEvent("lega:point", { detail: { target, label, at: Date.now() } }));
