// M12 Sales — the state contracts (C-05, T-S11), as data. One table for the objects the M12 flow sets or touches: the opportunity, the
// proposal (offer) rows, the preparation, „Dosarul ofertei” and the C-01 ledger (plus the contact draft the flow writes). For every
// transition: who sets it (the writer and the event it emits, in the same transaction), its preconditions, what it invalidates and what it
// does NOT imply. v2/tests/m12-state-contracts.test.mjs checks the table against the code (status sets, transition maps, the event every
// observed transition emitted, the refusals of the preconditions, the S-08 writers); the stage report prints it. Pure data: no I/O.

/** What no Sales state implies, whatever it is: nothing is sent, contacted, won or published by a state change of the M12 flow. */
export const NEVER_IMPLIED = Object.freeze(["trimis (sent)", "CONTACTED", "WON", "publicat", "predat către Engineering / Fabrică"]);

const T = (from, to, setBy, event, { pre = [], invalidates = [], notImplied = [], kind = "event" } = {}) =>
  Object.freeze({ from, to, setBy, event, preconditions: Object.freeze(pre), invalidates: Object.freeze(invalidates), doesNotImply: Object.freeze(notImplied), kind });

/** The opportunity (sales_opportunities.status). Manual moves follow OPPORTUNITY_TRANSITIONS; the event-only states have their own writer. */
const OPPORTUNITY_MANUAL = Object.freeze({
  IDENTIFIED: ["PROPOSAL_DRAFT", "ON_HOLD", "LOST"],
  PROPOSAL_DRAFT: ["READY_FOR_OWNER_REVIEW", "ON_HOLD", "LOST"],
  READY_FOR_OWNER_REVIEW: ["PROPOSAL_DRAFT", "ON_HOLD", "LOST"],
  APPROVED_INTERNAL: ["PROPOSAL_DRAFT", "ON_HOLD", "LOST"],
  CONTACTED: ["IN_DISCUSSION", "ON_HOLD", "LOST"],
  IN_DISCUSSION: ["ON_HOLD", "LOST"],
  ON_HOLD: ["IDENTIFIED", "PROPOSAL_DRAFT", "IN_DISCUSSION", "LOST"],
  WON: [],
  LOST: [],
});
const opportunity = Object.freeze({
  object: "opportunity", table: "sales_opportunities", statuses: Object.freeze(Object.keys(OPPORTUNITY_MANUAL)),
  eventOnly: Object.freeze(["APPROVED_INTERNAL", "CONTACTED", "WON"]),
  transitions: Object.freeze([
    T(null, "IDENTIFIED", "sales.mjs:createOpportunity (sales.opportunity.create; M12: pasul 1 al planului, createPreparationOrg)", "sales.opportunity.created",
      { pre: ["firma există, nu e unită sau arhivată"], notImplied: ["ofertă", "aprobare"] }),
    ...Object.entries(OPPORTUNITY_MANUAL).flatMap(([from, tos]) => tos.map((to) => T(from, to, "sales.mjs:transitionOpportunity (sales.opportunity.transition)", "sales.opportunity.transition",
      { pre: ["tranziția e în OPPORTUNITY_TRANSITIONS", "starea țintă nu e una doar prin eveniment (APPROVED_INTERNAL, CONTACTED, WON)"], notImplied: NEVER_IMPLIED, kind: "manual" }))),
    T("IDENTIFIED", "PROPOSAL_DRAFT", "sales.mjs:createProposal (o versiune nouă a ofertei)", "sales.opportunity.transition",
      { pre: ["oportunitatea nu e WON / LOST"], invalidates: ["aprobarea internă a versiunii anterioare", "ciornele construite pe ea"], notImplied: NEVER_IMPLIED }),
    T("READY_FOR_OWNER_REVIEW", "PROPOSAL_DRAFT", "sales.mjs:createProposal / invalidateBound (oferta legată de pregătire devine STALE)", "sales.opportunity.transition",
      { pre: ["o versiune nouă sau intrări schimbate ale ofertei legate (D7)"], invalidates: ["pregătirea care aștepta oferta (STALE)"], notImplied: NEVER_IMPLIED }),
    T("APPROVED_INTERNAL", "PROPOSAL_DRAFT", "sales.mjs:createProposal / invalidateBound (oferta legată de pregătire devine STALE)", "sales.opportunity.transition",
      { pre: ["o versiune nouă sau intrări schimbate ale ofertei legate (D7)"], invalidates: ["aprobarea internă", "ciornele (SUPERSEDED)", "dosarul (STALE)"], notImplied: NEVER_IMPLIED }),
    T("PROPOSAL_DRAFT", "READY_FOR_OWNER_REVIEW", "plan-executors.mjs:sales.proposal.draft (pasul 4 al planului confirmat) sau mutarea manuală M04", "sales.opportunity.transition",
      { pre: ["ultima versiune DRAFT", "fără sume, termene sau ROI inventate (COMMERCIAL_FIGURES)", "fără câmpuri necompletate"], notImplied: ["aprobarea ofertei", ...NEVER_IMPLIED] }),
    T("READY_FOR_OWNER_REVIEW", "APPROVED_INTERNAL", "sales.mjs:approveProposal (sales.proposal.approve → approval.owner_decide → execuția comenzii aprobate)", "sales.proposal.approved",
      { pre: ["sesiunea de proprietar recitită (canal owner) sau canalul test doar în modul test", "id-ul și SHA-ul complet afișate = ultima versiune DRAFT", "oferta nu e STALE",
        "aprobarea rezervată sales.proposal_approve decisă în sesiunea de proprietar, legată de payload"], notImplied: NEVER_IMPLIED, kind: "event_only" }),
    T("APPROVED_INTERNAL", "CONTACTED", "sales.mjs:sendDraft (doar cu un transport de test, în modul test; altfel OUTREACH_DISABLED) / recordContactEvent MANUAL_RECORDED", "sales.opportunity.transition",
      { pre: ["un eveniment de contact: trimitere reală (dezactivată în M12) sau contactul înregistrat manual de proprietar cu textul exact"], notImplied: ["WON"], kind: "event_only" }),
    T("READY_FOR_OWNER_REVIEW", "CONTACTED", "sales.mjs:recordContactEvent MANUAL_RECORDED (proprietarul, cu textul exact)", "sales.opportunity.transition",
      { pre: ["contactul făcut de proprietar în afara Hub-ului, înregistrat cu textul exact"], notImplied: ["WON"], kind: "event_only" }),
    T("PROPOSAL_DRAFT", "CONTACTED", "sales.mjs:recordContactEvent MANUAL_RECORDED (proprietarul, cu textul exact)", "sales.opportunity.transition",
      { pre: ["contactul făcut de proprietar în afara Hub-ului, înregistrat cu textul exact"], notImplied: ["WON"], kind: "event_only" }),
    T("IDENTIFIED", "CONTACTED", "sales.mjs:recordContactEvent MANUAL_RECORDED (proprietarul, cu textul exact)", "sales.opportunity.transition",
      { pre: ["contactul făcut de proprietar în afara Hub-ului, înregistrat cu textul exact"], notImplied: ["WON"], kind: "event_only" }),
    T("CONTACTED", "IN_DISCUSSION", "sales.mjs:recordContactEvent REPLY_RECORDED (răspunsul înregistrat de proprietar)", "sales.opportunity.transition",
      { pre: ["oportunitatea e CONTACTED"], notImplied: ["WON"] }),
    T("CONTACTED", "WON", "sales.mjs:recordClientAcceptance (proprietarul, cu textul exact)", "sales.opportunity.transition",
      { pre: ["un contact real înregistrat", "acceptarea clientului înregistrată de proprietar, pe ultima versiune aprobată"], notImplied: ["predat către Engineering / Fabrică"], kind: "event_only" }),
    T("IN_DISCUSSION", "WON", "sales.mjs:recordClientAcceptance (proprietarul, cu textul exact)", "sales.opportunity.transition",
      { pre: ["un contact real înregistrat", "acceptarea clientului înregistrată de proprietar, pe ultima versiune aprobată"], notImplied: ["predat către Engineering / Fabrică"], kind: "event_only" }),
  ]),
});

