import { HubError } from "../core/errors.mjs";
import { IMPORT_FIELDS, EVIDENCE_LABELS, SOURCE_KINDS, DATA_KINDS } from "./sales.mjs";
import { QUALIFICATION_FORMULA, QUALIFICATION_FORMULAS } from "./qualify.mjs";

const UI = ["ui", "test"];
/** Protective commands (stop contacting someone) may also come from voice, like Stop; nothing that adds effects does. */
const UI_AND_VOICE = ["ui", "test", "voice", "companion"];

/**
 * Sales commands (M04) on the Hub's command bus: validation schemas, channels and the approval actions for the
 * destructive or outward-facing steps (import rollback, proposal approval, draft content approval, lifting a
 * do-not-contact). Sending is refused while the transport is disabled (no approval is even requested for it).
 */
/**
 * What the command log keeps of a Sales result: ids and statuses, never contact values (e-mails, phones, texts).
 * The full result goes back to the caller; a replay by idempotency key returns this brief form.
 */
const brief = (r) => {
  if (!r || typeof r !== "object") return r ?? null;
  const pick = (o) => (o && typeof o === "object" ? { id: o.id ?? null, status: o.status ?? null } : null);
  return { id: r.id ?? r.handoffId ?? r.mergeId ?? r.sendId ?? r.auditId ?? null, status: r.status ?? null, version: r.version ?? null, duplicate: r.duplicate ?? undefined,
    done: r.done ?? undefined, org: pick(r.org), opportunity: pick(r.opportunity), batch: pick(r.batch), missionId: r.missionId ?? undefined, summary: r.summary ?? undefined };
};

