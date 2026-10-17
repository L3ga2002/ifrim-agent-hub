// M12 WP10 — T-S3: live collection and sending (contacting, publishing) stay refused on EVERY path — the API, the command bus, the intent
// resolver, the intake (typed, the owner's voice, a provider transcript, a document), the intake's planner entry and kept requests, Lega's
// tools (voice-first and legacy) and the operation plans — with the OUTREACH_DISABLED reason. Only VERB forms of the Sales vocabulary are
// refused: the noun „contact” („formularul de contact”, „pagina de contact”, „datele de contact”) never is, and „Trimite un mesaj de probă”
// keeps its meaning (P0R5-04). Typo tolerance never corrects toward a send, contact or publish verb. Pure tables boot nothing; every Hub is
// a fully synthetic acceptance hub (accept-helpers isolation; the fixture Codex app-server for Lega; no model, no network).
import test from "node:test";
import assert from "node:assert/strict";
import { resolveIntent, salesOutreach, SALES_SEND_REASON, INTENT_EFFECTS } from "../server/owner/intents.mjs";
import { PLANNER_FOR_INTENT } from "../server/owner/intake.mjs";
import { classOfIntent, refusalReason } from "../server/policy/effect-class.mjs";
import { correctTypos, closest, NEVER_TARGET, TYPO_VOCAB, osaDistance } from "../server/owner/typos.mjs";
import { acceptanceHub, settle } from "./accept-helpers.mjs";
import { enrolOwner, prepareLiveWithoutGrants, enableLive, waitFor } from "./helpers.mjs";
import { prepHub, proposePreparation, confirmCard, approveAwaited, settlePreparation, countRows, salesCommand, SALES_REQUEST } from "./sales-helpers.mjs";
import { LEGA_CONSENT_VERSION, LEGA_WORK_TAILS } from "../server/policy/lega-policy.mjs";
import { PREPARE_KIND, prepareSteps } from "../server/sales/preparation.mjs";

/** The owner's outreach sentences: verb forms, clitics, typos, no diacritics, polite and addressed forms. */
export const OUTREACH_SENTENCES = ["Trimite oferta", "Trimite-o clientului", "Trimiteți oferta clientului", "Te rog trimite-le oferta", "trimite oferta firmei din Cluj",
  "Contactează-i", "Contacteaz-o pe firma X", "contacteaza-i maine", "Contactați firma", "Contactăm clientul mâine", "Lega, contactează-i", "Sună-i", "Scrie-le un mail",
  "Publică oferta", "Postează oferta pe Facebook", "trimte oferta", "trmite oferta clientului", "contactaza-i", "contacteza-o", "Ok, trimite oferta", "Poți să contactezi firma?"];
/** Never refused: the noun „contact”, a send without the Sales vocabulary, a negated send (a restriction), Studio's own publish rule. */
const NOT_REFUSED = ["Fă un formular de contact pentru site", "Adaugă formularul de contact", "Fă pagina de contact", "Actualizează datele de contact", "Repară formularul de contact",
  "Implementează pagina de contact pentru proiect", "Unde e pagina de contact?", "Trimite un mesaj de probă", "Pregătește o ofertă pentru licitații publice", "Public țintă pentru ofertă: service-uri auto",
  // A clip for a client published on a platform keeps the Studio’s own refusal (MEDIA_C): publishing is the Sales refusal only with the offer.
  "Fă un clip pentru client și publică-l pe Instagram"];
const NEGATED = ["Nu trimite oferta", "nu contacta pe nimeni", "Pregătește oferta, fără să trimiți nimic", "Să nu contactezi firma", "Pregătește oferta pentru un service auto din Cluj, fără trimitere"];
const OUTREACH_VERBS = ["trimite", "trimiteti", "trimitem", "expediaza", "expediati", "contacteaza", "contactati", "contactam", "contactez", "contactezi", "contacteze", "contacta",
  "publica", "publicati", "publicam", "posteaza", "postati", "postam", "emaileaza"];
