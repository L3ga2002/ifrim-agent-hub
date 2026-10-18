import { Scale } from "lucide-react";
import { Panel } from "../../components/ui.jsx";
import { qualificationNotes } from "../../lib/salesPrepLogic.js";

/**
 * M12 (C-04, S-04): what the q-v2 qualification did NOT score — the inferences (deduced, never counted as confirmed evidence) and the
 * items present without recorded evidence („fără dovadă”). Plain text from the stored qualification; nothing is recalculated here.
 */
export function QualificationNotes({ raw }) {
  const n = qualificationNotes(raw);
  if (!n.show) return null;
  return (
    <Panel title={`Ce nu primește puncte (${n.formula || "q-v2"})`} icon={Scale}>
      <div className="stack tight">
        <div>
          <div className="section-title">Inferențe (deduse, fără punctaj)</div>
          {n.inferences.length ? <ul className="plain-list small">{n.inferences.map((x, i) => <li key={i} className="break">{x.claim}{x.why ? ` — ${x.why}` : ""}</li>)}</ul>
            : <p className="faint small" style={{ margin: 0 }}>Nicio inferență.</p>}
        </div>
        <div>
          <div className="section-title">Fără dovadă înregistrată</div>
          {n.unproven.length ? <ul className="plain-list small">{n.unproven.map((x, i) => <li key={i} className="break">{x.claim}{x.why ? ` — ${x.why}` : ""}</li>)}</ul>
            : <p className="faint small" style={{ margin: 0 }}>Fiecare punct are dovada lui.</p>}
        </div>
        <p className="faint small break" style={{ margin: 0 }}>O inferență se confirmă doar cu o dovadă nouă (o afirmație cu sursa ei); nu urcă scorul prin copiere.</p>
      </div>
    </Panel>
  );
}
