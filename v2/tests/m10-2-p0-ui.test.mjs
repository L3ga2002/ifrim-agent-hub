// Milestone 10.2.1 — G4: the web side of the contextual gate rearm (owner decisions D14–D16) and of the spoken „Continuă” (D18).
//
// Part A (no browser): the pure page logic (web/src/lib/rearmLogic.js, web/src/lib/uiLogic.js) — which answer or blocker option fills
// the cockpit's ONE rearm slot, the exact body the page sends (the Hub's nonce + hash, never voice), when a click may go on after asking
// the card (never past security events unseen, never without a Windows Hello prompt for a card first seen now), how a refused rearm is
// recovered (one re-ask, no timer), what the owner reads afterwards, the standing hint, the spoken „Continuă” notices, the Lega start
// hints (no administration pointer under voice-first) — plus the same helpers driven against a real test Hub's gate-rearm service
// (the server's real cards and real refusals), and source checks of the components that use them.
//
// Part B (a REAL browser — headless Chromium through Playwright, a virtual WebAuthn authenticator — against a throwaway test Hub serving
// the built UI; fixture providers, no model, nothing live): after Stop All the cockpit's banner first SHOWS the card (2.12.1, UI-01) and
// the card's own button reopens the gate with ONE Windows Hello prompt (a session older than 5 minutes); a typed request after another
// Stop All shows the card bound to it, Enter on the focused card reopens (modality keyboard) and the request comes back as a PROPOSED
// plan card that is neither focused nor confirmed.
// Part B runs only against a build that contains this UI (HUB_V2_WEB_DIST may point at a fresh scratch build; the live Hub's
// v2/web/dist is never rebuilt here) and is SKIPPED otherwise.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { makeTestHub, enrolOwner, waitFor, prepareLiveWithoutGrants, HUB_ROOT, WEB_DIST } from "./helpers.mjs";
import { REARM_CARD_PATH, REARM_PATH, REARM_MODALITIES, REARM_BUTTON_LABEL, SECURITY_ACK_LABEL, REARM_WAIT_CODES, isRearmCard, rearmCardExpired, rearmSlotFrom, isRearmOption,
  rearmReady, rearmRequestBody, sameDisplayedCard, continueAfterFetch, rearmErrorAction, rearmOutcome, gateRearmHint, continueVoiceNotice } from "../web/src/lib/rearmLogic.js";
import { blockerAction, LEGA_CHECK_HINTS, LEGA_CHECK_HINTS_LEGACY, legaCheckHint, legaStartReadiness } from "../web/src/lib/uiLogic.js";
import { explain } from "../server/owner/blockers.mjs";
import { REARM_MODALITIES as SERVER_MODALITIES, REARM_CODES } from "../server/owner/gate-rearm.mjs";
import { materializeFixture, demoSpec } from "../server/factory/fixtures.mjs";
import { createHttpServer } from "../server/http/server.mjs";
import { browserStatus, browserLaunchOptions } from "../server/tools/browser.mjs";

const V2 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = (rel) => fs.readFileSync(path.join(V2, rel), "utf8");
const ADMIN_POINTERS = /OPEN GATE|Integrări → Avansat|Avansat|din Sistem|#\/system|#\/integrations/;
const M09_MODELS = { writerModel: "gpt-fake-sol", reviewerModel: "sonnet" };
const BUG = "Repară bug-ul de validare a numelui format doar din spații, cu testul de acceptanță test/acceptance.test.mjs";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NOW = Date.parse("2026-10-05T10:00:00.000Z");
/** A card shaped like owner/gate-rearm.mjs cardFor() returns it. */
const cardOf = (extra = {}) => ({ kind: "gate_rearm", eligible: true, code: "ELIGIBLE", nonce: "a".repeat(32), hash: "b".repeat(64), cls: "stop_all",
  headline: "Poarta de execuție e oprită de Stop All. O redeschid aici, cu Windows Hello?", lines: ["Poarta de execuție a fost suspendată."], stays: ["Nimic oprit nu repornește singur."],
  security: null, requiresFreshAuth: true, fresh: false, requestId: null, expiresAt: new Date(NOW + 5 * 60000).toISOString(), ...extra });
const securityOf = () => ({ events: [{ id: "evt_1", type: "lega.voice_gate_bypass", at: new Date(NOW - 60000).toISOString(), label: "O propoziție a ocolit filtrul vocal local" }], total: 1, truncated: false, ackRequired: true });
const apiError = (code, message = "refuzat", category = "conflict", extra = {}) => Object.assign(new Error(message), { category, details: code ? { code, ...extra } : extra });

