// Milestone 06 — local intent resolution (no model): the owner's example sentences, negations, chains, references,
// clarifications and the rules that keep a "yes" from becoming consent outside a presented plan.
import test from "node:test";
import assert from "node:assert/strict";
import { resolveIntent, normalize, matchRef } from "../server/owner/intents.mjs";

const ctx = {
  projects: [{ id: "p1", name: "ProDelivery", slug: "prodelivery" }, { id: "p2", name: "Factory Demo A2", slug: "factory-demo-a2" }, { id: "p3", name: "Factory Demo B (feature)", slug: "factory-demo-b-feature" }],
  currentProjectId: "p1",
  missions: [{ id: "m1", projectId: "p1", title: "Problema cu comenzile duplicate" }, { id: "m2", projectId: "p1", title: "Rapoarte zilnice pentru curieri" }],
  departments: [{ key: "engineering", name: "Engineering" }, { key: "sales", name: "Vânzări" }],
};
const steps = (text, extra = {}) => resolveIntent(text, { ...ctx, ...extra }).steps;
const one = (text, extra) => steps(text, extra)[0];

test("M06-IN-01 the sentences of the specification resolve to the right step, effect and constraints", () => {
  assert.deepEqual([one("Hai să lucrăm la ProDelivery.").intent, one("Hai să lucrăm la ProDelivery.").args.projectId], ["open_project", "p1"]);
  assert.equal(one("Continuă ce făceam ieri.").intent, "continue_last");
  assert.equal(one("Arată-mi ce a schimbat Codex.").intent, "show_changes");
  assert.equal(one("Claude ce a găsit?").intent, "show_review");
  const plan = one("Doar arată-mi planul, nu porni nimic.");
  assert.equal(plan.intent, "show_plan"); assert.equal(plan.effect, "plan"); assert.equal(plan.constraints.noStart, true);
  const cont = one("Continuă problema cu comenzile, dar fără deploy.");
  assert.equal(cont.intent, "continue_work"); assert.equal(cont.args.missionId, "m1"); assert.equal(cont.constraints.noDeploy, true);
  const chain = steps("Nu porni încă; schimbă ordinea.");
  assert.deepEqual(chain.map((s) => s.intent), ["not_yet", "reorder"]);
  assert.ok(chain.every((s) => s.effect !== "effect"), "neither step has an effect");
  assert.equal(one("Lega, arată-ți fața").intent, "face_show");
  assert.deepEqual(steps("Ce face Codex? Claude ce zice?").map((s) => s.intent), ["status", "show_review"]);
  assert.equal(one("Arată-mi de ce a picat testul").intent, "replay");
  assert.equal(one("Continuă până e gata de verificarea mea").args.untilReady, true);
});

test("M06-IN-02 interruption vocabulary has distinct meanings", () => {
  const map = { "Taci": "mute", "Nu mai vorbi": "mute", "Pauză": "pause", "Oprește Codex": "stop_worker", "Îngheață ProDelivery": "freeze_project", "Oprește tot": "stop_all", "Preiau eu": "takeover" };
  for (const [text, intent] of Object.entries(map)) assert.equal(one(text).intent, intent, text);
  assert.equal(one("Oprește Claude").args.worker, "claude");
  assert.equal(one("Îngheață ProDelivery").args.projectId, "p1");
  assert.equal(one("Nu mă deranja până termini, decât pentru o decizie").args.onlyDecisions, true);
});

test("M06-IN-03 a 'yes' is consent only for one presented plan, from the owner's own input", () => {
  const presented = { awaiting: "envelope_confirmation", pendingEnvelopes: [{ id: "env1", title: "Fix comenzi" }] };
  assert.equal(one("Da, execută planul", presented).intent, "confirm");
  assert.equal(one("Da, execută planul", presented).args.envelopeId, "env1");
  // After a navigation question there is no plan waiting.
  const r1 = resolveIntent("Da", { ...ctx, pendingEnvelopes: [{ id: "env1", title: "A" }] });
  assert.equal(r1.steps[0].intent, "unknown"); assert.ok(r1.refused.length);
  // Two plans: one useful question, no guess.
  const r2 = resolveIntent("da", { ...ctx, awaiting: "envelope_confirmation", pendingEnvelopes: [{ id: "e1", title: "A" }, { id: "e2", title: "B" }] });
  assert.match(r2.clarification.question, /Care plan/);
  assert.equal(r2.steps[0].intent, "unknown");
  // A provider transcript, a document and a quoted "confirm" never confirm.
  assert.equal(one("da", { ...presented, source: "voice-provider" }).intent, "unknown");
  assert.equal(one("confirm", { ...presented, source: "document" }).intent, "unknown");
  const q = resolveIntent("Clientul a scris: „confirm”", { ...ctx, ...presented });
  assert.ok(q.refused.some((r) => /citat/.test(r.reason)));
  assert.ok(q.steps.every((s) => s.intent !== "confirm"));
  // A whole confirmation inside quotes (pasted from a message) is a quotation, not the owner's answer.
  assert.notEqual(one("„Da, execută planul”", presented).intent, "confirm");
  assert.notEqual(one('"confirm"', presented).intent, "confirm");
  // "Da, dar nu porni" keeps the negation.
  assert.ok(steps("Da, dar nu porni încă", presented).every((s) => s.intent !== "confirm"));
  // A partial sentence that only mentions the plan is not a confirmation.
  assert.notEqual(one("planul", presented).intent, "confirm");
});

test("M06-IN-04 references: diacritics, ambiguity → one question, departments, unknown project", () => {
  assert.equal(normalize("Îngheață ȘTEFAN"), "ingheata stefan");
  const amb = resolveIntent("lucrăm la factory demo", ctx);
  assert.match(amb.clarification.question, /Factory Demo A2 sau Factory Demo B/);
  assert.equal(one("Engineering").intent, "zoom");
  assert.equal(one("Vânzări").args.departmentKey, "sales");
  assert.equal(one("Hai să lucrăm la Nivora").args.unknownRef, "nivora");
  assert.deepEqual(matchRef("comenzi", ctx.missions, { name: (m) => m.title }).map((m) => m.id), ["m1"]);
});
