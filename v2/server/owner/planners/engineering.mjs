// M10.2 (U09) engineering planner: a code request in the owner's words ("repară …", "adaugă …", "refactorizează …") becomes ONE
// Software Factory draft plus ONE envelope (the plan card the owner confirms once). Before M10.2 the same request became a
// lega.mission_request approval card (ALWAYS_ASK), then a draft with no models (PLAN_INCOMPLETE), then grant forms; the owner
// clicked three times and still had no plan.
//
// - The draft has no effects: nothing runs, nothing is granted. Under voice-first it needs no approval card (owner decision 1):
//   the envelope is the only confirmation, and the envelope hash covers the spec, the plan, the models, the limits and the route.
// - Models are explicit, always: the project's owner override (factory.defaults.set, fresh owner session) or the role defaults
//   (factory/plan.mjs ROLE_DEFAULT_BINDINGS) — written into the draft's limits, so they are in the scope hash, shown on the card
//   ("Modele: …") and hashed into the envelope (owner decision 4). The account default model is never used.
// - The Hub's own repository is refused, always (decision 10), and a project without execution rights is refused, before any
//   draft exists; other blockers are explained once from verified state (owner/blockers.mjs) and the request is preserved.
// - M11 L5 (design .ifrim/M11_L5_DESIGN.md §2): a request with no existing test to bind becomes a TEST-FIRST plan — its step 0 is the
//   Hub writing the acceptance test from the owner's words (Claude proposes it read-only, the Hub proves twice that it fails on today's
//   code for the right reason, Codex reviews it read-only, then the Hub protects it). The owner never writes, names or picks a file and
//   confirms ONCE; the „pick one of the tests found” question and the L4 „vine curând” message are gone (owner decision Q3). The routes:
//     A a named test file that exists → bound and protected (unchanged);
//     B a named test file that does not exist → ONE plain message; it is never replaced by another test; nothing is kept (D21 rule);
//     C D21 „named”: the words name „testul de acceptanță” and the project has ONE acceptance-named test → bound (probe step D);
//     D the acceptance test named while the project has none or several → ONE plain question, without file names;
//     E D21 „described”: a BUGFIX naming no test, the project's ONE acceptance test → bound (unchanged);
//     F PF-04 „Adaugă / Scrie un test de acceptanță…” → test-first (a test that already passes is not kept: the owner decides, Q2);
//     G PF-03: a BUGFIX naming another test („testul de login”) → the ONE test file whose name holds that topic (autoBound "topic"),
//       otherwise test-first;
//     H any other BUGFIX / FEATURE → test-first;
//     I a REFACTOR with no test → ONE plain message (the Hub's characterization test is L5b); nothing kept;
//     J test-first outside a `hub-test` project on the Windows route (ProDelivery named explicitly) → T1; nothing kept. The factory
//       refuses the same at start, whatever built the spec, and the plan card shows it as a blocker (envelopes readiness).
//   The bound test is protected: the writer repairs the implementation, never the test (said on the card and in the spec the writer
//   reads). Hub-written tests (test/hub/) are never bound by D21 or by topic. A programmer's bare test path said within 2 minutes still
//   completes the request — after a test-first card too: the new plan replaces it (critique B10).
// - Draft cleanup: a draft this planner created and nobody started is cancelled when its plan is superseded, expires or is
//   cancelled, or when the preserved request it belongs to is cancelled or expires. A draft the owner made (no intake provenance)
//   or one that already started is never touched.
import fs from "node:fs";
import { experimentDataset } from "../../factory/dataset.mjs";
import crypto from "node:crypto";
import path from "node:path";
import { HubError } from "../../core/errors.mjs";
import { hashCanonical, sha256 } from "../../core/canonical.mjs";
import { redactText } from "../../security/redact.mjs";
import { normalize } from "../intents.mjs";
import { checkSpec, isAllowedCommand, protectedTestRefs } from "../../factory/spec.mjs";
import { defaultModelLimits, ROLE_DEFAULT_BINDINGS, limitsHaveModels, turnTimeoutsOf } from "../../factory/plan.mjs";
import { plannedTestRefs, deriveIgnore, testFirstScope, HUB_TEST_DIR, STAGING_DIR, T_ROUTE_MISSING_TEST, T_ROUTE_ASK_BEHAVIOUR, T_ROUTE_REFACTOR, T_PLANNER_NOTE } from "../../factory/test-first.mjs";
import { collectFacts, onlyAfterConfirmation, readinessPassFor } from "../readiness-runner.mjs";
import { explain } from "../blockers.mjs";
import { deriveCriteria, conflictingHubTests, requestShape } from "./criteria.mjs";
import { publicReadRoutes, readPublicClient, retirementContract } from "../../factory/supersede.mjs";

/** An open question (the project, the acceptance test) is answerable for 2 minutes, like the intake's own clarifications. */
export const ENGINEERING_LIMITS = Object.freeze({ pendingTtlMs: 2 * 60 * 1000, pendingMax: 50, candidateMax: 6, scanDepth: 2 });
const KIND_HINTS = Object.freeze({ bug: "BUGFIX", bugfix: "BUGFIX", fix: "BUGFIX", feature: "FEATURE", functionalitate: "FEATURE", refactor: "REFACTOR", refactoring: "REFACTOR" });
/**
 * M11 L5 review (flow #3): Lega's propose_mission template (args.missionKind, domain/missions.mjs MISSION_TEMPLATES) is an explicit
 * hint too — before, it was ignored, so an eng_refactor became a FEATURE (a test-first plan asking for a test that fails today, the
 * opposite of a refactor) and an eng_bugfix lost the BUGFIX control rule.
 */
