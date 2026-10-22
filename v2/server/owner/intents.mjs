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
import { correctTypos, addKnownWords } from "./typos.mjs";

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
  // M11 „Ifrim Delivery”: preparing a demo for a presentation (engineering + capture + clip + commercial summary) is ONE plan card; a
  // change to what was delivered is a plan too (a clip revision card, a summary version, or the difference of a software change);
  // „Arată-mi ce ai pregătit” / „Deciziile mele” only open the Delivery Room.
  delivery_prepare: "plan", delivery_revise: "plan", delivery_open: "navigate", delivery_status: "read", delivery_decisions: "navigate",
  // M10.2.1 (D14): „Redeschide poarta” / „Rearmează Hub-ul” only shows the rearm card in the cockpit (navigation); reopening the gate
  // is its own owner-session command (fresh authenticator, bound to the exact suspension), never a sentence.
  gate_rearm: "navigate",
  // 2.12.2 (P0-R2): words that only TALK about an interruption (a question, a negation, a condition, reported speech, a quotation) — a
  // read the Hub answers with the matching sentence; nothing is stopped, paused or taken over.
  explain_stop: "read",
  // 2.12.2 (P0-R6, L11): a request to change the Hub's mode by voice or text — answered (modeAnswer), never done: nothing is written.
  explain_mode: "none",
  // Stage before M12: a question about the system itself (installed apps, accounts, what the Hub can do, where results are, what Codex
  // produced, what Claude found, what is blocked) — answered from the Hub's real state (owner/knowledge.mjs); nothing runs.
  system_knowledge: "read",
  // M12 Sales (S-07, T-S3): preparing an offer is ONE plan card (owner/planners/sales.mjs); showing it navigates to the opportunity; „ce
  // lipsește?” and „aprobă oferta” are reads the Hub answers (the approval stays the owner's own decision, in Vânzări); sending,
  // contacting or publishing is never done from a sentence (REFUSED with OUTREACH_DISABLED, policy/effect-class.mjs).
  sales_prepare: "plan", sales_show: "navigate", sales_missing: "read", sales_approve_talk: "read", sales_send: "none",
  // M12 final review: „Continuă pregătirea ofertei” proposes ONE continuation card (the owner confirms it); nothing resumes from a sentence.
  sales_continue: "plan",
  // M13 „Birou intern”: the start dossier of a project, a support case and the deviz from the approved offer — ONE card each
  // (owner/planners/desk.mjs); the approval of a reply or a deviz stays the owner's own decision, on the exact text, in the L3ga screen.
  desk_ops_prepare: "plan", desk_support_prepare: "plan", desk_finance_prepare: "plan",
  // M14: „Arată dosarul de pornire OPS-0001”, „Arată cazul de suport SUP-0001”, „Arată devizul DVZ-0001” (or the number alone) — the
  // EXISTING record, opened in the L3ga screen with its state and next action; it never creates a record, a plan or a document.
  desk_show: "read",
});

// ---------------------------------------------------------------- M12 Sales: sending, contacting and publishing are refused
/**
 * What the Hub says to „trimite oferta”, „contactează-i”, „publică oferta” (any source: typed, spoken, Lega's tools, a plan). The token
 * OUTREACH_DISABLED is the same code the Sales service refuses a send with (sales.mjs); nothing leaves the computer in M12.
 */
export const SALES_SEND_REASON = "OUTREACH_DISABLED: în M12 nu trimit nimic, nu contactez pe nimeni și nu public nimic. Trimiterea reală e dezactivată (pregătesc doar ciorne locale); activarea ei ar cere configurarea canalului și o autorizare separată a ta. Pot pregăti oferta și ciorna netrimisă („pregătește o ofertă pentru …”); contactul îl faci tu, în afara Hub-ului, și îl înregistrezi manual în Vânzări.";
/**
 * The Sales vocabulary that scopes a send / publish verb („trimite oferta”, „trimite-o clientului”, „publică oferta”). A send verb with none
 * of these words in the sentence keeps its earlier meaning („Trimite un mesaj de probă” still reaches the planner, P0R5-04). Normalized.
 */
export const SALES_SCOPE = /\b(?:ofert(?:a|e|ele|ei|elor)|propuner(?:e|ea|i|ile|ii)|ciorn(?:a|e|ele|ei)|deviz(?:ul)?|cotati(?:a|e|ile)|client(?:ul|ului|a|ei|ii|i|ilor)?|firm(?:a|ei|ele|elor)|service(?:-ul|ul|-ului|ului)?|prospect(?:ul|ului|i|ii|ilor)?|lead(?:-ul|ul|-uri|uri|-urile|urile|-urilor|urilor)?|oportunitat(?:ea|ii|ile)|vanzari)\b/;
/** A publish verb is the Sales one only with the offer itself („publică oferta”); a clip for a client keeps the Studio's own rule (MEDIA_C). */
const OFFER_SCOPE = /\b(?:ofert(?:a|e|ele|ei|elor)|propuner(?:e|ea|i|ile|ii)|ciorn(?:a|e|ele|ei)|deviz(?:ul)?|cotati(?:a|e|ile))\b/;
/** One slip of a word: a letter dropped, two neighbours swapped or a letter doubled (never a substitution: too close to other words). */
function slipsOf(word) {
  const out = new Set();
  for (let i = 0; i < word.length; i += 1) {
    out.add(word.slice(0, i) + word.slice(i + 1));
    out.add(word.slice(0, i) + word[i] + word.slice(i));
    if (i + 1 < word.length) out.add(word.slice(0, i) + word[i + 1] + word[i] + word.slice(i + 2));
  }
  out.delete(word);
  return [...out];
}
/** Real words one slip away from an outreach verb (nouns, adjectives, participles): never read as that verb („public țintă”, „trimis”). */
const OUTREACH_BENIGN = new Set(["public", "publice", "publicat", "publicul", "trimis", "trimise", "trimisa", "contact", "contacte", "contactat", "contactate", "postat", "postare", "poster",
  "transmis", "transmisa", "transmise", "postari", "posta", "postez", "trimit", "publici"]);
/*
 * M12 last fix round (FIXES_LAST, L1–L4) — the outreach verbs by STEM: every person, mood and tense of a stem is read (a list of single forms
 * never converged), with one slip of the main forms. Each ending says what the form can be: „imp” (2nd person imperative — also the 3rd
 * person singular and the infinitive), „second” (you), „first” (we), „self” (I — the owner's own statement), „third” (a 3rd person
 * subjunctive). A family says which object makes the verb an outreach: send (an offer, a client, a message with the Sales vocabulary),
 * contact (always), call („sună” — a person), write („scrie” — only TO someone), put („pune pe site / online” — the offer), publish.
 * Participles, past tenses, gerunds and nouns of the stems („trimis”, „trimitea”, „trimițând”, „trimiterea”, „contactul”, „expedierea”)
 * are descriptions of what happened or of a thing: they are no forms here.
 */
const EAZA_END = { eaza: ["imp"], ati: ["imp", "second"], am: ["first"], ez: ["self"], ezi: ["second"], eze: ["third"], a: ["imp"] };
const OUT_STEMS = [
  ["send", "send", ["trimit", "transmit", "retrimit", "retransmit"], { "": ["self"], e: ["imp"], i: ["second"], em: ["first"], eti: ["imp", "second"], a: ["third"] }],
  ["send", "send", ["expedi"], { aza: ["imp"], ez: ["self"], ezi: ["second"], em: ["first"], ati: ["imp", "second"], eze: ["third"], a: ["imp"] }],
  ["send", "send", ["forward"], EAZA_END],
  ["contact", "contact", ["contact"], EAZA_END],
  ["publish", "publish", ["public"], { a: ["imp"], i: ["second"], am: ["first"], ati: ["imp", "second"], e: ["third"] }],
  ["publish", "publish", ["post"], { eaza: ["imp"], ez: ["self"], ezi: ["second"], am: ["first"], ati: ["imp", "second"], eze: ["third"] }],
  ["publish", "publish", ["distribui"], { e: ["imp"], ti: ["imp", "second"], m: ["first"], "": ["second"] }],
  ["contact", "call", ["sun"], { a: ["imp"], ati: ["imp", "second"], i: ["second"], am: ["first"], e: ["third"], "": ["self"] }],
  ["send", "write", ["scri"], { e: ["imp"], eti: ["imp", "second"], i: ["second"], em: ["first"], u: ["self"] }],
  ["publish", "put", ["pun"], { e: ["imp"], eti: ["imp", "second"], em: ["first"], a: ["third"] }],
  ["publish", "put", ["pu"], { i: ["second"] }],
];
/** The main forms whose one slip is read as the form (a misspelt send verb is refused, never corrected toward it). */
const OUT_SLIP_BASES = ["trimite", "trimiteti", "trimiti", "transmite", "retrimite", "expediaza", "contacteaza", "contactati", "contactezi", "publica", "publicati", "publici", "posteaza",
  "postezi"];
/** Each verb form → { kind, family, moods, typo }. */
const OUT_FORMS = (() => {
  const out = new Map();
  for (const [kind, family, stems, endings] of OUT_STEMS) {
    for (const stem of stems) for (const [end, moods] of Object.entries(endings)) out.set(stem + end, { kind, family, moods: new Set(moods), typo: false });
  }
  for (const base of OUT_SLIP_BASES) {
    const form = out.get(base);
    for (const w of slipsOf(base)) if (w.length >= 5 && !OUTREACH_BENIGN.has(w) && !out.has(w)) out.set(w, { ...form, typo: true });
  }
  return out;
})();
/** The verb forms per kind (normalized, no diacritics), longest first: a clause that STARTS with one of them may be the step sales_send. */
const OUTREACH_HEADS = Object.freeze(Object.fromEntries(["send", "contact", "publish"].map((kind) => [kind, [...OUT_FORMS].filter(([, v]) => v.kind === kind && ["send", "contact", "publish", "call"].includes(v.family)
  && !(v.moods.size === 1 && v.moods.has("third"))).map(([w]) => w).sort((a, b) => b.length - a.length)])));
/** „Sună-i”, „Scrie-le”, „Dă-le un mail”: contacting a person (only with the pronoun of a person; „scrie-o” writes a text). */
const CALL_FORMS = String.raw`(?:suna|sunati)-(?:i|l|le|o)|(?:scrie|scrieti)-(?:i|le|l)|(?:da|dati)-(?:i|le) (?:un |o )?(?:mail|e-?mail|mesaj|sms|telefon)`;
const OUTREACH_CLITIC = String.raw`(?:-(?:o|i|l|le|ne))?`;
/** A clause that STARTS with an outreach verb (after fillers): the step sales_send — when the scan below reads it as an instruction. */
const SALES_SEND = new RegExp(String.raw`^(?:(?<send>${OUTREACH_HEADS.send.join("|")})|(?<contact>${OUTREACH_HEADS.contact.join("|")})|(?<publish>${OUTREACH_HEADS.publish.join("|")}))${OUTREACH_CLITIC}(?=[\s,.;!?]|$)|^(?<call>${CALL_FORMS})\b`);
const salesSendArgs = (m) => ({ reason: SALES_SEND_REASON, kind: m.groups.send ? "send" : m.groups.publish ? "publish" : "contact", word: m[0].slice(0, 40) });
/** Words that may stand between a negation and its verb („nu vreau să-i trimiți”, „fără să trimiți”). Anything else ends the look-back. */
const OUTREACH_NEG_GLUE = new Set(["sa", "s", "o", "il", "l", "le", "i", "ii", "mai", "inca", "a", "ne", "vreau", "vrem", "doresc", "dorim", "trebuie", "te", "rog", "va", "se", "poti", "puteti", "cumva", "niciodata",
  "tu", "ai", "grija", "fi", "bine", "ar", "as", "te-as", "ruga", "lui"]);
const OUTREACH_NEGATIONS = new Set(["nu", "fara", "nici", "niciodata"]);
const OUTREACH_HEAD_SETS = Object.fromEntries(Object.entries(OUTREACH_HEADS).map(([k, v]) => [k, new Set(v)]));

/*
 * M12 last fix round (FIXES_LAST) — the ONE outreach rule, FAIL-SAFE, shared by the resolver, the intake (its plan() entry, every planner's
 * input, kept requests), Lega's tools and the Sales brief (sales/brief.mjs). A form of an outreach stem (any person, mood, tense, clitic, a
 * slip) is an INSTRUCTION TO THE HUB when its clause (crossing comma asides: „, te rog,”, „, Lega,”) holds an outreach object or addressee —
 * the offer (ofertă / propunere / ciornă / deviz / cotație), a client / company / prospect, a person's pronoun, a message with the Sales
 * vocabulary — or a Sales step just happened; WHATEVER ask, modal, adverb, politeness or condition precedes it. Only these describe and are
 * never refused:
 *  - a relative clause (care / ce / cum / unde / când / dacă / cine …, also opened before a comma), a purpose clause (pentru a, ca să,
 *    să poată), a verb coordinated with a description („… care primește comenzi și trimite notificări clienților”) unless the offer, the
 *    one client or a person's pronoun is its object;
 *  - a 3rd person with its subject before it (aplicația, site-ul, sistemul, butonul, clientul, firma, ei …; „se trimite”), a 3rd person
 *    subjunctive of the client's own wish („vrea să trimită”, „vrea să le trimitem”), a UI label right after its noun („butonul Trimite
 *    oferta”), the adjective „publică” after its noun, a participle („au fost contactați”), a problem described („Repară X: …”);
 *  - the owner's own first-person statement („contactez eu”, „o trimit eu”): never refused, still never handed to a planner as work;
 *  - a negation in front (also fused: „Nu-i trimite”, „n-o trimite”) is a restriction; words between quotes are content (a quoted
 *    INSTRUCTION — not a label — is still kept out of what a planner receives, with a note); „Trimite-mi” / „Contactează-ne” go to the owner.
 * The Hub named as the one who sends („ca Hub-ul / Lega să trimită”) is the owner's instruction to it.
 */
