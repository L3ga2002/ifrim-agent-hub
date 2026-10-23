import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { FolderGit2, Footprints, ShieldCheck, Network, FileDiff, ListChecks, MessageSquareText, History, MonitorPlay, Newspaper, HelpCircle, Building2, Lock, Check, X, Pin, PinOff, ChevronDown, ChevronRight, Play, Rewind, Mic2, Square, Eye } from "lucide-react";
import { api, fmt } from "../../api.js";
import { useResource, useAction, pushToast, refresh } from "../../store.js";
import { Panel, Empty, Loading, ErrorNotice, StatusChip, Notice, Chip, DiffView } from "../../components/ui.jsx";
import { STATE_TONE, missionGraph } from "../../lib/cockpitLogic.js";
import { FACTORY_STAGE_RO, blockerAction, cardFocusWanted, holdsTypedText, autonomyRaiseOffered, factoryWaitSuffix as waitSuffix, testFirstCard, evidenceResult, evidenceStageLabel, testFirstSummary } from "../../lib/uiLogic.js";
import { withReauth } from "../../lib/ownerSession.js";
import { recordSegment, sendSegment } from "../../lib/voiceGate.js";
import { setPresentedPlan, clearPresentedPlan, beginCapture, endCapture, preferredMic, armedUntil, onArmed } from "../../lib/voiceContext.js";
import { RearmCard } from "./RearmCard.jsx";
import { REARM_SHOW_LABEL } from "../../lib/rearmLogic.js";
import { DecisionFacts, TargetDetails } from "../../components/StatePill.jsx";

const EVIDENCE_TONE = { PASS: "ok", FAIL: "error", INCONCLUSIVE: "warn", BLOCKED: "error", NOT_RUN: "neutral", NEEDS_INSTALL_APPROVAL: "warn" };
const NODE_TONE = { DONE: "ok", RUNNING: "info", WAITING: "neutral", FAILED: "error", BLOCKED: "warn" };
const Src = ({ children }) => <span className="faint small src">{children}</span>;

export function CardShell({ card, title, icon, onPin, onDismiss, children, actions }) {
  return (
    <Panel title={title} icon={icon} className={`cockpit-card size-${card.size || "m"}`} actions={<>
      {actions}
      {onPin && <button className="btn sm icon ghost" onClick={onPin} aria-pressed={Boolean(card.pinned)} aria-label={card.pinned ? "Desprinde cardul" : "Fixează cardul"} title={card.pinned ? "Desprinde" : "Fixează"}>{card.pinned ? <PinOff size={13} /> : <Pin size={13} />}</button>}
      {onDismiss && !card.pinned && <button className="btn sm icon ghost" onClick={onDismiss} aria-label="Ascunde cardul"><X size={13} /></button>}
    </>}>{children}</Panel>
  );
}

export function ProjectSummary({ cockpit: c, ...rest }) {
  return (
    <CardShell {...rest} title={c.project.name} icon={FolderGit2}>
      <div className="row wrap">
        <Chip tone={STATE_TONE[c.state.code] || "neutral"}>{c.state.label}</Chip>
        <Chip tone={c.project.kind === "test" ? "info" : "neutral"}>{c.project.kind === "test" ? "proiect de test" : "proiect real"}</Chip>
        <Chip tone="neutral" title={c.autonomy.label}>autonomie {c.autonomy.level}{c.autonomy.source === "default" ? " (implicit)" : ""}</Chip>
        {c.frozen && <Chip tone="warn">înghețat</Chip>}
      </div>
      <div className="cockpit-cols">
        <div>
          <h3 className="h3">Terminat (cu dovezi)</h3>
          {c.done.length ? <ul className="plain">{c.done.slice(0, 5).map((d) => <li key={d.id}><a href={`#/missions/${d.missionId || d.id}`}>{d.title}</a> <Src>{d.evidence} · {fmt.dateTime(d.at)}</Src></li>)}</ul> : <p className="faint small">Nimic terminat cu dovezi în Hub.</p>}
        </div>
        <div>
          <h3 className="h3">Deschis / blocat</h3>
          {[...c.blocked, ...c.open].length ? <ul className="plain">{[...c.blocked, ...c.open].slice(0, 6).map((m) => <li key={m.missionId}><a href={`#/missions/${m.missionId}`}>{m.title}</a> <StatusChip status={m.stage === "BLOCKED" || m.status === "BLOCKED" ? "BLOCKED" : m.stage === "NEEDS_OWNER_DECISION" ? "ATTENTION" : m.status} label={m.stage ? FACTORY_STAGE_RO[m.stage] || m.stage : undefined} />{m.reason && <div className="faint small">{m.reason}</div>}</li>)}</ul> : <p className="faint small">Nicio misiune deschisă.</p>}
        </div>
      </div>
      <dl className="kv small">
        <dt>Ultima sesiune</dt><dd>{c.lastSession.conversation ? <>{c.lastSession.conversation.title} · {fmt.dateTime(c.lastSession.conversation.at)}</> : "—"}{c.lastSession.lastRun && <> · {c.lastSession.lastRun.provider} {c.lastSession.lastRun.status} ({c.lastSession.lastRun.environment})</>}</dd>
        <dt>Repository</dt><dd>{c.repo.available ? <>{c.repo.branch} · {c.repo.head} · {c.repo.dirty} modificate, {c.repo.untracked} noi <Src>{c.repo.source}, citit {fmt.time(c.repo.readAt)}</Src></> : c.repo.reason}</dd>
        <dt>Decizii</dt><dd>{c.decisions.length ? c.decisions.slice(0, 2).map((d) => d.title).join(" · ") : "—"}</dd>
      </dl>
      {c.missing.length > 0 && <p className="faint small">Lipsește: {c.missing.join(" · ")}</p>}
      <Src>Generat {fmt.dateTime(c.generatedAt)} din datele Hub-ului (nimic citit din codul proiectului).</Src>
    </CardShell>
  );
}

