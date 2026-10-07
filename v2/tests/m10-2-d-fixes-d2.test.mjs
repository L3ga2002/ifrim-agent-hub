// 2.12.3 (D2) — a leading acknowledgement („Ok, fă acel videoclip de promovare”, live 2026-10-06) in front of a request whose rule is
// anchored on its verb. PASS_SIMULATED: the pure resolver only (no Hub, no model, no I/O except the mutation copies in os.tmpdir()).
// The acknowledgement is dropped per clause and only when what follows IS one of the anchored requests (ACK_REQUESTS), so „ack + X”
// resolves exactly like X; consent words („da”), confirmations („Ok, fă-l”), stops and „hai la …” keep their current results. A transcript
// that wrote „Ok.” as its own sentence loses that lone unknown step only next to such a request. „acel / acest” name the same request.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveIntent, prepClause } from "../server/owner/intents.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const INTENTS_PATH = path.join(here, "..", "server", "owner", "intents.mjs");
const EFFECT_CLASS_PATH = path.join(here, "..", "server", "policy", "effect-class.mjs");

const ctx = { projects: [{ id: "pd", name: "ProDelivery", slug: "prodelivery", source: "registry" }],
  missions: [{ id: "mv", projectId: "pd", title: "Videoclip de promovare", status: "PAUSED", kind: "project_management" }], currentProjectId: null, source: "voice-local" };
const waiting = { ...ctx, pendingEnvelopes: [{ id: "env_1", title: "Planul afișat" }], awaiting: "envelope_confirmation" };
const LIVE = "Ok, fă acel videoclip de promovare";
const intents = (r) => r.steps.map((s) => s.intent);
/** What a sentence resolves to, without the words themselves (the parity check compares this). */
const shape = (r) => ({ steps: r.steps.map((s) => ({ intent: s.intent, args: s.args, constraints: s.constraints, effectClass: s.effectClass, text: s.text })), clarification: r.clarification, refused: r.refused });

// ---------------------------------------------------------------- the checks (shared by the real resolver and the mutants)
/** 1. The live sentence and its acknowledgement variants → exactly [studio_create], purpose „promovare”, no question. */
function liveCase(resolve) {
  for (const s of [LIVE, "Fă acel videoclip de promovare", "Ok fă acel videoclip de promovare", "Hai, fă acel videoclip de promovare", "Hai fă acel videoclip de promovare",
    "Okay, fă acel videoclip de promovare", "Haide, fă acel videoclip de promovare", "Lega, ok, fă acel videoclip de promovare", "Ok, Lega, fă acel videoclip de promovare",
    "Ok, te rog, fă acel videoclip de promovare"]) {
    const r = resolve(s, ctx);
    assert.deepEqual(intents(r), ["studio_create"], s);
    assert.equal(r.steps[0].args.purpose, "promovare", s);
    assert.equal(r.clarification, null, s);
  }
}
/** 2. The transcript period after the acknowledgement: no extra unknown step next to the request. */
function periodCase(resolve) {
  for (const s of ["Ok. Fă acel videoclip de promovare.", "Ok! Fă acel videoclip de promovare", "Bine. Fă acel videoclip de promovare"]) assert.deepEqual(intents(resolve(s, ctx)), ["studio_create"], s);
}
/** 3. Parity: „Ok, X”, „Hai, X” and „Ok X” resolve exactly like X. */
const PARITY = ["Fă un videoclip de 30 de secunde despre ProDelivery", "Repară bug-ul de login", "Analizează testele care pică", "Citește fișierul de log", "Pornește misiunea Videoclip",
  "Reia misiunea Videoclip", "Treci pe live", "Fă un videoclip doar dacă trec testele", "Fă un videoclip, nu opri tot", "Fă un videoclip și oprește tot", "Repară bug-ul de login, dar nu porni nimic",
  // D2 review: conditional analysis / engineering / mission requests (a broader rule — show_tests — matched the whole clause after „Ok”).
  "Citește fișierul doar dacă trec testele", "Rezumă log-urile doar dacă trec testele", "Repară bug-ul de login doar dacă trec testele", "Pornește misiunea Videoclip doar dacă trec testele"];
