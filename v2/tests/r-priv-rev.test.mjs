// R-PRIV and R-REV (corrections after M11). R-PRIV: the §25 demo's explicit revision — the phone stays required and saved, but the
// public list of the day neither shows nor sends it. The Hub side (criteria derived from the owner's authorized sentence, routing of the
// sentence to a software revision, the earlier Hub test that read the phone from the public list superseded — kept unchanged, never
// rewritten) and, on a COPY of the §25 app (tests/fixtures/r-priv-booking, synthetic), the checks those criteria call for, run against
// the app as it is today and against correct and wrong variants (the variants stand for possible implementations; the real one is
// Codex's, through the Software Factory, after the owner confirms the card). R-REV: the Excel workbook of a refresh is kept only by proof.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { requestShape, deriveCriteria, conflictingHubTests, withField, withoutField } from "../server/owner/planners/criteria.mjs";
import { classify } from "../server/delivery/revision.mjs";
import { checkSpec, specHash } from "../server/factory/spec.mjs";
import { retireSuperseded, restoreRetired } from "../server/factory/factory.mjs";
import { workbookReuse } from "../server/delivery/office-executors.mjs";
import { bookingsWorkbook } from "../server/office/demo-content.mjs";
import { buildXlsx } from "../server/office/xlsx.mjs";
import { browserLaunchOptions } from "../server/tools/browser-core.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const HUB_ROOT = path.resolve(here, "..", "..");
const FIXTURE = path.join(here, "fixtures", "r-priv-booking");
const AUTHORIZED = "Telefonul rămâne obligatoriu la programare și este salvat corect, dar lista publică a zilei nu afișează și nu transmite telefonul. Programările valide și fluxurile existente continuă să funcționeze.";
const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const tmp = (label) => fs.mkdtempSync(path.join(os.tmpdir(), `r-priv-${label}-`));

// ---------------------------------------------------------------------------------------------------------------------------
// Hub side: criteria, routing, supersession
// ---------------------------------------------------------------------------------------------------------------------------

const FLOW = { id: "AC-5", text: "Programare pe desktop", verify: "e2e", steps: [{ viewport: { width: 1280, height: 800 } }, { goto: "/" }, { click: "[data-slot]" },
  { fill: { selector: "[name='name']", value: "Client {run}" } }, { fill: { selector: "[name='vehicle']", value: "Autoturism test" } }, { click: "button[type=submit]" }, { expectText: "Programare confirmată" }] };

test("RP-11 two revision generations add the phone only once and the refusal flow removes it", () => {
  const field = { key: "phone", label: "Telefon", value: "0700 123 456" };
  const first = deriveCriteria({ words: "Telefonul devine obligatoriu la programare", flows: [FLOW] });
  const second = deriveCriteria({ words: AUTHORIZED, flows: first.flows });
  assert.deepEqual(second.flows[0].steps, first.flows[0].steps);
  assert.equal(second.flows[0].text, first.flows[0].text);
  for (const selector of ["input[name='phone']", 'input[name="phone"]']) {
    const steps = [...FLOW.steps.slice(0, -2), { fill: { selector, value: field.value } }, ...FLOW.steps.slice(-2)];
    const augmented = withField(steps, field);
    assert.equal(augmented.filter(s => s.fill?.selector === selector).length, 1);
    assert.equal(augmented.filter(s => s.expectLabel?.selector === selector).length, 1);
    assert.deepEqual(withField(augmented, field), augmented);
    assert.ok(!withoutField(augmented, field).some(s => s.fill?.selector === selector));
  }
});

