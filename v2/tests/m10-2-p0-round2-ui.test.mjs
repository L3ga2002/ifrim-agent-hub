// Milestone 10.2.1 — P0 round 2, unit R3: the operation-plan / desktop resume holds (owner decision D22) and the rearm card's UI fixes
// (UI-01 … UI-10, the security list newest first, REG-02's setup link).
//
// Part A (no browser):
//  · D22 on the server (ops/plans.mjs, desktop/operator.mjs): what the CURRENT Stop All itself paused — an operation plan, the desktop
//    operator's session — is resumed only after the rearm, by every resume path (the plan card's ops.plan.resume, the re-confirmation
//    of a new session, desktop.resume); the Hub refuses with { code GATE_REARM_REQUIRED, rearm: true }. Work paused for any other reason
//    (the owner's own pause, „Stop”, an intervention, its own NEEDS_OWNER, a palette suspension) keeps its resume while the gate is
//    suspended; new plans after Stop All stay allowed (M10-OP-12); a Stop All that lands DURING a resume wins.
//  · the pure page logic (web/src/lib/rearmLogic.js, web/src/lib/uiLogic.js) and source checks of the components.
// Part B (a REAL browser — headless Chromium through Playwright, a virtual WebAuthn authenticator — against a throwaway test Hub serving
// the built UI; fixture providers, no model, nothing live): UI-02 (a cockpit reload error and a project switch never replay a click
// into a rearm), UI-01 (a click elsewhere only SHOWS the card), and D22 in the cockpit and on the Operator page (the plan's „Continuă”
// refused → the same rearm card; after the rearm nothing restarted; „Continuă” then resumes). Part B runs only against a build that
// contains this UI (HUB_V2_WEB_DIST may point at a fresh scratch build; the live Hub's v2/web/dist is never rebuilt here).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { makeTestHub, enrolOwner, waitFor, prepareLiveWithoutGrants, HUB_ROOT, WEB_DIST } from "./helpers.mjs";
import { makeDesktopHub, readyDesktop, asOwner, asChannel } from "./m10-helpers.mjs";
import { HubError } from "../server/core/errors.mjs";
import { classifySuspension } from "../server/policy/gate-state.mjs";
import { createOpsPlans } from "../server/ops/plans.mjs";
import { REARM_SHOW_LABEL, REARM_BUTTON_LABEL, REARM_CHANGED_NOTICE, REARM_REQUEST_GONE_NOTICE, REARM_SETUP, isRearmCard, rearmSlotFrom, continueAfterFetch,
  rearmTriggerDue, rearmRequestRefused, rearmRequiredOf, noAuthenticatorError, rearmOfferFor, continueVoiceNotice, gateRearmHint } from "../web/src/lib/rearmLogic.js";
import { cockpitPlanAction } from "../web/src/lib/uiLogic.js";
import { materializeFixture, demoSpec } from "../server/factory/fixtures.mjs";
import { createHttpServer } from "../server/http/server.mjs";
import { browserStatus, browserLaunchOptions } from "../server/tools/browser.mjs";

const V2 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = (rel) => fs.readFileSync(path.join(V2, rel), "utf8");
const ADMIN_POINTERS = /OPEN GATE|Integrări → Avansat|Avansat|din Sistem|#\/system|#\/integrations/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NOW = Date.parse("2026-10-05T10:00:00.000Z");
const cardOf = (extra = {}) => ({ kind: "gate_rearm", eligible: true, code: "ELIGIBLE", nonce: "a".repeat(32), hash: "b".repeat(64), cls: "stop_all",
  headline: "Poarta de execuție e oprită de Stop All. O redeschid aici, cu Windows Hello?", lines: [], stays: [], security: null, requiresFreshAuth: true, fresh: false,
  requestId: null, expiresAt: new Date(NOW + 5 * 60000).toISOString(), ...extra });
const securityOf = () => ({ events: [{ id: "evt_1", type: "lega.voice_gate_bypass", at: new Date(NOW - 60000).toISOString(), label: "x" }], total: 1, truncated: false, order: "newest_first", ackRequired: true });
const refusal = async (p) => { try { await p; } catch (e) { return e; } assert.fail("expected a refusal"); return null; };
const events = (t, type) => t.hub.db.prepare("SELECT * FROM events WHERE type = ? ORDER BY seq").all(type);
const gateOf = (t) => t.hub.settings.get("executionGate") || {};
const openGate = (t) => t.hub.bus.transaction(() => t.hub.settings.set("executionGate", { status: "open", reason: "test", changedAt: new Date().toISOString(), changedBy: "test" }, "test"));

/** Test executors: a probe (authorizes its ops), a step that waits for a signal, and one whose reconciliation waits for a signal. */
function probes(t) {
  const signal = { open: false, reconcile: null };
  t.hub.executors["test.probe"] = {
    describe: ({ n = 1, fail = null, reconcile = "retry" }) => ({ title: `Sondă ${n}`, params: { n, fail, reconcile }, ops: [{ op: "media.render" }], observed: ["nimic"], transmitted: [], outputs: [`rezultat ${n}`] }),
    run: async ({ params, authorize }) => {
      authorize({ op: "media.render" });
      if (params.fail) throw new HubError("tool", `eșec ${params.fail}`, { code: params.fail });
      return { result: { n: params.n } };
    },
    reconcile: async ({ params }) => {
      if (signal.reconcile) await signal.reconcile(params);
      return { outcome: params.reconcile, result: { n: params.n, reconciled: true }, detail: "test" };
    },
  };
  t.hub.executors["test.wait"] = {
    describe: () => ({ title: "Așteaptă", params: {}, ops: [{ op: "media.render" }], observed: [], transmitted: [], outputs: [] }),
    run: async ({ authorize, abort }) => {
      authorize({ op: "media.render" });
      while (!signal.open && !abort.aborted) await sleep(15);
      if (abort.aborted) throw new HubError("policy", "oprit", { code: "PAUSED" });
      authorize({ op: "media.render" });
      return { result: { waited: true } };
    },
  };
  // A failing test never leaves a waiting step polling after the Hub is closed (the process would not exit).
  const cleanup = t.cleanup;
  t.cleanup = async () => { signal.open = true; signal.reconcile = null; await cleanup(); };
  return signal;
}
const propose = (t, owner, steps, kind = "r3.plan") => asOwner(t, owner, "ops.plan.propose", { kind, title: `Plan ${kind}`, steps, limits: {} });
const confirm = (t, owner, p) => asOwner(t, owner, "ops.plan.confirm", { planId: p.id, nonce: p.nonce, displayedHash: p.hash });
const runningPlan = async (t, owner, kind) => {
  const p = await propose(t, owner, [{ kind: "test.wait", params: {} }], kind);
  await confirm(t, owner, p);
  await waitFor(() => t.hub.opsPlans.view(p.id).steps.some((s) => s.status === "RUNNING"));
  return p;
};
/** A new owner session with the same authenticator (the plan's own session stays the first one). */
async function ownerAgain(t, owner) {
  const a = t.hub.trust.beginAuthentication({ origin: owner.origin });
  const opened = t.hub.trust.finishAuthentication({ origin: owner.origin, challengeId: a.challengeId, credential: owner.auth.get({ challenge: a.publicKey.challenge }) });
  return { ...owner, session: t.hub.trust.resolveSession(opened.token, { origin: owner.origin }), token: opened.token };
}
/** The cockpit's rearm, exactly as the page does it: the Hub's card, then its nonce + hash with a fresh verification (click). */
async function rearm(t, owner) {
  const card = await asOwner(t, owner, "gate.rearm.card", {});
  assert.equal(isRearmCard(card), true, JSON.stringify(card).slice(0, 300));
  return asOwner(t, owner, "gate.rearm", { nonce: card.nonce, hash: card.hash, ackSecurity: false, modality: "click" }, { ownerSession: owner.reauth() });
}
const assertRearmRequired = (e, kind) => {
  assert.equal(e?.code, "GATE_REARM_REQUIRED", `${e?.code}: ${e?.message}`);
  assert.equal(e.category, "gate");
  assert.equal(e.details?.code, "GATE_REARM_REQUIRED");
  assert.equal(e.details?.rearm, true);
  assert.equal(e.details?.kind, kind);
  assert.match(e.message, /Windows Hello/);
  assert.match(e.message, /„Continuă”/);
  assert.doesNotMatch(e.message, ADMIN_POINTERS);
  // The page's own reading of the same refusal (rearmLogic.rearmRequiredOf), as the browser receives it (ApiError: code + details).
  const need = rearmRequiredOf({ message: e.message, code: e.code, details: e.details });
  assert.equal(need?.reason, e.message);
  assert.equal(need.kind, kind);
};

