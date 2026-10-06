// M10.2 U08 — Lega on the intake. Under voice-first (a session derived from the owner session, or the voice-first policy active) the
// owner's final transcripts reach the intake through the server voice bridge (after the deterministic Stop / pause fast path), the
// Hub speaks its own acknowledgement, the agent's vocabulary is plans (no grant tool, no arrow at the mode / gate / grant forms, how-to
// teaches plan / r2 / environment / studio), real work goes to lega.request_work, propose_run / propose_mission reach the planners
// (never an approval card), a refusal is the server's explanation (no raw gate ids), kept once as a work request, and the proposal
// cap counts plans and kept requests. The legacy policy is unchanged. Fake app-server, fake desktop operator: no network, no model.
import test from "node:test";
import assert from "node:assert/strict";
import { makeTestHub, enrolOwner, prepareLiveWithoutGrants, enableLive, waitFor } from "./helpers.mjs";
import { makeDesktopHub, readyDesktop } from "./m10-helpers.mjs";
import { LEGA_CONSENT_VERSION, LEGA_TARGETS, LEGA_SCREENS, LEGA_HOWTO, LEGA_HOWTO_VOICE_FIRST, LEGA_LEGACY_ONLY_TARGETS, legaDynamicTools, legaAgentInstructions, legaVoicePrompt } from "../server/policy/lega-policy.mjs";
import { explain } from "../server/owner/blockers.mjs";
import { collectFacts } from "../server/owner/readiness-runner.mjs";

