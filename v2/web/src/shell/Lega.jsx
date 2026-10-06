import { useCallback, useEffect, useRef, useState } from "react";
import { AudioLines, Mic, MicOff, Square, X, Check, Ban, ShieldCheck, Volume2, VolumeX, Maximize2, Globe } from "lucide-react";
import { api, ensureToken } from "../api.js";
import { useHub, getState, setState, onLive, onHubEvent, pushToast, useResource, useAction, refresh } from "../store.js";
import { Chip, Notice, Checks, ErrorNotice } from "../components/ui.jsx";
import { legaLevels, legaStartOptions } from "../lib/legaLevels.js";
import { offerGrantPrefill, pointAt } from "../lib/legaBridge.js";
import { isAppShortcut, approvedNotStarted, legaStartReadiness, legaCheckHint, planRefOfLive, isCockpitHash, legaPointAction, legaPointPath, shellPlanAction,
  LEGA_ACCOUNT_AUTO_HINT, LEGA_START_CHECKING } from "../lib/uiLogic.js";
import { unlockSession } from "../lib/ownerSession.js";
import { continueVoiceNotice, rearmOutcome, rearmOfferFor, REARM_SETUP } from "../lib/rearmLogic.js";
import { faceElsewhere } from "../lib/cockpitLogic.js";
import { RearmCard } from "../screens/lega/RearmCard.jsx";

// M10: the web-search setting the Lega panel last displayed; the start sends it, so a stale page never starts under a setting the
// owner did not see (the Hub refuses with LEGA_TERMS_CHANGED).
let shownWebSearch = null;
import { createVoiceGate } from "../lib/voiceGate.js";
import { presentedPlan, looksLikeConfirmation, isCapturing, preferredMic, isArmed, markArmed, armedEventEffect } from "../lib/voiceContext.js";
import { GATE_APPLY, decideGateApply, gateStateOf, isGateSettingEvent, gateFailClosedText, runGateApply, GATE_START_NO_PROFILE, GATE_READ_TIMEOUT_MS } from "../lib/voiceGateApply.js";

/**
 * Lega — the Hub's voice assistant (GPT-Live via Codex, ChatGPT plan).
 * The BROWSER owns the WebRTC peer: microphone and speaker connect straight to OpenAI; the Hub only relays the SDP
 * offer/answer, keeps final transcript text (redacted) and turns Lega's intents into Hub commands and click approvals.
 * Stop order: close the peer here first (it is the only way to end the media), then tell the Hub.
 * Every start attempt has a generation number: a Stop during the start cancels it, and nothing from a cancelled attempt
 * (microphone, peer, session) survives.
 */
const ICE_WAIT_MS = 3000;
const SSE_LOSS_MS = 10000;

const fmtClock = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

function waitIceComplete(pc) {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { pc.removeEventListener("icegatheringstatechange", check); clearTimeout(timer); resolve(); };
    const check = () => { if (pc.iceGatheringState === "complete") done(); };
    const timer = setTimeout(done, ICE_WAIT_MS);
    pc.addEventListener("icegatheringstatechange", check);
  });
}

/** Level meter driven by the real audio signal (RMS), written straight to the DOM (no re-render per frame). */
function attachMeter(stream, barRef, channel) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser(); analyser.fftSize = 512;
    src.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    let raf = 0;
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0; for (const v of data) { const x = (v - 128) / 128; sum += x * x; }
      const level = Math.min(1, Math.sqrt(sum / data.length) * 4);
      if (barRef.current) barRef.current.style.transform = `scaleX(${level.toFixed(3)})`;
      if (channel) { legaLevels[channel] = level; legaLevels.updatedAt = performance.now(); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); if (channel) legaLevels[channel] = 0; try { src.disconnect(); ctx.close(); } catch { /* closed */ } };
  } catch { return () => {}; }
}

/** Microphone errors explained in Romanian, with the way out. */
function micError(error) {
  const name = error?.name || "";
  if (name === "NotAllowedError" || name === "SecurityError") return new Error("Microfonul este blocat pentru Hub. Apasă iconița lacăt din bara de adrese → Setări site → Microfon: Permite, apoi reîncearcă.");
  if (name === "NotFoundError" || name === "OverconstrainedError") return new Error("Nu găsesc niciun microfon. Conectează unul sau alege-l în Windows → Setări → Sunet.");
  if (name === "NotReadableError" || name === "AbortError") return new Error("Microfonul este folosit de altă aplicație (Teams, Zoom, alt tab). Închide-o și reîncearcă.");
  return error;
}

const stopRequest = (id, reason) => ensureToken().then((token) => fetch(`/api/lega/sessions/${id}/stop`, { method: "POST", keepalive: true, headers: { "Content-Type": "application/json", "X-Hub-Token": token }, body: JSON.stringify({ reason }) })).catch(() => {});
/** D23: a start refusal whose message names check ids carries their texts in `details.reasonDetail`: shown with the message. */
const withReasonDetail = (error) => (error?.details?.reasonDetail ? { ...error, status: error.status, category: error.category, message: `${error.message} — ${error.details.reasonDetail}` } : error);

/**
 * The local voice filter's options, shared by the start and by a filter turned on during the session (L1): the Lega session and the
 * plan on screen at the end of each sentence (the Hub binds the segment to both), and what each decision does.
 */
function gateOptions(refs, setGateLog) {
  return {
    context: () => ({ legaSessionId: refs.current.sessionId, envelopeId: presentedPlan()?.envelopeId || null }),
    // M10.2 U13: a segment the Hub bound to an ARMED plan is confirmed by the Hub itself (even when no card is on screen): the
    // page only reports the outcome. Otherwise (a plan shown here, not armed) the page path forwards the segment, as in M07.
    onDecision: (d) => {
      setGateLog((log) => [...log.slice(-5), { at: Date.now(), ...d }]);
      if (d.result !== "MATCH") return;
      if (d.armed && d.boundPlanId) { if (!isCapturing(d.boundPlanId)) observeArmedConfirmation(d); return; }
      if (d.envelopeId && !isCapturing(d.envelopeId)) followSpokenConfirmation(d);
    },
  };
}

/** GET /api/voice bounded in time: a read that never answers counts as failed (the caller fails closed), never as a hang. */
function readVoiceState() {
  let timer = null;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("fără răspuns de la Hub")), GATE_READ_TIMEOUT_MS); });
  return Promise.race([api("/api/voice"), timeout]).finally(() => clearTimeout(timer));
}

