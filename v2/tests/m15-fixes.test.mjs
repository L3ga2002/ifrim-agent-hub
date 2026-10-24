// M15 final fixes: pure status contracts and uncertainty-aware continuation, without starting a Hub.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { FACTORY_STAGES, ACTIVE_STAGES } from "../server/factory/factory.mjs";
import { RECORD_STATUSES } from "../server/desk/desk.mjs";
import { STATES, stateOf, historyRows, attentionItems, attentionSummary, currentActivity } from "../web/src/lib/stateVocab.js";
import { errorOutcome, errorContinuation, canRetryDirectly } from "../web/src/lib/errorOutcome.js";

test("M15F-STATE-01 every Factory stage has an explicit meaning", () => {
  for (const stage of FACTORY_STAGES) assert.notEqual(stateOf("mission", stage), "unknown", stage);
  for (const stage of ACTIVE_STAGES) assert.equal(stateOf("mission", stage), stage === "CANCEL_REQUESTED" ? "stopping" : "run", stage);
  for (const [state, stages] of Object.entries({ paused: ["PAUSED"], stopping: ["CANCEL_REQUESTED"], block: ["BLOCKED"], decide: ["NEEDS_OWNER_DECISION", "DELIVERY_READY", "SPEC_DRAFT"], closed: ["ACCEPTED", "REJECTED", "CANCELLED"] }))
    for (const stage of stages) assert.equal(stateOf("mission", stage), state, stage);
  // A new Factory stage must not inherit the cross-domain aliases accidentally.
  assert.equal(stateOf("mission", "RUNNING"), "unknown");
});

test("M15F-STATE-02 desk and render statuses preserve their work meaning", () => {
  for (const status of RECORD_STATUSES) assert.notEqual(stateOf("desk", status), "unknown", status);
  for (const [status, state] of Object.entries({ PLANNED: "ready", PREPARING: "run", PACKAGING: "run", STOPPED: "paused" })) assert.equal(stateOf("desk", status), state);
  for (const [status, state] of Object.entries({ REQUESTED: "run", CLAIMED: "run", VALIDATING: "run", RUNNING: "run", CANCEL_REQUESTED: "stopping", DONE: "closed", FAILED: "error", CANCELLED: "closed", INTERRUPTED: "error" })) assert.equal(stateOf("render", status), state);
  assert.equal(stateOf("ops", "PAUSED"), "paused");
  assert.equal(stateOf("run", "interrupted"), "error");
  assert.equal(STATES.paused.hint, "Oprită (de tine, de Stop All sau de o repornire); nimic nu rulează și nu pornește singură. Continuă doar printr-o decizie a ta.");
  for (const status of ["CONTACTED", "IN_DISCUSSION"]) assert.notEqual(stateOf("opportunity", status), "decide");
  for (const domain of ["mission", "desk", "delivery", "render", "ops", "x"]) for (const status of ["", "SOMETHING_NEW"]) assert.equal(stateOf(domain, status), "unknown", `${domain}:${status}: never ready or done`);
});

test("M15F-STATE-02 domain status snapshots cover the server's listed rows", () => {
  // delivery/stale.mjs, factory/factory.mjs, sales/sales.mjs + state-contracts.mjs, owner/envelopes.mjs, ops/plans.mjs, runtime/runs.mjs.
  const domains = {
    delivery: { ready: ["PLANNED"], run: ["ARMED", "ACTIVE"], done: ["READY"], decide: ["NEEDS_OWNER"], stale: ["STALE"], closed: ["CLOSED", "CANCELLED"], expired: ["EXPIRED"], error: ["FAILED"] },
    bundle: { decide: ["READY_FOR_OWNER_ACCEPTANCE"], stale: ["STALE"], closed: ["OWNER_ACCEPTED", "REJECTED"] },
    sales_prep: { ready: ["PLANNED"], run: ["PREPARING", "PACKAGING"], decide: ["WAITING_OWNER"], done: ["READY"], stale: ["STALE"], paused: ["STOPPED"], expired: ["EXPIRED"], closed: ["CANCELLED"], error: ["FAILED"] },
    dossier: { run: ["WRITING"], done: ["READY"], stale: ["STALE"], closed: ["SUPERSEDED"], block: ["INCOMPLETE"] },
    proposal: { ready: ["DRAFT"], done: ["APPROVED_INTERNAL"], closed: ["SUPERSEDED"], stale: ["STALE"] },
    opportunity: { ready: ["IDENTIFIED", "PROPOSAL_DRAFT", "ON_HOLD", "CONTACTED", "IN_DISCUSSION"], decide: ["READY_FOR_OWNER_REVIEW"], done: ["APPROVED_INTERNAL", "WON"], closed: ["LOST"] },
    envelope: { decide: ["PROPOSED", "WAITING_OWNER"], run: ["CONFIRMED", "ACTIVE"], closed: ["COMPLETED", "REVOKED", "SUPERSEDED", "CANCELLED"], expired: ["EXPIRED"], error: ["FAILED_TO_START"] },
    ops: { decide: ["PROPOSED", "NEEDS_OWNER"], run: ["CONFIRMED", "RUNNING"], paused: ["PAUSED"], closed: ["DONE", "CANCELLED", "SUPERSEDED"], expired: ["EXPIRED"], error: ["FAILED"] },
    run: { run: ["running"], decide: ["waiting_approval"], closed: ["completed"], block: ["blocked"], error: ["failed", "interrupted"] },
  };
  for (const [domain, states] of Object.entries(domains)) for (const [state, statuses] of Object.entries(states))
    for (const status of statuses) assert.equal(stateOf(domain, status), state, `${domain}:${status}`);
});

