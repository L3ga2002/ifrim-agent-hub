// M10.2 review, group G2a (resolver: owner/intents.mjs). Regression tests for findings #5 (a code / analysis request names its
// project), #17 (a confirmation mixed with another request in the same sentence binds no plan), #18 (code requests are not taken by
// the read / plan patterns), #19 (yes-variants confirm; a start verb on "planul" never proposes a new card), #21 (conditions on code
// requests are held; a clip topic's „după / când” is not a condition), #22 (".com" domains and a described „instalează” are not
// refused), #24 ("…, dar nu porni nimic" keeps the request as a preview-only plan) and #25 ("Pornește-o / Reia-o" use only a
// mission last target). Pure resolver tests plus three intake checks on a test Hub (fixture providers, no model, no network).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { resolveIntent } from "../server/owner/intents.mjs";
import { makeTestHub, enrolOwner, prepareLiveWithoutGrants } from "./helpers.mjs";
import { materializeFixture, demoSpec } from "../server/factory/fixtures.mjs";

const projects = [
  { id: "hub", name: "Ifrim Agent Hub", slug: "ifrim-agent-hub", source: "registry" },
  { id: "hubtest", name: "Ifrim Hub Test", slug: "ifrim-hub-test", source: "hub-test" },
  { id: "pd", name: "ProDelivery", slug: "prodelivery", source: "hub-test" },
  { id: "pds", name: "ProDelivery Staging", slug: "prodelivery-staging", source: "hub-test" },
  { id: "a2", name: "Factory Demo A2", slug: "factory-demo-a2", source: "hub-test" },
];
const missions = [
  { id: "mv", projectId: "hub", title: "Videoclip de promovare Ifrim Digital — 30 s", status: "PAUSED" },
  { id: "m2", projectId: "hub", title: "Raport lunar", status: "DRAFT" },
];
const base = { projects, missions, currentProjectId: null };
const presented = { awaiting: "envelope_confirmation", pendingEnvelopes: [{ id: "env1", title: "Fix comenzi" }] };
const run = (text, extra = {}) => resolveIntent(text, { ...base, ...extra });
const one = (text, extra) => run(text, extra).steps[0];
const intents = (text, extra) => run(text, extra).steps.map((s) => s.intent);

test("G2a-05 a code / analysis request that names its project carries projectId; close names ask ONE question; a code place never does", () => {
  const s = one("Repară testul X din Factory Demo A2");
  assert.deepEqual([s.intent, s.args.projectId], ["engineering_request", "a2"]);
  assert.equal(s.args.request, "repara testul x din factory demo a2", "the request keeps the owner's words");
  // The project closes the sentence after a place in the code: the later, stronger reference wins.
  assert.equal(one("Repară bug-ul de la login din ProDelivery").args.projectId, "pd");
  assert.equal(one("Rezolvă eroarea pe proiectul ProDelivery Staging").args.projectId, "pds", "an exact name wins alone");
  assert.equal(one("Analizează README-ul proiectului ProDelivery").args.projectId, "pd");
  // Two plausible projects: ONE question, the real project listed first, no silent pick.
  const amb = run("Repară bug-ul din Ifrim Hub");
  assert.equal(amb.steps[0].intent, "engineering_request");
  assert.equal(amb.steps[0].args.projectId, undefined);
  assert.match(amb.clarification?.question || "", /La care proiect te referi: Ifrim Agent Hub sau Ifrim Hub Test/);
  // A place in the code is not a project: no projectId, no question (the planner decides from the session's project).
  for (const p of ["Repară bug-ul de la login", "Scrie testele pentru pagina de login", "Repară testul din pagina de comenzi"]) {
    const r = run(p);
    assert.equal(r.steps[0].args.projectId, undefined, p);
    assert.equal(r.clarification, null, p);
  }
});

