// 2.15.2: the four Sales decisions that still ran without the owner (a draft's text, lifting DO_NOT_CONTACT, an import rollback and the
// service catalog) are bound to the owner session like the internal offer approval (M12) and the Factory rejection (2.15.1): requested,
// decided and executed in the owner session (re-read inside the final transaction), the test channel only in test mode, every other
// path refused without writes. Real HTTP routes of a synthetic hub (accept-helpers: fresh roots, write fence, software authenticator).
import test from "node:test";
import assert from "node:assert/strict";
import { settle } from "./accept-helpers.mjs";
import { salesAcceptanceHub, salesCommand, seedSalesReview, approveSalesHttp, requestSalesApproval, decideSalesApproval, executeSalesApproval } from "./sales-helpers.mjs";
import { hashCanonical } from "../server/core/canonical.mjs";
import { generateSyntheticOrgs } from "../server/sales/synthetic.mjs";
import { toCsv } from "../server/sales/tabular.mjs";
import { machineIdentity } from "../server/owner/dev-profile.mjs";

const TABLES = ["sales_orgs", "sales_suppressions", "sales_import_batches", "sales_import_rows", "sales_contacts", "sales_drafts", "sales_services",
  "sales_proposals", "sales_opportunities", "sales_transitions", "approvals"];
const state = (t) => hashCanonical({ tables: TABLES.map((table) => t.hub.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()),
  events: t.hub.db.prepare("SELECT type, payload_json FROM events WHERE type LIKE 'sales.%' OR type LIKE 'approval.%' ORDER BY seq").all() });
async function unchanged(t, action, status) {
  await settle(); const before = state(t);
  const r = await action();
  assert.equal(r.status, status, JSON.stringify(r.json));
  await settle(); assert.equal(state(t), before, "a refusal writes nothing (Sales tables, approvals, Sales and approval events)");
  return r;
}
const run = async (t, type, payload) => (await salesCommand(t, type, payload)).result;
const events = (t, type) => t.hub.db.prepare("SELECT payload_json FROM events WHERE type = ? ORDER BY seq").all(type).map((r) => JSON.parse(r.payload_json));

/** A second synthetic batch (two firms nobody touched): one is put on DO_NOT_CONTACT, the batch itself can be rolled back. */
async function secondBatch(t) {
  const orgs = generateSyntheticOrgs(2, { seed: 2152 });
  const csv = toCsv(["Denumire firmă", "CUI", "Site web", "E-mail", "Localitate"], orgs.map((o, i) => [o.name, o.fiscalCode, o.website, `office${i}@lot-doi.test`, o.city]), { delimiter: ";" });
  const batch = await run(t, "sales.import.create", { fileName: "lot-doi-sintetic.csv", contentBase64: Buffer.from(csv).toString("base64"), synthetic: true });
  await run(t, "sales.import.mapping", { batchId: batch.id, mapping: batch.suggestedMapping });
  await run(t, "sales.import.preview", { batchId: batch.id });
  await run(t, "sales.import.confirm", { batchId: batch.id });
  const created = t.hub.db.prepare("SELECT id FROM sales_orgs WHERE created_batch_id = ? ORDER BY rowid").all(batch.id).map((r) => r.id);
  return { batchId: batch.id, orgIds: created };
}

