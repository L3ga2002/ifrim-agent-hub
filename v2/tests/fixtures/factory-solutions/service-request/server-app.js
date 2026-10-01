import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";

/**
 * "Solicitare serviciu" — implementarea de referință a fixture-ului (scrisă de writer-ul SIMULAT în Demo B).
 * POST /api/requests: validare, deduplicare (aceeași adresă + serviciu + mesaj în 10 minute → 409), persistare în baza de test.
 * GET /api/requests: lista, cele mai noi primele. GET /: formularul.
 */
export const SERVICES = Object.freeze(["consultanta", "mentenanta", "audit"]);
const DEDUPE = true;
const DEDUPE_WINDOW_MS = 10 * 60 * 1000;
const MAX_BODY = 16 * 1024;

export function validate(input = {}) {
  const errors = {};
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const service = typeof input.service === "string" ? input.service.trim() : "";
  const message = typeof input.message === "string" ? input.message.trim() : "";
  if (name.length < 2 || name.length > 120) errors.name = "Numele are între 2 și 120 de caractere";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) errors.email = "E-mailul nu este valid";
  if (!SERVICES.includes(service)) errors.service = "Alege un serviciu din listă";
  if (message.length > 2000) errors.message = "Mesajul are cel mult 2000 de caractere";
  return { ok: Object.keys(errors).length === 0, errors, value: { name, email, service, message } };
}

export function createApp({ dbFile, publicDir }) {
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  const db = new DatabaseSync(dbFile);
  db.exec(`CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, service TEXT NOT NULL,
    message TEXT NOT NULL DEFAULT '', fingerprint TEXT NOT NULL, created_at TEXT NOT NULL)`);
  const send = (res, status, body) => { res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(body)); };

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on("data", (chunk) => { size += chunk.length; if (size > MAX_BODY) { reject(Object.assign(new Error("too large"), { status: 413 })); req.destroy(); } else chunks.push(chunk); });
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      req.on("error", reject);
    });
  }

  async function handle(req, res) {
    const url = new URL(req.url, "http://127.0.0.1");
    try {
      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(fs.readFileSync(path.join(publicDir, "index.html")));
        return;
      }
      if (url.pathname === "/api/requests" && req.method === "GET") {
        const rows = db.prepare("SELECT id, name, email, service, message, created_at FROM requests ORDER BY created_at DESC LIMIT 100").all();
        return send(res, 200, { requests: rows.map((r) => ({ id: r.id, name: r.name, email: r.email, service: r.service, message: r.message, createdAt: r.created_at })) });
      }
      if (url.pathname === "/api/requests" && req.method === "POST") {
        let input;
        try { input = JSON.parse(await readBody(req)); } catch (error) { return send(res, error.status || 400, { error: "Corp JSON invalid" }); }
        const { ok, errors, value } = validate(input);
        if (!ok) return send(res, 400, { error: "Date invalide", errors });
        const fingerprint = crypto.createHash("sha256").update([value.email, value.service, value.message].join("\n")).digest("hex");
        const since = new Date(Date.now() - DEDUPE_WINDOW_MS).toISOString();
        if (DEDUPE && db.prepare("SELECT id FROM requests WHERE fingerprint = ? AND created_at >= ?").get(fingerprint, since)) {
          return send(res, 409, { error: "Solicitarea a fost deja trimisă" });
        }
        const id = `req_${crypto.randomBytes(6).toString("hex")}`;
        db.prepare("INSERT INTO requests (id, name, email, service, message, fingerprint, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
          .run(id, value.name, value.email, value.service, value.message, fingerprint, new Date().toISOString());
        return send(res, 201, { id });
      }
      return send(res, 404, { error: "Negăsit" });
    } catch {
      return send(res, 500, { error: "Eroare internă" });
    }
  }
  return { handle, close: () => db.close() };
}
