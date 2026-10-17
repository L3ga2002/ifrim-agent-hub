// M10.2 review, group G2b (intake / Lega bridge / interruptions / cockpit). Regression tests for findings #4 („De ce e blocat?” after
// the owner's own pause says „Continuă”, not the typed OPEN GATE), #5 (a code request that names its project plans on THAT project,
// one question when the cockpit shows another, a voice answer naming the project completes the waiting request, the bridge's plan is
// not planned again by request_work), #6/#8 („Oprește Codex” → „Continuă” / „Reia misiunea X” resume the mission inside its open
// plan, owner session only, no widening), #7 („Lega, pauză” pauses running operation plans like the typed „Pauză”), #13/#23 (the
// provider's transcript of „Da, execută planul” during an armed window is silent; under voice-first a FORBIDDEN-word sentence reaches
// the intake instead of the click notice; legacy unchanged), #20 (the voice route judges a provider transcript against the plan
// waiting in its Lega session: „Da, pornește misiunea” gets a hint, never a new card) and #26 (the pending verb is not joined to a
// refused „Da”). Fixture providers, software authenticator, fixture voice worker: no model, no network.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeTestHub, enrolOwner, prepareLiveWithoutGrants, waitFor } from "./helpers.mjs";
import { enrolVoice, speak, startDerivedLega } from "./voice-helpers.mjs";
import { materializeFixture, demoSpec } from "../server/factory/fixtures.mjs";
import { LEGA_CONSENT_VERSION } from "../server/policy/lega-policy.mjs";