export function Lega({ go }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("off"); // off | preparing | connecting | active | stopping
  const [session, setSession] = useState(null);
  const [lines, setLines] = useState([]); // {id, role, text, final}
  const [micMuted, setMicMuted] = useState(false);
  const [legaMuted, setLegaMuted] = useState(false);
  const [error, setError] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [announce, setAnnounce] = useState("");
  // M10.2 (U15): an arrow Lega offered while a plan was on screen (or in the cockpit): shown inline, followed only on „Deschide”.
  const [pointHint, setPointHint] = useState(null);
  // D23: while the start request is in flight and the Hub checks the Codex account by itself, the panel says so (null otherwise).
  const [startNote, setStartNote] = useState(null);
  // Under the voice-first policy Lega's legacy proposal cards are the old path: still shown (and decidable) but labelled as such.
  const ownerPolicy = useResource("/api/owner/status", { reloadOn: (e) => e.type === "settings.changed" && e.payload?.key === "ownerPolicy" });
  const voiceFirst = Boolean(ownerPolicy.data?.policy?.active);
  // L1: `sender` is the RTCRtpSender of the sent audio (its track is swapped when the filter changes during the session); `gateChain`
  // runs those swaps one at a time; `gateDirty` marks a filter change seen while a start was still in flight (applied once committed).
  const refs = useRef({ pc: null, mic: null, gate: null, sender: null, audio: null, sessionId: null, pendingId: null, posting: false, seq: 0, meters: [], connectedAt: 0, lossTimer: null, bootId: null, openLine: {},
    gateChain: Promise.resolve(), gateQueued: false, gateDirty: false });
  // M06: the local voice gate in front of the transport (null = not enabled: everything the microphone hears goes to OpenAI).
  const [gateInfo, setGateInfo] = useState(null);
  const [gateLog, setGateLog] = useState([]);
  const micBar = useRef(null); const legaBar = useRef(null);
  const connection = useHub((s) => s.connection);
  const hubLega = useHub((s) => s.hub?.lega);
  const bootId = useHub((s) => s.hub?.bootId);
  const serverTime = useHub((s) => s.hub?.serverTime);
  const statusRef = useRef(status); statusRef.current = status;
  const openRef = useRef(open); openRef.current = open;
  // L1: schedules one application of the Hub's current filter setting to this tab's session (set below, on every render).
  const gateApplyRef = useRef(null);

  const setPhase = (legaPhase) => setState({ legaPhase });
  const toOff = () => { setStatus("off"); setPhase("off"); setState({ legaAuthority: null }); };

  const closeLocal = useCallback(() => {
    const r = refs.current;
    r.meters.forEach((off) => off()); r.meters = [];
    try { r.pc?.getSenders().forEach((s) => s.track?.stop()); r.pc?.close(); } catch { /* closed */ }
    r.mic?.getTracks().forEach((t) => t.stop());
    r.gate?.close();
    if (r.audio) { r.audio.srcObject = null; r.audio.muted = false; }
    legaLevels.muted = false;
    r.pc = null; r.mic = null; r.gate = null; r.sender = null; r.gateDirty = false; r.openLine = {};
    clearTimeout(r.lossTimer);
    setPhase("off");
  }, []);

  const stop = useCallback(async (reason = "user") => {
    const r = refs.current;
    r.seq += 1; // cancels a start in flight
    const id = r.sessionId || r.pendingId;
    const wasPosting = r.posting;
    setStatus("stopping");
    closeLocal();
    r.sessionId = null; r.pendingId = null;
    if (id) await stopRequest(id, reason);
    else if (wasPosting) await stopRequest("current", reason); // the start POST is still running: stop whatever is live
    toOff();
    refresh();
  }, [closeLocal]);

  // A failure is always shown: the full-screen stage covers the panel and the toasts, so it closes first; a toast when the panel was closed.
  const showFailure = useCallback((error, prefix) => {
    setError(error);
    if (getState()?.stageOpen) setState({ stageOpen: false });
    if (!openRef.current) pushToast("lega-start", "error", `${prefix}: ${error?.message || error}`);
    setOpen(true);
  }, []);

  const start = useCallback(async (opts = {}) => {
    const r = refs.current;
    if (statusRef.current !== "off") return;
    const seq = ++r.seq;
    const alive = () => r.seq === seq;
    setError(null); setLines([]); setGateLog([]); setMicMuted(false); setLegaMuted(false); setStatus("preparing"); setPhase("connecting");
    r.bootId = bootId || null; r.openLine = {};
    let mic = null; let pc = null; let gate = null;
    const dispose = () => { mic?.getTracks().forEach((t) => t.stop()); gate?.close(); try { pc?.close(); } catch { /* closed */ } };
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) throw new Error("Browserul nu permite microfon + WebRTC aici");
      // M10: one click. What the start needs, before any microphone prompt: with no owner session (voice-first policy) the click
      // opens it once (Windows Hello / your key) and the Hub derives the one-session authority itself; a real blocker (the gate
      // after Stop All, the consent, billing…) is named instead.
      const pre = await api("/api/lega");
      if (!alive()) return dispose();
      const rd = legaStartReadiness(pre);
      // A real blocker first: opening the session (Windows Hello) would not help, so it is not asked for.
      // M10.2.1: the gate's hint names the rearm card shown in this panel (voice-first: never an administration pointer).
      // D23: a check the Hub settles itself at start (a stale Codex account check; `auto`) is not in `blocking`: the start goes on,
      // and — only a start derived from the owner session checks the account — the session is opened first when there is none.
      if (rd.blocking.length) throw new Error(`Lega nu poate porni încă: ${rd.blocking.map((c) => legaCheckHint(c.id, { voiceFirst: rd.policyActive }) || c.detail).join(" · ")}`);
      if (rd.needsSession) { await unlockSession("unlock"); if (!alive()) return dispose(); }
      // The web-search mode the owner saw: the one the sender showed (cockpit reply), else the one this panel displayed. Live web
      // search never starts unseen: the panel opens and one more click starts it.
      const fresh = pre?.preview?.webSearch || pre?.settings?.webSearch || null;
      const expectWebSearch = (typeof opts?.expectWebSearch === "string" && opts.expectWebSearch) || shownWebSearch || null;
      if (!expectWebSearch && fresh === "live") { throw new Error("Căutarea pe internet e pornită (live): verifică setarea în panoul Lega și apasă încă o dată „Pornește Lega”."); }
      // The microphone chosen in setup (the profile was recorded with it), else the default one.
      const deviceId = preferredMic();
      try { mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, ...(deviceId ? { deviceId: { ideal: deviceId } } : {}) } }); }
      catch (e) { throw micError(e); }
      if (!alive()) return dispose();
      pc = new RTCPeerConnection(); // no STUN/TURN, like the official Codex voice helper
      // M06: with the voice gate enabled, the track sent to OpenAI is the gate's output (each sentence held until the local
      // speaker check), never the raw microphone. If the enabled gate cannot start, Lega does not start unfiltered.
      // Fail closed: if the filter state cannot be read, Lega does not start with the raw microphone.
      // L1: a filter change from here on is applied once the session is committed (`gateDirty`), never lost between read and commit.
      r.gateDirty = false;
      let voice;
      try { voice = await readVoiceState(); }
      catch (e) { throw new Error(`Nu pot citi starea filtrului vocal (${e.message}); Lega nu pornește nefiltrată`); }
      const gateState = gateStateOf(voice);
      const gateStart = decideGateApply({ sessionActive: true, gateRunning: false, ...gateState });
      // An answer without the filter's state, or the filter on without a voice profile: never started on the raw microphone.
      if (gateStart === GATE_APPLY.FAIL_CLOSED) throw new Error(gateState.known ? GATE_START_NO_PROFILE : "Nu pot citi starea filtrului vocal; Lega nu pornește nefiltrată");
      let sendTrack = mic.getAudioTracks()[0];
      if (gateStart === GATE_APPLY.START) {
        try {
          gate = await createVoiceGate(mic, gateOptions(refs, setGateLog));
          sendTrack = gate.track;
          setGateInfo({ enabled: true, strict: true, verifier: gateState.verifier });
        } catch (e) { throw new Error(`Filtrul vocal local nu a pornit (${e.message}); Lega nu pornește nefiltrată cât timp filtrul e activat`); }
      } else setGateInfo({ enabled: false });
      if (!alive()) return dispose();
      // L1: the sender is kept, so the filter can be put in front of the microphone (or taken away) during the session.
      const sender = pc.addTrack(sendTrack, new MediaStream([sendTrack]));
      const dc = pc.createDataChannel("oai-events"); // required by the offer; the app-server sideband controls the session
      // M05: an error event on the data channel (when the provider sends one) is shown and kept with the stop reason.
      dc.onmessage = (event) => { try { const m = JSON.parse(String(event.data)); if (m?.type === "error") r.peerError = String(m.error?.message || m.message || "eroare").slice(0, 200); } catch { /* not JSON */ } };
      pc.ontrack = (event) => {
        if (!alive() || !r.audio) return;
        r.audio.srcObject = event.streams[0];
        r.audio.play().catch(() => {});
        r.meters.push(attachMeter(event.streams[0], legaBar, "lega"));
      };
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitIceComplete(pc);
      if (!alive()) return dispose();
      r.posting = true;
      let body;
      // Always sent (M10.2): the Hub refuses a live start that does not name 'live'; with nothing known, "disabled" fails closed.
      const expected = expectWebSearch || fresh || "disabled";
      const post = () => api("/api/lega/sessions", { method: "POST", body: { sdp: pc.localDescription.sdp, expectWebSearch: expected } });
      // D23: during this request the Hub checks the Codex account by itself before admitting the session (a few seconds, no
      // inference). The panel says what is happening; if the check fails, the Hub's refusal names what failed (shown below).
      if (rd.accountCheck) { setStartNote(LEGA_START_CHECKING); setAnnounce(LEGA_START_CHECKING); }
      try {
        try { body = await post(); }
        catch (e) {
          // The owner session idled out between the check and the POST: open it once and repeat (the SDP offer is still valid).
          // Not "posting" during the ceremony: a session another client starts meanwhile is never adopted (and stopped) as ours.
          if (!e?.details?.needSession) throw e;
          r.posting = false; r.pendingId = null;
          await unlockSession("unlock");
          if (!alive()) return dispose();
          r.posting = true;
          body = await post();
        }
      } finally { r.posting = false; setStartNote(null); }
      const result = body?.result || body;
      if (!alive()) { dispose(); await stopRequest(result.sessionId, "cancelled-during-start"); return; }
      await pc.setRemoteDescription({ type: "answer", sdp: result.answerSdp });
      if (!alive()) { dispose(); await stopRequest(result.sessionId, "cancelled-during-start"); return; }
      // The attempt is committed: from here the refs own the microphone and the peer.
      r.mic = mic; r.pc = pc; r.gate = gate; r.sender = sender; r.sessionId = result.sessionId; r.pendingId = null; r.committedAt = Date.now();
      // Review F4: whether the Hub admitted this session WITH the filter (its U13 rule closes one that started without it when the
      // filter is turned on); the page's own start decision when the Hub did not say.
      r.startedGated = typeof result.gated === "boolean" ? result.gated : Boolean(gate);
      r.meters.push(attachMeter(mic, micBar, "mic"));
      // L1: the filter changed while this start was in flight: applied now, to the committed session.
      if (r.gateDirty) gateApplyRef.current?.();
      setSession({ id: result.sessionId, maxDurationS: result.maxDurationS, voice: result.voice });
      setState({ legaAuthority: result.authority || "grant" });
      setStatus("connecting");
      let reported = false;
      // After admission (peer failed, connect report failed, not active): the reason is shown like a start failure.
      const failAfterAdmit = async (reason, error = null) => {
        if (!alive()) return;
        showFailure(error || new Error(reason), "Lega s-a oprit");
        await stop(reason);
      };
      const onConnected = async () => {
        if (reported || !alive()) return;
        reported = true;
        const sid = r.sessionId;
        try {
          const res = await api(`/api/lega/sessions/${sid}/connected`, { method: "POST", body: {} });
          const view = res?.result ?? res;
          if (!alive() || r.sessionId !== sid || r.pc !== pc) return;
          if (view?.status !== "active") { await failAfterAdmit("not-active-after-connect"); return; }
          r.connectedAt = Date.now();
          setStatus("active"); setPhase("listening");
        } catch (e) {
          await failAfterAdmit("connect-report-failed", e);
        }
      };
      dc.onopen = onConnected;
      pc.onconnectionstatechange = () => {
        if (!alive()) return;
        if (pc.connectionState === "connected") onConnected();
        if (["failed", "closed"].includes(pc.connectionState) && r.sessionId) failAfterAdmit(`peer-${pc.connectionState}${r.peerError ? `: ${r.peerError}` : ""}`);
      };
    } catch (e) {
      dispose();
      if (!alive()) return;
      // Started from the stage, the cockpit or an intent, the panel may be closed or covered: the reason is always shown.
      // D23: after the Hub's own account check a refusal names the failing checks by id (that text is persisted on the Hub); what each
      // one says travels only in the response (`reasonDetail`) and is shown here, next to the message.
      showFailure(withReasonDetail(e), "Lega nu a pornit");
      await stop("start-failed");
    }
  }, [stop, bootId, showFailure]);

  // L1 (2.12.2): the voice filter follows its setting during the session. A change (Lega → Configurare, a deleted profile, another tab)
  // is applied at once to THIS tab's committed session: the filter's output or the raw microphone goes to the kept sender. Fail closed:
  // while the raw microphone flows, the sender is muted until the new state is known; a filter that should run and cannot start (or a
  // state that cannot be read) ends the session with the reason — the raw microphone never keeps flowing while the filter is on.
  const sessionLine = (text) => { setLines((ls) => [...ls.slice(-60), { id: `vg-${Date.now()}-${ls.length}`, role: "system", text, final: true }]); setAnnounce(text); };
  const applyGateNow = async () => {
    const r = refs.current;
    const { pc, sessionId: sid, sender, mic } = r;
    // Not committed yet: a start in flight applies it once committed (its own read may predate the change).
    if (!pc || !sid || !sender || !mic) { if (statusRef.current === "preparing" || statusRef.current === "connecting") r.gateDirty = true; return; }
    r.gateDirty = false;
    const same = () => r.pc === pc && r.sessionId === sid && r.sender === sender;
    const endSession = async (text) => { if (!same()) return; showFailure(new Error(text), "Lega s-a oprit"); await stop("voice-gate-unavailable"); };
    try {
      // The order (mute the raw microphone first, start-then-send, close-after-replace) lives in runGateApply (lib/voiceGateApply.js).
      const out = await runGateApply({ sender, rawTrack: mic.getAudioTracks()[0] || null, gate: r.gate, readState: readVoiceState,
        createGate: () => createVoiceGate(mic, gateOptions(refs, setGateLog)), same, startedGated: r.startedGated === true });
      if (out.outcome === "end") { await endSession(out.text); return; }
      // Review F4: the filter turned on for a session that started without it: the microphone stays muted and the session closes (the
      // Hub closes it too); the owner restarts Lega, now with the filter.
      if (out.outcome === "close") { if (same()) { sessionLine(out.text); await stop("voice-gate-enabled"); } return; }
      if (!same()) { if (out.outcome === "started") out.gate.close(); return; }
      if (out.outcome === "started") { r.gate = out.gate; setGateInfo({ enabled: true, strict: true, verifier: out.verifier }); setGateLog([]); sessionLine(out.text); }
      else if (out.outcome === "stopped") { r.gate = null; setGateInfo({ enabled: false }); setGateLog([]); sessionLine(out.text); }
      else if (out.outcome === "kept") sessionLine(out.text);
    } catch (e) { await endSession(gateFailClosedText({ detail: e?.message })); }
  };
  gateApplyRef.current = () => {
    const r = refs.current;
    if (r.gateQueued) return r.gateChain; // a run not started yet reads the newest state anyway
    r.gateQueued = true;
    r.gateChain = r.gateChain.then(() => { r.gateQueued = false; return applyGateNow(); }).catch(() => {});
    return r.gateChain;
  };
  // L1: the Hub announced a change of the voice filter (its value is read back from GET /api/voice): applied to this tab's session.
  useEffect(() => onHubEvent((e) => { if (isGateSettingEvent(e)) gateApplyRef.current?.(); }), []);

  // Pending Lega proposals are approvals: they survive the session, a reload and an SSE drop.
  const proposals = useResource("/api/approvals?status=pending", { reloadOn: (e) => e.type.startsWith("approval.") || e.type.startsWith("command.") || e.type === "lega.proposal" });
  const isLegaKind = (a) => a.actionKind === "lega.run_request" || a.actionKind === "lega.mission_request";
  // Approved elsewhere (e.g. the Approvals screen) but never started: kept here with "Pornește acum" until they expire.
  const approvedLega = useResource("/api/approvals?status=approved", { reloadOn: (e) => e.type.startsWith("approval.") || e.type.startsWith("command.") });
  const legaProposals = [...(proposals.data?.approvals || []).filter(isLegaKind), ...approvedNotStarted(approvedLega.data?.approvals || []).filter(isLegaKind)];
  const reloadProposals = useRef(proposals.reload); reloadProposals.current = proposals.reload;

  // M10.2 U13: which plan is armed comes from the Hub's events (any tab, a reload, Lega having navigated away), never from page memory.
  useEffect(() => onHubEvent((e) => { const fx = armedEventEffect(e); if (fx) markArmed(fx.id, fx.until); }), []);
  // M10.2.1 (D18): the owner's spoken „Continuă”, decided by the Hub from the locally verified voice of THIS tab's Lega session: the
  // transcript shows what the Hub did (it also says it aloud); a held one (the gate is stopped) points to the cockpit's rearm card.
  useEffect(() => onHubEvent((e) => {
    const n = continueVoiceNotice(e, { legaSessionId: refs.current.sessionId });
    if (!n) return;
    setLines((ls) => [...ls.slice(-60), { id: `cv-${e.seq || Date.now()}`, role: "system", text: n.line, final: true }]);
    setAnnounce(n.line);
    if (n.toast) pushToast(`lega-continue-${n.toast.level}`, n.toast.level, n.toast.text, n.toast.openPath ? { openPath: n.toast.openPath, openLabel: n.toast.openLabel, closeStage: n.toast.closeStage === true } : undefined);
    if (e.type === "owner.continue_voice") refresh();
  }), []);

  // Live events from the Hub, for THIS tab's session only.
  useEffect(() => onLive((e) => {
    const r = refs.current;
    if (!e?.type?.startsWith("lega.")) return;
    const sid = e.sessionId || e.session?.id || null;
    // While this tab's start POST is running, the session announced as "starting" is ours (the Hub admits one at a time).
    if (!r.sessionId && r.posting && e.type === "lega.session" && e.session?.status === "starting") { r.pendingId = e.session.id; return; }
    // „Taci” from the cockpit (owner.interrupt mute) silences whatever session plays, without stopping the work.
    if (e.type === "lega.silence" && e.all) { if (r.audio) r.audio.muted = true; legaLevels.muted = true; setLegaMuted(true); return; }
    const mine = r.sessionId ? sid === r.sessionId : (r.pendingId && sid === r.pendingId);
    // M10.2 (U15): a plan the Hub announced. The cockpit, when it is on screen, shows and focuses the card itself. Elsewhere: a plan
    // from THIS tab's voice session opens the cockpit (the owner just asked for it); any other plan (another tab, a kept request
    // that became plannable) only offers „Deschide planul” — the owner's screen is never switched for something they did not ask now.
    // Review #41: the full-screen stage (a modal over the cockpit and the toasts) closes first for a plan of THIS tab's own session, so
    // the card is visible where the cockpit shows and focuses it; a plan from elsewhere leaves the stage as it is (the cockpit then
    // never moves the focus to a card hidden behind it).
    if (e.type === "lega.plan") {
      const ref = planRefOfLive(e);
      if (!ref) return;
      const fx = shellPlanAction({ ref, mine: Boolean(mine), onCockpit: isCockpitHash(window.location.hash), stageOpen: Boolean(getState()?.stageOpen) });
      if (fx.closeStage) setState({ stageOpen: false });
      if (fx.navigate) { go(fx.navigate); setAnnounce("Lega a pregătit planul: îl vezi în cockpit și îl confirmi o singură dată."); }
      else if (fx.toast) pushToast(`plan-${ref.id}`, "info", "Un plan te așteaptă în cockpit (o singură confirmare)", { openPath: fx.toast, openLabel: "Deschide planul" });
      return;
    }
    if (!mine) { if (e.type === "lega.proposal") reloadProposals.current(); return; }
    if (e.type === "lega.session.stopping") { closeLocal(); setStatus("stopping"); }
    else if (e.type === "lega.session" && e.session?.status === "ended") {
      closeLocal(); r.sessionId = null; r.pendingId = null; toOff();
      // M05: the provider's own words come with the reason ("closed: error" alone said nothing); errors are not "info".
      if (e.session.endReason && e.session.endReason !== "user") pushToast(`lega-${e.session.id}`, e.session.lastError || /error|failed|eșu/.test(e.session.endReason) ? "error" : "info", `Lega s-a oprit: ${e.session.endReason}${e.session.endDetail ? ` — ${e.session.endDetail}` : ""}`);
      refresh();
    }
    else if (e.type === "lega.phase") setPhase(e.phase === "ended" ? "off" : e.phase);
    else if (e.type === "lega.transcript.partial" || e.type === "lega.transcript.done") {
      const role = e.role === "user" ? "user" : "assistant";
      const final = e.type === "lega.transcript.done";
      setLines((ls) => {
        const openId = r.openLine[role];
        const idx = openId ? ls.findIndex((l) => l.id === openId) : -1;
        let next;
        if (idx >= 0) { next = ls.slice(); next[idx] = { ...next[idx], text: e.text, final }; }
        else { const id = `${role}-${Date.now()}-${ls.length}`; r.openLine[role] = id; next = [...ls.slice(-60), { id, role, text: e.text, final }]; }
        if (final) r.openLine[role] = null;
        return next;
      });
      if (final && e.text) setAnnounce(`${role === "user" ? "Tu" : "Lega"}: ${e.text}`);
    }
    else if (e.type === "lega.delegation") setLines((ls) => [...ls.slice(-60), { id: `d-${Date.now()}`, role: "system", text: `→ Predat agentului: „${e.text}”`, final: true }]);
    else if (e.type === "lega.navigate" && e.path) go(e.path);
    // Review F7 (L8): a face command heard by voice while the Lega screen is not on display — the cockpit applies it itself when shown.
    // Elsewhere the view preferences it reads are stored and, for a face or the core, the Lega screen opens: what the Hub reports („Am
    // arătat fața Legăi pe ecran”) is what the owner sees. View only: no authority, nothing sent to the Hub.
    else if (e.type === "lega.face") {
      const fx = faceElsewhere(e, sid, { onCockpit: isCockpitHash(window.location.hash) });
      if (fx) {
        for (const [key, value] of fx.prefs) { try { localStorage.setItem(`hub.v2.${key}`, JSON.stringify(value)); } catch { /* storage unavailable: the cockpit keeps its own view */ } }
        if (fx.navigate) { go(fx.navigate); setAnnounce("Lega își arată fața pe ecranul Lega."); }
      }
    }
    // M10.2 U13: the Hub armed the plan it just said; the card (wherever it is) hides its mic button and shows the window.
    else if (e.type === "lega.plan_armed" && e.planId) { markArmed(e.planId, e.expiresAt); setAnnounce("Fereastra vocală e deschisă: spune „Da, execută planul” ca să pornească, sau „Nu acum”."); }
    // "Arată-mi unde…": open the screen, then the arrow finds the marked element once it is rendered. M10.2 (U15): never away from
    // a plan on screen or from the cockpit (that unmounted the card and lost its armed voice window): an inline hint with an
    // explicit „Deschide” instead; the owner chooses when to leave.
    else if (e.type === "lega.point" && e.target) {
      const path = legaPointPath(e.target, e.path || null);
      const action = legaPointAction({ path, presented: Boolean(presentedPlan()), hash: window.location.hash });
      if (action === "hint") { setPointHint({ kind: "point", path, target: e.target, label: e.label || e.target }); setOpen(true); setAnnounce(`Lega îți poate arăta: ${e.label || e.target}. Apasă Deschide când vrei; planul rămâne pe ecran.`); }
      else { if (action === "navigate") go(path); pointAt(e.target, e.label); setAnnounce(`Lega arată: ${e.label || e.target}`); }
    }
    // The grant form is only filled in; creating the grant stays the owner's click on "Creează grant" (legacy policy only).
    else if (e.type === "lega.prefill" && e.form) {
      const action = legaPointAction({ path: e.path || "/integrations", presented: Boolean(presentedPlan()), hash: window.location.hash });
      if (action === "hint") { setPointHint({ kind: "prefill", path: e.path || "/integrations", target: e.target || "grant-create", label: e.label || "Creează grant", form: e.form }); setOpen(true); setAnnounce("Lega a pregătit valorile unui grant: apasă Deschide când vrei să le vezi."); }
      else {
        go(e.path || "/integrations"); offerGrantPrefill(e.form); pointAt(e.target || "grant-create", e.label);
        setAnnounce("Lega a completat formularul de grant: verifică valorile și apasă tu Creează grant.");
      }
    }
    else if (e.type === "lega.web") setLines((ls) => [...ls.slice(-60), { id: `w-${Date.now()}-${ls.length}`, role: "system", text: `Caut pe internet${e.text ? `: „${e.text}”` : "…"}`, final: true }]);
    else if (e.type === "lega.silence") { if (r.audio) r.audio.muted = true; legaLevels.muted = true; setLegaMuted(true); }
    else if (e.type === "lega.proposal") { reloadProposals.current(); setOpen(true); setAnnounce(e.kind === "mission" ? "Lega propune o misiune: verifică și aprobă sau refuză pe ecran." : "Lega propune o execuție: verifică și aprobă sau refuză pe ecran."); }
    else if (e.type === "lega.notice") pushToast(`lega-notice-${Date.now()}`, e.level === "error" ? "error" : "warning", e.text);
  }), [closeLocal, go]);

  // Watchdog: if the Hub stream is lost, the peer is closed locally (the media must never outlive the Hub's control).
  useEffect(() => {
    const r = refs.current;
    if (status !== "active" && status !== "connecting") return undefined;
    clearTimeout(r.lossTimer);
    if (connection !== "live") r.lossTimer = setTimeout(() => stop("hub-stream-lost"), SSE_LOSS_MS);
    return () => clearTimeout(r.lossTimer);
  }, [connection, status, stop]);

  // The Hub may no longer have this session: restarted (new boot), Stop All from another tab, timers. Only a state
  // snapshot taken after this session was committed can say so (an older snapshot does not know the session yet).
  useEffect(() => {
    const r = refs.current;
    if (status !== "active" && status !== "connecting") return;
    const restarted = r.bootId && bootId && bootId !== r.bootId;
    const fresh = serverTime && r.committedAt && Date.parse(serverTime) > r.committedAt + 500;
    const gone = fresh && (hubLega == null || hubLega.id !== r.sessionId || ["stopping", "ended"].includes(hubLega.status));
    if (restarted || gone) stop(restarted ? "hub-restarted" : "hub-lost-session");
  }, [hubLega, bootId, serverTime, status, stop]);

  // Leaving the page or unmounting ends the session (keepalive request carries the token).
  useEffect(() => {
    const onHide = () => { const r = refs.current; const id = r.sessionId || r.pendingId; r.seq += 1; closeLocal(); if (id) stopRequest(id, "page-hidden"); else if (r.posting) stopRequest("current", "page-hidden"); };
    window.addEventListener("pagehide", onHide);
    return () => { window.removeEventListener("pagehide", onHide); onHide(); };
  }, [closeLocal]);

  // Session clock.
  useEffect(() => {
    if (status !== "active") { setElapsed(0); return undefined; }
    const timer = setInterval(() => setElapsed((Date.now() - refs.current.connectedAt) / 1000), 1000);
    return () => clearInterval(timer);
  }, [status]);

  // Alt+L toggles the panel (plain Alt only: AltGr+L types a character on the Romanian layout).
  useEffect(() => {
    const onKey = (e) => { if (isAppShortcut(e, "l")) { e.preventDefault(); setOpen((o) => !o); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toggleMic = () => {
    const tracks = refs.current.mic?.getAudioTracks() || [];
    const next = !micMuted;
    tracks.forEach((t) => { t.enabled = !next; });
    setMicMuted(next);
  };
  const toggleLegaSound = () => {
    const next = !legaMuted;
    if (refs.current.audio) refs.current.audio.muted = next;
    legaLevels.muted = next;
    setLegaMuted(next);
  };

  // The stage (full-screen view) reads the status and sends start/stop without owning the session.
  useEffect(() => { setState({ legaStatus: status }); }, [status]);
  // M08: the cockpit sends this id with a plan request, so the Hub can arm the short voice window for THIS Lega session.
  useEffect(() => { setState({ legaSessionId: status !== "off" ? session?.id || null : null }); }, [status, session?.id]);
  useEffect(() => {
    const onCommand = (e) => {
      if (e.detail === "start") {
        const opts = { expectWebSearch: legaStartOptions.expectWebSearch };
        legaStartOptions.expectWebSearch = null; // read once
        if (statusRef.current === "off") start(opts);
      } else if (e.detail === "stop") stop("user"); else if (e.detail === "open") setOpen(true);
    };
    window.addEventListener("lega:command", onCommand);
    return () => window.removeEventListener("lega:command", onCommand);
  }, [start, stop]);

  const running = status === "active" || status === "connecting" || status === "preparing";
  return (
    <>
      <button className={`btn sm lega-btn ${running ? "on" : ""}`} data-lega-target="lega-button" onClick={() => setOpen((o) => !o)} aria-expanded={open} {...(open ? { "aria-controls": "lega-panel" } : {})} title="Lega — asistentul vocal (Alt+L)">
        <AudioLines size={15} aria-hidden="true" />
        <span className="hide-mobile">Lega</span>
        {status === "active" && <span className="mono lega-clock">{fmtClock(elapsed)}</span>}
        {(status === "connecting" || status === "preparing") && <span className="faint small">…</span>}
        {legaProposals.length > 0 && <span className="badge" aria-label={`${legaProposals.length} propuneri Lega`}>{legaProposals.length}</span>}
      </button>
      {(running || status === "stopping") && <button className="btn sm danger lega-stop" disabled={status === "stopping"} onClick={() => stop("user")} aria-label={status === "preparing" ? "Anulează pornirea Lega" : "Oprește Lega"}><Square size={12} /><span className="hide-mobile">{status === "preparing" ? "Anulează" : "Oprește Lega"}</span></button>}
      <audio ref={(el) => { refs.current.audio = el; }} autoPlay hidden />
      <span className="sr-only" role="status" aria-live="polite">{announce}</span>
      {open && (
        <section id="lega-panel" className="lega-panel" role="region" aria-label="Lega">
          <div className="row between">
            <div className="row"><AudioLines size={16} aria-hidden="true" /><strong>Lega</strong>
              <Chip tone={status === "active" ? "ok" : running ? "info" : "neutral"}>{status === "active" ? "activă" : status === "preparing" && startNote ? "verifică contul" : status === "connecting" || status === "preparing" ? "se conectează" : status === "stopping" ? "se oprește" : "oprită"}</Chip></div>
            <div className="row">
              <button className="btn sm ghost" onClick={() => setState({ stageOpen: true })} title="Ecran complet (Alt+J)"><Maximize2 size={13} />Ecran complet</button>
              <button className="btn sm icon ghost" onClick={() => setOpen(false)} aria-label="Închide panoul Lega"><X size={14} /></button>
            </div>
          </div>
          {pointHint && (
            <Notice tone="info" title={pointHint.kind === "prefill" ? "Lega a pregătit valorile unui grant" : `Lega îți poate arăta: ${pointHint.label}`}>
              {presentedPlan() ? "Planul de pe ecran rămâne așa cum e; deschizi locul doar când vrei." : "Ești în cockpit; deschizi locul doar când vrei."}
              <div className="row wrap" style={{ marginTop: 6 }}>
                <button className="btn sm" onClick={() => {
                  const h = pointHint; setPointHint(null);
                  go(h.path);
                  if (h.kind === "prefill") offerGrantPrefill(h.form);
                  pointAt(h.target, h.label);
                }}>Deschide</button>
                <button className="btn sm ghost" onClick={() => setPointHint(null)}>Rămân aici</button>
              </div>
            </Notice>
          )}
          {legaProposals.map((a) => <ProposalCard key={a.id} approval={a} voiceFirst={voiceFirst} onDone={() => { proposals.reload(); approvedLega.reload(); }} />)}
          {running ? (
            <ActiveView status={status} elapsed={elapsed} session={session} micMuted={micMuted} legaMuted={legaMuted} onMic={toggleMic} onSound={toggleLegaSound}
              onStop={() => stop("user")} micBar={micBar} legaBar={legaBar} lines={lines} gateInfo={gateInfo} gateLog={gateLog} startNote={status === "preparing" ? startNote : null} />
          ) : (
            <ReadyView onStart={() => start()} disabled={status !== "off"} />
          )}
          <ErrorNotice error={error} />
          <p className="faint small" style={{ margin: 0 }}>Vocea merge direct la OpenAI (GPT-Live), nu e locală. Hub-ul păstrează doar textul. Lega nu aprobă nimic: acțiunile cu efecte se confirmă prin click.</p>
        </section>
      )}
    </>
  );
}

function ActiveView({ status, elapsed, session, micMuted, legaMuted, onMic, onSound, onStop, micBar, legaBar, lines, gateInfo, gateLog = [], startNote = null }) {
  const listRef = useRef(null);
  useEffect(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; }, [lines]);
  const cost = (elapsed / 60) * 0.05;
  return (
    <div className="stack tight">
      <div className="row wrap lega-meters">
        <span className="lega-meter" title="Nivelul microfonului"><Mic size={12} aria-hidden="true" /><i><b ref={micBar} /></i></span>
        <span className="lega-meter" title="Nivelul vocii Lega"><AudioLines size={12} aria-hidden="true" /><i><b ref={legaBar} /></i></span>
        <span className="mono small">{fmtClock(elapsed)}{session?.maxDurationS ? ` / ${fmtClock(session.maxDurationS)}` : ""}</span>
        <span className="faint small" title="Estimare după prețul publicat pentru vocea din desktop (0,05 $/min din bugetul Codex); consumul real din plan nu e raportat (UNKNOWN)">≈ {cost.toFixed(2)} $ estimat · consum real: necunoscut</span>
      </div>
      <div className="row wrap">
        <button className="btn sm" onClick={onMic} aria-pressed={micMuted}>{micMuted ? <MicOff size={14} /> : <Mic size={14} />}Microfon oprit</button>
        <button className="btn sm" onClick={onSound} aria-pressed={legaMuted}>{legaMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}Sunet Lega oprit</button>
        <button className="btn sm danger" onClick={onStop}><Square size={12} />Oprește Lega</button>
      </div>
      {/* D23: the start request is in flight and the Hub is checking the Codex account by itself (no inference) before admitting it. */}
      {status !== "active" && (startNote
        ? <Notice tone="info" title={startNote}>Hub-ul verifică singur contul Codex (câteva secunde, fără inferență), apoi pornește sesiunea vocală. Nu ai nimic de făcut.</Notice>
        : <Notice tone="info" title="Se conectează">Aștept confirmarea sesiunii vocale (nu este progres măsurat).</Notice>)}
      {gateInfo && (gateInfo.enabled
        ? <p className="small" style={{ margin: 0 }}><ShieldCheck size={12} aria-hidden="true" /> Filtru vocal local strict: fiecare propoziție e reținută până când Hub-ul o recunoaște ca a ta, apoi trimisă (întârziere = durata propoziției + ~1 s) · verificator {gateInfo.verifier} (local; nu autorizează nimic singur)
            {gateLog.length > 0 && gateLog[gateLog.length - 1].result !== "MATCH" && <span> · <strong>ultima propoziție nu a trecut:</strong> {gateLog[gateLog.length - 1].reason}</span>}{gateLog.length > 0 && <span className="faint"> · ultimele decizii: {gateLog.map((d) => d.result === "MATCH" ? "trimis" : d.result === "INSUFFICIENT_AUDIO" ? "prea scurt" : d.result === "NON_MATCH" ? "altă voce, aruncat" : "incert, aruncat").join(", ")}</span>}</p>
        : <p className="faint small" style={{ margin: 0 }}>Fără filtru vocal local: tot ce aude microfonul ajunge la OpenAI. Îl activezi din Lega → Configurare; are efect imediat.</p>)}
      <ol className="lega-lines" ref={listRef} aria-label="Transcriere">
        {lines.length === 0 && <li className="faint small">Spune ceva, de exemplu „Lega, ce se întâmplă?” sau „Lega, oprește tot”.</li>}
        {lines.map((l) => (
          <li key={l.id} className={`lega-line ${l.role} ${l.final ? "" : "partial"}`} aria-hidden={l.final ? undefined : true}>
            <span className="who">{l.role === "user" ? "Tu" : l.role === "assistant" ? "Lega" : "Hub"}:</span> {l.text}
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * A run Lega prepared, shown EXACTLY as approved (the full stored task, never a truncated view). Nothing starts until this
 * click; the execution gate still decides after it. Resumable: an approved proposal is only executed on the next click.
 */
function ProposalCard({ approval, onDone, voiceFirst = false }) {
  const p = approval.payload || {};
  const projectList = useResource("/api/projects", { reloadOn: (e) => e.type.startsWith("project.") });
  const projectLabel = (id) => (projectList.data?.projects || []).find((x) => x.id === id)?.name || id;
  const expired = new Date(approval.expiresAt) <= new Date();
  const run = useAction(async () => {
    if (approval.status === "pending") await api(`/api/approvals/${approval.id}/decide`, { method: "POST", body: { decision: "approved", displayedHash: approval.payloadHash } });
    try { await api(`/api/commands/${approval.scopeId}/execute`, { method: "POST", body: {} }); }
    catch (error) { pushToast(`lega-start-${approval.id}`, "error", `Aprobată, dar nu a pornit: ${error.message}. Rămâne în panoul Lega și în Aprobări.`); throw error; }
    onDone(); refresh();
  });
  const reject = useAction(async () => {
    await api(`/api/approvals/${approval.id}/decide`, { method: "POST", body: { decision: "rejected", displayedHash: approval.payloadHash, note: "Refuzat din panoul Lega" } });
    onDone(); refresh();
  });
  const mission = approval.actionKind === "lega.mission_request";
  return (
    <div className="lega-proposal" role="alert">
      <div className="row between"><strong>{mission ? "Lega propune o misiune" : "Lega propune o execuție"}</strong><Chip tone="approval">{expired ? "expirată" : approval.status === "approved" ? "aprobată, nepornită" : "așteaptă click-ul tău"}</Chip></div>
      {/* M10.2 (U15): this card belongs to the legacy policy (an approval click, then a grant per run). Under voice-first Lega no
          longer creates it; one still pending from before is shown as what it is, and stays decidable (refusing it is one click). */}
      {voiceFirst && <p className="faint small" style={{ margin: 0 }}>Propunere pe calea veche (aprobare prin click, apoi grant pe execuție). Sub voice-first, munca reală e un plan: spune-mi din nou cererea și îți arăt planul, confirmat o singură dată.</p>}
      {mission ? (
        <>
          <dl className="kv small">
            <dt>Misiune</dt><dd><strong>{p.title}</strong> · {p.kind}</dd>
            <dt>Proiect</dt><dd className="mono">{projectLabel(p.projectId)}</dd>
          </dl>
          <pre className="pre" style={{ maxHeight: 150 }}>{p.objective}</pre>
          {p.acceptance?.length > 0 && <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{p.acceptance.map((a, i) => <li key={i}>{a}</li>)}</ul>}
          <p className="faint small" style={{ margin: 0 }}>Se creează ca ciornă: nicio execuție nu pornește din ea fără pașii tăi.</p>
        </>
      ) : (
        <>
          <dl className="kv small">
            <dt>Agent</dt><dd>{p.provider === "claude" ? "Claude Code" : "Codex"} · {p.access === "workspace-write" ? <strong>scriere în workspace</strong> : "doar citire"}</dd>
            <dt>Proiect</dt><dd className="mono">{projectLabel(p.projectId)}</dd>
          </dl>
          <pre className="pre" style={{ maxHeight: 180 }}>{p.task}</pre>
        </>
      )}
      <div className="row">
        <button className="btn sm primary" disabled={expired || run.pending || reject.pending} onClick={run.run}><Check size={14} />{approval.status === "approved" ? (mission ? "Creează acum" : "Pornește acum") : mission ? "Aprobă și creează" : "Aprobă și pornește"}</button>
        {approval.status === "pending" && <button className="btn sm ghost" disabled={expired || run.pending || reject.pending} onClick={reject.run}><Ban size={14} />Refuză</button>}
      </div>
      <ErrorNotice error={run.error || reject.error} />
    </div>
  );
}

/**
 * M07 §15: a sentence the gate let through while a plan waited. The Hub transcribes it locally (a second or two); if it reads
 * like a confirmation, the cockpit's intent route gets the SEGMENT (never text): the Hub resolves it as the owner's local
 * voice and confirms only that plan, only in this session. Anything else stays a conversation with Lega.
 */
async function followSpokenConfirmation(decision) {
  const started = Date.now();
  let row = null;
  // The local transcript usually takes about a second; a cold engine can take much longer (bounded by its own timeout).
  while (Date.now() - started < 50000) {
    try { row = await api(`/api/voice/utterances/${decision.utteranceId}`); } catch { return; }
    if (row.transcriptStatus !== "pending") break;
    await new Promise((r) => setTimeout(r, 400));
  }
  if (row?.transcriptStatus === "pending") { pushToast(`env-voice-${decision.envelopeId}`, "warn", "Transcrierea locală întârzie; confirmă cu butonul sau repetă."); return; }
  if (row?.transcriptStatus !== "final" || !looksLikeConfirmation(row.transcript)) return;
  const plan = presentedPlan();
  if (!plan || plan.envelopeId !== decision.envelopeId) return;
  // An ARMED plan is confirmed by the Hub itself from the same server-held segment; here we only report what happened.
  if (isArmed(plan.envelopeId)) {
    for (let i = 0; i < 25; i += 1) {
      let env = null;
      try { env = await planStatusOf(plan.envelopeId); } catch { return; }
      if (env.status !== "PROPOSED") {
        if (env.modality === "voice") pushToast(`env-${plan.envelopeId}`, "ok", "Confirmat prin voce (verificată și transcrisă local): misiunea a pornit");
        else pushToast(`env-voice-${plan.envelopeId}`, "info", `Planul e acum: ${env.status}`);
        return;
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    pushToast(`env-voice-${plan.envelopeId}`, "warn", `Am auzit „${row.transcript}”, dar planul nu s-a confirmat; folosește butonul sau repetă „Da, execută planul”.`);
    return;
  }
  try {
    const out = await api("/api/owner/intent", { method: "POST", body: { utteranceId: decision.utteranceId, projectId: plan.projectId || undefined, presented: { envelopeId: plan.envelopeId, nonce: plan.nonce, hash: plan.hash } } });
    const confirmed = (out?.results || []).find((r) => r.confirmed);
    const refused = (out?.results || []).find((r) => r.refused || r.error);
    if (confirmed) pushToast(`env-${plan.envelopeId}`, "ok", "Confirmat prin voce (verificată și transcrisă local): misiunea a pornit");
    else pushToast(`env-voice-${plan.envelopeId}`, "warn", refused?.refused || refused?.error?.message || `Am auzit „${row.transcript}”, nu o confirmare clară; nimic nu a pornit`);
  } catch (e) { pushToast(`env-voice-${plan.envelopeId}`, "warn", e.message); }
}

/** M10.2 U13: the plan's current status, envelope or operation plan (read-only GET). */
const planStatusOf = async (id) => {
  const p = await api(/^opp_/.test(String(id)) ? `/api/ops/plans/${id}` : `/api/envelopes/${id}`);
  return { status: p.status, modality: p.consent?.modality || null };
};

/**
 * M10.2 U13: the Hub bound this sentence to the plan it armed and confirms it itself from the server-held segment (no card needed,
 * no second path from the page): here we only wait for the result and report it.
 */
async function observeArmedConfirmation(decision) {
  const id = decision.boundPlanId;
  for (let i = 0; i < 120; i += 1) {
    let p = null;
    try { p = await planStatusOf(id); } catch { return; }
    if (p.status !== "PROPOSED") {
      if (p.modality === "voice") pushToast(`plan-${id}`, "ok", "Confirmat prin voce (verificată și transcrisă local): planul a pornit");
      else pushToast(`plan-voice-${id}`, "info", `Planul e acum: ${p.status}`);
      return;
    }
    // The window closed without a confirmation (a "nu", three unclear answers, the time): nothing started; the button stays.
    if (i > 10 && !isArmed(id)) return;
    await new Promise((r) => setTimeout(r, 500));
  }
}

/** Before a session: what is missing (gate checks), the consent form and the voice choice. */
function ReadyView({ onStart, disabled }) {
  const status = useResource("/api/lega", { reloadOn: (e) => e.type.startsWith("grant.") || e.type === "settings.changed" || e.type.startsWith("lega.") || e.type.startsWith("provider.") || e.type.startsWith("owner.") });
  // Only a panel the owner can see records what they saw (the full-screen stage covers it).
  const stageOpen = useHub((s) => Boolean(s.stageOpen));
  useEffect(() => { if (status.data?.settings && !stageOpen) shownWebSearch = status.data.settings.webSearch || "disabled"; }, [status.data, stageOpen]);
  // 2.12.1 (UI-05 / UI-06): the rearm card only for a suspension it can reopen (never the owner's own pause: that is „Continuă”), and
  // only with an enrolled authenticator (without one the card cannot work: the setup step instead).
  const executionGate = useHub((s) => s.hub?.executionGate || null);
  const ownerStatus = useResource("/api/owner/status", { reloadOn: (e) => e.type.startsWith("owner.") });
  const rearmOffer = rearmOfferFor({ gate: executionGate, bootstrapNeeded: Boolean(ownerStatus.data?.bootstrapNeeded) });
  const [text, setText] = useState("");
  const consent = useAction(async () => { await api("/api/lega/consent", { method: "POST", body: { confirmText: text } }); setText(""); status.reload(); });
  const saveVoice = useAction(async (voice) => { await api("/api/settings", { method: "PATCH", body: { lega: { voice } } }); status.reload(); });
  const saveWeb = useAction(async (webSearch) => { await api("/api/settings", { method: "PATCH", body: { lega: { webSearch } } }); status.reload(); });
  if (status.loading) return <p className="faint small">Verific dacă Lega poate porni…</p>;
  if (status.error) return <ErrorNotice error={status.error} onRetry={status.reload} />;
  const d = status.data;
  const rd = legaStartReadiness(d);
  const failed = rd.blocking;
  const minutes = d.preview?.maxDurationS ? Math.max(1, Math.floor(d.preview.maxDurationS / 60)) : d.settings.maxSessionMinutes;
  const last = d.session && d.session.status === "ended" ? d.session : null;
  return (
    <div className="stack tight">
      {last && last.endReason && last.endReason !== "user" && (
        <Notice tone={last.lastError ? "warn" : "info"} title={`Ultima sesiune s-a oprit: ${last.endReason}`}>
          {last.endDetail && <div className="small">Ce a spus providerul: {last.endDetail}</div>}
          {last.attempt && <div className="small">Încercarea din grant (contor Hub): {last.attempt.refunded ? "restituită" : "folosită"} — {last.attempt.rule}</div>}
          {last.activity && <div className="faint small">Activitate: {last.activity.transcripts} transcrieri, {last.activity.turns} turnuri, {last.activity.toolCalls} unelte. Consumul real din plan: necunoscut.</div>}
        </Notice>
      )}
      {!d.consent.recorded && (
        <div className="stack tight">
          <strong className="small">Acord pentru Lega (o singură dată)</strong>
          <pre className="pre" style={{ maxHeight: 120 }}>{d.consentText}</pre>
          <textarea className="textarea" rows={3} value={text} onChange={(e) => setText(e.target.value)} aria-label="Textul acordului pentru Lega" />
          <button className="btn sm" disabled={text !== d.consentText || consent.pending} onClick={consent.run}><ShieldCheck size={14} />Înregistrează acordul</button>
          <ErrorNotice error={consent.error} />
        </div>
      )}
      <label className="field"><span>Vocea Lega</span>
        <select className="select" value={d.settings.voice} onChange={(e) => saveVoice.run(e.target.value)}>{d.voices.map((v) => <option key={v} value={v}>{v}</option>)}</select>
      </label>
      <label className="field"><span><Globe size={13} aria-hidden="true" /> Căutare pe internet</span>
        <select className="select" value={d.settings.webSearch || "disabled"} disabled={saveWeb.pending} onChange={(e) => saveWeb.run(e.target.value)}>
          <option value="cached">Pornită: indexul OpenAI (recomandat)</option><option value="indexed">Pornită: căutare actuală, pagini doar din index</option>
          <option value="live">Pornită: orice pagină, live (risc mai mare)</option><option value="disabled">Oprită</option>
        </select>
      </label>
      {d.settings.webSearch === "live" && <Notice tone="warn" title="Căutare live">Lega poate deschide orice pagină. O pagină sau o notiță de proiect cu instrucțiuni ascunse l-ar putea face să trimită text din Hub spre acea pagină. Nimic nu se execută fără click-ul tău, dar pentru lucru zilnic alege indexul OpenAI.</Notice>}
      <p className="faint small" style={{ margin: 0 }}>Se aplică la următoarea pornire. Căutările apar în transcriere; ce vine de pe internet e tratat ca informație, nu ca instrucțiuni.</p>
      <ErrorNotice error={saveVoice.error || saveWeb.error} />
      {rd.needsPolicy ? (
        <Notice tone="warn" title="Lega nu poate porni încă">Politica voice-first nu e activă: o activezi o dată în Lega → Configurare. (Varianta veche, fără sesiune: LIVE_VALIDATION și un grant „Lega (voce)” în Integrări → Validare live.)</Notice>
      ) : failed.length > 0 ? (
        <>
          <Notice tone="warn" title="Lega nu poate porni încă">
            <Checks checks={failed} />
            <ul className="plain small">{failed.filter((c) => legaCheckHint(c.id, { voiceFirst: rd.policyActive })).map((c) => <li key={c.id}>{legaCheckHint(c.id, { voiceFirst: rd.policyActive })}</li>)}</ul>
            {/* D23: the stale account check is not among the blockers above — the Hub runs it itself once the rest is solved. */}
            {rd.auto.length > 0 && <p className="faint small" style={{ margin: 0 }}>{LEGA_ACCOUNT_AUTO_HINT}</p>}
          </Notice>
          {/* M10.2.1 (D14): a stopped gate is reopened right here, by the rearm card (owner session + a fresh Windows Hello); the Hub decides.
              2.12.1 (UI-05 / UI-06): only for a suspension the card can reopen, and only with an authenticator to confirm it. */}
          {rd.gateSuspended && rearmOffer === "card" && <RearmCard compact onDone={(res) => { pushToast("gate-rearm", "ok", rearmOutcome(res).toast); status.reload(); refresh(); }} />}
          {rd.gateSuspended && rearmOffer === "setup" && (
            <Notice tone="info" title="Întâi autentificatorul">{REARM_SETUP.text} <a className="btn sm" href={REARM_SETUP.href}>Deschide {REARM_SETUP.label}</a></Notice>
          )}
        </>
      ) : rd.needsSession ? (
        <Notice tone="info" title="Pornește din sesiunea ta">{rd.sessionProblem && <span className="small">{rd.sessionProblem}. </span>}Apasă „Pornește Lega”: confirmi o dată cu Windows Hello / cheia ta și Lega pornește. Hub-ul își face singur autorizarea pentru o singură sesiune (cel mult {Math.min(30, d.settings.maxSessionMinutes)} min, doar citire) și o revocă la final; modul Hub-ului nu se schimbă.{rd.auto.length > 0 ? ` ${LEGA_ACCOUNT_AUTO_HINT}` : ""}</Notice>
      ) : <Notice tone="info" title="Gata de pornire">Sesiune de maxim {minutes} min; se oprește singură după {d.settings.idleTimeoutS} s de liniște (nu cât timp agentul lucrează).{rd.derived ? " Autorizarea se derivă din sesiunea ta și se revocă la final." : ""}{rd.auto.length > 0 ? ` ${LEGA_ACCOUNT_AUTO_HINT}` : ""}</Notice>}
      <button className="btn primary" disabled={disabled || failed.length > 0 || rd.needsPolicy} onClick={async () => { await Promise.resolve(status.reload?.()); onStart(); }}><Mic size={15} />Pornește Lega</button>
    </div>
  );
}
