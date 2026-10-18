// 2.12.2 (L1): the local voice filter follows its setting DURING a running Lega session. Pure helpers (no DOM, no React) — covered by
// v2/tests/m10-2-p0r7-voice-ui.test.mjs. The Lega panel (web/src/shell/Lega.jsx) keeps the RTCRtpSender of the audio it sends and the
// microphone; when the Hub announces a change of the filter (settings.changed, key "voiceGate": Lega → Configurare, a deleted profile,
// another tab) it re-reads GET /api/voice and swaps the sent track at once: the filter's output when the filter is on, the raw
// microphone when it is off. Fail closed: while the filter is on (or its state cannot be read) the raw microphone never keeps flowing —
// if the filter cannot start there, the Lega session ends with the reason.

export const GATE_APPLY = Object.freeze({ START: "start_gate", STOP: "stop_gate", NONE: "none", FAIL_CLOSED: "stop_session_fail_closed" });

/** The Hub announced a change of the voice filter's setting (its value is never in the event: GET /api/voice says it). */
export function isGateSettingEvent(event) {
  return Boolean(event && event.type === "settings.changed" && event.payload?.key === "voiceGate");
}

/**
 * The filter's state from a GET /api/voice answer: { known, enabled, hasProfile, verifier }. An answer without a boolean
 * `gate.enabled` (a failed read, another shape) is UNKNOWN — never "off".
 */
export function gateStateOf(voice) {
  const enabled = voice && typeof voice === "object" ? voice.gate?.enabled : undefined;
  if (typeof enabled !== "boolean") return { known: false, enabled: null, hasProfile: false, verifier: null };
  return { known: true, enabled, hasProfile: Boolean(voice.profile), verifier: typeof voice.verifier?.id === "string" ? voice.verifier.id : null };
}

/**
 * What the Lega panel does with the filter now. `sessionActive`: a committed session of this tab (its peer, sender and microphone
 * exist); `gateRunning`: the filter runs in front of the sender; `enabled` / `hasProfile` / `known`: the Hub's state (gateStateOf).
 * - start_gate: the filter is on and does not run here yet → start it on the same microphone and send its output;
 * - stop_gate: the filter is off and still runs here → send the raw microphone and close the filter;
 * - stop_session_fail_closed: the filter should run (or its state is unknown) and cannot be started → the session ends;
 * - none: nothing to change (no session, or the page already matches the Hub; an unknown state keeps a running filter).
 */
export function decideGateApply({ sessionActive, gateRunning, enabled, hasProfile, known = true } = {}) {
  if (sessionActive !== true) return GATE_APPLY.NONE;
  const running = gateRunning === true;
  // Unknown: a running filter stays (the safe direction); raw audio is never kept on a guess.
  if (known !== true) return running ? GATE_APPLY.NONE : GATE_APPLY.FAIL_CLOSED;
  if (enabled !== true) return running ? GATE_APPLY.STOP : GATE_APPLY.NONE;
  // On without a profile: nothing could ever be recognised; a running filter keeps holding everything, raw audio is never sent.
  if (hasProfile !== true) return running ? GATE_APPLY.NONE : GATE_APPLY.FAIL_CLOSED;
  return running ? GATE_APPLY.NONE : GATE_APPLY.START;
}

/** Why the session ends (fail closed) — what the owner reads; `detail` is the technical cause, when there is one. */
export function gateFailClosedText({ known = true, hasProfile = true, detail = "" } = {}) {
  const tail = "Am oprit Lega, ca microfonul să nu ajungă nefiltrat la OpenAI. Repornește Lega.";
  const why = detail ? ` (${String(detail).slice(0, 160)})` : "";
  if (known !== true) return `Nu pot citi setarea filtrului vocal${why}. ${tail}`;
  if (hasProfile !== true) return "Filtrul vocal e pornit, dar profilul tău de voce lipsește. Am oprit Lega, ca microfonul să nu ajungă nefiltrat la OpenAI. Înregistrează vocea în Lega → Configurare sau oprește filtrul, apoi repornește Lega.";
  return `Filtrul vocal nu a pornit${why}. ${tail}`;
}

/** At the start: the filter is on but no profile exists → Lega does not start unfiltered. */
export const GATE_START_NO_PROFILE = "Filtrul vocal e pornit, dar profilul tău de voce lipsește; Lega nu pornește nefiltrată. Înregistrează vocea în Lega → Configurare sau oprește filtrul.";

/** The lines the running session shows (and announces) when the filter changed there. */
export const GATE_LIVE_TEXT = Object.freeze({
  on: "Filtrul vocal e pornit acum și în sesiunea aceasta: fiecare propoziție trece întâi prin el.",
  off: "Filtrul vocal e oprit acum și în sesiunea aceasta: tot ce aude microfonul ajunge la OpenAI.",
  keptUnknown: "Nu pot citi setarea filtrului vocal; îl las pornit în sesiunea aceasta. Dacă l-ai oprit, repornește Lega.",
  keptFailed: "Nu am putut opri filtrul vocal în sesiunea aceasta; rămâne pornit până repornești Lega.",
  micLost: "Nu am putut reporni microfonul în sesiunea aceasta. Am oprit Lega; repornește-o.",
  // Review F4: the Hub closes a session that started WITHOUT the filter when the filter is turned on (runtime/lega.mjs, U13) — the page
  // never claims the filter runs there; it mutes the microphone and closes the session too (the same words as the Hub's notice).
  closeUnfiltered: "Ai pornit filtrul vocal local, dar sesiunea Lega de acum a pornit fără el, așa că o închid. Repornește Lega: de acum fiecare propoziție trece întâi prin filtru.",
});

