/**
 * Software Factory demo fixture "booking-demo" (M11 „Ifrim Delivery”): a synthetic appointments app for a fictive detailing
 * workshop, kept in v2/fixtures/factory/booking-demo. The agreed problem is visible only on a phone width: booked slots look
 * free. The protected acceptance test already exists in the fixture and fails at baseline for exactly that reason (AC-1).
 *
 * This file has no imports and no side effects. It is registered as FACTORY_DEMOS["booking-demo"] in fixtures.mjs (with the
 * marker field data: "synthetic") and mapped in v2/scripts/create-factory-fixture.mjs (dirName, checkFile) after the M10.2
 * probe; until then nothing in the Hub imports it.
 *
 * Shape: the keys of a FACTORY_DEMOS entry (name, stack, workType, title, objective, spec — the input of factory.prepare,
 * valid for factory/spec.mjs checkSpec) plus:
 *   key, dirName, checkFile   the fixture folder, the project folder under PROJECTS_ROOT and the file the script syntax-checks
 *   data, port                the marker's data kind and the preview port of config.json (also in spec.verification.preview.url)
 *   limits                    mission limits for factory.prepare; the models are the pilot's (intel/packages.mjs PILOT_MODELS)
 *   delivery                  Hub-side presentation block. It is NOT part of the spec, so it never changes the spec hash:
 *     noun            the domain noun of the capture markers („programare desktop”, „programare mobil”)
 *     issue           the owner-facing title of the agreed problem
 *     proofSelector   visible only after a confirmed booking (the capture's proof marker)
 *     bannerSelector  the synthetic-data banner every page of the fixture shows (the capture's page guard requires it)
 *     evidenceNote    the note of the clip's evidence marker (what the highlighted booked slot proves)
 *     exportPrefix    the head of the local export folder: <exportPrefix>-<project slug>-<yyyymmdd>
 *     texts           per clip slot (hook, desktop, mobile, cta): { criteria, business, technical }. A slot's text is used
 *                     only when all its criteria are PASS; `business` and `technical` are the two tones. A text names only
 *                     criteria of its own list (the hook is gated on AC-1 alone, so it cites AC-1 alone): a criterion it is
 *                     not gated on could be NOT PASS while the text is on screen.
 *     variant         the vertical variant: platformKey and overrides { hookText, ctaText } (shorter texts for 9:16)
 * The block is read through delivery/template.mjs normalizeDeliveryBlock, which documents the same shape.
 */
const freeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};

const PREVIEW_PORT = 4620;
const ACCEPTANCE_TEST = "test/acceptance.test.mjs";

/** The approved browser flow (AC-6 on a phone width, AC-7 on desktop): the same steps, only the viewport differs. */
const bookingFlow = (viewport) => [
  { viewport },
  { goto: "/" },
  { noHorizontalOverflow: true },
  { click: "label[data-service='spalare-exterior']" },
  { click: "button[data-day='1']" },
  { expectSelector: ".slot[data-booked='true'][aria-disabled='true']" },
  { click: ".slot[data-booked='false'][aria-disabled='false']" },
  { fill: { selector: "input[name='name']", value: "Client Demo {run}" } },
  { fill: { selector: "input[name='vehicle']", value: "Autoturism test" } },
  { click: "button[type='submit']" },
  { expectText: "Programare confirmată" },
];

