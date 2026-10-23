import { useEffect, useState } from "react";
import { Inbox, RefreshCw } from "lucide-react";
import { api, fmt } from "../../api.js";
import { Chip, Empty, ErrorNotice, Loading, Notice } from "../../components/ui.jsx";
import { DECISION_KIND } from "../../lib/legaOneScreen.js";
import { useHub } from "../../store.js";

// M15: the same words as the L3ga screen (desk replies, devize and the Hub's claim corrections had their raw kind shown here).
const KIND = DECISION_KIND;

/**
 * „Deciziile mele” (M11): every result that waits for the owner, one row each — what it is, why it waits, what accepting / rejecting
 * (closing / keeping) does and what it touches. Read-only: each row opens the place where the decision is taken in the owner session.
 */
export function DecisionInbox({ go }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const load = () => api("/api/decisions/inbox").then(setData, setError);
  const pendingApprovals = useHub((s) => s.hub?.pendingApprovals || 0);
  useEffect(() => { load(); }, []);
  return (
    <div className="page delivery">
      <div className="page-head">
        <div><h1><Inbox size={20} /> Deciziile mele</h1><p className="faint small">{data?.note || "Ce așteaptă decizia ta. Hub-ul nu acceptă nimic în locul tău."}</p></div>
        <button className="btn sm ghost" onClick={load}><RefreshCw size={14} />Reîncarcă</button>
      </div>
      <ErrorNotice error={error} />
      {/* M15: the technical approvals counted on the „Decizii” badge are reachable from here (their list stays in Aprobări). */}
      {pendingApprovals > 0 && <Notice tone="warn" title={pendingApprovals === 1 ? "O aprobare tehnică te așteaptă" : `${pendingApprovals} aprobări tehnice te așteaptă`}>
        Sunt cereri ale agenților sau ale Hub-ului (o comandă, un acces), separate de rezultatele de mai jos. <a href="#/approvals">Deschide Aprobări</a></Notice>}
      {!data ? <Loading lines={4} /> : !data.items.length ? <Empty title="Nimic nu așteaptă decizia ta">Când un pachet, o misiune oprită sau o livrare are nevoie de tine, apare aici.</Empty> : (
        <div className="stack">
          {data.items.map((it) => (
            <section key={`${it.kind}:${it.id}`} className="panel">
              <div className="panel-head">
                <h3>{it.title}</h3>
                <div className="row wrap">
                  <Chip tone="info">{KIND[it.kind] || it.kind}</Chip>
                  <Chip tone={it.real ? "warn" : "neutral"}>{it.real ? "proiect real" : it.synthetic ? "date sintetice" : "proiect de test"}</Chip>
                  <span className="faint small">{it.projectName}{it.waitingSince ? ` · din ${fmt.dateTime(it.waitingSince)}` : ""}</span>
                </div>
              </div>
              <div className="panel-body stack tight small">
                <p><strong>Ce este:</strong> {it.what}</p>
                <p><strong>De ce așteaptă:</strong> {it.why}</p>
                {it.facts?.length > 0 && <p>{it.facts.join(" · ")}</p>}
                {it.target && <p className="break">Ținta exactă: <code className="mono break" style={{ overflowWrap: "anywhere" }}>{it.target.proposalId}</code> · versiunea {it.target.version} · SHA <code className="mono break" style={{ overflowWrap: "anywhere" }}>{it.target.proposalSha}</code>{it.activateBy ? ` · fereastra automată până la ${fmt.dateTime(it.activateBy)}` : ""}</p>}
                <p><strong>{it.acceptLabel || (it.kind === "mission_decision" ? "Dacă o închizi:" : "Dacă accepți:")}</strong> {it.ifAccept.replace(/^Dacă o închizi: /, "")}</p>
                <p><strong>{it.rejectLabel || (it.kind === "mission_decision" ? "Dacă o lași:" : "Dacă respingi:")}</strong> {it.ifReject.replace(/^Dacă o lași: /, "")}</p>
                <details><summary>Fișiere și efecte ({it.effects.length})</summary><ul className="plain-list">{it.effects.slice(0, 30).map((e) => <li key={e}>{e}</li>)}</ul></details>
                {it.criteria?.length > 0 && <details><summary>Criterii</summary><ul className="plain-list">{it.criteria.map((c) => <li key={c}>{c}</li>)}</ul></details>}
                <div className="row"><button className="btn sm" onClick={() => go(it.link)}>Deschide locul deciziei</button></div>
              </div>
            </section>
          ))}
        </div>
      )}
      {data && <Notice tone="info">Acceptarea, respingerea, aprobarea creativă și „gata de prezentare” sunt decizii separate, luate de tine în sesiunea de proprietar. Nimic nu se publică din Hub.</Notice>}
    </div>
  );
}
