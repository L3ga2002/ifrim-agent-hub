// M11 L5 wave A (support files) — the Hub-written acceptance test, design .ifrim/M11_L5_DESIGN.md §7 "Unda A" and §8: U1 (golden),
// U2 (spec.authoring), U5 (the runners read every case), U10 (integrity), plus the stage labels, the handoff guard, the upgrade
// preflight, the league and the test-first fixture. U8 and U12 are covered by wave 0 (m11-l5-test-first.test.mjs D9/U8, U12);
// only what crosses into these files is repeated here. No model: the runners run the real `node --test` through the fake-codex
// sandbox fixture and the WSL fixture (PASS_SIMULATED).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { makeTestHub, enableLive, tempDir } from "./helpers.mjs";
import { checkSpec, normalizeSpec, specHash, AUTHORING_TEST_DIR, AUTHORING_STAGING_DIR, AUTHORING_WORK_TYPES } from "../server/factory/spec.mjs";
import { createRunCaseReader, parseTestOutput } from "../server/factory/runner.mjs";
import { integrityFindings, isTestFirstBlocking } from "../server/factory/integrity.mjs";
import { isControlPath, diffManifests, skippedTreeFingerprint, skippedTreeChanges } from "../server/factory/snapshot.mjs";
import { lastJsonBlock, parseReview, changeSetMarker } from "../server/factory/review.mjs";
import { FACTORY_STAGE_LABELS, factoryStageLabel } from "../server/policy/factory-wait.mjs";
import { FACTORY_STAGES, ACTIVE_STAGES } from "../server/factory/factory.mjs";
import { createLeague } from "../server/intel/league.mjs";
import { FACTORY_DEMOS, FIXTURE_ROOT, materializeFixture, demoSpec } from "../server/factory/fixtures.mjs";
import { syntheticProjectProblems } from "../server/delivery/capture-guard.mjs";
import { HUB_TEST_DIR, STAGING_DIR, TEST_FIRST_LIMITS, T_STAGE_LABELS, plannedTestRefs, deriveIgnore, parseTapCases } from "../server/factory/test-first.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const V2 = path.resolve(HERE, "..");
const STEP0 = ["TEST_AUTHORING", "TEST_PROVING", "TEST_REVIEW"];
const dispatch = (hub, type, payload, channel = "test") => hub.commands.dispatch({ type, payload, actor: "test", channel }).then((r) => r.result);
const made = [];
const scratch = (label) => { const d = tempDir(label); made.push(d); return d; };
test.afterEach(() => { for (const d of made.splice(0)) { try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* held */ } } });

const specInput = (name, options) => { const d = demoSpec(name, options); return { workType: d.workType, title: d.title, objective: d.objective, ...d.spec }; };

// ---------------------------------------------------------------------------------------------------------------------
// U1 / U2 — spec.authoring
// ---------------------------------------------------------------------------------------------------------------------

// specHash of checkSpec(...) computed with spec.mjs at HEAD b0883ad (before wave A), on 2026-10-07. An ordinary spec must keep
// these bytes: the hash is in every stored draft, every scope approval and every plan envelope.
const GOLDEN = {
  "bug-demo": "3d7f29003f3fd56668a2e7a28d0d77ff6d53d14a2c43df06c948eed8ff488d36",
  "service-request": "71d8d51b779ea9743dc563b81e678fa3914e7f76076892ae8e88f63581b5cd5f",
  "minimal-draft": "76db02c0aa83fbdf1f72745beaf85868be602e39d22e87a605ffe1542c16dc03",
};
const MINIMAL_DRAFT = { workType: "refactor", title: "x", objective: "scurt", acceptance: ["un criteriu"] };

test("U1 golden: an ordinary spec (and a draft with problems) is byte-identical to before wave A; authoring null/undefined adds nothing", () => {
  const inputs = { "bug-demo": specInput("bug-demo"), "service-request": specInput("service-request"), "minimal-draft": MINIMAL_DRAFT };
  for (const [name, input] of Object.entries(inputs)) {
    for (const variant of [input, { ...input, authoring: null }, { ...input, authoring: undefined }]) {
      const { spec } = checkSpec(variant);
      assert.equal(specHash(spec), GOLDEN[name], `${name}: the hash of an ordinary spec never changes`);
      assert.equal(Object.hasOwn(spec, "authoring"), false, `${name}: no authoring key unless the input carries one`);
    }
  }
});

test("U2 checkSpec: a valid authoring is normalized to a fixed shape (defaults, criterion order) and approvable", () => {
  const input = specInput("bug-demo-test-first", { projectId: "prj_u2" });
  const { spec, problems } = checkSpec(input);
  assert.deepEqual(problems, []);
  const refs = plannedTestRefs({ projectId: "prj_u2", workType: "BUGFIX", objective: input.objective, title: input.title });
  assert.deepEqual(spec.authoring, { mode: "hub", testRef: refs.testRef, stagingRef: refs.stagingRef, criteria: ["AC-1"], reauthorMax: 1, proofRuns: 2, controls: "bugfix", author: "claude", testReviewer: "codex" });
  assert.deepEqual(spec.verification.acceptance, [`node --test ${refs.testRef}`]);
  assert.ok(normalizeSpec(input).authoring);
  // Only the four required keys: the defaults give the same normalized spec, so the same hash; unknown keys are dropped.
  const minimal = { ...input, authoring: { mode: "hub", testRef: refs.testRef, stagingRef: refs.stagingRef, criteria: ["ac-1", "AC-1"], extra: "x" } };
  assert.equal(specHash(checkSpec(minimal).spec), specHash(spec));
  // A revision through checkSpec reproduces the exact spec (stored drafts are re-checked on every revision).
  assert.equal(specHash(checkSpec(JSON.parse(JSON.stringify(spec))).spec), specHash(spec));
  // FEATURE: controls default to "none".
  const feature = checkSpec({ ...input, workType: "FEATURE", authoring: { ...input.authoring, controls: undefined } });
  assert.deepEqual(feature.problems, []);
  assert.equal(feature.spec.authoring.controls, "none");
  assert.deepEqual([...AUTHORING_WORK_TYPES], ["BUGFIX", "FEATURE"]);
});

