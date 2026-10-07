// M11 „Ifrim Delivery” — the revision classifier (pure): ONE owner sentence about a delivery → clauses, each with a class, a target
// and explicit operations. The same function serves the Room's revision box and typed or spoken Lega (intent delivery_revise).
//
// Classes: feedback | tone | clip | vertical | summary | software | unknown.
// - feedback: „Site-ul e bine” is NOTED and nothing else — never an acceptance. „Accept software-ul”, „Aprob clipul”, „Publică clipul”
//   are answered with where the owner's own button is (or that publishing is off): a sentence never accepts, approves or publishes.
//   Every half of such a sentence gets its answer („Aprob clipul și publică-l pe YouTube” → the creative approval AND publishing),
//   and „Fă commit și push” / „Fă deploy” are refused as what they are: not part of a delivery, separate decisions.
// - tone: „prea tehnic” → business, „prea comercial” → technical: replace_text on the t-* items of the master (clip-ir.mjs toneOps)
//   plus the brief delta (audience) and the kept preference. A tone word about the SOFTWARE in a clause that names no clip
//   („Site-ul e prea tehnic”) is feedback about the software — NOTED, no operation, with what a change in the site needs.
// - clip: „după / de la secunda N arată direct | sari la | treci la X” → cut_range [frame(N), the first marker after N whose note names
//   X) — the cut point comes from a marker, never from a fixed second. Every other clip instruction (move, replace, cut, extend…) is
//   delegated to media/review.mjs parseInstruction on the target version, with the selection valid on the current version only.
// - vertical: the same, on the vertical variant's version (the master is untouched).
// - summary: „În rezumat, la Următorul pas scrie «…»” → a section edit (a new document version; no plan).
// - software: a software noun (site, aplicația, pagina, formularul, butonul, câmpul…) AND a change verb, in a clause that names no
//   clip, variant, summary or text — so a text change never becomes coding.
//
// Target of a clause that changes something: the artifact its own words name; else the Room selection; else a timecode (the clip
// of the player it was taken in); else the artifact named earlier in the same sentence; else the artifact last revised in this
// delivery within 10 minutes; else the only plausible artifact. With two or more plausible artifacts the owner gets ONE question —
// and the whole revision asks at most one question (the first one needed), with at most three options. A clause with a change verb
// but nothing either artifact could take (no text, no rewording, no montage verb: „Fă backup”) is left unknown, never asked about.
// (The selection and the player position are context: when a clause itself names another artifact, the clause wins, with a note.)
//
// The Room sends exactly what classify reads: selection { kind: "text", id, versionId, player? } — an on-screen text of the clip
// whose CURRENT version it was picked on (16:9 or 9:16; a selection means no target question) — and, with a timecode, `player`
// ("master" | "vertical"), so a moment taken in the 9:16 player targets the vertical variant.
//
// No clock (ctx.nowMs), no I/O, no model. Nothing here applies anything: the planner records the revision and proposes the plan.
import { HubError } from "../core/errors.mjs";
import { redactText } from "../security/redact.mjs";
import { normalize, numberOf } from "../owner/intents.mjs";
import { parseInstruction, applyOps, isDisclosureItem } from "../media/review.mjs";
import { validateIR, timelineDuration, framesToMs } from "../media/ir.mjs";
import { PRESETS } from "../media/visual-bible.mjs";
import { toneOps, jumpCut, markerTable, fmtTime, TONES } from "./clip-ir.mjs";

export const REVISION_CLASSES = Object.freeze(["feedback", "tone", "clip", "vertical", "summary", "software", "unknown"]);
export const TARGET_KINDS = Object.freeze(["master", "vertical", "summary"]);
/** What the delivery service records in delivery_revisions.status for a classify() status (SUMMARY_EDIT becomes APPLIED once the new version exists). */
export const REVISION_RECORD_STATUS = Object.freeze({ CLARIFY: "CLARIFY", PROPOSE: "PROPOSED", SUMMARY_EDIT: "PROPOSED", ROUTE_SOFTWARE: "ROUTED_SOFTWARE", REFUSED: "REFUSED", NOTED: "NOTED", UNKNOWN: "NOTED" });
export const RECENT_WINDOW_MS = 10 * 60 * 1000;
export const MAX_OPTIONS = 3;
export const MAX_TEXT = 2000;
/**
 * The sections of the commercial summary (id → heading). `auto` sections are GENERATED and never edited by hand — neither from a
 * sentence nor in the Room's editor (web/src/lib/deliveryLogic.js locks the same two): „Materiale video” is rewritten from the
 * current clips at every clip version, „Trasabilitate” states the facts of the verified bundle (bundle, hashes, spec). The owner's
 * own remarks go in the editable sections.
 */
// M11 (owner's brief §21): the commercial summary answers, in this order, the problem, what the demo shows, how it works, the benefits
// we may state, what we may NOT state, the questions for the client and the next step. Video, price/term and traceability follow.
export const SUMMARY_SECTIONS = Object.freeze([
  { id: "problem", heading: "Problema" }, { id: "demonstrated", heading: "Ce demonstrăm" }, { id: "how", heading: "Cum funcționează" },
  { id: "benefits", heading: "Ce beneficii putem afirma" }, { id: "cannot_claim", heading: "Ce nu putem afirma" }, { id: "questions", heading: "Întrebări pentru client" },
  { id: "next_step", heading: "Următorul pas" }, { id: "video", heading: "Materiale video", auto: true }, { id: "price_terms", heading: "Preț și termen" },
  { id: "provenance", heading: "Trasabilitate", auto: true },
].map((s) => Object.freeze(s)));
/** Where a generated section comes from, as the refusal of a hand edit says it. */
const AUTO_SECTION_SOURCE = Object.freeze({ video: "din clipurile curente (fișiere, durată, QA)", provenance: "din faptele pachetului verificat (pachet, amprente, specificație)" });
const SECTION_ALIASES = Object.freeze({
  problem: ["problema"], demonstrated: ["ce demonstram", "demonstram", "ce functioneaza"], how: ["cum functioneaza", "fluxul", "cum merge"],
  benefits: ["beneficii", "beneficiile", "ce beneficii"], cannot_claim: ["ce nu putem afirma", "nu putem afirma", "limitele", "limite"],
  questions: ["intrebari pentru client", "intrebarile", "intrebari"], video: ["materiale video", "materialele video"],
  price_terms: ["pret si termen", "pretul", "pret", "termenul", "termen"], next_step: ["urmatorul pas", "pasul urmator", "pasii urmatori", "urmatorii pasi"], provenance: ["trasabilitate", "trasabilitatea"],
});

// ---------------------------------------------------------------------------------------------------------------------------
// Words (on normalized text: lower case, no diacritics)
// ---------------------------------------------------------------------------------------------------------------------------