/** The offer rows (sales_proposals.status). STALE exists only for a preparation-bound offer (content.basis) and never returns to current. */
export const PROPOSAL_STATUSES = Object.freeze(["DRAFT", "APPROVED_INTERNAL", "SUPERSEDED", "STALE"]);
const proposal = Object.freeze({
  object: "proposal", table: "sales_proposals", statuses: PROPOSAL_STATUSES,
  transitions: Object.freeze([
    T(null, "DRAFT", "sales.mjs:createProposal (sales.proposal.create; M12: pasul 4, cu basis și secțiunea „Ce s-a cerut”)", "sales.proposal.created",
      { pre: ["oportunitatea nu e WON / LOST", "M12: fără sume inventate, prețuri „De stabilit (neconfigurat)”"], invalidates: ["versiunea anterioară (SUPERSEDED)", "ciornele ei (SUPERSEDED)"], notImplied: ["aprobare", ...NEVER_IMPLIED] }),
    T("DRAFT", "APPROVED_INTERNAL", "sales.mjs:approveProposal (decizia proprietarului)", "sales.proposal.approved",
      { pre: ["exact id + SHA complet al ultimei versiuni", "sesiunea de proprietar recitită", "oferta nu e STALE"], notImplied: NEVER_IMPLIED, kind: "event_only" }),
    T("DRAFT", "SUPERSEDED", "sales.mjs:createProposal (o versiune nouă)", "sales.proposal.created", { pre: ["o versiune mai nouă a aceleiași oportunități"], notImplied: NEVER_IMPLIED }),
    T("APPROVED_INTERNAL", "SUPERSEDED", "sales.mjs:createProposal (o versiune nouă)", "sales.proposal.created",
      { pre: ["o versiune mai nouă a aceleiași oportunități"], invalidates: ["aprobarea internă a versiunii vechi"], notImplied: NEVER_IMPLIED }),
    T("STALE", "SUPERSEDED", "sales.mjs:createProposal (o versiune nouă)", "sales.proposal.created", { pre: ["o versiune mai nouă a aceleiași oportunități"], notImplied: ["că oferta STALE redevine curentă"] }),
    T("DRAFT", "STALE", "sales.mjs:invalidateBound (scrierile care schimbă intrările ofertei legate: dovezi, audit, calificare, suprascriere, suprimare, unire)", "sales.proposal.stale",
      { pre: ["oferta e legată de o pregătire (content.basis)", "intrările ei s-au schimbat (sau o suprimare / o unire)"], invalidates: ["ciornele ei (SUPERSEDED)", "pregătirea (STALE)", "dosarul (STALE)"], notImplied: ["că redevine curentă"] }),
    T("APPROVED_INTERNAL", "STALE", "sales.mjs:invalidateBound", "sales.proposal.stale",
      { pre: ["oferta e legată de o pregătire (content.basis)", "intrările ei s-au schimbat"], invalidates: ["aprobarea internă", "ciornele ei (SUPERSEDED)", "pregătirea (STALE)", "dosarul (STALE)"], notImplied: ["că redevine curentă"] }),
  ]),
});

