import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
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

// ---------------------------------------------------------------- M12 preparation (part 3): one card → WAITING_OWNER → approval → dossier
export const SALES_REQUEST = "pregătește o ofertă pentru un service auto din Cluj care vrea programări online";
/** A synthetic acceptance hub whose approved exports folder is `<root>/exports` (inside the test root, outside root/data and root/hub). */
export async function prepHub(c, options = {}) {
  const t = await salesAcceptanceHub(c, options);
  t.exportsDir = path.join(t.root, "exports");
  t.hub.bus.transaction(() => t.hub.settings.set("mediaPolicy", { ...(t.hub.settings.get("mediaPolicy") || {}), exportsDir: t.exportsDir }, "test", "Folderul de exporturi al testului"));
  return t;
}
/** The owner's sentence → the Sales planner (through the intake) → ONE card; nothing runs. */
export async function proposePreparation(t, text = SALES_REQUEST) {
  const r = await t.hub.intake.plan({ kind: "sales", text, source: "typed" }, { channel: "test", actor: "test", ownerSession: null });
  assert.ok(r.opsPlan?.id && r.opsPlan.preparationId, JSON.stringify(r).slice(0, 600));
  return { card: r.opsPlan, preparationId: r.opsPlan.preparationId, result: r };
}
/** The owner's one confirmation (HTTP, owner session cookie); waits for the plan's run. */
export async function confirmCard(t, card, { status = 200 } = {}) {
  const res = await t.request(`/api/ops/plans/${card.id}/confirm`, { body: { nonce: card.nonce, displayedHash: card.hash } });
  assert.equal(res.status, status, JSON.stringify(res.json));
  await t.hub.opsPlans.idle(card.id);
  return res;
}
/** The owner's approval of exactly the awaited offer (id + full sha) over HTTP: request → owner_decide → execute. */
export const approveAwaited = (t, prep, options = {}) => approveSalesHttp(t, { route: `/api/sales/proposals/${prep.awaited.proposalId}/approve`, body: { displayedSha: prep.awaited.proposalSha } }, options);
export const prepStatus = (t, id) => t.hub.salesPreparations.get(id).status;
export const countRows = (t, sql, ...args) => t.hub.db.prepare(sql).get(...args).n;
export const eventCount = (t, type) => countRows(t, "SELECT COUNT(*) AS n FROM events WHERE type = ?", type);
/** Waits for the deferred listeners (activation) and the derived plan they started. */
export async function settlePreparation(t, id) {
  for (let i = 0; i < 5; i += 1) { await settle(); await t.hub.salesPreparations.idle(id); }
  return t.hub.salesPreparations.get(id);
}
/** A walk of a folder: relative path → sha256 (to prove that nothing was overwritten or added). */
export function folderShas(dir) {
  const out = {};
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else out[path.relative(dir, p).split(path.sep).join("/")] = crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex"); } };
  if (fs.existsSync(dir)) walk(dir);
  return out;
}