/** The world: an approved offer with a draft waiting for its text approval, a DO_NOT_CONTACT firm, a batch to roll back; owner unlocked. */
async function world(c, options) {
  const t = await salesAcceptanceHub(c, options);
  const s = await seedSalesReview(t);
  const owner = await t.authenticate();
  assert.equal((await approveSalesHttp(t, s)).status, 200);
  const draft = await run(t, "sales.draft.create", { opportunityId: s.oppId });
  const second = await secondBatch(t);
  const suppressedOrg = second.orgIds[1];
  await run(t, "sales.org.suppress", { orgId: suppressedOrg, reason: "Opoziție sintetică" });
  const targets = {
    draft: { route: `/api/sales/drafts/${draft.id}/approve-content`, body: { displayedSha: draft.contentSha }, type: "sales.draft.approve_content", kind: "sales.draft_content",
      payload: { draftId: draft.id, displayedSha: draft.contentSha } },
    lift: { route: `/api/sales/orgs/${suppressedOrg}/suppression/lift`, body: { reason: "Clientul a revenit el" }, type: "sales.suppression.lift", kind: "sales.suppression_lift",
      payload: { orgId: suppressedOrg, reason: "Clientul a revenit el" } },
    rollback: { route: `/api/sales/imports/${second.batchId}/rollback`, body: { reason: "Lot greșit" }, type: "sales.import.rollback", kind: "sales.import_rollback",
      payload: { batchId: second.batchId, reason: "Lot greșit" } },
  };
  const service = { route: "/api/sales/services", body: { name: "Audit de accesibilitate (SINTETIC)", scope: ["Etichete"] }, type: "sales.service.save" };
  return { t, s, owner, draft, second, suppressedOrg, targets, service };
}
const DECISIONS = ["draft", "lift", "rollback"];

for (const session of ["absent", "fake", "expired", "revoked", "revoke-all"]) test(`SALES-OWNER 1: ${session} session → every Sales owner route is 401, nothing written`, async (c) => {
  let now = new Date();
  const w = await world(c, { clock: () => now });
  const { t } = w;
  if (session === "expired") now = new Date(now.getTime() + 25 * 3600000);
  if (session === "revoked") t.hub.db.prepare("UPDATE owner_sessions SET status = 'revoked' WHERE id = ?").run(w.owner.sessionId);
  if (session === "revoke-all") t.hub.trust.revokeAllSessions("test", "test");
  const cookie = session === "absent" ? { sessionCookie: "" } : session === "fake" ? { sessionCookie: "ifrim_owner=fake" } : {};
  for (const target of [...DECISIONS.map((k) => w.targets[k]), w.service, { ...w.service, route: `/api/sales/services/${t.hub.sales.listServices()[0].id}` }]) {
    const r = await unchanged(t, () => t.request(target.route, { body: target.body, ...cookie }), 401);
    assert.match(JSON.stringify(r.json), /needSession|sesiune|Sesiune/, target.route);
  }
});

test("SALES-OWNER 2: every other path is refused without writes (agent, cli, generic commands, internal channels, the service without authority)", async (c) => {
  const w = await world(c);
  const { t } = w;
  for (const target of [...DECISIONS.map((k) => w.targets[k]), w.service]) {
    for (const channel of ["agent", "cli"]) await unchanged(t, () => t.request(target.route, { body: target.body, headers: { "X-Hub-Channel": channel } }), 403);
    const payload = target.payload || target.body;
    for (const channel of ["ui", "test", "owner", "automation", "agent"]) {
      await unchanged(t, () => t.request("/api/commands", { body: { type: target.type, payload }, headers: { "X-Hub-Channel": channel, "X-Hub-Delegation": "test delegation reference" } }), 403);
    }
    for (const channel of ["ui", "voice", "companion", "automation", "schedule", "recovery", "cli", "agent"]) {
      await settle(); const before = state(t);
      await assert.rejects(t.hub.commands.dispatch({ type: target.type, payload, channel, actor: "x", delegation: "test delegation reference" }), /cannot be issued|not delegated/, `${target.type} ${channel}`);
      assert.equal(state(t), before, `${target.type} ${channel}`);
    }
  }
  // The services themselves refuse a caller that brings no owner authority (no session, no consumed approval of exactly this action).
  await settle(); const before = state(t);
  assert.throws(() => t.hub.sales.liftSuppression(w.suppressedOrg, { reason: "fără autoritate" }, "x"), /sesiunea proprietarului/);
  assert.throws(() => t.hub.sales.rollback(w.second.batchId, "x", { reason: "fără autoritate" }), /sesiunea proprietarului/);
  assert.throws(() => t.hub.sales.approveDraftContent(w.draft.id, { displayedSha: w.draft.contentSha }, "x"), /sesiunea proprietarului/);
  assert.throws(() => t.hub.sales.saveService({ name: "Fără autoritate" }, "x"), /sesiunea proprietarului/);
  assert.throws(() => t.hub.sales.liftSuppression(w.suppressedOrg, { reason: "canal test fără aprobare" }, "x", { channel: "test", sessionCheck: () => null }), /Lipsește aprobarea/);
  assert.equal(state(t), before);
  // An approval of these kinds is never decided by the generic UI decision: the route sends it to the owner decision (session needed).
  const requested = await requestSalesApproval(t, w.targets.lift);
  const generic = await t.request(`/api/approvals/${requested.approval.id}/decide`, { body: { decision: "approved", displayedHash: requested.approval.payloadHash }, sessionCookie: "" });
  assert.equal(generic.status, 401, JSON.stringify(generic.json));
  assert.throws(() => t.hub.approvals.decide(requested.approval.id, { decision: "approved", displayedHash: requested.approval.payloadHash, channel: "ui" }), /sesiunea proprietarului/);
  assert.equal(t.hub.approvals.get(requested.approval.id).status, "pending");
});

