import { useState } from "react";
import { FolderGit2, HardDrive, ChevronLeft, FileText, PlayCircle, PauseCircle } from "lucide-react";
import { api, fmt } from "../api.js";
import { useResource, useAction, refresh } from "../store.js";
import { Panel, Empty, Loading, ErrorNotice, StatusChip, Chip } from "../components/ui.jsx";

/**
 * Agent runs on this project: the owner's decision. Enabling needs the project's exact name typed (the Hub checks it
 * again); withdrawing is one click and also revokes this project's active run grants. The Hub project itself is fixed.
 */
function ExecutionPanel({ project, onChange }) {
  const [name, setName] = useState("");
  const enable = useAction(async () => { await api(`/api/projects/${project.id}/execution/enable`, { method: "POST", body: { confirmName: name } }); setName(""); onChange(); refresh(); });
  const disable = useAction(async () => { await api(`/api/projects/${project.id}/execution/disable`, { method: "POST", body: { reason: "Retras din ecranul Proiecte" } }); onChange(); refresh(); });
  const isHub = project.slug === "ifrim-agent-hub";
  return (
    <Panel title="Execuții pe acest proiect" icon={PlayCircle} data-lega-target="project-execution"
      actions={<Chip tone={project.executionAllowed ? "ok" : "neutral"}>{project.executionAllowed ? "permise" : "oprite"}</Chip>}>
      {isHub ? <p className="muted" style={{ margin: 0 }}>Hub-ul rămâne mereu activat; îl oprești cu Stop All sau suspendând poarta de execuție.</p>
        : project.executionAllowed ? (
          <div className="stack tight">
            <p className="muted" style={{ margin: 0 }}>Agenții (Codex, Claude Code) pot lucra aici prin poarta de execuție. Sub politica voice-first lucrul real e un plan pe care îl confirmi o singură dată în cockpit (granturile le derivă Hub-ul din plan, iar Hub-ul rămâne în BUILD_SAFE); pe calea manuală, mod LIVE_VALIDATION și un grant pentru acest proiect. Backup-ul verificat se face automat în <span className="mono">.ifrim/BACKUPS/v2</span> înainte de prima execuție. Retragerea oprește execuțiile noi și revocă grant-urile proiectului; o execuție deja pornită o oprești cu Întrerupe sau Stop All.</p>
            <div className="row"><button className="btn sm danger" disabled={disable.pending} onClick={disable.run}><PauseCircle size={14} />{disable.pending ? "Se retrag…" : "Retrage execuțiile"}</button></div>
            <ErrorNotice error={disable.error} />
          </div>
        ) : (
          <div className="stack tight">
            <p className="muted" style={{ margin: 0 }}>Acum proiectul e doar context: Lega și agenții îl pot citi, dar nu lucrează în el. Dacă permiți execuții, fiecare rulare trece în continuare prin poartă (deschisă), cu autorizarea ei — planul confirmat o dată în cockpit sau, pe calea manuală, un grant — și un backup verificat, care se scrie în proiect (<span className="mono">.ifrim/BACKUPS/v2</span>). Fișierele .env, .ifrim/private și credențialele rămân blocate pentru agenți.</p>
            <label className="field"><span>Tastează numele exact: <strong>{project.name}</strong></span><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" /></label>
            <div className="row"><button className="btn sm primary" disabled={name !== project.name || enable.pending} onClick={enable.run}><PlayCircle size={14} />{enable.pending ? "Se activează…" : "Permite execuții"}</button></div>
            <ErrorNotice error={enable.error} />
          </div>
        )}
    </Panel>
  );
}

