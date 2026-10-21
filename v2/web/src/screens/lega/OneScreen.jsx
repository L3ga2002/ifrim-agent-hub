import { useEffect, useRef, useState } from "react";
import { Building2, ShieldCheck, Activity, Target, Inbox, HelpCircle, X, Briefcase } from "lucide-react";
import { useHub, useResource } from "../../store.js";
import { Chip, ErrorNotice, Loading } from "../../components/ui.jsx";
import { CardShell } from "./cards.jsx";
import { oppView, proposalView, listOf, salesHref } from "../../lib/salesLogic.js";
import { SalesChip, SyntheticTag, useSalesResource } from "../sales/common.jsx";
import { Preparation } from "../sales/Preparation.jsx";
import { ProposalView } from "../sales/Opportunity.jsx";
import { DECISION_KIND, COMMAND_EXAMPLES, decisionsReload } from "../../lib/legaOneScreen.js";

/**
 * The panels of the one L3ga screen (2026-10-18) around the company map: the company (departments, from the Hub's state), the decisions
 * that wait for the owner („Deciziile mele”, read only: each opens where it is decided) and the executions that run. They read; nothing
 * here decides, confirms or starts anything.
 */
export function CompanyPanel({ onDepartment, go }) {
  const departments = useHub((s) => s.hub?.company?.departments) || [];
  const runs = useHub((s) => s.hub?.activeRuns?.length || 0);
  return (
    <section className="lega-one-panel" aria-label="Compania">
      <div className="stage-title"><Building2 size={13} aria-hidden="true" /> Compania</div>
      <ul className="lega-one-list">{departments.map((d) => (
        <li key={d.key} className={d.status === "active" ? "on" : ""}>
          <button type="button" className="link-btn" onClick={() => onDepartment(d.key)} title="Arată departamentul în ecranul Lega">{d.name}</button>
          <span className="faint">{d.roles} roluri</span>
        </li>
      ))}</ul>
      <p className="faint small" style={{ margin: 0 }}>Structură configurată, nu muncă făcută. Execuții active: {runs}.</p>
      <button type="button" className="btn sm ghost" onClick={() => go("/company")}>Deschide Compania</button>
    </section>
  );
}

/** `inbox` is the screen's GET /api/decisions/inbox resource (the screen also uses it to bring a waiting offer on screen). */
export function useDecisionsInbox() { return useResource("/api/decisions/inbox", { reloadOn: decisionsReload }); }

export function DecisionsPanel({ go, onShowOffer, inbox }) {
  const pending = useHub((s) => s.hub?.pendingApprovals || 0);
  const runs = useHub((s) => s.hub?.activeRuns) || [];
  const items = inbox.data?.items || [];
  return (
    <section className="lega-one-panel" aria-label="Decizii și execuții">
      <div className="stage-title"><Inbox size={13} aria-hidden="true" /> Decizii ({items.length})</div>
      {inbox.loading && !inbox.data ? <Loading lines={2} /> : items.length === 0
        ? <p className="faint small" style={{ margin: 0 }}>Nimic nu așteaptă decizia ta.</p>
        : <ul className="lega-one-list decisions">{items.map((it) => (
          <li key={`${it.kind}:${it.id}`} className="amber stack tight">
            <span className="row wrap"><Chip tone="approval">{DECISION_KIND[it.kind] || it.kind}</Chip><strong className="break">{it.title}</strong></span>
            {it.target && <span className="faint small break">v{it.target.version} · SHA <code className="mono" style={{ overflowWrap: "anywhere" }}>{it.target.proposalSha || it.target.sha}</code></span>}
            <span className="row wrap">
              {it.kind === "sales_offer" && it.opportunityId && <button type="button" className="btn sm approve" onClick={() => onShowOffer(it.opportunityId)}>Arată oferta aici</button>}
              <button type="button" className="btn sm ghost" onClick={() => go(it.link)}>Deschide locul deciziei</button>
            </span>
          </li>
        ))}</ul>}
      <ErrorNotice error={inbox.error} onRetry={inbox.reload} />
      {pending > 0 && <button type="button" className="btn sm ghost" onClick={() => go("/approvals")}><ShieldCheck size={13} />{pending} {pending === 1 ? "aprobare în așteptare" : "aprobări în așteptare"}</button>}
      <div className="stage-title"><Activity size={13} aria-hidden="true" /> Execuții ({runs.length})</div>
      {runs.length === 0 ? <p className="faint small" style={{ margin: 0 }}>Nicio execuție activă.</p>
        : <ul className="lega-one-list">{runs.map((r) => <li key={r.runId}><button type="button" className="link-btn" onClick={() => go(`/conversations/${r.conversationId}`)}>{r.provider} · {r.phase === "streaming" ? "lucrează" : "așteaptă"}</button></li>)}</ul>}
      <span className="row wrap">
        <button type="button" className="btn sm ghost" onClick={() => go("/missions")}><Target size={13} />Misiuni</button>
        <button type="button" className="btn sm ghost" onClick={() => go("/livrare/decizii")}><Inbox size={13} />Deciziile mele</button>
      </span>
    </section>
  );
}

