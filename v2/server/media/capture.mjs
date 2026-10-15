// M09 capture: capture sessions with markers, an obs-websocket v5 client (policy-blocked live recording) and the browser demo
// capture of Public Demo Mode.
//
// - Sessions (media_capture_sessions) are planned with a scope and a capture label; markers ({ kind, atMs, note }) are stored
//   in markers_json and searched by the asset library (assets.search, source "marker").
// - OBS: `obsClient()` speaks obs-websocket v5 over a loopback ws:// URL only (Hello → Identify with the challenge/salt
//   authentication → Identified, requests matched by requestId, per-request timeouts, close codes mapped to clear errors).
//   The password lives only in the client's closure until Identify is sent; it is never stored, logged or put in an event.
//   Recording the owner's screen is an external effect: `startObsRecording` refuses with LIVE_MEDIA_CAPTURE_DISABLED unless
//   settings.mediaPolicy.liveCapture === true AND the session scope carries an owner-session approval (MEDIA_B) bound to the
//   exact scope. M09 has no code path that writes that approval, so in this milestone it always refuses — before any socket
//   is opened. Stopping a recording that is RECORDING is fail-safe (never blocked by policy).
// - Browser demo (Public Demo Mode): only an origin on loopback that the CALLER allows (allowOrigin callback — the demo
//   harness serves a TEST Hub with synthetic data); the live Hub (port 8011) is refused unless liveCapture. Typed steps only
//   (no scripts, no URLs), a fresh Chromium context behind the Browser Workspace request guard and dead proxy, redaction CSS
//   injected by an init script before the first frame (and verified before recording starts), CDP Page.startScreencast JPEG
//   frames (quality ≥ 90) with their timestamps → an ffconcat list with the exact duration of every frame → constant-fps
//   H.264 → assets.ingestFile (category screen_recording, origin OWNED, the capture label as given) + markers.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { HubError } from "../core/errors.mjs";
import { newId } from "../core/ids.mjs";
import { json, parse } from "../storage/db.mjs";
import { DEFAULT_PORT } from "../config.mjs";
import { browserLaunchOptions, createRequestGuard, MAX_MAIN_REDIRECTS, onOrigin, bounded } from "../tools/browser-core.mjs";
import { redactText } from "../security/redact.mjs";
import { isInsideDir } from "./paths.mjs";
import { CAPTURE_LABELS } from "./assets.mjs";
import { hashCanonical } from "../core/canonical.mjs";
import { measureHold, HOLD_SCHEMA, HOLD_LIMITS } from "./holds.mjs";

export const CAPTURE_KINDS = Object.freeze(["obs", "browser_demo", "import", "interview"]);
export const CAPTURE_STATUSES = Object.freeze(["PLANNED", "RECORDING", "STOPPED", "FAILED", "CANCELLED"]);
/** Labels a capture may carry: NOT_APPLICABLE is for files that are not captures (fonts, music…). */
export const SESSION_CAPTURE_LABELS = Object.freeze(CAPTURE_LABELS.filter((l) => l !== "NOT_APPLICABLE"));
export const MARKER_KINDS = Object.freeze(["hook", "demo", "proof", "cta", "chapter", "highlight", "issue", "note", "start", "end"]);
export const DEMO_STEP_KINDS = Object.freeze(["goto", "click", "type", "press", "wait", "waitFor", "scroll", "highlight", "marker"]);
export const DEMO_MAX_STEPS = 60;
export const OBS_DEFAULT_URL = "ws://127.0.0.1:4455";
export const OBS_REQUEST_TYPES = Object.freeze(["GetVersion", "GetSceneList", "GetRecordStatus", "StartRecord", "StopRecord"]);
export const OBS_SUBPROTOCOL = "obswebsocket.json";
/** Always masked, whatever the caller passes: elements marked sensitive and password fields. */
export const DEFAULT_REDACT_SELECTORS = Object.freeze(["[data-sensitive]", "input[type=password]"]);
export const REDACTION_STYLE_ID = "ifrim-public-demo-redaction";
export const SCREENCAST_JPEG_QUALITY = 92; // ≥ 90: the frames are the master of the recording
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const MAX_MARKERS = 500;
const MAX_MARKER_MS = 24 * 60 * 60 * 1000;
const MAX_SCOPE_CHARS = 16384;
const DEFAULT_MAX_DURATION_MS = 3 * 60 * 1000;
const MAX_DURATION_MS = 15 * 60 * 1000;
const MAX_FRAME_BYTES_TOTAL = 2 * 1024 ** 3;
const ENCODE_TIMEOUT_MS = 20 * 60 * 1000;
const FIRST_FRAME_TIMEOUT_MS = 5000;
const MIN_FRAME_US = 500; // a frame replaced after less than 0.5 ms is never visible: it is dropped from the list
const OBS_MAX_MESSAGE_CHARS = 1024 * 1024;
const PRESS_KEY = /^(?:(?:Control|Shift|Alt|Meta)\+){0,3}(?:[A-Za-z0-9]|F\d{1,2}|Enter|Tab|Escape|Backspace|Delete|Space|Home|End|PageUp|PageDown|ArrowUp|ArrowDown|ArrowLeft|ArrowRight)$/;
// A selector goes inside a CSS rule (redaction) or to Playwright: no braces, angle brackets, semicolons, comments or newlines.
const UNSAFE_SELECTOR = /[{}<>;\\\r\n\u0000]|\/\*|\*\//;

// ---------------------------------------------------------------------------------------------------------------------------
// obs-websocket v5
// ---------------------------------------------------------------------------------------------------------------------------

/** obs-websocket v5 authentication: base64(sha256(base64(sha256(password + salt)) + challenge)). */
export function obsAuthString(password, salt, challenge) {
  const secret = crypto.createHash("sha256").update(String(password) + String(salt)).digest("base64");
  return crypto.createHash("sha256").update(secret + String(challenge)).digest("base64");
}

/** OBS runs on this machine: only ws:// on a loopback host (a password must never cross the network), no credentials, no path. */
export function validateObsUrl(raw = OBS_DEFAULT_URL) {
  let url;
  try { url = new URL(String(raw)); } catch { throw new HubError("validation", "Adresa OBS WebSocket este invalidă.", { code: "OBS_URL_INVALID" }); }
  if (url.protocol !== "ws:") throw new HubError("policy", "OBS WebSocket se folosește doar local, prin ws:// (fără wss sau alte scheme).", { code: "OBS_URL_REFUSED" });
  if (!LOOPBACK_HOSTS.has(url.hostname)) throw new HubError("policy", "OBS WebSocket este acceptat doar pe acest calculator (127.0.0.1, localhost sau [::1]).", { code: "OBS_URL_REFUSED" });
  if (url.username || url.password) throw new HubError("policy", "Adresa OBS nu poate conține date de autentificare; parola se dă separat.", { code: "OBS_URL_REFUSED" });
  if ((url.pathname && url.pathname !== "/") || url.search || url.hash) throw new HubError("validation", "Adresa OBS WebSocket nu are cale sau parametri.", { code: "OBS_URL_INVALID" });
  return `ws://${url.host}`;
}

/** Close codes of obs-websocket v5 (WebSocketCloseCode) → a clear Romanian error. */
function obsCloseError(code, reason, { identified, url }) {
  const why = reason ? ` (${redactText(String(reason)).slice(0, 120)})` : "";
  if (code === 4009) return new HubError("authentication", "OBS a refuzat autentificarea: parola OBS WebSocket nu este corectă.", { code: "OBS_AUTH_FAILED" });
  if (code === 4010) return new HubError("tool", `Versiunea protocolului OBS WebSocket nu este suportată (Hub-ul cere rpcVersion 1)${why}.`, { code: "OBS_RPC_UNSUPPORTED" });
  if (code === 4011) return new HubError("transport", `OBS a închis sesiunea WebSocket${why}.`, { code: "OBS_SESSION_INVALIDATED" });
  if (code === 4008 || code === 4007 || code === 4002 || code === 4003 || code === 4004 || code === 4005 || code === 4006) {
    return new HubError("tool", `OBS a închis conexiunea din cauza unui mesaj de protocol neacceptat (cod ${code})${why}.`, { code: "OBS_PROTOCOL_ERROR" });
  }
  if (!identified && (code === 1006 || code === 1015 || !code)) {
    return new HubError("transport", `OBS nu răspunde la ${url}: verifică dacă OBS rulează și dacă serverul WebSocket este activat.`, { code: "OBS_UNREACHABLE" });
  }
  return new HubError("transport", `Conexiunea cu OBS s-a închis (cod ${code || "necunoscut"})${why}.`, { code: "OBS_CLOSED" });
}

/**
 * `obsClient({ url, password, timeoutMs, connectTimeoutMs, WebSocketImpl })` → { connect, request, getVersion, getSceneList,
 * getRecordStatus, startRecord, stopRecord, close, state }.
 * - connect(): waits for Hello (op 0), sends Identify (op 1, rpcVersion 1, eventSubscriptions 0, the authentication string
 *   when Hello carries a challenge), resolves at Identified (op 2). A server asking for a password the caller did not give is
 *   refused locally, before Identify. The password is dropped from memory as soon as Identify is sent.
 * - request(type, data): op 6 with a fresh requestId; the op 7 with the same requestId resolves it (`responseData`), a failed
 *   requestStatus rejects with OBS_REQUEST_FAILED; each request has its own timeout (OBS_TIMEOUT); a close rejects every
 *   pending request. Only OBS_REQUEST_TYPES are sent: the client is not a general remote control of OBS.
 */
