// Stage before M12 — closure of „Lega: autonomie și lucru pe PC” (2026-10-09 evening): criteria derived from a natural request, „păstrare”
// criteria in the Hub-written test, the browser checks of a required field, tolerant understanding of typos, the proposal window.
// Pure / local: no model, no network; one real Chromium run (skipped only when Playwright's browser is absent, and then said so).
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { deriveCriteria, requestShape, withField, withoutField } from "../server/owner/planners/criteria.mjs";
import { checkSpec } from "../server/factory/spec.mjs";
import { classifyProof, buildAuthorBrief, buildTestReviewBrief, testCriteriaOf, parseTestReview } from "../server/factory/test-first.mjs";
import { validateE2ESteps, runE2ESteps } from "../server/tools/browser-core.mjs";
import { captureScriptFrom } from "../server/delivery/template.mjs";
import { correctTypos, osaDistance, NEVER_TARGET } from "../server/owner/typos.mjs";
import { resolveIntent } from "../server/owner/intents.mjs";
import { proposalWindowMin, PROPOSAL_WINDOW } from "../server/policy/proposal-window.mjs";

const FLOW = (width) => [{ viewport: { width, height: width < 500 ? 844 : 800 } }, { goto: "/" }, { noHorizontalOverflow: true }, { click: "label[data-service='spalare-exterior']" },
  { click: "button[data-day='1']" }, { expectSelector: ".slot[data-booked='true'][aria-disabled='true']" }, { click: ".slot[data-booked='false'][aria-disabled='false']" },
  { fill: { selector: "input[name='name']", value: "Client Demo {run}" } }, { fill: { selector: "input[name='vehicle']", value: "Autoturism test" } }, { click: "button[type='submit']" }, { expectText: "Programare confirmată" }];
const FLOWS = [{ id: "AC-3", text: "Fluxul pe telefon", verify: "e2e", steps: FLOW(390) }, { id: "AC-4", text: "Fluxul pe desktop", verify: "e2e", steps: FLOW(1280) }];
const PHONE = "Butonul de programare trebuie să ceară și numărul de telefon";

test("FZ-01 the §25 sentence derives the six checks the owner listed, with provenance and no invented rule", () => {
  const d = deriveCriteria({ words: PHONE, flows: FLOWS });
  assert.equal(d.shape, "required_field");
  // 3 server-side checks (direct call refused, value kept, valid booking still accepted = guard)
  assert.equal(d.test.length, 3);
  assert.match(d.test[0].text, /direct, fără browser.*fără telefon sau cu telefon gol/);
  assert.match(d.test[1].text, /se păstrează/);
  assert.equal(d.test[2].guard, true);
  // the existing flows keep working, with the labelled field filled before the submit
  assert.equal(d.flows.length, 2);
  for (const f of d.flows) {
    const kinds = f.steps.map((s) => Object.keys(s)[0]);
    assert.deepEqual(kinds.slice(-4), ["expectLabel", "fill", "click", "expectText"]);
    assert.deepEqual(validateE2ESteps(f.steps), []);
  }
  // the browser negative case: the field is invalid with a visible message and the confirmation never shows
  assert.equal(d.browser.length, 1);
  assert.deepEqual(d.browser[0].steps.slice(-2), [{ expectInvalid: "[name='phone']" }, { expectNoText: "Programare confirmată" }]);
  assert.ok(d.browser[0].steps.some((s) => s.viewport?.width === 1280), "the negative case starts from the desktop flow");
  assert.ok([...d.test, ...d.browser].every((c) => c.origin && c.origin.length > 5));
  assert.ok(d.assumptions.some((a) => /Fără reguli noi nespuse/.test(a)));
  assert.ok(!JSON.stringify(d).match(/SMS obligatoriu|\+40|07\\d\{8\}/));
});

