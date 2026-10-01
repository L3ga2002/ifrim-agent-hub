// Teste de acceptanță INDEPENDENTE pentru „Solicitare serviciu” (protejate după aprobarea scope-ului). Integrare reală:
// server HTTP local pe un port liber + bază node:sqlite de test în data/ (nu mock-uri). Fără rețea externă.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createApp } from "../src/server-app.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dbFile = path.join(root, "data", `acceptance-${crypto.randomBytes(4).toString("hex")}.sqlite`);
fs.mkdirSync(path.dirname(dbFile), { recursive: true });

async function start(file = dbFile) {
  const app = createApp({ dbFile: file, publicDir: path.join(root, "public") });
  const server = http.createServer(app.handle);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, stop: () => new Promise((r) => { app.close(); server.close(r); }) };
}
const post = (base, body) => fetch(`${base}/api/requests`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("AC-1: o solicitare validă se salvează (201) și apare în listă", async (t) => {
  const s = await start(); t.after(s.stop);
  const res = await post(s.base, { name: "Ana Pop", email: "ana@example.ro", service: "audit", message: "Vreau un audit." });
  assert.equal(res.status, 201);
  const created = await res.json();
  assert.ok(created.id);
  const list = await (await fetch(`${s.base}/api/requests`)).json();
  assert.ok(list.requests.some((r) => r.id === created.id && r.email === "ana@example.ro"));
});

test("AC-2: datele invalide sunt refuzate (400) cu erori pe câmpuri", async (t) => {
  const s = await start(); t.after(s.stop);
  const res = await post(s.base, { name: "  ", email: "nu-e-email", service: "altceva" });
  assert.equal(res.status, 400);
  const body = await res.json();
  for (const field of ["name", "email", "service"]) assert.ok(body.errors?.[field], `eroare pentru ${field}`);
});

test("AC-3: o solicitare identică trimisă din nou în 10 minute este refuzată (409)", async (t) => {
  const s = await start(); t.after(s.stop);
  const body = { name: "Ion", email: "ion@example.ro", service: "mentenanta", message: "Revizie" };
  assert.equal((await post(s.base, body)).status, 201);
  assert.equal((await post(s.base, body)).status, 409);
});

test("AC-4: solicitările rămân salvate după repornire (bază de test persistentă)", async () => {
  const file = path.join(root, "data", `persist-${crypto.randomBytes(4).toString("hex")}.sqlite`);
  const a = await start(file);
  await post(a.base, { name: "Maria", email: "maria@example.ro", service: "consultanta" });
  await a.stop();
  const b = await start(file);
  const list = await (await fetch(`${b.base}/api/requests`)).json();
  await b.stop();
  assert.ok(list.requests.some((r) => r.email === "maria@example.ro"));
});

test("AC-5: formularul are câmpurile, stările loading/error/success și e utilizabil pe mobil", async (t) => {
  const s = await start(); t.after(s.stop);
  const html = await (await fetch(`${s.base}/`)).text();
  assert.match(html, /<meta name="viewport"/);
  for (const name of ["name", "email", "service", "message"]) assert.match(html, new RegExp(`name="${name}"`));
  assert.match(html, /aria-live/);
  for (const state of ["loading", "error", "success"]) assert.match(html, new RegExp(`data-state="${state}"|'${state}'|"${state}"`));
  assert.match(html, /fetch\(["']\/api\/requests/);
});
