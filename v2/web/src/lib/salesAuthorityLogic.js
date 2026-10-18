import { proposalApprovalReadiness } from "./salesLogic.js";

/**
 * The Sales approvals decided only in the owner session (server policy/approvals.mjs OWNER_DECIDED): the internal offer approval (M12)
 * and, since 2.15.2, a draft's text, lifting DO_NOT_CONTACT and an import rollback. What each card says it does (and does not do).
 */
const OWNER_SALES = Object.freeze({
  "sales.proposal_approve": { card: "Aprob intern — doar conținutul ofertei. Nu trimite nimic și nu marchează CONTACTED sau WON.", button: "Aprob intern", what: "aproba oferta", where: "pagina oportunității" },
  "sales.draft_content": { card: "Aprobi doar textul acestei ciorne. Nu trimite nimic (trimiterea e dezactivată).", button: "Aprob textul", what: "aproba textul ciornei", where: "pagina oportunității" },
  "sales.suppression_lift": { card: "Ridici „Nu contacta” pentru această firmă. Nu contactează pe nimeni.", button: "Ridic interdicția", what: "ridica „Nu contacta”", where: "fișa firmei" },
  "sales.import_rollback": { card: "Arhivezi firmele neatinse create de acest lot. Nu șterge nimic; firmele modificate rămân.", button: "Aprob rollback-ul", what: "face rollback-ul lotului", where: "pagina importului" },
});
export const ownerSalesKind = (approval) => Object.hasOwn(OWNER_SALES, String(approval?.actionKind || ""));
/** The approve button of a reserved Sales approval card. */
export const salesApproveLabel = (approval) => OWNER_SALES[approval?.actionKind]?.button || "Aprobă exact această acțiune";
export const salesAuthorityLabel = (session) => session?.authority === "webauthn"
  ? "Decizia se înregistrează în sesiunea verificată cu Windows Hello / cheia ta."
  : session?.authority === "local_dev_profile"
    ? "Decizia se înregistrează ca sesiune locală de dezvoltare."
    : "Decizia cere sesiunea ta de proprietar.";
/** The authority RECORDED on a decided reserved approval (approvals.decideByOwner → approval.authority), said in the past tense. */
export const salesDecidedAuthorityLabel = (authority) => authority === "webauthn"
  ? "Decizia a fost înregistrată în sesiunea verificată cu Windows Hello / cheia ta."
  : authority === "local_dev_profile"
    ? "Decizia a fost înregistrată ca sesiune locală de dezvoltare (încredere în acest calculator, nu dovada prezenței tale)."
    : authority === "test"
      ? "Decizia a fost înregistrată pe canalul de test."
      : "Autoritatea deciziei nu e înregistrată pe această aprobare.";
/**
 * Review F20: what the card says about the authority. A pending reserved approval: the session it WILL be decided in (the viewer's,
 * now). A decided one (approved / consumed / rejected): the authority recorded on the decision — never the viewer's current session.
 */
export const salesApprovalAuthorityText = (approval, session) => (["approved", "consumed", "rejected"].includes(approval?.status)
  ? salesDecidedAuthorityLabel(approval?.authority)
  : salesAuthorityLabel(session));
export const salesApprovalCardText = (approval) => (ownerSalesKind(approval) ? OWNER_SALES[approval.actionKind].card : "Aprobă exact această acțiune");

/**
 * A reserved Sales approval that can no longer approve the offer (its authority was revoked, it belongs to another credential, the
 * version changed, it was requested before the upgrade, it expired): what the card says instead of offering an action.
 */
export function salesApprovalStateText(approval) {
  if (!ownerSalesKind(approval)) return null;
  const { what, where } = OWNER_SALES[approval.actionKind];
  if (approval.status === "invalidated") return `Această aprobare nu mai poate ${what} (autoritatea a fost revocată, aparține altei credențiale, versiunea s-a schimbat sau cererea e dinainte de actualizare). Cere din nou aprobarea din ${where}.`;
  if (approval.status === "expired") return `Aprobarea a expirat. Cere din nou aprobarea din ${where}.`;
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
