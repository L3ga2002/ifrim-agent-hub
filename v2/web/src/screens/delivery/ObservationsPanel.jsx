import { ListChecks, History } from "lucide-react";
import { Panel, Chip } from "../../components/ui.jsx";
import { OpsPlanCard } from "../lega/OpsPlanCard.jsx";
import { observationRows, planRows, historyGroups } from "../../lib/deliveryLogic.js";

/** A delivery plan that finished (or was cancelled): its steps with their verified state, read-only. */
function PlanSteps({ plan }) {
  return (
    <details className="studio-details">
      <summary><Chip tone={plan.tone}>{plan.statusLabel}</Chip> {plan.kindLabel} · {plan.progress.done}/{plan.progress.total} pași verificați</summary>
      <ol className="ops-steps">
        {plan.steps.map((s) => <li key={s.seq}><span className="ops-step-title">{s.title || `pasul ${s.seq}`}</span> <Chip tone={s.tone}>{s.label}</Chip></li>)}
      </ol>
    </details>
  );
}

/**
 * 6 · Observații: what is still open after the delivery (open findings, criteria without evidence, QA warnings, sentences to verify,
 * honest disclosures), the delivery's plans — an open plan keeps its ordinary card with Pauză / Continuă / Anulează — and the history
 * of every item line with the supersedes links the Hub recorded and the reason of each stale item. Read-only apart from the plan card.
 */
export function ObservationsPanel({ room, hiddenPlanIds = [] }) {
  const rows = observationRows(room.view);
  const plans = planRows(room.view);
  // A plan already shown as the answer of a request (the ONE card under the revision box) is not shown a second time here.
  const open = plans.filter((p) => p.open && !hiddenPlanIds.includes(p.id));
  const closed = plans.filter((p) => !p.open);
  const history = historyGroups(room.view);
  const notable = history.filter((g) => g.notable);
  return (
    <Panel title="6 · Observații rămase" icon={ListChecks} id="livrare-observatii-panel">
      <div className="stack">
        {rows.length ? (
          <ul className="delivery-observations" aria-label="Observații rămase">
            {rows.map((o) => (
              <li key={o.key}>
                <span className="row wrap">
                  <Chip tone={o.tone}>{o.severityLabel}</Chip>
                  <Chip tone="neutral">{o.kindLabel}</Chip>
                  {o.target && <button type="button" className="link-btn small" onClick={() => room.jump(o.target)}>{o.target.label}</button>}
                </span>
                <span className="small">{o.text}</span>
                {o.link && <a className="small" href={o.link.href}>{o.link.label}</a>}
              </li>
            ))}
          </ul>
        ) : <p className="faint small">Hub-ul nu a raportat observații pentru această livrare.</p>}

        {plans.length > 0 && (
          <section aria-labelledby="livrare-planuri">
            <h3 id="livrare-planuri" className="delivery-h3">Planurile livrării</h3>
            <div className="stack tight">
              {open.map((p) => <OpsPlanCard key={p.id} plan={{ id: p.id, kind: p.kind, title: p.kindLabel, status: p.status, steps: p.steps.map((s) => ({ id: s.seq, seq: s.seq, title: s.title, status: s.status })) }} card={{ type: "OpsPlan", size: "l" }} />)}
              {closed.map((p) => <PlanSteps key={p.id} plan={p} />)}
            </div>
          </section>
        )}

        {history.length > 0 && (
          <details className="studio-details">
            <summary><History size={13} aria-hidden="true" /> Istoricul versiunilor ({notable.length ? `${notable.length} linii cu schimbări` : "nicio schimbare"})</summary>
            <ul className="delivery-history">
              {history.map((g) => (
                <li key={g.key}>
                  <strong className="small">{g.label}</strong>
                  <ol className="delivery-versions">
                    {g.versions.map((v) => (
                      <li key={v.id}>
                        <Chip tone={v.tone}>v{v.n} · {v.text}</Chip>
                        {v.supersedes ? <span className="faint small"> înlocuiește v{v.supersedes}</span> : !v.linked ? <span className="faint small"> (legătura cu versiunea anterioară lipsește)</span> : null}
                        {v.staleReason && <span className="small delivery-reason"> — {v.staleReason}</span>}
                        <span className="faint small mono"> {v.id}</span>
                      </li>
                    ))}
                  </ol>
                </li>
              ))}
            </ul>
            <p className="faint small">„Înlocuită” = există o versiune mai nouă, dar cea veche rămâne adevărată pentru ce a fost făcută. „Învechită” = baza ei s-a schimbat și nu mai dovedește nimic. Nimic nu se șterge.</p>
          </details>
        )}
      </div>
    </Panel>
  );
}
