// M12 final review (group B) — the preparation's lifecycle as the owner reaches it: the continuation over the owner's HTTP route (F1/F3/F10),
// a phase plan stopped by „Oprește tot” that outlives its window (F9), the owner's „Continuă” after the rearm and the delta re-confirmation
// after „Închide toate sesiunile” becoming the anchor of the automatic continuation instead of a silent death (F11/F13), the offer step that
// never promises the draft and dossier the activation would refuse, the owner's one Sales decision in „Deciziile mele” (C1) and an offer
// request kept for the missing exports folder (F7). Every Hub is a fully synthetic acceptance hub (accept-helpers isolation); no model,
// nothing sent, published or spent.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { settle } from "./accept-helpers.mjs";
import { prepHub, salesAcceptanceHub, proposePreparation, confirmCard, approveAwaited, prepStatus, countRows, eventCount, settlePreparation, salesCommand, SALES_REQUEST } from "./sales-helpers.mjs";
import { DOSSIER_KIND, PREPARE_KIND } from "../server/sales/preparation.mjs";

const stopAll = (t) => t.hub.commands.dispatch({ type: "system.stop_all", payload: { reason: "Oprește tot (test)" }, channel: "test", actor: "test" });
async function rearmGate(t) {
  const card = await t.request("/api/owner/gate/rearm/card");
  assert.equal(card.status, 200, JSON.stringify(card.json));
  await t.authenticate({ reauth: true });
  const done = await t.request("/api/owner/gate/rearm", { body: { nonce: card.json.nonce, hash: card.json.hash, modality: "click" } });
  assert.equal(done.status, 200, JSON.stringify(done.json));
  assert.equal(t.hub.settings.get("executionGate").status, "open");
}
/** Holds the fixture read of the research step until released (a step in flight). */
function holdResearch(t) {
  let release;
  const gate = new Promise((r) => { release = r; });
  const state = { called: false, release: () => release() };
  const original = t.hub.sales.fixturePage;
  t.hub.sales.fixturePage = async (...args) => { state.called = true; await gate; return original(...args); };
  state.restore = () => { t.hub.sales.fixturePage = original; };
  return state;
}
async function confirmHeld(t, card, hold) {
  assert.equal((await t.request(`/api/ops/plans/${card.id}/confirm`, { body: { nonce: card.nonce, displayedHash: card.hash } })).status, 200);
  for (let i = 0; i < 200 && !hold.called; i += 1) await settle();
  assert.ok(hold.called, "the research step is reading the fixture");
}
async function waiting(c, options = {}) {
  const t = await prepHub(c, options);
  await t.authenticate(options.devProfile ? { dev: true } : {});
  const { card, preparationId } = await proposePreparation(t);
  await confirmCard(t, card);
  assert.equal(prepStatus(t, preparationId), "WAITING_OWNER");
  return { t, card, preparationId, prep: t.hub.salesPreparations.get(preparationId) };
}
/** A WebAuthn hub on a movable clock (the windows pass; the owner unlocks again after them). */
const clockHub = async (c) => {
  const clock = { now: Date.now() };
  const t = await prepHub(c, { clock: () => new Date(clock.now) });
  await t.authenticate();
  return { t, clock };
};
const routeOf = (prep) => t => t.hub.salesPreparations.forOpportunity(prep.opportunityId).preparations.find((p) => p.id === prep.id);
const lastStatusEvent = (t, id) => JSON.parse(t.hub.db.prepare("SELECT payload_json FROM events WHERE type = 'sales.preparation.status' AND scope_id = ? ORDER BY seq DESC LIMIT 1").get(id).payload_json);
const continueRoute = (t, id, options = {}) => t.request(`/api/sales/preparations/${id}/continue`, { body: {}, ...options });
const activeSession = (t) => t.hub.db.prepare("SELECT id FROM owner_sessions WHERE status = 'active' ORDER BY rowid DESC LIMIT 1").get().id;
const rowCounts = (t) => ["sales_orgs", "sales_opportunities", "sales_proposals", "sales_qualifications", "sales_evidence", "sales_drafts", "sales_dossiers"].map((x) => countRows(t, `SELECT COUNT(*) AS n FROM ${x}`));
const phaseB = (t) => countRows(t, "SELECT COUNT(*) AS n FROM ops_plans WHERE kind = ?", DOSSIER_KIND);
const nothingSent = (t) => {
  for (const table of ["sales_sends", "sales_contact_events", "sales_client_acceptances", "sales_handoffs", "missions", "agent_runs"]) assert.equal(countRows(t, `SELECT COUNT(*) AS n FROM ${table}`), 0, table);
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM sales_opportunities WHERE status IN ('CONTACTED','WON','IN_DISCUSSION')"), 0);
};

