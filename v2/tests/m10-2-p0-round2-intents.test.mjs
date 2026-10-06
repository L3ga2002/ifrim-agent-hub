// Milestone 10.2.1 — P0 round 2, unit R2b „intents / planner / setup refinements”, PASS_SIMULATED: the pure resolver and planner, a test
// Hub (owner.intent, the setup) and the simulated ifrim-runner distro (tests/fixtures/fake-wsl.mjs); no model, no live Hub, no network.
//  - PF-01: „Redeschide poarta / Rearmează Hub-ul / Deschide poarta … după Stop All” (typed, provider and local voice, with „?”) only show
//    the rearm card — never a second Stop All; a „Stop All” right after „după” next to a reopen verb is never read as the command;
//  - PF-05: „Continuă / Reia lucrul după Stop All” shows the card too (nothing resumes; D22: Stop All work resumes only after the rearm);
//  - PF-02: a name part with a digit or a dot („Factory Demo M10.3”) is never dropped to reach a shorter project („Factory Demo A”); a
//    partial match lacking that part is ONE question, and a pending „Pe ce proiect lucrez?” is not answered by it;
//  - PF-03 / PF-04: the planner does not bind the acceptance test when the words name another test or ask to WRITE an acceptance test;
//  - PF-06: a reviewer account check that throws is stored fresh with its cause; the setup step shows that cause and is not re-probed;
//  - PF-08: a „?” about something else still holds „Continuă”, with a neutral sentence.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeTestHub, enrolOwner, waitFor, prepareLiveWithoutGrants } from "./helpers.mjs";
import { resolveIntent, CONTINUE_QUESTION, CONTINUE_MIXED_QUESTION } from "../server/owner/intents.mjs";
import { buildEngineeringSpec } from "../server/owner/planners/engineering.mjs";
import { materializeFixture, FIXTURE_ROOT } from "../server/factory/fixtures.mjs";

const projects = [
  { id: "hub", name: "Ifrim Agent Hub", slug: "ifrim-agent-hub", source: "registry" },
  { id: "pd", name: "ProDelivery", slug: "prodelivery", source: "registry" },
  { id: "a", name: "Factory Demo A", slug: "factory-demo-a", source: "hub-test" },
  { id: "a2", name: "Factory Demo A2", slug: "factory-demo-a2", source: "hub-test" },
  { id: "m102", name: "Factory Demo M10.2", slug: "factory-demo-m10-2", source: "hub-test" },
];
const run = (text, extra = {}) => resolveIntent(text, { projects, missions: [], currentProjectId: null, ...extra });
const intents = (text, extra) => run(text, extra).steps.map((s) => s.intent);
const dispatch = (hub, type, payload, extra = {}) => hub.commands.dispatch({ type, payload, channel: "test", actor: "test", ...extra });
const SOURCES = ["typed", "voice-local", "voice-provider"];

// ---------------------------------------------------------------- PF-01 / PF-05: the rearm phrases (pure)

