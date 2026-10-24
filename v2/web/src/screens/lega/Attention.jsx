import { useMemo, useState } from "react";
import { Inbox, Search, History, ExternalLink, Building2, ChevronDown, ChevronRight } from "lucide-react";
import { useHub, useResource } from "../../store.js";
import { fmt } from "../../api.js";
import { Chip, ErrorNotice, Loading } from "../../components/ui.jsx";
import { StatePill, MeaningChip } from "../../components/StatePill.jsx";
import { attentionItems, attentionSummary, currentActivity, historyRows } from "../../lib/stateVocab.js";
import { DECISION_KIND } from "../../lib/legaOneScreen.js";

/**
 * M15 — the three zones of the one L3ga screen share these read-only parts: „Ce te așteaptă” (every decision, blocker, error, run and
 * outdated result in one list, from the Hub's own lists), the open activity's header (its state and ONE primary action) and the history
 * (results and revisions by name and date, never an id to remember). None of them decides, confirms or starts anything: each row opens the
 * place where the owner decides, in his session.
 */
export const deskReloadOn = (e) => /^desk\./.test(String(e?.type || ""));
export const deliveriesReloadOn = (e) => /^(delivery|factory)\./.test(String(e?.type || ""));

export function useAttentionSources() {
  const desk = useResource("/api/desk/records?limit=40", { reloadOn: deskReloadOn });
  const deliveries = useResource("/api/deliveries", { reloadOn: deliveriesReloadOn });
  return { desk, deliveries };
}

export function AttentionPanel({ inbox, sources, projectId, workRequests = [], plans = [], go, onShowOffer, onOpenDesk, onOpenPlan }) {
  const runs = useHub((s) => s.hub?.activeRuns) || NO_LIST;
  const pending = useHub((s) => s.hub?.pendingApprovals || 0);
  const [onlyProject, setOnlyProject] = useState(false);
  const items = useMemo(() => [...plans, ...attentionItems({ inbox: inbox.data?.items, desk: sources.desk.data?.records, deliveries: sources.deliveries.data?.deliveries, runs, workRequests,
    projectId: onlyProject ? projectId : null })], [plans, inbox.data, sources.desk.data, sources.deliveries.data, runs, workRequests, onlyProject, projectId]);
  const loading = (inbox.loading && !inbox.data) || (sources.desk.loading && !sources.desk.data);
  return (
    <section className="lega-one-panel attention" aria-label="Ce te așteaptă">
      <div className="stage-title row between"><span className="row"><Inbox size={13} aria-hidden="true" /> Ce te așteaptă</span>
        {projectId && <label className="small faint row"><input type="checkbox" checked={onlyProject} onChange={(e) => setOnlyProject(e.target.checked)} />doar proiectul</label>}</div>
      <p className="faint small" style={{ margin: 0 }} role="status">{attentionSummary(items)}</p>
      {loading ? <Loading lines={3} /> : items.length === 0 ? null : (
        <ul className="attention-list">{items.map((it) => (
          <li key={it.key} className={`attention-item st-${it.state}`}>
            <div className="row between wrap" style={{ alignItems: "flex-start" }}>
              <strong className="break attention-title">{it.title}</strong>
              <StatePill state={it.state} status={it.status} />
            </div>
            <span className="row wrap small">{it.kind && DECISION_KIND[it.kind] && <Chip tone="approval">{DECISION_KIND[it.kind]}</Chip>}{it.synthetic && <span className="faint">date sintetice</span>}{it.testProject && <span className="faint">proiect de test</span>}{it.at && <span className="faint">{fmt.ago(it.at)}</span>}</span>
            {it.sub && <span className="faint small break attention-sub">{it.sub}</span>}
            {it.next && <span className="small break">Următoarea acțiune: {it.next}</span>}
            {it.target && <span className="faint small break">v{it.target.version} · SHA <code className="mono" style={{ overflowWrap: "anywhere" }}>{it.target.proposalSha || it.target.sha}</code></span>}
            <span className="row wrap">
              {it.plan && <button type="button" className="btn sm approve" onClick={() => onOpenPlan(it.plan)}>Vezi planul aici</button>}
              {it.kind === "sales_offer" && it.opportunityId && <button type="button" className="btn sm approve" onClick={() => onShowOffer(it.opportunityId)}>Arată oferta aici</button>}
              {it.deskRecordId ? <button type="button" className={`btn sm ${it.state === "decide" ? "approve" : ""}`} onClick={() => onOpenDesk(it.deskRecordId)}>{it.state === "decide" ? "Arată decizia aici" : "Arată aici"}</button>
                : it.link && <button type="button" className={`btn sm ${it.state === "decide" ? "" : "ghost"}`} onClick={() => go(it.link)}>{it.state === "decide" ? "Deschide locul deciziei" : it.state === "run" ? "Urmăresc" : "Deschide"}</button>}
            </span>
          </li>
        ))}</ul>
      )}
      <ErrorNotice error={inbox.error || sources.desk.error} onRetry={() => { inbox.reload(); sources.desk.reload(); }} />
      <span className="row wrap">
        {pending > 0 && <button type="button" className="btn sm ghost" onClick={() => go("/approvals")}>{pending} {pending === 1 ? "aprobare tehnică" : "aprobări tehnice"}</button>}
        <button type="button" className="btn sm ghost" onClick={() => go("/livrare/decizii")}>Deciziile mele</button>
        <button type="button" className="btn sm ghost" onClick={() => go("/rezultate")}><History size={13} />Rezultate</button>
      </span>
    </section>
  );
}
const NO_LIST = [];