const w = (alts) => new RegExp(`(?<![a-z0-9])(?:${alts})(?![a-z0-9])`);
const VERTICAL_WORDS = w("vertical|verticala|verticale|verticalul|9 16|shorts|short|reel|reels|portret|varianta (?:de|pentru) telefon");
const MASTER_WORDS = w("clip|clipul|clipului|clipuri|video|videoul|video-ul|videoclip|videoclipul|filmulet|filmuletul|montaj|montajul|secunda|secundele|secunde|minutul|cadrul|16 9");
const SUMMARY_WORDS = w("rezumat|rezumatul|rezumatului|oferta|ofertei|sectiunea|sectiune|sectiunii");
/** The summary named outright: it wins over a clip word in the same clause („În rezumat, la Materiale video …”). */
const SUMMARY_STRONG = w("rezumat|rezumatul|rezumatului|oferta|ofertei");
const STRONG_NOUNS = "site|siteul|aplicatia|aplicatie|aplicatiei|app|pagina|paginii|paginile|formular|formularul|formularului|software|softul|codul|functia|functionalitatea|meniul|meniu|baza de date|serverul|api";
const ELEMENT_NOUNS = "buton|butonul|butonului|butoanele|camp|campul|campului|campuri|campurile|validarea";
/** The application itself: with a change verb the clause is a software request even when it speaks of a text („titlul paginii”). */
const SOFTWARE_STRONG = w(STRONG_NOUNS);
/** Any software noun. An element alone (a button, a field) next to a text noun may be what a clip text covers, so it is not enough. */
const SOFTWARE_NOUNS = w(`${STRONG_NOUNS}|${ELEMENT_NOUNS}`);
const TEXT_NOUNS = w("text|textul|textului|textele|titlul|titlu|hook|hook-ul|cta|cta-ul|eticheta|indemnul|subtitrarea|subtitrarile|scrisul|mesajul");
/** Imperatives, wishes („să fie …”) and defect reports („nu merge”): what makes a clause a request for a change. */
const CHANGE_VERBS = w([
  "adauga|adaugi|adaugati|schimba|schimbi|modifica|modifici|repara|repari|corecteaza|corectezi|muta|muti|sterge|stergi|elimina|elimini|scoate|scoti|pune|pui|fa|faci",
  "implementeaza|creeaza|redenumeste|ascunde|afiseaza|valideaza|permite|blocheaza|mareste|micsoreaza|inlocuieste|rescrie|scrie|taie|scurteaza|lungeste|prelungeste|ridica|coboara",
  "trebuie|vreau|as vrea|sa fie|sa aiba|sa apara|sa arate|sa mearga|sa se|sa nu|nu merge|nu functioneaza|nu se salveaza|da eroare|e stricat|este stricat",
].join("|"));
const CLIP_ONLY_VERBS = w("taie|scurteaza|lungeste|prelungeste|muta|ridica|coboara|tine|lasa");
const DIRECTION = w("mai sus|mai jos|la stanga|la dreapta|in sus|in jos");
const TITLE_WORD = w("titlul|titlu");
const JUDGE_VERBS = "e|este|sunt|arata|merge|merg|pare|par|a iesit|au iesit|ramane|suna|mi se pare";
const GOOD_WORDS = "bine|ok|okay|bun|buna|bune|buni|in regula|perfect|perfecta|super|excelent|excelenta|grozav|frumos|frumoasa|corect|corecta|fain|faina";
const POSITIVE = new RegExp(`(?<![a-z0-9])(?:${JUDGE_VERBS})\\s+(?:foarte |destul de |chiar |tare )?(?:${GOOD_WORDS})(?![a-z0-9])|^(?:imi place|ne place|super|perfect|bravo|e ok|ok)(?![a-z0-9])`);
const NEGATED = /(?<![a-z0-9])nu\s+(?:e|este|sunt|arata|merge|pare|mi se pare|imi place|ne place)(?![a-z0-9])|(?<![a-z0-9])nu-mi place(?![a-z0-9])/;
/** „e bine, nu trebuie schimbat”: the change verb is denied, so the clause is still only a judgement. */
const NO_CHANGE = /(?<![a-z0-9])nu\s+(?:mai\s+)?(?:trebuie|schimba|schimbi|modifica|modifici|vreau)(?![a-z0-9])|(?<![a-z0-9])fara (?:schimbari|modificari)(?![a-z0-9])/;
const TONE_BUSINESS = /(?<![a-z0-9])prea\s+(?:tehnic|tehnica|tehnice|tehnici)(?![a-z0-9])|(?<![a-z0-9])mai putin tehnic[a-z]*|(?<![a-z0-9])mai (?:comercial|business)[a-z]*|(?<![a-z0-9])prea (?:mult )?jargon(?![a-z0-9])/;
const TONE_TECHNICAL = /(?<![a-z0-9])prea\s+(?:comercial|comerciala|comerciale|comerciali|de vanzare|de marketing)(?![a-z0-9])|(?<![a-z0-9])mai putin comercial[a-z]*|(?<![a-z0-9])mai tehnic[a-z]*/;
const TONE_NEGATED = /(?<![a-z0-9])nu\s+(?:e|este|mi se pare|pare)\s+prea(?![a-z0-9])/;
const TOO_MUCH = /(?<![a-z0-9])prea\s+(?:lung|lunga|scurt|scurta|rapid|rapida|lent|lenta|repede|incet)(?![a-z0-9])/;
const REWORD = /(?<![a-z0-9])(?:mai scurt|mai scurta|mai lung|mai lunga|mai clar|mai clara|altfel|alt text|reformuleaza|reformulat)(?![a-z0-9])/;
const DECISION = /^(?:te rog[, ]+)?(accept|accepta|acceptam|aprob|aproba|aprobam|publica|publicam|posteaza|postam|trimite|trimitem|urca|incarca)(?![a-z0-9])/;
/** „Nu publica nimic”, „Nu trimite clipul nimănui”: the owner's own constraint („nu urca / nu încărca” only next to a platform or „nimic”). */
const NO_PUBLISH = /^(?:te rog )?(?:sa )?nu (?:mai )?(?:(publica|publici|publicam|posta|postezi|postam|trimite|trimiti|trimitem)|(urca|urci|incarca|incarci))(?![a-z0-9])/;
const PLATFORM = /(?<![a-z0-9])(?:pe|la|in)\s+(?:youtube|tiktok|instagram|facebook|linkedin|net|internet|cloud|drive|site|platforma)(?![a-z0-9])|(?<![a-z0-9])online(?![a-z0-9])/;
/**
 * Repository and release operations (commit, push, deploy): never part of a delivery, whatever the sentence around them says
 * (template.mjs DELIVERY_NEVER: „commit, push sau deploy”). `name` is how the answer names the operation.
 */
const REPO_OPS = Object.freeze([
  Object.freeze({ id: "commit", name: "commit-ul", re: w("commit|commitul|commit-ul|commituri|commiteaza|comiteaza") }),
  Object.freeze({ id: "push", name: "push-ul", re: w("push|pushul|push-ul|pusheaza|(?:pe|in|la) (?:git|github|gitlab|repo|repo-ul|repository)") }),
  Object.freeze({ id: "deploy", name: "deploy-ul", re: w("deploy|deployul|deploy-ul|deployment|deployeaza|(?:pune|punem|pui|urca|urcam|lanseaza|lansam|muta|mutam|scoate|scoatem)(?: [a-z0-9-]+){0,4} in productie") }),
]);

const NUMTOK = "(\\d{1,4}(?:[.,]\\d{1,2})?|[a-z]+)";
/** The verbs of a jump, longest form first (the regex takes the first alternative that matches). */
const SHOW = ["arata-mi direct|arata direct|arata-mi|arata|sari direct la|sari direct pe|sari direct|sari la|sari pe|treci direct la|treci direct|treci la|mergi direct la|mergi la",
  "intra direct in|intra direct la|intra direct|intra in|du-te direct la|du-te la|incepe direct cu|incepe cu|vreau direct|pune direct|direct la|direct"].join("|");
