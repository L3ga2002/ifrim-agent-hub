import test from "node:test";
import assert from "node:assert/strict";
import { machineIdentity } from "../server/owner/dev-profile.mjs";
import { salesAcceptanceHub, seedSalesReview, salesCommand, salesFingerprint, salesUnchanged, salesDecisions,
  requestSalesApproval, decideSalesApproval, executeSalesApproval, approveSalesHttp } from "./sales-helpers.mjs";
import { approvedNotStarted } from "../web/src/lib/uiLogic.js";

async function fixture(c, options) {
  const t = await salesAcceptanceHub(c, options);
  return { t, b: await seedSalesReview(t) };
}
const sessionId = t => t.hub.db.prepare("SELECT id FROM owner_sessions WHERE status='active' ORDER BY rowid DESC LIMIT 1").get().id;
const approvalState = (t, r) => t.hub.approvals.get(r.approval.id).status;
const commandState = (t, r) => t.hub.commands.get(r.commandId).status;
const endedReasons = (t, r) => t.hub.db.prepare("SELECT payload_json FROM events WHERE type='approval.invalidated' AND json_extract(payload_json, '$.approvalId')=?").all(r.approval.id).map(e => JSON.parse(e.payload_json));
/** A decision refused for good (review F8/F9): no Windows Hello can fix it, it is retired and no longer offered as approved-not-started. */
function assertRetired(t, r, response, code) {
  assert.equal(response.json.error.category === "authentication", false, JSON.stringify(response.json));
  assert.equal(Boolean(response.json.error.details?.needSession || response.json.error.details?.reauth), false);
  if (code) assert.equal(response.json.error.code, code);
  assert.equal(approvalState(t, r), "invalidated"); assert.equal(commandState(t, r), "failed");
  assert.equal(endedReasons(t, r).length, 1);
  assert.equal(approvedNotStarted(t.hub.approvals.list("approved")).some(a => a.id === r.approval.id), false);
  assert.equal(t.hub.db.prepare("SELECT count(*) n FROM events WHERE type='approval.consumed' AND scope_id=?").get(r.commandId).n, 0);
}

test("SA-01 valid session + exact offer → exactly one approval", async c => {
  const { t, b } = await fixture(c); await t.authenticate();
  const r = await requestSalesApproval(t, b);
  assert.equal(t.hub.sales.getOpportunity(b.oppId).proposals[0].status, "DRAFT");
  const decision = await decideSalesApproval(t, r);
  assert.equal(decision.decidedVia, "owner_session"); assert.equal(decision.decidedBy, `owner:${sessionId(t)}`);
  assert.equal(decision.authority, "webauthn");
  assert.equal(t.hub.approvals.get(r.approval.id).credentialId, t.hub.db.prepare("SELECT credential_id FROM owner_sessions WHERE id=?").get(sessionId(t)).credential_id);
  const done = await executeSalesApproval(t, r); assert.equal(done.status, 200, JSON.stringify(done.json));
  assert.equal(approvalState(t, r), "consumed"); assert.equal(salesDecisions(t).length, 1);
  const p = t.hub.sales.getOpportunity(b.oppId).proposals[0];
  assert.equal(p.approvedSha, b.sha); assert.equal(p.approvalId, r.approval.id);
  assert.equal(t.hub.commands.get(r.commandId).channel, "owner");
});

