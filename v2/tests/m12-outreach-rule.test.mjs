// M12 final review, group A (F2, F4, F5, F6, F14, F16) — the ONE outreach rule. Only an INSTRUCTION TO THE HUB to send, contact or publish
// towards a client or prospect is refused (OUTREACH_DISABLED): a description of a feature or of a client's own activity („butonul care
// trimite oferta”, „o aplicație care contactează curierii”, „un buton Contactează-ne”, „cum trimiți oferta”) never is; a negation — fused
// too („Nu-i trimite”) — is a restriction; right after a Sales step „Trimite-o” / „Publică” are instructions. A sentence that holds an
// instruction AND another request is planned WITHOUT the instruction's clause on every path (typed, Lega, intake.plan, kept requests): no
// planner ever receives those words. Quoted text is content: never refused, never a planner's words either. Pure tables boot nothing;
// every Hub is a fully synthetic acceptance hub (accept-helpers isolation; the fixture Codex app-server for Lega; no model, no network).
import test from "node:test";
import assert from "node:assert/strict";
import { resolveIntent, salesOutreach, stripOutreach, SALES_SEND_REASON, QUOTED_OUTREACH_NOTE, OWN_OUTREACH_TEXT } from "../server/owner/intents.mjs";
import { parseBrief } from "../server/sales/brief.mjs";
import { acceptanceHub } from "./accept-helpers.mjs";
import { enrolOwner, prepareLiveWithoutGrants, waitFor } from "./helpers.mjs";
import { prepHub, countRows, SALES_REQUEST } from "./sales-helpers.mjs";
import { LEGA_CONSENT_VERSION } from "../server/policy/lega-policy.mjs";

const CTX = { projects: [{ id: "prj_pd", name: "ProDelivery", slug: "prodelivery" }], missions: [], departments: [], pendingEnvelopes: [], source: "typed" };
const intents = (text, extra = {}) => resolveIntent(text, { ...CTX, ...extra }).steps.map((s) => s.intent);
const OUTREACH_WORDS = /trimit|contact(?:eaz|ati|ez)|public[aă](?!\w)|postea|sun[aă]-|scrie-le/i;

