// M12 final review, group A (F17, C2, C3, C4, C5, the continuation intent, X1). A leading acknowledgement („Ok / Hai / Da, …”) is dropped
// before the Sales intents (F17). „Ce lipsește?” / „Arată-mi” only with an offer or in a Sales conversation: a clip's brief, a demo's
// preparation, a correction proposal or a project's estimate keep their earlier meaning (C4). The answers are about the NEWEST preparation
// — a card just proposed included — never an older offer (C3). The cockpit keeps the Hub's answer to „Ce lipsește?” / „Aprobă oferta” and
// offers the offer's screen as a button (C2). Lega's system knowledge knows the offers' dossiers and the offer flow (C5). „Continuă
// pregătirea ofertei” proposes ONE continuation card of the newest preparation that can continue, or the truthful refusal (the rearm
// first, nothing to continue). X1: the cockpit shows the rearm card only after the answer that carries its option. Pure tables boot
// nothing; every Hub is a fully synthetic acceptance hub (accept-helpers isolation; Office COM off; no model, nothing sent).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveIntent } from "../server/owner/intents.mjs";
import { settle } from "./accept-helpers.mjs";
import { prepHub, proposePreparation, confirmCard, approveAwaited, prepStatus, countRows, settlePreparation, salesCommand, SALES_REQUEST } from "./sales-helpers.mjs";
import { PREPARE_KIND } from "../server/sales/preparation.mjs";
import { salesNavigation, SALES_OPEN_LABEL } from "../web/src/lib/salesCockpit.js";
import { rearmBeforeNavigation } from "../web/src/lib/rearmLogic.js";
import { REARM_FIRST_HINT, NEVER_CONFIRMED_HINT } from "../server/sales/sales-answers.mjs";

const V2 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = (rel) => fs.readFileSync(path.join(V2, rel), "utf8");
const CTX = { projects: [{ id: "prj_pd", name: "ProDelivery", slug: "prodelivery" }], missions: [], departments: [], pendingEnvelopes: [], source: "typed" };
const intents = (text, extra = {}) => resolveIntent(text, { ...CTX, ...extra }).steps.map((s) => s.intent);

