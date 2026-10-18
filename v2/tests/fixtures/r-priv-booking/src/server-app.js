// "Programări detailing" — the HTTP application of the demo: a fixed list of static files and a small JSON API over a local
// node:sqlite file. Synthetic data only. It listens on 127.0.0.1 and never calls another host.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { SERVICES, serviceById, SEED_BOOKINGS, SEED_VEHICLE } from "./catalog.js";
import { buildDaySlots, shownDays, parseDateKey, parseSlotStart, parseSlotTime, isPast, slotStart, timeLabel } from "./slots.js";

/** The only interface the demo listens on: it is not reachable from the network. */
export const HOST = "127.0.0.1";

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
/** The only files handed out: exact request path → file under public/ and its type. Nothing else is ever read from disk. */
const STATIC_FILES = Object.freeze({
  "/": Object.freeze(["index.html", "text/html; charset=utf-8"]),
  "/styles.css": Object.freeze(["styles.css", "text/css; charset=utf-8"]),
  "/js/app.mjs": Object.freeze(["js/app.mjs", "text/javascript; charset=utf-8"]),
  "/js/slots-view.mjs": Object.freeze(["js/slots-view.mjs", "text/javascript; charset=utf-8"]),
});
const BASE_HEADERS = Object.freeze({
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
});
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const DAY_LABELS = Object.freeze(["Azi", "Mâine", "Poimâine"]);
const MAX_BODY_BYTES = 8 * 1024;
const MAX_DRAIN_BYTES = 256 * 1024;
const TEXT_MIN = 2;
const TEXT_MAX = 60;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/** An answer decided while reading the request (too large, not JSON…): the status and the text for the client. */
class RequestError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/** The host name of a Host header, without the port ("[::1]" keeps its brackets). */
function hostName(header) {
  const host = String(header || "").trim().toLowerCase();
  if (host.startsWith("[")) return host.slice(0, host.indexOf("]") + 1);
  return host.split(":")[0];
}

/**
 * The path and query of an origin-form request target ("/path?query"). Anything else — "//host/…", an absolute URL, a
 * backslash, a space or a control character — is not served. The path is compared as sent, never decoded.
 */
function parseTarget(raw) {
  if (typeof raw !== "string" || raw[0] !== "/" || raw.startsWith("//") || /[\s\\\u0000-\u001f\u007f]/.test(raw)) return null;
  const mark = raw.indexOf("?");
  return { pathname: mark === -1 ? raw : raw.slice(0, mark), query: new URLSearchParams(mark === -1 ? "" : raw.slice(mark + 1)) };
}

/** The request body as text, at most MAX_BODY_BYTES. A larger one is drained (bounded) and answered 413. */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_DRAIN_BYTES) { req.destroy(); reject(new RequestError(413, "Cererea este prea mare")); return; }
      if (size <= MAX_BODY_BYTES) chunks.push(chunk);
    });
    req.on("end", () => (size > MAX_BODY_BYTES ? reject(new RequestError(413, "Cererea este prea mare")) : resolve(Buffer.concat(chunks).toString("utf8"))));
    req.on("error", () => reject(new RequestError(400, "Cererea nu a putut fi citită")));
  });
}

/** One line of text as the demo stores it: whitespace runs become one space, the ends are trimmed. */
const cleanLine = (value) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "");

/** Why a name or a vehicle is refused, or null. `label` starts the sentence ("Numele", "Vehiculul"). */
function lineProblem(text, label) {
  if (text.length < TEXT_MIN || text.length > TEXT_MAX) return `${label} are între ${TEXT_MIN} și ${TEXT_MAX} de caractere`;
  if (CONTROL_CHARS.test(text)) return `${label} conține caractere nepermise`;
  // The demo holds synthetic data only: an address-like value is refused instead of being stored and shown in the list.
  if (text.includes("@")) return `${label} trebuie să fie fictiv: nu folosi „@”`;
  return null;
}

/**
 * The application. `dbPath` is the node:sqlite file (its folder is created), `now` the clock (injected by tests) and `seed`
 * whether the synthetic bookings of the shown days are kept in place. Returns { handle(req, res), close() }.
 */
