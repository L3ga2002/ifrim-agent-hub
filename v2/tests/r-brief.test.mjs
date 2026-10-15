import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { datasetSkeleton, datasetFragments, datasetPatternsBrief, datasetBrief, extractDatasetSkeleton, EXPERIMENT_DATASETS, datasetIdentity, datasetSkeletonManifest, datasetSkeletonPlan, DATASET_PATTERNS_HEADING } from "../server/factory/dataset.mjs";
import { buildAuthorBrief, buildTestReviewBrief, lintDatasetBrief, normalizeNeeds, lintTestBody, assembleTestFile, assertionInventory, compareInventory, amendmentViolations } from "../server/factory/test-first.mjs";
import { sha256 } from "../server/core/canonical.mjs";
import { s25Context, S25_WORDS, S25_APP, readS25, bodyOf, manifestOf } from "./manual/s25-context.mjs";
import { S25_WORDS as DRIVER_WORDS } from "./manual/s25-isolated-rehearsal.mjs";
import { registerCleanupGuard } from "./helpers.mjs";
import { calibrateS25, executeCalibration, runCalibrationMatrix } from "./manual/s25-calibrate.mjs";
import { compareProcessIdentity } from "./manual/s25-process-identity.mjs";
import { buildCorrectionProbes } from "./fixtures/stage0-s25/correction-probes.mjs";
import { buildVariants } from "./fixtures/stage0-s25/variants.mjs";
import { buildDatasetVariants } from "./fixtures/stage0-s25/dataset-variants.mjs";

registerCleanupGuard();

const h2 = JSON.parse(readS25("h-rehearsals.json")).rehearsals[1];
const h2text = readS25("h2-c1-87a6755f97fb.test.mjs.txt"), h2manifest = h2.reviews[0].validation.manifest;
function context(t, words) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "r-brief-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 }));
  return { root, ...s25Context(root, { words }) };
}
function previous() {
  const sha = sha256(h2text), headerLines = h2text.split("\n").indexOf("// ---- corpul testului ----") + 1;
  return { text: h2text, sha, headerLines, manifest: h2manifest, harness: 2, cycle: 0, review: h2.reviews[0].validation,
    inventory: assertionInventory(h2text, h2manifest, { sha, headerLines }) };
}
function briefFor(ctx, cycle = 0) {
  return buildAuthorBrief({ spec: ctx.spec, facts: ctx.facts, harness: 2, specSha: ctx.sha,
    mission: { id: h2.missionId }, authoring: { testRef: ctx.spec.authoring.testRef }, cycle, previousCandidate: cycle ? previous() : null });
}
function lint(ctx, body, declared) {
  const needs = normalizeNeeds(body, declared.needs);
  const manifest = { ...declared, needs: needs.effective, needsDeclared: needs.declared, needsCompleted: needs.completed };
  return lintTestBody(body, { manifest, criteria: ctx.spec.acceptance, workType: ctx.spec.workType,
    testRef: ctx.spec.authoring.testRef, stagingRef: ctx.spec.authoring.stagingRef, spec: ctx.spec, projectFiles: ctx.facts.files, moduleExports: ctx.facts.exports });
}
const skeletonFile = (ctx) => {
  const body = datasetSkeleton(ctx.spec.dataset, { criteria: ctx.spec.acceptance });
  return assembleTestFile({ body, needs: normalizeNeeds(body, []).effective, helpers: ctx.spec.hubHelpers, harness: 2 });
};

test("T-BRIEF-01: real spec, cycle 0/1 shown bytes and Factory lint, assembled syntax", (t) => {
  const ctx = context(t);
  assert.equal(ctx.sha, h2.specSha);
  assert.equal(DRIVER_WORDS, S25_WORDS);
  assert.equal(ctx.spec.workType, "FEATURE");
  for (const cycle of [0, 1]) {
    const brief = briefFor(ctx, cycle), body = extractDatasetSkeleton(brief);
    assert.equal(body, datasetSkeleton(ctx.spec.dataset, { criteria: ctx.spec.acceptance }));
    const evidence = lintDatasetBrief(brief, { spec: ctx.spec, facts: ctx.facts, ...ctx.spec.authoring });
    assert.equal(evidence.sha256, sha256(body)); assert.deepEqual(evidence.lint.violations, []);
    assert.deepEqual(evidence.lint.signals.map((s) => s.signal), ["http"]);
    assert.deepEqual(evidence.lint, lint(ctx, body, datasetSkeletonManifest(ctx.spec.acceptance)));
    assert.ok(!evidence.manifest.needs.includes("node:url"));
    const file = path.join(ctx.root, `cycle-${cycle}.mjs`);
    fs.writeFileSync(file, assembleTestFile({ body, needs: evidence.manifest.needs, helpers: ctx.spec.hubHelpers, harness: 2 }).text);
    const run = spawnSync(process.execPath, ["--check", file], { encoding: "utf8", timeout: 20000, windowsHide: true });
    assert.equal(run.error, undefined); assert.equal(run.status, 0, run.stderr);
  }
});

