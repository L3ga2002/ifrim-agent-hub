import test from "node:test";
import assert from "node:assert/strict";
import { validateRequest } from "../src/requests.js";

test("o solicitare completă este acceptată și normalizată", () => {
  const r = validateRequest({ name: " Ana Pop ", email: "Ana@Example.ro", service: "audit" });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, { name: "Ana Pop", email: "ana@example.ro", service: "audit" });
});

test("un e-mail fără domeniu este refuzat", () => {
  const r = validateRequest({ name: "Ana", email: "ana@", service: "audit" });
  assert.equal(r.ok, false);
  assert.ok(r.errors.email);
});

test("un serviciu necunoscut este refuzat", () => {
  assert.equal(validateRequest({ name: "Ana", email: "ana@example.ro", service: "altceva" }).ok, false);
});
