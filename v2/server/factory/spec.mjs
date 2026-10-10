import path from "node:path";
import { HubError } from "../core/errors.mjs";
import { hashCanonical } from "../core/canonical.mjs";
import { redactText } from "../security/redact.mjs";
import { validateE2ESteps } from "../tools/browser.mjs";

/**
 * Versioned engineering specification (M03 §11). "Done" is defined BEFORE implementation: acceptance criteria, how each is
 * verified, the exact verification commands and the files of the independent acceptance tests (protected once the scope is
 * approved). User requirements, observations from the code and agent assumptions are kept apart. A changed scope is a new
 * version; an approved version is never edited.
 */
export const WORK_TYPES = Object.freeze(["BUGFIX", "FEATURE", "REFACTOR"]);
export const VERIFY_KINDS = Object.freeze(["test", "review", "manual", "e2e", "preview"]);
export const SPEC_SCHEMA_VERSION = 1;

/**
 * Commands the Hub runner accepts (exact shapes; no shell syntax). Test paths are relative, without "..".
 * The runner executes them under the Codex Windows sandbox with the Hub profile (network off), never with the backend's rights.
 */
const COMMAND_PATTERNS = [/^node --test(?: [\w./-]+)*$/, /^npm test$/, /^npm run (?:build|lint|typecheck|test)$/];
/**
 * Commands outside the base list that the OWNER can enable (M08 decision package B3), by key; off by default. Enabled keys come from
 * the setting factoryExtraCommands, applied by the Hub at boot and when the setting changes.
 */
export const EXTRA_COMMAND_PATTERNS = Object.freeze({ "python-unittest": /^python3 -m unittest(?: [\w./-]+\.py)+$/ });
let enabledExtras = new Set();
export const setExtraCommands = (keys = []) => { enabledExtras = new Set((Array.isArray(keys) ? keys : []).filter((k) => EXTRA_COMMAND_PATTERNS[k])); };
export const isAllowedCommand = (command) => (COMMAND_PATTERNS.some((re) => re.test(String(command || ""))) || [...enabledExtras].some((k) => EXTRA_COMMAND_PATTERNS[k].test(String(command || ""))))
  && !String(command).split(" ").some((part) => part.includes(".."));
const PREVIEW_COMMANDS = [/^node [\w./-]+\.(?:m?js|cjs)$/, /^npm run (?:start|dev|preview)$/];
export const isAllowedPreviewCommand = (command) => PREVIEW_COMMANDS.some((re) => re.test(String(command || ""))) && !String(command).includes("..");

