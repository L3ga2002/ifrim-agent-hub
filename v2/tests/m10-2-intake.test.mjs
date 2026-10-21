// M10.2 U07 — one command path: the intake service behind owner.intent. Typed text, locally verified voice, provider transcripts and
// clarification buttons run the same executor; the source changes only what the effect-class matrix allows. Covered here: provider
// voice never confirms, never replaces a plan on screen, never raises autonomy, and runs a local action only under the derived Lega
// owner-session authority the server verified; "Nu acum" / "Anulează planul"; choices answered by the id the Hub offered; the pending
// verb; the server-held last target; transcript idempotency; planners (blocked → one preserved request, no plan; a card → lega.plan).
// Fixture providers and the fake desktop operator only: no network, no model.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { makeTestHub, waitFor, enrolOwner, prepareLiveWithoutGrants } from "./helpers.mjs";
import { makeDesktopHub, readyDesktop } from "./m10-helpers.mjs";
import { enrolVoice, startDerivedLega } from "./voice-helpers.mjs";
import { materializeFixture, demoSpec } from "../server/factory/fixtures.mjs";
import { LEGA_CONSENT_VERSION } from "../server/policy/lega-policy.mjs";
import { INTAKE_LIMITS, PLANNER_KINDS } from "../server/owner/intake.mjs";

const M09_MODELS = { writerModel: "gpt-fake-sol", reviewerModel: "sonnet" };
const OFFER = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n";
const dispatch = (hub, type, payload, extra = {}) => hub.commands.dispatch({ type, payload, channel: "test", actor: "test", ...extra });
const asOwner = (t, owner, payload, extra = {}) => t.hub.commands.dispatch({ type: "owner.intent", payload, channel: "owner", actor: `owner:${owner.session.id}`, ownerSession: owner.session, ...extra }).then((r) => r.result);
const onVoice = (t, payload) => t.hub.commands.dispatch({ type: "owner.intent", payload, channel: "voice", actor: "voice" }).then((r) => r.result);
const presentedOf = (env) => ({ envelopeId: env.id, nonce: env.nonce, hash: env.envelopeHash });
const count = (t, sql, ...args) => t.hub.db.prepare(sql).get(...args).n;
const liveEvents = (hub) => { const events = []; hub.live.subscribe((e) => events.push(e)); return events; };

/** A factory project with one SPEC_DRAFT mission at TRUSTED (optionally the owner's voice + local filter, so plans can be armed). */
async function planHub({ withVoice = false } = {}) {
  const t = await makeTestHub({ queues: true });
  await prepareLiveWithoutGrants(t.hub);
  const dir = path.join(t.dataDir, "factory-intake");
  materializeFixture("bug-demo", dir);
  const project = (await dispatch(t.hub, "project.register_test", { path: dir })).result;
  const owner = await enrolOwner(t, { activatePolicy: true });
  if (withVoice) { await enrolVoice(t, owner); await dispatch(t.hub, "voice.gate", { enabled: true }, { ownerSession: owner.session }); }
  await dispatch(t.hub, "owner.autonomy.set", { projectId: project.id, level: "TRUSTED" }, { ownerSession: owner.reauth() });
  const { mission } = (await dispatch(t.hub, "factory.prepare", { projectId: project.id, ...demoSpec("bug-demo"), limits: M09_MODELS })).result;
  return { ...t, project, owner, mission };
}

/** The desktop fixture plus a derived Lega voice session (owner session, voice-first policy, consent; BUILD_SAFE, no manual grant). */
async function legaDesktopHub() {
  const t = await makeDesktopHub({ hub: { codex: "lega-ok" } });
  const owner = await readyDesktop(t, ["notepad", "explorer"]);
  await prepareLiveWithoutGrants(t.hub);
  t.hub.bus.transaction(() => t.hub.settings.set("legaConsent", { version: LEGA_CONSENT_VERSION, confirmedAt: new Date().toISOString() }, "test"));
  t.hub.refreshCodexConfig();
  return { t, owner };
}
const ownerStart = (t, owner) => t.hub.commands.dispatch({ type: "lega.session.start", channel: "owner", actor: `owner:${owner.session.id}`, ownerSession: owner.session, payload: { sdp: OFFER } }).then((r) => r.result);

