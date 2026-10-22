// M14: the „Birou intern” records READ from L3ga — „Arată dosarul de pornire OPS-0001”, „Arată cazul de suport SUP-0001”, „Arată devizul
// DVZ-0001”, the number alone, „Ce lipsește din devizul …?” — open the EXISTING record with its state and next action, on fully synthetic
// acceptance hubs. A read never creates a record, a card, a document or an export; a number not found offers the records there are; the
// support request keeps no unmatched quote, and a case opened before M14 is still found when the same sentence is said again.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { acceptanceHub, settle, seedReady } from "./accept-helpers.mjs";
import { prepHub, proposePreparation, confirmCard, approveAwaited, settlePreparation, salesCommand, countRows } from "./sales-helpers.mjs";
import { hashCanonical } from "../server/core/canonical.mjs";
import { supportRequestOf, stripUnmatchedQuotes } from "../server/owner/planners/desk.mjs";
import { deskInternalNo } from "../server/desk/desk-answers.mjs";
import { resolveIntent } from "../server/owner/intents.mjs";

const SERVICE = {
  name: "Programări online pe site", description: "Un modul de programări pe site-ul service-ului auto (sintetic).",
  scope: ["Pagină de programare pe site", "Lista programărilor"], exclusions: ["Plata online"], materials: ["Lista serviciilor", "Programul de lucru"],
  tags: ["programari"], price: { status: "NOT_CONFIGURED" }, leadTime: { status: "NOT_CONFIGURED" }, active: true,
};
const FLOW = { desk_ops_prepare: "ops_start", desk_support_prepare: "support_case", desk_finance_prepare: "finance_doc" };
const propose = (t, text, intent) => t.hub.intake.plan({ kind: "desk", text, source: "typed", args: { flow: FLOW[intent] } }, { channel: "test", actor: "test", ownerSession: null });
async function settleRecord(t, id) { for (let i = 0; i < 6; i += 1) { await settle(); await t.hub.desk.idle(id); } return t.hub.desk.get(id); }
const say = async (t, text, extra = {}) => { const r = await t.request("/api/owner/intent", { body: { text, source: "typed", ...extra } }); assert.equal(r.status, 200, JSON.stringify(r.json)); return r.json; };
/** Everything a read must leave as it was: records, cards, documents, exports, decisions, sends. */
const footprint = (t) => Object.fromEntries(["desk_records", "desk_artifacts", "desk_exports", "desk_plan_ops", "ops_plans", "approvals", "agent_runs", "sales_sends", "factory_missions"]
  .map((table) => [table, countRows(t, `SELECT COUNT(*) AS n FROM ${table}`)]).concat([["desk_events", countRows(t, "SELECT COUNT(*) AS n FROM events WHERE type LIKE 'desk.%'")],
    ["record_versions", countRows(t, "SELECT COALESCE(SUM(version), 0) AS n FROM desk_records")]]));

async function approvedOfferHub(c) {
  const t = await prepHub(c);
  await t.authenticate();
  await salesCommand(t, "sales.service.save", SERVICE);
  const { card, preparationId } = await proposePreparation(t);
  await confirmCard(t, card);
  assert.equal((await approveAwaited(t, t.hub.salesPreparations.get(preparationId))).status, 200);
  const prep = await settlePreparation(t, preparationId);
  assert.equal(prep.status, "READY", prep.statusReason);
  return t;
}
async function supportHub(c) {
  const t = await acceptanceHub({ seedProject: true });
  c.after(() => t.cleanup());
  t.exportsDir = path.join(t.root, "exports");
  t.hub.bus.transaction(() => t.hub.settings.set("mediaPolicy", { ...(t.hub.settings.get("mediaPolicy") || {}), exportsDir: t.exportsDir }, "test", "Folderul de exporturi al testului"));
  const seeded = await seedReady(t);
  t.hub.db.prepare("UPDATE factory_bundles SET status = 'OWNER_ACCEPTED' WHERE id = ?").run(seeded.bundleId);
  await t.authenticate();
  return t;
}

