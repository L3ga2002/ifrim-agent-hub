// M11 „Ifrim Delivery” — the capture guard: the conditions a delivery capture must meet BEFORE a browser is launched, as pure checks
// plus ONE loopback probe. The delivery capture is its own narrow class (op capture.preview): a headless, fresh Chromium context on a
// Hub-started, snapshot-verified loopback preview of a sanitized hub-test project with synthetic data. It is neither OBS / screen
// capture nor Public Demo Mode on the live Hub, so MB1 (mediaPolicy.liveCapture) is never read here as permission and never written.
//
// - LIVE_PORTS / livePorts(config): the ports that belong to a Hub (8011, 8012, the UI dev server 3011, V1 on 3004 / 8004, the
//   configured port and the port of every allowed origin). They are refused REGARDLESS of test mode: media/capture.mjs relaxes the
//   configured port and the allowed origins in test mode (capture.mjs:357-358, needed by the demo harness, which films a TEST Hub);
//   a delivery never films any Hub, so that relaxation is closed here. `checkDemoOrigin` stays the first filter and must agree.
// - syntheticProjectProblems / assertSyntheticProject: source 'hub-test'; the marker written by the Hub with a known fixture and
//   data: "synthetic"; the folder is a direct child of the projects root and is neither the Hub repository nor a Hub data folder.
// - checkPreviewTarget: the origin is exactly the confirmed template origin AND the bundle manifest's start.url origin, and a process
//   the Hub itself supervises (factory-preview-<mission> or delivery-preview-<delivery>) is alive behind it.
// - probeNotHub: GET / and /api/session on that origin; any Hub answers /api/* with X-Hub-Version and X-Hub-Contract
//   (http/server.mjs:85-86), so their presence refuses the target (CAPTURE_TARGET_IS_HUB). No answer refuses too (fail closed).
// - pageGuard: an async (page) check for media/capture.mjs' optional `pageGuard` hook, run after every navigation and step: the
//   synthetic banner is rendered, the rendered text survives redaction unchanged, and it shows no absolute user path and no e-mail
//   outside example/test domains. A violation is CAPTURE_PRIVACY_REFUSED; the message names the kind of problem, never the text.
//
// Everything is pure except probeNotHub (one injectable `fetch`, loopback only) and the guard returned by pageGuard (it reads the
// page it is given). Nothing here launches a browser, starts a process or writes a file.
import path from "node:path";
import { HubError } from "../core/errors.mjs";
import { redactText } from "../security/redact.mjs";
import { checkDemoOrigin } from "../media/capture.mjs";
import { bounded } from "../tools/browser-core.mjs";
import { TEST_PROJECT_MARKER } from "../domain/projects.mjs";
import { FACTORY_DEMOS } from "../factory/fixtures.mjs";

/** Ports of a Hub whatever the configuration says: V2 (8011, 8012), its UI dev server (3011, proxies /api) and V1 (3004 / 8004). */
export const LIVE_PORTS = Object.freeze([8011, 8012, 3011, 3004, 8004]);
/** Headers every Hub sets on /api/* (http/server.mjs:85-86). */
export const HUB_HEADERS = Object.freeze(["x-hub-version", "x-hub-contract"]);
/** The two paths the not-a-Hub probe reads. */
export const PROBE_PATHS = Object.freeze(["/", "/api/session"]);
export const CAPTURE_HOSTS = Object.freeze(["127.0.0.1", "localhost"]);
export const SYNTHETIC_BANNER = "Date sintetice · demo local";
const REAL_PROJECT_TEXT = "captura unui proiect real cere decizia MB1 și o verificare a datelor — nu în M11";
const PAGE_TEXT_MAX = 200000;
// The same rule as media/capture.mjs for a selector that goes to Playwright: no braces, angle brackets, semicolons, comments, newlines.
const UNSAFE_SELECTOR = /[{}<>;\\\r\n\u0000]|\/\*|\*\//;

const refuse = (category, code, message, data) => new HubError(category, message, { code, ...(data ? { data } : {}) });

