import { useState } from "react";
import { searchNodes, freshnessWords, systemFields, STATE_ICONS, systemFact } from "../../lib/systemMap.js";
import { useRead, Source, ReadState, concealed } from "./Recap.jsx";
export default function SystemMap({ hideNumbers = false, display = false }) {
  const r = useRead("/api/system/map"), [query, setQuery] = useState(""), d = r.data, t = v => concealed(v, hideNumbers);
  if (!d) return <ReadState resource={r}/>;
  const nodes = searchNodes(d.nodes, query), byId = new Map(d.nodes.map(n => [n.id, n]));
  const chip = id => { const n = byId.get(id); return n && <span className={`system-chip state-${n.state}`} key={id}><span aria-hidden="true">{STATE_ICONS[n.state]}</span> {n.label}<span className="sr-only">: {n.stateText}</span></span>; };
  return <section className="command-system command-p1"><h2>Sistem · harta</h2><Source label="Starea păstrată de Hub" at={d.readAt} hideNumbers={hideNumbers}/>{!display && <label>Caută în sistem <input aria-label="Caută în sistem" value={query} onChange={e => setQuery(e.target.value)}/></label>}
    <div className="system-diagram" aria-label="Legăturile sistemului">{chip("pc")}<span aria-hidden="true">→</span>{chip("hub")}<span aria-hidden="true">→</span><div className="system-branches">{d.edges.filter(e => e.from === "hub").map(e => <span className="system-branch" key={e.to} title={typeof e.provenance === "string" ? e.provenance : undefined}>{chip(e.to)}</span>)}</div></div>
    <div className="system-nodes">{nodes.map(n => <article key={n.id} data-node={n.id} className={`system-node state-${n.state}`}><h3>{n.label}</h3><p>{STATE_ICONS[n.state]} {t(n.stateText)}</p><dl>{systemFields(n).map(f => <div key={f.key} data-field={f.key}><dt>{t(f.label)}</dt><dd>{f.value}</dd></div>)}</dl>{(n.facts || []).slice(0, 4).map((f, i) => <p key={i}>{t(f.label)}: {t(systemFact(f.value))}</p>)}<p className="command-source">{t(n.source)} · verificat {t(freshnessWords(n.checkedAt))}</p></article>)}</div>{!nodes.length && <p>Niciun rezultat în datele încărcate.</p>}</section>;
}