export function obsClient({ url = OBS_DEFAULT_URL, password = null, timeoutMs = 10000, connectTimeoutMs = 10000, WebSocketImpl = globalThis.WebSocket } = {}) {
  const target = validateObsUrl(url);
  if (password !== null && password !== undefined && (typeof password !== "string" || password.length > 1024)) {
    throw new HubError("validation", "Parola OBS WebSocket trebuie să fie text (cel mult 1024 de caractere).", { code: "OBS_PASSWORD_INVALID" });
  }
  if (typeof WebSocketImpl !== "function") throw new HubError("tool", "Clientul WebSocket nu este disponibil în această versiune de Node.", { code: "OBS_CLIENT_UNAVAILABLE" });
  let secret = password || null; // memory only; cleared after Identify
  let ws = null;
  let state = "idle"; // idle → connecting → identified → closed
  let hello = null;
  let identifiedInfo = null;
  let closeInfo = null;
  const pending = new Map(); // requestId → { resolve, reject, timer, type }
  const limit = (v, fallback) => Math.min(120000, Math.max(50, Number(v) || fallback));

  const rejectAll = (error) => {
    for (const [id, p] of pending) { clearTimeout(p.timer); pending.delete(id); p.reject(error); }
  };
  const send = (message) => { ws.send(JSON.stringify(message)); };
  const shutdown = (reason = "închis de Hub") => {
    secret = null;
    try { if (ws && ws.readyState <= 1) ws.close(1000, reason); } catch { /* already closing */ }
  };

  function handleResponse(d) {
    if (!d || typeof d.requestId !== "string") return;
    const p = pending.get(d.requestId);
    if (!p) return; // a late answer to a request that already timed out
    pending.delete(d.requestId);
    clearTimeout(p.timer);
    if (d.requestType !== p.type) { p.reject(new HubError("tool", `Răspuns OBS pentru alt tip de cerere (${String(d.requestType).slice(0, 40)} în loc de ${p.type}).`, { code: "OBS_PROTOCOL_ERROR" })); return; }
    const status = d.requestStatus || {};
    if (status.result !== true) {
      const comment = status.comment ? `: ${redactText(String(status.comment)).slice(0, 200)}` : "";
      p.reject(new HubError("tool", `OBS a refuzat cererea ${p.type} (cod ${Number(status.code) || "necunoscut"})${comment}.`, { code: "OBS_REQUEST_FAILED", data: { obsCode: Number(status.code) || null, requestType: p.type } }));
      return;
    }
    p.resolve(d.responseData && typeof d.responseData === "object" ? d.responseData : {});
  }

  function connect() {
    if (state !== "idle") return Promise.reject(new HubError("conflict", "Clientul OBS a fost deja folosit; creează unul nou.", { code: "OBS_CLIENT_USED" }));
    state = "connecting";
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error); else resolve(value);
      };
      const timer = setTimeout(() => {
        finish(new HubError("transport", `OBS nu a terminat identificarea în ${limit(connectTimeoutMs, 10000)} ms.`, { code: "OBS_TIMEOUT" }));
        shutdown("timeout");
      }, limit(connectTimeoutMs, 10000));
      try { ws = new WebSocketImpl(target, OBS_SUBPROTOCOL); }
      catch (error) {
        state = "closed"; secret = null;
        finish(new HubError("transport", `Conexiunea cu OBS nu a putut porni (${String(error?.message || error).slice(0, 120)}).`, { code: "OBS_UNREACHABLE" }));
        return;
      }
      ws.addEventListener("message", (event) => {
        if (typeof event.data !== "string") return; // obswebsocket.json is text-only
        if (event.data.length > OBS_MAX_MESSAGE_CHARS) { finish(new HubError("tool", "Mesaj OBS prea mare.", { code: "OBS_PROTOCOL_ERROR" })); shutdown("mesaj prea mare"); return; }
        let msg;
        try { msg = JSON.parse(event.data); } catch { return; }
        if (!msg || typeof msg !== "object" || !Number.isInteger(msg.op)) return;
        if (msg.op === 0 && state === "connecting" && !hello) {
          hello = msg.d && typeof msg.d === "object" ? msg.d : {};
          if (!(Number(hello.rpcVersion) >= 1)) { finish(new HubError("tool", "OBS nu anunță rpcVersion 1 sau mai nou.", { code: "OBS_RPC_UNSUPPORTED" })); shutdown("rpc"); return; }
          const identify = { rpcVersion: 1, eventSubscriptions: 0 };
          const auth = hello.authentication;
          if (auth) {
            if (!secret) { finish(new HubError("authentication", "OBS cere parola WebSocket, dar nu a fost dată.", { code: "OBS_PASSWORD_REQUIRED" })); shutdown("fără parolă"); return; }
            if (typeof auth.salt !== "string" || typeof auth.challenge !== "string") { finish(new HubError("tool", "Mesajul Hello de la OBS are o autentificare incompletă.", { code: "OBS_PROTOCOL_ERROR" })); shutdown("hello"); return; }
            identify.authentication = obsAuthString(secret, auth.salt, auth.challenge);
          }
          secret = null; // never needed again
          try { send({ op: 1, d: identify }); } catch (error) { finish(new HubError("transport", `Trimiterea către OBS a eșuat (${String(error?.message || error).slice(0, 120)}).`, { code: "OBS_CLOSED" })); }
          return;
        }
        if (msg.op === 2 && state === "connecting" && hello) {
          state = "identified";
          identifiedInfo = { obsWebSocketVersion: hello.obsWebSocketVersion ? String(hello.obsWebSocketVersion).slice(0, 40) : null,
            rpcVersion: Number(hello.rpcVersion) || null, negotiatedRpcVersion: Number(msg.d?.negotiatedRpcVersion) || null };
          finish(null, identifiedInfo);
          return;
        }
        if (msg.op === 7 && state === "identified") handleResponse(msg.d);
        // op 5 (events) is ignored: eventSubscriptions is 0.
      });
      ws.addEventListener("error", () => { /* a close event always follows */ });
      ws.addEventListener("close", (event) => {
        const wasIdentified = state === "identified";
        state = "closed";
        secret = null;
        closeInfo = { code: Number(event?.code) || null, reason: event?.reason ? String(event.reason).slice(0, 120) : "" };
        const error = obsCloseError(closeInfo.code, closeInfo.reason, { identified: wasIdentified, url: target });
        finish(error);
        rejectAll(error);
      });
    });
  }

  function request(type, data = {}, { timeoutMs: perRequest = null } = {}) {
    if (!OBS_REQUEST_TYPES.includes(type)) return Promise.reject(new HubError("validation", `Cererea OBS ${String(type).slice(0, 40)} nu este permisă de Hub.`, { code: "OBS_REQUEST_REFUSED" }));
    if (state !== "identified") return Promise.reject(new HubError("conflict", "Clientul OBS nu este conectat și identificat.", { code: "OBS_NOT_CONNECTED" }));
    if (data === null || typeof data !== "object" || Array.isArray(data)) return Promise.reject(new HubError("validation", "Datele cererii OBS trebuie să fie un obiect.", { code: "OBS_REQUEST_REFUSED" }));
    const requestId = crypto.randomUUID();
    const ms = limit(perRequest ?? timeoutMs, 10000);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new HubError("transport", `OBS nu a răspuns la ${type} în ${ms} ms.`, { code: "OBS_TIMEOUT", data: { requestType: type } }));
      }, ms);
      pending.set(requestId, { resolve, reject, timer, type });
      try { send({ op: 6, d: { requestType: type, requestId, requestData: data } }); }
      catch (error) {
        clearTimeout(timer); pending.delete(requestId);
        reject(new HubError("transport", `Trimiterea către OBS a eșuat (${String(error?.message || error).slice(0, 120)}).`, { code: "OBS_CLOSED" }));
      }
    });
  }

  function close() {
    rejectAll(new HubError("transport", "Conexiunea cu OBS a fost închisă de Hub.", { code: "OBS_CLOSED" }));
    shutdown();
    state = "closed";
  }

  return {
    connect, request, close,
    getVersion: () => request("GetVersion"),
    getSceneList: () => request("GetSceneList"),
    getRecordStatus: () => request("GetRecordStatus"),
    startRecord: () => request("StartRecord"),
    stopRecord: () => request("StopRecord"),
    state: () => state, info: () => identifiedInfo, closeInfo: () => closeInfo, url: target,
  };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Browser demo: validation helpers (pure)
// ---------------------------------------------------------------------------------------------------------------------------

/** A CSS selector that is safe inside a style rule and for Playwright. */
/** Harness context setup: `{ cookies: [{ name, value, path, httpOnly, sameSite }], virtualAuthenticator }` for the approved origin only. */
export function normalizeContextSetup(setup, origin) {
  if (setup === undefined || setup === null) return null;
  if (typeof setup !== "object" || Array.isArray(setup)) throw new HubError("validation", "contextSetup are forma { cookies, virtualAuthenticator }.", { code: "FIELD_INVALID" });
  const host = new URL(origin).hostname;
  const cookies = (Array.isArray(setup.cookies) ? setup.cookies : []).slice(0, 5).map((c, i) => {
    if (!c || typeof c.name !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(c.name) || typeof c.value !== "string" || c.value.length > 4096 || /[\u0000-\u001f;]/.test(c.value)) {
      throw new HubError("validation", `Cookie-ul ${i + 1} din contextSetup nu este valid.`, { code: "FIELD_INVALID" });
    }
    const cookiePath = typeof c.path === "string" && c.path.startsWith("/") && c.path.length <= 100 ? c.path : "/";
    return { name: c.name, value: c.value, domain: host, path: cookiePath, httpOnly: c.httpOnly !== false, sameSite: ["Strict", "Lax"].includes(c.sameSite) ? c.sameSite : "Strict" };
  });
  return { cookies, virtualAuthenticator: setup.virtualAuthenticator === true };
}

function checkSelector(value, label) {
  if (typeof value !== "string" || !value.trim() || value.length > 200 || UNSAFE_SELECTOR.test(value)) {
    throw new HubError("validation", `Selector invalid pentru ${label} (text de cel mult 200 de caractere, fără acolade, „<”, „>”, „;”, „\\” sau comentarii).`, { code: "DEMO_SELECTOR_INVALID" });
  }
  return value.trim();
}

function cleanNote(value, max = 300) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new HubError("validation", "Nota trebuie să fie text.", { code: "FIELD_INVALID" });
  const t = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  if (t.length > max) throw new HubError("validation", `Nota depășește ${max} de caractere.`, { code: "FIELD_TOO_LONG" });
  return t;
}

function intIn(value, min, max, label, fallback) {
  const v = value === undefined || value === null ? fallback : value;
  if (!Number.isInteger(v) || v < min || v > max) throw new HubError("validation", `${label} trebuie să fie un număr întreg între ${min} și ${max}.`, { code: "FIELD_INVALID" });
  return v;
}

/**
 * Validates and normalises the typed demo steps. Each step is ONE of:
 *   { goto: "/path" }  { click: "selector" }  { type: { selector, text, delayMs? } }  { press: "Enter" | "Control+A" }
 *   { wait: ms }  { waitFor: "selector" }  { scroll: { y, x? } | { selector } }  { highlight: { selector, ms? } | "selector" }
 *   { marker: { kind, note? } }
 * The first step is a goto (recording starts once the first page is loaded and its redaction verified). Returns the
 * normalised list; throws validation with every problem found.
 */