test("T-BRIEF-02: h2 lint rejections reproduce verbatim; accepted references stay valid", (t) => {
  const ctx = context(t), text = readS25("h2-c0-8ec8618e364d.test.mjs.txt");
  const result = lint(ctx, bodyOf(text), manifestOf(text));
  assert.deepEqual(result.violations.map((v) => [v.rule, v.detail, v.line]), [["harness_reserved", "hubAdd", 47], ["load_outside_test", "../../src/server-app.js", 41]]);
  assert.deepEqual(result.violations.map((v) => `${v.plain} (${v.detail}), linia ${v.line}`), h2.rejected[0].reasons);
  assert.deepEqual(lint(ctx, bodyOf(h2text), h2manifest).violations, []);
  assert.deepEqual(lint(ctx, readS25("dataset-reference.body.mjs.txt"), JSON.parse(readS25("dataset-reference.manifest.json"))).violations, []);
});

test("T-BRIEF-03: M1 and M2 stay rejected; missing/ambiguous example fails closed", (t) => {
  const ctx = context(t), body = datasetSkeleton(ctx.spec.dataset, { criteria: ctx.spec.acceptance });
  const m1 = body.replace('const db = await setup("stocare", () => new sqlite.DatabaseSync(dbPath));', 'const db = hubAdd("stocare", new sqlite.DatabaseSync(dbPath));');
  const m2 = body.replace("async function twoSessions(startSrv, dbPath, db) {", 'async function loadStart() { const m = await load("../../src/server-app.js"); return need(m, "startServer"); }\nasync function twoSessions(startSrv, dbPath, db) {');
  for (const [mutated, rule] of [[m1, "harness_reserved"], [m2, "load_outside_test"]]) {
    const brief = briefFor(ctx).replace(body, mutated);
    assert.deepEqual(lintDatasetBrief(brief, { spec: ctx.spec, facts: ctx.facts, ...ctx.spec.authoring }).lint.violations.map((v) => v.rule), [rule]);
  }
  for (const brief of ["", briefFor(ctx) + "\n" + datasetPatternsBrief(ctx.spec.dataset, { criteria: ctx.spec.acceptance })]) {
    assert.deepEqual(lintDatasetBrief(brief, { spec: ctx.spec }).lint.violations.map((v) => v.rule), ["brief_skeleton_missing"]);
  }
});

test("T-BRIEF-04: non-dataset bytes and frozen identities unchanged", (t) => {
  const ctx = context(t), before = JSON.parse(readS25("dataset-before.json"));
  const baseSpec = { ...before.specs[0].input.spec, workType: before.specs[0].workType, title: before.specs[0].input.title, objective: before.words };
  assert.equal(buildAuthorBrief({ spec: baseSpec, harness: 2 }), before.author);
  assert.equal(buildTestReviewBrief({ spec: baseSpec, harness: 2 }), before.reviewer);
  assert.equal(datasetIdentity(EXPERIMENT_DATASETS["booking-demo"]), "76c76ccd28ff67c356afff9f4dd56dde8b40f3f8716ed2840419622aed673ae0");
  assert.equal(ctx.sha, "6b6101adb4e2182657d099c20c9a77643210217be27a4a3de61e5baa67224ba1");
});