/** Descriptions — never refused, the classification of before M12 (2fa81a9) unchanged, nothing cut from a planner's words. */
const ALLOW = [
  ["Repară butonul din ProDelivery care trimite comanda clientului", ["engineering_request"]],
  ["Scrie testul pentru modulul care contactează furnizorii", ["engineering_request"]],
  ["Fă un clip despre cum trimiți oferta clientului", ["studio_create"]],
  ["Analizează codul care publică oferta pe site", ["analysis_request"]],
  ["Adaugă butonul Trimite oferta în pagina clientului", ["engineering_request"]],
  ["Implementează butonul Contactează-ne pe site", ["engineering_request"]],
  ["Pagina Contactează-ne nu se încarcă, repar-o", ["incident_open"]],
  ["Repară notificarea din ProDelivery: aplicația trebuie să contacteze curierul", ["unknown"]],
  ["Fă o funcție care contactează clienții automat", ["unknown"]],
  ["Testează dacă formularul trimite datele clientului", ["unknown"]],
  ["Verifică dacă aplicația contactează clienții", ["unknown"]],
  ["Adaugă un buton care trimite oferta clientului", ["engineering_request"]],
  ["Adaugă în ProDelivery o funcție care trimite emailuri clienților", ["unknown"]],
  ["Construiește un sistem care trimite remindere clienților", ["unknown"]],
  ["Fă un clip în care clientul contactează service-ul", ["studio_create"]],
  ["Adaugă în ProDelivery un mesaj care trimite confirmarea clientului", ["unknown"]],
  ["Fă o aplicație care primește comenzi și trimite notificări clienților", ["unknown"]],
  ["Fă un clip care arată cum trimitem ofertele", ["studio_create"]],
  ["Adaugă în ProDelivery un buton Contactează-ne", ["engineering_request"]],
  ["Repară pagina publică a firmei", ["engineering_request"]],
  ["Trimite un mesaj de probă", ["unknown"]],
  ["Adaugă o funcție ca aplicația să poată trimite notificări", ["unknown"]],
  ["Pregătește o ofertă pentru un service auto din Cluj care vrea să-și contacteze clienții prin SMS", ["sales_prepare"]],
  ["Pregătește o ofertă pentru un service auto din Cluj care vrea un sistem care trimite remindere clienților", ["sales_prepare"]],
  ["Fă un clip pentru client și publică-l pe Instagram", ["studio_create"]],
  // A label („Contactează-ne” — contact US) and a send to the owner himself („Trimite-mi”) are no outreach.
  ["Contactează-ne", ["unknown"]],
  ["Trimite-mi oferta", ["unknown"]],
  // Last review round RR4: a relative clause interrupted by commas (voice transcripts), a problem described („…. Repară asta.”, „Repară X: …”).
  ["Vreau o aplicație care, după comandă, trimite oferta clientului", ["unknown"]],
  ["Fă o aplicație care, atunci când clientul face o programare, trimite un SMS de confirmare clientului", ["unknown"]],
  ["În ProDelivery, după plată, trimite oferta clientului de două ori. Repară asta.", ["unknown", "unknown"]],
  ["Repară ProDelivery: la checkout, trimite comanda clientului de două ori", ["unknown"]],
  ["Pregătește o ofertă pentru un service auto din Cluj care vrea o aplicație care, când clientul face o programare, trimite un SMS clientului", ["sales_prepare"]],
  ["Pregătește o ofertă pentru un service auto din Cluj care vrea un CRM, care trimite remindere clienților, și programări online", ["sales_prepare"]],
  // RR3: the client's own wish, also in the 1st person plural and after a sentence break, is the client's need.
  ["Pregătește o ofertă pentru un service auto din Cluj care vrea să le trimitem remindere clienților", ["sales_prepare"]],
  ["Pregătește o ofertă pentru un service auto din Cluj. Vrea să le trimitem clienților remindere prin SMS.", ["sales_prepare", "unknown"]],
  ["Pregătește o ofertă pentru un service auto din Cluj; vrea să-i contactăm pe clienții care nu au venit la revizie", ["sales_prepare", "unknown"]],
  ["Pregătește o ofertă pentru un service auto din Cluj, vrea să trimitem automat oferte de revizie clienților lui", ["sales_prepare"]],
  // Purpose clauses and 3rd-person subjects describe.
  ["Fă o aplicație pentru a trimite remindere clienților", ["unknown"]],
  ["Fă o aplicație ca firma să poată trimite oferte clienților", ["unknown"]],
  ["Aplicația trimite oferta clientului de două ori", ["unknown"]],
  ["Clientul vrea să trimită oferte clienților lui", ["unknown"]],
  ["Repară bug-ul: aplicația contactează clientul de două ori", ["engineering_request"]],
  // A bare „să” to the owner himself, like „Trimite-mi oferta”.
  ["Să-mi trimiți oferta", ["unknown"]],
];
/** Instructions to the Hub and nothing else — ONE refused step; nothing is left for a planner. */
const REFUSE = ["Trimite oferta", "Trimite-o clientului", "Te rog trimite-le oferta", "Contactează-i", "Contactați firma", "Sună-i", "Scrie-le un mail", "Publică oferta",
  "Postează oferta pe Facebook", "Poți să contactezi firma?", "Vreau să-i trimiți oferta", "Te rog să o trimiți clientului", "Contactează curierul", "Ok, trimite oferta",
  // Last review round RR2 / RR6: a modal + infinitive, a bare „să <you>”, „ar trebui / am nevoie”, a time adverb in front, a fronted object.
  "Poți trimite oferta clientului?", "Ai putea trimite oferta clientului?", "Poți contacta firma mâine?", "Poți publica oferta pe site?", "Mâine trimite oferta clientului",
  "Oferta trimite-o clientului", "Să trimiți oferta clientului", "Ar trebui să trimiți oferta", "Am nevoie să trimiți oferta clientului", "Clientului trimite-i oferta",
  "Pe client contactează-l mâine", "Poți trimite oferta clientului mâine?", "Puteți trimite oferta clientului?", "Ați putea contacta clientul?", "Bine, poți trimite oferta?",
  "Azi trimite oferta clientului", "După aia trimite oferta clientului", "Pe urmă contactează clientul", "Să trimitem oferta clientului mâine", "Te rog, mâine trimite oferta clientului",
  "Mâine contactează clientul", "Ai putea trimite oferta?", "După aprobare trimite oferta clientului", "Când termini oferta trimite-o clientului", "După aceea trimite oferta clientului",
  "Te rog mâine trimite oferta clientului", "Lega, mâine trimite oferta clientului", "Eventual contactează clientul", "Oferta pentru service-ul din Cluj trimite-o mâine",
  // The coordinator's forms: politeness, modals and adverbs around an instruction; without diacritics; misspelt (never corrected toward a send).
  "Te rog trimiți oferta clientului", "Vreau să o trimiți clientului", "Trebuie să contactezi firma", "Nu uita să trimiți oferta clientului", "Hai să trimitem oferta clientului",
  "Apoi trimite oferta clientului", "Imediat contactează-i", "Mâine publică oferta", "Maine trimite oferta clientului", "Poti trimite oferta clientului?", "Te rog sa trimiti oferta clientului",
  "Aș vrea să trimiți oferta clientului", "Ai vrea să contactezi firma?", "Am nevoie să contactezi clientul mâine", "Acum trimite oferta clientului", "Trimite mâine oferta clientului",
  "Dacă e gata, trimite oferta clientului", "Când e gata, trimite oferta clientului", "Mâine trimte oferta clientului", "Poți trmite oferta clientului?",
  "Vreau ca Hub-ul să trimită oferta clientului"];