export function validateDemoSteps(steps) {
  if (!Array.isArray(steps) || !steps.length) throw new HubError("validation", "Captura demo are nevoie de cel puțin un pas (primul este goto).", { code: "DEMO_STEPS_INVALID" });
  if (steps.length > DEMO_MAX_STEPS) throw new HubError("validation", `Captura demo are cel mult ${DEMO_MAX_STEPS} de pași.`, { code: "DEMO_STEPS_INVALID" });
  const problems = [];
  const out = [];
  steps.forEach((step, index) => {
    const n = index + 1;
    const keys = step && typeof step === "object" && !Array.isArray(step) ? Object.keys(step) : [];
    if (keys.length !== 1 || !DEMO_STEP_KINDS.includes(keys[0])) { problems.push(`pasul ${n}: un singur tip dintre ${DEMO_STEP_KINDS.join(", ")}`); return; }
    const [kind] = keys;
    const v = step[kind];
    try {
      if (kind === "goto") {
        if (typeof v !== "string" || !v.startsWith("/") || v.startsWith("//") || v.length > 300 || /[\s\\]/.test(v)) throw new Error("calea trebuie să fie relativă la origine („/…”), fără spații");
        out.push({ goto: v });
      } else if (kind === "click") out.push({ click: checkSelector(v, `pasul ${n}`) });
      else if (kind === "type") {
        if (!v || typeof v !== "object") throw new Error("are nevoie de { selector, text }");
        const selector = checkSelector(v.selector, `pasul ${n}`);
        if (typeof v.text !== "string" || v.text.length > 500 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v.text)) throw new Error("textul are cel mult 500 de caractere, fără caractere de control");
        out.push({ type: { selector, text: v.text, delayMs: intIn(v.delayMs, 0, 300, "Întârzierea între taste", 60) } });
      } else if (kind === "press") {
        if (typeof v !== "string" || !PRESS_KEY.test(v)) throw new Error("tastă necunoscută (ex.: Enter, Tab, Control+A)");
        out.push({ press: v });
      } else if (kind === "wait") out.push({ wait: intIn(v, 0, 30000, "Așteptarea (ms)", null) });
      else if (kind === "waitFor") out.push({ waitFor: checkSelector(v, `pasul ${n}`) });
      else if (kind === "scroll") {
        if (!v || typeof v !== "object") throw new Error("are nevoie de { y } sau { selector }");
        if (v.selector !== undefined) out.push({ scroll: { selector: checkSelector(v.selector, `pasul ${n}`) } });
        else out.push({ scroll: { x: intIn(v.x, -20000, 20000, "Derularea x", 0), y: intIn(v.y, -20000, 20000, "Derularea y", null) } });
      } else if (kind === "highlight") {
        const selector = checkSelector(typeof v === "string" ? v : v?.selector, `pasul ${n}`);
        out.push({ highlight: { selector, ms: intIn(typeof v === "object" ? v?.ms : undefined, 200, 5000, "Durata evidențierii (ms)", 1200) } });
      } else if (kind === "marker") {
        if (!v || typeof v !== "object") throw new Error("are nevoie de { kind, note? }");
        if (!MARKER_KINDS.includes(v.kind)) throw new Error(`tipul marcajului este unul dintre ${MARKER_KINDS.join(", ")}`);
        out.push({ marker: { kind: v.kind, note: cleanNote(v.note) } });
      }
    } catch (error) {
      problems.push(`pasul ${n} (${kind}): ${error instanceof HubError ? error.message : error.message}`);
    }
  });
  if (!problems.length && !("goto" in out[0])) problems.push("primul pas trebuie să fie goto (înregistrarea pornește după încărcarea primei pagini)");
  if (problems.length) throw new HubError("validation", `Pași demo invalizi: ${problems.join("; ")}`, { code: "DEMO_STEPS_INVALID", data: { problems } });
  return out;
}

/**
 * The origin of a Public Demo Mode capture: http(s), a loopback host, an explicit port, nothing but the origin. Returns
 * `{ origin, port, liveHub }` where liveHub is true for the live Hub's port (8011, and the configured port outside tests).
 */
export function checkDemoOrigin(raw, { config = {} } = {}) {
  let url;
  try { url = new URL(String(raw)); } catch { throw new HubError("validation", "Originea demo este invalidă.", { code: "DEMO_ORIGIN_INVALID" }); }
  if (!["http:", "https:"].includes(url.protocol)) throw new HubError("policy", "Captura demo acceptă doar origini http(s).", { code: "DEMO_ORIGIN_REFUSED" });
  if (!LOOPBACK_HOSTS.has(url.hostname)) throw new HubError("policy", "Captura demo rulează doar pe un Hub de test local (127.0.0.1, localhost sau [::1]).", { code: "DEMO_ORIGIN_REFUSED" });
  if (url.username || url.password) throw new HubError("policy", "Originea demo nu poate conține date de autentificare.", { code: "DEMO_ORIGIN_REFUSED" });
  if (!url.port) throw new HubError("validation", "Originea demo are nevoie de un port explicit.", { code: "DEMO_ORIGIN_INVALID" });
  if ((url.pathname && url.pathname !== "/") || url.search || url.hash) throw new HubError("validation", "Dă doar originea (schemă, gazdă, port); paginile se aleg prin pașii goto.", { code: "DEMO_ORIGIN_INVALID" });
  // The UI dev server (3011) proxies /api to the live Hub, so it is the live Hub too; outside tests, so is every origin the Hub
  // itself accepts (its port and its configured dev origins).
  const livePorts = new Set([String(DEFAULT_PORT), "3011"]);
  if (!config.testMode && config.port) livePorts.add(String(config.port));
  if (!config.testMode) for (const o of config.allowedOrigins || []) { try { const p = new URL(o).port; if (p) livePorts.add(p); } catch { /* not an origin */ } }
  return { origin: url.origin, port: url.port, liveHub: livePorts.has(url.port) };
}

/** The redaction stylesheet: sensitive elements become solid black boxes (text, images and children included). */
export function redactionCss(selectors) {
  const list = selectors.join(",\n");
  return `${list} { background: #000 !important; background-image: none !important; color: #000 !important; border-color: #000 !important;
  text-shadow: none !important; box-shadow: none !important; filter: brightness(0) !important; caret-color: transparent !important; user-select: none !important; }
${selectors.map((s) => `${s}::placeholder`).join(",\n")} { color: #000 !important; }
[data-ifrim-demo-highlight] { outline: 3px solid #4f8cff !important; outline-offset: 3px !important; }`;
}

/**
 * Init script (runs in every document before its own scripts and before the first paint): adds the redaction style and puts
 * it back if the page removes it. Passed to Playwright as a function + argument (no code built from strings).
 */
function redactionInitScript({ css, id }) {
  const ensure = () => {
    const root = document.documentElement;
    if (!root) return;
    let style = document.getElementById(id);
    if (!style) {
      style = document.createElement("style");
      style.id = id;
      style.textContent = css;
      (document.head || root).appendChild(style);
    } else if (style.textContent !== css) style.textContent = css;
  };
  ensure();
  try {
    new MutationObserver(() => { if (!document.getElementById(id)) ensure(); }).observe(document, { childList: true, subtree: true });
  } catch { /* no observer: the style added above stays */ }
  document.addEventListener("DOMContentLoaded", ensure);
}

/**
 * Builds the ffconcat list from screencast frames. `frames` = [{ file, atMs }] (atMs monotonic, the first at 0), `endMs` = the
 * end of the recording. Every frame lasts until the next one (exact microseconds, no drift: durations are differences of
 * rounded boundaries); a frame replaced after < 0.5 ms is dropped; the last file is listed again without a duration (the
 * concat demuxer otherwise ignores the last duration). File names are relative to the list's folder and portable, as
 * `-safe 1` requires. Returns `{ text, totalUs, kept }`.
 */
