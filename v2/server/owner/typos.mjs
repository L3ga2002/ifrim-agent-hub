// Stage before M12 (§5): Lega understands a missing, swapped or extra letter and the usual voice-transcription slips, on text and voice
// alike (the same normalized sentence feeds resolveIntent for both).
//
// What it does: on the already normalized sentence (lower case, no diacritics, quotes removed), a word of ≥ 5 letters that is NOT a known
// word of the vocabulary below and is at edit distance 1 (2 for words of ≥ 9 letters; a swap of two neighbours counts 1) from exactly ONE
// vocabulary word is replaced by it. „regateste prezentarea” → „pregateste prezentarea”. Fixed aliases cover what a transcriber writes
// for brand words („ward”, „exel”).
//
// What it never does — similarity is not authority:
//   - it never produces a verb with an outward or irreversible effect, a confirmation, a stop or a negation: confirma, executa, opreste,
//     stop, publica, posteaza, trimite, sterge, plateste, accepta, revoca, nu, fara are NOT targets (a typo of them stays a typo, and
//     the sentence is understood without it or answered with a question);
//   - it never touches words under 5 letters, numbers, project names the context lists, or a word that is already in the vocabulary;
//   - it reports every replacement ({ from, to }) so the original text and the interpretation are both kept for audit.

const VERBS = ["pregateste", "verifica", "deschide", "porneste", "arata", "continua", "construieste", "livreaza", "creeaza", "genereaza",
  "realizeaza", "monteaza", "importa", "ruleaza", "lanseaza", "repara", "adauga", "salveaza", "explica", "inregistreaza", "randeaza",
  "propune", "schimba", "modifica", "corecteaza", "testeaza", "filmeaza", "exporta", "pregatesc", "deschid", "pregatit", "pregatita"];
const NOUNS = ["intamplat", "astazi", "companie", "comanda", "capitolul", "departamentul", "functioneaza", "lucreaza", "cifrele", "palnia", "traseul", "repaus", "factory", "sistemului",
  "prezentarea", "prezentare", "prezentarii", "demo-ul", "demoul", "demo-ului", "livrarea", "livrare", "document", "documentul",
  "campanie", "campaniei", "pachet", "pachetul", "dosar", "dosarul", "clipul", "videoclip", "videoclipul", "vertical", "verticala",
  "rezumatul", "rezumat", "proiectul", "proiect", "planul", "misiunea", "site-ul", "siteul", "programarile", "programare", "programarea",
  "detailing", "excel", "excelul", "wordul", "demonstrative", "demonstrativ", "singur", "totul", "comercial", "variante", "varianta",
  "telefon", "telefonul", "butonul", "formularul", "camera", "aplicatia", "aplicatiile", "modelele", "conturile",
  // M12 Sales: the offer nouns only (never a send, contact or publish verb: those are NEVER_TARGET below).
  "oferta", "oferte", "ofertele", "ofertei", "propunerea"];
/**
 * Words that stay exactly as said: they are never a correction's target, so a typo cannot turn into them. M12: every send, contact and
 * publish verb form too (the resolver refuses them with OUTREACH_DISABLED; a slip is never corrected toward them).
 */
export const NEVER_TARGET = Object.freeze(new Set(["confirma", "confirm", "executa", "opreste", "oprim", "stop", "publica", "posteaza",
  "trimite", "sterge", "plateste", "accepta", "revoca", "aproba", "anuleaza", "nu", "fara", "dezactiveaza", "elimina", "goleste",
  "trimiteti", "trimitem", "expediaza", "expediati", "contacteaza", "contactati", "contactam", "contactez", "contactezi", "contacteze", "contacta",
  "publicati", "publicam", "postati", "postam", "emaileaza"]));
const VOCAB = [...new Set([...VERBS, ...NOUNS])].filter((w) => !NEVER_TARGET.has(w));
/** The correction vocabulary, read-only (the M12 table test proves no entry lies near a send, contact or publish verb). */
export const TYPO_VOCAB = Object.freeze([...VOCAB]);
const KNOWN = new Set([...VOCAB, ...NEVER_TARGET, "pregateste-mi", "fa-mi", "fa", "si", "cu", "un", "o", "de", "la", "pe", "din", "tot", "ce",
  "urmeaza", "dupa", "inainte", "inca", "porni", "porneasca", "arata-mi", "nimic", "publicat", "planul", "doar", "date", "datele", "pentru",
  // Participles and other forms close to a vocabulary verb that mean something else („e deschis?” is not „deschid”).
  "deschis", "deschisa", "deschise", "pornit", "pornita", "pornite", "oprit", "oprita", "verificat", "verificata", "livrat", "livrata", "salvat",
  "salvata", "creat", "creata", "facut", "facuta", "gata", "arate", "aratat", "continuat", "reparat", "reparata", "adaugat", "adaugata",
  "importat", "rulat", "rulata", "lansat", "lansata", "proiecte", "proiectele", "documente", "documentele", "camere", "pachete", "dosare",
  "monteze", "testat", "testata", "filmat", "filmata", "exportat", "exportata", "propus", "propusa", "schimbat", "modificat", "corectat"]);
