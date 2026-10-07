/**
 * IntentResolver (M06 §11): the owner's words (typed, or a transcript) → ordered steps, resolved locally without a model.
 *
 * - Chained commands are split into steps ("…; apoi …"), each with an effect class: none | read | navigate | plan | effect |
 *   interrupt. Reading and planning never start work; an `effect` step only becomes a request that the backend validates
 *   against the session, the policy and the pending envelope.
 * - Negations and conditions are kept ("nu porni", "doar arată", "fără deploy"): they remove effects, never add them.
 * - A confirmation ("da", "execută planul") counts only when exactly one plan waits for it; with two it asks which one; a
 *   word inside quotes is a quotation, not consent. A model may PROPOSE an intent elsewhere; it never confirms through here.
 * - Project and mission references are matched without diacritics; two plausible matches produce one useful question.
 * - M10.2: before matching, polite words and fillers are removed ("te rog", "poți să", "aș vrea să"), a conjugated first verb
 *   becomes the imperative ("poți să deschizi" → "deschide"), "din nou / încă o dată" are recorded as `again`, and a pronoun
 *   object ("deschide-l") as `ref: "it"`. A negation ("nu executa planul", "anulează planul") is matched BEFORE the plan request,
 *   a condition ("doar dacă trec testele") becomes ONE question and never an effect, and every step carries its effect class
 *   (policy/effect-class.mjs) for the one command path.
 * - M10.2.1: a name may carry a dot inside a word ("Factory Demo M10.2", "v2.1"); a sentence-final period never becomes part of
 *   it. "Continuă?" is a question (ONE clarification), never the resume. "Redeschide poarta" only SHOWS the rearm card
 *   (gate_rearm, a read): the rearm itself is a separate owner-session command with a fresh authenticator.
 * - 2.12.1 round 2: „Redeschide poarta / Rearmează Hub-ul / Continuă … după Stop All” (and „După Stop All, redeschide poarta”) only show
 *   the rearm card; a „Stop All” named right after „după” next to a reopen or resume verb is the suspension being talked about, never a
 *   second Stop All. A name part with a digit or a dot is never dropped to reach a shorter project name. „Ce urmează? Continuă” holds
 *   the resume with a neutral sentence (the question was about something else).
 * - 2.12.2 (P0-R2): an interruption (Stop All, and by the same rule a pause, „Oprește Codex”, „Preiau eu”, „Îngheață …”) runs only on a
 *   clear imperative: the clause, after „Lega,” and polite words, STARTS with the command and no condition follows it. A question, a
 *   negation, a condition, reported speech or a quotation of the same words becomes explain_stop (a read the Hub answers), never the stop.
 * - 2.12.2 (P0-R6, the owner's live session): a request to change the Hub's mode („Treci pe live”, „Pune Hub-ul în modul live”,
 *   „Activează LIVE_VALIDATION”) is explain_mode — a read the Hub answers (the mode is never changed from a sentence, and a plan does not
 *   need it); a question about the mode („Ești în build safe?”) and „Ce a rămas în <proiect>?” are status reads. A request that only also
 *   talks about the stop („Deschide ProDelivery, nu opri tot”) keeps the request (review R2-F6).
 *
 * Pure function; the caller supplies the context (projects, current project, missions, pending envelopes, and — only from the
 * server — the last target the owner acted on).
 */
import { classOfIntent } from "../policy/effect-class.mjs";

export const INTENT_EFFECTS = Object.freeze({
  open_project: "navigate", switch_project: "navigate", continue_last: "read", show_changes: "read", show_review: "read", show_tests: "read",
  show_preview: "read", show_plan: "plan", continue_work: "plan", confirm: "effect", not_yet: "none", reject_plan: "none", reorder: "none",
  status: "read", why_blocked: "read", why_route: "read", replay: "read", back: "navigate", live: "navigate", show_company: "navigate",
  zoom: "navigate", face_show: "none", face_core: "none", face_discreet: "none", face_hide: "none", focus: "none", mute: "interrupt",
  pause: "interrupt", stop_worker: "interrupt", freeze_project: "interrupt", unfreeze_project: "effect", stop_all: "interrupt", takeover: "interrupt",
  quiet: "none", notify_normal: "none", briefing: "read", autonomy: "effect", recommendations: "read", help: "read", unknown: "none",
  // M08. "plan" here = a PROPOSAL record (incident PROPUS, lesson PROPUSĂ, ședință, plan peste un obiectiv) — nothing starts.
  // A simulation is a labelled scenario ("read"): it never touches real data.
  incident_open: "plan", twin_changes: "read", twin_impact: "read", twin_why: "read", board_open: "plan", board_next: "navigate",
  board_defer: "plan", simulate: "read", league: "read", teach: "plan", forget: "plan", today: "read", decisions: "read",
  fullscreen: "navigate", cockpit_view: "navigate", details: "navigate", objectives: "read", objective_plan: "plan", start_view: "none",
  // M09 Content Studio. Opening/showing navigates; an edit is a PROPOSED timecode correction (a review row, never applied by a
  // sentence); "publică" is refused (MEDIA_C + a separate confirmation per upload); turning live capture off only reduces activity.
  studio_open: "navigate", studio_show_clip: "navigate", studio_edit: "plan", studio_publish: "none", capture_off: "interrupt",
  // M10 Desktop Operator + zero-form plans. "local" = a LOCAL_DIRECT command (open an authorized app, bring it forward, show an
  // approved folder) run in the owner's session and verified — it never types into a document, clicks, saves or records. Work that
  // types, saves, records or spans apps is a PLAN card (ONE confirmation). "Continuă" resumes a stopped plan within the same limits.
  desktop_open: "local", desktop_focus: "local", desktop_folder: "local", studio_import_here: "plan", studio_variant: "plan", ops_capture_vertical: "plan", ops_continue: "effect",
  // M10: „Pornește Lega” — a check that writes nothing; the page that sent it starts the voice (browser SDP + the owner cookie).
  // "effect": a provider transcript never triggers it.
  lega_start: "effect",
  // M10.2. A new piece of work (a clip, a mission start, a paused mission's resume) is ONE plan card — the sentence proposes, the
  // owner's one confirmation decides. "Ce s-a executat / ultima livrare / ce urmează" only read. "Deschide-l din nou" repeats the last
  // target the SERVER recorded: an app is a local action (the stricter class, kept here), a project or a clip only navigates (lowered
  // when resolved). Executing a downloaded file or an installer is refused from a sentence.
  studio_create: "plan", start_mission: "plan", resume_mission: "plan", last_run: "read", last_delivery: "read", next_step: "read",
  reopen_last: "local", refuse_execute: "none",
  // M10.2 integration: a code change ("repară testul X", "implementează Y") becomes ONE engineering plan (factory draft + envelope);
  // a reading/analysis ("analizează…", "rezumă…") becomes ONE run plan (one bounded read-only model step). Both only propose.
  engineering_request: "plan", analysis_request: "plan",
  // M10.2.1 (D14): „Redeschide poarta” / „Rearmează Hub-ul” only shows the rearm card in the cockpit (navigation); reopening the gate
  // is its own owner-session command (fresh authenticator, bound to the exact suspension), never a sentence.
  gate_rearm: "navigate",
  // 2.12.2 (P0-R2): words that only TALK about an interruption (a question, a negation, a condition, reported speech, a quotation) — a
  // read the Hub answers with the matching sentence; nothing is stopped, paused or taken over.
  explain_stop: "read",
  // 2.12.2 (P0-R6, L11): a request to change the Hub's mode by voice or text — answered (modeAnswer), never done: nothing is written.
  explain_mode: "none",
});

/** The apps the operator knows by name (normalized words → catalog id). Anything else is not a desktop target. */
const DESKTOP_APP_WORDS = "capcut|cap cut|obs studio|obs|notepad|blocnotes|block notes|explorer-ul|explorerul|explorer|file explorer|exploratorul de fisiere|exploratorul";
export function desktopAppId(word) {
  const w = String(word || "").trim();
  if (/^cap ?cut$/.test(w)) return "capcut";
  if (/^obs( studio)?$/.test(w)) return "obs";
  if (/^(notepad|blocnotes|block notes)$/.test(w)) return "notepad";
  if (/explor/.test(w)) return "explorer";
  return null;
}

/** Romanian number words (no diacritics, as normalized) → numbers, for "încă cinci clienți". */
const NUMBER_WORDS = { un: 1, unu: 1, una: 1, o: 1, doi: 2, doua: 2, trei: 3, patru: 4, cinci: 5, sase: 6, sapte: 7, opt: 8, noua: 9, zece: 10,
  unsprezece: 11, doisprezece: 12, douasprezece: 12, cincisprezece: 15, douazeci: 20, treizeci: 30 };
export function numberOf(word) {
  const w = String(word || "").trim();
  if (/^\d{1,4}$/.test(w)) return Number(w);
  return NUMBER_WORDS[w] ?? null;
}
/** Words that make a scenario a DECREASE (checked on the whole sentence, any clause; review M08 rounds 1–2). */
const SCENARIO_DECREASE = /\b(pierdem|pierde|pierd|pierdut|renunta|renunt|renuntam|renunti|pleaca|pleci|plecam|amanam|amana|amanat|anulam|anuleaza|oprim|suspendam|suspenda|inchidem|se retrage|retrage|scadem|scade|reducem|reduce|concediu|in loc de|mai putin|mai putine|mai putini|fara (un|o|doi|doua|trei|\d+)? ?(client|clienti|proiect|proiecte|ore|ora|om|oameni))\b/;

/** What a "ce se întâmplă dacă…" sentence fixes; everything else comes from the observed data or stays a question. */
function simulationArgs(clause) {
  const args = {};
  // Fewer clients, fewer hours, a postponed project: the model only adds projects and takes absolute capacity, so a decrease is
  // never guessed into numbers (review M08: "pierdem doi clienți" became two NEW projects). The owner enters it on the screen.
  if (SCENARIO_DECREASE.test(clause)) {
    args.unsupported = true;
    return args;
  }
  // New projects only after an adding word ("luăm / primim / încă / alți / noi").
  const p = clause.match(/\b(?:inca|mai|alti|alte|luam|primim|adaugam|semnam)\s+(?:inca\s+)?(?<n>\d{1,4}|[a-z]+) (?:clienti|client|proiecte|proiect|comenzi)\b/)
    || clause.match(/\b(?<n>\d{1,4}|[a-z]+) (?:clienti|client|proiecte|proiect|comenzi) noi\b/);
  if (p && numberOf(p.groups.n) != null) args.newProjects = numberOf(p.groups.n);
  // The first horizon that carries a number ("cu 30 de ore pe săptămână în 4 săptămâni" → 4 weeks, not "pe săptămână").
  for (const h of clause.matchAll(/\b(?<n>\d{1,3}|[a-z]+) (?<u>saptamani|saptamana|luni|luna)\b/g)) {
    if (numberOf(h.groups.n) != null && numberOf(h.groups.n) > 0) { args.horizonWeeks = /^lun/.test(h.groups.u) ? Math.round(numberOf(h.groups.n) * 4.33) : numberOf(h.groups.n); break; }
  }
  const c = clause.match(/\b(?<n>\d{1,3}) (?:de )?ore (?:pe|pe o|pe fiecare) saptamana\b/);
  if (c) args.capacityHoursPerWeek = Number(c.groups.n);
  return args;
}

/** "Ține minte…", "De acum înainte…", "Învață…": the prefix is removed from the ORIGINAL words (diacritics kept for the lesson). */
const TEACH_PREFIX = /^(tine minte|retine|invata|noteaza-ti|noteaza|de acum inainte|de acum|de-acum inainte|regula noua)\b[ ,:-]*(ca )?/;
const TEACH_PROCEDURE = /^(la|cand|inainte de|dupa|dupa ce) (livrarea|predarea|lansarea|publicarea|fiecare|orice|un|o|terminarea|finalizarea) .{3,160}\b(verifica|ruleaza|testeaza|fa|cere|trimite|nu (face|trimite|publica|porni))\b/;
const FORGET = /^(uita|sterge|renunta la|anuleaza) (regula|lectia|procedura|ce ti-am spus|ce ti am spus)\b ?(?<ref>.*)$/;
function stripRawPrefix(raw) {
  return String(raw).replace(/^\s*(?:(?:hei|hey|bun[ăa])\s+)?lega[\s,!.:-]+/i, "")
    .replace(/^\s*(?:[țţt]ine minte|re[țţt]ine|[îi]nva[țţt][ăa]|noteaz[ăa](?:-[țţt]i)?|de(?:\s|-)acum(?:\s+[îi]nainte)?|regul[ăa] nou[ăa])(?=[\s,:-]|$)[\s,:-]*(?:c[ăa]\s+)?/i, "").trim();
}