const MISSION_KIND_HINTS = Object.freeze({ eng_bugfix: "BUGFIX", eng_feature: "FEATURE", eng_refactor: "REFACTOR" });
const WORK_TYPES = new Set(["BUGFIX", "FEATURE", "REFACTOR"]);
const TEST_FILE = /\.(?:test|spec)\.(?:mjs|cjs|js)$/i;
const TEST_IN_TEXT = /(?:^|[\s„"'(])((?:\.\/)?[\w-]+(?:\/[\w.-]+)*\.(?:test|spec)\.(?:mjs|cjs|js))(?=$|[\s.,;:!?”"')])/i;
const TEST_DIRS = Object.freeze(["test", "tests", "__tests__", "spec"]);
const OPEN_ENVELOPE = ["CONFIRMED", "ACTIVE", "WAITING_OWNER"];
const DRAFT_CLOSERS = new Set(["SUPERSEDED", "EXPIRED", "CANCELLED"]);
const LEGA_PREFIX = /^\s*(?:(?:hei|hey|bun[ăa])\s+)?lega[\s,!.:-]+/i;
/** A file name (normalized: no diacritics, lower case) that says it is an acceptance test: acceptance.test.mjs, acceptanta-login.test.js. */
const ACCEPTANCE_FILE = /accept(?:ance|anta)/;
/** The owner's words name the acceptance test without its path („testul de acceptanță”, „acceptance test”), on normalized text. */
const NAMES_ACCEPTANCE = /\btest(?:ul|ului|ele|elor|e)?\s+(?:de\s+)?(?:acceptanta|acceptantei|acceptance)\b|\bacceptance[\s-]+tests?\b/;
/**
 * 2.12.1 round 2 (PF-03): the words name SOME test („Repară testul de login care pică”, „Repară testul login”). When it is not the
 * acceptance test, a described bug is not bound to the acceptance test: the owner named another one, so the one question stays.
 */
const NAMES_A_TEST = /\btest(?:ul|ului|ele|elor|e|s)?\b/;
/**
 * PF-04: the acceptance test is the OBJECT of a create verb („Adaugă un test de acceptanță…”, „Scrie testul de acceptanță…”, „Fă /
 * creează / generează un test nou de acceptanță”, „Write an acceptance test”): the owner asks for a NEW test, so the existing one is
 * neither bound nor protected for it (the spec would forbid the very change asked for). Only articles and adjectives may stand between
 * the verb and the test („Adaugă în proiect un test de acceptanță” too); „Scrie codul care face să treacă testul de acceptanță” keeps it.
 */
const CREATE_VERB = String.raw`(?:adauga|adaugi|adaugati|scrie|scrii|scrieti|creeaza|creezi|creati|fa|faci|faceti|genereaza|generezi|generati|pregateste|pregatesti|add|write|create|make|generate)`;
const BETWEEN = String.raw`(?:si|un|o|niste|inca|alt|alte|alti|nou|noua|noi|primul|prima|cel|cea|cei|mai|in|pe|la|proiect|proiectul|aici|acum|a|an|the|new|another)`;
/**
 * M11 L5 review (flow #4): „Fă testul de acceptanță SĂ TREACĂ” (or „să meargă”, „să fie verde”, „Make the acceptance test pass”) asks for
 * the code to make the EXISTING test pass, not for a new test: a pass clause right after the test noun cancels the create reading, so the
 * project's one acceptance test is bound (route C). „Adaugă un test de acceptanță CARE să treacă doar când …” still creates one.
 */
const PASS_CLAUSE = String.raw`(?!\s+(?:sa\s+(?:treaca|mearga|functioneze|fie\s+verde|reuseasca)|to\s+pass|pass(?:es)?)\b)`;
const CREATES_ACCEPTANCE = new RegExp(String.raw`\b${CREATE_VERB}(?:-mi|-ne)?(?:\s+${BETWEEN}\b)*\s+(?:test(?:ul|ele|e)?\s+(?:(?:nou|noua|noi)\s+)?(?:de\s+)?(?:acceptanta|acceptance)\b|acceptance[\s-]+tests?\b)${PASS_CLAUSE}`);
/** At most this many acceptance-named files are collected: one decides, two already mean „ask”. */
const ACCEPTANCE_SCAN_MAX = 5;
/**
 * M11 L5 (§4 „Termenul misiunii”): a test-first draft's mission deadline (shown on the card, hashed with the limits; 10–480 allowed): step
 * 0 adds an author turn, two proof runs and a test review before the implementation.
 */
export const TEST_FIRST_MAX_DURATION_MIN = 180;
/** The Hub's own test folder (test/hub/): a Hub-written test is never bound by D21 or by topic (critique B2). */
const HUB_TEST_DIR_LOWER = HUB_TEST_DIR.toLowerCase();
/**
 * M11 L5 (§2 route G): the words after a test word that are not its topic. Skipped: prepositions, articles and plain adjectives
 * („testul NOU DE login”); a stop word ends the search for that test word („testele CARE pică” names no topic).
 */
const TOPIC_FILLERS = new Set(["de", "pentru", "la", "al", "a", "ai", "ale", "cu", "pe", "din", "despre", "of", "for", "the", "nou", "noua", "noi", "vechi", "existent", "existenta",
  "automat", "automata", "unitar", "unitara", "principal", "principala"]);
const TOPIC_STOP = new Set(["care", "ce", "cel", "cea", "cei", "cele", "meu", "mea", "tau", "ta", "lui", "ei", "lor", "asta", "acesta", "aceasta", "acela", "aceea", "ala", "aia",
  "si", "sa", "nu", "mai", "tot", "toate", "toti", "un", "o", "este", "e", "sunt", "pica", "picat", "merge", "mergea", "trece", "esueaza", "rosu", "cazut",
  "that", "which", "is", "are", "fails", "failing", "broken"]);
/** The first sentence of route B (the same words as T_ROUTE_MISSING_TEST), followed by the reason when the Hub cannot write the test. */
const missingHead = (name) => `Nu găsesc testul „${name}”; nu îl înlocuiesc cu altul.`;

/** BUGFIX / FEATURE / REFACTOR from an explicit hint, else from the words (a bug word wins over a refactor word). */
export function workTypeOf(text, hint = "") {
  const h = String(hint || "").trim();
  if (WORK_TYPES.has(h.toUpperCase())) return h.toUpperCase();
  if (KIND_HINTS[normalize(h)]) return KIND_HINTS[normalize(h)];
  if (Object.hasOwn(MISSION_KIND_HINTS, h.toLowerCase())) return MISSION_KIND_HINTS[h.toLowerCase()];
  const n = normalize(text);
  if (/\b(bug|buguri|eroare|erori|eroarea|repara|repar|reparam|fix|fixeaza|nu merge|nu functioneaza|crapa|greseala|gresit|defect|regresie)\b/.test(n)) return "BUGFIX";
  if (/\b(refactor|refactorizeaza|refactorizare|restructureaza|curata codul|simplifica codul)\b/.test(n)) return "REFACTOR";
  return "FEATURE";
}

/** A short title from the owner's sentence (first clause, ≤ 80 chars, without "Lega,"). */
function titleOf(text) {
  const clean = String(text || "").replace(LEGA_PREFIX, "").replace(/\s+/g, " ").trim();
  const first = clean.split(/(?<=[.!?])\s|;\s/)[0] || clean;
  const cut = first.length > 80 ? `${first.slice(0, 77).replace(/\s+\S*$/, "")}…` : first;
  const t = cut.replace(/[.!?]+$/, "");
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "";
}

/** A test path said (almost) alone — „testul e test/acceptance.test.mjs” — answers the open question; a whole new request does not. */
function bareTestPath(words) {
  const m = String(words || "").match(TEST_IN_TEXT);
  if (!m) return null;
  const rest = normalize(String(words).replace(m[1], " ").replace(LEGA_PREFIX, " ")).replace(/\b(testul|testului|fisierul|fisier|test|de|acceptanta|este|e|in|cu|foloseste|pe|asta|acesta|acela|da)\b/g, " ").replace(/[.,;:!?\-\u0001]/g, " ").trim();
  return rest.length <= 3 ? m[1].replace(/^\.\//, "") : null;
}

/** A relative path inside the project (no "..", not absolute) that is an existing test file, or null. */
function existingTestRef(projectPath, raw) {
  const rel = String(raw || "").trim().split("\\").join("/").replace(/^\.\//, "");
  if (!rel || rel.startsWith("/") || /^[a-z]:/i.test(rel) || rel.split("/").includes("..") || !TEST_FILE.test(rel)) return null;
  if (!isAllowedCommand(`node --test ${rel}`)) return null;
  const abs = path.resolve(projectPath, rel);
  if (!abs.toLowerCase().startsWith(path.resolve(projectPath).toLowerCase() + path.sep.toLowerCase())) return null;
  try { return fs.statSync(abs).isFile() ? rel : null; } catch { return null; }
}

/**
 * Existing test files under the usual test folders that `accept(name)` keeps (bounded walk; names only, no content read). `max` is
 * checked per folder (the candidate list's long-standing behaviour); `strict` also stops inside a folder. `skipHubTests` leaves out the
 * Hub's own test folder (test/hub/, M11 L5): a test the Hub wrote for an earlier mission is never a candidate.
 */
function walkTests(projectPath, { accept = () => true, max = 40, strict = false, skipHubTests = false } = {}) {
  const out = [];
  const walk = (dir, rel, depth) => {
    if (out.length >= max || depth > ENGINEERING_LIMITS.scanDepth) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (strict && out.length >= max) return;
      if (e.name.startsWith(".") || e.name === "node_modules") continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!(skipHubTests && r.toLowerCase() === HUB_TEST_DIR_LOWER)) walk(path.join(dir, e.name), r, depth + 1); }
      else if (e.isFile() && TEST_FILE.test(e.name) && accept(e.name) && isAllowedCommand(`node --test ${r}`)) out.push(r);
    }
  };
  for (const d of TEST_DIRS) walk(path.join(projectPath, d), d, 1);
  return out;
}

/**
 * M10.2.1 (D21): the project's test files whose NAME says acceptance (case and diacritics ignored), at most ACCEPTANCE_SCAN_MAX. M11 L5
 * (critique B2): never under test/hub/ — a Hub-written test of an earlier mission is not the project's acceptance test for a new request.
 */
export function acceptanceCandidates(projectPath) {
  return walkTests(projectPath, { accept: (name) => ACCEPTANCE_FILE.test(normalize(name)), max: ACCEPTANCE_SCAN_MAX, strict: true, skipHubTests: true }).sort((a, b) => a.localeCompare(b));
}

/**
 * M11 L5 (§2 route G): the topic a request names right after a test word, on normalized words („testul de login care pică” → "login",
 * „testul nou de export” → "export"), or null („testele care pică”, „testul de acceptanță”, a word under 3 letters).
 */
export function namedTopic(plain) {
  const tokens = String(plain || "").split(/[^a-z0-9_-]+/).map((w) => w.replace(/^[-_]+|[-_]+$/g, "")).filter(Boolean);
  for (let i = 0; i < tokens.length; i += 1) {
    if (!/^test(?:ul|ului|ele|elor|e|s)?$/.test(tokens[i])) continue;
    for (let j = i + 1; j < Math.min(tokens.length, i + 5); j += 1) {
      const w = tokens[j];
      if (TOPIC_FILLERS.has(w)) continue;
      if (w.length >= 3 && !TOPIC_STOP.has(w) && !ACCEPTANCE_FILE.test(w) && !/^test/.test(w) && !/^\d+$/.test(w)) return w.slice(0, 40);
      break;
    }
  }
  return null;
}

/**
 * M11 L5 (§2 route G): whether a test file NAME holds the topic as a whole word of it — the name (without .test.mjs) split on `-`, `_`,
 * `.` and spaces. A topic of 4+ letters may also be the start of a word (inflected forms: "login" in logins.test.mjs); a 3-letter topic
 * must be a whole word. Review (authority #1): a substring match bound catalog.test.mjs to „testul de log” without a question.
 */
export function nameHoldsTopic(name, topic) {
  const t = String(topic || "");
  if (t.length < 3) return false;
  const words = normalize(String(name || "").replace(TEST_FILE, "")).split(/[-_.\s]+/).filter(Boolean);
  return words.some((w) => w === t || (t.length >= 4 && w.startsWith(t)));
}

/** M11 L5 (§2 route G): the test files (at most 2: one decides, two already mean „write the test”) whose NAME holds the topic; never test/hub/. */
export function topicCandidates(projectPath, topic) {
  const t = String(topic || "");
  if (t.length < 3) return [];
  return walkTests(projectPath, { accept: (name) => nameHoldsTopic(name, t), max: 2, strict: true, skipHubTests: true }).sort((a, b) => a.localeCompare(b));
}

/**
 * M11 L5 (§5.1): what already sits at the Hub's own paths for this request — the files in test/hub/ and .ifrim-hub/staging/ whose name
 * starts with `prefix` ("<slug>-<h6>"), as {rel: sha256 | null} (null: there, but not a plain file the planner can read). plannedTestRefs
 * then reuses a staging path only when it holds exactly the Hub's recorded write, and skips to -2 … -9 otherwise. Bounded.
 */
function hubPathsOnDisk(projectPath, prefix) {
  const out = {};
  const want = String(prefix || "").toLowerCase();
  for (const dir of [HUB_TEST_DIR, STAGING_DIR]) {
    let entries = [];
    try { entries = fs.readdirSync(path.join(projectPath, ...dir.split("/")), { withFileTypes: true }); } catch { continue; }
    for (const e of entries.slice(0, 500)) {
      if (!e.name.toLowerCase().startsWith(want)) continue;
      const rel = `${dir}/${e.name}`;
      let sha = null;
      try {
        const abs = path.join(projectPath, ...rel.split("/"));
        const st = fs.lstatSync(abs);
        if (st.isFile() && st.size <= 1024 * 1024) sha = sha256(fs.readFileSync(abs));
      } catch { sha = null; }
      out[rel] = sha;
    }
  }
  return out;
}

function readGitignore(projectPath) {
  try { return fs.readFileSync(path.join(projectPath, ".gitignore"), "utf8").slice(0, 64 * 1024); } catch { return ""; }
}

function readScripts(projectPath) {
  try { return JSON.parse(fs.readFileSync(path.join(projectPath, "package.json"), "utf8"))?.scripts || {}; } catch { return {}; }
}

/** The request's hints without the test files it named (kept for the 2-minute answer: a path that was not found is not asked for again). */
function withoutTestRefs(args = {}) {
  const { testRef: _testRef, chosenId: _chosenId, ...rest } = args || {};
  if (Array.isArray(rest.acceptance)) rest.acceptance = rest.acceptance.map((a) => (a && typeof a === "object" ? { text: a.text } : a));
  return rest;
}

/**
 * The spec input for factory.prepare from the owner's words and the (bounded, validated) structured hints a client may add
 * (Lega's request tool: kind hint, acceptance texts, the test file). Returns { input, problems, testRef, workType, autoBound, route,
 * testFirst, missing, topic }; `problems` are checkSpec's, so "verifiable" means exactly what the factory will accept at approval.
 *  - `route`: the row of the §2 table (A–I; J is the planner's: it knows the project's source and route) — see the file header;
 *  - `testRef` / `autoBound` ("named" | "described" | "topic" | null): the EXISTING test bound and protected (A, C, E, G), with how it was
 *    found without a question (M10.2.1, M11 L5);
 *  - `testFirst` ({ ok, testRef, stagingRef, criteria, problem }): the Hub-written test's paths when the plan's step 0 writes it (F, G
 *    with no single topic file, H); the spec then carries `authoring`, `workspace.ignore` (from .gitignore, §5.1 S1) and its acceptance
 *    command, and `testRef` stays null (no existing test is bound);
 *  - `missing`: the named test that does not exist (B), as said.
 * `hubWrites` ({stagingRef: sha256}, factory.hubWrites) lets an abandoned step 0's own file be reused at the same path (§5.1).
 */
export function buildEngineeringSpec({ text, args = {}, project, hubWrites = {}, hubTests = [] }) {
  const words = String(text || "").replace(LEGA_PREFIX, "").replace(/\s+/g, " ").trim();
  const workType = workTypeOf(words, args.workType || args.kindHint || args.kind_hint || args.missionKind || "");
  const said = [args.testRef, ...(Array.isArray(args.acceptance) ? args.acceptance.map((a) => (a && typeof a === "object" ? a.testRef : null)) : []), (words.match(TEST_IN_TEXT) || [])[1]].filter(Boolean);
  let named = said.map((r) => existingTestRef(project.path, r)).find(Boolean) || null;
  // A: a test file said (by the words, a hint or the 2-minute answer) that exists. B: said, but none of them exists — never replaced.
  let route = named ? "A" : said.length ? "B" : null;
  let autoBound = null;
  let topic = null;
  const plain = normalize(words);
  const namesAcceptance = NAMES_ACCEPTANCE.test(plain);
  const createsAcceptance = CREATES_ACCEPTANCE.test(plain);
  const namesTest = NAMES_A_TEST.test(plain);
  // M10.2.1 (D21) C / E: no test file said, the words name the acceptance test (C) or describe a bug naming no test (E) → the project's
  // ONLY acceptance-named test file (never under test/hub/), re-checked like a named one. 2.12.1 round 2: never when the owner asks to
  // CREATE the acceptance test (PF-04 → F).
  if (!route && !createsAcceptance && (namesAcceptance || (workType === "BUGFIX" && !namesTest))) {
    const only = acceptanceCandidates(project.path);
    if (only.length === 1) {
      named = existingTestRef(project.path, only[0]);
      if (named) { autoBound = namesAcceptance ? "named" : "described"; route = namesAcceptance ? "C" : "E"; }
    }
  }
  // M11 L5 G (PF-03): a bug that names ANOTHER test („Repară testul de login care pică”) binds the one test file whose name holds that
  // topic; none or several → the Hub writes the test (below).
  if (!route && !createsAcceptance && !namesAcceptance && workType === "BUGFIX" && namesTest) {
    topic = namedTopic(plain);
    const found = topic ? topicCandidates(project.path, topic) : [];
    if (found.length === 1) {
      named = existingTestRef(project.path, found[0]);
      if (named) { autoBound = "topic"; route = "G"; }
    }
  }
  // No existing test bound: I (a refactor: the characterization test is L5b), F (PF-04), D (the acceptance test named, none or several),
  // G (a bug naming another test, no single file), H (anything else). F, G and H are test-first.
  if (!route) route = workType === "REFACTOR" ? "I" : createsAcceptance ? "F" : namesAcceptance ? "D" : workType === "BUGFIX" && namesTest ? "G" : "H";
  const writesTest = !named && ["F", "G", "H"].includes(route);
  const title = titleOf(String(args.title || "").trim() || words);
  const finalTitle = title.length >= 3 ? title : "Cerință de engineering";
  const criteria = (Array.isArray(args.acceptance) ? args.acceptance : []).map((a) => String(typeof a === "string" ? a : a?.text || "").replace(/\s+/g, " ").trim()).filter((s) => s.length >= 5).slice(0, 8);
  const scripts = readScripts(project.path);
  const checks = (Array.isArray(args.verification?.checks) ? args.verification.checks : []).map((c) => String(c || "").trim().replace(/\s+/g, " ")).filter(isAllowedCommand).slice(0, 4);
  // M11 L5 (§5.1): the Hub-written test's final and staging paths, deterministic per (project, work type, words) — so a repeated request
  // finds its own draft again — reusing a staging path only at exactly the Hub's own recorded bytes.
  let testFirst = null;
  if (writesTest) {
    const request = { projectId: project.id || "", workType, objective: words, title: finalTitle };
    const first = plannedTestRefs(request);
    const refs = plannedTestRefs(request, { existing: hubPathsOnDisk(project.path, `${first.slug}-${first.h6}`), hubWrites });
    testFirst = { ok: refs.ok, testRef: refs.testRef, stagingRef: refs.stagingRef, criteria: [], problem: refs.problem };
  }
  const bound = named || (testFirst?.ok ? testFirst.testRef : null);
  // M11 L5 review (flow #7, design §2 „Ce va dovedi testul: AC-1 — „{cuvintele tale}””): a Hub-written test's default criterion is the
  // owner's words as said, without the „Cerința ta este îndeplinită:” prefix; a bound (existing) test keeps its criterion byte for byte (U1).
  const defaultCriterion = testFirst?.ok ? words.slice(0, 300) : `Cerința ta este îndeplinită: ${words.slice(0, 300)}`;
  // §25 (2026-10-08): a software revision of a delivered demo keeps the demo's own proof — the local preview and the browser flows on
  // phone and desktop width — so the new version can be filmed again under the same ONE card. Only a test project's delivery passes
  // `inheritDemo`; the inherited criteria are renumbered after the owner's and stay ordinary acceptance criteria (a flow the change
  // breaks fails the mission honestly; it is never dropped).
  const inherit = project?.source === "hub-test" && args.inheritDemo && typeof args.inheritDemo === "object" ? args.inheritDemo : null;
  const inheritedFlows = inherit ? (Array.isArray(inherit.criteria) ? inherit.criteria : []).filter((c) => ["preview", "e2e"].includes(c?.verify)) : [];
  // §25 closure: a Hub-written test with no structured criteria derives the checks the request's shape needs (planners/criteria.mjs)
  // instead of one sentence; a structured list (Lega's tool, the 2-minute answer) or an existing bound test keep their criteria.
  const derived = testFirst?.ok && !criteria.length ? deriveCriteria({ words, flows: inheritedFlows.filter((c) => c.verify === "e2e") }) : null;
  const useDerived = Boolean(derived && derived.test.length);
  const acceptance = !bound ? [] : useDerived
    ? derived.test.map((c, i) => ({ id: `AC-${i + 1}`, text: c.text, verify: "test", testRef: bound, ...(c.guard ? { guard: true } : {}), origin: c.origin, ...(c.kind ? { kind: c.kind } : {}) }))
    : (criteria.length ? criteria : [defaultCriterion]).map((t, i) => ({ id: `AC-${i + 1}`, text: t, verify: "test", testRef: bound }));
  let inheritedPreview = null;
  if (inherit && acceptance.length) {
    // The flows first (the delivery films the first phone-width and the first desktop flow), then the derived browser checks.
    const flows = useDerived ? inheritedFlows.map((c) => (c.verify === "e2e" ? derived.flows.find((d) => d.id === c.id) || c : c)) : inheritedFlows;
    flows.forEach((c) => acceptance.push({ ...c, id: `AC-${acceptance.length + 1}` }));
    if (inherit.preview?.command && inherit.preview?.url) inheritedPreview = { command: String(inherit.preview.command), url: String(inherit.preview.url) };
  }
  if (useDerived && acceptance.length) derived.browser.forEach((c) => acceptance.push({ ...c, id: `AC-${acceptance.length + 1}` }));
  if (bound) acceptance.push({ id: `AC-${acceptance.length + 1}`, text: "Modificarea e explicată și revizuită independent (doar citire)", verify: "review" });
  if (testFirst?.ok) testFirst.criteria = acceptance.filter((a) => a.verify === "test").map((a) => a.id);
  // R-PRIV: an earlier Hub-written test that read the field back from the app's answers belongs to the earlier contract. It is named on
  // the card, kept unchanged and linked to its version, and moved out of the active suite at the start — never rewritten to pass.
  // Closure R-SUP: the heuristic only proposes; a candidate is retired only with its explicit contract (provenance, the public route the
  // conflicting case reads — a route the project's own public page reads —, every other case covered by a new check of the same kind).
  // A candidate without it stays active and the card says why (nothing is moved on a guess).
  const candidates = useDerived && derived.shape === "hide_public" ? conflictingHubTests({ field: requestShapeField(words), hubTests }) : [];
  const supersedes = [];
  if (candidates.length) {
    const publicRoutes = publicReadRoutes(readPublicClient(project.path));
    const next = derived.test.map((c, i) => ({ id: `AC-${i + 1}`, kind: c.kind || null }));
    for (const x of candidates) {
      const source = hubTests.find((t) => t.ref === x.testRef);
      const built = retirementContract({ candidate: x, text: source?.text, key: requestShapeField(words)?.key, publicRoutes, previous: source?.previousSpec || null, next });
      if (built.ok) supersedes.push({ ...x, contract: built.contract });
      else {
        derived.constraints.push(`Testul anterior ${x.testRef} pare să contrazică cerința nouă, dar rămâne activ și neschimbat: ${built.problem}. Dacă implementarea îl pică, decizi tu`);
        derived.assumptions.push(`Hub-ul nu retrage ${x.testRef} fără dovadă (${built.problem})`);
      }
    }
  }
  if (supersedes.length) {
    derived.constraints.push(...supersedes.map((x) => `Testul anterior ${x.testRef}${x.missionId ? ` (misiunea ${x.missionId}${x.specVersion ? `, specificația v${x.specVersion}` : ""})` : ""} e incompatibil cu cerința nouă: ${x.reason}. Hub-ul îl păstrează neschimbat (sha ${x.sha256.slice(0, 12)}) în .ifrim-hub/retired/, legat de versiunea originală, și nu îl mai rulează; nu se rescrie`),
      ...supersedes.map((x) => `Diferența de contract pentru ${x.testRef}: ${x.contract.conflicts.map((c) => `${c.case} citea ${x.contract.field} din ${c.routes.join(", ")} (lista publică) → înlocuit de ${c.replacedBy.join(", ")}`).join("; ")}${x.contract.kept.length ? `; ${x.contract.kept.map((k) => `${k.case} (${k.kind}) rămâne acoperit de ${k.coveredBy.join(", ")}`).join("; ")}` : ""}${x.contract.internalReads.length ? `; citirile interne (${x.contract.internalReads.join(", ")}) rămân compatibile` : ""}`));
    derived.assumptions.push(`Contractul vechi și cel nou se contrazic la ${supersedes.length === 1 ? "un test" : `${supersedes.length} teste`} scris${supersedes.length === 1 ? "" : "e"} de Hub înainte; criteriile noi verifică separat păstrarea internă și neexpunerea publică`);
  }
  let dataset = null;
  if (derived?.shape === "hide_public" && project.source === "hub-test") {
    const declared = experimentDataset(project.path);
    if (declared?.ok && requestShapeField(words)?.key === declared.dataset.field) dataset = declared.dataset;
    else if (declared?.ok === false && requestShapeField(words)?.key === "phone") derived.assumptions.push("Datele martor nu sunt declarate deoarece sursele inițializării diferă de cele declarate.");
  }
  const checkCommand =checks.length ? checks : [scripts.test && !/^\s*node --test\b/.test(String(scripts.test)) ? "npm test" : "node --test"];
  const input = {
    workType, title: finalTitle, objective: words,
    spec: testFirst?.ok ? {
      ...(derived?.changesExisting ? { changesExisting: true } : {}),
      ...(derived?.hubHelpers ? { hubHelpers: derived.hubHelpers } : {}),
      ...(dataset ? { dataset } : {}),
      inScope: (Array.isArray(args.inScope) ? args.inScope : []).map((s) => String(s).slice(0, 300)).filter(Boolean).slice(0, 10),
      outOfScope: ["deploy, commit, push", "alte proiecte", "dependențe noi necerute de tine"],
      acceptance,
      constraints: ["Pregătită de Hub din cererea ta (fără model); criteriile sunt fixate înainte de implementare, iar testul de acceptanță îl scrie Hub-ul la pasul 0 din cuvintele tale (Claude propune textul, doar citire; Codex îl verifică, doar citire)",
        `Testul de acceptanță ${testFirst.testRef} îl scrie și îl protejează Hub-ul la pasul 0: repari implementarea, nu testul (o modificare a testului oprește misiunea)`,
        ...(useDerived ? derived.constraints : [])],
      verification: { checks: checkCommand, acceptance: [`node --test ${testFirst.testRef}`], ...(inheritedPreview ? { preview: inheritedPreview } : {}) },
      // §5.1 S1: the folders the tests write at run time (top-level folder entries of .gitignore), so a test that writes data is no
      // "left files behind" for the proof; checkSpec refuses src / test / public / the Hub's own work area.
      workspace: { ignore: deriveIgnore(readGitignore(project.path)) },
      authoring: { mode: "hub", testRef: testFirst.testRef, stagingRef: testFirst.stagingRef, criteria: testFirst.criteria,
        authorLimits: { maxOutputTokens: 64000, ...(dataset ? { turnTimeoutMin: 45 } : {}), provenance: "decizia proprietarului 2026-10-13 21:32 UTC: limită de ieșire 64000 doar pentru autorul testului de la pasul 0"
          + (dataset ? "; decizia proprietarului 2026-10-14 10:09 UTC: limită pe tură 45 min doar pentru autorul testului de la pasul 0 al planului §25 hub-test" : "") } },
      ...(supersedes.length ? { supersedes } : {}),
      sources: { user: [words], code: [], assumptions: ["Testul de acceptanță nu există încă: îl scrie Hub-ul la pasul 0 din cuvintele tale; trebuie să pice pe codul de acum din motivul potrivit, e verificat independent, apoi îl protejez",
        ...(useDerived ? [`Criteriile sunt derivate de Hub din cererea ta (tipul cererii: ${derived.shape}), fără model; cuvintele tale rămân cererea`, ...derived.assumptions] : [])] },
    } : {
      inScope: (Array.isArray(args.inScope) ? args.inScope : []).map((s) => String(s).slice(0, 300)).filter(Boolean).slice(0, 10),
      outOfScope: ["deploy, commit, push", "alte proiecte", "dependențe noi necerute de tine"],
      acceptance,
      constraints: ["Pregătită de Hub din cererea ta (fără model); criteriile și testul de acceptanță sunt fixate înainte de implementare",
        // M10.2.1: said where the writer reads it (the brief's „Restricții”), not only as the factory's protection list.
        ...(named ? [`Testul de acceptanță ${named} e protejat: repari implementarea, nu testul (o modificare a testului oprește misiunea)`] : [])],
      // The project's own test script when it is not plain node:test (npm test), else node --test directly (the same tests, no npm).
      verification: { checks: checkCommand, acceptance: named ? [`node --test ${named}`] : [], ...(inheritedPreview ? { preview: inheritedPreview } : {}) },
      sources: { user: [words], code: [], assumptions: named ? [autoBound === "topic"
        ? `Testul ${named} e singurul test al proiectului al cărui nume conține „${topic}”; l-am legat de cerință fără să te întreb (îl protejez la pornire)`
        : autoBound
          ? `Testul de acceptanță ${named} e singurul test de acceptanță al proiectului; l-am legat de cerință fără să te întreb (îl protejez la pornire)`
          : `Testul de acceptanță ${named} există deja în proiect și verifică cerința (îl protejez la pornire)`] : [] },
    },
  };
  const { problems, spec: checked } = checkSpec({ ...input.spec, workType, title: input.title, objective: input.objective });
  const inheritedOverflow = Boolean(inherit && checked.acceptance.length < acceptance.length);
  if (inheritedOverflow) problems.push(`Nu pot păstra toate cele ${acceptance.length} criterii: specificația acceptă cel mult 20. Nu elimin niciun flux moștenit; planul este refuzat.`);
  const missing = route === "B" ? String(said[0]).replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 120) : null;
  return { input, problems, testRef: named, workType, autoBound, route, testFirst, missing, topic: autoBound === "topic" ? topic : null, ...(inheritedOverflow ? { inheritedOverflow: true } : {}) };
}