// ---------------------------------------------------------------- Part A: D22 on the server
test("R3-01 D22 an operation plan Stop All paused: the card's „Continuă” and another session's resume are refused until the rearm (GATE_REARM_REQUIRED); the rearm restarts nothing; „Continuă” then resumes", async () => {
  const t = await makeTestHub();
  try {
    const owner = await enrolOwner(t);
    const signal = probes(t);
    openGate(t);
    const p = await runningPlan(t, owner, "r3.held");
    const stop = await asChannel(t, "ui", "system.stop_all", { reason: "test" });
    assert.deepEqual(stop.plansPaused, [p.id]);
    await t.hub.opsPlans.idle(p.id);
    assert.equal(t.hub.opsPlans.view(p.id).status, "PAUSED");
    assert.equal(classifySuspension(gateOf(t)).cls, "stop_all");
    // The plan card's own „Continuă” (ops.plan.resume, the owner session that confirmed it): refused, nothing resumed.
    assertRearmRequired(await refusal(asOwner(t, owner, "ops.plan.resume", { planId: p.id })), "ops");
    // Another session of the same credential: the hold comes BEFORE the session-delta card (no authority moves for a held plan).
    const other = await ownerAgain(t, owner);
    const second = await refusal(asOwner(t, other, "ops.plan.resume", { planId: p.id }));
    assertRearmRequired(second, "ops");
    assert.equal(second.details?.reconfirm, undefined, "no re-confirmation card for a plan that cannot resume");
    assert.equal(t.hub.opsPlans.view(p.id).status, "PAUSED");
    assert.equal(events(t, "ops.plan.resumed").length, 0);
    // New plans after Stop All stay allowed (M10-OP-12): proposed and confirmed while the gate is suspended.
    const fresh = await propose(t, owner, [{ kind: "test.probe", params: { n: 7 } }], "r3.new");
    await confirm(t, owner, fresh);
    assert.equal((await t.hub.opsPlans.idle(fresh.id)).status, "DONE");
    // The rearm reopens the gate and restarts nothing …
    const out = await rearm(t, owner);
    assert.equal(out.reopened, true);
    await sleep(150);
    assert.equal(t.hub.opsPlans.view(p.id).status, "PAUSED", "nothing old restarts with the rearm");
    assert.equal(events(t, "ops.plan.resumed").length, 0);
    // … and the explicit „Continuă” afterwards resumes the exact plan, same limits.
    const resumed = await asOwner(t, owner, "ops.plan.resume", { planId: p.id });
    assert.equal(resumed.authority.sessionId, owner.session.id);
    signal.open = true;
    assert.equal((await t.hub.opsPlans.idle(p.id)).status, "DONE");
    assert.equal(events(t, "ops.plan.resumed").length, 1);
  } finally { await t.cleanup(); }
});

test("R3-02 D22 work paused for another reason keeps its resume while the gate is suspended: the owner's own pause under a palette suspension, a plan's own NEEDS_OWNER and a plan paused after Stop All", async () => {
  const t = await makeTestHub();
  try {
    const owner = await enrolOwner(t);
    const signal = probes(t);
    openGate(t);
    // A palette suspension never pauses operation plans (and never holds them): the owner's own „Pauză” on the card, then „Continuă”.
    const a = await runningPlan(t, owner, "r3.suspend");
    await asChannel(t, "ui", "gate.set", { action: "suspend", reason: "Palette pause" });
    assert.equal(classifySuspension(gateOf(t)).cls, "suspend");
    await asChannel(t, "ui", "ops.plan.pause", { planId: a.id, reason: "Pauză (card)" });
    await t.hub.opsPlans.idle(a.id);
    assert.equal(t.hub.opsPlans.view(a.id).status, "PAUSED");
    await asOwner(t, owner, "ops.plan.resume", { planId: a.id });
    signal.open = true;
    assert.equal((await t.hub.opsPlans.idle(a.id)).status, "DONE", "resumed under the suspended gate");
    assert.equal(gateOf(t).status, "suspended", "the resume reopened nothing");
    // A plan waiting for the owner for its own reason (an uncertain step) BEFORE Stop All: that stop did not pause it.
    signal.open = false;
    openGate(t);
    const b = await propose(t, owner, [{ kind: "test.probe", params: { n: 2, fail: "OPERATOR_TIMEOUT", reconcile: "done" } }], "r3.needs");
    await confirm(t, owner, b);
    assert.equal((await t.hub.opsPlans.idle(b.id)).status, "NEEDS_OWNER");
    const stop = await asChannel(t, "ui", "system.stop_all", { reason: "test" });
    assert.deepEqual(stop.plansPaused, [], "Stop All pauses only what runs");
    await asOwner(t, owner, "ops.plan.resume", { planId: b.id });
    assert.equal((await t.hub.opsPlans.idle(b.id)).status, "DONE", "its own NEEDS_OWNER keeps its resume under Stop All");
    // A plan confirmed after Stop All and paused by the owner („Preiau eu” / „Pauză”): not the stop's, so it resumes before the rearm.
    const c = await runningPlan(t, owner, "r3.after");
    await asChannel(t, "voice", "ops.plan.pause", { planId: c.id, reason: "Preiau eu" });
    await t.hub.opsPlans.idle(c.id);
    await asOwner(t, owner, "ops.plan.resume", { planId: c.id });
    signal.open = true;
    assert.equal((await t.hub.opsPlans.idle(c.id)).status, "DONE");
    assert.equal(classifySuspension(gateOf(t)).cls, "stop_all", "still suspended by the stop; nothing reopened it");
  } finally { await t.cleanup(); }
});