/** The company's departments, folded by default (structure, not work): one click shows a department on the screen. */
export function CompanyFold({ onDepartment, go }) {
  const departments = useHub((s) => s.hub?.company?.departments) || NO_LIST;
  const [open, setOpen] = useState(false);
  return (
    <section className="lega-one-panel company-fold" aria-label="Compania">
      <button type="button" className="link-btn row stage-title" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}<Building2 size={13} aria-hidden="true" /> Compania ({departments.length} departamente)</button>
      {open && <>
        <ul className="lega-one-list">{departments.map((d) => (
          <li key={d.key} className={d.status === "active" ? "on" : ""}><button type="button" className="link-btn" onClick={() => onDepartment(d.key)}>{d.name}</button><span className="faint">{d.roles} roluri</span></li>
        ))}</ul>
        <p className="faint small" style={{ margin: 0 }}>Structură configurată, nu muncă făcută.</p>
        <button type="button" className="btn sm ghost" onClick={() => go("/company")}>Deschide Compania</button>
      </>}
    </section>
  );
}

/** The open activity: where you are, its state in words and ONE primary action (or none while the Hub only reads). */
export function ActivityHeader({ activity, onPrimary }) {
  if (!activity) return null;
  return (
    <section className={`activity-head st-${activity.state}`} aria-label="Activitatea deschisă">
      <span className="faint small">{activity.context}</span>
      <div className="row between wrap" style={{ alignItems: "flex-start" }}><h2 className="break">{activity.title}</h2><StatePill state={activity.state} /></div>
      {activity.sub && <p className="small muted break" style={{ margin: 0 }}>{activity.sub}</p>}
      {activity.primary && <div className="row wrap"><button type="button" className={`btn ${activity.state === "decide" ? "approve" : "primary"}`} data-activity-primary={activity.primary.kind} onClick={() => onPrimary(activity.primary)}>{activity.primary.label}</button></div>}
    </section>
  );
}

export { currentActivity };

/** Results and revisions, newest first, by name and date; a search box filters by words (no id needed). */
export function HistoryList({ projectId = null, go, onOpenDesk, compact = false }) {
  const deliveries = useResource("/api/deliveries", { reloadOn: deliveriesReloadOn });
  const desk = useResource("/api/desk/records?limit=60", { reloadOn: deskReloadOn });
  const opps = useResource("/api/sales/opportunities?limit=50", { reloadOn: (e) => /^sales\./.test(String(e?.type || "")) });
  const missions = useResource("/api/factory", { reloadOn: (e) => /^factory\./.test(String(e?.type || "")) });
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState(projectId ? "project" : "all");
  const rows = useMemo(() => historyRows({ deliveries: deliveries.data?.deliveries, desk: desk.data?.records, opportunities: opps.data?.items, missions: missions.data?.missions },
    { query, projectId: scope === "project" ? projectId : null }), [deliveries.data, desk.data, opps.data, missions.data, query, scope, projectId]);
  const loading = (deliveries.loading && !deliveries.data) || (desk.loading && !desk.data);
  return (
    <div className="stack tight history">
      <div className="row wrap">
        <label className="grow history-search"><Search size={14} aria-hidden="true" /><span className="sr-only">Caută în istoric</span>
          <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Caută: ofertă, deviz, livrare, OPS-0001…" /></label>
        {projectId && <select className="input" value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Ce istoric"><option value="project">acest proiect</option><option value="all">toată compania</option></select>}
      </div>
      {loading ? <Loading lines={4} /> : rows.length === 0 ? <p className="faint small" style={{ margin: 0 }}>{query ? "Nimic găsit pentru aceste cuvinte." : "Încă nu există rezultate."}</p> : (
        <ul className="history-list">{rows.slice(0, compact ? 30 : 200).map((r) => (
          <li key={r.key}>
            <time className="faint small" dateTime={r.at || undefined}>{r.at ? fmt.dateTime(r.at) : "—"}</time>
            <span className="stack" style={{ gap: 2, minWidth: 0 }}><span className="break"><span className="faint small">{r.kind} · </span>{r.title}</span>{r.why && <span className="faint small break">{r.why}</span>}</span>
            <span className="row wrap" style={{ justifyContent: "flex-end" }}>
              {r.meaning ? <MeaningChip meaning={r.meaning} /> : <StatePill state={r.state} status={r.status} />}
              {r.deskRecordId && onOpenDesk ? <button type="button" className="btn sm ghost" onClick={() => onOpenDesk(r.deskRecordId)}>Arată</button>
                : <button type="button" className="btn sm ghost" onClick={() => go(r.link)} aria-label={`Deschide: ${r.title}`}><ExternalLink size={13} /></button>}
            </span>
          </li>
        ))}</ul>
      )}
      <ErrorNotice error={deliveries.error || desk.error || opps.error} onRetry={() => { deliveries.reload(); desk.reload(); opps.reload(); }} />
    </div>
  );
}