test("SA-02 absent / expired freshness / revoked sessions refuse without changing the offer", async c => {
  let now = new Date(); const { t, b } = await fixture(c, { clock: () => now });
  await salesUnchanged(t, () => t.request(b.route, { body: b.body }), 401);
  await salesUnchanged(t, () => t.request(b.overrideRoute, { body: b.overrideBody }), 401);
  await t.authenticate(); const r = await requestSalesApproval(t, b);
  const decide = () => t.request(`/api/approvals/${r.approval.id}/owner_decide`, { body: { decision: "approved", displayedHash: r.approval.payloadHash } });
  await salesUnchanged(t, () => t.request(b.route, { body: b.body, sessionCookie: "ifrim_owner=fake" }), 401);
  await salesUnchanged(t, () => t.request(b.overrideRoute, { body: b.overrideBody, sessionCookie: "ifrim_owner=fake" }), 401);
  now = new Date(now.getTime() + 6 * 60000);
  const stale = await salesUnchanged(t, decide, 401); assert.match(JSON.stringify(stale.json), /reauth/);
  await t.authenticate({ reauth: true }); await decideSalesApproval(t, r);
  now = new Date(now.getTime() + 6 * 60000);
  await salesUnchanged(t, () => executeSalesApproval(t, r), 401); assert.equal(approvalState(t, r), "approved");
  await t.authenticate({ reauth: true });
  // Overrides need an open re-read session, not the SENSITIVE_ACTIONS freshness window.
  now = new Date(now.getTime() + 6 * 60000);
  assert.equal((await t.request(b.overrideRoute, { body: b.overrideBody })).status, 200);
  assert.equal((await t.request("/api/owner/sessions/revoke-all")).status, 200);
  await salesUnchanged(t, decide, 401);
  await salesUnchanged(t, () => t.request(b.route, { body: b.body }), 401);
  await salesUnchanged(t, () => t.request(b.overrideRoute, { body: b.overrideBody }), 401);
  await salesUnchanged(t, () => executeSalesApproval(t, r), 401);
  await t.authenticate({ reauth: true }); now = new Date(now.getTime() + 25 * 3600000);
  await salesUnchanged(t, () => t.request(b.route, { body: b.body }), 401);
  await salesUnchanged(t, () => t.request(b.overrideRoute, { body: b.overrideBody }), 401);
});

test("SA-03 absent / empty / whitespace / prefix / uppercase / wrong SHA and superseded version refused", async c => {
  const { t, b } = await fixture(c); await t.authenticate();
  for (const displayedSha of [undefined, "", " ", b.sha.slice(0, 12), b.sha.toUpperCase(), "z".repeat(64), ` ${b.sha}`]) {
    await salesUnchanged(t, () => t.request(b.route, { body: { displayedSha } }), 400);
  }
  for (const alias of ["sha", "contentSha"]) await salesUnchanged(t, () => t.request(b.route, { body: { [alias]: b.sha } }), 400);
  let r = await requestSalesApproval(t, { ...b, body: { displayedSha: "0".repeat(64) } }); await decideSalesApproval(t, r);
  // Review F9: a refused final check retires the decision; a retry answers the approval state, never a WebAuthn prompt.
  assertRetired(t, r, await salesUnchanged(t, () => executeSalesApproval(t, r), 409));
  assert.match(endedReasons(t, r)[0].reason, /final check refused: Conținutul s-a schimbat/);
  const again = await salesUnchanged(t, () => executeSalesApproval(t, r), 409);
  assert.equal(again.json.error.category, "gate"); assert.match(again.json.error.message, /invalidated/);
  r = await requestSalesApproval(t, b);
  await salesCommand(t, "sales.proposal.create", { opportunityId: b.oppId }); await decideSalesApproval(t, r);
  assertRetired(t, r, await salesUnchanged(t, () => executeSalesApproval(t, r), 409));
  assert.match(endedReasons(t, r)[0].reason, /versiune mai nouă/);
  assert.equal(t.hub.sales.getOpportunity(b.oppId).proposals[0].status, "DRAFT");
});