test("M14-READ-01 „Arată dosarul de pornire OPS-0001”, „Deschide … OPS-0001”, „Arată devizul DVZ-0001”, „Ce lipsește din devizul DVZ-0001?”, the number alone: the EXISTING record told and opened (state, decision waiting, next action); nothing created, continued or written", async (c) => {
  const t = await approvedOfferHub(c);
  const ops = await propose(t, "Pregătește dosarul de pornire a proiectului din oferta aprobată", "desk_ops_prepare");
  await confirmCard(t, ops.opsPlan);
  const opsRec = await settleRecord(t, ops.opsPlan.recordId);
  assert.equal(opsRec.status, "READY", opsRec.statusReason);
  const fin = await propose(t, "Pregătește devizul din oferta aprobată", "desk_finance_prepare");
  await confirmCard(t, fin.opsPlan);
  const finRec = await settleRecord(t, fin.opsPlan.recordId);
  assert.equal(finRec.status, "WAITING_OWNER", finRec.statusReason);
  assert.deepEqual([opsRec.internalNo, finRec.internalNo], ["OPS-0001", "DVZ-0001"]);
  const before = footprint(t);
  const shows = [
    ["Arată dosarul de pornire OPS-0001", opsRec, /Dosarul de pornire a proiectului OPS-0001 \(SINTETIC\): pregătită\..*Următoarea acțiune: Ceri clientului/],
    ["Deschide dosarul de pornire OPS-0001", opsRec, /OPS-0001/],
    ["OPS-0001", opsRec, /OPS-0001/],
    ["Arată devizul DVZ-0001", finRec, /Devizul DVZ-0001 \(SINTETIC\): așteaptă decizia ta\..*„Aprob devizul intern” pe documentul v1/],
    ["Ok, arată-mi devizul dvz 1", finRec, /DVZ-0001/],
    ["Ce lipsește din devizul DVZ-0001?", finRec, /Următoarea acțiune:/],
    ["Arată dosarul de pornire DVZ-0001", finRec, /^DVZ-0001 e devizul, nu dosarul de pornire\./],
    ["Arată dosarul de pornire", opsRec, /OPS-0001/],
  ];
  for (const [text, rec, words] of shows) {
    const out = await say(t, text);
    const r = out.results.find((x) => x.intent === "desk_show");
    assert.ok(r, `${text}: ${JSON.stringify(out.results).slice(0, 400)}`);
    assert.equal(r.desk?.recordId, rec.id, text);
    assert.match(r.message, words, `${text}: ${r.message}`);
    assert.ok(!r.opsPlan && !r.plan && !r.sales, `${text}: a read shows no card and no offer`);
  }
  const both = await say(t, "Arată dosarul de pornire OPS-0001 și devizul DVZ-0001");
  assert.deepEqual(both.results.map((x) => x.desk?.internalNo), ["OPS-0001", "DVZ-0001"]);
  assert.deepEqual(footprint(t), before, "a read writes nothing: no record, card, document, export, decision or desk event");
});

test("M14-READ-02 a number not found: the records there are offered as choices; a choice opens that record; no support case yet: said, never created", async (c) => {
  const t = await approvedOfferHub(c);
  const ops = await propose(t, "Pregătește dosarul de pornire a proiectului din oferta aprobată", "desk_ops_prepare");
  await confirmCard(t, ops.opsPlan);
  const opsRec = await settleRecord(t, ops.opsPlan.recordId);
  const before = footprint(t);
  const missing = await say(t, "Arată dosarul de pornire OPS-0009");
  const r = missing.results[0];
  assert.equal(r.intent, "desk_show");
  assert.match(r.message, /^Nu găsesc OPS-0009\. Am doar dosare de pornire: OPS-0001/);
  assert.deepEqual(r.clarification.options.map((o) => o.id), [opsRec.id]);
  assert.equal(r.clarification.forIntent, "desk_show");
  const chosen = await say(t, "", { choice: { forIntent: "desk_show", id: opsRec.id } });
  assert.equal(chosen.results[0].desk?.recordId, opsRec.id);
  const none = await say(t, "Arată cazul de suport SUP-0001");
  assert.match(none.results[0].message, /^Nu găsesc SUP-0001 și nu am încă cazuri de suport în Birou intern; nu creez nimic/);
  assert.equal(none.results[0].clarification, undefined);
  const noneKind = await say(t, "Arată devizul");
  assert.match(noneKind.results[0].message, /^Nu am încă devize în Birou intern\. Nu creez nimic/);
  assert.deepEqual(footprint(t), before, "nothing written by the reads");
});

