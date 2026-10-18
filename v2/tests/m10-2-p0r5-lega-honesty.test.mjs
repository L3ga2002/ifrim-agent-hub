// 2.12.2 (P0-R5) — Lega honesty, latency and loops, from the owner's live session of 2026-10-06 09:20–09:40 UTC (L2, L3, L6, L8, L9, L10).
// PASS_SIMULATED: the pure policy texts, a test Hub with the fixture realtime provider (fake app-server, lega-calls / lega-script),
// stub planners registered through the intake's own registerPlanner; no model, no live Hub, no network.
//  - L2: the voice persona holds with a neutral „O clipă, verific.” and never acknowledges („în regulă / mă ocup / gata / am făcut”) before
//    the Hub's answer;
//  - L3: every request_work answer that is not a plan card ends with the Hub's factual tail (kept / question / nothing), and the
//    instructions say only that tail decides what is kept;
//  - L6: the same words again after the Hub's question (same project and planner kind, inside the 2-minute window) are not planned
//    again; another project, another kind, other words, an answer (a test path or a choice) or the window's end plan normally;
//  - L8: a face sentence the Hub heard through the bridge is published as lega.face with exactly the web's faceCommand, and
//    lega.hub_actions reports it;
//  - L9: Lega's thread runs with the Hub's effort (LEGA_BACKEND_EFFORT, one -c arg), the reported model + effort reach
//    lega.session.connected, and another reported effort is a warning, never a refused session;
//  - L10: code goes through a plan (never „nu pot face schimbări în cod”), the arrow only answers „where is…”;
//  - L11 by voice (integration of P0-R5 with P0-R6): the intake's explain_mode answer is said by the Hub itself after the bridge.
// Changed expectations of older suites (the kept tail now ends a blocker's text): m10-2-lega-intake.test.mjs LI-02 and
// m10-2-probe-e2e.test.mjs M10.2-E2E-C (the one-line reminder is followed by „(Cererea e păstrată de Hub.)”).
import test from "node:test";
import assert from "node:assert/strict";
import { makeTestHub, enrolOwner, prepareLiveWithoutGrants, waitFor } from "./helpers.mjs";
import { LEGA_CONSENT_VERSION, LEGA_BACKEND_EFFORT, LEGA_WORK_TAILS, legaVoicePrompt, legaAgentInstructions, legaDynamicTools, legaFaceCommand, legaFaceText } from "../server/policy/lega-policy.mjs";
import { CODEX_VOICE_EXTRA_ARGS } from "../server/providers/codex-realtime.mjs";
import { INTAKE_LIMITS } from "../server/owner/intake.mjs";
import { modeAnswer } from "../server/owner/intents.mjs";
import { ENGINEERING_LIMITS } from "../server/owner/planners/engineering.mjs";
import { faceCommand } from "../web/src/lib/cockpitLogic.js";

const OFFER = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n";
const b64 = (list) => Buffer.from(JSON.stringify(list)).toString("base64url");
const script = (list) => `lega-script:${b64(list)}`;
const replies = (t) => t.readLog("codex").filter((l) => l.toolReply).map((l) => ({ tool: l.tool, ok: l.toolReply.success, text: l.toolReply.contentItems?.[0]?.text || "" }));
const spoken = (t) => t.readLog("codex").filter((l) => l.spoke).map((l) => l.spoke);
const events = (t, type) => t.hub.db.prepare("SELECT * FROM events WHERE type = ? ORDER BY seq").all(type).map((e) => ({ ...e, payload: JSON.parse(e.payload_json || "{}") }));
const liveEvents = (hub) => { const out = []; hub.live.subscribe((e) => out.push(e)); return out; };
const occurrences = (text, piece) => text.split(piece).length - 1;
const QUESTION = "Ce test automat verifică asta?";

/**
 * A voice-first Hub (BUILD_SAFE, gate open, billing + isolation checked, Lega consent, the owner session under the voice-first policy). The
 * Lega app-server's scenario is queued LAST (the probes above run on the plain fixture), so it may name the fixture Hub project.
 */
