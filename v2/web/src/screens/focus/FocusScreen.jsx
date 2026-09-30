import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { PanelRight, PanelLeft, PanelBottom, ChevronLeft, Search, Square, RotateCcw, ArrowDownToLine, MessageSquare, Plus, Terminal, Cpu, ScrollText, Lock } from "lucide-react";
import { api, fmt } from "../../api.js";
import { useResource, useAction, usePref, onLive, onHubEvent, useHub } from "../../store.js";
import { Empty, Loading, ErrorNotice, StatusChip, Notice, Chip, Checks } from "../../components/ui.jsx";
import { Markdown } from "../../components/Markdown.jsx";
import { Splitter, useViewport } from "../../components/Layout.jsx";
import { Core3D } from "../../components/core/Core3D.jsx";
import { deriveCoreState, CORE_VISUALS } from "../../lib/coreState.js";
import { fitLayout, DEFAULT_LAYOUT, errorStage } from "../../lib/uiLogic.js";
import { NewConversationDialog } from "../Conversations.jsx";
import { Composer } from "./Composer.jsx";
import { Inspector } from "./Inspector.jsx";

function useLiveText(conversationId) {
  const [live, setLive] = useState({});
  useEffect(() => { setLive({}); return onLive((event) => {
    if (event.conversationId !== conversationId || event.type !== "run.delta") return;
    setLive((prev) => ({ ...prev, [event.runId]: (prev[event.runId] || "") + event.text }));
  }); }, [conversationId]);
  return live;
}

/* ---------------- left: conversations ---------------- */
function ConversationList({ activeId, go }) {
  const { data, loading, error, reload } = useResource("/api/conversations", { reloadOn: (e) => e.type.startsWith("conversation.") || e.type === "message.created" });
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const groups = useMemo(() => {
    const list = (data?.conversations || []).filter((c) => !q.trim() || c.title.toLowerCase().includes(q.trim().toLowerCase()));
    const byProject = new Map();
    for (const c of list) { const key = c.projectName || c.projectId || "—"; if (!byProject.has(key)) byProject.set(key, []); byProject.get(key).push(c); }
    return [...byProject.entries()];
  }, [data, q]);
  return (
    <nav className="conv-list" aria-label="Conversații">
      <div className="conv-list-head">
        <label className="sr-only" htmlFor="conv-q">Caută conversații</label>
        <input id="conv-q" className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Caută…" />
        <button className="btn sm icon" onClick={() => setCreating(true)} aria-label="Conversație nouă"><Plus size={15} /></button>
      </div>
      <ErrorNotice error={error} onRetry={reload} />
      {loading ? <Loading /> : groups.length ? groups.map(([project, items]) => (
        <div key={project} className="conv-group">
          <div className="section-title">{project}</div>
          <ul className="list">{items.map((c) => (
            <li key={c.id}><a className={`list-row ${c.id === activeId ? "active" : ""}`} href={`#/conversations/${c.id}`} aria-current={c.id === activeId ? "page" : undefined}>
              <div className="grow"><div className="title ellipsis">{c.title}</div><div className="sub">{fmt.ago(c.updatedAt)}{c.writerProvider ? ` · ${c.writerProvider}` : ""}</div></div>
              {c.status !== "idle" && <StatusChip status={c.status === "running" ? "running" : c.status === "handoff" ? "in_progress" : c.status === "attention" ? "waiting" : c.status} />}
            </a></li>
          ))}</ul>
        </div>
      )) : <Empty title="Nicio conversație">Creează una pentru un proiect.</Empty>}
      {creating && <NewConversationDialog onClose={() => setCreating(false)} go={go} />}
    </nav>
  );
}

/* ---------------- center: thread ---------------- */
function RunEvents({ runId }) {
  const { data, loading } = useResource(`/api/runs/${runId}`, { reloadOn: (e) => e.runId === runId });
  if (loading) return <Loading lines={2} />;
  const events = data?.events || [];
  return events.length ? (
    <ul className="events-list">{events.slice(-40).map((e) => (
      <li key={e.seq}><span className="mono faint">{fmt.time(e.createdAt)}</span><span className="mono">{e.type}</span>{e.payload?.label && <span className="faint ellipsis">{e.payload.label}</span>}</li>
    ))}</ul>
  ) : <div className="faint small">Niciun eveniment tehnic.</div>;
}

