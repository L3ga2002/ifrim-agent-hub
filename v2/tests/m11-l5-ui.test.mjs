// M11 L5 wave B (design .ifrim/M11_L5_DESIGN.md §2, §5.6, §7 „Unda B”): pure UI logic for test-first missions. Step 0 appears on the
// stage bar and the execution graph only for a test-first mission; the writer / code-review nodes count runs by the stage they were
// dispatched for; the plan card's step-0 lines come from the hashed body only (the test's path only under „Detalii tehnice”); during the
// proof a FAIL is „așteptat”; the owner's summary appears only after protection. Ordinary missions and cards stay exactly as before.
import test from "node:test";
import assert from "node:assert/strict";
import {
  FACTORY_STAGE_RO, FACTORY_PATH, FACTORY_PATH_TEST_FIRST, STAGE_ZERO_STAGES, factoryPathOf, factoryProgress,
  TF_CARD_STEP0, TF_CARD_STEP0_NO_REWRITE, tfCardProves, testFirstCard, evidenceResult, evidenceStageLabel, testFirstSummary,
} from "../web/src/lib/uiLogic.js";
import { missionGraph } from "../web/src/lib/cockpitLogic.js";
import { T_STAGE_LABELS, T_CARD_STEP0, T_CARD_STEP0_NO_REWRITE, T_CARD_PROVES } from "../server/factory/test-first.mjs";

const criteria = [{ id: "AC-1", text: "Totalul coșului include TVA-ul" }, { id: "AC-2", text: " Reducerea nu face totalul negativ " }];

test("M11-L5-UI-01 the browser's step-0 texts are the server's words (labels, card sentence, what the test proves)", () => {
  for (const s of STAGE_ZERO_STAGES) assert.equal(FACTORY_STAGE_RO[s], T_STAGE_LABELS[s], s);
  assert.deepEqual(Object.keys(T_STAGE_LABELS).sort(), [...STAGE_ZERO_STAGES].sort());
  assert.equal(TF_CARD_STEP0, T_CARD_STEP0);
  assert.equal(tfCardProves(criteria), T_CARD_PROVES(criteria));
  assert.equal(tfCardProves([criteria[0]]), T_CARD_PROVES([criteria[0]]));
  assert.match(tfCardProves(criteria), /AC-2 — „Reducerea nu face totalul negativ”/, "the owner's words, trimmed");
});

test("M11-L5-UI-02 step 0 is on the stage bar only for a test-first mission; ordinary progress is unchanged", () => {
  assert.equal(factoryPathOf({ factory: { stage: "QA" }, authoring: null }), FACTORY_PATH);
  assert.equal(factoryPathOf({ factory: { stage: "QA" } }), FACTORY_PATH, "no authoring field (an older view) → the ordinary path");
  assert.equal(factoryPathOf(null), FACTORY_PATH);
  assert.ok(!FACTORY_PATH.some((s) => STAGE_ZERO_STAGES.includes(s)), "the ordinary path never shows step 0");
  const tf = factoryPathOf({ authoring: { status: "PLANNED" } });
  assert.equal(tf, FACTORY_PATH_TEST_FIRST);
  assert.deepEqual(tf.slice(0, 5), ["SPEC_DRAFT", "TEST_AUTHORING", "TEST_PROVING", "TEST_REVIEW", "BASELINE"]);
  assert.deepEqual(tf.slice(4), FACTORY_PATH.slice(1), "after step 0 the path is the ordinary one");
  // Ordinary missions: the same indices as before (m03-guards M03 progress checks).
  assert.equal(factoryProgress({ factory: { stage: "REVIEWING" } }).current, FACTORY_PATH.indexOf("REVIEWING"));
  const side = factoryProgress({ factory: { stage: "NEEDS_OWNER_DECISION" }, dispatches: [{ stage: "REVIEWING" }], evidence: [{ stage: "CHECKING" }] });
  assert.deepEqual(side, { current: FACTORY_PATH.indexOf("REVIEWING"), side: "NEEDS_OWNER_DECISION" });
  // A step-0 stage of an ordinary view is not on its path (side state, as any unknown stage).
  assert.equal(factoryProgress({ factory: { stage: "TEST_PROVING" } }).side, "TEST_PROVING");
  // Test-first missions.
  const authoring = { status: "AUTHORING" };
  assert.deepEqual(factoryProgress({ factory: { stage: "TEST_PROVING" }, authoring }), { current: 2, side: null });
  assert.equal(factoryProgress({ factory: { stage: "REVIEWING" }, authoring }).current, FACTORY_PATH_TEST_FIRST.indexOf("REVIEWING"));
  const held = factoryProgress({ factory: { stage: "NEEDS_OWNER_DECISION" }, authoring, dispatches: [{ stage: "TEST_AUTHORING" }], evidence: [{ stage: "TEST_PROVING" }] });
  assert.deepEqual(held, { current: 2, side: "NEEDS_OWNER_DECISION" }, "a hold in step 0 shows where step 0 stopped");
});