// ---------------------------------------------------------------- Part A: pure page logic
test("P0UI-01 blocker options of a suspended gate: rearm → ONE inline action (the cockpit card); the owner's pause → „Continuă”; never an administration link", () => {
  const facts = (rearm) => ({ intent: "engineering", project: { name: "T", source: "hub-test", route: "windows" }, autonomy: "ASSISTED", gate: { status: "suspended", suspendedBy: "stop_all", rearm } });
  // The Hub's explainer (real server code) with a rearmable Stop All.
  const eligible = explain(facts({ eligible: true, code: "ELIGIBLE", reason: "Poarta se poate redeschide aici, cu Windows Hello." }));
  const opt = eligible.options.find((o) => o.code === "GATE_SUSPENDED");
  assert.equal(opt.kind, "rearm");
  assert.equal(isRearmOption(opt), true);
  assert.deepEqual(blockerAction(opt), { type: "rearm" });
  // The kept request stores only kind/code/label: the same action.
  assert.deepEqual(blockerAction({ kind: opt.kind, code: opt.code, label: opt.label }), { type: "rearm" });
  // Security events around the stop: still the rearm card (it asks „Am verificat cauza”).
  const sec = explain(facts({ eligible: true, code: "SECURITY", reason: "…", security: true })).options.find((o) => o.code === "GATE_SUSPENDED");
  assert.deepEqual(blockerAction(sec), { type: "rearm" });
  // Not rearmable yet (a stop still being confirmed): the Hub's honest reason, information only — never a link to Integrations / System.
  const waiting = explain(facts({ eligible: false, code: "RUNS_ACTIVE", reason: "Încă se oprește o execuție; redeschid poarta după ce oprirea e confirmată." })).options.find((o) => o.code === "GATE_SUSPENDED");
  assert.equal(waiting.kind, "admin");
  assert.deepEqual(blockerAction(waiting), { type: "info" });
  // A stored option of an older server that still carries an administration `where`: ignored (D14), whatever its kind.
  for (const where of ["#/integrations", "#/system", "#/integrations?panel=isolation"]) assert.deepEqual(blockerAction({ kind: "admin", code: "GATE_SUSPENDED", label: "x", where }), { type: "info" }, where);
  // The owner's own pause: „Continuă” (D13), unchanged.
  const paused = explain({ ...facts(null), gate: { status: "suspended", suspendedBy: "owner_pause" } }).options.find((o) => o.code === "GATE_SUSPENDED");
  assert.deepEqual(blockerAction(paused), { type: "say", text: "Continuă" });
  // A rearm option of another code is not a gate action.
  assert.deepEqual(blockerAction({ kind: "rearm", code: "OTHER", label: "x" }), { type: "info" });
  assert.equal(isRearmOption({ kind: "rearm", code: "OTHER" }), false);
  // Other links are untouched (the R2 hatch, System → Medii).
  assert.deepEqual(blockerAction({ kind: "admin", code: "HOST_R2_OPEN", label: "x" }), { type: "link", href: "#/integrations?panel=isolation" });
  assert.deepEqual(blockerAction({ kind: "owner_decision_separate", code: "ENV_POLICY_B_NEEDED", label: "x" }), { type: "link", href: "#/system?tab=environments" });
  // No GATE_SUSPENDED option of any shape becomes a link.
  for (const o of [...eligible.options, ...waiting ? [waiting] : [], paused]) if (o.code === "GATE_SUSPENDED") assert.notEqual(blockerAction(o).type, "link");
});

test("P0UI-02 Lega start hints: under voice-first the gate hint names „Continuă” and the rearm card (Windows Hello), never an administration path; legaStartReadiness flags the gate", () => {
  assert.match(LEGA_CHECK_HINTS.execution_gate, /Continuă/);
  assert.match(LEGA_CHECK_HINTS.execution_gate, /Windows Hello/);
  assert.match(LEGA_CHECK_HINTS.execution_gate, /Redeschide poarta/);
  assert.doesNotMatch(LEGA_CHECK_HINTS.execution_gate, ADMIN_POINTERS);
  assert.equal(legaCheckHint("execution_gate"), LEGA_CHECK_HINTS.execution_gate, "unknown policy → the voice-first words");
  assert.equal(legaCheckHint("execution_gate", { voiceFirst: true }), LEGA_CHECK_HINTS.execution_gate);
  // The legacy policy (no voice-first; possibly no authenticator at all) keeps naming the typed administrative opening.
  assert.equal(legaCheckHint("execution_gate", { voiceFirst: false }), LEGA_CHECK_HINTS_LEGACY.execution_gate);
  assert.match(LEGA_CHECK_HINTS_LEGACY.execution_gate, /OPEN GATE/);
  assert.equal(legaCheckHint("isolation", { voiceFirst: false }), LEGA_CHECK_HINTS.isolation, "other hints do not depend on the policy");
  for (const bad of ["", null, "toString", "__proto__", "nope"]) assert.equal(legaCheckHint(bad), null, String(bad));
  // No voice-first hint points to an administration path.
  for (const [id, text] of Object.entries(LEGA_CHECK_HINTS)) assert.doesNotMatch(text, /OPEN GATE|Avansat/, id);

  const checks = (failed) => ["execution_gate", "mode", "voice_grant", "lega_consent"].map((id) => ({ id, ok: !failed.includes(id), detail: id }));
  let rd = legaStartReadiness({ owner: { session: true, policyActive: true }, preview: { authority: "owner_session", checks: checks(["execution_gate"]) } });
  assert.equal(rd.gateSuspended, true);
  assert.equal(rd.policyActive, true);
  assert.deepEqual(rd.blocking.map((c) => c.id), ["execution_gate"]);
  rd = legaStartReadiness({ owner: { session: false, policyActive: true }, preview: { checks: checks(["mode", "voice_grant"]) } });
  assert.equal(rd.gateSuspended, false, "authority checks are not the gate");
  rd = legaStartReadiness({ owner: { session: true, policyActive: false }, preview: { checks: checks(["execution_gate", "mode"]) } });
  assert.equal(rd.gateSuspended, true);
  assert.equal(rd.policyActive, false);
});

test("P0UI-03 the ONE rearm slot from an intake answer: the Hub's card (bound to its request), the session to open, a stop still settling; the owner's pause clears it", () => {
  const card = cardOf({ requestId: "wrq_abc_1234" });
  assert.deepEqual(rearmSlotFrom([{ intent: "engineering_request", gateRearm: card, workRequest: { id: "wrq_abc_1234" } }]), { action: "set", slot: { card, requestId: "wrq_abc_1234", wait: null } });
  // The first result with a card wins (one card per cockpit), whatever comes before or after it.
  const other = cardOf({ nonce: "c".repeat(32), requestId: null });
  assert.equal(rearmSlotFrom([{ intent: "face_show" }, { gateRearm: other }, { gateRearm: card }]).slot.card, other);
  assert.equal(rearmSlotFrom([{ gateStopped: { code: "RUNS_ACTIVE", reason: "x" } }, { gateRearm: card }]).slot.card, card, "a card beats a reason");
  // 2.12.1 (UI-03, deliberate change): a card without a request id is bound to no request — the Hub issues a card without its request
  // only when it refused that request as closed, so the result's preserved request is never re-bound (it would fail every refresh).
  assert.equal(rearmSlotFrom([{ gateRearm: cardOf(), workRequest: { id: "wrq_kept_1" } }]).slot.requestId, null);
  // Eligible, but no owner session (the UI without it): the click opens the session, then asks the card for that request.
  assert.deepEqual(rearmSlotFrom([{ gateStopped: { code: "OWNER_SESSION", reason: "…" }, workRequest: { id: "wrq_x_1" } }]), { action: "set", slot: { card: null, requestId: "wrq_x_1", wait: null } });
  // The stop is not confirmed yet: the Hub's reason, „Verifică din nou”.
  for (const code of REARM_WAIT_CODES) {
    const fx = rearmSlotFrom([{ gateStopped: { code, reason: `motiv ${code}` } }]);
    assert.deepEqual(fx, { action: "set", slot: { card: null, requestId: null, wait: { code, reason: `motiv ${code}` } } }, code);
  }
  // The owner's own pause („Continuă”), the gate already open, no rearm on this Hub: nothing to reopen here.
  for (const code of ["OWNER_PAUSE", "OPEN", "UNAVAILABLE", "NOT_ELIGIBLE"]) assert.deepEqual(rearmSlotFrom([{ gateStopped: { code, reason: "x" } }]), { action: "clear" }, code);
  // Nothing about the gate: the slot is left as it is. Junk never becomes a card.
  for (const results of [[], null, undefined, [{ message: "Gata." }], [null, 3, "x"], [{ gateRearm: { kind: "gate_rearm", nonce: "zz", hash: "short" } }], [{ gateRearm: { ...card, eligible: false } }]]) {
    assert.deepEqual(rearmSlotFrom(results), { action: "keep" }, JSON.stringify(results));
  }
  // An invalid request id is never carried.
  assert.equal(rearmSlotFrom([{ gateRearm: cardOf({ requestId: "../../x" }) }]).slot.requestId, null);
});

