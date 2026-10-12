import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { makeTestHub, enableLive, waitFor } from "./helpers.mjs";
import { materializeFixture, demoSpec } from "../server/factory/fixtures.mjs";
import { takeSnapshot } from "../server/factory/snapshot.mjs";
import { buildEngineeringSpec } from "../server/owner/planners/engineering.mjs";
import { canTransition } from "../server/delivery/stale.mjs";
import { sha256 } from "../server/core/canonical.mjs";
import { assembleTestFile, parseTapCases, classifyProof, lintTestBody, assertionInventory, removedAssertions, parseTestReview, parseAuthorOutput, buildAuthorBrief, buildTestReviewBrief, exportNamesOf } from "../server/factory/test-first.mjs";
import { parseTestOutput, testStatus } from "../server/factory/runner.mjs";
import { deriveCriteria } from "../server/owner/planners/criteria.mjs";
import { checkSpec, specHash } from "../server/factory/spec.mjs";
import { retireSuperseded, restoreRetired, retirementPlan, readRetireJournal } from "../server/factory/factory.mjs";

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

test("S0R-01 byte-exact c1, c3 and c4 are rejected by export lint on old and correct applications", (t) => {
  for (const id of ["c1", "c3", "c4"]) {
    const name = fs.readdirSync(fixture).find((n) => n.startsWith(id + "-") && n.endsWith(".test.mjs.txt"));
    const text = fs.readFileSync(path.join(fixture, name), "utf8");
    assert.ok(sha256(text).startsWith(name.split("-")[1].split(".")[0]));
    const m = JSON.parse(fs.readFileSync(path.join(fixture, fs.readdirSync(fixture).find((n) => n.startsWith(id + "-") && n.endsWith(".json"))), "utf8"));
    for (const src of [source, correct]) {
      const run = execute(copy(t, src), text), result = proof([run, run], text, m);
      assert.equal(run.status, "FAIL", run.output);
      assert.ok(result.table.some((r) => r.origin === "behaviour" && r.at && r.statement.includes("typeof")));
      const candidateBody = text.split("// ---- corpul testului ----")[1];
      const lint = lintTestBody(candidateBody, { manifest: m, criteria, workType: "FEATURE", spec: { changesExisting: true }, testRef: ref, projectFiles: ["src/server-app.js"], moduleExports: { "src/server-app.js": exportNamesOf(src) } });
      assert.ok(lint.violations.some((v) => v.rule === "export_existence_assert"));
      assert.ok(lint.violations.some((v) => v.rule === "export_missing_undeclared"));
    }
  }
});

test("S0R-02 new protocol passes lint, proves the old app and passes ALL criteria on the corrected app", (t) => {
  const lint = lintTestBody(body, { manifest, criteria, workType: "FEATURE", testRef: "test/hub/privacy.test.mjs", stagingRef: ref,
    projectFiles: ["src/server-app.js"], moduleExports: { "src/server-app.js": exportNamesOf(source) } });
  assert.deepEqual(lint.violations, []);
  const dir = copy(t), result = proof([execute(dir), execute(dir)]);
  assert.equal(result.verdict, "PROVEN", JSON.stringify(result));
  assert.deepEqual(result.failingCriteria, ["AC-1", "AC-2"]);
  assert.ok(result.table.filter((r) => r.today === "fail").every((r) => r.origin === "behaviour" && r.at));
  const pass = execute(copy(t, correct));
  assert.equal(pass.status, "PASS", pass.output);
  assert.equal(pass.counts.tests, 5);
});

const wrongVariants = {
  "refuse-all": correct.replace('if (!phone) errors.phone', 'if (true) errors.phone'),
  "phone lost on save": correct.replace('name, vehicle, phone, 0,', 'name, vehicle, "", 0,'),
  "browser-only validation": correct.replace('if (!phone) errors.phone = "Telefonul este obligatoriu";', ''),
  "public exposure": source,
  "masked value": source.replace('phone: row.phone,', 'phone: "***",'),
  "includePhone bypass": correct.replace('map(publicBooking)', 'map((r) => query.has("includePhone") ? { ...publicBooking(r), phone: r.phone } : publicBooking(r))'),
  "debug other key": correct.replace('map(publicBooking)', 'map((r) => query.has("debug") ? { ...publicBooking(r), extra: r.phone } : publicBooking(r))'),
  "empty list": correct.replace('sql.ofDay.all(day.date).map(publicBooking)', '[]'),
  "invalid request saved": correct.replace('if (Object.keys(errors).length) return invalid(req, res, errors);\n\n    const endMin', 'if (Object.keys(errors).length) { sql.insert.run("bad", service.id, slot.date, slot.startMin, slot.startMin + service.durationMin, name, vehicle, phone, 0, at.toISOString()); return invalid(req, res, errors); }\n\n    const endMin'),
  "missing-property accepted": correct.replace('if (!phone) errors.phone', 'if (Object.hasOwn(input, "phone") && !phone) errors.phone'),
};
for (const [name, src] of Object.entries(wrongVariants)) test(`S0R-03 rejects ${name}`, (t) => {
  assert.notEqual(src, correct, "mutation must change the app");
  const run = execute(copy(t, src));
  assert.equal(run.status, "FAIL", run.output);
  assert.ok(run.cases.some((c) => c.code === "ERR_ASSERTION"), run.output);
  assert.ok(!run.cases.some((c) => /^HUB_/.test(c.message || "")), "a behavioural mutant must reach assertions");
});

test("S0R-04 setup and load are distinct from behaviour; missing or disagreeing frames never prove a check", (t) => {
  const m = { cases: [{ name: "AC-1: pregătire", criterion: "AC-1", kind: "check", today: "fail" }] };
  const file = assembleTestFile({ body: 'test("AC-1: pregătire", async () => { await setup("pornire", () => { throw new Error("broken"); }); assert.equal(1 + 1, 3); });' });
  const run = execute(copy(t), file.text);
  const opts = { criteria: [criteria[0]] };
  const result = proof([run, run], file.text, m, opts);
  assert.deepEqual([result.verdict, result.cause, result.table[0].origin], ["WRONG_REASON", "setup_failed", "setup"]);
  const missing = { ...run, cases: run.cases.map((c) => ({ ...c, at: null })) };
  assert.equal(proof([missing, missing], file.text, m, opts).cause, "provenance");
  const disagreement = { ...run, cases: run.cases.map((c) => ({ ...c, message: "not a Hub error" })) };
  assert.equal(proof([disagreement, disagreement], file.text, m, opts).cause, "provenance");
  const load = assembleTestFile({ body: 'test("AC-1: pregătire", async () => { const m = await load("../../src/missing.js"); const fn = need(m, "newFn"); assert.equal(fn(), 7); });' });
  const absent = execute(copy(t), load.text);
  assert.equal(proof([absent, absent], load.text, m, opts).cause, "load_failed");
  const newApi = proof([absent, absent], load.text, m, { ...opts, spec: {}, missingAtBase: ["src/missing.js"] });
  assert.equal(newApi.verdict, "PROVEN");
  assert.equal(newApi.table[0].origin, "new_api");
});

test("S0R-05 export existence lint tracks namespace and destructuring; response hasOwn remains allowed", () => {
  const base = 'test("AC-1: exporturi", async () => { const m = await load("../../src/server-app.js"); const { createApp: fn } = await load("../../src/server-app.js"); STATEMENT });';
  const opts = { manifest: { cases: [{ name: "AC-1: exporturi", criterion: "AC-1", kind: "check", today: "fail" }] }, criteria: [criteria[0]], workType: "FEATURE", testRef: "test/hub/x.test.mjs" };
  for (const st of ['assert.equal(typeof m.createApp, "function");', 'assert.equal(typeof m["createApp"], "function");', 'assert.ok("createApp" in m);', 'assert.ok(Object.hasOwn(m, "createApp"));', 'assert.ok(m.hasOwnProperty("createApp"));', 'assert.equal(typeof fn, "function");']) {
    assert.ok(lintTestBody(base.replace("STATEMENT", st), opts).violations.some((v) => v.rule === "export_existence_assert"), st);
  }
  for (const binding of ['let m; m = await load("../../src/server-app.js");', 'const { ...m } = await load("../../src/server-app.js");']) {
    const candidate = base.replace('const m = await load("../../src/server-app.js");', binding).replace("STATEMENT", 'assert.ok(Object.hasOwn(m, "createApp"));');
    assert.ok(lintTestBody(candidate, opts).violations.some((v) => v.rule === "export_existence_assert"));
  }
  const names = Array.from({ length: 30 }, (_, i) => `exported${i}`).join(", ");
  const longBinding = base.replace("{ createApp: fn }", `{ ${names}, createApp: fn }`).replace("STATEMENT", 'assert.equal(typeof fn, "function");');
  assert.ok(lintTestBody(longBinding, opts).violations.some((v) => v.rule === "export_existence_assert"));
  assert.ok(!lintTestBody(base.replace("STATEMENT", 'const response = { value: 1 }; assert.ok(Object.hasOwn(response, "value"));'), opts).violations.some((v) => v.rule === "export_existence_assert"));
});

