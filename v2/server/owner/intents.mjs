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
 *
 * Pure function; the caller supplies the context (projects, current project, missions, pending envelopes).
 */
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

/** Removes quoted passages (a "confirm" quoted from a document or a page is not the owner's consent). */
function unquote(norm) {
  const parts = norm.split("\u0001");
  return parts.filter((_, i) => i % 2 === 0).join(" ").replace(/\s+/g, " ").trim();
}

const STOP_WORDS = new Set(["la", "pe", "cu", "de", "si", "in", "din", "pentru", "proiectul", "proiect", "misiunea", "problema", "lucram", "hai", "sa", "ne", "mai", "un", "o", "al", "ale", "a"]);
const stem = (w) => w.replace(/(urilor|urile|elor|ilor|ului|ele|ile|uri|lor|ul|le|ii|ei|ea|a|e|i)$/, "") || w;
const tokens = (s) => normalize(s).replace(/\u0001/g, " ").split(/[\s.,;!?-]+/).filter((w) => w && !STOP_WORDS.has(w));

/** Best matches of a free reference among named items (projects or missions): full-name hits first, then token overlap. */
export function matchRef(ref, items, { name = (x) => x.name, extra = () => [] } = {}) {
  const want = tokens(ref).map(stem).filter((w) => w.length >= 2);
  if (!want.length) return [];
  const scored = items.map((item) => {
    const names = [name(item), ...extra(item)].filter(Boolean);
    let best = 0;
    for (const n of names) {
      const nn = normalize(n).replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
      const words = tokens(n).map(stem);
      const compact = nn.replace(/ /g, "");
      const refCompact = want.join("");
      if (compact && (compact === refCompact || nn === want.join(" "))) { best = Math.max(best, 100); continue; }
      const hits = want.filter((w) => words.some((x) => x === w || (w.length >= 4 && (x.startsWith(w) || w.startsWith(x))))).length;
      if (hits) best = Math.max(best, Math.round((hits / Math.max(want.length, words.length)) * 80) + (hits === want.length ? 10 : 0));
      if (refCompact.length >= 5 && compact.includes(refCompact)) best = Math.max(best, 70);
    }
    return { item, score: best };
  }).filter((x) => x.score >= 30).sort((a, b) => b.score - a.score);
  if (!scored.length) return [];
  const top = scored[0].score;
  return scored.filter((x) => x.score >= top - 5).map((x) => x.item);
}

