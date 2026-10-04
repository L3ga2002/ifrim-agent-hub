import { hashCanonical } from "../core/canonical.mjs";
import { CLAUDE_REFUSED_MODELS, CLAUDE_MODEL_ALLOWLIST, refusedModelReason } from "../providers/claude.mjs";
import { EFFORT_PROFILES, DEFAULT_PROFILE, KNOWN_EFFORTS, codexModelList } from "./run-plan.mjs";

/**
 * Model and effort binding (M09 §3.1): proposal → plan → confirmation → envelope → grant → dispatch carry ONE explicit model and
 * effort per role, with the evidence of how it was resolved, checked again before any process starts and once more at the
 * provider's own report (Codex thread/start, Claude init). The value the owner saw is the value dispatched; nothing falls back
 * silently to the account default.
 *
 * Found on package B (M08): the pilot promised "Claude sonnet · medium" in text only, the mission carried no reviewer model,
 * the envelope showed „implicit (fix în plan)”, the Claude CLI used the account default and the run record back-filled the
 * model the CLI reported at init, so the run LOOKED explicit.
 *
 * A binding:
 *   { version, role, provider, environment, requestedModel, requestedEffort, profile, resolvedAlias,
 *     resolutionEvidence: { source: "model/list" | "claude-alias", listHash?, probedAt?, cliVersion?, family?, exactId? },
 *     effort, effortSource, bindingHash }
 * `bindingHash` covers every field except the evidence timestamps (a re-probe with the same facts keeps the hash).
 */
export const BINDING_VERSION = 1;
/** Roles of a Software Factory mission and the provider each one runs on (the plan's ROUTES). "run" = a manual run.start. */
export const ROLE_PROVIDERS = Object.freeze({ writer: "codex", reviewer: "claude" });
const ROLE_RO = { writer: "Writer-ul (Codex)", reviewer: "Reviewer-ul (Claude)", run: "Execuția" };
const PROVIDER_RO = { codex: "Codex", claude: "Claude" };
const CODEX_MODEL_ID = /^[a-z0-9][a-z0-9._:/-]{0,79}$/i;
const CLAUDE_FAMILIES = Object.freeze(["sonnet", "opus", "haiku"]);

const clean = (value, max = 80) => String(value ?? "").trim().slice(0, max);
const lower = (value) => clean(value, 200).toLowerCase();

/** The Claude family a model id or alias names (exactly one of sonnet/opus/haiku), or null. */
export function claudeFamilyOf(model) {
  const tokens = lower(model).split(/[^a-z0-9]+/).filter(Boolean);
  const found = CLAUDE_FAMILIES.filter((f) => tokens.includes(f));
  return found.length === 1 ? found[0] : null;
}

/** What Claude Code must report at init for an explicitly requested model: { family, exactId } (exactId only for a dated id). */
export function claudeExpectation(model) {
  const m = lower(model);
  if (!m || !CLAUDE_MODEL_ALLOWLIST.test(m) || CLAUDE_REFUSED_MODELS.test(m)) return null;
  const family = claudeFamilyOf(m);
  if (!family) return null;
  return { family, exactId: m.startsWith("claude-") ? m : null };
}

/**
 * Syntax only (pure, no provider facts): the role's provider, an explicit model for a factory/envelope role, a model the Hub
 * may ask for, a known effort and profile. Returns { ok, request, problem }.
 */