/** R-PRIV: the field a hide_public request names (planners/criteria.mjs), for conflictingHubTests. */
function requestShapeField(words) { return requestShape(words).field || null; }

/**
 * The intake recorder for a planner's "blocked" answer (U06 work requests behind U07's applyPlannerOutcome): the request is kept
 * once (the same live request on the same project with the same words is reused, so the one-time rule holds across mentions),
 * and the full explanation is returned the first time per (request, blocker signature), the short line afterwards.
 */
export function createBlockedRecorder(hub) {
  // M12 final review (F7): an offer request keeps its own kind ("sales"), so it is explained and re-planned by the Sales rules.
  const intentOf = (i) => (i === "studio_create" ? "studio" : ["engineering", "engineering_request", "start_mission", "resume_mission"].includes(i) ? "engineering" : ["run", "analysis_request"].includes(i) ? "run"
    : ["sales", "sales_prepare"].includes(i) ? "sales" : "other");
  return {
    recordBlocked({ text = "", source = "typed", channel = "ui", projectId = null, intent = "engineering", effectClass = "", blocker = {}, actor = "owner", request = null } = {}) {
      const wr = hub.workRequests;
      if (!wr?.create || !wr?.explainOnce) return null;
      const kind = intentOf(intent);
      const words = redactText(String(text)).replace(/\s+/g, " ").trim().slice(0, 1000);
      const existing = (wr.openFor && projectId ? wr.openFor(projectId) : wr.list({ status: ["OPEN", "BLOCKED", "PLANNED", "CONFIRMED"], limit: 50 }))
        .find((r) => r.intent === kind && r.text === words && (r.projectId || null) === (projectId || null) && r.status !== "PLANNED");
      const row = existing || wr.create({ text, source, channel, projectId, intent: kind, effectClass, planRef: request?.planRef || null, actor });
      const full = request?.explanation?.blocked ? request.explanation : null;
      const options = Array.isArray(blocker.options) ? blocker.options : [];
      const explanation = full || { blocked: true, signature: String(blocker.signature || "BLOCKED"), cause: blocker.cause || null, causes: String(blocker.signature || "BLOCKED").split("+"),
        text: String(blocker.text || "Cererea e blocată acum; o păstrez."), short: "Încă blocat din același motiv; cererea ta e păstrată.", options,
        automaticOnly: options.length > 0 && options.every((o) => o.kind === "automatic_readiness") };
      const said = wr.explainOnce(row.id, explanation);
      return { id: row.id, status: said.request?.status || row.status, mode: said.mode, text: said.text || explanation.text, signature: said.signature };
    },
  };
}

