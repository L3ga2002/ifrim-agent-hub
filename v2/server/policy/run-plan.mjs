import { HubError } from "../core/errors.mjs";
import { CLAUDE_MODEL_ALLOWLIST, CLAUDE_REFUSED_MODELS } from "../providers/claude.mjs";

/**
 * Explicit model and reasoning effort for every provider run (M03 §09).
 *
 * Found live on 2026-09-30: Hub runs sent neither a model nor an effort, so Codex used the owner's config.toml
 * defaults and thread/start reported reasoningEffort "max" for both live runs. From M03 every run carries a resolved
 * plan: the model and effort that will be SENT, where each value came from, and what the provider may use. Nothing
 * falls back silently: an effort or model the provider does not list stops the run before any process starts.
 *
 * Profiles are Hub labels, not provider plan names or guaranteed provider values. They map to one effort per
 * provider; the owner can still pick an explicit effort (e.g. "max"), recorded with source "owner".
 */
export const EFFORT_PROFILES = Object.freeze({
  ECONOMIC: { label: "Economic", description: "Verificări deterministe și taskuri AI limitate", effort: { codex: "low", claude: "low" } },
  BALANCED: { label: "Echilibrat", description: "Implicit pentru implementări obișnuite", effort: { codex: "medium", claude: "medium" } },
  DEEP: { label: "Profund", description: "Analiză dificilă sau risc mare, doar ales explicit", effort: { codex: "high", claude: "high" } },
});
export const DEFAULT_PROFILE = "BALANCED";

/**
 * 2.12.2 (P0-R3): the wall-clock limit of ONE model turn, in minutes, per Software Factory role and effort profile — separate from the
 * mission's deadline (factory limits maxDurationMin). A writer turn edits and runs commands (observed live: first command 14 s, 145 s on
 * a cold Windows sandbox after a reboot); a reviewer only reads. BALANCED is the default (writer 25 min, reviewer 15 min), far below the
 * 120-minute mission deadline. A mission stores the resolved values in its limits (factory/plan.mjs normalizeLimits), so they are part
 * of the scope hash and of the plan the owner confirms; the run manager enforces them (runtime/runs.mjs, turnTimeoutMs).
 */
export const TURN_TIMEOUTS = Object.freeze({
  writer: Object.freeze({ ECONOMIC: 15, BALANCED: 25, DEEP: 45 }),
  reviewer: Object.freeze({ ECONOMIC: 8, BALANCED: 15, DEEP: 25 }),
});

/** Every effort value the Hub may send (validated before it reaches a `-c` override or a CLI flag). */
export const KNOWN_EFFORTS = Object.freeze(["minimal", "low", "medium", "high", "xhigh", "max"]);

/** Codex models the owner's latest account check listed (model/list), or null when no list was stored. */
export function codexModelList(state) {
  return Array.isArray(state?.models) ? state.models : null;
}

/**
 * Resolves the model and effort of one run. Returns
 * { provider, profile, requestedModel, model, modelSource, requestedEffort, effort, effortSource, supportedEfforts, verification, problem }.
 * `problem` (a sentence for the owner) means the run must not start.
 */
