// M10.2 (U12) "run" planner: ONE bounded model step ("analizează…", "citește…", Lega's propose_run under voice-first) becomes ONE
// run envelope — a card the owner confirms once (click, Enter, typed „Da”, or the armed local-voice window) — instead of the
// lega.run_request approval card. Nothing here starts a model, creates a grant or an approval: the planner only explains or proposes.
//
// - The model is explicit and hashed in the card: the requested one, else the role default for the provider (Codex = the writer
//   default, Claude = the reviewer default; factory/plan.mjs ROLE_DEFAULT_BINDINGS, D4). The account default is never used.
// - Read-only by default. A writing turn is refused up front where a plan may never give one (the Hub's own repository, a real
//   project on the Windows route, any Claude write) with the blocker explainer's own words (U06), and the request is kept.
// - Anything else that would block the step (gate suspended, autonomy OBSERVE, isolation, billing, a stale account check, an
//   environment to re-attest) is explained once from verified state; checks a plan arranges itself (mode, grant, lease, backup,
//   concurrency) are never blockers.
import { ROLE_DEFAULT_BINDINGS } from "../../factory/plan.mjs";
import { collectRunFacts, onlyAfterConfirmation, readinessPassFor } from "../readiness-runner.mjs";
import { explain } from "../blockers.mjs";
import { normalize } from "../intents.mjs";
import { bindingLabel } from "../../policy/model-binding.mjs";
import { RUN_ENVELOPE_LIMITS } from "../envelopes.mjs";

/** The model a run plan uses when the request names none: per provider, the matching factory role default (shown and hashed). */
export const RUN_ROLE_DEFAULTS = Object.freeze({ codex: ROLE_DEFAULT_BINDINGS.writer, claude: ROLE_DEFAULT_BINDINGS.reviewer });
const PROVIDERS = new Set(["codex", "claude"]);

/** The provider a request asks for: the explicit argument, else a provider named in the words, else Claude (it reads with a tool fence on Windows). */
export function runProviderOf(args = {}, text = "") {
  if (PROVIDERS.has(args.provider)) return args.provider;
  const words = normalize(String(text || ""));
  const codex = /\bcodex\b/.test(words);
  const claude = /\bclaude\b/.test(words);
  return codex && !claude ? "codex" : "claude";
}

/** model + effort for the plan: the request's explicit model (its effort, or the profile's), else the provider's role default. */
export function runModelOf(provider, args = {}) {
  const model = typeof args.model === "string" ? args.model.trim() : "";
  const effort = typeof args.effort === "string" ? args.effort.trim().toLowerCase() : "";
  if (model) return { model, effort, source: "request" };
  const d = RUN_ROLE_DEFAULTS[provider];
  return { model: d.model, effort: effort || d.effort, source: "role_default" };
}

/** A blocker the explainer's catalogue does not hold (only Claude asked to write), in the same shape as explain(). */
function singleCause(code, title, detail, label, projectName) {
  const option = { kind: "refused", code, label };
  return { blocked: true, signature: code, cause: code, causes: [code], text: `Nu pot porni asta${projectName ? ` pe ${projectName}` : ""}. ${title}. ${detail}. Nu există o cale prin care să pornesc asta. Cererea ta rămâne păstrată.`,
    short: `Încă blocat: ${title.charAt(0).toLowerCase()}${title.slice(1)}; cererea ta e păstrată.`, options: [option], blockers: [{ code, title, detail, options: [option] }], automaticOnly: false, steps: [] };
}

/**
 * Registers the "run" planner on the intake. Returns { plan, explainFor } (also reachable as hub.runPlanner).
 */
