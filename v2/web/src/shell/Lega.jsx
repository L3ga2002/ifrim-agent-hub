import { useCallback, useEffect, useRef, useState } from "react";
import { AudioLines, Mic, MicOff, Square, X, Check, Ban, ShieldCheck, Volume2, VolumeX, Maximize2, Globe } from "lucide-react";
import { api, ensureToken } from "../api.js";
import { useHub, setState, onLive, pushToast, useResource, useAction, refresh } from "../store.js";
import { Chip, Notice, Checks, ErrorNotice } from "../components/ui.jsx";
import { legaLevels } from "../lib/legaLevels.js";
import { offerGrantPrefill, pointAt } from "../lib/legaBridge.js";
import { isAppShortcut, approvedNotStarted } from "../lib/uiLogic.js";

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
  const refs = useRef({ pc: null, mic: null, audio: null, sessionId: null, pendingId: null, posting: false, seq: 0, meters: [], connectedAt: 0, lossTimer: null, bootId: null, openLine: {} });
  const micBar = useRef(null); const legaBar = useRef(null);
  const connection = useHub((s) => s.connection);
  const hubLega = useHub((s) => s.hub?.lega);
  const bootId = useHub((s) => s.hub?.bootId);
  const serverTime = useHub((s) => s.hub?.serverTime);
  const statusRef = useRef(status); statusRef.current = status;

  const setPhase = (legaPhase) => setState({ legaPhase });
  const toOff = () => { setStatus("off"); setPhase("off"); };

  const closeLocal = useCallback(() => {
    const r = refs.current;
    r.meters.forEach((off) => off()); r.meters = [];
    try { r.pc?.getSenders().forEach((s) => s.track?.stop()); r.pc?.close(); } catch { /* closed */ }
    r.mic?.getTracks().forEach((t) => t.stop());
    if (r.audio) { r.audio.srcObject = null; r.audio.muted = false; }
    r.pc = null; r.mic = null; r.openLine = {};
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

  const start = useCallback(async () => {
    const r = refs.current;
    if (statusRef.current !== "off") return;
    const seq = ++r.seq;
    const alive = () => r.seq === seq;
    setError(null); setLines([]); setMicMuted(false); setLegaMuted(false); setStatus("preparing"); setPhase("connecting");
    r.bootId = bootId || null; r.openLine = {};
    let mic = null; let pc = null;
    const dispose = () => { mic?.getTracks().forEach((t) => t.stop()); try { pc?.close(); } catch { /* closed */ } };
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) throw new Error("Browserul nu permite microfon + WebRTC aici");
      try { mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
      catch (e) { throw micError(e); }
      if (!alive()) return dispose();
      pc = new RTCPeerConnection(); // no STUN/TURN, like the official Codex voice helper
      mic.getTracks().forEach((t) => pc.addTrack(t, mic));
      const dc = pc.createDataChannel("oai-events"); // required by the offer; the app-server sideband controls the session
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
      try { body = await api("/api/lega/sessions", { method: "POST", body: { sdp: pc.localDescription.sdp } }); }
      finally { r.posting = false; }
      const result = body?.result || body;
      if (!alive()) { dispose(); await stopRequest(result.sessionId, "cancelled-during-start"); return; }
      await pc.setRemoteDescription({ type: "answer", sdp: result.answerSdp });
      if (!alive()) { dispose(); await stopRequest(result.sessionId, "cancelled-during-start"); return; }
      // The attempt is committed: from here the refs own the microphone and the peer.
      r.mic = mic; r.pc = pc; r.sessionId = result.sessionId; r.pendingId = null; r.committedAt = Date.now();
      r.meters.push(attachMeter(mic, micBar, "mic"));
      setSession({ id: result.sessionId, maxDurationS: result.maxDurationS, voice: result.voice });
      setStatus("connecting");
      let reported = false;
      const onConnected = async () => {
        if (reported || !alive()) return;
        reported = true;
        const sid = r.sessionId;
        try {
          const res = await api(`/api/lega/sessions/${sid}/connected`, { method: "POST", body: {} });
          const view = res?.result ?? res;
          if (!alive() || r.sessionId !== sid || r.pc !== pc) return;
          if (view?.status !== "active") { await stop("not-active-after-connect"); return; }
          r.connectedAt = Date.now();
          setStatus("active"); setPhase("listening");
        } catch (e) {
          if (alive()) { setError(e); await stop("connect-report-failed"); }
        }
      };
      dc.onopen = onConnected;
      pc.onconnectionstatechange = () => {
        if (!alive()) return;
        if (pc.connectionState === "connected") onConnected();
        if (["failed", "closed"].includes(pc.connectionState) && r.sessionId) stop(`peer-${pc.connectionState}`);
      };
    } catch (e) {
      dispose();
      if (!alive()) return;
      setError(e);
      await stop("start-failed");
    }
  }, [stop, bootId]);

  // Pending Lega proposals are approvals: they survive the session, a reload and an SSE drop.
  const proposals = useResource("/api/approvals?status=pending", { reloadOn: (e) => e.type.startsWith("approval.") || e.type.startsWith("command.") || e.type === "lega.proposal" });
  const isLegaKind = (a) => a.actionKind === "lega.run_request" || a.actionKind === "lega.mission_request";
  // Approved elsewhere (e.g. the Approvals screen) but never started: kept here with "Pornește acum" until they expire.
  const approvedLega = useResource("/api/approvals?status=approved", { reloadOn: (e) => e.type.startsWith("approval.") || e.type.startsWith("command.") });
  const legaProposals = [...(proposals.data?.approvals || []).filter(isLegaKind), ...approvedNotStarted(approvedLega.data?.approvals || []).filter(isLegaKind)];
  const reloadProposals = useRef(proposals.reload); reloadProposals.current = proposals.reload;

  // Live events from the Hub, for THIS tab's session only.
  useEffect(() => onLive((e) => {
    const r = refs.current;
    if (!e?.type?.startsWith("lega.")) return;
    const sid = e.sessionId || e.session?.id || null;
    // While this tab's start POST is running, the session announced as "starting" is ours (the Hub admits one at a time).
    if (!r.sessionId && r.posting && e.type === "lega.session" && e.session?.status === "starting") { r.pendingId = e.session.id; return; }
    const mine = r.sessionId ? sid === r.sessionId : (r.pendingId && sid === r.pendingId);
    if (!mine) { if (e.type === "lega.proposal") reloadProposals.current(); return; }
    if (e.type === "lega.session.stopping") { closeLocal(); setStatus("stopping"); }
    else if (e.type === "lega.session" && e.session?.status === "ended") {
      closeLocal(); r.sessionId = null; r.pendingId = null; toOff();
      if (e.session.endReason && e.session.endReason !== "user") pushToast(`lega-${e.session.id}`, "info", `Lega s-a oprit: ${e.session.endReason}`);
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
    // "Arată-mi unde…": open the screen, then the arrow finds the marked element once it is rendered.
    else if (e.type === "lega.point" && e.target) { if (e.path) go(e.path); pointAt(e.target, e.label); setAnnounce(`Lega arată: ${e.label || e.target}`); }
    // The grant form is only filled in; creating the grant stays the owner's click on "Creează grant".
    else if (e.type === "lega.prefill" && e.form) {
      go(e.path || "/integrations"); offerGrantPrefill(e.form); pointAt(e.target || "grant-create", e.label);
      setAnnounce("Lega a completat formularul de grant: verifică valorile și apasă tu Creează grant.");
    }
    else if (e.type === "lega.web") setLines((ls) => [...ls.slice(-60), { id: `w-${Date.now()}-${ls.length}`, role: "system", text: `Caut pe internet${e.text ? `: „${e.text}”` : "…"}`, final: true }]);
    else if (e.type === "lega.silence") { if (r.audio) r.audio.muted = true; setLegaMuted(true); }
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
    setLegaMuted(next);
  };

  // The stage (full-screen view) reads the status and sends start/stop without owning the session.
  useEffect(() => { setState({ legaStatus: status }); }, [status]);
  useEffect(() => {
    const onCommand = (e) => { if (e.detail === "start") { if (statusRef.current === "off") start(); } else if (e.detail === "stop") stop("user"); else if (e.detail === "open") setOpen(true); };
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
              <Chip tone={status === "active" ? "ok" : running ? "info" : "neutral"}>{status === "active" ? "activă" : status === "connecting" || status === "preparing" ? "se conectează" : status === "stopping" ? "se oprește" : "oprită"}</Chip></div>
            <div className="row">
              <button className="btn sm ghost" onClick={() => setState({ stageOpen: true })} title="Ecran complet (Alt+J)"><Maximize2 size={13} />Ecran complet</button>
              <button className="btn sm icon ghost" onClick={() => setOpen(false)} aria-label="Închide panoul Lega"><X size={14} /></button>
            </div>
          </div>
          {legaProposals.map((a) => <ProposalCard key={a.id} approval={a} onDone={() => { proposals.reload(); approvedLega.reload(); }} />)}
          {running ? (
            <ActiveView status={status} elapsed={elapsed} session={session} micMuted={micMuted} legaMuted={legaMuted} onMic={toggleMic} onSound={toggleLegaSound}
              onStop={() => stop("user")} micBar={micBar} legaBar={legaBar} lines={lines} />
          ) : (
            <ReadyView onStart={start} disabled={status !== "off"} />
          )}
          <ErrorNotice error={error} />
          <p className="faint small" style={{ margin: 0 }}>Vocea merge direct la OpenAI (GPT-Live), nu e locală. Hub-ul păstrează doar textul. Lega nu aprobă nimic: acțiunile cu efecte se confirmă prin click.</p>
        </section>
      )}
    </>
  );
}

function ActiveView({ status, elapsed, session, micMuted, legaMuted, onMic, onSound, onStop, micBar, legaBar, lines }) {
  const listRef = useRef(null);
  useEffect(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; }, [lines]);
  const cost = (elapsed / 60) * 0.05;
  return (
    <div className="stack tight">
      <div className="row wrap lega-meters">
        <span className="lega-meter" title="Nivelul microfonului"><Mic size={12} aria-hidden="true" /><i><b ref={micBar} /></i></span>
        <span className="lega-meter" title="Nivelul vocii Lega"><AudioLines size={12} aria-hidden="true" /><i><b ref={legaBar} /></i></span>
        <span className="mono small">{fmtClock(elapsed)}{session?.maxDurationS ? ` / ${fmtClock(session.maxDurationS)}` : ""}</span>
        <span className="faint small" title="Estimare după prețul publicat pentru vocea din desktop (0,05 $/min din bugetul Codex)">≈ {cost.toFixed(2)} $ din plan</span>
      </div>
      <div className="row wrap">
        <button className="btn sm" onClick={onMic} aria-pressed={micMuted}>{micMuted ? <MicOff size={14} /> : <Mic size={14} />}Microfon oprit</button>
        <button className="btn sm" onClick={onSound} aria-pressed={legaMuted}>{legaMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}Sunet Lega oprit</button>
        <button className="btn sm danger" onClick={onStop}><Square size={12} />Oprește Lega</button>
      </div>
      {status !== "active" && <Notice tone="info" title="Se conectează">Aștept confirmarea sesiunii vocale (nu este progres măsurat).</Notice>}
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
function ProposalCard({ approval, onDone }) {
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

/** Before a session: what is missing (gate checks), the consent form and the voice choice. */
function ReadyView({ onStart, disabled }) {
  const status = useResource("/api/lega", { reloadOn: (e) => e.type.startsWith("grant.") || e.type === "settings.changed" || e.type.startsWith("lega.") || e.type.startsWith("provider.") });
  const [text, setText] = useState("");
  const consent = useAction(async () => { await api("/api/lega/consent", { method: "POST", body: { confirmText: text } }); setText(""); status.reload(); });
  const saveVoice = useAction(async (voice) => { await api("/api/settings", { method: "PATCH", body: { lega: { voice } } }); status.reload(); });
  const saveWeb = useAction(async (webSearch) => { await api("/api/settings", { method: "PATCH", body: { lega: { webSearch } } }); status.reload(); });
  if (status.loading) return <p className="faint small">Verific dacă Lega poate porni…</p>;
  if (status.error) return <ErrorNotice error={status.error} onRetry={status.reload} />;
  const d = status.data;
  const failed = d.preview.checks.filter((c) => !c.ok);
  return (
    <div className="stack tight">
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
      {failed.length > 0 ? (
        <Notice tone="warn" title="Lega nu poate porni încă">
          <Checks checks={failed} />
          <span className="small">Modul LIVE_VALIDATION, poarta și grantul „Lega (voce)” se setează în Integrări → Validare live.</span>
        </Notice>
      ) : <Notice tone="info" title="Gata de pornire">Sesiune de maxim {d.settings.maxSessionMinutes} min; se oprește singură după {d.settings.idleTimeoutS} s de liniște (nu cât timp agentul lucrează).</Notice>}
      <button className="btn primary" disabled={disabled || failed.length > 0} onClick={async () => { await Promise.resolve(status.reload?.()); onStart(); }}><Mic size={15} />Pornește Lega</button>
    </div>
  );
}