export function registerSalesCommands(register, hub, { createMission }) {
  const { sales, projects } = hub;
  const reg = (type, handler) => register(type, { logResult: brief, ...handler });
  const ownerCheck = (ctx, what, fresh = false) => {
    if (ctx.channel === "test" && hub.config.testMode) return null;
    if (ctx.channel !== "owner") throw new HubError("policy", "Decizia cere canalul proprietarului");
    return fresh ? hub.trust.requireFresh(ctx.ownerSession, what) : hub.trust.requireSession(ctx.ownerSession, what);
  };

  reg("sales.import.create", { describe: "Încarcă un fișier CSV/XLSX de firme (lot nou; nimic nu se importă încă)", async: false,
    schema: { fileName: { required: true, max: 200 }, contentBase64: { required: true, max: 28 * 1024 * 1024 }, synthetic: { type: "boolean", default: false } },
    logPayload: (input) => ({ fileName: input.fileName, bytesBase64: String(input.contentBase64 || "").length, synthetic: input.synthetic }),
    execute: (input, ctx) => sales.createImport(input, ctx.actor) });
  reg("sales.import.mapping", { describe: "Maparea coloanelor lotului", schema: { batchId: { required: true, max: 80 }, mapping: { type: "object", required: true } },
    execute: (input, ctx) => sales.setMapping(input.batchId, input.mapping, ctx.actor) });
  reg("sales.import.preview", { describe: "Previzualizarea importului (validare, duplicate, potriviri; fără scrieri)", async: true, schema: { batchId: { required: true, max: 80 }, limit: { type: "integer", default: 50, min: 1, max: 200 } },
    execute: (input, ctx) => sales.preview(input.batchId, { limit: input.limit }, ctx.actor) });
  reg("sales.import.confirm", { describe: "Importă rândurile previzualizate (idempotent, reluabil, în tranșe)", schema: { batchId: { required: true, max: 80 }, maxRows: { type: "integer", default: 500, min: 1, max: 5000 } },
    execute: (input, ctx) => sales.confirm(input.batchId, { maxRows: input.maxRows }, ctx.actor) });
  reg("sales.import.rollback", { describe: "Rollback import: arhivează firmele create de lot și neatinse de atunci (cele modificate rămân)",
    schema: { batchId: { required: true, max: 80 }, reason: { max: 300, default: "" } },
    action: (input) => ({ actionKind: "sales.import_rollback", target: input.batchId, projectId: "*" }),
    execute: (input, ctx) => sales.rollback(input.batchId, ctx.actor, { reason: input.reason }) });
  reg("sales.import_row.resolve", { describe: "Decizia ta pentru un rând ambiguu: firmă nouă, firmă existentă sau sărit",
    schema: { rowId: { required: true, max: 80 }, action: { enum: ["create", "match", "skip"], required: true }, orgId: { max: 80 }, reason: { max: 200, default: "" } },
    execute: (input, ctx) => sales.resolveRow(input.rowId, input, ctx.actor) });

  reg("sales.org.transition", { describe: "Schimbă statusul unei firme (cu motiv)", schema: { orgId: { required: true, max: 80 }, to: { required: true, max: 40 }, reason: { max: 500, default: "" } },
    execute: (input, ctx) => (input.to === "DO_NOT_CONTACT" ? sales.suppress(input.orgId, { reason: input.reason, source: "owner" }, ctx.actor) : sales.transitionOrg(input.orgId, input, ctx.actor)) });
  reg("sales.org.update", { describe: "Corectează date ale firmei (cu sursa sau motivul)",
    schema: { orgId: { required: true, max: 80 }, city: { max: 80 }, county: { max: 80 }, address: { max: 300 }, caen: { max: 20 }, website: { max: 300 }, reason: { required: true, max: 300 } },
    execute: (input, ctx) => sales.updateOrg(input.orgId, input, ctx.actor) });
  reg("sales.evidence.add", { describe: "Adaugă o dovadă (afirmație + sursă + etichetă)",
    schema: { subjectType: { enum: ["org", "opportunity"], required: true }, subjectId: { required: true, max: 80 }, claim: { required: true, max: 300 }, value: { type: "any", max: 4000 },
      label: { enum: EVIDENCE_LABELS, required: true }, sourceKind: { enum: SOURCE_KINDS, required: true }, sourceRef: { required: true, max: 500 },
      excerpt: { max: 400, default: "" }, method: { max: 200, default: "" }, verifiedAt: { max: 40 }, recheckAfter: { max: 40 },
      // M12 C-03, additive (a call without dataKind is the M04 call, unchanged): the kind of the datum, and for an inference its basis
      // and reasoning. FIXTURE is refused here: only the fixture adapter and the synthetic generator produce fixture data.
      dataKind: { enum: DATA_KINDS }, basis: { type: "array", max: 20, items: "string", itemMax: 200 }, reasoning: { max: 400 } },
    execute: (input, ctx) => sales.addEvidence(input.subjectType, input.subjectId, input, ctx.actor) });
  reg("sales.org.audit", { describe: "Audit de site (doar fixture-uri .test în M04; colectarea live e dezactivată)", async: true,
    schema: { orgId: { required: true, max: 80 }, sourceKind: { enum: ["fixture", "live"], default: "fixture" } },
    execute: (input, ctx) => sales.auditOrg(input.orgId, { sourceKind: input.sourceKind }, ctx.actor) });
  // `formula` is additive (M12): q-v1 stays the default; the M12 preparation asks for q-v2 (inferences listed, never scored).
  reg("sales.org.qualify", { describe: "Calificare deterministă și explicabilă (fără model)",
    schema: { orgId: { required: true, max: 80 }, filters: { type: "object", default: {} }, formula: { enum: Object.keys(QUALIFICATION_FORMULAS), default: QUALIFICATION_FORMULA.version } },
    execute: (input, ctx) => sales.qualifyOrg(input.orgId, { filters: input.filters, formula: input.formula }, ctx.actor) });
  reg("sales.qualification.override", { describe: "Suprascrie prioritatea cu motiv (istoric păstrat)", channels: ["owner", "test"],
    schema: { orgId: { required: true, max: 80 }, displayedQualificationId: { max: 80, pattern: /^squ_[A-Za-z0-9_]+$/ }, priority: { type: "number", required: true, min: 0, max: 100 }, reason: { required: true, min: 5, max: 300 } },
    execute: (input, ctx) => sales.overrideQualification(input.orgId, input, ctx.actor, {
      channel: ctx.channel, sessionCheck: () => ownerCheck(ctx, "suprascrierea calificării") }) });
  reg("sales.org.suppress", { describe: "DO_NOT_CONTACT: oprește orice pregătire de contact pentru firmă (și la reimport)", channels: UI_AND_VOICE,
    schema: { orgId: { required: true, max: 80 }, reason: { required: true, min: 3, max: 300 } },
    execute: (input, ctx) => sales.suppress(input.orgId, { reason: input.reason, source: ctx.channel === "voice" ? "voice" : "owner" }, ctx.actor) });
  reg("sales.suppression.lift", { describe: "Ridică DO_NOT_CONTACT (decizia ta, cu motiv)", schema: { orgId: { required: true, max: 80 }, reason: { required: true, min: 5, max: 300 } },
    action: (input) => ({ actionKind: "sales.suppression_lift", target: input.orgId, projectId: "*" }),
    execute: (input, ctx) => sales.liftSuppression(input.orgId, input, ctx.actor) });
  reg("sales.org.merge", { describe: "Unește o firmă în alta (reversibil; refuzat pentru CUI-uri valide diferite)",
    schema: { orgId: { required: true, max: 80 }, intoId: { required: true, max: 80 }, reason: { required: true, min: 5, max: 300 } },
    execute: (input, ctx) => sales.mergeOrgs(input.orgId, input, ctx.actor) });
  reg("sales.merge.revert", { describe: "Anulează o unire", schema: { mergeId: { required: true, max: 80 } }, execute: (input, ctx) => sales.revertMerge(input.mergeId, ctx.actor) });

  reg("sales.service.save", { describe: "Catalogul de servicii (prețul și termenul doar dacă le configurezi)",
    schema: { serviceId: { max: 80 }, name: { required: true, max: 120 }, description: { max: 1000, default: "" }, scope: { type: "array", max: 20, items: "string", itemMax: 300 }, exclusions: { type: "array", max: 20, items: "string", itemMax: 300 }, tags: { type: "array", max: 20, items: "string", itemMax: 300 }, materials: { type: "array", max: 20, items: "string", itemMax: 300 },
      price: { type: "object" }, leadTime: { type: "object" }, active: { type: "boolean", default: true } },
    execute: (input, ctx) => sales.saveService(input, ctx.actor, input.serviceId || null) });

  reg("sales.opportunity.create", { describe: "Oportunitate nouă pentru o firmă (nevoie + serviciu)",
    schema: { orgId: { required: true, max: 80 }, title: { required: true, max: 160 }, need: { max: 2000, default: "" }, serviceId: { max: 80 } },
    execute: (input, ctx) => sales.createOpportunity(input, ctx.actor) });
  reg("sales.opportunity.transition", { describe: "Schimbă statusul oportunității (aprobarea, contactul și câștigul au evenimente proprii)",
    schema: { opportunityId: { required: true, max: 80 }, to: { required: true, max: 40 }, reason: { max: 500, default: "" } },
    execute: (input, ctx) => sales.transitionOpportunity(input.opportunityId, input, ctx.actor) });
  reg("sales.proposal.create", { describe: "Versiune nouă a propunerii (din dovezi și catalog; editările tale opționale)",
    schema: { opportunityId: { required: true, max: 80 }, edits: { type: "object" } },
    execute: (input, ctx) => sales.createProposal(input.opportunityId, { edits: input.edits || null }, ctx.actor) });
  reg("sales.proposal.approve", { describe: "Aprobarea internă a propunerii (legată de conținutul exact; nu e acceptarea clientului)",
    channels: ["owner", "test"], ownerDecision: true, logResult: (r) => r,
    schema: { proposalId: { required: true, max: 80, pattern: /^spr_[A-Za-z0-9_]+$/ }, displayedSha: { required: true, pattern: /^[0-9a-f]{64}$/, trim: false } },
    action: (input, ctx) => {
      ownerCheck(ctx, "aprobarea internă a ofertei");
      return { actionKind: "sales.proposal_approve", target: `${input.proposalId}@${String(input.displayedSha).slice(0, 12)}`, projectId: "*" };
    },
    authorizeApproved: (_input, ctx, approval) => {
      // A missing or stale EXECUTING session is the only refusal that can still succeed (401, the page unlocks and retries).
      const session = ownerCheck(ctx, "aprobarea internă a ofertei", true);
      if (ctx.channel === "test" && hub.config.testMode) return;
      // Only a decided approval has a decider to compare: a pending, rejected, expired or invalidated one gets the bus's own
      // status answer ("Approval is pending", …), never a misleading credential mismatch (review C1).
      if (!approval || !["approved", "consumed"].includes(approval.status)) return;
      // The refusals below are final: no session can ever make this decision executable again, so they are not authentication
      // errors (the page would ask for Windows Hello for nothing); the bus retires the decision and the owner requests it again.
      if (approval.decidedVia !== "owner_session" || approval.credentialId !== session.credentialId) throw new HubError("conflict", "Aprobarea aparține altei credențiale; cere din nou aprobarea", { code: "OWNER_CREDENTIAL_MISMATCH" });
      if (!hub.trust.confirmedAuthority(approval.sessionId).ok) throw new HubError("conflict", "Autoritatea aprobării a fost revocată; cere din nou aprobarea", { code: "OWNER_DECISION_REVOKED" });
      // Revoke-all ends active sessions. A decider already rotated/logged out must not carry an unexecuted decision
      // across that security boundary either; the boundary is recorded even when no session was open at that moment
      // (trust.revokeAllSessions). Event order works even with a fixed clock or decisions in the same millisecond.
      const revoked = hub.db.prepare(`SELECT 1 FROM events WHERE type='owner.sessions_revoked' AND seq >
        (SELECT MAX(seq) FROM events WHERE type='approval.approved' AND json_extract(payload_json, '$.approvalId')=?) LIMIT 1`).get(approval.id);
      if (revoked) throw new HubError("conflict", "Autoritatea aprobării a fost revocată; cere din nou aprobarea", { code: "OWNER_DECISION_REVOKED" });
    },
    execute: (input, ctx) => sales.approveProposal(input.proposalId, input, ctx.actor, {
      channel: ctx.channel, approvalId: hub.commands.get(ctx.commandId)?.approvalId,
      sessionCheck: () => ownerCheck(ctx, "aprobarea internă a ofertei") }) });
  reg("sales.draft.create", { describe: "Ciornă de contact (nu se trimite nimic)", schema: { opportunityId: { required: true, max: 80 }, contactId: { max: 80 }, proposalId: { max: 80 } },
    execute: (input, ctx) => sales.createDraft(input.opportunityId, input, ctx.actor) });
  reg("sales.draft.revise", { describe: "Editezi ciorna (versiune nouă; aprobările vechi nu se mai aplică)",
    schema: { draftId: { required: true, max: 80 }, subject: { max: 200 }, body: { max: 8000 } },
    execute: (input, ctx) => sales.reviseDraft(input.draftId, input, ctx.actor) });
  reg("sales.draft.approve_content", { describe: "Aprobi textul ciornei (nu înseamnă trimitere)",
    schema: { draftId: { required: true, max: 80 }, displayedSha: { required: true, max: 64 } },
    action: (input) => ({ actionKind: "sales.draft_content", target: `${input.draftId}@${String(input.displayedSha).slice(0, 12)}`, projectId: "*" }),
    execute: (input, ctx) => sales.approveDraftContent(input.draftId, input, ctx.actor) });
  reg("sales.draft.send", { describe: "Trimitere (dezactivată în M04: OUTREACH_DISABLED)", async: true,
    schema: { draftId: { required: true, max: 80 }, idempotencyKey: { required: true, max: 120 } },
    execute: (input, ctx) => sales.sendDraft(input.draftId, input, ctx.actor) });
  reg("sales.contact_event.record", { describe: "Înregistrezi un contact făcut de tine, un răspuns sau o opoziție la contact",
    schema: { opportunityId: { required: true, max: 80 }, kind: { enum: ["MANUAL_RECORDED", "REPLY_RECORDED", "OPT_OUT"], required: true }, occurredAt: { max: 40 },
      channel: { max: 40, default: "" }, note: { max: 1000, default: "" }, confirmText: { max: 120, default: "" } },
    execute: (input, ctx) => sales.recordContactEvent(input.opportunityId, input, ctx.actor) });
  reg("sales.acceptance.record", { describe: "Înregistrezi acceptarea clientului (o confirmi tu, cu textul exact)",
    schema: { opportunityId: { required: true, max: 80 }, proposalId: { required: true, max: 80 }, acceptedAt: { max: 40 }, note: { max: 1000, default: "" }, confirmText: { required: true, max: 120 } },
    execute: (input, ctx) => sales.recordClientAcceptance(input.opportunityId, input, ctx.actor) });
  reg("sales.handoff.create", { describe: "Predarea către Engineering: pachet + ciornă Software Factory (fără granturi, fără execuție)",
    schema: { opportunityId: { required: true, max: 80 }, projectId: { max: 80 } },
    execute: (input, ctx) => {
      const built = sales.buildHandoffPackage(input.opportunityId);
      // Idempotent: the same accepted version is handed off once (another tab, a double click). A package recorded without
      // a project gets its mission later on the same row.
      const existing = sales.currentHandoff(input.opportunityId, built.latest.contentSha);
      if (existing && (existing.missionId || !input.projectId)) {
        return { handoffId: existing.id, missionId: existing.missionId, package: existing.package, packageSha: existing.packageSha, existing: true };
      }
      let missionId = null;
      if (input.projectId) {
        const project = projects.get(input.projectId);
        if (!project) throw new HubError("not_found", "Proiectul nu există");
        const p = built.pkg;
        const mission = createMission({
          projectId: project.id, kind: "eng_feature", title: `${p.client.name}: ${p.proposal.title || "lucrare"}`.slice(0, 160), objective: (p.objectives[0] || p.proposal.title || "").slice(0, 2000),
          departmentKey: "engineering",
          spec: {
            workType: "FEATURE", title: `${p.client.name}: ${p.proposal.title || "lucrare"}`.slice(0, 160), objective: (p.objectives.join("\n") || p.proposal.title || "Lucrare din propunerea acceptată").slice(0, 4000),
            inScope: p.deliverables, outOfScope: p.exclusions, constraints: p.constraints, risks: [],
            acceptance: p.acceptanceCriteria.map((text) => ({ text, verify: "manual" })),
            verification: { checks: [], acceptance: [] },
            sources: { user: [`Propunerea v${p.proposal.version} (${p.proposal.sha.slice(0, 12)}) acceptată de client la ${p.acceptance.acceptedAt}`], code: [], assumptions: p.openQuestions },
          },
        }, ctx.actor);
        missionId = mission.id;
      }
      return sales.recordHandoff(input.opportunityId, built, missionId, ctx.actor, existing?.id || null);
    } });
  reg("sales.followup.schedule", { describe: "Follow-up (sarcină locală, fără mesaj automat)",
    schema: { opportunityId: { required: true, max: 80 }, basis: { enum: ["last_contact", "explicit_date"], default: "last_contact" }, afterDays: { type: "integer", min: 1, max: 90 }, dueAt: { max: 40 } },
    execute: (input, ctx) => sales.scheduleFollowup(input.opportunityId, input, ctx.actor) });
  reg("sales.followup.action", { describe: "Follow-up: făcut, suspendat, anulat sau reluat", channels: UI,
    schema: { followupId: { required: true, max: 80 }, action: { enum: ["done", "suspend", "cancel", "resume"], required: true }, reason: { max: 200, default: "" } },
    execute: (input, ctx) => sales.followupAction(input.followupId, input.action, input, ctx.actor) });
  reg("sales.followup.draft", { describe: "Ciornă de follow-up (nu se trimite nimic)", schema: { followupId: { required: true, max: 80 } },
    execute: (input, ctx) => {
      const f = sales.getFollowup(input.followupId);
      if (!f) throw new HubError("not_found", "Follow-up-ul nu există");
      if (!["DUE", "SCHEDULED"].includes(f.status)) throw new HubError("conflict", `Follow-up-ul e ${f.status}`);
      return sales.createDraft(f.opportunityId, { followupId: f.id }, ctx.actor);
    } });
  // M12 preparation: what only REDUCES activity (cancel) is accepted from every owner-facing channel (fail-safe, like ops.plan.cancel);
  // a continuation only PROPOSES a new card, which still needs the owner's own confirmation in the owner session (ops.plan.confirm).
  reg("sales.preparation.cancel", { describe: "Anulează pregătirea ofertei (fail-safe; ce s-a făcut rămâne, sintetic)", channels: ["ui", "owner", "voice", "companion", "test"],
    schema: { preparationId: { required: true, max: 80, pattern: /^spp_[A-Za-z0-9_]+$/ }, reason: { max: 200, default: "Anulată de tine" } },
    execute: (input, ctx) => {
      if (!hub.salesPreparations) throw new HubError("internal", "Pregătirea Sales nu e disponibilă");
      return hub.salesPreparations.cancel(input.preparationId, { reason: input.reason, actor: ctx.actor });
    } });
  reg("sales.preparation.continue", { describe: "Propune un card nou care continuă o pregătire oprită (aceeași, cu o confirmare nouă; nimic nu pornește până confirmi)",
    async: true, channels: ["ui", "owner", "test"], logResult: (r) => ({ planId: r?.plan?.id || null, status: r?.plan?.status || null, preparationId: r?.preparation?.id || null }),
    schema: { preparationId: { required: true, max: 80, pattern: /^spp_[A-Za-z0-9_]+$/ } },
    execute: (input, ctx) => {
      if (!hub.salesPreparations) throw new HubError("internal", "Pregătirea Sales nu e disponibilă");
      return hub.salesPreparations.continueCard(input.preparationId, { actor: ctx.actor, via: ctx.channel });
    } });
  reg("sales.owner.save", { describe: "Profilul firmei tale pentru propuneri (nume, semnătură, materiale confirmate)",
    schema: { companyName: { required: true, max: 120 }, signatureName: { max: 120, default: "" }, materials: { type: "array", max: 20, items: "string", itemMax: 300 } },
    execute: (input, ctx) => {
      const materials = (Array.isArray(input.materials) ? input.materials : []).map((m) => String(m).slice(0, 300)).filter(Boolean).slice(0, 20);
      // M12 review R7: the profile is rendered into every offer, so saving it makes the offers prepared by a plan STALE (same transaction).
      return sales.saveOwnerProfile({ companyName: input.companyName, signatureName: input.signatureName, materials }, ctx.actor);
    } });
  return { fields: IMPORT_FIELDS };
}
