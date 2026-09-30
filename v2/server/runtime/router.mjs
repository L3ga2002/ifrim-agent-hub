import { HubError } from "../core/errors.mjs";
import { newId } from "../core/ids.mjs";
import { json, parse } from "../storage/db.mjs";
import { evaluateRoute } from "../policy/billing.mjs";
import { inspectionFromState } from "../policy/gate.mjs";
import { readEcosystemConfig } from "../domain/surfaces.mjs";

const PROVIDER_OF_SURFACE = (surface) => (surface.provider === "openai" ? "codex" : surface.provider === "anthropic" ? "claude" : null);
const EXCLUDED_AVAILABILITY = new Set(["unavailable", "plan_restricted", "rollout_pending", "blocked"]);
const PAID_BILLING = new Set(["api", "paid_plan", "cloud_provider"]);
const BILLING_LABEL = { api: "API plătit (per token)", paid_plan: "plan plătit separat", cloud_provider: "furnizor cloud (facturare separată)" };

/**
 * Capability-surface router. Chooses DEPARTMENT/ROLE, PROVIDER, MODEL, EXECUTION SURFACE, TOOLS and
 * COMPUTER ENVIRONMENT from the routing table (derived from the cross-ecosystem matrix) and live
 * facts: surface availability and control level, billing policy, provider route checks, usage
 * reserve, project restrictions, data sensitivity, historical verified outcomes, owner preference,
 * manual override. Every decision is persisted with factors, alternatives and a readable reason.
 * The router never starts anything: execution still goes through the command bus and the gate.
 */