const OUT_PUNCT = /^[,;:.!?]$/;
const OUT_SENTENCE_END = /^[.;!?]$/;
const OUT_JOINS = new Set(["si", "apoi", "iar", "dar", "insa", "ci", "sau", "atunci", "deci"]);
/** Words that may stand in front of a request at the head of a clause (politeness, acknowledgements, a call of Lega). */
const OUT_LEAD = new Set(["lega", "hei", "hey", "buna", "ok", "okay", "hai", "haide", "bine", "acum", "imediat", "te", "rog", "va", "frumos", "tu", "voi", "eu", "mai", "da", "sigur",
  "cumva", "repede", "chiar", "totusi", "acuma", "please", "bun", "super", "perfect", "mersi", "multumesc", "gata", "excelent", "oricum"]);
/** Words of a comma aside („Trimite, te rog, oferta”, „Ai putea, Lega, să …”): the clause continues across it. */
const OUT_ASIDE = new Set(["te", "rog", "va", "lega", "frumos", "please", "apoi", "acum", "acuma", "deci", "totusi", "imediat", "ok", "okay", "hai", "mersi", "repede", "cumva", "eventual",
  "atunci", "te-as", "ruga", "bine", "oricum", "chiar", "sigur", "hei", "hey"]);
/** „să” and its fused forms („să-i”, „s-o”). */
const OUT_SA = /^(?:sa|s)(?:-(?:i|l|o|le|mi|ti|ne|si|il|va|ma|te))?$/;
/** Pronouns that may stand between „să” and the verb („să o trimiți”). */
const OUT_PROCLITIC = new Set(["o", "il", "l", "le", "i", "ii", "ne", "mi", "ti", "va", "ma", "te", "le-o", "i-o", "mi-o", "imi", "iti", "i-am", "le-am"]);
/** Verbs that ask the Hub to do what follows „să” („vreau să trimiți”, „te rog să”, „poți să”, „nu uita să”). (The offer-request rule.) */
const OUT_ASK = new Set(["vreau", "vrem", "vrea", "vreti", "doresc", "dorim", "dori", "rog", "poti", "puteti", "putea", "trebuie", "hai", "haide", "uita", "incearca", "incercati"]);
const OUT_AUX = new Set(["as", "ai", "ati", "am", "ar"]);
/** A 3rd person's own wish before „să” („clientul vrea să trimită”, „vrea să le trimitem”): the client's need, never the owner's ask. */
const OUT_CLIENT_WISH = new Set(["vrea", "vor", "doreste"]);
/** Asks for help with the owner's own sending („Mă ajuți să trimit oferta?”): the Hub is asked to send. */
const OUT_HELP = /^(?:ajuti|ajutati|ajuta-ma|ajutati-ma|ajuta-ne|ajutati-ne)$/;
/** Modals followed by the infinitive („Poți trimite oferta?”, „Ați putea contacta clientul?”). */
const OUT_MODALS = new Set(["poti", "puteti", "putea"]);
/** Time and sequence adverbs: in front of „publică” they mark the verb, never the adjective („Mâine publică oferta”). */
const OUT_ADVERBS = new Set(["maine", "poimaine", "azi", "astazi", "diseara", "eventual", "ulterior", "intai", "neaparat", "odata", "luni", "marti", "miercuri", "joi", "vineri", "sambata",
  "duminica", "oricum"]);
/** Verbs that name the fix of a problem: a sentence after „Repară …:” or before „Repară asta.” describes the problem (RR4). */
const OUT_FIX_VERB = /^(?:repara|rezolva|corecteaza|investigheaza|verifica|analizeaza|testeaza|depaneaza)(?:-l|-o|-le|-i)?$/;
const OUT_DEMONSTRATIVE = new Set(["asta", "aia", "aceasta", "acesta", "acea", "acel"]);
/** The names of the Hub itself: „Vreau ca Hub-ul să trimită oferta” asks the Hub. */
const OUT_HUB_NAMES = new Set(["hub", "hub-ul", "hubul", "lega"]);
/** Words that open a condition in front of an instruction („Dacă e gata, trimite oferta”): cut with it. */
const OUT_CONDITION = new Set(["daca", "cand", "odata"]);
/** Sequence words a cut leaves dangling at the start of the next request („… și după aceea repară bug-ul” → „repară bug-ul”, RR11). */
const OUT_SEQUENCE_LEAD = /^(?:(?:dupa (?:aceea|aia|care)|pe urma|la final|la sfarsit|in final|apoi|eventual|ulterior)\s+)+/;
/** Markers of a description: a verb after them is the subject's own activity, never an instruction to the Hub. */
const OUT_RELATIVE = new Set(["care", "ce", "cum", "unde", "cand", "daca", "ca", "cat", "cine"]);
/** Pronouns after a hyphen that make the verb an instruction towards someone („trimite-o”, „contactează-i”); „-ne / -mi / -ți” are not (a label, „to me”). */
const OUT_CLITICS = new Set(["o", "i", "l", "le", "i-o", "le-o", "l-o", "li"]);
/** The person's pronouns of „scrie-i / scrie-le” and „îi / le scrii” (TO someone; „scrie-o” writes a text). */
const OUT_DATIVE_CLITICS = new Set(["i", "le", "i-o", "le-o", "ii", "li"]);
const OFFER_OBJECT = new Set(["oferta", "oferte", "ofertele", "ofertei", "ofertelor", "propunere", "propunerea", "propuneri", "propunerile", "propunerii", "ciorna", "ciorne",
  "ciornele", "ciornei", "deviz", "devizul", "devizele", "devizului", "cotatie", "cotatia", "cotatii", "cotatiile", "cotatiei"]);
const SALES_ADDRESSEE = /^(?:client(?:ul|ului|a|ei|ii|i|ilor|ele|elor)?|firm(?:a|ei|ele|elor)|companie|compania|companiei|companiile|companiilor|prospect(?:ul|ului|i|ii|ilor)?|lead(?:-ul|ul|-uri|uri|-urile|urile|-urilor|urilor)?|cumparator(?:ul|ului|ii|ilor)?)$/;
/** The ONE client or company of an offer (not a business's customers in general): coordinated with a description, it still makes an instruction. */
const ONE_ADDRESSEE = /^(?:client|clientul|clientului|clienta|clientei|firma|firmei|compania|companiei|prospect|prospectul|prospectului|lead-ul|leadul|lead-ului|leadului)$/;
/** An addressee in the dative („scrie clientului / firmei”, „lui Andrei”). */
const DATIVE_ADDRESSEE = /^(?:client(?:ului|ilor|ei|elor)|firm(?:ei|elor)|companiei|companiilor|prospect(?:ului|ilor)|lead-?ului|lead-?urilor|cumparator(?:ului|ilor))$/;
/** People a call is made to („Sună curierul”). */
const OUT_PERSON = /^(?:curier(?:ul|ii)?|furnizor(?:ul|ii)?|pacient(?:ul|ii|a)?|omul|oamenii|persoana|contabil(?:ul|a)|manager(?:ul|ul)?|director(?:ul|ul)?|patron(?:ul|ii)?|proprietar(?:ul|ii)?|mecanic(?:ul|ii)?|medic(?:ul|ii)?|doctor(?:ul|ii)?|colaborator(?:ul|ii)?|partener(?:ul|ii)?|reprezentant(?:ul|ii)?)$/;
/** Where a „pune” publishes („pune oferta pe site / pe Facebook / online”). */
const OUT_PUT_TARGET = new Set(["site", "site-ul", "siteul", "facebook", "instagram", "linkedin", "tiktok", "internet", "net", "web", "blog", "blogul", "youtube"]);
/** A clip, a video: a pronoun said after them names the clip (Studio's own publish rule, MEDIA_C), never the offer. */
const STUDIO_OBJECT = /\b(?:clip|clipul|clipuri|clipurile|videoclip|videoclipul|video|video-ul|videoul|montaj|montajul|filmulet|filmuletul|reel|reels)\b/;
/** What may follow a bare „Trimite” / „Publică” in a Sales conversation („Trimite acum”, „Publică pe Facebook”). */
const OUT_BARE_TAIL = new Set(["acum", "imediat", "te", "rog", "va", "frumos", "pe", "facebook", "instagram", "linkedin", "tiktok", "site", "site-ul", "siteul", "email", "e-mail", "mail",
  "mailul", "din", "nou", "iar", "gata", "repede", "azi", "astazi", "maine", "online", "tu", "o", "data", "mai", "la", "lega"]);
/** Words naming a label: a quoted text right after them is the label's text („butonul „Trimite oferta””), never an instruction. */
const OUT_LABEL = new Set(["butonul", "buton", "butonului", "butoanele", "pagina", "paginii", "paginile", "link-ul", "linkul", "link", "textul", "text", "eticheta", "titlul", "titlu",
  "mesajul", "optiunea", "meniul", "sectiunea", "campul", "formularul", "tab-ul", "tabul", "cta", "cta-ul", "ecranul", "fereastra", "notificarea", "sablonul", "template-ul",
  "numit", "numita", "numite", "intitulat", "intitulata", "scris"]);
/** Subjects before a 3rd person verb („aplicația trimite”, „clientul vrea să trimită”, „ei vor să trimită”): the subject's own activity. */
const OUT_SUBJECTS = new Set(["aplicatia", "aplicatiile", "platforma", "pagina", "functia", "functionalitatea", "echipa", "campania", "automatizarea", "notificarea", "componenta",
  "firma", "firmele", "compania", "companiile", "clienta", "clientele", "clientii", "lumea", "pizzeria", "clinica", "agentia", "persoana", "secretara", "receptia", "masina",
  "ei", "ea", "el", "ele", "dansul", "dansa", "dansii", "dansele", "cineva", "fiecare", "toti", "toata", "utilizatorii", "pacientii", "oamenii", "angajatii", "colegii",
  "aplicatie", "sistem", "bot", "robot", "chatbot", "program", "script", "modul", "formular", "site", "crm", "functie", "serviciu", "newsletter", "server"]);
