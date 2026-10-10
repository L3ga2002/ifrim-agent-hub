// Closure of the M11 corrections (2026-10-10): R-HIST (earlier Hub-written tests protected from a later writer, retired evidence
// protected), R-SUP (a test is retired only with its provenance and an explicit contract difference), R-ROLL (partial moves and recovery)
// and R-PACK (a reused Excel is copied into the new delivery folder, which verifies on its own). PASS_SIMULATED where a Hub runs: the fake
// Codex / Claude, the real `node --test` through the fake sandbox, temp copies of the versioned fixtures — no model, no network, no live
// Hub, nothing outside .ifrim/tmp and the OS temp folder.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { makeTestHub, enableLive, waitFor } from "./helpers.mjs";
import { createHub } from "../server/hub.mjs";
import { materializeFixture, demoSpec } from "../server/factory/fixtures.mjs";
import { integrityFindings } from "../server/factory/integrity.mjs";
import { retireSuperseded, restoreRetired, readRetireJournal, retirementPlan } from "../server/factory/factory.mjs";
import { analyzeHubTestCases, publicReadRoutes, readPublicClient, retirementContract, contractDrift } from "../server/factory/supersede.mjs";
import { checkSpec, SUPERSEDE_REPLACES } from "../server/factory/spec.mjs";
import { buildEngineeringSpec } from "../server/owner/planners/engineering.mjs";
import { createOfficeExecutors, verifyPackageFolder } from "../server/delivery/office-executors.mjs";
import { bookingsWorkbook } from "../server/office/demo-content.mjs";
import { buildXlsx } from "../server/office/xlsx.mjs";
import { checkXlsxFile } from "../server/office/office.mjs";
import { formulaCells } from "../server/office/xlsx.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const BOOKING = path.join(here, "fixtures", "r-priv-booking");
const OLD_TEXT = fs.readFileSync(path.join(here, "fixtures", "r-priv-old-hub-test.mjs.txt"), "utf8");
const OLD_REF = "test/hub/butonul-de-programare-trebuie-sa-84f571.test.mjs";
const AUTHORIZED = "Telefonul rămâne obligatoriu și salvat corect, dar lista publică a zilei nu afișează și nu transmite telefonul. Programările valide și fluxurile existente continuă să funcționeze.";
const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const tmp = (label) => fs.mkdtempSync(path.join(os.tmpdir(), `r-closure-${label}-`));
const write = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
const shaAt = (dir, rel) => (fs.existsSync(path.join(dir, rel)) ? sha(fs.readFileSync(path.join(dir, rel))) : null);
/** The earlier §25 spec's test criteria bound to the old Hub test (AC-1 refusal, AC-2 read back, AC-3 control), as the live record has them. */
const PREVIOUS = { acceptance: [
  { id: "AC-1", text: "Serverul aplică cerința și când e apelat direct: fără telefon refuzată, nimic salvat", verify: "test", testRef: OLD_REF },
  { id: "AC-2", text: "Telefonul se păstrează în programarea salvată (citire separată)", verify: "test", testRef: OLD_REF },
  { id: "AC-3", text: "O programare validă cu telefon e acceptată (control)", verify: "test", testRef: OLD_REF, guard: true },
  { id: "AC-4", text: "Revizuită independent", verify: "review" }] };
const NEXT = [{ id: "AC-1", kind: "public_omits" }, { id: "AC-2", kind: "anon_params" }, { id: "AC-3", kind: "required_refusal" }, { id: "AC-4", kind: "internal_persistence" }, { id: "AC-5", kind: "valid_accepted" }];
const ROUTES = publicReadRoutes(readPublicClient(BOOKING));

// ---------------------------------------------------------------------------------------------------------------------------
// R-SUP: provenance and the explicit contract difference (pure)
// ---------------------------------------------------------------------------------------------------------------------------

test("SUP-01 the public routes are what the project's own public page reads; the old §25 test's cases: AC-2 reads the phone from the public list, AC-1 / AC-3 keep their kinds", () => {
  assert.deepEqual(ROUTES, ["/api/bookings", "/api/services", "/api/slots"], "GET reads of public/js (the POST to /api/bookings with a method is not a read, but the GET of the day is)");
  const cases = analyzeHubTestCases(OLD_TEXT, "phone", ROUTES);
  assert.deepEqual(cases.map((c) => [c.id, c.kind, c.routes]), [["AC-1", "required_refusal", []], ["AC-2", "public_read", ["/api/bookings"]], ["AC-3", "valid_accepted", []]]);
});

test("SUP-02 the exact authorized retirement: the conflict is replaced by the public-omission, anonymous-parameter and internal-persistence checks; the unaffected cases keep their coverage", () => {
  const candidate = { testRef: OLD_REF, sha256: sha(Buffer.from(OLD_TEXT)), missionId: "mis_mv1eo6il_104584123d", specVersion: 1 };
  const r = retirementContract({ candidate, text: OLD_TEXT, key: "phone", publicRoutes: ROUTES, previous: PREVIOUS, next: NEXT });
  assert.equal(r.ok, true, r.problem);
  assert.deepEqual(r.contract.conflicts.map((c) => [c.case, c.routes, c.replacedBy]), [["AC-2", ["/api/bookings"], ["AC-1", "AC-2", "AC-4"]]]);
  assert.deepEqual(r.contract.kept.map((k) => [k.case, k.kind, k.coveredBy]), [["AC-1", "required_refusal", ["AC-3"]], ["AC-3", "valid_accepted", ["AC-5"]]]);
  assert.deepEqual(r.contract.previous, { missionId: candidate.missionId, specVersion: 1 });
  // The spec accepts it (ids of its own test criteria); the factory's re-check finds no drift on the same bytes and client.
  const acceptance = NEXT.map((n) => ({ id: n.id, text: `criteriul ${n.kind}`, verify: "test", testRef: "test/hub/telefonul-ramane-abcdef.test.mjs", kind: n.kind, ...(["public_omits", "anon_params"].includes(n.kind) ? {} : { guard: true }) }));
  const spec = checkSpec({ workType: "FEATURE", title: "Lista publică fără telefon", objective: AUTHORIZED, acceptance,
    verification: { checks: ["node --test"], acceptance: ["node --test test/hub/telefonul-ramane-abcdef.test.mjs"] }, supersedes: [{ ...candidate, reason: "citește telefonul din lista publică", contract: r.contract }] });
  assert.deepEqual(spec.problems, []);
  assert.equal(contractDrift(spec.spec.supersedes[0].contract, OLD_TEXT, ROUTES), null);
  // A drift: the old file reformatted to a variable URL (route no longer provable), or the public page no longer reads the list.
  assert.match(contractDrift(r.contract, OLD_TEXT.replace("`http://127.0.0.1:${srv.port}/api/bookings?date=2026-10-09`);\n    assert.equal(g.status", "listUrl);\n    assert.equal(g.status"), ROUTES), /AC-2 nu mai citește lista publică/);
  assert.match(contractDrift(r.contract, OLD_TEXT, ["/api/services", "/api/slots"]), /AC-2 nu mai citește lista publică/);
});

