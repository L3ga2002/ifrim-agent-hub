import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { makeTestHub, enableLive, waitFor } from "./helpers.mjs";
import { materializeFixture, demoSpec } from "../server/factory/fixtures.mjs";
import { buildEngineeringSpec } from "../server/owner/planners/engineering.mjs";
import { sha256 } from "../server/core/canonical.mjs";
import { assembleTestFile, parseTapCases, classifyProof, lintTestBody, assertionInventory, compareInventory, amendmentViolations, completionItems, completionSignals, parseTestReview, parseAuthorOutput, buildAuthorBrief, buildTestReviewBrief, exportNamesOf } from "../server/factory/test-first.mjs";
import { parseTestOutput, testStatus } from "../server/factory/runner.mjs";
import { deriveCriteria } from "../server/owner/planners/criteria.mjs";
import { readRetireJournal } from "../server/factory/factory.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, "fixtures/stage0-s25");
const app = path.join(here, "fixtures/r-priv-booking");
const words = "Telefonul rămâne obligatoriu la programare și este salvat corect, dar lista publică a zilei nu afișează și nu transmite telefonul.";
const criteria = deriveCriteria({ words }).test.map((c, i) => ({ ...c, id: `AC-${i + 1}`, verify: "test" }));
const manifest = JSON.parse(fs.readFileSync(path.join(fixture, "new-protocol.manifest.json"), "utf8"));
const body = fs.readFileSync(path.join(fixture, "new-protocol.body.mjs.txt"), "utf8");
const protocol = assembleTestFile({ body, needs: manifest.needs });
const source = fs.readFileSync(path.join(app, "src/server-app.js"), "utf8");
const correct = source.replace("phone: row.phone, ", "");
const ref = ".ifrim-hub/staging/privacy.mjs";
function temp(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "s0r-")); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; }
function write(dir, rel, text) { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); }
function execute(dir, text = protocol.text) {
  write(dir, ref, text);
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const run = spawnSync(process.execPath, ["--test", "--test-reporter=tap", ref], { cwd: dir, env, encoding: "utf8", timeout: 20000 });
  assert.ifError(run.error);
  const lines = run.stdout.split(/\r?\n/), counts = parseTestOutput(lines).counts;
  return { ...testStatus({ exitCode: run.status, counts, timedOut: false }), counts, ...parseTapCases(lines), output: run.stdout };
}
function proof(runs, text = protocol.text, m = manifest, extra = {}) {
  return classifyProof({ runs, manifest: m, criteria, workType: "FEATURE", spec: { changesExisting: true }, testRef: ref,
    test: { text, headerLines: text.split("\n").findIndex((l) => l === "// ---- corpul testului ----") + 1, refs: ["privacy.mjs"] }, ...extra });
}
function copy(t, text = source) { const dir = temp(t); fs.cpSync(app, dir, { recursive: true }); write(dir, "src/server-app.js", text); return dir; }

const oldRef = "test/hub/butonul-de-programare-trebuie-sa-84f571.test.mjs";
const oldText = fs.readFileSync(path.join(here, "fixtures/r-priv-old-hub-test.mjs.txt"), "utf8");
const oldSpec = { acceptance: [
  { id: "AC-1", text: "Fără telefon cererea este refuzată", verify: "test", testRef: oldRef },
  { id: "AC-2", text: "Telefonul este păstrat în listă", verify: "test", testRef: oldRef },
  { id: "AC-3", text: "Cererea validă este acceptată", verify: "test", testRef: oldRef, guard: true },
] };
const cmd = (t, type, payload) => t.hub.commands.dispatch({ type, payload, channel: "test", actor: "test" });
const stored = (t, id) => { const row = t.hub.db.prepare("SELECT * FROM factory_specs WHERE mission_id = ? ORDER BY version DESC LIMIT 1").get(id); return { row, prot: JSON.parse(row.protected_json), spec: JSON.parse(row.spec_json) }; };
const events = (t, type, id) => t.hub.db.prepare("SELECT payload_json FROM events WHERE type = ? AND scope_id = ? ORDER BY seq").all(type, id).map((r) => JSON.parse(r.payload_json));
async function prepareMission(t, input) { return (await cmd(t, "factory.prepare", { projectId: t.project.id, ...input, limits: { writerModel: "gpt-fake-sol", reviewerModel: "sonnet" } })).result.mission; }
async function stateHub() {
  const t = await makeTestHub({ queues: true });
  const dir = path.join(t.dataDir, "booking");
  materializeFixture("booking-demo", dir);
  fs.cpSync(app, dir, { recursive: true });
  write(dir, oldRef, oldText);
  t.dir = dir;
  t.project = (await cmd(t, "project.register_test", { path: dir })).result;
  t.old = await prepareMission(t, demoSpec("booking-demo"));
  const { row, spec } = stored(t, t.old.id);
  const p = { files: { [oldRef]: sha256(oldText) }, authoring: { status: "PROTECTED", testRef: oldRef, protectedSha: sha256(oldText) } };
  t.hub.db.prepare("UPDATE factory_specs SET status = 'APPROVED', spec_json = ?, protected_json = ? WHERE id = ?").run(JSON.stringify({ ...spec, ...oldSpec }), JSON.stringify(p), row.id);
  t.hub.db.prepare("UPDATE factory_missions SET stage = 'ACCEPTED', approved_spec_version = 1 WHERE mission_id = ?").run(t.old.id);
  const built = buildEngineeringSpec({ text: words, project: t.project, hubTests: [{ ref: oldRef, sha256: sha256(oldText), text: oldText, missionId: t.old.id, specVersion: 1, previousSpec: oldSpec }] });
  assert.deepEqual(built.problems, []);
  assert.equal(built.input.spec.supersedes.length, 1);
  t.child = await prepareMission(t, built.input);
  t.newSpec = stored(t, t.child.id).spec;
  return t;
}
async function start(t) {
  t.hub.bus.transaction(() => {
    t.hub.grants.create({ provider: "codex", projectId: t.project.id, access: "workspace-write", maxAttempts: 5, maxDurationS: 900, ttlMinutes: 60 }, "test");
    t.hub.grants.create({ provider: "claude", projectId: t.project.id, access: "read-only", maxAttempts: 5, maxDurationS: 900, ttlMinutes: 60 }, "test");
  });
  const req = await cmd(t, "factory.start", t.hub.factory.view(t.child.id).scope);
  await cmd(t, "approval.decide", { approvalId: req.approval.id, decision: "approved", displayedHash: req.approval.payloadHash });
  return t.hub.commands.executeApproved(req.command.id, "user");
}