test("R3-03 D22 the re-confirmation of a new session (ops.plan.reconfirm) is held too: the authority does not move; after the rearm the SAME card confirms and the plan resumes", async () => {
  const t = await makeTestHub();
  try {
    const owner = await enrolOwner(t);
    const signal = probes(t);
    openGate(t);
    const p = await runningPlan(t, owner, "r3.reconfirm");
    await asChannel(t, "ui", "ops.plan.pause", { planId: p.id, reason: "Pauză" });
    await t.hub.opsPlans.idle(p.id);
    // A new session of the same credential: the Hub shows only the difference (the new session).
    const other = await ownerAgain(t, owner);
    let card = null;
    await assert.rejects(asOwner(t, other, "ops.plan.resume", { planId: p.id }), (e) => { card = e.details?.reconfirm; return e.code === "RECONFIRM_DELTA"; });
    // The gate becomes a suspension written before this version (no origin recorded): what was paused at or before it is held.
    await sleep(10);
    t.hub.bus.transaction(() => t.hub.settings.set("executionGate", { status: "suspended", reason: "Suspendare veche", changedAt: new Date().toISOString(), changedBy: "user" }, "test"));
    assert.equal(classifySuspension(gateOf(t)).cls, "legacy_unknown");
    const held = await refusal(asOwner(t, other, "ops.plan.reconfirm", { planId: p.id, nonce: card.nonce, displayedHash: card.hash }));
    assertRearmRequired(held, "ops");
    assert.equal(t.hub.db.prepare("SELECT owner_session_id FROM ops_plans WHERE id = ?").get(p.id).owner_session_id, owner.session.id, "the authority did not move");
    assert.equal(events(t, "ops.plan.reconfirmed").length, 0);
    assert.equal(t.hub.opsPlans.view(p.id).status, "PAUSED");
    // The rearm (a legacy suspension is rearmable in the cockpit), then the same card confirms the difference and the plan resumes.
    assert.equal((await rearm(t, owner)).reopened, true);
    assert.equal(t.hub.opsPlans.view(p.id).status, "PAUSED", "the rearm restarts nothing");
    const resumed = await asOwner(t, other, "ops.plan.reconfirm", { planId: p.id, nonce: card.nonce, displayedHash: card.hash });
    assert.equal(resumed.authority.sessionId, other.session.id);
    signal.open = true;
    assert.equal((await t.hub.opsPlans.idle(p.id)).status, "DONE");
    assert.equal(events(t, "ops.plan.reconfirmed").length, 1);
  } finally { await t.cleanup(); }
});

test("R3-04 D22 a Stop All that lands WHILE a plan's uncertain steps are reconciled stops that resume: nothing starts, the reconciliation stays recorded", async () => {
  const t = await makeTestHub();
  try {
    const owner = await enrolOwner(t);
    const signal = probes(t);
    openGate(t);
    const p = await propose(t, owner, [{ kind: "test.probe", params: { n: 1, fail: "OPERATOR_TIMEOUT", reconcile: "done" } }, { kind: "test.probe", params: { n: 2 } }], "r3.race");
    await confirm(t, owner, p);
    assert.equal((await t.hub.opsPlans.idle(p.id)).status, "NEEDS_OWNER");
    signal.reconcile = async () => { signal.reconcile = null; await asChannel(t, "ui", "system.stop_all", { reason: "test (în timpul reluării)" }); };
    const raced = await refusal(asOwner(t, owner, "ops.plan.resume", { planId: p.id }));
    assertRearmRequired(raced, "ops");
    assert.match(raced.message, /Stop All/);
    await sleep(100);
    const v = t.hub.opsPlans.view(p.id);
    assert.equal(v.status, "NEEDS_OWNER", "nothing started after the stop");
    assert.equal(v.steps[0].status, "DONE", "the reconciliation (did the step happen?) stays recorded");
    assert.equal(v.steps[1].status, "PENDING");
    assert.equal(events(t, "ops.plan.resumed").length, 0);
    // A plan NOT paused by that stop is not held: after the race, „Continuă” resumes it (the stop did not pause it).
    await asOwner(t, owner, "ops.plan.resume", { planId: p.id });
    assert.equal((await t.hub.opsPlans.idle(p.id)).status, "DONE");
  } finally { await t.cleanup(); }
});

test("R3-05 D22 the desktop operator session Stop All paused: desktop.resume is refused until the rearm; a session „Stop” paused (or paused before the stop) keeps its resume; a stop during the resume wins", async () => {
  const t = await makeDesktopHub();
  try {
    const owner = await readyDesktop(t);
    openGate(t);
    // 1 · An active operator session, then Stop All: the stop records it and holds it.
    t.hub.desktop.ensureSession({ controller: "owner" });
    const stop = await asChannel(t, "ui", "system.stop_all", { reason: "test" });
    assert.equal(stop.desktop.stopped, true);
    const sid = t.hub.desktop.sessionStatus().id;
    assert.equal(t.hub.desktop.sessionStatus().status, "PAUSED");
    assert.equal(events(t, "system.stop_all").at(-1) && JSON.parse(events(t, "system.stop_all").at(-1).payload_json).scope.desktopSessionId, sid);
    assertRearmRequired(await refusal(asOwner(t, owner, "desktop.resume", {})), "desktop");
    assert.equal(t.hub.desktop.sessionStatus().status, "PAUSED");
    const auth = () => ({ plan: "t", step: "t", apps: ["Notepad"], exp: new Date(Date.now() + 60000).toISOString() });
    await assert.rejects(t.hub.desktop.client.request("focus", { hwnd: 1 }, auth()), (e) => e.code === "PAUSED", "the helper's input stays stopped");
    // 2 · The rearm restarts nothing; desktop.resume afterwards resumes the session.
    assert.equal((await rearm(t, owner)).reopened, true);
    assert.equal(t.hub.desktop.sessionStatus().status, "PAUSED", "the rearm restarts nothing");
    const resumed = await asOwner(t, owner, "desktop.resume", {});
    assert.equal(resumed.session.status, "ACTIVE");
    // 3 · „Stop” (fail-safe, any channel) under a palette suspension: not a stop of the gate's own; resumes while suspended.
    await asChannel(t, "ui", "gate.set", { action: "suspend", reason: "Palette pause" });
    await asChannel(t, "voice", "desktop.stop", { reason: "Stop (test)" });
    assert.equal(t.hub.desktop.sessionStatus().status, "PAUSED");
    assert.equal((await asOwner(t, owner, "desktop.resume", {})).session.status, "ACTIVE");
    // 4 · A session paused BEFORE Stop All (an intervention / „Stop”) is not that stop's: it keeps its resume under Stop All.
    await asChannel(t, "voice", "desktop.stop", { reason: "Stop (înainte)" });
    const stop2 = await asChannel(t, "ui", "system.stop_all", { reason: "test 2" });
    assert.equal(stop2.scope?.desktopSessionId ?? null, null, "a session that was already paused is not recorded by the stop");
    assert.equal((await asOwner(t, owner, "desktop.resume", {})).session.status, "ACTIVE", "resumed under Stop All: the stop did not pause it");
    // 5 · A Stop All that lands while the helper is being un-paused wins: the input is stopped again and the session stays paused.
    assert.equal((await rearm(t, owner)).reopened, true);
    await asChannel(t, "voice", "desktop.stop", { reason: "Stop (înainte de reluare)" });
    const client = t.hub.desktop.client;
    const original = client.request;
    client.request = async (op, args, auth) => {
      if (op === "resume") { client.request = original; await asChannel(t, "ui", "system.stop_all", { reason: "test (în timpul reluării)" }); }
      return original(op, args, auth);
    };
    try {
      assertRearmRequired(await refusal(asOwner(t, owner, "desktop.resume", {})), "desktop");
    } finally { client.request = original; }
    assert.equal(t.hub.desktop.sessionStatus().status, "PAUSED", "the session stays paused");
    assert.equal(events(t, "desktop.resume_refused").length, 1);
    await assert.rejects(client.request("focus", { hwnd: 1 }, auth()), (e) => e.code === "PAUSED", "the helper was stopped again");
  } finally { await t.cleanup(); }
});

