import { useCallback, useEffect, useMemo, useState } from "react";
import { FileText, GitBranch, History, Target, Globe, ArrowRightLeft, Folder, ChevronLeft, ShieldCheck, FlaskConical, Search, ExternalLink, X } from "lucide-react";
import { api, fmt } from "../../api.js";
import { useResource, useAction, usePref } from "../../store.js";
import { Empty, Loading, ErrorNotice, StatusChip, Checks, DiffView, Notice, Chip } from "../../components/ui.jsx";
import { ApprovalCard } from "../Approvals.jsx";
import { errorStage, missionProgress, formatMs } from "../../lib/uiLogic.js";

const tool = (id, projectId, args) => api(`/api/tools/${id}`, { method: "POST", body: { projectId, args } });

function FilesPanel({ project }) {
  const [dir, setDir] = useState(".");
  const [file, setFile] = useState(null);
  const [entries, setEntries] = useState(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null);
  const list = useAction(async (p) => tool("files.list", project.id, { path: p }));
  const read = useAction(async (p, offset = 0) => tool("files.read", project.id, { path: p, offset }));
  const search = useAction(async (q) => tool("files.search", project.id, { query: q, maxResults: 100 }));
  useEffect(() => { let off = false; list.run(dir).then((r) => { if (r && !off) setEntries(r.entries); }); return () => { off = true; }; }, [dir]); // eslint-disable-line react-hooks/exhaustive-deps
  const open = async (p) => { const r = await read.run(p); if (r) setFile(r); };
  const more = async () => { const r = await read.run(file.path, file.nextOffset); if (r) setFile({ ...r, content: file.content + r.content }); };
  if (file) return (
    <div className="stack">
      <button className="btn sm ghost" onClick={() => setFile(null)}><ChevronLeft size={14} />{results ? "Rezultate" : dir}</button>
      <div className="row between"><strong className="mono ellipsis">{file.path}</strong><span className="faint nowrap">{fmt.bytes(file.size)}</span></div>
      <pre className="pre file-view">{file.content}</pre>
      {file.nextOffset !== null && file.nextOffset !== undefined && <button className="btn sm" onClick={more} disabled={read.pending}>Încarcă următoarea pagină ({fmt.bytes(file.size - file.nextOffset)} rămase)</button>}
      <ErrorNotice error={read.error} />
    </div>
  );
  return (
    <div className="stack">
      <form className="row" onSubmit={async (e) => { e.preventDefault(); if (query.trim().length >= 2) setResults(await search.run(query.trim())); }}>
        <label className="sr-only" htmlFor="file-search">Caută în fișiere</label>
        <input id="file-search" className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Caută text în proiect…" />
        <button className="btn sm" disabled={search.pending || query.trim().length < 2}><Search size={14} />Caută</button>
        {results && <button type="button" className="btn sm icon ghost" aria-label="Închide rezultatele" onClick={() => setResults(null)}><X size={14} /></button>}
      </form>
      <ErrorNotice error={list.error || search.error} />
      {results ? (
        <div className="stack tight">
          <div className="faint small">{results.matches.length} potriviri în {results.scanned} fișiere{results.truncated ? " (limitat)" : ""} · {results.skipped} sărite (protejate, binare, mari)</div>
          <ul className="list">{results.matches.map((m, i) => (
            <li key={`${m.path}:${m.line}:${i}`}><button className="list-row" onClick={() => open(m.path)}>
              <FileText size={14} aria-hidden="true" /><div className="grow"><div className="title mono ellipsis">{m.path}:{m.line}</div><div className="sub mono ellipsis">{m.text}</div></div>
            </button></li>
          ))}</ul>
        </div>
      ) : (
        <>
          <div className="row"><span className="mono ellipsis grow">{dir}</span>{dir !== "." && <button className="btn sm ghost" onClick={() => setDir(dir.split("/").slice(0, -1).join("/") || ".")}>Sus</button>}</div>
          {!entries ? <Loading /> : (
            <ul className="list">{entries.map((e) => (
              <li key={e.name}><button className="list-row" onClick={() => { const next = dir === "." ? e.name : `${dir}/${e.name}`; if (e.type === "dir") setDir(next); else open(next); }}>
                {e.type === "dir" ? <Folder size={15} color="var(--accent)" aria-hidden="true" /> : <FileText size={15} color="var(--text-2)" aria-hidden="true" />}<span className="ellipsis">{e.name}</span>
              </button></li>
            ))}</ul>
          )}
        </>
      )}
      <p className="faint small" style={{ margin: 0 }}>Serverul refuză .ifrim/private, backup-urile, .ifrim/tmp, .git și fișierele de tip secret, inclusiv prin junction/symlink. Fișierele mari se citesc pe pagini.</p>
    </div>
  );
}