test("S0R-06 rewrite inventory and reviewer coverage gate retain the previous checks", () => {
  const entries = assertionInventory(protocol.text, manifest, { headerLines: protocol.header.length });
  assert.ok(entries.length > 20);
  const statement = 'assert.equal(result.raw.includes(phone), false);';
  const rewritten = body.replaceAll(statement, "");
  const removed = removedAssertions(entries, rewritten);
  assert.equal(removed.length, 2);
  assert.deepEqual(removedAssertions(entries, body.replaceAll('"GET"', "'GET'")), []);
  const data = { changeSet: "a".repeat(12), verdict: "PASS", summary: "Verificările sunt complete.", criteria: criteria.map((c) => ({ id: c.id, covered: true, failsForRightReason: true, canEverPass: true, contradictsOwner: false, trivialPassRisk: "low", plain: "Criteriul este verificat complet." })), findings: [], missingContext: [] };
  const parse = (d) => parseTestReview('```json\n' + JSON.stringify(d) + '\n```', { testSha: "a".repeat(64), criteria, inventoryRemoved: removed, inventory: assertionInventory(rewritten, manifest) });
  assert.equal(parse(data).verdict, "INCONCLUSIVE");
  const previousChecks = Object.fromEntries(removed.map((r) => [r.id, "lost"]));
  const lost = parse({ ...data, previousChecks });
  assert.equal(lost.verdict, "CHANGES_REQUESTED");
  assert.ok(lost.gate.every((g) => g.id.startsWith("P")));
  assert.equal(parse({ ...data, previousChecks: Object.fromEntries(removed.map((r) => [r.id, { verdict: "replaced_correctly", by: [assertionInventory(rewritten, manifest)[0].id], why: "Verificarea înlocuitoare păstrează comportamentul cerut." }])) }).verdict, "PASS");
  const previousCandidate = { text: protocol.text, sha: protocol.sha256, cycle: 0, manifest, inventory: entries };
  assert.match(buildAuthorBrief({ spec: { workType: "FEATURE", changesExisting: true, acceptance: criteria }, cycle: 1, previousCandidate }), /Repari varianta anterioară \(sha/);
  assert.match(buildTestReviewBrief({ spec: { acceptance: criteria }, cycle: 1, previousCandidate, inventoryRemoved: removed }), /previousChecks/);
});

test("S0R-07 newApi and removed validation; changesExisting survives normalization and hashing", () => {
  const output = (m) => '```js\n' + body + '\n```\n```json\n' + JSON.stringify(m) + '\n```';
  assert.equal(parseAuthorOutput(output({ ...manifest, api: "" }), { workType: "FEATURE", criteria }).ok, true);
  for (const newApi of [{}, Array(11).fill({ module: "src/app.js", name: "fn", criterion: "AC-1" }), [{ module: "src/app.js", name: "bad-name", criterion: "AC-1" }], [{ module: "src/app.js", name: "fn", criterion: "AC-99" }]]) assert.equal(parseAuthorOutput(output({ ...manifest, newApi }), { workType: "FEATURE", criteria }).ok, false);
  assert.equal(parseAuthorOutput(output({ ...manifest, removed: [{ id: "P4", why: "scurt" }] })).ok, false);
  const input = { workType: "FEATURE", title: "test", objective: words, acceptance: criteria, changesExisting: true };
  const a = checkSpec(input).spec, b = checkSpec({ ...input, changesExisting: false }).spec;
  assert.equal(a.changesExisting, true);
  assert.notEqual(specHash(a), specHash(b));
});

test("S0R-08 retirement restore is verified, idempotent, all-or-nothing preflight, history preserved", (t) => {
  const dir = temp(t), project = { path: dir }, id = "mis_s0r";
  const supersedes = ["one", "two"].map((n) => ({ testRef: `test/hub/${n}.test.mjs`, sha256: sha256(n) }));
  for (const [i, x] of supersedes.entries()) write(dir, x.testRef, i ? "two" : "one");
  const retired = retireSuperseded(id, { supersedes }, project);
  write(dir, supersedes[1].testRef, "external");
  const refused = restoreRetired(retired, project, { missionId: id });
  assert.equal(refused.complete, false);
  assert.equal(fs.existsSync(path.join(dir, supersedes[0].testRef)), false, "no partial movement on preflight refusal");
  assert.equal(fs.readFileSync(path.join(dir, supersedes[1].testRef), "utf8"), "external");
  fs.unlinkSync(path.join(dir, supersedes[1].testRef));
  assert.equal(restoreRetired(retired, project, { missionId: id }).complete, true);
  const journal = fs.readFileSync(path.join(dir, `.ifrim-hub/retired/${id}/journal.json`), "utf8");
  assert.equal(restoreRetired(retired, project, { missionId: id }).state, "already_restored");
  assert.equal(fs.readFileSync(path.join(dir, `.ifrim-hub/retired/${id}/journal.json`), "utf8"), journal);
  assert.equal(readRetireJournal(project, id).status, "RESTORED");
  assert.ok(readRetireJournal(project, id).history.some((h) => h.status === "MOVED"));
});

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
  assert.deepEqual(built.input.spec.hubHelpers, ["json-exposure"]);
  // Recovery also has to accept historical specs whose immutable candidate has no Hub helper.
  // Current helper-enabled authoring/proof integration is exercised in r-json.test.mjs.
  const { hubHelpers, ...legacySpec } = built.input.spec;
  t.child = await prepareMission(t, { ...built.input, spec: legacySpec });
  t.newSpec = stored(t, t.child.id).spec;
  return t;
}
function recordStarted(t, { protectedTest = false, legacy = false } = {}) {
  const { row } = stored(t, t.child.id), a = t.newSpec.authoring;
  const p = { files: {}, pendingRetire: retirementPlan(t.child.id, t.newSpec), historic: { active: [], retired: [] },
    authoring: { ...a, status: protectedTest ? "PROTECTED" : "AUTHORING", cycle: 0, candidate: null, rejected: [] } };
  if (protectedTest) { write(t.dir, a.testRef, protocol.text); p.files[a.testRef] = protocol.sha256; p.authoring.protectedSha = protocol.sha256; }
  const retired = retireSuperseded(t.child.id, t.newSpec, t.project);
  if (legacy || protectedTest) { p.retired = retired; p.historic.retired = retired.map((r) => ({ ...r, retiredBy: t.child.id })); }
  t.hub.db.prepare("UPDATE factory_specs SET status = 'APPROVED', protected_json = ? WHERE id = ?").run(JSON.stringify(p), row.id);
  t.hub.db.prepare("UPDATE factory_missions SET approved_spec_version = 1, stage = 'NEEDS_OWNER_DECISION', started_at = ? WHERE mission_id = ?").run(new Date().toISOString(), t.child.id);
  return p;
}
function parentDelivery(t) {
  const db = t.hub.db, snap = takeSnapshot(t.dir, { mode: "copy", ignore: ["data"] }), at = "2026-01-01T00:00:00.000Z";
  db.prepare("INSERT INTO factory_snapshots (id, mission_id, seq, kind, manifest_json, sha256, created_at) VALUES ('s0r-snap', ?, 1, 'base', ?, ?, ?)").run(t.old.id, JSON.stringify(snap.files), snap.sha256, at);
  db.prepare("UPDATE factory_missions SET base_snapshot_id = 's0r-snap' WHERE mission_id = ?").run(t.old.id);
  db.prepare("INSERT INTO factory_change_sets (id, mission_id, seq, snapshot_id, changes_json, sha256, status, created_at) VALUES ('s0r-cs', ?, 1, 's0r-snap', '[]', ?, 'CURRENT', ?)").run(t.old.id, snap.sha256, at);
  db.prepare("INSERT INTO deliveries (id, project_id, title, status, mission_id, template_json, template_sha, ops_steps_json, ops_body_sha, snapshot_sha, created_by, created_at, updated_at) VALUES ('s0r-delivery', ?, 'Livrare sintetică', 'READY', ?, '{}', '', '[]', '', ?, 'test', ?, ?)").run(t.project.id, t.old.id, snap.sha256, at, at);
  const d = t.hub.deliveries;
  const b = d.bindItem("s0r-delivery", { kind: "bundle", refTable: "synthetic", refId: "s0r-cs", refSha: snap.sha256 });
  const file = path.join(t.dataDir, "export.txt"); fs.writeFileSync(file, "verified render");
  t.exportFile = file;
  d.bindItem("s0r-delivery", { kind: "export", role: "master", refTable: "file", refId: file, refSha: sha256("verified render"), upstream: [b.id] });
  db.prepare("INSERT INTO media_edit_projects (id, title, created_by, created_at, updated_at) VALUES ('s0r-edit', 'test', 'test', ?, ?)").run(at, at);
  db.prepare("INSERT INTO media_variants (id, edit_project_id, master_version_id, platform_key, status, created_by, created_at, updated_at) VALUES ('s0r-variant', 's0r-edit', 'master', 'reels_9x16', 'DRAFT', 'test', ?, ?)").run(at, at);
  d.bindItem("s0r-delivery", { kind: "variant", role: "vertical", refTable: "media_variants", refId: "s0r-variant", upstream: [b.id] });
  db.prepare("INSERT INTO delivery_documents (id, delivery_id, kind, version, sections_json, text, content_sha, basis_json, basis_sha, author_kind, status, approval_json, created_by, created_at) VALUES ('s0r-doc', 's0r-delivery', 'commercial_summary', 1, '[]', 'text', 'sha', '{}', 'sha', 'owner', 'CURRENT', ?, 'test', ?)").run(JSON.stringify({ by: "owner", at }), at);
  return "s0r-delivery";
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

test("S0R-09 two rejected reviews exhaust step zero without retiring anything or invalidating the parent", { timeout: 120000 }, async () => {
  const t = await stateHub();
  try {
    const id = parentDelivery(t);
    await enableLive(t.hub, { provider: "codex", access: "workspace-write", attempts: 1 });
    t.queue("claude", "author:s25-new-protocol", "author:s25-new-protocol");
    t.queue("codex", "test-review:changes", "test-review:changes-again");
    await start(t);
    await waitFor(() => stored(t, t.child.id).prot.authoring?.blocked?.kind === "exhausted", 100000, 50);
    assert.equal(events(t, "factory.test_review", t.child.id).length, 2);
    assert.equal(fs.readFileSync(path.join(t.dir, oldRef), "utf8"), oldText);
    assert.equal(readRetireJournal(t.project, t.child.id), null);
    assert.equal(t.hub.factory.writerStarted(t.child.id), false);
    assert.equal(t.hub.deliveries.verify(id).equal, true);
    assert.equal(t.hub.deliveries.get(id).status, "READY");
    const p = stored(t, t.child.id).prot;
    assert.equal(p.pendingRetire.length, 1);
    assert.equal(p.authoring.candidate.previousSha, p.authoring.rejected[0].sha);
    assert.deepEqual(p.authoring.candidate.inventoryRemoved, []);
  } finally { await t.cleanup(); }
});

for (const action of ["stop", "reject"]) test(`S0R-10 ${action} before writer restores protection retirement and is idempotent`, async () => {
  const t = await stateHub();
  try {
    recordStarted(t, { protectedTest: true });
    if (action === "stop") await t.hub.factory.stop(t.child.id);
    else if (action === "reject") await t.hub.factory.reject(t.child.id, { note: "Respins de proprietar" });
    assert.equal(fs.readFileSync(path.join(t.dir, oldRef), "utf8"), oldText);
    assert.equal(readRetireJournal(t.project, t.child.id).status, "RESTORED");
    assert.equal(t.hub.factory.compensateRetirement(t.child.id, action).state, "already_restored");
    assert.equal(stored(t, t.child.id).prot.restored.length, 1);
    assert.ok(events(t, "factory.retire_restored", t.child.id).some((e) => e.complete));
  } finally { await t.cleanup(); }
});

test("S0R-11 deadline hold is not definitive; retirement remains and parent stays READY", async () => {
  const t = await stateHub();
  try {
    const id = parentDelivery(t); recordStarted(t, { protectedTest: true });
    t.hub.db.prepare("UPDATE factory_missions SET stage = 'BASELINE', deadline_at = '2000-01-01T00:00:00.000Z' WHERE mission_id = ?").run(t.child.id);
    await t.hub.factory.tick();
    assert.equal(readRetireJournal(t.project, t.child.id).status, "MOVED");
    assert.equal(t.hub.deliveries.verify(id).equal, true);
    assert.equal(t.hub.deliveries.get(id).status, "READY");
  } finally { await t.cleanup(); }
});

for (const point of ["rename", "remove", "record"]) test(`S0R-12 crash at ${point} before protection record restores at recover`, async () => {
  const t = await stateHub();
  try {
    const row = stored(t, t.child.id).row;
    t.hub.db.prepare("UPDATE factory_specs SET status = 'APPROVED', protected_json = ? WHERE id = ?").run(JSON.stringify({ authoring: { ...t.newSpec.authoring, status: "AUTHORING", cycle: 0 }, files: {} }), row.id);
    t.hub.db.prepare("UPDATE factory_missions SET stage = 'NEEDS_OWNER_DECISION', approved_spec_version = 1 WHERE mission_id = ?").run(t.child.id);
    assert.throws(() => retireSuperseded(t.child.id, t.newSpec, t.project, { fault: (p) => { if (p === point) throw new Error("crash"); } }), /crash/);
    t.hub.factory.recover();
    assert.equal(fs.readFileSync(path.join(t.dir, oldRef), "utf8"), oldText);
    assert.equal(readRetireJournal(t.project, t.child.id).status, "RESTORED");
    assert.equal(t.hub.factory.compensateRetirement(t.child.id, "repeat").state, "already_restored");
  } finally { await t.cleanup(); }
});

test("S0R-13 occupied original blocks recovery and continuation without overwriting", async () => {
  const t = await stateHub();
  try {
    recordStarted(t, { legacy: true }); write(t.dir, oldRef, "external bytes");
    t.hub.factory.recover();
    assert.equal(fs.readFileSync(path.join(t.dir, oldRef), "utf8"), "external bytes");
    assert.equal(stored(t, t.child.id).prot.restoreBlocked, true);
    await assert.rejects(t.hub.factory.resume(t.child.id), (e) => e.code === "RETIRE_RESTORE_INCOMPLETE");
    assert.ok(events(t, "factory.retire_restore_refused", t.child.id).length);
  } finally { await t.cleanup(); }
});

test("S0R-14 provenance is per path: staging, retirement and protected test qualify; unknown bytes are software", async () => {
  const t = await stateHub();
  try {
    const id = parentDelivery(t); const p = recordStarted(t, { protectedTest: true });
    const paths = t.hub.factory.snapshotCheck(t.old.id).changedFiles;
    const drift = t.hub.factory.driftProvenance(t.project.id, paths);
    assert.deepEqual(drift.software, []);
    assert.ok(drift.hub.some((x) => x.path === oldRef && x.provenance === "retired_by_hub"));
    assert.ok(drift.hub.some((x) => x.path === p.authoring.testRef && x.provenance === "hub_test_protected"));
    write(t.dir, ".ifrim-hub/staging/unknown.mjs", "external");
    assert.deepEqual(t.hub.factory.driftProvenance(t.project.id, [".ifrim-hub/staging/unknown.mjs"]).software, [".ifrim-hub/staging/unknown.mjs"]);
    fs.unlinkSync(path.join(t.dir, ".ifrim-hub/staging/unknown.mjs"));
    assert.equal(t.hub.deliveries.verify(id).equal, true);
    write(t.dir, "src/external.js", "export const value = 2;");
    assert.equal(t.hub.deliveries.verify(id).equal, false);
    assert.equal(t.hub.deliveries.get(id).status, "STALE");
    assert.equal(t.hub.deliveries.reconcileStale(id, { actor: "test" }).ok, false);
  } finally { await t.cleanup(); }
});

test("S0R-15 legacy retirement restore automatically reconciles delivery, documents and variants with evidence", async () => {
  const t = await stateHub();
  try {
    const id = parentDelivery(t); recordStarted(t, { legacy: true });
    const paths = t.hub.factory.snapshotCheck(t.old.id).changedFiles;
    t.hub.deliveries.trigger(id, "software_changed", { cause: "pregătire pas zero", changedFiles: paths }, "test");
    assert.equal(t.hub.deliveries.get(id).status, "STALE");
    assert.equal(canTransition("STALE", "READY"), false);
    t.hub.factory.recover();
    await waitFor(() => t.hub.deliveries.get(id).status === "READY", 5000, 20);
    assert.ok(t.hub.deliveries.get(id).verified.reconciled.evidence.paths.length);
    assert.equal(events(t, "delivery.stale_reconciled", id).length, 1);
    assert.ok(t.hub.deliveries.items(id).every((i) => i.status === "CURRENT"));
    assert.equal(t.hub.deliveries.currentDoc(id).status, "CURRENT");
    assert.equal(t.hub.deliveries.currentDoc(id).approval.by, "owner");
    const v = t.hub.media.variants.get("s0r-variant");
    assert.equal(v.status, "DRAFT"); assert.ok(v.notes.invalidated && v.notes.reinstated);
    assert.equal(t.hub.deliveries.reconcileStale(id, { actor: "test" }).alreadyReconciled, true);
    assert.equal(events(t, "delivery.stale_reconciled", id).length, 1);
  } finally { await t.cleanup(); }
});

for (const scenario of ["status", "trigger", "software", "snapshot", "writer", "item-reason", "rights", "file", "document", "variant", "newer", "malformed-event"]) test(`S0R-16 reconciliation refuses ${scenario} without mutations`, async () => {
  const t = await stateHub();
  try {
    const id = parentDelivery(t), d = t.hub.deliveries, db = t.hub.db;
    d.trigger(id, "software_changed", { cause: "pregătire pas zero", changedFiles: [] }, "test");
    if (scenario === "malformed-event") db.prepare("UPDATE events SET payload_json = json_set(payload_json, '$.changedFiles', json('{}'), '$.cascade.items', json('{}')) WHERE type = 'delivery.status' AND scope_id = ?").run(id);
    if (scenario === "status") db.prepare("UPDATE deliveries SET status = 'CLOSED' WHERE id = ?").run(id);
    if (scenario === "trigger") db.prepare("UPDATE events SET payload_json = json_set(payload_json, '$.trigger', 'rights_revoked') WHERE type = 'delivery.status' AND scope_id = ?").run(id);
    if (scenario === "software") write(t.dir, "src/external.js", "changed");
    if (scenario === "snapshot") db.prepare("UPDATE deliveries SET snapshot_sha = 'wrong' WHERE id = ?").run(id);
    if (scenario === "writer") {
      db.prepare("UPDATE factory_missions SET started_at = '2026-10-11T00:00:00.000Z' WHERE mission_id = ?").run(t.child.id);
      db.prepare("INSERT INTO factory_change_sets (id, mission_id, seq, snapshot_id, changes_json, sha256, status, created_at) VALUES ('writer-cs', ?, 1, 's0r-snap', '[]', 'sha', 'CURRENT', '2026-10-11')").run(t.child.id);
    }
    if (scenario === "item-reason") db.prepare("UPDATE delivery_items SET status_reason = 'altă cauză' WHERE delivery_id = ?").run(id);
    if (scenario === "rights") db.prepare("UPDATE delivery_items SET stale_code = 'RIGHTS_REVOKED' WHERE delivery_id = ?").run(id);
    if (scenario === "file") fs.writeFileSync(t.exportFile, "changed render");
    if (scenario === "document") db.prepare("UPDATE delivery_documents SET stale_reason = 'altă cauză' WHERE delivery_id = ?").run(id);
    if (scenario === "variant") db.prepare("UPDATE media_variants SET notes_json = '{}' WHERE id = 's0r-variant'").run();
    if (scenario === "newer") db.prepare("INSERT INTO deliveries (id, project_id, title, status, template_json, template_sha, ops_steps_json, ops_body_sha, created_by, created_at, updated_at) VALUES ('newer', ?, 'newer', 'READY', '{}', '', '[]', '', 'test', '2099', '2099')").run(t.project.id);
    const before = JSON.stringify([d.get(id), d.items(id), d.currentDoc(id), t.hub.media.variants.get("s0r-variant")]);
    const result = d.reconcileStale(id, { actor: "test", dryRun: false });
    assert.equal(result.ok, false, JSON.stringify(result)); assert.ok(result.reasons.length);
    assert.equal(JSON.stringify([d.get(id), d.items(id), d.currentDoc(id), t.hub.media.variants.get("s0r-variant")]), before);
    assert.equal(events(t, "delivery.stale_reconciled", id).length, 0);
  } finally { await t.cleanup(); }
});

for (const point of ["protect_move", "protect_record"]) test(`S0R-17 ${point} failure compensates the real protection sequence before any writer`, { timeout: 45000 }, async () => {
  const t = await stateHub();
  try {
    await enableLive(t.hub, { provider: "codex", access: "workspace-write", attempts: 1 });
    t.queue("claude", "author:s25-new-protocol"); t.queue("codex", "test-review:pass");
    t.hub.factory.setStartFaultForTests((p) => { if (p === point) throw new Error(`synthetic ${point}`); });
    await start(t);
    await waitFor(() => events(t, "factory.retire_restored", t.child.id).some((e) => e.complete), 35000, 30);
    await t.hub.factory.idle(t.child.id);
    assert.equal(t.hub.factory.writerStarted(t.child.id), false);
    assert.equal(fs.readFileSync(path.join(t.dir, oldRef), "utf8"), oldText);
    assert.equal(fs.existsSync(path.join(t.dir, t.newSpec.authoring.testRef)), false);
    assert.equal(readRetireJournal(t.project, t.child.id).status, "RESTORED");
    assert.deepEqual(t.hub.factory.historicViolations(t.child.id), []);
    assert.equal(stored(t, t.child.id).prot.authoring.status, "AUTHORING");
    assert.ok(fs.existsSync(path.join(t.dir, t.newSpec.authoring.stagingRef)));
  } finally { await t.cleanup(); }
});

for (const mismatch of ["journal", "plan", "copy", "occupied-identical"]) test(`S0R-18 legacy recovery refuses ${mismatch} mismatch without moving files`, async () => {
  const t = await stateHub();
  try {
    recordStarted(t, { legacy: true });
    const journal = path.join(t.dir, `.ifrim-hub/retired/${t.child.id}/journal.json`), copy = retirementPlan(t.child.id, t.newSpec)[0].to;
    if (mismatch === "journal") fs.writeFileSync(journal, "{broken");
    if (mismatch === "plan") { const { row, spec } = stored(t, t.child.id); spec.supersedes[0].sha256 = "0".repeat(64); t.hub.db.prepare("UPDATE factory_specs SET spec_json = ? WHERE id = ?").run(JSON.stringify(spec), row.id); }
    if (mismatch === "copy") write(t.dir, copy, "external retired bytes");
    if (mismatch === "occupied-identical") write(t.dir, oldRef, oldText);
    const bytes = fs.readFileSync(path.join(t.dir, copy));
    t.hub.factory.recover();
    assert.equal(fs.existsSync(path.join(t.dir, oldRef)), mismatch === "occupied-identical");
    assert.deepEqual(fs.readFileSync(path.join(t.dir, copy)), bytes);
    assert.equal(stored(t, t.child.id).prot.restoreBlocked, true);
    assert.ok(events(t, "factory.retire_restore_refused", t.child.id).length);
  } finally { await t.cleanup(); }
});

test("S0R-19 only the first changed change set invalidates other deliveries; BASELINE and empty change sets do not", async () => {
  const t = await stateHub();
  try {
    const id = parentDelivery(t), db = t.hub.db, d = t.hub.deliveries;
    d.onEvent({ type: "factory.stage", scopeId: t.child.id, payload: { missionId: t.child.id, stage: "BASELINE" } });
    assert.equal(d.get(id).status, "READY");
    db.prepare("INSERT INTO factory_change_sets (id, mission_id, seq, snapshot_id, changes_json, sha256, status, created_at) VALUES ('empty', ?, 1, 's0r-snap', '[]', 'sha', 'CURRENT', '2026')").run(t.child.id);
    d.onEvent({ type: "factory.change_set", payload: { missionId: t.child.id, changeSetId: "empty", files: 0 } });
    assert.equal(d.get(id).status, "READY");
    write(t.dir, "src/real.js", "changed");
    db.prepare("INSERT INTO factory_change_sets (id, mission_id, seq, snapshot_id, changes_json, sha256, status, created_at) VALUES ('changed', ?, 2, 's0r-snap', '[{\"path\":\"src/real.js\"}]', 'sha2', 'CURRENT', '2027')").run(t.child.id);
    d.onEvent({ type: "factory.change_set", payload: { missionId: t.child.id, changeSetId: "changed", files: 1 } });
    assert.equal(d.get(id).status, "STALE");
    assert.equal(events(t, "delivery.status", id).at(-1).trigger, "software_revision");
    assert.equal(d.reconcileStale(id, { actor: "test" }).ok, false);
  } finally { await t.cleanup(); }
});

test("S0R-20 reconciliation dry-run is read-only, absent hashes and a later rights revocation block it", async () => {
  const t = await stateHub();
  try {
    const id = parentDelivery(t), d = t.hub.deliveries, db = t.hub.db;
    d.trigger(id, "software_changed", { changedFiles: [], cause: "pregătire" });
    assert.equal(d.reconcileStale("absent", { actor: "test" }).ok, false);
    assert.equal(d.reconcileStale(id, { actor: "test", dryRun: true }).ok, true);
    assert.equal(d.get(id).status, "STALE");
    assert.equal(events(t, "delivery.stale_reconciled", id).length, 0);
    db.prepare("UPDATE delivery_items SET ref_sha = '' WHERE delivery_id = ? AND ref_table = 'file'").run(id);
    assert.equal(d.reconcileStale(id, { actor: "test" }).ok, false);
    db.prepare("UPDATE delivery_items SET ref_sha = ? WHERE delivery_id = ? AND ref_table = 'file'").run(sha256("verified render"), id);
    d.trigger(id, "rights_revoked", { refIds: [t.exportFile] });
    assert.equal(d.reconcileStale(id, { actor: "test" }).ok, false);
    assert.equal(d.get(id).status, "STALE");
  } finally { await t.cleanup(); }
});

test("S0R-21 missing new API requires a per-criterion declaration and absent-at-base lint facts", (t) => {
  const text = assembleTestFile({ body: 'test("AC-1: API nou", async () => { const m = await load("../../src/server-app.js"); const fn = need(m, "privacyView"); assert.equal(fn({phone:"secret"}).phone, undefined); });' }).text;
  const m = { cases: [{ name: "AC-1: API nou", criterion: "AC-1", kind: "check" }], newApi: [{ module: "src/server-app.js", name: "privacyView", criterion: "AC-1" }] };
  const r = execute(copy(t), text), opts = { spec: {}, criteria: [{ id: "AC-1", verify: "test" }], facts: { referenced: [{ module: "src/server-app.js", name: "privacyView", existsAtBase: false }] } };
  const proven = proof([r, r], text, m, opts);
  assert.equal(proven.verdict, "PROVEN", JSON.stringify(proven)); assert.equal(proven.table[0].origin, "new_api");
  assert.equal(proof([r, r], text, { ...m, newApi: [] }, opts).cause, "setup_failed");
  assert.equal(proof([r, r], text, m, { ...opts, spec: { changesExisting: true } }).cause, "setup_failed");
  assert.equal(proof([r, r], text, m, { ...opts, facts: { referenced: [{ module: "src/server-app.js", name: "privacyView", existsAtBase: true }] } }).cause, "setup_failed");
  const noFrame = { ...r, cases: r.cases.map((c) => ({ ...c, at: null })) };
  assert.equal(proof([r, noFrame], text, m, opts).cause, "provenance", "both runs need independently parseable frames");
});

test("S0R-22 the real c1 to c2 rewrite inventory includes the removed whole-body phone-value check", () => {
  const read = (id) => fs.readFileSync(path.join(fixture, fs.readdirSync(fixture).find((n) => n.startsWith(id + "-") && n.endsWith(".test.mjs.txt"))), "utf8");
  const c1 = read("c1"), c2 = read("c2"), headerLines = c1.split("\n").findIndex((l) => l === "// ---- corpul testului ----") + 1;
  const removed = removedAssertions(assertionInventory(c1, {}, { headerLines }), c2);
  assert.ok(removed.some((r) => /phone|PHONE|telefon/.test(r.statement)), JSON.stringify(removed));
  assert.ok(removed.every((r) => /^P[1-9]\d*(?:\.[1-9]\d*)?$/.test(r.id) && r.test));
});

test("S0R-23 successful protection records retirement atomically; Stop restores history as active", { timeout: 45000 }, async () => {
  const t = await stateHub(); const rename = fs.renameSync; let paused = false;
  try {
    await enableLive(t.hub, { provider: "codex", access: "workspace-write", attempts: 1 });
    t.queue("claude", "author:s25-new-protocol"); t.queue("codex", "test-review:pass");
    fs.renameSync = function(from, to) {
      const result = rename.apply(this, arguments);
      if (!paused && String(to).replaceAll("\\", "/").endsWith(t.newSpec.authoring.testRef)) { paused = true; t.hub.factory.pause(t.child.id).catch(() => {}); }
      return result;
    };
    await start(t);
    await waitFor(() => paused, 30000, 30); await t.hub.factory.idle(t.child.id);
    fs.renameSync = rename;
    const p = stored(t, t.child.id).prot;
    assert.equal(p.authoring.status, "PROTECTED"); assert.equal(p.retired.length, 1); assert.equal(p.historic.retired.length, 1);
    assert.equal(readRetireJournal(t.project, t.child.id).status, "MOVED");
    assert.equal(t.hub.factory.writerStarted(t.child.id), false);
    assert.equal(events(t, "factory.test_superseded", t.child.id).length, 1);
    await t.hub.factory.stop(t.child.id);
    assert.deepEqual(t.hub.factory.historicViolations(t.child.id), []);
    assert.equal(fs.readFileSync(path.join(t.dir, oldRef), "utf8"), oldText);
    assert.equal(t.hub.factory.compensateRetirement(t.child.id, "repeat").state, "already_restored");
    assert.equal(events(t, "factory.retire_restored", t.child.id).length, 1);
  } finally { fs.renameSync = rename; await t.cleanup(); }
});

test("S0R-24 legacy status event and variant provenance reconcile without inventing a prior state", async () => {
  const t = await stateHub();
  try {
    const id = parentDelivery(t), d = t.hub.deliveries, db = t.hub.db;
    t.hub.bus.emit({ type: "media.variant.derived", scopeType: "media_variant", scopeId: "s0r-variant", source: "test", payload: { variantId: "s0r-variant", masterVersionId: "master", variantVersionId: null } });
    recordStarted(t, { legacy: true });
    const paths = t.hub.factory.snapshotCheck(t.old.id).changedFiles;
    d.trigger(id, "software_changed", { changedFiles: paths, cause: "pregătire" });
    const event = db.prepare("SELECT seq, created_at FROM events WHERE type = 'delivery.status' AND scope_id = ? ORDER BY seq DESC LIMIT 1").get(id);
    db.prepare("UPDATE events SET payload_json = json_remove(payload_json, '$.trigger', '$.cascade', '$.changedFiles') WHERE seq = ?").run(event.seq);
    db.prepare("UPDATE deliveries SET verified_json = ? WHERE id = ?").run(JSON.stringify({ at: event.created_at, changedFiles: paths }), id);
    db.prepare("UPDATE media_variants SET notes_json = json_remove(notes_json, '$.invalidated.previousStatus') WHERE id = 's0r-variant'").run();
    t.hub.factory.recover(); await waitFor(() => d.get(id).status === "READY", 5000, 20);
    assert.equal(t.hub.media.variants.get("s0r-variant").notes.reinstated.evidence.variants[0].basis, "legacy_derived_event");
  } finally { await t.cleanup(); }
});

test("S0R-25 c2 passes the correct app but loses the debug whole-body value check", (t) => {
  const name = fs.readdirSync(fixture).find((n) => n.startsWith("c2-") && n.endsWith(".test.mjs.txt"));
  const text = fs.readFileSync(path.join(fixture, name), "utf8");
  assert.ok(sha256(text).startsWith(name.split("-")[1].split(".")[0]));
  const baseline = execute(copy(t), text), good = execute(copy(t, correct), text), leak = execute(copy(t, wrongVariants["debug other key"]), text);
  assert.equal(baseline.status, "FAIL", baseline.output);
  assert.equal(good.status, "PASS", good.output);
  assert.equal(leak.status, "PASS", leak.output);
});

test("S0R-26 boot replays a committed restore whose deferred delivery listener never ran", async () => {
  const t = await stateHub();
  try {
    const id = parentDelivery(t), d = t.hub.deliveries;
    recordStarted(t, { legacy: true });
    d.trigger(id, "software_changed", { changedFiles: t.hub.factory.snapshotCheck(t.old.id).changedFiles, cause: "pregătire" });
    d.close_();
    assert.equal(t.hub.factory.compensateRetirement(t.child.id, "crash").complete, true);
    assert.equal(d.get(id).status, "STALE");
    d.boot(); t.hub.factory.recover();
    await waitFor(() => d.get(id).status === "READY", 5000, 20);
    assert.equal(events(t, "factory.retire_restored", t.child.id).length, 1);
    assert.equal(events(t, "delivery.stale_reconciled", id).length, 1);
  } finally { await t.cleanup(); }
});

test("S0R-27 a restored earlier test is active protection again for the next mission", async () => {
  const t = await stateHub();
  try {
    recordStarted(t, { legacy: true });
    await t.hub.factory.stop(t.child.id);
    const restoredBy = t.child.id;
    t.child = await prepareMission(t, demoSpec("bug-demo-test-first", { projectId: t.project.id })); t.newSpec = stored(t, t.child.id).spec;
    await enableLive(t.hub, { provider: "codex", access: "workspace-write", attempts: 1 });
    t.queue("claude", "ok", "ok"); await start(t);
    await waitFor(() => t.hub.factory.view(t.child.id).factory.stage === "NEEDS_OWNER_DECISION", 20000, 20);
    await t.hub.factory.idle(t.child.id);
    const p = stored(t, t.child.id).prot;
    assert.ok(p.historic.active.some((x) => x.ref === oldRef && x.sha256 === sha256(oldText) && x.missionId === t.old.id));
    assert.equal(p.historic.retired.some((x) => x.from === oldRef), false);
    assert.deepEqual(t.hub.factory.historicViolations(restoredBy), []);
    assert.deepEqual(t.hub.factory.historicViolations(t.child.id), []);
  } finally { await t.cleanup(); }
});


test("S0R-28 typeof a response field is behavioural proof; typeof a loaded export is still forbidden", (t) => {
  const m = { cases: [{ name: "AC-1: câmp public", criterion: "AC-1", kind: "check", today: "fail" }] };
  const b = 'test("AC-1: câmp public", () => { const item = { phone: "secret" }; assert.equal(typeof item.phone, "undefined"); });';
  const text = assembleTestFile({ body: b }).text, r = execute(copy(t), text);
  const result = proof([r, r], text, m, { criteria: [criteria[0]] });
  assert.equal(result.verdict, "PROVEN"); assert.equal(result.table[0].origin, "behaviour");
  assert.ok(!lintTestBody(b, { manifest: m, criteria: [criteria[0]] }).violations.some((v) => v.rule === "export_existence_assert"));
  const bad = b.replace('const item = { phone: "secret" }', 'const item = await load("../../src/server-app.js")').replace('() =>', 'async () =>');
  assert.ok(lintTestBody(bad, { manifest: m, criteria: [criteria[0]], testRef: ref }).violations.some((v) => v.rule === "export_existence_assert"));
});

test("S0R-29 missing exports in all reference forms need a new API declaration; only need gives new_api provenance", (t) => {
  const m = { cases: [{ name: "AC-1: export nou", criterion: "AC-1", kind: "check", today: "fail" }], newApi: [{ module: "src/server-app.js", name: "publicBooking", criterion: "AC-1" }] };
  const opts = { manifest: m, criteria: [criteria[0]], workType: "FEATURE", testRef: ref, projectFiles: ["src/server-app.js"], moduleExports: { "src/server-app.js": exportNamesOf(source) } };
  for (const statement of ['assert.ok(m.publicBooking)', 'assert.notEqual(m.publicBooking, undefined)', 'assert.equal(m.publicBooking({}).phone, undefined)', 'assert.ok(m["publicBooking"])', 'assert.ok(m?.publicBooking)', 'const { publicBooking: fn } = await load("../../src/server-app.js"); assert.ok(fn)', 'const fn = need(m, "publicBooking"); assert.equal(fn({}).phone, undefined)']) {
    const b = `test("AC-1: export nou", async () => { const m = await load("../../src/server-app.js"); ${statement}; });`;
    assert.ok(lintTestBody(b, { ...opts, spec: { changesExisting: true } }).violations.some((v) => v.rule === "export_missing_undeclared"), statement);
    assert.ok(lintTestBody(b, { ...opts, manifest: { ...m, newApi: [] } }).violations.some((v) => v.rule === "export_missing_undeclared"), statement);
    const lint = lintTestBody(b, opts); assert.deepEqual(lint.violations, [], statement);
    const text = assembleTestFile({ body: b }).text, r = execute(copy(t), text);
    const result = proof([r, r], text, m, { criteria: [criteria[0]], spec: {}, facts: lint.facts });
    if (statement.includes('need(')) { assert.equal(result.verdict, "PROVEN"); assert.equal(result.table[0].origin, "new_api"); }
    else assert.ok(result.table.every((row) => row.origin !== "new_api"));
  }
});

for (const stage of ["BASELINE", "PAUSED", "NEEDS_OWNER_DECISION"]) test(`S0R-31 restart preserves pre-writer protection in ${stage}`, async () => {
  const t = await stateHub();
  try {
    recordStarted(t, { protectedTest: true });
    t.hub.db.prepare("UPDATE factory_missions SET stage = ? WHERE mission_id = ?").run(stage, t.child.id);
    const before = JSON.stringify(stored(t, t.child.id).prot), journal = JSON.stringify(readRetireJournal(t.project, t.child.id));
    t.hub.factory.recover(); t.hub.factory.recover();
    assert.equal(JSON.stringify(stored(t, t.child.id).prot), before);
    assert.equal(JSON.stringify(readRetireJournal(t.project, t.child.id)), journal);
    assert.equal(t.hub.factory.view(t.child.id).factory.stage, stage === "BASELINE" ? "BLOCKED" : stage);
    assert.equal(fs.existsSync(path.join(t.dir, oldRef)), false);
    assert.equal(events(t, "factory.retire_restored", t.child.id).length, 0);
  } finally { await t.cleanup(); }
});

test("S0R-32 legacy early retirement restores without abandoning, then real protection retires again with history", { timeout: 65000 }, async () => {
  const t = await stateHub();
  try {
    await enableLive(t.hub, { provider: "codex", access: "workspace-write", attempts: 1 });
    t.queue("claude", "author-slow:s25-new-protocol", "author:s25-new-protocol"); t.queue("codex", "test-review:pass", "ok");
    await start(t);
    await waitFor(() => t.hub.runs.activeRuns().some((r) => r.provider === "claude"), 20000, 30);
    await waitFor(() => fs.readFileSync(path.join(t.dataDir, "claude.queue"), "utf8").trim() === "author:s25-new-protocol", 5000, 20);
    await t.hub.factory.pause(t.child.id); await t.hub.factory.idle(t.child.id);
    const { row, prot } = stored(t, t.child.id);
    prot.retired = retireSuperseded(t.child.id, t.newSpec, t.project);
    t.hub.db.prepare("UPDATE factory_specs SET protected_json = ? WHERE id = ?").run(JSON.stringify(prot), row.id);
    t.hub.db.prepare("UPDATE factory_missions SET stage = 'NEEDS_OWNER_DECISION' WHERE mission_id = ?").run(t.child.id);
    t.hub.factory.recover();
    assert.equal(t.hub.factory.view(t.child.id).factory.stage, "NEEDS_OWNER_DECISION");
    assert.deepEqual(stored(t, t.child.id).prot.authoring, prot.authoring);
    assert.equal(fs.readFileSync(path.join(t.dir, oldRef), "utf8"), oldText);
    const history = readRetireJournal(t.project, t.child.id).history;
    await t.hub.factory.resume(t.child.id);
    await waitFor(() => t.hub.factory.writerStarted(t.child.id), 35000, 30);
    const p = stored(t, t.child.id).prot, j = readRetireJournal(t.project, t.child.id);
    assert.equal(p.authoring.status, "PROTECTED"); assert.equal(j.status, "MOVED");
    assert.equal(p.retired.length, 2); assert.equal(p.restored.length, 1);
    assert.deepEqual(j.history.slice(0, history.length), history);
    assert.ok(j.history.some((h) => h.status === "RESTORED"));
    assert.deepEqual(t.hub.factory.driftProvenance(t.project.id, [`.ifrim-hub/retired/${t.child.id}/journal.json`, p.retired[1].to, oldRef]).software, []);
    await t.hub.factory.stop(t.child.id);
  } finally { await t.cleanup(); }
});

test("S0R-33 Stop after protection restores exactly once and leaves FINAL unchanged at recovery", async () => {
  const t = await stateHub();
  try {
    recordStarted(t, { protectedTest: true });
    await t.hub.factory.stop(t.child.id);
    const p = stored(t, t.child.id).prot, j = JSON.stringify(readRetireJournal(t.project, t.child.id));
    assert.equal(p.authoring.status, "ABANDONED"); assert.equal(p.restored.length, 1);
    await t.hub.factory.stop(t.child.id); t.hub.factory.recover();
    assert.equal(t.hub.factory.view(t.child.id).factory.stage, "CANCELLED");
    assert.equal(JSON.stringify(readRetireJournal(t.project, t.child.id)), j);
    assert.equal(stored(t, t.child.id).prot.restored.length, 1);
    assert.equal(events(t, "factory.retire_restored", t.child.id).length, 1);
  } finally { await t.cleanup(); }
});

test("S0R-34 legacy media uses only the recorded version hash; refusal identifies every unhashed item", async () => {
  const t = await stateHub();
  try {
    const id = parentDelivery(t), d = t.hub.deliveries, db = t.hub.db;
    db.prepare("INSERT INTO media_assets (id, kind, category, title, origin, created_by, created_at, updated_at) VALUES ('s0r-asset', 'video', 'render', 'test', 'OWNED', 'test', '2026', '2026')").run();
    write(t.config.mediaDir, "renders/s0r.mp4", "media bytes");
    db.prepare("INSERT INTO media_asset_versions (id, asset_id, version, sha256, bytes, rel_path, created_by, created_at) VALUES ('s0r-version', 's0r-asset', 1, ?, 11, 'renders/s0r.mp4', 'test', '2026')").run(sha256("media bytes"));
    const item = d.bindItem(id, { kind: "render", role: "master", refTable: "media_asset_versions", refId: "s0r-version" });
    db.prepare("UPDATE delivery_items SET ref_sha = '' WHERE id = ?").run(item.id);
    d.trigger(id, "software_changed", { changedFiles: [], cause: "pregătire" });
    const good = d.reconcileStale(id, { actor: "test", dryRun: true });
    assert.equal(good.ok, true, JSON.stringify(good));
    assert.equal(good.evidence.files.find((i) => i.itemId === item.id).sha256, sha256("media bytes"));
    db.prepare("UPDATE media_asset_versions SET sha256 = '' WHERE id = 's0r-version'").run();
    db.prepare("UPDATE delivery_items SET ref_sha = '' WHERE delivery_id = ? AND ref_table = 'file'").run(id);
    const bad = d.reconcileStale(id, { actor: "test" });
    assert.equal(bad.ok, false); assert.equal(d.get(id).status, "STALE");
    for (const i of d.items(id).filter((i) => ["render", "export"].includes(i.kind))) assert.ok(bad.reasons.some((r) => r.includes(i.kind) && r.includes(i.role) && r.includes(i.id) && r.includes("hash")), JSON.stringify(bad));
  } finally { await t.cleanup(); }
});

test("S0R-35 interrupted restore leaves only removable Hub temps; atomic placement refuses a different target", async () => {
  const t = await stateHub(), copyFile = fs.copyFileSync;
  try {
    parentDelivery(t); const p = recordStarted(t, { legacy: true }), plan = p.retired;
    let crashed = false;
    fs.copyFileSync = function(from, to) {
      if (!crashed && String(to).includes(path.basename(oldRef)) && String(to).endsWith(".tmp")) { crashed = true; fs.writeFileSync(to, "partial"); throw new Error("synthetic crash"); }
      return copyFile.apply(this, arguments);
    };
    assert.equal(t.hub.factory.compensateRetirement(t.child.id, "crash").complete, false);
    fs.copyFileSync = copyFile;
    assert.equal(fs.existsSync(path.join(t.dir, oldRef)), false);
    write(t.dir, `${path.posix.dirname(plan[0].to)}/.${path.posix.basename(plan[0].to)}.012345abcdef.tmp`, "partial");
    write(t.dir, `${path.posix.dirname(oldRef)}/.${path.posix.basename(oldRef)}.external.tmp`, "not Hub");
    assert.equal(t.hub.factory.compensateRetirement(t.child.id, "retry").complete, true);
    assert.equal(fs.readFileSync(path.join(t.dir, oldRef), "utf8"), oldText);
    const external = `${path.posix.dirname(oldRef)}/.${path.posix.basename(oldRef)}.external.tmp`;
    assert.deepEqual(t.hub.factory.driftProvenance(t.project.id, t.hub.factory.snapshotCheck(t.old.id).changedFiles).software, [external]);
    fs.unlinkSync(path.join(t.dir, external));
    assert.deepEqual(t.hub.factory.driftProvenance(t.project.id, t.hub.factory.snapshotCheck(t.old.id).changedFiles).software, []);
    const again = retireSuperseded(t.child.id, t.newSpec, t.project); write(t.dir, oldRef, "different");
    assert.equal(restoreRetired(again, t.project, { missionId: t.child.id }).complete, false);
    assert.equal(fs.readFileSync(path.join(t.dir, oldRef), "utf8"), "different");
  } finally { fs.copyFileSync = copyFile; await t.cleanup(); }
});

for (const mutation of ["sha", "status", "mission", "unrecorded", "pending"]) test(`S0R-36 edited or planted journal (${mutation}) and its retired copy are software drift`, async () => {
  const t = await stateHub();
  try {
    const p = recordStarted(t, { protectedTest: true }), ref = `.ifrim-hub/retired/${t.child.id}/journal.json`;
    const j = readRetireJournal(t.project, t.child.id), { row } = stored(t, t.child.id);
    if (mutation === "sha") j.items[0].sha256 = "0".repeat(64);
    if (mutation === "status") j.status = "RESTORED";
    if (mutation === "mission") j.missionId = t.old.id;
    if (mutation === "unrecorded") p.retired = [];
    if (mutation === "pending") p.pendingRetire[0].sha256 = "0".repeat(64);
    t.hub.db.prepare("UPDATE factory_specs SET protected_json = ? WHERE id = ?").run(JSON.stringify(p), row.id);
    write(t.dir, ref, JSON.stringify(j));
    const paths = [ref, retirementPlan(t.child.id, t.newSpec)[0].to, oldRef];
    assert.deepEqual(t.hub.factory.driftProvenance(t.project.id, paths).software, paths);
  } finally { await t.cleanup(); }
});

test("S0R-37 null-spec refusal is safe and one recovery failure cannot roll back other missions", async () => {
  const t = await stateHub(), get = t.hub.projects.get;
  try {
    recordStarted(t, { legacy: true });
    const noSpec = await prepareMission(t, demoSpec("booking-demo"));
    t.hub.db.prepare("DELETE FROM factory_specs WHERE mission_id = ?").run(noSpec.id);
    write(t.dir, `.ifrim-hub/retired/${noSpec.id}/journal.json`, "broken");
    assert.equal(t.hub.factory.compensateRetirement(noSpec.id, "test").complete, false);
    assert.ok(events(t, "factory.retire_restore_refused", noSpec.id).length);
    let fail = true;
    t.hub.projects.get = function(id) { if (fail) { fail = false; throw new Error("synthetic recovery failure"); } return get.apply(this, arguments); };
    assert.doesNotThrow(() => t.hub.factory.recover());
    t.hub.projects.get = get;
    assert.equal(readRetireJournal(t.project, t.child.id).status, "RESTORED");
    assert.equal(stored(t, t.child.id).prot.authoring.status, "AUTHORING");
    assert.ok(events(t, "factory.retire_restore_refused", t.old.id).some((e) => e.reason.includes("synthetic recovery failure")));
  } finally { t.hub.projects.get = get; await t.cleanup(); }
});

test("S0R-38 missing bundle and screenshot do not abort binding; legacy rebind is idempotent", async () => {
  const t = await stateHub();
  try {
    const id = parentDelivery(t), d = t.hub.deliveries, db = t.hub.db;
    db.prepare("INSERT INTO factory_bundles (id, mission_id, change_set_id, change_set_sha, spec_version, manifest_json, sha256, status, file_path, created_at) VALUES ('s0r-bundle', ?, 's0r-cs', 'cs', 1, '{}', 'bundle', 'READY_FOR_OWNER_ACCEPTANCE', 'missing.zip', '2026')").run(t.old.id);
    const binding = { bundleId: "s0r-bundle", bundleSha: "bundle", bundleStatus: "READY_FOR_OWNER_ACCEPTANCE", changeSetId: "s0r-cs", changeSetSha: "cs", snapshotSha: d.get(id).snapshotSha, specVersion: 1, specSha: "spec", e2e: [{ status: "PASS", evidenceId: "missing-shot", criterion: "AC-1", screenshot: "e2e_missing.png" }] };
    assert.doesNotThrow(() => d.bindSoftware(d.get(id), binding, "test"));
    assert.equal(d.currentItem(id, "bundle").meta.fileSha, "");
    assert.equal(d.currentItem(id, "e2e_shot", "desktop:AC-1").refSha, "");
    const prev = d.currentItem(id, "export", "master");
    db.prepare("UPDATE delivery_items SET ref_sha = '' WHERE id = ?").run(prev.id);
    const again = d.bindItem(id, { kind: prev.kind, role: prev.role, refTable: prev.refTable, refId: prev.refId, refSha: sha256("verified render") });
    assert.equal(again.id, prev.id); assert.equal(again.refSha, "");
    d.trigger(id, "software_changed", { changedFiles: [], cause: "pregătire" });
    assert.equal(d.reconcileStale(id, { actor: "test" }).ok, false);
    assert.equal(d.get(id).status, "STALE");
  } finally { await t.cleanup(); }
});


for (const stage of ["CANCELLED", "REJECTED", "ACCEPTED"]) test(`S0R-33 boot compensates FINAL ${stage} before the writer and never reopens it`, async () => {
  const t = await stateHub();
  try {
    recordStarted(t, { protectedTest: true });
    t.hub.db.prepare("UPDATE factory_missions SET stage = ? WHERE mission_id = ?").run(stage, t.child.id);
    t.hub.factory.recover(); t.hub.factory.recover();
    assert.equal(t.hub.factory.view(t.child.id).factory.stage, stage);
    assert.equal(stored(t, t.child.id).prot.authoring.status, "ABANDONED");
    assert.equal(stored(t, t.child.id).prot.restored.length, 1);
    assert.equal(fs.readFileSync(path.join(t.dir, oldRef), "utf8"), oldText);
    assert.equal(events(t, "factory.retire_restored", t.child.id).length, 1);
  } finally { await t.cleanup(); }
});

test("S0R-33 a stopped mission whose writer started withdraws its protected test and keeps its retirement", async () => {
  const t = await stateHub();
  try {
    parentDelivery(t); const p = recordStarted(t, { protectedTest: true });
    t.hub.db.prepare("INSERT INTO factory_change_sets (id, mission_id, seq, snapshot_id, changes_json, sha256, status, created_at) VALUES ('s0r-written', ?, 1, 's0r-snap', '[]', 'sha', 'CURRENT', '2026')").run(t.child.id);
    await t.hub.factory.stop(t.child.id); t.hub.factory.recover();
    assert.equal(t.hub.factory.view(t.child.id).factory.stage, "CANCELLED");
    const a = stored(t, t.child.id).prot.authoring;
    assert.deepEqual([a.status, a.abandoned.why, a.abandoned.withdrawnFrom], ["ABANDONED", "stop", a.testRef]);
    assert.equal(fs.existsSync(path.join(t.dir, a.testRef)), false);
    assert.equal(sha256(fs.readFileSync(path.join(t.dir, a.stagingRef))), a.protectedSha);
    assert.deepEqual(stored(t, t.child.id).prot.retired, p.retired);
    assert.equal(events(t, "factory.test_abandoned", t.child.id).length, 1);
    assert.equal(readRetireJournal(t.project, t.child.id).status, "MOVED");
    assert.equal(events(t, "factory.retire_restored", t.child.id).length, 0);
  } finally { await t.cleanup(); }
});

for (const dispatchStage of ["TEST_REVIEW", "IMPLEMENTING"]) test(`S0R-40 restart blocks protected IMPLEMENTING with a REQUESTED ${dispatchStage} dispatch`, async () => {
  const t = await stateHub();
  try {
    const p = recordStarted(t, { protectedTest: true });
    t.hub.db.prepare("UPDATE factory_missions SET stage = 'IMPLEMENTING' WHERE mission_id = ?").run(t.child.id);
    // A prior step-0 dispatch exercises the pre-writer guard; a queued writer already counts as writerStarted.
    t.hub.db.prepare("INSERT INTO factory_dispatches (id, mission_id, stage, idempotency_key, status, request_json, created_at, updated_at) VALUES ('s0r-restart', ?, ?, 's0r-restart', 'REQUESTED', '{}', '2026', '2026')").run(t.child.id, dispatchStage);
    assert.equal(t.hub.factory.writerStarted(t.child.id), dispatchStage === "IMPLEMENTING");
    const journal = readRetireJournal(t.project, t.child.id);
    t.hub.factory.recover(); t.hub.factory.recover();
    const view = t.hub.factory.view(t.child.id);
    assert.equal(view.factory.stage, "BLOCKED");
    assert.equal(view.factory.waitReason, "owner_decision");
    assert.match(view.factory.stageReason, /Hub-ul a repornit în etapa IMPLEMENTING; verifică starea și reia manual/);
    assert.equal(view.dispatches.find((d) => d.id === "s0r-restart").status, "INTERRUPTED_UNKNOWN");
    assert.deepEqual(stored(t, t.child.id).prot, p);
    assert.equal(fs.readFileSync(path.join(t.dir, p.authoring.testRef), "utf8"), protocol.text);
    assert.equal(fs.existsSync(path.join(t.dir, oldRef)), false);
    for (const retired of p.retired) assert.equal(sha256(fs.readFileSync(path.join(t.dir, retired.to))), retired.sha256);
    assert.equal(readRetireJournal(t.project, t.child.id).status, "MOVED");
    assert.deepEqual(readRetireJournal(t.project, t.child.id), journal);
    assert.equal(events(t, "factory.retire_restored", t.child.id).length, 0);
    assert.equal(events(t, "factory.test_abandoned", t.child.id).length, 0);
  } finally { await t.cleanup(); }
});

test("S0R-41 restart restores legacy early retirement and blocks ACTIVE step zero without abandoning authoring", async () => {
  const t = await stateHub();
  try {
    const p = recordStarted(t, { legacy: true });
    t.hub.db.prepare("UPDATE factory_missions SET stage = 'TEST_AUTHORING' WHERE mission_id = ?").run(t.child.id);
    t.hub.db.prepare("INSERT INTO factory_dispatches (id, mission_id, stage, idempotency_key, status, request_json, created_at, updated_at) VALUES ('s0r-restart', ?, 'TEST_AUTHORING', 's0r-restart', 'CLAIMED', '{}', '2026', '2026')").run(t.child.id);
    assert.equal(t.hub.factory.writerStarted(t.child.id), false);
    t.hub.factory.recover(); t.hub.factory.recover();
    const view = t.hub.factory.view(t.child.id);
    assert.equal(view.factory.stage, "BLOCKED");
    assert.equal(view.factory.waitReason, "owner_decision");
    assert.match(view.factory.stageReason, /Hub-ul a repornit în etapa TEST_AUTHORING; verifică starea și reia manual/);
    assert.equal(view.dispatches.find((d) => d.id === "s0r-restart").status, "INTERRUPTED_UNKNOWN");
    assert.equal(fs.readFileSync(path.join(t.dir, oldRef), "utf8"), oldText);
    assert.equal(readRetireJournal(t.project, t.child.id).status, "RESTORED");
    assert.deepEqual(stored(t, t.child.id).prot.authoring, p.authoring);
    assert.equal(events(t, "factory.retire_restored", t.child.id).length, 1);
    assert.equal(events(t, "factory.test_abandoned", t.child.id).length, 0);
  } finally { await t.cleanup(); }
});

test("S0R-39 reject after the writer withdraws the protected test at its sha and keeps the retirement", async () => {
  const t = await stateHub();
  try {
    parentDelivery(t); const p = recordStarted(t, { protectedTest: true });
    t.hub.db.prepare("INSERT INTO factory_change_sets (id, mission_id, seq, snapshot_id, changes_json, sha256, status, created_at) VALUES ('s0r-written', ?, 1, 's0r-snap', '[]', 'sha', 'CURRENT', '2026')").run(t.child.id);
    assert.equal(t.hub.factory.writerStarted(t.child.id), true);
    const journal = readRetireJournal(t.project, t.child.id);
    const rejected = (await cmd(t, "factory.reject", { missionId: t.child.id, note: "Nu vreau schimbarea asta" })).result;
    const a = stored(t, t.child.id).prot.authoring;
    assert.equal(rejected.factory.stage, "REJECTED");
    assert.deepEqual([a.status, a.abandoned.why, a.abandoned.withdrawnFrom, a.abandoned.problem], ["ABANDONED", "reject", a.testRef, null]);
    assert.equal(fs.existsSync(path.join(t.dir, a.testRef)), false);
    assert.equal(sha256(fs.readFileSync(path.join(t.dir, a.stagingRef))), p.authoring.protectedSha);
    assert.match(rejected.factory.stageReason, /^Respins de proprietar: Nu vreau schimbarea asta\. Testul scris de Hub a fost mutat înapoi/);
    const [event] = events(t, "factory.test_abandoned", t.child.id);
    assert.deepEqual(event, { ref: a.stagingRef, sha: a.protectedSha, why: "reject", wasProtected: true, withdrawnFrom: a.testRef, problem: null });
    t.hub.factory.recover();
    assert.equal(events(t, "factory.test_abandoned", t.child.id).length, 1);
    assert.deepEqual(stored(t, t.child.id).prot.retired, p.retired);
    assert.equal(stored(t, t.child.id).prot.restored?.length || 0, 0);
    assert.equal(fs.existsSync(path.join(t.dir, oldRef)), false);
    for (const retired of p.retired) assert.equal(sha256(fs.readFileSync(path.join(t.dir, retired.to))), retired.sha256);
    assert.equal(readRetireJournal(t.project, t.child.id).status, "MOVED");
    assert.deepEqual(readRetireJournal(t.project, t.child.id), journal);
    assert.equal(events(t, "factory.retire_restored", t.child.id).length, 0);
  } finally { await t.cleanup(); }
});
