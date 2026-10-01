/**
 * Sales identity (M04 §2.2): normalization of names, fiscal codes, domains, phones and e-mails, and the deterministic rules
 * that decide whether an imported row is a company already known. Identity is decided by exact, explainable rules, never by a
 * model: a wrong merge mixes two companies' evidence, so anything uncertain goes to the owner for review instead of merging.
 *
 * Pure module: no database, no network, no clock. Owner-facing reasons are in Romanian.
 */

/* ------------------------------------------------------------------ text */

/** Characters NFD does not decompose (they are letters of their own, not letter + mark). */
const EXTRA_FOLD = { "ß": "ss", "ø": "o", "Ø": "O", "ł": "l", "Ł": "L", "đ": "d", "Đ": "D", "æ": "ae", "Æ": "AE", "œ": "oe", "Œ": "OE" };

/**
 * Removes diacritics, keeping case: both Romanian spellings (ș/ț with comma below and the legacy ş/ţ with cedilla) become
 * s/t, and ă/â/î become a/a/i. Legacy cedilla forms are still common in exported registers, so they must compare equal.
 */
export function foldDiacritics(text) {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/[ßøØłŁđĐæÆœŒ]/g, (ch) => EXTRA_FOLD[ch])
    .normalize("NFC");
}

/** Lowercase ASCII words: diacritics folded, "&" read as "si", every other punctuation mark a separator. */
const words = (text) => foldDiacritics(text).toLowerCase().replace(/&/g, " si ").split(/[^a-z0-9]+/).filter(Boolean);

/** Canonical legal form for a joined token. */
const LEGAL_FORMS = new Map([
  ["srl", "SRL"], ["srld", "SRL-D"], ["sa", "SA"], ["pfa", "PFA"], ["ii", "II"], ["if", "IF"], ["snc", "SNC"], ["scs", "SCS"], ["sca", "SCA"],
]);
/** Short forms that are also ordinary words ("sa", "if", "ii"): stripped only at the start or the end of the name. */
const EDGE_ONLY_FORMS = new Set(["sa", "ii", "if"]);

/**
 * Joins runs of single letters ("s r l" from "S.R.L.", "s c" from "S.C.") so dotted abbreviations read as one token, and
 * glues the "-D" of "SRL-D".
 */
function joinAbbreviations(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i].length === 1 && /[a-z]/.test(tokens[i]) && tokens[i + 1]?.length === 1 && /[a-z]/.test(tokens[i + 1])) {
      let run = tokens[i];
      while (tokens[i + 1]?.length === 1 && /[a-z]/.test(tokens[i + 1])) run += tokens[++i];
      out.push(run);
    } else out.push(tokens[i]);
  }
  for (let i = 0; i < out.length - 1; i += 1) {
    if (out[i] === "srl" && out[i + 1] === "d") out.splice(i, 2, "srld");
  }
  return out;
}

/**
 * Name used for comparison. Strips the legal form (SRL / S.R.L. / SRL-D, SA, PFA, II, IF, SNC, SCS, SCA) and the obsolete
 * "SC" prefix ("S.C. Alfa S.R.L." = "Alfa SRL"), folds diacritics and punctuation. `legalForm` is the last form found
 * (the suffix in the usual "Name SRL" order), so "Alfa SA" and "Alfa SRL" can be told apart by the matcher.
 * @returns {{ normalized: string, legalForm: string | null, tokens: string[] }}
 */
export function normalizeName(name) {
  let tokens = joinAbbreviations(words(name));
  let legalForm = null;
  const kept = [];
  tokens.forEach((token, index) => {
    const form = LEGAL_FORMS.get(token);
    const atEdge = index === 0 || index === tokens.length - 1;
    if (form && (!EDGE_ONLY_FORMS.has(token) || atEdge)) {
      legalForm = form;
      return;
    }
    kept.push(token);
  });
  tokens = kept;
  if (tokens.length > 1 && tokens[0] === "sc") tokens = tokens.slice(1);
  return { normalized: tokens.join(" "), legalForm, tokens };
}

/* ------------------------------------------------------------ fiscal code */

const CUI_KEY = "753217532";

/**
 * Romanian CUI/CIF control digit for the digits WITHOUT the control digit (1–9 digits): the body is right-aligned on the key
 * 753217532, each digit multiplied by its key digit, the sum multiplied by 10, modulo 11, and 10 becomes 0.
 */
export function cuiControlDigit(body) {
  const digits = String(body ?? "");
  if (!/^\d{1,9}$/.test(digits)) throw new TypeError("cuiControlDigit expects 1-9 digits");
  const padded = digits.padStart(9, "0");
  let sum = 0;
  for (let i = 0; i < 9; i += 1) sum += Number(padded[i]) * Number(CUI_KEY[i]);
  const control = (sum * 10) % 11;
  return control === 10 ? 0 : control;
}

/**
 * Validates a Romanian fiscal code (CUI/CIF, with or without the VAT prefix "RO"). Blank is unknown (`valid: null`), not
 * invalid. `value` holds the digits without "RO" whenever the input is made of digits, even when the control digit is wrong,
 * so the owner sees what was typed; only a valid code is ever used as an identity key.
 * @returns {{ value: string | null, prefixRO: boolean, valid: boolean | null, reason: string }}
 */
