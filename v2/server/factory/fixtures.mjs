import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TEST_PROJECT_MARKER } from "../domain/projects.mjs";
import { plannedTestRefs } from "./test-first.mjs";
import { BOOKING_DEMO } from "./booking-demo-def.mjs";

/**
 * Software Factory demo fixtures (M03 §25–§27): small projects with fictive data and no network, kept in v2/fixtures/factory.
 * A copy becomes a sanitized TEST project (marker file, direct child of the projects root) that the Hub can register.
 * The server never creates one outside test mode: for live validation the owner runs v2/scripts/create-factory-fixture.mjs.
 */
export const FIXTURE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "fixtures", "factory");

/**
 * M11 L5 (design .ifrim/M11_L5_DESIGN.md §10, the pilot): Demo A's defect with NO acceptance test in the project, only the passing
 * test/unit.test.mjs. The plan's step 0 is the Hub writing the test from the owner's words (Claude proposes it read-only, the Hub
 * proves twice that it fails today for the right reason, Codex reviews it read-only, then the Hub protects it). One test criterion
 * only: a "nothing else broke" criterion passes today by definition, which the proof would rightly call PARTIAL; on a BUGFIX the
 * author's control case per criterion (a valid request stays accepted) covers it, and the unit tests run as checks.
 */
const BUG_TEST_FIRST = Object.freeze({
  workType: "BUGFIX",
  title: "Numele din spații trebuie refuzat",
  objective: "validateRequest acceptă un nume format doar din spații. Găsește cauza și repară minim; o solicitare validă rămâne acceptată.",
});

/** The test-first spec of the variant: the Hub-written test's paths come from plannedTestRefs (deterministic per project id). */
function bugTestFirstSpec(projectId = "") {
  const refs = plannedTestRefs({ projectId, ...BUG_TEST_FIRST });
  if (!refs.ok) throw new Error(refs.problem);
  return {
    inScope: ["src/requests.js"], outOfScope: ["alte câmpuri", "dependențe noi"],
    acceptance: [
      { id: "AC-1", text: "Un nume format doar din spații este refuzat cu mesajul „Numele este obligatoriu”, iar o solicitare validă rămâne acceptată", verify: "test", testRef: refs.testRef },
      { id: "AC-2", text: "Cauza și fixul sunt explicate și revizuite independent", verify: "review" },
    ],
    constraints: ["Fix minim", "Fără dependențe noi"], risks: ["Normalizarea poate schimba alte câmpuri"],
    verification: { checks: ["node --test"], acceptance: [`node --test ${refs.testRef}`] },
    authoring: { mode: "hub", testRef: refs.testRef, stagingRef: refs.stagingRef, criteria: ["AC-1"], reauthorMax: 1, proofRuns: 2, controls: "bugfix", author: "claude", testReviewer: "codex" },
    sources: { user: ["Un nume din spații trece de validare."], code: [{ ref: "src/requests.js", note: "name nu e curățat înainte de verificare" }], assumptions: ["Mesajul de eroare rămâne același"] },
  };
}

/**
 * The demos, with the spec the owner approves (acceptance tests already in the fixture, so they can be protected). A demo with
 * `base` is materialized from that fixture without the `omit` files, then its own folder (`overlay`) is copied over it.
 */
