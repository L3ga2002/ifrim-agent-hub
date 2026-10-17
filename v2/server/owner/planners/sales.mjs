// M12 Sales planner — the owner's words („pregătește o ofertă pentru un service auto din Cluj care vrea programări online”) → ONE
// operation-plan card, no model. The brief is parsed deterministically (sales/brief.mjs: what you said verbatim, what it deduces marked
// as such, what is missing listed, sending / contacting / publishing refused before anything); the card lists the four preparation
// steps (synthetic client, fixture research, q-v2 qualification, the offer up to your review), and — hashed in the same card — the
// two steps that follow by themselves only after YOUR approval of the exact offer (the contact draft and „Dosarul ofertei”).
// Confirming the card never approves the offer: that decision stays yours, separately (decisionsLeft). Nothing runs before the
// confirmation; nothing is ever sent, published, spent or handed to Engineering from this plan.
import { newId } from "../../core/ids.mjs";
import { parseBrief, briefSha } from "../../sales/brief.mjs";
import { NEVER_IN_PLANS } from "../../ops/plans.mjs";
import { PREPARE_KIND, prepareSteps, phaseALimits, SALES_DECISIONS_LEFT, SALES_NEVER, ACTIVATE_WITHIN_MIN } from "../../sales/preparation.mjs";

export const SALES_PLAN_KIND = PREPARE_KIND;
const said = (brief, k) => (brief?.fields?.[k]?.provenance === "USER_PROVIDED" ? String(brief.fields[k].value || "").trim() : "");
const opsCard = (plan) => plan && ({ id: plan.id, kind: plan.kind, title: plan.title, status: plan.status, summary: plan.summary, hash: plan.hash, nonce: plan.nonce, confirmBy: plan.confirmBy, decisions: plan.body?.decisions || [] });

export function registerSalesPlanner(hub, intake) {
  /** One card for a Sales request (or one question, or the honest blocker), never an effect. */
  async function prepare({ step, text, ctx }) {
    const request = String(step?.args?.request || text || "").trim();
    if (!request) return { kind: "question", question: "Ce ofertă pregătesc? Spune-mi tipul firmei și ce vrea (de exemplu: „pregătește o ofertă pentru un service auto din Cluj care vrea programări online”).", forIntent: "sales" };
    let brief;
    try { brief = parseBrief(request); } catch (error) { return { kind: "message", text: error.message } }
    const refusedNote = brief.refused.length ? ` Nu trimit, nu contactez și nu public nimic (OUTREACH_DISABLED): „${brief.refused.map((r) => r.text).join("”, „")}” nu devine un pas.` : "";
    if (!brief.intent) return { kind: "question", question: `Vrei să pregătesc o ofertă? Spune „pregătește o ofertă pentru …”.${refusedNote}`, forIntent: "sales" };
    // The dossier goes to the approved exports folder: without one the card would carry a folder decision a derived step cannot take.
    if (!hub.media?.exportsDir?.()) {
      const why = "Nu pot pregăti oferta cu dosarul ei: nu există încă un folder de exporturi aprobat (îl alegi o dată în Studio, la importul unui folder). Cererea ta rămâne păstrată.";
      return { kind: "blocked", text: why, blocker: { signature: "SALES_DOSSIER_NO_EXPORTS_DIR", cause: "SALES_DOSSIER_NO_EXPORTS_DIR", text: why }, request: { planRef: null } };
    }
    const id = newId("spp");
    const sha = briefSha(brief);
    const what = [said(brief, "clientType"), said(brief, "problem")].filter(Boolean).join(" — ") || "cerere de ofertă";
    const plan = await hub.opsPlans.propose({ kind: PREPARE_KIND, title: `Pregătește o ofertă (date sintetice): ${what}`.slice(0, 200), steps: prepareSteps({ preparationId: id, briefSha: sha }),
      limits: phaseALimits(), actor: ctx?.actor || "intake", via: "intake" });
    hub.salesPreparations.createPlanned({ id, brief, briefSha: sha, plan, actor: ctx?.actor || "intake" });
    const then = plan.body.steps.find((s) => s.kind === "sales.proposal.draft")?.params?.then || null;
    const note = `Un singur plan, fără model: creez o firmă sintetică (.test, CUI fictiv), cercetez doar din fixture-uri, calific cu q-v2 și pregătesc oferta până la „gata de revizuire”, cu prețurile „De stabilit (neconfigurat)”. `
      + `Aprobarea ofertei exacte rămâne decizia ta, separat; după ea, în cel mult ${Math.round(ACTIVATE_WITHIN_MIN / 60 * 10) / 10} ore de la confirmare, ciorna netrimisă și dosarul ofertei se fac fără altă întrebare.${refusedNote}`;
    const card = { opsPlan: { ...opsCard(plan), preparationId: id, synthetic: true, model: "fără model",
      brief: { request: brief.request, fields: Object.fromEntries(Object.entries(brief.fields).filter(([, f]) => f).map(([k, f]) => [k, { value: f.value, provenance: f.provenance }])),
        assumptions: brief.assumptions, missing: brief.missing, refused: brief.refused },
      then, decisionsLeft: SALES_DECISIONS_LEFT, never: [...NEVER_IN_PLANS, ...SALES_NEVER] }, note };
    return { kind: "ops", plan, card, note, preparationId: id };
  }
  intake.registerPlanner("sales", (args) => prepare(args));
  return { prepare };
}