test("M12-REACH-01 (F1/F3/F10) a STALE preparation continues from the owner's route: the server's flags, ONE card through the owner dispatcher (no session → 401, agent / cli refused), confirmed once → READY, no duplicate company", async (c) => {
  const { t, preparationId, prep } = await waiting(c);
  await salesCommand(t, "sales.evidence.add", { subjectType: "org", subjectId: prep.orgId, claim: "telefon", value: "0700000000", label: "USER_PROVIDED", sourceKind: "manual",
    sourceRef: "proprietar, la telefon", dataKind: "STATEMENT" });
  assert.equal(prepStatus(t, preparationId), "STALE");
  const view = routeOf(prep)(t);
  assert.deepEqual([view.continuable, view.waitsForRearm, view.awaitedCurrent], [true, false, false], "the read route says it can continue, nothing holds it, the old offer is no longer current");
  const plansBefore = countRows(t, "SELECT COUNT(*) AS n FROM ops_plans");
  // The owner dispatcher: no session → 401 needSession; a declared agent or script → refused; nothing proposed.
  const anonymous = await continueRoute(t, preparationId, { sessionCookie: "" });
  assert.equal(anonymous.status, 401, JSON.stringify(anonymous.json));
  assert.equal(anonymous.json.error.details?.needSession, true);
  for (const channel of ["agent", "cli"]) {
    const r = await continueRoute(t, preparationId, { headers: { "X-Hub-Channel": channel } });
    assert.equal(r.status, 403, `${channel}: ${JSON.stringify(r.json)}`);
  }
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM ops_plans"), plansBefore, "no card for a refused request");
  // The owner: ONE card, PROPOSED, nothing runs before its confirmation.
  const before = rowCounts(t);
  const r = await continueRoute(t, preparationId);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.plan.status, "PROPOSED");
  assert.equal(r.json.plan.kind, PREPARE_KIND);
  assert.equal(r.json.preparation.id, preparationId);
  assert.ok(r.json.plan.nonce && r.json.plan.hash, "the card the owner confirms");
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM ops_plans"), plansBefore + 1);
  assert.equal(prepStatus(t, preparationId), "STALE", "nothing ran before the confirmation");
  const command = t.hub.db.prepare("SELECT channel, actor FROM commands WHERE type = 'sales.preparation.continue' ORDER BY rowid DESC LIMIT 1").get();
  assert.equal(command.channel, "owner", "dispatched on the owner channel");
  assert.match(command.actor, /^owner:/);
  // The owner confirms it once; the changed input makes a new offer version; the same company, research and qualification are reused.
  await confirmCard(t, { ...r.json.plan, preparationId });
  const again = await settlePreparation(t, preparationId);
  assert.equal(again.status, "WAITING_OWNER", again.statusReason);
  assert.equal(again.rootPlanId, prep.rootPlanId, "the same root plan (C-01 keys)");
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM sales_orgs"), before[0], "no second synthetic company");
  assert.equal(eventCount(t, "sales.synthetic.created"), 1);
  assert.equal((await approveAwaited(t, again)).status, 200);
  const done = await settlePreparation(t, preparationId);
  assert.equal(done.status, "READY", done.statusReason);
  nothingSent(t);
  t.assertPaths();
});