test("T-BRIEF-05: section budgets, verbatim fragments and reviewer boundaries", (t) => {
  const ctx = context(t), dataset = ctx.spec.dataset, skeleton = datasetSkeleton(dataset, { criteria: ctx.spec.acceptance }), fragments = datasetFragments(skeleton);
  assert.deepEqual(Object.keys(fragments).sort(), ["F1", "F2", "F3", "F4", "F5"]);
  for (const value of Object.values(fragments)) { assert.ok(value.split("\n").length <= 8); assert.ok(skeleton.includes(value)); }
  for (const review of [false, true]) {
    assert.ok(Buffer.byteLength(datasetBrief(dataset, { review, criteria: ctx.spec.acceptance, plan: datasetSkeletonPlan(ctx.spec) })) <= 6144);
    assert.ok(Buffer.byteLength(datasetPatternsBrief(dataset, { review, criteria: ctx.spec.acceptance })) <= (review ? 4 : 13) * 1024);
  }
  const reviewer = buildTestReviewBrief({ spec: ctx.spec, testRef: ctx.spec.authoring.testRef, harness: 2 });
  for (const key of ["F1", "F2", "F3"]) assert.ok(reviewer.includes(fragments[key]));
  for (const boundary of ["Nu cere ca 13:00 să rămână liber după inserare.", "Nu cere egalitatea întregii tabele cu numai cele trei seed-uri după ce există alte rânduri.", "Așteptările provin din contract și răspunsurile POST, niciodată din rândurile citite după repornire."]) assert.ok(reviewer.includes(boundary));
  assert.match(briefFor(ctx, 1), /ADAUGĂ fragmentele.*NU înlocui candidatul anterior/);
  const shifted = datasetSkeleton(dataset, { criteria: ctx.spec.acceptance, loadPath: "../../../src/server-app.js" });
  assert.equal((shifted.match(/load\("\.\.\/\.\.\/\.\.\/src\/server-app.js"\)/g) || []).length, 6);
});

test("T-BRIEF-06: replacing h2-c1 with the example loses insufficient checks", (t) => {
  const ctx = context(t), file = skeletonFile(ctx), prev = previous();
  const { removed } = compareInventory(prev.inventory, { text: file.text, manifest: datasetSkeletonManifest(ctx.spec.acceptance), headerLines: file.header.length, sha: file.sha256 });
  const violations = amendmentViolations(removed, [], prev.review.checks);
  assert.deepEqual(violations.map((v) => v.rule), ["coverage_insufficient_removed"]);
  for (const id of ["P86", "P91", "P97", "P163"]) assert.ok(violations[0].detail.includes(id));
});

test("T-BRIEF-07: h2d provenance and probe identities are independent of the 41", (t) => {
  const ctx = context(t), text = readS25("h2d-ebecb7bf6241.test.mjs.txt"), manifest = JSON.parse(readS25("h2d-ebecb7bf6241.manifest.json"));
  assert.equal(sha256(text), "ebecb7bf624132fa99075b7722caa0fdf7aae9c1d4f7eb0822011d2ee1ec39c4");
  assert.deepEqual(lint(ctx, bodyOf(text), manifest).violations, []);
  const cmp = compareInventory(previous().inventory, { text, manifest, headerLines: previous().headerLines, sha: sha256(text) });
  assert.equal(cmp.removed.length, 0); assert.equal(cmp.matched.length, 39);
  const source = fs.readFileSync(path.join(S25_APP, "src/server-app.js"), "utf8"), correct = source.replace("phone: row.phone, ", "");
  const probes = buildCorrectionProbes(correct), { DEFECTIVE, extra } = buildVariants(source.replaceAll("\r\n", "\n"), readS25);
  const variants = { ...DEFECTIVE, ...extra, ...buildDatasetVariants(correct) };
  assert.equal(Object.keys(variants).length, 41);
  const codes = [...Object.values(probes.defects), ...Object.values(probes.preconditions)];
  assert.deepEqual(codes.map((code) => sha256(code).slice(0, 12)), ["628755deb196", "749d6bc72246", "7e409a8b111f"]);
  for (const code of codes) assert.ok(!Object.values(variants).includes(code));
});

test("T-BRIEF-08: skeleton runtime matrix, proof and separate correction probes", { timeout: 1200000 }, async (t) => {
  const ctx = context(t), file = skeletonFile(ctx);
  const result = await calibrateS25({ text: file.text, manifest: datasetSkeletonManifest(ctx.spec.acceptance) });
  assert.equal(result.matrix[0].verdict, "PASS", JSON.stringify(result.matrix[0]));
  assert.equal(result.matrix[0].pass, 6); assert.equal(result.matrix[0].cleanupOk, true);
  assert.equal(result.proof?.verdict, "PROVEN", JSON.stringify(result.proof));
  assert.ok(result.proof.table.filter((r) => r.today === "fail").every((r) => r.code === "ERR_ASSERTION" && /^EXPUNERE:/.test(r.message)));
  assert.equal(result.originalRuns.length, 2); assert.equal(result.matrix.length, 42);
  assert.ok(result.matrix.slice(1).every((r) => r.verdict === "ASSERTION_REJECTION"));
  assert.deepEqual(result.correctionProbes.defects.map((r) => r.verdict), ["ASSERTION_REJECTION", "ASSERTION_REJECTION"]);
  assert.deepEqual(result.correctionProbes.preconditions.map((r) => r.verdict), ["PRECONDITION_STOP"]);
  for (const run of [...result.matrix, ...result.originalRuns, ...result.correctionProbes.defects, ...result.correctionProbes.preconditions]) {
    assert.equal(run.cleanupOk, true); assert.equal(run.processesGone, true); assert.ok(run.processes.every((p) => p.pid > 0 && p.startTime > 0 && p.gone));
  }
  assert.equal(result.ok, true);
});

