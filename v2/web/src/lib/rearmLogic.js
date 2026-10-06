// M10.2.1 (owner decisions D14–D16, D18): the page side of the contextual gate rearm. Pure helpers (no DOM, no React) — covered by
// v2/tests/m10-2-p0-ui.test.mjs. The Hub decides everything (owner/gate-rearm.mjs): who stopped the gate, whether it may reopen now,
// the card's nonce + hash, the fresh Windows Hello, the security acknowledgement and the compare-and-set on the exact suspension.
// These helpers only carry the card the Hub issued back to it, unchanged, with the owner's own gesture (click / Enter / typed — never
// voice), and decide what the page shows next. Nothing here opens the gate, retries on a timer or starts any old work.

export const REARM_CARD_PATH = "/api/owner/gate/rearm/card";
export const REARM_PATH = "/api/owner/gate/rearm";
/** The modalities the Hub accepts for a rearm (owner/gate-rearm.mjs REARM_MODALITIES). Voice, companion, agent… never. */
export const REARM_MODALITIES = Object.freeze(["click", "keyboard", "typed"]);
export const REARM_BUTTON_LABEL = "Redeschide poarta (Windows Hello)";
/**
 * 2.12.2 (P0-R1): a workspace still reserved after an unconfirmed stop is a step the Hub INCLUDES in the card (owner/gate-rearm.mjs,
 * runtime/lease-reconcile.mjs): an orphaned process the Hub started is stopped, or — when its outcome cannot be proven — the reservation
 * is released only with this acknowledgement (the same words as the Hub's LEASES_ACK_LABEL).
 */
export const LEASES_ACK_LABEL = "Am înțeles, eliberează spațiul de lucru";
/** Under the owner's own pause the card only releases the reservation (scope "leases"); „Continuă” then reopens the pause. */
export const REARM_LEASES_BUTTON_LABEL = "Eliberează spațiul de lucru (Windows Hello)";
/**
 * 2.12.1 (UI-01, the owner's decision): the full card is ALWAYS on screen before the decision. Without a card (the cockpit banner, a
 * blocker option, a refused resume) the first click only asks the Hub's card and shows it — this is its label; the card's own button
 * (REARM_BUTTON_LABEL) or Enter on the focused card is the decision.
 */
export const REARM_SHOW_LABEL = "Arată cardul de redeschidere";
export const SECURITY_ACK_LABEL = "Am verificat cauza";
/** UI-08: a card asked again whose facts changed (a new stop, a new security event) is shown with this notice, never confirmed. */
export const REARM_CHANGED_NOTICE = "Între timp starea porții s-a schimbat: verifică cardul de mai jos și confirmă din nou.";
/** UI-03: the card was asked for a kept request that is no longer active — the card is asked without it, the request is not re-proposed. */
export const REARM_REQUEST_GONE_NOTICE = "Cererea pentru care era cardul nu mai e activă, așa că nu o repropun după redeschidere; poarta o poți redeschide totuși de aici.";
/**
 * UI-06 / REG-02: without an enrolled authenticator the card cannot work (the rearm needs the owner session and a fresh Windows Hello):
 * the honest line and the setup step instead (Lega → Configurare → Identitate). Never an administration page.
 */
export const REARM_SETUP = Object.freeze({ href: "#/lega/setup", label: "Lega → Configurare → Identitate",
  text: "Ca să redeschizi poarta de aici ai nevoie de sesiunea ta de proprietar: înregistrează întâi autentificatorul (Windows Hello sau cheia ta) în Lega → Configurare → Identitate, apoi redeschizi poarta din cockpit, cu Windows Hello." });
/** Eligibility answers that mean "not yet: the stop is still being confirmed" (the card can be asked again later, by the owner). */
export const REARM_WAIT_CODES = Object.freeze(["LEASES", "RUNS_ACTIVE", "CANCEL_PENDING", "LEGA_ACTIVE"]);
const NONCE = /^[0-9a-f]{16,128}$/i;
const HASH = /^[A-Za-z0-9:_-]{8,200}$/;
const PLAN_ID = /^[A-Za-z0-9_-]{4,80}$/;
const REQUEST_ID = /^[A-Za-z0-9_-]{4,80}$/;