async function voiceFirstHub(scenarioOf, { clock = null } = {}) {
  const t = await makeTestHub({ queues: true, ...(clock ? { clock } : {}) });
  const owner = await enrolOwner(t, { activatePolicy: true });
  await prepareLiveWithoutGrants(t.hub);
  t.hub.bus.transaction(() => t.hub.settings.set("legaConsent", { version: LEGA_CONSENT_VERSION, confirmedAt: new Date().toISOString() }, "test"));
  t.hub.refreshCodexConfig();
  t.queue("codex", typeof scenarioOf === "function" ? scenarioOf(t) : scenarioOf);
  return { t, owner };
}
async function startLega(t, owner) {
  const s = (await t.hub.commands.dispatch({ type: "lega.session.start", channel: "owner", actor: `owner:${owner.session.id}`, ownerSession: owner.session, payload: { sdp: OFFER } })).result;
  assert.equal(s.authority, "owner_session");
  await t.hub.commands.dispatch({ type: "lega.session.connected", channel: "ui", actor: "user", payload: { sessionId: s.sessionId } });
  return s;
}
/**
 * Stub planners (engineering and run) through the intake's own registerPlanner: „blocat” → a blocker (kept as a work request by the
 * intake), „mesaj” → a message, „plan de probă” → ONE operation plan, anything else → the ONE question (with one choice).
 */
function stubPlanners(t, kinds = ["engineering", "run"]) {
  const log = [];
  t.hub.executors["test.probe"] = { describe: () => ({ title: "Sondă", params: {}, folders: [], ops: [{ op: "media.render" }], observed: ["nimic"], transmitted: [], outputs: ["rezultat"] }), run: async () => ({ result: {} }) };
  for (const kind of kinds) {
    t.hub.intake.registerPlanner(kind, async ({ text, projectId, ctx }) => {
      log.push({ kind, text, projectId: projectId || null });
      if (/blocat/i.test(text)) return { kind: "blocked", projectId, text: "Blocat în test: lipsește o decizie a ta.", blocker: { signature: "TEST_BLOCKED", cause: "TEST_BLOCKED", text: "Blocat în test.", options: [] } };
      if (/mesaj/i.test(text)) return { kind: "message", text: "Nu am un plan pentru asta." };
      if (/plan de proba|plan de probă/i.test(text)) return { kind: "ops", plan: await t.hub.opsPlans.propose({ kind: "test.plan", title: "Plan de probă", steps: [{ kind: "test.probe", params: {} }], actor: ctx.actor, via: ctx.channel }) };
      return { kind: "question", projectId, question: QUESTION, options: [{ id: "acc-1", label: "testul de acceptanță existent" }], forIntent: kind };
    });
  }
  return log;
}

