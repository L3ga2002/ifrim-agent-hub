import { evaluateRoute } from "./billing.mjs";
import { evaluateIsolation, evaluateHostIsolation, evaluateEnvironmentRoute, evaluateEnvironmentProfile } from "./isolation.mjs";
import { LEGA_CONSENT_VERSION } from "./lega-policy.mjs";

const INSPECTION_MAX_AGE_H = 24;

/**
 * Builds the billing inspection from stored provider state: installation/config facts come from the
 * local inspection, identity/plan/usage only from an account check younger than 24 h.
 */
export function inspectionFromState(state, now) {
  if (!state) return null;
  const probeAgeH = state.probedAt ? (now.getTime() - new Date(state.probedAt).getTime()) / 3600000 : Infinity;
  const probeFresh = probeAgeH <= INSPECTION_MAX_AGE_H && state.ok !== false;
  if (!state.installation && !probeFresh) return null;
  return {
    installed: state.installation ? state.installation.installed !== false : undefined,
    binary: state.installation?.binary, version: state.installation?.version,
    auth: probeFresh ? state.auth : null,
    config: state.config || null,
    usage: probeFresh && state.usage && !state.usage.error ? state.usage : null,
    sandbox: probeFresh ? state.sandbox || null : null,
  };
}

/**
 * Execution gate: every check is evaluated and reported, the run is admitted only when all pass.
 * The gate is the single place that decides; UI, companion, voice and automations all go through it.
 */