test("R2B-01 every natural rearm phrase with „după Stop All” shows the card (a read) from every source — never a Stop All, never a held condition", () => {
  const phrases = ["Redeschide poarta după Stop All", "Rearmează Hub-ul după Stop All", "Deschide poarta după Stop All", "Lega, redeschide poarta după Stop All",
    "Poți să redeschizi poarta după Stop All?", "Redeschide poarta de execuție după Stop All", "Reactivează poarta după oprirea totală", "Rearmează după Stop-All",
    "Redeschide poarta după Stop All-ul", "După Stop All, redeschide poarta", "Lega, după Stop All, deschide poarta", "Vreau să redeschid poarta"];
  for (const source of SOURCES) {
    for (const text of phrases) {
      const r = run(text, { source });
      assert.deepEqual(r.steps.map((s) => s.intent), ["gate_rearm"], `${source} ${text}`);
      assert.equal(r.steps[0].effect, "navigate", text);
      assert.equal(r.steps[0].effectClass, "READ_NAVIGATE", text);
      assert.equal(r.clarification, null, `${source} ${text}: „după Stop All” is not a condition`);
      assert.equal(r.refused.length, 0, text);
    }
  }
  // A following request keeps its own step; the rearm part is still only the card.
  assert.deepEqual(intents("Redeschide poarta după Stop All și arată-mi ce urmează"), ["gate_rearm", "next_step"]);
  // The neighbours keep their meaning: the stop words alone stop, „Deschide Hub-ul” is the Hub's project, a refusal is not a request.
  for (const text of ["Oprește tot", "Stop all", "Lega, stop all", "Te rog, oprește tot", "Opriți tot"]) assert.deepEqual(intents(text), ["stop_all"], text);
  // 2.12.2 (P0-R2): a deferred stop is a condition — never run now (the Hub answers that it does not schedule stops).
  assert.deepEqual(intents("Oprește tot după ce termini testul"), ["explain_stop"]);
  assert.notEqual(intents("Deschide Hub-ul")[0], "gate_rearm");
  assert.notEqual(intents("Repornește Hub-ul")[0], "gate_rearm");
  assert.ok(!intents("Nu redeschide poarta după Stop All").includes("gate_rearm"));
});

test("R2B-02 defence in depth: „Stop All” right after „după” in a clause with a reopen verb is never a Stop All, even when the rearm grammar does not read it", () => {
  for (const source of SOURCES) {
    for (const text of ["Redeschide, te rog, poarta după Stop All", "Redeschide acum poarta după Stop All", "După Stop All, poți să redeschizi poarta",
      "Nu redeschide poarta după Stop All", "Reia, te rog, lucrul după oprește tot"]) {
      const r = run(text, { source });
      assert.ok(r.steps.every((s) => s.intent !== "stop_all" && s.effect !== "interrupt"), `${source} ${text}: ${r.steps.map((s) => s.intent)}`);
    }
  }
});

test("R2B-03 „Continuă / Reia … după Stop All” shows the rearm card: no resume, no condition question (PF-05, D22)", () => {
  for (const source of SOURCES) {
    for (const text of ["Continuă după Stop All", "Continuă lucrul după Stop All", "Continuăm după oprirea totală", "Reia planul după Stop All", "Reia misiunea după Stop All",
      "Lega, continuă după Stop All", "Continuă după Stop All?", "Poți să continui după Stop All?"]) {
      const r = run(text, { source });
      assert.deepEqual(r.steps.map((s) => s.intent), ["gate_rearm"], `${source} ${text}`);
      assert.equal(r.steps[0].effectClass, "READ_NAVIGATE", text);
      assert.equal(r.clarification, null, `${source} ${text}`);
    }
  }
  // The bare resume keeps its grammar.
  assert.deepEqual(intents("Continuă"), ["ops_continue"]);
  assert.deepEqual(intents("Reia"), ["ops_continue"]);
});

// ---------------------------------------------------------------- PF-01 / PF-05 through the Hub