/** Mixed — the request is kept, the instruction's clause is cut out of what the planner gets, and refused on its own. */
const STRIP = [
  ["Repară bug-ul de login și trimite oferta clientului", "engineering_request", "Repară bug-ul de login", "repara bug-ul de login"],
  ["Repară bug-ul de login. Trimite oferta clientului.", "engineering_request", "Repară bug-ul de login.", "repara bug-ul de login"],
  ["Analizează site-ul firmei din Cluj și contactează-i", "analysis_request", "Analizează site-ul firmei din Cluj", "analizeaza site-ul firmei din cluj"],
  ["Fă un clip de promovare și trimite-l clientului", "studio_create", "Fă un clip de promovare", null],
  ["Pregătește o ofertă pentru un service auto din Cluj și trimite-o clientului", "sales_prepare", "Pregătește o ofertă pentru un service auto din Cluj", null],
  ["Pregătește și trimite oferta pentru un service auto", "sales_prepare", "Pregătește oferta pentru un service auto", null],
  // Last review round RR1: the cut starts at the joining word before the ask / modal that introduces the instruction.
  ["Repară bug-ul de login din ProDelivery și te rog să trimiți oferta clientului", "engineering_request", "Repară bug-ul de login din ProDelivery", "repara bug-ul de login din prodelivery"],
  ["Pregătește o ofertă pentru un service auto din Cluj și vreau să o trimiți clientului", "sales_prepare", "Pregătește o ofertă pentru un service auto din Cluj", null],
  ["Pregătește o ofertă pentru un service auto din Cluj și poți s-o trimiți clientului", "sales_prepare", "Pregătește o ofertă pentru un service auto din Cluj", null],
  ["Pregătește o ofertă pentru un service auto din Cluj și nu uita să trimiți oferta clientului", "sales_prepare", "Pregătește o ofertă pentru un service auto din Cluj", null],
  ["Pregătește o ofertă pentru un service auto din Cluj și trebuie să contactezi firma", "sales_prepare", "Pregătește o ofertă pentru un service auto din Cluj", null],
  ["Pregătește o ofertă pentru un service auto din Cluj și hai să trimitem oferta clientului", "sales_prepare", "Pregătește o ofertă pentru un service auto din Cluj", null],
  ["Pregătește o ofertă pentru o pizzerie din Iași care vrea comenzi online și vreau să o trimiți clientului", "sales_prepare", "Pregătește o ofertă pentru o pizzerie din Iași care vrea comenzi online", null],
  ["Analizează site-ul firmei și poți să-i contactezi", "analysis_request", "Analizează site-ul firmei", "analizeaza site-ul firmei"],
  ["Repară bug-ul de login și vreau ca Hub-ul să trimită oferta clientului", "engineering_request", "Repară bug-ul de login", "repara bug-ul de login"],
  // RR2 / RR6: a bare „să”, a modal, an adverbial or a fronted object leading into the instruction.
  ["Repară bug-ul de login și să trimiți oferta clientului", "engineering_request", "Repară bug-ul de login", "repara bug-ul de login"],
  ["Repară bug-ul de login din ProDelivery, poți trimite oferta clientului?", "engineering_request", "Repară bug-ul de login din ProDelivery", "repara bug-ul de login din prodelivery"],
  ["Pregătește o ofertă pentru un service auto din Cluj și s-o trimiți clientului mâine", "sales_prepare", "Pregătește o ofertă pentru un service auto din Cluj", null],
  ["Pregătește o ofertă pentru un service auto din Cluj, iar oferta trimite-o pe mail", "sales_prepare", "Pregătește o ofertă pentru un service auto din Cluj", null],
  ["Pregătește o ofertă pentru un service auto din Cluj, poți trimite oferta direct clientului", "sales_prepare", "Pregătește o ofertă pentru un service auto din Cluj", null],
  ["Analizează site-ul firmei din Cluj și mâine contactează-i", "analysis_request", "Analizează site-ul firmei din Cluj", "analizeaza site-ul firmei din cluj"],
  ["Fă un clip de promovare și după aia trimite-l clientului", "studio_create", "Fă un clip de promovare", null],
  ["Repară bug-ul de login din ProDelivery și la final trimite oferta clientului", "engineering_request", "Repară bug-ul de login din ProDelivery", "repara bug-ul de login din prodelivery"],
  ["Repară bug-ul de login din ProDelivery și eventual trimite oferta clientului", "engineering_request", "Repară bug-ul de login din ProDelivery", "repara bug-ul de login din prodelivery"],
  ["Repară bug-ul de login din ProDelivery. Mâine trimite oferta clientului.", "engineering_request", "Repară bug-ul de login din ProDelivery.", "repara bug-ul de login din prodelivery"],
  ["Fă un clip de 30 de secunde pentru ProDelivery și pe urmă publică oferta", "studio_create", "Fă un clip de 30 de secunde pentru ProDelivery", null],
  ["Pregătește o ofertă pentru un service auto din Cluj care vrea programări online și mâine trimite-o clientului", "sales_prepare", "Pregătește o ofertă pentru un service auto din Cluj care vrea programări online", null],
  ["Repară bug-ul de login și mâine trimite oferta clientului", "engineering_request", "Repară bug-ul de login", "repara bug-ul de login"],
  ["Repară bug-ul de login și după aceea trimite oferta clientului", "engineering_request", "Repară bug-ul de login", "repara bug-ul de login"],
  ["Repară bug-ul de login, apoi mâine trimite oferta clientului", "engineering_request", "Repară bug-ul de login", "repara bug-ul de login"],
  ["Analizează site-ul firmei din Cluj și după aceea contactează clientul", "analysis_request", "Analizează site-ul firmei din Cluj", null],
  ["Pregătește oferta pentru service auto din Cluj, după care trimite-o clientului", "sales_prepare", "Pregătește oferta pentru service auto din Cluj", null],
  ["Pregătește oferta, iar după aceea trimite-o clientului", "sales_prepare", "Pregătește oferta", null],
  ["Repară bug-ul de login din ProDelivery, iar mâine contactează clientul", "engineering_request", "Repară bug-ul de login din ProDelivery", "repara bug-ul de login din prodelivery"],
  ["Pregătește oferta pentru service auto din Cluj care vrea programări online și apoi trimite-o", "sales_prepare", "Pregătește oferta pentru service auto din Cluj care vrea programări online", null],
];
/** RR11: the instruction first, the owner's other request after it (any words between „și” and its verb) — the request is kept as its own step. */
const STRIP_AFTER = [
  ["Trimite oferta clientului și după aceea repară bug-ul de login din ProDelivery", "engineering_request", "repară bug-ul de login din ProDelivery"],
  ["Trimite oferta clientului și te rog repară bug-ul de login", "engineering_request", "te rog repară bug-ul de login"],
  ["Trimite oferta clientului și la ProDelivery repară bug-ul de login", "engineering_request", "la ProDelivery repară bug-ul de login"],
  ["Trimite oferta clientului și mâine fă un clip de promovare", "studio_create", "mâine fă un clip de promovare"],
];
/** RR10: the owner's own statement — never refused, never a planner's words; the rest of the sentence is planned. */
const OWN = [
  ["Contactez eu firma, tu pregătește o ofertă pentru un service auto din Cluj", ["sales_prepare"], "tu pregătește o ofertă pentru un service auto din Cluj"],
  ["Pregătește o ofertă pentru un service auto din Cluj, o trimit eu clientului", ["sales_prepare"], "Pregătește o ofertă pentru un service auto din Cluj"],
  ["Pregătește o ofertă pentru un service auto din Cluj; trimit eu oferta", ["sales_prepare"], "Pregătește o ofertă pentru un service auto din Cluj"],
  ["Contactez eu firma", ["unknown"], ""],
];
/** Negations, fused ones included (F16): a restriction (noMessages), never a refusal. */
const NEGATED = ["Nu-i trimite oferta", "Nu-l contacta pe client", "Nu-le trimite oferta", "Nu-i contacta", "Să nu-i trimiți oferta", "n-o trimite clientului",
  "Pregătește o ofertă pentru un service auto din Cluj, dar nu-i trimite nimic"];
