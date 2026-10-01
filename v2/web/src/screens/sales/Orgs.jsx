import { useState, useEffect } from "react";
import { Building2, Search, Download, X } from "lucide-react";
import { Panel, Empty, Loading } from "../../components/ui.jsx";
import { parseOrgFilters, buildOrgQuery, orgView, listOf, pagedOf, importRowView, pageInfo, ORG_STATUSES, ORG_SORTS, statusMeta, fiscalCodeText, DOMAIN_KIND_RO, priorityText, salesHref } from "../../lib/salesLogic.js";
import { SalesChip, SyntheticTag, useSalesResource, SalesError, Pager, when } from "./common.jsx";
import { RowsTable } from "./ImportRows.jsx";

/**
 * Rows the Hub could not decide alone (NEEDS_REVIEW), from GET /api/sales/orgs?needsReview=1 → `review: { items, total }`:
 * the owner creates a new company, links a candidate or skips the row.
 */
function ReviewRows({ data, filters, apply, reload }) {
  const review = pagedOf(data, "review");
  const rows = review.items.map(importRowView);
  const info = pageInfo({ total: review.total, offset: filters.offset, limit: filters.limit });
  return (
    <div className="panel-body stack tight">
      <div className="section-title">Rânduri de import de revizuit ({review.total})</div>
      {rows.length ? <RowsTable rows={rows} resolvable onChanged={reload} /> : <p className="faint small" style={{ margin: 0 }}>Niciun rând nu așteaptă decizia ta.</p>}
      <Pager info={info} onPage={(offset) => apply({ offset })} />
    </div>
  );
}

/**
 * Firme: server-side paging (offset/limit 50), search and filters. The filters live in the hash query, so the
 * header search, a link from Prezentare and the back button all land on the same list. With „De revizuit” the
 * panel shows the import rows waiting for a decision instead of the companies.
 */