test("U2 checkSpec: refuses REFACTOR, a wrong testRef, unequal depths, '.test.' in staging, extra acceptance commands and a role swap", () => {
  const input = specInput("bug-demo-test-first", { projectId: "prj_u2" });
  const a = input.authoring;
  const refused = (patch, re, label) => {
    const { problems } = checkSpec({ ...input, ...patch });
    assert.ok(problems.some((p) => re.test(p)), `${label}: ${JSON.stringify(problems)}`);
  };
  refused({ workType: "REFACTOR" }, /doar pentru BUGFIX \/ FEATURE/, "refactor");
  const outside = "test/x.test.mjs";
  refused({ authoring: { ...a, testRef: outside }, acceptance: input.acceptance.map((c) => (c.verify === "test" ? { ...c, testRef: outside } : c)), verification: { ...input.verification, acceptance: [`node --test ${outside}`] } },
    /authoring\.testRef/, "testRef outside test/hub");
  refused({ authoring: { ...a, stagingRef: ".ifrim-hub/x.mjs" } }, /aceeași adâncime/, "unequal depth");
  refused({ authoring: { ...a, stagingRef: a.stagingRef.replace(/\.mjs$/, ".test.mjs") } }, /nu conține „\.test\.”/, ".test. in staging");
  refused({ authoring: { ...a, stagingRef: ".ifrim-hub/staging/alt-nume.mjs" } }, /același nume/, "different stems");
  refused({ verification: { ...input.verification, acceptance: [...input.verification.acceptance, "node --test test/unit.test.mjs"] } }, /exact „node --test/, "extra acceptance command");
  refused({ acceptance: input.acceptance.map((c) => (c.verify === "test" ? { ...c, testRef: "test/unit.test.mjs" } : c)) }, /AC-1: criteriile verificate prin test numesc testul scris de Hub/, "criterion naming another test");
  refused({ authoring: { ...a, criteria: [] } }, /acoperă toate criteriile/, "criteria missing");
  refused({ authoring: { ...a, criteria: ["AC-1", "AC-2"] } }, /AC-2 nu sunt criterii verificate prin test/, "a review criterion listed");
  refused({ authoring: { ...a, mode: "owner" } }, /authoring\.mode/, "mode");
  refused({ authoring: { ...a, author: "codex" } }, /testul îl scrie Claude/, "the implementer writes its own test");
  refused({ authoring: { ...a, testReviewer: "claude" } }, /testul îl verifică Codex/, "the author reviews its own test");
  refused({ authoring: { ...a, controls: "none" } }, /„bugfix” pentru BUGFIX/, "no controls on a bugfix");
  refused({ authoring: { ...a, proofRuns: 1 } }, /exact 2 rulări/, "one proof run");
  refused({ authoring: { ...a, reauthorMax: 2 } }, /între 0 și 1/, "two re-authorings");
  refused({ authoring: ["x"] }, /trebuie să fie un obiect/, "not an object");
  // A non-integer is reported and stored as null (NaN is not JSON), so the next revision still reports it.
  const odd = checkSpec({ ...input, authoring: { ...a, reauthorMax: 0.5 } });
  assert.equal(odd.spec.authoring.reauthorMax, null);
  assert.ok(checkSpec(JSON.parse(JSON.stringify({ ...input, authoring: odd.spec.authoring }))).problems.some((p) => /reauthorMax/.test(p)));
});

test("U2 spec ↔ test-first: the same directories, and every path plannedTestRefs makes (long, diacritics, suffix) passes checkSpec", () => {
  assert.equal(AUTHORING_TEST_DIR, HUB_TEST_DIR);
  assert.equal(AUTHORING_STAGING_DIR, STAGING_DIR);
  assert.equal(TEST_FIRST_LIMITS.reauthorMax, 1);
  assert.equal(TEST_FIRST_LIMITS.proofRuns, 2);
  const base = specInput("bug-demo-test-first");
  for (const title of ["Adaugă un test de acceptanță pentru numele din spații", "Ștergerea țărilor în aplicația de rezervări pe telefon mobil foarte lung", "!!!"]) {
    const first = plannedTestRefs({ projectId: "prj_x", workType: "BUGFIX", objective: base.objective, title });
    const taken = plannedTestRefs({ projectId: "prj_x", workType: "BUGFIX", objective: base.objective, title }, { existing: [first.testRef] });
    for (const refs of [first, taken]) {
      const input = { ...base, acceptance: base.acceptance.map((c) => (c.verify === "test" ? { ...c, testRef: refs.testRef } : c)),
        verification: { ...base.verification, acceptance: [`node --test ${refs.testRef}`] }, authoring: { ...base.authoring, testRef: refs.testRef, stagingRef: refs.stagingRef } };
      assert.deepEqual(checkSpec(input).problems, [], `${title} → ${refs.testRef}`);
    }
    assert.match(taken.testRef, /-2\.test\.mjs$/);
  }
  // U12 across files: what deriveIgnore keeps, the spec accepts (and the folders the spec refuses never come out of it).
  const ignore = deriveIgnore("data/\nnode_modules/\nsrc/\n.ifrim-hub/\n/tmp-run/\n");
  assert.deepEqual(ignore, ["data", "tmp-run"]);
  const withIgnore = checkSpec({ ...base, workspace: { ignore } });
  assert.deepEqual(withIgnore.problems, []);
  assert.deepEqual(withIgnore.spec.workspace.ignore, ignore);
});