/** A rearm card the Hub issued (gate.rearm.card / an intake result): the only thing the page may confirm. */
export function isRearmCard(card) {
  return Boolean(card && typeof card === "object" && card.kind === "gate_rearm" && card.eligible !== false
    && typeof card.nonce === "string" && NONCE.test(card.nonce) && typeof card.hash === "string" && HASH.test(card.hash));
}

/** The card's 5-minute window has passed (the Hub would refuse it as CARD_STALE): a new card is asked for first. */
export function rearmCardExpired(card, now = Date.now()) {
  const at = Date.parse(String(card?.expiresAt || ""));
  return !Number.isFinite(at) || at <= now;
}

const requestIdOf = (value) => (typeof value === "string" && REQUEST_ID.test(value) ? value : null);

/**
 * What the cockpit's ONE rearm slot does after an intake answer (owner/intake.mjs gateAnswer):
 *  - a result carrying the Hub's card (`gateRearm`)                 → { action: "set", slot: { card, requestId } } — the request the
 *    CARD names, never another one (UI-03: the Hub issues a card without its request only when that request was refused as closed);
 *  - `gateStopped` OWNER_SESSION (eligible, but no owner session)  → { action: "set", slot: { card: null, requestId } } — the click opens
 *    the session (Windows Hello) and asks the card;
 *  - `gateStopped` with a stop still being confirmed (REARM_WAIT_CODES) → { action: "set", slot: { card: null, requestId, wait } };
 *  - any other `gateStopped` (the owner's own pause: „Continuă”; the gate already open; no rearm on this Hub) → { action: "clear" };
 *  - nothing about the gate                                          → { action: "keep" }.
 * The first result that carries a card wins (one card per cockpit).
 */
export function rearmSlotFrom(results = []) {
  const list = Array.isArray(results) ? results.filter((r) => r && typeof r === "object") : [];
  const withCard = list.find((r) => isRearmCard(r.gateRearm));
  if (withCard) return { action: "set", slot: { card: withCard.gateRearm, requestId: requestIdOf(withCard.gateRearm.requestId), wait: null } };
  const stopped = list.find((r) => r.gateStopped && typeof r.gateStopped === "object");
  if (!stopped) return { action: "keep" };
  const code = String(stopped.gateStopped.code || "");
  const requestId = requestIdOf(stopped.workRequest?.id);
  if (code === "OWNER_SESSION") return { action: "set", slot: { card: null, requestId, wait: null } };
  if (REARM_WAIT_CODES.includes(code)) return { action: "set", slot: { card: null, requestId, wait: { code, reason: String(stopped.gateStopped.reason || "") } } };
  return { action: "clear" };
}

/** True for the blocker option the Hub offers when the rearm card can reopen the gate (owner/blockers.mjs, kind "rearm"). */
export const isRearmOption = (option) => option?.kind === "rearm" && option?.code === "GATE_SUSPENDED";

/**
 * P0-R1: the steps the Hub included in this card for workspaces still reserved (each { leaseId, verdict, text, ack, pid?, label? }) —
 * shown as the Hub wrote them; [] when there is none.
 */
export function rearmLeaseSteps(card) {
  const steps = card && typeof card === "object" && card.leases && typeof card.leases === "object" ? card.leases.steps : null;
  return Array.isArray(steps) ? steps.filter((s) => s && typeof s === "object" && typeof s.text === "string" && s.text.trim()).slice(0, 20) : [];
}
/** P0-R1: the card releases a reservation whose outcome the Hub cannot prove — only with the owner's „Am înțeles…” ticked. */
export const rearmLeasesAckRequired = (card) => Boolean(card && typeof card === "object" && card.leases && typeof card.leases === "object" && card.leases.ackRequired === true);
/** P0-R1: the card of the owner's own pause that only releases the reservation (the pause stays; „Continuă” reopens it). */
export const rearmLeasesOnly = (card) => Boolean(card && typeof card === "object" && card.scope === "leases");