test("P0UI-04 what the page sends: the Hub's nonce + hash unchanged, the card's own request, the acknowledgement only when ticked for a card that asks, click / Enter / typed — never voice", () => {
  assert.deepEqual([...REARM_MODALITIES], [...SERVER_MODALITIES], "the same modalities as the Hub");
  assert.equal(REARM_CARD_PATH, "/api/owner/gate/rearm/card");
  assert.equal(REARM_PATH, "/api/owner/gate/rearm");
  const card = cardOf({ requestId: "wrq_abc_1234" });
  assert.deepEqual(rearmRequestBody(card), { nonce: card.nonce, hash: card.hash, requestId: "wrq_abc_1234", ackSecurity: false, modality: "click" });
  assert.equal(rearmRequestBody(card, { modality: "keyboard" }).modality, "keyboard");
  assert.equal(rearmRequestBody(card, { modality: "typed" }).modality, "typed");
  for (const modality of ["voice", "companion", "agent", "cli", "ui", "", "VOICE", null]) {
    assert.throws(() => rearmRequestBody(card, { modality }), /niciodată prin voce/, String(modality));
  }
  // No request on the card → none in the body (the Hub refuses a request the card was not issued for).
  assert.equal("requestId" in rearmRequestBody(cardOf()), false);
  // The acknowledgement goes only with a card that lists security events, and only when ticked.
  assert.equal(rearmRequestBody(card, { ackSecurity: true }).ackSecurity, false, "no security on the card → never an acknowledgement");
  const sec = cardOf({ security: securityOf() });
  assert.equal(rearmRequestBody(sec).ackSecurity, false);
  assert.equal(rearmRequestBody(sec, { ackSecurity: "true" }).ackSecurity, false, "only the boolean true");
  assert.equal(rearmRequestBody(sec, { ackSecurity: true }).ackSecurity, true);
  // Not a card → nothing is sent.
  for (const bad of [null, {}, { ...card, kind: "other" }, { ...card, eligible: false }, { ...card, nonce: "" }]) assert.throws(() => rearmRequestBody(bad), /card de redeschidere valabil/);

  // Ready only for a live card, and — with security events — after „Am verificat cauza”.
  assert.deepEqual(rearmReady(card, { now: NOW }), { ready: true, why: null });
  assert.deepEqual(rearmReady(null, { now: NOW }), { ready: false, why: "no_card" });
  assert.deepEqual(rearmReady(cardOf({ expiresAt: new Date(NOW - 1).toISOString() }), { now: NOW }), { ready: false, why: "expired" });
  assert.deepEqual(rearmReady(sec, { now: NOW }), { ready: false, why: "ack" });
  assert.deepEqual(rearmReady(sec, { ack: true, now: NOW }), { ready: true, why: null });
  assert.equal(rearmCardExpired(cardOf({ expiresAt: "nonsense" }), NOW), true, "an unreadable expiry counts as expired");
  assert.equal(REARM_BUTTON_LABEL, "Redeschide poarta (Windows Hello)");
  assert.equal(SECURITY_ACK_LABEL, "Am verificat cauza");
});

test("P0UI-05 one gesture: after asking the card the click goes on only when nothing new is confirmed unseen (2.12.1 UI-01: only the same facts of the card already on screen)", () => {
  const first = cardOf({ fresh: false });
  // 2.12.1 (UI-01, the owner's decision; deliberate change): a first card is ALWAYS shown before the decision, even when a Windows
  // Hello prompt would follow — the prompt only says "verify it's you", not what reopens. The card's own button / Enter decides.
  assert.equal(continueAfterFetch({ previous: null, next: first }), false);
  // A first card in a session verified in the last 5 minutes: no prompt would follow, so the card's own button confirms.
  assert.equal(continueAfterFetch({ previous: null, next: cardOf({ fresh: true }) }), false);
  assert.equal(continueAfterFetch({ previous: null, next: cardOf({ fresh: undefined }) }), false, "unknown freshness → show first");
  // Security events: never confirmed in the same gesture as they are first shown.
  assert.equal(continueAfterFetch({ previous: null, next: cardOf({ fresh: false, security: securityOf() }) }), false);
  // A refreshed copy of the card on screen (expired, replaced by another tab): the same facts keep the owner's click (and acknowledgement).
  const again = cardOf({ nonce: "d".repeat(32) });
  assert.equal(sameDisplayedCard(first, again), true);
  assert.equal(continueAfterFetch({ previous: first, next: again }), true);
  const secA = cardOf({ security: securityOf() });
  const secB = cardOf({ nonce: "e".repeat(32), security: securityOf() });
  assert.equal(continueAfterFetch({ previous: secA, next: secB, ack: true }), true);
  assert.equal(continueAfterFetch({ previous: secA, next: secB, ack: false }), false);
  // Different facts (a new stop, a new security event): shown, never confirmed on the old click.
  const changed = cardOf({ nonce: "f".repeat(32), hash: "9".repeat(64) });
  assert.equal(sameDisplayedCard(first, changed), false);
  assert.equal(continueAfterFetch({ previous: first, next: changed }), false);
  assert.equal(continueAfterFetch({ previous: first, next: null }), false);
  assert.equal(sameDisplayedCard(first, cardOf({ nonce: "1".repeat(32), security: securityOf() })), false, "a security list appeared");
});

