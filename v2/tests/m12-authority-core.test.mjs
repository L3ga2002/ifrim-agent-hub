import test from "node:test";
import assert from "node:assert/strict";
import { enrolOwner } from "./helpers.mjs";
import { salesAcceptanceHub, seedSalesReview, salesCommand, salesFingerprint, salesDecisions } from "./sales-helpers.mjs";
import { OWNER_DECIDED } from "../server/policy/approvals.mjs";
import { createApprovals } from "../server/policy/approvals.mjs";
import { registerSalesCommands } from "../server/sales/sales-commands.mjs";
import { createCommandBus } from "../server/runtime/commands.mjs";

async function fixture(c, options) {
  const t = await salesAcceptanceHub(c, { listen: false, ...options });
  return { t, b: await seedSalesReview(t) };
}
const context = session => ({ channel: "owner", ownerSession: session, actor: `owner:${session.id}` });
async function pending(t, b, ctx = {}) {
  return salesCommand(t, "sales.proposal.approve", { proposalId: b.proposalId, displayedSha: b.sha }, ctx);
}
async function decide(t, r, ctx = {}) {
  return salesCommand(t, ctx.channel === "owner" ? "approval.owner_decide" : "approval.decide", { approvalId: r.approval.id, decision: "approved", displayedHash: r.approval.payloadHash }, ctx);
}

test("M12-CORE-01 service refuses malformed identity and caller authority without Sales writes", async c => {
  const { t, b } = await fixture(c);
  const before = salesFingerprint(t);
  for (const sha of [undefined, "", " ", b.sha.slice(0, 12), b.sha.toUpperCase(), "z".repeat(64), "0".repeat(64)]) {
    assert.throws(() => t.hub.sales.approveProposal(b.proposalId, { displayedSha: sha }, "test", { channel: "test", sessionCheck: () => null }), /SHA|Conținutul/);
    assert.equal(salesFingerprint(t), before);
  }
  for (const ctx of [{}, { sessionId: "osn_claim" }, { channel: "owner" }, { channel: "ui", sessionCheck: () => ({ id: "claim" }) }, { channel: "test" }]) {
    assert.throws(() => t.hub.sales.approveProposal(b.proposalId, { displayedSha: b.sha }, "test", ctx), /sesiunea/);
    assert.equal(salesFingerprint(t), before);
  }
  await salesCommand(t, "sales.proposal.create", { opportunityId: b.oppId });
  assert.throws(() => t.hub.sales.approveProposal(b.proposalId, { displayedSha: b.sha }, "test"), /versiune mai nouă/);
});

test("M12-CORE-02 reserved kinds fail closed on ui, envelope and bare service; synthetic path stays bounded", async c => {
  const { t, b } = await fixture(c);
  assert.deepEqual([...OWNER_DECIDED.keys()], ["sales.proposal_approve"]);
  const r = await pending(t, b);
  const args = { decision: "approved", displayedHash: r.approval.payloadHash, channel: "ui" };
  assert.throws(() => t.hub.approvals.decide(r.approval.id, args), /sesiunea/);
  assert.throws(() => t.hub.approvals.decideByOwner(r.approval.id, { ...args, channel: "owner", sessionId: "claim" }), /sesiunea/);
  assert.throws(() => t.hub.approvals.decideByEnvelope(r.approval.id, { envelopeId: "claim", sessionId: "claim", expectedHash: r.approval.payloadHash }), /cannot be decided/);
  await assert.rejects(salesCommand(t, "approval.decide", { approvalId: r.approval.id, ...args }, { channel: "ui" }), /sesiunea/);
  for (const channel of ["ui", "voice", "companion", "automation", "schedule", "cli", "agent"]) await assert.rejects(pending(t, b, { channel }), /cannot be issued/);
  const handlers = new Map();
  registerSalesCommands((name, h) => handlers.set(name, h), { ...t.hub, config: { ...t.config, testMode: false } }, {});
  assert.throws(() => handlers.get("sales.proposal.approve").action({ proposalId: b.proposalId, displayedSha: b.sha }, { channel: "test" }), /canalul/);
  assert.throws(() => handlers.get("sales.qualification.override").execute({ orgId: b.orgId, ...b.overrideBody }, { channel: "test" }), /canalul/);
  const productionApprovals = createApprovals(t.hub.db, t.hub.bus, () => new Date(), { testMode: false });
  assert.throws(() => productionApprovals.decideByOwner(r.approval.id, { ...args, channel: "test" }), /sesiunea/);
  const productionBus = createCommandBus({ db: t.hub.db, bus: t.hub.bus, clock: () => new Date(), approvals: productionApprovals, config: { testMode: false } });
  productionBus.register("sales.proposal.approve", handlers.get("sales.proposal.approve"));
  await assert.rejects(productionBus.executeApproved(r.command.id), /modului de test/);
  assert.equal(t.hub.approvals.get(r.approval.id).status, "pending");
});