/**
 * Lega → Configurare: what the toggle did, said once it succeeded. OFF applies at once to a running Lega session; ON applies at once to
 * a session that started with the filter, while one that started without it is closed (review F4: the Hub's U13 rule) and restarted.
 */
export const GATE_TOGGLE_RESULT = Object.freeze({
  on: "Filtrul vocal e pornit: de acum fiecare propoziție trece întâi prin el. O sesiune Lega pornită fără filtru se închide acum; o repornești și merge cu filtrul.",
  off: "Filtrul vocal e oprit. Se aplică imediat, și sesiunii Lega care rulează: de acum tot ce aude microfonul ajunge la OpenAI.",
});

/** Bounded wait for the filter's state: a read that never answers is UNKNOWN (fail closed), never a hang. */
export const GATE_READ_TIMEOUT_MS = 8000;

/**
 * ONE application of the Hub's filter state to a committed Lega session. The effects are injected (the panel passes the real ones,
 * the tests fakes): `sender` (RTCRtpSender: replaceTrack), `rawTrack` (the microphone's audio track), `gate` (the filter running in
 * front of the sender, or null), `readState()` (GET /api/voice; may throw), `createGate()` (a new filter on the same microphone:
 * { track, close() }; may throw), `same()` (still the same session — false once it was stopped meanwhile).
 * Order, fail closed: while the raw microphone flows, the sender is muted FIRST (replaceTrack(null)) and stays muted until the state is
 * known; a filter that must run is started, then sent; a filter that must stop is closed only after the raw microphone replaced it.
 * Returns { outcome, text?, gate?, verifier? }:
 *   "started" (`gate`: the new filter, now sent — the caller keeps it), "stopped" (the old filter is closed, the raw microphone sent),
 *   "unchanged", "kept" (a running filter stays; `text` says why), "end" (the session must end; `text` says why), "gone" (the session
 *   ended meanwhile; nothing was kept), "close" (review F4: the filter was turned on for a session that started WITHOUT it — the Hub
 *   closes such a session, so no filter is started here; the sender stays muted and the caller closes the session; `text` says why).
 * `startedGated`: the Hub's own flag for this session (it started with the filter on). Only such a session may start the filter live.
 */
export async function runGateApply({ sender, rawTrack, gate = null, readState, createGate, same = () => true, startedGated = true }) {
  let muted = false;
  if (!gate) {
    try { await sender.replaceTrack(null); muted = true; }
    catch (e) { return { outcome: "end", text: gateFailClosedText({ detail: e?.message }) }; }
    if (!same()) return { outcome: "gone" };
  }
  let state; let detail = "";
  try { state = gateStateOf(await readState()); }
  catch (e) { state = gateStateOf(null); detail = e?.message || ""; }
  if (!same()) return { outcome: "gone" };
  const action = decideGateApply({ sessionActive: true, gateRunning: Boolean(gate), known: state.known, enabled: state.enabled, hasProfile: state.hasProfile });
  if (action === GATE_APPLY.FAIL_CLOSED) return { outcome: "end", text: gateFailClosedText({ known: state.known, hasProfile: state.hasProfile, detail }) };
  // Review F4: never claim the filter runs in a session the Hub is closing for having started without it; muted above, it stays muted.
  if (action === GATE_APPLY.START && startedGated !== true) return { outcome: "close", text: GATE_LIVE_TEXT.closeUnfiltered };
  if (action === GATE_APPLY.START) {
    let next = null;
    try { next = await createGate(); }
    catch (e) { return { outcome: "end", text: gateFailClosedText({ detail: e?.message }) }; }
    if (!same()) { next.close(); return { outcome: "gone" }; }
    try { await sender.replaceTrack(next.track); }
    catch (e) { next.close(); return { outcome: "end", text: gateFailClosedText({ detail: e?.message }) }; }
    if (!same()) { next.close(); return { outcome: "gone" }; }
    return { outcome: "started", gate: next, verifier: state.verifier, text: GATE_LIVE_TEXT.on };
  }
  if (action === GATE_APPLY.STOP) {
    // The raw microphone could not be put back: the filter simply stays (the safe direction).
    try { await sender.replaceTrack(rawTrack); }
    catch { return { outcome: "kept", text: GATE_LIVE_TEXT.keptFailed }; }
    gate.close();
    if (!same()) return { outcome: "gone" };
    return { outcome: "stopped", text: GATE_LIVE_TEXT.off };
  }
  // Nothing to change: the raw microphone muted above comes back (the filter is still off); a running filter stays.
  if (muted) {
    try { await sender.replaceTrack(rawTrack); }
    catch { return { outcome: "end", text: GATE_LIVE_TEXT.micLost }; }
    return { outcome: "unchanged" };
  }
  return state.known ? { outcome: "unchanged" } : { outcome: "kept", text: GATE_LIVE_TEXT.keptUnknown };
}