test("P0UI-06 a refused rearm: one re-ask of the card at most (stale / other session → retry with the same facts), changed state → shown again, the stop still settling → wait; no timer", () => {
  assert.deepEqual(rearmErrorAction(apiError("CARD_STALE", "Cardul nu mai e valabil")), { action: "refresh", retry: true, code: "CARD_STALE", message: "Cardul nu mai e valabil" });
  assert.equal(rearmErrorAction(apiError("CARD_SESSION", "x", "policy")).action, "refresh");
  assert.equal(rearmErrorAction(apiError("CARD_SESSION", "x", "policy")).retry, true);
  for (const code of ["SUSPENSION_CHANGED", "CARD_CHANGED", "CARD_HASH", "CARD_REQUEST"]) {
    const a = rearmErrorAction(apiError(code, `m ${code}`));
    assert.equal(a.action, "refresh", code); assert.equal(a.retry, false, code); assert.equal(a.message, `m ${code}`);
  }
  assert.equal(rearmErrorAction(apiError("SECURITY_ACK", "Confirmă întâi", "validation", { securityAckRequired: true })).action, "ack");
  for (const code of REARM_WAIT_CODES) assert.equal(rearmErrorAction(apiError(code, "încă")).action, "wait", code);
  assert.equal(rearmErrorAction(apiError("OPEN")).action, "opened");
  assert.equal(rearmErrorAction(apiError("OWNER_PAUSE")).action, "pause");
  // Every eligibility code the Hub can refuse with has a page action (none falls through as an unknown error).
  for (const code of REARM_CODES.filter((c) => !["ELIGIBLE", "SECURITY"].includes(c))) assert.notEqual(rearmErrorAction(apiError(code)).action, "error", code);
  // A cancelled Windows Hello, an authentication error withReauth already tried, offline, anything else: shown; the card stays.
  const cancelled = rearmErrorAction(Object.assign(new Error("Ai anulat sau timpul a expirat în fereastra Windows Hello"), { name: "NotAllowedError" }));
  assert.equal(cancelled.action, "error");
  assert.match(cancelled.message, /Windows Hello/);
  assert.equal(rearmErrorAction(apiError(null, "Pentru redeschiderea porții confirmă din nou", "authentication", { reauth: true })).action, "error");
  assert.equal(rearmErrorAction(null).action, "error");
});

test("P0UI-07 after the rearm: the Hub's own summary, a toast that says nothing old restarted, and the re-proposed plan as a ref for the plan-card flow (never confirmed here)", () => {
  const summary = "Am redeschis poarta după Stop All. Nimic vechi nu repornește singur: ce e pe pauză reiei cu „Continuă”. Cererea ta are acum un plan pe care îl confirmi separat.";
  let o = rearmOutcome({ reopened: true, summary, modeReset: false, reproposed: { requestId: "wrq_1", planned: { kind: "envelope", id: "env_abc_123" }, envelopeId: "env_abc_123" } });
  assert.equal(o.text, summary);
  assert.deepEqual(o.planRef, { kind: "envelope", id: "env_abc_123" });
  assert.match(o.toast, /Nimic vechi nu a repornit/);
  assert.match(o.toast, /așteaptă confirmarea ta/);
  assert.equal(o.requestKept, null);
  o = rearmOutcome({ reopened: true, summary, modeReset: true, reproposed: { requestId: "wrq_1", planned: { kind: "ops", id: "opp_x_9" }, planId: "opp_x_9" } });
  assert.deepEqual(o.planRef, { kind: "ops", id: "opp_x_9" });
  assert.match(o.toast, /BUILD_SAFE/);
  // Only the planned ref (an older shape) still names the plan.
  assert.deepEqual(rearmOutcome({ reopened: true, summary, reproposed: { planned: { kind: "envelope", id: "env_q_1" } } }).planRef, { kind: "envelope", id: "env_q_1" });
  // The request could not be re-proposed: it stays kept, the reason is carried, no plan ref.
  o = rearmOutcome({ reopened: true, summary: "Am redeschis poarta după Stop All. Cererea ta rămâne păstrată (x).", reproposed: { requestId: "wrq_1", planned: null, error: "cererile păstrate nu sunt disponibile" } });
  assert.equal(o.planRef, null);
  assert.equal(o.requestKept, "cererile păstrate nu sunt disponibile");
  // Junk ids are never followed; no summary → an honest default.
  for (const bad of [{ envelopeId: "../x" }, { planId: "a b" }, { planned: { kind: "grant", id: "grant_1" } }]) assert.equal(rearmOutcome({ reopened: true, reproposed: bad }).planRef, null, JSON.stringify(bad));
  assert.match(rearmOutcome({ reopened: true }).text, /Am redeschis poarta/);
  assert.match(rearmOutcome(null).text, /Nimic vechi nu repornește singur/);
  // Opened by someone else meanwhile: nothing changed, nothing to show.
  assert.deepEqual(rearmOutcome({ alreadyOpen: true }), { text: "Poarta e deja deschisă; nu am schimbat nimic.", toast: "Poarta e deja deschisă; nu am schimbat nimic.", planRef: null, requestKept: null });
});

