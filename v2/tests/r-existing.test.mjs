import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { hubHelperIdentity, assembleTestFile, parseTapCases, classifyProof, lintTestBody, exportNamesOf, assertionInventory, compareInventory, removedAssertions } from "../server/factory/test-first.mjs";
import { parseTestOutput, testStatus } from "../server/factory/runner.mjs";
import { deriveCriteria } from "../server/owner/planners/criteria.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, "fixtures/stage0-s25");
const app = path.join(here, "fixtures/r-priv-booking");
const read = (name) => fs.readFileSync(path.join(fixture, name), "utf8");
const words = "Telefonul rămâne obligatoriu la programare și este salvat corect, dar lista publică a zilei nu afișează și nu transmite telefonul.";
const derived = deriveCriteria({ words });
const criteria = derived.test.map((c, i) => ({ ...c, id: `AC-${i + 1}`, verify: "test" }));
const helpers = ["json-exposure"], spec = { changesExisting: true, hubHelpers: helpers, acceptance: criteria };
const manifest = JSON.parse(read("existing-reference.manifest.json")), body = read("existing-reference.body.mjs.txt");
const protocol = assembleTestFile({ body, needs: manifest.needs, helpers });
const source = fs.readFileSync(path.join(app, "src/server-app.js"), "utf8").replaceAll("\r\n", "\n");
const correct = source.replace("phone: row.phone, ", "");
const jsonManifest = JSON.parse(read("json-reference.manifest.json"));
const jsonReference = assembleTestFile({ body: read("json-reference.body.mjs.txt"), needs: jsonManifest.needs, helpers }).text;
const rh1 = read("rh1-c57c518694c7.test.mjs.txt");

