// The plan the cockpit shows right now (M07 §15), shared between the decision card and Lega's voice gate. A sentence the
// gate sends while a plan waits is tagged with that plan, so a spoken "Da, execută planul" can only ever answer THIS plan
// (the Hub checks it again: the plan, the session, the speaker, the local transcript, the time).
let presented = null;
const listeners = new Set();
const capturing = new Set(); // envelope ids whose own push-to-talk confirmation is in progress

export function setPresentedPlan(plan) {
  presented = plan && plan.envelopeId ? { envelopeId: plan.envelopeId, nonce: plan.nonce, hash: plan.hash, projectId: plan.projectId || null } : null;
  for (const fn of listeners) { try { fn(presented); } catch { /* a listener's problem */ } }
}
export function clearPresentedPlan(envelopeId) { if (presented?.envelopeId === envelopeId) setPresentedPlan(null); }
export const presentedPlan = () => presented;
export function onPresentedPlan(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/**
 * M08 §17: plans the Hub ARMED for a spoken confirmation (a short window bound to your session, this Lega session and the plan's
 * hash). For an armed plan the Hub confirms by itself once the local transcript of "Da, execută planul" is final — the page only
 * watches the result, so the push-to-talk button is redundant there and a second, racing confirmation is never sent.
 */
const armed = new Map(); // envelopeId → expiresAt (ms)
const armedListeners = new Set();
export function markArmed(envelopeId, expiresAt) {
  if (!envelopeId) return;
  const at = new Date(expiresAt).getTime();
  if (Number.isFinite(at)) armed.set(envelopeId, at); else armed.delete(envelopeId);
  for (const fn of armedListeners) { try { fn(envelopeId); } catch { /* a listener's problem */ } }
}
export const isArmed = (envelopeId, now = Date.now()) => (armed.get(envelopeId) || 0) > now;
export const armedUntil = (envelopeId) => armed.get(envelopeId) || null;
export function onArmed(fn) { armedListeners.add(fn); return () => armedListeners.delete(fn); }

/**
 * M10.2 U13: the Hub's own events say which plan is armed (any tab, after a reload, while Lega navigated away): the window opened
 * ({ id, until }), or closed ({ id, until: null }: disarmed, closed after refusals, the plan left PROPOSED). Anything else → null.
 * Pure (tested in uiLogic-style tests); the page applies it with markArmed.
 */
export function armedEventEffect(event) {
  const type = String(event?.type || "");
  const id = event?.scopeId || null;
  if (!id) return null;
  if (type === "envelope.confirmation_armed" || type === "ops.plan.confirmation_armed") return event.payload?.expiresAt ? { id, until: event.payload.expiresAt } : null;
  if (type === "envelope.confirmation_disarmed" || type === "ops.plan.confirmation_disarmed") return { id, until: null };
  if ((type === "envelope.armed_refused" || type === "ops.plan.armed_refused") && event.payload?.closed) return { id, until: null };
  if (type === "envelope.status" && event.payload?.status && event.payload.status !== "PROPOSED") return { id, until: null };
  if (type === "envelope.confirmed" || type === "ops.plan.consent") return { id, until: null };
  return null;
}

/** The card's own voice confirmation is running: Lega's gate leaves that plan to it (no second, racing confirmation). */
export const beginCapture = (envelopeId) => capturing.add(envelopeId);
export const endCapture = (envelopeId) => capturing.delete(envelopeId);
export const isCapturing = (envelopeId) => capturing.has(envelopeId);

/** A cheap pre-filter on the Hub's local transcript (the Hub's resolver decides; this only avoids sending every sentence). */
export const looksLikeConfirmation = (text) => /^\s*(da\b|confirm|execut|porne[șs]te|ok,? porne)/i.test(String(text || ""));

/** The microphone the owner chose in setup (per browser), used by Lega's gate and the push-to-talk confirmation too. */
const MIC_KEY = "hub.v2.lega.mic";
export function preferredMic() { try { return localStorage.getItem(MIC_KEY) || ""; } catch { return ""; } }
export function setPreferredMic(id) { try { if (id) localStorage.setItem(MIC_KEY, id); else localStorage.removeItem(MIC_KEY); } catch { /* storage blocked: the default device is used */ } }
