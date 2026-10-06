// Milestone 10.2 (U01) — effect classes and the resolver grammar, pure (no Hub, no model, no I/O except the mutation copies).
// The 15 sentences the owner said live on 2026-10-04 (18:20–18:55 UTC), the negation / condition matrices, "Da?" on the typed path,
// chaining on "și", reference ranking (a test project never silently wins), and the effect-class matrix that the one command path
// (voice, text, UI) uses. Changed expectations of older suites: none (m06/m08/m09/m10 intent suites pass unchanged).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveIntent, INTENT_EFFECTS, matchRef, rankRef, prepClause, stripFillers } from "../server/owner/intents.mjs";
import { EFFECT_CLASSES, classOfIntent, classOfAction, allowedFrom, refusalReason } from "../server/policy/effect-class.mjs";
import { OPERATIONS } from "../server/policy/action-policy.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const INTENTS_PATH = path.join(here, "..", "server", "owner", "intents.mjs");
const EFFECT_CLASS_PATH = path.join(here, "..", "server", "policy", "effect-class.mjs");

// Live-like: the Hub itself (registry), a test project whose name overlaps it, the ProDelivery pilot (registered as a test project)
// and its staging copy, a factory demo; one mission the owner paused.
const projects = [
  { id: "hub", name: "Ifrim Agent Hub", slug: "ifrim-agent-hub", source: "registry" },
  { id: "hubtest", name: "Ifrim Hub Test", slug: "ifrim-hub-test", source: "hub-test" },
  { id: "pd", name: "ProDelivery", slug: "prodelivery", source: "hub-test" },
  { id: "pds", name: "ProDelivery Staging", slug: "prodelivery-staging", source: "hub-test" },
  { id: "a2", name: "Factory Demo A2", slug: "factory-demo-a2", source: "hub-test" },
];
const missions = [{ id: "mv", projectId: "hub", title: "Videoclip de promovare Ifrim Digital — 30 s", status: "PAUSED", kind: "project_management" }];
const base = { projects, missions, currentProjectId: null };
const presented = { awaiting: "envelope_confirmation", pendingEnvelopes: [{ id: "env1", title: "Fix comenzi" }] };
const run = (text, extra = {}) => resolveIntent(text, { ...base, ...extra });
const intents = (text, extra) => run(text, extra).steps.map((s) => s.intent);
const one = (text, extra) => run(text, extra).steps[0];

