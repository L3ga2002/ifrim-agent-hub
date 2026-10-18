import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, X, Send, Volume2, VolumeX, AlertTriangle } from "lucide-react";
import { api } from "../api.js";
import { useHub, setState, getState, pushToast, useResource } from "../store.js";
import { parseLocalCommand } from "../lib/uiLogic.js";

// VoiceProvider (separate from any LLM provider). Push-to-talk only; the Hub never stores audio. Local voice
// processing started by the owner does not authorise sending text to Codex/Claude: a transcript becomes an
// editable draft or a deterministic local command.
const Recognition = typeof window !== "undefined" ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;

/** Reports locality honestly: a browser speech service may send audio online; only on-device recognition is "local". */
export async function detectSpeechEngine(lang = "ro-RO") {
  if (!Recognition) return { available: false, local: false, id: "none", label: "Recunoaștere vocală indisponibilă în acest browser" };
  if (typeof Recognition.available === "function") {
    try {
      const status = await Recognition.available({ langs: [lang], processLocally: true });
      if (status === "available") return { available: true, local: true, id: "browser-on-device", label: "Recunoaștere pe dispozitiv (locală, fără internet)" };
      if (status === "downloadable") return { available: true, local: false, id: "browser-online", downloadable: true, label: "Serviciul browserului (online); pachetul local pentru limbă poate fi descărcat din browser" };
    } catch { /* API shape differs; fall through */ }
  }
  return { available: true, local: false, id: "browser-online", label: "Serviciul de recunoaștere al browserului (trimite audio online)" };
}

/** Steps shown when strict local mode has no local engine (NEEDS_SETUP). */
export const LOCAL_STT_STEPS = [
  "Browser Chromium recent (Chrome/Edge) cu recunoaștere pe dispozitiv: descarcă pachetul de limbă română pentru recunoașterea vocală din setările browserului, apoi reîncarcă Hub-ul.",
  "Sau: un motor local separat (de ex. whisper.cpp cu model mic, licență MIT) — necesită aprobarea instalării (dimensiune, locație, licență) și nu este instalat.",
  "Alternativ, dezactivează „Mod local strict” în Setări → Voce ca să accepți explicit serviciul online al browserului (etichetat ca online).",
];

