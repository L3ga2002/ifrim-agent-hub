import test from "node:test";
import assert from "node:assert/strict";
import { makeTestHub } from "./helpers.mjs";
import { HubError } from "../server/core/errors.mjs";
import { rowToEvent } from "../server/events/bus.mjs";
import { COMPANY_SEED, DEPARTMENT_SEED } from "../server/domain/company.mjs";
import { MISSION_TEMPLATES, TASK_TYPE_BY_ROLE } from "../server/domain/missions.mjs";
import { LIFECYCLES, describeLifecycles, assertTransition, canTransition, isTerminal } from "../server/runtime/lifecycles.mjs";
import { TASK_STATES, canTransition as canTaskTransition, transitionTask } from "../server/runtime/state-machine.mjs";

const ACTIVE_DEPARTMENTS = ["engineering", "executive", "operations", "sales"];
const LIFECYCLE_IDS = ["agentRun", "approval", "goal", "handoff", "mission", "nativeScheduleRef", "objective", "providerSession", "schedule", "task"];

const count = (hub, table, where = "", ...args) => hub.db.prepare(`SELECT COUNT(*) AS n FROM ${table} ${where}`).get(...args).n;
const cmd = (hub, type, payload = {}, channel = "test") => hub.commands.dispatch({ type, payload, channel, actor: "user" });
const rejectsWith = (promise, category, pattern = null) => assert.rejects(promise, (error) => {
  assert.equal(error?.category, category, `expected a ${category} error, got ${error?.category}: ${error?.message}`);
  if (pattern) assert.match(error.message, pattern);
  return true;
});
// Exact-type read of the event log (newest first); independent of the diagnostics prefix filter covered by M01-C14.
const eventsOf = (hub, type, scopeId = null) => hub.db.prepare(`SELECT * FROM events WHERE type = ? ${scopeId ? "AND scope_id = ?" : ""} ORDER BY seq DESC`)
  .all(...(scopeId ? [type, scopeId] : [type])).map(rowToEvent);
const taskByTitle = (tasks, title) => {
  const found = tasks.find((task) => task.title === title);
  assert.ok(found, `task "${title}" exists`);
  return found;
};

test("M01-C01 seed: one company, 12 departments, exactly executive/engineering/sales/operations active and validated; re-seed is idempotent", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    assert.equal(count(hub, "companies"), 1);
    const company = hub.company.company();
    assert.equal(company.slug, COMPANY_SEED.slug);
    assert.equal(company.name, "Ifrim Digital");
    assert.equal(company.owner, COMPANY_SEED.owner);

    const departments = hub.company.departments();
    assert.equal(departments.length, 12);
    assert.deepEqual(departments.map((d) => d.key), DEPARTMENT_SEED.map((d) => d.key));
    assert.ok(departments.every((d) => d.companyId === company.id));
    assert.deepEqual(departments.filter((d) => d.status === "active").map((d) => d.key).sort(), ACTIVE_DEPARTMENTS);
    assert.deepEqual(departments.filter((d) => d.milestoneValidated).map((d) => d.key).sort(), ACTIVE_DEPARTMENTS);
    for (const d of departments.filter((x) => !ACTIVE_DEPARTMENTS.includes(x.key))) {
      assert.equal(d.status, "planned", d.key);
      assert.equal(d.milestoneValidated, false, d.key);
    }
    const created = eventsOf(hub, "department.created");
    assert.equal(created.length, 12);
    assert.ok(created.every((e) => e.companyId === company.id && e.departmentId === e.scopeId && e.schemaVersion === 2));
    assert.equal(eventsOf(hub, "company.created").length, 1);

    await rejectsWith(cmd(hub, "company.department_status", { departmentKey: "sales", status: "archived", reason: "Nu mai vindem" }), "validation", /status/);
    await rejectsWith(cmd(hub, "company.department_status", { departmentKey: "sales", status: "paused", reason: "" }), "validation", /reason/);
    await rejectsWith(cmd(hub, "company.department_status", { departmentKey: "astrology", status: "paused", reason: "Test de validare" }), "not_found");
    const { result: paused } = await cmd(hub, "company.department_status", { departmentKey: "sales", status: "paused", reason: "Pauză de sezon" });
    assert.equal(paused.status, "paused");
    assert.deepEqual(eventsOf(hub, "department.status", paused.id)[0].payload, { from: "active", to: "paused", reason: "Pauză de sezon" });

    hub.company.seed();
    hub.company.seed();
    assert.equal(count(hub, "companies"), 1);
    assert.equal(count(hub, "departments"), 12);
    assert.equal(count(hub, "manager_relationships"), hub.roleConfig.roles.filter((r) => r.reportsTo).length);
    assert.equal(hub.company.department("sales").status, "paused", "re-seeding keeps the owner's department status");
    assert.equal(eventsOf(hub, "department.created").length, 12);
    assert.equal(eventsOf(hub, "company.created").length, 1);
  } finally { await t.cleanup(); }
});

test("M01-C02 org chart: chief of staff reports to the owner, engineering roles report to the architect, every role has a department", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    const org = hub.company.orgChart();
    const roleIds = new Set(hub.roleConfig.roles.map((r) => r.id));
    const byId = Object.fromEntries(org.roles.map((r) => [r.id, r]));
    assert.equal(org.owner, COMPANY_SEED.owner);
    assert.equal(org.roles.length, roleIds.size);
    assert.equal(roleIds.size, 18);

    assert.equal(byId["chief-of-staff"].reportsTo, "owner");
    assert.equal(byId["chief-of-staff"].department, "executive");
    assert.deepEqual(org.roles.filter((r) => r.reportsTo === "owner").map((r) => r.id), ["chief-of-staff"], "only the chief of staff reports to the owner");
    assert.equal(byId.architect.department, "engineering");
    assert.equal(byId.architect.reportsTo, "chief-of-staff");
    const engineering = org.roles.filter((r) => r.department === "engineering" && r.id !== "architect");
    assert.ok(engineering.length >= 5);
    for (const role of engineering) assert.equal(role.reportsTo, "architect", role.id);

    const departmentKeys = new Set(hub.company.departments().map((d) => d.key));
    for (const role of org.roles) {
      assert.ok(role.department && departmentKeys.has(role.department), `${role.id} belongs to a known department`);
      assert.ok(role.reportsTo === "owner" || roleIds.has(role.reportsTo), `${role.id} reports to a known role`);
      const seen = new Set();
      for (let current = role.id; current !== "owner"; current = byId[current].reportsTo) {
        assert.ok(!seen.has(current), `reporting chain of ${role.id} has no cycle`);
        seen.add(current);
      }
    }
    assert.equal(org.edges.length, roleIds.size);
    for (const edge of org.edges) assert.equal(byId[edge.report].reportsTo, edge.manager);

    const persisted = hub.db.prepare("SELECT r.id, d.key FROM agent_roles r LEFT JOIN departments d ON d.id = r.department_id").all();
    assert.equal(persisted.length, roleIds.size);
    for (const row of persisted) assert.equal(row.key, byId[row.id].department, `agent_roles.department_id of ${row.id}`);
    for (const d of hub.company.departments().filter((x) => x.headRoleId)) assert.equal(byId[d.headRoleId]?.department, d.key, `head of ${d.key} belongs to it`);
    assert.equal(hub.company.department("executive").headRoleId, "chief-of-staff");
    assert.equal(hub.company.department("engineering").headRoleId, "architect");
  } finally { await t.cleanup(); }
});