const ordinaryView = (extra = {}) => ({
  factory: { approvedSpecVersion: 1, stage: "REVIEWING" },
  runs: [{ provider: "codex", status: "completed", environment: "windows", dispatchStage: "IMPLEMENTING" }, { provider: "claude", status: "running", dispatchStage: "REVIEWING" }],
  evidence: [{ stage: "BASELINE", status: "FAIL", runner: "codex-sandbox", stale: false }, { stage: "CHECKING", status: "PASS", runner: "codex-sandbox", stale: false }],
  ...extra,
});
const KEYS = ["spec", "baseline", "writer", "checks", "review", "qa", "preview", "e2e", "delivery"];

test("M11-L5-UI-03 the execution graph: ordinary missions unchanged; step 0 only for test-first; writer/review by the dispatch stage", () => {
  const plain = missionGraph(ordinaryView());
  assert.deepEqual(plain.map((n) => n.key), KEYS, "no step-0 node for an ordinary mission");
  const g = Object.fromEntries(plain.map((n) => [n.key, n]));
  assert.equal(g.writer.status, "DONE"); assert.equal(g.writer.where, "Windows");
  assert.equal(g.review.status, "RUNNING");
  // Runs without a dispatch stage (an older view) keep the provider rule.
  const legacy = Object.fromEntries(missionGraph(ordinaryView({ runs: [{ provider: "codex", status: "completed", environment: "wsl-runner" }, { provider: "claude", status: "running" }] })).map((n) => [n.key, n]));
  assert.equal(legacy.writer.status, "DONE"); assert.equal(legacy.writer.where, "ifrim-runner"); assert.equal(legacy.review.status, "RUNNING");

  // A test-first mission in TEST_REVIEW: Claude wrote the test, Codex reviews it — neither is the writer nor the code review.
  const tfView = { factory: { approvedSpecVersion: 1, stage: "TEST_REVIEW" }, authoring: { status: "AUTHORING", cycle: 0 },
    runs: [{ provider: "claude", status: "completed", dispatchStage: "TEST_AUTHORING" }, { provider: "codex", status: "running", environment: "windows", dispatchStage: "TEST_REVIEW" }],
    evidence: [{ stage: "TEST_PROVING", status: "FAIL", runner: "codex-sandbox", stale: false }] };
  const nodes = missionGraph(tfView);
  assert.deepEqual(nodes.map((n) => n.key), ["spec", "test", ...KEYS.slice(1)], "the step-0 node sits between the spec and the baseline");
  const t = Object.fromEntries(nodes.map((n) => [n.key, n]));
  assert.equal(t.test.label, "Testul (pasul 0)");
  assert.equal(t.test.status, "RUNNING"); assert.match(t.test.where, /Windows/);
  assert.equal(t.writer.status, "WAITING", "the test's Codex review is not the writer");
  assert.equal(t.writer.where, "—");
  assert.equal(t.review.status, "WAITING", "the test's Claude author is not the code review");
  assert.equal(t.review.where, "—");

  const node = (authoring, stage = "IMPLEMENTING", runs = []) => missionGraph({ factory: { approvedSpecVersion: 1, stage }, authoring, runs, evidence: [] }).find((n) => n.key === "test");
  assert.equal(node({ status: "PLANNED" }, "SPEC_DRAFT").status, "WAITING");
  assert.equal(node({ status: "PLANNED" }, "SPEC_DRAFT").where, "—", "nothing ran yet");
  assert.equal(node({ status: "AUTHORING" }, "TEST_AUTHORING").status, "RUNNING");
  assert.equal(node({ status: "AUTHORING" }, "PAUSED").status, "WAITING");
  assert.equal(node({ status: "AUTHORING", blocked: { kind: "already_passes", reason: "…" } }, "NEEDS_OWNER_DECISION").status, "BLOCKED");
  assert.equal(node({ status: "ABANDONED" }, "CANCELLED").status, "FAILED");
  const done = node({ status: "PROTECTED" }, "IMPLEMENTING", [{ provider: "claude", status: "completed", dispatchStage: "TEST_AUTHORING" }, { provider: "codex", status: "running", environment: "windows", dispatchStage: "IMPLEMENTING" }]);
  assert.equal(done.status, "DONE");
  const after = Object.fromEntries(missionGraph({ factory: { approvedSpecVersion: 1, stage: "IMPLEMENTING" }, authoring: { status: "PROTECTED" },
    runs: [{ provider: "claude", status: "completed", dispatchStage: "TEST_AUTHORING" }, { provider: "codex", status: "completed", environment: "windows", dispatchStage: "TEST_REVIEW" }, { provider: "codex", status: "running", environment: "windows", dispatchStage: "IMPLEMENTING" }],
    evidence: [] }).map((n) => [n.key, n]));
  assert.equal(after.writer.status, "RUNNING", "only the implementation run decides the writer node");
  assert.equal(after.review.status, "WAITING");
});