test("T-INVENTORY-TOPLEVEL", () => {
  const candidate = { text: protocol.text, manifest, headerLines: protocol.header.length, sha: protocol.sha256 };
  const inventory = assertionInventory(candidate.text, manifest, candidate);
  const same = compareInventory(inventory, candidate);
  assert.deepEqual(same.removed, []);
  assert.deepEqual(same.contextChanged, []);
  assert.equal(same.matched.length, inventory.length);
  const topLevel = inventory.filter((e) => e.test === null);
  assert.equal(topLevel.length, 2);
  assert.ok(topLevel.every((e) => e.helper === "freeStart"));
  assert.deepEqual(removedAssertions(inventory, body), []);

  const changedBody = body.replace("aplicația oferă un interval liber fără suprapunere", "intervalul liber este disponibil");
  assert.notEqual(changedBody, body);
  const changedFile = assembleTestFile({ body: changedBody, needs: manifest.needs, helpers });
  const changed = compareInventory(inventory, { ...candidate, text: changedFile.text });
  const slot = topLevel.find((e) => e.statement.startsWith("assert.ok(slot,"));
  assert.ok(slot);
  assert.deepEqual(changed.removed, []);
  for (const entry of topLevel) assert.ok(changed.contextChanged.some((e) => e.id === entry.id && e.reasons.includes("helper:freeStart")), entry.id);
  const callers = Object.entries(inventory.context.cases).filter(([, c]) => /\bfreeStart\s*\(/.test(c.code)).map(([name]) => name);
  assert.ok(callers.length > 0);
  for (const entry of inventory.filter((e) => callers.includes(e.test))) {
    assert.ok(changed.contextChanged.some((e) => e.id === entry.id && e.reasons.includes("helper:freeStart")), entry.id);
  }

  const changedCheck = body.replace("assert.ok(slot,", "assert.ok(slot.start,");
  assert.notEqual(changedCheck, body);
  const checkFile = assembleTestFile({ body: changedCheck, needs: manifest.needs, helpers });
  assert.deepEqual(compareInventory(inventory, { ...candidate, text: checkFile.text }).removed.map((e) => e.id), [slot.id]);
  assert.deepEqual(removedAssertions(inventory, changedCheck).map((e) => e.id), [slot.id]);

  const json = { text: jsonReference, manifest: jsonManifest, headerLines: protocol.header.length };
  const jsonInventory = assertionInventory(json.text, json.manifest, json);
  const jsonSame = compareInventory(jsonInventory, json);
  assert.deepEqual(jsonSame.removed, []);
  assert.deepEqual(jsonSame.contextChanged, []);
  assert.equal(jsonSame.matched.length, jsonInventory.length);
});

const ref = ".ifrim-hub/staging/privacy.mjs";
function temp(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "r-existing-")); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; }
function write(dir, rel, text) { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); }
function copy(t, text = source) { const dir = temp(t); fs.cpSync(app, dir, { recursive: true }); write(dir, "src/server-app.js", text); return dir; }
function execute(dir, text = protocol.text) {
  write(dir, ref, text);
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const run = spawnSync(process.execPath, ["--test", "--test-reporter=tap", ref], { cwd: dir, env, encoding: "utf8", timeout: 20000 });
  assert.ifError(run.error);
  const lines = run.stdout.split(/\r?\n/), counts = parseTestOutput(lines).counts;
  return { ...testStatus({ exitCode: run.status, counts, timedOut: false }), counts, ...parseTapCases(lines), output: run.stdout };
}
function proof(runs, text = protocol.text, m = manifest, extra = {}) {
  return classifyProof({ runs, manifest: m, criteria, workType: "FEATURE", spec, testRef: ref,
    test: { text, headerLines: text.split("\n").findIndex((l) => l === "// ---- corpul testului ----") + 1, refs: ["privacy.mjs"] }, ...extra });
}
function assertionFailure(run) {
  assert.equal(run.status, "FAIL", run.output);
  assert.equal(run.counts.tests, 5, run.output);
  assert.ok(run.cases.some((c) => !c.ok), run.output);
  assert.ok(run.cases.filter((c) => !c.ok).every((c) => c.code === "ERR_ASSERTION" && !/^HUB_/.test(c.message || "")), run.output);
}
const listLine = 'return sendJson(req, res, 200, { date: day.date, bookings: sql.ofDay.all(day.date).map(publicBooking) });';
const atRestart = (statement) => correct.replace('  let closed = false;', `  ${statement}\n  let closed = false;`);
const rememberExisting = atRestart('const existingIds = new Set(db.prepare("SELECT id FROM bookings").all().map((r) => r.id));');
const existingVariants = {
  "seed ignored, leak only before restart": rememberExisting.replace('if (!seed) return;', 'return;').replace('map(publicBooking)', 'map((r) => existingIds.has(r.id) ? { ...publicBooking(r), phone: r.phone } : publicBooking(r))'),
  "existing record absent after restart": atRestart('db.exec("DELETE FROM bookings");'),
  "existing record on another day": atRestart('db.exec("UPDATE bookings SET day = char(50,48,50,54,45,49,48,45,49,50)");'),
  "existing phone not persisted": atRestart('db.exec("UPDATE bookings SET phone = char(32)");'),
};
const listVariants = {};
for (const [name, records] of [["empty list", "[]"], ["existing omitted", "rows.filter((r) => !existingIds.has(r.id)).map(publicBooking)"], ["ids only in metadata", "[]"]]) {
  for (const parameter of [false, true]) {
    listVariants[`${name}, ${parameter ? "debug" : "base"}`] = rememberExisting.replace(listLine,
      `const rows = sql.ofDay.all(day.date); return sendJson(req, res, 200, { date: day.date, bookings: ${parameter ? `query.has("debug") ? ${records} : rows.map(publicBooking)` : records}${name === "ids only in metadata" ? ", ids: rows.map((r) => r.id)" : ""} });`);
  }
}

