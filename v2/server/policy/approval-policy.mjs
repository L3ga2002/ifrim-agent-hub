import { HubError } from "../core/errors.mjs";
import { newId } from "../core/ids.mjs";
import { PERMISSION_TIERS } from "./approvals.mjs";

export const APPROVAL_POLICIES = Object.freeze(["AUTO_ALLOWED", "ASK_ONCE_FOR_TASK", "ALWAYS_ASK", "DENIED"]);
const STRICTNESS = { AUTO_ALLOWED: 0, ASK_ONCE_FOR_TASK: 1, ALWAYS_ASK: 2, DENIED: 3 };
const TASK_SCOPE_TTL_HOURS = 8;

/**
 * Catalog of action kinds the Hub knows. `policy` is the default, `loosest` the most permissive
 * policy a user rule may set (a rule can always be stricter), `locked` means nobody can change it
 * (billing policy and credential handling). Unknown action kinds fall back to ALWAYS_ASK.
 * The same catalog applies when the action is executed by a vendor surface (Claude computer use,
 * connectors, Claude in Chrome, OpenAI plugins, OpenClaw, Paperclip, Agent Zero): a vendor
 * permission dialog is an additional layer and never replaces the Hub decision.
 */
export const ACTION_CATALOG = Object.freeze([
  ...["files.list", "files.read", "git.status", "git.diff", "git.log", "git.prepareCommit", "preview.check", "process.list", "surface.inspect", "native.mirror", "memory.search"]
    .map((actionKind) => ({ actionKind, tier: "READ_ONLY", effects: "none", policy: "AUTO_ALLOWED", loosest: "AUTO_ALLOWED", label: "Citire locală" })),
  { actionKind: "provider.fileChange", tier: "WORKSPACE_EDIT", effects: "local", policy: "ALWAYS_ASK", loosest: "ASK_ONCE_FOR_TASK", label: "Modificare de fișiere propusă de un model" },
  { actionKind: "provider.command", tier: "DEVELOPMENT_TOOLS", effects: "local", policy: "ALWAYS_ASK", loosest: "ASK_ONCE_FOR_TASK", label: "Comandă propusă de un model" },
  { actionKind: "process.run", tier: "DEVELOPMENT_TOOLS", effects: "local", policy: "ALWAYS_ASK", loosest: "ASK_ONCE_FOR_TASK", label: "Script npm al proiectului" },
  { actionKind: "browser.inspect", tier: "DEVELOPMENT_TOOLS", effects: "local", policy: "ALWAYS_ASK", loosest: "ASK_ONCE_FOR_TASK", label: "Browser local structurat (Playwright)" },
  { actionKind: "browser.native", tier: "SENSITIVE_ACTIONS", effects: "external", policy: "ALWAYS_ASK", loosest: "ALWAYS_ASK", label: "Browser nativ (Claude in Chrome / Codex browser) pe conturile tale" },
  { actionKind: "computer.visual_control", tier: "SENSITIVE_ACTIONS", effects: "local", policy: "ALWAYS_ASK", loosest: "ALWAYS_ASK", label: "Control vizual al desktopului" },
  { actionKind: "screen.capture", tier: "SENSITIVE_ACTIONS", effects: "local", policy: "ALWAYS_ASK", loosest: "ALWAYS_ASK", label: "Captură de ecran" },
  { actionKind: "connector.read", tier: "READ_ONLY", effects: "external", policy: "ASK_ONCE_FOR_TASK", loosest: "AUTO_ALLOWED", label: "Citire printr-un connector/plugin extern" },
  { actionKind: "connector.write", tier: "EXTERNAL_ACTIONS", effects: "external", policy: "ALWAYS_ASK", loosest: "ALWAYS_ASK", label: "Scriere printr-un connector/plugin extern" },
  { actionKind: "message.send", tier: "EXTERNAL_ACTIONS", effects: "external", policy: "ALWAYS_ASK", loosest: "ALWAYS_ASK", label: "Trimitere mesaj/e-mail" },
  { actionKind: "git.commit", tier: "DEVELOPMENT_TOOLS", effects: "local", policy: "ALWAYS_ASK", loosest: "ALWAYS_ASK", label: "Commit Git" },
  { actionKind: "git.push", tier: "EXTERNAL_ACTIONS", effects: "external", policy: "ALWAYS_ASK", loosest: "ALWAYS_ASK", label: "Push Git / PR" },
  { actionKind: "deploy", tier: "EXTERNAL_ACTIONS", effects: "external", policy: "ALWAYS_ASK", loosest: "ALWAYS_ASK", label: "Deploy" },
  { actionKind: "cloud_task.start", tier: "EXTERNAL_ACTIONS", effects: "external", policy: "ALWAYS_ASK", loosest: "ALWAYS_ASK", label: "Pornire task cloud (Codex Cloud, rutină Claude, dot)" },
  { actionKind: "native_schedule.create", tier: "EXTERNAL_ACTIONS", effects: "external", policy: "ALWAYS_ASK", loosest: "ALWAYS_ASK", label: "Creare programare nativă Claude/OpenAI" },
  { actionKind: "data.delete", tier: "SENSITIVE_ACTIONS", effects: "local", policy: "ALWAYS_ASK", loosest: "ALWAYS_ASK", label: "Ștergere de date/istoric" },
  { actionKind: "auth.change", tier: "SENSITIVE_ACTIONS", effects: "external", policy: "ALWAYS_ASK", loosest: "ALWAYS_ASK", label: "Schimbare autentificare sau permisiuni" },
  { actionKind: "billing.purchase_credits", tier: "SENSITIVE_ACTIONS", effects: "external", policy: "DENIED", loosest: "DENIED", locked: true, label: "Cumpărare credite" },
  { actionKind: "billing.enable_extra_usage", tier: "SENSITIVE_ACTIONS", effects: "external", policy: "DENIED", loosest: "DENIED", locked: true, label: "Activare extra usage" },
  { actionKind: "billing.plan_upgrade", tier: "SENSITIVE_ACTIONS", effects: "external", policy: "DENIED", loosest: "DENIED", locked: true, label: "Upgrade de abonament" },
  { actionKind: "billing.paid_api_route", tier: "SENSITIVE_ACTIONS", effects: "external", policy: "DENIED", loosest: "DENIED", locked: true, label: "Rută de inferență API plătită" },
  { actionKind: "credentials.enter", tier: "SENSITIVE_ACTIONS", effects: "external", policy: "DENIED", loosest: "DENIED", locked: true, label: "Introducere parole/chei/token-uri" },
  { actionKind: "skill.permission_escalation", tier: "SENSITIVE_ACTIONS", effects: "none", policy: "DENIED", loosest: "DENIED", locked: true, label: "Skill care cere permisiuni peste rol" },
]);