test("M12-FA-ANS-01 (F17, C4) the resolver: acknowledged Sales reads; non-Sales sentences keep their meaning; the context-only words count in a Sales conversation; the continuation intent", () => {
  for (const [s, intent] of [["Ok, arată-mi oferta", "sales_show"], ["Hai, arată-mi oferta", "sales_show"], ["Da, arată-mi oferta", "sales_show"], ["Ok, aprobă oferta", "sales_approve_talk"],
    ["Hai, aprobă oferta", "sales_approve_talk"], ["Bine, aprobă oferta", "sales_approve_talk"], ["Ok, ce lipsește din ofertă?", "sales_missing"], ["Ok. Arată-mi oferta.", "sales_show"],
    ["Ok, continuă pregătirea ofertei", "sales_continue"]]) {
    assert.deepEqual(intents(s), [intent], s);
  }
  // „Da, aprobă oferta” while a plan waits: a read, never a confirmation.
  const r = resolveIntent("Da, aprobă oferta", { ...CTX, pendingEnvelopes: [{ id: "env_x", title: "x" }], awaiting: "envelope_confirmation" });
  assert.deepEqual(r.steps.map((x) => x.intent), ["sales_approve_talk"]);
  // C4: the earlier meanings stay — a demo's preparation, a clip's brief, a correction, a project's estimate.
  for (const [s, expected] of [["Ce mai lipsește din pregătirea demo-ului?", ["unknown"]], ["Ce lipsește din brieful clipului?", ["unknown"]], ["Ce lipsește din propunerea de corectură?", ["unknown"]],
    ["Deschide devizul din ProDelivery", ["open_project"]], ["Aprobă propunerea de corectură", ["unknown"]], ["Aprobă propunerea", ["unknown"]], ["Ce lipsește din brief?", ["unknown"]],
    ["Continuă pregătirea", ["continue_work"]], ["Ce lipsește?", ["unknown"]], ["Fă o propunere de corectură pentru clip", ["unknown"]]]) {
    assert.deepEqual(intents(s), expected, s);
  }
  // In a Sales conversation the words that name the offer only by context are the offer's.
  for (const [s, intent] of [["Ce lipsește din brief?", "sales_missing"], ["Aprobă propunerea", "sales_approve_talk"], ["Continuă pregătirea", "sales_continue"], ["Pregătește continuarea", "sales_continue"],
    ["Ce lipsește?", "sales_missing"]]) assert.deepEqual(intents(s, { salesContext: true }), [intent], `${s} (Sales conversation)`);
  assert.deepEqual(intents("Ce lipsește din brieful clipului?", { salesContext: true }), ["unknown"], "a clip's brief stays a clip's");
  // Last review round RR9: a leading acknowledgement is dropped before the Sales-context reads too — still a read, never a confirmation.
  for (const [s, intent] of [["Ok, ce lipsește?", "sales_missing"], ["Ok, ce lipsește din brief?", "sales_missing"], ["Ok, continuă pregătirea", "sales_continue"],
    ["Da, aprobă propunerea", "sales_approve_talk"], ["Sigur, ce lipsește?", "sales_missing"]]) assert.deepEqual(intents(s, { salesContext: true }), [intent], `${s} (Sales conversation)`);
  assert.deepEqual(resolveIntent("Da, aprobă propunerea", { ...CTX, salesContext: true, pendingEnvelopes: [{ id: "env_x", title: "x" }], awaiting: "envelope_confirmation" }).steps.map((x) => x.intent),
    ["sales_approve_talk"], "never a confirmation");
  assert.deepEqual(intents("Ok, ce lipsește?"), ["unknown"], "outside a Sales conversation it keeps its meaning");
  // The continuation: the offer named (or the Sales conversation); a bare „Continuă” keeps resuming a stopped plan; a new request is a new card.
  for (const s of ["Continuă pregătirea ofertei", "Reia oferta", "Reia lucrul la ofertă", "Pregătește continuarea ofertei", "Pregătește din nou oferta", "Continuă cu oferta"]) assert.deepEqual(intents(s), ["sales_continue"], s);
  assert.deepEqual(intents("Continuă"), ["ops_continue"]);
  assert.deepEqual(intents("Pregătește din nou o ofertă pentru un service auto din Cluj"), ["sales_prepare"], "a new request names its client: a new card");
  assert.equal(resolveIntent("Continuă pregătirea ofertei", CTX).steps[0].effectClass, "BOUNDED_WORKFLOW", "a proposal only");
});

