// Milestone 10.2.1 — G1: the contextual gate rearm (owner decisions D14–D17). Every gate suspension records its origin (one classifier,
// precedence, the start of the chain); after Stop All (or any suspension that is not the owner's own pause) the gate is reopened in the
// cockpit by a rearm card — the owner session, a FRESH authenticator verification, bound to a nonce + the exact suspension, compare-and-
// set — never by voice, a timer or a delegated channel. A rearm reopens the WHOLE gate and keeps BUILD_SAFE; nothing old restarts; only
// the request that showed the card is re-proposed (a plan that still needs its own confirmation). PASS_SIMULATED: fixture providers,
// software authenticator, test projects; no model, no network.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeTestHub, waitFor, enrolOwner, prepareLiveWithoutGrants } from "./helpers.mjs";
import { materializeFixture, demoSpec } from "../server/factory/fixtures.mjs";
import { HubError } from "../server/core/errors.mjs";
import { AGENT_COMMANDS } from "../server/runtime/commands.mjs";
import { classifySuspension, nextSuspension, suspensionKey, credentialTag, SUSPENSION_PRECEDENCE, SECURITY_EVENT_TYPES, SUSPENSION_LABELS, CHANNEL_LABELS } from "../server/policy/gate-state.mjs";
import { gateSuspendedBy } from "../server/owner/cockpit.mjs";
import { collectFacts } from "../server/owner/readiness-runner.mjs";
import { explain } from "../server/owner/blockers.mjs";
import { createHttpServer } from "../server/http/server.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const M09_MODELS = { writerModel: "gpt-fake-sol", reviewerModel: "sonnet" };
const ADMIN_POINTERS = /OPEN GATE|Integrări → Avansat|Avansat|din Sistem|#\/system/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dispatch = (hub, type, payload, extra = {}) => hub.commands.dispatch({ type, payload, channel: "test", actor: "test", ...extra });
const gate = (t) => t.hub.settings.get("executionGate");
const count = (t, sql, ...args) => t.hub.db.prepare(sql).get(...args).n;
const events = (t, type) => t.hub.db.prepare("SELECT payload_json FROM events WHERE type = ? ORDER BY seq").all(type).map((r) => JSON.parse(r.payload_json || "{}"));
const asOwner = (t, type, payload = {}, session = t.owner.session) =>
  t.hub.commands.dispatch({ type, payload, channel: "owner", actor: `owner:${session.id}`, ownerSession: session }).then((r) => r.result);
const card = (t, payload = {}, session = t.owner.session) => asOwner(t, "gate.rearm.card", payload, session);
const rearm = (t, c, extra = {}, session = t.owner.reauth()) => asOwner(t, "gate.rearm", { nonce: c.nonce, hash: c.hash, ...extra }, session);
const stale = (t, session = t.owner.session) => t.hub.db.prepare("UPDATE owner_sessions SET reauth_at = ? WHERE id = ?").run(new Date(t.hub.config.now().getTime() - 10 * 60000).toISOString(), session.id);
const openGate = (t) => t.hub.bus.transaction(() => t.hub.settings.set("executionGate", { status: "open", reason: "test", changedAt: t.hub.config.now().toISOString(), changedBy: "test" }, "test"));
const stopAs = (t, channel, extra = {}) => t.hub.commands.dispatch({ type: "system.stop_all", payload: { reason: "test" }, channel, actor: channel === "voice" ? "voice" : "user", ...extra }).then((r) => r.result);
const ownerStop = (t) => stopAs(t, "owner", { actor: `owner:${t.owner.session.id}`, ownerSession: t.owner.session });

/** A factory test project (bug-demo, TRUSTED) with one SPEC_DRAFT mission; the owner enrolled (voice-first); BUILD_SAFE; gate open. */
async function ownerHub({ clock = null, second = false } = {}) {
  const t = await makeTestHub({ queues: true, ...(clock ? { clock } : {}) });
  await prepareLiveWithoutGrants(t.hub);
  const register = async (label, name) => {
    const dir = path.join(t.dataDir, label);
    materializeFixture("bug-demo", dir);
    return (await dispatch(t.hub, "project.register_test", { path: dir, name })).result;
  };
  const project = await register("rearm-alfa", "Rearm Alfa");
  const other = second ? await register("rearm-beta", "Rearm Beta") : null;
  const owner = await enrolOwner(t);
  for (const p of [project, other].filter(Boolean)) await dispatch(t.hub, "owner.autonomy.set", { projectId: p.id, level: "TRUSTED" }, { ownerSession: owner.reauth() });
  const { mission } = (await dispatch(t.hub, "factory.prepare", { projectId: project.id, ...demoSpec("bug-demo"), limits: M09_MODELS })).result;
  return { ...t, project, other, owner, mission };
}
const prepare = async (t, projectId) => (await dispatch(t.hub, "factory.prepare", { projectId, ...demoSpec("bug-demo"), limits: M09_MODELS })).result.mission;

