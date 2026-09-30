import { useState } from "react";
import { Wrench, Play, Monitor } from "lucide-react";
import { api } from "../api.js";
import { useResource, useAction, useHub } from "../store.js";
import { Panel, Loading, ErrorNotice, Chip, Notice, Empty } from "../components/ui.jsx";

const TIER_RO = { READ_ONLY: "doar citire", WORKSPACE_EDIT: "editare", DEVELOPMENT_TOOLS: "unelte dev", EXTERNAL_ACTIONS: "externe", SENSITIVE_ACTIONS: "sensibile" };

export default function Tools({ go }) {
  const { data, error, loading, reload } = useResource("/api/tools");
  const hub = useHub((s) => s.hub);
  const [script, setScript] = useState("test:v2");
  const request = useAction(async () => api("/api/tools/process.run", { method: "POST", body: { projectId: "ifrim-agent-hub", args: { script } } }));
  const [requested, setRequested] = useState(null);
  return (
    <div className="page">
      <div className="page-head"><div><h1>Instrumente și computer</h1><p>Registru comun de instrumente, fiecare cu permisiune, efecte, timeout și rezultat verificabil. Nu există un endpoint universal de shell sau desktop.</p></div></div>
      <div className="split-main">
        <Panel title="Registru" icon={Wrench} flush>
          {loading ? <div className="panel-body"><Loading /></div> : error ? <div className="panel-body"><ErrorNotice error={error} onRetry={reload} /></div> : (
            <div className="table-wrap"><table className="table table-mobile-cards">
              <thead><tr><th>Instrument</th><th>Permisiune</th><th>Efecte</th><th>Timeout</th><th>Rezultat</th><th>Stare</th></tr></thead>
              <tbody>{data.tools.map((t) => (
                <tr key={t.id}><td className="mono">{t.id}</td><td>{TIER_RO[t.tier]}</td><td>{t.effects}</td><td>{t.timeoutMs ? `${Math.round(t.timeoutMs / 1000)} s` : "—"}</td><td className="muted">{t.result}</td>
                  <td>{t.status === "blocked" ? <><Chip tone="warn">blocat</Chip><div className="faint" style={{ fontSize: 12, marginTop: 4 }}>{t.reason}</div></> : <Chip tone="ok">disponibil</Chip>}</td></tr>
              ))}</tbody>
            </table></div>
          )}
        </Panel>
        <div className="stack">
          <Panel title="Comandă locală cu aprobare" icon={Play}>
            <div className="stack">
              <p className="muted" style={{ margin: 0 }}>Rulează un script npm din Agent Hub. Hub-ul cere întâi o aprobare legată de comanda exactă, proiect și versiunea codului.</p>
              <div className="seg" role="group" aria-label="Script">{["test:v2", "build:v2", "test", "build"].map((s) => <button key={s} aria-pressed={script === s} onClick={() => setScript(s)}>npm run {s}</button>)}</div>
              <button className="btn primary" disabled={request.pending} onClick={async () => { const r = await request.run(); if (r) setRequested(r.approval); }}>Cere aprobare</button>
              {requested && <Notice tone="info" title="Aprobare creată">Deschide Aprobări, aprobă exact comanda, apoi rulează-o de acolo. <button className="btn sm" onClick={() => go("/approvals")}>Aprobări</button></Notice>}
              <ErrorNotice error={request.error} />
            </div>
          </Panel>
          <Panel title="Control computer" icon={Monitor}>
            <div className="stack">
              <Notice tone="warn" title="Neactivat">Controlul desktopului (mouse/tastatură), capturile de ecran și browserul automat sunt blocate până le aprobi explicit, cu un singur controller, indicator vizibil și Stop.</Notice>
              <dl className="kv">
                <dt>Control activ</dt><dd>{hub?.activeRuns?.length ? `${hub.activeRuns.length} execuții provider (fără control desktop)` : "niciunul"}</dd>
                <dt>Procese Hub</dt><dd>{hub?.processes?.length ? hub.processes.map((p) => `${p.label} (pid ${p.pid})`).join(", ") : "niciunul"}</dd>
              </dl>
              {!hub?.processes?.length && <Empty title="Niciun proces supravegheat">Procesele pornite de Hub apar aici și pot fi oprite din Stop All.</Empty>}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