const read = (name) => fs.readFileSync(path.join(fixture, name), "utf8");
const candidate = (prefix) => {
  const text = read(`${prefix}.test.mjs.txt`), m = JSON.parse(read(`${prefix}.manifest.json`));
  return { text, manifest: m, sha: sha256(text), headerLines: text.split("\n").findIndex((l) => l === "// ---- corpul testului ----") + 1 };
};
const c5 = candidate("c5-8b940d9b1476"), c6 = candidate("c6-8a4fd87d0908");
const amendBody = read("amend-reference.body.mjs.txt"), amendFile = assembleTestFile({ body: amendBody, needs: c5.manifest.needs });
const amend = { text: amendFile.text, manifest: { ...c5.manifest, amends: c5.sha, removed: [] }, headerLines: amendFile.header.length };
const insufficient = ["P77", "P100"].map((id) => ({ id, nature: "insufficient", why: "Căutarea literală trebuie completată cu JSON decodat." }));
const inv = (c) => assertionInventory(c.text, c.manifest, c);
const author = (body, m) => '```js\n' + body + '\n```\n```json\n' + JSON.stringify(m) + '\n```';
const reviewData = { changeSet: "a".repeat(12), verdict: "PASS", summary: "Verificările sunt complete.", criteria: criteria.map((c) => ({ id: c.id, covered: true, failsForRightReason: true, canEverPass: true, contradictsOwner: false, trivialPassRisk: "low", plain: "Criteriul este verificat complet." })), findings: [], missingContext: [] };
const review = (data = {}, opts = {}) => parseTestReview('```json\n' + JSON.stringify({ ...reviewData, ...data }) + '\n```', { testSha: "a".repeat(64), criteria, ...opts });

test("T-AMEND-01", () => {
  assert.ok(c5.sha.startsWith("8b940d9b1476")); assert.ok(c6.sha.startsWith("8a4fd87d0908"));
  const diff = compareInventory(c5, amend), entries = inv(c5);
  assert.deepEqual(diff.removed, []); assert.equal(diff.matched.length, entries.length);
  assert.ok(entries.every((p) => inv(amend).some((n) => n.test === p.test && n.statement === p.statement)));
  for (const id of ["AC-1", "AC-2"]) assert.ok(diff.contextChanged.some((e) => e.criterion === id && e.reasons.includes("case_flow")));
  assert.ok(entries.every((e) => e.sha === c5.sha && e.kind));
  assert.equal(parseAuthorOutput(author(amendBody, amend.manifest), { amends: c5.sha, criteria, workType: "FEATURE" }).ok, true);
  assert.deepEqual(amendmentViolations(diff.removed, [], insufficient), []);
  const lost = compareInventory(c5, c6);
  assert.deepEqual(lost.removed.map((e) => e.id), ["P75", "P76", "P77", "P98", "P99", "P100"]);
  const violations = amendmentViolations(lost.removed, [], insufficient);
  assert.equal(violations[0].rule, "coverage_insufficient_removed"); assert.equal(violations[0].detail, "P77, P100");
  assert.equal(amendmentViolations([], [{ id: "P77" }], insufficient)[0].rule, "coverage_insufficient_removed");
  assert.deepEqual(amendmentViolations(lost.removed, [], [{ id: "P77", why: "Căutarea literală trebuie completată cu JSON decodat." }]), []);
  const previousCandidate = { ...c5, inventory: entries, proof: { verdict: "PROVEN", reasons: ["două rulări"] }, review: { ...JSON.parse(read("c5-8b940d9b1476.review.json")), checks: insufficient } };
  const brief = buildAuthorBrief({ cycle: 1, previousCandidate, previousProblems: ["completare JSON"], spec: { acceptance: criteria } });
  assert.ok(brief.includes(`Repari varianta anterioară (sha ${c5.sha})`));
  assert.ok(brief.includes("„O verificare insuficientă se completează. O verificare greșită poate fi corectată sau înlocuită, cu justificare și verificare independentă.”"));
  assert.match(brief, /77\|/); assert.match(brief, /insufficient/); assert.match(brief, /completare JSON/);
  assert.match(brief, /O verificare clasificată insufficient \(insuficientă\) sau criticată fără clasificare se PĂSTREAZĂ și se completează/);
  assert.match(brief, /declară-o în removed/);
  const rb = buildTestReviewBrief({ cycle: 1, previousCandidate, inventory: inv(amend), contextChanged: diff.contextChanged });
  assert.match(rb, /Verificări de judecat/); assert.match(rb, /text păstrat, context schimbat/); assert.match(rb, /afirmația autorului \(nu e dovadă\)/);
  assert.match(rb, /clasifică-o în checks/);
  assert.ok(rb.includes("O verificare eliminată pe care review-ul anterior a criticat-o (cu sau fără clasificare) și pe care autorul nu a demonstrat-o ca fiind greșită primește verdictul lost."));
});