test("M15F-STATE-03 mission history keeps raw stages and Hub reasons", () => {
  const stages = ["IMPLEMENTING", "TEST_AUTHORING", "PAUSED", "CANCEL_REQUESTED", "NEW_STAGE"];
  const rows = historyRows({ missions: stages.map((stage, i) => ({ missionId: String(i), stage, stageReason: `Hub: ${stage}` })) });
  assert.deepEqual(rows.map((r) => r.state), ["run", "run", "paused", "stopping", "unknown"]);
  assert.deepEqual(rows.map((r) => r.status), stages);
  assert.deepEqual(rows.map((r) => r.why), stages.map((s) => `Hub: ${s}`));
  assert.equal(historyRows({ missions: [{ stage: "PAUSED", stageReason: "a".repeat(200) }] })[0].why.length, 160);
  assert.equal(historyRows({ missions: [{ stage: "ACCEPTED" }] })[0].meaning, "result_accepted");
  assert.match(historyRows({ missions: [{ stage: "DELIVERY_READY" }] })[0].why, /așteaptă acceptarea/);
});

test("M15F-STATE-04 unknown attention cannot be hidden as idle", () => {
  const items = attentionItems({ desk: [{ id: "desk", status: "NEW_STATUS" }], deliveries: [{ id: "delivery", status: "NEW_DELIVERY" }] });
  assert.deepEqual(items.map((r) => [r.state, r.status]), [["unknown", "NEW_STATUS"], ["unknown", "NEW_DELIVERY"]]);
  assert.equal(attentionSummary(items.slice(0, 1)), "1 stare necunoscută");
  assert.equal(attentionSummary(items), "2 stări necunoscute");
  assert.equal(attentionSummary([{ state: "stopping" }]), "1 se oprește");
  assert.equal(attentionSummary([{ state: "stopping" }, { state: "stopping" }]), "2 se opresc");
  assert.equal(attentionSummary([{ state: "paused" }, { state: "stopping" }]), "1 în pauză · 1 se oprește");
});

const errors = [
  [{ status: 409, code: "UI_STALE", notSent: true }, "not_sent"],
  [{ status: 409, code: "UI_STALE" }, "refused_before_execution"],
  [{ status: 403, category: "policy", details: { policy: { decision: "deny" } } }, "refused_before_execution"],
  [{ status: 403, message: "Invalid Session Token" }, "refused_before_execution"],
  [{ status: 404, method: "GET" }, "read_failed"], [{ status: 0, method: "GET" }, "read_failed"], [{ status: 500, method: "GET" }, "read_failed"],
  [{ status: 403, category: "gate", details: { policy: { decision: "deny" } } }, "refused"],
  [{ status: 403, details: { policy: { decision: "deny" } } }, "refused"],
  [{ status: 409 }, "refused"], [{ status: 400 }, "refused"], [{ status: 404 }, "refused"],
  [{ status: 0 }, "unknown"], [{ status: 502 }, "unknown"], [{ status: 500 }, "unknown"],
  [{}, ""], [{ message: "Hub-ul nu a răspuns cu o livrare." }, ""],
  [{ status: "invalid" }, ""], [{ status: null }, ""], [{ status: "" }, ""],
  [{ method: "POST" }, "unknown"],
];

