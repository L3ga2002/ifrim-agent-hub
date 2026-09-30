import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Send, Paperclip, PanelRight, Play, ArrowRightLeft, FileText, GitBranch, History, Target, Globe, X, Folder, ChevronLeft, ShieldCheck } from "lucide-react";
import { api, fmt } from "../api.js";
import { useResource, useAction, usePref, onLive, useHub } from "../store.js";
import { Empty, Loading, ErrorNotice, StatusChip, Checks, DiffView, Notice, Chip } from "../components/ui.jsx";

const PROVIDERS = [{ id: "codex", label: "Codex" }, { id: "claude", label: "Claude Code" }];
const EFFORTS = ["", "low", "medium", "high", "xhigh", "max"];

function useLiveText(conversationId) {
  const [live, setLive] = useState({});
  useEffect(() => onLive((event) => {
    if (event.conversationId !== conversationId || event.type !== "run.delta") return;
    setLive((prev) => ({ ...prev, [event.runId]: (prev[event.runId] || "") + event.text }));
  }), [conversationId]);
  return live;
}

function Message({ m, liveText }) {
  const streaming = m.status === "streaming";
  const text = streaming && liveText && liveText.length > m.content.length ? liveText : m.content;
  const who = m.role === "user" ? "Tu" : m.role === "assistant" ? (m.provider === "codex" ? "Codex" : m.provider === "claude" ? "Claude Code" : "Asistent") : m.role === "note" ? "Notă" : m.role;
  return (
    <article className={`msg ${m.role} ${streaming ? "streaming" : ""} ${m.status}`} aria-label={`${who}, mesajul ${m.position}`}>
      <div className="who">
        <strong>{who}</strong>{m.model && <span className="mono">{m.model}</span>}<span>{fmt.time(m.createdAt)}</span>
        {m.status !== "final" && <StatusChip status={streaming ? "running" : m.status} />}
        {m.metadata?.preInference && <Chip tone="warn">eșec înainte de model</Chip>}
        {m.legacyId && <Chip>V1</Chip>}
      </div>
      <div className="bubble">{text || (streaming ? "" : <span className="muted">(fără conținut)</span>)}{streaming && <span className="cursor" aria-hidden="true" />}</div>
    </article>
  );
}

