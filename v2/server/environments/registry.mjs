/**
 * Execution environments known to this Hub (M05 §08). A project's route is the owner's choice (settings
 * projectEnvironments); Codex runs follow it. The route never changes by itself: an environment that cannot be used
 * refuses the run instead of sending it to Windows.
 *
 * M07: Claude follows the route only as the READ-ONLY reviewer, and only when that environment's reviewer is ready
 * (Claude Code installed there with its own login, the attestation measured its sandbox — C20 — and (b) for a real
 * project). Otherwise Claude stays on Windows exactly as before (Read/Glob/Grep, dontAsk: a tool boundary), and the stage
 * map and the gate say so. Lega always stays on Windows.
 */
export const ROUTED_PROVIDERS = Object.freeze(new Set(["codex", "claude"]));

export function createEnvironmentRegistry({ settings, services = {} }) {
  const routeFor = (projectId, provider = "codex") => {
    if (!ROUTED_PROVIDERS.has(provider)) return "windows";
    const choice = settings.get("projectEnvironments")?.[projectId]?.environment;
    if (!choice) return "windows";
    if (provider === "claude") return services[choice]?.reviewerReadiness?.(projectId, settings)?.ok ? choice : "windows";
    // A route to an environment this Hub does not have is kept (and refused by the gate), never turned into Windows.
    return choice;
  };
  return { routeFor, get: (id) => services[id] || null, ids: () => Object.keys(services), services };
}