test("M10.2-IN-01 the 15 live sentences resolve to the right step (live-like project list)", () => {
  // 1. Navigation.
  assert.deepEqual([one("Hai să lucrăm la ProDelivery.").intent, one("Hai să lucrăm la ProDelivery.").args.projectId], ["open_project", "pd"]);
  // 2. Two steps: the project, then what comes next (live: ONE open_project of „pro delivery si arata-mi ce urmeaza”).
  const chain = run("Deschide Pro Delivery și arată-mi ce urmează.").steps;
  assert.deepEqual(chain.map((s) => s.intent), ["open_project", "next_step"]);
  assert.equal(chain[0].args.projectId, "pd");
  // 3–5.
  assert.equal(one("Arată-mi clipul de promovare.").intent, "studio_show_clip");
  assert.equal(one("Arată-mi clipul de promovare.").args.clipRef, "promovare");
  const edit = one("La secunda 12 mută textul mai sus.");
  assert.deepEqual([edit.intent, edit.args.atSec, edit.args.direction], ["studio_edit", 12, "sus"]);
  assert.equal(one("Arată-mi înainte să faci.").intent, "show_plan");
  // 6. A confirmation only with a presented plan and the owner's own input.
  assert.deepEqual([one("Da, execută planul", presented).intent, one("Da, execută planul", presented).args.envelopeId], ["confirm", "env1"]);
  assert.equal(one("Da, execută planul", { ...presented, source: "voice-local" }).intent, "confirm");
  assert.notEqual(one("Da, execută planul", { ...presented, source: "voice-provider" }).intent, "confirm");
  assert.notEqual(one("Da, execută planul").intent, "confirm", "no plan on screen → no confirmation");
  // 7.
  const notYet = one("Nu porni încă.");
  assert.equal(notYet.intent, "not_yet"); assert.equal(notYet.constraints.noStart, true);
  // 8. The paused mission is resumed (status-aware: the only PAUSED mission), never read as a mission titled „pe care am pus-o pe pauză”.
  const resume = one("Continuă misiunea pe care am pus-o pe pauză.");
  assert.equal(resume.intent, "resume_mission"); assert.equal(resume.effect, "plan"); assert.equal(resume.args.missionId, "mv"); assert.equal(resume.args.missionRef, null);
  // 9.
  assert.equal(one("Oprește tot.").intent, "stop_all");
  // 10. "Mai deschide-l o dată" = the last target the SERVER recorded; with none, ONE question and nothing done.
  const reopen = one("Mai deschide-l o dată", { lastTarget: { kind: "app", id: "notepad", label: "Notepad" } });
  assert.equal(reopen.intent, "reopen_last"); assert.equal(reopen.args.again, true); assert.equal(reopen.args.target.id, "notepad"); assert.equal(reopen.effect, "local");
  const reopenProject = one("Deschide-l din nou", { lastTarget: { kind: "project", id: "pd", label: "ProDelivery" } });
  assert.equal(reopenProject.effect, "navigate", "a project only navigates");
  const blind = run("Mai deschide-l o dată");
  assert.equal(blind.steps[0].intent, "reopen_last"); assert.equal(blind.steps[0].effect, "none"); assert.match(blind.clarification.question, /Ce să deschid din nou/);
  // 11.
  assert.equal(one("Ce s-a executat ultima dată într-o delivery?").intent, "last_run");
  // 12. A Content Studio PLAN request, never unknown (live: the model turned it into a project_management mission on the Hub).
  const create = one("Fă un videoclip de promovare de 30 de secunde");
  assert.deepEqual([create.intent, create.effect, create.effectClass, create.args.durationSec, create.args.topic], ["studio_create", "plan", "BOUNDED_WORKFLOW", 30, "promovare"]);
  // 13. A mission start is a plan request, never a confirmation — not even with a plan on screen.
  for (const ctx of [{}, presented]) {
    const s = one("Pornește misiunea", ctx);
    assert.equal(s.intent, "start_mission"); assert.equal(s.effect, "plan");
  }
  assert.ok(run("Da, pornește misiunea", presented).steps.every((s) => s.intent !== "confirm"), "never split into „da” + a start");
  // 14.
  assert.deepEqual([one("Deschide Notepad").intent, one("Deschide Notepad").args.app], ["desktop_open", "notepad"]);
  // 15. Refused with a reason, never a project named after the words.
  const exec = run("Deschide și execută fișierul descărcat");
  assert.equal(exec.steps[0].intent, "refuse_execute"); assert.equal(exec.steps[0].effectClass, "REFUSED"); assert.equal(exec.steps[0].effect, "none");
  assert.ok(exec.refused.some((r) => r.intent === "refuse_execute" && /descărcate/.test(r.reason)));
  assert.ok(exec.steps.every((s) => s.intent !== "open_project"));
  // Review M10.2 #22: a web domain or a described „instalează” is not refused; the real executable cases still are.
  for (const [p, intent] of [["Analizează pagina ifrimdigital.com", "analysis_request"], ["Repară bug-ul de pe prodelivery.com", "engineering_request"],
    ["Fă un videoclip de promovare pentru ifrimdigital.com", "studio_create"], ["Implementează funcția care instalează pluginurile", "engineering_request"]]) assert.equal(one(p).intent, intent, p);
  for (const p of ["Instalează aplicația", "Execută fișierul descărcat", "Rulează setup.exe"]) assert.equal(one(p).intent, "refuse_execute", p);
});

test("M10.2-IN-02 negation matrix: never a confirmation, never a plan request without noStart (the card on screen stays)", () => {
  const phrases = ["Nu executa planul", "Nu acum", "Nu confirma", "Să nu pornești nimic", "Anulează planul", "Nu, nu confirma planul", "Arată-mi planul, dar să nu pornești nimic", "Nu, nu vreau planul"];
  for (const source of ["typed", "voice-local", "voice-provider"]) {
    for (const p of phrases) {
      const r = run(p, { ...presented, source });
      assert.ok(r.steps.every((s) => s.intent !== "confirm"), `${p} (${source}) → ${r.steps.map((s) => s.intent)}`);
      assert.ok(r.steps.every((s) => s.intent !== "show_plan" || s.constraints.noStart), `${p} (${source}): show_plan only with noStart`);
      assert.ok(r.steps.every((s) => ["not_yet", "reject_plan", "show_plan"].includes(s.intent)), `${p} (${source}) → ${r.steps.map((s) => s.intent)}`);
    }
  }
  assert.equal(one("Anulează planul", presented).intent, "reject_plan");
  assert.equal(one("Nu executa planul", presented).intent, "not_yet");
  assert.equal(one("Arată-mi planul, dar să nu pornești nimic").intent, "show_plan");
  assert.equal(one("Arată-mi planul, dar să nu pornești nimic").constraints.noStart, true);
  // A negation only holds: the older forms keep their meaning.
  assert.equal(one("Nu porni Lega").intent, "not_yet");
  assert.equal(one("Pornește misiunea, dar nu încă").intent, "not_yet");
  assert.equal(one("Nu mai vorbi").intent, "mute");
  assert.equal(one("Nu").intent, "reject_plan");
});

