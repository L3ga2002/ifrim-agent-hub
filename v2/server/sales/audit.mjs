import { HubError } from "../core/errors.mjs";
import { redactText } from "../security/redact.mjs";
import { foldDiacritics, normalizeName } from "./identity.mjs";

/**
 * Static website audit for Sales (M04 §2.3).
 *
 * Why static and dependency-free: the audit runs on untrusted pages, so nothing on the page is ever executed (no scripts,
 * no styles, no network for sub-resources) and no HTML library with its own attack surface is pulled in. A minimal
 * tokenizer builds a light tree that is only read, never rendered.
 *
 * Why every check carries evidence: a qualification, an opportunity or a proposal must be able to point to WHAT was seen
 * and WHERE (selector + excerpt). Excerpts are clipped to 200 characters, redacted and stored as plain text.
 *
 * Page text is untrusted data: words on the page (including "instructions" aimed at an assistant) are matched only against
 * fixed patterns and never change what is checked or how. A suspected injection only adds a note to `limits`.
 *
 * Labels: OBSERVED when an element is present or absent in the static HTML; INFERRED when the result comes from a text
 * heuristic (services keywords, address patterns, page kind, conflicting company names).
 */

export const AUDIT_VERSION = "audit-v1";
export const EXCERPT_MAX_CHARS = 200;
const MAX_HTML_CHARS = 2 * 1024 * 1024;
const MAX_DEPTH = 256;
const MAX_ELEMENTS = 100_000;

/** Every check, in the order it is reported. `content` checks depend on the page being the company's own, readable site. */
export const AUDIT_CHECKS = Object.freeze([
  { id: "identity_name", area: "identity", content: true },
  { id: "title_present", area: "seo", content: false },
  { id: "services_described", area: "content", content: true },
  { id: "navigation", area: "navigation", content: true },
  { id: "contact_phone", area: "contact", content: true },
  { id: "contact_email", area: "contact", content: true },
  { id: "contact_address", area: "contact", content: true },
  { id: "contact_form", area: "contact", content: true },
  { id: "form_labels", area: "accessibility", content: true },
  { id: "mobile_viewport", area: "mobile", content: false },
  { id: "https", area: "security", content: false },
  { id: "lang_attr", area: "accessibility", content: false },
  { id: "images_alt", area: "accessibility", content: true },
  { id: "internal_anchors", area: "navigation", content: true },
].map((c) => Object.freeze(c)));

const BASE_LIMITS = Object.freeze([
  "Analiză statică a HTML-ului: conținutul generat prin JavaScript, stilurile și scripturile nu sunt evaluate.",
  "S-a analizat o singură pagină; celelalte pagini ale site-ului nu au fost parcurse.",
  "Nu include viteza, contrastul, navigarea din tastatură sau un audit complet de accesibilitate.",
  "Textul din pagină e tratat doar ca dată; eventualele instrucțiuni din pagină sunt ignorate.",
]);

/* ------------------------------------------------------------------ text helpers */

// Control characters, zero-width and bidi overrides are removed so an excerpt cannot hide or reorder text in the UI.
const INVISIBLE_RANGES = [[0x00, 0x08], [0x0b, 0x0c], [0x0e, 0x1f], [0x7f, 0x7f], [0xad, 0xad], [0x200b, 0x200f], [0x202a, 0x202e], [0x2060, 0x2064], [0x2066, 0x2069], [0xfeff, 0xfeff]];
const INVISIBLE = new RegExp(`[${INVISIBLE_RANGES.map(([a, b]) => `\\u{${a.toString(16)}}-\\u{${b.toString(16)}}`).join("")}]`, "gu");
const collapse = (value) => String(value ?? "").replace(INVISIBLE, "").replace(/\s+/g, " ").trim();

/** Excerpt-safe text: collapsed, redacted, clipped to `max` characters (a clipped text ends with "…"). */
function clip(value, max = EXCERPT_MAX_CHARS) {
  const text = collapse(redactText(collapse(String(value ?? "").slice(0, max * 10)).slice(0, max * 5)));
  if (text.length <= max) return text;
  let cut = max - 1;
  const code = text.charCodeAt(cut - 1);
  if (code >= 0xd800 && code <= 0xdbff) cut -= 1; // never split a surrogate pair
  return `${text.slice(0, cut)}…`;
}

const fold = (value) => foldDiacritics(String(value ?? "")).toLowerCase();

const NAMED_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", copy: "©", reg: "®", trade: "™", euro: "€", deg: "°",
  ndash: "–", mdash: "—", hellip: "…", laquo: "«", raquo: "»", bdquo: "„", ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’",
  middot: "·", bull: "•", times: "×", shy: "", zwj: "", zwnj: "",
  acirc: "â", Acirc: "Â", icirc: "î", Icirc: "Î", abreve: "ă", Abreve: "Ă", scedil: "ş", Scedil: "Ş", tcedil: "ţ", Tcedil: "Ţ",
  scaron: "š", Scaron: "Š", eacute: "é", Eacute: "É", aacute: "á", oacute: "ó", uacute: "ú", ouml: "ö", uuml: "ü", auml: "ä",
};
const REPLACEMENT_CHAR = String.fromCharCode(0xfffd);
const LEGACY_NO_SEMICOLON = new Set(["amp", "lt", "gt", "quot", "nbsp", "copy"]);

function decodeEntities(text) {
  if (!text || text.indexOf("&") === -1) return text;
  return text.replace(/&(#[xX][0-9a-fA-F]{1,6}|#\d{1,7}|[a-zA-Z][a-zA-Z0-9]{1,15})(;?)/g, (whole, body, semi) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return REPLACEMENT_CHAR;
      return String.fromCodePoint(code);
    }
    if (!Object.hasOwn(NAMED_ENTITIES, body)) return whole;
    if (!semi && !LEGACY_NO_SEMICOLON.has(body)) return whole;
    return NAMED_ENTITIES[body];
  });
}