test("M12-REACH-02 (F1 × R18 × C2) the route refuses what cannot be continued: a card never confirmed (409, no card); a preparation „Oprește tot” still holds (409 GATE_REARM_REQUIRED, waitsForRearm) until the rearm", async (c) => {
  let now = Date.now();
  const t = await prepHub(c, { clock: () => new Date(now) });
  await t.authenticate();
  const never = await proposePreparation(t);
  now += 16 * 60000;
  await t.authenticate({ reauth: true });
  assert.equal((await t.request(`/api/ops/plans/${never.card.id}/confirm`, { body: { nonce: never.card.nonce, displayedHash: never.card.hash } })).status, 409);
  for (let i = 0; i < 3; i += 1) await settle();
  assert.equal(prepStatus(t, never.preparationId), "EXPIRED");
  const plans = countRows(t, "SELECT COUNT(*) AS n FROM ops_plans");
  const refused = await continueRoute(t, never.preparationId);
  assert.equal(refused.status, 409, JSON.stringify(refused.json));
  assert.equal(refused.json.error.code, "SALES_PREPARATION_STATE");
  assert.match(refused.json.error.message, /nu a fost confirmat niciodată/);
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM ops_plans"), plans);
  // A waiting preparation stopped by „Oprește tot”: the route says the rearm comes first, then gives the card.
  const { card, preparationId } = await proposePreparation(t, "pregătește o ofertă pentru o pizzerie din Iași care vrea comenzi online");
  await confirmCard(t, card);
  assert.equal(prepStatus(t, preparationId), "WAITING_OWNER");
  await stopAll(t);
  await settle(); await settle();
  assert.equal(prepStatus(t, preparationId), "STOPPED");
  const prep = t.hub.salesPreparations.get(preparationId);
  assert.equal(routeOf(prep)(t).waitsForRearm, true);
  const held = await continueRoute(t, preparationId);
  assert.equal(held.status, 409, JSON.stringify(held.json));
  assert.equal(held.json.error.code, "GATE_REARM_REQUIRED");
  assert.equal(held.json.error.details?.rearm, true);
  assert.match(held.json.error.message, /Redeschide poarta/);
  assert.doesNotMatch(held.json.error.message, /apoi „Continuă”\.$/, "the card is asked for again from the opportunity, not with a „Continuă” that has nothing to resume");
  await rearmGate(t);
  assert.equal(routeOf(prep)(t).waitsForRearm, false);
  const ok = await continueRoute(t, preparationId);
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.plan.status, "PROPOSED");
});

test("M12-REACH-03 (F9) a phase-A plan paused by „Oprește tot” that outlives its window: EXPIRED WITH the stop record; no continuation card before the rearm; after it ONE card continues", async (c) => {
  const { t, clock } = await clockHub(c);
  const { card, preparationId } = await proposePreparation(t);
  const hold = holdResearch(t);
  await confirmHeld(t, card, hold);
  await stopAll(t);
  hold.release();
  await t.hub.opsPlans.idle(card.id);
  await settle(); await settle();
  assert.equal(t.hub.opsPlans.view(card.id).status, "PAUSED");
  assert.equal(prepStatus(t, preparationId), "PREPARING");
  clock.now += 5 * 3600000;
  await t.authenticate({ reauth: true });
  await t.hub.salesPreparations.tick();
  const p = t.hub.salesPreparations.get(preparationId);
  assert.equal(p.status, "EXPIRED");
  assert.match(p.statusReason, /oprit de „Oprește tot”/, "the truthful cause, not „(pauză)”");
  assert.match(p.statusReason, /după ce redeschizi poarta/);
  assert.equal(lastStatusEvent(t, preparationId).stop?.kind, "stop_all", "the stop is recorded on the EXPIRED event");
  assert.ok(t.hub.salesPreparations.stopHold(p), "the Stop All still holds the continuation");
  const view = routeOf(p)(t);
  assert.deepEqual([view.continuable, view.waitsForRearm], [true, true]);
  const plans = countRows(t, "SELECT COUNT(*) AS n FROM ops_plans");
  const refused = await continueRoute(t, preparationId);
  assert.equal(refused.status, 409, JSON.stringify(refused.json));
  assert.equal(refused.json.error.code, "GATE_REARM_REQUIRED");
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM ops_plans"), plans, "no card before the rearm");
  await rearmGate(t);
  await t.authenticate({ reauth: true });
  assert.equal(routeOf(p)(t).waitsForRearm, false);
  const out = await continueRoute(t, preparationId);
  assert.equal(out.status, 200, JSON.stringify(out.json));
  await confirmCard(t, { ...out.json.plan, preparationId });
  const again = await settlePreparation(t, preparationId);
  assert.equal(again.status, "WAITING_OWNER", again.statusReason);
  assert.equal(eventCount(t, "sales.synthetic.created"), 1, "the same synthetic company (ledger)");
});

