import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { normalizeNeeds, ALLOWED_NEEDS, TEST_HARNESS_VERSION, HUB_HELPERS, hubHelperIdentity, testHeader, assembleTestFile, buildAuthorBrief, buildTestReviewBrief, parseAuthorOutput, parseTapCases, classifyProof, baselineGate, proofSignature, lintTestBody, exportNamesOf } from "../server/factory/test-first.mjs";
import { sha256 } from "../server/core/canonical.mjs";
import { parseTestOutput, testStatus, createRunCaseReader } from "../server/factory/runner.mjs";
import { deriveCriteria } from "../server/owner/planners/criteria.mjs";
import { buildEngineeringSpec } from "../server/owner/planners/engineering.mjs";
import { makeTestHub, enableLive, waitFor } from "./helpers.mjs";
import { TEST_PROJECT_MARKER } from "../server/domain/projects.mjs";
import { buildVariants } from "./fixtures/stage0-s25/variants.mjs";

const here = path.dirname(fileURLToPath(import.meta.url)), fixture = path.join(here, "fixtures/stage0-s25"), app = path.join(here, "fixtures/r-priv-booking");
const read = (name) => fs.readFileSync(path.join(fixture, name), "utf8");
const words = "Telefonul rămâne obligatoriu la programare și este salvat corect, dar lista publică a zilei nu afișează și nu transmite telefonul.";
const criteria = deriveCriteria({ words }).test.map((c, i) => ({ ...c, id: `AC-${i + 1}`, verify: "test" }));
const helpers = ["json-exposure"], spec = { changesExisting: true, hubHelpers: helpers, acceptance: criteria };
const source = fs.readFileSync(path.join(app, "src/server-app.js"), "utf8").replaceAll("\r\n", "\n"), correct = source.replace("phone: row.phone, ", "");
const { DEFECTIVE, extra } = buildVariants(source, read), ref = ".ifrim-hub/staging/privacy.mjs";
const marker = "// ---- corpul testului ----\n", needsList = ["node:path", "node:os", "node:fs", "node:sqlite", "node:http"];
const recorded = (name) => { const text = read(`${name}.test.mjs.txt`); return { text, body: text.slice(text.indexOf(marker) + marker.length), manifest: JSON.parse(read(`${name}.manifest.json`)) }; };
const e0 = recorded("e0-ad7e4544c066"), e1 = recorded("e1-b8f25b9882ac"), existing = { body: read("existing-reference.body.mjs.txt"), manifest: JSON.parse(read("existing-reference.manifest.json")) };
const assembled = (candidate, harness = 2) => assembleTestFile({ body: candidate.body, needs: candidate.manifest.needs, helpers, harness });
function temp(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "r-harness-")); t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 })); return dir; }
function write(dir, rel, text) { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); }
function copy(t, text = source) { const dir = temp(t); fs.cpSync(app, dir, { recursive: true }); write(dir, "src/server-app.js", text); return dir; }
function execute(dir, file, expected = 1) {
  write(dir, ref, file.text);
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const started = performance.now(), run = spawnSync(process.execPath, ["--test", "--test-reporter=tap", ref], { cwd: dir, env, encoding: "utf8", timeout: 20000 });
  assert.equal(run.error, undefined); assert.equal(run.signal, null); assert.equal(run.status, expected, run.stdout + run.stderr);
  const lines = run.stdout.split(/\r?\n/), counts = parseTestOutput(lines).counts;
  return { ...testStatus({ exitCode: run.status, counts, timedOut: false }), counts, ...parseTapCases(lines), output: run.stdout, durationMs: performance.now() - started };
}
function proof(runs, file, manifest = e1.manifest, options = {}) {
  return classifyProof({ runs, manifest, criteria, workType: "FEATURE", spec, testRef: ref, test: { text: file.text, headerLines: file.header.length, refs: ["privacy.mjs"], harness: 2 }, ...options });
}
function clean(run, count = 5) { assert.equal(run.counts.tests, count, run.output); assert.equal(run.cases.length, count); for (const c of run.cases) assert.equal(c.cleanup?.ok, true, run.output); assert.equal(run.fileCleanup?.ok, true, run.output); }
function assertions(run) { clean(run); assert.equal(run.status, "FAIL"); assert.ok(run.cases.some((c) => !c.ok)); for (const c of run.cases.filter((c) => !c.ok)) { assert.equal(c.code, "ERR_ASSERTION", run.output); assert.doesNotMatch(c.message || "", /^HUB_/); } }
function lint(candidate) { return lintTestBody(candidate.body, { manifest: candidate.manifest, criteria, workType: "FEATURE", testRef: "test/hub/privacy.test.mjs", stagingRef: ref, spec, projectFiles: ["src/server-app.js"], moduleExports: { "src/server-app.js": exportNamesOf(source) } }); }