const STRIP = new Map(Object.entries({ "ă": "a", "â": "a", "î": "i", "ș": "s", "ş": "s", "ț": "t", "ţ": "t", "Ă": "a", "Â": "a", "Î": "i", "Ș": "s", "Ş": "s", "Ț": "t", "Ţ": "t" }));
/** Lower case, no diacritics, punctuation → spaces (quotes kept as markers so quoted words can be excluded). */
export function normalize(text) {
  return String(text || "").replace(/[ăâîșşțţĂÂÎȘŞȚŢ]/g, (c) => STRIP.get(c) || c).toLowerCase()
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[„“”«»"]/g, " \u0001 ").replace(/[^a-z0-9\u0001;.!?,\s-]/g, " ").replace(/\s+/g, " ").trim();
}

/** A name reduced to its letters and digits („Pro-Delivery” = „ProDelivery” = „pro delivery”), for exact name comparisons. */
const flatName = (v) => normalize(v).replace(/[^a-z0-9]/g, "");

/** Removes quoted passages (a "confirm" quoted from a document or a page is not the owner's consent). */
function unquote(norm) {
  const parts = norm.split("\u0001");
  return parts.filter((_, i) => i % 2 === 0).join(" ").replace(/\s+/g, " ").trim();
}

/**
 * M10.2 polite words and fillers, removed before matching (on normalized text). The owner says "Te rog, oprește tot" or "Poți să
 * deschizi Notepad?" as often as the bare command. Kept on purpose: "poți să mă anunți" (a notification preference), "vreau să
 * văd / să vorbesc" (their own patterns), "hai" (part of "hai la …"), "acum" ("nu acum" is an answer) and "mulțumesc" ("nu,
 * mulțumesc" rejects a plan). Removing a filler never adds an effect: the remaining words must still match an anchored pattern.
 */
const LEAD_FILLER = /^(?:(?:te rog sa|va rog sa|te rog frumos|te rog|va rog|poti sa(?![\s,]+ma\b)|ai putea sa|puteti sa|ati putea sa|as vrea sa|as dori sa|vreau sa(?![\s,]+(?:vad|vorbesc|stiu)\b)|deci|asa|bine)[\s,]+)+/;
const TRAIL_FILLER = /[\s,]+(?:te rog(?: frumos)?|va rog)$/;
export function stripFillers(norm) {
  let s = String(norm || "").trim();
  for (let i = 0; i < 3; i++) {
    const next = s.replace(LEAD_FILLER, "").replace(TRAIL_FILLER, "").replace(/^[\s,]+|[\s,]+$/g, "").trim();
    if (next === s) break;
    s = next;
  }
  return s;
}

/** A conjugated first verb → the imperative the patterns know ("poți să deschizi" → "deschide"); only the FIRST word is mapped. */
const VERB_FORMS = Object.freeze({
  deschizi: "deschide", deschideti: "deschide", pornesti: "porneste", porniti: "porneste", incepi: "incepe", lansezi: "lanseaza", rulezi: "ruleaza",
  arati: "arata", aratati: "arata", continui: "continua", continuati: "continua", reiei: "reia", faci: "fa", faceti: "fa", creezi: "creeaza",
  generezi: "genereaza", pregatesti: "pregateste", opresti: "opreste", pui: "pune", executi: "executa", confirmi: "confirma", importi: "importa",
  muti: "muta", duci: "du", lucrez: "lucram", lucrezi: "lucram", treceti: "treci", aduci: "adu", inregistrezi: "inregistreaza",
  // Review M10.2 #22: refuse_execute now reads "instalează" only as the FIRST verb, so the polite form must reach that verb too.
  instalezi: "instaleaza",
  // M10.2.1: the polite forms of the rearm request („Poți să redeschizi poarta?”) reach the gate_rearm pattern.
  redeschizi: "redeschide", redeschideti: "redeschide", rearmezi: "rearmeaza", rearmati: "rearmeaza", reactivezi: "reactiveaza", deblochezi: "deblocheaza",
  repornesti: "reporneste", reporniti: "reporneste",
  // 2.12.1 round 2: „Vreau să redeschid poarta” (the filler leaves the first person) reaches the same pattern.
  redeschid: "redeschide", rearmez: "rearmeaza",
});
/** Verbs that "mai" / "iar" may precede as "again" ("Mai deschide-l o dată"); elsewhere "mai" keeps its meaning (mai sus, mai târziu). */
const AGAIN_VERBS = "deschide|porneste|arata|fa|lanseaza|ruleaza|adu|pune|reia|continua|da-mi|fa-mi|incearca|redeschide";

/**
 * 2.12.3 (D2): a leading acknowledgement („Ok, fă acel videoclip de promovare”, „Hai, repară bug-ul de login”, „Ok, Lega, …”) in front
 * of a request whose rule is anchored on its verb. It is dropped per clause and only when what follows IS one of these requests
 * (ACK_REQUESTS), so „ack + X” resolves exactly like X; every other clause keeps its words. It is not a global filler: the confirmation
 * grammar needs it in front of verbs that do not stand alone („Ok, fă-l”, „Ok, execută”), „hai” leads „hai la …”, and stripFillers is
 * shared with the voice stop parser (domain/voice.mjs). „da” and „sigur” are consent words and are never dropped here.
 */
const ACK_LEAD = /^(?:(?:ok|okay|hai|haide|bine)(?:[\s,!.:;]+|$)|(?:(?:hei|hey|buna) )?lega(?:[\s,!.:;]+|$))+/;
/** A clause that is only an acknowledgement („Ok.” written by a transcript as its own sentence). */
const ACK_ONLY = /^(?:(?:ok|okay|hai|haide|bine|(?:(?:hei|hey|buna) )?lega)(?:[\s,!.:;]+|$))+$/;
const ACK_REQUESTS = new Set(["studio_create", "engineering_request", "analysis_request", "start_mission", "resume_mission", "explain_mode"]);

/**
 * One clause → { text, again, refIt }: fillers removed, "din nou / încă o dată / o dată" and a leading "mai / iar" before a verb
 * recorded as `again`, the first verb in the imperative, `refIt` when that verb carries a pronoun object ("deschide-l",
 * "pornește-o", "arată-mi-l") — the object is then the last target, which only the server may supply.
 * D2: a leading acknowledgement is dropped only when the rest is one of the anchored requests (ACK_REQUESTS); otherwise the result is
 * exactly the one without that rule.
 */
export function prepClause(clause) {
  const base = prepCore(clause);
  const lead = stripFillers(clause);
  const rest = lead.replace(ACK_LEAD, "");
  if (rest && rest !== lead) {
    const alt = prepCore(rest);
    const m = alt.text ? matchPattern(alt.text) : null;
    if (m && ACK_REQUESTS.has(m.intent)) return alt;
    // 2.12.3 (D2 review): a conditional request („Ok, citește fișierul doar dacă trec testele”) — a broader rule (show_tests) can match the
    // whole clause first, while the request itself is the condition's head: the head decides, so „ack + X” still resolves exactly like X.
    const held = alt.text ? conditionOf(alt.text)?.heldIntent : null;
    if (held && ACK_REQUESTS.has(held)) return alt;
  }
  return base;
}

function prepCore(clause) {
  let text = stripFillers(clause);
  const before = text;
  text = text.replace(/\b(?:din nou|inca o data|inca odata|inca o oara)\b/g, " ").replace(/\s+o data$/, " ")
    .replace(new RegExp(String.raw`^(?:mai|iar) (?=(?:${AGAIN_VERBS})\b)`), "").replace(/\s+/g, " ").replace(/^[\s,]+|[\s,]+$/g, "").trim();
  const again = text !== before.replace(/\s+/g, " ").trim();
  const m = text.match(/^([a-z]+)((?:-[a-z]+)*)(.*)$/s);
  let refIt = false;
  if (m) {
    const verb = VERB_FORMS[m[1]] || m[1];
    // "deschizi-l" → "deschide-l"; the clitic stays (several patterns read "muta-l", "fa-l", "publica-l" as written).
    text = verb + m[2] + m[3];
    refIt = /-(?:l|o|le)$/.test(m[2]);
  }
  return { text, again, refIt };
}

const STOP_WORDS = new Set(["la", "pe", "cu", "de", "si", "in", "din", "pentru", "proiectul", "proiect", "misiunea", "problema", "lucram", "hai", "sa", "ne", "mai", "un", "o", "al", "ale", "a"]);
/**
 * Missions get their own stop list: the project words do not apply, and the words people use to DESCRIBE a mission's state ("pe
 * care am pus-o pe pauză", "oprită", "de ieri") are not part of its title. "misiunea" stays a stop word on both sides (title and
 * reference), so "misiunea videoclip" still covers a title "Videoclip …" fully.
 */
const MISSION_STOP_WORDS = new Set([...STOP_WORDS].filter((w) => !["proiectul", "proiect", "lucram"].includes(w))
  .concat(["care", "am", "ai", "pus", "pus-o", "pusa", "pauza", "oprita", "oprit", "oprit-o", "intrerupta", "intrerupt-o", "blocata", "suspendata", "asta", "aceasta", "acea", "ultima", "ieri", "azi", "acum"]));
const stem = (w) => w.replace(/(urilor|urile|elor|ilor|ului|ele|ile|uri|lor|ul|le|ii|ei|ea|a|e|i)$/, "") || w;
const tokens = (s, stop = STOP_WORDS) => normalize(s).replace(/\u0001/g, " ").split(/[\s.,;!?-]+/).filter((w) => w && !stop.has(w));
const isHubTest = (x) => x?.source === "hub-test";

/**
 * Every candidate with its score (desc). Scoring (M10.2): an exact name/slug is 100; otherwise token coverage (hits over the longer
 * of the two token lists, +10 and a floor of 72 when every word of the reference is covered); a compact substring ("delivery" in
 * "ProDelivery") is only a FALLBACK (70) for a candidate that does not cover every word — a full-coverage candidate is never
 * outranked by a mere substring of another name ("Ifrim Hub" once picked "Ifrim Hub Test" silently, its compact form containing
 * "ifrimhub" while "Ifrim Agent Hub" only covered the words). A test project (`source: "hub-test"`) loses 10
 * points when a real project also matches, so the real one is listed first; it stays within the question window.
 */
export function rankRef(ref, items, { name = (x) => x.name, extra = () => [], stop = STOP_WORDS, isTest = isHubTest } = {}) {
  const refWords = tokens(ref, stop).map(stem);
  const want = refWords.filter((w) => w.length >= 2);
  if (!want.length) return [];
  const refCompact = want.join("");
  // M10.2.1 (D21): the one-character parts the word list leaves out ("2" of "M10.2", "b" of "Demo B") and the whole reference, letters
  // and digits only ("factorydemom102"). With such a part, "Factory Demo M10" covered every remaining word and was an EXACT match for
  // „Factory Demo M10.2” (the project with the dot then tied or lost): a reference with a dropped part is exact only as a whole, and
  // its dropped parts count in the coverage.
  const small = refWords.filter((w) => w.length < 2);
  const refFlat = normalize(ref).replace(/[^a-z0-9]/g, "");
  const scored = (items || []).map((item) => {
    const names = [name(item), ...extra(item)].filter(Boolean);
    let best = 0;
    for (const n of names) {
      const nn = normalize(n).replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
      const words = tokens(n, stop).map(stem);
      const compact = nn.replace(/ /g, "");
      const exact = (refFlat.length >= 3 && compact === refFlat) || (!small.length && (compact === refCompact || nn === want.join(" ") || words.join("") === refCompact));
      if (compact && exact) { best = Math.max(best, 100); continue; }
      const hits = want.filter((w) => words.some((x) => x === w || (w.length >= 4 && (x.startsWith(w) || w.startsWith(x))))).length + small.filter((w) => words.includes(w)).length;
      const full = hits === want.length + small.length;
      // Every word of the reference covered: at least 72 (a short reference to a long title, "videoclip" → "Videoclip de promovare
      // Ifrim Digital — 30 s", must not fall under the substring fallback of another name).
      if (hits) best = Math.max(best, Math.round((hits / Math.max(want.length + small.length, words.length)) * 80) + (full ? 10 : 0), full ? 72 : 0);
      const sub = small.length ? refFlat : refCompact;
      if (!full && sub.length >= 5 && compact.includes(sub)) best = Math.max(best, 70);
    }
    return { item, score: best };
  }).filter((x) => x.score >= 30);
  if (scored.some((x) => !isTest(x.item)) && scored.some((x) => isTest(x.item))) for (const x of scored) if (isTest(x.item) && x.score < 100) x.score = Math.max(30, x.score - 10);
  // Ties keep a real project before a test one, then the caller's order.
  return scored.map((x, i) => ({ ...x, i })).sort((a, b) => b.score - a.score || Number(isTest(a.item)) - Number(isTest(b.item)) || a.i - b.i).map(({ item, score }) => ({ item, score }));
}

/**
 * Best matches of a free reference among named items (projects, missions, clips, objectives). An exact name wins alone; otherwise
 * every candidate within 15 points of the best is returned, so two plausible names produce ONE question instead of a silent pick.
 */
export function matchRef(ref, items, opts = {}) {
  const scored = rankRef(ref, items, opts);
  if (!scored.length) return [];
  const top = scored[0].score;
  return scored.filter((x) => (top === 100 ? x.score === 100 : x.score >= top - 15)).map((x) => x.item);
}

/**
 * M10.2.1 (D14): asking to reopen the gate after a Stop All only SHOWS the rearm card. Anchored on the whole clause and BEFORE stop_all,
 * whose unanchored "stop all" would otherwise read „Pornește din nou după Stop All” as a second Stop All. „Deschide / pornește” count only
 * with „poarta” („Deschide Hub-ul” stays the Hub's project, „Repornește Hub-ul” is a restart, not a rearm). „din nou” is optional: the
 * clause preparation removes it before matching.
 * 2.12.1 round 2 (PF-01, PF-05): every form takes the „după Stop All” the Hub's own texts use („Am redeschis poarta după Stop All”):
 * „Redeschide poarta (de execuție) după Stop All”, „Rearmează Hub-ul după Stop All”, „Continuă / Reia lucrul după Stop All” and the
 * leading „După Stop All, redeschide poarta”. Nothing here resumes anything: the card is shown, the owner decides on it (D22: work the
 * Stop All paused resumes only after the rearm).
 * 2.12.2 review R2-F7: „după ce am / ai oprit tot” names the same suspension („Redeschide poarta după ce ai oprit tot” shows the card; it
 * was read as a conditional stop).
 */
const STOP_NAME = String.raw`(?:stop[ -]?all(?:-ul|ul)?|oprirea totala|oprirea de urgenta|oprirea generala|opreste tot|ce (?:am|ai|ati|a|au) oprit (?:tot|totul|toate))`;
const GATE_REARM = new RegExp([
  String.raw`^(?:redeschide|deschide|rearmeaza|reactiveaza|deblocheaza|reporneste|porneste)(?: din nou| iar)? (?:poarta|poarta de executie)(?: dupa ${STOP_NAME})?$`,
  String.raw`^rearmeaza(?: (?:hub-ul|hubul|hub|poarta|tot|totul|sistemul|executia))?(?: dupa ${STOP_NAME})?$`,
  String.raw`^(?:porneste|reporneste|pornim|reia|reiau|reluam|redeschide|continua|continuam|reactiveaza|deblocheaza)(?: din nou| iar)?(?: (?:totul|tot|lucrul|munca|executia|hub-ul|hubul|planul|planurile|misiunea|misiunile))? dupa ${STOP_NAME}$`,
  String.raw`^dupa ${STOP_NAME}[\s,]+(?:redeschide|deschide|rearmeaza|reactiveaza|deblocheaza|reporneste|porneste|pornim|reia|reluam|continua|continuam)(?: din nou| iar)?(?: (?:poarta|poarta de executie|hub-ul|hubul|hub|totul|tot|lucrul|munca|executia|planul|planurile|misiunea|misiunile))?$`,
].join("|"));
/**
 * PF-01 defence in depth: a reopen or resume verb (any form, the clause preparation maps only the first word). A „Stop All” / „oprește tot”
 * right after „după” in a clause that also holds one of these names the suspension being talked about („Redeschide, te rog, poarta după
 * Stop All”), never a second Stop All — even when GATE_REARM does not read the whole clause. Without such a verb the words keep their
 * meaning („Stop all”, „Oprește tot”).
 */
const REOPEN_VERB = String.raw`(?:re)?deschi(?:de|deti|zi|d)|rearm[a-z]*|reactiv[a-z]*|debloc[a-z]*|(?:re)?porn[a-z]*|reia[a-z]*|relu[a-z]*|continu[a-z]*`;
const NOT_NAMED_AFTER_REOPEN = String.raw`(?<!\b(?:${REOPEN_VERB})\b.*\bdupa )(?!(?<=\bdupa ).*\b(?:${REOPEN_VERB})\b)`;
/** The same PF-01 case, as a test on the whole clause: a reopen or resume verb with the Stop All named right after „după”. */
const NAMED_AFTER_REOPEN = new RegExp(String.raw`\b(?:${REOPEN_VERB})\b.*\bdupa ${STOP_NAME}|\bdupa ${STOP_NAME}.*\b(?:${REOPEN_VERB})\b`);

// ---------------------------------------------------------------- 2.12.2 (P0-R2): an interruption runs only on a clear imperative
/**
 * The owner's requirement: „Oprește tot” stops only when it IS the command. A clause runs an interruption when, after an optional address
 * („Lega,”), polite words and interjections („te rog”, „vă rog”, „acum”, „imediat”, „ok”, „gata”, „stai”), one of its comma-separated
 * parts STARTS with the command — „Oprește / Opriți tot (totul, toate)”, „Stop all”, „Stop, oprește tot”, „Pune totul pe pauză”,
 * „Pauză”, … — no condition follows it and no condition, report or question leads into it. Anything else that names it only TALKS about
 * it and never runs it:
 *  - a question: a „?” in the clause, an interrogative opener (ce, cum, când, unde, de ce, oare, explică-mi …) or a modal one. „Poți să
 *    oprești tot?” is often a polite request in Romanian, but a stop must be unambiguous: the answer asks for the command itself
 *    („Spune „Oprește tot” și opresc imediat.”), which costs one sentence;
 *  - a negation before the verb („Nu opri tot”, „Nu, nu opri nimic”, „Să nu oprești tot”);
 *  - a condition („Dacă pică testele, oprește tot”, „Oprește tot după ce termini testul”): the Hub never schedules a stop;
 *  - reported or historical speech („Ieri am spus oprește tot”, „Când am spus Oprește tot?”, „Am zis oprește tot din greșeală”);
 *  - a quotation („„Oprește tot””: removed with the other quoted words, then answered);
 *  - a mention that starts no part of the clause („Butonul oprește tot”): another intent of the clause may take it, never the stop.
 * Such a clause becomes explain_stop { mood, about } — a read the intake answers (stopTalkAnswer). Pure and synchronous: a real command
 * costs a few regular expressions more, nothing awaits, and the stop itself is dispatched exactly as before.
 *
 * Review round (2.12.2, R2-F1…F5) — when unsure, the rule fails toward the stop (Stop All only reduces activity):
 *  - F1: a condition holds the command only when it DIRECTLY follows it („Oprește tot dacă pică testele”); „până când”, „chiar dacă”,
 *    „indiferent dacă”, „dacă tot”, a polite „când poți” / „imediat ce poți”, a past event („…, după ce am văzut logurile nu mai am
 *    încredere”) and a later clause with its own verb („…, a dat eroare când a rulat testele”) never hold it;
 *  - F2: a „?” belongs to the chained clause it closes („Oprește tot și arată-mi ce s-a executat?” stops, then answers);
 *  - F3: a command that starts the sentence followed by a tag or a question of its own („Oprește tot, da?”, „Oprește tot, ce faci?”),
 *    an exclamation leading into it („Ce naiba faci, oprește tot!”) and a bare repeated lead-in („Ți-am zis, oprește tot!”, „Am zis
 *    oprește tot!”) are the command. Decided by the review in the safe direction; the owner's confirmation is pending (the only
 *    decision the owner made is „Poți să oprești tot?” → ask). An indicative „Oprești tot, da?” still asks;
 *  - F4: a leading interjection without its comma (provider transcripts: „Te rog mult oprește tot”, „Băi oprește tot”) still stops; the
 *    command after other words stays a mention only behind a subject or a frame („Butonul oprește tot”, „La secunda 5 oprește tot sunetul”);
 *  - F5: the command's NAME used in a statement („Stop All-ul nu merge”, „Oprește tot n-a eliberat lease-urile”, „Stop All e în bara de
 *    sus”, „Pauza de masă e la 12”) is a mention or a report, never the stop or the pause.
 */
// Review F1 (2.12.2): a leading contrast word („dar”, „însă”, „ci”) is dropped like an interjection, so „…, dar oprește tot” has a part
// that STARTS with the command (interruptMood splits a part before it as well).
const SOFT_LEAD = /^(?:(?:(?:hei|hey|buna|alo|bai|mai) )?lega|dar|insa|ci|te rog(?: frumos| mult)?|va rog(?: frumos| mult)?|please|okay|ok|bine|bun|da|haide|hai(?: repede)?|gata|destul|stai|alo|hei|hey|bai|deci|asa|uite|lasa|asculta|auzi|doamne|mult|si acum|chiar acum|acum|imediat ce poti|imediat ce puteti|imediat(?! ce\b)|repede|urgent|mai bine|cand poti|cand puteti|cat poti de repede|cat mai repede)(?:[\s,!.:;]+|$)/;
const SOFT_TAIL = /(?:^|[\s,!.:;-]+)(?:te rog(?: frumos| mult)?|va rog(?: frumos| mult)?|please|acum|imediat|right now|now|repede|urgent|lega|cat mai repede|cat poti de repede|daca se poate|daca poti|daca puteti|daca vrei|daca nu te superi|cand poti|cand puteti|imediat ce poti|imediat ce puteti)$/;
/** A clause without its address, polite words and interjections at either end (what is left must start with the command). */
function softTrim(text) {
  let s = String(text || "").replace(/\s+/g, " ").trim();
  for (let i = 0; i < 8; i++) {
    const next = s.replace(SOFT_LEAD, "").replace(SOFT_TAIL, "").replace(/^[\s,!.:;-]+|[\s,!.:;-]+$/g, "").trim();
    if (next === s) break;
    s = next;
  }
  return s;
}
const STOP_OBJECT = String.raw`(?: (?:acum|imediat|absolut|chiar|repede))? (?:tot|totul|toate)\b`;
/**
 * Stop All said as the command at the start of a part („oprește tot”, „opriți totul”, „stop, oprește tot”, „oprește imediat tot”, „stop
 * all”). R2-F5: never its name with the article („Stop All-ul …” is the button or the command spoken about).
 */
const STOP_START = new RegExp(String.raw`^(?:(?:stop|opreste|opriti)[\s,!]+)*(?:(?:opreste|opriti|stop)${STOP_OBJECT}|stop[ -]?all\b(?!-?ul\b))`);
/** The same command anywhere in the clause („Dacă pică testele oprește tot”, said without the comma). */
const STOP_COMMAND = new RegExp(String.raw`\b(?:(?:opreste|opriti|stop)${STOP_OBJECT}|stop[ -]?all\b(?!-?ul\b))`);
/** Any talk of stopping everything: the command, a conjugated or negated form („nu opri nimic”, „să opresc tot”), its name. */
const STOP_MENTION = new RegExp(String.raw`\b(?:(?:opreste|opriti|opri|opresti|opresc|oprim|opreasca|stop)(?: (?:acum|imediat|absolut|chiar|repede))? (?:tot|totul|toate|nimic)\b|(?:am|ai|a|ati|au) oprit (?:tot|totul|toate)\b|stop[ -]?all(?:-?ul)?\b|oprirea (?:totala|de urgenta|generala)\b)`);
const MODAL = String.raw`(?:poti|puteti|pot|putem|ai putea|ati putea|as putea|am putea|ar trebui|se poate|vrei|vreti|ai vrea|ati vrea|oare)`;
const MODAL_ASK = new RegExp(String.raw`^${MODAL}\b`);
/** A question whose words are the command itself („Oprești tot?”, „Poți să oprești tot?”, „Să opresc tot?”): the hint, not the explanation. */
const STOP_ASK = new RegExp(String.raw`^(?:${MODAL}(?: sa)? )?(?:sa )?(?:opreste|opriti|opri|opresti|opresc|oprim|opreasca|stop)(?: (?:acum|imediat|absolut|chiar|repede))? (?:tot|totul|toate)\b|^stop[ -]?all\b`);
const STOP_COND_WORDS = String.raw`(?:daca|cand|in caz ca|in cazul in care|dupa ce|doar daca|numai daca|imediat ce|de indata ce|indata ce|odata ce)`;
const COND_ANY = new RegExp(String.raw`\b${STOP_COND_WORDS}\b`);
const COND_START = new RegExp(String.raw`^${STOP_COND_WORDS}\b`);
const REPORTED = /\b(?:(?:am|ai|a|ati|au|ti-am|v-am|i-am|mi-ai|mi-a)(?: mai)? (?:spus|zis|cerut|apasat|dat|strigat)|ziceam|spuneam|ziceai|spuneai|zicea|spunea|cand am|cand ai|data trecuta|ultima data|ultima oara|alaltaieri|ieri|aseara|mai devreme|adineauri|azi dimineata|de dimineata)\b/;
const ASK_START = /^(?:ce|cum|cand|unde|de ce|oare|cine|care|cat|cata|cati|cate|explica(?:-mi)?|spune-mi|zi-mi|descrie|lamureste-ma|vreau sa stiu|as vrea sa stiu|ma intreb|intreb|stii|stiti)\b/;
/** Exclamations that may lead into the command („Ce naiba, oprește tot!”): not a question about it. */
const EXCLAMATION = /^(?:ce naiba|ce dracu(?:lui)?|ce faci|ce se intampla|ce-i asta|ce e asta|cum adica)$/;
/** R2-F3: the same exclamations with words after them („Ce naiba faci, oprește tot!”, „Ce se întâmplă aici, oprește tot!”). */
const EXCLAMATION_LEAD = /^(?:ce naiba|ce dracu(?:lui)?|ce faci|ce se intampla|ce-i asta|ce e asta|cum adica)\b/;
const NEGATION = /\b(?:nu|niciodata)\b|(?:^|[\s,])n-/;
/** R2-F1: words that look like a condition but make the stop unconditional or are not one („până când”, „chiar dacă”, „dacă tot”). */
const NOT_COND = /\b(?:pana (?:cand|ce)|chiar (?:si )?daca|indiferent (?:daca|cand|ce)|daca tot)\b/g;
const hasCond = (s) => COND_ANY.test(String(s || "").replace(NOT_COND, " "));
/** R2-F1: a condition word that directly follows the command (the remainder of its part, softTrimmed). */
const STOP_COND_LEAD = new RegExp(String.raw`^(?:(?:doar|numai) )?${STOP_COND_WORDS}\b`);
/** R2-F1: a temporal word followed by a past tense („după ce am văzut”, „când a rulat”): an event that happened — a reason, not a condition. */
const PAST_EVENT = /^(?:cand|dupa ce|imediat ce|de indata ce|indata ce|odata ce) (?:(?:l|i|le|o|ne|v|te|m)-)?(?:am|ai|a|ati|au)(?: mai)? [a-z]+(?:at|ut|it|st|zut|s|t)\b/;
function trailingCondition(tail) {
  const r = softTrim(String(tail || "").replace(NOT_COND, " "));
  return STOP_COND_LEAD.test(r) && !PAST_EVENT.test(r);
}
const leadingCondition = (part) => hasCond(part) && !PAST_EVENT.test(softTrim(part));
/** R2-F3: what makes reported speech a report: a time word, „din greșeală”, a past habit — a bare „(Ți-)am zis,” repeats the command. */
const REPORTED_CONTEXT = /\b(?:data trecuta|ultima data|ultima oara|alaltaieri|ieri|aseara|mai devreme|adineauri|azi dimineata|de dimineata|saptamana trecuta|atunci|din greseala|ziceam|spuneam|ziceai|spuneai|zicea|spunea)\b/;
const REPEAT_LEAD = /^(?:cum )?(?:(?:ti|v)-)?am (?:mai )?(?:zis|spus)(?: deja)?[\s,!.:;-]+/;
const BARE_REPEAT = /^(?:cum )?(?:(?:ti|v)-)?am (?:mai )?(?:zis|spus)(?: deja)?$/;
/** R2-F3: a tag after the command („…, da?”, „…, ok?”, „…, m-ai auzit?”): the „?” is the tag's. */
const TAG = /^(?:da|ok|okay|bine|nu|clar|gata|auzi|ma auzi|m-ai auzit|ai auzit|intelegi|ai inteles|da sau nu)$/;
/** R2-F3: a later question that asks about the command itself („…, ce înseamnă?”): the whole clause stays a question. */
const ABOUT_IT = /^(?:ce (?:inseamna|face|presupune|e asta|este asta|e aia)|cum functioneaza|ce se intampla (?:dupa|daca|cand|atunci)|ce urmeaza dupa)\b/;
/** R2-F5: the command's name as the subject of a statement („Oprește tot n-a eliberat…”, „Stop All e în bara de sus”). */
const PREDICATE = /^(?:-?ul\b|(?:e|este|era|a fost) (?:in|pe|la|acolo|aici|sus|jos|[a-z]{2,}(?:ul|ului|lor))\b|n-(?:a|au)\b|nu (?:a|au)\b|(?:a|au) (?:mers|functionat|oprit|lasat|blocat|eliberat|picat|reusit)\b)/;
/** R2-F4: a subject or a frame before the command („Butonul…”, „Codex…”, „La secunda 5…”, „…în care Lega…”): a mention, not the command. */
const SUBJECT_OR_FRAME = /\b(?:[a-z]{2,}(?:ul|ului|lor)|codex|claude|lega|asta|aceasta|acesta|aia|ala|el|ea|ei|ele|cine|ce|care|cum|unde|cat|cand|nimeni|fiecare|orice|comanda|functia|fraza|optiunea|tasta|eu|noi|voi|la|pe|in|din|de|cu|despre|pentru|prin|dupa|inainte|fara|ca|sa|daca)\b|-(?:ul|ului|lor|le)\b/;
/** R2-F3: an indicative first verb („Oprești tot, da?”, „Pui totul pe pauză, da?”) asks, whatever follows. */
const CONJUGATED_INTERRUPT = /^(?:opresti|pui|iei)\b/;
/**
 * The interruptions under the rule. `strict`: the command must start a part of the clause (Stop All and the global pause); for the
 * narrower ones (a named worker, a takeover, a project freeze) a mention with no question, negation, condition or report still runs,
 * as before. `start` — the command at the start of a part; `command` — the command anywhere; `verb` — where a negation must stand before.
 */
const INTERRUPT_FORMS = Object.freeze({
  stop_all: { strict: true, start: STOP_START, command: STOP_COMMAND, verb: /\b(?:opreste|opriti|opri|opresti|opresc|oprim|opreasca|oprit|stop)\b/, ask: STOP_ASK },
  // R2-F5: „Pauză” is the command only alone (or with „acum”, „la tot”, „totul”): „Pauza de masă e la 12” names a pause.
  pause: { strict: true, start: /^(?:(?:pauza|pause)(?: (?:acum|imediat|la tot|tot|totul|te rog))?$|pune(?: (?:tot|totul|toate))? pe pauza\b|pune pauza\b|ia o pauza\b)/, command: /\b(?:pune(?: (?:tot|totul|toate))? pe pauza|pune pauza|ia o pauza)\b/,
    verb: /\b(?:pune|pun|pui|puneti|puna|ia|iau|iei|pauza)\b/, ask: new RegExp(String.raw`^(?:${MODAL}(?: sa)? )?(?:sa )?(?:pune|pun|pui|puneti|puna|ia|iau|iei)\b.*\bpauza\b|^pauza\b`) },
  // Review F1: „Oprește doar Codex” / „numai Claude” names the worker too („…, nu opri tot, oprește doar Codex”).
  stop_worker: { strict: false, start: /^opreste (?:(?:doar|numai) )?(?:codex|claude|writerul|writer|reviewerul|reviewer|agentul|workerul)\b/, command: /\bopreste (?:(?:doar|numai) )?(?:codex|claude|writerul|writer|reviewerul|reviewer|agentul|workerul)\b/, verb: /\bopr[a-z]*\b/, ask: null },
  takeover: { strict: false, start: /^(?:preiau eu|preiau (?:controlul|de aici)|las(?:a|ati)[- ]ma pe mine)\b/, command: /\b(?:preiau eu|preiau (?:controlul|de aici)|las(?:a|ati)[- ]ma pe mine)\b/, verb: /\b(?:preiau|preia|las(?:a|ati)?)\b/, ask: null },
  freeze_project: { strict: false, start: /^ingheata\b/, command: /\bingheata\b/, verb: /\bingheat[a-z]*\b/, ask: null },
});
const INTERRUPT_INTENTS = new Set(Object.keys(INTERRUPT_FORMS));
/** What leads into an interruption and makes it talk (a split never separates the two: „Dacă pică testele, oprește tot”). */
function leadsIntoTalk(text) {
  const s = softTrim(text);
  return COND_START.test(s) || REPORTED.test(s) || ((ASK_START.test(s) || MODAL_ASK.test(s)) && !EXCLAMATION.test(s));
}

/**
 * The mood of one clause that names an interruption (normalized text, quotes already removed): "imperative" — run it; otherwise "ask"
 * (a question whose words are the command), "question", "negation", "conditional", "reported" or "mention". `asks`: the clause carried a
 * „?”; `modal`: the sentence opened with a modal question („Poți să…”) the polite-word stripper already removed; `conjugated`: the
 * clause's first verb was indicative („Oprești tot…”) before prepClause turned it into the imperative. Pure.
 */
export function interruptMood(clause, { asks = false, modal = false, intent = "stop_all", conjugated = false } = {}) {
  const form = INTERRUPT_FORMS[intent] || INTERRUPT_FORMS.stop_all;
  let s = softTrim(clause);
  if (!s) return "mention";
  // R2-F3: a bare lead-in that repeats the command („Ți-am zis, oprește tot!”, „Am zis oprește tot!”) — never with a time word,
  // „din greșeală” or a past habit („Ieri am zis…”, „Am zis oprește tot din greșeală” stay reports).
  if (REPEAT_LEAD.test(s) && !REPORTED_CONTEXT.test(s)) {
    const rest = softTrim(s.replace(REPEAT_LEAD, ""));
    if (rest && form.start.test(rest)) s = rest;
  }
  // Review F1: a contrast word also opens a part („Nu mai deschide ProDelivery dar oprește tot”); the word stays at the start of its raw
  // part and softTrim drops it, so the command after it is judged by commandMood (a condition, report or question leading in still holds it).
  const PART = /\s*[,;:]\s*|\s+-\s+|\s+(?=(?:dar|insa|ci)\s)/;
  const raw = s.split(PART).map((p) => p.trim()).filter(Boolean);
  // Each part as said (`raw`: a leading „imediat ce …” keeps its condition) and without its polite words (`soft`); empty ones dropped.
  const kept = raw.map((r) => ({ raw: r, soft: softTrim(r) })).filter((x) => x.soft);
  const parts = kept.map((x) => x.soft);
  const at = parts.findIndex((p) => form.start.test(p));
  const before = at > 0 ? kept.slice(0, at) : [];
  if (asks || modal || MODAL_ASK.test(s)) {
    if (at < 0 && REPORTED.test(s)) return "reported";
    // R2-F3: the command starts the sentence (no modal opener, an imperative verb) and the „?” can only be a later part's — a tag
    // („…, da?”, „…, ok?”) or a question of its own („…, ce faci?”): the command, judged like one without a „?”. A later question about
    // the command itself („…, ce înseamnă?”) keeps the clause a question.
    if (at === 0 && asks && !modal && !conjugated && !MODAL_ASK.test(s)) {
      const later = raw.slice(raw.findIndex((p) => form.start.test(softTrim(p))) + 1).map((p) => p.replace(/[!.?]+$/g, "").trim()).filter(Boolean);
      const tagOrOwnQuestion = (p) => TAG.test(p) || ASK_START.test(softTrim(p)) || EXCLAMATION_LEAD.test(p);
      if (later.length && later.some(tagOrOwnQuestion) && !later.some((p) => ABOUT_IT.test(softTrim(p)) || STOP_MENTION.test(p))) return commandMood(form, parts, at, before);
    }
    return at >= 0 || (form.ask || form.start).test(s) ? "ask" : "question";
  }
  if (at >= 0) return commandMood(form, parts, at, before);
  // Review F1: a negation counts only inside the verb's own part („Nu, nu opri tot” → „nu opri tot”): a „nu” of another request („Nu mai
  // deschide ProDelivery, …”) or a bare „Nu,” before the words never turns them into a negated stop.
  const vPart = (intent === "stop_all" ? parts.find((p) => STOP_MENTION.test(p)) : null) ?? parts.find((p) => form.verb.test(p)) ?? s;
  const v = vPart.search(form.verb);
  if (NEGATION.test(v >= 0 ? vPart.slice(0, v) : vPart)) return "negation";
  if (REPORTED.test(s)) return "reported";
  if (COND_START.test(s) && form.command.test(s)) return "conditional";
  if (ASK_START.test(s) || MODAL_ASK.test(s) || COND_START.test(s)) return "question";
  if (hasCond(s)) return "conditional";
  // R2-F4: the command after words that are no subject and no frame (an interjection a transcript wrote without its comma: „Bre oprește
  // tot”), with nothing or „ce …” after it, is the command; „Butonul oprește tot”, „La secunda 5 oprește tot sunetul” stay mentions.
  if (intent === "stop_all") {
    const m = s.match(STOP_COMMAND);
    if (m) {
      const lead = softTrim(s.slice(0, m.index));
      const tail = softTrim(s.slice(m.index + m[0].length));
      if (lead && !SUBJECT_OR_FRAME.test(lead) && (!tail || /^ce\b/.test(tail)) && !PREDICATE.test(tail)) return "imperative";
    }
  }
  return "mention";
}

/**
 * The verdict for a clause one of whose parts STARTS with the command (part `at`). R2-F5: the command's name followed by a predicate
 * („… n-a eliberat …”, „… e în bara de sus”) is a report or a mention. R2-F1: a condition holds it only when it directly follows the
 * command (the rest of its part, or the next part) or leads into it — never „până când”, „chiar dacă”, a past event or a later clause
 * with its own verb. A report or a question leading into it holds it too, except a bare repeated „(Ți-)am zis,” and an exclamation
 * („Ce naiba faci, …”). A plain „Nu, oprește tot” stays the command.
 */
function commandMood(form, parts, at, before) {
  const cmd = parts[at];
  const m = cmd.match(form.start);
  const restSame = softTrim(m ? cmd.slice(m.index + m[0].length) : "");
  if (restSame && PREDICATE.test(restSame)) return REPORTED_CONTEXT.test(restSame) ? "reported" : "mention";
  if (trailingCondition(restSame || parts[at + 1] || "")) return "conditional";
  if (before.some((x) => leadingCondition(x.raw))) return "conditional";
  if (before.some((x) => REPORTED.test(x.soft) && !BARE_REPEAT.test(x.soft))) return "reported";
  if (before.some((x) => (ASK_START.test(x.soft) || MODAL_ASK.test(x.soft)) && !EXCLAMATION_LEAD.test(x.soft) && !BARE_REPEAT.test(x.soft))) return "question";
  return "imperative";
}

/** Interruptions skipped when another intent of a merely mentioning clause may take it („La secunda 5 oprește tot sunetul”). */
const MENTION_SKIP = new Set([...INTERRUPT_INTENTS]);
/**
 * 2.12.2 review R2-F6: the reads whose subject is their own (runs, deliveries, tests, changes, a review, a preview, a failure replay) — a
 * question that names the stop only as a moment („Ce s-a executat înainte de Stop All?”) is still that read. The generic questions
 * (next_step, simulate, status, help, an analysis) stay about the stop itself („Ce urmează după Stop All?”).
 */
const STOP_TIME_READS = new Set(["last_run", "last_delivery", "show_changes", "show_tests", "show_review", "show_preview", "replay", "twin_changes"]);
/**
 * R2-F6: whether a clause that only TALKS about an interruption keeps another request it holds: a navigation, a plan proposal or a local
 * action (never under a question: a question never proposes a plan) or one of the reads above. Never an interruption, a confirmation or
 * anything NEVER_A_HALF names (consent and authority are never read out of a sentence about a stop).
 */
const keepsRequest = (intent, mood) => Boolean(intent) && !INTERRUPT_INTENTS.has(intent) && intent !== "explain_stop" && !NEVER_A_HALF.has(intent)
  && (STOP_TIME_READS.has(intent) || (mood !== "question" && mood !== "ask" && ["navigate", "plan", "local"].includes(INTENT_EFFECTS[intent])));
/** R2-F6: the clause without its parts that talk about the stop („deschide prodelivery, nu opri tot” → „deschide prodelivery”), or null. */
function withoutStopTalk(t) {
  const parts = String(t || "").split(/\s*[,;:]\s*|\s+(?:dar|insa|ci)\s+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  // Review F5: a part that opens with a condition („…, dar doar dacă pică testele”) is the stop's condition, never a request of its own.
  const kept = parts.filter((p) => !STOP_MENTION.test(p) && !STOP_COND_LEAD.test(softTrim(p)));
  return kept.length && kept.length < parts.length ? kept.join(", ").replace(/[\s,]+(?:dar|insa|ci|iar|si)$/, "").trim() || null : null;
}
/**
 * Review F5: the stop talk said INLINE at the end of a one-part clause, right after its own negation or condition word („deschide
 * prodelivery după ce oprești tot”, „… dacă oprești tot”, „… nu opri tot”) → the words before it, so a kept request never carries the stop
 * words (a project named „prodelivery dupa ce opresti tot”). Never when those words describe the stop (a topic or a relative clause: „fă un
 * clip despre ce se întâmplă când oprești tot” keeps its whole topic). null otherwise.
 */
const INLINE_STOP_TALK = new RegExp(String.raw`^(?<head>[^,;:]+?) (?:(?:sa )?(?:nu|niciodata)(?: mai)?|(?:(?:doar|numai) )?${STOP_COND_WORDS}) (?:${STOP_MENTION.source})$`);
function inlineRequest(t) {
  const m = softTrim(t).match(INLINE_STOP_TALK);
  const head = m ? m.groups.head.trim() : "";
  return head && !TOPIC_MARK.test(head) && !RELATIVE_MARK.test(head) ? head : null;
}
/** Review F1: intents whose own words carry the negation („Nu mai merge X” is an incident, „Nu acum” a hold): never refused for it. */
const NEGATION_AWARE = new Set(["not_yet", "reject_plan", "mute", "quiet", "incident_open", "notify_normal", "explain_stop", "unknown"]);
/** Review F1: words said under their own negation: „nu (mai) …”, „să nu …”, „n-…” at their start (a contrast word or „și” may lead). */
const NEG_LEAD = /^(?:(?:dar|insa|ci|si) )?(?:(?:sa )?(?:nu|niciodata)\b|n-)/;
/** The stop talk with its own negation („nu opri tot”, „să nu oprești tot”) — the stop's negation is never the request's. */
const NEG_STOP = new RegExp(String.raw`(?:\b(?:sa )?(?:nu|niciodata)(?: mai)? )?(?:${STOP_MENTION.source})`, "g");
/**
 * Review F1: whether the request part of a clause is itself negated („Nu mai deschide ProDelivery, nu opri tot”, „Nu pregăti planul, dar
 * oprește tot”): the owner said NOT to do it, so it is never kept or split off as a step of its own. `intent` is what the words matched.
 */
const negatedRequest = (intent, text) => !NEGATION_AWARE.has(intent) && NEG_LEAD.test(softTrim(String(text || "").replace(NEG_STOP, " ")));
/** R2-F7: „De ce ai oprit tot?” asks for the reason of a stop that happened — the reported answer (when, from where, the gate), not the definition. */
const WHY_STOPPED = /^(?:(?:dar|si|deci|bine) )?de ce (?:(?:ai|a|ati|au|am|s-a|sa|ti-ai|v-ati) )?(?:mai )?(?:oprit|opresti) (?:tot|totul|toate)\b/;
/**
 * Applies the rule to one clause's match (`found`, or null). A clause that names Stop All is judged by its words whatever pattern took
 * it (an unanchored one, or next_step / simulate / status for „Ce urmează / Ce se întâmplă dacă …”); the PF-01 case („Redeschide poarta
 * după Stop All”, no „?”) keeps the match it had. Another interruption is judged when its own pattern matched. → the step's
 * { intent, args }: the interruption unchanged (imperative), another intent (a strict mention another pattern explains), or explain_stop.
 * R2-F6: a clause that is a request of its own and only also talks about the stop keeps the request („Deschide ProDelivery, nu opri tot”,
 * „Fă un clip despre ce se întâmplă când oprești tot”, „Ce s-a executat înainte de Stop All?”); a negated stop adds its answer as a second
 * read (`alsoExplain`: „Bine, nu opresc nimic.”). Nothing here can make a stop out of a non-imperative clause.
 */
function imperativeOnly(found, t, { asks, modal, conjugated = false }) {
  const talksStop = STOP_MENTION.test(t) && !(found && found.intent !== "stop_all" && !asks && !modal && NAMED_AFTER_REOPEN.test(t));
  const intent = talksStop ? "stop_all" : found && INTERRUPT_INTENTS.has(found.intent) ? found.intent : null;
  if (!intent) return found;
  const mood = interruptMood(t, { asks, modal, intent, conjugated });
  if (mood === "imperative" || (mood === "mention" && !INTERRUPT_FORMS[intent].strict)) {
    if (intent !== "stop_all") return found;
    return { intent: "stop_all", args: found?.intent === "stop_all" ? found.args : {} };
  }
  // R2-F6: the request the clause holds besides the stop talk. A negated stop in its own part („…, nu opri tot”, „… dar nu opri tot”) is
  // cut away first, so the request keeps clean arguments (a mission's name never carries „nu opri tot”).
  // Review F5: a conditional or reported stop is cut away the same way (also said inline: „Deschide ProDelivery după ce oprești tot”) and
  // answered as a second read too, so the owner hears that nothing was stopped. Review F1: a request said under its own negation („Nu mai
  // deschide ProDelivery, nu opri tot”) is never kept — neither from the cut words nor from the clause's own match.
  const also = mood === "negation" ? { alsoExplain: { mood, about: intent } } : {};
  if (mood === "negation" || mood === "conditional" || mood === "reported") {
    const rest = withoutStopTalk(t) ?? inlineRequest(t);
    if (rest && mood !== "negation") also.alsoExplain = { mood, about: intent };
    // Review F1: the cut words may be a command of their own („Oprește Codex, dar nu opri tot”): a narrower interruption said as one runs.
    const own = rest ? matchPattern(rest) : null;
    if (own && own.intent !== intent && INTERRUPT_INTENTS.has(own.intent) && own.intent !== "stop_all") {
      const ownMood = interruptMood(rest, { intent: own.intent });
      if (ownMood === "imperative" || (ownMood === "mention" && !INTERRUPT_FORMS[own.intent].strict)) return { intent: own.intent, args: own.args, ...also };
    }
    const said = rest ? matchPattern(rest, MENTION_SKIP) : null;
    const other = said && !negatedRequest(said.intent, rest) ? said : null;
    if (other && keepsRequest(other.intent, mood)) return { intent: other.intent, args: other.args, ...also };
  }
  if (found && !INTERRUPT_INTENTS.has(found.intent) && negatedRequest(found.intent, t)) found = null;
  if (found && keepsRequest(found.intent, mood)) return { intent: found.intent, args: found.args, ...also };
  // R2-F7: „De ce ai oprit tot?” — when it happened and what holds the gate now.
  if (intent === "stop_all" && (mood === "question" || mood === "ask") && WHY_STOPPED.test(softTrim(t))) return { intent: "explain_stop", args: { mood: "reported", about: intent, why: true } };
  if (mood === "mention" || mood === "question") {
    const other = matchPattern(t, MENTION_SKIP);
    // Review F1: never a request the same clause negates („Nu mai deschide ProDelivery, butonul oprește tot”).
    if (other && !negatedRequest(other.intent, t) && (mood === "mention" || keepsRequest(other.intent, mood))) return { intent: other.intent, args: other.args };
  }
  return { intent: "explain_stop", args: { mood, about: intent, ...(intent === "stop_worker" && found?.args?.worker ? { worker: found.args.worker } : {}) } };
}

const STOP_TALK_COMMAND = Object.freeze({ stop_all: "Oprește tot", pause: "Pune totul pe pauză", takeover: "Preiau eu", freeze_project: "Îngheață proiectul" });
const MONTHS_RO = Object.freeze(["ianuarie", "februarie", "martie", "aprilie", "mai", "iunie", "iulie", "august", "septembrie", "octombrie", "noiembrie", "decembrie"]);
/** What „Oprește tot” does and what happens after it (the server's answer to a question about it; no administration pointer). */
export const STOP_EXPLANATION = "„Oprește tot” oprește imediat tot ce rulează: suspendă poarta de execuție, revocă autorizările, întrerupe execuțiile și misiunile, oprește planurile de operare și operatorul desktop, închide planurile neconfirmate și sesiunea vocală Lega. Apoi totul rămâne oprit: poarta o redeschizi tu, în cockpit, pe cardul „Redeschide poarta”, cu Windows Hello (nu prin voce), și nici după aceea nu repornește nimic singur; ce vrei reluat îmi ceri tu, de exemplu cu „Continuă”. Ca să opresc acum, spune „Oprește tot”.";
const whenRo = (iso) => {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  return `${d.getDate()} ${MONTHS_RO[d.getMonth()]}, la ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
/** R2-F7: where the newest owner Stop All came from (the channel the intake read from its event; enum keys only). */
const STOP_VIA_RO = Object.freeze({ voice: "prin voce", owner: "din sesiunea ta", companion: "de pe telefon", ui: "din interfața Hub-ului" });
/**
 * The Hub's answer to an explain_stop step ({ mood, about, worker, why }). `facts` (the intake reads them, for "reported" only):
 * `lastStopAt` (ISO time of the newest owner Stop All in the event log, or null), `lastStopVia` (its channel: voice | owner | companion |
 * ui, or null) and `gate` ("stop_all" when a Stop All still holds the gate, "open", or "other"). Romanian, speakable, short; it never points
 * at an administration path and never says anything was stopped. R2-F7: `why` („De ce ai oprit tot?”) answers when and from where the last
 * Stop All came, and what holds the gate; a named worker that is neither Codex nor Claude is „agentul”.
 */
export function stopTalkAnswer({ mood = "question", about = "stop_all", worker = null, why = false, partial = false } = {}, { lastStopAt = null, lastStopVia = null, gate = null } = {}) {
  if (about === "stop_all") {
    // Review F1: `partial` — the same sentence also named a narrower stop the Hub runs („…, nu opri tot, oprește doar Codex”).
    if (mood === "negation") return partial ? "Bine, nu opresc tot; fac doar ce ai cerut." : "Bine, nu opresc nimic.";
    if (mood === "conditional") return "Nu pun opriri condiționate, așa că nu am oprit nimic acum. Spune „Oprește tot” când vrei să opresc.";
    if (mood === "ask") return "Ai întrebat, așa că nu am oprit nimic. Spune „Oprește tot” și opresc imediat.";
    if (mood === "quote") return "Ai pus „Oprește tot” între ghilimele, ca citat, așa că nu am oprit nimic. Ca să opresc, spune „Oprește tot” fără ghilimele.";
    if (mood === "mention") return "Nu am oprit nimic: „oprește tot” nu era comanda de la începutul frazei. Ca să opresc, spune „Oprește tot” și opresc imediat.";
    if (mood === "reported") {
      const when = lastStopAt ? whenRo(lastStopAt) : null;
      const gateLine = gate === "stop_all" ? " Poarta e încă oprită de el: o redeschizi în cockpit, pe cardul „Redeschide poarta”, cu Windows Hello (nu prin voce)."
        : gate === "open" ? " Poarta de execuție e deschisă acum." : "";
      if (why) {
        const via = STOP_VIA_RO[lastStopVia] || null;
        const other = gate === "other" ? " Poarta de execuție e oprită acum din alt motiv; îl vezi în cockpit." : "";
        return when ? `Ultimul „Oprește tot” a fost pe ${when}, cerut ${via || "printr-o comandă"}.${gateLine}${other}` : `Nu găsesc niciun „Oprește tot” în jurnalul Hub-ului.${gateLine}${other}`;
      }
      return when
        ? `Ultimul „Oprește tot” a fost pe ${when}.${gateLine} O frază despre ce s-a spus nu oprește nimic; dacă vrei să opresc acum, spune „Oprește tot”.`
        : "Nu găsesc niciun „Oprește tot” în jurnalul Hub-ului. O frază despre ce s-a spus nu oprește nimic; dacă vrei să opresc acum, spune „Oprește tot”.";
    }
    return STOP_EXPLANATION;
  }
  const command = about === "stop_worker" ? `Oprește ${worker === "claude" ? "Claude" : worker === "codex" ? "Codex" : "agentul"}` : STOP_TALK_COMMAND[about] || "Oprește tot";
  if (mood === "negation") return about === "pause" ? "Bine, nu pun nimic pe pauză." : about === "freeze_project" ? "Bine, nu îngheț nimic." : about === "stop_worker" ? "Bine, nu opresc niciun agent." : "Bine, nu opresc nimic.";
  if (mood === "conditional") return `Nu fac opriri condiționate, așa că nu am făcut nimic acum. Spune „${command}” când vrei.`;
  const because = { ask: "ai întrebat", question: "a fost o întrebare", reported: "ai povestit ce s-a spus", quote: "era un citat", mention: "comanda nu era la începutul frazei" }[mood] || "nu era o comandă";
  return `Nu am făcut nimic: ${because}. Spune „${command}” când vrei și o fac imediat.`;
}

// ---------------------------------------------------------------- 2.12.2 (P0-R6, L11): the Hub's mode named in a sentence
/**
 * The owner asked live „Pune-l pe live activation” and heard „În regulă, mă ocup acum.” (nothing could happen). The mode is never changed
 * from a sentence, and a plan does not need it (it starts from BUILD_SAFE after its one confirmation). The targets, normalized („_” is a
 * space): „live”, „live validation / activation / validare / activare / mode”, „validare live”, „build safe”, „operational”.
 */
const MODE_TARGET = String.raw`(?:live(?: (?:validation|activation|validare|activare|mode))?|validare live|activare live|build safe|operational)`;
/**
 * A change verb, an optional object that is the Hub or its mode (never „căutarea”, „Lega” or another noun: the Lega web-search setting
 * stays its own), an optional „pe / în / la”, an optional „modul”, then the target alone: „Treci pe live”, „Pune Hub-ul în modul live”,
 * „Pune-l pe live activation”, „Activează LIVE_VALIDATION”, „Schimbă modul pe live”.
 */
const MODE_CHANGE = new RegExp(String.raw`^(?:pune|puneti|treci|trece|treceti|schimba|schimbati|comuta|comutati|seteaza|setati|activeaza|activati|porneste|porniti|muta|mutati|intra|intrati|du)(?:-l|-o|-ne|-ma)?(?: (?:hub-ul|hubul|hub|sistemul|totul|tot))?(?: (?:modul|mod|regimul|regim)(?: (?:hub-ului|hubului))?)?(?: (?:pe|in|la))?(?: (?:modul|mod|regimul|regim))? (?<target>${MODE_TARGET})(?: (?:acum|imediat))?$`);
/** „Ești în build safe?”, „Suntem în BUILD_SAFE?”, „Hub-ul e pe live?”, „În ce mod e Hub-ul?”, „Care e modul acum?”: a status read. */
const MODE_QUESTION = new RegExp([
  String.raw`^(?:(?:esti|este|e|suntem|sunt|lucrezi|lucram|rulezi|rulam)(?: (?:hub-ul|hubul|hub))?|(?:hub-ul|hubul|hub) (?:e|este|ruleaza|lucreaza))(?: (?:acum|inca|tot|deja))? (?:in|pe) (?:(?:modul|mod|regimul) )?${MODE_TARGET}$`,
  String.raw`^(?:in|pe) ce (?:mod|regim) (?:e|este|esti|suntem|lucreaza|lucrezi|lucram|ruleaza|rulezi|merge|functioneaza)(?: (?:acum|hub-ul|hubul|hub))*$`,
  String.raw`^(?:ce|care) (?:e|este) modul(?: (?:hub-ului|hubului|curent|acum))*$`,
  String.raw`^ce mod (?:e|este|ai|are|avem)(?: (?:hub-ul|hubul|acum|activ|setat))*$`,
].join("|"));
/** „Ce a rămas în ProDelivery?”, „Ce-a mai rămas de făcut la pro-delivery?”, „Ce a mai rămas?”: status for that project (or the open one). */
const REMAINING = /^(?:(?:si|dar|deci) )?ce(?:-a| a)?(?: mai)?(?: a)? ramas(?: (?:de facut|de lucru|nefacut|neterminat))?(?: (?:in|la|pe|din|pentru) (?:proiectul )?(?<ref>[a-z0-9 -](?:[a-z0-9 -]|\.(?=[a-z0-9])){1,59}))?$/;
const HUB_MODES = new Set(["BUILD_SAFE", "LIVE_VALIDATION", "OPERATIONAL"]);
/**
 * The Hub's answer to explain_mode (a change asked) or to a mode question (`question: true`), from the mode the server reads (`mode`).
 * `spoken`: the words came by voice („prin voce”); typed words get „dintr-o frază”. Romanian, speakable, never an administration pointer.
 */
export function modeAnswer({ question = false } = {}, { mode = null, spoken = true } = {}) {
  const m = HUB_MODES.has(mode) ? mode : null;
  if (question) {
    if (m === "BUILD_SAFE") return "Hub-ul e în BUILD_SAFE, modul obișnuit: un plan pornește de aici după ce îl confirmi o dată în cockpit.";
    if (m) return `Hub-ul e în ${m}. Pentru un plan nu trebuie schimbat nimic: pornește după ce îl confirmi o dată în cockpit.`;
    return "Nu pot citi acum modul Hub-ului.";
  }
  const base = `Modul Hub-ului nu se schimbă ${spoken ? "prin voce" : "dintr-o frază"} și nici nu e nevoie: un plan pornește din BUILD_SAFE după ce îl confirmi o dată în cockpit.`;
  return m && m !== "BUILD_SAFE" ? `${base} Acum Hub-ul e în ${m}.` : base;
}

/** D3: a clause that asks to run or start the preview („Rulează / Pornește / Da drumul la preview-ul …”), on the prepared clause. */
export const PREVIEW_START = /^(?:ruleaza|porneste|lanseaza|reporneste|activeaza|da drumul la)\b/;

// Pattern table: [intent, regex on the normalized clause, (match, clause) => args]. First match wins per clause.
// M10.2.1 (D21): a free reference may hold a dot INSIDE a word ("factory demo m10.2", "v2.1"): `\.(?=[a-z0-9])`, never as its first
// character and never at its end (a sentence-final period is cut with the clause and stripped before matching).
const P = [
  ["gate_rearm", GATE_REARM],
  // (the cheap lookahead first, so the reopen-verb assertions run only where a stop word starts)
  ["stop_all", new RegExp(String.raw`\b(?=(?:opreste|stop|opriti) )${NOT_NAMED_AFTER_REOPEN}(?:(?:opreste|stop|opriti) (?:tot|totul|toate)\b|stop all\b)`)],
  ["takeover", /\bpreiau eu\b|\blas(a|ati)[- ]ma pe mine\b|\bpreiau (controlul|de aici)\b/],
  // M10.2: running a downloaded file, an installer or a script is never an action from a sentence — refused with the reason, and
  // BEFORE "deschide …" (live, "Deschide și execută fișierul descărcat" became open_project of a project named after the words).
  // Review M10.2 #22: `.com` is a web domain far more often than a DOS executable ("Analizează pagina ifrimdigital.com", "Repară bug-ul
  // de pe prodelivery.com" were refused), so it counts only right after a run verb or with a downloads phrase; "instalează" counts
  // only as the imperative (first verb, or after „și / apoi / să”), never inside a description ("funcția care instalează pluginurile").
  ["refuse_execute", /\b(?:executa|ruleaza|instaleaza|lanseaza|porneste|deschide)\b.*\b(?:fisier(?:ul)?|program(?:ul)?|installer(?:-ul|ul)?|kit(?:ul)?|arhiva|aplicatia|scriptul|atasamentul|executabilul)\b.*\b(?:descarcat|descarcata|downloadat|downloadata|primit|primita|de pe (?:net|internet)|din downloads|din descarcari|din (?:e-?mail|mail))\b|\b[a-z0-9_-]+\.(?:exe|msi|bat|cmd|ps1|scr|vbs|jar)\b|\b(?:executa|ruleaza|lanseaza) [a-z0-9_-]+\.com\b|\b[a-z0-9_-]+\.com\b.*\b(?:din downloads|din descarcari)\b|\b(?:executa|ruleaza|instaleaza|lanseaza) (?:un |acel |acest |)(?:setup(?:-ul|ul)?|installer(?:-ul|ul)?|kit(?:ul)? de instalare|scriptul|fisierul|programul|executabilul)\b|\bsetup(?:-ul|ul)? (?:descarcat|de instalare)\b|^instaleaza\b|\b(?:si|apoi|sa) instaleaza\b/,
    () => ({ reason: REFUSE_EXECUTE_REASON })],
  ["freeze_project", /\bingheata (?<ref>.+)/, (m) => ({ projectRef: m.groups.ref })],
  ["unfreeze_project", /\bdezgheata (?<ref>.+)/, (m) => ({ projectRef: m.groups.ref })],
  ["stop_worker", /\bopreste (?:(?:doar|numai) )?(?<who>codex|claude|writerul|writer|reviewerul|reviewer|agentul|workerul)\b/, (m) => ({ worker: /claude|review/.test(m.groups.who) ? "claude" : /codex|writer/.test(m.groups.who) ? "codex" : "any" })],
  // M09: live capture off (MEDIA_B rollback) — only reduces activity, so it is accepted from every channel.
  ["capture_off", /\b(opreste|stop|opriti|inchide) (captura|capturile|captura live|inregistrarea ecranului|filmarea ecranului|filmarea)\b/],
  ["mute", /^(taci|liniste|nu mai vorbi|gata cu vorba|opreste vocea|mut)\b|\bnu mai vorbi\b|\btaci\b/],
  // M10: start the voice assistant. Anchored on the whole clause: a leading "lega," is stripped before matching, so "Lega,
  // pornește" stays the plan confirmation below; "deschide <proiect>", "modul Lega", "nu porni" keep their own intents.
  ["lega_start", /^(porneste|deschide|activeaza|trezeste)( pe)? lega$|^(vreau sa vorbesc|vorbesc|hai sa vorbim|sa vorbim) cu lega$|^porneste vocea( lega)?$/],
  // M10.2 negation guard, BEFORE the confirmation and the plan request: "Nu executa planul" once resolved to show_plan (a NEW
  // envelope that superseded the one on screen), "Nu acum" / "Nu confirma" / "Să nu pornești nimic" to unknown. A negation only
  // holds or removes an effect.
  ["reject_plan", /^(?:nu,? )?(?:anuleaza|anulati|renunta la|renunt la|abandoneaza|arunca) planul\b|^nu,? (?:nu )?(?:vreau|accept|aprob) planul\b/],
  ["not_yet", /^(?:nu,? )*nu (?:acum|inca|confirma|confirm|confirmi|executa|executi|porni|pornesti|incepe|incepi|rula|rulezi|lansa|lansezi|da drumul)\b|^(?:nu,? )?sa nu (?:pornesti|incepi|rulezi|executi|confirmi|lansezi|pornim|incepem|executam|faci)\b|^(?:stai|asteapta)\b/],
  // A confirmation is an answer, anchored at the start ("da", "execută planul"); "nu porni" or "doar planul" never match it.
  ["confirm", /^(da|da,? (fa-l|fa-o|fa|porneste|executa|te rog)|confirm|confirma|confirmat|executa planul|porneste|da,? executa planul|ok,? porneste|da,? porneste)( planul)?$/],
  // Review M10.2 #19: the everyday yes-variants ("Ok / Hai / Sigur / Bine, execută planul", "… acum", "Da, confirm", "Da, execută-l")
  // fell to show_plan (a NEW card that superseded the one being answered) or to unknown. Still anchored on BOTH ends, the
  // acknowledgement words only lead into a confirmation verb (never global fillers: "hai la …" stays navigation), and a verb that
  // is not self-sufficient ("execută", "fă-l") needs the acknowledgement in front. Kept as its own line so the anchor of the line
  // above stays the one the mutation check (M10.2-IN-10) removes.
  ["confirm", /^(?:(?:ok|okay|hai|sigur|bine|da),? )+(?:da|confirm|confirma|confirmat|executa|executa-l|executa-o|fa-l|fa-o|fa|porneste|sigur)(?: planul)?(?: acum| imediat)?$|^(?:confirm|confirma|executa planul|porneste)(?: planul)?(?: acum| imediat)$/],
  // M10.2: starting a mission is a PLAN request (its card, then the one confirmation) — never a confirmation itself, so the anchored
  // "Pornește" above stays the only short yes. "Pornește-o" names the last target (the server's lastTarget), not a guess.
  ["start_mission", /^(?:da,? )?(?:porneste|incepe|lanseaza|ruleaza|da drumul la)(?:(?<it>-o|-l)$| (?:misiunea|misiune)\b(?: (?<ref>.+))?$)/,
    (m) => ({ missionRef: cleanMissionRef(m.groups.ref), ...(m.groups.it ? { ref: "it" } : {}) })],
  // "Reia misiunea" / "Continuă misiunea pusă pe pauză": a resume (status-aware in the handler); "Continuă misiunea X" with no state
  // word stays continue_work (a plan over X), and a bare "Continuă" / "Reia" stays the operation plan's resume.
  // Review M10.2 #25: the bare pronoun forms ("Reia-o", "Repornește-l") name the last target like "Pornește-o" (ref: "it"), so they
  // resolve from the server's lastTarget and never fall through to the only paused mission.
  ["resume_mission", /^(?:reia|reporneste)(?:-o|-l)? (?:misiunea|lucrul|munca)\b(?<ref>.*)$|^(?:reia|reporneste)(?<it>-o|-l)$|^continua (?:misiunea|lucrul|munca)\b(?<ref2>.*\b(?:pauza|oprita|oprit|intrerupta|intrerupt|blocata|blocat|suspendata)\b.*)$/,
    (m) => ({ missionRef: cleanMissionRef(m.groups.ref ?? m.groups.ref2), paused: true, ...(m.groups.it ? { ref: "it" } : {}) })],
  ["pause", /^(pauza|pune pe pauza|pune pauza)\b|\bpune (totul )?pe pauza\b|\bia o pauza\b/],
  ["quiet", /\bnu ma deranja\b|\bfara notificari\b|\bmod linistit\b/, (m, c) => ({ onlyDecisions: /\bdecat (pentru|daca|la) (o )?decizi/.test(c) || /\bdoar (pentru|la) decizi/.test(c) })],
  ["notify_normal", /\b(poti sa ma (anunti|deranjezi)|notificari normale|anunta-ma)\b/],
  // 2.12.2 (P0-R6, L11), before `live` („mod live” = back to now) and open_project („Treci pe live” is no project): the Hub's mode named
  // as a target of a change verb is explain_mode (answered, never done); a question about the mode and „Ce (mai) a rămas (de făcut) în X”
  // are status reads. Anchored on the whole clause: „căutarea pe live”, „Pornește Lega”, a project named „Live Demo” never match.
  ["explain_mode", MODE_CHANGE, (m) => ({ target: m.groups.target })],
  ["status", MODE_QUESTION, () => ({ modeQuestion: true })],
  ["status", REMAINING, (m) => ({ remaining: true, ...(m.groups.ref ? { projectRef: m.groups.ref.trim() } : {}) })],
  ["face_show", /\barata(-ti|ti)? fata\b|\barata-te\b|\bfata ta\b/],
  ["face_core", /\brevino la nucleu\b|\binapoi la nucleu\b|\bnucleul\b/],
  ["face_discreet", /\bmai discret\b|\bmai mic\b|\bcompact\b/],
  ["face_hide", /\bascunde (fata|avatarul)\b/],
  ["live", /\b(revino|inapoi) la (acum|live|prezent)\b|\bmod live\b/],
  ["replay", /\b(arata|explica)(-mi)? (de ce|cum) a (picat|esuat|cazut)\b|\bde ce a picat\b|\breplay\b|\barata(-mi)? momentul\b/, (m, c) => ({ subject: /\btest/.test(c) ? "test" : "mission" })],
  ["why_blocked", /\bde ce (e|este|a ramas|s-a|sa) (blocat|oprit|in asteptare)|\bde ce nu (porneste|merge|continua)\b|\bce (il|o) blocheaza\b/],
  ["why_route", /\bde ce (?<who>claude|codex)\b/, (m) => ({ worker: m.groups.who })],
  ["twin_why", /\bde ce (am ales|am decis|am hotarat|folosim|avem|am pus|am schimbat|am trecut pe) (?<what>.+)/, (m) => ({ what: m.groups.what })],
  ["start_view", /\b(porneste|deschide|incepe) (direct |mereu |intotdeauna )?(in|cu) (?<v>ecran(ul)? complet|lega|scena|cockpit(ul)?)\b/, (m) => ({ startView: /cockpit/.test(m.groups.v) ? "cockpit" : "stage" })],
  ["fullscreen", /\becran(ul)? complet\b|\bpe tot ecranul\b|\bfullscreen\b|\bmod(ul)? lega\b/],
  ["cockpit_view", /^(cockpit(ul)?|arata(-mi)? cockpit(ul)?|iesi din ecran(ul)? complet|ecran normal)$/],
  ["details", /^(detalii|arata(-mi)? detaliile|mai multe detalii|vreau detalii)$/],
  // M10 Desktop Operator — BEFORE studio_open ("deschide OBS Studio" is the app, not the Studio page) and open_project ("deschide
  // CapCut" is not a project). Only known app names match; "importă din folderul acesta" reads the Explorer window in front.
  ["not_yet", /^nu (deschide|porni|lansa|inregistra|filma|importa|aduce)\b/],
  ["ops_capture_vertical",/\b(inregistreaza|filmeaza|captureaza|inregistram|filmam)(-mi)?\b.*\b(demonstratia|demo-ul|demoul|demo|ecranul|hub-ul|hubul|aplicatia)\b/,
    (m, c) => ({ vertical: /\b(vertical|verticala|9 16|tiktok|reels|shorts)\b/.test(c), noPublish: true, obs: /\bobs\b/.test(c) })],
  ["desktop_folder", /\b(arata|deschide|du-ma la|du-ma in)(-mi)? (folderul|dosarul|locul) (cu |unde sunt |de )?(exporturi(le|lor)?|exportul|export|exportate)\b|\bunde (e|sunt) (exportul|exporturile|clipul exportat)\b/, () => ({ folder: "exports" })],
  ["desktop_focus", new RegExp(String.raw`(?<!\bnu )\b(adu|pune|treci|comuta|mergi)(-mi|-l|-o)? (pe |in |la )?(?<app>${DESKTOP_APP_WORDS}) (in fata|in prim[- ]plan|deasupra|sus)\b|\b(treci|comuta|mergi) (in|pe|la) (?<app2>${DESKTOP_APP_WORDS})$`),
    (m) => ({ app: desktopAppId(m.groups.app || m.groups.app2) })],
  ["desktop_open", new RegExp(String.raw`(?<!\bnu )\b(deschide|deschideti|porneste|lanseaza|da-mi|fa-mi)(-mi)? (aplicatia |programul )?(?<app>${DESKTOP_APP_WORDS})\b`), (m) => ({ app: desktopAppId(m.groups.app) })],
  // M10.2: "Fă un videoclip de promovare de 30 de secunde" — a Content Studio PLAN request (live it reached no resolver and became a
  // project_management mission on the Hub through the model). Anchored on the verb: "nu face un clip" is not a request.
  // D2: „Fă acel / acest videoclip de promovare” (the live sentence) is the same request; the planner still chooses the materials.
  ["studio_create", /^(?:fa|creeaza|genereaza|pregateste|produ|realizeaza|monteaza|construieste)(?:-mi|-ne)? (?:si )?(?:un |o |niste |acel |acest )?(?:nou |noua |scurt |scurta )?(?:videoclip|clip|video|reel|filmulet|promo|montaj)(?:ul|uri|urile)?\b/, studioCreateArgs],
  // D6: „în Studio(-ul)” may stand after the verb or after the object („Importă în Studio din folderul acesta”).
  ["studio_import_here", /\bimporta(-l|-le|-mi)?( in studio(-?ul)?,?)?( (proiectul|clipul|materialele|fisierele|tot|video-ul|montajul))?( in studio(-?ul)?,?)?( (din|de (in|la))( (folderul|dosarul|locul))? ?(acesta|asta|deschis|curent|de aici|aici)| de aici)\b/],
  ["studio_variant", /\b(pregateste|fa|randeaza|genereaza|scoate)(-mi)? (si )?(varianta|versiunea|formatul) (?<fmt>verticala|vertical|9 16|tiktok|reels|shorts|patrata|linkedin|youtube)\b/, (m) => ({ format: m.groups.fmt })],
  ["ops_continue", /^(continua|continua planul|continua acum|reia|reia planul|mergi mai departe|poti continua|gata,? continua|ok,? continua)$/],
  // M09 Content Studio — BEFORE simulate / incident_open / status / show_preview / open_project, which would otherwise swallow
  // "arată-mi clipul" (a project named „clipul”), "preview-ul clipului" (the factory preview) or "la secunda 12 …".
  // "Publică clipul" is never an action from a sentence ("nu publica" / "nu se încarcă" are not requests to publish).
  ["studio_publish", /(?<!\b(?:nu|se) )\b(publica|posteaza|urca|incarca)(-l|-o)? (clipul|clipurile|video-ul|videoul|video|filmul|montajul|materialul)\b|(?<!\bnu )\b(publica|posteaza|pune|urca)(-l|-o)? pe (instagram|tiktok|youtube|linkedin|twitter|x)\b/],
  ["studio_open", /\b(deschide|arata(-mi)?|du-ma (la|in)|mergi (la|in)|hai (la|in)|treci (pe|la|in)|intra in) studio(ul)?\b(?: (?:la|pentru|cu|pe) (?:clipul |proiectul )?(?<ref>[a-z0-9 -](?:[a-z0-9 -]|\.(?=[a-z0-9])){1,59}))?|^studio(ul)?$/, (m) => ({ clipRef: m.groups?.ref?.trim() || null })],
  // M10.2: "ultimul clip", "clipul nou", "cel creat acum" → args.latest (the newest clip; the handler picks it, never a guess by name).
  ["studio_show_clip", /\b(arata(-mi)?(-l)?|deschide|vreau sa vad|pune-mi) (?:(?:pe )?(?:ultimul|cel mai nou|noul) (?:clip|videoclip|video|montaj|film)|(?:clipul |video-ul |pe )?cel (?:nou|creat|facut|randat)(?: acum| adineauri| azi)?)\b|\b(arata(-mi)?|deschide|vreau sa vad|pune-mi) (clipul|clipurile|video-ul|videoul|filmul|montajul|randarea)(?: (?:despre |cu |pentru |de la |de )?(?<ref>[a-z0-9 -](?:[a-z0-9 -]|\.(?=[a-z0-9])){1,59}))?$|\b(preview-ul|previzualizarea) (clipului|video-ului|videoului|montajului)(?: (?<ref2>[a-z0-9 -](?:[a-z0-9 -]|\.(?=[a-z0-9])){1,59}))?$/,
    (m, c) => {
      const ref = (m.groups.ref || m.groups.ref2 || "").trim();
      const latest = /\b(ultimul|cel mai nou|noul|cel nou|creat acum|cel creat|cel facut|cel randat|adineauri)\b/.test(c) || /^(nou|cel nou|creat acum|de acum|recent)$/.test(ref);
      return latest ? { clipRef: null, latest: true } : { clipRef: ref || null };
    }],
  ["studio_edit", /^(?=.*\b(?:la|de la|in|pe) (?:secunda|sec|secundele|secundei) (?<t>\d{1,4}(?:[.,]\d{1,2})?|[a-z]+)\b)(?=.*\b(?<op>muta|mutati|taie|scoate|pune|mareste|micsoreaza|ridica|coboara|schimba|sterge|tine)\b)/, studioEditArgs],
  ["studio_edit", /^(?=.*\btaie (?:de )?la (?<from>\d{1,4}) (?:la|pana la) (?<to>\d{1,4})\b)/, studioEditArgs],
  ["studio_edit", /^(?=.*\b(?<op2>muta|mutati|taie|scoate|mareste|micsoreaza|ridica|coboara)\b)(?=.*\b(textul|titlul|subtitrarea|subtitrarile|logo-ul|logoul|logo|cadrul|hook-ul|cta-ul|butonul|montajul|demonstratia|intro-ul|introul)\b)/, studioEditArgs],
  // M10.2 reads (before status / open_project, which swallowed "Arată-mi ultima livrare" as a project named „ultima livrare”).
  // A bare "delivery" stays a project reference ("Hai la delivery"); only "ultima livrare", "ce s-a livrat" or the word alone read.
  ["last_run", /\bce (?:s-a|sa|a|am) (?:executat|rulat)\b|\bultim(?:a|ul|ele|ii) (?:executie|executia|executii|rulare|rularea|rulari|rularile|run|run-ul)\b|\bce a facut (?:ultima data|ultima oara)\b/],
  ["last_delivery", /\bultim(?:a|ul|ele) (?:livrare|livrarea|livrari|livrarile|delivery|bundle|bundle-ul|pachet(?:ul)? de livrare)\b|\bce (?:s-a|sa|am|ai) livrat\b|^(?:delivery|bundle|bundle-ul|bundleul|livrarea|livrarile)$|\barata(?:-mi)? (?:bundle-ul|bundleul|bundle-urile|livrarea|livrarile|delivery-ul)\b|\bce (?:livrari|bundle-uri) (?:asteapta|am)\b/],
  ["next_step", /\bce urmeaza\b|\bcare (?:e|este) (?:urmatorul pas|pasul urmator|urmatorul)\b|\b(?:urmatorul pas|pasul urmator)\b|\bce (?:fac|facem) (?:mai departe|in continuare)\b/],
  // M10.2 integration: a code change ("repară testul X", "implementează Y") is ONE engineering plan. Review M10.2 #18: it sat at the
  // bottom, so every unanchored read or plan pattern below took the owner's code request first ("Repară testele care pică" →
  // show_tests, "Adaugă un endpoint de status" → status, "Repară preview-ul" → show_preview, "Repară butonul … care nu merge" →
  // incident_open, "Corectează validarea din planul de abonament" → show_plan, a generic card that superseded the one on screen).
  // Anchored on the verb AND a code object, so it only takes sentences that ARE a code request; the interruptions, the negation and
  // condition guards and refuse_execute above still win. The planner decides project, test and models; the owner confirms once.
  ["engineering_request", /^(?:repara|rezolva|corecteaza|implementeaza|refactorizeaza|adauga|scrie)\b.*\b(?:bug(?:-ul|ul|uri)?|eroarea|erori(?:le)?|testul|testele|teste|test|functia|functionalitatea|feature(?:-ul|ul)?|fix(?:-ul|ul)?|endpoint(?:-ul|ul)?|validarea|validare|pagina|componenta|modulul|codul|crash(?:-ul|ul)?|regresia|preview(?:-ul|ul)?|butonul|buton)\b/, (_m, clause) => ({ request: clause })],
  // An analysis moves up ONLY for the strong analysis verbs on a code object ("Analizează testele care pică" read the tests): the
  // reading verbs ("Explică-mi testele", "Citește planul", "Rezumă status-ul") keep their read intents below, and a sentence about
  // the plan or the status is never turned into a model run.
  ["analysis_request", /^(?:analizeaza|revizuieste|evalueaza|investigheaza)\b(?! de ce)(?!.*\b(?:planul|status(?:ul|-ul)?)\b).*\b(?:bug(?:-ul|ul|uri)?|eroarea|erori(?:le)?|testul|testele|teste|functia|functionalitatea|endpoint(?:-ul|ul)?|validarea|pagina|componenta|modulul|codul|crash(?:-ul|ul)?|regresia|log-urile|logurile|fisierul)\b/, (_m, clause) => ({ request: clause })],
  ["simulate", /\bce (se intampla|s-ar intampla|ar fi|ar insemna) daca (?<what>.+)|\bsimuleaza (?<what2>.+)|\bfa(-mi)? un scenariu\b ?(?<what3>.*)/, (m, c) => ({ scenario: (m.groups.what || m.groups.what2 || m.groups.what3 || "").trim(), ...simulationArgs(c) })],
  ["league", /\b(cine|ce agent|care agent|ce model|care model) (lucreaza|merge|livreaza|iese) (cel )?mai bine\b|\bclasament(ul)? (agentilor|modelelor)\b|\bliga (agentilor)?\b|\bperformanta (agentilor|modelelor)\b/],
  ["today", /\bce avem (azi|astazi)\b|\bce am (azi|de facut azi)\b|\bce e (azi )?pe agenda\b|\bagenda (de )?azi\b/],
  ["decisions", /\bce (decizii (am|astept|sunt)|trebuie sa decid|am de decis)\b|\bce asteapta (decizia mea|de la mine|dupa mine)\b/],
  ["board_open", /\b(deschide|incepe|hai la|porneste|tine) (o |ședința |)?sedinta\b|\bsedinta (saptamanala|de board|board)\b|\bboard meeting\b/],
  ["board_next", /^(urmatorul( punct| subiect)?|punctul urmator|subiectul urmator|next)$/],
  ["board_defer", /\bamana (punctul|asta|subiectul|decizia)\b|\blasa(-l)? pe (saptamana|sedinta) viitoare\b/],
  ["twin_changes", /\bce s-a schimbat (de ieri|de aseara|de azi dimineata|de la ultima (mea )?vizita|cat am lipsit|de cand am plecat)\b|\bce e nou de ieri\b/],
  ["twin_impact", /\bce (afecteaza|strica|atinge) (?<what>.+)|\b(care e|ce) impact(ul)? (are|al) (?<what2>.+)|\bce se (strica|afecteaza) daca (schimb|modific) (?<what3>.+)/, (m) => ({ what: (m.groups.what || m.groups.what2 || m.groups.what3 || "").trim() })],
  ["objective_plan", /\b(pregateste|propune) planul (pentru|obiectivului) (obiectivul )?(?<ref>.+)|\b(porneste|continua) obiectivul (?<ref2>.+)/, (m) => ({ objectiveRef: (m.groups.ref || m.groups.ref2 || "").trim() })],
  ["objectives", /\b(arata(-mi)?|care sunt|ce) obiective(le)?\b/],
  ["incident_open", /\b(avem|deschide) un incident\b|^(?<what>.+?) (a picat|a cazut|nu (mai )?(merge|functioneaza|raspunde|se incarca)|s-a stricat|e (jos|picat|cazut)|da (o )?eroare|da erori)\b|^nu (mai )?(merge|functioneaza|se incarca|raspunde) (?<what2>.{2,80})$/, (m) => ({ what: (m.groups.what || m.groups.what2 || "").trim() })],
  ["status", /\bce face (acum|codex|claude)\b|\bce se intampla\b|\bunde (suntem|am ajuns)\b|\bcum merge\b|\bce faci acum\b|\bstatus\b/, (m, c) => ({ worker: /codex/.test(c) ? "codex" : /claude/.test(c) ? "claude" : null })],
  ["show_review", /\b(claude|reviewerul|review-ul|reviewul) ce (a gasit|zice|spune)\b|\bce (a gasit|zice|spune) (claude|reviewerul)\b|\bce zice review\b|\barata(-mi)? review/],
  ["show_changes", /\bce a schimbat\b|\barata(-mi)? (ce a schimbat|diff|modificarile|schimbarile)\b|\bce (fisiere|modificari) (a|au)\b/],
  ["show_tests", /\btestele\b|\bau trecut testele\b|\bce teste\b|\barata(-mi)? test/],
  // D3: „Rulează / Pornește preview-ul X” is the same read with `start` (the intake answers it; a preview only runs as a mission step).
  // D3 review: the Romanian inflected spellings too („previewul”, „previewurile”, „previzualizarea”), not only „preview” / „preview-ul”.
  ["show_preview", /\bpreview(?:-?(?:ul|ului|uri|urile|urilor))?\b|\bprevizualizare(?:a|ii)?\b|\barata(-mi)? (aplicatia|rezultatul)\b/, (_m, c) => (PREVIEW_START.test(c) ? { start: true } : {})],
  ["show_company", /\barata(-mi)? compania\b|\bharta (companiei|firmei)\b|\bcompania\b/],
  ["recommendations", /\bce recomanzi\b|\bce (putem|pot) simplifica\b|\brecomandari(le)?\b/],
  ["briefing", /\bce s-a schimbat\b|\bbuna dimineata\b|\bbriefing\b|\bce e nou\b|\brezumatul zilei\b/],
  ["continue_last", /\bcontinua ce faceam\b|\bunde am ramas\b|\bce faceam (ieri|azi|aseara|data trecuta)\b/],
  // Review M10.2 #19: the catch-all `planul` never takes a clause that STARTS with a start verb ("Ok, execută planul acum, …"): such a
  // sentence is a confirmation when clean (above) or ONE question (resolveIntent), never a new proposal over the card on screen.
  ["show_plan", /\barata(-mi)? (mai intai |inainte )?(planul|ce (ai de gand|vrei sa faci))\b|\barata(-mi)? inainte (sa faci?|de a face)\b|^(?!(?:(?:ok|okay|hai|sigur|bine|da),? )*(?:executa|porneste|incepe|lanseaza|ruleaza|confirma|confirm|fa-l|fa-o|da drumul)\b).*\bplanul\b/],
  ["focus", /\bdoar ce conteaza\b|\bmod(ul)? focus\b|\bfara detalii\b/],
  ["continue_work", /\bcontinua (?<what>.+)$|\bfa (?<what2>.+) pana e gata/, (m, c) => ({ topic: cleanTopic(String(m.groups.what || m.groups.what2 || "").replace(/\bpana (e|este|cand e) gata.*$/, "")), untilReady: /\bpana (e|este|cand e) gata\b/.test(c) })],
  ["reorder", /\bschimba ordinea\b|\bmai intai (?<first>.+?) (apoi|si dupa) (?<second>.+)/, (m) => ({ first: m.groups?.first || null, second: m.groups?.second || null })],
  ["reject_plan", /^(nu|nu,? (multumesc|renunt))$|\brenunt la plan\b|\banuleaza planul\b/],
  ["autonomy", /\b(seteaza|pune|schimba) (nivelul de )?autonomi(a|e) (pe|la) (?<level>observe|assisted|trusted|high)\b(?: (pe|la|pentru) (?<ref>.+))?/, (m) => ({ level: { observe: "OBSERVE", assisted: "ASSISTED", trusted: "TRUSTED", high: "HIGH_AUTONOMY_BOUNDED" }[m.groups.level], projectRef: m.groups.ref || null })],
  ["back", /^(inapoi|revino|back)$/],
  ["help", /\bce (poti|stii sa) (face|faci)\b|\bajutor\b/],
  // M10.2 integration: the remaining analyses / readings (lowest priority before open_project: every specific intent above wins, so
  // "Explică-mi planul" stays show_plan). The words themselves are the request; every plan still needs the owner's one confirmation.
  ["analysis_request", /^(?:analizeaza|citeste|rezuma|revizuieste|evalueaza|explica(?:-mi)?)\b(?! de ce)\s+\S/, (_m, clause) => ({ request: clause })],
  // Review M10.2 #24: the UNANCHORED hold sits below the code and analysis requests, so "Implementează pagina de login, dar nu porni
  // nimic" keeps the request as a preview-only plan (noStart) instead of dropping it. A clause that STARTS with a negation is still
  // held by the anchored not_yet near the top.
  ["not_yet", /\bnu (porni|incepe|rula|executa)( inca| nimic)?\b|\bnu inca\b|\basteapta\b|\bmai tarziu\b/],
  ["open_project", /\b(hai sa lucram|lucram|hai la|deschide|treci pe|schimba pe|comuta pe|mergi pe|du-ma la|arata-mi) (la |pe )?(proiectul )?(?<ref>[a-z0-9 -](?:[a-z0-9 -]|\.(?=[a-z0-9])){1,59})$/, (m) => ({ projectRef: m.groups.ref })],
];

/**
 * "la secunda 12 textul acoperă butonul, mută-l mai sus" → { atSec: 12, op: "muta", target: "textul", direction: "sus" }. The time is
 * never guessed: a missing or unreadable second gives atSec null and the caller asks for it.
 */
function studioEditArgs(m, clause) {
  const g = m.groups || {};
  const raw = g.t ?? g.from ?? null;
  const atSec = raw == null ? null : /^\d/.test(raw) ? Number(String(raw).replace(",", ".")) : numberOf(raw);
  const target = clause.match(/\b(textul|titlul|subtitrarea|subtitrarile|logo-ul|logoul|logo|cadrul|hook-ul|cta-ul|butonul|clipul|montajul|demonstratia)\b/)?.[1] || null;
  const direction = clause.match(/\b(?:mai )?(sus|jos|la stanga|la dreapta|stanga|dreapta|in centru|la centru)\b/)?.[1] || null;
  const ref = clause.match(/\b(?:in|din) (?:clipul|video-ul|videoul|montajul) (?<ref>[a-z0-9 -](?:[a-z0-9 -]|\.(?=[a-z0-9])){1,39}?)(?=,| la | mut| taie|$)/)?.groups?.ref || null;
  return { atSec: Number.isFinite(atSec) ? atSec : null, op: g.op || g.op2 || (g.from ? "taie" : null), target, direction, clipRef: ref ? ref.trim() : null,
    toSec: g.to ? Number(g.to) : null };
}

function cleanTopic(text) {
  return String(text).replace(/\b(problema|misiunea|lucrul|treaba|task(ul)?|cu)\b/g, " ").replace(/\bdar\b.*$/, " ").replace(/\s+/g, " ").trim();
}

/** The free part of "pornește / reia misiunea …" without the words that describe its state or the moment. */
function cleanMissionRef(text) {
  const s = String(text || "").replace(/\b(?:pe care (?:am|ai|a|ati) (?:pus-o|oprit-o|intrerupt-o|lasat-o)(?: pe pauza)?|pusa pe pauza|de pe pauza|pe pauza|oprita|oprit|intrerupta|intrerupt|blocata|blocat|suspendata)\b/g, " ")
    .replace(/\b(?:acum|imediat|te rog|din nou)\b/g, " ").replace(/[,\s]+/g, " ").trim();
  return s.length >= 2 ? s : null;
}

/**
 * "de 30 de secunde", "de un minut", "despre ProDelivery", "de promovare", "din Promo" → { durationSec, topic, purpose?, about?, clipRef?,
 * forWhom? }; nothing is guessed. M10.2 (#29) keeps the kinds apart, because the content planner treats them differently:
 *  - clipRef ("din [clipul] Promo", "pentru clipul Promo") and about ("despre / cu tema …") NAME a clip: matched over every open clip and
 *    never replaced by another one ("Fă un clip din Promo" read no topic at all and planned the last clip the owner had opened);
 *  - purpose ("de promovare") and forWhom (a bare "pentru clienți": an audience as often as a title) only narrow the choice.
 * A platform tail ("pentru TikTok", "pe Reels") and generic sources ("din materialele importate") are not names. `topic` stays the
 * first of about / forWhom / purpose (its earlier meaning) for the callers that read it.
 */
function studioCreateArgs(m, clause) {
  const args = { durationSec: null, topic: null };
  const sec = clause.match(/\b(?<n>\d{1,4}|[a-z]+) (?:de )?(?:secunde|secunda|sec|s)\b/);
  const min = clause.match(/\b(?<n>\d{1,3}|[a-z]+) (?:de )?(?:minute|minut)\b/);
  if (sec && numberOf(sec.groups.n) != null) args.durationSec = numberOf(sec.groups.n);
  else if (min && numberOf(min.groups.n) != null) args.durationSec = numberOf(min.groups.n) * 60;
  const rest = clause.replace(/\b(?:de )?(?:\d{1,4}|[a-z]+) (?:de )?(?:secunde|secunda|sec|minute|minut)\b/g, " ").replace(/\s+/g, " ").trim();
  const PLATFORM = "tiktok|reels?|shorts|youtube|linkedin|instagram|facebook|vertical[a]?|verticale|orizontal[a]?";
  const nameOf = (s) => {
    const r = String(s || "")
      .replace(new RegExp(String.raw`\s*\b(?:pentru|pe|in format(?:ul)?|in) (?:${PLATFORM})\b.*$`), "") // "promo pentru tiktok" → "promo"
      .replace(/\s*\b(?:despre|pentru|cu tema|pe tema|cu subiectul|de promovare|de prezentare|de lansare)\b.*$/, "") // the next part of the sentence
      .replace(/\b(?:te rog|acum)\b/g, " ").replace(/\s+/g, " ").trim();
    if (r.length < 2 || new RegExp(String.raw`^(?:${PLATFORM})$`).test(r)) return null;
    if (/^(?:materialele|materiale|materialul|biblioteca|ce am|tot|toate|capturi(?:le)?|filmari(?:le)?|filmarea|inregistrari(?:le)?|inregistrarea|clipurile|fisierele|ele|el|ea|asta|acesta|aceasta)\b/.test(r)) return null;
    return r;
  };
  // M10.2.1: a clip's name may hold a dot inside a word ("Promo v2.1"), like a project's.
  const NAME = String.raw`[a-z0-9 -](?:[a-z0-9 -]|\.(?=[a-z0-9])){1,79}`;
  const named = rest.match(new RegExp(String.raw`\bdin (?:(?:clipul|videoclipul|montajul|proiectul|filmul) )?(?<r>${NAME})$`)) || rest.match(new RegExp(String.raw`\bpentru (?:clipul|videoclipul|montajul|proiectul) (?<r>${NAME})$`));
  const clipRef = named ? nameOf(named.groups.r) : null;
  const aboutM = rest.match(new RegExp(String.raw`\b(?:despre|cu tema|pe tema|cu subiectul) (?<t>${NAME})$`));
  const about = aboutM ? nameOf(aboutM.groups.t) : null;
  const forM = !named || !/^pentru /.test(named[0]) ? rest.match(new RegExp(String.raw`\bpentru (?<t>${NAME})$`)) : null;
  const forWhom = forM ? nameOf(forM.groups.t) : null;
  const kind = rest.match(/\bde (?<k>promovare|prezentare|lansare|reclama|marketing|demonstratie)\b/);
  if (clipRef) args.clipRef = clipRef;
  if (about) args.about = about;
  if (forWhom) args.forWhom = forWhom;
  if (kind) args.purpose = kind.groups.k;
  args.topic = about || forWhom || (kind ? kind.groups.k : null);
  return args;
}

const REFUSE_EXECUTE_REASON = "Nu rulez și nu instalez fișiere descărcate, programe de instalare sau scripturi dintr-o frază: pot conține orice. Dacă ai încredere în fișier, deschide-l tu; eu pot deschide doar aplicațiile autorizate.";

/**
 * M10.2.1 (D20): „Continuă?”, „Continui?”, „Pot să continui?” ask; they are not the owner's „Continuă”. Any question mark in the sentence
 * holds the resume (typed or spoken): ONE clarification, no effect. The forms below are the questions the resume grammar itself does not
 * read (the plain ones are ops_continue and are held the same way).
 */
const CONTINUE_ASK = /^(?:(?:pot|putem|poti|puteti|pot eu|as putea|am putea)(?: sa)? |sa )?(?:continua|continui|continuam|continuati|continuu)(?: (?:planul|acum|lucrul|mai departe))?$/;
export const CONTINUE_QUESTION = "Ai întrebat dacă să continui, așa că nu reiau nimic acum. Dacă vrei să reiau lucrul oprit, spune „Continuă” (fără semnul întrebării).";
/**
 * PF-08: the same hold when the question mark belongs to ANOTHER part of the sentence („Ce urmează? Continuă”, or a transcript that put
 * a „?” on a neighbouring clause): the owner did not ask whether to continue, so the answer does not say so. Nothing resumes either way.
 */
export const CONTINUE_MIXED_QUESTION = "Ai pus și o întrebare în aceeași frază; ca să reiau, spune „Continuă” singur.";

/** Constraints carried by a clause; they only narrow what the step may do. M10.2 adds the conjugated forms ("să nu pornești"). */
function constraintsOf(clause) {
  const c = {};
  if (/\bfara (deploy|publicare|productie)\b/.test(clause)) c.noDeploy = true;
  if (/\bfara (commit|push)\b/.test(clause)) c.noGit = true;
  if (/\bfara (mesaje|email|trimitere)\b/.test(clause)) c.noMessages = true;
  if (/\bnu (porni|pornesti|incepe|incepi|rula|rulezi|executa|executi|lansa|lansezi|confirma|confirmi)\b|\bnu (acum|inca)\b|\bsa nu (pornesti|incepi|rulezi|executi|lansezi|confirmi|pornim|incepem|executam|faci nimic)\b|\bdoar (arata|spune|explica|planul)\b|\bfara sa (pornesti|incepi|rulezi|executi|pornim)\b/.test(clause)) c.noStart = true;
  // Review M10.2 #24: with the unanchored hold now below the code requests, "Repară bug-ul de la login mai târziu" resolves to the
  // request — the delay must still remove the start (a preview-only plan, never an armed one). "care / ce / se așteaptă" describes.
  if (/\bmai tarziu\b|(?<!\b(?:care|ce|se|il|o|te|ma|ne|va|le) )\basteapta\b|\bnu inca\b/.test(clause)) c.noStart = true;
  if (/\bdoar (citire|citeste)\b|\bfara modificari\b/.test(clause)) c.readOnly = true;
  return c;
}

/**
 * First pattern that matches (with a retry where commas count as spaces, so "Hai la Factory Demo, A2" still reads its reference).
 * `skip` (2.12.2): intents not to consider (a clause that only mentions an interruption is read by the other patterns).
 */
function matchPattern(text, skip = null) {
  for (const candidate of text.includes(",") ? [text, text.replace(/\s*,\s*/g, " ").trim()] : [text]) {
    for (const [intent, re, argsOf] of P) {
      if (skip && skip.has(intent)) continue;
      const m = candidate.match(re);
      if (m) return { intent, args: argsOf ? argsOf(m, candidate) : {}, text: candidate };
    }
  }
  return null;
}

/** D4 review: what may stay outside an intent's own match when that intent still covers the whole clause („Deschide-mi Notepad-ul acum”). */
const COVER_FILLER = /^(?:(?:acum|imediat|repede|te rog|te rog frumos|va rog|din nou|inca o data|o data|-ul|-l|-o|ul|[,.!?;:])\s*)*$/;
/**
 * D4 review: whether `intent`'s own rule consumed the whole prepared clause `text` (a step's `text`) — only filler words outside its match.
 * „deschide notepad si spune-mi ce misiuni am” resolves to desktop_open alone (the rule matches „deschide notepad”), but its second request
 * is left over, so it is not covered. Pure; false when the rule does not match the clause at all.
 */
export function clauseCovered(intent, text) {
  const t = String(text || "").trim();
  if (!t) return false;
  for (const [i, re] of P) {
    if (i !== intent) continue;
    const m = t.match(re);
    if (!m) continue;
    const rest = `${t.slice(0, m.index)} ${t.slice(m.index + m[0].length)}`.replace(/\s+/g, " ").trim();
    if (COVER_FILLER.test(rest)) return true;
  }
  return false;
}

/** "deschide-l", "deschide din nou", "încă o dată": repeat the last target (only the server knows it; resolved in resolveRefs). */
const REOPEN = /^(?:deschide|redeschide|arata(?:-mi)?|adu|lanseaza|fa|repeta)(?:-mi)?(?:-l|-o|-le)?(?: (?:asta|acelasi lucru|la fel))?$/;

/**
 * Words that put a start, a plan or a confirmation under a condition the Hub cannot check by itself ("execută planul doar dacă
 * trec testele", "pornește după review", "dacă trec testele, execută planul"). The step is HELD and ONE question is asked: it never
 * falls through to another intent (live: "…dacă trec testele" read the tests) and the condition is never dropped.
 */
const COND_WORDS = "doar daca|numai daca|doar dupa|numai dupa|dupa ce|daca|cand|dupa";
const COND_TAIL = new RegExp(String.raw`^(?<head>.+?)[\s,]+(?<word>${COND_WORDS}) (?<cond>.+)$`);
const COND_LEAD = new RegExp(String.raw`^(?<word>${COND_WORDS}) (?<cond>[^,]+), (?<head>.+)$`);
// Review M10.2 #21: a code change or an analysis is a start too ("Repară bug-ul de login doar dacă trec testele" read the tests and
// dropped both the request and the condition; "… după review" planned with the condition only in free text).
const START_LIKE = new Set(["confirm", "show_plan", "continue_work", "start_mission", "resume_mission", "ops_continue", "objective_plan", "studio_create", "studio_variant", "ops_capture_vertical", "studio_import_here",
  "engineering_request", "analysis_request"]);
const START_VERB = /^(?:(?:ok|okay|hai|sigur|bine|da),? )*(?:executa|porneste|incepe|lanseaza|ruleaza|confirma|continua|reia|fa-l|fa-o|da drumul|repara|rezolva|corecteaza|implementeaza|refactorizeaza|adauga|scrie|analizeaza|revizuieste|evalueaza|investigheaza)\b/;
/** Review M10.2 #19: a clause that STARTS with a plan-start verb (after acknowledgements) — the same list show_plan's catch-all excludes. */
const PLAN_START = /^(?:(?:ok|okay|hai|sigur|bine|da),? )*(?:executa|porneste|incepe|lanseaza|ruleaza|confirma|confirm|fa-l|fa-o|da drumul)\b/;
/**
 * Review M10.2 #21: words that DESCRIBE rather than condition. A clip's bare „după / când / dacă” after a topic marker belongs to the
 * topic ("Fă un videoclip despre ce facem după lansare" was held with a condition question and no plan); a code request's condition
 * word inside a relative clause describes the bug ("Repară bug-ul care apare când apeși butonul", "… după ce te loghezi"); "de după
 * login" is a place. Only the explicit forms then hold the request ("doar dacă", "numai după"; for a clip also "după ce"), and a
 * leading condition ("Dacă trec testele, …") always does.
 */
const CLIP_INTENTS = new Set(["studio_create", "studio_variant"]);
const CODE_INTENTS = new Set(["engineering_request", "analysis_request"]);
const TOPIC_MARK = /\b(?:despre|pentru|cu tema|pe tema|cu subiectul)\b/;
const RELATIVE_MARK = /\b(?:care|ce|unde|cum|atunci)\b/;
const EXPLICIT_COND = { clip: /^(?<head>.+?)[\s,]+(?<word>doar daca|numai daca|doar dupa|numai dupa|dupa ce) (?<cond>.+)$/, code: /^(?<head>.+?)[\s,]+(?<word>doar daca|numai daca|doar dupa|numai dupa|doar cand|numai cand) (?<cond>.+)$/ };
function descriptiveCondition(intent, head, word) {
  const strong = /^(?:doar|numai) /.test(word);
  if (strong) return null;
  if (CLIP_INTENTS.has(intent) && word !== "dupa ce" && (TOPIC_MARK.test(head) || /\bde$/.test(head))) return "clip";
  if (CODE_INTENTS.has(intent) && (RELATIVE_MARK.test(head) || /\bde$/.test(head))) return "code";
  return null;
}
function conditionOf(text) {
  // M10.2.1: „după Stop All” names the suspension the rearm card is about, not a condition on a start.
  if (GATE_REARM.test(text)) return null;
  const lead = text.match(COND_LEAD);
  let m = lead || text.match(COND_TAIL);
  if (!m) return null;
  let head = m.groups.head.trim();
  let headMatch = matchPattern(head);
  const kind = !lead && headMatch ? descriptiveCondition(headMatch.intent, head, m.groups.word) : null;
  if (kind) {
    // The description stays part of the request; a later explicit condition in the same clause still holds it.
    const explicit = text.match(EXPLICIT_COND[kind]);
    if (!explicit) return null;
    m = explicit; head = explicit.groups.head.trim(); headMatch = matchPattern(head);
  }
  if (!(headMatch && START_LIKE.has(headMatch.intent)) && !START_VERB.test(head)) return null;
  // A code / analysis verb whose object the patterns do not know ("Implementează exportul după review") is still held as that request
  // (the question names what is waiting), never as a confirmation.
  const heldIntent = headMatch && START_LIKE.has(headMatch.intent) ? headMatch.intent
    : /^(?:(?:ok|okay|hai|sigur|bine|da),? )*(?:repara|rezolva|corecteaza|implementeaza|refactorizeaza|adauga|scrie)\b/.test(head) ? "engineering_request"
      : /^(?:(?:ok|okay|hai|sigur|bine|da),? )*(?:analizeaza|revizuieste|evalueaza|investigheaza)\b/.test(head) ? "analysis_request"
        : headMatch?.intent || "confirm";
  return { head, word: m.groups.word, condition: m.groups.cond.trim(), heldIntent };
}

/**
 * M10.2 chaining on " și " / ", ": only when BOTH halves resolve to a known intent and the right half starts with a command verb
 * ("Deschide Pro Delivery și arată-mi ce urmează" → two steps). Never inside a project or mission name that itself contains "și",
 * and never for sentences that are ONE request spanning both halves (capture + vertical variant, a timecode correction, a scenario).
 */
// 2.12.1 round 2: gate_rearm is anchored on the whole clause, so „După Stop All, deschide poarta” is ONE rearm request (split at the
// comma, its left half would be read as a Stop All).
const NEVER_SPLIT = new Set(["ops_capture_vertical", "studio_edit", "simulate", "reorder", "confirm", "not_yet", "reject_plan", "refuse_execute", "studio_publish", "quiet",
  "twin_impact", "twin_why", "objective_plan", "incident_open", "teach", "forget", "start_mission", "resume_mission", "studio_create", "gate_rearm"]);
/** A split never MANUFACTURES consent or authority: "Da, pornește misiunea" must not become "da" + a mission start. */
const NEVER_A_HALF = new Set(["confirm", "lega_start", "autonomy", "unfreeze_project", "ops_continue"]);
const RIGHT_VERB = /^(?:arata|deschide|porneste|continua|opreste|fa|pregateste|importa|treci|du-ma|mergi|adu|comuta|inregistreaza|spune|explica|reia|lanseaza|ruleaza|creeaza|genereaza|hai)\b/;
function splitClause(clause, context, depth = 0) {
  if (depth > 4) return [clause];
  const whole = matchPattern(prepClause(clause).text);
  if (whole && NEVER_SPLIT.has(whole.intent)) return [clause];
  // Character ranges covered by a known name with "și" in it ("Mobila și Deschide Ușa" is ONE project).
  const names = [...(context.projects || []).flatMap((p) => [p.name, p.slug]), ...(context.missions || []).map((m) => m.title)]
    .filter(Boolean).map((n) => normalize(n).replace(/[^a-z0-9 -]/g, " ").replace(/\s+/g, " ").trim()).filter((n) => /\b(?:si|dar|insa|ci)\b/.test(n));
  const guarded = [];
  for (const n of names) { let at = clause.indexOf(n); while (at >= 0) { guarded.push([at, at + n.length]); at = clause.indexOf(n, at + 1); } }
  // Review F1: a contrast word joins two requests like „și” („Repară testul de login, dar oprește tot” is the request AND the stop).
  for (const m of clause.matchAll(/\s*,\s*(?:(?:si|dar|insa|ci)\s+)?|\s+(?:si|dar|insa|ci)\s+/g)) {
    if (guarded.some(([a, b]) => m.index > a && m.index < b)) continue;
    const left = clause.slice(0, m.index).trim();
    const right = clause.slice(m.index + m[0].length).trim();
    if (!left || !right) continue;
    const r = prepClause(right).text;
    if (!RIGHT_VERB.test(r)) continue;
    const l = prepClause(left).text;
    const rm = matchPattern(r);
    // Review F1: words that only talk about the stop („Nu opri tot, oprește doar Codex”) are a half of their own next to an interruption.
    const lm = matchPattern(l) || (rm && INTERRUPT_INTENTS.has(rm.intent) && STOP_MENTION.test(l) ? { intent: "explain_stop", args: {} } : null);
    // 2.12.2 (P0-R2): an interruption is never split away from the condition, the report or the question that leads into it („Dacă pică
    // testele, oprește tot” was two clauses, the second a bare Stop All); the whole clause is judged by interruptMood.
    if (rm && INTERRUPT_INTENTS.has(rm.intent) && leadsIntoTalk(left)) continue;
    // Review F1: a request said under its own negation never becomes a step next to an interruption („Nu mai deschide ProDelivery, dar
    // oprește tot”): the whole clause is judged — the stop runs, the negated request does not.
    if (rm && INTERRUPT_INTENTS.has(rm.intent) && lm && negatedRequest(lm.intent, l)) continue;
    if (lm && rm && !NEVER_A_HALF.has(lm.intent) && !NEVER_A_HALF.has(rm.intent)) return [left, ...splitClause(right, context, depth + 1)];
  }
  return [clause];
}

/**
 * @param {string} text
 * @param {{ projects?: Array, currentProjectId?: string|null, missions?: Array, pendingEnvelopes?: Array, awaiting?: string|null, source?: string,
 *   lastTarget?: { kind: string, id?: string, label?: string }|null }} context
 *   `source`: "typed" | "voice-local" | "voice-provider" | "document". Only typed or locally verified voice may produce a
 *   confirmation; a provider transcript or document text never does. `lastTarget` (M10.2) is what the owner last opened or acted
 *   on; only the SERVER supplies it (from executed results), never a client's payload.
 *   Projects may carry `source` ("hub-test" ranks after a real project); missions may carry `status` / `kind`.
 */
export function resolveIntent(text, context = {}) {
  const raw = String(text || "").slice(0, 2000);
  const source = context.source || "typed";
  const LEGA_PREFIX = /^(hei |hey |buna )?lega[,!. ]+/;
  const full = normalize(raw);
  // M10.2: "Te rog, Lega, oprește tot" and "Lega, te rog, oprește tot" both reach the command. `addressed` = the sentence names Lega
  // (the same rule as on voice: a bare "stop" with her name stops; without it, it does not).
  const addressed = LEGA_PREFIX.test(full) || LEGA_PREFIX.test(stripFillers(full));
  let norm = stripFillers(stripFillers(full).replace(LEGA_PREFIX, ""));
  // 2.12.2 (P0-R2): a modal opening („Poți să oprești tot?”) the polite-word stripper removes below still makes the first clause a question.
  const modalLead = MODAL_ASK.test(softTrim(full.replace(/\u0001/g, " ").replace(LEGA_PREFIX, "")));
  const quotedParts = norm.split("\u0001").filter((_, i) => i % 2 === 1).join(" ");
  const quotedConfirm = /\b(da|confirm|confirma|executa|porneste)\b/.test(quotedParts);
  // P0-R2: a Stop named inside quotes is a quotation (answered below when nothing else in the sentence is understood), never the command.
  const quotedStop = STOP_MENTION.test(quotedParts);
  norm = unquote(norm);
  const steps = [];
  const forget = norm.match(FORGET);
  // An interruption always wins ("De acum oprește tot" stops; it is not a lesson), and a question is never a lesson (review M08).
  const afterPrefix = norm.replace(TEACH_PREFIX, "").replace(/^[\s,:;-]+/, "");
  // The interruption must BE the sentence (it starts it, no condition before it); a lesson that merely mentions one ("La deploy,
  // oprește tot dacă…") or a forget request stays a lesson (review M08 round 2).
  const interrupting = !forget && !/^(la|cand|daca|inainte de|dupa|in caz ca)\b/.test(afterPrefix)
    && P.some(([intent, re]) => ["stop_all", "pause", "mute", "stop_worker", "freeze_project", "takeover"].includes(intent) && (afterPrefix.match(re)?.index ?? 99) <= 1);
  const question = /\?\s*$/.test(String(raw).trim());
  // M10.2.1 (D20): any question mark (not only a final one) holds a resume: „Continuă? Te rog.” is still a question about resuming.
  const asked = /\?/.test(String(raw));
  if (interrupting) norm = afterPrefix;
  if (!interrupting && !question && (TEACH_PREFIX.test(norm) || TEACH_PROCEDURE.test(norm) || forget)) {
    const lesson = forget ? { intent: "forget", args: { ref: forget.groups.ref.trim() } } : { intent: "teach", args: { text: stripRawPrefix(raw) } };
    const inert = INERT_SOURCES.has(source);
    const refused = quotedConfirm ? [{ intent: "confirm", reason: "O confirmare între ghilimele este un citat, nu răspunsul tău; am ignorat-o" }] : [];
    if (inert) refused.push({ intent: lesson.intent, reason: INERT_REASON });
    return { utterance: raw, normalized: norm, source, quotedConfirm, clarification: null, refused,
      steps: [{ ...lesson, args: inert ? { ...lesson.args, inert: true } : lesson.args, constraints: {}, effect: inert ? "none" : INTENT_EFFECTS[lesson.intent], text: norm,
        effectClass: inert ? "REFUSED" : classOfIntent(lesson.intent, INTENT_EFFECTS[lesson.intent]) }] };
  }
  // PF-08: each part keeps whether it was itself a question (it ended with „?”), so the D20 hold below can say which part asked. The
  // parts are the same as before; only that flag is added.
  const pieces = norm.split(/(;|\. |!|\? | (?:si )?apoi | dupa aceea | dupa care | iar apoi )/);
  const clauses = [];
  for (let i = 0; i < pieces.length; i += 2) {
    const asks = pieces[i + 1] === "? " || /\?[.!?\s]*$/.test(pieces[i]);
    const part = pieces[i].replace(/[.,!?]+$/g, "").trim();
    if (!part) continue;
    // 2.12.2 review R2-F2: the „?” belongs to the chained clause it closes (the last one of the piece): „Oprește tot și arată-mi ce s-a
    // executat?” stops, then answers. The D20 resume hold below still reads the sentence-wide `asked`.
    const subs = splitClause(part, context).map((s) => s.replace(/[.,!?]+$/g, "").trim()).filter(Boolean);
    subs.forEach((text, j) => clauses.push({ text, asks: asks && j === subs.length - 1 }));
  }
  const askedSteps = new WeakSet();
  const globalConstraints = constraintsOf(norm);
  for (const [index, { text: clause, asks }] of clauses.entries()) {
    // P0-R2: the modal opening of the sentence belongs to its first clause; a later clause may carry its own („…, apoi poți să…”).
    const modal = (index === 0 && modalLead) || MODAL_ASK.test(softTrim(clause));
    const prep = prepClause(clause);
    const t = prep.text;
    const matchedConstraints = constraintsOf(t);
    // M10.2: a start / plan / confirmation under a condition is HELD (not_yet, no effect) with ONE question; see conditionOf.
    const cond = t ? conditionOf(t) : null;
    if (cond) {
      steps.push({ intent: "not_yet", args: { held: cond.heldIntent, condition: cond.condition, conditionWord: cond.word }, constraints: { ...matchedConstraints, conditional: true, noStart: true }, effect: "none", text: t });
      continue;
    }
    let found = null;
    // Typed "Lega, stop" = the same as on voice: a bare stop WITH her name stops everything; without it, it stays a plain word.
    // P0-R2: „Lega, stop?” asks — the hint, never the stop.
    if (addressed && clauses.length === 1 && /^(?:stop|opreste|opriti)(?: acum| imediat)?$/.test(t)) {
      found = asks || modal ? { intent: "explain_stop", args: { mood: "ask", about: "stop_all" } } : { intent: "stop_all", args: { addressed: true } };
    }
    // "Deschide-l", "Mai deschide-l o dată", "Încă o dată": the last target (resolved from the server's lastTarget in resolveRefs).
    if (!found && (((prep.refIt || prep.again) && REOPEN.test(t)) || (prep.again && !t))) found = { intent: "reopen_last", args: { ref: "it" } };
    if (!found && t) { const m = matchPattern(t); if (m) found = { intent: m.intent, args: m.args }; }
    // P0-R6 (L11): „Treci pe live” names a project when one is called exactly so; otherwise it is the mode, answered (explain_mode).
    if (found?.intent === "explain_mode" && (context.projects || []).some((p) => flatName(p.name) === flatName(found.args.target) || flatName(p.slug) === flatName(found.args.target))) {
      found = { intent: "open_project", args: { projectRef: found.args.target } };
    }
    // 2.12.2 (P0-R2): an interruption runs only on a clear imperative; a clause that only talks about one becomes explain_stop. The rearm
    // card (D21: „Redeschide poarta după Stop All” before any stop), the last-target repeat and the addressed bare stop keep their rules.
    // R2-F3: whether the clause's first verb was indicative („Oprești tot, da?”) before prepClause made it the imperative.
    const conjugated = CONJUGATED_INTERRUPT.test(softTrim(stripFillers(clause)));
    if (t && !(found && (found.intent === "gate_rearm" || found.intent === "reopen_last" || found.args?.addressed))) found = imperativeOnly(found, t, { asks, modal, conjugated });
    // R2-F6: a negated stop next to a request keeps the request and answers the negation as a second read („Bine, nu opresc nimic.”).
    const alsoExplain = found?.alsoExplain || null;
    if (alsoExplain) found = { intent: found.intent, args: found.args };
    // Review M10.2 #19: a start verb on "planul" that is not a clean confirmation ("Ok, execută planul, fără deploy", "Pornește planul
    // de marketing") is ONE question about the plan on screen — never show_plan's new card, never a silent nothing.
    if (!found && t && PLAN_START.test(t) && /\bplanul\b/.test(t)) found = { intent: "unknown", args: { planStartUnclear: true } };
    if (found && prep.again) found.args = { ...found.args, again: true };
    if (!t && !found) continue;
    // A clause that is only a constraint ("dar fără deploy") attaches to the previous step instead of being a step itself.
    if (!found && Object.keys(matchedConstraints).length && steps.length) { Object.assign(steps[steps.length - 1].constraints, matchedConstraints); continue; }
    if (!found) found = { intent: "unknown", args: {} };
    const step = { intent: found.intent, args: found.args, constraints: { ...matchedConstraints }, effect: INTENT_EFFECTS[found.intent] || "none", text: t };
    if (asks) askedSteps.add(step);
    steps.push(step);
    if (alsoExplain) steps.push({ intent: "explain_stop", args: { ...alsoExplain }, constraints: {}, effect: INTENT_EFFECTS.explain_stop, text: t });
  }
  // D2: a transcript that wrote the acknowledgement as its own sentence („Ok. Fă acel videoclip de promovare.”) — the lone „Ok.” next to
  // one of the anchored requests is not a step. Only then: „Ok. Continuă.” and „Ok. Oprește tot.” keep their steps (the one-clause resume
  // rule reads them), and a confirmation in the same sentence is still refused (the request step stays).
  if (steps.length > 1 && steps.some((s) => ACK_REQUESTS.has(s.intent) || ACK_REQUESTS.has(s.args?.held))) {
    for (let i = steps.length - 1; i >= 0; i--) if (steps[i].intent === "unknown" && ACK_ONLY.test(String(steps[i].text || ""))) steps.splice(i, 1);
  }
  if (!steps.length) steps.push({ intent: "unknown", args: {}, constraints: {}, effect: "none", text: "" });
  // Review F1: „…, nu opri tot, oprește doar Codex” — next to a narrower stop the Hub runs, the negated Stop All is answered „nu opresc tot”.
  if (steps.some((s) => INTERRUPT_INTENTS.has(s.intent) && s.intent !== "stop_all")) {
    for (const s of steps) if (s.intent === "explain_stop" && s.args?.mood === "negation" && s.args?.about === "stop_all") s.args = { ...s.args, partial: true };
  }
  // P0-R2: „Am zis „Oprește tot” din greșeală”, „„Oprește tot””, „Ce face „Stop All”?” — the quoted words were removed above, so nothing
  // stops; when nothing else in the sentence is understood, the Hub answers what the quotation was about (one read, no question).
  if (quotedStop && steps.every((s) => s.intent === "unknown" && !s.args?.refusedConfirmation)) {
    const rest = softTrim(norm);
    const mood = REPORTED.test(rest) ? "reported" : asked || ASK_START.test(rest) || /\bce (?:face|inseamna)\b/.test(rest) ? "question" : "quote";
    steps.splice(0, steps.length, { intent: "explain_stop", args: { mood, about: "stop_all" }, constraints: {}, effect: INTENT_EFFECTS.explain_stop, text: rest });
  }
  // A decrease anywhere in the sentence ("…luăm doi clienți, apoi pierdem unul") makes every scenario step a question, not numbers.
  if (SCENARIO_DECREASE.test(norm)) for (const s of steps) if (s.intent === "simulate") s.args = { scenario: s.args.scenario, unsupported: true };
  for (const step of steps) Object.assign(step.constraints, globalConstraints);

  const out = { utterance: raw, normalized: norm, source, quotedConfirm, steps: [], clarification: null, refused: [] };
  if (quotedConfirm) out.refused.push({ intent: "confirm", reason: "O confirmare între ghilimele este un citat, nu răspunsul tău; am ignorat-o" });
  // Review M10.2 #17: a confirmation is clean only when EVERY step of the sentence is one ("Da. Execută planul."). "Fă un videoclip …,
  // apoi execută planul" or "Repară bug-ul de login. Da, execută planul" bound the yes to the plan that waited BEFORE the sentence and
  // started that work with consent meant for the new request. The rule is decided here, before checkConfirmation binds any plan, so
  // typed text, the intake and the voice path (claimForConfirmation's clean check) all follow it.
  const mixedConfirm = steps.some((s) => s.intent === "confirm") && steps.some((s) => s.intent !== "confirm");
  for (const step of steps) {
    // A held condition asks ONE question (the first one wins; a second condition in the same sentence adds no second question).
    if (step.constraints.conditional && !out.clarification) {
      out.clarification = { question: "Ai pus o condiție pe care nu o verific singur, așa că nu pornesc nimic acum. Spune-mi când e îndeplinită sau cere „Arată-mi planul” ca să-l vezi.", options: [], forIntent: step.args.held || "confirm" };
    }
    // M10.2.1 (D20): a resume asked as a question is held with ONE clarification (never ops_continue, from any source). PF-08: any „?”
    // in the sentence still holds it; the answer says the owner asked about continuing only when THIS part was the question.
    if (asked && (step.intent === "ops_continue" || (step.intent === "unknown" && !step.args.refusedConfirmation && CONTINUE_ASK.test(String(step.text || ""))))) {
      step.intent = "unknown"; step.effect = "none"; step.args = { continueQuestion: true };
      if (!out.clarification) out.clarification = { question: askedSteps.has(step) ? CONTINUE_QUESTION : CONTINUE_MIXED_QUESTION, options: [], forIntent: "ops_continue" };
    }
    const resolved = resolveRefs(step, context);
    if (resolved.clarification && !out.clarification) out.clarification = resolved.clarification;
    // Negations remove effects: "nu porni" / "doar arată" turn a plan or a confirmation into a preview only.
    if (step.constraints.noStart && ["confirm", "continue_work", "start_mission", "resume_mission", "studio_create", "engineering_request", "analysis_request"].includes(step.intent)) {
      if (step.intent === "confirm") { out.refused.push({ intent: "confirm", reason: "Ai spus să nu pornească nimic" }); step.intent = "not_yet"; step.effect = "none"; }
      else step.args.previewOnly = true;
    }
    if (step.intent === "refuse_execute") out.refused.push({ intent: "refuse_execute", reason: REFUSE_EXECUTE_REASON });
    if (step.intent === "confirm" && mixedConfirm) {
      const reason = "Confirmă separat planul afișat; în aceeași frază ai cerut și altceva";
      if (!out.refused.some((r) => r.intent === "confirm" && r.reason === reason)) out.refused.push({ intent: "confirm", reason });
      step.intent = "unknown"; step.effect = "none"; step.args = { refusedConfirmation: reason };
    }
    if (step.intent === "unknown" && step.args.planStartUnclear && !out.clarification) {
      out.clarification = { question: "Vrei să execut planul afișat? Spune „Da, execută planul” sau „Nu acum”.", options: [], forIntent: "confirm" };
    }
    if (step.intent === "confirm") {
      const confirm = checkConfirmation(context, source, { question });
      if (!confirm.ok) {
        out.refused.push({ intent: "confirm", reason: confirm.reason });
        if (confirm.clarification && !out.clarification) out.clarification = confirm.clarification;
        step.intent = "unknown"; step.effect = "none"; step.args = { refusedConfirmation: confirm.reason };
      } else step.args.envelopeId = confirm.envelopeId;
    }
    if (step.intent === "unknown" && !step.args.refusedConfirmation && step.text) {
      const flat = (v) => normalize(v).replace(/[^a-z0-9]/g, "");
      const dept = (context.departments || []).find((d) => flat(d.name) === flat(step.text) || flat(d.key) === flat(step.text));
      const exact = dept ? [] : (context.projects || []).filter((p) => flat(p.name) === flat(step.text) || flat(p.slug) === flat(step.text));
      if (dept) { step.intent = "zoom"; step.effect = "navigate"; step.args = { departmentKey: dept.key }; }
      else if (exact.length === 1) { step.intent = "open_project"; step.effect = "navigate"; step.args = { projectId: exact[0].id, projectRef: step.text }; }
    }
    // Text from a document or a media transcript (a clip's own words: "publică", "oprește tot", "mută la secunda 12") is content,
    // never a command: every step is kept for display but inert.
    if (INERT_SOURCES.has(source) && step.effect !== "none" && step.effect !== "read") {
      if (!out.refused.some((r) => r.reason === INERT_REASON)) out.refused.push({ intent: step.intent, reason: INERT_REASON });
      step.args = { ...step.args, inert: true, originalEffect: step.effect };
      step.effect = "none";
    }
    // M10.2: the step's class for the one command path (policy/effect-class.mjs), from its FINAL effect; content turned inert is
    // refused as a command (it is kept only for display).
    step.effectClass = step.args.inert ? "REFUSED" : classOfIntent(step.intent, step.effect);
    out.steps.push(step);
  }
  return out;
}

/** Sources whose words are content, not the owner's instructions (a pasted document, a local transcript of a media file). */
const INERT_SOURCES = new Set(["document", "media-local"]);
const INERT_REASON = "Textul vine dintr-un document sau dintr-o transcriere media: e conținut, nu o comandă de la tine";

/**
 * The project a code / analysis request names after a preposition (review M10.2 #5), or null. Every "din|pe|la|pentru (proiectul)"
 * and "proiectului" in the clause is tried; after each, the longest leading run of words whose best project covers every word
 * (≥ 72) wins, with the candidates within 15 points (an exact name alone, as in matchRef). The strongest reference in the clause
 * wins; on a tie, the later one (the project usually closes the sentence: "… de la login din ProDelivery").
 */
// 2.13.1 (L5 pilot, 2026-10-07): „Repară validarea în Factory Demo L5: …” — „în” names the project too (it drafted on the cockpit's
// project instead). Safe for „în cod” / „în formular”: a run counts only when a project's name covers every word (≥ 72).
const PROJECT_TAIL = /\b(?:(?:din|in|pe|la|pentru) (?:proiectul )?|proiectului )/g;
/**
 * D3: a preview request names its project right after the word as well („Rulează preview-ul Pro Delivery”, „… preview-ul de la X”), or
 * after the same prepositions. Global (matchAll), like PROJECT_TAIL. The preposition ends on a word boundary („pe” is never the start
 * of „pentru”).
 */
const PREVIEW_TAIL = /\b(?:preview(?:-?(?:ului|ul|urile|uri))?|previzualizare(?:a|ii)?)\b(?: (?:de la|de pe|din|pentru|pe|la|al|lui)\b)?(?: proiectul(?:ui)?\b)?|\b(?:(?:din|pe|la|pentru) (?:proiectul )?|proiectului )/g;
function namedProjectOf(clause, projects, tail = PROJECT_TAIL) {
  const opts = { extra: (p) => [p.slug] };
  let best = null;
  let numbered = null;
  for (const m of clause.matchAll(tail)) {
    const words = clause.slice(m.index + m[0].length).trim().split(/\s+/).filter(Boolean).slice(0, 8);
    for (let n = words.length; n >= 1; n--) {
      const ref = words.slice(0, n).join(" ");
      const ranked = rankRef(ref, projects, opts);
      if (!ranked.length || ranked[0].score < 72) continue;
      // 2.12.1 round 2 (PF-02): the word right after the run carries a digit or a dot, or is a lone letter („din Factory Demo M10.3” →
      // „factory demo” + „m10.3”): it is part of the name the owner said, so this tail names no existing project — never a shorter one
      // (Factory Demo A matched „factory demo” exactly, „a” being a stop word). The request then gets ONE question, not another project's plan.
      if (n < words.length && isNamePart(words[n].replace(/[,;:!?]+$/, ""))) { numbered = numbered || words.slice(0, n + 1).join(" ").replace(/[.,;:!?]+$/, ""); break; }
      const top = ranked[0].score;
      const matches = ranked.filter((x) => (top === 100 ? x.score === 100 : x.score >= top - 15)).map((x) => x.item);
      if (!best || top >= best.score) best = { ref, score: top, matches };
      break;
    }
  }
  if (best || !numbered) return best;
  return { ref: numbered, score: 0, matches: [], unknown: true, candidates: matchRef(numbered, projects, opts) };
}

/**
 * PF-02: a word with a digit or a dot inside („m10.3”, „m11”, „v2.1”), or a lone consonant („Factory Demo C”; the Romanian one-letter
 * words are vowels), is part of a name, never a filler to drop.
 */
const NAME_PART = /\d|[a-z0-9]\.[a-z0-9]/;
const isNamePart = (word) => NAME_PART.test(String(word || "")) || /^[b-df-hj-np-tv-z]$/.test(String(word || ""));
/** The parts of a name or reference that carry a digit, split at spaces, dots and hyphens („Factory Demo M10.2” → m10, 2). */
const numberedParts = (s) => normalize(s).split(/[^a-z0-9]+/).filter((w) => /\d/.test(w));
/**
 * PF-02: whether the reference names a numbered part the candidate does not have („m10.3” against „Factory Demo M10.2”: the 3). A bare
 * number also counts as present when it closes a letters-only part of the name („Demo A 2” against „Factory Demo A2”). A shorter
 * reference („Factory Demo M10” for „Factory Demo M10.2”) names nothing the candidate lacks.
 */
function missingNumberedPart(ref, item, { extra = () => [] } = {}) {
  const want = numberedParts(ref);
  if (!want.length) return false;
  const have = [item?.name, ...extra(item)].filter(Boolean).flatMap(numberedParts);
  return want.some((w) => !have.some((h) => h === w || (/^\d+$/.test(w) && h.endsWith(w) && /^[a-z]+$/.test(h.slice(0, -w.length)))));
}

function resolveRefs(step, context) {
  const projects = context.projects || [];
  // P0-R6 (L11): „Ce a rămas în ProDelivery?” (status) names its project like „Hai la ProDelivery” — the same matching, diacritics and
  // hyphens ignored („pro-delivery”), one question for two plausible names, unknownRef for none.
  const needsProject = ["open_project", "freeze_project", "unfreeze_project"].includes(step.intent) || ((step.intent === "autonomy" || step.intent === "status") && step.args.projectRef);
  if (needsProject) {
    const ref = step.args.projectRef;
    const opts = { extra: (p) => [p.slug] };
    const ranked0 = ref ? rankRef(ref, projects, opts) : [];
    let matches = ref ? matchRef(ref, projects, opts) : [];
    // M10.2: the greedy tail ("prodelivery acum …") — when the whole tail names no project clearly, the LONGEST leading run of words
    // that names exactly one project (near-exact, nothing else within 15 points) wins, and the rest is kept (`rest`) instead of
    // turning the tail into an unknown name or a needless question.
    // 2.12.1 round 2 (PF-02): when the word right after such a run carries a digit or a dot („m10.3”, „m11”, „v2.1”) or is a lone
    // letter („c”), it is part of the NAME the owner said: the split is refused, and no shorter run is tried (it would drop that name
    // too). „Hai la Factory Demo M10.3” (a typo, or a project that does not exist yet) no longer opens Factory Demo A because „factory
    // demo” alone matched it („a” is a stop word); it stays unknown or ONE question (below). A number further on in a rest that starts
    // with ordinary words („Hai la ProDelivery să vedem cele 2 bug-uri”) still keeps the project.
    let greedy = false;
    if (step.intent === "open_project" && ref && (!ranked0.length || ranked0[0].score < 90)) {
      const words = String(ref).trim().split(/\s+/);
      for (let n = words.length - 1; n >= 1; n--) {
        const ranked = rankRef(words.slice(0, n).join(" "), projects, opts);
        if (ranked.length && ranked[0].score >= 90 && !(ranked[1] && ranked[1].score >= ranked[0].score - 15)) {
          if (isNamePart(words[n])) break;
          matches = [ranked[0].item]; step.args.rest = words.slice(n).join(" "); greedy = true; break;
        }
      }
    }
    // PF-02: a partial match that lacks a numbered part of the reference („Factory Demo M10.3” when only „Factory Demo M10.2” or
    // „Factory Demo M10” exists) is a different name, never opened silently: ONE question naming what was not found, the near names as
    // options.
    const unnumbered = !greedy && ref && matches.length && !(ranked0[0]?.score >= 90) && matches.every((p) => missingNumberedPart(ref, p, opts));
    if (unnumbered) {
      const options = matches.slice(0, 4).map((p) => ({ id: p.id, label: p.name }));
      return { clarification: { question: `Nu găsesc proiectul „${String(ref).trim()}”. Te referi la ${options.map((o) => o.label).join(" sau ")}?`, options, forIntent: step.intent } };
    }
    if (matches.length === 1) step.args.projectId = matches[0].id;
    else if (matches.length > 1) return { clarification: { question: `La care proiect te referi: ${matches.slice(0, 4).map((p) => p.name).join(" sau ")}?`, options: matches.slice(0, 4).map((p) => ({ id: p.id, label: p.name })), forIntent: step.intent } };
    else if (ref) step.args.unknownRef = ref;
  }
  if (step.intent === "autonomy" && !step.args.projectId) step.args.projectId = context.currentProjectId || null;
  if (step.intent === "freeze_project" && !step.args.projectId && /^(proiectul|tot proiectul|asta|acesta)$/.test(String(step.args.projectRef || "").trim())) step.args.projectId = context.currentProjectId || null;
  const projectMissions = () => (context.missions || []).filter((m) => !context.currentProjectId || m.projectId === context.currentProjectId);
  const missionQuestion = (matches, forIntent) => ({ clarification: { question: `Care misiune: ${matches.slice(0, 4).map((m) => `„${m.title}”`).join(" sau ")}?`, options: matches.slice(0, 4).map((m) => ({ id: m.id, label: m.title })), forIntent } });
  if (step.intent === "continue_work" && step.args.topic) {
    const matches = matchRef(step.args.topic, projectMissions(), { name: (m) => m.title, stop: MISSION_STOP_WORDS });
    if (matches.length === 1) step.args.missionId = matches[0].id;
    else if (matches.length > 1) return missionQuestion(matches, "continue_work");
  }
  // M10.2 mission start / resume: by name; "pornește-o" by the server's last target; otherwise the ONE mission in the state the
  // request fits (only when the caller supplied states — nothing is guessed from a title). The handler checks the state again.
  if (step.intent === "start_mission" || step.intent === "resume_mission") {
    const list = projectMissions();
    if (step.args.missionRef) {
      const matches = matchRef(step.args.missionRef, list, { name: (m) => m.title, stop: MISSION_STOP_WORDS });
      if (matches.length === 1) step.args.missionId = matches[0].id;
      else if (matches.length > 1) return missionQuestion(matches, step.intent);
      else step.args.unknownRef = step.args.missionRef;
    } else {
      const fits = step.intent === "start_mission" ? /^(DRAFT|SPEC_DRAFT|PLAN_READY|PLANNED|READY)$/ : /^(PAUSED|BLOCKED|WAITING_OWNER|STOPPED|SUSPENDED|INTERRUPTED)$/;
      const candidates = list.filter((m) => m.status && fits.test(String(m.status).toUpperCase()));
      if (step.args.ref === "it") {
        // Review M10.2 #25: "Pornește-o" / "Reia-o" names the last target. Only a MISSION recorded by the server answers it; after a
        // clip, an app or a plan the pronoun is not a mission, so it is ONE question (the fitting missions as options), never the
        // silent single-candidate pick below (it proposed an unrelated mission and superseded the card on its project).
        if (context.lastTarget?.kind === "mission" && context.lastTarget.id) step.args.missionId = context.lastTarget.id;
        else return { clarification: { question: step.intent === "start_mission" ? "Ce misiune să pornesc?" : "Ce misiune să reiau?",
          options: candidates.slice(0, 4).map((m) => ({ id: m.id, label: m.title })), forIntent: step.intent } };
      } else if (candidates.length === 1) step.args.missionId = candidates[0].id;
      else if (candidates.length > 1) return missionQuestion(candidates, step.intent);
    }
  }
  // Review M10.2 #5: "Repară testul X din Factory Demo A2" names its project; the planner used only the cockpit's project (by voice:
  // none, so "Pe ce proiect lucrez?" after the owner had just said it). A trailing "din / pe / la / pentru (proiectul) <nume>" or
  // "proiectului <nume>" is ranked like open_project (the longest leading run of words that names a project). The tail may just as
  // well be a place in the code ("din pagina de login", "de la login"), so only a match that covers every word of the reference
  // counts (score ≥ 72): one → projectId, several → the usual ONE question; anything weaker leaves the request to the planner.
  if ((step.intent === "engineering_request" || step.intent === "analysis_request") && projects.length) {
    const named = namedProjectOf(String(step.args.request || step.text || ""), projects);
    // PF-02: a numbered name no project has („din Factory Demo M10.3”) → ONE question (the nearest names as options), never another
    // project's plan and never the cockpit's project by default (the intake stands on this question).
    if (named?.unknown) {
      const options = named.candidates.slice(0, 4).map((p) => ({ id: p.id, label: p.name }));
      return { clarification: { question: `Nu găsesc proiectul „${named.ref}”. ${options.length ? `Te referi la ${options.map((o) => o.label).join(" sau ")}?` : "Pe ce proiect lucrez?"}`, options, forIntent: step.intent } };
    }
    if (named?.matches.length === 1) { step.args.projectId = named.matches[0].id; step.args.projectRef = named.ref; }
    else if (named?.matches.length > 1) return { clarification: { question: `La care proiect te referi: ${named.matches.slice(0, 4).map((p) => p.name).join(" sau ")}?`, options: named.matches.slice(0, 4).map((p) => ({ id: p.id, label: p.name })), forIntent: step.intent } };
  }
  // D3: „Rulează preview-ul Pro Delivery” names its project (live, the words were dropped and the agent planned an analysis instead). The
  // same rules as the code requests above: only a reference whose every word is covered counts; one → projectId, several → ONE question.
  if (step.intent === "show_preview" && projects.length) {
    const named = namedProjectOf(String(step.text || ""), projects, PREVIEW_TAIL);
    if (named?.unknown) {
      const options = named.candidates.slice(0, 4).map((p) => ({ id: p.id, label: p.name }));
      return { clarification: { question: `Nu găsesc proiectul „${named.ref}”. ${options.length ? `Te referi la ${options.map((o) => o.label).join(" sau ")}?` : "Pe ce proiect să-ți arăt preview-ul?"}`, options, forIntent: "show_preview" } };
    }
    if (named?.matches.length === 1) { step.args.projectId = named.matches[0].id; step.args.projectRef = named.ref; }
    else if (named?.matches.length > 1) return { clarification: { question: `La care proiect te referi: ${named.matches.slice(0, 4).map((p) => p.name).join(" sau ")}?`, options: named.matches.slice(0, 4).map((p) => ({ id: p.id, label: p.name })), forIntent: "show_preview" } };
  }
  // "Deschide-l din nou": only the server's record of the last target answers it; with none, ONE question and nothing done.
  if (step.intent === "reopen_last") {
    const last = context.lastTarget && typeof context.lastTarget === "object" && context.lastTarget.kind ? context.lastTarget : null;
    if (!last) { step.effect = "none"; return { clarification: { question: "Ce să deschid din nou? Spune-mi numele (aplicația, proiectul sau clipul).", options: [], forIntent: "reopen_last" } }; }
    step.args.target = { kind: String(last.kind), id: last.id ?? null, label: last.label ?? null, ...(last.app ? { app: last.app } : {}) };
    // An app is a local action (the stricter class); a project, a clip, a screen, a plan or a mission only navigates.
    step.effect = ["project", "clip", "screen", "plan", "mission"].includes(String(last.kind)) ? "navigate" : "local";
  }
  return {};
}

/**
 * A "yes" is consent only for one presented plan, from the owner's own input (typed in the session, or voice verified
 * locally), while the cockpit waits for exactly that answer. A question ("Da?") is never an answer — typed or spoken (the voice
 * path refuses it too, owner/voice.mjs claimForConfirmation).
 */
function checkConfirmation(context, source, { question = false } = {}) {
  if (!["typed", "voice-local"].includes(source)) return { ok: false, reason: source === "voice-provider" ? "O transcriere făcută de provider nu poate confirma; confirmă în cockpit (tastă sau buton) sau cu verificarea locală a vocii" : "Textul nu vine de la tine în sesiune (document, unealtă sau pagină)" };
  if (question) return { ok: false, reason: "Ai pus o întrebare, nu ai confirmat; spune „Da, execută planul” dacă vrei să pornească" };
  const pending = context.pendingEnvelopes || [];
  if (context.awaiting !== "envelope_confirmation" && pending.length !== 1) return { ok: false, reason: "Nu aștept acum o confirmare (întrebarea anterioară nu era despre un plan)" };
  if (pending.length === 0) return { ok: false, reason: "Niciun plan nu așteaptă confirmarea" };
  if (pending.length > 1) return { ok: false, reason: "Sunt mai multe planuri în așteptare", clarification: { question: `Care plan: ${pending.slice(0, 4).map((e) => `„${e.title}”`).join(" sau ")}?`, options: pending.slice(0, 4).map((e) => ({ id: e.id, label: e.title })), forIntent: "confirm" } };
  if (context.awaiting !== "envelope_confirmation") return { ok: false, reason: "Planul nu a fost prezentat în această conversație; deschide-l și confirmă-l acolo" };
  return { ok: true, envelopeId: pending[0].id };
}