test("T-BRIEF-09: h2-c1 gaps, dataset-reference corrections and correct 6/6", (t) => {
  const ctx = context(t), source = fs.readFileSync(path.join(S25_APP, "src/server-app.js"), "utf8"), correct = source.replace("phone: row.phone, ", "");
  const manifest = JSON.parse(readS25("dataset-reference.manifest.json"));
  const reference = assembleTestFile({ body: readS25("dataset-reference.body.mjs.txt"), needs: manifest.needs, helpers: ["json-exposure"], harness: 2 }).text;
  const execute = (code, text, precondition = false) => { fs.writeFileSync(path.join(ctx.dir, "src/server-app.js"), code); return executeCalibration(ctx.dir, text, { precondition }); };
  const pass = execute(correct, reference); assert.equal(pass.verdict, "PASS", JSON.stringify(pass)); assert.equal(pass.pass, 6);
  const probes = buildCorrectionProbes(correct);
  for (const code of Object.values(probes.defects)) {
    assert.equal(execute(code, h2text).verdict, "PASS");
    assert.equal(execute(code, reference).verdict, "ASSERTION_REJECTION");
  }
  const code = Object.values(probes.preconditions)[0];
  assert.equal(execute(code, h2text).verdict, "PASS");
  assert.equal(execute(code, reference, true).verdict, "PRECONDITION_STOP");
});