test("M01-C03 AgentRole is not AgentRun: roles exist with zero runs, no provider process and no model turn", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    assert.equal(count(hub, "agent_roles"), hub.roleConfig.roles.length);
    assert.equal(count(hub, "agent_runs"), 0);
    const overview = hub.company.overview();
    assert.ok(overview.departments.every((d) => d.counts.activeRuns === 0));
    assert.deepEqual(overview.departments.flatMap((d) => d.roles.map((r) => r.id)).sort(), hub.roleConfig.roles.map((r) => r.id).sort(), "every role is listed under exactly one department");
    assert.match(overview.orgChart.note, /AgentRun/);
    assert.equal(hub.settings.get("mode"), "BUILD_SAFE");
    assert.notEqual(hub.settings.get("executionGate").status, "open");
    assert.equal(hub.runs.activeCount(), 0);
    assert.deepEqual(hub.runs.listRuns({ limit: 50 }), []);
    assert.deepEqual(hub.supervisor.list(), []);
    const modelTurns = [...t.readLog("claude").filter((e) => e.args?.includes("-p")), ...t.readLog("codex").filter((e) => /^(turn|thread)\//.test(e.method || ""))];
    assert.deepEqual(modelTurns, []);
  } finally { await t.cleanup(); }
});

test("M01-C04 goals: DRAFT on create, DRAFT->ACTIVE allowed, illegal transitions rejected, ACHIEVED needs evidence, optimistic version", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    const transition = (goalId, to, extra = {}) => cmd(hub, "goal.transition", { goalId, to, reason: `Motiv pentru ${to}`, ...extra });
    const { result: goal } = await cmd(hub, "goal.create", { title: "Lansăm oferta de audit pentru clinici", departmentKey: "sales", priority: 1, successMetrics: ["10 audituri livrate"] });
    assert.equal(goal.status, "DRAFT");
    assert.equal(goal.version, 1);
    assert.equal(goal.priority, 1);
    assert.equal(goal.departmentId, hub.company.department("sales").id);
    assert.equal(goal.ownerRoleId, "sales-assistant");
    assert.deepEqual(goal.successMetrics, ["10 audituri livrate"]);
    await rejectsWith(cmd(hub, "goal.create", { title: "Obiectiv cu departament greșit", departmentKey: "astrology" }), "not_found", /Department/);
    await rejectsWith(cmd(hub, "goal.create", { title: "Termen invalid", dueAt: "mâine" }), "validation", /dueAt/);

    await rejectsWith(transition(goal.id, "ACHIEVED"), "task", /DRAFT -> ACHIEVED is not allowed/);
    await rejectsWith(transition(goal.id, "AT_RISK"), "task", /DRAFT -> AT_RISK is not allowed/);
    await rejectsWith(transition(goal.id, "DONE"), "validation", /to must be one of/);
    await rejectsWith(cmd(hub, "goal.transition", { goalId: goal.id, to: "ACTIVE", reason: "" }), "validation", /reason/);
    await rejectsWith(transition("goal_missing", "ACTIVE"), "not_found");
    assert.equal(hub.company.goal(goal.id).status, "DRAFT");
    assert.equal(hub.company.goal(goal.id).version, 1);
    assert.equal(hub.commands.list({ type: "goal.transition", status: "failed" }).length, 3, "rejected transitions are logged as failed commands");

    const { result: active } = await transition(goal.id, "ACTIVE", { expectedVersion: 1 });
    assert.equal(active.status, "ACTIVE");
    assert.equal(active.version, 2);
    const { result: same } = await transition(goal.id, "ACTIVE");
    assert.equal(same.version, 2, "a same-state transition is a no-op");

    await rejectsWith(transition(goal.id, "AT_RISK", { expectedVersion: 1 }), "conflict", /reload/);
    assert.equal(hub.company.goal(goal.id).status, "ACTIVE");
    const { result: atRisk } = await transition(goal.id, "AT_RISK", { expectedVersion: 2 });
    assert.equal(atRisk.status, "AT_RISK");
    assert.equal(atRisk.version, 3);

    const { result: audits } = await cmd(hub, "objective.create", { goalId: goal.id, title: "Audituri livrate", targetValue: 10, unit: "audituri" });
    const { result: page } = await cmd(hub, "objective.create", { goalId: goal.id, title: "Pagina de ofertă publicată" });
    await rejectsWith(transition(goal.id, "ACHIEVED"), "task", /MET/);
    await rejectsWith(transition(goal.id, "ACHIEVED", { evidence: { manualVerification: "   ok    " } }), "task", /MET/);
    await cmd(hub, "objective.update", { objectiveId: audits.id, currentValue: 10, status: "MET" });
    await rejectsWith(transition(goal.id, "ACHIEVED"), "task", /MET/);
    await cmd(hub, "objective.update", { objectiveId: page.id, status: "DROPPED", reason: "Oferta se trimite direct clientului" });
    const { result: achieved } = await transition(goal.id, "ACHIEVED");
    assert.equal(achieved.status, "ACHIEVED");
    assert.equal(achieved.version, 4);
    await rejectsWith(transition(goal.id, "ACTIVE"), "task", /ACHIEVED -> ACTIVE is not allowed/);
    await rejectsWith(cmd(hub, "objective.create", { goalId: goal.id, title: "Încă un rezultat" }), "task", /ACHIEVED/);
    const history = hub.bus.query({ typePrefix: "goal.", limit: 200 }).filter((e) => e.scopeId === goal.id).map((e) => e.type).reverse();
    assert.deepEqual(history, ["goal.created", "goal.active", "goal.at_risk", "goal.achieved"]);

    const { result: delivery } = await cmd(hub, "goal.create", { title: "Site nou livrat clientului", departmentKey: "engineering" });
    await transition(delivery.id, "ACTIVE");
    await rejectsWith(transition(delivery.id, "ACHIEVED"), "task", /MET/);
    const evidence = { manualVerification: "Clientul a confirmat livrarea în scris" };
    const { result: delivered } = await transition(delivery.id, "ACHIEVED", { evidence });
    assert.equal(delivered.status, "ACHIEVED");
    assert.deepEqual(eventsOf(hub, "goal.achieved", delivery.id)[0].payload.evidence, evidence);

    const { result: dropped } = await cmd(hub, "goal.create", { title: "Aplicație mobilă proprie" });
    const { result: abandoned } = await transition(dropped.id, "ABANDONED");
    assert.equal(abandoned.status, "ABANDONED");
    await rejectsWith(transition(dropped.id, "ACTIVE"), "task", /ABANDONED -> ACTIVE is not allowed/);
  } finally { await t.cleanup(); }
});

