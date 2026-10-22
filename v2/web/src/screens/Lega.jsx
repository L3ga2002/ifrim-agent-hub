import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AudioLines, Send, Settings2, Lock, LockOpen, VolumeX, Pause, Hand, Snowflake, Square, Undo2, Focus, Eye, EyeOff, Minimize2, Circle, Network, Maximize2, Radar, Monitor } from "lucide-react";
import { api } from "../api.js";
import { useHub, useResource, onHubEvent, onLive, pushToast, usePref, refresh, setState, getState } from "../store.js";
import { markArmed, looksLikeConfirmation } from "../lib/voiceContext.js";
import { planRefOfLive, cockpitPlanAction } from "../lib/uiLogic.js";
import { intelResultKind } from "../lib/intelLogic.js";
import { IntelResult } from "./lega/IntelCard.jsx";
import { Chip, Notice, ErrorNotice, Loading } from "../components/ui.jsx";
import { LegaFace } from "../components/face/LegaFace.jsx";
import { deriveCoreState } from "../lib/coreState.js";
import { buildStageGraph } from "../lib/stageGraph.js";
import { sendLegaCommand } from "../lib/legaLevels.js";
import { replyFor, faceCommand, faceFromLiveEvent, presentedFrom, pushLayout, STATE_TONE, clarificationOf } from "../lib/cockpitLogic.js";
import { unlockSession, onLocalhost } from "../lib/ownerSession.js";
import { StopAllButton } from "../shell/Shell.jsx";
import { OwnerSetup } from "./lega/OwnerSetup.jsx";
import { OpsPlanCard } from "./lega/OpsPlanCard.jsx";
import { presentedPlan, planNeedsObsPassword } from "../lib/opsLogic.js";
import { ProjectSummary, NextStepCard, DecisionCard, MissionPlan, AgentGraph, EnvironmentCard, DiffPanel, TestPanel, ReviewPanel, Replay, Preview, Briefing, Explain, CompanyMap, BlockerActions, WorkRequestsCard } from "./lega/cards.jsx";
import { RearmCard } from "./lega/RearmCard.jsx";
import { rearmSlotFrom, rearmBeforeNavigation, rearmOutcome, gateRearmHint } from "../lib/rearmLogic.js";
import { salesNavigation } from "../lib/salesCockpit.js";
import { StageCanvas, useVoiceCaption } from "./stage/LegaStage.jsx";
import { CompanyPanel, DecisionsPanel, SalesOfferCard, CommandHelp, useDecisionsInbox } from "./lega/OneScreen.jsx";
import { DeskPanel } from "./lega/DeskPanel.jsx";
import { conversationOf, withConversation, draftOf, withDraft, exchangeProject } from "../lib/legaConversation.js";
import { salesOppFromPath, offerToShow, screenActivity } from "../lib/legaOneScreen.js";

/**
 * One L3ga screen (2026-10-18): this is THE Lega interface. The living company map (departments, missions, runs, decisions) is its
 * background; Lega's figure (Nucleu / Față / Hartă, discret, ascunsă), the conversation, the voice (the one session of the top bar,
 * rendered here), the controls and the plan / progress / result cards are parts of it. „Ecran complet” is this same screen without the
 * Hub's bars. The small cockpit column and the separate full-screen stage are retired; their links (#/lega/<project>, Alt+J, the start
 * view „ecran complet”) land here.
 *
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

const CARD_COMPONENTS = { ProjectSummary, NextStepCard, DecisionCard, MissionPlan, AgentGraph, EnvironmentCard, DiffPanel, TestPanel, ReviewPanel, Replay, Preview, Briefing, Explain, CompanyMap, IntelResult };
/** 2.12.1 (UI-02): the rearm slot's ids and one-shot trigger numbers — page-wide and monotonic, so a remounted cockpit never reuses one. */
let rearmSlotCounter = 0;
let rearmTriggerCounter = 0;

