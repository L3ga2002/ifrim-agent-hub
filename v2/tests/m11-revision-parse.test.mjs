// Milestone 11 — the delivery revision classifier (v2/server/delivery/revision.mjs), pure: one owner sentence → clauses with a
// class, a target and explicit operations. The reference sentence is the golden case. The clip is the REAL master built by
// clip-ir.mjs from hand-described captures and the REAL variant derived from it; operations are checked by applying them with the
// real review.applyOps. No Hub, no model.
import test from "node:test";
import assert from "node:assert/strict";
import { validateIR, timelineDuration, irHash } from "../server/media/ir.mjs";
import { applyOps } from "../server/media/review.mjs";
import { deriveVariant } from "../server/media/variants.mjs";
import { PRESETS } from "../server/media/visual-bible.mjs";
import { buildMasterIR, LABEL_ITEM_ID } from "../server/delivery/clip-ir.mjs";
import { REVISION_CLASSES, REVISION_RECORD_STATUS, SUMMARY_SECTIONS, RECENT_WINDOW_MS, MAX_OPTIONS, classify, splitClauses, previewOps, toneFrom, jumpToMarker } from "../server/delivery/revision.mjs";
// The Room side of the same contract (pure): the selection and the request body the UI really builds.
import { clipSlots, selectionFor, revisionBody, AUTO_SECTION_IDS } from "../web/src/lib/deliveryLogic.js";

// ---------------------------------------------------------------- fixtures

const TEXTS = {
  hook: { criteria: ["AC-1"], business: "Programări online pentru detailing — demo", technical: "Fix verificat: intervalele ocupate pe telefon (AC-1)" },
  desktop: { criteria: ["AC-7"], business: "Clientul alege serviciul și ora", technical: "E2E desktop 1280×800: PASS" },
  mobile: { criteria: ["AC-1", "AC-6"], business: "Pe telefon, orele ocupate nu mai pot fi alese", technical: "AC-1 + AC-6: interval ocupat → indisponibil (390 px)" },
  cta: { criteria: [], business: "Hai să discutăm", technical: "Pachet local, gata de verificare" },
};
const BOOKED = ".slot[data-booked='true'][aria-disabled='true']";
const markers = (role) => [
  { kind: "chapter", atMs: 0, note: "intro" }, { kind: "demo", atMs: 800, note: `programare ${role === "desktop" ? "desktop" : "mobil"}` },
  { kind: "highlight", atMs: 4000, note: BOOKED, rect: { x: 0.25, y: 0.45, w: 0.12, h: 0.06 } },
  { kind: "highlight", atMs: 11800, note: "[data-state='success']", rect: { x: 0.1, y: 0.7, w: 0.8, h: 0.08 } },
  { kind: "proof", atMs: 13000, note: "Programare confirmată" },
];
// Desktop 17,6 s (528 frames) then the phone-width capture: 'programare mobil' sits at 528 + 24 = frame 552 = 0:18,4.
const MASTER = buildMasterIR({
  captures: [
    { role: "desktop", assetVersionId: "mav_desk", durationMs: 17600, width: 1920, height: 1080, captureLabel: "ORIGINAL_RECORDING", markers: markers("desktop"), evidenceSelectors: [BOOKED], proofSelector: "[data-state='success']" },
    { role: "mobile", assetVersionId: "mav_mob", durationMs: 16500, width: 780, height: 1688, captureLabel: "ORIGINAL_RECORDING", markers: markers("mobile"), evidenceSelectors: [BOOKED], proofSelector: "[data-state='success']" },
  ],
  texts: TEXTS, tone: "both", passed: ["AC-1", "AC-6", "AC-7"], claimIdsByCriterion: { "AC-1": "ccl_1", "AC-6": "ccl_6", "AC-7": "ccl_7" }, deliveryId: "dlv_mux1abcd_0123456789", noun: "programare", evidenceNote: "interval ocupat pe telefon",
});
const VERTICAL = deriveVariant({ masterIr: MASTER, platformKey: "shorts_9x16", overrides: { hookText: "Programări online — demo", ctaText: "Hai să vorbim" } }).ir;
const CTX = { master: { versionId: "mev_master_1", ir: MASTER }, vertical: { versionId: "mev_vertical_1", ir: VERTICAL, variantId: "mvr_1" }, summary: { documentId: "ddoc_1", version: 1 }, texts: TEXTS, tone: "both" };
const run = (text, extra = {}) => classify(text, { ...CTX, ...extra });
const REFERENCE = "Site-ul e bine. Clipul este prea tehnic; după secunda zece arată direct programarea.";
const text = (ir, id) => ir.tracks.filter((t) => t.kind === "text").flatMap((t) => t.items).find((i) => i.id === id)?.text;
const throwsCode = (fn, expected) => assert.throws(fn, (e) => { assert.equal(e.code, expected, `${e.code}: ${e.message}`); return true; });

// ---------------------------------------------------------------- the golden sentence

test("M11-RV-01 GOLDEN „Site-ul e bine. Clipul este prea tehnic; după secunda zece arată direct programarea.” → feedback + tone business + cut 10 s → marker", () => {
  assert.deepEqual(splitClauses(REFERENCE), ["Site-ul e bine", "Clipul este prea tehnic", "după secunda zece arată direct programarea"]);
  const r = run(REFERENCE);
  assert.deepEqual(r.clauses.map((c) => c.class), ["feedback", "tone", "clip"]);
  assert.deepEqual(r.classes, ["feedback", "tone", "clip"]);
  // No software class, no question: one marker matches after second 10.
  assert.ok(!r.classes.includes("software"));
  assert.equal(r.software, null);
  assert.equal(r.clarification, null);
  assert.equal(r.status, "PROPOSE");
  assert.deepEqual(r.actions, ["media"]);
  // 1. „Site-ul e bine” is feedback only — noted, never an acceptance.
  const [feedback, tone, jump] = r.clauses;
  assert.deepEqual([feedback.ops, feedback.target, feedback.decision, feedback.refused], [[], null, undefined, undefined]);
  assert.deepEqual(r.feedback, [{ index: 0, text: "Site-ul e bine", subject: "software", polarity: "positive", message: "Notat că site-ul e bine. Acceptarea software rămâne butonul „Accept local” din camera de livrare." }]);
  assert.deepEqual(r.messages, [r.feedback[0].message]);
  // 2. „prea tehnic” → business: the brief's audience and replace_text on the t-* items that change.
  assert.equal(tone.tone, "business");
  assert.deepEqual(tone.brief, { audience: "business" });
  assert.deepEqual(tone.ops, [{ op: "replace_text", itemId: "t-desktop", text: TEXTS.desktop.business }, { op: "replace_text", itemId: "t-mobile", text: TEXTS.mobile.business }]);
  // 3. „după secunda zece arată direct programarea” → from frame 300 to the first 'programare' marker after 10 s ('programare mobil').
  assert.deepEqual(jump.ops, [{ op: "cut_range", from: 300, to: 552 }]);
  assert.deepEqual([jump.jump.afterSec, jump.jump.marker.note, jump.jump.marker.kind, jump.jump.marker.time], [10, "programare mobil", "demo", "0:18,4"]);
  assert.deepEqual(jump.prefs, { jump: { afterSec: 10, markerNote: "programare" } });
  // The plan input: ONE target (the master), tone texts first, the cut last; brief delta and kept preferences.
  assert.deepEqual(r.target, { kind: "master", id: null, versionId: "mev_master_1" });
  assert.deepEqual(r.media.target, r.target);
  assert.deepEqual(r.media.ops, [...tone.ops, { op: "cut_range", from: 300, to: 552 }]);
  assert.deepEqual(r.media.brief, { audience: "business" });
  assert.deepEqual(r.media.prefs, { tone: "business", jump: { afterSec: 10, markerNote: "programare" } });
  assert.deepEqual(r.media.lines, ["2 texte de ton (comercial)", "taie 0:10–0:18,4, salt la «programare mobil»"]);
  assert.deepEqual(r.media.preview, { ok: true, durationMs: { before: 34100, after: 25700 } });
  assert.deepEqual([r.vertical, r.summary], [null, null]);
  // Applied with the real review code: a valid IR, 8,4 s shorter, business texts, and the clip goes straight to the phone booking.
  const out = applyOps(MASTER, r.media.ops);
  assert.equal(validateIR(out, { presets: PRESETS }).ok, true);
  assert.equal(timelineDuration(out), timelineDuration(MASTER) - 252);
  assert.equal(text(out, "t-mobile"), TEXTS.mobile.business);
  assert.equal(text(out, LABEL_ITEM_ID), "DATE SINTETICE · DEMO LOCAL"); // the label is never a tone text
  assert.equal(out.markers.find((m) => m.note === "programare mobil").frame, 300);
  assert.equal(r.textRedacted, REFERENCE);
  assert.equal(r.text, undefined); // only the redacted text travels on
  // The parser's proposals reach the owner as notes (here: none — every amount was said).
  assert.deepEqual(r.notes, []);
});