test("M01-C05 objectives: create and measured updates; MET below target needs a reason; illegal transitions rejected", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    const { result: goal } = await cmd(hub, "goal.create", { title: "Stabilitate pentru API-ul de facturare", departmentKey: "engineering" });
    const { result: incidents } = await cmd(hub, "objective.create", { goalId: goal.id, title: "Incidente închise cu test de regresie", keyResult: "Incidente închise", targetValue: 5, unit: "incidente" });
    assert.equal(incidents.status, "OPEN");
    assert.equal(incidents.goalId, goal.id);
    assert.equal(incidents.departmentId, goal.departmentId);
    assert.equal(incidents.targetValue, 5);
    assert.equal(incidents.currentValue, null);
    assert.equal(incidents.unit, "incidente");
    assert.equal(incidents.keyResult, "Incidente închise");
    const { result: report } = await cmd(hub, "objective.create", { goalId: goal.id, title: "Raport săptămânal de stabilitate", departmentKey: "operations", targetValue: 4 });
    assert.equal(report.departmentId, hub.company.department("operations").id);
    await rejectsWith(cmd(hub, "objective.create", { goalId: "goal_missing", title: "Rezultat orfan" }), "not_found", /Goal/);
    await rejectsWith(cmd(hub, "objective.create", { goalId: goal.id, title: "Țintă textuală", targetValue: "cinci" }), "validation", /targetValue/);

    const { result: progress } = await cmd(hub, "objective.update", { objectiveId: incidents.id, currentValue: 2, status: "IN_PROGRESS" });
    assert.equal(progress.status, "IN_PROGRESS");
    assert.equal(progress.currentValue, 2);
    assert.equal(progress.version, 2);

    await rejectsWith(cmd(hub, "objective.update", { objectiveId: incidents.id, status: "MET" }), "task", /justificare/);
    await rejectsWith(cmd(hub, "objective.update", { objectiveId: incidents.id, status: "MET", reason: "scurt" }), "task", /justificare/);
    await rejectsWith(cmd(hub, "objective.update", { objectiveId: incidents.id, currentValue: 4, status: "MET" }), "task", /justificare/);
    const unchanged = hub.company.objective(incidents.id);
    assert.equal(unchanged.status, "IN_PROGRESS");
    assert.equal(unchanged.currentValue, 2);
    const reason = "Restul incidentelor au fost reclasificate ca cereri noi";
    const { result: met } = await cmd(hub, "objective.update", { objectiveId: incidents.id, currentValue: 4, status: "MET", reason });
    assert.equal(met.status, "MET");
    assert.equal(met.currentValue, 4);
    assert.equal(met.statusReason, reason);
    await rejectsWith(cmd(hub, "objective.update", { objectiveId: incidents.id, status: "OPEN", reason: "Redeschidem" }), "task", /MET -> OPEN is not allowed/);

    await rejectsWith(cmd(hub, "objective.update", { objectiveId: report.id, status: "MISSED", reason: "Nu a fost trimis" }), "task", /OPEN -> MISSED is not allowed/);
    await rejectsWith(cmd(hub, "objective.update", { objectiveId: report.id, currentValue: "patru" }), "validation", /currentValue/);
    await rejectsWith(cmd(hub, "objective.update", { objectiveId: "obj_missing", currentValue: 1 }), "not_found");
    const { result: onTarget } = await cmd(hub, "objective.update", { objectiveId: report.id, currentValue: 4, status: "MET" });
    assert.equal(onTarget.status, "MET", "at target no justification is needed");

    assert.equal(eventsOf(hub, "objective.created", goal.id).length, 2);
    assert.equal(eventsOf(hub, "objective.updated", goal.id).length, 3, "rejected updates leave no event");
  } finally { await t.cleanup(); }
});

