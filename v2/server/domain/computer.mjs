import { HubError } from "../core/errors.mjs";
import { json, parse } from "../storage/db.mjs";
import { readEcosystemConfig } from "./surfaces.mjs";

const CONTROL_ORDER = { structured_api: 0, dom: 1, visual: 2 };
const USABLE = new Set(["available", "assisted"]);

/**
 * Computer Runtime contract. The Hub owns: the registry of computer environments, the primary tool
 * per use case (structured connector/API → browser DOM → visual control, in that order), and the
 * single-controller lock (`computer:<env>` and `window:<ref>` leases) so two systems never drive the
 * same environment or window. Vendor computer use (Claude, Codex) is ASSISTED: the owner runs it in
 * the vendor app; the Hub records the lock and the result. Hub-driven desktop control stays blocked.
 */
export function createComputerRuntime({ db, bus, clock, config, leases, policy }) {
  const rowTo = (r) => r && ({ id: r.id, kind: r.kind, name: r.name, provider: r.provider, ownerSurfaceId: r.owner_surface_id, isolation: r.isolation,
    controlMode: r.control_mode, status: r.status, statusReason: r.status_reason, useCases: parse(r.use_cases_json, []), safety: parse(r.safety_json, []), updatedAt: r.updated_at });
  let useCaseConfig = [];

  function seed() {
    const cfg = readEcosystemConfig(config.v2Root, "computer");
    useCaseConfig = cfg?.useCases || [];
    const now = clock().toISOString();
    bus.transaction(() => {
      for (const env of cfg?.environments || []) {
        if (!CONTROL_ORDER.hasOwnProperty(env.controlMode)) throw new Error(`computer.json: bad controlMode in ${env.id}`);
        db.prepare(`INSERT INTO computer_environments (id, kind, name, provider, owner_surface_id, isolation, control_mode, status, status_reason, use_cases_json, safety_json, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, name = excluded.name, provider = excluded.provider, owner_surface_id = excluded.owner_surface_id,
            isolation = excluded.isolation, control_mode = excluded.control_mode, status = excluded.status, status_reason = excluded.status_reason,
            use_cases_json = excluded.use_cases_json, safety_json = excluded.safety_json, updated_at = excluded.updated_at`)
          .run(env.id, env.kind, env.name, env.provider, env.ownerSurfaceId || null, env.isolation, env.controlMode, env.status, env.statusReason || "",
            json(env.useCases || []), json(env.safety || []), now);
      }
    });
  }

  const list = () => db.prepare("SELECT * FROM computer_environments ORDER BY provider, id").all().map(rowTo);
  const get = (id) => rowTo(db.prepare("SELECT * FROM computer_environments WHERE id = ?").get(id));

  /** Primary tool per use case: usable environments ordered by control mode, then by configured preference. */
  function plan(useCaseId) {
    const useCase = useCaseConfig.find((u) => u.id === useCaseId);
    if (!useCase) throw new HubError("not_found", `Unknown computer use case ${useCaseId}`);
    const envs = (useCase.preference || []).map((id, index) => ({ env: get(id), index })).filter((x) => x.env);
    const ranked = envs.sort((a, b) => (CONTROL_ORDER[a.env.controlMode] - CONTROL_ORDER[b.env.controlMode]) || (a.index - b.index));
    const usable = ranked.filter((x) => USABLE.has(x.env.status));
    return {
      useCase: { id: useCase.id, label: useCase.label, note: useCase.note || "" },
      primary: usable[0]?.env || null,
      fallbacks: usable.slice(1).map((x) => x.env),
      excluded: ranked.filter((x) => !USABLE.has(x.env.status)).map((x) => ({ id: x.env.id, status: x.env.status, reason: x.env.statusReason })),
      rule: "Ordinea: connector/API structurat → DOM în browser → control vizual; niciodată două sisteme pe același mediu sau aceeași fereastră.",
    };
  }

  const windowResource = (ref) => `window:${String(ref).toLowerCase().replace(/\s+/g, " ").trim().slice(0, 200)}`;

  /**
   * Takes the single-controller lock of an environment (and optionally of one window). Visual control
   * is always an approval-gated action; assisted environments record that the owner/vendor operates it.
   * Must run inside bus.transaction.
   */
  function acquire({ envId, holder, windowRef = null, taskId = null, ttlSeconds = 900 }) {
    const env = get(envId);
    if (!env) throw new HubError("not_found", "Unknown computer environment");
    if (!USABLE.has(env.status)) throw new HubError("policy", `${env.name}: ${env.status} — ${env.statusReason}`);
    if (!holder || holder.length < 3) throw new HubError("validation", "holder is required");
    if (env.controlMode === "visual" && env.status === "available") {
      const decision = policy.evaluate({ actionKind: "computer.visual_control", surfaceId: env.ownerSurfaceId || "*", taskId, target: envId });
      if (decision.decision !== "allow") throw new HubError("gate", `Control vizual: ${decision.reason}`, { data: { policy: decision } });
    }
    const envLease = leases.acquire({ resource: `computer:${envId}`, holder, taskId, runId: null, ttlSeconds });
    let winLease = null;
    if (windowRef) {
      try { winLease = leases.acquire({ resource: windowResource(windowRef), holder, taskId, runId: null, ttlSeconds }); }
      catch (error) { leases.release(envLease.id, "window already controlled"); throw error; }
    }
    bus.append({ type: "computer.acquired", scopeType: "computer", scopeId: envId, source: holder, taskId, payload: { envId, windowRef, mode: env.status, leaseId: envLease.id } });
    return { envLease, windowLease: winLease, mode: env.status === "assisted" ? "assisted" : "hub" };
  }

  /** Must run inside bus.transaction. */
  function release(leaseIds, reason = "released") {
    for (const id of leaseIds.filter(Boolean)) leases.release(id, reason);
    bus.append({ type: "computer.released", scopeType: "computer", scopeId: "locks", source: "hub", payload: { leaseIds, reason } });
    return true;
  }

  const locks = () => leases.list().filter((l) => l.resource.startsWith("computer:") || l.resource.startsWith("window:"));

  return { seed, list, get, plan, acquire, release, locks, useCases: () => useCaseConfig };
}
