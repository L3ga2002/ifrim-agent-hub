// M12 final review, group A (F12, F15, F22, F6) — the brief and the figures scanner. A number word is a quantity only as an amount or a
// term (before its unit): „o pagină nouă”, „a doua locație”, „în două limbi” are no commercial figures, „două mii de lei”, „douăzeci de
// zile” still are (F12). An inflection of a client-type word that is another noun („fotografii” — photos) is never the owner's client
// type (F22). The resolver and the brief agree on what an offer request is — one shared rule — so every offer request gives exactly ONE
// card (F15). A client's own need with a send / contact verb is kept as the need (F6). Pure tables boot nothing; the card checks run on
// a fully synthetic acceptance hub (accept-helpers isolation).
import test from "node:test";
import assert from "node:assert/strict";
import { parseBrief } from "../server/sales/brief.mjs";
import { findCommercialFigures, proposalFigures } from "../server/sales/figures.mjs";
import { renderProposal } from "../server/sales/proposal.mjs";
import { resolveIntent, stripOutreach, offerRequestIn, foldedTokens, SALES_SEND_REASON } from "../server/owner/intents.mjs";
import { prepHub, countRows } from "./sales-helpers.mjs";
import { PREPARE_KIND } from "../server/sales/preparation.mjs";

const P = "pregătește o ofertă pentru o pizzerie din Iași care vrea ";
const value = (b, f) => b.fields[f]?.value ?? null;
const offer = (b) => renderProposal({ org: { displayName: "Firma Sintetică SRL", synthetic: true }, opportunity: {}, services: [], evidence: [], audit: null, owner: { companyName: "Ifrim Digital" },
  brief: { ...b, id: "spp_fa" } });

test("M12-FA-BRIEF-01 (F12) a number word is a quantity only before its unit: the adjective, the ordinal and a plain count stay in the need and are no figures; amounts and terms in words are still caught", () => {
  for (const need of ["o pagină nouă de meniu și comenzi online", "o identitate vizuală nouă", "un site pentru a doua locație", "un site în două limbi", "opt pagini noi de prezentare"]) {
    const b = parseBrief(`${P}${need}`);
    assert.equal(value(b, "problem"), need, `kept whole: ${need}`);
    assert.equal(b.fields.problem.rule, undefined, "no cut");
    assert.ok(!b.assumptions.some((a) => a.id === "A-NEED-CUT"), "no „figures” note");
    assert.deepEqual(proposalFigures(offer(b)), [], need);
  }
  for (const t of ["Investiția într-o pagină nouă", "Costul etapei a doua: De stabilit (neconfigurat)", "Prețul unei identități vizuale noua", "Bugetul pentru a doua locație",
    "Prețul include zero costuri ascunse", "Studiu de caz: investiția într-o pagină nouă pentru o cafenea", "Reprogramare a doua zi"]) assert.deepEqual(findCommercialFigures(t), [], t);
  // Still caught (fail closed), in the need and by the scanner.
  for (const [t, category] of [["preț de două mii", "price"], ["prețul de trei sute de lei", "price"], ["în douăzeci de zile", "duration"], ["costul de douăzeci și cinci de mii de lei", "price"],
    ["jumătate de an", "duration"], ["două mii de lei", "currency"]]) assert.ok(findCommercialFigures(t).some((f) => f.category === category), `${category}: ${t}`);
  const amount = parseBrief(`${P}programări online de douăzeci și cinci de mii de lei`);
  assert.equal(value(amount, "problem"), "programări online");
  const term = parseBrief(`${P}un site cu reamintire cu o zi înainte`);
  assert.equal(value(term, "problem"), "un site cu reamintire");
});

test("M12-FA-BRIEF-02 (F22) an ordinary word is never a USER_PROVIDED client type through an inflection; a client-type noun with its endings still is", () => {
  for (const request of ["pregătește o ofertă pentru o firmă din Cluj care vrea un site cu fotografii", "pregătește o ofertă pentru o firmă din Cluj care vrea o galerie de fotografii",
    "pregătește o ofertă pentru o firmă de amenajări din Cluj care vrea un site cu fotografii", "pregătește o ofertă pentru o firmă din Cluj care vrea lentile optici"]) {
    const b = parseBrief(request);
    for (const f of ["clientType", "sector", "caen"]) assert.equal(b.fields[f], null, `${f}: ${request}`);
    assert.ok(b.missing.some((m) => m.field === "clientType"), `${request}: the client type is still asked`);
  }
  for (const [request, clientType] of [["pregătește o ofertă pentru o firmă care vrea un site pentru restaurantul ei", "restaurantul"], ["pregătește o ofertă pentru fotografi din Cluj", "fotografi"],
    ["pregătește o ofertă pentru proprietarul farmaciei din Cluj care vrea un site", "farmaciei"]]) {
    const b = parseBrief(request);
    assert.deepEqual([value(b, "clientType"), b.fields.clientType?.provenance], [clientType, "USER_PROVIDED"], request);
  }
});