test("M12-FA-ANS-02 (C3 + continuation) the answers are about the newest preparation (a card just proposed included); „Continuă pregătirea ofertei” → ONE continuation card of the newest one that can continue, or the truthful answer", async (c) => {
  const t = await prepHub(c);
  await t.authenticate();
  const say = async (text) => { const r = await t.request("/api/owner/intent", { body: { text, source: "typed" } }); assert.equal(r.status, 200, JSON.stringify(r.json)); return r.json.results; };
  assert.match((await say("Continuă pregătirea ofertei"))[0].message, /Nu am nicio pregătire de ofertă de continuat/);
  // A: confirmed, waiting for the owner's approval of its offer.
  const a = await proposePreparation(t);
  await confirmCard(t, a.card);
  assert.equal(prepStatus(t, a.preparationId), "WAITING_OWNER");
  const nothing = await say("Continuă pregătirea ofertei");
  assert.match(nothing[0].message, /Nu am ce continua/);
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM ops_plans WHERE status = 'PROPOSED'"), 0, "no card for a preparation that is not stopped");
  // B: a new card (PLANNED). „Ce lipsește?” right after it is about B — its brief and its confirmation — never A's offer.
  const cardB = (await say("pregătește o ofertă pentru un cabinet dentar din Iași care vrea programări online")).find((x) => x.opsPlan).opsPlan;
  const missing = (await say("Ce lipsește?"))[0];
  assert.equal(missing.intent, "sales_missing");
  assert.equal(missing.sales.preparationId, cardB.preparationId);
  assert.match(missing.message, /Confirmarea planului de pregătire/);
  assert.doesNotMatch(missing.message, new RegExp(t.hub.salesPreparations.get(a.preparationId).awaited.proposalId), "never A's offer as B's");
  const shown = (await say("Arată-mi oferta"))[0];
  assert.equal(shown.sales.preparationId, cardB.preparationId);
  assert.match(shown.message, /Oferta nu există încă/);
  const approve = (await say("Aprobă oferta"))[0];
  assert.equal(approve.sales.preparationId, cardB.preparationId);
  assert.ok(approve.message.includes("O ofertă mai veche") && approve.message.includes(t.hub.salesPreparations.get(a.preparationId).awaited.proposalSha), "the older waiting offer is named as the older one");
  const legaText = t.hub.salesAnswers.legaText();
  assert.match(legaText, /planul așteaptă confirmarea ta.*Oferta nu există încă/, "Lega's read is about B too");
  assert.ok(!legaText.includes(t.hub.salesPreparations.get(a.preparationId).awaited.proposalId), legaText);
  // A becomes STALE (new evidence): „Continuă pregătirea ofertei” → ONE continuation card for A (the newest one that CAN continue), on its root.
  const prepA = t.hub.salesPreparations.get(a.preparationId);
  await salesCommand(t, "sales.evidence.add", { subjectType: "org", subjectId: prepA.orgId, claim: "telefon", value: "0700000000", label: "USER_PROVIDED", sourceKind: "manual", sourceRef: "proprietar", dataKind: "STATEMENT" });
  assert.equal(prepStatus(t, a.preparationId), "STALE");
  const plansBefore = countRows(t, "SELECT COUNT(*) AS n FROM ops_plans");
  const cont = await say("Continuă pregătirea ofertei");
  assert.equal(cont.length, 1);
  const card = cont[0].opsPlan;
  assert.ok(card?.id, JSON.stringify(cont));
  assert.equal(card.kind, PREPARE_KIND);
  assert.equal(card.preparationId, a.preparationId);
  assert.equal(card.continues, true);
  assert.equal(t.hub.opsPlans.view(card.id).steps[0].params.continues.rootPlanId, prepA.rootPlanId, "the same root plan");
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM ops_plans"), plansBefore + 1, "ONE card");
  assert.equal(prepStatus(t, a.preparationId), "STALE", "nothing runs before the owner's confirmation");
  assert.equal(t.hub.opsPlans.view(cardB.id).status, "PROPOSED", "B's own card is untouched");
  // The owner confirms it once: A continues on the same company (no duplicate company or opportunity).
  const orgs = countRows(t, "SELECT COUNT(*) AS n FROM sales_orgs");
  await confirmCard(t, { ...card });
  const done = await settlePreparation(t, a.preparationId);
  assert.equal(done.status, "WAITING_OWNER", done.statusReason);
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM sales_orgs"), orgs, "no new synthetic company");
  // Through the intake's planner entry (Lega's request_work): the same continuation answer.
  const lega = await t.hub.intake.plan({ kind: "sales", text: "Continuă pregătirea ofertei", args: { continue: true }, source: "voice-provider" }, { channel: "voice", actor: "lega" });
  assert.match(lega.message, /Nu am ce continua/);
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM sales_sends"), 0);
  t.assertPaths();
});