// ------------------------------------------------------------------------------------------------------------------------------ RA-01
test("RA-01 every suspension records its origin per channel (owner credential tag, ui, voice, companion device, agent, shutdown, gate.set suspend); precedence and the chain start", async () => {
  let offset = 0;
  const t = await ownerHub({ clock: () => new Date(Date.now() + offset) });
  const tick = () => { offset += 1000; };
  try {
    // The owner's Stop All: channel, actor, the credential reference (a 24-hex hash prefix, never the id), the session.
    await ownerStop(t);
    const a = gate(t).suspendedBy;
    assert.equal(a.kind, "stop_all");
    assert.match(a.id, /^sus_/);
    assert.equal(a.channel, "owner");
    assert.equal(a.actor, `owner:${t.owner.session.id}`);
    assert.equal(a.credential, credentialTag(t.owner.session.credentialId));
    assert.match(a.credential, /^[0-9a-f]{24}$/);
    assert.ok(!JSON.stringify(gate(t)).includes(t.owner.session.credentialId), "the credential id itself is never stored in the gate");
    assert.equal(a.sessionId, t.owner.session.id);
    assert.equal(a.deviceId, null);
    assert.equal(a.since, a.at, "a stop on an open gate starts the chain");
    assert.equal(events(t, "system.stop_all").at(-1).suspensionId, a.id, "the Stop All event names the suspension");
    // Equal precedence (another Stop All, from the UI): a NEW record (new key) — the chain start is kept.
    tick();
    await stopAs(t, "ui");
    const b = gate(t).suspendedBy;
    assert.notEqual(b.id, a.id);
    assert.equal(b.channel, "ui");
    assert.equal(b.actor, "user");
    assert.equal(b.credential, null);
    assert.equal(b.since, a.since, "since keeps the earliest start of the chain");
    assert.ok(b.at > a.at);
    // A weaker suspension (the palette „Pauză” = gate.set suspend) never erases the stronger record; the reason may change.
    tick();
    await t.hub.commands.dispatch({ type: "gate.set", channel: "ui", actor: "user", payload: { action: "suspend", reason: "Palette pause" } });
    assert.equal(gate(t).suspendedBy.id, b.id);
    assert.equal(gate(t).suspendedBy.kind, "stop_all");
    assert.equal(gate(t).reason, "Palette pause");
    // The shutdown is weaker than Stop All too: the record stays.
    tick();
    await t.hub.runs.stopAll("system", "Hub shutdown (TEST)", { kind: "shutdown", channel: "system", actor: "system" });
    assert.equal(gate(t).suspendedBy.id, b.id);
    // Voice, companion (a paired phone), agent: each recorded as itself.
    tick();
    await stopAs(t, "voice");
    assert.deepEqual([gate(t).suspendedBy.channel, gate(t).suspendedBy.actor], ["voice", "voice"]);
    tick();
    await t.hub.commands.dispatch({ type: "system.stop_all", channel: "companion", actor: "device:dev_test42", payload: { reason: "Stop de pe telefon" } });
    assert.deepEqual([gate(t).suspendedBy.channel, gate(t).suspendedBy.deviceId], ["companion", "dev_test42"]);
    tick();
    await t.hub.commands.dispatch({ type: "system.stop_all", channel: "agent", delegation: "test: delegare RA-01 (sesiunea de test)", payload: { reason: "agent stop" } });
    assert.deepEqual([gate(t).suspendedBy.channel, gate(t).suspendedBy.actor, gate(t).suspendedBy.credential], ["agent", "agent", null]);
    assert.equal(gate(t).suspendedBy.since, a.since, "the whole chain keeps its first start");
    // On an open gate: the shutdown records kind "shutdown"; gate.set suspend records kind "suspend"; the owner's pause keeps its fields.
    openGate(t); tick();
    await t.hub.runs.stopAll("system", "Hub shutdown (TEST)", { kind: "shutdown", channel: "system", actor: "system" });
    assert.deepEqual([gate(t).suspendedBy.kind, gate(t).suspendedBy.channel, gate(t).changedBy], ["shutdown", "system", "system"]);
    assert.equal(classifySuspension(gate(t)).cls, "shutdown");
    openGate(t); tick();
    await t.hub.commands.dispatch({ type: "gate.set", channel: "voice", actor: "voice", payload: { action: "suspend", reason: "Voice: pause" } });
    assert.deepEqual([gate(t).suspendedBy.kind, gate(t).suspendedBy.channel, gate(t).changedBy], ["suspend", "voice", "voice"]);
    openGate(t); tick();
    await asOwner(t, "owner.interrupt", { kind: "pause", reason: "Pauză" });
    const p = gate(t).suspendedBy;
    assert.deepEqual([p.kind, p.channel, p.credential, p.sessionId], ["pause", "owner", credentialTag(t.owner.session.credentialId), t.owner.session.id]);
    assert.ok(Array.isArray(p.missions) && /^sus_/.test(p.id) && p.since === p.at);
    assert.equal(classifySuspension(gate(t)).cls, "owner_pause");
    // A stronger suspension over the owner's pause replaces it (precedence), keeping the chain start.
    tick();
    await t.hub.commands.dispatch({ type: "gate.set", channel: "ui", actor: "user", payload: { action: "suspend" } });
    assert.equal(gate(t).suspendedBy.kind, "suspend");
    assert.equal(gate(t).suspendedBy.since, p.since);
    // Opening by the legacy path carries no suspension record and names what it reopened.
    await t.hub.commands.dispatch({ type: "gate.set", channel: "ui", actor: "user", payload: { action: "open", confirm: "OPEN GATE" } });
    assert.equal(gate(t).suspendedBy, undefined);
    assert.equal(gate(t).reopenedAfter.via, "open_gate");
    assert.equal(gate(t).reopenedAfter.cls, "suspend");
  } finally { await t.cleanup(); }
  // Pure: the precedence table, a security record is never downgraded, an unknown kind is refused.
  assert.deepEqual(SUSPENSION_PRECEDENCE, { pause: 1, suspend: 2, shutdown: 3, stop_all: 4, security: 5 });
  const at1 = "2026-10-05T10:00:00.000Z"; const at2 = "2026-10-05T10:01:00.000Z";
  const sec = { status: "suspended", changedAt: at1, suspendedBy: nextSuspension({ status: "open" }, { kind: "security", at: at1 }) };
  assert.equal(nextSuspension(sec, { kind: "stop_all", at: at2 }), sec.suspendedBy, "Stop All never erases a security record");
  const legacy = { status: "suspended", changedAt: at1, changedBy: "user", reason: "Stop All" };
  assert.equal(nextSuspension(legacy, { kind: "pause", at: at2 }).since, at1, "a record-less suspension ranks below every kind; its start is kept");
  assert.throws(() => nextSuspension({ status: "open" }, { kind: "nap", at: at1 }), /Unknown suspension kind/);
  assert.equal(credentialTag(null), null);
  assert.ok(SECURITY_EVENT_TYPES.includes("owner.credential_revoked"));
  for (const k of ["owner", "ui", "voice", "companion", "agent", "test", "system"]) assert.ok(CHANNEL_LABELS[k], k);
});