test("U2 checkSpec (repair, review state #6 / security #10): a workspace.ignore that covers the Hub's work area or the Hub-written test is refused", () => {
  const input = specInput("bug-demo-test-first", { projectId: "prj_u2" });
  for (const ignore of [[".ifrim-hub"], [".ifrim-hub/staging"], [".IFRIM-HUB/staging/x"], ["test/hub"], ["test/hub/old"]]) {
    const { problems } = checkSpec({ ...input, workspace: { ignore } });
    assert.ok(problems.some((p) => /acoperă zona de lucru a Hub-ului sau testul scris de Hub/.test(p)), `${ignore}: ${JSON.stringify(problems)}`);
  }
  // Runtime data folders stay allowed; an ordinary spec is not concerned (its hash is the golden one, U1).
  assert.deepEqual(checkSpec({ ...input, workspace: { ignore: ["data", ".ifrim-hubx", "test-data"] } }).problems, []);
  assert.deepEqual(checkSpec({ ...specInput("bug-demo"), workspace: { ignore: [".ifrim-hub"] } }).problems, []);
});

test("skippedTreeFingerprint (repair, security #7): writes under dependency/build/cache folders and .git hooks are seen; git's own files and ignored data are not", () => {
  const dir = scratch("l5-skipped-tree");
  const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
  write("src/a.js", "export const a = 1;\n");
  write("node_modules/pkg/index.js", "module.exports = 1;\n");
  write("packages/x/node_modules/dep/index.js", "1\n");
  write(".git/index", "index-1");
  write(".git/hooks/pre-commit.sample", "#!/bin/sh\n");
  write("data/db.sqlite", "1");
  const before = skippedTreeFingerprint(dir, { ignore: ["data"] });
  assert.equal(before.truncated, false);
  assert.ok(Object.hasOwn(before.entries, "node_modules/pkg/index.js") && Object.hasOwn(before.entries, "packages/x/node_modules/dep/index.js"));
  assert.ok(!Object.keys(before.entries).some((k) => k.startsWith("src/") || k.startsWith("data/") || k === ".git/index"), JSON.stringify(Object.keys(before.entries)));
  // Not a change: git rewriting its index, the regular tree (the snapshot sees it), ignored runtime data.
  write(".git/index", "index-2-longer");
  write("src/b.js", "x\n");
  write("data/db.sqlite", "22");
  assert.deepEqual(skippedTreeChanges(before, skippedTreeFingerprint(dir, { ignore: ["data"] })), []);
  // A change: a file planted in node_modules (also nested), a new git hook, a new cache folder.
  write("node_modules/pkg/index.js", "module.exports = 2; // planted\n");
  write("packages/x/node_modules/dep/extra.js", "x\n");
  write(".git/hooks/pre-commit", "#!/bin/sh\necho planted\n");
  write(".cache/x", "1");
  const changed = skippedTreeChanges(before, skippedTreeFingerprint(dir, { ignore: ["data"] }));
  for (const rel of ["node_modules/pkg/index.js", "packages/x/node_modules/dep/extra.js", ".git/hooks/pre-commit", ".cache", ".cache/x"]) assert.ok(changed.includes(rel), `${rel} in ${changed}`);
  // Bounded: over maxEntries only the paths both sides recorded are compared.
  const small = skippedTreeFingerprint(dir, { ignore: ["data"], maxEntries: 2 });
  assert.equal(small.truncated, true);
  assert.equal(Object.keys(small.entries).length, 2);
});

// ---------------------------------------------------------------------------------------------------------------------
// U5 — the runners read every case
// ---------------------------------------------------------------------------------------------------------------------

/** 20 failing deepEqual cases: far more TAP than the runner's 300-line tail. */
const manyFailing = (n = 20) => ['import test from "node:test";', 'import assert from "node:assert/strict";',
  ...Array.from({ length: n }, (_, k) => `test("AC-1: caz ${k}", () => { assert.deepEqual({ ok: true, errors: { name: "x", email: "y", service: "z" }, id: ${k} }, { ok: false, errors: { name: "Numele este obligatoriu" }, id: ${k} }); });`), ""].join("\n");

test("U5 createRunCaseReader: every pushed line counts, the stderr tail is read too, the result is additive", () => {
  const reader = createRunCaseReader();
  const tap = ["TAP version 13", "# Subtest: AC-1: a", "not ok 1 - AC-1: a", "  ---", "  duration_ms: 1", "  failureType: 'testCodeFailure'", "  error: 'nu'", "  code: 'ERR_ASSERTION'", "  name: 'AssertionError'", "  ...",
    "# Subtest: AC-1 control: b", "ok 2 - AC-1 control: b", "1..2", "# tests 2", "# pass 1", "# fail 1"];
  for (const line of tap) reader.push(line);
  const out = reader.finish([]);
  assert.deepEqual(Object.keys(out).sort(), ["cases", "fileLevelFailure", "overflow"]);
  assert.deepEqual(out.cases.map((c) => [c.name, c.ok]), [["AC-1: a", false], ["AC-1 control: b", true]]);
  assert.equal(out.cases[0].code, "ERR_ASSERTION");
  assert.equal(out.fileLevelFailure, null);
  assert.equal(out.overflow, 0);
  assert.deepEqual(out.cases, parseTapCases(tap).cases, "one parser: the same cases as the wave-0 reader");
  // The counts stay the runner's own summary.
  assert.equal(parseTestOutput(tap).counts.tests, 2);
});

test("U5 Windows runner (fake-codex sandbox, real node --test): 20 failing cases are all in `cases` although the tail keeps only 300 lines", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    const dir = path.join(t.dataDir, "factory-u5");
    materializeFixture("bug-demo", dir);
    fs.writeFileSync(path.join(dir, "test", "many.test.mjs"), manyFailing());
    const project = await dispatch(hub, "project.register_test", { path: dir });
    const result = await hub.factoryRunner.run({ key: "u5-win", ws: dir, command: "node --test test/many.test.mjs", project });
    assert.equal(result.status, "FAIL", JSON.stringify({ ...result, outputTail: result.outputTail.slice(-400) }));
    assert.equal(result.counts.tests, 20, "the counts come from the runner's own summary");
    assert.equal(result.cases.length, 20, "every case, read before the tail window dropped its lines");
    assert.ok(result.cases.every((c) => !c.ok && c.code === "ERR_ASSERTION"));
    assert.equal(result.overflow, 0);
    assert.equal(result.fileLevelFailure, null);
    assert.ok(parseTapCases(result.outputTail).cases.length < 20, "the evidence tail alone could never have matched # tests");
    const passing = await hub.factoryRunner.run({ key: "u5-win-2", ws: dir, command: "node --test test/unit.test.mjs", project });
    assert.equal(passing.status, "PASS");
    assert.equal(passing.cases.length, passing.counts.tests);
    // A command that never ran still carries the additive fields (empty), never undefined.
    const refused = await hub.factoryRunner.run({ key: "u5-win-3", ws: dir, command: "node evil.js", project });
    assert.equal(refused.status, "BLOCKED");
    assert.deepEqual([refused.cases, refused.fileLevelFailure, refused.overflow], [[], null, 0]);
  } finally { await t.cleanup(); }
});

