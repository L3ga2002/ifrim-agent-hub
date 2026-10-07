// 2.12.3 (D3) — „Rulează preview-ul Pro Delivery” (live 2026-10-06) became two confirmed Claude analyses: the intake's show_preview was
// silent (no project kept, no answer) and Lega's work tools planned the words with whatever kind the agent named.
// PASS_SIMULATED: test Hubs with fixture providers only (fake app-server for Lega, the factory fixtures, stub planners registered through
// the intake's own registerPlanner); no model, no live Hub, no network.
//  - D3-01: the resolver keeps the project the preview words name, and `start` for run / start verbs (pure);
//  - D3-02/03: the intake answers the preview itself — the plain reason when the project has no Software Factory mission with a preview, the
//    mission's preview in the cockpit when it has one — and starts nothing; with no project, ONE question that a following name completes;
//  - D3-04: intake.plan (Lega's request_work / propose_run / propose_mission) answers preview words as that read for every planner kind;
//  - D3-05: Lega end to end (the live sequence): the Hub says the answer once, request_work and propose_run report it, nothing is planned;
//  - D3-06: the voice-first instructions say a preview is not work (advisory; the server guard is authoritative);
//  - D3-07: mutation checks of the resolver on a temporary copy (the repository file is never touched).
// Hand mutations (break one line → the named test turns red → exact bytes restored → green), recorded here:
//  - M1: delete `if (previewStep) { return executeStep(…) }` in intake.plan → D3-04 (the stub planner is called) and D3-05 (a plan / blocker);
//  - M2: remove "show_preview" from HUB_SPOKEN_READS (runtime/lega.mjs) → D3-05 (nothing spoken by the Hub; hub_actions reports nothing);
//  - M3: delete the executeStep show_preview branch → D3-02 (message undefined: the silent live result);
//  - M4: restore the layout.mjs fallback (`mission ? add("Preview", …)`) → D3-02 (a Preview card for the bug-demo mission);
//  - M5: drop `&& !r.clarification` in sayStopTalk → D3-05b (the question spoken twice).
// D3 review (2.12.3): the held preview read, the inflected spellings, the pure-read rule (a work verb / another clause / a Studio kind reach
// their planner) and the session refusal of a paraphrased work tool. Hand mutations, exact bytes restored afterwards:
//  - M6: drop the PREVIEW_WORK_VERBS check in previewStepOf → D3-04 (the negative controls answer the preview);
//  - M7: drop the held `not_yet` (held: show_preview) case in previewStepOf → D3-04 (the conditional sentences reach the planner);
//  - M8: drop the PREVIEW_OVERRIDE_KINDS gate → D3-04 (a Studio request is answered as the preview);
//  - M9: recentPreviewAnswer always null → D3-05c; M10: drop its newest-sentence bound → D3-05c (a later sentence is still refused).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { makeTestHub, enrolOwner, prepareLiveWithoutGrants, waitFor } from "./helpers.mjs";
import { materializeFixture, demoSpec } from "../server/factory/fixtures.mjs";
import { resolveIntent } from "../server/owner/intents.mjs";
import { LEGA_CONSENT_VERSION, LEGA_WORK_TAILS, legaAgentInstructions } from "../server/policy/lega-policy.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const INTENTS_PATH = path.join(here, "..", "server", "owner", "intents.mjs");
const EFFECT_CLASS_PATH = path.join(here, "..", "server", "policy", "effect-class.mjs");
const OFFER = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n";
const M09_MODELS = { writerModel: "gpt-fake-sol", reviewerModel: "sonnet" };
const PROJECTS = [{ id: "pd", name: "ProDelivery", slug: "prodelivery" }, { id: "fd", name: "Factory Demo M10.2", slug: "factory-demo-m10-2" }];
const LIVE = "Rulează preview-ul Pro Delivery";
const NO_PREVIEW = "Pe ProDelivery nu am un preview pe care să-l pornesc: Hub-ul pornește un preview doar ca pas al unei misiuni Software Factory care are o comandă de preview, iar proiectul acesta nu are o astfel de misiune. Nu am pornit nimic și nu am pregătit niciun plan.";
const QUESTION = "Pe ce proiect să-ți arăt preview-ul?";