/**
 * Whether the card may be confirmed now: a live card, and — when the Hub listed security events around the stop (D16) — the owner's
 * explicit „Am verificat cauza”; P0-R1: when a reservation's outcome cannot be proven, „Am înțeles, eliberează spațiul de lucru”.
 * → { ready, why } (why: "no_card" | "expired" | "ack" | "ack_leases").
 */
export function rearmReady(card, { ack = false, ackLeases = false, now = Date.now() } = {}) {
  if (!isRearmCard(card)) return { ready: false, why: "no_card" };
  if (rearmCardExpired(card, now)) return { ready: false, why: "expired" };
  if (card.security && ack !== true) return { ready: false, why: "ack" };
  if (rearmLeasesAckRequired(card) && ackLeases !== true) return { ready: false, why: "ack_leases" };
  return { ready: true, why: null };
}

/**
 * The body of POST /api/owner/gate/rearm: the card's own nonce + hash (never edited), the request the card was issued for (never another
 * one), the security acknowledgement only when the owner ticked it for a card that asks for it, and the gesture. Anything but a click,
 * Enter or typed confirmation is refused here, before anything is sent (the Hub refuses it too). P0-R1: `ackLeases` is sent only for a
 * card that asks for it, and is true only when the owner ticked it.
 */
export function rearmRequestBody(card, { ackSecurity = false, ackLeases = false, modality = "click" } = {}) {
  if (!REARM_MODALITIES.includes(modality)) throw new Error("Redeschiderea porții se confirmă doar cu un click, Enter sau tastat, în sesiunea ta — niciodată prin voce.");
  if (!isRearmCard(card)) throw new Error("Nu am un card de redeschidere valabil; îl cer din nou.");
  const requestId = requestIdOf(card.requestId);
  return { nonce: card.nonce, hash: card.hash, ...(requestId ? { requestId } : {}), ackSecurity: Boolean(card.security) && ackSecurity === true,
    ...(rearmLeasesAckRequired(card) ? { ackLeases: ackLeases === true } : {}), modality };
}

/** The card shows the same facts as before (same suspension, same security events): a refreshed copy keeps the owner's decision. */
export const sameDisplayedCard = (a, b) => isRearmCard(a) && isRearmCard(b) && a.hash === b.hash && Boolean(a.security) === Boolean(b.security)
  && rearmLeasesAckRequired(a) === rearmLeasesAckRequired(b);

/**
 * After the page asked for a card in the SAME gesture, may it go on to the rearm without another click? 2.12.1 (UI-01, the owner's
 * decision): the full card is always on screen before the decision, so only for a refreshed copy (same hash, same security facts — and,
 * with security events, the acknowledgement already ticked) of a card the owner clicked ON. A first card — from the cockpit banner, a
 * blocker option, a refused resume — is only shown, whatever the session's freshness: its own button or Enter is the decision.
 * P0-R1: the same for a card that needs the reservation acknowledgement (`ackLeases` already ticked).
 */
export function continueAfterFetch({ previous = null, next = null, ack = false, ackLeases = false } = {}) {
  if (!isRearmCard(next) || !isRearmCard(previous)) return false;
  return sameDisplayedCard(previous, next) && (!next.security || ack === true) && (!rearmLeasesAckRequired(next) || ackLeases === true);
}

/**
 * UI-02: the slot's trigger (a blocker option's or a refused resume's click) is ONE-SHOT and lives in the cockpit: `trigger` is the
 * click's sequence number, `handled` the last one the cockpit recorded as handled. A card acts only on a trigger it has not handled
 * yet — a remount (a cockpit reload error, a project switch) reads `handled` back from the cockpit and never replays the click.
 */