test("P0UI-08 the standing hint while the gate is suspended: nothing when open, „Continuă” for the owner's own pause, the rearm banner for everything else", () => {
  assert.equal(gateRearmHint(null), null);
  assert.equal(gateRearmHint({ status: "open" }), null);
  const pause = gateRearmHint({ status: "suspended", suspendedBy: { kind: "pause", credential: "0123456789abcdef01234567", at: "2026-10-05T09:00:00Z" } });
  assert.equal(pause.kind, "continue");
  assert.match(pause.text, /Continuă/);
  // A pause without the owner's credential (the UI without a session, an unaddressed voice) is reopened by the card.
  assert.equal(gateRearmHint({ status: "suspended", suspendedBy: { kind: "pause", credential: null } }).kind, "rearm");
  for (const [kind, words] of [["stop_all", /Stop All/], ["suspend", /suspendată/], ["shutdown", /oprirea Hub-ului/], ["security", /securitate/]]) {
    const h = gateRearmHint({ status: "suspended", suspendedBy: { kind, at: "2026-10-05T09:00:00Z" } });
    assert.equal(h.kind, "rearm", kind);
    assert.match(h.text, words, kind);
    assert.match(h.text, /Windows Hello/);
    assert.doesNotMatch(h.text, ADMIN_POINTERS);
    assert.equal(h.at, "2026-10-05T09:00:00Z");
  }
  // The first start (no origin recorded, never changed) and a legacy record.
  assert.match(gateRearmHint({ status: "suspended", changedAt: null, changedBy: "system" }).text, /prima pornire/);
  assert.match(gateRearmHint({ status: "suspended", changedAt: "2026-10-01T00:00:00Z", changedBy: "user" }).text, /e suspendată/);
});

test("P0UI-09 the spoken „Continuă” (D18) is reported for THIS tab's Lega session only, with what the Hub did; a held one points to the cockpit card, never resumes by itself", () => {
  const ev = (type, payload) => ({ type, seq: 5, payload });
  assert.equal(continueVoiceNotice(ev("owner.continue_voice", { legaSessionId: "lgs_a", outcome: "resumed" }), { legaSessionId: "lgs_b" }), null, "another session");
  assert.equal(continueVoiceNotice(ev("owner.continue_voice", { legaSessionId: "lgs_a", outcome: "resumed" }), { legaSessionId: null }), null, "no session in this tab");
  assert.equal(continueVoiceNotice(ev("lega.transcript", { legaSessionId: "lgs_a" }), { legaSessionId: "lgs_a" }), null);
  const at = (outcome, extra = {}) => continueVoiceNotice(ev("owner.continue_voice", { legaSessionId: "lgs_a", outcome, ...extra }), { legaSessionId: "lgs_a" });
  assert.match(at("resumed").line, /am reluat/);
  assert.equal(at("resumed").toast.level, "ok");
  const held = at("held");
  assert.match(held.line, /nu am reluat nimic/);
  assert.match(held.line, /Windows Hello — nu prin voce/);
  assert.equal(held.toast.openPath, "/lega");
  assert.doesNotMatch(JSON.stringify(held), ADMIN_POINTERS);
  assert.match(at("plan_waiting").line, /Da, execută planul/);
  assert.match(at("nothing").line, /nimic pe pauză/);
  assert.match(at("refused", { reason: "filtrul vocal local e oprit acum" }).line, /filtrul vocal local e oprit acum/);
  assert.equal(at("refused").toast, null, "a refusal is a transcript line, not an alarm");
  assert.equal(at("error", { reason: "x" }).toast.level, "error");
  assert.equal(at("duplicate"), null, "the same segment twice says nothing new");
  assert.equal(at("whatever"), null);
  const heard = continueVoiceNotice(ev("voice.continue_heard", { legaSessionId: "lgs_a", planBound: false }), { legaSessionId: "lgs_a" });
  assert.match(heard.line, /verificată local/);
  assert.equal(heard.toast, null);
  assert.match(continueVoiceNotice(ev("voice.continue_heard", { legaSessionId: "lgs_a", planBound: true }), { legaSessionId: "lgs_a" }).line, /planul afișat/);
});

// ---------------------------------------------------------------- Part A: the same helpers against the Hub's real rearm service
/** A test Hub with the owner enrolled (voice-first), BUILD_SAFE, the gate open. */
async function ownerHub() {
  const t = await makeTestHub({ queues: true });
  await prepareLiveWithoutGrants(t.hub);
  const owner = await enrolOwner(t);
  return { ...t, owner };
}
const asOwner = (t, type, payload = {}, session = t.owner.session) => t.hub.commands.dispatch({ type, payload, channel: "owner", actor: `owner:${session.id}`, ownerSession: session }).then((r) => r.result);
const ownerStop = async (t) => { await t.hub.commands.dispatch({ type: "system.stop_all", payload: { reason: "test" }, channel: "owner", actor: `owner:${t.owner.session.id}`, ownerSession: t.owner.session }); await sleep(100); };
const staleSession = (t) => t.hub.db.prepare("UPDATE owner_sessions SET reauth_at = ? WHERE id = ?").run(new Date(t.hub.config.now().getTime() - 10 * 60000).toISOString(), t.owner.session.id);
const refusal = async (p) => { try { await p; } catch (e) { return e; } assert.fail("expected a refusal"); return null; };