test("M12-REACH-04 (F9) the owner's own pause, then „Oprește tot” while it stood paused, then the window passes: EXPIRED with the stop; the continuation waits for the rearm too", async (c) => {
  const { t, clock } = await clockHub(c);
  const { card, preparationId } = await proposePreparation(t);
  const hold = holdResearch(t);
  await confirmHeld(t, card, hold);
  t.hub.opsPlans.pause(card.id, { reason: "Pauză", actor: "owner" });
  hold.release();
  await t.hub.opsPlans.idle(card.id);
  await settle(); await settle();
  assert.match(t.hub.salesPreparations.get(preparationId).statusReason, /îl reiei cu „Continuă”/);
  assert.doesNotMatch(t.hub.salesPreparations.get(preparationId).statusReason, /redeschizi poarta/, "before the stop: the owner's own pause resumes with „Continuă” alone");
  await stopAll(t);
  await settle(); await settle();
  assert.equal(t.hub.opsPlans.view(card.id).status, "PAUSED");
  assert.match(t.hub.salesPreparations.get(preparationId).statusReason, /după ce redeschizi poarta/, "the stop (no event of the plan's own) is said: the rearm comes first (the resume guard would refuse „Continuă”)");
  clock.now += 5 * 3600000;
  await t.authenticate({ reauth: true });
  await t.hub.salesPreparations.tick();
  const p = t.hub.salesPreparations.get(preparationId);
  assert.equal(p.status, "EXPIRED");
  assert.equal(lastStatusEvent(t, preparationId).stop?.kind, "stop_all");
  assert.equal(routeOf(p)(t).waitsForRearm, true);
  await assert.rejects(salesCommand(t, "sales.preparation.continue", { preparationId }), (e) => e.code === "GATE_REARM_REQUIRED");
});

test("M12-REACH-05 (F13, the first rule) „Oprește tot” during phase A → rearm → „Continuă” (owner session): that resume is the anchor — WAITING_OWNER promises the draft and dossier and the owner's approval delivers them", async (c) => {
  const t = await prepHub(c); await t.authenticate();
  const { card, preparationId } = await proposePreparation(t);
  const hold = holdResearch(t);
  await confirmHeld(t, card, hold);
  await stopAll(t);
  hold.release();
  await t.hub.opsPlans.idle(card.id);
  await settle(); await settle();
  assert.equal(t.hub.opsPlans.view(card.id).status, "PAUSED");
  // Before the rearm the plan's own „Continuă” is refused (the engine's hold), and so is a continuation card (nothing to continue yet).
  assert.equal((await t.request(`/api/ops/plans/${card.id}/resume`, { body: {} })).json.error.code, "GATE_REARM_REQUIRED");
  await rearmGate(t);
  hold.restore();
  let res = await t.request(`/api/ops/plans/${card.id}/resume`, { body: {} });
  if (res.status !== 200 && res.json?.error?.code === "RECONFIRM_DELTA") {
    // The rearm's fresh Windows Hello may have opened a new session: the same credential confirms only the difference.
    const rc = res.json.error.details.reconfirm;
    await t.hub.opsPlans.reconfirm({ planId: card.id, nonce: rc.nonce, displayedHash: rc.hash, session: { id: activeSession(t) } });
    res = { status: 200 };
  }
  assert.equal(res.status, 200, JSON.stringify(res.json));
  await t.hub.opsPlans.idle(card.id);
  const waitingNow = await settlePreparation(t, preparationId);
  assert.equal(t.hub.opsPlans.view(card.id).status, "DONE");
  assert.equal(waitingNow.status, "WAITING_OWNER", waitingNow.statusReason);
  assert.match(waitingNow.statusReason, /fără altă întrebare/);
  const anchor = t.hub.salesPreparations.anchorOf(t.hub.opsPlans.view(card.id));
  assert.ok(["resume", "reconfirm"].includes(anchor.via), `anchor ${anchor.via}`);
  assert.ok(anchor.seq > countRows(t, "SELECT MAX(seq) AS n FROM events WHERE type = 'system.stop_all'"), "the anchor is the owner's confirmation after the stop");
  assert.equal((await approveAwaited(t, waitingNow)).status, 200);
  const done = await settlePreparation(t, preparationId);
  assert.equal(done.status, "READY", done.statusReason);
  assert.equal(t.hub.opsPlans.view(done.phaseBPlanId).consent.sessionId, anchor.sessionId, "phase B rides on the owner's latest confirmation");
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM sales_drafts"), 1);
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM sales_dossiers WHERE status = 'READY'"), 1);
  nothingSent(t);
});