function Message({ m, run, liveText, highlight, onRetry, isLastAssistant }) {
  const streaming = m.status === "streaming";
  const text = streaming && liveText && liveText.length > m.content.length ? liveText : m.content;
  const who = m.role === "user" ? "Tu" : m.role === "assistant" ? (m.provider === "codex" ? "Codex" : m.provider === "claude" ? "Claude Code" : "Asistent") : m.role === "note" ? "Notă" : m.role;
  const failed = ["failed", "blocked", "interrupted"].includes(m.status);
  return (
    <article id={`msg-${m.id}`} className={`msg ${m.role} ${streaming ? "streaming" : ""} ${m.status}`} aria-label={`${who}, mesajul ${m.position}`}>
      <div className="who">
        <strong>{who}</strong>{(run?.model || m.model) && <span className="mono">{run?.model || m.model}</span>}<span>{fmt.time(m.createdAt)}</span>
        {m.status !== "final" && <StatusChip status={streaming ? "running" : m.status} />}
        {run?.errorCategory && <Chip tone="error" title={run.errorMessage || ""}>{errorStage(run.errorCategory, { preInference: run.preInference })}</Chip>}
        {m.legacyId && <Chip>V1</Chip>}
      </div>
      <div className="bubble">
        {text ? <Markdown text={text} highlight={highlight} /> : (streaming ? <span className="faint">Aștept primul răspuns de la provider…</span> : <span className="muted">(fără conținut)</span>)}
        {streaming && <span className="cursor" aria-hidden="true" />}
      </div>
      {failed && run?.errorMessage && <div className="msg-error"><strong>{errorStage(run.errorCategory, { preInference: run.preInference })}:</strong> {run.errorMessage}</div>}
      {m.runId && (
        <details className="tech">
          <summary>Evenimente tehnice{run ? ` · ${run.provider} · ${run.status}` : ""}</summary>
          <RunEvents runId={m.runId} />
        </details>
      )}
      {failed && isLastAssistant && onRetry && <button className="btn sm" onClick={onRetry}><RotateCcw size={13} />Reîncearcă (trece din nou prin poartă)</button>}
    </article>
  );
}

function RunCard({ run }) {
  const checks = run.evidence?.gate?.checks?.filter((c) => !c.ok) || [];
  return (
    <article className={`msg run-card ${run.status}`} aria-label={`Execuție ${run.provider} ${run.status}`}>
      <div className="who"><strong>{run.provider === "codex" ? "Codex" : "Claude Code"}</strong><span>{fmt.time(run.createdAt)}</span><StatusChip status={run.status} />
        {run.errorCategory && <Chip tone="error">{errorStage(run.errorCategory, { preInference: run.preInference })}</Chip>}</div>
      <div className="bubble"><strong>{run.status === "blocked" ? "Execuția nu a pornit" : "Execuția s-a oprit înainte de răspuns"}</strong>{run.preInference ? " — niciun model nu a fost apelat." : ""}
        {checks.length ? <Checks checks={checks} /> : run.errorMessage ? <div className="small" style={{ marginTop: 6 }}>{run.errorMessage}</div> : null}</div>
    </article>
  );
}

