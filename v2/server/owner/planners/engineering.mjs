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
// - A request that cannot be made verifiable (no existing acceptance test to bind) gets ONE question, never a draft that can
//   only end as PLAN_INCOMPLETE. M10.2.1 (D21): a request that names „testul de acceptanță” or describes a bug without naming a
//   test file binds the project's ONLY acceptance test (a file named …acceptance… / …acceptanță…) with no question; with none or
//   several, the one question stays. The bound test is protected: the writer repairs the implementation, never the test (said on
//   the card and in the spec the writer reads). A test file the owner named that does not exist is never replaced by another one.
//   2.12.1 round 2: a bug description that names another test („Repară testul de login care pică”) and a request to write a NEW
//   acceptance test („Adaugă un test de acceptanță…”) are not bound: the one question stays.
// - Draft cleanup: a draft this planner created and nobody started is cancelled when its plan is superseded, expires or is
//   cancelled, or when the preserved request it belongs to is cancelled or expires. A draft the owner made (no intake provenance)
//   or one that already started is never touched.
import fs from "node:fs";
import path from "node:path";
import { HubError } from "../../core/errors.mjs";
import { hashCanonical } from "../../core/canonical.mjs";
import { redactText } from "../../security/redact.mjs";
import { normalize } from "../intents.mjs";
import { checkSpec, isAllowedCommand, protectedTestRefs } from "../../factory/spec.mjs";
import { defaultModelLimits, ROLE_DEFAULT_BINDINGS, limitsHaveModels } from "../../factory/plan.mjs";
import { collectFacts, onlyAfterConfirmation, readinessPassFor } from "../readiness-runner.mjs";
import { explain } from "../blockers.mjs";

/** An open question (the project, the acceptance test) is answerable for 2 minutes, like the intake's own clarifications. */
export const ENGINEERING_LIMITS = Object.freeze({ pendingTtlMs: 2 * 60 * 1000, pendingMax: 50, candidateMax: 6, scanDepth: 2 });
const KIND_HINTS = Object.freeze({ bug: "BUGFIX", bugfix: "BUGFIX", fix: "BUGFIX", feature: "FEATURE", functionalitate: "FEATURE", refactor: "REFACTOR", refactoring: "REFACTOR" });
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
const CREATES_ACCEPTANCE = new RegExp(String.raw`\b${CREATE_VERB}(?:-mi|-ne)?(?:\s+${BETWEEN}\b)*\s+(?:test(?:ul|ele|e)?\s+(?:(?:nou|noua|noi)\s+)?(?:de\s+)?(?:acceptanta|acceptance)\b|acceptance[\s-]+tests?\b)`);
/** At most this many acceptance-named files are collected: one decides, two already mean „ask”. */
const ACCEPTANCE_SCAN_MAX = 5;

/** BUGFIX / FEATURE / REFACTOR from an explicit hint, else from the words (a bug word wins over a refactor word). */
export function workTypeOf(text, hint = "") {
  const h = String(hint || "").trim();
  if (WORK_TYPES.has(h.toUpperCase())) return h.toUpperCase();
  if (KIND_HINTS[normalize(h)]) return KIND_HINTS[normalize(h)];
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
 * checked per folder (the candidate list's long-standing behaviour); `strict` also stops inside a folder.
 */
function walkTests(projectPath, { accept = () => true, max = 40, strict = false } = {}) {
  const out = [];
  const walk = (dir, rel, depth) => {
    if (out.length >= max || depth > ENGINEERING_LIMITS.scanDepth) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (strict && out.length >= max) return;
      if (e.name.startsWith(".") || e.name === "node_modules") continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), r, depth + 1);
      else if (e.isFile() && TEST_FILE.test(e.name) && accept(e.name) && isAllowedCommand(`node --test ${r}`)) out.push(r);
    }
  };
  for (const d of TEST_DIRS) walk(path.join(projectPath, d), d, 1);
  return out;
}

/** Existing test files a criterion could be bound to: acceptance tests first (the convention the factory demos use), then by name. */
function testCandidates(projectPath) {
  return walkTests(projectPath).sort((a, b) => Number(/acceptan/i.test(b)) - Number(/acceptan/i.test(a)) || a.localeCompare(b)).slice(0, ENGINEERING_LIMITS.candidateMax);
}

/** M10.2.1 (D21): the project's test files whose NAME says acceptance (case and diacritics ignored), at most ACCEPTANCE_SCAN_MAX. */
export function acceptanceCandidates(projectPath) {
  return walkTests(projectPath, { accept: (name) => ACCEPTANCE_FILE.test(normalize(name)), max: ACCEPTANCE_SCAN_MAX, strict: true }).sort((a, b) => a.localeCompare(b));
}

function readScripts(projectPath) {
  try { return JSON.parse(fs.readFileSync(path.join(projectPath, "package.json"), "utf8"))?.scripts || {}; } catch { return {}; }
}