test("G2a-17 a confirmation in the same sentence as another request binds no plan (refused with the reason); a clean double yes still confirms", () => {
  for (const p of ["Fă un videoclip de 30 de secunde, apoi execută planul", "Repară bug-ul de login. Da, execută planul", "Deschide ProDelivery; da", "Da. Execută planul doar dacă trec testele"]) {
    for (const source of ["typed", "voice-local"]) {
      const r = run(p, { ...presented, source });
      assert.ok(r.steps.every((s) => s.intent !== "confirm" && !s.args.envelopeId), `${p} (${source}) → ${JSON.stringify(r.steps.map((s) => [s.intent, s.args]))}`);
      assert.ok(r.refused.some((x) => x.intent === "confirm"), `${p} (${source}): the refusal is recorded`);
    }
  }
  const mixed = run("Fă un videoclip de 30 de secunde, apoi execută planul", presented);
  assert.deepEqual(mixed.steps.map((s) => s.intent), ["studio_create", "unknown"], "the request stays; only the yes is refused");
  assert.match(mixed.steps[1].args.refusedConfirmation, /Confirmă separat planul afișat/);
  assert.ok(mixed.refused.some((x) => /Confirmă separat planul afișat; în aceeași frază ai cerut și altceva/.test(x.reason)));
  assert.deepEqual(run("Da. Execută planul.", presented).steps.map((s) => [s.intent, s.args.envelopeId]), [["confirm", "env1"], ["confirm", "env1"]]);
  assert.equal(one("Da, execută planul", presented).args.envelopeId, "env1");
});

test("G2a-18 code requests are not taken by the read / plan patterns; the reads keep their intents", () => {
  for (const p of ["Repară testele care pică", "Scrie testele pentru pagina de login", "Adaugă un endpoint de status", "Repară preview-ul", "Repară butonul de login care nu merge", "Corectează validarea din planul de abonament"]) {
    assert.equal(one(p).intent, "engineering_request", p);
  }
  assert.equal(one("Analizează testele care pică").intent, "analysis_request");
  // Guards: the reads and the plan stay what they were (never a model run).
  for (const [p, intent] of [["Arată-mi testele", "show_tests"], ["Arată-mi planul", "show_plan"], ["Status", "status"], ["Explică-mi testele", "show_tests"],
    ["Citește planul", "show_plan"], ["Explică-mi planul", "show_plan"], ["Analizează planul", "show_plan"], ["Au trecut testele?", "show_tests"], ["Arată-mi preview-ul", "show_preview"]]) {
    assert.equal(one(p).intent, intent, p);
  }
  assert.equal(one("Explică-mi de ce e blocat").intent, "why_blocked");
});

test("G2a-19 yes-variants confirm the plan on screen; a start verb on „planul” never becomes show_plan (ONE question instead)", () => {
  for (const p of ["Ok, execută planul", "Hai, execută planul", "Sigur, execută planul", "Bine, execută planul", "Da, execută planul acum", "Execută planul acum", "Da, confirm", "Da, execută-l", "Da, sigur", "Ok, da"]) {
    const r = run(p, presented);
    assert.deepEqual(r.steps.map((s) => [s.intent, s.args.envelopeId]), [["confirm", "env1"]], p);
    assert.equal(r.refused.length, 0, p);
    // The same words from a provider transcript never confirm.
    assert.ok(run(p, { ...presented, source: "voice-provider" }).steps.every((s) => s.intent !== "confirm"), `${p} (voice-provider)`);
  }
  // Without a plan on screen the yes is refused, never a plan request.
  assert.ok(run("Ok, execută planul").steps.every((s) => s.intent !== "show_plan" && s.intent !== "confirm"));
  // Not a clean yes: ONE question about the plan on screen, never a new card.
  for (const p of ["Ok, execută planul, fără deploy", "Pornește planul de marketing", "Execută planul pentru ProDelivery"]) {
    const r = run(p, presented);
    assert.ok(r.steps.every((s) => s.intent !== "show_plan" && s.intent !== "confirm"), `${p} → ${r.steps.map((s) => s.intent)}`);
    assert.match(r.clarification?.question || "", /Vrei să execut planul afișat\?/, p);
  }
  // Navigation with "hai" and the plan reads keep their meaning.
  assert.equal(one("Hai la ProDelivery").intent, "open_project");
  assert.equal(one("Arată-mi planul", presented).intent, "show_plan");
  assert.equal(one("Nu executa planul", presented).intent, "not_yet");
});