test("P0UI-10 contract: the Hub's real card fills the slot; the page's body reopens the gate after the Windows Hello the Hub asks for; the outcome is the Hub's summary", async () => {
  const t = await ownerHub();
  try {
    await ownerStop(t);
    assert.equal(gateRearmHint(t.hub.settings.get("executionGate")).kind, "rearm", "the real Stop All record → the banner");
    assert.match(gateRearmHint(t.hub.settings.get("executionGate")).text, /Stop All/);
    const card = await asOwner(t, "gate.rearm.card", {});
    assert.equal(isRearmCard(card), true, JSON.stringify(card).slice(0, 300));
    assert.equal(card.security, null);
    assert.deepEqual(rearmSlotFrom([{ gateRearm: card }]), { action: "set", slot: { card, requestId: null, wait: null } });
    assert.equal(rearmReady(card).ready, true);
    assert.equal(rearmCardExpired(card), false);
    const body = rearmRequestBody(card, { modality: "keyboard" });
    assert.deepEqual(Object.keys(body).sort(), ["ackSecurity", "hash", "modality", "nonce"]);
    // A session verified more than 5 minutes ago: the Hub asks for Windows Hello (what withReauth answers) and changes nothing.
    staleSession(t);
    const again = await asOwner(t, "gate.rearm.card", {});
    assert.equal(again.fresh, false);
    // 2.12.1 (UI-01, deliberate change): even with a prompt to follow, a first card is shown; its own button confirms it.
    assert.equal(continueAfterFetch({ previous: null, next: again }), false, "a first card is shown before the decision");
    const auth = await refusal(asOwner(t, "gate.rearm", rearmRequestBody(again)));
    assert.equal(auth.category, "authentication");
    assert.equal(auth.details?.reauth, true);
    assert.equal(t.hub.settings.get("executionGate").status, "suspended");
    // The first card was replaced by the second (one live card per session): the page re-asks once and goes on with the same facts.
    const stale = await refusal(asOwner(t, "gate.rearm", body, t.owner.reauth()));
    const act = rearmErrorAction(stale);
    assert.deepEqual([act.action, act.retry], ["refresh", true], stale.message);
    const third = await asOwner(t, "gate.rearm.card", {});
    assert.equal(sameDisplayedCard(card, third), true);
    assert.equal(continueAfterFetch({ previous: card, next: third }), true);
    const out = await asOwner(t, "gate.rearm", rearmRequestBody(third, { modality: "keyboard" }), t.owner.reauth());
    assert.equal(out.reopened, true);
    const g = t.hub.settings.get("executionGate");
    assert.equal(g.status, "open");
    assert.equal(g.reopenedAfter.via, "rearm");
    assert.equal(t.hub.settings.get("mode"), "BUILD_SAFE");
    const o = rearmOutcome(out);
    assert.equal(o.text, out.summary);
    assert.equal(o.planRef, null);
    assert.equal(gateRearmHint(g), null, "the banner goes away");
    const cmd = t.hub.db.prepare("SELECT channel, payload_json FROM commands WHERE type = 'gate.rearm' ORDER BY rowid DESC LIMIT 1").get();
    assert.equal(cmd.channel, "owner");
    assert.equal(JSON.parse(cmd.payload_json).modality, "keyboard");
    // A voice body can never be built by the page.
    assert.throws(() => rearmRequestBody(third, { modality: "voice" }), /niciodată prin voce/);
  } finally { await t.cleanup(); }
});

test("P0UI-11 contract: security events around the stop → the card lists them, nothing goes without „Am verificat cauza”; the owner's own pause → „Continuă”, no card", async () => {
  const t = await ownerHub();
  try {
    await ownerStop(t);
    t.hub.bus.emit({ type: "lega.voice_gate_bypass", scopeType: "system", scopeId: "test", source: "test", payload: { test: true } });
    const card = await asOwner(t, "gate.rearm.card", {});
    assert.equal(isRearmCard(card), true);
    assert.equal(card.security?.ackRequired, true);
    assert.equal(card.security.events[0].type, "lega.voice_gate_bypass");
    assert.match(card.security.events[0].label, /filtrul vocal/);
    assert.deepEqual(rearmReady(card), { ready: false, why: "ack" });
    assert.equal(continueAfterFetch({ previous: null, next: { ...card, fresh: false } }), false, "never confirmed in the gesture that first shows the events");
    // Without the tick the Hub refuses (the page maps it to the checkbox) and the gate stays suspended.
    const noAck = await refusal(asOwner(t, "gate.rearm", rearmRequestBody(card), t.owner.reauth()));
    assert.equal(rearmErrorAction(noAck).action, "ack");
    assert.equal(t.hub.settings.get("executionGate").status, "suspended");
    const out = await asOwner(t, "gate.rearm", rearmRequestBody(card, { ackSecurity: true }), t.owner.reauth());
    assert.equal(out.reopened, true);
    assert.ok(t.hub.settings.get("executionGate").reopenedAfter.security, "the acknowledged events are recorded");

    // The owner's own pause: the real record → „Continuă”; the Hub gives no card and the slot is cleared.
    await asOwner(t, "owner.interrupt", { kind: "pause", reason: "Pauză" });
    const g = t.hub.settings.get("executionGate");
    assert.equal(g.status, "suspended");
    assert.equal(gateRearmHint(g).kind, "continue");
    const none = await asOwner(t, "gate.rearm.card", {});
    assert.equal(isRearmCard(none), false);
    assert.equal(none.code, "OWNER_PAUSE");
    assert.equal(rearmErrorAction(Object.assign(new Error(none.reason), { details: { code: none.code } })).action, "pause");
    assert.deepEqual(rearmSlotFrom([{ gateStopped: { code: none.code, reason: none.reason } }]), { action: "clear" });
  } finally { await t.cleanup(); }
});