// Pattern table: [intent, regex on the normalized clause, (match, clause) => args]. First match wins per clause.
const P = [
  ["stop_all", /\b(opreste|stop|opriti) (tot|totul|toate)\b|\bstop all\b/],
  ["takeover", /\bpreiau eu\b|\blas(a|ati)[- ]ma pe mine\b|\bpreiau (controlul|de aici)\b/],
  ["freeze_project", /\bingheata (?<ref>.+)/, (m) => ({ projectRef: m.groups.ref })],
  ["unfreeze_project", /\bdezgheata (?<ref>.+)/, (m) => ({ projectRef: m.groups.ref })],
  ["stop_worker", /\bopreste (?<who>codex|claude|writerul|writer|reviewerul|reviewer|agentul|workerul)\b/, (m) => ({ worker: /claude|review/.test(m.groups.who) ? "claude" : /codex|writer/.test(m.groups.who) ? "codex" : "any" })],
  // M09: live capture off (MEDIA_B rollback) — only reduces activity, so it is accepted from every channel.
  ["capture_off", /\b(opreste|stop|opriti|inchide) (captura|capturile|captura live|inregistrarea ecranului|filmarea ecranului|filmarea)\b/],
  ["mute", /^(taci|liniste|nu mai vorbi|gata cu vorba|opreste vocea|mut)\b|\bnu mai vorbi\b|\btaci\b/],
  // M10: start the voice assistant. Anchored on the whole clause: a leading "lega," is stripped before matching, so "Lega,
  // pornește" stays the plan confirmation below; "deschide <proiect>", "modul Lega", "nu porni" keep their own intents.
  ["lega_start", /^(porneste|deschide|activeaza|trezeste)( pe)? lega$|^(vreau sa vorbesc|hai sa vorbim|sa vorbim) cu lega$|^porneste vocea( lega)?$/],
  // A confirmation is an answer, anchored at the start ("da", "execută planul"); "nu porni" or "doar planul" never match it.
  ["confirm", /^(da|da,? (fa-l|fa-o|fa|porneste|executa|te rog)|confirm|confirma|confirmat|executa planul|porneste|da,? executa planul|ok,? porneste|da,? porneste)( planul)?$/],
  ["pause", /^(pauza|pune pe pauza|pune pauza)\b|\bpune (totul )?pe pauza\b|\bia o pauza\b/],
  ["quiet", /\bnu ma deranja\b|\bfara notificari\b|\bmod linistit\b/, (m, c) => ({ onlyDecisions: /\bdecat (pentru|daca|la) (o )?decizi/.test(c) || /\bdoar (pentru|la) decizi/.test(c) })],
  ["notify_normal", /\b(poti sa ma (anunti|deranjezi)|notificari normale|anunta-ma)\b/],
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
  ["studio_import_here", /\bimporta(-l|-le|-mi)?( (proiectul|clipul|materialele|fisierele|tot|video-ul|montajul))?( (din|de (in|la))( (folderul|dosarul|locul))? ?(acesta|asta|deschis|curent|de aici|aici)| de aici)\b/],
  ["studio_variant", /\b(pregateste|fa|randeaza|genereaza|scoate)(-mi)? (si )?(varianta|versiunea|formatul) (?<fmt>verticala|vertical|9 16|tiktok|reels|shorts|patrata|linkedin|youtube)\b/, (m) => ({ format: m.groups.fmt })],
  ["ops_continue", /^(continua|continua planul|continua acum|reia|reia planul|mergi mai departe|poti continua|gata,? continua|ok,? continua)$/],
  // M09 Content Studio — BEFORE simulate / incident_open / status / show_preview / open_project, which would otherwise swallow
  // "arată-mi clipul" (a project named „clipul”), "preview-ul clipului" (the factory preview) or "la secunda 12 …".
  // "Publică clipul" is never an action from a sentence ("nu publica" / "nu se încarcă" are not requests to publish).
  ["studio_publish", /(?<!\b(?:nu|se) )\b(publica|posteaza|urca|incarca)(-l|-o)? (clipul|clipurile|video-ul|videoul|video|filmul|montajul|materialul)\b|(?<!\bnu )\b(publica|posteaza|pune|urca)(-l|-o)? pe (instagram|tiktok|youtube|linkedin|twitter|x)\b/],
  ["studio_open", /\b(deschide|arata(-mi)?|du-ma (la|in)|mergi (la|in)|hai (la|in)|treci (pe|la|in)|intra in) studio(ul)?\b(?: (?:la|pentru|cu|pe) (?:clipul |proiectul )?(?<ref>[a-z0-9 -]{2,60}))?|^studio(ul)?$/, (m) => ({ clipRef: m.groups?.ref?.trim() || null })],
  ["studio_show_clip", /\b(arata(-mi)?|deschide|vreau sa vad|pune-mi) (clipul|clipurile|video-ul|videoul|filmul|montajul|randarea)(?: (?:despre |cu |pentru |de la )?(?<ref>[a-z0-9 -]{2,60}))?$|\b(preview-ul|previzualizarea) (clipului|video-ului|videoului|montajului)(?: (?<ref2>[a-z0-9 -]{2,60}))?$/,
    (m) => ({ clipRef: (m.groups.ref || m.groups.ref2 || "").trim() || null })],
  ["studio_edit", /^(?=.*\b(?:la|de la|in|pe) (?:secunda|sec|secundele|secundei) (?<t>\d{1,4}(?:[.,]\d{1,2})?|[a-z]+)\b)(?=.*\b(?<op>muta|mutati|taie|scoate|pune|mareste|micsoreaza|ridica|coboara|schimba|sterge|tine)\b)/, studioEditArgs],
  ["studio_edit", /^(?=.*\btaie (?:de )?la (?<from>\d{1,4}) (?:la|pana la) (?<to>\d{1,4})\b)/, studioEditArgs],
  ["studio_edit", /^(?=.*\b(?<op2>muta|mutati|taie|scoate|mareste|micsoreaza|ridica|coboara)\b)(?=.*\b(textul|titlul|subtitrarea|subtitrarile|logo-ul|logoul|logo|cadrul|hook-ul|cta-ul|butonul|montajul|demonstratia|intro-ul|introul)\b)/, studioEditArgs],
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
  ["show_preview", /\bpreview\b|\barata(-mi)? (aplicatia|rezultatul)\b/],
  ["show_company", /\barata(-mi)? compania\b|\bharta (companiei|firmei)\b|\bcompania\b/],
  ["recommendations", /\bce recomanzi\b|\bce (putem|pot) simplifica\b|\brecomandari(le)?\b/],
  ["briefing", /\bce s-a schimbat\b|\bbuna dimineata\b|\bbriefing\b|\bce e nou\b|\brezumatul zilei\b/],
  ["continue_last", /\bcontinua ce faceam\b|\bunde am ramas\b|\bce faceam (ieri|azi|aseara|data trecuta)\b/],
  ["show_plan", /\barata(-mi)? (mai intai |inainte )?(planul|ce (ai de gand|vrei sa faci))\b|\barata(-mi)? inainte (sa faci?|de a face)\b|\bplanul\b/],
  ["focus", /\bdoar ce conteaza\b|\bmod(ul)? focus\b|\bfara detalii\b/],
  ["continue_work", /\bcontinua (?<what>.+)$|\bfa (?<what2>.+) pana e gata/, (m, c) => ({ topic: cleanTopic(String(m.groups.what || m.groups.what2 || "").replace(/\bpana (e|este|cand e) gata.*$/, "")), untilReady: /\bpana (e|este|cand e) gata\b/.test(c) })],
  ["reorder", /\bschimba ordinea\b|\bmai intai (?<first>.+?) (apoi|si dupa) (?<second>.+)/, (m) => ({ first: m.groups?.first || null, second: m.groups?.second || null })],
  ["not_yet", /\bnu (porni|incepe|rula|executa)( inca| nimic)?\b|\bnu inca\b|\basteapta\b|\bmai tarziu\b/],
  ["reject_plan", /^(nu|nu,? (multumesc|renunt))$|\brenunt la plan\b|\banuleaza planul\b/],
  ["autonomy", /\b(seteaza|pune|schimba) (nivelul de )?autonomi(a|e) (pe|la) (?<level>observe|assisted|trusted|high)\b(?: (pe|la|pentru) (?<ref>.+))?/, (m) => ({ level: { observe: "OBSERVE", assisted: "ASSISTED", trusted: "TRUSTED", high: "HIGH_AUTONOMY_BOUNDED" }[m.groups.level], projectRef: m.groups.ref || null })],
  ["back", /^(inapoi|revino|back)$/],
  ["help", /\bce (poti|stii sa) (face|faci)\b|\bajutor\b/],
  ["open_project", /\b(hai sa lucram|lucram|hai la|deschide|treci pe|schimba pe|comuta pe|mergi pe|du-ma la|arata-mi) (la |pe )?(proiectul )?(?<ref>[a-z0-9 -]{2,60})$/, (m) => ({ projectRef: m.groups.ref })],
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
  const ref = clause.match(/\b(?:in|din) (?:clipul|video-ul|videoul|montajul) (?<ref>[a-z0-9 -]{2,40}?)(?=,| la | mut| taie|$)/)?.groups?.ref || null;
  return { atSec: Number.isFinite(atSec) ? atSec : null, op: g.op || g.op2 || (g.from ? "taie" : null), target, direction, clipRef: ref ? ref.trim() : null,
    toSec: g.to ? Number(g.to) : null };
}