const slips = (w) => { const out = new Set(); for (let i = 0; i < w.length; i += 1) { out.add(w.slice(0, i) + w.slice(i + 1)); out.add(w.slice(0, i) + w[i] + w.slice(i)); if (i + 1 < w.length) out.add(w.slice(0, i) + w[i + 1] + w[i] + w.slice(i + 2)); } return [...out]; };
const nothingCreated = (t) => Object.fromEntries(["ops_plans", "work_requests", "approvals", "missions", "agent_runs", "sales_sends", "sales_contact_events", "sales_drafts", "sales_orgs"]
  .map((table) => [table, countRows(t, `SELECT COUNT(*) AS n FROM ${table}`)]));

test("M12-REF-01 resolver (S3-RES): every outreach sentence is ONE refused step (sales_send, REFUSED, OUTREACH_DISABLED) and never a planner step; the noun „contact” and negations are not", () => {
  for (const s of OUTREACH_SENTENCES) {
    const r = resolveIntent(s, { projects: [] });
    const send = r.steps.filter((x) => x.intent === "sales_send");
    assert.equal(send.length, 1, `${s}: ${JSON.stringify(r.steps.map((x) => x.intent))}`);
    assert.equal(send[0].effectClass, "REFUSED", s);
    assert.equal(send[0].args.reason, SALES_SEND_REASON, s);
    assert.ok(!r.steps.some((x) => Object.hasOwn(PLANNER_FOR_INTENT, x.intent)), `${s} never reaches a planner`);
    assert.ok(salesOutreach(s).hits.length >= 1, s);
  }
  for (const s of NOT_REFUSED) {
    const r = resolveIntent(s, { projects: [] });
    assert.ok(!r.steps.some((x) => x.intent === "sales_send"), `${s}: ${JSON.stringify(r.steps.map((x) => x.intent))}`);
    assert.equal(salesOutreach(s).hits.length, 0, s);
  }
  for (const s of NEGATED) {
    const r = resolveIntent(s, { projects: [] });
    assert.ok(!r.steps.some((x) => x.intent === "sales_send"), s);
    assert.ok(r.steps.every((x) => x.constraints.noMessages === true), `${s} is a restriction (noMessages)`);
    assert.equal(salesOutreach(s).hits.length, 0, s);
  }
  // The offer request keeps its card; the send inside it is its own refused step (never a step of the plan).
  const mixed = resolveIntent("Pregătește o ofertă pentru un service auto din Cluj și trimite-o clientului", { projects: [] });
  assert.deepEqual(mixed.steps.map((x) => [x.intent, x.effectClass]), [["sales_prepare", "BOUNDED_WORKFLOW"], ["sales_send", "REFUSED"]]);
  // A stop said with it still stops (an interruption is never lost to a refusal).
  assert.deepEqual(resolveIntent("Trimite oferta și oprește tot", {}).steps.map((x) => x.intent), ["sales_send", "stop_all"]);
  // Publishing a clip keeps the Studio's own refusal (MEDIA_C), a different reason.
  assert.equal(resolveIntent("Publică clipul", {}).steps[0].intent, "studio_publish");
});

test("M12-REF-02 effect class (S3-INT): sales_send is REFUSED from every source, typed or spoken, and the class never comes from the words alone", () => {
  assert.equal(INTENT_EFFECTS.sales_send, "none");
  assert.equal(classOfIntent("sales_send", INTENT_EFFECTS.sales_send), "REFUSED");
  for (const source of ["typed", "voice-local", "voice-provider", "document", "media-local"]) {
    assert.ok(refusalReason("REFUSED", source, { derivedOwnerSession: true }), source);
    const r = resolveIntent("Trimite oferta clientului", { source, projects: [] });
    assert.equal(r.steps.find((x) => x.intent === "sales_send").effectClass, "REFUSED", source);
  }
});