test("M11-RV-02 „prea tehnic” alone gives tone operations only; „prea comercial” goes the other way; an equal tone changes nothing", () => {
  for (const phrase of ["prea tehnic", "Clipul e prea tehnic.", "E prea tehnic clipul", "Mai puțin tehnic, te rog"]) {
    const r = run(phrase);
    assert.deepEqual([r.classes, r.status, r.clarification], [["tone"], "PROPOSE", null], phrase);
    assert.ok(r.media.ops.length === 2 && r.media.ops.every((o) => o.op === "replace_text" && /^t-/.test(o.itemId)), phrase);
    assert.deepEqual([r.media.brief, r.media.prefs], [{ audience: "business" }, { tone: "business" }]);
    assert.deepEqual(r.media.lines, ["2 texte de ton (comercial)"]);
  }
  const technical = run("Clipul e prea comercial");
  assert.deepEqual(technical.clauses[0].tone, "technical");
  assert.deepEqual(technical.media.ops.map((o) => o.itemId), ["t-hook", "t-cta"]);
  assert.deepEqual(technical.media.brief, { audience: "technical" });
  // Already business: no operation, an honest note, nothing to propose.
  const business = buildMasterIR({ captures: [
    { role: "desktop", assetVersionId: "mav_desk", durationMs: 17600, width: 1920, height: 1080, captureLabel: "ORIGINAL_RECORDING", markers: markers("desktop") },
    { role: "mobile", assetVersionId: "mav_mob", durationMs: 16500, width: 780, height: 1688, captureLabel: "ORIGINAL_RECORDING", markers: markers("mobile") }], texts: TEXTS, tone: "business", passed: ["AC-1", "AC-6", "AC-7"] });
  const same = run("prea tehnic", { master: { versionId: "mev_b", ir: business }, tone: "business" });
  assert.deepEqual([same.media, same.status, same.actions, same.clauses[0].ops, same.clauses[0].brief], [null, "NOTED", [], [], null]);
  assert.deepEqual(same.messages, ["Clipul are deja tonul comercial; textele rămân la fel."]);
  // „nu e prea tehnic” is a judgement, not a request; the summary has no tone variants.
  assert.deepEqual([run("Nu e prea tehnic").classes, run("Nu e prea tehnic").media], [["feedback"], null]);
  const summaryTone = run("Rezumatul e prea tehnic");
  assert.deepEqual([summaryTone.status, summaryTone.clauses[0].refused, summaryTone.media], ["REFUSED", "SUMMARY_TONE", null]);
  // The rule alone.
  assert.deepEqual(["Clipul este prea tehnic", "prea comercial", "Nu e prea tehnic", "Clipul e bine", "Mai tehnic, te rog", "E «prea tehnic» scris pe ecran"].map(toneFrom), ["business", "technical", null, null, "technical", null]);
  // Without the template texts or the montage the decision is still returned, with what is missing.
  assert.equal(run("prea tehnic", { texts: null }).clauses[0].needs, "texts");
  assert.equal(run("prea tehnic", { master: { versionId: "mev_master_1" } }).clauses[0].needs, "ir");
});

test("M11-RV-03 the jump is read in its spoken forms and always ends at a marker", () => {
  const cut = { op: "cut_range", from: 300, to: 552 };
  for (const phrase of ["După secunda zece arată direct programarea.", "De la secunda 10 sari la programare", "După 10 secunde treci la programare", "după secunda 10, arată direct programarea pe telefon",
    "Arată direct programarea după secunda zece", "De la 0:10 sari direct la programare", "Lega, după secunda zece arată-mi direct programarea"]) {
    const r = run(phrase);
    assert.deepEqual(r.media?.ops, [cut], phrase);
    assert.equal(r.clarification, null, phrase);
    assert.deepEqual(r.classes, ["clip"], phrase);
  }
  assert.deepEqual(run("După secunda 20 arată direct finalul").media.ops, [{ op: "cut_range", from: 600, to: 948 }]);
  assert.deepEqual(run("După secunda zece arată direct intervalul ocupat").media.ops, [{ op: "cut_range", from: 300, to: 648 }]);
  // „de aici”: the player's position is the time; without one, ONE question about the time.
  assert.deepEqual(run("De aici sari la programare", { timecodeMs: 10000 }).media.ops, [cut]);
  const noTime = run("De aici sari la programare");
  assert.deepEqual([noTime.status, noTime.clarification.kind, noTime.media], ["CLARIFY", "time", null]);
  // The rule alone: the same resolution, or null when the sentence asks for no jump.
  const alone = jumpToMarker("după secunda zece arată direct programarea", MASTER);
  assert.deepEqual([alone.ok, alone.afterSec, alone.phrase, alone.op, alone.needle], [true, 10, "programarea", cut, "programare"]);
  assert.deepEqual([jumpToMarker("de aici sari la programare", MASTER).reason, jumpToMarker("de aici sari la programare", MASTER, { timecodeMs: 10000 }).to], ["TIME_MISSING", 552]);
  assert.equal(jumpToMarker("Clipul e prea tehnic", MASTER), null);
  assert.equal(jumpToMarker("după secunda zece arată direct plata", MASTER).reason, "NO_MARKER");
  // A time expression that is not a jump stays an ordinary clip instruction (parseInstruction).
  assert.deepEqual(run("Taie de la 10 la 12").media.ops, [{ op: "cut_range", from: 300, to: 360 }]);
});

test("M11-RV-04 no matching marker → ONE question listing the markers with their times; the answer resolves without a second question", () => {
  const r = run("După secunda zece arată direct plata");
  assert.equal(r.status, "CLARIFY");
  assert.equal(r.media, null);
  assert.deepEqual([r.clarification.kind, r.clarification.pending], ["marker", 0]);
  assert.equal(r.clarification.question, "Nu am găsit un moment marcat „plata” după secunda 10. Momentele marcate: 0:18,4 programare mobil · 0:21,6 interval ocupat pe telefon · 0:31,6 final. La care sar?");
  assert.deepEqual(r.clarification.options, [{ id: "marker:552", label: "0:18,4 programare mobil", markerFrame: 552 }, { id: "marker:648", label: "0:21,6 interval ocupat pe telefon", markerFrame: 648 }, { id: "marker:948", label: "0:31,6 final", markerFrame: 948 }]);
  assert.ok(r.clarification.options.length <= MAX_OPTIONS);
  // The owner picks a marker: the same sentence with the choice gives the cut.
  const answered = run("După secunda zece arată direct plata", { choice: { markerFrame: 648 } });
  assert.deepEqual([answered.status, answered.clarification, answered.media.ops], ["PROPOSE", null, [{ op: "cut_range", from: 300, to: 648 }]]);
  // After the last 'programare' marker there is none left: a question, never a cut at a guessed second.
  const late = run("După secunda 25 arată direct programarea");
  assert.deepEqual([late.status, late.clarification.kind, late.clarification.options.map((o) => o.label)], ["CLARIFY", "marker", ["0:31,6 final"]]);
  const beyond = run("După secunda 90 arată direct programarea");
  assert.match(beyond.clarification.question, /Clipul are doar 0:34,1/);
  // Two matching markers at the same frame: also ONE question.
  const twin = JSON.parse(JSON.stringify(MASTER));
  twin.markers.push({ frame: 552, kind: "note", note: "programare rapidă" });
  const amb = run("După secunda zece arată direct programarea", { master: { versionId: "mev_master_1", ir: twin } });
  assert.deepEqual([amb.status, amb.clarification.kind, amb.clarification.options.length], ["CLARIFY", "marker", 2]);
  assert.match(amb.clarification.question, /Două momente marcate sunt în același loc/);
});