for (const key of DECISIONS) test(`SALES-OWNER 3 (${key}): requested, decided and executed in the owner session → one decision with its authority`, async (c) => {
  const w = await world(c);
  const { t } = w;
  const target = w.targets[key];
  const requested = await requestSalesApproval(t, target);
  assert.equal(requested.approval.actionKind, target.kind);
  await decideSalesApproval(t, requested);
  const r = await executeSalesApproval(t, requested);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  await settle();
  const approval = t.hub.approvals.get(requested.approval.id);
  assert.equal(approval.status, "consumed"); assert.equal(approval.decidedVia, "owner_session"); assert.equal(approval.authority, "webauthn");
  const eventType = { draft: "sales.draft.content_approved", lift: "sales.suppression_lifted", rollback: "sales.import.rolled_back" }[key];
  const [e] = events(t, eventType);
  assert.equal(events(t, eventType).length, 1);
  for (const [field, value] of Object.entries({ approvalId: approval.id, decidedVia: "owner_session", authority: "webauthn", sessionId: w.owner.sessionId, channel: "owner" })) assert.equal(e[field], value, field);
  if (key === "draft") assert.equal(t.hub.db.prepare("SELECT status FROM sales_drafts WHERE id = ?").get(w.draft.id).status, "CONTENT_APPROVED");
  if (key === "lift") assert.equal(t.hub.db.prepare("SELECT status FROM sales_orgs WHERE id = ?").get(w.suppressedOrg).status, "ON_HOLD");
  if (key === "rollback") assert.equal(t.hub.db.prepare("SELECT status FROM sales_import_batches WHERE id = ?").get(w.second.batchId).status, "ROLLED_BACK");
  const cmd = t.hub.db.prepare("SELECT actor, channel, status FROM commands WHERE type = ?").all(target.type).map((row) => ({ ...row }));
  assert.deepEqual(cmd, [{ actor: `owner:${w.owner.sessionId}`, channel: "owner", status: "executed" }]);
  // A repeat returns the recorded decision; nothing is written twice.
  await settle(); const before = state(t);
  const again = await executeSalesApproval(t, requested);
  assert.equal(again.status, 200, JSON.stringify(again.json)); assert.equal(again.json.duplicate, true);
  assert.equal(state(t), before);
});

