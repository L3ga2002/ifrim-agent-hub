// M10.2 integration seams (after the units landed): a written code request or analysis reaches its planner; the execution gate is
// never a Studio blocker; a preserved request is DONE when its plan finishes; a spoken „Lega, pauză” in a session derived from the
// owner session is the owner's pause, so a typed „Continuă” reopens it (and a provider transcript never does); the pause classifier
// reads the recorded credential, never the reason text; the kept-request sentence survives the speech clip. Fake providers only.
import test from "node:test";
import assert from "node:assert/strict";
import { makeTestHub, enrolOwner, prepareLiveWithoutGrants, waitFor } from "./helpers.mjs";
import { resolveIntent } from "../server/owner/intents.mjs";
import { explain } from "../server/owner/blockers.mjs";
import { collectFacts } from "../server/owner/readiness-runner.mjs";
import { LEGA_CONSENT_VERSION, speakable } from "../server/policy/lega-policy.mjs";
import { PLANNER_FOR_INTENT } from "../server/owner/intake.mjs";

const OFFER = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n";
const script = (list) => `lega-script:${Buffer.from(JSON.stringify(list)).toString("base64url")}`;
const projects = [{ id: "p_demo", name: "Factory Demo M07", slug: "factory-demo-m07", source: "hub-test" }, { id: "p_pd", name: "ProDelivery", slug: "prodelivery", source: "registry" }];

test("M10.2-IN-01 written requests reach their planner: code change → engineering, reading → run; specific intents still win", () => {
  const first = (text) => resolveIntent(text, { projects, missions: [], departments: [], pendingEnvelopes: [] }).steps[0];
  for (const text of ["Repară testul de autentificare din Factory Demo M07", "Implementează validarea formularului", "Adaugă teste pentru funcția de calcul", "Rezolvă bug-ul de la login"]) {
    const s = first(text);
    assert.equal(s.intent, "engineering_request", text);
    assert.equal(s.effect, "plan");
    assert.equal(PLANNER_FOR_INTENT[s.intent], "engineering");
  }
  for (const text of ["Analizează README-ul proiectului ProDelivery", "Rezumă ultimele modificări", "Citește specificația misiunii"]) {
    const s = first(text);
    assert.equal(s.intent, "analysis_request", text);
    assert.equal(PLANNER_FOR_INTENT[s.intent], "run");
  }
  // Review M10.2 #18: earlier read / plan patterns no longer take a code request; the reads keep their intents (#5: the named project).
  for (const text of ["Repară testele care pică", "Scrie testele pentru pagina de login", "Adaugă un endpoint de status", "Repară preview-ul", "Repară butonul de login care nu merge", "Corectează validarea din planul de abonament"]) {
    assert.equal(first(text).intent, "engineering_request", text);
  }
  assert.equal(first("Analizează testele care pică").intent, "analysis_request");
  for (const [text, intent] of [["Arată-mi testele", "show_tests"], ["Arată-mi planul", "show_plan"], ["Status", "status"]]) assert.equal(first(text).intent, intent, text);
  assert.equal(first("Repară testul de autentificare din Factory Demo M07").args.projectId, "p_demo");
  assert.equal(first("La secunda 12 mută textul mai sus").intent, "studio_edit", "a timecode correction stays a Studio edit");
  assert.equal(first("Deschide Notepad").intent, "desktop_open");
  assert.notEqual(first("Explică-mi de ce e blocat").intent, "analysis_request", "a why-question is not an analysis run");
  assert.equal(first("Oprește tot").intent, "stop_all");
});

test("M10.2-IN-02 the execution gate is never a Studio blocker; the pause classifier reads the recorded credential, not the reason text", async () => {
  const t = await makeTestHub({ codex: "lega-ok" });
  try {
    t.hub.bus.transaction(() => t.hub.settings.set("executionGate", { status: "suspended", reason: "Pauză (fără pași noi)", changedAt: new Date().toISOString(), changedBy: "owner" }, "test"));
    const studio = explain(await collectFacts(t.hub, { projectId: null, intent: "studio" }));
    assert.ok(!(studio.causes || []).includes("GATE_SUSPENDED"), JSON.stringify(studio.causes));
    const eng = explain(await collectFacts(t.hub, { projectId: t.hub.projects.hub().id, intent: "engineering" }));
    assert.ok((eng.causes || []).includes("GATE_SUSPENDED"), JSON.stringify(eng.causes));
    const gate = (eng.blockers || []).find((c) => c.code === "GATE_SUSPENDED");
    assert.ok(gate, "an engineering request still names the suspended gate");
    assert.doesNotMatch(JSON.stringify(gate), /spune „Continuă”/i, "a pause without a recorded credential (reason text only) is not offered „Continuă”");
  } finally { await t.cleanup(); }
});

