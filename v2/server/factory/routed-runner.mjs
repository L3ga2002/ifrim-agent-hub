/**
 * The factory runner seen by the Software Factory (M05 §07, §13): checks and QA follow the project's route (Windows sandbox,
 * or the execution environment the owner chose), the preview and its browser E2E stay on Windows (the Linux sandbox refuses
 * sockets), and a route that is not available is refused — never replaced by Windows.
 *
 * stageMap() is the honest per-stage picture for one project: where each stage runs and what boundary that is. A project is
 * REAL_PROJECT_ELIGIBLE only when every stage that executes project code is inside a demonstrated environment boundary.
 */
const STAGES = [
  ["writer", "Writer (Codex)"], ["checks", "Verificări"], ["qa", "QA"], ["preview", "Preview"], ["e2e", "E2E în browser"],
  ["review", "Review (Claude, doar citire)"], ["lega", "Lega (voce)"],
];

export function createRoutedFactoryRunner({ windows, environments, runners = {}, settings = null }) {
  const routeOf = (project) => (project ? environments.routeFor(project.id, "codex") : "windows");
  const pick = (project) => { const route = routeOf(project); return route === "windows" ? windows : runners[route] || null; };
  const missing = (route) => ({ ok: false, isolation: "none", detail: `Ruta ${route} nu există în acest Hub; verificările nu trec pe Windows` });

  function readiness(project = null) {
    const route = routeOf(project);
    const runner = pick(project);
    return { ...(runner ? runner.readiness(project) : missing(route)), route };
  }

  function run(options) {
    const route = routeOf(options.project);
    const runner = pick(options.project);
    if (!runner) return Promise.resolve({ command: options.command, runner: `none@${route}`, status: "BLOCKED", reason: missing(route).detail, isolation: "none", counts: {}, failures: [], durationMs: 0, exitCode: null, outputTail: "" });
    return runner.run(options);
  }

  /**
   * M06-A: the preview runs in the environment's LOCAL-ONLY profile (bwrap, own network namespace with loopback only) when the
   * project is on an environment route and that profile is attested (canary C18); its E2E must then run inside the same
   * namespace (Chromium for Linux) and is BLOCKED while that browser is missing — it never moves to the Windows browser.
   * Without the attested profile the M05 behaviour stays: preview and E2E on Windows (outside the environment boundary).
   */
  const previewRunner = (project) => {
    const route = routeOf(project);
    const r = route !== "windows" ? runners[route] : null;
    return r?.localOnlyReadiness?.(project)?.ok ? r : null;
  };
  const startPreview = (options) => { const r = previewRunner(options.project); return r ? r.startPreview(options) : windows.startPreview(options); };
  const e2eFor = (project) => { const r = previewRunner(project); return r ? (options) => r.e2e(options) : null; };

  async function stop(key) {
    const results = await Promise.all([windows.stop(key), ...Object.values(runners).map((r) => r.stop(key).catch(() => null))]);
    return results[0];
  }

  function stageMap(project = null) {
    const route = routeOf(project);
    const envRunner = route !== "windows" ? runners[route] : null;
    const envReady = envRunner ? envRunner.readiness(project) : null;
    const envService = route !== "windows" ? environments.get(route) : null;
    // The writer's own readiness (attestation, a fresh account check for this fingerprint, (b) for real projects).
    const writerReady = envService && settings ? envService.writerReadiness(project, settings) : envReady;
    const profiles = envService?.env?.profiles || {};
    const windowsWhere = "Windows · sandbox Codex elevated (R2: host-ul rămâne citibil în afara căilor protejate)";
    const lo = envRunner?.localOnlyReadiness ? envRunner.localOnlyReadiness(project) : null;
    const e2eReady = envRunner?.e2eReadiness ? envRunner.e2eReadiness() : null;
    const entries = {
      writer: route === "windows" ? { where: windowsWhere, boundary: "windows-sandbox" }
        : { where: `${route} · Codex app-server, profil ${profiles["workspace-write"] || "—"}, export validat (C14)`, boundary: writerReady?.ok ? "environment" : "blocked", detail: writerReady?.ok ? null : writerReady?.detail },
      checks: route === "windows" ? { where: windowsWhere, boundary: "windows-sandbox" }
        : { where: `${route} · codex sandbox, profil ${profiles["workspace-write"] || "—"}, pe o copie (fără socket-uri)`, boundary: envReady?.ok ? "environment" : "blocked", detail: envReady?.ok ? null : envReady?.detail },
      preview: lo?.ok ? { where: `${route} · bwrap, namespace de rețea propriu (doar loopback), /usr doar-citire, copie (C18)`, boundary: "environment" }
        : { where: `${windowsWhere}${route !== "windows" ? `; profilul doar-local din ${route} nu e pregătit (${lo?.detail || "—"})` : ""}`, boundary: "windows-sandbox" },
      e2e: lo?.ok ? { where: `${route} · în namespace-ul preview-ului: ${e2eReady?.detail || "—"}`, boundary: e2eReady?.ok ? "environment" : "blocked", detail: e2eReady?.ok ? null : e2eReady?.detail }
        : { where: "Windows · Chromium (sandbox Chromium) contra preview-ului de pe Windows", boundary: "windows-browser" },
      review: { where: "Windows · Claude Code Read/Glob/Grep, mod dontAsk (graniță de unealtă, nu OS)", boundary: "tool" },
      lega: { where: "Windows · Codex realtime fără workspace (voce, propuneri care cer clicul tău)", boundary: "no-workspace" },
    };
    entries.qa = { ...entries.checks };
    const LABELS = { environment: "în granița mediului atestat", "windows-sandbox": "în afara graniței de mediu (R2 deschis pe Windows)", "windows-browser": "browser Windows, contra unui preview din afara graniței de mediu", tool: "graniță de unealtă, nu de sistem de operare",
      "no-workspace": "fără acces la workspace; suprafață separată", blocked: "blocat: mediul nu e pregătit" };
    const stages = STAGES.map(([stage, label]) => ({ stage, label, ...entries[stage], boundaryLabel: LABELS[entries[stage].boundary] }));
    // Lega never touches project code; every other stage must be inside the environment boundary for a real project.
    const outside = stages.filter((s) => s.stage !== "lega" && s.boundary !== "environment");
    return { route, stages, realProjectEligible: outside.length === 0, inEnvironment: stages.filter((s) => s.boundary === "environment").length, total: stages.length - 1,
      blockers: outside.map((s) => `${s.label}: ${s.boundaryLabel}`) };
  }

  async function preflight(route = "windows") {
    const runner = route === "windows" ? windows : runners[route];
    if (!runner?.preflight) return { ok: false, environment: route, reason: "preflight indisponibil pentru această rută" };
    return runner.preflight();
  }

  return { readiness, run, startPreview, stop, stageMap, preflight, routeOf, e2eFor };
}
