// Test de acceptanță INDEPENDENT (protejat de Software Factory după aprobarea scope-ului): descrie comportamentul cerut.
import test from "node:test";
import assert from "node:assert/strict";
import { validateRequest } from "../src/requests.js";

test("AC-1: un nume format doar din spații este refuzat cu mesajul pentru nume", () => {
  const r = validateRequest({ name: "   ", email: "ana@example.ro", service: "audit" });
  assert.equal(r.ok, false, "nume obligatoriu: spațiile nu sunt un nume");
  assert.equal(r.errors.name, "Numele este obligatoriu");
});

test("AC-2: o solicitare validă rămâne acceptată", () => {
  assert.equal(validateRequest({ name: "Ion", email: "ion@example.ro", service: "mentenanta" }).ok, true);
});