test("U5 WSL runner (environment fixture): the same additive fields, read from every stdout line", async () => {
  const t = await makeTestHub({ wsl: true });
  try {
    const { hub } = t;
    await dispatch(hub, "environment.inspect", { environmentId: "wsl-runner" });
    await dispatch(hub, "environment.probe", { environmentId: "wsl-runner" });
    await dispatch(hub, "environment.attest", { environmentId: "wsl-runner" });
    await enableLive(hub, { provider: "codex", access: "workspace-write", attempts: 1 });
    const root = path.join(t.dataDir, "factory-u5-wsl");
    materializeFixture("bug-demo", root);
    const project = await dispatch(hub, "project.register_test", { path: root });
    await dispatch(hub, "project.environment.set", { projectId: project.id, environment: "wsl-runner" });
    // TAP for 20 failing cases, each with a long YAML block (as node prints a deepEqual diff).
    const lines = ["TAP version 13"];
    for (let k = 1; k <= 20; k += 1) {
      lines.push(`# Subtest: AC-1: caz ${k}`, `not ok ${k} - AC-1: caz ${k}`, "  ---", "  duration_ms: 1.1", "  failureType: 'testCodeFailure'", "  error: |-",
        ...Array.from({ length: 14 }, (_, i) => `    linia ${i} din diferență`), "  code: 'ERR_ASSERTION'", "  name: 'AssertionError'", "  ...");
    }
    lines.push("1..20", "# tests 20", "# pass 0", "# fail 20");
    assert.ok(lines.length > 400);
    t.wslState({ sandboxOutput: `${lines.join("\n")}\n`, sandboxExit: 1 });
    const result = await hub.factoryRunner.run({ key: "u5-wsl", ws: root, command: "node --test test/unit.test.mjs", project });
    assert.equal(result.runner, "codex-sandbox@wsl-runner");
    assert.equal(result.status, "FAIL", JSON.stringify({ ...result, outputTail: "" }));
    assert.equal(result.counts.tests, 20);
    assert.equal(result.cases.length, 20);
    assert.ok(result.cases.every((c) => c.code === "ERR_ASSERTION" && c.errorName === "AssertionError"));
    assert.equal(result.overflow, 0);
  } finally { await t.cleanup(); }
});

// ---------------------------------------------------------------------------------------------------------------------
// U10 — integrity
// ---------------------------------------------------------------------------------------------------------------------

test("U10 integrity: test_detection_added (critical) when product code names the protected test or an acceptance case", () => {
  const ref = "test/hub/numele-din-spatii-trebuie-a1b2c3.test.mjs";
  // A test-first mission whose Hub-written test is protected (the factory passes hubTest only then; ordinary missions: see below).
  const find = (added, refs = [ref]) => integrityFindings({ changes: [], added, protectedRefs: refs, hubTest: { refs: [ref], loads: ["src/requests.js"] } });
  const codes = (added, refs) => find(added, refs).map((f) => `${f.severity}:${f.code}`);
  assert.deepEqual(codes([{ path: "src/requests.js", line: 'if (import.meta.url.includes("numele-din-spatii-trebuie-a1b2c3.test")) return { ok: false };' }]), ["critical:test_detection_added"]);
  assert.deepEqual(codes([{ path: "src/requests.js", line: `const p = "${ref.toUpperCase()}";` }]), ["critical:test_detection_added"], "case-insensitive path");
  assert.deepEqual(codes([{ path: "src\\requests.js", line: 'const p = "test\\\\hub\\\\numele-din-spatii-trebuie-a1b2c3.test.mjs";' }]), ["critical:test_detection_added"], "Windows separators");
  assert.deepEqual(codes([{ path: "src/requests.js", line: 'if (globalThis.currentTest?.startsWith("AC-1:")) return true;' }]), ["critical:test_detection_added"], "an acceptance case name, even with no protected file");
  assert.deepEqual(codes([{ path: "src/requests.js", line: 'const n = "AC-2 control: ok";' }], []), ["critical:test_detection_added"]);
  assert.deepEqual(codes([{ path: "public/index.html", line: '<script>if (location.hash === "#AC-1:") ok();</script>' }]), ["critical:test_detection_added"]);
  assert.deepEqual(codes([{ path: "config/data.json", line: '"skipFor": "numele-din-spatii-trebuie-a1b2c3.test.mjs"' }]), ["critical:test_detection_added"]);
  // Not detection: the tests themselves, docs, a whole-line comment citing a criterion, an unrelated name.
  assert.deepEqual(codes([{ path: "test/regresie.test.mjs", line: 'test("AC-1: din nou", () => {});' }]), []);
  assert.deepEqual(codes([{ path: "README.md", line: "AC-1: numele din spații e refuzat (vezi test/hub/numele-din-spatii-trebuie-a1b2c3.test.mjs)" }]), []);
  assert.deepEqual(codes([{ path: "src/requests.js", line: "  // AC-1: spațiile nu sunt un nume" }, { path: "app.py", line: "# AC-1: idem" }]), []);
  assert.deepEqual(codes([{ path: "src/requests.js", line: 'const name = String(input.name ?? "").trim(); // AC-1' }]), [], "AC-1 without the case colon is not a case name");
  assert.deepEqual(codes([{ path: "src/requests.js", line: 'const acceptance = "test";' }]), []);
});

