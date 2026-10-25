import { looksLikeConfirmation } from "../lib/voiceContext.js";
import { useEffect, useRef, useState } from "react";
import { api, serverInfo, onServerInfo } from "../api.js";
import { useHub, getState, setState, usePref, onHubEvent, onLive } from "../store.js";
import { VIEWS, VIEW_LABELS, VIEW_OF_QUERY, idleFigures, freshness, keyAction, sheetReturn, scheduleCommandRead, newDecisionNotice, lastSentence } from "../lib/commandModel.js";
import { bucharestParts } from "../lib/roText.js";
import { openCommandChannel } from "../lib/commandSync.js";
import { carousel, DEPT_CODES, departmentStyle } from "../lib/companyGraph.js";
import { conversationOf, withConversation, exchangeProject } from "../lib/legaConversation.js";
import { screenActivity } from "../lib/legaOneScreen.js";
import { replyFor } from "../lib/cockpitLogic.js";
import { deriveCoreState } from "../lib/coreState.js";
import { sendLegaCommand } from "../lib/legaLevels.js";
import { LegaFace } from "../components/face/LegaFace.jsx";
import { StopAllButton } from "../shell/Shell.jsx";
import { applyCommandResult, cacheRecap, setCommand, recapContext, controlRecap, presentRecap, useRecapVisibility } from "../shell/CommandBridge.jsx";
import { useVoiceCaption } from "./stage/LegaStage.jsx";
import { Indicator, RecapText, useRead, ReadContext, useVisibleClock } from "./command/Recap.jsx";
import { CompanyGraph, Department, DepartmentCounts } from "./command/Company.jsx";
import Sheet from "./command/Sheet.jsx";
import Funnel from "./command/Funnel.jsx";
import Trace from "./command/Trace.jsx";
import Result from "./command/Result.jsx";
import SystemMap from "./command/SystemMap.jsx";
const EMPTY = Object.freeze({ view: "idle" });
function Clock() { const time = bucharestParts(useVisibleClock()); return <><time className="command-clock">{time.time}</time><p className="command-date">{time.weekday}, {time.date}</p></>; }
function ViewStatus({ snapshot, connection, seq, restarted, noticeUntil, error, display }) {
 const now = useVisibleClock(), status = freshness({ snapshot, connection, lastHubSeq: seq, now });
 return <header className="command-status" role="status"><p>{status.label}</p>{restarted && <p>Hub-ul a repornit la {bucharestParts(restarted).time}</p>}{noticeUntil > now && <p>Ai o decizie nouă · o iei în L3ga {!display && <a href="#/lega">Deschide L3ga</a>}</p>}{error && <p className="command-error">Date indisponibile: {error.message}</p>}</header>;
}
export default function Command({ display = false, query = {}, go = (p) => { location.hash = `#${p}`; } }) {
  const stored = useHub((s) => s.command || EMPTY), connection = useHub((s) => s.connection), hub = useHub((s) => s.hub);
  const lastRelevantSeq = useHub((s) => s.commandLastHubSeq || 0);
  const voice = useHub((s) => s.recapVoice), snapshots = useHub((s) => s.recapSnapshots);
  const legaStatus = useHub((s) => s.legaStatus || "off"), legaPhase = useHub((s) => s.legaPhase), legaSessionId = useHub((s) => s.legaSessionId);
  const [pid] = usePref("lega.project", ""), [shape] = usePref("lega.face", "CORE");
  const [hidePref, setHide] = usePref("command.hideNumbers", false), [variantPref, setVariant] = usePref("command.variant", "A"), [decorPref, setDecor] = usePref("command.decor", true);
  const conversation = useHub((s) => conversationOf(s.legaConversations, pid));
  const [tv, setTV] = useState(EMPTY), [mainClosed, setMainClosed] = useState(false), [hidden, setHidden] = useState(document.hidden);
  const [snapshotNow, setSnapshotNow] = useState(null), [viewReads, setViewReads] = useState({});
  const graphRead = useRead("/api/company/graph"), sheetsRead = useRead(`/api/process-sheets${pid ? `?projectId=${encodeURIComponent(pid)}` : ""}`);
  const graph = graphRead.data, sheets = sheetsRead.data;
  const [error, setError] = useState(null), [noticeUntil, setNoticeUntil] = useState(0), [restarted, setRestarted] = useState(null), [epoch, setEpoch] = useState(0), [seq, setSeq] = useState(0);
  const [writing, setWriting] = useState(false), [text, setText] = useState(""), [busy, setBusy] = useState(false), [reply, setReply] = useState("");
  const channel = useRef(null), previousNow = useRef(null), root = useRef(null), previousBoot = useRef(serverInfo()?.bootId), mainRequest = useRef(0), tvPresentation = useRef(null), observedVoice = useRef(null);
  const command = display ? tv : stored, view = command.view || "idle";
  const hideNumbers = display ? Boolean(tv.hideNumbers) : (typeof stored.hideNumbers === "boolean" ? stored.hideNumbers : hidePref);
  const variant = display ? tv.variant || "A" : variantPref, decor = display ? tv.decor !== false : decorPref;
  tvPresentation.current = command;
  useRecapVisibility("command", !display && view === "recap");
  const recap = command.recap, snapshot = snapshots?.[recap?.snapshotId], caption = useVoiceCaption();
  const currentRead = view === "recap" ? snapshot : view === "idle" ? snapshotNow : ["company", "department"].includes(view) ? { readAt: graphRead.error ? null : graphRead.readAt } : view === "sheet" ? { readAt: sheetsRead.error ? null : sheetsRead.readAt } : viewReads[view];
  const status = freshness({ snapshot: currentRead, connection, lastHubSeq: Math.max(seq, lastRelevantSeq) });
  const core = deriveCoreState({ hub, connection, legaStatus, legaPhase });
  const activity = screenActivity({ busy, error, legaStatus, legaPhase, runs: hub?.activeRuns?.length || 0 });
  useEffect(() => {
    if (display) return;
    const requested = VIEW_OF_QUERY[query.vedere] || (VIEWS.includes(query.vedere) ? query.vedere : null);
    const previous = getState().command;
    setCommand({ ...(requested ? (previous?.view === requested && (requested !== "sheet" || !query.sheetId || previous.sheetId === query.sheetId) ? {} : { view: requested }) : !previous ? { view: "idle" } : {}), ...(query.departmentKey ? { departmentKey: query.departmentKey } : {}), ...(requested === "sheet" && query.sheetId ? { sheetId: query.sheetId } : {}) });
  }, [display, query.vedere, query.departmentKey, query.sheetId]);
  useEffect(() => { if (!display) setCommand({ hideNumbers: hidePref, variant: variantPref, decor: decorPref }); }, [display, hidePref, variantPref, decorPref]);
  useEffect(() => {
    const visibility = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", visibility);
    const off = onServerInfo((info) => {
      channel.current?.setBootId(info.bootId);
      if (previousBoot.current && info.bootId !== previousBoot.current) { setRestarted(Date.now()); setSeq(0); setState({ commandLastHubSeq: 0, recapSnapshots: {}, recapVoice: {} }); previousNow.current = null; setEpoch((n) => n + 1); }
      previousBoot.current = info.bootId;
      if (display) channel.current?.hello();
    });
    return () => { off(); document.removeEventListener("visibilitychange", visibility); };
  }, [display]);
  useEffect(() => {
    if (!display) return;
    const ch = openCommandChannel({ role: "tv", onState: setTV, onPeer: (p) => { if (p.otherBoot) { setEpoch((n) => n + 1); api("/api/state").then(() => { ch.setBootId(serverInfo()?.bootId); ch.hello(); }).catch(() => {}); } else setMainClosed(p.mainClosed); } });
    channel.current = ch; ch.setBootId(serverInfo()?.bootId); ch.hello();
    return () => { ch.close(); channel.current = null; };
  }, [display]);
  useEffect(() => { if (display && connection === "live") channel.current?.hello(); }, [display, connection]);
  useEffect(() => {
    if (!display) return;
    // TV observes provider evidence for the selected snapshot, without owning or starting a voice session.
    return onLive((e) => {
      const r = tvPresentation.current?.recap;
      if (r && e.snapshotId === r.snapshotId && e.index === r.index && ["lega.recap", "lega.recap_heard"].includes(e.type)) {
        observedVoice.current = e.sessionId;
        const key = `${r.snapshotId}:${r.index}`;
        setState((s) => ({ legaStatus: e.action === "stop" ? "off" : "active", recapVoice: { ...s.recapVoice, [key]: { ...s.recapVoice?.[key], ...(e.type === "lega.recap_heard" ? { heard: { match: e.match } } : { handedOff: e.handedOff, reason: e.handedOff ? null : "provider_refused" }) } } }));
      }
      if (observedVoice.current && (e.sessionId || e.session?.id) === observedVoice.current) {
        if (e.type === "lega.phase") setState({ legaPhase: e.phase });
        if (e.type === "lega.session" && e.session?.status === "ended") setState({ legaStatus: "off", legaPhase: "off" });
      }
    });
  }, [display]);
  useEffect(() => {
    let alive = true, generation = 0;
    const read = async () => { const request = ++generation; try { const s = await api("/api/recap?period=now"); if (!alive || request !== generation) return; const tagged = { ...s, bootId: serverInfo()?.bootId }; if (newDecisionNotice(previousNow.current, tagged)) setNoticeUntil(Date.now() + 60000); previousNow.current = tagged; setSnapshotNow(tagged); setError(null); } catch (e) { if (alive) setError(e); } };
    const stop = scheduleCommandRead(read, { doc: document, subscribe: onHubEvent });
    return () => { alive = false; stop(); };
  }, [epoch, connection]);
  useEffect(() => {
    if (!recap?.snapshotId || snapshot) return;
    const controller = new AbortController();
    api(`/api/recap/${encodeURIComponent(recap.snapshotId)}`, { signal: controller.signal }).then(cacheRecap).catch((e) => { if (!controller.signal.aborted) setError(e); });
    return () => controller.abort();
  }, [recap?.snapshotId, snapshot, epoch]);
  useEffect(() => {
    if (display || view !== "recap" || (recap?.snapshotId && !recap.stopped)) return;
    let alive = true;
    api("/api/recap?period=today").then(async s => { if (!alive) return; cacheRecap(s); const r={snapshotId:s.id,index:0,stopped:false};setCommand({recap:r});await presentRecap(r); }).catch(e=>{if(alive)setError(e);});
    return () => { alive=false; };
  }, [display, view, recap?.snapshotId, recap?.stopped]);
  const selectView = async (next) => {
    if (display) return;
    if (view === "recap" && next !== "recap" && recap && !recap.stopped) await controlRecap("stop", go);
    if (next === "recap" && (!recap || recap.stopped || !snapshot)) {
      try { const s = await api("/api/recap?period=today"); cacheRecap(s); const r = { snapshotId: s.id, index: 0, stopped: false }; setCommand({ view: next, recap: r }); await presentRecap(r); } catch (e) { setError(e); }
    } else setCommand({ view: next });
  };
  const leave = () => { const previous = getState().commandReturn; if (previous) history.back(); else go("/lega"); };
  const exit = async () => {
    if (display) return;
    if (getState().commandPendingResult) { setWriting(false); go("/lega"); return; }
    if (view === "sheet") setCommand({ view: sheetReturn(command) });
    else if (view === "department") setCommand({ view: "company" });
    else if (view !== "idle") await selectView("idle");
    else leave();
  };
  useEffect(() => {
    const key = (e) => {
      if (display) return;
      if (e.key === "Escape" && writing && e.target.closest?.("form")) { e.preventDefault(); e.stopPropagation(); setWriting(false); return; }
      const action = keyAction(e, { view, typing: false, dialogOpen: Boolean(document.querySelector('[role="dialog"]')) });
      if (!action || (e.key === "Enter" && e.target.closest?.("button,a"))) return;
      e.preventDefault();
      if (action === "exit") exit();
      else if (action.startsWith("view:")) selectView(action.slice(5));
      else if (view === "recap") controlRecap(action === "prev" ? "back" : action, go).catch(setError);
      else if (view === "department" && action !== "open") setCommand({ departmentKey: carousel(graph?.departments, command.departmentKey, action === "prev" ? "prev" : "next") });
      else if (view === "company" && graph?.departments?.length) {
        if (action === "open") setCommand({ view: "department", departmentKey: graph.departments[0].key });
        else { const nodes = root.current?.querySelectorAll(".department-node"); const index = Array.from(nodes || []).indexOf(document.activeElement); nodes?.[(Math.max(0, index) + (action === "prev" ? -1 : 1) + nodes.length) % nodes.length]?.focus(); }
      }
    };
    window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key);
  });
  const submit = async (e) => {
    e.preventDefault(); if (display || busy || !text.trim()) return;
    const value = text.trim(), request = ++mainRequest.current; setWriting(false); setText(""); setBusy(true); setError(null);
    const append = (line, project = pid) => setState((s) => ({ legaConversations: withConversation(s.legaConversations, project, (list) => [...list, { ...line, at: Date.now() }]) }));
    append({ role: "user", text: value });
    if (looksLikeConfirmation(value)) {
      const message = "Confirmarea planului se face în ecranul L3ga. Ieși din Mod Comandă ca să vezi planul.";
      append({ role: "lega", text: message }); setReply(message); setBusy(false); return;
    }
    try {
      const res = await api("/api/owner/intent", { method: "POST", body: { text: value, source: "typed", projectId: pid || undefined, legaSessionId: legaStatus === "active" ? legaSessionId : undefined, recap: recapContext() } });
      const answer = replyFor(res), needsCard = res.results?.some((r) => r.plan || r.opsPlan || r.blockedBy || r.clarification?.options?.length) || res.resolved?.clarification?.options?.length;
      append({ role: "lega", text: answer, clarification: res.resolved?.clarification, blocker: res.results?.find((r) => r.blockedBy)?.blockedBy }, exchangeProject(pid, res.results));
      // Keep response cards for the cockpit; it consumes this answer once after Esc.
      if (needsCard) setState({ commandPendingResult: { response: res, projectId: pid } });
      setReply(`${answer}${needsCard ? " Răspunsul are nevoie de ecranul L3ga: apasă Esc ca să-l vezi acolo." : ""}`);
      for (const r of res.results || []) await applyCommandResult(r, { go });
    } catch (e) { setError(e); append({ role: "lega", text: `Nu am putut citi răspunsul: ${e.message}` }); }
    finally { if (request === mainRequest.current) setBusy(false); }
  };
  const figures = idleFigures(snapshotNow), indicators = view === "idle" ? Object.values(figures) : view === "recap" ? snapshot?.chapters?.[recap?.index]?.indicators || [] : [];
  const department = async (key) => { await selectView("department"); setCommand({ departmentKey: key }); };
  return <ReadContext.Provider value={r => { const main = { trace: /\/trace$/, result: /\/api\/deliveries\/[^/]+$/, system: /\/system\/map$/, funnel: /\/sales\/funnel/ }[view]; if (main?.test(r.path)) setViewReads(old => ({ ...old, [view]: r.error ? { readAt: null } : { readAt: r.readAt } })); }}><div ref={root} style={departmentStyle} className="command" data-view={view} data-variant={variant} data-display={display} data-hide-numbers={hideNumbers} data-hidden={hidden} data-connection={connection}>
    <section className="command-stage" aria-label={VIEW_LABELS[view]}><ViewStatus snapshot={currentRead} connection={connection} seq={Math.max(seq,lastRelevantSeq)} restarted={restarted} noticeUntil={noticeUntil} error={error} display={display}/>
      {["idle", "recap"].includes(view) && <><div className="command-face"><LegaFace shape={shape} state={core.state}/></div><div className="command-center">{view === "idle" ? <Clock/> : <RecapText snapshot={snapshot} recap={recap} voice={voice} voiceOff={!display && legaStatus !== "active"} display={display} stale={status.stale} onControl={(a) => controlRecap(a, go).catch(setError)} onRefresh={async () => { try { const s = await api(`/api/recap?period=${snapshot.period.kind}`); cacheRecap(s); const r = { snapshotId: s.id, index: 0, stopped: false }; setCommand({ recap: r }); await presentRecap(r); } catch (e) { setError(e); } }}/>}</div><div className="command-corners">{indicators.filter(Boolean).slice(0, 4).map((i) => <Indicator key={i.id} indicator={i} hideNumbers={hideNumbers} suppressBadge={Boolean(view === "recap" && snapshot?.chapters?.[recap?.index]?.badge)} disconnected={connection !== "live"}/>)}</div></>}
      {view === "company" && <CompanyGraph shape={shape} coreState={core.state} graph={graph} display={display} hideNumbers={hideNumbers} decor={decor} setDecor={setDecor} onDepartment={department}/>}
      {view === "department" && <Department graph={graph} departmentKey={command.departmentKey} display={display} hideNumbers={hideNumbers} onDepartment={department} onSheet={(sheetId) => setCommand({ view: "sheet", sheetId, from: "department" })}/>}
      {view === "sheet" && <Sheet data={sheets} sheetId={command.sheetId} display={display} hideNumbers={hideNumbers}/>}
      {view === "funnel" && <Funnel display={display} hideNumbers={hideNumbers} thresholdOverride={display?command.coolingDays:undefined} onThreshold={coolingDays=>setCommand({coolingDays})}/>}
      {view === "trace" && <Trace missionId={command.missionId} onMission={missionId=>setCommand({missionId})} display={display} hideNumbers={hideNumbers}/>}
      {view === "result" && <Result shotIndex={command.resultShotIndex||0} onShot={resultShotIndex=>setCommand({resultShotIndex})} deliveryId={command.deliveryId} display={display} hideNumbers={hideNumbers}/>}
      {view === "system" && <SystemMap display={display} hideNumbers={hideNumbers}/>}
    </section>
    <aside className={`command-departments${connection !== "live" ? " disconnected" : ""}`} aria-label="Departamente"><h2>Departamente</h2>{(graph?.departments || []).map((d) => { const content = <><span className="department-swatch" style={{ background: `var(--dept-${d.color})` }}/><strong className="department-code">{DEPT_CODES[d.key]}</strong><span className="department-row-label">{d.labelRo}</span><span className="department-status">{d.status === "planned" ? "planificat" : d.status === "paused" ? "în pauză" : "activ"}</span><DepartmentCounts department={d} hideNumbers={hideNumbers}/></>; return display ? <div className={`department-row ${d.status}`} key={d.key}>{content}</div> : <button className={`department-row ${d.status}`} key={d.key} onClick={() => department(d.key)}>{content}</button>; })}</aside>
    <nav className="command-views" aria-label="Vederi">{["idle","recap","company","funnel","trace","result","system"].map((v,i)=><button key={v} aria-current={v===view?"page":undefined} disabled={display} onClick={()=>selectView(v)}>{v===view?"▰ ":""}{v==="trace"?"Lucrare":VIEW_LABELS[v]} <kbd>{i+1}</kbd></button>)}</nav>
    <footer className="command-bar"><div><p>{display && !observedVoice.current ? "Vocea: în fereastra principală" : legaStatus === "active" ? "Vocea activă" : legaStatus === "off" ? "Vocea e oprită" : "Vocea se conectează sau se oprește"} </p><p>{activity.text}</p><p>{lastSentence(caption.user || conversation.filter((m) => m.role === "user").at(-1)?.text)}</p>{reply && <p role="status">{reply}</p>}</div>{display ? <><button onClick={() => root.current?.requestFullscreen?.().catch(setError)}>Pe tot ecranul</button><p>Oprirea: în fereastra principală sau spune «Oprește tot».</p>{mainClosed && <p>Fereastra principală s-a închis: vocea rulează doar acolo. Aici rămân datele, cu ora ultimei citiri.</p>}</> : <><div className="command-controls">{legaStatus === "off" && <button onClick={() => sendLegaCommand("start")}>Pornește vocea</button>}<button onClick={() => { setHide(!hideNumbers); setCommand({ hideNumbers: !hideNumbers }); }}>{hideNumbers ? "Arată cifrele" : "Ascunde cifrele"}</button><button onClick={() => setWriting(!writing)}>Scrie</button><button onClick={() => window.open("#/comanda?ecran=tv", "l3ga-tv", "popup,width=1920,height=1080")}>Al doilea ecran</button><StopAllButton compact={false}/><button onClick={exit}>Ieși (Esc)</button><details><summary>Mai mult</summary><label>Aspect: <select aria-label="Aspect" value={variant} onChange={(e) => setVariant(e.target.value)}>{["A", "B", "C"].map((v) => <option key={v}>{v}</option>)}</select></label><nav aria-label="Vederi">{["idle", "recap", "company", "funnel", "trace", "result", "system"].map((v) => <button key={v} onClick={() => selectView(v)}>{VIEW_LABELS[v]}</button>)}</nav></details></div>{writing && <form onSubmit={submit}><input autoFocus aria-label="Mesaj pentru Lega" value={text} onChange={(e) => setText(e.target.value)} disabled={busy}/><button disabled={busy || !text.trim()}>Citește mesajul</button></form>}</>}</footer>
  </div></ReadContext.Provider>;
}
