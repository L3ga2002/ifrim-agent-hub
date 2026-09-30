import { HubError } from "../core/errors.mjs";
import { newId } from "../core/ids.mjs";
import { json, parse } from "../storage/db.mjs";
import { assertTransition, isTerminal } from "../runtime/lifecycles.mjs";

export const COMPANY_SEED = Object.freeze({
  slug: "ifrim-digital", name: "Ifrim Digital", owner: "Cătălin Ifrim",
  mission: "Agenție software și web care livrează proiecte premium cu o echipă de agenți AI coordonată și verificată de fondator.",
});

/**
 * Departments of the AI company. Four are validated in Milestone 01 (Executive, Engineering, Sales,
 * Operations); the rest exist as planned structure so later milestones add work without a redesign.
 */
export const DEPARTMENT_SEED = Object.freeze([
  { key: "executive", name: "Executive", purpose: "Obiective, priorități, decizii și coordonare între departamente (Chief of Staff).", status: "active", validated: true, head: "chief-of-staff" },
  { key: "product", name: "Product / Strategy", purpose: "Scop, criterii de acceptanță, roadmap.", status: "planned", validated: false, head: "planner" },
  { key: "engineering", name: "Engineering", purpose: "Arhitectură, implementare, documentație tehnică.", status: "active", validated: true, head: "architect" },
  { key: "qa-security", name: "QA / Security", purpose: "Review independent, QA pe criterii, securitate.", status: "planned", validated: false, head: "qa" },
  { key: "devops", name: "DevOps / Infrastructure", purpose: "Build, release, medii, backup și recuperare.", status: "planned", validated: false, head: "devops" },
  { key: "sales", name: "Sales / Lead Generation", purpose: "Lead-uri cu dovezi, audituri de site, oferte (doar ciorne).", status: "active", validated: true, head: "sales-assistant" },
  { key: "marketing", name: "Marketing / Growth", purpose: "Conținut și campanii (fără trimiteri automate).", status: "planned", validated: false, head: null },
  { key: "customer-success", name: "Customer Success", purpose: "Suport și relația cu clienții existenți.", status: "planned", validated: false, head: null },
  { key: "project-management", name: "Project Management", purpose: "Planuri de proiect, dependențe, termene.", status: "planned", validated: false, head: "project-manager" },
  { key: "operations", name: "Operations", purpose: "Sănătatea sistemului, backup-uri, programări, briefing-uri, allowance.", status: "active", validated: true, head: "operations-coordinator" },
  { key: "research", name: "Research / Intelligence", purpose: "Cercetare cu surse și dată, fără date inventate.", status: "planned", validated: false, head: "research" },
  { key: "finance-admin", name: "Finance / Admin", purpose: "Asistență administrativă; nicio plată sau tranzacție automată.", status: "planned", validated: false, head: null },
]);

const PRIORITIES = [1, 2, 3];

/**
 * Company runtime: company → departments → goals → objectives, org chart (manager relationships
 * between AgentRoles) and the links from missions/tasks to departments and goals. AgentRole is a
 * definition; AgentRun is an execution — the org chart never implies a running model.
 */
