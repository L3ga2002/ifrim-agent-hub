/**
 * Execution environments known to this Hub (M05 §08). A project's route is the owner's choice (settings
 * projectEnvironments); only Codex runs move — Claude review and Lega stay on Windows and are reported as such. The route
 * never changes by itself: an environment that cannot be used refuses the run instead of sending it to Windows.
 */
export const ROUTED_PROVIDERS = Object.freeze(new Set(["codex"]));

export function createEnvironmentRegistry({ settings, services = {} }) {
  const routeFor = (projectId, provider = "codex") => {
    if (!ROUTED_PROVIDERS.has(provider)) return "windows";
    const choice = settings.get("projectEnvironments")?.[projectId]?.environment;
    // A route to an environment this Hub does not have is kept (and refused by the gate), never turned into Windows.
    return choice || "windows";
  };
  return { routeFor, get: (id) => services[id] || null, ids: () => Object.keys(services), services };
}