test("M14-READ-03 Support: „Deschide cazul de suport SUP-0001” opens the case (M13 made a NEW case „SUP-0001”); the owner's quoted sentence keeps no unmatched quote; a case opened with M13's text (stray quote) is still the same case when said again", async (c) => {
  const t = await supportHub(c);
  const quoted = "„Caz de suport pentru Accept synthetic: un client (sintetic) întreabă dacă un nume format doar din spații este acceptat?”";
  const r = await propose(t, quoted, "desk_support_prepare");
  assert.ok(r.opsPlan?.recordId, JSON.stringify(r).slice(0, 500));
  await confirmCard(t, r.opsPlan);
  const rec = await settleRecord(t, r.opsPlan.recordId);
  assert.equal(rec.request, "un client (sintetic) întreabă dacă un nume format doar din spații este acceptat?", "no stray closing quote");
  assert.equal(rec.internalNo, "SUP-0001");
  const before = footprint(t);
  for (const text of ["Deschide cazul de suport SUP-0001", "Arată cazul de suport SUP-0001", "Arată cazul de suport"]) {
    const out = await say(t, text);
    assert.equal(out.results[0].intent, "desk_show", text);
    assert.equal(out.results[0].desk?.recordId, rec.id, text);
    assert.match(out.results[0].message, /Cazul de suport SUP-0001 \(SINTETIC\)/);
  }
  assert.deepEqual(footprint(t), before, "no new case from a read");
  // A case M13 opened kept its text with the stray quote and that text's SHA: the same sentence again is the same case (no second record).
  const m13Text = "un client (sintetic) întreabă dacă un nume format doar din spații este acceptat?”";
  const source = { ...rec.source, requestSha: hashCanonical(m13Text) };
  t.hub.db.prepare("UPDATE desk_records SET request_text = ?, source_json = ? WHERE id = ?").run(m13Text, JSON.stringify(source), rec.id);
  const again = await propose(t, quoted, "desk_support_prepare");
  assert.equal(again.opsPlan, undefined, JSON.stringify(again).slice(0, 400));
  assert.match(String(again.message || again.text || ""), /SUP-0001 există deja/);
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM desk_records"), 1, "the M13 case is found, not doubled");
  assert.equal(t.hub.desk.get(rec.id).request, m13Text, "the existing case's text and history are kept as written");
});

