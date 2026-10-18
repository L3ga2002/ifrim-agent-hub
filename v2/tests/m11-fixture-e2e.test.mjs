// Milestone 11 — the booking fixture in the REAL browser (Playwright 1.61.0 + the cached Chromium, OS sandbox on), through the
// Hub's own E2E runner (tools/browser.mjs runE2E, the helper the Software Factory uses for `verify: "e2e"` criteria). The
// steps are the approved ones from BOOKING_DEMO. The fixture is copied to a temp folder and served in-process on a RANDOM
// free loopback port (never 4620). PASS_LOCAL when Playwright and Chromium are present; SKIPPED_ENV otherwise.
// "Phone" here is a viewport width (390×844 in Chromium), not an emulated device.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { browserStatus, runE2E, validateE2ESteps } from "../server/tools/browser.mjs";
import { BOOKING_DEMO } from "../server/factory/booking-demo-def.mjs";
import { FIXTURE_ROOT } from "../server/factory/fixtures.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const HUB_ROOT = path.resolve(here, "..", "..");
const FIXTURE = path.join(FIXTURE_ROOT, "booking-demo");
const status = browserStatus({ hubRoot: HUB_ROOT });
const skip = status.installed && status.cachedBrowsers.length ? false : "SKIPPED_ENV: Playwright/Chromium is missing";
const HUB_PORTS = [8011, 8012];

const made = [];
test.after(() => { for (const dir of made.splice(0)) { try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* a screenshot or database still held on Windows */ } } });

