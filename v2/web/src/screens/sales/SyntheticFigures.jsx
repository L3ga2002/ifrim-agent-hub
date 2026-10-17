import { FlaskConical } from "lucide-react";
import { Panel, Chip } from "../../components/ui.jsx";
import { preparationStatusMeta, dossierStatusMeta } from "../../lib/salesPrepLogic.js";
import { SalesChip, Tile } from "./common.jsx";

/**
 * M12 final review (F8, T-S7): the synthetic figures of the Sales overview, apart from the real ones (which the panels above show alone
 * while synthetic data exists). Counts only, each labelled „sintetic”; nothing here is a business figure. Rendered only when the overview
 * is mixed (overviewFigures().mixed).
 */
export function SyntheticFigures({ figures }) {
  const s = figures?.mixed ? figures.synthetic : null;
  if (!s) return null;
  const list = (rows, chip) => (rows.length ? <ul className="sales-count-list">{rows.map(([status, n]) => <li key={status}><span className="row">{chip(status)}<span className="n">{n}</span></span></li>)}</ul> : <p className="faint small" style={{ margin: 0 }}>niciuna</p>);
  return (
    <Panel title="Date sintetice (de test), numărate separat" icon={FlaskConical}>
      <div className="stack tight">
        <p className="faint small break" style={{ margin: 0 }}>Firme, oferte și dosare fictive (domenii .test, CUI 99…), generate pentru test sau de pregătirile de ofertă. Nu intră în cifrele reale de mai sus și nu sunt activitate comercială.</p>
        <dl className="stat-tiles"><Tile label="firme sintetice" value={s.orgs} /><Tile label="calificate (sintetic)" value={s.qualified} /></dl>
        <div className="section-title">Oportunități (sintetic)</div>
        {list(s.opportunities, (status) => <SalesChip kind="opp" status={status} />)}
        <div className="section-title">Oferte (sintetic)</div>
        {list(s.proposals, (status) => <SalesChip kind="proposal" status={status} />)}
        <div className="section-title">Ciorne (sintetic, netrimise)</div>
        {list(s.drafts, (status) => <SalesChip kind="draft" status={status} />)}
        <div className="section-title">Pregătiri de ofertă și dosare (sintetic)</div>
        {list(s.preparations, (status) => { const m = preparationStatusMeta(status); return <Chip tone={m.tone} title={status}>{m.label}</Chip>; })}
        {list(s.dossiers, (status) => { const m = dossierStatusMeta(status); return <Chip tone={m.tone} title={status}>{`Dosar: ${m.label}`}</Chip>; })}
      </div>
    </Panel>
  );
}