test("M15F-ERR-01 only pre-execution evidence permits a direct retry", () => {
  for (const [error, outcome] of errors) {
    assert.equal(errorOutcome(error), outcome);
    const proven = ["not_sent", "refused_before_execution"].includes(outcome), text = errorContinuation(error);
    assert.equal(canRetryDirectly(error), proven || outcome === "read_failed");
    assert.equal(text.includes("nu s-a schimbat nimic"), proven);
    if (!outcome) assert.equal(text, "");
    else if (!proven && outcome !== "read_failed") { assert.match(text, /[Vv]erific/); assert.doesNotMatch(text, /Poți corecta și repeta/); }
    if (error.status === 0 && outcome !== "read_failed") assert.ok(text.startsWith("Legătura cu Hub-ul s-a întrerupt. "));
  }
  assert.match(errorContinuation(errors[0][0]), /Reîncarcă pagina/);
  for (const status of [404, 0, 500]) {
    const error = { status, method: "get" };
    assert.equal(errorOutcome(error), "read_failed");
    assert.equal(canRetryDirectly(error), true);
    assert.equal(errorContinuation(error), "Citirea nu a reușit; o citire nu schimbă nimic. Poți reîncerca.");
    assert.doesNotMatch(errorContinuation(error), /Nu știu dacă/);
  }
  assert.equal(errorOutcome({ method: "GET", notSent: true, code: "UI_STALE" }), "read_failed", "read classification comes first");
  assert.match(errorContinuation({ status: 409 }), /o încercare anterioară poate să fi reușit/);
  assert.equal(errorContinuation({ status: 400 }), "Hub-ul a refuzat cererea (motivul e mai sus). Verifică starea salvată înainte s-o repeți.");
  assert.equal(errorContinuation({ status: 403, category: "policy", details: { policy: { decision: "deny" } } }), "Hub-ul a refuzat cererea înainte s-o execute: nu s-a schimbat nimic (s-a consemnat doar refuzul). Poți corecta și repeta.");
  assert.equal(errorContinuation({}), "");
  for (const [error] of errors) assert.doesNotMatch(errorContinuation(error), /Recitesc starea salvată/);
  assert.equal(errorOutcome(null), ""); assert.equal(errorContinuation(null), ""); assert.equal(canRetryDirectly(null), false);
  const api = fs.readFileSync(new URL("../web/src/api.js", import.meta.url), "utf8");
  assert.match(api.slice(api.indexOf("function staleRefusal"), api.indexOf("function staleRefusal") + 1500), /error.notSent = true/);
});

test("M15F-ERR-02 activity directs uncertain results to saved state", () => {
  for (const [error, outcome] of errors) {
    const activity = currentActivity({ error: { ...error, message: error.message || "x".repeat(200) } }), proven = canRetryDirectly(error);
    assert.equal(activity.state, proven || outcome === "refused" ? "error" : "unknown");
    assert.equal(activity.title, proven ? "Cererea nu a mers" : outcome === "refused" ? "Cererea a fost refuzată" : "Rezultat necunoscut");
    assert.equal(activity.primary.kind, proven ? "composer" : "recheck");
    assert.ok(activity.sub.startsWith(`${String(error.message || "x".repeat(200)).slice(0, 160)}. `));
    assert.doesNotMatch(activity.sub, /Ce era salvat a rămas neschimbat/);
    assert.ok(activity.sub.endsWith(errorContinuation(error)));
    if (!outcome) {
      assert.notEqual(activity.primary.label, "Scrie din nou cererea");
      assert.doesNotMatch(activity.sub, /nu s-a schimbat nimic/);
    }
  }
});