test("T-NEEDS-01", (t) => {
  const normalized = normalizeNeeds(e0.body, []);
  assert.deepEqual(normalized.effective, needsList); assert.deepEqual(normalized.declared, []); assert.equal(normalized.completed.length, 5);
  for (const c of normalized.completed) { assert.ok(c.line > 0 && c.line <= e0.body.split("\n").length); assert.match(c.reason, /folosit liber în corp.*fără declarație în needs/); }
  const candidate = { ...e0, manifest: { ...e0.manifest, needs: normalized.effective } }, file = assembled(candidate);
  assert.deepEqual(lint(candidate).violations, []);
  assert.deepEqual(lint({ ...candidate, body: file.text.slice(file.text.indexOf(marker) + marker.length) }).violations, []);
  const dir = copy(t), runs = [execute(dir, file), execute(dir, file)]; for (const r of runs) assertions(r);
  const p = proof(runs, file, candidate.manifest); assert.equal(p.verdict, "PROVEN", JSON.stringify(p));
  assert.deepEqual(p.failingCriteria, ["AC-1", "AC-2"]); for (const row of p.table.filter((r) => r.today === "fail")) assert.match(row.statement, /assert.deepEqual\(exposes\(/);
  const passing = execute(copy(t, correct), file, 0); clean(passing); assert.equal(passing.counts.pass, 5);
  const manifest = { ...candidate.manifest, needsDeclared: [], needsCompleted: normalized.completed };
  const author = buildAuthorBrief({ spec, harness: 2 }), review = buildTestReviewBrief({ spec, manifest, harness: 2, testText: file.text });
  assert.match(author, /Hub-ul îl completează singur/); assert.match(author, /Antet Hub v2/); assert.match(author, /pornește fiecare resursă prin propriul apel setup/);
  for (const entry of normalized.completed) assert.ok(review.includes(entry.reason)); assert.ok(review.includes(JSON.stringify(manifest, null, 2))); assert.match(review, /Antet Hub v2/);
});

test("T-NEEDS-02", () => {
  const partial = normalizeNeeds('fs.readFileSync(path.join("x"));', ["node:fs"]);
  assert.deepEqual(partial.effective, ["node:path", "node:fs"]); assert.deepEqual(partial.completed.map((c) => c.module), ["node:path"]);
  assert.deepEqual(normalizeNeeds('// http.get()\nconst s = "os.tmpdir()"; const t = `http.get`; const r = /os.tmpdir/;').effective, []);
  assert.deepEqual(normalizeNeeds('obj.path.join("x"); res?.fs; const x = { path: 1 };').effective, []);
  assert.deepEqual(normalizeNeeds('const obj = { http(fs) { return fs.readFileSync(); }, get path() { return value; } }; class X { os() {} }').effective, []);
  for (const body of ['class A { fs = 1; m() { return this.fs; } }', 'const obj = { fs() {} };', 'class A { fs; path\nhttp }', 'class A { fs = os.tmpdir(); }']) assert.deepEqual(normalizeNeeds(body).effective, body.includes('os.tmpdir') ? ['node:os'] : [], body);
  const local = 'test("unul", () => { const fs = { readFileSync: () => "" }; fs.readFileSync(); });';
  assert.deepEqual(normalizeNeeds(local).effective, []); assert.deepEqual(normalizeNeeds(local).shadowed, ["fs"]);
  const mixed = local + '\ntest("doi", () => { fs.readFileSync("x"); });';
  assert.deepEqual(normalizeNeeds(mixed).effective, ["node:fs"]); assert.deepEqual(normalizeNeeds(mixed), normalizeNeeds(mixed));
  for (const body of ['(path) => path.join("x")', 'try { foo(); } catch (os) { os.tmpdir(); }', 'for (const http of list) { foo(http); }', 'function f({x: fs = fallback}, [path]) { fs.readFileSync(); path.join(); }', 'const f = ({http}) => http.get();', 'const x = { m(os = fallback) { return os.tmpdir(); } };', 'function f() { { var fs = x; } return fs; }', 'function f() { { function http() {} } return http; }', '{ let { x: fs = fallback } = obj; foo(fs); }', '{ const [sqlite = fallback] = list; foo(sqlite); }', '{ class url {} foo(url); }']) assert.deepEqual(normalizeNeeds(body).effective, [], body);
  for (const body of ['const { join } = path;', 'foo(http);', 'const x = { fs };', 'const x = `${os.tmpdir()}`;']) assert.equal(normalizeNeeds(body).completed.length, 1, body);
  assert.deepEqual(normalizeNeeds('{ const fs = x; fs.readFileSync();').effective, ["node:fs"], "unbalanced source falls back to member uses");
  const manifest = { ...existing.manifest, needs: normalizeNeeds(existing.body, [...needsList, "node:url"]).effective };
  const result = lint({ ...existing, manifest }); assert.ok(result.signals.some((s) => s.signal === "needs_unused" && s.detail === "node:url")); assert.ok(!result.violations.some((v) => v.rule === "needs_missing"));
  assert.ok(lint(e0).violations.some((v) => v.rule === "needs_missing"), "direct callers retain the rule");
});

test("T-NEEDS-03", () => {
  for (const needs of [["node:child_process"], "node:fs"]) {
    const parsed = parseAuthorOutput('```js\n' + existing.body + '\n```\n```json\n' + JSON.stringify({ ...existing.manifest, needs }) + '\n```', { criteria, workType: "FEATURE" });
    assert.equal(parsed.ok, false); assert.ok(parsed.problems.some((p) => /needs|permis/.test(p)));
  }
  for (const name of ["child_process", "process"]) { const body = existing.body + `\n${name}.x();`, needs = normalizeNeeds(body, ["node:child_process"]); assert.ok(needs.effective.every((n) => ALLOWED_NEEDS.includes(n))); assert.ok(lint({ body, manifest: { ...existing.manifest, needs: needs.effective } }).violations.some((v) => v.rule === "forbidden")); }
});

test("T-CLEAN-01", (t) => {
  const file = assembled(e1), dir = copy(t), runs = [execute(dir, file), execute(dir, file)];
  for (const r of runs) { assertions(r); assert.deepEqual(r.cases.map((c) => c.ok), [false, false, true, true, true]); for (const c of r.cases) assert.ok(c.cleanup.count >= 1); t.diagnostic(`e1: ${r.durationMs.toFixed(0)} ms, ieșire normală`); }
  const p = proof(runs, file); assert.equal(p.verdict, "PROVEN", JSON.stringify(p)); assert.deepEqual(p.helpers, [hubHelperIdentity("json-exposure")]);
  const oldHeader = e1.text.split("\n").findIndex((l) => l === marker.trim()) + 1;
  for (const c of runs[0].cases.filter((c) => !c.ok)) { const line = file.text.split("\n")[c.at.line - 1]; assert.match(line, /assert.deepEqual\(exposes\(/); assert.equal(line, e1.text.split("\n")[c.at.line - file.header.length + oldHeader - 1]); }
});

test("T-CLEAN-02", (t) => { const run = execute(copy(t, correct), assembled(e1), 0); clean(run); assert.equal(run.counts.pass, 5); for (const c of run.cases) { assert.match(c.cleanup.detail, /deja închis|închis/); assert.doesNotMatch(c.cleanup.detail, /eroare/); } });

test("T-CLEAN-03", (t) => {
  for (const name of ["refuse-all", "browser-only validation"]) assertions(execute(copy(t, DEFECTIVE[name]), assembled(e1)));
  const body = 'test("AC-1: pregătire", async () => {\nconst server = await setup("srv", () => new Promise((resolve) => { const s = http.createServer(); s.listen(0, "127.0.0.1", () => resolve(s)); }));\nawait setup("post", () => { throw new Error("indisponibil"); });\nassert.equal(server.listening, false);\n});';
  const file = assembleTestFile({ body, needs: ["node:http"], harness: 2 }), dir = temp(t), runs = [execute(dir, file), execute(dir, file)], manifest = { cases: [{ name: "AC-1: pregătire", criterion: "AC-1", kind: "check" }] };
  for (const r of runs) { clean(r, 1); assert.match(r.cases[0].message, /^HUB_SETUP post:/); }
  const p = proof(runs, file, manifest, { criteria: [{ id: "AC-1", verify: "test" }], spec: {} }); assert.equal(p.verdict, "WRONG_REASON", JSON.stringify(p)); assert.equal(p.cause, "setup_failed");
});

test("T-CLEAN-04", (t) => {
  const bodies = {
    closed: 'const s = await setup("srv", () => new Promise((r) => { const s = http.createServer(); s.listen(0, "127.0.0.1", () => r(s)); })); await new Promise((r) => s.close(r)); assert.equal(s.listening, false);',
    throws: 'await setup("obiect", () => ({ close() { throw new Error("refuz"); } })); assert.equal(1, 1);',
    failing: 'await setup("obiect", () => ({ close() { throw new Error("refuz"); } })); assert.equal(1, 2);',
    hangs: 'const s = http.createServer(); await new Promise((r) => s.listen(0, "127.0.0.1", r)); await setup("blocat", () => ({ close: () => new Promise(() => {}), unref: () => s.unref(), closeAllConnections: () => s.closeAllConnections() })); assert.equal(s.listening, true);',
    database: 'const db = await setup("db", () => new sqlite.DatabaseSync(":memory:")); db.close(); assert.equal(db.isOpen, false);',
    empty: 'assert.equal(1, 1);',
    file: 'assert.equal(1, 1);',
  };
  for (const [name, body] of Object.entries(bodies)) {
    const bad = ["throws", "failing", "hangs"].includes(name), file = assembleTestFile({ body: (name === "file" ? 'await setup("fișier", () => ({ close() {} }));\n' : "") + `test("AC-1: resurse", async () => { ${body} });`, needs: ["node:http", "node:sqlite"], harness: 2 });
    const run = execute(temp(t), file, bad ? 1 : 0), c = run.cases[0]; assert.equal(c.cleanup.ok, !bad, run.output); assert.equal(run.fileCleanup.ok, true);
    if (bad) { const p = proof([run, run], file, { cases: [{ name: c.name, criterion: "AC-1", kind: "check" }] }, { criteria: [{ id: "AC-1", verify: "test" }], spec: {} }); assert.equal(p.verdict, "INCONCLUSIVE"); assert.equal(p.cause, "cleanup"); assert.equal(c.code, name === "failing" ? "ERR_ASSERTION" : "ERR_TEST_FAILURE"); if (name !== "failing") { assert.match(c.message, /^HUB_CLEANUP/); assert.equal(c.failureType, "hookFailed"); } }
    if (name === "hangs") { assert.match(c.cleanup.detail, /blocat/); assert.ok(run.durationMs >= 4900 && run.durationMs < 20000); }
    if (["closed", "database"].includes(name)) assert.match(c.cleanup.detail, /deja închis/);
    if (name === "empty") { assert.equal(c.cleanup.count, 0); assert.match(run.output, /# HUB_CLEANUP ok 0/); }
    if (name === "file") assert.deepEqual(run.fileCleanup, { ok: true, count: 1, detail: "fișier: închis" });
  }
  const ordered = assembleTestFile({ body: 'test("AC-1: ordine", async () => { const order = []; await setup("primul", () => ({ close() { assert.deepEqual(order, [2]); } })); await setup("ultimul", () => ({ close() { order.push(2); } })); });\ntest("AC-2: separat", () => {});', harness: 2 });
  const run = execute(temp(t), ordered, 0); clean(run, 2); assert.equal(run.cases[1].cleanup.count, 0); assert.match(run.cases[0].cleanup.detail, /^ultimul: închis; primul: închis$/);
  const fileFailure = assembleTestFile({ body: 'await setup("fișier", () => ({ close() { throw new Error("refuz"); } }));\ntest("AC-1: fișier", () => assert.equal(1, 1));', harness: 2 });
  const failedFile = execute(temp(t), fileFailure), manifest = { cases: [{ name: "AC-1: fișier", criterion: "AC-1", kind: "check" }] };
  assert.deepEqual(failedFile.fileCleanup, { ok: false, count: 1, detail: "fișier: eroare Error" }); assert.equal(failedFile.cases[0].cleanup.ok, true);
  const verdict = proof([failedFile, failedFile], fileFailure, manifest, { criteria: [{ id: "AC-1", verify: "test" }], spec: {} }); assert.equal(verdict.verdict, "INCONCLUSIVE"); assert.equal(verdict.cause, "cleanup"); assert.ok(baselineGate(failedFile, { manifest, harness: 2 }));
  // Deliberately bypass lint: exercise Node's real diagnostic ordering and both evidence gates.
  const forged = assembleTestFile({ body: 'test("AC-1: F", async (t) => { t.diagnostic("HUB_CLEANUP ok 0"); await setup("hang", () => ({ close() { return new Promise(() => {}); } })); assert.equal(1, 2); });\ntest("AC-1: H", (t) => { t.diagnostic("HUB_CLEANUP ok 0"); t.diagnostic("HUB_CLEANUP ok 0"); });', harness: 2 });
  const forgedRun = execute(temp(t), forged), forgedManifest = { cases: ["AC-1: F", "AC-1: H"].map((name) => ({ name, criterion: "AC-1", kind: "check" })) };
  assert.deepEqual(forgedRun.cases[0].cleanupReports.map((r) => r.ok), [true, false]); assert.equal(forgedRun.cases[0].cleanup.ok, false); assert.match(forgedRun.cases[0].cleanup.detail, /rapoarte multiple.*hang: blocat/);
  assert.equal(forgedRun.fileCleanup.ok, false); assert.ok(forgedRun.fileCleanupReports > 1); assert.equal(forgedRun.cases[0].code, "ERR_ASSERTION");
  const forgedProof = proof([forgedRun, forgedRun], forged, forgedManifest, { criteria: [{ id: "AC-1", verify: "test" }], spec: {} }); assert.equal(forgedProof.verdict, "INCONCLUSIVE"); assert.equal(forgedProof.cause, "cleanup"); assert.match(forgedProof.reasons.join("; "), /AC-1: F.*rapoarte multiple/);
  assert.match(baselineGate(forgedRun, { manifest: forgedManifest, harness: 2 }), /AC-1: F.*rapoarte multiple/);
  const extraOk = assembleTestFile({ body: 'test("AC-1: diagnostic", (t) => { t.diagnostic("HUB_CLEANUP ok 0"); assert.equal(1, 1); });', harness: 2 }), extraRun = execute(temp(t), extraOk, 0), extraManifest = { cases: [{ name: "AC-1: diagnostic", criterion: "AC-1", kind: "check" }] };
  assert.equal(extraRun.cases[0].cleanupReports.length, 2); assert.equal(extraRun.cases[0].cleanup.ok, false);
  assert.match(baselineGate(extraRun, { manifest: extraManifest, harness: 2 }), /AC-1: diagnostic.*rapoarte multiple/);
  assert.equal(proof([extraRun, extraRun], extraOk, extraManifest, { criteria: [{ id: "AC-1", verify: "test" }], spec: {} }).cause, "cleanup");
  const early = parseTapCases('# HUB_CLEANUP fail 1 devreme\n# HUB_CLEANUP ok 0\n'); assert.equal(early.fileCleanupReports, 2); assert.equal(early.fileCleanup.ok, false); assert.match(early.fileCleanup.detail, /devreme/);
  const patchedBody = 'test("AC-1: p", async () => { const orig = RegExp.prototype.test; RegExp.prototype.test = function (s) { return String(s).startsWith("eroare") ? false : orig.call(this, s); }; await setup("srv", async () => ({ close() { throw new Error("boom"); } })); assert.equal(await Promise.resolve(1), 1); });';
  assert.ok(lint({ ...existing, body: patchedBody }).violations.some((v) => v.rule === "builtin_patched"));
  const patchedFile = assembleTestFile({ body: patchedBody, harness: 2 }), patchedRun = execute(temp(t), patchedFile), patchedManifest = { cases: [{ name: "AC-1: p", criterion: "AC-1", kind: "check" }] };
  assert.equal(patchedRun.cases[0].cleanup.ok, false); assert.match(patchedRun.output, /# HUB_CLEANUP fail 1 srv: eroare Error/);
  const patchedProof = proof([patchedRun, patchedRun], patchedFile, patchedManifest, { criteria: [{ id: "AC-1", verify: "test" }], spec: {} });
  assert.equal(patchedProof.verdict, "INCONCLUSIVE"); assert.equal(patchedProof.cause, "cleanup"); assert.ok(baselineGate(patchedRun, { manifest: patchedManifest, harness: 2 }));
  // A top-level reassignment happens after the header captures both timer functions.
  const timerFile = assembleTestFile({ body: 'setTimeout = () => { throw new Error("patched timer"); }; clearTimeout = () => { throw new Error("patched clear"); };\ntest("AC-1: timer", async () => { await setup("srv", () => ({ close() {} })); });', harness: 2 });
  clean(execute(temp(t), timerFile, 0), 1);
});

test("T-RUN-01", (t) => {
  const file = assembled(e1), run = execute(copy(t), file), opts = { manifest: e1.manifest, harness: 2 }; assert.equal(baselineGate(run, opts), null);
  const variants = [{ reason: "timeout", timedOut: true }, { counts: { ...run.counts, tests: undefined } }, { counts: { ...run.counts, tests: 0 } }, { cases: run.cases.slice(0, 4) }, { counts: { ...run.counts, cancelled: 1 } }, { counts: { ...run.counts, todo: 1 } }, { stopped: true }, { status: "INTERRUPTED" }, { status: "INCONCLUSIVE" }, { overflow: 1 }, { counts: { ...run.counts, fail: 1 } }, { fileCleanup: { ok: false, detail: "eroare" } }, { cases: run.cases.map((c, i) => i ? c : { ...c, cleanup: { ok: false, detail: "eroare" } }) }, { cases: run.cases.map((c, i) => i ? c : { ...c, cleanup: undefined }) }, { cases: run.cases.map((c, i) => i ? c : { ...c, message: "HUB_CLEANUP blocat" }) }, { cases: run.cases.map((c, i) => i ? c : { ...c, skip: true }) }, { cases: run.cases.map((c, i) => i ? c : { ...c, name: "AC-1: alt nume" }) }];
  for (const v of variants) assert.ok(baselineGate({ ...run, ...v }, opts), JSON.stringify(v));
  assert.equal(proofSignature(run), proofSignature({ ...run, ...variants[0] }));
  const withoutReports = { ...run, fileCleanup: undefined, cases: run.cases.map(({ cleanup, ...c }) => c) }; assert.equal(baselineGate(withoutReports, { manifest: e1.manifest }), null); assert.equal(proofSignature(run), proofSignature(withoutReports));
  assert.equal(proof([withoutReports, withoutReports], file).cause, "cleanup");
  const reader = createRunCaseReader(); for (const line of run.output.split(/\r?\n/)) reader.push(line); assert.deepEqual(reader.finish(), parseTapCases(run.output));
  assert.equal(run.fileCleanupReports, 1); for (const c of run.cases) assert.equal(c.cleanupReports.length, 1);
  const legacy = parseTapCases('ok 1 - AC-1: fără raport\n1..1\n');
  assert.deepEqual(Object.keys(legacy).sort(), ["cases", "fileLevelFailure", "overflow"]); assert.equal(Object.hasOwn(legacy.cases[0], "cleanupReports"), false);
  for (const [report, reason] of [["ok 1 srv: eroare Error", /raport ok cu detalii de eșec/], ["ok 1 srv: blocat", /raport ok cu detalii de eșec/], ["ok 2 srv: închis", /număr de resurse/], ["ok 0 srv: închis", /număr de resurse/]]) {
    const parsed = parseTapCases(`ok 1 - AC-1: raport\n# HUB_CLEANUP ${report}\n# HUB_CLEANUP ok 0\n1..1\n`);
    const manifest = { cases: [{ name: "AC-1: raport", criterion: "AC-1", kind: "check" }] }, bad = { status: "PASS", counts: { tests: 1, pass: 1, fail: 0 }, ...parsed };
    assert.match(baselineGate(bad, { manifest, harness: 2 }), reason);
    const p = proof([bad, bad], file, manifest, { criteria: [{ id: "AC-1", verify: "test" }], spec: {} }); assert.equal(p.verdict, "INCONCLUSIVE"); assert.equal(p.cause, "cleanup");
    const badFile = { ...run, fileCleanup: parsed.cases[0].cleanup }; assert.match(baselineGate(badFile, opts), reason); assert.equal(proof([badFile, badFile], file).cause, "cleanup");
  }
  for (const v of [{ fileCleanupReports: 2 }, { cases: run.cases.map((c, i) => i ? c : { ...c, cleanupReports: [] }) }, { cases: run.cases.map((c, i) => i ? c : { ...c, cleanupReports: [c.cleanup, c.cleanup] }) }, { cases: run.cases.map((c, i) => i ? c : { ...c, cleanupReports: [{ ok: false, count: 1, detail: "blocat" }] }) }]) {
    assert.ok(baselineGate({ ...run, ...v }, opts), JSON.stringify(v)); assert.equal(proof([{ ...run, ...v }, { ...run, ...v }], file).cause, "cleanup");
  }
  for (const extra of ['test.afterEach(() => {});', 'test.before(() => {});', 'test.after(() => {});', 'test.beforeEach(() => {});', 'before(() => {});', 'after(() => {});', 'beforeEach(() => {});', 'afterEach(() => {});', 'registry.current = null;', 'const hubAdd = () => {};', 'hubClose({});', 'hubCleanup({});', 't.diagnostic("ok");']) assert.ok(lint({ ...existing, body: existing.body + '\n' + extra }).violations.some((v) => v.rule === "harness_reserved"), extra);
  assert.ok(lint({ ...existing, body: existing.body + '\ntest("AC-1: parametru", (t) => { assert.equal(1, 2); });' }).violations.some((v) => ["test_shape", "harness_reserved"].includes(v.rule)));
  assert.deepEqual(lint({ ...existing, body: existing.body + '\nconst reserved = "registry hubAdd hubClose hubCleanup test.afterEach t.diagnostic"; // registry\nconst pattern = /registry|hubCleanup/;' }).violations, []);
  for (const extra of ['const registry = 1;', 'hubTimer(() => {});', 'hubClear(1);', 'obj.diagnostic;', 'obj["diagnostic"]("ok");', 'obj?.["diagnostic"]("ok");']) assert.ok(lint({ ...existing, body: existing.body + '\n' + extra }).violations.some((v) => v.rule === "harness_reserved"), extra);
  for (const body of ['this.diagnostic("HUB_CLEANUP ok 0"); const a = arguments[0]; a.diagnostic("HUB_CLEANUP ok 0");', 'return this;', 'const a = arguments[0];', 'arguments[0]["diagnostic"]("HUB_CLEANUP ok 0");']) {
    const result = lint({ ...existing, body: `test("AC-1: callback", async function () { ${body} assert.equal(await Promise.resolve(1), 1); });` });
    assert.ok(result.violations.some((v) => v.rule === "harness_reserved"), body);
  }
  assert.deepEqual(lint({ ...existing, body: existing.body + '\nfunction helper() { return this.value + arguments[0]; }\nconst x = app.registry; const re = /x/; re.test("x"); const promise = new Promise((resolve) => resolve(1));' }).violations, []);
  for (const target of ["RegExp", "RegExp.prototype", "Promise", "Promise.prototype", "Map.prototype", "Set.prototype", "WeakMap.prototype", "Error", "Error.prototype", "Function.prototype", "Boolean.prototype", "Symbol", "setTimeout", "clearTimeout", "setImmediate", "clearImmediate", "queueMicrotask", "structuredClone"]) {
    for (const statement of [`${target} = replacement;`, `${target}++;`, `Object.defineProperty(${target}, "test", { value: replacement });`, `Object.defineProperties(${target}, { test: { value: replacement } });`, `Object.assign(${target}, { test: replacement });`, `Object.setPrototypeOf(${target}, replacement);`]) assert.ok(lint({ ...existing, body: existing.body + '\n' + statement }).violations.some((v) => v.rule === "builtin_patched"), statement);
  }
  for (const statement of ['setTimeout = () => {};', 'Promise.prototype.then = () => {};', 'RegExp.prototype.test = () => false;', 'Object.defineProperty(RegExp.prototype, "test", { value: () => false });']) assert.ok(lint({ ...existing, body: existing.body + `\ntest("AC-1: patch", async () => { ${statement} assert.equal(await Promise.resolve(1), 1); });` }).violations.some((v) => v.rule === "builtin_patched"), statement);
});

test("T-RUN-02", (t) => {
  const file = assembleTestFile({ body: 'test("AC-1: activitate", () => { setTimeout(() => { throw new Error("târziu"); }, 30); assert.equal(1, 1); });', harness: 2 });
  const run = execute(temp(t), file), manifest = { cases: [{ name: "AC-1: activitate", criterion: "AC-1", kind: "check" }] };
  assert.match(run.fileLevelFailure, /activitate asincronă/); assert.equal(run.cases.find((c) => c.name === manifest.cases[0].name).cleanup.ok, true);
  const p = proof([run, run], file, manifest, { criteria: [{ id: "AC-1", verify: "test" }], spec: {} }); assert.equal(p.verdict, "WRONG_REASON"); assert.equal(p.cause, "file_crash"); assert.match(baselineGate(run, { manifest, harness: 2 }), /activitate asincronă/);
});

test("T-HARNESS-MATRIX", (t) => {
  assert.equal(Object.keys(DEFECTIVE).length, 29); assert.equal(Object.keys(extra).length, 8);
  for (const [name, candidate] of [["existing-reference", existing], ["e1", e1]]) {
    const file = assembled(candidate), pass = execute(copy(t, correct), file, 0); clean(pass); assert.equal(pass.counts.pass, 5); t.diagnostic(`${name} / corect: tests=5 pass=5 fail=0`);
    for (const [variant, text] of Object.entries({ ...DEFECTIVE, ...extra })) { assert.notEqual(text, correct, variant); const run = execute(copy(t, text), file); assertions(run); t.diagnostic(`${name} / ${variant}: tests=${run.counts.tests} pass=${run.counts.pass} fail=${run.counts.fail}; ${run.cases.filter((c) => !c.ok).map((c) => c.name.slice(0, 4) + ":" + c.code).join(", ")}`); }
  }
});

test("T-INTEGRITY-02", (t) => {
  assert.equal(TEST_HARNESS_VERSION, 2); assert.equal(hubHelperIdentity("json-exposure").sha256, "984e7cf2876ddbf514b1a6b6c86741736946f64adf8edf0ef0215369b136704f");
  for (const [candidate, expected] of [[{ ...e0, manifest: { ...e0.manifest, needs: normalizeNeeds(e0.body, []).effective } }, "9fd197172c5c896df2a6ee578cb6e77f10e9ae73ff4ee375f6a65f76c435de44"], [e1, "9fd197172c5c896df2a6ee578cb6e77f10e9ae73ff4ee375f6a65f76c435de44"], [existing, "894c2836be1b37d51abedbc420a409b6bf69a96e1e8d77cb794eee48599f5536"]]) { assert.equal(assembled(candidate).sha256, expected); assert.ok(read("README.md").includes(expected)); }
  const v2 = testHeader({ harness: 2 }), v2Lines = v2.slice(v2.findIndex((line) => line.startsWith("// Antet Hub v2")), v2.indexOf(marker.trim()));
  assert.ok(read("README.md").includes(v2Lines.join("\n"))); assert.ok(v2Lines.includes('const hubTimer = setTimeout, hubClear = clearTimeout;')); assert.doesNotMatch(v2Lines.join("\n"), /\.then\(/);
  for (const [name, expected] of [["json-reference", "88459488ee36ddde0e152778998d18ed27f2881e791a414057180d70518f5346"], ["existing-reference", "8bf1d3f7465e45e8621385d5cc5bfd54b774751bf6575a6ddfc8db51d7648245"]]) assert.equal(assembleTestFile({ body: read(`${name}.body.mjs.txt`), needs: JSON.parse(read(`${name}.manifest.json`)).needs, helpers }).sha256, expected);
  for (const name of ["e0-ad7e4544c066", "e1-b8f25b9882ac", "rh1-c57c518694c7"]) { const c = recorded(name), first = c.text.split("\n")[0], metadata = first.match(/misiunea (.*), spec v(\d+) ([^ )]+)/); const file = assembleTestFile({ body: c.body, needs: c.manifest.needs, helpers, missionId: metadata[1], specVersion: Number(metadata[2]), specSha: metadata[3] }); assert.equal(file.text, c.text); assert.ok(file.sha256.startsWith(name.split("-").at(-1))); assert.deepEqual(file.header, testHeader({ needs: c.manifest.needs, helpers, missionId: metadata[1], specVersion: Number(metadata[2]), specSha: metadata[3] })); }
  const file = assembled(e1), run = execute(copy(t), file); assert.ok(file.header.join("\n").endsWith([...HUB_HELPERS["json-exposure"].lines, marker.trim()].join("\n")));
  const changed = { ...file, text: file.text.replace('function exposes(text, config)', 'function exposes(text, confIg)') }; const p = proof([run, run], changed); assert.equal(p.verdict, "INCONCLUSIVE"); assert.equal(p.cause, "helper");
});

// The existing public factoryRunner seam changes ONE completed baseline result into a timeout; proof bytes/cases stay identical.
async function factoryFlow(t, incomplete = false) {
  const h = await makeTestHub({ queues: true }); t.after(() => h.cleanup());
  const dispatch = async (type, payload) => h.hub.commands.dispatch({ type, payload, channel: "test", actor: "test" });
  const dir = path.join(h.dataDir, "booking"); fs.cpSync(app, dir, { recursive: true });
  write(dir, TEST_PROJECT_MARKER, JSON.stringify({ createdBy: "ifrim-agent-hub", purpose: "live-validation", name: "Programări sintetice §25", stack: "Node.js", fixture: "r-priv-booking", data: "synthetic" }));
  const project = (await dispatch("project.register_test", { path: dir })).result, built = buildEngineeringSpec({ text: words, project }); assert.deepEqual(built.problems, []);
  const mission = (await dispatch("factory.prepare", { projectId: project.id, ...built.input, limits: { writerModel: "gpt-fake-sol", reviewerModel: "sonnet" } })).result.mission;
  const stored = () => JSON.parse(h.hub.db.prepare("SELECT protected_json FROM factory_specs WHERE mission_id = ? ORDER BY version DESC LIMIT 1").get(mission.id).protected_json);
  const stages = [], snapshots = [], runs = [], original = h.hub.factoryRunner.run;
  const prepare = h.hub.db.prepare.bind(h.hub.db);
  h.hub.db.prepare = (sql) => { const statement = prepare(sql); if (sql.startsWith("UPDATE factory_specs SET protected_json")) { const run = statement.run.bind(statement); statement.run = (...args) => { const value = JSON.parse(args[0]); if (value.authoring?.pending || value.authoring?.candidate) snapshots.push(structuredClone(value)); return run(...args); }; } return statement; };
  h.hub.factoryRunner.run = async (input) => { const state = stored(); snapshots.push(structuredClone(state)); stages.push(input.key); if (input.key.includes("-BASELINE-")) assert.equal(h.hub.factory.writerStarted(mission.id), false); const result = await original(input); if (incomplete && input.key.includes("-BASELINE-")) { assert.equal(proofSignature(result), state.authoring.proof.signature); runs.push({ key: input.key, result }); return { ...result, status: "FAIL", reason: "timeout", timedOut: true }; } runs.push({ key: input.key, result }); return result; };
  await enableLive(h.hub, { provider: "codex", access: "workspace-write", attempts: 1 });
  h.hub.bus.transaction(() => { for (const provider of ["codex", "claude"]) h.hub.grants.create({ provider, projectId: project.id, access: provider === "codex" ? "workspace-write" : "read-only", maxAttempts: 5, maxDurationS: 900, ttlMinutes: 60 }, "test"); });
  h.queue("claude", "author:existing-reference-noneeds", "review:pass"); h.queue("codex", "test-review:pass", "factory-write:privacy-harness");
  const req = await dispatch("factory.start", h.hub.factory.view(mission.id).scope); await dispatch("approval.decide", { approvalId: req.approval.id, decision: "approved", displayedHash: req.approval.payloadHash }); await h.hub.commands.executeApproved(req.command.id, "user");
  await waitFor(() => ["DELIVERY_READY", "NEEDS_OWNER_DECISION", "BLOCKED", "PAUSED"].includes(h.hub.factory.view(mission.id).factory.stage), 100000, 50); await h.hub.factory.idle(mission.id);
  const done = h.hub.factory.view(mission.id), state = stored(), a = state.authoring;
  const events = (type) => h.hub.db.prepare("SELECT payload_json FROM events WHERE type = ? AND scope_id = ? ORDER BY seq").all(type, mission.id).map((r) => JSON.parse(r.payload_json));
  assert.equal(a.status, "PROTECTED", JSON.stringify(done)); assert.equal(a.cycle, 0); assert.equal(a.candidate.harness, 2); assert.deepEqual(a.candidate.manifest.needsDeclared, []); assert.deepEqual(a.candidate.manifest.needs, needsList); assert.equal(a.candidate.manifest.needsCompleted.length, 5);
  assert.equal(a.proof.verdict, "PROVEN"); assert.equal(a.proof.harness, 2); assert.equal(a.proof.sha, a.candidate.sha); assert.deepEqual(a.proof.manifest, a.candidate.manifest);
  assert.equal(events("factory.test_staged")[0].needsCompleted, 5); assert.deepEqual(events("factory.test_proof")[0].manifest, a.candidate.manifest); assert.equal(events("factory.test_proof")[0].sha, a.candidate.sha);
  for (const s of snapshots.filter((s) => s.authoring.candidate)) { assert.equal(s.authoring.candidate.sha, a.candidate.sha); assert.deepEqual(s.authoring.candidate.manifest, a.candidate.manifest); }
  const pending = snapshots.filter((s) => s.authoring.pending).map((s) => s.authoring.pending); assert.ok(pending.length > 0); for (const p of pending) { assert.equal(p.harness, 2); assert.equal(p.sha, a.candidate.sha); assert.deepEqual(p.manifest, a.candidate.manifest); }
  assert.equal(state.files[a.testRef], a.candidate.sha); assert.equal(sha256(fs.readFileSync(path.join(dir, a.testRef), "utf8")), a.candidate.sha); assert.deepEqual(fs.readdirSync(path.join(dir, ".ifrim-hub/staging")), []);
  const review = h.hub.db.prepare("SELECT * FROM factory_reviews WHERE id = ?").get(a.review.reviewId); assert.equal(review.change_set_sha, a.candidate.sha); assert.equal(review.verdict, "PASS");
  assert.equal(JSON.parse(review.validation_json).harness, 2); assert.deepEqual(JSON.parse(review.validation_json).manifest, a.candidate.manifest);
  const proofRuns = runs.filter((r) => r.key.includes("-TEST_PROVING-")); assert.equal(proofRuns.length, 2); for (const r of proofRuns) { clean({ ...r.result, output: r.result.outputTail }); assert.equal(proofSignature(r.result), a.proof.signature); }
  assert.equal(events("factory.acceptance_protected")[0].sha, a.candidate.sha);
  const baseline = done.evidence.find((e) => e.stage === "BASELINE"); assert.equal(baseline.status, "FAIL"); assert.equal(baseline.counts.tests, 5); assert.match(baseline.outputTail, /HUB_CLEANUP ok/);
  if (incomplete) { assert.equal(done.factory.stage, "NEEDS_OWNER_DECISION", done.factory.stageReason); assert.equal(h.hub.factory.writerStarted(mission.id), false); assert.equal(done.runs.filter((r) => r.dispatchStage === "IMPLEMENTING").length, 0); assert.equal(events("factory.acceptance_unstable")[0].cause, "incomplete"); assert.match(done.factory.stageReason, /nu a terminat normal/); return; }
  assert.equal(done.factory.stage, "DELIVERY_READY", done.factory.stageReason); assert.equal(done.runs.filter((r) => r.dispatchStage === "IMPLEMENTING").length, 1);
  for (const stage of ["CHECKING", "QA"]) { const evidence = done.evidence.filter((e) => e.stage === stage && e.kind === "test"); assert.ok(evidence.length > 0); for (const e of evidence) { assert.equal(e.status, "PASS", e.outputTail); assert.ok(e.counts.tests >= 5); assert.ok((e.outputTail.match(/HUB_CLEANUP ok/g) || []).length >= 5); } }
  for (const { result } of runs.filter((r) => /-CHECKING-|-QA-/.test(r.key))) { clean({ ...result, output: result.outputTail }); assert.equal(result.status, "PASS"); }
  assert.ok(stages.findIndex((s) => s.includes("-BASELINE-")) < stages.findIndex((s) => s.includes("-CHECKING-")));
}
test("T-RUN-01 factory: baseline incomplet nu pornește implementarea", { timeout: 120000 }, (t) => factoryFlow(t, true));
test("T-FLOW-01", { timeout: 120000 }, (t) => factoryFlow(t));