/**
 * The synthetic offer the owner works on, inside the Lega screen: the preparation and „Dosarul ofertei” (the Sales screen's own panel)
 * and the latest version with its exact target and „Aprob intern” (the Sales screen's own view, the same owner-session decision).
 */
export function SalesOfferCard({ oppId, onClose, go }) {
  const res = useSalesResource(oppId ? `/api/sales/opportunities/${encodeURIComponent(oppId)}` : null);
  const d = res.data || {};
  const opp = oppView(d.opportunity ?? d);
  const proposals = listOf(d, "proposals").map(proposalView);
  const latest = proposals.slice().sort((a, b) => b.version - a.version)[0] || null;
  return (
    <CardShell card={{ type: "SalesOffer", size: "l" }} title={opp.title ? `Oferta: ${opp.title}` : "Oferta"} icon={Briefcase} onDismiss={onClose}
      actions={<button type="button" className="btn sm ghost" onClick={() => go(salesHref("opp", { id: oppId }))}>Deschide în Vânzări</button>}>
      {res.loading && !res.data ? <Loading lines={4} /> : res.error && !res.data ? <ErrorNotice error={res.error} onRetry={res.reload} /> : (
        <div className="stack tight lega-one-offer">
          <div className="row wrap">{opp.status && <SalesChip kind="opp" status={opp.status} />}{opp.synthetic && <SyntheticTag />}</div>
          {opp.need && <p className="muted small prewrap" style={{ margin: 0 }}>{opp.need}</p>}
          <Preparation oppId={opp.id || oppId} />
          {latest ? <ProposalView key={`${latest.id}:${latest.sha}`} opp={opp} proposal={latest} proposals={proposals} onChanged={res.reload} />
            : <p className="faint small" style={{ margin: 0 }}>Oferta nu are încă nicio versiune.</p>}
        </div>
      )}
    </CardShell>
  );
}

/** Examples of what to say or type, in a help popover: one click puts an example in the composer (never sends it). */
export function CommandHelp({ onPick }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    const onDown = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("mousedown", onDown); };
  }, [open]);
  return (
    <span className="lega-help" ref={box}>
      <button type="button" className="btn icon" aria-expanded={open} aria-controls="lega-help-list" onClick={() => setOpen((o) => !o)} aria-label="Exemple de comenzi" title="Exemple de comenzi"><HelpCircle size={15} /></button>
      {open && (
        <div className="lega-help-pop" id="lega-help-list" role="dialog" aria-label="Exemple de comenzi">
          <div className="row between"><strong className="small">Ce poți spune sau scrie</strong><button type="button" className="btn sm icon ghost" onClick={() => setOpen(false)} aria-label="Închide exemplele"><X size={13} /></button></div>
          <ul className="plain-list">{COMMAND_EXAMPLES.map((x) => <li key={x}><button type="button" className="link-btn" onClick={() => { onPick(x); setOpen(false); }}>{x}</button></li>)}</ul>
          <p className="faint small" style={{ margin: 0 }}>Un exemplu ales intră în caseta de mesaj; îl trimiți tu. Citirea și planul nu pornesc nimic: tot ce are efecte se confirmă o dată.</p>
        </div>
      )}
    </span>
  );
}