/** Transcription aliases (whole words). */
const ALIASES = Object.freeze({ ward: "word", vord: "word", uord: "word", wordu: "wordul", exel: "excel", ecsel: "excel", excell: "excel",
  xcel: "excel", exelul: "excelul", clipu: "clipul", siteu: "site-ul", saitul: "site-ul", saitu: "site-ul", sait: "site", demou: "demo-ul" });

/** Optimal string alignment distance (Damerau without repeated edits): a swap of two neighbouring letters costs 1. */
export function osaDistance(a, b) {
  const s = String(a);
  const t = String(b);
  if (Math.abs(s.length - t.length) > 2) return 3;
  const d = Array.from({ length: s.length + 1 }, (_, i) => Array.from({ length: t.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= s.length; i += 1) {
    for (let j = 1; j <= t.length; j += 1) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[s.length][t.length];
}

/** The one vocabulary word a token most likely means, or null (none, or two equally close). */
/** The two words differ only in their last two letters, or one is the other plus/minus endings: an inflection, not a slip. */
function inflection(a, b) {
  const n = Math.min(a.length, b.length);
  let common = 0;
  while (common < n && a[common] === b[common]) common += 1;
  return common >= n - 2 && common >= 4;
}

let extraKnown = new Set();
/** The words the intent patterns themselves spell (intents.mjs passes them once): a word Lega already knows is never „corrected”. */
export function addKnownWords(words) { extraKnown = new Set([...extraKnown, ...words]); }

export function closest(token) {
  const w = String(token || "");
  if (w.length < 5 || /\d/.test(w) || KNOWN.has(w) || extraKnown.has(w) || NEVER_TARGET.has(w)) return null;
  const limit = w.length >= 9 ? 2 : 1;
  let best = null;
  let tie = false;
  for (const v of VOCAB) {
    const dist = osaDistance(w, v);
    if (dist > limit || inflection(w, v)) continue;
    if (!best || dist < best.dist) { best = { word: v, dist }; tie = false; } else if (dist === best.dist && v !== best.word) tie = true;
  }
  return best && !tie ? best.word : null;
}

/**
 * The corrected sentence. `norm` is normalize()'d text; `protect` are words never changed (the context's project names, flattened to
 * their words). → { text, corrections: [{ from, to }] }
 */
export function correctTypos(norm, { protect = [] } = {}) {
  const keep = new Set((protect || []).flatMap((n) => String(n || "").toLowerCase().split(/[^a-z0-9-]+/)).filter(Boolean));
  const corrections = [];
  const suspects = [];
  const text = String(norm || "").replace(/[a-z][a-z-]*[a-z]/g, (word) => {
    if (keep.has(word)) return word;
    const alias = ALIASES[word];
    if (alias) { corrections.push({ from: word, to: alias }); return alias; }
    // A clitic form keeps its clitic („regateste-mi” → „pregateste-mi”).
    const [head, ...rest] = word.split("-");
    const tail = rest.length ? `-${rest.join("-")}` : "";
    if (tail && KNOWN.has(word)) return word;
    const fixed = closest(tail && head.length >= 5 ? head : word);
    if (!fixed) {
      // A slip of a word that is never a target („oprște”, „confrma”) is not corrected: it is reported, so Lega asks instead of acting.
      const w = tail && head.length >= 5 ? head : word;
      const near = w.length >= 5 && !KNOWN.has(w) && !extraKnown.has(w) && !NEVER_TARGET.has(w) ? [...NEVER_TARGET].find((v) => v.length >= 5 && osaDistance(w, v) === 1 && !inflection(w, v)) : null;
      if (near) suspects.push({ from: word, to: near });
      return word;
    }
    const to = tail && head.length >= 5 ? fixed + tail : fixed;
    if (to === word) return word;
    corrections.push({ from: word, to });
    return to;
  });
  return { text, corrections, suspects };
}