test("T-BRIEF-10: Factory pre-dispatch validated, incompatible and failing examples with fake providers", { timeout: 120000 }, async (t) => {
  const { makeTestHub, enableLive, waitFor } = await import("./helpers.mjs");
  const { buildEngineeringSpec } = await import("../server/owner/planners/engineering.mjs");
  for (const scenario of [
    { name: "clean dispatch" },
    { name: "hold without any run", bad: true },
    { name: "dataset without json-exposure dispatches without a gate", noHelper: true },
    { name: "unknown criterion kind records skipped and dispatches", unknownKind: true },
    { name: "BUGFIX records skipped and dispatches without a brief hold", bugfix: true },
    { name: "cycle 1 brief hold through reAuthorOrDecide records rejection and starts no second author", rewrite: true },
  ]) await t.test(scenario.name, async (t) => {
    const { bad = false, noHelper, unknownKind, bugfix, rewrite } = scenario;
    const h = await makeTestHub({ queues: true }); t.after(() => h.cleanup());
    const ctx = s25Context(h.dataDir);
    const dispatch = (type, payload) => h.hub.commands.dispatch({ type, payload, channel: "test", actor: "test" });
    const project = (await dispatch("project.register_test", { path: ctx.dir, name: "Repetiție izolată §25" })).result;
    const built = buildEngineeringSpec({ text: bugfix ? `Repară bug: ${S25_WORDS}` : S25_WORDS, project });
    if (bugfix) assert.equal(built.input.workType, "BUGFIX");
    if (noHelper) delete built.input.spec.hubHelpers;
    if (unknownKind) built.input.spec.acceptance.find((c) => c.kind === "valid_accepted").kind = "other_behavior";
    const mission = (await dispatch("factory.prepare", { projectId: project.id, ...built.input, limits: { writerModel: "gpt-fake-sol", reviewerModel: "sonnet" } })).result.mission;
    await enableLive(h.hub, { provider: "codex", access: "workspace-write", attempts: 1 });
    h.hub.bus.transaction(() => { h.hub.grants.create({ provider: "claude", projectId: project.id, access: "read-only", maxAttempts: 1, maxDurationS: 900, ttlMinutes: 60 }, "test"); });
    const renderedCycles = [];
    if (bad || rewrite) h.hub.factory.setAuthorBriefRendererForTests((args) => {
      renderedCycles.push(args.cycle);
      const brief = buildAuthorBrief(args);
      return bad || args.cycle === 1 ? brief.replace('const db = await setup("stocare", () => new sqlite.DatabaseSync(dbPath));', 'const db = hubAdd("stocare", new sqlite.DatabaseSync(dbPath));') : brief;
    });
    h.queue("claude", rewrite ? "author:bug-tautology" : "author:dataset-reference");
    const events = []; const unsubscribe = h.hub.bus.subscribe((event) => { if (event.type === "factory.test_brief_validated") events.push(event); });
    t.after(() => unsubscribe());
    const processesBefore = h.hub.supervisor.list().length;
    const startProcess = h.hub.supervisor.start;
    let processStarts = 0;
    let cycleOneStarts = 0;
    h.hub.supervisor.start = (...args) => { processStarts += 1; if (renderedCycles.includes(1)) cycleOneStarts += 1; return startProcess(...args); };
    const req = await dispatch("factory.start", h.hub.factory.view(mission.id).scope);
    await dispatch("approval.decide", { approvalId: req.approval.id, decision: "approved", displayedHash: req.approval.payloadHash });
    await h.hub.commands.executeApproved(req.command.id, "user");
    await waitFor(() => ["NEEDS_OWNER_DECISION", "BLOCKED", "PAUSED"].includes(h.hub.factory.view(mission.id).factory.stage));
    await h.hub.factory.idle(mission.id);
    const a = JSON.parse(h.hub.db.prepare("SELECT protected_json FROM factory_specs WHERE mission_id = ? ORDER BY version DESC LIMIT 1").get(mission.id).protected_json).authoring;
    if (noHelper) {
      assert.equal(a.briefValidation, undefined); assert.deepEqual(events, []);
    } else if (unknownKind || bugfix) {
      assert.match(a.briefValidation.skipped, bugfix ? /FEATURE/ : /other_behavior/);
      assert.equal(a.briefValidation.lint, undefined); assert.equal(a.briefValidation.sha256, undefined);
      assert.ok(events.some((event) => event.payload.skipped === a.briefValidation.skipped));
    } else {
      assert.equal(a.briefValidation.lint.ok, !(bad || rewrite)); assert.match(a.briefValidation.sha256, /^[a-f0-9]{64}$/);
      assert.ok(events.some((event) => event.payload.sha256 === a.briefValidation.sha256 && event.payload.lint.ok === !(bad || rewrite)));
    }
    if (bad) {
      assert.equal(a.blocked.kind, "brief"); assert.equal(h.hub.db.prepare("SELECT COUNT(*) AS n FROM agent_runs").get().n, 0);
      assert.equal(h.hub.supervisor.list().length, processesBefore);
      assert.equal(processStarts, 0);
    } else if (rewrite) {
      assert.deepEqual(renderedCycles, [0, 1]);
      assert.equal(a.cycle, 1); assert.equal(a.briefValidation.cycle, 1);
      assert.equal(a.rejected.length, 1); assert.equal(a.rejected[0].cycle, 0); assert.equal(a.rejected[0].kind, "lint");
      assert.ok(a.rejected[0].candidate.lint.violations.some((v) => v.rule === "tautology_literal"));
      assert.match(a.rejected[0].sha, /^[a-f0-9]{64}$/);
      assert.equal(a.candidate, null); assert.equal(a.pending, null);
      assert.equal(a.blocked.kind, "brief"); assert.equal(cycleOneStarts, 0);
      assert.equal(h.hub.factory.view(mission.id).runs.filter((r) => r.dispatchStage === "TEST_AUTHORING").length, 1);
      assert.equal(h.hub.db.prepare("SELECT COUNT(*) AS n FROM agent_runs").get().n, 1);
      const reason = "Exemplul de test pregătit de Hub nu trece verificarea proprie. Pasul 0 se oprește înainte de apelul autorului.";
      assert.equal(a.blocked.reason, reason); assert.equal(h.hub.factory.view(mission.id).factory.stageReason, reason);
    } else {
      assert.notEqual(a.blocked?.kind, "brief");
      assert.ok(h.hub.factory.view(mission.id).runs.some((r) => r.dispatchStage === "TEST_AUTHORING")); assert.ok(processStarts > 0);
    }
  });
});