/* ------------------------------------------------------------------ minimal HTML tree */

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
// Raw-text elements: their content is never markup. Kept as data (JSON-LD detection), never executed.
const RAW_TEXT = new Set(["script", "style", "title", "textarea", "xmp", "noembed", "noframes"]);
const CLOSES_P = new Set(["address", "article", "aside", "blockquote", "details", "div", "dl", "fieldset", "figure", "footer", "form",
  "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "main", "nav", "ol", "p", "pre", "section", "table", "ul"]);
const IMPLICIT_END = {
  li: { close: ["li"], stop: ["ul", "ol", "menu"] },
  dt: { close: ["dt", "dd"], stop: ["dl"] },
  dd: { close: ["dt", "dd"], stop: ["dl"] },
  option: { close: ["option"], stop: ["select", "datalist", "optgroup"] },
  tr: { close: ["tr", "td", "th"], stop: ["table", "tbody", "thead", "tfoot"] },
  td: { close: ["td", "th"], stop: ["tr", "table"] },
  th: { close: ["td", "th"], stop: ["tr", "table"] },
};
const INLINE = new Set(["a", "abbr", "b", "bdi", "bdo", "cite", "code", "data", "dfn", "em", "font", "i", "kbd", "label", "mark", "q",
  "s", "samp", "small", "span", "strong", "sub", "sup", "time", "u", "var"]);
const TEXT_SKIP = new Set(["script", "style", "head", "title", "template", "noscript", "#comment"]);

const isWs = (c) => c === 32 || c === 9 || c === 10 || c === 12 || c === 13;
const TAG_OPEN = /<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)/y;
const rawCloseCache = new Map();

/** Attributes of one start tag, from just after the tag name to the closing ">" (quotes respected). */
function readTag(html, pos) {
  const attrs = Object.create(null); // no prototype: an attribute named "__proto__" stays a plain key
  const n = html.length;
  let count = 0;
  let i = pos;
  while (i < n) {
    const c = html.charCodeAt(i);
    if (c === 62) return { attrs, end: i + 1, selfClosing: html.charCodeAt(i - 1) === 47 };
    if (isWs(c) || c === 47) { i += 1; continue; }
    let j = i;
    while (j < n) { const d = html.charCodeAt(j); if (isWs(d) || d === 47 || d === 62 || d === 61) break; j += 1; }
    if (j === i) { i += 1; continue; } // a stray "=": skipped
    const name = html.slice(i, j).toLowerCase();
    i = j;
    while (i < n && isWs(html.charCodeAt(i))) i += 1;
    let value = "";
    if (html.charCodeAt(i) === 61) {
      i += 1;
      while (i < n && isWs(html.charCodeAt(i))) i += 1;
      const q = html.charCodeAt(i);
      if (q === 34 || q === 39) {
        const close = html.indexOf(q === 34 ? '"' : "'", i + 1);
        value = html.slice(i + 1, close === -1 ? n : close);
        i = close === -1 ? n : close + 1;
      } else {
        let k = i;
        while (k < n) { const d = html.charCodeAt(k); if (isWs(d) || d === 62) break; k += 1; }
        value = html.slice(i, k);
        i = k;
      }
    }
    if (!(name in attrs) && count < 64) { attrs[name] = decodeEntities(value).slice(0, 4096); count += 1; }
  }
  return { attrs, end: n, selfClosing: false };
}

function rawTextEnd(html, tag, from) {
  let re = rawCloseCache.get(tag);
  if (!re) { re = new RegExp(`</${tag}(?=[\\s/>])`, "ig"); rawCloseCache.set(tag, re); } // tag comes from RAW_TEXT only
  re.lastIndex = from;
  const m = re.exec(html);
  if (!m) return { contentEnd: html.length, next: html.length };
  const gt = html.indexOf(">", m.index);
  return { contentEnd: m.index, next: gt === -1 ? html.length : gt + 1 };
}

function closeImplicit(stack, close, stop) {
  for (let k = stack.length - 1; k > 0; k -= 1) {
    const tag = stack[k].tag;
    if (close.includes(tag)) { stack.length = k; return; }
    if (stop.includes(tag)) return;
  }
}

/** Builds a light element tree. Lenient like a browser: unmatched end tags are ignored, unclosed elements end with the file. */
function parseHtml(html) {
  const root = { tag: "#root", attrs: Object.create(null), children: [], parent: null, start: "" };
  const stack = [root];
  const n = html.length;
  let elements = 0;
  let truncated = false;
  let i = 0;
  const top = () => stack[stack.length - 1];
  // Adjacent text (e.g. thousands of stray "<") is merged into one node instead of one node per fragment.
  const pushText = (text) => {
    if (!text) return;
    const siblings = top().children;
    const last = siblings[siblings.length - 1];
    if (last && last.tag === "#text") last.text += decodeEntities(text);
    else siblings.push({ tag: "#text", text: decodeEntities(text), parent: top() });
  };
  while (i < n) {
    const lt = html.indexOf("<", i);
    if (lt === -1) { pushText(html.slice(i)); break; }
    if (lt > i) pushText(html.slice(i, lt));
    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      top().children.push({ tag: "#comment", text: html.slice(lt + 4, end === -1 ? n : end), parent: top() });
      i = end === -1 ? n : end + 3;
      continue;
    }
    const next = html.charCodeAt(lt + 1);
    if (next === 33 || next === 63) { const end = html.indexOf(">", lt); i = end === -1 ? n : end + 1; continue; } // doctype, CDATA, PI
    TAG_OPEN.lastIndex = lt;
    const m = TAG_OPEN.exec(html);
    if (!m) { pushText("<"); i = lt + 1; continue; }
    const tag = m[2].toLowerCase();
    const { attrs, end, selfClosing } = readTag(html, TAG_OPEN.lastIndex);
    i = end;
    if (m[1] === "/") {
      if (tag === "body" || tag === "html") continue;
      for (let k = stack.length - 1; k > 0; k -= 1) if (stack[k].tag === tag) { stack.length = k; break; }
      continue;
    }
    elements += 1;
    if (elements > MAX_ELEMENTS) { truncated = true; break; }
    if (CLOSES_P.has(tag) && top().tag === "p") stack.pop();
    if (IMPLICIT_END[tag]) closeImplicit(stack, IMPLICIT_END[tag].close, IMPLICIT_END[tag].stop);
    // The self-closing flag only means something inside SVG/MathML; in HTML "<div/>" still opens a div.
    const opens = !VOID.has(tag) && !RAW_TEXT.has(tag) && !(selfClosing && stack.some((s) => s.tag === "svg" || s.tag === "math"));
    // Past MAX_DEPTH a new element becomes a sibling of the deepest open one instead of its child: the tree depth stays
    // bounded (ancestor walks and end-tag scans stay cheap) while the new element still receives its own text.
    if (opens && stack.length >= MAX_DEPTH) stack.pop();
    const node = { tag, attrs, children: [], parent: top(), start: html.slice(lt, Math.min(end, lt + 400)) };
    top().children.push(node);
    if (RAW_TEXT.has(tag)) {
      const { contentEnd, next: after } = rawTextEnd(html, tag, i);
      const raw = html.slice(i, contentEnd);
      node.raw = raw.slice(0, 65536);
      if (tag === "title" || tag === "textarea") node.children.push({ tag: "#text", text: decodeEntities(raw), parent: node });
      i = after;
      continue;
    }
    if (opens) stack.push(node);
  }
  return { root, truncated };
}

const attr = (node, name) => (node?.attrs && Object.hasOwn(node.attrs, name) ? String(node.attrs[name]) : null);
const has = (node, name) => Boolean(node?.attrs) && Object.hasOwn(node.attrs, name);
const classTokens = (node) => (attr(node, "class") || "").toLowerCase().split(/\s+/).filter(Boolean);

/** Hidden from a visitor: `hidden`, aria-hidden, inline display:none / visibility:hidden / zero size, templates, noscript. */
function isHidden(node) {
  if (node.tag === "template" || node.tag === "noscript") return true;
  if (has(node, "hidden")) return true;
  if ((attr(node, "aria-hidden") || "").trim().toLowerCase() === "true") return true;
  const style = (attr(node, "style") || "").toLowerCase();
  if (style && /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0(?:px|em|rem|%)?\s*(?:;|!|$)|opacity\s*:\s*0(?:\.0+)?\s*(?:;|!|$))/.test(style)) return true;
  if (node.tag === "input" && (attr(node, "type") || "").trim().toLowerCase() === "hidden") return true;
  const classes = classTokens(node);
  return classes.includes("hidden") || classes.includes("d-none");
}