/**
 * Registers the "engineering" planner on the intake and the draft cleanup on the bus. Returns { plan, defaultsFor, cleanupDraft,
 * isIntakeDraft } (also reachable as hub.engineeringPlanner for tests and for Lega's request tool).
 */
export function registerEngineeringPlanner(hub, intake) {
  const { db, bus, settings, projects, envelopes, config } = hub;
  const nowMs = () => (typeof config?.now === "function" ? config.now() : new Date()).getTime();
  /**
   * R-PRIV: the Hub-written tests already in the project (test/hub/*.test.mjs, at most 20, each ≤ 256 KiB) with their sha256 and, when an
   * approved spec of this project protected exactly those bytes, the mission and spec version they belong to. Read-only.
   */
  const earlierHubTests = (project) => {
    try {
      const dir = path.join(project.path, HUB_TEST_DIR);
      if (!fs.existsSync(dir)) return [];
      // Closure R-SUP-01: the owner is the approved spec of THIS project whose step 0 wrote and protected exactly these bytes at this path
      // (authoring PROTECTED, same testRef, same sha) — a name under test/hub and a hash alone are no provenance.
      const owners = db.prepare("SELECT fs.mission_id, fs.version, fs.protected_json, fs.spec_json FROM factory_specs fs JOIN missions m ON m.id = fs.mission_id WHERE m.project_id = ? AND fs.status = 'APPROVED' ORDER BY fs.created_at").all(project.id)
        .filter((o) => { try { const p = JSON.parse(o.protected_json || "{}"); return p.authoring?.status === "PROTECTED"; } catch { return false; } });
      return fs.readdirSync(dir).filter((n) => /^[a-z0-9][a-z0-9-]{0,63}\.test\.mjs$/.test(n)).sort().slice(0, 20).flatMap((name) => {
        const abs = path.join(dir, name);
        const st = fs.lstatSync(abs);
        if (!st.isFile() || st.size > 256 * 1024) return [];
        const buf = fs.readFileSync(abs);
        const ref = `${HUB_TEST_DIR}/${name}`;
        const digest = crypto.createHash("sha256").update(buf).digest("hex");
        const owner = owners.find((o) => { try { const p = JSON.parse(o.protected_json || "{}"); return p.authoring?.testRef === ref && p.files?.[ref] === digest; } catch { return false; } });
        let previousSpec = null;
        try { previousSpec = owner ? { acceptance: JSON.parse(owner.spec_json || "{}").acceptance || [] } : null; } catch { previousSpec = null; }
        return [{ ref, sha256: digest, text: buf.toString("utf8"), missionId: owner?.mission_id || null, specVersion: owner ? owner.version : null, previousSpec }];
      });
    } catch { return []; }
  };
  const pending = new Map(); // conversation key → { text, args, projectId, awaiting: "project"|"test"|"text", options, at }
  const inFlight = new Set(); // `${projectId}:${requestHash}`: the same request twice at once prepares one draft

  const isHubProject = (project) => Boolean(project) && (project.slug === "ifrim-agent-hub" || (config?.hubRoot && path.resolve(project.path).toLowerCase() === path.resolve(config.hubRoot).toLowerCase()));
  /** The route the project's Codex steps run on (the factory runner's own routing; Windows without an environment layer). */
  const routeOf = (project) => {
    try { return hub.factoryRunner?.routeOf ? hub.factoryRunner.routeOf(project) : hub.environments?.routeFor ? hub.environments.routeFor(project.id, "codex") : "windows"; } catch { return "unknown"; }
  };
  /**
   * M11 L5 (§4 „Domeniul v1”, route J): where the Hub may write the acceptance test itself — a `hub-test` project (never ProDelivery,
   * whatever its registration) on the Windows route, whose own test script does not also run the Hub's work area (§9). { ok, text }.
   */
  function scopeFor(project, { neutral = false } = {}) {
    return testFirstScope({ project, route: routeOf(project), testScript: readScripts(project.path).test || "", neutral });
  }
  /** The models an engineering plan on this project is built with (shown and hashed; never the account default). */
  function defaultsFor(projectId) {
    const override = (settings.get("factoryDefaultBindings") || {})[projectId] || null;
    return defaultModelLimits(override);
  }
  const keyOf = (ctx, session) => (session?.id ? `owner:${session.id}` : `channel:${ctx?.channel || "?"}`);
  function remember(key, entry) {
    if (pending.size >= ENGINEERING_LIMITS.pendingMax && !pending.has(key)) pending.delete(pending.keys().next().value);
    pending.set(key, { ...entry, at: nowMs() });
  }
  function take(key) {
    const p = pending.get(key);
    if (!p) return null;
    if (nowMs() - p.at > ENGINEERING_LIMITS.pendingTtlMs) { pending.delete(key); return null; }
    return p;
  }

  const isIntakeDraft = (missionId) => Boolean(db.prepare("SELECT 1 FROM events WHERE type = 'factory.provenance' AND scope_id = ? AND json_extract(payload_json, '$.createdBy') = 'intake' LIMIT 1").get(String(missionId || "")));
  /** An intake draft for the same words on this project that is still a draft (a repeated request re-presents it, never a second draft). */
  function sameDraft(projectId, requestHash) {
    const row = db.prepare(`SELECT e.scope_id AS mission_id FROM events e JOIN factory_missions f ON f.mission_id = e.scope_id
      WHERE e.type = 'factory.provenance' AND e.project_id = ? AND json_extract(e.payload_json, '$.createdBy') = 'intake' AND json_extract(e.payload_json, '$.requestHash') = ?
        AND f.stage = 'SPEC_DRAFT' AND f.approved_spec_version IS NULL ORDER BY e.seq DESC LIMIT 1`).get(projectId, requestHash);
    return row?.mission_id || null;
  }

  /** Blocked with the server's own explanation (U06), for the request as it stands; `planRef` when a draft exists to re-plan later. */
  async function blockedFor(project, { missionIds = [], forceHubRefusal = false, planRef = null } = {}) {
    const facts = await collectFacts(hub, { projectId: project.id, intent: "engineering", missionIds, plan: missionIds.length > 0 });
    // Decision 10: the Hub's own repository is never a Software Factory / Codex-write target — in test mode too (the factory itself
    // admits the fixture Hub only so its own suites can run; a planner never proposes it).
    if (forceHubRefusal) facts.hubSelfRefused = true;
    const ex = explain(facts);
    return { ex, out: ex.blocked ? { kind: "blocked", blocker: ex, text: ex.text, projectId: project.id, request: { planRef, explanation: ex } } : null };
  }

  async function plan({ step, text, projectId, source, ctx, session }) {
    const key = keyOf(ctx, session);
    let words = String(text || "").trim();
    let args = { ...(step?.args || {}) };
    let pid = projectId || null;
    // ONE open question (the project, the request in other words), or the 2 minutes after an answer without a bound test (a test-first
    // card included, M11 L5): the answer — a choice id for the project, a named test, or a bare path — completes the request it was
    // given for; anything else is a new request.
    // M11 L5 review (flow #1): the "test" memory is completed ONLY by a test file (a hint's testRef or a bare path), on the SAME project.
    // No choice is ever offered for it any more (the pick question is gone), so a choice id is never a test name: the intake's answer to
    // its own project question („Factory Demo Beta” → chosenId = the project's id) is a NEW request on that project, not a test called
    // „prj_…” for the previous one.
    const open = take(key);
    const saidTest = args.testRef || bareTestPath(words);
    if (open?.awaiting === "project" && (args.chosenId || (pid && !words))) {
      pid = args.chosenId || pid; words = open.text; args = { ...open.args }; pending.delete(key);
    } else if (open?.awaiting === "test" && saidTest && (!pid || pid === open.projectId)) {
      pid = pid || open.projectId; args = { ...open.args, testRef: saidTest }; words = open.text; pending.delete(key);
    } else if (open?.awaiting === "text" && words && !args.chosenId) {
      // The request said again in other words: the new words replace the old ones, on the same project.
      pid = pid || open.projectId; args = { ...open.args, ...args }; pending.delete(key);
    }
    delete args.chosenId;
    if (!words && !args.missionId) return { kind: "message", text: "Ce să schimb în cod? Spune-mi cerința (ce nu merge sau ce trebuie adăugat)." };

    // ---- the project
    const project = pid ? projects.get(pid) : null;
    if (!project) {
      const options = projects.list().filter((p) => p.executionAllowed && !isHubProject(p) && p.status !== "retired").slice(0, 6).map((p) => ({ id: p.id, label: p.name }));
      remember(key, { text: words, args, projectId: null, awaiting: "project", options });
      return { kind: "question", question: pid ? `Nu găsesc proiectul. Pe ce proiect lucrez?` : "Pe ce proiect lucrez?", options, forIntent: "engineering" };
    }
    if (isHubProject(project)) return (await blockedFor(project, { forceHubRefusal: true })).out || hubRefusal(project);
    if (!project.executionAllowed) {
      const b = await blockedFor(project);
      return b.out || { kind: "blocked", projectId: project.id, text: `${project.name} nu este activat pentru execuții; activarea se face din Proiecte (administrare). Cererea ta rămâne păstrată.`,
        blocker: { signature: "PROJECT_SCOPE", cause: "PROJECT_SCOPE", text: `${project.name} nu este activat pentru execuții.`, options: [{ kind: "admin", code: "PROJECT_SCOPE", label: "Activarea proiectului pentru execuții se face din Proiecte (administrare)" }] } };
    }

    // ---- an existing draft named by the start of a mission ("pornește misiunea X" on an eng_* draft)
    if (args.missionId) return planExisting(project, String(args.missionId), { step, ctx, source });

    // ---- the spec: an existing test bound, the Hub's own test (test-first, M11 L5), or ONE plain answer (§2 routes A–J)
    const hubWritesNow = (() => { try { return typeof hub.factory?.hubWrites === "function" ? hub.factory.hubWrites(project.id) : {}; } catch { return {}; } })();
    const built = buildEngineeringSpec({ text: words, args, project, hubWrites: hubWritesNow, hubTests: earlierHubTests(project) });
    if (built.input.objective.length < 10) {
      remember(key, { text: words, args, projectId: project.id, awaiting: "text", options: [] });
      return { kind: "question", question: "Descrie-mi cerința într-o propoziție: ce nu merge sau ce trebuie să facă codul?", options: [], forIntent: "engineering", projectId: project.id };
    }
    if (!built.testRef) {
      // Kept for 2 minutes whatever the answer below: a programmer's bare test path (or a choice id) still completes THIS request — after
      // a test-first card too, whose plan the new one then replaces (critique B10). The path that was not found is dropped from it.
      remember(key, { text: words, args: withoutTestRefs(args), projectId: project.id, awaiting: "test", options: [] });
      // Review (authority #4): for B (a named test that is missing) and D (the acceptance test named, none or several) the project may
      // have other tests, so the opening does not claim that no test exists.
      const scope = scopeFor(project, { neutral: built.route === "B" || built.route === "D" });
      // B: a named test that does not exist is never replaced by another one; nothing is kept.
      if (built.route === "B") {
        const why = built.workType === "REFACTOR" ? T_ROUTE_REFACTOR : !scope.ok ? scope.text : null;
        return { kind: "message", projectId: project.id, text: why ? `${missingHead(built.missing)} ${why}` : T_ROUTE_MISSING_TEST(built.missing) };
      }
      // I: a refactor needs a characterization test, which the Hub does not write yet (L5b); nothing is kept.
      if (built.route === "I") return { kind: "message", projectId: project.id, text: T_ROUTE_REFACTOR };
      // J: the Hub writes the test only on a test project on the Windows route (never ProDelivery); nothing is kept.
      if (!scope.ok) return { kind: "message", projectId: project.id, text: scope.text };
      // D: the acceptance test named, but the project has none or several: ONE plain question, never a list of files to pick from.
      if (built.route === "D") return { kind: "question", projectId: project.id, forIntent: "engineering", options: [], question: T_ROUTE_ASK_BEHAVIOUR };
      if (!built.testFirst?.ok) {
        return { kind: "message", projectId: project.id, text: `Nu pot pregăti testul scris de Hub pe ${project.name}: ${built.testFirst?.problem || "locul testului nu poate fi ales"}. Acum nu pot propune planul; nimic nu e păstrat.` };
      }
    }
    if (built.problems.length) {
      if (built.inheritedOverflow) return { kind: 'message', projectId: project.id, text: built.problems.join('; ') };
      remember(key, { text: words, args, projectId: project.id, awaiting: "text", options: [] });
      return { kind: "question", projectId: project.id, forIntent: "engineering", options: [], question: `Ca să pot verifica cerința îmi lipsește: ${built.problems.slice(0, 2).join("; ")}. Poți preciza?` };
    }

    // ---- the models (explicit, shown and hashed)
    let models;
    try { models = defaultsFor(project.id); } catch (error) {
      return { kind: "blocked", projectId: project.id, text: `Modelele alese pentru ${project.name} nu mai sunt valide (${error.message}); alege altele în sesiunea ta. Cererea ta rămâne păstrată.`,
        blocker: { signature: "PLAN_MODELS_INVALID", cause: "PLAN_MODELS_INVALID", text: error.message, options: [{ kind: "owner_decision_inline", code: "PLAN_MODELS_INVALID", label: "Alege modelele proiectului (în sesiunea ta, cu Windows Hello)" }] } };
    }

    // ---- the draft (no effects), once per request
    // M11 L5 (§5.1): the Hub-written test's path joins the request's identity only on a test-first draft (an ordinary request keeps its hash).
    const testFirst = built.testFirst?.ok ? built.testFirst : null;
    const requestHash = hashCanonical({ projectId: project.id, workType: built.input.workType, objective: built.input.objective, testRef: built.testRef, models: models.limits,
      ...(testFirst ? { testFirst: testFirst.testRef } : {}),
      ...(built.input.spec.authoring?.authorLimits?.turnTimeoutMin !== undefined ? { authorLimits: built.input.spec.authoring.authorLimits } : {}) }).slice(0, 32);
    const flight = `${project.id}:${requestHash}`;
    if (inFlight.has(flight)) return { kind: "message", projectId: project.id, text: "Pregătesc deja planul pentru această cerere; îl vezi imediat." };
    inFlight.add(flight);
    try {
      let missionId = sameDraft(project.id, requestHash);
      if (!missionId) {
        if (typeof hub.prepareFactoryMission !== "function") throw new HubError("internal", "Software Factory nu e disponibil");
        // M11 L5 (§4): a test-first mission's deadline is 180 min (step 0 runs before the implementation); shown on the card and hashed.
        const view = hub.prepareFactoryMission({ projectId: project.id, workType: built.input.workType, title: built.input.title, objective: built.input.objective, spec: built.input.spec,
          limits: { ...models.limits, ...(testFirst ? { maxDurationMin: TEST_FIRST_MAX_DURATION_MIN } : {}) } },
          { actor: ctx?.actor || "owner", provenance: { createdBy: "intake", requestHash, source, channel: ctx?.channel || null } });
        missionId = view.mission.id;
      }
      return await proposeFor(project, missionId, { step, ctx, models, bound: built.autoBound ? { ref: built.testRef, kind: built.autoBound, topic: built.topic } : null });
    } catch (error) {
      if (error instanceof HubError && ["policy", "validation"].includes(error.category)) return { kind: "message", projectId: project.id, text: `Nu am putut pregăti ciorna: ${error.message}` };
      throw error;
    } finally { inFlight.delete(flight); }
  }

  function hubRefusal(project) {
    const text = "Software Factory nu lucrează pe Hub-ul însuși: depozitul Hub-ului e supraveghetorul tău și nu își modifică singur codul. Cererea ta rămâne păstrată.";
    return { kind: "blocked", projectId: project.id, text, blocker: { signature: "HUB_SELF_TARGET", cause: "HUB_SELF_TARGET", text, options: [{ kind: "refused", code: "HUB_SELF_TARGET", label: "Software Factory pe Hub-ul însuși: refuzat" }] } };
  }

  /** An existing eng_* draft: the role defaults (or the override) when it has no models, then the same explain → propose. */
  async function planExisting(project, missionId, { step, ctx }) {
    const view = hub.factory.view(missionId);
    if (!view) return { kind: "message", projectId: project.id, text: "Misiunea nu e o misiune Software Factory: acest tip de misiune nu are un flux automat. Nu am pornit nimic." };
    if (view.project?.id !== project.id) return { kind: "message", projectId: project.id, text: "Misiunea e pe alt proiect decât cel ales." };
    if (view.factory.stage !== "SPEC_DRAFT") return { kind: "message", projectId: project.id, text: `„${view.mission.title}” e în etapa ${view.factory.stage}; nu pun un plan nou peste o misiune pornită.` };
    let models = null;
    if (!limitsHaveModels(view.factory.limits || {})) {
      try { models = defaultsFor(project.id); } catch (error) { return { kind: "message", projectId: project.id, text: `Modelele alese pentru ${project.name} nu mai sunt valide: ${error.message}` }; }
      // Shown and hashed: the models become part of the draft's scope, so the card names them and the envelope binds them.
      hub.factory.setLimits(missionId, { ...models.limits }, ctx?.actor || "owner");
    }
    return proposeFor(project, missionId, { step, ctx, models });
  }

  /** Explain from verified state (blocked → kept with its draft for a later re-plan), else ONE envelope over the draft. */
  async function proposeFor(project, missionId, { step, ctx, models, bound = null }) {
    const view = hub.factory.view(missionId);
    const planRef = { kind: "mission", missionId };
    if (!view?.scope) {
      const problems = (view?.spec?.protected?.problems || []).length ? view.spec.protected.problems : view?.scopeProblems || [];
      const text = `Ciorna „${view?.mission?.title || missionId}” e pregătită, dar planul nu poate fi legat încă: ${problems.slice(0, 3).join("; ") || "scope incomplet"}. Modelele cerute: ${models?.label || "—"} (nu folosesc implicitul contului). Cererea ta rămâne păstrată.`;
      return { kind: "blocked", projectId: project.id, text, request: { planRef },
        blocker: { signature: "PLAN_MODELS_UNRESOLVED", cause: "PLAN_MODELS_UNRESOLVED", text,
          options: [{ kind: "automatic_readiness", code: "PLAN_MODELS_UNRESOLVED", label: "Verific din nou lista de modele a contului (fără model)" },
            { kind: "owner_decision_inline", code: "PLAN_MODELS_UNRESOLVED", label: "Alege alte modele pentru proiect (în sesiunea ta, cu Windows Hello)" }] } };
    }
    let { ex, out } = await blockedFor(project, { missionIds: [missionId], planRef });
    // M10.2 review #3/#31 (a): the automatic causes that need no confirmation (an account check older than 24 h, a config to re-read,
    // an environment to inspect / probe, the skills registry) are done NOW, inference-free, on the automation channel (a pass without
    // a plan reference never attests), then explained again. Before, the plan was proposed anyway with "după confirmare fac singur
    // pașii", its readiness still counted the failing checks, the card was disabled and confirm() refused — nothing ever ran them.
    if (out && ex.automaticOnly && !onlyAfterConfirmation(ex)) {
      try { await readinessPassFor(hub, { projectId: project.id, intent: "engineering", missionIds: [missionId], plan: true, trigger: "plan_requested" }); }
      catch { /* a failed pass is reported by the explanation below, never by an exception to the owner */ }
      ({ ex, out } = await blockedFor(project, { missionIds: [missionId], planRef }));
    }
    // What still blocks is the honest answer, unless the only thing left is a same-fingerprint re-attestation: that one runs as the
    // plan's pre-step after its ONE confirmation (envelopes.confirm → readiness.afterConfirmation; owner decision 3).
    if (out && !onlyAfterConfirmation(ex)) return out;
    const proposal = await envelopes.propose({ projectId: project.id, missionIds: [missionId], constraints: step?.constraints || {}, actor: ctx?.actor || "owner", via: ctx?.channel || "ui" });
    if (!proposal?.envelope) {
      const text = `Planul nu poate fi prezentat încă: ${(proposal?.summary?.blockers || []).slice(0, 3).join(" · ") || "scope incomplet"}. Cererea ta rămâne păstrată.`;
      return { kind: "blocked", projectId: project.id, text, request: { planRef }, blocker: { signature: "PLAN_INCOMPLETE", cause: "PLAN_INCOMPLETE", text, options: [] } };
    }
    bus.emit({ type: "factory.provenance", scopeType: "mission", scopeId: missionId, projectId: project.id, source: ctx?.actor || "owner",
      payload: { createdBy: isIntakeDraft(missionId) ? "intake" : "owner", envelopeId: proposal.envelope.id, stage: "plan_presented" } });
    const label = models?.label || `writer ${view.factory.limits.writerModel} · ${view.factory.limits.writerEffort || "—"}; reviewer ${view.factory.limits.reviewerModel} · ${view.factory.limits.reviewerEffort || "—"}`;
    const whose = models ? (models.source === "owner" ? "alese de tine pentru acest proiect" : "implicite pe rol") : "fixate în ciornă";
    // M10.2.1 (D21): the card says which acceptance test is protected and that the writer repairs the implementation, not the test.
    // M11 L5 (§2): a test-first plan names no file — the Hub writes the test at step 0 (T_PLANNER_NOTE); a test bound by its topic is named
    // by that topic, never by its path.
    const guarded = view?.spec?.spec ? protectedTestRefs(view.spec.spec) : [];
    const quoted = guarded.slice(0, 4).map((r) => `„${r}”`).join(", ");
    const guard = view?.spec?.spec?.authoring ? ` ${T_PLANNER_NOTE}`
      : !guarded.length ? ""
        : guarded.length === 1 && bound?.kind === "topic" && bound.ref === guarded[0]
          ? ` Testul automat despre „${bound.topic}” (singurul test al proiectului cu acest nume, ales fără întrebare) devine testul de acceptanță și e protejat: writer-ul repară implementarea, nu testul; o modificare a testului oprește misiunea.`
          : guarded.length === 1 ? ` Testul de acceptanță ${quoted}${bound?.ref === guarded[0] ? " (singurul test de acceptanță al proiectului, ales fără întrebare)" : ""} e protejat: writer-ul repară implementarea, nu testul; o modificare a testului oprește misiunea.`
            : ` Testele de acceptanță ${quoted} sunt protejate: writer-ul repară implementarea, nu testele; o modificare a lor oprește misiunea.`;
    // 2.12.2 (P0-R3): the per-turn limits and the mission's deadline the plan binds (the same values the card shows and the dispatch uses).
    const turn = turnTimeoutsOf(view.factory.limits || {});
    const limitsNote = ` Limită pe tură: writer ${turn.writer} min, reviewer ${turn.reviewer} min; termen misiune ${view.factory.limits?.maxDurationMin ?? "—"} min (legate în plan).`;
    return { kind: "envelope", proposal, projectId: project.id,
      note: `Ciornă de engineering + un singur plan de confirmat. Modele ${whose}: ${label} (afișate și legate în plan; nu folosesc implicitul contului).${guard}${limitsNote} Nimic nu a pornit și niciun grant nu a fost creat.${proposal.summary?.state === "PLAN_READY_AFTER_READINESS" ? " După confirmare fac singur pasul de pregătire afișat (fără model), apoi pornesc." : ""}` };
  }

  // ---------- draft cleanup (post-commit; never inside the writer's transaction) ----------
  /** Cancels an intake draft nobody started, when nothing still offers or holds it (a plan waiting, an open plan, a live request). */
  async function cleanupDraft(missionId, reason) {
    if (!isIntakeDraft(missionId)) return { skipped: "not an intake draft" };
    const view = hub.factory.view(missionId);
    if (!view || view.factory.stage !== "SPEC_DRAFT" || view.factory.approvedSpecVersion) return { skipped: "started or gone" };
    const nowIso = new Date(nowMs()).toISOString();
    const offered = db.prepare(`SELECT 1 FROM mission_envelopes WHERE ((status = 'PROPOSED' AND confirm_by > ?) OR status IN (${OPEN_ENVELOPE.map(() => "?").join(",")}))
      AND EXISTS (SELECT 1 FROM json_each(mission_envelopes.mission_ids_json) WHERE value = ?) LIMIT 1`).get(nowIso, ...OPEN_ENVELOPE, missionId);
    if (offered) return { skipped: "still offered" };
    let held = null;
    // PLANNED too (review #33, defence in depth): the work-request service reopens a request whose plan closed before this runs, but
    // a request still pointing at the draft (whatever its plan's state) keeps it; only a cancelled / expired / done request lets go.
    try { held = db.prepare("SELECT 1 FROM work_requests WHERE status IN ('OPEN','BLOCKED','PLANNED','CONFIRMED') AND json_extract(plan_ref, '$.missionId') = ? LIMIT 1").get(missionId); } catch { held = null; }
    if (held) return { skipped: "kept by a preserved request" };
    const out = await hub.factory.stop(missionId, { reason: String(reason || "Ciorna pregătită din cererea ta a fost retrasă").slice(0, 300), actor: "intake" });
    return { cancelled: out?.factory?.stage === "CANCELLED", stage: out?.factory?.stage || null };
  }
  bus.subscribe((event) => {
    if (event.type === "envelope.status" && DRAFT_CLOSERS.has(event.payload?.status)) {
      const env = envelopes.get(event.scopeId);
      if (!env) return;
      const reason = `Planul ciornei a fost ${event.payload.status === "SUPERSEDED" ? "înlocuit" : event.payload.status === "EXPIRED" ? "lăsat să expire" : "anulat"}; ciorna pregătită din cererea ta e retrasă (nu a rulat nimic)`;
      for (const missionId of env.missionIds || []) setImmediate(() => { cleanupDraft(missionId, reason).catch(() => {}); });
    } else if (event.type === "work_request.cancelled" || event.type === "work_request.expired") {
      const missionId = hub.workRequests?.get?.(event.scopeId)?.planRef?.missionId || null;
      if (missionId) setImmediate(() => { cleanupDraft(missionId, event.type === "work_request.cancelled" ? "Ai renunțat la cerere; ciorna ei e retrasă (nu a rulat nimic)" : "Cererea păstrată a expirat; ciorna ei e retrasă (nu a rulat nimic)").catch(() => {}); });
    }
  });

  intake.registerPlanner("engineering", plan);
  // The intake records a planner's "blocked" answer through this recorder (the work-request service has no recordBlocked of its own).
  intake.attachWorkRequests(createBlockedRecorder(hub));
  return { plan, defaultsFor, cleanupDraft, isIntakeDraft, roleDefaults: ROLE_DEFAULT_BINDINGS };
}
