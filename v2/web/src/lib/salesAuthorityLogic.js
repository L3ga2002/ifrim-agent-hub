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

/**
 * A reserved Sales approval that can no longer approve the offer (its authority was revoked, it belongs to another credential, the
 * version changed, it was requested before the upgrade, it expired): what the card says instead of offering an action.
 */
export function salesApprovalStateText(approval) {
  if (!ownerSalesKind(approval)) return null;
  if (approval.status === "invalidated") return "Această aprobare nu mai poate aproba oferta (autoritatea a fost revocată, aparține altei credențiale, versiunea s-a schimbat sau cererea e dinainte de actualizare). Cere din nou aprobarea din pagina oportunității.";
  if (approval.status === "expired") return "Aprobarea a expirat. Cere din nou aprobarea din pagina oportunității.";
  return null;
}

export function salesApprovalReadiness(opp, proposal, proposals) {
  if (!/^spr_[A-Za-z0-9_]+$/.test(proposal?.id || "")) return { ok: false, reason: "Lipsește ID-ul exact al ofertei." };
  if (!/^[0-9a-f]{64}$/.test(proposal?.sha || "")) return { ok: false, reason: "Lipsește SHA-ul complet al ofertei (64 de caractere)." };
  return proposalApprovalReadiness(opp, proposal, proposals);
}

/**
 * The exact-target block and „Aprob intern” belong only to the latest DRAFT version of an opportunity waiting for the owner's review
 * (review C2). Any other version (approved, superseded, another state) shows its own state once, in the proposal view, with no dead
 * button; inside the block only an identity problem (id / full SHA) can still disable the action, and its reason is printed there.
 */
export const salesDecisionApplies = (opp, proposal, proposals) => proposalApprovalReadiness(opp, proposal, proposals).ok;

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