export function normalizeFiscalCode(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return { value: null, prefixRO: false, valid: null, reason: "Cod fiscal lipsă" };
  let t = foldDiacritics(text).toUpperCase().replace(/^(?:C\.?\s?U\.?\s?I\.?|C\.?\s?I\.?\s?F\.?|COD\s+FISCAL)\s*[:.-]?\s*/, "");
  // A numeric spreadsheet cell can surface as "12345674.0"; the decimal part is not part of the code.
  t = t.replace(/^(\D*\d+)[.,]0+$/, "$1").replace(/[\s.\-_/]+/g, "");
  let prefixRO = false;
  if (t.startsWith("RO")) {
    prefixRO = true;
    t = t.slice(2);
  }
  if (!t) return { value: null, prefixRO, valid: false, reason: "Lipsesc cifrele după prefixul RO" };
  if (!/^\d+$/.test(t)) return { value: null, prefixRO, valid: false, reason: "Codul fiscal conține caractere nepermise (sunt permise doar cifre și prefixul RO)" };
  if (t.length < 2 || t.length > 10) return { value: t, prefixRO, valid: false, reason: `Lungime invalidă: ${t.length} cifre (un CUI are între 2 și 10 cifre)` };
  if (t[0] === "0") return { value: t, prefixRO, valid: false, reason: "Un CUI nu începe cu 0" };
  const expected = cuiControlDigit(t.slice(0, -1));
  if (Number(t.at(-1)) !== expected) {
    return { value: t, prefixRO, valid: false, reason: `Cifra de control nu se potrivește (ultima cifră ar trebui să fie ${expected})` };
  }
  return { value: t, prefixRO, valid: true, reason: "CUI valid (cifra de control corectă)" };
}

/* ---------------------------------------------------------------- domains */

const DOMAIN_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;
const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/**
 * Host of a URL, a bare domain or an e-mail address: lowercase, without "www.", without a trailing dot, punycode for
 * international names. Anything that is not a domain name (IP address, localhost, garbage) gives "".
 */
export function normalizeDomain(urlOrEmail) {
  let s = String(urlOrEmail ?? "").trim().replace(/^mailto:/i, "");
  if (!s || /\s/.test(s)) return "";
  if (!s.includes("://") && s.includes("@")) {
    s = s.slice(s.lastIndexOf("@") + 1).replace(/[>)\]]+$/, "");
    if (!s || /[/?#]/.test(s)) return "";
  }
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `http://${s.replace(/^\/+/, "")}`;
  let host;
  try {
    host = new URL(s).hostname.toLowerCase();
  } catch {
    return "";
  }
  host = host.replace(/\.+$/, "").replace(/^www\./, "");
  if (!host || host.startsWith("[") || IPV4_RE.test(host) || !DOMAIN_RE.test(host)) return "";
  return host;
}

const HOST_SETS = new WeakMap();

/** True when `host` is one of the listed domains or a subdomain of one (walks the host's own suffixes: no list scan). */
function matchesHost(host, list) {
  let set = HOST_SETS.get(list);
  if (!set) HOST_SETS.set(list, (set = new Set(list)));
  for (let h = host; h; ) {
    if (set.has(h)) return true;
    const dot = h.indexOf(".");
    if (dot < 0) break;
    h = h.slice(dot + 1);
  }
  return false;
}

/** Two-level public suffixes, so the "site label" of shop.com.ro is "shop" and not "com". */
const TWO_LEVEL_SUFFIXES = new Set([
  "com.ro", "org.ro", "info.ro", "nom.ro", "firm.ro", "store.ro", "tm.ro", "www.ro", "rec.ro", "arts.ro", "nt.ro", "gov.ro",
  "co.uk", "org.uk", "ac.uk", "gov.uk", "com.au", "com.br", "co.jp", "com.tr", "com.mx", "co.in", "com.cn", "co.za",
  "com.ar", "com.pl", "co.nz", "com.ua", "com.md", "co.il", "com.sg", "co.kr",
]);

/** The label right before the public suffix ("olx" for olx.ro and olx.pl), used for platform families present on many TLDs. */
function siteLabel(host) {
  const labels = host.split(".");
  if (labels.length < 2) return host;
  const lastTwo = labels.slice(-2).join(".");
  return TWO_LEVEL_SUFFIXES.has(lastTwo) && labels.length >= 3 ? labels.at(-3) : labels.at(-2);
}

/** Free hosting where many unrelated owners share one parent domain: the parent says nothing about who the owner is. */
const SHARED_HOSTING = [
  "wixsite.com", "editorx.io", "blogspot.com", "business.site", "sites.google.com", "wordpress.com", "weebly.com",
  "webnode.ro", "webnode.com", "webnode.page", "site123.me", "godaddysites.com", "jimdofree.com", "jimdosite.com", "jimdo.com",
  "tilda.ws", "carrd.co", "github.io", "gitlab.io", "netlify.app", "vercel.app", "pages.dev", "web.app", "firebaseapp.com",
  "herokuapp.com", "square.site", "myshopify.com", "webflow.io", "framer.website", "notion.site", "substack.com",
  "mystrikingly.com", "strikingly.com", "ueniweb.com", "wix.com",
];
const SHARED_HOSTING_LABELS = new Set(["blogspot"]);

/** Public mailbox providers: an address there identifies a person, never the company. */
const EMAIL_PROVIDER_HOSTS = [
  "gmail.com", "googlemail.com", "ymail.com", "live.com", "msn.com", "me.com", "mac.com", "aol.com", "proton.me", "mail.com",
  "mail.ru", "zoho.com", "tutanota.com", "rdslink.ro", "email.com",
];
const EMAIL_PROVIDER_LABELS = new Set(["yahoo", "hotmail", "outlook", "gmx", "yandex", "protonmail", "icloud"]);

const SOCIAL_LABELS = new Set([
  "facebook", "instagram", "linkedin", "tiktok", "youtube", "twitter", "pinterest", "snapchat", "whatsapp", "telegram", "reddit",
  "vimeo", "flickr", "tumblr",
]);
const SOCIAL_HOSTS = ["fb.com", "fb.me", "youtu.be", "x.com", "lnkd.in", "wa.me", "t.me", "linktr.ee", "threads.net"];

const MARKETPLACE_LABELS = new Set(["olx", "emag", "amazon", "ebay", "etsy", "aliexpress", "temu", "vinted", "booking", "airbnb"]);
const MARKETPLACE_HOSTS = [
  "okazii.ro", "publi24.ro", "lajumate.ro", "autovit.ro", "storia.ro", "imobiliare.ro", "tazz.ro", "glovoapp.com", "foodpanda.ro",
];

