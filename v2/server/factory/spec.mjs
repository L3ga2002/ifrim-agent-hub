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
    spec.acceptance.push({ id, text, verify, ...(testRef ? { testRef } : {}), ...(item.expectFailure ? { expectFailure: str(item.expectFailure, 200) } : {}), ...(steps ? { steps } : {}) });
  }
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
  return { spec, problems };
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