test("M12-FA-ANS-03 (continuation × Stop All) a preparation „Oprește tot” stopped: „Continuă pregătirea ofertei” says the rearm comes first and shows the rearm card; no card", async (c) => {
  const t = await prepHub(c);
  await t.authenticate();
  const { card, preparationId } = await proposePreparation(t);
  await confirmCard(t, card);
  await t.hub.commands.dispatch({ type: "system.stop_all", payload: { reason: "Oprește tot (test)" }, channel: "test", actor: "test" });
  await settle(); await settle();
  assert.equal(prepStatus(t, preparationId), "STOPPED");
  const plans = countRows(t, "SELECT COUNT(*) AS n FROM ops_plans");
  const r = await t.request("/api/owner/intent", { body: { text: "Continuă pregătirea ofertei", source: "typed" } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const res = r.json.results[0];
  assert.match(res.message, /Oprește tot.*redeschizi poarta/);
  assert.ok(res.gateRearm || res.gateStopped, "the cockpit's rearm card (or why not yet) comes with the answer");
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM ops_plans"), plans, "no continuation card while the Stop All holds the gate");
});

test("M12-FA-ANS-04 (C5) Lega's system knowledge: the offer flow is a capability (local, never sent), „Unde e dosarul ofertei?” names the offers' dossier, a stopped preparation is listed as blocked", async (c) => {
  const t = await prepHub(c);
  await t.authenticate();
  const caps = await t.hub.knowledge.answer("capabilities");
  assert.match(caps.text, /Pregătirea ofertelor/);
  assert.doesNotMatch(JSON.stringify(caps.data), /publicarea vine în M12/);
  const { card, preparationId } = await proposePreparation(t);
  await confirmCard(t, card);
  const prep = t.hub.salesPreparations.get(preparationId);
  assert.equal((await approveAwaited(t, prep)).status, 200);
  const done = await settlePreparation(t, preparationId);
  assert.equal(done.status, "READY", done.statusReason);
  const dossier = t.hub.salesPreparations.forOpportunity(done.opportunityId).dossiers[0];
  const r = await t.request("/api/owner/intent", { body: { text: "Unde e dosarul ofertei?", source: "typed" } });
  assert.equal(r.status, 200);
  const res = r.json.results[0];
  assert.equal(res.intent, "system_knowledge");
  assert.ok(res.message.includes(dossier.folder), res.message);
  assert.ok(res.message.includes(`${path.sep}vanzari${path.sep}`), "the offers' place under the exports folder");
  assert.match(res.message, /nu se trimit/);
  assert.equal(res.knowledge.screen, `#/sales?tab=opp&id=${encodeURIComponent(done.opportunityId)}`);
  assert.deepEqual(resolveIntent("Unde sunt ofertele?", CTX).steps.map((s) => [s.intent, s.args.topic, s.args.about]), [["system_knowledge", "locations", "offers"]]);
  // A stopped preparation is one of the blocked things.
  const second = await proposePreparation(t, "pregătește o ofertă pentru o florărie din Iași care vrea un magazin online");
  await confirmCard(t, second.card);
  await t.hub.commands.dispatch({ type: "system.stop_all", payload: { reason: "Oprește tot (test)" }, channel: "test", actor: "test" });
  await settle(); await settle();
  assert.equal(prepStatus(t, second.preparationId), "STOPPED");
  const blocked = await t.hub.knowledge.answer("blocked");
  assert.ok(blocked.text.includes(second.preparationId) && /Continuă pregătirea ofertei/.test(blocked.text), blocked.text);
});

test("M12-FA-ANS-05 (C2, X1) the cockpit: only „Arată-mi oferta” navigates; „Ce lipsește?” / „Aprobă oferta” keep the answer with the offer's screen as a button; the rearm card follows the answer that carries its option", () => {
  const path0 = "/sales?tab=opp&id=opp_1";
  assert.deepEqual(salesNavigation([{ intent: "sales_show", navigate: path0, message: "Oferta" }]), { go: path0, links: [] });
  assert.deepEqual(salesNavigation([{ intent: "sales_missing", navigate: path0, message: "Din cererea ta lipsesc: bugetul." }]), { go: null, links: [{ path: path0, label: SALES_OPEN_LABEL }] });
  assert.deepEqual(salesNavigation([{ intent: "sales_approve_talk", navigate: path0, message: "Eu nu aprob oferta" }]), { go: null, links: [{ path: path0, label: SALES_OPEN_LABEL }] });
  assert.deepEqual(salesNavigation([{ intent: "sales_show", navigate: path0, message: "x" }, { intent: "sales_missing", navigate: path0, message: "y" }]), { go: null, links: [{ path: path0, label: SALES_OPEN_LABEL }] },
    "a sentence that also asks what is missing keeps the answer");
  assert.deepEqual(salesNavigation([{ intent: "open_project", navigate: "/cockpit/p" }]), { go: null, links: [] });
  const cockpit = source("web/src/screens/Lega.jsx");
  assert.match(cockpit, /const salesNav = salesNavigation\(res\.results\);/);
  assert.match(cockpit, /blocker, links: salesNav\.links \}\]\);\n\s*if \(salesNav\.go\) go\(salesNav\.go\);/);
  assert.match(cockpit, /\{m\.links\?\.length > 0 && <span className="row wrap">\{m\.links\.map\(\(l\) => <button key=\{l\.path\} className="btn sm" onClick=\{\(\) => go\(l\.path\)\}>\{l\.label\}<\/button>\)\}<\/span>\}/);
  assert.doesNotMatch(cockpit, /if \(r\.navigate\?\.startsWith\("\/sales"\)\) go\(r\.navigate\);/);
  // X1: the slot (app store, rendered at once) is filled only from an effect that runs after the conversation shows the answer.
  assert.match(cockpit, /pendingRearm\.current = rearmFx\.action === "set" \|\| rearmFx\.action === "clear" \? rearmFx : null;/);
  assert.match(cockpit, /useEffect\(\(\) => \{\n\s*const fx = pendingRearm\.current;[\s\S]{0,400}\}, \[conversation\]\);/);
  assert.doesNotMatch(cockpit, /if \(rearmFx\.action === "set"\) setRearmSlot/, "never set straight from the answer handler");
});