const M09_MODELS = { writerModel: "gpt-fake-sol", reviewerModel: "sonnet" };
const MISSION_TITLE = "Numele din spații trebuie refuzat";
const OFFER = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n";
const b64 = (list) => Buffer.from(JSON.stringify(list)).toString("base64url");
const script = (list) => `lega-script:${b64(list)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dispatch = (hub, type, payload, extra = {}) => hub.commands.dispatch({ type, payload, channel: "test", actor: "test", ...extra });
const asOwner = (t, payload) => t.hub.commands.dispatch({ type: "owner.intent", payload, channel: "owner", actor: `owner:${t.owner.session.id}`, ownerSession: t.owner.session }).then((r) => r.result);
const asVoice = (t, payload) => t.hub.commands.dispatch({ type: "owner.intent", payload, channel: "voice", actor: "voice" }).then((r) => r.result);
const count = (t, sql, ...a) => t.hub.db.prepare(sql).get(...a).n;
const events = (t, type) => t.hub.db.prepare("SELECT payload_json FROM events WHERE type = ? ORDER BY seq").all(type).map((r) => JSON.parse(r.payload_json || "{}"));
const view = (t, id) => t.hub.factory.view(id);
const untilStage = (t, id, stages, ms = 90000) => waitFor(() => (stages.includes(view(t, id).factory.stage) ? view(t, id) : null), ms, 100);
const consent = (hub) => { hub.bus.transaction(() => hub.settings.set("legaConsent", { version: LEGA_CONSENT_VERSION, confirmedAt: new Date().toISOString() }, "test")); hub.refreshCodexConfig(); };
const ownerStart = (t) => t.hub.commands.dispatch({ type: "lega.session.start", channel: "owner", actor: `owner:${t.owner.session.id}`, ownerSession: t.owner.session, payload: { sdp: OFFER } }).then((r) => r.result);
const uiStart = (t) => t.hub.commands.dispatch({ type: "lega.session.start", channel: "ui", actor: "user", payload: { sdp: OFFER } }).then((r) => r.result);
const connect = (t, s) => t.hub.commands.dispatch({ type: "lega.session.connected", channel: "ui", actor: "user", payload: { sessionId: s.sessionId } });
const replies = (t) => t.readLog("codex").filter((l) => l.toolReply).map((l) => ({ tool: l.tool, ok: l.toolReply.success, text: l.toolReply.contentItems?.[0]?.text || "" }));

/** A factory test project (bug-demo) at TRUSTED with one SPEC_DRAFT mission, the owner (voice-first policy), BUILD_SAFE, no grant. */
async function factoryHub({ codex = "ok", second = false, activatePolicy = true } = {}) {
  const t = await makeTestHub({ queues: true, codex });
  fs.writeFileSync(`${t.logs.codex}.models.json`, JSON.stringify([{ id: "gpt-6.1-sol", isDefault: true, efforts: ["medium", "high"] }, { id: "gpt-fake-sol", efforts: ["medium", "high"] }]));
  await prepareLiveWithoutGrants(t.hub);
  const register = async (label, title) => {
    const dir = path.join(t.dataDir, label);
    materializeFixture("bug-demo", dir);
    return (await dispatch(t.hub, "project.register_test", { path: dir, name: title })).result;
  };
  const project = await register("factory-g2b", ALFA);
  const other = second ? await register("factory-g2b-alt", "Beta Demo") : null;
  const owner = await enrolOwner(t, { activatePolicy });
  for (const p of [project, other].filter(Boolean)) await dispatch(t.hub, "owner.autonomy.set", { projectId: p.id, level: "TRUSTED" }, { ownerSession: owner.reauth() });
  const { mission } = (await dispatch(t.hub, "factory.prepare", { projectId: project.id, ...demoSpec("bug-demo"), limits: M09_MODELS })).result;
  return { ...t, project, other, owner, mission };
}
const ALFA = "Alfa Demo";
// ONE clause (a period would split it): the request, its acceptance test, and — in NAMED — the project at the end.
const BUG = "Repară bug-ul de validare a numelui format doar din spații, cu testul de acceptanță test/acceptance.test.mjs";
const NAMED = `${BUG}, pe proiectul ${ALFA}`;

// ------------------------------------------------------------------ #4
test("G2b-01 (#4) after the owner's own „Pauză” „De ce e blocat?” says „Continuă” (no typed OPEN GATE); after Stop All the gate is reopened in the cockpit with Windows Hello (M10.2.1 D14: no admin pointer)", async () => {
  const t = await factoryHub();
  try {
    await asOwner(t, { text: "Pauză", projectId: t.project.id });
    assert.equal(t.hub.settings.get("executionGate").suspendedBy?.kind, "pause");
    const why = (await asOwner(t, { text: "De ce e blocat?", projectId: t.project.id })).results[0].explain;
    const gate = why.items.find((i) => /Poarta de execuție/.test(i.what));
    assert.ok(gate, JSON.stringify(why.items));
    assert.match(gate.action, /Continuă/);
    assert.doesNotMatch(gate.action, /tastezi OPEN GATE/);
    assert.equal(gate.suspendedBy, "owner_pause");
    // Stop All: M10.2.1 (D14) — reopened contextually, in the cockpit, by the rearm card with Windows Hello; never the admin pointer.
    await t.hub.commands.dispatch({ type: "system.stop_all", payload: { reason: "test" }, channel: "owner", actor: "owner", ownerSession: t.owner.session });
    const after = t.hub.cockpit.whyBlocked({ projectId: t.project.id }).items.find((i) => /Poarta de execuție/.test(i.what));
    assert.match(after.action, /Stop All/);
    assert.match(after.action, /în cockpit, cu Windows Hello/);
    assert.doesNotMatch(after.action, /OPEN GATE|Integrări → Avansat|Sistem/);
    assert.doesNotMatch(after.action, /Continuă/);
    // A pause without the owner session (a device, a provider transcript) is not the owner's: the admin text too.
    t.hub.bus.transaction(() => t.hub.settings.set("executionGate", { status: "suspended", reason: "Pauză (fără pași noi)", changedAt: new Date().toISOString(), changedBy: "voice",
      suspendedBy: { kind: "pause", credential: null, at: new Date().toISOString(), missions: [] } }, "test"));
    const unowned = t.hub.cockpit.whyBlocked({}).items.find((i) => /Poarta de execuție/.test(i.what));
    assert.equal(unowned.suspendedBy, "pause_unowned");
    assert.match(unowned.action, /fără sesiunea ta de proprietar/);
  } finally { await t.cleanup(); }
});

// ------------------------------------------------------------------ #5
test("G2b-02 (#5) a code request naming its project plans there (voice, no cockpit); typed in another project's cockpit it asks ONE question; the choice plans on the one chosen", async () => {
  const t = await factoryHub({ second: true });
  try {
    const named = NAMED;
    // The voice route has no cockpit project: the named one is used — no „Pe ce proiect lucrez?”.
    const byVoice = await asVoice(t, { text: named });
    assert.equal(byVoice.resolved.steps[0].intent, "engineering_request", JSON.stringify(byVoice.resolved));
    assert.equal(byVoice.resolved.steps[0].args.projectId, t.project.id, `the resolver named the project: ${JSON.stringify(byVoice.resolved.steps[0].args)}`);
    const r = byVoice.results[0];
    assert.doesNotMatch(String(r.message || ""), /Pe ce proiect/);
    assert.ok(r.plan?.envelope?.id || r.blockedBy, `a plan (or the server's blocker) on the named project: ${JSON.stringify(r).slice(0, 400)}`);
    if (r.plan?.envelope) assert.equal(r.plan.envelope.projectId, t.project.id);
    const plans = count(t, "SELECT COUNT(*) AS n FROM mission_envelopes");
    // Typed in the OTHER project's cockpit: the cockpit's project never silently wins; ONE question, nothing drafted.
    const typed = await asOwner(t, { text: named, projectId: t.other.id });
    const q = typed.results[0];
    assert.ok(q.clarification, JSON.stringify(q).slice(0, 400));
    assert.deepEqual(q.clarification.options.map((o) => o.id), [t.project.id, t.other.id]);
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM mission_envelopes"), plans, "no plan drafted on either project");
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM mission_envelopes WHERE project_id = ?", t.other.id), 0);
    // The owner picks the named project: the request plans there (an offered id).
    const chosen = await asOwner(t, { choice: { forIntent: "engineering_request", id: t.project.id }, projectId: t.other.id });
    const c = chosen.results[0];
    assert.doesNotMatch(String(c.message || ""), /Ce să schimb în cod|Pe ce proiect/, JSON.stringify(c).slice(0, 400));
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM mission_envelopes WHERE project_id = ?", t.other.id), 0, "never on the cockpit's project");
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM agent_runs").get().n, 0);
  } finally { await t.cleanup(); }
});

