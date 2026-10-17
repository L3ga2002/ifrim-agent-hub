import { resolvePresentation, storyFromPresentation } from "../server/delivery/presentation.mjs";
// Milestone 11 — the booking fixture (v2/fixtures/factory/booking-demo), PASS_LOCAL: real node, real node:sqlite, real local
// HTTP on random free ports, no browser, no Hub, no model. The fixture is always copied to a temp folder first; nothing is
// run or written inside the repository copy. The commands are built and judged with the Hub runner's own helpers
// (commandArgv, parseTestOutput, testStatus), so "fails at baseline for the right reason" means what the factory will see.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import net from "node:net";
import http from "node:http";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { BOOKING_DEMO } from "../server/factory/booking-demo-def.mjs";
import { FACTORY_DEMOS, FIXTURE_ROOT, materializeFixture, demoSpec } from "../server/factory/fixtures.mjs";
import { checkSpec, normalizeSpec, protectedTestRefs, isAllowedCommand, isAllowedPreviewCommand } from "../server/factory/spec.mjs";
import { commandArgv, parseTestOutput, testStatus } from "../server/factory/runner.mjs";
import { integrityFindings, isBlockingIntegrity } from "../server/factory/integrity.mjs";
import { validateE2ESteps } from "../server/tools/browser-core.mjs";
import { buildBookingPatches, patchText } from "./fixtures/factory-solutions/booking-demo/make-patches.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const HUB_ROOT = path.resolve(here, "..", "..");
const FIXTURE = path.join(FIXTURE_ROOT, "booking-demo");
const PATCHES = path.join(here, "fixtures", "factory-patches");
const SOLUTIONS = path.join(here, "fixtures", "factory-solutions", "booking-demo");
const VIEW = "public/js/slots-view.mjs";
const PROTECTED = "test/acceptance.test.mjs";
const FAILURE_CODE = "INTERVAL_OCUPAT_LIBER_PE_MOBIL";
const FIXTURE_FILES = [".gitignore", "README.md", "config.json", "package.json", "public/index.html", "public/js/app.mjs", "public/js/slots-view.mjs",
  "public/styles.css", "server.js", "src/catalog.js", "src/server-app.js", "src/slots.js", "test/acceptance.test.mjs", "test/unit.test.mjs"];

const lf = (text) => text.replace(/\r\n/g, "\n");
const readFixture = (rel) => lf(fs.readFileSync(path.join(FIXTURE, rel), "utf8"));
const readPatch = (name) => JSON.parse(fs.readFileSync(path.join(PATCHES, `${name}.json`), "utf8"));
const walk = (dir, rel = "") => fs.readdirSync(path.join(dir, rel), { withFileTypes: true })
  .flatMap((entry) => (entry.isDirectory() ? walk(dir, `${rel}${entry.name}/`) : [`${rel}${entry.name}`])).sort();