const AGREE = ["Propune o ofertă pentru un service auto și trimite-o", "Aș dori o ofertă pentru un service auto din Cluj și trimite-o clientului", "Pregătește și trimite oferta pentru un service auto",
  "Poți să-mi pregătești o ofertă pentru o florărie?", "Te rog, pregătește o ofertă pentru o cafenea", "O ofertă pentru un service auto din Cluj care vrea programări online",
  "Am nevoie de o ofertă pentru o farmacie", "Pregătește-mi rapid o ofertă pentru un dentist", "contactez eu firma, tu pregătește o ofertă pentru un service auto",
  "Vreau să văd oferta", "Arată-mi oferta pentru service", "nu pregăti încă oferta pentru service auto", "Fă o propunere de corectură pentru clip", "trimite oferta la service auto din Cluj",
  "Scrie-le oferta", "Pregătește demo-ul de detailing pentru prezentare"];

test("M12-FA-BRIEF-03 (F15) one rule: every sentence the brief reads as an offer request is a sales_prepare, and the reverse — also after the outreach clause is cut out", () => {
  for (const s of AGREE) {
    const prepares = resolveIntent(s, { projects: [] }).steps.some((x) => x.intent === "sales_prepare");
    assert.equal(Boolean(parseBrief(s).intent), prepares, `raw: ${s}`);
    assert.equal(Boolean(parseBrief(stripOutreach(s).text).intent), prepares, `planner's words: ${s}`);
    assert.equal(Boolean(offerRequestIn(foldedTokens(s)) && !offerRequestIn(foldedTokens(s)).negated), prepares, `shared rule: ${s}`);
  }
  // The brief's intent span never includes a refused word; a „propunere” of something else is no offer.
  assert.equal(parseBrief("Pregătește și trimite oferta pentru un service auto").intent.span, "Pregătește");
  assert.equal(parseBrief("Propune o ofertă pentru un service auto și trimite-o").intent.span, "Propune o ofertă");
});

test("M12-FA-BRIEF-04 (F15) typed and through Lega's planner entry, the reviewer's forms give exactly ONE card and no other question; the send is refused on its own", async (c) => {
  const t = await prepHub(c);
  await t.authenticate();
  for (const s of ["Propune o ofertă pentru un service auto și trimite-o", "Pregătește și trimite oferta pentru un service auto din Cluj care vrea programări online",
    "Aș dori o ofertă pentru un service auto din Cluj și trimite-o clientului"]) {
    const r = await t.request("/api/owner/intent", { body: { text: s, source: "typed" } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const cards = r.json.results.filter((x) => x.opsPlan);
    assert.equal(cards.length, 1, `${s}: ${JSON.stringify(r.json.results.map((x) => [x.intent, x.message]))}`);
    assert.equal(cards[0].opsPlan.kind, PREPARE_KIND);
    assert.equal(r.json.resolved.clarification, null);
    assert.ok(!r.json.results.some((x) => x.clarification), "no other question");
    assert.equal(r.json.results.find((x) => x.intent === "sales_send")?.refused, SALES_SEND_REASON, s);
    assert.doesNotMatch(cards[0].opsPlan.brief.request, /trimit/i, "the Sales planner never got the send words");
    const lega = await t.hub.intake.plan({ kind: "sales", text: s, source: "voice-provider" }, { channel: "voice", actor: "lega" });
    assert.ok(lega.opsPlan?.id, `${s} (Lega): ${JSON.stringify(lega).slice(0, 300)}`);
    assert.equal(lega.outreach?.partial, true);
    assert.match(lega.outreachNote, /OUTREACH_DISABLED/);
  }
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM sales_sends"), 0);
});

test("M12-FA-BRIEF-05 (F6) a client's need with a send / contact verb is the need (USER_PROVIDED), nothing is refused, the card does not say the owner asked to send", () => {
  for (const [request, need] of [
    ["pregătește o ofertă pentru un service auto din Cluj care vrea să-și contacteze clienții prin SMS", "să-și contacteze clienții prin SMS"],
    ["pregătește o ofertă pentru un service auto din Cluj care vrea un sistem care trimite remindere clienților", "un sistem care trimite remindere clienților"],
    ["pregătește o ofertă pentru o clinică din Iași care vrea programări online și să le trimită pacienților remindere", "programări online și să le trimită pacienților remindere"],
    ["pregătește o ofertă pentru un salon din Cluj care vrea ca site-ul să trimită notificări clienților", "ca site-ul să trimită notificări clienților"],
    ["pregătește o ofertă pentru un restaurant din Cluj care vrea să posteze meniul pe Facebook", "posteze meniul pe Facebook"],
  ]) {
    const b = parseBrief(request);
    assert.deepEqual(b.refused, [], request);
    assert.deepEqual([value(b, "problem"), b.fields.problem.provenance], [need, "USER_PROVIDED"], request);
    assert.ok(!b.missing.some((m) => m.field === "problem"), `${request}: the stated need is never „missing”`);
  }
  // The owner's own instruction in the same sentence is still refused (and only it).
  assert.deepEqual(parseBrief("pregătește o ofertă pentru un service auto din Cluj care vrea să-și contacteze clienții prin SMS și trimite-o clientului").refused.map((r) => r.text), ["trimite-o"]);
});
