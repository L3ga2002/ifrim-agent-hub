import { useEffect, useRef, useState } from "react";
import { ListChecks, Check, X, Pause, Play, ShieldCheck, KeyRound } from "lucide-react";
import { api } from "../../api.js";
import { useHub, useResource, useAction, pushToast, refresh } from "../../store.js";
import { Chip, Notice, ErrorNotice } from "../../components/ui.jsx";
import { withReauth } from "../../lib/ownerSession.js";
import { setPresentedPlan, clearPresentedPlan } from "../../lib/voiceContext.js";
import { cardFocusWanted, holdsTypedText } from "../../lib/uiLogic.js";
import { PLAN_STATUS_LABELS, STEP_STATUS_LABELS, planTone, stepTone, planActions, planNeedsObsPassword, planNeedsStepUp } from "../../lib/opsLogic.js";
import { rearmRequiredOf, rearmOutcome } from "../../lib/rearmLogic.js";
import { CardShell } from "./cards.jsx";
import { RearmCard } from "./RearmCard.jsx";

/**
 * M10 operation plan card: exactly what will happen (apps, folders, what is read, what leaves the computer, outputs, model, limits,
 * what never happens) and ONE confirmation. Decisions inside the card (a new app or folder) are highlighted and ask Windows Hello
 * again; a secret a step needs (the OBS WebSocket password) is typed here and sent only with the confirmation (never stored).
 * While it runs: each step's verified state, Pauză / Anulează, and „Continuă” when it waits for you.
 * 2.12.1 (D22): a plan the current Stop All itself paused is resumed only after the rearm — the Hub refuses „Continuă” with
 * GATE_REARM_REQUIRED and this card shows why plus the same rearm card (the cockpit's slot through `onRearm`, or inline elsewhere);
 * the rearm restarts nothing: after it, „Continuă” on this card resumes the plan.
 */