export const BOOKING_DEMO = freeze({
  key: "booking-demo",
  name: "Demo Livrare — Detailing (programări)",
  dirName: "ifrim-delivery-demo-detailing",
  checkFile: "src/server-app.js",
  stack: "Node.js (node:http, node:sqlite, node:test)",
  data: "synthetic",
  port: PREVIEW_PORT,
  workType: "BUGFIX",
  title: "Pe telefon, intervalele ocupate apar libere",
  objective: "Pe lățimea unui telefon (390 px), grila de programări arată intervalele ocupate ca libere: pot fi alese, iar la confirmare serverul refuză. Pe desktop afișarea este corectă. Reproduce, găsește cauza și repară minim afișarea de pe telefon, fără să schimbi afișarea de pe desktop sau API-ul.",
  spec: {
    inScope: ["public/js/slots-view.mjs", "public/styles.css (doar dacă este necesar)", "teste noi de regresie"],
    outOfScope: ["API-ul și serverul (src/)", "date reale", "autentificare, plăți, SMS, e-mail", "dependențe noi"],
    acceptance: [
      { id: "AC-1", text: "Pe telefon un interval ocupat apare indisponibil și nu poate fi ales", verify: "test", testRef: ACCEPTANCE_TEST, expectFailure: "interval_ocupat_liber_pe_mobil" },
      { id: "AC-2", text: "Pe desktop afișarea intervalelor rămâne aceeași", verify: "test", testRef: ACCEPTANCE_TEST },
      { id: "AC-3", text: "API: 201 + listă + persistență după repornire; 409 pe interval ocupat; 400 pe interval trecut / date invalide", verify: "test", testRef: ACCEPTANCE_TEST },
      { id: "AC-4", text: "Cauza și fixul sunt explicate și revizuite independent", verify: "review" },
      { id: "AC-5", text: "Preview local pornit din versiunea verificată", verify: "preview" },
      { id: "AC-6", text: "Fluxul complet în browser la lățimea unui telefon (390 px în Chromium): fără derulare orizontală, un interval ocupat este indisponibil, un interval liber se programează cu succes", verify: "e2e", steps: bookingFlow({ width: 390, height: 844 }) },
      { id: "AC-7", text: "Același flux în browser pe desktop (1280×800): un interval ocupat este indisponibil, un interval liber se programează cu succes", verify: "e2e", steps: bookingFlow({ width: 1280, height: 800 }) },
    ],
    constraints: ["Fix minim", "Fără dependențe noi", "Doar date sintetice"],
    risks: ["O corecție care atinge ramura de desktop poate schimba afișarea de acolo"],
    verification: { checks: ["node --test"], acceptance: [`node --test ${ACCEPTANCE_TEST}`], preview: { command: "node server.js", url: `http://127.0.0.1:${PREVIEW_PORT}/` } },
    workspace: { ignore: ["data"] },
    sources: {
      user: ["Pe telefon, intervalele ocupate apar libere."],
      code: [{ ref: "public/js/slots-view.mjs", note: "pe telefon, disponibilitatea unui interval se decide altfel decât pe desktop" }],
      assumptions: ["„Telefon” înseamnă lățimea de 390 px în Chromium, fără emularea unui dispozitiv", "Afișarea de pe desktop este cea corectă"],
    },
  },
  limits: { maxDurationMin: 60, maxRepairCycles: 2 },
  delivery: {
    noun: "programare",
    issue: "Pe telefon, intervalele ocupate apar libere",
    proofSelector: "[data-state='success']",
    bannerSelector: "[data-demo-banner]",
    evidenceNote: "interval ocupat pe telefon",
    exportPrefix: "demo-programari",
    texts: {
      hook: { criteria: ["AC-1"], business: "Programări online pentru detailing — demo", technical: "Fix verificat: intervalele ocupate pe telefon (AC-1)" },
      desktop: { criteria: ["AC-7"], business: "Clientul alege serviciul și ora", technical: "E2E desktop 1280×800: PASS" },
      mobile: { criteria: ["AC-1", "AC-6"], business: "Pe telefon, orele ocupate nu mai pot fi alese", technical: "AC-1 + AC-6: interval ocupat → indisponibil (390 px)" },
      cta: { criteria: [], business: "Hai să discutăm", technical: "Pachet local, gata de verificare" },
    },
    variant: { platformKey: "shorts_9x16", overrides: { hookText: "Programări online — demo", ctaText: "Hai să vorbim" } },
    // The commercial summary's template text (delivery/summary.mjs): shown only when its criteria passed; no price, result or deadline.
    summary: {
      problem: "Clienții care programează de pe telefon pot alege ore deja ocupate; programarea pică abia la confirmare.",
      how: { criteria: ["AC-6", "AC-7"], lines: ["Clientul alege serviciul, ziua și o oră liberă.", "Completează numele și mașina.", "Primește confirmarea programării pe loc.", "Orele ocupate apar indisponibile și nu pot fi alese, nici pe telefon."] },
      benefits: [
        { text: "Pe telefon, clientul vede doar orele pe care le poate rezerva.", criteria: ["AC-1", "AC-6"] },
        { text: "Aceeași programare funcționează și pe desktop.", criteria: ["AC-2", "AC-7"] },
        { text: "O oră ocupată nu poate fi rezervată a doua oară.", criteria: ["AC-3"] },
      ],
      questions: ["Cum primiți acum programările (telefon, mesaje, alt sistem)?", "Ce servicii și ce durate ar trebui să apară în listă?", "Cine confirmă programările și cum vreți să fiți anunțat?", "De pe ce dispozitive programează clienții dumneavoastră?"],
    },
  },
});