/** Right after a Sales step (F14): pronoun-only and bare forms are instructions; without the Sales step they keep their earlier meaning. */
const IN_SALES = ["Trimite-o", "Trimite-o acum", "Publică-o", "Publică", "Publică pe Facebook", "Trimite", "Trimite-i-o"];

test("M12-FA-OUT-01 the table (≥ 30 sentences): descriptions never refused and classified as before; instructions refused; mixed ones cut; negations restrict", () => {
  assert.ok(ALLOW.length + REFUSE.length + STRIP.length + NEGATED.length + IN_SALES.length >= 30);
  for (const [s, expected] of ALLOW) {
    assert.deepEqual(intents(s), expected, s);
    assert.equal(salesOutreach(s).hits.length, 0, s);
    const cut = stripOutreach(s);
    assert.equal(cut.changed, false, s);
    assert.equal(cut.text, s);
  }
  for (const s of REFUSE) {
    const r = resolveIntent(s, CTX);
    assert.deepEqual(r.steps.map((x) => [x.intent, x.effectClass]), [["sales_send", "REFUSED"]], s);
    assert.equal(r.steps[0].args.reason, SALES_SEND_REASON);
    assert.ok(salesOutreach(s).hits.length >= 1, s);
    assert.equal(stripOutreach(s).meaningful, false, `${s}: nothing is left for a planner`);
  }
  for (const [s, intent, plannerText, request] of STRIP) {
    const r = resolveIntent(s, CTX);
    assert.deepEqual(r.steps.map((x) => x.intent), [intent, "sales_send"], s);
    const step = r.steps[0];
    if (request !== null) assert.equal(step.args.request, request, s);
    assert.doesNotMatch(String(step.text), OUTREACH_WORDS, `${s}: the step's words`);
    const cut = stripOutreach(s);
    assert.equal(cut.text, plannerText, s);
    assert.equal(cut.meaningful, true);
    assert.equal(cut.refused.length, 1, s);
    // The brief reads the same rule: an offer request keeps its card (its intent), the refusal is noted, the need holds none of the instruction.
    if (intent === "sales_prepare") {
      const b = parseBrief(s);
      assert.ok(b.intent, `${s}: the offer request`);
      assert.equal(b.refused.length, 1, `${s}: the refusal noted`);
      assert.doesNotMatch(String(b.fields.problem?.value || ""), OUTREACH_WORDS, `${s}: the need`);
    }
  }
  // RR11: the request after the instruction is its own step; the planner gets its words without the instruction.
  for (const [s, intent, plannerText] of STRIP_AFTER) {
    const r = resolveIntent(s, CTX);
    assert.deepEqual(r.steps.map((x) => x.intent), ["sales_send", intent], s);
    assert.doesNotMatch(String(r.steps[1].text), OUTREACH_WORDS, `${s}: the step's words`);
    const cut = stripOutreach(s);
    assert.deepEqual([cut.text, cut.meaningful, cut.refused.length], [plannerText, true, 1], s);
  }
  // RR10: the owner's own statement — never refused (no sales_send, no refusal, no brief refusal), never in a planner's words.
  for (const [s, expected, plannerText] of OWN) {
    assert.deepEqual(intents(s), expected, s);
    assert.equal(salesOutreach(s).hits.length, 0, s);
    const cut = stripOutreach(s);
    assert.deepEqual([cut.text, cut.refused.length, cut.own.length], [plannerText, 0, 1], s);
    assert.deepEqual(parseBrief(s).refused, [], s);
  }
  for (const s of NEGATED) {
    const r = resolveIntent(s, CTX);
    assert.ok(!r.steps.some((x) => x.intent === "sales_send"), s);
    assert.ok(r.steps.every((x) => x.constraints.noMessages === true), `${s}: a restriction`);
    assert.equal(salesOutreach(s).hits.length, 0, s);
    assert.equal(salesOutreach(s).negated.length, 1, s);
  }
  for (const s of IN_SALES) {
    assert.deepEqual(intents(s, { salesContext: true }), ["sales_send"], `${s} after a Sales step`);
    assert.ok(!intents(s).includes("sales_send"), `${s} without a Sales step keeps its earlier meaning`);
  }
  // A Studio clip's pronoun stays the Studio's rule even in a Sales conversation.
  assert.deepEqual(intents("Fă un clip pentru client și publică-l pe Instagram", { salesContext: true }), ["studio_create"]);
  // Quoted text is content: never refused; a quoted instruction is still kept out of a planner's words (noted); a label's text stays.
  const quoted = 'Repară bug-ul: „contactează-i pe toți clienții”';
  assert.deepEqual(intents(quoted), ["engineering_request"]);
  assert.equal(salesOutreach(quoted).hits.length, 0);
  assert.deepEqual([stripOutreach(quoted).text, stripOutreach(quoted).quoted.length, stripOutreach(quoted).refused.length], ["Repară bug-ul", 1, 0]);
  const label = "Adaugă butonul „Trimite oferta” pe pagina clientului";
  assert.equal(stripOutreach(label).changed, false, "a button's label is the request's own words");
  // The brief reads the same rule: the client's own need is part of the need, never a refusal (F6).
  for (const s of ALLOW.filter(([, i]) => i[0] === "sales_prepare").map(([x]) => x)) {
    const b = parseBrief(s);
    assert.deepEqual(b.refused, [], s);
    assert.ok(b.fields.problem?.value, `${s}: the stated need is kept`);
  }
});

