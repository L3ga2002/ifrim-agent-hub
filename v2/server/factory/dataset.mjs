import fs from "node:fs";
import path from "node:path";
import { hashCanonical, sha256 } from "../core/canonical.mjs";
import { TEST_PROJECT_MARKER } from "../domain/projects.mjs";

const freeze = (value) => { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const serverSha = "5cd662956742cca906efa5581330052e745d3bc810722e6671d47d2964628f64";
const slotsSha = "6e624d8d46d856e6c68708f722f9bb42995efe77943fa2fd33680cce139bd9de";
/** Baseline facts, never inferred again from a writer's changed implementation. */
export const EXPERIMENT_DATASETS = freeze({
  "booking-demo": {
    fixture: "booking-demo", version: 1, field: "phone", table: "bookings",
    columns: ["id", "service_id", "day", "start_min", "end_min", "name", "vehicle", "phone", "synthetic"],
    clock: "2026-10-11T08:00:00", day: "2026-10-11",
    initial: [
      { id: "seed-2026-10-11-1000", service_id: "spalare-exterior", day: "2026-10-11", start_min: 600, end_min: 630, name: "Client Demo A", vehicle: "Autoturism test", phone: "0700 123 456", synthetic: 1 },
      { id: "seed-2026-10-11-1130", service_id: "curatare-interior", day: "2026-10-11", start_min: 690, end_min: 750, name: "Client Demo B", vehicle: "Autoturism test", phone: "0700 123 456", synthetic: 1 },
      { id: "seed-2026-10-11-1500", service_id: "polish-faruri", day: "2026-10-11", start_min: 900, end_min: 930, name: "Client Demo C", vehicle: "Autoturism test", phone: "0700 123 456", synthetic: 1 },
    ],
    types: { id: "șir", day: "șir AAAA-LL-ZZ", start_min: "întreg", end_min: "întreg", phone: "șir nevid, exact cum este stocat" },
    scope: "Telefonul nevid este proprietatea datelor demo ale ACESTUI fixture, niciodată o regulă pentru fiecare înregistrare istorică.",
    historical: {
      record: { id: "hist-2026-10-11-1300", service_id: "spalare-exterior", day: "2026-10-11", start_min: 780, end_min: 810, name: "Client Istoric", vehicle: "Autoturism istoric", synthetic: 0 },
      phoneDefault: "", insert: "Între sesiuni, direct în stocare, FĂRĂ coloana phone: se aplică DEFAULT '', ca la migrarea aplicației. Confirmă întâi prin API-ul slots că 13:00 este liber.",
    },
    sources: [
      { path: "src/catalog.js", sha256: "28f44825f9d684d4529a0da7aea9e2b433870f614d8742f3768e4d118ed1b232", lines: [13, 20], what: "Vehiculul și cele trei programări demo" },
      { path: "src/server-app.js", sha256: serverSha, lines: [103, 109], what: "Schema și migrarea: telefon implicit gol" },
      { path: "src/server-app.js", sha256: serverSha, lines: [134, 149], what: "Inițializarea și telefonul literal" },
      { path: "src/server-app.js", sha256: serverSha, lines: [283, 283], what: "Inițializarea normală la pornire" },
      { path: "src/slots.js", sha256: slotsSha, lines: [4, 7], what: "Grila și numărul zilelor" },
      { path: "src/slots.js", sha256: slotsSha, lines: [33, 33], what: "Zilele afișate, după ceasul local injectat" },
    ],
  },
});

export const datasetIdentity = (declaration) => hashCanonical(declaration);
const declarationOf = ({ identity, sources, ...facts }) => ({ ...facts, sources: sources.map(({ excerpt, ...source }) => source) });
const invalid = "precondiție invalidă: datele martor nu mai corespund surselor inițializării";
const sameShape = (value, expected) => {
  if (Array.isArray(expected)) return Array.isArray(value) && value.length === expected.length && value.every((item, i) => sameShape(item, expected[i]));
  if (expected && typeof expected === "object") return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === Object.keys(expected).length && Object.keys(value).every((key) => Object.hasOwn(expected, key) && sameShape(value[key], expected[key]));
  return typeof value === typeof expected;
};

/** Strict, bounded spec normalization; only a registered declaration can be approved. */
export function normalizeDataset(value) {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value) || JSON.stringify(value).length > 24000) throw new Error();
    const declaration = EXPERIMENT_DATASETS[value.fixture];
    if (!declaration || value.initial?.length > 10 || value.sources?.length > 6 || value.sources?.length !== declaration.sources.length) throw new Error();
    if (!sameShape(value, { ...declaration, identity: "", sources: declaration.sources.map((s) => ({ ...s, excerpt: "" })) })) throw new Error();
    const identity = datasetIdentity(declaration);
    if (value.identity !== identity || datasetIdentity(declarationOf(value)) !== identity) throw new Error();
    for (const source of value.sources) {
      const [from, to] = source.lines;
      if (typeof source.excerpt !== "string" || Buffer.byteLength(source.excerpt) > 4096 || to - from + 1 > 60) throw new Error();
      const lines = source.excerpt.split("\n");
      if (lines.length !== to - from + 1 || lines.some((line, i) => !line.startsWith(`${from + i}| `))) throw new Error();
    }
    return { dataset: JSON.parse(JSON.stringify(value)), problem: null };
  } catch { return { dataset: null, problem: "Contractul datelor martor este invalid: structură, limite sau identitate diferite de declarația Hub-ului." }; }
}

