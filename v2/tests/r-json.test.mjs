import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { HUB_HELPERS, hubHelperIdentity, assembleTestFile, testHeader, parseTapCases, classifyProof, lintTestBody, buildAuthorBrief, buildTestReviewBrief, exportNamesOf, assertionInventory, compareInventory } from "../server/factory/test-first.mjs";
import { sha256 } from "../server/core/canonical.mjs";
import { parseTestOutput, testStatus } from "../server/factory/runner.mjs";
import { deriveCriteria } from "../server/owner/planners/criteria.mjs";
import { checkSpec, specHash } from "../server/factory/spec.mjs";
import { buildEngineeringSpec } from "../server/owner/planners/engineering.mjs";
import { makeTestHub, enableLive, waitFor } from "./helpers.mjs";
import { materializeFixture } from "../server/factory/fixtures.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, "fixtures/stage0-s25");
const app = path.join(here, "fixtures/r-priv-booking");
const read = (name) => fs.readFileSync(path.join(fixture, name), "utf8");
const words = "Telefonul rămâne obligatoriu la programare și este salvat corect, dar lista publică a zilei nu afișează și nu transmite telefonul.";
const derived = deriveCriteria({ words });
const criteria = derived.test.map((c, i) => ({ ...c, id: `AC-${i + 1}`, verify: "test" }));
const helpers = ["json-exposure"], spec = { changesExisting: true, hubHelpers: helpers, acceptance: criteria };
const manifest = JSON.parse(read("json-reference.manifest.json")), body = read("json-reference.body.mjs.txt");
const protocol = assembleTestFile({ body, needs: manifest.needs, helpers });
const source = fs.readFileSync(path.join(app, "src/server-app.js"), "utf8").replaceAll("\r\n", "\n");
const correct = source.replace("phone: row.phone, ", "");
const c8 = read("c8-c8068c3b9b1a.test.mjs.txt");
const ref = ".ifrim-hub/staging/privacy.mjs";
function temp(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "r-json-")); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; }
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
const exposes = vm.runInThisContext(`(function(assert) { ${HUB_HELPERS["json-exposure"].lines.join("\n")} return exposes; })`)(assert);
const phone = "0712345678", config = { keys: ["phone"], values: [phone] };
const inspect = (value) => exposes(JSON.stringify(value), config);