function synthetic(text, names = ["AC-1: răspuns"]) {
  return { text, manifest: { cases: names.map((name) => ({ name, criterion: name.slice(0, 4), kind: "check", today: "fail" })) }, sha: "b".repeat(64) };
}

test("T-AMEND-03", () => {
  const rehearsalReview = JSON.parse(read("r1-review0.parsed.json"));
  const review = { ...rehearsalReview, findings: rehearsalReview.findings.slice(0, 2), checks: rehearsalReview.checks.filter((c) => ["P76", "P77"].includes(c.id)), gate: [] };
  const previousCandidate = { ...c5, inventory: inv(c5), review };
  const items = completionItems(previousCandidate);
  assert.deepEqual(items.map((item) => item.ref), ["F1", "F2", "P76", "P77"]);
  assert.ok(items[0].text.includes(review.findings[0].severity));
  assert.ok(items[0].text.includes(review.findings[0].impact));
  for (const check of review.checks) {
    const item = items.find((item) => item.ref === check.id);
    assert.ok(item.text.includes(previousCandidate.inventory.find((entry) => entry.id === check.id).statement));
    assert.ok(item.text.includes(check.why));
  }
  const numbered = items.map((item, i) => `${i + 1}. ${item.text}`).join("\n");
  const brief = buildAuthorBrief({ cycle: 1, previousCandidate, spec: { acceptance: criteria } });
  assert.ok(brief.includes("### Ce trebuie completat (fiecare punct are nevoie de cel puțin o verificare nouă)\n" + numbered));
  assert.ok(brief.indexOf(numbered) < brief.indexOf("1| "));
  assert.ok(brief.includes("Pentru fiecare punct adaugă o verificare care ar pica pe o implementare cu exact acea scăpare; păstrează verificările existente."));
  assert.ok(!buildAuthorBrief({ cycle: 0 }).includes('"completes"'));
  assert.ok(brief.includes("intrările invalide sunt ignorate"));
  const completes = items.map(({ ref }) => ({ ref, by: "AC-1: verifică noua scăpare pe răspunsul JSON decodat" }));
  const m = { ...amend.manifest, completes };
  const parse = (completes) => parseAuthorOutput(author(amendBody, { ...m, completes }), { amends: c5.sha, criteria, workType: "FEATURE" });
  const parsed = parse(completes);
  assert.equal(parsed.ok, true); assert.deepEqual(parsed.manifest.completes, completes);
  assert.deepEqual(parsed.manifest.completesNotes, []);
  for (const ref of ["F1", "P77", "P1.2", "AC-1", "AC-123"]) assert.equal(parse([{ ref, by: "a".repeat(10) }]).ok, true);
  assert.equal(parse([{ ref: "F1", by: "a".repeat(300) }]).ok, true);
  for (const invalid of [{}, null, [null], ["F1"], [{ ref: "F0", by: completes[0].by }], [{ ref: "P01", by: completes[0].by }], [{ ref: "AC-1234", by: completes[0].by }], [{ ref: "F1", by: "short" }], [{ ref: "F1", by: "a".repeat(301) }]]) {
    const result = parse(invalid);
    assert.equal(result.ok, true); assert.deepEqual(result.problems, []);
    assert.deepEqual(result.manifest.completes, []);
    assert.equal(result.manifest.completesNotes.length, 1);
    assert.match(result.manifest.completesNotes[0], /completes: .*ignorat/);
    assert.deepEqual(completionSignals(previousCandidate, result.manifest.completes).map((entry) => entry.detail), items.map((item) => item.ref));
    if (Array.isArray(invalid)) {
      const mixed = parse([completes[1], ...invalid, ...completes.slice(2)]);
      assert.equal(mixed.ok, true); assert.deepEqual(mixed.problems, []);
      assert.deepEqual(mixed.manifest.completes, completes.slice(1));
      assert.deepEqual(mixed.manifest.completesNotes, result.manifest.completesNotes);
      assert.deepEqual(completionSignals(previousCandidate, mixed.manifest.completes), [{ signal: "completion_unmapped", plain: "un punct de completat nu are o verificare nouă declarată", detail: "F1", line: null }]);
    }
  }
  assert.equal(parse(undefined).ok, true);
  const lint = lintTestBody(amendBody, { manifest: m, criteria, workType: "FEATURE", testRef: "test/hub/privacy.test.mjs", stagingRef: ref, projectFiles: ["src/server-app.js"], moduleExports: { "src/server-app.js": exportNamesOf(source) } });
  const before = [...lint.signals];
  lint.signals.push(...completionSignals(previousCandidate, completes.filter((entry) => entry.ref !== "P77")));
  assert.deepEqual(lint.signals.slice(before.length), [{ signal: "completion_unmapped", plain: "un punct de completat nu are o verificare nouă declarată", detail: "P77", line: null }]);
  assert.equal(lint.ok, true); assert.deepEqual(lint.violations, []);
  assert.deepEqual(completionSignals(previousCandidate, completes), []);
  assert.equal(completionSignals(previousCandidate).length, items.length);
  const rb = buildTestReviewBrief({ cycle: 1, previousCandidate, manifest: m });
  assert.ok(rb.includes(numbered));
  assert.ok(rb.includes('### completes — afirmația autorului (nu e dovadă)\n```json\n' + JSON.stringify(completes, null, 2)));
  assert.ok(rb.includes("un punct rămas deschis este un finding și face criteriul aferent neacoperit (covered: false)"));
  assert.ok(!buildTestReviewBrief({ cycle: 0, previousCandidate, manifest: m }).includes("### Ce trebuie completat"));
  const fallback = { ...c5, findings: review.findings, review: { checks: review.checks, gate: [{ id: "AC-1", why: ["nu e acoperit", "risc ridicat"] }, { id: "P77", why: "nu este un criteriu" }] } };
  assert.deepEqual(completionItems(fallback).slice(0, 4), items);
  assert.deepEqual(completionItems(fallback).at(-1), { ref: "AC-1", text: "AC-1: nu e acoperit; risc ridicat" });
  const hostile = { findings: Array.from({ length: 35 }, () => ({ severity: "high", observation: "```\napi_key=synthetic-secret-value " + "x".repeat(500) })) };
  const bounded = completionItems(hostile);
  assert.equal(bounded.length, 30);
  assert.ok(bounded.every((item, i) => `${i + 1}. ${item.text}`.length <= 400 && !/[\r\n]/.test(item.text) && !item.text.includes("```") && !item.text.includes("synthetic-secret-value") && item.text.includes("[redacted]")));
});
test("T-AMEND-02", () => {
  const before = synthetic('test("AC-1: răspuns", async () => { assert.equal(post.phone, undefined); });');
  const after = synthetic('test("AC-1: răspuns", async () => { assert.equal(get.phone, undefined); });');
  const diff = compareInventory(before, after), id = diff.removed[0].id, nextId = inv(after)[0].id;
  const removed = [{ id, basis: "wrong", why: "Răspunsul de creare nu este vizat de cerință.", by: "Verificarea răspunsului GET" }];
  const m = { ...after.manifest, amends: before.sha, removed };
  assert.equal(parseAuthorOutput(author(after.text, m), { amends: before.sha }).ok, true);
  assert.deepEqual(amendmentViolations(diff.removed, removed, [{ id, nature: "wrong" }]), []);
  const opts = { inventoryRemoved: diff.removed, inventory: inv(after) };
  const answer = { verdict: "replaced_correctly", by: [nextId], why: "Verifică lista publică cerută de proprietar." };
  assert.equal(review({ previousChecks: { [id]: answer } }, opts).verdict, "PASS");
  for (const bad of [{ ...answer, by: [] }, { ...answer, by: ["P999"] }, { verdict: "replaced_correctly", why: answer.why }, "kept", "replaced_correctly"]) assert.equal(review({ previousChecks: { [id]: bad } }, opts).verdict, "INCONCLUSIVE");
  for (const bad of [{ ...m, removed: [{ ...removed[0], basis: "insufficient" }] }, { ...m, amends: undefined }, { ...m, amends: "c".repeat(64) }, { ...m, removed: [...removed, ...removed] }]) assert.equal(parseAuthorOutput(author(after.text, bad), { amends: before.sha }).ok, false);
  assert.equal(parseAuthorOutput(author(after.text, m)).ok, false);
  assert.equal(parseAuthorOutput(author(after.text, { ...m, amends: before.sha.toUpperCase() }), { amends: before.sha }).manifest.amends, before.sha);
  const classified = review({ checks: [{ id: nextId, nature: "wrong", why: answer.why }, { id: "P999", nature: "wrong", why: answer.why }, { id: nextId, nature: "other", why: answer.why }] }, { inventory: inv(after) });
  assert.equal(classified.verdict, "PASS"); assert.equal(classified.checks.length, 1); assert.equal(classified.notes.length, 2);
  const both = review({ checks: ["wrong", "insufficient"].map((nature) => ({ id: nextId, nature, why: answer.why })) }, { inventory: inv(after) });
  assert.equal(both.checks.length, 2); assert.equal(amendmentViolations([{ id: nextId }], [], both.checks).length, 1);
});