export function rearmTriggerDue({ trigger = 0, handled = 0 } = {}) {
  const t = Number(trigger);
  const h = Number(handled);
  return Number.isSafeInteger(t) && t > 0 && t > (Number.isSafeInteger(h) && h > 0 ? h : 0);
}

/**
 * UI-03: the Hub refused to issue a card for the kept request it was asked for (the request was cancelled, done, expired or is gone —
 * owner/gate-rearm.mjs checkRequest). The page asks the card once more WITHOUT the request and says it will not be re-proposed.
 */
export function rearmRequestRefused(error) {
  const code = String(error?.details?.code || "");
  if (["REQUEST_CLOSED", "REQUEST_NOT_FOUND", "REQUEST_GONE"].includes(code)) return true;
  const category = String(error?.category || "");
  return (category === "not_found" || category === "conflict") && !code && /cerer/i.test(String(error?.message || ""));
}

/**
 * D22: a resume the Hub refused because the CURRENT Stop All / shutdown / security suspension itself stopped that work (the plan card's
 * „Continuă”, the operator's „Continuă” — ops/plans.mjs, desktop/operator.mjs): { code: GATE_REARM_REQUIRED, rearm: true }. The page
 * then shows the same rearm card (never an administration page). → null | { reason, kind, cls }.
 */
export function rearmRequiredOf(error) {
  const code = String(error?.details?.code || error?.code || "");
  if (code !== "GATE_REARM_REQUIRED") return null;
  const d = error?.details && typeof error.details === "object" ? error.details : {};
  return { reason: String(error?.message || "Ce ai vrut să reiei a fost oprit de Stop All: îl reiei după ce redeschizi poarta aici, cu Windows Hello.").slice(0, 400),
    kind: ["ops", "desktop", "mission"].includes(d.kind) ? d.kind : null, cls: typeof d.cls === "string" ? d.cls.slice(0, 40) : null };
}

/** The Hub could not open the owner session because no authenticator is enrolled (owner/trust.mjs): the setup step, not the card. */
export const noAuthenticatorError = (error) => /Niciun autentificator înregistrat/i.test(String(error?.message || "")) || error?.details?.bootstrapNeeded === true;

/**
 * UI-05 / UI-06: what a page outside the cockpit's slot offers for a suspended gate (the Lega panel). → null (nothing to reopen here:
 * the gate is open, or it is the owner's own pause — „Continuă”), "setup" (no authenticator: the card cannot work) or "card".
 */
export function rearmOfferFor({ gate = null, bootstrapNeeded = false } = {}) {
  if (gateRearmHint(gate)?.kind !== "rearm") return null;
  return bootstrapNeeded === true ? "setup" : "card";
}

/**
 * What the page does with a refused rearm (an ApiError: category, message, details.code). One automatic re-ask of the card at most;
 * never a retry loop, never a timer.
 *  - refresh  : the card is no longer the live one (stale, replaced, other session) or the state changed — ask a new card; `retry` only
 *               when the old card may still have been the right one (same facts then continue);
 *  - ack      : the security acknowledgement is missing;
 *  - wait     : the stop is not confirmed yet (leases, runs, cancellation, Lega) — the Hub's own reason is shown;
 *  - opened   : the gate is already open (another tab, another path): nothing to do;
 *  - pause    : the owner's own pause — „Continuă”, not the rearm;
 *  - error    : anything else (a cancelled Windows Hello, offline…): shown, the card stays.
 */
export function rearmErrorAction(error) {
  const code = String(error?.details?.code || "");
  const message = String(error?.message || "Redeschiderea nu a mers.");
  if (code === "CARD_STALE" || code === "CARD_SESSION") return { action: "refresh", retry: true, code, message };
  if (["SUSPENSION_CHANGED", "CARD_CHANGED", "CARD_HASH", "CARD_REQUEST"].includes(code)) return { action: "refresh", retry: false, code, message };
  if (code === "SECURITY_ACK" || error?.details?.securityAckRequired) return { action: "ack", retry: false, code: "SECURITY_ACK", message };
  // P0-R1: the reservation acknowledgement is missing (the card stays usable); another rearm is in flight (wait for it, then check again).
  if (code === "LEASES_ACK" || error?.details?.leasesAckRequired) return { action: "ack", retry: false, code: "LEASES_ACK", message };
  if (code === "REARM_BUSY") return { action: "wait", retry: false, code, message };
  if (REARM_WAIT_CODES.includes(code)) return { action: "wait", retry: false, code, message };
  if (code === "OPEN") return { action: "opened", retry: false, code, message };
  if (code === "OWNER_PAUSE") return { action: "pause", retry: false, code, message };
  return { action: "error", retry: false, code: code || String(error?.category || ""), message };
}