// Wave A repair — review state #4 / security #2, #6: the rules read the CODE part of a line (comments removed, strings kept), a
// package.json script is never a stop, and ordinary missions keep their pre-L5 stops (medium only).
test("U10 integrity (repair): comments are removed before matching — a trailing comment is harmless, code after a comment is not", () => {
  const ref = "test/hub/numele-din-spatii-trebuie-a1b2c3.test.mjs";
  const strict = { refs: [ref], loads: ["src/requests.js"] };
  const codes = (added, extra = {}) => integrityFindings({ changes: [], added, protectedRefs: [ref], hubTest: strict, ...extra }).map((f) => `${f.severity}:${f.code}`);
  // A trailing comment citing a criterion (review state #4: was critical) and a URL inside a string followed by a comment.
  assert.deepEqual(codes([{ path: "src/requests.js", line: "return { ok: false }; // AC-1: blank names refused" }]), []);
  assert.deepEqual(codes([{ path: "src/requests.js", line: 'const u = "http://localhost/x"; // AC-1: x' }]), []);
  // Code after an inline block comment is checked (security #2: was skipped as a "comment line").
  assert.deepEqual(codes([{ path: "src/requests.js", line: '/**/ if (process.env.NODE_ENV === "test") return true;' }]), ["high:test_switch_added"]);
  assert.deepEqual(codes([{ path: "src/requests.js", line: '/* x */ const hit = process.argv.some((a) => a.includes("numele-din-spatii-trebuie-a1b2c3.test"));' }]), ["critical:test_detection_added"]);
  // A string that names a case is code (only comments are removed).
  assert.deepEqual(codes([{ path: "src/requests.js", line: 'throw new Error("AC-1: blank");' }]), ["critical:test_detection_added"]);
  // With the file's text (what the factory passes): a docblock line opened on an earlier, unchanged line is a comment, even with no
  // leading "*"; a line that merely starts with "*" outside any comment (a continued expression) is code.
  const file = ["/**", " * AC-1: spațiile nu sunt un nume", "   continuarea fără steluță: AC-1: idem", " */", "const w = 2", "  * (process.argv.length > 2 ? 0 : 1);", ""].join("\n");
  const texts = { "src/requests.js": file };
  assert.deepEqual(codes([{ path: "src/requests.js", line: " * AC-1: spațiile nu sunt un nume" }, { path: "src/requests.js", line: "   continuarea fără steluță: AC-1: idem" }], { texts }), []);
  assert.deepEqual(codes([{ path: "src/requests.js", line: "  * (process.argv.length > 2 ? 0 : 1);" }], { texts }), ["high:test_switch_added"]);
  // Without the text (a direct caller) a lone "* …" line is lexed alone, as code: fail closed.
  assert.deepEqual(codes([{ path: "src/requests.js", line: " * AC-1: idem" }]), ["critical:test_detection_added"]);
  // package.json: a script naming the protected test is medium (a script line cannot recognise the test at run time).
  assert.deepEqual(codes([{ path: "package.json", line: `"test": "node --test test/unit.test.mjs ${ref}"` }]), ["medium:test_detection_added"]);
});

test("U10 integrity (repair): an ordinary mission (no Hub-written test) gets the product-code rules as medium only — never a new stop", () => {
  const codes = (added) => integrityFindings({ changes: [], added, protectedRefs: ["test/acceptance.test.mjs"] }).map((f) => `${f.severity}:${f.code}`);
  assert.deepEqual(codes([{ path: "src/a.js", line: 'if (process.env.NODE_ENV === "production") log.level = "warn";' }]), ["medium:test_switch_added"]);
  assert.deepEqual(codes([{ path: "package.json", line: '"test": "node --test test/unit.test.mjs test/acceptance.test.mjs"' }]), ["medium:test_detection_added"]);
  assert.deepEqual(codes([{ path: "src/a.js", line: 'const label = "AC-1: ok";' }]), ["medium:test_detection_added"]);
  assert.deepEqual(codes([{ path: "src/a.js", line: 'import assert from "node:assert";' }]), ["medium:test_harness_tampered"]);
  // The pre-L5 rules keep their severities (a skip in a test is still high; a medium detection never hides it).
  assert.deepEqual(codes([{ path: "src/test/helper.js", line: 'test.skip("AC-1: x", () => {});' }]), ["high:skip_added"]);
  assert.equal(integrityFindings({ changes: [], added: [{ path: "src/a.js", line: "process.exit(0);" }], protectedRefs: [] }).filter((f) => f.severity === "critical" || f.severity === "high").length, 0);
});

test("U10 integrity (repair): node:assert, built-ins, globals and the process are guarded in source files (security #1)", () => {
  const strict = { refs: ["test/hub/x-a1b2c3.test.mjs"], loads: ["src/x.js"] };
  const codes = (path, line) => integrityFindings({ changes: [], added: [{ path, line }], protectedRefs: strict.refs, hubTest: strict }).map((f) => `${f.severity}:${f.code}`);
  // The reported bypass: product code imports node:assert/strict and neuters its methods; the test loads that module → critical.
  assert.deepEqual(codes("src/x.js", 'import assert from "node:assert/strict";'), ["critical:test_harness_tampered"]);
  assert.deepEqual(codes("src/x.js", 'for (const k of ["equal", "ok"]) assert[k] = () => {};'), ["critical:test_harness_tampered"]);
  assert.deepEqual(codes("src/other.js", 'const assert = require("assert");'), ["high:test_harness_tampered"], "not loaded by the test: high");
  for (const line of ["Math.random = () => 0.5;", "Date.now = () => 0;", "Array.prototype.includes = () => true;", "globalThis.fetch = fake;", "Object.defineProperty(globalThis, \"x\", { value: 1 });",
    "process.exitCode = 0;", "process.exit(0);", "process.on(\"exit\", () => {});", "x.__proto__ = y;"]) {
    assert.deepEqual(codes("src/other.js", line), ["high:test_harness_tampered"], line);
  }
  // Ordinary code is not tampering.
  for (const line of ["Object.defineProperty(exports, \"__esModule\", { value: true });", "const out = Object.assign({}, a, b);", "items.push(x);", "const ok = value === other;"]) {
    assert.deepEqual(codes("src/other.js", line), [], line);
  }
});