const str = (value, max) => redactText(String(value ?? "").trim()).slice(0, max);
const list = (value, maxItems, maxLen) => (Array.isArray(value) ? value : []).map((v) => str(v, maxLen)).filter(Boolean).slice(0, maxItems);
const relPath = (value) => {
  const p = String(value || "").trim().split("\\").join("/");
  if (!p || p.startsWith("/") || /^[a-z]:/i.test(p) || p.split("/").includes("..") || path.isAbsolute(p)) return null;
  return p.replace(/^\.\//, "");
};

/**
 * Normalizes a spec and lists every problem without throwing: a DRAFT may be incomplete (e.g. proposed by Lega from a
 * sentence); only a spec without problems can be approved. `hubPorts` are refused as preview ports.
 */
export function checkSpec(input = {}, { hubPorts = [8011, 8012] } = {}) {
  const problems = [];
  const spec = {
    schema: SPEC_SCHEMA_VERSION,
    workType: String(input.workType || "").toUpperCase(),
    title: str(input.title, 160),
    objective: str(input.objective, 4000),
    inScope: list(input.inScope, 20, 300),
    outOfScope: list(input.outOfScope, 20, 300),
    acceptance: [],
    constraints: list(input.constraints, 20, 300),
    risks: list(input.risks, 20, 300),
    dataNeeded: list(input.dataNeeded, 20, 300),
    artifacts: list(input.artifacts, 20, 300),
    verification: { checks: [], acceptance: [], preview: null },
    // Folders the tests or the preview write at runtime (e.g. a test database): left out of snapshots and change sets.
    workspace: { ignore: [] },
    sources: {
      user: list(input.sources?.user ?? [input.objective], 20, 2000),
      code: (Array.isArray(input.sources?.code) ? input.sources.code : []).slice(0, 20).map((c) => ({ ref: str(c?.ref, 300), note: str(c?.note, 500) })).filter((c) => c.ref),
      assumptions: list(input.sources?.assumptions, 20, 500),
    },
  };
  if (!WORK_TYPES.includes(spec.workType)) problems.push(`workType trebuie să fie ${WORK_TYPES.join(" / ")}`);
  if (spec.title.length < 3) problems.push("titlul are minimum 3 caractere");
  if (spec.objective.length < 10) problems.push("obiectivul are minimum 10 caractere");
  const ids = new Set();
  for (const [index, raw] of (Array.isArray(input.acceptance) ? input.acceptance : []).slice(0, 20).entries()) {
    const item = typeof raw === "string" ? { text: raw } : raw || {};
    const id = String(item.id || `AC-${index + 1}`).toUpperCase().slice(0, 20);
    const text = str(item.text, 500);
    const verify = VERIFY_KINDS.includes(item.verify) ? item.verify : "test";
    const testRef = item.testRef ? relPath(item.testRef) : null;
    if (!/^AC-\d{1,3}$/.test(id) || ids.has(id)) problems.push(`criteriul ${index + 1}: id invalid sau duplicat (${id})`);
    ids.add(id);
    if (text.length < 5) problems.push(`${id}: textul criteriului are minimum 5 caractere`);
    if (item.testRef && !testRef) problems.push(`${id}: testRef trebuie să fie o cale relativă în proiect`);
    if (verify === "test" && !testRef) problems.push(`${id}: un criteriu verificat prin test numește fișierul testului de acceptanță (testRef)`);
    // Browser E2E criteria carry their steps in the spec (approved, so protected from the writer); checked like the commands.
    let steps = null;
    if (verify === "e2e" && item.steps !== undefined) {
      const stepProblems = validateE2ESteps(item.steps);
      if (stepProblems.length) problems.push(`${id}: ${stepProblems.join("; ")}`);
      // Kept even when invalid (bounded; a marker when unusable), so a later revision still reports the problem instead of
      // silently dropping the steps and making the criterion approvable without them.
      const raw = JSON.stringify(Array.isArray(item.steps) ? item.steps.slice(0, 50) : item.steps);
      if (raw !== undefined && raw.length <= 20000) steps = JSON.parse(raw);
      else { steps = [{ invalid: raw === undefined ? "format necunoscut" : "pași prea mari" }]; if (raw !== undefined) problems.push(`${id}: pașii E2E sunt prea mari`); }
    }
    // §25 closure: a „păstrare” criterion (guard, test only) and the criterion's provenance (where the planner derived it from).
    const guard = item.guard === true && verify === "test";
    const origin = item.origin ? str(item.origin, 200) : "";
    // Closure R-SUP (review #3): the kind of check a derived test criterion is (public_omits, required_refusal …), kept in the hashed
    // spec so the factory can verify that a retirement's replacements are the right checks. Present only when the planner set it.
    const kind = verify === "test" && /^[a-z_]{3,40}$/.test(String(item.kind || "")) ? String(item.kind) : "";
    spec.acceptance.push({ id, text, verify, ...(testRef ? { testRef } : {}), ...(item.expectFailure ? { expectFailure: str(item.expectFailure, 200) } : {}), ...(steps ? { steps } : {}), ...(guard ? { guard: true } : {}), ...(origin ? { origin } : {}), ...(kind ? { kind } : {}) });
  }
  if (spec.acceptance.some((a) => a.guard) && !spec.acceptance.some((a) => a.verify === "test" && !a.guard)) problems.push("criteriile de păstrare au nevoie de cel puțin un criteriu prin test care pică azi");
  if (!spec.acceptance.length) problems.push("cel puțin un criteriu de acceptanță");
  if (!spec.acceptance.some((a) => a.verify === "test")) problems.push("cel puțin un criteriu verificat printr-un test automat independent");
  for (const key of ["checks", "acceptance"]) {
    for (const command of (Array.isArray(input.verification?.[key]) ? input.verification[key] : []).slice(0, 8)) {
      const c = String(command || "").trim().replace(/\s+/g, " ");
      if (!isAllowedCommand(c)) problems.push(`verificare ${key}: comanda „${c.slice(0, 80)}” nu e în lista acceptată (node --test, npm test, npm run build|lint|typecheck|test)`);
      else spec.verification[key].push(c);
    }
  }
  for (const raw of (Array.isArray(input.workspace?.ignore) ? input.workspace.ignore : []).slice(0, 10)) {
    const rel = relPath(raw);
    if (!rel || /^(?:src|test|tests|public|\.)?\/?$/i.test(rel)) problems.push(`workspace.ignore: „${String(raw).slice(0, 60)}” nu poate fi ignorat (doar foldere de date generate la rulare)`);
    else spec.workspace.ignore.push(rel.replace(/\/+$/, ""));
  }
  if (!spec.verification.acceptance.length) problems.push("cel puțin o comandă pentru testele de acceptanță (verification.acceptance)");
  const preview = input.verification?.preview;
  if (preview) {
    const command = String(preview.command || "").trim().replace(/\s+/g, " ");
    let url = null;
    try { url = new URL(String(preview.url || "")); } catch { /* reported below */ }
    const port = Number(url?.port || 0);
    if (!isAllowedPreviewCommand(command)) problems.push("preview: comanda acceptată este node <fișier>.js sau npm run start|dev|preview");
    else if (!url || url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname) || !(port >= 1024 && port <= 65535) || hubPorts.includes(port)) {
      problems.push("preview: URL local http://127.0.0.1:<port> (port 1024–65535, nu porturile Hub-ului)");
    } else spec.verification.preview = { command, url: url.href };
  }
  if (spec.acceptance.some((a) => a.steps) && !spec.verification.preview) problems.push("criteriile E2E cu pași au nevoie de un preview (verification.preview)");
  // R-PRIV: earlier Hub-written tests this revision makes incompatible (planners/criteria.mjs conflictingHubTests). The key exists only
  // when the input carries it. At the start the Hub moves each one, unchanged and sha-checked, out of the active suite (factory.mjs
  // retireSuperseded); it stays linked to its original version. Only Hub-written tests (test/hub/…) can be superseded, never the
  // revision's own test.
  if (input.supersedes !== undefined && input.supersedes !== null) {
    spec.supersedes = [];
    const own = input.authoring?.testRef ? relPath(input.authoring.testRef) : null;
    for (const [i, raw] of (Array.isArray(input.supersedes) ? input.supersedes : []).slice(0, 10).entries()) {
      const testRef = relPath(raw?.testRef) || "";
      const sha = String(raw?.sha256 || "");
      const item = { testRef, sha256: sha, missionId: raw?.missionId ? str(raw.missionId, 80) : null, specVersion: Number.isInteger(raw?.specVersion) ? raw.specVersion : null, reason: str(raw?.reason, 300) };
      if (!TEST_REF_RE.test(testRef)) problems.push(`supersedes[${i}]: doar un test scris de Hub (${AUTHORING_TEST_DIR}/<nume>.test.mjs)`);
      else if (own && testRef === own) problems.push(`supersedes[${i}]: testul acestei revizii nu se poate înlocui pe sine`);
      if (!/^[0-9a-f]{64}$/.test(sha)) problems.push(`supersedes[${i}]: sha256 lipsește`);
      if (item.reason.length < 10) problems.push(`supersedes[${i}]: motivul incompatibilității lipsește`);
      if (spec.supersedes.some((x) => x.testRef.toLowerCase() === testRef.toLowerCase())) problems.push(`supersedes[${i}]: ${testRef} apare de două ori`);
      // Closure R-SUP-01/02: the provenance (the mission and spec version that protected these exact bytes) and the explicit contract
      // difference are part of the confirmed plan; without them nothing is retired (the factory re-checks both before the move).
      if (!/^mis_[a-z0-9_]{4,76}$/.test(item.missionId || "")) problems.push(`supersedes[${i}]: misiunea originală lipsește (proveniența testului)`);
      if (!(Number.isInteger(item.specVersion) && item.specVersion >= 1)) problems.push(`supersedes[${i}]: versiunea specificației originale lipsește`);
      const contract = checkSupersedeContract(raw?.contract, item, i, problems, spec.acceptance);
      if (contract) item.contract = contract;
      spec.supersedes.push(item);
    }
    if (!spec.supersedes.length) problems.push("supersedes: listă goală (lipsește cheia când nu se înlocuiește nimic)");
  }
  // M11 L5: the key exists ONLY when the input carries it (null = absent), so every ordinary spec keeps its exact hash.
  if (input.authoring !== undefined && input.authoring !== null) {
    const { authoring, problems: authoringProblems } = checkAuthoring(input.authoring, spec);
    spec.authoring = authoring;
    problems.push(...authoringProblems);
  }
  return { spec, problems };
}

