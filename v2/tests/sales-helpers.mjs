import assert from "node:assert/strict";
import { acceptanceHub, settle } from "./accept-helpers.mjs";
import { generateSyntheticOrgs } from "../server/sales/synthetic.mjs";
import { toCsv } from "../server/sales/tabular.mjs";
import { hashCanonical } from "../server/core/canonical.mjs";

export async function salesAcceptanceHub(c, options = {}) {
  const t = await acceptanceHub({ ...options, seedProject: false });
  c.after(() => t.cleanup());
  return t;
}
export const salesCommand = (t, type, payload, context = {}) => t.hub.commands.dispatch({ type, payload, channel: "test", actor: "test", ...context });
export async function seedSalesReview(t) {
  const run = async (type, payload) => (await salesCommand(t, type, payload)).result;
  const svc = await run("sales.service.save", { name: "Site (SINTETIC)", scope: ["Pagini de prezentare"], tags: ["website"] });
  const [org] = generateSyntheticOrgs(1, { seed: 1215 });
  const csv = toCsv(["Denumire firmă", "CUI", "Site web", "E-mail", "Localitate"], [[org.name, org.fiscalCode, org.website, "office@sales-synthetic.test", org.city]], { delimiter: ";" });
  const batch = await run("sales.import.create", { fileName: "sales-sintetic.csv", contentBase64: Buffer.from(csv).toString("base64"), synthetic: true });
  await run("sales.import.mapping", { batchId: batch.id, mapping: batch.suggestedMapping });
  await run("sales.import.preview", { batchId: batch.id });
  await run("sales.import.confirm", { batchId: batch.id });
  const orgId = t.hub.db.prepare("SELECT id FROM sales_orgs WHERE synthetic=1").get().id;
  const q = await run("sales.org.qualify", { orgId });
  const opp = await run("sales.opportunity.create", { orgId, serviceId: svc.id, title: "Ofertă sintetică", need: "Prezentare" });
  const oppId = opp.opportunity.id;
  const p = await run("sales.proposal.create", { opportunityId: oppId });
  await run("sales.opportunity.transition", { opportunityId: oppId, to: "READY_FOR_OWNER_REVIEW", reason: "Revizuire sintetică" });
  await settle(); t.assertPaths();
  return { orgId, oppId, proposalId: p.id, sha: p.contentSha, version: p.version, qualificationId: q.id,
    route: `/api/sales/proposals/${p.id}/approve`, body: { displayedSha: p.contentSha },
    overrideRoute: `/api/sales/orgs/${orgId}/qualification/override`, overrideBody: { priority: 80, reason: "Recomandare sintetică", displayedQualificationId: q.id } };
}
export function salesFingerprint(t) {
  const tables = ["sales_proposals", "sales_opportunities", "sales_transitions", "sales_drafts", "sales_sends", "sales_contact_events", "sales_client_acceptances", "sales_handoffs", "sales_qualifications"];
  return hashCanonical({ tables: tables.map(table => t.hub.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()),
    events: t.hub.db.prepare("SELECT * FROM events WHERE type LIKE 'sales.%' ORDER BY seq").all() });
}
export async function salesUnchanged(t, action, status) {
  const before = salesFingerprint(t);
  const result = await action();
  assert.equal(result.status, status, JSON.stringify(result.json));
  assert.equal(salesFingerprint(t), before, "Sales unchanged on refusal/replay");
  return result;
}
export const salesDecisions = t => t.hub.db.prepare("SELECT payload_json FROM events WHERE type='sales.proposal.approved' ORDER BY seq").all().map(r => JSON.parse(r.payload_json));
export async function requestSalesApproval(t, target, options = {}) {
  const requested = await t.request(target.route, { body: target.body, ...options });
  assert.equal(requested.status, 202, JSON.stringify(requested.json));
  return requested.json;
}
export async function decideSalesApproval(t, requested) {
  const decided = await t.request(`/api/approvals/${requested.approval.id}/owner_decide`, { body: { decision: "approved", displayedHash: requested.approval.payloadHash } });
  assert.equal(decided.status, 200, JSON.stringify(decided.json));
  return decided.json;
}
export const executeSalesApproval = (t, r, options = {}) => t.request(`/api/commands/${r.commandId}/execute`, options);
export async function approveSalesHttp(t, target, options = {}) {
  const r = await requestSalesApproval(t, target, options);
  await decideSalesApproval(t, r);
  return executeSalesApproval(t, r);
}
