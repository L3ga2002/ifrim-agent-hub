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
  // Last review round RC2: amounts and results in words without their unit are cut from the client-facing need, and the scanner catches them;
  // a count of things stays in the need.
  for (const [need, kept] of [["programări online cu plata în rate de cincizeci", "programări online"], ["programări online și să plătească cincizeci pe lună", "programări online"],
    ["programări online și să câștige douăzeci de clienți noi pe lună", "programări online"], ["programări online ca să crească vânzările cu treizeci", "programări online"],
    ["programări online cu treizeci", "programări online"], ["programări online de trei ori mai multe", "programări online"], ["programări online și un abonament de cincizeci pe lună", "programări online"],
    ["programări online ca să aibă clienți dublu", "programări online ca să aibă clienți"], ["programări online pentru douăzeci de mecanici", "programări online pentru douăzeci de mecanici"],
    ["un site cu nouă pagini", "un site cu nouă pagini"], ["un site în trei limbi", "un site în trei limbi"], ["un site cu o pagină nouă", "un site cu o pagină nouă"]]) {
    const b = parseBrief(`${P}${need}`);
    assert.equal(value(b, "problem"), kept, need);
    assert.deepEqual(proposalFigures(offer(b)), [], `${need}: the client text carries no figure`);
  }
  for (const [t, category] of [["programări online ca să crească vânzările cu treizeci", "roi"], ["să câștige douăzeci de clienți noi pe lună", "roi"], ["de trei ori mai multe programări", "roi"],
    ["vânzări dublu", "roi"], ["cu plata în rate de cincizeci", "price"]]) assert.ok(findCommercialFigures(t).some((f) => f.category === category), `${category}: ${t}`);
  // RC4: after a price word a number word in words is a price also without its unit; the adjective „nouă”, an ordinal and a count stay allowed.
  for (const t of ["Prețul este de cincizeci.", "Costul ar fi de nouăzeci pe lună.", "Tariful e cincisprezece pe oră.", "Abonamentul costă zece pe lună.", "Costă cinci.",
    "Bugetul estimat: douăzeci și cinci.", "Prețul de pornire e doi.", "Mentenanță: abonamentul costă cincizeci pe lună"]) assert.ok(findCommercialFigures(t).some((f) => f.category === "price"), t);
  for (const t of ["Investiția într-o pagină nouă.", "Costul etapei a doua.", "Livrare în a doua lună.", "Lansare în al doilea an.", "un buton cu dublu click", "o cameră dublă"]) {
    assert.deepEqual(findCommercialFigures(t), [], t);
  }
});

test("M12-FA-BRIEF-02 (F22) an ordinary word is never a USER_PROVIDED client type through an inflection; a client-type noun with its endings still is", () => {
  for (const request of ["pregătește o ofertă pentru o firmă din Cluj care vrea un site cu fotografii", "pregătește o ofertă pentru o firmă din Cluj care vrea o galerie de fotografii",
    "pregătește o ofertă pentru o firmă de amenajări din Cluj care vrea un site cu fotografii", "pregătește o ofertă pentru o firmă din Cluj care vrea lentile optici"]) {
    const b = parseBrief(request);
    for (const f of ["clientType", "sector", "caen"]) assert.equal(b.fields[f], null, `${f}: ${request}`);
    assert.ok(b.missing.some((m) => m.field === "clientType"), `${request}: the client type is still asked`);
  }
  for (const [request, clientType] of [["pregătește o ofertă pentru o firmă care vrea un site pentru restaurantul ei", "restaurantul"], ["pregătește o ofertă pentru fotografi din Cluj", "fotografi"],
    ["pregătește o ofertă pentru proprietarul farmaciei din Cluj care vrea un site", "farmaciei"],
    // Last review round RC5: a numeral or a quantifier between „pentru” and the client type keeps it; a plural after a hyphen too.
    ["Pregătește o ofertă pentru doi fotografi din Iași care vor programări online", "fotografi"], ["Pregătește o ofertă pentru niște fotografi din Iași", "fotografi"],
    ["Pregătește o ofertă pentru doi stomatologi din Iași care vor programări online", "stomatologi"], ["Pregătește o ofertă pentru mai mulți stomatologi din Iași", "stomatologi"],
    ["Pregătește o ofertă pentru două service-uri auto din Cluj", "service-uri auto"]]) {
    const b = parseBrief(request);
    assert.deepEqual([value(b, "clientType"), b.fields.clientType?.provenance], [clientType, "USER_PROVIDED"], request);
  }
});

