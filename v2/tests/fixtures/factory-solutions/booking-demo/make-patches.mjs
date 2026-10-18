// Generates the deterministic writer patches of the booking demo (M11) for the fake Codex scenario `factory-write:<name>`
// (the format of tests/fixtures/factory-patches/*.json: { summary, write: { "relative/path": "text" } }):
//   booking-fix      the reference fix of public/js/slots-view.mjs plus a regression test
//   booking-partial  only the „Ocupat” label on the phone: AC-1 still fails, so one repair cycle is forced
//   booking-tamper   weakens the protected acceptance test instead of fixing the code
// Run: node v2/tests/fixtures/factory-solutions/booking-demo/make-patches.mjs   (re-run after editing the fixture or a file here)
// The solutions live OUTSIDE the fixture: the fixture folder is copied into the workspace, a solution must never be.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const BOOKING_FIXTURE_DIR = path.resolve(here, "..", "..", "..", "..", "fixtures", "factory", "booking-demo");
export const PATCHES_DIR = path.resolve(here, "..", "..", "factory-patches");
export const VIEW_FILE = "public/js/slots-view.mjs";
export const PROTECTED_TEST = "test/acceptance.test.mjs";

// Always LF, whatever a checkout did to the line ends: the patches are compared byte for byte.
const read = (file) => fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");

/** The protected acceptance test with AC-1 emptied: it "passes" on the unfixed code. Throws when the fixture test changed shape. */
export function tamperedAcceptance(original) {
  const from = original.indexOf("  assert.equal(view.find(isBooked).available, false,");
  const marker = "\"pe telefon pot fi alese exact intervalele libere\");\n  }\n";
  const to = original.indexOf(marker, from);
  if (from === -1 || to === -1) throw new Error("booking-tamper: the AC-1 assertions were not found in the fixture's acceptance test; update make-patches.mjs");
  return `${original.slice(0, from)}  assert.ok(view.find(isBooked));\n${original.slice(to + marker.length)}`;
}

/** The three patches, by name. Pure: reads the fixture and the files next to this script. */
export function buildBookingPatches() {
  const regression = read(path.join(here, "regression.test.mjs"));
  return {
    "booking-fix": {
      summary: "Cauza: ramura pentru telefon din layoutSlots citea câmpul greșit (state în loc de status), deci orice interval părea liber și nu avea eticheta „Ocupat”. Fix minim: aceeași regulă ca pe desktop + test de regresie.",
      write: { [VIEW_FILE]: read(path.join(here, "slots-view.mjs")), "test/regression.test.mjs": regression },
    },
    "booking-partial": {
      summary: "Fix parțial (fixture): pe telefon apare eticheta „Ocupat”, dar intervalul ocupat poate fi ales în continuare.",
      write: { [VIEW_FILE]: read(path.join(here, "slots-view.partial.mjs")) },
    },
    "booking-tamper": {
      summary: "Fixture de integritate: slăbește testul de acceptanță protejat în loc să repare codul.",
      write: { [PROTECTED_TEST]: tamperedAcceptance(read(path.join(BOOKING_FIXTURE_DIR, PROTECTED_TEST))) },
    },
  };
}

/** The exact text of a patch file. */
export const patchText = (patch) => `${JSON.stringify(patch, null, 2)}\n`;

const invoked = process.argv[1] ? path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase() : false;
if (invoked) {
  for (const [name, patch] of Object.entries(buildBookingPatches())) fs.writeFileSync(path.join(PATCHES_DIR, `${name}.json`), patchText(patch));
  console.log("booking patches written");
}