function ProjectDetail({ id }) {
  const { data, error, loading, reload } = useResource(`/api/projects/${id}`, { reloadOn: (e) => e.type.startsWith("backup.") || e.type.startsWith("project.") });
  const backup = useAction(async () => { await api("/api/backups", { method: "POST", body: { projectId: id } }); reload(); });
  if (loading) return <div className="page"><Loading lines={6} /></div>;
  if (error) return <div className="page"><ErrorNotice error={error} onRetry={reload} /></div>;
  const { project, git, backups, instructions } = data;
  return (
    <div className="page">
      <div className="page-head">
        <div><a className="btn sm ghost" href="#/projects"><ChevronLeft size={14} />Proiecte</a><h1 style={{ marginTop: 8 }}>{project.name}</h1><p className="mono" style={{ fontSize: 12 }}>{project.path}</p></div>
        <div className="row wrap">
          <Chip tone={project.executionAllowed ? "ok" : "neutral"}>{project.executionAllowed ? "execuție V2 activată" : "doar context"}</Chip>
          {project.executionAllowed && <button className="btn" disabled={backup.pending} onClick={backup.run}><HardDrive size={15} />{backup.pending ? "Backup + verificare…" : "Backup verificat"}</button>}
        </div>
      </div>
      <ErrorNotice error={backup.error} />
      <div style={{ marginBottom: 16 }}><ExecutionPanel project={project} onChange={reload} /></div>
      <div className="grid two">
        <Panel title="Repository" icon={FolderGit2}>
          {git?.isRepo ? (
            <dl className="kv">
              <dt>Branch</dt><dd className="mono">{git.branch}</dd><dt>HEAD</dt><dd className="mono">{git.head.slice(0, 12)}</dd>
              <dt>Upstream</dt><dd className="mono">{git.upstream || "—"}</dd><dt>Modificate</dt><dd>{git.dirty.length}</dd><dt>Netrackuite</dt><dd>{git.untracked.length}</dd>
              <dt>Remote</dt><dd className="mono">{project.repo || "—"}</dd><dt>Stack</dt><dd>{project.stack || "—"}</dd>
              <dt>Preview</dt><dd>{project.frontendUrl || "—"}</dd><dt>API</dt><dd>{project.backendUrl || "—"}</dd>
            </dl>
          ) : <Empty title="Nu este un repository Git">{project.path}</Empty>}
          <p className="faint" style={{ margin: "12px 0 0", fontSize: 12 }}>Hub-ul pregătește diff-uri și mesaje de commit, dar nu face commit, push sau PR fără o aprobare legată de comanda exactă.</p>
        </Panel>
        <Panel title="Instrucțiuni și memorie de proiect" icon={FileText}>
          {instructions.length ? <ul style={{ margin: 0, paddingLeft: 18 }}>{instructions.map((f) => <li key={f} className="mono">{f}</li>)}</ul> : <p className="muted" style={{ margin: 0 }}>Nu există fișiere de instrucțiuni.</p>}
        </Panel>
      </div>
      <div style={{ marginTop: 16 }}>
        <Panel title="Backup-uri" icon={HardDrive} flush data-lega-target="project-backup">
          {backups.length ? (
            <div className="table-wrap"><table className="table table-mobile-cards">
              <thead><tr><th>Creat</th><th>Stare</th><th>Fișiere</th><th>Arhivă</th><th>Durată</th><th>Restaurare verificată</th><th>Motiv</th></tr></thead>
              <tbody>{backups.map((b) => (
                <tr key={b.id}><td>{fmt.dateTime(b.createdAt)}</td><td><StatusChip status={b.status} /></td><td>{b.fileCount}{b.skipped.length ? ` (${b.skipped.length} sărite)` : ""}</td><td>{fmt.bytes(b.archiveBytes)}</td><td>{b.durationMs ? `${(b.durationMs / 1000).toFixed(1)} s` : "—"}</td><td>{b.restoreVerifiedAt ? fmt.dateTime(b.restoreVerifiedAt) : "—"}</td><td className="muted">{b.reason}{b.error ? ` · ${b.error}` : ""}</td></tr>
              ))}</tbody>
            </table></div>
          ) : <Empty title="Niciun backup V2">{project.executionAllowed ? "Primul backup se creează înainte de prima execuție sau manual." : "Backup-urile se scriu în proiect; sunt activate doar pentru proiectele cu execuție V2."}</Empty>}
        </Panel>
      </div>
    </div>
  );
}

export default function Projects({ id }) {
  const { data, error, loading, reload } = useResource(id ? null : "/api/projects", { reloadOn: (e) => e.type.startsWith("project.") });
  const sync = useAction(async () => { await api("/api/projects/sync", { method: "POST", body: {} }); reload(); });
  if (id) return <ProjectDetail id={id} />;
  return (
    <div className="page">
      <div className="page-head"><div><h1>Proiecte</h1><p>Din registrul central PROJECTS.md (citit, nemodificat). Execuțiile de agenți le permiți tu, pe fiecare proiect, din pagina lui.</p></div><button className="btn" onClick={sync.run} disabled={sync.pending}>Resincronizează registrul</button></div>
      <ErrorNotice error={sync.error} />
      <Panel title="Proiecte" icon={FolderGit2} flush data-lega-target="projects-list">
        {loading ? <div className="panel-body"><Loading /></div> : error ? <div className="panel-body"><ErrorNotice error={error} onRetry={reload} /></div> : data.projects.length ? (
          <ul className="list">{data.projects.map((p) => (
            <li key={p.id}><a className="list-row" href={`#/projects/${p.id}`}><FolderGit2 size={16} color="var(--text-2)" aria-hidden="true" />
              <div className="grow"><div className="title ellipsis">{p.name}</div><div className="sub ellipsis">{p.stack || p.path}</div></div>
              <Chip tone={p.executionAllowed ? "ok" : "neutral"}>{p.executionAllowed ? "execuție V2" : "context"}</Chip></a></li>
          ))}</ul>
        ) : <Empty title="Registru gol" />}
      </Panel>
    </div>
  );
}