function Thread({ data, reload, layoutControls, go }) {
  const { conversation, project, runs, handoffs, sessions } = data;
  const live = useLiveText(conversation.id);
  const hub = useHub((s) => s.hub);
  const [q, setQ] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [confirmRetry, setConfirmRetry] = useState(null);
  const [retryRefusal, setRetryRefusal] = useState(null);
  const listRef = useRef(null);
  const messages = data.messages || [];
  const runById = useMemo(() => Object.fromEntries((runs || []).map((r) => [r.id, r])), [runs]);
  const active = (hub?.activeRuns || []).filter((r) => r.conversationId === conversation.id);
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  const shown = q.trim().length >= 2 ? messages.filter((m) => m.content.toLowerCase().includes(q.trim().toLowerCase())) : messages;
  // Runs without an output message (stopped at the gate/policy before any provider output) join the timeline.
  const silentRuns = q.trim().length >= 2 ? [] : (runs || []).filter((r) => !r.outputMessageId && ["blocked", "failed"].includes(r.status));
  const timeline = [...shown.map((m) => ({ kind: "msg", at: m.createdAt, m })), ...silentRuns.map((r) => ({ kind: "run", at: r.createdAt, r }))].sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const liveLen = Object.values(live).join("").length;
  useEffect(() => { const el = listRef.current; if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 240) el.scrollTop = el.scrollHeight; }, [messages.length, liveLen]);

  const interrupt = useAction(async (runId) => api(`/api/runs/${runId}/interrupt`, { method: "POST", body: {} }));
  const retry = useAction(async () => {
    setRetryRefusal(null);
    const r = confirmRetry;
    setConfirmRetry(null);
    if (hub?.mode === "BUILD_SAFE") { setRetryRefusal((await api(`/api/gate/preview?provider=${r.provider}&access=${r.access}&projectId=${project.id}`)).checks); return; }
    try { await api(`/api/conversations/${conversation.id}/runs`, { method: "POST", body: { provider: r.provider, access: r.access, ...(r.model ? { model: r.model } : {}) } }); }
    catch (error) { if (error.category === "gate") setRetryRefusal(error.details?.checks || []); else throw error; }
    reload();
  });
  const jumpToResult = () => {
    const target = [...messages].reverse().find((m) => m.role === "assistant" && m.status === "final");
    if (target) document.getElementById(`msg-${target.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const openHandoff = handoffs.find((h) => ["in_progress", "waiting", "ready"].includes(h.status));
  const lastRun = lastAssistant?.runId ? runById[lastAssistant.runId] : null;

  return (
    <section className="thread m02" aria-label="Conversație">
      <div className="thread-head">
        <a className="btn sm icon ghost hide-desktop" href="#/conversations" aria-label="Înapoi la conversații"><ChevronLeft size={16} /></a>
        <div className="grow">
          <h1 className="ellipsis">{conversation.title}</h1>
          <div className="faint small ellipsis">{project?.name}{conversation.writerProvider ? ` · scrie: ${conversation.writerProvider}` : ""}{sessions.length ? ` · ${sessions.length} sesiuni native atașate` : ""}</div>
        </div>
        {openHandoff && <Chip tone={openHandoff.status === "waiting" ? "warn" : "info"} title={openHandoff.error || ""}>handoff {openHandoff.fromProvider}→{openHandoff.toProvider}: {openHandoff.step}</Chip>}
        <button className="btn sm icon ghost" onClick={() => setShowSearch((s) => !s)} aria-pressed={showSearch} aria-label="Caută în conversație"><Search size={16} /></button>
        <button className="btn sm icon ghost" onClick={jumpToResult} aria-label="Salt la ultimul rezultat"><ArrowDownToLine size={16} /></button>
        {layoutControls}
      </div>
      {showSearch && (
        <div className="thread-search"><label className="sr-only" htmlFor="thread-q">Caută în mesaje</label>
          <input id="thread-q" className="input" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Caută în mesaje (min. 2 caractere)" />
          <span className="faint small nowrap">{q.trim().length >= 2 ? `${shown.length} mesaje` : ""}</span></div>
      )}
      {active.length > 0 && (
        <div className="run-banner" role="status">
          <span className="pulse-dot" aria-hidden="true" />
          <span className="grow">{active.map((r) => `${r.provider === "codex" ? "Codex" : "Claude Code"}: ${r.phase === "streaming" ? "primește răspuns" : "așteaptă primul răspuns (nu este progres măsurat)"}`).join(" · ")}</span>
          {active.map((r) => <button key={r.runId} className="btn sm danger" disabled={interrupt.pending} onClick={() => interrupt.run(r.runId)}><Square size={12} fill="currentColor" />Stop</button>)}
        </div>
      )}
      <ErrorNotice error={interrupt.error} />
      <div className="messages" ref={listRef} aria-live="polite">
        {timeline.length ? timeline.map((item) => (item.kind === "run" ? <RunCard key={item.r.id} run={item.r} /> : (
          <Message key={item.m.id} m={item.m} run={item.m.runId ? runById[item.m.runId] : null} liveText={item.m.runId ? live[item.m.runId] : null} highlight={q.trim()}
            isLastAssistant={item.m === lastAssistant} onRetry={lastRun ? () => setConfirmRetry({ provider: lastRun.provider, access: lastRun.access, model: lastRun.model }) : null} />
        ))) : <Empty title={q ? "Nicio potrivire" : "Conversație nouă"}>{q ? "Încearcă alt text." : "Scrie cererea mai jos. În BUILD_SAFE poți redacta și salva; execuția cu model cere autorizare."}</Empty>}
      </div>
      {confirmRetry && (
        <Notice tone="warn" title="Reîncercare controlată">
          Pornește o execuție nouă cu {confirmRetry.provider} ({confirmRetry.access}{confirmRetry.model ? `, ${confirmRetry.model}` : ""}). Trece din nou prin poartă, grant și backup; nu repetă automat efecte externe.
          <div className="row" style={{ marginTop: 8 }}><button className="btn sm primary" disabled={retry.pending} onClick={retry.run}>Confirmă reîncercarea</button><button className="btn sm ghost" onClick={() => setConfirmRetry(null)}>Renunță</button></div>
        </Notice>
      )}
      {retryRefusal && <Notice tone="warn" title={hub?.mode === "BUILD_SAFE" ? "BUILD_SAFE: execuția necesită autorizare" : "Poarta a refuzat reîncercarea"}><Checks checks={retryRefusal} /></Notice>}
      <ErrorNotice error={retry.error} />
      {project?.executionAllowed === false && <Notice tone="info">Proiect doar pentru context: execuția V2 este activată numai pentru proiectele aprobate.</Notice>}
      <Composer conversation={conversation} project={project} handoffReady={openHandoff?.status === "ready"} onSent={reload} go={go} />
    </section>
  );
}

/* ---------------- bottom: output / processes / terminal ---------------- */
function BottomPanel({ conversationId, onClose }) {
  const [tab, setTab] = usePref("focus.bottomTab", "output");
  const hub = useHub((s) => s.hub);
  const [lines, setLines] = useState([]);
  useEffect(() => {
    setLines([]);
    const offLive = onLive((e) => { if (e.conversationId === conversationId && e.type === "run.delta") setLines((l) => [...l.slice(-800), { k: "text", v: e.text }]); });
    const offEv = onHubEvent((e) => { if (e.scopeId === conversationId && e.type.startsWith("run.")) setLines((l) => [...l.slice(-800), { k: "event", v: `${fmt.time(e.createdAt)} ${e.type}${e.payload?.label ? ` · ${e.payload.label}` : ""}` }]); });
    return () => { offLive(); offEv(); };
  }, [conversationId]);
  return (
    <section className="bottom-panel" aria-label="Output și procese">
      <div className="tabs" role="tablist">
        {[["output", "Output agent", ScrollText], ["processes", "Procese", Cpu], ["terminal", "Terminal", Terminal]].map(([id, l, Icon]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}><Icon size={13} aria-hidden="true" />{l}</button>
        ))}
        <div className="grow" />
        <button onClick={onClose} aria-label="Închide panoul de jos">×</button>
      </div>
      <div className="bottom-body" role="tabpanel">
        {tab === "output" && (lines.length ? <pre className="stream">{lines.map((l, i) => (l.k === "text" ? <span key={i}>{l.v}</span> : <span key={i} className="ev">{`\n${l.v}\n`}</span>))}</pre>
          : <div className="faint small">Output-ul agentului și evenimentele execuțiilor din această conversație apar aici în timp real (doar ce emite providerul).</div>)}
        {tab === "processes" && (hub?.processes?.length ? (
          <ul className="list">{hub.processes.map((p) => <li key={p.key || p.pid}><div className="list-row tight"><span className="mono">{p.label}</span><span className="faint mono">pid {p.pid}</span><span className="faint small">{fmt.ago(p.startedAt)}</span></div></li>)}</ul>
        ) : <div className="faint small">Niciun proces pornit de Hub. Procesele supravegheate (provideri, teste) apar aici și se opresc cu Stop All; nu sunt relansate la schimbarea tabului.</div>)}
        {tab === "terminal" && (
          <Notice tone="info" title="Terminal interactiv: neimplementat (intenționat)">
            Un terminal real ar cere transport autentificat, scope, autorizare și gestionarea procesului; nu îl deschidem ca portiță peste protecții. Folosește runner-ul de comenzi controlate (Inspector → Teste), cu aprobare pentru comanda exactă.
          </Notice>
        )}
      </div>
    </section>
  );
}

/* ---------------- screen ---------------- */
export default function FocusScreen({ id, go }) {
  const viewport = useViewport();
  const [stored, setStored] = usePref("focus.layout.v2", DEFAULT_LAYOUT);
  const layout = fitLayout(stored, viewport);
  const [tab, setTab] = usePref("focus.inspectorTab", "task");
  const [drawer, setDrawer] = useState(null); // compact: "left" | "right"
  const hub = useHub((s) => s.hub);
  const connection = useHub((s) => s.connection);
  const voicePhase = useHub((s) => s.voicePhase);
  const legaPhase = useHub((s) => s.legaPhase);
  const core = deriveCoreState({ hub, connection, voicePhase, legaPhase });
  const set = useCallback((patch) => setStored((s) => ({ ...DEFAULT_LAYOUT, ...s, ...patch })), [setStored]);
  const { data, error, loading, reload } = useResource(id ? `/api/conversations/${id}` : null, {
    reloadOn: (e) => e.scopeId === id && (e.type.startsWith("message.") || e.type.startsWith("run.") || e.type.startsWith("handoff.") || e.type.startsWith("conversation.") || e.type === "attachment.added"), deps: [id],
  });
  useEffect(() => { setDrawer(null); }, [id]);

  const controls = (
    <>
      <button className="btn sm icon ghost" onClick={() => (layout.compact ? setDrawer(drawer === "left" ? null : "left") : set({ showLeft: !layout.showLeft }))} aria-pressed={layout.compact ? drawer === "left" : layout.showLeft} aria-label="Lista de conversații"><PanelLeft size={16} /></button>
      <button className="btn sm icon ghost hide-mobile" onClick={() => set({ showBottom: !stored.showBottom })} aria-pressed={Boolean(stored.showBottom)} aria-label="Panoul de output și procese"><PanelBottom size={16} /></button>
      <button className="btn sm icon ghost" onClick={() => (layout.compact ? setDrawer(drawer === "right" ? null : "right") : set({ showRight: !layout.showRight }))} aria-pressed={layout.compact ? drawer === "right" : layout.showRight} aria-label="Inspector"><PanelRight size={16} /></button>
      <span className="focus-core" title={`${core.label}: ${core.reason}`}><Core3D state={core.state} compact /><span className="sr-only">{core.label}</span></span>
    </>
  );

  const center = !id ? (
    <section className="thread m02 empty-center" aria-label="Conversație">
      <div className="thread-head"><div className="grow"><h1>Focus</h1><div className="faint small">Alege o conversație din stânga sau creează una nouă.</div></div>{controls}</div>
      <div className="messages"><Empty title="Nicio conversație deschisă" action={layout.compact ? <button className="btn sm" onClick={() => setDrawer("left")}><MessageSquare size={14} />Conversații</button> : null}>Conversația, inspectorul și panoul de output rămân în starea lor când treci între Control Room și Focus.</Empty></div>
    </section>
  ) : loading && !data ? <section className="thread m02"><Loading lines={6} /></section>
    : error ? <section className="thread m02"><ErrorNotice error={error} onRetry={reload} /></section>
      : <Thread data={data} reload={reload} layoutControls={controls} go={go} />;

  const showLeft = !layout.compact && layout.showLeft;
  const showRight = !layout.compact && layout.showRight && data;
  const pendingApprovals = hub?.pendingApprovals || 0;
  const cols = [showLeft ? `${layout.left}px` : null, showLeft ? "6px" : null, "minmax(360px, 1fr)", showRight ? "6px" : null, showRight ? `${layout.right}px` : null].filter(Boolean).join(" ");
  const showBottom = Boolean(stored.showBottom) && !layout.compact && id;

  return (
    <div className="focus-v2" style={{ gridTemplateColumns: cols, gridTemplateRows: showBottom ? `1fr 6px ${layout.bottom}px` : "1fr" }}>
      {showLeft && <ConversationList activeId={id} go={go} />}
      {showLeft && <Splitter value={layout.left} min={200} max={420} onChange={(v) => set({ left: v })} label="Lățimea listei de conversații" />}
      {center}
      {showRight && <Splitter value={layout.right} min={300} max={760} invert onChange={(v) => set({ right: v })} label="Lățimea inspectorului" />}
      {showRight && <Inspector tab={tab} setTab={setTab} conversation={data.conversation} project={data.project} runs={data.runs} handoffs={data.handoffs} reload={reload} go={go} pendingApprovals={pendingApprovals} />}
      {showBottom && <div className="bottom-split" style={{ gridColumn: "1 / -1" }}><Splitter orientation="horizontal" value={layout.bottom} min={140} max={520} invert onChange={(v) => set({ bottom: v })} label="Înălțimea panoului de jos" /></div>}
      {showBottom && <div style={{ gridColumn: "1 / -1", minHeight: 0 }}><BottomPanel conversationId={id} onClose={() => set({ showBottom: false })} /></div>}
      {layout.compact && drawer && (
        <div className="drawer-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setDrawer(null); }}>
          <div className={`drawer-panel ${drawer}`}>
            {drawer === "left" ? <ConversationList activeId={id} go={go} /> : data ? <Inspector tab={tab} setTab={setTab} conversation={data.conversation} project={data.project} runs={data.runs} handoffs={data.handoffs} reload={reload} go={go} pendingApprovals={pendingApprovals} onClose={() => setDrawer(null)} /> : null}
          </div>
        </div>
      )}
      {!hub && <div className="sr-only"><Lock /></div>}
    </div>
  );
}