test("IK-01 a provider transcript never confirms a presented plan and never replaces it; typed 'Da?' does not confirm either", async () => {
  const t = await planHub();
  try {
    const shown = await asOwner(t, t.owner, { text: "Arată-mi planul", projectId: t.project.id });
    const env = shown.results[0].plan.envelope;
    assert.equal(env.status, "PROPOSED");
    const presented = presentedOf(env);
    const superseded = () => count(t, "SELECT COUNT(*) AS n FROM mission_envelopes WHERE status = 'SUPERSEDED'");
    // "Da, execută planul" from the provider: the cookie is there, the plan is presented — still no confirmation.
    for (const out of [await asOwner(t, t.owner, { text: "Da, execută planul", projectId: t.project.id, source: "voice-provider", presented }),
      await onVoice(t, { text: "Da, execută planul", projectId: t.project.id, presented })]) {
      assert.ok(out.results.every((r) => !r.confirmed), JSON.stringify(out.results));
      assert.ok(out.resolved.refused.some((x) => x.intent === "confirm"));
    }
    assert.equal(t.hub.envelopes.get(env.id).status, "PROPOSED");
    // "Arată-mi planul" from the provider while the card waits: refused, the card is not superseded.
    const before = superseded();
    for (const out of [await asOwner(t, t.owner, { text: "Arată-mi planul", projectId: t.project.id, source: "voice-provider", presented }),
      await onVoice(t, { text: "Arată-mi planul", projectId: t.project.id, presented })]) {
      assert.match(out.results[0].refused || "", /Un plan așteaptă răspunsul tău/, JSON.stringify(out.results[0]));
      assert.equal(out.results[0].plan, undefined);
    }
    assert.equal(superseded(), before, "the presented plan is not superseded by a provider transcript");
    assert.equal(t.hub.envelopes.get(env.id).status, "PROPOSED");
    // A typed question is not an answer.
    const q = await asOwner(t, t.owner, { text: "Da?", projectId: t.project.id, presented });
    assert.ok(q.results.every((r) => !r.confirmed));
    assert.equal(t.hub.envelopes.get(env.id).status, "PROPOSED");
    // Typed in the session, for THAT plan: the one confirmation (the executor is the same; only the source differed).
    t.queue("codex", "factory-write:bug-fix"); t.queue("claude", "review:pass");
    const yes = await asOwner(t, t.owner, { text: "Da, execută planul", projectId: t.project.id, presented });
    assert.ok(yes.results[0].confirmed?.envelope, JSON.stringify(yes.results[0]));
    await waitFor(() => ["DELIVERY_READY", "NEEDS_OWNER_DECISION", "BLOCKED"].includes(t.hub.factory.view(t.mission.id).factory.stage), 120000, 100);
  } finally { await t.cleanup(); }
});