test("G2a-21 conditions on code / analysis requests are held; a „după / când” inside a clip topic or a bug description is not", () => {
  for (const [p, held] of [["Repară bug-ul de login doar dacă trec testele", "engineering_request"], ["Implementează validarea formularului după review", "engineering_request"],
    ["Implementează exportul după review", "engineering_request"], ["Analizează codul doar după ce termină Claude", "analysis_request"]]) {
    const r = run(p);
    assert.ok(r.clarification, `${p}: one question`);
    assert.deepEqual(r.steps.map((s) => s.intent), ["not_yet"], p);
    assert.equal(r.steps[0].args.held, held, p);
    assert.ok(r.steps[0].args.condition, p);
    assert.ok(r.steps.every((s) => s.intent !== "show_tests"), p);
  }
  for (const p of ["Fă un videoclip despre ce facem după lansare", "Fă un clip despre cum lucrăm când avem termen"]) {
    const r = run(p);
    assert.deepEqual(r.steps.map((s) => s.intent), ["studio_create"], p);
    assert.equal(r.clarification, null, p);
  }
  assert.equal(one("Repară bug-ul care apare când apeși butonul").intent, "engineering_request");
  assert.equal(run("Repară bug-ul care apare când apeși butonul").clarification, null);
  // An explicit condition still holds the clip and the code request.
  assert.equal(one("Fă un clip despre ProDelivery doar după review").args.held, "studio_create");
  assert.equal(one("Repară bug-ul care apare când apeși butonul doar dacă trec testele").args.held, "engineering_request");
});

test("G2a-22 a web domain or a described „instalează” is not refused; the real executable cases still are", () => {
  for (const [p, intent] of [["Analizează pagina ifrimdigital.com", "analysis_request"], ["Repară bug-ul de pe prodelivery.com", "engineering_request"],
    ["Fă un videoclip de promovare pentru ifrimdigital.com", "studio_create"], ["Implementează funcția care instalează pluginurile", "engineering_request"]]) {
    const r = run(p);
    assert.equal(r.steps[0].intent, intent, p);
    assert.ok(!r.refused.some((x) => x.intent === "refuse_execute"), p);
  }
  for (const p of ["Instalează aplicația", "Execută fișierul descărcat", "Rulează setup.exe", "Rulează setup.com", "Poți să instalezi aplicația?", "Deschide și execută fișierul descărcat", "Deschide setup.msi"]) {
    assert.equal(one(p).intent, "refuse_execute", p);
  }
});

test("G2a-24 „…, dar nu porni nimic” keeps a code / analysis request as a preview-only plan; a delay removes the start", () => {
  for (const [p, intent] of [["Implementează pagina de login, dar nu porni nimic", "engineering_request"], ["Analizează codul și nu porni nimic", "analysis_request"],
    ["Repară bug-ul de la login mai târziu", "engineering_request"]]) {
    const s = one(p);
    assert.equal(s.intent, intent, p);
    assert.equal(s.constraints.noStart, true, p);
    assert.equal(s.args.previewOnly, true, p);
  }
  assert.equal(one("Mai târziu").intent, "not_yet");
  assert.equal(one("Nu porni încă").intent, "not_yet");
  assert.equal(one("Pornește misiunea, dar nu încă").intent, "not_yet");
});

test("G2a-25 „Pornește-o / Reia-o” use only a mission last target; otherwise ONE question, never the single-candidate pick", () => {
  for (const lastTarget of [{ kind: "clip", id: "c1" }, { kind: "app", id: "notepad" }, { kind: "plan", id: "env1" }, null]) {
    for (const [p, q] of [["Pornește-o", /Ce misiune să pornesc/], ["Reia-o", /Ce misiune să reiau/], ["Repornește-l", /Ce misiune să reiau/]]) {
      const r = run(p, { lastTarget });
      assert.equal(r.steps[0].args.missionId, undefined, `${p} after ${lastTarget?.kind}`);
      assert.match(r.clarification?.question || "", q, `${p} after ${lastTarget?.kind}`);
    }
  }
  // The fitting missions are offered as the options.
  assert.deepEqual(run("Pornește-o", { lastTarget: { kind: "clip", id: "c1" } }).clarification.options.map((o) => o.id), ["m2"]);
  assert.equal(one("Reia-o", { lastTarget: { kind: "mission", id: "m2" } }).args.missionId, "m2", "the server's last mission, not the only paused one");
  assert.equal(one("Pornește-o", { lastTarget: { kind: "mission", id: "mv" } }).args.missionId, "mv");
  // By name or by state (no pronoun), unchanged.
  assert.equal(one("Continuă misiunea pe care am pus-o pe pauză").args.missionId, "mv");
  assert.equal(one("Pornește misiunea").args.missionId, "m2");
});