test("T-INV-01", () => {
  const before = synthetic('test("AC-1: răspuns", async () => { assert.ok(a, "mesaj"); assert.equal(b, 2, "alt mesaj"); });');
  const entries = inv(before); assert.deepEqual(entries.map((e) => e.id), ["P1.1", "P1.2"]);
  const after = { ...before, text: before.text.replace('assert.ok(a, "mesaj"); ', '') };
  assert.deepEqual(compareInventory(before, after).removed.map((e) => e.id), ["P1.1"]);
  assert.deepEqual(compareInventory(before, { ...before, text: before.text.replace('"mesaj"', '"altul"') }).removed, []);
  for (const id of ["P77", "P100"]) {
    const entry = inv(c5).find((e) => e.id === id);
    assert.ok(entry.statement.includes("!getRes.body.includes(PHONE)"));
    assert.ok(JSON.parse(read("c5-8b940d9b1476.review.json")).findings.some((f) => f.evidence.includes(id.slice(1))));
  }
  const nested = synthetic('test("AC-1: răspuns", async () => { assert.deepStrictEqual(fn(a, { x: [1, 2] }), [3, 4], "msg, x"); assert.throws(fn, /bad/, "msg"); });');
  assert.ok(!inv(nested)[0].key.includes("msg")); assert.ok(inv(nested)[1].key.includes("msg"));
});