export function Orgs({ query, go }) {
  const filters = parseOrgFilters(query);
  const [text, setText] = useState(filters.q);
  const [city, setCity] = useState(filters.city);
  useEffect(() => { setText(filters.q); }, [filters.q]);
  useEffect(() => { setCity(filters.city); }, [filters.city]);
  const qs = buildOrgQuery(filters);
  const res = useSalesResource(`/api/sales/orgs?${qs}`);
  const apply = (patch) => {
    const next = { ...filters, ...patch, offset: patch.offset ?? 0 };
    go(salesHref("orgs", { q: next.q, status: next.status, city: next.city, synthetic: next.synthetic, needsReview: next.needsReview, sort: next.sort !== "updated_desc" ? next.sort : "", offset: next.offset || "" }));
  };
  const items = listOf(res.data, "items").map(orgView);
  const total = Number(res.data?.total ?? items.length) || 0;
  const info = pageInfo({ total, offset: Number(res.data?.offset ?? filters.offset) || 0, limit: Number(res.data?.limit ?? filters.limit) || filters.limit });
  const exportQs = new URLSearchParams(qs); exportQs.delete("offset"); exportQs.delete("limit");
  const active = Boolean(filters.q || filters.status || filters.city || filters.synthetic || filters.needsReview);
  return (
    <Panel title={filters.needsReview ? "Firme · de revizuit" : `Firme${total ? ` (${total})` : ""}`} icon={Building2} flush
      actions={<a className="btn sm ghost" href={`/api/sales/export/orgs.csv?${exportQs.toString()}`} download><Download size={14} aria-hidden="true" />Export CSV</a>}>
      <form className="filters sales-filters" role="search" onSubmit={(e) => { e.preventDefault(); apply({ q: text.trim(), city: city.trim() }); }}>
        <input className="input" type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Nume, CUI sau domeniu" aria-label="Caută firme" maxLength={120} />
        <input className="input" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Oraș" aria-label="Oraș" maxLength={80} />
        <select className="select" aria-label="Starea firmei" value={filters.status} onChange={(e) => apply({ status: e.target.value })}>
          <option value="">Toate stările</option>
          {ORG_STATUSES.map((s) => <option key={s} value={s}>{statusMeta("org", s).label}</option>)}
        </select>
        <select className="select" aria-label="Date sintetice" value={filters.synthetic} onChange={(e) => apply({ synthetic: e.target.value })}>
          <option value="">Reale și sintetice</option><option value="1">Doar sintetice</option><option value="0">Doar reale</option>
        </select>
        <select className="select" aria-label="Ordonare" value={filters.sort} onChange={(e) => apply({ sort: e.target.value })}>
          {ORG_SORTS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
        <label className="check"><input type="checkbox" checked={filters.needsReview} onChange={(e) => apply({ needsReview: e.target.checked })} />De revizuit</label>
        <button type="submit" className="btn sm primary"><Search size={14} aria-hidden="true" />Caută</button>
        {active && <button type="button" className="btn sm ghost" onClick={() => go(salesHref("orgs"))}><X size={14} aria-hidden="true" />Resetează</button>}
      </form>
      {res.loading && !res.data ? <div className="panel-body"><Loading lines={6} /></div>
        : res.error && !res.data ? <div className="panel-body"><SalesError error={res.error} onRetry={res.reload} what="lista de firme" /></div>
        : filters.needsReview ? <ReviewRows data={res.data} filters={filters} apply={apply} reload={res.reload} />
        : items.length ? (
          <div aria-busy={res.loading}>
            {res.error && <div className="panel-body"><SalesError error={res.error} onRetry={res.reload} /></div>}
            <div className="table-wrap">
              <table className="table table-mobile-cards sales-orgs">
                <thead><tr><th>Firmă</th><th>CUI</th><th>Domeniu</th><th>Oraș</th><th>Stare</th><th>Prioritate</th><th>Actualizată</th></tr></thead>
                <tbody>{items.map((o) => {
                  const fiscal = fiscalCodeText(o.fiscalCode, o.fiscalCodeValid);
                  return (
                    <tr key={o.id}>
                      <td data-label="Firmă" className="break">
                        <a className="sales-org-link" href={`#${salesHref("org", { id: o.id })}`}>{o.name || "(fără nume)"}</a>
                        <div className="chips" style={{ marginTop: 4 }}>{o.synthetic && <SyntheticTag />}{o.needsReview && <SalesChip kind="row" status="NEEDS_REVIEW" />}</div>
                      </td>
                      <td data-label="CUI"><span className="mono">{o.fiscalCode || "—"}</span>{o.fiscalCode && <div className={`sub ${fiscal.tone === "error" ? "warn-text" : ""}`}>{fiscal.text}</div>}</td>
                      <td data-label="Domeniu" className="break"><span className="mono">{o.domain || "—"}</span>{o.domainKind && <div className="sub">{DOMAIN_KIND_RO[o.domainKind] || o.domainKind}</div>}</td>
                      <td data-label="Oraș">{o.city || "—"}{o.county && <div className="sub">{o.county}</div>}</td>
                      <td data-label="Stare"><SalesChip kind="org" status={o.status} /></td>
                      <td data-label="Prioritate" className="nowrap" title="Prioritate internă, nu probabilitate de vânzare">{priorityText(o.priority)}</td>
                      <td data-label="Actualizată" className="nowrap faint small">{when(o.updatedAt)}</td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
            <div className="panel-body"><Pager info={info} onPage={(offset) => apply({ offset })} busy={res.loading} /></div>
          </div>
        ) : <Empty title={active ? "Nicio firmă pentru filtrele alese" : "Nicio firmă"} action={active ? <button type="button" className="btn sm" onClick={() => go(salesHref("orgs"))}>Șterge filtrele</button> : <button type="button" className="btn sm primary" onClick={() => go(salesHref("imports"))}>Importă un fișier</button>}>
            {active ? "Căutarea se face după nume (fără diacritice), CUI și domeniu." : "Firmele apar după un import confirmat."}
          </Empty>}
    </Panel>
  );
}
