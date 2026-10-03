import { HubError } from "../core/errors.mjs";
import { newId } from "../core/ids.mjs";
import { hashCanonical } from "../core/canonical.mjs";
import { json, parse } from "../storage/db.mjs";
import { redactText } from "../security/redact.mjs";

/**
 * Project Autopilot (M08 §09–§10): the factory goes from one piece of work to a finite OBJECTIVE — a few dependent tasks with
 * criteria, a base snapshot, roles, environment, total limits, allowed/denied effects and stop conditions. "Continue the project"
 * is never an open authorization: the objective is bounded and its plan is validated by the backend (cycles, unknown or orphan
 * dependencies, budgets, scope) whoever proposed it.
 *
 * Execution reuses what exists: every task is an ordinary Software Factory mission (prepared as a DRAFT through factory.prepare),
 * and ONE envelope covers the ordered tasks. The deterministic service then runs the normal transitions: the next task of the
 * approved plan, repairs inside the envelope's limits, technical retries inside the attempt limit. Resuming after the owner's
 * pause, after expiry, after a scope change or beyond a limit stays the owner's decision (the M07 rule: an agent never resumes
 * in the owner's place) — there is no "autopilot resume". A changed objective is a new version and needs a new confirmation.
 */
export const OBJECTIVE_LIMITS = Object.freeze({ maxTasks: 5, maxTotalMinutes: 300, maxAttemptsPerStage: 3, maxRepairCycles: 2, maxTaskMinutes: 120 });
export const OBJECTIVE_STATUSES = Object.freeze(["DRAFT", "PREPARED", "PROPOSED", "RUNNING", "WAITING_OWNER", "DELIVERED", "STOPPED", "SUPERSEDED"]);
export const STOP_CONDITIONS = Object.freeze([
  "o sarcină ajunge la o decizie a ta (NEEDS_OWNER_DECISION) sau e blocată",
  "limita de timp, de încercări pe etapă sau de cicluri de remediere a planului",
  "planul expiră sau îl retragi; Stop / Pauză",
  "scope-ul unei sarcini se schimbă după confirmare",
  "ultima sarcină e gata de verificarea ta (nu accept și nu livrez singur)",
]);
const KEY_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

/** Validates an objective's task graph and budget. Returns { ok, problems, order } (order = topological, dependencies first). */
export function validateObjectivePlan({ title, criteria = [], tasks = [], limits = {} }) {
  const problems = [];
  if (!String(title || "").trim() || String(title).trim().length < 3) problems.push("Obiectivul are nevoie de un titlu");
  if (!Array.isArray(criteria) || !criteria.filter((c) => String(c || "").trim()).length) problems.push("Obiectivul are nevoie de cel puțin un criteriu de reușită");
  if (!Array.isArray(tasks) || !tasks.length) problems.push("Obiectivul are nevoie de cel puțin o sarcină");
  const list = Array.isArray(tasks) ? tasks : [];
  if (list.length > OBJECTIVE_LIMITS.maxTasks) problems.push(`Cel mult ${OBJECTIVE_LIMITS.maxTasks} sarcini într-un obiectiv (un plan acoperă cel mult atâtea misiuni)`);
  const keys = new Set();
  for (const t of list) {
    if (!KEY_RE.test(String(t?.key || ""))) problems.push(`Cheie de sarcină invalidă: „${String(t?.key || "").slice(0, 40)}” (litere mici, cifre, cratimă)`);
    else if (keys.has(t.key)) problems.push(`Cheie duplicată: ${t.key}`);
    keys.add(t?.key);
    if (!String(t?.title || "").trim()) problems.push(`Sarcina ${t?.key || "?"} nu are titlu`);
    if (!["BUGFIX", "FEATURE", "REFACTOR"].includes(String(t?.workType || "").toUpperCase())) problems.push(`Sarcina ${t?.key || "?"}: tip de lucru BUGFIX, FEATURE sau REFACTOR`);
    if (!Array.isArray(t?.acceptance) || !t.acceptance.length) problems.push(`Sarcina ${t?.key || "?"} nu are criterii de acceptanță`);
    if (Number(t?.maxDurationMin || 0) > OBJECTIVE_LIMITS.maxTaskMinutes) problems.push(`Sarcina ${t?.key || "?"} depășește ${OBJECTIVE_LIMITS.maxTaskMinutes} min`);
  }
  for (const t of list) {
    for (const d of Array.isArray(t?.dependsOn) ? t.dependsOn : []) {
      if (d === t.key) problems.push(`Sarcina ${t.key} depinde de ea însăși`);
      else if (!keys.has(d)) problems.push(`Sarcina ${t.key} depinde de o sarcină inexistentă (${d}): dependență orfană`);
    }
  }
  // Kahn's algorithm: a cycle leaves tasks unordered.
  const order = [];
  const deps = new Map(list.map((t) => [t?.key, new Set((t?.dependsOn || []).filter((d) => keys.has(d) && d !== t.key))]));
  const ready = list.filter((t) => !deps.get(t?.key)?.size).map((t) => t.key);
  while (ready.length) {
    const k = ready.shift();
    order.push(k);
    for (const [other, set] of deps) if (set.delete(k) && !set.size && !order.includes(other) && !ready.includes(other)) ready.push(other);
  }
  if (order.length !== list.filter((t) => t?.key).length) problems.push(`Dependențele formează un ciclu (${[...deps.entries()].filter(([, s]) => s.size).map(([k]) => k).join(", ")})`);
  const totalMinutes = list.reduce((sum, t) => sum + Number(t?.maxDurationMin || limits.maxDurationMin || 45), 0);
  if (totalMinutes > OBJECTIVE_LIMITS.maxTotalMinutes) problems.push(`Bugetul total (${totalMinutes} min) depășește ${OBJECTIVE_LIMITS.maxTotalMinutes} min`);
  if (Number(limits.maxAttemptsPerStage || 0) > OBJECTIVE_LIMITS.maxAttemptsPerStage) problems.push(`Cel mult ${OBJECTIVE_LIMITS.maxAttemptsPerStage} încercări pe etapă`);
  if (Number(limits.maxRepairCycles || 0) > OBJECTIVE_LIMITS.maxRepairCycles) problems.push(`Cel mult ${OBJECTIVE_LIMITS.maxRepairCycles} cicluri de remediere pe sarcină`);
  return { ok: problems.length === 0, problems, order, totalMinutes };
}

