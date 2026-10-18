// Milestone 03 — remaining guarantees from the test matrix: a review of files that changed under the reviewer is STALE
// (T11), the pre-inference refund is bounded (T09), voice usage stays UNKNOWN (T20), and the Engineering UI helpers (T21).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeTestHub, enableLive, waitFor } from "./helpers.mjs";
import { materializeFixture, demoSpec } from "../server/factory/fixtures.mjs";
import { factoryWaitLabel, formatMs, parseCriteriaLines, mergeCriteria, factoryProgress, FACTORY_PATH } from "../web/src/lib/uiLogic.js";

const dispatch = (hub, type, payload, channel = "test") => hub.commands.dispatch({ type, payload, channel, actor: "test" });

test("M03-GRD-01 files changed while the reviewer reads: the verdict is recorded STALE, a new change set is checked and reviewed again", async () => {
  const t = await makeTestHub({ queues: true });
  try {
    await enableLive(t.hub, { provider: "codex", access: "workspace-write", attempts: 1 });
    const dir = path.join(t.dataDir, "factory-stale");
    materializeFixture("bug-demo", dir);
    const project = (await dispatch(t.hub, "project.register_test", { path: dir })).result;
    t.hub.bus.transaction(() => {
      t.hub.grants.create({ provider: "codex", projectId: project.id, access: "workspace-write", maxAttempts: 3, maxDurationS: 900, ttlMinutes: 60 }, "test");
      t.hub.grants.create({ provider: "claude", projectId: project.id, access: "read-only", maxAttempts: 3, maxDurationS: 900, ttlMinutes: 60 }, "test");
    });
    const { mission } = (await dispatch(t.hub, "factory.prepare", { projectId: project.id, ...demoSpec("bug-demo"), limits: { writerModel: "gpt-fake-sol", reviewerModel: "sonnet" } })).result;
    t.queue("codex", "factory-write:bug-fix");
    t.queue("claude", "review-slow:pass", "review:pass");
    const requested = await dispatch(t.hub, "factory.start", t.hub.factory.view(mission.id).scope);
    await dispatch(t.hub, "approval.decide", { approvalId: requested.approval.id, decision: "approved", displayedHash: requested.approval.payloadHash });
    await t.hub.commands.executeApproved(requested.command.id, "user");
    await waitFor(() => t.hub.factory.view(mission.id).factory.stage === "REVIEWING" && t.hub.runs.activeRuns().some((r) => r.provider === "claude"), 90000);
    fs.appendFileSync(path.join(dir, "README.md"), "\nNotă adăugată în timpul review-ului.\n");
    const done = await waitFor(() => { const v = t.hub.factory.view(mission.id); return ["DELIVERY_READY", "NEEDS_OWNER_DECISION", "BLOCKED"].includes(v.factory.stage) ? v : null; }, 120000, 100);
    assert.equal(done.factory.stage, "DELIVERY_READY", done.factory.stageReason);
    assert.equal(done.reviews[0].status, "STALE", "the verdict on the old files is history, not approval");
    assert.equal(done.reviews.at(-1).status, "VALID");
    assert.equal(done.changeSets.length, 2);
    assert.ok(done.changeSets[1].changes.some((c) => c.path === "README.md"), "the new change set includes the edit");
    assert.equal(done.reviews.at(-1).changeSetSha, done.changeSets[1].sha256);
  } finally { await t.cleanup(); }
});

test("M03-GRD-02 refunds of pre-inference failures are capped per grant (no endless retry on one grant)", async () => {
  const t = await makeTestHub();
  try {
    const { grant } = await enableLive(t.hub, { provider: "codex", attempts: 2 });
    let refunded = 0;
    for (let i = 0; i < 4; i += 1) {
      t.hub.bus.transaction(() => t.hub.grants.consumeAttempt(grant.id));
      const before = t.hub.grants.get(grant.id).attemptsUsed;
      t.hub.runs.refundPreInference(grant.id, `test ${i}`);
      if (t.hub.grants.get(grant.id).attemptsUsed < before) refunded += 1;
      else break;
    }
    assert.equal(refunded, 2, "at most maxAttempts refunds");
    assert.equal(t.hub.bus.query({ typePrefix: "grant.refund_refused", limit: 5 }).length, 1);
  } finally { await t.cleanup(); }
});

test("M03-GRD-03 Lega voice usage is UNKNOWN (never derived from the price estimate); the estimate stays labelled as one", async () => {
  const t = await makeTestHub();
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const source = fs.readFileSync(path.join(here, "..", "server", "runtime", "lega.mjs"), "utf8");
    assert.match(source, /planUsage: \{ status: "UNKNOWN", measured: null/);
    const ui = fs.readFileSync(path.join(here, "..", "web", "src", "shell", "Lega.jsx"), "utf8");
    assert.match(ui, /consum real: necunoscut/);
    assert.equal(t.hub.lega.state(), null, "no session: no usage figure is reported at all");
  } finally { await t.cleanup(); }
});

test("M03-UI-01 Engineering UI helpers: wait reasons never claim the model works while it waits for the owner; criteria parsing; durations; progress", () => {
  assert.match(factoryWaitLabel("approval"), /aprobarea ta/);
  assert.match(factoryWaitLabel("grant"), /grant/);
  assert.match(factoryWaitLabel("runner"), /fără model/);
  assert.match(factoryWaitLabel("runner", "BLOCKED"), /nu au putut rula.*Reia/, "a blocked mission does not claim that something is running");
  assert.match(factoryWaitLabel("owner_decision", "SPEC_DRAFT"), /specificația/);
  for (const reason of ["approval", "grant", "gate", "runner", "owner_decision", "cancel"]) assert.doesNotMatch(factoryWaitLabel(reason), /Modelul lucrează/, reason);
  assert.equal(formatMs(65000), "1 min 05 s");
  assert.equal(formatMs(null), "—");
  const criteria = parseCriteriaLines("Numele din spații e refuzat | test | test/a.test.mjs\nRevizuit | review\nFlux în browser | e2e");
  assert.deepEqual(criteria.map((c) => [c.id, c.verify, c.testRef || null]), [["AC-1", "test", "test/a.test.mjs"], ["AC-2", "review", null], ["AC-3", "e2e", null]]);
  // Saving a revision in the line editor keeps the approved E2E steps and the expected baseline failure it cannot show.
  const previous = [{ id: "AC-1", verify: "test", testRef: "test/a.test.mjs", expectFailure: "nume obligatoriu" }, { id: "AC-2", verify: "review" }, { id: "AC-3", verify: "e2e", steps: [{ goto: "/" }] }];
  const merged = mergeCriteria(criteria, previous);
  assert.equal(merged[0].expectFailure, "nume obligatoriu");
  assert.deepEqual(merged[2].steps, [{ goto: "/" }]);
  assert.equal(mergeCriteria(parseCriteriaLines("Altceva | review\nX | review\nFlux | review"), previous)[2].steps, undefined, "a criterion whose kind changed does not inherit steps");
  assert.equal(factoryProgress({ factory: { stage: "REVIEWING" } }).current, FACTORY_PATH.indexOf("REVIEWING"));
  const side = factoryProgress({ factory: { stage: "NEEDS_OWNER_DECISION" }, dispatches: [{ stage: "REVIEWING" }], evidence: [{ stage: "CHECKING" }] });
  assert.equal(side.side, "NEEDS_OWNER_DECISION");
  assert.equal(side.current, FACTORY_PATH.indexOf("REVIEWING"));
});