test("M01-C06 Chief of Staff intake routes Romanian objectives with diacritics; it only proposes (goal DRAFT + objectives, no missions)", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    const dept = (key) => hub.company.department(key);
    const before = { missions: count(hub, "missions"), tasks: count(hub, "tasks"), conversations: count(hub, "conversations"), goals: count(hub, "goals"), objectives: count(hub, "objectives") };
    const cases = [
      ["Rezolvă urgent un bug în API", "engineering", "incident"],
      ["Fă un audit site pentru clinica dentară Zâmbet", "sales", "site_audit"],
      ["Auditează site-ul unei firme de construcții", "sales", "site_audit"],
      ["Pregătește un raport zilnic pentru mâine", "operations", "briefing"],
      ["Verifică backup-urile și sănătatea sistemului", "operations", "operations_routine"],
      ["Programează mentenanţa lunară", "operations", "operations_routine"],
      ["Vreau să îmbunătățim ceva", "executive", "executive_review"],
    ];
    let goals = 0;
    let objectives = 0;
    for (const [text, key, kind] of cases) {
      const { command, result } = await cmd(hub, "cos.intake", { objective: text });
      goals += 1;
      objectives += result.objectives.length;
      assert.equal(command.status, "executed", text);
      assert.deepEqual(result.proposal.missions.map((m) => `${m.departmentKey}/${m.missionKind}`), [`${key}/${kind}`], text);
      const [proposal] = result.proposal.missions;
      assert.equal(proposal.warning, null, text);
      assert.equal(proposal.departmentStatus, "active", text);
      assert.equal(proposal.ownerRoleId, dept(key).headRoleId, text);
      assert.equal(proposal.taskCount, MISSION_TEMPLATES[kind].tasks.length, text);
      assert.equal(result.goal.status, "DRAFT", text);
      assert.equal(result.goal.source, "chief-of-staff", text);
      assert.equal(result.goal.ownerRoleId, "chief-of-staff", text);
      assert.equal(result.goal.departmentId, dept(key).id, text);
      assert.equal(result.goal.description, text);
      assert.deepEqual(result.objectives.map((o) => [o.goalId, o.departmentId, o.status, o.targetValue]), [[result.goal.id, dept(key).id, "OPEN", 1]], text);
    }

    const multi = await cmd(hub, "cos.intake", { objective: "Rezolvă un bug în API, fă un audit site pentru un salon din Iași și trimite-mi un raport zilnic", priority: 1, dueAt: "2026-10-15" });
    goals += 1;
    objectives += multi.result.objectives.length;
    assert.deepEqual(multi.result.proposal.missions.map((m) => `${m.departmentKey}/${m.missionKind}`).sort(), ["engineering/incident", "operations/briefing", "sales/site_audit"]);
    assert.equal(multi.result.goal.departmentId, dept("executive").id, "a cross-department goal belongs to Executive");
    assert.equal(multi.result.goal.priority, 1);
    assert.equal(multi.result.goal.dueAt, "2026-10-15");
    assert.deepEqual(multi.result.objectives.map((o) => o.departmentId).sort(), ["engineering", "operations", "sales"].map((k) => dept(k).id).sort());
    const correlated = hub.bus.query({ correlationId: multi.command.correlationId, limit: 100 }).map((e) => e.type);
    assert.equal(correlated.filter((type) => type === "goal.created").length, 1);
    assert.equal(correlated.filter((type) => type === "objective.created").length, 3);

    const research = await cmd(hub, "cos.intake", { objective: "Cercetare de piață despre concurența din Cluj" });
    goals += 1;
    objectives += research.result.objectives.length;
    const [researchProposal] = research.result.proposal.missions;
    assert.equal(researchProposal.departmentKey, "research");
    assert.equal(researchProposal.departmentStatus, "planned");
    assert.equal(researchProposal.missionKind, "research");
    assert.match(researchProposal.warning, /planned/);
    assert.match(researchProposal.warning, /sales$/, "the warning names the nearest active department");
    assert.equal(research.result.goal.status, "DRAFT");

    const hinted = await cmd(hub, "cos.intake", { objective: "Pregătește un raport zilnic pentru mâine", departmentKey: "marketing" });
    goals += 1;
    objectives += hinted.result.objectives.length;
    const byKey = Object.fromEntries(hinted.result.proposal.missions.map((m) => [m.departmentKey, m]));
    assert.deepEqual(Object.keys(byKey).sort(), ["marketing", "operations"]);
    assert.equal(byKey.operations.warning, null);
    assert.match(byKey.marketing.warning, /planned/);
    assert.equal(hinted.result.goal.departmentId, dept("executive").id);

    await cmd(hub, "company.department_status", { departmentKey: "sales", status: "paused", reason: "Pauză de sezon" });
    const paused = await cmd(hub, "cos.intake", { objective: "Fă un audit site pentru clinica dentară Zâmbet" });
    goals += 1;
    objectives += paused.result.objectives.length;
    assert.match(paused.result.proposal.missions[0].warning, /paused/, "a paused department also gets a warning");

    assert.equal(count(hub, "missions"), before.missions, "intake never creates missions");
    assert.equal(count(hub, "tasks"), before.tasks);
    assert.equal(count(hub, "conversations"), before.conversations);
    assert.equal(count(hub, "agent_runs"), 0);
    assert.equal(count(hub, "goals"), before.goals + goals);
    assert.equal(count(hub, "objectives"), before.objectives + objectives);
    assert.ok(hub.chiefOfStaff.escalations().draftPlans.some((g) => g.id === multi.result.goal.id), "draft plans wait for the owner");

    await rejectsWith(cmd(hub, "cos.intake", { objective: "Rezolvă urgent un bug în API" }, "voice"), "policy", /voice/);
    await rejectsWith(cmd(hub, "cos.intake", { objective: "bug" }), "validation", /objective/);
    const goalsNow = count(hub, "goals");
    await rejectsWith(cmd(hub, "cos.intake", { objective: "Pregătește un raport zilnic", dueAt: "mâine" }), "validation", /dueAt/);
    assert.equal(count(hub, "goals"), goalsNow, "a failed intake leaves no partial goal");
  } finally { await t.cleanup(); }
});

test("M01-C07 Chief of Staff keywords match words, not fragments of Romanian words (-ului, bugetul, rapid)", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    const cases = [
      ["Fă un audit site al magazinului online", ["sales"]],
      ["Stabilește bugetul campaniei de toamnă", ["finance-admin", "marketing"]],
      ["Pregătește un raport zilnic cât mai rapid", ["operations"]],
    ];
    const problems = [];
    for (const [text, expected] of cases) {
      const { result } = await cmd(hub, "cos.intake", { objective: text });
      const routed = result.proposal.missions.map((m) => m.departmentKey).sort();
      if (JSON.stringify(routed) !== JSON.stringify(expected)) {
        const matched = result.proposal.missions.map((m) => `${m.departmentKey}[${m.matchedKeywords.join("|")}]`).join(", ");
        problems.push(`"${text}" -> ${matched}; expected only ${expected.join(", ")}`);
      }
    }
    assert.deepEqual(problems, []);
  } finally { await t.cleanup(); }
});