export const FACTORY_DEMOS = Object.freeze({
  "bug-demo": {
    name: "Factory Demo A (bug)", stack: "Node.js (node:test)", workType: "BUGFIX",
    title: "Numele din spații trebuie refuzat",
    objective: "validateRequest acceptă un nume format doar din spații. Reproduce, găsește cauza, adaugă un test de regresie și repară minim.",
    spec: {
      inScope: ["src/requests.js", "teste noi de regresie"], outOfScope: ["alte câmpuri", "dependențe noi"],
      acceptance: [
        { id: "AC-1", text: "Un nume format doar din spații este refuzat cu mesajul „Numele este obligatoriu”", verify: "test", testRef: "test/acceptance.test.mjs", expectFailure: "nume obligatoriu" },
        { id: "AC-2", text: "O solicitare validă rămâne acceptată (fără regresii)", verify: "test", testRef: "test/acceptance.test.mjs" },
        { id: "AC-3", text: "Cauza și fixul sunt explicate și revizuite independent", verify: "review" },
      ],
      constraints: ["Fix minim", "Fără dependențe noi"], risks: ["Normalizarea poate schimba alte câmpuri"],
      verification: { checks: ["node --test"], acceptance: ["node --test test/acceptance.test.mjs"] },
      sources: { user: ["Un nume din spații trece de validare."], code: [{ ref: "src/requests.js", note: "name nu e curățat înainte de verificare" }], assumptions: ["Mesajul de eroare rămâne același"] },
    },
  },
  "service-request": {
    name: "Factory Demo B (feature)", stack: "Node.js (node:http, node:sqlite, node:test)", workType: "FEATURE",
    title: "Solicitare serviciu: formular + endpoint + bază de test",
    objective: "Formular „Solicitare serviciu” cu endpoint local POST/GET /api/requests: validare, persistare în baza de test node:sqlite, prevenirea dublării și listă, utilizabil pe mobil.",
    spec: {
      inScope: ["src/server-app.js", "public/index.html", "teste noi"], outOfScope: ["e-mail, SMS, autentificare", "servicii cloud", "dependențe npm noi"],
      acceptance: [
        { id: "AC-1", text: "O solicitare validă se salvează (201) și apare în listă", verify: "test", testRef: "test/acceptance.test.mjs" },
        { id: "AC-2", text: "Datele invalide sunt refuzate (400) cu erori pe câmpuri", verify: "test", testRef: "test/acceptance.test.mjs" },
        { id: "AC-3", text: "Aceeași solicitare trimisă din nou în 10 minute este refuzată (409)", verify: "test", testRef: "test/acceptance.test.mjs" },
        { id: "AC-4", text: "Solicitările rămân salvate după repornire", verify: "test", testRef: "test/acceptance.test.mjs" },
        { id: "AC-5", text: "Formularul are stările loading/error/success, previne dublul click și e utilizabil pe mobil", verify: "test", testRef: "test/acceptance.test.mjs" },
        { id: "AC-6", text: "Preview local pornit din versiunea verificată", verify: "preview" },
        { id: "AC-7", text: "Fluxul complet în browser, pe mobil (E2E): trimitere validă → succes și listă; trimitere goală → erori", verify: "e2e", steps: [
          { viewport: { width: 390, height: 844 } }, { goto: "/" }, { noHorizontalOverflow: true },
          { fill: { selector: "input[name=\"name\"]", value: "Ana Test" } }, { fill: { selector: "input[name=\"email\"]", value: "ana.test@example.ro" } },
          { select: { selector: "select[name=\"service\"]", value: "audit" } }, { fill: { selector: "textarea[name=\"message\"]", value: "Solicitare de test E2E (fictivă) {run}" } },
          { click: "button[type=\"submit\"]" }, { expectText: "Solicitarea a fost trimisă." }, { expectSelector: "#list li" },
          { click: "button[type=\"submit\"]" }, { expectText: "Corectează câmpurile marcate." },
        ] },
      ],
      constraints: ["Doar node:sqlite (inclus în Node)", "Fără date reale"],
      verification: { checks: ["node --test"], acceptance: ["node --test test/acceptance.test.mjs"], preview: { command: "node server.js", url: "http://127.0.0.1:4610/" } },
      workspace: { ignore: ["data"] },
      sources: { user: ["Formular de solicitare cu listă și protecție la dubluri."], code: [{ ref: "src/server-app.js", note: "API-ul răspunde 501 (schelet)" }], assumptions: ["Fereastra de deduplicare: 10 minute"] },
    },
  },
  "bug-demo-test-first": {
    name: "Factory Demo A (test scris de Hub)", stack: "Node.js (node:test)", ...BUG_TEST_FIRST,
    base: "bug-demo", omit: Object.freeze(["test/acceptance.test.mjs"]), overlay: "bug-demo-test-first", testFirst: true,
    // With an empty project id; demoSpec(name, { projectId }) derives the paths of the registered project through specFor.
    spec: bugTestFirstSpec(""), specFor: bugTestFirstSpec,
  },
  // M11 „Ifrim Delivery”: the synthetic appointments app of a fictive detailing workshop (booking-demo-def.mjs documents the shape).
  "booking-demo": BOOKING_DEMO,
});

/** Copies a fixture into `targetDir` (must not exist) and writes the test-project marker. Returns the marker data. */
export function materializeFixture(name, targetDir, { port = null } = {}) {
  const demo = FACTORY_DEMOS[name];
  if (!demo) throw new Error(`Unknown factory fixture ${name}`);
  if (fs.existsSync(targetDir)) throw new Error(`${targetDir} already exists; a fixture never overwrites a folder`);
  const source = path.join(FIXTURE_ROOT, demo.base || name);
  const omit = new Set((demo.omit || []).map((rel) => rel.toLowerCase()));
  // A variant leaves out files of its base (e.g. the acceptance test the Hub will write itself); the copy never sees them.
  const keep = (src) => !omit.has(path.relative(source, src).split(path.sep).join("/").toLowerCase());
  fs.cpSync(source, targetDir, { recursive: true, errorOnExist: true, filter: keep });
  if (demo.overlay) fs.cpSync(path.join(FIXTURE_ROOT, demo.overlay), targetDir, { recursive: true, force: true });
  if (port) fs.writeFileSync(path.join(targetDir, "config.json"), `${JSON.stringify({ port })}\n`);
  const marker = { createdBy: "ifrim-agent-hub", purpose: "live-validation", name: demo.name, stack: demo.stack, fixture: name, ...(demo.data ? { data: demo.data } : {}), createdAt: new Date().toISOString() };
  fs.writeFileSync(path.join(targetDir, TEST_PROJECT_MARKER), `${JSON.stringify(marker, null, 2)}\n`);
  return marker;
}

/**
 * The demo's spec input for factory.prepare (optionally with another preview port). A test-first demo takes the registered
 * project's id, because the Hub-written test's paths are derived from it (plannedTestRefs); without one they use an empty id.
 */
export function demoSpec(name, { port = null, projectId = null } = {}) {
  const demo = FACTORY_DEMOS[name];
  const spec = JSON.parse(JSON.stringify(demo.specFor && projectId ? demo.specFor(projectId) : demo.spec));
  if (port && spec.verification.preview) spec.verification.preview.url = `http://127.0.0.1:${port}/`;
  return { workType: demo.workType, title: demo.title, objective: demo.objective, spec };
}
