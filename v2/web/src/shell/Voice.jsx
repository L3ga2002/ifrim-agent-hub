import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, X, Send, Volume2 } from "lucide-react";
import { api } from "../api.js";
import { useHub, setState, pushToast } from "../store.js";

const Recognition = typeof window !== "undefined" ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;

/** Engine locality is reported honestly: browser speech services may send audio to an online service. */
export async function detectSpeechEngine(lang = "ro-RO") {
  if (!Recognition) return { available: false, local: false, label: "Recunoaștere vocală indisponibilă în acest browser" };
  if (typeof Recognition.available === "function") {
    try {
      const status = await Recognition.available({ langs: [lang], processLocally: true });
      if (status === "available") return { available: true, local: true, label: "Recunoaștere pe dispozitiv (locală)" };
    } catch { /* API shape differs; fall through */ }
  }
  return { available: true, local: false, label: "Serviciul de recunoaștere al browserului (poate trimite audio online)" };
}

export function speak(text, { voiceURI = "", lang = "ro-RO" } = {}) {
  if (!("speechSynthesis" in window) || !text) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text.slice(0, 600));
  utterance.lang = lang;
  const voice = window.speechSynthesis.getVoices().find((v) => v.voiceURI === voiceURI);
  if (voice) utterance.voice = voice;
  window.speechSynthesis.speak(utterance);
}

/**
 * Push-to-talk: hold the button (or press Enter to toggle). Distinct visible states: microphone
 * active → transcribing → editable transcript → sent/executed. Audio is never stored by the Hub.
 */
export function VoiceControl({ go }) {
  const settings = useHub((s) => s.hub?.voiceSettings);
  const enabled = settings?.enabled;
  const [phase, setPhase] = useState("idle"); // idle | listening | transcribing | review | sending | done
  const [transcript, setTranscript] = useState("");
  const [result, setResult] = useState(null);
  const [engine, setEngine] = useState(null);
  const recRef = useRef(null);

  useEffect(() => { if (enabled) detectSpeechEngine(settings?.language || "ro-RO").then(setEngine); }, [enabled, settings?.language]);
  useEffect(() => { setState({ voicePhase: phase === "listening" ? "listening" : phase === "transcribing" ? "transcribing" : "idle" }); }, [phase]);
  useEffect(() => () => recRef.current?.abort?.(), []);

  if (!enabled) return null;

  const start = async () => {
    if (!Recognition || phase === "listening") return;
    window.speechSynthesis?.cancel();
    const rec = new Recognition();
    rec.lang = settings?.language || "ro-RO";
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    let finalText = "";
    rec.onresult = (event) => {
      setPhase("transcribing");
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        if (event.results[i].isFinal) finalText += event.results[i][0].transcript;
        else interim += event.results[i][0].transcript;
      }
      setTranscript((finalText + interim).trim());
    };
    rec.onerror = (event) => { setPhase("idle"); pushToast("voice-error", "error", `Microfon: ${event.error}`); };
    rec.onend = () => { recRef.current = null; setPhase((p) => (p === "listening" || p === "transcribing" ? "review" : p)); };
    recRef.current = rec;
    setTranscript(""); setResult(null); setPhase("listening");
    try {
      if (settings?.deviceId && navigator.mediaDevices?.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: settings.deviceId } } });
        try { rec.start(stream.getAudioTracks()[0]); } catch { rec.start(); }
      } else rec.start();
    } catch (error) { setPhase("idle"); pushToast("voice-error", "error", error.message); }
  };
  const stop = () => recRef.current?.stop?.();

  const submit = async () => {
    const text = transcript.trim();
    if (!text) return;
    setPhase("sending");
    try {
      const parsed = await api("/api/voice/command", { method: "POST", body: { transcript: text } });
      setResult(parsed);
      if (parsed.kind === "command" && parsed.command === "show_approvals") go("/approvals");
      if (parsed.kind === "command" && parsed.command === "mute") window.speechSynthesis?.cancel();
      if (parsed.kind === "message") {
        sessionStorage.setItem("hub.v2.voiceDraft", text);
        go("/conversations?voice=1");
      }
      if (settings?.ttsEnabled && parsed.kind === "command") speak(parsed.command === "stop_all" ? "Am oprit lucrul nou și am întrerupt execuțiile." : "Gata.", { voiceURI: settings.voiceURI });
      setPhase("done");
    } catch (error) { setResult({ kind: "error", reason: error.message }); setPhase("review"); }
  };

  const busy = phase === "listening" || phase === "transcribing";
  return (
    <>
      <button className={`btn sm ${busy ? "danger" : ""}`} aria-pressed={busy} disabled={!engine?.available}
        title={engine?.label || "Voce"}
        onPointerDown={(e) => { if (e.pointerType !== "mouse" || e.button === 0) start(); }}
        onPointerUp={stop} onPointerLeave={() => { if (phase === "listening") stop(); }}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); busy ? stop() : start(); } }}>
        {busy ? <Mic size={15} /> : <MicOff size={15} />}<span className="hide-mobile">{busy ? "Ascult…" : "Ține apăsat"}</span>
      </button>
      {phase !== "idle" && (
        <div className="voice-panel panel" role="dialog" aria-label="Transcriere vocală">
          <div className="panel-head">
            <h3>{busy && <span className="pulse-dot mic" aria-hidden="true" />}{phase === "listening" ? "Microfon activ" : phase === "transcribing" ? "Transcriu…" : phase === "sending" ? "Se trimite…" : phase === "done" ? "Executat" : "Verifică transcrierea"}</h3>
            <button className="btn sm icon ghost" aria-label="Închide" onClick={() => { recRef.current?.abort?.(); setPhase("idle"); }}><X size={14} /></button>
          </div>
          <div className="panel-body stack">
            <p className="faint" style={{ margin: 0, fontSize: 12 }}>{engine?.label}. Hub-ul nu arhivează audio.</p>
            <textarea className="textarea" rows={3} value={transcript} onChange={(e) => setTranscript(e.target.value)} aria-label="Transcriere editabilă" disabled={busy} />
            {result?.kind === "refused" && <div className="notice warn">{result.reason}</div>}
            {result?.kind === "error" && <div className="notice error">{result.reason}</div>}
            {result?.kind === "command" && <div className="notice info">Comandă locală: {result.command}</div>}
            {phase === "review" && (
              <div className="row">
                <button className="btn primary sm" onClick={submit} disabled={!transcript.trim()}><Send size={14} />Trimite</button>
                <span className="faint" style={{ fontSize: 12 }}>Comenzi locale: „Oprește”, „Pauză”, „Arată aprobările”. Vocea nu poate aproba nimic.</span>
              </div>
            )}
            {settings?.ttsEnabled && <button className="btn sm ghost" onClick={() => window.speechSynthesis?.cancel()}><Volume2 size={14} />Oprește vorbirea</button>}
          </div>
        </div>
      )}
    </>
  );
}