test("M12-REACH-06 (F13, the second rule) a plan paused by the owner and then „Oprește tot”: „Continuă” under that stop is refused upfront (GATE_REARM_REQUIRED, nothing runs); after the rearm it continues to READY", async (c) => {
  const t = await prepHub(c); await t.authenticate();
  const { card, preparationId } = await proposePreparation(t);
  const hold = holdResearch(t);
  await confirmHeld(t, card, hold);
  t.hub.opsPlans.pause(card.id, { reason: "Pauză", actor: "owner" });
  hold.release();
  await t.hub.opsPlans.idle(card.id);
  await stopAll(t);
  await settle(); await settle();
  hold.restore();
  const stop = JSON.parse(t.hub.db.prepare("SELECT payload_json FROM events WHERE type = 'system.stop_all' ORDER BY seq DESC LIMIT 1").get().payload_json);
  assert.equal(stop.scope.plansPaused.includes(card.id), false, "the stop did not pause it (the owner had): the engine alone would let it resume");
  const steps = countRows(t, "SELECT COUNT(*) AS n FROM sales_plan_ops");
  const refused = await t.request(`/api/ops/plans/${card.id}/resume`, { body: {} });
  assert.equal(refused.status, 409, JSON.stringify(refused.json));
  assert.equal(refused.json.error.code, "GATE_REARM_REQUIRED");
  assert.equal(refused.json.error.details?.rearm, true);
  assert.match(refused.json.error.message, /Oprește tot.*după ce redeschizi poarta/i);
  assert.equal(t.hub.opsPlans.view(card.id).status, "PAUSED", "nothing resumed");
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM sales_plan_ops"), steps, "nothing ran");
  assert.equal(eventCount(t, "ops.plan.resumed"), 0);
  assert.match(t.hub.salesPreparations.get(preparationId).statusReason, /după ce redeschizi poarta/, "the reason says the rearm comes first");
  await rearmGate(t);
  await settle(); await settle();
  assert.doesNotMatch(t.hub.salesPreparations.get(preparationId).statusReason, /redeschizi poarta/, "after the rearm the reason no longer asks for it");
  let res = await t.request(`/api/ops/plans/${card.id}/resume`, { body: {} });
  if (res.status !== 200 && res.json?.error?.code === "RECONFIRM_DELTA") {
    const rc = res.json.error.details.reconfirm;
    await t.hub.opsPlans.reconfirm({ planId: card.id, nonce: rc.nonce, displayedHash: rc.hash, session: { id: activeSession(t) } });
    res = { status: 200 };
  }
  assert.equal(res.status, 200, JSON.stringify(res.json));
  await t.hub.opsPlans.idle(card.id);
  const w = await settlePreparation(t, preparationId);
  assert.equal(w.status, "WAITING_OWNER", w.statusReason);
  assert.equal((await approveAwaited(t, w)).status, 200);
  assert.equal((await settlePreparation(t, preparationId)).status, "READY");
});