test("M11-RV-05 „schimbă titlul”: clip and summary both plausible and no selection → exactly ONE question; a selection or a timecode → none", () => {
  const r = run("schimbă titlul");
  assert.equal(r.status, "CLARIFY");
  assert.deepEqual([r.media, r.summary, r.software], [null, null, null]);
  assert.deepEqual(r.clarification, { index: 0, kind: "target", question: "Titlul clipului sau titlul rezumatului? Spune și textul nou, între ghilimele.", pending: 0,
    options: [{ id: "master", label: "Titlul clipului", target: "master" }, { id: "summary", label: "Titlul rezumatului", target: "summary" }] });
  // With the new text given: still the target question (and only it).
  const quoted = run("schimbă titlul în «Programări rapide»");
  assert.deepEqual([quoted.status, quoted.clarification.kind, quoted.clarification.question], ["CLARIFY", "target", "Titlul clipului sau titlul rezumatului?"]);
  // A selection in the Room (on the current version): no question — the hook is replaced.
  const selected = run("schimbă titlul în «Programări rapide»", { selection: { kind: "master", id: "t-hook", versionId: "mev_master_1" } });
  assert.deepEqual([selected.status, selected.clarification, selected.clauses[0].targetBy], ["PROPOSE", null, "selection"]);
  assert.deepEqual(selected.media.ops, [{ op: "replace_text", itemId: "t-hook", text: "Programări rapide" }]);
  // A timecode (the player's position): no question either — the clip.
  const timed = run("schimbă titlul în «Programări rapide»", { timecodeMs: 12000 });
  assert.deepEqual([timed.status, timed.clarification, timed.clauses[0].targetBy, timed.media.ops], ["PROPOSE", null, "timecode", [{ op: "replace_text", itemId: "t-hook", text: "Programări rapide" }]]);
  // The owner's answer to the question.
  assert.deepEqual(run("schimbă titlul în «Programări rapide»", { choice: { target: "master" } }).media.ops, [{ op: "replace_text", itemId: "t-hook", text: "Programări rapide" }]);
  const toSummary = run("schimbă titlul în «Altceva»", { choice: { target: "summary" } });
  assert.deepEqual([toSummary.status, toSummary.clauses[0].refused, toSummary.summary], ["REFUSED", "SUMMARY_TITLE_GENERATED", null]);
  // With only one artifact in the delivery there is nothing to ask.
  assert.equal(run("schimbă titlul în «Programări rapide»", { summary: null }).clarification, null);
  // The artifact revised less than 10 minutes ago in this delivery is the target; later than that, the question returns.
  const now = 1_800_000_000_000;
  assert.deepEqual(run("schimbă titlul în «X nou»", { lastRevised: { kind: "master", atMs: now - 60_000 }, nowMs: now }).clauses[0].targetBy, "recent");
  assert.equal(run("schimbă titlul în «X nou»", { lastRevised: { kind: "master", atMs: now - RECENT_WINDOW_MS - 1 }, nowMs: now }).status, "CLARIFY");
  assert.equal(run("schimbă titlul în «X nou»", { lastRevised: { kind: "master", atMs: now - 60_000 } }).status, "CLARIFY"); // no clock given: not guessed
  // A selection made on an older version is not a target.
  const stale = run("schimbă titlul în «Programări rapide»", { selection: { kind: "master", id: "t-hook", versionId: "mev_master_0" } });
  assert.equal(stale.status, "CLARIFY");
  assert.ok(stale.notes.includes("Selecția era pe o versiune mai veche; am ignorat-o."));
});

test("M11-RV-06 at most ONE question per revision, with at most three options", () => {
  const r = run("Schimbă titlul. După secunda zece arată direct plata. Clipul e prea lung.");
  assert.equal(r.status, "CLARIFY");
  assert.deepEqual([r.clarification.kind, r.clarification.index, r.clarification.pending], ["target", 0, 2]);
  assert.equal(r.clauses.filter((c) => c.clarification).length, 3); // each clause knows its own gap; only the first is asked
  for (const phrase of ["Schimbă titlul", "După secunda zece arată direct plata", "Clipul e prea lung", "În rezumat scrie ceva", "Fă textul de final mai scurt"]) {
    const one = run(phrase);
    assert.equal(one.status, "CLARIFY", phrase);
    assert.ok(one.clarification.options.length <= 3, phrase);
    assert.equal(typeof one.clarification.question, "string");
  }
  // A clear clause next to an unclear one: still a question, and the status says nothing is proposed until it is answered. The
  // clip named in the first sentence is the target of the second (no target question) — what is missing is the new text.
  const mixed = run("Clipul e prea tehnic. Schimbă titlul.");
  assert.deepEqual([mixed.status, mixed.clarification.kind, mixed.clauses[1].targetBy, mixed.clarification.pending], ["CLARIFY", "instruction", "sentence", 0]);
  assert.match(mixed.clarification.question, /între ghilimele/);
  // A judgement about something that is not the delivery is not feedback about it.
  assert.deepEqual([run("E bine").feedback.map((f) => f.subject), run("Totul arată bine").status, run("Vremea e frumoasă azi").feedback], [["general"], "NOTED", []]);
});

test("M11-RV-07 software needs a software noun AND a change verb; a text change never becomes coding", () => {
  for (const phrase of ["Adaugă câmpul număr de înmatriculare în formular", "Adaugă câmpul număr de înmatriculare.", "Butonul să fie verde", "Repară pagina de programări", "Formularul nu merge pe telefon",
    "Schimbă titlul paginii în «Programări»", "În aplicație, mută butonul mai sus"]) {
    const r = run(phrase);
    assert.deepEqual([r.classes, r.status, r.actions], [["software"], "ROUTE_SOFTWARE", ["software"]], phrase);
    assert.deepEqual([r.media, r.vertical, r.summary, r.clarification], [null, null, null, null], phrase);
    assert.equal(r.software.request, phrase.replace(/\.$/, ""));
  }
  // A software noun WITHOUT a change verb is feedback or nothing — never a software request.
  for (const phrase of ["Site-ul e bine", "Site-ul e bine.", "Aplicația arată foarte bine", "Formularul e ok", "Butonul e frumos"]) {
    const r = run(phrase);
    assert.deepEqual([r.classes, r.status, r.software, r.media, r.actions], [["feedback"], "NOTED", null, null, []], phrase);
    assert.match(r.messages[0], /^Notat că /);
    assert.match(r.messages[0], /Acceptarea software rămâne butonul „Accept local”/);
  }
  assert.deepEqual(run("Site-ul nu e bine").feedback.map((f) => [f.subject, f.polarity]), [["software", "negative"]]);
  // A change verb WITHOUT a software noun is never software; a text on screen that mentions a button is a clip text.
  for (const phrase of ["Schimbă textul «Rezervă acum» în «Programează»", "Mută textul de pe buton mai sus", "Fă textul de final mai scurt", "Schimbă titlul în «Formular nou»", "Taie de la 10 la 12",
    "În clip, scoate partea cu formularul", "În rezumat, la Cum funcționează scrie «Formular de programare și buton de confirmare»",
    // quoted words are the new TEXT, never the request: a quote that names the page or a repair does not make it coding
    "Schimbă textul de final în «Repară pagina de programări»", "Schimbă titlul în «Aplicația ta de programări»"]) {
    const r = run(phrase);
    assert.ok(!r.classes.includes("software") && r.software === null, `${phrase} → ${r.classes}`);
  }
  // A software request wins over a clip selection: the sentence says what it is about.
  const selected = run("Butonul să fie verde", { selection: { kind: "master", id: "t-hook", versionId: "mev_master_1" }, timecodeMs: 5000 });
  assert.deepEqual(selected.classes, ["software"]);
  assert.ok(selected.notes.some((n) => /am urmat fraza, nu selecția/.test(n)));
  // Mixed: a clip revision and a software request in one sentence are both returned, each for its own flow.
  const both = run("Clipul e prea tehnic. Adaugă câmpul număr de înmatriculare în formular.");
  assert.deepEqual([both.classes, both.actions, both.status], [["tone", "software"], ["media", "software"], "PROPOSE"]);
});

