// Teste unitare pentru logica pură a intervalelor (src/slots.js) și pentru catalogul sintetic (src/catalog.js).
import test from "node:test";
import assert from "node:assert/strict";
import { SERVICES, serviceById, SEED_BOOKINGS, SEED_VEHICLE } from "../src/catalog.js";
import {
  DAYS_SHOWN, addDays, buildDaySlots, dateKey, isPast, overlaps, parseDateKey, parseSlotStart, parseSlotTime, shownDays, slotStart, slotStarts, timeLabel,
} from "../src/slots.js";

test("grila zilei: 16 intervale din 30 în 30 de minute, de la 09:00 la 16:30", () => {
  const starts = slotStarts();
  assert.equal(starts.length, 16);
  assert.equal(timeLabel(starts[0]), "09:00");
  assert.equal(timeLabel(starts.at(-1)), "16:30");
  assert.ok(starts.every((minutes, index) => index === 0 || minutes - starts[index - 1] === 30));
});

test("suprapunerea folosește intervale semideschise: capetele care se ating nu se suprapun", () => {
  assert.equal(overlaps(600, 630, 630, 660), false);
  assert.equal(overlaps(600, 660, 630, 660), true);
  assert.equal(overlaps(570, 630, 600, 630), true);
  assert.equal(overlaps(600, 630, 540, 600), false);
});

test("zilele afișate: azi și următoarele două, inclusiv peste sfârșitul lunii și al anului", () => {
  assert.equal(DAYS_SHOWN, 3);
  assert.deepEqual(shownDays(new Date(2030, 0, 14, 8, 0)), ["2030-01-14", "2030-01-15", "2030-01-16"]);
  assert.deepEqual(shownDays(new Date(2030, 11, 30, 23, 59)), ["2030-12-30", "2030-12-31", "2031-01-01"]);
  assert.deepEqual(shownDays(new Date(2028, 1, 28, 0, 0)), ["2028-02-28", "2028-02-29", "2028-03-01"]);
  assert.equal(addDays("2030-03-30", 2), "2030-04-01");
  assert.equal(dateKey(new Date(2030, 8, 5, 0, 0)), "2030-09-05");
});

test("datele și orele invalide sunt refuzate", () => {
  assert.equal(parseDateKey("2030-01-14"), "2030-01-14");
  for (const bad of ["2030-02-30", "2030-13-01", "14-01-2030", "2030-1-4", "", null, undefined, 20300114]) assert.equal(parseDateKey(bad), null, String(bad));
  assert.equal(parseSlotTime("09:00"), 540);
  assert.equal(parseSlotTime("16:30"), 990);
  for (const bad of ["08:30", "17:00", "09:10", "9:00", "09:60", "", null]) assert.equal(parseSlotTime(bad), null, String(bad));
  assert.deepEqual(parseSlotStart("2030-01-15T10:30"), { date: "2030-01-15", startMin: 630 });
  for (const bad of ["2030-01-15 10:30", "2030-01-15T10:30:00", "2030-01-15T10:15", "2030-02-31T10:00", "T10:00", 5, null]) assert.equal(parseSlotStart(bad), null, String(bad));
  assert.equal(slotStart("2030-01-15", 630), "2030-01-15T10:30");
});

test("un interval este trecut când începe la minutul curent sau mai devreme", () => {
  const now = new Date(2030, 0, 14, 12, 0);
  assert.equal(isPast("2030-01-14", 720, now), true, "12:00 la ora 12:00");
  assert.equal(isPast("2030-01-14", 750, now), false, "12:30 la ora 12:00");
  assert.equal(isPast("2030-01-13", 990, now), true, "ieri");
  assert.equal(isPast("2030-01-15", 540, now), false, "mâine");
});

test("starea intervalelor: trecut, ocupat (după durata serviciului) sau liber", () => {
  const now = new Date(2030, 0, 14, 12, 0);
  const bookings = [{ startMin: 600, endMin: 630 }, { startMin: 690, endMin: 750 }];
  const half = buildDaySlots({ date: "2030-01-15", durationMin: 30, bookings, now });
  assert.deepEqual(half.filter((slot) => slot.status === "booked").map((slot) => slot.time), ["10:00", "11:30", "12:00"]);
  assert.equal(half.filter((slot) => slot.status === "free").length, 13);
  assert.deepEqual(half[0], { start: "2030-01-15T09:00", time: "09:00", status: "free" });
  // Un serviciu de 60 de minute nu încape nici în intervalul dinaintea unei programări.
  const hour = buildDaySlots({ date: "2030-01-15", durationMin: 60, bookings, now });
  assert.deepEqual(hour.filter((slot) => slot.status === "booked").map((slot) => slot.time), ["09:30", "10:00", "11:00", "11:30", "12:00"]);
  const today = buildDaySlots({ date: "2030-01-14", durationMin: 30, bookings: [], now });
  assert.deepEqual(today.filter((slot) => slot.status === "past").map((slot) => slot.time), ["09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00"]);
  assert.ok(buildDaySlots({ date: "2030-01-13", durationMin: 30, bookings: [], now }).every((slot) => slot.status === "past"));
});

test("catalogul sintetic: trei servicii cu durată și trei programări de pornire pe grilă", () => {
  assert.deepEqual(SERVICES.map((service) => [service.id, service.durationMin]), [["spalare-exterior", 30], ["curatare-interior", 60], ["polish-faruri", 30]]);
  for (const service of SERVICES) assert.deepEqual(Object.keys(service).sort(), ["durationMin", "id", "name"]);
  assert.equal(serviceById("polish-faruri").name, "Polish faruri");
  assert.equal(serviceById("altceva"), null);
  assert.deepEqual(SEED_BOOKINGS.map((seed) => [seed.time, seed.serviceId, seed.name]),
    [["10:00", "spalare-exterior", "Client Demo A"], ["11:30", "curatare-interior", "Client Demo B"], ["15:00", "polish-faruri", "Client Demo C"]]);
  for (const seed of SEED_BOOKINGS) { assert.notEqual(parseSlotTime(seed.time), null); assert.ok(serviceById(seed.serviceId)); }
  assert.equal(SEED_VEHICLE, "Autoturism test");
});