test("M10.2-IN-03 condition matrix: ONE question, zero effect steps, never another intent in place of the start", () => {
  for (const p of ["Execută planul doar dacă trec testele", "Pornește după review", "Dacă trec testele, execută planul", "Pornește misiunea numai după ce termină Claude", "Da, execută planul când e gata review-ul"]) {
    for (const ctx of [{}, presented]) {
      const r = run(p, ctx);
      assert.ok(r.clarification, `${p}: one question`);
      assert.ok(r.steps.every((s) => !["plan", "effect", "local"].includes(s.effect)), `${p}: no effect step (${r.steps.map((s) => `${s.intent}/${s.effect}`)})`);
      assert.ok(r.steps.every((s) => s.intent !== "show_tests" && s.intent !== "confirm"), `${p} → ${r.steps.map((s) => s.intent)}`);
      const held = r.steps.find((s) => s.constraints.conditional);
      assert.ok(held, `${p}: the condition is kept, not dropped`);
      assert.equal(held.intent, "not_yet"); assert.ok(held.args.condition);
    }
  }
  // Review M10.2 #21: a condition on a code request is held as that request; a „după / când” inside a clip topic is not a condition.
  for (const p of ["Repară bug-ul de login doar dacă trec testele", "Implementează validarea formularului după review"]) {
    const r = run(p);
    assert.ok(r.clarification, p);
    assert.deepEqual(r.steps.map((s) => [s.intent, s.args.held]), [["not_yet", "engineering_request"]], p);
  }
  for (const p of ["Fă un videoclip despre ce facem după lansare", "Fă un clip despre cum lucrăm când avem termen"]) {
    assert.deepEqual(intents(p), ["studio_create"], p); assert.equal(run(p).clarification, null, p);
  }
  // Not a condition on a start: a scenario, a lesson, a plain read keep their meaning.
  assert.equal(one("Ce se întâmplă dacă luăm încă cinci clienți?").intent, "simulate");
  assert.equal(one("Ține minte: dacă testele pică, oprește tot").intent, "teach");
  assert.equal(run("Hai la ProDelivery").clarification, null);
});

test("M10.2-IN-04 typed 'Da?' with a presented plan does not confirm (parity with the voice path); 'Da' still does", () => {
  const q = run("Da?", presented);
  assert.notEqual(q.steps[0].intent, "confirm");
  assert.ok(q.refused.some((r) => r.intent === "confirm" && /întrebare/.test(r.reason)));
  assert.equal(one("Da", presented).intent, "confirm");
  // Two clauses that both say yes to the same plan stay a clean confirmation (owner/voice.mjs relies on it).
  assert.deepEqual(intents("Da. Execută planul.", presented), ["confirm", "confirm"]);
});

test("M10.2-IN-05 chaining on „și”: two steps only when both halves are commands; a name with „și” is never split", () => {
  assert.deepEqual(intents("Deschide Pro Delivery, arată-mi ce urmează"), ["open_project", "next_step"]);
  const named = resolveIntent("Hai la Mobila și Deschide Ușa", { projects: [...projects, { id: "mob", name: "Mobila și Deschide Ușa", slug: "mobila-si-deschide-usa" }] });
  assert.deepEqual(named.steps.map((s) => s.intent), ["open_project"]);
  assert.equal(named.steps[0].args.projectId, "mob");
  // One request spanning both halves stays one step; a constraint stays a constraint.
  const cap = run("Înregistrează demonstrația cu OBS și pregătește varianta verticală, fără să publici").steps;
  assert.deepEqual(cap.map((s) => s.intent), ["ops_capture_vertical"]);
  assert.equal(cap[0].args.vertical, true);
  assert.deepEqual(intents("Continuă misiunea videoclip, dar fără deploy"), ["continue_work"]);
  assert.equal(one("Continuă misiunea videoclip, dar fără deploy").constraints.noDeploy, true);
  // A provider transcript "Deschide Notepad și scrie ceva" never becomes a typing plan.
  assert.deepEqual(intents("Deschide Notepad și scrie ceva", { source: "voice-provider" }), ["desktop_open"]);
  assert.ok(run("Da, arată-mi planul", presented).steps.every((s) => s.intent !== "confirm"), "a split never manufactures a yes");
});