test("T-BRIEF-11: calibration separates technical errors and precondition outcomes", (t) => {
  const ctx = context(t);
  for (const [body, error, verdict] of [
    ['test("AC-1: control", () => { assert.equal(1, 1); });', null, "PRECONDITION_NOT_DEMONSTRATED"],
    ['test("AC-1: control", () => { assert.equal(1, 2, "other assertion"); });', "ERR_ASSERTION", "PRECONDITION_NOT_DEMONSTRATED"],
    ['test("AC-1: control", () => { null.missing(); });', "TypeError", "TECHNICAL_STOP"],
    ['test("AC-1: control", () => { assert.fail("HUB_SETUP broken"); });', "HUB_", "TECHNICAL_STOP"],
  ]) {
    const file = assembleTestFile({ body, harness: 2 });
    const run = executeCalibration(ctx.dir, file.text, { precondition: true });
    assert.equal(run.verdict, verdict, JSON.stringify(run));
    assert.equal(run.errors[0]?.errorClass ?? null, error);
    assert.equal(run.processesGone, true); assert.equal(run.asExpected, false);
  }
});

test("T-BRIEF-12: four planner criteria omit refusal, use their own ids and lint clean", (t) => {
  const ctx = context(t, S25_WORDS.replace("obligatoriu și ", ""));
  assert.equal(ctx.spec.acceptance.filter((c) => c.verify === "test").length, 4);
  assert.deepEqual(ctx.spec.acceptance.filter((c) => c.verify === "test").map((c) => c.kind), ["public_omits", "anon_params", "internal_persistence", "valid_accepted"]);
  for (const renumber of [false, true]) {
    if (renumber) {
      ctx.spec.acceptance = ctx.spec.acceptance.map((c, i) => ({ ...c, id: `AC-${17 + i}` }));
      ctx.spec.authoring.criteria = ctx.spec.acceptance.filter((c) => c.verify === "test").map((c) => c.id);
    }
    const body = extractDatasetSkeleton(briefFor(ctx));
    assert.equal(body, datasetSkeleton(ctx.spec.dataset, { criteria: ctx.spec.acceptance }));
    assert.ok(!body.includes("Fiecare refuz")); assert.ok(!body.includes("for (const invalid"));
    const evidence = lintDatasetBrief(briefFor(ctx), { spec: ctx.spec, facts: ctx.facts, ...ctx.spec.authoring });
    assert.deepEqual(evidence.lint.violations, []);
    const [publicRead, params, stored, accepted] = ctx.spec.acceptance.filter((c) => c.verify === "test");
    assert.deepEqual(evidence.manifest.cases.map((c) => [c.criterion, c.kind, c.today]), [
      [publicRead.id, "check", "fail"], [params.id, "check", "fail"], [publicRead.id, "check", "fail"],
      [stored.id, "control", "pass"], [accepted.id, "control", "pass"],
    ]);
    for (const c of evidence.manifest.cases) assert.ok(body.includes(`test(${JSON.stringify(c.name)},`));
    const fragments = datasetFragments(body);
    assert.deepEqual(Object.keys(fragments).sort(), ["F1", "F2", "F3", "F4", "F5"]);
    for (const fragment of Object.values(fragments)) { assert.ok(body.includes(fragment)); assert.ok(fragment.split("\n").length <= 8); }
    const review = buildTestReviewBrief({ spec: ctx.spec, testRef: ctx.spec.authoring.testRef, harness: 2 });
    for (const key of ["F1", "F2", "F3"]) assert.ok(review.includes(fragments[key]));
    for (const isReview of [false, true]) {
      const contract = datasetBrief(ctx.spec.dataset, { review: isReview, criteria: ctx.spec.acceptance, plan: datasetSkeletonPlan(ctx.spec) });
      assert.ok((isReview ? review : briefFor(ctx)).includes(contract));
      assert.doesNotMatch(contract, /refuz|AC-5/);
      assert.ok(contract.includes(`CONTROL ISTORIC: ${publicRead.id} separat`));
      assert.ok(contract.includes(`${stored.id}/${accepted.id}`));
      assert.ok(Buffer.byteLength(contract) <= 6144);
    }
  }
});