const tfBody = { missions: [{ missionId: "mis_1", title: "Repară totalul", specVersion: 1, workType: "BUGFIX" }],
  testFirst: { testRef: "test/hub/m11-repara-totalul.test.mjs", criteria, author: "claude sonnet · medium", testReviewer: { provider: "codex", model: "gpt-6.1-sol", effort: "medium" },
    reauthorMax: 1, proofRuns: 2, mustFail: true, protectedAfterReview: true, remainingAuthoring: 2 } };

test("M11-L5-UI-04 the plan card's step-0 lines come from the hashed body; the test path only in the technical details", () => {
  assert.equal(testFirstCard(null), null);
  assert.equal(testFirstCard({ missions: [] }), null, "an ordinary plan → no new line (its card renders as before)");
  assert.equal(testFirstCard({ testFirst: { criteria } }), null, "no test path → not a test-first body");
  const card = testFirstCard(tfBody);
  assert.equal(card.step0, T_CARD_STEP0);
  assert.equal(card.proves, T_CARD_PROVES(criteria));
  assert.ok(!card.step0.includes("test/hub") && !card.proves.includes("test/hub") && !/\.mjs/.test(card.step0 + card.proves), "never a file name in the main lines");
  assert.ok(card.details.startsWith("test/hub/m11-repara-totalul.test.mjs"), "the path is in the details row");
  for (const words of ["criterii: AC-1, AC-2", "trebuie să pice acum", "review înainte de protejare", "cel mult 1 rescriere", "2 rulări",
    "scrie: claude sonnet · medium (doar citire)", "verifică: codex · gpt-6.1-sol · medium (doar citire)"]) assert.ok(card.details.includes(words), words);
  const more = testFirstCard({ testFirst: { ...tfBody.testFirst, reauthorMax: 2, proofRuns: 1, author: null, testReviewer: 7, criteria: [{ id: "AC-1", text: "  " }, null, { id: "", text: "x" }] } });
  assert.equal(more.proves, null, "no usable criterion → no „Ce va dovedi” line");
  assert.ok(more.details.includes("cel mult 2 rescrieri") && more.details.includes("1 rulare") && !more.details.includes("scrie:") && !more.details.includes("verifică:"));
  assert.ok(testFirstCard({ testFirst: { ...tfBody.testFirst, reauthorMax: 0 } }).details.includes("fără rescriere"));
  // Review wave B (authority #3): a spec with reauthorMax 0 → the card does not promise the rewrite (the server's words, pinned equal).
  assert.equal(TF_CARD_STEP0_NO_REWRITE, T_CARD_STEP0_NO_REWRITE);
  assert.equal(testFirstCard({ testFirst: { ...tfBody.testFirst, reauthorMax: 0 } }).step0, T_CARD_STEP0_NO_REWRITE);
  assert.doesNotMatch(T_CARD_STEP0_NO_REWRITE, /rescriu/);
  assert.match(T_CARD_STEP0_NO_REWRITE, /Dacă testul nu trece verificările, mă opresc fără să modific codul\.$/);
  assert.equal(testFirstCard({ testFirst: { ...tfBody.testFirst, reauthorMax: 1 } }).step0, T_CARD_STEP0);
});

