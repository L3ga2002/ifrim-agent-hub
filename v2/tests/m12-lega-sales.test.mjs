// M12 WP10 — S-07: Lega and the cockpit understand the owner's offer words. „Pregătește o ofertă pentru …” is ONE plan card (the Sales
// planner, no model, no other question); „Arată-mi oferta” opens the latest offer (navigation + a read with its id, version, FULL SHA and
// status); „Ce lipsește?” (in a Sales conversation) is the Hub's read answer from the latest preparation (the brief's missing fields, the
// q-v2 items, the prices „De stabilit (neconfigurat)”, the owner's pending approval); „Aprobă oferta” is only an explanation of WHERE the
// owner approves the exact offer — the Hub never approves and never creates an approval. Typos never become a send. Every Hub is a fully
// synthetic acceptance hub (accept-helpers isolation; the fixture Codex app-server for Lega; no model, no network).
import test from "node:test";
import assert from "node:assert/strict";
import { resolveIntent } from "../server/owner/intents.mjs";
import { PLANNER_FOR_INTENT } from "../server/owner/intake.mjs";
import { SESSION_COOKIE } from "../server/owner/trust.mjs";
import { LEGA_CONSENT_VERSION, legaDynamicTools, legaAgentInstructions, LEGA_WORK_KINDS, LEGA_HOWTO_VOICE_FIRST, LEGA_SCREENS } from "../server/policy/lega-policy.mjs";
import { enrolOwner, prepareLiveWithoutGrants, waitFor } from "./helpers.mjs";
import { prepHub, countRows, SALES_REQUEST } from "./sales-helpers.mjs";
import { PREPARE_KIND } from "../server/sales/preparation.mjs";

const intents = (text, context = {}) => resolveIntent(text, { projects: [], ...context }).steps.map((s) => s.intent);
const FULL_SHA = /\b[0-9a-f]{64}\b/;

test("M12-LS-01 resolver: offer words → the Sales intents; „Arată-mi oferta” is no project; a bare „Ce lipsește?” only in a Sales conversation; „aprobă oferta” is a read; typos never toward send", () => {
  for (const s of [SALES_REQUEST, "Pregatește o ofrta pentru un service auto din cluj care vrea programari online", "Fă o ofertă pentru o florărie din Iași", "Lega, pregătește-mi o ofertă pentru un cabinet stomatologic",
    "Ok, pregătește o ofertă pentru o pensiune", "Vreau o ofertă pentru un restaurant din Sibiu", "regătește o ofertă pentru o cafenea"]) {
    const r = resolveIntent(s, { projects: [] });
    assert.deepEqual(r.steps.map((x) => [x.intent, x.effectClass]), [["sales_prepare", "BOUNDED_WORKFLOW"]], s);
    assert.equal(PLANNER_FOR_INTENT[r.steps[0].intent], "sales", s);
    assert.equal(r.clarification, null, `${s}: no other question`);
  }
  assert.equal(resolveIntent("regătește o ofertă pentru o cafenea", {}).corrections[0].to, "pregateste", "the slip is corrected toward the preparation verb");
  for (const s of ["Arată-mi oferta", "Deschide oferta", "Vreau să văd oferta", "Arată-mi dosarul ofertei", "Arată-mi ultima ofertă"]) assert.deepEqual(intents(s), ["sales_show"], s);
  assert.equal(resolveIntent("Arată-mi oferta", {}).steps[0].effectClass, "READ_NAVIGATE");
  assert.ok(!intents("Da, oferta e bună").includes("sales_show"), "a „da” about the offer is no request to show it");
  assert.deepEqual(intents("Ce lipsește din ofertă?"), ["sales_missing"]);
  assert.deepEqual(intents("Ce lipsește?"), ["unknown"], "outside a Sales conversation it is not the offer's");
  assert.deepEqual(intents("Ce lipsește?", { salesContext: true }), ["sales_missing"]);
  assert.deepEqual(intents("Și ce mai lipsește?", { salesContext: true }), ["sales_missing"]);
  for (const s of ["Aprobă oferta", "Aprob oferta", "Aprobă intern oferta", "Poți să aprobi oferta?"]) {
    const r = resolveIntent(s, { projects: [], pendingEnvelopes: [{ id: "env_x", title: "x" }], awaiting: "envelope_confirmation" });
    assert.deepEqual(r.steps.map((x) => [x.intent, x.effectClass]), [["sales_approve_talk", "READ_NAVIGATE"]], s);
    assert.ok(!r.steps.some((x) => x.intent === "confirm"), `${s} never confirms anything`);
  }
  // The existing meanings stay: a project named in words, the delivery, the Studio, a code request on a contact page.
  assert.deepEqual(intents("Pregătește demo-ul de detailing pentru prezentare"), ["delivery_prepare"]);
  assert.deepEqual(intents("Arată-mi clipul"), ["studio_show_clip"]);
  assert.deepEqual(intents("Repară bug-ul de pe pagina de contact"), ["engineering_request"]);
  assert.deepEqual(intents("Hai la ProDelivery", { projects: [{ id: "p1", name: "ProDelivery", slug: "prodelivery" }] }), ["open_project"]);
});