test("FZ-02 the mechanism is general: other fields, other entities, the refuse shape, and unrelated sentences stay generic", () => {
  assert.equal(requestShape("Adaugă câmpul email obligatoriu la rezervare").field.key, "email");
  assert.equal(requestShape("Emailul să fie obligatoriu la comandă").shape, "required_field");
  assert.equal(requestShape("Formularul de înscriere să conțină și numărul de înmatriculare").field.key, "plate");
  assert.equal(requestShape("Formularul de contact să nu accepte mesaje goale").shape, "refuse");
  assert.equal(requestShape("Pagina să aibă un design nou").shape, "generic");
  assert.equal(requestShape("Repară butonul de login").shape, "generic");
  const refuse = deriveCriteria({ words: "Formularul de contact să nu accepte mesaje goale" });
  assert.equal(refuse.test.length, 2);
  assert.equal(refuse.test[1].guard, true);
  assert.equal(deriveCriteria({ words: "Repară butonul de login" }).test.length, 0);
  // without an approved browser flow the form part is a test criterion against the served page
  const noFlow = deriveCriteria({ words: PHONE });
  assert.equal(noFlow.browser.length, 0);
  assert.match(noFlow.test[0].text, /Pagina aplicației are în formularul programării câmpul Telefon/);
});

test("FZ-03 the derived spec passes checkSpec; guard and origin survive normalization; a guard alone is refused", () => {
  const d = deriveCriteria({ words: PHONE, flows: FLOWS });
  const testRef = "test/hub/butonul-de-programare-abc123.test.mjs";
  const acceptance = [...d.test.map((c, i) => ({ id: `AC-${i + 1}`, text: c.text, verify: "test", testRef, ...(c.guard ? { guard: true } : {}), origin: c.origin }))];
  acceptance.push({ id: `AC-${acceptance.length + 1}`, text: "Preview local pornit din versiunea verificată", verify: "preview" });
  for (const c of [...d.flows, ...d.browser]) acceptance.push({ ...c, id: `AC-${acceptance.length + 1}` });
  acceptance.push({ id: `AC-${acceptance.length + 1}`, text: "Modificarea e explicată și revizuită independent (doar citire)", verify: "review" });
  const input = { workType: "FEATURE", title: "Telefon la programare", objective: PHONE, inScope: [], outOfScope: ["deploy"], acceptance, constraints: [],
    verification: { checks: ["node --test"], acceptance: [`node --test ${testRef}`], preview: { command: "node server.js", url: "http://127.0.0.1:4620/" } },
    authoring: { mode: "hub", testRef, stagingRef: ".ifrim-hub/staging/butonul-de-programare-abc123.mjs", criteria: ["AC-1", "AC-2", "AC-3"] } };
  const { spec, problems } = checkSpec(input);
  assert.deepEqual(problems, []);
  assert.equal(spec.acceptance[2].guard, true);
  assert.ok(spec.acceptance[0].origin);
  assert.deepEqual(testCriteriaOf(spec.acceptance).map((c) => Boolean(c.guard)), [false, false, true]);
  const onlyGuard = checkSpec({ ...input, acceptance: [{ id: "AC-1", text: "O programare validă e acceptată", verify: "test", testRef, guard: true }], authoring: { ...input.authoring, criteria: ["AC-1"] } });
  assert.ok(onlyGuard.problems.some((p) => /păstrare/.test(p)));
});

const run = (cases) => ({ status: cases.some((c) => !c.ok) ? "FAIL" : "PASS", counts: { tests: cases.length, pass: cases.filter((c) => c.ok).length, fail: cases.filter((c) => !c.ok).length, skipped: 0, todo: 0, cancelled: 0 }, cases });
const criteria = [{ id: "AC-1", text: "refuz direct", verify: "test" }, { id: "AC-2", text: "păstrat", verify: "test" }, { id: "AC-3", text: "valid acceptat", verify: "test", guard: true }];
const manifest = { cases: [{ name: "AC-1: fara telefon refuzat", criterion: "AC-1", kind: "check", today: "fail" }, { name: "AC-2: telefon pastrat", criterion: "AC-2", kind: "check", today: "fail" },
  { name: "AC-3 control: programare valida acceptata", criterion: "AC-3", kind: "control", today: "pass" }] };
