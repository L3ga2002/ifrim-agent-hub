import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { HubError } from "../core/errors.mjs";
import { newId } from "../core/ids.mjs";
import { hashCanonical } from "../core/canonical.mjs";
import { json, parse } from "../storage/db.mjs";
import { approvalHash } from "../policy/approvals.mjs";
import { catalogEntry } from "../policy/approval-policy.mjs";
import { gitState } from "../tools/git.mjs";

/**
 * Mission Authorization Envelopes (M06 §17–§22) and the CapabilityIssuer.
 *
 * An envelope is the exact plan the owner sees before anything runs: the missions and their approved-to-be scopes (spec,
 * plan, routes, limits, commands), the project and its route, the environment attestation, the repository state, the roles,
 * providers, models, limits, allowed and denied effects and the autonomy level. Its content hash is what the owner confirms,
 * ONCE, in an authenticated session under the activated voice-first policy. The model proposes; this deterministic service
 * validates the owner's intent and issues the rights:
 *
 *  - the confirmation is consumable (nonce, confirm-by time, atomic status change, one authority in force per project);
 *  - anything that changes between preview and confirmation (scope, snapshot, route, attestation, mode, readiness) refuses
 *    the confirmation and names the difference;
 *  - the derived grants are never wider than the envelope (provider, access, project, attempts, duration, expiry) and they
 *    carry the envelope id; the factory scope approval is decided as "owner_session" with the envelope named;
 *  - deploy, money, access/isolation changes, installs, real-data deletion, external sending and publishing stay outside every
 *    envelope (they keep their own exact authorization); cost stays INCLUDED_SUBSCRIPTION_ONLY;
 *  - REAL_PROJECT_ELIGIBLE comes from the verified stage map, never from an autonomy level or a confirmation.
 *
 * It maps onto the existing runtime (factory missions, approvals, grants, gate); it is not a second orchestrator.
 */
export const ENVELOPE_SCHEMA_VERSION = 1;
export const AUTONOMY_LEVELS = Object.freeze(["OBSERVE", "ASSISTED", "TRUSTED", "HIGH_AUTONOMY_BOUNDED"]);
const LEVEL_RANK = { OBSERVE: 0, ASSISTED: 1, TRUSTED: 2, HIGH_AUTONOMY_BOUNDED: 3 };
export const AUTONOMY_LABELS = Object.freeze({
  OBSERVE: "Observ: citire, navigare și planuri, fără execuții",
  ASSISTED: "Asistat: o confirmare per misiune; remedierile cer confirmarea ta",
  TRUSTED: "De încredere: implementare, teste, review, remedieri în limită, QA și preview fără confirmări intermediare",
  HIGH_AUTONOMY_BOUNDED: "Autonomie mare, delimitată: o listă finită de misiuni eligibile, una după alta, în aceleași limite totale",
});
export const DENIED_EFFECTS = Object.freeze(["deploy", "git.commit", "git.push", "message.send", "connector.write", "publish", "billing", "auth.change",
  "isolation.change", "policy.change", "install", "data.delete", "cloud_task.start", "other_projects", "owner.accept"]);
const ENVELOPE_STATUSES = Object.freeze(["PROPOSED", "CONFIRMED", "ACTIVE", "WAITING_OWNER", "COMPLETED", "EXPIRED", "REVOKED", "SUPERSEDED", "FAILED_TO_START", "CANCELLED"]);
const OPEN = new Set(["CONFIRMED", "ACTIVE", "WAITING_OWNER"]);
export const ENVELOPE_LIMITS = Object.freeze({ confirmWindowMin: 15, slackMin: 30, maxMissions: 5, grantMaxAttempts: 5 });
// Gate checks an envelope resolves itself (it derives the grants, may enter LIVE_VALIDATION, takes the lease, makes the backup).
const ENVELOPE_RESOLVES = new Set(["live_grant", "mode", "workspace_lease", "backup", "operational", "concurrency"]);