test("R2B-04 through owner.intent after a Stop All: the rearm phrases add no Stop All, keep the suspension and the card the owner holds still reopens the gate", async () => {
  const t = await makeTestHub({ queues: true });
  try {
    await prepareLiveWithoutGrants(t.hub);
    const dir = path.join(t.dataDir, "r2b-alfa");
    materializeFixture("bug-demo", dir);
    await dispatch(t.hub, "project.register_test", { path: dir, name: "R2B Alfa" });
    const owner = await enrolOwner(t);
    const asOwner = (type, payload = {}, session = owner.session) => t.hub.commands.dispatch({ type, payload, channel: "owner", actor: `owner:${session.id}`, ownerSession: session }).then((r) => r.result);
    await asOwner("system.stop_all", { reason: "test R2B" });
    const stops = () => t.hub.db.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'system.stop_all'").get().n;
    const suspension = () => t.hub.settings.get("executionGate").suspendedBy?.id || null;
    assert.equal(stops(), 1);
    const id0 = suspension();
    assert.ok(id0, JSON.stringify(t.hub.settings.get("executionGate")));
    let card = await asOwner("gate.rearm.card", {});
    assert.ok(card?.nonce && card?.hash, JSON.stringify(card).slice(0, 300));
    for (const text of ["Redeschide poarta după Stop All", "Rearmează Hub-ul după Stop All", "Poți să redeschizi poarta după Stop All?", "Continuă după Stop All", "Lega, redeschide poarta după Stop All"]) {
      const out = await asOwner("owner.intent", { text });
      assert.deepEqual(out.resolved.steps.map((s) => s.intent), ["gate_rearm"], text);
      const r = out.results[0];
      assert.ok(r.gateRearm?.nonce && r.gateRearm?.hash, `${text}: the rearm card of this suspension: ${JSON.stringify(r).slice(0, 300)}`);
      assert.equal(r.gateRearm.hash, card.hash, `${text}: the same facts as the card the owner already had (only a fresh nonce)`);
      assert.doesNotMatch(String(r.message || ""), /condiție/, `${text}: never the condition answer`);
      assert.equal(stops(), 1, `${text}: no second Stop All`);
      assert.equal(suspension(), id0, `${text}: the same suspension`);
      card = r.gateRearm;
    }
    // The card the last sentence showed is the card of THIS suspension: the rearm goes through.
    const reopened = await asOwner("gate.rearm", { nonce: card.nonce, hash: card.hash }, owner.reauth());
    assert.ok(reopened?.reopened, JSON.stringify(reopened).slice(0, 300));
    assert.equal(t.hub.settings.get("executionGate").status, "open");
    // After the rearm the same words still never stop everything again.
    const after = await asOwner("owner.intent", { text: "Redeschide poarta după Stop All" });
    assert.deepEqual(after.resolved.steps.map((s) => s.intent), ["gate_rearm"]);
    assert.equal(stops(), 1);
    assert.equal(t.hub.settings.get("executionGate").status, "open");
  } finally { await t.cleanup(); }
});

// ---------------------------------------------------------------- PF-02: numbered names are never dropped (pure)

test("R2B-05 a name part with a digit or a dot is never dropped to reach a shorter project; a partial match lacking it is ONE question", () => {
  for (const text of ["Hai la Factory Demo M10.3", "Deschide Factory Demo M10.2.1", "Hai la Factory Demo M10 3"]) {
    const r = run(text);
    const s = r.steps[0];
    assert.equal(s.intent, "open_project", text);
    assert.equal(s.args.projectId, undefined, `${text}: never opened silently (${s.args.projectId})`);
    assert.equal(s.args.rest, undefined, text);
    assert.match(r.clarification?.question || "", /^Nu găsesc proiectul „factory demo m10[ .][0-9.]+”\. Te referi la Factory Demo M10\.2\?$/, text);
    assert.deepEqual(r.clarification.options, [{ id: "m102", label: "Factory Demo M10.2" }]);
    assert.equal(r.clarification.forIntent, "open_project");
  }
  for (const text of ["Deschide Factory Demo M11.0", "Hai la Factory Demo C", "Deschide Factory Demo M11"]) {
    const r = run(text);
    assert.equal(r.steps[0].args.projectId, undefined, `${text}: ${r.steps[0].args.projectId}`);
    assert.ok(r.clarification?.options?.length >= 2, `${text}: ONE question among the near names: ${JSON.stringify(r.clarification)}`);
  }
  // Before the probe fixture exists: the dotted name is not Factory Demo A.
  const withoutM102 = projects.filter((p) => p.id !== "m102");
  const early = run("Hai să lucrăm la Factory Demo M10.2", { projects: withoutM102 });
  assert.equal(early.steps[0].args.projectId, undefined);
  assert.match(early.clarification.question, /^Nu găsesc proiectul „factory demo m10\.2”\. Te referi la /);
  // Unchanged: exact names, a filler rest, a number further on in an ordinary rest, a shorter reference to a longer numbered name.
  assert.equal(run("Hai la Factory Demo M10.2").steps[0].args.projectId, "m102");
  assert.equal(run("Deschide Factory Demo A").steps[0].args.projectId, "a");
  assert.equal(run("Deschide Factory Demo A2").steps[0].args.projectId, "a2");
  assert.deepEqual([run("Deschide ProDelivery acum").steps[0].args.projectId, run("Deschide ProDelivery acum").steps[0].args.rest], ["pd", "acum"]);
  assert.equal(run("Hai la Factory Demo A2 acum").steps[0].args.projectId, "a2");
  assert.equal(run("Hai la ProDelivery să vedem cele 2 bug-uri").steps[0].args.projectId, "pd");
  assert.equal(run("Hai la Factory Demo M10").steps[0].args.projectId, "m102", "a shorter reference names nothing the project lacks");
  // The other project references follow the same rule (freeze is ONE question, never the neighbour).
  assert.equal(run("Îngheață Factory Demo M10.3").steps[0].args.projectId, undefined);
});