const AGREE = ["Propune o ofertă pentru un service auto și trimite-o", "Aș dori o ofertă pentru un service auto din Cluj și trimite-o clientului", "Pregătește și trimite oferta pentru un service auto",
  "Poți să-mi pregătești o ofertă pentru o florărie?", "Te rog, pregătește o ofertă pentru o cafenea", "O ofertă pentru un service auto din Cluj care vrea programări online",
  "Am nevoie de o ofertă pentru o farmacie", "Pregătește-mi rapid o ofertă pentru un dentist", "contactez eu firma, tu pregătește o ofertă pentru un service auto",
  "Vreau să văd oferta", "Arată-mi oferta pentru service", "nu pregăti încă oferta pentru service auto", "Fă o propunere de corectură pentru clip", "trimite oferta la service auto din Cluj",
  "Scrie-le oferta", "Pregătește demo-ul de detailing pentru prezentare",
  // Last review round RC1: a question or a statement about an existing offer is no request for a new one; RR1: a mixed ask keeps the card.
  "Oferta pentru service-ul auto din Cluj a fost aprobată?", "Oferta pentru cabinetul dentar e prea scumpă?", "Ofertele pentru restaurante sunt gata?", "Propunerea pentru restaurant e gata?",
  "Ce ofertă ai pregătit pentru service-ul auto?", "Oferta pentru service-ul din Cluj trimite-o mâine", "Ofertă nouă pentru un service auto din Cluj",
  "Pregătește o ofertă pentru un service auto din Cluj și vreau să o trimiți clientului", "Pregătește o ofertă pentru un service auto din Cluj, poți trimite oferta direct clientului"];
/** RC1: questions about an existing offer are the read of the latest preparation (sales_show), never a new card. */
const OFFER_QUESTIONS = ["Oferta pentru service-ul auto din Cluj a fost aprobată?", "Oferta pentru cabinetul dentar e prea scumpă?", "Ofertele pentru restaurante sunt gata?",
  "Propunerea pentru restaurant e gata?", "Ce ofertă ai pregătit pentru service-ul auto?", "Oferta pentru service-ul auto din Cluj e gata?"];

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
  for (const s of OFFER_QUESTIONS) {
    assert.deepEqual(resolveIntent(s, { projects: [] }).steps.map((x) => x.intent), ["sales_show"], s);
    assert.equal(parseBrief(s).intent, null, s);
  }
  // A correction proposal's question keeps its earlier meaning.
  assert.deepEqual(resolveIntent("Propunerea de corectură e gata?", { projects: [] }).steps.map((x) => x.intent), ["unknown"]);
});

test("M12-FA-BRIEF-04 (F15) typed and through Lega's planner entry, the reviewer's forms give exactly ONE card and no other question; the send is refused on its own", async (c) => {
  const t = await prepHub(c);
  await t.authenticate();
  for (const s of ["Propune o ofertă pentru un service auto și trimite-o", "Pregătește și trimite oferta pentru un service auto din Cluj care vrea programări online",
    "Aș dori o ofertă pentru un service auto din Cluj și trimite-o clientului",
    // Last review round RR1: the instruction introduced by an ask / a modal after „și” — the card stays, the instruction is refused.
    "Pregătește o ofertă pentru o pizzerie din Iași care vrea comenzi online și vreau să o trimiți clientului", "Pregătește o ofertă pentru un service auto din Cluj și te rog să trimiți oferta clientului",
    "Pregătește o ofertă pentru un service auto din Cluj care vrea programări online și mâine trimite-o clientului"]) {
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
  // Last review round RR3: the client's wish in the 1st person plural, also after a sentence break, is the need — never „le”, never a refusal.
  for (const [request, need] of [["Pregătește o ofertă pentru un service auto din Cluj. Vrea să le trimitem clienților remindere prin SMS.", "să le trimitem clienților remindere prin SMS"],
    ["Pregătește o ofertă pentru un service auto din Cluj; vrea să-i contactăm pe clienții care nu au venit la revizie", "să-i contactăm pe clienții care nu au venit la revizie"],
    ["Pregătește o ofertă pentru un service auto din Cluj care vrea să le trimitem remindere clienților", "să le trimitem remindere clienților"],
    ["Pregătește o ofertă pentru un service auto din Cluj, vrea să trimitem automat oferte de revizie clienților lui", "trimitem automat oferte de revizie clienților lui"]]) {
    const b = parseBrief(request);
    assert.deepEqual(b.refused, [], request);
    assert.deepEqual([value(b, "problem"), b.fields.problem.provenance], [need, "USER_PROVIDED"], request);
  }
  // The owner's own instruction in the same sentence is still refused (and only it).
  assert.deepEqual(parseBrief("pregătește o ofertă pentru un service auto din Cluj care vrea să-și contacteze clienții prin SMS și trimite-o clientului").refused.map((r) => r.text), ["trimite-o"]);
});