export function createAutopilot({ db, bus, clock, projects, factory, commands, envelopes }) {
  const iso = (d = clock()) => d.toISOString();
  const rowTo = (r) => r && ({ id: r.id, projectId: r.project_id, title: r.title, status: r.status, plan: parse(r.plan_json, {}), planHash: r.plan_hash, criteria: parse(r.criteria_json, []),
    limits: parse(r.limits_json, {}), baseSnapshot: parse(r.base_snapshot_json, {}), envelopeId: r.envelope_id, createdBy: r.created_by, version: r.version, createdAt: r.created_at, updatedAt: r.updated_at });
  const need = (id) => { const r = rowTo(db.prepare("SELECT * FROM autopilot_objectives WHERE id = ?").get(id)); if (!r) throw new HubError("not_found", "Obiectiv necunoscut"); return r; };

  function cleanTask(t, defaults) {
    const acceptance = (Array.isArray(t.acceptance) ? t.acceptance : []).slice(0, 10).map((a, i) => (typeof a === "string" ? { id: `AC-${i + 1}`, text: a.slice(0, 300), verify: "review" }
      : { ...a, id: String(a.id || `AC-${i + 1}`).slice(0, 12), text: String(a.text || "").slice(0, 300) }));
    return { key: String(t.key || "").trim(), title: redactText(String(t.title || "")).trim().slice(0, 160), workType: String(t.workType || "FEATURE").toUpperCase(),
      objective: redactText(String(t.objective || t.title || "")).slice(0, 2000), acceptance, dependsOn: [...new Set((Array.isArray(t.dependsOn) ? t.dependsOn : []).map(String))].slice(0, 5),
      inScope: (Array.isArray(t.inScope) ? t.inScope : []).map(String).slice(0, 20), outOfScope: (Array.isArray(t.outOfScope) ? t.outOfScope : []).map(String).slice(0, 20),
      verification: t.verification || defaults.verification || null, preview: t.preview || null, maxDurationMin: Math.min(Number(t.maxDurationMin || defaults.maxDurationMin || 45), OBJECTIVE_LIMITS.maxTaskMinutes),
      missionId: null };
  }

  /** A DRAFT objective (nothing is created in the factory yet). Fields a client sends about trust (test project, owner…) are ignored. */
  function draft({ projectId, title, criteria = [], tasks = [], verification = null, limits = {}, actor }) {
    const p = projects.get(projectId);
    if (!p) throw new HubError("not_found", "Proiect necunoscut");
    const defaults = { verification, maxDurationMin: Number(limits.maxDurationMin || 45) };
    const cleaned = (Array.isArray(tasks) ? tasks : []).map((t) => cleanTask(t || {}, defaults));
    const checked = validateObjectivePlan({ title, criteria, tasks: cleaned, limits });
    if (!checked.ok) throw new HubError("validation", `Planul obiectivului are probleme: ${checked.problems.join("; ")}`, { data: { problems: checked.problems } });
    const ordered = checked.order.map((k) => cleaned.find((t) => t.key === k));
    const plan = { tasks: ordered, order: checked.order, stopConditions: STOP_CONDITIONS, totalMinutes: checked.totalMinutes,
      effects: { allowed: ["scriere în workspace-ul proiectului (copie izolată pe ruta lui)", "teste locale", "review doar-citire", "QA / preview / E2E local"], denied: ["deploy", "commit / push", "mesaje", "acces la producție sau la credențiale", "migrare de bază de date reală", "alte proiecte"] },
      roles: { writer: "Codex", reviewer: "Claude (doar citire)", runner: "Hub" }, concurrency: 1 };
    const cleanLimits = { maxAttemptsPerStage: Math.min(Number(limits.maxAttemptsPerStage || 2), OBJECTIVE_LIMITS.maxAttemptsPerStage), maxRepairCycles: Math.min(Number(limits.maxRepairCycles ?? 1), OBJECTIVE_LIMITS.maxRepairCycles) };
    const id = newId("apo");
    const t = iso();
    bus.transaction(() => {
      db.prepare(`INSERT INTO autopilot_objectives (id, project_id, title, status, plan_json, plan_hash, criteria_json, limits_json, base_snapshot_json, created_by, created_at, updated_at)
        VALUES (?, ?, ?, 'DRAFT', ?, ?, ?, ?, '{}', ?, ?, ?)`).run(id, p.id, redactText(String(title)).trim().slice(0, 160), json(plan), hashCanonical({ plan, criteria, cleanLimits }).slice(0, 24),
          json(criteria.map((c) => redactText(String(c)).slice(0, 300)).filter(Boolean).slice(0, 10)), json(cleanLimits), String(actor).slice(0, 80), t, t);
      bus.append({ type: "autopilot.drafted", scopeType: "autopilot", scopeId: id, projectId: p.id, source: actor, payload: { title: String(title).slice(0, 120), tasks: ordered.length } });
    });
    return view(id);
  }

  /** Creates the tasks' factory missions (DRAFT specs, nothing runs) in dependency order. Idempotent per task. */
  async function prepare(objectiveId, { actor, channel = "ui", ownerSession = null }) {
    const o = need(objectiveId);
    if (!["DRAFT", "PREPARED"].includes(o.status)) throw new HubError("conflict", `Obiectivul e în ${o.status}`);
    const plan = o.plan;
    for (const task of plan.tasks) {
      if (task.missionId && factory.view(task.missionId)) continue;
      const deps = task.dependsOn.length ? ` Depinde de: ${task.dependsOn.map((k) => plan.tasks.find((x) => x.key === k)?.title || k).join(", ")}.` : "";
      const spec = { inScope: task.inScope, outOfScope: [...task.outOfScope, ...plan.effects.denied], acceptance: task.acceptance,
        constraints: [`Parte din obiectivul „${o.title}” (sarcina ${task.key}).${deps}`],
        verification: { checks: ["npm test"], acceptance: [], ...(task.verification || {}), preview: task.preview || task.verification?.preview || null },
        sources: { user: [task.objective], code: [], assumptions: [] } };
      const result = await commands.dispatch({ type: "factory.prepare", channel, actor, ownerSession, payload: { projectId: o.projectId, workType: task.workType, title: task.title,
        objective: `${task.objective}`.padEnd(10, "."), spec, limits: { maxDurationMin: task.maxDurationMin, maxAttemptsPerStage: o.limits.maxAttemptsPerStage, maxRepairCycles: o.limits.maxRepairCycles } } });
      task.missionId = result.result?.mission?.id || null;
    }
    const incomplete = plan.tasks.filter((t) => { const v = t.missionId ? factory.view(t.missionId) : null; return !v?.scope; }).map((t) => t.key);
    bus.transaction(() => {
      db.prepare("UPDATE autopilot_objectives SET plan_json = ?, status = 'PREPARED', version = version + 1, updated_at = ? WHERE id = ?").run(json(plan), iso(), objectiveId);
      bus.append({ type: "autopilot.prepared", scopeType: "autopilot", scopeId: objectiveId, projectId: o.projectId, source: actor, payload: { title: o.title, missions: plan.tasks.map((t) => t.missionId), incomplete } });
    });
    return { objective: view(objectiveId), incomplete, note: incomplete.length ? `Sarcinile ${incomplete.join(", ")} au specificații incomplete; planul se poate prezenta după ce le completezi.` : "Toate sarcinile au specificații complete; poți cere planul." };
  }

  /** One envelope over the ordered tasks (TRUSTED/HIGH: one confirmation for the whole objective; ASSISTED: the next ready task). */
  async function propose(objectiveId, { actor, via = "ui", constraints = {} }) {
    const o = need(objectiveId);
    // A new plan is possible when the objective is prepared, when its previous plan ended without running (expired, withdrawn,
    // superseded) or — ASSISTED — when the previous task is delivered and the next one waits for its own plan (derived status).
    const current = view(objectiveId);
    const ended = o.status === "PROPOSED" && (!current.envelope || ["EXPIRED", "REVOKED", "SUPERSEDED", "CANCELLED"].includes(current.envelope.status));
    if (o.status !== "PREPARED" && current.status !== "PREPARED" && !ended) throw new HubError("conflict", o.status === "DRAFT" ? "Pregătește întâi sarcinile obiectivului" : `Obiectivul e în ${current.status}`);
    const plan = o.plan;
    const pending = plan.tasks.filter((t) => factory.view(t.missionId)?.factory.stage === "SPEC_DRAFT");
    // A task built on a rejected or cancelled task — directly or through another task — cannot be offered again as if nothing
    // happened: the objective needs a new version (review M08 rounds 1–2).
    const stageOfKey = (k) => factory.view(plan.tasks.find((t) => t.key === k)?.missionId)?.factory.stage || null;
    const dead = new Set(plan.tasks.filter((t) => ["REJECTED", "CANCELLED"].includes(stageOfKey(t.key))).map((t) => t.key));
    for (let grew = true; grew;) { grew = false; for (const t of plan.tasks) if (!dead.has(t.key) && t.dependsOn.some((k) => dead.has(k))) { dead.add(t.key); grew = true; } }
    const orphaned = pending.filter((t) => dead.has(t.key));
    if (orphaned.length) throw new HubError("conflict", `Sarcinile ${orphaned.map((t) => t.key).join(", ")} depind de o sarcină respinsă sau anulată; modifică obiectivul (o versiune nouă) înainte de un plan nou`);
    // In plan order, a task enters only when each dependency is delivered or comes earlier in this same plan (a paused or blocked
    // dependency stops the list there: the owner resumes it first).
    const delivered = (k) => ["DELIVERY_READY", "ACCEPTED"].includes(stageOfKey(k));
    const ready = [];
    for (const t of pending) {
      if (!t.dependsOn.every((k) => delivered(k) || ready.some((r) => r.key === k))) break;
      ready.push(t);
    }
    if (!ready.length) throw new HubError("conflict", pending.length ? `Sarcina ${pending[0].key} depinde de ${pending[0].dependsOn.filter((k) => !delivered(k)).join(", ")}, care nu e livrată; reia întâi acea sarcină` : "Nicio sarcină nu mai așteaptă un plan");
    const level = envelopes.autonomyOf(o.projectId).level;
    const missionIds = (level === "ASSISTED" ? ready.slice(0, 1) : ready).map((t) => t.missionId);
    const proposal = await envelopes.propose({ projectId: o.projectId, missionIds, constraints, actor, via,
      objective: { id: o.id, version: o.version, title: o.title, criteria: o.criteria, planHash: o.planHash, tasks: plan.tasks.map((t) => ({ key: t.key, title: t.title, missionId: t.missionId, dependsOn: t.dependsOn })), stopConditions: plan.stopConditions } });
    if (proposal.envelope?.id) {
      bus.transaction(() => {
        db.prepare("UPDATE autopilot_objectives SET envelope_id = ?, status = 'PROPOSED', base_snapshot_json = ?, version = version + 1, updated_at = ? WHERE id = ?").run(proposal.envelope.id, json(proposal.envelope.body?.baseSnapshot || {}), iso(), objectiveId);
        bus.append({ type: "autopilot.proposed", scopeType: "autopilot", scopeId: objectiveId, projectId: o.projectId, source: actor, payload: { title: o.title, envelopeId: proposal.envelope.id, missions: missionIds.length } });
      });
    }
    return { objective: view(objectiveId), plan: proposal };
  }

  /** The objective with each task's live factory stage; the overall status is derived (never set by a client). */
  function view(objectiveId) {
    const o = need(objectiveId);
    const tasks = o.plan.tasks.map((t) => {
      const v = t.missionId ? factory.view(t.missionId) : null;
      return { ...t, stage: v?.factory.stage || null, stageReason: v?.factory.stageReason || null, specComplete: Boolean(v?.scope), waitingOn: t.dependsOn.filter((k) => !["DELIVERY_READY", "ACCEPTED"].includes(factory.view(o.plan.tasks.find((x) => x.key === k)?.missionId)?.factory.stage)) };
    });
    const env = o.envelopeId ? envelopes.get(o.envelopeId) : null;
    const stages = tasks.map((t) => t.stage);
    let status = o.status;
    // An open plan decides first: while its authority is live the objective is running or waiting, whatever a task's stage says.
    const open = env && ["CONFIRMED", "ACTIVE", "WAITING_OWNER"].includes(env.status);
    if (open) status = env.status === "WAITING_OWNER" || stages.some((s) => ["NEEDS_OWNER_DECISION", "BLOCKED", "PAUSED"].includes(s)) ? "WAITING_OWNER" : "RUNNING";
    else if (["PROPOSED", "RUNNING", "WAITING_OWNER"].includes(o.status) && env) {
      if (stages.length && stages.every((s) => ["DELIVERY_READY", "ACCEPTED"].includes(s))) status = "DELIVERED";
      else if (["CANCELLED", "REVOKED", "EXPIRED", "FAILED_TO_START"].includes(env.status) || stages.some((s) => ["CANCELLED", "REJECTED"].includes(s))) status = "STOPPED";
      else if (env.status === "WAITING_OWNER" || stages.some((s) => ["NEEDS_OWNER_DECISION", "BLOCKED", "PAUSED"].includes(s))) status = "WAITING_OWNER";
      else if (["CONFIRMED", "ACTIVE"].includes(env.status)) status = "RUNNING";
      else if (env.status === "COMPLETED" && tasks.some((t) => t.stage === "SPEC_DRAFT")) status = "PREPARED"; // ASSISTED: next task needs its own plan
    }
    return { ...o, status, tasks, envelope: env ? { id: env.id, status: env.status, autonomyLevel: env.autonomyLevel, expiresAt: env.expiresAt } : null,
      progress: { delivered: stages.filter((s) => ["DELIVERY_READY", "ACCEPTED"].includes(s)).length, total: tasks.length } };
  }

  /** A changed objective is a new version (DRAFT): the old plan's confirmation never covers it; a running objective must stop first. */
  function amend(objectiveId, changes, { actor }) {
    const o = need(objectiveId);
    const v = view(objectiveId);
    const planOpen = v.envelope && ["CONFIRMED", "ACTIVE", "WAITING_OWNER"].includes(v.envelope.status);
    if (planOpen || ["RUNNING", "WAITING_OWNER"].includes(v.status)) throw new HubError("conflict", "Obiectivul rulează: oprește planul înainte să schimbi scope-ul (o confirmare nu acoperă un scope schimbat)");
    const next = draft({ projectId: o.projectId, title: changes.title ?? o.title, criteria: changes.criteria ?? o.criteria, tasks: changes.tasks ?? o.plan.tasks.map(({ missionId, ...t }) => t),
      verification: changes.verification ?? null, limits: { ...o.limits, ...(changes.limits || {}) }, actor });
    bus.transaction(() => {
      db.prepare("UPDATE autopilot_objectives SET status = 'SUPERSEDED', updated_at = ? WHERE id = ?").run(iso(), objectiveId);
      bus.append({ type: "autopilot.superseded", scopeType: "autopilot", scopeId: objectiveId, projectId: o.projectId, source: actor, payload: { title: o.title, by: next.id } });
    });
    return next;
  }

  const list = (projectId = null) => db.prepare(`SELECT id FROM autopilot_objectives ${projectId ? "WHERE project_id = ?" : ""} ORDER BY created_at DESC LIMIT 50`).all(...(projectId ? [projectId] : [])).map((r) => view(r.id));

  return { draft, prepare, propose, view, amend, list, validate: validateObjectivePlan };
}
