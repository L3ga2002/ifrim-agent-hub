// 2.15.5 — the catalog reaches the M12 offer. The first M12 preparation ran with an empty catalog (its opportunity names no service), so the
// offer said „De stabilit” everywhere. When the owner then saves a catalog service, the inputs of that preparation-bound offer changed:
// the offer, its preparation and its dossier become STALE (history kept, the old approval never reused), the owner continues with ONE
// card, the new version is rendered from the catalog's only active service, the owner approves exactly that version and the dossier
// gets a new revision. Price and term stay UNKNOWN; nothing is sent. Every Hub is a fully synthetic acceptance hub.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { prepHub, proposePreparation, confirmCard, approveAwaited, prepStatus, countRows, eventCount, settlePreparation, salesCommand, folderShas } from "./sales-helpers.mjs";
import { proposalFigures } from "../server/sales/figures.mjs";
import { serviceToForm, serviceFormToPayload, serviceView } from "../web/src/lib/salesLogic.js";

/** The service card prepared for the owner (the same fields he saves in Vânzări → Servicii). */
const CARD = {
  name: "Programări online pe site",
  description: "Un modul de programări pe site-ul service-ului auto. Clienții își fac singuri programarea de pe telefon sau de pe calculator, și în afara programului: aleg serviciul, ziua și un interval liber, fără să sune. Pentru service, programările ajung înregistrate împreună cu datele clientului, iar un interval deja ocupat nu mai poate fi ales, așa că programările nu se notează de mână și nu se suprapun. Serviciile, duratele și programul de lucru le stabilim împreună cu dumneavoastră.",
  scope: ["Pagină de programare pe site: clientul alege serviciul, ziua și un interval liber, de pe telefon sau de pe calculator",
    "Afișarea intervalelor libere și ocupate: un interval deja ocupat apare indisponibil și nu poate fi ales",
    "Lista programărilor, păstrată și după repornirea aplicației: serviciul, ziua, intervalul, numele și mașina clientului"],
  exclusions: ["Mesaje automate de confirmare sau de reamintire prin SMS ori e-mail", "Găzduirea site-ului și întreținerea după predare"],
  materials: ["Programul de lucru pe zile, cu pauzele și zilele libere", "Câte mașini puteți lucra în același timp"],
  tags: ["programari", "service-auto"], price: { status: "NOT_CONFIGURED" }, leadTime: { status: "NOT_CONFIGURED" }, active: true,
};
const section = (content, id) => content.sections.find((s) => s.id === id)?.text || "";

/** The first pilot's state: one preparation READY on an empty catalog (offer v1 approved by the owner, dossier revision 1). */
async function readyOnEmptyCatalog(c) {
  const t = await prepHub(c);
  await t.authenticate();
  const { card, preparationId } = await proposePreparation(t);
  await confirmCard(t, card);
  const prep = t.hub.salesPreparations.get(preparationId);
  assert.equal((await approveAwaited(t, prep)).status, 200);
  const done = await settlePreparation(t, preparationId);
  assert.equal(done.status, "READY", done.statusReason);
  const v1 = t.hub.sales.getOpportunity(done.opportunityId).proposals[0];
  assert.equal(v1.content.serviceNames.length, 0, "the first offer had no service (empty catalog)");
  assert.match(section(v1.content, "scope"), /De stabilit/);
  return { t, preparationId, prep: done, v1 };
}

