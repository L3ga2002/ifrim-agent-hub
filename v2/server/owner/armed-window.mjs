// M10.2 U13: the armed spoken-confirmation window, ONE helper for both kinds of plan (Mission Authorization Envelopes and M10
// operation plans). It replaces the per-envelope Map of M08 §17 so that both kinds follow the same rules:
//
// - Arming is a SERVER decision over verified state, never a client field and never because a model asked: the caller (envelopes /
//   ops plans) checks its plan (PROPOSED, before its confirm-by time, PLAN_READY, autonomy, freshness) and `verifyLega` checks the rest
//   on the server: the voice-first policy, a LIVE Lega session derived from the confirming owner session (read from Lega's internals,
//   never from the page), the global local voice gate (owner decision 8) running for that session, an active profile of the current
//   verifier and local transcription available.
// - At most ONE armed plan per Lega session: arming a newer plan closes the older window, so a gate segment can only ever be bound to
//   one plan (voice.analyzeUtterance binds segments to the armed plan on the server; the page tag is advisory).
// - The 90 s start when the Hub finished SPEAKING the plan (Lega's speak() resolved) or when the card was shown in the owner's cockpit,
//   not at proposal. Expiry is judged on the moment the owner spoke (the utterance's created_at), with the local transcription allowed
//   up to 30 s after it; a sentence recorded before the window opened never confirms through it.
// - Only confirmation-like sentences (a bare yes, or one naming the plan with a plan verb) count as failures (3 close the window);
//   ordinary conversation ("ce modele folosește?", "Ok, și cât durează?") is ignored; a "nu …" / "anulează …" / "stai …" / a negated
//   plan verb ("Te rog nu executa planul") closes the window at once (fail-safe: the card stays, the click still works).
// - Windows live in memory: a restart closes them (fail-safe). Voice is a filter, never authentication: confirming still goes through
//   the plan's own confirm(), which re-checks the session, the hash, the nonce, the utterance (claimForConfirmation) and consumes it
//   atomically with the status compare-and-set.
import crypto from "node:crypto";
import { normalize } from "./intents.mjs";

export const ARMED_LIMITS = Object.freeze({ windowMs: 90 * 1000, transcriptDelayMs: 30 * 1000, maxFailures: 3, say: "Da, execută planul" });
/** Event names per kind (the envelope ones are the M08 names; the page listens to both families). */
export const ARMED_EVENTS = Object.freeze({
  envelope: Object.freeze({ scopeType: "envelope", armed: "envelope.confirmation_armed", refused: "envelope.armed_refused", disarmed: "envelope.confirmation_disarmed" }),
  ops: Object.freeze({ scopeType: "ops_plan", armed: "ops.plan.confirmation_armed", refused: "ops.plan.armed_refused", disarmed: "ops.plan.confirmation_disarmed" }),
});
export const kindOfPlan = (id) => (/^env_/.test(String(id || "")) ? "envelope" : /^opp_/.test(String(id || "")) ? "ops" : null);

const LEGA_PREFIX = /^(hei |hey |buna )?lega[,!.;: ]+/;
const NEGATIVE = /^(nu|anuleaza|anulati|renunta|renunt|abandoneaza|stop|opreste)\b/;
// M10.2 review #16: a refusal does not always START with "nu". "Stai, …" / "Așteaptă, …" hold everything (intents.mjs reads them as
// not_yet too), and a negation glued to a plan verb anywhere ("Stai, nu executa planul", "Te rog nu executa planul", "Mai bine nu
// execut planul acum", "Da, dar nu porni încă planul") or a "să nu" is a refusal, never a confirmation attempt. Matched BEFORE the
// confirm rules: closing the window only removes a way to confirm (the card stays, the click still works), so erring here is fail-safe.
// Deliberately not "any negation anywhere": "Da, nu mai am întrebări, execută planul" stays an attempt (the claim judges it).
const HOLD_FIRST = /^(stai|asteapta)\b/;
const NEGATED_VERB = /\bnu(?:-l|-i|-le|-o)? (?:mai |inca |o |il |le )?(?:execut|confirm|porn|lans|rula|rulez|incep|da drumul|da-i drumul)\w*|\bsa nu\b/;
// M10.2 review #14: "Da"/"Ok" at the start of a sentence is how Romanian starts almost any reply ("Ok, și cât durează?", "Da, ce modele
// folosește?", "Ok, mulțumesc"). Counting those as failed confirmations made the Hub speak a refusal over the conversation and closed
// the window after three, pushing the owner back to the button. An attempt is now ONLY (a) a bare yes (optionally repeated, with
// trailing punctuation or "?": "Da", "Da?", "Ok.", "Confirm!") or (b) a sentence that names the plan with a plan verb.
const BARE_YES = /^(?:(?:da|ok|okay|confirm|confirma|confirmam|execut|executa|porneste)\b[\s.,!?;]*)+$/;
// (b) is EXACTLY the gate-purpose naming rule of voice.claimForConfirmation (`planul` + a verb PREFIX, no trailing \b, so "executați"
// / "confirmăm" count): every sentence the claim could accept through Lega must reach it (never "ignored" here), and every "Da, <…>"
// the claim would refuse for not naming the plan is conversation, not a failure. Keep the two regexes identical.
const NAMES_PLAN = /\bplanul\b/;
const PLAN_VERB = /\b(execut|executa|confirm|confirma|porneste)/;