/**
 * Closure R-SUP-02: the contract of one retirement (factory/supersede.mjs retirementContract), normalized for the spec hash. Every case of
 * the retired file is named: the conflicting ones with the public route they read and the new criteria that replace them, the others with
 * the new criteria that keep their coverage; every id is a test criterion of THIS spec. → the contract, or null (problems pushed).
 */
const CASE_ID_RE = /^AC-\d{1,3}$/;
/** The checks that replace a conflicting read (kept equal to factory/supersede.mjs REPLACES_CONFLICT by v2/tests/r-closure.test.mjs). */
export const SUPERSEDE_REPLACES = Object.freeze(["public_omits", "anon_params", "internal_persistence"]);
const ROUTE_RE = /^\/[A-Za-z0-9_\-/.]{0,120}$/;
function checkSupersedeContract(raw, item, i, problems, acceptance) {
  const at = `supersedes[${i}].contract`;
  if (!raw || typeof raw !== "object") { problems.push(`${at}: diferența explicită dintre contractul vechi și cel nou lipsește`); return null; }
  const testIds = new Set(acceptance.filter((a) => a.verify === "test").map((a) => a.id));
  const ids = (values, where) => {
    const out = (Array.isArray(values) ? values : []).map((x) => String(x)).slice(0, 10);
    if (!out.length) problems.push(`${at}: ${where} nu numește nicio verificare nouă`);
    for (const id of out) if (!testIds.has(id)) problems.push(`${at}: ${where} numește ${id}, care nu e un criteriu prin test al acestei specificații`);
    return out;
  };
  const routes = (values) => (Array.isArray(values) ? values : []).map(String).filter((r) => ROUTE_RE.test(r)).slice(0, 10);
  const field = String(raw.field || "");
  if (!/^[A-Za-z][A-Za-z0-9]{0,40}$/.test(field)) problems.push(`${at}: câmpul lipsește`);
  if (raw.previous?.missionId !== item.missionId || raw.previous?.specVersion !== item.specVersion) problems.push(`${at}: proveniența din contract nu e aceeași cu a testului`);
  const conflicts = (Array.isArray(raw.conflicts) ? raw.conflicts : []).slice(0, 20).map((c, k) => {
    const out = { case: String(c?.case || ""), criterion: str(c?.criterion, 300), routes: routes(c?.routes), replacedBy: ids(c?.replacedBy, `conflicts[${k}].replacedBy`) };
    if (!CASE_ID_RE.test(out.case)) problems.push(`${at}: conflicts[${k}]: cazul lipsește`);
    if (!out.routes.length) problems.push(`${at}: conflicts[${k}]: ruta publică citită lipsește`);
    return out;
  });
  if (!conflicts.length) problems.push(`${at}: niciun caz incompatibil numit`);
  const kept = (Array.isArray(raw.kept) ? raw.kept : []).slice(0, 20).map((c, k) => {
    const out = { case: String(c?.case || ""), kind: String(c?.kind || ""), criterion: str(c?.criterion, 300), coveredBy: ids(c?.coveredBy, `kept[${k}].coveredBy`) };
    if (!CASE_ID_RE.test(out.case)) problems.push(`${at}: kept[${k}]: cazul lipsește`);
    if (!/^[a-z_]{3,40}$/.test(out.kind)) problems.push(`${at}: kept[${k}]: tipul lipsește`);
    return out;
  });
  // Review #3: the replacements are the RIGHT checks — each conflict is replaced by every one of the three kinds that split the old
  // contract, each kept case by a check of its own kind (a hand-made spec cannot name an arbitrary criterion).
  const kindOf = new Map(acceptance.filter((a) => a.verify === "test").map((a) => [a.id, a.kind || null]));
  for (const [k, c] of conflicts.entries()) {
    const kinds = new Set(c.replacedBy.map((id) => kindOf.get(id)));
    const missing = SUPERSEDE_REPLACES.filter((x) => !kinds.has(x));
    if (missing.length || c.replacedBy.some((id) => !SUPERSEDE_REPLACES.includes(kindOf.get(id)))) problems.push(`${at}: conflicts[${k}] nu e înlocuit exact de verificările ${SUPERSEDE_REPLACES.join(", ")}${missing.length ? ` (lipsesc: ${missing.join(", ")})` : ""}`);
  }
  for (const [k, c] of kept.entries()) if (c.coveredBy.some((id) => kindOf.get(id) !== c.kind)) problems.push(`${at}: kept[${k}] (${c.kind}) e acoperit de un criteriu de alt tip`);
  const cases = [...conflicts, ...kept].map((c) => c.case);
  if (new Set(cases).size !== cases.length) problems.push(`${at}: un caz apare de două ori`);
  const publicRoutes = routes(raw.publicRoutes);
  if (!publicRoutes.length) problems.push(`${at}: rutele paginii publice lipsesc`);
  for (const c of conflicts) for (const r of c.routes) if (!publicRoutes.includes(r)) problems.push(`${at}: ${c.case} citește ${r}, care nu e o rută a paginii publice`);
  return { field, previous: { missionId: item.missionId, specVersion: item.specVersion }, publicRoutes, conflicts, kept, internalReads: routes(raw.internalReads) };
}