const AFTER = "dupa|de la|incepand cu|incepand de la|de pe la|pe la";
const TIME_KIND = "secunda|sec|momentul|minutul|min";
const TIME_UNIT = "secunde|secunda|sec|s|minute|minut|min";
/** „după secunda zece arată direct programarea” / „de la 0:10 sari la programare” (m:ss was turned into seconds before matching). */
const JUMP_TIME_FIRST = new RegExp(`(?<![a-z0-9])(?:${AFTER})\\s+(?:(${TIME_KIND})\\s+)?(?:a\\s+)?${NUMTOK}(?:-a|-lea)?(?:\\s+(?:de\\s+)?(${TIME_UNIT}))?[\\s,]+(?:sa\\s+)?(?:${SHOW})\\s+(.+)$`);
/** „arată direct programarea după secunda zece”. */
const JUMP_TIME_LAST = new RegExp(`(?<![a-z0-9])(?:${SHOW})\\s+(.+?)[\\s,]+(?:${AFTER})\\s+(?:(${TIME_KIND})\\s+)?(?:a\\s+)?${NUMTOK}(?:-a|-lea)?(?:\\s+(?:de\\s+)?(${TIME_UNIT}))?$`);
/** „de aici sari la programare”: the time is the player's position. */
const JUMP_FROM_HERE = /^(?:de aici|de acum|din acest punct|de la momentul asta|din punctul asta)[\s,]+(?:sari direct la|sari la|sari pe|treci direct la|treci la|arata direct|mergi direct la|mergi la|intra direct in)\s+(.+)$/;

const QUOTE_RE = /«[^»]{0,500}»|„[^”“"]{0,500}[”“"]|“[^”]{0,500}”|"[^"]{0,500}"/gu;
const quotesIn = (text) => [...String(text).matchAll(QUOTE_RE)].map((m) => m[0].slice(1, -1).trim()).filter(Boolean);
const NEW_START = "dup[ăa]|de la|de aici|sari|treci|arat[ăa]|taie|mut[ăa]|schimb[ăa]|scurteaz[ăa]|prelunge[șs]te|pune|adaug[ăa]|f[ăa]|[îi]n rezumat|[îi]n clip|[îi]n varianta|scrie|[îi]nlocuie[șs]te|[șs]terge|scoate|elimin[ăa]|repar[ăa]";
/**
 * A decision or a publication is a request of its own: „Aprob clipul și publică-l pe YouTube” is two clauses, so each half gets its
 * answer. „urcă / încarcă” starts one only when a platform follows in the same sentence — otherwise it moves a text up.
 * (Non-capturing groups only: String.split would return captures as clauses.)
 */
const DECISION_START = "aprob|aprob[ăa]|aprob[ăa]m|accept|accept[ăa]|accept[ăa]m|public[ăa]|public[ăa]m|posteaz[ăa]|post[ăa]m|trimite|trimitem";
const UPLOAD_START = "(?:urc[ăa]|[îi]ncarc[ăa])(?![\\p{L}\\p{N}])[^.;!?\\n]*?(?<![\\p{L}\\p{N}])(?:youtube|tiktok|instagram|facebook|linkedin|internet|net|cloud|drive|online)(?![\\p{L}\\p{N}])";
const CONJ_SPLIT = new RegExp(`\\s*,?\\s+(?:iar|apoi|dar|îns[ăa]|ins[ăa]|[șs]i apoi|[șs]i)\\s+(?=(?:${NEW_START}|${DECISION_START})(?![\\p{L}\\p{N}])|${UPLOAD_START})`
  + `|\\s*,\\s+(?=(?:dup[ăa]|de la|de aici)\\s|(?:${DECISION_START})(?![\\p{L}\\p{N}])|${UPLOAD_START})`, "iu");

/** Sentences and clauses of a revision text; quoted passages are never split and never read as instructions. */
export function splitClauses(text) {
  const quotes = [];
  const masked = String(text ?? "").replace(/\b(sec|min|nr)\.\s+(?=\d)/giu, "$1 ")
    .replace(QUOTE_RE, (q) => { quotes.push(q); return `\u0002${quotes.length - 1}\u0003`; });
  const restore = (s) => s.replace(/\u0002(\d+)\u0003/g, (_, i) => quotes[Number(i)]);
  const out = [];
  for (const sentence of masked.split(/[.;!?]+(?=\s|$)|\n+/u)) {
    for (const part of sentence.split(CONJ_SPLIT)) {
      const clause = restore(String(part ?? "")).trim().replace(/^[,\s–—:-]+|[,\s]+$/gu, "");
      if (clause) out.push(clause);
    }
  }
  return out;
}

/** The clause for word matching: quotes removed, m:ss turned into seconds, normalized, without a leading „Lega,”. */
function plain(clause) {
  // "0:10" is a time; "9:16" and "16:9" are formats and stay words (normalize turns the colon into a space).
  const bare = String(clause).replace(QUOTE_RE, " ").replace(/(?<![\d:])(\d{1,2}):(\d{2})(?![\d:])/g, (all, m, s) => (Number(s) < 60 && all !== "9:16" && all !== "16:9" ? `${Number(m) * 60 + Number(s)} secunde` : all));
  return normalize(bare).replace(/[.!?;,]+/g, " ").replace(/\s+/g, " ").trim().replace(/^(?:hei |hey |buna )?lega\s+/, "");
}

// ---------------------------------------------------------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------------------------------------------------------

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const KIND_ALIAS = Object.freeze({ master: "master", clip: "master", edit: "master", vertical: "vertical", variant: "vertical", summary: "summary", document: "summary" });
const TARGET_LABEL = Object.freeze({ master: "Clipul 16:9", vertical: "Varianta verticală 9:16", summary: "Rezumatul comercial" });
const TITLE_LABEL = Object.freeze({ master: "Titlul clipului", vertical: "Titlul variantei verticale", summary: "Titlul rezumatului" });
/** The two players of the Room. `player` names one of them („master” = 16:9, „vertical” = 9:16); anything else names none. */
const PLAYERS = Object.freeze(["master", "vertical"]);
const playerOf = (value) => (typeof value === "string" && PLAYERS.includes(KIND_ALIAS[value]) ? KIND_ALIAS[value] : null);
const textItemsOf = (ir) => (Array.isArray(ir?.tracks) ? ir.tracks : []).filter((t) => t?.kind === "text").flatMap((t) => t.items || []);