// ---------------------------------------------------------------- M12 last review round (RR7, RR8, RR12, RR13, RC3, RC6)
/** Holds the research step of a confirmed card until released (the plan can then be paused while its preparation is PREPARING). */
function holdResearch(t) {
  let release;
  const gate = new Promise((r) => { release = r; });
  const state = { called: false, release: () => release() };
  const original = t.hub.sales.fixturePage;
  t.hub.sales.fixturePage = async (...args) => { state.called = true; await gate; return original(...args); };
  state.restore = () => { t.hub.sales.fixturePage = original; };
  return state;
}

test("M12-FA-ANS-06 (RR7, RR12) the Sales answers and Lega's knowledge honour the server's flags: a preparation a Stop All still holds says the rearm comes first (with the card); a card never confirmed is never offered a continuation", async (c) => {
  let now = Date.now();
  const t = await prepHub(c, { clock: () => new Date(now) });
  await t.authenticate();
  const say = async (text) => { const r = await t.request("/api/owner/intent", { body: { text, source: "typed" } }); assert.equal(r.status, 200, JSON.stringify(r.json)); return r.json.results; };
  const { card, preparationId } = await proposePreparation(t);
  await confirmCard(t, card);
  await t.hub.commands.dispatch({ type: "system.stop_all", payload: { reason: "Oprește tot (test)" }, channel: "test", actor: "test" });
  await settle(); await settle();
  assert.equal(prepStatus(t, preparationId), "STOPPED");
  assert.ok(t.hub.salesPreparations.stopHold(t.hub.salesPreparations.get(preparationId)), "the Stop All still holds it");
  for (const text of ["Arată-mi oferta", "Ce lipsește?"]) {
    const r = (await say(text))[0];
    assert.equal(r.sales.preparationId, preparationId, text);
    assert.ok(r.message.includes(REARM_FIRST_HINT), `${text}: the rearm comes first — ${r.message}`);
    assert.equal(r.sales.waitsForRearm, true, text);
    assert.ok(r.gateRearm || r.gateStopped, `${text}: the cockpit's rearm card (or why not yet) comes with the answer`);
  }
  assert.ok(t.hub.salesAnswers.legaText().includes(REARM_FIRST_HINT), "Lega's read says the rearm comes first");
  const blocked = await t.hub.knowledge.answer("blocked");
  assert.ok(blocked.text.includes(preparationId) && /întâi redeschizi poarta din cockpit/.test(blocked.text), blocked.text);
  // A card proposed and never confirmed, expired: never offered a continuation (answers), never listed as continuable (knowledge).
  const never = await proposePreparation(t, "pregătește o ofertă pentru o florărie din Sibiu care vrea un magazin online");
  now += 16 * 60000;
  for (let i = 0; i < 3; i += 1) { t.hub.salesPreparations.tick?.(); await settle(); }
  if (prepStatus(t, never.preparationId) !== "EXPIRED") {
    await t.authenticate({ reauth: true });
    await t.request(`/api/ops/plans/${never.card.id}/confirm`, { body: { nonce: never.card.nonce, displayedHash: never.card.hash } });
    for (let i = 0; i < 3; i += 1) await settle();
  }
  assert.equal(prepStatus(t, never.preparationId), "EXPIRED");
  const neverView = t.hub.salesPreparations.get(never.preparationId);
  assert.equal(t.hub.salesPreparations.isContinuable(neverView), false, "R18: never confirmed");
  assert.equal(t.hub.salesAnswers.nextOf(neverView).text, NEVER_CONFIRMED_HINT);
  const blocked2 = await t.hub.knowledge.answer("blocked");
  assert.ok(!blocked2.text.includes(never.preparationId), `a never-confirmed card is not listed as blocked / continuable: ${blocked2.text}`);
  assert.ok(!(blocked2.data.blocked.offers || []).some((x) => x.id === never.preparationId));
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM sales_sends"), 0);
});