test("M12-REF-03 typos (S3-TYPO): no correction lands on a send, contact or publish verb — they are NEVER_TARGET, absent from the vocabulary, and no slip of any word is corrected to one", () => {
  for (const v of OUTREACH_VERBS) assert.ok(NEVER_TARGET.has(v), v);
  assert.deepEqual(TYPO_VOCAB.filter((w) => OUTREACH_VERBS.includes(w)), []);
  const outreach = new Set(OUTREACH_VERBS);
  for (const w of [...TYPO_VOCAB, ...OUTREACH_VERBS]) for (const s of slips(w)) assert.ok(!outreach.has(closest(s)), `${s} → ${closest(s)}`);
  // A misspelt send verb stays as said (never corrected into the act) and the resolver refuses it.
  for (const s of ["trimte oferta clientului", "contactaza-i", "publca oferta"]) {
    const r = correctTypos(s);
    assert.equal(r.text, s, s);
    assert.ok(!r.corrections.some((c) => outreach.has(c.to)), s);
    assert.equal(resolveIntent(s, {}).steps.some((x) => x.intent === "sales_send"), true, s);
  }
  // The offer nouns are understood with a slip („ofrta”) — toward the noun, never toward a verb.
  assert.equal(correctTypos("pregateste o ofrta").text, "pregateste o oferta");
  assert.ok(osaDistance("ofrta", "oferta") === 1);
});