test("G2b-03 (#5) by voice „Pe ce proiect lucrez?” is answered by just naming the project: the SAME request plans there (not only the cockpit opening)", async () => {
  const t = await factoryHub();
  try {
    const ask = await asVoice(t, { text: BUG });
    const q = ask.results[0];
    assert.match(String(q.message || ""), /Pe ce proiect/, JSON.stringify(q).slice(0, 400));
    const answer = await asVoice(t, { text: t.project.name });
    assert.equal(answer.resolved.steps[0].intent, "open_project");
    const r = answer.results[0];
    assert.notEqual(r.intent, "open_project", `the answer completed the waiting request: ${JSON.stringify(r).slice(0, 400)}`);
    assert.ok(r.plan?.envelope?.id || r.blockedBy, JSON.stringify(r).slice(0, 400));
    if (r.plan?.envelope) assert.equal(r.plan.envelope.projectId, t.project.id);
    assert.equal(answer.projectId, t.project.id);
    // Once answered, naming the project again only opens it (the question is spent).
    const again = await asVoice(t, { text: t.project.name });
    assert.equal(again.results[0].intent, "open_project");
    assert.equal(again.results[0].cockpit?.project?.id, t.project.id);
  } finally { await t.cleanup(); }
});

test("G2b-04 (#5) the voice bridge plans the owner's code request ONCE: the agent's request_work right after reports the bridge's result instead of planning again", async () => {
  const t = await factoryHub({ codex: script([{ sleep: 1500 }, { say: NAMED }, { sleep: 3000 }, { tool: "request_work", args: { request: NAMED, kind_hint: "engineering" } }]) });
  try {
    consent(t.hub);
    const s = await ownerStart(t);
    assert.equal(s.authority, "owner_session");
    await connect(t, s);
    await waitFor(() => t.readLog("codex").some((l) => l.scriptDone), 30000);
    await waitFor(() => replies(t).some((x) => x.tool === "request_work"), 10000);
    const reply = replies(t).find((x) => x.tool === "request_work");
    assert.match(reply.text, /a pregătit deja asta din cuvintele tale/, reply.text);
    assert.ok(count(t, "SELECT COUNT(*) AS n FROM mission_envelopes WHERE project_id = ?", t.project.id) <= 1, "one plan for one sentence");
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM commands WHERE type = 'owner.intent'"), 1, "the sentence went through the intake once");
    const actions = t.hub.lega.hubActions();
    assert.ok(actions[0].intents.includes("engineering_request"), JSON.stringify(actions));
  } finally { await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }
});