/** Temp copies of the fixture; all removed when the file ends. */
const made = [];
function copyFixture(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ifrim-m11-${label}-`));
  fs.cpSync(FIXTURE, dir, { recursive: true });
  made.push(dir);
  return dir;
}
test.after(() => { for (const dir of made.splice(0)) { try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* a database still held on Windows */ } } });

/** Applies a writer patch exactly like the fake Codex scenario factory-write:<name> does (relative paths inside the folder only). */
function applyPatch(dir, patch) {
  const inside = (rel) => { const abs = path.resolve(dir, rel); return abs.startsWith(path.resolve(dir) + path.sep) ? abs : null; };
  const changed = [];
  for (const [rel, text] of Object.entries(patch.write || {})) {
    const abs = inside(rel);
    assert.ok(abs, `patch path inside the workspace: ${rel}`);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    changed.push({ path: rel, status: fs.existsSync(abs) ? "modified" : "added" });
    fs.writeFileSync(abs, text);
  }
  return changed;
}

/** Runs a spec command in `dir` the way the Hub runner does (same argv, TAP reporter) and judges it with the runner's parser. */
function runCommand(dir, command) {
  assert.ok(isAllowedCommand(command), `allowed command: ${command}`);
  const argv = commandArgv(command);
  // A nested `node --test` must not inherit the parent's test-runner context (it would emit the internal protocol, not TAP).
  const env = { ...process.env, NODE_ENV: "test", CI: "1" };
  delete env.NODE_TEST_CONTEXT;
  const run = spawnSync(argv[0], argv.slice(1), { cwd: dir, env, encoding: "utf8", timeout: 120000, windowsHide: true });
  const lines = [...String(run.stdout || "").split(/\r?\n/), ...String(run.stderr || "").split(/\r?\n/).filter(Boolean).map((line) => `[stderr] ${line}`)];
  const { counts, failures } = parseTestOutput(lines);
  const passed = lines.map((line) => (line.match(/^ok \d+ - (.+?)(?:\s+#.*)?$/) || [])[1]).filter(Boolean);
  return { exitCode: run.status, counts, failures, passed, outputTail: lines.slice(-120).join("\n"), verdict: testStatus({ exitCode: run.status, counts, timedOut: false }) };
}

/** The demo's spec input exactly as demoSpec builds it for factory.prepare, normalized by the factory's validator. */
const specInput = () => ({ workType: BOOKING_DEMO.workType, title: BOOKING_DEMO.title, objective: BOOKING_DEMO.objective, ...JSON.parse(JSON.stringify(BOOKING_DEMO.spec)) });
const approvedSpec = () => normalizeSpec(specInput(), { hubPorts: [8011, 8012] });

// ---------- local HTTP helpers (raw paths: fetch would normalize "..") ----------
function request(base, { method = "GET", path: target = "/", headers = {}, body = null } = {}) {
  const url = new URL(base);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: url.hostname, port: url.port, method, path: target, headers: { ...(body !== null ? { "Content-Length": Buffer.byteLength(body) } : {}), ...headers } }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try { json = JSON.parse(text); } catch { /* not JSON */ }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on("error", reject);
    req.end(body ?? undefined);
  });
}
const postBooking = (base, body, headers = {}) => request(base, { method: "POST", path: "/api/bookings", headers: { "Content-Type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
const getJson = (base, target) => request(base, { path: target });
const canConnect = (host, port) => new Promise((resolve) => {
  const socket = net.connect({ host, port });
  const done = (value) => { socket.destroy(); resolve(value); };
  socket.setTimeout(1500, () => done(false));
  socket.once("connect", () => done(true));
  socket.once("error", () => done(false));
});
const freePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.on("error", reject);
  probe.listen(0, "127.0.0.1", () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
});
const externalIPv4 = () => Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === "IPv4" && !i.internal)?.address || null;
const importApp = (dir) => import(pathToFileURL(path.join(dir, "src", "server-app.js")).href);
const dateKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

// A fixed local clock for the API tests: Monday 14 January 2030, 12:00.
const NOON = () => new Date(2030, 0, 14, 12, 0, 0);
const [D0, D1, D2, D3] = ["2030-01-14", "2030-01-15", "2030-01-16", "2030-01-17"];
const valid = (extra = {}) => ({ serviceId: "spalare-exterior", start: `${D1}T13:00`, name: "Client Test", vehicle: "Autoturism test", ...extra });

test("M11-FX-01 the fixture is exactly the specified file set: no dependencies, port 4620, data/ ignored, a Romanian README", () => {
  assert.deepEqual(walk(FIXTURE), FIXTURE_FILES, "no extra file (no data/, no node_modules, no solution) in the fixture");
  const pkg = JSON.parse(readFixture("package.json"));
  assert.equal(pkg.type, "module");
  assert.deepEqual(pkg.scripts, { test: "node --test", start: "node server.js" });
  for (const key of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) assert.equal(pkg[key], undefined, key);
  assert.deepEqual(JSON.parse(readFixture("config.json")), { port: 4620 });
  assert.ok(readFixture(".gitignore").split("\n").includes("data/"));
  const readme = readFixture("README.md");
  for (const phrase of ["Date sintetice", "Fără rețea", "Fără prețuri", BOOKING_DEMO.delivery.issue, "șterge folderul `data/`", "http://127.0.0.1:4620/", "node --test"]) assert.ok(readme.includes(phrase), `README: ${phrase}`);
  // Only imports of node: built-ins and of the fixture's own files.
  for (const rel of FIXTURE_FILES.filter((f) => /\.m?js$/.test(f))) {
    for (const [, spec] of readFixture(rel).matchAll(/^\s*import\s[^"']*["']([^"']+)["']/gm)) assert.match(spec, /^(?:node:[a-z/_]+|\.{1,2}\/[\w./-]+)$/, `${rel} imports ${spec}`);
  }
  // Romanian texts use the comma-below letters (ș, ț), never the cedilla forms.
  for (const rel of FIXTURE_FILES) assert.doesNotMatch(readFixture(rel), /[şţŞŢ]/, `${rel}: cedilla diacritics`);
});

test("M11-FX-02 baseline: the acceptance command fails ONLY because of the phone bug, with the expected reason in the output tail; AC-2, AC-3 and the unit tests pass", () => {
  const dir = copyFixture("baseline");
  const spec = approvedSpec();
  const expectFailure = spec.acceptance.find((a) => a.expectFailure).expectFailure;
  assert.equal(expectFailure, FAILURE_CODE.toLowerCase());

  const [command] = spec.verification.acceptance;
  const acceptance = runCommand(dir, command);
  assert.notEqual(acceptance.exitCode, 0, "the acceptance command fails before the work");
  assert.equal(acceptance.verdict.status, "FAIL");
  assert.ok(acceptance.outputTail.includes(`${FAILURE_CODE}: intervalul ocupat apare liber pe telefon`), acceptance.outputTail.slice(0, 1500));
  // The factory's own rule (runBaseline): the lower-cased reason is searched in the lower-cased tail (last 120 lines).
  assert.ok(acceptance.outputTail.toLowerCase().includes(expectFailure), "expectFailure matches the output tail");
  assert.equal(acceptance.failures.length, 1, `exactly one failing test: ${acceptance.failures.join(" | ")}`);
  assert.match(acceptance.failures[0], /^AC-1: /);
  assert.deepEqual({ tests: acceptance.counts.tests, fail: acceptance.counts.fail, skipped: acceptance.counts.skipped }, { tests: 6, fail: 1, skipped: 0 });
  assert.equal(acceptance.passed.filter((name) => name.startsWith("AC-2: ")).length, 1, "AC-2 passes at baseline");
  assert.equal(acceptance.passed.filter((name) => name.startsWith("AC-3: ")).length, 4, "the four AC-3 tests pass at baseline");

  // The checks command (everything): still only AC-1 fails, so the unit tests pass.
  const checks = runCommand(dir, spec.verification.checks[0]);
  assert.equal(checks.verdict.status, "FAIL");
  assert.deepEqual(checks.failures.map((name) => name.slice(0, 5)), ["AC-1:"]);
  assert.ok(checks.counts.tests >= 13 && checks.counts.pass === checks.counts.tests - 1, JSON.stringify(checks.counts));
  const unit = runCommand(dir, "node --test test/unit.test.mjs");
  assert.equal(unit.verdict.status, "PASS", unit.outputTail.slice(-600));
  // The tests clean their databases: nothing is left for a snapshot even without the data/ ignore.
  assert.deepEqual(fs.existsSync(path.join(dir, "data")) ? fs.readdirSync(path.join(dir, "data")) : [], []);
});

test("M11-FX-03 with booking-fix applied every acceptance, unit and regression test passes, and the integrity check has nothing blocking", () => {
  const dir = copyFixture("fixed");
  const spec = approvedSpec();
  const changes = applyPatch(dir, readPatch("booking-fix"));
  assert.deepEqual(changes, [{ path: VIEW, status: "modified" }, { path: "test/regression.test.mjs", status: "added" }]);
  const acceptance = runCommand(dir, spec.verification.acceptance[0]);
  assert.equal(acceptance.verdict.status, "PASS", acceptance.outputTail.slice(-1200));
  assert.deepEqual({ tests: acceptance.counts.tests, fail: acceptance.counts.fail, skipped: acceptance.counts.skipped }, { tests: 6, fail: 0, skipped: 0 });
  const checks = runCommand(dir, spec.verification.checks[0]);
  assert.equal(checks.verdict.status, "PASS", checks.outputTail.slice(-1200));
  assert.equal(checks.counts.tests, 14, "6 acceptance + 7 unit + 1 regression");
  assert.equal(checks.counts.skipped, 0);
  const findings = integrityFindings({ changes: changes.map((c) => ({ ...c, testFile: c.path.startsWith("test/") })), added: [], protectedRefs: protectedTestRefs(spec) });
  assert.deepEqual(findings.filter(isBlockingIntegrity), []);
  // The fix stays inside the approved scope: the view file and a new test, nothing else.
  assert.ok(spec.inScope.includes(VIEW));
});

test("M11-FX-04 booking-partial (label only) leaves AC-1 failing for the same reason, so a repair cycle is forced", () => {
  const dir = copyFixture("partial");
  const spec = approvedSpec();
  const patch = readPatch("booking-partial");
  assert.deepEqual(Object.keys(patch.write), [VIEW]);
  assert.match(patch.write[VIEW], /compact[\s\S]*note: NOTES\[s\.status\]/, "the partial patch adds the label on the phone");
  applyPatch(dir, patch);
  const acceptance = runCommand(dir, spec.verification.acceptance[0]);
  assert.equal(acceptance.verdict.status, "FAIL");
  assert.equal(acceptance.failures.length, 1);
  assert.match(acceptance.failures[0], /^AC-1: /);
  assert.ok(acceptance.outputTail.toLowerCase().includes(FAILURE_CODE.toLowerCase()));
});

test("M11-FX-05 booking-tamper rewrites the PROTECTED acceptance test (it then passes on the unfixed code) and the integrity check blocks it", () => {
  const dir = copyFixture("tamper");
  const spec = approvedSpec();
  const refs = protectedTestRefs(spec);
  assert.deepEqual(refs, [PROTECTED]);
  const patch = readPatch("booking-tamper");
  assert.deepEqual(Object.keys(patch.write), [PROTECTED], "the tamper patch touches only the protected test, not the code");
  assert.notEqual(patch.write[PROTECTED], readFixture(PROTECTED));
  assert.ok(!patch.write[PROTECTED].includes(FAILURE_CODE), "the assertion that reproduces the problem is gone");
  const changes = applyPatch(dir, patch);
  assert.equal(readFixture(VIEW), lf(fs.readFileSync(path.join(dir, VIEW), "utf8")), "the code is still the unfixed one");
  // The cheat "works": without the integrity check the acceptance command would now pass on the unfixed code.
  assert.equal(runCommand(dir, spec.verification.acceptance[0]).verdict.status, "PASS");
  const findings = integrityFindings({ changes: changes.map((c) => ({ ...c, testFile: true })), added: [], protectedRefs: refs });
  const blocking = findings.filter(isBlockingIntegrity);
  assert.equal(blocking.length, 1);
  assert.equal(blocking[0].code, "protected_test_changed");
  assert.equal(blocking[0].file, PROTECTED);
});

test("M11-FX-06 the three patches have the fake-codex factory-write format, are in sync with their sources and the solution is not in the fixture", () => {
  const built = buildBookingPatches();
  assert.deepEqual(Object.keys(built).sort(), ["booking-fix", "booking-partial", "booking-tamper"]);
  for (const [name, patch] of Object.entries(built)) {
    assert.match(name, /^[a-z0-9-]+$/, "the fake strips anything else from a scenario name");
    assert.equal(lf(fs.readFileSync(path.join(PATCHES, `${name}.json`), "utf8")), patchText(patch), `${name}.json is stale: run factory-solutions/booking-demo/make-patches.mjs`);
    assert.deepEqual(Object.keys(patch).sort(), ["summary", "write"]);
    assert.ok(typeof patch.summary === "string" && patch.summary.length > 10);
    for (const [rel, text] of Object.entries(patch.write)) {
      assert.ok(!path.isAbsolute(rel) && !rel.split("/").includes("..") && !rel.includes("\\"), rel);
      assert.equal(typeof text, "string");
      assert.ok(!text.includes("\r"), `${name}: ${rel} uses LF`);
    }
  }
  assert.equal(built["booking-fix"].write[VIEW], lf(fs.readFileSync(path.join(SOLUTIONS, "slots-view.mjs"), "utf8")));
  assert.equal(built["booking-partial"].write[VIEW], lf(fs.readFileSync(path.join(SOLUTIONS, "slots-view.partial.mjs"), "utf8")));
  // The reference fix is minimal: only lines of the phone branch differ from the fixture, the desktop branch is untouched.
  const base = readFixture(VIEW).split("\n");
  const fixed = built["booking-fix"].write[VIEW].split("\n");
  assert.equal(fixed.length, base.length);
  const differing = base.map((line, i) => (line === fixed[i] ? null : i)).filter((i) => i !== null);
  assert.ok(differing.length >= 1 && differing.length <= 2, `changed lines: ${differing.length}`);
  const desktopLine = base.findIndex((line) => line.includes("// Desktop"));
  assert.ok(desktopLine > 0 && differing.every((i) => i < desktopLine), "only the phone branch changes");
  // The agreed bug is in the fixture, and the fixed rule is not: a copy of the fixture never carries the solution.
  assert.match(readFixture(VIEW), /available: s\.state !== "booked", note: "" \}/);
  assert.equal((readFixture(VIEW).match(/available: s\.status === "free"/g) || []).length, 1, "only the desktop branch is right in the fixture");
  assert.ok(!walk(FIXTURE).some((rel) => /regression|solution|partial/.test(rel)));
});

test("M11-FX-07 BOOKING_DEMO: the spec validates with the factory's validator, the approved browser steps are valid and the delivery block points at things the fixture has", () => {
  const { spec, problems } = checkSpec(specInput(), { hubPorts: [8011, 8012] });
  assert.deepEqual(problems, []);
  assert.deepEqual(normalizeSpec(specInput(), { hubPorts: [8011, 8012] }), spec);
  // Same keys as the existing FACTORY_DEMOS entries (it is registered there later), plus its own.
  for (const key of Object.keys(FACTORY_DEMOS["service-request"])) assert.ok(BOOKING_DEMO[key] !== undefined, `key ${key}`);
  for (const key of Object.keys(FACTORY_DEMOS["service-request"].spec)) assert.ok(BOOKING_DEMO.spec[key] !== undefined, `spec.${key}`);
  assert.deepEqual([BOOKING_DEMO.key, BOOKING_DEMO.dirName, BOOKING_DEMO.checkFile, BOOKING_DEMO.data, BOOKING_DEMO.workType],
    ["booking-demo", "ifrim-delivery-demo-detailing", "src/server-app.js", "synthetic", "BUGFIX"]);
  assert.equal(BOOKING_DEMO.name, "Demo Livrare — Detailing (programări)");
  assert.match(BOOKING_DEMO.dirName, /^[a-z0-9][a-z0-9-]{2,60}$/, "accepted by create-factory-fixture's --dir rule");
  assert.ok(fs.existsSync(path.join(FIXTURE, BOOKING_DEMO.checkFile)));
  assert.ok(Object.isFrozen(BOOKING_DEMO) && Object.isFrozen(BOOKING_DEMO.spec.acceptance[5].steps) && Object.isFrozen(BOOKING_DEMO.delivery.presentations[0].clip.hook));
  assert.deepEqual(BOOKING_DEMO.limits, { maxDurationMin: 60, maxRepairCycles: 2 });

  assert.deepEqual(spec.acceptance.map((a) => [a.id, a.verify]), [["AC-1", "test"], ["AC-2", "test"], ["AC-3", "test"], ["AC-4", "review"], ["AC-5", "preview"], ["AC-6", "e2e"], ["AC-7", "e2e"]]);
  assert.deepEqual(spec.acceptance.filter((a) => a.expectFailure).map((a) => [a.id, a.expectFailure]), [["AC-1", "interval_ocupat_liber_pe_mobil"]]);
  assert.deepEqual(protectedTestRefs(spec), [PROTECTED]);
  assert.ok(fs.existsSync(path.join(FIXTURE, PROTECTED)));
  assert.deepEqual(spec.verification, { checks: ["node --test"], acceptance: ["node --test test/acceptance.test.mjs"], preview: { command: "node server.js", url: "http://127.0.0.1:4620/" } });
  assert.ok(isAllowedPreviewCommand(spec.verification.preview.command));
  assert.equal(Number(new URL(spec.verification.preview.url).port), JSON.parse(readFixture("config.json")).port);
  assert.equal(BOOKING_DEMO.port, 4620);
  assert.ok(![8011, 8012, 3011, 3012, 3004, 8004, 4610].includes(BOOKING_DEMO.port), "not a Hub, V1, Showcase or Demo B port");
  assert.deepEqual(spec.workspace, { ignore: ["data"] });
  assert.ok(spec.inScope.includes(VIEW));

  const [phone, desktop] = ["AC-6", "AC-7"].map((id) => spec.acceptance.find((a) => a.id === id).steps);
  assert.deepEqual(validateE2ESteps(phone), []);
  assert.deepEqual(validateE2ESteps(desktop), []);
  assert.deepEqual(phone[0], { viewport: { width: 390, height: 844 } });
  assert.deepEqual(desktop[0], { viewport: { width: 1280, height: 800 } });
  assert.deepEqual(phone.slice(1), desktop.slice(1), "the same flow on both widths");
  assert.deepEqual(phone.map((step) => Object.keys(step)[0]), ["viewport", "goto", "noHorizontalOverflow", "click", "click", "expectSelector", "click", "fill", "fill", "click", "expectText"]);
  assert.ok(!phone.some((step) => "select" in step), "no select step: the delivery capture cannot replay one");
  assert.deepEqual(phone[5], { expectSelector: ".slot[data-booked='true'][aria-disabled='true']" });
  assert.deepEqual(phone[7], { fill: { selector: "input[name='name']", value: "Client Demo {run}" } });
  assert.deepEqual(phone[10], { expectText: "Programare confirmată" });
  // What the steps and the delivery block name exists in the fixture's page.
  const html = readFixture("public/index.html");
  const app = readFixture("public/js/app.mjs");
  assert.match(html, /<p class="demo-banner" data-demo-banner>Date sintetice · demo local<\/p>/);
  assert.match(html, /<title>Programări detailing — demo<\/title>/);
  for (const needle of ['name="name"', 'name="vehicle"', 'type="submit"', 'id="slots"', 'id="day-list"', 'data-state="idle"', 'aria-live="polite"', '<meta name="viewport"']) assert.ok(html.includes(needle), needle);
  for (const needle of ["data: { service: service.id }", "data: { day: String(index) }", "booked: String(slot.status === \"booked\")", "\"aria-disabled\": String(!entry.available)", "Programare confirmată", "setStatus(\"success\"", "(max-width: 600px)"]) assert.ok(app.includes(needle), needle);
  assert.match(readFixture("public/styles.css"), /@media \(max-width: 600px\)[\s\S]*\.slots \{ grid-template-columns: repeat\(2,/);
  assert.match(readFixture("src/catalog.js"), /id: "spalare-exterior"/);

  const original = BOOKING_DEMO.delivery;
  const resolved = storyFromPresentation(resolvePresentation({ presentations: original.presentations, spec: BOOKING_DEMO.spec, specSha: "a".repeat(64) }));
  const d = { ...original, texts: Object.fromEntries(Object.entries(resolved.texts).map(([k, { claim, ...v }]) => [k, v])), variant: { ...original.variant, overrides: resolved.overrides } };
  assert.deepEqual([d.noun, d.issue, d.proofSelector, d.bannerSelector], ["programare", "Pe telefon, intervalele ocupate apar libere", "[data-state='success']", "[data-demo-banner]"]);
  assert.equal(d.issue, BOOKING_DEMO.title);
  assert.deepEqual(Object.keys(d.texts), ["hook", "desktop", "mobile", "cta"]);
  const ids = new Set(spec.acceptance.map((a) => a.id));
  for (const [slot, entry] of Object.entries(d.texts)) {
    assert.deepEqual(Object.keys(entry), ["criteria", "business", "technical"], slot);
    assert.ok(entry.criteria.every((id) => ids.has(id)), `${slot}: criteria exist in the spec`);
    for (const tone of ["business", "technical"]) assert.ok(typeof entry[tone] === "string" && entry[tone].length >= 5 && entry[tone].length <= 120 && !/[\r\n]/.test(entry[tone]), `${slot}.${tone}`);
  }
  assert.deepEqual([d.texts.hook.criteria, d.texts.desktop.criteria, d.texts.mobile.criteria, d.texts.cta.criteria], [["AC-1"], ["AC-7"], ["AC-1", "AC-6"], []]);
  assert.equal(d.variant.platformKey, "shorts_9x16");
  assert.deepEqual(Object.keys(d.variant.overrides), ["hookText", "ctaText"]);
  assert.deepEqual(Object.keys(d.variant), ["platformKey", "overrides"]);
  for (const text of Object.values(d.variant.overrides)) assert.ok(typeof text === "string" && text.length >= 3 && text.length <= 120);
  assert.ok(d.variant.overrides.hookText.length < d.texts.hook.business.length, "the vertical hook is shorter");
  assert.ok(d.variant.overrides.ctaText.length < d.texts.cta.business.length, "the vertical CTA is shorter");
  assert.equal(d.evidenceNote, "interval ocupat pe telefon");
  assert.match(d.exportPrefix, /^[a-z0-9][a-z0-9-]{1,30}$/);
  assert.equal(d.exportPrefix, "demo-programari");
  assert.deepEqual(Object.keys(BOOKING_DEMO.delivery), ["noun", "issue", "proofSelector", "bannerSelector", "evidenceNote", "exportPrefix", "variant", "presentations"]);
  // The owner-facing texts never promise a price, a term or a contact, and "phone" is always a width, not a device.
  const ownerTexts = JSON.stringify([BOOKING_DEMO.title, BOOKING_DEMO.objective, spec.acceptance.map((a) => a.text), d]);
  assert.doesNotMatch(ownerTexts, /\b(?:lei|ron|eur|euro|gratuit|reducere|garant\w*|zile lucrătoare)\b|€|\d+\s*%/i);
  assert.doesNotMatch(ownerTexts, /[şţŞŢ]/);
  assert.match(spec.acceptance.find((a) => a.id === "AC-6").text, /lățimea unui telefon \(390 px în Chromium\)/);
});

test("M11-FX-08 server API: 201 + list, 409 overlap, 400 past/invalid with field errors, persistence across restart, only local and same-origin requests", async (t) => {
  const dir = copyFixture("api");
  const { startServer, createApp, HOST } = await importApp(dir);
  assert.equal(HOST, "127.0.0.1");
  const dbPath = path.join(dir, "data", "bookings.db");
  for (const port of [-1, 70000, 1.5, "4620", undefined]) await assert.rejects(startServer({ port, dbPath }), TypeError, `port ${port}`);
  assert.throws(() => createApp({}), TypeError);
  assert.ok(!fs.existsSync(dbPath), "a refused start creates nothing");
  let server = await startServer({ port: 0, dbPath, now: NOON });
  t.after(() => server.close());
  assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
  assert.notEqual(server.port, 4620, "tests never use the preview port");

  const catalog = await getJson(server.url, "/api/services");
  assert.equal(catalog.status, 200);
  assert.deepEqual(catalog.json.services, [{ id: "spalare-exterior", name: "Spălare exterioară", durationMin: 30 }, { id: "curatare-interior", name: "Curățare interior", durationMin: 60 }, { id: "polish-faruri", name: "Polish faruri", durationMin: 30 }]);
  assert.deepEqual(catalog.json.days, [{ day: 0, date: D0, label: "Azi" }, { day: 1, date: D1, label: "Mâine" }, { day: 2, date: D2, label: "Poimâine" }]);

  const slots = await getJson(server.url, `/api/slots?date=${D1}&service=spalare-exterior`);
  assert.equal(slots.status, 200);
  assert.equal(slots.json.slots.length, 16);
  assert.deepEqual([slots.json.slots[0], slots.json.slots.at(-1)], [{ start: `${D1}T09:00`, time: "09:00", status: "free" }, { start: `${D1}T16:30`, time: "16:30", status: "free" }]);
  assert.deepEqual(slots.json.slots.filter((s) => s.status === "booked").map((s) => s.time), ["10:00", "11:30", "12:00", "15:00"], "the three synthetic bookings (one of 60 minutes)");
  assert.equal(slots.json.slots.filter((s) => s.status === "free").length, 12);
  const today = await getJson(server.url, `/api/slots?date=${D0}&service=spalare-exterior`);
  assert.deepEqual(today.json.slots.filter((s) => s.status === "past").map((s) => s.time), ["09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00"]);

  // 201 + list + the slot becomes booked.
  const created = await postBooking(server.url, valid({ name: "  Client   Test  " }));
  assert.equal(created.status, 201, created.text);
  assert.deepEqual(Object.keys(created.json.booking).sort(), ["date", "endTime", "id", "name", "seed", "service", "serviceId", "start", "time", "vehicle"]);
  assert.deepEqual({ ...created.json.booking, id: "x" }, { id: "x", serviceId: "spalare-exterior", service: "Spălare exterioară", date: D1, start: `${D1}T13:00`, time: "13:00", endTime: "13:30", name: "Client Test", vehicle: "Autoturism test", seed: false });
  const list = await getJson(server.url, `/api/bookings?date=${D1}`);
  assert.deepEqual(list.json.bookings.map((b) => [b.time, b.name, b.seed]), [["10:00", "Client Demo A", true], ["11:30", "Client Demo B", true], ["13:00", "Client Test", false], ["15:00", "Client Demo C", true]]);
  assert.ok(list.json.bookings.every((b) => b.seed === false || b.vehicle === "Autoturism test"));

  // 409: the same slot, a seeded slot, and a longer service that would run into a booking. Nothing is saved.
  for (const body of [valid({ name: "Alt Client" }), valid({ start: `${D1}T10:00` }), valid({ serviceId: "curatare-interior", start: `${D1}T12:30` }), valid({ serviceId: "curatare-interior", start: `${D1}T09:30` })]) {
    const refused = await postBooking(server.url, body);
    assert.equal(refused.status, 409, `${body.serviceId} ${body.start}: ${refused.text}`);
    assert.equal(refused.json.error, "Intervalul tocmai a fost ocupat");
  }
  // Touching intervals are not an overlap: 60 minutes ending exactly where a booking starts.
  assert.equal((await postBooking(server.url, valid({ serviceId: "curatare-interior", start: `${D1}T14:00`, name: "Client Lipit" }))).status, 201);

  // 400: a past slot, a slot off the grid, a day that is not shown, invalid fields, an address-like value, not JSON.
  const past = await postBooking(server.url, valid({ start: `${D0}T12:00` }));
  assert.equal(past.status, 400);
  assert.equal(past.json.errors.start, "Intervalul a trecut deja");
  assert.equal((await postBooking(server.url, valid({ start: `${D0}T12:30`, name: "Client Azi" }))).status, 201, "a later slot of today is still bookable");
  const bad = await postBooking(server.url, { serviceId: "altceva", start: `${D1}T09:10`, name: "A", vehicle: "x".repeat(61) });
  assert.equal(bad.status, 400);
  assert.deepEqual(Object.keys(bad.json.errors).sort(), ["name", "serviceId", "start", "vehicle"]);
  for (const start of [`${D3}T09:00`, "2030-01-13T09:00", `${D1}T17:00`, `${D1}T08:30`, `${D1} 09:00`, "", null, 5]) assert.equal((await postBooking(server.url, valid({ start }))).status, 400, `start ${start}`);
  const address = await postBooking(server.url, valid({ start: `${D1}T16:00`, name: "client@example.com" }));
  assert.equal(address.status, 400);
  assert.match(address.json.errors.name, /fictiv/);
  for (const raw of ["{nu e json", "[]", "null", "\"text\""]) assert.equal((await postBooking(server.url, raw)).status, 400, raw);
  assert.equal((await request(server.url, { method: "POST", path: "/api/bookings", headers: { "Content-Type": "text/plain" }, body: JSON.stringify(valid({ start: `${D1}T16:00` })) })).status, 415);
  assert.equal((await postBooking(server.url, JSON.stringify({ ...valid({ start: `${D1}T16:00` }), pad: "x".repeat(20000) }))).status, 413);
  for (const target of [`/api/slots?date=nu&service=spalare-exterior`, `/api/slots?date=${D1}&service=altceva`, `/api/slots?date=${D3}&service=spalare-exterior`, `/api/slots`, `/api/bookings?date=2030-02-30`, `/api/bookings`]) {
    assert.equal((await getJson(server.url, target)).status, 400, target);
  }
  // A page of another origin cannot post; another host name gets nothing; unknown methods and paths are refused.
  assert.equal((await postBooking(server.url, valid({ start: `${D1}T16:00` }), { Origin: "http://evil.example" })).status, 403);
  assert.equal((await postBooking(server.url, valid({ start: `${D1}T16:00` }), { Origin: "null" })).status, 403);
  assert.equal((await request(server.url, { path: "/", headers: { Host: "evil.example" } })).status, 400);
  assert.equal((await request(server.url, { method: "DELETE", path: "/api/bookings" })).status, 405);
  assert.equal((await request(server.url, { method: "POST", path: "/api/slots", body: "{}" })).status, 405);
  assert.equal((await request(server.url, { method: "PUT", path: "/styles.css", body: "x" })).status, 405);
  // None of the refused requests saved anything; a same-origin post works.
  const sameOrigin = await postBooking(server.url, valid({ start: `${D1}T16:00`, name: "Client Origine" }), { Origin: server.url.slice(0, -1) });
  assert.equal(sameOrigin.status, 201, sameOrigin.text);
  const after = await getJson(server.url, `/api/bookings?date=${D1}`);
  assert.deepEqual(after.json.bookings.filter((b) => !b.seed).map((b) => [b.time, b.name]), [["13:00", "Client Test"], ["14:00", "Client Lipit"], ["16:00", "Client Origine"]]);

  // Persistence across a restart: same file, a new process-like instance; the seeds are not doubled.
  await server.close();
  server = await startServer({ port: 0, dbPath, now: NOON });
  const again = await getJson(server.url, `/api/bookings?date=${D1}`);
  assert.deepEqual(again.json.bookings.map((b) => [b.time, b.name]), after.json.bookings.map((b) => [b.time, b.name]));
  assert.equal(again.json.bookings.filter((b) => b.seed).length, 3);
  assert.equal((await getJson(server.url, `/api/slots?date=${D1}&service=spalare-exterior`)).json.slots.find((s) => s.time === "13:00").status, "booked");
  assert.equal((await postBooking(server.url, valid())).status, 409, "still booked after the restart");
});

test("M11-FX-09 the synthetic seeds are re-established per day, idempotently, across a simulated midnight; a seed never overlaps an existing booking", async (t) => {
  const dir = copyFixture("seeds");
  const { startServer } = await importApp(dir);
  const dbPath = path.join(dir, "data", "bookings.db");
  let clock = new Date(2030, 0, 14, 23, 50, 0);
  let server = await startServer({ port: 0, dbPath, now: () => clock });
  t.after(() => server.close());
  const seedsOf = async (date) => (await getJson(server.url, `/api/bookings?date=${date}`)).json.bookings.filter((b) => b.seed).map((b) => `${b.time} ${b.serviceId} ${b.name} ${b.vehicle}`);
  const SEEDS = ["10:00 spalare-exterior Client Demo A Autoturism test", "11:30 curatare-interior Client Demo B Autoturism test", "15:00 polish-faruri Client Demo C Autoturism test"];
  for (let round = 0; round < 3; round += 1) for (const date of [D0, D1, D2]) assert.deepEqual(await seedsOf(date), SEEDS, `${date}, round ${round}`);
  assert.equal((await getJson(server.url, `/api/slots?date=${D3}&service=spalare-exterior`)).status, 400, "the day after the last shown day is not available yet");
  assert.equal((await postBooking(server.url, valid({ start: `${D2}T09:00`, name: "Client Seara" }))).status, 201);

  // Ten minutes after midnight: day 0 is now 15 January and a new last day appears, already with its booked slots.
  clock = new Date(2030, 0, 15, 0, 10, 0);
  assert.deepEqual((await getJson(server.url, "/api/services")).json.days.map((d) => d.date), [D1, D2, D3]);
  const lastDay = await getJson(server.url, `/api/slots?date=${D3}&service=spalare-exterior`);
  assert.equal(lastDay.status, 200);
  assert.deepEqual(lastDay.json.slots.filter((s) => s.status === "booked").map((s) => s.time), ["10:00", "11:30", "12:00", "15:00"]);
  for (let round = 0; round < 2; round += 1) for (const date of [D1, D2, D3]) assert.deepEqual(await seedsOf(date), SEEDS, `${date} after midnight, round ${round}`);
  assert.equal((await getJson(server.url, `/api/bookings?date=${D0}`)).status, 400, "yesterday is no longer shown");
  assert.deepEqual((await getJson(server.url, `/api/bookings?date=${D2}`)).json.bookings.filter((b) => !b.seed).map((b) => b.name), ["Client Seara"], "a booking made before midnight is kept");
  await server.close();

  // The stored rows: 4 days × 3 seeds, flagged synthetic = 1, plus the one booking; only the expected columns exist.
  const db = new DatabaseSync(dbPath);
  try {
    assert.deepEqual(db.prepare("SELECT day, COUNT(*) AS n FROM bookings WHERE synthetic = 1 GROUP BY day ORDER BY day").all().map((r) => [r.day, r.n]), [[D0, 3], [D1, 3], [D2, 3], [D3, 3]]);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM bookings WHERE synthetic = 0").get().n, 1);
    assert.deepEqual(db.prepare("PRAGMA table_info(bookings)").all().map((c) => c.name), ["id", "service_id", "day", "start_min", "end_min", "name", "vehicle", "synthetic", "created_at"]);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM bookings a JOIN bookings b ON a.day = b.day AND a.id < b.id AND a.start_min < b.end_min AND b.start_min < a.end_min").get().n, 0, "no two bookings overlap");
  } finally { db.close(); }

  // A seed gives way to whatever already occupies its interval (here: a booking saved while seeding was off).
  const other = path.join(dir, "data", "seed-guard.db");
  server = await startServer({ port: 0, dbPath: other, now: NOON, seed: false });
  assert.deepEqual((await getJson(server.url, `/api/bookings?date=${D1}`)).json.bookings, [], "seed: false starts empty");
  assert.equal((await postBooking(server.url, valid({ serviceId: "curatare-interior", start: `${D1}T09:30`, name: "Client Devreme" }))).status, 201);
  await server.close();
  server = await startServer({ port: 0, dbPath: other, now: NOON });
  assert.deepEqual((await getJson(server.url, `/api/bookings?date=${D1}`)).json.bookings.map((b) => [b.time, b.name, b.seed]),
    [["09:30", "Client Devreme", false], ["11:30", "Client Demo B", true], ["15:00", "Client Demo C", true]], "the 10:00 seed is skipped: 09:30–10:30 is taken");
});

test("M11-FX-10 static files: only the four allowed paths are served; traversal and every other file are refused; no Hub header; reachable on loopback only", async (t) => {
  const dir = copyFixture("static");
  const { startServer } = await importApp(dir);
  const server = await startServer({ port: 0, dbPath: path.join(dir, "data", "bookings.db"), now: NOON });
  t.after(() => server.close());
  const allowed = { "/": ["text/html; charset=utf-8", "public/index.html"], "/styles.css": ["text/css; charset=utf-8", "public/styles.css"],
    "/js/app.mjs": ["text/javascript; charset=utf-8", "public/js/app.mjs"], "/js/slots-view.mjs": ["text/javascript; charset=utf-8", "public/js/slots-view.mjs"] };
  for (const [target, [type, file]] of Object.entries(allowed)) {
    const res = await request(server.url, { path: target });
    assert.equal(res.status, 200, target);
    assert.equal(res.headers["content-type"], type);
    assert.equal(lf(res.text), readFixture(file), `${target} is ${file}`);
    assert.equal(res.headers["cache-control"], "no-store");
    assert.equal(res.headers["x-content-type-options"], "nosniff");
    assert.match(res.headers["content-security-policy"], /default-src 'self'/);
    const head = await request(server.url, { method: "HEAD", path: target });
    assert.deepEqual([head.status, head.text], [200, ""]);
  }
  assert.equal((await request(server.url, { path: "/?x=1" })).status, 200, "a query does not change the file");
  const refused = ["/index.html", "/server.js", "/config.json", "/package.json", "/README.md", "/src/server-app.js", "/src/catalog.js", "/test/acceptance.test.mjs", "/data/bookings.db",
    "/js", "/js/", "/js/app.mjs/", "/styles.css/", "/public/index.html", "/.gitignore", "/favicon.ico",
    "/js/../../server.js", "/js/..%2f..%2fserver.js", "/js/%2e%2e/%2e%2e/server.js", "/..%5cserver.js", "/js/..\\..\\server.js", "/%2e%2e/config.json", "/js/app.mjs%00.png", "/JS/APP.MJS",
    "//styles.css", "//evil.example/styles.css", "/styles.css#/../../server.js", "/./styles.css", "/js/./app.mjs", "/__proto__", "/constructor"];
  for (const target of refused) {
    const res = await request(server.url, { path: target });
    assert.equal(res.status, 404, `${target} → ${res.status}`);
    assert.ok(!res.text.includes("createApp") && !res.text.includes("4620"), `${target} leaks no file content`);
  }
  // Not a Hub: the capture guard's probe (GET / and /api/session) must see no Hub header.
  for (const target of ["/", "/api/session"]) {
    const res = await request(server.url, { path: target });
    assert.equal(res.headers["x-hub-version"], undefined);
    assert.equal(res.headers["x-hub-contract"], undefined);
  }
  assert.equal((await request(server.url, { path: "/api/session" })).status, 404);

  // Loopback only: 127.0.0.1 answers; the IPv6 loopback and the machine's own LAN address do not.
  assert.equal(await canConnect("127.0.0.1", server.port), true);
  assert.equal(await canConnect("::1", server.port), false, "not listening on the IPv6 wildcard/loopback");
  const lan = externalIPv4();
  if (lan) assert.equal(await canConnect(lan, server.port), false, "not reachable through the network interface");
  else t.diagnostic("no external IPv4 interface: the LAN-address check was not possible on this machine");
  assert.match(readFixture("src/server-app.js"), /server\.listen\(port, HOST, /);
});

test("M11-FX-11 `node server.js` (the approved preview command) serves on 127.0.0.1 at the config.json port, keeps its data in data/, and refuses a taken or invalid port", async () => {
  const dir = copyFixture("preview");
  const port = await freePort();
  fs.writeFileSync(path.join(dir, "config.json"), `${JSON.stringify({ port })}\n`); // what materializeFixture writes for a port override
  const env = { ...process.env, NODE_ENV: "development" };
  delete env.NODE_TEST_CONTEXT;
  const startPreview = (cwd) => {
    const child = spawn(process.execPath, ["server.js"], { cwd, env, windowsHide: true });
    const out = { stdout: "", stderr: "" };
    child.stdout.on("data", (chunk) => { out.stdout += chunk; });
    child.stderr.on("data", (chunk) => { out.stderr += chunk; });
    const exited = new Promise((resolve) => child.once("exit", (code) => resolve(code)));
    return { child, out, exited };
  };
  const waitUntil = async (predicate, what) => { for (let i = 0; i < 200; i += 1) { if (await predicate()) return; await new Promise((r) => setTimeout(r, 50)); } assert.fail(`timeout: ${what}`); };

  const first = startPreview(dir);
  try {
    await waitUntil(() => first.out.stdout.includes(`http://127.0.0.1:${port}/`), `the preview prints its URL (${first.out.stderr.slice(0, 300)})`);
    const base = `http://127.0.0.1:${port}/`;
    const page = await request(base, { path: "/" });
    assert.equal(page.status, 200);
    assert.match(page.text, /<title>Programări detailing — demo<\/title>/, "the title the Hub's preview probe records");
    const days = (await getJson(base, "/api/services")).json.days;
    assert.deepEqual(days.map((d) => d.date), [0, 1, 2].map((n) => { const d = new Date(); return dateKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, 12)); }), "the real clock: today and the next two days");
    const slots = (await getJson(base, `/api/slots?date=${days[1].date}&service=spalare-exterior`)).json.slots;
    assert.deepEqual(slots.filter((s) => s.status === "booked").map((s) => s.time), ["10:00", "11:30", "12:00", "15:00"], "tomorrow already has its synthetic bookings");
    assert.ok(fs.existsSync(path.join(dir, "data", "bookings.db")), "the database is in data/ (ignored by the spec and by git)");
    assert.deepEqual(walk(dir).filter((rel) => !rel.startsWith("data/")), FIXTURE_FILES, "nothing is written outside data/");
    const lan = externalIPv4();
    if (lan) assert.equal(await canConnect(lan, port), false);

    // A second preview on the same port stops with a clear message instead of serving next to the first.
    const second = startPreview(dir);
    assert.equal(await second.exited, 1);
    assert.match(second.out.stderr, new RegExp(`Demo-ul nu a pornit: portul ${port} este ocupat`));
  } finally {
    first.child.kill();
    await first.exited;
  }
  for (const bad of [{ port: 80 }, { port: "4620" }, { port: 70000 }, {}]) {
    fs.writeFileSync(path.join(dir, "config.json"), `${JSON.stringify(bad)}\n`);
    const run = startPreview(dir);
    assert.equal(await run.exited, 1, JSON.stringify(bad));
    assert.match(run.out.stderr, /config\.json: „port” trebuie să fie un număr întreg între 1024 și 65535/);
  }
});