export function normalizeBindingRequest({ role = "run", provider = null, model = "", effort = "", profile = DEFAULT_PROFILE } = {}) {
  const r = ["writer", "reviewer", "run"].includes(role) ? role : null;
  if (!r) return { ok: false, request: null, problem: `Rol necunoscut: ${clean(role, 40)}` };
  const p = provider || ROLE_PROVIDERS[r] || null;
  if (!["codex", "claude"].includes(p)) return { ok: false, request: null, problem: `Provider necunoscut: ${clean(provider, 40) || "—"}` };
  if (ROLE_PROVIDERS[r] && ROLE_PROVIDERS[r] !== p) return { ok: false, request: null, problem: `${ROLE_RO[r]} rulează pe ${PROVIDER_RO[ROLE_PROVIDERS[r]]}, nu pe ${PROVIDER_RO[p]}` };
  const m = clean(model);
  const e = clean(effort, 20).toLowerCase();
  const prof = clean(profile, 20) || DEFAULT_PROFILE;
  if (String(model ?? "").trim().length > 80) return { ok: false, request: null, problem: "Numele modelului are peste 80 de caractere" };
  if (!EFFORT_PROFILES[prof]) return { ok: false, request: null, problem: `Profil de efort necunoscut: ${prof}` };
  if (e && !KNOWN_EFFORTS.includes(e)) return { ok: false, request: null, problem: `Efort necunoscut: ${e} (permise: ${KNOWN_EFFORTS.join(", ")})` };
  if (!m) {
    if (r !== "run" || p === "claude") {
      return { ok: false, request: null, problem: p === "claude"
        ? `${ROLE_RO[r]} nu are un model ales: alege explicit sonnet, opus sau haiku (sau un id claude-sonnet/opus/haiku-…); modelul implicit al contului Claude nu se folosește`
        : `${ROLE_RO[r]} nu are un model ales: alege explicit un model din model/list; modelul implicit al contului nu se folosește tacit` };
    }
    return { ok: true, request: { role: r, provider: p, model: "", effort: e, profile: prof }, problem: null };
  }
  if (p === "claude") {
    if (CLAUDE_REFUSED_MODELS.test(m)) return { ok: false, request: null, problem: `Modelul „${m}” este refuzat: ${refusedModelReason(m)}` };
    if (!CLAUDE_MODEL_ALLOWLIST.test(m)) return { ok: false, request: null, problem: `Modelul „${m}” nu e permis pentru Claude (permise: sonnet, opus, haiku sau un id claude-sonnet/opus/haiku-…; Fable, „best” și variantele [1m] sunt refuzate)` };
  } else if (!CODEX_MODEL_ID.test(m)) {
    return { ok: false, request: null, problem: `Modelul Codex „${m.slice(0, 40)}” are un format invalid` };
  }
  return { ok: true, request: { role: r, provider: p, model: p === "claude" && !m.toLowerCase().startsWith("claude-") ? m.toLowerCase() : m, effort: e, profile: prof }, problem: null };
}