test("M01-C08 cos.apply_plan creates DRAFT missions linked to department, goal and objective; tasks carry department and task type", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    const company = hub.company.company();
    const project = hub.projects.hub();
    const toPlan = (proposals) => proposals.map((m) => ({ departmentKey: m.departmentKey, missionKind: m.missionKind, title: m.title, projectId: m.projectId }));
    const { result: intake } = await cmd(hub, "cos.intake", { objective: "Rezolvă un bug în API, fă un audit site pentru un salon din Iași și trimite-mi un raport zilnic" });
    const { result: researchIntake } = await cmd(hub, "cos.intake", { objective: "Cercetare de piață despre concurența din Cluj" });
    assert.equal(count(hub, "missions"), 0);

    const applied = await cmd(hub, "cos.apply_plan", { goalId: intake.goal.id, missions: toPlan(intake.proposal.missions) });
    const appliedResearch = await cmd(hub, "cos.apply_plan", { goalId: researchIntake.goal.id, missions: toPlan(researchIntake.proposal.missions) });
    assert.equal(applied.result.goalId, intake.goal.id);
    assert.deepEqual(applied.result.missions.map((m) => m.kind).sort(), ["briefing", "incident", "site_audit"]);
    assert.deepEqual(appliedResearch.result.missions.map((m) => m.kind), ["research"]);

    const checks = [
      ...applied.result.missions.map((mission) => ({ mission, intake })),
      ...appliedResearch.result.missions.map((mission) => ({ mission, intake: researchIntake })),
    ];
    for (const { mission, intake: source } of checks) {
      const proposal = source.proposal.missions.find((p) => p.missionKind === mission.kind);
      const dept = hub.company.department(proposal.departmentKey);
      const objective = source.objectives.find((o) => o.departmentId === dept.id);
      assert.ok(objective, `${mission.kind} has an objective in ${dept.key}`);
      assert.equal(mission.status, "DRAFT", mission.kind);
      assert.equal(mission.companyId, company.id, mission.kind);
      assert.equal(mission.departmentId, dept.id, mission.kind);
      assert.equal(mission.goalId, source.goal.id, mission.kind);
      assert.equal(mission.objectiveId, objective.id, mission.kind);
      assert.equal(mission.projectId, project.id, mission.kind);
      assert.equal(mission.title, proposal.title);
      assert.equal(hub.conversations.get(mission.conversationId).activeMissionId, mission.id);
      const tasks = hub.missions.tasks(mission.id);
      const template = MISSION_TEMPLATES[mission.kind].tasks;
      assert.equal(tasks.length, template.length, mission.kind);
      for (const spec of template) {
        const task = taskByTitle(tasks, spec.title);
        assert.equal(task.status, "DRAFT", `${mission.kind}/${spec.key}`);
        assert.equal(task.departmentId, dept.id, `${mission.kind}/${spec.key} carries the department`);
        assert.equal(task.roleId, spec.role);
        assert.equal(task.taskType, spec.taskType || TASK_TYPE_BY_ROLE[spec.role], `${mission.kind}/${spec.key} task type`);
        assert.ok(task.taskType, `${mission.kind}/${spec.key} has a task type`);
      }
    }
    const incident = applied.result.missions.find((m) => m.kind === "incident");
    assert.deepEqual(MISSION_TEMPLATES.incident.tasks.map((spec) => taskByTitle(hub.missions.tasks(incident.id), spec.title).taskType), ["testing_qa", "coding", "code_review", "documents"]);
    const research = appliedResearch.result.missions[0];
    assert.equal(research.departmentId, hub.company.department("research").id, "a planned department keeps its DRAFT mission");
    assert.deepEqual(MISSION_TEMPLATES.research.tasks.map((spec) => taskByTitle(hub.missions.tasks(research.id), spec.title).taskType), ["research", "research", "code_review"]);

    const linked = hub.bus.query({ correlationId: applied.command.correlationId, limit: 500 }).filter((e) => e.type === "mission.linked");
    assert.equal(linked.length, 3);
    for (const event of linked) {
      assert.equal(event.companyId, company.id);
      assert.equal(event.departmentId, applied.result.missions.find((m) => m.id === event.missionId).departmentId);
      assert.equal(event.payload.goalId, intake.goal.id);
    }
    const aggregate = hub.chiefOfStaff.aggregate(intake.goal.id);
    assert.equal(aggregate.missions.length, 3);
    assert.ok(aggregate.missions.every((m) => m.progress.completed === 0 && m.verified.length === 0));
    assert.equal(hub.company.goal(intake.goal.id).status, "DRAFT", "applying a plan does not activate the goal");
    assert.ok(hub.missions.allTasks().every((task) => task.status === "DRAFT"));
    assert.equal(count(hub, "agent_runs"), 0, "missions and roles never imply a running model");

    const missionsBefore = count(hub, "missions");
    const tasksBefore = count(hub, "tasks");
    await rejectsWith(cmd(hub, "cos.apply_plan", { goalId: intake.goal.id, missions: [{ departmentKey: "sales", missionKind: "leads" }, { departmentKey: "sales", missionKind: "teleport" }] }), "validation", /teleport/);
    await rejectsWith(cmd(hub, "cos.apply_plan", { goalId: intake.goal.id, missions: [{ departmentKey: "astrology", missionKind: "leads" }] }), "not_found", /Department/);
    await rejectsWith(cmd(hub, "cos.apply_plan", { goalId: "goal_missing", missions: [] }), "not_found", /Goal/);
    assert.equal(count(hub, "missions"), missionsBefore, "a rejected plan creates nothing (one transaction)");
    assert.equal(count(hub, "tasks"), tasksBefore);
  } finally { await t.cleanup(); }
});

