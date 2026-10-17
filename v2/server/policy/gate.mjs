import { evaluateRoute } from "./billing.mjs";
import { billingInputs } from "./billing-evidence.mjs";
import { evaluateIsolation, evaluateHostIsolation, evaluateEnvironmentRoute, evaluateEnvironmentProfile, evaluateEnvironmentReviewer, CODEX_PROFILE_BY_ACCESS } from "./isolation.mjs";
import { LEGA_CONSENT_VERSION } from "./lega-policy.mjs";

const INSPECTION_MAX_AGE_H = 24;

/**
 * Builds the billing inspection from stored provider state: installation/config facts come from the
 * local inspection, identity/plan/usage only from an account check younger than 24 h.
 * D23 `assumeFresh` (an outlook, never an admission — evaluateVoice `accountOutlook` is its only caller): the account facts of the
 * last check that SUCCEEDED are read whatever its age — identity, plan and sandbox; never the usage measurement (hours old by then).
 */
export function inspectionFromState(state, now, { assumeFresh = false } = {}) {
  if (!state) return null;
  const probeAgeH = state.probedAt ? (now.getTime() - new Date(state.probedAt).getTime()) / 3600000 : Infinity;
  const probeFresh = probeAgeH <= INSPECTION_MAX_AGE_H && state.ok !== false;
  const facts = probeFresh || (assumeFresh === true && Number.isFinite(probeAgeH) && state.ok !== false);
  if (!state.installation && !facts) return null;
  return {
    installed: state.installation ? state.installation.installed !== false : undefined,
    binary: state.installation?.binary, version: state.installation?.version,
    auth: facts ? state.auth : null,
    config: state.config || null,
    usage: probeFresh && state.usage && !state.usage.error ? state.usage : null,
    sandbox: facts ? state.sandbox || null : null,
  };
}

/**
 * D23: where a provider's account check stands, by the same rule inspectionFromState applies — "fresh" | "stale" (it succeeded, more
 * than 24 h ago) | "failed" (the last check did not succeed) | "missing" (never run) — and when it ran. No account data.
 */
export function accountCheckState(state, now) {
  const at = state?.probedAt ? new Date(state.probedAt).getTime() : NaN;
  if (!Number.isFinite(at)) return { state: "missing", checkedAt: null, ageHours: null };
  const ageH = (now.getTime() - at) / 3600000;
  return { state: state.ok === false ? "failed" : ageH <= INSPECTION_MAX_AGE_H ? "fresh" : "stale", checkedAt: new Date(at).toISOString(), ageHours: Math.round(ageH * 10) / 10 };
}

/** D23 (outlook only): the sandbox facts a successful account check reports, assumed where no check has ever supplied them. */
const ASSUMED_SANDBOX = Object.freeze({ readiness: "ready", profiles: Object.freeze([Object.freeze({ id: CODEX_PROFILE_BY_ACCESS["read-only"], allowed: true })]) });
/** A billing sub-check that only an account check can settle: the unread identity, and a declaration that lacks nothing but the account to compare with. */
const settledByAccountCheck = (c) => (c.id === "identity" && c.status === "unverified")
  || (c.id === "provider_side_overage_setting" && c.status === "unverified" && (c.evidence?.reasons || []).length > 0 && c.evidence.reasons.every((r) => r === "identity_unavailable"));

/**
 * Execution gate: every check is evaluated and reported, the run is admitted only when all pass.
 * The gate is the single place that decides; UI, companion, voice and automations all go through it.
 */