// ------------------------------------------------------------------ #6 / #8
test("G2b-05 (#6/#8) „Oprește Codex” pauses the plan's mission; typed „Continuă” (gate open) resumes it inside the plan; a provider transcript cannot", async () => {
  const t = await factoryHub();
  try {
    const intent = (text, channel = "owner") => (channel === "owner" ? asOwner(t, { text, projectId: t.project.id }) : asVoice(t, { text }));
    const { envelope } = (await dispatch(t.hub, "envelope.propose", { projectId: t.project.id })).result;
    t.queue("codex", "hang");
    await dispatch(t.hub, "envelope.confirm", { envelopeId: envelope.id, nonce: envelope.nonce, displayedHash: envelope.envelopeHash }, { ownerSession: t.owner.session });
    await waitFor(() => (t.hub.runs.activeRuns().some((r) => r.provider === "codex") ? true : null), 30000, 50);
    const stop = await intent("Oprește Codex");
    assert.equal(stop.results[0].intent, "stop_worker", JSON.stringify(stop.resolved));
    await untilStage(t, t.mission.id, ["PAUSED"], 20000);
    await waitFor(() => (t.hub.runs.activeRuns().length === 0 ? true : null), 15000);
    await waitFor(() => (t.hub.envelopes.get(envelope.id).status === "WAITING_OWNER" ? true : null), 10000);
    assert.equal(t.hub.settings.get("executionGate").status, "open", "a worker stop leaves the gate open");
    const audit = events(t, "owner.interrupt").find((e) => e.kind === "stop_worker");
    assert.deepEqual(audit.missions, [t.mission.id]);
    assert.ok(audit.credential && !audit.credential.includes(t.owner.session.credentialId), "only a credential reference");
    assert.match(stop.results[0].interrupt.missions[0].note, /Continuă/);
    // A provider transcript: refused by the effect class; nothing resumes.
    const fromProvider = await intent("Continuă", "voice");
    assert.ok(fromProvider.results.some((r) => r.refused), JSON.stringify(fromProvider.results));
    assert.equal(view(t, t.mission.id).factory.stage, "PAUSED");
    // Typed „Continuă” in the owner session: the mission resumes within the same plan (no new plan, no delta, no extra cycle).
    t.queue("codex", "factory-write:bug-fix"); t.queue("claude", "review:pass");
    const typed = await intent("Continuă");
    const r = typed.results[0];
    assert.match(String(r.message), /Am reluat „/, JSON.stringify(r).slice(0, 500));
    assert.doesNotMatch(String(r.message), /Nu am niciun plan oprit/);
    const done = await untilStage(t, t.mission.id, ["DELIVERY_READY", "NEEDS_OWNER_DECISION", "BLOCKED", "PAUSED"]);
    assert.equal(done.factory.stage, "DELIVERY_READY", done.factory.stageReason);
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM events WHERE type = 'factory.extra_cycle'"), 0, "no extra cycle");
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM mission_envelopes"), 1, "no continuation plan");
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM events WHERE type = 'envelope.delta_confirmed'"), 0);
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM commands WHERE type IN ('factory.resume','gate.set')"), 0, "no Factory form, no OPEN GATE");
  } finally { await t.cleanup(); }
});