test("M14-READ-PURE the words: reads before preparations and Sales; „deschide cazul de suport pentru X: …” stays a new case; the numbers normalized; quotes stripped only when unmatched", () => {
  const intent = (text) => resolveIntent(text, { projects: [{ id: "prj_2", name: "ProDelivery", slug: "prodelivery" }], source: "typed" }).steps.map((s) => s.intent);
  for (const text of ["Arată dosarul de pornire OPS-0001", "Arată cazul de suport SUP-0001", "Arată devizul DVZ-0001", "Deschide cazul de suport SUP-0001", "OPS-0001", "Ce stare are DVZ-0001?", "Arată devizul", "Ce lipsește din devizul DVZ-0001?"]) {
    assert.deepEqual(intent(text), ["desk_show"], text);
  }
  assert.deepEqual(intent("Deschide cazul de suport pentru Demo Livrare: clienții pot anula?"), ["desk_support_prepare"]);
  assert.deepEqual(intent("Pregătește devizul din oferta aprobată"), ["desk_finance_prepare"]);
  assert.deepEqual(intent("Pregătește dosarul de pornire a proiectului din oferta aprobată"), ["desk_ops_prepare"]);
  assert.deepEqual(intent("Arată-mi oferta"), ["sales_show"]);
  assert.deepEqual(intent("Ce lipsește din ofertă?"), ["sales_missing"]);
  assert.deepEqual(intent("Deschide devizul din ProDelivery"), ["open_project"]);
  assert.deepEqual([deskInternalNo("ops-1"), deskInternalNo("SUP 0001"), deskInternalNo("dvz0012"), deskInternalNo("abc-1")], ["OPS-0001", "SUP-0001", "DVZ-0012", null]);
  const cases = [
    ["„Caz de suport pentru Demo: un client întreabă ceva?”", "un client întreabă ceva?"],
    ["caz de suport pentru Demo „Clienții: nu pot anula”", "nu pot anula"],
    ["caz de suport pentru Demo: „Clienții nu pot anula”.", "Clienții nu pot anula"],
    ["caz de suport pentru Demo: «nu pot anula»", "nu pot anula"],
    ["caz de suport pentru Demo: clientul spune „nu pot” azi", "clientul spune „nu pot” azi"],
    ["caz de suport pentru Demo: clientul spune „nu pot”", "clientul spune „nu pot”"],
    ["Caz de suport pentru „Demo Livrare”: clienții nu pot anula", "clienții nu pot anula"],
    ["caz de suport pentru Demo: „nu merge", "nu merge"],
  ];
  for (const [input, expected] of cases) assert.equal(supportRequestOf(input), expected, input);
  assert.equal(stripUnmatchedQuotes("a zis \"da\" și „nu”"), "a zis \"da\" și „nu”");
});

test("M14-READ-04 Sales: the offer's dossier went STALE because the owner approved the contact draft's text after it was written (the live revision 2 case): „Arată-mi oferta” says why and the continuation there is; nothing makes a revision 3 by itself", async (c) => {
  const t = await approvedOfferHub(c);
  const { approveSalesHttp } = await import("./sales-helpers.mjs");
  const draft = t.hub.db.prepare("SELECT id, content_sha FROM sales_drafts ORDER BY created_at DESC LIMIT 1").get();
  assert.ok(draft, "the preparation wrote a draft");
  assert.equal((await approveSalesHttp(t, { route: `/api/sales/drafts/${draft.id}/approve-content`, body: { displayedSha: draft.content_sha } })).status, 200);
  for (let i = 0; i < 6; i += 1) await settle();
  const prep = t.hub.salesPreparations.list()[0];
  assert.equal(prep.status, "STALE", prep.statusReason);
  const dossiers = countRows(t, "SELECT COUNT(*) AS n FROM sales_dossiers");
  const out = await say(t, "Arată-mi oferta");
  const r = out.results.find((x) => x.intent === "sales_show");
  assert.match(r.message, /Pregătirea: oprită: oferta sau intrările ei s-au schimbat\. Motivul: Dosarul nu mai corespunde: statusul ciornei s-a schimbat \(conținut aprobat\)\./, r.message);
  assert.match(r.message, /„Continuă pregătirea ofertei”/);
  assert.equal(r.sales.preparationStatus, "STALE");
  assert.equal(r.sales.continuable, true);
  for (let i = 0; i < 4; i += 1) await settle();
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM sales_dossiers"), dossiers, "no revision made by a read");
  assert.equal(t.hub.salesPreparations.get(prep.id).status, "STALE", "the state is left as it is");
});