export function createGate({ db, settings, projects, backups, leases, grants, breakers, providerState, clock, activeRunCount, codexIsolation = null, environments = null }) {
  /** `environment` defaults to the project route (M05): the gate decides with the same route the run manager will use. */
  function evaluate({ provider, projectId, access = "read-only", grantId = null, workspaceResource, plan = null, environment = null }) {
    const route = environment || (environments ? environments.routeFor(projectId, provider) : "windows");
    const envService = route !== "windows" ? environments?.get(route) || null : null;
    const checks = [];
    const add = (id, ok, detail, extra = {}) => checks.push({ id, ok, detail, ...extra });
    const now = clock();

    const gateState = settings.get("executionGate");
    add("execution_gate", gateState.status === "open", gateState.status === "open" ? "Deschisă" : `Suspendată: ${gateState.reason}`);

    const mode = settings.get("mode");
    add("mode", mode === "LIVE_VALIDATION" || mode === "OPERATIONAL", mode === "BUILD_SAFE" ? "BUILD_SAFE: fără inferență și fără efecte externe" : mode);

    const project = projects.get(projectId);
    // The folder is checked again at every run: a link or junction swapped in after the owner enabled it is refused.
    const folder = project?.executionAllowed && projects.executionProblem ? projects.executionProblem(project) : null;
    add("project_scope", Boolean(project?.executionAllowed) && !folder, project ? (!project.executionAllowed ? `${project.name} nu este activat pentru execuție V2` : folder ? `${project.name}: ${folder}` : project.name) : "Proiect necunoscut");
    // M06: „Îngheață X” — no new step on a frozen project until the owner unfreezes it.
    const frozen = project ? settings.get("projectFreeze")?.[project.id] || null : null;
    add("project_frozen", !frozen, frozen ? `Proiect înghețat (${frozen.at}); dezgheață-l ca să pornească pași noi` : "Nu este înghețat");

    if (mode === "LIVE_VALIDATION") {
      const grant = grantId ? grants.get(grantId) : grants.findUsable(provider, projectId, access);
      const reason = grants.problem(grant, { provider, projectId, access, now });
      add("live_grant", !reason, reason || `Grant ${grant.id}: ${grant.maxAttempts - grant.attemptsUsed} încercări rămase, expiră ${grant.expiresAt}`, { grantId: grant?.id || null });
    } else if (mode === "OPERATIONAL") {
      add("operational", Boolean(settings.get("operationalEnabled")), settings.get("operationalEnabled") ? "Politici operaționale active" : "Modul OPERATIONAL nu este activat");
    }

    // Billing facts of the route that will run: the environment client has its own login and config.
    const inspection = inspectionFromState(providerState.get(route === "windows" ? provider : `${provider}@${route}`), now);
    const billing = evaluateRoute(provider, inspection, { attestations: settings.get("billingAttestations"), now, usage: inspection?.usage || null, reservePercent: settings.get("usageReservePercent") });
    add("billing_route", billing.allowed, billing.allowed ? `Rută inclusă în abonament verificată${route !== "windows" ? ` (clientul din ${route})` : ""}` : billing.blockingReasons.join(" · "), { route: billing });

    if (route !== "windows") {
      // M05: the run goes through an execution environment; Windows sandbox facts do not apply to it.
      add("environment_route", Boolean(envService) && !envService.attesting(), !envService ? `Ruta ${route} nu există în acest Hub; execuția nu trece pe Windows`
        : envService.attesting() ? `Atestarea mediului ${route} rulează (repornește distribuția); execuția așteaptă` : `Rută: ${route} (aleasă de tine pentru acest proiect)`, { environment: route });
      const isolation = envService ? evaluateEnvironmentProfile({ environmentId: route, probe: inspection, access, profiles: envService.env.profiles,
        probeProblem: envService.probeProblem(providerState.get(`${provider}@${route}`), envService.state(), now), simulated: envService.simulated })
        : { ok: false, level: "none", detail: "Mediu indisponibil" };
      add("isolation", isolation.ok, isolation.detail, { level: isolation.level });
      const host = envService ? evaluateEnvironmentRoute({ environmentId: route, envState: envService.state(), attestation: envService.attestationStatus(now), policy: settings.get("environmentPolicy")?.[route] || null, project })
        : { ok: false, level: "none", detail: "Mediu indisponibil" };
      add("host_isolation", host.ok, host.detail, { level: host.level });
    } else {
      // Workspace isolation (M02 §05): the model's tools must not reach .ifrim/private, backups, .env or credentials.
      const isolation = evaluateIsolation({ provider, access, sandbox: inspection?.sandbox || null,
        consent: settings.get("isolationConsent")?.[provider] || null, fingerprint: provider === "codex" && codexIsolation ? codexIsolation().fingerprint : null });
      add("isolation", isolation.ok, isolation.detail, { level: isolation.level });
      // Host isolation (R2, M03 §05): what else on this machine a model command can read.
      const host = evaluateHostIsolation({ provider, access, project, acceptance: project ? settings.get("r2Acceptance")?.[project.id] || null : null, now });
      add("host_isolation", host.ok, host.detail, { level: host.level });
    }

    const breaker = breakers.state(provider);
    add("circuit_breaker", breaker.state !== "open", breaker.state === "open" ? `Deschis până la ${breaker.until} după ${breaker.failures} eșecuri de infrastructură` : "Închis");

    // Explicit model and effort (M03 §09): resolved by the run manager; never left to the provider's config defaults.
    if (plan) add("run_plan", !plan.problem, plan.problem || `${plan.model || "model implicit Claude"} · efort ${plan.effort} (${plan.effortSource})`, { model: plan.model, effort: plan.effort });

    const running = activeRunCount();
    const limit = settings.get("maxConcurrentAiRuns");
    add("concurrency", running < limit, `${running}/${limit} execuții AI active`);

    const lease = workspaceResource ? leases.current(workspaceResource) : null;
    add("workspace_lease", !lease, lease ? `Deținut de ${lease.holder} (${lease.status})` : "Liber");

    const backup = project ? backups.freshVerified(project.id) : { ok: false, reason: "No project" };
    add("backup", true, backup.ok ? `Backup verificat ${backup.backup.id} (${backup.backup.fileCount} fișiere)` : `${backup.reason}; se creează și se verifică prin restaurare un backup nou înainte de admitere`, { willCreate: !backup.ok });

    return { allowed: checks.every((c) => c.ok), checks, evaluatedAt: now.toISOString(), environment: route };
  }

  /**
   * Lega voice session admission. A voice session is a live model session (GPT-Live + the Codex agent behind it), so it
   * needs the same mode/gate/billing/isolation/breaker checks as a run, plus a VOICE grant, the owner's Lega consent and a
   * clean realtime config. No workspace lease or backup: the Lega thread has no environment and an empty scratch cwd, so
   * no project file is reachable from it; project work is proposed and then admitted as a normal run.
   */
  function evaluateVoice({ voiceActive = false } = {}) {
    const checks = [];
    const add = (id, ok, detail, extra = {}) => checks.push({ id, ok, detail, ...extra });
    const now = clock();
    const gateState = settings.get("executionGate");
    add("execution_gate", gateState.status === "open", gateState.status === "open" ? "Deschisă" : `Suspendată: ${gateState.reason}`);
    const mode = settings.get("mode");
    add("mode", mode === "LIVE_VALIDATION", mode === "LIVE_VALIDATION" ? "LIVE_VALIDATION" : `${mode}: Lega este un model și nu pornește în acest mod`);
    const hubProject = projects.hub();
    const grant = hubProject ? grants.findUsable("codex", hubProject.id, "read-only", "voice") : null;
    const reason = grants.problem(grant, { provider: "codex", projectId: hubProject?.id, access: "read-only", now, kind: "voice" });
    add("voice_grant", !reason, reason || `Grant ${grant.id}: ${grant.maxAttempts - grant.attemptsUsed} sesiuni rămase, maxim ${Math.round(grant.maxDurationS / 60)} min, expiră ${grant.expiresAt}`, { grantId: grant?.id || null });
    const consent = settings.get("legaConsent") || {};
    add("lega_consent", consent.version === LEGA_CONSENT_VERSION, consent.version === LEGA_CONSENT_VERSION ? `Acord înregistrat ${consent.confirmedAt}` : "Acordul pentru Lega (audio la OpenAI, consum din plan) nu este înregistrat");
    const inspection = inspectionFromState(providerState.get("codex"), now);
    const route = evaluateRoute("codex", inspection, { attestations: settings.get("billingAttestations"), now, usage: inspection?.usage || null, reservePercent: settings.get("usageReservePercent") });
    add("billing_route", route.allowed, route.allowed ? "Rută inclusă în abonament verificată" : route.blockingReasons.join(" · "), { route });
    const realtime = inspection?.config?.realtime;
    const risky = realtime?.riskyKeys || [];
    add("realtime_config", Boolean(realtime) && risky.length === 0, !realtime ? "Configurația Codex nu a fost inspectată (Integrări → Inspectează instalarea)" : risky.length ? `Chei care ar redirecționa vocea: ${risky.join(", ")}` : `Fără redirecționări de voce${realtime.mcpServers ? `; ${realtime.mcpServers} servere MCP dezactivate per proces (enabled=false), verificate la pornire` : ""}`);
    const isolation = evaluateIsolation({ provider: "codex", access: "read-only", sandbox: inspection?.sandbox || null,
      consent: settings.get("isolationConsent")?.codex || null, fingerprint: codexIsolation ? codexIsolation().fingerprint : null });
    add("isolation", isolation.ok, isolation.detail, { level: isolation.level });
    const breaker = breakers.state("codex");
    add("circuit_breaker", breaker.state !== "open", breaker.state === "open" ? `Deschis până la ${breaker.until}` : "Închis");
    add("single_session", !voiceActive, voiceActive ? "O sesiune Lega este deja activă" : "Nicio sesiune Lega activă");
    const running = activeRunCount();
    const limit = settings.get("maxConcurrentAiRuns");
    add("concurrency", running < limit, `${running}/${limit} execuții AI active`);
    return { allowed: checks.every((c) => c.ok), checks, evaluatedAt: now.toISOString() };
  }

  return { evaluate, evaluateVoice };
}

/** Consecutive infrastructure failures (transport/authentication) open the breaker for a cool-down. */
export function createBreakers(clock, { threshold = 3, coolDownMs = 10 * 60000 } = {}) {
  const state = new Map();
  return {
    record(provider, category) {
      const current = state.get(provider) || { failures: 0, until: null };
      if (["transport", "authentication"].includes(category)) {
        current.failures += 1;
        if (current.failures >= threshold) current.until = new Date(clock().getTime() + coolDownMs).toISOString();
      } else if (category === null) {
        current.failures = 0;
        current.until = null;
      }
      state.set(provider, current);
    },
    state(provider) {
      const current = state.get(provider);
      if (!current) return { state: "closed", failures: 0 };
      if (current.until && new Date(current.until) > clock()) return { state: "open", ...current };
      return { state: current.failures ? "half-open" : "closed", ...current };
    },
    reset(provider) { state.delete(provider); },
  };
}