/**
 * M11 L5 — step 0 of a test-first plan (design .ifrim/M11_L5_DESIGN.md §4, §5.1): the acceptance test does not exist yet and
 * the Hub writes it (Claude proposes it read-only, the Hub runs it twice on today's code, Codex reviews it read-only, then the
 * Hub protects it). Everything that step runs is fixed here, inside the hashed spec, so the owner's ONE confirmation covers it.
 * The same paths as factory/test-first.mjs (HUB_TEST_DIR, STAGING_DIR; kept equal by v2/tests/m11-l5-wave-a-support.test.mjs).
 */
export const AUTHORING_TEST_DIR = "test/hub";
export const AUTHORING_STAGING_DIR = ".ifrim-hub/staging";
export const AUTHORING_WORK_TYPES = Object.freeze(["BUGFIX", "FEATURE"]);
const AUTHORING_REAUTHOR_MAX = 1;
const AUTHORING_PROOF_RUNS = 2;
const TEST_REF_RE = /^test\/hub\/([a-z0-9][a-z0-9-]{0,63})\.test\.mjs$/;
const STAGING_REF_RE = /^\.ifrim-hub\/staging\/([a-z0-9][a-z0-9-]{0,63})\.mjs$/;
const depthOf = (rel) => String(rel || "").split("/").length;