/**
 * What a final local transcript is, for the armed window: "confirm" (an attempt — counted as a failure when it is not a clean yes:
 * "Da?", "Da", "Confirm planul?"), "negative" (closes the window: "Nu acum", "Nu confirma", "Anulează planul", "Stai, nu executa
 * planul", "Da, dar nu porni planul") or "other" (ordinary conversation, ignored: "ce modele folosește?", "Ok, și cât durează?",
 * "Da, ce modele folosește?", "Ok, mulțumesc").
 */
export function classifyArmedSentence(transcript) {
  const n = normalize(transcript).replace(LEGA_PREFIX, "").replace(/^[\s.,!;:-]+/, "").trim();
  if (!n) return "other";
  if (NEGATIVE.test(n) || HOLD_FIRST.test(n) || NEGATED_VERB.test(n)) return "negative";
  if (BARE_YES.test(n)) return "confirm";
  if (NAMES_PLAN.test(n) && PLAN_VERB.test(n)) return "confirm";
  return "other";
}

/**
 * Pure timing rule. `armedAt`/`expiresAt` and the utterance's `createdAtMs` are epoch ms. A sentence counts when it was spoken inside
 * [armedAt, expiresAt] and its transcript arrived at most `transcriptDelayMs` after it was spoken.
 */
export function judgeTiming(win, { createdAtMs, nowMs }, limits = ARMED_LIMITS) {
  if (!Number.isFinite(createdAtMs)) return { ok: false, code: "no_time", reason: "momentul frazei nu e cunoscut" };
  if (createdAtMs < win.armedAt) return { ok: false, code: "before_arm", reason: "fraza a fost spusă înainte să se deschidă fereastra vocală" };
  if (createdAtMs > win.expiresAt) return { ok: false, code: "after_window", reason: "fraza a fost spusă după cele 90 de secunde ale ferestrei" };
  if (nowMs - createdAtMs > limits.transcriptDelayMs) return { ok: false, code: "transcript_late", reason: "transcrierea locală a întârziat peste 30 de secunde" };
  return { ok: true };
}

/**
 * The registry. `verifyLega(legaSessionId, ownerSessionId|null)` → { ok, ownerSessionId, reason } (bound in hub.mjs over Lega's internals,
 * the owner session, the policy and the voice status); `readUtterance(id)` → the server-held row ({ ownerSessionId, legaSessionId,
 * transcript, transcriptStatus, createdAt }) or null. `kinds.<kind>.waiting(planId, hash)` says whether the plan still waits for its
 * confirmation with the same hash (registered by envelopes / ops plans).
 */