function Composer({ conversation, project, onSent }) {
  const draftKey = `draft:${conversation.id}`;
  const [draft, setDraft] = usePref(draftKey, "");
  const [provider, setProvider] = usePref("composer.provider", "codex");
  const [access, setAccess] = usePref("composer.access", "read-only");
  const [effort, setEffort] = usePref("composer.effort", "");
  const [model, setModel] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [refusal, setRefusal] = useState(null);
  const [preview, setPreview] = useState(null);
  const fileRef = useRef(null);
  const hub = useHub((s) => s.hub);
  const models = hub?.providers?.find((p) => p.id === provider)?.models || null;

  useEffect(() => {
    const voice = sessionStorage.getItem("hub.v2.voiceDraft");
    if (voice) { setDraft((d) => (d ? `${d}\n${voice}` : voice)); sessionStorage.removeItem("hub.v2.voiceDraft"); }
  }, [setDraft]);

  const upload = useAction(async (file) => {
    const base64 = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).split(",")[1]); r.onerror = reject; r.readAsDataURL(file); });
    const saved = await api(`/api/conversations/${conversation.id}/attachments`, { method: "POST", body: { filename: file.name, mime: file.type || "text/plain", base64 } });
    setAttachments((a) => [...a, saved]);
  });

  const send = useAction(async (andRun) => {
    setRefusal(null);
    const content = draft.trim();
    if (content) {
      await api(`/api/conversations/${conversation.id}/messages`, { method: "POST", body: { content, clientMessageId: `${conversation.id}:${Date.now()}`, attachmentIds: attachments.map((a) => a.id) } });
      setDraft(""); setAttachments([]);
    }
    if (andRun) {
      try {
        await api(`/api/conversations/${conversation.id}/runs`, { method: "POST", body: { provider, access, ...(model ? { model } : {}), ...(effort ? { effort } : {}), ...(conversation.activeTaskId ? { taskId: conversation.activeTaskId } : {}) } });
      } catch (error) {
        if (error.category === "gate") setRefusal(error.details?.checks || [{ id: "gate", ok: false, detail: error.message }]);
        else throw error;
      }
    }
    onSent();
  });

  const checkGate = useAction(async () => {
    setPreview(await api(`/api/gate/preview?provider=${provider}&access=${access}&projectId=${project.id}`));
  });

  return (
    <div className="composer">
      <label className="sr-only" htmlFor="composer-text">Mesaj</label>
      <textarea id="composer-text" className="textarea" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Scrie cererea. Ciorna se păstrează local până o trimiți."
        onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); send.run(false); } }} />
      {attachments.length > 0 && <div className="row wrap" style={{ marginTop: 6 }}>{attachments.map((a) => <span key={a.id} className="attachment"><Paperclip size={12} />{a.filename} · {fmt.bytes(a.size)}<button className="btn sm icon ghost" aria-label={`Elimină ${a.filename}`} onClick={() => setAttachments((l) => l.filter((x) => x.id !== a.id))}><X size={12} /></button></span>)}</div>}
      <div className="composer-bar">
        <input type="file" ref={fileRef} hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.run(f); e.target.value = ""; }} accept=".txt,.md,.json,.csv,.png,.jpg,.jpeg,.webp,.pdf" />
        <button className="btn sm icon ghost" onClick={() => fileRef.current?.click()} aria-label="Atașează fișier" disabled={upload.pending}><Paperclip size={16} /></button>
        <div className="seg" role="group" aria-label="Provider">
          {PROVIDERS.map((p) => <button key={p.id} aria-pressed={provider === p.id} onClick={() => setProvider(p.id)}>{p.label}</button>)}
        </div>
        <div className="seg" role="group" aria-label="Acces">
          <button aria-pressed={access === "read-only"} onClick={() => setAccess("read-only")}>Doar citire</button>
          <button aria-pressed={access === "workspace-write"} onClick={() => setAccess("workspace-write")}>Scriere</button>
        </div>
        {Array.isArray(models) && models.length ? (
          <select className="select" style={{ width: "auto", minHeight: 30 }} value={model} onChange={(e) => setModel(e.target.value)} aria-label="Model">
            <option value="">Model implicit</option>{models.map((m) => <option key={m.id} value={m.id}>{m.displayName}</option>)}
          </select>
        ) : <input className="input" style={{ width: 150, minHeight: 30 }} value={model} onChange={(e) => setModel(e.target.value.trim())} placeholder="Model (implicit)" aria-label="Model" />}
        <select className="select" style={{ width: "auto", minHeight: 30 }} value={effort} onChange={(e) => setEffort(e.target.value)} aria-label="Efort">
          {EFFORTS.map((e) => <option key={e} value={e}>{e ? `efort ${e}` : "efort implicit"}</option>)}
        </select>
        <div className="grow" />
        <button className="btn sm ghost" onClick={checkGate.run} disabled={checkGate.pending}><ShieldCheck size={14} />Verifică poarta</button>
        <button className="btn sm" onClick={() => send.run(false)} disabled={send.pending || !draft.trim()}><Send size={14} />Trimite<span className="kbd">Ctrl ↵</span></button>
        <button className="btn sm primary" onClick={() => send.run(true)} disabled={send.pending}><Play size={14} />{draft.trim() ? "Trimite și rulează" : "Rulează"}</button>
      </div>
      <ErrorNotice error={send.error || upload.error || checkGate.error} />
      {refusal && <div className="gate-refusal"><Notice tone="warn" title="Poarta a refuzat execuția; modelul nu a fost pornit"><Checks checks={refusal} /></Notice></div>}
      {preview && !refusal && (
        <div className="gate-refusal"><Notice tone={preview.allowed ? "info" : "warn"} title={preview.allowed ? "Poarta ar admite execuția" : "Poarta ar refuza execuția"}><Checks checks={preview.checks} /><button className="btn sm ghost" onClick={() => setPreview(null)}>Ascunde</button></Notice></div>
      )}
    </div>
  );
}

