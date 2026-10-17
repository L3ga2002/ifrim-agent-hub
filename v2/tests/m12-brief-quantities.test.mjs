// M12 review fixes (parts 2–3) — S-01 / C-02 on the brief and the figures scanner (pure: nothing boots). An amount, a budget or a term
// written in words („trei mii de lei”, „douăzeci de zile”, „jumătate de an”, „5k”) is read as such (budget / deadline, never „missing”)
// and found by the scanner; the client's need is cut, fail closed, before anything that carries a quantity or a commercial promise, the
// whole stated need stays internal and the cut is recorded (never dropped silently, never reported as missing); the need is found also
// when the client type is named inside it; a typo-corrected word is INFERRED (never the owner's statement); a negation does not reach
// across punctuation and ordinary verbs one letter from a send verb are not refused. Review items R1, R2, R4, R13, R14, R15, C1.
import test from "node:test";
import assert from "node:assert/strict";
import { parseBrief } from "../server/sales/brief.mjs";
import { findCommercialFigures, proposalFigures } from "../server/sales/figures.mjs";
import { renderProposal } from "../server/sales/proposal.mjs";

const P = "pregătește o ofertă pentru un service auto din Cluj care vrea ";
const value = (b, f) => b.fields[f]?.value ?? null;
const missing = (b) => b.missing.map((m) => m.field);
const offer = (b) => renderProposal({ org: { displayName: "Firma Sintetică SRL", synthetic: true }, opportunity: {}, services: [], evidence: [], audit: null, owner: { companyName: "Ifrim Digital" },
  brief: { ...b, id: "spp_bq" } });
const requestText = (b) => offer(b).sections.find((s) => s.id === "request")?.text ?? null;
const cutNote = (b) => b.assumptions.find((a) => a.id === "A-NEED-CUT")?.text || "";
const categories = (t) => findCommercialFigures(t).map((f) => f.category);

test("M12-BQ-01 (R1/R2) amounts and terms in words: the scanner finds them; the brief keeps them as budget / deadline (internal, never „missing”); the client text has none", () => {
  const forms = { currency: ["2 mii de lei", "2 mii lei", "două mii de lei", "trei mii de euro", "5k EUR", "1,5 milioane lei", "o mie de lei", "cinci sute de lei",
    "douăzeci și cinci de mii de lei", "câteva mii de lei", "Pachet de la 2 mii de lei", "5k"],
  price: ["preț de două mii"], duration: ["cincisprezece zile", "douăzeci de zile", "jumătate de an", "48h", "2 săpt."], percentage: ["treizeci la sută", "zece procente", "30%"] };
  for (const [category, texts] of Object.entries(forms)) for (const t of texts) assert.ok(categories(t).includes(category), `${category} not found in „${t}”: ${JSON.stringify(findCommercialFigures(t))}`);
  assert.deepEqual(findCommercialFigures("două mii de lei").map((f) => f.text), ["două mii de lei"], "one figure, not its inner part again");
  for (const t of ["un site de prezentare", "costă un site", "prețul unui site", "o pagină de contact", "3 din 7 imagini", "Oraș: Cluj-Napoca"]) assert.deepEqual(findCommercialFigures(t), [], t);
  const cases = [
    [`${P}programări online care să coste cel mult trei mii de lei`, "trei mii de lei", null],
    [`${P}programări online gata în douăzeci de zile`, null, "în douăzeci de zile"],
    [`${P}programări online, buget de două mii de euro`, "buget de două mii de euro", null],
    [`${P}programări online în cincisprezece zile`, null, "în cincisprezece zile"],
    [`${P}programări online de două mii de lei`, "două mii de lei", null],
    [`${P}un site gata în 48h`, null, "în 48h"],
    [`${P}un site de 5k`, "5k", null],
    [`${P}programări online în jumătate de an`, null, "în jumătate de an"],
  ];
  for (const [request, budget, deadline] of cases) {
    const b = parseBrief(request);
    assert.equal(value(b, "budget"), budget, request);
    assert.equal(value(b, "deadline"), deadline, request);
    if (budget) assert.ok(!missing(b).includes("budget"), `budget stated in words is not missing: ${request}`);
    if (deadline) assert.ok(!missing(b).includes("deadline"), `deadline stated in words is not missing: ${request}`);
    assert.deepEqual(findCommercialFigures(value(b, "problem")), [], request);
    const asked = requestText(b);
    assert.ok(asked && !asked.includes(budget || deadline), `${request}: ${asked}`);
    assert.deepEqual(proposalFigures(offer(b)), [], request);
  }
});