test("R2B-06 a code request naming a missing numbered project is ONE question — never another project's plan; an ordinary tail keeps its project", () => {
  for (const source of ["typed", "voice-provider"]) {
    const r = run("Repară testul de acceptanță din Factory Demo M10.3", { source });
    assert.equal(r.steps[0].intent, "engineering_request");
    assert.equal(r.steps[0].args.projectId, undefined, "never Factory Demo A by its „factory demo” words");
    assert.equal(r.clarification?.forIntent, "engineering_request");
    assert.equal(r.clarification.question, "Nu găsesc proiectul „factory demo m10.3”. Te referi la Factory Demo M10.2?");
    assert.deepEqual(r.clarification.options, [{ id: "m102", label: "Factory Demo M10.2" }]);
  }
  const early = run("Repară testul de acceptanță din Factory Demo M10.2", { projects: projects.filter((p) => p.id !== "m102") });
  assert.equal(early.steps[0].args.projectId, undefined);
  assert.match(early.clarification.question, /^Nu găsesc proiectul „factory demo m10\.2”\./);
  assert.equal(run("Repară testul de login din Factory Demo C care pică").steps[0].args.projectId, undefined);
  // Unchanged: the exact numbered name, a number later in the sentence, a plain project name.
  assert.equal(run("Repară testul de acceptanță din Factory Demo M10.2").steps[0].args.projectId, "m102");
  assert.equal(run("Repară testul din ProDelivery care pică la pasul 3").steps[0].args.projectId, "pd");
  assert.equal(run("Repară bugul de export din Factory Demo A2").steps[0].args.projectId, "a2");
});

test("R2B-07 a pending „Pe ce proiect lucrez?” is not answered by a missing numbered name (the request is never planned on Factory Demo A); the real name still completes it", async () => {
  const t = await makeTestHub({ queues: true });
  try {
    fs.writeFileSync(`${t.logs.codex}.models.json`, JSON.stringify([{ id: "gpt-6.1-sol", isDefault: true, efforts: ["medium", "high"] }, { id: "gpt-fake-sol", efforts: ["medium", "high"] }]));
    await prepareLiveWithoutGrants(t.hub);
    const dir = path.join(t.dataDir, "factory-demo-a");
    materializeFixture("bug-demo", dir);
    const project = (await dispatch(t.hub, "project.register_test", { path: dir, name: "Factory Demo A" })).result;
    const owner = await enrolOwner(t);
    const asOwner = (payload) => t.hub.commands.dispatch({ type: "owner.intent", payload, channel: "owner", actor: `owner:${owner.session.id}`, ownerSession: owner.session }).then((r) => r.result);
    const envelopes = () => t.hub.db.prepare("SELECT COUNT(*) AS n FROM mission_envelopes").get().n;
    const asked = await asOwner({ text: "Repară validarea numelui: spațiile trec de verificare" });
    assert.match(String(asked.results[0].message || ""), /Pe ce proiect lucrez\?/, JSON.stringify(asked.results[0]).slice(0, 300));
    const missing = await asOwner({ text: "Hai la Factory Demo M10.3" });
    assert.equal(missing.resolved.steps[0].args.projectId, undefined);
    assert.match(missing.resolved.clarification?.question || "", /^Nu găsesc proiectul „factory demo m10\.3”/);
    assert.equal(missing.results[0].navigate, undefined, "not navigated to Factory Demo A");
    assert.ok(!missing.results[0].plan, "no plan on Factory Demo A");
    assert.equal(envelopes(), 0);
    // Control: naming the real project completes the waiting request (the same path the missing name must not take).
    const real = await asOwner({ text: "Hai la Factory Demo A" });
    assert.ok(real.results[0].plan?.envelope?.id, JSON.stringify(real.results[0]).slice(0, 400));
    assert.equal(real.results[0].plan.envelope.projectId, project.id);
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM agent_runs").get().n, 0, "nothing ran");
  } finally { await t.cleanup(); }
});

