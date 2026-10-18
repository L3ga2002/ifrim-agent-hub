import { HubError } from "../core/errors.mjs";
import { hashCanonical } from "../core/canonical.mjs";
import { EFFORT_PROFILES, DEFAULT_PROFILE, KNOWN_EFFORTS, TURN_TIMEOUTS } from "../policy/run-plan.mjs";
import { normalizeBindingRequest } from "../policy/model-binding.mjs";
import { PILOT_MODELS } from "../intel/packages.mjs";

/**
 * Engineering plan and limits (M03 §12). The plan is derived deterministically from the mission template: one writer
 * (Codex, workspace-write), one read-only reviewer (Claude), and the Hub runner for baseline, checks and QA (no model).
 * The backend validates it (cycles, orphans, incompatible scopes) before anything runs; a model never widens it.
 */
export const RUNNERS = Object.freeze({ owner: "proprietar (fără model)", hub: "runner Hub (fără model)", writer: "writer (Codex, scriere în workspace)", reviewer: "reviewer (Claude, doar citire)" });

export const DEFAULT_LIMITS = Object.freeze({ maxRepairCycles: 2, maxDurationMin: 120, maxAttemptsPerStage: 2, concurrency: 1 });
export const LIMIT_BOUNDS = Object.freeze({ maxRepairCycles: [0, 2], maxDurationMin: [10, 480], maxAttemptsPerStage: [1, 3], concurrency: [1, 1] });
/** 2.12.2 (P0-R3): the per-turn limit a mission may set for each role, in whole minutes (refused outside, never clamped). */
export const TURN_TIMEOUT_BOUNDS = Object.freeze({ writer: Object.freeze([5, 60]), reviewer: Object.freeze([3, 40]) });
const TURN_ROLES = Object.freeze(["writer", "reviewer"]);

/** The effort profile's per-turn limits, { writer, reviewer } in minutes (an unknown profile reads as the default one). */
export function profileTurnTimeouts(profile = DEFAULT_PROFILE) {
  const p = EFFORT_PROFILES[profile] ? profile : DEFAULT_PROFILE;
  return { writer: TURN_TIMEOUTS.writer[p], reviewer: TURN_TIMEOUTS.reviewer[p] };
}

/**
 * 2.12.2 (P0-R3): limits.turnTimeoutMin → { writer, reviewer, source[, explicit] }. Each role follows the mission's profile unless it was
 * set: a value given for a role is an explicit choice — an integer inside that role's bounds, refused otherwise (never clamped). The
 * stored form names the roles set explicitly (`explicit`), so a profile changed before the approval still moves the others; an object
 * resolved only from the profile (source "profile") follows it entirely. The result is stored in the mission's limits, so it is part of
 * the scope hash, the factory.scope approval and every plan (envelope) built over the mission.
 */
export function normalizeTurnTimeouts(raw, profile = DEFAULT_PROFILE) {
  const base = profileTurnTimeouts(profile);
  if (raw === undefined || raw === null || raw === "") return { ...base, source: "profile" };
  if (typeof raw !== "object" || Array.isArray(raw)) throw new HubError("validation", "Limita pe tură (turnTimeoutMin) are forma { writer, reviewer }, în minute");
  if (raw.source === "profile") return { ...base, source: "profile" };
  // A stored value names its explicit roles; a client's input sets exactly the roles it gives.
  const named = Array.isArray(raw.explicit) ? new Set(raw.explicit.filter((role) => TURN_ROLES.includes(role))) : null;
  const out = { ...base };
  const explicit = [];
  for (const role of TURN_ROLES) {
    const value = raw[role];
    if (value === undefined || value === null || value === "" || (named && !named.has(role))) continue;
    const n = typeof value === "number" || (typeof value === "string" && /^\s*\d+\s*$/.test(value)) ? Number(value) : NaN;
    const [min, max] = TURN_TIMEOUT_BOUNDS[role];
    if (!Number.isInteger(n) || n < min || n > max) throw new HubError("validation", `Limita pe tură pentru ${role} trebuie să fie între ${min} și ${max} min`);
    out[role] = n;
    explicit.push(role);
  }
  return explicit.length ? { ...out, source: "explicit", explicit } : { ...out, source: "profile" };
}

/**
 * The per-turn limits a mission runs with (dispatch, view, plan card): its stored, validated values, or — for limits written before
 * 2.12.2 or unreadable — its profile's (never looser than what the profile allows). Never throws.
 */
export function turnTimeoutsOf(limits = {}) {
  const profile = EFFORT_PROFILES[limits?.profile] ? limits.profile : DEFAULT_PROFILE;
  try { return normalizeTurnTimeouts(limits?.turnTimeoutMin, profile); } catch { return { ...profileTurnTimeouts(profile), source: "profile" }; }
}