const DIRECTORY_LABELS = new Set(["google", "bing", "tripadvisor", "yelp", "infobel", "cylex", "foursquare"]);
const DIRECTORY_HOSTS = [
  "listafirme.ro", "listafirme.eu", "termene.ro", "risco.ro", "totalfirme.ro", "topfirme.com", "infocui.ro", "paginiaurii.ro",
  "firme.info", "romanian-companies.eu", "mfinante.gov.ro", "onrc.ro", "anaf.ro", "waze.com", "maps.apple.com", "g.page",
  "maps.app.goo.gl",
];

const ARTICLE_LABELS = new Set(["wikipedia", "wikimedia", "wikiwand"]);
const ARTICLE_HOSTS = [
  "medium.com", "digi24.ro", "hotnews.ro", "adevarul.ro", "libertatea.ro", "zf.ro", "profit.ro", "wall-street.ro", "g4media.ro",
  "stirileprotv.ro", "mediafax.ro", "agerpres.ro", "news.ro", "ziare.com", "observatornews.ro", "antena3.ro", "gandul.ro",
  "economica.net", "bursa.ro", "capital.ro", "forbes.ro", "startupcafe.ro", "realitatea.net", "tvr.ro", "romania-insider.com",
  "b1tv.ro",
];
const SHORTENER_HOSTS = ["bit.ly", "tinyurl.com", "goo.gl", "ow.ly", "t.co", "is.gd", "buff.ly", "rebrand.ly", "cutt.ly"];

/** Reserved names (RFC 2606/6761 and private-use TLDs) that never belong to a real company. ".test" is NOT here: synthetic data uses it. */
const RESERVED_TLDS = new Set(["example", "invalid", "localhost", "local", "internal", "lan", "home", "arpa", "onion", "intranet", "corp"]);
const RESERVED_HOSTS = ["example.com", "example.net", "example.org"];

const isMailProvider = (host) => matchesHost(host, EMAIL_PROVIDER_HOSTS) || EMAIL_PROVIDER_LABELS.has(siteLabel(host));

/** Which shared platform a host belongs to, or null for a host that may be the organization's own. */
function platformOf(host) {
  const label = siteLabel(host);
  if (matchesHost(host, SHARED_HOSTING) || SHARED_HOSTING_LABELS.has(label)) return { kind: "shared_hosting", reason: "Găzduire comună: domeniul părinte e folosit de mulți proprietari" };
  if (isMailProvider(host)) return { kind: "shared_hosting", reason: "Furnizor public de e-mail, nu domeniul unei firme" };
  if (SOCIAL_LABELS.has(label) || matchesHost(host, SOCIAL_HOSTS)) return { kind: "social_profile", reason: "Rețea socială: profilul nu e site-ul firmei" };
  if (MARKETPLACE_LABELS.has(label) || matchesHost(host, MARKETPLACE_HOSTS)) return { kind: "marketplace_listing", reason: "Marketplace: anunțul nu e site-ul firmei" };
  if (DIRECTORY_LABELS.has(label) || matchesHost(host, DIRECTORY_HOSTS)) return { kind: "directory", reason: "Director sau registru de firme: pagina descrie firma, nu e site-ul ei" };
  if (ARTICLE_LABELS.has(label) || matchesHost(host, ARTICLE_HOSTS)) return { kind: "article", reason: "Publicație sau enciclopedie: pagina e un articol, nu site-ul unei firme" };
  if (matchesHost(host, SHORTENER_HOSTS)) return { kind: "invalid", reason: "Link scurtat: destinația reală nu e cunoscută" };
  return null;
}

/**
 * True only when the host can identify ONE organization: shared platforms (social networks, marketplaces, directories,
 * publications, free hosting such as *.wixsite.com or sites.google.com, public mailbox providers), IP addresses and reserved
 * names never can. Accepts a host, a URL or an e-mail address.
 */
export function isIdentityDomain(host) {
  const h = normalizeDomain(host);
  if (!h) return false;
  if (RESERVED_TLDS.has(h.split(".").at(-1)) || matchesHost(h, RESERVED_HOSTS)) return false;
  return platformOf(h) === null;
}

const ARTICLE_SEGMENTS = new Set([
  "blog", "blogs", "news", "stiri", "stire", "articol", "articole", "article", "articles", "post", "posts", "editorial", "opinii",
  "opinie", "actualitate", "presa", "comunicat", "comunicate",
]);

/**
 * What a URL points to, so a profile, a listing or an article is never taken for the company's own website.
 * @returns {{ kind: "organization_site" | "social_profile" | "marketplace_listing" | "directory" | "article" | "shared_hosting" | "invalid", reason: string }}
 */
export function classifyUrl(url) {
  const s = String(url ?? "").trim();
  if (!s) return { kind: "invalid", reason: "Adresă lipsă" };
  if (/\s/.test(s)) return { kind: "invalid", reason: "Adresa conține spații" };
  let candidate = s;
  const explicit = /^([a-z][a-z0-9+.-]*):\/\//i.exec(s);
  if (explicit) {
    if (!["http", "https"].includes(explicit[1].toLowerCase())) return { kind: "invalid", reason: `Schemă nesuportată (${explicit[1].toLowerCase()}); sunt acceptate doar http și https` };
  } else if (/^(?:mailto|javascript|data|file|tel|ftp|blob|about|vbscript):/i.test(s)) {
    return { kind: "invalid", reason: "Nu e o adresă web (http/https)" };
  } else if (s.includes("@") && !s.includes("/")) {
    return { kind: "invalid", reason: "Pare o adresă de e-mail, nu un site" };
  } else candidate = `http://${s.replace(/^\/+/, "")}`;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    return { kind: "invalid", reason: "Adresă web nevalidă" };
  }
  if (parsed.username || parsed.password) return { kind: "invalid", reason: "Adresa conține date de autentificare" };
  const host = normalizeDomain(parsed.href);
  if (!host) return { kind: "invalid", reason: "Gazda nu e un nume de domeniu (IP, localhost sau format greșit)" };
  if (RESERVED_TLDS.has(host.split(".").at(-1)) || matchesHost(host, RESERVED_HOSTS)) return { kind: "invalid", reason: "Domeniu rezervat, nu aparține unei firme" };
  const platform = platformOf(host);
  if (platform) return platform;
  let segments = [];
  try {
    segments = parsed.pathname.split("/").filter(Boolean).map((seg) => foldDiacritics(decodeURIComponent(seg)).toLowerCase());
  } catch {
    segments = parsed.pathname.split("/").filter(Boolean).map((seg) => seg.toLowerCase());
  }
  const articleSegment = segments.find((seg) => ARTICLE_SEGMENTS.has(seg));
  if (articleSegment) return { kind: "article", reason: `Pagină de articol (/${articleSegment}/), nu pagina principală a firmei` };
  if (/\/(?:19|20)\d{2}\/(?:0?[1-9]|1[0-2])(?:\/|$)/.test(parsed.pathname)) return { kind: "article", reason: "Calea conține o dată (an/lună): pagină de articol" };
  return { kind: "organization_site", reason: segments.length ? "Pagină pe un domeniu propriu" : "Domeniu propriu" };
}

