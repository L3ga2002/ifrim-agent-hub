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

export function createEnvelopes({ db, bus, clock, settings, projects, missions, grants, gate, approvals, commands, trust, factory, factoryRunner, environments, config }) {
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
  const envelopeOfMission = (missionId) => db.prepare("SELECT * FROM mission_envelopes WHERE status IN ('CONFIRMED','ACTIVE','WAITING_OWNER') AND mission_ids_json LIKE ?").all(`%"${missionId}"%`).map(rowTo)[0] || null;

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
    if (!raising) { const open = openFor(project.id); if (open && LEVEL_RANK[open.autonomyLevel] > LEVEL_RANK[level]) revoke(open.id, { actor, reason: `Autonomie coborâtă la ${level}` }); }
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
    const att = service?.attestationStatus ? service.attestationStatus(now()) : null;
    return [{ environment: route, attestationId: att?.attestation?.id || att?.id || null, fingerprintHash: att?.attestation?.fingerprintHash || att?.fingerprintHash || null, status: att?.status || att?.attestation?.status || "unknown" }];
  }

  /** The envelope content (hashed): everything the confirmation covers. Time, nonce and ids are metadata, not content. */
  async function buildBody(project, views, level, constraints = {}) {
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
      continuationPolicy: { afterPanelClosed: true, repairsWithoutConfirmation: level !== "ASSISTED", nextMissionWithoutConfirmation: level === "HIGH_AUTONOMY_BOUNDED", stopAt: "DELIVERY_READY (nu accept și nu livrez singur)" },
      modeTransition: settings.get("mode") === "BUILD_SAFE" ? "BUILD_SAFE→LIVE_VALIDATION până la sfârșitul misiunilor" : null,
    };
    return body;
  }

  function summaryOf(body, readinessInfo) {
    const m = body.missions;
    const repairs = Object.values(body.limits.maxRepairCycles);
    return {
      headline: m.length === 1 ? `„${m[0].title}” pe ${body.projectName}` : `${m.length} misiuni pe ${body.projectName}, una după alta`,
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
  async function propose({ projectId, missionIds = [], level = null, constraints = {}, actor = "owner", via = "ui" }) {
    const project = projects.get(projectId);
    if (!project) throw new HubError("not_found", "Proiect necunoscut");
    const autonomy = level && AUTONOMY_LEVELS.includes(level) ? level : autonomyOf(project.id).level;
    let ids = [...new Set((missionIds || []).filter(Boolean))];
    if (!ids.length) {
      ids = factory.list().filter((f) => f.projectId === project.id && f.stage === "SPEC_DRAFT").map((f) => f.missionId);
      ids = autonomy === "HIGH_AUTONOMY_BOUNDED" ? ids.slice(0, ENVELOPE_LIMITS.maxMissions) : ids.slice(0, 1);
    }
    if (!ids.length) throw new HubError("validation", `Nu există o misiune Software Factory pregătită pe ${project.name}; descrie ce vrei și pregătesc specificația`);
    if (ids.length > 1 && autonomy !== "HIGH_AUTONOMY_BOUNDED") throw new HubError("policy", "Mai multe misiuni într-un singur plan cer nivelul HIGH_AUTONOMY_BOUNDED");
    if (ids.length > ENVELOPE_LIMITS.maxMissions) throw new HubError("validation", `Cel mult ${ENVELOPE_LIMITS.maxMissions} misiuni într-un plan`);
    const views = ids.map((id) => { const v = factory.view(id); if (!v) throw new HubError("not_found", `Misiunea ${id} nu e o misiune Software Factory`); if (v.project?.id !== project.id) throw new HubError("policy", "O misiune din alt proiect nu intră în acest plan"); return v; });
    const ready = readiness(project, views);
    if (views.some((v) => !v.scope)) {
      return { envelope: null, readiness: ready, summary: { headline: views[0].mission.title, blockers: ready.blockers.map((b) => b.detail), state: "PLAN_INCOMPLETE" } };
    }
    const body = await buildBody(project, views, autonomy, constraints);
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

  // ---------- confirm ----------
  /**
   * The owner's one confirmation. `modality`: "click" | "keyboard" | "typed" | "voice". Voice counts only with local
   * verification evidence (speaker gate + local transcription); a provider transcript or an LLM's claim never does.
   */
  async function confirm({ envelopeId, nonce, displayedHash, session, modality = "click", voice = null, idempotencyKey = null }) {
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
    if (env.autonomyLevel === "HIGH_AUTONOMY_BOUNDED") trust.requireFresh(s, "confirmarea unui plan cu autonomie mare");
    if (!["click", "keyboard", "typed", "voice"].includes(modality)) throw new HubError("validation", "Modalitate necunoscută");
    if (modality === "voice") {
      const ok = voice && voice.verifiedLocally === true && voice.speaker === "MATCH" && voice.transcriptSource === "local" && (voice.fixture ? config.testMode : true);
      if (!ok) throw new HubError("policy", "Confirmarea vocală are nevoie de verificarea locală a vorbitorului ȘI de transcrierea locală a frazei; pe această rută lipsește, deci confirmă cu tasta sau butonul din cockpit");
    }
    // Nothing may have changed since the owner saw it.
    const project = projects.get(env.projectId);
    const views = env.missionIds.map((id) => factory.view(id));
    if (views.some((v) => !v?.scope)) { bus.transaction(() => setStatus(env.id, "SUPERSEDED", { reason: "O misiune nu mai are un scope complet", from: ["PROPOSED"] })); throw new HubError("conflict", "Planul nu mai e valabil: o misiune s-a schimbat"); }
    const body = await buildBody(project, views, env.autonomyLevel, Object.fromEntries((env.body.ownerConstraints || []).map((k) => [k, true])));
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
      confirmedAt: iso(), idempotencyKey: idempotencyKey ? String(idempotencyKey).slice(0, 120) : null, voice: modality === "voice" ? { speaker: voice.speaker, transcriptSource: voice.transcriptSource, fixture: Boolean(voice.fixture) } : null };
    // Atomic, consumable: a second tab, a double "yes" or a reconnect finds it no longer PROPOSED (and the unique index refuses
    // a second open authority on the same project).
    try {
      const changed = bus.transaction(() => {
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
    try {
      if (body.modeTransition && settings.get("mode") === "BUILD_SAFE") {
        bus.transaction(() => {
          settings.set("mode", "LIVE_VALIDATION", "owner", `Envelope ${env.id}: LIVE_VALIDATION pe durata misiunii`);
          settings.set("envelopeModeHold", { envelopeId: env.id, since: iso() }, "owner", "Mode held by an envelope");
        });
      }
      await startMission(env, env.missionIds[0], s);
      bus.transaction(() => setStatus(env.id, "ACTIVE", { reason: "Prima misiune a pornit", from: ["CONFIRMED"], extra: { current_mission_id: env.missionIds[0] } }));
    } catch (error) {
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
  async function startMission(env, missionId, session) {
    const v = factory.view(missionId);
    const entry = env.body.missions.find((m) => m.missionId === missionId);
    if (!v?.scope || hashCanonical(v.scope) !== entry?.scopeHash) throw new HubError("conflict", `Scope-ul misiunii „${entry?.title || missionId}” s-a schimbat după confirmare`);
    issueGrants(env, missionId);
    const requested = await commands.dispatch({ type: "factory.start", payload: v.scope, channel: "owner", actor: `owner:${session.id}`, ownerSession: { id: session.id },
      correlationId: env.id, intentText: `Plan ${env.id}`, idempotencyKey: `envelope:${env.id}:${missionId}` });
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

  function releaseMode(id) {
    const hold = settings.get("envelopeModeHold") || {};
    if (hold.envelopeId !== id) return;
    const stillOpen = db.prepare("SELECT COUNT(*) AS n FROM mission_envelopes WHERE status IN ('CONFIRMED','ACTIVE','WAITING_OWNER')").get().n;
    bus.transaction(() => {
      settings.set("envelopeModeHold", {}, "envelopes", "Mode hold released");
      if (!stillOpen && settings.get("mode") === "LIVE_VALIDATION") settings.set("mode", "BUILD_SAFE", "envelopes", `Planul ${id} s-a încheiat: revin la BUILD_SAFE`);
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
    if (!env || !OPEN.has(env.status) || env.currentMissionId !== missionId) return;
    if (stage === "DELIVERY_READY") {
      const index = env.missionIds.indexOf(missionId);
      const next = env.missionIds[index + 1];
      if (next && env.body.continuationPolicy.nextMissionWithoutConfirmation) {
        if (new Date(env.expiresAt) <= now()) return close(env.id, "EXPIRED", "Timpul planului s-a terminat înaintea misiunii următoare");
        const session = env.ownerSessionId ? { id: env.ownerSessionId } : null;
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
        // The owner changed the mode by hand: the envelope no longer owns it (it will not switch it back later).
        const hold = settings.get("envelopeModeHold") || {};
        if (hold.envelopeId) later(() => bus.transaction(() => settings.set("envelopeModeHold", {}, "envelopes", "Mode changed by the owner")));
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

  return { propose, confirm, confirmDelta, revoke, view, get, forProject, openFor, pending, autonomyOf, setAutonomy, readiness, deriveGrants, assertWithin, authorityFor, tick, envelopeOfMission,
    close: () => { stopped = true; } };
}
