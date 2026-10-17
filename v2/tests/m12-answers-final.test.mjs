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
