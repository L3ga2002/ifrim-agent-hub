import { LayoutDashboard, Upload, Search, KanbanSquare, Tags, ListChecks } from "lucide-react";
import { Panel, Empty, Loading, Notice } from "../../components/ui.jsx";
import { countEntries, normalizeCounts, catalogSummary, statusMeta, salesHref, ORG_STATUSES, OPP_STATUSES } from "../../lib/salesLogic.js";
import { Tile, OutreachNotice, SalesError, SalesChip } from "./common.jsx";
import { overviewFigures, realOnlyTitle } from "../../lib/salesFiguresLogic.js";
import { SyntheticFigures } from "./SyntheticFigures.jsx";

/** Prezentare: counters from GET /api/sales/overview, pipeline counts, catalog state and the outreach limit. */
export function Overview({ resource, go }) {
  const { data, error, loading, reload } = resource;
  if (loading && !data) return <Loading lines={5} />;
  if (error && !data) return <SalesError error={error} onRetry={reload} what="prezentarea" />;
  const counts = data?.counts || {};
  // M12 (T-S7): with synthetic data present the tiles, statuses and pipeline are the real figures only; the synthetic ones come apart.
  const fig = overviewFigures(data);
  const tiles = fig.tiles;
  const metrics = countEntries(data?.metrics);
  const metricsNote = typeof data?.metricsNote === "string" ? data.metricsNote : "";
  const byStatus = fig.byStatus;
  // Opportunities per status come in counts.opportunities ({ STATUS: n }), in lifecycle order here.
  const pipeline = fig.pipeline;
  const catalog = catalogSummary(data?.catalog);
  const orgTotal = Number(counts.orgs ?? counts.total ?? byStatus.reduce((s, [, n]) => s + n, 0)) || 0;
  const needsReview = Number(counts.needsReview ?? 0) || 0;
  return (
    <div className="stack">
      <OutreachNotice />
      {!orgTotal ? (
        <Panel title="Încă nu există firme" icon={LayoutDashboard}>
          <Empty title="Începe cu un import" action={<button type="button" className="btn primary sm" onClick={() => go(salesHref("imports"))}><Upload size={14} aria-hidden="true" />Importă CSV sau XLSX</button>}>
            Încarci un fișier, alegi ce reprezintă fiecare coloană, vezi previzualizarea cu erorile pe rând și abia apoi confirmi. Pentru test poți marca fișierul drept sintetic.
          </Empty>
        </Panel>
      ) : (
        <Panel title={realOnlyTitle("Situația curentă", fig)} icon={LayoutDashboard} actions={<button type="button" className="btn sm ghost" onClick={reload} disabled={loading}>{loading ? "Se actualizează…" : "Reîncarcă"}</button>}>
          <div className="stack">
            {tiles.length > 0 && <dl className="stat-tiles">{tiles.map((t) => <Tile key={t.key} label={t.label} value={t.value} tone={t.key === "needsReview" && t.value > 0 ? "attention" : ""} />)}</dl>}
            {metrics.length > 0 && <><div className="section-title">Indicatori</div><dl className="stat-tiles">{metrics.map((t) => <Tile key={t.key} label={t.label} value={t.value} />)}</dl></>}
            {metricsNote && <p className="faint small" style={{ margin: 0 }}>{metricsNote}</p>}
            {byStatus.length > 0 && (
              <div>
                <div className="section-title">Firme pe stări</div>
                <ul className="sales-count-list">
                  {byStatus.map(([status, n]) => (
                    <li key={status}><a href={`#${salesHref("orgs", { status })}`}><SalesChip kind="org" status={status} /><span className="n">{n}</span></a></li>
                  ))}
                </ul>
              </div>
            )}
            <div className="row wrap">
              <button type="button" className="btn sm" onClick={() => go(salesHref("orgs"))}><Search size={14} aria-hidden="true" />Caută firme</button>
              {needsReview > 0 && <button type="button" className="btn sm" onClick={() => go(salesHref("orgs", { needsReview: true }))}><ListChecks size={14} aria-hidden="true" />{needsReview} de revizuit</button>}
              <button type="button" className="btn sm ghost" onClick={() => go(salesHref("imports"))}><Upload size={14} aria-hidden="true" />Import nou</button>
            </div>
          </div>
        </Panel>
      )}
      <SyntheticFigures figures={fig} />
      <div className="grid two">
        <Panel title={realOnlyTitle("Pipeline", fig)} icon={KanbanSquare} actions={<button type="button" className="btn sm ghost" onClick={() => go(salesHref("pipeline"))}>Deschide</button>}>
          {pipeline.length ? (
            <ul className="sales-count-list">
              {pipeline.map(([status, n]) => <li key={status}><span className="row"><SalesChip kind="opp" status={status} /><span className="n">{n}</span></span></li>)}
            </ul>
          ) : <Empty title="Nicio oportunitate">O oportunitate se creează din fișa unei firme, după audit și calificare.</Empty>}
          <p className="faint small" style={{ margin: "8px 0 0" }}>Starea comercială e separată de execuție: un task finalizat nu face o oportunitate „{statusMeta("opp", "WON").label}”.</p>
        </Panel>
        <Panel title="Catalogul de servicii" icon={Tags} actions={<button type="button" className="btn sm ghost" onClick={() => go(salesHref("services"))}>Editează</button>}>
          <dl className="stat-tiles"><Tile label="servicii" value={catalog.services} /><Tile label="cu preț configurat" value={catalog.configured} tone={catalog.services && !catalog.configured ? "attention" : ""} /></dl>
          {!catalog.configured && <div style={{ marginTop: 12 }}><Notice tone="warn">Niciun serviciu nu are preț configurat: propunerile vor afișa „De stabilit (neconfigurat)” la preț și termen, nu o sumă inventată.</Notice></div>}
        </Panel>
      </div>
    </div>
  );
}