/** The preparation (sales_preparations.status), D6. Every change is one event of its service (sales.preparation.status). */
const PREP_EVENT = "sales.preparation.status";
const preparation = Object.freeze({
  object: "preparation", table: "sales_preparations",
  statuses: Object.freeze(["PLANNED", "PREPARING", "WAITING_OWNER", "PACKAGING", "READY", "STALE", "STOPPED", "EXPIRED", "CANCELLED", "FAILED"]),
  transitions: Object.freeze([
    T(null, "PLANNED", "owner/planners/sales.mjs:prepare (un singur card, nimic nu rulează)", "sales.preparation.planned", { notImplied: ["vreun efect în domeniu", "aprobarea ofertei"] }),
    T("PLANNED", "PREPARING", "plan-executors.mjs:sales.synthetic (pasul 1, sub consimțământul cardului confirmat)", PREP_EVENT,
      { pre: ["cardul confirmat de proprietar (o confirmare)", "brieful are aceeași amprentă"], notImplied: ["aprobarea ofertei"] }),
    T("PLANNED", "EXPIRED", "preparation.mjs:onEvent ops.plan.expired (cardul neconfirmat la timp)", PREP_EVENT),
    T("PLANNED", "CANCELLED", "preparation.mjs:cancel / onEvent ops.plan.cancelled / ops.plan.superseded", PREP_EVENT),
    T("PREPARING", "WAITING_OWNER", "plan-executors.mjs:sales.proposal.draft (pasul 4: oferta READY_FOR_OWNER_REVIEW, id + SHA așteptate)", PREP_EVENT,
      { pre: ["oferta fără sume inventate și fără câmpuri necompletate"], notImplied: ["aprobarea ofertei", ...NEVER_IMPLIED] }),
    T("PREPARING", "STALE", "preparation.mjs:onEvent ops.plan.failed (cod de intrări schimbate)", PREP_EVENT),
    T("PREPARING", "EXPIRED", "preparation.mjs:expireDead (tick / pauză sau NEEDS_OWNER: fereastra planului de fază A a trecut cât era oprit; planul mort e anulat, continuarea se oferă)", PREP_EVENT,
      { invalidates: ["continuarea automată"] }),
    T("PREPARING", "FAILED", "preparation.mjs:onEvent ops.plan.failed", PREP_EVENT),
    T("PREPARING", "CANCELLED", "preparation.mjs:cancel / onEvent ops.plan.cancelled", PREP_EVENT),
    T("WAITING_OWNER", "PACKAGING", "preparation.mjs:activate (CAS după aprobarea proprietarului a exact id + SHA, în sesiunea de proprietar; planul DONE)", PREP_EVENT,
      { pre: ["aprobarea sales.proposal_approve decisă în sesiunea de proprietar, payload = id + SHA așteptate", "planul de pregătire DONE", "în fereastra planului confirmat"],
        notImplied: NEVER_IMPLIED }),
    T("WAITING_OWNER", "STALE", "sales.mjs:invalidateBound → preparation.mjs:onInvalidated; activarea (altă versiune)", PREP_EVENT, { invalidates: ["continuarea automată"] }),
    T("WAITING_OWNER", "STOPPED", "preparation.mjs:onEvent system.stop_all; activarea (aprobare nedecisă în sesiunea de proprietar)", PREP_EVENT, { invalidates: ["continuarea automată"] }),
    T("WAITING_OWNER", "EXPIRED", "preparation.mjs:activate / tick (fereastra planului confirmat a trecut)", PREP_EVENT, { invalidates: ["continuarea automată"] }),
    T("WAITING_OWNER", "CANCELLED", "preparation.mjs:cancel / onEvent ops.plan.cancelled", PREP_EVENT),
    T("PACKAGING", "READY", "preparation.mjs:completeDossier (tranzacția finală a pasului sales.dossier)", PREP_EVENT,
      { pre: ["planul derivat (sales.dossier) e al acestei pregătiri", "intrările dosarului neschimbate"], notImplied: NEVER_IMPLIED }),
    T("PACKAGING", "STALE", "preparation.mjs:activate / onInvalidated / onEvent ops.plan.failed (cod de intrări schimbate)", PREP_EVENT),
    T("PACKAGING", "STOPPED", "preparation.mjs:activate („Oprește tot” după confirmare, autoritate revocată)", PREP_EVENT),
    T("PACKAGING", "EXPIRED", "preparation.mjs:activate (fereastra a trecut)", PREP_EVENT),
    T("PACKAGING", "FAILED", "preparation.mjs:activate / onEvent ops.plan.failed", PREP_EVENT),
    T("PACKAGING", "CANCELLED", "preparation.mjs:cancel / onEvent ops.plan.cancelled", PREP_EVENT),
    T("READY", "STALE", "preparation.mjs:onInvalidated (ultimul dosar nu mai e READY)", PREP_EVENT, { notImplied: ["că dosarul se rescrie singur"] }),
    ...["STALE", "STOPPED", "EXPIRED", "FAILED"].flatMap((from) => [
      T(from, "PREPARING", "plan-executors.mjs:sales.synthetic sub un card de continuare (sales.preparation.continue) confirmat de proprietar, aceeași rădăcină, aceeași cheie", PREP_EVENT,
        { pre: ["o confirmare nouă (cardul de continuare)", "aceeași credențială ca la confirmarea inițială"], notImplied: ["aprobarea ofertei"] }),
      T(from, "CANCELLED", "preparation.mjs:cancel (sales.preparation.cancel)", PREP_EVENT),
    ]),
  ]),
});