export function OpsPlanCard({ plan: shown, onClose, focusTarget = null, onRearm = null, ...rest }) {
  const live = useResource(shown?.id ? `/api/ops/plans/${shown.id}` : null, { reloadOn: (e) => e.type.startsWith("ops.") || e.type.startsWith("desktop.") || e.type.startsWith("media.render.") });
  const plan = live.data || shown;
  const [obsPassword, setObsPassword] = useState("");
  const actions = planActions(plan);
  const needsPassword = planNeedsObsPassword(plan);
  // M10.2 (U15): a plan the Hub just announced is focused: Enter confirms THIS card (keyboard modality). When the plan needs the OBS
  // password the focus goes to that field, and Enter there confirms with it — the typed path; the password stays in this component's
  // memory, is sent only with the confirmation and is cleared right after (never stored, never in the conversation).
  // Review #37/#38: only a focus request naming THIS plan, once per request and while it is fresh (never a counter shared with the
  // DecisionCard, never a stale request re-fired by a later plan), never away from text typed in the composer, and the field-vs-card
  // choice only once the plan's shape is known (the Hub's needsSecrets on the card, or the full plan read back).
  const box = useRef(null);
  const passRef = useRef(null);
  const focusHandled = useRef(null);
  const shapeKnown = Boolean(live.data) || Array.isArray(shown?.needsSecrets);
  useEffect(() => {
    if (!shapeKnown || !cardFocusWanted(focusTarget, { kind: "ops", id: plan?.id, handledTick: focusHandled.current })) return;
    focusHandled.current = focusTarget.tick;
    if (holdsTypedText(document.activeElement, box.current)) return;
    const target = needsPassword && actions.confirm ? passRef.current : box.current;
    target?.focus({ preventScroll: false });
    box.current?.scrollIntoView?.({ block: "nearest" });
  }, [focusTarget?.tick, plan?.id, shapeKnown]); // eslint-disable-line react-hooks/exhaustive-deps
  // While the card waits for you, a sentence spoken to Lega is tagged with THIS plan (the Hub still checks voice + transcript).
  useEffect(() => {
    if (!actions.confirm || !plan?.nonce) return undefined;
    setPresentedPlan({ envelopeId: plan.id, nonce: plan.nonce, hash: plan.hash });
    return () => clearPresentedPlan(plan.id);
  }, [plan?.id, plan?.nonce, actions.confirm]); // eslint-disable-line react-hooks/exhaustive-deps
  const confirm = useAction(async (modality = "click") => {
    const body = { nonce: plan.nonce, displayedHash: plan.hash, modality, ...(needsPassword && obsPassword ? { secrets: { obsPassword } } : {}) };
    const res = await withReauth(() => api(`/api/ops/plans/${plan.id}/confirm`, { method: "POST", body }));
    setObsPassword("");
    pushToast(`opp-${plan.id}`, "ok", res.plan.status === "RUNNING" ? "Confirmat: planul rulează" : `Confirmat: ${PLAN_STATUS_LABELS[res.plan.status] || res.plan.status}`);
    live.reload(); refresh();
  });
  // D22: { reason, trigger, handled } while the Hub asks for the rearm before this plan can resume; cleared once the gate is open again.
  const [rearmNeed, setRearmNeed] = useState(null);
  const rearmSeq = useRef(0);
  const gateStatus = useHub((s) => s.hub?.executionGate?.status || null);
  useEffect(() => { if (gateStatus === "open") setRearmNeed(null); }, [gateStatus]);
  const act = useAction(async (what) => {
    if (what === "resume") setRearmNeed(null);
    let res;
    try {
      res = await (what === "resume" ? withReauth(() => api(`/api/ops/plans/${plan.id}/resume`, { method: "POST", body: {} })) : api(`/api/ops/plans/${plan.id}/${what}`, { method: "POST", body: { reason: what === "pause" ? "Pauză (card)" : "Anulat din card" } }));
    } catch (e) {
      const need = what === "resume" ? rearmRequiredOf(e) : null;
      if (!need) throw e;
      // Not an error of the plan: the stop that paused it holds it until the owner rearms the gate (the same card as everywhere).
      setRearmNeed({ reason: need.reason, trigger: ++rearmSeq.current, handled: 0 });
      onRearm?.(null);
      return null;
    }
    live.reload(); refresh();
    return res;
  });
  if (!plan) return null;
  const s = plan.summary || {};
  const decisions = plan.body?.decisions || plan.decisions || [];
  const canConfirm = actions.confirm && !confirm.pending && !(needsPassword && !obsPassword);
  const onKey = (e) => { if (e.key === "Enter" && canConfirm && (e.target === box.current || e.target === passRef.current)) { e.preventDefault(); confirm.run("keyboard"); } };
  return (
    <CardShell {...rest} title={plan.title || s.headline || "Plan"} icon={ListChecks} actions={onClose && !actions.pause ? <button className="btn sm icon ghost" onClick={onClose} aria-label="Închide cardul"><X size={13} /></button> : null}>
      <div ref={box} tabIndex={-1} className="ops-plan" onKeyDown={onKey}>
      <div className="row wrap">
        <Chip tone={planTone(plan.status)}>{PLAN_STATUS_LABELS[plan.status] || plan.status}</Chip>
        {actions.confirm && <Chip tone="neutral">o singură confirmare</Chip>}
        {plan.consent?.modality && <Chip tone="neutral">confirmat ({plan.consent.modality})</Chip>}
      </div>
      {plan.statusReason && !["PROPOSED", "DONE"].includes(plan.status) && <p className="small">{plan.statusReason}</p>}
      <ol className="ops-steps">
        {(plan.steps?.length ? plan.steps : (s.steps || []).map((title, i) => ({ id: i, seq: i + 1, title, status: "PENDING" }))).map((st) => (
          <li key={st.id ?? st.seq}><span className="ops-step-title">{st.title}</span> <Chip tone={stepTone(st.status)}>{STEP_STATUS_LABELS[st.status] || st.status}</Chip>
            {st.error && st.status !== "DONE" && <span className="faint small block">{String(st.error).replace(/^[A-Z_]+: /, "")}</span>}</li>
        ))}
      </ol>
      <dl className="kv small">
        <dt>Aplicații</dt><dd>{(s.apps || []).length ? s.apps.join(", ") : "niciuna (doar Hub-ul)"}</dd>
        <dt>Foldere</dt><dd>{(s.folders || []).length ? s.folders.join(" · ") : "doar cele aprobate"}</dd>
        <dt>Citește</dt><dd>{(s.observed || []).join(" · ") || "—"}</dd>
        <dt>Pleacă din calculator</dt><dd>{(s.transmitted || []).join(" · ")}</dd>
        <dt>Rezultat</dt><dd>{(s.outputs || []).join(" · ") || "—"}</dd>
        <dt>Model</dt><dd>{s.model || "fără model"}</dd>
        <dt>Limite</dt><dd>{s.limits}</dd>
        <dt>Niciodată</dt><dd className="faint">{(s.never || []).join(", ")}</dd>
      </dl>
      {decisions.length > 0 && actions.confirm && (
        <Notice tone="warn" title="Decizie inclusă în această confirmare">
          <ul className="plain">{decisions.map((d) => <li key={`${d.kind}:${d.appId || d.folder}`}><ShieldCheck size={13} aria-hidden="true" /> {d.label}</li>)}</ul>
          <span className="small">Confirmarea îți cere Windows Hello încă o dată (acces nou). Nu există alt formular.</span>
        </Notice>
      )}
      {needsPassword && actions.confirm && (
        <label className="field"><span><KeyRound size={13} aria-hidden="true" /> Parola OBS WebSocket (din OBS → Tools → WebSocket Server Settings)</span>
          <input ref={passRef} className="input" type="password" autoComplete="off" value={obsPassword} onChange={(e) => setObsPassword(e.target.value)} aria-describedby="obs-pass-help" />
          <span id="obs-pass-help" className="faint small">Se trimite doar cu confirmarea, rămâne în memorie cât rulează planul și nu se salvează nicăieri.</span>
        </label>
      )}
      <ErrorNotice error={confirm.error || act.error} />
      {rearmNeed && actions.resume && (
        <div className="stack tight">
          <Notice tone="warn" title="Întâi redeschiderea porții">{rearmNeed.reason}{onRearm ? " Cardul de redeschidere e în partea de sus a cockpit-ului." : ""}</Notice>
          {!onRearm && <RearmCard compact trigger={rearmNeed.trigger} handled={rearmNeed.handled}
            onTriggerHandled={(seq) => setRearmNeed((r) => (r ? { ...r, handled: Math.max(r.handled || 0, seq) } : r))}
            onDone={(res) => { pushToast("gate-rearm", "ok", `${rearmOutcome(res).toast} Planul îl reiei cu „Continuă”.`); setRearmNeed(null); live.reload(); refresh(); }} />}
        </div>
      )}
      <div className="row wrap">
        {actions.confirm && <button className="btn approve" disabled={confirm.pending || (needsPassword && !obsPassword)} onClick={() => confirm.run("click")}><Check size={15} aria-hidden="true" />{confirm.pending ? (planNeedsStepUp(plan) ? "Aștept Windows Hello…" : "Se confirmă…") : "Confirmă planul"}</button>}
        {actions.confirm && <button className="btn ghost" disabled={act.pending} onClick={() => act.run("cancel").then(() => onClose?.())}><X size={15} aria-hidden="true" />Nu acum</button>}
        {actions.pause && <button className="btn" disabled={act.pending} onClick={() => act.run("pause")}><Pause size={15} aria-hidden="true" />Pauză</button>}
        {actions.resume && <button className="btn primary" disabled={act.pending} onClick={() => act.run("resume")}><Play size={15} aria-hidden="true" />Continuă</button>}
        {actions.cancel && !actions.confirm && <button className="btn ghost" disabled={act.pending} onClick={() => act.run("cancel")}><X size={15} aria-hidden="true" />Anulează</button>}
      </div>
      {actions.confirm && <p className="faint small">{needsPassword ? "Scrie parola OBS aici și apasă Enter sau „Confirmă planul” (parola nu trece prin conversație)." : "Poți apăsa Enter pe card, spune „Da, execută planul” (vocea ta verificată local) sau scrie „Da”."}</p>}
      </div>
    </CardShell>
  );
}