test("M11-L5-UI-05 during the proof a FAIL is „așteptat”; every other evidence row keeps its status", () => {
  for (const status of ["PASS", "FAIL", "BLOCKED", "INCONCLUSIVE"]) {
    assert.deepEqual(evidenceResult({ id: "e1", stage: "BASELINE", status }), { label: status, tone: null, note: "" }, status);
    assert.deepEqual(evidenceResult({ id: "e1", stage: "CHECKING", status }, { proof: { verdict: "PROVEN", evidenceIds: ["e1"] } }), { label: status, tone: null, note: "" });
  }
  const pending = evidenceResult({ id: "e2", stage: "TEST_PROVING", status: "FAIL" }, { status: "AUTHORING" });
  assert.equal(pending.label, "FAIL · așteptat"); assert.notEqual(pending.tone, "error");
  const proven = evidenceResult({ id: "e2", stage: "TEST_PROVING", status: "FAIL" }, { proof: { verdict: "PROVEN", evidenceIds: ["e2", "e3"] } });
  assert.deepEqual(proven, { label: "FAIL · așteptat", tone: "ok", note: "pică pe codul de acum, din motivul potrivit" });
  const wrong = evidenceResult({ id: "e2", stage: "TEST_PROVING", status: "FAIL" }, { proof: { verdict: "WRONG_REASON", evidenceIds: ["e2"] } });
  assert.equal(wrong.tone, "warn"); assert.match(wrong.note, /nu din motivul potrivit/);
  const older = evidenceResult({ id: "e9", stage: "TEST_PROVING", status: "FAIL" }, { proof: { verdict: "PROVEN", evidenceIds: ["e2"] } });
  assert.equal(older.tone, "info", "a row of an earlier candidate is not claimed by the current proof");
  const passes = evidenceResult({ id: "e2", stage: "TEST_PROVING", status: "PASS" }, null);
  assert.equal(passes.label, "PASS · neașteptat"); assert.equal(passes.tone, "warn");
  assert.deepEqual(evidenceResult({ id: "e2", stage: "TEST_PROVING", status: "BLOCKED" }), { label: "BLOCKED", tone: null, note: "" });
  assert.equal(evidenceStageLabel("TEST_PROVING"), "Proba testului");
  for (const s of ["BASELINE", "CHECKING", "QA", "E2E"]) assert.equal(evidenceStageLabel(s), s, "ordinary stages keep their code, as before");
});

test("M11-L5-UI-06 the owner's summary appears only once the Hub-written test is protected", () => {
  const summary = "Testul de acceptanță e gata și protejat. Ce verifică: AC-1 — „…” (verificat de reviewer) (azi: pică — corect, problema există). De aici Codex repară codul, nu testul; o modificare a testului oprește misiunea.";
  assert.equal(testFirstSummary(null), null);
  assert.equal(testFirstSummary({ authoring: null }), null);
  assert.equal(testFirstSummary({ authoring: { status: "AUTHORING", summary } }), null, "never before protection");
  assert.equal(testFirstSummary({ authoring: { status: "PROTECTED", summary: null } }), null);
  assert.equal(testFirstSummary({ authoring: { status: "PROTECTED", summary } }), summary);
});
