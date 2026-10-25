import { createContext, useContext, useEffect, useRef, useState } from "react";
import { onHubEvent, useHub } from "../../store.js";
import { api } from "../../api.js";
import { indicatorText, chapterVoice, scheduleCommandRead } from "../../lib/commandModel.js";
import { bucharestParts } from "../../lib/roText.js";
export function Indicator({ indicator, hideNumbers = false, disconnected = false }) {
  const i = indicatorText(indicator, { hideNumbers });
  if (!i) return null;
  const hasSplit = Boolean(indicator.provenance === "mixed" && typeof indicator.value === "number");
  return <article className={`command-indicator tone-${i.tone}${hasSplit ? " has-split" : ""}${disconnected ? " disconnected" : ""}`} data-indicator={indicator.id}><h3>{i.label}</h3><p className="indicator-value" aria-label={i.srText}>{i.text}{indicator.unit && !hideNumbers ? ` ${indicator.unit}` : ""}</p>{indicator.provenance === "synthetic" && <span className="command-badge">SINTETIC</span>}{hasSplit && <span className="command-badge">REAL + SINTETIC</span>}<p className="command-source">{i.source}</p>{i.note && <p>{i.note}</p>}{disconnected && <p>ultima citire {bucharestParts(indicator.readAt).time}</p>}</article>;
}
export function RecapText({ snapshot, recap, voice, voiceOff = false, display = false, onControl, onRefresh, stale = false }) {
  const chapter = snapshot?.chapters?.[recap?.index];
  if (!chapter) return <p role="status">Se citește rezumatul…</p>;
  return <div className="command-recap"><h2 className="recap-chapter">Capitolul {recap.index + 1} din 6</h2><p className="recap-title">{chapter.title}</p>{chapter.badge && <p className="command-badge">{chapter.badge}</p>}<p className="recap-sentences">{chapter.sentences?.join(" ")}</p>{!display && <div className="command-controls">{[["back", "‹ Înapoi"], ["repeat", "Repetă"], ["next", "Următorul ›"], ["open", "Deschide"], ["stop", "Oprește"]].map(([a, label]) => <button key={a} onClick={() => onControl(a)}>{label}</button>)}</div>}<p>{snapshot.period.label}</p><p>citit la {bucharestParts(snapshot.generatedAt).time}</p><p>{display && !voice?.[`${snapshot.id}:${recap.index}`] ? "Dovada vocală apare aici când Hub-ul o transmite." : chapterVoice(voiceOff ? { off: true } : voice, snapshot.id, recap.index)}</p><ol className="recap-progress" aria-label="Capitole">{snapshot.chapters.map((c, i) => <li key={c.key} aria-current={i === recap.index ? "step" : undefined}><span aria-hidden="true">{i === recap.index ? "◆" : "○"}</span><span className="sr-only">{c.title}</span></li>)}</ol>{stale && (display ? <p>Datele s-au schimbat de la {bucharestParts(snapshot.generatedAt).time} · Actualizează în fereastra principală</p> : <button onClick={onRefresh}>Datele s-au schimbat de la {bucharestParts(snapshot.generatedAt).time} · Actualizează</button>)}</div>;
}

export const concealed = (value, hide) => hide && /\d/.test(String(value ?? "")) ? "•••" : String(value ?? "necunoscut");
export function Source({ label, at, hideNumbers }) { return <p className="command-source">{concealed(label, hideNumbers)} · citit la {concealed(bucharestParts(at).time, hideNumbers)}</p>; }
export const ReadContext = createContext(null);
export function useVisibleClock() {
 const [now, setNow] = useState(Date.now());
 useEffect(() => { let timer; const sync = () => { clearInterval(timer); if (!document.hidden) { setNow(Date.now()); timer = setInterval(() => setNow(Date.now()), 1000); } }; document.addEventListener("visibilitychange", sync); sync(); return () => { clearInterval(timer); document.removeEventListener("visibilitychange", sync); }; }, []);
 return now;
}
export function useRead(path) {
 const [state, set] = useState({}), report = useContext(ReadContext), reporter = useRef(report);
 reporter.current = report;
 const connection = useHub(s => s.connection);
 useEffect(() => {
  if (!path) return;
  let generation = 0; const controller = new AbortController();
  const read = async () => {
   const request = ++generation;
   try { const data = await api(path, { signal: controller.signal }); if (!controller.signal.aborted && request === generation) { const readAt = data.readAt || new Date().toISOString(); set({ path, data, readAt }); reporter.current?.({ path, readAt }); } }
   catch(error) { if (!controller.signal.aborted && request === generation) { set(old => ({ ...old, path, error })); reporter.current?.({ path, error: true }); } }
  };
  const stop = scheduleCommandRead(read, { doc: document, subscribe: onHubEvent });
  return () => { controller.abort(); stop(); };
 }, [path, connection]);
 return state.path === path ? state : {};
}
export function ReadState({ resource }) { return <p role="status">{resource.error ? "Date indisponibile: sursa nu a putut fi citită." : "Se citesc datele…"}</p>; }