function DiffPanel({ project }) {
  const [data, setData] = useState(null);
  const diff = useAction(async () => tool("git.diff", project.id, {}));
  const status = useAction(async () => tool("git.status", project.id, {}));
  const load = useCallback(async () => { const [d, s] = await Promise.all([diff.run(), status.run()]); setData({ d, s }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  return (
    <div className="stack">
      <div className="row between"><span className="muted small">{data?.s ? `${data.s.branch} @ ${String(data.s.head).slice(0, 10)} · ${data.s.dirty.length} modificate · ${data.s.untracked.length} noi` : "…"}</span><button className="btn sm ghost" onClick={load}>Reîncarcă</button></div>
      <ErrorNotice error={diff.error || status.error} />
      {data?.d ? (data.d.diff ? <DiffView diff={data.d.diff} /> : <Empty title="Fără modificări">Arborele de lucru este curat față de HEAD.</Empty>) : <Loading />}
      {data?.d?.truncated && <Notice tone="warn">Diff trunchiat; restul se vede local.</Notice>}
    </div>
  );
}

function TestsPanel({ project, go }) {
  const { data, error, loading, reload } = useResource("/api/tool-calls?limit=30", { reloadOn: (e) => e.type.startsWith("tool.") });
  const request = useAction(async (script) => tool("process.run", project.id, { script }));
  const [asked, setAsked] = useState(null);
  const runs = (data?.calls || []).filter((c) => ["process.test", "process.build"].includes(c.tool));
  return (
    <div className="stack">
      <div className="row wrap">
        {project.executionAllowed ? ["test:v2", "test"].map((s) => <button key={s} className="btn sm" disabled={request.pending} onClick={async () => { const r = await request.run(s); if (r) setAsked(r.approval); }}><FlaskConical size={14} />Cere rulare npm run {s}</button>)
          : <span className="faint small">Proiect doar pentru context: rularea locală nu este activată.</span>}
      </div>
      {asked && <Notice tone="approval" title="Aprobare creată pentru comanda exactă">Aprob-o în tabul Aprobări sau pe ecranul Aprobări, apoi rulează. <button className="btn sm" onClick={() => go("/approvals")}>Aprobări</button></Notice>}
      <ErrorNotice error={error || request.error} />
      {loading ? <Loading /> : runs.length ? (
        <ul className="list">{runs.map((c) => (
          <li key={c.id}><details className="list-row block">
            <summary className="row">
              <StatusChip status={c.status === "completed" ? (c.result?.exitCode === 0 ? "completed" : "failed") : c.status} label={c.result?.exitCode === undefined ? undefined : `exit ${c.result.exitCode}`} />
              <span className="mono grow ellipsis">{c.result?.command || c.args?.script}</span>
              <span className="faint nowrap small">{fmt.dateTime(c.startedAt)} · {c.result?.durationMs ? `${Math.round(c.result.durationMs / 1000)} s` : "—"}</span>
            </summary>
            {c.result?.summary?.length > 0 && <ul className="plain-list small">{c.result.summary.map((l, i) => <li key={i} className="mono">{l}</li>)}</ul>}
            {c.result?.outputTail?.length > 0 && <pre className="pre small">{c.result.outputTail.join("\n")}</pre>}
          </details></li>
        ))}</ul>
      ) : <Empty title="Niciun proces de test rulat">Rezultatele apar cu momentul, comanda, codul de ieșire și finalul output-ului. Aceasta este o zonă de rezultate, nu un terminal.</Empty>}
      <button className="btn sm ghost" onClick={reload}>Reîncarcă</button>
    </div>
  );
}

function ApprovalsPanel() {
  const { data, error, loading, reload } = useResource("/api/approvals?status=pending", { reloadOn: (e) => e.type.startsWith("approval.") });
  if (loading) return <Loading />;
  const list = data?.approvals || [];
  return (
    <div className="stack">
      <ErrorNotice error={error} onRetry={reload} />
      {list.length ? list.map((a) => <ApprovalCard key={a.id} approval={a} onDone={reload} />) : <Empty title="Nimic de aprobat">Cererile apar cu acțiunea exactă, ținta și expirarea. Vocea nu poate aproba.</Empty>}
    </div>
  );
}

function RunsPanel({ runs }) {
  const [openRun, setOpenRun] = useState(null);
  const detail = useResource(openRun ? `/api/runs/${openRun}` : null, { reloadOn: (e) => e.runId === openRun, deps: [openRun] });
  if (!runs.length) return <Empty title="Nicio execuție">Execuțiile apar cu provider, model, backup, grant și etapa în care s-au oprit.</Empty>;
  return (
    <ul className="list">{runs.map((r) => (
      <li key={r.id}>
        <button className="list-row" onClick={() => setOpenRun(openRun === r.id ? null : r.id)} aria-expanded={openRun === r.id}>
          <div className="grow"><div className="title">{r.provider === "codex" ? "Codex" : "Claude Code"} · {r.stage}{r.model ? ` · ${r.model}` : ""}</div>
            <div className="sub">{fmt.dateTime(r.createdAt)}{r.errorCategory ? ` · ${errorStage(r.errorCategory, { preInference: r.preInference })}` : ""}</div></div>
          <StatusChip status={r.status} />
        </button>
        {openRun === r.id && (
          <div className="panel-body stack tight">
            <dl className="kv">
              <dt>Run</dt><dd className="mono">{r.id}</dd>
              <dt>Sesiune nativă</dt><dd className="mono">{r.nativeThreadId || r.providerSessionId || "—"}</dd>
              <dt>Acces</dt><dd>{r.access}</dd><dt>Backup</dt><dd className="mono">{r.backupId || "—"}</dd><dt>Grant</dt><dd className="mono">{r.grantId || "—"}</dd>
              {r.errorMessage && <><dt>Eroare</dt><dd>{r.errorMessage}</dd></>}
              {r.evidence?.gate && <><dt>Poartă</dt><dd><Checks checks={r.evidence.gate.checks} /></dd></>}
            </dl>
            {r.plan?.effort && <div className="small">Model <span className="mono">{r.plan.model || "implicit"}</span> ({r.plan.modelSource || "—"}) · efort <span className="mono">{r.plan.effort}</span> ({r.plan.effortSource}){r.plan.reported?.effort ? ` · raportat de provider: ${r.plan.reported.effort}` : ""}</div>}
            {detail.data?.timeline?.segments?.length > 0 && (
              <div className="stack tight" aria-label="Timpul pe faze">
                <div className="faint small">Admitere Hub {formatMs(detail.data.timeline.keySpans.hubAdmissionMs)} · turn → prima comandă {formatMs(detail.data.timeline.keySpans.turnToFirstCommandMs)} · prima comandă {formatMs(detail.data.timeline.keySpans.firstCommandExecutionMs)} · total {formatMs(detail.data.timeline.keySpans.totalMs)}</div>
                <ul className="plain-list small">{detail.data.timeline.segments.map((s) => <li key={`${s.from}-${s.to}`}><span className="mono">{formatMs(s.ms)}</span> · {s.label} <span className="faint">({s.owner})</span></li>)}</ul>
              </div>
            )}
            {detail.data?.telemetry && <div className="faint small">Telemetrie: {Object.entries(detail.data.telemetry.sources || {}).map(([k, v]) => `${k}=${v}`).join(" · ") || "—"}</div>}
            {detail.data?.events?.length > 0 && (
              <ul className="list" aria-label="Evenimente tehnice">{detail.data.events.slice(-30).map((e) => (
                <li key={e.seq}><div className="list-row tight"><span className="faint mono nowrap">{fmt.time(e.createdAt)}</span><span className="ellipsis mono small">{e.type.replace("run.", "")}{e.payload?.label ? `: ${e.payload.label}` : ""}</span></div></li>
              ))}</ul>
            )}
          </div>
        )}
      </li>
    ))}</ul>
  );
}

const HANDOFF_STEPS = [["frozen", "Înghețat"], ["safe_point", "Punct sigur"], ["reconciled", "Reconciliat"], ["checkpointed", "Checkpoint"], ["packaged", "Pachet"],
  ["writer_transferred", "Scriere transferată"], ["ready", "Pregătit"], ["acknowledged", "Confirmat de țintă"], ["continued", "Preluat"]];

function HandoffSteps({ h }) {
  const at = HANDOFF_STEPS.findIndex(([id]) => id === h.step);
  return (
    <ol className="stepper" aria-label="Pașii handoff-ului">
      {HANDOFF_STEPS.map(([id, label], i) => {
        const state = h.status === "cancelled" ? "off" : i < at || (i === at && ["completed", "ready"].includes(h.status)) ? "done" : i === at ? (h.status === "waiting" ? "blocked" : "current") : "todo";
        return <li key={id} className={state}><span className="dot" aria-hidden="true" /><span>{label}</span>{state === "blocked" && <span className="sr-only"> (blocat)</span>}</li>;
      })}
    </ol>
  );
}

function HandoffPanel({ conversation, handoffs, onChange }) {
  const [target, setTarget] = useState(conversation.writerProvider === "codex" ? "claude" : "codex");
  const begin = useAction(async () => { await api(`/api/conversations/${conversation.id}/handoffs`, { method: "POST", body: { toProvider: target } }); onChange(); });
  const act = useAction(async (id, action) => { await api(`/api/handoffs/${id}/${action}`, { method: "POST", body: {} }); onChange(); });
  const open = handoffs.find((h) => ["in_progress", "waiting", "ready"].includes(h.status));
  return (
    <div className="stack">
      <p className="muted small" style={{ margin: 0 }}>Handoff verificabil, nu un simplu selector: îngheață, așteaptă un punct sigur, reconciliază, face checkpoint Hub (cu referințele sesiunilor native), construiește pachetul și transferă scrierea. Primul răspuns al țintei trebuie să confirme pachetul.</p>
      {!open && (
        <div className="row wrap">
          <div className="seg" role="group" aria-label="Provider țintă">{[["codex", "Codex"], ["claude", "Claude Code"]].map(([id, l]) => <button key={id} aria-pressed={target === id} onClick={() => setTarget(id)}>{l}</button>)}</div>
          <button className="btn sm primary" onClick={begin.run} disabled={begin.pending}><ArrowRightLeft size={14} />Pregătește handoff</button>
        </div>
      )}
      <ErrorNotice error={begin.error || act.error} />
      {handoffs.map((h) => (
        <div key={h.id} className="panel">
          <div className="panel-head"><h3>{h.fromProvider} → {h.toProvider}</h3><StatusChip status={h.status} /></div>
          <div className="panel-body stack tight">
            <HandoffSteps h={h} />
            <dl className="kv">
              {h.error && <><dt>Blocaj</dt><dd>{h.error}</dd></>}
              {h.checkpointId && <><dt>Checkpoint</dt><dd className="mono">{h.checkpointId}</dd></>}
              {h.packageSha256 && <><dt>Pachet</dt><dd className="mono">{h.packageSha256.slice(0, 16)}…</dd></>}
              {h.package?.native_checkpoint_refs?.length > 0 && <><dt>Referințe native</dt><dd className="mono small">{h.package.native_checkpoint_refs.map((r) => r.ref || r.id || JSON.stringify(r)).join(", ")}</dd></>}
              {h.package?.next_safe_action && <><dt>Următorul pas</dt><dd>{h.package.next_safe_action}</dd></>}
            </dl>
            <div className="row wrap">
              {h.status === "waiting" && <button className="btn sm" onClick={() => act.run(h.id, "advance")}>Reîncearcă pasul</button>}
              {["in_progress", "waiting", "ready"].includes(h.status) && <button className="btn sm ghost" onClick={() => act.run(h.id, "cancel")}>Anulează</button>}
              {h.status === "ready" && <span className="faint small">Rulează {h.toProvider} din compozitor; răspunsul trebuie să înceapă cu linia de confirmare.</span>}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function PreviewPanel({ project }) {
  const urls = [project.frontendUrl, project.backendUrl].filter((u) => /^http:\/\/(127\.0\.0\.1|localhost)/.test(u || ""));
  const [url, setUrl] = useState(urls[0] || "");
  const [mode, setMode] = usePref("preview.mode", "check");
  const [result, setResult] = useState(null);
  const check = useAction(async () => tool("preview.check", project.id, { url }));
  const browser = useResource("/api/browser/status");
  const askBrowser = useAction(async () => tool("browser.inspect", project.id, { url }));
  return (
    <div className="stack">
      <label className="field"><span>URL local</span><input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://127.0.0.1:3004/" /></label>
      <div className="seg wrap" role="group" aria-label="Mod preview">
        {[["check", "Verificare HTTP"], ["frame", "Preview izolat"], ["browser", "Browser controlat"], ["link", "Link extern"]].map(([id, l]) => <button key={id} aria-pressed={mode === id} onClick={() => setMode(id)}>{l}</button>)}
      </div>
      {mode === "check" && (<>
        <button className="btn sm" onClick={async () => setResult(await check.run())} disabled={!url || check.pending}>Verifică</button>
        {result && <dl className="kv"><dt>Status</dt><dd>{result.status || result.error}</dd><dt>Latență</dt><dd>{result.latencyMs} ms</dd><dt>Titlu</dt><dd>{result.title || "—"}</dd></dl>}
      </>)}
      {mode === "frame" && url && (<>
        <iframe title="Preview local izolat" src={url} sandbox="allow-scripts allow-forms" referrerPolicy="no-referrer" className="preview-frame" />
        <p className="faint small" style={{ margin: 0 }}>Iframe sandbox fără same-origin: pagina nu vede sesiunea Hub. Unele pagini refuză afișarea în iframe; protecțiile browserului nu sunt dezactivate.</p>
      </>)}
      {mode === "browser" && (
        browser.data?.installed ? (
          <button className="btn sm" disabled={!url || askBrowser.pending} onClick={askBrowser.run}>Cere aprobare pentru inspecția acestui URL</button>
        ) : (
          <Notice tone="warn" title="Browser controlat: NEEDS_INSTALL_APPROVAL">
            {browser.data?.reason || "Playwright nu este instalat."} Nu se raportează nicio captură sau test E2E fără o rulare reală.
            {browser.data?.approvalRequest && <dl className="kv compact" style={{ marginTop: 8 }}><dt>Ce</dt><dd>{browser.data.approvalRequest.what}</dd><dt>Browsere</dt><dd>{browser.data.approvalRequest.browsers}</dd><dt>Licență</dt><dd>{browser.data.approvalRequest.license}</dd></dl>}
            {browser.data?.cachedBrowsers?.length > 0 && <div className="faint small">Chromium deja prezent local: {browser.data.cachedBrowsers.join(", ")}</div>}
          </Notice>
        )
      )}
      {mode === "link" && url && <a className="btn sm" href={url} target="_blank" rel="noreferrer noopener"><ExternalLink size={14} />Deschide în browserul tău</a>}
      <ErrorNotice error={check.error || askBrowser.error} />
    </div>
  );
}

function TaskPanel({ conversation }) {
  const mission = useResource(conversation.activeMissionId ? `/api/missions/${conversation.activeMissionId}` : null, { reloadOn: (e) => e.type.startsWith("task.") || e.type.startsWith("mission."), deps: [conversation.activeMissionId] });
  if (!conversation.activeMissionId) return <Empty title="Fără misiune legată">Conversațiile create dintr-o misiune arată aici taskurile, criteriile și dovezile.</Empty>;
  if (!mission.data) return <Loading />;
  const { mission: m, tasks } = mission.data;
  const p = missionProgress(tasks);
  return (
    <div className="stack">
      <div><strong>{m.title}</strong><p className="muted" style={{ margin: "4px 0 0" }}>{m.objective}</p></div>
      <div className="muted small">{p.completed}/{p.total} taskuri finalizate{p.blocked ? ` · ${p.blocked} blocate` : ""}{p.waitingApproval ? ` · ${p.waitingApproval} așteaptă aprobare` : ""}</div>
      {m.acceptance?.length > 0 && <div><div className="section-title">Criterii de acceptanță</div><ul className="plain-list">{m.acceptance.map((a) => <li key={a}>{a}</li>)}</ul></div>}
      <ul className="list">{tasks.map((t) => <li key={t.id}><a className="list-row" href={`#/missions/${m.id}?task=${t.id}`}><div className="grow"><div className="title ellipsis">{t.title}</div><div className="sub">{t.roleId} · {t.stage}{t.statusReason ? ` · ${t.statusReason}` : ""}</div></div><StatusChip status={t.status} /></a></li>)}</ul>
    </div>
  );
}

export const INSPECTOR_TABS = [
  { id: "task", label: "Task", icon: Target }, { id: "diff", label: "Diff", icon: GitBranch }, { id: "files", label: "Fișiere", icon: FileText },
  { id: "tests", label: "Teste", icon: FlaskConical }, { id: "approvals", label: "Aprobări", icon: ShieldCheck }, { id: "runs", label: "Execuții", icon: History },
  { id: "handoff", label: "Handoff", icon: ArrowRightLeft }, { id: "preview", label: "Preview", icon: Globe },
];

export function Inspector({ tab, setTab, conversation, project, runs, handoffs, reload, go, pendingApprovals = 0, onClose }) {
  const tabs = useMemo(() => INSPECTOR_TABS, []);
  return (
    <aside className="inspector" aria-label="Inspector">
      <div className="tabs scroll" role="tablist" aria-label="Inspector">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
            <t.icon size={14} aria-hidden="true" />{t.label}{t.id === "approvals" && pendingApprovals > 0 && <span className="badge">{pendingApprovals}</span>}
          </button>
        ))}
        {onClose && <button onClick={onClose} aria-label="Închide inspectorul"><X size={14} /></button>}
      </div>
      <div className="inspector-body" role="tabpanel">
        {tab === "task" && <TaskPanel conversation={conversation} />}
        {tab === "diff" && project && <DiffPanel project={project} />}
        {tab === "files" && project && <FilesPanel project={project} />}
        {tab === "tests" && project && <TestsPanel project={project} go={go} />}
        {tab === "approvals" && <ApprovalsPanel />}
        {tab === "runs" && <RunsPanel runs={runs} />}
        {tab === "handoff" && <HandoffPanel conversation={conversation} handoffs={handoffs} onChange={reload} />}
        {tab === "preview" && project && <PreviewPanel project={project} />}
      </div>
    </aside>
  );
}

export { Chip };