const fail = (name) => ({ name, ok: false, code: "ERR_ASSERTION", message: "expected 400" });

test("FZ-04 proof: a guard criterion is a control that passes today; the missing behaviour must fail; a failing control is the wrong reason", () => {
  const today = [fail("AC-1: fara telefon refuzat"), fail("AC-2: telefon pastrat"), { name: "AC-3 control: programare valida acceptata", ok: true }];
  const proven = classifyProof({ runs: [run(today), run(today)], manifest, criteria, workType: "FEATURE" });
  assert.equal(proven.verdict, "PROVEN");
  assert.deepEqual(proven.failingCriteria, ["AC-1", "AC-2"]);
  assert.match(proven.reasons[0], /păstrare: AC-3/);
  // part of the requirement already holds (AC-2 passes today): still PARTIAL — the gate is not lowered
  const partial = [fail("AC-1: fara telefon refuzat"), { name: "AC-2: telefon pastrat", ok: true }, { name: "AC-3 control: programare valida acceptata", ok: true }];
  assert.equal(classifyProof({ runs: [run(partial), run(partial)], manifest, criteria, workType: "FEATURE" }).verdict, "PARTIAL");
  // the control fails today (the test breaks a valid booking): WRONG_REASON
  const broken = [fail("AC-1: fara telefon refuzat"), fail("AC-2: telefon pastrat"), fail("AC-3 control: programare valida acceptata")];
  assert.equal(classifyProof({ runs: [run(broken), run(broken)], manifest, criteria, workType: "FEATURE" }).cause, "control_fails");
});

test("FZ-05 the author and the reviewer see the guard and the browser checks as context, never as test work", () => {
  const spec = { workType: "FEATURE", title: "T", objective: PHONE, sources: { user: [PHONE] }, acceptance: [...criteria.map((c) => ({ ...c, testRef: "test/hub/x.test.mjs" })), { id: "AC-4", text: "Formularul în browser", verify: "e2e", steps: [] }] };
  const brief = buildAuthorBrief({ mission: { id: "m", title: "T" }, spec, authoring: { testRef: "test/hub/x.test.mjs" } });
  assert.match(brief, /AC-3 \(păstrare: trece azi și trebuie să treacă și după\)/);
  assert.match(brief, /Verificate separat în browser de Hub[\s\S]*AC-4: Formularul în browser/);
  assert.match(brief, /"name": "AC-3 control: …"/);
  const review = buildTestReviewBrief({ mission: { title: "T" }, spec, testRef: "test/hub/x.test.mjs", testSha: "a".repeat(64), testText: "test()", manifest: { api: "POST /api/bookings" }, proof: {}, lint: {} });
  assert.match(review, /- AC-3 \(păstrare\)/);
  assert.match(review, /NU sunt ale acestui test/);
  // the gate is unchanged: a high trivial-pass risk on any criterion is still CHANGES_REQUESTED
  const answer = (risk) => `\`\`\`json\n${JSON.stringify({ changeSet: "a".repeat(12), verdict: "PASS", summary: "ok.", criteria: criteria.map((c) => ({ id: c.id, covered: true, failsForRightReason: true, canEverPass: true, contradictsOwner: false, trivialPassRisk: c.id === "AC-1" ? risk : "low", plain: "Testul verifică acest criteriu bine." })), findings: [], missingContext: [] })}\n\`\`\``;
  assert.equal(parseTestReview(answer("low"), { testSha: "a".repeat(64), criteria }).verdict, "PASS");
  assert.equal(parseTestReview(answer("high"), { testSha: "a".repeat(64), criteria }).verdict, "CHANGES_REQUESTED");
});