test("G2b-06 (#6) „Reia misiunea X” typed in the owner session resumes a mission its open plan stopped; by voice it points to „Continuă” (never promises the impossible)", async () => {
  const t = await factoryHub();
  try {
    const { envelope } = (await dispatch(t.hub, "envelope.propose", { projectId: t.project.id })).result;
    t.queue("codex", "hang");
    await dispatch(t.hub, "envelope.confirm", { envelopeId: envelope.id, nonce: envelope.nonce, displayedHash: envelope.envelopeHash }, { ownerSession: t.owner.session });
    await waitFor(() => (t.hub.runs.activeRuns().some((r) => r.provider === "codex") ? true : null), 30000, 50);
    await asOwner(t, { text: "Oprește Codex", projectId: t.project.id });
    await untilStage(t, t.mission.id, ["PAUSED"], 20000);
    await waitFor(() => (t.hub.runs.activeRuns().length === 0 ? true : null), 15000);
    const spoken = await asVoice(t, { text: `Reia misiunea ${MISSION_TITLE}` });
    const v = spoken.results[0];
    assert.equal(v.intent, "resume_mission", JSON.stringify(spoken.resolved));
    assert.match(String(v.message), /Continuă/);
    assert.match(String(v.message), /sesiunea ta/);
    assert.equal(view(t, t.mission.id).factory.stage, "PAUSED", "a provider transcript resumes nothing");
    t.queue("codex", "factory-write:bug-fix"); t.queue("claude", "review:pass");
    const typed = await asOwner(t, { text: `Reia misiunea ${MISSION_TITLE}`, projectId: t.project.id });
    assert.match(String(typed.results[0].message), /Am reluat „/, JSON.stringify(typed.results[0]).slice(0, 400));
    const done = await untilStage(t, t.mission.id, ["DELIVERY_READY", "NEEDS_OWNER_DECISION", "BLOCKED", "PAUSED"]);
    assert.equal(done.factory.stage, "DELIVERY_READY", done.factory.stageReason);
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM mission_envelopes"), 1, "no continuation plan");
  } finally { await t.cleanup(); }
});

test("G2b-07 (#8) planResumeCheck: a plan held, a BLOCKED 'grant' or an exhausted decision is not resumed by „Continuă” (the honest pointer instead)", async () => {
  const t = await factoryHub();
  try {
    const { envelope } = (await dispatch(t.hub, "envelope.propose", { projectId: t.project.id })).result;
    t.queue("codex", "hang");
    await dispatch(t.hub, "envelope.confirm", { envelopeId: envelope.id, nonce: envelope.nonce, displayedHash: envelope.envelopeHash }, { ownerSession: t.owner.session });
    await waitFor(() => (t.hub.runs.activeRuns().some((r) => r.provider === "codex") ? true : null), 30000, 50);
    await asOwner(t, { text: "Oprește Codex", projectId: t.project.id });
    await untilStage(t, t.mission.id, ["PAUSED"], 20000);
    await waitFor(() => (t.hub.runs.activeRuns().length === 0 ? true : null), 15000);
    assert.equal(t.hub.interrupts.planResumeCheck(t.mission.id, t.owner.session).ok, true);
    // BLOCKED on the plan's authority: a difference to confirm, never a plain resume.
    t.hub.db.prepare("UPDATE factory_missions SET stage = 'BLOCKED', wait_reason = 'grant' WHERE mission_id = ?").run(t.mission.id);
    const grant = t.hub.interrupts.planResumeCheck(t.mission.id, t.owner.session);
    assert.equal(grant.ok, false); assert.match(grant.why, /confirmă diferența/);
    const said = (await asOwner(t, { text: "Continuă", projectId: t.project.id })).results[0];
    assert.match(String(said.message), /confirmă diferența/, JSON.stringify(said).slice(0, 400));
    assert.equal(view(t, t.mission.id).factory.stage, "BLOCKED");
    // A held plan: its hold is the answer.
    t.hub.db.prepare("UPDATE factory_missions SET stage = 'PAUSED', wait_reason = 'owner_decision' WHERE mission_id = ?").run(t.mission.id);
    const env = t.hub.envelopes.get(envelope.id);
    t.hub.db.prepare("UPDATE mission_envelopes SET derived_json = ? WHERE id = ?").run(JSON.stringify({ ...env.derived, hold: "Sarcina următoare depinde de t1, care nu e livrată" }), envelope.id);
    const held = t.hub.interrupts.planResumeCheck(t.mission.id, t.owner.session);
    assert.equal(held.ok, false); assert.match(held.why, /depinde de t1/);
    // Without the owner session nothing resumes (authentication), whatever the state.
    await assert.rejects(t.hub.interrupts.resumeStopped({ session: null, actor: "test" }), /sesiunea ta de proprietar/);
  } finally { await t.cleanup(); }
});

