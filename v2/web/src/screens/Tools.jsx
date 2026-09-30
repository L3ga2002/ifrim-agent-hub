import { useState } from "react";
import { Wrench, Play, Monitor, Globe, Lock, Unlock, ExternalLink, FlaskConical, Square, Info } from "lucide-react";
import { api, fmt } from "../api.js";
import { useResource, useAction, useHub } from "../store.js";
import { Panel, Loading, ErrorNotice, Chip, Notice, Empty, StatusChip } from "../components/ui.jsx";
import { StopAllButton } from "../shell/Shell.jsx";

const TIER_RO = { READ_ONLY: "doar citire", WORKSPACE_EDIT: "editare", DEVELOPMENT_TOOLS: "unelte dev", EXTERNAL_ACTIONS: "externe", SENSITIVE_ACTIONS: "sensibile" };
const MODE_RO = { structured_api: "API structurat", dom: "DOM", visual: "vizual" };

function BrowserWorkspace({ hubProject }) {
  const status = useResource("/api/browser/status");
  const shots = useResource("/api/tool-calls?tool=browser.inspect&limit=10", { reloadOn: (e) => e.type.startsWith("tool.") });
  const [url, setUrl] = useState("http://127.0.0.1:3004/");
  const ask = useAction(async () => api("/api/tools/browser.inspect", { method: "POST", body: { projectId: hubProject?.id || "ifrim-agent-hub", args: { url } } }));
  const s = status.data;
  return (
    <Panel title="Browser Workspace" icon={Globe} actions={s ? <StatusChip status={s.installed ? "available" : "needs_setup"} label={s.installed ? `Playwright ${s.version || ""}` : "NEEDS_INSTALL_APPROVAL"} /> : null}>
      <div className="stack">
        <p className="muted small" style={{ margin: 0 }}>Context de browser izolat pentru preview-uri locale: fără profilul tău, fără cookie-uri salvate, service workers blocate, descărcări refuzate. Doar 127.0.0.1/localhost cu port; niciodată interfața de administrare a Hub-ului.</p>
        {status.loading ? <Loading /> : s && !s.installed ? (
          <Notice tone="warn" title="Instalare necesară (cere aprobarea ta)">
            {s.reason}
            <dl className="kv compact" style={{ marginTop: 8 }}>
              <dt>Ce</dt><dd>{s.approvalRequest?.what}</dd><dt>De ce</dt><dd>{s.approvalRequest?.why}</dd><dt>Browsere</dt><dd>{s.approvalRequest?.browsers}</dd>
              <dt>Comandă</dt><dd className="mono small">{s.approvalRequest?.install}</dd><dt>Licență</dt><dd>{s.approvalRequest?.license}</dd><dt>Stocare</dt><dd>{s.approvalRequest?.storage}</dd>
              {s.cachedBrowsers?.length > 0 && <><dt>Deja pe disc</dt><dd className="mono small">{s.cachedBrowsers.join(", ")}</dd></>}
            </dl>
            <div className="faint small">Până la aprobare nu rulează nimic și nu se raportează capturi sau teste E2E.</div>
          </Notice>
        ) : s?.installed ? (
          <form className="row wrap" onSubmit={async (e) => { e.preventDefault(); await ask.run(); }}>
            <label className="sr-only" htmlFor="bw-url">URL local</label>
            <input id="bw-url" className="input grow" value={url} onChange={(e) => setUrl(e.target.value)} />
            <button className="btn sm" disabled={ask.pending}>Cere aprobare pentru acest URL</button>
          </form>
        ) : null}
        {ask.data?.approval && <Notice tone="approval">Aprobare creată pentru URL-ul exact; o decizi pe ecranul Aprobări, apoi o execuți de acolo.</Notice>}
        <ErrorNotice error={status.error || ask.error} />
        {(shots.data?.calls || []).length > 0 && (
          <ul className="list">{shots.data.calls.map((c) => (
            <li key={c.id}><div className="list-row">
              <div className="grow"><div className="title mono ellipsis">{c.args?.url}</div><div className="sub">{fmt.dateTime(c.startedAt)} · HTTP {c.result?.status ?? "—"} · {c.result?.consoleErrors?.length ?? 0} erori consolă</div></div>
              {c.result?.screenshot && <a className="btn sm ghost" href={`/api/browser/evidence/${c.result.screenshot}`} target="_blank" rel="noreferrer">Captură</a>}
            </div></li>
          ))}</ul>
        )}
      </div>
    </Panel>
  );
}