test("SALES-OWNER 4: the executing session is re-read — revoked after the decision → 401 and nothing written; a reauth runs it once", async (c) => {
  let now = new Date();
  const w = await world(c, { clock: () => now });
  const { t } = w;
  const requested = await requestSalesApproval(t, w.targets.lift);
  await decideSalesApproval(t, requested);
  now = new Date(now.getTime() + 6 * 60000); // the session is no longer fresh
  await unchanged(t, () => executeSalesApproval(t, requested), 401);
  assert.equal(t.hub.approvals.get(requested.approval.id).status, "approved", "a session refusal keeps the decision waiting");
  await t.authenticate({ reauth: true });
  assert.equal((await executeSalesApproval(t, requested)).status, 200);
  assert.equal(events(t, "sales.suppression_lifted").length, 1);
  // Revoke-all after a decision: the old session can no longer run it (401), and nothing is written.
  const second = await requestSalesApproval(t, w.targets.rollback);
  await decideSalesApproval(t, second);
  t.hub.trust.revokeAllSessions("test", "test");
  await unchanged(t, () => executeSalesApproval(t, second), 401);
  assert.equal(t.hub.db.prepare("SELECT status FROM sales_import_batches WHERE id = ?").get(w.second.batchId).status, "IMPORTED");
});

test("SALES-OWNER 5: the draft text is approved only for the exact SHA shown (an empty, whitespace or other SHA never approves)", async (c) => {
  const w = await world(c);
  const { t } = w;
  for (const displayedSha of ["", " ", "   ".repeat(21) + " ", w.draft.contentSha.slice(0, 12), w.draft.contentSha.toUpperCase()]) {
    await unchanged(t, () => t.request(w.targets.draft.route, { body: { displayedSha } }), 400);
  }
  // A well-formed SHA of another text: the request may wait for a decision, but the decision never approves the draft.
  const other = "f".repeat(64);
  const requested = await requestSalesApproval(t, { route: w.targets.draft.route, body: { displayedSha: other } });
  await decideSalesApproval(t, requested);
  const r = await executeSalesApproval(t, requested);
  assert.equal(r.status, 409, JSON.stringify(r.json));
  assert.equal(t.hub.db.prepare("SELECT status FROM sales_drafts WHERE id = ?").get(w.draft.id).status, "DRAFT");
  assert.equal(t.hub.approvals.get(requested.approval.id).status, "invalidated", "a refused final check ends the decision");
  assert.equal(events(t, "sales.draft.content_approved").length, 0);
});

test("SALES-OWNER 6: the service catalog is written only in a fresh owner session, with its authority recorded", async (c) => {
  let now = new Date();
  const w = await world(c, { clock: () => now });
  const { t } = w;
  const created = await t.request(w.service.route, { body: w.service.body });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const id = created.json.id;
  const saved = events(t, "sales.service.saved").at(-1);
  for (const [field, value] of Object.entries({ authority: "webauthn", sessionId: w.owner.sessionId, channel: "owner" })) assert.equal(saved[field], value, field);
  now = new Date(now.getTime() + 6 * 60000);
  const r = await unchanged(t, () => t.request(`/api/sales/services/${id}`, { body: { ...w.service.body, description: "Modificare fără sesiune proaspătă" } }), 401);
  assert.match(JSON.stringify(r.json), /reauth|needSession|Windows Hello|sesiun/);
  await t.authenticate({ reauth: true });
  const edited = await t.request(`/api/sales/services/${id}`, { body: { ...w.service.body, description: "Modificare în sesiunea proaspătă" } });
  assert.equal(edited.status, 200, JSON.stringify(edited.json));
  assert.equal(t.hub.sales.listServices({ activeOnly: false }).find((s) => s.id === id).description, "Modificare în sesiunea proaspătă");
});

test("SALES-OWNER 7: the local development profile decides as itself (recorded local_dev_profile), never as Windows Hello", async (c) => {
  const profile = { enabled: true, version: 1, id: "dev_sales01", ...machineIdentity() };
  const t = await salesAcceptanceHub(c, { devProfile: () => profile });
  await seedSalesReview(t);
  const owner = await t.authenticate({ dev: true });
  const created = await t.request("/api/sales/services", { body: { name: "Serviciu profil local (SINTETIC)", scope: ["x"] } });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const saved = events(t, "sales.service.saved").at(-1);
  assert.equal(saved.authority, "local_dev_profile"); assert.equal(saved.sessionId, owner.sessionId);
});