/**
 * The spec input for factory.prepare from the owner's words and the (bounded, validated) structured hints a client may add
 * (Lega's request tool: kind hint, acceptance texts, the test file). Returns { input, problems, testRef, workType, autoBound }; `problems`
 * are checkSpec's, so "verifiable" means exactly what the factory will accept at approval; `autoBound` ("named" | "described" | null)
 * says the test was the project's only acceptance test, bound without a question (M10.2.1).
 */
export function buildEngineeringSpec({ text, args = {}, project }) {
  const words = String(text || "").replace(LEGA_PREFIX, "").replace(/\s+/g, " ").trim();
  const workType = workTypeOf(words, args.workType || args.kindHint || args.kind_hint || "");
  const said = [args.testRef, ...(Array.isArray(args.acceptance) ? args.acceptance.map((a) => (a && typeof a === "object" ? a.testRef : null)) : []), (words.match(TEST_IN_TEXT) || [])[1]].filter(Boolean);
  let named = said.map((r) => existingTestRef(project.path, r)).find(Boolean) || null;
  // M10.2.1 (D21): no test file said at all, and the words name the acceptance test or describe a bug → the project's ONLY
  // acceptance-named test file, re-checked like a named one. None or several → no binding (the planner asks its one question).
  // 2.12.1 round 2: never when the owner asks to CREATE the acceptance test (PF-04), and a described bug is bound only when the words
  // name no other test (PF-03: „Repară testul de login care pică” asks which test, as before M10.2.1).
  let autoBound = null;
  const plain = normalize(words);
  const namesAcceptance = NAMES_ACCEPTANCE.test(plain);
  const describesBug = workType === "BUGFIX" && !namesAcceptance && !NAMES_A_TEST.test(plain);
  if (!named && !said.length && !CREATES_ACCEPTANCE.test(plain) && (namesAcceptance || describesBug)) {
    const only = acceptanceCandidates(project.path);
    if (only.length === 1) {
      named = existingTestRef(project.path, only[0]);
      if (named) autoBound = namesAcceptance ? "named" : "described";
    }
  }
  const title = titleOf(String(args.title || "").trim() || words);
  const criteria = (Array.isArray(args.acceptance) ? args.acceptance : []).map((a) => String(typeof a === "string" ? a : a?.text || "").replace(/\s+/g, " ").trim()).filter((s) => s.length >= 5).slice(0, 8);
  const scripts = readScripts(project.path);
  const checks = (Array.isArray(args.verification?.checks) ? args.verification.checks : []).map((c) => String(c || "").trim().replace(/\s+/g, " ")).filter(isAllowedCommand).slice(0, 4);
  const acceptance = named ? [...(criteria.length ? criteria : [`Cerința ta este îndeplinită: ${words.slice(0, 300)}`]).map((t, i) => ({ id: `AC-${i + 1}`, text: t, verify: "test", testRef: named })),
    { id: `AC-${(criteria.length || 1) + 1}`, text: "Modificarea e explicată și revizuită independent (doar citire)", verify: "review" }] : [];
  const input = {
    workType, title: title.length >= 3 ? title : "Cerință de engineering", objective: words,
    spec: {
      inScope: (Array.isArray(args.inScope) ? args.inScope : []).map((s) => String(s).slice(0, 300)).filter(Boolean).slice(0, 10),
      outOfScope: ["deploy, commit, push", "alte proiecte", "dependențe noi necerute de tine"],
      acceptance,
      constraints: ["Pregătită de Hub din cererea ta (fără model); criteriile și testul de acceptanță sunt fixate înainte de implementare",
        // M10.2.1: said where the writer reads it (the brief's „Restricții”), not only as the factory's protection list.
        ...(named ? [`Testul de acceptanță ${named} e protejat: repari implementarea, nu testul (o modificare a testului oprește misiunea)`] : [])],
      // The project's own test script when it is not plain node:test (npm test), else node --test directly (the same tests, no npm).
      verification: { checks: checks.length ? checks : [scripts.test && !/^\s*node --test\b/.test(String(scripts.test)) ? "npm test" : "node --test"], acceptance: named ? [`node --test ${named}`] : [] },
      sources: { user: [words], code: [], assumptions: named ? [autoBound
        ? `Testul de acceptanță ${named} e singurul test de acceptanță al proiectului; l-am legat de cerință fără să te întreb (îl protejez la pornire)`
        : `Testul de acceptanță ${named} există deja în proiect și verifică cerința (îl protejez la pornire)`] : [] },
    },
  };
  const { problems } = checkSpec({ ...input.spec, workType, title: input.title, objective: input.objective });
  return { input, problems, testRef: named, workType, autoBound };
}

/**
 * The intake recorder for a planner's "blocked" answer (U06 work requests behind U07's applyPlannerOutcome): the request is kept
 * once (the same live request on the same project with the same words is reused, so the one-time rule holds across mentions),
 * and the full explanation is returned the first time per (request, blocker signature), the short line afterwards.
 */