/* ------------------------------------------------------------------ phone */

/** Expands "7.22000123E8" (a numeric cell shown in scientific notation) into its digits; null when it is not an integer. */
function expandScientific(text) {
  const m = /^([+-]?)(\d)(?:[.,](\d+))?e\+?(\d{1,2})$/i.exec(text);
  if (!m) return null;
  const mantissa = m[2] + (m[3] || "");
  const exponent = Number(m[4]);
  if (mantissa.length - 1 > exponent) return null;
  return { digits: mantissa.padEnd(exponent + 1, "0"), padded: mantissa.length - 1 < exponent };
}

/**
 * Phone number kept as TEXT. It becomes "+40…" only when that is certain (10 national digits starting with 0, or an explicit
 * +40/0040). A numeric spreadsheet cell drops the leading 0, so 9 digits are reported ("0 inițial posibil pierdut") and kept
 * as typed instead of being guessed.
 * @returns {{ value: string | null, raw: string, warnings: string[] }}
 */
export function normalizePhone(raw, { wasNumeric = false } = {}) {
  const original = raw == null ? "" : String(raw);
  const warnings = [];
  let s = original.trim();
  if (!s) return { value: null, raw: original, warnings };
  s = s.replace(/^tel:/i, "").replace(/^(?:tel(?:efon)?|mobil|fix)\s*[:.]?\s*/i, "");

  const several = s.split(/\s*(?:[,;|/]|\bsau\b)\s*/i).filter((part) => part.replace(/\D/g, "").length >= 9);
  if (several.length > 1) {
    warnings.push("Mai multe numere în aceeași celulă; s-a păstrat primul");
    s = several[0];
  }
  const sci = expandScientific(s);
  if (sci) {
    warnings.push(sci.padded ? "Număr în notație științifică: ultimele cifre pot fi pierdute" : "Număr în notație științifică (celulă numerică)");
    s = sci.digits;
  } else if (wasNumeric && /^\d+[.,]0+$/.test(s)) s = s.replace(/[.,]0+$/, "");

  const extension = /\s*(?:int(?:erior)?\.?|ext(?:ensia)?\.?)\s*\d{1,5}$/i;
  if (extension.test(s)) {
    warnings.push("Interiorul a fost eliminat din număr");
    s = s.replace(extension, "");
  }
  s = s.replace(/^(\+|00)\s*40\s*\(0\)/, "+40");
  if (/[a-z]/i.test(s)) return { value: null, raw: original, warnings: [...warnings, "Numărul conține litere"] };
  const hasPlus = s.startsWith("+");
  let digits = s.replace(/\D/g, "");
  if (!digits) return { value: null, raw: original, warnings: [...warnings, "Numărul nu conține cifre"] };

  let international = hasPlus;
  if (!hasPlus && digits.startsWith("00")) {
    international = true;
    digits = digits.slice(2);
  }
  if (international) {
    if (digits.startsWith("40")) {
      let national = digits.slice(2);
      if (national.length === 10 && national.startsWith("0")) {
        warnings.push("0 de după +40 a fost eliminat");
        national = national.slice(1);
      }
      if (national.length === 9 && /^[2-9]/.test(national)) return { value: `+40${national}`, raw: original, warnings };
      warnings.push("Număr românesc cu lungime neobișnuită");
      return { value: `+${digits}`, raw: original, warnings };
    }
    if (digits.length >= 8 && digits.length <= 15) return { value: `+${digits}`, raw: original, warnings };
    return { value: null, raw: original, warnings: [...warnings, "Număr internațional cu lungime invalidă"] };
  }
  if (digits.length === 10 && digits[0] === "0" && /[2-9]/.test(digits[1])) return { value: `+40${digits.slice(1)}`, raw: original, warnings };
  // A national number (leading 0) has exactly 10 digits in Romania: anything else is incomplete or mistyped.
  if (digits[0] === "0") return { value: null, raw: original, warnings: [...warnings, `Număr național cu ${digits.length} cifre (trebuie 10): incomplet sau greșit`] };
  if (digits.length === 9 && /^[237]/.test(digits)) {
    warnings.push(wasNumeric ? "0 inițial posibil pierdut (celulă numerică); numărul a rămas cum a fost scris" : "0 inițial posibil pierdut; numărul a rămas cum a fost scris");
    return { value: digits, raw: original, warnings };
  }
  if (digits.length === 11 && digits.startsWith("40") && /^[237]/.test(digits[2])) {
    warnings.push("Prefixul 40 apare fără „+”; verifică dacă e +40");
    return { value: digits, raw: original, warnings };
  }
  if (digits.length < 6 || digits.length > 15) return { value: null, raw: original, warnings: [...warnings, "Număr prea scurt sau prea lung"] };
  warnings.push("Format de telefon nerecunoscut; numărul a rămas cum a fost scris");
  return { value: digits, raw: original, warnings };
}

/* ------------------------------------------------------------------ e-mail */