const OUT_PREPOSITIONS = new Set(["pentru", "pe", "la", "din", "de", "cu", "catre", "spre", "in", "prin", "despre", "dupa", "fara", "intre", "sub", "peste", "langa", "lui", "al", "a", "ale", "ai"]);
const OUT_MESSAGE = new Set(["mail", "e-mail", "email", "emailul", "e-mailul", "mailul", "mesaj", "mesajul", "sms", "sms-ul", "telefon", "apel", "whatsapp"]);
/** The participle of an ambiguous form („au fost contactați”, „au fost publicați”). */
const OUT_PARTICIPLE_AUX = new Set(["fost", "au", "sunt", "fi", "fie", "era", "erau", "este", "e", "vor"]);
/** Forms that are also adjectives („pagina publică”, „date publice”, „bani publici”). */
const OUT_ADJECTIVE_FORMS = new Set(["publica", "publice", "publici"]);
const OUT_STRIP = new Map(Object.entries({ "ă": "a", "â": "a", "î": "i", "ș": "s", "ş": "s", "ț": "t", "ţ": "t", "Ă": "a", "Â": "a", "Î": "i", "Ș": "s", "Ş": "s", "Ț": "t", "Ţ": "t" }));
/** The text folded ONE character per character (lower case, no diacritics; quotes → \u0001; anything else → a space): offsets stay those of the text. */
function foldKeep(text) {
  let out = "";
  for (const ch of String(text || "")) {
    let f;
    if (OUT_STRIP.has(ch)) f = OUT_STRIP.get(ch);
    else if (/[„“”«»"]/.test(ch)) f = "\u0001";
    else if (/[a-z0-9,;:.!?\-]/.test(ch)) f = ch;
    else if (/[A-Z]/.test(ch)) f = ch.toLowerCase();
    else if (/[̀-ͯ]/.test(ch)) f = "\u0002";
    else {
      const base = ch.normalize("NFD")[0];
      f = /[a-zA-Z]/.test(base || "") ? base.toLowerCase() : " ";
    }
    out += ch.length === 2 ? `${f} ` : f;
  }
  return out;
}
function outTokens(text, normalized) {
  const folded = normalized ? String(text || "") : foldKeep(String(text || "").slice(0, 4000));
  const toks = [];
  let quoted = false;
  for (const m of folded.matchAll(/\u0001|[a-z0-9\u0002]+(?:-[a-z0-9\u0002]+)*|[,;:.!?]/g)) {
    if (m[0] === "\u0001") { toks.push({ f: "\u0001", start: m.index, end: m.index + 1, quote: true, quoted }); quoted = !quoted; continue; }
    toks.push({ f: m[0].replace(/\u0002/g, ""), start: m.index, end: m.index + m[0].length, quoted });
  }
  return { folded, toks };
}
/** The folded words (and punctuation marks) of a text with their offsets in it — the Sales brief reads the same rules on them. */
export const foldedTokens = (text) => outTokens(text, false).toks.filter((t) => !t.quote);
/** The verb (and its pronoun after a hyphen, or fused: „trimiteo”, „trimitei”) a token is, or null. */
function outVerb(f) {
  const t = String(f || "");
  const dash = t.indexOf("-");
  const head = dash < 0 ? t : t.slice(0, dash);
  const clitic = dash < 0 ? "" : t.slice(dash + 1);
  // „Dă-i / Dă-le un mail”, „Dă un telefon clientului”: the message decides (below).
  if (head === "da" || head === "dati") return { kind: "send", family: "give", moods: new Set(["imp"]), typo: false, clitic };
  // „Dă share la ofertă”, „Share-uiește oferta”.
  if (/^share(?:-?ui(?:este|esti|ti|m))?$/.test(head) || /^share-ui(?:este|esti|ti|m)(?:-(?:o|l|le|i))?$/.test(t)) {
    const c = t.match(/-(o|l|le|i)$/);
    return { kind: "publish", family: head === "share" && !/ui/.test(t) ? "share" : "publish", moods: new Set(["imp"]), typo: false, clitic: c ? c[1] : "" };
  }
  const form = OUT_FORMS.get(head);
  if (form) return { ...form, clitic };
  // A pronoun fused without its hyphen („trimiteo clientului”, „te rog trimitei oferta”): read as the imperative with that pronoun.
  if (!clitic) {
    for (const suf of ["le", "o", "i", "l"]) {
      if (!head.endsWith(suf)) continue;
      const base = OUT_FORMS.get(head.slice(0, -suf.length));
      if (base && base.moods.has("imp") && !base.typo) return { ...base, clitic: suf, typo: true };
    }
  }
  return null;
}
/** Whether a folded token is a form of an outreach stem (any person, mood, slip): the brief's fail-closed cut uses it. Pure. */
export const outreachVerbForm = (f) => Boolean(outVerb(f));
/**
 * The scan: every outreach instruction (`hits`), every negated one (`negated`, a restriction) and every owner's own statement (`selves`) in
 * `seq`, with token indexes into it. `scope`: the Sales vocabulary is present (or a Sales step just happened); `offerScope`: the offer
 * itself is named; `studio`: a clip is named; `salesContext`: a Sales step just happened (F14).
 */
function scanOutreachTokens(seq, { scope = false, offerScope = false, studio = false, salesContext = false } = {}) {
  const hits = [];
  const negated = [];
  const selves = [];
  const at = (k) => seq[k]?.f;
  const negatedAt = (i) => {
    for (let k = i - 1, steps = 0; k >= 0 && steps < 6; k -= 1, steps += 1) {
      const t = at(k);
      if (OUT_PUNCT.test(t)) return -1;
      if (OUTREACH_NEGATIONS.has(t) || /^(?:nu|n)-[a-z]+$/.test(t)) return k;
      if (!OUTREACH_NEG_GLUE.has(t) && !OUT_SA.test(t)) return -1;
    }
    return -1;
  };
  /** The comma at c closes an aside („…, te rog, …”, „Te rog, …”)? → the index before the aside (a comma, a sentence end, or -1), else null. */
  const asideBack = (c) => {
    let k = c - 1;
    while (k >= 0 && OUT_ASIDE.has(at(k))) k -= 1;
    if (k === c - 1) return null;
    return k < 0 || at(k) === "," || OUT_SENTENCE_END.test(at(k)) || OUT_JOINS.has(at(k)) ? k : null;
  };
  /** The comma at c opens an aside? → the index of the comma closing it (or of its last word at the end), else null. */
  const asideFwd = (c) => {
    let k = c + 1;
    while (k < seq.length && OUT_ASIDE.has(at(k))) k += 1;
    if (k === c + 1) return null;
    if (at(k) === ",") return k;
    return k >= seq.length || OUT_SENTENCE_END.test(at(k)) ? k - 1 : null;
  };
  /** RR4: whether the comma at c continues an open description („o aplicație care, după comandă, trimite …”). */
  const openRelativeBefore = (c) => {
    for (let n = 0; n < 4 && c > 0; n += 1) {
      if (OUT_RELATIVE.has(at(c - 1))) return true;
      let k = c - 1;
      while (k >= 0 && !OUT_PUNCT.test(at(k))) k -= 1;
      if (k < 0 || at(k) !== ",") return false;
      c = k;
    }
    return false;
  };
  /** Where the clause of the verb at i starts: back to a joining word or a punctuation mark, across comma asides. → { start, by } */
  const clauseOf = (i) => {
    for (let k = i - 1; k >= 0; k -= 1) {
      const t = at(k);
      if (OUT_JOINS.has(t)) return { start: k + 1, by: "join" };
      if (!OUT_PUNCT.test(t)) continue;
      if (t === ",") {
        const r = asideBack(k);
        if (r !== null && r >= 0 && at(r) === ",") { k = r; continue; }
        if (r !== null) return { start: r + 1, by: r >= 0 && OUT_JOINS.has(at(r)) ? "join" : "start" };
      }
      return { start: k + 1, by: t === "," ? "comma" : "start" };
    }
    return { start: 0, by: "start" };
  };
  /** RR4: a sentence that describes a problem — after „Repară …:” or followed by „Repară asta.” — holds no instruction to the Hub. */
  const describedProblem = (i) => {
    let s = i;
    while (s > 0 && !OUT_SENTENCE_END.test(at(s - 1))) s -= 1;
    for (let k = i - 1; k >= s; k -= 1) {
      if (at(k) !== ":") continue;
      let h = s;
      while (h < k && OUT_LEAD.has(at(h))) h += 1;
      if (OUT_FIX_VERB.test(at(h) || "")) return true;
      break;
    }
    let e = i;
    while (e < seq.length && !OUT_SENTENCE_END.test(at(e))) e += 1;
    let h = e + 1;
    while (h < seq.length && OUT_LEAD.has(at(h))) h += 1;
    const fix = at(h) || "";
    if (!OUT_FIX_VERB.test(fix)) return false;
    if (/-(?:l|o)$/.test(fix)) return true;
    for (let d = 1; d <= 3 && h + d < seq.length && !OUT_PUNCT.test(at(h + d)); d += 1) if (OUT_DEMONSTRATIVE.has(at(h + d))) return true;
    return false;
  };
  /** A subject noun at k (not after a preposition, not the offer, not a Hub name): „aplicația”, „butonul”, „clientul”, „ei”. */
  const subjectAt = (k) => {
    const t = at(k) || "";
    if (OFFER_OBJECT.has(t) || OUT_HUB_NAMES.has(t) || OUT_PREPOSITIONS.has(at(k - 1)) || outVerb(t)) return false;
    if (OUT_SUBJECTS.has(t)) return true;
    if (/(?:ului|ilor|elor)$/.test(t)) return false;
    return (/^[a-z0-9]+(?:-ul|ul)$/.test(t) && t.length >= 5) || (/^[a-z]{4,}ii$/.test(t) && t !== "scrii");
  };
  for (let i = 0; i < seq.length; i += 1) {
    let v = outVerb(at(i));
    if (!v && at(i) === "posta" && OUT_MODALS.has(at(i - 1))) v = { kind: "publish", family: "publish", moods: new Set(["imp"]), typo: false, clitic: "" };
    if (!v) continue;
    const prev = at(i - 1) || "";
    if (v.family === "share" && !["da", "dati", "fa", "faceti"].includes(prev)) continue;
    if (v.family === "give" && !/^(?:un|o)$/.test(at(i + 1) || "") && !OUT_MESSAGE.has(at(i + 1) || "")) continue;
    const neg = negatedAt(i);
    if (neg >= 0) { negated.push({ kind: v.kind, i, neg }); continue; }
    const clitic = v.clitic;
    if (clitic && !OUT_CLITICS.has(clitic)) continue; // „Contactează-ne” (a label), „Trimite-mi oferta” (to the owner himself)
    const personClitic = Boolean(clitic) && v.moods.has("imp");
    // The pronouns and „să” in front of the verb („să o trimiți”, „s-o trimiți”, „îi trimiți”, „să-mi trimiți”).
    let j = i - 1;
    while (j >= 0 && OUT_PROCLITIC.has(at(j)) && j >= i - 2) j -= 1;
    const sa = j >= 0 && OUT_SA.test(at(j)) ? j : -1;
    const procl = [];
    for (let k = j + 1; k < i; k += 1) procl.push(at(k));
    if (sa >= 0) { const c = at(sa).split("-")[1]; if (c) procl.push(c); }
    const toOwner = procl.some((p) => ["mi", "ne", "imi", "mi-o"].includes(p));
    const proclitic = procl.some((p) => !["mi", "ne", "ti", "va", "ma", "te", "imi", "iti", "si", "mi-o"].includes(p));
    const { start, by } = clauseOf(i);
    // The clause's words before the verb (its ask, adverbs, a fronted object or a subject) and after it (its object).
    const before = [];
    for (let k = start; k < i; k += 1) if (!OUT_PUNCT.test(at(k))) before.push(k);
    const after = [];
    let end = i;
    for (let k = i + 1; k < seq.length && k <= i + 12; k += 1) {
      const t = at(k);
      if (t === ",") { const r = asideFwd(k); if (r !== null) { k = r; continue; } break; }
      if (OUT_PUNCT.test(t) || OUT_JOINS.has(t) || OUT_RELATIVE.has(t)) break;
      after.push(k);
      end = k;
    }
    const third = v.moods.has("imp") || v.moods.has("third") || v.moods.has("self");
    const onlyThird = v.moods.size === 1 && v.moods.has("third");
    const onlySelf = v.moods.size === 1 && v.moods.has("self");
    const firstOrSecond = v.moods.has("second") || v.moods.has("first");
    // „Vreau ca Hub-ul / Lega să trimită oferta”: the Hub named as the one who sends is the owner's instruction to it.
    const toHub = sa >= 1 && OUT_HUB_NAMES.has(at(sa - 1));
    // --- Descriptions (never refused) ---
    if (!toHub && !personClitic) {
      // A relative or purpose clause („care trimite”, „cum trimiți”, „dacă formularul trimite”, „ca firma să poată trimite”), also opened
      // before a comma („o aplicație care, după comandă, trimite …”). „Ce-ar fi să …” asks.
      const relative = before.some((k) => OUT_RELATIVE.has(at(k)) && !(at(k) === "ce" && at(k + 1) === "ar") && !(at(k) === "cat" && ["mai", "de"].includes(at(k + 1))) && !(at(k) === "ca" && firstOrSecond && !OUT_SA.test(at(k + 1) || "")))
        || (by === "comma" && start > 0 && openRelativeBefore(start - 1));
      if (relative) continue;
      const purpose = (prev === "a" && ["pentru", "de", "spre", "ca", "fara"].includes(at(i - 2))) || (["poata", "poate", "puteau", "puteam"].includes(prev) && OUT_SA.test(at(i - 2) || ""));
      if (purpose) continue;
      // A UI label right after its noun („butonul Trimite oferta”, „un buton Contactează”), „se trimite” (impersonal), a participle.
      if (OUT_LABEL.has(prev) || prev === "se" || prev === "s-a" || prev === "s-au") continue;
      if (/(?:ati|iti)$/.test(at(i)) && OUT_PARTICIPLE_AUX.has(prev)) continue;
      // „pagina publică”, „date publice”: the adjective after its noun.
      if (OUT_ADJECTIVE_FORMS.has(at(i).split("-")[0]) && !clitic && !OFFER_OBJECT.has(at(i + 1) || "") && prev && !OUT_PUNCT.test(prev) && !OUT_JOINS.has(prev) && !OUT_LEAD.has(prev) && !OUT_ASIDE.has(prev)
        && !OUT_ASK.has(prev) && !OUT_AUX.has(prev) && !OUT_SA.test(prev) && !OUT_PROCLITIC.has(prev) && !OUT_MODALS.has(prev) && !OUT_ADVERBS.has(prev) && !OFFER_OBJECT.has(prev)
        && !["tu", "voi", "mai", "nu", "pe", "urma", "final", "aceea", "aia", "viitoare", "viitor", "asta", "curand", "devreme"].includes(prev)) continue;
      // A 3rd person with its subject before it („aplicația trimite”, „clientul vrea să trimită”, „ei vor să trimită”).
      if (third && !firstOrSecond && before.some((k) => subjectAt(k) && !(at(k + 1) === "," && OUT_HUB_NAMES.has(at(k))))) continue;
      // The client's own wish before „să” („vrea să trimită”, „vrea să le trimitem”) — „aș / ai vrea” is the owner's ask.
      if ((onlyThird || v.moods.has("first")) && !v.moods.has("second") && sa >= 1 && OUT_CLIENT_WISH.has(at(sa - 1)) && !OUT_AUX.has(at(sa - 2))) continue;
      // A 3rd person subjunctive is never the owner's imperative: coordinated with the client's description or wish („… care vrea programări
      // online și să le trimită pacienților remindere”, „Clientul vrea programări și să le trimită SMS”), it is the same subject's.
      if (onlyThird) {
        let described = false;
        for (let k = start - 1; k >= 0 && !OUT_PUNCT.test(at(k)); k -= 1) {
          if (OUT_RELATIVE.has(at(k)) || subjectAt(k) || (OUT_CLIENT_WISH.has(at(k)) && !OUT_AUX.has(at(k - 1)))) { described = true; break; }
        }
        if (described) continue;
      }
      // Future / conditional of a 3rd person („va trimite”, „ar trimite”, „o să trimită”) without the Hub named: a description.
      if (v.moods.has("imp") && ["va", "vor", "ar"].includes(prev)) continue;
      if (!clitic && describedProblem(i)) continue;
    }
    // --- The objects of the verb (its whole clause, across comma asides; a fronted object too) ---
    let offer = false, addressee = false, one = false, dative = false, message = false, person = false, target = false, other = false;
    const objectAt = (k, side) => {
      const t = at(k);
      if (OFFER_OBJECT.has(t)) { offer = true; return; }
      if (SALES_ADDRESSEE.test(t)) { addressee = true; person = true; if (ONE_ADDRESSEE.test(t)) one = true; if (DATIVE_ADDRESSEE.test(t)) dative = true; return; }
      if (OUT_PERSON.test(t)) { person = true; return; }
      if (OUT_MESSAGE.has(t)) { message = true; return; }
      if (t === "lui" && side === "after" && at(k + 1)) { dative = true; person = true; return; }
      if (t === "pe" && side === "after" && at(k + 1) && !OUT_PUT_TARGET.has(at(k + 1))) person = true;
      if (OUT_PUT_TARGET.has(t) || t === "online") target = true;
      if (side === "after" && !OUT_BARE_TAIL.has(t)) other = true;
    };
    for (const k of after) objectAt(k, "after");
    for (const k of before) objectAt(k, "before");
    const toSomeone = (Boolean(clitic) && OUT_CLITICS.has(clitic)) || proclitic;
    const datClitic = OUT_DATIVE_CLITICS.has(clitic) || procl.some((p) => OUT_DATIVE_CLITICS.has(p));
    // A verb coordinated with a description („… care primește comenzi și trimite notificări clienților”): the same subject's activity — unless
    // the offer, the one client or a person's pronoun is its object („… care vrea programări online și sună clientul”).
    if (by === "join" && third && !firstOrSecond && !toSomeone && !offer && !one && !toHub) {
      let described = false;
      for (let k = start - 2; k >= 0 && !OUT_PUNCT.test(at(k)); k -= 1) if (OUT_RELATIVE.has(at(k)) || OUT_SA.test(at(k))) { described = true; break; }
      if (described) continue;
    }
    // „Să-mi trimiți oferta”, „Îmi trimiți oferta?”: to the owner himself, unless the client is named too.
    if (toOwner && !addressee) continue;
    let hit = false;
    if (v.family === "give") hit = message && (datClitic || dative || addressee);
    // „Scrie clientului / -le / lui Andrei”, „Scrie un mail clientului”: TO someone; „Scrie raportul clientului” (whose report) is no outreach.
    else if (v.family === "write") hit = datClitic || DATIVE_ADDRESSEE.test(at(i + 1) || "") || (at(i + 1) === "lui" && Boolean(at(i + 2))) || (message && (dative || addressee));
    else if (v.family === "call") hit = toSomeone || person;
    else if (v.family === "contact") hit = true;
    else if (v.family === "put") hit = target && (offer || (toSomeone && (offerScope || (salesContext && !studio))));
    else if (v.kind === "send") hit = offer || addressee || (message && scope) || (toSomeone && (scope || salesContext)) || (salesContext && !other && !studio);
    else if (v.kind === "publish") hit = offer || (toSomeone && (offerScope || (salesContext && !studio))) || (salesContext && !other && !studio);
    if (!hit) continue;
    // The owner's own first-person statement („Contactez eu firma”, „o trimit eu clientului”) is no request to the Hub: never refused, only
    // kept out of a planner's words — unless he asks for help with it („Mă ajuți să trimit oferta?”).
    const help = sa >= 1 && (OUT_HELP.test(at(sa - 1)) || (at(sa - 1) === "ajuti" || at(sa - 1) === "ajutati"));
    const self = onlySelf && !help && !toHub;
    (self ? selves : hits).push({ kind: v.kind, i, end, pos: by === "join" ? "join" : "start", typo: v.typo, offer });
  }
  return { hits, negated, selves };
}
/** Whether a joining word at k starts the owner's next request („… și după aceea / și te rog / și la ProDelivery repară …”, RR11). */
function nextRequestAt(seq, k) {
  for (let n = k + 1; n < seq.length && n <= k + 4; n += 1) {
    const t = seq[n].f;
    if (OUT_PUNCT.test(t) || OUT_JOINS.has(t) || OUT_RELATIVE.has(t)) return false;
    if (OUT_NEXT_VERB.test(t) || outVerb(t)) return true;
  }
  return false;
}
/** Verbs that start another request after „și / apoi” (the outreach clause ends there: „Trimite oferta și repară bug-ul”). */
const OUT_NEXT_VERB = /^(?:arata|deschide|porneste|continua|opreste|fa|pregateste|importa|treci|du-ma|mergi|adu|comuta|inregistreaza|spune|explica|reia|lanseaza|ruleaza|creeaza|genereaza|hai|repara|rezolva|corecteaza|implementeaza|refactorizeaza|adauga|scrie|analizeaza|revizuieste|evalueaza|investigheaza|verifica|testeaza|construieste|actualizeaza|citeste|rezuma|monteaza|randeaza|exporta|salveaza|noteaza|pune|caut|cauta|calculeaza)(?:-[a-z]+)?$/;
/** The words of a comma aside, read from the outside of the scan (the clause boundaries of a cut). */
const asideRun = (seq, from, step) => { let k = from; while (k >= 0 && k < seq.length && OUT_ASIDE.has(seq[k].f)) k += step; return k; };
/** Where the clause of a hit starts and ends (token indexes) — what is cut out of a planner's words. */
function outreachClause(seq, h) {
  const at = (k) => seq[k]?.f;
  // RR1: the clause starts at the joining word or the punctuation mark nearest before the verb — also when an ask („și te rog să …”), a
  // modal, an adverbial, a fronted object or a comma aside („Ai putea, te rog, să …”) leads into it — never at the start of a sentence that
  // holds another request.
  let j = h.i - 1;
  for (; j >= 0; j -= 1) {
    if (OUT_JOINS.has(at(j))) break;
    if (!OUT_PUNCT.test(at(j))) continue;
    if (at(j) === ",") {
      const k = asideRun(seq, j - 1, -1);
      if (k < j - 1) {
        if (k < 0) { j = -1; break; }
        if (OUT_SENTENCE_END.test(at(k)) || OUT_JOINS.has(at(k))) { j = k; break; }
        if (at(k) === ",") { j = k; continue; }
      }
    }
    break;
  }
  let start = j + 1;
  if (j >= 0 && OUT_JOINS.has(at(j))) {
    start = j;
    if (start > 0 && OUT_PUNCT.test(at(start - 1)) && at(start - 1) !== ".") start -= 1;
    // „Pregătește și trimite oferta …”: the two verbs share the object — only „și trimite” is cut.
    const left = start - 1;
    if (h.pos === "join" && left >= 0 && (left === 0 || OUT_PUNCT.test(at(left - 1))) && h.offer && h.end > h.i) return { start, end: h.i, shared: true };
  } else if (j >= 0 && at(j) === ",") {
    // „Dacă e gata, trimite oferta”, „În caz că e gata, …”: the condition in front belongs to the instruction (nothing of it is left for a planner).
    let c = j - 1;
    while (c >= 0 && !OUT_PUNCT.test(at(c)) && !OUT_JOINS.has(at(c))) c -= 1;
    const first = at(c + 1);
    const cond = OUT_CONDITION.has(first) || (["dupa", "imediat", "indata"].includes(first) && at(c + 2) === "ce") || (first === "in" && at(c + 2) === "caz")
      || (OUT_ASIDE.has(first) && OUT_CONDITION.has(at(c + 2)));
    if ((c < 0 || OUT_SENTENCE_END.test(at(c)) || OUT_JOINS.has(at(c)) || at(c) === ",") && cond) start = c >= 0 && OUT_JOINS.has(at(c)) ? c : c + 1;
  }
  let end = h.i;
  for (let k = h.i + 1; k < seq.length; k += 1) {
    const t = at(k);
    if (t === ",") {
      // „Trimite, te rog, oferta clientului”, „…, te rog”: the aside belongs to the instruction.
      const r = asideRun(seq, k + 1, 1);
      if (r > k + 1 && at(r) === ",") { end = r; k = r; continue; }
      if (r > k + 1 && (r >= seq.length || OUT_SENTENCE_END.test(at(r)))) { end = r - 1; k = r - 1; continue; }
      break;
    }
    if (OUT_PUNCT.test(t)) break;
    if (OUT_JOINS.has(t) && nextRequestAt(seq, k)) break;
    end = k;
  }
  return { start, end };
}
/**
 * The scan of a whole text (typed, spoken, a tool's words): owner instructions to send / contact / publish (`hits`, refused), negated ones
 * (restrictions) and quoted instructions (content, never refused, kept out of a planner's words). `normalized`: the text is already
 * normalize()d (and unquoted). Pure. → { hits, negated, quoted, scoped, seq }
 */
function outreachScan(text, { normalized = false, salesContext = false, scopeText = "" } = {}) {
  const { toks } = outTokens(text, normalized);
  const main = toks.filter((t) => !t.quote && !t.quoted);
  const plain = `${main.map((t) => t.f).join(" ")} ${scopeText ? unquote(normalize(scopeText)) : ""}`;
  const scope = salesContext || SALES_SCOPE.test(plain);
  const offerScope = OFFER_SCOPE.test(plain);
  const studio = STUDIO_OBJECT.test(plain);
  const scan = scanOutreachTokens(main, { scope, offerScope, studio, salesContext });
  // Quoted passages: a quoted instruction (not a label's text) is content — never refused, never a planner's words either.
  const quoted = [];
  for (let k = 0; k < toks.length; k += 1) {
    if (!toks[k].quote || toks[k].quoted) continue;
    let e = k + 1;
    while (e < toks.length && !toks[e].quote) e += 1;
    const inner = toks.slice(k + 1, e);
    const before = toks.slice(0, k).filter((t) => !t.quote).at(-1)?.f || "";
    const label = OUT_LABEL.has(before);
    const qs = inner.length ? scanOutreachTokens(inner, { scope: scope || SALES_SCOPE.test(inner.map((t) => t.f).join(" ")), offerScope: offerScope || OFFER_SCOPE.test(inner.map((t) => t.f).join(" ")), studio, salesContext }) : { hits: [] };
    if (qs.hits.length && !label) quoted.push({ start: toks[k].start, end: (toks[e] || inner.at(-1) || toks[k]).end, kind: qs.hits[0].kind });
    k = e;
  }
  const located = (h) => ({ ...h, word: main[h.i].f.slice(0, 40), start: main[h.i].start, endChar: main[h.i].end, clause: outreachClause(main, h) });
  return { hits: scan.hits.map(located),
    negated: scan.negated.map((n) => ({ kind: n.kind, word: main[n.i].f.slice(0, 40), start: main[n.i].start, end: main[n.i].end, negStart: main[n.neg].start })),
    // RR10: the owner's own statements („contactez eu firma”): never refused, only kept out of a planner's words.
    selves: scan.selves.map(located), quoted, scoped: SALES_SCOPE.test(plain), seq: main };
}
/**
 * Every outreach instruction a sentence holds (typed or spoken, any clause), with its negation honoured: „Trimite oferta”, „Pregătește oferta și
 * trimite-o clientului”, „Contactează-i” → hits; „Nu trimite oferta”, „Nu-i trimite oferta”, „formularul de contact”, „Trimite un mesaj de
 * probă” (no Sales object), „Repară butonul care trimite comanda clientului” (a description) → none. Pure. `normalized`: the text is already
 * normalize()d and unquoted; `salesContext`: a Sales step just happened in this conversation (F14).
 * → { hits: [{ kind: "send"|"contact"|"publish", word, typo }], negated: [{ kind, word }], quoted: [{ kind }], scoped }
 */
export function salesOutreach(text, { normalized = false, salesContext = false } = {}) {
  const s = outreachScan(normalized ? String(text || "").replace(/\u0001/g, " ") : text, { normalized, salesContext });
  return { hits: s.hits.map((h) => ({ kind: h.kind, word: h.word, typo: h.typo })), negated: s.negated.map((n) => ({ kind: n.kind, word: n.word })), quoted: s.quoted.map((q) => ({ kind: q.kind })), scoped: s.scoped };
}
/**
 * The same rule with offsets in `text` (the Sales brief marks the refused words and reads the negated ones as restrictions):
 * → { hits: [{ kind, start, end, typo, clauseStart, clauseEnd }], negated: [{ kind, start, end, negStart }], own: [{ kind, start, end }] }.
 * `clauseStart` / `clauseEnd`: the whole outreach clause (RR2 / RR6: the brief keeps none of its words in the client's need); `own`: the
 * owner's own statements' clauses (RR10: never refused, never part of the need). Pure.
 */
export function outreachSpans(text, { salesContext = false } = {}) {
  const s = outreachScan(text, { salesContext });
  const clauseOf = (h) => ({ clauseStart: s.seq[h.clause.start].start, clauseEnd: s.seq[h.clause.end].end });
  return { hits: s.hits.map((h) => ({ kind: h.kind, start: h.start, end: h.endChar, typo: h.typo, ...clauseOf(h) })),
    negated: s.negated.map((n) => ({ kind: n.kind, start: n.start, end: n.end, negStart: n.negStart })),
    own: s.selves.map((h) => { const c = clauseOf(h); return { kind: h.kind, start: c.clauseStart, end: c.clauseEnd }; }) };
}
/** Whether what is left of a request still asks for something (more than lead words, joining words and punctuation). */
const meaningfulRest = (text) => outTokens(text, false).toks.some((t) => !t.quote && !OUT_PUNCT.test(t.f) && !OUT_JOINS.has(t.f) && !OUT_LEAD.has(t.f) && t.f.length >= 3);
/** Tidies the words left after a cut (spaces, a dangling joining word or punctuation at either end). */
function tidyRest(text) {
  let s = String(text || "").replace(/\s+/g, " ").replace(/\s+([,;:.!?])/g, "$1").replace(/([,;:])(?:\s*[,;:])+/g, "$1").replace(/([.!?;])(?:\s*[.!?;,:])+/g, "$1")
    // RR2: „Repară X, poți trimite oferta?” — the question mark belonged to the cut question.
    .replace(/[,;:]\s*\?/g, "").trim();
  for (let i = 0; i < 4; i += 1) {
    const next = s.replace(/^(?:[,;:.!?\s]+|(?:și|si|apoi|iar|dar|însă|insa|ci|sau)\s+)/i, "").replace(/(?:[\s,;:]+|\s+(?:și|si|apoi|iar|dar|însă|insa|ci|sau))$/i, "").trim();
    if (next === s) break;
    s = next;
  }
  // RR11: a sequence word left in front of the next request by the cut („… și după aceea repară bug-ul” → „repară bug-ul”).
  const lead = normalize(s).match(OUT_SEQUENCE_LEAD);
  if (lead) { const words = lead[0].trim().split(/\s+/).length; s = s.split(/\s+/).slice(words).join(" "); }
  return s;
}
/**
 * F4: the words a planner may receive. Every owner instruction to send / contact / publish (with its clause) and every quoted instruction is
 * cut out of `text`; what is left keeps its own words. → { text, refused: [{ kind, text }], quoted: [{ kind, text }], own: [{ kind, text }], changed, meaningful }.
 * `refused` are the owner's instructions (the caller shows OUTREACH_DISABLED); `quoted` are content (noted, never refused); `own` are the
 * owner's own statements („contactez eu firma”, RR10): cut out of the planner's words, never refused and never noted as refused. Pure.
 */
export function stripOutreach(text, { salesContext = false } = {}) {
  const raw = String(text ?? "");
  const s = outreachScan(raw, { salesContext });
  const ranges = [];
  for (const h of s.hits) {
    const c = h.clause;
    ranges.push({ start: s.seq[c.start].start, end: s.seq[c.end].end, kind: h.kind, quoted: false });
  }
  for (const q of s.quoted) ranges.push({ start: q.start, end: q.end, kind: q.kind, quoted: true });
  for (const h of s.selves) ranges.push({ start: s.seq[h.clause.start].start, end: s.seq[h.clause.end].end, kind: h.kind, quoted: false, own: true });
  if (!ranges.length) return { text: raw, refused: [], quoted: [], own: [], changed: false, meaningful: meaningfulRest(raw) };
  ranges.sort((a, b) => a.start - b.start);
  const merged = [];
  for (const r of ranges) { const last = merged.at(-1); if (last && r.start <= last.end) { last.end = Math.max(last.end, r.end); last.quoted = last.quoted && r.quoted; } else merged.push({ ...r }); }
  let out = "";
  let from = 0;
  for (const r of merged) { out += `${raw.slice(from, r.start)} `; from = r.end; }
  out += raw.slice(from);
  const rest = tidyRest(out);
  const said = (r) => ({ kind: r.kind, text: raw.slice(r.start, r.end).trim().slice(0, 200) });
  return { text: rest, refused: ranges.filter((r) => !r.quoted && !r.own).map(said), quoted: ranges.filter((r) => r.quoted).map(said), own: ranges.filter((r) => r.own).map(said),
    changed: true, meaningful: meaningfulRest(rest) };
}
/** F4: what the owner is told when the send / contact / publish part of a request was cut out and only the rest was planned. */
export const outreachCutNote = (refused = []) => `Partea „${refused.map((x) => String(x.text || "").slice(0, 80)).join("”, „")}” nu intră în plan: în M12 nu trimit, nu contactez și nu public nimic (OUTREACH_DISABLED); restul cererii l-am pregătit.`;
/** The note shown when a quoted instruction was kept out of a planner's words (it is content, never refused). */
export const QUOTED_OUTREACH_NOTE = "Textul dintre ghilimele cere o trimitere, o contactare sau o publicare: e un citat, nu o cerere către mine, așa că nu intră în plan (nimic nu se trimite, OUTREACH_DISABLED).";
/** RR10: what the owner hears when he only says what HE will do („Contactez eu firma”): no request to the Hub, nothing refused, nothing planned. */
export const OWN_OUTREACH_TEXT = "Bine: contactul îl faci tu, în afara Hub-ului (îl poți înregistra apoi manual în Vânzări). Eu nu trimit și nu contactez nimic; dacă vrei, pregătesc oferta („pregătește o ofertă pentru …”).";

// Stage before M12: questions about the system itself (owner/knowledge.mjs answers them from the Hub's real state).
/** The questions about the system the intent resolver routes to `system_knowledge` (normalized text; the topic is knowledgeTopic's). */
export const KNOWLEDGE_QUESTION = /\bce aplicati(?:i|ile)\b|\bce (?:programe|aplicatii) (?:ai|am|sunt|stii|poti)\b|\bce (?:e|ai|am) instalat\b|\b(?:ce|care) (?:conturi|modele)\b|\bce abonament|\bce (?:stii|poti) (?:sa )?(?:faci|folosesti)\b|\bce capabilitati\b|\bunde (?:e|sunt|gasesc|ai pus|ai salvat)\b.*\b(?:dosar|dosarul|fisier|fisierele|rezultat|rezultatele|livrare|livrarea|clip|clipurile|document|documentul|excel|excelul|campani|ofert)|\bce a (?:facut|produs|scris) codex\b|\bce a (?:gasit|spus|zis|observat) claude\b|\bce zice claude\b|\bce (?:e|este|sta) blocat\b/;
/** Which knowledge topic a question is about (diacritics folded), or null. Pure. */
export function knowledgeTopic(text) {
  const t = String(text || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (/\bce aplicati(i|ile)\b|\bce (programe|aplicatii) (ai|am|sunt|stii|poti)\b|\bce e instalat\b|\bce (ai|am) instalat\b/.test(t)) return "apps";
  if (/\b(ce|care) (conturi|modele)\b|\bce abonament/.test(t)) return "accounts";
  if (/\bce (stii|poti) (sa )?(faci|folosesti)\b|\bce capabilitati\b/.test(t)) return "capabilities";
  // M12 final review C5: „Unde sunt ofertele?” / „Unde e dosarul ofertei?” are locations too (answered with the offers' dossier).
  if (/\bunde (e|sunt|gasesc|ai pus|ai salvat)\b.*\b(dosar|dosarul|fisier|fisierele|rezultat|rezultatele|livrare|livrarea|clip|clipurile|document|documentul|excel|excelul|campani|ofert)/.test(t)) return "locations";
  if (/\bce a (facut|produs|scris) codex\b|\bce a scris codex\b/.test(t)) return "codex";
  if (/\bce a (gasit|spus|zis|observat) claude\b|\bce zice claude\b/.test(t)) return "claude";
  if (/\bce e blocat\b|\bce (este|e) blocat\b|\bce sta blocat\b/.test(t)) return "blocked";
  if (/\bce (faci|lucrezi) acum\b|\bce (ruleaza|e activ|e in lucru)\b/.test(t)) return "active";
  return null;
}

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
const ACK_REQUESTS = new Set(["studio_create", "engineering_request", "analysis_request", "start_mission", "resume_mission", "explain_mode", "sales_prepare", "sales_send",
  // M12 final review F17: the Sales reads and the continuation take a leading acknowledgement too („Ok, arată-mi oferta” was a project „oferta”).
  "sales_show", "sales_missing", "sales_approve_talk", "sales_continue", "desk_ops_prepare", "desk_support_prepare", "desk_finance_prepare", "desk_show"]);
/**
 * F17: in front of a Sales read or request a leading „Da, …” / „Sigur, …” is an acknowledgement as well („Da, arată-mi oferta”) — only
 * there: every other clause keeps it (the confirmation grammar reads „da” as consent), and a Sales read or request is never a consent.
 */
const SALES_ACK_LEAD = /^(?:(?:ok|okay|hai|haide|bine|da|sigur)(?:[\s,!.:;]+|$)|(?:(?:hei|hey|buna) )?lega(?:[\s,!.:;]+|$))+/;
const SALES_ACK_REQUESTS = new Set(["sales_prepare", "sales_send", "sales_show", "sales_missing", "sales_approve_talk", "sales_continue"]);

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
  const salesRest = lead.replace(SALES_ACK_LEAD, "");
  if (salesRest && salesRest !== lead) {
    const alt = prepCore(salesRest);
    const m = alt.text ? matchPattern(alt.text) : null;
    if (m && SALES_ACK_REQUESTS.has(m.intent)) return alt;
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
/**
 * Moods judged with the same rule but which are NOT interruptions: the unfreeze („Dezgheață X”) permits work again, so it runs only as a
 * clear imperative (strict: a mention, a question, a negation, a condition or a report never unfreezes). Kept apart from INTERRUPT_FORMS
 * so nothing else in the interruption path (splits, kept requests, stop answers) treats it as a stop.
 */
const MOOD_FORMS = Object.freeze({ ...INTERRUPT_FORMS,
  unfreeze_project: { strict: true, start: /^dezgheata\b/, command: /\bdezgheata\b/, verb: /\bdezghe(?:at|t)[a-z]*\b/, ask: null } });
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
  const form = MOOD_FORMS[intent] || INTERRUPT_FORMS.stop_all;
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
  // The unfreeze is no stop: nothing is promised „imediat” (by voice it is refused anyway; it is done from the cockpit).
  if (about === "unfreeze_project") {
    if (mood === "negation") return "Bine, nu dezgheț nimic.";
    if (mood === "conditional") return "Nu dezgheț condiționat, așa că nu am dezghețat nimic. Spune „Dezgheață” și numele proiectului când vrei.";
    const why = { ask: "ai întrebat", question: "a fost o întrebare", reported: "ai povestit ce s-a spus", quote: "era un citat", mention: "comanda nu era la începutul frazei" }[mood] || "nu era o comandă";
    return `Nu am dezghețat nimic: ${why}. Spune „Dezgheață” și numele proiectului când vrei.`;
  }
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

// ---------------------------------------------------------------- M12 Sales: the owner's offer words (normalized, anchored on the verb)
const OFFER_NOUN = String.raw`(?:oferta|oferte|ofertele|propunere(?:a)? comerciala|propunere(?:a)? de colaborare|propunere(?:a)? de pret|cotatie|cotatia|deviz|devizul)`;
/**
 * M12 final review F15 — the ONE rule for „this sentence asks for an offer”, shared by the resolver (sales_prepare) and the brief parser
 * (sales/brief.mjs, its intent): a preparation verb heading a clause („pregătește”, „fă”, „propune”, „aș dori”, „vreau” / „am nevoie de”
 * right before the noun) and, a few words later, the offer noun — between them only articles, adjectives, „și”, a pronoun („-mi”) or a
 * send / contact / publish verb (refused on its own: „Pregătește și trimite oferta …” is the card AND the refusal); or a clause that starts
 * with the noun itself and names its client („O ofertă pentru …”). A „propunere” of something else („propunerea de corectură”, a clip's or
 * a plan's) is no offer. A negated verb („nu pregăti oferta”) is no request. Every sentence the brief reads as an offer request is a
 * sales_prepare (ONE card), and the reverse.
 */
export const OFFER_PREPARE_VERBS = Object.freeze([["pregateste"], ["pregatesti"], ["pregatiti"], ["pregatim"], ["pregatesc"], ["pregateasca"], ["pregati"], ["fa"], ["faceti"], ["faci"],
  ["facem"], ["construieste"], ["redacteaza"], ["genereaza"], ["creeaza"], ["elaboreaza"], ["scrie"], ["scrieti"], ["propune"], ["propuneti"], ["vreau"], ["vrem"], ["as", "vrea"],
  ["as", "dori"], ["am", "nevoie", "de"]].map((p) => Object.freeze(p)));
export const OFFER_REQUEST_NOUNS = Object.freeze(["oferta", "oferte", "ofertei", "ofertele", "propunere", "propunerea", "propuneri", "propunerii", "deviz", "devizul", "cotatie", "cotatia"]);
const OFFER_WANT = new Set(["vreau", "vrem", "as", "am"]);
const OFFER_GAP = new Set(["si", "o", "un", "una", "niste", "cateva", "acea", "aceasta", "acest", "noua", "nou", "alta", "alt", "prima", "mi", "ne", "te", "rog", "acum", "repede", "rapid",
  "urgent", "frumos", "inca", "imediat"]);
/** What a „propunere” names when it is not an offer („propunerea de corectură” of a delivery, a plan's, a clip's). */
const OTHER_PROPOSAL = /^(?:corectur|corecti|corectar|modificar|schimbar|imbunatatir|plan|mesaj|text|clip|video|design|logo|titlu|nume|misiun|proiect|spec)/;
const offerNounAt = (seq, k) => {
  const t = String(seq[k]?.f || "").split("-")[0];
  if (!OFFER_REQUEST_NOUNS.includes(t)) return false;
  if (!/^propuner/.test(t)) return true;
  const next = String(seq[k + 1]?.f || "");
  const after = String(seq[k + 2]?.f || "");
  return !((next === "de" || next === "pentru" || next === "a" || next === "la") && OTHER_PROPOSAL.test(after)) && !OTHER_PROPOSAL.test(next);
};
/** RC1: words after „Oferta pentru X …” that make it a question or a statement about an existing offer, never a request for a new one. */
const OFFER_STATUS_WORDS = new Set(["e", "este", "sunt", "era", "erau", "fost", "gata", "aprobata", "aprobate", "aprobat", "trimisa", "trimise", "pregatita", "pregatite", "facuta",
  "facute", "terminata", "terminate", "scumpa", "scumpe", "ieftina", "buna", "bune", "corecta", "valabila", "arata", "costa", "contine", "are", "au", "s-a", "s-au"]);
/** Words that open the client's need after „O ofertă pentru <client>” („… cu nevoie de”, „… interesat de”). */
const OFFER_NEED_WORDS = new Set(["nevoie", "vrea", "vor", "doreste", "cauta", "interesat", "interesata", "interesati", "cu"]);
function offerStatementAfter(seq, from) {
  let described = false;
  for (let k = from; k < seq.length && k < from + 14; k += 1) {
    const t = String(seq[k]?.f ?? "");
    if (t === "?") return true;
    if (/^[,;:.!]$/.test(t)) return false;
    // FIXES_LAST L5: the client's own description („… care are nevoie de …”, „… care e în Cluj …”, „un CRM care trimite remindere”) says
    // nothing about the offer: after a relative word or a need marker only a question mark still makes it a question.
    if (OUT_RELATIVE.has(t) || OFFER_NEED_WORDS.has(t)) described = true;
    if (described) continue;
    if (OFFER_STATUS_WORDS.has(t) || outVerb(t)) return true;
  }
  return false;
}
/**
 * The first offer request in `seq` ([{ f }]: folded words, hyphenated forms may be one token, punctuation as its own token; a typo already
 * read as the verb / noun by the caller). `anchored`: only at the first token (a prepared clause). → { verb: [i, j] | null, noun, negated } | null
 */
export function offerRequestIn(seq, { anchored = false } = {}) {
  const at = (k) => String(seq[k]?.f ?? "").split("-")[0];
  const headAt = (k) => {
    if (k === 0) return true;
    for (let j = k - 1; j >= 0 && j >= k - 6; j -= 1) {
      const t = at(j);
      if (OUT_PUNCT.test(t) || OUT_JOINS.has(t)) return true;
      if (OUT_SA.test(seq[j]?.f || "")) return OUT_ASK.has(at(j - 1)) && headAt(j - 1);
      if (OUT_LEAD.has(t) || OUT_AUX.has(t) || t === "nu") continue;
      return false;
    }
    return k - 6 <= 0;
  };
  const negatedAt = (k) => at(k - 1) === "nu" || /^nu-/.test(seq[k - 1]?.f || "") || (OUT_SA.test(seq[k - 1]?.f || "") && at(k - 2) === "nu");
  for (let i = 0; i < seq.length; i += 1) {
    if (anchored && i > 0) break;
    if (!headAt(i)) continue;
    // „Scrie-le oferta” writes TO them (the call form, refused on its own): a verb with a person's pronoun is no preparation.
    const clitic = String(seq[i]?.f || "").split("-").slice(1).join("-");
    for (const phrase of clitic && !["mi", "ne"].includes(clitic) ? [] : OFFER_PREPARE_VERBS) {
      if (!phrase.every((w, n) => (n === 0 ? at(i) : seq[i + n]?.f) === w)) continue;
      const j = i + phrase.length - 1;
      const limit = OFFER_WANT.has(phrase[0]) ? 3 : 5;
      for (let k = j + 1; k < seq.length && k <= j + limit; k += 1) {
        if (offerNounAt(seq, k)) return { verb: [i, j], noun: k, negated: negatedAt(i) };
        const t = seq[k].f;
        if (OFFER_GAP.has(t) || outVerb(t)) continue;
        break;
      }
    }
    // „O ofertă pentru …”, „Ofertă nouă pentru …”: the noun itself heading a clause, with its client. RC1: never a question or a statement
    // about an offer that exists („Oferta pentru X e gata?”, „… a fost aprobată?”, „Oferta pentru X trimite-o mâine”).
    let k = i;
    if (["o", "un", "niste", "alta", "alt"].includes(at(k))) k += 1;
    if (offerNounAt(seq, k)) {
      const n = at(k + 1) === "noua" || at(k + 1) === "nou" ? k + 2 : k + 1;
      if (at(n) === "pentru" && !/^(?:clip|video|plan|misiun|proiect)/.test(at(n + 1)) && !offerStatementAfter(seq, n + 1)) return { verb: null, noun: k, negated: false };
    }
  }
  return null;
}
/**
 * The matcher of the pattern table (String.prototype.match calls it): an offer request heading a clause of the prepared clause — the brief's
 * own reading, so „Poți să-mi pregătești o ofertă …” (the filler kept with its pronoun) is the same request as „Pregătește o ofertă …”.
 */
const SALES_PREPARE = {
  source: [...OFFER_PREPARE_VERBS.flat(), ...OFFER_REQUEST_NOUNS].join(" "),
  [Symbol.match](s) {
    const { toks } = outTokens(String(s || ""), true);
    const r = offerRequestIn(toks);
    if (!r || r.negated) return null;
    const from = toks[r.verb ? r.verb[0] : r.noun].start;
    const m = [String(s).slice(from, toks[r.noun].end)];
    m.index = from; m.input = s;
    return m;
  },
};
/**
 * RC1: a question about an offer that exists („Ce ofertă ai pregătit pentru …?”, „Oferta pentru X e gata?”, „Ofertele … sunt gata?”) is the
 * read of the latest preparation (sales_show), never a new preparation card.
 */
const SALES_OFFER_QUESTION = /^(?:(?:ce|care|cate) (?:oferta|oferte|ofertele|propunere comerciala|propuneri comerciale)\b.*\b(?:ai|ati|a|au|s-a|s-au|am|e|este|sunt) (?:pregatit|facut|scris|gata|trimis|primit|aprobat|creat)\b|(?:oferta|ofertele|propunerea|propunerile) pentru(?! (?:clip|video|plan|misiun|proiect|corect))(?: (?!si\b)[a-z0-9-]+){1,8} (?:e|este|sunt|era|erau|a fost|au fost|s-a|s-au)\b|(?:oferta|ofertele)(?: (?!si\b)[a-z0-9-]+){0,8} (?:e|este|sunt|a fost|au fost|s-a|s-au) (?:deja )?(?:gata|aprobat\w*|trimis\w*|pregatit\w*|facut\w*|terminat\w*)\b)/;
/** „Arată-mi oferta”, „Deschide dosarul ofertei”: the latest prepared offer (navigation + a read; nothing changes). */
const SALES_SHOW = new RegExp(String.raw`^(?:(?:arata|deschide|afiseaza|vreau sa vad|adu|pune)(?:-mi|-ne)?|da-mi|da-ne)(?: si)?(?: (?:ultima|noua|cea mai noua|din nou))? (?:${OFFER_NOUN}|dosarul ofertei|dosarele ofertei)\b`);
/**
 * „Aprobă oferta”, „Aprob intern oferta”, „Poți să aprobi oferta?”: the Hub says WHERE the owner approves it; it never approves. Final review
 * C4: a „propunere” only as the commercial one („propunerea comercială / de preț”); a bare „Aprobă propunerea” only in a Sales conversation
 * (resolveIntent) — „Aprobă propunerea de corectură” keeps its earlier meaning.
 */
const SALES_APPROVE_TALK = /^(?:aproba|aprob|aprobati|aprobam|aprobi)(?:-o|-l)?(?: (?:si|tu|eu|acum|intern))* (?:(?:ultima|noua|aceasta|asta) )?(?:oferta|ofertele|oferte|propunerea comerciala|propunerea de pret|propunerile comerciale)\b/;
const SALES_APPROVE_TALK_CTX = /^(?:aproba|aprob|aprobati|aprobam|aprobi)(?:-o|-l)?(?: (?:si|tu|eu|acum|intern))* (?:(?:ultima|noua|aceasta|asta) )?(?:propunerea|propunerile)(?: acum| intern)?$/;
/**
 * „Ce lipsește din ofertă?”: the read answer from the latest preparation. Final review C4: only with the offer named (ofertă, propunerea
 * comercială, dosarul ofertei, devizul, cotația); „Ce lipsește din brief / din pregătire / din propunere?” and a bare „Ce lipsește?” count
 * only in a Sales conversation — a clip's brief, a demo's preparation or a correction proposal keep their earlier meaning.
 */
const SALES_MISSING = /^(?:(?:si|dar|deci) )?ce (?:mai )?lipseste\b.*\b(?:oferta|ofertei|ofertele|oferte|ofertelor|propunerea comerciala|propunerii comerciale|propunerea de pret|dosarul ofertei|dosarului ofertei|devizul|devizului|cotatia|cotatiei)\b/;
const SALES_MISSING_BARE = /^(?:(?:si|dar|deci) )?ce (?:mai )?lipseste(?: acum| inca)?$/;
const SALES_MISSING_CTX = /^(?:(?:si|dar|deci) )?ce (?:mai )?lipseste (?:din|in|la|pentru) (?:brief|brieful|briefului|pregatire|pregatirea|pregatirii|propunere|propunerea|propunerii)(?: acum| inca)?$/;
/**
 * M12 final review (with F1): „Continuă pregătirea ofertei”, „Reia oferta”, „Pregătește continuarea ofertei” → ONE continuation card of the
 * newest preparation that can be continued (the existing continueCard, through the Sales planner), or the truthful refusal. „Continuă
 * pregătirea” / „Pregătește continuarea” without the offer named only in a Sales conversation (resolveIntent).
 */
const SALES_CONTINUE = /^(?:(?:continua|continuam|reia|reluam|reporneste|relanseaza)(?: cu)? (?:(?:pregatirea|pregatirii|lucrul la|lucrul cu|munca la) )?(?:(?:ultimei|ultima|aceasta|asta|aceeasi) )?(?:ofertei|oferta|ofertele|ofertelor)|(?:pregateste|fa|da drumul la)(?:-mi)? continuarea (?:pregatirii )?(?:ofertei|ofertelor))(?: acum| te rog)?$/;
const SALES_CONTINUE_CTX = /^(?:(?:continua|continuam|reia|reluam)(?: cu)? (?:pregatirea|pregatirii)|(?:pregateste|fa)(?:-mi)? continuarea(?: pregatirii)?)(?: acum| te rog)?$/;
const SALES_SEND_SKIP = new Set(["sales_send"]);
// M13 „Birou intern” (normalized clauses). A preparation verb heads the clause; „arată …” / a question stays a read.
const DESK_VERB = String.raw`(?:te rog,? )?(?:pregateste|pregatesti|pregatiti|fa|faci|construieste|creeaza|genereaza|redacteaza|scrie|deschide|vreau|as vrea|as dori|am nevoie de)(?:-mi|-ne)? (?:si )?(?:un |o )?`;
const DESK_OPS = new RegExp(String.raw`^${DESK_VERB}(?:dosar(?:ul)? de pornire|pornirea proiectului|demararea proiectului|startul proiectului)\b`);
const DESK_FINANCE = new RegExp(String.raw`^${DESK_VERB}(?:deviz(?:ul)?|documentul comercial)\b(?=.*\b(?:ofert[a-z]* aprobat[a-z]*|din oferta|pe baza ofertei|registru|registrul)\b)`);
const DESK_SUPPORT = new RegExp(String.raw`^(?:te rog,? )?(?:(?:inregistreaza|deschide|creeaza|fa|adauga|pregateste)(?:-mi)? (?:un |o )?)?(?:caz(?:ul)?|tichet(?:ul)?|solicitare(?:a)?|cerere(?:a)?|sesizare(?:a)?) (?:noua |nou )?de suport\b`);
// M14: a desk READ. The internal number (OPS- / SUP- / DVZ-NNNN) names the record; without a number, „arată / afișează …” with the
// record's noun and nothing after it is the newest of that kind (or a choice when there are several). „Deschide …” reads only with a number
// („deschide cazul de suport pentru X: …” stays a new case). These rows come before the desk preparations and Sales („arată devizul” was the offer).
const DESK_NOUN = String.raw`(?:dosar(?:ul)? de pornire(?: a(?:l)? proiectului)?|dosar(?:ul)?|caz(?:ul)? de suport|caz(?:ul)?|deviz(?:ul)?|inregistrarea)`;
const DESK_NO = String.raw`(ops|sup|dvz)[ -]?0*(\d{1,6})`;
const DESK_SHOW_NO = new RegExp(String.raw`^(?:(?:arata|deschide|afiseaza|vreau sa vad|adu|da|unde e|unde este|ce stare are|care e starea)(?:-mi|-ne)? (?:si )?)?(?:${DESK_NOUN} )?(?:(?:intern|sintetic) )?${DESK_NO}[.!?]*$`);
const DESK_SHOW_KIND = new RegExp(String.raw`^(?:arata|afiseaza|vreau sa vad|adu|da)(?:-mi|-ne)? (?:(?:ultimul|ultima|cel mai nou|cea mai noua) )?(dosarul de pornire(?: a(?:l)? proiectului)?|cazul de suport|cazurile de suport|devizul|devizele)(?: (?:intern|sintetic|in ciorna))?[.!?]*$`);
/** „Ce lipsește din devizul DVZ-0001?” — the record's own open items (its next action), never the Sales offer. */
const DESK_MISSING_NO = new RegExp(String.raw`^(?:(?:si|dar|deci) )?ce (?:mai )?lipseste\b.*\b${DESK_NO}[.!?]*$`);
const DESK_KIND_OF_PREFIX = Object.freeze({ ops: "ops_start", sup: "support_case", dvz: "finance_doc" });
const deskKindOfNoun = (noun) => (/^dosar/.test(noun) ? "ops_start" : /^caz/.test(noun) ? "support_case" : /^deviz/.test(noun) ? "finance_doc" : null);
function deskShowNoArgs(m, clause) {
  const asked = clause.match(/\b(dosar(?:ul)? de pornire|caz(?:ul)? de suport|deviz(?:ul)?)\b/);
  return { internalNo: `${m[1].toUpperCase()}-${m[2].padStart(4, "0")}`, kind: DESK_KIND_OF_PREFIX[m[1]], askedKind: asked ? deskKindOfNoun(asked[1]) : null };
}
/** F4: the steps whose words a planner receives; one left with nothing else to ask once the outreach clause is cut out is dropped. */
const OUTREACH_STRIPPED_PLANNERS = new Set(["engineering_request", "analysis_request", "studio_create", "sales_prepare", "delivery_prepare", "delivery_revise", "start_mission", "resume_mission", "continue_work"]);

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
  // M12 final review: the continuation of an offer's preparation — before resume_mission („Reia lucrul la ofertă” is no mission).
  ["sales_continue", SALES_CONTINUE],
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
  // M12 final review C5: „Unde e dosarul ofertei?” is about the offers' dossier (knowledge.mjs answers it, not the last delivery folder).
  ["system_knowledge", KNOWLEDGE_QUESTION, (m, c) => ({ topic: knowledgeTopic(c) || "overview", ...(/\bofert/.test(c) ? { about: "offers" } : {}) })],
  ["why_route", /\bde ce (?<who>claude|codex)\b/, (m) => ({ worker: m.groups.who })],
  ["twin_why", /\bde ce (am ales|am decis|am hotarat|folosim|avem|am pus|am schimbat|am trecut pe) (?<what>.+)/, (m) => ({ what: m.groups.what })],
  ["start_view", /\b(porneste|deschide|incepe) (direct |mereu |intotdeauna )?(in|cu) (?<v>ecran(ul)? complet|lega|scena|cockpit(ul)?)\b/, (m) => ({ startView: /cockpit/.test(m.groups.v) ? "cockpit" : "stage" })],
  ["fullscreen", /\becran(ul)? complet\b|\bpe tot ecranul\b|\bfullscreen\b|\bmod(ul)? lega\b/],
  ["cockpit_view", /^(cockpit(ul)?|arata(-mi)? cockpit(ul)?|iesi din ecran(ul)? complet|ecran normal)$/],
  ["details", /^(detalii|arata(-mi)? detaliile|mai multe detalii|vreau detalii)$/],
  // M12 Sales (S-07, T-S3) — before the delivery, clip, plan and project patterns („Arată-mi oferta” was a project named „oferta”).
  // Sending, contacting or publishing (the verb STARTS the clause; send / publish only within the Sales scope, checked in resolveIntent) is
  // REFUSED with OUTREACH_DISABLED; preparing an offer is ONE plan card; showing it navigates; „aprobă oferta” and „ce lipsește din ofertă”
  // are reads the Hub answers (it never approves, it never creates an approval).
  // M13 „Birou intern” — before the Sales rows: „pregătește devizul din oferta aprobată” is the deviz of an APPROVED offer (Finance), never a
  // new offer; „dosarul de pornire a proiectului” is the Operations start dossier; „caz de suport …” a support case (its text kept whole).
  ["desk_show", DESK_SHOW_NO, deskShowNoArgs],
  ["desk_show", DESK_SHOW_KIND, (m) => ({ kind: deskKindOfNoun(m[1]), internalNo: null })],
  ["desk_show", DESK_MISSING_NO, (m, clause) => ({ ...deskShowNoArgs(m, clause), missing: true })],
  ["desk_ops_prepare", DESK_OPS, (_m, clause) => ({ request: clause })],
  ["desk_finance_prepare", DESK_FINANCE, (_m, clause) => ({ request: clause })],
  ["desk_support_prepare", DESK_SUPPORT, (_m, clause) => ({ request: clause })],
  ["sales_send", SALES_SEND, salesSendArgs],
  ["sales_show", SALES_OFFER_QUESTION],
  ["sales_prepare", SALES_PREPARE],
  ["sales_approve_talk", SALES_APPROVE_TALK],
  ["sales_show", SALES_SHOW],
  ["sales_missing", SALES_MISSING],
  // M10 Desktop Operator — BEFORE studio_open ("deschide OBS Studio" is the app, not the Studio page) and open_project ("deschide
  // CapCut" is not a project). Only known app names match; "importă din folderul acesta" reads the Explorer window in front.
  // M11 „Ifrim Delivery” — before the capture / clip / Studio patterns: a sentence that asks for the demo prepared for a presentation
  // (with a clip and the commercial summary in it) is ONE delivery plan, never a clip alone or a capture alone.
  ["delivery_decisions", /^(?:arata(?:-mi)? )?deciziile (?:mele|tale|in asteptare)\b/, () => ({ decisions: true })],
  ["delivery_open", /\barata(?:-mi)? ce (?:ai|mi-ai) pregatit\b|\b(?:deschide|arata(?:-mi)?) (?:camera de livrare|livrarea demo-ului|livrarea pregatita)\b/],
  ["delivery_prepare", /^(?:pregateste|fa|construieste|livreaza)(?:-mi|-ne)? (?:si )?(?:demo-ul|demoul|demo|livrarea|prezentarea)\b(?=.*\b(?:prezentare|prezentarea|client|livrare|clip|rezumat|demo|demo-ul|demo-ului|demoului|word|excel|document|campanie|dosar)\b)|^pregateste(?:-mi)? livrarea\b/, (_m, clause) => ({ request: clause })],
  ["delivery_revise", /\b(?:clipul|videoclipul|clip-ul|montajul|varianta verticala)\b.*\b(?:prea (?:tehnic|comercial|lung|scurt)|mai (?:scurt|comercial|simplu))\b|\bdupa secunda\b.*\barata direct\b|^in rezumat\b|\b(?:butonul|formularul|pagina|site-ul) de (?:programare|programari)\b.*\btrebuie sa\b/, (_m, clause) => ({ request: clause })],
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
  // M12 (T-S3): „Nu trimite oferta”, „nu contacta pe nimeni”, „fără să trimiți / contactezi nimic” only narrow the request (never a refusal).
  // Final review F16: the fused forms too („Nu-i trimite oferta”, „Nu-l contacta”, „n-o trimite”, „să nu-i trimiți”, „fără s-o trimiți”).
  if (/\b(?:(?:sa )?nu(?:-(?:i|l|le|o|ii|il))?|n-o|fara sa(?:-(?:i|l|le))?|fara s-o|fara a) (?:(?:o|il|le|i|ii|mai) )?(?:trimite|trimiteti|trimiti|trimitem|contacta|contactati|contacteaza|contactezi|contactam|publica|publicati|posta|posteaza|transmite|transmiti|transmiteti|retrimite|retrimiti|expedia|expediaza|expediezi|suna|suni|sunati|publici|postezi|distribui|distribuie|distribuiti|forwardeaza)\b|\bfara (?:contact|contactare|contactarea|trimiterea)\b/.test(clause)) c.noMessages = true;
  if (/\bnu (porni|pornesti|incepe|incepi|rula|rulezi|executa|executi|lansa|lansezi|confirma|confirmi)\b|\bnu (acum|inca)\b|\bsa nu (pornesti|incepi|rulezi|executi|lansezi|confirmi|pornim|incepem|executam|faci nimic)\b|\bdoar (arata|spune|explica|planul)\b|\bfara sa (pornesti|incepi|rulezi|executi|pornim)\b/.test(clause)) c.noStart = true;
  // Review M10.2 #24: with the unanchored hold now below the code requests, "Repară bug-ul de la login mai târziu" resolves to the
  // request — the delay must still remove the start (a preview-only plan, never an armed one). "care / ce / se așteaptă" describes.
  if (/\bmai tarziu\b|(?<!\b(?:care|ce|se|il|o|te|ma|ne|va|le) )\basteapta\b|\bnu inca\b/.test(clause)) c.noStart = true;
  if (/\bdoar (citire|citeste)\b|\bfara modificari\b/.test(clause)) c.readOnly = true;
  // M11: „Nu publica nimic” is a constraint of the request (attached, hashed in the plan), not an unknown sentence; publishing is denied anyway.
  if (/\bnu (publica|publici|posta|posteaza|postezi|distribui|distribuie|urca|incarca)\b|\bfara (publicare|postare|upload|incarcare)\b/.test(clause)) c.noPublish = true;
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

/**
 * M12 (T-S3): matchPattern with the outreach rule: a clause that starts with a send / contact / publish verb is sales_send only when that
 * verb is an instruction to the Hub (the ONE rule, outreachScan: a Sales object or addressee, a pronoun with the Sales vocabulary of the
 * `sentence` or right after a Sales step); „Trimite un mesaj de probă” keeps whatever it meant before (P0R5-04).
 */
function matchScoped(text, sentence, skip = null, salesContext = false) {
  const m = matchPattern(text, skip);
  if (m?.intent !== "sales_send" || outreachScan(text, { normalized: true, salesContext, scopeText: sentence }).hits.some((h) => h.i === 0)) return m;
  return matchPattern(text, skip ? new Set([...skip, ...SALES_SEND_SKIP]) : SALES_SEND_SKIP);
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
  "engineering_request", "analysis_request", "delivery_prepare", "sales_prepare", "sales_continue", "desk_ops_prepare", "desk_support_prepare", "desk_finance_prepare"]);
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
/** M12: an offer request describes its client („pentru un service care vrea programări când sună clienții”): only an explicit condition holds it. */
const SALES_INTENTS = new Set(["sales_prepare"]);
/** M13: a desk request carries its own text (a support request „… întreabă dacă …”): only an explicit condition („doar dacă …”) holds it. */
const DESK_INTENTS = new Set(["desk_ops_prepare", "desk_support_prepare", "desk_finance_prepare"]);
const TOPIC_MARK = /\b(?:despre|pentru|cu tema|pe tema|cu subiectul)\b/;
const RELATIVE_MARK = /\b(?:care|ce|unde|cum|atunci)\b/;
const EXPLICIT_COND = { clip: /^(?<head>.+?)[\s,]+(?<word>doar daca|numai daca|doar dupa|numai dupa|dupa ce) (?<cond>.+)$/, code: /^(?<head>.+?)[\s,]+(?<word>doar daca|numai daca|doar dupa|numai dupa|doar cand|numai cand) (?<cond>.+)$/ };
function descriptiveCondition(intent, head, word) {
  const strong = /^(?:doar|numai) /.test(word);
  if (strong) return null;
  if (CLIP_INTENTS.has(intent) && word !== "dupa ce" && (TOPIC_MARK.test(head) || /\bde$/.test(head))) return "clip";
  if (CODE_INTENTS.has(intent) && (RELATIVE_MARK.test(head) || /\bde$/.test(head))) return "code";
  if (SALES_INTENTS.has(intent) && (RELATIVE_MARK.test(head) || TOPIC_MARK.test(head) || /\bde$/.test(head))) return "code";
  if (DESK_INTENTS.has(intent)) return "code";
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
  "twin_impact", "twin_why", "objective_plan", "incident_open", "teach", "forget", "start_mission", "resume_mission", "studio_create", "gate_rearm", "delivery_prepare", "delivery_revise",
  // M12: an offer request is the owner's whole sentence (its brief); a send verb inside it is refused as a step of its own (resolveIntent).
  "sales_prepare",
  // M13: a desk request (its support text included) is the owner's whole sentence.
  "desk_ops_prepare", "desk_support_prepare", "desk_finance_prepare"]);
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
    // M12 final review F15: „Contactez eu firma, tu pregătește o ofertă …” — the right half addressed with „tu” is a request of its own.
    // M14: „Arată dosarul OPS-0001 și devizul DVZ-0001” — two desk reads, each naming its record by number.
    const deskPair = DESK_SHOW_NO.test(r) && DESK_SHOW_NO.test(prepClause(left).text);
    if (!RIGHT_VERB.test(r) && !(/^tu /.test(r) && RIGHT_VERB.test(r.slice(3))) && !deskPair) continue;
    const l = prepClause(left).text;
    const rm = matchScoped(r, clause, null, context.salesContext === true);
    // Review F1: words that only talk about the stop („Nu opri tot, oprește doar Codex”) are a half of their own next to an interruption.
    const lm = matchScoped(l, clause, null, context.salesContext === true) || (rm && INTERRUPT_INTENTS.has(rm.intent) && STOP_MENTION.test(l) ? { intent: "explain_stop", args: {} } : null);
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
let patternWordsAdded = false;
export function resolveIntent(text, context = {}) {
  if (!patternWordsAdded) {
    patternWordsAdded = true;
    const words = new Set([...Object.keys(VERB_FORMS), ...Object.values(VERB_FORMS)]);
    for (const [, re] of P) for (const w of String(re.source).replace(/[^a-z-]+/g, " ").split(" ")) if (w.length >= 4) words.add(w.replace(/^-+|-+$/g, ""));
    addKnownWords(words);
  }
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
  // Stage before M12 (§5): a missing, swapped or extra letter („regătește”) and the usual transcription slips, recorded for audit; never
  // into a confirmation, a stop, a negation or an outward effect (owner/typos.mjs).
  const typo = correctTypos(norm, { protect: (context.projects || []).flatMap((p) => [normalize(p.name), normalize(p.slug || "")]) });
  norm = typo.text;
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
  const pieces = norm.split(/(;|\. |!|\? | (?:si )?apoi | (?:si )?dupa aceea | (?:si )?dupa aia | (?:si )?dupa care | iar apoi )/);
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
    // M12 final review C4: in a Sales conversation (the server's last target was the offer or its card) the words that name the offer only
    // by context — „Ce lipsește din brief?”, „Aprobă propunerea”, „Continuă pregătirea” — are the offer's; elsewhere they keep their meaning.
    // RR9: a leading acknowledgement („Ok, ce lipsește?”, „Da, aprobă propunerea”) is dropped before these reads too — never a confirmation.
    const tAck = context.salesContext === true && t ? t.replace(SALES_ACK_LEAD, "").trim() : t;
    if (!found && t && context.salesContext === true) {
      if (SALES_CONTINUE_CTX.test(t) || SALES_CONTINUE_CTX.test(tAck)) found = { intent: "sales_continue", args: {} };
      else if (SALES_APPROVE_TALK_CTX.test(t) || SALES_APPROVE_TALK_CTX.test(tAck)) found = { intent: "sales_approve_talk", args: {} };
      else if (SALES_MISSING_CTX.test(t) || SALES_MISSING_CTX.test(tAck)) found = { intent: "sales_missing", args: { bare: true } };
      else if (tAck !== t && SALES_MISSING_BARE.test(tAck)) found = { intent: "sales_missing", args: { bare: true } };
    }
    if (!found && t) { const m = matchScoped(t, norm, null, context.salesContext === true); if (m) found = { intent: m.intent, args: m.args }; }
    // C4: „Deschide devizul din ProDelivery” is that project's estimate (a project named after the noun), not the synthetic offer.
    if ((found?.intent === "sales_show" || found?.intent === "sales_missing") && (context.projects || []).length && namedProjectOf(t, context.projects)?.matches?.length) {
      const m = matchScoped(t, norm, new Set(["sales_show", "sales_missing"]), context.salesContext === true);
      found = m ? { intent: m.intent, args: m.args } : null;
    }
    // „Pregătește din nou oferta” (the offer, nothing new about it) continues the offer's preparation; a new request names its client.
    if (found?.intent === "sales_prepare" && prep.again && /^(?:pregateste|fa|refa)(?:-mi)? (?:(?:aceeasi|ultima) )?(?:oferta|ofertele)$/.test(t)) found = { intent: "sales_continue", args: { again: true } };
    // M12: a bare „Ce lipsește?” is the offer's read only in a Sales conversation (the server's last target was the offer or its card).
    if (!found && context.salesContext === true && SALES_MISSING_BARE.test(t)) found = { intent: "sales_missing", args: { bare: true } };
    // P0-R6 (L11): „Treci pe live” names a project when one is called exactly so; otherwise it is the mode, answered (explain_mode).
    if (found?.intent === "explain_mode" && (context.projects || []).some((p) => flatName(p.name) === flatName(found.args.target) || flatName(p.slug) === flatName(found.args.target))) {
      found = { intent: "open_project", args: { projectRef: found.args.target } };
    }
    // 2.12.2 (P0-R2): an interruption runs only on a clear imperative; a clause that only talks about one becomes explain_stop. The rearm
    // card (D21: „Redeschide poarta după Stop All” before any stop), the last-target repeat and the addressed bare stop keep their rules.
    // R2-F3: whether the clause's first verb was indicative („Oprești tot, da?”) before prepClause made it the imperative.
    const conjugated = CONJUGATED_INTERRUPT.test(softTrim(stripFillers(clause)));
    if (t && !(found && (found.intent === "gate_rearm" || found.intent === "reopen_last" || found.args?.addressed))) found = imperativeOnly(found, t, { asks, modal, conjugated });
    // The unfreeze runs only as a clear imperative („Dezgheață X”); „Dezgheață X?”, „Dacă pică testele, dezgheață X”, „Nu dezgheța X”,
    // „Ieri am zis dezgheață X” are answered, and nothing is unfrozen.
    if (t && found?.intent === "unfreeze_project") {
      const mood = interruptMood(t, { asks, modal, intent: "unfreeze_project", conjugated });
      if (mood !== "imperative") found = { intent: "explain_stop", args: { mood, about: "unfreeze_project" } };
    }
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
  // M11: a delivery request is ONE step. The sentences that detail it („Verifică programările pe mobil, repară problema convenită, fă un
  // clip și pregătește-mi rezumatul comercial”) belong to the same plan (capture, clip and summary are in it), never extra plans; the
  // clauses of one revision („Site-ul e bine, dar clipul e prea tehnic. După secunda 10 …”) are classified together. An interruption
  // or a confirmation is never absorbed.
  const DELIVERY_DETAIL = new Set(["unknown", "studio_create", "ops_capture_vertical", "engineering_request", "show_preview", "show_tests", "studio_variant", "delivery_prepare"]);
  const prepIndex = steps.findIndex((s) => s.intent === "delivery_prepare");
  if (prepIndex >= 0) {
    for (let i = steps.length - 1; i > prepIndex; i--) {
      if (!DELIVERY_DETAIL.has(steps[i].intent) || steps[i].args?.refusedConfirmation) continue;
      const [detail] = steps.splice(i, 1);
      Object.assign(steps[prepIndex].constraints, detail.constraints || {});
      steps[prepIndex].args = { ...steps[prepIndex].args, details: [detail.text, ...(steps[prepIndex].args.details || [])].filter(Boolean) };
    }
  }
  for (let i = steps.length - 1; i > 0; i--) {
    if (steps[i].intent === "delivery_revise" && ["delivery_revise", "unknown"].includes(steps[i - 1].intent)) {
      const [later] = steps.splice(i, 1);
      steps[i - 1] = { ...steps[i - 1], intent: "delivery_revise", effect: INTENT_EFFECTS.delivery_revise, args: { ...steps[i - 1].args, request: `${steps[i - 1].text || steps[i - 1].args?.request || ""} ${later.args?.request || later.text || ""}`.trim() }, constraints: { ...steps[i - 1].constraints, ...later.constraints } };
    }
  }
  // M12 (T-S3): a send / contact / publish verb said INSIDE another request („Pregătește oferta pentru … și trimite-o clientului”, „Deschide
  // ProDelivery și contactează-i”) is refused as a step of its own (OUTREACH_DISABLED): the rest of the sentence keeps its meaning and the
  // outreach never becomes work. An unknown clause that is only that verb („…. Trimite-o.”) becomes the refusal; a negated one never does.
  // Final review F4: the outreach clause also leaves the words of every other step (a planner never receives „și trimite oferta
  // clientului”); a planner step left with nothing else to ask is dropped (the refusal answers it).
  const outreach = outreachScan(norm, { normalized: true, salesContext: context.salesContext === true });
  // RR4: the normalized words lose the colon of „Repară X: la checkout, trimite …” (a problem described, no instruction): a hit the scan of
  // the owner's own words does not hold (the same verb, counted in order) is no instruction either.
  if (outreach.hits.length && /:/.test(raw)) {
    const own = outreachScan(raw, { salesContext: context.salesContext === true });
    const nth = (seq, i) => seq.slice(0, i).filter((t) => t.f === seq[i].f).length;
    outreach.hits = outreach.hits.filter((h) => {
      const k = nth(outreach.seq, h.i);
      const ri = own.seq.findIndex((t, j) => t.f === outreach.seq[h.i].f && nth(own.seq, j) === k);
      return ri < 0 || own.hits.some((x) => x.i === ri);
    });
  }
  // RR10: the owner's own statement („contactez eu firma”) is never refused; it only leaves the words of every other step.
  const ownCuts = outreach.selves.map((h) => norm.slice(outreach.seq[h.clause.start].start, outreach.seq[h.clause.end].end).trim()).filter(Boolean);
  if (outreach.hits.length || ownCuts.length) {
    if (outreach.hits.length && !steps.some((s) => s.intent === "sales_send")) {
      const words = new Set(outreach.hits.map((h) => h.word));
      const args = { reason: SALES_SEND_REASON, kind: outreach.hits[0].kind, word: outreach.hits[0].word, embedded: true };
      const at = steps.findIndex((s) => s.intent === "unknown" && !s.args?.refusedConfirmation && !s.args?.continueQuestion && String(s.text || "").split(/\s+/).some((w) => words.has(w)));
      if (at >= 0) steps[at] = { intent: "sales_send", args: { ...args, embedded: false }, constraints: steps[at].constraints || {}, effect: INTENT_EFFECTS.sales_send, text: steps[at].text };
      else steps.push({ intent: "sales_send", args, constraints: {}, effect: INTENT_EFFECTS.sales_send, text: outreach.hits[0].word });
    }
    const cuts = [...outreach.hits.map((h) => norm.slice(outreach.seq[h.clause.start].start, outreach.seq[h.clause.end].end).trim()), ...ownCuts].filter(Boolean).sort((x, y) => y.length - x.length);
    const cut = (v) => { let out = String(v); let hit = false; for (const c of cuts) if (out.includes(c)) { out = out.split(c).join(" "); hit = true; } return hit ? tidyRest(out) : String(v); };
    for (let k = steps.length - 1; k >= 0; k -= 1) {
      const step = steps[k];
      if (step.intent === "sales_send") {
        // RR11: „Trimite oferta clientului și te rog repară bug-ul de login” — the refused clause took the whole clause; the request after
        // it is the owner's own and is kept as its own step(s) (never a confirmation or an authority, which a split never manufactures).
        const rest = !context.outreachRest && !step.args?.embedded && typeof step.text === "string" ? cut(step.text) : "";
        if (rest && rest !== step.text && meaningfulRest(rest)) {
          const known = (words) => resolveIntent(words, { ...context, source, outreachRest: true }).steps.filter((s) => !["unknown", "sales_send"].includes(s.intent) && !NEVER_A_HALF.has(s.intent));
          let more = known(rest);
          // „… și mâine fă un clip”, „… și la ProDelivery repară bug-ul”: the request's verb leads, the words before it follow.
          const words = rest.split(" ");
          const verb = words.findIndex((w, n) => n > 0 && OUT_NEXT_VERB.test(w));
          if (!more.length && verb > 0) more = known([...words.slice(verb), ...words.slice(0, verb)].join(" "));
          if (more.length) steps.splice(k + 1, 0, ...more);
        }
        continue;
      }
      const before = JSON.stringify([step.text, step.args?.request, step.args?.task, step.args?.details]);
      if (typeof step.text === "string") step.text = cut(step.text);
      if (step.args && typeof step.args.request === "string") step.args = { ...step.args, request: cut(step.args.request) };
      if (step.args && typeof step.args.task === "string") step.args = { ...step.args, task: cut(step.args.task) };
      if (Array.isArray(step.args?.details)) step.args = { ...step.args, details: step.args.details.map(cut).filter((d) => meaningfulRest(d)) };
      const changed = before !== JSON.stringify([step.text, step.args?.request, step.args?.task, step.args?.details]);
      if (changed && (OUTREACH_STRIPPED_PLANNERS.has(step.intent) || step.intent === "unknown") && !meaningfulRest(step.args?.request ?? step.text ?? "")) steps.splice(k, 1);
    }
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

  const out = { utterance: raw, normalized: norm, source, quotedConfirm, steps: [], clarification: null, refused: [], ...(typo.corrections.length ? { corrections: typo.corrections } : {}) };
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
  // Stage before M12 (§5): a slip of a word Lega never corrects (a stop, a confirmation, a publication) is ONE question, never the act.
  // M12: a sentence already refused for outreach is not asked about again; a slip of a send / contact / publish verb is answered with the
  // refusal's reason (nothing is sent, whatever the spelling), never with „scrie-o din nou”.
  if (typo.suspects.length && !out.clarification && !out.steps.some((s) => s.intent === "sales_send") && out.steps.every((s) => s.intent === "unknown" || s.effect === "read" || s.effect === "none")) {
    const s = typo.suspects[0];
    const outreachVerb = Object.values(OUTREACH_HEAD_SETS).some((set) => set.has(s.to));
    out.clarification = { question: outreachVerb ? `Ai vrut să spui „${s.to}”? Trimiterea, contactarea și publicarea sunt dezactivate (OUTREACH_DISABLED): nu trimit, nu contactez și nu public nimic.`
      : `Ai vrut să spui „${s.to}”? Nu execut o comandă scrisă greșit; scrie-o din nou exact dacă asta vrei.`, options: [], forIntent: "unknown", suspect: s };
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

const DEICTIC_PROJECT = /^(?:proiectul|tot proiectul|asta|acesta|aceasta|aici|acest proiect|proiectul (?:acesta|asta|curent|deschis|de aici)|proiectul (?:pe care|la care) (?:sunt|suntem|lucram|lucrez))$/;
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
  // A named project that matched nothing (or several) is never replaced by the open one: the autonomy, the freeze and the unfreeze act
  // only on the project the words named, the open one when they named none, or after the question. „Proiectul (acesta)” is the open one.
  if (["autonomy", "freeze_project", "unfreeze_project"].includes(step.intent) && !step.args.projectId && DEICTIC_PROJECT.test(String(step.args.projectRef || "").trim())) {
    step.args.projectId = context.currentProjectId || null;
    delete step.args.unknownRef;
  }
  if (step.intent === "autonomy" && !step.args.projectId && !step.args.projectRef) step.args.projectId = context.currentProjectId || null;
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