test("M11-RV-08 decisions Lega never takes: accept, approve, publish — answered with where the owner's own button is", () => {
  const cases = [["Accept software-ul", "software_accept", /butonul „Accept local”/], ["Acceptă livrarea", "software_accept", /Eu nu accept nimic în locul tău/], ["Aprob clipul", "creative_approve", /Windows Hello/],
    ["Aprobă varianta verticală", "creative_approve", /Aprobarea creativă este decizia ta/], ["Aprob rezumatul", "summary_approve", /Gata de prezentare/], ["Publică clipul", "publish", /Publicarea este oprită/],
    ["Postează clipul pe TikTok", "publish", /nu se publică, nu se urcă și nu se trimite nimic/], ["Trimite clipul clientului", "publish", /Publicarea este oprită/], ["Urcă clipul pe YouTube", "publish", /Publicarea este oprită/]];
  for (const [phrase, decision, message] of cases) {
    const r = run(phrase);
    assert.deepEqual([r.status, r.classes, r.actions], ["REFUSED", ["feedback"], []], phrase);
    assert.deepEqual([r.clauses[0].decision, r.clauses[0].refused, r.clauses[0].ops], [decision, "OWNER_DECISION", []], phrase);
    assert.deepEqual([r.media, r.vertical, r.summary, r.software, r.clarification], [null, null, null, null, null], phrase);
    assert.match(r.messages[0], message, phrase);
  }
  // „urcă” is a move, not an upload, when it names a direction.
  const up = run("Urcă titlul mai sus");
  assert.deepEqual(up.media.ops, [{ op: "move_text", itemId: "t-hook", dx: 0, dy: -0.08 }]);
  assert.ok(up.notes.some((n) => /^propunere: 8%/.test(n))); // the unstated distance is shown as a proposal, never applied silently
  // Feedback next to a refused decision: noted, and the decision is still not taken.
  const mixed = run("Site-ul e bine. Accept software-ul.");
  assert.deepEqual([mixed.status, mixed.feedback.length, mixed.actions], ["NOTED", 2, []]);
  assert.deepEqual(REVISION_RECORD_STATUS, { CLARIFY: "CLARIFY", PROPOSE: "PROPOSED", SUMMARY_EDIT: "PROPOSED", ROUTE_SOFTWARE: "ROUTED_SOFTWARE", REFUSED: "REFUSED", NOTED: "NOTED", UNKNOWN: "NOTED" });
});

test("M11-RV-09 vertical only: the variant's version is the target and the master is untouched", () => {
  const r = run("În varianta verticală mută titlul mai sus.");
  assert.deepEqual([r.classes, r.status, r.clarification], [["vertical"], "PROPOSE", null]);
  assert.equal(r.media, null);
  assert.deepEqual(r.vertical.target, { kind: "vertical", id: "mvr_1", versionId: "mev_vertical_1" });
  assert.deepEqual(r.vertical.ops, [{ op: "move_text", itemId: "t-hook", dx: 0, dy: -0.08 }]);
  assert.equal(r.vertical.preview.ok, true);
  const moved = applyOps(VERTICAL, r.vertical.ops);
  assert.equal(validateIR(moved, { presets: PRESETS }).ok, true);
  assert.notEqual(irHash(moved), irHash(VERTICAL));
  for (const phrase of ["Pe vertical mută titlul mai jos", "În 9:16 mută titlul mai sus", "La shorts mută titlul puțin mai sus"]) assert.deepEqual(run(phrase).classes, ["vertical"], phrase);
  // The selection counts only on the version it was made on; the words still decide the artifact.
  const sel = run("În varianta verticală mută textul mai sus", { selection: { kind: "master", id: "t-cta", versionId: "mev_master_1" } });
  assert.deepEqual(sel.classes, ["vertical"]);
  assert.ok(sel.notes.some((n) => /am urmat fraza/.test(n)));
  // A delivery without a variant yet says so instead of guessing.
  const none = run("În varianta verticală mută titlul mai sus", { vertical: null });
  assert.deepEqual([none.vertical, none.clauses[0].needs], [null, "vertical"]);
});

test("M11-RV-10 summary only: a section edit with the quoted text — no plan, no code; generated sections are not edited by hand", () => {
  assert.equal(SUMMARY_SECTIONS.length, 10);
  const r = run("În rezumat, la Următorul pas scrie «O discuție scurtă, apoi oferta».");
  assert.deepEqual([r.classes, r.status, r.actions, r.clarification], [["summary"], "SUMMARY_EDIT", ["summary"], null]);
  assert.deepEqual(r.summary, { target: { kind: "summary", id: "ddoc_1", versionId: 1 }, edits: [{ id: "next_step", text: "O discuție scurtă, apoi oferta" }] });
  assert.deepEqual([r.media, r.vertical, r.software], [null, null, null]);
  assert.deepEqual(run("În rezumat, la Ce nu putem afirma scrie „Mentenanță”").summary.edits, [{ id: "cannot_claim", text: "Mentenanță" }]);
  // „Cum funcționează” is the flow, never „Ce demonstrăm” (whose alias „ce funcționează” is a different phrase).
  assert.deepEqual(run("În rezumat, la Cum funcționează scrie «Alegi ora»").summary.edits, [{ id: "how", text: "Alegi ora" }]);
  assert.deepEqual(run("În ofertă, la secțiunea Preț și termen pune «De stabilit împreună»").summary.edits, [{ id: "price_terms", text: "De stabilit împreună" }]);
  // «vechi» în «nou» inside a section whose text is known.
  const sections = SUMMARY_SECTIONS.map((s) => ({ ...s, text: s.id === "problem" ? "Demo local pentru prezentare, cu date sintetice." : "" }));
  assert.deepEqual(run("În rezumat, la Problema schimbă «Demo local» în «Demonstrație locală»", { summary: { documentId: "ddoc_1", version: 2, sections } }).summary.edits,
    [{ id: "problem", text: "Demonstrație locală pentru prezentare, cu date sintetice." }]);
  // The selected section is the target when the sentence names none.
  assert.deepEqual(run("scrie «Sunați-ne»", { selection: { kind: "summary", id: "next_step" } }).summary.edits, [{ id: "next_step", text: "Sunați-ne" }]);
  // Missing section or text: ONE question; auto sections and the title are refused honestly.
  assert.deepEqual([run("În rezumat scrie «ceva»").clarification.kind, run("În rezumat, la Următorul pas scrie altceva").clarification.kind], ["text", "text"]);
  const auto = run("În rezumat, la Materiale video scrie «Clip nou»");
  assert.deepEqual([auto.status, auto.clauses[0].refused, auto.summary], ["REFUSED", "SUMMARY_SECTION_AUTO", null]);
  assert.equal(run("În rezumat, la Trasabilitate scrie «x»").clauses[0].refused, "SUMMARY_SECTION_AUTO");
  // „Trasabilitate” is GENERATED like „Materiale video” (the facts of the verified bundle). The refusal is honest about where each
  // comes from AND about where the owner's own words can go instead.
  assert.deepEqual(auto.messages, ["Secțiunea «Materiale video» se generează din clipurile curente (fișiere, durată, QA) și nu se editează de mână. "
    + "Observațiile tale le scrii într-o secțiune editabilă, de exemplu «Următorul pas» sau «Problema»: spune secțiunea și textul nou, între ghilimele."]);
  const trace = run("În rezumat, la Trasabilitate scrie «Pachet verificat de mine»");
  assert.deepEqual([trace.status, trace.clauses[0].refused, trace.summary, trace.clarification, trace.actions], ["REFUSED", "SUMMARY_SECTION_AUTO", null, null, []]);
  assert.deepEqual(trace.messages, ["Secțiunea «Trasabilitate» se generează din faptele pachetului verificat (pachet, amprente, specificație) și nu se editează de mână. "
    + "Observațiile tale le scrii într-o secțiune editabilă, de exemplu «Următorul pas» sau «Problema»: spune secțiunea și textul nou, între ghilimele."]);
  // Generated whatever the caller's section list claims; the sections it suggests are editable ones this document really has.
  const claimed = run("În rezumat, la Trasabilitate scrie «x»", { summary: { documentId: "ddoc_1", version: 2, sections: SUMMARY_SECTIONS.map((s) => ({ id: s.id, heading: s.heading, auto: false })) } });
  assert.equal(claimed.clauses[0].refused, "SUMMARY_SECTION_AUTO");
  const few = run("În rezumat, la Trasabilitate scrie «x»", { summary: { documentId: "ddoc_1", version: 2, sections: [{ id: "video", heading: "Materiale video" }, { id: "scope", heading: "Ce include" }, { id: "provenance", heading: "Trasabilitate" }] } });
  assert.match(few.messages[0], /de exemplu «Ce include»: spune secțiunea/);
  assert.doesNotMatch(few.messages[0], /«Materiale video» sau|sau «Materiale video»/, "a generated section is never suggested as the place to write");
  // One rule on both sides: the Room locks exactly the sections the Hub refuses (web/src/lib/deliveryLogic.js).
  assert.deepEqual(SUMMARY_SECTIONS.filter((s) => s.auto).map((s) => s.id), [...AUTO_SECTION_IDS]);
  assert.deepEqual(SUMMARY_SECTIONS.filter((s) => s.auto).map((s) => s.heading), ["Materiale video", "Trasabilitate"]);
  assert.equal(run("Schimbă titlul rezumatului în «Ofertă»").clauses[0].refused, "SUMMARY_TITLE_GENERATED");
  // Words name the summary although a clip text is selected: the sentence wins, with a note.
  const sel = run("În rezumat, la Următorul pas scrie «Sunați-ne»", { selection: { kind: "master", id: "t-hook", versionId: "mev_master_1" }, timecodeMs: 3000 });
  assert.deepEqual([sel.classes, sel.media, sel.summary.edits[0].id], [["summary"], null, "next_step"]);
  assert.ok(sel.notes.some((n) => /am urmat fraza/.test(n)));
});