/**
 * Normalizes `spec.authoring` against the already normalized rest of the spec. Unknown keys are dropped; the result has a fixed
 * shape (so a revision through checkSpec reproduces the same hash) and the problems block the approval, never the draft:
 *   mode "hub"; testRef test/hub/<stem>.test.mjs and stagingRef .ifrim-hub/staging/<stem>.mjs (same stem, same depth, so a
 *   load("../../src/x.js") resolves from both; the staging name never contains ".test.", so node --test never discovers it);
 *   workType BUGFIX or FEATURE (a refactor needs a characterization test: L5b); criteria = exactly the verify:"test" criteria,
 *   each naming the testRef; verification.acceptance = exactly ["node --test <testRef>"]; reauthorMax 0–1; proofRuns 2;
 *   controls "bugfix" for a BUGFIX (a control case per criterion passes today) and "none" for a FEATURE; author "claude" and
 *   testReviewer "codex" (owner decision 2026-10-06: the implementer never writes its own test).
 */
function checkAuthoring(raw, spec) {
  const problems = [];
  const input = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  if (input !== raw) problems.push("authoring: trebuie să fie un obiect");
  const testRef = relPath(input.testRef) || "";
  const stagingRef = relPath(input.stagingRef) || "";
  const controlsFor = spec.workType === "BUGFIX" ? "bugfix" : "none";
  const intIn = (value, fallback) => (value === undefined ? fallback : Number.isInteger(value) ? value : NaN);
  const testCriteria = spec.acceptance.filter((a) => a.verify === "test").map((a) => a.id);
  const listed = (Array.isArray(input.criteria) ? input.criteria : []).slice(0, 20).map((id) => String(id ?? "").trim().toUpperCase().slice(0, 20)).filter(Boolean);
  const authoring = {
    mode: str(input.mode, 20),
    testRef,
    stagingRef,
    // In the spec's own criterion order, unique: the order of the input never changes the hash.
    criteria: spec.acceptance.map((a) => a.id).filter((id) => listed.includes(id)),
    reauthorMax: intIn(input.reauthorMax, AUTHORING_REAUTHOR_MAX),
    proofRuns: intIn(input.proofRuns, AUTHORING_PROOF_RUNS),
    controls: input.controls === undefined ? controlsFor : str(input.controls, 20),
    author: input.author === undefined ? "claude" : str(input.author, 20),
    testReviewer: input.testReviewer === undefined ? "codex" : str(input.testReviewer, 20),
  };
  if (authoring.mode !== "hub") problems.push("authoring.mode: doar „hub” (testul îl scrie Hub-ul)");
  if (!AUTHORING_WORK_TYPES.includes(spec.workType)) problems.push(`authoring: testul scris de Hub e disponibil doar pentru ${AUTHORING_WORK_TYPES.join(" / ")} (o refactorizare are nevoie de un test de caracterizare)`);
  const testStem = testRef.match(TEST_REF_RE)?.[1] || null;
  const stagingStem = stagingRef.match(STAGING_REF_RE)?.[1] || null;
  if (!testStem) problems.push(`authoring.testRef: calea testului scris de Hub este ${AUTHORING_TEST_DIR}/<nume>.test.mjs`);
  if (!stagingStem) problems.push(`authoring.stagingRef: zona de lucru a Hub-ului este ${AUTHORING_STAGING_DIR}/<nume>.mjs`);
  if (/\.test\./i.test(stagingRef)) problems.push("authoring.stagingRef: numele din zona de lucru nu conține „.test.” (node --test l-ar descoperi)");
  if (testRef && stagingRef && depthOf(testRef) !== depthOf(stagingRef)) problems.push("authoring: zona de lucru și ținta testului au aceeași adâncime (load() trebuie să meargă din ambele)");
  if (testStem && stagingStem && testStem !== stagingStem) problems.push("authoring: zona de lucru și ținta testului au același nume");
  const unknown = listed.filter((id) => !testCriteria.includes(id));
  if (unknown.length) problems.push(`authoring.criteria: ${[...new Set(unknown)].join(", ")} nu sunt criterii verificate prin test`);
  const uncovered = testCriteria.filter((id) => !authoring.criteria.includes(id));
  if (uncovered.length || !authoring.criteria.length) problems.push(`authoring.criteria: testul scris de Hub acoperă toate criteriile verificate prin test (${uncovered.join(", ") || "niciunul listat"})`);
  for (const a of spec.acceptance) {
    if (a.verify === "test" && testRef && a.testRef !== testRef) problems.push(`${a.id}: criteriile verificate prin test numesc testul scris de Hub (${testRef})`);
  }
  if (testRef && (spec.verification.acceptance.length !== 1 || spec.verification.acceptance[0] !== `node --test ${testRef}`)) {
    problems.push(`authoring: verification.acceptance este exact „node --test ${testRef}”`);
  }
  if (!(authoring.reauthorMax >= 0 && authoring.reauthorMax <= AUTHORING_REAUTHOR_MAX)) problems.push(`authoring.reauthorMax: între 0 și ${AUTHORING_REAUTHOR_MAX}`);
  if (authoring.proofRuns !== AUTHORING_PROOF_RUNS) problems.push(`authoring.proofRuns: exact ${AUTHORING_PROOF_RUNS} rulări de dovadă`);
  if (authoring.controls !== controlsFor) problems.push(`authoring.controls: „${controlsFor}” pentru ${spec.workType || "acest tip"}`);
  if (authoring.author !== "claude") problems.push("authoring.author: testul îl scrie Claude (doar citire)");
  if (authoring.testReviewer !== "codex") problems.push("authoring.testReviewer: testul îl verifică Codex (doar citire)");
  // The Hub's own paths stay visible to its snapshots: an ignore equal to, above or under the work area or the test folder would hide
  // the staged test from every step-0 check (each would stop as "the project changed") and the work area from the writer's integrity check.
  const hubPaths = [AUTHORING_STAGING_DIR.split("/")[0], AUTHORING_TEST_DIR].map((p) => p.toLowerCase());
  for (const rel of spec.workspace.ignore) {
    const lower = rel.toLowerCase();
    if (hubPaths.some((h) => lower === h || lower.startsWith(`${h}/`) || h.startsWith(`${lower}/`))) {
      problems.push(`workspace.ignore: „${rel}” acoperă zona de lucru a Hub-ului sau testul scris de Hub (${AUTHORING_STAGING_DIR.split("/")[0]}, ${AUTHORING_TEST_DIR}); nu poate fi ignorat`);
    }
  }
  // NaN is not JSON: a non-integer is kept as null so the stored draft still reports the problem on its next revision.
  for (const key of ["reauthorMax", "proofRuns"]) if (!Number.isInteger(authoring[key])) authoring[key] = null;
  return { authoring, problems };
}