test("M14-READ-REVIEW the review's cases: a number with „pentru …” is still the record; „Da, arată devizul” is a read; two numbers in one „ce lipsește” are not answered for one silently; an inch mark stays", () => {
  const intent = (text) => resolveIntent(text, { projects: [], source: "typed" }).steps.map((s) => [s.intent, s.args?.internalNo || null]);
  assert.deepEqual(intent("Arată devizul DVZ-0001 pentru client"), [["desk_show", "DVZ-0001"]]);
  assert.deepEqual(intent("Da, arată devizul"), [["desk_show", null]]);
  assert.ok(!intent("Ce lipsește din dosarul OPS-0001 și cazul SUP-0001").some(([i, no]) => i === "desk_show" && no === "SUP-0001"), "never one of the two silently");
  assert.equal(stripUnmatchedQuotes("ecranul de 5\""), "ecranul de 5\"");
  assert.equal(stripUnmatchedQuotes("nu merge\""), "nu merge");
});

test("M14-CHECK-01 the owner's check: example sentences copied with their quotes are read (only reads; a quoted confirmation, stop or plan stays a quotation)", () => {
  const intent = (text, source = "typed") => resolveIntent(text, { projects: [{ id: "prj_2", name: "ProDelivery", slug: "prodelivery" }], source }).steps.map((s) => [s.intent, s.args?.internalNo || null]);
  assert.deepEqual(intent("Arată dosarul de pornire OPS-0001”, „Arată cazul de suport SUP-0001”"), [["desk_show", "OPS-0001"], ["desk_show", "SUP-0001"]]);
  assert.deepEqual(intent("„Arată devizul DVZ-0001”"), [["desk_show", "DVZ-0001"]]);
  assert.deepEqual(intent("„Da, execută planul”"), [["unknown", null]], "a quoted confirmation is never consent");
  assert.notDeepEqual(intent("„oprește tot”")[0][0], "stop_all", "a quoted stop is never the command");
  assert.deepEqual(intent("„Pregătește devizul din oferta aprobată”"), [["unknown", null]], "a quoted plan is never proposed");
  assert.deepEqual(intent("„Arată devizul DVZ-0001”", "document"), [["unknown", null]], "document text stays content");
  // Review: a quoted command that would switch the project, open the full screen or the rearm card stays a quotation; a quoted „Da” keeps
  // the whole sentence out of the fallback (its refusal is not lost).
  for (const text of ["Am scris „deschide proiectul ProDelivery”", "„rearmează poarta”", "„ecran complet”", "„Da” „Arată cazul de suport SUP-0001”"]) {
    assert.ok(!intent(text).some(([i]) => ["open_project", "gate_rearm", "fullscreen", "desk_show"].includes(i)), text);
  }
  assert.deepEqual(intent("„Arată-mi oferta”"), [["sales_show", null]]);
});

test("M14-CHECK-02 the owner's check: „Care e ultima livrare?” names the LAST delivery first (accepted by him), then the older one still waiting", async (c) => {
  const t = await supportHub(c);
  const last = t.hub.db.prepare("SELECT id, created_at FROM factory_bundles ORDER BY created_at DESC LIMIT 1").get();
  t.hub.db.exec("CREATE TEMP TABLE m14_b AS SELECT * FROM factory_bundles WHERE id = '" + last.id + "'");
  t.hub.db.prepare("UPDATE m14_b SET id = 'bnd_m14_older', status = 'READY_FOR_OWNER_ACCEPTANCE', created_at = ?, decided_at = NULL").run(new Date(Date.parse(last.created_at) - 86400000).toISOString());
  t.hub.db.exec("INSERT INTO factory_bundles SELECT * FROM m14_b; DROP TABLE m14_b");
  const out = await say(t, "Care e ultima livrare?", { projectId: t.project.id });
  const r = out.results.find((x) => x.intent === "last_delivery");
  assert.match(r.message, /^Ultima livrare: „[^”]+” — acceptată de tine \(\d{4}-\d{2}-\d{2}\)\. Mai așteaptă decizia ta o livrare mai veche: „[^”]+” \(\d{4}-\d{2}-\d{2}\)\.$/, r.message);
});