test("IK-02 provider voice: a local action only under the server-verified derived Lega session (forged, cookie-less or ended → refused); autonomy never", async () => {
  const { t, owner } = await legaDesktopHub();
  try {
    const actions = () => count(t, "SELECT COUNT(*) AS n FROM desktop_actions");
    // No Lega session at all: a provider transcript cannot open an app (D7), even with the owner's cookie.
    const none = await asOwner(t, owner, { text: "Deschide Notepad", source: "voice-provider" });
    assert.match(none.results[0].refused || "", /sesiunea Lega derivată/, JSON.stringify(none.results[0]));
    assert.equal(actions(), 0);
    const started = await ownerStart(t, owner);
    assert.equal(started.authority, "owner_session");
    const lega = started.sessionId;
    // A forged Lega session id is a claim, not an authority.
    const forged = await asOwner(t, owner, { text: "Deschide Notepad", source: "voice-provider", legaSessionId: "lega_forged" });
    assert.match(forged.results[0].refused || "", /sesiunea Lega derivată/);
    const forgedVoice = await onVoice(t, { text: "Deschide Notepad", legaSessionId: "lega_forged" });
    assert.match(forgedVoice.results[0].refused || "", /sesiunea Lega derivată/);
    // The real id on the cookie-less ui channel: the id is visible in the Hub state, so it is not enough there.
    const ui = await t.hub.commands.dispatch({ type: "owner.intent", payload: { text: "Deschide Notepad", source: "voice-provider", legaSessionId: lega }, channel: "ui", actor: "user" }).then((r) => r.result);
    assert.ok(ui.results[0].refused, JSON.stringify(ui.results[0]));
    assert.equal(actions(), 0, "nothing reached the desktop so far");
    // Verified: the running derived session, from the owner's session → the app opens (cookie path and the server voice route).
    const ok = await asOwner(t, owner, { text: "Deschide Notepad", source: "voice-provider", legaSessionId: lega });
    assert.equal(ok.results[0].refused, undefined, JSON.stringify(ok.results[0]));
    assert.equal(ok.results[0].desktop?.app?.id, "notepad");
    const viaVoice = await onVoice(t, { text: "Adu Notepad în față", legaSessionId: lega });
    assert.equal(viaVoice.results[0].refused, undefined, JSON.stringify(viaVoice.results[0]));
    assert.equal(viaVoice.results[0].desktop?.app?.id, "notepad");
    // Authority from a provider transcript: never, derived session or not.
    const hubId = t.hub.projects.hub().id;
    const level = t.hub.envelopes.autonomyOf(hubId).level;
    for (const out of [await asOwner(t, owner, { text: "Setează autonomia pe trusted", projectId: hubId, source: "voice-provider", legaSessionId: lega }),
      await onVoice(t, { text: "Setează autonomia pe trusted", projectId: hubId, legaSessionId: lega })]) assert.match(out.results[0].refused || "", /nu schimb autoritatea/);
    assert.equal(t.hub.envelopes.autonomyOf(hubId).level, level);
    // A display preference (the start screen) from the provider needs the derived authority too; "Nu mă deranja" only reduces.
    const pref = await onVoice(t, { text: "Pornește direct în cockpit" });
    assert.match(pref.results[0].refused || "", /sesiunea Lega derivată/);
    const quiet = await onVoice(t, { text: "Nu mă deranja" });
    assert.equal(quiet.results[0].refused, undefined);
    // The Lega session ends: the same id authorizes nothing any more.
    await t.hub.lega.stopAll("test");
    await waitFor(() => !t.hub.lega.active(), 10000);
    const n = actions();
    const after = await asOwner(t, owner, { text: "Deschide Notepad", source: "voice-provider", legaSessionId: lega });
    assert.match(after.results[0].refused || "", /sesiunea Lega derivată/);
    assert.equal(actions(), n);
  } finally { await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }
});

test("IK-03 „Nu acum” closes the armed window and keeps the plan PROPOSED; „Anulează planul” withdraws it (CANCELLED)", async () => {
  const t = await planHub({ withVoice: true });
  try {
    // M10.2 U13: the window opens only for the live Lega session derived from this owner session.
    const lega_a = await startDerivedLega(t, t.owner);
    const shown = await asOwner(t, t.owner, { text: "Arată-mi planul", projectId: t.project.id, legaSessionId: lega_a });
    const r = shown.results[0];
    assert.equal(r.armed?.armed, true, r.armed?.reason);
    const env = r.plan.envelope;
    assert.ok(t.hub.envelopes.armedFor(env.id, t.owner.session.id, lega_a));
    const no = await asOwner(t, t.owner, { text: "Nu acum", projectId: t.project.id, presented: presentedOf(env), legaSessionId: lega_a });
    assert.equal(no.resolved.steps[0].intent, "not_yet");
    assert.match(no.results[0].message, /Bine, nu pornesc nimic/);
    assert.deepEqual(no.results[0].disarmed, [env.id]);
    assert.equal(t.hub.envelopes.armedFor(env.id, t.owner.session.id, lega_a), null, "the armed voice window is closed");
    assert.equal(t.hub.envelopes.get(env.id).status, "PROPOSED", "the card stays for a later click");
    // A provider transcript may withdraw too (fail-safe: it only removes a plan).
    const cancel = await onVoice(t, { text: "Anulează planul", projectId: t.project.id, presented: presentedOf(env) });
    assert.equal(cancel.resolved.steps[0].intent, "reject_plan");
    assert.equal(cancel.results[0].cancelled?.status, "CANCELLED", JSON.stringify(cancel.results[0]));
    assert.equal(t.hub.envelopes.get(env.id).status, "CANCELLED");
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM agent_runs"), 0);
    // „Nu pot reordona” is said, not attempted; a condition holds the start (ONE question, no effect).
    const re = await asOwner(t, t.owner, { text: "Schimbă ordinea", projectId: t.project.id });
    assert.match(re.results[0].message, /Nu pot reordona/);
    const cond = await asOwner(t, t.owner, { text: "Execută planul doar dacă trec testele", projectId: t.project.id });
    assert.ok(cond.resolved.clarification);
    assert.ok(cond.results.every((x) => !x.confirmed && !x.plan));
  } finally { await t.cleanup(); }
});