test("SUP-03 no provenance, no retirement: a file the Hub cannot tie to the mission and version that protected it, or without its earlier spec", () => {
  const base = { testRef: OLD_REF, sha256: sha(Buffer.from(OLD_TEXT)) };
  assert.match(retirementContract({ candidate: { ...base, missionId: null, specVersion: null }, text: OLD_TEXT, key: "phone", publicRoutes: ROUTES, previous: PREVIOUS, next: NEXT }).problem, /proveniență lipsă/);
  assert.match(retirementContract({ candidate: { ...base, missionId: "mis_x_0123456789", specVersion: 1 }, text: OLD_TEXT, key: "phone", publicRoutes: ROUTES, previous: null, next: NEXT }).problem, /specificația misiunii originale lipsește/);
  // A case that is not a criterion of that earlier spec bound to this file (another test file's criteria) is no contract either.
  const otherFile = { acceptance: PREVIOUS.acceptance.map((a) => ({ ...a, testRef: "test/hub/alt-test-abcdef.test.mjs" })) };
  assert.match(retirementContract({ candidate: { ...base, missionId: "mis_x_0123456789", specVersion: 1 }, text: OLD_TEXT, key: "phone", publicRoutes: ROUTES, previous: otherFile, next: NEXT }).problem, /nu corespunde unui criteriu/);
  // The spec refuses an entry without the mission / version (checkSpec allowed it before the closure).
  const problems = checkSpec({ workType: "FEATURE", title: "x", objective: "y", acceptance: [{ id: "AC-1", text: "Lista publică nu conține telefonul", verify: "test", testRef: "test/hub/a-abcdef.test.mjs" }],
    verification: { checks: ["node --test"], acceptance: ["node --test test/hub/a-abcdef.test.mjs"] }, supersedes: [{ ...base, reason: "citește telefonul din listă" }] }).problems.join(" | ");
  assert.match(problems, /misiunea originală lipsește/);
  assert.match(problems, /versiunea specificației originale lipsește/);
  assert.match(problems, /diferența explicită/);
});

test("SUP-04 an internal authorized GET is compatible: a read on a route the public page never reads, or with credentials, is not a conflict (nothing retired)", () => {
  const candidate = { testRef: OLD_REF, missionId: "mis_x_0123456789", specVersion: 1 };
  const internal = OLD_TEXT.replace("/api/bookings?date=2026-10-09`);\n    assert.equal(g.status, 200, \"AC-2", "/internal/bookings?date=2026-10-09`);\n    assert.equal(g.status, 200, \"AC-2");
  assert.notEqual(internal, OLD_TEXT);
  const a = analyzeHubTestCases(internal, "phone", ROUTES);
  assert.equal(a.find((c) => c.id === "AC-2").kind, "valid_accepted", "the read is internal; the case still checks a creation");
  assert.deepEqual(a.find((c) => c.id === "AC-2").internalReads, ["/internal/bookings"]);
  assert.match(retirementContract({ candidate: { ...candidate, sha256: sha(Buffer.from(internal)) }, text: internal, key: "phone", publicRoutes: ROUTES, previous: PREVIOUS, next: NEXT }).problem, /niciun caz nu citește câmpul din lista publică/);
  const withToken = "test(\"AC-2: citire internă\", async () => {\n  const g = await fetch(`${base}/api/bookings?date=1`, { headers: { authorization: \"Bearer t\" } });\n  assert.equal(g.bookings[0].phone, \"1\");\n});\n";
  assert.deepEqual(analyzeHubTestCases(withToken, "phone", ROUTES)[0].internalReads, ["/api/bookings"], "a GET with credentials is an authorized read");
  // A variable URL: the route cannot be proven either way — no automatic retirement.
  const variable = "test(\"AC-2: listă\", async () => {\n  const g = await httpGet(listUrl);\n  assert.equal(g.body.bookings[0].phone, \"1\");\n});\n";
  assert.equal(analyzeHubTestCases(variable, "phone", ROUTES)[0].kind, "unproven_read");
});

test("SUP-05 unaffected criteria are kept: a case the new request does not cover (no „still required” check) blocks the retirement; the old test stays active", () => {
  const candidate = { testRef: OLD_REF, sha256: sha(Buffer.from(OLD_TEXT)), missionId: "mis_x_0123456789", specVersion: 1 };
  const withoutRequired = NEXT.filter((n) => n.kind !== "required_refusal");
  assert.match(retirementContract({ candidate, text: OLD_TEXT, key: "phone", publicRoutes: ROUTES, previous: PREVIOUS, next: withoutRequired }).problem, /cazul AC-1 \(required_refusal\) nu are în cererea nouă o verificare/);
  const withoutInternal = NEXT.filter((n) => n.kind !== "internal_persistence");
  assert.match(retirementContract({ candidate, text: OLD_TEXT, key: "phone", publicRoutes: ROUTES, previous: PREVIOUS, next: withoutInternal }).problem, /nu are toate verificările care îl înlocuiesc/);
});

