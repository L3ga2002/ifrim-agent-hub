import test from "node:test";
import assert from "node:assert/strict";
import { resolveIntent, INTENT_EFFECTS } from "../server/owner/intents.mjs";
import { classOfIntent } from "../server/policy/effect-class.mjs";
import { processSheetAliases } from "../server/owner/process-sheets.mjs";
const context = { projects: [], missions: [], departments: [], processSheets: processSheetAliases() };
const steps = (text, extra = {}) => resolveIntent(text, { ...context, ...extra }).steps;
const intent = (text, extra = {}) => steps(text, extra)[0]?.intent;
const plain = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const phrases = [
  ["recap", ["Ce s-a întâmplat azi?", "Ce s-a întâmplat astăzi?", "Ce s-a întâmplat astăzi în companie?", "Ce s-a mai întâmplat azi?", "Fă-mi rezumatul zilei", "Fă-mi rezumatul de azi", "Fă un rezumat", "Fă-mi un rezumat", "Rezumatul serii", "Rezumatul de azi", "Rezumatul zilei", "Vreau rezumatul", "Dă-mi rezumatul"]],
  ["command_mode", ["Mod comandă", "Modul comandă", "Ecran de comandă", "Ecranul de comandă", "Deschide modul comandă", "Treci pe modul comandă", "Treci în modul comandă", "L3ga, modul comandă"]],
  ["command_view", ["Arată-mi harta sistemului", "Deschide harta sistemului", "Harta sistemului", "Arată pâlnia de vânzări", "Deschide-mi pâlnia vânzărilor", "Pâlnia vânzărilor", "Arată traseul lucrării", "Traseul lucrării", "Pune rezultatul pe ecranul mare", "Arată-mi rezultatul pe ecranul mare", "Revino la ecranul de repaus", "Arată ecranul de repaus", "Mod repaus", "Modul repaus"]],
  ["command_numbers", ["Ascunde cifrele", "Arată cifrele", "Afișează cifrele"]],
  ["department_show", ["Arată conducerea", "Arată departamentul produs", "Deschide departamentul engineering", "Intră în departamentul calitate", "Intră pe infrastructură", "Arată vânzările", "Arată marketing", "Arată relația cu clienții", "Arată managementul proiectelor", "Arată operațiunile", "Arată cercetare", "Arată financiar", "Arată ingineria", "Arată finanțele", "Arată strategia", "Următorul departament", "Departamentul următor", "Departamentul anterior", "Precedentul departament", "Departamentul dinainte"]],
  ["process_sheet", ["Arată-mi fișa de proces pentru factory", "Deschide fișa a debug", "Fișa media", "Cum funcționează factory", "Cum lucrează montaj", "Fișa necunoscută"]],
];
for (const [expected, values] of phrases) test(`M16 ${expected}: Romanian, folded and Lega prefix`, () => {
  for (const phrase of values) for (const text of [phrase, plain(phrase), `Lega, ${phrase}`]) assert.equal(intent(text), expected, text);
});
test("M16 typo vocabulary preserves read intent", () => {
  for (const [phrase, expected] of [["Ce s-a intmaplat azi", "recap"], ["Modul comnada", "command_mode"], ["Arata crifrele", "command_numbers"], ["Arata harta sisetmului", "command_view"], ["Fisa facotry", "process_sheet"], ["Arata departamntul engineering", "department_show"]]) assert.equal(intent(phrase), expected, phrase);
});
test("M16 controls exist only inside the active recap; old bare words keep their exact result", () => {
  for (const [action, phrases] of Object.entries({ next: ["următorul", "următorul capitol", "capitolul următor", "next"], back: ["înapoi", "capitolul anterior", "precedentul"], repeat: ["repetă", "repetă capitolul", "mai spune o dată"], open: ["deschide", "deschide-l", "deschide capitolul"], stop: ["oprește", "oprește rezumatul", "stop", "gata", "ajunge"] })) for (const phrase of phrases) {
    const s = steps(phrase, { recap: { active: true } })[0]; assert.equal(s.intent, "recap_control", phrase); assert.equal(s.args.action, action, phrase);
    assert.deepEqual(steps(phrase, { recap: { active: false } }), steps(phrase), phrase);
  }
  assert.equal(intent("următorul"), "board_next"); assert.equal(intent("înapoi"), "back");
});
test("M16 controls exclude quoted, questioned, negated and reported instructions", () => {
  for (const text of ["«următorul»", "Ce înseamnă următorul?", "Nu opri rezumatul", "Nu, înapoi nu", "următorul?", "A spus repetă capitolul", "Dacă termină, oprește rezumatul"]) assert.ok(steps(text, { recap: { active: true } }).every((s) => s.intent !== "recap_control"), text);
});
test("M16 leaves interruptions and existing reads unchanged", () => {
  for (const [text, expected] of [["Oprește tot", "stop_all"], ["Taci", "mute"], ["Pauză", "pause"], ["Preiau eu", "takeover"], ["Oprește Codex", "stop_worker"], ["Ce înseamnă «Oprește tot»?", "explain_stop"], ["Ce avem azi?", "today"], ["Ce se întâmplă?", "status"], ["Arată-mi oferta", "sales_show"], ["Arată devizul DVZ-0001", "desk_show"], ["Arată rezultatul", "show_preview"], ["Arată-mi rezultatele", "results_show"], ["Ecran complet", "fullscreen"], ["Arată compania", "show_company"], ["Bună dimineața", "briefing"], ["Ce s-a schimbat", "briefing"]]) {
    assert.equal(intent(text), expected, text); assert.equal(intent(text, { recap: { active: true } }), expected, text);
  }
  const project = steps("Arată vânzări", { projects: [{ id: "p", name: "Vânzări" }] })[0]; assert.equal(project.intent, "open_project"); assert.equal(project.args.projectId, "p");
  assert.notEqual(intent("Cum funcționează un reactor?"), "process_sheet");
});
test("M16 new intents are all READ_NAVIGATE", () => {
  for (const name of ["recap", "recap_control", "command_mode", "command_view", "command_numbers", "department_show", "process_sheet"]) assert.equal(classOfIntent(name, INTENT_EFFECTS[name]), "READ_NAVIGATE", name);
});