function FilesPanel({ project }) {
  const [dir, setDir] = useState(".");
  const [file, setFile] = useState(null);
  const list = useAction(async (path) => api(`/api/tools/files.list`, { method: "POST", body: { projectId: project.id, args: { path } } }));
  const read = useAction(async (path) => api(`/api/tools/files.read`, { method: "POST", body: { projectId: project.id, args: { path } } }));
  const [entries, setEntries] = useState(null);
  useEffect(() => { list.run(dir).then((r) => r && setEntries(r.entries)); }, [dir]); // eslint-disable-line react-hooks/exhaustive-deps
  if (file) return (
    <div className="stack">
      <button className="btn sm ghost" onClick={() => setFile(null)}><ChevronLeft size={14} />{dir}</button>
      <div className="row between"><strong className="mono ellipsis">{file.path}</strong><span className="faint">{fmt.bytes(file.size)}</span></div>
      <pre className="pre">{file.content}</pre>
    </div>
  );
  return (
    <div className="stack">
      <div className="row"><span className="mono ellipsis grow">{dir}</span>{dir !== "." && <button className="btn sm ghost" onClick={() => setDir(dir.split("/").slice(0, -1).join("/") || ".")}>Sus</button>}</div>
      <ErrorNotice error={list.error || read.error} />
      {!entries ? <Loading /> : (
        <ul className="list">{entries.map((e) => (
          <li key={e.name}><button className="list-row" onClick={async () => { const next = dir === "." ? e.name : `${dir}/${e.name}`; if (e.type === "dir") setDir(next); else { const r = await read.run(next); if (r) setFile(r); } }}>
            {e.type === "dir" ? <Folder size={15} color="var(--accent)" aria-hidden="true" /> : <FileText size={15} color="var(--text-2)" aria-hidden="true" />}<span className="ellipsis">{e.name}</span>
          </button></li>
        ))}</ul>
      )}
      <p className="faint" style={{ fontSize: 12, margin: 0 }}>Fișierele secrete, .git și .ifrim/private nu sunt expuse.</p>
    </div>
  );
}