/** „Dosarul ofertei” (sales_dossiers.status), D6. */
const dossier = Object.freeze({
  object: "dossier", table: "sales_dossiers", statuses: Object.freeze(["WRITING", "READY", "STALE", "SUPERSEDED", "INCOMPLETE"]),
  transitions: Object.freeze([
    T(null, "WRITING", "preparation.mjs:reserveDossier (pasul sales.dossier, o rezervare per cheie C-01; fără eveniment)", null,
      { pre: ["pregătirea PACKAGING sub planul ei derivat", "oferta APPROVED_INTERNAL cu SHA-ul aprobat", "ciorna DRAFT_ONLY a ofertei", "firmă sintetică", "folder de exporturi aprobat"], notImplied: NEVER_IMPLIED }),
    T("WRITING", "READY", "preparation.mjs:completeDossier (manifestul scris ultimul)", "sales.dossier.written",
      { pre: ["fiecare fișier scris exclusiv și verificat", "intrările neschimbate în tranzacția finală"], invalidates: ["reviziile READY mai vechi (SUPERSEDED)"], notImplied: NEVER_IMPLIED }),
    T("WRITING", "INCOMPLETE", "preparation.mjs:recordDossierFiles (o oprire sau o eroare; fișierele scrise declarate)", "sales.dossier.incomplete", { notImplied: ["că fișierele parțiale sunt dosarul"] }),
    T("INCOMPLETE", "WRITING", "preparation.mjs:reserveDossier (reluarea aceleiași chei, în același folder)", null, { notImplied: ["copii „ (2)”"] }),
    T("READY", "STALE", "preparation.mjs:onInvalidated / markDossierStale (intrările s-au schimbat)", "sales.dossier.stale", { notImplied: ["că se rescrie singur"] }),
    T("READY", "SUPERSEDED", "preparation.mjs:completeDossier al unei revizii mai noi", "sales.dossier.superseded"),
  ]),
});