test("M10.2-IN-06 references: a test project never wins silently; close names ask ONE question; the longest leading name wins", () => {
  const amb = run("Deschide Ifrim Hub");
  assert.match(amb.clarification.question, /Ifrim Agent Hub sau Ifrim Hub Test/, "the real project is listed first");
  assert.equal(amb.steps[0].args.projectId, undefined);
  assert.match(run("Hai la delivery").clarification.question, /ProDelivery sau ProDelivery Staging/);
  // An exact name wins alone, even against a longer name containing it.
  assert.equal(one("Hai la ProDelivery Staging").args.projectId, "pds");
  assert.equal(one("Hai la ProDelivery").args.projectId, "pd");
  // The greedy tail: the longest leading run that names exactly one project, the rest kept.
  const tail = one("Deschide ProDelivery acum");
  assert.deepEqual([tail.args.projectId, tail.args.rest], ["pd", "acum"]);
  // Ranking: full coverage beats a mere substring; a test project ranks after a real one with the same words.
  const ranked = rankRef("ifrim hub", projects, { extra: (p) => [p.slug] });
  assert.deepEqual(ranked.slice(0, 2).map((x) => x.item.id), ["hub", "hubtest"]);
  assert.ok(ranked[0].score - ranked[1].score <= 15);
  assert.deepEqual(matchRef("comenzi", [{ id: "m1", title: "Problema cu comenzile duplicate" }, { id: "m2", title: "Rapoarte zilnice" }], { name: (m) => m.title }).map((m) => m.id), ["m1"]);
  // Mission references ignore the words that describe a state.
  assert.equal(one("Reia misiunea videoclip").args.missionId, "mv");
  assert.equal(one("Reia misiunea care nu există").args.unknownRef, "care nu exista");
  assert.equal(one("Reia misiunea care nu există").args.missionId, undefined, "an unknown name is never resolved to the only paused mission");
});

test("M10.2-IN-07 fillers, conjugated verbs, pronoun objects and „din nou” before matching", () => {
  assert.equal(stripFillers("te rog, opreste tot"), "opreste tot");
  assert.equal(stripFillers("opreste tot, te rog"), "opreste tot");
  assert.equal(stripFillers("poti sa ma anunti"), "poti sa ma anunti", "a notification preference keeps its words");
  assert.deepEqual(prepClause("poti sa deschizi notepad"), { text: "deschide notepad", again: false, refIt: false });
  assert.deepEqual(prepClause("mai deschide-l o data"), { text: "deschide-l", again: true, refIt: true });
  assert.deepEqual([one("Poți să deschizi Notepad?").intent, one("Poți să deschizi Notepad?").args.app], ["desktop_open", "notepad"]);
  assert.deepEqual([one("Deschide din nou Notepad").intent, one("Deschide din nou Notepad").args.again], ["desktop_open", true]);
  assert.equal(one("Poți să mă anunți").intent, "notify_normal");
  assert.equal(one("Vreau să vorbesc cu Lega").intent, "lega_start");
  assert.equal(one("Vreau să văd clipul").intent, "studio_show_clip");
  assert.equal(one("Aș vrea să faci un videoclip despre ProDelivery de un minut").args.durationSec, 60);
  // "mai" keeps its meaning elsewhere.
  assert.equal(one("La secunda 3 mută titlul mai sus").args.direction, "sus");
  assert.equal(one("Mai târziu").intent, "not_yet");
  // Typed "Lega, stop" = voice; a bare typed "stop" is not a Stop All.
  assert.equal(one("Lega, stop").intent, "stop_all");
  assert.notEqual(one("Stop").intent, "stop_all");
  for (const p of ["Te rog, oprește tot", "Oprește tot, te rog", "Lega, oprește tot acum", "Stop, oprește tot", "Oprește tot ce rulează", "Lega, te rog, oprește tot"]) assert.equal(one(p).intent, "stop_all", p);
});