const b64 = (list) => Buffer.from(JSON.stringify(list)).toString("base64url");
const script = (list) => `lega-script:${b64(list)}`;
const replies = (t) => t.readLog("codex").filter((l) => l.toolReply).map((l) => ({ tool: l.tool, ok: l.toolReply.success, text: l.toolReply.contentItems?.[0]?.text || "" }));
const spoken = (t) => t.readLog("codex").filter((l) => l.spoke).map((l) => l.spoke);
const dispatch = (hub, type, payload, extra = {}) => hub.commands.dispatch({ type, payload, channel: "test", actor: "test", ...extra });
const asOwner = (t, payload) => t.hub.commands.dispatch({ type: "owner.intent", payload: { source: "typed", ...payload }, channel: "owner", actor: `owner:${t.owner.session.id}`, ownerSession: t.owner.session }).then((r) => r.result);
const onVoice = (t, payload) => t.hub.commands.dispatch({ type: "owner.intent", payload, channel: "voice", actor: "voice" }).then((r) => r.result);
const count = (t, sql, ...a) => t.hub.db.prepare(sql).get(...a).n;
const events = (t, type) => t.hub.db.prepare("SELECT payload_json FROM events WHERE type = ? ORDER BY seq").all(type).map((e) => JSON.parse(e.payload_json || "{}"));
/** What a preview sentence must never create. */
const untouched = (t) => Object.fromEntries(["mission_envelopes", "agent_runs", "live_grants", "work_requests", "ops_plans", "factory_missions"].map((k) => [k, count(t, `SELECT COUNT(*) AS n FROM ${k}`)]));
const shape = (r) => r.steps.map((s) => [s.intent, s.args]);

/** A test Hub with one factory test project (a fixture copy) under the owner's voice-first session. */
async function previewHub({ name = "ProDelivery", fixture = "bug-demo", lega = null } = {}) {
  const t = await makeTestHub({ queues: true });
  fs.writeFileSync(`${t.logs.codex}.models.json`, JSON.stringify([{ id: "gpt-6.1-sol", isDefault: true, efforts: ["medium", "high"] }, { id: "gpt-fake-sol", efforts: ["medium", "high"] }]));
  await prepareLiveWithoutGrants(t.hub);
  const dir = path.join(t.dataDir, `d3-${fixture}`);
  materializeFixture(fixture, dir);
  const project = (await dispatch(t.hub, "project.register_test", { path: dir, name })).result;
  const owner = await enrolOwner(t, { activatePolicy: true });
  await dispatch(t.hub, "owner.autonomy.set", { projectId: project.id, level: "TRUSTED" }, { ownerSession: owner.reauth() });
  if (lega) {
    t.hub.bus.transaction(() => t.hub.settings.set("legaConsent", { version: LEGA_CONSENT_VERSION, confirmedAt: new Date().toISOString() }, "test"));
    t.hub.refreshCodexConfig();
  }
  return { ...t, project, owner, dir };
}
async function startLega(t) {
  const s = (await t.hub.commands.dispatch({ type: "lega.session.start", channel: "owner", actor: `owner:${t.owner.session.id}`, ownerSession: t.owner.session, payload: { sdp: OFFER } })).result;
  assert.equal(s.authority, "owner_session");
  await t.hub.commands.dispatch({ type: "lega.session.connected", channel: "ui", actor: "user", payload: { sessionId: s.sessionId } });
  return s;
}
/** Stub planners for the given kinds: they only log the call (a planner reached by preview words is the live defect). */
function stubPlanners(t, kinds) {
  const log = [];
  for (const kind of kinds) t.hub.intake.registerPlanner(kind, async ({ text, projectId }) => { log.push({ kind, text, projectId: projectId || null }); return { kind: "message", text: "Planificator de test." }; });
  return log;
}