test("M12-LS-02 the cockpit (typed, owner session, HTTP): prepare → ONE card; show → the offer (id, version, full SHA) and its screen; missing → the read answer; „Aprobă oferta” → where, 0 approvals", async (c) => {
  const t = await prepHub(c);
  await t.authenticate();
  const say = async (text) => { const r = await t.request("/api/owner/intent", { body: { text, source: "typed" } }); assert.equal(r.status, 200, JSON.stringify(r.json)); return r.json; };
  // Before anything: no offer, the Hub says how to start (a read, no card).
  const empty = await say("Arată-mi oferta");
  assert.match(empty.results[0].message, /Nu am încă o ofertă pregătită/);
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM ops_plans"), 0);
  // ONE card and no other question.
  const prep = await say(SALES_REQUEST);
  assert.equal(prep.resolved.clarification, null);
  assert.equal(prep.results.length, 1);
  const card = prep.results[0].opsPlan;
  assert.ok(card?.id, JSON.stringify(prep.results));
  assert.equal(card.kind, PREPARE_KIND);
  assert.equal(prep.results[0].clarification, undefined);
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM ops_plans"), 1);
  assert.equal(t.hub.salesPreparations.get(card.preparationId).status, "PLANNED");
  // Not confirmed yet: the read says so (still no offer).
  assert.match((await say("Arată-mi oferta")).results[0].message, /planul așteaptă confirmarea ta/);
  const confirmed = await t.request(`/api/ops/plans/${card.id}/confirm`, { body: { nonce: card.nonce, displayedHash: card.hash } });
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.json));
  await t.hub.opsPlans.idle(card.id);
  const p = t.hub.salesPreparations.get(card.preparationId);
  assert.equal(p.status, "WAITING_OWNER", p.statusReason);
  // „Arată-mi oferta”: the exact offer and its opportunity screen.
  const shown = await say("Arată-mi oferta");
  const s = shown.results[0];
  assert.equal(s.intent, "sales_show");
  assert.equal(s.navigate, `/sales?tab=opp&id=${encodeURIComponent(p.opportunityId)}`);
  assert.ok(s.message.includes(p.awaited.proposalId) && s.message.includes(p.awaited.proposalSha), s.message);
  assert.match(s.message, /v1/);
  assert.deepEqual([s.sales.proposal.id, s.sales.proposal.sha, s.sales.proposal.status, s.sales.preparationStatus], [p.awaited.proposalId, p.awaited.proposalSha, "DRAFT", "WAITING_OWNER"]);
  // A bare „Ce lipsește?” right after it is about the offer (the server-held conversation).
  const missing = (await say("Ce lipsește?")).results[0];
  assert.equal(missing.intent, "sales_missing");
  assert.match(missing.message, /bugetul/, "the brief's missing fields");
  assert.match(missing.message, /De stabilit \(neconfigurat\)/, "the unknown prices");
  assert.match(missing.message, /q-v2/, "what q-v2 could not score");
  assert.ok(missing.message.includes(p.awaited.proposalSha), "the owner's pending approval of the exact offer");
  // „Aprobă oferta”: where and what — never an approval, never a request for one.
  const commandsBefore = countRows(t, "SELECT COUNT(*) AS n FROM commands WHERE type IN ('sales.proposal.approve','approval.owner_decide','approval.decide')");
  const talk = (await say("Aprobă oferta")).results[0];
  assert.equal(talk.intent, "sales_approve_talk");
  assert.match(talk.message, /nu aprob oferta și nu am creat nicio aprobare/);
  assert.match(talk.message, /Vânzări → Oportunitate/);
  assert.match(talk.message, /Aprob intern/);
  assert.ok(talk.message.includes(p.awaited.proposalId) && FULL_SHA.test(talk.message) && talk.message.includes(p.awaited.proposalSha), talk.message);
  assert.equal(talk.navigate, s.navigate);
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM approvals"), 0, "no approval created");
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM commands WHERE type IN ('sales.proposal.approve','approval.owner_decide','approval.decide')"), commandsBefore);
  const offer = t.hub.sales.latestProposal(p.opportunityId);
  assert.deepEqual([offer.status, offer.approvedSha], ["DRAFT", null]);
  assert.equal(t.hub.sales.getOpportunity(p.opportunityId).opportunity.status, "READY_FOR_OWNER_REVIEW");
  // Reads change nothing: no plan, no Sales event.
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM ops_plans"), 1);
  t.assertPaths();
});