test("RP-01 the authorized sentence is a hide_public request: two NEW checks (public list, anonymous parameters) and three „păstrare” checks, distinct, defined before any code", () => {
  const s = requestShape(AUTHORIZED);
  assert.equal(s.shape, "hide_public");
  assert.equal(s.field.key, "phone");
  assert.equal(s.keepsRequired, true);
  const d = deriveCriteria({ words: AUTHORIZED, flows: [FLOW] });
  const fresh = d.test.filter((c) => !c.guard), guards = d.test.filter((c) => c.guard);
  assert.equal(fresh.length, 2);
  assert.match(fresh[0].text, /Lista publică a zilei.*cerută direct de la server \(fără browser\).*ÎNTREGUL corp al răspunsului câmpul „phone” sau vreo valoare a lui.*inițializarea ei normală.*TOATE înregistrările zilei/);
  assert.match(fresh[1].text, /FIECARE parametru anonim.*includePhone=1.*phone=1.*fields=phone.*debug=1.*all=1.*rămâne funcțională.*prin id toate înregistrările relevante.*pornirea normală.*corpul integral „phone” sau vreo valoare a lui/);
  assert.equal(guards.length, 3);
  assert.match(guards[0].text, /refuzată de server.*proprietatea „phone” LIPSEȘTE din cerere.*șir gol.*doar spații.*fiecare refuz are o eroare pentru câmpul.*stocarea internă a aplicației e neschimbată după FIECARE refuz.*niciun rând adăugat sau modificat/);
  assert.match(guards[1].text, /stocarea internă a aplicației.*nu printr-o rută publică; nu se adaugă nicio rută anonimă/, "persistence is proven internally, never by a public read");
  assert.match(guards[2].text, /e în continuare acceptată/);
  assert.ok(d.test.every((c) => c.origin), "every criterion says where it comes from");
  // The browser: the inherited flow with the phone filled, then the value never appears on the page.
  assert.equal(d.browser.length, 1);
  assert.deepEqual(d.browser[0].steps.at(-1), { expectNoText: "0700 123 456" });
  assert.ok(d.browser[0].steps.some((st) => st.fill?.selector === "[name='phone']"));
  // The option belongs to the project (hidden by default), no CSS-only answer, no new login/admin, no anonymous re-read route.
  assert.ok(d.assumptions.some((a) => /aparține acestui proiect.*ascuns implicit.*nu adaug login, administrare sau roluri/.test(a)));
  assert.ok(d.assumptions.some((a) => /CSS nu e suficientă/.test(a)));
  assert.ok(d.constraints.some((c) => /Nu se adaugă nicio rută anonimă/.test(c)));
});

test("RP-02 the earlier shapes are unchanged: §25's own sentence is still required_field, a refusal is still refuse, an unrelated sentence generic", () => {
  assert.equal(requestShape("Butonul de programare trebuie să ceară și numărul de telefon").shape, "required_field");
  assert.equal(requestShape("Formularul să nu accepte un telefon gol").shape, "refuse");
  assert.equal(requestShape("Pagina publică să aibă un titlu mai mare").shape, "generic", "a public page without a hidden field is not hide_public");
  assert.equal(requestShape("Ascunde butonul de ștergere din lista publică").shape, "generic", "no known field named: the owner's words stay one criterion");
  // Review F4: a wish to SEE the field is the opposite request; a negated „obligatoriu” is no guard; the field is the one next to the verb.
  assert.equal(requestShape("Pagina publică nu afișează telefonul, vreau să apară").shape, "generic");
  assert.equal(requestShape("Lista publică nu arată telefonul, ar trebui să apară").shape, "generic");
  const notRequired = requestShape("Telefonul nu mai este obligatoriu, iar lista publică nu afișează telefonul");
  assert.equal(notRequired.shape, "hide_public"); assert.equal(notRequired.keepsRequired, false);
  assert.equal(deriveCriteria({ words: "Telefonul nu mai este obligatoriu, iar lista publică nu afișează telefonul" }).test.filter((c) => c.guard).length, 2, "no „still required” guard");
  const other = requestShape("Emailul e obligatoriu, dar lista publică nu afișează telefonul");
  assert.equal(other.field.key, "phone", "the field of the not-shown clause"); assert.equal(other.keepsRequired, false, "the email's „obligatoriu” is not the phone's");
});