/** Stable hash of a Codex model list: ids and efforts only (the isDefault flag, names and order do not change it). */
export function modelListHash(models) {
  const rows = (Array.isArray(models) ? models : []).map((m) => [String(m.id), (m.efforts || []).map(String)]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return hashCanonical(rows).slice(0, 24);
}

/** sha over the binding's canonical fields, evidence timestamps excluded. */
export function bindingHash(b) {
  const ev = b?.resolutionEvidence || {};
  return hashCanonical({ v: b?.version ?? BINDING_VERSION, role: b?.role, provider: b?.provider, environment: b?.environment, requestedModel: b?.requestedModel, requestedEffort: b?.requestedEffort,
    profile: b?.profile, resolvedAlias: b?.resolvedAlias, effort: b?.effort, effortSource: b?.effortSource,
    evidence: { source: ev.source || null, listHash: ev.listHash || null, cliVersion: ev.cliVersion || null, family: ev.family || null, exactId: ev.exactId || null } });
}

/**
 * Resolves one role's binding against the provider facts of the route that will run it (`providerState` = the state of
 * `codex` / `codex@wsl-runner` / `claude` / `claude@wsl-runner`). Returns { ok, binding, problem }.
 *  - Codex: the requested model must be in model/list (exact id) and the effort among that model's efforts.
 *  - Claude: an allowed alias or dated id (never refused models); the CLI version of that installation is part of the
 *    evidence, because an alias resolves to a dated model through the installed CLI.
 * `pinned`: the model was the account default pinned NOW as an explicit id (manual run.start only).
 */
export function resolveBinding({ role = "run", provider = null, environment = "windows", requestedModel = "", requestedEffort = "", profile = DEFAULT_PROFILE, providerState = null, now = null, pinned = false } = {}) {
  const norm = normalizeBindingRequest({ role, provider, model: requestedModel, effort: requestedEffort, profile });
  if (!norm.ok) return { ok: false, binding: null, problem: norm.problem };
  const { request } = norm;
  if (!request.model) return { ok: false, binding: null, problem: `${ROLE_RO[request.role]}: modelul trebuie fixat explicit înainte de execuție` };
  const effort = request.effort || EFFORT_PROFILES[request.profile].effort[request.provider] || "";
  const effortSource = request.effort ? "owner" : `profil ${request.profile}`;
  const at = (iso) => (iso ? String(iso) : now ? new Date(now).toISOString() : null);
  let resolvedAlias;
  let resolutionEvidence;
  if (request.provider === "codex") {
    const models = codexModelList(providerState);
    if (!models || !models.length) return { ok: false, binding: null, problem: `Lista de modele Codex (model/list) nu e salvată pentru ruta ${environment}: rulează „Verifică contul” în Integrări (fără inferență), ca modelul să poată fi fixat` };
    const wanted = request.model.toLowerCase();
    const chosen = models.find((m) => String(m.id).toLowerCase() === wanted || String(m.model || "").toLowerCase() === wanted);
    if (!chosen) return { ok: false, binding: null, problem: `Modelul ${request.model} nu apare în model/list pentru contul tău (disponibile: ${models.map((m) => m.id).slice(0, 8).join(", ")})` };
    const efforts = (chosen.efforts || []).map(String);
    if (!efforts.length) return { ok: false, binding: null, problem: `model/list nu raportează eforturile pentru ${chosen.id}; efortul nu poate fi verificat înainte de execuție` };
    if (!efforts.includes(effort)) return { ok: false, binding: null, problem: `Efortul ${effort} (${effortSource}) nu e suportat de ${chosen.id}; eligibile: ${efforts.join(", ")}` };
    resolvedAlias = String(chosen.id);
    resolutionEvidence = { source: "model/list", listHash: modelListHash(models), probedAt: at(providerState?.modelsCheckedAt || providerState?.probedAt), ...(pinned ? { pinnedDefault: true } : {}) };
  } else {
    const installation = providerState?.installation || null;
    const cliVersion = clean(installation?.version, 80);
    if (!cliVersion) return { ok: false, binding: null, problem: `Claude Code nu a fost inspectat pe ruta ${environment} (versiunea CLI necunoscută): rulează „Inspectează instalarea” în Integrări; aliasul ${request.model} se rezolvă prin versiunea instalată` };
    if (Array.isArray(installation.flags) && !installation.flags.includes("--effort")) return { ok: false, binding: null, problem: "Claude Code instalat nu listează --effort; efortul nu poate fi aplicat explicit (NEEDS_INSTALL_APPROVAL pentru upgrade)" };
    const expectation = claudeExpectation(request.model);
    if (!expectation) return { ok: false, binding: null, problem: `Modelul „${request.model}” nu poate fi verificat la init (familia nu e sonnet, opus sau haiku)` };
    resolvedAlias = request.model;
    resolutionEvidence = { source: "claude-alias", cliVersion, family: expectation.family, exactId: expectation.exactId, probedAt: at(providerState?.installationCheckedAt || providerState?.probedAt) };
  }
  const binding = { version: BINDING_VERSION, role: request.role, provider: request.provider, environment: environment || "windows", requestedModel: request.model, requestedEffort: request.effort,
    profile: request.profile, resolvedAlias, resolutionEvidence, effort, effortSource };
  return { ok: true, binding: { ...binding, bindingHash: bindingHash(binding) }, problem: null };
}

/**
 * Both roles of a factory mission from its limits. `contexts[role]` = { environment, providerState } of the route that will run
 * the role. Returns { bindings: { writer, reviewer } (null where unresolved), problems: [] }.
 */
export function resolveRoleBindings(limits = {}, contexts = {}, { now = null } = {}) {
  const bindings = {};
  const problems = [];
  for (const role of ["writer", "reviewer"]) {
    const ctx = contexts[role] || {};
    const r = resolveBinding({ role, provider: ROLE_PROVIDERS[role], environment: ctx.environment || "windows", requestedModel: limits[`${role}Model`] || "", requestedEffort: limits[`${role}Effort`] || "",
      profile: limits.profile || DEFAULT_PROFILE, providerState: ctx.providerState || null, now });
    bindings[role] = r.binding;
    if (!r.ok) problems.push(r.problem);
  }
  return { bindings, problems };
}

/**
 * Before any process: the approved binding against the run plan resolved NOW from the same route. Returns null (unchanged) or
 * { code: "MATERIAL_CHANGE", reasons[] }: another model or effort, the Codex model gone from model/list (or its effort), the
 * Claude CLI version changed (the alias may now name another model), or the route moved to another installation.
 */
export function compareAtDispatch(binding, plan, providerState, { environment = null } = {}) {
  if (!binding?.bindingHash) return { code: "MATERIAL_CHANGE", reasons: ["execuția nu are un model aprobat (legătura lipsește)"] };
  const reasons = [];
  if (environment && environment !== binding.environment) reasons.push(`ruta s-a schimbat (${binding.environment} → ${environment}): altă instalare decât cea aprobată`);
  if (plan && !plan.problem) {
    if (lower(plan.model) !== lower(binding.resolvedAlias)) reasons.push(`modelul de trimis (${plan.model || "—"}) nu e cel aprobat (${binding.resolvedAlias})`);
    if (clean(plan.effort, 20) !== binding.effort) reasons.push(`efortul de trimis (${plan.effort || "—"}) nu e cel aprobat (${binding.effort})`);
  }
  if (binding.provider === "codex") {
    const models = codexModelList(providerState);
    const chosen = models?.find((m) => lower(m.id) === lower(binding.resolvedAlias));
    if (!models || !models.length) reasons.push("model/list nu mai este disponibil pentru ruta aprobată");
    else if (!chosen) reasons.push(`modelul aprobat ${binding.resolvedAlias} nu mai apare în model/list (contul listează acum: ${models.map((m) => m.id).slice(0, 6).join(", ")})`);
    else if (!(chosen.efforts || []).map(String).includes(binding.effort)) reasons.push(`efortul aprobat ${binding.effort} nu mai e suportat de ${binding.resolvedAlias}`);
  } else if (binding.provider === "claude") {
    const current = clean(providerState?.installation?.version, 80) || null;
    const approved = binding.resolutionEvidence?.cliVersion || null;
    if (current !== approved) reasons.push(`versiunea Claude Code s-a schimbat (${approved || "necunoscută"} → ${current || "necunoscută"}): aliasul ${binding.resolvedAlias} poate indica acum alt model`);
  }
  if (!reasons.length && plan?.problem) reasons.push(plan.problem);
  return reasons.length ? { code: "MATERIAL_CHANGE", reasons: [...new Set(reasons)] } : null;
}

/**
 * Claude init (the last point before the model): the model the CLI reports must belong to the bound family, or equal the dated
 * id that was bound. Returns null (matches) or the reason to stop. Codex is compared by the adapter at thread/start.
 */
export function compareAtInit(binding, initModel) {
  if (!binding || binding.provider !== "claude") return null;
  const ev = binding.resolutionEvidence || {};
  const value = lower(initModel);
  const wanted = ev.exactId || `familia ${ev.family || "?"}`;
  if (!value) return `Claude Code nu a raportat modelul la init; modelul aprobat (${binding.resolvedAlias}) nu poate fi verificat; oprit înainte de model`;
  if (ev.exactId) return value === lower(ev.exactId) ? null : `Claude Code a raportat modelul ${clean(initModel)} în loc de ${ev.exactId} (aprobat); oprit înainte de model`;
  if (!ev.family) return `Modelul aprobat (${binding.resolvedAlias}) nu are o familie verificabilă; oprit înainte de model`;
  if (!value.startsWith("claude-") || claudeFamilyOf(value) !== ev.family) return `Claude Code a raportat modelul ${clean(initModel)}, în afara modelului aprobat ${binding.resolvedAlias} (${wanted}); oprit înainte de model`;
  return null;
}

/** One line for the owner: „Codex gpt-6.1-sol · medium” / „Claude sonnet (familia sonnet, Claude Code 2.1.175) · medium”. */
export function bindingLabel(b) {
  if (!b) return "—";
  const ev = b.resolutionEvidence || {};
  const where = b.environment && b.environment !== "windows" ? ` @${b.environment}` : "";
  if (b.provider === "claude") return `Claude ${b.resolvedAlias}${ev.exactId ? "" : ` (familia ${ev.family}${ev.cliVersion ? `, Claude Code ${String(ev.cliVersion).replace(/\s*\(Claude Code\)\s*$/, "")}` : ""})`} · ${b.effort}${where}`;
  return `Codex ${b.resolvedAlias} · ${b.effort}${ev.pinnedDefault ? " (implicitul contului, fixat acum)" : ""}${where}`;
}

/** The short, comparable form a grant carries (role, model, effort, hash). */
export const grantBindingOf = (b) => (b ? { role: b.role, provider: b.provider, model: b.resolvedAlias, effort: b.effort, bindingHash: b.bindingHash } : null);