/** A temp copy of the fixture, optionally with a writer patch applied (the fake Codex factory-write format). */
function copyFixture(label, patchName = null) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ifrim-m11-e2e-${label}-`));
  fs.cpSync(FIXTURE, dir, { recursive: true });
  made.push(dir);
  if (patchName) {
    const patch = JSON.parse(fs.readFileSync(path.join(here, "fixtures", "factory-patches", `${patchName}.json`), "utf8"));
    for (const [rel, text] of Object.entries(patch.write)) { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); }
  }
  return dir;
}

/** Starts the copy's own server on a random free port (the port override of startServer; the real clock, like a preview). */
async function preview(dir) {
  const { startServer } = await import(pathToFileURL(path.join(dir, "src", "server-app.js")).href);
  const server = await startServer({ port: 0, dbPath: path.join(dir, "data", "bookings.db") });
  assert.notEqual(server.port, BOOKING_DEMO.port, "tests never use the preview port 4620");
  return server;
}

const getJson = (base, target) => new Promise((resolve, reject) => {
  http.get(new URL(target, base), (res) => {
    let text = "";
    res.setEncoding("utf8");
    res.on("data", (chunk) => { text += chunk; });
    res.on("end", () => { try { resolve(JSON.parse(text)); } catch (error) { reject(error); } });
  }).on("error", reject);
});
/** The bookings of "tomorrow" (day 1) that are not synthetic seeds: what the browser runs created. */
async function madeTomorrow(base) {
  const { days } = await getJson(base, "/api/services");
  const { bookings } = await getJson(base, `/api/bookings?date=${days[1].date}`);
  return bookings.filter((b) => !b.seed);
}

const steps = (id) => JSON.parse(JSON.stringify(BOOKING_DEMO.spec.acceptance.find((a) => a.id === id).steps));
const run = (server, dir, list, options = {}) => runE2E({ url: server.url, steps: list, hubRoot: HUB_ROOT, evidenceDir: path.join(dir, "evidence"), hubPorts: HUB_PORTS, ...options });
const failed = (result) => JSON.stringify(result.steps.filter((s) => !s.ok));
const pageErrors = (result) => result.consoleErrors.filter((e) => e.type === "pageerror" || e.type === "error");

test("M11-E2E-01 baseline: AC-6 (390×844) FAILS exactly at the expectSelector step — a booked slot is not disabled — while AC-7 (1280×800) passes", { skip }, async (t) => {
  const dir = copyFixture("baseline");
  const server = await preview(dir);
  t.after(() => server.close());

  const phone = await run(server, dir, steps("AC-6"), { stepTimeoutMs: 4000 });
  assert.equal(phone.status, "FAIL");
  assert.deepEqual(phone.steps.map((s) => [s.i, s.kind, s.ok]), [[1, "viewport", true], [2, "goto", true], [3, "noHorizontalOverflow", true], [4, "click", true], [5, "click", true], [6, "expectSelector", false]],
    "the run stops at step 6: the page loads, has no horizontal overflow and the choices work; only the booked slot is wrong");
  assert.deepEqual(steps("AC-6")[5], { expectSelector: ".slot[data-booked='true'][aria-disabled='true']" });
  assert.ok(phone.screenshot && fs.existsSync(path.join(dir, "evidence", phone.screenshot)), "a screenshot of the failure");
  assert.deepEqual(pageErrors(phone), [], "the failure is the product's behaviour, not a script error");
  assert.deepEqual(await madeTomorrow(server.url), [], "the failed phone run booked nothing");

  // The factory runs the criteria in order on the same preview: the desktop one passes on the unfixed code.
  const desktop = await run(server, dir, steps("AC-7"));
  assert.equal(desktop.status, "PASS", failed(desktop));
  assert.equal(desktop.steps.length, 11);
  assert.deepEqual(pageErrors(desktop), []);
  const made1 = await madeTomorrow(server.url);
  assert.equal(made1.length, 1);
  assert.match(made1[0].name, /^Client Demo [0-9a-z_]{10}$/, "the {run} token of this run");
  assert.deepEqual([made1[0].time, made1[0].serviceId, made1[0].vehicle], ["09:00", "spalare-exterior", "Autoturism test"]);
});

test("M11-E2E-02 after booking-fix: AC-6 (390×844) and AC-7 (1280×800) both PASS, each books its own slot and leaves its own screenshot", { skip }, async (t) => {
  const dir = copyFixture("fixed", "booking-fix");
  const server = await preview(dir);
  t.after(() => server.close());

  const phone = await run(server, dir, steps("AC-6"));
  assert.equal(phone.status, "PASS", failed(phone));
  assert.equal(phone.steps.length, 11);
  assert.ok(phone.steps.every((s) => s.ok));
  const desktop = await run(server, dir, steps("AC-7"));
  assert.equal(desktop.status, "PASS", failed(desktop));
  assert.equal(desktop.steps.length, 11);

  for (const result of [phone, desktop]) {
    assert.match(result.screenshot, /^e2e_[a-z0-9]+_[0-9a-f]+\.png$/);
    assert.ok(fs.statSync(path.join(dir, "evidence", result.screenshot)).size > 5000, "a real screenshot");
    assert.deepEqual(pageErrors(result), []);
    assert.equal(result.network.blockedCount, 0, "the page asks for nothing outside its own origin");
    assert.equal(result.network.allowedOrigin, server.url.slice(0, -1));
  }
  assert.notEqual(phone.screenshot, desktop.screenshot);
  const bookings = await madeTomorrow(server.url);
  assert.deepEqual(bookings.map((b) => b.time), ["09:00", "09:30"], "each run books the first free slot of tomorrow");
  assert.equal(new Set(bookings.map((b) => b.name)).size, 2);
  assert.ok(bookings.every((b) => /^Client Demo [0-9a-z_]{10}$/.test(b.name) && b.vehicle === "Autoturism test"));
});

test("M11-E2E-03 after booking-fix, at 390 px and at 320 px: field errors, then a full booking with a long name — never a horizontal overflow", { skip }, async (t) => {
  const dir = copyFixture("overflow", "booking-fix");
  const server = await preview(dir);
  t.after(() => server.close());
  const longName = `Client${"X".repeat(54)}`; // 60 characters without a space: the worst case for wrapping
  const flow = (width, height, service) => [
    { viewport: { width, height } }, { goto: "/" }, { noHorizontalOverflow: true },
    // Nothing chosen and nothing typed: the form explains what is missing and marks the fields.
    { click: "button[type='submit']" }, { expectText: "Corectează câmpurile marcate." }, { expectSelector: "#status[data-state='error']" },
    { expectSelector: "input[name='name'][aria-invalid='true']" }, { expectText: "Alege un interval liber din grilă." }, { noHorizontalOverflow: true },
    { click: `label[data-service='${service}']` }, { click: "button[data-day='2']" },
    { expectSelector: ".slot[data-booked='true'][aria-disabled='true']" }, { noHorizontalOverflow: true },
    { click: ".slot[data-booked='false'][aria-disabled='false']" }, { expectSelector: ".slot[aria-pressed='true']" },
    { fill: { selector: "input[name='name']", value: longName } }, { fill: { selector: "input[name='vehicle']", value: "Autoturism test {run}" } },
    { click: "button[type='submit']" }, { expectText: "Programare confirmată" }, { expectSelector: BOOKING_DEMO.delivery.proofSelector },
    { expectSelector: BOOKING_DEMO.delivery.bannerSelector }, { noHorizontalOverflow: true },
  ];
  for (const [width, height, service] of [[390, 844, "curatare-interior"], [320, 640, "polish-faruri"]]) {
    const list = flow(width, height, service);
    assert.deepEqual(validateE2ESteps(list), []);
    const result = await run(server, dir, list);
    assert.equal(result.status, "PASS", `${width}px: ${failed(result)}`);
    assert.equal(result.steps.length, list.length);
    assert.deepEqual(pageErrors(result), []);
  }
  const { days } = await getJson(server.url, "/api/services");
  const { bookings } = await getJson(server.url, `/api/bookings?date=${days[2].date}`);
  assert.deepEqual(bookings.filter((b) => !b.seed).map((b) => [b.serviceId, b.name]), [["curatare-interior", longName], ["polish-faruri", longName]]);
});

test("M11-E2E-04 baseline, 390 px: the agreed problem as the owner sees it — a booked slot can be chosen and the confirmation is refused with „Intervalul tocmai a fost ocupat”", { skip }, async (t) => {
  const dir = copyFixture("visible-bug");
  const server = await preview(dir);
  t.after(() => server.close());
  const list = [
    { viewport: { width: 390, height: 844 } }, { goto: "/" },
    { click: "label[data-service='spalare-exterior']" }, { click: "button[data-day='1']" },
    // On the unfixed code the booked slot is offered like a free one.
    { click: ".slot[data-booked='true'][aria-disabled='false']" }, { expectSelector: ".slot[data-booked='true'][aria-pressed='true']" },
    { fill: { selector: "input[name='name']", value: "Client Demo {run}" } }, { fill: { selector: "input[name='vehicle']", value: "Autoturism test" } },
    { click: "button[type='submit']" }, { expectText: "Intervalul tocmai a fost ocupat" }, { expectSelector: "#status[data-state='error']" },
    { noHorizontalOverflow: true },
  ];
  assert.deepEqual(validateE2ESteps(list), []);
  const result = await run(server, dir, list);
  assert.equal(result.status, "PASS", failed(result));
  assert.deepEqual(await madeTomorrow(server.url), [], "the server refused the overlap: nothing was booked");
  // The 409 is the only console noise a browser reports here (a failed request), never a script error.
  assert.deepEqual(result.consoleErrors.filter((e) => e.type === "pageerror"), []);
});