test("IK-04 choices: a confirm choice only PRESENTS the plan; a continue_work choice selects the mission; a stale or foreign choice is refused", async () => {
  const t = await planHub();
  try {
    t.hub.missions.create({ projectId: t.project.id, kind: "project_management", title: "Numele din spații — documentare", objective: "doc" }, "test");
    const asked = await asOwner(t, t.owner, { text: "Continuă numele din spații", projectId: t.project.id });
    const c = asked.resolved.clarification;
    assert.ok(c && c.forIntent === "continue_work" && c.options.length === 2, JSON.stringify(asked.resolved));
    // A forged id (not among the options) and a wrong intent are refused.
    await assert.rejects(asOwner(t, t.owner, { choice: { forIntent: "continue_work", id: "mis_forged" }, projectId: t.project.id }), /Alegerea nu mai corespunde/);
    await assert.rejects(asOwner(t, t.owner, { choice: { forIntent: "open_project", id: t.mission.id }, projectId: t.project.id }), /Alegerea nu mai corespunde/);
    const chose = await asOwner(t, t.owner, { choice: { forIntent: "continue_work", id: t.mission.id }, projectId: t.project.id });
    assert.equal(chose.resolved.steps[0].intent, "continue_work", "the choice selects the mission, it is not an open_project");
    assert.equal(chose.resolved.steps[0].args.missionId, t.mission.id);
    const env = chose.results[0].plan.envelope;
    assert.deepEqual(env.missionIds, [t.mission.id]);
    assert.equal(env.status, "PROPOSED");
    // The clarification is single-use.
    await assert.rejects(asOwner(t, t.owner, { choice: { forIntent: "continue_work", id: t.mission.id }, projectId: t.project.id }), /Alegerea nu mai corespunde/);
    // A confirm choice (the Hub's own question "Care plan?") only shows that plan: nonce + hash are still needed.
    const conv = t.hub.intake.conversationOf(`owner:${t.owner.session.id}`);
    conv.clarification = { question: "Care plan?", forIntent: "confirm", options: [{ id: env.id, label: "plan" }], step: null, projectId: t.project.id, at: Date.now() };
    const shown = await asOwner(t, t.owner, { choice: { forIntent: "confirm", id: env.id }, projectId: t.project.id });
    assert.equal(shown.results[0].plan.envelope.id, env.id);
    assert.equal(shown.results[0].confirmed, undefined);
    assert.equal(t.hub.envelopes.get(env.id).status, "PROPOSED", "a choice never confirms");
    // Expired after its TTL.
    conv.clarification = { question: "Care plan?", forIntent: "confirm", options: [{ id: env.id, label: "plan" }], step: null, projectId: t.project.id, at: Date.now() - INTAKE_LIMITS.clarificationTtlMs - 1000 };
    await assert.rejects(asOwner(t, t.owner, { choice: { forIntent: "confirm", id: env.id }, projectId: t.project.id }), /Alegerea nu mai corespunde/);
    // A mission start on a non-factory mission: said plainly, nothing proposed.
    const pm = await asOwner(t, t.owner, { text: "Pornește misiunea documentare", projectId: t.project.id });
    assert.equal(pm.resolved.steps[0].intent, "start_mission");
    assert.match(pm.results[0].message || "", /nu are un flux automat/, JSON.stringify(pm.results[0]));
    assert.equal(pm.results[0].plan, undefined);
  } finally { await t.cleanup(); }
});

