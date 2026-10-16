import { proposalApprovalReadiness } from "./salesLogic.js";

export const ownerSalesKind = (approval) => approval?.actionKind === "sales.proposal_approve";
export const salesAuthorityLabel = (session) => session?.authority === "webauthn"
  ? "Decizia se înregistrează în sesiunea verificată cu Windows Hello / cheia ta."
  : session?.authority === "local_dev_profile"
    ? "Decizia se înregistrează ca sesiune locală de dezvoltare."
    : "Decizia cere sesiunea ta de proprietar.";
export const salesApprovalCardText = (approval) => ownerSalesKind(approval)
  ? "Aprob intern — doar conținutul ofertei. Nu trimite nimic și nu marchează CONTACTED sau WON."
  : "Aprobă exact această acțiune";

export function salesApprovalReadiness(opp, proposal, proposals) {
  if (!/^spr_[A-Za-z0-9_]+$/.test(proposal?.id || "")) return { ok: false, reason: "Lipsește ID-ul exact al ofertei." };
  if (!/^[0-9a-f]{64}$/.test(proposal?.sha || "")) return { ok: false, reason: "Lipsește SHA-ul complet al ofertei (64 de caractere)." };
  return proposalApprovalReadiness(opp, proposal, proposals);
}

/** Keep completed stages across the single reauth retry; never request or decide twice. */
export function salesApprovalAction(call, { path, body, approval: initial, decision = "approved", note = "" }) {
  let approval = initial, decided = initial?.status === "approved", commandId = initial?.scopeId;
  return async () => {
    if (!approval) {
      const requested = await call(path, { method: "POST", body });
      approval = requested.approval;
      commandId = requested.commandId || requested.command?.id;
      if (!approval || !commandId) throw new Error("Lipsește aprobarea ofertei; reîncarcă versiunea afișată.");
    }
    if (!decided) {
      await call(`/api/approvals/${approval.id}/owner_decide`, { method: "POST", body: { decision, displayedHash: approval.payloadHash, note } });
      decided = true;
    }
    if (decision === "approved") return call(`/api/commands/${commandId}/execute`, { method: "POST", body: {} });
    return { rejected: true };
  };
}