// ------------------------------------------------------------------ intake (one command path), fixture providers only

const M09_MODELS = { writerModel: "gpt-fake-sol", reviewerModel: "sonnet" };
const dispatch = (hub, type, payload, extra = {}) => hub.commands.dispatch({ type, payload, channel: "test", actor: "test", ...extra });
const asOwner = (t, owner, payload) => t.hub.commands.dispatch({ type: "owner.intent", payload, channel: "owner", actor: `owner:${owner.session.id}`, ownerSession: owner.session }).then((r) => r.result);
const presentedOf = (env) => ({ envelopeId: env.id, nonce: env.nonce, hash: env.envelopeHash });

async function planHub() {
  const t = await makeTestHub({ queues: true });
  fs.writeFileSync(`${t.logs.codex}.models.json`, JSON.stringify([{ id: "gpt-6.1-sol", isDefault: true, efforts: ["medium", "high"] }, { id: "gpt-fake-sol", efforts: ["medium", "high"] }]));
  await prepareLiveWithoutGrants(t.hub);
  const dir = path.join(t.dataDir, "factory-g2a");
  materializeFixture("bug-demo", dir);
  const project = (await dispatch(t.hub, "project.register_test", { path: dir })).result;
  const owner = await enrolOwner(t, { activatePolicy: true });
  await dispatch(t.hub, "owner.autonomy.set", { projectId: project.id, level: "TRUSTED" }, { ownerSession: owner.reauth() });
  const { mission } = (await dispatch(t.hub, "factory.prepare", { projectId: project.id, ...demoSpec("bug-demo"), limits: M09_MODELS })).result;
  return { ...t, project, owner, mission };
}

test("G2a-IK-17/19 typed: a request + a yes leaves the presented plan PROPOSED; a start verb on „planul” never supersedes it", async () => {
  const t = await planHub();
  try {
    const env = (await asOwner(t, t.owner, { text: "Arată-mi planul", projectId: t.project.id })).results[0].plan.envelope;
    assert.equal(env.status, "PROPOSED");
    const mixed = await asOwner(t, t.owner, { text: "Fă un videoclip de 30 de secunde, apoi execută planul", projectId: t.project.id, presented: presentedOf(env) });
    assert.ok(mixed.results.every((r) => !r.confirmed), JSON.stringify(mixed.results));
    assert.ok(mixed.resolved.refused.some((x) => x.intent === "confirm" && /Confirmă separat/.test(x.reason)), JSON.stringify(mixed.resolved.refused));
    assert.equal(t.hub.envelopes.get(env.id).status, "PROPOSED", "the plan that waited is not confirmed by a yes meant for the new request");
    assert.equal(t.hub.grants.ofEnvelope(env.id).length, 0);
    const unclear = await asOwner(t, t.owner, { text: "Ok, execută planul, fără deploy", projectId: t.project.id, presented: presentedOf(env) });
    assert.match(unclear.resolved.clarification?.question || "", /Vrei să execut planul afișat/);
    assert.equal(t.hub.envelopes.get(env.id).status, "PROPOSED", "never superseded by a new card");
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM agent_runs").get().n, 0);
  } finally { await t.cleanup(); }
});

test("G2a-IK-24 typed „Repară bug-ul …, dar nu porni nimic” → an engineering plan with no armed window and the preview-only note", async () => {
  const t = await planHub();
  try {
    const out = await asOwner(t, t.owner, { text: "Repară bug-ul: un nume format doar din spații trece de validare. Testul de acceptanță e test/acceptance.test.mjs, dar nu porni nimic.", projectId: t.project.id });
    assert.equal(out.resolved.steps[0].intent, "engineering_request", JSON.stringify(out.resolved.steps));
    assert.equal(out.resolved.steps[0].args.previewOnly, true);
    const r = out.results[0];
    assert.ok(r.plan?.envelope?.id, `the request is kept as a plan (it used to be dropped as not_yet): ${JSON.stringify(r).slice(0, 400)}`);
    assert.equal(r.plan.envelope.status, "PROPOSED");
    assert.equal(r.armed, undefined, "no armed window for a preview-only plan");
    assert.match(r.note || "", /Doar planul, cum ai cerut; nu pornesc nimic/);
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM agent_runs").get().n, 0);
  } finally { await t.cleanup(); }
});