function DiffPanel({ project }) {
  const diff = useAction(async () => api(`/api/tools/git.diff`, { method: "POST", body: { projectId: project.id } }));
  const status = useAction(async () => api(`/api/tools/git.status`, { method: "POST", body: { projectId: project.id } }));
  const [data, setData] = useState(null);
  const load = useCallback(async () => { const [d, s] = await Promise.all([diff.run(), status.run()]); setData({ d, s }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  return (
    <div className="stack">
      <div className="row between"><span className="muted">{data?.s ? `${data.s.branch} @ ${String(data.s.head).slice(0, 10)} · ${data.s.dirty.length} modificate · ${data.s.untracked.length} noi` : "…"}</span><button className="btn sm ghost" onClick={load}>Reîncarcă</button></div>
      <ErrorNotice error={diff.error} />
      {data?.d ? <DiffView diff={data.d.diff} /> : <Loading />}
      {data?.d?.truncated && <Notice tone="warn">Diff trunchiat; vezi restul local.</Notice>}
    </div>
  );
}

function RunsPanel({ runs }) {
  const [openRun, setOpenRun] = useState(null);
  const detail = useResource(openRun ? `/api/runs/${openRun}` : null, { reloadOn: (e) => e.runId === openRun, deps: [openRun] });
  if (!runs.length) return <Empty title="Nicio execuție">Execuțiile apar cu provider, model, backup, grant și categoria erorii.</Empty>;
  return (
    <div className="stack">
      <ul className="list">{runs.map((r) => (
        <li key={r.id}><button className="list-row" onClick={() => setOpenRun(openRun === r.id ? null : r.id)} aria-expanded={openRun === r.id}>
          <div className="grow"><div className="title">{r.provider} · {r.stage}{r.model ? ` · ${r.model}` : ""}</div><div className="sub">{fmt.dateTime(r.createdAt)}{r.errorCategory ? ` · ${r.errorCategory}` : ""}{r.preInference ? " · înainte de model" : ""}</div></div>
          <StatusChip status={r.status} />
        </button>
          {openRun === r.id && (
            <div className="panel-body stack tight">
              <dl className="kv">
                <dt>Run</dt><dd className="mono">{r.id}</dd>
                <dt>Sesiune nativă</dt><dd className="mono">{r.nativeThreadId || r.providerSessionId || "—"}</dd>
                <dt>Acces</dt><dd>{r.access}</dd>
                <dt>Backup</dt><dd className="mono">{r.backupId || "—"}</dd>
                <dt>Grant</dt><dd className="mono">{r.grantId || "—"}</dd>
                <dt>Versiune cod</dt><dd className="mono">{r.codeVersion ? r.codeVersion.slice(0, 12) : "—"}</dd>
                {r.errorMessage && <><dt>Eroare</dt><dd>{r.errorMessage}</dd></>}
                {r.usage?.tokens && <><dt>Tokens</dt><dd className="mono">{JSON.stringify(r.usage.tokens).slice(0, 200)}</dd></>}
                {r.usage?.note && <><dt>Notă cost</dt><dd>{r.usage.note}</dd></>}
                {r.evidence?.gate && <><dt>Poartă</dt><dd><Checks checks={r.evidence.gate.checks} /></dd></>}
              </dl>
              {detail.data?.events?.length > 0 && (
                <ul className="list" aria-label="Activitate">{detail.data.events.slice(-20).map((e) => (
                  <li key={e.seq}><div className="list-row" style={{ padding: "6px 0" }}><span className="faint mono nowrap">{fmt.time(e.createdAt)}</span><span className="ellipsis">{e.type.replace("run.", "")}{e.payload?.label ? `: ${e.payload.label}` : e.payload?.text ? `: ${e.payload.text}` : ""}</span></div></li>
                ))}</ul>
              )}
            </div>
          )}
        </li>
      ))}</ul>
    </div>
  );
}

function HandoffPanel({ conversation, handoffs, onChange }) {
  const [target, setTarget] = useState(conversation.writerProvider === "codex" ? "claude" : "codex");
  const begin = useAction(async () => { await api(`/api/conversations/${conversation.id}/handoffs`, { method: "POST", body: { toProvider: target } }); onChange(); });
  const act = useAction(async (id, action) => { await api(`/api/handoffs/${id}/${action}`, { method: "POST", body: {} }); onChange(); });
  const open = handoffs.find((h) => ["in_progress", "waiting", "ready"].includes(h.status));
  return (
    <div className="stack">
      <p className="muted" style={{ margin: 0 }}>Handoff verificabil: îngheață programarea, așteaptă un punct sigur, reconciliază, face checkpoint, construiește pachetul, transferă exclusivitatea de scriere. Pornirea providerului țintă trece prin poartă, iar confirmarea este verificată.</p>
      {!open && (
        <div className="row wrap">
          <div className="seg" role="group" aria-label="Provider țintă">{PROVIDERS.map((p) => <button key={p.id} aria-pressed={target === p.id} onClick={() => setTarget(p.id)}>{p.label}</button>)}</div>
          <button className="btn sm primary" onClick={begin.run} disabled={begin.pending}><ArrowRightLeft size={14} />Pregătește handoff</button>
        </div>
      )}
      <ErrorNotice error={begin.error || act.error} />
      {handoffs.map((h) => (
        <div key={h.id} className="panel">
          <div className="panel-head"><h3>{h.fromProvider} → {h.toProvider}</h3><StatusChip status={h.status} /></div>
          <div className="panel-body stack tight">
            <dl className="kv">
              <dt>Pas</dt><dd>{h.step}</dd>
              {h.error && <><dt>Motiv</dt><dd>{h.error}</dd></>}
              {h.packageSha256 && <><dt>Pachet</dt><dd className="mono">{h.packageSha256.slice(0, 16)}…</dd></>}
              {h.package?.objective && <><dt>Obiectiv</dt><dd>{h.package.objective}</dd></>}
              {h.package?.next_safe_action && <><dt>Următorul pas</dt><dd>{h.package.next_safe_action}</dd></>}
              {h.package?.branch && <><dt>Repo</dt><dd className="mono">{h.package.branch} @ {String(h.package.commit).slice(0, 10)} · {(h.package.untracked_manifest || []).length} fișiere noi</dd></>}
            </dl>
            <div className="row wrap">
              {h.status === "waiting" && <button className="btn sm" onClick={() => act.run(h.id, "advance")}>Reîncearcă pasul</button>}
              {["in_progress", "waiting", "ready"].includes(h.status) && <button className="btn sm ghost" onClick={() => act.run(h.id, "cancel")}>Anulează</button>}
              {h.status === "ready" && <span className="faint" style={{ fontSize: 12 }}>Rulează {h.toProvider} din compozitor; primul răspuns trebuie să confirme pachetul.</span>}
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
  const [shown, setShown] = useState(false);
  const check = useAction(async () => api(`/api/tools/preview.check`, { method: "POST", body: { projectId: project.id, args: { url } } }));
  const [result, setResult] = useState(null);
  return (
    <div className="stack">
      <label className="field"><span>URL local</span><input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://127.0.0.1:3004/" /></label>
      <div className="row"><button className="btn sm" onClick={async () => setResult(await check.run())} disabled={!url || check.pending}>Verifică</button><button className="btn sm ghost" onClick={() => setShown((s) => !s)} disabled={!url}>{shown ? "Ascunde" : "Afișează"} preview</button></div>
      <ErrorNotice error={check.error} />
      {result && <dl className="kv"><dt>Status</dt><dd>{result.status || result.error}</dd><dt>Latență</dt><dd>{result.latencyMs} ms</dd><dt>Titlu</dt><dd>{result.title || "—"}</dd></dl>}
      {shown && url && <iframe title="Preview local izolat" src={url} sandbox="allow-scripts allow-forms" referrerPolicy="no-referrer" style={{ width: "100%", height: 420, border: "1px solid var(--line)", borderRadius: 6, background: "#fff" }} />}
      <p className="faint" style={{ fontSize: 12, margin: 0 }}>Preview-ul rulează într-un iframe sandbox fără acces la sesiunea Hub-ului; doar URL-uri locale.</p>
    </div>
  );
}

function TaskPanel({ conversation }) {
  const mission = useResource(conversation.activeMissionId ? `/api/missions/${conversation.activeMissionId}` : null, { reloadOn: (e) => e.type.startsWith("task."), deps: [conversation.activeMissionId] });
  if (!conversation.activeMissionId) return <Empty title="Fără misiune legată">Conversațiile create dintr-o misiune arată aici taskurile, dependențele și criteriile.</Empty>;
  if (!mission.data) return <Loading />;
  const { mission: m, tasks, progress } = mission.data;
  return (
    <div className="stack">
      <div><strong>{m.title}</strong><p className="muted" style={{ margin: "4px 0 0" }}>{m.objective}</p></div>
      <div className="muted">{progress.completed}/{progress.total} taskuri finalizate</div>
      {m.acceptance?.length > 0 && <div><div className="section-title">Criterii</div><ul style={{ margin: 0, paddingLeft: 18 }}>{m.acceptance.map((a) => <li key={a}>{a}</li>)}</ul></div>}
      <ul className="list">{tasks.map((t) => <li key={t.id}><a className="list-row" href={`#/missions/${m.id}`}><div className="grow"><div className="title ellipsis">{t.title}</div><div className="sub">{t.roleId} · {t.stage}</div></div><StatusChip status={t.status} /></a></li>)}</ul>
    </div>
  );
}

export default function Focus({ id }) {
  const { data, error, loading, reload } = useResource(`/api/conversations/${id}`, {
    reloadOn: (e) => e.scopeId === id && (e.type.startsWith("message.") || e.type.startsWith("run.") || e.type.startsWith("handoff.") || e.type.startsWith("conversation.") || e.type === "attachment.added"),
  });
  const live = useLiveText(id);
  const [tab, setTab] = usePref("focus.tab", "runs");
  const narrow = typeof window !== "undefined" && window.matchMedia("(max-width: 1024px)").matches;
  const [sideHidden, setSideHidden] = usePref(narrow ? "focus.sideHidden.narrow" : "focus.sideHidden", narrow);
  const [width, setWidth] = usePref("focus.width", 420);
  const listRef = useRef(null);
  const messages = data?.messages || [];
  const lastLen = messages.length + Object.values(live).join("").length;
  useEffect(() => { const el = listRef.current; if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 240) el.scrollTop = el.scrollHeight; }, [lastLen]);

  const dragging = useRef(false);
  useEffect(() => {
    const move = (e) => { if (dragging.current) setWidth(Math.max(300, Math.min(760, window.innerWidth - e.clientX))); };
    const up = () => { dragging.current = false; document.body.style.userSelect = ""; };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  }, [setWidth]);

  const tabs = useMemo(() => [
    { id: "task", label: "Task", icon: Target }, { id: "files", label: "Fișiere", icon: FileText }, { id: "diff", label: "Diff", icon: GitBranch },
    { id: "runs", label: "Execuții", icon: History }, { id: "handoff", label: "Handoff", icon: ArrowRightLeft }, { id: "preview", label: "Preview", icon: Globe },
  ], []);

  if (loading) return <div className="page"><Loading lines={6} /></div>;
  if (error) return <div className="page"><ErrorNotice error={error} onRetry={reload} /></div>;
  const { conversation, project, runs, handoffs, sessions } = data;
  return (
    <div className={`focus ${sideHidden ? "side-hidden" : ""}`} style={{ "--side-w": `${width}px` }}>
      <section className="thread" aria-label="Conversație">
        <div className="thread-head">
          <a className="btn sm icon ghost" href="#/conversations" aria-label="Înapoi la conversații"><ChevronLeft size={16} /></a>
          <div className="grow">
            <h1 className="ellipsis">{conversation.title}</h1>
            <div className="faint" style={{ fontSize: 12 }}>{project?.name}{conversation.writerProvider ? ` · writer: ${conversation.writerProvider}` : ""}{sessions.length ? ` · ${sessions.length} sesiuni native` : ""}</div>
          </div>
          <button className="btn sm ghost" onClick={() => setSideHidden(!sideHidden)} aria-pressed={!sideHidden} aria-label="Panou contextual"><PanelRight size={16} /></button>
        </div>
        <div className="messages" ref={listRef} aria-live="polite">
          {messages.length ? messages.map((m) => <Message key={m.id} m={m} liveText={m.runId ? live[m.runId] : null} />) : <Empty title="Conversație nouă">Scrie cererea mai jos. „Rulează” trece prin poarta de execuție; în BUILD_SAFE nu pornește niciun model.</Empty>}
        </div>
        {project?.executionAllowed === false && <div style={{ padding: "0 20px" }}><Notice tone="info">Proiect doar pentru context: execuția V2 este activată numai pentru Ifrim Agent Hub în această fază.</Notice></div>}
        <Composer conversation={conversation} project={project} onSent={reload} />
      </section>
      <div className="splitter" role="separator" aria-orientation="vertical" aria-label="Redimensionează panoul" tabIndex={0} aria-valuenow={width} aria-valuemin={300} aria-valuemax={760}
        onPointerDown={() => { dragging.current = true; document.body.style.userSelect = "none"; }}
        onKeyDown={(e) => { if (e.key === "ArrowLeft") setWidth((w) => Math.min(760, w + 24)); if (e.key === "ArrowRight") setWidth((w) => Math.max(300, w - 24)); }} />
      <aside className="side" aria-label="Panou contextual">
        <div className="tabs" role="tablist">
          {tabs.map((t) => <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}><t.icon size={14} style={{ marginRight: 6, verticalAlign: -2 }} aria-hidden="true" />{t.label}</button>)}
          <button className="hide-desktop" onClick={() => setSideHidden(true)} aria-label="Închide panoul"><X size={14} /></button>
        </div>
        <div className="side-body" role="tabpanel">
          {tab === "task" && <TaskPanel conversation={conversation} />}
          {tab === "files" && project && <FilesPanel project={project} />}
          {tab === "diff" && project && <DiffPanel project={project} />}
          {tab === "runs" && <RunsPanel runs={runs} />}
          {tab === "handoff" && <HandoffPanel conversation={conversation} handoffs={handoffs} onChange={reload} />}
          {tab === "preview" && project && <PreviewPanel project={project} />}
        </div>
      </aside>
    </div>
  );
}