/** Normalizes and validates a spec; throws a validation error listing every problem. */
export function normalizeSpec(input = {}, options = {}) {
  const { spec, problems } = checkSpec(input, options);
  if (problems.length) throw new HubError("validation", `Specificația nu e validă: ${problems.join("; ")}`, { data: { problems } });
  return spec;
}

export const specHash = (spec) => hashCanonical(spec);

/** The acceptance test files the approved scope protects (unique relative paths). */
export const protectedTestRefs = (spec) => [...new Set(spec.acceptance.filter((a) => a.testRef).map((a) => a.testRef))];

/**
 * The approved E2E steps of a criterion as brief lines: the writer and the reviewer see exactly what the Hub will run (texts,
 * selectors), read-only. Without them a correct implementation with other wording or ids could never pass the criterion.
 */
export const e2eStepLines = (a) => (a.verify === "e2e" && Array.isArray(a.steps) && a.steps.length
  ? [`  Pașii E2E aprobați (Hub-ul îi rulează în Chromium pe preview; nu îi schimba, implementarea trebuie să-i satisfacă exact; „{run}” din fill și expectText devine un cod unic la fiecare rulare): ${a.steps.map((step, i) => `${i + 1}. ${JSON.stringify(step)}`).join(" ")}`]
  : []);

/** Short, owner-facing summary of a spec (Lega, lists). */
export function specSummary(spec) {
  return `${spec.workType} · ${spec.title}: ${spec.acceptance.length} criterii (${spec.acceptance.filter((a) => a.verify === "test").length} prin test), verificare ${spec.verification.acceptance.join(", ")}`;
}