test("M12-LS-03 policy: the offer is a voice-first work kind and read tool only; the legacy tool list and instructions are unchanged; Vânzări is a screen Lega may open", () => {
  const ctx = { projects: [{ id: "p1", name: "Hub" }], allProjects: [{ id: "p1", name: "Hub" }], missionKinds: ["development", "eng_bugfix"] };
  assert.ok(LEGA_WORK_KINDS.includes("sales"));
  const legacy = legaDynamicTools(ctx)[0].tools.map((x) => x.name);
  assert.ok(!legacy.includes("sales_preparation") && !legacy.includes("request_work"), "the legacy list has no new tool (M03-LEGA-01)");
  const vf = legaDynamicTools({ ...ctx, voiceFirst: true })[0].tools;
  assert.ok(vf.some((x) => x.name === "sales_preparation"));
  assert.ok(vf.find((x) => x.name === "request_work").inputSchema.properties.kind_hint.enum.includes("sales"));
  assert.doesNotMatch(legaAgentInstructions(ctx), /OFFERS:|sales_preparation/, "legacy instructions unchanged");
  assert.match(legaAgentInstructions({ ...ctx, voiceFirst: true }), /OFFERS: .*kind_hint sales.*never say you approved it.*OUTREACH_DISABLED/);
  assert.equal(LEGA_HOWTO_VOICE_FIRST.sales.screen, "vanzari");
  assert.equal(LEGA_SCREENS[LEGA_HOWTO_VOICE_FIRST.sales.screen], "/sales");
});

const OFFER = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n";
const b64 = (list) => Buffer.from(JSON.stringify(list)).toString("base64url");
const replies = (t) => t.readLog("codex").filter((l) => l.toolReply).map((l) => ({ tool: l.tool, ok: l.toolReply.success, text: l.toolReply.contentItems?.[0]?.text || "" }));