function cleanTopic(text) {
  return String(text).replace(/\b(problema|misiunea|lucrul|treaba|task(ul)?|cu)\b/g, " ").replace(/\bdar\b.*$/, " ").replace(/\s+/g, " ").trim();
}

/** Constraints carried by a clause; they only narrow what the step may do. */
function constraintsOf(clause) {
  const c = {};
  if (/\bfara (deploy|publicare|productie)\b/.test(clause)) c.noDeploy = true;
  if (/\bfara (commit|push)\b/.test(clause)) c.noGit = true;
  if (/\bfara (mesaje|email|trimitere)\b/.test(clause)) c.noMessages = true;
  if (/\bnu (porni|incepe|rula|executa)\b|\bdoar (arata|spune|explica|planul)\b|\bfara sa (pornesti|incepi)\b/.test(clause)) c.noStart = true;
  if (/\bdoar (citire|citeste)\b|\bfara modificari\b/.test(clause)) c.readOnly = true;
  return c;
}

/**
 * @param {string} text
 * @param {{ projects?: Array, currentProjectId?: string|null, missions?: Array, pendingEnvelopes?: Array, awaiting?: string|null, source?: string }} context
 *   `source`: "typed" | "voice-local" | "voice-provider" | "document". Only typed or locally verified voice may produce a
 *   confirmation; a provider transcript or document text never does.
 */