test("M16 R3 addressed stop priority",()=>{
 for(const phrase of ["Lega, stop","Lega, oprește","Lega oprește","Hei Lega, oprește","Oprește tot"]) { assert.equal(intent(phrase,{recap:{active:true}}),"stop_all",phrase); assert.deepEqual(steps(phrase,{recap:{active:true}}),steps(phrase)); }
 for(const phrase of ["oprește","stop","gata","ajunge","Lega, oprește rezumatul","Lega, oprește-te din rezumat"]) assert.equal(intent(phrase,{recap:{active:true}}),"recap_control",phrase);
});
test("M16 R3 recap questions",()=>{for(const phrase of ["următorul?","înapoi?","repetă?"]) {const s=steps(phrase,{recap:{active:true}})[0];assert.equal(s.intent,"unknown",phrase);assert.deepEqual(s.args,{recapQuestion:true});assert.notDeepEqual(steps(phrase),[s]);}});

// Coordinator fix (2026-10-25, M16 QA): the owner names a sheet with its Romanian case and article („fișa ofertei”, „cum funcționează devizul”);
// the exact alias match left these as a question (sheetRef) or unknown. Fails on the exact-match code (5 of 7 below).
test("M16 process_sheet: inflected Romanian sheet names resolve to the sheet (real aliases), unknown names stay one question", () => {
  const sheet = (text) => steps(text)[0]?.args?.sheetId || null;
  assert.equal(sheet("Arată fișa ofertei"), "flow:offer");
  assert.equal(sheet("Cum funcționează devizul?"), "flow:dvz");
  assert.equal(sheet("Arată fișa devizului"), "flow:dvz");
  assert.equal(sheet("Fișa dosarului de pornire"), "flow:ops");
  assert.equal(sheet("Arată fișa cazului de suport"), "flow:sup");
  assert.equal(sheet("Arată fișa livrării media"), "flow:media");
  assert.equal(sheet("Arată fișa Fabricii"), "flow:factory");
  assert.equal(steps("Arată fișa ceva inexistent")[0]?.args?.sheetRef, "ceva inexistent");
  assert.equal(intent("Arată devizul DVZ-0001"), "desk_show");
  assert.equal(intent("Arată-mi oferta"), "sales_show");
});