test("T-BRIEF-13: helper and criterion eligibility is shared by rendering and validation", (t) => {
  const ctx = context(t), original = structuredClone(ctx.spec);
  const scenarios = [
    { change: (s) => { delete s.hubHelpers; }, reason: /json-exposure/ },
    { change: (s) => { s.hubHelpers = []; }, reason: /json-exposure/ },
    { change: (s) => { s.acceptance.find((c) => c.kind === "valid_accepted").kind = "other_behavior"; }, reason: /other_behavior/ },
    { change: (s) => { delete s.acceptance.find((c) => c.kind === "valid_accepted").kind; }, reason: /nu declară tipul/ },
    ...["public_omits", "anon_params"].map((kind) => ({ change: (s) => { s.acceptance = s.acceptance.filter((c) => c.kind !== kind); }, reason: new RegExp(kind) })),
  ];
  for (const { change, reason } of scenarios) {
    ctx.spec = structuredClone(original); change(ctx.spec);
    const brief = briefFor(ctx), review = buildTestReviewBrief({ spec: ctx.spec, testRef: ctx.spec.authoring.testRef, harness: 2 });
    for (const text of [brief, review]) {
      assert.ok(text.includes("## Contractul experimentului"));
      assert.ok(!text.includes(DATASET_PATTERNS_HEADING));
      assert.equal(extractDatasetSkeleton(text), null);
      assert.ok(!text.includes("Tiparele executabile sunt în secțiunea"));
      assert.ok(text.includes("Scrie testele conform criteriilor și contractului de mai sus."));
    }
    const evidence = lintDatasetBrief(brief, { spec: ctx.spec, facts: ctx.facts, ...ctx.spec.authoring });
    assert.deepEqual(Object.keys(evidence), ["skipped"]); assert.match(evidence.skipped, reason);
    assert.deepEqual(evidence, datasetSkeletonPlan(ctx.spec));
  }
  ctx.spec = structuredClone(original);
  ctx.spec.acceptance.push({ id: "AC-99", verify: "manual", text: "Manual criterion without a supported kind" });
  assert.ok(extractDatasetSkeleton(briefFor(ctx)));
  assert.deepEqual(datasetSkeletonManifest(ctx.spec.acceptance), datasetSkeletonManifest(original.acceptance));
});

test("T-BRIEF-14: fix wording is BUGFIX and skips the FEATURE skeleton in both roles and gate", (t) => {
  for (const word of ["Repară", "greșit", "bug"]) {
    const ctx = context(t, `${word}: ${S25_WORDS}`);
    assert.equal(ctx.spec.workType, "BUGFIX"); assert.ok(ctx.spec.dataset);
    const brief = briefFor(ctx);
    for (const text of [brief, buildTestReviewBrief({ spec: ctx.spec, harness: 2 })]) {
      assert.ok(!text.includes(DATASET_PATTERNS_HEADING));
      assert.ok(!text.includes("Tiparele executabile sunt în secțiunea"));
      assert.equal(extractDatasetSkeleton(text), null);
    }
    const plan = datasetSkeletonPlan(ctx.spec);
    assert.deepEqual(Object.keys(plan), ["skipped"]); assert.match(plan.skipped, /FEATURE/);
    assert.deepEqual(lintDatasetBrief(brief, { spec: ctx.spec }), plan);
  }
});

test("T-BRIEF-15: quoted headings in owner words, problems and previous candidate cannot shadow the Hub section", (t) => {
  const ctx = context(t), expected = datasetSkeleton(ctx.spec.dataset, { criteria: ctx.spec.acceptance });
  for (const location of ["owner", "problems", "candidate"]) {
    const spec = structuredClone(ctx.spec), prev = previous(), problems = [];
    const quote = `quoted heading\n${DATASET_PATTERNS_HEADING}\nquoted content`;
    if (location === "owner") spec.sources.user.push(quote);
    if (location === "problems") problems.push(quote);
    if (location === "candidate") prev.text += `\n/* ${quote} */\n`;
    const brief = buildAuthorBrief({ spec, facts: ctx.facts, harness: 2, cycle: 1, authoring: spec.authoring,
      previousCandidate: prev, previousProblems: problems });
    assert.equal(extractDatasetSkeleton(brief), expected, location);
    assert.equal(lintDatasetBrief(brief, { spec, facts: ctx.facts, ...spec.authoring }).lint.ok, true, location);
    const section = datasetPatternsBrief(spec.dataset, { criteria: spec.acceptance });
    assert.equal(extractDatasetSkeleton(brief.replace(section, "")), null, "quoted headings cannot replace a missing Hub section");
    assert.equal(extractDatasetSkeleton(brief + "\n" + section), null, "duplicated Hub section fails closed");
  }
});