test("IK-05 pending verb, server-held last target, transcript idempotency", async () => {
  const { t, owner } = await legaDesktopHub();
  try {
    // „Deschide” alone: ONE question, nothing done.
    const q = await asOwner(t, owner, { text: "Deschide" });
    assert.equal(q.resolved.clarification?.question, "Ce să deschid?");
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM desktop_actions"), 0);
    // „Notepad” within 5 s completes it: one desktop_open.
    const joined = await asOwner(t, owner, { text: "Notepad" });
    assert.equal(joined.resolved.steps.length, 1);
    assert.equal(joined.resolved.steps[0].intent, "desktop_open", JSON.stringify(joined.resolved));
    assert.equal(joined.results[0].desktop?.app?.id, "notepad");
    // The slot is used once: a later „Explorer” alone is not joined to anything.
    const alone = await asOwner(t, owner, { text: "Explorer" });
    assert.notEqual(alone.resolved.steps[0].intent, "desktop_open");
    // An expired slot is not joined either.
    await asOwner(t, owner, { text: "Deschide" });
    t.hub.intake.conversationOf(`owner:${owner.session.id}`).verbSlot.at -= INTAKE_LIMITS.verbSlotMs + 100;
    const late = await asOwner(t, owner, { text: "Notepad" });
    assert.notEqual(late.resolved.steps[0].intent, "desktop_open");
    // „Deschide-l din nou”: the last target the server recorded (Notepad), never a client's claim.
    const again = await asOwner(t, owner, { text: "Deschide-l din nou" });
    assert.equal(again.resolved.steps[0].intent, "reopen_last");
    assert.equal(again.results[0].desktop?.app?.id, "notepad", JSON.stringify(again.results[0]));
    // A fresh conversation (no session: its own key) with a client-supplied lastTarget: ignored (the schema drops it) → ONE question.
    const forged = await dispatch(t.hub, "owner.intent", { text: "Deschide-l din nou", lastTarget: { kind: "app", id: "explorer", app: "explorer" } }).then((r) => r.result);
    assert.equal(forged.resolved.clarification?.forIntent, "reopen_last");
    assert.equal(forged.results[0].desktop, undefined);
    // The same transcript twice executes once (the voice bridge's id).
    const before = count(t, "SELECT COUNT(*) AS n FROM events WHERE type = 'owner.intent'");
    const first = await asOwner(t, owner, { text: "Arată-mi recomandările", transcriptId: "tr_1" });
    const second = await asOwner(t, owner, { text: "Arată-mi recomandările", transcriptId: "tr_1" });
    assert.equal(second.duplicate, true);
    assert.deepEqual(second.resolved.steps.map((s) => s.intent), first.resolved.steps.map((s) => s.intent));
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM events WHERE type = 'owner.intent'"), before + 1);
    // Reads added in M10.2.
    const reads = await asOwner(t, owner, { text: "Ce s-a executat ultima dată; arată-mi ultima livrare" });
    assert.deepEqual(reads.resolved.steps.map((s) => s.intent), ["last_run", "last_delivery"]);
    assert.ok(reads.results.every((r) => typeof r.message === "string" && r.message.length > 0 && !r.error), JSON.stringify(reads.results));
  } finally { await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }
});

