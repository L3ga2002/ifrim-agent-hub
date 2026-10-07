// Milestone 10.2.1 — G3 probe-blocking fixes (D20 question guard, D21), PASS_SIMULATED: pure resolver and planner checks, fixture
// projects in temp folders, the simulated ifrim-runner distro (tests/fixtures/fake-wsl.mjs); no model, no live Hub, no network.
//  - a project name with a dot („Factory Demo M10.2”) resolves; a sentence-final period never joins the name; the exact dotted name wins
//    over a shorter one („Factory Demo M10”);
//  - „Continuă?” / „Continui?” / „Pot să continui?” is ONE clarification, never ops_continue; „Continuă” / „Lega, continuă” unchanged;
//  - gate_rearm („Redeschide poarta”, „Rearmează Hub-ul”, „Pornește din nou după Stop All”) only shows the card (READ_NAVIGATE), and is
//    never read as a Stop All or a held condition;
//  - the engineering planner binds the project's ONLY acceptance-named test when the words name it or describe a bug (no question);
//    none / several / a named missing file bind nothing (M11 L5: the Hub writes the test, or a plain answer — never the old question);
//    the card and the spec say the test is protected;
//  - the plan card mentions a local preview / E2E only when the spec has them (a spec with both keeps the earlier wording);
//  - the setup's automatic attestation re-attests only the latest PASS fingerprint, decided on a fresh inspection; a new one is the
//    owner's decision (System → Medii); the account step refreshes a stale reviewer account check too.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeTestHub, enrolOwner, waitFor, prepareLiveWithoutGrants } from "./helpers.mjs";
import { resolveIntent, INTENT_EFFECTS, CONTINUE_QUESTION } from "../server/owner/intents.mjs";
import { classOfIntent, allowedFrom } from "../server/policy/effect-class.mjs";
import { buildEngineeringSpec, acceptanceCandidates } from "../server/owner/planners/engineering.mjs";
import { materializeFixture, demoSpec, FIXTURE_ROOT } from "../server/factory/fixtures.mjs";

const projects = [
  { id: "hub", name: "Ifrim Agent Hub", slug: "ifrim-agent-hub", source: "registry" },
  { id: "a2", name: "Factory Demo A2", slug: "factory-demo-a2", source: "hub-test" },
  { id: "m102", name: "Factory Demo M10.2", slug: "factory-demo-m10-2", source: "hub-test" },
  { id: "m07", name: "Factory Demo M07", slug: "factory-demo-m07", source: "hub-test" },
];
const run = (text, extra = {}) => resolveIntent(text, { projects, missions: [], currentProjectId: null, ...extra });
const one = (text, extra) => run(text, extra).steps[0];
const dispatch = (hub, type, payload, extra = {}) => hub.commands.dispatch({ type, payload, channel: "test", actor: "test", ...extra });
const M09_MODELS = { writerModel: "gpt-fake-sol", reviewerModel: "sonnet" };
const OLD_EFFECTS = ["workspace.write (proiectul de mai sus)", "teste locale", "review doar-citire", "remedieri în limită", "QA", "preview local", "E2E local"];

