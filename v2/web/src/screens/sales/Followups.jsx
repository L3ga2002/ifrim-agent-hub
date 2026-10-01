import { useState, useCallback } from "react";
import { CalendarClock } from "lucide-react";
import { pushToast } from "../../store.js";
import { Panel, Empty, Loading, ErrorNotice } from "../../components/ui.jsx";
import { followupView, followupState, followupDraftable, FOLLOWUP_STATE_META, FOLLOWUP_BASIS_RO, listOf, salesHref } from "../../lib/salesLogic.js";
import { SalesChip, useSalesResource, useSalesCommand, ApprovalGate, SalesError, when } from "./common.jsx";

const FILTERS = [["active", "Active"], ["suspended", "Suspendate"], ["all", "Toate"]];
const ORDER = { overdue: 0, due: 1, upcoming: 2, suspended: 3, closed: 4 };
const DONE_TEXT = { done: "Follow-up marcat ca făcut", suspend: "Follow-up suspendat", resume: "Follow-up reluat", cancel: "Follow-up anulat" };

function FollowupRow({ f, state, onChanged }) {
  const [note, setNote] = useState("");
  const cmd = useSalesCommand(useCallback(async (_r, action) => { setNote(""); pushToast(`sales-fu-${action}`, "ok", DONE_TEXT[action] || "Follow-up actualizat"); onChanged(); }, [onChanged]));
  const draft = useSalesCommand(useCallback(async () => { pushToast("sales-fu-draft", "ok", "Ciornă de follow-up pregătită (nu s-a trimis nimic)"); onChanged(); }, [onChanged]));
  const meta = FOLLOWUP_STATE_META[state];
  const run = (action) => cmd.run(`/api/sales/followups/${encodeURIComponent(f.id)}/${action}`, { reason: note.trim() }, action);
  const open = state !== "closed";
  const oppHref = f.opportunityId ? `#${salesHref("opp", { id: f.opportunityId })}` : null;
  return (
    <li>
      <div className="stack tight sales-followup">
        <div className="row wrap">
          <span className={`chip ${meta.tone}`}>{meta.label}</span>
          <SalesChip kind="followup" status={f.status} />
          <span className="nowrap">{when(f.dueAt)}</span>
          <span className="grow break">{oppHref ? <a href={oppHref}>{f.oppTitle || "Oportunitatea"}</a> : (f.oppTitle || "—")}{f.orgName && <span className="faint"> · {f.orgName}</span>}</span>
        </div>
        <div className="faint small break">{f.basis ? `Bază: ${FOLLOWUP_BASIS_RO[f.basis] || f.basis}` : ""}{f.reason ? ` · ${f.reason}` : ""}{f.expiresAt ? ` · expiră ${when(f.expiresAt)}` : ""}</div>
        {f.draftId && <div className="small">Ciornă pregătită{oppHref ? <> · <a href={oppHref}>vezi ciorna în oportunitate</a></> : null}</div>}
        {f.status === "DUE" && followupDraftable(f) && (
          <div className="row wrap">
            <button type="button" className="btn sm primary" disabled={draft.busy} onClick={() => draft.run(`/api/sales/followups/${encodeURIComponent(f.id)}/draft`, {})}>{draft.busy ? "Se pregătește…" : "Pregătește ciorna"}</button>
            <span className="faint small">Ciorna rămâne în Hub; contactul îl faci tu.</span>
          </div>
        )}
        {open && (
          <div className="sales-inline-form">
            <input className="input grow" value={note} maxLength={200} placeholder="Notă (obligatorie la suspendare și anulare)" aria-label="Notă" onChange={(e) => setNote(e.target.value)} />
            {state !== "suspended" && <button type="button" className="btn sm" disabled={cmd.busy} onClick={() => run("done")}>Făcut</button>}
            {state !== "suspended" ? <button type="button" className="btn sm" disabled={cmd.busy || note.trim().length < 3} onClick={() => run("suspend")}>Suspendă</button>
              : <button type="button" className="btn sm" disabled={cmd.busy} onClick={() => run("resume")}>Reia</button>}
            <button type="button" className="btn sm ghost" disabled={cmd.busy || note.trim().length < 3} onClick={() => run("cancel")}>Anulează</button>
          </div>
        )}
        <ErrorNotice error={cmd.error || draft.error} />
        <ApprovalGate gate={cmd.approval || draft.approval} onDone={() => { cmd.clearApproval(); draft.clearApproval(); onChanged(); }} onDismiss={() => { cmd.clearApproval(); draft.clearApproval(); }} />
      </div>
    </li>
  );
}

/** Follow-up: due, overdue and suspended reminders; nothing is sent, each one is a task for the owner. */
export function Followups() {
  const res = useSalesResource("/api/sales/followups");
  const [filter, setFilter] = useState("active");
  if (res.loading && !res.data) return <Loading lines={5} />;
  if (res.error && !res.data) return <SalesError error={res.error} onRetry={res.reload} what="follow-up-urile" />;
  const now = new Date();
  const all = listOf(res.data, "followups").map((raw) => ({ f: followupView(raw), state: followupState(raw, now) }))
    .sort((a, b) => ORDER[a.state] - ORDER[b.state] || (a.f.dueAt || "").localeCompare(b.f.dueAt || ""));
  const shown = all.filter(({ state }) => filter === "all" || (filter === "suspended" ? state === "suspended" : ["overdue", "due", "upcoming"].includes(state)));
  const overdue = all.filter((x) => x.state === "overdue").length;
  return (
    <Panel title={`Follow-up${overdue ? ` · ${overdue} depășite` : ""}`} icon={CalendarClock}
      actions={<div className="seg" role="group" aria-label="Filtru follow-up">{FILTERS.map(([k, l]) => <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>)}</div>}>
      {shown.length ? <ul className="list sales-followups" aria-busy={res.loading}>{shown.map(({ f, state }) => <FollowupRow key={f.id} f={f} state={state} onChanged={res.reload} />)}</ul>
        : <Empty title={filter === "suspended" ? "Niciun follow-up suspendat" : "Niciun follow-up"}>Follow-up-urile se programează din pagina unei oportunități. Hub-ul nu trimite nimic: îți amintește doar ce ai de făcut; când devin scadente poți pregăti o ciornă.</Empty>}
    </Panel>
  );
}