test("M12-FA-ANS-07 (RR8) after the owner continues an OLDER preparation, „Ce lipsește?” / „Arată-mi oferta” / „Aprobă oferta” are about it, not about a newer unrelated offer", async (c) => {
  const t = await prepHub(c);
  await t.authenticate();
  const say = async (text) => { const r = await t.request("/api/owner/intent", { body: { text, source: "typed" } }); assert.equal(r.status, 200, JSON.stringify(r.json)); return r.json.results; };
  const a = await proposePreparation(t);
  await confirmCard(t, a.card);
  const prepA = t.hub.salesPreparations.get(a.preparationId);
  await salesCommand(t, "sales.evidence.add", { subjectType: "org", subjectId: prepA.orgId, claim: "telefon", value: "0700000000", label: "USER_PROVIDED", sourceKind: "manual", sourceRef: "proprietar", dataKind: "STATEMENT" });
  assert.equal(prepStatus(t, a.preparationId), "STALE");
  // B: a newer, unrelated offer (confirmed, waiting for the owner).
  const b = await proposePreparation(t, "pregătește o ofertă pentru un cabinet dentar din Iași care vrea programări online");
  await confirmCard(t, b.card);
  assert.equal(prepStatus(t, b.preparationId), "WAITING_OWNER");
  // The owner continues A: the answers that follow are about A.
  const cont = (await say("Continuă pregătirea ofertei"))[0];
  assert.equal(cont.opsPlan?.preparationId, a.preparationId, JSON.stringify(cont).slice(0, 300));
  const missing = (await say("Ce lipsește?"))[0];
  assert.equal(missing.sales.preparationId, a.preparationId, "about the preparation the owner is working on");
  await confirmCard(t, { ...cont.opsPlan });
  const done = await settlePreparation(t, a.preparationId);
  assert.equal(done.status, "WAITING_OWNER", done.statusReason);
  for (const text of ["Arată-mi oferta", "Aprobă oferta"]) {
    const r = (await say(text))[0];
    assert.equal(r.sales.preparationId, a.preparationId, `${text}: ${r.message}`);
    assert.ok(r.message.includes(t.hub.salesPreparations.get(a.preparationId).awaited.proposalSha), `${text}: A's exact offer`);
  }
  assert.ok(t.hub.salesAnswers.legaText().includes(t.hub.salesPreparations.get(a.preparationId).awaited.proposalId), "Lega's read: the most recently changed preparation (A)");
});

