// M13 „Birou intern” planner — the owner's words → ONE operation-plan card per flow, no model:
//   „pregătește dosarul de pornire a proiectului din oferta aprobată”  → Operations (desk.ops.prepare)
//   „caz de suport pentru Demo Livrare: <cererea sintetică>”           → Customer Support (desk.support.prepare)
//   „pregătește devizul din oferta aprobată”                          → Finance-Admin (desk.finance.prepare)
// The same subject asked again never makes a second record: the existing one is shown (or its pending card, or ONE continuation card
// when it stopped / went stale). Confirming the card never approves the reply or the deviz: that decision stays the owner's, separately.
import { hashCanonical } from "../../core/canonical.mjs";
import { HubError } from "../../core/errors.mjs";
import { newId } from "../../core/ids.mjs";
import { foldDiacritics } from "../../sales/identity.mjs";
import { NEVER_IN_PLANS } from "../../ops/plans.mjs";
import { DESK_FLOWS, DESK_STATUS_RO, DESK_CONTINUABLE, deskPhaseALimits } from "../../desk/desk.mjs";
import { DESK_NEVER } from "../../desk/builders.mjs";

const fold = (s) => foldDiacritics(String(s || "")).toLowerCase();
const opsCard = (plan) => plan && ({ id: plan.id, kind: plan.kind, title: plan.title, status: plan.status, summary: plan.summary, hash: plan.hash, nonce: plan.nonce, confirmBy: plan.confirmBy, decisions: plan.body?.decisions || [] });
const FLOW_OF_INTENT = Object.freeze({ desk_ops_prepare: "ops_start", desk_support_prepare: "support_case", desk_finance_prepare: "finance_doc" });
const WITH_SPEC = /\b(?:misiun|engineering|spec[_ -]?draft|specificati)/;
/** The SPEC_DRAFT sketch is asked for: a mission / spec word that no „fără / nu / niciun / nici” governs just before it. */
export function asksForSpec(folded) {
  const text = String(folded || "");
  for (const m of text.matchAll(new RegExp(WITH_SPEC.source, "g"))) {
    const before = text.slice(Math.max(0, m.index - 30), m.index).split(/[,.;]|\b(?:dar|insa|ci)\b/).pop();
    if (!/\b(?:fara|nu|niciun|nicio|nici|in afara)\b/.test(before)) return true;
  }
  return false;
}