test("M10.2-IN-08 new reads and references: last delivery, next step, the newest clip, „pornește-o” by the server's last target", () => {
  assert.equal(one("Arată-mi ultima livrare").intent, "last_delivery");
  assert.equal(one("Care a fost ultima livrare?").intent, "last_delivery");
  assert.equal(one("Care e următorul pas?").intent, "next_step");
  assert.equal(one("Ce urmează?").intent, "next_step");
  for (const p of ["Arată-mi ultimul clip", "Arată-mi clipul nou", "Arată-mi-l pe cel creat acum"]) {
    const s = one(p);
    assert.equal(s.intent, "studio_show_clip", p); assert.equal(s.args.latest, true, p); assert.equal(s.args.clipRef, null, p);
  }
  assert.equal(one("Arată-mi clipul despre checkout").args.latest, undefined);
  const it = one("Pornește-o", { lastTarget: { kind: "mission", id: "mv", label: "Videoclip" } });
  assert.deepEqual([it.intent, it.args.missionId, it.effect], ["start_mission", "mv", "plan"]);
  // Bare words keep their older meanings.
  assert.equal(one("Pornește").intent, "unknown", "a bare „Pornește” without a card stays a refused confirmation");
  assert.equal(one("Continuă").intent, "ops_continue");
  assert.equal(one("Reia").intent, "ops_continue");
  assert.equal(one("Continuă misiunea videoclip").intent, "continue_work");
  assert.equal(one("Hai la delivery").intent, "open_project", "a bare „delivery” stays a project reference");
});

test("M10.2-IN-09 effect classes: every intent and every operator operation maps to exactly one class; the source matrix", () => {
  for (const [intent, effect] of Object.entries(INTENT_EFFECTS)) {
    const cls = classOfIntent(intent, effect);
    assert.equal(EFFECT_CLASSES.filter((c) => c === cls).length, 1, `${intent} → ${cls}`);
  }
  for (const op of Object.keys(OPERATIONS)) assert.ok(EFFECT_CLASSES.includes(classOfAction(op)), op);
  assert.equal(classOfAction("app.launch"), "SIMPLE_LOCAL_ACTION");
  assert.equal(classOfAction("media.render"), "BOUNDED_WORKFLOW");
  assert.equal(classOfAction("model.run"), "SENSITIVE_OR_SCOPE_CHANGE");
  assert.equal(classOfAction("publish"), "REFUSED");
  assert.equal(classOfAction("never.heard.of"), "SENSITIVE_OR_SCOPE_CHANGE", "unknown fails closed");
  assert.equal(classOfIntent("start_view", INTENT_EFFECTS.start_view), "SIMPLE_LOCAL_ACTION", "it writes a preference");
  assert.equal(classOfIntent("quiet", INTENT_EFFECTS.quiet), "SIMPLE_LOCAL_ACTION");
  assert.equal(classOfIntent("studio_publish", INTENT_EFFECTS.studio_publish), "REFUSED");
  assert.equal(classOfIntent("confirm", INTENT_EFFECTS.confirm), "SENSITIVE_OR_SCOPE_CHANGE");
  assert.equal(classOfIntent("stop_all", INTENT_EFFECTS.stop_all), "INTERRUPT");
  assert.equal(classOfIntent("whatever", "bogus"), "SENSITIVE_OR_SCOPE_CHANGE");
  // SENSITIVE never from a provider transcript, for every intent of that class, whatever the options.
  for (const [intent, effect] of Object.entries(INTENT_EFFECTS)) {
    const cls = classOfIntent(intent, effect);
    if (cls === "SENSITIVE_OR_SCOPE_CHANGE" || cls === "REFUSED") {
      for (const opts of [{}, { derivedOwnerSession: true }, { planPresented: true }, { derivedOwnerSession: true, planPresented: false }]) assert.equal(allowedFrom(cls, "voice-provider", opts), false, `${intent} from voice-provider`);
    }
  }
  assert.equal(allowedFrom("READ_NAVIGATE", "voice-provider"), true);
  assert.equal(allowedFrom("INTERRUPT", "voice-provider"), true);
  assert.equal(allowedFrom("BOUNDED_WORKFLOW", "voice-provider"), true, "a proposal");
  assert.equal(allowedFrom("BOUNDED_WORKFLOW", "voice-provider", { planPresented: true }), false, "never over a card on screen");
  assert.equal(allowedFrom("SIMPLE_LOCAL_ACTION", "voice-provider"), false);
  assert.equal(allowedFrom("SIMPLE_LOCAL_ACTION", "voice-provider", { derivedOwnerSession: true }), true);
  for (const cls of EFFECT_CLASSES.filter((c) => c !== "REFUSED")) { assert.equal(allowedFrom(cls, "typed"), true, cls); assert.equal(allowedFrom(cls, "voice-local"), true, cls); }
  for (const cls of EFFECT_CLASSES) { assert.equal(allowedFrom(cls, "document"), false); assert.equal(allowedFrom(cls, "media-local"), false); assert.equal(allowedFrom(cls, "made-up"), false); }
  assert.equal(allowedFrom("REFUSED", "typed"), false);
  assert.match(refusalReason("SENSITIVE_OR_SCOPE_CHANGE", "voice-provider"), /nu schimb autoritatea/);
  // The resolver attaches the class from the FINAL effect; inert content is refused as a command.
  assert.equal(one("Deschide Notepad").effectClass, "SIMPLE_LOCAL_ACTION");
  assert.equal(one("Oprește tot").effectClass, "INTERRUPT");
  assert.equal(one("Da, execută planul", { ...presented, source: "voice-provider" }).effectClass, "READ_NAVIGATE", "a refused yes does nothing");
  assert.equal(resolveIntent("Oprește tot", { source: "document" }).steps[0].effectClass, "REFUSED");
  assert.equal(resolveIntent("Ține minte că la livrare verifici mobilul", {}).steps[0].effectClass, "BOUNDED_WORKFLOW", "a lesson is only proposed");
});

