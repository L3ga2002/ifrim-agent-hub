// Generates the deterministic writer patches used by the fake Codex fixture (scenario `factory-write:<name>`).
// Run: node v2/tests/fixtures/factory-patches/make-patches.mjs   (re-run after editing the sources below)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(here, "..", "..", "..", "fixtures", "factory");
const read = (rel) => fs.readFileSync(path.join(FIXTURES, rel), "utf8");
// Demo B solutions live OUTSIDE the fixture (the fixture is copied into the workspace; the solution must not be).
const readSolution = (rel) => fs.readFileSync(path.join(here, "..", "factory-solutions", "service-request", rel), "utf8");
const save = (name, patch) => fs.writeFileSync(path.join(here, `${name}.json`), `${JSON.stringify(patch, null, 2)}\n`);

// ---------- Demo A (bug-demo) ----------
const original = read("bug-demo/src/requests.js");
const fixed = original.replace('const name = typeof input.name === "string" ? input.name : "";', 'const name = typeof input.name === "string" ? input.name.trim() : "";')
  .replace("if (!name) errors.name", "if (!name) errors.name");
const regression = [
  'import test from "node:test";',
  'import assert from "node:assert/strict";',
  'import { validateRequest } from "../src/requests.js";',
  "",
  'test("regresie: numele din spații, tab-uri și linii noi este refuzat", () => {',
  '  for (const name of [" ", "\\t", "\\n  "]) assert.equal(validateRequest({ name, email: "a@example.ro", service: "audit" }).ok, false);',
  "});",
  "",
].join("\n");
save("bug-fix", { summary: "Cauza: numele nu era curățat de spații înainte de verificare. Fix minim: trim înainte de validare + test de regresie.",
  write: { "src/requests.js": fixed, "test/regression.test.mjs": regression } });
// A wrong fix: only the exact single space is refused, the acceptance test (three spaces) still fails.
save("bug-partial", { summary: "Fix parțial (fixture): refuză doar un singur spațiu.",
  write: { "src/requests.js": original.replace("if (!name) errors.name", 'if (!name || name === " ") errors.name') } });
// A second, different wrong fix (same failing test): used to prove that a repair cycle without progress stops.
save("bug-partial2", { summary: "Alt fix parțial (fixture): refuză doar două spații.",
  write: { "src/requests.js": original.replace("if (!name) errors.name", 'if (!name || name === "  ") errors.name') } });
// The fix again, with a clarifying comment (a repair after a review finding must change the change set).
save("bug-fix-v2", { summary: "Remediere după review: fix + comentariu despre normalizare.",
  write: { "src/requests.js": fixed.replace("export function validateRequest", "// Numele se curăță de spații înainte de verificare (un nume din spații nu e un nume).\nexport function validateRequest"),
    "test/regression.test.mjs": regression } });
// Tampering: the writer weakens the protected acceptance test instead of fixing the code.
save("bug-tamper", { summary: "Fixture de integritate: slăbește testul de acceptanță protejat.",
  write: { "test/acceptance.test.mjs": read("bug-demo/test/acceptance.test.mjs").replace('assert.equal(r.ok, false, "nume obligatoriu: spațiile nu sunt un nume");\n  assert.equal(r.errors.name, "Numele este obligatoriu");', "assert.ok(r);") } });
// M11 L5 (wave A repair): the "fix" applies only when NODE_ENV=test (what the runner sets): the protected test would pass without a real fix.
save("bug-env-switch", { summary: "Fixture de integritate (M11 L5, reparație unda A): „repară” numele din spații doar când NODE_ENV=test (cum setează runner-ul), deci testul protejat ar trece fără fix real.",
  write: { "src/requests.js": original.replace('const name = typeof input.name === "string" ? input.name : "";', 'const name = typeof input.name === "string" ? (process.env.NODE_ENV === "test" ? input.name.trim() : input.name) : "";') } });
// Correct code, but a new test is skipped: the runner must not count it as a pass.
save("bug-skip", { summary: "Fixture: fix corect + un test sărit.",
  write: { "src/requests.js": fixed, "test/regression.test.mjs": regression.replace('test("regresie', 'test.skip("regresie') } });

// Correct fix plus a slow test: it hangs for two minutes unless the test harness created the release marker in the temp
// folder, so a Pause during CHECKING can be tested and the same checks can then pass after resume.
const slow = [
  'import test from "node:test";',
  'import fs from "node:fs";',
  'import os from "node:os";',
  'import path from "node:path";',
  "",
  'test("lent", async () => { if (!fs.existsSync(path.join(os.tmpdir(), "ifrim-factory-slow-release"))) await new Promise((r) => setTimeout(r, 120000)); });',
  "",
].join("\n");
save("bug-hang", { summary: "Fixture: fix corect + un test foarte lent (pauză în timpul verificărilor).",
  write: { "src/requests.js": fixed, "test/regression.test.mjs": regression, "test/slow.test.mjs": slow } });

// ---------- Demo B (service-request) ----------
save("feature-b", { summary: "Endpoint POST/GET /api/requests cu validare, persistare node:sqlite în baza de test, deduplicare și formular cu stări.",
  write: { "src/server-app.js": readSolution("server-app.js"), "public/index.html": readSolution("index.html"), "test/requests.test.mjs": readSolution("requests.test.mjs") } });
// Version with a defect the reviewer flags (duplicates are not prevented); the repair adds the dedupe.
save("feature-b-nodedupe", { summary: "Implementare fără deduplicare (fixture pentru review).",
  write: { "src/server-app.js": readSolution("server-app.js").replace("const DEDUPE = true;", "const DEDUPE = false;"), "public/index.html": readSolution("index.html"), "test/requests.test.mjs": readSolution("requests.test.mjs") } });
save("feature-b-dedupe", { summary: "Remediere F-001: deduplicarea solicitărilor identice în 10 minute.",
  write: { "src/server-app.js": readSolution("server-app.js") } });
console.log("patches written");
