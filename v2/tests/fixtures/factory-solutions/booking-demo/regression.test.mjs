// Test de regresie adăugat odată cu fixul: pe telefon și pe desktop, aceeași regulă pentru fiecare stare a unui interval.
import test from "node:test";
import assert from "node:assert/strict";
import { layoutSlots } from "../public/js/slots-view.mjs";

const slots = [
  { start: "2030-01-15T09:00", time: "09:00", status: "free" },
  { start: "2030-01-15T09:30", time: "09:30", status: "booked" },
  { start: "2030-01-15T10:00", time: "10:00", status: "past" },
];

test("regresie: un interval ocupat sau trecut nu poate fi ales nici pe telefon, nici pe desktop", () => {
  for (const compact of [true, false]) {
    const view = layoutSlots(slots, { compact });
    assert.deepEqual(view.map((entry) => entry.available), [true, false, false], `compact=${compact}`);
    assert.deepEqual(view.map((entry) => entry.note), ["", "Ocupat", "Trecut"], `compact=${compact}`);
    assert.deepEqual(view.map((entry) => entry.start), slots.map((slot) => slot.start), `compact=${compact}`);
  }
});