// ------------------------------------------------------------------ #7
test("G2b-08 (#7) „Lega, pauză” in a derived session pauses a RUNNING operation plan (one pause path: interrupts.pause)", async () => {
  const say = script([{ sleep: 2500 }, { say: "Lega, pauză" }, { sleep: 60000 }]);
  const t = await makeTestHub({ codex: say });
  const gate = { open: false };
  try {
    const owner = await enrolOwner(t, { activatePolicy: true });
    await prepareLiveWithoutGrants(t.hub);
    consent(t.hub);
    t.hub.executors["test.wait"] = {
      describe: () => ({ title: "Așteaptă", params: {}, ops: [{ op: "media.render" }], observed: [], transmitted: [], outputs: [] }),
      run: async ({ authorize, abort }) => { authorize({ op: "media.render" }); while (!gate.open && !abort.aborted) await sleep(15); return { result: { waited: true } }; },
    };
    const opsAs = (type, payload) => t.hub.commands.dispatch({ type, payload, channel: "owner", actor: `owner:${owner.session.id}`, ownerSession: owner.session }).then((r) => r.result);
    const p = await opsAs("ops.plan.propose", { kind: "test.wait", title: "Randare lungă", steps: [{ kind: "test.wait", params: {} }] });
    await opsAs("ops.plan.confirm", { planId: p.id, nonce: p.nonce, displayedHash: p.hash });
    await waitFor(() => (t.hub.opsPlans.view(p.id).status === "RUNNING" ? true : null), 10000);
    const s = await t.hub.commands.dispatch({ type: "lega.session.start", channel: "owner", actor: `owner:${owner.session.id}`, ownerSession: owner.session, payload: { sdp: OFFER } }).then((r) => r.result);
    assert.equal(s.authority, "owner_session");
    await connect(t, s);
    await waitFor(() => (events(t, "lega.owner_pause").length ? true : null), 20000);
    const paused = await waitFor(() => (["PAUSED", "NEEDS_OWNER"].includes(t.hub.opsPlans.view(p.id).status) ? t.hub.opsPlans.view(p.id) : null), 10000);
    assert.equal(paused.status, "PAUSED", paused.statusReason);
    const audit = events(t, "owner.interrupt").find((e) => e.kind === "pause");
    assert.equal(audit.plansPaused, 1);
  } finally { gate.open = true; await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }
});

