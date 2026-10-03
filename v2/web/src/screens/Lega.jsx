import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AudioLines, Send, Settings2, Lock, LockOpen, VolumeX, Pause, Hand, Snowflake, Square, Undo2, Focus, Eye, EyeOff, Minimize2, Circle, Network } from "lucide-react";
import { api } from "../api.js";
import { useHub, useResource, onHubEvent, pushToast, usePref, refresh } from "../store.js";
import { Chip, Notice, ErrorNotice, Loading } from "../components/ui.jsx";
import { LegaFace } from "../components/face/LegaFace.jsx";
import { deriveCoreState } from "../lib/coreState.js";
import { buildStageGraph } from "../lib/stageGraph.js";
import { sendLegaCommand } from "../lib/legaLevels.js";
import { replyFor, faceCommand, presentedFrom, pushLayout, STATE_TONE } from "../lib/cockpitLogic.js";
import { unlockSession, onLocalhost } from "../lib/ownerSession.js";
import { StopAllButton } from "../shell/Shell.jsx";
import { OwnerSetup } from "./lega/OwnerSetup.jsx";
import { ProjectSummary, NextStepCard, DecisionCard, MissionPlan, AgentGraph, EnvironmentCard, DiffPanel, TestPanel, ReviewPanel, Replay, Preview, Briefing, Explain, CompanyMap } from "./lega/cards.jsx";

/**
 * Lega 2.0 — the cockpit you drive by intent (M06 §06, §12, §13). One sentence ("Hai să lucrăm la ProDelivery") opens the
 * project's context; reading and planning never start work; the plan is confirmed once, in your session. Cards come from the
 * safe catalog with references to the Hub's data; a layout change approves nothing and never moves the text you type.
 */
export default function LegaScreen({ id, go }) {
  if (id === "setup") return <SetupPage go={go} />;
  return <Cockpit projectId={id} go={go} />;
}

function useOwner() {
  return useResource("/api/owner/status", { reloadOn: (e) => e.type.startsWith("owner.") || (e.type === "settings.changed" && ["ownerPolicy", "projectAutonomy"].includes(e.payload?.key)) });
}

function SetupPage({ go }) {
  const owner = useOwner();
  return (
    <div className="page">
      <div className="page-head"><div><h1>Lega · Configurare</h1><p>Pașii reali până la prima misiune confirmată prin voce: ce face Hub-ul singur, apoi Windows Hello și vocea ta.</p></div>
        <button className="btn" onClick={() => go("/lega")}>Înapoi la cockpit</button></div>
      <ErrorNotice error={owner.error} />
      <OwnerSetup owner={owner.data} reload={owner.reload} />
    </div>
  );
}

const CARD_COMPONENTS = { ProjectSummary, NextStepCard, DecisionCard, MissionPlan, AgentGraph, EnvironmentCard, DiffPanel, TestPanel, ReviewPanel, Replay, Preview, Briefing, Explain, CompanyMap };