test("M11-FX-12 no price, deadline, phone or e-mail anywhere: not in the code or the page, not as a field, not in the API, not in the database", async (t) => {
  const MONEY = /\bpre[țt](?:ul|uri|urile|urilor)?\b|\bpric(?:e|es|ing)\b|\btarif\w*|\bcost\w*|\b(?:lei|ron|eur|euro|usd)\b|[€$£]\s*\d|\d\s*[€$£]|\bTVA\b/i;
  const TERM = /\btermen\w*|\bdeadline\w*|\bscaden\w*|\bzile lucrătoare\b/i;
  const CONTACT = /\btelefon\w*|\bphone\w*|\bmobil(?:ul)? de contact\b|\btel\b|\be-?mail\w*|\bsms\b|\bwhatsapp\b|type=["']?(?:tel|email)/i;
  const ADDRESS = /[\w.+-]+@[\w-]+\.[\w.-]+/;
  const PHONE_NUMBER = /(?:\+|\b0)\d[\d\s.-]{7,}\d\b/;
  const USER_PATH = /[A-Za-z]:\\Users\\|\/home\/\w|\/Users\/\w/;
  const runtime = FIXTURE_FILES.filter((rel) => rel !== "README.md" && !rel.startsWith("test/"));
  for (const rel of runtime) {
    const text = readFixture(rel);
    for (const [label, re] of [["price", MONEY], ["deadline", TERM], ["contact", CONTACT]]) assert.doesNotMatch(text, re, `${rel}: ${label} word`);
  }
  // The README and the tests may SAY there are no prices, but hold no amount, address, number or personal path either.
  for (const rel of FIXTURE_FILES) {
    const text = readFixture(rel);
    assert.doesNotMatch(text, ADDRESS, `${rel}: an address`);
    assert.doesNotMatch(text, PHONE_NUMBER, `${rel}: a phone-like number`);
    assert.doesNotMatch(text, USER_PATH, `${rel}: a personal path`);
    assert.doesNotMatch(text, /[€$£]\s*\d|\d\s*(?:lei|ron|eur|euro)\b/i, `${rel}: an amount`);
  }
  // The form has exactly two text fields.
  const html = readFixture("public/index.html");
  assert.deepEqual([...html.matchAll(/<input\b[^>]*\bname="([^"]+)"[^>]*>/g)].map((m) => m[1]), ["name", "vehicle"]);
  assert.deepEqual([...html.matchAll(/<(?:textarea|select)\b/g)].length, 0);
  // The API and the stored rows carry only the specified fields.
  const dir = copyFixture("fields");
  const { startServer } = await importApp(dir);
  const dbPath = path.join(dir, "data", "bookings.db");
  const server = await startServer({ port: 0, dbPath, now: NOON });
  t.after(() => server.close());
  const services = (await getJson(server.url, "/api/services")).json;
  for (const service of services.services) assert.deepEqual(Object.keys(service).sort(), ["durationMin", "id", "name"]);
  const created = await postBooking(server.url, { ...valid(), price: 100, phone: "0700000000", email: "a@example.com", deadline: "mâine" });
  assert.equal(created.status, 201, "unknown fields are ignored, never stored");
  const everything = JSON.stringify([services, (await getJson(server.url, `/api/slots?date=${D1}&service=spalare-exterior`)).json, (await getJson(server.url, `/api/bookings?date=${D1}`)).json, created.json]);
  for (const [label, re] of [["price", MONEY], ["deadline", TERM], ["contact", CONTACT], ["address", ADDRESS]]) assert.doesNotMatch(everything, re, `API: ${label}`);
  assert.ok(!everything.includes("0700000000"));
  await server.close();
  const db = new DatabaseSync(dbPath);
  try {
    const dump = JSON.stringify(db.prepare("SELECT * FROM bookings").all());
    assert.ok(!/0700000000|example\.com|"price"|"phone"|"email"|"deadline"/.test(dump), "nothing but the specified columns is stored");
  } finally { db.close(); }
});

// ---------- registration (shared files; done after the M10.2 probe) ----------
const registered = Boolean(FACTORY_DEMOS["booking-demo"]);
const pending = registered ? false : "PENDING_SHARED_EDIT: fixtures.mjs does not register booking-demo yet (see M11_DESIGN.md, working rules)";

test("M11-FX-13 registered: FACTORY_DEMOS['booking-demo'] is BOOKING_DEMO, materializeFixture copies it and writes data: 'synthetic', demoSpec honours a port override", { skip: pending }, () => {
  assert.equal(FACTORY_DEMOS["booking-demo"], BOOKING_DEMO);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ifrim-m11-materialize-"));
  made.push(root);
  const dir = path.join(root, BOOKING_DEMO.dirName);
  const marker = materializeFixture("booking-demo", dir, { port: 4733 });
  assert.equal(marker.data, "synthetic");
  assert.deepEqual([marker.createdBy, marker.purpose, marker.fixture, marker.name], ["ifrim-agent-hub", "live-validation", "booking-demo", BOOKING_DEMO.name]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, ".ifrim-hub-test.json"), "utf8")).data, "synthetic");
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, "config.json"), "utf8")), { port: 4733 });
  assert.deepEqual(walk(dir).filter((rel) => rel !== ".ifrim-hub-test.json"), FIXTURE_FILES);
  assert.throws(() => materializeFixture("booking-demo", dir), /already exists/, "a fixture never overwrites a folder");
  const input = demoSpec("booking-demo", { port: 4733 });
  assert.equal(input.spec.verification.preview.url, "http://127.0.0.1:4733/");
  assert.deepEqual(checkSpec({ workType: input.workType, title: input.title, objective: input.objective, ...input.spec }, { hubPorts: [8011, 8012] }).problems, []);
  // The older demos carry no data kind: only a fixture that declares synthetic data gets the marker field.
  assert.equal(FACTORY_DEMOS["bug-demo"].data, undefined);
});