export function resolveIntent(text, context = {}) {
  const raw = String(text || "").slice(0, 2000);
  const source = context.source || "typed";
  let norm = normalize(raw).replace(/^(hei |hey |buna )?lega[,!. ]+/, "");
  const quotedParts = norm.split("\u0001").filter((_, i) => i % 2 === 1).join(" ");
  const quotedConfirm = /\b(da|confirm|confirma|executa|porneste)\b/.test(quotedParts);
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
  if (interrupting) norm = afterPrefix;
  if (!interrupting && !question && (TEACH_PREFIX.test(norm) || TEACH_PROCEDURE.test(norm) || forget)) {
    const lesson = forget ? { intent: "forget", args: { ref: forget.groups.ref.trim() } } : { intent: "teach", args: { text: stripRawPrefix(raw) } };
    const inert = INERT_SOURCES.has(source);
    const refused = quotedConfirm ? [{ intent: "confirm", reason: "O confirmare între ghilimele este un citat, nu răspunsul tău; am ignorat-o" }] : [];
    if (inert) refused.push({ intent: lesson.intent, reason: INERT_REASON });
    return { utterance: raw, normalized: norm, source, quotedConfirm, clarification: null, refused,
      steps: [{ ...lesson, args: inert ? { ...lesson.args, inert: true } : lesson.args, constraints: {}, effect: inert ? "none" : INTENT_EFFECTS[lesson.intent], text: norm }] };
  }
  const clauses = norm.split(/;|\. |!|\? | (?:si )?apoi | dupa aceea | dupa care | iar apoi /).map((s) => s.replace(/[.,!?]+$/g, "").trim()).filter(Boolean);
  const globalConstraints = constraintsOf(norm);
  for (const clause of clauses) {
    const matchedConstraints = constraintsOf(clause);
    let found = null;
    for (const [intent, re, argsOf] of P) {
      const m = clause.match(re);
      if (m) { found = { intent, args: argsOf ? argsOf(m, clause) : {} }; break; }
    }
    // A clause that is only a constraint ("dar fără deploy") attaches to the previous step instead of being a step itself.
    if (!found && Object.keys(matchedConstraints).length && steps.length) { Object.assign(steps[steps.length - 1].constraints, matchedConstraints); continue; }
    if (!found) found = { intent: "unknown", args: {} };
    steps.push({ intent: found.intent, args: found.args, constraints: { ...matchedConstraints }, effect: INTENT_EFFECTS[found.intent] || "none", text: clause });
  }
  if (!steps.length) steps.push({ intent: "unknown", args: {}, constraints: {}, effect: "none", text: "" });
  // A decrease anywhere in the sentence ("…luăm doi clienți, apoi pierdem unul") makes every scenario step a question, not numbers.
  if (SCENARIO_DECREASE.test(norm)) for (const s of steps) if (s.intent === "simulate") s.args = { scenario: s.args.scenario, unsupported: true };
  for (const step of steps) Object.assign(step.constraints, globalConstraints);

  const out = { utterance: raw, normalized: norm, source, quotedConfirm, steps: [], clarification: null, refused: [] };
  if (quotedConfirm) out.refused.push({ intent: "confirm", reason: "O confirmare între ghilimele este un citat, nu răspunsul tău; am ignorat-o" });
  for (const step of steps) {
    const resolved = resolveRefs(step, context);
    if (resolved.clarification && !out.clarification) out.clarification = resolved.clarification;
    // Negations remove effects: "nu porni" / "doar arată" turn a plan or a confirmation into a preview only.
    if (step.constraints.noStart && (step.intent === "confirm" || step.intent === "continue_work")) {
      if (step.intent === "confirm") { out.refused.push({ intent: "confirm", reason: "Ai spus să nu pornească nimic" }); step.intent = "not_yet"; step.effect = "none"; }
      else step.args.previewOnly = true;
    }
    if (step.intent === "confirm") {
      const confirm = checkConfirmation(context, source);
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
    out.steps.push(step);
  }
  return out;
}

/** Sources whose words are content, not the owner's instructions (a pasted document, a local transcript of a media file). */
const INERT_SOURCES = new Set(["document", "media-local"]);
const INERT_REASON = "Textul vine dintr-un document sau dintr-o transcriere media: e conținut, nu o comandă de la tine";

function resolveRefs(step, context) {
  const projects = context.projects || [];
  const needsProject = ["open_project", "freeze_project", "unfreeze_project"].includes(step.intent) || (step.intent === "autonomy" && step.args.projectRef);
  if (needsProject) {
    const ref = step.args.projectRef;
    const matches = ref ? matchRef(ref, projects, { extra: (p) => [p.slug] }) : [];
    if (matches.length === 1) step.args.projectId = matches[0].id;
    else if (matches.length > 1) return { clarification: { question: `La care proiect te referi: ${matches.slice(0, 4).map((p) => p.name).join(" sau ")}?`, options: matches.slice(0, 4).map((p) => ({ id: p.id, label: p.name })), forIntent: step.intent } };
    else if (ref) step.args.unknownRef = ref;
  }
  if (step.intent === "autonomy" && !step.args.projectId) step.args.projectId = context.currentProjectId || null;
  if (step.intent === "freeze_project" && !step.args.projectId && /^(proiectul|tot proiectul|asta|acesta)$/.test(String(step.args.projectRef || "").trim())) step.args.projectId = context.currentProjectId || null;
  if (step.intent === "continue_work" && step.args.topic) {
    const missions = (context.missions || []).filter((m) => !context.currentProjectId || m.projectId === context.currentProjectId);
    const matches = matchRef(step.args.topic, missions, { name: (m) => m.title });
    if (matches.length === 1) step.args.missionId = matches[0].id;
    else if (matches.length > 1) return { clarification: { question: `Care misiune: ${matches.slice(0, 4).map((m) => `„${m.title}”`).join(" sau ")}?`, options: matches.slice(0, 4).map((m) => ({ id: m.id, label: m.title })), forIntent: "continue_work" } };
  }
  return {};
}

/**
 * A "yes" is consent only for one presented plan, from the owner's own input (typed in the session, or voice verified
 * locally), while the cockpit waits for exactly that answer.
 */
function checkConfirmation(context, source) {
  if (!["typed", "voice-local"].includes(source)) return { ok: false, reason: source === "voice-provider" ? "O transcriere făcută de provider nu poate confirma; confirmă în cockpit (tastă sau buton) sau cu verificarea locală a vocii" : "Textul nu vine de la tine în sesiune (document, unealtă sau pagină)" };
  const pending = context.pendingEnvelopes || [];
  if (context.awaiting !== "envelope_confirmation" && pending.length !== 1) return { ok: false, reason: "Nu aștept acum o confirmare (întrebarea anterioară nu era despre un plan)" };
  if (pending.length === 0) return { ok: false, reason: "Niciun plan nu așteaptă confirmarea" };
  if (pending.length > 1) return { ok: false, reason: "Sunt mai multe planuri în așteptare", clarification: { question: `Care plan: ${pending.slice(0, 4).map((e) => `„${e.title}”`).join(" sau ")}?`, options: pending.slice(0, 4).map((e) => ({ id: e.id, label: e.title })), forIntent: "confirm" } };
  if (context.awaiting !== "envelope_confirmation") return { ok: false, reason: "Planul nu a fost prezentat în această conversație; deschide-l și confirmă-l acolo" };
  return { ok: true, envelopeId: pending[0].id };
}
