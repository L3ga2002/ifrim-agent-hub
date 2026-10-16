import test from "node:test";
import assert from "node:assert/strict";
import { salesApprovalReadiness, salesAuthorityLabel, salesApprovalCardText, salesApprovalAction } from "../web/src/lib/salesAuthorityLogic.js";

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
  assert.equal(salesApprovalCardText({ actionKind: "sales.draft_content" }), "Aprobă exact această acțiune");
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