test("M12-FA-ANS-08 (RC3, RC6) a preparation whose plan is paused: „Continuă pregătirea ofertei” says how it resumes (no new card, never „nu am ce continua”); after „Oprește tot” the plan's „Continuă” answers with the rearm hold and the card, never a bare error", async (c) => {
  const t = await prepHub(c);
  await t.authenticate();
  const say = async (text) => { const r = await t.request("/api/owner/intent", { body: { text, source: "typed" } }); assert.equal(r.status, 200, JSON.stringify(r.json)); return r.json.results; };
  const { card, preparationId } = await proposePreparation(t);
  const hold = holdResearch(t);
  c.after(() => hold.restore());
  assert.equal((await t.request(`/api/ops/plans/${card.id}/confirm`, { body: { nonce: card.nonce, displayedHash: card.hash } })).status, 200);
  for (let i = 0; i < 200 && !hold.called; i += 1) await settle();
  assert.ok(hold.called, "the research step runs");
  t.hub.opsPlans.pause(card.id, { reason: "Pauză", actor: "owner" });
  hold.release();
  await t.hub.opsPlans.idle(card.id);
  await settle(); await settle();
  assert.equal(prepStatus(t, preparationId), "PREPARING");
  assert.equal(t.hub.opsPlans.view(card.id).status, "PAUSED");
  const plans = countRows(t, "SELECT COUNT(*) AS n FROM ops_plans");
  const r1 = (await say("Continuă pregătirea ofertei"))[0];
  assert.equal(r1.intent, "sales_continue");
  assert.doesNotMatch(r1.message, /Nu am ce continua/);
  assert.match(r1.message, /nu are nevoie de un card nou.*îl reiei cu „Continuă”/, r1.message);
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM ops_plans"), plans, "no new card");
  assert.match((await say("Ce lipsește din ofertă?"))[0].message, /îl reiei cu „Continuă”/, "the Sales read says it too");
  // „Oprește tot” while it stands paused: the plan's own „Continuă” is refused by its resume guard → the existing rearm hold with the card.
  await t.hub.commands.dispatch({ type: "system.stop_all", payload: { reason: "Oprește tot (test)" }, channel: "test", actor: "test" });
  await settle(); await settle();
  const r2 = await say("Continuă");
  const res = r2.find((x) => x.intent === "ops_continue");
  assert.ok(res, JSON.stringify(r2).slice(0, 400));
  assert.equal(res.error, undefined, `never a bare step error: ${JSON.stringify(res.error)}`);
  assert.equal(res.stopHold?.code, "GATE_REARM_REQUIRED", JSON.stringify(res).slice(0, 400));
  assert.match(res.message, /redeschizi poarta/);
  assert.ok(res.gateRearm || res.gateStopped, "the rearm card (or why not yet) comes with it");
  assert.equal(t.hub.opsPlans.view(card.id).status, "PAUSED", "nothing resumed");
  // „Continuă pregătirea ofertei” now: the rearm first (the card), still no new card.
  const r3 = (await say("Continuă pregătirea ofertei"))[0];
  assert.match(r3.message, /poarta e încă oprită/);
  assert.ok(r3.gateRearm || r3.gateStopped);
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM ops_plans"), plans);
});

test("M12-FA-ANS-09 (RR13) an answer that opens another project's cockpit puts its rearm slot in the app store before the navigation; the same screen keeps X1's order", () => {
  assert.equal(rearmBeforeNavigation([{ intent: "open_project", navigate: "/cockpit/prj_b" }, { intent: "gate_rearm", gateRearm: { kind: "gate_rearm" } }], null), true, "from the start cockpit");
  assert.equal(rearmBeforeNavigation([{ navigate: "/cockpit/prj_b" }], "prj_a"), true, "to another project");
  assert.equal(rearmBeforeNavigation([{ navigate: "/cockpit/prj_a" }], "prj_a"), false, "the same cockpit: X1's order");
  assert.equal(rearmBeforeNavigation([{ navigate: "/sales?tab=opp&id=x" }, { gateRearm: {} }], "prj_a"), false);
  assert.equal(rearmBeforeNavigation([], null), false);
  assert.deepEqual(resolveIntent("Deschide ProDelivery. Redeschide poarta.", CTX).steps.map((x) => x.intent), ["open_project", "gate_rearm"]);
  const cockpit = source("web/src/screens/Lega.jsx");
  // Before the navigation loop, the pending slot is applied when the answer leaves this cockpit; X1's effect stays for the same screen.
  assert.match(cockpit, /pendingRearm\.current = rearmFx\.action === "set" \|\| rearmFx\.action === "clear" \? rearmFx : null;\n[\s\S]{0,400}if \(pendingRearm\.current && rearmBeforeNavigation\(res\.results, pid\)\) \{ const fx = pendingRearm\.current; pendingRearm\.current = null; applyRearmFx\(fx\); \}\n\s*for \(const r of res\.results\) \{/);
});