test("M12-LS-04 Lega voice-first: request_work „pregătește o ofertă …” → ONE Sales card (no engineering or run planner); after the owner's confirmation the owner's words show the offer, a bare „Ce lipsește?” is answered, lega.sales_preparation reads it; nothing approved", async (c) => {
  const t = await prepHub(c, { fakeProviders: { codex: "ok" } });
  c.after(async () => { await t.hub.lega.stopAll("test").catch(() => {}); });
  const owner = await enrolOwner(t, { activatePolicy: true });
  await prepareLiveWithoutGrants(t.hub);
  t.hub.bus.transaction(() => t.hub.settings.set("legaConsent", { version: LEGA_CONSENT_VERSION, confirmedAt: new Date().toISOString() }, "test"));
  t.hub.refreshCodexConfig();
  const other = [];
  for (const kind of ["engineering", "run"]) t.hub.intake.registerPlanner(kind, async ({ text }) => { other.push({ kind, text }); return { kind: "message", text: "planificator de test" }; });
  const live = []; t.hub.live.subscribe((e) => live.push(e));
  const start = async () => {
    const s = (await t.hub.commands.dispatch({ type: "lega.session.start", channel: "owner", actor: `owner:${owner.session.id}`, ownerSession: owner.session, payload: { sdp: OFFER } })).result;
    assert.equal(s.authority, "owner_session");
    await t.hub.commands.dispatch({ type: "lega.session.connected", channel: "ui", actor: "user", payload: { sessionId: s.sessionId } });
    return s;
  };
  // Session 1: the model hands the owner's offer request to the Hub (even with a wrong hint, an offer is the Sales planner's).
  t.queue("codex", `lega-calls:${b64([{ tool: "request_work", args: { request: SALES_REQUEST, kind_hint: "engineering" } }, { tool: "sales_preparation" }])}`);
  await start();
  await waitFor(() => t.readLog("codex").some((l) => l.callsDone), 30000);
  const [work, read0] = replies(t);
  assert.equal(work.ok, true, work.text);
  assert.match(work.text, /Am pregătit planul „Pregătește o ofertă \(date sintetice\)/);
  assert.deepEqual(other, [], "no engineering or run planner");
  const plans = t.hub.db.prepare("SELECT id, kind FROM ops_plans").all().map((p) => ({ ...p, ...t.hub.opsPlans.view(p.id) }));
  assert.equal(plans.length, 1);
  assert.equal(plans[0].kind, PREPARE_KIND);
  assert.match(read0.text, /planul așteaptă confirmarea ta/);
  await t.hub.lega.stopAll("test");
  // The owner confirms the card himself (his session, the exact nonce + hash); phase A runs to his review.
  const r = await t.request(`/api/ops/plans/${plans[0].id}/confirm`, { body: { nonce: plans[0].nonce, displayedHash: plans[0].hash }, sessionCookie: `${SESSION_COOKIE}=${owner.token}` });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  await t.hub.opsPlans.idle(plans[0].id);
  const prep = t.hub.salesPreparations.list()[0];
  assert.equal(prep.status, "WAITING_OWNER", prep.statusReason);
  // Session 2: the owner's own words through the bridge, then Lega's read tool.
  const before = t.readLog("codex").length;
  t.queue("codex", `lega-script:${b64([{ sleep: 700 }, { say: "Arată-mi oferta" }, { sleep: 1200 }, { say: "Ce lipsește?" }, { sleep: 1200 }, { tool: "sales_preparation" }, { tool: "hub_actions" }])}`);
  await start();
  await waitFor(() => t.readLog("codex").slice(before).some((l) => l.scriptDone), 30000);
  const nav = live.filter((e) => e.type === "lega.navigate").map((e) => e.path);
  assert.ok(nav.includes(`/sales?tab=opp&id=${encodeURIComponent(prep.opportunityId)}`), JSON.stringify(nav));
  const actions = t.hub.lega.hubActions();
  assert.ok(actions.some((a) => a.intents.includes("sales_show")), JSON.stringify(actions));
  assert.ok(actions.some((a) => a.intents.includes("sales_missing")), "a bare „Ce lipsește?” in the Sales conversation is the offer's");
  const read = replies(t).filter((x) => x.tool === "sales_preparation").at(-1);
  assert.equal(read.ok, true);
  assert.ok(read.text.includes(prep.awaited.proposalId) && read.text.includes(prep.awaited.proposalSha), read.text);
  assert.match(read.text, /De stabilit \(neconfigurat\)/);
  assert.match(read.text, /OUTREACH_DISABLED/);
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM approvals"), 0, "nothing approved, nothing requested");
  assert.equal(t.hub.sales.latestProposal(prep.opportunityId).status, "DRAFT");
  t.assertPaths();
});
