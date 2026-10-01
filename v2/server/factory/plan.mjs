import { HubError } from "../core/errors.mjs";
import { hashCanonical } from "../core/canonical.mjs";
import { EFFORT_PROFILES, DEFAULT_PROFILE } from "../policy/run-plan.mjs";

/**
 * Engineering plan and limits (M03 §12). The plan is derived deterministically from the mission template: one writer
 * (Codex, workspace-write), one read-only reviewer (Claude), and the Hub runner for baseline, checks and QA (no model).
 * The backend validates it (cycles, orphans, incompatible scopes) before anything runs; a model never widens it.
 */
export const RUNNERS = Object.freeze({ owner: "proprietar (fără model)", hub: "runner Hub (fără model)", writer: "writer (Codex, scriere în workspace)", reviewer: "reviewer (Claude, doar citire)" });

export const DEFAULT_LIMITS = Object.freeze({ maxRepairCycles: 2, maxDurationMin: 120, maxAttemptsPerStage: 2, concurrency: 1 });
export const LIMIT_BOUNDS = Object.freeze({ maxRepairCycles: [0, 2], maxDurationMin: [10, 480], maxAttemptsPerStage: [1, 3], concurrency: [1, 1] });

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
  for (const role of ["writer", "reviewer"]) {
    const model = String(input[`${role}Model`] || "").trim().slice(0, 80);
    const effort = String(input[`${role}Effort`] || "").trim().slice(0, 20);
    if (model) out[`${role}Model`] = model;
    if (effort) out[`${role}Effort`] = effort;
  }
  return out;
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