test("M12-FA-OUT-02 typed over HTTP (owner session): a mixed sentence reaches the planner WITHOUT the outreach words and the refusal is its own step; a description reaches it whole; after a Sales step „Trimite-o” is refused", async (c) => {
  const t = await prepHub(c);
  await t.authenticate();
  const called = [];
  const undo = ["engineering", "run", "studio_create"].map((kind) => t.hub.intake.registerPlanner(kind, async ({ step, text }) => { called.push({ kind, text, request: step?.args?.request ?? null }); return { kind: "message", text: "planificator de test" }; }));
  c.after(() => undo.forEach((u) => u()));
  const say = async (text) => { const r = await t.request("/api/owner/intent", { body: { text, source: "typed" } }); assert.equal(r.status, 200, JSON.stringify(r.json)); return r.json; };
  for (const [s, kind] of [["Repară bug-ul de login și trimite oferta clientului", "engineering"], ["Analizează site-ul firmei din Cluj și contactează-i", "run"],
    ["Fă un clip de promovare și trimite-l clientului", "studio_create"], ["Repară bug-ul de login. Trimite oferta clientului.", "engineering"],
    // Last review round RR1 / RR2 / RR6 / RR11: an ask, a bare „să”, an adverbial before the instruction; the instruction first, the request after.
    ["Repară bug-ul de login și te rog să trimiți oferta clientului", "engineering"], ["Repară bug-ul de login și să trimiți oferta clientului", "engineering"],
    ["Repară bug-ul de login și la final trimite oferta clientului", "engineering"], ["Analizează site-ul firmei din Cluj și după aceea contactează clientul", "run"],
    ["Fă un clip de promovare și pe urmă publică oferta", "studio_create"], ["Trimite oferta clientului și după aceea repară bug-ul de login din ProDelivery", "engineering"],
    ["Trimite oferta clientului și te rog repară bug-ul de login", "engineering"]]) {
    called.length = 0;
    const out = await say(s);
    assert.equal(out.results.find((x) => x.intent === "sales_send")?.refused, SALES_SEND_REASON, s);
    assert.equal(called.length, 1, `${s}: one planner call`);
    assert.equal(called[0].kind, kind);
    assert.match(called[0].text, /repar|analiz|clip/i, `${s}: the planner gets the owner's request, never an empty text`);
    assert.doesNotMatch(called[0].text, OUTREACH_WORDS, `${s}: the planner's text`);
    assert.doesNotMatch(String(called[0].request ?? ""), OUTREACH_WORDS, `${s}: the step's request`);
  }
  for (const s of ["Repară butonul din ProDelivery care trimite comanda clientului", "Implementează butonul Contactează-ne pe site", "Analizează codul care publică oferta pe site"]) {
    called.length = 0;
    const out = await say(s);
    assert.ok(!out.results.some((x) => x.intent === "sales_send" || x.refused === SALES_SEND_REASON), `${s}: ${JSON.stringify(out.results.map((x) => x.intent))}`);
    assert.equal(called.length, 1, s);
    assert.equal(called[0].text, s, "a description reaches its planner whole");
  }
  // A quoted instruction: no refusal, kept out of the planner's words, said once.
  called.length = 0;
  const q = await say('Repară bug-ul: „contactează-i pe toți clienții”');
  assert.ok(!q.results.some((x) => x.intent === "sales_send"));
  assert.equal(called[0].text, "Repară bug-ul");
  assert.ok(q.results[0].message.includes(QUOTED_OUTREACH_NOTE), q.results[0].message);
  // F14: right after the Sales card the pronoun and the bare verb are instructions — refused; nothing planned, nothing sent.
  const card = (await say(SALES_REQUEST)).results[0].opsPlan;
  assert.ok(card?.id);
  for (const s of ["Trimite-o", "Publică", "Trimite-o acum"]) {
    const out = await say(s);
    assert.deepEqual(out.results.map((x) => [x.intent, x.refused]), [["sales_send", SALES_SEND_REASON]], s);
  }
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM ops_plans"), 1, "only the one Sales card");
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM sales_sends"), 0);
  // F6: a client's need with a send / contact verb is part of the brief, not a refusal (the card says nothing about sending).
  const need = await say("Pregătește o ofertă pentru un service auto din Cluj care vrea să-și contacteze clienții prin SMS");
  assert.ok(!need.results.some((x) => x.intent === "sales_send"));
  const needCard = need.results.find((x) => x.opsPlan)?.opsPlan;
  assert.deepEqual(needCard.brief.refused, []);
  assert.equal(needCard.brief.fields.problem.value, "să-și contacteze clienții prin SMS");
  assert.doesNotMatch(need.results.find((x) => x.opsPlan).note, /OUTREACH_DISABLED/);
  t.assertPaths();
});