test("U10 integrity (repair): more 'how am I run' signals, nested test folders are product code, imports from the tests are flagged (security #3, #4)", () => {
  const strict = { refs: ["test/hub/x-a1b2c3.test.mjs"], loads: [] };
  const codes = (path, line) => integrityFindings({ changes: [], added: [{ path, line }], protectedRefs: strict.refs, hubTest: strict }).map((f) => `${f.severity}:${f.code}`);
  for (const line of ["const c = process.env.NODE_TEST_CONTEXT;", 'const t = process.execArgv.some((a) => a.startsWith("--test"));', "if (process.env.CI) return true;", 'const v = process["arg" + "v"];',
    "if (require.main !== module) return;", "const m = process.mainModule;", 'if (new Error().stack.includes("test" + "/hub")) return 1;']) {
    assert.deepEqual(codes("src/x.js", line), ["high:test_switch_added"], line);
  }
  // Only top-level test folders and test-named files are tests: src/test/ and src/__tests__/ helpers are product code.
  assert.deepEqual(codes("src/test/env.js", 'export const underTest = process.env.NODE_ENV === "test";'), ["high:test_switch_added"]);
  assert.deepEqual(codes("src/__tests__/env.js", 'export const hit = process.argv.join().includes("x-a1b2c3.test");'), ["critical:test_detection_added"]);
  assert.deepEqual(codes("src/__tests__/env.test.js", 'test("AC-1: x", () => {});'), [], "a test-named file is a test");
  for (const line of ['import { underTest } from "./test/env.js";', 'const h = require("../tests/helpers.js");', 'const m = await import("./x.spec.js");', 'import x from "../.ifrim-hub/staging/x.mjs";']) {
    assert.deepEqual(codes("src/x.js", line), ["high:product_imports_test"], line);
  }
  assert.deepEqual(codes("src/x.js", 'import { latest } from "./contest.js";'), []);
});

test("U10 integrity (repair): a code file the Hub cannot read as text is code_not_reviewable (security #5)", () => {
  const strict = { refs: ["test/hub/x-a1b2c3.test.mjs"], loads: ["src/x.js"] };
  const changes = diffManifests({ "src/x.js": { sha256: "a".repeat(64), size: 1, text: true } },
    { "src/x.js": { sha256: "b".repeat(64), size: 2, text: false }, "src/y.mjs": { sha256: "c".repeat(64), size: 2, text: false }, "assets/logo.png": { sha256: "d".repeat(64), size: 2, text: false } });
  const texts = { "src/x.js": null, "src/y.mjs": null, "assets/logo.png": null };
  const found = (hubTest) => integrityFindings({ changes, added: [], protectedRefs: [], hubTest, texts }).map((f) => `${f.severity}:${f.code}:${f.file}`).sort();
  assert.deepEqual(found(strict), ["critical:code_not_reviewable:src/x.js", "high:code_not_reviewable:src/y.mjs"], "loaded by the protected test: critical; a picture is not code");
  assert.deepEqual(found(null), ["medium:code_not_reviewable:src/x.js", "medium:code_not_reviewable:src/y.mjs"]);
  assert.deepEqual(integrityFindings({ changes, added: [], protectedRefs: [] }), [], "without the texts (a direct caller) nothing is assumed");
  assert.ok(isTestFirstBlocking({ severity: "high", code: "code_not_reviewable" }) && !isTestFirstBlocking({ severity: "medium", code: "test_switch_added" }) && !isTestFirstBlocking({ severity: "high", code: "skip_added" }));
  // As the factory stores it: the display code is "I-001", the rule is in the fingerprint.
  assert.ok(isTestFirstBlocking({ severity: "high", code: "I-001", fingerprint: "integrity:test_switch_added:src/a.js" }));
  assert.ok(!isTestFirstBlocking({ severity: "high", code: "I-002", fingerprint: "integrity:skip_added:test/a.test.mjs" }));
});

test("U10 integrity: test_switch_added (high on a test-first mission) when a source file starts reading how it is run", () => {
  const codes = (added) => integrityFindings({ changes: [], added, protectedRefs: [], hubTest: { refs: [], loads: [] } }).map((f) => `${f.severity}:${f.code}`);
  for (const line of ['if (process.env.NODE_ENV === "test") return { ok: false };', 'import { test } from "node:test";', "const argv = process.argv.slice(2);", 'const a = process?.["argv"];', "const a = process?.argv;"]) {
    assert.deepEqual(codes([{ path: "src/requests.js", line }]), ["high:test_switch_added"], line);
  }
  assert.deepEqual(codes([{ path: "lib/x.ts", line: "const mode = process.env.NODE_ENV;" }]), ["high:test_switch_added"]);
  // Tests, non-source files and whole-line comments are not product code.
  assert.deepEqual(codes([{ path: "test/a.test.mjs", line: 'import { test } from "node:test";' }]), []);
  assert.deepEqual(codes([{ path: "Dockerfile", line: "ENV NODE_ENV=production" }, { path: "src/x.js", line: "// NODE_ENV nu e citit aici" }]), []);
  // A review PASS with this open finding is not a valid PASS (BLOCKING_SEVERITIES: critical, high).
  const sha = "a".repeat(64);
  const answer = `${changeSetMarker(sha)}\n\`\`\`json\n${JSON.stringify({ changeSet: sha.slice(0, 12), verdict: "PASS", summary: "ok", findings: [{ severity: "high", file: "src/requests.js", observation: "NODE_ENV", evidence: "x", impact: "y" }], missing: [], criteria: [] })}\n\`\`\``;
  const parsed = parseReview(answer, { changeSetSha: sha, criteria: [] });
  assert.notEqual(parsed.status, "VALID", JSON.stringify(parsed).slice(0, 300));
});