test("M12-REACH-07 (F11) „Închide toate sesiunile” mid phase A after the consent session idled → „Continuă” in a new session = the delta re-confirmation → the anchor moves to it: the owner's approval delivers the draft and dossier", async (c) => {
  let now = Date.now();
  const t = await prepHub(c, { clock: () => new Date(now) });
  await t.authenticate();
  const { card, preparationId } = await proposePreparation(t);
  const hold = holdResearch(t);
  await confirmHeld(t, card, hold);
  const s1 = t.hub.opsPlans.view(card.id).consent.sessionId;
  now += 31 * 60000;
  await t.request("/api/owner/status", { method: "GET" });
  assert.equal((await t.request("/api/owner/sessions/revoke-all", { sessionCookie: "" })).status, 200);
  hold.release();
  await t.hub.opsPlans.idle(card.id);
  hold.restore();
  assert.equal(t.hub.opsPlans.view(card.id).status, "NEEDS_OWNER");
  await settle(); await settle();
  assert.match(t.hub.salesPreparations.get(preparationId).statusReason, /îl reiei cu „Continuă”/, "the reason points to „Continuă” — and now it leads somewhere");
  await t.authenticate({ reauth: true });
  const s2 = activeSession(t);
  assert.notEqual(s2, s1);
  const delta = await t.request(`/api/ops/plans/${card.id}/resume`, { body: {} });
  assert.equal(delta.json?.error?.code, "RECONFIRM_DELTA", JSON.stringify(delta.json));
  const rc = delta.json.error.details.reconfirm;
  await t.hub.opsPlans.reconfirm({ planId: card.id, nonce: rc.nonce, displayedHash: rc.hash, session: { id: s2 } });
  await t.hub.opsPlans.idle(card.id);
  const w = await settlePreparation(t, preparationId);
  assert.equal(w.status, "WAITING_OWNER", w.statusReason);
  assert.equal(w.consent.sessionId, s1, "the preparation keeps its first consent on record");
  const anchor = t.hub.salesPreparations.anchorOf(t.hub.opsPlans.view(card.id));
  assert.equal(anchor.sessionId, s2, "the anchor is the re-confirmation in the new session (same credential)");
  assert.equal((await approveAwaited(t, w)).status, 200);
  const done = await settlePreparation(t, preparationId);
  assert.equal(done.status, "READY", done.statusReason);
  assert.equal(t.hub.opsPlans.view(done.phaseBPlanId).consent.sessionId, s2);
  // A later revoke-all ends that authority too: nothing derives from it any more (the rule stays one rule).
  assert.equal(t.hub.trust.confirmedAuthority(s2).ok, true);
  nothingSent(t);
});

test("M12-REACH-08 (F13) the offer step never promises what the activation would refuse: a Stop All since the plan's last confirmation → STOPPED with that reason and the stop recorded, never WAITING_OWNER", async (c) => {
  const t = await prepHub(c); await t.authenticate();
  const { card, preparationId } = await proposePreparation(t);
  const hold = holdResearch(t);
  await confirmHeld(t, card, hold);
  // The step in flight passed its checks before the stop; the offer step's own guard is what is checked here (white box: its transaction).
  await stopAll(t);
  hold.release();
  await t.hub.opsPlans.idle(card.id);
  hold.restore();
  const p = t.hub.salesPreparations.get(preparationId);
  assert.equal(p.status, "PREPARING");
  // An offer row of the opportunity (the step would have written its own version; the guard is what is checked here).
  const offer = (await salesCommand(t, "sales.proposal.create", { opportunityId: p.opportunityId })).result;
  t.hub.bus.transaction(() => t.hub.salesPreparations.toWaiting(t.hub.salesPreparations.get(preparationId), offer));
  const after = t.hub.salesPreparations.get(preparationId);
  assert.equal(after.status, "STOPPED", after.statusReason);
  assert.match(after.statusReason, /Oprește tot/);
  assert.doesNotMatch(after.statusReason, /fără altă întrebare/);
  assert.equal(lastStatusEvent(t, preparationId).stop?.kind, "stop_all");
  assert.deepEqual(after.awaited, { proposalId: offer.id, proposalSha: offer.contentSha }, "the offer stays recorded: a continuation waits on it again");
  assert.ok(t.hub.salesPreparations.stopHold(after), "the continuation waits for the rearm");
  assert.equal(phaseB(t), 0);
});