// ---------------------------------------------------------------- D3-01 (pure)
function resolverCase(resolve) {
  const one = (s) => resolve(s, { projects: PROJECTS, currentProjectId: null, source: "voice-provider" });
  const live = one(LIVE);
  assert.deepEqual(shape(live), [["show_preview", { start: true, projectId: "pd", projectRef: "pro delivery" }]]);
  assert.equal(live.steps[0].effectClass, "READ_NAVIGATE");
  for (const s of ["Pornește preview-ul ProDelivery", "Lansează preview-ul pentru ProDelivery", "Da drumul la preview pe ProDelivery"]) {
    const r = one(s);
    assert.equal(r.steps[0].intent, "show_preview", s);
    assert.equal(r.steps[0].args.projectId, "pd", s);
    assert.equal(r.steps[0].args.start, true, s);
  }
  // D3 review: the Romanian inflected spellings name the same read (live-like: „Rulează previewul ProDelivery” was unknown).
  for (const [s, start] of [["Rulează previewul ProDelivery", true], ["Rulează previzualizarea ProDelivery", true], ["Pornește previewul de la ProDelivery", true],
    ["Arată-mi previewurile de la ProDelivery", undefined]]) {
    const r = one(s);
    assert.deepEqual(r.steps.map((x) => x.intent), ["show_preview"], s);
    assert.equal(r.steps[0].args.projectId, "pd", s);
    assert.equal(r.steps[0].args.start, start, s);
  }
  const show = one("Arată-mi preview-ul de la ProDelivery");
  assert.equal(show.steps[0].args.projectId, "pd");
  assert.equal(show.steps[0].args.start, undefined, "showing is not starting");
  for (const s of ["Arată-mi preview-ul", "Rulează preview-ul acum"]) {
    const r = one(s);
    assert.equal(r.steps[0].intent, "show_preview", s);
    assert.equal(r.steps[0].args.projectId, undefined, `${s}: no project named`);
    assert.equal(r.clarification, null, s);
  }
  // Unchanged meanings.
  assert.equal(one("Repară preview-ul").steps[0].intent, "engineering_request");
  assert.equal(one("Arată-mi preview-ul clipului").steps[0].intent, "studio_show_clip");
  assert.equal(one("Analizează codul preview-ului din ProDelivery").steps[0].intent, "analysis_request");
}
test("D3-01 resolver: preview words keep the project they name and `start` for a run / start verb; other meanings unchanged", () => resolverCase(resolveIntent));

// ---------------------------------------------------------------- D3-02 (the live defect, in the intake)
test("D3-02 intake: a project with no preview mission → the plain reason (typed, opened, by voice after ONE question); nothing created", async () => {
  const t = await previewHub();
  try {
    const before = untouched(t);
    const typed = await asOwner(t, { text: LIVE });
    const r = typed.results[0];
    assert.equal(typed.results.length, 1);
    assert.equal(r.intent, "show_preview");
    assert.equal(r.message, NO_PREVIEW, JSON.stringify(r).slice(0, 400));
    assert.equal(r.plan, undefined);
    assert.equal(r.opsPlan, undefined);
    assert.equal(r.clarification, undefined);
    assert.equal(r.workRequest, undefined);
    assert.deepEqual(untouched(t), before);
    // A factory mission WITHOUT a preview (bug-demo), the project open: the same answer and no empty Preview card.
    await dispatch(t.hub, "factory.prepare", { projectId: t.project.id, ...demoSpec("bug-demo"), limits: M09_MODELS });
    const after = untouched(t);
    const opened = (await asOwner(t, { text: LIVE, projectId: t.project.id })).results[0];
    assert.equal(opened.message, NO_PREVIEW);
    assert.ok(!(opened.layout?.cards || []).some((c) => c.type === "Preview"), JSON.stringify(opened.layout));
    assert.deepEqual(untouched(t), after);
    // By voice with no project: ONE question with the projects; naming one completes THIS request.
    const asked = (await onVoice(t, { text: "Rulează preview-ul" })).results[0];
    assert.equal(asked.intent, "show_preview");
    assert.equal(asked.clarification?.question, QUESTION);
    assert.ok(asked.clarification.options.some((o) => o.id === t.project.id && o.label === "ProDelivery"), JSON.stringify(asked.clarification.options));
    const named = await onVoice(t, { text: "ProDelivery" });
    assert.equal(named.results[0].intent, "show_preview", JSON.stringify(named.results).slice(0, 300));
    assert.equal(named.results[0].message, NO_PREVIEW);
    assert.deepEqual(untouched(t), after);
  } finally { await t.cleanup(); }
});