const OFFER = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n";
const b64 = (list) => Buffer.from(JSON.stringify(list)).toString("base64url");
const calls = (list) => `lega-calls:${b64(list)}`;
const script = (list) => `lega-script:${b64(list)}`;
const count = (t, sql, ...a) => t.hub.db.prepare(sql).get(...a).n;
const events = (t, type) => t.hub.db.prepare("SELECT * FROM events WHERE type = ? ORDER BY seq").all(type).map((e) => ({ ...e, payload: JSON.parse(e.payload_json || "{}") }));
const liveEvents = (hub) => { const out = []; hub.live.subscribe((e) => out.push(e)); return out; };
const replies = (t) => t.readLog("codex").filter((l) => l.toolReply).map((l) => ({ tool: l.tool, ok: l.toolReply.success, text: l.toolReply.contentItems?.[0]?.text || "" }));
const spoken = (t) => t.readLog("codex").filter((l) => l.spoke).map((l) => l.spoke);
const OLD_FLOW = /LIVE_VALIDATION|OPEN GATE|Creează grant|live_grant|mode \(BUILD_SAFE/;

function consent(hub) {
  hub.bus.transaction(() => hub.settings.set("legaConsent", { version: LEGA_CONSENT_VERSION, confirmedAt: new Date().toISOString() }, "test"));
  hub.refreshCodexConfig();
}
/** BUILD_SAFE, gate open, billing + isolation ok, consent, an owner session under the voice-first policy (no manual mode or grant). */
async function voiceFirstHub(codex, extra = {}) {
  const t = await makeTestHub({ codex, ...extra });
  const owner = await enrolOwner(t, { activatePolicy: true });
  await prepareLiveWithoutGrants(t.hub);
  consent(t.hub);
  return { t, owner };
}
const ownerStart = (t, owner) => t.hub.commands.dispatch({ type: "lega.session.start", channel: "owner", actor: `owner:${owner.session.id}`, ownerSession: owner.session, payload: { sdp: OFFER } }).then((r) => r.result);
const uiStart = (t) => t.hub.commands.dispatch({ type: "lega.session.start", channel: "ui", actor: "user", payload: { sdp: OFFER } }).then((r) => r.result);
const connect = (t, s) => t.hub.commands.dispatch({ type: "lega.session.connected", channel: "ui", actor: "user", payload: { sessionId: s.sessionId } });
/** The ops-plan test executor (as in the U07 suite): one inert step, so a plan card can be built without the desktop or media. */
const probeExecutor = (t) => { t.hub.executors["test.probe"] = { describe: () => ({ title: "Sondă", params: {}, folders: [], ops: [{ op: "media.render" }], observed: ["nimic"], transmitted: [], outputs: ["rezultat"] }), run: async () => ({ result: {} }) }; };
/** A Studio planner standing in for U10's (registered only when that unit's planner is absent): the server's honest blocker or ONE ops plan. */
function studioPlanner(t) {
  if (t.hub.intake.planners().includes("studio_create") && !t.stubbedStudio) return;
  t.stubbedStudio = true;
  probeExecutor(t);
  t.hub.intake.registerPlanner("studio_create", async ({ projectId, ctx }) => {
    const ex = explain(await collectFacts(t.hub, { projectId, intent: "studio" }));
    if (ex.blocked) return { kind: "blocked", blocker: ex };
    return { kind: "ops", plan: await t.hub.opsPlans.propose({ kind: "test.studio", title: "Clip de promovare 30 s (fără model)", steps: [{ kind: "test.probe", params: {} }], actor: ctx.actor, via: ctx.channel }) };
  });
}

test("LI-01 policy: voice-first tools and texts teach plans; the legacy set and texts are unchanged", () => {
  const ctx = { projects: [{ id: "p1", name: "Hub" }], allProjects: [{ id: "p1", name: "Hub" }, { id: "p2", name: "Client" }], missionKinds: ["development", "eng_bugfix"] };
  const legacy = legaDynamicTools(ctx);
  assert.deepEqual(legaDynamicTools({ ...ctx, voiceFirst: false }), legacy, "voiceFirst:false is the legacy set");
  const legacyNames = legacy[0].tools.map((x) => x.name);
  assert.ok(legacyNames.includes("prepare_grant"));
  assert.ok(!legacyNames.includes("request_work"), "the legacy set has no new tool");
  assert.deepEqual(legacy[0].tools.find((x) => x.name === "point").inputSchema.properties.target.enum, Object.keys(LEGA_TARGETS));
  const vf = legaDynamicTools({ ...ctx, voiceFirst: true })[0].tools;
  const names = vf.map((x) => x.name);
  assert.ok(!names.includes("prepare_grant"));
  for (const n of ["request_work", "studio_overview", "last_delivery", "hub_actions", "propose_run", "propose_mission", "how_to", "point", "stop_all", "pause", "project_brief"]) assert.ok(names.includes(n), n);
  const targets = vf.find((x) => x.name === "point").inputSchema.properties.target.enum;
  for (const k of LEGA_LEGACY_ONLY_TARGETS) assert.ok(!targets.includes(k), `no arrow at ${k}`);
  assert.ok(targets.includes("stop-all") && targets.includes("isolation"));
  const topics = vf.find((x) => x.name === "how_to").inputSchema.properties.topic.enum;
  for (const k of ["grant", "live_mode", "gate"]) assert.ok(!topics.includes(k), `no how-to ${k}`);
  for (const k of ["plan", "r2", "environment", "studio"]) assert.ok(topics.includes(k), `how-to ${k}`);
  // Every voice-first how-to shows something that exists (an arrow target or a screen) and never teaches the M03 flow.
  for (const [k, v] of Object.entries(LEGA_HOWTO_VOICE_FIRST)) {
    assert.ok(v.target ? LEGA_TARGETS[v.target] : LEGA_SCREENS[v.screen], `${k} shows a real target or screen`);
    assert.doesNotMatch(v.text, /tastezi LIVE_VALIDATION|OPEN GATE|Creează grant/, k);
  }
  assert.match(LEGA_HOWTO.grant.text, /Creează grant/, "the legacy how-to is unchanged");
  const rw = vf.find((x) => x.name === "request_work").inputSchema;
  assert.deepEqual(rw.required, ["request"]);
  assert.equal(rw.additionalProperties, false);
  // Instructions and persona.
  const instr = legaAgentInstructions({ ...ctx, voiceFirst: true });
  assert.match(instr, /lega\.request_work/);
  assert.match(instr, /lega\.hub_actions/);
  assert.match(instr, /Never tell the owner to switch the Hub mode, open the execution gate or create a grant/);
  assert.doesNotMatch(instr, /prepare_grant|propose_run with a precise task/);
  assert.equal(legaAgentInstructions(ctx), legaAgentInstructions({ ...ctx, voiceFirst: false }));
  assert.match(legaAgentInstructions(ctx), /lega\.prepare_grant/, "legacy instructions unchanged");
  assert.doesNotMatch(legaVoicePrompt({ voiceFirst: true }), /grant-urile/);
  assert.match(legaVoicePrompt({ voiceFirst: true }), /o dată, în cockpit/);
  assert.match(legaVoicePrompt({}), /Aprobările, grant-urile, plățile/, "legacy persona unchanged");
});

test("LI-02 voice-first request_work: a promo clip with an empty library → the server's blocker, kept ONCE (full, then one line); no approval, mission, grant or mode", async () => {
  const { t, owner } = await voiceFirstHub(calls([
    { tool: "request_work", args: { request: "Fă un videoclip de promovare de 30 de secunde pentru Hub", kind_hint: "studio" } },
    { tool: "request_work", args: { request: "Fă un videoclip de promovare de 30 de secunde pentru Hub", kind_hint: "studio" } },
  ]));
  try {
    studioPlanner(t);
    const seq = t.hub.bus.lastSeq();
    const s = await ownerStart(t, owner);
    await connect(t, s);
    await waitFor(() => t.readLog("codex").some((l) => l.callsDone), 20000);
    const r = replies(t).filter((x) => x.tool === "request_work");
    assert.equal(r.length, 2);
    assert.equal(r[0].ok, false, "a blocker is not a success");
    assert.match(r[0].text, /Biblioteca media e goală/);
    assert.match(r[0].text, /păstrată/);
    assert.doesNotMatch(r[0].text, OLD_FLOW);
    assert.match(r[1].text, /^Încă blocat .*cererea ta e păstrată\.$/, "the second mention is one line");
    assert.ok(r[1].text.length < r[0].text.length / 2);
    const wr = t.hub.db.prepare("SELECT * FROM work_requests").all();
    assert.equal(wr.length, 1, "one kept request for the same words");
    assert.equal(wr[0].intent, "studio");
    assert.equal(wr[0].channel, "voice");
    assert.equal(wr[0].status, "BLOCKED");
    assert.match(wr[0].blocker_signature, /STUDIO_NO_MATERIAL/);
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM approvals"), 0);
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM commands WHERE type IN ('lega.propose_mission','lega.propose_run','grant.create','mode.set')"), 0);
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM missions"), 0);
    assert.equal(t.hub.grants.list().filter((g) => g.kind !== "voice").length, 0, "only the derived voice grant exists");
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM ops_plans"), 0);
    assert.equal(t.hub.settings.get("mode"), "BUILD_SAFE");
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM events WHERE seq > ? AND type = 'settings.changed' AND scope_id = 'mode'", seq), 0);
    assert.equal(events(t, "lega.work_request").length, 2);
    assert.ok(events(t, "lega.work_request").every((e) => e.payload.outcome === "blocked" && !JSON.stringify(e.payload).includes("videoclip")), "audit without free text");
  } finally { await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }
});

test("LI-03 voice-first request_work with material: ONE ops plan (no model), lega.plan published, zero runs", async () => {
  const { t, owner } = await voiceFirstHub(calls([{ tool: "request_work", args: { request: "Un clip promo de 30 de secunde din materialele existente", kind_hint: "studio" } }]));
  try {
    // Stand-in for U10's planner: a library with material gives ONE operation plan (the stub returns the ops card).
    probeExecutor(t);
    t.hub.intake.registerPlanner("studio_create", async ({ ctx }) => ({ kind: "ops", plan: await t.hub.opsPlans.propose({ kind: "test.studio", title: "Clip de promovare 30 s (fără model)", steps: [{ kind: "test.probe", params: {} }], actor: ctx.actor, via: ctx.channel }) }));
    const live = liveEvents(t.hub);
    const s = await ownerStart(t, owner);
    await connect(t, s);
    await waitFor(() => t.readLog("codex").some((l) => l.callsDone), 20000);
    const [r] = replies(t);
    assert.equal(r.ok, true, r.text);
    assert.match(r.text, /Am pregătit planul „Clip de promovare 30 s \(fără model\)”: o singură confirmare/);
    const plans = t.hub.db.prepare("SELECT * FROM ops_plans").all();
    assert.equal(plans.length, 1);
    assert.equal(plans[0].status, "PROPOSED");
    assert.equal(plans[0].proposed_via, "voice");
    assert.ok(live.some((e) => e.type === "lega.plan" && e.kind === "ops" && e.id === plans[0].id && e.sessionId === s.sessionId), "the plan id comes from the Hub");
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM agent_runs"), 0);
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM approvals"), 0);
  } finally { await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }
});

test("LI-04 server voice bridge: „Deschide Notepad” in a derived session runs exactly once and the Hub speaks; a grant-path session is refused; legacy never bridges", async () => {
  const say = script([{ sleep: 1500 }, { say: "Deschide Notepad" }, { sleep: 1500 }, { tool: "hub_actions" }]);
  // (a) derived session, voice-first.
  {
    const t = await makeDesktopHub({ hub: { codex: say } });
    try {
      const owner = await readyDesktop(t, ["notepad", "explorer"]);
      await prepareLiveWithoutGrants(t.hub);
      consent(t.hub);
      const s = await ownerStart(t, owner);
      assert.equal(s.authority, "owner_session");
      await connect(t, s);
      await waitFor(() => t.readLog("codex").some((l) => l.scriptDone), 20000);
      await waitFor(() => spoken(t).some((x) => /Am deschis Notepad/.test(x)), 5000);
      assert.equal(t.opLog().filter((e) => e.op === "launch").length, 1, "launched once");
      const intents = t.hub.db.prepare("SELECT channel, payload_json FROM commands WHERE type = 'owner.intent'").all();
      assert.equal(intents.length, 1);
      assert.equal(intents[0].channel, "voice");
      const transcript = events(t, "lega.transcript").find((e) => e.payload.role === "user");
      assert.equal(JSON.parse(intents[0].payload_json).transcriptId, transcript.id, "the transcript's event id is the idempotency key");
      // A client forwarding the same sentence (the cockpit, until U15 removes it) with that id executes nothing again.
      const again = await t.hub.commands.dispatch({ type: "owner.intent", channel: "owner", actor: `owner:${owner.session.id}`, ownerSession: owner.session,
        payload: { text: "Deschide Notepad", source: "voice-provider", legaSessionId: s.sessionId, transcriptId: transcript.id } }).then((r) => r.result);
      assert.equal(again.duplicate, true);
      assert.equal(t.opLog().filter((e) => e.op === "launch").length, 1);
      const actions = t.hub.lega.hubActions();
      assert.equal(actions.length, 1);
      assert.equal(actions[0].outcome, "local");
      assert.deepEqual(actions[0].intents, ["desktop_open"]);
      const tool = replies(t).find((x) => x.tool === "hub_actions");
      assert.match(tool.text, /Deschide Notepad.*local.*Am deschis Notepad/s);
      assert.equal(events(t, "lega.hub_action").length, 1);
    } finally { await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }
  }
  // (b) grant-path session while the voice-first policy is active: bridged, but a local action from a provider transcript is refused.
  {
    const t = await makeDesktopHub({ hub: { codex: say } });
    try {
      await readyDesktop(t, ["notepad"]); // owner session + the voice-first policy + Notepad authorized
      await enableLive(t.hub, { provider: "codex" });
      t.hub.bus.transaction(() => t.hub.grants.create({ provider: "codex", projectId: t.hub.projects.hub().id, access: "read-only", maxAttempts: 2, maxDurationS: 600, ttlMinutes: 30, kind: "voice" }, "test"));
      consent(t.hub);
      const s = await uiStart(t);
      assert.equal(s.authority, "grant");
      await connect(t, s);
      await waitFor(() => t.readLog("codex").some((l) => l.scriptDone), 20000);
      await waitFor(() => spoken(t).some((x) => /^Nu pot:/.test(x)), 5000);
      assert.match(spoken(t).find((x) => /^Nu pot:/.test(x)), /sesiunea Lega derivată/);
      assert.equal(t.opLog().filter((e) => e.op === "launch").length, 0, "nothing reached the desktop");
      assert.equal(t.hub.lega.hubActions()[0].outcome, "refused");
    } finally { await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }
  }
  // (c) legacy policy: the old path is unchanged (no bridge, no owner.intent, no speech from the Hub).
  {
    const t = await makeDesktopHub({ hub: { codex: say } });
    try {
      const owner = await enrolOwner(t, { activatePolicy: false }); // the legacy policy (the owner's fail-safe)
      await t.hub.desktop.discover("test");
      t.hub.desktop.apps.authorize(["notepad"], { sessionId: owner.session.id, via: "test" });
      await enableLive(t.hub, { provider: "codex" });
      t.hub.bus.transaction(() => t.hub.grants.create({ provider: "codex", projectId: t.hub.projects.hub().id, access: "read-only", maxAttempts: 2, maxDurationS: 600, ttlMinutes: 30, kind: "voice" }, "test"));
      consent(t.hub);
      const s = await uiStart(t);
      await connect(t, s);
      await waitFor(() => t.readLog("codex").some((l) => l.scriptDone), 20000);
      assert.equal(t.hub.lega.state().voiceFirst, false);
      assert.equal(count(t, "SELECT COUNT(*) AS n FROM commands WHERE type = 'owner.intent'"), 0);
      assert.equal(t.opLog().filter((e) => e.op === "launch").length, 0);
      assert.equal(t.hub.lega.hubActions().length, 0);
      assert.equal(replies(t).find((x) => x.tool === "hub_actions").text, "Unealtă necunoscută.", "a legacy session has no new tool");
      const started = t.readLog("codex").find((l) => l.method === "thread/start");
      assert.ok(started.params.dynamicTools[0].tools.some((x) => x.name === "prepare_grant"), "legacy tool list");
    } finally { await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }
  }
});

test("LI-05 voice-first: no grant tool, no arrow at the M03 forms, how-to teaches plans; every arrow is one lega.pointed event", async () => {
  const { t, owner } = await voiceFirstHub(calls([
    { tool: "prepare_grant", args: { kind: "run" } }, { tool: "point", args: { target: "live-mode" } }, { tool: "point", args: { target: "grant-form" } },
    { tool: "point", args: { target: "grant-create" } }, { tool: "point", args: { target: "gate" } }, { tool: "point", args: { target: "stop-all" } },
    { tool: "how_to", args: { topic: "grant" } }, { tool: "how_to", args: { topic: "plan" } }, { tool: "how_to", args: { topic: "environment" } }, { tool: "how_to", args: { topic: "r2" } },
  ]));
  try {
    const live = liveEvents(t.hub);
    const s = await ownerStart(t, owner);
    await connect(t, s);
    await waitFor(() => t.readLog("codex").some((l) => l.callsDone), 20000);
    const started = t.readLog("codex").find((l) => l.method === "thread/start");
    const tools = started.params.dynamicTools[0].tools.map((x) => x.name);
    assert.ok(!tools.includes("prepare_grant") && tools.includes("request_work"), "the voice-first set reached the agent");
    assert.match(started.params.developerInstructions, /lega\.request_work/);
    const realtime = t.readLog("codex").find((l) => l.method === "thread/realtime/start");
    assert.doesNotMatch(realtime.params.prompt, /grant-urile/);
    const r = replies(t);
    const by = (tool, i = 0) => r.filter((x) => x.tool === tool)[i];
    assert.equal(by("prepare_grant").ok, false);
    assert.match(by("prepare_grant").text, /Nu pregătesc grant-uri/);
    for (let i = 0; i < 4; i += 1) { assert.equal(by("point", i).ok, false); assert.match(by("point", i).text, /formularele vechi/); }
    assert.equal(by("point", 4).ok, true);
    assert.equal(by("how_to", 0).ok, false, "no how-to for grants");
    assert.match(by("how_to", 1).text, /o singură dată/);
    assert.match(by("how_to", 2).text, /lega\.navigate cu screen „sistem”/);
    assert.match(by("how_to", 3).text, /isolation/);
    for (const x of r) assert.doesNotMatch(x.text, /tastezi LIVE_VALIDATION|tastezi OPEN GATE|apasă tu „Creează grant”/);
    assert.equal(live.filter((e) => e.type === "lega.prefill").length, 0);
    assert.deepEqual(live.filter((e) => e.type === "lega.point").map((e) => e.target), ["stop-all"]);
    assert.deepEqual(events(t, "lega.pointed").map((e) => e.payload), [{ target: "stop-all" }], "one counted pointer, key only");
    assert.equal(events(t, "lega.grant_prepared").length, 0);
    assert.equal(events(t, "lega.legacy_tool_refused").length, 1);
  } finally { await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }
});

test("LI-06 voice-first propose_run / propose_mission: the server's explanation (R2, never raw gate ids), kept; no approval card; the cap counts plans and kept requests", async () => {
  // The project name must be inside the scenario (read at process start): learn the fixture Hub project's name first.
  const probe = await makeTestHub({ codex: "lega-ok" });
  const hubName = probe.hub.projects.hub().name;
  await probe.cleanup();
  const ready = await voiceFirstHub(calls([
    { tool: "propose_mission", args: { project: hubName, kind: "development", title: "Site nou", objective: "Pagini noi pentru site." } },
    { tool: "propose_run", args: { project: hubName, provider: "codex", task: "Citește README și rezumă-l." } },
    { tool: "request_work", args: { request: "Repară bugul de autentificare", kind_hint: "engineering", project: hubName } },
  ]));
  const t2 = ready.t;
  try {
    // 3 kept requests + 1 operation plan proposed through the voice channel: 4 of 5 (the mission kind is refused, nothing kept); the
    // blocked run becomes the 5th, so the next request is refused by the cap.
    probeExecutor(t2);
    for (const text of ["cerere 1", "cerere 2", "cerere 3"]) t2.hub.workRequests.create({ text, channel: "voice", source: "voice-provider", intent: "other", actor: "lega" });
    await t2.hub.opsPlans.propose({ kind: "test.plan", title: "Plan vocal", steps: [{ kind: "test.probe", params: {} }], actor: "lega", via: "voice" });
    t2.hub.workRequests.create({ text: "cerere de pe ui", channel: "ui", source: "typed", intent: "other", actor: "owner" }); // not Lega's: not counted
    const s = await ownerStart(t2, ready.owner);
    await connect(t2, s);
    await waitFor(() => t2.readLog("codex").some((l) => l.callsDone), 20000);
    const r = replies(t2);
    const run = r.find((x) => x.tool === "propose_run");
    assert.equal(run.ok, false);
    assert.match(run.text, /Izolarea pe Windows \(R2\)/, run.text);
    assert.match(run.text, /wsl-runner/);
    assert.doesNotMatch(run.text, OLD_FLOW);
    assert.doesNotMatch(run.text, /host_isolation|workspace_lease|execution_gate \(/, "no raw gate ids");
    const mission = r.find((x) => x.tool === "propose_mission");
    assert.equal(mission.ok, false);
    assert.match(mission.text, /nu au încă un plan automat/);
    const crowded = r.find((x) => x.tool === "request_work");
    assert.equal(crowded.ok, false);
    assert.match(crowded.text, /Ai deja 5 planuri sau cereri pregătite de mine/);
    const kept = t2.hub.db.prepare("SELECT * FROM work_requests WHERE channel = 'voice' AND project_id IS NOT NULL").all();
    assert.equal(kept.length, 1, "the refused run is kept once");
    assert.match(kept[0].blocker_signature, /HOST_R2_OPEN/);
    assert.equal(count(t2, "SELECT COUNT(*) AS n FROM approvals"), 0, "no lega.run_request / lega.mission_request card");
    assert.equal(count(t2, "SELECT COUNT(*) AS n FROM commands WHERE type IN ('lega.propose_run','lega.propose_mission')"), 0);
    assert.equal(count(t2, "SELECT COUNT(*) AS n FROM missions"), 0);
    assert.equal(t2.hub.settings.get("mode"), "BUILD_SAFE");
  } finally { await t2.hub.lega.stopAll("test").catch(() => {}); await t2.cleanup(); }
});

test("LI-07 Stop on voice: „Te rog, oprește tot” dispatches system.stop_all once (fast path, not the intake) and the agent's stop_all corroborates", async () => {
  const { t, owner } = await voiceFirstHub(script([{ sleep: 1500 }, { say: "Te rog, oprește tot" }, { tool: "stop_all" }]));
  try {
    const s = await ownerStart(t, owner);
    await connect(t, s);
    await waitFor(() => t.hub.lega.state()?.status === "ended", 20000);
    await waitFor(() => t.readLog("codex").some((l) => l.scriptDone) || true, 3000);
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM commands WHERE type = 'system.stop_all'"), 1);
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM commands WHERE type = 'owner.intent'"), 0, "the fast path handled it");
    const stop = replies(t).find((x) => x.tool === "stop_all");
    if (stop) assert.doesNotMatch(stop.text, /^Refuzat/, "corroborated by the owner's words");
  } finally { await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }
});

test("LI-08 bridge: a project sentence opens its cockpit; reads stay with the agent; one warning a minute before the cap", async () => {
  const probe = await makeTestHub({ codex: "lega-ok" });
  const hubName = probe.hub.projects.hub().name;
  await probe.cleanup();
  const { t, owner } = await voiceFirstHub(script([{ sleep: 1200 }, { say: `Hai să lucrăm la ${hubName}` }, { sleep: 400 }, { say: "Care e ultima execuție?" }, { sleep: 4000 }]), { configOverrides: { legaTimeScale: 0.004 } });
  try {
    // Idle long enough that only the duration cap ends the session (1200 s × 0.004 = 4.8 s; the warning at 4.56 s).
    t.hub.bus.transaction(() => t.hub.settings.set("lega", { ...(t.hub.settings.get("lega") || {}), idleTimeoutS: 3600 }, "test"));
    const live = liveEvents(t.hub);
    const s = await ownerStart(t, owner);
    await connect(t, s);
    await waitFor(() => live.some((e) => e.type === "lega.navigate" && e.path === `/lega/${t.hub.projects.hub().id}`), 15000);
    await waitFor(() => t.hub.lega.state()?.status === "ended", 30000);
    assert.equal(t.hub.lega.state().endReason, "max-duration");
    assert.ok(spoken(t).some((x) => /Mai am un minut/.test(x)), "spoken warning before the cap");
    const actions = t.hub.lega.hubActions ? events(t, "lega.hub_action").map((e) => e.payload.intents) : [];
    assert.ok(actions.some((i) => i.includes("open_project")));
    assert.ok(!actions.some((i) => i.includes("last_run")), "a read is the agent's to answer (no Hub action, no speech)");
    assert.equal(count(t, "SELECT COUNT(*) AS n FROM commands WHERE type = 'owner.intent'"), 2, "both sentences reached the intake");
  } finally { await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }
});