// ------------------------------------------------------------------ #13 / #23
test("G2b-09 (#13/#23) the provider's „Da, execută planul” in an armed window: no click notice, no intake call; the plan is confirmed once, by the local segment", async () => {
  const t = await makeTestHub({ queues: true, codex: script([{ sleep: 2500 }, { say: `Pornește misiunea ${MISSION_TITLE}` }, { sleep: 12000 }, { say: "Da, execută planul" }, { sleep: 60000 }]) });
  try {
    await prepareLiveWithoutGrants(t.hub);
    const dir = path.join(t.dataDir, "factory-g2b-armed");
    materializeFixture("bug-demo", dir);
    const project = (await dispatch(t.hub, "project.register_test", { path: dir })).result;
    const owner = await enrolOwner(t, { activatePolicy: true });
    await enrolVoice(t, owner);
    await dispatch(t.hub, "voice.gate", { enabled: true }, { ownerSession: owner.session });
    await dispatch(t.hub, "owner.autonomy.set", { projectId: project.id, level: "TRUSTED" }, { ownerSession: owner.reauth() });
    const { mission } = (await dispatch(t.hub, "factory.prepare", { projectId: project.id, ...demoSpec("bug-demo"), limits: M09_MODELS })).result;
    const live = []; t.hub.live.subscribe((e) => live.push(e));
    const lega = await startDerivedLega(t, owner);
    const gateSay = async (text) => {
      const g = await speak(t, owner, text, { purpose: "gate", legaSessionId: lega });
      if (g.result === "MATCH") await waitFor(() => t.hub.db.prepare("SELECT transcript_status FROM voice_utterances WHERE id = ?").get(g.utteranceId).transcript_status !== "pending", 5000);
      await sleep(200);
      return g;
    };
    await gateSay(`Pornește misiunea ${MISSION_TITLE}`);
    const armed = await waitFor(() => t.hub.armedWindows.open().find((w) => w.legaSessionId === lega) || null, 15000);
    const intentsBefore = count(t, "SELECT COUNT(*) AS n FROM commands WHERE type = 'owner.intent'");
    // The provider's own transcript of the cue arrives (the gate released a segment within the last 30 s).
    await gateSay("Și cât durează?");
    await waitFor(() => (events(t, "lega.transcript").some((e) => e.role === "user" && /Da, execută planul/.test(e.text)) ? true : null), 20000);
    await sleep(800);
    assert.ok(!live.some((e) => e.type === "lega.notice" && /prin click/.test(String(e.text || ""))), "no click notice for the phrase the Hub asked for");
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM commands WHERE type = 'owner.intent'"), intentsBefore, "the provider transcript of the cue never reaches the intake");
    assert.equal(t.hub.envelopes.get(armed.planId).status, "PROPOSED", "a provider transcript confirms nothing");
    // The owner's verified local segment confirms it — once.
    t.queue("codex", "factory-write:bug-fix"); t.queue("claude", "review:pass");
    const yes = await gateSay("Da, execută planul");
    assert.equal(yes.boundPlanId, armed.planId);
    await waitFor(() => (["ACTIVE", "COMPLETED", "WAITING_OWNER"].includes(t.hub.envelopes.get(armed.planId).status) ? true : null), 15000);
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM events WHERE type = 'envelope.confirmed' AND scope_id = ?", armed.planId), 1);
    await waitFor(() => ["DELIVERY_READY", "NEEDS_OWNER_DECISION", "BLOCKED"].includes(t.hub.factory.view(mission.id).factory.stage), 120000, 100);
  } finally { await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }
});