test("RP-03 the sentence routes to a software revision with ALL its words (the „continuă să funcționeze” part is kept, not dropped)", () => {
  const r = classify(AUTHORIZED, {});
  assert.equal(r.status, "ROUTE_SOFTWARE");
  assert.match(r.software.request, /lista publică a zilei nu afișează și nu transmite telefonul/);
  assert.match(r.software.request, /Programările valide și fluxurile existente continuă să funcționeze/);
  assert.deepEqual(r.notes, []);
  // A sentence that only says what keeps working is not, by itself, a software request.
  assert.notEqual(classify("Programările valide continuă să funcționeze", {}).status, "ROUTE_SOFTWARE");
  // Review F4: a „rămâne la fel” about something else is not appended to the software request.
  const mixed = classify("Formularul trebuie să ceară și emailul. Titlul rămâne la fel", {});
  assert.equal(mixed.status, "ROUTE_SOFTWARE");
  assert.doesNotMatch(mixed.software.request, /Titlul/);
});

const OLD_TEST = (ref = "test/hub/butonul-de-programare-trebuie-sa-84f571.test.mjs") => {
  const text = fs.readFileSync(path.join(here, "fixtures", "r-priv-old-hub-test.mjs.txt"), "utf8");
  return { ref, sha256: sha(Buffer.from(text, "utf8")), text, missionId: "mis_mv1eo6il_104584123d", specVersion: 1 };
};

test("RP-04 the earlier Hub test that read the phone back from the app's answers is listed as superseded; one that only checks the refusal stays", () => {
  const field = requestShape(AUTHORIZED).field;
  const old = OLD_TEST();
  const refusalOnly = { ref: "test/hub/refuz-fara-telefon-aaaaaa.test.mjs", sha256: "b".repeat(64),
    text: "import assert from 'node:assert/strict';\nconst r = await httpPost(url, body);\nassert.equal(typeof r.body.errors.phone, 'string');\nconst g = await httpGet(url);\nassert.equal(g.body.bookings.length, 0);\n" };
  // Review F5: a value read only from the POST answer is compatible; a multi-line assert on a GET answer, bracket access or destructuring is not.
  const postOnly = { ref: "test/hub/creare-cu-telefon-bbbbbb.test.mjs", sha256: "d".repeat(64),
    text: "const created = await httpPost(url, body);\nassert.equal(created.body.booking.phone, '0712');\nconst g = await httpGet(url);\nassert.equal(g.body.bookings.length, 1);\n" };
  const multiline = { ref: "test/hub/lista-ccccc1.test.mjs", sha256: "e".repeat(64), text: "const list = await httpGet(url);\nassert.deepEqual(\n  list.body.bookings[0]\n    .phone,\n  '0712');\n" };
  const bracket = { ref: "test/hub/lista-ccccc2.test.mjs", sha256: "f".repeat(64), text: "const res = await fetch(url);\nconst data = await res.json();\nconst g = await fetch(`${base}/api/bookings`);\nassert.equal(g.bookings[0][\"phone\"], '1');\n" };
  assert.deepEqual(conflictingHubTests({ field, hubTests: [postOnly, multiline, bracket] }).map((x) => x.testRef), [multiline.ref, bracket.ref]);
  const out = conflictingHubTests({ field, hubTests: [old, refusalOnly, { ref: "test/acceptance.test.mjs", sha256: "c".repeat(64), text: old.text }] });
  assert.deepEqual(out.map((x) => x.testRef), [old.ref], "only Hub-written tests (test/hub/…), and only the one that reads the value");
  assert.equal(out[0].sha256, old.sha256);
  assert.equal(out[0].missionId, "mis_mv1eo6il_104584123d");
  assert.match(out[0].reason, /contractul anterior/);
});