export function NextStepCard({ cockpit: c, onPlan, ...rest }) {
  const r = c.next.recommended;
  return (
    <CardShell {...rest} title="Următorul pas" icon={Footprints}>
      <p className="lead">{r.text}</p>
      <p className="faint small">De ce: {r.why} <Src>· sursa: {r.source}</Src></p>
      <div className="row wrap">
        {(r.kind === "confirm_plan" || r.kind === "unblock") && <button className="btn sm primary" onClick={() => onPlan(r.missionId)}>Arată-mi planul</button>}
        {r.missionId && <a className="btn sm ghost" href={`#/missions/${r.missionId}`}>Deschide misiunea</a>}
      </div>
      {c.next.alternatives.length > 0 && (
        <details><summary className="small">Alternative ({c.next.alternatives.length})</summary>
          <ul className="plain small">{c.next.alternatives.map((a, i) => <li key={i}>{a.text} <Src>— {a.why}</Src></li>)}</ul>
        </details>
      )}
      <Src>Ordinea vine din starea misiunilor și din notițele proiectului; nu e o prioritate comercială stabilită de Hub.</Src>
    </CardShell>
  );
}

/**
 * The plan before anything runs, and the ONE confirmation. Under the legacy policy the button says so (Approvals as before);
 * without a session the confirmation opens Windows Hello first. Enter confirms only while this card has focus.
 */