test("R3-07 D22 the plans read the stop through the injected reader (hub.stopScope, a function as hub.mjs wires it); an unreadable stop while a stop holds the gate refuses (fail-closed), under a palette suspension it never blocks", async () => {
  const t = await makeTestHub();
  try {
    const owner = await enrolOwner(t);
    const signal = probes(t);
    signal.open = true;
    openGate(t);
    assert.equal(typeof t.hub.stopScope?.heldByStop, "function", "hub.stopScope is wired");
    const deps = { db: t.hub.db, bus: t.hub.bus, clock: () => new Date(), settings: t.hub.settings, trust: t.hub.trust, executors: t.hub.executors };
    const pausedPlan = async (kind) => {
      const p = await propose(t, owner, [{ kind: "test.probe", params: { n: 1 } }], kind);
      t.hub.bus.transaction(() => t.hub.db.prepare("UPDATE ops_plans SET status = 'PAUSED' WHERE id = ?").run(p.id));
      t.hub.db.prepare("UPDATE ops_plans SET authority_json = ?, consent_json = ?, expires_at = ? WHERE id = ?").run(JSON.stringify({ sessionId: owner.session.id, ops: ["media.render"], apps: [], folders: [], maxActions: 10, expiresAt: new Date(Date.now() + 3600000).toISOString(), steps: { 1: { ops: ["media.render"], apps: [], folders: [] } } }),
        JSON.stringify({ credential: String(owner.session.credentialId || "").slice(0, 10) }), new Date(Date.now() + 3600000).toISOString(), p.id);
      return p;
    };
    // A reader that holds (the function form hub.mjs passes): refused with ITS reason.
    const holding = createOpsPlans({ ...deps, stopScope: () => ({ heldByStop: () => ({ held: true, cls: "stop_all", code: "GATE_REARM_REQUIRED", reason: "Planul a fost oprit de Stop All: îl reiei cu „Continuă” după ce redeschizi poarta, cu Windows Hello." }) }) });
    const a = await pausedPlan("r3.inj.a");
    const e1 = await refusal(holding.resume(a.id, { session: owner.session }));
    assertRearmRequired(e1, "ops");
    assert.match(e1.message, /^Planul a fost oprit de Stop All/);
    // An unreadable stop while a stop class holds the gate: fail-closed.
    const broken = createOpsPlans({ ...deps, stopScope: { heldByStop: () => { throw new Error("citire imposibilă"); } } });
    await asChannel(t, "ui", "system.stop_all", { reason: "test" });
    const e2 = await refusal(broken.resume(a.id, { session: owner.session }));
    assertRearmRequired(e2, "ops");
    assert.match(e2.message, /Nu pot verifica/);
    assert.equal(t.hub.opsPlans.view(a.id).status, "PAUSED");
    // The same unreadable reader under a palette suspension (never a hold class): the resume goes on.
    openGate(t);
    await asChannel(t, "ui", "gate.set", { action: "suspend", reason: "Palette pause" });
    const b = await pausedPlan("r3.inj.b");
    await broken.resume(b.id, { session: owner.session });
    assert.equal((await broken.idle(b.id)).status, "DONE");
  } finally { await t.cleanup(); }
});

test("R3-06 REG-02 contract: the typed opening refused around a security event without an authenticator carries the setup link the page shows; the ceremony's own refusal is recognised", async () => {
  const t = await makeTestHub();
  try {
    openGate(t);
    t.hub.bus.emit({ type: "lega.voice_gate_bypass", scopeType: "system", scopeId: "test", source: "test", payload: { test: true } });
    await asChannel(t, "ui", "system.stop_all", { reason: "test" });
    const e = await refusal(asChannel(t, "ui", "gate.set", { action: "open", confirm: "OPEN GATE" }));
    assert.equal(e.details?.bootstrapNeeded, true, e.message);
    assert.equal(e.details?.setup?.href, REARM_SETUP.href, "the link the Integrations page renders");
    assert.equal(e.details?.setup?.label, REARM_SETUP.label);
    assert.equal(noAuthenticatorError({ message: e.message, details: e.details }), true);
    // The WebAuthn ceremony itself (what withReauth runs first) refuses with the text the card maps to the setup step.
    const ceremony = await refusal(Promise.resolve().then(() => t.hub.trust.beginAuthentication({ origin: `http://localhost:${t.config.port}` })));
    assert.equal(noAuthenticatorError(ceremony), true, ceremony.message);
    assert.equal(noAuthenticatorError({ message: "Ai anulat sau timpul a expirat în fereastra Windows Hello" }), false);
    assert.doesNotMatch(REARM_SETUP.text, ADMIN_POINTERS);
    assert.match(REARM_SETUP.text, /înregistrează întâi autentificatorul/);
  } finally { await t.cleanup(); }
});

// ---------------------------------------------------------------- Part A: the page logic
test("R3-UI-01 UI-01 the full card is always on screen before the decision: a first card never continues the click (fresh or not); only a same-facts refresh of the card on screen does", () => {
  for (const fresh of [false, true, undefined]) {
    assert.equal(continueAfterFetch({ previous: null, next: cardOf({ fresh }) }), false, `first card, fresh ${fresh}`);
    assert.equal(continueAfterFetch({ previous: null, next: cardOf({ fresh, security: securityOf() }), ack: true }), false);
  }
  const shown = cardOf();
  assert.equal(continueAfterFetch({ previous: shown, next: cardOf({ nonce: "c".repeat(32) }) }), true, "an expired card refreshed with the same facts");
  assert.equal(continueAfterFetch({ previous: shown, next: cardOf({ nonce: "c".repeat(32), hash: "9".repeat(64) }) }), false, "changed facts are shown");
  const sec = cardOf({ security: securityOf() });
  assert.equal(continueAfterFetch({ previous: sec, next: { ...sec, nonce: "d".repeat(32) }, ack: false }), false);
  assert.equal(continueAfterFetch({ previous: sec, next: { ...sec, nonce: "d".repeat(32) }, ack: true }), true);
  assert.equal(continueAfterFetch({ previous: shown, next: null }), false);
  assert.equal(continueAfterFetch({ previous: { kind: "x" }, next: shown }), false, "junk on screen is no card");
  assert.equal(REARM_SHOW_LABEL, "Arată cardul de redeschidere");
  assert.notEqual(REARM_SHOW_LABEL, REARM_BUTTON_LABEL);
  assert.match(REARM_CHANGED_NOTICE, /s-a schimbat/);
});

test("R3-UI-02 UI-02 the rearm trigger is one-shot: due only for a sequence number above the one the cockpit recorded as handled", () => {
  assert.equal(rearmTriggerDue({ trigger: 1, handled: 0 }), true);
  assert.equal(rearmTriggerDue({ trigger: 3, handled: 2 }), true);
  for (const [trigger, handled] of [[0, 0], [1, 1], [2, 5], [undefined, 0], [null, null], [-1, 0], [1.5, 0], ["2", "2"], [Number.NaN, 0], [Infinity, 0]]) {
    assert.equal(rearmTriggerDue({ trigger, handled }), false, `${trigger}/${handled}`);
  }
  assert.equal(rearmTriggerDue({ trigger: 2, handled: "junk" }), true, "an unreadable handled counts as none");
  assert.equal(rearmTriggerDue(), false);
});