test("RP-05 the spec carries `supersedes` only when present (other specs keep their hash) and refuses a non-Hub test, its own test, a missing sha or reason", () => {
  const base = { workType: "FEATURE", title: "Lista publică fără telefon", objective: AUTHORIZED, acceptance: [{ id: "AC-1", text: "Lista publică nu conține telefonul", verify: "test", testRef: "test/hub/telefonul-ramane-obligatoriu-abcdef.test.mjs" }],
    verification: { checks: ["node --test"], acceptance: ["node --test test/hub/telefonul-ramane-obligatoriu-abcdef.test.mjs"] } };
  const plain = checkSpec(base);
  assert.deepEqual(plain.problems, []);
  assert.equal(plain.spec.supersedes, undefined);
  assert.equal(specHash(checkSpec({ ...base, supersedes: null }).spec), specHash(plain.spec), "absent and null hash the same");
  const old = OLD_TEST();
  // Closure R-SUP (contract change, 2026-10-10): an entry now also needs its explicit contract difference; the pre-closure entry (identity
  // and reason only) is refused — kept here as the negative case, the accepted case below carries the contract.
  const preClosure = { testRef: old.ref, sha256: old.sha256, missionId: old.missionId, specVersion: 1, reason: "citește valoarea câmpului din lista publică" };
  assert.match(checkSpec({ ...base, supersedes: [preClosure] }).problems.join(" | "), /diferența explicită dintre contractul vechi și cel nou lipsește/);
  const contract = { field: "phone", previous: { missionId: old.missionId, specVersion: 1 }, publicRoutes: ["/api/bookings"],
    conflicts: [{ case: "AC-2", criterion: "telefonul se citește înapoi", routes: ["/api/bookings"], replacedBy: ["AC-1", "AC-2", "AC-3"] }], kept: [], internalReads: [] };
  const kinded = ["public_omits", "anon_params", "internal_persistence"].map((kind, i) => ({ ...base.acceptance[0], id: `AC-${i + 1}`, kind, ...(kind === "internal_persistence" ? { guard: true } : {}) }));
  const ok = checkSpec({ ...base, acceptance: kinded, supersedes: [{ ...preClosure, contract }] });
  assert.deepEqual(ok.problems, []);
  assert.equal(ok.spec.supersedes[0].testRef, old.ref);
  const bad = (supersedes, extra = {}) => checkSpec({ ...base, ...extra, supersedes }).problems.join(" | ");
  assert.match(bad([{ testRef: "test/acceptance.test.mjs", sha256: old.sha256, reason: "motiv suficient de lung" }]), /doar un test scris de Hub/);
  assert.match(bad([{ testRef: old.ref, sha256: "x", reason: "motiv suficient de lung" }]), /sha256 lipsește/);
  assert.match(bad([{ testRef: old.ref, sha256: old.sha256, reason: "" }]), /motivul incompatibilității lipsește/);
  assert.match(bad([]), /listă goală/);
  assert.match(bad([{ testRef: "test/hub/telefonul-ramane-obligatoriu-abcdef.test.mjs", sha256: old.sha256, reason: "motiv suficient de lung" }], { authoring: { mode: "hub", testRef: "test/hub/telefonul-ramane-obligatoriu-abcdef.test.mjs", stagingRef: ".ifrim-hub/staging/telefonul-ramane-obligatoriu-abcdef.mjs", criteria: ["AC-1"] } }), /nu se poate înlocui pe sine/);
});