export function createRouter({ db, bus, clock, config, settings, surfaces, providerState, usage, projects, telemetry, computer, company, roleConfig }) {
  let table = readEcosystemConfig(config.v2Root, "routing") || { taskTypes: {} };
  const reload = () => { table = readEcosystemConfig(config.v2Root, "routing") || { taskTypes: {} }; return table; };

  const rowTo = (r) => r && ({ id: r.id, subjectType: r.subject_type, subjectId: r.subject_id, taskType: r.task_type, departmentId: r.department_id, roleId: r.role_id,
    provider: r.provider, model: r.model, surfaceId: r.surface_id, tools: parse(r.tools_json, []), computerEnvId: r.computer_env_id, executionMode: r.execution_mode,
    factors: parse(r.factors_json, []), alternatives: parse(r.alternatives_json, []), reason: r.reason, manualOverride: Boolean(r.manual_override),
    overrideBy: r.override_by, status: r.status, createdAt: r.created_at });

  function pickModel(surface, roleId, taskType) {
    const provider = PROVIDER_OF_SURFACE(surface);
    const policy = table.taskTypes[taskType]?.model?.[provider];
    const role = roleConfig.roles.find((r) => r.id === roleId);
    const hint = policy || role?.modelHints?.[provider]?.[0] || "";
    if (provider === "claude") return { model: hint || "", source: hint ? "alias" : "default", note: hint ? `Alias „${hint}” rezolvat de Claude Code; modelul efectiv se înregistrează din stream` : "Modelul implicit al contului; se înregistrează la rulare" };
    if (provider === "codex") {
      const models = providerState.get("codex")?.models;
      if (Array.isArray(models) && models.length) {
        // The hint is a whole token ("sol" matches gpt-6.1-sol, not "console"); hidden models are skipped and the
        // highest version wins, so a legacy GPT-5.x Sol listed first is never chosen over GPT-6.x Sol.
        const token = new RegExp(`(^|[^a-z0-9])${String(hint).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i");
        const version = (m) => (String(m.model || m.id).match(/\d+(?:\.\d+)*/) || ["0"])[0].split(".").map(Number);
        const newer = (a, b) => { const x = version(a); const y = version(b); for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (y[i] || 0) - (x[i] || 0); } return 0; };
        const match = hint ? models.filter((m) => !m.hidden && token.test(`${m.id} ${m.model || ""} ${m.displayName || ""}`)).sort(newer)[0] : null;
        if (match) return { model: match.model || match.id, source: "model/list", note: `Din lista raportată de Codex (${match.displayName || match.id})` };
        return { model: "", source: "default", note: `„${hint}” nu apare în model/list; se folosește modelul implicit raportat de Codex` };
      }
      return { model: "", source: "default", note: "Lista de modele Codex nu a fost citită (Integrări → + listă modele); modelul implicit se raportează la rulare" };
    }
    return { model: "", source: "n/a", note: "Suprafață fără model selectabil" };
  }

  function evaluateCandidate(candidate, ctx) {
    const surface = surfaces.get(candidate.surface);
    const factors = [];
    const add = (id, effect, detail) => factors.push({ id, effect, detail });
    if (!surface) return { surfaceId: candidate.surface, excluded: true, score: -Infinity, factors: [{ id: "surface", effect: "exclude", detail: "Suprafață necunoscută în registru" }] };
    let score = Math.round((candidate.weight ?? 1) * 100);
    let excluded = false;
    let executionMode = surface.programmaticControl === "PROGRAMMATIC" ? "programmatic" : ["ASSISTED", "NATIVE_INTERACTIVE"].includes(surface.programmaticControl) ? "assisted" : "none";
    const exclude = (id, detail) => { excluded = true; add(id, "exclude", detail); };

    if (EXCLUDED_AVAILABILITY.has(surface.availability)) exclude("availability", `${surface.availability}: ${surface.availabilityReason || "indisponibil"}`);
    else if (surface.availability === "needs_setup") { score -= 30; add("availability", "-30", surface.availabilityReason || "Necesită configurare"); }
    else if (surface.availability === "unknown") { score -= 40; add("availability", "-40", "Disponibilitate neverificată pe acest cont"); }
    else add("availability", "0", surface.availability);

    const startSupport = surface.operations?.start?.support || "UNSUPPORTED";
    if (executionMode === "programmatic" && startSupport !== "SUPPORTED") exclude("adapter", `Hub-ul nu are încă adaptor de pornire (${startSupport})${surface.operations?.start?.note ? `: ${surface.operations.start.note}` : ""}`);
    if (executionMode === "assisted" && !["ASSISTED", "SUPPORTED"].includes(startSupport)) exclude("adapter", "Suprafața nu poate primi un task asistat");
    if (executionMode === "none") exclude("control", `Nivel de control ${surface.programmaticControl}: nu poate executa taskuri`);
    else if (ctx.requireAutomation && executionMode === "assisted") exclude("control", "Taskul cere automatizare; suprafața este doar asistată");
    else if (executionMode === "assisted") { score -= 10; add("control", "-10", "Asistat: tu rulezi în aplicația vendorului; Hub-ul pregătește și înregistrează"); }

    if (PAID_BILLING.has(surface.billingMode)) exclude("billing", `Facturare ${BILLING_LABEL[surface.billingMode]}: refuzată de BillingPolicy (included_subscription_only)`);
    else if (surface.billingMode === "unknown") { score -= 20; add("billing", "-20", "Încadrarea în abonament nu este confirmată"); }
    else add("billing", "0", surface.billingMode);

    const provider = PROVIDER_OF_SURFACE(surface);
    if (!excluded && executionMode === "programmatic" && provider) {
      const inspection = inspectionFromState(providerState.get(provider), clock());
      const route = evaluateRoute(provider, inspection, { attestations: settings.get("billingAttestations"), now: clock(), usage: inspection?.usage || null, reservePercent: settings.get("usageReservePercent") });
      const failed = route.checks.filter((c) => c.status === "failed");
      const unverified = route.checks.filter((c) => c.status === "unverified" && c.id !== "allowance");
      if (failed.length) exclude("billing_route", failed.map((c) => `${c.id}: ${c.detail}`).join(" · "));
      else if (unverified.length) { score -= 15; add("billing_route", "-15", `Neverificat: ${unverified.map((c) => c.id).join(", ")} (poarta va bloca până la verificare)`); }
      else add("billing_route", "0", "Rută inclusă verificată");
      const snap = usage.latest(provider);
      const worst = Math.max(0, ...((snap?.windows) || []).map((w) => Number(w.usedPercent) || 0));
      const ceiling = 100 - settings.get("usageReservePercent");
      if (snap?.windows?.length && worst >= ceiling) exclude("usage_reserve", `Utilizare ${worst}% ≥ plafon ${ceiling}%`);
      else if (snap?.windows?.length && worst >= ceiling - 15) { score -= 20; add("usage_reserve", "-20", `Aproape de plafon (${worst}% / ${ceiling}%)`); }
      else add("usage_reserve", "0", snap?.windows?.length ? `Maxim ${worst}%` : "Necunoscut (nicio măsurătoare)");
      if (ctx.project && !ctx.project.executionAllowed && surface.location !== "cloud") exclude("project", `${ctx.project.name} nu este activat pentru execuție V2`);
    }

    if (ctx.dataSensitivity === "secret" && surface.provider !== "hub") exclude("data_sensitivity", "Date secrete: nicio suprafață cu model; doar unelte locale fără model");
    else if (ctx.dataSensitivity === "confidential" && surface.location === "cloud") exclude("data_sensitivity", "Date confidențiale: suprafețele cloud sunt excluse");

    const history = ctx.outcomes.find((o) => o.surfaceId === surface.id);
    if (history && history.verified + history.rejected >= 3 && history.successRate !== null) {
      const delta = Math.round((history.successRate - 0.5) * 40);
      score += delta; add("history", delta >= 0 ? `+${delta}` : `${delta}`, `${history.verified}/${history.verified + history.rejected} verificate pentru ${ctx.taskType}`);
    } else add("history", "0", "Istoric insuficient (< 3 rezultate verificate)");

    const pref = settings.get("routingPreferences")?.[ctx.taskType];
    if (pref?.provider && pref.provider === surface.provider) { score += 25; add("preference", "+25", "Preferința ta pentru acest tip de task"); }
    if (ctx.preferredProvider && ctx.preferredProvider === surface.provider) { score += 30; add("preference", "+30", "Provider cerut explicit"); }

    return { surfaceId: surface.id, provider: surface.provider, surfaceName: surface.name, excluded, score: excluded ? -Infinity : score, factors, executionMode };
  }

  /** Must run inside bus.transaction (persists the decision). */
  function route({ subjectType = "adhoc", subjectId = null, taskType, roleId = null, departmentKey = null, requireAutomation = null, dataSensitivity = "normal",
    preferredProvider = null, projectId = null, override = null }, actor = "user") {
    const spec = table.taskTypes[taskType];
    if (!spec) throw new HubError("validation", `Unknown task type ${taskType}; known: ${Object.keys(table.taskTypes).join(", ")}`);
    if (!["normal", "confidential", "secret"].includes(dataSensitivity)) throw new HubError("validation", "dataSensitivity must be normal | confidential | secret");
    const project = projectId ? projects.get(projectId) : projects.hub();
    const ctx = { taskType, requireAutomation: requireAutomation ?? Boolean(spec.requiresAutomation), dataSensitivity, preferredProvider, project,
      outcomes: telemetry.outcomes({ taskType }) };
    const evaluated = spec.candidates.map((c) => evaluateCandidate(c, ctx)).sort((a, b) => b.score - a.score);
    let chosen = evaluated.find((c) => !c.excluded) || null;
    let manual = false;
    if (override?.surfaceId) {
      const forced = evaluated.find((c) => c.surfaceId === override.surfaceId) || evaluateCandidate({ surface: override.surfaceId, weight: 1 }, ctx);
      // Hard exclusions an override can never bypass, reported in order of importance (billing first).
      const HARD = ["billing", "billing_route", "data_sensitivity", "availability", "control", "adapter", "project", "usage_reserve"];
      const hardBlock = HARD.map((id) => forced.factors.find((f) => f.effect === "exclude" && f.id === id)).find(Boolean);
      if (hardBlock) throw new HubError("policy", `Override refuzat: ${hardBlock.detail}`);
      if (!override.reason || override.reason.trim().length < 3) throw new HubError("validation", "Override needs a reason");
      chosen = { ...forced, excluded: false };
      manual = true;
    }
    const role = roleId || spec.roles?.[0] || "";
    const dept = company.department(departmentKey || spec.department || roleConfig.roles.find((r) => r.id === role)?.department || "executive");
    const surface = chosen ? surfaces.get(chosen.surfaceId) : null;
    const model = surface ? (override?.model ? { model: override.model, source: "override", note: "Model ales manual" } : pickModel(surface, role, taskType)) : null;
    const comp = spec.computerUseCase ? safePlan(spec.computerUseCase) : null;
    const mode = settings.get("mode");
    // BUILD_SAFE: a model surface is only planned; local Hub tools (no model) stay executable.
    const executionMode = !chosen ? "blocked" : mode === "BUILD_SAFE" && chosen.executionMode === "programmatic" && surface.provider !== "hub" ? "planned_only" : chosen.executionMode;
    const reason = !chosen
      ? `Nicio suprafață eligibilă pentru ${spec.label || taskType}: ${evaluated.map((e) => `${e.surfaceId} (${e.factors.filter((f) => f.effect === "exclude").map((f) => f.detail).join("; ")})`).join(" | ")}`
      : `${spec.label || taskType} → ${surface.name}${model?.model ? ` · ${model.model}` : ""} (${executionMode === "planned_only" ? "planificat; BUILD_SAFE nu execută" : executionMode})${manual ? ` · override: ${override.reason}` : ""}. ${spec.why || ""}`.trim();
    const id = newId("route");
    db.prepare(`INSERT INTO route_decisions (id, subject_type, subject_id, task_type, department_id, role_id, provider, model, surface_id, tools_json, computer_env_id, execution_mode,
        factors_json, alternatives_json, reason, manual_override, override_by, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'proposed', ?)`)
      .run(id, subjectType, subjectId || id, taskType, dept?.id || null, role, chosen ? PROVIDER_OF_SURFACE(surface) || surface.provider : "", model?.model || "", chosen?.surfaceId || null,
        json(spec.tools || []), comp?.primary?.id || null, executionMode, json(chosen?.factors || []),
        json(evaluated.map((e) => ({ surfaceId: e.surfaceId, score: Number.isFinite(e.score) ? e.score : null, excluded: e.excluded, factors: e.factors }))),
        reason.slice(0, 2000), manual ? 1 : 0, manual ? actor : null, clock().toISOString());
    if (subjectType === "task" && subjectId) {
      db.prepare("UPDATE route_decisions SET status = 'superseded' WHERE subject_type = 'task' AND subject_id = ? AND id <> ? AND status = 'proposed'").run(subjectId, id);
      db.prepare("UPDATE tasks SET route_decision_id = ?, updated_at = ? WHERE id = ?").run(id, clock().toISOString(), subjectId);
    }
    bus.append({ type: "route.decided", scopeType: subjectType === "task" ? "task" : "route", scopeId: subjectType === "task" ? subjectId : id, source: actor,
      payload: { routeId: id, taskType, surfaceId: chosen?.surfaceId || null, model: model?.model || "", executionMode, manualOverride: manual } });
    return { ...get(id), modelNote: model?.note || "", computerPlan: comp };
  }

  function safePlan(useCaseId) { try { return computer.plan(useCaseId); } catch { return null; } }

  const get = (id) => rowTo(db.prepare("SELECT * FROM route_decisions WHERE id = ?").get(id));
  const list = ({ limit = 100, subjectId = null } = {}) => (subjectId
    ? db.prepare("SELECT * FROM route_decisions WHERE subject_id = ? ORDER BY created_at DESC LIMIT ?").all(subjectId, limit)
    : db.prepare("SELECT * FROM route_decisions ORDER BY created_at DESC LIMIT ?").all(limit)).map(rowTo);

  const taskTypes = () => Object.entries(table.taskTypes).map(([id, t]) => ({ id, label: t.label || id, department: t.department, requiresAutomation: Boolean(t.requiresAutomation),
    candidates: t.candidates.map((c) => c.surface), why: t.why || "" }));

  return { route, get, list, taskTypes, reload, pickModel };
}