test("FZ-06 the new E2E steps validate and become capture steps (the label is shown; the checks are dropped)", () => {
  const d = deriveCriteria({ words: PHONE, flows: FLOWS });
  assert.deepEqual(validateE2ESteps([{ goto: "/" }, { expectLabel: { selector: "x", text: "" } }]).length, 1);
  assert.deepEqual(validateE2ESteps([{ goto: "/" }, { expectInvalid: "" }]).length, 1);
  const script = captureScriptFrom(d.flows[1].steps, { noun: "programare", role: "desktop", proofSelector: "[data-state='success']" });
  assert.equal(script.ok, true, JSON.stringify(script.blockers));
  assert.ok(script.steps.some((s) => s.type?.selector === "[name='phone']" && s.type.text === "0700 123 456"));
  assert.ok(script.steps.some((s) => s.highlight?.selector === "[name='phone']"));
  const neg = captureScriptFrom(d.browser[0].steps, { noun: "programare", role: "desktop", proofSelector: "[data-state='success']" });
  assert.ok(!JSON.stringify(neg.steps).includes("expectInvalid"));
});

/** A tiny booking form in four variants: the right one and three wrong ones the browser checks must reject. */
function page(variant) {
  const phoneField = variant === "nofield" ? "" : `<div><label for="f-phone">Telefon</label><input id="f-phone" name="phone" aria-describedby="err-phone"><p id="err-phone"></p></div>`;
  const check = variant === "right" || variant === "browser-only"
    ? `const p=document.querySelector('[name=phone]'); if(!p.value.trim()){p.setAttribute('aria-invalid','true');document.getElementById('err-phone').textContent='Telefonul este obligatoriu';return;}`
    : variant === "silent" ? `const p=document.querySelector('[name=phone]'); if(!p.value.trim()){p.setAttribute('aria-invalid','true');return;}` : "";
  return `<!doctype html><meta charset="utf-8"><title>t</title><form id="f" novalidate><label for="f-name">Nume</label><input id="f-name" name="name">${phoneField}
<button type="submit">Confirmă</button><p id="status"></p></form><script>document.getElementById('f').addEventListener('submit',(e)=>{e.preventDefault();${check}document.getElementById('status').textContent='Programare confirmată';});</script>`;
}