/**
 * The set of ports a delivery capture never touches. `config.testMode` is deliberately NOT consulted: the configured port and the
 * allowed origins of a TEST Hub are a Hub too.
 */
export function livePorts(config = {}) {
  const ports = new Set(LIVE_PORTS);
  const add = (value) => { const n = Number(value); if (Number.isInteger(n) && n > 0 && n < 65536) ports.add(n); };
  add(config?.port);
  const origins = config?.allowedOrigins instanceof Set ? [...config.allowedOrigins] : Array.isArray(config?.allowedOrigins) ? config.allowedOrigins : [];
  for (const origin of origins) { try { add(new URL(String(origin)).port); } catch { /* not an origin */ } }
  return ports;
}
export const isLivePort = (port, config = {}) => livePorts(config).has(Number(port));

/**
 * The origin of a delivery capture: http, 127.0.0.1 or localhost, an explicit port, nothing but the origin, and a port that is not a
 * Hub's — in test mode too. → { origin, host, port }. Throws CAPTURE_ORIGIN_INVALID / CAPTURE_ORIGIN_REFUSED / CAPTURE_ORIGIN_LIVE.
 */
export function assertCaptureOrigin(raw, { config = {} } = {}) {
  let url;
  try { url = new URL(String(raw ?? "")); } catch { throw refuse("validation", "CAPTURE_ORIGIN_INVALID", "Originea capturii nu este un URL valid."); }
  if (url.protocol !== "http:") throw refuse("policy", "CAPTURE_ORIGIN_REFUSED", "Captura de livrare acceptă doar un preview http de pe acest calculator.");
  if (!CAPTURE_HOSTS.includes(url.hostname)) throw refuse("policy", "CAPTURE_ORIGIN_REFUSED", "Captura de livrare filmează doar un preview local (127.0.0.1 sau localhost).");
  if (url.username || url.password) throw refuse("policy", "CAPTURE_ORIGIN_REFUSED", "Originea capturii nu poate conține date de autentificare.");
  if (!url.port) throw refuse("validation", "CAPTURE_ORIGIN_INVALID", "Originea capturii are nevoie de un port explicit.");
  if ((url.pathname && url.pathname !== "/") || url.search || url.hash) throw refuse("validation", "CAPTURE_ORIGIN_INVALID", "Dă doar originea (schemă, gazdă, port); paginile vin din pașii aprobați.");
  const port = Number(url.port);
  if (livePorts(config).has(port)) {
    throw refuse("policy", "CAPTURE_ORIGIN_LIVE", `Portul ${port} aparține unui Hub (sau unui server legat de el). Captura de livrare filmează doar preview-ul demo al proiectului, niciodată un Hub — nici în modul de test.`);
  }
  // The Studio's own filter (unchanged) must agree: it also knows the live Hub's default port and the UI dev server.
  const studio = checkDemoOrigin(url.origin, { config });
  if (studio.liveHub) throw refuse("policy", "CAPTURE_ORIGIN_LIVE", `Originea ${url.origin} este a Hub-ului; captura de livrare nu filmează Hub-ul.`);
  return { origin: url.origin, host: url.hostname, port };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Project: sanitized hub-test, synthetic data
// ---------------------------------------------------------------------------------------------------------------------------

const normPath = (p) => (process.platform === "win32" ? path.resolve(String(p)).toLowerCase() : path.resolve(String(p)));
const samePath = (a, b) => normPath(a) === normPath(b);
function insidePath(root, target) {
  const rel = path.relative(normPath(root), normPath(target));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}
/** The Hub's own folders a project may never be, contain or sit in. */
function hubDataDirs(config = {}) {
  return ["dataDir", "backupDir", "workDir", "mediaDir", "mediaWorkDir", "attachmentsDir", "preUpgradeDir", "dataRoot"]
    .map((key) => config?.[key]).filter((p) => typeof p === "string" && p && path.isAbsolute(p));
}

/**
 * Every reason the project is not a sanitized test project with synthetic data ([] when it is). `marker` is the parsed
 * .ifrim-hub-test.json (the caller reads it; a marker that is a link is the caller's refusal, like domain/projects.mjs readMarker).
 * `knownFixtures` defaults to the registered factory demos; `realPath`, when the caller resolved links, must be the same folder.
 * → [{ code, message }]
 */
export function syntheticProjectProblems(project, marker, { config = {}, knownFixtures = Object.keys(FACTORY_DEMOS), realPath = null } = {}) {
  const problems = [];
  const add = (code, message) => problems.push({ code, message });
  if (!project || typeof project !== "object" || project.source !== "hub-test") {
    add("DELIVERY_PROJECT_NOT_TEST", `Proiectul nu este un proiect de test al Hub-ului: ${REAL_PROJECT_TEXT}.`);
  }
  if (!marker || typeof marker !== "object" || Array.isArray(marker) || marker.createdBy !== "ifrim-agent-hub") {
    add("DELIVERY_MARKER_INVALID", `Markerul ${TEST_PROJECT_MARKER} lipsește, nu se poate citi sau nu a fost scris de Hub.`);
  } else {
    const fixtures = Array.isArray(knownFixtures) ? knownFixtures : [];
    if (typeof marker.fixture !== "string" || !marker.fixture || !fixtures.includes(marker.fixture)) {
      add("DELIVERY_FIXTURE_UNKNOWN", `Markerul proiectului nu numește un fixture cunoscut de Hub (${String(marker.fixture ?? "—").slice(0, 60)}).`);
    }
    if (marker.data !== "synthetic") {
      add("DELIVERY_DATA_NOT_SYNTHETIC", `Markerul proiectului nu declară date sintetice (data: "synthetic"): ${REAL_PROJECT_TEXT}.`);
    }
  }
  const dir = typeof project?.path === "string" ? project.path : "";
  const root = typeof config?.projectsRoot === "string" ? config.projectsRoot : "";
  if (!dir || !path.isAbsolute(dir) || !root || !path.isAbsolute(root)) {
    add("DELIVERY_PROJECT_PATH", "Nu pot verifica folderul proiectului (calea proiectului sau rădăcina proiectelor lipsește).");
  } else {
    if (!samePath(path.dirname(path.resolve(dir)), root)) add("DELIVERY_PROJECT_PATH", "Folderul proiectului nu este un copil direct al folderului de proiecte.");
    // Both directions, like projects.registerTest: the Hub repository is never the project, inside it or around it.
    if (config.hubRoot && (insidePath(config.hubRoot, dir) || insidePath(dir, config.hubRoot))) add("DELIVERY_PROJECT_PATH", "Folderul proiectului este chiar Hub-ul (sau se suprapune cu el); Hub-ul nu se filmează.");
    // A data folder itself, or a folder that holds one. (A project merely located under the data root is the test harness' layout,
    // where the projects root IS the data folder; the direct-child rule above still applies to it.)
    for (const data of hubDataDirs(config)) {
      if (insidePath(dir, data)) { add("DELIVERY_PROJECT_PATH", "Folderul proiectului este (sau conține) un folder de date al Hub-ului."); break; }
    }
    if (realPath !== null && realPath !== undefined && !(typeof realPath === "string" && samePath(realPath, dir))) {
      add("DELIVERY_PROJECT_PATH", "Folderul proiectului este o legătură (link sau junction) către alt loc; un proiect de test trebuie să fie un folder real.");
    }
  }
  return problems;
}

/** Throws the first problem (policy, with every problem in the details) or returns { ok, fixture, path }. */
export function assertSyntheticProject(project, marker, options = {}) {
  const problems = syntheticProjectProblems(project, marker, options);
  if (problems.length) throw refuse("policy", problems[0].code, problems[0].message, { problems });
  return { ok: true, fixture: marker.fixture, path: path.resolve(project.path) };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Preview target: the confirmed origin, served by a process the Hub supervises
// ---------------------------------------------------------------------------------------------------------------------------

const ID_PART = /^[A-Za-z0-9][A-Za-z0-9_-]{2,79}$/;
const originOf = (raw) => { try { const u = new URL(String(raw ?? "")); return u.origin === "null" ? null : u.origin; } catch { return null; } };

/** The supervisor keys of the only two previews a delivery may film. */
export function previewKeys({ id, missionId } = {}) {
  return { factory: ID_PART.test(String(missionId ?? "")) ? `factory-preview-${missionId}` : null, delivery: ID_PART.test(String(id ?? "")) ? `delivery-preview-${id}` : null };
}

/**
 * `checkPreviewTarget({ origin, delivery: { id, missionId, template, startUrl }, supervisor, config })` → { origin, port, key, pid }.
 * `template` is the delivery's frozen template (template.preview.origin), `startUrl` the bundle manifest's start.url. All of:
 * a valid non-Hub capture origin; equal to the template origin; equal to the start.url origin; a supervised preview alive
 * (`supervisor.get(key)` returns a record that has not exited). Whether the factory preview still belongs to this delivery's mission
 * stage is the caller's check (it knows the stage); a foreign process on the port is never accepted here.
 */
export function checkPreviewTarget({ origin, delivery = null, supervisor = null, config = {} } = {}) {
  const target = assertCaptureOrigin(origin, { config });
  const templateOrigin = originOf(delivery?.template?.preview?.origin);
  if (!templateOrigin || templateOrigin !== target.origin) {
    throw refuse("policy", "CAPTURE_ORIGIN_MISMATCH", `Originea ${target.origin} nu este cea din planul confirmat (${templateOrigin || "lipsește"}).`);
  }
  const startOrigin = originOf(delivery?.startUrl);
  if (!startOrigin || startOrigin !== target.origin) {
    throw refuse("policy", "CAPTURE_ORIGIN_MISMATCH", `Originea ${target.origin} nu este adresa de pornire a pachetului verificat (${startOrigin || "lipsește"}).`);
  }
  const keys = previewKeys(delivery || {});
  const alive = (key) => {
    if (!key || typeof supervisor?.get !== "function") return null;
    let record = null;
    try { record = supervisor.get(key) || null; } catch { record = null; }
    return record && record.exited !== true ? record : null;
  };
  const hit = [keys.factory, keys.delivery].map((key) => ({ key, record: alive(key) })).find((x) => x.record);
  if (!hit) {
    throw refuse("policy", "CAPTURE_PREVIEW_NOT_SUPERVISED", `Pe ${target.origin} nu rulează un preview pornit de Hub pentru această livrare; un proces străin de pe port nu se filmează.`);
  }
  return { origin: target.origin, port: target.port, key: hit.key, pid: Number.isInteger(hit.record.pid) ? hit.record.pid : null };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Not a Hub: one loopback probe
// ---------------------------------------------------------------------------------------------------------------------------

function headerOf(res, name) {
  const h = res?.headers;
  if (!h) return null;
  if (typeof h.get === "function") return h.get(name);
  const key = Object.keys(h).find((k) => k.toLowerCase() === name);
  return key === undefined ? null : h[key];
}

/**
 * `probeNotHub(origin, { fetch, config, timeoutMs })` → { ok: true, origin, checked: [{ path, status }] }.
 * The origin is validated first (so a Hub port is refused WITHOUT any request being sent), then GET / and GET /api/session are
 * read without following redirects. Refuses with CAPTURE_TARGET_IS_HUB when an X-Hub-Version or X-Hub-Contract header is present,
 * CAPTURE_TARGET_REDIRECTS when the page redirects to another origin, CAPTURE_TARGET_UNREACHABLE when there is no answer (a
 * target that cannot be shown not to be a Hub is not filmed). `fetch` is injectable (default: the global fetch); response bodies
 * are never read.
 */
export async function probeNotHub(origin, { fetch: fetchImpl = globalThis.fetch, config = {}, timeoutMs = 3000 } = {}) {
  const target = assertCaptureOrigin(origin, { config });
  if (typeof fetchImpl !== "function") throw refuse("tool", "CAPTURE_PROBE_UNAVAILABLE", "Verificarea „nu este un Hub” nu poate rula (fetch indisponibil); captura nu pornește fără ea.");
  const wait = Number.isInteger(timeoutMs) && timeoutMs >= 200 && timeoutMs <= 15000 ? timeoutMs : 3000;
  const checked = [];
  for (const probePath of PROBE_PATHS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), wait);
    let res;
    try {
      res = await fetchImpl(`${target.origin}${probePath}`, { method: "GET", redirect: "manual", cache: "no-store", credentials: "omit", headers: { accept: "*/*" }, signal: controller.signal });
    } catch {
      throw refuse("tool", "CAPTURE_TARGET_UNREACHABLE", `Preview-ul de pe ${target.origin} nu a răspuns la verificarea „nu este un Hub” (${probePath}); captura nu pornește fără această verificare.`);
    } finally { clearTimeout(timer); }
    const hubHeader = HUB_HEADERS.find((name) => { const v = headerOf(res, name); return v !== null && v !== undefined; });
    const status = Number(res?.status) || 0;
    const location = status >= 300 && status < 400 ? headerOf(res, "location") : null;
    try { await res?.body?.cancel?.(); } catch { /* nothing to release */ }
    if (hubHeader) {
      throw refuse("policy", "CAPTURE_TARGET_IS_HUB", `Serverul de pe ${target.origin} răspunde ca un Hub (antetul ${hubHeader}); captura de livrare nu filmează niciun Hub.`);
    }
    if (location) {
      const next = (() => { try { return new URL(String(location), target.origin).origin; } catch { return null; } })();
      if (next !== target.origin) throw refuse("policy", "CAPTURE_TARGET_REDIRECTS", `Preview-ul de pe ${target.origin} trimite spre altă origine; captura rămâne doar pe originea confirmată.`);
    }
    checked.push({ path: probePath, status });
  }
  return { ok: true, origin: target.origin, checked };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Page guard: what a frame may show
// ---------------------------------------------------------------------------------------------------------------------------

const USER_PATH_RES = [/[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s"'<>|]+/g, /(?<![\w.-])\/(?:home|Users)\/[^/\s"'<>]+/g];
const EMAIL_RE = /[A-Za-z0-9._%+-]+@((?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})/g;
/** example.<tld> (and its subdomains) plus the reserved test TLDs (RFC 2606 / 6761). */
const isTestDomain = (domain) => /(?:^|\.)example\.[a-z]{2,}$/.test(domain) || /\.(?:test|example|invalid|localhost)$/.test(domain);

/**
 * What a text may not show in a delivery frame → [{ code, count }] ([] when clean): SECRET_LIKE (redactText would change it),
 * USER_PATH (C:\Users\…, /home/…, /Users/…), FOREIGN_EMAIL (an address outside example/test domains). Pure; never returns the text.
 */
export function textViolations(text) {
  const value = typeof text === "string" ? text : "";
  const out = [];
  if (!value) return out;
  if (redactText(value) !== value) out.push({ code: "SECRET_LIKE", count: 1 });
  const paths = USER_PATH_RES.reduce((n, re) => n + (value.match(re) || []).length, 0);
  if (paths) out.push({ code: "USER_PATH", count: paths });
  let emails = 0;
  for (const m of value.matchAll(EMAIL_RE)) if (!isTestDomain(m[1].toLowerCase())) emails += 1;
  if (emails) out.push({ code: "FOREIGN_EMAIL", count: emails });
  return out;
}

const VIOLATION_TEXT = Object.freeze({
  BANNER_MISSING: `bannerul „${SYNTHETIC_BANNER}” nu este vizibil în pagină`,
  BANNER_TEXT: "bannerul paginii nu spune că datele sunt sintetice",
  SECRET_LIKE: "pagina arată un text care seamănă cu un secret (cheie, token sau parolă)",
  USER_PATH: "pagina arată o cale absolută de pe calculator (C:\\Users\\… sau /home/…)",
  FOREIGN_EMAIL: "pagina arată o adresă de e-mail în afara domeniilor de test (example.*, *.test)",
  PAGE_TOO_LARGE: "pagina are prea mult text pentru a fi verificată în întregime",
  PAGE_UNREADABLE: "pagina nu a putut fi citită pentru verificare",
});

/**
 * Runs INSIDE the page (a fixed function serialized by Playwright; never page-provided code): the banner's state, the rendered text
 * (document.title + body.innerText) and the values of rendered form fields (password and hidden fields excluded — the capture masks
 * passwords itself). A value typed by a capture step is therefore checked like any other visible text.
 */
function readPageForGuard({ bannerSelector, maxChars }) {
  const rendered = (el) => {
    if (!el) return false;
    const box = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return box.width > 1 && box.height > 1 && style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0.05;
  };
  let banner = null;
  try { banner = document.querySelector(bannerSelector); } catch { banner = null; }
  const parts = [String(document.title || ""), document.body ? String(document.body.innerText || "") : ""];
  let fields = 0;
  for (const el of document.querySelectorAll("input, textarea, select")) {
    const type = String(el.getAttribute("type") || "").toLowerCase();
    if (type === "password" || type === "hidden" || !rendered(el)) continue;
    const value = String(el.value ?? "");
    if (value) parts.push(value.slice(0, 2000));
    fields += 1;
    if (fields >= 300) break;
  }
  const all = parts.join("\n");
  return { bannerFound: Boolean(banner), bannerVisible: rendered(banner), bannerText: banner ? String(banner.innerText || banner.textContent || "").slice(0, 300) : "",
    text: all.slice(0, maxChars), truncated: all.length > maxChars };
}

/**
 * `pageGuard({ bannerSelector, bannerText, timeoutMs })` → async (page) => { ok: true, chars }.
 * For media/capture.mjs' optional `pageGuard` input (after the redaction check of every navigation and after every step): a throw
 * there becomes the capture's failure and its frames are wiped. `bannerText` (default /sintetic/i, diacritics-free match) is what
 * the banner must say; a banner that is present but hidden, or says something else, refuses like a missing one.
 */
export function pageGuard({ bannerSelector, bannerText = /sintetic/i, timeoutMs = 5000 } = {}) {
  if (typeof bannerSelector !== "string" || !bannerSelector.trim() || bannerSelector.length > 200 || UNSAFE_SELECTOR.test(bannerSelector)) {
    throw refuse("validation", "CAPTURE_BANNER_SELECTOR_INVALID", "Selectorul bannerului de date sintetice lipsește sau nu este valid.");
  }
  if (!(bannerText instanceof RegExp)) throw refuse("validation", "CAPTURE_BANNER_TEXT_INVALID", "Textul așteptat al bannerului trebuie dat ca expresie regulată.");
  const selector = bannerSelector.trim();
  const wait = Number.isInteger(timeoutMs) && timeoutMs >= 200 && timeoutMs <= 30000 ? timeoutMs : 5000;
  const plain = (s) => String(s || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  return async function deliveryPageGuard(page) {
    const violations = [];
    let snap = null;
    try { snap = await bounded(Promise.resolve().then(() => page.evaluate(readPageForGuard, { bannerSelector: selector, maxChars: PAGE_TEXT_MAX })), wait, "verificarea paginii"); }
    catch { snap = null; }
    if (!snap || typeof snap !== "object" || typeof snap.text !== "string") violations.push({ code: "PAGE_UNREADABLE", count: 1 });
    else {
      if (!snap.bannerFound || !snap.bannerVisible) violations.push({ code: "BANNER_MISSING", count: 1 });
      else if (!new RegExp(bannerText.source, bannerText.flags.replace(/[gy]/g, "")).test(plain(snap.bannerText))) violations.push({ code: "BANNER_TEXT", count: 1 });
      if (snap.truncated) violations.push({ code: "PAGE_TOO_LARGE", count: 1 });
      violations.push(...textViolations(snap.text));
    }
    if (violations.length) {
      const what = violations.map((v) => VIOLATION_TEXT[v.code] || v.code).join("; ");
      throw refuse("policy", "CAPTURE_PRIVACY_REFUSED", `Captura a fost oprită: ${what}. Niciun cadru nu se păstrează.`, { violations });
    }
    return { ok: true, chars: snap.text.length };
  };
}