test("SA-04 revoke-all between deciding and executing refuses without consuming the approval", async c => {
  const { t, b } = await fixture(c); await t.authenticate();
  const r = await requestSalesApproval(t, b); await decideSalesApproval(t, r);
  const revoked = await t.request("/api/owner/sessions/revoke-all"); assert.equal(revoked.status, 200);
  const locked = await salesUnchanged(t, () => executeSalesApproval(t, r), 401); assert.equal(locked.json.error.details.needSession, true);
  assert.equal(approvalState(t, r), "approved"); assert.equal(commandState(t, r), "pending_approval");
  await t.authenticate({ reauth: true });
  // Review F8: after unlocking, the revoked decision is refused for good: no second Windows Hello, the decision retired, not consumed.
  const refused = await salesUnchanged(t, () => executeSalesApproval(t, r), 409);
  assertRetired(t, r, refused, "OWNER_DECISION_REVOKED"); assert.match(refused.json.error.message, /cere din nou aprobarea/);
  assert.equal((await salesUnchanged(t, () => executeSalesApproval(t, r), 409)).json.error.category, "gate");
  assert.equal(t.hub.sales.getOpportunity(b.oppId).proposals[0].status, "DRAFT");
  // „Cere din nou aprobarea”: a new request in the new session approves the same exact version once.
  assert.equal((await approveSalesHttp(t, b)).status, 200); assert.equal(salesDecisions(t).length, 1);
});

test("SA-04b (review P1-F1) revoke-all with no session open still cancels a decision whose session ended by logout", async c => {
  const { t, b } = await fixture(c); await t.authenticate();
  const decider = sessionId(t), r = await requestSalesApproval(t, b); await decideSalesApproval(t, r);
  assert.equal((await t.request("/api/owner/logout")).status, 200);
  assert.equal(t.hub.db.prepare("SELECT revoke_reason FROM owner_sessions WHERE id=?").get(decider).revoke_reason, "logout");
  assert.equal(t.hub.trust.confirmedAuthority(decider).ok, true, "a logout alone keeps a confirmed decision");
  const revoked = await t.request("/api/owner/sessions/revoke-all", { sessionCookie: "" });
  assert.equal(revoked.status, 200, JSON.stringify(revoked.json));
  assert.equal(t.hub.db.prepare("SELECT count(*) n FROM owner_sessions WHERE status='active'").get().n, 0);
  const boundary = t.hub.db.prepare("SELECT payload_json FROM events WHERE type='owner.sessions_revoked'").all().map(e => JSON.parse(e.payload_json));
  assert.deepEqual(boundary.map(e => e.count), [0], "the boundary is recorded even with no session open");
  await t.authenticate({ reauth: true });
  assertRetired(t, r, await salesUnchanged(t, () => executeSalesApproval(t, r), 409), "OWNER_DECISION_REVOKED");
  assert.equal(t.hub.sales.getOpportunity(b.oppId).proposals[0].status, "DRAFT"); assert.equal(salesDecisions(t).length, 0);
});

test("SA-05 agent / cli and forged test channel cannot reach owner decisions over HTTP", async c => {
  const { t, b } = await fixture(c); await t.authenticate(); const r = await requestSalesApproval(t, b);
  for (const channel of ["agent", "cli"]) {
    const headers = { "X-Hub-Channel": channel, "X-Hub-Delegation": "synthetic delegation" };
    for (const [route, body] of [[b.route, b.body], [b.overrideRoute, b.overrideBody], [`/api/approvals/${r.approval.id}/decide`, { decision: "approved", displayedHash: r.approval.payloadHash }],
      [`/api/approvals/${r.approval.id}/owner_decide`, { decision: "approved", displayedHash: r.approval.payloadHash }], [`/api/commands/${r.commandId}/execute`, {}]]) {
      await salesUnchanged(t, () => t.request(route, { body, headers }), 403);
    }
  }
  for (const channel of ["ui", "test", "owner", "automation"]) for (const type of ["sales.proposal.approve", "sales.qualification.override", "approval.owner_decide"]) {
    await salesUnchanged(t, () => t.request("/api/commands", { headers: { "X-Hub-Channel": channel }, body: { type, payload: { proposalId: b.proposalId, displayedSha: b.sha, orgId: b.orgId, ...b.overrideBody } } }), 403);
  }
  await salesUnchanged(t, () => t.request(b.route, { body: b.body, sessionCookie: "", headers: { "X-Hub-Channel": "test" } }), 401);
});