export function buildConcatList(frames, endMs) {
  if (!Array.isArray(frames) || !frames.length) throw new HubError("validation", "Nu există cadre pentru captură.", { code: "CAPTURE_NO_FRAMES" });
  const bounds = frames.map((f) => Math.round(Number(f.atMs) * 1000));
  const endUs = Math.round(Number(endMs) * 1000);
  const kept = [];
  for (let i = 0; i < frames.length; i += 1) {
    if (!/^[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(frames[i].file)) throw new HubError("validation", "Nume de cadru neportabil.", { code: "CAPTURE_FRAME_NAME" });
    const next = i + 1 < frames.length ? bounds[i + 1] : endUs;
    if (next - bounds[i] < MIN_FRAME_US && i + 1 < frames.length) continue;
    kept.push({ file: frames[i].file, startUs: kept.length ? bounds[i] : 0 });
  }
  const lines = ["ffconcat version 1.0"];
  let totalUs = 0;
  kept.forEach((k, i) => {
    const nextStart = i + 1 < kept.length ? kept[i + 1].startUs : endUs;
    const durUs = Math.max(1, nextStart - k.startUs);
    totalUs += durUs;
    lines.push(`file '${k.file}'`, `duration ${(durUs / 1e6).toFixed(6)}`);
  });
  lines.push(`file '${kept[kept.length - 1].file}'`);
  return { text: `${lines.join("\n")}\n`, totalUs, kept: kept.length };
}

/** One capture clock. A verified end hold ends the recording; screencast-stop latency is not footage. */
export function captureTimeline(frames, { firstArrival, firstTs, stopArrival, fps, holds = [] }) {
  let last = 0;
  const timeline = frames.map((f) => {
    const rel = f.ts !== null && firstTs !== null ? (f.ts - firstTs) * 1000 : f.arrival - firstArrival;
    last = Math.max(last, rel);
    return { file: f.file, atMs: last };
  });
  // holds contains only the recorder's measured evidence; never stretch a hold to cover shutdown latency.
  const endHold = holds.findLast((h) => h.reason === "end_hold" && h.result === "VERIFIED");
  const endMs = endHold ? endHold.endMs : Math.max(stopArrival - firstArrival, last + 1000 / fps);
  // Use the concat list's microsecond boundaries too: a rounded end-boundary frame has no encoded duration.
  return { frames: endHold ? timeline.filter((f) => Math.round(f.atMs * 1000) < Math.round(endMs * 1000)) : timeline, endMs };
}

// ---------------------------------------------------------------------------------------------------------------------------
// The capture service
// ---------------------------------------------------------------------------------------------------------------------------

/**
 * `createCapture({ db, bus, clock, settings, config, paths, assets, tools, launch, obsFactory })`.
 * `launch(allowedOrigin)` → a Playwright Browser (default: the project's Playwright with browserLaunchOptions);
 * `obsFactory(options)` → an obsClient (default: obsClient). Both are injectable for tests.
 */
export function createCapture({ db, bus, clock = () => new Date(), settings, config = {}, paths, assets, tools, launch = null, obsFactory = obsClient }) {
  if (!db || !bus || !settings || !paths || !assets || !tools) throw new Error("createCapture requires db, bus, settings, paths, assets and tools");
  const now = () => clock().toISOString();
  const policy = () => ({ liveCapture: false, ...(settings.get("mediaPolicy") || {}) });
  const running = new Map(); // sessionId → { controller, kind }

  const selSession = db.prepare("SELECT * FROM media_capture_sessions WHERE id = ?");
  const insSession = db.prepare(`INSERT INTO media_capture_sessions (id, content_project_id, kind, status, scope_json, markers_json, capture_label, consent_json,
    output_asset_id, error, created_by, created_at, updated_at) VALUES (?, ?, ?, 'PLANNED', ?, '[]', ?, ?, NULL, NULL, ?, ?, ?)`);

  const mapSession = (r) => r && ({ id: r.id, contentProjectId: r.content_project_id, kind: r.kind, status: r.status, scope: parse(r.scope_json, {}),
    markers: parse(r.markers_json, []), captureLabel: r.capture_label, consent: parse(r.consent_json, {}), outputAssetId: r.output_asset_id,
    error: r.error, createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at, running: running.has(r.id) });
  const get = (id) => mapSession(selSession.get(String(id || ""))) || null;
  function list({ contentProjectId = null, kind = null, status = null, limit = 100 } = {}) {
    const where = []; const args = [];
    if (contentProjectId) { where.push("content_project_id = ?"); args.push(String(contentProjectId)); }
    if (kind) { where.push("kind = ?"); args.push(oneOf(kind, CAPTURE_KINDS, "tipul capturii")); }
    if (status) { where.push("status = ?"); args.push(oneOf(status, CAPTURE_STATUSES, "starea capturii")); }
    const lim = Math.min(500, Math.max(1, Number(limit) || 100));
    return db.prepare(`SELECT * FROM media_capture_sessions ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC, rowid DESC LIMIT ?`).all(...args, lim).map(mapSession);
  }

  // ---------- validation ----------
  const requireActor = (actor) => {
    if (typeof actor !== "string" || !actor.trim() || actor.length > 120) throw new HubError("validation", "Lipsește autorul operației (actor).", { code: "ACTOR_REQUIRED" });
    return actor.trim();
  };
  function oneOf(value, values, label, fallback) {
    const v = value === undefined || value === null || value === "" ? fallback : value;
    if (!values.includes(v)) throw new HubError("validation", `Valoare invalidă pentru ${label}: ${String(v).slice(0, 40)}.`, { code: "FIELD_INVALID" });
    return v;
  }
  function optionalContentProject(id) {
    if (id === undefined || id === null || id === "") return null;
    if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw new HubError("validation", "Identificator invalid pentru proiectul de conținut.", { code: "FIELD_INVALID" });
    if (!db.prepare("SELECT 1 FROM content_projects WHERE id = ?").get(id)) throw new HubError("not_found", "Proiectul de conținut nu există.", { code: "CONTENT_PROJECT_MISSING" });
    return id;
  }
  /** The scope is the caller's plan (what is recorded, where); it can never declare its own approval. */
  function cleanScope(scope) {
    if (scope === undefined || scope === null) return {};
    if (typeof scope !== "object" || Array.isArray(scope)) throw new HubError("validation", "Scopul capturii trebuie să fie un obiect.", { code: "CAPTURE_SCOPE_INVALID" });
    const text = json(scope);
    if (text.length > MAX_SCOPE_CHARS) throw new HubError("validation", `Scopul capturii depășește ${MAX_SCOPE_CHARS} de caractere.`, { code: "CAPTURE_SCOPE_INVALID" });
    if (/"(approved|approval|scopeApproval|approvedBy|approvedAt|consent)"\s*:/i.test(text)) {
      throw new HubError("policy", "Scopul nu poate conține o aprobare; aprobarea capturii live se dă separat, de proprietar, din sesiunea lui.", { code: "CAPTURE_SCOPE_SELF_APPROVAL" });
    }
    const clean = JSON.parse(text);
    if (clean.obsUrl !== undefined) clean.obsUrl = validateObsUrl(clean.obsUrl);
    if (clean.recordingRoot !== undefined && (typeof clean.recordingRoot !== "string" || !path.isAbsolute(clean.recordingRoot))) {
      throw new HubError("validation", "Dosarul înregistrărilor OBS (recordingRoot) trebuie să fie o cale absolută.", { code: "CAPTURE_SCOPE_INVALID" });
    }
    return clean;
  }
  const scopeSha = (scope) => crypto.createHash("sha256").update(json(scope || {})).digest("hex");

  // ---------- sessions ----------
  /** Plans a capture session (PLANNED). Nothing is recorded here. */
  function planSession({ contentProjectId = null, kind, scope = {}, captureLabel = "ORIGINAL_RECORDING", actor } = {}) {
    const who = requireActor(actor);
    const k = oneOf(kind, CAPTURE_KINDS, "tipul capturii");
    const label = oneOf(captureLabel, SESSION_CAPTURE_LABELS, "eticheta de captură", "ORIGINAL_RECORDING");
    const cp = optionalContentProject(contentProjectId);
    const cleanedScope = cleanScope(scope);
    const id = newId("mcs");
    const at = now();
    bus.transaction(() => {
      insSession.run(id, cp, k, json(cleanedScope), label, json({}), who, at, at);
      bus.append({ type: "media.capture.planned", scopeType: "media_capture", scopeId: id, source: who,
        payload: { sessionId: id, kind: k, captureLabel: label, contentProjectId: cp, scopeSha: scopeSha(cleanedScope) } });
    });
    return get(id);
  }

  /** Normalises one marker. */
  function cleanMarker(marker = {}, { source = "manual" } = {}) {
    if (!marker || typeof marker !== "object") throw new HubError("validation", "Marcajul trebuie să fie un obiect { kind, atMs, note }.", { code: "MARKER_INVALID" });
    const kind = oneOf(marker.kind, MARKER_KINDS, "tipul marcajului", "note");
    const atMs = marker.atMs;
    if (!Number.isFinite(atMs) || atMs < 0 || atMs > MAX_MARKER_MS) throw new HubError("validation", "Momentul marcajului (atMs) trebuie să fie un număr de milisecunde între 0 și 24 de ore.", { code: "MARKER_INVALID" });
    return { id: newId("mmk"), kind, atMs: Math.round(atMs), note: cleanNote(marker.note), source };
  }

  /**
   * Adds a marker to a session (planned, recording or stopped — a marker on a finished recording annotates it; it may not lie
   * past the recording's end). Markers stay sorted by time.
   */
  function addMarker(sessionId, marker = {}, { actor = "owner" } = {}) {
    const who = requireActor(actor);
    const m = cleanMarker(marker);
    return bus.transaction(() => {
      const row = selSession.get(String(sessionId || ""));
      if (!row) throw new HubError("not_found", "Sesiunea de captură nu există.", { code: "CAPTURE_SESSION_MISSING" });
      if (["FAILED", "CANCELLED"].includes(row.status)) throw new HubError("conflict", `Sesiunea de captură este ${row.status === "FAILED" ? "eșuată" : "anulată"}; marcajele nu se mai adaugă.`, { code: "CAPTURE_SESSION_CLOSED" });
      const markers = parse(row.markers_json, []);
      if (markers.length >= MAX_MARKERS) throw new HubError("validation", `O sesiune are cel mult ${MAX_MARKERS} de marcaje.`, { code: "MARKER_LIMIT" });
      const duration = parse(row.scope_json, {})?.result?.durationMs;
      if (row.status === "STOPPED" && Number.isFinite(duration) && m.atMs > duration) throw new HubError("validation", `Marcajul (${m.atMs} ms) este după sfârșitul înregistrării (${duration} ms).`, { code: "MARKER_OUT_OF_RANGE" });
      const next = [...markers, m].sort((a, b) => a.atMs - b.atMs);
      db.prepare("UPDATE media_capture_sessions SET markers_json = ?, updated_at = ? WHERE id = ?").run(json(next), now(), row.id);
      bus.append({ type: "media.capture.marker_added", scopeType: "media_capture", scopeId: row.id, source: who, payload: { sessionId: row.id, markerId: m.id, kind: m.kind, atMs: m.atMs } });
      return mapSession(selSession.get(row.id));
    });
  }

  function setStatus(id, status, fields = {}, event = null) {
    bus.transaction(() => {
      const sets = ["status = ?", "updated_at = ?"]; const args = [status, now()];
      for (const [col, value] of Object.entries(fields)) { sets.push(`${col} = ?`); args.push(value); }
      db.prepare(`UPDATE media_capture_sessions SET ${sets.join(", ")} WHERE id = ?`).run(...args, id);
      if (event) bus.append({ scopeType: "media_capture", scopeId: id, ...event });
    });
  }

  /** Records a refused live action (audit; never the password, never a network call). */
  function refuse(sessionId, who, code, message, category = "policy") {
    bus.transaction(() => bus.append({ type: "media.capture.refused", scopeType: "media_capture", scopeId: sessionId || "none", source: who, payload: { sessionId: sessionId || null, code } }));
    return new HubError(category, message, { code });
  }

  /**
   * The owner's approval of a live capture scope (decision package MEDIA_B), bound to the exact scope. M09 has no writer for
   * it, so this is always false in this milestone.
   */
  function scopeApproved(row) {
    const approval = parse(row.consent_json, {})?.scopeApproval;
    if (!approval || approval.via !== "owner_session" || typeof approval.decisionId !== "string" || !approval.decisionId) return false;
    if (approval.scopeSha !== scopeSha(parse(row.scope_json, {}))) return false;
    if (approval.expiresAt && !(String(approval.expiresAt) > now())) return false;
    return true;
  }

  function liveCaptureProblem(row) {
    if (policy().liveCapture !== true) return "Captura live (OBS / ecran) este dezactivată în politica media (liveCapture). Este nevoie de decizia proprietarului (pachetul MEDIA_B).";
    if (!scopeApproved(row)) return "Scopul acestei sesiuni de captură nu a fost aprobat de proprietar (pachetul MEDIA_B, din sesiunea proprietarului).";
    return null;
  }

  /**
   * Starts an OBS recording for an `obs` session. Refused with LIVE_MEDIA_CAPTURE_DISABLED unless liveCapture is on AND the
   * scope is approved (always refused in M09) — before any connection to OBS. The password is passed through to the client
   * and never stored.
   */
  /**
   * M10: the owner's approval of THIS session's exact scope (window / scene / purpose / audio / destination / duration / redactions /
   * retention). Written by the confirmation of an operation plan (decisionId = the plan) or by the owner's own command — never by a
   * scope that claims it (cleanScope refuses that). Bound to the scope's sha: a changed scope is no longer approved.
   */
  function approveScope(sessionId, { decisionId, ownerSessionId, expiresAt = null, actor = "owner" } = {}) {
    const who = requireActor(actor);
    if (typeof decisionId !== "string" || !decisionId || typeof ownerSessionId !== "string" || !ownerSessionId) throw new HubError("validation", "Aprobarea scopului cere decizia (planul) și sesiunea de proprietar.", { code: "CAPTURE_APPROVAL_INVALID" });
    return bus.transaction(() => {
      const row = selSession.get(String(sessionId || ""));
      if (!row) throw new HubError("not_found", "Sesiunea de captură nu există.", { code: "CAPTURE_SESSION_MISSING" });
      if (row.status !== "PLANNED") throw new HubError("conflict", `Doar o sesiune planificată primește aprobarea scopului (stare ${row.status}).`, { code: "CAPTURE_STATE" });
      const scope = parse(row.scope_json, {});
      const approval = { via: "owner_session", decisionId, ownerSessionId, scopeSha: scopeSha(scope), approvedAt: now(), expiresAt: expiresAt || new Date(clock().getTime() + 60 * 60000).toISOString() };
      db.prepare("UPDATE media_capture_sessions SET consent_json = ?, updated_at = ? WHERE id = ?").run(json({ ...parse(row.consent_json, {}), scopeApproval: approval }), now(), row.id);
      bus.append({ type: "media.capture.scope_approved", scopeType: "media_capture", scopeId: row.id, source: who, payload: { sessionId: row.id, decisionId, scopeSha: approval.scopeSha.slice(0, 16), expiresAt: approval.expiresAt } });
      return get(row.id);
    });
  }

  /** The OBS capabilities this Hub needs (negotiated from GetVersion.availableRequests, never assumed). */
  const OBS_NEEDED = ["GetRecordStatus", "StartRecord", "StopRecord"];
  async function negotiate(client) {
    const v = await client.getVersion();
    const available = Array.isArray(v?.availableRequests) ? v.availableRequests : [];
    const missing = OBS_NEEDED.filter((r) => !available.includes(r));
    if (missing.length) throw new HubError("tool", `OBS WebSocket nu oferă: ${missing.join(", ")} (versiunea ${v?.obsVersion || "?"}).`, { code: "OBS_CAPABILITY_MISSING" });
    return { obsVersion: v?.obsVersion || null, obsWebSocketVersion: v?.obsWebSocketVersion || null, rpcVersion: v?.rpcVersion ?? null, scenes: available.includes("SetCurrentProgramScene") };
  }
  /** OBS's own status, polled until it says the output is (or is not) active: a sent request is never proof of a recording. */
  async function waitRecord(client, active, ms = 4000) {
    const end = Date.now() + ms;
    let st = null;
    while (Date.now() < end) { st = await client.getRecordStatus(); if (Boolean(st?.outputActive) === active) return st; await new Promise((r) => setTimeout(r, 200)); }
    return st;
  }

  async function startObsRecording(sessionId, { password = null, actor = "owner", timeoutMs = 10000 } = {}) {
    const who = requireActor(actor);
    const row = selSession.get(String(sessionId || ""));
    if (!row) throw new HubError("not_found", "Sesiunea de captură nu există.", { code: "CAPTURE_SESSION_MISSING" });
    if (row.kind !== "obs") throw new HubError("validation", "Doar o sesiune de tip „obs” pornește o înregistrare OBS.", { code: "CAPTURE_KIND_MISMATCH" });
    const problem = liveCaptureProblem(row);
    if (problem) throw refuse(row.id, who, "LIVE_MEDIA_CAPTURE_DISABLED", problem);
    if (row.status !== "PLANNED") throw new HubError("conflict", `Sesiunea nu este planificată (stare ${row.status}).`, { code: "CAPTURE_STATE" });
    if (running.has(row.id)) throw new HubError("conflict", "Sesiunea este deja în lucru.", { code: "CAPTURE_BUSY" });
    const scope = parse(row.scope_json, {});
    running.set(row.id, { kind: "obs", controller: null });
    const client = obsFactory({ url: scope.obsUrl || OBS_DEFAULT_URL, password, timeoutMs, connectTimeoutMs: timeoutMs });
    try {
      await client.connect();
      const caps = await negotiate(client);
      const status = await client.getRecordStatus();
      if (status.outputActive === true) throw new HubError("conflict", "OBS înregistrează deja; Hub-ul nu preia și nu oprește o înregistrare pornită de altcineva.", { code: "OBS_ALREADY_RECORDING" });
      // Optional dedicated scene of the Hub (must already exist: the Hub never edits the owner's scene collection); the previous
      // program scene is remembered and restored at stop.
      let previousScene = null;
      if (scope.scene) {
        if (!caps.scenes) throw new HubError("tool", "OBS nu permite schimbarea scenei prin WebSocket.", { code: "OBS_CAPABILITY_MISSING" });
        const list = await client.getSceneList();
        if (!(list?.scenes || []).some((s) => s.sceneName === scope.scene)) throw new HubError("validation", `Scena „${scope.scene}” nu există în OBS; creeaz-o tu (Hub-ul nu modifică colecția ta de scene).`, { code: "OBS_SCENE_MISSING" });
        previousScene = list.currentProgramSceneName || null;
        if (previousScene !== scope.scene) await client.request("SetCurrentProgramScene", { sceneName: scope.scene });
      }
      let reconciled = false;
      try { await client.startRecord(); }
      catch (error) {
        // A lost answer after StartRecord may still have started the recording: ask OBS before declaring anything (never a second Start).
        const st = await client.getRecordStatus().catch(() => null);
        if (!st?.outputActive) throw error;
        reconciled = true;
      }
      const confirmed = await waitRecord(client, true);
      if (!confirmed?.outputActive) throw new HubError("tool", "OBS nu a confirmat pornirea înregistrării.", { code: "OBS_NOT_RECORDING" });
      setStatus(row.id, "RECORDING", { consent_json: json({ ...parse(row.consent_json, {}), obsStartedAt: now(), obsVersion: caps.obsVersion, obsWebSocketVersion: caps.obsWebSocketVersion, previousScene, startReconciled: reconciled }) },
        { type: "media.capture.started", source: who, payload: { sessionId: row.id, kind: "obs", obsWebSocketVersion: caps.obsWebSocketVersion, reconciled } });
      return get(row.id);
    } finally {
      running.delete(row.id);
      client.close();
    }
  }

  /**
   * Stops an OBS recording. Fail-safe: a session that is RECORDING can always be stopped (even after liveCapture was switched
   * off). Any other session is refused like a start (LIVE_MEDIA_CAPTURE_DISABLED while live capture is off). The output file is
   * imported only from the scope's recordingRoot (an allowed root); otherwise the path is recorded for a manual import.
   */
  async function stopObsRecording(sessionId, { password = null, actor = "owner", timeoutMs = 15000 } = {}) {
    const who = requireActor(actor);
    const row = selSession.get(String(sessionId || ""));
    if (!row) throw new HubError("not_found", "Sesiunea de captură nu există.", { code: "CAPTURE_SESSION_MISSING" });
    if (row.kind !== "obs") throw new HubError("validation", "Doar o sesiune de tip „obs” are o înregistrare OBS de oprit.", { code: "CAPTURE_KIND_MISMATCH" });
    if (row.status !== "RECORDING") {
      if (policy().liveCapture !== true) throw refuse(row.id, who, "LIVE_MEDIA_CAPTURE_DISABLED", "Captura live este dezactivată în politica media (liveCapture); nu există o înregistrare OBS pornită de Hub.");
      throw new HubError("conflict", `Sesiunea nu înregistrează (stare ${row.status}).`, { code: "CAPTURE_NOT_RECORDING" });
    }
    const scope = parse(row.scope_json, {});
    const consent = parse(row.consent_json, {});
    const client = obsFactory({ url: scope.obsUrl || OBS_DEFAULT_URL, password, timeoutMs, connectTimeoutMs: timeoutMs });
    let outputPath = null;
    let stopReconciled = false;
    try {
      await client.connect();
      try {
        const r = await client.stopRecord();
        outputPath = typeof r.outputPath === "string" ? r.outputPath : null;
      } catch (error) {
        // The answer was lost: ask OBS whether the output is still active before declaring anything.
        const st = await client.getRecordStatus().catch(() => null);
        if (st?.outputActive) throw error;
        stopReconciled = true;
      }
      const after = await waitRecord(client, false);
      if (after?.outputActive) throw new HubError("tool", "OBS înregistrează încă; oprirea nu a fost confirmată.", { code: "OBS_STILL_RECORDING" });
      if (consent.previousScene && scope.scene && consent.previousScene !== scope.scene) await client.request("SetCurrentProgramScene", { sceneName: consent.previousScene }).catch(() => null);
    } finally { client.close(); }
    // What OBS reported is kept as reported; whether the file is really there is a separate, observed fact.
    const outputExists = Boolean(outputPath && fs.existsSync(outputPath));
    let asset = null; let importError = null;
    if (outputPath && scope.recordingRoot) {
      try {
        const res = await assets.ingestFile({ sourcePath: outputPath, allowedRoots: [scope.recordingRoot], title: scope.title || "Înregistrare OBS", category: "screen_recording",
          origin: "OWNED", captureLabel: row.capture_label, contentProjectId: row.content_project_id, tags: ["obs"], actor: who });
        asset = res.asset;
      } catch (error) { importError = String(error?.message || error).slice(0, 400); }
    }
    setStatus(row.id, "STOPPED", { scope_json: json({ ...scope, result: { outputPath, outputExists, importedAssetId: asset?.id || null, stopReconciled } }), output_asset_id: asset?.id || null,
      error: importError ? `Înregistrarea s-a oprit, dar importul a eșuat: ${importError}` : null },
    { type: "media.capture.stopped", source: who, payload: { sessionId: row.id, kind: "obs", imported: Boolean(asset), assetId: asset?.id || null } });
    return get(row.id);
  }

  /** Fail-safe cancel: a planned session is cancelled; a running browser demo is aborted (it ends CANCELLED). */
  function cancel(sessionId, { actor = "owner" } = {}) {
    const who = requireActor(actor);
    const row = selSession.get(String(sessionId || ""));
    if (!row) throw new HubError("not_found", "Sesiunea de captură nu există.", { code: "CAPTURE_SESSION_MISSING" });
    const job = running.get(row.id);
    if (job?.controller) { job.controller.abort(); return { cancelled: true, running: true, session: get(row.id) }; }
    if (row.status === "PLANNED") {
      setStatus(row.id, "CANCELLED", {}, { type: "media.capture.cancelled", source: who, payload: { sessionId: row.id, from: "PLANNED" } });
      return { cancelled: true, running: false, session: get(row.id) };
    }
    if (row.status === "RECORDING" && row.kind === "obs") throw new HubError("conflict", "O înregistrare OBS se oprește cu „Oprește înregistrarea” (fișierul rămâne la OBS).", { code: "CAPTURE_USE_STOP" });
    return { cancelled: false, running: false, session: get(row.id) };
  }

  /** At boot: a browser demo left RECORDING by a stopped process cannot continue (its browser is gone). */
  function recover() {
    const rows = db.prepare("SELECT id FROM media_capture_sessions WHERE status = 'RECORDING' AND kind = 'browser_demo'").all();
    for (const r of rows) {
      if (running.has(r.id)) continue;
      setStatus(r.id, "FAILED", { error: "Captura a fost întreruptă de oprirea Hub-ului." }, { type: "media.capture.failed", source: "media-capture", payload: { sessionId: r.id, code: "INTERRUPTED" } });
    }
    return { interrupted: rows.length };
  }

  // ---------- browser demo ----------
  function defaultLauncher() {
    const root = config.browserRoot || config.hubRoot;
    let pw = null;
    if (root) { try { pw = createRequire(path.join(root, "package.json"))("playwright"); } catch { pw = null; } }
    if (!pw) throw new HubError("tool", "Playwright nu este instalat în proiect; captura demo din browser nu poate rula (NEEDS_INSTALL_APPROVAL).", { code: "PLAYWRIGHT_MISSING" });
    return (allowedOrigin) => pw.chromium.launch(browserLaunchOptions(allowedOrigin));
  }

  /** Folder of the capture scratch: outside the library and outside its work dir (assets.ingestFile refuses both). */
  function captureRoot() {
    const base = config.workDir ? path.resolve(config.workDir) : path.dirname(path.resolve(paths.work));
    const root = path.join(base, "media-capture");
    if (isInsideDir(paths.root, root) || isInsideDir(paths.work, root)) throw new HubError("internal", "Dosarul de captură ar fi în biblioteca media.", { code: "CAPTURE_ROOT_INVALID" });
    return root;
  }

  /**
   * Public Demo Mode capture. Returns `{ session, asset, version, duplicateOf, durationMs, frames, keptFrames, fps, width, height,
   * markers, steps }`. Refuses before launching anything: a non-loopback origin, the live Hub (unless liveCapture), an origin
   * the caller's allowOrigin does not accept, invalid steps/options.
   */
  async function captureBrowserDemo(input = {}) {
    const who = requireActor(input.actor);
    if (typeof input.allowOrigin !== "function") throw new HubError("policy", "Captura demo are nevoie de o listă de origini permise (allowOrigin) dată de apelant.", { code: "DEMO_ALLOW_ORIGIN_REQUIRED" });
    const { origin, liveHub } = checkDemoOrigin(input.origin, { config });
    // The live Hub needs both the policy switch AND the owner's approval of this session's exact scope (MEDIA_B), like OBS.
    const liveRow = liveHub && input.sessionId ? selSession.get(String(input.sessionId)) : null;
    if (liveHub && (policy().liveCapture !== true || !liveRow || !scopeApproved(liveRow))) throw refuse(input.sessionId || null, who, "LIVE_HUB_CAPTURE_REFUSED", "Hub-ul live (portul 8011 sau serverul de dezvoltare care îl folosește) nu se înregistrează în Public Demo Mode: captura rulează pe un Hub de test cu date sintetice. Captura live cere decizia proprietarului (liveCapture) și scopul aprobat al sesiunii.");
    let allowed = false;
    try { allowed = (await input.allowOrigin(origin)) === true; } catch { allowed = false; }
    if (!allowed) throw refuse(input.sessionId || null, who, "DEMO_ORIGIN_NOT_ALLOWED", `Originea ${origin} nu este permisă pentru captura demo (doar Hub-ul de test al harness-ului).`);
    const steps = validateDemoSteps(input.steps);
    const givenLabel = input.captureLabel === undefined || input.captureLabel === null || input.captureLabel === "" ? null : oneOf(input.captureLabel, SESSION_CAPTURE_LABELS, "eticheta de captură");
    const viewport = { width: intIn(input.viewport?.width, 320, 1920, "Lățimea ferestrei", 1280), height: intIn(input.viewport?.height, 320, 1920, "Înălțimea ferestrei", 720) };
    const dsf = input.deviceScaleFactor === undefined ? 1 : input.deviceScaleFactor;
    if (![1, 1.5, 2, 3].includes(dsf)) throw new HubError("validation", "deviceScaleFactor este 1, 1.5, 2 sau 3.", { code: "FIELD_INVALID" });
    const fps = intIn(input.fps, 10, 60, "Cadre pe secundă (fps)", 30);
    const maxDurationMs = intIn(input.maxDurationMs, 1000, MAX_DURATION_MS, "Durata maximă (ms)", DEFAULT_MAX_DURATION_MS);
    const holdEndMs = intIn(input.holdEndMs, 0, 10000, "Pauza de final (ms)", 800);
    const stepTimeoutMs = intIn(input.stepTimeoutMs, 500, 60000, "Timpul pe pas (ms)", 10000);
    if (input.redactSelectors !== undefined && (!Array.isArray(input.redactSelectors) || input.redactSelectors.length > 50)) throw new HubError("validation", "redactSelectors este o listă de cel mult 50 de selectori.", { code: "FIELD_INVALID" });
    const redactSelectors = [...new Set([...DEFAULT_REDACT_SELECTORS, ...(input.redactSelectors || []).map((s, i) => checkSelector(s, `mascarea ${i + 1}`))])];
    const title = typeof input.title === "string" && input.title.trim() ? cleanNote(input.title, 200) : `Demo ${origin}`;
    // Harness-only context setup (the demo instance's TEST owner session): cookies scoped to the approved origin's host and an
    // optional CDP virtual WebAuthn authenticator. Never reachable from the media.capture.demo command (its schema drops unknown
    // fields); validated here anyway so a caller cannot widen the capture to another host.
    const contextSetup = normalizeContextSetup(input.contextSetup, origin);
    const width = Math.round((viewport.width * dsf) / 2) * 2;
    const height = Math.round((viewport.height * dsf) / 2) * 2;

    if (running.size) throw new HubError("conflict", "O altă captură rulează acum; așteaptă să se termine.", { code: "CAPTURE_BUSY" });
    const q = assets.quota();
    if (!q.ok) throw new HubError("quota", q.warnings.includes("disk_reserve") ? "Spațiul liber pe disc este sub rezerva bibliotecii media." : "Cota bibliotecii media este depășită.", { code: q.warnings.includes("disk_reserve") ? "DISK_RESERVE" : "MEDIA_QUOTA" });
    const start = launch || defaultLauncher();

    // The session: a PLANNED browser_demo session given by the caller, or a new one. The label is the one given (or the
    // planned session's); it is never guessed.
    let row;
    let captureLabel;
    if (input.sessionId) {
      row = selSession.get(String(input.sessionId));
      if (!row) throw new HubError("not_found", "Sesiunea de captură nu există.", { code: "CAPTURE_SESSION_MISSING" });
      if (row.kind !== "browser_demo") throw new HubError("validation", "Sesiunea nu este de tip „browser_demo”.", { code: "CAPTURE_KIND_MISMATCH" });
      if (row.status !== "PLANNED") throw new HubError("conflict", `Sesiunea nu este planificată (stare ${row.status}).`, { code: "CAPTURE_STATE" });
      const planned = parse(row.scope_json, {});
      if (planned.origin && planned.origin !== origin) throw new HubError("validation", `Sesiunea a fost planificată pentru ${String(planned.origin).slice(0, 80)}, nu pentru ${origin}.`, { code: "CAPTURE_SCOPE_MISMATCH" });
      if (input.contentProjectId && row.content_project_id && input.contentProjectId !== row.content_project_id) throw new HubError("validation", "Proiectul de conținut diferă de cel al sesiunii.", { code: "CAPTURE_SCOPE_MISMATCH" });
      if (givenLabel && givenLabel !== row.capture_label) throw new HubError("validation", `Sesiunea a fost planificată cu eticheta ${row.capture_label}, nu ${givenLabel}.`, { code: "CAPTURE_SCOPE_MISMATCH" });
      captureLabel = row.capture_label;
    } else {
      if (!givenLabel) throw new HubError("validation", "Eticheta capturii este obligatorie (de exemplu ORIGINAL_RECORDING sau SIMULATION): spune onest ce arată înregistrarea.", { code: "CAPTURE_LABEL_REQUIRED" });
      captureLabel = givenLabel;
      row = selSession.get(planSession({ contentProjectId: input.contentProjectId, kind: "browser_demo", scope: { origin }, captureLabel, actor: who }).id);
    }

    const sessionId = row.id;
    const controller = new AbortController();
    running.set(sessionId, { kind: "browser_demo", controller });
    const dir = path.join(captureRoot(), sessionId);
    const plannedScope = parse(row.scope_json, {});
    const scope = { ...plannedScope, origin, viewport, deviceScaleFactor: dsf, fps, redactSelectors, publicDemoMode: true,
      steps: steps.map((s) => (s.type ? { type: { selector: s.type.selector, chars: s.type.text.length } } : s)) };
    setStatus(sessionId, "RECORDING", { scope_json: json(scope), capture_label: captureLabel, consent_json: json({ publicDemoMode: true, liveHub, liveCapture: policy().liveCapture === true, origin }) },
      { type: "media.capture.started", source: who, payload: { sessionId, kind: "browser_demo", origin, steps: steps.length, fps, width, height } });

    const stepResults = [];
    const markers = [];
    // R-MEDIA: the intentional pauses of THIS script (media/holds.mjs), measured on the capture clock; the rejected ones are kept apart.
    const stepsSha = hashCanonical(steps);
    const holds = [];
    const holdsRejected = [];
    const noteHold = (measured) => {
      const r = measureHold(measured);
      if (r.hold && holds.length < HOLD_LIMITS.perCapture) holds.push({ schema: HOLD_SCHEMA, id: newId("hld"), ...r.hold, result: "VERIFIED" });
      else if (r.rejected && holdsRejected.length < HOLD_LIMITS.perCapture) holdsRejected.push(r.rejected);
    };
    // Why a wait step pauses, from the plan itself: right after the proof marker it holds the success state; right after the first
    // page (goto + its chapter marker) it lets the page settle; anything else is a planned wait.
    const waitReason = (index) => {
      if (steps[index - 1]?.marker?.kind === "proof") return "proof_hold";
      if (index <= 2 && steps.slice(0, index).every((s) => s.goto !== undefined || s.marker?.kind === "chapter")) return "settle";
      return "wait";
    };
    let page = null;
    let lastHighlight = null;
    const visible = (selector) => bounded(page.locator(selector).first().isVisible(), stepTimeoutMs, "verificarea pauzei").then((v) => v === true, () => false);
    // Review F6: a planned wait is a pause only on a live, loaded, non-blank page of the approved origin (a hung or blank page is not).
    const pageLive = () => (onOrigin(page.url(), origin) ? bounded(page.evaluate(() => document.readyState === "complete" && Boolean(document.body) && document.body.innerText.trim().length > 0), stepTimeoutMs, "verificarea paginii").then((v) => v === true, () => false) : Promise.resolve(false));
    const frames = []; // { file, arrival, ts }
    let frameBytes = 0;
    let browser = null;
    let failure = null;
    let firstArrival = null; let firstTs = null;
    let recording = false;
    let stopArrival = null;
    const tooLong = setTimeout(() => controller.abort(new HubError("task", `Captura a depășit durata maximă de ${Math.round(maxDurationMs / 1000)} s.`, { code: "CAPTURE_TOO_LONG" })), maxDurationMs + 60000);
    const closeBrowser = () => (browser ? bounded(Promise.resolve().then(() => browser.close()), 5000, "browser.close").catch(() => {}) : Promise.resolve());
    const onAbort = () => { closeBrowser(); Promise.resolve().then(() => tools.cancel?.(`media:capture:${sessionId}`)).catch(() => {}); };
    controller.signal.addEventListener("abort", onAbort, { once: true });
    const checkAbort = () => {
      if (controller.signal.aborted) throw controller.signal.reason instanceof HubError ? controller.signal.reason : new HubError("task", "Captura a fost anulată.", { code: "CANCELLED" });
    };
    const clockMs = () => performance.now();
    const elapsed = () => (firstArrival === null ? 0 : Math.max(0, Math.round(clockMs() - firstArrival)));

    try {
      fs.mkdirSync(dir, { recursive: true });
      const guard = createRequestGuard({ allowedOrigin: origin, fetchTimeoutMs: stepTimeoutMs * 2, redact: redactText, streamPaths: ["/api/stream"] });
      try { browser = await start(origin); }
      catch (error) {
        if (error instanceof HubError) throw error;
        throw new HubError("tool", `Browserul nu a putut porni: ${redactText(String(error?.message || error)).split("\n")[0].slice(0, 200)}`, { code: "BROWSER_LAUNCH_FAILED" });
      }
      checkAbort();
      // bypassCSP: a page CSP without 'unsafe-inline' would otherwise block the injected redaction style (the element would be
      // present but not applied); the sheet itself is verified after every navigation.
      const context = await browser.newContext({ serviceWorkers: "block", acceptDownloads: false, viewport, deviceScaleFactor: dsf, bypassCSP: true });
      await context.route(() => true, guard.route);
      if (typeof context.routeWebSocket === "function") await context.routeWebSocket(() => true, guard.webSocket);
      // Redaction before any document exists: every document of this context gets the style before its first paint.
      await context.addInitScript(redactionInitScript, { css: redactionCss(redactSelectors), id: REDACTION_STYLE_ID });
      if (contextSetup?.cookies.length) await context.addCookies(contextSetup.cookies);
      page = await context.newPage();
      if (contextSetup?.virtualAuthenticator) {
        const authCdp = await context.newCDPSession(page);
        await authCdp.send("WebAuthn.enable");
        await authCdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
      }

      const navigate = async (startUrl, label) => {
        let goal = startUrl; let response = null;
        for (let hops = 0; ;) {
          guard.expectNavigation(goal);
          try { response = await page.goto(goal, { timeout: stepTimeoutMs * 2, waitUntil: "load" }); break; }
          catch (error) {
            const next = guard.takeMainRedirect();
            if (next && hops < MAX_MAIN_REDIRECTS) { hops += 1; goal = next; continue; }
            if (next) throw new Error(`mai mult de ${MAX_MAIN_REDIRECTS} redirecționări ale paginii`);
            const stopped = guard.blockedNavigation();
            if (stopped) throw new Error(`navigare oprită de allowlist: ${stopped.url} (${stopped.reason})`);
            throw error;
          }
        }
        guard.endNavigation();
        if (!onOrigin(page.url(), origin)) throw new Error(`pagina a părăsit originea aprobată (${redactText(page.url()).slice(0, 120)})`);
        if (response && response.status() >= 400) throw new Error(`HTTP ${response.status()} la ${label}`);
        // The style must be in the document before frames of it are kept (checked with a fixed function, no page code).
        const present = await bounded(page.evaluate((id) => {
          const style = document.getElementById(id);
          try { return Boolean(style && style.sheet && style.sheet.cssRules.length > 0); } catch { return false; }
        }, REDACTION_STYLE_ID), stepTimeoutMs, "verificarea mascării");
        if (!present) throw new HubError("policy", "Stilul de mascare nu a putut fi aplicat paginii; captura se oprește (nimic nemascat nu se înregistrează).", { code: "REDACTION_NOT_APPLIED" });
        await runPageGuard(`navigarea la ${label}`);
      };
      // M11: an optional page check of the caller (delivery/capture-guard.mjs pageGuard: the synthetic-data banner, no secret, no user
      // path, no real e-mail), after every navigation and every step. A refusal ends the capture; the failure path wipes the frames.
      async function runPageGuard(where) {
        if (typeof input.pageGuard !== "function") return;
        try { await bounded(Promise.resolve(input.pageGuard(page)), stepTimeoutMs, "verificarea paginii"); }
        catch (error) { throw new HubError("policy", `Pagina nu poate fi filmată (${where}): ${redactText(String(error?.message || error)).split("\n")[0].slice(0, 200)}`, { code: "CAPTURE_PRIVACY_REFUSED" }); }
      }
      const followPageRedirect = async () => { const next = guard.takePageRedirect(); if (next) await navigate(next, "redirecționarea după acțiune"); };

      const cdp = await context.newCDPSession(page);
      let firstFrameResolve;
      const firstFrame = new Promise((resolve) => { firstFrameResolve = resolve; });
      cdp.on("Page.screencastFrame", (event) => {
        const arrival = clockMs();
        const ack = () => cdp.send("Page.screencastFrameAck", { sessionId: event.sessionId }).catch(() => {});
        if (!recording || (stopArrival !== null && arrival > stopArrival)) { ack(); return; }
        try {
          const buf = Buffer.from(String(event.data || ""), "base64");
          if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) { ack(); return; }
          frameBytes += buf.length;
          if (frameBytes > MAX_FRAME_BYTES_TOTAL) { controller.abort(new HubError("quota", "Cadrele capturii depășesc limita de 2 GiB.", { code: "CAPTURE_TOO_LARGE" })); return; }
          const file = `f${String(frames.length + 1).padStart(6, "0")}.jpg`;
          fs.writeFileSync(path.join(dir, file), buf);
          const ts = Number(event.metadata?.timestamp);
          if (firstArrival === null) { firstArrival = arrival; firstTs = Number.isFinite(ts) ? ts : null; firstFrameResolve(); }
          frames.push({ file, arrival, ts: Number.isFinite(ts) ? ts : null });
        } catch (error) {
          controller.abort(new HubError("internal", `Un cadru nu a putut fi scris (${error.code || error.message}).`, { code: "CAPTURE_WRITE_FAILED" }));
        }
        ack();
      });

      for (const [index, step] of steps.entries()) {
        checkAbort();
        const [kind] = Object.keys(step);
        const value = step[kind];
        const t0 = Date.now();
        try {
          if (kind !== "goto") await followPageRedirect();
          if (kind === "goto") await navigate(new URL(value, origin).href, value);
          else if (kind === "click") { await page.locator(value).first().click({ timeout: stepTimeoutMs }); await followPageRedirect(); }
          else if (kind === "type") {
            const loc = page.locator(value.selector).first();
            const startMs = elapsed();
            if (typeof loc.pressSequentially === "function") await loc.pressSequentially(value.text, { delay: value.delayMs, timeout: stepTimeoutMs + value.text.length * value.delayMs });
            else await page.type(value.selector, value.text, { delay: value.delayMs, timeout: stepTimeoutMs + value.text.length * value.delayMs });
            const endMs = elapsed();
            // Typing is a pause only as planned (characters × delay, bounded) and only when the field really holds the typed text.
            const typed = await bounded(loc.inputValue(), stepTimeoutMs, "verificarea textului").then((v) => v === value.text, () => false);
            if (recording) noteHold({ reason: "typing", step: index + 1, startMs, endMs, plannedMs: value.text.length * value.delayMs, verified: typed });
          } else if (kind === "press") { await page.keyboard.press(value); await followPageRedirect(); }
          else if (kind === "wait") {
            const startMs = elapsed();
            await waitMs(value, controller.signal);
            const reason = waitReason(index);
            const verified = reason === "proof_hold" ? Boolean(lastHighlight) && await visible(lastHighlight) : await pageLive();
            // The step ends once its postcondition is checked (the picture stays still meanwhile); the cap still bounds the whole.
            const endMs = elapsed();
            if (recording) noteHold({ reason, step: index + 1, startMs, endMs, plannedMs: value, verified });
          }
          else if (kind === "waitFor") await page.locator(value).first().waitFor({ state: "visible", timeout: stepTimeoutMs });
          else if (kind === "scroll") {
            if (value.selector) await page.locator(value.selector).first().scrollIntoViewIfNeeded({ timeout: stepTimeoutMs });
            else await page.mouse.wheel(value.x, value.y);
            await waitMs(300, controller.signal);
          } else if (kind === "highlight") {
            const loc = page.locator(value.selector).first();
            // M11: where the highlighted element is, normalized to the viewport (0..1), so a clip can point at the evidence on screen.
            const box = await bounded(loc.boundingBox(), stepTimeoutMs, "poziția evidențierii").catch(() => null);
            const clamp = (v) => Math.min(1, Math.max(0, Number(v.toFixed(4))));
            const rect = box ? { x: clamp(box.x / viewport.width), y: clamp(box.y / viewport.height), w: clamp(box.width / viewport.width), h: clamp(box.height / viewport.height) } : null;
            const startMs = elapsed();
            markers.push({ id: newId("mmk"), kind: "highlight", atMs: startMs, note: value.selector, ...(rect ? { rect } : {}), source: "step", step: index + 1 });
            await bounded(loc.evaluate((el, ms) => {
              el.setAttribute("data-ifrim-demo-highlight", "1");
              setTimeout(() => el.removeAttribute("data-ifrim-demo-highlight"), ms);
            }, value.ms), stepTimeoutMs, "evidențiere");
            await waitMs(value.ms, controller.signal);
            lastHighlight = value.selector;
            const shown = Boolean(rect) && await visible(value.selector);
            const endMs = elapsed();
            if (recording) noteHold({ reason: "highlight", step: index + 1, startMs, endMs, plannedMs: value.ms, verified: shown });
          } else if (kind === "marker") {
            markers.push({ id: newId("mmk"), kind: value.kind, atMs: elapsed(), note: value.note, source: "step", step: index + 1 });
          }
          if (kind !== "goto") await runPageGuard(`pasul ${index + 1}`);
          stepResults.push({ i: index + 1, kind, ok: true, ms: Date.now() - t0 });
        } catch (error) {
          checkAbort();
          if (error instanceof HubError) throw error;
          stepResults.push({ i: index + 1, kind, ok: false, ms: Date.now() - t0 });
          throw new HubError("task", `Pasul ${index + 1} (${kind}) a eșuat: ${redactText(String(error?.message || error)).split("\n")[0].slice(0, 300)}`, { code: "DEMO_STEP_FAILED" });
        }
        // Recording starts once the first page is loaded and its redaction verified: the first frame is already masked.
        if (index === 0) {
          recording = true;
          await cdp.send("Page.startScreencast", { format: "jpeg", quality: SCREENCAST_JPEG_QUALITY, maxWidth: width, maxHeight: height, everyNthFrame: 1 });
          let frameTimer = null;
          const noFrame = new Promise((_, reject) => { frameTimer = setTimeout(() => reject(new HubError("tool", "Browserul nu a trimis niciun cadru în 5 s.", { code: "SCREENCAST_NO_FRAMES" })), FIRST_FRAME_TIMEOUT_MS); });
          try { await Promise.race([firstFrame, noFrame]); } finally { clearTimeout(frameTimer); }
        }
      }
      const endHoldStart = elapsed();
      await waitMs(holdEndMs, controller.signal);
      checkAbort();
      // The end hold is not a script step: it gets the number after the last one.
      if (holdEndMs) { const endHoldEnd = elapsed(); noteHold({ reason: "end_hold", step: steps.length + 1, startMs: endHoldStart, endMs: endHoldEnd, plannedMs: holdEndMs, verified: await pageLive() }); }
      stopArrival = clockMs();
      await cdp.send("Page.stopScreencast").catch(() => {});
      recording = false;
      await bounded(context.close(), stepTimeoutMs, "context.close").catch(() => {});
      await closeBrowser();
      browser = null;
      checkAbort();
      if (!frames.length) throw new HubError("tool", "Browserul nu a trimis niciun cadru.", { code: "SCREENCAST_NO_FRAMES" });

      // Frame times on one clock: the compositor timestamps (seconds) relative to the first frame, anchored at its arrival.
      const timeline = captureTimeline(frames, { firstArrival, firstTs, stopArrival, fps, holds });
      const list = buildConcatList(timeline.frames, timeline.endMs);
      fs.writeFileSync(path.join(dir, "frames.ffconcat"), list.text);
      const totalSec = (list.totalUs / 1e6).toFixed(6);
      // JPEG frames are full-range BT.601 (yuvj420p): converted to limited-range BT.709 yuv420p, tagged, the usual delivery format.
      const vf = `scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=lanczos:out_color_matrix=bt709:out_range=tv,`
        + `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${fps},format=yuv420p`;
      const encode = await tools.run({ tool: "ffmpeg", cwd: dir, key: `media:capture:${sessionId}`, timeoutMs: ENCODE_TIMEOUT_MS,
        args: ["-y", "-loglevel", "error", "-f", "concat", "-safe", "1", "-protocol_whitelist", "file,pipe", "-i", "frames.ffconcat",
          "-vf", vf, "-fps_mode", "cfr", "-r", String(fps), "-t", totalSec, "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "18",
          "-pix_fmt", "yuv420p", "-color_range", "tv", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
          "-movflags", "+faststart", "capture.mp4"] });
      if (encode.cancelled) throw new HubError("task", "Codarea capturii a fost anulată.", { code: "CANCELLED" });
      if (encode.timedOut) throw new HubError("tool", "Codarea capturii a depășit timpul alocat.", { code: "TIMEOUT" });
      if (encode.code !== 0) throw new HubError("tool", `ffmpeg a eșuat la codarea capturii: ${encode.stderrLines.slice(-3).join(" | ").slice(0, 400)}`, { code: "TOOL_FAILED" });
      const out = path.join(dir, "capture.mp4");
      const probe = await tools.probe(out);
      const expectedMs = Math.round(list.totalUs / 1000);
      const toleranceMs = Math.max(2 * (1000 / fps), expectedMs * 0.02);
      if (!probe.hasVideo || probe.video?.codec !== "h264" || !Number.isFinite(probe.durationMs) || Math.abs(probe.durationMs - expectedMs) > toleranceMs) {
        throw new HubError("tool", `Fișierul capturii nu este valid (codec ${probe.video?.codec || "lipsă"}, durată ${probe.durationMs ?? "?"} ms față de ${expectedMs} ms).`, { code: "INVALID_OUTPUT" });
      }
      checkAbort();
      const ingested = await assets.ingestFile({ sourcePath: out, allowedRoots: [dir], title, category: "screen_recording", origin: "OWNED", captureLabel,
        contentProjectId: row.content_project_id, tags: ["browser_demo", "public_demo_mode"], description: `Captură Public Demo Mode din ${origin} (${steps.length} pași, ${fps} fps).`, actor: who });
      const finalMarkers = [...parse(selSession.get(sessionId).markers_json, []), ...markers.map((m) => ({ ...m, atMs: Math.min(m.atMs, expectedMs) }))].sort((a, b) => a.atMs - b.atMs);
      // A hold is bound to the stored file: its asset version, this session and the steps sha; it ends inside the recording.
      const boundHolds = holds.filter((h) => h.startMs < expectedMs).map((h) => ({ ...h, endMs: Math.min(h.endMs, expectedMs), sessionId, assetVersionId: ingested.version.id, stepsSha }));
      const result = { durationMs: expectedMs, frames: frames.length, keptFrames: list.kept, fps, width, height, steps: stepResults, probeDurationMs: probe.durationMs, blocked: guard.summary().blockedCount,
        stepsSha, holds: boundHolds, holdsRejected };
      setStatus(sessionId, "STOPPED", { scope_json: json({ ...scope, result }), markers_json: json(finalMarkers), output_asset_id: ingested.asset.id, error: null },
        { type: "media.capture.completed", source: who, payload: { sessionId, kind: "browser_demo", assetId: ingested.asset.id, versionId: ingested.version.id, durationMs: expectedMs, frames: frames.length, markers: finalMarkers.length } });
      try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch { /* scratch only */ }
      return { session: get(sessionId), asset: ingested.asset, version: ingested.version, duplicateOf: ingested.duplicateOf, durationMs: expectedMs,
        frames: frames.length, keptFrames: list.kept, fps, width, height, markers: finalMarkers, steps: stepResults, stepsSha, holds: boundHolds, holdsRejected };
    } catch (error) {
      failure = error instanceof HubError ? error
        : controller.signal.aborted && controller.signal.reason instanceof HubError ? controller.signal.reason
          : new HubError("internal", `Captura a eșuat: ${redactText(String(error?.message || error)).split("\n")[0].slice(0, 300)}`, { code: "CAPTURE_FAILED" });
      if (controller.signal.aborted && !(controller.signal.reason instanceof HubError) && failure.code !== "CANCELLED") failure = new HubError("task", "Captura a fost anulată.", { code: "CANCELLED" });
      throw failure;
    } finally {
      clearTimeout(tooLong);
      controller.signal.removeEventListener("abort", onAbort);
      await closeBrowser();
      running.delete(sessionId);
      if (failure) {
        const cancelled = failure.code === "CANCELLED";
        setStatus(sessionId, cancelled ? "CANCELLED" : "FAILED", { error: cancelled ? null : String(failure.message).slice(0, 500), markers_json: json([...parse(selSession.get(sessionId).markers_json, []), ...markers]) },
          { type: cancelled ? "media.capture.cancelled" : "media.capture.failed", source: who, payload: { sessionId, kind: "browser_demo", code: failure.code, steps: stepResults.length } });
        // Frames are screens of a test Hub: they never outlive a failed capture. A journal names what happened.
        try {
          if (fs.existsSync(dir)) {
            for (const name of fs.readdirSync(dir)) fs.rmSync(path.join(dir, name), { recursive: true, force: true });
            fs.writeFileSync(path.join(dir, "journal.json"), JSON.stringify({ sessionId, at: now(), code: failure.code, message: String(failure.message).slice(0, 500), steps: stepResults, frames: frames.length }, null, 2));
          }
        } catch { /* scratch only */ }
      }
    }
  }

  return { planSession, addMarker, get, list, cancel, recover, startObsRecording, stopObsRecording, captureBrowserDemo, approveScope, scopeShaOf: (scope) => scopeSha(cleanScope(scope)), scopeApproved: (id) => { const r = selSession.get(String(id || "")); return r ? scopeApproved(r) : false; } };
}

/** An abortable sleep. */
function waitMs(ms, signal) {
  if (!ms) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error("aborted")); return; }
    const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(timer); reject(new Error("aborted")); };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
