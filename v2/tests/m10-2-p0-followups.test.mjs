// Milestone 10.2.1 — follow-ups found by the P0 integration pass (owner decisions D15, D16, D21). (1) The typed admin OPEN GATE never
// reopens a suspension next to a security event (only the cockpit rearm, with the acknowledged events). (2) The deferred Stop All
// closure revokes only the plans that existed at the stop, never one proposed after it. (3) A suspension never sweeps the preserved
// requests (a deferred replan could otherwise run after a rearm). (4) environment.attest forwards an expected fingerprint from any
// channel, so the setup's automatic step never attests a new configuration in a race. (5) The rearm card's nonce never reaches the
// command log of owner.intent. PASS_SIMULATED: fixture providers, simulated distro, software authenticator; no model, no network.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { makeTestHub, waitFor, enrolOwner, prepareLiveWithoutGrants } from "./helpers.mjs";
import { materializeFixture, demoSpec } from "../server/factory/fixtures.mjs";

const M09_MODELS = { writerModel: "gpt-fake-sol", reviewerModel: "sonnet" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dispatch = (hub, type, payload, extra = {}) => hub.commands.dispatch({ type, payload, channel: "test", actor: "test", ...extra });
const asOwner = (t, type, payload = {}, session = t.owner.session) =>
  t.hub.commands.dispatch({ type, payload, channel: "owner", actor: `owner:${session.id}`, ownerSession: session }).then((r) => r.result);
const ownerStop = (t) => t.hub.commands.dispatch({ type: "system.stop_all", payload: { reason: "test" }, channel: "owner", actor: `owner:${t.owner.session.id}`, ownerSession: t.owner.session });
const openGate = (t) => dispatch(t.hub, "gate.set", { action: "open", confirm: "OPEN GATE", reason: "test" });

async function ownerHub({ clock = null } = {}) {
  const t = await makeTestHub({ queues: true, ...(clock ? { clock } : {}) });
  await prepareLiveWithoutGrants(t.hub);
  const dir = path.join(t.dataDir, "followups-alfa");
  materializeFixture("bug-demo", dir);
  const project = (await dispatch(t.hub, "project.register_test", { path: dir, name: "Followups Alfa" })).result;
  const owner = await enrolOwner(t);
  await dispatch(t.hub, "owner.autonomy.set", { projectId: project.id, level: "TRUSTED" }, { ownerSession: owner.reauth() });
  const prepare = async () => (await dispatch(t.hub, "factory.prepare", { projectId: project.id, ...demoSpec("bug-demo"), limits: M09_MODELS })).result.mission;
  return { ...t, project, owner, prepare };
}

test("FU-01 the typed admin OPEN GATE refuses a suspension next to a security event; the cockpit card lists it and reopens only with the acknowledgement", async () => {
  const t = await ownerHub();
  try {
    t.hub.bus.emit({ type: "lega.session.violation", scopeType: "system", scopeId: "lega_test", source: "test", payload: { kind: "forbidden_item" } });
    await ownerStop(t);
    await sleep(50);
    await assert.rejects(openGate(t), (e) => e.category === "policy" && (e.details || e.data)?.code === "SECURITY_ACK" && /eveniment de securitate/.test(e.message));
    assert.equal(t.hub.settings.get("executionGate").status, "suspended", "the admin path did not reopen it");
    const card = await asOwner(t, "gate.rearm.card", {});
    assert.equal(card.kind, "gate_rearm");
    assert.ok(card.security?.ackRequired && card.security.events.some((e) => e.type === "lega.session.violation"));
    await assert.rejects(asOwner(t, "gate.rearm", { nonce: card.nonce, hash: card.hash }, t.owner.reauth()), (e) => (e.details || e.data)?.code === "SECURITY_ACK");
    const again = await asOwner(t, "gate.rearm.card", {});
    const out = await asOwner(t, "gate.rearm", { nonce: again.nonce, hash: again.hash, ackSecurity: true }, t.owner.reauth());
    assert.equal(out.reopened, true);
    assert.equal(t.hub.settings.get("executionGate").status, "open");
  } finally { await t.cleanup(); }
});

test("FU-02 without a security event the typed admin OPEN GATE still reopens a Stop All (the legacy / diagnostic path is kept)", async () => {
  const t = await ownerHub();
  try {
    await ownerStop(t);
    await sleep(50);
    const r = await openGate(t);
    assert.equal(r.result.executionGate.status, "open");
    assert.equal(r.result.executionGate.reopenedAfter.via, "open_gate");
  } finally { await t.cleanup(); }
});

test("FU-03 the deferred Stop All closure revokes only the plans proposed before the stop, never one proposed after it", async () => {
  let offset = 0;
  const t = await ownerHub({ clock: () => new Date(Date.now() + offset) });
  try {
    // The plan is stamped AFTER the stop event below (the clock is moved forward for the proposal, then back for the stop): what a
    // rearm re-proposes in the same instant as the deferred closure.
    offset = 60000;
    const after = (await dispatch(t.hub, "envelope.propose", { projectId: t.project.id, missionIds: [(await t.prepare()).id] })).result.envelope;
    offset = 30000;
    t.hub.bus.emit({ type: "system.stop_all", scopeType: "system", scopeId: "hub", source: "test", payload: { reason: "test" } });
    await sleep(80);
    const proposedAt = t.hub.db.prepare("SELECT created_at FROM mission_envelopes WHERE id = ?").get(after.id).created_at;
    const stoppedAt = t.hub.db.prepare("SELECT created_at FROM events WHERE type = 'system.stop_all' ORDER BY seq DESC LIMIT 1").get().created_at;
    assert.ok(proposedAt > stoppedAt, "the plan really is stamped after the stop");
    assert.equal(t.hub.envelopes.get(after.id).status, "PROPOSED", "a plan proposed after the stop is never closed by it");
    offset = 120000;
    t.hub.bus.emit({ type: "system.stop_all", scopeType: "system", scopeId: "hub", source: "test", payload: { reason: "test" } });
    await waitFor(() => (t.hub.envelopes.get(after.id).status === "REVOKED" ? true : null), 5000, 20);
    assert.equal(t.hub.envelopes.get(after.id).status, "REVOKED", "the same plan is closed by a stop that came after it");
  } finally { await t.cleanup(); }
});

test("FU-04 a suspension never sweeps the preserved requests (no deferred replan that could land after a rearm)", async () => {
  const t = await ownerHub();
  try {
    const r = t.hub.workRequests.create({ projectId: t.project.id, intent: "engineering", text: "Repară testul test/acceptance.test.mjs din Followups Alfa", source: "typed" });
    t.hub.db.prepare("UPDATE work_requests SET status = 'BLOCKED' WHERE id = ?").run(r.id);
    // The sweep's effect is observed in the table and the log: a replan touches the row (updated_at) or proposes a plan.
    const before = t.hub.db.prepare("SELECT updated_at, status FROM work_requests WHERE id = ?").get(r.id);
    const plans0 = t.hub.db.prepare("SELECT COUNT(*) AS n FROM mission_envelopes").get().n;
    await ownerStop(t);
    await sleep(150);
    const after = t.hub.db.prepare("SELECT updated_at, status FROM work_requests WHERE id = ?").get(r.id);
    assert.equal(after.status, "BLOCKED", "the request stays preserved and blocked");
    assert.equal(after.updated_at, before.updated_at, "the suspension did not replan it");
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM mission_envelopes").get().n, plans0, "no plan was proposed by the stop");
  } finally { await t.cleanup(); }
});

test("FU-05 environment.attest forwards an expected fingerprint from any channel: a different one is refused before the canary, no attestation row", async () => {
  const t = await makeTestHub({ wsl: true });
  try {
    await dispatch(t.hub, "environment.inspect", { environmentId: "wsl-runner" });
    const rows = () => t.hub.db.prepare("SELECT COUNT(*) AS n FROM environment_attestations").get().n;
    const n0 = rows();
    await assert.rejects(dispatch(t.hub, "environment.attest", { environmentId: "wsl-runner", expectFingerprint: "abcdef0123456789" }),
      (e) => e.category === "policy" && /Amprenta mediului s-a schimbat/.test(e.message));
    assert.equal(rows(), n0, "nothing was attested");
    await assert.rejects(dispatch(t.hub, "environment.attest", { environmentId: "wsl-runner", expectFingerprint: "not-a-hash!" }), (e) => e.category === "validation");
    const fp = t.hub.environments.get("wsl-runner").state().fingerprint.hash;
    const ok = (await dispatch(t.hub, "environment.attest", { environmentId: "wsl-runner", expectFingerprint: fp })).result;
    assert.match(String(ok.status), /^PASS/);
    assert.equal(ok.fingerprintHash, fp);
  } finally { await t.cleanup(); }
});

test("FU-06 the rearm card's nonce is returned to the owner's page but never stored in the owner.intent command log", async () => {
  const t = await ownerHub();
  try {
    await ownerStop(t);
    await sleep(50);
    const r = await t.hub.commands.dispatch({ type: "owner.intent", payload: { text: "Redeschide poarta" }, channel: "owner", actor: `owner:${t.owner.session.id}`, ownerSession: t.owner.session });
    const text = JSON.stringify(r.result);
    const nonce = /"gateRearm":\{[^}]*"nonce":"([^"]+)"/.exec(text)?.[1];
    assert.ok(nonce && nonce !== "[omis]", "the page receives the nonce");
    const logged = t.hub.db.prepare("SELECT result_json FROM commands WHERE id = ?").get(r.command.id).result_json;
    assert.ok(!logged.includes(nonce), "the command log never holds the nonce");
    assert.match(logged, /\[omis\]/);
  } finally { await t.cleanup(); }
});