test("M12-BQ-02 (R1/R14/C1) the need is cut, fail closed, before a quantity or a commercial promise: the stated need stays internal, the cut is recorded, the need is never „missing”", () => {
  const cases = [
    [`${P}programări online și să crească vânzările cu 30%`, "programări online și să crească vânzările", "programări online și să crească vânzările cu 30%"],
    [`${P}programări online și 20% mai mulți clienți`, "programări online", "programări online și 20% mai mulți clienți"],
    [`${P}programări online cu reamintire cu o zi înainte`, "programări online cu reamintire", "programări online cu reamintire cu o zi înainte"],
    [`${P}programări online și promoții pe site`, "programări online", "programări online și promoții pe site"],
    [`${P}un site în două limbi`, "un site", "un site în două limbi"],
    [`${P}programări online cu un cost de 2 mii lei`, "programări online", "programări online cu un cost"],
    ["pregătește o ofertă pentru o florărie din Iași care vrea un magazin online cu reduceri pentru clienții fideli", "un magazin online", "un magazin online cu reduceri pentru clienții fideli"],
    ["pregătește o ofertă pentru un restaurant din Arad care vrea un site profesionist și profitabil", "un site profesionist", "un site profesionist și profitabil"],
  ];
  for (const [request, kept, stated] of cases) {
    const b = parseBrief(request);
    assert.equal(value(b, "problem"), kept, request);
    assert.equal(b.fields.problem.stated, stated, `${request}: the whole stated need stays internal`);
    assert.equal(b.fields.problem.provenance, "USER_PROVIDED");
    assert.ok(b.request.includes(stated) && b.request.includes(kept));
    assert.match(cutNote(b), /am păstrat în ofertă doar partea fără cifre/, request);
    assert.ok(!missing(b).includes("problem"), request);
    assert.deepEqual(findCommercialFigures(kept), [], request);
    assert.equal(requestText(b), `- ${kept} (sursa: brief:spp_bq#problem; USER_PROVIDED)`);
    assert.deepEqual(proposalFigures(offer(b)), [], request);
  }
  // A need stated only with figures or promises: nothing of it reaches the offer, it stays internal and is not reported as missing.
  for (const [request, stated, service] of [[`${P}să economisească timp cu programări online`, "economisească timp cu programări online", "programări online pe site"],
    [`${P}20% mai mulți clienți`, "20% mai mulți clienți", null]]) {
    const b = parseBrief(request);
    assert.equal(value(b, "problem"), "", request);
    assert.equal(b.fields.problem.stated, stated);
    assert.ok(!missing(b).includes("problem"), "stated by the owner: never „missing”");
    assert.match(cutNote(b), /rămâne internă/);
    assert.equal(value(b, "service"), service, "the service is still read from the whole stated need (internal)");
    assert.equal(requestText(b), null, "no „Ce s-a cerut” section");
    assert.ok(offer(b).warnings.some((w) => w.includes("rămâne internă")), "the warning says why, truthfully");
    assert.deepEqual(proposalFigures(offer(b)), []);
  }
  // Without anything to cut, the need is exactly as before (no extra fields).
  const plain = parseBrief(`${P}programări online`);
  assert.deepEqual(plain.fields.problem, { value: "programări online", provenance: "USER_PROVIDED", span: "care vrea programări online" });
  assert.equal(cutNote(plain), "");
});