function ComputerPanel({ hubProject }) {
  const { data, error, loading, reload } = useResource("/api/computer", { reloadOn: (e) => e.type.startsWith("computer.") || e.type.startsWith("lease.") });
  const release = useAction(async (lock) => { await api("/api/computer/release", { method: "POST", body: { leaseIds: [lock.id], reason: "eliberat manual din panoul Calculator" } }); reload(); });
  const locks = data?.locks || [];
  const claudeLink = hubProject?.path ? `claude-cli://open?cwd=${encodeURIComponent(hubProject.path)}` : null;
  return (
    <Panel title="Calculator" icon={Monitor}>
      <div className="stack">
        <Notice tone="info" title="Controlul desktopului de către Hub: nu este construit">
          Nu există un bridge local: Hub-ul nu mișcă mouse-ul, nu tastează și nu capturează ecranul. Accesul tău la Claude/ChatGPT desktop nu înseamnă acces programatic al Hub-ului la funcțiile lor. Un desktop comun are un singur controller (lease exclusiv), cu pauză/preluare manuală.
        </Notice>
        <div className="section-title">Controller activ</div>
        {locks.length ? (
          <ul className="list">{locks.map((l) => (
            <li key={l.id}><div className="list-row">
              <Lock size={15} aria-hidden="true" /><div className="grow"><div className="title mono">{l.resource}</div><div className="sub">{l.holder} · de la {fmt.dateTime(l.acquiredAt || l.createdAt)}</div></div>
              <button className="btn sm" disabled={release.pending} onClick={() => release.run(l)}><Unlock size={13} />Eliberează</button>
            </div></li>
          ))}</ul>
        ) : <div className="faint small">Niciun controller: niciun mediu nu este deținut acum. Ultima acțiune și mecanismul de oprire apar aici când există un lease.</div>}
        <div className="row wrap"><StopAllButton /><span className="faint small">Stop All suspendă poarta și întrerupe execuțiile controlabile.</span></div>
        <div className="section-title">Medii</div>
        <ErrorNotice error={error || release.error} onRetry={reload} />
        {loading ? <Loading /> : (
          <ul className="list">{(data?.environments || []).map((e) => (
            <li key={e.id}><div className="list-row">
              <div className="grow"><div className="title">{e.name}</div><div className="sub">{MODE_RO[e.controlMode] || e.controlMode} · izolare {e.isolation} · {e.statusReason}</div></div>
              <StatusChip status={e.status === "available" ? "available" : e.status === "assisted" ? "assisted" : e.status === "blocked" ? "blocked" : "unknown"} label={e.status} />
            </div></li>
          ))}</ul>
        )}
        <div className="section-title">Deschide aplicația nativă (asistat)</div>
        <ul className="plain-list small">
          <li>{claudeLink ? <a href={claudeLink}><ExternalLink size={12} /> Claude Code în proiectul Hub</a> : "Claude Code"} — deep link oficial <span className="mono">claude-cli://open?cwd=…</span>; nu pornește nimic până nu apeși tu Enter. Fără prompt în URL (nu punem date în linkuri).</li>
          <li>Claude Desktop (computer use, Chrome) și Codex/ChatGPT desktop: deschide-le manual; nu există un traseu oficial verificat prin care Hub-ul să le controleze.</li>
        </ul>
      </div>
    </Panel>
  );
}