// ------------------------------------------------------------------------------------------------------------------------------ RA-02
test("RA-02 one classifier for the cockpit, the readiness facts and the blockers: a palette „Pauză” is a suspension, not Stop All; no admin pointer", async () => {
  const t = await ownerHub();
  try {
    const cases = [
      [{ status: "open" }, "open"],
      [{ status: "suspended", reason: "Prima pornire", changedAt: null, changedBy: "system" }, "first_start"],
      [{ status: "suspended", reason: "Stop All", changedAt: "2026-10-01T00:00:00Z", changedBy: "user" }, "legacy_unknown"],
      [{ status: "suspended", changedAt: "2026-10-01T00:00:00Z", changedBy: "x", suspendedBy: { kind: "pause", credential: "a".repeat(24), at: "2026-10-01T00:00:00Z" } }, "owner_pause"],
      [{ status: "suspended", changedAt: "2026-10-01T00:00:00Z", changedBy: "x", suspendedBy: { kind: "pause", credential: null, at: "2026-10-01T00:00:00Z" } }, "pause_unowned"],
      [{ status: "suspended", changedAt: "2026-10-01T00:00:00Z", changedBy: "x", suspendedBy: { kind: "stop_all", id: "sus_x", at: "2026-10-01T00:00:00Z" } }, "stop_all"],
    ];
    for (const [g, cls] of cases) {
      assert.equal(classifySuspension(g).cls, cls, JSON.stringify(g));
      assert.equal(gateSuspendedBy(g), cls === "open" ? null : cls, "the cockpit delegates to the same classifier");
      assert.ok(SUSPENSION_LABELS[cls], cls);
    }
    assert.equal(suspensionKey(cases[5][0]), "sus_x");
    assert.match(suspensionKey(cases[2][0]), /^legacy:/);
    // The readiness runner has no copy of its own any more.
    const src = fs.readFileSync(path.join(here, "..", "server", "owner", "readiness-runner.mjs"), "utf8");
    assert.doesNotMatch(src, /function gateSuspendedBy/);
    assert.match(src, /classifySuspension/);
    // The palette / Integrations „Pauză” (gate.set suspend from the UI) is a suspension — before, every class but a pause read "stop_all".
    await t.hub.commands.dispatch({ type: "gate.set", channel: "ui", actor: "user", payload: { action: "suspend" } });
    const why = t.hub.cockpit.whyBlocked({ projectId: t.project.id }).items.find((i) => /Poarta de execuție/.test(i.what));
    assert.equal(why.suspendedBy, "suspend");
    assert.match(why.action, /Windows Hello/);
    assert.doesNotMatch(why.action, ADMIN_POINTERS);
    const facts = await collectFacts(t.hub, { projectId: t.project.id, intent: "engineering" });
    assert.equal(facts.gate.suspendedBy, "suspend");
    assert.deepEqual([facts.gate.rearm.eligible, facts.gate.rearm.code], [true, "ELIGIBLE"]);
    const ex = explain(facts);
    const b = ex.blockers.find((x) => x.code === "GATE_SUSPENDED");
    assert.ok(b, JSON.stringify(ex.causes));
    assert.deepEqual(b.options.map((o) => [o.kind, o.label]), [["rearm", "Redeschide poarta aici (Windows Hello)"]]);
    assert.ok(!b.options.some((o) => o.where), "never a where: pointer");
    assert.doesNotMatch(ex.text, ADMIN_POINTERS);
    assert.match(b.detail, /printr-o suspendare a porții/);
    // After Stop All: the same, with the Stop All words.
    await ownerStop(t);
    const after = t.hub.cockpit.whyBlocked({}).items.find((i) => /Poarta de execuție/.test(i.what));
    assert.equal(after.suspendedBy, "stop_all");
    assert.match(after.action, /Stop All: o redeschid aici, în cockpit, cu Windows Hello/);
    assert.doesNotMatch(after.action, ADMIN_POINTERS);
  } finally { await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ RA-03
test("RA-03 the card needs the owner session; the rearm without a fresh verification is an authentication error (data.reauth) and changes nothing; the same card works after the re-verification", async () => {
  const t = await ownerHub();
  try {
    await ownerStop(t);
    const before = JSON.stringify(gate(t));
    await assert.rejects(dispatch(t.hub, "gate.rearm.card", {}), (e) => e instanceof HubError && e.category === "authentication");
    const c = await card(t);
    assert.equal(c.kind, "gate_rearm");
    assert.equal(c.eligible, true);
    assert.equal(c.code, "ELIGIBLE");
    assert.equal(c.cls, "stop_all");
    assert.match(c.nonce, /^[0-9a-f]{32}$/);
    assert.match(c.hash, /^[0-9a-f]{64}$/);
    assert.equal(c.requiresFreshAuth, true);
    assert.equal(c.security, null);
    assert.match(c.headline, /oprită de Stop All.*O redeschid aici, cu Windows Hello\?/);
    assert.match(c.headline, /din cockpit \(sesiunea ta\)/, "who stopped it");
    assert.ok(c.lines.some((l) => /autorizările active au fost revocate/.test(l)), JSON.stringify(c.lines));
    assert.ok(c.stays.some((l) => /BUILD_SAFE/.test(l)) && c.stays.some((l) => /nu sunt repropuse singure/.test(l)), JSON.stringify(c.stays));
    assert.doesNotMatch(JSON.stringify(c), ADMIN_POINTERS);
    assert.ok(Date.parse(c.expiresAt) - Date.now() <= 5 * 60000 + 2000);
    // No fresh verification (last one older than 5 minutes): refused before anything else, the gate unchanged, the card still usable.
    stale(t);
    await assert.rejects(asOwner(t, "gate.rearm", { nonce: c.nonce, hash: c.hash }), (e) => e.category === "authentication" && e.details?.reauth === true);
    assert.equal(JSON.stringify(gate(t)), before);
    assert.equal(events(t, "gate.rearmed").length, 0);
    // The UI's withReauth: one Windows Hello, then the SAME request again.
    const out = await rearm(t, c);
    assert.equal(out.reopened, true);
    assert.equal(gate(t).status, "open");
  } finally { await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ RA-04
test("RA-04 the rearm opens the whole gate with reopenedAfter, resets LIVE_VALIDATION to BUILD_SAFE in the same transaction, emits gate.rearmed; probe: gateRearms 1, manualModeChanges 0", async () => {
  const t = await ownerHub();
  try {
    await t.hub.commands.dispatch({ type: "mode.set", channel: "ui", actor: "user", payload: { mode: "LIVE_VALIDATION", confirm: "LIVE_VALIDATION" } });
    assert.equal(t.hub.settings.get("mode"), "LIVE_VALIDATION");
    await ownerStop(t);
    const key = gate(t).suspendedBy.id;
    const m0 = t.hub.bus.lastSeq();
    const c = await card(t);
    assert.ok(c.stays.some((l) => /revine în BUILD_SAFE/.test(l)), JSON.stringify(c.stays));
    const out = await rearm(t, c);
    assert.equal(out.reopened, true);
    assert.equal(out.modeReset, true);
    assert.equal(out.reproposed, null);
    assert.match(out.summary, /Am redeschis poarta după Stop All; Hub-ul e din nou în BUILD_SAFE/);
    const g = gate(t);
    assert.equal(g.status, "open");
    assert.equal(g.suspendedBy, undefined);
    assert.equal(g.changedBy, `owner:${t.owner.session.id}`);
    assert.deepEqual({ cls: g.reopenedAfter.cls, key: g.reopenedAfter.key, via: g.reopenedAfter.via, sessionId: g.reopenedAfter.sessionId, security: g.reopenedAfter.security },
      { cls: "stop_all", key, via: "rearm", sessionId: t.owner.session.id, security: null });
    assert.equal(t.hub.settings.get("mode"), "BUILD_SAFE");
    const ev = events(t, "gate.rearmed");
    assert.equal(ev.length, 1);
    assert.deepEqual([ev[0].cls, ev[0].key, ev[0].modeReset, ev[0].modality, ev[0].sessionId], ["stop_all", key, true, "click", t.owner.session.id]);
    // The gate change and the mode change commit together (one transaction: consecutive events).
    const seqs = t.hub.db.prepare("SELECT seq, type, json_extract(payload_json, '$.key') AS k FROM events WHERE seq > ? AND (type = 'gate.rearmed' OR (type = 'settings.changed' AND json_extract(payload_json, '$.key') IN ('executionGate','mode'))) ORDER BY seq").all(m0);
    assert.deepEqual(seqs.map((r) => r.type === "gate.rearmed" ? "rearmed" : r.k), ["executionGate", "mode", "rearmed"]);
    assert.equal(seqs[2].seq - seqs[0].seq, 2);
    const report = t.hub.probe.report({ sinceSeq: m0 });
    assert.equal(report.counters.gateRearms, 1);
    assert.equal(report.counters.manualModeChanges, 0);
    assert.equal(report.evidence.gateRearms.items[0].cls, "stop_all");
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM commands WHERE type = 'gate.set'"), 0, "no OPEN GATE");
    // The gate is open: a new card has nothing to reopen.
    const none = await card(t);
    assert.deepEqual([none.eligible, none.code], [false, "OPEN"]);
  } finally { await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ RA-05
/** Test executors for an operation plan that waits (the same pattern as m10-ops-plans). */
function waitingExecutor(t) {
  t.hub.executors["test.wait"] = {
    describe: () => ({ title: "Așteaptă", params: {}, ops: [{ op: "media.render" }], observed: [], transmitted: [], outputs: [] }),
    run: async ({ authorize, abort }) => { authorize({ op: "media.render" }); while (!abort.aborted) await sleep(15); return { result: { waited: true } }; },
  };
}

test("RA-05 nothing old restarts: cancelled missions stay cancelled, the paused operation plan stays PAUSED, a PROPOSED plan from before Stop All is REVOKED, no preserved request is swept; only the card's request is re-proposed (a proposal)", async () => {
  const t = await ownerHub({ second: true });
  try {
    const Q = t.other;
    const missionB = await prepare(t, Q.id);
    const missionC = await prepare(t, Q.id);
    // A running plan on project A (a writer turn that hangs).
    const env1 = (await dispatch(t.hub, "envelope.propose", { projectId: t.project.id, missionIds: [t.mission.id] })).result.envelope;
    t.queue("codex", "hang");
    await dispatch(t.hub, "envelope.confirm", { envelopeId: env1.id, nonce: env1.nonce, displayedHash: env1.envelopeHash }, { ownerSession: t.owner.session });
    await waitFor(() => (t.hub.runs.activeRuns().some((r) => r.provider === "codex") ? true : null), 30000, 50);
    // A plan still waiting for its confirmation on project Q, with the preserved request it became (R1).
    const env2 = (await dispatch(t.hub, "envelope.propose", { projectId: Q.id, missionIds: [missionB.id] })).result.envelope;
    assert.equal(t.hub.envelopes.get(env2.id).status, "PROPOSED");
    const r1 = t.hub.workRequests.create({ text: "Repară bug-ul B", source: "typed", channel: "owner", projectId: Q.id, intent: "engineering", planRef: { kind: "mission", missionId: missionB.id }, actor: "test" });
    t.hub.workRequests.markPlanned(r1.id, { kind: "envelope", id: env2.id, missionId: missionB.id }, { headline: "B" });
    // An older preserved request still BLOCKED (R0): a gate sweep would re-propose it.
    const r0 = t.hub.workRequests.create({ text: "Repară bug-ul B din nou", source: "typed", channel: "owner", projectId: Q.id, intent: "engineering", planRef: { kind: "mission", missionId: missionB.id }, actor: "test" });
    t.hub.workRequests.explainOnce(r0.id, { blocked: true, signature: "GATE_SUSPENDED", cause: "GATE_SUSPENDED", causes: ["GATE_SUSPENDED"], options: [], automaticOnly: false, text: "Nu pot porni încă.", short: "Încă blocat." });
    assert.equal(t.hub.workRequests.get(r0.id).status, "BLOCKED");
    // A running operation plan.
    waitingExecutor(t);
    const op = await asOwner(t, "ops.plan.propose", { kind: "rearm.test", title: "Plan de test", steps: [{ kind: "test.wait", params: {} }], limits: {} });
    await asOwner(t, "ops.plan.confirm", { planId: op.id, nonce: op.nonce, displayedHash: op.hash });
    await waitFor(() => t.hub.opsPlans.view(op.id).steps.some((s) => s.status === "RUNNING"));
    // The request the owner makes after the stop (R2) is the one the card carries.
    const runsBefore = count(t, "SELECT COUNT(*) AS n FROM agent_runs");

    const stopped = await ownerStop(t);
    assert.deepEqual(stopped.plansPaused, [op.id]);
    await t.hub.opsPlans.idle(op.id);
    await waitFor(() => t.hub.runs.activeRuns().length === 0, 15000);
    await waitFor(() => (t.hub.factory.list().find((f) => f.missionId === t.mission.id)?.stage === "CANCELLED" ? true : null), 20000, 50);
    await waitFor(() => (["REVOKED"].includes(t.hub.envelopes.get(env2.id).status) && t.hub.envelopes.get(env1.id).status === "REVOKED" ? true : null), 10000, 20);
    assert.equal(t.hub.envelopes.get(env2.id).closeReason, "Stop All");
    await waitFor(() => (t.hub.workRequests.get(r1.id).status === "OPEN" ? true : null), 5000, 20);
    const r2 = t.hub.workRequests.create({ text: "Repară bug-ul C", source: "typed", channel: "owner", projectId: Q.id, intent: "engineering", planRef: { kind: "mission", missionId: missionC.id }, actor: "test" });

    const c = await card(t, { requestId: r2.id });
    assert.equal(c.requestId, r2.id);
    assert.ok(c.stays.some((l) => /anulat/.test(l)), JSON.stringify(c.stays));
    assert.ok(c.stays.some((l) => /un plan de operare/.test(l) && /„Continuă”/.test(l)), JSON.stringify(c.stays));
    const out = await rearm(t, c);
    assert.equal(out.reopened, true);
    assert.equal(out.reproposed?.requestId, r2.id, JSON.stringify(out.reproposed));
    assert.ok(out.reproposed.envelopeId, `the card's request became a plan: ${JSON.stringify(out.reproposed)}`);
    const env3 = t.hub.envelopes.get(out.reproposed.envelopeId);
    assert.equal(env3.status, "PROPOSED", "a proposal: its plan still needs its own confirmation");
    assert.deepEqual(env3.missionIds, [missionC.id]);
    assert.equal(t.hub.workRequests.get(r2.id).status, "PLANNED");
    await sleep(600); // time for a wrongly scheduled sweep, resume or start to show up
    assert.equal(t.hub.factory.list().find((f) => f.missionId === t.mission.id).stage, "CANCELLED", "cancelled stays cancelled");
    assert.equal(t.hub.opsPlans.view(op.id).status, "PAUSED", "the paused operation plan stays paused until „Continuă”");
    assert.equal(t.hub.envelopes.get(env2.id).status, "REVOKED");
    assert.equal(t.hub.workRequests.get(r1.id).status, "OPEN", "a request whose plan Stop All revoked is not re-proposed");
    assert.equal(t.hub.workRequests.get(r0.id).status, "BLOCKED", "no gate sweep after a rearm");
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM mission_envelopes WHERE status = 'PROPOSED'"), 1, "only the card's request has a plan to confirm");
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM mission_envelopes WHERE status IN ('CONFIRMED','ACTIVE','WAITING_OWNER')"), 0, "nothing confirmed by itself");
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM agent_runs"), runsBefore, "no new run");
    assert.equal(t.hub.lega.active(), false, "Lega does not start by itself");
    assert.equal(t.hub.runs.activeRuns().length, 0);
  } finally { await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ RA-06
test("RA-06 Stop All again between the card and the rearm: the suspension key changed → refused (compare-and-set), the card is dropped; a new card works", async () => {
  const t = await ownerHub();
  try {
    await ownerStop(t);
    const c1 = await card(t);
    await stopAs(t, "ui");
    const key2 = gate(t).suspendedBy.id;
    await assert.rejects(rearm(t, c1), (e) => e.category === "conflict" && e.details?.code === "SUSPENSION_CHANGED" && /oprită din nou/.test(e.message));
    assert.equal(gate(t).status, "suspended");
    assert.equal(gate(t).suspendedBy.id, key2);
    await assert.rejects(rearm(t, c1), (e) => e.category === "conflict" && e.details?.code === "CARD_STALE", "the refused card can never succeed later");
    // A second card for the same suspension replaces the first one (one live card per session and suspension).
    const c2 = await card(t);
    const c3 = await card(t);
    await assert.rejects(rearm(t, c2), (e) => e.details?.code === "CARD_STALE");
    const out = await rearm(t, c3);
    assert.equal(out.reopened, true);
    assert.equal(gate(t).reopenedAfter.key, key2);
    // A wrong hash for a live card is refused without consuming it.
    await ownerStop(t);
    const c4 = await card(t);
    await assert.rejects(rearm(t, { nonce: c4.nonce, hash: "0".repeat(64) }), (e) => e.details?.code === "CARD_HASH");
    assert.equal((await rearm(t, c4)).reopened, true);
  } finally { await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ RA-07
test("RA-07 security events around the stop (from 15 minutes before the chain start until now): listed on the card, the rearm needs ackSecurity bound to them; never without it", async () => {
  let offset = 0;
  const t = await ownerHub({ clock: () => new Date(Date.now() + offset) });
  const securityEvent = (type) => t.hub.bus.emit({ type, scopeType: "system", scopeId: "test", source: "test", payload: { test: true } });
  try {
    // An event 20 minutes before the stop is outside the window: an ordinary card.
    securityEvent("lega.voice_gate_bypass");
    offset += 20 * 60000;
    t.owner.reauth();
    await ownerStop(t);
    const plain = await card(t);
    assert.equal(plain.code, "ELIGIBLE");
    assert.equal(plain.security, null);
    assert.equal((await rearm(t, plain)).reopened, true);
    // An event BEFORE the stop (a violation, then the owner presses Stop): the card lists it; the rearm needs the acknowledgement.
    securityEvent("lega.session.violation");
    offset += 60000;
    await ownerStop(t);
    const c = await card(t);
    assert.equal(c.code, "SECURITY");
    assert.equal(c.security.ackRequired, true);
    assert.deepEqual(c.security.events.map((e) => e.type), ["lega.session.violation"]);
    assert.match(c.security.events[0].label, /acțiune interzisă/);
    assert.ok(c.security.events[0].at && c.security.events[0].id);
    assert.ok(c.lines.some((l) => /evenimente de securitate/.test(l)));
    const facts = await collectFacts(t.hub, { projectId: t.project.id, intent: "engineering" });
    assert.equal(facts.gate.rearm.code, "SECURITY");
    const b = explain(facts).blockers.find((x) => x.code === "GATE_SUSPENDED");
    assert.equal(b.options[0].kind, "rearm");
    assert.match(b.detail, /evenimente de securitate/);
    await assert.rejects(rearm(t, c), (e) => e.category === "validation" && e.details?.code === "SECURITY_ACK");
    assert.equal(gate(t).status, "suspended");
    await assert.rejects(rearm(t, c, { ackSecurity: false }), (e) => e.details?.code === "SECURITY_ACK");
    const out = await rearm(t, c, { ackSecurity: true });
    assert.equal(out.reopened, true);
    assert.match(gate(t).reopenedAfter.security, /^[0-9a-f]{64}$/);
    assert.equal(events(t, "gate.rearmed").at(-1).security, gate(t).reopenedAfter.security);
    // An event AFTER the card was shown: the card no longer matches (dropped); the new card lists it.
    offset += 20 * 60000;
    t.owner.reauth();
    await ownerStop(t);
    const before = await card(t);
    assert.equal(before.code, "ELIGIBLE");
    securityEvent("owner.credential_revoked");
    await assert.rejects(rearm(t, before), (e) => e.category === "conflict" && e.details?.code === "CARD_CHANGED");
    const after = await card(t);
    assert.equal(after.code, "SECURITY");
    assert.deepEqual(after.security.events.map((e) => e.type), ["owner.credential_revoked"]);
    assert.match(after.security.events[0].label, /autentificator al tău a fost revocat/);
    await assert.rejects(rearm(t, after), (e) => e.details?.code === "SECURITY_ACK");
    assert.equal((await rearm(t, after, { ackSecurity: true })).reopened, true);
    // A security suspension (kind "security") always needs the acknowledgement, even with no event listed.
    offset += 20 * 60000;
    t.owner.reauth();
    await t.hub.runs.stopAll("system", "security test", { kind: "security", channel: "system", actor: "system" });
    const sec = await card(t);
    assert.deepEqual([sec.cls, sec.code, sec.security.events.length, sec.security.ackRequired], ["security", "SECURITY", 0, true]);
    await assert.rejects(rearm(t, sec), (e) => e.details?.code === "SECURITY_ACK");
  } finally { await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ RA-08
test("RA-08 not eligible while a run is still active, a mission is still cancelling or Lega is active — each with its Romanian reason; a retained lease is a step of the card (2.12.2); never an admin pointer", async () => {
  const t = await ownerHub();
  try {
    // A run still active under a plain suspension (gate.set suspend lets running work finish).
    const env = (await dispatch(t.hub, "envelope.propose", { projectId: t.project.id, missionIds: [t.mission.id] })).result.envelope;
    t.queue("codex", "hang");
    await dispatch(t.hub, "envelope.confirm", { envelopeId: env.id, nonce: env.nonce, displayedHash: env.envelopeHash }, { ownerSession: t.owner.session });
    await waitFor(() => (t.hub.runs.activeRuns().some((r) => r.provider === "codex") ? true : null), 30000, 50);
    await t.hub.commands.dispatch({ type: "gate.set", channel: "ui", actor: "user", payload: { action: "suspend" } });
    const running = await card(t);
    assert.deepEqual([running.eligible, running.code], [false, "RUNS_ACTIVE"]);
    // 2.12.1 (VOICE-04): the reason says what the owner does next (the card, Windows Hello), never that the Hub reopens by itself.
    assert.match(running.reason, /Încă se oprește o execuție; după ce oprirea e confirmată, o redeschizi tu, aici în cockpit/);
    assert.doesNotMatch(running.reason, /redeschid poarta după/);
    const facts = await collectFacts(t.hub, { projectId: t.project.id, intent: "engineering" });
    const b = explain(facts).blockers.find((x) => x.code === "GATE_SUSPENDED");
    assert.deepEqual(b.options.map((o) => o.kind), ["admin"]);
    assert.match(b.options[0].label, /după ce oprirea e confirmată, o redeschizi tu/);
    assert.ok(!b.options[0].where);
    const why = t.hub.cockpit.whyBlocked({}).items.find((i) => /Poarta de execuție/.test(i.what));
    assert.match(why.action, /Încă se oprește/);
    assert.doesNotMatch(why.action, ADMIN_POINTERS);
    await ownerStop(t);
    await waitFor(() => t.hub.runs.activeRuns().length === 0, 15000);
    await waitFor(() => (t.hub.factory.list().find((f) => f.missionId === t.mission.id)?.stage === "CANCELLED" ? true : null), 20000, 50);
    const ok = await card(t);
    assert.equal(ok.code, "ELIGIBLE");
    // A retained lease (holder state unknown). 2.12.2 (P0-R1, deliberate change): no longer a dead end — the card stays rearmable and
    // INCLUDES the lease as a step whose outcome cannot be proven (no run behind it: the owner's acknowledgement is required); a card
    // shown before it appeared is refused as changed (the hash binds the lease list). The full flow: m10-2-p0r1-leases.test.mjs.
    const lease = t.hub.bus.transaction(() => { const l = t.hub.leases.acquire({ resource: "workspace:test-rearm", holder: "test" }); t.hub.leases.retain(l.id, "test"); return l; });
    await assert.rejects(rearm(t, ok), (e) => e.category === "conflict" && e.details?.code === "CARD_CHANGED");
    assert.equal(gate(t).status, "suspended");
    const held = await card(t);
    assert.deepEqual([held.eligible, held.code], [true, "ELIGIBLE"]);
    assert.deepEqual(held.leases.steps.map((s) => [s.leaseId, s.verdict, s.ack]), [[lease.id, "unknown", true]]);
    assert.equal(held.leases.ackRequired, true);
    assert.match(held.leases.steps[0].text, /nu e legată de nicio execuție înregistrată/);
    assert.equal(t.hub.gateRearm.eligibility().code, "ELIGIBLE");
    assert.equal(t.hub.gateRearm.eligibility().leases.ackRequired, true);
    t.hub.bus.transaction(() => t.hub.leases.release(lease.id, "test"));
    // A mission whose cancellation is not confirmed yet.
    t.hub.db.prepare("UPDATE factory_missions SET stage = 'CANCEL_REQUESTED' WHERE mission_id = ?").run(t.mission.id);
    const cancelling = await card(t);
    assert.deepEqual([cancelling.eligible, cancelling.code], [false, "CANCEL_PENDING"]);
    assert.match(cancelling.reason, /încă se oprește \(anulare cerută, neconfirmată\)/);
    t.hub.db.prepare("UPDATE factory_missions SET stage = 'CANCELLED' WHERE mission_id = ?").run(t.mission.id);
    // A Lega session still open.
    const active = t.hub.lega.active;
    t.hub.lega.active = () => true;
    try {
      const lega = await card(t);
      assert.deepEqual([lega.eligible, lega.code], [false, "LEGA_ACTIVE"]);
      assert.match(lega.reason, /Sesiunea vocală Lega e încă deschisă/);
    } finally { t.hub.lega.active = active; }
    for (const text of [running.reason, held.headline, ...held.lines, ...held.leases.steps.map((s) => s.text), cancelling.reason]) assert.doesNotMatch(text, ADMIN_POINTERS);
    const final = await card(t);
    assert.equal((await rearm(t, final)).reopened, true);
  } finally { await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ RA-09
test("RA-09 channels and modality: gate.rearm only in the owner session (voice / companion / ui / agent / cli refused, not delegated), never by voice; the nonce is single-use and bound to its session; HTTP needs the session", async () => {
  const t = await ownerHub();
  try {
    await ownerStop(t);
    assert.equal(AGENT_COMMANDS.has("gate.rearm"), false);
    assert.equal(AGENT_COMMANDS.has("gate.rearm.card"), false);
    const c = await card(t);
    const payload = { nonce: c.nonce, hash: c.hash };
    for (const channel of ["voice", "companion", "ui", "cli"]) {
      await assert.rejects(t.hub.commands.dispatch({ type: "gate.rearm", channel, actor: channel, payload }), (e) => e.category === "policy" && /cannot be issued through/.test(e.message), channel);
      await assert.rejects(t.hub.commands.dispatch({ type: "gate.rearm.card", channel, actor: channel, payload: {} }), (e) => e.category === "policy", channel);
    }
    await assert.rejects(t.hub.commands.dispatch({ type: "gate.rearm", channel: "agent", delegation: "test: delegare RA-09 (sesiunea de test)", payload }), (e) => e.category === "policy" && /not delegated/.test(e.message));
    // A spoken (or any other) modality is refused even in the owner session with a fresh verification; the card stays usable.
    for (const modality of ["voice", "companion", "ui"]) {
      await assert.rejects(rearm(t, c, { modality }), (e) => e.category === "policy" && /niciodată prin voce/.test(e.message), modality);
    }
    assert.equal(gate(t).status, "suspended");
    // Another owner session (same authenticator, new session) cannot use this session's card.
    const a = t.hub.trust.beginAuthentication({ origin: t.owner.origin });
    const opened = t.hub.trust.finishAuthentication({ origin: t.owner.origin, challengeId: a.challengeId, credential: t.owner.auth.get({ challenge: a.publicKey.challenge }) });
    const other = t.hub.trust.resolveSession(opened.token, { origin: t.owner.origin });
    assert.notEqual(other.id, t.owner.session.id);
    await assert.rejects(rearm(t, c, {}, other), (e) => e.category === "policy" && e.details?.code === "CARD_SESSION");
    // Keyboard and typed are accepted; the nonce works once.
    const out = await rearm(t, c, { modality: "keyboard" });
    assert.equal(out.reopened, true);
    await assert.rejects(rearm(t, c), (e) => e.category === "conflict" && e.details?.code === "CARD_STALE");
    assert.equal(events(t, "gate.rearmed").at(-1).modality, "keyboard");
    // The command log keeps no nonce.
    const logged = t.hub.db.prepare("SELECT payload_json, result_json FROM commands WHERE type IN ('gate.rearm','gate.rearm.card')").all();
    assert.ok(logged.length >= 2 && logged.every((r) => !r.payload_json.includes(c.nonce) && !String(r.result_json).includes(c.nonce)));
  } finally { await t.cleanup(); }
  // HTTP: both routes need the owner session; an agent or cli caller is refused before anything runs.
  const u = await makeTestHub();
  const { server, token } = createHttpServer(u.hub);
  await new Promise((r) => server.listen(u.config.port, "127.0.0.1", r));
  const host = `localhost:${u.config.port}`;
  const call = (p, body, headers = {}) => new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body || {}));
    const req = http.request({ host: "127.0.0.1", port: u.config.port, method: "POST", path: p, headers: { Host: host, Origin: `http://${host}`, "X-Hub-Token": token, "Content-Type": "application/json", "Content-Length": data.length, ...headers } }, (res) => {
      const chunks = []; res.on("data", (x) => chunks.push(x)); res.on("end", () => { let json = null; try { json = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { /* */ } resolve({ status: res.statusCode, json }); });
    });
    req.on("error", reject); req.write(data); req.end();
  });
  try {
    for (const p of ["/api/owner/gate/rearm/card", "/api/owner/gate/rearm"]) {
      const noSession = await call(p, { nonce: "x", hash: "y" });
      assert.equal(noSession.status, 401, p);
      assert.equal(noSession.json?.error?.details?.needSession, true, p);
      const agent = await call(p, { nonce: "x", hash: "y" }, { "X-Hub-Channel": "agent" });
      assert.ok(agent.status >= 400 && agent.status < 500, p);
    }
    assert.equal(u.hub.settings.get("executionGate").status, "suspended");
  } finally { server.closeAllConnections?.(); await new Promise((r) => server.close(r)); await u.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ RA-11
test("RA-11 no timer reopens the gate: scheduler, envelope, factory, work-request and Lega ticks over hours leave it suspended; an expired card is refused", async () => {
  let offset = 0;
  const t = await ownerHub({ clock: () => new Date(Date.now() + offset) });
  try {
    await ownerStop(t);
    const key = gate(t).suspendedBy.id;
    const c = await card(t);
    for (let i = 0; i < 6; i += 1) {
      offset += 30 * 60000;
      t.hub.scheduler.tick();
      await Promise.all([t.hub.factory.tick(), Promise.resolve().then(() => t.hub.envelopes.tick()), Promise.resolve().then(() => t.hub.workRequests.tick()), Promise.resolve().then(() => t.hub.lega.tick())]);
      await sleep(50);
      assert.equal(gate(t).status, "suspended", `tick ${i}`);
      assert.equal(gate(t).suspendedBy.id, key);
    }
    assert.equal(events(t, "gate.rearmed").length, 0);
    // Hours later the card is long expired (5 minutes): refused even with a fresh verification (the session's verification time is
    // moved to the shifted clock directly: a re-authentication through the idle cookie would open a new session).
    t.hub.db.prepare("UPDATE owner_sessions SET reauth_at = ?, last_seen_at = ? WHERE id = ?").run(t.hub.config.now().toISOString(), t.hub.config.now().toISOString(), t.owner.session.id);
    await assert.rejects(asOwner(t, "gate.rearm", { nonce: c.nonce, hash: c.hash }), (e) => e.category === "conflict" && e.details?.code === "CARD_STALE");
    assert.equal(gate(t).status, "suspended");
  } finally { await t.cleanup(); }
});

// ------------------------------------------------------------------------------------------------------------------------------ RA-12
test("RA-12 the owner's own pause: the card refuses with OWNER_PAUSE („Continuă”), and resumeOwnPause reopens it as before; a pause of another credential or any Stop All is offered the rearm instead (no „Sistem”)", async () => {
  const t = await ownerHub();
  try {
    await asOwner(t, "owner.interrupt", { kind: "pause", reason: "Pauză" });
    assert.equal(classifySuspension(gate(t)).cls, "owner_pause");
    const own = await card(t);
    assert.deepEqual([own.eligible, own.code], [false, "OWNER_PAUSE"]);
    assert.match(own.reason, /„Continuă”/);
    assert.equal(t.hub.gateRearm.eligibility().code, "OWNER_PAUSE");
    const facts = await collectFacts(t.hub, { projectId: t.project.id, intent: "engineering" });
    assert.deepEqual(explain(facts).blockers.find((x) => x.code === "GATE_SUSPENDED").options.map((o) => o.kind), ["owner_decision_inline"]);
    const resumed = await t.hub.interrupts.resumeOwnPause({ session: t.owner.session, actor: "test" });
    assert.equal(resumed.reopened, true);
    assert.equal(gate(t).status, "open");
    assert.equal(events(t, "gate.rearmed").length, 0, "„Continuă” is not a rearm");
    // A pause recorded for another credential: „Continuă” refuses with rearm: true; the card (this session) is offered.
    t.hub.bus.transaction(() => t.hub.settings.set("executionGate", { status: "suspended", reason: "Pauză (fără pași noi)", changedAt: new Date().toISOString(), changedBy: "x",
      suspendedBy: { kind: "pause", id: "sus_other_credential", credential: "0".repeat(24), at: new Date().toISOString(), missions: [] } }, "test"));
    const otherCred = await t.hub.interrupts.resumeOwnPause({ session: t.owner.session, actor: "test" });
    assert.deepEqual([otherCred.reopened, otherCred.code, otherCred.rearm], [false, "OTHER_CREDENTIAL", true]);
    assert.match(otherCred.reason, /Windows Hello/);
    assert.equal(t.hub.gateRearm.eligibility().code, "OWNER_PAUSE", "without a session the pause stays the owner's");
    const offered = await card(t);
    assert.deepEqual([offered.eligible, offered.cls], [true, "owner_pause"]);
    assert.equal((await rearm(t, offered)).reopened, true);
    // After Stop All: „Continuă” never reopens; it says where the gate IS reopened.
    await ownerStop(t);
    const refused = await t.hub.interrupts.resumeOwnPause({ session: t.owner.session, actor: "test" });
    assert.deepEqual([refused.reopened, refused.code, refused.rearm], [false, "NOT_OWN_PAUSE", true]);
    assert.match(refused.reason, /Stop All/);
    assert.match(refused.reason, /cockpit, cu Windows Hello/);
    assert.doesNotMatch(refused.reason, ADMIN_POINTERS);
    assert.equal(gate(t).status, "suspended");
  } finally { await t.cleanup(); }
});
