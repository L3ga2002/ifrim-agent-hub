import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TEST_PROJECT_MARKER } from "../domain/projects.mjs";

/**
 * Software Factory demo fixtures (M03 §25–§27): small projects with fictive data and no network, kept in v2/fixtures/factory.
 * A copy becomes a sanitized TEST project (marker file, direct child of the projects root) that the Hub can register.
 * The server never creates one outside test mode: for live validation the owner runs v2/scripts/create-factory-fixture.mjs.
 */
export const FIXTURE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "fixtures", "factory");

/** The demos, with the spec the owner approves (acceptance tests already in the fixture, so they can be protected). */
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
});

/** Copies a fixture into `targetDir` (must not exist) and writes the test-project marker. Returns the marker data. */
export function materializeFixture(name, targetDir, { port = null } = {}) {
  const demo = FACTORY_DEMOS[name];
  if (!demo) throw new Error(`Unknown factory fixture ${name}`);
  if (fs.existsSync(targetDir)) throw new Error(`${targetDir} already exists; a fixture never overwrites a folder`);
  fs.cpSync(path.join(FIXTURE_ROOT, name), targetDir, { recursive: true, errorOnExist: true });
  if (port) fs.writeFileSync(path.join(targetDir, "config.json"), `${JSON.stringify({ port })}\n`);
  const marker = { createdBy: "ifrim-agent-hub", purpose: "live-validation", name: demo.name, stack: demo.stack, fixture: name, createdAt: new Date().toISOString() };
  fs.writeFileSync(path.join(targetDir, TEST_PROJECT_MARKER), `${JSON.stringify(marker, null, 2)}\n`);
  return marker;
}

/** The demo's spec input for factory.prepare (optionally with another preview port). */
export function demoSpec(name, { port = null } = {}) {
  const demo = FACTORY_DEMOS[name];
  const spec = JSON.parse(JSON.stringify(demo.spec));
  if (port && spec.verification.preview) spec.verification.preview.url = `http://127.0.0.1:${port}/`;
  return { workType: demo.workType, title: demo.title, objective: demo.objective, spec };
}