test("RP-06 at the start the Hub moves the superseded test, byte for byte, out of the active suite into .ifrim-hub/retired/<mission>/ (idempotent; a changed file is refused)", () => {
  const dir = tmp("retire");
  try {
    const old = OLD_TEST();
    fs.mkdirSync(path.join(dir, "test", "hub"), { recursive: true });
    fs.writeFileSync(path.join(dir, old.ref), old.text);
    const spec = { supersedes: [{ testRef: old.ref, sha256: old.sha256, missionId: old.missionId, specVersion: 1, reason: "citește valoarea câmpului din lista publică" }] };
    const out = retireSuperseded("mis_new_0123456789", spec, { path: dir });
    assert.equal(out.length, 1);
    assert.equal(out[0].to, ".ifrim-hub/retired/mis_new_0123456789/butonul-de-programare-trebuie-sa-84f571.test.mjs.retired");
    assert.equal(fs.existsSync(path.join(dir, old.ref)), false, "no longer run by node --test");
    assert.equal(sha(fs.readFileSync(path.join(dir, out[0].to))), old.sha256, "kept unchanged");
    assert.equal(out[0].missionId, old.missionId, "linked to its original version");
    // A resumed start finds it already moved with the same bytes.
    assert.equal(retireSuperseded("mis_new_0123456789", spec, { path: dir }).length, 1);
    // A test that is not the one on the card is never moved.
    fs.writeFileSync(path.join(dir, "test", "hub", "alt-test-abcdef.test.mjs"), "// altceva\n");
    assert.throws(() => retireSuperseded("mis_other_0123456789", { supersedes: [{ testRef: "test/hub/alt-test-abcdef.test.mjs", sha256: old.sha256, reason: "motiv" }] }, { path: dir }), (e) => e.code === "SUPERSEDE_MISMATCH");
    assert.ok(fs.existsSync(path.join(dir, "test", "hub", "alt-test-abcdef.test.mjs")));
    // Review F3: a start that fails after the move puts the test back; an interrupted move (both copies) is finished, not stuck.
    restoreRetired(out, { path: dir });
    assert.equal(sha(fs.readFileSync(path.join(dir, old.ref))), old.sha256, "back in the active suite, unchanged");
    assert.equal(fs.existsSync(path.join(dir, out[0].to)), false);
    const again = retireSuperseded("mis_new_0123456789", spec, { path: dir });
    fs.copyFileSync(path.join(dir, again[0].to), path.join(dir, old.ref));
    assert.equal(retireSuperseded("mis_new_0123456789", spec, { path: dir }).length, 1, "both copies with the same bytes: the move is finished");
    assert.equal(fs.existsSync(path.join(dir, old.ref)), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------------------------------------------------------
// The checks the criteria call for, on a copy of the §25 app (today + correct and wrong variants)
// ---------------------------------------------------------------------------------------------------------------------------

/** A copy of the fixture app with `variant` applied to src/server-app.js. Returns { dir, mod }. */
async function appCopy(variant) {
  const dir = tmp(variant);
  fs.cpSync(FIXTURE, dir, { recursive: true });
  const file = path.join(dir, "src", "server-app.js");
  let s = fs.readFileSync(file, "utf8");
  const sub = (a, b) => { assert.ok(s.includes(a), `${variant}: anchor missing: ${a.slice(0, 60)}`); s = s.replace(a, b); };
  // The public list's projection without the phone, and the project's own option (server-side, hidden by default).
  const omit = () => {
    sub("export function createApp({ dbPath, now = () => new Date(), seed = true, publicDir = PUBLIC_DIR } = {}) {", "export function createApp({ dbPath, now = () => new Date(), seed = true, publicDir = PUBLIC_DIR, publicListPhone = false } = {}) {");
    sub("  function sendJson(req, res, status, body, extra = {}) {", "  const listBooking = (row) => { const { phone, ...rest } = publicBooking(row); return publicListPhone ? { ...rest, phone } : rest; };\n  function sendJson(req, res, status, body, extra = {}) {");
    sub("return sendJson(req, res, 200, { date: day.date, bookings: sql.ofDay.all(day.date).map(publicBooking) });", "return sendJson(req, res, 200, { date: day.date, bookings: sql.ofDay.all(day.date).map(PICK) });");
    sub("export async function startServer({ port, dbPath, now, seed } = {}) {", "export async function startServer({ port, dbPath, now, seed, publicListPhone } = {}) {");
    sub("const app = createApp({ dbPath, ...(now ? { now } : {}), ...(seed === undefined ? {} : { seed }) });", "const app = createApp({ dbPath, ...(now ? { now } : {}), ...(seed === undefined ? {} : { seed }), publicListPhone: publicListPhone === true });");
  };
  if (variant === "today") { /* the app as §25 delivered it */ }
  else if (variant === "correct") { omit(); s = s.replace("map(PICK)", "map(listBooking)"); }
  else if (variant === "css_only") { /* the server unchanged; only the page would hide the value */ }
  else if (variant === "include_param") { omit(); s = s.replace("map(PICK)", "map(query.get(\"includePhone\") === \"1\" ? publicBooking : listBooking)"); }
  else if (variant === "drop_storage") { omit(); s = s.replace("map(PICK)", "map(listBooking)"); sub("sql.insert.run(id, service.id, slot.date, slot.startMin, endMin, name, vehicle, phone, 0, at.toISOString());", "sql.insert.run(id, service.id, slot.date, slot.startMin, endMin, name, vehicle, \"\", 0, at.toISOString());"); }
  else if (variant === "refuse_all") { omit(); s = s.replace("map(PICK)", "map(listBooking)"); sub("if (!phone) errors.phone = \"Telefonul este obligatoriu\";", "if (!phone) errors.phone = \"Telefonul este obligatoriu\";\n    errors.start = \"Indisponibil\";"); }
  else if (variant === "not_required") { omit(); s = s.replace("map(PICK)", "map(listBooking)"); sub("if (!phone) errors.phone = \"Telefonul este obligatoriu\";", ""); }
  else throw new Error(variant);
  fs.writeFileSync(file, s);
  return { dir, mod: await import(pathToFileURL(file).href) };
}

function call(port, method, url, body = null) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({ hostname: "127.0.0.1", port, path: url, method, headers: data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {} }, (res) => {
      const parts = [];
      res.on("data", (c) => parts.push(c));
      res.on("end", () => { const text = Buffer.concat(parts).toString("utf8"); let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ } resolve({ status: res.statusCode, text, json }); });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

const CLOCK = () => new Date(2026, 9, 9, 8, 0);
const DAY = "2026-10-09";
const PHONE = "0799 000 111";
const SEED_PHONE = "0700 123 456";
const booking = (extra = {}) => ({ serviceId: "spalare-exterior", start: `${DAY}T09:00`, name: "Client Proba", vehicle: "Autoturism test", ...extra });
const hasPhone = (r) => /"phone"\s*:/.test(r.text) || r.text.includes(PHONE) || r.text.includes(SEED_PHONE);

/**
 * The derived criteria as checks (what the Hub-written acceptance test must establish), run in one fresh app: → { [criterion]: true | message }.
 * Persistence is read through the app's own storage (its sqlite file, after the server closed): no public or new route.
 */
async function criteriaChecks(mod, dir, options = {}) {
  const dbPath = path.join(fs.mkdtempSync(path.join(dir, "run-")), "bookings.db");
  const out = {};
  const srv = await mod.startServer({ port: 0, dbPath, now: CLOCK, seed: true, ...options });
  let createdId = null;
  try {
    const count = () => { const db = new DatabaseSync(dbPath, { readOnly: true }); try { return db.prepare("SELECT COUNT(*) AS n FROM bookings WHERE synthetic = 0").get().n; } finally { db.close(); } };
    // guard: required — refused without a phone or with spaces only, nothing saved
    const before = count();
    // Each attempt on its own free slot: a variant that wrongly accepts one never blocks the next check's slot.
    const a = await call(srv.port, "POST", "/api/bookings", booking({ start: `${DAY}T13:00` }));
    const b = await call(srv.port, "POST", "/api/bookings", booking({ start: `${DAY}T13:30`, phone: "   " }));
    out.required = a.status === 400 && b.status === 400 && typeof a.json?.errors?.phone === "string" && typeof b.json?.errors?.phone === "string" && count() === before || `refuz: ${a.status}/${b.status}`;
    // guard: a valid booking is accepted
    const c = await call(srv.port, "POST", "/api/bookings", booking({ phone: PHONE }));
    createdId = c.json?.booking?.id || null;
    out.accepted = c.status === 201 && Boolean(createdId) || `creare: ${c.status}`;
    // NEW: the public list carries neither the property nor the value (seeded and new bookings)
    const list = await call(srv.port, "GET", `/api/bookings?date=${DAY}`);
    out.publicList = list.status === 200 && list.json?.bookings?.length >= 1 && !hasPhone(list) || `lista: ${list.status}, telefon ${hasPhone(list) ? "prezent" : "absent"}`;
    // NEW: parameters anyone can add do not bring it back
    const params = ["includePhone=1", "phone=1", "fields=phone", "debug=1", "all=1", "includePhone=true&debug=1"];
    const leaks = [];
    for (const p of params) { const r = await call(srv.port, "GET", `/api/bookings?date=${DAY}&${p}`); if (r.status !== 200 || hasPhone(r)) leaks.push(p); }
    out.params = leaks.length === 0 || `parametri care îl aduc: ${leaks.join(", ")}`;
  } finally { await srv.close(); }
  // guard: kept exactly in the app's own storage (internal read, after the server closed)
  if (createdId) {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try { const row = db.prepare("SELECT phone FROM bookings WHERE id = ?").get(createdId); out.persisted = row?.phone === PHONE || `salvat: ${JSON.stringify(row?.phone)}`; } finally { db.close(); }
  } else out.persisted = "nicio programare creată";
  return out;
}
const failing = (r) => Object.entries(r).filter(([, v]) => v !== true).map(([k]) => k).sort();

test("RP-07 T-PRIV 1–3/5: today the two NEW checks fail and the guards pass; the correct variant passes all five; every wrong variant is rejected by the right check", async () => {
  const results = {};
  for (const v of ["today", "correct", "css_only", "include_param", "drop_storage", "refuse_all", "not_required"]) {
    const { dir, mod } = await appCopy(v);
    try { results[v] = await criteriaChecks(mod, dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
  assert.deepEqual(failing(results.today), ["params", "publicList"], JSON.stringify(results.today));
  assert.deepEqual(failing(results.correct), [], JSON.stringify(results.correct));
  assert.deepEqual(failing(results.css_only), ["params", "publicList"], "hiding in the page only: the server still sends the phone");
  assert.deepEqual(failing(results.include_param), ["params"], "an anonymous parameter must not bypass the omission");
  assert.deepEqual(failing(results.drop_storage), ["persisted"], "hiding by not saving loses the phone");
  assert.deepEqual(failing(results.refuse_all), ["accepted", "persisted"], "refusing everything is not hiding");
  assert.deepEqual(failing(results.not_required), ["required"], "the phone stays required");
});

test("RP-08 T-PRIV 6: the option belongs to one project's server configuration — another instance configured otherwise does not change it", async () => {
  const a = await appCopy("correct"), b = await appCopy("correct");
  try {
    const ra = await criteriaChecks(a.mod, a.dir);
    const rb = await criteriaChecks(b.mod, b.dir, { publicListPhone: true }); // a diagnostic, server-side, for synthetic data only
    assert.deepEqual(failing(ra), [], "project A: hidden by default");
    assert.deepEqual(failing(rb), ["params", "publicList"], "project B shows it only because ITS server was configured so");
    assert.deepEqual(failing(await criteriaChecks(a.mod, a.dir)), [], "A again, unaffected by B");
  } finally { for (const x of [a, b]) fs.rmSync(x.dir, { recursive: true, force: true }); }
});

test("RP-09 T-PRIV 7: the versioned fixture booking-demo has no phone and is untouched; the test fixture is a copy (the real §25 project is only read)", () => {
  const demo = path.join(HUB_ROOT, "v2", "fixtures", "factory", "booking-demo");
  const files = fs.readdirSync(path.join(demo, "src")).filter((n) => n.endsWith(".js"));
  assert.ok(files.length >= 1);
  for (const n of files) assert.doesNotMatch(fs.readFileSync(path.join(demo, "src", n), "utf8"), /\bphone\b/, `${n}: the versioned fixture is not the §25 app`);
  // Line endings normalized: a checkout with core.autocrlf may turn the copy's LF into CRLF.
  assert.equal(sha(Buffer.from(fs.readFileSync(path.join(FIXTURE, "src", "server-app.js"), "utf8").replace(/\r\n/g, "\n"), "utf8")),"5cd662956742cca906efa5581330052e745d3bc810722e6671d47d2964628f64", "the copy is the §25 app as delivered");
});

async function chromium(origin = "http://127.0.0.1:9") {
  try { const pw = createRequire(path.join(HUB_ROOT, "package.json"))("playwright"); const b = await pw.chromium.launch(browserLaunchOptions(origin)); return b; } catch { return null; }
}

test("RP-10 T-PRIV 4: in a real browser (desktop and phone width, with a refresh) the page works, the list the page receives has no phone and the DOM never holds it", { timeout: 120000 }, async (t) => {
  const probe = await chromium();
  if (!probe) { t.skip("SKIPPED_ENV: Playwright Chromium not available"); return; }
  await probe.close();
  const variants = {};
  {
    for (const v of ["today", "correct"]) {
      const { dir, mod } = await appCopy(v);
      const srv = await mod.startServer({ port: 0, dbPath: path.join(dir, "data", "bookings.db"), seed: true });
      // The browser may reach only this app's origin (the Hub's own browser policy).
      const browser = await chromium(new URL(srv.url).origin);
      try {
        const seen = [];
        for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
          const ctx = await browser.newContext({ viewport });
          const page = await ctx.newPage();
          const errors = [];
          page.on("pageerror", (e) => errors.push(String(e.message)));
          await page.goto(srv.url, { waitUntil: "load" });
          await page.reload({ waitUntil: "load" });
          const services = await page.evaluate(async () => (await fetch("/api/services")).json());
          const today = services.days[0].date;
          const r = await page.evaluate(async (d) => { const res = await fetch(`/api/bookings?date=${d}`); return { status: res.status, text: await res.text() }; }, today);
          const dom = await page.evaluate(() => document.documentElement.outerHTML);
          seen.push({ viewport: viewport.width, status: r.status, listHasPhone: /"phone"\s*:/.test(r.text) || r.text.includes(SEED_PHONE), domHasPhone: dom.includes(SEED_PHONE), errors: errors.length, slots: await page.locator("[data-slot], button").count() });
          await ctx.close();
        }
        variants[v] = seen;
      } finally { await browser.close(); await srv.close(); fs.rmSync(dir, { recursive: true, force: true }); }
    }
  }
  t.diagnostic(JSON.stringify(variants));
  assert.ok(variants.today.every((x) => x.listHasPhone), "today the page receives the phone (the check discriminates)");
  for (const x of variants.correct) {
    assert.equal(x.status, 200); assert.equal(x.errors, 0, "no page error"); assert.ok(x.slots > 0, "the page still renders its controls");
    assert.equal(x.listHasPhone, false, `${x.viewport}px: the list the page receives`); assert.equal(x.domHasPhone, false, `${x.viewport}px: the DOM`);
  }
});

// ---------------------------------------------------------------------------------------------------------------------------
// R-REV: the Excel workbook of a refresh, kept only by proof
// ---------------------------------------------------------------------------------------------------------------------------

test("RR-01 T-REV 1/2: the workbook is kept only when the file is unchanged AND the generator on today's data rebuilds the same bytes; otherwise it is regenerated", () => {
  const dir = tmp("wb");
  try {
    const createdAt = "2026-10-09T16:24:10.125Z";
    const file = path.join(dir, "Programari demo.xlsx");
    const buf = buildXlsx(bookingsWorkbook().model, { created: new Date(createdAt) });
    fs.writeFileSync(file, buf);
    const plan = (over = {}) => ({ steps: [{ kind: "delivery.office.workbook", status: "DONE", result: { file, sha256: sha(buf), level: "APP_VERIFIED", ...over } }] });
    const ok = workbookReuse({ source: { id: "dlv_source_0123456789", createdAt }, sourcePlan: plan() });
    assert.equal(ok.ok, true, JSON.stringify(ok));
    assert.equal(ok.reuse.sha256, sha(buf));
    assert.match(ok.reuse.inputsSha, /^[0-9a-f]{64}$/);
    assert.equal(ok.reuse.sourceDeliveryId, "dlv_source_0123456789");
    assert.match(ok.reuse.reason, /aceleași date și același generator/);
    // Same inputs, same bytes: a second proof gives the same record (a repeated or resumed refresh never doubles anything).
    assert.deepEqual(workbookReuse({ source: { id: "dlv_source_0123456789", createdAt }, sourcePlan: plan() }), ok);
    // The inputs changed (here: the generator would date the file differently) → no reuse.
    assert.equal(workbookReuse({ source: { id: "dlv_source_0123456789", createdAt: "2026-10-10T00:00:00.000Z" }, sourcePlan: plan() }).code, "INPUTS_CHANGED");
    assert.equal(workbookReuse({ source: { id: "dlv_source_0123456789", createdAt }, sourcePlan: { steps: [] } }).code, "NO_PARENT_WORKBOOK");
    fs.appendFileSync(file, "x");
    assert.equal(workbookReuse({ source: { id: "dlv_source_0123456789", createdAt }, sourcePlan: plan() }).code, "FILE_CHANGED", "someone edited the file");
    fs.rmSync(file);
    assert.equal(workbookReuse({ source: { id: "dlv_source_0123456789", createdAt }, sourcePlan: plan() }).code, "FILE_MISSING");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