/** Role mailboxes (a shared inbox, not a person). Superset of the list kept in proposal.mjs. */
export const GENERIC_EMAIL_LOCALS = Object.freeze(new Set([
  "info", "office", "contact", "contacts", "contactus", "sales", "vanzari", "vinzari", "hello", "salut", "comenzi", "comanda",
  "orders", "admin", "administrator", "administratie", "secretariat", "support", "suport", "service", "servicii", "receptie",
  "reception", "rezervari", "reservations", "booking", "oferte", "oferta", "client", "clienti", "customer", "marketing",
  "comercial", "commercial", "financiar", "finance", "contabilitate", "accounting", "facturare", "facturi", "billing", "hr",
  "jobs", "cariere", "careers", "noreply", "no-reply", "donotreply", "mail", "email", "team", "echipa", "webmaster",
  "postmaster", "abuse", "achizitii", "procurement", "management", "birou", "enquiries", "inquiries", "shop", "magazin",
  "programari", "office1",
]));

const LOCAL_RE = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;

function isGenericLocal(local) {
  const base = local.split("+")[0];
  if (GENERIC_EMAIL_LOCALS.has(base)) return true;
  const first = base.split(/[._-]/)[0].replace(/\d+$/, "");
  return GENERIC_EMAIL_LOCALS.has(first) || GENERIC_EMAIL_LOCALS.has(base.replace(/\d+$/, ""));
}

/**
 * Syntax check only. A valid syntax does NOT mean the mailbox exists: nothing is ever sent to check it, and the reason says
 * so. `generic` marks role inboxes (info@, office@, contact@, sales@, hello@, comenzi@ …), which need a generic greeting.
 * Blank gives `valid: null` (unknown), like a blank fiscal code.
 * @returns {{ value: string | null, valid: boolean | null, generic: boolean, reason: string }}
 */
export function checkEmail(raw) {
  let s = String(raw ?? "").trim();
  if (!s) return { value: null, valid: null, generic: false, reason: "Adresă de e-mail lipsă" };
  const notes = [];
  s = s.replace(/^mailto:/i, "");
  const angle = /<([^<>]+)>/.exec(s);
  if (angle) s = angle[1].trim();
  const parts = s.split(/[\s,;]+/).filter(Boolean);
  if (parts.length > 1 && parts.filter((p) => p.includes("@")).length > 1) {
    notes.push("mai multe adrese în aceeași celulă; s-a păstrat prima");
    s = parts.find((p) => p.includes("@"));
  } else if (parts.length > 1) return { value: null, valid: false, generic: false, reason: "Adresa conține spații" };
  s = s.replace(/^mailto:/i, "").toLowerCase();
  const at = s.lastIndexOf("@");
  if (at < 1 || s.indexOf("@") !== at || at === s.length - 1) return { value: null, valid: false, generic: false, reason: "Format invalid: trebuie exact un „@” între nume și domeniu" };
  const local = s.slice(0, at);
  let domain = s.slice(at + 1).replace(/\.$/, "");
  if (local.length > 64 || !LOCAL_RE.test(local)) return { value: null, valid: false, generic: false, reason: "Partea dinaintea „@” conține caractere sau puncte nepermise" };
  if (/[^\x00-\x7f]/.test(domain)) {
    try {
      domain = new URL(`http://${domain}`).hostname;
    } catch {
      return { value: null, valid: false, generic: false, reason: "Domeniul adresei e invalid" };
    }
  }
  if (!DOMAIN_RE.test(domain)) return { value: null, valid: false, generic: false, reason: "Domeniul adresei e invalid" };
  const value = `${local}@${domain}`;
  const generic = isGenericLocal(local);
  const reason = [
    "Sintaxă validă; adresa nu e verificată (nu s-a trimis nimic)",
    generic ? "adresă generică (a unui rol, nu a unei persoane)" : null,
    isMailProvider(domain) ? "furnizor public de e-mail (adresa nu identifică firma)" : null,
    ...notes,
  ].filter(Boolean).join("; ");
  return { value, valid: true, generic, reason };
}

/* ------------------------------------------------------------- similarity */

/** a-z → 0..25, 0-9 → 26..35 (a normalized name holds nothing else). */
const charCode = (code) => (code >= 97 ? code - 97 : code - 22);

/**
 * Bigram multiset of a normalized name, spaces ignored ("alfa construct" = "alfaconstruct"), as SORTED integer codes:
 * intersecting two sorted arrays needs no hashing or allocation, which matters when an import compares thousands of rows.
 */
function nameProfile(normalized) {
  const compact = String(normalized || "").replace(/ /g, "");
  const size = Math.max(0, compact.length - 1);
  const codes = new Uint16Array(size);
  // Letters that start a bigram: Σ min(histA, histB) bounds the shared bigrams, a cheap first filter for "very close".
  const hist = new Int32Array(36);
  for (let i = 0; i < size; i += 1) {
    const first = charCode(compact.charCodeAt(i));
    codes[i] = first * 36 + charCode(compact.charCodeAt(i + 1));
    hist[first] += 1;
  }
  codes.sort();
  return { compact, codes, size, hist };
}

/**
 * Dice(a, b) ≥ MATCH_THRESHOLDS.veryClose, decided cheaply for the common case of unrelated names: the size bound, then the
 * bound from the letters, and only then the exact count. Same answer as diceProfiles(a, b) >= veryClose.
 */
function veryCloseProfiles(a, b) {
  if (!a.size || !b.size) return Boolean(a.compact) && a.compact === b.compact;
  if (a.size === b.size && a.compact === b.compact) return true;
  const total = a.size + b.size;
  const t = MATCH_THRESHOLDS.veryClose;
  // Same division as the exact value: x / total is monotone, so a bound below t proves the exact Dice is below t too.
  if ((2 * Math.min(a.size, b.size)) / total < t) return false;
  const ha = a.hist;
  const hb = b.hist;
  let bound = 0;
  for (let i = 0; i < 36; i += 1) bound += ha[i] < hb[i] ? ha[i] : hb[i];
  if ((2 * bound) / total < t) return false;
  return diceProfiles(a, b) >= t;
}

/**
 * Dice coefficient of two profiles. With `atLeast`, pairs whose sizes alone rule the threshold out return 0 without
 * counting (Dice ≤ 2·min/(a+b)).
 */