test("M11-FX-14 registered: create-factory-fixture maps booking-demo to its own folder and check file (no fall-through to demo-b)", { skip: pending }, () => {
  const script = fs.readFileSync(path.join(HUB_ROOT, "v2", "scripts", "create-factory-fixture.mjs"), "utf8");
  assert.match(script, /ifrim-delivery-demo-detailing|\.dirName\b/, "the folder comes from DIR_MAP or from the demo's dirName");
  assert.match(script, /CHECK_FILE|\.checkFile\b/, "the syntax-checked file comes from CHECK_FILE or from the demo's checkFile");
  assert.doesNotMatch(script, /fixture === "bug-demo" \? "ifrim-factory-demo-a" : "ifrim-factory-demo-b"/, "the binary choice is gone");
  assert.match(script, /already exists/, "an existing folder is still refused");
});

// ---------- the consumer of the delivery block (delivery/template.mjs, another M11 unit; inert until it is wired) ----------
const templateFile = path.join(HUB_ROOT, "v2", "server", "delivery", "template.mjs");
const template = fs.existsSync(templateFile) ? await import(pathToFileURL(templateFile).href).catch(() => null) : null;
const noConsumer = template && typeof template.normalizeDeliveryBlock === "function" && typeof template.captureScriptFrom === "function"
  ? false : "PENDING_UNIT: delivery/template.mjs (normalizeDeliveryBlock, captureScriptFrom) is not in the tree yet";