test("SA-06 old sessionless ui request is refused (declared M04 negative)", async c => {
  const { t, b } = await fixture(c);
  await salesUnchanged(t, () => t.request(b.route, { body: b.body }), 401);
  assert.equal(t.hub.sales.getOpportunity(b.oppId).proposals[0].status, "DRAFT");
  await t.authenticate(); const r = await requestSalesApproval(t, b);
  await salesUnchanged(t, () => t.request(`/api/approvals/${r.approval.id}/decide`, { sessionCookie: "", body: { decision: "approved", displayedHash: r.approval.payloadHash } }), 401);
  await salesUnchanged(t, () => t.request("/api/commands", { body: { type: "approval.decide", payload: { approvalId: r.approval.id, decision: "approved", displayedHash: r.approval.payloadHash } } }), 401);
});

test("SA-07 repeats and Promise.all concurrency produce one decision, event and approval_id", async c => {
  const { t, b } = await fixture(c); await t.authenticate();
  const requests = await Promise.all([requestSalesApproval(t, b), requestSalesApproval(t, b)]);
  await Promise.all(requests.map(r => decideSalesApproval(t, r)));
  const results = await Promise.all(requests.map(r => executeSalesApproval(t, r)));
  assert.deepEqual(results.map(r => r.status), [200, 200]);
  assert.equal(results.filter(r => !r.json.result.duplicate).length, 1);
  assert.equal(results[0].json.result.approvalId, results[1].json.result.approvalId);
  assert.equal(results[0].json.result.approvedAt, results[1].json.result.approvedAt);
  const before = salesFingerprint(t);
  const replay = await executeSalesApproval(t, requests[0]); assert.equal(replay.status, 200); assert.equal(replay.json.duplicate, true);
  assert.equal(salesFingerprint(t), before);
  for (const key of [null, "m12-same-command"]) {
    const options = key ? { headers: { "Idempotency-Key": key } } : {};
    const r = await requestSalesApproval(t, b, options); await decideSalesApproval(t, r);
    const done = await executeSalesApproval(t, r); assert.equal(done.json.result.duplicate, true);
    if (key) { const replayRequest = await t.request(b.route, { body: b.body, ...options }); assert.equal(replayRequest.status, 200); }
  }
  assert.equal(salesDecisions(t).length, 1);
  const q = await Promise.all([t.request(b.overrideRoute, { body: b.overrideBody }), t.request(b.overrideRoute, { body: b.overrideBody })]);
  assert.deepEqual(q.map(r => r.status), [200, 200]); assert.equal(q[0].json.id, q[1].json.id); assert.equal(q[1].json.duplicate, true);
});

test("SA-08 approval implies no send, CONTACTED, WON or sent draft", async c => {
  const sent = []; const { t, b } = await fixture(c, { salesTransport: { send: async m => { sent.push(m); } } });
  await t.authenticate(); assert.equal((await approveSalesHttp(t, b)).status, 200);
  await salesCommand(t, "sales.draft.create", { opportunityId: b.oppId });
  assert.equal(t.hub.sales.getOpportunity(b.oppId).opportunity.status, "APPROVED_INTERNAL");
  for (const table of ["sales_sends", "sales_contact_events", "sales_client_acceptances", "sales_handoffs", "missions", "agent_runs"]) assert.equal(t.hub.db.prepare(`SELECT count(*) n FROM ${table}`).get().n, 0, table);
  assert.equal(t.hub.db.prepare("SELECT count(*) n FROM sales_drafts WHERE status IN ('SENT','SEND_AUTHORIZED')").get().n, 0);
  assert.equal(sent.length, 0);
});

