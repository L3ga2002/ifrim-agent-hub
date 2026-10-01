import { useRef, useState, useEffect } from "react";
import { LayoutDashboard, Upload, Building2, Fingerprint, KanbanSquare, Target, CalendarClock, Tags, Search } from "lucide-react";
import "../styles/m04.css";
import { useViewport } from "../components/Layout.jsx";
import { SALES_TABS, MOBILE_TAB_ORDER, salesRoute, salesHref, syntheticBannerFor, realOrgCount } from "../lib/salesLogic.js";
import { SyntheticBanner, useSalesResource } from "./sales/common.jsx";
import { Overview } from "./sales/Overview.jsx";
import { Imports } from "./sales/Imports.jsx";
import { Orgs } from "./sales/Orgs.jsx";
import { OrgSheet } from "./sales/OrgSheet.jsx";
import { Pipeline } from "./sales/Pipeline.jsx";
import { Opportunity } from "./sales/Opportunity.jsx";
import { Followups } from "./sales/Followups.jsx";
import { Services } from "./sales/Services.jsx";

const ICONS = { overview: LayoutDashboard, imports: Upload, orgs: Building2, org: Fingerprint, pipeline: KanbanSquare, opp: Target, followups: CalendarClock, services: Tags };

/** Accessible tab bar (arrows, Home/End), the same pattern as Sistem/Ecosisteme; tabs are links in the hash. */
function SalesTabs({ tabs, value, onChange }) {
  const refs = useRef({});
  const onKeyDown = (e, index) => {
    const next = e.key === "ArrowRight" ? (index + 1) % tabs.length : e.key === "ArrowLeft" ? (index - 1 + tabs.length) % tabs.length : e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : null;
    if (next === null) return;
    e.preventDefault();
    onChange(tabs[next].id);
    refs.current[tabs[next].id]?.focus();
  };
  return (
    <div className="tabs page-tabs sales-tabs" role="tablist" aria-label="Secțiuni vânzări">
      {tabs.map((t, i) => {
        const Icon = ICONS[t.id];
        return (
          <button key={t.id} type="button" role="tab" id={`sales-tab-${t.id}`} aria-controls="sales-panel" aria-selected={value === t.id} tabIndex={value === t.id ? 0 : -1}
            ref={(el) => { refs.current[t.id] = el; }} onClick={() => onChange(t.id)} onKeyDown={(e) => onKeyDown(e, i)}>
            {Icon && <Icon size={14} aria-hidden="true" />}{t.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Vânzări & lead-uri (M04). Prospect organisations are separate from Ifrim Digital itself; communication is DRAFT_ONLY and
 * research is local/simulated. All state changes go through the Hub's command bus (`/api/sales/*`), approvals stay on the
 * existing approval flow, and synthetic data is labelled on every tab.
 */
export default function Sales({ query, go }) {
  const { width } = useViewport();
  const phone = width < 768;
  const route = salesRoute(query, { defaultTab: phone ? "orgs" : "overview" });
  const overview = useSalesResource("/api/sales/overview");
  // The last opened sheet/opportunity keeps its tab, so the owner can switch back without searching again.
  const last = useRef({ org: "", opp: "" });
  if (route.tab === "org" && route.id) last.current.org = route.id;
  if (route.tab === "opp" && route.id) last.current.opp = route.id;
  const [search, setSearch] = useState(typeof query?.q === "string" ? query.q : "");
  useEffect(() => { if (route.tab === "orgs") setSearch(typeof query?.q === "string" ? query.q : ""); }, [route.tab, query?.q]);

  const order = phone ? MOBILE_TAB_ORDER : SALES_TABS.map(([id]) => id);
  const tabs = order
    .filter((id) => (id === "org" ? Boolean(last.current.org) : id === "opp" ? Boolean(last.current.opp) : true))
    .map((id) => ({ id, label: SALES_TABS.find(([t]) => t === id)[1] }));
  const select = (id) => {
    if (id === "org") go(salesHref("org", { id: last.current.org }));
    else if (id === "opp") go(salesHref("opp", { id: last.current.opp }));
    else go(salesHref(id));
  };
  // overview.synthetic is "some synthetic data exists"; syntheticOrgs vs counts.orgs decides between the "everything here
  // is fictive" banner and the mixed one (never claim all data is fictive when real companies exist).
  const banner = syntheticBannerFor(overview.data?.synthetic, realOrgCount(overview.data));
  const backToOrgs = salesHref("orgs");

  let content = null;
  if (route.tab === "overview") content = <Overview resource={overview} go={go} />;
  else if (route.tab === "imports") content = <Imports query={query} go={go} />;
  else if (route.tab === "orgs") content = <Orgs query={query} go={go} />;
  else if (route.tab === "org") content = <OrgSheet key={route.id} id={route.id} go={go} backHref={backToOrgs} />;
  else if (route.tab === "pipeline") content = <Pipeline />;
  else if (route.tab === "opp") content = <Opportunity key={route.id} id={route.id} overview={overview.data} />;
  else if (route.tab === "followups") content = <Followups />;
  else if (route.tab === "services") content = <Services />;

  return (
    <div className="page sales-page">
      <div className="page-head">
        <div><h1>Vânzări & lead-uri</h1><p>Firme prospectate, importuri cu proveniență, audit și calificare explicabile, propuneri și ciorne. Comunicarea rămâne ciornă; contactul real îl faci tu.</p></div>
        <form className="sales-search" role="search" onSubmit={(e) => { e.preventDefault(); go(salesHref("orgs", { q: search.trim() })); }}>
          <input className="input" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Caută o firmă (nume, CUI, domeniu)" aria-label="Caută o firmă" maxLength={120} />
          <button type="submit" className="btn primary" aria-label="Caută"><Search size={15} aria-hidden="true" /><span className="hide-xs" aria-hidden="true">Caută</span></button>
        </form>
      </div>
      <SyntheticBanner text={banner} />
      <SalesTabs tabs={tabs} value={route.tab} onChange={select} />
      <div role="tabpanel" id="sales-panel" aria-labelledby={`sales-tab-${route.tab}`} className="sales-panel">
        {content}
      </div>
    </div>
  );
}
