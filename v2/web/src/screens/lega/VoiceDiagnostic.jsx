import { useEffect, useRef, useState } from "react";
import { Activity, Square } from "lucide-react";
import { api } from "../../api.js";
import { Chip, ErrorNotice } from "../../components/ui.jsx";
import { createVoiceGate, MIC_CONSTRAINTS } from "../../lib/voiceGate.js";
import { preferredMic } from "../../lib/voiceContext.js";
import { diagRows, diagSummary, DIAG_STAGES } from "../../lib/voiceDiagLogic.js";

/**
 * M11 local voice diagnostic: the SAME microphone settings and segmenter as Lega's filter, sent to the Hub's diagnostic route,
 * which measures each sentence stage by stage (capture → segmentation → speaker → transcript → intent → effect) and confirms,
 * resumes or releases nothing. The list also shows the filter's own sentences from a Lega session (kept 2 h, in memory, no audio).
 */
export function VoiceDiagnostic() {
  const [running, setRunning] = useState(false);
  const [data, setData] = useState(null);
  const [dropped, setDropped] = useState(0);
  const [error, setError] = useState(null);
  const gate = useRef(null);
  const stream = useRef(null);
  const timer = useRef(null);
  const load = async () => { try { setData(await api("/api/voice/diagnostics")); } catch (e) { setError(e); } };
  const stop = () => {
    clearTimeout(timer.current);
    gate.current?.close(); gate.current = null;
    stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null;
    setRunning(false);
  };
  useEffect(() => { load(); return stop; }, []);
  const start = async () => {
    setError(null); setDropped(0);
    try {
      const deviceId = preferredMic();
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: { ...MIC_CONSTRAINTS, ...(deviceId ? { deviceId: { ideal: deviceId } } : {}) } });
      gate.current = await createVoiceGate(stream.current, { diagnostic: true, onDecision: () => load(), onDropped: () => setDropped((n) => n + 1) });
      setRunning(true);
      timer.current = setTimeout(stop, 60000); // one minute at most; the microphone is released at the end
    } catch (e) { stop(); setError(e); }
  };
  const rows = diagRows(data?.entries || []);
  const summary = diagSummary(data?.entries || []);
  return (
    <div className="stack tight">
      <h4 className="small" style={{ margin: 0 }}>Diagnostic voce (local)</h4>
      <p className="faint small" style={{ margin: 0 }}>Spune comenzile pe rând, cu pauză între ele. Hub-ul măsoară fiecare frază, dar nu confirmă și nu pornește nimic. Aici apar și frazele filtrului din ultima sesiune Lega (ultimele 2 ore, fără audio).</p>
      <div className="row wrap">
        {!running ? <button className="btn sm primary" onClick={start}><Activity size={13} />Pornește diagnosticul (1 min)</button>
          : <button className="btn sm" onClick={stop}><Square size={13} />Oprește diagnosticul</button>}
        {running && <Chip tone="info">ascult</Chip>}
        {dropped > 0 && <span className="faint small">{dropped} zgomote scurte ignorate (nu au fost trimise)</span>}
        {summary.total > 0 && <span className="small">{summary.text}</span>}
      </div>
      {rows.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table className="table small">
            <thead><tr><th>Ora</th><th>Sursă</th><th>Segment</th><th>Vorbire</th><th>Nivel</th>{DIAG_STAGES.map((s) => <th key={s.key}>{s.label}</th>)}<th>Pierdută la</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id}>
                <td>{r.time}</td><td>{r.source}</td><td>{r.segment}</td><td>{r.speech}</td><td>{r.level}</td>
                {DIAG_STAGES.map((s) => <td key={s.key}>{r.stages[s.key]}</td>)}
                <td>{r.lostAt ? <Chip tone="warn">{r.lostAt}</Chip> : <Chip tone="ok">—</Chip>}</td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
      <ErrorNotice error={error} />
    </div>
  );
}