test("SA-09 same credential with rotated session id may execute", async c => {
  const { t, b } = await fixture(c); await t.authenticate(); const old = sessionId(t);
  const r = await requestSalesApproval(t, b); await decideSalesApproval(t, r);
  t.hub.db.prepare("UPDATE owner_sessions SET expires_at=? WHERE id=?").run(new Date(Date.now() + 60000).toISOString(), old);
  await t.authenticate({ reauth: true }); const next = sessionId(t); assert.notEqual(next, old);
  assert.equal(t.hub.db.prepare("SELECT revoke_reason FROM owner_sessions WHERE id=?").get(old).revoke_reason, "rotated");
  assert.equal((await executeSalesApproval(t, r)).status, 200);
  assert.equal(salesDecisions(t)[0].sessionId, next); assert.equal(t.hub.approvals.get(r.approval.id).sessionId, old);
});

test("SA-10 local development profile is allowed and recorded truthfully", async c => {
  let profile = { enabled: true, version: 1, id: "dev_sales12", ...machineIdentity() };
  const { t, b } = await fixture(c, { devProfile: () => profile }); await t.authenticate({ dev: true });
  const r = await requestSalesApproval(t, b); const a = await decideSalesApproval(t, r); assert.equal(a.authority, "local_dev_profile");
  assert.equal((await executeSalesApproval(t, r)).status, 200); assert.equal(salesDecisions(t)[0].authority, "local_dev_profile");
  const override = await t.request(b.overrideRoute, { body: b.overrideBody }); assert.equal(override.json.override.authority, "local_dev_profile");
  profile = { ...profile, enabled: false };
  await salesUnchanged(t, () => t.request(b.overrideRoute, { body: b.overrideBody }), 401);
  await salesUnchanged(t, () => executeSalesApproval(t, r), 401);
});

test("SA-11 M04 in-process test-channel request → decide → execute remains unchanged", async c => {
  const { t, b } = await fixture(c);
  const r = await salesCommand(t, "sales.proposal.approve", { proposalId: b.proposalId, displayedSha: b.sha });
  await salesCommand(t, "approval.decide", { approvalId: r.approval.id, decision: "approved", displayedHash: r.approval.payloadHash });
  await t.hub.commands.executeApproved(r.command.id, "user");
  assert.equal(salesDecisions(t)[0].authority, "test"); assert.equal(t.hub.approvals.get(r.approval.id).decidedVia, "test");
  const override = await salesCommand(t, "sales.qualification.override", { orgId: b.orgId, priority: 80, reason: "Motiv sintetic" });
  assert.equal(override.result.override.basedOn, b.qualificationId);
});

test("M12-HTTP-12 override target and reason matrix; stale target stays unchanged", async c => {
  const { t, b } = await fixture(c); await t.authenticate();
  for (const body of [{ priority: 80, reason: "Motiv test" }, { ...b.overrideBody, displayedQualificationId: "bad" }, { ...b.overrideBody, reason: " " }])
    await salesUnchanged(t, () => t.request(b.overrideRoute, { body }), 400);
  await salesCommand(t, "sales.org.qualify", { orgId: b.orgId });
  await salesUnchanged(t, () => t.request(b.overrideRoute, { body: b.overrideBody }), 409);
  const latest = t.hub.sales.getOrg(b.orgId).qualification;
  const body = { ...b.overrideBody, displayedQualificationId: latest.id };
  const r = await t.request(b.overrideRoute, { body }); assert.equal(r.status, 200);
  const before = salesFingerprint(t);
  const dup = await t.request(b.overrideRoute, { body }); assert.equal(dup.status, 200); assert.equal(dup.json.duplicate, true);
  assert.equal(salesFingerprint(t), before);
  await salesUnchanged(t, () => t.request(b.overrideRoute, { body: { ...body, reason: "Alt motiv sintetic" } }), 409);
});

test("M12-HTTP-13 revoke-all also invalidates an unexecuted decision whose deciding session already rotated", async c => {
  const { t, b } = await fixture(c); await t.authenticate();
  const old = sessionId(t), r = await requestSalesApproval(t, b); await decideSalesApproval(t, r);
  t.hub.db.prepare("UPDATE owner_sessions SET expires_at=? WHERE id=?").run(new Date(Date.now() + 60000).toISOString(), old);
  await t.authenticate({ reauth: true }); assert.notEqual(sessionId(t), old);
  assert.equal((await t.request("/api/owner/sessions/revoke-all")).status, 200);
  await t.authenticate({ reauth: true });
  assertRetired(t, r, await salesUnchanged(t, () => executeSalesApproval(t, r), 409), "OWNER_DECISION_REVOKED");
});