test("M11-RV-11 clip instructions are delegated to the review parser on the current version; several clauses become one ordered operation list", () => {
  const r = run("Taie de la 10 la 12 și mută textul mai sus", { timecodeMs: 1000 });
  assert.deepEqual(r.clauses.map((c) => [c.class, c.text]), [["clip", "Taie de la 10 la 12"], ["clip", "mută textul mai sus"]]);
  // Text and tone first, cuts last; with two cuts the later one first, so earlier frames stay valid.
  assert.deepEqual(r.media.ops, [{ op: "move_text", itemId: "t-hook", dx: 0, dy: -0.08 }, { op: "cut_range", from: 300, to: 360 }]);
  const two = run("Taie de la 2 la 4. Taie de la 20 la 22. Clipul e prea tehnic.");
  assert.deepEqual(two.media.ops.map((o) => [o.op, o.from ?? o.itemId]), [["replace_text", "t-desktop"], ["replace_text", "t-mobile"], ["cut_range", 600], ["cut_range", 60]]);
  assert.equal(two.media.preview.ok, true);
  assert.equal(validateIR(applyOps(MASTER, two.media.ops), { presets: PRESETS }).ok, true);
  assert.deepEqual(two.media.lines, ["2 texte de ton (comercial)", "2 alte modificări de montaj"]);
  // The final text by its role, without a time.
  assert.deepEqual(run("În clip, schimbă textul de final în «Sunați-ne azi»").media.ops, [{ op: "replace_text", itemId: "t-cta", text: "Sunați-ne azi" }]);
  // A rewording without the new text asks for it (no model writes texts here).
  const reword = run("În clip, fă textul de final mai scurt");
  assert.deepEqual([reword.status, reword.clarification.kind], ["CLARIFY", "text"]);
  assert.match(reword.clarification.question, /livrarea nu folosește niciun model/);
  // The parser's own question is passed on as the ONE question.
  const vague = run("În clip, schimbă textul");
  assert.deepEqual([vague.status, vague.clarification.kind], ["CLARIFY", "instruction"]);
  // Feedback about the clip is noted like any other.
  assert.deepEqual(run("Clipul e bine, nu trebuie schimbat").feedback.map((f) => [f.subject, f.polarity]), [["clip", "positive"]]);
  assert.deepEqual(run("Clipul arată bine").status, "NOTED");
  // previewOps says when a list cannot apply.
  assert.equal(previewOps(MASTER, [{ op: "cut_range", from: 0, to: 99999 }]).ok, false);
  assert.equal(previewOps(MASTER, []).ok, false);
});

test("M11-RV-12 inputs: empty or oversized text is refused; secrets are redacted in what is recorded; unknown sentences change nothing", () => {
  throwsCode(() => classify("", CTX), "REVISION_TEXT_REQUIRED");
  throwsCode(() => classify("   ", CTX), "REVISION_TEXT_REQUIRED");
  throwsCode(() => classify(null, CTX), "REVISION_TEXT_REQUIRED");
  throwsCode(() => classify("x".repeat(2001), CTX), "REVISION_TEXT_TOO_LONG");
  const secret = run("Clipul e prea tehnic. token=abcd1234efgh5678 apare în clip");
  assert.ok(!secret.textRedacted.includes("abcd1234efgh5678") && secret.textRedacted.includes("[redacted]"));
  assert.ok(!JSON.stringify(secret.clauses).includes("abcd1234efgh5678"));
  const unknown = run("Vremea e frumoasă azi");
  assert.deepEqual([unknown.status, unknown.classes, unknown.actions, unknown.media, unknown.clarification], ["UNKNOWN", [], [], null, null]);
  assert.match(unknown.messages[0], /Nu am înțeles ce să schimb/);
  assert.deepEqual([...REVISION_CLASSES], ["feedback", "tone", "clip", "vertical", "summary", "software", "unknown"]);
  // Quoted words are data, never instructions: a quote that says „publică” or „butonul să fie verde” changes only the text.
  const quoted = run("În clip, schimbă textul de final în «Publică acum, butonul să fie verde»");
  assert.deepEqual([quoted.classes, quoted.media.ops], [["clip"], [{ op: "replace_text", itemId: "t-cta", text: "Publică acum, butonul să fie verde" }]]);
  // No context at all: classes are still decided, operations are not invented.
  const bare = classify(REFERENCE, {});
  assert.deepEqual([bare.classes, bare.media, bare.clauses[1].needs, bare.clauses[2].needs], [["feedback", "tone", "clip"], null, "ir", "ir"]);
});

// ---------------------------------------------------------------- the Room's own request (cross-check: what the UI really sends)

/** The clip part of a view (GET /api/deliveries/:id) for the two current versions of CTX: text items as the contract lists them ({ id, text, start, end }). */
const roomTexts = (ir) => ir.tracks.filter((t) => t.kind === "text").flatMap((t) => t.items).map((i) => ({ id: i.id, text: i.text, start: i.start, end: i.end }));
const ROOM_VIEW = { delivery: { id: "dlv_mux1abcd_0123456789", status: "READY", verified: { equal: true } },
  clip: { master: { editVersionId: "mev_master_1", assetVersionId: "mav_master_1", durationMs: 34100, label: "ORIGINAL_RECORDING", qa: { status: "PASS" }, textItems: roomTexts(MASTER) },
    vertical: { editVersionId: "mev_vertical_1", assetVersionId: "mav_vertical_1", durationMs: 34100, label: "ORIGINAL_RECORDING", qa: { status: "PASS" }, textItems: roomTexts(VERTICAL) } } };