function sourceBytes(root, source) {
  const base = fs.realpathSync(root), file = fs.realpathSync(path.resolve(base, source.path));
  const relative = path.relative(base, file);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error(source.path);
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > 256 * 1024) throw new Error(source.path);
  const bytes = fs.readFileSync(file);
  if (bytes.length > 256 * 1024 || sha256(bytes) !== source.sha256) throw new Error(source.path);
  return bytes;
}

function excerptOf(bytes, source) {
  const lines = bytes.toString("utf8").split(/\r?\n/), [from, to] = source.lines;
  const excerpt = lines.slice(from - 1, to).map((line, i) => `${from + i}| ${line}`).join("\n");
  if (to > lines.length || to - from + 1 > 60 || Buffer.byteLength(excerpt) > 4096) throw new Error(source.path);
  return excerpt;
}

export function experimentDataset(projectRoot) {
  let marker;
  try {
    const file = path.join(projectRoot, TEST_PROJECT_MARKER), stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16384) return null;
    marker = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch { return null; }
  if (marker?.createdBy !== "ifrim-agent-hub" || marker.purpose !== "live-validation" || marker.data !== "synthetic" || !Object.hasOwn(EXPERIMENT_DATASETS, marker.fixture)) return null;
  const declaration = EXPERIMENT_DATASETS[marker.fixture];
  try {
    const sources = declaration.sources.map((source) => ({ ...source, excerpt: excerptOf(sourceBytes(projectRoot, source), source) }));
    return { ok: true, dataset: { ...declaration, identity: datasetIdentity(declaration), sources } };
  } catch (error) { return { ok: false, problem: `${invalid} (${error.message})` }; }
}

export function datasetProblem(dataset, projectRoot) {
  const normalized = normalizeDataset(dataset);
  if (normalized.problem) return `${invalid}: identitatea sau structura diferă de registrul Hub-ului`;
  try {
    for (const source of dataset.sources) {
      if (source.excerpt !== excerptOf(sourceBytes(projectRoot, source), source)) throw new Error(`extras diferit: ${source.path}`);
    }
    return null;
  }
  catch (error) { return `${invalid} (${error.message})`; }
}

