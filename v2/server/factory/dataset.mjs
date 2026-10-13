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

/** Quoted facts and reusable patterns, not a complete test. */
export function datasetBrief(dataset, { review = false } = {}) {
  const safe = (s) => String(s).replace(/```/g, "'''");
  const { clock, day, initial, historical, types, scope, columns } = dataset;
  const provenance = Object.groupBy(dataset.sources, (s) => s.path);
  return [
    "## Contractul experimentului (date martor fixate de Hub)",
    `now local ${clock}; zi ${day}.`,
    "```json", safe(JSON.stringify(initial)), "```",
    `Istoric: ${safe(JSON.stringify(historical))}`,
    `Tipuri: ${safe(JSON.stringify(types))}. ${safe(scope)}`,
    ...Object.entries(provenance).flatMap(([file, sources]) => [`${file} sha256:${sources[0].sha256.slice(0, 12)}`, ...sources.flatMap((s) => [`L${s.lines.join("–")}: ${s.what}`, "```text", safe(s.excerpt), "```"])]),
    review ? "Verifică fiecare obligație; lipsă ⇒ covered:false." : "Copiază constantele; reutilizează tiparele.",
    "R-DATASET: pornire normală, now declarat, stocare temporară. O comparație exactă: ziua/coloanele declarate, ordonate, înainte de POST1 și după repornire. EXPECTED copiat de aici, nu din răspunsuri/cod modificabil. Nu completa phone; nu opri/șterge inițializarea. DATE MARTOR: = regresie de inițializare / precondiție invalidă, nu expunere.",
    "R-VALUES: DUPĂ validare, deduplică telefoanele inițiale declarate + cele exacte trimise în ambele POST-uri. Fără filter/typeof/limite de lungime ce elimină valori. Exclude istoricul fără telefon; fără reguli noi de format/lungime în aplicație.",
    "R-IDS: booking.id din AMBELE POST-uri (înainte/după repornire), recitire/comparare după ACEL id ca mai jos. Fiecare id inițial/creat în tabloul listei la bază/FIECARE parametru anonim. Nu doar identificare prin telefon. Mesaje ID API:.",
    "CONTROL ISTORIC: AC-1 separat: inserare declarată/repornire. Bază/FIECARE parametru: id listat, deepEqual rând întreg pre/post cereri, phone ''. exposes(corp brut)=[]; în cazul istoric, values = telefoanele inițiale declarate. Mesaje CONTROL ISTORIC:/EXPUNERE:.",
    "Păstrează AC-3: stocarea ÎNTREAGĂ înainte/după FIECARE refuz; AC-4/AC-5, slots din API, exposes după eliberarea resurselor, cleanup prin setup().",
    "Tipare, nu test complet:",
    "```js",
    `const rows = db.prepare("SELECT ${columns.join(",")} FROM bookings WHERE day=? ORDER BY start_min,id").all(DAY).map(r=>({...r}));`,
    'assert.deepEqual(rows, EXPECTED, "DATE MARTOR: start");',
    'await srv.close(); srv=await setup("repornire",()=>startServer({port:0,dbPath,now}));',
    'async function post(p){const r=await httpPost(url,p);assert.equal(r.status,201,"ID API: creare");return JSON.parse(r.body).booking.id;}',
    'const id=await post(payload), row=db.prepare("SELECT id,day,phone FROM bookings WHERE id = ?").get(id);',
    'assert.deepEqual({...row},{id,day:DAY,phone:payload.phone},"ID API: stocare");',
    'const values=[...new Set([...EXPECTED.map(r=>r.phone),PRE_PHONE,PHONE])];',
    'for(const r of responses) for(const id of ids) assert.ok(JSON.parse(r.body).bookings.some(b=>b.id===id),"ID API: listă");',
    "```", "",
  ].join("\n");
}