test("M11-FX-15 the delivery block and the approved steps are accepted by delivery/template.mjs: no problem, one capture script per width, no blocker", { skip: noConsumer }, () => {
  const { block, problems } = template.normalizeDeliveryBlock(BOOKING_DEMO.delivery);
  assert.deepEqual(problems, []);
  const d = BOOKING_DEMO.delivery;
  assert.deepEqual([block.noun, block.issue, block.proofSelector, block.bannerSelector, block.evidenceNote, block.exportPrefix], [d.noun, d.issue, d.proofSelector, d.bannerSelector, d.evidenceNote, d.exportPrefix]);
  assert.deepEqual(block.presentations, JSON.parse(JSON.stringify(BOOKING_DEMO.delivery.presentations)), "the presentations are already normalized");
  assert.deepEqual(block.variant, JSON.parse(JSON.stringify(d.variant)));
  const spec = approvedSpec();
  for (const [id, role, viewport, note] of [["AC-7", "desktop", { width: 1280, height: 720 }, "programare desktop"], ["AC-6", "mobile", { width: 390, height: 844 }, "programare mobil"]]) {
    const script = template.captureScriptFrom(spec.acceptance.find((a) => a.id === id).steps, { noun: block.noun, role, proofSelector: block.proofSelector });
    assert.equal(script.ok, true, JSON.stringify(script.blockers));
    assert.deepEqual(script.blockers, []);
    assert.deepEqual(script.viewport, viewport);
    assert.equal(script.demoNote, note);
    assert.deepEqual(script.steps[0], { goto: "/" });
    assert.ok(script.steps.some((step) => step.waitFor === d.proofSelector), "the proof is the confirmed booking");
    // What the capture types is synthetic and passes the fixture's own validation (2–60 characters, no „@”).
    const typed = script.steps.filter((step) => step.type).map((step) => [step.type.selector, step.type.text]);
    assert.deepEqual(typed, [["input[name='name']", "Client Demo Prezentare"], ["input[name='vehicle']", "Autoturism test"]]);
    assert.ok(typed.every(([, text]) => text.length >= 2 && text.length <= 60 && !text.includes("@")));
  }
});