function Cockpit({ projectId, go }) {
  const hub = useHub((s) => s.hub);
  const connection = useHub((s) => s.connection);
  const legaPhase = useHub((s) => s.legaPhase);
  const legaStatus = useHub((s) => s.legaStatus || "off");
  const owner = useOwner();
  const [currentProject, setCurrentProject] = usePref("lega.project", "");
  const pid = projectId || currentProject || "";
  const cockpit = useResource(pid ? `/api/cockpit/${pid}` : null, { reloadOn: (e) => !e.type.startsWith("run.activity") && (e.projectId === pid || e.type.startsWith("envelope.") || e.type.startsWith("factory.") || e.type === "settings.changed") });
  const projects = useResource("/api/projects");
  const [faceShape, setFaceShape] = usePref("lega.face", "CORE");
  const [faceHidden, setFaceHidden] = usePref("lega.faceHidden", false);
  const [discreet, setDiscreet] = usePref("lega.discreet", false);
  const [layout, setLayout] = useState(null);
  const [history, setHistory] = useState([]);
  const [plan, setPlan] = useState(null);
  const [explain, setExplain] = useState(null);
  const [replayMission, setReplayMission] = useState(null);
  const [department, setDepartment] = useState(null);
  const [conversation, setConversation] = useState([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);
  const core = deriveCoreState({ hub, connection, legaPhase });
  const graphNodes = useMemo(() => buildStageGraph(hub, { ambient: 0 }).nodes.filter((n) => !n.ambient), [hub]);

  useEffect(() => { if (projectId && projectId !== currentProject) setCurrentProject(projectId); }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps
  // A new project = its default layout; the conversation stays (one Lega, context per project).
  useEffect(() => { if (cockpit.data && (!layout || layout.projectId !== cockpit.data.project.id)) { setLayout({ ...cockpit.data.layout, projectId: cockpit.data.project.id }); setHistory([]); } }, [cockpit.data]); // eslint-disable-line react-hooks/exhaustive-deps
  // A plan still waiting for your answer survives a reload: it is read back from the Hub (never re-created).
  useEffect(() => {
    const pending = cockpit.data?.proposedPlan;
    if (!pending || (plan?.envelope?.id === pending.envelopeId)) return;
    api(`/api/envelopes/${pending.envelopeId}`).then((env) => { if (env?.status === "PROPOSED") setPlan({ envelope: env, summary: env.summary }); }).catch(() => {});
  }, [cockpit.data?.proposedPlan?.envelopeId]); // eslint-disable-line react-hooks/exhaustive-deps
  // Visit marker for "what changed since my last visit" (recorded when you leave the cockpit of a project).
  useEffect(() => () => { if (pid) api(`/api/cockpit/${pid}/visit`, { method: "POST", body: {} }).catch(() => {}); }, [pid]);

  const changeLayout = useCallback((next) => { if (!next) return; setHistory((h) => pushLayout(h, layout)); setLayout({ ...next, projectId: cockpit.data?.project.id }); }, [layout, cockpit.data]);
  const undoLayout = () => setHistory((h) => { if (!h.length) return h; setLayout(h[h.length - 1]); return h.slice(0, -1); });

  const proposePlan = useCallback(async (missionId) => {
    if (!pid) return;
    try {
      const out = await api("/api/envelopes", { method: "POST", body: { projectId: pid, missionIds: missionId ? [missionId] : [] } });
      setPlan(out); changeLayout({ ...(layout || cockpit.data.layout), cards: [{ type: "DecisionCard", ref: { kind: "envelope", id: out.envelope?.id || "none" }, size: "l" }, ...(layout || cockpit.data.layout).cards.filter((c) => c.type !== "DecisionCard")] });
    } catch (e) { setError(e); }
  }, [pid, layout, cockpit.data, changeLayout]);

  const send = useCallback(async (sentence, source = "typed") => {
    const value = String(sentence || "").trim();
    if (!value || busy) return;
    setBusy(true); setError(null);
    setConversation((c) => [...c.slice(-40), { role: "user", text: value, at: Date.now() }]);
    try {
      const res = await api("/api/owner/intent", { method: "POST", body: { text: value, projectId: pid || undefined, source, presented: presentedFrom(plan?.envelope) || undefined, layout: layout || undefined } });
      const face = faceCommand(res.resolved.steps);
      if (face?.shape) { setFaceShape(face.shape); setFaceHidden(false); }
      if (face?.hidden) setFaceHidden(true);
      if (face?.discreet) setDiscreet(true);
      for (const r of res.results) {
        if (r.navigate?.startsWith("/cockpit/")) { const next = r.navigate.split("/")[2]; setCurrentProject(next); go(`/lega/${next}`); }
        if (r.plan?.envelope || r.plan?.summary) setPlan(r.plan);
        if (r.confirmed?.envelope) setPlan((p) => p && { ...p, envelope: { ...p.envelope, status: r.confirmed.envelope.status } });
        if (r.explain) setExplain(r.explain);
        if (r.replay) setReplayMission(r.replay.missionId);
        if (r.companyMap) { setDepartment(r.args?.departmentKey || null); changeLayout({ ...(layout || {}), cards: [{ type: "CompanyMap", ref: { kind: "company", id: "company" }, size: "l" }, ...((layout?.cards || []).filter((c) => c.type !== "CompanyMap"))] }); }
        if (r.layout) changeLayout(r.layout);
      }
      // „Înapoi” goes up one perspective (department → company, replay → now, the previous layout); never a git reset or a DB restore.
      if (res.resolved.steps.some((s) => s.intent === "back")) {
        if (department) setDepartment(null);
        else if (replayMission) setReplayMission(null);
        else if (history.length) undoLayout();
        else window.history.back();
      }
      if (res.resolved.steps.some((s) => s.intent === "live")) setReplayMission(null);
      setConversation((c) => [...c, { role: "lega", text: replyFor(res), at: Date.now(), clarification: res.resolved.clarification }]);
      refresh(); cockpit.reload();
    } catch (e) { setError(e); setConversation((c) => [...c, { role: "lega", text: `Nu am putut: ${e.message}`, at: Date.now() }]); }
    finally { setBusy(false); inputRef.current?.focus({ preventScroll: true }); }
  }, [busy, pid, plan, layout, go, changeLayout, cockpit, setCurrentProject, setFaceShape, setFaceHidden, setDiscreet, department, replayMission, history]); // eslint-disable-line react-hooks/exhaustive-deps

  // Lega's voice (GPT-Live) transcripts of YOUR words feed the same resolver, marked as provider transcripts: they can open,
  // show and stop, never confirm.
  useEffect(() => onHubEvent((e) => {
    if (document.visibilityState === "visible" && e.type === "lega.transcript" && e.payload?.role === "user" && /^(lega|hai|arată|arata|oprește|opreste|taci|pauză|pauza|continuă|continua|ce |de ce|îngheață|ingheata|preiau)/i.test(String(e.payload.text || "").trim())) send(e.payload.text, "voice-provider");
  }), [send]);

  const interrupt = async (kind, extra = {}) => {
    try { const r = await api("/api/owner/interrupt", { method: "POST", body: { kind, projectId: pid || undefined, ...extra } }); pushToast(`int-${kind}`, kind === "mute" ? "info" : "warn", r.summary || kind); refresh(); cockpit.reload(); }
    catch (e) { setError(e); }
  };

  const c = cockpit.data;
  const cardProps = (card) => ({
    card, key: `${card.type}:${card.ref?.id}`,
    onPin: () => changeLayout({ ...layout, cards: layout.cards.map((x) => (x === card ? { ...x, pinned: !x.pinned } : x)) }),
    onDismiss: () => changeLayout({ ...layout, cards: layout.cards.filter((x) => x !== card) }),
  });
  const renderCard = (card) => {
    const Comp = CARD_COMPONENTS[card.type];
    if (!Comp || !c) return null;
    const p = cardProps(card);
    switch (card.type) {
      case "ProjectSummary": case "EnvironmentCard": return <Comp {...p} cockpit={c} />;
      case "NextStepCard": return <Comp {...p} cockpit={c} onPlan={proposePlan} />;
      case "DecisionCard": return plan ? <Comp {...p} plan={plan} owner={owner.data} onConfirmed={() => cockpit.reload()} onCancel={() => setPlan(null)} /> : null;
      case "MissionPlan": return <Comp {...p} projectId={c.project.id} onPlan={proposePlan} />;
      case "Briefing": return <Comp {...p} projectId={c.project.id} />;
      case "Explain": return explain ? <Comp {...p} data={explain} /> : null;
      case "CompanyMap": return <Comp {...p} departmentKey={department} onDepartment={setDepartment} />;
      case "Replay": return <Comp {...p} missionId={replayMission || card.ref.id} onExit={() => { setReplayMission(null); changeLayout({ ...layout, cards: layout.cards.filter((x) => x.type !== "Replay") }); }} />;
      default: return <Comp {...p} missionId={card.ref.id} />;
    }
  };
  const cards = (layout?.cards || []).concat(replayMission && !(layout?.cards || []).some((x) => x.type === "Replay") ? [{ type: "Replay", ref: { kind: "mission", id: replayMission }, size: "l" }] : []);

  return (
    <div className={`page cockpit ${layout?.focus ? "is-focus" : ""}`}>
      <header className="cockpit-head">
        <div className="row wrap">
          <AudioLines size={18} aria-hidden="true" /><h1>Lega</h1>
          <label className="project-switch"><span className="sr-only">Proiect</span>
            <select value={pid} onChange={(e) => { setCurrentProject(e.target.value); go(`/lega/${e.target.value}`); setPlan(null); }}>
              <option value="">— alege proiectul —</option>
              {(projects.data?.projects || []).map((p) => <option key={p.id} value={p.id}>{p.name}{p.source === "hub-test" ? " (test)" : ""}</option>)}
            </select>
          </label>
          {c && <Chip tone={STATE_TONE[c.state.code] || "neutral"}>{c.state.label}</Chip>}
          {c?.frozen && <Chip tone="warn" icon={Snowflake}>înghețat</Chip>}
        </div>
        <div className="row wrap">
          <OwnerChip owner={owner.data} reload={owner.reload} />
          <button className="btn sm ghost" onClick={() => go("/lega/setup")}><Settings2 size={14} />Configurare</button>
        </div>
      </header>
      {owner.error?.status === 404 && <Notice tone="warn" title="Hub-ul rulează o versiune mai veche">Serverul pornit ({hub?.version || "—"}) nu are rutele Lega 2.0. Repornește Hub-ul (v2\scripts\restart.ps1); până atunci folosește Control Room.</Notice>}
      {hub?.simulation && <Notice tone="info" title="Simulare">Instanță separată cu date sintetice și provideri fixture; nimic de aici nu e real.</Notice>}
      <div className="cockpit-grid">
        <aside className="cockpit-left" aria-label="Lega">
          {!faceHidden && (
            <div className={`face-box ${discreet ? "discreet" : ""}`}>
              <LegaFace shape={faceShape} state={core.state} nodes={graphNodes} compact={discreet} />
              <div className="face-controls row wrap" role="group" aria-label="Forma Lega">
                <button className="btn sm ghost" aria-pressed={faceShape === "CORE"} onClick={() => setFaceShape("CORE")}><Circle size={12} />Nucleu</button>
                <button className="btn sm ghost" aria-pressed={faceShape === "FACE"} onClick={() => setFaceShape("FACE")}><Eye size={12} />Față</button>
                <button className="btn sm ghost" aria-pressed={faceShape === "GRAPH"} onClick={() => setFaceShape("GRAPH")}><Network size={12} />Hartă</button>
                <button className="btn sm ghost" aria-pressed={discreet} onClick={() => setDiscreet((d) => !d)}><Minimize2 size={12} />Discret</button>
                <button className="btn sm ghost" onClick={() => setFaceHidden(true)}><EyeOff size={12} />Ascunde</button>
              </div>
              <p className="faint small face-note">{core.label} · gura urmează amplitudinea vocii redate (fără viseme pe ruta GPT-Live)</p>
            </div>
          )}
          {faceHidden && <button className="btn sm ghost" onClick={() => setFaceHidden(false)}><Eye size={12} />Arată fața</button>}
          <ol className="lega-conv" aria-label="Conversația cu Lega" aria-live="polite">
            {!conversation.length && <li className="faint small">Spune sau scrie: „Hai să lucrăm la …”, „Doar arată-mi planul”, „Ce face Codex?”, „Arată-mi compania”, „Oprește tot”.</li>}
            {conversation.map((m, i) => (
              <li key={i} className={`lc-${m.role}`}><span className="who">{m.role === "user" ? "Tu" : "Lega"}</span><span className="lc-text">{m.text}</span>
                {m.clarification?.options && <span className="row wrap">{m.clarification.options.map((o) => <button key={o.id} className="btn sm" onClick={() => send(m.clarification.forIntent === "confirm" ? `confirm ${o.label}` : `hai să lucrăm la ${o.label}`)}>{o.label}</button>)}</span>}</li>
            ))}
          </ol>
          <form className="lega-composer" onSubmit={(e) => { e.preventDefault(); const v = text; setText(""); send(v); }}>
            <input ref={inputRef} className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Spune-i Lega ce vrei…" aria-label="Mesaj pentru Lega" disabled={busy} />
            <button className="btn primary icon" type="submit" disabled={busy || !text.trim()} aria-label="Trimite"><Send size={15} /></button>
            <button className="btn icon" type="button" onClick={() => sendLegaCommand(legaStatus === "off" ? "start" : "open")} aria-label={legaStatus === "off" ? "Pornește vocea Lega" : "Panoul vocii Lega"} title="Vocea Lega (GPT-Live)"><AudioLines size={15} /></button>
          </form>
          <ErrorNotice error={error} />
          <div className="interrupt-bar row wrap" role="group" aria-label="Întreruperi">
            <button className="btn sm ghost" onClick={() => interrupt("mute")} title="Oprește vocea, nu munca"><VolumeX size={13} />Taci</button>
            <button className="btn sm ghost" onClick={() => interrupt("pause")} title="Niciun pas nou; pasul activ e întrerupt și reluat la Reia"><Pause size={13} />Pauză</button>
            <button className="btn sm ghost" onClick={() => interrupt("stop_worker", { provider: "any" })} title="Oprește agentul care rulează"><Square size={13} />Oprește agentul</button>
            {pid && <button className="btn sm ghost" onClick={() => interrupt("freeze")} title="Niciun pas nou pe acest proiect"><Snowflake size={13} />Îngheață</button>}
            {pid && <button className="btn sm ghost" onClick={() => interrupt("takeover")} title="Opresc, fac checkpoint și îți predau controlul"><Hand size={13} />Preiau eu</button>}
            <StopAllButton compact />
          </div>
        </aside>
        <main className="cockpit-main" aria-label="Cockpit">
          {!pid ? <ProjectPicker projects={projects.data?.projects || []} onPick={(id) => send(`Hai să lucrăm la ${(projects.data?.projects || []).find((p) => p.id === id)?.name}`)} />
            : cockpit.loading && !c ? <Loading lines={6} /> : cockpit.error ? <ErrorNotice error={cockpit.error} onRetry={cockpit.reload} /> : (
              <>
                <div className="row between cockpit-toolbar">
                  <span className="faint small">{layout?.focus ? "Focus: doar ce contează" : `${cards.length} carduri`} · un layout nu aprobă nimic</span>
                  <div className="row">
                    <button className="btn sm ghost" disabled={!history.length} onClick={undoLayout}><Undo2 size={13} />Anulează layout</button>
                    <button className="btn sm ghost" aria-pressed={Boolean(layout?.focus)} onClick={() => changeLayout({ ...layout, focus: !layout?.focus, cards: layout?.focus ? c.layout.cards : layout.cards.filter((x) => ["ProjectSummary", "NextStepCard", "DecisionCard"].includes(x.type) || x.pinned) })}><Focus size={13} />Focus</button>
                  </div>
                </div>
                <div className="cockpit-cards">{cards.map(renderCard)}</div>
              </>
            )}
        </main>
      </div>
    </div>
  );
}

function OwnerChip({ owner, reload }) {
  const [busy, setBusy] = useState(false);
  if (!owner) return null;
  if (!onLocalhost()) return <Chip tone="neutral" icon={Lock} title={`Sesiunea de proprietar se deschide pe ${owner.webauthnOrigin}`}>sesiune: doar pe localhost</Chip>;
  if (owner.bootstrapNeeded) return <Chip tone="neutral" icon={Lock}>sesiune neconfigurată</Chip>;
  if (owner.session) return <Chip tone="ok" icon={LockOpen} title={`Expiră ${new Date(owner.session.expiresAt).toLocaleTimeString("ro-RO")}`}>sesiune deschisă{owner.policy.active ? " · voice-first" : " · legacy"}</Chip>;
  return <button className="btn sm" disabled={busy} onClick={async () => { setBusy(true); try { await unlockSession(); reload(); } catch (e) { pushToast("unlock", "error", e.message); } finally { setBusy(false); } }}><Lock size={13} />{busy ? "Aștept Windows Hello…" : "Deblochează sesiunea"}</button>;
}

function ProjectPicker({ projects, onPick }) {
  const runnable = projects.filter((p) => p.executionAllowed);
  // Leaving the start screen marks the company visit (the next "what changed" counts from here).
  useEffect(() => () => { api("/api/cockpit/company/visit", { method: "POST", body: {} }).catch(() => {}); }, []);
  return (
    <div className="stack">
      <p className="lead">Cu ce proiect lucrăm?</p>
      <div className="row wrap">{runnable.map((p) => <button key={p.id} className="btn" onClick={() => onPick(p.id)}>{p.name}{p.source === "hub-test" ? " · test" : ""}</button>)}</div>
      <p className="faint small">Deschiderea unui proiect citește doar contextul din Hub; nu pornește niciun agent.</p>
      {/* Back after a while: ONE "what changed" card for the whole company, computed locally (no model for a greeting). */}
      <Briefing projectId="company" card={{ type: "Briefing", size: "m" }} />
    </div>
  );
}