/** A fresh copy of a fixture project in a temp folder (removed by the caller). */
function fixtureCopy(name = "bug-demo") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ifrim-p0-"));
  const dir = path.join(root, name);
  fs.cpSync(path.join(FIXTURE_ROOT, name), dir, { recursive: true });
  return { dir, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

// ---------------------------------------------------------------- the resolver (pure)

test("P0-01 a dotted project name resolves for every project reference; a final period or an ellipsis never joins the name", () => {
  for (const text of ["Hai să lucrăm la Factory Demo M10.2", "Deschide Factory Demo M10.2.", "Deschide Factory Demo M10.2...", "Arată-mi proiectul Factory Demo M10.2", "Lega, hai la Factory Demo M10.2!"]) {
    const s = one(text);
    assert.deepEqual([s.intent, s.args.projectId, s.effectClass], ["open_project", "m102", "READ_NAVIGATE"], text);
    assert.equal(s.args.projectRef, "factory demo m10.2", `${text}: no trailing period in the reference`);
  }
  const eng = one("Repară testul de acceptanță din Factory Demo M10.2");
  assert.deepEqual([eng.intent, eng.args.projectId], ["engineering_request", "m102"]);
  // A clip name may hold a dot inside a word too; a leading dot is never a name.
  assert.equal(one("Arată-mi clipul promo v2.1").args.clipRef, "promo v2.1");
  assert.equal(one("Fă un clip din Promo v2.1").args.clipRef, "promo v2.1");
  assert.notEqual(one("Deschide .env").intent, "open_project");
  // Two steps around a sentence break still split at „. ” (the dot inside the name does not).
  assert.deepEqual(run("Deschide Factory Demo M10.2. Arată-mi ce urmează.").steps.map((s) => s.intent), ["open_project", "next_step"]);
});

test("P0-02 the exact dotted name wins over a shorter project name; the shorter name still opens its own project", () => {
  const withM10 = [...projects, { id: "m10", name: "Factory Demo M10", slug: "factory-demo-m10", source: "hub-test" }];
  const r = run("Deschide Factory Demo M10.2", { projects: withM10 });
  assert.equal(r.clarification, null, JSON.stringify(r.clarification));
  assert.equal(r.steps[0].args.projectId, "m102", "never the shorter „Factory Demo M10” by a covered-words match");
  assert.equal(run("Hai la Factory Demo M10", { projects: withM10 }).steps[0].args.projectId, "m10");
  assert.equal(run("Repară testul de acceptanță din Factory Demo M10.2", { projects: withM10 }).steps[0].args.projectId, "m102");
});

test("P0-03 „Continuă?” is ONE clarification and never the resume (typed or locally verified voice); the plain forms are unchanged", () => {
  for (const source of ["typed", "voice-local", "voice-provider"]) {
    for (const text of ["Continuă?", "Continui?", "Pot să continui?", "Poți continua?", "Lega, continuă?", "Continuă? Te rog.", "Reia?", "Mergi mai departe?"]) {
      const r = run(text, { source });
      assert.ok(r.steps.every((s) => s.intent !== "ops_continue"), `${source} ${text}: ${r.steps.map((s) => s.intent)}`);
      assert.equal(r.clarification?.question, CONTINUE_QUESTION, `${source} ${text}`);
      assert.equal(r.clarification.forIntent, "ops_continue");
      assert.deepEqual(r.clarification.options, []);
      assert.ok(r.steps.every((s) => s.effect === "none" && s.effectClass === "READ_NAVIGATE"), `${text}: no effect`);
      assert.equal(r.refused.length, 0, "a question is answered, not refused");
    }
  }
  for (const text of ["Continuă", "Lega, continuă", "Continui", "Continuă planul", "Poți continua"]) {
    const s = one(text);
    assert.equal(s.intent, "ops_continue", text);
    assert.equal(run(text).clarification, null, text);
  }
  // The confirmation's own question rule is unchanged.
  assert.notEqual(one("Da?", { awaiting: "envelope_confirmation", pendingEnvelopes: [{ id: "e1", title: "x" }] }).intent, "confirm");
});

test("P0-04 gate_rearm only shows the rearm card (a read, allowed from every live source); never a Stop All, never a held condition", () => {
  assert.equal(INTENT_EFFECTS.gate_rearm, "navigate");
  assert.equal(classOfIntent("gate_rearm", INTENT_EFFECTS.gate_rearm), "READ_NAVIGATE");
  assert.equal(allowedFrom("READ_NAVIGATE", "voice-provider"), true);
  for (const text of ["Redeschide poarta", "Rearmează Hub-ul", "Pornește din nou după Stop All", "Lega, redeschide poarta.", "Poți să redeschizi poarta?", "Deschide poarta de execuție", "Reia lucrul după oprirea totală"]) {
    for (const source of ["typed", "voice-provider"]) {
      const r = run(text, { source });
      assert.deepEqual(r.steps.map((s) => s.intent), ["gate_rearm"], `${source} ${text}`);
      assert.equal(r.steps[0].effectClass, "READ_NAVIGATE", text);
      assert.equal(r.steps[0].effect, "navigate", text);
      assert.equal(r.clarification, null, `${text}: „după Stop All” is not a condition`);
      assert.equal(r.refused.length, 0, text);
    }
  }
  // The neighbours keep their meaning.
  assert.equal(one("Oprește tot").intent, "stop_all");
  assert.equal(one("Stop all").intent, "stop_all");
  assert.notEqual(one("Deschide Hub-ul").intent, "gate_rearm", "the Hub's project, not the gate");
  assert.notEqual(one("Repornește Hub-ul").intent, "gate_rearm", "a restart is not a rearm");
  assert.notEqual(one("Nu redeschide poarta").intent, "gate_rearm");
});

// ---------------------------------------------------------------- the engineering planner (pure, fixture copies)

test("P0-05 the project's ONLY acceptance-named test is bound when the words name it or describe a bug; none, several or a missing named file keep the question", () => {
  const a = fixtureCopy();
  try {
    const project = { path: a.dir };
    assert.deepEqual(acceptanceCandidates(a.dir), ["test/acceptance.test.mjs"]);
    const named = buildEngineeringSpec({ text: "Repară testul de acceptanță din Factory Demo M10.2", project });
    assert.deepEqual([named.testRef, named.autoBound, named.workType, named.problems], ["test/acceptance.test.mjs", "named", "BUGFIX", []]);
    assert.deepEqual(named.input.spec.verification.acceptance, ["node --test test/acceptance.test.mjs"]);
    assert.ok(named.input.spec.constraints.some((c) => /test\/acceptance\.test\.mjs e protejat: repari implementarea, nu testul/.test(c)), JSON.stringify(named.input.spec.constraints));
    assert.match(named.input.spec.sources.assumptions[0], /singurul test de acceptanță al proiectului/);
    const bug = buildEngineeringSpec({ text: "Repară bugul din Factory Demo M10.2: un nume format doar din spații trece de validare", project });
    assert.deepEqual([bug.testRef, bug.autoBound], ["test/acceptance.test.mjs", "described"]);
    const english = buildEngineeringSpec({ text: "Implementează ce cere acceptance test-ul pentru nume", project });
    assert.deepEqual([english.testRef, english.autoBound, english.workType], ["test/acceptance.test.mjs", "named", "FEATURE"]);
    // A feature that names no acceptance test: no binding (the planner asks its one question).
    assert.equal(buildEngineeringSpec({ text: "Adaugă validarea emailului în solicitări", project }).testRef, null);
    // A test file the owner named that does not exist is never replaced by another one.
    assert.equal(buildEngineeringSpec({ text: "Repară bugul; testul e test/nu-exista.test.mjs", project }).testRef, null);
    assert.equal(buildEngineeringSpec({ text: "Repară bugul de validare", args: { testRef: "test/missing.test.mjs" }, project }).testRef, null);
    // An explicitly named existing test is bound as before (not marked automatic) and is protected too.
    const explicit = buildEngineeringSpec({ text: "Repară bugul; testul e test/unit.test.mjs", project });
    assert.deepEqual([explicit.testRef, explicit.autoBound], ["test/unit.test.mjs", null]);
    assert.ok(explicit.input.spec.constraints.some((c) => /test\/unit\.test\.mjs e protejat/.test(c)));

    // Several acceptance-named files → no binding.
    fs.writeFileSync(path.join(a.dir, "test", "acceptanta-login.test.mjs"), "// fictiv\n");
    assert.deepEqual(acceptanceCandidates(a.dir), ["test/acceptance.test.mjs", "test/acceptanta-login.test.mjs"], "„acceptanță” without diacritics counts too");
    assert.equal(buildEngineeringSpec({ text: "Repară testul de acceptanță", project }).testRef, null);
    // None → no binding.
    fs.rmSync(path.join(a.dir, "test", "acceptanta-login.test.mjs"));
    fs.renameSync(path.join(a.dir, "test", "acceptance.test.mjs"), path.join(a.dir, "test", "regression.test.mjs"));
    assert.deepEqual(acceptanceCandidates(a.dir), []);
    assert.equal(buildEngineeringSpec({ text: "Repară bugul de validare a numelui", project }).testRef, null);
    // The name check ignores case.
    fs.renameSync(path.join(a.dir, "test", "regression.test.mjs"), path.join(a.dir, "test", "Acceptance-Nume.test.mjs"));
    assert.equal(buildEngineeringSpec({ text: "Repară bugul de validare a numelui", project }).testRef, "test/Acceptance-Nume.test.mjs");
  } finally { a.cleanup(); }
});

// 2.12.1 round 2 (review PF-01 / PF-05): the rearm phrases with „după Stop All” the Hub's own texts use, typed, from the provider and with „?”.
test("P0-04b „Redeschide poarta / Rearmează Hub-ul / Continuă … după Stop All” only show the rearm card — never a second Stop All", () => {
  for (const text of ["Redeschide poarta după Stop All", "Rearmează Hub-ul după Stop All", "Deschide poarta după Stop All", "Lega, redeschide poarta după Stop All",
    "Poți să redeschizi poarta după Stop All?", "Redeschide poarta de execuție după Stop All", "Continuă după Stop All", "Reia după Stop All"]) {
    for (const source of ["typed", "voice-provider"]) {
      const r = run(text, { source });
      assert.deepEqual(r.steps.map((s) => s.intent), ["gate_rearm"], `${source} ${text}`);
      assert.equal(r.steps[0].effectClass, "READ_NAVIGATE", text);
      assert.equal(r.clarification, null, `${source} ${text}`);
    }
  }
  assert.equal(one("Stop all").intent, "stop_all");
  assert.equal(one("Oprește tot").intent, "stop_all");
});

// 2.12.1 round 2 (review PF-03 / PF-04): another test named, or a NEW acceptance test asked for → the acceptance test is not bound.
// M11 L5 (wave B, design §2 routes F/G, §8 „Teste existente actualizate deliberat”): the one question is gone. „Repară testul de login…”
// now binds the ONE test whose name holds the topic (test/login.test.mjs, autoBound "topic"), never the acceptance test; a request to write
// an acceptance test is test-first (the Hub writes the new test; testRef stays null: no existing test bound).
test("P0-05b no acceptance-test binding when the words name another test or ask to write an acceptance test (M11 L5: the named topic's test, or test-first)", () => {
  const a = fixtureCopy();
  try {
    fs.writeFileSync(path.join(a.dir, "test", "login.test.mjs"), "// fictiv\n");
    const project = { path: a.dir };
    for (const text of ["Repară testul de login care pică", "Repară testul login"]) {
      const b = buildEngineeringSpec({ text, project });
      assert.deepEqual([b.testRef, b.autoBound], ["test/login.test.mjs", "topic"], text);
    }
    for (const text of ["Adaugă un test de acceptanță pentru validarea numelui din Factory Demo M10.2", "Scrie testul de acceptanță pentru export"]) {
      const b = buildEngineeringSpec({ text, project });
      assert.equal(b.testRef, null, text);
      assert.ok(b.testFirst?.ok && b.input.spec.authoring, `${text}: test-first`);
    }
    assert.equal(buildEngineeringSpec({ text: "Repară butonul de export care nu merge", project }).autoBound, "described");
    assert.equal(buildEngineeringSpec({ text: "Repară testul de acceptanță din Factory Demo M10.2", project }).autoBound, "named");
  } finally { a.cleanup(); }
});

// ---------------------------------------------------------------- the planner and the plan card through the Hub

async function plannerHub({ name = "Factory Demo M10.2", fixture = "bug-demo" } = {}) {
  const t = await makeTestHub({ queues: true });
  fs.writeFileSync(`${t.logs.codex}.models.json`, JSON.stringify([{ id: "gpt-6.1-sol", isDefault: true, efforts: ["medium", "high"] }, { id: "gpt-fake-sol", efforts: ["medium", "high"] }]));
  await prepareLiveWithoutGrants(t.hub);
  const dir = path.join(t.dataDir, `factory-${fixture}`);
  materializeFixture(fixture, dir);
  const project = (await dispatch(t.hub, "project.register_test", { path: dir, name })).result;
  const owner = await enrolOwner(t);
  return { ...t, project, owner };
}
const asOwner = (t, payload) => t.hub.commands.dispatch({ type: "owner.intent", payload, channel: "owner", actor: `owner:${t.owner.session.id}`, ownerSession: t.owner.session }).then((r) => r.result);

test("P0-06 „Repară testul de acceptanță din Factory Demo M10.2” → ONE plan with no question; the card says the test is protected and ends at QA (no preview, no E2E)", async () => {
  const t = await plannerHub();
  try {
    assert.equal(t.project.name, "Factory Demo M10.2");
    const nav = await asOwner(t, { text: "Hai să lucrăm la Factory Demo M10.2" });
    assert.equal(nav.results[0].navigate, `/cockpit/${t.project.id}`, JSON.stringify(nav.results[0]).slice(0, 300));
    const before = t.hub.db.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'intake.question'").get().n;
    const out = await asOwner(t, { text: "Repară testul de acceptanță din Factory Demo M10.2" });
    assert.equal(out.resolved.steps[0].intent, "engineering_request");
    assert.equal(out.resolved.clarification, null);
    const r = out.results[0];
    assert.ok(r.plan?.envelope?.id, JSON.stringify(r).slice(0, 600));
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'intake.question'").get().n, before, "no test question");
    const env = r.plan.envelope;
    const mission = t.hub.factory.view(env.missionIds[0]);
    assert.equal(mission.project.id, t.project.id);
    assert.equal(mission.spec.spec.acceptance[0].testRef, "test/acceptance.test.mjs");
    assert.match(r.note, /Testul de acceptanță „test\/acceptance\.test\.mjs” \(singurul test de acceptanță al proiectului, ales fără întrebare\) e protejat: writer-ul repară implementarea, nu testul/);
    // The card ends where the plan ends: the bug demo has no preview and no E2E criteria.
    assert.ok(!env.body.allowedEffects.includes("preview local") && !env.body.allowedEffects.includes("E2E local"), JSON.stringify(env.body.allowedEffects));
    assert.match(r.plan.summary.steps, /QA și pachetul de livrare \(fără preview sau E2E: specificația nu le cere\)\.$/);
    assert.doesNotMatch(r.plan.summary.steps, /preview și E2E local/);
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM agent_runs").get().n, 0, "nothing ran");
  } finally { await t.cleanup(); }
});

test("P0-07 the card promises a preview / E2E only when the spec has them; a spec with both keeps the earlier allowedEffects (hash unchanged)", async () => {
  const t = await plannerHub({ name: "Factory Demo Service", fixture: "service-request" });
  try {
    const both = (await dispatch(t.hub, "factory.prepare", { projectId: t.project.id, ...demoSpec("service-request"), limits: M09_MODELS })).result;
    const a = (await dispatch(t.hub, "envelope.propose", { projectId: t.project.id, missionIds: [both.mission.id] })).result;
    assert.deepEqual(a.envelope.body.allowedEffects, OLD_EFFECTS, "preview + E2E: the exact earlier list (so the same hash as before)");
    assert.match(a.summary.steps, /, QA, preview și E2E local\.$/);
    // Preview without E2E criteria: the preview is promised, the E2E is not.
    const noE2E = demoSpec("service-request");
    noE2E.spec.acceptance = noE2E.spec.acceptance.filter((x) => x.verify !== "e2e");
    const previewOnly = (await dispatch(t.hub, "factory.prepare", { projectId: t.project.id, ...noE2E, limits: M09_MODELS })).result;
    const b = (await dispatch(t.hub, "envelope.propose", { projectId: t.project.id, missionIds: [previewOnly.mission.id] })).result;
    assert.ok(b.envelope.body.allowedEffects.includes("preview local") && !b.envelope.body.allowedEffects.includes("E2E local"), JSON.stringify(b.envelope.body.allowedEffects));
    assert.match(b.summary.steps, /QA și preview local \(fără E2E: specificația nu are criterii E2E\)\.$/);
    // Neither: QA and the bundle.
    const plain = demoSpec("service-request");
    plain.spec.acceptance = plain.spec.acceptance.filter((x) => !["e2e", "preview"].includes(x.verify));
    plain.spec.verification = { ...plain.spec.verification, preview: null };
    const none = (await dispatch(t.hub, "factory.prepare", { projectId: t.project.id, ...plain, limits: M09_MODELS })).result;
    const c = (await dispatch(t.hub, "envelope.propose", { projectId: t.project.id, missionIds: [none.mission.id] })).result;
    assert.deepEqual(c.envelope.body.allowedEffects, OLD_EFFECTS.slice(0, 5));
    assert.match(c.summary.steps, /QA și pachetul de livrare/);
  } finally { await t.cleanup(); }
});

// ---------------------------------------------------------------- setup: the automatic attestation and the account step

/** A simulated environment with a verified backup stub and the dispatches recorded (the real commands still run). */
async function setupHub() {
  const t = await makeTestHub({ wsl: true });
  t.hub.backups.run = async () => ({ id: "bkp_stub", status: "verified" });
  const calls = [];
  const original = t.hub.commands.dispatch;
  t.hub.commands.dispatch = (command) => { calls.push(command); return original.call(t.hub.commands, command); };
  const svc = t.hub.environments.get("wsl-runner");
  const attestations = () => t.hub.db.prepare("SELECT id, status, fingerprint_hash AS fp FROM environment_attestations ORDER BY started_at").all();
  const step = (id) => t.hub.setup.steps({ origin: `http://localhost:${t.config.port}` }).steps.find((s) => s.id === id);
  const runSetup = async () => {
    t.hub.setup.runAutomatic({ channel: "ui", actor: "user" });
    await waitFor(() => t.hub.setup.steps({}).automatic?.finishedAt, 120000, 100);
  };
  const attestCalls = () => calls.filter((c) => c.type === "environment.attest" && c.actor === "user");
  const age = (days) => t.hub.db.prepare("UPDATE environment_attestations SET started_at = ?, finished_at = ?").run(new Date(Date.now() - days * 86400000).toISOString(), new Date(Date.now() - days * 86400000 + 1000).toISOString());
  return { ...t, calls, svc, attestations, step, runSetup, attestCalls, age };
}
/** A PASS attestation on the current (simulated) fingerprint, made outside the setup, plus a fresh account check. */
async function attestedOnce(t) {
  await dispatch(t.hub, "environment.inspect", {});
  await dispatch(t.hub, "environment.attest", { allowRestart: true });
  const fp = t.svc.state().fingerprint.hash;
  assert.ok(/^PASS/.test(t.attestations().at(-1).status), JSON.stringify(t.attestations()));
  return fp;
}

test("P0-08 setup: an attestation gone stale on the SAME fingerprint is re-attested automatically, told which fingerprint (expectFingerprint)", async () => {
  const t = await setupHub();
  try {
    const fp = await attestedOnce(t);
    t.age(20);
    assert.equal(t.step("env_attested").status, "AUTO_PENDING", t.step("env_attested").detail);
    const rows = t.attestations().length;
    await t.runSetup();
    const att = t.step("env_attested");
    assert.equal(att.status, "DONE_AUTO", att.detail);
    assert.equal(t.attestCalls().length, 1);
    assert.equal(t.attestCalls()[0].payload.expectFingerprint, fp, "the command is told the fingerprint the decision was made on");
    assert.equal(t.attestations().length, rows + 1);
    assert.equal(t.attestations().at(-1).fp, fp);
  } finally { await t.cleanup(); }
});

test("P0-09 setup: a CHANGED fingerprint is never attested by the button — NEEDS_OWNER with both fingerprints, before the click and after a run", async () => {
  const t = await setupHub();
  try {
    const fpA = await attestedOnce(t);
    t.wslState({ facts: { codex_version: "0.160.0", codex_sha: "ffffffffffffffff" } });
    await dispatch(t.hub, "environment.inspect", {});
    const fpB = t.svc.state().fingerprint.hash;
    assert.notEqual(fpA, fpB);
    const text = `Amprenta mediului s-a schimbat (${fpA.slice(0, 16)} → ${fpB.slice(0, 16)}): atestarea unei configurații noi e o decizie separată (Sistem → Medii).`;
    const before = t.step("env_attested");
    assert.deepEqual([before.status, before.detail], ["NEEDS_OWNER", text]);
    assert.deepEqual(before.action, { kind: "ui_link", href: "#/system?tab=environments" });
    assert.ok(!t.hub.setup.steps({}).pendingAutomatic.includes("env_attested"), "the button does not offer it");
    const rows = t.attestations().length;
    await t.runSetup();
    assert.equal(t.attestCalls().length, 0, "no attestation command");
    assert.equal(t.attestations().length, rows, "no attestation row");
    const after = t.step("env_attested");
    assert.deepEqual([after.status, after.detail], ["NEEDS_OWNER", text]);
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'setup.attestation_needs_owner'").get().n, 1);
  } finally { await t.cleanup(); }
});

test("P0-10 setup: the run decides on a FRESH inspection — a distro changed after the last inspection is not attested (the page still showed the old one)", async () => {
  const t = await setupHub();
  try {
    const fpA = await attestedOnce(t);
    t.age(20);
    t.wslState({ facts: { codex_version: "0.161.0", codex_sha: "eeeeeeeeeeeeeeee" } });
    assert.equal(t.step("env_attested").status, "AUTO_PENDING", "the stored inspection still shows the attested fingerprint");
    const rows = t.attestations().length;
    await t.runSetup();
    assert.ok(t.calls.some((c) => c.type === "environment.inspect" && c.actor === "user"), "one more inspection before deciding");
    assert.equal(t.attestCalls().length, 0);
    assert.equal(t.attestations().length, rows);
    const s = t.step("env_attested");
    assert.equal(s.status, "NEEDS_OWNER", s.detail);
    assert.match(s.detail, new RegExp(`^Amprenta mediului s-a schimbat \\(${fpA.slice(0, 16)} → `));
  } finally { await t.cleanup(); }
});

test("P0-11 setup: with no PASS attestation at all, the first attestation is the owner's decision; nothing is attested by the button", async () => {
  const t = await setupHub();
  try {
    await dispatch(t.hub, "environment.inspect", {});
    const s = t.step("env_attested");
    assert.equal(s.status, "NEEDS_OWNER");
    assert.match(s.detail, /^Mediul nu are încă o atestare trecută \(amprenta [0-9a-f]{16}\): prima atestare e o decizie separată \(Sistem → Medii\)\.$/);
    await t.runSetup();
    assert.equal(t.attestCalls().length, 0);
    assert.equal(t.attestations().length, 0);
  } finally { await t.cleanup(); }
});

test("P0-12 setup: the account step is pending when only the reviewer's account check is stale (the same environment.probe refreshes it); a fresh failed one is shown, not looped", async () => {
  const t = await setupHub();
  try {
    t.wslState({ facts: { claude_cli: "2.1.285", claude_sha: "abababababababab" } });
    await dispatch(t.hub, "environment.inspect", {});
    const fp = t.svc.state().fingerprint.hash;
    const iso = (h) => new Date(Date.now() - h * 3600000).toISOString();
    t.hub.providerState.set(t.svc.probeKey, { ok: true, probedAt: iso(1), auth: { accountType: "chatgpt", planType: "pro" }, fingerprintHash: fp });
    t.hub.providerState.set(t.svc.reviewerKey, { ok: true, probedAt: iso(30), auth: { subscriptionType: "max" }, fingerprintHash: fp });
    let s = t.step("env_account");
    assert.equal(s.status, "AUTO_PENDING", s.detail);
    assert.match(s.detail, /reviewer Claude: verificarea contului e mai veche de 24 h/);
    assert.ok(t.hub.setup.steps({}).pendingAutomatic.includes("env_account"));
    // The plan of the button includes the account step (environment.probe); stub the dispatch so nothing runs in the distro.
    const original = t.hub.commands.dispatch;
    const seen = [];
    t.hub.commands.dispatch = async (c) => { seen.push(c.type); return { result: c.type === "backup.run" ? { status: "verified" } : { ok: false, error: "oprit în test" } }; };
    try {
      const started = t.hub.setup.runAutomatic({ channel: "ui", actor: "user" });
      assert.ok(started.steps.includes("env_account"), JSON.stringify(started.steps));
      await waitFor(() => t.hub.setup.steps({}).automatic?.finishedAt, 30000, 50);
      assert.ok(seen.includes("environment.probe"), JSON.stringify(seen));
    } finally { t.hub.commands.dispatch = original; }
    // Fresh → done; fresh but failed → done, with the failure named; another fingerprint → stale again.
    t.hub.providerState.set(t.svc.reviewerKey, { ok: true, probedAt: iso(1), auth: { subscriptionType: "max" }, fingerprintHash: fp });
    s = t.step("env_account");
    assert.equal(s.status, "DONE_AUTO", s.detail);
    assert.match(s.detail, /reviewer Claude: max/);
    t.hub.providerState.set(t.svc.reviewerKey, { ok: false, probedAt: iso(1), error: "NEEDS_AUTH", fingerprintHash: fp });
    s = t.step("env_account");
    assert.equal(s.status, "DONE_AUTO", s.detail);
    assert.match(s.detail, /reviewer Claude: verificarea a eșuat \(NEEDS_AUTH\)/);
    t.hub.providerState.set(t.svc.reviewerKey, { ok: true, probedAt: iso(1), auth: { subscriptionType: "max" }, fingerprintHash: "0000000000000000" });
    // (the stubbed run above recorded an error for the step, so it shows as retryable rather than merely pending)
    assert.notEqual(t.step("env_account").status, "DONE_AUTO");
    assert.ok(t.hub.setup.steps({}).pendingAutomatic.includes("env_account"));
    // Without Claude Code in the environment the reviewer is not part of the step.
    t.wslState({});
    await dispatch(t.hub, "environment.inspect", {});
    t.hub.providerState.set(t.svc.probeKey, { ok: true, probedAt: iso(1), auth: { accountType: "chatgpt", planType: "pro" }, fingerprintHash: t.svc.state().fingerprint.hash });
    s = t.step("env_account");
    assert.equal(s.status, "DONE_AUTO", s.detail);
    assert.doesNotMatch(s.detail, /reviewer/);
  } finally { await t.cleanup(); }
});