test("T-INV-02", () => {
  const before = synthetic('test("AC-1: răspuns", async () => { assert.ok(a); });\ntest("AC-2: altul", async () => { assert.ok(b); });', ["AC-1: răspuns", "AC-2: altul"]);
  const moved = { ...before, text: 'test("AC-1: răspuns", async () => {});\ntest("AC-2: altul", async () => { assert.ok(a); assert.ok(b); });' };
  assert.deepEqual(compareInventory(before, moved).removed.map((e) => e.id), ["P1"]);
  const renamed = synthetic(before.text.replaceAll("AC-1: răspuns", "AC-1: redenumit"), ["AC-1: redenumit", "AC-2: altul"]);
  assert.equal(compareInventory(before, renamed).matched.length, 2);
  const changedCriterion = { ...before, manifest: { cases: before.manifest.cases.map((c) => ({ ...c, criterion: "AC-3" })) } };
  assert.equal(compareInventory(before, changedCriterion).removed.length, 2);
  const empty = synthetic('test("AC-1: răspuns", async () => { assert.ok(a); });\ntest("AC-1: gol", async () => {});', ["AC-1: răspuns", "AC-1: gol"]);
  const movedToEmpty = synthetic('test("AC-1: gol", async () => { assert.ok(a); });', ["AC-1: gol"]);
  assert.equal(compareInventory(empty, movedToEmpty).removed.length, 1);
  const ambiguous = synthetic('test("AC-1: nou", async () => { assert.ok(a); });\ntest("AC-1: altul", async () => {});', ["AC-1: nou", "AC-1: altul"]);
  assert.equal(compareInventory(empty, ambiguous).removed.length, 1);
});

