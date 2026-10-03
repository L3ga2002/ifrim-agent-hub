import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { environmentSummary, policyFormProblem, canaryRows, boundaryOf } from "../web/src/lib/environmentLogic.js";

// M05 §24 (T17): the Environments view keeps the facts separate, never claims a live status it did not record, never posts
// anything by itself, and the owner's decisions stay exact-text clicks.
const here = path.dirname(fileURLToPath(import.meta.url));
const src = (rel) => fs.readFileSync(path.join(here, "..", "web", "src", rel), "utf8");
const ladder = (done) => ["installed", "adapter", "account", "canary", "policy", "live"].map((step) => ({ step, ok: done.includes(step) }));

test("M05-UI-01 readiness summary: test-ready, real-ready and missing rungs are distinct; no single green light", () => {
  assert.equal(environmentSummary(null).tone, "neutral");
  const none = environmentSummary({ ladder: ladder(["adapter"]) });
  assert.equal(none.testReady, false);
  assert.match(none.text, /Lipsește: Instalat, Cont \(C16\), Canary C1–C17/);
  const test = environmentSummary({ ladder: ladder(["installed", "adapter", "account", "canary"]) });
  assert.equal(test.testReady, true);
  assert.equal(test.realReady, false);
  assert.match(test.text, /proiecte de test/);
  const real = environmentSummary({ ladder: ladder(["installed", "adapter", "account", "canary", "policy"]) });
  assert.equal(real.realReady, true);
  assert.match(real.text, /preview, E2E și review rămân pe Windows/, "even approved, the uncovered stages are named");
  assert.notEqual(real.tone, "ok", "never a plain green light");
  assert.match(environmentSummary({ simulated: true, ladder: ladder(["installed", "adapter", "account", "canary", "policy", "live"]) }).text, /SIMULAT/);
  assert.ok(real.missing.includes("Probă live (c)"), "a missing live probe stays visible");
});

test("M05-UI-02 the (b) form: exact text, a valid attestation and a known fingerprint; canary rows always C1…C20 (M07: C18–C20 optional coverage)", () => {
  const base = { policyText: "TEXT EXACT", fingerprintHash: "abc", attestationValid: true };
  assert.equal(policyFormProblem({ ...base, text: "TEXT EXACT" }), null);
  assert.match(policyFormProblem({ ...base, text: "text exact" }), /identic/);
  assert.match(policyFormProblem({ ...base, text: "TEXT EXACT", attestationValid: false }), /atestare/);
  assert.match(policyFormProblem({ ...base, text: "TEXT EXACT", fingerprintHash: "" }), /Amprenta/);
  const rows = canaryRows({ C1: "PASS", C14: "FAIL" });
  assert.equal(rows.length, 20);
  assert.deepEqual(rows.filter((r) => r.optional).map((r) => r.id), ["C18", "C19", "C20"]);
  assert.deepEqual(rows.filter((r) => r.status !== "NOT_RUN").map((r) => `${r.id}:${r.status}`), ["C1:PASS", "C14:FAIL"]);
  assert.equal(boundaryOf("environment").tone, "ok");
  assert.equal(boundaryOf("windows-sandbox").tone, "warn");
  assert.equal(boundaryOf("tool").label, "graniță de unealtă");
});

test("M05-UI-03 the Environments screen posts only on clicks; Lega shows the provider's reason and the attempt rule", () => {
  const env = src("screens/system/Environments.jsx");
  assert.ok(!/useEffect\s*\(/.test(env), "no effect that could run a check by itself");
  const posts = [...env.matchAll(/method:\s*"POST"/g)].length;
  const actions = [...env.matchAll(/useAction\(/g)].length;
  assert.ok(posts > 0 && posts <= actions, "every POST lives inside a click action");
  assert.match(env, /disabled=\{Boolean\(problem\) \|\| approve\.pending\}/, "(b) is sent only with the exact text");
  assert.ok(!/approval\.decide|\/api\/approvals/.test(env), "the screen never decides approvals");
  const lega = src("shell/Lega.jsx");
  assert.match(lega, /endDetail/);
  assert.match(lega, /attempt\.rule/);
  assert.match(lega, /Consumul real din plan: necunoscut/);
  const system = src("screens/System.jsx");
  assert.match(system, /id: "environments", label: "Medii de execuție"/);
});