test("T-BRIEF-16: answer template cases exactly match the rendered skeleton manifest for five/four criteria", (t) => {
  for (const words of [S25_WORDS, S25_WORDS.replace("obligatoriu și ", "")]) {
    const ctx = context(t, words);
    for (const cycle of [0, 1]) {
      const brief = briefFor(ctx, cycle), body = extractDatasetSkeleton(brief);
      const answer = brief.split("## Răspuns obligatoriu\n")[1];
      const template = JSON.parse(answer.match(/```json\n([\s\S]*?)\n```/)[1]);
      assert.deepEqual(template.cases, datasetSkeletonManifest(ctx.spec.acceptance).cases);
      assert.deepEqual(template.cases.map((c) => c.name), [...body.matchAll(/^test\("([^"\n]+)"/gm)].map((m) => m[1]));
      assert.ok(Buffer.byteLength(datasetPatternsBrief(ctx.spec.dataset, { criteria: ctx.spec.acceptance })) <= 13 * 1024);
    }
  }
});

test("T-BRIEF-17: matrix continues after variant/probe technical stops, but stops for correct/original", () => {
  const names = ["CORRECT", "original", "original", "variant1", "variant2", "defect1", "defect2", "precondition1", "precondition2"];
  for (const badIndex of [-1, ...names.map((_, i) => i)]) {
    const result = { matrix: [], originalRuns: [], correctionProbes: { defects: [], preconditions: [] } }, calls = [];
    runCalibrationMatrix({ result, correct: "correct", source: "original", variants: { variant1: "v1", variant2: "v2" },
      probes: { defects: { defect1: "d1", defect2: "d2" }, preconditions: { precondition1: "p1", precondition2: "p2" } },
      prove: () => ({ verdict: "PROVEN" }), execute: (name, code, precondition) => {
        const bad = calls.length === badIndex; calls.push(name);
        return { name, verdict: bad ? "TECHNICAL_STOP" : precondition ? "PRECONDITION_STOP" : name === "CORRECT" ? "PASS" : "ASSERTION_REJECTION", asExpected: !bad };
      } });
    assert.deepEqual(calls, badIndex >= 0 && badIndex <= 2 ? names.slice(0, badIndex + 1) : names);
    assert.equal(result.ok, badIndex === -1);
    if (badIndex >= 3) {
      assert.equal(result.stop, undefined);
      assert.equal([...result.matrix, ...result.correctionProbes.defects, ...result.correctionProbes.preconditions].filter((r) => r.verdict === "TECHNICAL_STOP").length, 1);
    }
  }
  for (const badName of ["CORRECT", "original", "variant", "defect", "precondition"]) {
    const result = { matrix: [], originalRuns: [], correctionProbes: { defects: [], preconditions: [] } }, calls = [];
    runCalibrationMatrix({ result, variants: { variant: "v" }, probes: { defects: { defect: "d" }, preconditions: { precondition: "p" } },
      prove: () => ({ verdict: "PROVEN" }), execute: (name, code, precondition) => {
        calls.push(name);
        return { name, verdict: name === badName ? "UNEXPECTED" : precondition ? "PRECONDITION_STOP" : name === "CORRECT" ? "PASS" : "ASSERTION_REJECTION", asExpected: name !== badName };
      } });
    assert.equal(result.ok, false);
    assert.equal(calls.length, badName === "CORRECT" ? 1 : 6);
  }
});

test("T-BRIEF-18: process identity compares OS PID and CreationDate, and fails closed", () => {
  const record = { pid: 42, creationDate: "2026-10-15T10:00:00.123Z", startTimeSource: "Win32_Process.CreationDate" };
  for (const [rows, gone] of [
    [[], true], [[{ pid: 42, creationDate: record.creationDate }], false],
    [[{ pid: 42, creationDate: "2026-10-15T10:00:01.123Z" }], true],
    [[{ pid: 43, creationDate: record.creationDate }], true],
    [[{ pid: 42, creationDate: "2026-10-15T10:00:00.1230000+00:00" }], false],
  ]) assert.deepEqual(compareProcessIdentity(record, { rows, error: null }), { gone, verificationError: null });
  for (const [identity, snapshot] of [
    [record, { rows: [], error: "CIM unavailable" }],
    [{ ...record, creationDate: null }, { rows: [] }],
    [{ ...record, identityError: "initial CIM failed" }, { rows: [] }],
    [{ ...record, startTimeSource: "node.performance.timeOrigin" }, { rows: [] }],
    [record, { rows: [{ pid: 42, creationDate: "invalid" }] }],
  ]) {
    const result = compareProcessIdentity(identity, snapshot);
    assert.equal(result.gone, false); assert.ok(result.verificationError);
  }
});