test("M12-CORE-03 execution rechecks session, credential and logged channel before consuming", async c => {
  const { t, b } = await fixture(c);
  const { session } = await enrolOwner(t, { activatePolicy: false });
  const r = await pending(t, b, context(session)); await decide(t, r, context(session));
  const before = salesFingerprint(t);
  await assert.rejects(t.hub.commands.executeApproved(r.command.id), /proprietar/);
  // A second credential needs the current fresh owner session.
  const { createTestAuthenticator } = await import("../server/owner/webauthn.mjs");
  const origin = t.config.canonicalOrigin, auth = createTestAuthenticator({ origin });
  const reg = t.hub.trust.beginRegistration({ origin, session });
  t.hub.trust.finishRegistration({ origin, challengeId: reg.challengeId, credential: auth.create({ challenge: reg.publicKey.challenge }) });
  const begin = t.hub.trust.beginAuthentication({ origin });
  const opened = t.hub.trust.finishAuthentication({ origin, challengeId: begin.challengeId, credential: auth.get({ challenge: begin.publicKey.challenge }) });
  const second = t.hub.trust.resolveSession(opened.token, { origin });
  await assert.rejects(t.hub.commands.executeApproved(r.command.id, "owner", { ownerSession: second }), /credențiale/);
  t.hub.db.prepare("UPDATE commands SET channel='ui' WHERE id=?").run(r.command.id);
  await assert.rejects(t.hub.commands.executeApproved(r.command.id, "owner", { ownerSession: session }), /Canalul/);
  t.hub.db.prepare("UPDATE commands SET channel='owner' WHERE id=?").run(r.command.id);
  t.hub.trust.revokeAllSessions("owner-revoke-all");
  await assert.rejects(t.hub.commands.executeApproved(r.command.id, "owner", { ownerSession: session }), /proprietar/);
  assert.equal(t.hub.approvals.get(r.approval.id).status, "approved");
  assert.equal(salesFingerprint(t), before);
});

test("M12-CORE-04 synchronous CAS, concurrent commands and service duplicates keep one original decision", async c => {
  const { t, b } = await fixture(c);
  const { session } = await enrolOwner(t, { activatePolicy: false });
  const ctx = context(session);
  const r1 = await pending(t, b, ctx), r2 = await pending(t, b, ctx);
  await decide(t, r1, ctx); await decide(t, r2, ctx);
  await assert.rejects(decide(t, r1, ctx), /approved/);
  const [a, d] = await Promise.all([r1, r2].map(r => t.hub.commands.executeApproved(r.command.id, ctx.actor, { ownerSession: session })));
  assert.equal(a.result.duplicate, false); assert.equal(d.result.duplicate, true);
  assert.equal(d.result.approvalId, a.result.approvalId); assert.equal(d.result.approvedAt, a.result.approvedAt);
  const before = salesFingerprint(t), commands = t.hub.db.prepare("SELECT count(*) n FROM commands").get().n;
  const replay = await t.hub.commands.executeApproved(r1.command.id, ctx.actor, { ownerSession: session });
  assert.equal(replay.duplicate, true); assert.deepEqual(replay.result, a.result);
  const dup = t.hub.sales.approveProposal(b.proposalId, { displayedSha: b.sha }, ctx.actor, { channel: "owner", sessionCheck: () => t.hub.trust.requireSession(session) });
  assert.equal(dup.duplicate, true); assert.equal(dup.approvalId, a.result.approvalId);
  assert.equal(salesFingerprint(t), before); assert.equal(t.hub.db.prepare("SELECT count(*) n FROM commands").get().n, commands);
  assert.equal(salesDecisions(t).length, 1);
  assert.deepEqual(salesDecisions(t)[0], { proposalId: b.proposalId, version: b.version, contentSha: b.sha, opportunityId: b.oppId, approvalId: r1.approval.id,
    decidedVia: "owner_session", authority: "webauthn", sessionId: session.id, credentialId: session.credentialId, channel: "owner" });
});

test("M12-CORE-05 final transaction rechecks session, content integrity and proposal/opportunity states", async c => {
  const { t, b } = await fixture(c);
  const guard = { channel: "test", sessionCheck: () => null };
  const run = () => t.hub.sales.approveProposal(b.proposalId, { displayedSha: b.sha }, "test", guard);
  t.hub.db.prepare("UPDATE sales_opportunities SET status='PROPOSAL_DRAFT' WHERE id=?").run(b.oppId);
  assert.throws(run, /gata de revizuire/);
  t.hub.db.prepare("UPDATE sales_opportunities SET status='READY_FOR_OWNER_REVIEW' WHERE id=?").run(b.oppId);
  t.hub.db.prepare("UPDATE sales_proposals SET status='INVALID' WHERE id=?").run(b.proposalId);
  assert.throws(run, /gata de revizuire/);
  t.hub.db.prepare("UPDATE sales_proposals SET status='DRAFT', content_json='{}' WHERE id=?").run(b.proposalId);
  const before = salesFingerprint(t);
  assert.throws(run, /Conținutul/);
  assert.equal(salesFingerprint(t), before);
  assert.throws(() => t.hub.sales.approveProposal(b.proposalId, { displayedSha: b.sha }, "owner", { channel: "owner", sessionCheck: () => { throw Error("session re-read"); } }), /session re-read/);
});