/** Frozen facts and obligations; executable patterns have their own bounded section. */
export function datasetBrief(dataset, { review = false } = {}) {
  const safe = (s) => String(s).replace(/```/g, "'''");
  const { clock, day, initial, historical, types, scope } = dataset;
  const provenance = Object.groupBy(dataset.sources, (s) => s.path);
  return [
    "## Contractul experimentului (date martor fixate de Hub)",
    `now local ${clock}; zi ${day}.`,
    "```json", safe(JSON.stringify(initial)), "```",
    `Istoric: ${safe(JSON.stringify(historical))}`,
    `Tipuri: ${safe(JSON.stringify(types))}. ${safe(scope)}`,
    ...Object.entries(provenance).flatMap(([file, sources]) => [`${file} sha256:${sources[0].sha256.slice(0, 12)}`, ...sources.flatMap((s) => [`L${s.lines.join("–")}: ${s.what}`, "```text", safe(s.excerpt), "```"])]),
    review ? "Verifică fiecare obligație; lipsă ⇒ covered:false." : "Copiază constantele; reutilizează tiparele.",
    "R-DATASET: pornire normală, now declarat, stocare temporară. Ziua întreagă = EXPECTED înainte de POST1, pe coloanele declarate, ordonate; după repornire, rândurile filtrate la id-urile inițiale = EXPECTED și prima programare recitită după id. EXPECTED copiat de aici, nu din răspunsuri/cod modificabil. Nu completa phone; nu opri/șterge inițializarea. DATE MARTOR: = regresie de inițializare / precondiție invalidă, nu expunere.",
    "R-VALUES: DUPĂ validare, deduplică telefoanele inițiale declarate + cele exacte trimise în ambele POST-uri. Fără filter/typeof/limite de lungime ce elimină valori. Exclude istoricul fără telefon; fără reguli noi de format/lungime în aplicație.",
    "R-IDS: booking.id din AMBELE POST-uri (înainte/după repornire), recitire/comparare după ACEL id. Fiecare id inițial/creat în tabloul listei la bază/FIECARE parametru anonim. Nu doar identificare prin telefon. Mesaje ID API:.",
    "CONTROL ISTORIC: AC-1 separat: inserare declarată/repornire. Snapshot SELECT * imediat după inserare; deepEqual rând întreg imediat după cererea de bază și FIECARE parametru, în buclă; id listat, phone ''. exposes(corp brut)=[]; în cazul istoric, values = telefoanele inițiale declarate. Mesaje CONTROL ISTORIC:/EXPUNERE:.",
    "Păstrează AC-3: stocarea ÎNTREAGĂ înainte/după FIECARE refuz; AC-4/AC-5, slots din API, exposes după eliberarea resurselor, cleanup prin setup().",
    "Înainte de închiderea sesiunii și inserarea istoricului: GET slots pentru ziua fixată și spalare-exterior, status 200, 13:00 free.",
    "Tiparele executabile sunt în secțiunea Schelet validat de Hub (date martor).", "",
  ].join("\n");
}

const SKELETON_CASES = freeze([
  { key: "base", kind: "public_omits", title: "Toate înregistrările zilei rămân în lista publică fără telefon" },
  { key: "params", kind: "anon_params", title: "Fiecare parametru anonim păstrează toate înregistrările fără telefon" },
  { key: "historical", kind: "public_omits", title: "Înregistrarea istorică fără telefon rămâne listată și neschimbată" },
  { key: "refusal", kind: "required_refusal", title: "Fiecare refuz păstrează stocarea integrală neschimbată" },
  { key: "stored", kind: "internal_persistence", title: "Telefonul trimis se păstrează exact în stocare" },
  { key: "accepted", kind: "valid_accepted", title: "O programare validă pe un interval liber este acceptată" },
]);

function datasetCriteriaProblem(criteria = []) {
  const tests = criteria.filter((c) => c.verify === "test");
  for (const c of tests) {
    if (!c.kind) return `Criteriul ${c.id} nu declară tipul verificării pentru scheletul Hub.`;
    if (!SKELETON_CASES.some((entry) => entry.kind === c.kind)) return `Tipul ${c.kind} al criteriului ${c.id} nu este susținut de scheletul Hub.`;
  }
  for (const kind of ["public_omits", "anon_params"]) {
    if (!tests.some((c) => c.kind === kind)) return `Lipsește un criteriu prin test de tip ${kind}, necesar scheletului Hub.`;
  }
  return null;
}

function datasetCaseEntries(criteria) {
  return SKELETON_CASES.flatMap((entry) => criteria.filter((c) => c.verify === "test" && c.kind === entry.kind).map((c) => ({
    key: entry.key, name: `${c.id}${c.guard ? " control" : ""}: ${entry.title}`, criterion: c.id,
    kind: c.guard ? "control" : "check", today: c.guard ? "pass" : "fail",
  })));
}

export function datasetSkeletonManifest(criteria) {
  if (datasetCriteriaProblem(criteria)) return null;
  return {
    needs: [], newApi: [], removed: [],
    api: "GET /api/bookings?date=… (listă publică) și GET /api/slots; POST /api/bookings; stocarea internă citită prin node:sqlite.",
    cases: datasetCaseEntries(criteria).map(({ key, ...entry }) => entry),
  };
}

/** Rendering and pre-dispatch validation use the same eligibility decision. */
export function datasetSkeletonPlan(spec) {
  if (!spec.dataset) return { skipped: "Specificația nu declară date martor." };
  if (!spec.hubHelpers?.includes("json-exposure")) return { skipped: "Specificația nu include ajutorul Hub json-exposure, necesar scheletului." };
  const skipped = datasetCriteriaProblem(spec.acceptance);
  return skipped ? { skipped } : { manifest: datasetSkeletonManifest(spec.acceptance) };
}

/** Render the validated example from the frozen dataset and the mission's own test criteria. */
export function datasetSkeleton(dataset, { criteria = [], loadPath = "../../src/server-app.js" } = {}) {
  if (datasetCriteriaProblem(criteria)) return null;
  const { day, clock, initial, historical } = dataset, h = historical.record;
  const q = (v) => JSON.stringify(v);
  const historicalTime = `${String(Math.floor(h.start_min / 60)).padStart(2, "0")}:${String(h.start_min % 60).padStart(2, "0")}`;
  const preamble = (prefix) => [
    `  const m = await load(${q(loadPath)});`,
    '  const startSrv = need(m, "startServer");',
    `  const dbPath = await tempDb(${q(prefix)});`,
    '  const db = await setup("stocare", () => new sqlite.DatabaseSync(dbPath));',
  ];
  const shared = [
    "// Schelet Hub (date martor booking-demo v1): trece lint-ul Hub-ului sub antetul de mai sus. Completează-l; nu elimina verificările [F1]–[F4].",
    "// [F5] Numele antetului nu se declară, nu se reatribuie și nu devin parametri: test, assert, load, need, setup, exposes, path, url, os, fs, sqlite, http.",
    "// registry, hubAdd, hubClose, hubCleanup, hubTimer, hubClear și hook-urile before/after/beforeEach/afterEach nu se folosesc deloc.",
    "// Funcțiile locale au nume de domeniu (httpGet, dayRows, listedIds, twoSessions); adresa serverului este srv.url, nu o variabilă url.",
    "",
    `const DATE_KEY = ${q(day)}, SERVICE = ${q(h.service_id)}, HIST_ID = ${q(h.id)};`,
    `const clockFn = () => new Date(${q(clock)});`,
    'const PRE_PHONE = "0799 111 222", PHONE = "0712 345 678";',
    'const PARAMS = ["includePhone=1", "phone=1", "fields=phone", "debug=1", "all=1"];',
    'const INSERT_WITHOUT_PHONE = "INSERT INTO bookings (id, service_id, day, start_min, end_min, name, vehicle, synthetic, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)";',
    "const EXPECTED = [",
    ...initial.map((row) => `  ${q(row)},`),
    "];",
    "function httpGet(target) {",
    '  return new Promise((resolve, reject) => { http.get(target, (res) => { let body = ""; res.on("data", (c) => { body += c; }); res.on("end", () => resolve({ status: res.statusCode, body })); }).on("error", reject); });',
    "}",
    "function httpPost(target, payload) {",
    "  const text = JSON.stringify(payload), address = new URL(target);",
    "  return new Promise((resolve, reject) => {",
    '    const req = http.request({ hostname: address.hostname, port: Number(address.port), path: address.pathname, method: "POST", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(text) } },',
    '      (res) => { let body = ""; res.on("data", (c) => { body += c; }); res.on("end", () => resolve({ status: res.statusCode, body })); });',
    '    req.on("error", reject); req.end(text);',
    "  });",
    "}",
    "async function tempDb(prefix) {",
    "  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));",
    '  await setup("tmpDir", () => ({ close: () => fs.rmSync(dir, { recursive: true, force: true }) }));',
    '  return path.join(dir, "db.sqlite");',
    "}",
    'const boot = (startSrv, dbPath, label) => setup(label, () => startSrv({ port: 0, dbPath, now: clockFn }));',
    `const dayRows = (db) => db.prepare("SELECT ${dataset.columns.join(", ")} FROM ${dataset.table} WHERE day = ? ORDER BY start_min, id").all(DATE_KEY).map((r) => ({ ...r }));`,
    'const idDayPhone = (db, id) => ({ ...db.prepare("SELECT id, day, phone FROM bookings WHERE id = ?").get(id) });',
    'const fullRow = (db, id) => ({ ...db.prepare("SELECT * FROM bookings WHERE id = ?").get(id) });',
    "async function freeStart(base) {",
    '  const res = await httpGet(base + "api/slots?date=" + DATE_KEY + "&service=" + SERVICE);',
    '  assert.equal(res.status, 200, "slots răspunde");',
    '  const slot = JSON.parse(res.body).slots.find((s) => s.status === "free");',
    '  assert.ok(slot, "slots oferă un interval liber");',
    "  return slot.start;",
    "}",
    "function listedIds(res) {",
    '  assert.equal(res.status, 200, "lista răspunde");',
    "  const list = JSON.parse(res.body).bookings;",
    '  assert.ok(Array.isArray(list), "bookings este tabloul listei");',
    "  return list.map((b) => b.id);",
    "}",
    "function assertListed(res, ids) {",
    "  const listed = listedIds(res);",
    '  assert.equal(listed.length, ids.length, "ID API: fără rânduri lipsă sau în plus");',
    '  for (const id of ids) assert.ok(listed.includes(id), "ID API: id în tabloul listei");',
    "}",
    "async function created(srv, db, phone) {",
    '  const res = await httpPost(srv.url + "api/bookings", { serviceId: SERVICE, start: await freeStart(srv.url), name: "Client Test", vehicle: "Dacia Test", phone });',
    '  assert.equal(res.status, 201, "ID API: creare prin POST");',
    "  const id = JSON.parse(res.body).booking.id;",
    '  assert.deepEqual(idDayPhone(db, id), { id, day: DATE_KEY, phone }, "ID API: recitire după id-ul întors de POST");',
    "  return id;",
    "}",
    "async function twoSessions(startSrv, dbPath, db) {",
    '  let srv = await boot(startSrv, dbPath, "server");',
    '  assert.deepEqual(dayRows(db), EXPECTED, "DATE MARTOR: inițializarea exactă înainte de POST1");',
    "  const preId = await created(srv, db, PRE_PHONE);",
    "  await srv.close();",
    '  srv = await boot(startSrv, dbPath, "repornire");',
    "  // [F1] După repornire: seed-urile pe coloanele declarate, prima programare după id; așteptările vin din contract și din POST, nu din rândurile recitite.",
    '  assert.deepEqual(dayRows(db).filter((r) => EXPECTED.some((e) => e.id === r.id)), EXPECTED, "DATE MARTOR: inițializarea exactă după repornire");',
    '  assert.deepEqual(idDayPhone(db, preId), { id: preId, day: DATE_KEY, phone: PRE_PHONE }, "ID API: prima programare după repornire");',
    "  const newId = await created(srv, db, PHONE), ids = [...EXPECTED.map((r) => r.id), preId, newId];",
    '  assert.deepEqual(new Set(dayRows(db).map((r) => r.id)), new Set(ids), "ID API: setul zilei = inițiale + create legitim");',
    "",
    "  return { srv, ids };",
    "}",
  ];
  const bodies = {
    base: (name) => [
      "// [F4] load() numai în corpul test(...); funcțiile locale primesc startSrv ca parametru; resursele vin din setup().",
      `test(${q(name)}, async () => {`,
      ...preamble("s25-ac1-"),
      "  const { srv, ids } = await twoSessions(startSrv, dbPath, db);",
      "",
      '  const res = await httpGet(srv.url + "api/bookings?date=" + DATE_KEY);',
      "  assertListed(res, ids);",
      "  await srv.close();",
      '  assert.deepEqual(exposes(res.body, { keys: ["phone"], values: [...new Set([...EXPECTED.map((r) => r.phone), PRE_PHONE, PHONE])] }), [], "EXPUNERE: lista de bază");',
      "});",
    ],
    params: (name) => [
      `test(${q(name)}, async () => {`,
      ...preamble("s25-ac2-"),
      "  const { srv, ids } = await twoSessions(startSrv, dbPath, db), responses = new Map();",
      "  for (const param of PARAMS) {",
      '    const res = await httpGet(srv.url + "api/bookings?date=" + DATE_KEY + "&" + param);',
      "    assertListed(res, ids);",
      "    responses.set(param, res);",
      "  }",
      "  await srv.close();",
      '  for (const param of PARAMS) assert.deepEqual(exposes(responses.get(param).body, { keys: ["phone"], values: [...new Set([...EXPECTED.map((r) => r.phone), PRE_PHONE, PHONE])] }), [], "EXPUNERE: parametru anonim");',
      "});",
    ],
    historical: (name) => [
      `test(${q(name)}, async () => {`,
      ...preamble("s25-hist-"),
      '  let srv = await boot(startSrv, dbPath, "server");',
      '  assert.deepEqual(dayRows(db), EXPECTED, "DATE MARTOR: inițializarea controlului istoric");',
      `  // [F3] ÎNAINTE de inserare: slots pentru ziua fixată și ${h.service_id}, ${historicalTime} liber; nu cere ca ${historicalTime} să rămână liber după inserare.`,
      `  const slots = await httpGet(srv.url + "api/slots?date=" + DATE_KEY + "&service=${h.service_id}");`,
      '  assert.equal(slots.status, 200, "CONTROL ISTORIC: slots răspunde");',
      `  assert.ok(JSON.parse(slots.body).slots.some((s) => s.start === DATE_KEY + "T${historicalTime}" && s.status === "free"), "CONTROL ISTORIC: ${historicalTime} liber înainte de inserare");`,
      "  await srv.close();",
      `  db.prepare(INSERT_WITHOUT_PHONE).run(HIST_ID, SERVICE, DATE_KEY, ${h.start_min}, ${h.end_min}, ${q(h.name)}, ${q(h.vehicle)}, ${h.synthetic}, clockFn().toISOString());`,
      '  const before = fullRow(db, HIST_ID);',
      '  srv = await boot(startSrv, dbPath, "repornire");',
      "",
      '  assert.equal(before.phone, "", "CONTROL ISTORIC: telefon implicit gol, fără coloana phone la inserare");',
      '  assert.deepEqual(dayRows(db).filter((r) => EXPECTED.some((e) => e.id === r.id)), EXPECTED, "DATE MARTOR: după repornirea controlului istoric");',
      "  const responses = new Map();",
      "  // [F2] Imediat după FIECARE cerere (bază + fiecare parametru): id-urile listate și rândul întreg egal cu snapshotul de după inserare.",
      '  for (const query of ["", ...PARAMS]) {',
      '    const res = await httpGet(srv.url + "api/bookings?date=" + DATE_KEY + (query ? "&" + query : ""));',
      "    const listed = listedIds(res);",
      '    assert.ok([HIST_ID, ...EXPECTED.map((r) => r.id)].every((id) => listed.includes(id)), "CONTROL ISTORIC: id-urile listate după fiecare cerere");',
      '    assert.deepEqual(fullRow(db, HIST_ID), before, "CONTROL ISTORIC: rândul întreg neschimbat după fiecare cerere");',
      "    responses.set(query, res);",
      "  }",
      "",
      "  await srv.close();",
      '  for (const query of ["", ...PARAMS]) assert.deepEqual(exposes(responses.get(query).body, { keys: ["phone"], values: [...new Set(EXPECTED.map((r) => r.phone))] }), [], "EXPUNERE: control istoric");',
      "});",
    ],
    refusal: (name) => [
      `test(${q(name)}, async () => {`,
      ...preamble("s25-ac3-"),
      '  const srv = await boot(startSrv, dbPath, "server"), all = () => db.prepare("SELECT * FROM bookings ORDER BY id").all().map((r) => ({ ...r })), before = all();',
      '  for (const invalid of [{}, { phone: "" }, { phone: "   " }]) {',
      '    const res = await httpPost(srv.url + "api/bookings", { serviceId: SERVICE, start: await freeStart(srv.url), name: "Client Test", vehicle: "Dacia Test", ...invalid });',
      '    assert.equal(res.status, 400, "refuz fără telefon valid");',
      '    assert.equal(typeof JSON.parse(res.body).errors?.phone, "string", "eroare pentru Telefon");',
      '    assert.deepEqual(all(), before, "stocarea neschimbată după fiecare refuz");',
      "  }",
      "});",
    ],
    stored: (name) => [
      `test(${q(name)}, async () => {`,
      ...preamble("s25-ac4-"),
      '  const id = await created(await boot(startSrv, dbPath, "server"), db, PHONE);',
      '  assert.equal(idDayPhone(db, id).phone, PHONE, "telefonul exact în stocare");',
      "});",
    ],
    accepted: (name) => [
      `test(${q(name)}, async () => {`,
      ...preamble("s25-ac5-"),
      '  const srv = await boot(startSrv, dbPath, "server");',
      '  const res = await httpPost(srv.url + "api/bookings", { serviceId: SERVICE, start: await freeStart(srv.url), name: "Client Test", vehicle: "Dacia Test", phone: PHONE });',
      '  assert.equal(res.status, 201, "programarea validă este acceptată");',
      '  assert.equal(typeof JSON.parse(res.body).booking.id, "string", "răspunsul are id");',
      "});",
    ],
  };
  return [...shared, ...datasetCaseEntries(criteria).flatMap((entry) => bodies[entry.key](entry.name))].join("\n") + "\n";
}

/** The [Fn] fragments are runs of the skeleton (marker line to the next empty line): same bytes, never a second copy. */
export function datasetFragments(skeleton) {
  const out = {};
  for (const m of skeleton.matchAll(/^[ \t]*\/\/ \[(F\d)\][^\n]*(?:\n[^\n]+)*/gm)) out[m[1]] = m[0];
  return out;
}

export const DATASET_PATTERNS_HEADING = "## Schelet validat de Hub (date martor)";

export function datasetPatternsBrief(dataset, { review = false, criteria = [], loadPath } = {}) {
  const skeleton = datasetSkeleton(dataset, { criteria, loadPath });
  if (skeleton === null) return "";
  const fragments = datasetFragments(skeleton);
  return [
    DATASET_PATTERNS_HEADING,
    review ? "Tiparele primite de autor: judecă comportamentul, nu prezența literală a textului." : "Exemplul complet de mai jos este verificat de Hub prin același lint înaintea apelului autorului.",
    "[F1] Date după repornire și id-uri; [F2] comparație istorică după fiecare cerere; [F3] slots înainte de inserare; [F4] load()/need() în fiecare test, resurse prin setup(); [F5] nume locale fără coliziuni cu antetul.",
    "La rescriere ADAUGĂ fragmentele lângă verificările păstrate. NU înlocui candidatul anterior cu scheletul: coverage_insufficient_removed respinge pierderea verificărilor.",
    ...(review ? [
      "Nu cere ca 13:00 să rămână liber după inserare.",
      "Nu cere egalitatea întregii tabele cu numai cele trei seed-uri după ce există alte rânduri.",
      "Așteptările provin din contract și răspunsurile POST, niciodată din rândurile citite după repornire.",
      ...["F1", "F2", "F3"].flatMap((key) => ["```js", fragments[key], "```"]),
    ] : ["```js", skeleton.replace(/\n$/, ""), "```"]),
    "",
  ].join("\n");
}

/** Extract only the example actually shown in this section of the final, redacted brief. */
export function extractDatasetSkeleton(brief) {
  const sections = String(brief).split(DATASET_PATTERNS_HEADING + "\n");
  if (sections.length !== 2) return null;
  const section = sections[1].split(/\n## /)[0];
  const blocks = [...section.matchAll(/^```js\n([\s\S]*?)^```\s*$/gm)];
  return blocks.length === 1 ? blocks[0][1] : null;
}