// ---------------------------------------------------------------- D3-03 (a mission with a preview)
test("D3-03 intake: a Software Factory mission with a preview → shown in the cockpit (status said), never started separately", async () => {
  const t = await previewHub({ name: "Factory Demo B", fixture: "service-request" });
  try {
    await dispatch(t.hub, "factory.prepare", { projectId: t.project.id, ...demoSpec("service-request"), limits: M09_MODELS });
    const mission = t.hub.factory.list().find((f) => f.projectId === t.project.id);
    assert.ok(mission);
    const before = untouched(t);
    const r = (await asOwner(t, { text: "Pornește preview-ul Factory Demo B" })).results[0];
    assert.equal(r.intent, "show_preview");
    assert.equal(r.message, "Îți arăt în cockpit preview-ul misiunii „Solicitare serviciu: formular + endpoint + bază de test”: încă nu a rulat. Nu îl pornesc separat: preview-ul rulează ca pas al misiunii, după verificări.");
    assert.equal(r.preview?.missionId, mission.missionId);
    assert.equal(r.navigate, `/cockpit/${t.project.id}`);
    assert.deepEqual({ type: r.layout?.cards?.[0]?.type, ref: r.layout?.cards?.[0]?.ref }, { type: "Preview", ref: { kind: "mission", id: mission.missionId } });
    assert.doesNotMatch(r.message, /\b(mis|prj|env|opp)_/, "no ids in the owner's text");
    // Nothing started: no preview process, the mission still a draft, no envelope, no run.
    assert.ok(!t.hub.supervisor.list().some((p) => String(p.key).startsWith("factory-preview-")));
    assert.equal(t.hub.factory.view(mission.missionId).factory.stage, "SPEC_DRAFT");
    assert.deepEqual(untouched(t), before);
  } finally { await t.cleanup(); }
});

// ---------------------------------------------------------------- D3-04 (the root cause: intake.plan)
test("D3-04 intake.plan: preview words are answered as the read for every planner kind; code and analysis words still reach their planner", async () => {
  const t = await previewHub();
  try {
    const log = stubPlanners(t, ["run", "engineering", "start_mission"]);
    const ctx = { channel: "owner", ownerSession: t.owner.session, actor: "owner" };
    const before = untouched(t);
    for (const kind of ["run", "engineering", "start_mission"]) {
      const r = await t.hub.intake.plan({ kind, projectId: t.project.id, text: LIVE, source: "voice-provider" }, ctx);
      assert.equal(r.intent, "show_preview", kind);
      assert.equal(r.message, NO_PREVIEW, kind);
    }
    assert.deepEqual(log, [], "no planner reached by preview words");
    assert.deepEqual(untouched(t), before);
    // D3 review: a preview read held by a condition, and the inflected spellings, are the same read (with or without the client's project).
    for (const [kind, text, projectId] of [["run", "Rulează preview-ul ProDelivery și verifică dacă merge", t.project.id], ["run", "Rulează preview-ul ProDelivery și vezi dacă pornește", t.project.id],
      ["run", "Pornește preview-ul ProDelivery dacă se poate", t.project.id], ["run", "Pornește preview-ul ProDelivery dacă se poate", null],
      ["run", "Rulează previewul ProDelivery", t.project.id], ["run", "Rulează previewul ProDelivery", null], ["run", "Rulează previzualizarea ProDelivery", t.project.id],
      ["start_mission", "Rulează preview-ul ProDelivery și verifică dacă merge", t.project.id]]) {
      const r = await t.hub.intake.plan({ kind, projectId, text, source: "voice-provider" }, ctx);
      assert.equal(r.intent, "show_preview", `${kind}: ${text}`);
      assert.equal(r.message, NO_PREVIEW, `${kind}: ${text}`);
    }
    assert.deepEqual(log, [], "no planner reached by held or inflected preview words");
    assert.deepEqual(untouched(t), before);
    // Controls: an analysis of the preview's code and a repair are work, planned as before.
    await t.hub.intake.plan({ kind: "run", projectId: t.project.id, text: "Analizează codul preview-ului din ProDelivery", source: "voice-provider" }, ctx);
    await t.hub.intake.plan({ kind: "engineering", projectId: t.project.id, text: "Repară preview-ul din ProDelivery", source: "voice-provider" }, ctx);
    assert.deepEqual(log.map((x) => x.kind), ["run", "engineering"]);
    // D3 review (negative controls): explicit work that mentions a preview still reaches its planner — an analysis, a show + analysis, a
    // creation, a run + repair (the resolver drops „și repară”), a Studio clip, and a mission whose title + objective name a preview mode.
    log.length = 0;
    const studioLog = stubPlanners(t, ["studio_create"]);
    const work = [["run", "Analizează preview-ul ProDelivery"], ["run", "Arată-mi preview-ul și analizează codul din ProDelivery"],
      ["engineering", "Creează un preview pentru pagina de login în ProDelivery"], ["engineering", "Rulează preview-ul ProDelivery și repară bug-ul de login"],
      ["studio_create", "Fă un preview video de 15 secunde pentru Instagram"], ["studio_create", "Arată-mi preview-ul ProDelivery"], ["engineering", "Mod preview pentru comenzi. Clientul vede comanda înainte să o trimită"]];
    for (const [kind, text] of work) {
      const r = await t.hub.intake.plan({ kind, projectId: kind === "studio_create" ? null : t.project.id, text, source: "voice-provider" }, ctx);
      assert.notEqual(r.intent, "show_preview", `${kind}: ${text}`);
      assert.notEqual(r.message, NO_PREVIEW, `${kind}: ${text}`);
    }
    assert.deepEqual(log.map((x) => x.text), work.filter(([k]) => k !== "studio_create").map(([, x]) => x));
    assert.deepEqual(studioLog.map((x) => x.text), ["Fă un preview video de 15 secunde pentru Instagram", "Arată-mi preview-ul ProDelivery"]);
  } finally { await t.cleanup(); }
});

