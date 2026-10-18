import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { salesApprovalReadiness, salesAuthorityLabel, salesApprovalCardText, salesApprovalAction, salesDecisionApplies, salesApprovalStateText,
  ownerSalesKind } from "../web/src/lib/salesAuthorityLogic.js";
import { proposalApprovalReadiness } from "../web/src/lib/salesLogic.js";
import { withReauth } from "../web/src/lib/ownerSession.js";

const source = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

const p = { id: "spr_test_12", version: 1, status: "DRAFT", sha: "a".repeat(64), approvedSha: null };
const opp = { id: "opp_test", status: "READY_FOR_OWNER_REVIEW" };
test("M12-UI-01 exact full sha and id required; readiness supplies disabled reasons", () => {
  assert.equal(salesApprovalReadiness(opp, p, [p]).ok, true);
  for (const sha of [undefined, "", " ", "a".repeat(12), "A".repeat(64), "g".repeat(64)]) {
    const r = salesApprovalReadiness(opp, { ...p, sha }, []); assert.equal(r.ok, false); assert.match(r.reason, /SHA/);
  }
  assert.match(salesApprovalReadiness(opp, { ...p, id: "" }, []).reason, /ID/);
  assert.equal(salesApprovalReadiness({ ...opp, status: "PROPOSAL_DRAFT" }, p, []).needsReview, true);
  assert.match(salesApprovalReadiness(opp, p, [{ ...p, id: "spr_new", version: 2 }]).reason, /mai nouă/);
  assert.match(salesApprovalReadiness({ ...opp, status: "WON" }, p, []).reason, /starea/);
});
test("M12-UI-02 authority labels and reserved-kind card text are truthful", () => {
  assert.match(salesAuthorityLabel({ authority: "webauthn" }), /Windows Hello/);
  assert.match(salesAuthorityLabel({ authority: "local_dev_profile" }), /sesiune locală de dezvoltare/);
  for (const session of [null, { authority: "test" }, { authority: "local_dev_profile" }]) assert.doesNotMatch(salesAuthorityLabel(session), /Windows Hello/);
  assert.match(salesApprovalCardText({ actionKind: "sales.proposal_approve" }), /Aprob intern.*Nu trimite.*CONTACTED.*WON/);
  // 2.15.2: the draft text approval is a reserved owner decision too, with its own card text; any other kind keeps the generic one.
  assert.match(salesApprovalCardText({ actionKind: "sales.draft_content" }), /doar textul.*Nu trimite nimic/);
  assert.equal(salesApprovalCardText({ actionKind: "factory.scope" }), "Aprobă exact această acțiune");
});
test("M12-UI-03 one reauth retry resumes the three-stage action without requesting or deciding twice", async () => {
  for (const failedStage of [0, 1, 2]) {
    const calls = []; let failed = false;
    const api = async (path, options) => {
      const stage = path.endsWith("/approve") ? 0 : path.endsWith("/owner_decide") ? 1 : 2;
      calls.push({ path, options, stage });
      if (stage === failedStage && !failed) { failed = true; throw Object.assign(Error("reauth"), { category: "authentication" }); }
      if (stage === 0) return { commandId: "cmd_one", approval: { id: "apr_one", payloadHash: "b".repeat(64) } };
      return { ok: true };
    };
    const action = salesApprovalAction(api, { path: "/api/sales/proposals/spr_one/approve", body: { displayedSha: p.sha } });
    let prompts = 0;
    try { await action(); } catch { prompts++; await action(); }
    assert.equal(prompts, 1); assert.equal(calls.length, 4);
    for (const stage of [0, 1, 2]) assert.equal(calls.filter(c => c.stage === stage).length, stage === failedStage ? 2 : 1);
    assert.deepEqual(calls.find(c => c.stage === 0).options.body, { displayedSha: p.sha });
  }
});
test("M12-UI-04 (review C2) the decision block exists only for the latest DRAFT under review; every other version states itself once", () => {
  const v2 = { ...p, id: "spr_test_13", version: 2, sha: "c".repeat(64) };
  const approved = { ...p, status: "APPROVED_INTERNAL", approvedSha: p.sha };
  // What the proposal view prints (its own state line) and what the decision block prints (only when it is rendered).
  const lines = (o, proposal, proposals) => {
    const view = proposalApprovalReadiness(o, proposal, proposals), block = salesApprovalReadiness(o, proposal, proposals);
    const applies = salesDecisionApplies(o, proposal, proposals);
    return { applies, printed: [!view.ok && !view.needsReview && view.reason, applies && !block.ok && block.reason].filter(Boolean) };
  };
  assert.deepEqual(lines(opp, p, [p]), { applies: true, printed: [] });
  const superseded = lines(opp, p, [p, v2]);
  assert.equal(superseded.applies, false); assert.equal(superseded.printed.length, 1); assert.match(superseded.printed[0], /mai nouă/);
  assert.deepEqual(lines({ ...opp, status: "APPROVED_INTERNAL" }, approved, [approved]), { applies: false, printed: [] });
  assert.deepEqual(lines({ ...opp, status: "PROPOSAL_DRAFT" }, p, [p]), { applies: false, printed: [] });
  for (const status of ["INVALID", "SUPERSEDED"]) {
    const other = lines(opp, { ...p, status }, [{ ...p, status }]);
    assert.equal(other.applies, false); assert.equal(other.printed.length, 1); assert.match(other.printed[0], /Propunerea e/);
  }
  const won = lines({ ...opp, status: "WON" }, p, [p]);
  assert.equal(won.applies, false); assert.equal(won.printed.length, 1); assert.match(won.printed[0], /starea/);
  // The latest DRAFT under review with a broken identity keeps the block, disabled, with the reason printed once (in the block).
  const broken = lines(opp, { ...p, sha: "a".repeat(12) }, [{ ...p, sha: "a".repeat(12) }]);
  assert.equal(broken.applies, true); assert.equal(broken.printed.length, 1); assert.match(broken.printed[0], /SHA/);
});