test("T-INV-03", () => {
  const before = synthetic('function leaks(x) { return x.includes(PHONE); }\nconst PHONE = "0712345678";\ntest("AC-1: răspuns", async () => { const data = { phone: PHONE }; assert.ok(!leaks(data.phone)); });');
  for (const [text, reason] of [[before.text.replace('x.includes(PHONE)', 'x === PHONE'), 'helper:leaks'], [before.text.replace('{ phone: PHONE }', '{ phone: "" }'), 'case_flow'], [before.text.replace('const PHONE = "0712345678";', ''), 'helper:PHONE']]) {
    const after = { ...before, text }, diff = compareInventory(before, after);
    assert.deepEqual(diff.removed, []); assert.ok(diff.contextChanged[0].reasons.includes(reason));
    const opts = { contextChanged: diff.contextChanged, inventory: inv(after) }, id = diff.contextChanged[0].id;
    assert.equal(review({}, opts).verdict, "INCONCLUSIVE");
    assert.equal(review({ previousChecks: { [id]: "lost" } }, opts).verdict, "CHANGES_REQUESTED");
    assert.equal(review({ previousChecks: { [id]: "kept" } }, opts).verdict, "PASS");
    assert.equal(review({ previousChecks: { [id]: { verdict: "replaced_correctly" } } }, opts).verdict, "INCONCLUSIVE");
  }
  for (const declaration of ['const unused = 0, PHONE = "one";', 'let PHONE = "one";', 'var PHONE = "one";', 'class PHONE { value() { return "one"; } }', 'const { phone: PHONE } = { phone: "one" };']) {
    const old = synthetic(declaration + '\ntest("AC-1: răspuns", async () => { assert.ok(PHONE); });');
    const diff = compareInventory(old, { ...old, text: old.text.replace('"one"', '"two"') });
    assert.ok(diff.contextChanged[0].reasons.includes("helper:PHONE"), declaration);
  }
  const transitive = synthetic('function walk(x){return x.includes(\'1\')}\nfunction leaks(x){return walk(x)}\ntest("AC-1: răspuns", () => { assert.ok(!leaks(app)); });');
  for (const text of [transitive.text.replace("return x.includes('1')", "return false;"), transitive.text.replace("function walk(x){return x.includes('1')}\n", "")]) {
    const after = { ...transitive, text }, diff = compareInventory(transitive, after);
    assert.deepEqual(diff.removed, []); assert.equal(diff.contextChanged.length, 1);
    assert.deepEqual(diff.contextChanged[0].reasons, ["helper:walk"]);
    assert.equal(review({}, { contextChanged: diff.contextChanged, inventory: inv(after) }).verdict, "INCONCLUSIVE");
  }
  const recursive = { ...transitive, text: transitive.text.replace("return x.includes('1')", "return x.includes('1') || leaks(x)") };
  assert.deepEqual(compareInventory(recursive, recursive).contextChanged, []);
  assert.deepEqual(compareInventory(recursive, { ...recursive, text: recursive.text.replace("return x.includes('1') || leaks(x)", "return false;") }).contextChanged[0].reasons, ["helper:walk"]);
  const names = ["AC-1: răspuns", "AC-2: control"];
  for (const setup of ['before(() => { app = start(1) });', 'beforeEach(() => { app = start(1) });', 'after(() => { stop(1) });', 'afterEach(() => { stop(1) });', 'app = start(1);']) {
    const old = synthetic(`let app;\n${setup}\ntest("${names[0]}", () => { assert.ok(app); });\ntest("${names[1]}", () => { assert.equal(2, 2); });`, names);
    assert.deepEqual(compareInventory(old, old).contextChanged, []);
    for (const text of [old.text.replace(setup, setup.replace("(1)", "(2)")), old.text.replace(setup, ""), old.text + '\nconfigure(2);']) {
      const after = { ...old, text }, diff = compareInventory(old, after);
      assert.deepEqual(diff.removed, []); assert.equal(diff.matched.length, 2); assert.equal(diff.contextChanged.length, 2);
      for (const entry of diff.contextChanged) assert.deepEqual(entry.reasons, ["setup"], setup);
      const opts = { contextChanged: diff.contextChanged, inventory: inv(after) };
      assert.equal(review({}, opts).verdict, "INCONCLUSIVE");
      assert.equal(review({ previousChecks: Object.fromEntries(diff.contextChanged.map((e) => [e.id, "lost"])) }, opts).verdict, "CHANGES_REQUESTED");
    }
  }
});

test("T-S25-01", (t) => {
  const lint = lintTestBody(amendBody, { manifest: amend.manifest, criteria, workType: "FEATURE", testRef: "test/hub/privacy.test.mjs", stagingRef: ref, projectFiles: ["src/server-app.js"], moduleExports: { "src/server-app.js": exportNamesOf(source) } });
  assert.deepEqual(lint.violations, []);
  const dir = copy(t), p = proof([execute(dir, amend.text), execute(dir, amend.text)], amend.text, amend.manifest);
  assert.equal(p.verdict, "PROVEN", JSON.stringify(p)); assert.deepEqual(p.failingCriteria, ["AC-1", "AC-2"]);
  assert.ok(p.table.filter((r) => r.today === "fail").every((r) => r.origin === "behaviour" && r.at));
  const good = execute(copy(t, correct), amend.text); assert.equal(good.status, "PASS", good.output); assert.equal(good.counts.tests, 5);
});
function assertionFailure(run, privacy = false) {
  assert.equal(run.status, "FAIL", run.output);
  assert.ok(run.cases.some((c) => c.code === "ERR_ASSERTION"), run.output);
  assert.ok(!run.cases.some((c) => /^HUB_/.test(c.message || "")), run.output);
  if (privacy) for (const id of ["AC-1", "AC-2"]) assert.ok(run.cases.some((c) => c.name.startsWith(id + ":") && c.code === "ERR_ASSERTION"), run.output);
}
test("T-S25-02", (t) => assertionFailure(execute(copy(t), amend.text), true));