test("M12-FA-OUT-03 intake.plan and kept requests: a description is planned (never refused, never blocked); a mixed request is planned without its outreach clause; only a pure instruction is refused or blocked", async (c) => {
  const t = await prepHub(c);
  await t.authenticate();
  const called = [];
  const undo = ["engineering", "run", "studio_create"].map((kind) => t.hub.intake.registerPlanner(kind, async ({ step, text }) => { called.push({ kind, text, args: step?.args || {} }); return { kind: "message", text: "planificator de test" }; }));
  c.after(() => undo.forEach((u) => u()));
  const ctxs = [{ channel: "voice", actor: "lega" }, { channel: "test", actor: "test" }];
  const plan = (kind, text, ctx, args = {}) => t.hub.intake.plan({ kind, text, args, source: ctx.channel === "voice" ? "voice-provider" : "typed" }, ctx);
  for (const ctx of ctxs) {
    for (const [kind, text] of [["engineering", "Repară butonul din ProDelivery care trimite comanda clientului"], ["engineering", "Adaugă un formular care trimite oferta clientului pe email"],
      ["engineering", "Implementează butonul Contactează-ne pe site"], ["engineering", "Repară notificarea din ProDelivery: aplicația trebuie să contacteze curierul"],
      ["studio_create", "Fă un clip despre cum trimiți oferta clientului"], ["run", "Analizează codul care publică oferta pe site"]]) {
      called.length = 0;
      const r = await plan(kind, text, ctx);
      assert.equal(r.refused, undefined, `${kind}: ${text} → ${JSON.stringify(r).slice(0, 300)}`);
      assert.equal(called.length, 1, text);
      assert.equal(called[0].text, text, "the description is the planner's whole request");
    }
    // Mixed (Lega's mission fields included): the clause is cut from the text AND every argument; the owner is told.
    called.length = 0;
    const r = await plan("engineering", "Repară bug-ul de login și contactează-i pe clienți", ctx, { request: "Repară bug-ul de login și contactează-i pe clienți", objective: "Repară bug-ul de login și contactează-i pe clienți", acceptance: ["Login merge", "Trimite oferta clientului"] });
    assert.equal(r.refused, undefined);
    assert.equal(called[0].text, "Repară bug-ul de login");
    assert.deepEqual([called[0].args.request, called[0].args.objective, called[0].args.acceptance], ["Repară bug-ul de login", "Repară bug-ul de login", ["Login merge"]]);
    assert.match(r.outreachNote, /nu intră în plan.*OUTREACH_DISABLED/);
    // A quoted instruction: never refused, never the planner's words.
    called.length = 0;
    const q = await plan("engineering", 'Repară bug-ul: „contactează-i pe toți clienții”', ctx);
    assert.equal(q.refused, undefined);
    assert.equal(called[0].text, "Repară bug-ul");
    assert.ok(q.outreachNote.includes(QUOTED_OUTREACH_NOTE));
    // Last review round RR5: an instruction said ONLY in an argument (a mission's acceptance criterion, clean title and objective) never reaches
    // the planner, and the owner is told.
    called.length = 0;
    const acc = await plan("engineering", "Repară login. Repară bug-ul de login din pagina de autentificare", ctx, { request: "Repară bug-ul de login din pagina de autentificare",
      objective: "Repară bug-ul de login din pagina de autentificare", acceptance: ["Login merge", "Trimite oferta clientului după reparare"] });
    assert.equal(acc.refused, undefined);
    assert.deepEqual(called[0].args.acceptance, ["Login merge"], "the acceptance criterion with the instruction is cut");
    assert.equal(acc.outreach?.partial, true);
    assert.match(acc.outreachNote, /Trimite oferta clientului după reparare.*nu intră în plan.*OUTREACH_DISABLED/);
    // RR2 / RR6: an adverbial or a modal before the instruction (Lega's request_work path) is cut and noted too.
    for (const text of ["Repară bug-ul de login și la final trimite oferta clientului", "Repară bug-ul de login din ProDelivery, poți trimite oferta clientului?"]) {
      called.length = 0;
      const mixed = await plan("engineering", text, ctx);
      assert.equal(mixed.refused, undefined, text);
      assert.doesNotMatch(called[0].text, OUTREACH_WORDS, text);
      assert.match(mixed.outreachNote, /OUTREACH_DISABLED/, text);
    }
    for (const text of ["Poți trimite oferta clientului?", "Mâine trimite oferta clientului"]) {
      called.length = 0;
      assert.equal((await plan("engineering", text, ctx)).refused, SALES_SEND_REASON, text);
      assert.equal(called.length, 0, text);
    }
    // RR10: the owner's own statement alone: nothing planned, nothing refused, he is told the contact is his.
    called.length = 0;
    const own = await plan("engineering", "Contactez eu firma", ctx);
    assert.deepEqual([own.refused, own.outreach, called.length], [undefined, undefined, 0]);
    assert.equal(own.message, OWN_OUTREACH_TEXT);
  }
  // Kept requests: a description is never blocked by the outreach rule; a mixed one is re-planned without the clause; a pure one stays blocked.
  assert.equal(await t.hub.intake.replanRequest({ id: "wr_d", intent: "other", text: "Repară butonul din ProDelivery care trimite comanda clientului", projectId: null }), null);
  assert.deepEqual(await t.hub.intake.replanRequest({ id: "wr_p", intent: "other", text: "Trimite oferta clientului", projectId: null }), { blocked: true });
  called.length = 0;
  await t.hub.intake.replanRequest({ id: "wr_m", intent: "run", text: "Analizează site-ul firmei din Cluj și contactează-i", projectId: t.project?.id || "prj_x" });
  assert.deepEqual(called.map((x) => x.text), ["Analizează site-ul firmei din Cluj"], "the kept mixed request is re-planned without the outreach words");
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM sales_sends"), 0);
});