/** Writer/reviewer routes the Hub supports today (asymmetric on purpose: Claude has no write/shell boundary on Windows). */
export const ROUTES = Object.freeze({
  writer: { provider: "codex", access: "workspace-write" },
  reviewer: { provider: "claude", access: "read-only" },
});

export function normalizeLimits(input = {}) {
  const out = {};
  for (const [key, [min, max]] of Object.entries(LIMIT_BOUNDS)) {
    const value = input[key] === undefined || input[key] === null || input[key] === "" ? DEFAULT_LIMITS[key] : Number(input[key]);
    if (!Number.isInteger(value) || value < min || value > max) throw new HubError("validation", `Limita ${key} trebuie să fie între ${min} și ${max}`);
    out[key] = value;
  }
  const profile = input.profile || DEFAULT_PROFILE;
  if (!EFFORT_PROFILES[profile]) throw new HubError("validation", `Profil necunoscut ${profile}`);
  out.profile = profile;
  // 2.12.2 (P0-R3): the per-turn limits, resolved from the profile unless set explicitly (hashed with the other limits).
  out.turnTimeoutMin = normalizeTurnTimeouts(input.turnTimeoutMin, profile);
  // M09: the model and effort of each role are validated here (syntax: the role's provider, an allowed Claude model, a known
  // effort) — an ineligible value (Fable, "best", [1m], an unknown effort) is refused before any plan or approval exists. An empty
  // model is still accepted for a DRAFT: its scope stays incomplete (no approval, no envelope) until the owner picks one.
  const problems = [];
  for (const role of ["writer", "reviewer"]) {
    const rawModel = input[`${role}Model`];
    const rawEffort = input[`${role}Effort`];
    if ((rawModel !== undefined && rawModel !== null && typeof rawModel !== "string") || (rawEffort !== undefined && rawEffort !== null && typeof rawEffort !== "string")) {
      problems.push(`${role}: modelul și efortul sunt texte`);
      continue;
    }
    const model = String(rawModel || "").trim();
    const effort = String(rawEffort || "").trim().toLowerCase();
    if (!model && !effort) continue;
    if (!model) {
      if (KNOWN_EFFORTS.includes(effort)) out[`${role}Effort`] = effort;
      else problems.push(`Efort necunoscut pentru ${role}: ${effort.slice(0, 20)} (permise: ${KNOWN_EFFORTS.join(", ")})`);
      continue;
    }
    const check = normalizeBindingRequest({ role, model, effort, profile });
    if (!check.ok) { problems.push(check.problem); continue; }
    out[`${role}Model`] = check.request.model;
    if (effort) out[`${role}Effort`] = effort;
  }
  if (problems.length) throw new HubError("validation", `Modele invalide: ${problems.join("; ")}`, { data: { problems } });
  return out;
}

/** Whether a mission's limits name both models (a mission without them is a DRAFT whose scope is incomplete). */
export const limitsHaveModels = (limits = {}) => Boolean(String(limits.writerModel || "").trim() && String(limits.reviewerModel || "").trim());

/**
 * M10.2 (owner decision 4): the explicit role defaults an engineering plan the Hub prepares from the owner's words is built with —
 * the same models the ProDelivery pilot ran with (one source: intel/packages.mjs PILOT_MODELS). They are never applied silently:
 * they go into the mission's limits, so they are part of the scope hash, shown in the plan card ("Modele: …") and hashed into the
 * envelope the owner confirms. The account default model is never used (an empty model is not a binding; Claude needs an alias).
 * A project may carry the owner's own override (settings.factoryDefaultBindings, set only through factory.defaults.set in a
 * freshly re-authenticated owner session).
 */
export const ROLE_DEFAULT_BINDINGS = PILOT_MODELS;

/**
 * The model limits for a new engineering draft: the project's override when the owner set one, else the role defaults. Returns
 * { limits: { writerModel, writerEffort, reviewerModel, reviewerEffort }, source: "owner" | "role_default", label }. Validated
 * like any limits (normalizeLimits refuses Fable, [1m], "best", an unknown effort): an override that no longer validates throws,
 * so the owner sees why, instead of a quiet switch back to other models.
 */
export function defaultModelLimits(override = null) {
  const pick = (role) => {
    const o = override?.[role];
    return o && String(o.model || "").trim() ? { model: String(o.model).trim(), effort: String(o.effort || "").trim().toLowerCase() || ROLE_DEFAULT_BINDINGS[role].effort } : { model: ROLE_DEFAULT_BINDINGS[role].model, effort: ROLE_DEFAULT_BINDINGS[role].effort };
  };
  const writer = pick("writer");
  const reviewer = pick("reviewer");
  const source = override && (String(override.writer?.model || "").trim() || String(override.reviewer?.model || "").trim()) ? "owner" : "role_default";
  const checked = normalizeLimits({ writerModel: writer.model, writerEffort: writer.effort, reviewerModel: reviewer.model, reviewerEffort: reviewer.effort });
  const limits = { writerModel: checked.writerModel, writerEffort: checked.writerEffort, reviewerModel: checked.reviewerModel, reviewerEffort: checked.reviewerEffort };
  return { limits, source, label: `writer ${limits.writerModel} · ${limits.writerEffort}; reviewer ${limits.reviewerModel} · ${limits.reviewerEffort}` };
}