function diceProfiles(a, b, atLeast = 0) {
  if (!a.compact || !b.compact) return 0;
  if (a.compact === b.compact) return 1;
  if (!a.size || !b.size) return 0;
  const total = a.size + b.size;
  if (atLeast > 0 && (2 * Math.min(a.size, b.size)) / total < atLeast) return 0;
  const x = a.codes;
  const y = b.codes;
  let i = 0;
  let j = 0;
  let common = 0;
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) {
      common += 1;
      i += 1;
      j += 1;
    } else if (x[i] < y[j]) i += 1;
    else j += 1;
  }
  return (2 * common) / total;
}

/** Name similarity in [0, 1]: Dice on character bigrams after normalizeName (legal form, diacritics and punctuation ignored). */
export function nameSimilarity(a, b) {
  return diceProfiles(nameProfile(normalizeName(a).normalized), nameProfile(normalizeName(b).normalized));
}

/* --------------------------------------------------------------- matching */

/** Thresholds of the matcher, exported so the owner-facing documentation and the tests read the same numbers. */
export const MATCH_THRESHOLDS = Object.freeze({ veryClose: 0.85, close: 0.6, differentNamesOnSameCui: 0.5 });

const CITY_PREFIX = /^(?:municipiul|mun|orasul|oras|comuna|com|satul|sat|judetul|jud)\s+/;

/** City for comparison: "Mun. Cluj-Napoca" = "cluj napoca"; any Bucharest sector counts as Bucharest. */
function normalizeCity(city) {
  let c = words(city).join(" ").replace(CITY_PREFIX, "");
  if (/^bucuresti\b/.test(c) || /^sector(?:ul)? [1-6]$/.test(c)) c = "bucuresti";
  return c;
}

const emailText = (e) => (typeof e === "string" ? e : e?.value ?? e?.email ?? "");
const emailList = (r) => (Array.isArray(r.emails) ? r.emails.map(emailText) : []);

function prepareFresh(r) {
  const name = normalizeName(r.name);
  const fiscal = normalizeFiscalCode(r.fiscalCode);
  const domains = new Set();
  const own = normalizeDomain(r.domain || r.website || "");
  if (own && isIdentityDomain(own)) domains.add(own);
  const emails = new Set();
  for (const e of emailList(r)) {
    const checked = checkEmail(e);
    if (!checked.valid) continue;
    emails.add(checked.value);
    const d = checked.value.slice(checked.value.lastIndexOf("@") + 1);
    if (isIdentityDomain(d)) domains.add(d);
  }
  return {
    id: r.id ?? null,
    displayName: String(r.name ?? "").trim(),
    name: name.normalized,
    profile: nameProfile(name.normalized),
    legalForm: name.legalForm,
    tokens: name.tokens,
    cui: fiscal.valid ? fiscal.value : null,
    cuiInvalid: fiscal.valid === false,
    city: normalizeCity(r.city),
    displayCity: String(r.city ?? "").trim(),
    domains,
    emails,
  };
}

const PREPARED = new WeakMap();

/** The fields the matcher reads, as they were when a record was normalized. */
const inputsOf = (r) => ({ id: r.id, name: r.name, fiscalCode: r.fiscalCode, domain: r.domain, website: r.website, city: r.city, emails: emailList(r) });

/** Allocation-free comparison with the snapshot (this runs once per pair of a large import). */
function sameInputs(s, r) {
  if (s.id !== r.id || s.name !== r.name || s.fiscalCode !== r.fiscalCode || s.domain !== r.domain || s.website !== r.website || s.city !== r.city) return false;
  const emails = Array.isArray(r.emails) ? r.emails : [];
  if (emails.length !== s.emails.length) return false;
  for (let i = 0; i < emails.length; i += 1) if (emailText(emails[i]) !== s.emails[i]) return false;
  return true;
}

/**
 * Normalizes a record, cached per object because one import compares many rows with the same existing organizations. The
 * cache is checked against the fields the matcher reads, so a record changed in place is normalized again, never stale.
 */
function prepare(record) {
  const cached = PREPARED.get(record);
  if (cached && sameInputs(cached.inputs, record)) return cached.prepared;
  const prepared = prepareFresh(record);
  PREPARED.set(record, { inputs: inputsOf(record), prepared });
  return prepared;
}

const pct = (n) => n.toFixed(2).replace(".", ",");
const tokensContained = (a, b) => {
  if (!a.length || !b.length) return false;
  const [small, big] = a.length <= b.length ? [a, b] : [b, a];
  const set = new Set(big);
  return small.every((t) => set.has(t));
};
const firstShared = (a, b) => {
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  for (const value of small) if (big.has(value)) return value;
  return null;
};
const STRENGTH_RANK = { STRONG: 0, CONFLICT: 1, CANDIDATE: 2 };