export function DecisionCard({ plan, owner, onConfirmed, onCancel, onReplan, detailsTick = 0, focusTarget = null, projectLevel = null, ...rest }) {
  const env = plan?.envelope;
  const summary = plan?.summary || env?.summary;
  const [details, setDetails] = useState(false);
  const ref = useRef(null);
  // "Detalii" (Zero-Menu) opens the technical details of the plan on screen.
  useEffect(() => { if (detailsTick) setDetails(true); }, [detailsTick]);
  // M10.2 (U15): a plan the Hub just announced (lega.plan) is focused, so Enter confirms exactly this card (id + nonce + hash).
  // Review #37/#38: only a focus request naming THIS envelope, once per request and while it is fresh (an ops plan announced next to
  // it, or this card restored later, never moves the focus here); never away from text the owner is typing in the composer.
  const focusHandled = useRef(null);
  useEffect(() => {
    if (!cardFocusWanted(focusTarget, { kind: "envelope", id: env?.id, handledTick: focusHandled.current }) || !ref.current) return;
    focusHandled.current = focusTarget.tick;
    if (holdsTypedText(document.activeElement, ref.current)) return;
    ref.current.focus({ preventScroll: false });
    ref.current.scrollIntoView?.({ block: "nearest" });
  }, [focusTarget?.tick, env?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // M08: the Hub's armed voice window for this plan (your session + this Lega session + this hash, ~90 s).
  const [armedAt, setArmedAt] = useState(() => (env?.id ? armedUntil(env.id) : null));
  const [, setClock] = useState(0);
  useEffect(() => onArmed((id) => { if (id === env?.id) setArmedAt(armedUntil(id)); }), [env?.id]);
  useEffect(() => { if (!armedAt) return undefined; const t = setInterval(() => setClock((c) => c + 1), 1000); return () => clearInterval(t); }, [armedAt]);
  const armedOpen = Boolean(armedAt && armedAt > Date.now());
  const live = useResource(env?.id ? `/api/envelopes/${env.id}` : null, { reloadOn: (e) => e.type.startsWith("envelope.") || e.type === "factory.stage" });
  const current = live.data || env;
  const policyActive = owner?.policy?.active;
  const confirm = useAction(async (modality = "click") => {
    const res = await withReauth(() => api(`/api/envelopes/${env.id}/confirm`, { method: "POST", body: { nonce: env.nonce, displayedHash: env.envelopeHash, modality } }));
    pushToast(`env-${env.id}`, "ok", res.envelope.status === "ACTIVE" ? "Confirmat: misiunea a pornit" : `Confirmat: ${res.envelope.status}`);
    live.reload(); refresh(); onConfirmed?.(res.envelope);
  });
  const revoke = useAction(async () => { await api(`/api/envelopes/${env.id}/revoke`, { method: "POST", body: { reason: "Revocat din cockpit" } }); live.reload(); onCancel?.(); });
  const awaiting = current?.status === "PROPOSED" && new Date(current.confirmBy) > new Date();
  // M10.2 review #1/#31: a plan blocked only by automatic readiness is confirmable; its confirmation runs the pre-steps shown, then starts.
  const eligible = summary?.state === "PLAN_READY" || summary?.state === "PLAN_READY_AFTER_READINESS";
  // While this plan waits for you, a sentence spoken to Lega is tagged with it (the Hub still checks everything). Every hook
  // runs before the early returns below (a card may switch between a plan with and without an envelope).
  const presentable = Boolean(env && awaiting && eligible && policyActive);
  useEffect(() => {
    if (!presentable || !env) return undefined;
    setPresentedPlan({ envelopeId: env.id, nonce: env.nonce, hash: env.envelopeHash, projectId: env.projectId });
    return () => clearPresentedPlan(env.id);
  }, [presentable, env?.id]);
  if (!plan) return null;
  if (!env) return <CardShell {...rest} title="Planul" icon={ShieldCheck}><Notice tone="warn" title="Planul nu e complet">{(summary?.blockers || []).join(" · ")}</Notice></CardShell>;
  // M11 L5: a test-first plan's step 0, from the hashed body only (null for an ordinary plan: its card stays exactly as before).
  const tf = testFirstCard(env.body);
  const stateLabel = { PROPOSED: awaiting ? "așteaptă confirmarea ta" : "expirat", CONFIRMED: "autorizat · în pregătire", ACTIVE: "autorizat · în execuție", WAITING_OWNER: "așteaptă decizia ta", COMPLETED: "încheiat", REVOKED: "revocat", EXPIRED: "expirat", SUPERSEDED: "înlocuit (s-a schimbat ceva)", FAILED_TO_START: "confirmat, dar nu a pornit", CANCELLED: "anulat" }[current?.status] || current?.status;
  return (
    <CardShell {...rest} title="Arată-mi înainte să faci" icon={ShieldCheck} actions={<Chip tone={current?.status === "ACTIVE" ? "info" : awaiting ? "approval" : "neutral"}>{stateLabel}</Chip>}>
      <div ref={ref} tabIndex={-1} className="decision" onKeyDown={(e) => { if (e.key === "Enter" && awaiting && eligible && policyActive && !confirm.pending && e.target === ref.current) confirm.run("keyboard"); }}>
        <p className="lead">{summary.headline}</p>
        <ul className="plain decision-lines">
          {tf && <li><strong>{tf.step0}</strong></li>}
          {tf?.proves && <li>{tf.proves}</li>}
          <li>{summary.where}</li><li>{summary.steps}</li>{summary.models && <li>{summary.models}</li>}<li><strong>{summary.never}</strong></li><li>{summary.stops}</li>
          {/* 2.12.2 (P0-R3): the per-turn limits and the mission's deadline the plan binds (hashed in body.limits.turnTimeoutMin). */}
          {summary.limits && <li>{summary.limits}</li>}<li>{summary.cost}</li>
          {summary.mode && <li>{summary.mode}</li>}<li className="faint">{summary.files}</li><li className="faint">Nivel: {summary.autonomy}</li>
        </ul>
        {summary.blockers?.length > 0 && <Notice tone="warn" title={summary.state === "BLOCKED_BY_ISOLATION" ? "Execuție blocată de izolare" : "Nu poate porni acum"}>{summary.blockers.slice(0, 4).join(" · ")}
          {/* M10.2 (U15): ONE next action for the blocker, never a form of the old flow (mode, gate, grants). */}
          {summary.state === "BLOCKED_BY_ISOLATION" && <div className="row wrap" style={{ marginTop: 6 }}><a className="btn sm" href="#/system?tab=environments">Sistem → Medii: ruta și atestarea mediului izolat</a></div>}</Notice>}
        {summary.state === "PLAN_READY_AFTER_READINESS" && summary.preSteps?.length > 0 && <Notice tone="info" title="Pregătire automată după confirmare">{summary.preSteps.join(" · ")}. Le fac eu (fără model), apoi pornesc; dacă tot nu se poate, îți spun de ce și nu pornește nimic.</Notice>}
        {/* Review #42: offered only while the project itself is on Observ (a raise never lowers a higher level); a plan proposed on Observ
            for a project raised since then only needs the plan asked again (one click, nothing about the level changes). */}
        {awaiting && env.autonomyLevel === "OBSERVE" && autonomyRaiseOffered(projectLevel) && <AutonomyRaise projectId={env.projectId} onRaised={onReplan} />}
        {awaiting && env.autonomyLevel === "OBSERVE" && projectLevel && !autonomyRaiseOffered(projectLevel) && onReplan && (
          <Notice tone="info" title="Planul a fost pregătit pe nivelul Observ">Proiectul e acum pe {projectLevel}; cere planul din nou ca să-l poți confirma.
            <div className="row wrap" style={{ marginTop: 6 }}><button className="btn sm" onClick={onReplan}>Arată planul din nou</button></div></Notice>)}
        {/* Review #12: only the difference the Hub really needs (envelope view `delta`); a held plan shows its blocker instead. */}
        {current?.status === "WAITING_OWNER" && policyActive && current?.delta && <DeltaOffer env={current} onDone={() => { live.reload(); refresh(); }} />}
        {current?.status === "WAITING_OWNER" && !current?.delta && current?.derived?.hold && <Notice tone="warn" title="Planul așteaptă">{current.derived.hold}</Notice>}
        <button className="btn sm ghost" onClick={() => setDetails((d) => !d)} aria-expanded={details}>{details ? <ChevronDown size={13} /> : <ChevronRight size={13} />}Detalii tehnice</button>
        {details && (
          <dl className="kv small">
            <dt>Plan</dt><dd className="mono">{env.id} · hash {env.envelopeHash.slice(0, 16)} · confirmare până la {fmt.time(env.confirmBy)}</dd>
            <dt>Misiuni</dt><dd>{env.body.missions.map((m) => `${m.title} (spec v${m.specVersion}, ${m.workType})`).join(" · ")}</dd>
            {/* M09: the exact models/efforts the plan binds (the value confirmed is the value dispatched). */}
            <dt>Modele</dt><dd>{env.body.missions.map((m) => { const x = env.body.models?.[m.missionId]; return x ? `${env.body.missions.length > 1 ? `${m.title}: ` : ""}writer ${x.writer}; reviewer ${x.reviewer}` : `${m.title}: —`; }).join(" · ")}</dd>
            {/* M11 L5: the Hub-written test's path appears only here, never in the card's main lines. */}
            {tf && <><dt>Test (pasul 0)</dt><dd><span className="mono">{tf.details}</span></dd></>}
            <dt>Rută</dt><dd>{env.body.workspaceScope.route} · {env.body.attestationRefs.map((a) => a.attestationId ? `atestare ${a.attestationId} ${a.status}` : a.environment).join(", ")}</dd>
            <dt>Repository</dt><dd>{env.body.baseSnapshot.kind === "repository" ? `${env.body.baseSnapshot.branch} @ ${String(env.body.baseSnapshot.head).slice(0, 10)}` : env.body.baseSnapshot.kind} · stare {env.body.baseSnapshot.stateHash || "—"}</dd>
            <dt>Roluri</dt><dd>{env.body.allowedRoles.join(", ")} · {env.body.providers.join(", ")}</dd>
            <dt>Rețea</dt><dd>{Object.entries(env.body.networkScope).map(([k, v]) => `${k}: ${v}`).join(" · ")}</dd>
            <dt>Interzis</dt><dd>{env.body.deniedEffects.join(", ")}</dd>
            {current?.derivedGrants?.length > 0 && <><dt>Granturi derivate</dt><dd>{current.derivedGrants.map((g) => `${g.provider}${g.model ? ` ${g.model}` : ""} ${g.access} ${g.attemptsUsed}/${g.maxAttempts} (${g.status})`).join(" · ")}</dd></>}
          </dl>
        )}
        {/* M15: the same four lines as every decision (object, version, action, consequence) and the exact target in full, before the click. */}
        {awaiting && <DecisionFacts object={`Planul pentru ${env.body.missions.map((m) => `„${m.title}”`).join(", ")}`}
          version={`${env.body.missions.map((m) => `spec v${m.specVersion}`).join(", ")} · propus ${fmt.dateTime(env.issuedAt || env.createdAt || current?.issuedAt)} · confirmare până la ${fmt.dateTime(env.confirmBy)}`}
          action="„Da, execută planul”: o singură confirmare pentru toți pașii de mai sus" consequence={summary.steps} never={summary.never} />}
        {awaiting && <TargetDetails items={[{ label: "ID", value: env.id }, { label: "SHA", value: env.envelopeHash }]} />}
        {awaiting && (
          <div className="row wrap">
            <button className="btn primary" disabled={!eligible || !policyActive || confirm.pending} onClick={() => confirm.run("click")}><Check size={15} />{confirm.pending ? "Confirm…" : "Da, execută planul"}</button>
            <button className="btn ghost" disabled={revoke.pending} onClick={revoke.run}><X size={15} />Nu acum</button>
            {!policyActive && <span className="faint small"><Lock size={12} /> Politica voice-first nu e activă: confirmarea trece prin Aprobări (legacy). O activezi din Lega → Configurare.</span>}
            {policyActive && !owner?.session && <span className="faint small"><Lock size={12} /> Confirmarea îți cere Windows Hello / cheia (sesiunea e blocată).</span>}
          </div>
        )}
        {awaiting && eligible && policyActive && armedOpen && <Notice tone="info" title="Fereastra vocală e deschisă">Spune „Da, execută planul” (vocea ta, verificată și transcrisă local) până la {new Date(armedAt).toLocaleTimeString("ro-RO")}. Butonul rămâne disponibil.</Notice>}
        {awaiting && eligible && policyActive && !armedOpen && <VoiceConfirm env={env} onConfirmed={(res) => { live.reload(); refresh(); onConfirmed?.(res.envelope); }} />}
        {current?.status === "ACTIVE" && <p className="small">Autorizat{current?.consent?.modality === "voice" ? " prin vocea ta (verificată și transcrisă local)" : ""}. Granturile tehnice au fost derivate intern; urmărește graful execuției.</p>}
        {current?.closeReason && !awaiting && <p className="faint small">{current.closeReason}</p>}
        <ErrorNotice error={confirm.error || revoke.error} />
      </div>
    </CardShell>
  );
}

/**
 * M07 §15: the spoken form of the same confirmation. Push-to-talk records ONE sentence for THIS plan; the Hub decides the
 * speaker and transcribes it locally, then the confirmation points to that server-held segment (never to text from the page).
 * Anything but a clear "Da, execută planul" from your voice is shown and nothing starts; the button and Enter stay available.
 */
function VoiceConfirm({ env, onConfirmed }) {
  const [phase, setPhase] = useState("idle"); // idle | listening | checking | done
  const [level, setLevel] = useState(0);
  const [heard, setHeard] = useState(null);
  const [error, setError] = useState(null);
  const handle = useRef(null);
  const start = async () => {
    setError(null); setHeard(null); setPhase("listening");
    beginCapture(env.id);
    try {
      handle.current = recordSegment({ deviceId: preferredMic() || null, maxSeconds: 6, onLevel: setLevel });
      const r = await handle.current.promise;
      handle.current = null;
      if (!r) { setPhase("idle"); return; }
      setPhase("checking");
      const seg = await sendSegment(r.bytes, { purpose: "confirm", envelopeId: env.id, flags: r.flags });
      setHeard(seg);
      if (seg.result !== "MATCH" || !seg.transcript) { setPhase("idle"); return; }
      const res = await withReauth(() => api(`/api/envelopes/${env.id}/confirm`, { method: "POST", body: { nonce: env.nonce, displayedHash: env.envelopeHash, modality: "voice", utteranceId: seg.utteranceId } }));
      pushToast(`env-${env.id}`, "ok", res.envelope.status === "ACTIVE" ? "Confirmat prin voce: misiunea a pornit" : `Confirmat: ${res.envelope.status}`);
      setPhase("done");
      onConfirmed?.(res);
    } catch (e) {
      // Confirmed meanwhile (another tab, the button): that is the outcome the owner wanted, not an error.
      const now = await api(`/api/envelopes/${env.id}`).catch(() => null);
      if (now && ["CONFIRMED", "ACTIVE"].includes(now.status)) { setPhase("done"); onConfirmed?.({ envelope: now }); }
      else { setError(e); setPhase("idle"); }
    } finally { endCapture(env.id); }
  };
  return (
    <div className="voice-confirm">
      <div className="row wrap">
        <button className="btn" disabled={phase === "checking" || phase === "done"} onClick={phase === "listening" ? () => handle.current?.cancel() : start} aria-live="polite">
          {phase === "listening" ? <><Square size={14} />Ascult… spune „Da, execută planul”</> : phase === "checking" ? "Verific local…" : <><Mic2 size={14} />Confirmă cu vocea</>}
        </button>
        <span className="faint small">vocea e verificată și transcrisă pe acest calculator; e forma vorbită a confirmării din sesiunea ta, nu autentificare</span>
      </div>
      {phase === "listening" && <div className="mic-level" aria-hidden="true"><span style={{ width: `${Math.round(level * 100)}%` }} /></div>}
      {heard && (
        <p className="heard">{heard.result === "MATCH" ? <>Am auzit: <b>„{heard.transcript || "—"}”</b>{heard.sttMs ? ` · ${heard.sttMs} ms` : ""}</> : <>Nu te-am recunoscut ({heard.result}: {heard.reason}); nimic nu a pornit.</>}</p>
      )}
      <ErrorNotice error={error} />
    </div>
  );
}

/**
 * M10.2 (U15): the blocker AUTONOMY_OBSERVE as an inline decision. Raising the project's level asks Windows Hello again (the Hub's
 * owner.autonomy.set requires a fresh session to raise); the plan on screen keeps the level it was proposed with, so it is asked
 * again afterwards (the Hub refuses a plan above the project's level, and never runs OBSERVE).
 */
function AutonomyRaise({ projectId, onRaised }) {
  // Review #42: `atLeast` — the Hub never lowers a level already at or above Asistat (no revoke, no supersede), whatever the card saw.
  const raise = useAction(async () => {
    const res = await withReauth(() => api("/api/owner/autonomy", { method: "POST", body: { projectId, level: "ASSISTED", atLeast: true } }));
    pushToast(`autonomy-${projectId}`, "ok", res?.unchanged ? `Proiectul e deja pe nivelul ${res.level}; îți arăt planul din nou` : "Proiectul e acum pe nivelul Asistat; îți arăt planul din nou");
    refresh(); onRaised?.();
  });
  return (
    <Notice tone="info" title="Proiectul e pe nivelul Observ">
      Pe Observ citesc, navighez și fac planuri, dar nu pornesc execuții.
      <div className="row wrap" style={{ marginTop: 6 }}><button className="btn sm" disabled={raise.pending} onClick={raise.run}><Lock size={13} />{raise.pending ? "Aștept Windows Hello…" : "Ridică la Asistat (Windows Hello)"}</button></div>
      <ErrorNotice error={raise.error} />
    </Notice>
  );
}

/**
 * M10.2 (U11/U15): a plan in force that waits for the owner (its repair cycles or a step's attempts are spent) goes on only by a
 * confirmed DIFFERENCE in the same plan: one more cycle (or attempt), inside the plan's own time and limits. The Hub decides which
 * difference it is and shows its text in the answer; the confirmation is the owner session's (owner channel, never a click record).
 */
function DeltaOffer({ env, onDone }) {
  const missionId = env.currentMissionId || env.missionIds?.[0] || null;
  const [done, setDone] = useState(null);
  const delta = useAction(async () => {
    const res = await withReauth(() => api(`/api/envelopes/${env.id}/delta`, { method: "POST", body: { missionId, modality: "click" } }));
    setDone(res.delta?.text || "Diferența a fost confirmată.");
    pushToast(`env-delta-${env.id}`, "ok", res.resuming ? "Confirmat: misiunea continuă în același plan" : "Diferența a fost confirmată");
    onDone?.();
  });
  if (!missionId) return null;
  return (
    <Notice tone="approval" title="Planul așteaptă decizia ta">
      {env.closeReason || env.statusReason || "Limita afișată în plan a fost atinsă."} Poți confirma doar diferența: {env.delta?.text || "încă un ciclu de remediere (sau o încercare), în același plan, cu aceleași limite de timp."}
      <div className="row wrap" style={{ marginTop: 6 }}>
        <button className="btn sm primary" disabled={delta.pending || Boolean(done)} onClick={delta.run}><Check size={13} />{delta.pending ? "Confirm…" : "Confirmă diferența (o dată)"}</button>
      </div>
      {done && <p className="small" style={{ margin: "6px 0 0" }}>{done}</p>}
      <ErrorNotice error={delta.error} />
    </Notice>
  );
}

/**
 * M10.2 (U15): the options of a blocker (owner/blockers.mjs), ONE next action each: a link to the place where it is decided, an
 * inline Windows Hello decision (autonomy), a sentence to say („Continuă”, „Dezgheață”), a step the Hub does itself after the plan's
 * confirmation, or an honest refusal. Nothing here creates authority: every action goes through its own backend command.
 * M10.2.1 (D14): a suspended gate the rearm card can reopen (kind "rearm") is ONE button that opens the cockpit's single rearm card for
 * this request (`onRearm(requestId)`: the card is asked, shown and confirmed there, owner session + a fresh Windows Hello); without a
 * cockpit slot the card is shown inline here. Never a link to an administration page.
 */
export function BlockerActions({ options = [], projectId = null, projectLevel = null, requestId = null, onSay, onDone, onRearm }) {
  // Review #42: a stored AUTONOMY_OBSERVE option may be stale (the project was raised since): `atLeast` never lowers a higher level,
  // and the button is shown only while the cockpit's own level is still Observ.
  const raise = useAction(async () => {
    const res = await withReauth(() => api("/api/owner/autonomy", { method: "POST", body: { projectId, level: "ASSISTED", atLeast: true } }));
    pushToast(`autonomy-${projectId}`, "ok", res?.unchanged ? `Proiectul e deja pe nivelul ${res.level}` : "Proiectul e acum pe nivelul Asistat"); refresh(); onDone?.();
  });
  const seen = new Set();
  const items = (options || []).filter((o) => { const k = `${o.kind}:${o.code}:${o.label}`; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 6);
  if (!items.length) return null;
  return (
    <ul className="plain small blocker-actions" aria-label="Ce se poate face">
      {items.map((o) => {
        const a = blockerAction(o);
        return (
          <li key={`${o.kind}:${o.code}:${o.label}`} className="row wrap">
            <span className="grow">{o.label}</span>
            {a.type === "link" && <a className="btn sm" href={a.href}>Deschide</a>}
            {a.type === "autonomy" && projectId && autonomyRaiseOffered(projectLevel) && <button className="btn sm" disabled={raise.pending} onClick={raise.run}><Lock size={12} />{raise.pending ? "Aștept Windows Hello…" : "Ridică la Asistat"}</button>}
            {a.type === "say" && onSay && <button className="btn sm" onClick={() => onSay(a.text)}>„{a.text}”</button>}
            {/* 2.12.1 (UI-01): the option only brings the card on screen (asked from the Hub, shown in full); the card's own button decides. */}
            {a.type === "rearm" && onRearm && <button className="btn sm" onClick={() => onRearm(requestId)}><Eye size={12} aria-hidden="true" />{REARM_SHOW_LABEL}</button>}
            {a.type === "auto" && <Chip tone="info">fac eu, după confirmarea planului</Chip>}
            {a.type === "refused" && <Chip tone="neutral">refuzat</Chip>}
            {a.type === "rearm" && !onRearm && <div className="block" style={{ flexBasis: "100%" }}><RearmCard compact requestId={requestId} onSay={onSay} onDone={() => { pushToast("gate-rearm", "ok", "Poarta e redeschisă. Nimic vechi nu a repornit."); refresh(); onDone?.(); }} /></div>}
          </li>
        );
      })}
      {raise.error && <li><ErrorNotice error={raise.error} /></li>}
    </ul>
  );
}

const REQUEST_STATUS_RO = { OPEN: "păstrată", BLOCKED: "blocată, păstrată", PLANNED: "plan pregătit", CONFIRMED: "confirmată, se pregătește" };
/** M10.2 (U15): the requests the Hub kept (survive a reload and the end of the voice session), with their causes and next actions. */
export function WorkRequestsCard({ requests = [], projectId, projectLevel = null, onSay, onDone, onOpenPlan, onRearm, ...rest }) {
  // Giving a request up is one click (fail-safe: it only stops the Hub from re-proposing it); nothing else is touched.
  const cancel = useAction(async (id) => { await api(`/api/work-requests/${id}/cancel`, { method: "POST", body: {} }); pushToast(`wr-${id}`, "ok", "Am renunțat la cerere; nu o mai propun."); onDone?.(); });
  return (
    <CardShell {...rest} title="Cereri păstrate" icon={History}>
      <ul className="plain">
        {requests.map((r) => (
          <li key={r.id} className="stack tight">
            <div className="row wrap"><span className="grow">„{r.text || "—"}”</span><Chip tone={r.status === "PLANNED" ? "approval" : r.status === "BLOCKED" ? "warn" : "neutral"}>{REQUEST_STATUS_RO[r.status] || r.status}</Chip>{r.company && <Chip tone="neutral">compania</Chip>}</div>
            {r.status === "PLANNED" && r.planRef && <div><button className="btn sm primary" onClick={() => onOpenPlan?.(r.planRef)}>Arată planul</button></div>}
            {r.status !== "PLANNED" && r.options?.length > 0 && <BlockerActions options={r.options} projectId={r.company ? null : projectId} projectLevel={projectLevel} requestId={r.id} onSay={onSay} onDone={onDone} onRearm={onRearm} />}
            <div className="row wrap"><button className="btn sm ghost" disabled={cancel.pending} onClick={() => cancel.run(r.id)}>Renunță la cerere</button><Src>expiră {fmt.dateTime(r.expiresAt)} · o explic o singură dată</Src></div>
          </li>
        ))}
      </ul>
      <ErrorNotice error={cancel.error} />
    </CardShell>
  );
}

export function MissionPlan({ projectId, onPlan, ...rest }) {
  const list = useResource(`/api/cockpit/${projectId}/missions`, { reloadOn: (e) => e.type.startsWith("factory.") });
  const drafts = (list.data?.missions || []).filter((m) => m.stage === "SPEC_DRAFT");
  return (
    <CardShell {...rest} title="Misiuni pregătite" icon={ListChecks}>
      {list.loading ? <Loading lines={2} /> : drafts.length ? <ul className="plain">{drafts.map((m) => <li key={m.missionId} className="row between"><span>{m.title} <Src>{m.workType}</Src></span><button className="btn sm" onClick={() => onPlan(m.missionId)}>Arată planul</button></li>)}</ul>
        : <Empty title="Nicio misiune pregătită">Spune-mi ce vrei să facem; pregătesc specificația ca ciornă.</Empty>}
    </CardShell>
  );
}

function useFactory(missionId) {
  return useResource(missionId ? `/api/factory/${missionId}` : null, { reloadOn: (e) => e.missionId === missionId || (e.scopeType === "mission" && e.scopeId === missionId) });
}

export function AgentGraph({ missionId, ...rest }) {
  const v = useFactory(missionId);
  const nodes = useMemo(() => missionGraph(v.data), [v.data]);
  return (
    <CardShell {...rest} title={v.data ? `Execuție: ${v.data.mission.title}` : "Execuție"} icon={Network}>
      {v.loading ? <Loading lines={3} /> : v.error ? <ErrorNotice error={v.error} /> : (
        <>
          <ol className="agent-graph" aria-label="Etapele execuției">
            {nodes.map((n) => <li key={n.key} className={`ag-node ${NODE_TONE[n.status]}`}><span className="ag-dot" aria-hidden="true" /><strong>{n.label}</strong><span className="small">{n.status === "DONE" ? "gata" : n.status === "RUNNING" ? "rulează" : n.status === "FAILED" ? "a eșuat" : n.status === "BLOCKED" ? "blocat" : "așteaptă"}</span><span className="faint small">{n.where}</span></li>)}
          </ol>
          <p className="small">Etapa: <strong>{FACTORY_STAGE_RO[v.data.factory.stage] || v.data.factory.stage}</strong>{waitSuffix(v.data.factory.waitReason, v.data.factory.stage)}</p>
          {v.data.factory.stageReason && <p className="faint small">{v.data.factory.stageReason}</p>}
          {/* M11 L5: after protection, what the Hub-written test checks (informative; Stop and Pauză stay available). */}
          {testFirstSummary(v.data) && <p className="small">{testFirstSummary(v.data)}</p>}
          <Src>Legăturile se aprind doar pe evenimente reale; un rol configurat nu e un worker activ. Mediul arătat e cel în care etapa A RULAT (din dovezi).</Src>
        </>
      )}
    </CardShell>
  );
}

export function EnvironmentCard({ cockpit: c, ...rest }) {
  const env = c.environments;
  return (
    <CardShell {...rest} title="Medii și izolare" icon={ShieldCheck}>
      {!env ? <p className="faint small">Harta etapelor nu e disponibilă.</p> : (
        <>
          <ul className="plain small">{env.stages.map((s) => <li key={s.stage}><Chip tone={s.boundary === "environment" ? "ok" : s.boundary === "blocked" ? "warn" : "neutral"}>{s.label}</Chip> {s.where}</li>)}</ul>
          <p className="small">{env.realProjectEligible ? "Toate etapele cu cod rulează în granița mediului atestat." : "REAL_PROJECT_ELIGIBLE: nu — " + (env.blockers || []).slice(0, 3).join(" · ")}</p>
          {/* M10.2: the fix for a real project is its route + the attested environment (never the R2 risk acceptance). */}
          {!env.realProjectEligible && c.project.kind === "real" && <a className="btn sm ghost" href="#/system?tab=environments">Sistem → Medii (ruta și atestarea)</a>}
        </>
      )}
      <Src>Proiect {c.project.kind === "test" ? "de test: execuția e permisă fără izolarea completă" : "real: execuția cere izolarea verificată și aprobarea (b)"}.</Src>
    </CardShell>
  );
}

export function DiffPanel({ missionId, ...rest }) {
  const v = useFactory(missionId);
  const cs = v.data?.changeSets?.find((c) => c.status === "CURRENT");
  return (
    <CardShell {...rest} title="Ce s-a schimbat" icon={FileDiff}>
      {v.loading ? <Loading lines={3} /> : !cs ? <Empty title="Niciun change set încă">Writer-ul nu a produs modificări pentru această misiune.</Empty> : (
        <>
          <p className="small">Change set {cs.seq} · {cs.changes.length} fișiere · sha {String(cs.sha256).slice(0, 12)}{cs.diffTruncated ? " · diff trunchiat" : ""}</p>
          <ul className="plain small">{cs.changes.slice(0, 12).map((f) => <li key={f.path}><span className="mono">{f.path}</span> <Src>{f.status}</Src></li>)}</ul>
          <DiffView diff={cs.diffText} />
        </>
      )}
    </CardShell>
  );
}

export function TestPanel({ missionId, ...rest }) {
  const v = useFactory(missionId);
  const rows = (v.data?.evidence || []).filter((e) => !e.stale);
  // M11 L5: during the proof the Hub's test must fail (labelled „așteptat”); the owner's summary appears once the test is protected.
  const authoring = v.data?.authoring || null;
  const protectedSummary = testFirstSummary(v.data);
  return (
    <CardShell {...rest} title="Teste și verificări" icon={ListChecks}>
      {protectedSummary && <Notice tone="ok" title="Pasul 0 încheiat">{protectedSummary}</Notice>}
      {v.loading ? <Loading lines={3} /> : !rows.length ? <Empty title="Nicio verificare rulată">Nu există rezultate de teste pentru această misiune.</Empty> : (
        <table className="table small"><thead><tr><th>Etapa</th><th>Comanda</th><th>Rezultat</th><th>Număr</th><th>Unde</th></tr></thead>
          <tbody>{rows.map((e) => { const r = evidenceResult(e, authoring); return <tr key={e.id}><td>{evidenceStageLabel(e.stage)}</td><td className="mono">{e.command}</td><td><Chip tone={r.tone || EVIDENCE_TONE[e.status] || "neutral"}>{r.label}</Chip>{r.note && <div className="faint small">{r.note}</div>}</td>
            <td>{e.counts?.tests !== undefined ? `${e.counts.pass ?? "?"}/${e.counts.tests}` : "—"}</td><td className="faint">{e.runner}</td></tr>; })}</tbody></table>
      )}
      <Src>Numerele vin din ieșirea testelor (TAP); fără raportare per test, nu inventez progres.</Src>
    </CardShell>
  );
}

export function ReviewPanel({ missionId, ...rest }) {
  const v = useFactory(missionId);
  const reviews = v.data?.reviews || [];
  const findings = v.data?.findings || [];
  return (
    <CardShell {...rest} title="Review (Claude, doar citire)" icon={MessageSquareText}>
      {v.loading ? <Loading lines={3} /> : !reviews.length ? <Empty title="Niciun review încă" /> : (
        <>
          {reviews.slice(-2).map((r) => <div key={r.id} className="stack tight"><div className="row"><Chip tone={r.verdict === "PASS" ? "ok" : r.verdict === "CHANGES_REQUESTED" ? "warn" : "neutral"}>{r.verdict}</Chip><span className="faint small">{r.status} · change set {String(r.changeSetSha).slice(0, 12)}</span></div><p className="small">{r.summary}</p></div>)}
          {findings.length > 0 && <ul className="plain small">{findings.slice(0, 8).map((f) => <li key={f.id}><Chip tone={f.severity === "high" || f.severity === "critical" ? "error" : "neutral"}>{f.code} {f.severity}</Chip> {f.file} — {f.observation} <Src>{f.status}</Src></li>)}</ul>}
        </>
      )}
    </CardShell>
  );
}

/** Read-only, historical replay with a seek slider; "Revino la acum" leaves it without mixing it with live state. */
export function Replay({ missionId, onExit, ...rest }) {
  const r = useResource(missionId ? `/api/missions/${missionId}/replay` : null);
  const [i, setI] = useState(0);
  const frames = r.data?.frames || [];
  useEffect(() => { if (r.data?.firstFailure) setI(Math.max(0, frames.indexOf(frames.find((f) => f.at === r.data.firstFailure.at && f.title === r.data.firstFailure.title)))); }, [r.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const f = frames[i];
  return (
    <CardShell {...rest} title="Reluare (doar citire, istoric)" icon={History} actions={<button className="btn sm" onClick={onExit}><Rewind size={13} />Revino la acum</button>}>
      {r.loading ? <Loading lines={3} /> : !frames.length ? <Empty title="Nimic de reluat" /> : (
        <div className="stack tight replay">
          <Notice tone="info" title="READ_ONLY · HISTORICAL">Nimic nu se re-execută; niciun grant sau unealtă nu e creat.</Notice>
          <input type="range" min={0} max={frames.length - 1} value={i} onChange={(e) => setI(Number(e.target.value))} aria-label="Momentul din reluare" />
          <div className="row between small"><span>{i + 1} / {frames.length}</span><span className="mono">{fmt.dateTime(f.at)}</span></div>
          <p><Chip tone={f.kind === "evidence" && f.refs.status === "FAIL" ? "error" : "neutral"}>{f.kind}</Chip> <strong>{f.title}</strong></p>
          {f.detail && <pre className="pre small">{f.detail}</pre>}
          <div className="row wrap">{["evidence", "finding", "review", "change_set"].map((k) => { const idx = frames.findIndex((x, j) => j > i && x.kind === k); return idx > 0 ? <button key={k} className="btn sm ghost" onClick={() => setI(idx)}>următorul {k}</button> : null; })}</div>
        </div>
      )}
    </CardShell>
  );
}

export function Preview({ missionId, ...rest }) {
  const v = useFactory(missionId);
  const pv = (v.data?.evidence || []).filter((e) => e.stage === "PREVIEW" && !e.stale).slice(-1)[0];
  const e2e = (v.data?.evidence || []).filter((e) => e.stage === "E2E" && !e.stale);
  return (
    <CardShell {...rest} title="Preview și E2E" icon={MonitorPlay}>
      {!pv ? <Empty title="Niciun preview încă" /> : (
        <dl className="kv small">
          <dt>Preview</dt><dd><Chip tone={EVIDENCE_TONE[pv.status]}>{pv.status}</Chip> {pv.detail?.reason}</dd>
          <dt>Unde</dt><dd>{pv.isolation}</dd>
          <dt>URL</dt><dd className="mono">{pv.detail?.url}{/bwrap/.test(pv.isolation || "") ? " (doar în namespace-ul mediului; nu e accesibil din browserul tău, intenționat)" : ""}</dd>
          {e2e.map((e) => <Fragment key={e.id}><dt>{e.command}</dt><dd><Chip tone={EVIDENCE_TONE[e.status]}>{e.status}</Chip> {e.outputTail || e.detail?.error || ""}</dd></Fragment>)}
        </dl>
      )}
    </CardShell>
  );
}

export function Briefing({ projectId, ...rest }) {
  const d = useResource(projectId ? `/api/cockpit/${projectId}/delta` : null);
  return (
    <CardShell {...rest} title="Ce s-a schimbat" icon={Newspaper}>
      {d.loading ? <Loading lines={2} /> : !d.data ? null : d.data.firstVisit ? <p className="small">E prima vizită înregistrată pe acest proiect; de acum îți arăt diferențele.</p> : (
        <ul className="plain small">
          <li>De la {fmt.dateTime(d.data.since)}: {d.data.events} evenimente</li>
          <li>Execuții: {d.data.runs.completed} terminate, {d.data.runs.failed} eșuate, {d.data.runs.interrupted} întrerupte</li>
          <li>Livrări gata: {d.data.deliveries} · blocaje: {d.data.blocked} · acceptate: {d.data.accepted}</li>
        </ul>
      )}
      <Src>{d.data?.timezoneNote}</Src>
    </CardShell>
  );
}

export function Explain({ data, ...rest }) {
  if (!data) return null;
  return (
    <CardShell {...rest} title="Explicație" icon={HelpCircle}>
      {data.runs && (data.idle ? <p className="small">Acum nu rulează nimic.</p> : <ul className="plain small">{data.runs.map((r) => <li key={r.runId}><strong>{r.provider}</strong> · {r.stage || "—"} · {r.environment} · {r.phase} · {r.elapsedS ?? "?"} s{r.stale ? ` · fără activitate de ${r.quietS} s` : ""} <Src>ultimul eveniment: {r.lastConfirmed?.type || "—"} · progres {r.progress}</Src></li>)}{data.missions.map((m) => <li key={m.missionId}>„{m.title}” · {m.stage}{m.reason ? ` — ${m.reason}` : ""}</li>)}</ul>)}
      {data.items && (data.items.length ? <ul className="plain small">{data.items.map((i, k) => <li key={k}><strong>{i.what}</strong>: {i.rule}<div className="faint">→ {i.action}</div></li>)}</ul> : <p className="small">Nimic nu e blocat.</p>)}
      {data.reason && <p className="small">{data.reason}{data.plan ? ` · model ${data.plan.model || "—"}, efort ${data.plan.effort || "—"}` : ""} <Src>{data.source}</Src></p>}
    </CardShell>
  );
}

export function CompanyMap({ departmentKey, onDepartment, ...rest }) {
  const map = useResource("/api/company/map", { reloadOn: (e) => e.type.startsWith("run.") || e.type.startsWith("factory.") });
  const depts = map.data?.departments || [];
  const focus = depts.find((d) => d.key === departmentKey) || null;
  return (
    <CardShell {...rest} title={focus ? `Companie › ${focus.name}` : "Compania"} icon={Building2} actions={focus && <button className="btn sm ghost" onClick={() => onDepartment(null)}>Înapoi</button>}>
      {map.loading ? <Loading lines={3} /> : !focus ? (
        <ul className="plain company-list">{depts.map((d) => <li key={d.key}><button className="link-btn" onClick={() => onDepartment(d.key)}>{d.name}</button> <Src>{d.rolesConfigured} roluri configurate · {d.missions.length} misiuni · {d.activeExecutions} execuții active</Src></li>)}</ul>
      ) : (
        <ul className="plain">{focus.missions.length ? focus.missions.map((m) => <li key={m.id}><a href={`#/missions/${m.id}`}>{m.title}</a> <Src>{m.stage || m.status}{waitSuffix(m.waitReason, m.stage)}</Src>{m.executions.map((x) => <div key={x.runId} className="small">↳ {x.provider} · {x.environment} · {x.phase}</div>)}</li>) : <li className="faint small">Nicio misiune în departament.</li>}</ul>
      )}
      <Src>{map.data?.note}</Src>
    </CardShell>
  );
}