test("M01-C09 mission.link validates mission, department, goal and objective ownership", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    const project = hub.projects.hub();
    const sales = hub.company.department("sales");
    const { result: mission } = await cmd(hub, "mission.create", { projectId: project.id, kind: "outreach", title: "Ofertă pentru clinica Zâmbet", objective: "Ciornă de ofertă contextuală, netrimisă" });
    assert.equal(mission.departmentId, sales.id, "mission.create links the template's department");
    assert.equal(mission.goalId, null);
    const { result: goalA } = await cmd(hub, "goal.create", { title: "Clienți noi în domeniul medical", departmentKey: "sales" });
    const { result: goalB } = await cmd(hub, "goal.create", { title: "Operațiuni fără incidente", departmentKey: "operations" });
    const { result: objA } = await cmd(hub, "objective.create", { goalId: goalA.id, title: "Oferte pregătite", targetValue: 3 });
    const { result: objB } = await cmd(hub, "objective.create", { goalId: goalB.id, title: "Backup verificat zilnic", targetValue: 30 });
    const link = (payload) => cmd(hub, "mission.link", { missionId: mission.id, ...payload });

    await rejectsWith(cmd(hub, "mission.link", { missionId: "mis_missing", goalId: goalA.id }), "not_found", /Mission/);
    await rejectsWith(link({ departmentKey: "astrology" }), "not_found", /Department/);
    await rejectsWith(link({ goalId: "goal_missing" }), "not_found", /Goal/);
    await rejectsWith(link({ goalId: goalA.id, objectiveId: objB.id }), "validation", /does not belong/);
    await rejectsWith(link({ objectiveId: objA.id }), "validation", /does not belong/);
    const untouched = hub.missions.get(mission.id);
    assert.equal(untouched.goalId, null);
    assert.equal(untouched.objectiveId, null);
    assert.equal(untouched.version, mission.version, "rejected links change nothing");

    const { result: linked } = await link({ departmentKey: "sales", goalId: goalA.id, objectiveId: objA.id });
    assert.equal(linked.departmentId, sales.id);
    assert.equal(linked.goalId, goalA.id);
    assert.equal(linked.objectiveId, objA.id);
    assert.equal(linked.companyId, hub.company.company().id);
    const event = eventsOf(hub, "mission.linked", mission.id)[0];
    assert.deepEqual(event.payload, { departmentKey: "sales", goalId: goalA.id, objectiveId: objA.id });
    assert.equal(event.departmentId, sales.id);

    const { result: kept } = await link({ goalId: goalA.id });
    assert.equal(kept.objectiveId, objA.id, "omitted fields keep their current links");
    assert.equal(kept.departmentId, sales.id);
    const overviewGoal = hub.company.overview().goals.find((g) => g.id === goalA.id);
    assert.deepEqual(overviewGoal.missions.map((m) => m.id), [mission.id]);
    assert.ok(hub.missions.tasks(mission.id).every((task) => task.departmentId === sales.id));
  } finally { await t.cleanup(); }
});

test("M01-C10 re-linking a mission to another goal never keeps an objective of the previous goal", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    const project = hub.projects.hub();
    const { result: mission } = await cmd(hub, "mission.create", { projectId: project.id, kind: "outreach", title: "Ofertă pentru salonul din Iași", objective: "Ciornă de ofertă contextuală, netrimisă" });
    const { result: goalA } = await cmd(hub, "goal.create", { title: "Clienți noi în domeniul medical", departmentKey: "sales" });
    const { result: goalB } = await cmd(hub, "goal.create", { title: "Clienți noi în domeniul beauty", departmentKey: "sales" });
    const { result: objA } = await cmd(hub, "objective.create", { goalId: goalA.id, title: "Oferte pregătite", targetValue: 3 });
    await cmd(hub, "mission.link", { missionId: mission.id, goalId: goalA.id, objectiveId: objA.id });

    const outcome = await cmd(hub, "mission.link", { missionId: mission.id, goalId: goalB.id }).then(() => "linked", (error) => `rejected (${error.category})`);
    const after = hub.missions.get(mission.id);
    const objectiveGoal = after.objectiveId ? hub.company.objective(after.objectiveId).goalId : null;
    assert.ok(after.objectiveId === null || objectiveGoal === after.goalId,
      `after re-linking (${outcome}) the mission has goal ${after.goalId} but objective ${after.objectiveId}, which belongs to goal ${objectiveGoal}`);
  } finally { await t.cleanup(); }
});

