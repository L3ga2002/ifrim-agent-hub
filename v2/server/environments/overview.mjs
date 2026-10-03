import { ENV_POLICY_TEXT, evaluateEnvironmentRoute, environmentCoverage } from "../policy/isolation.mjs";
import { CANARY_VERSION } from "./canary.mjs";
import { ATTESTATION_MAX_AGE_DAYS, probeProblem } from "./wsl-runner.mjs";

/**
 * Readiness of each execution environment for the UI (M05 §24): installed → adapter → account verified through the
 * environment → canary complete → policy approved (b) → live probe → per-project, per-stage eligibility. Separate states,
 * never one green light; nothing here starts a process (it reads what inspections, attestations and runs recorded).
 */
const SAFE_FACTS = ["os", "kernel", "codex_version", "codex_path", "node_version", "bwrap", "tar", "workspaces", "disk_free_kb", "auth_present", "sudo", "mnt_drives", "interop_cmd",
  "pw_version", "pw_chromium", "claude_cli", "reviewer_config", "reviewer_creds", "reviewer_settings"];

export function environmentOverview(hub) {
  const { settings, projects, db, config } = hub;
  const now = config.now();
  const environments = hub.environments.ids().map((id) => {
    const svc = hub.environments.get(id);
    const state = svc.state();
    const probe = hub.providerState.get(svc.probeKey);
    const attestation = svc.attestationStatus(now);
    const policy = settings.get("environmentPolicy")?.[id] || null;
    const policyValid = Boolean(policy?.approvedAt && policy.text === ENV_POLICY_TEXT && policy.fingerprintHash === state?.fingerprint?.hash);
    // A live probe is a completed Codex WRITE run through this environment whose export was validated and applied, on the
    // CURRENT fingerprint, in a real (not simulated) environment. Anything else is not counted as live evidence.
    const live = svc.simulated ? { n: 0, last: null } : db.prepare(`SELECT COUNT(*) AS n, MAX(r.finished_at) AS last FROM environment_workspaces w JOIN agent_runs r ON r.id = w.run_id
      WHERE w.environment_id = ? AND w.status = 'applied' AND w.fingerprint_hash = ? AND r.status = 'completed' AND r.provider = 'codex' AND r.access = 'workspace-write'`).get(id, state?.fingerprint?.hash || "");
    const liveFailed = db.prepare("SELECT COUNT(*) AS n FROM agent_runs WHERE environment = ? AND status IN ('failed','blocked')").get(id).n;
    const accountProblem = probeProblem(probe, state, now);
    const c16 = probe ? svc.c16Lines(probe) : [];
    // M07: the reviewer's own account check through the environment (claude@wsl-runner) and where each stage can run now.
    const reviewerProbe = svc.reviewerKey ? hub.providerState.get(svc.reviewerKey) : null;
    const reviewerReady = svc.reviewerReadiness ? svc.reviewerReadiness(null, settings, now) : null;
    const coverage = environmentCoverage(attestation.valid ? attestation : null);
    const ladder = [
      { step: "installed", label: "Instalat", ok: Boolean(state?.installed), detail: state ? (state.installed ? `${state.facts?.os || ""} · inspectat ${state.inspectedAt}` : state.error || "neinstalat") : "neinspectat" },
      { step: "adapter", label: "Adaptor implementat", ok: true, informational: true, detail: "cod M05 + teste locale; nu spune nimic despre mediu" },
      { step: "account", label: "Cont verificat prin mediu (C16, fără inferență; nu dovedește eligibilitatea modelelor)", ok: !accountProblem && c16.every((l) => l.includes(" PASS ")),
        detail: accountProblem ? accountProblem : `${probe.auth?.accountType || "—"} · ${probe.auth?.planType || "—"} · ${probe.probedAt}` },
      { step: "canary", label: "Canary complet C1–C17", ok: attestation.valid, detail: attestation.reason },
      { step: "policy", label: "Politică aprobată (b)", ok: policyValid, detail: policyValid ? `aprobat ${policy.approvedAt}` : policy ? "aprobare pentru altă amprentă" : "neaprobată (necesară doar pentru proiecte reale)" },
      { step: "live", label: "Probă live (c)", ok: live.n > 0, detail: live.n ? `${live.n} execuții de scriere finalizate cu export aplicat pe amprenta curentă, ultima ${live.last}`
        : `NOT_RUN${svc.simulated ? " (mediu simulat)" : ""}${liveFailed ? ` · ${liveFailed} execuții eșuate sau blocate prin acest mediu` : ""}` },
    ];
    return {
      id, label: `${svc.env.distro} (WSL2)`, distro: svc.env.distro, user: svc.env.user, profiles: svc.env.profiles, simulated: svc.simulated,
      covers: `${coverage.inEnv.join(", ")}${coverage.outside.length ? ` (${coverage.outside.join(", ")} și vocea rămân pe Windows)` : " (vocea rămâne pe Windows)"}`,
      reviewer: { ready: Boolean(reviewerReady?.ok), detail: reviewerReady?.detail || null, probe: reviewerProbe ? { ok: reviewerProbe.ok, probedAt: reviewerProbe.probedAt, version: reviewerProbe.installation?.version || null,
        authMethod: reviewerProbe.auth?.authMethod || null, subscriptionType: reviewerProbe.auth?.subscriptionType || null, problem: probeProblem(reviewerProbe, state, now), lines: svc.reviewerLines(reviewerProbe) } : null },
      inspection: state ? { ok: state.ok, installed: state.installed, inspectedAt: state.inspectedAt, durationMs: state.durationMs, error: state.error || null,
        fingerprint: state.fingerprint || null, problems: state.problems || [], facts: Object.fromEntries(SAFE_FACTS.map((k) => [k, state.facts?.[k] ?? null])) } : null,
      account: probe ? { ok: probe.ok, probedAt: probe.probedAt, accountType: probe.auth?.accountType || null, planType: probe.auth?.planType || null,
        models: Array.isArray(probe.models) ? probe.models.map((m) => m.id) : [], profiles: probe.sandbox?.profiles || [], error: probe.error || null, c16 } : null,
      attestation: { valid: attestation.valid, reason: attestation.reason, canaryVersion: CANARY_VERSION, maxAgeDays: ATTESTATION_MAX_AGE_DAYS,
        latest: attestation.latest ? { id: attestation.latest.id, status: attestation.latest.status, summary: attestation.latest.summary, fingerprintHash: attestation.latest.fingerprintHash,
          finishedAt: attestation.latest.finishedAt, byId: attestation.latest.checks?.byId || {}, lines: (attestation.latest.checks?.lines || []).slice(0, 80), stages: attestation.latest.stages,
          fingerprintLine: attestation.latest.checks?.fingerprintLine || "" } : null },
      policy: { valid: policyValid, approval: policy, text: ENV_POLICY_TEXT },
      live: { completed: live.n, last: live.last, stoppedBeforeEnd: liveFailed },
      ladder,
      workspaces: svc.listWorkspaces(15).map((w) => ({ id: w.id, runId: w.runId, purpose: w.purpose, status: w.status, files: w.stats?.files ?? null, createdAt: w.createdAt,
        export: w.export?.stats ? { ok: w.export.ok, ...w.export.stats, refused: (w.export.refused || []).length, applied: w.export.applied ?? null, conflicts: (w.export.conflicts || []).length } : null })),
      inUse: svc.inUse(),
    };
  });
  const projectsView = projects.list().filter((p) => p.executionAllowed).map((p) => {
    const route = hub.environments.routeFor(p.id, "codex");
    const svc = route !== "windows" ? hub.environments.get(route) : null;
    const host = svc ? evaluateEnvironmentRoute({ environmentId: route, envState: svc.state(), attestation: svc.attestationStatus(now), policy: settings.get("environmentPolicy")?.[route] || null, project: p }) : null;
    return { id: p.id, name: p.name, source: p.source, route, routeSetAt: settings.get("projectEnvironments")?.[p.id]?.setAt || null, host, stageMap: hub.factoryRunner.stageMap ? hub.factoryRunner.stageMap(p) : null };
  });
  return { environments, projects: projectsView, policyText: ENV_POLICY_TEXT, warmup: settings.get("environmentWarmup"),
    notes: [
      "Mediul izolat acoperă writer-ul Codex și verificările/QA pe o copie; preview-ul (C18), E2E în Chromium (C19) și review-ul Claude doar-citire (C20) intră în mediu doar cât atestarea le-a verificat; vocea rămâne pe Windows.",
      "Kernelul WSL e comun cu celelalte distribuții; administratorul Windows poate accesa mediul (\\\\wsl$, wsl -u root).",
      "Clientul Codex din mediu are rețea spre OpenAI fără filtru de domenii; comenzile modelului nu au rețea deloc. Reviewer-ul Claude are rețea spre Anthropic (nefiltrată pe domenii), dar doar unelte Read/Glob/Grep pe copia doar-citire.",
    ] };
}