function contextOf(ctx) {
  const c = isObject(ctx) ? ctx : {};
  const version = (v) => {
    if (!isObject(v) || !(v.versionId || v.ir)) return null;
    return { versionId: v.versionId ? String(v.versionId) : null, ir: isObject(v.ir) && Array.isArray(v.ir.tracks) ? v.ir : null, variantId: v.variantId ? String(v.variantId) : null };
  };
  // The sections of THIS document when the caller gives them (with their text, for «vechi» în «nou»); otherwise the template's list.
  const given = Array.isArray(c.summary?.sections) ? c.summary.sections.filter((s) => isObject(s) && s.id) : [];
  const sections = given.length
    ? given.map((s) => ({ id: String(s.id), heading: String(s.heading || s.id), text: typeof s.text === "string" ? s.text : null, auto: Boolean(s.auto) || ["video", "provenance"].includes(String(s.id)) }))
    : SUMMARY_SECTIONS.map((s) => ({ ...s, text: null, auto: Boolean(s.auto) }));
  const summary = isObject(c.summary) ? { documentId: c.summary.documentId ? String(c.summary.documentId) : null, version: Number.isInteger(c.summary.version) ? c.summary.version : null, sections } : null;
  const master = version(c.master), vertical = version(c.vertical);
  const versionOf = { master: master?.versionId || null, vertical: vertical?.versionId || null, summary: summary?.documentId || null };
  let selection = null;
  const notes = [];
  if (isObject(c.selection) && c.selection.kind === "text") {
    // The Room's selection of an on-screen text: { kind: "text", id, versionId, player? }. Its clip is the one whose CURRENT version
    // it was picked on (the 16:9 master or the 9:16 variant); `player` says which player it was picked in and must agree with that.
    // A text of an older version, of the other player, one the montage no longer has, or the mandatory label is not a target.
    const versionId = c.selection.versionId ? String(c.selection.versionId) : null;
    const picked = c.selection.itemId || c.selection.id || null;
    const said = playerOf(c.selection.player);
    const kind = PLAYERS.find((player) => versionId && versionOf[player] === versionId) || null;
    const clip = kind === "master" ? master : kind === "vertical" ? vertical : null;
    const item = clip?.ir && picked ? textItemsOf(clip.ir).find((i) => String(i.id) === String(picked)) || null : null;
    if (!kind) notes.push("Selecția era pe o versiune mai veche; am ignorat-o.");
    else if (said && said !== kind) notes.push("Selecția nu se potrivește cu clipul în care a fost făcută; am ignorat-o.");
    else if (!picked || (clip.ir && !item)) notes.push("Textul selectat nu mai există în versiunea curentă a clipului; am ignorat selecția.");
    else if (item && isDisclosureItem(item)) notes.push("Eticheta obligatorie nu se selectează și nu se editează; am ignorat selecția.");
    else selection = { kind, versionId, itemId: String(picked), sectionId: null };
  } else if (isObject(c.selection) && typeof c.selection.kind === "string" && Object.hasOwn(KIND_ALIAS, c.selection.kind)) {
    const kind = KIND_ALIAS[c.selection.kind];
    const versionId = c.selection.versionId ? String(c.selection.versionId) : null;
    // A selection made on an older version (or another project) is not a target: the same rule as parseInstruction's own.
    const current = kind === "summary" ? Boolean(summary) : Boolean(versionId && versionId === versionOf[kind]);
    // { kind, id, versionId } with the artifact named outright: `id` is the selected text item of a clip, or the selected section of the summary.
    const picked = c.selection.itemId || c.selection.sectionId || c.selection.id || null;
    if (current) selection = { kind, versionId, itemId: kind !== "summary" && picked ? String(picked) : null, sectionId: kind === "summary" && picked ? String(picked) : null };
    else notes.push("Selecția era pe o versiune mai veche; am ignorat-o.");
  }
  const timecodeMs = Number.isFinite(c.timecodeMs) && c.timecodeMs >= 0 ? c.timecodeMs : null;
  // The player the timecode was taken in: `player` as the Room sends it (`playerKind` is the older name of the same field). A moment
  // in the 9:16 player targets the vertical variant; without a known player it is a moment of the 16:9 clip.
  const playerKind = playerOf(c.player) || playerOf(c.playerKind) || "master";
  const recent = isObject(c.lastRevised) && TARGET_KINDS.includes(KIND_ALIAS[c.lastRevised.kind]) && Number.isFinite(c.lastRevised.atMs) && Number.isFinite(c.nowMs)
    && c.nowMs - c.lastRevised.atMs >= 0 && c.nowMs - c.lastRevised.atMs <= RECENT_WINDOW_MS ? KIND_ALIAS[c.lastRevised.kind] : null;
  const choice = isObject(c.choice) ? { target: TARGET_KINDS.includes(KIND_ALIAS[c.choice.target]) ? KIND_ALIAS[c.choice.target] : null, markerFrame: Number.isInteger(c.choice.markerFrame) ? c.choice.markerFrame : null } : { target: null, markerFrame: null };
  return { master, vertical, summary, selection, timecodeMs, playerKind, recent, choice, notes, texts: isObject(c.texts) ? c.texts : null, tone: TONES.includes(c.tone) ? c.tone : null,
    recentItemId: c.recentItemId ? String(c.recentItemId) : null };
}

const targetRef = (kind, c) => (kind === "summary" ? { kind, id: c.summary?.documentId || null, versionId: c.summary?.version ?? null } : { kind, id: c[kind]?.variantId || null, versionId: c[kind]?.versionId || null });
const artifactOf = (n) => (SUMMARY_STRONG.test(n) ? "summary" : VERTICAL_WORDS.test(n) ? "vertical" : MASTER_WORDS.test(n) ? "master" : SUMMARY_WORDS.test(n) ? "summary" : null);
const available = (kind, c) => (kind === "summary" ? Boolean(c.summary) : Boolean(c[kind]));

// ---------------------------------------------------------------------------------------------------------------------------
// Clause detectors
// ---------------------------------------------------------------------------------------------------------------------------

function secondsOf(kind, token, unit) {
  const t = String(token || "");
  const value = /^\d/.test(t) ? Number(t.replace(",", ".")) : numberOf(t);
  if (value === null || value === undefined || !Number.isFinite(value) || value < 0) return null;
  const minutes = /^min/.test(String(kind || "")) || /^min/.test(String(unit || ""));
  return minutes ? value * 60 : value;
}

/** The tone a normalized clause asks for: „prea tehnic” → business, „prea comercial” → technical; „nu e prea tehnic” asks for none. */
const toneIn = (n) => (TONE_NEGATED.test(n) ? null : TONE_BUSINESS.test(n) ? "business" : TONE_TECHNICAL.test(n) ? "technical" : null);
/** `toneFrom(text)` → "business" | "technical" | null — the tone rule alone, for callers that only need it. */
export const toneFrom = (text) => toneIn(plain(text));

/** A jump request in a normalized clause → { afterSec, phrase } | { afterSec: null, phrase, fromHere } | null. */
function jumpIn(n, c) {
  let m = JUMP_TIME_FIRST.exec(n);
  if (m) { const s = secondsOf(m[1], m[2], m[3]); if (s !== null) return { afterSec: s, phrase: m[4].trim() }; }
  m = JUMP_TIME_LAST.exec(n);
  if (m) { const s = secondsOf(m[2], m[3], m[4]); if (s !== null) return { afterSec: s, phrase: m[1].trim() }; }
  m = JUMP_FROM_HERE.exec(n);
  if (m) return { afterSec: c.timecodeMs !== null ? Math.round(c.timecodeMs / 100) / 10 : null, phrase: m[1].trim(), fromHere: true };
  return null;
}

/**
 * `jumpToMarker(text, ir, { timecodeMs, markerFrame })` → null when the text asks for no jump; otherwise { afterSec, phrase, … } with
 * the result of clip-ir.mjs jumpCut on `ir`: ok + { from, to, marker, needle, op } or ok: false + { reason, candidates }
 * (reason "TIME_MISSING" when „de aici” was said without a player position). The rule alone, as classify applies it.
 */
export function jumpToMarker(text, ir, { timecodeMs = null, markerFrame = null } = {}) {
  const jump = jumpIn(plain(text), { timecodeMs: Number.isFinite(timecodeMs) && timecodeMs >= 0 ? timecodeMs : null });
  if (!jump) return null;
  if (jump.afterSec === null) return { afterSec: null, phrase: jump.phrase, ok: false, reason: "TIME_MISSING", from: null, candidates: [] };
  return { afterSec: jump.afterSec, phrase: jump.phrase, ...jumpCut(ir, { afterSec: jump.afterSec, markerNote: jump.phrase, markerFrame }) };
}

