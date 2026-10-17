import { ClipboardList } from "lucide-react";
import { Panel, Chip, ErrorNotice } from "../../components/ui.jsx";
import { preparationPanel, preparationStatusMeta, consentAuthorityText, activationWindowText } from "../../lib/salesPrepLogic.js";
import { SyntheticTag, useSalesResource, when } from "./common.jsx";
import { DossierList } from "./Dossier.jsx";
import { PreparationContinue } from "./PreparationContinue.jsx";

/**
 * M12: the synthetic offer preparation of this opportunity (one plan the owner confirmed once) and „Dosarul ofertei”. It shows the
 * preparation's status and reason, the owner's own request, who confirmed the plan (truthfully: Windows Hello or a local development
 * session), the offer id + FULL SHA it recorded, said for what it is (the exact target it waits for, or an outdated one; the decision
 * itself is the „Aprob intern” block of that version, above), until when the draft and the dossier still follow by themselves, what stays
 * the owner's decision, and every dossier revision. This panel reads only (GET /api/sales/opportunities/:id/dossiers); the one action —
 * asking for the continuation card of a stopped preparation — lives in <PreparationContinue> (owner session; the card is confirmed once).
 * Rendered only when the opportunity has a preparation or a dossier.
 */
export function Preparation({ oppId }) {
  const res = useSalesResource(oppId ? `/api/sales/opportunities/${encodeURIComponent(oppId)}/dossiers` : null);
  const panel = preparationPanel(res.data);
  if (!panel.show) return res.error ? <ErrorNotice error={res.error} onRetry={res.reload} /> : null;
  const p = panel.current;
  const meta = p ? preparationStatusMeta(p.status) : null;
  const windowText = p ? activationWindowText(p) : "";
  return (
    <Panel title="Pregătirea ofertei și dosarul" icon={ClipboardList}>
      <div className="stack tight">
        {p && <>
          <div className="row wrap"><Chip tone={meta.tone} title={p.status}>{meta.label}</Chip>{p.synthetic && <SyntheticTag />}{p.updatedAt && <span className="faint small">{when(p.updatedAt)}</span>}</div>
          {p.statusReason && <p className="small break" style={{ margin: 0 }}>{p.statusReason}</p>}
          {p.request && <p className="muted small break prewrap" style={{ margin: 0 }}>Cererea ta: „{p.request}”</p>}
          <p className="faint small break" style={{ margin: 0 }}>{consentAuthorityText(p.authority)}{p.confirmedAt ? ` (${when(p.confirmedAt)})` : ""} Confirmarea planului nu aprobă oferta.</p>
          {p.awaited && <div className="small break">{p.awaitedLabel}: <code className="mono break" style={{ overflowWrap: "anywhere" }}>{p.awaited.proposalId}</code> · SHA <code className="mono break" style={{ overflowWrap: "anywhere" }}>{p.awaited.proposalSha || "—"}</code></div>}
          {windowText && <p className="small break" style={{ margin: 0 }}>{windowText}{p.activateBy ? ` (până la ${when(p.activateBy)})` : ""}</p>}
          {p.decisionsLeft.length > 0 && <ul className="plain-list small">{p.decisionsLeft.map((x, i) => <li key={i} className="break">{x}</li>)}</ul>}
          <PreparationContinue p={p} onChange={res.reload} />
          {panel.older > 0 && <p className="faint small" style={{ margin: 0 }}>Încă {panel.older} {panel.older === 1 ? "pregătire mai veche" : "pregătiri mai vechi"} pe această oportunitate.</p>}
        </>}
        <div className="section-title">Dosarul ofertei</div>
        <DossierList dossiers={panel.dossiers} />
        <p className="faint small break" style={{ margin: 0 }}>Nimic nu se trimite, nu se publică și nu se cheltuie: trimiterea e dezactivată (OUTREACH_DISABLED); contactul îl faci tu, în afara Hub-ului.</p>
        <ErrorNotice error={res.error} onRetry={res.reload} />
      </div>
    </Panel>
  );
}
