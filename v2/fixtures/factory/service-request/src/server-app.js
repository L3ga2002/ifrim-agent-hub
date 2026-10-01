import fs from "node:fs";
import path from "node:path";

/**
 * "Solicitare serviciu" — schelet (fixture Software Factory, Demo B). Pagina se servește, dar API-ul nu este implementat:
 * POST /api/requests și GET /api/requests răspund 501. Implementarea face parte din misiune.
 */
export function createApp({ dbFile, publicDir }) {
  void dbFile;
  async function handle(req, res) {
    const url = new URL(req.url, "http://127.0.0.1");
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(fs.readFileSync(path.join(publicDir, "index.html")));
      return;
    }
    if (url.pathname === "/api/requests") {
      res.writeHead(501, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Neimplementat" }));
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Negăsit" }));
  }
  return { handle, close() {} };
}