test("R3-UI-03 UI-03 a card is bound only to the request IT names; a request the Hub refuses as closed is dropped and the card asked again without it", () => {
  // The Hub issued the card without its request (it refused that request as closed): the slot never re-binds it.
  assert.equal(rearmSlotFrom([{ gateRearm: cardOf(), workRequest: { id: "wrq_closed_1" } }]).slot.requestId, null);
  assert.equal(rearmSlotFrom([{ gateRearm: cardOf({ requestId: "wrq_live_1" }), workRequest: { id: "wrq_live_1" } }]).slot.requestId, "wrq_live_1");
  // No card yet (the session to open): the kept request of the answer still binds the card asked later.
  assert.equal(rearmSlotFrom([{ gateStopped: { code: "OWNER_SESSION" }, workRequest: { id: "wrq_x_1" } }]).slot.requestId, "wrq_x_1");
  const err = (category, message, details) => Object.assign(new Error(message), { category, details });
  assert.equal(rearmRequestRefused(err("conflict", "Cererea nu mai e activă (CANCELLED)")), true);
  assert.equal(rearmRequestRefused(err("not_found", "Cererea păstrată nu există")), true);
  assert.equal(rearmRequestRefused(err("conflict", "x", { code: "REQUEST_CLOSED" })), true, "a future explicit code");
  assert.equal(rearmRequestRefused(err("conflict", "Cardul de redeschidere nu mai e valabil", { code: "CARD_STALE" })), false);
  assert.equal(rearmRequestRefused(err("authentication", "Cererea …")), false);
  assert.equal(rearmRequestRefused(err("conflict", "Starea porții s-a schimbat")), false);
  assert.equal(rearmRequestRefused(null), false);
  assert.match(REARM_REQUEST_GONE_NOTICE, /nu o repropun/);
});

test("R3-UI-04 UI-04 a held spoken „Continuă” names the real first step (close Lega, then the cockpit card with Windows Hello) and its toast closes the full-screen stage", () => {
  const n = continueVoiceNotice({ type: "owner.continue_voice", payload: { legaSessionId: "lgs_a", outcome: "held" } }, { legaSessionId: "lgs_a" });
  assert.match(n.line, /Închide Lega, apoi redeschide poarta din cockpit, cu Windows Hello/);
  assert.match(n.line, /nu am reluat nimic/);
  assert.match(n.toast.text, /închide Lega, apoi redeschide poarta din cockpit, cu Windows Hello/);
  assert.equal(n.toast.closeStage, true);
  assert.equal(n.toast.openPath, "/lega");
  assert.doesNotMatch(JSON.stringify(n), ADMIN_POINTERS);
  assert.equal(continueVoiceNotice({ type: "owner.continue_voice", payload: { legaSessionId: "lgs_a", outcome: "resumed" } }, { legaSessionId: "lgs_a" }).toast.closeStage, undefined, "only the held toast closes the stage");
  // The shell honours it, only when explicitly asked.
  assert.match(source("web/src/shell/Shell.jsx"), /if \(t\.event\.closeStage === true\) setState\(\{ stageOpen: false \}\); go\(t\.event\.openPath\)/);
  assert.match(source("web/src/shell/Lega.jsx"), /closeStage: n\.toast\.closeStage === true/);
});

test("R3-UI-05/06 the Lega panel offers the card only for a suspension it can reopen (never the owner's own pause), and the setup step when no authenticator is enrolled", () => {
  assert.equal(rearmOfferFor({ gate: { status: "open" } }), null);
  assert.equal(rearmOfferFor({ gate: null }), null);
  assert.equal(rearmOfferFor({ gate: { status: "suspended", suspendedBy: { kind: "pause", credential: "0123456789abcdef01234567" } } }), null, "the owner's own pause → „Continuă”");
  for (const kind of ["stop_all", "suspend", "shutdown", "security"]) assert.equal(rearmOfferFor({ gate: { status: "suspended", suspendedBy: { kind } } }), "card", kind);
  assert.equal(rearmOfferFor({ gate: { status: "suspended", suspendedBy: { kind: "pause", credential: null } } }), "card", "an unowned pause is rearmed");
  assert.equal(rearmOfferFor({ gate: { status: "suspended", changedAt: "2026-10-01T00:00:00Z" } }), "card", "a legacy row");
  assert.equal(rearmOfferFor({ gate: { status: "suspended", suspendedBy: { kind: "stop_all" } }, bootstrapNeeded: true }), "setup");
  assert.equal(rearmOfferFor({ gate: { status: "suspended", suspendedBy: { kind: "stop_all" } }, bootstrapNeeded: "yes" }), "card", "only the boolean true");
  assert.equal(REARM_SETUP.href, "#/lega/setup");
  const panel = source("web/src/shell/Lega.jsx");
  assert.match(panel, /rearmOfferFor\(\{ gate: executionGate, bootstrapNeeded: Boolean\(ownerStatus\.data\?\.bootstrapNeeded\) \}\)/);
  assert.match(panel, /rd\.gateSuspended && rearmOffer === "card" && <RearmCard compact/);
  assert.match(panel, /rd\.gateSuspended && rearmOffer === "setup" &&/);
  const card = source("web/src/screens/lega/RearmCard.jsx");
  assert.match(card, /noAuthenticatorError\(e\)\) setSetup\(true\)/, "a ceremony refused for want of an authenticator shows the setup step");
  assert.match(source("web/src/screens/Lega.jsx"), /noAuthenticator=\{noAuthenticator\}/);
  assert.match(source("web/src/screens/Integrations.jsx"), /gate\.error\?\.details\?\.bootstrapNeeded === true && gate\.error\.details\.setup\?\.href === REARM_SETUP\.href/);
});