test("R-CAT-01 a catalog service saved after a READY preparation → offer, preparation and dossier STALE (history kept); ONE continuation card → v2 from the service; the owner approves v2 → dossier revision 2; nothing sent", async (c) => {
  const { t, preparationId, prep, v1 } = await readyOnEmptyCatalog(c);
  const oppId = prep.opportunityId;
  const rev1 = t.hub.salesPreparations.forOpportunity(oppId).dossiers[0];
  const rev1Files = folderShas(rev1.folder);
  assert.ok(Object.keys(rev1Files).length > 0);

  const svc = (await salesCommand(t, "sales.service.save", CARD)).result;
  // The inputs of the bound offer changed: everything built on v1 is STALE, nothing is deleted, the approval stays recorded on v1.
  const afterSave = t.hub.sales.getOpportunity(oppId);
  assert.equal(afterSave.proposals[0].id, v1.id);
  assert.equal(afterSave.proposals[0].status, "STALE");
  assert.equal(afterSave.proposals[0].approvedSha, v1.contentSha, "the owner's approval of v1 stays in the history");
  assert.equal(prepStatus(t, preparationId), "STALE");
  const view = t.hub.salesPreparations.forOpportunity(oppId);
  assert.equal(view.preparations[0].continuable, true, "the official continuation applies");
  assert.equal(view.dossiers[0].status, "STALE");
  assert.deepEqual(folderShas(rev1.folder), rev1Files, "revision 1 stays on disk, unchanged");
  // The old approval is never reused for the new offer.
  const again = await approveAwaited(t, { awaited: { proposalId: v1.id, proposalSha: v1.contentSha } });
  assert.equal(again.status, 409, JSON.stringify(again.json));

  const rows = ["sales_orgs", "sales_opportunities"].map((x) => countRows(t, `SELECT COUNT(*) AS n FROM ${x}`));
  const out = (await salesCommand(t, "sales.preparation.continue", { preparationId }, { channel: "test" })).result;
  assert.equal(out.plan.status, "PROPOSED");
  assert.equal(prepStatus(t, preparationId), "STALE", "nothing runs before the confirmation");
  await confirmCard(t, { ...out.plan, preparationId });
  const waiting = await settlePreparation(t, preparationId);
  assert.equal(waiting.status, "WAITING_OWNER", waiting.statusReason);
  assert.deepEqual(["sales_orgs", "sales_opportunities"].map((x) => countRows(t, `SELECT COUNT(*) AS n FROM ${x}`)), rows, "the same company and opportunity");

  const v2 = t.hub.sales.getOpportunity(oppId).proposals.find((p) => p.version === 2);
  assert.ok(v2, "a new version");
  assert.equal(waiting.awaited.proposalId, v2.id);
  assert.equal(v2.status, "DRAFT");
  assert.equal(v2.approvedSha, null, "not approved before the owner's decision");
  assert.deepEqual(v2.content.serviceIds, [`${svc.id}@${svc.version}`], "the configured service is the one the offer is rendered from");
  assert.deepEqual(v2.content.serviceNames, [CARD.name]);
  assert.equal(v2.content.basis.service, `${svc.id}@${svc.version}`);
  assert.match(v2.content.title, /Programări online pe site/);
  assert.match(section(v2.content, "solution"), /Clienții își fac singuri programarea/);
  for (const line of CARD.scope) assert.ok(section(v2.content, "scope").includes(line), line);
  for (const line of CARD.exclusions) assert.ok(section(v2.content, "exclusions").includes(line), line);
  for (const line of CARD.materials) assert.ok(section(v2.content, "materials").includes(line), line);
  assert.match(section(v2.content, "price_terms"), /preț De stabilit \(neconfigurat\); termen De stabilit \(neconfigurat\)/);
  assert.deepEqual(v2.content.pricing.map((p) => [p.item, p.status, p.reason]), [["price", "UNKNOWN", "catalog neconfigurat"], ["leadTime", "UNKNOWN", "catalog neconfigurat"]]);
  assert.deepEqual(proposalFigures(v2.content), [], "no amount, term, ROI or discount");
  // v1 stays in the history next to v2.
  const v1Now = t.hub.sales.getOpportunity(oppId).proposals.find((p) => p.version === 1);
  assert.deepEqual([v1Now.id, v1Now.contentSha], [v1.id, v1.contentSha]);

  assert.equal((await approveAwaited(t, waiting)).status, 200);
  const done = await settlePreparation(t, preparationId);
  assert.equal(done.status, "READY", done.statusReason);
  const final = t.hub.sales.getOpportunity(oppId);
  assert.equal(final.proposals.find((p) => p.version === 2).approvedSha, v2.contentSha);
  assert.equal(final.drafts[0].status, "DRAFT");
  assert.equal(final.drafts[0].meta.proposalSha, v2.contentSha);
  assert.match(final.drafts[0].body || final.drafts[0].content?.body || JSON.stringify(final.drafts[0]), /Programări online pe site/);
  const dossiers = t.hub.salesPreparations.forOpportunity(oppId).dossiers;
  assert.deepEqual(dossiers.map((d) => [d.revision, d.status]), [[2, "READY"], [1, "STALE"]]);
  assert.equal(dossiers[0].inputsCurrent, true);
  assert.notEqual(dossiers[0].folder, rev1.folder);
  assert.deepEqual(folderShas(rev1.folder), rev1Files, "revision 1 still unchanged");
  const offerMd = fs.readdirSync(dossiers[0].folder).find((f) => /^oferta-v2.*\.md$/.test(f));
  assert.ok(offerMd, fs.readdirSync(dossiers[0].folder).join(", "));
  const md = fs.readFileSync(path.join(dossiers[0].folder, offerMd), "utf8");
  assert.match(md, /Programări online pe site/);
  assert.match(md, /De stabilit \(neconfigurat\)/);
  for (const table of ["sales_sends", "sales_contact_events", "sales_client_acceptances", "sales_handoffs", "missions"]) assert.equal(countRows(t, `SELECT COUNT(*) AS n FROM ${table}`), 0, table);
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM agent_runs"), 0, "no model");
  assert.equal(eventCount(t, "sales.synthetic.created"), 1, "no second company");
  t.assertPaths();
});

