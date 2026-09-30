import fs from "node:fs";
import path from "node:path";
import { HubError } from "../core/errors.mjs";
import { newId } from "../core/ids.mjs";
import { json, parse } from "../storage/db.mjs";

export const SURFACE_OPERATIONS = Object.freeze(["start", "resume", "sendInput", "streamEvents", "interrupt", "stop", "prepareHandoff", "getStatus", "getArtifacts"]);
export const OPERATION_SUPPORT = Object.freeze(["SUPPORTED", "ASSISTED", "PLANNED", "UNSUPPORTED"]);
export const VERIFICATION_LABELS = Object.freeze(["PASS_LIVE", "PASS_LOCAL", "PASS_SIMULATED", "FAIL", "BLOCKED", "NOT_RUN"]);
const AVAILABILITY = new Set(["available", "assisted", "unavailable", "unknown", "plan_restricted", "rollout_pending", "needs_setup", "blocked"]);

/** Reads a JSON config file from v2/config/ecosystem; a missing file is an empty registry, not an error. */
export function readEcosystemConfig(v2Root, name) {
  const file = path.join(v2Root, "config", "ecosystem", `${name}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/**
 * Execution surfaces: the same provider offers several surfaces (Codex app-server, Codex Cloud,
 * Claude Code headless, Claude Research, Claude in Chrome…). Each surface declares provider, type,
 * capabilities, platform, plan, auth, billing, programmatic control level, location, availability and
 * safety constraints, plus the support level of every ExecutionSurfaceAdapter operation. UNSUPPORTED
 * is a real value returned to callers, never a silent no-op.
 */
export function createSurfaces({ db, bus, clock, config, providerState }) {
  const rowTo = (r) => r && ({ id: r.id, provider: r.provider, surfaceType: r.surface_type, name: r.name, description: r.description,
    capabilities: parse(r.capabilities_json, []), platform: r.platform, planRequirement: r.plan_requirement, authMode: r.auth_mode,
    billingMode: r.billing_mode, programmaticControl: r.programmatic_control, location: r.location, adapter: r.adapter,
    availability: r.availability, availabilityReason: r.availability_reason, safetyConstraints: parse(r.safety_constraints_json, []),
    hubDecision: r.hub_decision, operations: parse(r.operations_json, {}), evidence: parse(r.evidence_json, {}), configVersion: r.config_version,
    verifiedAt: r.verified_at, updatedAt: r.updated_at });
  const rowToCap = (r) => r && ({ ...parse(r.data_json, {}), id: r.id, provider: r.provider, feature: r.feature, category: r.category, surfaceId: r.surface_id,
    status: r.status, hubRelevance: r.hub_relevance, hubDecision: r.hub_decision, programmatic: r.programmatic, apiBillingRisk: r.api_billing_risk,
    subscriptionIncluded: r.subscription_included, sourceVersion: r.source_version, updatedAt: r.updated_at });

  const get = (id) => rowTo(db.prepare("SELECT * FROM execution_surfaces WHERE id = ?").get(id));
  const list = ({ provider = null } = {}) => (provider
    ? db.prepare("SELECT * FROM execution_surfaces WHERE provider = ? ORDER BY id").all(provider)
    : db.prepare("SELECT * FROM execution_surfaces ORDER BY provider, id").all()).map(rowTo);

  /** Idempotent seed from config. Runtime-verified availability (verified_at set) is kept. */
  function seed() {
    const surfacesCfg = readEcosystemConfig(config.v2Root, "surfaces");
    const now = clock().toISOString();
    let surfaces = 0; let caps = 0;
    bus.transaction(() => {
      for (const s of surfacesCfg?.surfaces || []) {
        validateSurface(s);
        const existing = db.prepare("SELECT verified_at, availability, availability_reason, evidence_json FROM execution_surfaces WHERE id = ?").get(s.id);
        const keepRuntime = existing?.verified_at;
        db.prepare(`INSERT INTO execution_surfaces (id, provider, surface_type, name, description, capabilities_json, platform, plan_requirement, auth_mode, billing_mode,
            programmatic_control, location, adapter, availability, availability_reason, safety_constraints_json, hub_decision, operations_json, evidence_json, config_version, verified_at, updated_at)
          VALUES (@id, @provider, @surfaceType, @name, @description, @capabilities, @platform, @planRequirement, @authMode, @billingMode, @programmaticControl, @location, @adapter,
            @availability, @availabilityReason, @safety, @hubDecision, @operations, @evidence, @configVersion, NULL, @now)
          ON CONFLICT(id) DO UPDATE SET provider = excluded.provider, surface_type = excluded.surface_type, name = excluded.name, description = excluded.description,
            capabilities_json = excluded.capabilities_json, platform = excluded.platform, plan_requirement = excluded.plan_requirement, auth_mode = excluded.auth_mode,
            billing_mode = excluded.billing_mode, programmatic_control = excluded.programmatic_control, location = excluded.location, adapter = excluded.adapter,
            safety_constraints_json = excluded.safety_constraints_json, hub_decision = excluded.hub_decision, operations_json = excluded.operations_json,
            config_version = excluded.config_version, updated_at = excluded.updated_at,
            availability = CASE WHEN execution_surfaces.verified_at IS NULL THEN excluded.availability ELSE execution_surfaces.availability END,
            availability_reason = CASE WHEN execution_surfaces.verified_at IS NULL THEN excluded.availability_reason ELSE execution_surfaces.availability_reason END`)
          .run({ id: s.id, provider: s.provider, surfaceType: s.surfaceType, name: s.name, description: s.description || "", capabilities: json(s.capabilities || []),
            platform: s.platform || "", planRequirement: s.planRequirement || "", authMode: s.authMode || "", billingMode: s.billingMode || "unknown",
            programmaticControl: s.programmaticControl, location: s.location || "local", adapter: s.adapter || "none", availability: s.availability || "unknown",
            availabilityReason: s.availabilityReason || "", safety: json(s.safetyConstraints || []), hubDecision: s.hubDecision || "",
            operations: json(normalizeOperations(s.operations)), evidence: json(keepRuntime ? parse(existing.evidence_json, {}) : (s.evidence || {})),
            configVersion: surfacesCfg.version || 1, now });
        surfaces += 1;
      }
      for (const name of ["openai", "anthropic", "standards"]) {
        const cfg = readEcosystemConfig(config.v2Root, name);
        for (const c of cfg?.records || []) {
          db.prepare(`INSERT INTO capability_registry (id, provider, feature, category, surface_id, status, hub_relevance, hub_decision, programmatic, api_billing_risk, subscription_included, data_json, source_version, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET provider = excluded.provider, feature = excluded.feature, category = excluded.category, surface_id = excluded.surface_id,
              status = excluded.status, hub_relevance = excluded.hub_relevance, hub_decision = excluded.hub_decision, programmatic = excluded.programmatic,
              api_billing_risk = excluded.api_billing_risk, subscription_included = excluded.subscription_included, data_json = excluded.data_json,
              source_version = excluded.source_version, updated_at = excluded.updated_at`)
            .run(c.id, c.provider, c.feature, c.category || "other", c.executionSurface || null, c.status, c.hubRelevance || "LOW", c.hubDecision || "",
              c.programmaticIntegration || "UNKNOWN", c.apiBillingRisk || "unknown", c.subscriptionIncluded || "unknown", json(c), cfg.verifiedOn || "", now);
          caps += 1;
        }
      }
      if (surfaces || caps) bus.append({ type: "surfaces.seeded", scopeType: "system", scopeId: "surfaces", source: "seed", payload: { surfaces, capabilities: caps } });
    });
    return { surfaces, capabilities: caps };
  }

  /**
   * Updates availability of locally verifiable surfaces from provider inspections (no inference).
   * Everything else keeps the documented baseline from the audit.
   */
  function refreshAvailability(nativeMirror = null) {
    const now = clock().toISOString();
    const updates = [];
    // Account facts count only while fresh (same 24 h rule as the execution gate).
    const fresh = (state) => state && state.probedAt && (clock().getTime() - new Date(state.probedAt).getTime()) / 3600000 <= 24 && state.ok !== false;
    const codex = providerState.get("codex");
    const claude = providerState.get("claude");
    const set = (id, availability, reason, evidence, label, method) => {
      const current = get(id);
      if (!current) return;
      if (!AVAILABILITY.has(availability)) throw new Error(`bad availability ${availability}`);
      // Re-deriving the same facts (e.g. at every boot) is not a new verification.
      if (current.verifiedAt && current.availability === availability && current.availabilityReason === reason && JSON.stringify(current.evidence) === JSON.stringify(evidence)) return;
      db.prepare("UPDATE execution_surfaces SET availability = ?, availability_reason = ?, evidence_json = ?, verified_at = ?, updated_at = ? WHERE id = ?")
        .run(availability, reason, json(evidence), now, now, id);
      recordVerification({ surfaceId: id, method, label, summary: reason, evidence }, "hub");
      updates.push({ id, availability, label });
    };
    bus.transaction(() => {
      if (codex?.installation) {
        const ok = codex.installation.installed && fresh(codex) && codex.auth?.accountType === "chatgpt";
        set("openai.codex_app_server", ok ? "available" : codex.installation.installed ? "needs_setup" : "unavailable",
          ok ? `codex ${codex.installation.version}: app-server handshake + account/read ChatGPT` : codex.installation.installed ? "Instalat; verificarea contului lipsește, a eșuat sau are peste 24 h" : codex.installation.reason || "Neinstalat",
          { version: codex.installation.version, accountType: codex.auth?.accountType || null, planType: codex.auth?.planType || null, probedAt: codex.probedAt || null },
          ok ? "PASS_LOCAL" : "FAIL", "account_probe");
      }
      if (claude?.installation) {
        const ok = claude.installation.installed && fresh(claude) && claude.auth?.loggedIn && claude.auth?.authMethod === "claude.ai";
        set("anthropic.claude_code_headless", ok ? "available" : claude.installation.installed ? "needs_setup" : "unavailable",
          ok ? `Claude Code ${claude.installation.version}: claude auth status → claude.ai, ${claude.auth.subscriptionType}` : claude.installation.installed ? "Instalat; autentificarea claude.ai nu este verificată (sau verificarea are peste 24 h)" : claude.installation.reason || "Neinstalat",
          { version: claude.installation.version, authMethod: claude.auth?.authMethod || null, subscriptionType: claude.auth?.subscriptionType || null, probedAt: claude.probedAt || null },
          ok ? "PASS_LOCAL" : "FAIL", "account_probe");
      }
      if (nativeMirror) {
        set("anthropic.claude_code_background", nativeMirror.ok ? "available" : "unknown",
          nativeMirror.ok ? `claude agents --json citit: ${nativeMirror.sessions} sesiuni în proiecte înregistrate` : `Oglindirea a eșuat: ${nativeMirror.error}`,
          { observedAt: nativeMirror.observedAt, sessions: nativeMirror.sessions, unregistered: nativeMirror.unregisteredCount }, nativeMirror.ok ? "PASS_LOCAL" : "FAIL", "local_cli");
      }
    });
    return updates;
  }

  /** Must run inside bus.transaction. */
  function recordVerification({ capabilityId = null, surfaceId = null, method, label, summary, evidence = {} }, actor = "hub") {
    if (!VERIFICATION_LABELS.includes(label)) throw new HubError("validation", "Unknown verification label");
    if (!["doc_read", "local_cli", "account_probe", "live_run", "simulated_test", "manual"].includes(method)) throw new HubError("validation", "Unknown verification method");
    const id = newId("cver");
    db.prepare("INSERT INTO capability_verifications (id, capability_id, surface_id, method, label, summary, evidence_json, verified_by, verified_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, capabilityId, surfaceId, method, label, String(summary).slice(0, 1000), json(evidence), actor, clock().toISOString());
    bus.append({ type: "capability.verified", scopeType: "capability", scopeId: capabilityId || surfaceId || id, source: actor, payload: { method, label, surfaceId, capabilityId } });
    return id;
  }

  const verifications = ({ capabilityId = null, surfaceId = null, limit = 200 } = {}) => {
    const where = []; const args = [];
    if (capabilityId) { where.push("capability_id = ?"); args.push(capabilityId); }
    if (surfaceId) { where.push("surface_id = ?"); args.push(surfaceId); }
    return db.prepare(`SELECT * FROM capability_verifications ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY verified_at DESC LIMIT ?`).all(...args, limit)
      .map((r) => ({ id: r.id, capabilityId: r.capability_id, surfaceId: r.surface_id, method: r.method, label: r.label, summary: r.summary, evidence: parse(r.evidence_json, {}), verifiedBy: r.verified_by, verifiedAt: r.verified_at }));
  };

  const capabilities = ({ provider = null, category = null } = {}) => {
    const where = []; const args = [];
    if (provider) { where.push("provider = ?"); args.push(provider); }
    if (category) { where.push("category = ?"); args.push(category); }
    return db.prepare(`SELECT * FROM capability_registry ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY provider, category, id`).all(...args).map(rowToCap);
  };
  const capability = (id) => rowToCap(db.prepare("SELECT * FROM capability_registry WHERE id = ?").get(id));

  /** ExecutionSurfaceAdapter contract check: returns the support level or throws UNSUPPORTED. */
  function requireOperation(surfaceId, operation) {
    const surface = get(surfaceId);
    if (!surface) throw new HubError("not_found", `Unknown execution surface ${surfaceId}`);
    if (!SURFACE_OPERATIONS.includes(operation)) throw new HubError("validation", `Unknown operation ${operation}`);
    const support = surface.operations[operation]?.support || "UNSUPPORTED";
    if (support === "UNSUPPORTED" || support === "PLANNED") {
      throw new HubError("validation", `UNSUPPORTED: ${surface.name} nu oferă „${operation}”${surface.operations[operation]?.note ? ` (${surface.operations[operation].note})` : ""}`,
        { data: { surfaceId, operation, support } });
    }
    return { surface, support };
  }

  return { seed, get, list, refreshAvailability, recordVerification, verifications, capabilities, capability, requireOperation };
}

function normalizeOperations(ops = {}) {
  const out = {};
  for (const op of SURFACE_OPERATIONS) {
    const value = ops[op];
    const support = typeof value === "string" ? value : value?.support || "UNSUPPORTED";
    if (!OPERATION_SUPPORT.includes(support)) throw new Error(`Invalid support ${support} for ${op}`);
    out[op] = { support, note: typeof value === "object" && value?.note ? value.note : "" };
  }
  return out;
}

function validateSurface(s) {
  const problems = [];
  if (!/^[a-z0-9]+\.[a-z0-9_]+$/.test(s.id || "")) problems.push("id");
  if (!["openai", "anthropic", "hub", "openclaw", "third_party"].includes(s.provider)) problems.push("provider");
  if (!["PROGRAMMATIC", "ASSISTED", "NATIVE_INTERACTIVE", "MIRROR", "NONE"].includes(s.programmaticControl)) problems.push("programmaticControl");
  if (!["subscription", "none", "api", "paid_plan", "cloud_provider", "unknown"].includes(s.billingMode || "unknown")) problems.push("billingMode");
  if (s.availability && !AVAILABILITY.has(s.availability)) problems.push("availability");
  if (problems.length) throw new Error(`surfaces.json: invalid ${problems.join(", ")} in ${s.id}`);
}