test("M12-REACH-08b (F11) the offer step under a revoked authority behind the plan's last confirmation: STOPPED with that reason, never WAITING_OWNER", async (c) => {
  // The revoked authority behind the plan's last confirmation: STOPPED with that reason too.
  const r = await prepHub(c); await r.authenticate();
  const second = await proposePreparation(r);
  const held = holdResearch(r);
  await confirmHeld(r, second.card, held);
  assert.equal((await r.request("/api/owner/sessions/revoke-all")).status, 200);
  held.release();
  await r.hub.opsPlans.idle(second.card.id);
  held.restore();
  assert.equal(r.hub.opsPlans.view(second.card.id).status, "NEEDS_OWNER");
  const p2 = r.hub.salesPreparations.get(second.preparationId);
  assert.equal(p2.status, "PREPARING");
  const offer2 = (await salesCommand(r, "sales.proposal.create", { opportunityId: p2.opportunityId })).result;
  r.hub.bus.transaction(() => r.hub.salesPreparations.toWaiting(r.hub.salesPreparations.get(second.preparationId), offer2));
  const after2 = r.hub.salesPreparations.get(second.preparationId);
  assert.equal(after2.status, "STOPPED", after2.statusReason);
  assert.match(after2.statusReason, /revocată/);
  assert.doesNotMatch(after2.statusReason, /fără altă întrebare/);
});

test("M12-REACH-09 (C1) „Deciziile mele” lists the owner's one Sales decision while it is one: the exact offer (id, version, full SHA), the window and the link; gone once decided, STALE or expired", async (c) => {
  const { t, preparationId, prep } = await waiting(c);
  const inbox = async () => { const r = await t.request("/api/decisions/inbox", { method: "GET" }); assert.equal(r.status, 200, JSON.stringify(r.json)); return r.json.items.filter((i) => i.kind === "sales_offer"); };
  const [row] = await inbox();
  assert.ok(row, "the offer waiting for the owner is listed");
  assert.equal(row.id, prep.awaited.proposalId);
  assert.deepEqual(row.target, { proposalId: prep.awaited.proposalId, version: 1, proposalSha: prep.awaited.proposalSha });
  assert.match(row.target.proposalSha, /^[0-9a-f]{64}$/, "the FULL SHA");
  assert.equal(row.activateBy, prep.activateBy);
  assert.ok(row.remainingMin > 200 && row.remainingMin <= 270, String(row.remainingMin));
  // A recorded target that is no longer the current version (a write without its hook): not offered as the decision.
  t.hub.db.prepare("UPDATE sales_preparations SET awaited_proposal_sha = ? WHERE id = ?").run("b".repeat(64), preparationId);
  assert.equal(t.hub.salesPreparations.get(preparationId).status, "WAITING_OWNER");
  assert.equal((await inbox()).length, 0, "the awaited target no longer current: not listed");
  t.hub.db.prepare("UPDATE sales_preparations SET awaited_proposal_sha = ? WHERE id = ?").run(prep.awaited.proposalSha, preparationId);
  assert.equal((await inbox()).length, 1);
  assert.equal(row.link, `/sales?tab=opp&id=${encodeURIComponent(prep.opportunityId)}`);
  assert.equal(row.real, false);
  assert.equal(row.synthetic, true);
  assert.match(row.why, /Aprob intern/);
  assert.match(row.ifAccept, /Nu se trimite nimic/);
  // Decided → gone.
  assert.equal((await approveAwaited(t, prep)).status, 200);
  assert.equal((await inbox()).length, 0, "decided: no longer waiting");
  await settlePreparation(t, preparationId);
  // STALE → gone (a second preparation, then an input change).
  const second = await proposePreparation(t, "pregătește o ofertă pentru o florărie din Sibiu care vrea un magazin online");
  await confirmCard(t, second.card);
  assert.equal((await inbox()).length, 1);
  const p2 = t.hub.salesPreparations.get(second.preparationId);
  await salesCommand(t, "sales.evidence.add", { subjectType: "org", subjectId: p2.orgId, claim: "telefon", value: "0700000001", label: "USER_PROVIDED", sourceKind: "manual",
    sourceRef: "proprietar", dataKind: "STATEMENT" });
  assert.equal(prepStatus(t, second.preparationId), "STALE");
  assert.equal((await inbox()).length, 0, "STALE: no longer the decision");
  // Expired window → gone (before the tick even runs).
  const third = await proposePreparation(t, "pregătește o ofertă pentru o pizzerie din Iași care vrea comenzi online");
  await confirmCard(t, third.card);
  assert.equal((await inbox()).length, 1);
  t.hub.db.prepare("UPDATE sales_preparations SET activate_by = ? WHERE id = ?").run(new Date(Date.now() - 60000).toISOString(), third.preparationId);
  assert.equal((await inbox()).length, 0, "the window passed: not offered as a decision any more");
});