let mutationN = 0;
/** Loads a mutated copy of the resolver (temp file, the effect-class import made absolute), so the tests prove they guard the code. */
async function mutatedResolver(mutate) {
  const src = fs.readFileSync(INTENTS_PATH, "utf8");
  const changed = mutate(src);
  assert.notEqual(changed, src, "the mutation must apply");
  const file = path.join(os.tmpdir(), `ifrim-m102-intents-mut-${process.pid}-${mutationN++}.mjs`);
  fs.writeFileSync(file, changed.replace('from "../policy/effect-class.mjs"', `from ${JSON.stringify(pathToFileURL(EFFECT_CLASS_PATH).href)}`));
  try { return await import(pathToFileURL(file).href); } finally { fs.rmSync(file, { force: true }); }
}

test("M10.2-IN-10 mutation checks: without the confirm anchor or the negation guard, the matrices above fail", async () => {
  const notConfirms = ["Clientul a zis că da", "Nu știu dacă da", "Să nu confirmi, da", "Arată-mi planul înainte să-l execut, nu da"];
  const negations = ["Nu executa planul", "Nu acum", "Nu confirma", "Să nu pornești nimic", "Anulează planul", "Nu, nu confirma planul"];
  const ctx = { ...base, ...presented };
  // The real resolver passes both checks.
  assert.ok(notConfirms.every((p) => resolveIntent(p, ctx).steps.every((s) => s.intent !== "confirm")));
  assert.ok(negations.every((p) => resolveIntent(p, ctx).steps.every((s) => ["not_yet", "reject_plan"].includes(s.intent))));
  // 1. The confirmation anchor removed: some ordinary sentence ending in "da" becomes consent.
  const noAnchor = await mutatedResolver((src) => src.replace('["confirm", /^(da|', '["confirm", /(da|'));
  assert.ok(notConfirms.some((p) => noAnchor.resolveIntent(p, ctx).steps.some((s) => s.intent === "confirm")), "the anchor is what keeps these from confirming");
  // 2. The negation guard removed: a negation becomes a plan request or nothing at all.
  const noGuard = await mutatedResolver((src) => src.split("\n").filter((l) => !l.startsWith('  ["reject_plan", /^(?:nu,? )?') && !l.startsWith('  ["not_yet", /^(?:nu,? )*nu ')).join("\n"));
  assert.ok(negations.some((p) => noGuard.resolveIntent(p, ctx).steps.some((s) => !["not_yet", "reject_plan"].includes(s.intent))), "the guard is what holds these");
  assert.equal(noGuard.resolveIntent("Anulează planul", ctx).steps[0].intent, "show_plan", "the live defect comes back without the guard");
});