test("M15F-ERR-03 Lega rechecks resources without repeating the command", () => {
  const source = fs.readFileSync(new URL("../web/src/screens/Lega.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /Textul tău e mai sus; îl poți trimite din nou\./);
  const send = source.slice(source.indexOf("  const send ="), source.indexOf("  const interrupt ="));
  assert.match(send, /if \(!canRetryDirectly\(e\)\) recheck\(\)/);
  assert.match(send, /const outcome = errorOutcome\(e\)/);
  assert.match(send, /outcome === "unknown" \? "Nu am putut confirma rezultatul" : outcome === "refused" \? "Hub-ul a refuzat cererea" : "Nu am putut"/);
  assert.match(send, /: \$\{e.message\}\. \$\{errorContinuation\(e\)\}/);
  assert.match(source, /Promise.allSettled\(\[refresh\(\), cockpit.reload\(\), inbox.reload\(\), sources.desk.reload\(\), sources.deliveries.reload\(\)\]\)/);
  assert.match(source, /p.kind === "recheck"\) recheck\(\).then\(\(ok\) => \{ if \(ok\) \{ setConversation\(\(c\) => \[\.\.\.c.slice\(-40\), \{ role: "lega", text: "Am recitit starea salvată din Hub; ce vezi acum pe ecran e starea ei\.", at: Date.now\(\) \}\]\); setError\(null\); \} else setConversation/);
  assert.match(send, /!canRetryDirectly\(e\) \? " Recitesc starea salvată\." : ""/);
  const recheck = source.slice(source.indexOf("  const recheck ="), source.indexOf("  const [busy,"));
  assert.match(recheck, /await Promise.allSettled/);
  assert.equal((recheck.match(/api\("\/api\/state"\)/g) || []).length, 1);
  assert.match(recheck, /try \{ await api\("\/api\/state"\); return true; \} catch \{ return false; \}/);
  const startView = source.slice(source.indexOf('<select value={startView.data'), source.indexOf('aria-label="Ecranul de pornire"'));
  assert.match(startView, /catch \(er\) \{ setError\(er\); if \(!canRetryDirectly\(er\)\) recheck\(\); \}/);
  assert.match(source, /Nu am putut reciti starea: Hub-ul nu răspunde\. Rezultatul rămâne necunoscut/);
  assert.equal((source.match(/if \(!canRetryDirectly\(e\)\) recheck\(\)/g) || []).length, 3);
});


test("M15F-ERR-04 api and apiRaw retain request methods on transport and HTTP errors", async (t) => {
  const { api, apiRaw } = await import("../web/src/api.js");
  const response = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const fetch = t.mock.method(globalThis, "fetch");
  for (const status of [404, 0, 500]) {
    fetch.mock.mockImplementation(async () => {
      if (status === 0) throw new TypeError("offline");
      return response(status, { error: { message: "read failed" } });
    });
    await assert.rejects(api("/api/state"), (error) => error.method === "GET" && error.status === status && errorOutcome(error) === "read_failed");
  }
  for (const status of [400, 403, 0, 500]) {
    fetch.mock.mockImplementation(async (path) => {
      if (path === "/api/session") return response(200, { token: "test-token" });
      if (status === 0) throw new TypeError("offline");
      return response(status, { error: { message: "mutation failed" } });
    });
    await assert.rejects(api("/api/test", { method: "PATCH", body: {} }), (error) => error.method === "PATCH" && error.status === status);
    await assert.rejects(apiRaw("/api/test", new Uint8Array()), (error) => error.method === "POST" && error.status === status);
  }
  const source = fs.readFileSync(new URL("../web/src/api.js", import.meta.url), "utf8");
  const stale = source.slice(source.indexOf("function staleRefusal"), source.indexOf("export class ApiError"));
  assert.match(stale, /error.method = method/);
  const upload = source.slice(source.indexOf("export function uploadWithProgress"));
  assert.match(upload, /new ApiError\(xhr.status, data, "POST"\)/);
  assert.match(upload, /xhr.onerror = \(\) => reject\(new ApiError\(0, .*?, "POST"\)\)/);
});

test("M15F-PREF-01 plain preferences persist before React schedules the value", () => {
  const source = fs.readFileSync(new URL("../web/src/store.js", import.meta.url), "utf8");
  const pref = source.slice(source.indexOf("export function usePref"));
  assert.match(pref, /if \(typeof next !== "function"\) \{\s*try \{ localStorage.setItem\(`hub.v2.\$\{key\}`, JSON.stringify\(next\)\); \} catch \{[^}]*\}\s*setValue\(next\);\s*return;\s*\}/);
  assert.match(pref, /setValue\(\(prev\) => \{\s*const v = next\(prev\);\s*try \{ localStorage.setItem\(`hub.v2.\$\{key\}`, JSON.stringify\(v\)\); \} catch \{[^}]*\}\s*return v;/);
});

test("M15F-STATE-05 unknown pills distinguish a missing status prop from an empty row status", () => {
  const source = fs.readFileSync(new URL("../web/src/components/StatePill.jsx", import.meta.url), "utf8");
  const pill = source.slice(source.indexOf("export function StatePill"), source.indexOf("export function MeaningChip"));
  assert.match(pill, /const showRawStatus = key === "unknown" && status !== undefined/);
  assert.match(pill, /title=\{showRawStatus \? STATES\[key\].hint : title \|\| STATES\[key\].hint\}/);
  assert.match(pill, /\{showRawStatus \? `\$\{STATES\[key\].label\} · .*"fără stare".* : text \|\| STATES\[key\].label\}/);
});