/** classify as the delivery service calls it for a body of the Room: the body's fields ARE the context fields. */
const fromRoom = (body, extra = {}) => classify(body.text, { ...CTX, selection: body.selection, timecodeMs: body.timecodeMs, player: body.player, ...extra });

test("M11-RV-13 the Room's selection { kind: \"text\", id, versionId, player } is mapped to the clip that owns the text: no target question, and the 9:16 player targets the vertical", () => {
  const [masterSlot, verticalSlot] = clipSlots(ROOM_VIEW);
  assert.deepEqual([masterSlot.mode, verticalSlot.mode], ["current", "current"]);
  const title = "Schimbă titlul în «Programări simple»";
  // Without a selection this sentence is the ONE question „Titlul clipului sau titlul rezumatului?” …
  assert.deepEqual([run(title).status, run(title).clarification.kind], ["CLARIFY", "target"]);
  // … with the hook picked in the 16:9 player — the body the Room really builds — it is a proposal on the master.
  const picked = revisionBody({ text: title, selection: selectionFor(masterSlot, "t-hook") }, ROOM_VIEW);
  assert.deepEqual(picked.body, { text: title, selection: { kind: "text", id: "t-hook", versionId: "mev_master_1", player: "master" } });
  const onMaster = fromRoom(picked.body);
  assert.deepEqual([onMaster.status, onMaster.clarification, onMaster.classes, onMaster.clauses[0].targetBy], ["PROPOSE", null, ["clip"], "selection"]);
  assert.deepEqual(onMaster.media.ops, [{ op: "replace_text", itemId: "t-hook", text: "Programări simple" }]);
  assert.deepEqual([onMaster.media.target, onMaster.vertical], [{ kind: "master", id: null, versionId: "mev_master_1" }, null]);
  // The same text id exists in the 9:16 clip: picked there, the vertical variant is the target and the master is untouched.
  const pickedVertical = revisionBody({ text: title, selection: selectionFor(verticalSlot, "t-hook") }, ROOM_VIEW);
  assert.deepEqual(pickedVertical.body.selection, { kind: "text", id: "t-hook", versionId: "mev_vertical_1", player: "vertical" });
  const onVertical = fromRoom(pickedVertical.body);
  assert.deepEqual([onVertical.status, onVertical.clarification, onVertical.classes, onVertical.clauses[0].targetBy, onVertical.media], ["PROPOSE", null, ["vertical"], "selection", null]);
  assert.deepEqual(onVertical.vertical.ops, [{ op: "replace_text", itemId: "t-hook", text: "Programări simple" }]);
  assert.deepEqual(onVertical.vertical.target, { kind: "vertical", id: "mvr_1", versionId: "mev_vertical_1" });
  assert.equal(validateIR(applyOps(VERTICAL, onVertical.vertical.ops), { presets: PRESETS }).ok, true);
  // The version alone names the clip (a caller that sends no player); the selected item is the text an unqualified „textul” means.
  assert.deepEqual(run(title, { selection: { kind: "text", id: "t-hook", versionId: "mev_vertical_1" } }).classes, ["vertical"]);
  assert.deepEqual(run(title, { selection: { kind: "text", id: "t-hook", versionId: "mev_master_1" } }).classes, ["clip"]);
  assert.deepEqual(run("Schimbă textul în «Sunați-ne azi»", { selection: { kind: "text", id: "t-cta", versionId: "mev_master_1", player: "master" } }).media.ops, [{ op: "replace_text", itemId: "t-cta", text: "Sunați-ne azi" }]);
  // A selection means no TARGET question. What only the owner knows — the new text — is still asked (no model writes texts here).
  const reword = run("Fă textul mai scurt", { selection: { kind: "text", id: "t-cta", versionId: "mev_master_1", player: "master" } });
  assert.deepEqual([reword.status, reword.clarification.kind, reword.clauses[0].targetBy, reword.clauses[0].target.kind], ["CLARIFY", "text", "selection", "master"]);
  // Not a target: an older version, a player that contradicts the version, a text the montage does not have, the mandatory label, no id.
  const ignored = [
    [{ kind: "text", id: "t-hook", versionId: "mev_master_0", player: "master" }, /versiune mai veche/],
    [{ kind: "text", id: "t-hook", versionId: "mev_master_1", player: "vertical" }, /nu se potrivește cu clipul/],
    [{ kind: "text", id: "t-gone", versionId: "mev_master_1", player: "master" }, /nu mai există în versiunea curentă/],
    [{ kind: "text", id: LABEL_ITEM_ID, versionId: "mev_master_1", player: "master" }, /Eticheta obligatorie nu se selectează/],
    [{ kind: "text", versionId: "mev_master_1", player: "master" }, /nu mai există în versiunea curentă/],
    [{ kind: "text", id: "t-hook", player: "master" }, /versiune mai veche/],
  ];
  for (const [selection, note] of ignored) {
    const r = run(title, { selection });
    assert.deepEqual([r.status, r.clarification.kind, r.media], ["CLARIFY", "target", null], JSON.stringify(selection));
    assert.ok(r.notes.some((n) => note.test(n)), `${JSON.stringify(selection)} → ${r.notes.join(" | ")}`);
  }
  // The words still win over the selection, with a note.
  const words = run("În rezumat, la Următorul pas scrie «Sunați-ne»", { selection: { kind: "text", id: "t-hook", versionId: "mev_master_1", player: "master" } });
  assert.deepEqual([words.classes, words.media, words.summary.edits[0].id], [["summary"], null, "next_step"]);
  assert.ok(words.notes.some((n) => /am urmat fraza/.test(n)));
  // Something that is not a selection kind — a prototype key included — is no selection at all: nothing to ignore, nothing to note.
  for (const kind of ["toString", "constructor", "__proto__", "text2", 7, null]) {
    const r = run(title, { selection: { kind, id: "t-hook", versionId: "mev_master_0" } });
    assert.deepEqual([r.status, r.clarification.kind, r.notes], ["CLARIFY", "target", []], String(kind));
  }

  // A moment taken in a player: `player` says which one. In the 9:16 player it targets the vertical variant.
  const moved = { op: "move_text", itemId: "t-hook", dx: 0, dy: -0.08 };
  const atVertical = fromRoom(revisionBody({ text: "Mută textul mai sus", timecodeMs: 2000, player: "vertical" }, ROOM_VIEW).body);
  assert.deepEqual([atVertical.classes, atVertical.clauses[0].targetBy, atVertical.media, atVertical.vertical.ops, atVertical.vertical.target.versionId], [["vertical"], "timecode", null, [moved], "mev_vertical_1"]);
  const atMaster = fromRoom(revisionBody({ text: "Mută textul mai sus", timecodeMs: 2000, player: "master" }, ROOM_VIEW).body);
  assert.deepEqual([atMaster.classes, atMaster.clauses[0].targetBy, atMaster.vertical, atMaster.media.ops], [["clip"], "timecode", null, [moved]]);
  assert.deepEqual(run(title, { timecodeMs: 12000, player: "vertical" }).vertical.ops, [{ op: "replace_text", itemId: "t-hook", text: "Programări simple" }]);
  // Without a known player a moment is a moment of the 16:9 clip; `playerKind` is the older name of the same field, `player` wins.
  for (const player of [undefined, null, "summary", "nope", 7, "toString"]) assert.deepEqual(run("Mută textul mai sus", { timecodeMs: 2000, player }).classes, ["clip"], String(player));
  assert.deepEqual(run("Mută textul mai sus", { timecodeMs: 2000, playerKind: "vertical" }).classes, ["vertical"]);
  assert.deepEqual(run("Mută textul mai sus", { timecodeMs: 2000, playerKind: "vertical", player: "master" }).classes, ["clip"]);
  // The words still win over the moment too, and a delivery without a variant says so instead of guessing.
  assert.deepEqual(run("În clip, mută textul mai sus", { timecodeMs: 2000, player: "vertical" }).classes, ["clip"]);
  const noVariant = run("Mută textul mai sus", { timecodeMs: 2000, player: "vertical", vertical: null });
  assert.deepEqual([noVariant.vertical, noVariant.media, noVariant.clauses[0].needs], [null, null, "vertical"]);
});