const catalogByKind = new Map(ACTION_CATALOG.map((a) => [a.actionKind, a]));
export const catalogEntry = (actionKind) => catalogByKind.get(actionKind) || null;
export const stricter = (a, b) => (STRICTNESS[a] >= STRICTNESS[b] ? a : b);

/**
 * Approval policy engine: AUTO_ALLOWED / ASK_ONCE_FOR_TASK / ALWAYS_ASK / DENIED. Returns a decision
 * (allow | ask | deny) with the reason and the rule that produced it. User rules are stored in
 * `approval_policies`; defaults live in the catalog above.
 */
export function createApprovalPolicy({ db, bus, clock }) {
  const rowToRule = (row) => row && ({ id: row.id, actionKind: row.action_kind, surfaceId: row.surface_id, projectId: row.project_id, policy: row.policy,
    reason: row.reason, source: row.source, createdAt: row.created_at, updatedAt: row.updated_at, version: row.version });

  function rulesFor(actionKind) {
    return db.prepare("SELECT * FROM approval_policies WHERE action_kind = ?").all(actionKind).map(rowToRule);
  }

  /** Most specific user rule wins (surface+project > surface > project > global), bounded by `loosest`. */
  function resolve({ actionKind, surfaceId = "*", projectId = "*" }) {
    const entry = catalogEntry(actionKind);
    const base = entry ? entry.policy : "ALWAYS_ASK";
    if (entry?.locked) return { policy: base, source: "catalog", locked: true, rule: null, entry };
    const candidates = rulesFor(actionKind).filter((r) => (r.surfaceId === "*" || r.surfaceId === surfaceId) && (r.projectId === "*" || r.projectId === projectId));
    candidates.sort((a, b) => specificity(b) - specificity(a));
    const rule = candidates[0] || null;
    if (!rule) return { policy: base, source: entry ? "catalog" : "fallback", locked: false, rule: null, entry };
    const floor = entry?.loosest || "ALWAYS_ASK";
    const policy = STRICTNESS[rule.policy] < STRICTNESS[floor] ? floor : rule.policy;
    return { policy, source: "user", locked: false, rule, entry };
  }

  const activeScope = db.prepare(`SELECT * FROM task_approval_scopes WHERE task_id = ? AND action_kind = ? AND target = ? AND surface_id IN (?, '*')
    AND status = 'active' ORDER BY granted_at DESC LIMIT 1`);

  /**
   * Evaluates an action. `taskId` enables ASK_ONCE_FOR_TASK scopes; without a task the policy degrades
   * to ALWAYS_ASK (there is no task to bind the one-time consent to).
   */
  function evaluate({ actionKind, surfaceId = "*", projectId = "*", taskId = null, target = "" }) {
    const resolved = resolve({ actionKind, surfaceId, projectId });
    const base = { actionKind, surfaceId, projectId, taskId, policy: resolved.policy, source: resolved.source, locked: resolved.locked,
      ruleId: resolved.rule?.id || null, tier: resolved.entry?.tier || "SENSITIVE_ACTIONS", vendorDialogReplacesHub: false };
    if (resolved.policy === "DENIED") return { ...base, decision: "deny", reason: resolved.locked ? "Interzis de politica Hub (nu poate fi schimbat)" : "Interzis de o regulă a ta" };
    if (resolved.policy === "AUTO_ALLOWED") return { ...base, decision: "allow", reason: resolved.source === "user" ? "Permis automat de regula ta" : "Acțiune fără efecte, permisă automat" };
    if (resolved.policy === "ASK_ONCE_FOR_TASK") {
      if (!taskId) return { ...base, decision: "ask", reason: "O dată per task, dar acțiunea nu aparține unui task: se cere aprobare" };
      const scope = activeScope.get(taskId, actionKind, target, surfaceId);
      if (scope && new Date(scope.expires_at) > clock()) return { ...base, decision: "allow", scopeId: scope.id, reason: `Aprobat o dată pentru task (${scope.approval_id})` };
      return { ...base, decision: "ask", reason: "Prima acțiune de acest tip în task: aprobarea ta se aplică apoi întregului task" };
    }
    return { ...base, decision: "ask", reason: "Necesită aprobarea ta de fiecare dată" };
  }

  /** Must run inside bus.transaction. */
  function setRule({ actionKind, surfaceId = "*", projectId = "*", policy, reason }, actor = "user") {
    if (!APPROVAL_POLICIES.includes(policy)) throw new HubError("validation", "Unknown approval policy");
    if (!reason || reason.trim().length < 3) throw new HubError("validation", "A policy rule needs a reason");
    const entry = catalogEntry(actionKind);
    if (!entry) throw new HubError("validation", `Unknown action kind ${actionKind}`);
    if (entry.locked) throw new HubError("policy", `${actionKind} is fixed by the Hub policy`);
    if (STRICTNESS[policy] < STRICTNESS[entry.loosest]) throw new HubError("policy", `${actionKind} cannot be looser than ${entry.loosest}`);
    const now = clock().toISOString();
    const existing = db.prepare("SELECT * FROM approval_policies WHERE action_kind = ? AND surface_id = ? AND project_id = ? AND source = 'user'").get(actionKind, surfaceId, projectId);
    const id = existing?.id || newId("pol");
    if (existing) db.prepare("UPDATE approval_policies SET policy = ?, reason = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(policy, reason.trim(), now, id);
    else db.prepare("INSERT INTO approval_policies (id, action_kind, surface_id, project_id, policy, reason, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'user', ?, ?)")
      .run(id, actionKind, surfaceId, projectId, policy, reason.trim(), now, now);
    bus.append({ type: "policy.rule_set", scopeType: "policy", scopeId: id, source: actor, payload: { actionKind, surfaceId, projectId, policy, previous: existing?.policy || null } });
    return rowToRule(db.prepare("SELECT * FROM approval_policies WHERE id = ?").get(id));
  }

  /** Must run inside bus.transaction. */
  function removeRule(id, actor = "user") {
    const row = db.prepare("SELECT * FROM approval_policies WHERE id = ? AND source = 'user'").get(id);
    if (!row) throw new HubError("not_found", "Policy rule not found");
    db.prepare("DELETE FROM approval_policies WHERE id = ?").run(id);
    bus.append({ type: "policy.rule_removed", scopeType: "policy", scopeId: id, source: actor, payload: { actionKind: row.action_kind, policy: row.policy } });
    return true;
  }

  /** Records the one-time consent of an approved ASK_ONCE_FOR_TASK action. Must run inside bus.transaction. */
  function grantTaskScope({ taskId, actionKind, target = "", surfaceId = "*", approvalId }) {
    const now = clock();
    db.prepare("UPDATE task_approval_scopes SET status = 'expired' WHERE task_id = ? AND action_kind = ? AND target = ? AND surface_id = ? AND status = 'active'")
      .run(taskId, actionKind, target, surfaceId);
    const id = newId("tas");
    db.prepare(`INSERT INTO task_approval_scopes (id, task_id, action_kind, target, surface_id, approval_id, status, granted_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`).run(id, taskId, actionKind, target, surfaceId, approvalId, now.toISOString(),
      new Date(now.getTime() + TASK_SCOPE_TTL_HOURS * 3600000).toISOString());
    bus.append({ type: "policy.task_scope_granted", scopeType: "task", scopeId: taskId, source: "user", payload: { scopeId: id, actionKind, approvalId, ttlHours: TASK_SCOPE_TTL_HOURS } });
    return id;
  }

  function useTaskScope(scopeId) {
    db.prepare("UPDATE task_approval_scopes SET uses = uses + 1 WHERE id = ?").run(scopeId);
  }

  /** Ends every one-time consent of a task (task finished, cancelled, or Stop All). Must run inside bus.transaction. */
  function revokeTaskScopes(taskId, reason, actor = "hub") {
    const where = taskId ? "task_id = ? AND status = 'active'" : "status = 'active'";
    const changed = db.prepare(`UPDATE task_approval_scopes SET status = 'revoked', revoked_at = ? WHERE ${where}`).run(clock().toISOString(), ...(taskId ? [taskId] : [])).changes;
    if (changed) bus.append({ type: "policy.task_scopes_revoked", scopeType: taskId ? "task" : "system", scopeId: taskId || "policy", source: actor, payload: { count: changed, reason } });
    return changed;
  }

  function list() {
    return { policies: APPROVAL_POLICIES, tiers: PERMISSION_TIERS, catalog: ACTION_CATALOG,
      rules: db.prepare("SELECT * FROM approval_policies ORDER BY action_kind").all().map(rowToRule),
      activeTaskScopes: db.prepare("SELECT * FROM task_approval_scopes WHERE status = 'active' ORDER BY granted_at DESC LIMIT 100").all() };
  }

  return { evaluate, resolve, setRule, removeRule, grantTaskScope, useTaskScope, revokeTaskScopes, list };
}

const specificity = (rule) => (rule.surfaceId !== "*" ? 2 : 0) + (rule.projectId !== "*" ? 1 : 0);