function parityCase(resolve) {
  for (const x of PARITY) {
    const bare = shape(resolve(x, ctx));
    const lower = `${x.charAt(0).toLocaleLowerCase("ro-RO")}${x.slice(1)}`;
    for (const s of [`Ok, ${lower}`, `Hai, ${lower}`, `Ok ${lower}`]) assert.deepEqual(shape(resolve(s, ctx)), bare, s);
  }
}
/** 4. The condition is kept (never show_tests): the request is held with ONE question. */
function conditionCase(resolve) {
  const r = resolve("Ok, fă un videoclip de promovare doar dacă trec testele", ctx);
  assert.deepEqual(intents(r), ["not_yet"]);
  assert.equal(r.steps[0].args.held, "studio_create");
  assert.ok(r.clarification, "one question about the condition");
  // D2 review: the same for an analysis / engineering / mission request after any acknowledgement (never show_tests, never a dropped condition).
  for (const [s, held] of [["Ok, citește fișierul doar dacă trec testele", "analysis_request"], ["Hai, citește fișierul doar dacă trec testele", "analysis_request"],
    ["Ok citește fișierul doar dacă trec testele", "analysis_request"], ["Lega, ok, citește fișierul doar dacă trec testele", "analysis_request"],
    ["Ok, rezumă log-urile doar dacă trec testele", "analysis_request"], ["Ok, repară bug-ul de login doar dacă trec testele", "engineering_request"],
    ["Ok, pornește misiunea Videoclip doar dacă trec testele", "start_mission"]]) {
    const x = resolve(s, ctx);
    assert.deepEqual(intents(x), ["not_yet"], s);
    assert.equal(x.steps[0].args.held, held, s);
    assert.ok(x.clarification, s);
  }
}
/** 5. R2 (stops) unchanged. */
function stopCase(resolve) {
  assert.deepEqual(intents(resolve("Ok, fă un videoclip și oprește tot", ctx)), ["studio_create", "stop_all"]);
  assert.deepEqual(intents(resolve("Ok, oprește tot", ctx)), ["stop_all"]);
  assert.deepEqual(intents(resolve("Ok. Oprește tot.", ctx)), ["unknown", "stop_all"], "a lone „Ok.” next to a stop keeps its step");
  const ask = resolve("Ok, oprești tot?", ctx);
  assert.deepEqual(intents(ask), ["explain_stop"]);
  assert.equal(ask.steps[0].args.mood, "ask");
  assert.deepEqual(intents(resolve("Ok, lega, stop", ctx)), ["unknown"]);
}
/** 6. Negations, questions, navigation and consent words keep their current results. */
function keepCase(resolve) {
  assert.deepEqual(intents(resolve("Ok, nu fă un videoclip", ctx)), ["unknown"]);
  assert.deepEqual(intents(resolve("Hai, nu repara bug-ul de login", ctx)), ["unknown"]);
  assert.deepEqual(intents(resolve("Ok, cum fac un videoclip?", ctx)), ["unknown"]);
  assert.deepEqual(intents(resolve("Ok, ce urmează?", ctx)), ["next_step"]);
  for (const s of ["Ok, hai la ProDelivery", "Hai să lucrăm la ProDelivery"]) {
    const r = resolve(s, ctx);
    assert.deepEqual(intents(r), ["open_project"], s);
    assert.equal(r.steps[0].args.projectId, "pd", s);
  }
  assert.deepEqual(intents(resolve("Da, fă un videoclip de promovare", ctx)), ["unknown"], "„da” is a consent word, never dropped");
}
/** 7. Confirmations of the plan on screen stay confirmations; a mixed sentence is still refused; „Ok. Continuă.” keeps both steps. */
function confirmCase(resolve) {
  for (const s of ["Ok, fă-l", "Hai, fă-o", "Ok, execută", "Ok, pornește", "Ok, fă", "Ok, execută planul"]) {
    const r = resolve(s, waiting);
    assert.deepEqual(intents(r), ["confirm"], s);
    assert.equal(r.steps[0].args.envelopeId, "env_1", s);
  }
  const mixed = resolve("Ok. Fă un videoclip. Da, execută planul.", waiting);
  assert.ok(!intents(mixed).includes("confirm"), "no confirmation step");
  assert.ok(mixed.refused.some((x) => x.intent === "confirm"), "the confirmation is refused");
  assert.deepEqual(intents(resolve("Ok. Continuă.", waiting)), ["unknown", "ops_continue"]);
}
const ALL = [liveCase, periodCase, parityCase, conditionCase, stopCase, keepCase, confirmCase];
/** How many of the seven cases a resolver fails. */
function failing(resolve, extra = () => {}) {
  let n = 0;
  for (const check of [...ALL, extra]) { try { check(resolve); } catch { n += 1; } }
  return n;
}

test("D2-01 the live sentence: „Ok, fă acel videoclip de promovare” and its acknowledgement variants are ONE Studio request", () => liveCase(resolveIntent));
test("D2-02 a transcript period after the acknowledgement adds no unknown step next to the request", () => periodCase(resolveIntent));
test("D2-03 parity: „Ok, X”, „Hai, X” and „Ok X” resolve exactly like X (steps, args, constraints, classes, questions, refusals)", () => parityCase(resolveIntent));
test("D2-04 a condition after the acknowledgement is kept: the request is held with ONE question, never read as the tests", () => conditionCase(resolveIntent));
test("D2-05 R2 unchanged: stops, a stop question and „Ok, lega, stop” keep their results", () => stopCase(resolveIntent));
test("D2-06 negations, questions, „hai la …” and „da” keep their results; prepClause of „hai la …” is unchanged", () => {
  keepCase(resolveIntent);
  assert.deepEqual(prepClause("hai la prodelivery"), { text: "hai la prodelivery", again: false, refIt: false });
  assert.deepEqual(prepClause("poti sa deschizi notepad"), { text: "deschide notepad", again: false, refIt: false }, "the polite form is unchanged");
});
test("D2-07 confirmations: „Ok, fă-l / execută / pornește” still confirm the plan on screen; a mixed sentence is refused; „Ok. Continuă.” keeps both steps", () => confirmCase(resolveIntent));

