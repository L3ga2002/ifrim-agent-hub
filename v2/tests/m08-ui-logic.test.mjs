// Milestone 08 — UI logic (pure, no browser): routes and tabs, the phone's freshness rule, simulation inputs, idempotency keys,
// the cockpit's reply lines and the fail-safe list shared by the client and the server.
import test from "node:test";
import assert from "node:assert/strict";
import { intelRoute, intelHref, INTEL_TABS, mobileFreshness, parseSimInput, newIdempotencyKey, intelResultKind, evidenceLabel, INCIDENT_NEXT } from "../web/src/lib/intelLogic.js";
import { intelLines } from "../web/src/lib/cockpitLogic.js";
import { FAILSAFE_PATHS } from "../server/http/server.mjs";
import { isFailsafePath } from "../web/src/api.js";

test("M08-UI-01 intel routes: known tabs, unknown → Azi, item id from the query", () => {
  assert.equal(INTEL_TABS.length, 11);
  assert.deepEqual(intelRoute("warroom", { id: "inc_1" }), { tab: "warroom", id: "inc_1" });
  assert.deepEqual(intelRoute("nope", {}), { tab: "today", id: null });
  assert.equal(intelHref("simulation", "sim 1"), "/intel/simulation?id=sim%201");
});

test("M08-UI-02 the phone acts only on a fresh view: stale after 30 s, offline after a failed read, unknown before the first read", () => {
  const now = Date.parse("2026-10-03T10:00:00Z");
  assert.equal(mobileFreshness({ fetchedAt: null, now }).canAct, false);
  const fresh = mobileFreshness({ fetchedAt: now - 3000, serverTime: new Date(now - 3000).toISOString(), now });
  assert.equal(fresh.state, "fresh"); assert.equal(fresh.canAct, true);
  assert.equal(mobileFreshness({ fetchedAt: now - 31000, serverTime: new Date(now - 31000).toISOString(), now }).state, "stale");
  assert.equal(mobileFreshness({ fetchedAt: now - 40000, serverTime: new Date(now - 40000).toISOString(), now, failed: true }).state, "offline");
  assert.equal(mobileFreshness({ fetchedAt: now - 1000, serverTime: new Date(now - 60000).toISOString(), now }).canAct, false, "a frozen server clock is stale too");
});

test("M08-UI-03 simulation inputs: numbers, ranges, empty, invalid; idempotency keys are unique and long enough", () => {
  assert.equal(parseSimInput("40"), 40);
  assert.equal(parseSimInput("1,25"), 1.25);
  assert.deepEqual(parseSimInput("30-60"), { min: 30, max: 60 });
  assert.equal(parseSimInput(""), undefined);
  assert.equal(parseSimInput("60-30"), null);
  assert.equal(parseSimInput("multe"), null);
  const keys = new Set(Array.from({ length: 50 }, () => newIdempotencyKey("m")));
  assert.equal(keys.size, 50);
  for (const k of keys) assert.ok(k.length >= 8);
});

test("M08-UI-04 the cockpit card kind and reply lines for M08 answers; no winner on thin data", () => {
  assert.equal(intelResultKind({ simulation: {} }), "simulation");
  assert.equal(intelResultKind({ plan: {} }), null);
  const lines = intelLines({ simulation: { result: { status: "INSUFFICIENT_DATA", missing: [{ label: "Capacitate" }] } } });
  assert.match(lines[0], /lipsesc: Capacitate/);
  assert.match(intelLines({ league: { verdict: "INSUFFICIENT_EVIDENCE", groups: [] } })[0], /nu declar un câștigător/);
  assert.match(intelLines({ armed: { armed: true } }).join(" "), /Da, execută planul/);
  assert.equal(evidenceLabel({ evidence: "INSUFFICIENT_EVIDENCE", observations: 2 }).text, "date insuficiente (2/5)");
  assert.deepEqual(INCIDENT_NEXT.MONITORING, ["RESOLVED", "TRIAGE"]);
});

test("M08-UI-05 the fail-safe list is the same in the client and the server (phone stop/forget, skill rollback, device revoke)", () => {
  for (const p of ["/api/m/command", "/api/m/forget", "/api/skills/candidates/skc_1/rollback", "/api/devices/dev_1/revoke"]) assert.equal(isFailsafePath(p), true, p);
  for (const p of FAILSAFE_PATHS) assert.equal(isFailsafePath(p.replace(/\*/g, "x1")), true, p);
  assert.equal(isFailsafePath("/api/lessons"), false);
  assert.equal(isFailsafePath("/api/packages/pkg_1/decide"), false);
});