export function createGate({ db, settings, projects, backups, leases, grants, breakers, providerState, clock, activeRunCount, codexIsolation = null, environments = null }) {
  /*
   * M10.2 envelope-scoped live authority, late-bound by hub.mjs once the envelope service exists (it needs the gate first).
   * (missionId, bindingHash, { provider, projectId, access }) → null (no plan of this mission in force) or { envelopeId, grantId }
   * for an OPEN, unexpired envelope whose ACTIVE derived grant is bound to exactly that binding and mission ({ envelopeId,
   * grantId: null, problem } when the plan is in force but cannot admit this step). It is asked only for a run under an approved
   * binding with a mission — what runs.boundPlan produces for a Software Factory step — so in BUILD_SAFE every other run (manual,
   * shadow, Lega, schedules, a legacy factory mission) is still refused on `mode`.
   */
  let envelopeAuthority = null;
  function attachEnvelopeAuthority(fn) { envelopeAuthority = typeof fn === "function" ? fn : null; }

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
    // M10.2: in BUILD_SAFE a step of a confirmed plan is admitted by THAT plan (the Hub's mode is never written); the plan's
    // derived grant is then the live_grant below, so its attempt is still consumed and every other check still decides.
    let authority = null;
    if (mode === "BUILD_SAFE" && envelopeAuthority && plan?.bindingHash && plan?.missionId) {
      try { authority = envelopeAuthority(plan.missionId, plan.bindingHash, { provider, projectId, access }); }
      catch (error) { authority = { envelopeId: null, grantId: null, problem: `autoritatea planului nu a putut fi verificată (${String(error?.message || error).slice(0, 120)})` }; }
    }
    const scoped = Boolean(authority?.envelopeId && authority?.grantId && !authority.problem);
    add("mode", mode === "LIVE_VALIDATION" || mode === "OPERATIONAL" || scoped,
      scoped ? `BUILD_SAFE; pas admis de planul ${authority.envelopeId}`
        : mode === "BUILD_SAFE" ? (authority ? `BUILD_SAFE: ${authority.envelopeId ? `planul ${authority.envelopeId}` : "planul"} nu admite acest pas (${authority.problem || "fără grant derivat activ"})` : "BUILD_SAFE: fără inferență și fără efecte externe") : mode,
      scoped ? { authority: `envelope:${authority.envelopeId}` } : {});

    const project = projects.get(projectId);
    // The folder is checked again at every run: a link or junction swapped in after the owner enabled it is refused.
    const folder = project?.executionAllowed && projects.executionProblem ? projects.executionProblem(project) : null;
    add("project_scope", Boolean(project?.executionAllowed) && !folder, project ? (!project.executionAllowed ? `${project.name} nu este activat pentru execuție V2` : folder ? `${project.name}: ${folder}` : project.name) : "Proiect necunoscut");
    // M06: „Îngheață X” — no new step on a frozen project until the owner unfreezes it.
    const frozen = project ? settings.get("projectFreeze")?.[project.id] || null : null;
    add("project_frozen", !frozen, frozen ? `Proiect înghețat (${frozen.at}); dezgheață-l ca să pornească pași noi` : "Nu este înghețat");

    if (mode === "LIVE_VALIDATION" || scoped) {
      // M09: a grant derived from an envelope serves only the binding it names (the run's approved model/effort hash); a manual
      // run, a shadow review or a run with another model cannot consume it. M10.2: and a plan step uses only its plan's grant.
      const bindingHash = plan?.bindingHash || null;
      const missionId = plan?.bindingHash ? plan.missionId || null : null;
      const grant = grantId ? grants.get(grantId) : scoped ? grants.get(authority.grantId) : grants.findUsable(provider, projectId, access, "run", { bindingHash, missionId });
      const reason = grants.problem(grant, { provider, projectId, access, now, bindingHash, missionId });
      add("live_grant", !reason, reason || `Grant ${grant.id}: ${grant.maxAttempts - grant.attemptsUsed} încercări rămase, expiră ${grant.expiresAt}`, { grantId: grant?.id || null });
    } else if (mode === "OPERATIONAL") {
      add("operational", Boolean(settings.get("operationalEnabled")), settings.get("operationalEnabled") ? "Politici operaționale active" : "Modul OPERATIONAL nu este activat");
    }

    // Billing facts of the route that will run: the environment client has its own login and config.
    const inspection = inspectionFromState(providerState.get(route === "windows" ? provider : `${provider}@${route}`), now);
    // M09-A2: the declaration is compared with THIS route's account (claude@wsl-runner has its own login and probe).
    const billing = evaluateRoute(provider, inspection, billingInputs(settings, inspection, now));
    add("billing_route", billing.allowed, billing.allowed ? `Rută inclusă în abonament verificată${route !== "windows" ? ` (clientul din ${route})` : ""}` : billing.blockingReasons.join(" · "), { route: billing });

    if (route !== "windows") {
      // M05: the run goes through an execution environment; Windows sandbox facts do not apply to it.
      add("environment_route", Boolean(envService) && !envService.attesting(), !envService ? `Ruta ${route} nu există în acest Hub; execuția nu trece pe Windows`
        : envService.attesting() ? `Atestarea mediului ${route} rulează (repornește distribuția); execuția așteaptă` : `Rută: ${route} (aleasă de tine pentru acest proiect)`, { environment: route });
      // M07: Claude on an environment route is the read-only reviewer in its bwrap sandbox (C20), not a Codex profile.
      const probeProblem = envService ? envService.probeProblem(providerState.get(`${provider}@${route}`), envService.state(), now) : null;
      const isolation = !envService ? { ok: false, level: "none", detail: "Mediu indisponibil" }
        : provider === "claude" ? evaluateEnvironmentReviewer({ environmentId: route, access, probeProblem, simulated: envService.simulated,
          readiness: envService.reviewerReadiness ? envService.reviewerReadiness(project, settings, now) : { ok: false, detail: `mediul ${route} nu are un reviewer` } })
          : evaluateEnvironmentProfile({ environmentId: route, probe: inspection, access, profiles: envService.env.profiles, probeProblem, simulated: envService.simulated });
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
    // M09: a run under an approved binding reports it; a material change since the approval is this check's problem.
    if (plan) add("run_plan", !plan.problem, plan.problem || `${plan.model || "—"} · efort ${plan.effort} (${plan.effortSource})${plan.bindingHash ? ` · legat de planul aprobat (${String(plan.bindingHash).slice(0, 12)})` : plan.modelSource === "account_default_pinned" ? " · implicitul contului, fixat acum" : ""}`,
      { model: plan.model, effort: plan.effort, ...(plan.bindingHash ? { bindingHash: plan.bindingHash } : {}), ...(plan.materialChange ? { materialChange: plan.materialChange } : {}) });

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
  /**
   * `ownerAuthority` ({ sessionId, maxDurationS }) comes ONLY from lega.preview / lega.start after a database re-read of the owner
   * session (hub.mjs → ownerAuthority: active, not expired, not idle, credential active, voice-first policy). With it, the M10
   * zero-form path: the `mode` and `voice_grant` checks are satisfied by an authority derived for ONE voice session (the Hub's
   * mode is never written; runs stay refused in BUILD_SAFE). Every other check decides exactly as without it.
   *
   * D23 `accountOutlook` (read-only; it never changes a check's `ok` nor `allowed`): the result also carries `account` (the state of
   * the Codex account check: fresh | stale | failed | missing, when it ran) and, when that check is not fresh, `refreshable: true` on
   * each failing check that fails ONLY for want of it:
   *  - stale: the check passes on the last known account facts read as if fresh (identity, plan, sandbox; never the usage numbers);
   *  - failed / missing (no account facts to read): everything in the check that does not come from the account check passes
   *    (billing: nothing blocks but the unread identity and a declaration lacking only the account to compare with; isolation:
   *    the consent for the current deny list, with the sandbox facts assumed).
   * A caller may refresh the account check and evaluate AGAIN; an admission is always this evaluation on the real freshness.
   */
  function evaluateVoice({ voiceActive = false, ownerAuthority = null, accountOutlook = false } = {}) {
    const checks = [];
    const add = (id, ok, detail, extra = {}) => checks.push({ id, ok, detail, ...extra });
    const now = clock();
    const derived = Boolean(ownerAuthority?.sessionId);
    const gateState = settings.get("executionGate");
    add("execution_gate", gateState.status === "open", gateState.status === "open" ? "Deschisă" : `Suspendată: ${gateState.reason}`);
    const mode = settings.get("mode");
    if (derived) add("mode", true, `${mode}: Lega pornește cu autoritate derivată din sesiunea ta de proprietar (doar această sesiune vocală; modul Hub-ului nu se schimbă, execuțiile rămân în ${mode})`, { authority: "owner_session" });
    else add("mode", mode === "LIVE_VALIDATION", mode === "LIVE_VALIDATION" ? "LIVE_VALIDATION" : `${mode}: Lega este un model și nu pornește în acest mod`);
    const hubProject = projects.hub();
    if (derived) {
      const minutes = Math.max(1, Math.floor((Number(ownerAuthority.maxDurationS) || 60) / 60));
      add("voice_grant", Boolean(hubProject), hubProject ? `Se derivă la pornire: 1 sesiune, maxim ${minutes} min, legată de sesiunea ta, revocată la final` : "Proiectul Hub lipsește", { grantId: null, authority: "owner_session" });
    } else {
      const grant = hubProject ? grants.findUsable("codex", hubProject.id, "read-only", "voice") : null;
      const reason = grants.problem(grant, { provider: "codex", projectId: hubProject?.id, access: "read-only", now, kind: "voice" });
      add("voice_grant", !reason, reason || `Grant ${grant.id}: ${grant.maxAttempts - grant.attemptsUsed} sesiuni rămase, maxim ${Math.round(grant.maxDurationS / 60)} min, expiră ${grant.expiresAt}`, { grantId: grant?.id || null });
    }
    const consent = settings.get("legaConsent") || {};
    add("lega_consent", consent.version === LEGA_CONSENT_VERSION, consent.version === LEGA_CONSENT_VERSION ? `Acord înregistrat ${consent.confirmedAt}` : "Acordul pentru Lega (audio la OpenAI, consum din plan) nu este înregistrat");
    const codexState = providerState.get("codex");
    const inspection = inspectionFromState(codexState, now);
    const route = evaluateRoute("codex", inspection, billingInputs(settings, inspection, now));
    add("billing_route", route.allowed, route.allowed ? "Rută inclusă în abonament verificată" : route.blockingReasons.join(" · "), { route });
    const realtime = inspection?.config?.realtime;
    const risky = realtime?.riskyKeys || [];
    add("realtime_config", Boolean(realtime) && risky.length === 0, !realtime ? "Configurația Codex nu a fost inspectată (Integrări → Inspectează instalarea)" : risky.length ? `Chei care ar redirecționa vocea: ${risky.join(", ")}` : `Fără redirecționări de voce${realtime.mcpServers ? `; ${realtime.mcpServers} servere MCP dezactivate per proces (enabled=false), verificate la pornire` : ""}`);
    const isolationWith = (sandbox) => evaluateIsolation({ provider: "codex", access: "read-only", sandbox,
      consent: settings.get("isolationConsent")?.codex || null, fingerprint: codexIsolation ? codexIsolation().fingerprint : null });
    const isolation = isolationWith(inspection?.sandbox || null);
    add("isolation", isolation.ok, isolation.detail, { level: isolation.level });
    const breaker = breakers.state("codex");
    add("circuit_breaker", breaker.state !== "open", breaker.state === "open" ? `Deschis până la ${breaker.until}` : "Închis");
    add("single_session", !voiceActive, voiceActive ? "O sesiune Lega este deja activă" : "Nicio sesiune Lega activă");
    const running = activeRunCount();
    const limit = settings.get("maxConcurrentAiRuns");
    add("concurrency", running < limit, `${running}/${limit} execuții AI active`);
    const decision = { allowed: checks.every((c) => c.ok), checks, evaluatedAt: now.toISOString() };
    if (accountOutlook !== true) return decision;
    // D23: marks only. `decision.allowed` and every `ok` above were computed on the real freshness and are not touched below.
    const account = accountCheckState(codexState, now);
    if (account.state !== "fresh") {
      const would = { billing_route: false, isolation: false };
      if (account.state === "stale") {
        const assumed = inspectionFromState(codexState, now, { assumeFresh: true });
        would.billing_route = evaluateRoute("codex", assumed, billingInputs(settings, assumed, now)).allowed;
        would.isolation = isolationWith(assumed?.sandbox || null).ok;
      } else {
        // The verdict of the billing policy itself (its blocking reasons are "<sub-check id>: detail"), never a second rule here.
        const blockingIds = new Set(route.blockingReasons.map((r) => r.slice(0, r.indexOf(":"))));
        would.billing_route = route.checks.filter((c) => blockingIds.has(c.id)).every(settledByAccountCheck);
        would.isolation = isolationWith(ASSUMED_SANDBOX).ok;
      }
      for (const c of checks) if (!c.ok && would[c.id] === true) c.refreshable = true;
    }
    return { ...decision, account };
  }

  /** D23 (read-only): where the Codex account check stands now — the same `account` evaluateVoice's outlook reports. No account data. */
  const accountState = () => accountCheckState(providerState.get("codex"), clock());

  return { evaluate, evaluateVoice, attachEnvelopeAuthority, accountState };
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