test("U10 integrity: the Hub's .ifrim-hub/ work area is a control path; a writer creating or changing it is critical", () => {
  for (const rel of [".ifrim-hub/staging/x.mjs", ".IFRIM-HUB/staging/x.mjs", ".ifrim-hub/anything"]) assert.equal(isControlPath(rel), true, rel);
  for (const rel of [".ifrim-hub-test.json", "src/.ifrim-hub/x", "ifrim-hub/x", ".ifrim-hubx/y"]) assert.equal(isControlPath(rel), rel === ".ifrim-hub-test.json", rel);
  const changes = diffManifests({}, { ".ifrim-hub/staging/x.mjs": { sha256: "b".repeat(64), size: 1 } });
  assert.equal(changes[0].controlFile, true);
  assert.deepEqual(integrityFindings({ changes, added: [], protectedRefs: [] }).map((f) => `${f.severity}:${f.code}`), ["critical:control_file_changed"]);
});

test("review.lastJsonBlock is exported: the LAST ```json block, raw, or null", () => {
  assert.equal(lastJsonBlock("a ```json\n{\"x\":1}\n``` b ```json\n{\"x\":2}\n```").trim(), '{"x":2}');
  assert.equal(lastJsonBlock("fără bloc"), null);
  assert.equal(lastJsonBlock(null), null);
});

// ---------------------------------------------------------------------------------------------------------------------
// Stage labels, handoff, upgrade, league
// ---------------------------------------------------------------------------------------------------------------------

test("FACTORY_STAGE_LABELS: a Romanian label for every factory stage and for step 0; an unknown stage never shows raw", () => {
  for (const stage of new Set([...FACTORY_STAGES, ...STEP0, ...ACTIVE_STAGES])) {
    assert.ok(typeof FACTORY_STAGE_LABELS[stage] === "string" && FACTORY_STAGE_LABELS[stage].length > 1, stage);
    assert.notEqual(FACTORY_STAGE_LABELS[stage], stage.toLowerCase());
  }
  for (const stage of STEP0) assert.equal(FACTORY_STAGE_LABELS[stage], T_STAGE_LABELS[stage], "the same words as wave 0's texts");
  assert.deepEqual(STEP0.map((s) => FACTORY_STAGE_LABELS[s]), ["Testul (pasul 0)", "Proba testului", "Verificarea testului"]);
  assert.equal(factoryStageLabel("IMPLEMENTING"), "Implementare");
  for (const odd of ["E2E", "toString", "__proto__", null, undefined, ""]) assert.equal(factoryStageLabel(odd), "Etapă necunoscută", String(odd));
  assert.ok(Object.isFrozen(FACTORY_STAGE_LABELS));
});

test("handoff: the guard uses the factory's own ACTIVE_STAGES (no copied list)", () => {
  const src = fs.readFileSync(path.join(V2, "server", "runtime", "handoff.mjs"), "utf8");
  assert.match(src, /import \{ ACTIVE_STAGES \} from "\.\.\/factory\/factory\.mjs";/);
  assert.match(src, /ACTIVE_STAGES\.has\(factoryMission\.stage\)/);
  assert.doesNotMatch(src, /\["BASELINE", "IMPLEMENTING"/, "the old copied list is gone");
});

test("I12 handoff: a step-0 conversation (the test author's or the test reviewer's) of an active mission refuses a manual handoff", async () => {
  const t = await makeTestHub({ queues: true });
  try {
    const { hub } = t;
    const dir = path.join(t.dataDir, "factory-i12");
    materializeFixture("bug-demo", dir);
    const project = await dispatch(hub, "project.register_test", { path: dir });
    const { mission } = await dispatch(hub, "factory.prepare", { projectId: project.id, ...demoSpec("bug-demo"), limits: { writerModel: "gpt-fake-sol", reviewerModel: "sonnet" } });
    const author = hub.bus.transaction(() => hub.conversations.create({ projectId: project.id, title: "Test · autor" }, "test"));
    const reviewer = hub.bus.transaction(() => hub.conversations.create({ projectId: project.id, title: "Review test · i12" }, "test"));
    const other = hub.bus.transaction(() => hub.conversations.create({ projectId: project.id, title: "Altceva" }, "test"));
    // What the factory agent's start will record (wave A): the two step-0 conversations in protected_json.authoring.
    hub.db.prepare("UPDATE factory_specs SET protected_json = ? WHERE mission_id = ?")
      .run(JSON.stringify({ problems: [], files: {}, authoring: { authorConversationId: author.id, testReviewConversationId: reviewer.id } }), mission.id);
    const setStage = (stage) => hub.db.prepare("UPDATE factory_missions SET stage = ? WHERE mission_id = ?").run(stage, mission.id);
    // An active stage that exists today (the step-0 stages become active with the factory agent's change; the guard follows the set).
    setStage("BASELINE");
    for (const conv of [author, reviewer]) {
      await assert.rejects(dispatch(hub, "handoff.begin", { conversationId: conv.id, toProvider: "claude" }), /etapa BASELINE.*pauză sau oprește/, conv.title);
    }
    // An unrelated conversation of the same project is not the mission's.
    const free = await dispatch(hub, "handoff.begin", { conversationId: other.id, toProvider: "claude" });
    assert.ok(free.id);
    await dispatch(hub, "handoff.cancel", { handoffId: free.id });
    // Paused: the handoff is no longer refused for the factory reason.
    setStage("PAUSED");
    const paused = await dispatch(hub, "handoff.begin", { conversationId: author.id, toProvider: "claude" });
    assert.ok(paused.id);
    await dispatch(hub, "handoff.cancel", { handoffId: paused.id });
  } finally { await t.cleanup(); }
});

test("upgrade preflight: its literal stage list covers ACTIVE_STAGES, step 0 and CANCEL_REQUESTED; 'E2E' is not a mission stage", () => {
  const src = fs.readFileSync(path.join(V2, "scripts", "upgrade.mjs"), "utf8");
  const literal = src.match(/const ACTIVE = new Set\((\[[^\]]*\])\);/);
  assert.ok(literal, "the preflight set is a literal (the live Hub may run an older version)");
  const stages = JSON.parse(literal[1]);
  for (const stage of [...ACTIVE_STAGES, ...STEP0, "CANCEL_REQUESTED"]) assert.ok(stages.includes(stage), stage);
  assert.equal(stages.includes("E2E"), false);
  assert.equal(FACTORY_STAGES.includes("E2E"), false, "E2E is an evidence stage, never a mission's");
  for (const stage of stages) assert.ok(FACTORY_STAGES.includes(stage) || STEP0.includes(stage), `${stage} is a real stage`);
});