/**
 * What the owner reads after the rearm (owner/gate-rearm.mjs apply → { reopened, summary, modeReset, reproposed }) and the plan the
 * request became, if any (a PROPOSED plan the existing plan-card flow shows — it still needs its own confirmation; nothing auto-confirms).
 * → { text, toast, planRef: { kind: "envelope"|"ops", id } | null, requestKept: string | null }.
 */
export function rearmOutcome(result) {
  const r = result && typeof result === "object" ? result : {};
  // Someone else opened it meanwhile (another tab, the owner's „Continuă”): this card changed nothing.
  if (r.alreadyOpen) return { text: "Poarta e deja deschisă; nu am schimbat nimic.", toast: "Poarta e deja deschisă; nu am schimbat nimic.", planRef: null, requestKept: null };
  // P0-R1: the owner's own pause — the card released the reservation only; the pause stays until „Continuă”.
  if (r.scope === "leases" && r.reopened === false) {
    const text = typeof r.summary === "string" && r.summary.trim() ? r.summary.trim() : "Am eliberat spațiul de lucru rezervat. Poarta rămâne pe pauza ta: spune „Continuă” și reiau în aceleași limite.";
    return { text, toast: "Spațiul de lucru e eliberat. Poarta rămâne pe pauza ta: spune „Continuă” ca să reiei.", planRef: null, requestKept: null };
  }
  const text = typeof r.summary === "string" && r.summary.trim() ? r.summary.trim() : "Am redeschis poarta. Nimic vechi nu repornește singur: ce e pe pauză reiei cu „Continuă”.";
  const p = r.reproposed && typeof r.reproposed === "object" ? r.reproposed : null;
  const env = p && typeof p.envelopeId === "string" && PLAN_ID.test(p.envelopeId) ? { kind: "envelope", id: p.envelopeId } : null;
  const ops = !env && p && typeof p.planId === "string" && PLAN_ID.test(p.planId) ? { kind: "ops", id: p.planId } : null;
  const fromRef = !env && !ops && p?.planned && typeof p.planned.id === "string" && PLAN_ID.test(p.planned.id) && ["envelope", "ops"].includes(p.planned.kind) ? { kind: p.planned.kind, id: p.planned.id } : null;
  const planRef = env || ops || fromRef;
  const requestKept = p && !planRef ? String(p.error || p.text || "").slice(0, 300) || null : null;
  const toast = `Poarta e redeschisă${r.modeReset ? " (Hub-ul e din nou în BUILD_SAFE)" : ""}. Nimic vechi nu a repornit${planRef ? "; planul cererii tale așteaptă confirmarea ta" : ""}.`;
  return { text, toast, planRef, requestKept };
}

/** Words for who stopped the gate, for the banner only (the Hub's card is the authority: owner/gate-rearm.mjs, policy/gate-state.mjs). */
const KIND_PHRASE = Object.freeze({ stop_all: "e oprită de Stop All", suspend: "e suspendată", shutdown: "a fost suspendată la oprirea Hub-ului",
  security: "e oprită după un eveniment de securitate", pause: "e pe pauză" });

/**
 * The cockpit's standing hint while the gate is suspended (from the /api/state snapshot): null when it is open; the owner's own
 * credential-bound pause → „Continuă” (D13); anything else → the rearm banner (one click asks the Hub's card; the Hub decides).
 * → null | { kind: "continue" | "rearm", text, at }.
 */