test("M01-C11 task dependencies: table populated from templates; addDependency rejects self-references and cycles", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    const project = hub.projects.hub();
    const depsOfMission = (missionId) => hub.db.prepare(`SELECT d.task_id AS taskId, d.depends_on_task_id AS dependsOn, d.kind FROM task_dependencies d
      JOIN tasks t ON t.id = d.task_id WHERE t.mission_id = ?`).all(missionId);

    for (const [kind, template] of Object.entries(MISSION_TEMPLATES)) {
      const mission = hub.bus.transaction(() => hub.missions.create({ projectId: project.id, kind, title: `Șablon ${kind}`, objective: "Verificarea dependențelor din șablon" }));
      const tasks = hub.missions.tasks(mission.id);
      const idOf = Object.fromEntries(template.tasks.map((spec) => [spec.key, taskByTitle(tasks, spec.title).id]));
      const expected = template.tasks.flatMap((spec) => (spec.after || []).map((key) => `${idOf[spec.key]}>${idOf[key]}`)).sort();
      const rows = depsOfMission(mission.id);
      assert.deepEqual(rows.map((r) => `${r.taskId}>${r.dependsOn}`).sort(), expected, `${kind}: task_dependencies mirrors the template`);
      assert.ok(rows.every((r) => r.kind === "finish_to_start"), kind);
      for (const task of tasks) assert.deepEqual([...task.dependsOn].sort(), hub.missions.dependencyIds(task.id).sort(), `${kind}/${task.title}: JSON copy matches the table`);
    }

    const { result: incident } = await cmd(hub, "mission.create", { projectId: project.id, kind: "incident", title: "Eroare la exportul CSV", objective: "Exportul CSV nu merge după ultima actualizare" });
    const tasks = hub.missions.tasks(incident.id);
    const [reproduce, fix, review, report] = MISSION_TEMPLATES.incident.tasks.map((spec) => taskByTitle(tasks, spec.title));
    assert.deepEqual(hub.missions.dependencyIds(fix.id), [reproduce.id]);
    assert.deepEqual(hub.missions.dependencyIds(reproduce.id), []);
    const incidentDeps = depsOfMission(incident.id).length;
    assert.equal(incidentDeps, 3);

    await rejectsWith(cmd(hub, "task.add_dependency", { taskId: fix.id, dependsOn: fix.id }), "validation", /itself/);
    await rejectsWith(cmd(hub, "task.add_dependency", { taskId: reproduce.id, dependsOn: fix.id }), "validation", /cycle/);
    await rejectsWith(cmd(hub, "task.add_dependency", { taskId: reproduce.id, dependsOn: report.id }), "validation", /cycle/);
    await rejectsWith(cmd(hub, "task.add_dependency", { taskId: fix.id, dependsOn: "task_missing" }), "not_found");
    assert.equal(depsOfMission(incident.id).length, incidentDeps, "rejected dependencies are not written");
    assert.deepEqual(hub.missions.task(reproduce.id).dependsOn, []);

    const { result: redundant } = await cmd(hub, "task.add_dependency", { taskId: report.id, dependsOn: fix.id });
    assert.deepEqual([...redundant.dependsOn].sort(), [review.id, fix.id].sort(), "a transitive (acyclic) dependency is accepted");

    const briefing = hub.bus.transaction(() => hub.missions.create({ projectId: project.id, kind: "briefing", title: "Raport zilnic", objective: "Rezumatul zilei pentru owner" }));
    const [brief] = hub.missions.tasks(briefing.id);
    const { result: crossMission } = await cmd(hub, "task.add_dependency", { taskId: brief.id, dependsOn: report.id });
    assert.deepEqual(crossMission.dependsOn, [report.id]);
    assert.deepEqual(hub.missions.dependencyIds(brief.id), [report.id]);
    assert.equal(eventsOf(hub, "task.dependency_added", brief.id).length, 1);
    await rejectsWith(cmd(hub, "task.add_dependency", { taskId: reproduce.id, dependsOn: brief.id }), "validation", /cycle/);
    await rejectsWith(cmd(hub, "task.command", { taskId: brief.id, action: "queue" }), "task", /Dependencies/);

    assert.throws(() => hub.db.prepare("INSERT INTO task_dependencies (task_id, depends_on_task_id, created_at) VALUES (?, ?, ?)").run(fix.id, fix.id, new Date().toISOString()), /CHECK constraint/);
  } finally { await t.cleanup(); }
});

test("M01-C12 describeLifecycles covers every stateful entity and assertTransition enforces each machine", () => {
  const described = describeLifecycles();
  assert.deepEqual(described.map((d) => d.id).sort(), LIFECYCLE_IDS);
  for (const { id, states, terminal, transitions } of described) {
    assert.equal(new Set(states).size, states.length, `${id}: states are unique`);
    assert.deepEqual(Object.keys(transitions).sort(), [...states].sort(), `${id}: every state has an edge list`);
    assert.ok(terminal.length >= 1, `${id}: has a terminal state`);
    for (const state of terminal) {
      assert.ok(states.includes(state), `${id}: terminal ${state} is a state`);
      assert.deepEqual(transitions[state], [], `${id}: terminal ${state} has no exits`);
      assert.equal(isTerminal(id, state), true);
    }
    for (const [from, targets] of Object.entries(transitions)) {
      for (const to of targets) assert.ok(states.includes(to), `${id}: ${from} -> ${to} targets a known state`);
      if (!terminal.includes(from)) {
        assert.equal(isTerminal(id, from), false);
        assert.ok(targets.some((to) => to !== from), `${id}: non-terminal ${from} has an exit`);
      }
    }
    for (const from of states) {
      for (const to of states) {
        const allowed = transitions[from].includes(to);
        const label = `${id}: ${from} -> ${to}`;
        assert.equal(canTransition(id, from, to), allowed, label);
        if (allowed) {
          assert.equal(assertTransition(id, from, to, "motiv valid"), true, label);
          assert.throws(() => assertTransition(id, from, to, " "), (e) => e instanceof HubError && e.category === "validation" && /reason/.test(e.message), `${label} needs a reason`);
        } else if (from === to) {
          assert.equal(assertTransition(id, from, to, "motiv valid"), false, `${label} is a no-op`);
        } else {
          assert.throws(() => assertTransition(id, from, to, "motiv valid"),
            (e) => e instanceof HubError && e.category === "task" && e.message.includes(`${id}: transition ${from} -> ${to} is not allowed`), label);
        }
      }
    }
    assert.throws(() => assertTransition(id, states[0], "NO_SUCH_STATE", "motiv valid"), (e) => e instanceof HubError && e.category === "validation", `${id}: unknown state`);
  }

  assert.deepEqual(LIFECYCLES.task.states, TASK_STATES);
  for (const from of TASK_STATES) for (const to of TASK_STATES) assert.equal(canTransition("task", from, to), canTaskTransition(from, to), `task: ${from} -> ${to}`);

  const illegal = [
    ["task", "RUNNING", "COMPLETED"], ["task", "COMPLETED", "QUEUED"], ["task", "DRAFT", "RUNNING"],
    ["goal", "DRAFT", "ACHIEVED"], ["goal", "BLOCKED", "ACHIEVED"], ["goal", "ACHIEVED", "ACTIVE"], ["goal", "ABANDONED", "DRAFT"],
    ["objective", "OPEN", "MISSED"], ["objective", "MET", "OPEN"], ["objective", "DROPPED", "IN_PROGRESS"],
    ["mission", "COMPLETED", "ACTIVE"], ["mission", "CANCELLED", "DRAFT"], ["mission", "ATTENTION", "DRAFT"], ["mission", "FAILED", "COMPLETED"],
    ["agentRun", "completed", "running"], ["agentRun", "starting", "completed"], ["agentRun", "waiting_approval", "completed"],
    ["providerSession", "closed", "active"], ["providerSession", "superseded", "idle"], ["providerSession", "lost", "idle"],
    ["handoff", "completed", "in_progress"], ["handoff", "ready", "waiting"], ["handoff", "waiting", "completed"],
    ["approval", "pending", "consumed"], ["approval", "rejected", "approved"], ["approval", "consumed", "approved"], ["approval", "expired", "approved"],
    ["schedule", "DRAFT", "PAUSED"], ["schedule", "RETIRED", "ACTIVE"],
    ["nativeScheduleRef", "PROPOSED", "LINKED"], ["nativeScheduleRef", "PROPOSED", "ACTIVE"], ["nativeScheduleRef", "DETACHED", "LINKED"],
  ];
  for (const [machine, from, to] of illegal) assert.throws(() => assertTransition(machine, from, to, "spot check"), /is not allowed/, `${machine}: ${from} -> ${to}`);
  const legal = [
    ["task", "RUNNING", "VERIFYING"], ["goal", "DRAFT", "ACTIVE"], ["objective", "OPEN", "MET"], ["mission", "FAILED", "ACTIVE"],
    ["agentRun", "running", "waiting_approval"], ["providerSession", "lost", "active"], ["handoff", "in_progress", "in_progress"],
    ["approval", "pending", "approved"], ["schedule", "PAUSED", "ACTIVE"], ["nativeScheduleRef", "PENDING_USER_SETUP", "LINKED"],
  ];
  for (const [machine, from, to] of legal) assert.equal(assertTransition(machine, from, to, "spot check"), true, `${machine}: ${from} -> ${to}`);
  assert.throws(() => assertTransition("spaceship", "A", "B", "spot check"), /Unknown lifecycle/);
});