test("G2b-10 (#13/#23) voice-first with no plan armed: „Da, execută planul” and „Rulează testele” reach the intake (no click notice, nothing confirmed); legacy keeps the notice", async () => {
  const say = script([{ sleep: 1500 }, { say: "Da, execută planul" }, { sleep: 800 }, { say: "Rulează testele pe proiect" }, { sleep: 1500 }]);
  {
    const t = await makeTestHub({ codex: say });
    try {
      const owner = await enrolOwner(t, { activatePolicy: true });
      await prepareLiveWithoutGrants(t.hub);
      consent(t.hub);
      const live = []; t.hub.live.subscribe((e) => live.push(e));
      const s = await t.hub.commands.dispatch({ type: "lega.session.start", channel: "owner", actor: `owner:${owner.session.id}`, ownerSession: owner.session, payload: { sdp: OFFER } }).then((r) => r.result);
      await connect(t, s);
      await waitFor(() => t.readLog("codex").some((l) => l.scriptDone), 20000);
      await sleep(500);
      assert.ok(!live.some((e) => e.type === "lega.notice" && /prin click/.test(String(e.text || ""))), "voice-first: no click notice");
      assert.equal(count(t, "SELECT COUNT(*) AS n FROM commands WHERE type = 'owner.intent' AND channel = 'voice'"), 2, "both sentences reached the intake");
      assert.equal(count(t, "SELECT COUNT(*) AS n FROM events WHERE type = 'envelope.confirmed'"), 0);
    } finally { await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }
  }
  {
    const t = await makeTestHub({ codex: say });
    try {
      await enrolOwner(t, { activatePolicy: false });
      const { enableLive } = await import("./helpers.mjs");
      await enableLive(t.hub, { provider: "codex" });
      t.hub.bus.transaction(() => t.hub.grants.create({ provider: "codex", projectId: t.hub.projects.hub().id, access: "read-only", maxAttempts: 2, maxDurationS: 600, ttlMinutes: 30, kind: "voice" }, "test"));
      consent(t.hub);
      const live = []; t.hub.live.subscribe((e) => live.push(e));
      const s = await uiStart(t);
      await connect(t, s);
      await waitFor(() => t.readLog("codex").some((l) => l.scriptDone), 20000);
      await sleep(300);
      assert.equal(t.hub.lega.state().voiceFirst, false);
      assert.ok(live.some((e) => e.type === "lega.notice" && /prin click/.test(String(e.text || ""))), "legacy: the notice is unchanged");
      assert.equal(count(t, "SELECT COUNT(*) AS n FROM commands WHERE type = 'owner.intent'"), 0, "legacy never bridges");
    } finally { await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }
  }
});

// ------------------------------------------------------------------ #20
test("G2b-11 (#20) voice route: while the plan announced in the Lega session waits, „Da, pornește misiunea” gets a hint and a new request is refused; after „Nu acum” it is allowed", async () => {
  const t = await factoryHub();
  try {
    const legaSessionId = "lega_g2b_test";
    const first = await asVoice(t, { text: `Pornește misiunea ${MISSION_TITLE}`, legaSessionId });
    const env = first.results[0].plan?.envelope;
    assert.ok(env?.id, JSON.stringify(first.results[0]).slice(0, 400));
    // The real bridge payload: no `presented`.
    const yes = await asVoice(t, { text: "Da, pornește misiunea", legaSessionId });
    assert.match(String(yes.results[0].message), /Da, execută planul/);
    assert.equal(yes.results[0].plan, undefined);
    assert.equal(t.hub.envelopes.get(env.id).status, "PROPOSED", "the card being answered is not superseded");
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM mission_envelopes"), 1);
    const other = await asVoice(t, { text: NAMED, legaSessionId });
    assert.match(String(other.results[0].refused || ""), /Un plan așteaptă/, JSON.stringify(other.results[0]).slice(0, 400));
    assert.equal(t.hub.envelopes.get(env.id).status, "PROPOSED");
    // „Nu acum”: the card stays (clickable) but no longer waits for a spoken answer here.
    await asVoice(t, { text: "Nu acum", legaSessionId });
    const after = await asVoice(t, { text: NAMED, legaSessionId });
    assert.ok(!after.results[0].refused, JSON.stringify(after.results[0]).slice(0, 400));
    // Another Lega session (or none) is not held by this one's plan.
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM agent_runs").get().n, 0);
  } finally { await t.cleanup(); }
});

// ------------------------------------------------------------------ #26
test("G2b-12 (#26) „Deschide” then „Da” (no plan waiting) is a refused confirmation, never „Deschide Da”", async () => {
  const t = await factoryHub();
  try {
    const verb = await asOwner(t, { text: "Deschide" });
    assert.equal(verb.resolved.clarification?.forIntent, "pending_verb");
    const da = await asOwner(t, { text: "Da" });
    assert.ok(!da.resolved.steps.some((s) => s.intent === "open_project"), JSON.stringify(da.resolved.steps));
    assert.ok(da.resolved.refused.some((x) => x.intent === "confirm"), JSON.stringify(da.resolved));
    // A real object after the bare verb is still joined.
    await asOwner(t, { text: "Deschide" });
    const joined = await asOwner(t, { text: t.project.name });
    assert.equal(joined.results[0].cockpit?.project?.id, t.project.id);
  } finally { await t.cleanup(); }
});