test("T-JSON-01", () => {
  for (const value of [{ bookings: [{ id: "b1", nested: { names: ["demo", null, 42] } }] }, [], null, { Phone: "case-sensitive", telephone: "safe" }]) assert.deepEqual(inspect(value), []);
});
test("T-JSON-02", () => {
  for (const value of [phone, { note: `Sună la ${phone}, mâine` }, { [phone]: true }, Number(phone)]) {
    const cfg = typeof value === "number" ? { keys: ["phone"], values: [String(value)] } : config;
    const found = exposes(JSON.stringify(value), cfg);
    assert.ok(found.length > 0); assert.match(found.join(" "), /\$:|\$\[.*valoarea #1/);
    assert.ok(found.every((s) => !s.includes(cfg.values[0])));
  }
  assert.match(inspect({ [phone]: "safe" })[0], /cheie-valoare/);
  assert.equal(inspect(Array.from({ length: 100 }, () => ({ phone }))).length, 50);
});
test("T-JSON-03", (t) => {
  const escaped = [...phone].map((c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0")).join("");
  assert.ok(exposes(`{"note":"Sună ${escaped} mâine"}`, config).length);
  const src = correct.replace(listLine, read("variant-escape-in-text-other-key.js.txt").trim());
  assertionFailure(execute(copy(t, src)));
  const old = execute(copy(t, src), c8); assert.equal(old.status, "PASS", old.output);
  t.diagnostic(`c8 escaped text: ${old.status}, ${old.counts.tests} cases`);
});
test("T-JSON-04", () => {
  assert.match(inspect([{ outer: { inner: [{ phone: null }] } }])[0], /cheie/);
  assert.deepEqual(inspect({ Phone: null }), []);
});

test("T-JSON-SPACED-VALUES", () => {
  const padded = `  ${phone}  `, cfg = { keys: ["phone"], values: [padded] };
  for (const value of [padded, phone, `Sună ${phone} mâine`, { [phone]: true }, { [padded]: true }]) {
    const found = exposes(JSON.stringify(value), cfg);
    assert.equal(found.length, 1);
    assert.ok(found.every((finding) => !finding.includes(phone) && !finding.includes(padded)));
  }
  assert.deepEqual(exposes('{"safe":"nothing"}', cfg), []);
});
test("T-JSON-05", () => {
  for (const [text, cfg] of [["{", config], [null, config], [42, config], ["{}", { keys: [], values: [phone] }], ["{}", { keys: ["phone"], values: [] }], ...["", "  ", "ab", " a ", 12, null].map((v) => ["{}", { keys: ["phone"], values: [v] }]), ...[null, {}, { keys: "phone", values: [phone] }, { keys: ["phone"], values: phone }, { keys: [1], values: [phone] }, { keys: [" "], values: [phone] }].map((cfg) => ["{}", cfg])]) {
    assert.throws(() => exposes(text, cfg), (e) => e.code === "ERR_ASSERTION" && /^HUB_SETUP exposes: /.test(e.message));
  }
  assert.throws(() => exposes("[".repeat(20000) + "0" + "]".repeat(20000), config), /HUB_SETUP exposes: /);
});

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
function evidence(t, name, src) {
  assert.notEqual(src, correct, name);
  assertionFailure(execute(copy(t, src)));
  const old = execute(copy(t, src), c8);
  t.diagnostic(`c8 ${name}: ${old.status}; tests=${old.counts.tests}, pass=${old.counts.pass}, fail=${old.counts.fail}`);
  return old;
}
test("T-EXIST-01", (t) => {
  for (const name of Object.keys(existingVariants).slice(0, 2)) {
    const old = evidence(t, name, existingVariants[name]); assert.equal(old.status, "PASS", old.output);
  }
});
test("T-EXIST-02", (t) => {
  for (const name of Object.keys(existingVariants).slice(2)) evidence(t, name, existingVariants[name]);
});
test("T-LIST-01", (t) => {
  for (const [name, src] of Object.entries(listVariants)) evidence(t, name, src);
});

test("T-PROOF-01", (t) => {
  const dir = copy(t), p = proof([execute(dir), execute(dir)]);
  assert.equal(p.verdict, "PROVEN", JSON.stringify(p));
  assert.deepEqual(p.failingCriteria, ["AC-1", "AC-2"]);
  assert.deepEqual(p.helpers, [hubHelperIdentity("json-exposure")]);
  for (const row of p.table.filter((r) => r.today === "fail")) { assert.equal(row.origin, "behaviour"); assert.ok(row.at > protocol.header.length); assert.match(row.statement, /assert.deepEqual\(exposes\(/); }
  for (const [raw, value] of [["{", phone], ["{}", ""]]) {
    const name = "AC-1: răspunsul nu expune date";
    const file = assembleTestFile({ helpers, body: `test(${JSON.stringify(name)}, () => { const res = { body: ${JSON.stringify(raw)} }; assert.deepEqual(exposes(res.body, { keys: ["phone"], values: [${JSON.stringify(value)}] }), []); });` });
    const m = { cases: [{ name, criterion: "AC-1", kind: "check", today: "fail" }] };
    const run = execute(copy(t), file.text), result = proof([run, execute(copy(t), file.text)], file.text, m, { criteria: [criteria[0]] });
    assert.equal(result.verdict, "WRONG_REASON", JSON.stringify(result)); assert.equal(result.cause, "setup_failed");
    const row = result.table[0]; assert.equal(row.origin, "setup"); assert.ok(row.at <= file.header.length); assert.match(row.message, /^HUB_SETUP exposes: /);
  }
});

test("T-INTEGRITY-01", (t) => {
  const identity = hubHelperIdentity("json-exposure");
  assert.equal(identity.sha256, "984e7cf2876ddbf514b1a6b6c86741736946f64adf8edf0ef0215369b136704f");
  assert.equal(identity.sha256, sha256(HUB_HELPERS[identity.name].lines.join("\n")));
  assert.match(protocol.text, new RegExp(`json-exposure v1 sha256 ${identity.sha256.slice(0, 12)}`));
  const changed = protocol.text.replace('found.length < 50', 'found.length < 51');
  assert.notEqual(sha256(changed), protocol.sha256);
  assert.equal(proof([], changed).verdict, "INCONCLUSIVE"); assert.equal(proof([], changed).cause, "helper");
  assert.equal(proof([], assembleTestFile({ body, needs: manifest.needs }).text).cause, "helper");
  // Execute the actual protected-file SHA predicate from runQa, without starting a Hub.
  const factory = fs.readFileSync(path.join(here, "../server/factory/factory.mjs"), "utf8");
  const sha256File = (file) => sha256(fs.readFileSync(file));
  const predicate = factory.match(/const tampered = (Object\.entries\(spec\.protected\?\.files \|\| \{\}\)[^\n]+);/)[1];
  const check = vm.runInThisContext(`(function(spec, project, fs, path, sha256File) { return ${predicate}; })`);
  const dir = copy(t); write(dir, ref, protocol.text);
  const protectedSpec = { protected: { files: { [ref]: protocol.sha256 } } };
  assert.deepEqual(check(protectedSpec, { path: dir }, fs, path, sha256File), []);
  write(dir, ref, changed); assert.deepEqual(check(protectedSpec, { path: dir }, fs, path, sha256File), [ref]);
  for (const prefix of ["c7-be8da1183055", "c8-c8068c3b9b1a"]) {
    const text = read(prefix + ".test.mjs.txt"), marker = "// ---- corpul testului ----\n", offset = text.indexOf(marker) + marker.length;
    // These two immutable candidates have no separate manifest file; recover needs from their exact import declarations.
    const needs = [...text.slice(0, offset).matchAll(/from "(node:(?:path|url|os|fs|sqlite|http))"/g)].map((m) => m[1]);
    const file = assembleTestFile({ body: text.slice(offset), needs, missionId: "mis_mv49pj8t_91920fa038", specVersion: 1, specSha: "88d3db5091a9" });
    assert.equal(file.text, text); assert.ok(file.sha256.startsWith(prefix.split("-")[1]));
    assert.equal(assembleTestFile({ body: text.slice(offset), needs, missionId: "mis_mv49pj8t_91920fa038", specSha: "88d3db5091a9", helpers: [] }).text, text);
  }
  const opts = { manifest, criteria, workType: "FEATURE", testRef: "test/hub/privacy.test.mjs", stagingRef: ref, spec, projectFiles: ["src/server-app.js"], moduleExports: { "src/server-app.js": exportNamesOf(source) } };
  assert.deepEqual(lintTestBody(body, opts).violations, []);
  assert.deepEqual(lintTestBody(body, opts).signals.filter((s) => s.signal === "existing_record_unproven"), []);
  const one = { ...opts, criteria: [criteria[0]], manifest: { cases: [{ name: "AC-1: verificare", criterion: "AC-1", kind: "check", today: "fail" }] } };
  const lint = (code, overrides = {}) => lintTestBody(`test("AC-1: verificare", () => { ${code} });`, { ...one, ...overrides });
  const call = 'exposes(res.body, { keys: ["phone"], values: [phone] })';
  for (const code of [`assert.deepEqual(${call}, []);`, `const found = ${call}; assert.deepEqual(found, []);`]) assert.ok(!lint(code).violations.some((v) => v.rule.startsWith("exposure_")), code);
  const parameters = '["includePhone=1", "phone=1", "fields=phone", "debug=1", "all=1"]';
  const positive = `assert.deepEqual(${call}, []);`;
  for (const code of [
    `assert.deepStrictEqual([], ${call});`, `assert.equal(${call}.length, 0);`, `assert.strictEqual(${call}.length, 0);`,
    `const r = ${call}; assert.deepEqual([], r);`, `const r = ${call}; assert.strictEqual(r.length, 0);`,
    `const found = ${call}; assert.deepEqual(found, []); assert.ok(record.found); assert.ok({ found: true });`,
    `for (const param of ${parameters}) { ${positive} }`, `for (const param of ${parameters}) ${positive}`,
    `const params = ${parameters}; for (const param of params) { const r = ${call}; assert.deepStrictEqual(r, []); }`,
  ]) assert.ok(!lint(code).violations.some((v) => v.rule.startsWith("exposure_")), code);
  const rejected = [
    `assert.deepEqual(res ? [] : ${call}, []);`, `const r = ${call}; assert.deepEqual(r, r);`,
    `if (false) { ${positive} }`, `if (false) ${positive}`, `if (res) {} else { ${positive} }`,
    `const never = () => { ${positive} };`, `function never() { ${positive} }`,
    `try { ${positive} } catch {}`, `try {} catch { ${positive} }`, `try {} finally { ${positive} }`,
    `while (false) { ${positive} }`, `for (let i = 0; i < 0; i++) { ${positive} }`,
    `for (const param of []) { ${positive} }`, `for (const param of ${parameters}) { if (false) { ${positive} } }`,
    `assert.deepEqual(${call} || [], []);`, `assert.deepEqual(${call} && [], []);`, `assert.deepEqual(${call} ?? [], []);`,
    `assert.deepEqual([...${call}], []);`, `assert.deepEqual(identity(${call}), []);`,
    `const r = ${call} || []; assert.deepEqual(r, []);`, `let r = ${call}; assert.deepEqual(r, []);`,
    `const r = ${call}; assert.deepEqual([], []);`, `const r = ${call}; assert.deepEqual(r || [], []);`,
    `const r = ${call}; { const r = []; assert.deepEqual(r, []); }`,
  ];
  for (const method of ["", ".ok", ".notDeepEqual", ".notDeepStrictEqual", ".notEqual", ".notStrictEqual", ".throws", ".doesNotThrow", ".rejects", ".doesNotReject"]) {
    for (const code of [`assert${method}(${call}, []);`, `const r = ${call}; assert${method}(r, []);`, `assert${method}(() => ${call});`, `const r = ${call}; assert${method}(() => r);`]) {
      rejected.push(code);
      assert.ok(lint(code).violations.some((v) => v.rule === "exposure_helper_vacuous"), code);
      assert.ok(lint(`${positive} const never = () => { ${code} };`).violations.some((v) => v.rule === "exposure_helper_vacuous"), code);
    }
  }
  for (const code of rejected) assert.ok(lint(code).violations.some((v) => v.rule === "exposure_helper_unused"), code);
  const unassertedFinally = lint(`try { ${call}; } finally {}`).violations;
  assert.ok(unassertedFinally.some((v) => v.rule === "exposure_helper_unused"));
  assert.ok(!unassertedFinally.some((v) => v.rule === "exposure_helper_vacuous"));
  for (const code of [`try { ${positive} } catch {}`, `const r = ${call}; try { assert.deepEqual(r, []); } catch {}`, `try { const never = () => ${call}; } catch {}`]) assert.ok(lint(code).violations.some((v) => v.rule === "exposure_helper_vacuous"), code);
  for (const target of ["JSON", "JSON.parse", 'JSON["parse"]', "JSON.stringify", "Array.prototype", "Array.prototype.includes", "String.prototype.includes", "Object.prototype", "Number.prototype.toString", "Object.entries", "Object.keys"]) {
    for (const mutation of [`${target} = fake;`, `${target} ||= fake;`, `Object.defineProperty(${target}, "x", { value: fake });`, `Object.assign(${target}, { x: fake });`, `Object.setPrototypeOf(${target}, fake);`]) assert.ok(lint(mutation + positive).violations.some((v) => v.rule === "builtin_patched"), mutation);
  }
  for (const mutation of ['Object.defineProperty(JSON, "parse", { value: fake });', 'Object.defineProperty(Array, "prototype", { value: fake });', 'Object.defineProperty(Object, "entries", { value: fake });', 'Object.assign(Object, { keys: fake });', '[JSON.parse] = fake;', '({ parse: JSON.parse } = fake);', '({ JSON } = fake);', 'const JSON = fake;', 'JSON[key] = fake;', 'String.prototype[key] = fake;']) assert.ok(lint(mutation + positive).violations.some((v) => v.rule === "builtin_patched"), mutation);
  for (const code of ['const data = JSON.parse(res.body);', 'const data = Object.entries(res);', 'Object.assign(res, { phone });', 'Object.defineProperty(res, "phone", { value: phone });', '({ JSON: parsed } = data);', '// JSON.parse = fake;\nconst comment = "Array.prototype.includes = fake";']) assert.ok(!lint(code + positive).violations.some((v) => v.rule === "builtin_patched"), code);
  assert.ok(lint('JSON[] = fake;').violations.some((v) => v.rule === "syntax"));
  assert.ok(lint(`assert.deepEqual(${call}, []);`).signals.some((s) => s.signal === "existing_record_unproven"));
  for (const code of ['const exposes = fn;', 'exposes = fn;', 'const { exposes } = obj;', 'const { x: exposes } = obj;', 'fn(exposes);', 'function fn(exposes) {}', 'const fn = (exposes) => 0;', 'function exposes(x) {}', 'const x = { exposes(x) {} };', 'const fn = exposes;', 'exposes.call(null, res.body);']) assert.ok(lint(code).violations.some((v) => v.rule === "exposure_helper_shadowed"), code);
  for (const arg of ['"{}"', '`hello ${x}`', '42', '{}', '[]', 'JSON.stringify(res)', '(JSON.stringify(res))', '("{}")']) assert.ok(lint(`assert.deepEqual(exposes(${arg}, config), []);`).violations.some((v) => v.rule === "exposure_helper_literal"), arg);
  for (const code of [`${call}; assert.ok(res);`, 'assert.ok(res);', `const found = ${call}; assert.ok(res);`, `assert.ok(res, ${call});`, `const found = ${call}; assert.ok(res, found);`]) assert.ok(lint(code).violations.some((v) => v.rule === "exposure_helper_unused"), code);
  assert.ok(lint(`assert.deepEqual(${call}, []);`, { spec: {} }).violations.some((v) => v.rule === "exposure_helper_unavailable"));
  assert.ok(!lint('assert.ok(res); // exposes("{}", {})', { spec: {} }).violations.some((v) => v.rule.startsWith("exposure_")));
});

test("T-JSON-LINT-SHAPES", async (t) => {
  const name = "AC-1: verificare", call = 'exposes(res.body, { keys: ["phone"], values: [phone] })';
  const positive = `assert.deepEqual(${call}, []);`;
  const parameters = '["includePhone=1", "phone=1", "fields=phone", "debug=1", "all=1"]';
  const opts = { spec, criteria: [criteria[0]], manifest: { cases: [{ name, criterion: "AC-1", kind: "check", today: "fail" }] } };
  const check = (code, before = "") => lintTestBody(`${before}\ntest(${JSON.stringify(name)}, async () => { ${code} });`, opts);
  const accepted = [
    ["plain blocks", `{ { ${positive} } }`],
    ["server try/finally", `const server = await startServer(); try { const res = await request(server); ${positive} } finally { await server.close(); }`],
    ["PARAMS and awaited requests in try/finally", `const PARAMS = ${parameters}; const server = await startServer(); try { for (const p of PARAMS) { const res = await request(server, p); ${positive} } } finally { await server.close(); }`],
    ["other literal list", `for (const q of ["public", "details"]) { const res = await request(q); ${positive} }`],
    ["other const list", `const qs = [1, 2]; for (const q of qs) { ${positive} }`],
    ["for await literal", `for await (const q of [1]) { const res = await request(q); ${positive} }`],
    ["for await const", `const qs = [1]; for await (const q of qs) { ${positive} }`],
    ["async function awaited", `async function check(q) { const res = await request(q); ${positive} } await check("public");`],
    ["async arrow awaited", `const check = async (q) => { const res = await request(q); ${positive} }; await check("public");`],
    ["sync function called", `function check(q) { ${positive} } check("public");`],
    ["sync arrow called", `const check = (q) => { ${positive} }; check("public");`],
    ["helper transparent body and call", `async function check(q) { try { { for (const p of [q]) { const res = await request(p); const found = ${call}; assert.deepEqual(found, []); } } } finally { await close(); } } try { { for (const q of [1]) { await check(q); } } } finally { await close(); }`],
    ["top-level async function", 'await check("public");', `async function check(q) { const res = await request(q); ${positive} }`],
    ["top-level sync function", 'check("public");', `function check(q) { ${positive} }`],
    ["top-level async arrow", 'await check("public");', `const check = async (q) => { const res = await request(q); ${positive} };`],
    ["top-level PARAMS", `for (const p of PARAMS) { const res = await request(p); ${positive} }`, `const PARAMS = ${parameters};`],
  ];
  for (const [label, code, before] of accepted) await t.test(`accepted: ${label}`, () => {
    assert.deepEqual(check(code, before).violations, [], label);
  });
  const rejected = [
    ["try/catch", `try { ${positive} } catch {}`, "exposure_helper_vacuous"],
    ["catch with finally", `try { ${positive} } catch {} finally { await close(); }`, "exposure_helper_vacuous"],
    ["assertion in catch", `try {} catch { ${positive} }`, "exposure_helper_vacuous"],
    ["status condition", `if (res.status === 200) { ${positive} }`],
    ["switch", `switch (res.status) { case 200: ${positive} }`],
    ["ternary", `res.status === 200 ? assert.deepEqual(${call}, []) : noop();`],
    ["logical", `res.status === 200 && assert.deepEqual(${call}, []);`],
    ["Promise.all map", `const qs = [1, 2]; await Promise.all(qs.map(async (q) => { const res = await request(q); ${positive} }));`],
    ["forEach callback", `[1].forEach((q) => { ${positive} });`],
    ["uncalled async helper", `async function check(q) { ${positive} }`],
    ["unawaited async helper", `async function check(q) { ${positive} } check(1);`],
    ["return before assert", `return; ${positive}`],
    ["throw before assert", `throw new Error("stop"); ${positive}`],
    ["return before transparent block", `return; { ${positive} }`],
    ["return in try before assert", `try { return; ${positive} } finally { await close(); }`],
    ["return in helper", `async function check(q) { return; ${positive} } await check(1);`],
    ["return before helper call", `async function check(q) { ${positive} } return; await check(1);`],
    ["empty literal loop", `for (const q of []) { ${positive} }`],
    ["empty const loop", `const qs = []; for (const q of qs) { ${positive} }`],
    ["empty for await", `for await (const q of []) { ${positive} }`],
    ["spread-only empty loop", `for (const q of [...[]]) { ${positive} }`],
    ["nonliteral iterable", `for (const q of request()) { ${positive} }`],
    ["let iterable", `let qs = [1]; for (const q of qs) { ${positive} }`],
    ["condition around helper call", `async function check(q) { ${positive} } if (res.status === 200) { await check(1); }`],
    ["catch around helper call", `async function check(q) { ${positive} } try { await check(1); } catch {}`],
    ["callback around helper call", `async function check(q) { ${positive} } await Promise.all([1].map(async (q) => { await check(q); }));`],
    ["condition inside helper", `async function check(q) { if (res.status === 200) { ${positive} } } await check(1);`],
    ["catch inside helper", `async function check(q) { try { ${positive} } catch {} } await check(1);`, "exposure_helper_vacuous"],
    ["two helper levels", `async function inner(q) { ${positive} } async function check(q) { await inner(q); } await check(1);`],
    ["shadowed helper", `async function check(q) { ${positive} } { const check = async (q) => {}; await check(1); }`],
    ["generator is not executed by call", `function* check(q) { ${positive} } check(1);`],
    ["empty loop around helper call", `async function check(q) { ${positive} } for (const q of []) { await check(q); }`],
  ];
  for (const [label, code, rule] of rejected) await t.test(`rejected: ${label} (${rule || "exposure_helper_unused"})`, () => {
    const { violations } = check(code);
    assert.ok(violations.some((v) => v.rule === "exposure_helper_unused"), `${label}: ${JSON.stringify(violations)}`);
    if (rule) assert.ok(violations.some((v) => v.rule === rule), `${label}: ${JSON.stringify(violations)}`);
  });
});

test("T-JSON-OLD-HEADER-AMENDMENT", () => {
  const oldBody = read("amend-reference.body.mjs.txt"), oldManifest = JSON.parse(read("c5-8b940d9b1476.manifest.json"));
  const old = assembleTestFile({ body: oldBody, needs: oldManifest.needs });
  const added = 'assert.deepEqual(exposes(getRes.body, { keys: ["phone"], values: [PHONE] }), []);';
  const nextBody = oldBody.replaceAll('assert.equal(getRes.status, 200,', `${added}\n    assert.equal(getRes.status, 200,`);
  assert.notEqual(nextBody, oldBody);
  const next = assembleTestFile({ body: nextBody, needs: oldManifest.needs, helpers });
  assert.notEqual(old.header.length, next.header.length);
  const before = { text: old.text, manifest: oldManifest, headerLines: old.header.length };
  const after = { text: next.text, manifest: oldManifest, headerLines: next.header.length };
  const diff = compareInventory(before, after), inventory = assertionInventory(old.text, oldManifest, before);
  assert.deepEqual(diff.removed, []);
  assert.equal(diff.matched.length, inventory.length);
  assert.deepEqual(diff.contextChanged, []);
});

// The same sixteen defects as r-amend; the immutable historical references remain unchanged.
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
test("T-JSON-MATRIX", (t) => {
  const good = execute(copy(t, correct)); assert.equal(good.status, "PASS", good.output); assert.equal(good.counts.tests, 5);
  assertionFailure(execute(copy(t)));
  assert.equal(Object.keys(variants).length, 16);
  for (const [name, src] of Object.entries(variants)) { assert.notEqual(src, correct, name); assertionFailure(execute(copy(t, src))); }
  t.diagnostic("reference: correct PASS; original + 16 historical defects FAIL on body assertions; controls retained");
});

test("T-JSON-SPEC-BRIEFS", () => {
  assert.deepEqual(derived.hubHelpers, helpers);
  const raw = { workType: "FEATURE", title: "Test JSON", objective: words, acceptance: criteria.map((c) => ({ ...c, testRef: "test/hub/privacy.test.mjs" })) };
  const old = checkSpec(raw).spec, next = checkSpec({ ...raw, hubHelpers: helpers }).spec;
  assert.ok(!Object.hasOwn(old, "hubHelpers")); assert.deepEqual(next.hubHelpers, helpers); assert.notEqual(specHash(old), specHash(next));
  assert.deepEqual(next.acceptance.map((c) => c.kind), criteria.map((c) => c.kind));
  assert.notEqual(specHash(next), "ae88c513d096e43c71963535dbc2347b3b227181dd6e245fa80d1a8268f20b93", "2.14.10 has a different acceptance contract");
  for (const c of criteria) { assert.ok(c.text.length <= 480, `${c.kind}: ${c.text.length}`); assert.equal(next.acceptance.find((a) => a.id === c.id).text, c.text); }
  assert.ok(criteria[0].text.includes("cerută direct de la server (fără browser)"));
  assert.ok(criteria[0].text.includes("inițializarea ei normală"));
  assert.ok(criteria[1].text.includes("pornirea normală"));
  assert.ok(buildTestReviewBrief({ spec }).includes("telefoanele exacte citite din stocare / trimise în cerere, nu variante reintroduse manual"));
  for (const hubHelpers of ["json-exposure", ["unknown"], [null], ["json-exposure", "unknown"]]) assert.ok(checkSpec({ ...raw, hubHelpers }).problems.some((p) => p.startsWith("hubHelpers")));
  for (const cycle of [0, 1]) for (const brief of [buildAuthorBrief({ spec, cycle }), buildTestReviewBrief({ spec, cycle })]) {
    for (const phrase of ["Verificări puse de Hub", "ÎNTREGUL corp BRUT", "TUTUROR", "inițializarea ei normală", "rânduri în plus", "nu cere ca stocarea să fie goală", "metadate", "stocarea internă", "completări", "instrucțiune directă", "try { … } finally { … } fără catch", "for (const p of [..])", "funcție locală async", "Un catch, un if ori un callback .map/Promise.all", "return/throw necondiționat"]) assert.ok(brief.includes(phrase), phrase);
  }
  assert.ok(buildAuthorBrief({ spec }).includes(HUB_HELPERS["json-exposure"].lines.join("\n")));
  assert.match(buildTestReviewBrief({ spec }), /covered: false/);
  assert.ok(!buildAuthorBrief({ spec: {} }).includes("## Verificări puse de Hub"));
  assert.equal(testHeader().some((line) => line.includes("function exposes")), false);
});

test("T-JSON-FACTORY", { timeout: 120000 }, async () => {
  const h = await makeTestHub({ queues: true });
  const dispatch = async (type, payload) => h.hub.commands.dispatch({ type, payload, channel: "test", actor: "test" });
  try {
    const dir = path.join(h.dataDir, "booking"); materializeFixture("booking-demo", dir); fs.cpSync(app, dir, { recursive: true });
    const project = (await dispatch("project.register_test", { path: dir })).result;
    const built = buildEngineeringSpec({ text: words, project });
    assert.deepEqual(built.problems, []); assert.deepEqual(built.input.spec.hubHelpers, helpers);
    const mission = (await dispatch("factory.prepare", { projectId: project.id, ...built.input, limits: { writerModel: "gpt-fake-sol", reviewerModel: "sonnet" } })).result.mission;
    const stored = () => JSON.parse(h.hub.db.prepare("SELECT protected_json FROM factory_specs WHERE mission_id = ? ORDER BY version DESC LIMIT 1").get(mission.id).protected_json);
    await enableLive(h.hub, { provider: "codex", access: "workspace-write", attempts: 1 });
    h.hub.bus.transaction(() => {
      for (const provider of ["codex", "claude"]) h.hub.grants.create({ provider, projectId: project.id, access: provider === "codex" ? "workspace-write" : "read-only", maxAttempts: 5, maxDurationS: 900, ttlMinutes: 60 }, "test");
    });
    // Two independent rejecting fake reviews exercise both author cycles without starting an implementation.
    h.queue("claude", "author:existing-reference", "author:existing-reference"); h.queue("codex", "test-review:changes", "test-review:changes-again");
    const req = await dispatch("factory.start", h.hub.factory.view(mission.id).scope);
    await dispatch("approval.decide", { approvalId: req.approval.id, decision: "approved", displayedHash: req.approval.payloadHash });
    await h.hub.commands.executeApproved(req.command.id, "user");
    await waitFor(() => stored().authoring?.blocked?.kind === "exhausted", 100000, 50);
    await h.hub.factory.idle(mission.id);
    const authoring = stored().authoring, identity = [hubHelperIdentity("json-exposure")];
    assert.deepEqual(authoring.proof.helpers, identity); assert.equal(authoring.proof.verdict, "PROVEN");
    assert.equal(authoring.cycle, 1); assert.equal(h.hub.factory.writerStarted(mission.id), false);
    assert.deepEqual(authoring.candidate.inventoryRemoved, []);
    const events = (type) => h.hub.db.prepare("SELECT payload_json FROM events WHERE type = ? AND scope_id = ? ORDER BY seq").all(type, mission.id).map((r) => JSON.parse(r.payload_json));
    const proofs = events("factory.test_proof"); assert.equal(proofs.length, 2);
    for (const p of proofs) { assert.deepEqual(p.helpers, identity); assert.equal(p.verdict, "PROVEN"); }
    assert.equal(events("factory.test_review").length, 2); assert.equal(events("factory.acceptance_protected").length, 0);
  } finally { await h.cleanup(); }
});