// ---------------------------------------------------------------- PF-03 / PF-04: the engineering planner (pure, fixture copy)

function fixtureCopy(name = "bug-demo") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ifrim-r2b-"));
  const dir = path.join(root, name);
  fs.cpSync(path.join(FIXTURE_ROOT, name), dir, { recursive: true });
  return { dir, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test("R2B-08 the acceptance test is not bound when the words name ANOTHER test (PF-03) or ask to WRITE an acceptance test (PF-04); the D21 cases still bind", () => {
  const a = fixtureCopy();
  try {
    fs.writeFileSync(path.join(a.dir, "test", "login.test.mjs"), "// fictiv\n");
    const project = { path: a.dir };
    const spec = (text) => buildEngineeringSpec({ text, project });
    for (const text of ["Repară testul de login care pică", "Repară testul login", "Repară testele care pică", "Lega, repară testul de export care nu merge"]) {
      const b = spec(text);
      assert.deepEqual([b.testRef, b.autoBound], [null, null], `${text}: another test was named → the one question`);
    }
    for (const text of ["Adaugă un test de acceptanță pentru validarea numelui din Factory Demo M10.2", "Scrie testul de acceptanță pentru export", "Te rog, adaugă în proiect un test nou de acceptanță",
      "Fă un test de acceptanță pentru login", "Creează teste de acceptanță pentru nume", "Scrie-mi un acceptance test pentru export", "Repară bugul și scrie un test de acceptanță pentru el"]) {
      const b = spec(text);
      assert.deepEqual([b.testRef, b.autoBound], [null, null], `${text}: a NEW acceptance test is asked for`);
      assert.ok(!b.input.spec.constraints.some((c) => /e protejat/.test(c)), `${text}: nothing protected against the request`);
    }
    // Unchanged D21 cases: the acceptance test named as the verification, a described bug that names no test.
    assert.deepEqual([spec("Repară testul de acceptanță din Factory Demo M10.2").testRef, spec("Repară testul de acceptanță din Factory Demo M10.2").autoBound], ["test/acceptance.test.mjs", "named"]);
    assert.deepEqual([spec("Scrie codul care face să treacă testul de acceptanță").autoBound, spec("Implementează ce cere acceptance test-ul pentru nume").autoBound], ["named", "named"]);
    assert.deepEqual([spec("Repară butonul de export care nu merge").autoBound, spec("Repară validarea numelui: spațiile trec de verificare").autoBound], ["described", "described"]);
    // An explicitly named test file is bound as before.
    assert.equal(spec("Repară testul de login; testul e test/login.test.mjs").testRef, "test/login.test.mjs");
  } finally { a.cleanup(); }
});

// ---------------------------------------------------------------- PF-06: the reviewer account check that throws

/** What the M07 install adds to the simulated inspection (the reviewer installed and logged in). */
const INSTALLED = Object.freeze({ pw_version: "1.61.0", pw_chromium: "chromium_headless_shell-1228", pw_sha: "670ba079b7510774", pw_owner: "runner", claude_cli: "2.1.285",
  claude_path: "/home/runner/tools/claude/node_modules/@anthropic-ai/claude-code/bin/claude.exe", claude_sha: "33dad1ec615a2e08", claude_owner: "runner",
  reviewer_config: "present:700", reviewer_creds: "present:600", reviewer_settings: "absent" });

async function reviewerHub(state = {}) {
  const t = await makeTestHub({ wsl: { ...state, facts: { ...INSTALLED, ...(state.facts || {}) } } });
  t.hub.backups.run = async () => ({ id: "bkp_stub", status: "verified" });
  await dispatch(t.hub, "environment.inspect", {});
  const svc = t.hub.environments.get("wsl-runner");
  const fp = svc.state().fingerprint.hash;
  const iso = (h) => new Date(Date.now() - h * 3600000).toISOString();
  // The Codex account check (C16) passes; only the reviewer's check is under test (its real code, the simulated distro).
  svc.probeAccount = async () => {
    t.hub.providerState.set(svc.probeKey, { ok: true, probedAt: new Date().toISOString(), auth: { accountType: "chatgpt", planType: "pro" }, fingerprintHash: fp });
    return { ok: true, c16: ["C16a PASS simulat"], auth: { accountType: "chatgpt", planType: "pro" }, models: [] };
  };
  const step = (id) => t.hub.setup.steps({ origin: `http://localhost:${t.config.port}` }).steps.find((s) => s.id === id);
  const runSetup = async () => {
    const started = t.hub.setup.runAutomatic({ channel: "ui", actor: "user" });
    await waitFor(() => t.hub.setup.steps({}).automatic?.finishedAt, 120000, 100);
    return started;
  };
  return { ...t, svc, fp, iso, step, runSetup };
}

test("R2B-09 a reviewer account check that THROWS after the inspection is stored fresh, on this fingerprint, with its cause — and the error still reaches the caller", async () => {
  const t = await reviewerHub({ prepareFails: true });
  try {
    t.hub.providerState.set(t.svc.reviewerKey, { ok: true, probedAt: t.iso(30), auth: { subscriptionType: "max" }, fingerprintHash: t.fp });
    await assert.rejects(() => t.svc.probeReviewer(), /Workspace-ul de verificare nu a putut fi creat: simulated failure/);
    const stored = t.hub.providerState.get(t.svc.reviewerKey);
    assert.equal(stored.ok, false);
    assert.match(stored.error, /Workspace-ul de verificare nu a putut fi creat: simulated failure/);
    assert.equal(stored.fingerprintHash, t.fp);
    assert.ok(Date.now() - new Date(stored.probedAt).getTime() < 60000, stored.probedAt);
    assert.equal(stored.auth, undefined, "no account facts from a failed check");
    // environment.probe reports the reviewer's failure (and the Codex check result on its own).
    const probe = (await dispatch(t.hub, "environment.probe", {})).result;
    assert.equal(probe.reviewer?.ok, false);
    assert.match(probe.reviewer.error, /simulated failure/);
  } finally { await t.cleanup(); }
});

test("R2B-10 setup: a throwing reviewer check makes the account step DONE with its cause — not „older than 24 h”, not offered again, not re-probed", async () => {
  const t = await reviewerHub({ prepareFails: true });
  try {
    t.hub.providerState.set(t.svc.probeKey, { ok: true, probedAt: t.iso(1), auth: { accountType: "chatgpt", planType: "pro" }, fingerprintHash: t.fp });
    t.hub.providerState.set(t.svc.reviewerKey, { ok: true, probedAt: t.iso(30), auth: { subscriptionType: "max" }, fingerprintHash: t.fp });
    assert.equal(t.step("env_account").status, "AUTO_PENDING");
    let probes = 0;
    const original = t.svc.probeReviewer;
    t.svc.probeReviewer = (...args) => { probes += 1; return original(...args); };
    const started = await t.runSetup();
    assert.ok(started.steps.includes("env_account"), JSON.stringify(started.steps));
    assert.equal(probes, 1);
    const s = t.step("env_account");
    assert.equal(s.status, "DONE_AUTO", s.detail);
    assert.match(s.detail, /reviewer Claude: verificarea a eșuat \(Workspace-ul de verificare nu a putut fi creat: simulated failure\)/);
    assert.doesNotMatch(s.detail, /mai veche de 24 h/);
    assert.ok(!t.hub.setup.steps({}).pendingAutomatic.includes("env_account"), "not offered again");
    // A second click does not run the account step (nor the reviewer probe) again.
    const again = await t.runSetup();
    assert.ok(!again.steps.includes("env_account"), JSON.stringify(again.steps));
    assert.equal(probes, 1, "no re-probe loop");
  } finally { await t.cleanup(); }
});

test("R2B-11 setup: a reviewer check that throws before it can store anything is an ERROR with its cause (retry shown); the Codex check passed, so the attestation step still runs", async () => {
  const t = await reviewerHub();
  try {
    t.hub.providerState.set(t.svc.reviewerKey, { ok: true, probedAt: t.iso(30), auth: { subscriptionType: "max" }, fingerprintHash: t.fp });
    t.svc.probeReviewer = async () => { throw new Error("spawn wsl.exe ENOENT (simulat)"); };
    await t.runSetup();
    const s = t.step("env_account");
    assert.equal(s.status, "RECOVERABLE_ERROR", s.detail);
    assert.match(s.detail, /reviewer Claude: spawn wsl\.exe ENOENT \(simulat\)/);
    assert.doesNotMatch(s.detail, /mai veche de 24 h/);
    assert.ok(t.hub.setup.steps({}).pendingAutomatic.includes("env_account"), "the retry is the explicit button");
    // The optional reviewer did not stop the run: the attestation step was reached and decided (the owner's decision here: no PASS yet).
    const att = t.step("env_attested");
    assert.equal(att.status, "NEEDS_OWNER", att.detail);
    assert.doesNotMatch(att.detail, /nerulat/);
    const finished = JSON.parse(t.hub.db.prepare("SELECT payload_json AS p FROM events WHERE type = 'setup.automatic_finished' ORDER BY seq DESC LIMIT 1").get().p);
    assert.deepEqual([finished.results.env_account, finished.results.env_attested], ["error", "owner"], JSON.stringify(finished));
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'setup.attestation_needs_owner'").get().n, 1);
  } finally { await t.cleanup(); }
});

// ---------------------------------------------------------------- PF-08: a question about something else

test("R2B-12 a „?” elsewhere in the sentence still holds „Continuă”, with the neutral sentence; a resume asked as a question keeps the D20 text", () => {
  for (const source of ["typed", "voice-local", "voice-provider"]) {
    for (const text of ["Ce urmează? Continuă", "Arată-mi testele? Continuă.", "Continuă. Ce urmează?", "Lega, ce urmează? Continuă"]) {
      const r = run(text, { source });
      assert.ok(r.steps.every((s) => s.intent !== "ops_continue"), `${source} ${text}: the hold stays`);
      assert.equal(r.clarification?.question, CONTINUE_MIXED_QUESTION, `${source} ${text}`);
      assert.equal(r.clarification.forIntent, "ops_continue");
      assert.ok(r.steps.some((s) => s.intent === "next_step" || s.intent === "show_tests"), `${text}: the read part is kept`);
    }
    for (const text of ["Continuă?", "Ce urmează? Continuă?", "Continuă? Te rog.", "Pot să continui?"]) {
      const r = run(text, { source });
      assert.ok(r.steps.every((s) => s.intent !== "ops_continue"), `${source} ${text}`);
      assert.equal(r.clarification?.question, CONTINUE_QUESTION, `${source} ${text}`);
    }
  }
  assert.equal(CONTINUE_MIXED_QUESTION, "Ai pus și o întrebare în aceeași frază; ca să reiau, spune „Continuă” singur.");
  // Without any question mark the resume is unchanged.
  assert.deepEqual(intents("Continuă"), ["ops_continue"]);
  assert.equal(run("Continuă").clarification, null);
});