test("R-CAT-02 only an unambiguous catalog feeds a bound offer: two active services → no service is picked; an M04 offer never takes the catalog's only service", async (c) => {
  const t = await prepHub(c);
  await t.authenticate();
  const a = (await salesCommand(t, "sales.service.save", CARD)).result;
  const b = (await salesCommand(t, "sales.service.save", { ...CARD, name: "Alt serviciu (SINTETIC)" })).result;
  const { card, preparationId } = await proposePreparation(t);
  await confirmCard(t, card);
  const prep = t.hub.salesPreparations.get(preparationId);
  assert.equal(prep.status, "WAITING_OWNER", prep.statusReason);
  const v1 = t.hub.sales.getOpportunity(prep.opportunityId).proposals[0];
  assert.deepEqual(v1.content.serviceIds, [], "two services: none is guessed");
  assert.equal(v1.content.basis.service, null);
  // Deactivating one leaves exactly one active service: an input change of the bound offer (STALE), the M04 offer stays as it was.
  const opp = (await salesCommand(t, "sales.opportunity.create", { orgId: prep.orgId, title: "Ofertă M04 fără serviciu" })).result;
  const m04 = (await salesCommand(t, "sales.proposal.create", { opportunityId: opp.opportunity.id })).result;
  await salesCommand(t, "sales.service.save", { ...CARD, name: "Alt serviciu (SINTETIC)", active: false, serviceId: b.id });
  assert.equal(prepStatus(t, preparationId), "STALE");
  assert.equal(t.hub.sales.getOpportunity(prep.opportunityId).proposals[0].status, "STALE");
  const m04Now = t.hub.sales.getOpportunity(opp.opportunity.id).proposals[0];
  assert.deepEqual([m04Now.status, m04Now.contentSha, m04Now.content.serviceIds.length], ["DRAFT", m04.contentSha, 0], "M04 offers never take the catalog by themselves");
  const out = (await salesCommand(t, "sales.preparation.continue", { preparationId }, { channel: "test" })).result;
  await confirmCard(t, { ...out.plan, preparationId });
  const v2 = t.hub.sales.getOpportunity(prep.opportunityId).proposals.find((p) => p.version === 2);
  assert.deepEqual(v2.content.serviceIds, [`${a.id}@${a.version}`]);
});

test("R-CAT-03 the service editor keeps „Ce trebuie să primim de la client” (materials): shown, edited and saved, never dropped by an edit", () => {
  const stored = { id: "svc_1", name: CARD.name, materials_json: JSON.stringify(CARD.materials), scope_json: "[]", exclusions_json: "[]" };
  assert.deepEqual(serviceView(stored).materials, CARD.materials);
  const form = serviceToForm(stored);
  assert.equal(form.materials, CARD.materials.join("\n"));
  const ok = serviceFormToPayload(form);
  assert.equal(ok.ok, true, ok.errors.join("; "));
  assert.deepEqual(ok.payload.materials, CARD.materials, "an edit of another field keeps the materials");
  const tooMany = serviceFormToPayload({ ...form, materials: Array.from({ length: 21 }, (_, i) => `m${i}`).join("\n") });
  assert.equal(tooMany.ok, false, "at most 20 lines (command schema)");
  assert.equal(serviceFormToPayload({ ...form, materials: "x".repeat(201) }).ok, false, "at most 200 characters per line");
});