export function createBlockedRecorder(hub) {
  const intentOf = (i) => (i === "studio_create" ? "studio" : ["engineering", "engineering_request", "start_mission", "resume_mission"].includes(i) ? "engineering" : ["run", "analysis_request"].includes(i) ? "run" : "other");
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
  const pending = new Map(); // conversation key → { text, args, projectId, awaiting: "project"|"test", options, at }
  const inFlight = new Set(); // `${projectId}:${requestHash}`: the same request twice at once prepares one draft

  const isHubProject = (project) => Boolean(project) && (project.slug === "ifrim-agent-hub" || (config?.hubRoot && path.resolve(project.path).toLowerCase() === path.resolve(config.hubRoot).toLowerCase()));
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
    // ONE open question (the project, or the acceptance test): the answer — a choice id, a named test, or a bare path — completes
    // the request it was asked for; anything else is a new request.
    const open = take(key);
    if (open?.awaiting === "project" && (args.chosenId || (pid && !words))) {
      pid = args.chosenId || pid; words = open.text; args = { ...open.args }; pending.delete(key);
    } else if (open?.awaiting === "test" && (args.testRef || args.chosenId || bareTestPath(words))) {
      pid = pid || open.projectId; args = { ...open.args, testRef: args.testRef || args.chosenId || bareTestPath(words) }; words = open.text; pending.delete(key);
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

    // ---- the spec, verifiable or ONE question
    const built = buildEngineeringSpec({ text: words, args, project });
    if (built.input.objective.length < 10) {
      remember(key, { text: words, args, projectId: project.id, awaiting: "text", options: [] });
      return { kind: "question", question: "Descrie-mi cerința într-o propoziție: ce nu merge sau ce trebuie să facă codul?", options: [], forIntent: "engineering", projectId: project.id };
    }
    if (!built.testRef) {
      const candidates = testCandidates(project.path);
      remember(key, { text: words, args, projectId: project.id, awaiting: "test", options: candidates });
      return { kind: "question", projectId: project.id, forIntent: "engineering", options: candidates.map((c) => ({ id: c, label: c })),
        question: candidates.length
          ? `Ce test de acceptanță verifică asta pe ${project.name}? Îl fixez (protejat) înainte de implementare: ${candidates.length === 1 ? `„${candidates[0]}”` : "alege unul"}, sau numește alt fișier de test existent.`
          : `Pe ${project.name} nu găsesc niciun test de acceptanță existent (test/…test.mjs). Un plan pornește doar cu un test care există deja și verifică cerința: numește fișierul sau adaugă-l întâi.` };
    }
    if (built.problems.length) {
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
    const requestHash = hashCanonical({ projectId: project.id, workType: built.input.workType, objective: built.input.objective, testRef: built.testRef, models: models.limits }).slice(0, 32);
    const flight = `${project.id}:${requestHash}`;
    if (inFlight.has(flight)) return { kind: "message", projectId: project.id, text: "Pregătesc deja planul pentru această cerere; îl vezi imediat." };
    inFlight.add(flight);
    try {
      let missionId = sameDraft(project.id, requestHash);
      if (!missionId) {
        if (typeof hub.prepareFactoryMission !== "function") throw new HubError("internal", "Software Factory nu e disponibil");
        const view = hub.prepareFactoryMission({ projectId: project.id, workType: built.input.workType, title: built.input.title, objective: built.input.objective, spec: built.input.spec, limits: { ...models.limits } },
          { actor: ctx?.actor || "owner", provenance: { createdBy: "intake", requestHash, source, channel: ctx?.channel || null } });
        missionId = view.mission.id;
      }
      return await proposeFor(project, missionId, { step, ctx, models, autoBound: built.autoBound ? built.testRef : null });
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
  async function proposeFor(project, missionId, { step, ctx, models, autoBound = null }) {
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
    const guarded = view?.spec?.spec ? protectedTestRefs(view.spec.spec) : [];
    const quoted = guarded.slice(0, 4).map((r) => `„${r}”`).join(", ");
    const guard = !guarded.length ? ""
      : guarded.length === 1 ? ` Testul de acceptanță ${quoted}${autoBound === guarded[0] ? " (singurul test de acceptanță al proiectului, ales fără întrebare)" : ""} e protejat: writer-ul repară implementarea, nu testul; o modificare a testului oprește misiunea.`
        : ` Testele de acceptanță ${quoted} sunt protejate: writer-ul repară implementarea, nu testele; o modificare a lor oprește misiunea.`;
    return { kind: "envelope", proposal, projectId: project.id,
      note: `Ciornă de engineering + un singur plan de confirmat. Modele ${whose}: ${label} (afișate și legate în plan; nu folosesc implicitul contului).${guard} Nimic nu a pornit și niciun grant nu a fost creat.${proposal.summary?.state === "PLAN_READY_AFTER_READINESS" ? " După confirmare fac singur pasul de pregătire afișat (fără model), apoi pornesc." : ""}` };
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