test("M11-RV-14 a tone word about the SOFTWARE in a clause that names no clip is feedback about the software — NOTED, no operation, no question; the reference sentence keeps its result", () => {
  for (const [phrase, clipWords] of [["Site-ul e prea tehnic.", "Clipul e prea tehnic"], ["Aplicația e prea comercială.", "Clipul e prea comercial"], ["Formularul e prea tehnic", "Clipul e prea tehnic"],
    ["Pagina de programări are prea mult jargon", "Clipul e prea tehnic"], ["Butonul e prea tehnic", "Clipul e prea tehnic"], ["Site-ul să fie mai comercial", "Clipul e prea tehnic"]]) {
    const r = run(phrase);
    assert.deepEqual([r.status, r.classes, r.actions, r.clarification], ["NOTED", ["feedback"], [], null], phrase);
    assert.deepEqual([r.media, r.vertical, r.summary, r.software, r.target], [null, null, null, null, null], phrase);
    assert.deepEqual([r.clauses[0].ops, r.clauses[0].brief, r.clauses[0].prefs, r.clauses[0].tone, r.clauses[0].refused], [[], null, null, undefined, undefined], phrase);
    assert.deepEqual(r.feedback.map((f) => [f.subject, f.polarity, f.about]), [["software", "negative", "tone"]], phrase);
    // The honest hint: nothing changed, a change in the site needs to say what to change, and how to mean the clip instead.
    assert.equal(r.messages.length, 1);
    assert.ok(r.messages[0].startsWith(`Am notat observația „${phrase.replace(/\.$/, "")}” ca feedback despre software.`), r.messages[0]);
    assert.match(r.messages[0], /fraza nu numește clipul, deci nu am schimbat nimic/);
    assert.match(r.messages[0], /Pentru o schimbare în site sau în aplicație, spune ce anume să schimb .* plan separat de software/);
    assert.ok(r.messages[0].endsWith(`Dacă te refereai la clip, spune „${clipWords}”.`), r.messages[0]);
    assert.equal(REVISION_RECORD_STATUS[r.status], "NOTED");
  }
  // A clause that names the clip is still a clip revision, whatever else it mentions.
  for (const phrase of ["Clipul e prea tehnic pentru un site de detailing", "În clip, site-ul pare prea tehnic", "Videoclipul despre aplicație e prea tehnic"]) {
    const r = run(phrase);
    assert.deepEqual([r.status, r.classes, r.media.ops.map((o) => o.itemId)], ["PROPOSE", ["tone"], ["t-desktop", "t-mobile"]], phrase);
  }
  // No subject at all, or a text on a button (which a clip text may show), keeps the existing rule: the clip's tone.
  for (const phrase of ["prea tehnic", "E prea tehnic", "Textul de pe buton e prea tehnic"]) assert.deepEqual(run(phrase).classes, ["tone"], phrase);
  // „nu e prea tehnic” stays a positive judgement about the software; the summary has no tone variants.
  assert.deepEqual(run("Site-ul nu e prea tehnic").feedback.map((f) => [f.subject, f.polarity]), [["software", "positive"]]);
  assert.equal(run("Rezumatul e prea tehnic").clauses[0].refused, "SUMMARY_TONE");
  // Next to a real clip revision: only the clip clause gives operations; the software note is a message beside the ONE card.
  const mixed = run("Site-ul e prea tehnic. Clipul e prea tehnic.");
  assert.deepEqual([mixed.status, mixed.classes, mixed.actions, mixed.clarification], ["PROPOSE", ["feedback", "tone"], ["media"], null]);
  assert.deepEqual(mixed.media.ops.map((o) => o.itemId), ["t-desktop", "t-mobile"]);
  assert.deepEqual(mixed.media.lines, ["2 texte de ton (comercial)"]);
  assert.match(mixed.messages[0], /^Am notat observația „Site-ul e prea tehnic”/);
  // A jump in the same sentence is still read (it names the clip's timeline); the software tone gives no text operation.
  const withJump = run("Site-ul e prea tehnic, după secunda zece arată direct programarea");
  assert.deepEqual([withJump.status, withJump.classes, withJump.media.ops], ["PROPOSE", ["feedback", "clip"], [{ op: "cut_range", from: 300, to: 552 }]]);
  // A selection or a moment in the clip does not turn the sentence into a clip revision: the sentence says what it is about.
  const selected = run("Site-ul e prea tehnic", { selection: { kind: "text", id: "t-hook", versionId: "mev_master_1", player: "master" }, timecodeMs: 5000 });
  assert.deepEqual([selected.status, selected.media], ["NOTED", null]);
  assert.ok(selected.notes.some((n) => /am urmat fraza, nu selecția/.test(n)));
  // GOLDEN, unchanged: „Site-ul e bine” has no tone word, and the tone clause names the clip.
  const golden = run(REFERENCE);
  assert.deepEqual([golden.status, golden.classes, golden.actions, golden.clarification], ["PROPOSE", ["feedback", "tone", "clip"], ["media"], null]);
  assert.deepEqual(golden.media.ops, [{ op: "replace_text", itemId: "t-desktop", text: TEXTS.desktop.business }, { op: "replace_text", itemId: "t-mobile", text: TEXTS.mobile.business }, { op: "cut_range", from: 300, to: 552 }]);
  assert.deepEqual(golden.feedback, [{ index: 0, text: "Site-ul e bine", subject: "software", polarity: "positive", message: "Notat că site-ul e bine. Acceptarea software rămâne butonul „Accept local” din camera de livrare." }]);
});