/** Compares one prepared pair; null when nothing links them. */
function comparePair(r, e) {
  const sameName = Boolean(r.name) && r.name === e.name;
  const bothNamed = Boolean(r.name && e.name);
  // Hot path of a large import (two different valid CUIs, unrelated names): answered without allocating anything.
  if (r.cui && e.cui && r.cui !== e.cui && !(bothNamed && (sameName || veryCloseProfiles(r.profile, e.profile)))) return null;
  let simCache = null;
  const sim = () => (simCache ??= diceProfiles(r.profile, e.profile));
  const close = () => sameName || sim() >= MATCH_THRESHOLDS.close || tokensContained(r.tokens, e.tokens);

  // 1. Two valid fiscal codes decide alone: equal is the same legal entity, different is never a match.
  if (r.cui && e.cui) {
    if (r.cui === e.cui) {
      const reasons = [`Același CUI valid (${r.cui})`];
      const conflicts = [];
      const sharedDomain = firstShared(r.domains, e.domains);
      if (sameName) reasons.push("Același nume normalizat");
      if (sharedDomain) reasons.push(`Același domeniu (${sharedDomain})`);
      if (bothNamed && !close() && sim() < MATCH_THRESHOLDS.differentNamesOnSameCui) {
        conflicts.push(`Același CUI, dar nume diferite („${r.displayName}” / „${e.displayName}”): verifică denumirea`);
      }
      return { strength: "STRONG", reasons, conflicts };
    }
    // Different valid CUIs reaching this point have very close names (checked above): never a match, only a warning.
    return {
      strength: "CONFLICT",
      reasons: [sameName ? "Același nume normalizat" : `Nume foarte apropiate (similaritate ${pct(sim())})`],
      conflicts: [`CUI-uri valide diferite (${r.cui} / ${e.cui}): firme diferite cu nume apropiate`],
    };
  }

  // 2. At least one side has no valid fiscal code: a shared identity domain, then the name with the city.
  const sharedDomain = r.domains.size && e.domains.size ? firstShared(r.domains, e.domains) : null;
  const citiesDiffer = Boolean(r.city && e.city && r.city !== e.city);
  const reasons = [];
  const conflicts = [];
  let strength = null;
  if (sharedDomain) {
    reasons.push(`Același domeniu de identitate (${sharedDomain})`);
    if (bothNamed && close()) {
      reasons.push(sameName ? "Același nume normalizat" : `Nume apropiate (similaritate ${pct(sim())})`);
      strength = "CANDIDATE";
      if (citiesDiffer) {
        conflicts.push(`Orașe diferite (${r.displayCity} / ${e.displayCity}): sediu, punct de lucru sau filială`);
        strength = "CONFLICT";
      }
    } else {
      conflicts.push("Același domeniu, nume diferite: posibil filiale sau branduri ale aceluiași grup");
      strength = "CONFLICT";
    }
  } else if (sameName) {
    reasons.push("Același nume normalizat");
    if (r.city && e.city && !citiesDiffer) {
      reasons.push(`Același oraș (${e.displayCity})`);
      strength = "CANDIDATE";
    } else if (!r.city || !e.city) {
      reasons.push("Orașul lipsește la una dintre înregistrări");
      strength = "CANDIDATE";
    } else {
      conflicts.push(`Același nume, orașe diferite (${r.displayCity} / ${e.displayCity}): sediu, punct de lucru sau altă firmă`);
      strength = "CONFLICT";
    }
  } else if (r.emails.size && e.emails.size) {
    const sharedEmail = firstShared(r.emails, e.emails);
    if (sharedEmail && bothNamed && close()) {
      reasons.push(`Aceeași adresă de e-mail (${sharedEmail})`, `Nume apropiate (similaritate ${pct(sim())})`);
      strength = "CANDIDATE";
    }
  }
  if (!strength) return null;
  if (r.legalForm && e.legalForm && r.legalForm !== e.legalForm) {
    conflicts.push(`Forme juridice diferite (${r.legalForm} / ${e.legalForm})`);
    strength = "CONFLICT";
  }
  if (r.cui || e.cui) reasons.push("CUI valid doar la una dintre înregistrări");
  if (r.cuiInvalid || e.cuiInvalid) reasons.push("CUI invalid la una dintre înregistrări (ignorat la potrivire)");
  return { strength, reasons, conflicts };
}

const CANDIDATES = Symbol("candidates");
const ADD_AT = Symbol("addAt");

const addTo = (map, key, position) => {
  if (!key) return;
  const list = map.get(key);
  if (list) list.push(position);
  else map.set(key, [position]);
};

/**
 * Approximate frequency (per mille) of a-z then 0-9 in Romanian names, diacritics folded. Only used to ORDER bigrams from
 * rare to common for prefix filtering: any fixed order gives exact results, a rarity order keeps the lists short.
 */
const LETTER_FREQ = [115, 10, 50, 35, 110, 12, 12, 5, 100, 3, 2, 45, 33, 65, 50, 30, 0.1, 70, 45, 65, 60, 12, 0.5, 1, 1, 7, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2];
const CODE_WEIGHT = Float64Array.from({ length: 1296 }, (_, code) => LETTER_FREQ[Math.floor(code / 36)] * LETTER_FREQ[code % 36]);
const tokenWeight = (token) => CODE_WEIGHT[token % 1296] / (1 + Math.floor(token / 1296));

/**
 * Prefix filtering for Dice ≥ veryClose. With o shared bigrams, Dice ≥ t implies o ≥ t·|A|/(2−t), and two such names always
 * share one of the first |A| − ⌈t·|A|/(2−t)⌉ + 1 tokens of each, in one fixed order. Repeated bigrams become distinct tokens
 * (code + occurrence · 1296) so the multiset count stays exact. Candidates found this way are then checked exactly.
 */
function prefixTokens(profile) {
  if (!profile.size) return [];
  const tokens = [];
  let previous = -1;
  let occurrence = 0;
  for (const code of profile.codes) {
    occurrence = code === previous ? occurrence + 1 : 0;
    previous = code;
    tokens.push(code + occurrence * 1296);
  }
  tokens.sort((x, y) => tokenWeight(x) - tokenWeight(y) || x - y);
  const t = MATCH_THRESHOLDS.veryClose;
  const needed = Math.ceil((t * profile.size) / (2 - t) - 1e-9);
  return tokens.slice(0, Math.max(1, profile.size - needed + 1));
}

/**
 * Optional index for large imports: `matchCandidates(record, index)` gives exactly the same result as with the array, but
 * only compares the organizations that can match: same CUI, domain, e-mail or normalized name through hash lookups, and,
 * for a record with a valid CUI, the organizations with a valid CUI whose name is "very close" (prefix filtering on rare
 * bigrams, then the exact Dice). Records are normalized when added, so the index is a snapshot: a changed organization means a new
 * index. `add` also serves the rows accepted earlier in the same import (duplicates inside one file). matchCandidates
 * builds and maintains one automatically for a large array, so callers do not have to.
 */