// ---------------------------------------------------------------- D3-05 (Lega, the live sequence)
test("D3-05 Lega: the Hub says the preview answer once; hub_actions, request_work and propose_run report it; nothing is planned or run", async () => {
  const t = await previewHub({ lega: true });
  try {
    t.queue("codex", script([{ sleep: 700 }, { say: LIVE }, { sleep: 1500 }, { tool: "hub_actions" },
      { tool: "request_work", args: { request: LIVE, project: "ProDelivery", kind_hint: "run" } },
      { tool: "propose_run", args: { project: "ProDelivery", task: LIVE, provider: "claude", model: "sonnet" } }]));
    await startLega(t);
    await waitFor(() => t.readLog("codex").some((l) => l.scriptDone), 30000);
    await waitFor(() => replies(t).length >= 3, 10000);
    assert.equal(spoken(t).filter((x) => x === NO_PREVIEW).length, 1, JSON.stringify(spoken(t)));
    const [actions, work, run] = replies(t);
    assert.equal(actions.tool, "hub_actions");
    assert.ok(actions.text.includes(`„${LIVE}” → message: Pe ProDelivery nu am un preview`), actions.text);
    assert.equal(work.tool, "request_work");
    assert.equal(work.text, `${NO_PREVIEW} ${LEGA_WORK_TAILS.nothing}`);
    assert.equal(run.tool, "propose_run");
    assert.equal(run.text, `${NO_PREVIEW} ${LEGA_WORK_TAILS.nothing}`);
    for (const k of ["mission_envelopes", "agent_runs", "work_requests"]) assert.equal(count(t, `SELECT COUNT(*) AS n FROM ${k}`), 0, k);
    assert.ok(!events(t, "lega.work_request").some((p) => p.outcome === "plan"));
  } finally { await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }
});