const OFFER = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n";
const b64 = (list) => Buffer.from(JSON.stringify(list)).toString("base64url");
const replies = (t) => t.readLog("codex").filter((l) => l.toolReply).map((l) => ({ tool: l.tool, ok: l.toolReply.success, text: l.toolReply.contentItems?.[0]?.text || "" }));

test("M12-FA-OUT-04 Lega voice-first: request_work and propose_run with a DESCRIPTION reach their planner; a mixed request is planned without the outreach words (and says so); a pure instruction is refused", async (c) => {
  const t = await acceptanceHub({ fakeProviders: { codex: "ok" } });
  c.after(async () => { await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); });
  const owner = await enrolOwner(t, { activatePolicy: true });
  await prepareLiveWithoutGrants(t.hub);
  t.hub.bus.transaction(() => t.hub.settings.set("legaConsent", { version: LEGA_CONSENT_VERSION, confirmedAt: new Date().toISOString() }, "test"));
  t.hub.refreshCodexConfig();
  const project = "Accept synthetic";
  t.queue("codex", `lega-script:${b64([{ sleep: 700 },
    { tool: "request_work", args: { request: "Repară butonul din ProDelivery care trimite comanda clientului", kind_hint: "engineering" } },
    { tool: "request_work", args: { request: "Implementează butonul Contactează-ne pe site", kind_hint: "engineering" } },
    { tool: "propose_run", args: { project, provider: "codex", task: "Analizează codul care publică oferta pe site" } },
    { tool: "request_work", args: { request: "Repară bug-ul de login și trimite oferta clientului", kind_hint: "engineering" } },
    { tool: "propose_mission", args: { project, kind: "eng_feature", title: "Butonul Contactează-ne", objective: "Implementează butonul Contactează-ne pe site" } },
    { tool: "request_work", args: { request: "Trimite oferta către Atelierul Verde", kind_hint: "engineering" } },
    // Last review round RR5: an instruction only in an acceptance criterion of a voice-first mission.
    { tool: "propose_mission", args: { project, kind: "eng_feature", title: "Repară login", objective: "Repară bug-ul de login din pagina de autentificare", acceptance: ["Login merge", "Trimite oferta clientului după reparare"] } }])}`);
  const called = [];
  t.hub.intake.registerPlanner("engineering", async ({ text, step }) => { called.push({ kind: "engineering", text, acceptance: step?.args?.acceptance || null }); return { kind: "message", text: "planificator de test" }; });
  t.hub.intake.registerPlanner("run", async ({ text }) => { called.push({ kind: "run", text }); return { kind: "message", text: "planificator de test" }; });
  const s = (await t.hub.commands.dispatch({ type: "lega.session.start", channel: "owner", actor: `owner:${owner.session.id}`, ownerSession: owner.session, payload: { sdp: OFFER } })).result;
  await t.hub.commands.dispatch({ type: "lega.session.connected", channel: "ui", actor: "user", payload: { sessionId: s.sessionId } });
  await waitFor(() => t.readLog("codex").some((l) => l.scriptDone), 30000);
  const r = replies(t).filter((x) => ["request_work", "propose_run", "propose_mission"].includes(x.tool));
  assert.equal(r.length, 7, JSON.stringify(replies(t)));
  for (const x of r.slice(0, 5)) assert.ok(!x.text.startsWith(SALES_SEND_REASON), `not refused: ${x.text}`);
  assert.match(r[3].text, /nu intră în plan.*OUTREACH_DISABLED/, "the mixed request says what was cut");
  assert.ok(r[5].text.startsWith(SALES_SEND_REASON), r[5].text);
  assert.deepEqual(called.map((x) => x.text), ["Repară butonul din ProDelivery care trimite comanda clientului", "Implementează butonul Contactează-ne pe site",
    "Analizează codul care publică oferta pe site", "Repară bug-ul de login", "Butonul Contactează-ne. Implementează butonul Contactează-ne pe site",
    "Repară login. Repară bug-ul de login din pagina de autentificare"]);
  assert.deepEqual(called[5].acceptance, ["Login merge"], "RR5: the acceptance criterion with the instruction never reaches the planner");
  assert.match(r[6].text, /Trimite oferta clientului după reparare.*nu intră în plan.*OUTREACH_DISABLED/, "RR5: and the owner is told");
  for (const x of called.slice(3, 4)) assert.doesNotMatch(x.text, OUTREACH_WORDS);
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM events WHERE type = 'lega.work_request' AND json_extract(payload_json, '$.code') = 'OUTREACH_DISABLED'"), 1);
});
