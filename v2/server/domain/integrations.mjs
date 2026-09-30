import { json, parse } from "../storage/db.mjs";
import { readEcosystemConfig } from "./surfaces.mjs";
import { catalogEntry } from "../policy/approval-policy.mjs";

export const INTEGRATION_KINDS = Object.freeze(["hub_tool", "mcp_server", "mcp_tool", "claude_connector", "claude_skill", "claude_plugin", "codex_plugin",
  "openai_plugin", "openclaw_integration", "native_capability"]);

/**
 * Tool / connector registry. One logical list of what can act on the world: Hub tools, MCP servers
 * and tools, Claude connectors/skills/plugins, Codex/OpenAI plugins and OpenClaw integrations. For
 * each: source, schema, permissions, side effects, scope, permission tier, the approval policy that
 * applies (from the Hub catalog — a vendor permission prompt never replaces it), capability, status
 * and the surface that owns it. Discovery is config snapshot + Hub tool definitions; the Hub never
 * installs or connects an integration by itself.
 */
/** Hub tool status → registry status; a tool that still needs an install approval is never reported as available. */
export function hubToolStatus(status) {
  if (status === "blocked") return "blocked";
  if (status === "NEEDS_INSTALL_APPROVAL") return "needs_setup";
  return "available";
}

export function createIntegrations({ db, bus, clock, config, toolDefinitions }) {
  const rowTo = (r) => r && ({ id: r.id, kind: r.kind, source: r.source, name: r.name, description: r.description, schema: parse(r.schema_json, {}),
    permissions: parse(r.permissions_json, []), sideEffects: r.side_effects, scope: r.scope, permissionTier: r.permission_tier, capabilityId: r.capability_id,
    ownerSurfaceId: r.owner_surface_id, status: r.status, statusReason: r.status_reason, data: parse(r.data_json, {}), discoveredVia: r.discovered_via,
    discoveredAt: r.discovered_at, updatedAt: r.updated_at, approvalPolicy: policyFor(r) });

  function policyFor(r) {
    const data = parse(r.data_json, {});
    const actionKind = data.actionKind || (r.kind === "hub_tool" ? r.id.replace(/^hub\./, "") : r.side_effects === "external" ? "connector.write" : r.side_effects === "none" ? "connector.read" : "provider.command");
    const entry = catalogEntry(actionKind);
    return { actionKind, policy: entry?.policy || "ALWAYS_ASK", loosest: entry?.loosest || "ALWAYS_ASK", vendorPromptReplacesHub: false };
  }

  function upsert(item, via, now) {
    db.prepare(`INSERT INTO integrations (id, kind, source, name, description, schema_json, permissions_json, side_effects, scope, permission_tier, capability_id, owner_surface_id,
        status, status_reason, data_json, discovered_via, discovered_at, updated_at) VALUES (@id, @kind, @source, @name, @description, @schema, @permissions, @sideEffects, @scope,
        @tier, @capabilityId, @ownerSurfaceId, @status, @statusReason, @data, @via, @now, @now)
      ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, source = excluded.source, name = excluded.name, description = excluded.description, schema_json = excluded.schema_json,
        permissions_json = excluded.permissions_json, side_effects = excluded.side_effects, scope = excluded.scope, permission_tier = excluded.permission_tier,
        capability_id = excluded.capability_id, owner_surface_id = excluded.owner_surface_id, status = excluded.status, status_reason = excluded.status_reason,
        data_json = excluded.data_json, discovered_via = excluded.discovered_via, updated_at = excluded.updated_at`)
      .run({ id: item.id, kind: item.kind, source: item.source, name: item.name, description: item.description || "", schema: json(item.schema || {}),
        permissions: json(item.permissions || []), sideEffects: item.sideEffects || "unknown", scope: item.scope || "global", tier: item.permissionTier || "READ_ONLY",
        capabilityId: item.capabilityId || null, ownerSurfaceId: item.ownerSurfaceId || null, status: item.status || "unknown", statusReason: item.statusReason || "",
        data: json(item.data || {}), via, now });
  }

  function seed() {
    const now = clock().toISOString();
    const cfg = readEcosystemConfig(config.v2Root, "integrations");
    let count = 0;
    bus.transaction(() => {
      for (const t of toolDefinitions) {
        upsert({ id: `hub.${t.id}`, kind: "hub_tool", source: "hub", name: t.id, description: t.result, schema: t.schema, sideEffects: t.effects === "none" || t.effects.startsWith("none") ? "none" : t.effects.includes("local") ? "local" : "local",
          scope: "project", permissionTier: t.tier, ownerSurfaceId: "hub.local", status: hubToolStatus(t.status), statusReason: t.reason || "",
          data: { actionKind: t.id, timeoutMs: t.timeoutMs } }, "hub-tools", now);
        count += 1;
      }
      for (const item of cfg?.integrations || []) {
        if (!INTEGRATION_KINDS.includes(item.kind)) throw new Error(`integrations.json: bad kind ${item.kind} in ${item.id}`);
        upsert(item, item.discoveredVia || "config-snapshot", now);
        count += 1;
      }
      bus.append({ type: "integrations.seeded", scopeType: "system", scopeId: "integrations", source: "seed", payload: { count, snapshotDate: cfg?.verifiedOn || null } });
    });
    return count;
  }

  const list = ({ kind = null } = {}) => (kind
    ? db.prepare("SELECT * FROM integrations WHERE kind = ? ORDER BY source, name").all(kind)
    : db.prepare("SELECT * FROM integrations ORDER BY kind, source, name").all()).map(rowTo);
  const get = (id) => rowTo(db.prepare("SELECT * FROM integrations WHERE id = ?").get(id));

  return { seed, list, get };
}
