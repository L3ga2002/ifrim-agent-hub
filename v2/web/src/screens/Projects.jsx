import { FolderGit2, HardDrive, ChevronLeft, FileText } from "lucide-react";
import { api, fmt } from "../api.js";
import { useResource, useAction } from "../store.js";
import { Panel, Empty, Loading, ErrorNotice, StatusChip, Chip, Notice } from "../components/ui.jsx";

function ProjectDetail({ id }) {
  const { data, error, loading, reload } = useResource(`/api/projects/${id}`, { reloadOn: (e) => e.type.startsWith("backup.") });
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
        <Panel title="Backup-uri" icon={HardDrive} flush>
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
      {!project.executionAllowed && <div style={{ marginTop: 16 }}><Notice tone="info">Acest proiect este vizibil pentru context. Activarea execuției pentru alte proiecte este o decizie separată și nu se face în această fază.</Notice></div>}
    </div>
  );
}

export default function Projects({ id }) {
  const { data, error, loading, reload } = useResource(id ? null : "/api/projects");
  const sync = useAction(async () => { await api("/api/projects/sync", { method: "POST", body: {} }); reload(); });
  if (id) return <ProjectDetail id={id} />;
  return (
    <div className="page">
      <div className="page-head"><div><h1>Proiecte</h1><p>Din registrul central PROJECTS.md (citit, nemodificat). Doar Ifrim Agent Hub este activat pentru execuție V2.</p></div><button className="btn" onClick={sync.run} disabled={sync.pending}>Resincronizează registrul</button></div>
      <ErrorNotice error={sync.error} />
      <Panel title="Proiecte" icon={FolderGit2} flush>
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
