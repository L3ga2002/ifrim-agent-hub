// Unit tests added by the (simulated) writer for the validation rules.
import test from "node:test";
import assert from "node:assert/strict";
import { validate } from "../src/server-app.js";

test("validarea normalizează e-mailul și acceptă o solicitare completă", () => {
  const r = validate({ name: " Ana ", email: "ANA@Example.ro ", service: "audit", message: "" });
  assert.equal(r.ok, true);
  assert.equal(r.value.email, "ana@example.ro");
  assert.equal(r.value.name, "Ana");
});

test("validarea refuză un mesaj prea lung", () => {
  assert.ok(validate({ name: "Ana", email: "a@example.ro", service: "audit", message: "x".repeat(2001) }).errors.message);
});