test("league: the first CODE review of a mission ignores the review of the Hub-written test (change_set_id 'acceptance:%')", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE factory_reviews (mission_id TEXT, change_set_id TEXT NOT NULL, verdict TEXT, created_at TEXT)");
  const insert = db.prepare("INSERT INTO factory_reviews VALUES (?, ?, ?, ?)");
  insert.run("m1", "acceptance:0123456789ab", "PASS", "2026-10-07T10:00:00Z");
  insert.run("m1", "cs_1", "CHANGES_REQUESTED", "2026-10-07T10:10:00Z");
  insert.run("m1", "cs_2", "PASS", "2026-10-07T10:20:00Z");
  insert.run("m2", "acceptance:ba9876543210", "PASS", "2026-10-07T09:00:00Z");
  const runs = [{ id: "r1", mission_id: "m1" }, { id: "r2", mission_id: "m2" }].map((r) => ({ provider: "codex", model: "gpt-x", effort: "medium", status: "completed", error_category: null, started_at: null, finished_at: null,
    usage_json: "{}", skill_versions_json: "[]", environment: "windows", stage: "IMPLEMENTING", work_type: "BUGFIX", repair_cycles: 1, mission_stage: "DELIVERY_READY", project_source: "hub-test", ...r }));
  // The league's real SQL for factory_reviews runs on a real table; its other queries get fixed rows.
  const fake = { prepare: (sql) => (/FROM factory_reviews/.test(sql) ? db.prepare(sql) : { all: () => (/FROM agent_runs/.test(sql) ? runs : []) }) };
  const obs = createLeague({ db: fake, config: {} }).observations({ includeSimulated: true });
  const first = Object.fromEntries(obs.map((o) => [o.missionId, o.firstReview]));
  assert.equal(first.m1, "CHANGES_REQUESTED", "the test review's PASS is not the writer's first-pass PASS");
  assert.equal(first.m2, null, "a mission with only a test review has no code review yet");
  db.close();
});

// ---------------------------------------------------------------------------------------------------------------------
// Fixture: bug-demo without its acceptance test (the pilot)
// ---------------------------------------------------------------------------------------------------------------------

test("fixture bug-demo-test-first: only test/unit.test.mjs (passing), the bug is there, the README names no acceptance test, the spec is a valid test-first BUGFIX", () => {
  const demo = FACTORY_DEMOS["bug-demo-test-first"];
  assert.ok(demo && demo.testFirst && demo.workType === "BUGFIX");
  const dir = path.join(scratch("fx-tf"), "proiect");
  const marker = materializeFixture("bug-demo-test-first", dir);
  assert.equal(marker.fixture, "bug-demo-test-first");
  assert.deepEqual(fs.readdirSync(path.join(dir, "test")), ["unit.test.mjs"]);
  assert.equal(fs.existsSync(path.join(dir, ".ifrim-hub")), false);
  assert.equal(fs.readFileSync(path.join(dir, "src", "requests.js"), "utf8"), fs.readFileSync(path.join(FIXTURE_ROOT, "bug-demo", "src", "requests.js"), "utf8"), "the same defect as Demo A");
  assert.doesNotMatch(fs.readFileSync(path.join(dir, "README.md"), "utf8"), /acceptance\.test/);
  assert.ok(fs.existsSync(path.join(FIXTURE_ROOT, "bug-demo", "test", "acceptance.test.mjs")), "the base fixture is untouched");
  // Plain discovery runs the unit tests and they pass (real node, no model).
  const env = { ...process.env, NODE_ENV: "test", CI: "1" };
  delete env.NODE_TEST_CONTEXT; // the outer test runner must not change the child's reporter
  delete env.NODE_OPTIONS;
  const run = spawnSync(process.execPath, ["--test", "--test-reporter=tap"], { cwd: dir, env, encoding: "utf8", timeout: 60000 });
  assert.equal(run.status, 0, run.stdout.slice(-600));
  assert.equal(parseTestOutput(run.stdout.split(/\r?\n/)).counts.tests, 3);
  // The spec: approvable, test-first, the paths derived from the registered project's id.
  assert.deepEqual(checkSpec(specInput("bug-demo-test-first")).problems, []);
  const a = demoSpec("bug-demo-test-first", { projectId: "prj_a" }).spec;
  const b = demoSpec("bug-demo-test-first", { projectId: "prj_b" }).spec;
  assert.notEqual(a.authoring.testRef, b.authoring.testRef);
  assert.equal(demoSpec("bug-demo-test-first", { projectId: "prj_a" }).spec.authoring.testRef, a.authoring.testRef, "deterministic");
  assert.equal(a.acceptance.find((c) => c.verify === "test").testRef, a.authoring.testRef);
  assert.equal(fs.existsSync(path.join(dir, ...a.authoring.testRef.split("/"))), false, "the Hub-written test does not exist yet");
  // The capture guard knows the fixture (a synthetic project's marker must name a registered fixture).
  const problems = syntheticProjectProblems({ source: "hub-test", path: dir }, { ...marker, data: "synthetic" }, { config: {} });
  assert.equal(problems.some((p) => p.code === "DELIVERY_FIXTURE_UNKNOWN"), false);
  // The ordinary demos are unchanged by the variant (U1 covers their hashes).
  assert.equal(Object.hasOwn(demoSpec("bug-demo", { projectId: "prj_a" }).spec, "authoring"), false);
});