test("M12-BQ-03 (R4) the need is found also when the client type is named inside it (after the need marker)", () => {
  for (const [request, problem, clientType] of [
    ["pregătește o ofertă pentru o firmă din Cluj care vrea un site pentru restaurantul ei", "un site pentru restaurantul ei", "restaurantul"],
    ["pregătește o ofertă pentru un client din Cluj care vrea programări online ca la un cabinet stomatologic", "programări online ca la un cabinet stomatologic", "cabinet stomatologic"],
    ["pregătește o ofertă pentru o firmă care are nevoie de un site de prezentare pentru farmacie", "un site de prezentare pentru farmacie", "farmacie"],
  ]) {
    const b = parseBrief(request);
    assert.equal(value(b, "problem"), problem, request);
    assert.equal(value(b, "clientType"), clientType, request);
    assert.equal(b.fields.clientType.provenance, "USER_PROVIDED", "an inflected client type is the owner's word, not a typo");
    assert.ok(!missing(b).includes("problem") && !missing(b).includes("service"), request);
    assert.ok(requestText(b)?.includes(problem));
  }
  // The client type said first, then the need, keeps working; the owner's own „aș vrea” before the client type is never the need.
  assert.equal(value(parseBrief("aș vrea o ofertă pentru un service auto din Cluj care vrea programări online"), "problem"), "programări online");
});

test("M12-BQ-04 (R13) typo tolerance never makes an ordinary word the owner's client type or place; a typo-corrected value is INFERRED with its rule", () => {
  for (const request of ["pregătește o ofertă optimă pentru o firmă care vrea un site", "pregătește o ofertă pentru o firmă care are o cabină și vrea programări online",
    "pregătește o ofertă pentru un client din Arieș care vrea un site", "pregătește o ofertă pentru o firmă care vrea un site pentru contabila ei"]) {
    const b = parseBrief(request);
    for (const f of ["clientType", "sector", "caen", "place", "county", "city"]) assert.equal(b.fields[f], null, `${f}: ${request}`);
    assert.deepEqual(b.corrections, [], request);
    assert.ok(missing(b).includes("clientType"));
  }
  const typo = parseBrief("pregătește o ofertă pentru un servcie auto din Cluj care vrea programări online");
  assert.deepEqual([typo.fields.clientType.value, typo.fields.clientType.provenance, typo.fields.clientType.rule, typo.fields.clientType.from], ["service auto", "INFERRED", "R-TYPO@1", "servcie auto"]);
  assert.equal(typo.fields.sector.value, "service auto");
  assert.ok(typo.assumptions.some((a) => a.id === "A-TYPO" && a.text.includes("„servcie auto”")));
  assert.ok(typo.missing.some((m) => m.field === "clientType" && m.text.includes("greșeală de tastare")), "still to confirm");
  assert.ok(!Object.values(typo.fields).some((f) => f?.provenance === "USER_PROVIDED" && String(f.value).includes("service auto")), "never attributed to the owner");
  const place = parseBrief("pregătește o ofertă pentru un service auto din Clujj care vrea programări online");
  assert.equal(place.fields.place, null, "a 4-letter place name is never typo-matched");
  const seat = parseBrief("pregătește o ofertă pentru un service auto din Timișora care vrea programări online");
  assert.deepEqual([seat.fields.place.value, seat.fields.place.provenance, seat.fields.place.rule], ["Timișoara", "INFERRED", "R-TYPO@1"]);
  assert.ok(seat.missing.some((m) => m.field === "place"));
});

test("M12-BQ-05 (R15) a negation never reaches across punctuation; ordinary verbs one letter from a send / contact / publish verb are not refused", () => {
  for (const [request, kind] of [["Nu, trimite oferta clientului. Pregătește o ofertă pentru un service auto din Cluj", "send"],
    ["pregătește o ofertă pentru un service auto din Cluj; nu, contactează-i direct", "contact"], ["Pregătește o ofertă pentru un service auto din Cluj. Nu. Trimite oferta clientului.", "send"]]) {
    const b = parseBrief(request);
    assert.deepEqual(b.refused.map((r) => r.kind), [kind], request);
    assert.equal(b.fields.constraints, null, "the send request is not turned into a „Nu” constraint");
  }
  assert.deepEqual(parseBrief(`${P}programări online, fără să trimiți nimic`).refused, [], "a negated send is still a constraint");
  for (const request of ["pregătește o ofertă pentru un service auto din Cluj care contractează des firme și vrea programări online",
    "pregătește o ofertă pentru un service auto din Cluj care vrea un site care nu costează mult", "pregătește o ofertă pentru un magazin online cu comenzi primite pe site"]) {
    assert.deepEqual(parseBrief(request).refused, [], request);
  }
  assert.deepEqual(parseBrief("contacteza firma din Cluj").refused.map((r) => [r.kind, Boolean(r.typo)]), [["contact", true]], "a real misspelt contact verb is still refused");
});
