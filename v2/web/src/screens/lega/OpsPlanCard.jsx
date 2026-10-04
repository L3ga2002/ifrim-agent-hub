import { useEffect, useState } from "react";
import { ListChecks, Check, X, Pause, Play, ShieldCheck, KeyRound } from "lucide-react";
import { api } from "../../api.js";
import { useResource, useAction, pushToast, refresh } from "../../store.js";
import { Chip, Notice, ErrorNotice } from "../../components/ui.jsx";
import { withReauth } from "../../lib/ownerSession.js";
import { setPresentedPlan, clearPresentedPlan } from "../../lib/voiceContext.js";
import { PLAN_STATUS_LABELS, STEP_STATUS_LABELS, planTone, stepTone, planActions, planNeedsObsPassword, planNeedsStepUp } from "../../lib/opsLogic.js";
import { CardShell } from "./cards.jsx";

/**
 * M10 operation plan card: exactly what will happen (apps, folders, what is read, what leaves the computer, outputs, model, limits,
 * what never happens) and ONE confirmation. Decisions inside the card (a new app or folder) are highlighted and ask Windows Hello
 * again; a secret a step needs (the OBS WebSocket password) is typed here and sent only with the confirmation (never stored).
 * While it runs: each step's verified state, Pauză / Anulează, and „Continuă” when it waits for you.
 */
export function OpsPlanCard({ plan: shown, onClose, ...rest }) {
  const live = useResource(shown?.id ? `/api/ops/plans/${shown.id}` : null, { reloadOn: (e) => e.type.startsWith("ops.") || e.type.startsWith("desktop.") || e.type.startsWith("media.render.") });
  const plan = live.data || shown;
  const [obsPassword, setObsPassword] = useState("");
  const actions = planActions(plan);
  const needsPassword = planNeedsObsPassword(plan);
  // While the card waits for you, a sentence spoken to Lega is tagged with THIS plan (the Hub still checks voice + transcript).
  useEffect(() => {
    if (!actions.confirm || !plan?.nonce) return undefined;
    setPresentedPlan({ envelopeId: plan.id, nonce: plan.nonce, hash: plan.hash });
    return () => clearPresentedPlan(plan.id);
  }, [plan?.id, plan?.nonce, actions.confirm]); // eslint-disable-line react-hooks/exhaustive-deps
  const confirm = useAction(async () => {
    const body = { nonce: plan.nonce, displayedHash: plan.hash, modality: "click", ...(needsPassword && obsPassword ? { secrets: { obsPassword } } : {}) };
    const res = await withReauth(() => api(`/api/ops/plans/${plan.id}/confirm`, { method: "POST", body }));
    setObsPassword("");
    pushToast(`opp-${plan.id}`, "ok", res.plan.status === "RUNNING" ? "Confirmat: planul rulează" : `Confirmat: ${PLAN_STATUS_LABELS[res.plan.status] || res.plan.status}`);
    live.reload(); refresh();
  });
  const act = useAction(async (what) => {
    const res = await (what === "resume" ? withReauth(() => api(`/api/ops/plans/${plan.id}/resume`, { method: "POST", body: {} })) : api(`/api/ops/plans/${plan.id}/${what}`, { method: "POST", body: { reason: what === "pause" ? "Pauză (card)" : "Anulat din card" } }));
    live.reload(); refresh();
    return res;
  });
  if (!plan) return null;
  const s = plan.summary || {};
  const decisions = plan.body?.decisions || plan.decisions || [];
  return (
    <CardShell {...rest} title={plan.title || s.headline || "Plan"} icon={ListChecks} actions={onClose && !actions.pause ? <button className="btn sm icon ghost" onClick={onClose} aria-label="Închide cardul"><X size={13} /></button> : null}>
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
          <input className="input" type="password" autoComplete="off" value={obsPassword} onChange={(e) => setObsPassword(e.target.value)} aria-describedby="obs-pass-help" />
          <span id="obs-pass-help" className="faint small">Se trimite doar cu confirmarea, rămâne în memorie cât rulează planul și nu se salvează nicăieri.</span>
        </label>
      )}
      <ErrorNotice error={confirm.error || act.error} />
      <div className="row wrap">
        {actions.confirm && <button className="btn approve" disabled={confirm.pending || (needsPassword && !obsPassword)} onClick={() => confirm.run()}><Check size={15} aria-hidden="true" />{confirm.pending ? (planNeedsStepUp(plan) ? "Aștept Windows Hello…" : "Se confirmă…") : "Confirmă planul"}</button>}
        {actions.confirm && <button className="btn ghost" disabled={act.pending} onClick={() => act.run("cancel").then(() => onClose?.())}><X size={15} aria-hidden="true" />Nu acum</button>}
        {actions.pause && <button className="btn" disabled={act.pending} onClick={() => act.run("pause")}><Pause size={15} aria-hidden="true" />Pauză</button>}
        {actions.resume && <button className="btn primary" disabled={act.pending} onClick={() => act.run("resume")}><Play size={15} aria-hidden="true" />Continuă</button>}
        {actions.cancel && !actions.confirm && <button className="btn ghost" disabled={act.pending} onClick={() => act.run("cancel")}><X size={15} aria-hidden="true" />Anulează</button>}
      </div>
      {actions.confirm && <p className="faint small">Poți spune și „Da, execută planul” (vocea ta verificată local) sau scrie „Da”.</p>}
    </CardShell>
  );
}