test("D3-05c Lega: the agent paraphrases the preview request without the word „preview” → still refused with the Hub's answer; a later sentence ends it", async () => {
  const t = await previewHub({ lega: true });
  try {
    const log = stubPlanners(t, ["run", "engineering"]);
    t.queue("codex", script([{ sleep: 700 }, { say: LIVE }, { sleep: 1500 },
      { tool: "request_work", args: { request: "Pornește aplicația ProDelivery", project: "ProDelivery", kind_hint: "run" } },
      { tool: "propose_run", args: { project: "ProDelivery", task: "Rulează aplicația ProDelivery local", provider: "claude", model: "sonnet" } },
      { tool: "request_work", args: { request: "Pornește aplicația ProDelivery" } },
      { say: "Zbrrt flonk qwyx" }, { sleep: 1500 },
      { tool: "propose_run", args: { project: "ProDelivery", task: "Rulează aplicația ProDelivery local", provider: "claude", model: "sonnet" } }]));
    await startLega(t);
    await waitFor(() => t.readLog("codex").some((l) => l.scriptDone), 30000);
    await waitFor(() => replies(t).length >= 4, 10000);
    const [work, run, unnamed, later] = replies(t);
    for (const r of [work, run, unnamed]) {
      assert.equal(r.ok, false, r.text);
      assert.equal(r.text, `${NO_PREVIEW} ${LEGA_WORK_TAILS.nothing}`, r.tool);
    }
    assert.equal(events(t, "lega.work_request").filter((p) => p.outcome === "preview_answered").length, 3);
    // The owner's next sentence ends the refusal: the same propose_run reaches its planner (the stub only logs it).
    assert.notEqual(later.text, `${NO_PREVIEW} ${LEGA_WORK_TAILS.nothing}`, later.text);
    assert.deepEqual(log.map((x) => x.kind), ["run"]);
    for (const k of ["mission_envelopes", "agent_runs", "work_requests"]) assert.equal(count(t, `SELECT COUNT(*) AS n FROM ${k}`), 0, k);
  } finally { await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }
});

test("D3-05b Lega: „Rulează preview-ul” with no project → the Hub's question is spoken exactly once", async () => {
  const t = await previewHub({ lega: true });
  try {
    t.queue("codex", script([{ sleep: 700 }, { say: "Rulează preview-ul" }, { sleep: 1500 }]));
    await startLega(t);
    await waitFor(() => t.readLog("codex").some((l) => l.scriptDone), 30000);
    await waitFor(() => spoken(t).some((x) => x.includes(QUESTION)), 5000);
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(spoken(t).filter((x) => x.includes(QUESTION)).length, 1, JSON.stringify(spoken(t)));
  } finally { await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }
});

// ---------------------------------------------------------------- D3-06 (policy text)
test("D3-06 voice-first instructions: a preview is not work; the legacy instructions are unchanged", () => {
  assert.match(legaAgentInstructions({ voiceFirst: true }), /PREVIEW: .*never call lega\.request_work or lega\.propose_run for it/);
  assert.doesNotMatch(legaAgentInstructions({}), /PREVIEW:/);
});

// ---------------------------------------------------------------- D3-07 (mutation checks on a temp copy of the resolver)
let mutationN = 0;
async function mutatedResolver(mutate) {
  const src = fs.readFileSync(INTENTS_PATH, "utf8");
  const changed = mutate(src);
  assert.notEqual(changed, src, "the mutation must apply");
  const file = path.join(os.tmpdir(), `ifrim-d3-intents-mut-${process.pid}-${mutationN++}.mjs`);
  fs.writeFileSync(file, changed.replace('from "../policy/effect-class.mjs"', `from ${JSON.stringify(pathToFileURL(EFFECT_CLASS_PATH).href)}`));
  try { return await import(pathToFileURL(file).href); } finally { fs.rmSync(file, { force: true }); }
}
test("D3-07 mutation checks: the resolveRefs branch keeps the project, the table's args keep `start`", async () => {
  const ctx = { projects: PROJECTS, currentProjectId: null, source: "voice-provider" };
  const a = await mutatedResolver((src) => src.replace(/  if \(step\.intent === "show_preview" && projects\.length\) \{[\s\S]*?\n  \}\n/, ""));
  assert.equal(a.resolveIntent(LIVE, ctx).steps[0].args.projectId, undefined, "the project is lost again");
  assert.throws(() => resolverCase(a.resolveIntent));
  const b = await mutatedResolver((src) => src.replace(", (_m, c) => (PREVIEW_START.test(c) ? { start: true } : {})]", "]"));
  assert.equal(b.resolveIntent("Pornește preview-ul ProDelivery", ctx).steps[0].args.start, undefined);
  assert.throws(() => resolverCase(b.resolveIntent));
});