test("M12-REF-04 intake (S3-INT, typed in the owner session over HTTP and the other sources in-process): refused with OUTREACH_DISABLED, nothing created; the noun „contact” is not refused", async (c) => {
  const t = await prepHub(c);
  await t.authenticate();
  const before = nothingCreated(t);
  for (const text of OUTREACH_SENTENCES.slice(0, 12)) {
    const r = await t.request("/api/owner/intent", { body: { text, source: "typed" } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const refused = r.json.results.filter((x) => x.intent === "sales_send");
    assert.equal(refused.length, 1, `${text}: ${JSON.stringify(r.json.results.map((x) => x.intent))}`);
    assert.equal(refused[0].refused, SALES_SEND_REASON, text);
    assert.equal(r.json.results.some((x) => x.opsPlan || x.plan), false, text);
  }
  // A provider transcript (the voice route), the owner's verified voice and a pasted document: the same refusal.
  for (const [ctx, source] of [[{ channel: "voice", actor: "voice" }, "voice-provider"], [{ channel: "test", actor: "test" }, "voice-local"], [{ channel: "test", actor: "test" }, "document"]]) {
    const r = await t.hub.intake.handle({ text: "Trimite oferta clientului", source }, ctx);
    const step = r.results.find((x) => x.intent === "sales_send");
    assert.ok(step?.refused, `${source}: ${JSON.stringify(r.results)}`);
    if (source !== "document") assert.equal(step.refused, SALES_SEND_REASON, source);
  }
  assert.deepEqual(nothingCreated(t), before, "nothing planned, kept, approved, started, sent or created");
  for (const text of ["Fă un formular de contact pentru site", "Actualizează datele de contact"]) {
    const r = await t.request("/api/owner/intent", { body: { text, source: "typed" } });
    assert.equal(r.status, 200);
    assert.ok(!r.json.results.some((x) => x.intent === "sales_send" || x.refused === SALES_SEND_REASON), text);
  }
  // „Nu trimite oferta” is a restriction said back, never a refusal and never silence.
  const neg = await t.request("/api/owner/intent", { body: { text: "Nu trimite oferta", source: "typed" } });
  assert.match(neg.json.results[0].message, /nu trimit mesaje/);
  // The owner's offer request with a send inside it: ONE card (the brief refuses the send words; they are no step) and the refusal.
  const mixed = await t.request("/api/owner/intent", { body: { text: `${SALES_REQUEST} și trimite-o clientului`, source: "typed" } });
  assert.equal(mixed.status, 200, JSON.stringify(mixed.json));
  const card = mixed.json.results.find((x) => x.opsPlan)?.opsPlan;
  assert.ok(card, JSON.stringify(mixed.json.results));
  assert.equal(card.kind, PREPARE_KIND);
  assert.ok(card.brief.refused.some((x) => x.code === "OUTREACH_DISABLED"));
  assert.deepEqual(t.hub.opsPlans.view(card.id).body.steps.map((s) => s.kind), ["sales.synthetic", "sales.research", "sales.qualify", "sales.proposal.draft"]);
  assert.equal(mixed.json.results.find((x) => x.intent === "sales_send").refused, SALES_SEND_REASON);
  t.assertPaths();
});

test("M12-REF-05 the intake's planner entry (choke point) and kept requests: an outreach request never reaches a planner, is never kept, never re-planned into work", async (c) => {
  const t = await prepHub(c);
  await t.authenticate();
  const called = [];
  const undo = ["engineering", "run", "studio_create"].map((kind) => t.hub.intake.registerPlanner(kind, async ({ text }) => { called.push({ kind, text }); return { kind: "message", text: "planificator de test" }; }));
  c.after(() => undo.forEach((u) => u()));
  const before = nothingCreated(t);
  for (const [kind, text] of [["engineering", "Trimite oferta către Atelierul Verde"], ["run", "Contactează-i pe cei de la service"], ["studio_create", "Publică oferta pe Facebook"],
    ["sales", "Trimite oferta"], ["sales", "Contactează clientul"], ["engineering", "Pregătește oferta și trimite-o clientului"]]) {
    for (const ctx of [{ channel: "voice", actor: "lega" }, { channel: "test", actor: "test" }]) {
      const r = await t.hub.intake.plan({ kind, text, source: ctx.channel === "voice" ? "voice-provider" : "typed" }, ctx);
      assert.equal(r.refused, SALES_SEND_REASON, `${kind}: ${text} → ${JSON.stringify(r)}`);
    }
  }
  assert.deepEqual(called, [], "no planner was called");
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM events WHERE type = 'intake.outreach_refused'"), 12);
  assert.deepEqual(nothingCreated(t), before);
  // A send without the Sales vocabulary keeps its meaning (P0R5-04): it reaches the planner.
  const probe = await t.hub.intake.plan({ kind: "engineering", text: "Trimite un mesaj de probă", source: "typed" }, { channel: "test", actor: "test" });
  assert.equal(probe.message, "planificator de test");
  assert.equal(called.length, 1);
  // A request kept before (or by any other path) that holds outreach words is never re-planned into work.
  for (const intent of ["engineering", "studio", "run"]) {
    assert.deepEqual(await t.hub.intake.replanRequest({ id: "wr_test", intent, text: "Trimite oferta clientului", projectId: "prj_none" }), { blocked: true }, intent);
  }
});

test("M12-REF-06 API, command bus and plans (S3-API, S3-CMD, S3-PLAN): the M12 draft is never sent; live collection is refused; plans refuse unknown and sending steps", async (c) => {
  const t = await prepHub(c);
  await t.authenticate();
  const { card, preparationId } = await proposePreparation(t);
  await confirmCard(t, card);
  assert.equal((await approveAwaited(t, t.hub.salesPreparations.get(preparationId))).status, 200);
  const done = await settlePreparation(t, preparationId);
  assert.equal(done.status, "READY", done.statusReason);
  const draft = t.hub.sales.latestDraft(done.opportunityId);
  assert.equal(draft.status, "DRAFT");
  // HTTP: in the owner session, without it, as an agent or a script — always refused, nothing written.
  for (const options of [{}, { sessionCookie: "" }, { headers: { "X-Hub-Channel": "agent" } }, { headers: { "X-Hub-Channel": "cli" } }]) {
    const r = await t.request(`/api/sales/drafts/${draft.id}/send`, { body: { idempotencyKey: `k-${Math.random()}` }, ...options });
    assert.equal(r.status, 403, JSON.stringify(r.json));
    if (!options.headers) assert.match(r.json.error.message, /OUTREACH_DISABLED/);
  }
  // In-process: every channel the bus knows refuses the send (no transport in M12; channels outside ui / test refused).
  for (const channel of ["test", "ui", "voice", "companion", "automation", "schedule", "agent", "cli"]) {
    await assert.rejects(t.hub.commands.dispatch({ type: "sales.draft.send", channel, actor: "test", payload: { draftId: draft.id, idempotencyKey: `k-${channel}` } }), (e) => /OUTREACH_DISABLED|cannot be issued|Canalul|delegare/i.test(e.message), channel);
  }
  // Live collection: refused over HTTP and as a plan's research step.
  const audits = countRows(t, "SELECT COUNT(*) AS n FROM sales_audits");
  const live = await t.request(`/api/sales/orgs/${done.orgId}/audit`, { body: { sourceKind: "live" } });
  assert.equal(live.status, 403, JSON.stringify(live.json));
  assert.match(live.json.error.message, /LIVE_COLLECTION_DISABLED/);
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM sales_audits"), audits);
  const steps = prepareSteps({ preparationId: "spp_live_ref", briefSha: "e".repeat(64) }).map((s) => (s.kind === "sales.research" ? { ...s, params: { ...s.params, mode: "live" } } : s));
  await assert.rejects(t.hub.opsPlans.propose({ kind: PREPARE_KIND, title: "Cercetare live", steps }), (e) => e.code === "LIVE_COLLECTION_DISABLED");
  // Plans: a sending step does not exist; an executor that would send is refused before any card exists.
  await assert.rejects(t.hub.opsPlans.propose({ kind: PREPARE_KIND, title: "Trimitere", steps: [{ kind: "sales.send", params: {} }] }), /Tip de pas necunoscut/);
  t.hub.executors["test.sender"] = { describe: () => ({ title: "Trimite", params: {}, ops: [{ op: "send" }], observed: [], transmitted: ["oferta"], outputs: [] }), run: async () => ({ result: {} }) };
  await assert.rejects(t.hub.opsPlans.propose({ kind: "test.send", title: "Trimite oferta", steps: [{ kind: "test.sender", params: {} }] }), (e) => e.code === "PLAN_REFUSED");
  // After both phases (DONE): nothing sent, contacted, accepted or handed off; the draft stays a draft.
  for (const table of ["sales_sends", "sales_contact_events", "sales_client_acceptances", "sales_handoffs"]) assert.equal(countRows(t, `SELECT COUNT(*) AS n FROM ${table}`), 0, table);
  assert.equal(t.hub.sales.getOpportunity(done.opportunityId).opportunity.status, "APPROVED_INTERNAL");
  assert.equal(t.hub.sales.latestDraft(done.opportunityId).status, "DRAFT");
  t.assertPaths();
});

const OFFER = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n";
const b64 = (list) => Buffer.from(JSON.stringify(list)).toString("base64url");
const replies = (t) => t.readLog("codex").filter((l) => l.toolReply).map((l) => ({ tool: l.tool, ok: l.toolReply.success, text: l.toolReply.contentItems?.[0]?.text || "" }));
const spoken = (t) => t.readLog("codex").filter((l) => l.spoke).map((l) => l.spoke);
/** A fully synthetic acceptance hub with the fixture Codex app-server, the owner enrolled (voice-first or legacy), Lega's consent given. */
async function legaHub(c, scenario, { voiceFirst = true } = {}) {
  const t = await acceptanceHub({ fakeProviders: { codex: "ok" } });
  c.after(async () => { await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); });
  const owner = await enrolOwner(t, { activatePolicy: voiceFirst });
  if (voiceFirst) await prepareLiveWithoutGrants(t.hub);
  else {
    await enableLive(t.hub, { provider: "codex" });
    t.hub.bus.transaction(() => t.hub.grants.create({ provider: "codex", projectId: t.hub.projects.hub().id, access: "read-only", maxAttempts: 2, maxDurationS: 600, ttlMinutes: 30, kind: "voice" }, "test"));
  }
  t.hub.bus.transaction(() => t.hub.settings.set("legaConsent", { version: LEGA_CONSENT_VERSION, confirmedAt: new Date().toISOString() }, "test"));
  t.hub.refreshCodexConfig();
  t.queue("codex", scenario);
  const s = voiceFirst
    ? (await t.hub.commands.dispatch({ type: "lega.session.start", channel: "owner", actor: `owner:${owner.session.id}`, ownerSession: owner.session, payload: { sdp: OFFER } })).result
    : (await t.hub.commands.dispatch({ type: "lega.session.start", channel: "ui", actor: "user", payload: { sdp: OFFER } })).result;
  await t.hub.commands.dispatch({ type: "lega.session.connected", channel: "ui", actor: "user", payload: { sessionId: s.sessionId } });
  return { t, owner, s };
}

test("M12-REF-07 Lega voice-first (S3-LEGA-1/2/4): request_work, propose_run, propose_mission and the owner's spoken words with a send are refused before any planner; nothing kept", async (c) => {
  const project = "Accept synthetic";
  const { t } = await legaHub(c, `lega-script:${b64([{ sleep: 700 },
    { tool: "request_work", args: { request: "Trimite oferta către Atelierul Verde", kind_hint: "engineering" } },
    { tool: "request_work", args: { request: "Trimite oferta către Atelierul Verde", kind_hint: "run" } },
    { tool: "request_work", args: { request: "Contactează-i mâine pe cei de la service" } },
    { tool: "propose_run", args: { project, provider: "codex", task: "Trimite oferta clientului pe e-mail" } },
    { tool: "propose_mission", args: { project, kind: "eng_feature", title: "Ofertă", objective: "Trimite oferta către client" } },
    { tool: "request_work", args: { request: "Trimite un mesaj de probă", kind_hint: "engineering" } },
    { say: "Trimite oferta clientului" }, { sleep: 1500 }, { tool: "hub_actions" }])}`);
  const called = [];
  t.hub.intake.registerPlanner("engineering", async ({ text }) => { called.push(text); return { kind: "message", text: "planificator de test" }; });
  await waitFor(() => t.readLog("codex").some((l) => l.scriptDone), 30000);
  const r = replies(t);
  const work = r.filter((x) => ["request_work", "propose_run", "propose_mission"].includes(x.tool));
  assert.equal(work.length, 6, JSON.stringify(r));
  for (const x of work.slice(0, 5)) {
    assert.equal(x.ok, false, x.text);
    assert.ok(x.text.startsWith(SALES_SEND_REASON), x.text);
    assert.ok(x.text.endsWith(LEGA_WORK_TAILS.nothing), x.text);
  }
  assert.deepEqual(called, ["Trimite un mesaj de probă"], "only the request without the Sales vocabulary reached the planner");
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM work_requests"), 0);
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM ops_plans"), 0);
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM missions"), 0);
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM approvals"), 0);
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM events WHERE type = 'lega.work_request' AND json_extract(payload_json, '$.code') = 'OUTREACH_DISABLED'"), 5);
  // The owner's own words through the bridge: the Hub says the refusal itself.
  await waitFor(() => spoken(t).some((x) => /OUTREACH_DISABLED/.test(x)), 10000);
  assert.ok(t.hub.lega.hubActions().some((a) => a.intents.includes("sales_send") && a.outcome === "refused"), JSON.stringify(t.hub.lega.hubActions()));
});

test("M12-REF-08 Lega legacy (S3-LEGA-3): propose_mission (also the outreach template) and propose_run with a send are refused before any card; no lega.propose_* command", async (c) => {
  const project = "Accept synthetic";
  const { t } = await legaHub(c, `lega-calls:${b64([
    { tool: "propose_mission", args: { project, kind: "outreach", title: "Ofertă pentru client", objective: "Trimite oferta către client și contactează-i" } },
    { tool: "propose_mission", args: { project, kind: "development", title: "Trimite oferta", objective: "Publică oferta pe site-ul firmei" } },
    { tool: "propose_run", args: { project, provider: "codex", task: "Contactează-i pe toți clienții" } }])}`, { voiceFirst: false });
  await waitFor(() => t.readLog("codex").some((l) => l.callsDone), 30000);
  assert.equal(t.hub.lega.state().voiceFirst, false);
  const r = replies(t).filter((x) => ["propose_mission", "propose_run"].includes(x.tool));
  assert.equal(r.length, 3, JSON.stringify(replies(t)));
  for (const x of r) { assert.equal(x.ok, false); assert.ok(x.text.startsWith(SALES_SEND_REASON), x.text); }
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM commands WHERE type IN ('lega.propose_mission','lega.propose_run')"), 0);
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM approvals"), 0);
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM missions"), 0);
});
