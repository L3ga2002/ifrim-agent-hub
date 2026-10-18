// M10.2 effect classes: ONE vocabulary for what a request does, shared by voice, text and the UI (and by the desktop operator's
// action classes), so a sentence is judged by its EFFECT and its SOURCE — never by the channel name, the actor or a test flag.
//
//   READ_NAVIGATE            — reads and navigation (show, open a screen or a project, explain): nothing changes.
//   SIMPLE_LOCAL_ACTION      — a local, reversible, already-eligible action in the owner's session (open an authorized app, write a
//                              display preference): no confirmation, but from a provider transcript only under a server-verified
//                              derived Lega owner-session authority (M10.1), never on the words alone.
//   BOUNDED_WORKFLOW         — a multi-step job: the sentence only PROPOSES one plan card; the owner's ONE confirmation decides.
//   SENSITIVE_OR_SCOPE_CHANGE — consent, authority or scope (confirm, autonomy, unfreeze, resume, start the voice): only from the owner's
//                              own input in the session (typed or locally verified voice), never from a provider transcript.
//   INTERRUPT                — stop / pause / mute / freeze / take over: only reduces activity, so it is accepted from every live source.
//   REFUSED                  — never from a sentence (publishing, executing a downloaded file): explained, not done.
//
// Pure module: no I/O, no settings, no database. It decides whether a CLASS may come from a SOURCE; the handlers still check the
// session, the policy, the gate and the plan (this matrix only narrows, it never grants).
import { OPERATIONS } from "./action-policy.mjs";

export const EFFECT_CLASSES = Object.freeze(["READ_NAVIGATE", "SIMPLE_LOCAL_ACTION", "BOUNDED_WORKFLOW", "SENSITIVE_OR_SCOPE_CHANGE", "INTERRUPT", "REFUSED"]);

/** The resolver's per-intent effect (owner/intents.mjs INTENT_EFFECTS) → class. */
const EFFECT_TO_CLASS = Object.freeze({
  none: "READ_NAVIGATE", read: "READ_NAVIGATE", navigate: "READ_NAVIGATE",
  local: "SIMPLE_LOCAL_ACTION", plan: "BOUNDED_WORKFLOW", effect: "SENSITIVE_OR_SCOPE_CHANGE", interrupt: "INTERRUPT",
});

/**
 * Intents whose class differs from their effect word. start_view / quiet / notify_normal are "none" for the resolver but WRITE a
 * preference (owner-commands: settings startView, advisor prefs), so they are a local action, not a read. studio_publish and
 * refuse_execute are never done from a sentence.
 */
const INTENT_OVERRIDES = Object.freeze({
  start_view: "SIMPLE_LOCAL_ACTION", quiet: "SIMPLE_LOCAL_ACTION", notify_normal: "SIMPLE_LOCAL_ACTION",
  studio_publish: "REFUSED", refuse_execute: "REFUSED",
  // M12 (T-S3): sending an offer, contacting a company or publishing is never done from a sentence (OUTREACH_DISABLED), from any source.
  sales_send: "REFUSED",
});

/**
 * The class of one resolved intent. `effect` is the resolver's effect word for it (INTENT_EFFECTS[intent], or the step's final
 * effect); this module does not import the resolver (the resolver imports it). An unknown effect word fails closed: it is treated
 * as a scope change, which no provider transcript may trigger.
 */
export function classOfIntent(intent, effect) {
  if (Object.hasOwn(INTENT_OVERRIDES, intent)) return INTENT_OVERRIDES[intent];
  return EFFECT_TO_CLASS[effect] || "SENSITIVE_OR_SCOPE_CHANGE";
}

/** The desktop operator's action classes (policy/action-policy.mjs) in the same vocabulary. */
const ACTION_TO_CLASS = Object.freeze({ LOCAL_DIRECT: "SIMPLE_LOCAL_ACTION", PLAN_STEP: "BOUNDED_WORKFLOW", SENSITIVE: "SENSITIVE_OR_SCOPE_CHANGE", REFUSED: "REFUSED" });

/** The class of an operator operation (its BASE class; classifyAction may only make it stricter). Unknown → scope change. */
export function classOfAction(op) {
  return ACTION_TO_CLASS[OPERATIONS[op]] || "SENSITIVE_OR_SCOPE_CHANGE";
}

/** Sources whose words are the owner's own instruction in the session (typed in the cockpit, or voice verified locally). */
const OWNER_SOURCES = new Set(["typed", "voice-local"]);

/**
 * Why a class may NOT come from a source, or null when it may. Sources: "typed" | "voice-local" | "voice-provider" | "document" |
 * "media-local"; anything else is treated as content (fail closed).
 * - typed / voice-local: everything except REFUSED (the handler still checks the session, the policy and the presented plan).
 * - voice-provider (a transcript made by the realtime provider): reads, navigation and interruptions; a plan only as a PROPOSAL
 *   and never while a plan is on screen waiting for its answer (it would replace the card the owner is reading); a simple local
 *   action only under the derived Lega owner-session authority the SERVER verified (`derivedOwnerSession`); consent, authority or
 *   scope never.
 * - document / media-local / unknown: content, never a command.
 */
export function refusalReason(cls, source, { derivedOwnerSession = false, planPresented = false } = {}) {
  if (!EFFECT_CLASSES.includes(cls)) return "Clasă de efect necunoscută: nu o execut";
  if (cls === "REFUSED") return "Asta nu pornește dintr-o frază";
  if (OWNER_SOURCES.has(source)) return null;
  if (source === "voice-provider") {
    if (cls === "READ_NAVIGATE" || cls === "INTERRUPT") return null;
    if (cls === "BOUNDED_WORKFLOW") return planPresented ? "Un plan așteaptă răspunsul tău; din vocea transcrisă de provider nu pregătesc alt plan peste el" : null;
    if (cls === "SIMPLE_LOCAL_ACTION") return derivedOwnerSession ? null : "O acțiune locală din vocea transcrisă de provider cere sesiunea Lega derivată din sesiunea ta de proprietar";
    return "Din vocea transcrisă de provider nu schimb autoritatea; confirmă sau schimbă în cockpit (tastă, buton, Windows Hello)";
  }
  return "Textul vine dintr-un document sau dintr-o transcriere media: e conținut, nu o comandă de la tine";
}

/** The matrix as a boolean (see refusalReason for the rules and the reason to show). */
export function allowedFrom(cls, source, opts = {}) {
  return refusalReason(cls, source, opts) === null;
}
