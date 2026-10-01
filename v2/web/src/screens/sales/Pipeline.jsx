import { KanbanSquare } from "lucide-react";
import { usePref } from "../../store.js";
import { Panel, Empty, Loading } from "../../components/ui.jsx";
import { groupPipeline, listOf, salesHref } from "../../lib/salesLogic.js";
import { SalesChip, SyntheticTag, useSalesResource, SalesError, when } from "./common.jsx";

/**
 * Pipeline: opportunities grouped by commercial status, with counts and the next action. Commercial state is separate
 * from execution state; a status only moves through its own rules (contact event, client acceptance).
 */
export function Pipeline() {
  const res = useSalesResource("/api/sales/opportunities");
  const [hideEmpty, setHideEmpty] = usePref("sales.pipeline.hideEmpty", true);
  if (res.loading && !res.data) return <Loading lines={6} />;
  if (res.error && !res.data) return <SalesError error={res.error} onRetry={res.reload} what="oportunitățile" />;
  const groups = groupPipeline(listOf(res.data, "opportunities"));
  const total = groups.reduce((s, g) => s + g.count, 0);
  const shown = hideEmpty ? groups.filter((g) => g.count > 0) : groups;
  return (
    <Panel title={`Pipeline (${total})`} icon={KanbanSquare}
      actions={<label className="check small"><input type="checkbox" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} />Ascunde etapele goale</label>}>
      {!total ? <Empty title="Nicio oportunitate">Deschide fișa unei firme și creează o oportunitate după audit și calificare.</Empty> : (
        <div className="sales-board" aria-busy={res.loading}>
          {shown.map((g) => (
            <section key={g.status} className="sales-column" aria-labelledby={`pipe-${g.status}`}>
              <h3 id={`pipe-${g.status}`} className="sales-column-head"><SalesChip kind="opp" status={g.status} /><span className="n" aria-label={`${g.count} oportunități`}>{g.count}</span></h3>
              {g.items.length ? (
                <ul className="sales-cards">{g.items.map((o) => (
                  <li key={o.id}>
                    <a className="sales-card" href={`#${salesHref("opp", { id: o.id })}`}>
                      <span className="title break">{o.title || "(fără titlu)"}</span>
                      {o.orgName && <span className="sub break">{o.orgName}</span>}
                      <span className="sub">{o.nextAction ? `Următorul pas: ${o.nextAction}` : "Fără pas următor stabilit"}{o.nextActionAt ? ` · ${when(o.nextActionAt)}` : ""}</span>
                      {o.synthetic && <span><SyntheticTag /></span>}
                    </a>
                  </li>
                ))}</ul>
              ) : <p className="faint small" style={{ margin: 0 }}>Nicio oportunitate.</p>}
            </section>
          ))}
        </div>
      )}
    </Panel>
  );
}