export function createCompany({ db, bus, clock, roleConfig }) {
  const rowToCompany = (r) => r && ({ id: r.id, slug: r.slug, name: r.name, mission: r.mission, owner: r.owner, createdAt: r.created_at, updatedAt: r.updated_at, version: r.version });
  const rowToDept = (r) => r && ({ id: r.id, companyId: r.company_id, key: r.key, name: r.name, purpose: r.purpose, status: r.status,
    milestoneValidated: Boolean(r.milestone_validated), headRoleId: r.head_role_id, sort: r.sort, updatedAt: r.updated_at, version: r.version });
  const rowToGoal = (r) => r && ({ id: r.id, companyId: r.company_id, departmentId: r.department_id, title: r.title, description: r.description, status: r.status,
    statusReason: r.status_reason, priority: r.priority, ownerRoleId: r.owner_role_id, dueAt: r.due_at, successMetrics: parse(r.success_metrics_json, []),
    source: r.source, createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at, version: r.version });
  const rowToObjective = (r) => r && ({ id: r.id, goalId: r.goal_id, departmentId: r.department_id, title: r.title, keyResult: r.key_result,
    targetValue: r.target_value, currentValue: r.current_value, unit: r.unit, status: r.status, statusReason: r.status_reason, updatedAt: r.updated_at, version: r.version });

  const company = () => rowToCompany(db.prepare("SELECT * FROM companies WHERE slug = ?").get(COMPANY_SEED.slug));
  const departments = () => db.prepare("SELECT * FROM departments ORDER BY sort").all().map(rowToDept);
  const department = (idOrKey) => rowToDept(db.prepare("SELECT * FROM departments WHERE id = ? OR key = ?").get(idOrKey, idOrKey));

  /** Idempotent seed: company, departments, role→department links and the org chart. Runs at boot. */
  function seed() {
    const now = clock().toISOString();
    bus.transaction(() => {
      let c = company();
      if (!c) {
        const id = newId("co");
        db.prepare("INSERT INTO companies (id, slug, name, mission, owner, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
          .run(id, COMPANY_SEED.slug, COMPANY_SEED.name, COMPANY_SEED.mission, COMPANY_SEED.owner, now, now);
        bus.append({ type: "company.created", scopeType: "company", scopeId: id, companyId: id, source: "seed", payload: { name: COMPANY_SEED.name } });
        c = company();
      }
      bus.setDefaultCompany?.(c.id);
      DEPARTMENT_SEED.forEach((d, index) => {
        const existing = db.prepare("SELECT id FROM departments WHERE company_id = ? AND key = ?").get(c.id, d.key);
        if (existing) {
          db.prepare("UPDATE departments SET head_role_id = COALESCE(head_role_id, ?), sort = ? WHERE id = ?").run(d.head, index, existing.id);
          return;
        }
        const id = newId("dept");
        db.prepare(`INSERT INTO departments (id, company_id, key, name, purpose, status, milestone_validated, head_role_id, sort, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, c.id, d.key, d.name, d.purpose, d.status, d.validated ? 1 : 0, d.head, index, now, now);
        bus.append({ type: "department.created", scopeType: "department", scopeId: id, companyId: c.id, departmentId: id, source: "seed", payload: { key: d.key, status: d.status } });
      });
      for (const role of roleConfig.roles) {
        const dept = role.department ? db.prepare("SELECT id FROM departments WHERE company_id = ? AND key = ?").get(c.id, role.department) : null;
        db.prepare("UPDATE agent_roles SET department_id = ? WHERE id = ?").run(dept?.id || null, role.id);
        if (role.reportsTo) {
          db.prepare(`INSERT INTO manager_relationships (id, company_id, manager_role_id, report_role_id, department_id, created_at) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(company_id, report_role_id) DO UPDATE SET manager_role_id = excluded.manager_role_id, department_id = excluded.department_id`)
            .run(newId("mgr"), c.id, role.reportsTo, role.id, dept?.id || null, now);
        }
      }
    });
    return company();
  }

  function orgChart() {
    const c = company();
    const rels = db.prepare("SELECT manager_role_id, report_role_id, department_id FROM manager_relationships WHERE company_id = ?").all(c.id);
    const roles = roleConfig.roles.map((r) => ({ id: r.id, name: r.name, department: r.department || null, authority: r.authority, reportsTo: rels.find((x) => x.report_role_id === r.id)?.manager_role_id || null }));
    return { owner: c.owner, roles, edges: rels.map((r) => ({ manager: r.manager_role_id, report: r.report_role_id })),
      note: "Organigrama leagă definiții de roluri (AgentRole). Un rol nu înseamnă un model pornit; execuțiile (AgentRun) apar doar prin poarta de execuție." };
  }

  function setDepartmentStatus(idOrKey, status, reason, actor = "user") {
    const d = department(idOrKey);
    if (!d) throw new HubError("not_found", "Department not found");
    if (!["active", "planned", "paused"].includes(status)) throw new HubError("validation", "Unknown department status");
    if (!reason || reason.trim().length < 3) throw new HubError("validation", "A reason is required");
    if (d.status === status) return d;
    db.prepare("UPDATE departments SET status = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(status, clock().toISOString(), d.id);
    bus.append({ type: "department.status", scopeType: "department", scopeId: d.id, departmentId: d.id, source: actor, payload: { from: d.status, to: status, reason } });
    return department(d.id);
  }

  // ---------- goals ----------
  const goal = (id) => rowToGoal(db.prepare("SELECT * FROM goals WHERE id = ?").get(id));
  const goals = ({ status = null, departmentId = null } = {}) => {
    const where = []; const args = [];
    if (status) { where.push("status = ?"); args.push(status); }
    if (departmentId) { where.push("department_id = ?"); args.push(departmentId); }
    return db.prepare(`SELECT * FROM goals ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY priority, COALESCE(due_at, '9999') , created_at DESC LIMIT 300`).all(...args).map(rowToGoal);
  };

  /** Must run inside bus.transaction. */
  function createGoal({ title, description = "", departmentId = null, priority = 2, ownerRoleId = "", dueAt = null, successMetrics = [], source = "user" }, actor = "user") {
    const c = company();
    const dept = departmentId ? department(departmentId) : null;
    if (departmentId && !dept) throw new HubError("not_found", "Department not found");
    if (!PRIORITIES.includes(priority)) throw new HubError("validation", "priority must be 1..3");
    if (dueAt && Number.isNaN(Date.parse(dueAt))) throw new HubError("validation", "dueAt must be a date");
    const id = newId("goal");
    const now = clock().toISOString();
    db.prepare(`INSERT INTO goals (id, company_id, department_id, title, description, status, status_reason, priority, owner_role_id, due_at, success_metrics_json, source, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'DRAFT', 'Creat', ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, c.id, dept?.id || null, title, description, priority, ownerRoleId || dept?.headRoleId || "chief-of-staff",
      dueAt, json(successMetrics), source, actor, now, now);
    bus.append({ type: "goal.created", scopeType: "goal", scopeId: id, companyId: c.id, departmentId: dept?.id || null, source: actor, payload: { title, priority, source } });
    return goal(id);
  }

  /** Must run inside bus.transaction. ACHIEVED needs every objective MET or recorded manual verification. */
  function transitionGoal(id, to, { reason, actor = "user", evidence = null, expectedVersion = null }) {
    const g = goal(id);
    if (!g) throw new HubError("not_found", "Goal not found");
    if (expectedVersion !== null && g.version !== expectedVersion) throw new HubError("conflict", "Goal changed; reload and retry");
    if (!assertTransition("goal", g.status, to, reason)) return g;
    if (to === "ACHIEVED") {
      const objectives = objectivesOf(id).filter((o) => o.status !== "DROPPED");
      const allMet = objectives.length > 0 && objectives.every((o) => o.status === "MET");
      const manual = evidence?.manualVerification && String(evidence.manualVerification).trim().length >= 10;
      if (!allMet && !manual) throw new HubError("task", "Un obiectiv este atins doar cu toate rezultatele-cheie MET sau cu o verificare manuală descrisă");
    }
    const result = db.prepare("UPDATE goals SET status = ?, status_reason = ?, updated_at = ?, version = version + 1 WHERE id = ? AND version = ?")
      .run(to, reason, clock().toISOString(), id, g.version);
    if (result.changes !== 1) throw new HubError("conflict", "Goal changed concurrently");
    bus.append({ type: `goal.${to.toLowerCase()}`, scopeType: "goal", scopeId: id, departmentId: g.departmentId, source: actor, payload: { from: g.status, to, reason, evidence: evidence || undefined } });
    return goal(id);
  }

  // ---------- objectives ----------
  const objective = (id) => rowToObjective(db.prepare("SELECT * FROM objectives WHERE id = ?").get(id));
  const objectivesOf = (goalId) => db.prepare("SELECT * FROM objectives WHERE goal_id = ? ORDER BY created_at").all(goalId).map(rowToObjective);

  /** Must run inside bus.transaction. */
  function createObjective({ goalId, title, keyResult = "", targetValue = null, unit = "", departmentId = null }, actor = "user") {
    const g = goal(goalId);
    if (!g) throw new HubError("not_found", "Goal not found");
    if (isTerminal("goal", g.status)) throw new HubError("task", `Goal is ${g.status}`);
    const dept = departmentId ? department(departmentId) : null;
    if (departmentId && !dept) throw new HubError("not_found", "Department not found");
    const id = newId("obj");
    const now = clock().toISOString();
    db.prepare(`INSERT INTO objectives (id, goal_id, department_id, title, key_result, target_value, current_value, unit, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 'OPEN', ?, ?)`).run(id, goalId, dept?.id || g.departmentId, title, keyResult, targetValue, unit, now, now);
    bus.append({ type: "objective.created", scopeType: "goal", scopeId: goalId, departmentId: dept?.id || g.departmentId, source: actor, payload: { objectiveId: id, title } });
    return objective(id);
  }

  /** Must run inside bus.transaction. Measured progress only; MET needs a value at/over target or a reason. */
  function updateObjective(id, { currentValue, status, reason = "" }, actor = "user") {
    const o = objective(id);
    if (!o) throw new HubError("not_found", "Objective not found");
    const next = status || o.status;
    if (next !== o.status) assertTransition("objective", o.status, next, reason || `Actualizat de ${actor}`);
    const value = currentValue === undefined ? o.currentValue : currentValue;
    if (value !== null && value !== undefined && !Number.isFinite(Number(value))) throw new HubError("validation", "currentValue must be a number");
    if (next === "MET" && o.targetValue !== null && !(Number(value) >= o.targetValue) && reason.trim().length < 10) {
      throw new HubError("task", "MET sub țintă necesită o justificare (min. 10 caractere)");
    }
    db.prepare("UPDATE objectives SET current_value = ?, status = ?, status_reason = ?, updated_at = ?, version = version + 1 WHERE id = ?")
      .run(value === undefined ? null : value, next, reason || o.statusReason, clock().toISOString(), id);
    bus.append({ type: "objective.updated", scopeType: "goal", scopeId: o.goalId, departmentId: o.departmentId, source: actor, payload: { objectiveId: id, status: next, currentValue: value } });
    return objective(id);
  }

  /** Links a mission to company structure. Must run inside bus.transaction. */
  function linkMission(missionId, { departmentId = null, goalId = null, objectiveId = null, clientId = null }, actor = "user") {
    const c = company();
    const current = db.prepare("SELECT goal_id, objective_id FROM missions WHERE id = ?").get(missionId);
    if (!current) throw new HubError("not_found", "Mission not found");
    const dept = departmentId ? department(departmentId) : null;
    if (departmentId && !dept) throw new HubError("not_found", "Department not found");
    if (goalId && !goal(goalId)) throw new HubError("not_found", "Goal not found");
    const targetGoal = goalId || current.goal_id;
    if (objectiveId) {
      const obj = objective(objectiveId);
      if (!obj) throw new HubError("not_found", "Objective not found");
      if (obj.goalId !== targetGoal) throw new HubError("validation", "Objective does not belong to the goal");
    }
    // Moving a mission to another goal without naming a new objective drops the old goal's objective.
    const nextObjective = objectiveId || (goalId && goalId !== current.goal_id ? null : current.objective_id);
    db.prepare("UPDATE missions SET company_id = ?, department_id = COALESCE(?, department_id), goal_id = COALESCE(?, goal_id), objective_id = ?, client_id = COALESCE(?, client_id), updated_at = ?, version = version + 1 WHERE id = ?")
      .run(c.id, dept?.id || null, goalId, nextObjective, clientId, clock().toISOString(), missionId);
    db.prepare("UPDATE tasks SET department_id = COALESCE(department_id, ?) WHERE mission_id = ?").run(dept?.id || null, missionId);
    bus.append({ type: "mission.linked", scopeType: "mission", scopeId: missionId, departmentId: dept?.id || null, source: actor, payload: { departmentKey: dept?.key || null, goalId, objectiveId } });
  }

  /** Company overview: departments with roles, active work, blockers; goals with objectives and missions. */
  function overview() {
    const c = company();
    const depts = departments().map((d) => {
      const counts = db.prepare(`SELECT
          (SELECT COUNT(*) FROM goals WHERE department_id = @id AND status NOT IN ('ACHIEVED','ABANDONED')) AS goals,
          (SELECT COUNT(*) FROM missions WHERE department_id = @id AND status NOT IN ('COMPLETED','CANCELLED')) AS missions,
          (SELECT COUNT(*) FROM tasks WHERE department_id = @id AND status IN ('BLOCKED','FAILED','WAITING_APPROVAL','WAITING_PROVIDER')) AS attention,
          (SELECT COUNT(*) FROM agent_runs WHERE department_id = @id AND status IN ('starting','running','waiting_approval')) AS activeRuns`).get({ id: d.id });
      return { ...d, roles: roleConfig.roles.filter((r) => r.department === d.key).map((r) => ({ id: r.id, name: r.name, authority: r.authority })), counts };
    });
    const goalList = goals().map((g) => ({ ...g, objectives: objectivesOf(g.id),
      missions: db.prepare("SELECT id, title, status, kind, department_id AS departmentId FROM missions WHERE goal_id = ? ORDER BY created_at").all(g.id) }));
    return { company: c, departments: depts, goals: goalList, orgChart: orgChart(),
      clients: db.prepare("SELECT id, name, domain, status, demo FROM clients ORDER BY name").all() };
  }

  return { seed, company, departments, department, setDepartmentStatus, orgChart, goal, goals, createGoal, transitionGoal,
    objective, objectivesOf, createObjective, updateObjective, linkMission, overview };
}