// Fixed inventory: the original, sixteen historic defects, the c8 miss, four existence and six list defects, and initial-row exposure.
const DEFECTIVE = {
  original: source,
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
  "escape in text other key": correct.replace(listLine, read("variant-escape-in-text-other-key.js.txt").trim()),
  "seed ignored, leak only before restart": existingVariants["seed ignored, leak only before restart"],
  "existing record absent after restart": existingVariants["existing record absent after restart"],
  "existing record on another day": existingVariants["existing record on another day"],
  "existing phone not persisted": existingVariants["existing phone not persisted"],
  "empty list, base": listVariants["empty list, base"],
  "empty list, debug": listVariants["empty list, debug"],
  "existing omitted, base": listVariants["existing omitted, base"],
  "existing omitted, debug": listVariants["existing omitted, debug"],
  "ids only in metadata, base": listVariants["ids only in metadata, base"],
  "ids only in metadata, debug": listVariants["ids only in metadata, debug"],
  "seed rows only": correct.replace('map(publicBooking)', 'map((r) => r.synthetic === 1 ? { ...publicBooking(r), phone: r.phone } : publicBooking(r))'),
};

function failingCriteria(run) { return run.cases.filter((c) => !c.ok).map((c) => c.name.slice(0, 4)); }
function bothChecksFail(run) { assertionFailure(run); for (const id of ["AC-1", "AC-2"]) assert.ok(failingCriteria(run).includes(id), run.output); }
function verdict(run) { return run.status + " (tests=" + run.counts.tests + ", pass=" + run.counts.pass + ", fail=" + run.counts.fail + "; " + run.cases.filter((c) => !c.ok).map((c) => c.name.slice(0, 4) + ":" + (/^HUB_/.test(c.message || "") ? c.message : c.code)).join(", ") + ")"; }

test("T-EXIST-MATRIX", (t) => {
  assert.equal(Object.keys(DEFECTIVE).length, 29);
  const tests = { "json-reference": jsonReference, rh1, "existing-reference": protocol.text };
  for (const [name, text] of Object.entries(tests)) {
    const run = execute(copy(t, correct), text);
    assert.equal(run.status, "PASS", run.output); assert.equal(run.counts.tests, 5); assert.equal(run.counts.pass, 5);
    t.diagnostic("correct / " + name + ": " + verdict(run));
  }
  const jsonPass = [], rh1Pass = [];
  for (const [name, source] of Object.entries(DEFECTIVE)) {
    assert.notEqual(source, correct, name);
    const json = execute(copy(t, source), jsonReference), rehearsal = execute(copy(t, source), rh1), existing = execute(copy(t, source));
    t.diagnostic(name + " / json-reference: " + verdict(json) + " / rh1: " + verdict(rehearsal) + " / existing-reference: " + verdict(existing));
    assertionFailure(existing);
    if (name === "refuse-all") assert.deepEqual(failingCriteria(existing), ["AC-1", "AC-2", "AC-4", "AC-5"]);
    if (name === "seed rows only") assert.equal(json.status, "PASS", json.output); else assertionFailure(json);
    assert.equal(rehearsal.status, ["existing records only", "seed rows only"].includes(name) ? "PASS" : "FAIL", rehearsal.output);
    if (json.status === "PASS") jsonPass.push(name);
    if (rehearsal.status === "PASS") rh1Pass.push(name);
  }
  assert.deepEqual(jsonPass, ["seed rows only"]);
  assert.deepEqual(rh1Pass, ["existing records only", "seed rows only"]);
});

