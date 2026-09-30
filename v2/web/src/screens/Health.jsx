import { Fragment } from "react";
import { Activity, Gauge, Server, ScrollText } from "lucide-react";
import { fmt } from "../api.js";
import { useResource, useHub } from "../store.js";
import { Panel, Loading, ErrorNotice, Empty, Notice } from "../components/ui.jsx";

function UsageBar({ win }) {
  const pct = Math.max(0, Math.min(100, win.usedPercent));
  return (
    <div className="stack tight">
      <div className="row between"><span>{win.name === "primary" ? "Fereastra principală" : "Fereastra secundară"}{win.windowMinutes ? ` (${Math.round(win.windowMinutes / 60)} h)` : ""}</span><strong>{pct}%</strong></div>
      <div className="progress"><div className="bar" style={{ width: "100%" }} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><i style={{ width: `${pct}%`, background: pct >= 80 ? "var(--approval)" : "var(--accent)" }} /></div></div>
      <span className="faint" style={{ fontSize: 12 }}>Resetare: {win.resetsAt ? fmt.dateTime(win.resetsAt) : "necunoscută"}</span>
    </div>
  );
}

export default function Health() {
  const usage = useResource("/api/usage", { reloadOn: (e) => e.type.startsWith("provider.") || e.type.startsWith("run.") });
  const processes = useResource("/api/health/processes");
  const audit = useResource("/api/audit?limit=150", { reloadOn: () => true });
  const hub = useHub((s) => s.hub);
  return (
    <div className="page">
      <div className="page-head"><div><h1>Utilizare și sănătate</h1><p>Doar cifrele raportate de provideri. Ce nu este raportat rămâne necunoscut; allowance-urile nu se adună între provideri.</p></div></div>
      <div className="grid two">
        <Panel title="Allowance abonamente" icon={Gauge}>
          {usage.loading ? <Loading /> : usage.error ? <ErrorNotice error={usage.error} /> : (
            <div className="stack">
              {usage.data.overview.map((o) => (
                <div key={o.provider} className="stack tight">
                  <div className="row between"><strong>{o.provider === "codex" ? "Codex (plan ChatGPT)" : "Claude Code (plan Claude)"}</strong><span className="faint" style={{ fontSize: 12 }}>{o.snapshot ? `${o.snapshot.source} · ${fmt.ago(o.snapshot.capturedAt)}` : "necunoscut"}</span></div>
                  {o.snapshot?.windows?.length ? o.snapshot.windows.map((w) => <UsageBar key={w.name} win={w} />) : <p className="muted" style={{ margin: 0 }}>{o.note || "Nicio valoare raportată."}</p>}
                  {o.snapshot?.planType && <span className="faint">Plan raportat: {o.snapshot.planType}{o.snapshot.creditsReported ? ` · credite: ${o.snapshot.creditsReported.hasCredits ? "există (nu sunt consumate de Hub)" : "fără"}` : ""}</span>}
                </div>
              ))}
              <Notice tone="info">Rezervă pentru munca ta interactivă: {usage.data.reservePercent}%. Hub-ul nu pornește și oprește turnurile la {100 - usage.data.reservePercent}% din orice fereastră raportată.</Notice>
            </div>
          )}
        </Panel>
        <Panel title="Procese și porturi" icon={Server}>
          {processes.loading ? <Loading /> : processes.error ? <ErrorNotice error={processes.error} /> : (
            <div className="stack">
              <dl className="kv"><dt>Hub PID</dt><dd>{processes.data.hubPid}</dd><dt>Uptime</dt><dd>{Math.round(processes.data.uptimeS / 60)} min</dd><dt>Memorie</dt><dd>{processes.data.memoryMb} MB</dd></dl>
              <div className="table-wrap"><table className="table">
                <thead><tr><th>Port</th><th>PID</th><th>Rol observat</th></tr></thead>
                <tbody>{processes.data.listeners.map((l) => <tr key={`${l.port}-${l.pid}`}><td className="mono">{l.port}</td><td className="mono">{l.pid}</td><td>{l.role}</td></tr>)}</tbody>
              </table></div>
              <p className="faint" style={{ margin: 0, fontSize: 12 }}>{processes.data.note}</p>
              <div className="section-title">Procese supravegheate de Hub</div>
              {processes.data.supervised.length ? <ul className="list">{processes.data.supervised.map((p) => <li key={p.key}><div className="list-row"><span className="grow">{p.label}</span><span className="mono">pid {p.pid}</span></div></li>)}</ul> : <p className="muted" style={{ margin: 0 }}>Niciunul.</p>}
            </div>
          )}
        </Panel>
        <Panel title="Recuperare la pornire" icon={Activity}>
          {hub?.boot ? (
            <dl className="kv">
              <dt>Mod resetat</dt><dd>{hub.boot.modeReset ? "da (BUILD_SAFE)" : "nu era necesar"}</dd>
              <dt>Execuții reconciliate</dt><dd>{hub.boot.runs.length ? hub.boot.runs.map((r) => `${r.id.slice(-6)}: ${r.status}`).join(", ") : "niciuna"}</dd>
              <dt>Taskuri blocate</dt><dd>{hub.boot.tasks.length}</dd><dt>Lease-uri reținute</dt><dd>{hub.boot.leases.length}</dd>
            </dl>
          ) : <Loading />}
          {hub?.leases?.filter((l) => l.status === "retained").map((l) => <div key={l.id} style={{ marginTop: 8 }}><Notice tone="warn" title="Lease reținut">{l.resource} · {l.release_reason}</Notice></div>)}
        </Panel>
        <Panel title="Circuit breakers" icon={Activity}>
          <dl className="kv">{Object.entries(hub?.breakers || {}).map(([k, b]) => <Fragment key={k}><dt>{k}</dt><dd>{b.state}{b.failures ? ` · ${b.failures} eșecuri` : ""}{b.until ? ` · până la ${fmt.time(b.until)}` : ""}</dd></Fragment>)}</dl>
        </Panel>
      </div>
      <div style={{ marginTop: 16 }}>
        <Panel title="Jurnal de audit (evenimente persistate)" icon={ScrollText} flush>
          {audit.loading ? <div className="panel-body"><Loading /></div> : audit.data?.events?.length ? (
            <div className="table-wrap"><table className="table table-mobile-cards">
              <thead><tr><th>#</th><th>Timp</th><th>Tip</th><th>Scope</th><th>Sursă</th></tr></thead>
              <tbody>{audit.data.events.slice(0, 150).map((e) => <tr key={e.seq}><td className="mono">{e.seq}</td><td className="nowrap">{fmt.dateTime(e.createdAt)}</td><td>{e.type}</td><td className="mono">{e.scopeType}:{String(e.scopeId).slice(-10)}</td><td>{e.source}</td></tr>)}</tbody>
            </table></div>
          ) : <Empty title="Fără evenimente" />}
        </Panel>
      </div>
    </div>
  );
}
