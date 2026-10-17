import { useAction, useResource } from "../../store.js";
import { ErrorNotice } from "../../components/ui.jsx";
import { salesApprovalReadiness, salesAuthorityLabel, salesDecisionApplies } from "../../lib/salesAuthorityLogic.js";
import { approveSales } from "../../lib/salesOwnerActions.js";
import { SyntheticTag } from "./common.jsx";

/**
 * The owner's decision on one exact version. Rendered only for the latest DRAFT of an opportunity waiting for review: any other
 * version (approved, superseded, another state) shows its state once in the proposal view, never a disabled „Aprob intern”.
 */
export function ProposalDecision({ opp, proposal, proposals, onChanged }) {
  const applies = salesDecisionApplies(opp, proposal, proposals);
  const { data } = useResource(applies ? "/api/owner/status" : null, { reloadOn: e => e.type.startsWith("owner.") });
  const ready = salesApprovalReadiness(opp, proposal, proposals);
  const action = useAction(async () => {
    await approveSales({ path: `/api/sales/proposals/${encodeURIComponent(proposal.id)}/approve`, body: { displayedSha: proposal.sha } });
    onChanged();
  });
  if (!applies) return null;
  return <div className="stack tight">
    <div className="row wrap"><strong>Ținta exactă: oferta v{proposal.version}</strong>{opp.synthetic && <SyntheticTag />}</div>
    <code className="mono break" style={{ overflowWrap: "anywhere" }}>{proposal.id}</code>
    <code className="mono break" style={{ overflowWrap: "anywhere" }}>{proposal.sha || "SHA indisponibil"}</code>
    <p className="faint small" style={{ margin: 0 }}>{salesAuthorityLabel(data?.session)} Nu e acceptarea clientului. Nu trimite nimic și nu marchează CONTACTED sau WON.</p>
    <div><button type="button" className="btn approve sm" disabled={action.pending || !ready.ok} onClick={action.run}>{action.pending ? "Se aprobă…" : "Aprob intern"}</button></div>
    {!ready.ok && ready.reason && <p className="faint small" style={{ margin: 0 }}>{ready.reason}</p>}
    <ErrorNotice error={action.error} />
  </div>;
}