/** The C-01 ledger (sales_plan_ops.status): the operation's own event is written in the same transaction as its DONE row. */
const ledger = Object.freeze({
  object: "ledger", table: "sales_plan_ops", statuses: Object.freeze(["IN_PROGRESS", "DONE", "FAILED"]),
  transitions: Object.freeze([
    T(null, "IN_PROGRESS", "plan-ledger.mjs:runSync / claim (cheia = planul confirmat rădăcină + operația + parametrii normalizați)", null,
      { pre: ["aceeași cheie cu alți parametri → IDEMPOTENCY_CONFLICT"] }),
    T("IN_PROGRESS", "DONE", "plan-ledger.mjs:runSync (efect + eveniment + DONE într-o tranzacție) / complete (CAS pe token)", "evenimentul operației (de ex. sales.synthetic.created, sales.research.recorded)",
      { notImplied: ["o a doua execuție a efectului la reluare"] }),
    T("IN_PROGRESS", "FAILED", "plan-ledger.mjs:release (eroare)", null),
    T("FAILED", "IN_PROGRESS", "plan-ledger.mjs:claim (o reluare a aceleiași chei)", null),
    T("IN_PROGRESS", "IN_PROGRESS", "plan-ledger.mjs:claim (un rând rămas de la o oprire bruscă, preluat de procesul acesta)", null),
  ]),
});

/** The contact draft the flow writes (only DRAFT, DRAFT_ONLY; never sent by the flow). */
const draft = Object.freeze({
  object: "draft", table: "sales_drafts", statuses: Object.freeze(["DRAFT", "CONTENT_APPROVED", "SEND_AUTHORIZED", "SENT", "SUPERSEDED"]), m12Writes: Object.freeze(["DRAFT", "SUPERSEDED"]),
  transitions: Object.freeze([
    T(null, "DRAFT", "sales.mjs:createDraft (M12: pasul B1 al planului derivat)", "sales.draft.created",
      { pre: ["oferta APPROVED_INTERNAL (precondiția M04 neschimbată)", "un contact generic activ"], notImplied: ["trimis (sent)", "CONTACTED", "WON"] }),
    T("DRAFT", "SUPERSEDED", "sales.mjs:createProposal / createDraft / invalidateBound", null, { notImplied: ["trimis (sent)"] }),
  ]),
});

/** The table (C-05), in the order the stage report prints it. */
export const STATE_CONTRACTS = Object.freeze({ opportunity, proposal, preparation, dossier, ledger, draft });

/** The only code lines that may set CONTACTED or WON (S-08): the existing M04 writers, matched by their exact text. */
export const CONTACTED_WON_WRITERS = Object.freeze([
  Object.freeze({ fn: "sendDraft", status: "CONTACTED", line: `if (opp.status === "APPROVED_INTERNAL") setOppStatus(opp, "CONTACTED", actor, "Mesaj livrat (eveniment de transport)");` }),
  Object.freeze({ fn: "recordContactEvent", status: "CONTACTED", line: `if (kind === "MANUAL_RECORDED" && ["APPROVED_INTERNAL", "READY_FOR_OWNER_REVIEW", "PROPOSAL_DRAFT", "IDENTIFIED"].includes(opp.status)) setOppStatus(opp, "CONTACTED", actor, "Contact înregistrat manual de proprietar");` }),
  Object.freeze({ fn: "recordClientAcceptance", status: "WON", line: "setOppStatus(opp, \"WON\", actor, `Acceptarea clientului înregistrată (propunerea v${latest.version})`);" }),
]);

/** Every transition as one flat row (object, from, to, setBy, event, preconditions, invalidates, doesNotImply, kind) — the report's table. */
export function stateContractRows() {
  return Object.values(STATE_CONTRACTS).flatMap((c) => c.transitions.map((t) => ({ object: c.object, ...t })));
}