test("T-EXIST-ALL-01", (t) => {
  const lint = lintTestBody(body, { manifest, criteria, workType: "FEATURE", testRef: "test/hub/privacy.test.mjs", stagingRef: ref, spec, projectFiles: ["src/server-app.js"], moduleExports: { "src/server-app.js": exportNamesOf(source) } });
  assert.deepEqual(lint.violations, []);
  assert.deepEqual(lint.signals.filter((s) => s.signal === "existing_record_unproven"), []);
  const dir = copy(t), runs = [execute(dir), execute(dir)], p = proof(runs);
  for (const run of runs) assertionFailure(run);
  assert.deepEqual(runs[0].cases.map((c) => [c.name, c.ok, c.code, c.at]), runs[1].cases.map((c) => [c.name, c.ok, c.code, c.at]));
  assert.equal(p.verdict, "PROVEN", JSON.stringify(p));
  assert.deepEqual(p.failingCriteria, ["AC-1", "AC-2"]);
  assert.deepEqual(p.helpers, [hubHelperIdentity("json-exposure")]);
  for (const row of p.table.filter((r) => r.today === "fail")) {
    assert.equal(row.origin, "behaviour"); assert.ok(row.at > protocol.header.length); assert.match(row.statement, /assert.deepEqual\(exposes\(/);
  }
  for (const [name, source] of Object.entries({
    "initial data not created": correct.replace('if (!seed) return;', 'return;'),
    "initial data without phone": correct.replace('"0700 123 456"', '""'),
  })) {
    assert.notEqual(source, correct, name);
    const run = execute(copy(t, source)); bothChecksFail(run);
    assert.deepEqual(failingCriteria(run), ["AC-1", "AC-2"]);
    for (const c of run.cases.filter((c) => !c.ok)) assert.match(c.message, /inițial/);
    t.diagnostic(name + ": " + verdict(run));
  }
});

test("T-EXIST-ALL-02", (t) => {
  for (const [name, source] of Object.entries({
    "initial rows omitted": correct.replace('map(publicBooking)', 'filter((r) => r.synthetic !== 1).map(publicBooking)'),
    "kept row omitted": rememberExisting.replace('map(publicBooking)', 'filter((r) => !existingIds.has(r.id) || r.synthetic === 1).map(publicBooking)'),
    "new row omitted": rememberExisting.replace('map(publicBooking)', 'filter((r) => existingIds.has(r.id)).map(publicBooking)'),
  })) {
    assert.notEqual(source, correct, name);
    const run = execute(copy(t, source)); bothChecksFail(run); t.diagnostic(name + ": " + verdict(run));
  }
});

test("T-EXIST-ALL-03", (t) => {
  const source = DEFECTIVE["existing records only"], run = execute(copy(t, source)), old = execute(copy(t, source), rh1);
  bothChecksFail(run); assert.equal(old.status, "PASS", old.output);
  t.diagnostic("existing records only / rh1: " + verdict(old) + " / existing-reference: " + verdict(run));
});

test("T-EXIST-ALL-04", (t) => {
  const source = DEFECTIVE["seed rows only"], run = execute(copy(t, source)); bothChecksFail(run);
  for (const [name, text] of [["json-reference", jsonReference], ["rh1", rh1]]) {
    const old = execute(copy(t, source), text); assert.equal(old.status, "PASS", old.output);
    t.diagnostic("seed rows only / " + name + ": " + verdict(old));
  }
  t.diagnostic("seed rows only / existing-reference: " + verdict(run));
});

test("T-EXIST-ALL-05", (t) => {
  for (const [name, condition] of [
    ["seed rows only under any parameter", '[...query.keys()].length > 1 && r.synthetic === 1'],
    ["threshold only under any parameter", '[...query.keys()].length > 1 && r.start_min >= 660'],
    ["seed rows only under all=1", 'query.has("all") && r.synthetic === 1'],
  ]) {
    const source = correct.replace('map(publicBooking)', 'map((r) => ' + condition + ' ? { ...publicBooking(r), phone: r.phone } : publicBooking(r))');
    assert.notEqual(source, correct, name);
    const run = execute(copy(t, source)); assertionFailure(run);
    assert.deepEqual(failingCriteria(run), ["AC-2"]);
    assert.ok(run.cases.find((c) => c.name.startsWith("AC-1:")).ok);
    t.diagnostic(name + ": " + verdict(run));
  }
});

test("T-EXIST-ALL-06", (t) => {
  for (const [name, source] of Object.entries({ ...listVariants, "empty list": DEFECTIVE["empty list"] })) {
    const run = execute(copy(t, source)); assertionFailure(run);
    assert.ok(failingCriteria(run).includes("AC-2"), run.output);
    if (!name.endsWith(", debug")) bothChecksFail(run);
    t.diagnostic(name + ": " + verdict(run));
  }
});