/** Elements in document order (iterative: deep pages cannot overflow the stack). */
function elementsOf(root, { skipHidden = true } = {}) {
  const out = [];
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    if (node.tag === "#text" || node.tag === "#comment") continue;
    if (node !== root) {
      if (skipHidden && isHidden(node)) continue;
      out.push(node);
    }
    for (let k = node.children.length - 1; k >= 0; k -= 1) stack.push(node.children[k]);
  }
  return out;
}

/** Visible text of a subtree; block elements are separated by spaces, inline elements are not. */
const visibleTextCache = new WeakMap(); // per parsed node; the tree is never mutated after parsing

function textOf(node, { skipHidden = true } = {}) {
  if (!node) return "";
  if (skipHidden && visibleTextCache.has(node)) return visibleTextCache.get(node);
  const out = [];
  const stack = [node];
  while (stack.length) {
    const cur = stack.pop();
    if (typeof cur === "string") { out.push(cur); continue; }
    if (cur.tag === "#text") { out.push(cur.text); continue; }
    if (cur.tag === "#comment") continue;
    if (cur !== node && (TEXT_SKIP.has(cur.tag) || (skipHidden && isHidden(cur)))) continue;
    const block = !INLINE.has(cur.tag);
    if (block) { stack.push(" "); out.push(" "); }
    for (let k = cur.children.length - 1; k >= 0; k -= 1) stack.push(cur.children[k]);
  }
  const result = collapse(out.join("")).normalize("NFC");
  if (skipHidden) visibleTextCache.set(node, result);
  return result;
}

const hasAncestor = (node, tag) => { for (let p = node.parent; p; p = p.parent) if (p.tag === tag) return true; return false; };

/** A short CSS-like description of an element for the evidence selector. */
function describe(node) {
  const safe = (v) => String(v).replace(/[^\w-]/g, "").slice(0, 40);
  const id = attr(node, "id");
  if (id && safe(id)) return `${node.tag}#${safe(id)}`;
  const name = attr(node, "name");
  if (name && safe(name)) return `${node.tag}[name="${safe(name)}"]`;
  const cls = classTokens(node).map(safe).filter(Boolean)[0];
  return cls ? `${node.tag}.${cls}` : node.tag;
}

const startOf = (node) => (node ? node.start || `<${node.tag}>` : "");
const excerptOf = (node) => (node ? `${startOf(node)} ${textOf(node)}` : "");

/* ------------------------------------------------------------------ page model */

function buildModel(html) {
  const { root, truncated } = parseHtml(html);
  const visible = elementsOf(root, { skipHidden: true });
  const all = elementsOf(root, { skipHidden: false });
  const byTag = (list, ...tags) => list.filter((n) => tags.includes(n.tag));
  const htmlEl = all.find((n) => n.tag === "html") || null;
  const body = all.find((n) => n.tag === "body") || root;
  const titleEl = all.find((n) => n.tag === "title") || null;
  const bodyText = textOf(body);
  return {
    root, truncated, visible, all, byTag, htmlEl, body, titleEl,
    title: titleEl ? textOf(titleEl) : "",
    metas: byTag(all, "meta"),
    bodyText,
    scripts: byTag(all, "script"),
  };
}

const metaContent = (model, key, value) => {
  const node = model.metas.find((m) => (attr(m, key) || "").trim().toLowerCase() === value);
  return node ? { node, content: (attr(node, "content") || "").trim() } : null;
};

/** Article / marketplace listing detection from fixed signals (scores, never page instructions). */
function detectPageKind(model) {
  const article = [];
  const market = [];
  const og = metaContent(model, "property", "og:type");
  if (og && og.content.toLowerCase() === "article") article.push({ points: 2, node: og.node, selector: 'meta[property="og:type"]' });
  for (const script of model.scripts) {
    if ((attr(script, "type") || "").toLowerCase() !== "application/ld+json") continue;
    const typeMatch = /"@type"\s*:\s*"(NewsArticle|Article|BlogPosting|ReportageNewsArticle|OpinionNewsArticle)"/.exec(script.raw || "");
    if (typeMatch) { article.push({ points: 2, node: script, selector: 'script[type="application/ld+json"]', excerpt: typeMatch[0] }); break; }
  }
  const published = metaContent(model, "property", "article:published_time");
  if (published) article.push({ points: 1, node: published.node, selector: 'meta[property="article:published_time"]' });
  const articleEl = model.byTag(model.visible, "article").find((a) => elementsOf(a).some((n) => n.tag === "time"));
  if (articleEl) article.push({ points: 1, node: articleEl, selector: "article" });
  const byline = model.visible.find((n) => attr(n, "rel") === "author" || classTokens(n).some((c) => /^(?:byline|author|autor)$/.test(c)));
  if (byline) article.push({ points: 1, node: byline, selector: describe(byline) });

  const heads = fold(`${model.title} ${model.byTag(model.visible, "h1").map((h) => textOf(h)).join(" ")}`);
  const text = fold(model.bodyText);
  // Folding keeps offsets for Romanian letters, so the excerpt is cut from the original text when the lengths agree.
  const source = text.length === model.bodyText.length ? model.bodyText : text;
  const signal = (re, selector = "body") => {
    const m = re.exec(text);
    if (m) market.push({ points: 1, selector, excerpt: around(source, m.index, m[0].length, 40) });
  };
  if (/\banunt(?:ul)?\b/.test(heads)) market.push({ points: 1, selector: "title, h1", excerpt: model.title });
  signal(/\b(?:vanzator(?:ul)?|seller)\b/);
  signal(/\b(?:anunturi similare|alte anunturi|similar listings)\b/);
  signal(/\b(?:contacteaza vanzatorul|trimite mesaj vanzatorului|contact seller)\b/);
  signal(/\bid anunt\b/);

  const score = (list) => list.reduce((sum, s) => sum + s.points, 0);
  const evidenceOf = (list) => {
    const top = list[0];
    const excerpt = list.map((s) => s.excerpt || startOf(s.node)).filter(Boolean).join(" | ");
    return { selector: top.selector, excerpt };
  };
  if (score(article) >= 3) return { kind: "article", evidence: evidenceOf(article) };
  if (score(market) >= 2) return { kind: "marketplace_listing", evidence: evidenceOf(market) };
  return { kind: "organization_site", evidence: null };
}

/** A page whose content only appears after JavaScript runs (single-page app shell). */
function isScriptShell(model) {
  if (model.bodyText.length >= 80) return false;
  const external = model.scripts.some((s) => has(s, "src"));
  const mount = model.visible.some((n) => ["root", "app", "__next", "__nuxt", "svelte"].includes((attr(n, "id") || "").toLowerCase()) && !textOf(n));
  return external || mount;
}

/* ------------------------------------------------------------------ identity */

