// M07 test helpers for the local voice path (fixture worker, synthetic segments; never a person's voice).
import { voicePcm, toBuffer } from "./fixtures/voice-pcm.mjs";
import { ENROLL_PHRASES, VOICE_CONSENT_TEXT } from "../server/owner/voice.mjs";
import { LEGA_CONSENT_VERSION } from "../server/policy/lega-policy.mjs";

export const OWNER_SPEAKER = 10;
export const NEAR_SPEAKER = 13; // three bins away: cosine ~0.37, UNCERTAIN (between rejectBelow 0.28 and the 0.55 ceiling)
export const OTHER_SPEAKER = 20;
export const segment = (text, { speaker = OWNER_SPEAKER, seconds = 2.5, ...rest } = {}) => toBuffer(voicePcm({ speaker, text, seconds, ...rest }));

/** Enrols the owner's (synthetic) voice through the same service calls the routes use: five phrases, then the consent. */
export async function enrolVoice(t, owner, { speaker = OWNER_SPEAKER, count = 5 } = {}) {
  for (let i = 0; i < count; i += 1) {
    const r = await t.hub.voice.enrollSample({ session: owner.session, buffer: segment(ENROLL_PHRASES[i], { speaker }), phraseIndex: i });
    if (!r.accepted) throw new Error(`sample ${i} refused: ${r.problems.join("; ")}`);
  }
  return (await t.hub.commands.dispatch({ type: "voice.enroll.finish", channel: "test", actor: "t", ownerSession: owner.session, payload: { consentText: VOICE_CONSENT_TEXT } })).result;
}

/**
 * M10.2 U13: a LIVE Lega session derived from the owner session (voice-first policy, consent recorded, fixture app-server), connected
 * — the only kind of Lega session a plan can be armed for. Call after prepareLiveWithoutGrants (billing, isolation, gate open) and,
 * for a gated session, after the voice gate was enabled (the session records the gate at its start).
 */
export async function startDerivedLega(t, owner) {
  t.hub.bus.transaction(() => t.hub.settings.set("legaConsent", { version: LEGA_CONSENT_VERSION, confirmedAt: new Date().toISOString() }, "test"));
  t.hub.refreshCodexConfig();
  const started = (await t.hub.commands.dispatch({ type: "lega.session.start", channel: "owner", actor: `owner:${owner.session.id}`, ownerSession: owner.session, payload: { sdp: LEGA_OFFER } })).result;
  await t.hub.commands.dispatch({ type: "lega.session.connected", channel: "ui", actor: "user", payload: { sessionId: started.sessionId } });
  return started.sessionId;
}
const LEGA_OFFER = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n";

/** One analysed segment (server-side decision), as the page would send it. */
export const speak = (t, owner, text, options = {}) => t.hub.voice.analyzeUtterance({ session: owner.session, buffer: segment(text, options), purpose: options.purpose || "confirm",
  legaSessionId: options.legaSessionId || null, envelopeId: options.envelopeId || null, flags: options.flags || {} });