test("M12-REACH-10 (F7) an offer request kept for the missing exports folder: explained by the folder (never the gate), re-proposed as ONE card once the folder is chosen", async (c) => {
  const t = await salesAcceptanceHub(c);
  await t.authenticate();
  const r = await t.request("/api/owner/intent", { body: { text: SALES_REQUEST, source: "typed" } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const res = r.json.results[0];
  assert.equal(res.blockedBy?.signature, "SALES_DOSSIER_NO_EXPORTS_DIR", JSON.stringify(res).slice(0, 400));
  const wr = t.hub.db.prepare("SELECT * FROM work_requests").all();
  assert.equal(wr.length, 1);
  assert.equal(wr[0].intent, "sales", "kept as an offer request");
  assert.equal(wr[0].status, "BLOCKED");
  // Explained again from verified state: the folder, never the execution gate or Windows Hello.
  const again = await t.hub.workRequests.replan(wr[0].id);
  assert.equal(again.status, "BLOCKED");
  assert.equal(again.explanation.signature, "SALES_DOSSIER_NO_EXPORTS_DIR");
  assert.match(again.explanation.text, /folderul de exporturi/);
  assert.doesNotMatch(again.explanation.text, /Redeschide poarta|Windows Hello|Execuțiile noi sunt oprite/);
  assert.equal(t.hub.db.prepare("SELECT blocker_signature FROM work_requests WHERE id = ?").get(wr[0].id).blocker_signature, "SALES_DOSSIER_NO_EXPORTS_DIR");
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM ops_plans"), 0);
  // The owner chooses the folder: the kept request becomes ONE card (a proposal only; nothing runs).
  const exportsDir = path.join(t.root, "exports");
  t.hub.bus.transaction(() => t.hub.settings.set("mediaPolicy", { ...(t.hub.settings.get("mediaPolicy") || {}), exportsDir }, "test", "Folderul de exporturi al testului"));
  let row = null;
  for (let i = 0; i < 200; i += 1) { await settle(); row = t.hub.db.prepare("SELECT * FROM work_requests WHERE id = ?").get(wr[0].id); if (row.status === "PLANNED") break; }
  assert.equal(row.status, "PLANNED", row.blocker_signature);
  const planRef = JSON.parse(row.plan_ref);
  assert.equal(planRef.kind, "ops");
  const plan = t.hub.opsPlans.view(planRef.id);
  assert.equal(plan.kind, PREPARE_KIND);
  assert.equal(plan.status, "PROPOSED");
  assert.equal(eventCount(t, "lega.plan"), 1, "the owner is told the card is ready");
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM sales_preparations WHERE status = 'PLANNED'"), 1);
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM sales_orgs"), 0, "nothing ran");
  // Confirmed once, it is the ordinary preparation.
  await confirmCard(t, plan);
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM sales_preparations WHERE status = 'WAITING_OWNER'"), 1);
});