export function resolveRunPlan({ provider, model = "", effort = "", profile = DEFAULT_PROFILE, providerState = null }) {
  const requestedModel = String(model || "").trim();
  const requestedEffort = String(effort || "").trim();
  const profileId = EFFORT_PROFILES[profile] ? profile : null;
  const plan = { provider, profile: profileId || profile, requestedModel, model: requestedModel, modelSource: requestedModel ? "owner" : "", requestedEffort, effort: "",
    effortSource: "", supportedEfforts: [], verification: "", problem: null };
  if (!profileId) return { ...plan, problem: `Profil de efort necunoscut: ${profile}` };
  if (requestedEffort && !KNOWN_EFFORTS.includes(requestedEffort)) return { ...plan, problem: `Efort necunoscut: ${requestedEffort}` };
  plan.effort = requestedEffort || EFFORT_PROFILES[profileId].effort[provider] || "";
  plan.effortSource = requestedEffort ? "owner" : `profil ${profileId}`;

  if (provider === "codex") {
    const models = codexModelList(providerState);
    if (!models || !models.length) {
      return { ...plan, problem: "Lista de modele Codex (model/list) nu e salvată: rulează „Verifică contul” în Integrări (fără inferență), ca modelul și efortul să poată fi verificate înainte de execuție" };
    }
    const byId = (id) => models.find((m) => String(m.id).toLowerCase() === id.toLowerCase() || String(m.model || "").toLowerCase() === id.toLowerCase());
    const chosen = requestedModel ? byId(requestedModel) : models.find((m) => m.isDefault) || null;
    if (!chosen) {
      return { ...plan, problem: requestedModel
        ? `Modelul ${requestedModel} nu apare în model/list pentru contul tău (disponibile: ${models.map((m) => m.id).slice(0, 8).join(", ")})`
        : "model/list nu marchează niciun model implicit; alege explicit un model" };
    }
    plan.model = String(chosen.id);
    // M09: with no model asked for (a manual run only; factory roles always carry one), the account default is PINNED now as an
    // explicit id: it is the value sent, recorded as requested and verified at thread/start, never re-read later.
    plan.modelSource = requestedModel ? "owner" : "account_default_pinned";
    if (!requestedModel) plan.requestedModel = plan.model;
    plan.supportedEfforts = (chosen.efforts || []).map(String);
    if (plan.supportedEfforts.length && !plan.supportedEfforts.includes(plan.effort)) {
      return { ...plan, problem: `Efortul ${plan.effort} (${plan.effortSource}) nu e suportat de ${plan.model}; eligibile: ${plan.supportedEfforts.join(", ")}` };
    }
    plan.verification = "Trimis explicit: -c model_reasoning_effort pentru proces, model în thread/start, effort în turn/start; thread/start trebuie să raporteze aceleași valori, altfel execuția se oprește înainte de turn";
    return plan;
  }
  if (provider === "claude") {
    const flags = providerState?.installation?.flags;
    if (Array.isArray(flags) && !flags.includes("--effort")) {
      return { ...plan, problem: "Claude Code instalat nu listează --effort; efortul nu poate fi aplicat explicit (NEEDS_INSTALL_APPROVAL pentru upgrade)" };
    }
    // M09: Claude always runs with an explicit model. The account default is resolved by the CLI at spawn time and seen only at
    // init, so it is never used: an empty model is refused here, before the gate admits anything. A refused model (Fable,
    // "best", [1m]) is left to the adapter, which stops it before any process as a billing refusal.
    if (!requestedModel) return { ...plan, problem: "Claude pornește doar cu un model explicit (sonnet, opus, haiku sau un id claude-sonnet/opus/haiku-…); modelul implicit al contului nu se folosește" };
    if (!CLAUDE_REFUSED_MODELS.test(requestedModel) && !CLAUDE_MODEL_ALLOWLIST.test(requestedModel)) {
      return { ...plan, problem: `Modelul „${requestedModel.slice(0, 60)}” nu e permis pentru Claude (permise: sonnet, opus, haiku sau un id claude-sonnet/opus/haiku-…)` };
    }
    plan.modelSource = "owner";
    plan.verification = "Trimis explicit: --model și --effort; modelul raportat la init trebuie să fie din familia cerută (altfel oprire înainte de model; Fable/[1m] oprite). Claude Code nu raportează efortul efectiv în stream";
    return plan;
  }
  return { ...plan, problem: `Provider necunoscut: ${provider}` };
}

/** Throws the owner-facing validation error for a plan with a problem. */
export function assertRunPlan(plan) {
  if (plan.problem) throw new HubError("validation", plan.problem, { data: { plan } });
  return plan;
}

/**
 * The recorded form (agent_runs.plan_json): what was requested, sent and from where. M09: plus the approved binding it was
 * dispatched under (bindingHash, resolvedAlias, resolutionEvidence) and a refused material change; `verified` is added when the
 * provider reports its model (Codex thread/start, Claude init).
 */
export const planRecord = (plan) => ({ profile: plan.profile, requestedModel: plan.requestedModel, model: plan.model, modelSource: plan.modelSource,
  requestedEffort: plan.requestedEffort, effort: plan.effort, effortSource: plan.effortSource, supportedEfforts: plan.supportedEfforts, verification: plan.verification,
  ...(plan.bindingHash ? { bindingHash: plan.bindingHash, bindingRole: plan.bindingRole || null, resolvedAlias: plan.resolvedAlias, resolutionEvidence: plan.resolutionEvidence } : {}),
  ...(plan.materialChange ? { materialChange: plan.materialChange } : {}),
  // 2.12.2 (P0-R3): the per-turn wall-clock limit this run was started with (absent = none: a manual run keeps the old behaviour).
  ...(plan.turnTimeoutMs ? { turnTimeoutMs: plan.turnTimeoutMs } : {}) });