// ---------------------------------------------------------------- mutation checks (temp copies; the repository file is never touched)
let mutationN = 0;
async function mutatedResolver(mutate) {
  const src = fs.readFileSync(INTENTS_PATH, "utf8");
  const changed = mutate(src);
  assert.notEqual(changed, src, "the mutation must apply");
  const file = path.join(os.tmpdir(), `ifrim-d2-intents-mut-${process.pid}-${mutationN++}.mjs`);
  fs.writeFileSync(file, changed.replace('from "../policy/effect-class.mjs"', `from ${JSON.stringify(pathToFileURL(EFFECT_CLASS_PATH).href)}`));
  try { return await import(pathToFileURL(file).href); } finally { fs.rmSync(file, { force: true }); }
}

test("D2-08 mutation checks: each piece of the fix is what keeps the cases above green", async () => {
  assert.equal(failing(resolveIntent), 0, "the real resolver passes every case");
  // MUT-1: no gated drop (neither gate) — the live sentence is unknown again and the condition is read as the tests.
  const m1 = await mutatedResolver((src) => src.replace("    if (m && ACK_REQUESTS.has(m.intent)) return alt;\n", "").replace("    if (held && ACK_REQUESTS.has(held)) return alt;\n", ""));
  assert.deepEqual(intents(m1.resolveIntent(LIVE, ctx)), ["unknown"]);
  assert.deepEqual(intents(m1.resolveIntent("Ok, fă un videoclip de promovare doar dacă trec testele", ctx)), ["show_tests"], "the live condition defect comes back");
  assert.ok(failing(m1.resolveIntent) >= 2);
  // MUT-2: no „acel / acest” on the studio_create line.
  const m2 = await mutatedResolver((src) => src.replace("(?:un |o |niste |acel |acest )?(?:nou |noua", "(?:un |o |niste )?(?:nou |noua"));
  assert.deepEqual(intents(m2.resolveIntent("Fă acel videoclip de promovare", ctx)), ["unknown"]);
  assert.throws(() => liveCase(m2.resolveIntent));
  assert.throws(() => periodCase(m2.resolveIntent));
  // MUT-3: no lone-„Ok.” splice.
  const m3 = await mutatedResolver((src) => src.replace("    for (let i = steps.length - 1; i >= 0; i--) if (steps[i].intent === \"unknown\" && ACK_ONLY.test(String(steps[i].text || \"\"))) steps.splice(i, 1);\n", ""));
  assert.deepEqual(intents(m3.resolveIntent("Ok. Fă acel videoclip de promovare.", ctx)), ["unknown", "studio_create"]);
  assert.throws(() => periodCase(m3.resolveIntent));
  // MUT-4: the drop without its gate — a yes to the plan on screen becomes a local „reopen”, and „hai la …” changes.
  const m4 = await mutatedResolver((src) => src.replace("    if (m && ACK_REQUESTS.has(m.intent)) return alt;\n", "    return alt;\n"));
  assert.notDeepEqual(intents(m4.resolveIntent("Ok, fă-l", waiting)), ["confirm"]);
  assert.notDeepEqual(m4.prepClause("hai la prodelivery"), { text: "hai la prodelivery", again: false, refIt: false });
  assert.throws(() => confirmCase(m4.resolveIntent));
  assert.throws(() => keepCase(m4.resolveIntent));
  // MUT-5: the splice without its request condition — „Ok. Continuă.” and „Ok. Oprește tot.” lose their first step.
  const m5 = await mutatedResolver((src) => src.replace(" && steps.some((s) => ACK_REQUESTS.has(s.intent) || ACK_REQUESTS.has(s.args?.held))", ""));
  assert.deepEqual(intents(m5.resolveIntent("Ok. Continuă.", waiting)), ["ops_continue"]);
  assert.deepEqual(intents(m5.resolveIntent("Ok. Oprește tot.", ctx)), ["stop_all"]);
  assert.throws(() => stopCase(m5.resolveIntent));
  assert.throws(() => confirmCase(m5.resolveIntent));
  // MUT-7 (D2 review): no condition-head gate — „Ok, citește fișierul doar dacă trec testele” is read as the tests again.
  const m7 = await mutatedResolver((src) => src.replace("    if (held && ACK_REQUESTS.has(held)) return alt;\n", ""));
  assert.deepEqual(intents(m7.resolveIntent("Ok, citește fișierul doar dacă trec testele", ctx)), ["show_tests"]);
  assert.throws(() => conditionCase(m7.resolveIntent));
  assert.throws(() => parityCase(m7.resolveIntent));
  // Adding the consent word „da” to the acknowledgements would change what „Da, fă …” means.
  const m6 = await mutatedResolver((src) => src.replace("const ACK_LEAD = /^(?:(?:ok|okay|hai|haide|bine)", "const ACK_LEAD = /^(?:(?:ok|okay|hai|haide|bine|da)"));
  assert.throws(() => keepCase(m6.resolveIntent));
});
