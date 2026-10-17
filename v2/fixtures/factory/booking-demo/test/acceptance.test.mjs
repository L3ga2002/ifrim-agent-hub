// Teste de acceptanță INDEPENDENTE pentru „Programări detailing” (protejate de Software Factory după aprobarea scope-ului).
// AC-1 și AC-2 verifică modelul de afișare al grilei (public/js/slots-view.mjs) pe intervalele calculate de logica serverului.
// AC-3 este integrare reală: server HTTP local pe un port liber + bază node:sqlite de test în data/ (fără mock-uri, fără
// rețea externă). Ceasul este fix (14 ianuarie 2030, ora 12:00, ora locală), deci rezultatele nu depind de ziua rulării.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createApp } from "../src/server-app.js";
import { buildDaySlots } from "../src/slots.js";
import { layoutSlots } from "../public/js/slots-view.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NOW = new Date(2030, 0, 14, 12, 0, 0);
const TODAY = "2030-01-14";
const TOMORROW = "2030-01-15";
const SPALARE = "spalare-exterior"; // 30 min
const INTERIOR = "curatare-interior"; // 60 min

/** Intervalele de mâine pentru un serviciu de 30 min, cu ora 10:00 ocupată (restul libere). */
const tomorrowSlots = () => buildDaySlots({ date: TOMORROW, durationMin: 30, bookings: [{ startMin: 600, endMin: 630 }], now: NOW });
/** Intervalele de azi la ora 12:00: 09:00–12:00 trecute, 15:00 ocupat, restul libere. */
const todaySlots = () => buildDaySlots({ date: TODAY, durationMin: 30, bookings: [{ startMin: 900, endMin: 930 }], now: NOW });
const shown = ({ start, time, available, note }) => ({ start, time, available, note });

test("AC-1: pe telefon un interval ocupat apare indisponibil și nu poate fi ales", () => {
  const slots = tomorrowSlots();
  const view = layoutSlots(slots, { compact: true });
  assert.equal(view.length, slots.length, "pe telefon se afișează toate intervalele zilei");
  const isBooked = (entry) => entry.start === `${TOMORROW}T10:00`;
  assert.equal(view.find(isBooked).available, false, "INTERVAL_OCUPAT_LIBER_PE_MOBIL: intervalul ocupat apare liber pe telefon");
  assert.match(String(view.find(isBooked).note), /ocupat/i, "pe telefon intervalul ocupat este marcat „Ocupat”");
  // Fără supra-corectare: pe telefon pot fi alese exact intervalele libere, în aceeași ordine.
  for (const day of [slots, todaySlots()]) {
    assert.deepEqual(layoutSlots(day, { compact: true }).filter((entry) => entry.available).map((entry) => entry.start),
      day.filter((slot) => slot.status === "free").map((slot) => slot.start), "pe telefon pot fi alese exact intervalele libere");
  }
});

test("AC-2: pe desktop afișarea intervalelor rămâne aceeași", () => {
  const slots = todaySlots();
  const view = layoutSlots(slots, { compact: false }).map(shown);
  assert.equal(view.length, 16);
  assert.deepEqual(view.find((entry) => entry.time === "09:00"), { start: `${TODAY}T09:00`, time: "09:00", available: false, note: "Trecut" });
  assert.deepEqual(view.find((entry) => entry.time === "12:00"), { start: `${TODAY}T12:00`, time: "12:00", available: false, note: "Trecut" });
  assert.deepEqual(view.find((entry) => entry.time === "12:30"), { start: `${TODAY}T12:30`, time: "12:30", available: true, note: "" });
  assert.deepEqual(view.find((entry) => entry.time === "15:00"), { start: `${TODAY}T15:00`, time: "15:00", available: false, note: "Ocupat" });
  assert.deepEqual(view.find((entry) => entry.time === "16:30"), { start: `${TODAY}T16:30`, time: "16:30", available: true, note: "" });
  assert.deepEqual(view.map((entry) => entry.time), slots.map((slot) => slot.time), "aceeași ordine a intervalelor");
  assert.equal(view.filter((entry) => entry.available).length, 8, "8 intervale libere: 12:30–16:30 fără 15:00");
  assert.equal(view.filter((entry) => entry.note === "Trecut").length, 7);
  assert.equal(view.filter((entry) => entry.note === "Ocupat").length, 1);
});

// ---------- AC-3: API ----------
const dbFile = () => path.join(root, "data", `acceptance-${crypto.randomBytes(4).toString("hex")}.db`);