export function gateRearmHint(gate) {
  if (!gate || typeof gate !== "object" || gate.status === "open") return null;
  const by = gate.suspendedBy && typeof gate.suspendedBy === "object" ? gate.suspendedBy : null;
  const at = by?.at || gate.changedAt || null;
  if (by?.kind === "pause" && by.credential) return { kind: "continue", at, text: "Hub-ul e pe pauza ta: spune sau scrie „Continuă” și îl reiau în aceleași limite." };
  const phrase = KIND_PHRASE[by?.kind] || (gate.changedAt ? "e suspendată" : "e suspendată de la prima pornire");
  return { kind: "rearm", at, text: `Poarta de execuție ${phrase}: nimic nou nu pornește. O redeschizi aici, cu Windows Hello; nimic vechi nu repornește singur.` };
}

/**
 * D18: the Hub's answer to the owner's spoken „Continuă” (locally verified voice, gated Lega session) for THIS tab's Lega session.
 * `voice.continue_heard` = the local transcript matched; `owner.continue_voice` = the outcome the Hub audited (and says aloud).
 * → null (another session, a duplicate) | { line, toast: null | { level, text, openPath?, openLabel? } }.
 * The page never resumes anything itself: it only reports what the Hub did in the owner session.
 */
export function continueVoiceNotice(event, { legaSessionId = null } = {}) {
  const type = String(event?.type || "");
  if (type !== "voice.continue_heard" && type !== "owner.continue_voice") return null;
  const p = event.payload && typeof event.payload === "object" ? event.payload : {};
  if (!legaSessionId || p.legaSessionId !== legaSessionId) return null;
  if (type === "voice.continue_heard") return { line: p.planBound ? "Am auzit „Continuă” (vocea ta, verificată local); planul afișat așteaptă întâi răspunsul tău." : "Am auzit „Continuă” (vocea ta, verificată local); Hub-ul verifică în sesiunea ta.", toast: null };
  const reason = typeof p.reason === "string" && p.reason ? p.reason.slice(0, 200) : "";
  switch (p.outcome) {
    case "resumed": return { line: "„Continuă” (vocea ta): am reluat ce era pe pauză, în aceleași limite.", toast: { level: "ok", text: "„Continuă” spus cu vocea ta (verificată local): reluat" } };
    case "nothing": return { line: "„Continuă” (vocea ta): nu era nimic pe pauză de reluat.", toast: null };
    // UI-04: a spoken „Continuă” exists only inside a running Lega session, and the card refuses while Lega is open (LEGA_ACTIVE): the
    // first step is to close Lega. The toast's action also closes the full-screen stage, which would otherwise cover the cockpit card.
    case "held": return { line: "„Continuă” (vocea ta): poarta e oprită, așa că nu am reluat nimic. Închide Lega, apoi redeschide poarta din cockpit, cu Windows Hello — nu prin voce.",
      toast: { level: "warn", text: "Poarta e oprită: închide Lega, apoi redeschide poarta din cockpit, cu Windows Hello (nu prin voce). Nimic nu a fost reluat.", openPath: "/lega", openLabel: "Deschide cockpit-ul", closeStage: true } };
    case "plan_waiting": return { line: "„Continuă” (vocea ta): planul afișat așteaptă întâi „Da, execută planul” sau „Nu acum”; nu am reluat nimic.", toast: null };
    case "question": return { line: "„Continuă” (vocea ta): am o întrebare înainte să reiau ceva.", toast: null };
    case "refused": return { line: `„Continuă” din voce nu a fost luat${reason ? `: ${reason}` : ""}. Îl poți scrie în cockpit.`, toast: null };
    case "error": return { line: `„Continuă” din voce nu a mers${reason ? `: ${reason}` : ""}.`, toast: { level: "error", text: `„Continuă” din voce nu a mers${reason ? `: ${reason}` : ""}` } };
    default: return null; // duplicate (the same segment twice) or an unknown outcome: nothing new to say
  }
}