test("M11-RV-15 sentences that are not revisions get an honest, complete answer — every half of them — and never a misleading question", () => {
  const nothing = (r, phrase) => assert.deepEqual([r.media, r.vertical, r.summary, r.software, r.clarification, r.actions], [null, null, null, null, null, []], phrase);
  // commit / push / deploy: not part of a delivery; separate decisions. Never „Clipul 16:9 sau rezumatul comercial?”.
  for (const [phrase, message] of [
    ["Fă commit și push.", /^Commit-ul și push-ul nu fac parte din livrare; sunt decizii separate, pe care le iei tu, în afara camerei de livrare\. Nimic nu s-a schimbat\.$/],
    ["Fă deploy.", /^Deploy-ul nu face parte din livrare; este o decizie separată, pe care o iei tu, în afara camerei de livrare\. Nimic nu s-a schimbat\.$/],
    ["Fă commit, push și deploy", /^Commit-ul, push-ul și deploy-ul nu fac parte din livrare; sunt decizii separate/],
    ["Dă push pe GitHub", /^Push-ul nu face parte din livrare; este o decizie separată/], ["Poți face commit?", /^Commit-ul nu face parte din livrare/], ["Te rog, fă deploy la site", /^Deploy-ul nu face parte din livrare/],
    ["Pune site-ul în producție", /^Deploy-ul nu face parte din livrare/], ["Urcă pe GitHub", /^Push-ul nu face parte din livrare/]]) {
    const r = run(phrase);
    assert.deepEqual([r.status, r.classes, r.clauses.length], ["REFUSED", ["feedback"], 1], phrase);
    assert.deepEqual([r.clauses[0].decision, r.clauses[0].refused, r.clauses[0].ops, r.clauses[0].target], ["repo_ops", "NOT_PART_OF_DELIVERY", [], null], phrase);
    nothing(r, phrase);
    assert.equal(r.messages.length, 1);
    assert.match(r.messages[0], message, phrase);
    assert.equal(REVISION_RECORD_STATUS[r.status], "REFUSED");
  }
  // A decision AND a publication in one sentence: BOTH halves are answered — the creative approval is the owner's own decision in the
  // Room (with Windows Hello), and publishing is off. „urcă” is an upload only next to a platform.
  const answers = { creative_approve: /Aprobarea creativă este decizia ta, pe versiunea afișată, cu Windows Hello, din camera de livrare\./, publish: /Publicarea este oprită: din Hub nu se publică, nu se urcă și nu se trimite nimic în M11\./,
    software_accept: /Acceptarea software-ului este decizia ta: butonul „Accept local”/, summary_approve: /„Gata de prezentare” este decizia ta/, repo_ops: /nu face parte din livrare|nu fac parte din livrare/ };
  for (const [phrase, expected] of [
    ["Aprob clipul și publică-l pe YouTube.", ["creative_approve", "publish"]], ["Aprob clipul, publică-l pe YouTube", ["creative_approve", "publish"]], ["Aprob clipul, apoi publică-l", ["creative_approve", "publish"]],
    ["Aprob clipul și trimite-l clientului.", ["creative_approve", "publish"]], ["Aprob clipul și postează-l pe TikTok", ["creative_approve", "publish"]], ["Aprob clipul și urcă-l pe YouTube", ["creative_approve", "publish"]],
    ["Aprobă varianta verticală și postează pe Instagram", ["creative_approve", "publish"]], ["Publică clipul și aprobă-l", ["publish", "creative_approve"]], ["Aprob rezumatul și trimite-l clientului", ["summary_approve", "publish"]],
    ["Acceptă software-ul și fă deploy.", ["software_accept", "repo_ops"]], ["Aprob clipul și fă push", ["creative_approve", "repo_ops"]], ["Aprob clipul și rezumatul", ["creative_approve", "summary_approve"]],
    ["Accept software-ul și clipul", ["software_accept", "creative_approve"]], ["Trimite codul pe GitHub", ["publish", "repo_ops"]]]) {
    const r = run(phrase);
    assert.deepEqual([r.status, r.classes], ["REFUSED", ["feedback"]], phrase);
    nothing(r, phrase);
    assert.deepEqual(r.feedback.flatMap((f) => f.decisions || [f.decision]), expected, phrase);
    assert.ok(r.clauses.every((cl) => cl.refused && !cl.ops.length), phrase);
    const said = r.messages.join(" ");
    for (const kind of expected) assert.match(said, answers[kind], `${phrase}: ${kind} is answered`);
    assert.equal(REVISION_RECORD_STATUS[r.status], "REFUSED");
  }
  // The reference of the cross-check, word for word: two clauses, each with its answer.
  assert.deepEqual(splitClauses("Aprob clipul și publică-l pe YouTube."), ["Aprob clipul", "publică-l pe YouTube"]);
  assert.deepEqual(run("Aprob clipul și publică-l pe YouTube.").messages, ["Aprobarea creativă este decizia ta, pe versiunea afișată, cu Windows Hello, din camera de livrare.", "Publicarea este oprită: din Hub nu se publică, nu se urcă și nu se trimite nimic în M11."]);
  // One thing named → one answer, as before; „accept” alone is the software, „aprob” alone the clip, a clip that is „accepted” the creative approval.
  assert.deepEqual(["Aprob", "Accept", "Accept clipul", "Aprob software-ul", "Publică"].map((p) => run(p).clauses[0].decision), ["creative_approve", "software_accept", "creative_approve", "software_accept", "publish"]);
  // A real revision next to a decision or a repository operation: the revision is proposed AND the other half is answered.
  const toneAndPublish = run("Clipul e prea tehnic și publică-l");
  assert.deepEqual([toneAndPublish.status, toneAndPublish.classes, toneAndPublish.media.ops.length, toneAndPublish.clarification], ["PROPOSE", ["feedback", "tone"], 2, null]);
  assert.match(toneAndPublish.messages.join(" "), answers.publish);
  const moveAndSend = run("Mută titlul mai sus și trimite clipul clientului");
  assert.deepEqual([moveAndSend.status, moveAndSend.media.ops], ["PROPOSE", [{ op: "move_text", itemId: "t-hook", dx: 0, dy: -0.08 }]]);
  assert.match(moveAndSend.messages.join(" "), answers.publish);
  const noteAndCommit = run("Site-ul e bine și fă commit");
  assert.deepEqual([noteAndCommit.status, noteAndCommit.feedback.map((f) => f.decision || f.subject)], ["NOTED", ["software", "repo_ops"]]);
  // „urcă” without a platform still moves a text, and is not split off as a clause of its own.
  assert.deepEqual(splitClauses("Mută titlul și urcă eticheta mai sus"), ["Mută titlul și urcă eticheta mai sus"]);
  assert.deepEqual(run("Urcă titlul mai sus").media.ops, [{ op: "move_text", itemId: "t-hook", dx: 0, dy: -0.08 }]);
  // Quoted words are the new TEXT, never a decision or an operation; a summary text may speak about deploy.
  assert.deepEqual(run("În clip, schimbă textul de final în «Aprob și public, apoi fac push»").media.ops, [{ op: "replace_text", itemId: "t-cta", text: "Aprob și public, apoi fac push" }]);
  assert.deepEqual(run("În rezumat, la Ce nu putem afirma scrie «commit, push și deploy»").summary.edits, [{ id: "cannot_claim", text: "commit, push și deploy" }]);
  assert.deepEqual([run("În rezumat, la Ce nu putem afirma scrie despre deploy").status, run("În rezumat, la Ce nu putem afirma scrie despre deploy").clarification.kind], ["CLARIFY", "text"]);
  // „Nu publica nimic”: the owner's own constraint is noted (and holds anyway) — not „Nu am înțeles”.
  for (const phrase of ["Nu publica nimic.", "Nu trimite clipul nimănui", "Te rog, nu posta nimic", "Nu urca nimic pe YouTube"]) {
    const r = run(phrase);
    assert.deepEqual([r.status, r.classes, r.feedback.map((f) => f.subject)], ["NOTED", ["feedback"], ["publishing"]], phrase);
    nothing(r, phrase);
    assert.match(r.messages[0], /^Notat: nu public, nu urc și nu trimit nimic\. Publicarea este oricum oprită/);
  }
  assert.notEqual(run("Nu urca titlul").status, "NOTED");

  // A change verb with nothing either artifact could take is not asked about: no „clip or summary?”, no „what exactly?”.
  for (const phrase of ["Fă backup.", "Nu merge.", "Vreau altceva", "Rulează testele", "Trebuie ceva mai bun"]) {
    const r = run(phrase);
    assert.deepEqual([r.status, r.classes, r.clauses[0].class], ["UNKNOWN", [], "unknown"], phrase);
    nothing(r, phrase);
    assert.match(r.messages[0], /^Nu am înțeles ce să schimb\. Poți spune, de exemplu:/, phrase);
  }
  // Next to a real revision it does not block the proposal and is not dropped silently: a note says which part was left alone.
  const withUnclear = run("Clipul e prea tehnic. Fă backup.");
  assert.deepEqual([withUnclear.status, withUnclear.clarification, withUnclear.media.ops.length], ["PROPOSE", null, 2]);
  assert.deepEqual(withUnclear.notes, ["Nu am înțeles ce să schimb în „Fă backup”; partea aceasta a rămas neschimbată."]);
  // When the owner pointed at something — words, a selection, a moment — the clause still goes to that artifact's own parser.
  assert.equal(run("Fă-l mai lung", { selection: { kind: "text", id: "t-cta", versionId: "mev_master_1", player: "master" } }).clauses[0].targetBy, "selection");
  // And the ONE target question is still asked when there IS something to change (a text named, quoted or reworded).
  for (const phrase of ["Schimbă titlul", "Scrie «Sunați-ne»", "Fă textul mai scurt", "Șterge textul"]) assert.deepEqual([run(phrase).status, run(phrase).clarification.kind], ["CLARIFY", "target"], phrase);
});