const listLine = 'return sendJson(req, res, 200, { date: day.date, bookings: sql.ofDay.all(day.date).map(publicBooking) });';
const variants = {
  "refuse-all": correct.replace('if (!phone) errors.phone', 'if (true) errors.phone'),
  "phone lost on save": correct.replace('name, vehicle, phone, 0,', 'name, vehicle, "", 0,'),
  "browser-only validation": correct.replace('if (!phone) errors.phone = "Telefonul este obligatoriu";', ''),
  "masked value": source.replace('phone: row.phone,', 'phone: "***",'),
  "includePhone bypass": correct.replace('map(publicBooking)', 'map((r) => query.has("includePhone") ? { ...publicBooking(r), phone: r.phone } : publicBooking(r))'),
  "debug other key": correct.replace('map(publicBooking)', 'map((r) => query.has("debug") ? { ...publicBooking(r), extra: r.phone } : publicBooking(r))'),
  "empty list": correct.replace('sql.ofDay.all(day.date).map(publicBooking)', '[]'),
  "invalid request saved": correct.replace('if (Object.keys(errors).length) return invalid(req, res, errors);\n\n    const endMin', 'if (Object.keys(errors).length) { sql.insert.run("bad", service.id, slot.date, slot.startMin, slot.startMin + service.durationMin, name, vehicle, phone, 0, at.toISOString()); return invalid(req, res, errors); }\n\n    const endMin'),
  "missing-property accepted": correct.replace('if (!phone) errors.phone', 'if (Object.hasOwn(input, "phone") && !phone) errors.phone'),
  "id only in metadata": correct.replace(listLine, 'return sendJson(req, res, 200, { date: day.date, bookings: [], ids: sql.ofDay.all(day.date).map((r) => r.id) });'),
  "fields=phone other key": correct.replace('map(publicBooking)', 'map((r) => query.get("fields") === "phone" ? { ...publicBooking(r), contact: r.phone } : publicBooking(r))'),
  "phone in text": correct.replace('map(publicBooking)', 'map((r) => ({ ...publicBooking(r), note: "Tel " + r.phone + " (sună)" }))'),
  "phone as key": correct.replace('map(publicBooking)', 'map((r) => ({ ...publicBooking(r), [r.phone]: true }))'),
  "escaped key and value": source.replace(listLine, read("variant-escape-key-value.js.txt").trim()),
  "escaped value other key": correct.replace(listLine, read("variant-escape-other-key.js.txt").trim()),
  "existing records only": correct.replace('map(publicBooking)', 'map((r) => r.start_min >= 660 ? { ...publicBooking(r), phone: r.phone } : publicBooking(r))'),
};
test("T-S25-03", (t) => {
  for (const name of ["phone in text", "phone as key", "escaped key and value", "escaped value other key"]) {
    assert.notEqual(variants[name], correct); assertionFailure(execute(copy(t, variants[name]), amend.text), true);
    const live = execute(copy(t, variants[name]), name.startsWith("escaped") ? c5.text : c6.text);
    assert.equal(live.status, "PASS", `${name}: ${live.output}`);
  }
});
test("T-S25-04", (t) => {
  assert.equal(Object.keys(variants).length, 16);
  for (const [name, src] of Object.entries(variants).filter(([name]) => !["phone in text", "phone as key", "escaped key and value", "escaped value other key"].includes(name))) {
    assert.notEqual(src, correct, name); assertionFailure(execute(copy(t, src), amend.text));
    if (["id only in metadata", "existing records only"].includes(name)) { const live = execute(copy(t, src), c5.text); assert.equal(live.status, "PASS", live.output); }
  }
});

test("T-AMEND-04", (t) => {
  const r1 = candidate("r1-a26a0bca8061");
  assert.equal(r1.sha, "a26a0bca8061d375d28c66c47b7cffeacfef380019967cc1513227d16d024923");
  assert.deepEqual(compareInventory(c5, r1).removed, []);
  assert.deepEqual(r1.manifest.removed, []);
  const previousCandidate = { ...c5, review: JSON.parse(read("r1-review0.parsed.json")) };
  const items = completionItems(previousCandidate);
  for (const ref of ["F2", "P76", "P77", "P99", "P100"]) assert.match(items.find((item) => item.ref === ref)?.text || "", /escape/i);
  for (const id of ["AC-1", "AC-2", "AC-3"]) assert.ok(items.some((item) => item.ref === id));
  const good = execute(copy(t, correct), r1.text);
  assert.equal(good.status, "PASS", good.output); assert.equal(good.counts.tests, 5);
  assertionFailure(execute(copy(t), r1.text), true);
  for (const [name, src] of Object.entries(variants)) {
    assert.notEqual(src, correct, name);
    const run = execute(copy(t, src), r1.text);
    if (name === "escaped value other key") { assert.equal(run.status, "PASS", `${name}: ${run.output}`); assert.equal(run.counts.tests, 5); }
    else assertionFailure(run);
  }
});