export function createMatchIndex(existing = []) {
  const entries = [];
  const byPrefix = new Map();
  const byCui = new Map();
  const byDomain = new Map();
  const byEmail = new Map();
  const byName = new Map();
  let count = 0;
  let seen = new Int32Array(64);
  let query = 0;
  const insert = (item, position) => {
    const e = prepareFresh(item);
    entries[position] = e;
    count += 1;
    addTo(byCui, e.cui, position);
    for (const d of e.domains) addTo(byDomain, d, position);
    for (const m of e.emails) addTo(byEmail, m, position);
    addTo(byName, e.name, position);
    if (e.cui && e.name) for (const token of prefixTokens(e.profile)) addTo(byPrefix, token, position);
  };
  const index = {
    get size() {
      return count;
    },
    add(item) {
      if (item && typeof item === "object") insert(item, entries.length);
      return index;
    },
    [ADD_AT](item, position) {
      insert(item, position);
    },
    /** [position, prepared] of the entries that can match `r` (prepared), in insertion order. */
    [CANDIDATES](r) {
      // Per-query stamps instead of Sets: an import asks this once per row, over thousands of entries.
      if (seen.length < entries.length) {
        const grown = new Int32Array(Math.max(entries.length, seen.length * 2, 64));
        grown.set(seen);
        seen = grown;
      }
      query += 1;
      const found = [];
      const take = (list) => {
        if (!list) return;
        for (const p of list) {
          if (seen[p] !== query) {
            seen[p] = query;
            found.push(p);
          }
        }
      };
      take(byCui.get(r.cui));
      for (const d of r.domains) take(byDomain.get(d));
      for (const m of r.emails) take(byEmail.get(m));
      take(byName.get(r.name));
      // Different valid CUIs only link very close names: prefix filtering finds every such name, then the exact check.
      if (r.cui && r.name) {
        for (const token of prefixTokens(r.profile)) {
          const list = byPrefix.get(token);
          if (!list) continue;
          for (const p of list) {
            if (seen[p] === query) continue;
            seen[p] = query;
            if (veryCloseProfiles(r.profile, entries[p].profile)) found.push(p);
          }
        }
      }
      return found.sort((a, b) => a - b).map((p) => [p, entries[p]]);
    },
  };
  for (const item of Array.isArray(existing) ? existing : []) index.add(item);
  return index;
}

/** Below this size a plain scan is cheaper than keeping an index. */
const AUTO_INDEX_MIN = 64;
const ARRAY_INDEXES = new WeakMap();

/**
 * Index kept for an array of existing organizations across calls (an import calls the matcher once per row, often with the
 * same array that grows as rows are accepted). Every call re-checks each element and the fields the matcher reads, so an
 * element replaced or changed in place rebuilds the index instead of giving a stale answer.
 */
function indexForArray(list) {
  let cache = ARRAY_INDEXES.get(list);
  if (cache && cache.items.length <= list.length) {
    for (let i = 0; i < cache.items.length; i += 1) {
      const item = list[i];
      if (item !== cache.items[i] || (cache.inputs[i] && !sameInputs(cache.inputs[i], item))) {
        cache = null;
        break;
      }
    }
  } else cache = null;
  if (!cache) {
    cache = { index: createMatchIndex(), items: [], inputs: [] };
    ARRAY_INDEXES.set(list, cache);
  }
  for (let i = cache.items.length; i < list.length; i += 1) {
    const item = list[i];
    const usable = Boolean(item) && typeof item === "object";
    cache.items.push(item);
    cache.inputs.push(usable ? inputsOf(item) : null);
    if (usable) cache.index[ADD_AT](item, i);
  }
  return cache.index;
}

/**
 * Compares an incoming record with existing organizations. Records: `{ id?, name, fiscalCode, domain, city, emails: [] }`;
 * `existing` is an array (indexed automatically when large) or a createMatchIndex() index.
 * - same valid CUI → STRONG (with a conflict noted when the names clearly differ);
 * - different valid CUIs → never a match (CONFLICT only when the names are very close);
 * - same identity domain: close names → CANDIDATE, different names → CONFLICT (branches or brands);
 * - same normalized name and same city → CANDIDATE (city missing on one side → CANDIDATE; different cities → CONFLICT).
 * Different legal forms turn a CANDIDATE into a CONFLICT. Shared platforms and public mailboxes never link two companies.
 * Results are ordered STRONG, CONFLICT, CANDIDATE, then by input order.
 * @returns {{ existingId: string | number | null, strength: "STRONG" | "CANDIDATE" | "CONFLICT", reasons: string[], conflicts: string[] }[]}
 */
export function matchCandidates(record, existing) {
  const r = prepareFresh(record && typeof record === "object" ? record : {});
  let pairs;
  if (existing && typeof existing[CANDIDATES] === "function") pairs = existing[CANDIDATES](r);
  else if (Array.isArray(existing) && existing.length >= AUTO_INDEX_MIN) pairs = indexForArray(existing)[CANDIDATES](r);
  else pairs = (Array.isArray(existing) ? existing : []).map((item, position) => (item && typeof item === "object" ? [position, prepare(item)] : null)).filter(Boolean);
  const out = [];
  for (const [position, e] of pairs) {
    if (r.id != null && e.id != null && String(r.id) === String(e.id)) continue;
    const result = comparePair(r, e);
    if (result) out.push({ existingId: e.id, ...result, position });
  }
  out.sort((a, b) => STRENGTH_RANK[a.strength] - STRENGTH_RANK[b.strength] || a.position - b.position);
  return out.map(({ position, ...match }) => match);
}

/**
 * Import decision from matchCandidates: exactly one STRONG and nothing in conflict → MATCH_EXISTING; any CANDIDATE,
 * CONFLICT, conflicting STRONG or several STRONG → NEEDS_REVIEW (the owner decides); no match → CREATE.
 * @returns {"CREATE" | "MATCH_EXISTING" | "NEEDS_REVIEW"}
 */
export function decideImportAction(matches) {
  const list = Array.isArray(matches) ? matches.filter(Boolean) : [];
  if (!list.length) return "CREATE";
  const strong = list.filter((m) => m.strength === "STRONG");
  const conflicting = list.some((m) => m.strength === "CONFLICT" || (Array.isArray(m.conflicts) && m.conflicts.length > 0));
  const candidates = list.some((m) => m.strength === "CANDIDATE");
  if (strong.length === 1 && !conflicting && !candidates) return "MATCH_EXISTING";
  return "NEEDS_REVIEW";
}