test("M01-C13 an illegal derived mission status emits mission.status_rejected instead of changing the mission", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    const project = hub.projects.hub();
    const move = (taskId, to, extra = {}) => hub.bus.transaction(() => transitionTask(hub.db, hub.bus, hub.config.now, { taskId, to, reason: `test ${to}`, actor: "test", ...extra }));
    const refresh = (missionId) => hub.bus.transaction(() => hub.missions.refreshMissionStatus(missionId));
    const statusEvents = (missionId) => eventsOf(hub, "mission.status", missionId).length;
    const evidence = { manualVerification: "Raportul a fost verificat manual" };

    const mission = hub.bus.transaction(() => hub.missions.create({ projectId: project.id, kind: "briefing", title: "Raport zilnic", objective: "Rezumatul zilei pentru owner" }));
    const [task] = hub.missions.tasks(mission.id);
    hub.bus.transaction(() => hub.missions.command(task.id, "queue"));
    assert.equal(hub.missions.get(mission.id).status, "ACTIVE");
    move(task.id, "RUNNING");
    move(task.id, "FAILED");
    refresh(mission.id);
    assert.equal(hub.missions.get(mission.id).status, "FAILED");
    assert.equal(eventsOf(hub, "mission.status_rejected", mission.id).length, 0, "legal derived changes are applied");

    for (const to of ["QUEUED", "RUNNING", "VERIFYING"]) move(task.id, to);
    move(task.id, "COMPLETED", { evidence });
    const before = hub.missions.get(mission.id);
    const statusBefore = statusEvents(mission.id);
    refresh(mission.id);
    const after = hub.missions.get(mission.id);
    assert.equal(after.status, "FAILED", "FAILED -> COMPLETED is not a mission edge");
    assert.equal(after.version, before.version);
    assert.equal(after.updatedAt, before.updatedAt);
    assert.equal(statusEvents(mission.id), statusBefore);
    const rejected = eventsOf(hub, "mission.status_rejected", mission.id);
    assert.equal(rejected.length, 1);
    assert.deepEqual(rejected[0].payload, { from: "FAILED", derived: "COMPLETED" });
    assert.equal(rejected[0].missionId, mission.id);
    assert.equal(rejected[0].projectId, project.id);

    const done = hub.bus.transaction(() => hub.missions.create({ projectId: project.id, kind: "briefing", title: "Raport de închidere", objective: "Rezumat final pentru owner" }));
    const [doneTask] = hub.missions.tasks(done.id);
    for (const to of ["QUEUED", "RUNNING", "VERIFYING"]) move(doneTask.id, to);
    move(doneTask.id, "COMPLETED", { evidence });
    refresh(done.id);
    assert.equal(hub.missions.get(done.id).status, "COMPLETED");
    hub.db.prepare("UPDATE tasks SET status = 'QUEUED' WHERE id = ?").run(doneTask.id);
    refresh(done.id);
    assert.equal(hub.missions.get(done.id).status, "COMPLETED", "a completed mission never reopens");
    assert.deepEqual(eventsOf(hub, "mission.status_rejected", done.id).map((e) => e.payload), [{ from: "COMPLETED", derived: "ACTIVE" }]);
  } finally { await t.cleanup(); }
});

test("M01-C14 event diagnostics type filter finds company event types that contain underscores (goal.at_risk, task.dependency_added)", async () => {
  const t = await makeTestHub();
  try {
    const { hub } = t;
    const { result: goal } = await cmd(hub, "goal.create", { title: "Livrări la termen pentru clienți" });
    await cmd(hub, "goal.transition", { goalId: goal.id, to: "ACTIVE", reason: "Pornim obiectivul" });
    await cmd(hub, "goal.transition", { goalId: goal.id, to: "AT_RISK", reason: "Termenul se apropie" });
    const { result: mission } = await cmd(hub, "mission.create", { projectId: hub.projects.hub().id, kind: "outreach", title: "Ofertă pentru clinica Zâmbet", objective: "Ciornă de ofertă contextuală, netrimisă" });
    const review = taskByTitle(hub.missions.tasks(mission.id), MISSION_TEMPLATES.outreach.tasks[1].title);
    const other = hub.bus.transaction(() => hub.missions.create({ projectId: hub.projects.hub().id, kind: "briefing", title: "Raport zilnic", objective: "Rezumatul zilei pentru owner" }));
    const [brief] = hub.missions.tasks(other.id);
    await cmd(hub, "task.add_dependency", { taskId: brief.id, dependsOn: review.id });

    const missing = [];
    for (const [type, scopeId] of [["goal.at_risk", goal.id], ["task.dependency_added", brief.id]]) {
      assert.equal(eventsOf(hub, type, scopeId).length, 1, `${type} is in the event log`);
      const found = hub.bus.query({ typePrefix: type, limit: 100 }).filter((e) => e.scopeId === scopeId);
      if (found.length !== 1) missing.push(`bus.query({ typePrefix: "${type}" }) returned ${found.length} event(s)`);
    }
    assert.deepEqual(missing, []);
  } finally { await t.cleanup(); }
});