test("P0R5-01 policy texts: a neutral holding phrase, no claim before the Hub answers, what is kept, the owner's own steps, the face, code through a plan", () => {
  for (const voiceFirst of [true, false]) {
    const prompt = legaVoicePrompt({ voiceFirst });
    assert.doesNotMatch(prompt, /te ocupi/, `no „te ocupi” (voiceFirst=${voiceFirst})`);
    assert.match(prompt, /spune doar „O clipă, verific\.”/);
    assert.match(prompt, /Până vine răspunsul Hub-ului nu spui „în regulă”, „mă ocup”, „gata” sau „am făcut”; după răspuns spui exact ce a făcut Hub-ul sau ce a refuzat\./);
    assert.match(prompt, /Nu spune niciodată că ai făcut ceva înainte să primești confirmarea/, "the old rule stays");
  }
  const vf = legaVoicePrompt({ voiceFirst: true });
  assert.match(vf, /o întrebare sau un refuz al Hub-ului nu păstrează nimic/);
  assert.match(vf, /verificări pe telefoane sau dispozitive reale, conturi, instalări pe telefon, acceptarea unei livrări/);
  assert.match(vf, /Ai o față abstractă, din particule și linii, pe ecranul Lega/);
  assert.match(vf, /Nu spune niciodată că nu ai față/);
  assert.match(vf, /nu spune că nu poți face schimbări în cod/);
  assert.match(vf, /o dată, în cockpit/, "the plan line stays");
  assert.match(legaVoicePrompt({}), /Aprobările, grant-urile, plățile/, "legacy persona otherwise unchanged");
  assert.doesNotMatch(legaVoicePrompt({}), /față abstractă|păstrează nimic/, "the voice-first lines are not in the legacy persona");

  const ctx = { projects: [{ id: "p1", name: "Hub" }], allProjects: [{ id: "p1", name: "Hub" }], missionKinds: ["eng_bugfix"] };
  const instr = legaAgentInstructions({ ...ctx, voiceFirst: true });
  assert.ok(instr.includes(`Only „${LEGA_WORK_TAILS.kept}” means the request is kept`), "the kept tail is named literally");
  assert.match(instr, /A question keeps nothing \(the Hub waits 2 minutes for the owner's answer\); a refusal or a message keeps nothing/);
  assert.match(instr, /„am păstrat”, „a reținut”, „am retrimis”, „am transmis”\) unless that tail says so/);
  assert.match(instr, /Do not call lega\.request_work again with the same words: the Hub refuses the repeat for 2 minutes/);
  assert.match(instr, /CLOSING A STAGE: .*read what is left \(lega\.mission_detail, lega\.project_brief\).*tests on real phones or devices, accounts, installs on a phone, accepting a delivery.*lega\.request_work is only for code, a clip or an analysis/);
  assert.match(instr, /Never say you cannot change code; say the Hub does it through a plan/);
  assert.match(instr, /FACE: Lega has an abstract face of particles and lines on the Lega screen.*Never say Lega has no face/);
  assert.match(instr, /lega\.point \(highlight a button or panel\) ONLY when the owner asks where something is or how to do it in the Hub/);
  assert.doesNotMatch(instr, /said once; the request is kept and re-proposed when the blocker clears/, "no generic „the request is kept” any more");
  assert.doesNotMatch(instr, /prepare_grant|propose_run with a precise task/);
  assert.doesNotMatch(legaAgentInstructions(ctx), /WHAT IS KEPT|CLOSING A STAGE|FACE:/, "legacy instructions unchanged");

  const tools = legaDynamicTools({ ...ctx, voiceFirst: true })[0].tools;
  const rw = tools.find((x) => x.name === "request_work").description;
  assert.doesNotMatch(rw, /the request is kept and re-proposed/);
  assert.ok(rw.includes(`only „${LEGA_WORK_TAILS.kept}” means kept; a question or a refusal keeps nothing`));
  assert.match(rw, /Not for steps the owner does by hand/);
  for (const name of ["propose_run", "propose_mission"]) assert.match(tools.find((x) => x.name === name).description, /the answer's tail says whether anything is kept/, name);
  assert.doesNotMatch(tools.find((x) => x.name === "propose_run").description, /\(the request is kept\)/);

  // The question tail's „2 minute” is the intake's clarification window, the engineering planner's pending window and the repeat window.
  assert.equal(INTAKE_LIMITS.clarificationTtlMs, 2 * 60000);
  assert.equal(ENGINEERING_LIMITS.pendingTtlMs, INTAKE_LIMITS.clarificationTtlMs);
  assert.ok(LEGA_WORK_TAILS.question.includes(`${INTAKE_LIMITS.clarificationTtlMs / 60000} minute`));
  assert.deepEqual(LEGA_WORK_TAILS, { kept: "(Cererea e păstrată de Hub.)", question: "(Nimic nu e păstrat; Hub-ul așteaptă răspunsul 2 minute.)", nothing: "(Nimic nu a pornit și nimic nu e păstrat.)" });
});

test("P0R5-02 L8 contract: legaFaceCommand is exactly the web's faceCommand; the hub_actions texts", () => {
  const cases = [[], [{ intent: "status" }], [{ intent: "face_show" }], [{ intent: "face_core" }], [{ intent: "face_discreet" }], [{ intent: "face_hide" }], [{ intent: "show_company" }],
    [{ intent: "zoom" }], [{ intent: "status" }, { intent: "face_hide" }, { intent: "face_show" }], [{ intent: "zoom" }, { intent: "face_core" }]];
  for (const steps of cases) assert.deepEqual(legaFaceCommand(steps), faceCommand(steps), JSON.stringify(steps));
  assert.equal(legaFaceCommand(null), null);
  assert.equal(legaFaceText(faceCommand([{ intent: "face_show" }])), "Am arătat fața Legăi pe ecran (abstractă, din particule și linii).");
  assert.equal(legaFaceText(faceCommand([{ intent: "face_hide" }])), "Am ascuns fața Legăi de pe ecran.");
  assert.equal(legaFaceText(faceCommand([{ intent: "face_core" }])), "Am readus fața Legăi la nucleu pe ecran.");
  assert.equal(legaFaceText(faceCommand([{ intent: "face_discreet" }])), "Am făcut fața Legăi mai discretă pe ecran.");
  assert.equal(legaFaceText(faceCommand([{ intent: "show_company" }])), "Am arătat pe ecranul Lega graful companiei.");
  assert.equal(legaFaceText(null), "");
});

test("P0R5-03 L9: Lega's process carries the Hub's effort exactly once (the run adapter's own -c form)", () => {
  assert.equal(LEGA_BACKEND_EFFORT, "low");
  const at = CODEX_VOICE_EXTRA_ARGS.indexOf('model_reasoning_effort="low"');
  assert.ok(at > 0 && CODEX_VOICE_EXTRA_ARGS[at - 1] === "-c", JSON.stringify(CODEX_VOICE_EXTRA_ARGS));
  assert.equal(CODEX_VOICE_EXTRA_ARGS.filter((a) => a.startsWith("model_reasoning_effort=")).length, 1);
  for (const piece of ['experimental_realtime_ws_backend_prompt=""', "agents.enabled=false"]) assert.ok(CODEX_VOICE_EXTRA_ARGS.includes(piece), piece);
});

test("P0R5-04 L3 tails: a question, a kept blocker, a message and an early refusal say what is kept; a plan card has no tail", async () => {
  const { t, owner } = await voiceFirstHub(script([{ sleep: 700 },
    { tool: "request_work", args: { request: "Închidem etapa unu pe proiect", kind_hint: "engineering" } },
    { tool: "request_work", args: { request: "Asta e blocat de o decizie", kind_hint: "engineering" } },
    { tool: "request_work", args: { request: "Trimite un mesaj de probă", kind_hint: "engineering" } },
    { tool: "request_work", args: { request: "Pregătește un plan de probă", kind_hint: "engineering" } },
    { tool: "request_work", args: { request: "Ceva oarecare de făcut", kind_hint: "necunoscut" } },
    { tool: "request_work", args: { request: "Asta e blocat și nepăstrat", kind_hint: "engineering" } },
  ]));
  try {
    const planned = stubPlanners(t);
    // A blocker the Hub could NOT keep (the work-request store refuses this one): its answer must not claim a kept request.
    const create = t.hub.workRequests.create;
    t.hub.workRequests.create = (request, ...rest) => {
      if (/nepăstrat/.test(String(request?.text || ""))) throw new Error("test: cererea nu poate fi păstrată");
      return create.call(t.hub.workRequests, request, ...rest);
    };
    await startLega(t, owner);
    await waitFor(() => t.readLog("codex").some((l) => l.scriptDone), 20000);
    const r = replies(t).filter((x) => x.tool === "request_work");
    assert.equal(r.length, 6, JSON.stringify(r));
    const [question, blocked, message, plan, refused, unkept] = r;
    assert.equal(unkept.ok, false);
    assert.ok(unkept.text.endsWith(LEGA_WORK_TAILS.nothing), `a blocker with no work request keeps nothing: ${unkept.text}`);
    assert.ok(!unkept.text.includes(LEGA_WORK_TAILS.kept));
    assert.equal(question.ok, true, "the Hub asked its one question");
    assert.ok(question.text.startsWith(QUESTION), question.text);
    assert.ok(question.text.endsWith(LEGA_WORK_TAILS.question), question.text);
    assert.equal(blocked.ok, false);
    assert.ok(blocked.text.endsWith(LEGA_WORK_TAILS.kept), blocked.text);
    const kept = t.hub.db.prepare("SELECT * FROM work_requests").all();
    assert.equal(kept.length, 1, "the blocker is kept as a work request — and only it");
    assert.ok(message.text.endsWith(LEGA_WORK_TAILS.nothing), message.text);
    assert.match(plan.text, /Am pregătit planul „Plan de probă”/);
    assert.equal(plan.ok, true);
    for (const tail of Object.values(LEGA_WORK_TAILS)) assert.ok(!plan.text.includes(tail), "a plan card keeps its own text (no tail)");
    assert.equal(refused.ok, false);
    assert.match(refused.text, /^Tip de lucrare necunoscut/);
    assert.ok(refused.text.endsWith(LEGA_WORK_TAILS.nothing), refused.text);
    for (const x of [question, blocked, message, refused, unkept]) assert.equal(Object.values(LEGA_WORK_TAILS).reduce((n, tail) => n + occurrences(x.text, tail), 0), 1, `exactly one tail: ${x.text}`);
    assert.ok(!question.text.includes(LEGA_WORK_TAILS.kept) && !message.text.includes(LEGA_WORK_TAILS.kept), "nothing claims a kept request but the blocker");
    assert.equal(planned.length, 5, "the refused kind never reached a planner");
    const audit = events(t, "lega.work_request").map((e) => e.payload);
    assert.deepEqual(audit.map((p) => p.outcome), ["question", "blocked", "message", "plan", "blocked"]);
    assert.ok(audit[1].workRequestId && audit[4].workRequestId === null, "the audit says which blocker was kept");
  } finally { await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }
});

test("P0R5-05 L6 loop guard: the same words after the Hub's question are not planned again for 2 minutes; another project, kind, words, an answer or the window's end plan normally", async () => {
  let offset = 0;
  const A = "Închidem etapa 1 pe ProDelivery";
  const B = "Verifică etapa doi și spune ce lipsește";
  const C = "Repară validarea, testul e test/acceptance.test.mjs";
  const D = "Folosește testul de acceptanță existent pentru validare";
  const { t, owner } = await voiceFirstHub((hub) => script([{ sleep: 700 },
    { tool: "request_work", args: { request: A, kind_hint: "engineering" } },                                   // 1 question
    { tool: "request_work", args: { request: `${A.toUpperCase()}!`, kind_hint: "engineering" } },               // 2 the same words → refused
    { tool: "request_work", args: { request: A, kind_hint: "engineering", project: hub.hub.projects.hub().name } }, // 3 another project
    { tool: "request_work", args: { request: A, kind_hint: "run" } },                                           // 4 another planner kind
    { tool: "request_work", args: { request: B, kind_hint: "engineering" } },                                   // 5 other words (the latest question now)
    { tool: "request_work", args: { request: B, kind_hint: "engineering" } },                                   // 6 refused
    { sleep: 2500 },                                                                                             // the test moves the clock +121 s
    { tool: "request_work", args: { request: B, kind_hint: "engineering" } },                                   // 7 the window ended
    { tool: "request_work", args: { request: C, kind_hint: "engineering" } },                                   // 8 question
    { tool: "request_work", args: { request: C, kind_hint: "engineering" } },                                   // 9 same words, but they carry a test path
    { tool: "request_work", args: { request: D, kind_hint: "engineering" } },                                   // 10 question
    { tool: "request_work", args: { request: D, kind_hint: "engineering" } },                                   // 11 same words, but they name the choice
  ]), { clock: () => new Date(Date.now() + offset) });
  try {
    const planned = stubPlanners(t);
    const hubId = t.hub.projects.hub().id;
    await startLega(t, owner);
    await waitFor(() => replies(t).filter((x) => x.tool === "request_work").length >= 6, 20000);
    offset = 121000;
    await waitFor(() => t.readLog("codex").some((l) => l.scriptDone), 30000);
    const r = replies(t).filter((x) => x.tool === "request_work");
    assert.equal(r.length, 11);
    const suppressed = /^Hub-ul a întrebat deja acum \d+ s: „Ce test automat verifică asta\?”\. Nu retrimit cererea; răspunsul sau o cerere diferită o reiau\. \(Nimic nu a pornit și nimic nu e păstrat\.\)$/;
    for (const i of [1, 5]) { assert.equal(r[i].ok, false, `#${i + 1}`); assert.match(r[i].text, suppressed, `#${i + 1}: ${r[i].text}`); }
    for (const i of [0, 2, 3, 4, 6, 7, 8, 9, 10]) assert.ok(r[i].text.startsWith(QUESTION) && r[i].text.endsWith(LEGA_WORK_TAILS.question), `#${i + 1} planned: ${r[i].text}`);
    assert.deepEqual(planned.map((p) => [p.kind, p.text, p.projectId]), [
      ["engineering", A, null], ["engineering", A, hubId], ["run", A, null], ["engineering", B, null], ["engineering", B, null],
      ["engineering", C, null], ["engineering", C, null], ["engineering", D, null], ["engineering", D, null]]);
    const repeats = events(t, "lega.work_request").filter((e) => e.payload.outcome === "repeat_suppressed");
    assert.equal(repeats.length, 2);
    for (const e of repeats) {
      assert.equal(e.payload.kind, "engineering");
      assert.equal(e.payload.projectId, null);
      assert.ok(Number.isInteger(e.payload.questionAgeS) && e.payload.questionAgeS >= 0 && e.payload.questionAgeS < 120);
      assert.doesNotMatch(JSON.stringify(e.payload), /etapa|Verific/i, "the audit carries no free text");
    }
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM work_requests").get().n, 0, "a question keeps nothing");
  } finally { await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }
});

test("P0R5-06 L3: a question the bridge asked from the owner's words is reported as a question (never „prepared”), with its tail", async () => {
  const SAID = "Repară bug-ul de validare a numelui format doar din spații";
  const { t, owner } = await voiceFirstHub(script([{ sleep: 700 }, { say: SAID }, { sleep: 1500 }, { tool: "request_work", args: { request: SAID, kind_hint: "engineering" } }]));
  try {
    const planned = stubPlanners(t);
    await startLega(t, owner);
    await waitFor(() => t.readLog("codex").some((l) => l.scriptDone), 20000);
    const reply = replies(t).find((x) => x.tool === "request_work");
    assert.ok(reply, "the agent's request_work was answered");
    assert.equal(planned.length, 1, `planned once, by the bridge (${JSON.stringify(t.hub.lega.hubActions())})`);
    assert.match(reply.text, /^Hub-ul a întrebat deja din cuvintele tale: Ce test automat verifică asta\?/);
    assert.doesNotMatch(reply.text, /a pregătit deja/);
    assert.ok(reply.text.endsWith(LEGA_WORK_TAILS.question), reply.text);
  } finally { await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }
});

test("P0R5-07 L8: „Arată-ți fața” / „Ascunde fața” / „Arată-mi compania” heard through the bridge → lega.face with the web's command; hub_actions reports it; nothing spoken", async () => {
  const { t, owner } = await voiceFirstHub(script([{ sleep: 700 }, { say: "Arată-ți fața" }, { sleep: 700 }, { say: "Ascunde fața" }, { sleep: 700 }, { say: "Arată-mi compania" },
    { sleep: 700 }, { say: "Arată-mi compania" }, { sleep: 900 }, { tool: "hub_actions" }]));
  try {
    // The second „Arată-mi compania” fails inside the intake: an intent the Hub could not answer is never shown as a face change.
    const companyMap = t.hub.cockpit.companyMap;
    let maps = 0;
    t.hub.cockpit.companyMap = (...a) => { maps += 1; if (maps > 1) throw new Error("test: harta nu e disponibilă"); return companyMap.apply(t.hub.cockpit, a); };
    const live = liveEvents(t.hub);
    const s = await startLega(t, owner);
    await waitFor(() => t.readLog("codex").some((l) => l.scriptDone), 20000);
    assert.equal(maps, 2, "both company sentences reached the intake");
    const faces = live.filter((e) => e.type === "lega.face");
    assert.deepEqual(faces.map((e) => e.command), [faceCommand([{ intent: "face_show" }]), faceCommand([{ intent: "face_hide" }]), faceCommand([{ intent: "show_company" }])], JSON.stringify(faces));
    assert.ok(faces.every((e) => e.sessionId === s.sessionId), "published for THIS session");
    const tool = replies(t).find((x) => x.tool === "hub_actions");
    assert.ok(tool.text.includes("„Arată-ți fața” → face: Am arătat fața Legăi pe ecran (abstractă, din particule și linii)."), tool.text);
    assert.ok(tool.text.includes("Am ascuns fața Legăi de pe ecran."), tool.text);
    assert.ok(tool.text.includes("Am arătat pe ecranul Lega graful companiei."), tool.text);
    const acts = events(t, "lega.hub_action").map((e) => e.payload);
    assert.deepEqual(acts.map((p) => [p.intents[0], p.outcome, p.face ?? null]), [["face_show", "face", "FACE"], ["face_hide", "face", "HIDDEN"], ["show_company", "face", "GRAPH"], ["show_company", "refused", null]]);
    // (The fixture agent's own final answer — „Rezultat simulat pentru hub_actions: …” — reads the tool text aloud; the Hub says nothing.)
    assert.ok(!spoken(t).some((x) => !/^Rezultat simulat pentru /.test(x) && /fața|graful/.test(x)), `a view change is shown, not spoken by the Hub: ${JSON.stringify(spoken(t))}`);
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM commands WHERE type = 'owner.intent'").get().n, 4, "each sentence reached the intake once");
  } finally { await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }
});

test("P0R5-08 L9: the Lega process runs with effort low (one -c arg) and lega.session.connected records the reported model and effort", async () => {
  const { t, owner } = await voiceFirstHub("lega-ok");
  try {
    const live = liveEvents(t.hub);
    const s = await startLega(t, owner);
    const launch = t.readLog("codex").filter((l) => l.launchArgs).at(-1).launchArgs;
    assert.equal(launch.filter((a) => a.startsWith("model_reasoning_effort=")).length, 1, JSON.stringify(launch));
    assert.ok(launch.includes('model_reasoning_effort="low"'));
    assert.ok(launch.includes("agents.enabled=false"), "this is the Lega process");
    const connected = events(t, "lega.session.connected").at(-1);
    assert.equal(connected.scope_id, s.sessionId);
    assert.deepEqual(connected.payload, { voice: "cove", model: "gpt-fake-sol", effort: "low" });
    assert.ok(!live.some((e) => e.type === "lega.notice"), "the expected effort raises no notice");
    assert.equal(t.hub.lega.state().status, "active");
  } finally { await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }
});

// Integration (A × B, L2 / L11): the intake's explain_mode answer is a read (READ_NAVIGATE), which the bridge leaves to the agent; by
// voice — where the defect was seen („Pune-l pe live activation” → „În regulă, mă ocup acum.”) — the Hub says its own answer instead.
test("P0R5-10 L11 by voice: a request to change the Hub's mode heard through the bridge is answered by the Hub itself (said once, kept for hub_actions); nothing changes", async () => {
  const { t, owner } = await voiceFirstHub(script([{ sleep: 700 }, { say: "Pune-l pe live activation" }, { sleep: 700 }, { say: "Arată-ți fața" }, { sleep: 900 }, { tool: "hub_actions" }]));
  try {
    const mode = t.hub.settings.get("mode");
    const expected = modeAnswer({}, { mode, spoken: true });
    const s = await startLega(t, owner);
    await waitFor(() => t.readLog("codex").some((l) => l.scriptDone), 20000);
    const said = spoken(t).filter((x) => !/^Rezultat simulat pentru /.test(x));
    assert.deepEqual(said.filter((x) => /Modul Hub-ului/.test(x)), [expected], `said once, in the Hub's words: ${JSON.stringify(said)}`);
    const acts = events(t, "lega.hub_action").filter((e) => e.scope_id === s.sessionId).map((e) => e.payload);
    assert.deepEqual(acts.map((p) => [p.intents.join(","), p.outcome]), [["explain_mode", "message"], ["face_show", "face"]], JSON.stringify(acts));
    const tool = replies(t).find((x) => x.tool === "hub_actions");
    assert.ok(tool.text.includes(expected), tool.text);
    assert.equal(t.hub.settings.get("mode"), mode, "the mode is never changed from a sentence");
    assert.equal(t.hub.lega.state().status, "active");
  } finally { await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }
});

test("P0R5-09 L9: a thread that reports another effort is a warning to the owner, the session continues and the audit keeps the reported value", async () => {
  const { t, owner } = await voiceFirstHub("effort-ignored"); // the fixture reports "max" whatever the Hub set
  try {
    const live = liveEvents(t.hub);
    const s = await startLega(t, owner);
    const notice = live.find((e) => e.type === "lega.notice");
    assert.ok(notice, "the owner is told");
    assert.equal(notice.level, "warning");
    assert.equal(notice.sessionId, s.sessionId);
    assert.match(notice.text, /alt nivel de gândire \(„max”\) decât cel stabilit de Hub \(„low”\).*Sesiunea continuă\./);
    assert.equal(t.hub.lega.state().status, "active", "not refused");
    assert.equal(events(t, "lega.session.connected").at(-1).payload.effort, "max");
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(t.hub.lega.state().status, "active", "and it keeps running");
    await t.hub.commands.dispatch({ type: "lega.session.stop", channel: "ui", actor: "user", payload: { sessionId: s.sessionId } });
    assert.equal(t.hub.lega.state().endReason, "user");
  } finally { await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }
});