function Cockpit({ projectId, go }) {
  const hub = useHub((s) => s.hub);
  const connection = useHub((s) => s.connection);
  const legaPhase = useHub((s) => s.legaPhase);
  const legaStatus = useHub((s) => s.legaStatus || "off");
  const owner = useOwner();
  const [currentProject, setCurrentProject] = usePref("lega.project", "");
  const pid = projectId || currentProject || "";
  const cockpit = useResource(pid ? `/api/cockpit/${pid}` : null, { reloadOn: (e) => !e.type.startsWith("run.activity") && (e.projectId === pid || e.type.startsWith("envelope.") || e.type.startsWith("ops.plan") || e.type.startsWith("factory.") || e.type === "settings.changed") });
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
  // M08: the last company-intelligence answer (incident, changes, scenario, lesson…) shown as a card; "detalii" opens details.
  const [intel, setIntel] = useState(null);
  // M10: the operation plan card on screen (desktop / Studio / capture work across apps): ONE confirmation.
  const [opsPlan, setOpsPlan] = useState(null);
  const [detailsTick, setDetailsTick] = useState(0);
  const legaSessionId = useHub((s) => s.legaSessionId || null);
  const startView = useResource("/api/owner/start-view", { reloadOn: (e) => e.type === "settings.changed" && e.payload?.key === "startView" });
  // One L3ga screen: the conversation and the unsent text live in the app store, per project — a change of view, „Ecran complet”, a
  // project switch (which remounts this screen) or a visit to another screen keeps them; the projects' histories stay separate.
  const conversation = useHub((s) => conversationOf(s.legaConversations, pid));
  const setConversationOf = useCallback((projectId, update) => setState((s) => ({ legaConversations: withConversation(s.legaConversations, projectId, update) })), []);
  const setConversation = useCallback((update) => setConversationOf(pid, update), [pid, setConversationOf]);
  const text = useHub((s) => draftOf(s.legaDrafts, pid));
  const setText = useCallback((value) => setState((s) => ({ legaDrafts: withDraft(s.legaDrafts, pid, value) })), [pid]);
  const immersive = useHub((s) => Boolean(s.stageOpen));
  // The conversation outlives this component; its choice and blocker buttons do not: an answer's options are offered only by the screen
  // that received it (after a remount a resolved or expired request is never offered again — ask Lega again instead).
  const mountRef = useRef(`m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);
  // The synthetic offer on screen: the one the owner opened (here, or from an answer naming it), else the newest one waiting for him.
  const [salesOpp, setSalesOpp] = usePref("lega.salesOpp", null);
  const [salesDismissed, setSalesDismissed] = usePref("lega.salesDismissed", []);
  // M14: the „Birou intern” record a read opened („Arată devizul DVZ-0001”): shown in the panel, kept across a reload.
  const [deskFocus, setDeskFocus] = usePref("lega.deskFocus", null);
  const inbox = useDecisionsInbox();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);
  const core = deriveCoreState({ hub, connection, legaPhase });
  const graphNodes = useMemo(() => buildStageGraph(hub, { ambient: 0 }).nodes.filter((n) => !n.ambient), [hub]);

  useEffect(() => { if (projectId && projectId !== currentProject) setCurrentProject(projectId); }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps
  // A new project = its default layout; the conversation stays (one Lega, context per project).
  useEffect(() => { if (cockpit.data && (!layout || layout.projectId !== cockpit.data.project.id)) { setLayout({ ...cockpit.data.layout, projectId: cockpit.data.project.id }); setHistory([]); } }, [cockpit.data]); // eslint-disable-line react-hooks/exhaustive-deps
  // A plan still waiting for your answer survives a reload: it is read back from the Hub (never re-created). M10.2: so do its armed
  // voice window (the Hub's own "until", never page memory) and the operation plan on screen (Studio / desktop work).
  useEffect(() => {
    const pending = cockpit.data?.proposedPlan;
    if (!pending) return;
    if (pending.armedUntil) markArmed(pending.envelopeId, pending.armedUntil);
    if (plan?.envelope?.id === pending.envelopeId) return;
    api(`/api/envelopes/${pending.envelopeId}`).then((env) => { if (env?.status === "PROPOSED") setPlan({ envelope: env, summary: env.summary }); }).catch(() => {});
  }, [cockpit.data?.proposedPlan?.envelopeId, cockpit.data?.proposedPlan?.armedUntil]); // eslint-disable-line react-hooks/exhaustive-deps
  // Stage before M12 (§7): the same plan in another tab or browser. When the Hub no longer lists it as waiting (confirmed, revoked or
  // expired elsewhere), the card on this page reads its real state back instead of offering a confirmation the Hub would refuse.
  useEffect(() => {
    if (!cockpit.data || cockpit.data.proposedPlan || plan?.envelope?.status !== "PROPOSED") return;
    api(`/api/envelopes/${plan.envelope.id}`).then((env) => { if (env) setPlan((p) => (p?.envelope?.id === env.id ? { ...p, envelope: env, summary: env.summary || p.summary } : p)); }).catch(() => {});
  }, [cockpit.data?.generatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!cockpit.data || cockpit.data.proposedOpsPlan || opsPlan?.status !== "PROPOSED") return;
    loadOpsPlan(opsPlan.id);
  }, [cockpit.data?.generatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const pending = cockpit.data?.proposedOpsPlan;
    if (!pending) return;
    if (pending.armedUntil) markArmed(pending.planId, pending.armedUntil);
    if (opsPlan?.id === pending.planId) return;
    loadOpsPlan(pending.planId);
  }, [cockpit.data?.proposedOpsPlan?.planId, cockpit.data?.proposedOpsPlan?.armedUntil]); // eslint-disable-line react-hooks/exhaustive-deps
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

  // M10.2 (U15): a plan announced by the Hub (`lega.plan`: the voice bridge, a typed request in another tab, a kept request that
  // became plannable) is read back through its own route and shown here; only a PROPOSED plan is shown; nothing is confirmed here.
  // Review #37/#38: the focus goes to ONE named card ({ kind, id, tick, at }), never a counter shared by every card (an ops plan just
  // announced and a DecisionCard on screen both reacted, and the later one won: Enter confirmed the other plan), and only for a plan
  // THIS tab asked for (cockpitPlanAction). Review #41: never while the full-screen stage covers the cockpit (a hidden card with focus
  // turns Enter into a confirmation the owner cannot see); the shell closes the stage first for this tab's own voice plan.
  const [focusTarget, setFocusTarget] = useState(null);
  const focusSeq = useRef(0);
  // Review #39: this tab's send() is in flight (the plan's live event can come before the HTTP answer; a typed request has no sessionId).
  const sendingRef = useRef(false);
  // A focus asked for during this send keeps the card focused: the end of the send does not put the focus back in the composer.
  const planFocusPending = useRef(false);
  const requestFocus = useCallback((kind, id) => {
    setFocusTarget({ kind, id, tick: ++focusSeq.current, at: Date.now() });
  }, []);
  const loadOpsPlan = useCallback(async (id, { focus = false } = {}) => {
    try {
      const p = await api(`/api/ops/plans/${id}`);
      if (p?.status !== "PROPOSED") return;
      // Review #40: the secrets the plan needs at confirmation (the Hub's derived list, or the steps) stay in the trimmed shape, so a
      // typed „Da” for a plan that needs the OBS password goes to the card's password field instead of the conversation.
      setOpsPlan({ id: p.id, kind: p.kind, title: p.title, status: p.status, summary: p.summary, hash: p.hash, nonce: p.nonce, confirmBy: p.confirmBy, decisions: p.body?.decisions || [],
        needsSecrets: Array.isArray(p.needsSecrets) ? p.needsSecrets : planNeedsObsPassword(p) ? ["obsPassword"] : [] });
      if (p.armedUntil) markArmed(p.id, p.armedUntil);
      if (focus) requestFocus("ops", p.id);
    } catch { /* the plan is gone or not readable: nothing to show */ }
  }, [requestFocus]);
  const showEnvelope = useCallback(async (id, { focus = false } = {}) => {
    try {
      const env = await api(`/api/envelopes/${id}`);
      if (env?.status !== "PROPOSED") return;
      setPlan({ envelope: env, summary: env.summary });
      if (env.armedUntil) markArmed(env.id, env.armedUntil);
      const base = layout || cockpit.data?.layout;
      if (base && !(base.cards || []).some((c) => c.type === "DecisionCard")) changeLayout({ ...base, cards: [{ type: "DecisionCard", ref: { kind: "envelope", id: env.id }, size: "l" }, ...(base.cards || [])] });
      if (focus) requestFocus("envelope", env.id);
    } catch { /* not readable: nothing to show */ }
  }, [layout, cockpit.data, changeLayout, requestFocus]);
  const planHandler = useRef(null);
  // 2.12.1 (UI-07): the kept requests a rearm card was just confirmed for (requestId → when): the plan the Hub re-proposes for one of them
  // — through the rearm's answer or its live `lega.plan` — is never focused and never switches the project, whatever is in flight.
  const rearmRequests = useRef(new Map());
  const REARM_REPROPOSAL_MS = 120000;
  const isRearmReproposal = (ref) => {
    const at = ref?.workRequestId ? rearmRequests.current.get(ref.workRequestId) : null;
    return Boolean(at && Date.now() - at < REARM_REPROPOSAL_MS);
  };
  planHandler.current = (ref, { explicit = false, reproposed = false } = {}) => {
    const decision = cockpitPlanAction({ ref, pid, legaSessionId, sendInFlight: sendingRef.current, explicit, reproposed: reproposed || isRearmReproposal(ref),
      presentedId: presentedPlan(opsPlan)?.planId || presentedFrom(plan?.envelope)?.envelopeId || null });
    if (decision.action === "ignore") return undefined;
    // A plan of another project: its own cockpit shows it (restored from the Hub there, never re-created) — only when this tab asked
    // for it and no other plan is on screen; otherwise the same „Deschide planul” offer as the shell (the owner chooses when to leave).
    if (decision.action === "navigate") { setCurrentProject(ref.projectId); go(decision.path); return undefined; }
    if (decision.action === "toast") { pushToast(`plan-${ref.id}`, "info", "Un plan te așteaptă în cockpit (o singură confirmare)", { openPath: decision.path, openLabel: "Deschide planul" }); return undefined; }
    if (decision.focus && sendingRef.current) planFocusPending.current = true;
    return ref.kind === "ops" ? loadOpsPlan(ref.id, { focus: decision.focus }) : showEnvelope(ref.id, { focus: decision.focus });
  };
  useEffect(() => onLive((e) => { const ref = planRefOfLive(e); if (ref) planHandler.current(ref); }), []);

  // A face command changes only the view, typed here or heard by voice. 2.12.2 (L8): a face sentence the Hub heard from the owner in
  // THIS tab's Lega session („Arată-ți fața”) arrives as `lega.face` and is applied exactly like a typed one.
  const applyFace = (face) => {
    if (face?.shape) { setFaceShape(face.shape); setFaceHidden(false); }
    if (face?.hidden) setFaceHidden(true);
    if (face?.discreet) setDiscreet(true);
  };
  const faceLive = useRef(null);
  faceLive.current = { sessionId: legaStatus !== "off" ? legaSessionId : null, apply: applyFace };
  useEffect(() => onLive((e) => { const face = faceFromLiveEvent(e, faceLive.current.sessionId); if (face) faceLive.current.apply(face); }), []);

  // M10.2.1 (D14–D16): ONE rearm card in the cockpit. It comes from the Hub's answer to a request that met the stopped gate (the card
  // bound to that request), from a blocker option („Arată cardul de redeschidere”: the same card, asked, shown and confirmed here), or — under voice-first,
  // while the gate is suspended by anything but the owner's own pause — as a standing banner. The Hub decides everything (the card, the
  // fresh Windows Hello, the exact suspension); the page never reopens the gate and nothing old restarts.
  // 2.12.1 (UI-02): the slot is { id, card, requestId, wait, trigger, handled }. A click elsewhere (an option „Arată cardul de
  // redeschidere”, a refused resume) is a ONE-SHOT trigger — a sequence number — and the card records it as handled in the slot, so a
  // remount never replays it. The slot lives in the app store, above the cockpit (a project switch remounts the whole cockpit: the
  // card bound to a kept request stays the same card), and is rendered at ONE stable place, outside the loading / error branches.
  const rearmSlot = useHub((s) => s.rearmSlot || null);
  const setRearmSlot = useCallback((next) => setState((s) => ({ rearmSlot: typeof next === "function" ? next(s.rearmSlot || null) : next })), []);
  const gateState = hub?.executionGate || null;
  const gateHint = gateRearmHint(gateState);
  // An open gate (the rearm, the owner's „Continuă”, another tab) leaves nothing to reopen.
  useEffect(() => { if (gateState?.status === "open") setRearmSlot(null); }, [gateState?.status]);
  const openRearm = useCallback((requestId = null) => {
    const rid = requestId || null;
    const trigger = ++rearmTriggerCounter;
    const id = ++rearmSlotCounter;
    setRearmSlot((s) => (s && (s.requestId || null) === rid ? { ...s, trigger } : { id, card: null, requestId: rid, wait: null, trigger, handled: 0 }));
  }, []);
  // D22: a resume the Hub refused until the rearm (an operation plan's „Continuă”) brings the card on screen — the slot already there
  // (whatever request it is bound to: the same gate decision) or a new one bound to no request.
  const revealRearm = useCallback(() => {
    const trigger = ++rearmTriggerCounter;
    const id = ++rearmSlotCounter;
    setRearmSlot((s) => (s ? { ...s, trigger } : { id, card: null, requestId: null, wait: null, trigger, handled: 0 }));
  }, []);
  const rearmTriggerHandled = useCallback((slotId, seq) => setRearmSlot((s) => (s && s.id === slotId ? { ...s, handled: Math.max(Number(s.handled) || 0, Number(seq) || 0) } : s)), []);
  // UI-03: the kept request the card was bound to is no longer active — the slot no longer names it.
  const rearmRequestDropped = useCallback((slotId) => setRearmSlot((s) => (s && s.id === slotId ? { ...s, requestId: null } : s)), []);
  const rearmApplying = useCallback((requestId) => {
    if (!requestId) return;
    const now = Date.now();
    for (const [id, at] of rearmRequests.current) if (now - at > REARM_REPROPOSAL_MS) rearmRequests.current.delete(id);
    rearmRequests.current.set(requestId, now);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const onRearmed = (res) => {
    const out = rearmOutcome(res);
    setRearmSlot(null);
    setConversation((cv) => [...cv.slice(-40), { role: "lega", text: out.text, at: Date.now() }]);
    pushToast("gate-rearm", "ok", out.toast);
    refresh(); cockpit.reload();
    // The request the card was shown for became a PROPOSED plan: the plan-card flow shows it (never focused, never confirmed here, and
    // never a project switch — UI-07: whatever this tab is sending at that moment).
    if (out.planRef?.kind === "envelope") api(`/api/envelopes/${out.planRef.id}`).then((env) => planHandler.current({ kind: "envelope", id: out.planRef.id, projectId: env?.projectId || null }, { reproposed: true })).catch(() => {});
    else if (out.planRef?.kind === "ops") planHandler.current({ kind: "ops", id: out.planRef.id, projectId: null }, { reproposed: true });
  };
  // Without a project open, an operation plan still waiting is read back too (an ops plan belongs to the company, not a project).
  useEffect(() => {
    if (pid) return;
    api("/api/ops/plans?status=PROPOSED&limit=1").then((r) => { const p = (r?.plans || [])[0]; if (p && new Date(p.confirmBy) > new Date()) loadOpsPlan(p.id); }).catch(() => {});
  }, [pid, loadOpsPlan]);

  // M12 final review X1: the rearm slot of the latest answer, applied after the conversation shows that answer (never before it).
  const pendingRearm = useRef(null);
  const applyRearmFx = (fx) => {
    if (fx.action === "set") setRearmSlot({ id: ++rearmSlotCounter, ...fx.slot, trigger: 0, handled: 0 });
    else if (fx.action === "clear") setRearmSlot(null);
  };
  useEffect(() => {
    const fx = pendingRearm.current;
    if (!fx) return;
    pendingRearm.current = null;
    applyRearmFx(fx);
  }, [conversation]); // eslint-disable-line react-hooks/exhaustive-deps

  // M10.2: a clarification button sends `choice` (the option id the Hub offered), never a synthesized sentence.
  const send = useCallback(async (sentence, source = "typed", extra = {}) => {
    const value = String(sentence || "").trim();
    if (!value || busy) return;
    // M10.2 (U15): a plan that needs the OBS password is confirmed only from its card (the password is typed there and sent with that
    // one confirmation, never through the conversation or the command log). A typed „Da” focuses the card instead.
    if (source === "typed" && opsPlan?.status === "PROPOSED" && planNeedsObsPassword(opsPlan) && looksLikeConfirmation(value)) {
      setConversation((c) => [...c.slice(-40), { role: "user", text: value, at: Date.now() }, { role: "lega", text: "Planul are nevoie de parola OBS: scrie-o în card și apasă Enter sau „Confirmă planul”. Parola nu trece prin conversație.", at: Date.now() }]);
      requestFocus("ops", opsPlan.id);
      return;
    }
    setBusy(true); setError(null);
    sendingRef.current = true; planFocusPending.current = false;
    setConversation((c) => [...c.slice(-40), { role: "user", text: value, at: Date.now() }]);
    try {
      const res = await api("/api/owner/intent", { method: "POST", body: { text: value, projectId: pid || undefined, source, presented: presentedPlan(opsPlan) || presentedFrom(plan?.envelope) || undefined, layout: layout || undefined, legaSessionId: legaStatus !== "off" && legaSessionId ? legaSessionId : undefined, choice: extra.choice || undefined } });
      applyFace(faceCommand(res.resolved.steps));
      let intelFound = null;
      // M10.2: a blocked request comes back with the server's explanation and its options (one next action each, never raw ids).
      // M10.2.1: with the preserved request's id, so an „Arată cardul de redeschidere” option binds the rearm card to THAT request.
      const blockedResult = res.results.find((r) => r.blockedBy) || null;
      const blocker = blockedResult ? { ...blockedResult.blockedBy, requestId: blockedResult.workRequest?.id || null } : null;
      // M10.2.1 (D14): the stopped gate answered in context — the Hub's rearm card (or why not yet) goes to the ONE rearm slot.
      // M12 final review X1: applied only once this answer is in the conversation (pendingRearm, below): the slot lives in the app store,
      // whose update renders at once, while the conversation is this screen's state — the card could be on screen before the answer and
      // its „Arată cardul de redeschidere” option.
      const rearmFx = rearmSlotFrom(res.results);
      pendingRearm.current = rearmFx.action === "set" || rearmFx.action === "clear" ? rearmFx : null;
      // Last review round RR13: an answer that opens another project's cockpit replaces this screen (and its conversation, whose effect
      // may never run here): its rearm slot goes to the app store now, before the navigation, so the cockpit that opens shows the card.
      if (pendingRearm.current && rearmBeforeNavigation(res.results, pid)) { const fx = pendingRearm.current; pendingRearm.current = null; applyRearmFx(fx); }
      for (const r of res.results) {
        if (r.navigate?.startsWith("/cockpit/")) { const next = r.navigate.split("/")[2]; setCurrentProject(next); go(`/lega/${next}`); }
        // M09: "deschide studioul", "arată-mi clipul X", a proposed correction (opens the clip at that second with the proposal).
        if (r.navigate?.startsWith("/studio")) go(r.navigate);
        if (r.plan?.envelope || r.plan?.summary) setPlan(r.plan);
        // Review #40: a card shape without the derived secrets list is read back in full (the guard above needs it); no focus here.
        if (r.opsPlan) { setOpsPlan(r.opsPlan); if (!Array.isArray(r.opsPlan.needsSecrets) && r.opsPlan.status === "PROPOSED") loadOpsPlan(r.opsPlan.id); }
        // M10: „Pornește Lega” — the Hub checked; this page starts the voice (its microphone + the owner cookie). Never a server start.
        if (r.legaStart) sendLegaCommand("start", { expectWebSearch: r.legaStartWebSearch || null });
        if (r.confirmed?.plan) setOpsPlan((p) => (p && p.id === r.confirmed.plan.id ? { ...p, status: r.confirmed.plan.status } : p));
        if (r.confirmed?.envelope) setPlan((p) => p && { ...p, envelope: { ...p.envelope, status: r.confirmed.envelope.status } });
        if (r.explain) setExplain(r.explain);
        if (r.desk?.recordId) setDeskFocus({ id: r.desk.recordId, at: Date.now() });
        if (r.replay) setReplayMission(r.replay.missionId);
        if (r.companyMap) { setDepartment(r.args?.departmentKey || null); changeLayout({ ...(layout || {}), cards: [{ type: "CompanyMap", ref: { kind: "company", id: "company" }, size: "l" }, ...((layout?.cards || []).filter((c) => c.type !== "CompanyMap"))] }); }
        if (r.layout) changeLayout(r.layout);
        // M08: an armed plan is confirmed by the Hub from your local voice; the card only shows the open window.
        if (r.armed?.armed && r.plan?.envelope?.id) markArmed(r.plan.envelope.id, r.armed.expiresAt);
        if (r.plan?.envelope && r.objective) setPlan(r.plan);
        if (r.view === "stage") setState({ stageOpen: true });
        if (r.view === "cockpit") setState({ stageOpen: false });
        if (r.view === "details") setDetailsTick((t) => t + 1);
        const kind = intelResultKind(r);
        if (kind) intelFound = { kind, result: r, at: Date.now() };
      }
      // The M08 card goes on top of the FINAL layout the server returned for the whole sentence (every step's card included).
      if (intelFound) {
        setIntel(intelFound);
        const base = res.layout || layout || cockpit.data?.layout || { cards: [] };
        changeLayout({ ...base, cards: [{ type: "IntelResult", ref: { kind: "intel", id: intelFound.kind }, size: "l" }, ...(base.cards || []).filter((c) => c.type !== "IntelResult")] });
      }
      // „Înapoi” goes up one perspective (department → company, replay → now, the previous layout); never a git reset or a DB restore.
      if (res.resolved.steps.some((s) => s.intent === "back")) {
        if (department) setDepartment(null);
        else if (replayMission) setReplayMission(null);
        else if (history.length) undoLayout();
        else window.history.back();
      }
      if (res.resolved.steps.some((s) => s.intent === "live")) setReplayMission(null);
      // M12 final review C2: „Arată-mi oferta” opens the offer in Vânzări → Oportunitate; „Ce lipsește?” / „Aprobă oferta” keep the Hub's
      // answer here, with the offer's screen as a button next to it (a navigation would take the answer away).
      const salesNav = salesNavigation(res.results);
      // One L3ga screen: the exchange stays in the history it was asked in; the project the answer opens gets one neutral line saying so.
      const movedTo = exchangeProject(pid, res.results);
      if (movedTo !== (pid || "")) setConversationOf(movedTo, (c) => [...c, { role: "lega", text: `Am deschis acest proiect la cererea ta din conversația ${pid ? "altui proiect" : "companiei"}: „${value.slice(0, 160)}”.`, at: Date.now() }]);
      // An answer about an offer (with its screen as a button next to it) brings that offer's card on this screen too.
      const answerOpp = salesNav.links.map((l) => salesOppFromPath(l.path)).find(Boolean);
      if (answerOpp) setSalesOpp(answerOpp);
      // Review F2 (L4): a planner's question with choices (the run planner's, for example) gets its buttons too, not only the resolver's.
      setConversation((c) => [...c, { mount: mountRef.current, role: "lega", text: replyFor(res), at: Date.now(), clarification: clarificationOf(res), blocker, links: salesNav.links }]);
      if (salesNav.go) go(salesNav.go);
      refresh(); cockpit.reload();
    } catch (e) { setError(e); setConversation((c) => [...c, { role: "lega", text: `Nu am putut: ${e.message}`, at: Date.now() }]); }
    finally {
      sendingRef.current = false; setBusy(false);
      // The plan this sentence produced keeps the focus (Enter confirms it); otherwise the composer is ready for the next sentence.
      if (!planFocusPending.current) inputRef.current?.focus({ preventScroll: true });
      planFocusPending.current = false;
    }
  }, [busy, pid, plan, opsPlan, layout, go, changeLayout, cockpit, setCurrentProject, setFaceShape, setFaceHidden, setDiscreet, department, replayMission, history, legaStatus, legaSessionId, requestFocus, loadOpsPlan, setConversation, setConversationOf, setSalesOpp]); // eslint-disable-line react-hooks/exhaustive-deps

  // Lega's voice (GPT-Live) transcripts of YOUR words feed the same resolver, marked as provider transcripts: they can open,
  // show and stop, never confirm. M10.2 (U15): under the voice-first policy, or in a Lega session derived from the owner session, the
  // Hub's own voice bridge (runtime/lega.mjs) already sends every final owner sentence to the intake — on the server, whether or not
  // this page is open — so the page never forwards it a second time (two plans for one sentence). This first-word forwarder stays
  // only for the legacy policy, unchanged.
  const legaAuthority = useHub((s) => s.legaAuthority || null);
  // Unknown policy (status not loaded yet) counts as the server bridge: missing a forward is harmless, a double plan is not.
  const serverBridge = !owner.data || Boolean(owner.data.policy?.active) || legaAuthority === "owner_session";
  const serverBridgeRef = useRef(serverBridge); serverBridgeRef.current = serverBridge;
  useEffect(() => onHubEvent((e) => {
    if (serverBridgeRef.current) return;
    if (document.visibilityState === "visible" && e.type === "lega.transcript" && e.payload?.role === "user" && (/^(lega|hai|arată|arata|oprește|opreste|taci|pauză|pauza|continuă|continua|ce |de ce|îngheață|ingheata|preiau|ține|tine|reține|retine|uită|uita|ecran|deschide|următorul|urmatorul|amână|amana|simulează|simuleaza|cine |la livrarea|nu merge|pornește direct|porneste direct|detalii|cockpit|la secund|mută|muta|taie|studio|clip|publică|publica|importă|importa|adu |înregistrează|inregistreaza|pregătește|pregateste|treci pe|unde e)/i.test(String(e.payload.text || "").trim()) || /\b(a picat|a căzut|a cazut|s-a stricat|nu mai merge|dă eroare|da eroare)\b/i.test(String(e.payload.text || "")))) send(e.payload.text, "voice-provider");
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
      case "DecisionCard": return plan ? <Comp {...p} plan={plan} owner={owner.data} detailsTick={detailsTick} focusTarget={focusTarget} projectLevel={c.autonomy?.level || null} onReplan={() => proposePlan(plan?.envelope?.missionIds?.[0])} onConfirmed={() => cockpit.reload()} onCancel={() => setPlan(null)} /> : null;
      case "IntelResult": return intel ? <IntelResult {...p} kind={intel.kind} result={intel.result} onDone={() => { setIntel(null); cockpit.reload(); }} /> : null;
      case "MissionPlan": return <Comp {...p} projectId={c.project.id} onPlan={proposePlan} />;
      case "Briefing": return <Comp {...p} projectId={c.project.id} />;
      case "Explain": return explain ? <Comp {...p} data={explain} /> : null;
      case "CompanyMap": return <Comp {...p} departmentKey={department} onDepartment={setDepartment} />;
      case "Replay": return <Comp {...p} missionId={replayMission || card.ref.id} onExit={() => { setReplayMission(null); changeLayout({ ...layout, cards: layout.cards.filter((x) => x.type !== "Replay") }); }} />;
      default: return <Comp {...p} missionId={card.ref.id} />;
    }
  };
  // 2.15.4: a plan waiting for the owner always has its card, even when it was announced before this project's layout loaded (the layout
  // then came without it and the plan was only counted in the activity line, never shown).
  const planCard = plan?.envelope?.status === "PROPOSED" && plan.envelope.projectId === (c?.project?.id || null) && !(layout?.cards || []).some((x) => x.type === "DecisionCard")
    ? [{ type: "DecisionCard", ref: { kind: "envelope", id: plan.envelope.id }, size: "l" }] : [];
  const cards = planCard.concat(layout?.cards || []).concat(replayMission && !(layout?.cards || []).some((x) => x.type === "Replay") ? [{ type: "Replay", ref: { kind: "mission", id: replayMission }, size: "l" }] : []);
  // The one rearm card: the slot (an answer, an option, a refused resume) or, under voice-first, the standing banner while the gate is
  // suspended by anything but the owner's own pause (that one is „Continuă”). Never both. Rendered at ONE stable place (UI-02).
  const noAuthenticator = Boolean(owner.data?.bootstrapNeeded);
  const slotId = rearmSlot?.id;
  const rearmView = rearmSlot
    ? <RearmCard key={`rearm-${rearmSlot.id}`} card={rearmSlot.card} requestId={rearmSlot.requestId} wait={rearmSlot.wait} trigger={rearmSlot.trigger || 0} handled={rearmSlot.handled || 0}
      noAuthenticator={noAuthenticator} onTriggerHandled={(seq) => rearmTriggerHandled(slotId, seq)} onRequestDropped={() => rearmRequestDropped(slotId)} onApply={rearmApplying}
      onDone={onRearmed} onClose={() => setRearmSlot(null)} onSay={(t) => send(t)} />
    : gateHint?.kind === "rearm" && owner.data?.policy?.active ? <RearmCard key="rearm-standing" hint={gateHint.text} noAuthenticator={noAuthenticator} onApply={rearmApplying} onDone={onRearmed} onSay={(t) => send(t)} /> : null;

  // The figure's own state and what the screen is doing now, from real data only (the Hub, the voice session, this page's request).
  const activity = screenActivity({ busy, error, legaStatus, legaPhase, planWaiting: plan?.envelope?.status === "PROPOSED" || opsPlan?.status === "PROPOSED",
    decisions: (inbox.data?.items || []).length, runs: hub?.activeRuns?.length || 0 });
  const caption = useVoiceCaption();
  const offerOpp = offerToShow({ items: inbox.data?.items || [], current: salesOpp, dismissed: salesDismissed });
  const showOffer = (oppId) => { setSalesOpp(oppId); setSalesDismissed((d) => (Array.isArray(d) ? d.filter((x) => x !== oppId) : [])); };
  // An offer brought on screen by itself (it waits for the owner) stays there after his decision: its card then shows the result.
  useEffect(() => { if (!salesOpp && offerOpp) setSalesOpp(offerOpp); }, [salesOpp, offerOpp]); // eslint-disable-line react-hooks/exhaustive-deps
  const closeOffer = () => { setSalesDismissed((d) => [...(Array.isArray(d) ? d : []).filter((x) => x !== offerOpp), offerOpp].slice(-20)); setSalesOpp(null); };
  const showDepartment = (key) => { setDepartment(key); changeLayout({ ...(layout || cockpit.data?.layout || {}), cards: [{ type: "CompanyMap", ref: { kind: "company", id: "company" }, size: "l" }, ...(((layout || cockpit.data?.layout)?.cards || []).filter((x) => x.type !== "CompanyMap"))] }); };
  // The voice panel of the top bar is rendered in this place while the screen is shown (one component, one microphone).
  // A remount (project switch) attaches the new place before or after the old one detaches: only the element that leaves is cleared.
  const dockElRef = useRef(null);
  const dockRef = useCallback((el) => {
    const prev = dockElRef.current;
    dockElRef.current = el;
    if (el) setState({ legaDock: el });
    else if (prev) setState((st) => (st.legaDock === prev ? { legaDock: null } : {}));
  }, []);
  // 2.15.4: „Ecran complet” is how the owner uses this screen: his last choice on this screen is remembered in this browser (a view
  // preference, never authority); with no choice yet, the start view „ecranul Lega, ecran complet” decides. Leaving #/lega for another
  // screen is not a choice: coming back returns to the full screen.
  const [fullPref, setFullPref] = usePref("lega.fullscreen", null);
  const fullApplied = useRef(false);
  useEffect(() => {
    if (fullApplied.current) return;
    if (fullPref === null && !startView.data) return; // wait for the start view
    fullApplied.current = true;
    const want = fullPref === null ? startView.data?.startView === "stage" : fullPref === true;
    if (want && !getState()?.stageOpen) setState({ stageOpen: true });
  }, [fullPref, startView.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const prevImmersive = useRef(immersive);
  useEffect(() => {
    if (prevImmersive.current === immersive) return;
    prevImmersive.current = immersive;
    if (fullApplied.current) setFullPref(immersive);
  }, [immersive]); // eslint-disable-line react-hooks/exhaustive-deps
  // „Tot monitorul”: the browser's own full screen (like F11, without the browser's bars); the browser's Esc leaves it.
  const [monitorFull, setMonitorFull] = useState(() => Boolean(typeof document !== "undefined" && document.fullscreenElement));
  useEffect(() => {
    const onChange = () => setMonitorFull(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  const toggleMonitor = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else { if (!immersive) setState({ stageOpen: true }); await document.documentElement.requestFullscreen?.({ navigationUI: "hide" }); }
    } catch (e) { pushToast("monitor-full", "warn", `Browserul nu a permis ecranul pe tot monitorul: ${e?.message || e}. Poți folosi F11.`); }
  };
  // Esc leaves „Ecran complet” (never while typing, nor over a dialog that handles its own Esc).
  useEffect(() => {
    if (!immersive) return undefined;
    const onKey = (e) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (document.querySelector(".overlay, .lega-help-pop, [role='dialog'][aria-modal='true']")) return;
      setState({ stageOpen: false });
    };
    // Capture: runs before a dialog's own Esc closes it, so the dialog is still there to be seen.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [immersive]);

  return (
    <div className={`page cockpit lega-one ${layout?.focus ? "is-focus" : ""} ${immersive ? "is-immersive" : ""}`}>
      <StageCanvas className="lega-one-map" />
      <header className="cockpit-head">
        <div className="row wrap">
          <AudioLines size={18} aria-hidden="true" /><h1>Lega</h1>
          <label className="project-switch lega-project-switch"><span className="sr-only">Proiect</span>
            <select value={pid} onChange={(e) => { setCurrentProject(e.target.value); go(`/lega/${e.target.value}`); setPlan(null); }}>
              <option value="">— compania (fără proiect) —</option>
              {(projects.data?.projects || []).map((p) => <option key={p.id} value={p.id}>{p.name}{p.source === "hub-test" ? " (test)" : ""}</option>)}
            </select>
          </label>
          {c && <Chip tone={STATE_TONE[c.state.code] || "neutral"}>{c.state.label}</Chip>}
          {c?.frozen && <Chip tone="warn" icon={Snowflake}>înghețat</Chip>}
          {hub && <Chip tone={hub.mode === "BUILD_SAFE" ? "info" : "warn"}>{hub.mode}</Chip>}
          {hub && <Chip tone={hub.executionGate?.status === "open" ? "ok" : "neutral"}>poarta {hub.executionGate?.status === "open" ? "deschisă" : "suspendată"}</Chip>}
        </div>
        <div className="row wrap">
          <OwnerChip owner={owner.data} reload={owner.reload} />
          {/* „Ecran complet” = this same screen without the Hub's bars (also by voice or Alt+J); Esc or the button returns. */}
          {immersive
            ? <button className="btn sm" onClick={() => { if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {}); setState({ stageOpen: false }); }} title="Înapoi la ecranul cu barele Hub-ului (Esc)"><Minimize2 size={14} />Ieși din ecran complet</button>
            : <button className="btn sm" onClick={() => setState({ stageOpen: true })} title="Ecranul Lega fără barele Hub-ului (Alt+J)"><Maximize2 size={14} />Ecran complet</button>}
          {typeof document !== "undefined" && document.fullscreenEnabled && <button className="btn sm ghost" aria-pressed={monitorFull} onClick={toggleMonitor} title="Ecranul Lega pe tot monitorul, fără bara browserului (ca F11)"><Monitor size={14} />{monitorFull ? "Ieși de pe tot monitorul" : "Tot monitorul"}</button>}
          <label className="start-view small" title="Ce se deschide când pornești Hub-ul fără o adresă anume">
            <span className="hide-mobile">La pornire</span>
            <select value={startView.data?.startView || "cockpit"} onChange={async (e) => { try { await api("/api/owner/start-view", { method: "POST", body: { view: e.target.value } }); startView.reload(); } catch (er) { setError(er); } }} aria-label="Ecranul de pornire">
              <option value="cockpit">ecranul Lega</option><option value="stage">ecranul Lega, ecran complet</option>
            </select>
          </label>
          <button className="btn sm ghost" onClick={() => go("/intel")} title="Pilot automat & inteligența companiei"><Radar size={14} />Pilot</button>
          <button className="btn sm ghost" onClick={() => go("/lega/setup")}><Settings2 size={14} />Configurare</button>
          {immersive && legaStatus !== "off" && <button className="btn sm danger" onClick={() => sendLegaCommand("stop")}><Square size={13} />Oprește Lega</button>}
          {immersive && <StopAllButton compact />}
        </div>
      </header>
      {owner.error?.status === 404 && <Notice tone="warn" title="Hub-ul rulează o versiune mai veche">Serverul pornit ({hub?.version || "—"}) nu are rutele Lega 2.0. Repornește Hub-ul (v2\scripts\restart.ps1); până atunci folosește Control Room.</Notice>}
      {hub?.simulation && <Notice tone="info" title="Simulare">Instanță separată cu date sintetice și provideri fixture; nimic de aici nu e real.</Notice>}
      <div className="cockpit-grid lega-one-grid">
        <aside className="lega-one-side" aria-label="Compania și proiectul">
          <CompanyPanel onDepartment={showDepartment} go={go} />
          {/* M11: the project's deliveries, in Lega's own words (the result, never ids or grants), one click from the Delivery Room. */}
          {(cockpit.data?.deliveries || []).length > 0 && (
            <div className="stack tight" aria-label="Livrări">
              {cockpit.data.deliveries.slice(0, 2).map((d) => (
                <Notice key={d.id} tone={d.status === "READY" ? "ok" : d.status === "STALE" || d.status === "FAILED" ? "warn" : "info"} title={`Camera de livrare: ${d.title}`}>
                  <span>{d.sentence}</span>{" "}
                  <button className="btn sm" onClick={() => go(d.href)}>Arată-mi ce ai pregătit</button>{" "}
                  <button className="btn sm ghost" onClick={() => go("/livrare/decizii")}>Deciziile mele</button>
                </Notice>
              ))}
            </div>
          )}
        </aside>
        <section className="lega-one-center" aria-label="Lega">
          <div className="lega-one-scroll">
          {!faceHidden && (
            <div className={`face-box ${discreet ? "discreet" : ""}`}>
              <LegaFace shape={faceShape} state={core.state} nodes={graphNodes} compact={discreet} />
            </div>
          )}
          <div className="face-controls row wrap" role="group" aria-label="Forma Lega">
            <button className="btn sm ghost" aria-pressed={!faceHidden && faceShape === "CORE"} onClick={() => { setFaceShape("CORE"); setFaceHidden(false); }}><Circle size={12} />Nucleu</button>
            <button className="btn sm ghost" aria-pressed={!faceHidden && faceShape === "FACE"} onClick={() => { setFaceShape("FACE"); setFaceHidden(false); }}><Eye size={12} />Față</button>
            <button className="btn sm ghost" aria-pressed={!faceHidden && faceShape === "GRAPH"} onClick={() => { setFaceShape("GRAPH"); setFaceHidden(false); }}><Network size={12} />Hartă</button>
            <button className="btn sm ghost" aria-pressed={discreet} disabled={faceHidden} onClick={() => setDiscreet((d) => !d)}><Minimize2 size={12} />Discret</button>
            {faceHidden
              ? <button className="btn sm ghost" onClick={() => setFaceHidden(false)}><Eye size={12} />Arată fața</button>
              : <button className="btn sm ghost" onClick={() => setFaceHidden(true)} title="Doar harta companiei, fără figura Legăi"><EyeOff size={12} />Ascunde</button>}
          </div>
          <p className={`lega-one-activity tone-${activity.tone}`} role="status" aria-live="polite"><span className="dot" aria-hidden="true" />{activity.text}<span className="faint"> · {core.label}</span></p>
          {(caption.user || caption.lega) && legaStatus !== "off" && (
            <div className="lega-one-caption" aria-hidden="true">
              {caption.user && <p className="stage-user">Tu: {caption.user}</p>}
              {caption.lega && <p className="stage-lega">{caption.lega}</p>}
            </div>
          )}
          <ol className={`lega-conv${conversation.length ? "" : " is-empty"}`} aria-label="Conversația cu Lega" aria-live="polite">
            {!conversation.length && <li className="faint small">Spune sau scrie ce vrei; exemplele sunt la butonul „?” de lângă casetă. Citirea și planul nu pornesc nimic.</li>}
            {conversation.map((m, i) => (
              <li key={i} className={`lc-${m.role}`}><span className="who">{m.role === "user" ? "Tu" : "Lega"}</span><span className="lc-text">{m.text}</span>
                {m.mount === mountRef.current && m.clarification?.options?.length > 0 && <span className="row wrap">{m.clarification.options.map((o) => <button key={o.id} className="btn sm" onClick={() => send(o.label, "typed", { choice: { forIntent: m.clarification.forIntent, id: o.id } })}>{o.label}</button>)}</span>}
                {m.links?.length > 0 && <span className="row wrap">{m.links.map((l) => <button key={l.path} className="btn sm" onClick={() => go(l.path)}>{l.label}</button>)}</span>}
                {m.mount === mountRef.current && m.blocker?.options?.length > 0 && <BlockerActions options={m.blocker.options} projectId={pid || null} projectLevel={c?.autonomy?.level || null} requestId={m.blocker.requestId || null} onSay={(t) => send(t)} onDone={() => cockpit.reload()} onRearm={openRearm} />}</li>
            ))}
          </ol>
          </div>
          <div className="lega-voice-dock" ref={dockRef} />
          <form className="lega-composer" onSubmit={(e) => { e.preventDefault(); const v = text; setText(""); send(v); }}>
            <input ref={inputRef} className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Spune-i Lega ce vrei…" aria-label="Mesaj pentru Lega" disabled={busy} />
            <button className="btn primary icon" type="submit" disabled={busy || !text.trim()} aria-label="Trimite"><Send size={15} /></button>
            <button className="btn icon" type="button" onClick={() => sendLegaCommand(legaStatus === "off" ? "start" : "open")} aria-label={legaStatus === "off" ? "Pornește vocea Lega" : "Panoul vocii Lega"} title="Vocea Lega (GPT-Live)"><AudioLines size={15} /></button>
            <CommandHelp onPick={(x) => { setText(x); inputRef.current?.focus({ preventScroll: true }); }} />
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
        </section>
        <main className="cockpit-main" aria-label="Cockpit">
          <DecisionsPanel go={go} onShowOffer={showOffer} inbox={inbox} />
          {/* 2.12.1 (UI-02): the ONE rearm card lives here, outside the loading / error / no-project branches, so a failed cockpit reload
              or a project switch never unmounts (and never replays) it. */}
          {rearmView && <div className="rearm-slot">{rearmView}</div>}
          {offerOpp && <SalesOfferCard key={offerOpp} oppId={offerOpp} onClose={closeOffer} go={go} />}
          {!pid ? <>
            {/* Company-level answers ("Ce avem azi?", a scenario, a lesson) are shown even before a project is open. */}
            {intel &&<IntelResult card={{ type: "IntelResult", size: "l" }} kind={intel.kind} result={intel.result} onDismiss={() => setIntel(null)} onDone={() => setIntel(null)} />}
            {opsPlan && <OpsPlanCard plan={opsPlan} card={{ type: "OpsPlan", size: "l" }} focusTarget={focusTarget} onClose={() => setOpsPlan(null)} onRearm={revealRearm} />}
            {department && <CompanyMap card={{ type: "CompanyMap", size: "l" }} departmentKey={department} onDepartment={setDepartment} onDismiss={() => setDepartment(null)} />}
            <ProjectPicker projects={projects.data?.projects || []} onPick={(id) => send(`Hai să lucrăm la ${(projects.data?.projects || []).find((p) => p.id === id)?.name}`)} />
          </>
            : cockpit.loading && !c ? <Loading lines={6} /> : cockpit.error ? <ErrorNotice error={cockpit.error} onRetry={cockpit.reload} /> : (
              <>
                <div className="row between cockpit-toolbar">
                  <span className="faint small">{layout?.focus ? "Focus: doar ce contează" : `${cards.length} carduri`} · un layout nu aprobă nimic</span>
                  <div className="row">
                    <button className="btn sm ghost" disabled={!history.length} onClick={undoLayout}><Undo2 size={13} />Anulează layout</button>
                    <button className="btn sm ghost" aria-pressed={Boolean(layout?.focus)} onClick={() => changeLayout({ ...layout, focus: !layout?.focus, cards: layout?.focus ? c.layout.cards : layout.cards.filter((x) => ["ProjectSummary", "NextStepCard", "DecisionCard"].includes(x.type) || x.pinned) })}><Focus size={13} />Focus</button>
                  </div>
                </div>
                <div className="cockpit-cards">
                  {opsPlan &&<OpsPlanCard plan={opsPlan} card={{ type: "OpsPlan", size: "l" }} focusTarget={focusTarget} onClose={() => setOpsPlan(null)} onRearm={revealRearm} />}
                  {/* M10.2: requests the Hub kept while blocked survive a reload; each cause shows ONE next action. */}
                  {c.workRequests?.length > 0 && <WorkRequestsCard card={{ type: "WorkRequests", size: "m" }} requests={c.workRequests} projectId={c.project.id} projectLevel={c.autonomy?.level || null} onSay={(t) => send(t)} onDone={() => cockpit.reload()}
                    onOpenPlan={(ref) => planHandler.current({ ...ref, projectId: ref.kind === "envelope" ? c.project.id : null }, { explicit: true })} onRearm={openRearm} />}
                  {cards.map(renderCard)}
                </div>
              </>
            )}
          {/* M13 „Birou intern”: the start dossier, the support case and the deviz, after the cockpit's own cards. */}
          <DeskPanel focus={deskFocus} onClearFocus={() => setDeskFocus(null)} />
        </main>
      </div>
    </div>
  );
}

function OwnerChip({ owner, reload }) {
  const [busy, setBusy] = useState(false);
  if (!owner) return null;
  if (!onLocalhost()) return <Chip tone="neutral" icon={Lock} title={`Sesiunea de proprietar se deschide pe ${owner.webauthnOrigin}`}>sesiune: doar pe localhost</Chip>;
  // One L3ga screen: an open session is said first (under the local development profile there may be no authenticator yet), with its authority.
  if (owner.session) return <Chip tone="ok" icon={LockOpen} title={`Expiră ${new Date(owner.session.expiresAt).toLocaleTimeString("ro-RO")}`}>sesiune deschisă{owner.session.authority === "local_dev_profile" ? " (dezvoltare locală)" : ""}{owner.policy.active ? " · voice-first" : " · legacy"}</Chip>;
  if (owner.bootstrapNeeded) return <Chip tone="neutral" icon={Lock}>sesiune neconfigurată</Chip>;
  return <button className="btn sm" disabled={busy} onClick={async () => { setBusy(true); try { await unlockSession(); reload(); } catch (e) { pushToast("unlock", "error", e.message); } finally { setBusy(false); } }}><Lock size={13} />{busy ? "Aștept Windows Hello…" : "Deblochează sesiunea"}</button>;
}

function ProjectPicker({ projects, onPick }) {
  const runnable = projects.filter((p) => p.executionAllowed);
  // Leaving the start screen marks the company visit (the next "what changed" counts from here).
  useEffect(() => () => { api("/api/cockpit/company/visit", { method: "POST", body: {} }).catch(() => {}); }, []);
  return (
    <div className="stack lega-one-panel">
      <p className="lead">Cu ce proiect lucrăm?</p>
      <div className="row wrap">{runnable.map((p) => <button key={p.id} className="btn" onClick={() => onPick(p.id)}>{p.name}{p.source === "hub-test" ? " · test" : ""}</button>)}</div>
      <p className="faint small">Deschiderea unui proiect citește doar contextul din Hub; nu pornește niciun agent.</p>
      {/* Back after a while: ONE "what changed" card for the whole company, computed locally (no model for a greeting). */}
      <Briefing projectId="company" card={{ type: "Briefing", size: "m" }} />
    </div>
  );
}