export function createApp({ dbPath, now = () => new Date(), seed = true, publicDir = PUBLIC_DIR } = {}) {
  if (typeof dbPath !== "string" || !dbPath) throw new TypeError("createApp: dbPath is required");
  if (dbPath !== ":memory:") fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA busy_timeout = 2000");
  db.exec(`CREATE TABLE IF NOT EXISTS bookings (
    id TEXT PRIMARY KEY,
    service_id TEXT NOT NULL,
    day TEXT NOT NULL,
    start_min INTEGER NOT NULL,
    end_min INTEGER NOT NULL CHECK (end_min > start_min),
    name TEXT NOT NULL,
    vehicle TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    synthetic INTEGER NOT NULL DEFAULT 0 CHECK (synthetic IN (0, 1)),
    created_at TEXT NOT NULL)`);
  // Existing bookings keep their data; only new requests require a phone.
  if (!db.prepare("PRAGMA table_info(bookings)").all().some((column) => column.name === "phone")) {
    db.exec("ALTER TABLE bookings ADD COLUMN phone TEXT NOT NULL DEFAULT ''");
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_bookings_day ON bookings (day, start_min)");
  const sql = {
    byId: db.prepare("SELECT id FROM bookings WHERE id = ?"),
    overlapping: db.prepare("SELECT id FROM bookings WHERE day = ? AND start_min < ? AND end_min > ? LIMIT 1"),
    insert: db.prepare("INSERT INTO bookings (id, service_id, day, start_min, end_min, name, vehicle, phone, synthetic, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"),
    ofDay: db.prepare("SELECT id, service_id, day, start_min, end_min, name, vehicle, phone, synthetic FROM bookings WHERE day = ? ORDER BY start_min, id"),
  };
  let closed = false;

  /** The injected clock; a broken one falls back to the system time instead of producing invalid days. */
  const clock = () => { const at = now(); return at instanceof Date && !Number.isNaN(at.getTime()) ? at : new Date(); };

  /** Runs `work` in one write transaction: the overlap check and the insert are never interleaved with another writer. */
  function inTransaction(work) {
    db.exec("BEGIN IMMEDIATE");
    try { const result = work(); db.exec("COMMIT"); return result; }
    catch (error) { try { db.exec("ROLLBACK"); } catch { /* the transaction is already gone */ } throw error; }
  }

  /**
   * Keeps the three synthetic bookings on each shown day (days 0..2 of the current clock). Idempotent: a seed has a fixed
   * id per day and hour, and it is skipped when anything already occupies its interval. It runs at start and before every
   * API answer, so a server that runs across midnight still has booked slots on its new last day.
   */
  function ensureSeeds(at = clock()) {
    if (!seed) return;
    inTransaction(() => {
      for (const day of shownDays(at)) {
        for (const entry of SEED_BOOKINGS) {
          const service = serviceById(entry.serviceId);
          const startMin = parseSlotTime(entry.time);
          const id = `seed-${day}-${entry.time.replace(":", "")}`;
          if (!service || startMin === null || sql.byId.get(id)) continue;
          const endMin = startMin + service.durationMin;
          if (sql.overlapping.get(day, endMin, startMin)) continue;
          sql.insert.run(id, service.id, day, startMin, endMin, entry.name, SEED_VEHICLE, "0700 123 456", 1, at.toISOString());
        }
      }
    });
  }

  const publicBooking = (row) => ({
    id: row.id, serviceId: row.service_id, service: serviceById(row.service_id)?.name || row.service_id, date: row.day,
    start: slotStart(row.day, row.start_min), time: timeLabel(row.start_min), endTime: timeLabel(row.end_min),
    name: row.name, vehicle: row.vehicle, phone: row.phone, seed: row.synthetic === 1,
  });

  function sendJson(req, res, status, body, extra = {}) {
    const text = JSON.stringify(body);
    res.writeHead(status, { ...BASE_HEADERS, "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(text), ...extra });
    res.end(req.method === "HEAD" ? undefined : text);
  }
  const notFound = (req, res) => sendJson(req, res, 404, { error: "Negăsit" });
  const methodNotAllowed = (req, res, allow) => sendJson(req, res, 405, { error: "Metodă nepermisă" }, { Allow: allow });
  const invalid = (req, res, errors) => sendJson(req, res, 400, { error: "Date invalide", errors });

  function sendFile(req, res, [file, type]) {
    const content = fs.readFileSync(path.join(publicDir, file));
    res.writeHead(200, { ...BASE_HEADERS, "Content-Type": type, "Content-Length": content.length });
    res.end(req.method === "HEAD" ? undefined : content);
  }

  /** A shown day from a query value: { date } or { error } (not a date, or outside the three shown days). */
  function shownDay(value, at) {
    const date = parseDateKey(value);
    if (!date) return { error: "Data nu este validă (AAAA-LL-ZZ)" };
    if (!shownDays(at).includes(date)) return { error: "Ziua nu este disponibilă în demo (doar azi și următoarele două zile)" };
    return { date };
  }

  function getServices(req, res) {
    const at = clock();
    sendJson(req, res, 200, { services: SERVICES, days: shownDays(at).map((date, day) => ({ day, date, label: DAY_LABELS[day] })) });
  }

  function getSlots(req, res, query) {
    const at = clock();
    ensureSeeds(at);
    const errors = {};
    const day = shownDay(query.get("date"), at);
    const service = serviceById(query.get("service"));
    if (day.error) errors.date = day.error;
    if (!service) errors.service = "Alege un serviciu din listă";
    if (Object.keys(errors).length) return invalid(req, res, errors);
    const bookings = sql.ofDay.all(day.date).map((row) => ({ startMin: row.start_min, endMin: row.end_min }));
    return sendJson(req, res, 200, { date: day.date, service, slots: buildDaySlots({ date: day.date, durationMin: service.durationMin, bookings, now: at }) });
  }

  function getBookings(req, res, query) {
    const at = clock();
    ensureSeeds(at);
    const day = shownDay(query.get("date"), at);
    if (day.error) return invalid(req, res, { date: day.error });
    return sendJson(req, res, 200, { date: day.date, bookings: sql.ofDay.all(day.date).map(publicBooking) });
  }

  async function postBooking(req, res) {
    if (!/^application\/json(?:\s*;.*)?$/i.test(String(req.headers["content-type"] || ""))) return sendJson(req, res, 415, { error: "Trimite datele ca application/json" });
    // A browser page of another origin cannot post here: a foreign Origin is refused (requests without Origin are local tools).
    if (req.headers.origin !== undefined) {
      let sameOrigin = false;
      try { sameOrigin = new URL(req.headers.origin).host.toLowerCase() === String(req.headers.host || "").trim().toLowerCase(); } catch { sameOrigin = false; }
      if (!sameOrigin) return sendJson(req, res, 403, { error: "Cerere refuzată: altă origine" });
    }
    let input;
    try { input = JSON.parse(await readBody(req)); } catch (error) {
      if (error instanceof RequestError) return sendJson(req, res, error.status, { error: error.message }, { Connection: "close" });
      return sendJson(req, res, 400, { error: "Corp JSON invalid" });
    }
    if (!input || typeof input !== "object" || Array.isArray(input)) return sendJson(req, res, 400, { error: "Corp JSON invalid" });

    const at = clock();
    ensureSeeds(at);
    const errors = {};
    const service = serviceById(input.serviceId);
    if (!service) errors.serviceId = "Alege un serviciu din listă";
    const slot = parseSlotStart(input.start);
    if (!slot) errors.start = "Alege un interval din grilă";
    else if (!shownDays(at).includes(slot.date)) errors.start = "Ziua nu este disponibilă în demo (doar azi și următoarele două zile)";
    else if (isPast(slot.date, slot.startMin, at)) errors.start = "Intervalul a trecut deja";
    const name = cleanLine(input.name);
    const vehicle = cleanLine(input.vehicle);
    const phone = typeof input.phone === "string" ? input.phone.trim() : "";
    const nameProblem = lineProblem(name, "Numele");
    const vehicleProblem = lineProblem(vehicle, "Vehiculul");
    if (nameProblem) errors.name = nameProblem;
    if (vehicleProblem) errors.vehicle = vehicleProblem;
    if (!phone) errors.phone = "Telefonul este obligatoriu";
    if (Object.keys(errors).length) return invalid(req, res, errors);

    const endMin = slot.startMin + service.durationMin;
    const row = inTransaction(() => {
      if (sql.overlapping.get(slot.date, endMin, slot.startMin)) return null;
      const id = `bk_${crypto.randomBytes(6).toString("hex")}`;
      sql.insert.run(id, service.id, slot.date, slot.startMin, endMin, name, vehicle, phone, 0, at.toISOString());
      return { id, service_id: service.id, day: slot.date, start_min: slot.startMin, end_min: endMin, name, vehicle, phone, synthetic: 0 };
    });
    if (!row) return sendJson(req, res, 409, { error: "Intervalul tocmai a fost ocupat" });
    return sendJson(req, res, 201, { booking: publicBooking(row) });
  }

  /** The request handler for http.createServer. It never throws: an unexpected error is answered 500 without details. */
  async function handle(req, res) {
    try {
      if (closed) return sendJson(req, res, 503, { error: "Serverul se oprește" }, { Connection: "close" });
      // Only a local name is answered: a page that reached this port through another host name gets nothing.
      if (!LOCAL_HOSTS.has(hostName(req.headers.host))) return sendJson(req, res, 400, { error: "Cerere refuzată: demo-ul răspunde doar local" });
      const target = parseTarget(req.url);
      if (!target) return notFound(req, res);
      const { pathname, query } = target;
      const read = req.method === "GET" || req.method === "HEAD";
      if (Object.hasOwn(STATIC_FILES, pathname)) return read ? sendFile(req, res, STATIC_FILES[pathname]) : methodNotAllowed(req, res, "GET, HEAD");
      if (pathname === "/api/services") return read ? getServices(req, res) : methodNotAllowed(req, res, "GET, HEAD");
      if (pathname === "/api/slots") return read ? getSlots(req, res, query) : methodNotAllowed(req, res, "GET, HEAD");
      if (pathname === "/api/bookings") {
        if (read) return getBookings(req, res, query);
        if (req.method === "POST") return await postBooking(req, res);
        return methodNotAllowed(req, res, "GET, HEAD, POST");
      }
      return notFound(req, res);
    } catch (error) {
      console.error(`[programari-demo] eroare internă: ${error?.code || error?.name || "necunoscută"}`);
      if (res.headersSent) { res.destroy(); return undefined; }
      return sendJson(req, res, 500, { error: "Eroare internă" });
    }
  }

  function close() {
    if (closed) return;
    closed = true;
    try { db.close(); } catch { /* already closed */ }
  }

  ensureSeeds();
  return { handle, close };
}

/**
 * Starts the demo on 127.0.0.1 (never another interface). `port` 0 means any free port (tests). The other options go to
 * createApp. Resolves { url, port, close() } once the server listens and rejects when it cannot (e.g. the port is taken).
 */
export async function startServer({ port, dbPath, now, seed } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new TypeError("startServer: port must be an integer between 0 and 65535");
  const app = createApp({ dbPath, ...(now ? { now } : {}), ...(seed === undefined ? {} : { seed }) });
  const server = http.createServer((req, res) => { app.handle(req, res); });
  return new Promise((resolve, reject) => {
    server.once("error", (error) => { app.close(); reject(error); });
    server.listen(port, HOST, () => {
      const actual = server.address().port;
      let closing = null;
      const close = () => {
        closing ||= new Promise((done) => {
          server.close(() => { app.close(); done(); });
          server.closeAllConnections?.();
        });
        return closing;
      };
      resolve({ url: `http://${HOST}:${actual}/`, port: actual, close });
    });
  });
}