export function registerRunPlanner(hub, intake) {
  const { projects, envelopes } = hub;

  /**
   * The server's explanation for this run on this project (U06 catalogue), or { blocked: false }. Built from collectFacts (gate state,
   * autonomy, frozen, environment) plus the run's OWN gate checks (its provider and access, not the factory's writer/reviewer pair).
   */
  async function explainFor(project, req, refusal = null) {
    if (refusal?.code === "CLAUDE_READ_ONLY") return singleCause("RUN_CLAUDE_WRITE", "Claude rulează într-un plan doar cu citire", "Pe Windows nativ Claude Code nu are o graniță pentru scriere și comenzi shell; o analiză doar-citire se poate", "Claude cu scriere într-un plan: refuzat", project.name);
    // One fact builder for the run's own gate checks (readiness-runner collectRunFacts): the planner, the envelope's confirmation
    // and the readiness pass after it explain the same step the same way (review #3/#31).
    return explain(await collectRunFacts(hub, { projectId: project.id, provider: req.provider, access: req.access, hubSelfRefused: refusal?.code === "HUB_SELF_TARGET" }));
  }

  async function plan({ step, text, projectId }) {
    const args = { ...(step?.args || {}) };
    const task = String(args.task || args.request || text || "").replace(/\s+/g, " ").trim();
    if (task.length < RUN_ENVELOPE_LIMITS.taskMin) return { kind: "question", question: "Ce să analizez sau să citesc? Spune-mi sarcina într-o propoziție.", options: [], forIntent: "run" };
    if (task.length > RUN_ENVELOPE_LIMITS.taskMax) return { kind: "message", text: `Sarcina are peste ${RUN_ENVELOPE_LIMITS.taskMax} caractere; spune-o mai scurt.` };
    const project = projectId ? projects.get(projectId) : null;
    if (!project) return { kind: "question", question: projectId ? "Nu găsesc proiectul. Pe ce proiect rulez sarcina?" : "Pe ce proiect rulez sarcina? Spune-mi numele proiectului.", options: [], forIntent: "run" };
    const provider = runProviderOf(args, task);
    const access = args.access === "workspace-write" ? "workspace-write" : "read-only";
    const req = { provider, access };
    const refusal = envelopes.runAccessProblem(project, req);
    let ex = await explainFor(project, req, refusal);
    // M10.2 review #3/#31 (a): what blocks ONLY through automatic readiness (an account check older than 24 h, a config to re-read,
    // an environment to inspect / probe, the skills registry) is done NOW, inference-free, on the automation channel — no plan
    // authority is needed for it (the pass without a ref never attests). Then explained again: the request is proposed only when
    // nothing else blocks; a same-fingerprint re-attestation that still remains is the plan's pre-step after its ONE confirmation.
    if (!refusal && ex.blocked && ex.automaticOnly && !onlyAfterConfirmation(ex) && hub.readiness?.run) {
      try {
        await readinessPassFor(hub, { projectId: project.id, intent: "run", plan: false, trigger: "plan_requested", explainWith: () => explainFor(project, req, null) });
      } catch { /* a failed pass is reported by the explanation below, never by an exception to the owner */ }
      ex = await explainFor(project, req, refusal);
    }
    if (refusal || (ex.blocked && !onlyAfterConfirmation(ex))) {
      const blocker = ex.blocked ? ex : singleCause(`RUN_${refusal.code}`, "Execuția nu poate fi planificată", refusal.detail, "Refuzat", project.name);
      return { kind: "blocked", blocker, text: blocker.text, projectId: project.id, request: { planRef: null, explanation: blocker } };
    }
    const chosen = runModelOf(provider, args);
    const proposal = await envelopes.proposeRun({ projectId: project.id, provider, access, task, model: chosen.model, effort: chosen.effort, constraints: step?.constraints || {},
      actor: "intake", via: "intake" });
    if (!proposal?.envelope) {
      const text0 = `Planul nu poate fi prezentat încă: ${(proposal?.summary?.blockers || []).slice(0, 3).join(" · ") || "modelul nu poate fi fixat"}. Cererea ta rămâne păstrată.`;
      return { kind: "blocked", projectId: project.id, text: text0, request: { planRef: null },
        blocker: { signature: "RUN_MODEL_UNRESOLVED", cause: "RUN_MODEL_UNRESOLVED", text: text0,
          options: [{ kind: "owner_decision_inline", code: "RUN_MODEL_UNRESOLVED", label: "Spune alt model (explicit; nu folosesc implicitul contului)" }] } };
    }
    const label = bindingLabel(proposal.envelope.body.run.binding);
    return { kind: "envelope", proposal, projectId: project.id,
      note: `Un singur pas de model (${label}; ${access === "read-only" ? "doar citire" : "cu scriere în proiect"}), într-o conversație nouă. Modelul ${chosen.source === "request" ? "cerut" : "implicit pe rol"} e afișat și legat în plan (nu folosesc implicitul contului). O singură confirmare; nimic nu a pornit și niciun grant nu a fost creat.${proposal.summary?.state === "PLAN_READY_AFTER_READINESS" ? " După confirmare fac singur pasul de pregătire afișat (fără model), apoi pornesc." : ""}` };
  }

  intake.registerPlanner("run", plan);
  return { plan, explainFor, defaults: RUN_ROLE_DEFAULTS };
}