const SUBJECT_TEXT = Object.freeze({ site: "site-ul", siteul: "site-ul", aplicatia: "aplicația", aplicatie: "aplicația", app: "aplicația", pagina: "pagina", formular: "formularul", formularul: "formularul",
  buton: "butonul", butonul: "butonul", software: "software-ul", softul: "software-ul" });
/** A judgement with no subject of its own („E bine”, „Arată bine”, „Îmi place”) is about the delivery; „Vremea e frumoasă” is not. */
const BARE_JUDGEMENT = /^(?:totul |tot |asa |acum |da |nu )?(?:e|este|sunt|arata|merge|merg|pare|par|suna|mi se pare|imi place|ne place|nu-mi place|super|perfect|bravo|ok)(?![a-z0-9])/;
function feedbackOf(n, positive) {
  const soft = SOFTWARE_NOUNS.exec(n);
  const artifact = artifactOf(n);
  const subject = soft ? "software" : artifact === "vertical" ? "vertical" : artifact === "master" ? "clip" : artifact === "summary" ? "summary" : "general";
  if (subject === "general" && !BARE_JUDGEMENT.test(n)) return null;
  const named = soft ? SUBJECT_TEXT[soft[0]] || "software-ul" : subject === "clip" ? "clipul" : subject === "vertical" ? "varianta verticală" : subject === "summary" ? "rezumatul" : "livrarea";
  const where = subject === "software" || subject === "general" ? "Acceptarea software rămâne butonul „Accept local” din camera de livrare."
    : subject === "summary" ? "„Gata de prezentare” rămâne decizia ta, din camera de livrare." : "Aprobarea creativă rămâne decizia ta (cu Windows Hello), din camera de livrare.";
  const message = positive ? `Notat că ${named} e bine. ${where}` : `Notat că ${named} nu e în regulă; spune ce anume să schimb și pregătesc doar diferența. Nimic nu s-a schimbat.`;
  return { subject, polarity: positive ? "positive" : "negative", message };
}