/**
 * Builds the plan for a mission's tasks (as created from the template, in template order). Each step: key, task id, title,
 * runner, provider/access (model steps only), depends (task ids), inputs, outputs and the criteria it serves.
 */
export function buildPlan({ template, tasks, spec }) {
  if (!template?.factory) throw new HubError("validation", "Șablonul nu este un șablon Software Factory");
  if (tasks.length !== template.tasks.length) throw new HubError("validation", "Taskurile misiunii nu corespund șablonului");
  const idByKey = Object.fromEntries(template.tasks.map((t, i) => [t.key, tasks[i].id]));
  const criteria = spec.acceptance.map((a) => a.id);
  const steps = template.tasks.map((t, i) => ({
    key: t.key, taskId: tasks[i].id, title: t.title, runner: t.runner, role: t.role, stage: t.stage,
    ...(t.runner === "writer" ? ROUTES.writer : t.runner === "reviewer" ? ROUTES.reviewer : { provider: null, access: t.runner === "hub" ? "runner" : "none" }),
    depends: (t.after || []).map((key) => idByKey[key]),
    inputs: STEP_IO[t.key]?.inputs || [], outputs: STEP_IO[t.key]?.outputs || [],
    criteria: t.key === "qa" || t.key === "review" ? criteria : [],
  }));
  const plan = { steps, workType: spec.workType };
  validatePlan(plan);
  return { ...plan, sha256: hashCanonical(plan) };
}

const STEP_IO = {
  spec: { inputs: ["cerința", "observații din cod", "presupuneri"], outputs: ["specificație versionată", "criterii de acceptanță", "teste de acceptanță protejate"] },
  baseline: { inputs: ["workspace la bază", "comenzi de acceptanță"], outputs: ["dovadă baseline (bug reprodus / comportament inițial)"] },
  build: { inputs: ["specificația aprobată", "workspace"], outputs: ["change set versionat", "explicația modificării"] },
  checks: { inputs: ["change set"], outputs: ["rezultatele verificărilor locale"] },
  review: { inputs: ["specificație", "change set exact", "diff", "rezultate teste"], outputs: ["verdict PASS / CHANGES_REQUESTED / INCONCLUSIVE", "findings verificabile"] },
  qa: { inputs: ["change set revizuit", "teste de acceptanță protejate"], outputs: ["dovezi QA legate de versiune", "preview (dacă e definit)"] },
  delivery: { inputs: ["toate dovezile versiunii"], outputs: ["pachet de livrare", "decizia ta"] },
};

/** Cycles, orphans and incompatible scopes are refused before execution. */
export function validatePlan(plan) {
  const problems = [];
  const ids = new Set(plan.steps.map((s) => s.taskId));
  for (const step of plan.steps) {
    for (const dep of step.depends) if (!ids.has(dep)) problems.push(`${step.key}: dependență necunoscută`);
    if (step.runner === "writer" && !(step.provider === "codex" && step.access === "workspace-write")) problems.push(`${step.key}: writer-ul este Codex cu scriere în workspace`);
    if (step.runner === "reviewer" && step.access !== "read-only") problems.push(`${step.key}: reviewer-ul rămâne doar-citire`);
    if (step.runner === "reviewer" && step.provider === ROUTES.writer.provider) problems.push(`${step.key}: reviewer-ul trebuie să fie alt provider decât writer-ul`);
  }
  if (plan.steps.filter((s) => s.runner === "writer").length > 1) problems.push("un singur pas de scriere în plan (remedierile se adaugă controlat)");
  // Kahn: every step must be reachable in a topological order (no cycle), and every non-root step depends on something.
  const indegree = new Map(plan.steps.map((s) => [s.taskId, s.depends.length]));
  const queue = plan.steps.filter((s) => !s.depends.length).map((s) => s.taskId);
  if (queue.length !== 1) problems.push("planul are un singur început (specificația)");
  let seen = 0;
  while (queue.length) {
    const id = queue.shift();
    seen += 1;
    for (const step of plan.steps) if (step.depends.includes(id)) { indegree.set(step.taskId, indegree.get(step.taskId) - 1); if (indegree.get(step.taskId) === 0) queue.push(step.taskId); }
  }
  if (seen !== plan.steps.length) problems.push("planul conține un ciclu");
  if (problems.length) throw new HubError("validation", `Plan invalid: ${problems.join("; ")}`, { data: { problems } });
  return true;
}