test("M12-UI-05 (review F10) ApprovalCard: a reserved kind takes the owner path under one withReauth, never /decide", async () => {
  const reserved = { id: "apr_card", scopeId: "cmd_card", scopeType: "command", actionKind: "sales.proposal_approve", payloadHash: "d".repeat(64) };
  // The card's reserved branch is approveSales(options) = withReauth(salesApprovalAction(api, options)) (salesOwnerActions.js).
  const rig = (failOnce = null) => {
    const calls = []; let reauths = 0, prompts = 0, failed = false;
    const call = async (path, options) => {
      calls.push({ path, body: options?.body });
      if (failOnce && path.endsWith(failOnce) && !failed) { failed = true; throw Object.assign(Error("Deschide sesiunea de proprietar"), { category: "authentication", details: { needSession: true } }); }
      return { ok: true };
    };
    // The same retry rule as withReauth, counted: one wrapper per click, at most one prompt.
    const reauth = async (fn) => { reauths++; try { return await fn(); } catch (error) { if (error.category !== "authentication") throw error; prompts++; return fn(); } };
    const card = (options) => reauth(salesApprovalAction(call, options));
    return { calls, card, counts: () => ({ reauths, prompts }) };
  };
  const paths = (r) => r.calls.map(c => c.path);
  const runs = [];

  // „Aprob intern” on a pending card: owner_decide on THIS approval, then execute ITS command (scopeId); no new request.
  let r = rig(); runs.push(r);
  await r.card({ approval: { ...reserved, status: "pending" }, decision: "approved", note: "" });
  assert.deepEqual(paths(r), ["/api/approvals/apr_card/owner_decide", "/api/commands/cmd_card/execute"]);
  assert.deepEqual(r.calls[0].body, { decision: "approved", displayedHash: reserved.payloadHash, note: "" });
  assert.deepEqual(r.counts(), { reauths: 1, prompts: 0 });

  // „Respinge”: owner_decide only, with the note; nothing executes.
  r = rig(); runs.push(r);
  assert.deepEqual(await r.card({ approval: { ...reserved, status: "pending" }, decision: "rejected", note: "Nu acum" }), { rejected: true });
  assert.deepEqual(paths(r), ["/api/approvals/apr_card/owner_decide"]); assert.equal(r.calls[0].body.decision, "rejected"); assert.equal(r.calls[0].body.note, "Nu acum");

  // „Pornește acum” on an approved card: only the execute of its command, never a second decision.
  r = rig(); runs.push(r);
  await r.card({ approval: { ...reserved, status: "approved" } });
  assert.deepEqual(paths(r), ["/api/commands/cmd_card/execute"]);

  // One unlock prompt when the executing session is missing; the decision already recorded is not sent again.
  r = rig("/execute"); runs.push(r);
  await r.card({ approval: { ...reserved, status: "pending" }, decision: "approved" });
  assert.deepEqual(paths(r), ["/api/approvals/apr_card/owner_decide", "/api/commands/cmd_card/execute", "/api/commands/cmd_card/execute"]);
  assert.deepEqual(r.counts(), { reauths: 1, prompts: 1 });

  // approval.decide (ui/agent) is never asked to decide a reserved kind, and the request is never made again.
  for (const run of runs) assert.equal(paths(run).some(path => /\/api\/approvals\/[^/]+\/decide$|\/approve$/.test(path)), false);

  // The card routes exactly the reserved kind through that owner action, on both buttons, before any /decide.
  assert.equal(ownerSalesKind(reserved), true);
  // 2.15.2: the other Sales owner decisions take the same owner path; nothing else does.
  for (const actionKind of ["sales.draft_content", "sales.suppression_lift", "sales.import_rollback"]) assert.equal(ownerSalesKind({ ...reserved, actionKind }), true, actionKind);
  for (const actionKind of ["factory.scope", "lega.run_request", "process.run", ""]) assert.equal(ownerSalesKind({ ...reserved, actionKind }), false, actionKind);
  assert.match(source("web/src/lib/salesOwnerActions.js"), /export const approveSales = \(options\) => withReauth\(salesApprovalAction\(api, options\)\);/);
  const card = source("web/src/screens/Approvals.jsx");
  assert.match(card, /const reserved = ownerSalesKind\(approval\);/);
  assert.match(card, /if \(reserved\) \{ await approveSales\(\{ approval, decision, note \}\); onDone\(\); return; \}\s*await api\(`\/api\/approvals\/\$\{approval\.id\}\/decide`/);
  assert.match(card, /await \(reserved \? approveSales\(\{ approval \}\) : startApproved\(approval\)\)/);
});

test("M12-UI-06 (review F8) a decision refused for good asks for no Windows Hello and the card says to request the approval again", async () => {
  // The server's answer for a revoked decider / revoke-all boundary / another credential: a conflict, never authentication.
  const refused = Object.assign(Error("Autoritatea aprobării a fost revocată; cere din nou aprobarea"), { category: "conflict", code: "OWNER_DECISION_REVOKED", status: 409 });
  let attempts = 0;
  // The real withReauth: it would run the WebAuthn unlock only for an authentication error; this one comes back untouched, once.
  await assert.rejects(withReauth(async () => { attempts++; throw refused; }), (error) => error === refused);
  assert.equal(attempts, 1);
  const reserved = { actionKind: "sales.proposal_approve", status: "invalidated" };
  assert.match(salesApprovalStateText(reserved), /Cere din nou aprobarea/);
  assert.match(salesApprovalStateText({ ...reserved, status: "expired" }), /Cere din nou aprobarea/);
  for (const status of ["pending", "approved", "consumed", "rejected"]) assert.equal(salesApprovalStateText({ ...reserved, status }), null, status);
  assert.match(salesApprovalStateText({ actionKind: "sales.draft_content", status: "invalidated" }), /textul ciornei.*Cere din nou aprobarea/);
  assert.equal(salesApprovalStateText({ actionKind: "factory.scope", status: "invalidated" }), null);
});

test("M12-UI-07 (final review F20) a decided reserved approval shows the authority RECORDED on the decision, never the viewer's current session; a pending one the session it will be decided in", async () => {
  const { salesApprovalAuthorityText, salesDecidedAuthorityLabel } = await import("../web/src/lib/salesAuthorityLogic.js");
  const webauthn = { authority: "webauthn" };
  const dev = { authority: "local_dev_profile" };
  for (const status of ["approved", "consumed", "rejected"]) {
    const decidedDev = { actionKind: "sales.proposal_approve", status, authority: "local_dev_profile" };
    const text = salesApprovalAuthorityText(decidedDev, webauthn);
    assert.doesNotMatch(text, /Windows Hello/, `${status}: a dev-profile decision is never shown as Windows Hello`);
    assert.match(text, /sesiune locală de dezvoltare/, status);
    assert.match(text, /a fost înregistrată/, `${status}: said in the past tense`);
    assert.match(salesApprovalAuthorityText({ ...decidedDev, authority: "webauthn" }, dev), /Windows Hello/, `${status}: a WebAuthn decision stays WebAuthn under a dev session`);
    assert.match(salesApprovalAuthorityText({ ...decidedDev, authority: undefined }, webauthn), /nu e înregistrată/, `${status}: no recorded authority is said, not borrowed`);
    assert.doesNotMatch(salesApprovalAuthorityText(decidedDev, null), /Decizia cere sesiunea ta/, `${status}: a decided card does not ask for a session`);
  }
  const pending = { actionKind: "sales.proposal_approve", status: "pending" };
  assert.equal(salesApprovalAuthorityText(pending, webauthn), salesAuthorityLabel(webauthn), "a pending card: the session it will be decided in");
  assert.equal(salesApprovalAuthorityText(pending, dev), salesAuthorityLabel(dev));
  assert.match(salesDecidedAuthorityLabel("test"), /canalul de test/);
  const card = source("web/src/screens/Approvals.jsx");
  assert.match(card, /salesApprovalAuthorityText\(approval, owner\.data\?\.session\)/);
  assert.doesNotMatch(card, /\{salesAuthorityLabel\(owner\.data\?\.session\)\}/, "the viewer's session is no longer printed for every reserved card");
});