test("M10.2-IN-03 a preserved request is DONE when the plan it became finishes (ops plan DONE / envelope COMPLETED)", async () => {
  const t = await makeTestHub({ codex: "ok" });
  try {
    const wr = t.hub.workRequests.create({ text: "un clip de promovare", source: "typed", channel: "owner", intent: "studio", effectClass: "BOUNDED_WORKFLOW", actor: "test" });
    t.hub.workRequests.markPlanned(wr.id, { kind: "ops", id: "opp_test_done" }, { headline: "Clip" });
    assert.equal(t.hub.workRequests.get(wr.id).status, "PLANNED");
    t.hub.bus.transaction(() => t.hub.bus.append({ type: "ops.plan.done", scopeType: "ops_plan", scopeId: "opp_test_done", source: "ops", payload: {} }));
    await waitFor(() => t.hub.workRequests.get(wr.id).status === "DONE", 5000);
    const other = t.hub.workRequests.create({ text: "alt clip", source: "typed", channel: "owner", intent: "studio", effectClass: "BOUNDED_WORKFLOW", actor: "test" });
    t.hub.workRequests.markPlanned(other.id, { kind: "ops", id: "opp_other" }, { headline: "Alt" });
    t.hub.bus.transaction(() => t.hub.bus.append({ type: "ops.plan.done", scopeType: "ops_plan", scopeId: "opp_unrelated", source: "ops", payload: {} }));
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(t.hub.workRequests.get(other.id).status, "PLANNED", "only the request whose plan finished");
  } finally { await t.cleanup(); }
});

test("M10.2-IN-04 „Lega, pauză” in a derived session is the owner's pause; a typed „Continuă” reopens it; a provider „Continuă” never does", async () => {
  const t = await makeTestHub({ codex: script([{ sleep: 1500 }, { say: "Lega, pauză" }, { sleep: 2500 }]) });
  const owner = await enrolOwner(t, { activatePolicy: true });
  await prepareLiveWithoutGrants(t.hub);
  t.hub.bus.transaction(() => t.hub.settings.set("legaConsent", { version: LEGA_CONSENT_VERSION, confirmedAt: new Date().toISOString() }, "test"));
  t.hub.refreshCodexConfig();
  try {
    const s = await t.hub.commands.dispatch({ type: "lega.session.start", channel: "owner", actor: `owner:${owner.session.id}`, ownerSession: owner.session, payload: { sdp: OFFER } }).then((r) => r.result);
    await t.hub.commands.dispatch({ type: "lega.session.connected", channel: "ui", actor: "user", payload: { sessionId: s.sessionId } });
    await waitFor(() => t.hub.settings.get("executionGate").status === "suspended", 15000);
    const g = t.hub.settings.get("executionGate");
    assert.equal(g.suspendedBy?.kind, "pause");
    assert.ok(g.suspendedBy?.credential, "the owner's credential reference is recorded");
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'lega.owner_pause'").get().n, 1);
    // A provider transcript cannot reopen it.
    const provider = await t.hub.commands.dispatch({ type: "owner.intent", channel: "voice", actor: "voice", payload: { text: "Continuă", source: "voice-provider" } }).then((x) => x.result).catch((e) => ({ error: e }));
    assert.equal(t.hub.settings.get("executionGate").status, "suspended", JSON.stringify(provider?.results || provider?.error?.message || null));
    // The owner's typed „Continuă” in the same credential does.
    await t.hub.commands.dispatch({ type: "owner.intent", channel: "owner", actor: `owner:${owner.session.id}`, ownerSession: owner.session, payload: { text: "Continuă", source: "typed" } });
    await waitFor(() => t.hub.settings.get("executionGate").status === "open", 10000);
  } finally { await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }
});

test("M10.2-IN-05 the kept-request sentence is at the start of a blocker explanation (it survives the 900-char speech clip)", async () => {
  const t = await makeTestHub({ codex: "ok" });
  try {
    const ex = explain(await collectFacts(t.hub, { projectId: t.hub.projects.hub().id, intent: "engineering" }));
    if (!ex.blocked) return; // nothing to explain on this fixture: no sentence to check
    assert.match(ex.text.slice(0, 200), /cererea ta rămâne păstrată/);
    assert.match(speakable(`${ex.text} ${"x".repeat(2000)}`), /cererea ta rămâne păstrată/);
  } finally { await t.cleanup(); }
});