async function start(file = dbFile()) {
  const app = createApp({ dbPath: file, now: () => NOW });
  const server = http.createServer(app.handle);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const stop = () => new Promise((resolve) => { server.close(() => { app.close(); resolve(); }); server.closeAllConnections?.(); });
  return { base, file, stop };
}
const remove = (file) => { try { fs.rmSync(file, { force: true }); } catch { /* fișierul de test rămâne în data/ (ignorat) */ } };
const post = (base, body) => fetch(`${base}/api/bookings`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const getJson = async (url) => { const res = await fetch(url); return { status: res.status, body: await res.json() }; };
const valid = (extra = {}) => ({ serviceId: SPALARE, start: `${TOMORROW}T13:00`, name: "Client Test", vehicle: "Autoturism test", ...extra });

test("AC-3: o programare validă se salvează (201), apare în lista zilei și ocupă intervalul", async (t) => {
  const s = await start();
  t.after(async () => { await s.stop(); remove(s.file); });
  const before = await getJson(`${s.base}/api/slots?date=${TOMORROW}&service=${SPALARE}`);
  assert.equal(before.status, 200);
  assert.equal(before.body.slots.length, 16);
  assert.equal(before.body.slots.find((slot) => slot.time === "13:00").status, "free");
  assert.equal(before.body.slots.find((slot) => slot.time === "10:00").status, "booked", "programările sintetice ale zilei ocupă intervale");

  const res = await post(s.base, valid());
  assert.equal(res.status, 201);
  const created = (await res.json()).booking;
  assert.ok(created.id);
  assert.equal(created.start, `${TOMORROW}T13:00`);

  const list = await getJson(`${s.base}/api/bookings?date=${TOMORROW}`);
  assert.equal(list.status, 200);
  assert.ok(list.body.bookings.some((b) => b.id === created.id && b.name === "Client Test" && b.vehicle === "Autoturism test" && b.time === "13:00"));
  const after = await getJson(`${s.base}/api/slots?date=${TOMORROW}&service=${SPALARE}`);
  assert.equal(after.body.slots.find((slot) => slot.time === "13:00").status, "booked");
});

test("AC-3: un interval ocupat este refuzat (409), inclusiv când serviciul s-ar suprapune peste o programare", async (t) => {
  const s = await start();
  t.after(async () => { await s.stop(); remove(s.file); });
  const seeded = await post(s.base, valid({ start: `${TOMORROW}T10:00` }));
  assert.equal(seeded.status, 409, "intervalul unei programări sintetice este ocupat");
  assert.match((await seeded.json()).error, /ocupat/i);
  assert.equal((await post(s.base, valid({ serviceId: INTERIOR, start: `${TOMORROW}T09:30` }))).status, 409, "60 de minute de la 09:30 se suprapun cu 10:00");
  assert.equal((await post(s.base, valid())).status, 201);
  assert.equal((await post(s.base, valid({ name: "Alt Client" }))).status, 409, "același interval nu se poate programa de două ori");
  const list = await getJson(`${s.base}/api/bookings?date=${TOMORROW}`);
  assert.equal(list.body.bookings.filter((b) => b.time === "13:00").length, 1);
});

test("AC-3: un interval trecut și datele invalide sunt refuzate (400) cu erori pe câmpuri", async (t) => {
  const s = await start();
  t.after(async () => { await s.stop(); remove(s.file); });
  const past = await post(s.base, valid({ start: `${TODAY}T09:00` }));
  assert.equal(past.status, 400, "ora 09:00 de azi a trecut (ceasul testului: 12:00)");
  assert.ok((await past.json()).errors?.start, "eroare pentru interval");

  const bad = await post(s.base, { serviceId: "altceva", start: `${TOMORROW}T09:10`, name: " ", vehicle: "" });
  assert.equal(bad.status, 400);
  const body = await bad.json();
  for (const field of ["serviceId", "start", "name", "vehicle"]) assert.ok(body.errors?.[field], `eroare pentru ${field}`);

  assert.equal((await post(s.base, valid({ start: "2030-01-20T09:00" }))).status, 400, "o zi din afara celor trei afișate");
  assert.equal((await fetch(`${s.base}/api/bookings`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{nu e json" })).status, 400);
  assert.equal((await getJson(`${s.base}/api/slots?date=nu-e-data&service=${SPALARE}`)).status, 400);
  const list = await getJson(`${s.base}/api/bookings?date=${TOMORROW}`);
  assert.ok(list.body.bookings.every((b) => b.seed === true), "nicio cerere refuzată nu a salvat ceva");
});

test("AC-3: programările rămân salvate după repornire", async () => {
  const file = dbFile();
  try {
    const first = await start(file);
    const res = await post(first.base, valid({ start: `${TOMORROW}T14:00`, name: "Client Persistent" }));
    assert.equal(res.status, 201);
    await first.stop();

    const second = await start(file);
    const list = await getJson(`${second.base}/api/bookings?date=${TOMORROW}`);
    const slots = await getJson(`${second.base}/api/slots?date=${TOMORROW}&service=${SPALARE}`);
    await second.stop();
    assert.ok(list.body.bookings.some((b) => b.name === "Client Persistent" && b.time === "14:00"));
    assert.equal(slots.body.slots.find((slot) => slot.time === "14:00").status, "booked");
    assert.equal(list.body.bookings.filter((b) => b.seed === true).length, 3, "programările sintetice nu se dublează la repornire");
  } finally { remove(file); }
});