export function createEnvelopes({ db, bus, clock, settings, projects, missions, grants, gate, approvals, commands, trust, factory, factoryRunner, environments, config, voice = null }) {
  const now = () => clock();
  const iso = (d = now()) => d.toISOString();
  const rowTo = (row) => row && ({ id: row.id, schemaVersion: row.schema_version, projectId: row.project_id, missionIds: parse(row.mission_ids_json, []), planHash: row.plan_hash,
    envelopeHash: row.envelope_hash, body: parse(row.body_json, {}), summary: parse(row.summary_json, {}), autonomyLevel: row.autonomy_level, status: row.status, nonce: row.nonce,
    proposedBy: row.proposed_by, proposedVia: row.proposed_via, ownerSessionId: row.owner_session_id, consent: parse(row.consent_json, {}), derived: parse(row.derived_json, {}),
    currentMissionId: row.current_mission_id, issuedAt: row.issued_at, confirmBy: row.confirm_by, expiresAt: row.expires_at, confirmedAt: row.confirmed_at, closedAt: row.closed_at,
    closeReason: row.close_reason, createdAt: row.created_at, updatedAt: row.updated_at, version: row.version });
  const get = (id) => rowTo(db.prepare("SELECT * FROM mission_envelopes WHERE id = ?").get(String(id || "")));
  const forProject = (projectId, limit = 20) => db.prepare("SELECT * FROM mission_envelopes WHERE project_id = ? ORDER BY created_at DESC LIMIT ?").all(projectId, limit).map(rowTo);
  const openFor = (projectId) => rowTo(db.prepare("SELECT * FROM mission_envelopes WHERE project_id = ? AND status IN ('CONFIRMED','ACTIVE','WAITING_OWNER') LIMIT 1").get(projectId));
  const pending = () => db.prepare("SELECT * FROM mission_envelopes WHERE status = 'PROPOSED' AND confirm_by > ? ORDER BY created_at DESC").all(iso()).map(rowTo);
  const envelopeOfMission = (missionId) => rowTo(db.prepare("SELECT * FROM mission_envelopes WHERE status IN ('CONFIRMED','ACTIVE','WAITING_OWNER') AND EXISTS (SELECT 1 FROM json_each(mission_envelopes.mission_ids_json) WHERE value = ?) ORDER BY created_at LIMIT 1").get(String(missionId || ""))) || null;
  const openEnvelopeIds = () => db.prepare("SELECT id FROM mission_envelopes WHERE status IN ('CONFIRMED','ACTIVE','WAITING_OWNER') ORDER BY created_at").all().map((r) => r.id);
  /** The plans holding the mode (a hold written before M07 round 2 names only its envelopeId). */
  const holdersOf = (hold) => (Array.isArray(hold?.holders) ? hold.holders : hold?.envelopeId ? [hold.envelopeId] : []);

  function setStatus(id, status, { reason = "", extra = {}, from = null } = {}) {
    if (!ENVELOPE_STATUSES.includes(status)) throw new Error(`Unknown envelope status ${status}`);
    const cols = Object.entries(extra);
    const closing = ["COMPLETED", "EXPIRED", "REVOKED", "SUPERSEDED", "FAILED_TO_START", "CANCELLED"].includes(status);
    const where = from ? ` AND status IN (${from.map(() => "?").join(",")})` : "";
    const changed = db.prepare(`UPDATE mission_envelopes SET status = ?, updated_at = ?, version = version + 1${closing ? ", closed_at = ?, close_reason = ?" : ""}${cols.map(([c]) => `, ${c} = ?`).join("")} WHERE id = ?${where}`)
      .run(status, iso(), ...(closing ? [iso(), String(reason).slice(0, 500)] : []), ...cols.map(([, v]) => v), id, ...(from || [])).changes;
    if (changed) bus.append({ type: "envelope.status", scopeType: "envelope", scopeId: id, source: "envelopes", payload: { status, reason: String(reason).slice(0, 300) } });
    return changed;
  }

  // ---------- autonomy ----------
  const defaultLevel = (project) => (project?.source === "hub-test" ? "ASSISTED" : "OBSERVE");
  function autonomyOf(projectId) {
    const project = projects.get(projectId);
    const stored = settings.get("projectAutonomy")?.[project?.id || projectId];
    return stored && AUTONOMY_LEVELS.includes(stored.level) ? { level: stored.level, source: "owner", setAt: stored.setAt } : { level: defaultLevel(project), source: "default" };
  }

  /** Raising autonomy needs a freshly re-authenticated session; lowering it is fail-safe (any channel). Never automatic. */
  function setAutonomy({ projectId, level, session = null, actor = "owner" }) {
    if (!AUTONOMY_LEVELS.includes(level)) throw new HubError("validation", "Nivel de autonomie necunoscut");
    const project = projects.get(projectId);
    if (!project) throw new HubError("not_found", "Proiect necunoscut");
    const current = autonomyOf(project.id).level;
    const raising = LEVEL_RANK[level] > LEVEL_RANK[current];
    let s = null;
    if (raising) {
      if (!trust.policy().active) throw new HubError("policy", "Nivelurile peste OBSERVE/ASSISTED se folosesc doar cu politica voice-first activă");
      s = trust.requireFresh(session, `ridicarea autonomiei pe ${project.name}`);
    }
    const value = { ...settings.get("projectAutonomy"), [project.id]: { level, version: 1, setAt: iso(), setBy: s ? `session:${s.id}` : actor, previous: current } };
    bus.transaction(() => settings.set("projectAutonomy", value, actor, `Autonomy ${current} → ${level} on ${project.name}`));
    // A lower level narrows an authority already in force: an open envelope above it is revoked.
    if (!raising) {
      const open = openFor(project.id);
      if (open && LEVEL_RANK[open.autonomyLevel] > LEVEL_RANK[level]) revoke(open.id, { actor, reason: `Autonomie coborâtă la ${level}` });
      // A plan still waiting for confirmation above the new level can no longer be confirmed: it is superseded now.
      bus.transaction(() => { for (const p of pending().filter((e) => e.projectId === project.id && LEVEL_RANK[e.autonomyLevel] > LEVEL_RANK[level])) setStatus(p.id, "SUPERSEDED", { reason: `Autonomie coborâtă la ${level}`, from: ["PROPOSED"] }); });
    }
    return { projectId: project.id, level, previous: current };
  }

  // ---------- readiness & eligibility ----------
  /**
   * What would block the run if the owner confirmed now. Grant, mode, lease, backup and concurrency are what the envelope
   * itself arranges, so they are not blockers here; everything else (gate open, isolation, billing route, environment,
   * breaker, project scope, frozen project, missing scope) is.
   */
  function readiness(project, missionViews) {
    const blockers = [];
    const isTest = project?.source === "hub-test";
    if (!project) return { eligible: false, isTest: false, blockers: [{ id: "project", detail: "Proiect necunoscut" }], stageMap: null };
    const map = factoryRunner?.stageMap ? factoryRunner.stageMap(project) : null;
    // A real project needs every code-executing stage inside an attested environment AND the owner's isolation policy (b).
    if (!isTest && !(map?.realProjectEligible)) blockers.push({ id: "isolation", kind: "isolation", detail: `Execuție blocată de izolare: ${(map?.blockers || ["harta etapelor indisponibilă"]).slice(0, 4).join(" · ")}` });
    if (settings.get("projectFreeze")?.[project.id]) blockers.push({ id: "frozen", kind: "owner", detail: "Proiectul este înghețat (spune „Dezgheață” sau apasă Dezgheață)" });
    for (const [role, provider, access] of [["writer", "codex", "workspace-write"], ["reviewer", "claude", "read-only"]]) {
      const evaluated = gate.evaluate({ provider, projectId: project.id, access });
      for (const c of evaluated.checks) if (!c.ok && !ENVELOPE_RESOLVES.has(c.id)) blockers.push({ id: `${role}:${c.id}`, kind: c.id === "isolation" || c.id === "host_isolation" || c.id === "environment_route" ? "isolation" : "gate", detail: `${role === "writer" ? "Writer (Codex)" : "Reviewer (Claude)"} · ${c.id}: ${c.detail}` });
    }
    for (const v of missionViews) {
      if (!v) continue;
      if (v.factory.stage !== "SPEC_DRAFT") blockers.push({ id: `mission:${v.mission.id}`, kind: "plan", detail: `„${v.mission.title}” e în etapa ${v.factory.stage}, nu poate primi un plan nou` });
      else if (!v.scope) blockers.push({ id: `mission:${v.mission.id}`, kind: "plan", detail: `„${v.mission.title}”: specificația are probleme (${(v.spec?.protected?.problems || []).slice(0, 3).join("; ") || "incompletă"})` });
    }
    return { eligible: blockers.length === 0, isTest, blockers, stageMap: map ? { route: map.route, realProjectEligible: map.realProjectEligible, stages: map.stages.map((s) => ({ stage: s.stage, label: s.label, boundary: s.boundary, where: s.where })) } : null };
  }

  /**
   * The repository state the plan is bound to. Git: HEAD plus size and modification time of every changed or untracked file
   * (a file edited again while already dirty changes it too). Without git: a bounded walk of names, sizes and times.
   * Metadata only; no file content is read.
   */
  async function repoState(project) {
    const stamp = (rel) => { try { const st = fs.statSync(path.join(project.path, rel)); return `${rel}:${st.size}:${Math.round(st.mtimeMs)}`; } catch { return `${rel}:gone`; } };
    try {
      // Only the project's own repository: a folder inside another repository (often ignored there) is walked instead.
      const st = fs.existsSync(path.join(project.path, ".git")) ? await gitState(project.path) : null;
      if (st?.isRepo) {
        const changed = [...st.dirty.map((d) => d.path), ...st.untracked].slice(0, 2000);
        return { kind: "repository", head: st.head, branch: st.branch, dirty: st.dirty.length, untracked: st.untracked.length,
          stateHash: hashCanonical({ head: st.head, dirty: st.dirty.map((d) => `${d.code}:${d.path}`).sort(), files: changed.map(stamp).sort() }).slice(0, 16) };
      }
    } catch { /* not a repository or git unavailable: walk below */ }
    const SKIP = new Set(["node_modules", ".git", ".ifrim", "dist", "build", ".next", "coverage"]);
    const entries = []; let truncated = false;
    const walk = (dir, rel = "") => {
      if (entries.length >= 5000) { truncated = true; return; }
      let list = [];
      try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of list) {
        if (SKIP.has(e.name)) continue;
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) walk(path.join(dir, e.name), r);
        else if (e.isFile()) entries.push(stamp(r));
        if (entries.length >= 5000) { truncated = true; return; }
      }
    };
    walk(project.path);
    return entries.length ? { kind: "files", files: entries.length, truncated, stateHash: hashCanonical(entries.sort()).slice(0, 16) } : { kind: "unreadable" };
  }

  function attestationRefs(project, route) {
    if (route === "windows") {
      const consent = settings.get("isolationConsent")?.codex || null;
      return [{ environment: "windows", isolationConsent: consent ? String(consent.fingerprint || "").slice(0, 16) : null, r2Accepted: Boolean(settings.get("r2Acceptance")?.[project.id]) }];
    }
    const service = environments?.get(route);
    // attestationStatus() is { valid, reason, latest }: the plan is bound to the latest attestation's id, status and fingerprint
    // (M07 fix: M06 read fields that do not exist, so the binding was always null and a re-attestation never changed the hash).
    const att = service?.attestationStatus ? service.attestationStatus(now()) : null;
    return [{ environment: route, attestationId: att?.latest?.id || null, fingerprintHash: att?.latest?.fingerprintHash || null, status: att?.latest?.status || "none", valid: Boolean(att?.valid),
      canaryVersion: att?.latest?.canaryVersion || null }];
  }

  /** The envelope content (hashed): everything the confirmation covers. Time, nonce and ids are metadata, not content. */
  /**
   * The objective a multi-task plan stands for (M08), read from the database only (a caller cannot claim or shape it): the tasks must
   * be exactly these missions, in the objective's order, and the objective must still be current. Only the fields that define the
   * plan are part of it (not its status/version counters), so the same objective gives the same plan at confirmation time.
   */
  function objectiveRefFor(objectiveId, projectId, ids) {
    const row = db.prepare("SELECT id, project_id, title, criteria_json, plan_json, plan_hash, status FROM autopilot_objectives WHERE id = ?").get(String(objectiveId));
    const plan = parse(row?.plan_json, {});
    const planTasks = plan.tasks || [];
    const ordered = planTasks.map((t) => t.missionId).filter((m) => ids.includes(m));
    if (!row || row.project_id !== projectId || ordered.length !== ids.length || ordered.some((m, i) => m !== ids[i])) throw new HubError("policy", "Misiunile nu sunt sarcinile acestui obiectiv, în ordinea lui");
    if (["SUPERSEDED", "STOPPED", "DELIVERED"].includes(row.status)) throw new HubError("conflict", `Obiectivul nu mai e curent (${row.status}); cere planul versiunii actuale`);
    return { id: row.id, title: row.title, criteria: parse(row.criteria_json, []), planHash: row.plan_hash, stopConditions: plan.stopConditions || [],
      tasks: planTasks.map((t) => ({ key: t.key, title: t.title, missionId: t.missionId, dependsOn: t.dependsOn })) };
  }

  async function buildBody(project, views, level, constraints = {}, objective = null) {
    const route = environments ? environments.routeFor(project.id, "codex") : "windows";
    const entries = views.map((v) => ({ missionId: v.mission.id, title: v.mission.title, workType: v.factory.workType, specVersion: v.scope.specVersion, specSha: v.scope.specSha,
      planSha: v.scope.planSha, scopeHash: hashCanonical(v.scope), limits: v.scope.limits, routes: v.scope.routes, commands: v.scope.commands,
      estimatedFiles: (v.spec?.spec?.inScope || []).slice(0, 10) }));
    const repairs = (e) => (level === "ASSISTED" ? 0 : e.limits.maxRepairCycles);
    const totalMinutes = entries.reduce((sum, e) => sum + e.limits.maxDurationMin, 0);
    const body = {
      schemaVersion: ENVELOPE_SCHEMA_VERSION, projectId: project.id, projectName: project.name, autonomyLevel: level,
      missions: entries, planHash: hashCanonical(entries.map((e) => e.scopeHash)),
      workspaceScope: { projectId: project.id, route, kind: project.source === "hub-test" ? "test" : "real" },
      baseSnapshot: await repoState(project),
      eligibleEnvironments: [route], attestationRefs: attestationRefs(project, route),
      allowedRoles: ["writer", "reviewer", "hub-runner"], providers: ["codex", "claude"],
      models: Object.fromEntries(entries.map((e) => [e.missionId, { writer: e.routes.writer.model || "implicit (fix în plan)", reviewer: e.routes.reviewer.model || "implicit (fix în plan)" }])),
      effortPolicy: Object.fromEntries(entries.map((e) => [e.missionId, { profile: e.limits.profile, writer: e.routes.writer.effort || "din profil", reviewer: e.routes.reviewer.effort || "din profil" }])),
      allowedTools: { writer: "Codex: fișierele proiectului (scriere), comenzile din sandbox", reviewer: "Claude: Read/Glob/Grep, fără scriere", runner: "comenzile aprobate din specificație" },
      filesystemScope: route === "windows" ? "proiectul, prin sandbox-ul Codex de pe Windows (R2 deschis)" : `o copie a proiectului în ${route}; exportul validat (C14) se aplică după verificarea conflictelor`,
      networkScope: { writer: "doar furnizorul modelului (abonament)", reviewer: "doar furnizorul modelului (abonament)", runner: route === "windows" ? "sandbox Codex Windows" : `${route}: fără rețea`, preview: "doar loopback local" },
      limits: { maxDurationMin: totalMinutes, maxAttemptsPerStage: Math.max(...entries.map((e) => e.limits.maxAttemptsPerStage)), maxRepairCycles: Object.fromEntries(entries.map((e) => [e.missionId, repairs(e)])), maxConcurrency: 1 },
      allowedEffects: ["workspace.write (proiectul de mai sus)", "teste locale", "review doar-citire", ...(level === "ASSISTED" ? [] : ["remedieri în limită"]), "QA", "preview local", "E2E local"],
      deniedEffects: [...DENIED_EFFECTS], ownerConstraints: Object.keys(constraints).filter((k) => constraints[k]).sort(),
      subscriptionPolicy: "INCLUDED_SUBSCRIPTION_ONLY",
      // M08: inside an objective the owner confirms the ordered tasks at once, so at TRUSTED the next task of THIS plan starts without
      // another confirmation (the scope of every task is bound by its hash); ASSISTED plans cover one task at a time.
      continuationPolicy: { afterPanelClosed: true, repairsWithoutConfirmation: level !== "ASSISTED", nextMissionWithoutConfirmation: level === "HIGH_AUTONOMY_BOUNDED" || (Boolean(objective) && level === "TRUSTED"), stopAt: "DELIVERY_READY (nu accept și nu livrez singur)" },
      objective: objective ? { id: objective.id, version: objective.version, title: objective.title, criteria: objective.criteria, planHash: objective.planHash, tasks: objective.tasks, stopConditions: objective.stopConditions } : null,
      modeTransition: settings.get("mode") === "BUILD_SAFE" ? "BUILD_SAFE→LIVE_VALIDATION până la sfârșitul misiunilor" : null,
    };
    return body;
  }

  function summaryOf(body, readinessInfo) {
    const m = body.missions;
    const repairs = Object.values(body.limits.maxRepairCycles);
    return {
      headline: body.objective ? `Obiectiv „${body.objective.title}”: ${m.length === 1 ? `sarcina „${m[0].title}”` : `${m.length} sarcini, una după alta`} pe ${body.projectName}` : m.length === 1 ? `„${m[0].title}” pe ${body.projectName}` : `${m.length} misiuni pe ${body.projectName}, una după alta`,
      where: `Lucrez numai în ${body.projectName} (${body.workspaceScope.route}); ${body.filesystemScope}.`,
      steps: `Implementare (Codex), verificări, review (Claude, doar citire), ${repairs.every((r) => r === 0) ? "remedierile îți cer confirmarea" : `până la ${Math.max(...repairs)} cicluri de remediere`}, QA, preview și E2E local.`,
      never: "Fără deploy, commit, push, mesaje, bani, schimbări de acces sau izolare, instalări, ștergeri de date reale.",
      stops: `Mă opresc la ${body.limits.maxDurationMin} min, ${body.limits.maxAttemptsPerStage} încercări pe etapă, sau când livrarea e gata de verificarea ta (nu accept singur). Continui și dacă închizi pagina, dar numai în aceste limite; nu încep alte misiuni${body.continuationPolicy.nextMissionWithoutConfirmation ? " decât pe cele din acest plan" : ""}.`,
      cost: "Doar din abonamentele incluse; niciun API plătit, nicio extra usage.",
      mode: body.modeTransition ? "Hub-ul trece din BUILD_SAFE în LIVE_VALIDATION pe durata misiunii și revine apoi." : null,
      files: m.flatMap((e) => e.estimatedFiles).length ? `Estimare (nu promisiune): ${m.flatMap((e) => e.estimatedFiles).slice(0, 6).join(", ")}` : "Fișierele modificate nu sunt identificate încă (estimarea vine după implementare).",
      autonomy: AUTONOMY_LABELS[body.autonomyLevel],
      blockers: readinessInfo.blockers.map((b) => b.detail),
      state: readinessInfo.eligible ? "PLAN_READY" : readinessInfo.blockers.some((b) => b.kind === "isolation") ? "BLOCKED_BY_ISOLATION" : "PLAN_BLOCKED",
    };
  }

  // ---------- propose ----------
  /** Preview only: nothing runs, nothing is granted. Works under the legacy policy too (confirmation then goes through Approvals). */
  async function propose({ projectId, missionIds = [], level = null, constraints = {}, actor = "owner", via = "ui", objective = null }) {
    const project = projects.get(projectId);
    if (!project) throw new HubError("not_found", "Proiect necunoscut");
    // A plan never runs above the project's own level (raising it is a separate, re-authenticated decision); a caller may
    // ask for a LOWER level for one plan (review M07: a requested level was taken as given).
    const projectLevel = autonomyOf(project.id).level;
    if (level && AUTONOMY_LEVELS.includes(level) && LEVEL_RANK[level] > LEVEL_RANK[projectLevel]) throw new HubError("policy", `Planul nu poate cere nivelul ${level} peste nivelul proiectului (${projectLevel}); ridică întâi autonomia proiectului`);
    const autonomy = level && AUTONOMY_LEVELS.includes(level) ? level : projectLevel;
    let ids = [...new Set((missionIds || []).filter(Boolean))];
    if (!ids.length) {
      ids = factory.list().filter((f) => f.projectId === project.id && f.stage === "SPEC_DRAFT").map((f) => f.missionId);
      ids = autonomy === "HIGH_AUTONOMY_BOUNDED" ? ids.slice(0, ENVELOPE_LIMITS.maxMissions) : ids.slice(0, 1);
    }
    if (!ids.length) throw new HubError("validation", `Nu există o misiune Software Factory pregătită pe ${project.name}; descrie ce vrei și pregătesc specificația`);
    // Several missions in one plan: HIGH_AUTONOMY_BOUNDED, or the ordered tasks of ONE objective at TRUSTED (M08). The objective is
    // re-read from the database (a caller cannot claim one): its tasks must be exactly these missions, in its order.
    const objectiveRef = objective?.id ? objectiveRefFor(objective.id, project.id, ids) : null;
    if (ids.length > 1 && autonomy !== "HIGH_AUTONOMY_BOUNDED" && !(objectiveRef && autonomy === "TRUSTED")) throw new HubError("policy", "Mai multe misiuni într-un singur plan cer nivelul HIGH_AUTONOMY_BOUNDED (sau un obiectiv, la TRUSTED)");
    if (ids.length > ENVELOPE_LIMITS.maxMissions) throw new HubError("validation", `Cel mult ${ENVELOPE_LIMITS.maxMissions} misiuni într-un plan`);
    const views = ids.map((id) => { const v = factory.view(id); if (!v) throw new HubError("not_found", `Misiunea ${id} nu e o misiune Software Factory`); if (v.project?.id !== project.id) throw new HubError("policy", "O misiune din alt proiect nu intră în acest plan"); return v; });
    const ready = readiness(project, views);
    if (views.some((v) => !v.scope)) {
      return { envelope: null, readiness: ready, summary: { headline: views[0].mission.title, blockers: ready.blockers.map((b) => b.detail), state: "PLAN_INCOMPLETE" } };
    }
    const body = await buildBody(project, views, autonomy, constraints, objectiveRef);
    const hash = hashCanonical(body);
    const summary = summaryOf(body, ready);
    const t = now();
    const id = newId("env");
    const nonce = crypto.randomBytes(12).toString("hex");
    const maxMin = body.limits.maxDurationMin + ENVELOPE_LIMITS.slackMin;
    bus.transaction(() => {
      // An older preview of the same project is superseded: only the latest plan can be confirmed.
      for (const old of db.prepare("SELECT id FROM mission_envelopes WHERE project_id = ? AND status = 'PROPOSED'").all(project.id)) setStatus(old.id, "SUPERSEDED", { reason: "Un plan mai nou a fost prezentat", from: ["PROPOSED"] });
      db.prepare(`INSERT INTO mission_envelopes (id, schema_version, project_id, mission_ids_json, plan_hash, envelope_hash, body_json, summary_json, autonomy_level, status, nonce,
        proposed_by, proposed_via, issued_at, confirm_by, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PROPOSED', ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, ENVELOPE_SCHEMA_VERSION, project.id, json(ids), body.planHash, hash, json(body), json(summary), autonomy, nonce, String(actor).slice(0, 80), via, iso(t),
          new Date(t.getTime() + ENVELOPE_LIMITS.confirmWindowMin * 60000).toISOString(), new Date(t.getTime() + maxMin * 60000).toISOString(), iso(t), iso(t));
      bus.append({ type: "envelope.proposed", scopeType: "envelope", scopeId: id, projectId: project.id, source: actor, payload: { via, missions: ids, hash: hash.slice(0, 16), level: autonomy, eligible: ready.eligible } });
    });
    return { envelope: view(id), readiness: ready, summary };
  }

  // ---------- armed spoken confirmation (M08 §17) ----------
  /*
   * After the exact plan is presented in the owner's authenticated session with the local voice gate active, the service opens a
   * short window for THAT plan (its hash and nonce) in THAT session. A spoken "Da, execută planul" the Hub itself heard (speaker
   * MATCH, local final transcript naming the plan, gate segment bound to this envelope) then confirms without a button. Nothing arms
   * because a model asked "ești de acord?": arming is a server call checked against the plan state, the session, the policy and the
   * voice profile. Windows live in memory: a restart closes them (fail-safe).
   */
  const CONFIRM_WINDOW_MS = 90 * 1000;
  const ARMED_MAX_FAILURES = 3;
  const armed = new Map(); // envelopeId → { sessionId, legaSessionId, hash, nonce, expiresAt, used }
  function armConfirmation({ envelopeId, session, legaSessionId = null }) {
    if (!trust.policy().active) throw new HubError("policy", "Politica voice-first nu este activă");
    const s = trust.requireSession(session, "fereastra de confirmare vocală");
    const env = get(envelopeId);
    if (!env || env.status !== "PROPOSED" || new Date(env.confirmBy) <= now()) throw new HubError("conflict", "Planul nu mai așteaptă confirmarea");
    if (env.summary?.state !== "PLAN_READY") throw new HubError("conflict", "Planul nu e eligibil acum; nu deschid o fereastră de confirmare");
    if (!voice?.status) throw new HubError("policy", "Confirmarea vocală nu e disponibilă pe acest server");
    const vs = voice.status(s);
    if (!vs?.profile || !vs?.gate?.enabled) throw new HubError("policy", "Confirmarea vocală cere profilul tău vocal și filtrul activ");
    const windowNonce = crypto.randomBytes(9).toString("hex");
    const expiresAt = new Date(now().getTime() + CONFIRM_WINDOW_MS).toISOString();
    armed.set(env.id, { sessionId: s.id, legaSessionId: legaSessionId || null, hash: env.envelopeHash, nonce: env.nonce, windowNonce, expiresAt, used: false });
    bus.emit({ type: "envelope.confirmation_armed", scopeType: "envelope", scopeId: env.id, projectId: env.projectId, source: `owner:${s.id}`, payload: { expiresAt, legaSession: Boolean(legaSessionId) } });
    return { envelopeId: env.id, armed: true, expiresAt, windowNonce, say: "Da, execută planul" };
  }
  function disarm(envelopeId) { armed.delete(envelopeId); }
  /** The armed window for this plan and session (null when none, expired, used, or the plan changed since). */
  function armedFor(envelopeId, sessionId, legaSessionId = null) {
    const w = armed.get(envelopeId);
    const env = w ? get(envelopeId) : null;
    if (!w || w.used || new Date(w.expiresAt) <= now() || w.sessionId !== sessionId || !env || env.status !== "PROPOSED" || env.envelopeHash !== w.hash) return null;
    if (w.legaSessionId && legaSessionId && w.legaSessionId !== legaSessionId) return null;
    return { ...w, env };
  }
  /** Called when a gate segment's local transcript is final: confirms the armed plan if every check holds; otherwise does nothing. */
  async function confirmFromArmed({ utteranceId, envelopeId, sessionId, legaSessionId = null }) {
    const w = armedFor(envelopeId, sessionId, legaSessionId);
    if (!w) return { confirmed: false, reason: "nicio fereastră armată pentru acest plan" };
    // One sentence at a time; the window is spent by a confirmation, and closes after 3 sentences that are not one (a vague "da",
    // a question, "da, dar nu porni") — those confirm nothing and never re-arm anything.
    if (w.busy) return { confirmed: false, reason: "o altă frază e verificată acum" };
    armed.set(envelopeId, { ...armed.get(envelopeId), busy: true });
    try {
      const out = await confirm({ envelopeId, nonce: w.nonce, displayedHash: w.hash, session: { id: sessionId }, modality: "voice", utteranceId, idempotencyKey: `armed:${w.windowNonce}` });
      armed.set(envelopeId, { ...armed.get(envelopeId), busy: false, used: true });
      return { confirmed: true, envelope: out.envelope };
    } catch (error) {
      const failures = (armed.get(envelopeId)?.failures || 0) + 1;
      if (failures >= ARMED_MAX_FAILURES) armed.delete(envelopeId);
      else armed.set(envelopeId, { ...armed.get(envelopeId), busy: false, failures });
      bus.emit({ type: "envelope.armed_refused", scopeType: "envelope", scopeId: envelopeId, source: "envelopes", payload: { reason: String(error.message).slice(0, 200), failures, closed: failures >= ARMED_MAX_FAILURES } });
      return { confirmed: false, reason: error.message };
    }
  }

  // ---------- confirm ----------
  /**
   * The owner's one confirmation. `modality`: "click" | "keyboard" | "typed" | "voice". Voice counts only with local
   * verification evidence (speaker gate + local transcription); a provider transcript or an LLM's claim never does.
   */
  async function confirm({ envelopeId, nonce, displayedHash, session, modality = "click", utteranceId = null, idempotencyKey = null }) {
    const policy = trust.policy();
    if (!policy.active) throw new HubError("policy", "Politica voice-first nu este activă: confirmarea trece prin Aprobări, ca până acum (modul legacy)");
    const s = trust.requireSession(session, "confirmarea unei misiuni");
    let env = get(envelopeId);
    if (!env) throw new HubError("not_found", "Plan necunoscut");
    if (env.status !== "PROPOSED") {
      if (idempotencyKey && env.consent?.idempotencyKey === idempotencyKey) return { envelope: view(env.id), duplicate: true };
      throw new HubError("conflict", `Planul nu mai așteaptă confirmarea (${env.status})`);
    }
    if (new Date(env.confirmBy) <= now()) { bus.transaction(() => setStatus(env.id, "EXPIRED", { reason: "Confirmarea a venit după termen", from: ["PROPOSED"] })); throw new HubError("conflict", "Planul a expirat; cere-l din nou ca să vezi starea actuală"); }
    if (nonce !== env.nonce || displayedHash !== env.envelopeHash) throw new HubError("conflict", "Confirmarea nu corespunde planului afișat (altă versiune); reîncarcă planul");
    if (env.autonomyLevel === "OBSERVE") throw new HubError("policy", "Nivelul OBSERVE nu permite execuții; schimbă nivelul proiectului dacă vrei să pornească");
    // The project's level may have been lowered after the plan was shown: the plan cannot run above it.
    const projectLevel = autonomyOf(env.projectId).level;
    if (projectLevel === "OBSERVE" || LEVEL_RANK[env.autonomyLevel] > LEVEL_RANK[projectLevel]) throw new HubError("policy", `Planul are nivelul ${env.autonomyLevel}, dar proiectul e acum la ${projectLevel}; cere planul din nou`);
    if (env.autonomyLevel === "HIGH_AUTONOMY_BOUNDED") trust.requireFresh(s, "confirmarea unui plan cu autonomie mare");
    if (!["click", "keyboard", "typed", "voice"].includes(modality)) throw new HubError("validation", "Modalitate necunoscută");
    // M07: a spoken confirmation is the server-held utterance (local speaker check + local transcript) recorded for THIS plan in
    // THIS session — never a client's claim. It is checked now and consumed in the same transaction that confirms the plan.
    let spoken = null;
    if (modality === "voice") {
      if (!voice) throw new HubError("policy", "Confirmarea vocală nu e disponibilă pe acest server; confirmă cu tasta sau butonul din cockpit");
      if (!utteranceId) throw new HubError("validation", "Confirmarea vocală trebuie să indice segmentul vocal înregistrat pentru plan");
      spoken = voice.claimForConfirmation({ utteranceId, session: s, envelope: env, pendingEnvelopes: pending().map((e) => ({ id: e.id, title: e.summary?.headline || "" })) });
    }
    // Nothing may have changed since the owner saw it.
    const project = projects.get(env.projectId);
    const views = env.missionIds.map((id) => factory.view(id));
    if (views.some((v) => !v?.scope)) { bus.transaction(() => setStatus(env.id, "SUPERSEDED", { reason: "O misiune nu mai are un scope complet", from: ["PROPOSED"] })); throw new HubError("conflict", "Planul nu mai e valabil: o misiune s-a schimbat"); }
    // An objective's plan is rebuilt from the objective as it is NOW: an amended (superseded) objective is no longer this plan.
    let objectiveNow = null;
    if (env.body.objective?.id) {
      try { objectiveNow = objectiveRefFor(env.body.objective.id, env.projectId, env.missionIds); }
      catch (error) { bus.transaction(() => setStatus(env.id, "SUPERSEDED", { reason: error.message, from: ["PROPOSED"] })); throw new HubError("conflict", `Planul nu mai e valabil: ${error.message}`); }
    }
    const body = await buildBody(project, views, env.autonomyLevel, Object.fromEntries((env.body.ownerConstraints || []).map((k) => [k, true])), objectiveNow);
    // Another tab may have confirmed it while this one was recomputing: report that, not a "changed plan".
    const current = get(env.id);
    if (current.status !== "PROPOSED") {
      if (idempotencyKey && current.consent?.idempotencyKey === idempotencyKey) return { envelope: view(env.id), duplicate: true };
      throw new HubError("conflict", `Planul nu mai așteaptă confirmarea (${current.status}): a fost deja confirmat în altă filă sau de o confirmare dublă`);
    }
    if (hashCanonical(body) !== env.envelopeHash) {
      const diff = changedParts(env.body, body);
      bus.transaction(() => setStatus(env.id, "SUPERSEDED", { reason: `S-a schimbat: ${diff.join(", ")}`, from: ["PROPOSED"] }));
      throw new HubError("conflict", `Planul s-a schimbat după ce l-ai văzut (${diff.join(", ")}); îți arăt diferența și confirmi din nou`, { data: { changed: diff } });
    }
    const ready = readiness(project, views);
    if (!ready.eligible) throw new HubError("gate", `Nu pot porni: ${ready.blockers.map((b) => b.detail).slice(0, 4).join(" · ")}`, { data: { blockers: ready.blockers } });

    const consent = { channel: "owner_session", modality, sessionId: s.id, credential: s.credentialId.slice(0, 10), policyVersion: policy.version, envelopeHash: env.envelopeHash,
      confirmedAt: iso(), idempotencyKey: idempotencyKey ? String(idempotencyKey).slice(0, 120) : null, voice: spoken ? spoken.evidence : null };
    // Atomic, consumable: a second tab, a double "yes" or a reconnect finds it no longer PROPOSED (and the unique index refuses
    // a second open authority on the same project).
    try {
      const changed = bus.transaction(() => {
        // The spoken "yes" counts once: a replay, a second tab or a reconnect finds it consumed.
        if (spoken && spoken.consume(env.id) !== 1) throw new HubError("conflict", "Fraza vocală a fost deja folosită pentru o confirmare");
        const n = setStatus(env.id, "CONFIRMED", { reason: `Confirmat (${modality}) în sesiunea ${s.id}`, from: ["PROPOSED"], extra: { owner_session_id: s.id, consent_json: json(consent), confirmed_at: consent.confirmedAt, idempotency_key: consent.idempotencyKey, current_mission_id: env.missionIds[0] } });
        if (n) bus.append({ type: "envelope.confirmed", scopeType: "envelope", scopeId: env.id, projectId: env.projectId, source: "owner", payload: { channel: "owner_session", modality, session: s.id, hash: env.envelopeHash.slice(0, 16) } });
        return n;
      });
      if (changed !== 1) throw new HubError("conflict", "Planul a fost deja confirmat (altă filă sau o confirmare dublă)");
    } catch (error) {
      if (/UNIQUE|constraint/i.test(String(error.message))) throw new HubError("conflict", "Proiectul are deja o misiune autorizată în curs; oprește-o sau așteaptă să se termine");
      throw error;
    }
    env = get(env.id);
    let prevHold = null;
    try {
      if (body.modeTransition && settings.get("mode") === "BUILD_SAFE") {
        // Only this plan holds the LIVE_VALIDATION it enters. Plans whose hold a boot suspended stay suspended beside it: only an
        // explicit resume of one of them makes it a holder again (M07 review round 3), and when this plan ends the suspended hold
        // comes back as it was.
        prevHold = settings.get("envelopeModeHold") || {};
        const suspended = prevHold.suspendedByBoot ? prevHold : prevHold.suspended || null;
        bus.transaction(() => {
          settings.set("mode", "LIVE_VALIDATION", "owner", `Envelope ${env.id}: LIVE_VALIDATION pe durata misiunii`);
          settings.set("envelopeModeHold", { envelopeId: env.id, holders: [env.id], since: iso(), ...(suspended ? { suspended } : {}) }, "owner", "Mode held by an envelope");
        });
      } else if (settings.get("mode") === "LIVE_VALIDATION" && (settings.get("envelopeModeHold") || {}).envelopeId) {
        // Confirmed while the plans hold LIVE_VALIDATION: it relies on that mode too, so it holds it until it closes.
        const hold = settings.get("envelopeModeHold");
        bus.transaction(() => settings.set("envelopeModeHold", { ...hold, holders: [...new Set([...holdersOf(hold), env.id])] }, "envelopes", `Plan ${env.id} joins the mode hold`));
      }
      await startMission(env, env.missionIds[0], s);
      bus.transaction(() => setStatus(env.id, "ACTIVE", { reason: "Prima misiune a pornit", from: ["CONFIRMED"], extra: { current_mission_id: env.missionIds[0] } }));
    } catch (error) {
      // A plan that entered LIVE_VALIDATION and did not start gives the mode back as it was (a suspended hold stays suspended).
      if (prevHold) {
        const hold = settings.get("envelopeModeHold") || {};
        const others = holdersOf(hold).filter((id) => id !== env.id && !holdersOf(hold.suspended).includes(id));
        bus.transaction(() => {
          if (others.length && hold.envelopeId) {
            // Another plan joined the hold meanwhile: it keeps it; this plan only leaves.
            settings.set("envelopeModeHold", { ...hold, envelopeId: others.includes(hold.envelopeId) ? hold.envelopeId : others[0], holders: others }, "envelopes", `Plan ${env.id} did not start: leaves the hold`);
          } else {
            if (settings.get("mode") === "LIVE_VALIDATION") settings.set("mode", "BUILD_SAFE", "envelopes", `Planul ${env.id} nu a pornit: înapoi la BUILD_SAFE`);
            settings.set("envelopeModeHold", prevHold, "envelopes", "Mode hold restored (the plan did not start)");
          }
        });
      }
      close(env.id, "FAILED_TO_START", `Nu a pornit: ${String(error.message).slice(0, 300)}`);
      throw new HubError(error.category || "gate", `Confirmarea a fost înregistrată, dar misiunea nu a pornit: ${error.message}. Nimic nu rulează; granturile derivate au fost revocate.`, { data: { envelopeId: env.id } });
    }
    return { envelope: view(env.id), duplicate: false };
  }

  function changedParts(before, after) {
    const keys = ["missions", "baseSnapshot", "attestationRefs", "workspaceScope", "limits", "modeTransition", "models", "effortPolicy", "autonomyLevel"];
    const labels = { missions: "specificația, planul sau limitele unei misiuni", baseSnapshot: "starea repository-ului", attestationRefs: "atestarea mediului", workspaceScope: "ruta proiectului",
      limits: "limitele", modeTransition: "modul Hub-ului", models: "modelele", effortPolicy: "efortul", autonomyLevel: "nivelul de autonomie" };
    const out = keys.filter((k) => hashCanonical(before?.[k] ?? null) !== hashCanonical(after?.[k] ?? null)).map((k) => labels[k]);
    return out.length ? out : ["conținutul planului"];
  }

  // ---------- CapabilityIssuer ----------
  /** The grants one mission of the envelope needs, each no wider than the envelope. */
  function deriveGrants(env, missionId) {
    const entry = env.body.missions.find((m) => m.missionId === missionId);
    if (!entry) throw new HubError("policy", "Misiunea nu face parte din plan");
    const cycles = 1 + (env.body.limits.maxRepairCycles?.[missionId] ?? 0);
    const attempts = Math.min(ENVELOPE_LIMITS.grantMaxAttempts, cycles * entry.limits.maxAttemptsPerStage);
    const remainingMin = Math.floor((Date.parse(env.expiresAt) - now().getTime()) / 60000);
    if (remainingMin < 5) throw new HubError("gate", "Autoritatea planului a expirat");
    const ttlMinutes = Math.min(480, remainingMin);
    const maxDurationS = Math.min(7200, Math.max(60, entry.limits.maxDurationMin * 60));
    return [
      { role: "writer", provider: entry.routes.writer.provider, access: entry.routes.writer.access, maxAttempts: attempts, ttlMinutes, maxDurationS },
      { role: "reviewer", provider: entry.routes.reviewer.provider, access: entry.routes.reviewer.access, maxAttempts: attempts, ttlMinutes, maxDurationS },
    ];
  }

  /** Refuses any derived grant that would exceed the envelope (provider, access, project, attempts, duration, expiry). */
  function assertWithin(env, spec, { projectId }) {
    const problems = [];
    if (projectId !== env.projectId) problems.push("alt proiect");
    if (!env.body.providers.includes(spec.provider)) problems.push(`provider ${spec.provider} în afara planului`);
    const role = spec.role === "writer" ? "writer" : spec.role === "reviewer" ? "reviewer" : null;
    if (!role || !env.body.allowedRoles.includes(role)) problems.push(`rol ${spec.role} în afara planului`);
    if (role === "reviewer" && spec.access !== "read-only") problems.push("reviewer-ul poate doar citi");
    if (role === "writer" && !["workspace-write", "read-only"].includes(spec.access)) problems.push("acces necunoscut");
    if (!(spec.maxAttempts >= 1 && spec.maxAttempts <= ENVELOPE_LIMITS.grantMaxAttempts)) problems.push("încercări peste limită");
    const missionMax = Math.max(...env.body.missions.map((m) => (1 + (env.body.limits.maxRepairCycles?.[m.missionId] ?? 0)) * m.limits.maxAttemptsPerStage));
    if (spec.maxAttempts > missionMax) problems.push("încercări peste plan");
    if (spec.maxDurationS > env.body.limits.maxDurationMin * 60) problems.push("durată peste plan");
    if (now().getTime() + spec.ttlMinutes * 60000 > Date.parse(env.expiresAt) + 1000) problems.push("expiră după plan");
    if (problems.length) throw new HubError("policy", `Grant derivat refuzat (mai larg decât planul): ${problems.join(", ")}`);
    return true;
  }

  function issueGrants(env, missionId) {
    const specs = deriveGrants(env, missionId);
    const issued = bus.transaction(() => specs.map((spec) => {
      assertWithin(env, spec, { projectId: env.projectId });
      const g = grants.create({ provider: spec.provider, projectId: env.projectId, access: spec.access, maxAttempts: spec.maxAttempts, maxDurationS: spec.maxDurationS,
        ttlMinutes: Math.max(5, spec.ttlMinutes), expiresAt: env.expiresAt, envelopeId: env.id, note: `Derivat din planul ${env.id} (${spec.role}, misiunea ${missionId})` }, `envelope:${env.id}`);
      return { grantId: g.id, role: spec.role, provider: g.provider, access: g.access, maxAttempts: g.maxAttempts, expiresAt: g.expiresAt };
    }));
    bus.transaction(() => {
      const derived = get(env.id).derived || {};
      db.prepare("UPDATE mission_envelopes SET derived_json = ?, updated_at = ? WHERE id = ?").run(json({ ...derived, grants: [...(derived.grants || []), ...issued.map((g) => ({ ...g, missionId }))] }), iso(), env.id);
      bus.append({ type: "envelope.grants_derived", scopeType: "envelope", scopeId: env.id, projectId: env.projectId, source: "envelopes", payload: { missionId, grants: issued.map((g) => ({ id: g.grantId, role: g.role, provider: g.provider, access: g.access, attempts: g.maxAttempts })) } });
    });
    return issued;
  }

  /** Starts one mission of a confirmed envelope through the ordinary factory.start command and its exact scope approval. */
  /** The keys of an objective task's dependencies that are not delivered yet (empty for a plan without an objective). */
  function objectiveDepsMissing(env, missionId) {
    if (!env.body.objective?.id) return [];
    const ref = objectiveRefFor(env.body.objective.id, env.projectId, env.missionIds);
    const task = ref.tasks.find((t) => t.missionId === missionId);
    const stageOf = (mid) => (mid ? factory.view(mid)?.factory.stage || null : null);
    return (task?.dependsOn || []).filter((k) => !["DELIVERY_READY", "ACCEPTED"].includes(stageOf(ref.tasks.find((t) => t.key === k)?.missionId)));
  }

  async function startMission(env, missionId, session) {
    const v = factory.view(missionId);
    const entry = env.body.missions.find((m) => m.missionId === missionId);
    if (!v?.scope || hashCanonical(v.scope) !== entry?.scopeHash) throw new HubError("conflict", `Scope-ul misiunii „${entry?.title || missionId}” s-a schimbat după confirmare`);
    // An objective task starts only when what it depends on is delivered — the first task at confirmation as well as the next ones.
    const missing = objectiveDepsMissing(env, missionId);
    if (missing.length) throw new HubError("conflict", `Sarcina depinde de ${missing.join(", ")}, care nu e livrată`);
    // The plan may have been closed (Stop All, a rejected earlier task, a revoke) while we waited: never start under a closed plan.
    const stillCurrent = () => { const now_ = get(env.id); return Boolean(now_ && OPEN.has(now_.status) && (!now_.currentMissionId || now_.currentMissionId === missionId)); };
    if (!stillCurrent()) throw new HubError("conflict", "Planul s-a închis între timp; misiunea nu mai pornește");
    issueGrants(env, missionId);
    const requested = await commands.dispatch({ type: "factory.start", payload: v.scope, channel: "owner", actor: `owner:${session.id}`, ownerSession: { id: session.id },
      correlationId: env.id, intentText: `Plan ${env.id}`, idempotencyKey: `envelope:${env.id}:${missionId}` });
    if (requested.approvalRequired && !stillCurrent()) throw new HubError("conflict", "Planul s-a închis între timp; misiunea nu mai pornește (aprobarea rămâne nefolosită)");
    if (requested.approvalRequired) {
      const approval = requested.approval;
      // The approval must be exactly the envelope's scope for this mission (recomputed, not trusted).
      const expected = approvalHash({ actionKind: "factory.scope", target: `${missionId}:v${entry.specVersion}`, payload: v.scope, codeVersion: "hub",
        permissionTier: catalogEntry("factory.scope").tier, scopeType: approval.scopeType, scopeId: approval.scopeId });
      bus.transaction(() => approvals.decideByEnvelope(approval.id, { envelopeId: env.id, sessionId: session.id, expectedHash: expected }));
      const started = await commands.executeApproved(requested.command.id, `owner:${session.id}`);
      bus.emit({ type: "envelope.mission_started", scopeType: "envelope", scopeId: env.id, projectId: env.projectId, source: "envelopes", payload: { missionId, approvalId: approval.id, stage: started.result?.factory?.stage || null } });
      return started.result;
    }
    if (requested.duplicate) return requested.result;
    bus.emit({ type: "envelope.mission_started", scopeType: "envelope", scopeId: env.id, projectId: env.projectId, source: "envelopes", payload: { missionId, approvalId: null } });
    return requested.result;
  }

  // ---------- authority hook used by the factory before every model step ----------
  /** Returns null (allowed) or { reason } (the step waits for the owner). Only missions under an envelope are affected. */
  function authorityFor(missionId, { stage, cycle }) {
    const env = envelopeOfMission(missionId);
    if (!env) return null;
    if (new Date(env.expiresAt) <= now()) return { reason: "Autoritatea planului a expirat; confirmă un plan nou ca să continui" };
    if (env.status === "WAITING_OWNER" && env.derived?.hold) return { reason: env.derived.hold };
    const allowed = env.body.limits.maxRepairCycles?.[missionId] ?? 0;
    const extra = (env.derived?.extraCycles || {})[missionId] || 0;
    if (stage === "REPAIRING" && cycle > allowed + extra) return { reason: env.autonomyLevel === "ASSISTED" ? `Remedierea (ciclul ${cycle}) cere confirmarea ta: nivelul proiectului e ASSISTED` : `Ciclul ${cycle} depășește planul confirmat (${allowed}); confirmă un ciclu în plus` };
    return null;
  }

  /** A confirmed delta (one more repair cycle) inside the same envelope; only the difference is presented to the owner. */
  function confirmDelta({ envelopeId, missionId, session, modality = "click" }) {
    if (!trust.policy().active) throw new HubError("policy", "Politica voice-first nu este activă");
    const s = trust.requireSession(session, "confirmarea unei remedieri");
    const env = get(envelopeId);
    if (!env || !OPEN.has(env.status)) throw new HubError("conflict", "Planul nu mai este în vigoare");
    if (!env.missionIds.includes(missionId)) throw new HubError("policy", "Misiunea nu face parte din plan");
    const extra = { ...(env.derived?.extraCycles || {}) };
    const total = (env.body.limits.maxRepairCycles?.[missionId] ?? 0) + (extra[missionId] || 0);
    const entry = env.body.missions.find((m) => m.missionId === missionId);
    // Inside the mission's own approved limit only; a cycle beyond it is the factory's "extra cycle" decision (Resume).
    if (total + 1 > entry.limits.maxRepairCycles) throw new HubError("policy", `Misiunea permite cel mult ${entry.limits.maxRepairCycles} cicluri; un ciclu în plus e decizia ta de „Reia cu ciclu suplimentar”`);
    extra[missionId] = (extra[missionId] || 0) + 1;
    bus.transaction(() => {
      db.prepare("UPDATE mission_envelopes SET derived_json = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(json({ ...env.derived, extraCycles: extra, hold: null }), iso(), env.id);
      bus.append({ type: "envelope.delta_confirmed", scopeType: "envelope", scopeId: env.id, projectId: env.projectId, source: "owner", payload: { missionId, extraCycles: extra[missionId], session: s.id, modality, channel: "owner_session" } });
      if (env.status === "WAITING_OWNER") setStatus(env.id, "ACTIVE", { reason: "Remediere confirmată", from: ["WAITING_OWNER"] });
    });
    // The repair needs writer/reviewer attempts beyond the first grants: a top-up, still inside the envelope.
    const live = grants.ofEnvelope(env.id).filter((g) => g.status === "active");
    if (!live.some((g) => g.provider === "codex") || !live.some((g) => g.provider === "claude")) issueGrants(get(env.id), missionId);
    return view(env.id);
  }

  // ---------- lifecycle ----------
  function close(id, status, reason) {
    const env = get(id);
    if (!env) return null;
    bus.transaction(() => {
      setStatus(id, status, { reason });
      for (const g of grants.ofEnvelope(id).filter((x) => x.status === "active")) grants.revoke(g.id, `envelope:${id}`);
    });
    releaseMode(id);
    return view(id);
  }

  /*
   * The mode hold (settings.envelopeModeHold). A plan confirmed in BUILD_SAFE moves the Hub to LIVE_VALIDATION; that mode then
   * belongs to the open plans as a group (the hold names one of them) and returns to BUILD_SAFE when the LAST open plan closes,
   * whichever it is (M07 review: with two open plans the holder could close first and the Hub stayed in LIVE_VALIDATION).
   * - A manual mode change (UI, agent) drops the hold: the owner owns the mode again and nothing switches it back later.
   * - A boot's reset to BUILD_SAFE only SUSPENDS it (suspendedByBoot): an explicit resume of a mission of an open, unexpired plan
   *   may restore exactly the LIVE_VALIDATION the plans held before the restart — only for a plan that held it, never after the
   *   owner chose a mode by hand (mode.set clears the hold in the same transaction), never under the legacy policy.
   * - holders: the plans that entered LIVE_VALIDATION or were confirmed while the plans held it. Only they keep it alive.
   * Every write here uses source "envelopes", which the listener below never reads as a manual change.
   */
  function restoreModeHold(missionId, actor = "owner") {
    const env = envelopeOfMission(missionId);
    if (!env || !OPEN.has(env.status) || new Date(env.expiresAt) <= now() || !trust.policy().active) return null;
    const hold = settings.get("envelopeModeHold") || {};
    if (settings.get("mode") === "LIVE_VALIDATION" && hold.envelopeId && holdersOf(hold.suspended).includes(env.id)) {
      // LIVE is held by a newer plan; this plan held it before the boot and is now explicitly resumed: it holds it again too.
      const rest = holdersOf(hold.suspended).filter((id) => id !== env.id);
      const { suspended: _drop, ...active } = hold;
      const next = { ...active, holders: [...new Set([...holdersOf(hold), env.id])], ...(rest.length ? { suspended: { ...hold.suspended, holders: rest, envelopeId: rest.includes(hold.suspended.envelopeId) ? hold.suspended.envelopeId : rest[0] } } : {}) };
      bus.transaction(() => settings.set("envelopeModeHold", next, "envelopes", `Plan ${env.id} rejoins the mode hold on resume (${actor})`));
      return { envelopeId: env.id, mode: "LIVE_VALIDATION", joined: true, previous: hold, written: next };
    }
    if (!hold.envelopeId || !hold.suspendedByBoot || settings.get("mode") === "LIVE_VALIDATION" || !holdersOf(hold).includes(env.id)) return null;
    const open = openEnvelopeIds();
    bus.transaction(() => {
      settings.set("mode", "LIVE_VALIDATION", "envelopes", `Envelope ${env.id}: reluare (${actor}), LIVE_VALIDATION ca înainte de repornire`);
      settings.set("envelopeModeHold", { envelopeId: env.id, holders: holdersOf(hold).filter((id) => open.includes(id)), since: iso(), restored: true, by: actor }, "envelopes", "Mode hold restored on resume");
    });
    return { envelopeId: env.id, mode: "LIVE_VALIDATION", previous: hold, written: settings.get("envelopeModeHold") };
  }

  /** The resume that restoreModeHold preceded was refused: back to BUILD_SAFE with the hold suspended as it was (nothing resumed). */
  function undoRestore(restored) {
    if (!restored) return;
    const hold = settings.get("envelopeModeHold") || {};
    if (JSON.stringify(hold) !== JSON.stringify(restored.written || {})) return; // something wrote the hold since: leave it
    bus.transaction(() => {
      if (!restored.joined && settings.get("mode") === "LIVE_VALIDATION") settings.set("mode", "BUILD_SAFE", "envelopes", "Reluarea a fost refuzată: înapoi la BUILD_SAFE");
      settings.set("envelopeModeHold", restored.previous, "envelopes", restored.joined ? "Plan left the hold again (resume refused)" : "Mode hold suspended again (resume refused)");
    });
  }

  function releaseMode(id) {
    const hold = settings.get("envelopeModeHold") || {};
    if (!hold.envelopeId) return; // the mode is not the plans' (never entered, or the owner changed it by hand)
    const open = openEnvelopeIds();
    const remaining = holdersOf(hold).filter((h) => open.includes(h));
    if (remaining.length) {
      // Another plan that holds the mode is still in force: the hold passes to it, so the last holder to close releases the mode.
      if (!open.includes(hold.envelopeId) || remaining.length !== holdersOf(hold).length) {
        bus.transaction(() => settings.set("envelopeModeHold", { ...hold, envelopeId: remaining.includes(hold.envelopeId) ? hold.envelopeId : remaining[0], holders: remaining, since: iso(), handedOverFrom: hold.envelopeId }, "envelopes", `Mode hold after ${id} closed`));
      }
      return;
    }
    const back = holdersOf(hold.suspended).filter((h) => open.includes(h));
    bus.transaction(() => {
      settings.set("envelopeModeHold", back.length ? { ...hold.suspended, holders: back, envelopeId: back.includes(hold.suspended.envelopeId) ? hold.suspended.envelopeId : back[0] } : {}, "envelopes", back.length ? "Mode hold back to the plans a boot suspended" : "Mode hold released");
      if (settings.get("mode") === "LIVE_VALIDATION") settings.set("mode", "BUILD_SAFE", "envelopes", `Planul ${id} s-a încheiat: revin la BUILD_SAFE`);
    });
  }

  /** Fail-safe from any channel: the derived grants are revoked, so no new model step can start under this envelope. */
  function revoke(id, { actor = "owner", reason = "Revocat" } = {}) {
    const env = get(id);
    if (!env) throw new HubError("not_found", "Plan necunoscut");
    if (env.status === "PROPOSED") { bus.transaction(() => setStatus(id, "CANCELLED", { reason, from: ["PROPOSED"] })); return view(id); }
    if (!OPEN.has(env.status)) return view(id);
    bus.emit({ type: "envelope.revoked", scopeType: "envelope", scopeId: id, projectId: env.projectId, source: actor, payload: { reason: String(reason).slice(0, 200) } });
    return close(id, "REVOKED", reason);
  }

  async function advance(env, missionId, stage) {
    if (!env || !OPEN.has(env.status)) return;
    if (env.currentMissionId !== missionId) {
      // An EARLIER task of an objective was rejected or cancelled (e.g. the owner rejects t1's bundle while t2 runs). If the running
      // task depends on it (directly or through another task), the plan closes FIRST (authority revoked), then that task is paused.
      // A later task, or an independent mission of a plain multi-mission plan, leaves the running work alone; a later dependent task
      // simply never starts (startMission checks its dependencies). Review M08 rounds 1–2.
      if (!["CANCELLED", "REJECTED"].includes(stage) || !env.body.objective?.id) return;
      const ids = env.missionIds;
      if (!ids.includes(missionId) || ids.indexOf(missionId) >= ids.indexOf(env.currentMissionId)) return;
      let dependsOnIt = false;
      try {
        const ref = objectiveRefFor(env.body.objective.id, env.projectId, ids);
        const keyOf = (mid) => ref.tasks.find((t) => t.missionId === mid)?.key;
        const deps = new Map(ref.tasks.map((t) => [t.key, t.dependsOn || []]));
        const reaches = (from, target, seen = new Set()) => (deps.get(from) || []).some((k) => k === target || (!seen.has(k) && (seen.add(k), reaches(k, target, seen))));
        dependsOnIt = reaches(keyOf(env.currentMissionId), keyOf(missionId));
      } catch { dependsOnIt = true; } // the objective is no longer current: stop rather than continue
      if (!dependsOnIt) return;
      const current = env.currentMissionId;
      const closed = close(env.id, "CANCELLED", `O sarcină anterioară a planului s-a încheiat (${stage}); sarcina care depinde de ea nu continuă`);
      try { if (current) await factory.pause(current, { actor: "envelopes" }); } catch { /* not running yet, or already settled */ }
      return closed;
    }
    if (stage === "DELIVERY_READY") {
      const index = env.missionIds.indexOf(missionId);
      const next = env.missionIds[index + 1];
      if (next && env.body.continuationPolicy.nextMissionWithoutConfirmation) {
        if (new Date(env.expiresAt) <= now()) return close(env.id, "EXPIRED", "Timpul planului s-a terminat înaintea misiunii următoare");
        const session = env.ownerSessionId ? { id: env.ownerSessionId } : null;
        // An objective's next task starts only while the objective is still the confirmed one and its dependencies are delivered.
        if (env.body.objective?.id) {
          let hold = null;
          try {
            const missing = objectiveDepsMissing(env, next);
            if (missing.length) hold = `Sarcina următoare depinde de ${missing.join(", ")}, care nu e livrată`;
          } catch (error) { hold = error.message; }
          if (hold) {
            // No automatic continuation is possible from here: the spent task's grants are revoked with the hold (review M08 round 2).
            bus.transaction(() => {
              for (const g of grants.ofEnvelope(env.id).filter((x) => x.status === "active")) grants.revoke(g.id, `envelope:${env.id}`);
              db.prepare("UPDATE mission_envelopes SET derived_json = ? WHERE id = ?").run(json({ ...get(env.id).derived, hold: `Nu pornesc sarcina următoare: ${String(hold).slice(0, 200)}` }), env.id);
              setStatus(env.id, "WAITING_OWNER", { reason: `Nu pornesc sarcina următoare: ${String(hold).slice(0, 200)}`, from: ["ACTIVE", "CONFIRMED"] });
            });
            return;
          }
        }
        try {
          // The next mission's scope must still be the one confirmed; its grants are derived now (the earlier ones are spent).
          for (const g of grants.ofEnvelope(env.id).filter((x) => x.status === "active")) bus.transaction(() => grants.revoke(g.id, `envelope:${env.id}`));
          bus.transaction(() => db.prepare("UPDATE mission_envelopes SET current_mission_id = ?, updated_at = ? WHERE id = ?").run(next, iso(), env.id));
          await startMission(get(env.id), next, session);
        } catch (error) {
          bus.transaction(() => {
            db.prepare("UPDATE mission_envelopes SET derived_json = ? WHERE id = ?").run(json({ ...get(env.id).derived, hold: `Misiunea următoare nu a pornit: ${String(error.message).slice(0, 200)}` }), env.id);
            setStatus(env.id, "WAITING_OWNER", { reason: `Misiunea următoare nu a pornit: ${String(error.message).slice(0, 200)}`, from: ["ACTIVE", "CONFIRMED"] });
          });
        }
        return;
      }
      return close(env.id, "COMPLETED", "Gata de verificarea ta (DELIVERY_READY); nimic nu e acceptat sau livrat automat");
    }
    if (["NEEDS_OWNER_DECISION", "BLOCKED", "PAUSED"].includes(stage)) {
      bus.transaction(() => setStatus(env.id, "WAITING_OWNER", { reason: `Misiunea așteaptă: ${stage}`, from: ["ACTIVE", "CONFIRMED"] }));
      return;
    }
    if (["CANCELLED", "REJECTED"].includes(stage)) return close(env.id, "CANCELLED", `Misiunea s-a încheiat: ${stage}`);
    if (stage === "ACCEPTED") return close(env.id, "COMPLETED", "Acceptat de tine");
    if (["BASELINE", "IMPLEMENTING", "CHECKING", "REVIEWING", "REPAIRING", "QA", "PREVIEW"].includes(stage) && env.status === "WAITING_OWNER") {
      bus.transaction(() => setStatus(env.id, "ACTIVE", { reason: `Misiunea a reluat (${stage})`, from: ["WAITING_OWNER"] }));
    }
  }

  // Post-commit reactions: factory stages move the envelope; Stop All / revoke-all end it. Deferred so they never run inside
  // the factory's own transaction or serialized step.
  let stopped = false;
  const later = (fn) => setImmediate(() => { if (stopped) return; Promise.resolve().then(fn).catch(() => { /* reported by the next tick or a refused step */ }); });
  bus.subscribe((event) => {
    if (stopped) return;
    try {
      if (event.type === "factory.stage" && event.scopeType === "mission") {
        const env = envelopeOfMission(event.scopeId);
        if (env) later(() => advance(get(env.id), event.scopeId, event.payload?.stage));
      }
      if (event.type === "grant.revoked_all" || event.type === "system.stop_all") {
        later(() => { for (const row of db.prepare("SELECT id FROM mission_envelopes WHERE status IN ('CONFIRMED','ACTIVE','WAITING_OWNER')").all()) close(row.id, "REVOKED", "Stop All"); });
      }
      if (event.type === "settings.changed" && event.payload?.key === "mode" && event.source !== "envelopes" && event.source !== "owner") {
        // A boot's reset only suspends the hold (an explicit resume may restore it); any other change is the owner's: the plans no
        // longer own the mode and nothing switches it back later. Compare-and-set: a hold written in the meantime (a restore, a
        // new confirmation) is never erased by this deferred write.
        const hold = settings.get("envelopeModeHold") || {};
        if (hold.envelopeId) {
          const seen = JSON.stringify(hold);
          const boot = event.source === "recovery";
          later(() => bus.transaction(() => {
            if (JSON.stringify(settings.get("envelopeModeHold") || {}) !== seen) return;
            const { suspended: nested, ...top } = hold;
            settings.set("envelopeModeHold", boot ? { ...top, holders: [...new Set([...holdersOf(top), ...holdersOf(nested)])], suspendedByBoot: true, suspendedAt: iso() } : {}, "envelopes", boot ? "Mode hold suspended by the boot" : "Mode changed by the owner");
          }));
        }
      }
    } catch { /* a listener never breaks the writer */ }
  });

  /** Housekeeping: previews past their confirm-by time expire; authorities past their end are closed (grants revoked). */
  function tick() {
    const t = iso();
    for (const row of db.prepare("SELECT id FROM mission_envelopes WHERE status = 'PROPOSED' AND confirm_by <= ?").all(t)) bus.transaction(() => setStatus(row.id, "EXPIRED", { reason: "Nu a fost confirmat la timp", from: ["PROPOSED"] }));
    for (const row of db.prepare("SELECT id FROM mission_envelopes WHERE status IN ('CONFIRMED','ACTIVE','WAITING_OWNER') AND expires_at <= ?").all(t)) close(row.id, "EXPIRED", "Timpul autorizat s-a terminat; pașii noi nu mai pornesc");
  }

  function view(id) {
    const env = get(id);
    if (!env) return null;
    return { ...env, derivedGrants: grants.ofEnvelope(env.id).map((g) => ({ id: g.id, provider: g.provider, access: g.access, status: g.status, attemptsUsed: g.attemptsUsed, maxAttempts: g.maxAttempts, expiresAt: g.expiresAt })),
      awaitingConfirmation: env.status === "PROPOSED" && new Date(env.confirmBy) > now() };
  }

  return { propose, confirm, confirmDelta, revoke, view, get, forProject, openFor, pending, autonomyOf, setAutonomy, readiness, deriveGrants, assertWithin, authorityFor, tick, envelopeOfMission, restoreModeHold, undoRestore, armConfirmation, disarm, armedFor, confirmFromArmed,
    close: () => { stopped = true; } };
}