test("M12-HTTP-14 (review P1-F5) a request logged before the upgrade on ui is refused at execution and retired, never left approved", async c => {
  const { t, b } = await fixture(c);
  // 2.14.19 dispatched sales.proposal.approve on ui; the stored row is reproduced by relabelling a test-channel request.
  const r0 = await salesCommand(t, "sales.proposal.approve", { proposalId: b.proposalId, displayedSha: b.sha }, { actor: "user" });
  t.hub.db.prepare("UPDATE commands SET channel='ui', actor='user' WHERE id=?").run(r0.command.id);
  const r = { commandId: r0.command.id, approval: r0.approval };
  await t.authenticate();
  const decided = await t.request(`/api/approvals/${r.approval.id}/decide`, { body: { decision: "approved", displayedHash: r.approval.payloadHash } });
  assert.equal(decided.status, 200, JSON.stringify(decided.json));
  const refused = await salesUnchanged(t, () => executeSalesApproval(t, r), 403);
  assertRetired(t, r, refused, "OWNER_DECISION_CHANNEL"); assert.match(refused.json.error.message, /cere din nou aprobarea/);
  assert.match(endedReasons(t, r)[0].reason, /channel ui/);
  const events = t.hub.db.prepare("SELECT count(*) n FROM events").get().n;
  await salesUnchanged(t, () => executeSalesApproval(t, r), 403);
  assert.equal(t.hub.db.prepare("SELECT count(*) n FROM events").get().n, events, "a repeated refusal writes nothing");
  assert.equal(t.hub.sales.getOpportunity(b.oppId).proposals[0].status, "DRAFT");
});

test("M12-HTTP-15 (review C1) executing before the owner decided answers that the approval is pending and changes nothing", async c => {
  const { t, b } = await fixture(c); await t.authenticate();
  const r = await requestSalesApproval(t, b);
  const early = await salesUnchanged(t, () => executeSalesApproval(t, r), 409);
  assert.equal(early.json.error.category, "gate"); assert.equal(early.json.error.message, "Approval is pending");
  assert.equal(approvalState(t, r), "pending"); assert.equal(commandState(t, r), "pending_approval");
  await decideSalesApproval(t, r);
  assert.equal((await executeSalesApproval(t, r)).status, 200); assert.equal(salesDecisions(t).length, 1);
});

test("M12-HTTP-16 (review P1-F2) a repeated approval reports the real current states of the proposal and the opportunity", async c => {
  const { t, b } = await fixture(c); await t.authenticate();
  const first = await approveSalesHttp(t, b); assert.equal(first.status, 200);
  assert.equal(first.json.result.status, "APPROVED_INTERNAL"); assert.equal(first.json.result.opportunity.status, "APPROVED_INTERNAL");
  for (const to of ["ON_HOLD", "PROPOSAL_DRAFT", "READY_FOR_OWNER_REVIEW"]) await salesCommand(t, "sales.opportunity.transition", { opportunityId: b.oppId, to, reason: "Pauză sintetică" });
  const before = salesFingerprint(t);
  const again = await approveSalesHttp(t, b); assert.equal(again.status, 200);
  assert.equal(again.json.result.duplicate, true); assert.equal(again.json.result.approvalId, first.json.result.approvalId);
  assert.equal(again.json.result.status, "APPROVED_INTERNAL");
  assert.equal(again.json.result.opportunity.status, "READY_FOR_OWNER_REVIEW", "never a claimed APPROVED_INTERNAL");
  assert.equal(t.hub.sales.getOpportunity(b.oppId).opportunity.status, "READY_FOR_OWNER_REVIEW");
  assert.equal(salesFingerprint(t), before); assert.equal(salesDecisions(t).length, 1);
});
