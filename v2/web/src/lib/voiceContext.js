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