export function createArmedWindows({ clock, bus, verifyLega = null, readUtterance = null, limits = ARMED_LIMITS } = {}) {
  const now = () => clock().getTime();
  const windows = new Map(); // planId → { planId, kind, projectId, ownerSessionId, legaSessionId, hash, nonce, windowNonce, armedAt, expiresAt, used, busy, failures, via }
  const kinds = new Map();
  let check = verifyLega;
  let read = readUtterance;
  const emit = (w, which, payload) => {
    const ev = ARMED_EVENTS[w.kind];
    if (!ev) return;
    try { bus.emit({ type: ev[which], scopeType: ev.scopeType, scopeId: w.planId, projectId: w.projectId || null, source: which === "armed" ? `owner:${w.ownerSessionId}` : "armed-window", payload }); } catch { /* closing */ }
  };
  const iso = (ms) => new Date(ms).toISOString();
  const stillWaiting = (w) => { try { return Boolean(kinds.get(w.kind)?.waiting?.(w.planId, w.hash)); } catch { return false; } };
  /** A window is gone for good once its plan stopped waiting, it was used, or even a late transcript could no longer count. */
  const dead = (w) => !w || w.used || now() > w.expiresAt + limits.transcriptDelayMs || !stillWaiting(w);

  function registerKind(kind, adapter) {
    if (!ARMED_EVENTS[kind]) throw new Error(`Unknown armed-window kind ${kind}`);
    kinds.set(kind, adapter || {});
  }
  const attach = ({ verifyLega: v, readUtterance: r } = {}) => { if (typeof v === "function") check = v; if (typeof r === "function") read = r; };

  /** Server-side verification of the Lega session the window would belong to (never a client claim). */
  function lega(legaSessionId, ownerSessionId = null) {
    if (!legaSessionId || typeof legaSessionId !== "string") return { ok: false, reason: "fereastra vocală se deschide doar într-o sesiune Lega pornită din sesiunea ta" };
    if (typeof check !== "function") return { ok: false, reason: "verificarea sesiunii Lega nu e disponibilă pe acest server" };
    let out;
    try { out = check(legaSessionId, ownerSessionId) || { ok: false }; } catch (error) { out = { ok: false, reason: error.message }; }
    if (out.ok && ownerSessionId && out.ownerSessionId !== ownerSessionId) return { ok: false, reason: "sesiunea Lega aparține altei sesiuni de proprietar" };
    return out.ok ? out : { ok: false, reason: out.reason || "sesiunea Lega nu poate deschide o fereastră vocală" };
  }

  /** Opens the window (the caller verified its plan and `lega()`); a newer plan of the same Lega session closes the older window. */
  function arm({ kind, planId, projectId = null, ownerSessionId, legaSessionId, hash, nonce, via = "lega" }) {
    for (const [id, other] of windows) if (id !== planId && other.legaSessionId === legaSessionId) disarm(id, "un plan mai nou a fost armat în această sesiune Lega");
    const t = now();
    const w = { planId, kind, projectId, ownerSessionId, legaSessionId, hash, nonce, windowNonce: crypto.randomBytes(9).toString("hex"), armedAt: t, expiresAt: t + limits.windowMs,
      used: false, busy: false, failures: 0, via };
    windows.set(planId, w);
    emit(w, "armed", { expiresAt: iso(w.expiresAt), legaSession: true, kind, via });
    return { planId, armed: true, armedAt: iso(w.armedAt), expiresAt: iso(w.expiresAt), say: limits.say };
  }

  function disarm(planId, reason = "fereastra vocală s-a închis") {
    const w = windows.get(planId);
    if (!w) return false;
    windows.delete(planId);
    if (!w.used) emit(w, "disarmed", { reason: String(reason).slice(0, 200) });
    return true;
  }
  function disarmLega(legaSessionId, reason = "sesiunea Lega s-a încheiat") {
    let n = 0;
    for (const [id, w] of [...windows]) if (w.legaSessionId === legaSessionId && disarm(id, reason)) n += 1;
    return n;
  }

  /** The open window of this plan for this owner session (and Lega session, when named), or null — what "armed now" means. */
  function armedFor(planId, ownerSessionId, legaSessionId = null) {
    const w = windows.get(planId);
    if (dead(w)) { if (w) windows.delete(planId); return null; }
    if (now() > w.expiresAt || w.ownerSessionId !== ownerSessionId) return null;
    if (legaSessionId && w.legaSessionId !== legaSessionId) return null;
    return { ...w, armedAt: iso(w.armedAt), expiresAt: iso(w.expiresAt) };
  }
  /** The plan a gate segment of this Lega session is bound to right now (voice.analyzeUtterance), or null. */
  function planFor({ ownerSessionId, legaSessionId }) {
    if (!ownerSessionId || !legaSessionId) return null;
    for (const [id, w] of [...windows]) {
      if (dead(w)) { windows.delete(id); continue; }
      if (w.legaSessionId === legaSessionId && w.ownerSessionId === ownerSessionId && now() <= w.expiresAt) return id;
    }
    return null;
  }
  /** For views: until when the plan is armed (ISO), never the nonces. */
  function armedUntil(planId) {
    const w = windows.get(planId);
    return !dead(w) && now() <= w.expiresAt ? iso(w.expiresAt) : null;
  }

  /**
   * A gate segment's local transcript is final. Confirms the armed plan through `confirmFn(window)` (the plan's own confirm with
   * modality "voice") when every rule holds; ignores conversation; closes on a "no"; counts confirmation-like refusals.
   */
  async function confirmFrom({ planId, utteranceId, sessionId, legaSessionId = null }, confirmFn) {
    const w = windows.get(planId);
    if (!w || w.used) return { confirmed: false, reason: "nicio fereastră armată pentru acest plan" };
    if (!stillWaiting(w)) { windows.delete(planId); return { confirmed: false, reason: "planul nu mai așteaptă confirmarea" }; }
    // The window belongs to ONE Lega session of ONE owner session: a segment of another session never uses it.
    if (w.ownerSessionId !== sessionId || !legaSessionId || w.legaSessionId !== legaSessionId) return { confirmed: false, reason: "fraza nu vine din sesiunea Lega în care planul a fost armat" };
    const u = typeof read === "function" ? read(utteranceId) : null;
    if (!u || u.ownerSessionId !== sessionId || u.legaSessionId !== legaSessionId || u.transcriptStatus !== "final" || !u.transcript) return { confirmed: false, reason: "segmentul nu are o transcriere locală finală din această sesiune" };
    const cls = classifyArmedSentence(u.transcript);
    if (cls === "other") return { confirmed: false, ignored: true, reason: "conversație obișnuită (nu numără)" };
    const createdAtMs = Date.parse(u.createdAt);
    // Said before the window opened: not about this window (never confirms, never counts, never closes it).
    if (Number.isFinite(createdAtMs) && createdAtMs < w.armedAt) return { confirmed: false, ignored: true, reason: "fraza a fost spusă înainte să se deschidă fereastra vocală" };
    if (cls === "negative") { disarm(planId, "ai spus „nu”: planul rămâne afișat, îl confirmi cu butonul când vrei"); return { confirmed: false, disarmed: true, reason: "fereastra vocală s-a închis la „nu”" }; }
    const timing = judgeTiming(w, { createdAtMs, nowMs: now() }, limits);
    if (!timing.ok) {
      if (now() > w.expiresAt) disarm(planId, timing.reason);
      return { confirmed: false, reason: timing.reason, code: timing.code };
    }
    // One sentence at a time; the window is spent by a confirmation.
    if (w.busy) return { confirmed: false, reason: "o altă frază e verificată acum" };
    w.busy = true;
    try {
      const out = await confirmFn(w);
      w.used = true; w.busy = false;
      windows.delete(planId);
      return { confirmed: true, duplicate: Boolean(out?.duplicate), result: out };
    } catch (error) {
      w.busy = false;
      w.failures += 1;
      const closed = w.failures >= limits.maxFailures;
      if (closed) windows.delete(planId);
      emit(w, "refused", { reason: String(error.message).slice(0, 200), failures: w.failures, closed });
      return { confirmed: false, reason: error.message, failures: w.failures, closed };
    }
  }

  // A Lega session that ended takes its windows with it (fail-safe: closing a window only removes a way to confirm).
  try {
    bus.subscribe((event) => {
      // Post-commit listener: emitting the "disarmed" events here opens its own transaction (the writer's is already committed).
      if (event?.type === "lega.session.stopped" && event.scopeId) { try { disarmLega(event.scopeId); } catch { /* closing */ } }
    });
  } catch { /* a bus without subscribe (unit tests) */ }

  return { registerKind, attach, lega, arm, disarm, disarmLega, armedFor, planFor, armedUntil, confirmFrom, limits,
    /** Test / diagnostics view: the open windows without nonces. */
    open: () => [...windows.values()].filter((w) => !dead(w)).map((w) => ({ planId: w.planId, kind: w.kind, legaSessionId: w.legaSessionId, expiresAt: iso(w.expiresAt), failures: w.failures })) };
}