const looksUnsafeToSpeak = (text) => /```|\b(sk-|ghp_|xox[bp]-|eyJ[A-Za-z0-9_-]{10,})|[A-Za-z0-9+/=_-]{40,}/.test(text);

/** Speaks a short, existing summary only (never code, logs, tokens). Returns false when refused. */
export function speak(text, { voiceURI = "", lang = "ro-RO", rate = 1, volume = 1 } = {}) {
  if (!("speechSynthesis" in window) || !text) return false;
  if (looksUnsafeToSpeak(text)) return false;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(String(text).slice(0, 300));
  utterance.lang = lang; utterance.rate = rate; utterance.volume = volume;
  const voice = window.speechSynthesis.getVoices().find((v) => v.voiceURI === voiceURI);
  if (voice) utterance.voice = voice;
  window.speechSynthesis.speak(utterance);
  return true;
}

const ERRORS = { "not-allowed": "Permisiunea pentru microfon a fost refuzată (setările site-ului în browser).", "service-not-allowed": "Serviciul de recunoaștere nu este permis în acest browser.",
  "audio-capture": "Niciun microfon disponibil sau microfonul este folosit de altă aplicație.", network: "Serviciul online de recunoaștere nu răspunde.", "no-speech": "Nu s-a detectat vorbire.", aborted: "Oprit." };

function useLevel(stream) {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (!stream) { setLevel(0); return undefined; }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return undefined;
    const ctx = new Ctx(); const src = ctx.createMediaStreamSource(stream); const an = ctx.createAnalyser(); an.fftSize = 256; src.connect(an);
    const buf = new Uint8Array(an.frequencyBinCount); let raf = 0;
    const loop = () => { an.getByteTimeDomainData(buf); let peak = 0; for (const v of buf) peak = Math.max(peak, Math.abs(v - 128)); setLevel(peak / 128); raf = requestAnimationFrame(loop); };
    loop();
    return () => { cancelAnimationFrame(raf); src.disconnect(); ctx.close(); };
  }, [stream]);
  return level;
}

/**
 * Push-to-talk. Distinct visible states: LISTENING (mic open) → TRANSCRIBING → READY_TO_SEND (editable) →
 * EXECUTING (a local command runs) → done. The microphone is released after every stop.
 */
export function VoiceControl({ go, compact = false }) {
  const settings = useHub((s) => s.hub?.voiceSettings);
  const projects = useResource(settings?.enabled ? "/api/projects" : null);
  const enabled = settings?.enabled;
  const strictLocal = settings?.strictLocal !== false;
  const [phase, setPhase] = useState("idle"); // idle | listening | transcribing | ready | executing | done | error | setup
  const [transcript, setTranscript] = useState("");
  const [result, setResult] = useState(null);
  const [engine, setEngine] = useState(null);
  const [stream, setStream] = useState(null);
  const recRef = useRef(null);
  const streamRef = useRef(null);
  const level = useLevel(stream);

  const releaseMic = () => { streamRef.current?.getTracks().forEach((t) => t.stop()); streamRef.current = null; setStream(null); };
  useEffect(() => { if (enabled) detectSpeechEngine(settings?.language || "ro-RO").then(setEngine); }, [enabled, settings?.language]);
  useEffect(() => { setState({ voicePhase: phase === "listening" ? "listening" : phase === "transcribing" ? "transcribing" : "idle" }); }, [phase]);
  useEffect(() => () => { recRef.current?.abort?.(); releaseMic(); }, []);
  useEffect(() => {
    if (!navigator.mediaDevices?.addEventListener || !settings?.deviceId) return undefined;
    const onChange = async () => {
      const devices = await navigator.mediaDevices.enumerateDevices();
      if (!devices.some((d) => d.deviceId === settings.deviceId)) {
        recRef.current?.abort?.(); releaseMic();
        setResult({ kind: "error", reason: "Microfonul selectat a fost deconectat. Alege altul în Setări → Voce." }); setPhase("error");
      }
    };
    navigator.mediaDevices.addEventListener("devicechange", onChange);
    return () => navigator.mediaDevices.removeEventListener("devicechange", onChange);
  }, [settings?.deviceId]);

  if (!enabled) return null;
  const needsSetup = !engine?.available || (strictLocal && !engine.local);

  const start = async () => {
    if (needsSetup) { setPhase("setup"); return; }
    if (!Recognition || phase === "listening") return;
    // One L3ga screen (2026-10-18): one audio capture at a time — while Lega's voice session holds the microphone, this button does not open a second one.
    const lega = getState()?.legaStatus;
    if (lega && lega !== "off") { setResult({ kind: "error", reason: "Vocea Lega e pornită și folosește microfonul: vorbește direct cu Lega (o singură captură audio)." }); setPhase("error"); return; }
    window.speechSynthesis?.cancel(); // never capture our own playback
    const rec = new Recognition();
    rec.lang = settings?.language || "ro-RO";
    rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
    if (engine?.local && "processLocally" in rec) rec.processLocally = true;
    let finalText = "";
    rec.onresult = (event) => {
      setPhase("transcribing");
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        if (event.results[i].isFinal) finalText += event.results[i][0].transcript; else interim += event.results[i][0].transcript;
      }
      setTranscript((finalText + interim).trim());
    };
    rec.onerror = (event) => { releaseMic(); setResult({ kind: "error", reason: ERRORS[event.error] || `Microfon: ${event.error}` }); setPhase("error"); };
    rec.onend = () => { recRef.current = null; releaseMic(); setPhase((p) => (p === "listening" || p === "transcribing" ? "ready" : p)); };
    recRef.current = rec;
    setTranscript(""); setResult(null); setPhase("listening");
    try {
      if (settings?.deviceId && navigator.mediaDevices?.getUserMedia) {
        const s = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: settings.deviceId } } });
        streamRef.current = s; setStream(s);
        try { rec.start(s.getAudioTracks()[0]); } catch { rec.start(); }
      } else rec.start();
    } catch (error) { releaseMic(); setResult({ kind: "error", reason: error.name === "NotAllowedError" ? ERRORS["not-allowed"] : error.message }); setPhase("error"); }
  };
  const stop = () => recRef.current?.stop?.();
  const close = () => { recRef.current?.abort?.(); releaseMic(); setPhase("idle"); };

  const submit = async () => {
    const text = transcript.trim();
    if (!text) return;
    const local = parseLocalCommand(text, { projects: projects.data?.projects || [] });
    if (local?.kind === "navigate") { go(local.path); setResult({ kind: "command", command: local.command }); setPhase("done"); return; }
    if (local?.kind === "local" && local.command === "mute") { window.speechSynthesis?.cancel(); setResult({ kind: "command", command: "mute" }); setPhase("done"); return; }
    if (local?.kind === "refused" || local?.kind === "unknown") { setResult({ kind: "refused", reason: local.reason }); setPhase("ready"); return; }
    setPhase("executing");
    try {
      const parsed = await api("/api/voice/command", { method: "POST", body: { transcript: text } });
      setResult(parsed);
      if (parsed.kind === "command" && parsed.command === "show_approvals") go("/approvals");
      if (parsed.kind === "command" && parsed.command === "mute") window.speechSynthesis?.cancel();
      if (parsed.kind === "message") { sessionStorage.setItem("hub.v2.voiceDraft", text); go("/conversations"); }
      if (settings?.ttsEnabled && parsed.kind === "command") speak(parsed.command === "stop_all" ? "Am oprit lucrul nou și am întrerupt execuțiile." : parsed.command === "pause" ? "Poarta este suspendată." : "Gata.", { voiceURI: settings.voiceURI, rate: settings.rate, volume: settings.volume });
      setPhase(parsed.kind === "refused" ? "ready" : "done");
    } catch (error) { setResult({ kind: "error", reason: error.message }); setPhase("ready"); }
  };

  const busy = phase === "listening" || phase === "transcribing";
  const PHASE_LABEL = { listening: "Ascult (microfon activ)", transcribing: "Transcriu…", ready: "Gata de trimis — verifică textul", executing: "Execut comanda locală…", done: "Executat", error: "Eroare microfon", setup: "Voce: NEEDS_SETUP" };
  return (
    <>
      <button className={`btn sm ${busy ? "danger" : ""} ${needsSetup ? "setup" : ""}`} aria-pressed={busy}
        title={needsSetup ? "Voce: NEEDS_SETUP (motor local indisponibil)" : engine?.label || "Voce"}
        onPointerDown={(e) => { if (needsSetup) return; if (e.pointerType !== "mouse" || e.button === 0) start(); }}
        onPointerUp={stop} onPointerLeave={() => { if (phase === "listening") stop(); }}
        onClick={() => { if (needsSetup) setPhase("setup"); }}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); busy ? stop() : start(); } }}>
        {needsSetup ? <AlertTriangle size={15} /> : busy ? <Mic size={15} /> : <MicOff size={15} />}{!compact && <span className="hide-mobile">{needsSetup ? "Voce: setup" : busy ? "Ascult…" : "Ține apăsat"}</span>}
      </button>
      {phase !== "idle" && (
        <div className="voice-panel panel" role="dialog" aria-label="Voce">
          <div className="panel-head">
            <h3>{busy && <span className="pulse-dot mic" aria-hidden="true" />}{PHASE_LABEL[phase]}</h3>
            <button className="btn sm icon ghost" aria-label="Închide" onClick={close}><X size={14} /></button>
          </div>
          <div className="panel-body stack">
            <p className="faint small" style={{ margin: 0 }}>{engine?.label}{strictLocal ? " · mod local strict" : ""}. Hub-ul nu arhivează audio.</p>
            {phase === "setup" ? (
              <ol className="plain-list small">{LOCAL_STT_STEPS.map((s) => <li key={s}>{s}</li>)}</ol>
            ) : (
              <>
                {busy && (stream ? <div className="level" aria-label="Nivel semnal microfon"><i style={{ width: `${Math.round(level * 100)}%` }} /></div>
                  : <div className="faint small">Nivelul semnalului nu este disponibil: motorul browserului deține microfonul.</div>)}
                <textarea className="textarea" rows={3} value={transcript} onChange={(e) => setTranscript(e.target.value)} aria-label="Transcriere editabilă" disabled={busy} />
                {result?.kind === "refused" && <div className="notice warn">{result.reason}</div>}
                {result?.kind === "error" && <div className="notice error">{result.reason}</div>}
                {result?.kind === "command" && <div className="notice info">Comandă locală: {result.command}</div>}
                {phase === "ready" && (
                  <div className="row wrap">
                    <button className="btn primary sm" onClick={submit} disabled={!transcript.trim()}><Send size={14} />Trimite</button>
                    <span className="faint small">Comenzi locale: „Oprește”, „Pauză”, „Deschide aprobările”, „Intră în Focus”, „Deschide proiectul …”. Vocea nu aprobă nimic.</span>
                  </div>
                )}
              </>
            )}
            {settings?.ttsEnabled && <button className="btn sm ghost" onClick={() => window.speechSynthesis?.cancel()}><VolumeX size={14} />Oprește vorbirea</button>}
          </div>
        </div>
      )}
    </>
  );
}

export { Volume2 };