test("M12-CORE-06 override exact basis, reason, history, inputs hash and duplicate target", async c => {
  const { t, b } = await fixture(c);
  const { session } = await enrolOwner(t, { activatePolicy: false });
  const ctx = context(session), run = body => salesCommand(t, "sales.qualification.override", { orgId: b.orgId, ...body }, ctx);
  const before = salesFingerprint(t);
  await assert.rejects(run({ priority: 80, reason: "Motiv test" }), /displayedQualificationId/);
  await assert.rejects(run({ ...b.overrideBody, reason: " " }), /reason/);
  assert.equal(salesFingerprint(t), before);
  const basis = t.hub.db.prepare("SELECT inputs_sha FROM sales_qualifications WHERE id=?").get(b.qualificationId);
  const [first, duplicate] = await Promise.all([run(b.overrideBody), run(b.overrideBody)]);
  assert.equal(duplicate.result.id, first.result.id); assert.equal(duplicate.result.duplicate, true);
  assert.equal(first.result.override.basedOn, b.qualificationId); assert.equal(first.result.override.authority, "webauthn");
  assert.equal(t.hub.db.prepare("SELECT inputs_sha FROM sales_qualifications WHERE id=?").get(first.result.id).inputs_sha, basis.inputs_sha);
  await assert.rejects(run({ ...b.overrideBody, reason: "Alt motiv" }), /s-a schimbat/);
  await salesCommand(t, "sales.org.qualify", { orgId: b.orgId });
  await assert.rejects(run(b.overrideBody), /s-a schimbat/);
  assert.equal(t.hub.db.prepare("SELECT count(*) n FROM events WHERE type='sales.qualification.override'").get().n, 1);
});

test("M12-CORE-07 final session refusal rolls consumption and proposal writes back", async c => {
  const { t, b } = await fixture(c);
  const { session } = await enrolOwner(t, { activatePolicy: false });
  const r = await pending(t, b, context(session)); await decide(t, r, context(session));
  const before = salesFingerprint(t), consume = t.hub.approvals.consume;
  let reached = false;
  t.hub.approvals.consume = (...args) => {
    const result = consume(...args); reached = true;
    t.hub.db.prepare("UPDATE owner_sessions SET status='ended', revoke_reason='owner-revoke-all' WHERE id=?").run(session.id);
    return result;
  };
  try { await assert.rejects(t.hub.commands.executeApproved(r.command.id, "owner", { ownerSession: session }), /proprietar/); }
  finally { t.hub.approvals.consume = consume; }
  assert.equal(reached, true); assert.equal(salesFingerprint(t), before);
  assert.equal(t.hub.approvals.get(r.approval.id).status, "approved");
  assert.equal(t.hub.db.prepare("SELECT count(*) n FROM events WHERE type='approval.consumed' AND scope_id=?").get(r.command.id).n, 0);
});

test("M12-CORE-08 opportunity CAS refusal rolls back the proposal CAS and approval consumption", async c => {
  const { t, b } = await fixture(c); const r = await pending(t, b); await decide(t, r);
  const before = salesFingerprint(t);
  // A deterministic lost-CAS seam, after the proposal update but before the opportunity can commit.
  t.hub.db.exec("CREATE TEMP TRIGGER m12_lost_cas BEFORE UPDATE ON sales_opportunities WHEN NEW.status='APPROVED_INTERNAL' BEGIN SELECT RAISE(IGNORE); END");
  try { await assert.rejects(t.hub.commands.executeApproved(r.command.id), /Oportunitatea s-a schimbat/); }
  finally { t.hub.db.exec("DROP TRIGGER m12_lost_cas"); }
  assert.equal(salesFingerprint(t), before); assert.equal(t.hub.approvals.get(r.approval.id).status, "approved");
});

test("M12-CORE-09 concurrent owner decisions are single-use and preserve exact hash binding", async c => {
  const { t, b } = await fixture(c); const { session } = await enrolOwner(t, { activatePolicy: false });
  const ctx = context(session), r = await pending(t, b, ctx);
  await assert.rejects(salesCommand(t, "approval.owner_decide", { approvalId: r.approval.id, decision: "approved", displayedHash: "0".repeat(64) }, ctx), /action changed/);
  const results = await Promise.allSettled([decide(t, r, ctx), decide(t, r, ctx)]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(t.hub.db.prepare("SELECT count(*) n FROM events WHERE type='approval.approved' AND scope_id=?").get(r.command.id).n, 1);
  t.hub.db.prepare("UPDATE commands SET payload_json=? WHERE id=?").run(JSON.stringify({ proposalId: b.proposalId, displayedSha: "0".repeat(64) }), r.command.id);
  const before = salesFingerprint(t);
  await assert.rejects(t.hub.commands.executeApproved(r.command.id, "owner", { ownerSession: session }), /logged command changed/);
  assert.equal(salesFingerprint(t), before); assert.equal(t.hub.approvals.get(r.approval.id).status, "invalidated");
});