/** The text of a support request: the part after the first „:” or the quoted part; else the sentence without its command words. */
export function supportRequestOf(text) {
  const raw = String(text || "").trim();
  const i = raw.indexOf(":");
  if (i > 0 && raw.slice(i + 1).trim().length >= 5) {
    const after = raw.slice(i + 1).trim();
    const q = after.match(/^[„"“]([^”"“„]{5,2000})[”"“]\s*$/);
    return q ? q[1].trim() : after;
  }
  const quoted = raw.match(/[„"“]([^”"“„]{5,2000})[”"“]/);
  if (quoted) return quoted[1].trim();
  return raw.replace(/^\s*(?:te rog,?\s*)?(?:(?:înregistrează|inregistreaza|deschide|creează|creeaza|fă|fa|adaugă|adauga)(?:-mi)?\s+)?(?:un\s+|o\s+)?(?:caz|tichet|solicitare|cerere|sesizare)(?:ul|a)?(?:\s+nou[aă]?)?(?:\s+de\s+suport)?\s*/i, "").trim();
}

export function registerDeskPlanner(hub, intake) {
  const desk = hub.desk;
  const db = hub.db;
  const exportsReady = () => Boolean(hub.media?.exportsDir?.());
  const noExports = () => {
    const why = "Nu pot pregăti exportul: nu există încă un folder de exporturi aprobat (îl alegi o dată în Studio). Cererea ta rămâne păstrată.";
    return { kind: "blocked", text: why, blocker: { signature: "DESK_NO_EXPORTS_DIR", cause: "DESK_NO_EXPORTS_DIR", text: why }, request: { planRef: null } };
  };
  /** The internally approved, current offers (synthetic in M13), newest first, with the company name. */
  function approvedOffers() {
    return db.prepare("SELECT o.id FROM sales_opportunities o WHERE o.status = 'APPROVED_INTERNAL' AND o.synthetic = 1 ORDER BY o.updated_at DESC LIMIT 20").all()
      .map((r) => ({ id: r.id, ...desk.approvedOffer(r.id) })).filter((o) => o.ok);
  }
  /** One offer the words point at: the company named, or the only approved one; else ONE question. */
  function pickOffer(text) {
    const offers = approvedOffers();
    if (!offers.length) return { message: "Nu găsesc nicio ofertă aprobată intern (curentă). Întâi pregătești și aprobi oferta în Vânzări; apoi pregătesc din ea." };
    const t = fold(text);
    const named = offers.filter((o) => fold(o.org.displayName).split(/[^a-z0-9]+/).filter((w) => w.length >= 5 && !["service", "servicii"].includes(w)).some((w) => t.includes(w)));
    const list = named.length ? named : offers;
    if (list.length === 1) return { offer: list[0] };
    return { message: `Am mai multe oferte aprobate intern: ${list.map((o) => `„${o.org.displayName}” (${o.proposal.id} v${o.proposal.version})`).join(", ")}. Spune-mi firma.` };
  }
  /** Projects with an accepted package (a support case reads only those), newest first. */
  function supportProjects() {
    const seen = new Set();
    return db.prepare("SELECT id, project_id FROM deliveries WHERE status = 'READY' ORDER BY created_at DESC LIMIT 50").all()
      .filter((d) => !seen.has(d.project_id) && seen.add(d.project_id)).map((d) => ({ deliveryId: d.id, ...desk.acceptedSources(d.project_id, d.id) })).filter((x) => x.ok);
  }
  function pickProject(text) {
    const list = supportProjects();
    if (!list.length) return { message: "Nu găsesc niciun proiect cu un pachet livrat și acceptat de tine; un caz de suport citește doar sursele unei livrări acceptate." };
    const t = fold(text);
    const named = list.filter((p) => fold(p.project.name).split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !["demo", "livrare"].includes(w)).some((w) => t.includes(w)) || t.includes(fold(p.project.slug || "~~")) || t.includes(fold(p.project.name)));
    const pool = named.length ? named : list;
    if (pool.length === 1) return { project: pool[0] };
    return { message: `Pentru care proiect e cazul? ${pool.map((p) => `„${p.project.name}”`).join(", ")}.` };
  }
  /** The steps of a flow's phase-A card (the first card and a continuation: the same kinds, only `continues` differs). */
  async function stepsFor(r, { continues = null } = {}) {
    if (r.kind === "ops_start" || r.kind === "finance_doc") {
      const o = desk.approvedOffer(r.opportunityId);
      if (!o.ok) throw new HubError("conflict", `Oferta nu mai e aprobată intern: ${o.reason} Întâi o aprobi (sau o nouă versiune) în Vânzări.`, { code: "DESK_STALE" });
      const pin = { recordId: r.id, opportunityId: r.opportunityId, proposalId: o.proposal.id, proposalSha: o.proposal.contentSha, ...(continues ? { continues } : {}) };
      return r.kind === "ops_start"
        ? { steps: [{ kind: "desk.ops.record", params: { ...pin, withSpec: Boolean(r.source?.withSpec) } }, { kind: "desk.ops.export", params: { recordId: r.id } }], offer: o }
        : { steps: [{ kind: "desk.finance.document", params: pin }], offer: o };
    }
    const s = desk.acceptedSources(r.projectId, r.deliveryId);
    if (!s.ok) throw new HubError("conflict", s.reason, { code: "DESK_STALE" });
    return { steps: [{ kind: "desk.support.case", params: { recordId: r.id, projectId: r.projectId, deliveryId: r.deliveryId, bundleSha: s.sources.delivery.bundleSha, requestSha: hashCanonical(r.request), ...(continues ? { continues } : {}) } },
      { kind: "desk.support.reply", params: { recordId: r.id } }] };
  }
  desk.registerSteps(stepsFor);
  const cardOf = (plan, r, note, extra = {}) => ({ kind: "ops", plan, note, recordId: r.id,
    card: { opsPlan: { ...opsCard(plan), recordId: r.id, internalNo: r.internalNo, deskKind: r.kind, synthetic: true, model: "fără model", then: plan.body?.steps?.at(-1)?.params?.then || null,
      decisionsLeft: desk.decisionsLeft(r.kind), never: [...NEVER_IN_PLANS, ...DESK_NEVER], ...extra }, note } });
  /** The same subject again: its pending card, ONE continuation card, or the truthful state (never a second record). */
  async function existing(r, ctx) {
    // A card that expired or was replaced before you confirmed it holds nothing: the new request gets its own record and card.
    if (DESK_CONTINUABLE.includes(r.status) && !desk.isContinuable(r) && !(r.consent?.rootCredential || hub.opsPlans.view(r.rootPlanId)?.consent?.credential)) return null;
    if (r.status === "PLANNED") {
      const plan = hub.opsPlans.view(r.planId);
      if (plan?.status === "PROPOSED") return cardOf(plan, r, `Cardul pentru ${r.internalNo} e deja pregătit; îl confirmi o dată (nimic nu a pornit).`);
    }
    if (DESK_CONTINUABLE.includes(r.status) && desk.isContinuable(r)) {
      try {
        const out = await desk.continueCard(r.id, { actor: ctx?.actor || "intake", via: "intake" });
        return cardOf(out.plan, r, `${DESK_FLOWS[r.kind].title} ${r.internalNo} e ${DESK_STATUS_RO[r.status]}: un singur card nou îl continuă (aceeași înregistrare; ce e făcut nu se repetă). Îl confirmi o dată.`, { continues: true });
      } catch (error) {
        if (error?.code === "GATE_REARM_REQUIRED") return { kind: "message", gate: true, code: "GATE_REARM_REQUIRED", text: String(error.message) };
        return { kind: "message", code: error?.code || null, text: `Nu pot continua ${r.internalNo}: ${error?.message || "eroare"}` };
      }
    }
    if (r.status === "PLANNED") return null;
    return { kind: "message", recordId: r.id, text: `${DESK_FLOWS[r.kind].title} ${r.internalNo} există deja: ${DESK_STATUS_RO[r.status] || r.status}. Următoarea acțiune: ${r.nextAction || "—"}` };
  }

  async function prepare({ step, text, ctx }) {
    const flow = FLOW_OF_INTENT[step?.intent] || (["ops_start", "support_case", "finance_doc"].includes(step?.args?.flow) ? step.args.flow : null);
    if (!flow) return { kind: "message", text: "Spune-mi ce pregătesc: dosarul de pornire a proiectului, un caz de suport sau devizul din oferta aprobată." };
    if (!exportsReady()) return noExports();
    const raw = String(text || step?.args?.request || "");
    const actor = ctx?.actor || "intake";
    if (flow === "support_case") {
      const request = supportRequestOf(raw);
      if (request.length < 5) return { kind: "question", question: "Care e cererea de suport (sintetică)? Scrie-o după „:”, de exemplu: „caz de suport pentru Demo Livrare: clienții pot anula singuri o programare?”", forIntent: "desk_support_prepare" };
      const pick = pickProject(raw);
      if (!pick.project) return { kind: "message", text: pick.message };
      const p = pick.project;
      const requestSha = hashCanonical(request);
      const same = desk.sameSubject({ kind: flow, projectId: p.project.id, requestSha });
      if (same) { const out = await existing(same, ctx); if (out) return out; }
      const id = newId("dsk");
      const steps = [{ kind: "desk.support.case", params: { recordId: id, projectId: p.project.id, deliveryId: p.delivery.id, bundleSha: p.sources.delivery.bundleSha, requestSha } }, { kind: "desk.support.reply", params: { recordId: id } }];
      const plan = await hub.opsPlans.propose({ kind: DESK_FLOWS[flow].kind, title: `Caz de suport (cerere SINTETICĂ) pentru ${p.project.name}`.slice(0, 200), steps, limits: deskPhaseALimits(), actor, via: "intake" });
      const raced = desk.sameSubject({ kind: flow, projectId: p.project.id, requestSha });
      if (raced && raced.id !== same?.id) { try { hub.opsPlans.cancel(plan.id, { reason: "aceeași cerere are deja o înregistrare", actor: "hub" }); } catch { /* closed */ } const out = await existing(raced, ctx); if (out) return out; }
      const r = desk.createPlanned({ id, kind: flow, plan, title: `Caz de suport: ${request}`.slice(0, 200), request, pinned: { projectId: p.project.id, deliveryId: p.delivery.id },
        source: { requestSha, bundleId: p.sources.delivery.bundleId, bundleSha: p.sources.delivery.bundleSha }, actor });
      return cardOf(plan, r, `Un singur card, fără model: înregistrez cazul ${r.internalNo} (cerere SINTETICĂ, nu a unui client real), îl clasific după o regulă declarată, citesc doar criteriile verificate ale pachetului acceptat ${p.sources.delivery.bundleId} și pregătesc răspunsul în ciornă (DRAFT_ONLY — NETRIMIS). Aprobarea textului rămâne decizia ta, separat; după ea, exportul cazului se face fără altă întrebare. Clasificarea „defect raportat” nu dovedește un defect.`,
        { request, project: { id: p.project.id, name: p.project.name } });
    }
    const pick = pickOffer(raw);
    if (!pick.offer) return { kind: "message", text: pick.message };
    const o = pick.offer;
    const same = desk.sameSubject({ kind: flow, opportunityId: o.opportunity.id });
    if (same) { const out = await existing(same, ctx); if (out) return out; }
    const id = newId("dsk");
    const pin = { recordId: id, opportunityId: o.opportunity.id, proposalId: o.proposal.id, proposalSha: o.proposal.contentSha };
    const withSpec = flow === "ops_start" && asksForSpec(fold(raw));
    const steps = flow === "ops_start" ? [{ kind: "desk.ops.record", params: { ...pin, withSpec } }, { kind: "desk.ops.export", params: { recordId: id } }] : [{ kind: "desk.finance.document", params: pin }];
    const title = flow === "ops_start" ? `Dosarul de pornire a proiectului (intern, sintetic): ${o.org.displayName}` : `Devizul în ciornă (intern, sintetic): ${o.org.displayName}`;
    const plan = await hub.opsPlans.propose({ kind: DESK_FLOWS[flow].kind, title: title.slice(0, 200), steps, limits: deskPhaseALimits(), actor, via: "intake" });
    const raced = desk.sameSubject({ kind: flow, opportunityId: o.opportunity.id });
    if (raced && raced.id !== same?.id) { try { hub.opsPlans.cancel(plan.id, { reason: "aceeași cerere are deja o înregistrare", actor: "hub" }); } catch { /* closed */ } const out = await existing(raced, ctx); if (out) return out; }
    const r = desk.createPlanned({ id, kind: flow, plan, title, pinned: { opportunityId: o.opportunity.id, proposalId: o.proposal.id, proposalSha: o.proposal.contentSha }, source: { withSpec, proposalVersion: o.proposal.version }, actor });
    const offerLine = `oferta aprobată intern ${o.proposal.id} v${o.proposal.version} (SHA ${o.proposal.contentSha.slice(0, 12)}…)`;
    const note = flow === "ops_start"
      ? `Un singur card, fără model: din ${offerLine} pregătesc înregistrarea internă ${r.internalNo} (materialele de cerut clientului, ce e primit și ce lipsește, întrebări, riscuri, responsabil, termene — cele necunoscute marcate) și o export ca „Dosarul de pornire a proiectului”${withSpec ? ", cu o schiță de misiune Engineering SPEC_DRAFT (necreată în Fabrică, nepornită)" : ""}. Aprobarea internă nu e acceptarea clientului: nu marchez CONTACTED / WON și nu pornesc nicio lucrare Engineering.`
      : `Un singur card, fără model: din ${offerLine} pregătesc devizul ${r.internalNo} în ciornă (prețul și termenul exact ca în ofertă — „De stabilit”, fără total calculat) și îl înregistrez în registrul local. Aprobarea lui exactă (ID + SHA) rămâne decizia ta, separat; după ea, Word și PDF se fac fără altă întrebare. Nu e un document fiscal și nu se trimite.`;
    const other = flow === "ops_start" ? (/\bdeviz/.test(fold(raw)) ? " Ai pomenit și devizul: îl pregătesc când îl ceri separat (un card pe cerere)." : "")
      : (/\bdosar(?:ul)? de pornire\b/.test(fold(raw)) ? " Ai pomenit și dosarul de pornire: îl pregătesc când îl ceri separat (un card pe cerere)." : "");
    return cardOf(plan, r, note + other, { offer: { proposalId: o.proposal.id, version: o.proposal.version, sha: o.proposal.contentSha, org: o.org.displayName } });
  }
  intake.registerPlanner("desk", (args) => prepare(args));
  return { prepare, stepsFor };
}