const DECISION_TEXT = Object.freeze({
  software_accept: "Acceptarea software-ului este decizia ta: butonul „Accept local” din camera de livrare. Eu nu accept nimic în locul tău.",
  creative_approve: "Aprobarea creativă este decizia ta, pe versiunea afișată, cu Windows Hello, din camera de livrare.",
  summary_approve: "„Gata de prezentare” este decizia ta, pe versiunea afișată a rezumatului, din camera de livrare.",
  publish: "Publicarea este oprită: din Hub nu se publică, nu se urcă și nu se trimite nimic în M11.",
});
const PUBLISH_VERBS = /^(?:publica|publicam|posteaza|postam|trimite|trimitem)$/;
const UPLOAD_VERBS = /^(?:urca|incarca)$/;
/** „commit-ul”, „commit-ul și push-ul”, „commit-ul, push-ul și deploy-ul”. */
const listRo = (names) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} și ${names.at(-1)}`);
function repoText(ops) {
  const names = listRo(ops.map((op) => op.name));
  const subject = `${names.charAt(0).toLocaleUpperCase("ro-RO")}${names.slice(1)}`;
  return ops.length === 1
    ? `${subject} nu face parte din livrare; este o decizie separată, pe care o iei tu, în afara camerei de livrare. Nimic nu s-a schimbat.`
    : `${subject} nu fac parte din livrare; sunt decizii separate, pe care le iei tu, în afara camerei de livrare. Nimic nu s-a schimbat.`;
}
/**
 * What a normalized clause asks Lega to decide or to do outside a delivery, each with its answer → [{ kind, message }] (empty: none).
 * - A clause that STARTS with a decision verb. accept / approve: one answer per thing the clause names — software, clip, summary
 *   („Aprob clipul și rezumatul” gets both); naming nothing, „accept” is the software and „aprob” the clip. publish / post / send:
 *   publishing is off. „urcă / încarcă” is an upload only next to a platform (otherwise it moves a text up).
 * - commit / push / deploy anywhere in the clause: not part of a delivery — unless the clause is about the summary's own text.
 */
function decisionsIn(n, named) {
  const kinds = [];
  const m = DECISION.exec(n);
  if (m) {
    const verb = m[1];
    if (PUBLISH_VERBS.test(verb)) kinds.push("publish");
    else if (UPLOAD_VERBS.test(verb)) { if (PLATFORM.test(n)) kinds.push("publish"); }
    else {
      if (SOFTWARE_NOUNS.test(n)) kinds.push("software_accept");
      if (MASTER_WORDS.test(n) || VERTICAL_WORDS.test(n)) kinds.push("creative_approve");
      if (SUMMARY_WORDS.test(n) || /gata de prezentare/.test(n)) kinds.push("summary_approve");
      if (!kinds.length) kinds.push(/^accept/.test(verb) ? "software_accept" : "creative_approve");
    }
  }
  const out = kinds.map((kind) => ({ kind, message: DECISION_TEXT[kind] }));
  const repo = named === "summary" ? [] : REPO_OPS.filter((op) => op.re.test(n));
  if (repo.length) out.push({ kind: "repo_ops", ops: repo.map((op) => op.id), message: repoText(repo) });
  return out;
}
/** Whether a normalized clause speaks of the application itself (an element next to a text noun may be what a clip text covers). */
const aboutSoftware = (n) => SOFTWARE_STRONG.test(n) || (SOFTWARE_NOUNS.test(n) && !TEXT_NOUNS.test(n));

/** The section a clause names (longest alias first), or the selected one. */
function sectionIn(n, c) {
  const sections = c.summary?.sections || [];
  const candidates = [];
  for (const s of sections) {
    for (const alias of [plain(s.heading), ...(SECTION_ALIASES[s.id] || [])]) if (alias) candidates.push({ alias, section: s });
  }
  candidates.sort((a, b) => b.alias.length - a.alias.length);
  const hit = candidates.find((x) => w(x.alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).test(n));
  if (hit) return hit.section;
  if (c.selection?.kind === "summary" && c.selection.sectionId) return sections.find((s) => s.id === c.selection.sectionId) || null;
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------------
// classify
// ---------------------------------------------------------------------------------------------------------------------------

/** "Titlul clipului sau titlul rezumatului" — the options of a question as one phrase. */
const orList = (labels) => labels.map((label, i) => (i ? `${label.charAt(0).toLocaleLowerCase("ro-RO")}${label.slice(1)}` : label)).join(" sau ");

/** Dry run of the operations on the target IR (pure): { ok, durationMs: { before, after }, error? }. */
export function previewOps(ir, ops) {
  if (!isObject(ir) || !Array.isArray(ops) || !ops.length) return { ok: false, error: "nimic de aplicat" };
  try {
    const out = applyOps(ir, ops);
    const v = validateIR(out, { presets: PRESETS });
    const ms = (x) => Math.round(framesToMs(timelineDuration(x), x.fps));
    return v.ok ? { ok: true, durationMs: { before: ms(ir), after: ms(out) } } : { ok: false, error: v.errors[0]?.message || "IR invalid" };
  } catch (error) { return { ok: false, error: String(error?.message || error).slice(0, 300) }; }
}

/**
 * `classify(text, ctx)` →
 *   { textRedacted, clauses, classes, status, actions, clarification, target, media, vertical, summary, software, feedback, messages, notes }
 *   (the text is returned only redacted — it is what delivery_revisions.text_redacted stores)
 * ctx: { master: { versionId, ir }, vertical: { versionId, ir, variantId }, summary: { documentId, version, sections: [{ id, heading,
 *        text? }] }, texts (the template's tone texts), tone (the clip's current tone),
 *        selection: the Room's { kind: "text", id, versionId, player? } (an on-screen text; its clip is the one whose current version
 *          it was picked on) or { kind: "master" | "vertical" | "summary", id | itemId | sectionId, versionId },
 *        timecodeMs, player: "master" | "vertical" (the player the timecode was taken in; `playerKind` is the older name),
 *        lastRevised: { kind, atMs }, nowMs, recentItemId,
 *        choice: { target } | { markerFrame } — the owner's answer to the ONE question of a previous call }.
 * clauses: [{ index, text, class, target, ops, brief, prefs, … }] in the order spoken.
 * status: "CLARIFY" (one question pending; nothing is proposed) | "PROPOSE" (media operations for ONE plan card) | "SUMMARY_EDIT" |
 *   "ROUTE_SOFTWARE" | "REFUSED" (only something a sentence may not do: accept, approve, publish, commit / push / deploy, edit a
 *   generated section; `messages` answers every half of it) |
 *   "NOTED" (feedback, or a request that changes nothing) | "UNKNOWN". With several kinds of action in one sentence `actions` lists them all (REVISION_RECORD_STATUS
 *   maps a status to the delivery_revisions status the service records).
 * media / vertical: { target, ops, brief, prefs, lines, preview } — ops in application order (tone and text first, cuts last, the
 *   latest cut first so earlier frames stay valid). summary: { target, edits: [{ id, text }] }. software: { request }.
 */
export function classify(text, ctx = {}) {
  if (typeof text !== "string" || !text.trim()) throw new HubError("validation", "Observația este goală.", { code: "REVISION_TEXT_REQUIRED" });
  if (text.length > MAX_TEXT) throw new HubError("validation", `Observația depășește ${MAX_TEXT} de caractere.`, { code: "REVISION_TEXT_TOO_LONG" });
  const c = contextOf(ctx);
  const notes = [...c.notes];
  const messages = [];
  const clauses = [];
  const questions = [];
  let carried = null; // the media/summary artifact named earlier in the same utterance
  const ask = (clause, question) => { clause.clarification = question; questions.push({ index: clause.index, ...question }); };

  const mediaClause = (clause, kind, raw, n) => {
    clause.class = kind === "vertical" ? "vertical" : "clip";
    clause.target = targetRef(kind, c);
    const target = c[kind];
    if (!target?.ir) { clause.needs = "ir"; notes.push(`Nu am montajul pentru ${TARGET_LABEL[kind].toLowerCase()}; nu pot calcula operațiile.`); return; }
    const hooks = target.ir.tracks.filter((t) => t.kind === "text").flatMap((t) => t.items || []).filter((i) => i.style === "hook");
    // „titlul” = the clip's hook, „textul de final” = its CTA: named by role, so parseInstruction needs no time for them.
    let instruction = raw.replace(/(?<![\p{L}\p{N}])(?:textul|mesajul|titlul)\s+de\s+(?:final|[îi]ncheiere|sf[âa]r[șs]it)(?![\p{L}\p{N}])/giu, "cta-ul");
    if (hooks.length === 1) instruction = instruction.replace(/(?<![\p{L}\p{N}])titlul(?!\s+de\s+[îi]nceput)(?![\p{L}\p{N}])/giu, "hook-ul");
    const byRole = instruction !== raw;
    const selectedItemId = c.selection && c.selection.kind === kind ? c.selection.itemId : null;
    const atMs = !byRole && c.timecodeMs !== null && c.playerKind === kind ? c.timecodeMs : null;
    if (!quotesIn(raw).length && TEXT_NOUNS.test(n) && REWORD.test(n) && !DIRECTION.test(n)) {
      ask(clause, { kind: "text", question: "Spune textul nou între ghilimele (de exemplu: schimbă textul de final în «Sunați-ne»). Nu rescriu texte singură: livrarea nu folosește niciun model.", options: [] });
      return;
    }
    let parsed;
    try { parsed = parseInstruction(instruction, { ir: target.ir, atMs, selectedItemId, recentItemId: c.recentItemId }); }
    catch (error) { clause.class = "unknown"; notes.push(String(error?.message || error).slice(0, 200)); return; }
    clause.ops = parsed.ops;
    // The parser's own notes are for the owner too („propunere: 8% din înălțimea cadrului …”).
    for (const note of parsed.notes || []) notes.push(note);
    if (parsed.clarification) ask(clause, { kind: "instruction", question: parsed.clarification, options: (parsed.options || []).slice(0, MAX_OPTIONS).map((id) => ({ id, label: id, itemId: id })) });
  };

  const summaryClause = (clause, raw, n) => {
    clause.class = "summary";
    clause.target = targetRef("summary", c);
    if (!c.summary) { clause.needs = "summary"; notes.push("Livrarea nu are încă un rezumat de editat."); return; }
    const quotes = quotesIn(raw);
    const section = sectionIn(n, c);
    if (TITLE_WORD.test(n) && !section) { clause.refused = "SUMMARY_TITLE_GENERATED"; messages.push("Titlul rezumatului se generează (cu eticheta de date sintetice) și nu se schimbă de mână; pot schimba textul secțiunilor."); return; }
    if (section?.auto) {
      // A generated section is refused with where it comes from AND where the owner's own words can go instead.
      clause.refused = "SUMMARY_SECTION_AUTO";
      const editable = c.summary.sections.filter((s) => !s.auto);
      const suggested = ["next_step", "problem"].map((id) => editable.find((s) => s.id === id)).filter(Boolean);
      const where = (suggested.length ? suggested : editable.slice(0, 2)).map((s) => `«${s.heading}»`).join(" sau ");
      messages.push(`Secțiunea «${section.heading}» se generează ${AUTO_SECTION_SOURCE[section.id] || "din starea curentă a livrării"} și nu se editează de mână.`
        + (where ? ` Observațiile tale le scrii într-o secțiune editabilă, de exemplu ${where}: spune secțiunea și textul nou, între ghilimele.` : ""));
      return;
    }
    if (!section || !quotes.length) {
      const editable = c.summary.sections.filter((s) => !s.auto);
      ask(clause, { kind: "text", question: section ? `Ce text pun în secțiunea «${section.heading}»? Scrie-l între ghilimele.` : "În ce secțiune a rezumatului și ce text? Spune secțiunea și pune textul între ghilimele.",
        options: section ? [] : editable.slice(0, MAX_OPTIONS).map((s) => ({ id: s.id, label: s.heading })) });
      return;
    }
    // «vechi» în «nou» replaces inside the section when its text is known; one quote replaces the section's text.
    let next = quotes[quotes.length - 1];
    if (quotes.length >= 2 && typeof section.text === "string" && section.text.includes(quotes[0])) next = section.text.replace(quotes[0], quotes[1]);
    if (next.length > 4000) { clause.refused = "SUMMARY_TEXT_TOO_LONG"; messages.push("Textul unei secțiuni are cel mult 4000 de caractere."); return; }
    clause.edits = [{ id: section.id, text: next }];
  };

  for (const [index, raw] of splitClauses(text).entries()) {
    const n = plain(raw);
    const clause = { index, text: redactText(raw), class: "unknown", target: null, ops: [], brief: null, prefs: null };
    clauses.push(clause);
    if (!n) continue;
    const named = artifactOf(n);

    // 0. „Nu publica nimic”: the owner's constraint is noted — and it holds anyway, publishing is off.
    const noPublish = NO_PUBLISH.exec(n);
    if (noPublish && (noPublish[1] || PLATFORM.test(n) || /(?<![a-z0-9])nimic(?![a-z0-9])/.test(n))) {
      clause.class = "feedback";
      clause.feedback = { subject: "publishing", polarity: "none", message: "Notat: nu public, nu urc și nu trimit nimic. Publicarea este oricum oprită: din Hub nu se publică nimic în M11." };
      messages.push(clause.feedback.message);
      continue;
    }

    // 1. A decision the owner takes with their own button, a publication, or a repository operation — never from a sentence.
    //    Every one the clause names is answered, in one message, so no half of it is left without an answer.
    const decisions = decisionsIn(n, named);
    if (decisions.length) {
      clause.class = "feedback";
      clause.decision = decisions[0].kind;
      if (decisions.length > 1) clause.decisions = decisions.map((d) => d.kind);
      clause.refused = decisions[0].kind === "repo_ops" ? "NOT_PART_OF_DELIVERY" : "OWNER_DECISION";
      clause.message = decisions.map((d) => d.message).join(" ");
      messages.push(clause.message);
      continue;
    }

    // 2. Tone and jump (a clause may carry both).
    const toneNegated = TONE_NEGATED.test(n);
    const tone = toneIn(n);
    const jump = jumpIn(n, c);
    if (tone && named === "summary") {
      clause.class = "summary";
      clause.target = targetRef("summary", c);
      clause.refused = "SUMMARY_TONE";
      messages.push("Rezumatul are un șablon fix, fără variante de ton; spune secțiunea și textul nou între ghilimele și fac o versiune nouă.");
      continue;
    }
    // A tone word about the SOFTWARE in a clause that names no clip („Site-ul e prea tehnic”) is not a clip revision: it is recorded
    // as feedback about the software, with what a change in the site needs. No operation, no question.
    const softwareTone = Boolean(tone) && !named && aboutSoftware(n);
    if (softwareTone) {
      clause.class = "feedback";
      clause.feedback = { subject: "software", polarity: "negative", about: "tone",
        message: `Am notat observația „${clause.text}” ca feedback despre software. Tonul îl schimb doar la clip, iar fraza nu numește clipul, deci nu am schimbat nimic. `
          + "Pentru o schimbare în site sau în aplicație, spune ce anume să schimb (de exemplu: „Schimbă titlul paginii în «…»”) și o pregătesc ca plan separat de software. "
          + `Dacă te refereai la clip, spune „Clipul e ${tone === "business" ? "prea tehnic" : "prea comercial"}”.` };
      messages.push(clause.feedback.message);
      if (c.selection || c.timecodeMs !== null) notes.push("Fraza vorbește despre aplicație, nu despre clip; am urmat fraza, nu selecția.");
    } else if (tone) {
      clause.class = "tone";
      clause.tone = tone;
      clause.target = targetRef("master", c);
      clause.brief = { audience: tone };
      clause.prefs = { tone };
      if (c.master?.ir && c.texts) clause.ops = toneOps(c.master.ir, c.texts, tone); else clause.needs = c.master?.ir ? "texts" : "ir";
      if (clause.needs === undefined && !clause.ops.length) {
        // Nothing to change is an answer, not a silent no-op and not a plan with zero operations.
        clause.noop = true;
        clause.brief = null;
        clause.prefs = null;
        messages.push(`Clipul are deja tonul ${tone === "business" ? "comercial" : "tehnic"}; textele rămân la fel.`);
      }
      carried = "master";
    }
    if (jump) {
      const part = tone ? { index, text: clause.text, class: "clip", target: null, ops: [], brief: null, prefs: null } : clause;
      if (tone) clauses.push(part);
      part.class = "clip";
      part.target = targetRef("master", c);
      part.jump = { afterSec: jump.afterSec, phrase: jump.phrase };
      carried = "master";
      if (jump.afterSec === null) { ask(part, { kind: "time", question: "De la ce secundă să sar? Spune, de exemplu, „după secunda zece”.", options: [] }); continue; }
      if (!c.master?.ir) { part.needs = "ir"; continue; }
      const cut = jumpCut(c.master.ir, { afterSec: jump.afterSec, markerNote: jump.phrase, markerFrame: c.choice.markerFrame });
      if (cut.ok) {
        part.ops = [cut.op];
        part.prefs = { jump: { afterSec: jump.afterSec, markerNote: cut.needle } };
        part.jump = { ...part.jump, from: cut.from, to: cut.to, marker: cut.marker };
      } else {
        const table = (cut.candidates.length ? cut.candidates : markerTable(c.master.ir)).slice(0, 8);
        const listed = table.map((m) => `${m.time} ${m.note || m.kind}`).join(" · ");
        const why = cut.reason === "AFTER_END" ? `Clipul are doar ${fmtTime(cut.durationMs)}; nu am ce tăia după secunda ${jump.afterSec}.`
          : cut.reason === "AMBIGUOUS" ? `Două momente marcate sunt în același loc pentru „${jump.phrase}”.` : `Nu am găsit un moment marcat „${jump.phrase}” după secunda ${jump.afterSec}.`;
        part.jump = { ...part.jump, reason: cut.reason };
        ask(part, { kind: "marker", question: `${why} Momentele marcate: ${listed || "niciunul"}. La care sar?`,
          options: cut.candidates.slice(0, MAX_OPTIONS).map((m) => ({ id: `marker:${m.frame}`, label: `${m.time} ${m.note || m.kind}`, markerFrame: m.frame })) });
      }
      continue;
    }
    if (clause.class === "tone" || softwareTone) continue;

    // 3. Software: a software noun AND a change verb, in a clause that names no clip, variant, summary or text.
    const deniedChange = NO_CHANGE.test(n) && POSITIVE.test(n);
    const changing = !deniedChange && (CHANGE_VERBS.test(n) || DIRECTION.test(n));
    if (changing && CHANGE_VERBS.test(n) && !named && (SOFTWARE_STRONG.test(n) || (SOFTWARE_NOUNS.test(n) && !TEXT_NOUNS.test(n)))) {
      clause.class = "software";
      clause.request = clause.text;
      if (c.selection || c.timecodeMs !== null) notes.push("Fraza cere o schimbare în aplicație, nu în clip; am urmat fraza, nu selecția.");
      continue;
    }

    // 4. Feedback: a judgement without a change.
    if (!changing && !quotesIn(raw).length) {
      const positive = POSITIVE.test(n) && !NEGATED.test(n);
      const judged = positive || NEGATED.test(n) || toneNegated ? feedbackOf(n, positive || toneNegated) : null;
      if (judged) {
        clause.class = "feedback";
        clause.feedback = judged;
        messages.push(judged.message);
        continue;
      }
      if (TOO_MUCH.test(n) && named !== "summary") {
        clause.class = named === "vertical" ? "vertical" : "clip";
        clause.target = targetRef(named === "vertical" ? "vertical" : "master", c);
        const listed = c.master?.ir ? markerTable(c.master.ir).slice(0, 8).map((m) => `${m.time} ${m.note || m.kind}`).join(" · ") : "";
        ask(clause, { kind: "instruction", question: `Ce schimb concret? Spune intervalul (de exemplu „taie de la 10 la 14”) sau momentul la care să sar${listed ? `; momentele marcate: ${listed}` : ""}.`, options: [] });
        continue;
      }
      continue; // nothing recognized: stays "unknown"
    }

    // 5. A change: which artifact?
    let kind = named;
    let by = "words";
    if (kind && c.selection && c.selection.kind !== kind) notes.push(`Ai selectat ceva din ${TARGET_LABEL[c.selection.kind].toLowerCase()}, dar fraza vorbește despre ${TARGET_LABEL[kind].toLowerCase()}; am urmat fraza.`);
    if (!kind && c.choice.target) { kind = c.choice.target; by = "choice"; }
    if (!kind && c.selection) { kind = c.selection.kind; by = "selection"; }
    if (!kind && c.timecodeMs !== null) { kind = c.playerKind; by = "timecode"; }
    const clipOnly = CLIP_ONLY_VERBS.test(n) || DIRECTION.test(n);
    // A change verb alone is not a revision: without a montage verb, a text (quoted or named) or a rewording there is nothing
    // either artifact could take („Fă backup”). Unless the owner pointed at something (words, a selection, a moment, an answer),
    // such a clause stays unknown — asking „clip or summary?” or „what exactly?” about it would mislead, and block the rest.
    if (!kind && !clipOnly && !quotesIn(raw).length && !TEXT_NOUNS.test(n) && !REWORD.test(n)) { clause.unclear = true; continue; }
    if (!kind && carried) { kind = carried; by = "sentence"; }
    if (!kind && c.recent) { kind = c.recent; by = "recent"; }
    if (!kind) {
      const plausible = (clipOnly ? ["master"] : ["master", "summary"]).filter((k) => available(k, c));
      if (plausible.length === 1) { kind = plausible[0]; by = "only"; }
      else if (plausible.length >= 2) {
        const title = TITLE_WORD.test(n);
        const labels = title ? TITLE_LABEL : TARGET_LABEL;
        const needText = !quotesIn(raw).length && !clipOnly;
        ask(clause, { kind: "target", question: `${orList(plausible.map((k) => labels[k]))}?${needText ? " Spune și textul nou, între ghilimele." : ""}`,
          options: plausible.slice(0, MAX_OPTIONS).map((k) => ({ id: k, label: labels[k], target: k })) });
        clause.plausible = plausible;
        continue;
      } else { notes.push("Livrarea nu are încă un clip sau un rezumat de schimbat."); continue; }
    }
    clause.targetBy = by;
    if (!available(kind, c)) { clause.class = kind === "summary" ? "summary" : kind === "vertical" ? "vertical" : "clip"; clause.needs = kind; notes.push(`${TARGET_LABEL[kind]} nu există încă în această livrare.`); continue; }
    if (kind === "summary") summaryClause(clause, raw, n); else mediaClause(clause, kind, raw, n);
    carried = kind;
  }

  // --- one result for the planner
  const order = REVISION_CLASSES;
  const classes = [...new Set(clauses.map((cl) => cl.class))].filter((k) => k !== "unknown").sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const clarification = questions.length ? { index: questions[0].index, kind: questions[0].kind, question: questions[0].question, options: (questions[0].options || []).slice(0, MAX_OPTIONS), pending: questions.length - 1 } : null;
  const bundleFor = (kind) => {
    // One tone per revision: when two are said, the last one wins.
    const toneClause = clauses.filter((cl) => cl.class === "tone" && cl.target?.kind === kind && cl.ops.length).at(-1) || null;
    const mine = clauses.filter((cl) => cl.target?.kind === kind && ["tone", "clip", "vertical"].includes(cl.class) && cl.ops.length && (cl.class !== "tone" || cl === toneClause));
    if (!mine.length) return null;
    const all = mine.flatMap((cl) => cl.ops);
    const cuts = all.filter((o) => o.op === "cut_range").sort((a, b) => b.from - a.from);
    const ops = [...all.filter((o) => o.op !== "cut_range"), ...cuts];
    const brief = Object.assign({}, ...mine.map((cl) => cl.brief || {}));
    const prefs = Object.assign({}, ...mine.map((cl) => cl.prefs || {}));
    const ir = c[kind]?.ir || null;
    const lines = [];
    const jumps = mine.filter((cl) => cl.jump?.marker);
    if (toneClause) lines.push(`${toneClause.ops.length} ${toneClause.ops.length === 1 ? "text" : "texte"} de ton (${toneClause.tone === "business" ? "comercial" : "tehnic"})`);
    for (const cl of jumps) lines.push(`taie ${fmtTime(framesToMs(cl.jump.from, ir.fps))}–${fmtTime(cl.jump.marker.ms)}, salt la «${cl.jump.marker.note}»`);
    const explained = new Set([...(toneClause ? toneClause.ops : []), ...jumps.flatMap((cl) => cl.ops)]);
    const others = all.filter((o) => !explained.has(o)).length;
    if (others) lines.push(`${others} ${others === 1 ? "altă modificare" : "alte modificări"} de montaj`);
    return { target: targetRef(kind, c), ops, brief: Object.keys(brief).length ? brief : null, prefs: Object.keys(prefs).length ? prefs : null, lines, preview: ir ? previewOps(ir, ops) : null };
  };
  const media = bundleFor("master");
  const vertical = bundleFor("vertical");
  const edits = clauses.filter((cl) => cl.class === "summary" && Array.isArray(cl.edits)).flatMap((cl) => cl.edits);
  const summary = edits.length ? { target: targetRef("summary", c), edits } : null;
  const softwareClauses = clauses.filter((cl) => cl.class === "software");
  const software = softwareClauses.length ? { request: softwareClauses.map((cl) => cl.request).join(". ") } : null;
  const feedback = clauses.filter((cl) => cl.class === "feedback").map((cl) => ({ index: cl.index, text: cl.text, ...(cl.feedback || { subject: "decision", polarity: "none", message: cl.message }),
    ...(cl.decision ? { decision: cl.decision } : {}), ...(cl.decisions ? { decisions: cl.decisions } : {}) }));
  const actions = [media || vertical ? "media" : null, summary ? "summary" : null, software ? "software" : null].filter(Boolean);
  const refusedOnly = clauses.some((cl) => cl.refused) && !clauses.some((cl) => cl.class === "feedback" && !cl.refused);
  const noted = feedback.length > 0 || clauses.some((cl) => cl.noop);
  const status = clarification ? "CLARIFY" : media || vertical ? "PROPOSE" : summary ? "SUMMARY_EDIT" : software ? "ROUTE_SOFTWARE" : refusedOnly ? "REFUSED" : noted ? "NOTED" : "UNKNOWN";
  if (status === "UNKNOWN" && !messages.length) messages.push("Nu am înțeles ce să schimb. Poți spune, de exemplu: „Clipul e prea tehnic”, „După secunda zece arată direct programarea” sau „În rezumat, la Următorul pas scrie «…»”.");
  // Next to an answer about the rest of the sentence, a part that was not understood is said — never dropped silently.
  if (status !== "UNKNOWN") for (const cl of clauses.filter((x) => x.unclear)) notes.push(`Nu am înțeles ce să schimb în „${cl.text}”; partea aceasta a rămas neschimbată.`);
  const first = clauses.find((cl) => cl.target && cl.class !== "feedback");
  return { textRedacted: redactText(text), clauses, classes, status, actions, clarification, target: first?.target || null, media, vertical, summary, software, feedback,
    messages: [...new Set(messages)], notes: [...new Set(notes)] };
}