test("FZ-07 real Chromium: the derived browser checks pass the right form and reject the field-less, the silent and the always-confirming ones", async (t) => {
  let chromium;
  try { ({ chromium } = await import("playwright")); } catch { t.skip("SKIPPED_ENV: playwright lipsește"); return; }
  let variant = "right";
  const server = http.createServer((req, res) => { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end(page(variant)); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const field = { key: "phone", label: "Telefon", value: "0700 123 456" };
  const flow = [{ goto: "/" }, { fill: { selector: "input[name='name']", value: "Client {run}" } }, { click: "button[type='submit']" }, { expectText: "Programare confirmată" }];
  const positive = withField(flow, field);
  const negative = withoutField(flow, field);
  const launch = () => chromium.launch({ headless: true });
  const go = async (steps, v) => { variant = v; return (await runE2ESteps({ base, steps, launch, id: `fz07_${v}`, stepTimeoutMs: 4000 })).status; };
  try {
    await launch().then((b) => b.close());
  } catch (error) { server.close(); t.skip(`SKIPPED_ENV: Chromium nu pornește (${String(error.message).split("\n")[0].slice(0, 120)})`); return; }
  try {
    assert.equal(await go(positive, "right"), "PASS");
    assert.equal(await go(negative, "right"), "PASS");
    assert.equal(await go(positive, "nofield"), "FAIL", "no labelled field");
    assert.equal(await go(negative, "silent"), "FAIL", "invalid without a visible message");
    assert.equal(await go(negative, "always"), "FAIL", "the confirmation shows without the phone");
  } finally { server.close(); }
});

test("FZ-08 typos: a missing, swapped or extra letter is corrected and recorded; never into a stop, a confirmation, a negation or a publication", () => {
  assert.equal(osaDistance("prgeateste", "pregateste"), 1);
  const r = correctTypos("regateste prezentarea demo-ului cu ward si exel");
  assert.equal(r.text, "pregateste prezentarea demo-ului cu word si excel");
  assert.deepEqual(r.corrections.map((c) => c.to), ["pregateste", "word", "excel"]);
  for (const w of ["opreste", "confirma", "publica", "sterge", "nu", "fara"]) assert.ok(NEVER_TARGET.has(w));
  assert.equal(correctTypos("oprste tot").text, "oprste tot");
  assert.deepEqual(correctTypos("oprste tot").suspects, [{ from: "oprste", to: "opreste" }]);
  assert.equal(correctTypos("e deschis proiectul").text, "e deschis proiectul");
  assert.equal(correctTypos("pregateste prezentarea ifrimdelivery", { protect: ["ifrimdelivry"] }).text, "pregateste prezentarea ifrimdelivery");
});

test("FZ-09 Lega: the owner's examples resolve to the same structured intent, keep negations and never run a question about Stop", () => {
  const full = (verb) => `${verb} prezentarea demo-ului de detailing: verifică site-ul, fă un document Word, un Excel cu date demonstrative, un clip vertical și un pachet de campanie. Salvează totul într-un singur dosar.`;
  for (const v of ["regătește", "Pregătește", "pregateste", "pregăteste", "pregtește", "PREGĂTEȘTE"]) {
    const r = resolveIntent(full(v), { projects: [] });
    assert.equal(r.steps[0].intent, "delivery_prepare", v);
  }
  assert.equal(resolveIntent("fă prezentarea demo-ului, cu Word, Excel și clip", {}).steps[0].intent, "delivery_prepare");
  assert.equal(resolveIntent("pregătește prezentarea, fără Excel", {}).steps[0].intent, "delivery_prepare");
  assert.equal(resolveIntent("regătește prezentarea demo-ului", {}).corrections[0].from, "regateste");
  assert.equal(resolveIntent("nu publica nimic", {}).steps[0].constraints.noPublish, true);
  const notYet = resolveIntent("nu porni încă, arată-mi planul", {});
  assert.equal(notYet.steps[0].constraints.noStart, true);
  assert.ok(!notYet.steps.some((s) => ["start_mission", "confirm"].includes(s.intent)));
  for (const q of ["ce urmează după Oprește tot?", "Ce urmează după Stop All?", "Ce s-a oprit după Stop All"]) assert.ok(!resolveIntent(q, {}).steps.some((s) => s.intent === "stop_all"), q);
  assert.equal(resolveIntent("Oprește tot", {}).steps[0].intent, "stop_all");
  const slip = resolveIntent("oprște tot", {});
  assert.ok(!slip.steps.some((s) => s.intent === "stop_all"));
  assert.match(slip.clarification.question, /Ai vrut să spui „opreste”/);
});

test("FZ-10 the proposal window: 24 h in the local development profile, 15 min otherwise, the owner's explicit setting wins (bounded)", () => {
  const settings = (v) => ({ get: (k) => (k === "proposalWindowMin" ? v : undefined) });
  const trust = (enabled) => ({ devProfile: () => ({ enabled }) });
  assert.equal(proposalWindowMin({ settings: settings(undefined), trust: trust(true) }), PROPOSAL_WINDOW.devProfileMin);
  assert.equal(proposalWindowMin({ settings: settings(undefined), trust: trust(false) }), 15);
  assert.equal(proposalWindowMin({ settings: settings(120), trust: trust(false) }), 120);
  assert.equal(proposalWindowMin({ settings: settings(99999), trust: trust(false) }), 15);
});

test("FZ-11 a delivery derived from an envelope may run its Word / Excel checks; a refused start is retried once (NEEDS_OWNER → ARMED)", async () => {
  const { DELIVERY_PHASE_OPS } = await import("../server/delivery/delivery.mjs");
  const { canTransition } = await import("../server/delivery/stale.mjs");
  assert.ok(DELIVERY_PHASE_OPS.includes("office.verify"));
  assert.ok(canTransition("NEEDS_OWNER", "ARMED"));
  assert.ok(!canTransition("CANCELLED", "ARMED"));
});