test("SUP-06 the planner on a copy of the §25 app: the authorized sentence + the old test with provenance → ONE supersedes entry with the contract in the hashed spec; without provenance → no entry, the card says the test stays active", () => {
  const dir = tmp("planner");
  try {
    fs.cpSync(BOOKING, dir, { recursive: true });
    write(dir, OLD_REF, OLD_TEXT);
    const project = { id: "prj_closure_0123456789", path: dir, source: "hub-test", name: "copie §25" };
    const old = { ref: OLD_REF, sha256: sha(Buffer.from(OLD_TEXT)), text: OLD_TEXT, missionId: "mis_mv1eo6il_104584123d", specVersion: 1, previousSpec: PREVIOUS };
    const built = buildEngineeringSpec({ text: AUTHORIZED, project, hubTests: [old] });
    assert.deepEqual(built.problems, [], built.problems.join("; "));
    const sup = built.input.spec.supersedes;
    assert.equal(sup.length, 1);
    assert.equal(sup[0].missionId, "mis_mv1eo6il_104584123d");
    assert.deepEqual(sup[0].contract.conflicts.map((c) => [c.case, c.routes]), [["AC-2", ["/api/bookings"]]]);
    const ids = built.input.spec.acceptance.filter((a) => a.verify === "test").map((a) => a.id);
    for (const id of [...sup[0].contract.conflicts.flatMap((c) => c.replacedBy), ...sup[0].contract.kept.flatMap((k) => k.coveredBy)]) assert.ok(ids.includes(id), id);
    assert.ok(built.input.spec.constraints.some((c) => /Diferența de contract/.test(c)), "the card shows the difference");
    // Without provenance: no entry, said on the card.
    const orphan = buildEngineeringSpec({ text: AUTHORIZED, project, hubTests: [{ ...old, missionId: null, specVersion: null, previousSpec: null }] });
    assert.equal(orphan.input.spec.supersedes, undefined);
    assert.ok(orphan.input.spec.constraints.some((c) => /rămâne activ și neschimbat.*proveniență lipsă/.test(c)), orphan.input.spec.constraints.join(" | "));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------------------------------------------------------
// R-HIST: the integrity rules (pure)
// ---------------------------------------------------------------------------------------------------------------------------

test("HIST-01 integrity: an earlier mission's active Hub test modified, deleted or replaced, a retired copy altered, a retired test recreated (same path or same bytes) — each critical", () => {
  const historic = { refs: ["test/hub/istoric-telefon-aaaaaa.test.mjs"], retired: [{ from: "test/hub/retras-vechi-bbbbbb.test.mjs", to: ".ifrim-hub/retired/mis_a/retras-vechi-bbbbbb.test.mjs.retired", sha256: "a".repeat(64) }] };
  const ch = (p, status, extra = {}) => ({ path: p, status, testFile: /test/.test(p), controlFile: p.startsWith(".ifrim-hub/"), secretLike: false, after: status === "deleted" ? null : { sha256: extra.sha || "b".repeat(64) } });
  const codes = (changes) => integrityFindings({ changes, historic }).map((f) => [f.severity, f.code, f.file]);
  assert.deepEqual(codes([ch("test/hub/istoric-telefon-aaaaaa.test.mjs", "modified")]), [["critical", "historic_test_changed", "test/hub/istoric-telefon-aaaaaa.test.mjs"]]);
  assert.deepEqual(codes([ch("test/hub/istoric-telefon-aaaaaa.test.mjs", "deleted")]), [["critical", "historic_test_changed", "test/hub/istoric-telefon-aaaaaa.test.mjs"]]);
  assert.deepEqual(codes([ch(".ifrim-hub/retired/mis_a/retras-vechi-bbbbbb.test.mjs.retired", "modified")]), [["critical", "retired_test_changed", ".ifrim-hub/retired/mis_a/retras-vechi-bbbbbb.test.mjs.retired"]]);
  assert.deepEqual(codes([ch("test/hub/retras-vechi-bbbbbb.test.mjs", "added")]), [["critical", "retired_test_recreated", "test/hub/retras-vechi-bbbbbb.test.mjs"]]);
  assert.deepEqual(codes([ch("test/hub/alt-nume-cccccc.test.mjs", "added", { sha: "a".repeat(64) })]), [["critical", "retired_test_recreated", "test/hub/alt-nume-cccccc.test.mjs"]], "the retired bytes under another name");
  // Before the closure the same change was only medium test_modified (the historic list is what makes it critical).
  assert.deepEqual(integrityFindings({ changes: [ch("test/hub/istoric-telefon-aaaaaa.test.mjs", "modified")] }).map((f) => [f.severity, f.code]), [["medium", "test_modified"]]);
  // Another test file, added fresh, stays ordinary.
  assert.deepEqual(codes([ch("test/regression.test.mjs", "added")]), []);
});

// ---------------------------------------------------------------------------------------------------------------------------
// R-ROLL: the moves on disk (pure file level)
// ---------------------------------------------------------------------------------------------------------------------------

function twoOld(dir) {
  const a = { testRef: "test/hub/retras-unu-aaaaaa.test.mjs", text: `${OLD_TEXT}// unu\n` };
  const b = { testRef: "test/hub/retras-doi-bbbbbb.test.mjs", text: `${OLD_TEXT}// doi\n` };
  for (const x of [a, b]) write(dir, x.testRef, x.text);
  return { a, b, spec: { supersedes: [a, b].map((x) => ({ testRef: x.testRef, sha256: sha(Buffer.from(x.text)), missionId: "mis_old_0123456789", specVersion: 1, reason: "citește telefonul din listă" })) } };
}

test("ROLL-01 the whole list is checked before the first move: a mismatch on the SECOND file moves nothing (the first stays in the suite)", () => {
  const dir = tmp("precheck");
  try {
    const { a, b, spec } = twoOld(dir);
    fs.writeFileSync(path.join(dir, b.testRef), "// schimbat\n");
    assert.throws(() => retireSuperseded("mis_new_0123456789", spec, { path: dir }), (e) => e.code === "SUPERSEDE_MISMATCH");
    assert.equal(shaAt(dir, a.testRef), spec.supersedes[0].sha256, "the first file was not moved");
    assert.equal(readRetireJournal({ path: dir }, "mis_new_0123456789"), null, "nothing started: no journal");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("ROLL-02 an interruption at each point (copy, verify, rename, remove, record) — simulated as a crash, nothing restored — is finished by the next start: no test lost, none duplicated, the journal says MOVED", () => {
  for (const point of ["copy", "verify", "rename", "remove", "record"]) {
    for (const which of [0, 1]) {
      const dir = tmp(`crash-${point}`);
      try {
        const { spec } = twoOld(dir);
        const target = spec.supersedes[which].testRef;
        assert.throws(() => retireSuperseded("mis_new_0123456789", spec, { path: dir }, { fault: (p, item) => { if (p === point && (item === null || item.from === target)) throw new Error(`crash at ${point}`); } }), /crash at/);
        if (point !== "record") assert.equal(readRetireJournal({ path: dir }, "mis_new_0123456789").status, "MOVING", `${point}: the journal kept the intent`);
        const out = retireSuperseded("mis_new_0123456789", spec, { path: dir });
        assert.equal(out.length, 2, point);
        for (const s of spec.supersedes) {
          assert.equal(shaAt(dir, s.testRef), null, `${point}/${which}: ${s.testRef} out of the suite`);
          const plan = retirementPlan("mis_new_0123456789", { supersedes: [s] })[0];
          assert.equal(shaAt(dir, plan.to), s.sha256, `${point}/${which}: kept unchanged`);
        }
        const folder = path.join(dir, ".ifrim-hub", "retired", "mis_new_0123456789");
        assert.deepEqual(fs.readdirSync(folder).sort(), ["journal.json", "retras-doi-bbbbbb.test.mjs.retired", "retras-unu-aaaaaa.test.mjs.retired"], `${point}/${which}: no temporary copy or duplicate left`);
        assert.equal(readRetireJournal({ path: dir }, "mis_new_0123456789").status, "MOVED");
      } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    }
  }
});

test("ROLL-03 restore after a failed start is verified: complete → RESTORED; a retired copy lost → RESTORE_INCOMPLETE, said per file, never „success”", () => {
  const dir = tmp("restore");
  try {
    const { a, b, spec } = twoOld(dir);
    const plan = retirementPlan("mis_new_0123456789", spec);
    retireSuperseded("mis_new_0123456789", spec, { path: dir });
    const ok = restoreRetired(plan, { path: dir }, { missionId: "mis_new_0123456789" });
    assert.equal(ok.complete, true);
    assert.deepEqual(ok.items.map((i) => i.state), ["restored", "restored"]);
    assert.equal(shaAt(dir, a.testRef), spec.supersedes[0].sha256);
    assert.equal(readRetireJournal({ path: dir }, "mis_new_0123456789").status, "RESTORED");
    retireSuperseded("mis_new_0123456789", spec, { path: dir });
    fs.rmSync(path.join(dir, plan[1].to));
    const bad = restoreRetired(plan, { path: dir }, { missionId: "mis_new_0123456789" });
    assert.equal(bad.complete, false);
    assert.deepEqual(bad.items.map((i) => [i.from, i.state]), [[a.testRef, "restored"], [b.testRef, "incomplete"]]);
    assert.match(bad.items[1].problem, /nici originalul, nici copia/);
    const j = readRetireJournal({ path: dir }, "mis_new_0123456789");
    assert.equal(j.status, "RESTORE_INCOMPLETE");
    assert.ok(j.problems.some((p) => p.includes(b.testRef)));
    // The next attempt does not move anything: the second file is in no known state.
    assert.throws(() => retireSuperseded("mis_new_0123456789", spec, { path: dir }), (e) => e.code === "SUPERSEDE_MISMATCH");
    assert.equal(shaAt(dir, a.testRef), spec.supersedes[0].sha256, "the restored first file stays in the suite");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------------------------------------------------------
// Factory level: R-SUP-01 server-side, R-ROLL around the start, R-HIST through a real (simulated) writer
// ---------------------------------------------------------------------------------------------------------------------------

const MODELS = { writerModel: "gpt-fake-sol", reviewerModel: "sonnet" };
const SETTLED = ["DELIVERY_READY", "NEEDS_OWNER_DECISION", "BLOCKED", "PAUSED", "CANCELLED", "ACCEPTED", "REJECTED"];
const dispatch = (hub, type, payload, channel = "test") => hub.commands.dispatch({ type, payload, channel, actor: "test" });
const view = (t, id) => t.hub.factory.view(id);
const untilStage = (t, id, stages, ms = 150000) => waitFor(() => (stages.includes(view(t, id).factory.stage) ? view(t, id) : null), ms, 100);
const HIST = "test/hub/istoric-telefon-aaaaaa.test.mjs";
const HIST_TEXT = 'import test from "node:test";\nimport assert from "node:assert/strict";\ntest("AC-1: testul Hub al misiunii anterioare", () => { assert.equal(1 + 1, 2); });\n';
const CLIENT = 'const api = (u, o) => fetch(u, o);\nexport const load = (d) => api(`/api/bookings?date=${d}`);\nexport const save = (b) => api("/api/bookings", { method: "POST", body: JSON.stringify(b) });\n';

async function closureHub({ project = "bug-demo", extra = null } = {}) {
  const t = await makeTestHub({ queues: true });
  await enableLive(t.hub, { provider: "codex", access: "workspace-write", attempts: 1 });
  const dir = path.join(t.dataDir, `factory-${project}`);
  materializeFixture(project, dir);
  write(dir, HIST, HIST_TEXT);
  write(dir, "public/js/client.mjs", CLIENT);
  if (extra) extra(dir);
  const p = (await dispatch(t.hub, "project.register_test", { path: dir })).result;
  t.hub.bus.transaction(() => {
    t.hub.grants.create({ provider: "codex", projectId: p.id, access: "workspace-write", maxAttempts: 5, maxDurationS: 900, ttlMinutes: 60 }, "test");
    t.hub.grants.create({ provider: "claude", projectId: p.id, access: "read-only", maxAttempts: 5, maxDurationS: 900, ttlMinutes: 60 }, "test");
  });
  return { ...t, project: p, dir };
}
/** bug-demo's acceptance with the five derived kinds (one test file), so a retirement contract can name the right checks. */
const KINDED = [...NEXT.map((n) => ({ id: n.id, text: `Criteriul ${n.kind} al cererii noi`, verify: "test", testRef: "test/acceptance.test.mjs", kind: n.kind, ...(["public_omits", "anon_params"].includes(n.kind) ? {} : { guard: true }) })),
  { id: "AC-6", text: "Cauza și fixul sunt explicate și revizuite independent", verify: "review" }];
const prepare = async (t, extraSpec = {}, projectId = t.project.id) => (await dispatch(t.hub, "factory.prepare", { projectId, ...demoSpec("bug-demo"), ...(Object.keys(extraSpec).length ? { spec: { ...demoSpec("bug-demo").spec, ...extraSpec } } : {}), limits: MODELS })).result.mission;
async function approveAndStart(t, missionId) {
  const requested = await dispatch(t.hub, "factory.start", view(t, missionId).scope);
  await dispatch(t.hub, "approval.decide", { approvalId: requested.approval.id, decision: "approved", displayedHash: requested.approval.payloadHash });
  return t.hub.commands.executeApproved(requested.command.id, "user");
}
/** Marks a prepared mission as an EARLIER mission whose step 0 wrote and protected `ref` (the record a real L5 start leaves). */
function makeEarlierOwner(t, missionId, ref, digest, acceptance = null) {
  const row = t.hub.db.prepare("SELECT id, spec_json FROM factory_specs WHERE mission_id = ? ORDER BY version DESC LIMIT 1").get(missionId);
  const spec = JSON.parse(row.spec_json);
  if (acceptance) spec.acceptance = acceptance;
  t.hub.db.prepare("UPDATE factory_specs SET status = 'APPROVED', approved_at = ?, spec_json = ?, protected_json = ? WHERE id = ?")
    .run(new Date().toISOString(), JSON.stringify(spec), JSON.stringify({ problems: [], files: { [ref]: digest }, authoring: { status: "PROTECTED", testRef: ref, protectedSha: digest } }), row.id);
  t.hub.db.prepare("UPDATE factory_missions SET stage = 'ACCEPTED' WHERE mission_id = ?").run(missionId);
}
const events = (t, type, missionId) => t.hub.db.prepare("SELECT payload_json FROM events WHERE type = ? AND scope_id = ? ORDER BY seq").all(type, missionId).map((r) => JSON.parse(r.payload_json));

/** Two old Hub tests in the project, each protected by its own earlier mission, and the contract of their retirement for a bug-demo spec. */
async function withTwoRetirable(t) {
  const olds = [{ ref: "test/hub/retras-unu-aaaaaa.test.mjs", text: `${OLD_TEXT}// unu\n` }, { ref: "test/hub/retras-doi-bbbbbb.test.mjs", text: `${OLD_TEXT}// doi\n` }];
  const supersedes = [];
  const next = NEXT;
  const routes = publicReadRoutes(readPublicClient(t.dir));
  for (const o of olds) {
    write(t.dir, o.ref, o.text);
    const earlier = await prepare(t);
    const acceptance = PREVIOUS.acceptance.map((a) => ({ ...a, testRef: a.testRef ? o.ref : a.testRef }));
    const digest = sha(Buffer.from(o.text));
    makeEarlierOwner(t, earlier.id, o.ref, digest, acceptance);
    const candidate = { testRef: o.ref, sha256: digest, missionId: earlier.id, specVersion: 1 };
    const built = retirementContract({ candidate, text: o.text, key: "phone", publicRoutes: routes, previous: { acceptance }, next });
    assert.equal(built.ok, true, built.problem);
    supersedes.push({ ...candidate, reason: "citește telefonul din lista publică", contract: built.contract });
  }
  return { olds, supersedes };
}

test("FAC-01 R-SUP-01 on the server: a retirement naming a mission of another project, a wrong sha, a wrong version or an unknown mission is refused before anything moves", async () => {
  const t = await closureHub();
  try {
    const { olds, supersedes } = await withTwoRetirable(t);
    // Another test project of the SAME Hub, with a mission that protected the same path and bytes.
    const otherDir = path.join(t.dataDir, "factory-other");
    materializeFixture("bug-demo", otherDir);
    const otherProject = (await dispatch(t.hub, "project.register_test", { path: otherDir, name: "Alt proiect de test" })).result;
    {
      const foreign = await prepare(t, {}, otherProject.id);
      makeEarlierOwner(t, foreign.id, olds[0].ref, supersedes[0].sha256);
      const cases = [
        ["another project", { ...supersedes[0], missionId: foreign.id, contract: { ...supersedes[0].contract, previous: { missionId: foreign.id, specVersion: 1 } } }, /aparține altui proiect/],
        ["wrong version", { ...supersedes[0], specVersion: 2, contract: { ...supersedes[0].contract, previous: { missionId: supersedes[0].missionId, specVersion: 2 } } }, /nu există/],
        ["wrong sha", { ...supersedes[0], sha256: "c".repeat(64) }, /sha-ul nu e cel protejat/],
        ["unknown mission", { ...supersedes[0], missionId: "mis_nimeni_0123456789", contract: { ...supersedes[0].contract, previous: { missionId: "mis_nimeni_0123456789", specVersion: 1 } } }, /nu există/],
      ];
      for (const [label, entry, re] of cases) {
        const m = await prepare(t, { supersedes: [entry], acceptance: KINDED });
        assert.deepEqual(view(t, m.id).spec.protected?.problems || [], [], label);
        await assert.rejects(approveAndStart(t, m.id), (e) => re.test(e.message) && /nu poate fi retras/.test(e.message), label);
        for (const o of olds) assert.ok(fs.existsSync(path.join(t.dir, o.ref)), `${label}: ${o.ref} untouched`);
        assert.equal(view(t, m.id).factory.stage, "SPEC_DRAFT", label);
      }
    }
  } finally { await t.cleanup(); }
});

test("FAC-02 R-ROLL: the first file moved and the second failing, a failing snapshot, a failing start record — every moved file is put back and verified; then the exact authorized retirement succeeds once (no duplicated record)", async () => {
  const t = await closureHub();
  try {
    const { olds, supersedes } = await withTwoRetirable(t);
    const m = await prepare(t, { supersedes, acceptance: KINDED });
    for (const [point, onSecond] of [["copy", true], ["remove", true], ["snapshot", false], ["start_record", false]]) {
      t.hub.factory.setStartFaultForTests((p, item) => { if (p === point && (!onSecond || item?.from === olds[1].ref)) throw new Error(`fault at ${point}`); });
      await assert.rejects(approveAndStart(t, m.id), new RegExp(`fault at ${point}`), point);
      for (const o of olds) assert.equal(shaAt(t.dir, o.ref), sha(Buffer.from(o.text)), `${point}: ${o.ref} back in the suite, same bytes`);
      assert.equal(readRetireJournal({ path: t.dir }, m.id).status, "RESTORED", point);
      assert.equal(view(t, m.id).factory.stage, "SPEC_DRAFT", point);
      assert.equal(t.hub.db.prepare("SELECT status FROM factory_specs WHERE mission_id = ? ORDER BY version DESC").get(m.id).status === "APPROVED", false, `${point}: no start recorded`);
    }
    assert.equal(events(t, "factory.retire_restored", m.id).length, 4);
    assert.ok(events(t, "factory.retire_restored", m.id).every((e) => e.complete === true));
    t.hub.factory.setStartFaultForTests(null);
    t.queue("codex", "factory-write:bug-fix");
    t.queue("claude", "review:pass");
    await approveAndStart(t, m.id);
    for (const o of olds) assert.equal(shaAt(t.dir, o.ref), null, `${o.ref} retired`);
    const prot = view(t, m.id).spec.protected;
    assert.deepEqual(prot.retired.map((r) => r.from), olds.map((o) => o.ref));
    assert.deepEqual(prot.historic.active.map((a) => a.ref), [], "the retiring missions' tests are not „active” historic tests of this start");
    assert.equal(events(t, "factory.test_superseded", m.id).length, 2, "one record per retired test, after four failed attempts");
    const done = await untilStage(t, m.id, SETTLED);
    assert.equal(done.factory.stage, "DELIVERY_READY", done.factory.stageReason);
  } finally { await t.cleanup(); }
});

test("FAC-03 R-ROLL-03: a restore that cannot put a file back stops the start with RETIRE_RESTORE_INCOMPLETE and the journal says so; the next start refuses until the files are consistent", async () => {
  const t = await closureHub();
  try {
    const { olds, supersedes } = await withTwoRetirable(t);
    const m = await prepare(t, { supersedes, acceptance: KINDED });
    const plan = retirementPlan(m.id, { supersedes });
    t.hub.factory.setStartFaultForTests((p, item) => { if (p === "remove" && item?.from === olds[1].ref) { fs.rmSync(path.join(t.dir, plan[0].to)); throw new Error("fault after the first copy was lost"); } });
    await assert.rejects(approveAndStart(t, m.id), (e) => e.code === "RETIRE_RESTORE_INCOMPLETE" && /NU au putut fi puse toate înapoi/.test(e.message));
    assert.equal(readRetireJournal({ path: t.dir }, m.id).status, "RESTORE_INCOMPLETE");
    assert.equal(events(t, "factory.retire_restored", m.id).at(-1).complete, false);
    t.hub.factory.setStartFaultForTests(null);
    await assert.rejects(approveAndStart(t, m.id), /nu poate fi retras/);
    assert.equal(view(t, m.id).factory.stage, "SPEC_DRAFT");
  } finally { await t.cleanup(); }
});

test("FAC-04 R-ROLL-02: the Hub dies after the moves and before the start record — at the next boot the tests go back (verified); the start then runs once", async () => {
  const t = await closureHub();
  let restarted = null;
  try {
    const { olds, supersedes } = await withTwoRetirable(t);
    const m = await prepare(t, { supersedes, acceptance: KINDED });
    const strict = view(t, m.id).spec.spec;
    retireSuperseded(m.id, strict, { path: t.dir });
    for (const o of olds) assert.equal(shaAt(t.dir, o.ref), null);
    await t.hub.close();
    const hub = createHub(t.config, { homeDir: t.homeDir });
    const report = await hub.boot();
    t.hub = hub;
    restarted = hub;
    await enableLive(hub, { provider: "codex", access: "workspace-write", attempts: 1 });
    for (const o of olds) assert.equal(shaAt(t.dir, o.ref), sha(Buffer.from(o.text)), `${o.ref} back after the restart`);
    assert.equal(readRetireJournal({ path: t.dir }, m.id).status, "RESTORED");
    assert.ok(JSON.stringify(report).includes(m.id), "the boot report names the mission");
    t.queue("codex", "factory-write:bug-fix");
    t.queue("claude", "review:pass");
    await approveAndStart(t, m.id);
    assert.equal(events(t, "factory.test_superseded", m.id).length, 2);
    const done = await untilStage(t, m.id, SETTLED);
    assert.equal(done.factory.stage, "DELIVERY_READY", done.factory.stageReason);
  } finally {
    if (!restarted) await t.cleanup();
    else { await restarted.close(); try { fs.rmSync(t.dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* left in .ifrim/tmp */ } }
  }
});

test("FAC-05 R-HIST through the writer: an earlier mission's active Hub test modified or deleted by a later writer → critical, no checks run; the Hub's own retirement is no finding", async () => {
  for (const [patch, status] of [["hist-modify", "modified"], ["hist-delete", "deleted"]]) {
    const t = await closureHub();
    try {
      const earlier = await prepare(t);
      makeEarlierOwner(t, earlier.id, HIST, sha(Buffer.from(HIST_TEXT)));
      const m = await prepare(t);
      t.queue("codex", `factory-write:${patch}`);
      await approveAndStart(t, m.id);
      assert.deepEqual(view(t, m.id).spec.protected.historic.active.map((a) => [a.ref, a.missionId]), [[HIST, earlier.id]]);
      const done = await untilStage(t, m.id, SETTLED);
      assert.equal(done.factory.stage, "NEEDS_OWNER_DECISION", patch);
      assert.match(done.factory.stageReason, /historic_test_changed/, patch);
      const f = done.findings.find((x) => x.fingerprint === `integrity:historic_test_changed:${HIST}`);
      assert.equal(f?.severity, "critical", patch);
      assert.match(f.evidence, new RegExp(status));
      assert.equal(done.evidence.filter((e) => e.stage === "CHECKING").length, 0, `${patch}: no check ran on that version`);
      assert.deepEqual(t.hub.factory.historicViolations(m.id), [`testul Hub anterior ${HIST} (misiunea ${earlier.id}) a fost ${status === "deleted" ? "șters" : "modificat"}`]);
    } finally { await t.cleanup(); }
  }
});

/** An earlier mission retired retras-vechi (the record a successful R-PRIV start leaves) and another protected the active historic test. */
async function withRetiredByEarlier(t) {
  const retiredText = `${OLD_TEXT}// vechi\n`;
  const owner = await prepare(t);
  makeEarlierOwner(t, owner.id, HIST, sha(Buffer.from(HIST_TEXT)));
  const retirer = await prepare(t);
  const moved = retireSuperseded(retirer.id, { supersedes: [{ testRef: "test/hub/retras-vechi-bbbbbb.test.mjs", sha256: sha(Buffer.from(retiredText)), missionId: owner.id, specVersion: 1, reason: "citește telefonul din listă" }] }, { path: t.dir });
  const row = t.hub.db.prepare("SELECT id FROM factory_specs WHERE mission_id = ?").get(retirer.id);
  t.hub.db.prepare("UPDATE factory_specs SET status = 'APPROVED', protected_json = ? WHERE id = ?").run(JSON.stringify({ problems: [], files: {}, retired: moved }), row.id);
  t.hub.db.prepare("UPDATE factory_missions SET stage = 'ACCEPTED' WHERE mission_id = ?").run(retirer.id);
  return { owner, retirer, moved };
}
const withOldRetirable = (dir) => write(dir, "test/hub/retras-vechi-bbbbbb.test.mjs", `${OLD_TEXT}// vechi\n`);

test("FAC-06 R-HIST: a retired test recreated by a later writer is critical; nothing runs on that version", async () => {
  const t = await closureHub({ extra: withOldRetirable });
  try {
    const { moved } = await withRetiredByEarlier(t);
    const m = await prepare(t);
    t.queue("codex", "factory-write:hist-recreate");
    await approveAndStart(t, m.id);
    assert.deepEqual(view(t, m.id).spec.protected.historic.retired.map((r) => [r.from, r.to]), [[moved[0].from, moved[0].to]]);
    const stopped = await untilStage(t, m.id, SETTLED);
    assert.equal(stopped.factory.stage, "NEEDS_OWNER_DECISION");
    assert.match(stopped.factory.stageReason, /retired_test_recreated/);
    assert.equal(stopped.evidence.filter((e) => e.stage === "CHECKING").length, 0);
    assert.deepEqual(t.hub.factory.historicViolations(m.id), [`testul retras ${moved[0].from} a fost recreat`]);
  } finally { await t.cleanup(); }
});

test("FAC-07 R-HIST-02 at the end: after DELIVERY_READY a retired copy or an earlier Hub test changed on disk blocks the acceptance (the deterministic check names it)", async () => {
  for (const tamper of ["retired", "active", "renamed"]) {
    const t = await closureHub({ extra: withOldRetirable });
    try {
      const { moved } = await withRetiredByEarlier(t);
      const m = await prepare(t);
      t.queue("codex", "factory-write:bug-fix");
      t.queue("claude", "review:pass");
      await approveAndStart(t, m.id);
      const ready = await untilStage(t, m.id, SETTLED);
      assert.equal(ready.factory.stage, "DELIVERY_READY", ready.factory.stageReason);
      assert.deepEqual(t.hub.factory.historicViolations(m.id), []);
      if (tamper === "retired") fs.appendFileSync(path.join(t.dir, moved[0].to), "// alterat\n");
      else if (tamper === "active") fs.appendFileSync(path.join(t.dir, HIST), "// slăbit\n");
      else fs.copyFileSync(path.join(t.dir, moved[0].to), path.join(t.dir, "test/hub/alt-nume-cccccc.test.mjs"));
      await assert.rejects(t.hub.factory.accept(m.id, { actor: "test" }), /STALE|Integritatea testelor Hub anterioare/, tamper);
      assert.notEqual(view(t, m.id).factory.stage, "ACCEPTED", tamper);
      const expected = { retired: `copia retrasă ${moved[0].to} a fost modificată`, active: `testul Hub anterior ${HIST} (misiunea ${view(t, m.id).spec.protected.historic.active[0].missionId}) a fost modificat`,
        renamed: `octeții testului retras ${moved[0].from} au reapărut ca test/hub/alt-nume-cccccc.test.mjs` }[tamper];
      assert.deepEqual(t.hub.factory.historicViolations(m.id), [expected], tamper);
    } finally { await t.cleanup(); }
  }
});

// ---------------------------------------------------------------------------------------------------------------------------
// R-PACK: the reused Excel copied into the new folder (the executor, with stubbed delivery records)
// ---------------------------------------------------------------------------------------------------------------------------

function packHarness() {
  const root = tmp("pack");
  const src = path.join(root, "Livrare veche");
  const created = new Date("2026-10-09T16:24:10.125Z");
  fs.mkdirSync(src, { recursive: true });
  const wb = bookingsWorkbook();
  const buf = buildXlsx(wb.model, { created });
  const srcFile = path.join(src, "Programari demo.xlsx");
  fs.writeFileSync(srcFile, buf);
  const reused = [{ kind: "workbook", file: srcFile, sha256: sha(buf), sourceDeliveryId: "dlv_veche_0123456789", inputsSha: "f".repeat(64), reason: "aceleași date, același generator" }];
  const d = { id: "dlv_noua_0123456789", status: "ACTIVE", opsPlanId: "opp_x", title: "Livrare nouă", createdAt: new Date().toISOString(),
    template: { exports: { dir: root, folder: "Livrare noua" }, project: { name: "copie §25" }, reused } };
  fs.mkdirSync(path.join(root, "Livrare noua"), { recursive: true });
  fs.writeFileSync(path.join(root, "Livrare noua", "Prezentare demo.docx"), "docx demo");
  const deliveries = { need: () => d, get: () => d, items: () => [], startDirect: () => d };
  const opsPlans = { view: () => ({ steps: [] }) };
  const ex = createOfficeExecutors({ deliveries, factory: {}, opsPlans, config: { testMode: true, dataDir: root }, appCheck: "skip" });
  const run = () => ex["delivery.package.index"].run({ params: { deliveryId: d.id }, planId: "opp_x", authorize: () => {} });
  return { root, src, srcFile, buf, d, run, folder: path.join(root, "Livrare noua"), wb };
}

test("PACK-01 the reused workbook is copied into the new folder with the same bytes; the manifest lists it locally with its provenance; the old package is untouched", async () => {
  const h = packHarness();
  try {
    const out = await h.run();
    const local = path.join(h.folder, "Programari demo.xlsx");
    assert.equal(sha(fs.readFileSync(local)), sha(h.buf), "same bytes, not regenerated");
    assert.equal(sha(fs.readFileSync(h.srcFile)), sha(h.buf), "the source package keeps its file");
    const manifest = JSON.parse(fs.readFileSync(path.join(h.folder, "manifest.json"), "utf8"));
    assert.deepEqual(manifest.reused.map((r) => [r.file, r.sha256, r.source.deliveryId, r.source.file]), [["Programari demo.xlsx", sha(h.buf), "dlv_veche_0123456789", h.srcFile]]);
    assert.ok(manifest.files.some((f) => f.path === "Programari demo.xlsx" && f.sha256 === sha(h.buf)), "the copy is part of the folder's own file list");
    assert.equal(out.result.reused[0].file, local);
    assert.match(fs.readFileSync(path.join(h.folder, "README.md"), "utf8"), /copiate și verificate în acest dosar/);
  } finally { fs.rmSync(h.root, { recursive: true, force: true }); }
});

test("PACK-02 the package verifies on its own: the source folder gone, the new folder moved elsewhere — the manifest still checks every file and the workbook still opens with its formulas", async () => {
  const h = packHarness();
  try {
    await h.run();
    fs.rmSync(h.src, { recursive: true, force: true });
    const moved = path.join(h.root, "mutat", "Livrare noua");
    fs.mkdirSync(path.dirname(moved), { recursive: true });
    fs.renameSync(h.folder, moved);
    const v = verifyPackageFolder(moved);
    assert.equal(v.ok, true, v.problems.join("; "));
    const file = checkXlsxFile(path.join(moved, "Programari demo.xlsx"), { formulas: formulaCells(h.wb.model), sheets: h.wb.model.sheets });
    assert.equal(file.ok, true, JSON.stringify(file.problems || file));
    // A manifest that pointed outside the folder (the pre-closure shape: the source path) does not verify.
    const manifest = JSON.parse(fs.readFileSync(path.join(moved, "manifest.json"), "utf8"));
    fs.writeFileSync(path.join(moved, "manifest.json"), JSON.stringify({ ...manifest, reused: [{ ...manifest.reused[0], file: h.srcFile }] }));
    assert.match(verifyPackageFolder(moved).problems.join(" "), /nu e în dosar/);
    fs.writeFileSync(path.join(moved, "manifest.json"), JSON.stringify(manifest));
    fs.appendFileSync(path.join(moved, "Programari demo.xlsx"), "x");
    assert.match(verifyPackageFolder(moved).problems.join(" "), /octeți diferiți/);
  } finally { fs.rmSync(h.root, { recursive: true, force: true }); }
});

test("PACK-03 resume and refusal: a re-run after the source is gone keeps the verified local copy; a changed source with no local copy stops the step (never a different file)", async () => {
  const h = packHarness();
  try {
    await h.run();
    fs.rmSync(h.src, { recursive: true, force: true });
    const again = await h.run();
    assert.equal(again.result.reused[0].file, path.join(h.folder, "Programari demo.xlsx"));
    assert.deepEqual(fs.readdirSync(h.folder).filter((n) => /\.xlsx$/.test(n)), ["Programari demo.xlsx"], "no second copy");
    const h2 = packHarness();
    try {
      fs.appendFileSync(h2.srcFile, "x");
      await assert.rejects(h2.run(), (e) => e.code === "REUSED_FILE_CHANGED");
      assert.equal(fs.existsSync(path.join(h2.folder, "Programari demo.xlsx")), false);
    } finally { fs.rmSync(h2.root, { recursive: true, force: true }); }
  } finally { fs.rmSync(h.root, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------------------------------------------------------
// Fixes after the independent review (findings 1–6)
// ---------------------------------------------------------------------------------------------------------------------------

test("REV-01 (finding 1) a restore never removes a retired path that holds other bytes than the Hub's copy; the original stays", () => {
  const dir = tmp("foreign");
  try {
    const { a, spec } = twoOld(dir);
    const plan = retirementPlan("mis_new_0123456789", spec);
    write(dir, plan[0].to, "// altcineva\n");
    const r = restoreRetired(plan.slice(0, 1), { path: dir }, { missionId: "mis_new_0123456789" });
    assert.equal(r.complete, true);
    assert.equal(r.items[0].state, "untouched");
    assert.match(r.items[0].note, /lăsat neatins/);
    assert.equal(fs.readFileSync(path.join(dir, plan[0].to), "utf8"), "// altcineva\n", "the foreign file is not deleted");
    assert.equal(shaAt(dir, a.testRef), spec.supersedes[0].sha256);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("REV-02 (finding 2) a GET whose options come through a variable, or through the file's own helper that adds credentials, is not proof of an anonymous public read", () => {
  const viaVariable = "test(\"AC-2: listă\", async () => {\n  const g = await fetch(`${base}/api/bookings?date=1`, opts);\n  assert.equal(g.bookings[0].phone, \"1\");\n});\n";
  assert.equal(analyzeHubTestCases(viaVariable, "phone", ROUTES)[0].kind, "unproven_read");
  const helper = "async function httpGet(url) { return fetch(url, { headers: { authorization: \"Bearer intern\" } }); }\ntest(\"AC-2: citire internă\", async () => {\n  const g = await httpGet(`${base}/api/bookings?date=1`);\n  assert.equal(g.bookings[0].phone, \"1\");\n});\n";
  const c = analyzeHubTestCases(helper, "phone", ROUTES)[0];
  assert.notEqual(c.kind, "public_read");
  assert.deepEqual(c.internalReads, ["/api/bookings"]);
  // The real §25 test's helper adds no credentials: its read stays a public one.
  assert.equal(analyzeHubTestCases(OLD_TEXT, "phone", ROUTES).find((x) => x.id === "AC-2").kind, "public_read");
});

test("REV-03 (finding 3) the spec refuses a contract whose replacements are not the right kinds of checks", () => {
  const candidate = { testRef: OLD_REF, sha256: sha(Buffer.from(OLD_TEXT)), missionId: "mis_mv1eo6il_104584123d", specVersion: 1 };
  const { contract } = retirementContract({ candidate, text: OLD_TEXT, key: "phone", publicRoutes: ROUTES, previous: PREVIOUS, next: NEXT });
  const acceptance = NEXT.map((n) => ({ id: n.id, text: `criteriul ${n.kind}`, verify: "test", testRef: "test/hub/telefonul-ramane-abcdef.test.mjs", kind: n.kind, ...(["public_omits", "anon_params"].includes(n.kind) ? {} : { guard: true }) }));
  const base = { workType: "FEATURE", title: "Lista publică fără telefon", objective: AUTHORIZED, verification: { checks: ["node --test"], acceptance: ["node --test test/hub/telefonul-ramane-abcdef.test.mjs"] } };
  const entry = (c) => [{ ...candidate, reason: "citește telefonul din lista publică", contract: c }];
  assert.deepEqual(checkSpec({ ...base, acceptance, supersedes: entry(contract) }).problems, []);
  const wrongReplace = { ...contract, conflicts: [{ ...contract.conflicts[0], replacedBy: ["AC-5"] }] };
  assert.match(checkSpec({ ...base, acceptance, supersedes: entry(wrongReplace) }).problems.join(" | "), /nu e înlocuit exact.*lipsesc: public_omits, anon_params, internal_persistence/);
  const wrongKept = { ...contract, kept: [{ ...contract.kept[0], coveredBy: ["AC-1"] }, contract.kept[1]] };
  assert.match(checkSpec({ ...base, acceptance, supersedes: entry(wrongKept) }).problems.join(" | "), /kept\[0\] \(required_refusal\) e acoperit de un criteriu de alt tip/);
  const unkinded = acceptance.map(({ kind: _kind, ...a }) => a);
  assert.match(checkSpec({ ...base, acceptance: unkinded, supersedes: entry(contract) }).problems.join(" | "), /nu e înlocuit exact/);
  // The two lists of replacing kinds (planner side and spec side) are the same.
  assert.deepEqual([...SUPERSEDE_REPLACES], ["public_omits", "anon_params", "internal_persistence"]);
});

test("REV-05 (finding 5) an earlier Hub test whose bytes are no longer the protected ones stops the start (never silently re-baselined)", async () => {
  const t = await closureHub();
  try {
    const earlier = await prepare(t);
    makeEarlierOwner(t, earlier.id, HIST, "d".repeat(64));
    const m = await prepare(t);
    await assert.rejects(approveAndStart(t, m.id), (e) => /nu mai are octeții protejați/.test(e.message));
    assert.equal(view(t, m.id).factory.stage, "SPEC_DRAFT");
  } finally { await t.cleanup(); }
});