// Company names written with a legal form ("Alfa Beta SRL", "Gamma S.A."): up to five capitalised words before the form.
// Quantifiers are bounded so a hostile page (one giant capitalised "word") cannot make the scan quadratic.
const LEGAL_NAME_RE = /((?:(?:\p{Lu}[\p{L}\p{M}'’-]{0,40}\.?|&)\s{1,3}){1,5})(S\.\s?R\.\s?L|S\.\s?A|S\.\s?N\.\s?C|P\.\s?F\.\s?A|SRL|SNC|PFA|SA)\.?(?![\p{L}\p{N}])/gu;
const IDENTITY_TEXT_MAX = 4000;
const NAME_FILLER = new Set(["copyright", "firma", "societatea", "compania", "operat", "operata", "administrat", "administrata",
  "realizat", "realizata", "proprietar", "furnizor", "partener", "client", "toate", "by", "powered", "sc"]);

function legalNamesIn(texts) {
  const found = [];
  for (const full of texts) {
    if (!full) continue;
    const text = full.slice(0, IDENTITY_TEXT_MAX);
    LEGAL_NAME_RE.lastIndex = 0;
    let m;
    while ((m = LEGAL_NAME_RE.exec(text)) && found.length < 20) {
      const words = m[1].trim().split(/\s+/);
      while (words.length && NAME_FILLER.has(fold(words[0]).replace(/[^a-z]/g, ""))) words.shift();
      if (!words.length) continue;
      const display = `${words.join(" ")} ${m[2].replace(/\s/g, "")}`;
      const key = normalizeName(display);
      if (!key.normalized) continue;
      found.push({ display, tokens: new Set(key.tokens) });
    }
  }
  // Distinct names: one name is the "same" as another when its words are a subset of the other's ("Aurora SRL" ⊂ "Brutăria Aurora SRL").
  const distinct = [];
  for (const item of found) {
    const same = distinct.find((d) => [...item.tokens].every((t) => d.tokens.has(t)) || [...d.tokens].every((t) => item.tokens.has(t)));
    if (!same) distinct.push(item);
    else if (item.tokens.size > same.tokens.size) { same.tokens = item.tokens; same.display = item.display; }
  }
  return distinct.map((d) => d.display);
}

/** Places where a company states who it is: title, h1, header, footer, address and contact blocks. */
function identityBlocks(model) {
  const blocks = model.visible.filter((n) => ["h1", "header", "footer", "address"].includes(n.tag)
    || (attr(n, "role") || "").toLowerCase() === "contentinfo"
    || /(?:^|[\s_-])(?:footer|contact)(?:$|[\s_-])/i.test(`${attr(n, "id") || ""} ${attr(n, "class") || ""}`));
  return [model.title, ...blocks.map((n) => textOf(n))];
}

function containsName(haystack, needleKey) {
  if (!needleKey) return false;
  const hay = normalizeName(haystack).normalized;
  return ` ${hay} `.includes(` ${needleKey} `);
}

/* ------------------------------------------------------------------ contact data */

const PHONE_RE = /(?<![\d+])(?:(?:\+|00)\s?40[\s.\-/()]{0,4}(?:\d[\s.\-/()]{0,3}){8}\d|0[\s.\-/()]{0,3}(?:\d[\s.\-/()]{0,3}){8}\d)(?!\d)/g;

/** Romanian phone number to +40XXXXXXXXX, or null when it is not a plausible landline/mobile number. */
function normalizeRoPhone(raw) {
  let digits = String(raw || "").replace(/\D/g, "");
  if (digits.startsWith("0040")) digits = digits.slice(4);
  else if (digits.startsWith("40") && digits.length >= 11) digits = digits.slice(2);
  if (digits.length === 10 && digits[0] === "0") digits = digits.slice(1);
  return digits.length === 9 && /^[237]/.test(digits) ? `+40${digits}` : null;
}

const EMAIL_RE = /[A-Za-z0-9._%+-]{1,64}@(?:[A-Za-z0-9-]{1,63}\.){1,8}[A-Za-z]{2,24}/g;
const NOT_EMAIL_TLD = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp", "avif", "css", "js"]);
const plausibleEmail = (value) => !NOT_EMAIL_TLD.has(value.split(".").pop().toLowerCase());

function safeDecode(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}

function around(text, index, length, pad = 60) {
  return text.slice(Math.max(0, index - pad), Math.min(text.length, index + length + pad));
}

const ADDRESS_RE = /\b(?:str\.|strada|bd\.|bdul\.?|b-dul\.?|bulevardul|calea|sos\.|soseaua|aleea|piata|splaiul|intrarea)\s+[^,;\n]{2,60}?,?\s*(?:nr\.?|numarul)\s*\d+[a-z]?/i;

/* ------------------------------------------------------------------ checks */

const SERVICES_HEADING = /\b(?:servicii(?:le)?|services|ce oferim|ce facem|oferta noastra|ofertele|produse(?:le)?|products|meniu(?:l)?|preturi|tarife|solutii|what we do)\b/;
const SERVICES_BLOCK = /(?:servic|oferta|offer|produse|products|pricing|preturi|tarife)/;
const GENERIC_TITLES = new Set(["home", "acasa", "index", "untitled", "document", "pagina principala", "welcome", "bine ati venit", "new page", "pagina noua", "site"]);
// Matched on folded (ASCII, lowercase, whitespace-collapsed) text; quantifiers bounded to keep the scan linear.
const INJECTION_PATTERNS = [
  /\bignor\w{0,10} (?:\w{1,20} ){0,4}(?:instructiuni|instructions?|indicatii|reguli)/,
  /\b(?:previous|prior|above) instructions?\b|\binstructiunile anterioare\b/,
  /\bsystem prompt\b|\bprompt(?:ul)? de sistem\b/,
  /\basistent\w{0,6} (?:ai|ia|llm|virtual\w{0,4}|automat\w{0,4})\b/,
  /\b(?:agent\w{0,6}|model\w{0,6}) (?:ai|llm)\b/,
  /\b(?:you are|esti) (?:now |acum )?(?:an? )?(?:ai|assistant|asistent\w{0,6}|language model)\b/,
  /\b(?:for|to|pentru|catre) (?:the )?(?:ai|llm|assistant|asistent\w{0,6}) ?[:,-]/,
];

function suspectInjection(model) {
  const comments = [];
  const stack = [model.root];
  while (stack.length) {
    const node = stack.pop();
    if (node.tag === "#comment") comments.push(node.text);
    else if (node.children) for (const child of node.children) stack.push(child);
  }
  const everything = collapse(fold(`${textOf(model.root, { skipHidden: false })} ${comments.join(" ")} ${model.metas.map((m) => attr(m, "content") || "").join(" ")}`).replace(/[^a-z0-9:,-]+/g, " "));
  return INJECTION_PATTERNS.some((re) => re.test(everything));
}

function makeCheck(def, status, observation, evidence = {}, label = "OBSERVED") {
  return {
    id: def.id,
    area: def.area,
    status,
    observation: clip(observation, 400),
    evidence: { selector: clip(evidence.selector || "html", 120), excerpt: clip(evidence.excerpt || ""), method: "static-html" },
    label,
  };
}

const DEF = Object.fromEntries(AUDIT_CHECKS.map((c) => [c.id, c]));
const quote = (value, max = 80) => `„${clip(value, max)}”`;

function checkIdentity(model, { orgName, pageKind, legalNames }) {
  const def = DEF.identity_name;
  if (pageKind.kind === "article") return makeCheck(def, "ISSUE", "Pagina pare un articol (presă sau blog), nu site-ul propriu al firmei.", pageKind.evidence, "INFERRED");
  if (pageKind.kind === "marketplace_listing") return makeCheck(def, "ISSUE", "Pagina pare o listare pe un marketplace, nu site-ul propriu al firmei.", pageKind.evidence, "INFERRED");
  if (legalNames.length >= 2) {
    return makeCheck(def, "ISSUE", `Pagina numește firme diferite (${legalNames.slice(0, 3).map((n) => quote(n, 60)).join("; ")}); datele de identitate sunt contradictorii.`,
      { selector: "title, h1, header, footer", excerpt: legalNames.slice(0, 3).join(" | ") }, "INFERRED");
  }
  const key = normalizeName(orgName).normalized;
  if (!key) return makeCheck(def, "UNKNOWN", "Numele firmei nu e cunoscut; potrivirea cu pagina nu poate fi verificată.", { selector: "head > title", excerpt: model.title });
  const places = [
    ["head > title", "titlu", model.title ? [model.titleEl] : []],
    ["h1", "titlul principal (h1)", model.byTag(model.visible, "h1")],
    ["footer", "subsolul paginii (footer)", model.visible.filter((n) => n.tag === "footer" || (attr(n, "role") || "").toLowerCase() === "contentinfo")],
  ];
  for (const [selector, where, nodes] of places) {
    const hit = nodes.find((n) => containsName(textOf(n), key));
    if (hit) return makeCheck(def, "PASS", `Numele ${quote(orgName)} apare în ${where}.`, { selector, excerpt: textOf(hit) });
  }
  return makeCheck(def, "ISSUE", `Numele ${quote(orgName)} nu apare în titlu, h1 sau subsolul paginii.`, { selector: "head > title, h1, footer", excerpt: model.title });
}

function checkTitle(model) {
  const def = DEF.title_present;
  const title = collapse(model.title);
  if (!title) return makeCheck(def, "ISSUE", "Pagina nu are titlu (<title>) sau titlul e gol.", { selector: "head > title", excerpt: model.titleEl ? startOf(model.titleEl) : "" });
  if (GENERIC_TITLES.has(fold(title).replace(/[^a-z ]/g, "").trim())) return makeCheck(def, "ISSUE", `Titlul ${quote(title)} e generic și nu descrie firma.`, { selector: "head > title", excerpt: title });
  return makeCheck(def, "PASS", `Pagina are titlu: ${quote(title, 120)}.`, { selector: "head > title", excerpt: title });
}

function checkServices(model) {
  const def = DEF.services_described;
  const heading = model.byTag(model.visible, "h2", "h3", "h4").find((h) => SERVICES_HEADING.test(fold(textOf(h))));
  if (heading) return makeCheck(def, "PASS", `Există o secțiune despre servicii: ${quote(textOf(heading))}.`, { selector: describe(heading), excerpt: textOf(heading) }, "INFERRED");
  const block = model.visible.find((n) => (has(n, "id") || has(n, "class")) && !INLINE.has(n.tag) && n.tag !== "nav"
    && SERVICES_BLOCK.test(fold(`${attr(n, "id") || ""} ${attr(n, "class") || ""}`)) && !hasAncestor(n, "nav") && textOf(n).length >= 20);
  if (block) return makeCheck(def, "PASS", "Există o secțiune marcată ca servicii sau ofertă.", { selector: describe(block), excerpt: textOf(block) }, "INFERRED");
  return makeCheck(def, "ISSUE", "Pagina nu are o secțiune sau un titlu care să descrie serviciile.", { selector: "h2, h3, h4, section", excerpt: "" }, "INFERRED");
}

function checkNavigation(model) {
  const def = DEF.navigation;
  const navs = model.visible.filter((n) => n.tag === "nav" || (attr(n, "role") || "").toLowerCase() === "navigation");
  for (const nav of navs) {
    const links = elementsOf(nav).filter((n) => n.tag === "a" && has(n, "href"));
    if (links.length >= 2) return makeCheck(def, "PASS", `Pagina are un meniu de navigare cu ${links.length} legături.`, { selector: describe(nav), excerpt: links.map((l) => textOf(l) || attr(l, "href")).join(" · ") });
  }
  const header = model.byTag(model.visible, "header").find((h) => elementsOf(h).filter((n) => n.tag === "a" && has(n, "href")).length >= 3);
  if (header) {
    const links = elementsOf(header).filter((n) => n.tag === "a" && has(n, "href"));
    return makeCheck(def, "PASS", `Antetul paginii conține ${links.length} legături de navigare.`, { selector: describe(header), excerpt: links.map((l) => textOf(l) || attr(l, "href")).join(" · ") }, "INFERRED");
  }
  return makeCheck(def, "ISSUE", "Pagina nu are un meniu de navigare.", { selector: "nav", excerpt: "" });
}

function collectPhones(model) {
  const phones = [];
  const add = (value, evidence) => { if (value && !phones.some((p) => p.value === value)) phones.push({ value, ...evidence }); };
  for (const link of model.byTag(model.visible, "a")) {
    const href = (attr(link, "href") || "").trim();
    if (/^tel:/i.test(href)) add(normalizeRoPhone(safeDecode(href.slice(4))), { selector: 'a[href^="tel:"]', excerpt: excerptOf(link) });
  }
  PHONE_RE.lastIndex = 0;
  let m;
  while ((m = PHONE_RE.exec(model.bodyText)) && phones.length < 10) add(normalizeRoPhone(m[0]), { selector: "body (text)", excerpt: around(model.bodyText, m.index, m[0].length) });
  return phones;
}

function checkPhone(model, phones) {
  const def = DEF.contact_phone;
  if (!phones.length) return makeCheck(def, "ISSUE", "Nu apare niciun număr de telefon în pagină.", { selector: 'a[href^="tel:"], body (text)', excerpt: "" });
  if (phones.length === 1) return makeCheck(def, "PASS", `Pagina afișează un număr de telefon (${phones[0].value}).`, phones[0]);
  const list = phones.slice(0, 3).map((p) => p.value).join("; ");
  return makeCheck(def, "PASS", `Pagina afișează ${phones.length} numere de telefon diferite (${list}); trebuie confirmat care e actual.`,
    { selector: phones[0].selector, excerpt: phones.slice(0, 3).map((p) => clip(p.excerpt, 60)).join(" | ") });
}

function checkEmail(model) {
  const def = DEF.contact_email;
  for (const link of model.byTag(model.visible, "a")) {
    const href = (attr(link, "href") || "").trim();
    if (!/^mailto:/i.test(href)) continue;
    const address = safeDecode(href.slice(7)).split(/[?,]/)[0].trim();
    if (address && new RegExp(`^${EMAIL_RE.source}$`).test(address)) {
      return makeCheck(def, "PASS", `Pagina afișează o adresă de e-mail (${clip(address, 80)}).`, { selector: 'a[href^="mailto:"]', excerpt: excerptOf(link) });
    }
  }
  EMAIL_RE.lastIndex = 0;
  let m;
  while ((m = EMAIL_RE.exec(model.bodyText))) {
    if (!plausibleEmail(m[0])) continue;
    return makeCheck(def, "PASS", `Pagina afișează o adresă de e-mail (${clip(m[0], 80)}).`, { selector: "body (text)", excerpt: around(model.bodyText, m.index, m[0].length) });
  }
  return makeCheck(def, "ISSUE", "Nu apare nicio adresă de e-mail în pagină.", { selector: 'a[href^="mailto:"], body (text)', excerpt: "" });
}

function checkAddress(model) {
  const def = DEF.contact_address;
  const address = model.byTag(model.visible, "address").find((n) => textOf(n));
  if (address) return makeCheck(def, "PASS", `Pagina afișează o adresă: ${quote(textOf(address), 120)}.`, { selector: "address", excerpt: textOf(address) });
  const street = model.visible.find((n) => (attr(n, "itemprop") || "").toLowerCase() === "streetaddress" && textOf(n));
  if (street) return makeCheck(def, "PASS", `Pagina afișează o adresă: ${quote(textOf(street), 120)}.`, { selector: '[itemprop="streetAddress"]', excerpt: textOf(street) });
  const ld = model.scripts.find((s) => (attr(s, "type") || "").toLowerCase() === "application/ld+json" && /"streetAddress"\s*:\s*"[^"]{3,}"/.test(s.raw || ""));
  if (ld) return makeCheck(def, "PASS", "Datele structurate ale paginii conțin o adresă (streetAddress).", { selector: 'script[type="application/ld+json"]', excerpt: /"streetAddress"\s*:\s*"[^"]{3,}"/.exec(ld.raw)[0] });
  const folded = foldDiacritics(model.bodyText);
  const m = ADDRESS_RE.exec(folded);
  if (m) {
    const original = model.bodyText.slice(m.index, m.index + m[0].length); // folding keeps offsets for Romanian letters
    return makeCheck(def, "PASS", `Textul paginii conține o adresă: ${quote(original, 120)}.`, { selector: "body (text)", excerpt: around(model.bodyText, m.index, m[0].length, 20) }, "INFERRED");
  }
  return makeCheck(def, "ISSUE", "Nu apare o adresă fizică în pagină.", { selector: "address, body (text)", excerpt: "" });
}

const FIELD_SKIP_TYPES = new Set(["hidden", "submit", "button", "image", "reset"]);
const fieldsOf = (form) => elementsOf(form).filter((n) => (n.tag === "input" && !FIELD_SKIP_TYPES.has((attr(n, "type") || "text").trim().toLowerCase()))
  || n.tag === "textarea" || n.tag === "select");

function isSearchForm(form, fields) {
  if ((attr(form, "role") || "").toLowerCase() === "search" || hasAncestor(form, "search")) return true;
  if (/(?:search|cauta|cautare|\?q=)/i.test(foldDiacritics(attr(form, "action") || ""))) return true;
  return fields.some((f) => (attr(f, "type") || "").toLowerCase() === "search") || (fields.length === 1 && /^(?:q|s|search|cauta)$/i.test(attr(fields[0], "name") || ""));
}

function checkContactForm(model) {
  const def = DEF.contact_form;
  for (const form of model.byTag(model.visible, "form")) {
    const fields = fieldsOf(form);
    if (!fields.length || isSearchForm(form, fields)) continue;
    if (fields.some((f) => (attr(f, "type") || "").toLowerCase() === "password")) continue; // a login form is not a contact form
    const textual = fields.filter((f) => f.tag === "textarea" || ["text", "email", "tel", ""].includes((attr(f, "type") || "").trim().toLowerCase()));
    if (fields.some((f) => f.tag === "textarea") || textual.length >= 2) {
      return makeCheck(def, "PASS", `Pagina are un formular de contact (${fields.length} câmpuri).`, { selector: describe(form), excerpt: startOf(form) });
    }
  }
  return makeCheck(def, "ISSUE", "Pagina nu are un formular de contact.", { selector: "form", excerpt: "" });
}

function checkFormLabels(model) {
  const def = DEF.form_labels;
  const labelFor = new Set(model.byTag(model.all, "label").map((l) => attr(l, "for")).filter(Boolean));
  const fields = model.byTag(model.visible, "form").flatMap(fieldsOf);
  if (!fields.length) return makeCheck(def, "NOT_APPLICABLE", "Pagina nu are formulare.", { selector: "form", excerpt: "" });
  const labelled = (f) => (attr(f, "id") && labelFor.has(attr(f, "id"))) || hasAncestor(f, "label")
    || Boolean(collapse(attr(f, "aria-label"))) || Boolean(collapse(attr(f, "aria-labelledby"))) || Boolean(collapse(attr(f, "title")));
  const missing = fields.filter((f) => !labelled(f));
  if (!missing.length) {
    return makeCheck(def, "PASS", fields.length === 1 ? "Singurul câmp de formular are etichetă." : `Toate cele ${fields.length} câmpuri din formulare au etichetă.`,
      { selector: "form label", excerpt: fields.map(startOf).slice(0, 2).join(" ") });
  }
  const counted = missing.length === fields.length && fields.length === 1 ? "Singurul câmp de formular nu are" : `${missing.length} din ${fields.length} câmpuri de formular nu au`;
  return makeCheck(def, "ISSUE", `${counted} etichetă (label sau aria-label); textul din placeholder nu ține loc de etichetă.`,
    { selector: `form ${describe(missing[0])}`, excerpt: missing.slice(0, 2).map(startOf).join(" ") });
}

function checkViewport(model) {
  const def = DEF.mobile_viewport;
  const viewport = metaContent(model, "name", "viewport");
  if (!viewport) return makeCheck(def, "ISSUE", "Pagina nu declară viewport pentru mobil: pe telefon se afișează la lățimea unui ecran de desktop, micșorată.", { selector: 'meta[name="viewport"]', excerpt: "" });
  const content = viewport.content.toLowerCase().replace(/\s+/g, "");
  if (!/(?:^|[,;])width=device-width(?:$|[,;])/.test(content)) return makeCheck(def, "ISSUE", "Meta viewport nu folosește width=device-width; pagina nu se adaptează la lățimea telefonului.", { selector: 'meta[name="viewport"]', excerpt: startOf(viewport.node) });
  const zoomBlocked = /user-scalable=(?:no|0)/.test(content) || /maximum-scale=1(?:\.0+)?(?:$|[,;])/.test(content);
  return makeCheck(def, "PASS", `Pagina declară viewport pentru mobil (width=device-width).${zoomBlocked ? " Zoom-ul e blocat (user-scalable / maximum-scale)." : ""}`, { selector: 'meta[name="viewport"]', excerpt: startOf(viewport.node) });
}

function checkHttps(url) {
  const def = DEF.https;
  let protocol = "";
  try { protocol = new URL(String(url || "")).protocol; } catch { /* unknown URL */ }
  if (protocol === "https:") return makeCheck(def, "PASS", "Pagina e servită prin HTTPS.", { selector: "url", excerpt: url });
  if (protocol === "http:") return makeCheck(def, "ISSUE", "Pagina e servită prin HTTP, fără criptare.", { selector: "url", excerpt: url });
  return makeCheck(def, "UNKNOWN", "Adresa paginii nu e cunoscută; protocolul nu poate fi verificat.", { selector: "url", excerpt: url || "" });
}

function checkLang(model) {
  const def = DEF.lang_attr;
  const lang = collapse(attr(model.htmlEl, "lang"));
  if (lang) return makeCheck(def, "PASS", `Limba paginii e declarată: ${quote(lang, 20)}.`, { selector: "html[lang]", excerpt: startOf(model.htmlEl) });
  return makeCheck(def, "ISSUE", "Elementul <html> nu declară limba paginii (atributul lang).", { selector: "html", excerpt: model.htmlEl ? startOf(model.htmlEl) : "" });
}

function checkImages(model) {
  const def = DEF.images_alt;
  const images = model.byTag(model.visible, "img");
  if (!images.length) return makeCheck(def, "NOT_APPLICABLE", "Pagina nu are imagini.", { selector: "img", excerpt: "" });
  const missing = images.filter((img) => !has(img, "alt"));
  if (!missing.length) {
    return makeCheck(def, "PASS", images.length === 1 ? "Singura imagine din pagină are atributul alt." : `Toate cele ${images.length} imagini au atributul alt.`, { selector: "img[alt]", excerpt: startOf(images[0]) });
  }
  const counted = images.length === 1 ? "Singura imagine din pagină nu are" : `${missing.length} din ${images.length} imagini nu au`;
  return makeCheck(def, "ISSUE", `${counted} atributul alt (text alternativ).`, { selector: "img:not([alt])", excerpt: missing.slice(0, 2).map(startOf).join(" ") });
}

function checkAnchors(model) {
  const def = DEF.internal_anchors;
  const ids = new Set();
  for (const n of model.all) {
    if (attr(n, "id")) ids.add(attr(n, "id"));
    if (n.tag === "a" && attr(n, "name")) ids.add(attr(n, "name"));
  }
  const anchors = model.byTag(model.visible, "a").map((a) => ({ a, href: (attr(a, "href") || "").trim() }))
    .filter(({ href }) => href.startsWith("#") && href.length > 1 && href.toLowerCase() !== "#top");
  if (!anchors.length) return makeCheck(def, "NOT_APPLICABLE", "Pagina nu are ancore interne (#...).", { selector: 'a[href^="#"]', excerpt: "" });
  const broken = anchors.filter(({ href }) => !ids.has(safeDecode(href.slice(1))));
  if (!broken.length) {
    return makeCheck(def, "PASS", anchors.length === 1 ? "Singura legătură internă are ținta în pagină." : `Toate cele ${anchors.length} legături interne au ținta în pagină.`,
      { selector: 'a[href^="#"]', excerpt: anchors.slice(0, 4).map(({ href }) => href).join(" ") });
  }
  const names = [...new Set(broken.map(({ href }) => clip(href, 40)))].slice(0, 5).join(", ");
  return makeCheck(def, "ISSUE", `${broken.length} din ${anchors.length} legături interne duc spre secțiuni care nu există în pagină (${names}).`,
    { selector: 'a[href^="#"]', excerpt: broken.slice(0, 2).map(({ a }) => excerptOf(a)).join(" | ") });
}

/* ------------------------------------------------------------------ public API */

function sanitizeUrl(url) {
  const text = collapse(url).slice(0, 2048);
  if (!text) return "";
  try {
    const parsed = new URL(text);
    parsed.username = "";
    parsed.password = "";
    return parsed.href;
  } catch {
    return clip(text, 300);
  }
}

/**
 * Audits one page's static HTML.
 * @param {{ html: string, url?: string, orgName?: string, fetchedAt?: string | Date | null, sourceKind?: string }} input
 * @returns {{ version: "audit-v1", url: string, sourceKind: string, fetchedAt: string | null, pageKind: string,
 *   checks: Array<{ id, area, status: "PASS"|"ISSUE"|"UNKNOWN"|"NOT_APPLICABLE", observation, evidence: { selector, excerpt, method: "static-html" }, label: "OBSERVED"|"INFERRED" }>,
 *   signals: { legalNames: string[], phones: string[], scriptShell: boolean, injectionSuspected: boolean }, limits: string[] }}
 */
export function auditHtml({ html, url = "", orgName = "", fetchedAt = null, sourceKind = "fixture" } = {}) {
  let source = html;
  if (source instanceof Uint8Array) source = Buffer.from(source).toString("utf8");
  if (typeof source !== "string") throw new HubError("validation", "Auditul are nevoie de conținutul HTML al paginii (text).");
  const limits = [...BASE_LIMITS];
  if (source.length > MAX_HTML_CHARS) {
    source = source.slice(0, MAX_HTML_CHARS);
    limits.push("Pagina depășește 2 MB; a fost analizată doar prima parte.");
  }
  const kind = /^[a-z_-]{1,30}$/i.test(String(sourceKind || "")) ? String(sourceKind) : "unknown";
  if (kind === "fixture") limits.push("Sursa e un site fixture local, cu date fictive; nu e un site real.");
  const safeUrl = sanitizeUrl(url);
  const at = fetchedAt instanceof Date ? (Number.isNaN(fetchedAt.getTime()) ? null : fetchedAt.toISOString()) : (fetchedAt ? clip(fetchedAt, 40) : null);
  const name = clip(orgName, 200);
  const result = (checks, extra) => ({ version: AUDIT_VERSION, url: safeUrl, sourceKind: kind, fetchedAt: at, ...extra, checks, limits });

  if (!source.trim()) {
    limits.push("Pagina e goală; nicio verificare de conținut nu s-a putut face.");
    const checks = AUDIT_CHECKS.map((def) => (def.id === "https" ? checkHttps(safeUrl) : makeCheck(def, "UNKNOWN", "Pagina e goală; verificarea nu se poate face.", { selector: "html", excerpt: "" })));
    return result(checks, { pageKind: "unknown", signals: { legalNames: [], phones: [], scriptShell: false, injectionSuspected: false } });
  }

  const model = buildModel(source);
  if (model.truncated) limits.push("Pagina are foarte multe elemente; a fost analizată doar prima parte.");
  const pageKind = detectPageKind(model);
  const legalNames = legalNamesIn(identityBlocks(model));
  const phones = collectPhones(model);
  const scriptShell = pageKind.kind === "organization_site" && isScriptShell(model);
  const injectionSuspected = suspectInjection(model);
  if (injectionSuspected) limits.push("Pagina conține text formulat ca instrucțiuni pentru un asistent automat (posibil prompt injection); textul a fost tratat doar ca dată și nu a influențat verificările.");
  if (scriptShell) limits.push("Conținutul paginii pare generat prin JavaScript; verificările de conținut au rămas necunoscute.");

  const computed = {
    identity_name: () => checkIdentity(model, { orgName: name, pageKind, legalNames }),
    title_present: () => checkTitle(model),
    services_described: () => checkServices(model),
    navigation: () => checkNavigation(model),
    contact_phone: () => checkPhone(model, phones),
    contact_email: () => checkEmail(model),
    contact_address: () => checkAddress(model),
    contact_form: () => checkContactForm(model),
    form_labels: () => checkFormLabels(model),
    mobile_viewport: () => checkViewport(model),
    https: () => checkHttps(safeUrl),
    lang_attr: () => checkLang(model),
    images_alt: () => checkImages(model),
    internal_anchors: () => checkAnchors(model),
  };

  const nonOrg = pageKind.kind !== "organization_site";
  const kindLabel = pageKind.kind === "article" ? "un articol" : "o listare de marketplace";
  const checks = AUDIT_CHECKS.map((def) => {
    if (nonOrg && def.id !== "identity_name") {
      return makeCheck(def, "NOT_APPLICABLE", `Pagina analizată pare ${kindLabel}, nu site-ul firmei; verificarea nu se aplică.`, { selector: "html", excerpt: "" }, "INFERRED");
    }
    const check = computed[def.id]();
    // A script shell hides content from a static reader: absence is not evidence, so content checks become UNKNOWN.
    if (scriptShell && def.content && check.status !== "PASS") {
      return makeCheck(def, "UNKNOWN", "Conținutul pare generat prin JavaScript; HTML-ul static nu ajunge pentru această verificare.", { selector: "body", excerpt: excerptOf(model.body === model.root ? null : model.body) }, "INFERRED");
    }
    return check;
  });

  return result(checks, {
    pageKind: scriptShell ? "unknown" : pageKind.kind,
    signals: { legalNames: legalNames.slice(0, 5).map((n) => clip(n, 80)), phones: phones.slice(0, 5).map((p) => p.value), scriptShell, injectionSuspected },
  });
}

/* ------------------------------------------------------------------ opportunities */

/** Catalog tag per check (contract §2.3: responsive, contact, website, seo-basic, accessibility). */
export const CHECK_SERVICE_TAGS = Object.freeze({
  identity_name: "website",
  title_present: "seo-basic",
  services_described: "website",
  navigation: "website",
  contact_phone: "contact",
  contact_email: "contact",
  contact_address: "contact",
  contact_form: "contact",
  form_labels: "accessibility",
  mobile_viewport: "responsive",
  https: "website",
  lang_attr: "accessibility",
  images_alt: "accessibility",
  internal_anchors: "website",
});

// possibleEffect and conditionsToConfirm can reach a client-facing proposal (as "Întrebări"): neutral, careful wording,
// questions addressed to the company. Internal notes go to `notes`.
const OPPORTUNITY_TEXT = {
  identity_name: { effect: "Clienții pot găsi greu firma sau o pot confunda cu alta.", ask: ["Care este denumirea oficială a firmei și site-ul pe care îl considerați principal?"] },
  title_present: { effect: "Titlul paginii apare în rezultatele căutării; un titlu lipsă sau generic poate reduce numărul de vizite.", ask: ["Pentru ce căutări ați vrea să fiți găsiți mai ușor?"] },
  services_described: { effect: "Vizitatorii pot pleca fără să înțeleagă ce oferă firma.", ask: ["Care sunt serviciile principale pe care vreți să le prezentați?"] },
  navigation: { effect: "Fără un meniu clar, vizitatorii găsesc greu paginile importante.", ask: ["Ce pagini consultă cel mai des clienții dumneavoastră?"] },
  contact_phone: { effect: "Un client care vrea să sune nu găsește numărul direct pe pagină.", ask: ["Ce număr de telefon doriți să folosească clienții?"] },
  contact_email: { effect: "Un client care preferă să scrie nu găsește o adresă de e-mail pe pagină.", ask: ["Ce adresă de e-mail doriți să folosească clienții?"] },
  contact_address: { effect: "Clienții locali nu găsesc adresa, ceea ce poate conta și în căutările locale.", ask: ["Primiți clienți la o adresă fizică?"] },
  contact_form: { effect: "Vizitatorii care nu vor să sune nu au o cale rapidă de a cere o ofertă.", ask: ["Cum preferați să primiți cererile de ofertă?"] },
  form_labels: { effect: "Câmpurile fără etichetă sunt greu de folosit cu cititoarele de ecran și ușor de completat greșit.", ask: ["Formularul este folosit des de clienți?"] },
  mobile_viewport: { effect: "Pe telefon pagina poate apărea micșorată, iar vizitatorii pot renunța mai ușor.", ask: ["Câți dintre vizitatori vin de pe telefon?"] },
  https: { effect: "Browserele marchează paginile HTTP ca nesigure, ceea ce poate reduce încrederea vizitatorilor.", ask: ["Cine administrează găzduirea și domeniul site-ului?"] },
  lang_attr: { effect: "Cititoarele de ecran și traducerea automată pot alege greșit limba paginii.", ask: [] },
  images_alt: { effect: "Imaginile fără text alternativ nu sunt descrise pentru cititoarele de ecran și pentru motoarele de căutare.", ask: ["Imaginile de pe site prezintă produse sau lucrări proprii?"] },
  internal_anchors: { effect: "Legăturile care nu duc nicăieri dau impresia unui site neîngrijit.", ask: [] },
};

const INACTIVE_STATUS = /^(?:archived|disabled|inactive|retired|deleted)$/i;

function parseTags(raw) {
  if (Array.isArray(raw)) return raw.map((t) => String(t).trim().toLowerCase()).filter(Boolean);
  if (typeof raw === "string") {
    const text = raw.trim();
    if (text.startsWith("[")) { try { return parseTags(JSON.parse(text)); } catch { return []; } }
    return text.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
  }
  return [];
}

function activeServices(catalog) {
  const list = Array.isArray(catalog) ? catalog : Array.isArray(catalog?.services) ? catalog.services : [];
  return list.filter((s) => s && typeof s === "object" && s.id !== undefined && s.id !== null && String(s.id).trim()
    && s.active !== false && s.active !== 0 && s.enabled !== false && s.archived !== true && !INACTIVE_STATUS.test(String(s.status || "")))
    .map((s) => ({ id: String(s.id), name: collapse(s.name).slice(0, 120), tags: parseTags(s.tags) }));
}

/**
 * Turns the ISSUE checks of an audit into possible sales opportunities, each mapped to the first active catalog service
 * carrying the check's tag (catalog order = the owner's order). No service with that tag → serviceId null and a note
 * "niciun serviciu configurat". PASS / UNKNOWN / NOT_APPLICABLE checks never become opportunities.
 * @returns {Array<{ checkId, observation, possibleEffect, serviceId: string | null, conditionsToConfirm: string[], tag, label, notes: string[] }>}
 */
export function opportunitiesFromAudit(audit, catalog = []) {
  if (!audit || typeof audit !== "object" || !Array.isArray(audit.checks)) throw new HubError("validation", "Auditul lipsește sau nu are verificări.");
  if (audit.version !== undefined && audit.version !== AUDIT_VERSION) throw new HubError("validation", `Versiune de audit necunoscută: ${clip(audit.version, 20)}.`);
  const services = activeServices(catalog);
  const out = [];
  const seen = new Set();
  for (const check of audit.checks) {
    if (!check || check.status !== "ISSUE" || !Object.hasOwn(CHECK_SERVICE_TAGS, String(check.id)) || seen.has(String(check.id))) continue;
    const checkId = String(check.id);
    seen.add(checkId);
    const tag = CHECK_SERVICE_TAGS[checkId];
    const text = OPPORTUNITY_TEXT[checkId];
    let possibleEffect = text.effect;
    const ask = [...text.ask];
    if (checkId === "identity_name") {
      const kind = audit.pageKind;
      if (kind === "article" || kind === "marketplace_listing") {
        possibleEffect = "Firma pare să nu aibă un site propriu; informațiile despre ea apar doar pe pagini ale altora.";
        ask.unshift("Aveți un site oficial, în afară de această pagină?");
      } else if (Array.isArray(audit.signals?.legalNames) && audit.signals.legalNames.length >= 2) {
        possibleEffect = "Denumiri diferite pe aceeași pagină pot încurca clienții și reduc încrederea.";
      }
    }
    const notes = [];
    const service = services.find((s) => s.tags.includes(tag)) || null;
    if (!service) notes.push(`Pentru eticheta „${tag}” nu există niciun serviciu configurat în catalog; adaugă unul înainte de o propunere.`);
    if (check.label === "INFERRED") notes.push("Observația e dedusă (INFERRED), nu observată direct; confirm-o înainte de a o folosi într-o propunere.");
    notes.push("Auditul a citit doar HTML-ul static al unei singure pagini; confirmă observația pe site.");
    out.push({
      checkId,
      observation: clip(check.observation, 400),
      possibleEffect,
      serviceId: service ? service.id : null,
      conditionsToConfirm: ask,
      tag,
      label: check.label === "INFERRED" ? "INFERRED" : "OBSERVED",
      notes,
    });
  }
  return out;
}