test("R3-UI-07 UI-07 a plan the Hub re-proposed after a rearm never takes the focus or switches the project, whatever is in flight", () => {
  const ref = (extra = {}) => ({ kind: "envelope", id: "env_r_1", projectId: "prj_a", sessionId: null, ...extra });
  assert.deepEqual(cockpitPlanAction({ ref: ref(), pid: "prj_a", sendInFlight: true, reproposed: true }), { action: "show", focus: false });
  assert.deepEqual(cockpitPlanAction({ ref: ref(), pid: "prj_a", explicit: true, reproposed: true }), { action: "show", focus: false });
  assert.deepEqual(cockpitPlanAction({ ref: ref({ sessionId: "lgs_me" }), pid: "prj_a", legaSessionId: "lgs_me", reproposed: true }), { action: "show", focus: false });
  assert.deepEqual(cockpitPlanAction({ ref: ref({ projectId: "prj_b" }), pid: "prj_a", sendInFlight: true, reproposed: true }), { action: "toast", path: "/lega/prj_b" }, "never a project switch");
  assert.deepEqual(cockpitPlanAction({ ref: { kind: "ops", id: "opp_r_1", projectId: null }, pid: "prj_a", sendInFlight: true, reproposed: true }), { action: "show", focus: false });
  // Unchanged without the flag (G5 rules).
  assert.deepEqual(cockpitPlanAction({ ref: ref(), pid: "prj_a", sendInFlight: true }), { action: "show", focus: true });
  assert.deepEqual(cockpitPlanAction({ ref: ref({ projectId: "prj_b" }), pid: "prj_a", sendInFlight: true }), { action: "navigate", path: "/lega/prj_b" });
  const cockpit = source("web/src/screens/Lega.jsx");
  assert.match(cockpit, /reproposed: reproposed \|\| isRearmReproposal\(ref\)/, "the live lega.plan of a rearmed request is a re-proposal too");
  assert.equal((cockpit.match(/\{ reproposed: true \}/g) || []).length, 2, "both plan kinds of the rearm's answer");
  assert.match(cockpit, /onApply=\{rearmApplying\}/);
  assert.match(source("web/src/screens/lega/RearmCard.jsx"), /onApply\?\.\(x\.requestId \|\| null\); return withReauth\(\(\) => api\(REARM_PATH/);
});

test("R3-UI-08 D22 the page's reading of a refused resume: only GATE_REARM_REQUIRED opens the rearm card; everything else stays an error", () => {
  const e = (code, details, message = "Planul de operare „X” a fost oprit de Stop All: îl reiei cu „Continuă” după ce redeschizi poarta aici, în cockpit, cu Windows Hello.") => Object.assign(new Error(message), { code, details });
  assert.deepEqual(rearmRequiredOf(e("GATE_REARM_REQUIRED", { code: "GATE_REARM_REQUIRED", rearm: true, kind: "ops", cls: "stop_all" })),
    { reason: "Planul de operare „X” a fost oprit de Stop All: îl reiei cu „Continuă” după ce redeschizi poarta aici, în cockpit, cu Windows Hello.", kind: "ops", cls: "stop_all" });
  assert.equal(rearmRequiredOf(e("GATE", { code: "GATE_REARM_REQUIRED", rearm: true, kind: "desktop" })).kind, "desktop", "the details' code is enough");
  assert.equal(rearmRequiredOf(e("GATE_REARM_REQUIRED", { kind: "../x" })).kind, null, "an unknown kind is not carried");
  for (const bad of [e("RECONFIRM_DELTA", { reconfirm: {} }), e("PLAN_EXPIRED"), e("OUTCOME_UNKNOWN"), e(null, null), null, {}]) assert.equal(rearmRequiredOf(bad), null);
  assert.ok(rearmRequiredOf(e("GATE_REARM_REQUIRED", {}, "")).reason.length > 0, "an honest default reason");
  // The three resume buttons use it and show the same card; none links to an administration page.
  for (const rel of ["web/src/screens/lega/OpsPlanCard.jsx", "web/src/screens/Desktop.jsx", "web/src/shell/DesktopBar.jsx"]) {
    const src = source(rel);
    assert.match(src, /rearmRequiredOf\(e\)/, rel);
    assert.match(src, /<RearmCard compact trigger=\{rearmNeed\.trigger\} handled=\{rearmNeed\.handled\}/, rel);
    assert.match(src, /Întâi redeschiderea porții/, rel);
    assert.doesNotMatch(src, ADMIN_POINTERS, rel);
  }
  // In the cockpit the plan card opens the ONE slot (never a second card).
  assert.equal((source("web/src/screens/Lega.jsx").match(/onRearm=\{revealRearm\}/g) || []).length, 2);
});

test("R3-UI-09/10 source: the trigger never confirms and never replays; the slot sits at one stable place; close is disabled while pending; the security list is no live region, newest first; the confirm button says why it is disabled; Enter is announced", () => {
  const card = source("web/src/screens/lega/RearmCard.jsx");
  // UI-02: handled in the caller, read back on a remount; the trigger only asks/shows (check), never run().
  assert.match(card, /const handledRef = useRef\(Number\(handled\) \|\| 0\);/);
  assert.match(card, /rearmTriggerDue\(\{ trigger, handled: Math\.max\(handledRef\.current, Number\(handled\) \|\| 0\) \}\)/);
  assert.match(card, /onTriggerHandled\?\.\(trigger\);/);
  const effect = card.slice(card.indexOf("const handledRef"), card.indexOf("const pending ="));
  assert.doesNotMatch(effect, /run\(/, "a trigger never runs the decision");
  assert.match(effect, /check\(\)/);
  // UI-01: no card → the button only shows it.
  assert.match(card, /card \? REARM_BUTTON_LABEL : REARM_SHOW_LABEL/);
  assert.match(card, /onClick=\{\(e\) => \(card \? run\(e\.detail === 0 \? "keyboard" : "click"\) : check\(\)\)\}/);
  // UI-08: a changed card asked again says so.
  assert.match(card, /!sameDisplayedCard\(previous, next\)\) setNotice\(REARM_CHANGED_NOTICE\)/);
  // UI-09.
  assert.match(card, /onClick=\{onClose\} disabled=\{pending\}/);
  // UI-10 + the server's order.
  assert.doesNotMatch(card, /<Notice tone="warn" title="Evenimente de securitate/, "not inside a live region");
  assert.match(card, /<section className="notice warn rearm-security-block" aria-labelledby=\{secHeadId\}>/);
  assert.match(card, /<h3 className="h3" id=\{secHeadId\}>Evenimente de securitate în jurul opririi<\/h3>/);
  assert.match(card, /security\.order === "newest_first" \? "ultimele" : "primele"/);
  assert.match(card, /aria-keyshortcuts=\{card \? "Enter" : undefined\} aria-describedby=\{howId\}/);
  assert.match(card, /aria-describedby=\{ackMissing \? `\$\{ackHintId\} \$\{howId\}` : howId\}/);
  // The cockpit: one slot, rendered once, before (outside) the loading / error / no-project branches.
  const cockpit = source("web/src/screens/Lega.jsx");
  assert.equal((cockpit.match(/\{rearmView\}/g) || []).length, 1);
  const main = cockpit.slice(cockpit.indexOf('<main className="cockpit-main"'));
  assert.ok(main.indexOf('<div className="rearm-slot">{rearmView}</div>') < main.indexOf("{!pid ?"), "the slot comes before the branches");
  assert.match(cockpit, /handled=\{rearmSlot\.handled \|\| 0\}/);
  // The slot (with its handled trigger) lives in the app store: the route key remounts the whole cockpit on a project switch.
  assert.match(cockpit, /const rearmSlot = useHub\(\(s\) => s\.rearmSlot \|\| null\);/);
  assert.doesNotMatch(cockpit, /useState\(null\);\s*\n\s*const rearmSeq/, "no per-instance slot state");
  assert.match(cockpit, /onTriggerHandled=\{\(seq\) => rearmTriggerHandled\(slotId, seq\)\}/);
  assert.match(cockpit, /onRequestDropped=\{\(\) => rearmRequestDropped\(slotId\)\}/);
  // The blocker option only shows the card.
  assert.match(source("web/src/screens/lega/cards.jsx"), /onClick=\{\(\) => onRearm\(requestId\)\}><Eye size=\{12\} aria-hidden="true" \/>\{REARM_SHOW_LABEL\}/);
  for (const rel of ["web/src/screens/lega/RearmCard.jsx", "web/src/lib/rearmLogic.js", "web/src/screens/Lega.jsx", "web/src/screens/lega/cards.jsx", "web/src/screens/lega/OpsPlanCard.jsx"]) {
    assert.doesNotMatch(source(rel), /OPEN GATE|Integrări → Avansat/, rel);
  }
  for (const rel of ["web/src/screens/lega/RearmCard.jsx", "web/src/lib/rearmLogic.js"]) assert.doesNotMatch(source(rel), /setInterval|setTimeout/, `${rel}: no timer`);
});

test("R3-UI-11 contract: the Hub's real card lists the security events NEWEST first with the true total, and the standing hint still reads the real Stop All record", async () => {
  const t = await makeTestHub({ queues: true });
  try {
    await prepareLiveWithoutGrants(t.hub);
    const owner = await enrolOwner(t);
    await t.hub.commands.dispatch({ type: "system.stop_all", payload: { reason: "test" }, channel: "owner", actor: `owner:${owner.session.id}`, ownerSession: owner.session });
    for (let i = 0; i < 23; i += 1) t.hub.bus.emit({ type: "lega.voice_gate_bypass", scopeType: "system", scopeId: "test", source: "test", payload: { i } });
    const card = await asOwner(t, owner, "gate.rearm.card", {});
    assert.equal(isRearmCard(card), true);
    assert.equal(card.security.order, "newest_first");
    assert.equal(card.security.total, 23);
    assert.equal(card.security.truncated, true);
    const seqs = card.security.events.map((ev) => t.hub.db.prepare("SELECT seq FROM events WHERE id = ?").get(ev.id).seq);
    assert.deepEqual([...seqs].sort((a, b) => b - a), seqs, "newest first");
    assert.equal(gateRearmHint(gateOf(t)).kind, "rearm");
  } finally { await t.cleanup(); }
});

// ---------------------------------------------------------------- Part B: the real UI
const status = browserStatus({ hubRoot: HUB_ROOT });
const built = fs.existsSync(path.join(WEB_DIST, "index.html"));
/** The build must contain THIS round's UI (an older dist would test the old one): the new option label. */
const hasRoundUi = () => {
  try {
    const dir = path.join(WEB_DIST, "assets");
    return fs.readdirSync(dir).filter((f) => f.endsWith(".js")).some((f) => fs.readFileSync(path.join(dir, f), "utf8").includes(REARM_SHOW_LABEL));
  } catch { return false; }
};
const skip = !status.installed || !status.cachedBrowsers.length ? "SKIPPED_ENV: Playwright/Chromium is missing"
  : !built ? `SKIPPED_ENV: the built UI is missing (${WEB_DIST})`
    : !hasRoundUi() ? `SKIPPED_ENV: the built UI predates this round (${WEB_DIST}); set HUB_V2_WEB_DIST to a fresh build`
      : false;

/** A throwaway Hub serving the built UI, a browser with a virtual authenticator, the owner enrolled through the page (voice-first). */
async function browserHub() {
  const t = await makeTestHub({ queues: true });
  fs.writeFileSync(`${t.logs.codex}.models.json`, JSON.stringify([{ id: "gpt-6.1-sol", isDefault: true, efforts: ["medium", "high"] }, { id: "gpt-fake-sol", efforts: ["medium", "high"] }]));
  const { server } = createHttpServer(t.hub);
  await new Promise((r) => server.listen(t.config.port, "127.0.0.1", r));
  const pw = createRequire(path.join(HUB_ROOT, "package.json"))("playwright");
  const origin = `http://localhost:${t.config.port}`;
  const browser = await pw.chromium.launch(browserLaunchOptions(origin));
  const close = async () => { await browser.close(); server.closeAllConnections?.(); await new Promise((r) => server.close(r)); await t.cleanup(); };
  try {
    await prepareLiveWithoutGrants(t.hub);
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(String(e?.message || e)));
    const cdp = await context.newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
    await page.goto(`${origin}/#/lega/setup`);
    await page.getByText("Windows Hello / cheia ta înregistrată").first().waitFor({ timeout: 20000 });
    await page.getByRole("button", { name: /Înregistrează acest calculator/ }).click();
    await page.getByText(/sesiune deschisă până la/).waitFor({ timeout: 20000 });
    await page.getByRole("button", { name: /Accept și activez/ }).click();
    await page.getByText(/activă \(v1\)/).waitFor({ timeout: 20000 });
    return { t, page, origin, pageErrors, close };
  } catch (error) { await close(); throw error; }
}
const count = (t, sql, ...args) => t.hub.db.prepare(sql).get(...args).n;
const stopAllUi = async (t) => { const r = await t.hub.commands.dispatch({ type: "system.stop_all", payload: { reason: "test" }, channel: "ui", actor: "user" }); await sleep(150); return r.result; };
const staleOwner = (t) => t.hub.db.prepare("UPDATE owner_sessions SET reauth_at = ? WHERE status = 'active'").run(new Date(Date.now() - 10 * 60000).toISOString());
const freshOwner = (t) => t.hub.db.prepare("UPDATE owner_sessions SET reauth_at = ? WHERE status = 'active'").run(new Date().toISOString());

test("R3-E2E-01 UI-02 / UI-01: a click elsewhere only shows the card; a failed cockpit reload and a project switch never replay it into a rearm; the card's own button still reopens", { skip, timeout: 300000 }, async () => {
  const { t, page, origin, pageErrors, close } = await browserHub();
  const rearms = () => count(t, "SELECT COUNT(*) AS n FROM commands WHERE type = 'gate.rearm'");
  const cards = () => count(t, "SELECT COUNT(*) AS n FROM commands WHERE type = 'gate.rearm.card'");
  try {
    const dir = path.join(t.dataDir, "r3-rearm");
    materializeFixture("bug-demo", dir);
    const project = (await t.hub.commands.dispatch({ type: "project.register_test", channel: "test", actor: "test", payload: { path: dir, name: "R3 Rearm" } })).result;
    await t.hub.commands.dispatch({ type: "factory.prepare", channel: "test", actor: "test", payload: { projectId: project.id, ...demoSpec("bug-demo"), limits: { writerModel: "gpt-fake-sol", reviewerModel: "sonnet" } } });
    const otherDir = path.join(t.dataDir, "r3-other");
    materializeFixture("bug-demo", otherDir);
    const otherProject = (await t.hub.commands.dispatch({ type: "project.register_test", channel: "test", actor: "test", payload: { path: otherDir, name: "R3 Alt" } })).result;

    // 1 · Stop All; a typed request on the project → the card bound to the kept request fills the slot.
    await stopAllUi(t);
    await page.goto(`${origin}/#/lega/${project.id}`);
    await page.getByLabel("Mesaj pentru Lega").waitFor({ timeout: 20000 });
    await page.getByLabel("Mesaj pentru Lega").fill("Repară bug-ul de validare a numelui format doar din spații, cu testul de acceptanță test/acceptance.test.mjs");
    await page.getByLabel("Mesaj pentru Lega").press("Enter");
    const cardBox = page.getByRole("group", { name: "Redeschiderea porții de execuție" });
    await cardBox.getByText("Ce rămâne oprit").waitFor({ timeout: 20000 });
    const kept = t.hub.db.prepare("SELECT id FROM work_requests WHERE project_id = ? ORDER BY created_at DESC LIMIT 1").get(project.id);
    assert.ok(kept?.id);
    assert.equal(rearms(), 0);

    // 2 · A stale session; the conversation's option only brings the card (already on screen) into view: nothing asked, nothing sent.
    staleOwner(t);
    const opt = page.getByRole("button", { name: REARM_SHOW_LABEL });
    assert.ok(await opt.count() >= 1, "the blocker option names what it does");
    const cardsBefore = cards();
    await opt.first().click();
    await page.waitForTimeout(1200);
    assert.equal(rearms(), 0, "an option click is never the decision");
    assert.equal(cards(), cardsBefore, "the card on screen is live: nothing asked again");
    assert.equal(gateOf(t).status, "suspended");

    // 3 · The session becomes fresh (another Windows Hello elsewhere). A cockpit reload fails, then recovers: the card stays mounted at
    //     its stable place and nothing is replayed.
    freshOwner(t);
    await page.route(`**/api/cockpit/${project.id}`, (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { category: "internal", message: "transient" } }) }));
    await page.getByRole("button", { name: "Taci" }).click();
    await page.getByRole("button", { name: "Reîncearcă" }).waitFor({ timeout: 20000 });
    assert.equal(await cardBox.count(), 1, "the rearm card survives the cockpit's error branch");
    await page.unroute(`**/api/cockpit/${project.id}`);
    await page.getByRole("button", { name: "Reîncearcă" }).click();
    await page.waitForTimeout(2500);
    assert.equal(rearms(), 0, "a recovery never replays a click");
    assert.equal(gateOf(t).status, "suspended");

    // 4 · A project switch (another project, then none, then back) remounts the whole cockpit (the route's key): the same slot — the
    //     card bound to the kept request — comes back, and its handled trigger is never replayed.
    for (const value of [otherProject.id, "", project.id]) {
      await page.locator(".cockpit-head .project-switch select").selectOption(value);
      await page.waitForTimeout(1200);
      assert.equal(await cardBox.count(), 1, `the card stays (${value || "fără proiect"})`);
      assert.equal(await cardBox.getByRole("button", { name: REARM_BUTTON_LABEL }).count(), 1, `the same card, not the banner (${value || "fără proiect"})`);
    }
    assert.equal(rearms(), 0, "a project switch never replays a click");
    assert.equal(gateOf(t).status, "suspended");

    // 5 · The card's OWN button is the decision: the gate reopens (fresh session, click), bound to the kept request.
    await cardBox.getByRole("button", { name: REARM_BUTTON_LABEL }).click();
    await waitFor(() => gateOf(t).status === "open", 20000, 100);
    const last = JSON.parse(t.hub.db.prepare("SELECT payload_json FROM commands WHERE type = 'gate.rearm' ORDER BY rowid DESC LIMIT 1").get().payload_json);
    assert.equal(last.modality, "click");
    assert.equal(last.requestId, kept.id);
    assert.equal(rearms(), 1, "exactly the owner's one decision");
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM commands WHERE type = 'gate.set'"), 0);
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM agent_runs"), 0, "nothing started");
    assert.deepEqual(pageErrors, []);
  } finally { await close(); }
});