test("P0UI-12 source: one rearm card component (withReauth, the Hub's paths, click/Enter only); the cockpit, the blockers, the Lega panel and Integrations use it — no administration pointer in owner-facing code", () => {
  const card = source("web/src/screens/lega/RearmCard.jsx");
  assert.match(card, /withReauth\(\(\) => api\(REARM_CARD_PATH/);
  assert.match(card, /withReauth\(\(\) => api\(REARM_PATH, \{ method: "POST", body: rearmRequestBody\(/);
  assert.match(card, /run\("keyboard"\)/);
  assert.match(card, /e\.key === "Enter" && e\.target === box\.current/);
  assert.match(card, /SECURITY_ACK_LABEL/);
  assert.match(card, /Ce rămâne oprit/);
  assert.doesNotMatch(card, /"voice"|setInterval|setTimeout/, "never voice, never a timer");
  // The cockpit: ONE slot filled from the intake answer; options open the same slot; the plan comes back through the plan-card flow.
  const cockpit = source("web/src/screens/Lega.jsx");
  assert.match(cockpit, /rearmSlotFrom\(res\.results\)/);
  assert.equal((cockpit.match(/<RearmCard /g) || []).length, 2, "the slot and the standing banner (never both: one expression)");
  assert.match(cockpit, /const rearmView = rearmSlot/);
  // 2.12.1 (UI-02, deliberate change): rendered ONCE, at a stable place outside the company / project / error branches.
  assert.equal((cockpit.match(/\{rearmView\}/g) || []).length, 1, "rendered once, outside the cockpit's branches");
  assert.match(cockpit, /onRearm=\{openRearm\}/);
  assert.match(cockpit, /planHandler\.current\(\{ kind: "envelope", id: out\.planRef\.id/);
  assert.doesNotMatch(cockpit, /explicit: true \}\);?\s*\n?\s*else if \(out\.planRef/, "the re-proposed plan is never focused");
  const cards = source("web/src/screens/lega/cards.jsx");
  assert.match(cards, /a\.type === "rearm" && onRearm/);
  assert.match(cards, /onRearm=\{onRearm\}/);
  // The Lega panel: hints per policy, the card next to the hint, the spoken „Continuă” notices.
  const panel = source("web/src/shell/Lega.jsx");
  assert.match(panel, /legaCheckHint\(c\.id, \{ voiceFirst: rd\.policyActive \}\)/);
  assert.doesNotMatch(panel, /LEGA_CHECK_HINTS\[/);
  // 2.12.1 (UI-05 / UI-06, deliberate change): only for a suspension the card can reopen, with an authenticator to confirm it.
  assert.match(panel, /rd\.gateSuspended && rearmOffer === "card" && <RearmCard compact/);
  assert.match(panel, /continueVoiceNotice\(e, \{ legaSessionId: refs\.current\.sessionId \}\)/);
  // Integrations: the typed opening is labelled diagnostic under voice-first; the owner is sent to the cockpit card.
  const integ = source("web/src/screens/Integrations.jsx");
  assert.match(integ, /voiceFirst \? "Deschide poarta \(diagnostic\)" : "Deschide poarta"/);
  assert.match(integ, /cardul „Redeschide poarta” din cockpit/);
  assert.match(integ, /href="#\/lega">Deschide cockpit-ul/);
  // Owner-facing files of this flow never point to an administration path.
  for (const rel of ["web/src/screens/lega/RearmCard.jsx", "web/src/lib/rearmLogic.js", "web/src/screens/Lega.jsx", "web/src/screens/lega/cards.jsx"]) {
    assert.doesNotMatch(source(rel), /OPEN GATE|Integrări → Avansat/, rel);
  }
});

// ---------------------------------------------------------------- Part B: the real UI
const status = browserStatus({ hubRoot: HUB_ROOT });
const built = fs.existsSync(path.join(WEB_DIST, "index.html"));
/** The build must contain this UI (an older dist would test the old one): the rearm card's accessible name. */
const hasRearmUi = () => {
  try {
    const dir = path.join(WEB_DIST, "assets");
    return fs.readdirSync(dir).filter((f) => f.endsWith(".js")).some((f) => fs.readFileSync(path.join(dir, f), "utf8").includes("Redeschiderea porții de execuție"));
  } catch { return false; }
};
const skip = !status.installed || !status.cachedBrowsers.length ? "SKIPPED_ENV: Playwright/Chromium is missing"
  : !built ? `SKIPPED_ENV: the built UI is missing (${WEB_DIST})`
    : !hasRearmUi() ? `SKIPPED_ENV: the built UI predates the rearm card (${WEB_DIST}); set HUB_V2_WEB_DIST to a fresh build`
      : false;

test("P0UI-E2E-01 Stop All → the cockpit banner shows the card, its button + ONE Windows Hello reopens; a typed request → its card, Enter reopens, the request returns as a plan card (not focused, not confirmed)", { skip, timeout: 300000 }, async () => {
  const t = await makeTestHub({ queues: true });
  // The role defaults of an engineering draft (writer gpt-6.1-sol) are in the account's model list.
  fs.writeFileSync(`${t.logs.codex}.models.json`, JSON.stringify([{ id: "gpt-6.1-sol", isDefault: true, efforts: ["medium", "high"] }, { id: "gpt-fake-sol", efforts: ["medium", "high"] }]));
  const { server } = createHttpServer(t.hub);
  await new Promise((r) => server.listen(t.config.port, "127.0.0.1", r));
  const pw = createRequire(path.join(HUB_ROOT, "package.json"))("playwright");
  const origin = `http://localhost:${t.config.port}`;
  const browser = await pw.chromium.launch(browserLaunchOptions(origin));
  const pageErrors = [];
  const count = (sql, ...args) => t.hub.db.prepare(sql).get(...args).n;
  const gate = () => t.hub.settings.get("executionGate");
  const stopAll = async () => { await t.hub.commands.dispatch({ type: "system.stop_all", payload: { reason: "test" }, channel: "ui", actor: "user" }); await sleep(150); };
  try {
    await prepareLiveWithoutGrants(t.hub);
    const dir = path.join(t.dataDir, "ui-rearm");
    materializeFixture("bug-demo", dir);
    const project = (await t.hub.commands.dispatch({ type: "project.register_test", channel: "test", actor: "test", payload: { path: dir, name: "UI Rearm" } })).result;
    await t.hub.commands.dispatch({ type: "factory.prepare", channel: "test", actor: "test", payload: { projectId: project.id, ...demoSpec("bug-demo"), limits: M09_MODELS } });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    page.on("pageerror", (e) => pageErrors.push(String(e?.message || e)));
    const cdp = await context.newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
    await page.goto(`${origin}/#/lega/setup`);
    await page.getByText("Windows Hello / cheia ta înregistrată").first().waitFor({ timeout: 20000 });
    await page.getByRole("button", { name: /Înregistrează acest calculator/ }).click();
    await page.getByText(/sesiune deschisă până la/).waitFor({ timeout: 20000 });
    await page.getByRole("button", { name: /Accept și activez/ }).click();
    await page.getByText(/activă \(v1\)/).waitFor({ timeout: 20000 });

    // 1 · Stop All from the top bar's channel; the session was verified more than 5 minutes ago. The cockpit shows the standing banner.
    await stopAll();
    assert.equal(gate().suspendedBy?.kind, "stop_all");
    t.hub.db.prepare("UPDATE owner_sessions SET reauth_at = ? WHERE status = 'active'").run(new Date(Date.now() - 10 * 60000).toISOString());
    await page.goto(`${origin}/#/lega`);
    await page.getByText(/Poarta de execuție e oprită de Stop All/).first().waitFor({ timeout: 20000 });
    const reauthBefore = count("SELECT COUNT(*) AS n FROM events WHERE type = 'owner.session_reauthenticated'");
    assert.equal(count("SELECT COUNT(*) AS n FROM commands WHERE type IN ('gate.rearm.card', 'gate.rearm')"), 0, "showing the banner asked nothing");
    // 2.12.1 (UI-01, deliberate change): the banner's click only asks the card and SHOWS it in full — even with a stale session,
    // where a Windows Hello prompt would follow. The card's own button is the decision: the Hub asks for the fresh verification, the
    // page runs the ceremony once and repeats the same request.
    await page.getByRole("button", { name: "Arată cardul de redeschidere" }).click();
    await page.getByRole("group", { name: "Redeschiderea porții de execuție" }).getByText("Ce rămâne oprit").waitFor({ timeout: 20000 });
    await page.waitForTimeout(400);
    assert.equal(gate().status, "suspended", "the banner's click only shows the card");
    assert.equal(count("SELECT COUNT(*) AS n FROM commands WHERE type = 'gate.rearm'"), 0, "no decision sent with the click that showed the card");
    await page.getByRole("button", { name: "Redeschide poarta (Windows Hello)" }).click();
    await waitFor(() => gate().status === "open", 20000, 100);
    assert.equal(gate().reopenedAfter?.via, "rearm");
    assert.equal(gate().reopenedAfter?.cls, "stop_all");
    assert.equal(t.hub.settings.get("mode"), "BUILD_SAFE");
    assert.equal(count("SELECT COUNT(*) AS n FROM events WHERE type = 'owner.session_reauthenticated'") - reauthBefore, 1, "ONE Windows Hello");
    const rearms = t.hub.db.prepare("SELECT channel, status, error_category, payload_json FROM commands WHERE type = 'gate.rearm' ORDER BY rowid").all();
    assert.equal(rearms.length, 2, "the try the Hub refused (Windows Hello asked) and its ONE repeat with the same card");
    assert.deepEqual([rearms[0].status, rearms[0].error_category], ["failed", "authentication"]);
    assert.notEqual(rearms[1].status, "failed");
    assert.ok(JSON.parse(rearms[0].payload_json).hash, "the logged card reference (a hash prefix; the nonce is never logged)");
    assert.equal(JSON.parse(rearms[0].payload_json).hash, JSON.parse(rearms[1].payload_json).hash, "the same card, repeated");
    for (const r of rearms) { assert.equal(r.channel, "owner"); assert.equal(JSON.parse(r.payload_json).modality, "click"); }
    assert.equal(count("SELECT COUNT(*) AS n FROM commands WHERE type = 'gate.rearm.card'"), 1, "ONE card asked");
    await page.getByText(/Am redeschis poarta după Stop All/).first().waitFor({ timeout: 10000 });
    await waitFor(async () => (await page.getByRole("button", { name: "Redeschide poarta (Windows Hello)" }).count()) === 0, 10000, 100);

    // 2 · Another Stop All. The session was verified a moment ago (no Windows Hello prompt would follow): the banner's click SHOWS the
    // card (what stopped, what stays stopped) — its own button / Enter confirms. Nothing is reopened unseen.
    await stopAll();
    const rearmsBefore = count("SELECT COUNT(*) AS n FROM commands WHERE type = 'gate.rearm'");
    await page.goto(`${origin}/#/lega`);
    await page.getByRole("button", { name: "Arată cardul de redeschidere" }).click();
    await page.getByRole("group", { name: "Redeschiderea porții de execuție" }).getByText("Ce rămâne oprit").waitFor({ timeout: 20000 });
    await page.waitForTimeout(500);
    assert.equal(gate().status, "suspended", "a card first seen in a fresh session is shown, not confirmed");
    assert.equal(count("SELECT COUNT(*) AS n FROM commands WHERE type = 'gate.rearm'"), rearmsBefore);

    // 3 · A typed request on the project meets the stopped gate: the card is bound to the kept request.
    await page.goto(`${origin}/#/lega/${project.id}`);
    await page.getByLabel("Mesaj pentru Lega").waitFor({ timeout: 20000 });
    await page.getByLabel("Mesaj pentru Lega").fill(BUG);
    await page.getByLabel("Mesaj pentru Lega").press("Enter");
    const cardBox = page.getByRole("group", { name: "Redeschiderea porții de execuție" });
    await cardBox.getByText("Ce rămâne oprit").waitFor({ timeout: 20000 });
    const kept = t.hub.db.prepare("SELECT id, status FROM work_requests WHERE project_id = ? ORDER BY created_at DESC LIMIT 1").get(project.id);
    assert.ok(kept?.id, "the request is kept");
    assert.equal(gate().status, "suspended", "showing the card changed nothing");
    // Enter on the focused card (the session was verified a minute ago: no prompt) = modality keyboard.
    await cardBox.getByText(/Poarta de execuție e oprită de Stop All/).first().click();
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Redeschiderea porții de execuție");
    await page.keyboard.press("Enter");
    await waitFor(() => gate().status === "open", 20000, 100);
    const second = JSON.parse(t.hub.db.prepare("SELECT payload_json FROM commands WHERE type = 'gate.rearm' ORDER BY rowid DESC LIMIT 1").get().payload_json);
    assert.equal(second.modality, "keyboard");
    assert.equal(second.requestId, kept.id);
    // The request came back as a PROPOSED plan: its card is on screen, not focused, not confirmed (its own confirmation is still needed).
    await waitFor(() => t.hub.db.prepare("SELECT COUNT(*) AS n FROM mission_envelopes WHERE project_id = ? AND status = 'PROPOSED'").get(project.id).n === 1, 20000, 100);
    await page.getByRole("button", { name: /Da, execută planul/ }).waitFor({ timeout: 20000 });
    await page.waitForTimeout(800); // the live lega.plan event and the rearm answer both show it: give either a chance to (wrongly) focus it
    assert.equal(await page.evaluate(() => document.activeElement?.classList?.contains("decision") && !document.activeElement?.classList?.contains("rearm")), false, "the plan card is not focused");
    assert.equal(count("SELECT COUNT(*) AS n FROM commands WHERE type = 'envelope.confirm'"), 0, "nothing confirmed");
    assert.equal(count("SELECT COUNT(*) AS n FROM agent_runs"), 0, "nothing started");
    assert.equal(count("SELECT COUNT(*) AS n FROM commands WHERE type = 'gate.set'"), 0, "no typed OPEN GATE");
    assert.deepEqual(pageErrors, [], "no uncaught page errors");
  } finally {
    await browser.close();
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
    await t.cleanup();
  }
});