function ControlledCommands({ go }) {
  const [script, setScript] = useState("test:v2");
  const [requested, setRequested] = useState(null);
  const request = useAction(async () => api("/api/tools/process.run", { method: "POST", body: { projectId: "ifrim-agent-hub", args: { script } } }));
  const runs = useResource("/api/tool-calls?limit=20", { reloadOn: (e) => e.type.startsWith("tool.") });
  const list = (runs.data?.calls || []).filter((c) => ["process.test", "process.build"].includes(c.tool));
  return (
    <Panel title="Comenzi controlate (nu un terminal)" icon={FlaskConical}>
      <div className="stack">
        <p className="muted small" style={{ margin: 0 }}>Rulează un script npm din Agent Hub după o aprobare legată de comanda exactă, proiect și versiunea codului. Rezultatul are moment, comandă, cod de ieșire și finalul output-ului. Terminalul interactiv nu este implementat intenționat.</p>
        <div className="seg wrap" role="group" aria-label="Script">{["test:v2", "build:v2", "test", "build"].map((s) => <button key={s} aria-pressed={script === s} onClick={() => setScript(s)}>npm run {s}</button>)}</div>
        <button className="btn primary sm" style={{ alignSelf: "flex-start" }} disabled={request.pending} onClick={async () => { const r = await request.run(); if (r) setRequested(r.approval); }}><Play size={14} />Cere aprobare</button>
        {requested && <Notice tone="approval" title="Aprobare creată">Deschide Aprobări, aprobă exact comanda, apoi rulează-o de acolo. <button className="btn sm" onClick={() => go("/approvals")}>Aprobări</button></Notice>}
        <ErrorNotice error={request.error} />
        {list.length ? (
          <ul className="list">{list.map((c) => (
            <li key={c.id}><div className="list-row"><StatusChip status={c.result?.exitCode === 0 ? "completed" : c.status === "running" ? "running" : "failed"} label={c.result?.exitCode === undefined ? c.status : `exit ${c.result.exitCode}`} />
              <div className="grow"><div className="title mono">{c.result?.command || c.args?.script}</div><div className="sub">{fmt.dateTime(c.startedAt)} · {c.result?.durationMs ? `${Math.round(c.result.durationMs / 1000)} s` : "—"}</div></div></div></li>
          ))}</ul>
        ) : <div className="faint small">Nicio comandă rulată încă.</div>}
      </div>
    </Panel>
  );
}

export default function Tools({ go }) {
  const { data, error, loading, reload } = useResource("/api/tools");
  const hub = useHub((s) => s.hub);
  const projects = useResource("/api/projects");
  const hubProject = (projects.data?.projects || []).find((p) => p.slug === "ifrim-agent-hub");
  return (
    <div className="page">
      <div className="page-head"><div><h1>Instrumente și computer</h1><p>Browser izolat, calculatorul și comenzile controlate. Fiecare instrument declară permisiunea, efectele și ce înseamnă un rezultat verificabil; nu există shell universal.</p></div></div>
      <div className="grid two">
        <BrowserWorkspace hubProject={hubProject} />
        <ComputerPanel hubProject={hubProject} />
      </div>
      <div className="grid two" style={{ marginTop: 16 }}>
        <ControlledCommands go={go} />
        <Panel title="Procese pornite de Hub" icon={Square}>
          {hub?.processes?.length ? (
            <ul className="list">{hub.processes.map((p) => <li key={p.key || p.pid}><div className="list-row"><span className="mono grow">{p.label}</span><span className="faint mono">pid {p.pid}</span><span className="faint small">{fmt.ago(p.startedAt)}</span></div></li>)}</ul>
          ) : <Empty title="Niciun proces supravegheat">Procesele provider și de test apar aici; se opresc cu Stop All și nu sunt relansate implicit.</Empty>}
        </Panel>
      </div>
      <div style={{ marginTop: 16 }}>
        <Panel title="Registru de instrumente" icon={Wrench} flush>
          {loading ? <div className="panel-body"><Loading /></div> : error ? <div className="panel-body"><ErrorNotice error={error} onRetry={reload} /></div> : (
            <div className="table-wrap"><table className="table table-mobile-cards">
              <thead><tr><th>Instrument</th><th>Permisiune</th><th>Efecte</th><th>Timeout</th><th>Rezultat</th><th>Stare</th></tr></thead>
              <tbody>{data.tools.map((t) => (
                <tr key={t.id}><td className="mono">{t.id}</td><td>{TIER_RO[t.tier]}</td><td>{t.effects}</td><td>{t.timeoutMs ? `${Math.round(t.timeoutMs / 1000)} s` : "—"}</td><td className="muted">{t.result}</td>
                  <td>{/blocked|NEEDS_INSTALL/.test(t.status) ? <><Chip tone="warn">{t.status === "NEEDS_INSTALL_APPROVAL" ? "necesită aprobare instalare" : "blocat"}</Chip>{t.reason && <div className="faint small" style={{ marginTop: 4 }}>{t.reason}</div>}</> : <Chip tone="ok">{t.status}</Chip>}</td></tr>
              ))}</tbody>
            </table></div>
          )}
        </Panel>
      </div>
      <p className="faint small"><Info size={12} aria-hidden="true" /> Instalările (Playwright, motoare vocale locale, componente native) cer aprobarea ta separat; nicio aprobare de instalare nu autorizează inferență sau push.</p>
    </div>
  );
}