test("T-GATE-01", { timeout: 120000 }, async (t) => {
  assert.equal(review({ previousChecks: { P77: "lost" } }, { inventoryRemoved: [{ id: "P77" }] }).verdict, "CHANGES_REQUESTED");
  assert.equal(review({}, { inventoryRemoved: [{ id: "P77" }] }).verdict, "INCONCLUSIVE");
  const setupFile = assembleTestFile({ body: 'test("AC-1: pregătire", async () => { await setup("pornire", () => { throw new Error("broken"); }); assert.equal(1 + 1, 3); });' });
  const setupRun = execute(copy(t), setupFile.text), setupManifest = { cases: [{ name: "AC-1: pregătire", criterion: "AC-1", kind: "check", today: "fail" }] };
  assert.equal(proof([setupRun, setupRun], setupFile.text, setupManifest, { criteria: [criteria[0]] }).verdict, "WRONG_REASON");
  for (const success of [false, true]) {
    const h = await stateHub(), rename = fs.renameSync; let paused = false;
    try {
      await enableLive(h.hub, { provider: "codex", access: "workspace-write", attempts: 1 });
      h.queue("claude", "author:amend-c5", success ? "author:amend-keep" : "author:amend-c6");
      h.queue("codex", "test-review:amend-insufficient", "test-review:amend-pass");
      if (success) fs.renameSync = function(from, to) {
        const result = rename.apply(this, arguments);
        if (!paused && String(to).replaceAll("\\", "/").endsWith(h.newSpec.authoring.testRef)) { paused = true; h.hub.factory.pause(h.child.id).catch(() => {}); }
        return result;
      };
      await start(h);
      await waitFor(() => success ? paused : stored(h, h.child.id).prot.authoring?.blocked?.kind === "exhausted", 100000, 50);
      await h.hub.factory.idle(h.child.id);
      const p = stored(h, h.child.id).prot, a = p.authoring;
      assert.equal(h.hub.factory.writerStarted(h.child.id), false); assert.ok(a.cycle <= h.newSpec.authoring.reauthorMax);
      assert.equal(a.rejected[0].review.checks.length, 2);
      const validation = JSON.parse(h.hub.db.prepare("SELECT validation_json FROM factory_reviews WHERE mission_id = ? ORDER BY created_at LIMIT 1").get(h.child.id).validation_json);
      assert.equal(validation.checks.length, 2);
      if (success) {
        assert.equal(a.status, "PROTECTED"); assert.deepEqual(a.candidate.inventoryRemoved, []); assert.ok(a.candidate.contextChanged.length > 0);
        const completion = a.candidate.lint.signals.filter((s) => s.signal === "completion_unmapped");
        assert.deepEqual(completion.map((s) => s.detail), completionItems({ ...c5, review: a.rejected[0].review, findings: a.rejected[0].findings }).map((item) => item.ref));
        assert.ok(completion.length > 0);
        const current = assertionInventory(fs.readFileSync(path.join(h.dir, a.testRef), "utf8"), a.candidate.manifest, { headerLines: a.candidate.headerLines, sha: a.candidate.sha });
        assert.ok(a.candidate.contextChanged.every((e) => current.some((n) => n.id === e.nextId && n.test === e.test)));
        assert.equal(events(h, "factory.test_review", h.child.id).length, 2);
        assert.equal(events(h, "factory.acceptance_protected", h.child.id).length, 1);
      } else {
        assert.equal(h.hub.factory.view(h.child.id).factory.stage, "NEEDS_OWNER_DECISION");
        assert.ok(a.rejected.at(-1).candidate.lint.violations.some((v) => v.rule === "coverage_insufficient_removed"));
        assert.equal(events(h, "factory.test_review", h.child.id).length, 1);
        assert.equal(events(h, "factory.acceptance_protected", h.child.id).length, 0);
        assert.equal(readRetireJournal(h.project, h.child.id), null); assert.equal(fs.readFileSync(path.join(h.dir, oldRef), "utf8"), oldText);
        assert.equal(fs.existsSync(path.join(h.dir, h.newSpec.authoring.testRef)), false);
      }
    } finally { fs.renameSync = rename; await h.cleanup(); }
  }
  const h = await stateHub();
  try {
    await enableLive(h.hub, { provider: "codex", access: "workspace-write", attempts: 1 });
    h.queue("claude", "author:amend-c5", "author-slow:amend-keep"); h.queue("codex", "test-review:amend-insufficient");
    await start(h);
    await waitFor(() => stored(h, h.child.id).prot.authoring?.cycle === 1 && h.hub.factory.view(h.child.id).factory.stage === "TEST_AUTHORING", 30000, 30);
    const a = stored(h, h.child.id).prot.authoring, previousSha = a.rejected[0].sha;
    const find = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? find(path.join(dir, e.name)) : e.name === previousSha ? [path.join(dir, e.name)] : []);
    const blobs = find(h.dataDir); assert.ok(blobs.length > 0);
    for (const file of blobs) fs.writeFileSync(file, "altered previous candidate");
    await waitFor(() => stored(h, h.child.id).prot.authoring?.blocked?.kind === "previous_missing", 20000, 30);
    await h.hub.factory.idle(h.child.id);
    const held = stored(h, h.child.id).prot.authoring;
    assert.deepEqual(held.blocked.details, ["copia variantei anterioare lipsește sau are alți octeți"]);
    assert.equal(held.candidate, null); assert.equal(held.cycle, 1);
    assert.equal(h.hub.factory.writerStarted(h.child.id), false); assert.equal(readRetireJournal(h.project, h.child.id), null);
    assert.equal(events(h, "factory.acceptance_protected", h.child.id).length, 0);
  } finally { await h.cleanup(); }
});