test("IK-06 planners: blocked → one preserved request and no plan; a card → one lega.plan; registry kinds are fixed", async () => {
  const t = await planHub();
  try {
    assert.deepEqual([...PLANNER_KINDS].sort(), ["delivery", "desk", "engineering", "resume_mission", "run", "sales", "start_mission", "studio_create"]);
    assert.throws(() => t.hub.intake.registerPlanner("deploy", () => null), /necunoscut/);
    const recorded = [];
    t.hub.intake.attachWorkRequests({ recordBlocked: (req) => { recorded.push(req); return { id: `wr_${recorded.length}`, text: "Încă blocat; cererea ta e păstrată." }; } });
    const unregister = t.hub.intake.registerPlanner("studio_create", () => ({ kind: "blocked", blocker: { signature: "STUDIO_NO_MATERIAL", cause: "nicio sursă", text: "Nu am material video.", options: [{ kind: "owner_decision_inline", label: "Importă dintr-un folder" }] } }));
    const live = liveEvents(t.hub);
    const envBefore = count(t, "SELECT COUNT(*) AS n FROM mission_envelopes");
    const out = await asOwner(t, t.owner, { text: "Fă un videoclip de promovare de 30 de secunde", projectId: t.project.id });
    assert.equal(out.resolved.steps[0].intent, "studio_create");
    assert.equal(recorded.length, 1, "exactly one preserved request");
    assert.equal(recorded[0].intent, "studio_create");
    assert.equal(recorded[0].blocker.signature, "STUDIO_NO_MATERIAL");
    assert.equal(recorded[0].effectClass, "BOUNDED_WORKFLOW");
    assert.equal(out.results[0].workRequest.id, "wr_1");
    assert.equal(out.results[0].blockedBy.signature, "STUDIO_NO_MATERIAL");
    assert.equal(live.filter((e) => e.type === "lega.plan").length, 0, "a blocker publishes no plan");
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM mission_envelopes"), envBefore);
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM ops_plans"), 0);
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM agent_runs"), 0);
    unregister();
    // A planner that returns a card: ONE ops plan, announced once as lega.plan, nothing runs.
    t.hub.executors["test.probe"] = { describe: () => ({ title: "Sondă", params: {}, folders: [], ops: [{ op: "media.render" }], observed: ["nimic"], transmitted: [], outputs: ["rezultat"] }), run: async () => ({ result: {} }) };
    t.hub.intake.registerPlanner("studio_create", async ({ ctx }) => ({ kind: "ops", plan: await t.hub.opsPlans.propose({ kind: "test.studio", title: "Clip de test", steps: [{ kind: "test.probe", params: {} }], actor: ctx.actor, via: ctx.channel }) }));
    const carded = await asOwner(t, t.owner, { text: "Fă un clip de 15 secunde", projectId: t.project.id, legaSessionId: "lega_x" });
    assert.ok(carded.results[0].opsPlan?.id, JSON.stringify(carded.results[0]));
    const plans = live.filter((e) => e.type === "lega.plan");
    assert.equal(plans.length, 1);
    assert.equal(plans[0].kind, "ops");
    assert.equal(plans[0].id, carded.results[0].opsPlan.id);
    assert.equal(plans[0].sessionId, "lega_x");
    assert.equal(t.hub.opsPlans.view(carded.results[0].opsPlan.id).status, "PROPOSED", "nothing runs before the one confirmation");
    // A provider transcript may propose (no plan on screen) but the same request is refused while a plan waits for its answer.
    const shown = await asOwner(t, t.owner, { text: "Arată-mi planul", projectId: t.project.id });
    assert.equal(live.filter((e) => e.type === "lega.plan" && e.kind === "envelope").length, 1, "a shown envelope is announced");
    const blockedByCard = await asOwner(t, t.owner, { text: "Fă un clip de 15 secunde", projectId: t.project.id, source: "voice-provider", presented: presentedOf(shown.results[0].plan.envelope) });
    assert.match(blockedByCard.results[0].refused || "", /Un plan așteaptă răspunsul tău/);
    // intake.plan (Lega's request tool) goes through the same gate and the same planner.
    const viaPlan = await t.hub.intake.plan({ kind: "studio_create", text: "clip" }, { channel: "voice", actor: "voice" });
    assert.equal(viaPlan.effectClass, "BOUNDED_WORKFLOW");
    assert.equal(viaPlan.refused, undefined);
    await assert.rejects(t.hub.intake.plan({ kind: "deploy" }, { channel: "test", actor: "t" }), /necunoscut/);
  } finally { await t.cleanup(); }
});