test("R3-E2E-02 D22 in the cockpit and on the Operator page: the plan's „Continuă” after Stop All is refused → the same rearm card (shown, not confirmed); after the rearm nothing restarted; „Continuă” resumes", { skip, timeout: 300000 }, async () => {
  const { t, page, origin, pageErrors, close } = await browserHub();
  try {
    const signal = probes(t);
    const plan = async (kind) => {
      const p = (await t.hub.commands.dispatch({ type: "ops.plan.propose", channel: "ui", actor: "user", payload: { kind, title: `Plan ${kind}`, steps: [{ kind: "test.wait", params: {} }], limits: {} } })).result;
      await page.goto(`${origin}/#/lega`);
      await page.reload();
      await page.getByRole("button", { name: /Confirmă planul/ }).click({ timeout: 20000 });
      await waitFor(() => t.hub.opsPlans.view(p.id).steps.some((s) => s.status === "RUNNING"), 20000, 100);
      return p;
    };
    const resumedCount = () => events(t, "ops.plan.resumed").length;

    // 1 · The cockpit: a plan confirmed in the owner's session runs; Stop All pauses it (that stop holds it).
    signal.open = false;
    const a = await plan("r3.ui.a");
    await stopAllUi(t);
    await waitFor(() => t.hub.opsPlans.view(a.id).status === "PAUSED", 20000, 100);
    const opsCard = page.locator(".ops-plan");
    await opsCard.getByRole("button", { name: "Continuă" }).click({ timeout: 20000 });
    await opsCard.getByText("Întâi redeschiderea porții").waitFor({ timeout: 20000 });
    const slot = page.locator(".rearm-slot").getByRole("group", { name: "Redeschiderea porții de execuție" });
    await slot.getByText("Ce rămâne oprit").waitFor({ timeout: 20000 });
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM commands WHERE type = 'gate.rearm'"), 0, "the refused resume only SHOWED the card");
    assert.equal(t.hub.opsPlans.view(a.id).status, "PAUSED");
    assert.equal(resumedCount(), 0);
    await slot.getByRole("button", { name: REARM_BUTTON_LABEL }).click();
    await waitFor(() => gateOf(t).status === "open", 20000, 100);
    await page.waitForTimeout(600);
    assert.equal(t.hub.opsPlans.view(a.id).status, "PAUSED", "the rearm restarted nothing");
    assert.equal(resumedCount(), 0);
    await opsCard.getByRole("button", { name: "Continuă" }).click();
    await waitFor(() => resumedCount() === 1, 20000, 100);
    signal.open = true;
    assert.equal((await t.hub.opsPlans.idle(a.id)).status, "DONE");

    // 2 · The Operator page (no cockpit slot): the plan card shows the same rearm card inline.
    signal.open = false;
    const b = await plan("r3.ui.b");
    await stopAllUi(t);
    await waitFor(() => t.hub.opsPlans.view(b.id).status === "PAUSED", 20000, 100);
    await page.goto(`${origin}/#/desktop`);
    const plansPanel = page.getByRole("region", { name: "Planuri", exact: true });
    await plansPanel.getByRole("button", { name: "Plan r3.ui.b" }).first().click({ timeout: 20000 });
    const inlineCard = plansPanel.locator(".ops-plan");
    await inlineCard.getByRole("button", { name: "Continuă" }).click({ timeout: 20000 });
    await inlineCard.getByText("Întâi redeschiderea porții").waitFor({ timeout: 20000 });
    const inline = inlineCard.getByRole("group", { name: "Redeschiderea porții de execuție" });
    await inline.getByText("Ce rămâne oprit").waitFor({ timeout: 20000 });
    assert.equal(t.hub.opsPlans.view(b.id).status, "PAUSED");
    await inline.getByRole("button", { name: REARM_BUTTON_LABEL }).click();
    await waitFor(() => gateOf(t).status === "open", 20000, 100);
    await page.waitForTimeout(600);
    assert.equal(t.hub.opsPlans.view(b.id).status, "PAUSED", "the rearm restarted nothing");
    await inlineCard.getByRole("button", { name: "Continuă" }).click();
    await waitFor(() => resumedCount() === 2, 20000, 100);
    signal.open = true;
    assert.equal((await t.hub.opsPlans.idle(b.id)).status, "DONE");
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM commands WHERE type = 'gate.set'"), 0, "no typed OPEN GATE");
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM agent_runs"), 0);
    assert.deepEqual(pageErrors, []);
  } finally { await close(); }
});
