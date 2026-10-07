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
import { bindingLabel, grantBindingOf, resolveBinding } from "../policy/model-binding.mjs";
import { runEnvelopeIdOf, runScopeKey } from "../domain/grants.mjs";
import { redactText } from "../security/redact.mjs";
import { createArmedWindows } from "./armed-window.mjs";
import { profileTurnTimeouts, turnTimeoutsOf } from "../factory/plan.mjs";
import { STAGE_ZERO, ROLE_OF_STAGE } from "../factory/factory.mjs";
import { testFirstScope, T_CARD_STEP0, T_CARD_STEP0_NO_REWRITE, T_CARD_PROVES, T_STEPS_PREFIX, T_MODELS_SUFFIX, TEST_FIRST_LIMITS } from "../factory/test-first.mjs";
import { factoryStageLabel } from "../policy/factory-wait.mjs";

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
  // M10.2 (owner decision 6): an ASSISTED plan pre-authorizes the repair cycles SHOWN on its card; only a cycle beyond them asks.
  ASSISTED: "Asistat: o confirmare per misiune (include remedierile afișate în plan); un ciclu în plus îți cere confirmarea",
  TRUSTED: "De încredere: implementare, teste, review, remedieri în limită, QA și preview fără confirmări intermediare",
  HIGH_AUTONOMY_BOUNDED: "Autonomie mare, delimitată: o listă finită de misiuni eligibile, una după alta, în aceleași limite totale",
});
export const DENIED_EFFECTS = Object.freeze(["deploy", "git.commit", "git.push", "message.send", "connector.write", "publish", "billing", "auth.change",
  "isolation.change", "policy.change", "install", "data.delete", "cloud_task.start", "other_projects", "owner.accept"]);
const ENVELOPE_STATUSES = Object.freeze(["PROPOSED", "CONFIRMED", "ACTIVE", "WAITING_OWNER", "COMPLETED", "EXPIRED", "REVOKED", "SUPERSEDED", "FAILED_TO_START", "CANCELLED"]);
const OPEN = new Set(["CONFIRMED", "ACTIVE", "WAITING_OWNER"]);
// M10.2 (U11): a plan's grants are topped up inside its attempt budget (each grant still ≤ 5); a delta adds at most this many extra
// repair cycles / attempts per mission per plan, each one a separate confirmation of exactly that difference in the owner session.
// maxForgivenAttempts (review #11): interrupted plan steps whose grant attempt is given back, per mission and role per plan.
export const ENVELOPE_LIMITS = Object.freeze({ confirmWindowMin: 15, slackMin: 30, maxMissions: 5, grantMaxAttempts: 5, maxDeltaCycles: 2, maxDeltaAttempts: 3, maxForgivenAttempts: 3 });
/** Factory stages a started mission can be continued from under a new plan (M10.2 continuation). */
const CONTINUABLE = new Set(["PAUSED", "BLOCKED", "NEEDS_OWNER_DECISION"]);
/**
 * Factory stages in which a revoked or expired plan pauses its mission (the runner and model steps in flight). M11 L5 (§6): step 0 too —
 * the test's author, its proof runs and its review stop like any other step of the plan.
 */
const PAUSABLE = new Set(["TEST_AUTHORING", "TEST_PROVING", "TEST_REVIEW", "BASELINE", "IMPLEMENTING", "CHECKING", "REVIEWING", "REPAIRING", "QA", "PREVIEW"]);
/** M11 L5 (§4): the one effect a test-first plan adds to its card, hashed with the others. */
export const TEST_FIRST_EFFECT = "un singur fișier nou scris de Hub: testul de acceptanță, protejat după review";
// Gate checks an envelope resolves itself (it derives the grants, admits its own steps in BUILD_SAFE — M10.2 — or, with the
// legacy flag, enters LIVE_VALIDATION; it takes the lease and makes the backup). Exported for the blocker explainer and Lega.
export const ENVELOPE_RESOLVES = new Set(["live_grant", "mode", "workspace_lease", "backup", "operational", "concurrency"]);
/*
 * M10.2 (settings.envelopeScopedLive, default ON): a confirmed plan no longer switches the Hub to LIVE_VALIDATION. Its bound
 * steps are admitted by the plan itself (gate → liveAuthority) and the Hub stays in BUILD_SAFE, so a manual run, a shadow review,
 * Lega's run proposals or a schedule are still refused on `mode` while the plan runs. The wording is hashed (modeTransition):
 * a plan shown under the other wording is superseded at confirmation ("modul Hub-ului"). OFF = the M06–M10 behaviour (the mode
 * hold), kept as the rollback path; holds written before the upgrade are still released when their last plan closes.
 */
export const SCOPED_LIVE_TRANSITION = "doar pașii acestui plan rulează live; Hub-ul rămâne în BUILD_SAFE";
const LEGACY_TRANSITION = "BUILD_SAFE→LIVE_VALIDATION până la sfârșitul misiunilor";
/** How a changed part of a plan is named to the owner (a superseded preview, a continuation's difference). */
const CHANGE_LABELS = Object.freeze({ missions: "specificația, planul, limitele sau modelele unei misiuni", baseSnapshot: "starea repository-ului", attestationRefs: "atestarea mediului",
  workspaceScope: "ruta proiectului", limits: "limitele", modeTransition: "modul Hub-ului", models: "modelele", effortPolicy: "efortul", autonomyLevel: "nivelul de autonomie",
  run: "sarcina, providerul, accesul sau modelul execuției" });
const labelOf = (key) => CHANGE_LABELS[key];
/*
 * M10.2 (U12) run envelopes: ONE bounded model step (an analysis, a reading, at most one write turn where the route allows it) under
 * ONE confirmation, instead of the lega.run_request approval card. Same table, same consumable confirmation, same armed voice
 * window, same envelope-scoped live authority; what differs is the body (kind "run": provider, access, explicit binding, task, a new
 * conversation) and what confirming does (one bound grant, then runs.start directly — no factory, no approval row; ENVELOPE_DECIDABLE
 * stays exactly {factory.scope}). Read-only by default; workspace-write only for Codex on a hub-test project or on a route to an
 * attested environment; never on the Hub's own repository nor on a real project on the Windows route (R2 open); Claude only reads.
 */
export const RUN_ENVELOPE_LIMITS = Object.freeze({ maxDurationMin: 30, taskMin: 3, taskMax: 1000, attempts: 1 });
/**
 * 2.12.2 (P0-R3): the per-turn limit of a run plan's ONE turn, in minutes — the Software Factory role it resembles under the binding's
 * profile (default BALANCED): a read-only analysis like a reviewer (15 min), a write turn like a writer (25 min). Both inside the plan's
 * 30 minutes; hashed in body.limits.turnTimeoutMin, shown on the card and enforced by the run manager (runs.start turnTimeoutMs).
 */
export const runTurnTimeoutMin = (access, binding = null) => profileTurnTimeouts(binding?.profile)[access === "workspace-write" ? "writer" : "reviewer"];
/** The card's line for a mission plan: the per-turn limits (the largest over its missions) and the mission's own deadline. */
function turnLimitsLine(body) {
  const t = body?.limits?.turnTimeoutMin;
  if (!t || typeof t !== "object") return null;
  const durations = [...new Set((body.missions || []).map((m) => Number(m.limits?.maxDurationMin)).filter((n) => n > 0))];
  const mission = durations.length === 1 ? `${durations[0]} min` : durations.length ? `cel mult ${Math.max(...durations)} min` : "—";
  return `Limită pe tură: writer ${t.writer} min, reviewer ${t.reviewer} min; termen misiune ${mission}. O tură care depășește limita e oprită; o reiau automat doar în încercările din plan, după cel puțin un minut.`;
}
const RUN_PROVIDERS = new Set(["codex", "claude"]);
const RUN_ACCESS = new Set(["read-only", "workspace-write"]);
const RUN_END = new Set(["completed", "failed", "interrupted", "blocked"]);
const clipText = (t, n) => { const s = String(t || "").replace(/\s+/g, " ").trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
/** The binding as the plan's body carries it: the evidence timestamps are not content (a re-probe with the same facts keeps the plan). */
const bodyBinding = (b) => (b ? { ...b, resolutionEvidence: Object.fromEntries(Object.entries(b.resolutionEvidence || {}).filter(([k]) => k !== "probedAt")) } : null);

export function createEnvelopes({ db, bus, clock, settings, projects, missions, grants, gate, approvals, commands, trust, factory, factoryRunner, environments, config, voice = null,
  // M10.2 U13: the armed-window registry shared with the operation plans (hub.mjs); a standalone service gets its own (no Lega check
  // bound → every arming is refused, fail-safe).
  armedWindows = createArmedWindows({ clock, bus }) }) {
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
  /** M10.2: envelope-scoped live authority is on unless the owner explicitly turned the flag off (absent/unknown = on). */
  const scopedLive = () => settings.get("envelopeScopedLive") !== false;

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
  function setAutonomy({ projectId, level, session = null, actor = "owner", atLeast = false }) {
    if (!AUTONOMY_LEVELS.includes(level)) throw new HubError("validation", "Nivel de autonomie necunoscut");
    const project = projects.get(projectId);
    if (!project) throw new HubError("not_found", "Proiect necunoscut");
    const current = autonomyOf(project.id).level;
    // M10.2 review #42: „Ridică la …” (atLeast) only ever raises. A project already at or above the level is left exactly as it is: no
    // write, no revoke, no supersede — a stale blocker option or card must never lower a higher level and stop the work in force.
    if (atLeast === true && LEVEL_RANK[current] >= LEVEL_RANK[level]) return { projectId: project.id, level: current, previous: current, unchanged: true };
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

  // ---------- M11 L5: step 0 of a test-first mission (the Hub-written acceptance test, design .ifrim/M11_L5_DESIGN.md §4) ----------
  /** The author cycles a plan over this mission still covers: 1 + reauthorMax before the start, what remains during step 0, 0 after it. */
  const remainingAuthoringOf = (v) => {
    const a = v?.spec?.spec?.authoring;
    if (!a?.testRef) return 0;
    const fallback = 1 + (Number.isInteger(a.reauthorMax) ? a.reauthorMax : TEST_FIRST_LIMITS.reauthorMax);
    try { return typeof factory.remainingAuthoring === "function" ? factory.remainingAuthoring(v.mission.id) : fallback; } catch { return fallback; }
  };
  /** Whether step 0 is still ahead of this mission (its test not written, proven, reviewed and protected yet). */
  const stageZeroAhead = (v) => remainingAuthoringOf(v) > 0;
  /**
   * §4 „Domeniul v1” (critique B3): the Hub writes the acceptance test only on a TEST project (never ProDelivery, whatever its registration)
   * on the Windows route — on the ifrim-runner route the runner tests a copy, so "the run left no other file" would prove nothing — and,
   * review (authority #5), never where the project's own test script also runs the Hub's work area (§9; the planner's and the factory
   * start's rule too: testFirstScope). The owner's text, or null.
   */
  function testFirstScopeProblem(project) {
    const route = environments ? environments.routeFor(project.id, "codex") : "windows";
    let testScript = "";
    try { testScript = String(JSON.parse(fs.readFileSync(path.join(project.path, "package.json"), "utf8"))?.scripts?.test || ""); } catch { testScript = ""; }
    return testFirstScope({ project, route, testScript }).text;
  }
  /**
   * The plan's step 0 of a mission (hashed in its entry and, for the card, at the top of the body), or null when it has none ahead:
   * the test's path, the criteria it proves (the owner's words), who writes it and who reviews it — both read-only, under the role
   * bindings the plan already binds (the author under the reviewer's, the test review under the writer's narrowed to read-only) —,
   * one rewrite at most, two proof runs, it must fail today and is protected only after its review, and the author cycles left.
   */
  function testFirstOf(v) {
    const a = v?.spec?.spec?.authoring;
    const remaining = remainingAuthoringOf(v);
    if (!a?.testRef || !(remaining > 0)) return null;
    const ids = new Set(Array.isArray(a.criteria) ? a.criteria : []);
    const criteria = (v.spec.spec.acceptance || []).filter((c) => ids.has(c.id)).map((c) => ({ id: c.id, text: c.text }));
    const role = (b, provider) => ({ provider: b?.provider || provider, model: b?.resolvedAlias || "", effort: b?.effort || "" });
    return { testRef: a.testRef, criteria, author: role(v.scope?.bindings?.reviewer, "claude"), testReviewer: role(v.scope?.bindings?.writer, "codex"),
      reauthorMax: a.reauthorMax, proofRuns: a.proofRuns, mustFail: true, protectedAfterReview: true, remainingAuthoring: remaining };
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
    // M11 L5 (§4): a plan whose mission still has step 0 ahead also runs Codex READ-ONLY (the test's review) and only where the Hub may write
    // the test (test_first_scope: T1). Both are said on the card, never discovered at the dispatch. A check the writer already failed is
    // not listed twice.
    if (missionViews.some((v) => v && stageZeroAhead(v))) {
      for (const c of gate.evaluate({ provider: "codex", projectId: project.id, access: "read-only" }).checks) {
        if (!c.ok && !ENVELOPE_RESOLVES.has(c.id) && !blockers.some((b) => b.id === `writer:${c.id}`)) blockers.push({ id: `test_review:${c.id}`, kind: c.id === "isolation" || c.id === "host_isolation" || c.id === "environment_route" ? "isolation" : "gate", detail: `Verificarea testului (Codex, doar citire) · ${c.id}: ${c.detail}` });
      }
      const scope = testFirstScopeProblem(project);
      if (scope) blockers.push({ id: "test_first_scope", kind: "plan", code: "TEST_FIRST_SCOPE", detail: scope });
    }
    for (const v of missionViews) {
      if (!v) continue;
      // M10.2: a continuation plan (v.continuation) covers a started mission waiting in PAUSED / BLOCKED / NEEDS_OWNER_DECISION; its
      // scope is the approved one with the bindings re-resolved now (factory.continuationScope). Only a continuation may.
      if (v.continuation) {
        if (!CONTINUABLE.has(v.factory.stage)) blockers.push({ id: `mission:${v.mission.id}`, kind: "plan", detail: `„${v.mission.title}” e în etapa ${v.factory.stage}; o continuare se confirmă doar pentru o misiune oprită` });
        else if (!v.scope) blockers.push({ id: `mission:${v.mission.id}`, kind: "plan", detail: `„${v.mission.title}”: modelele nu pot fi fixate din nou (${(v.scopeProblems || []).slice(0, 3).join("; ") || "incompletă"})` });
        continue;
      }
      if (v.factory.stage !== "SPEC_DRAFT") blockers.push({ id: `mission:${v.mission.id}`, kind: "plan", detail: `„${v.mission.title}” e în etapa ${v.factory.stage}, nu poate primi un plan nou` });
      else if (!v.scope && (v.spec?.protected?.problems || []).length) blockers.push({ id: `mission:${v.mission.id}`, kind: "plan", detail: `„${v.mission.title}”: specificația are probleme (${(v.spec?.protected?.problems || []).slice(0, 3).join("; ")})` });
      // M09: a mission whose models are not fixed (or cannot be resolved now) has no scope: the plan is incomplete, never a placeholder.
      else if (!v.scope) blockers.push({ id: `mission:${v.mission.id}`, kind: "plan", detail: `„${v.mission.title}”: modelele nu sunt fixate (${(v.scopeProblems || []).slice(0, 3).join("; ") || "incompletă"})` });
    }
    return { eligible: blockers.length === 0, isTest, blockers, stageMap: map ? { route: map.route, realProjectEligible: map.realProjectEligible, stages: map.stages.map((s) => ({ stage: s.stage, label: s.label, boundary: s.boundary, where: s.where })) } : null };
  }

  // ---------- M10.2 review #1/#3/#31: plans blocked ONLY by automatic readiness ----------
  /** The readiness runner (owner/readiness-runner.mjs), late-bound: it is created after this service and attaches itself. */
  let readinessApi = null;
  function attachReadiness(api) { readinessApi = api || null; }
  // Only these readiness blockers can be cleared by the Hub's own inference-free steps: the gate's isolation / route / billing checks
  // (a stale account check, a config to re-read, an environment to inspect, probe or re-attest on the same fingerprint) and the stage
  // map those same causes make ineligible. A frozen project, a mission that started, a refused access or a missing scope never are.
  const AUTOMATIC_CHECKS = new Set(["isolation", "host_isolation", "environment_route", "billing_route"]);
  const automaticBlocker = (b) => (b.kind === "isolation" || b.kind === "gate") && AUTOMATIC_CHECKS.has(String(b.id).split(":").pop());
  /**
   * `ready` (readiness() / runReadiness()) plus { afterReadiness, preSteps }: afterReadiness is true when the plan is NOT eligible now but
   * every blocker is one of the checks above AND the server's own explanation (blockers.explain over verified state, the same the
   * planners and the readiness runner use) says every cause is automatic. Such a plan is confirmable: its ONE confirmation runs the
   * pre-steps (readiness.afterConfirmation) and starts only if readiness is then clear. Without the runner: never (fail-safe).
   */
  async function withAutomaticReadiness(project, ready, { kind = "missions", req = null } = {}) {
    if (ready.eligible || !project || !readinessApi?.automaticFor || !ready.blockers.length || !ready.blockers.every(automaticBlocker)) return { ...ready, afterReadiness: false, preSteps: [] };
    try {
      const auto = await readinessApi.automaticFor({ projectId: project.id, kind, provider: req?.provider || null, access: req?.access || null });
      return { ...ready, afterReadiness: Boolean(auto.ok), preSteps: auto.ok ? [...new Set(auto.labels)].slice(0, 4) : [], explanation: auto.explanation };
    } catch { return { ...ready, afterReadiness: false, preSteps: [] }; }
  }
  /** The card state for a readiness result: PLAN_READY_AFTER_READINESS is confirmable (DecisionCard, armable()), never disabled. */
  const stateOf = (r, refusedFirst = false) => (r.eligible ? "PLAN_READY" : r.afterReadiness ? "PLAN_READY_AFTER_READINESS"
    : refusedFirst && r.blockers.some((b) => b.kind === "refused") ? "PLAN_REFUSED" : r.blockers.some((b) => b.kind === "isolation") ? "BLOCKED_BY_ISOLATION" : "PLAN_BLOCKED");
  const CONFIRMABLE_STATES = new Set(["PLAN_READY", "PLAN_READY_AFTER_READINESS"]);

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
    // M09: each mission carries its role bindings (explicit model + effort + resolution evidence); they are hashed through
    // scopeHash and shown as `models` — the value the owner confirms is the value dispatched.
    // M11 L5 (§4): a mission with step 0 ahead carries it in its entry (`testFirst`: hashed, read by the budget and the authority); an
    // ordinary mission's entry is unchanged to the byte (the key is absent, never null).
    const entries = views.map((v) => {
      const testFirst = testFirstOf(v);
      return { missionId: v.mission.id, title: v.mission.title, workType: v.factory.workType, specVersion: v.scope.specVersion, specSha: v.scope.specSha,
        planSha: v.scope.planSha, scopeHash: hashCanonical(v.scope), limits: v.scope.limits, routes: v.scope.routes, bindings: v.scope.bindings, commands: v.scope.commands,
        estimatedFiles: (v.spec?.spec?.inScope || []).slice(0, 10), ...(v.continuation ? { continuation: v.continuation } : {}), ...(testFirst ? { testFirst } : {}) };
    });
    const firstTestFirst = entries.find((e) => e.testFirst) || null;
    // M10.2 (owner decision 6): every plan — ASSISTED included — pre-authorizes the repair cycles shown on its card, within the
    // mission's limit; a continuation shows (and authorizes) only the cycles that REMAIN. A cycle beyond them is a delta.
    const repairs = (e) => (e.continuation ? e.continuation.remainingCycles : e.limits.maxRepairCycles);
    const totalMinutes = entries.reduce((sum, e) => sum + e.limits.maxDurationMin, 0);
    // M10.2.1 (D21): the card promises a local preview / E2E only when a mission's spec has them — the factory runs the preview only with
    // verification.preview and the browser E2E only with E2E criteria that carry steps (and a preview); otherwise QA goes to the bundle.
    // A spec with both keeps the exact earlier wording (its hash is unchanged); an unreadable spec keeps it too (the earlier claim).
    const withPreview = views.filter((v) => Boolean(v.scope?.commands?.preview));
    const hasPreview = withPreview.length > 0;
    const hasE2E = withPreview.some((v) => (Array.isArray(v.spec?.spec?.acceptance) ? v.spec.spec.acceptance.some((a) => a?.verify === "e2e" && Array.isArray(a.steps) && a.steps.length) : true));
    const body = {
      schemaVersion: ENVELOPE_SCHEMA_VERSION, projectId: project.id, projectName: project.name, autonomyLevel: level,
      missions: entries, planHash: hashCanonical(entries.map((e) => e.scopeHash)),
      workspaceScope: { projectId: project.id, route, kind: project.source === "hub-test" ? "test" : "real" },
      baseSnapshot: await repoState(project),
      eligibleEnvironments: [route], attestationRefs: attestationRefs(project, route),
      allowedRoles: ["writer", "reviewer", "hub-runner"], providers: ["codex", "claude"],
      models: Object.fromEntries(entries.map((e) => [e.missionId, { writer: bindingLabel(e.bindings.writer), reviewer: bindingLabel(e.bindings.reviewer) }])),
      effortPolicy: Object.fromEntries(entries.map((e) => [e.missionId, { profile: e.limits.profile, writer: `${e.bindings.writer.effort} (${e.bindings.writer.effortSource})`, reviewer: `${e.bindings.reviewer.effort} (${e.bindings.reviewer.effortSource})` }])),
      allowedTools: { writer: "Codex: fișierele proiectului (scriere), comenzile din sandbox", reviewer: "Claude: Read/Glob/Grep, fără scriere", runner: "comenzile aprobate din specificație" },
      filesystemScope: route === "windows" ? "proiectul, prin sandbox-ul Codex de pe Windows (R2 deschis)" : `o copie a proiectului în ${route}; exportul validat (C14) se aplică după verificarea conflictelor`,
      networkScope: { writer: "doar furnizorul modelului (abonament)", reviewer: "doar furnizorul modelului (abonament)", runner: route === "windows" ? "sandbox Codex Windows" : `${route}: fără rețea`, preview: "doar loopback local" },
      limits: { maxDurationMin: totalMinutes, maxAttemptsPerStage: Math.max(...entries.map((e) => e.limits.maxAttemptsPerStage)), maxRepairCycles: Object.fromEntries(entries.map((e) => [e.missionId, repairs(e)])), maxConcurrency: 1,
        // 2.12.2 (P0-R3): the per-turn limits the steps run with, resolved like the dispatch resolves them (a mission whose limits
        // predate them runs with its profile's), so the value confirmed is the value enforced; the largest over the plan's missions.
        turnTimeoutMin: { writer: Math.max(...entries.map((e) => turnTimeoutsOf(e.limits).writer)), reviewer: Math.max(...entries.map((e) => turnTimeoutsOf(e.limits).reviewer)) } },
      allowedEffects: ["workspace.write (proiectul de mai sus)", "teste locale", "review doar-citire", "remedieri în limită", "QA", ...(hasPreview ? ["preview local"] : []), ...(hasE2E ? ["E2E local"] : []),
        ...(firstTestFirst ? [TEST_FIRST_EFFECT] : [])],
      deniedEffects: [...DENIED_EFFECTS], ownerConstraints: Object.keys(constraints).filter((k) => constraints[k]).sort(),
      subscriptionPolicy: "INCLUDED_SUBSCRIPTION_ONLY",
      // M08: inside an objective the owner confirms the ordered tasks at once, so at TRUSTED the next task of THIS plan starts without
      // another confirmation (the scope of every task is bound by its hash); ASSISTED plans cover one task at a time.
      continuationPolicy: { afterPanelClosed: true, repairsWithoutConfirmation: true, nextMissionWithoutConfirmation: level === "HIGH_AUTONOMY_BOUNDED" || (Boolean(objective) && level === "TRUSTED"), stopAt: "DELIVERY_READY (nu accept și nu livrez singur)" },
      objective: objective ? { id: objective.id, version: objective.version, title: objective.title, criteria: objective.criteria, planHash: objective.planHash, tasks: objective.tasks, stopConditions: objective.stopConditions } : null,
      // M10.2: under envelope-scoped authority the Hub stays in BUILD_SAFE and only this plan's steps run live (shown and hashed).
      modeTransition: settings.get("mode") === "BUILD_SAFE" ? (scopedLive() ? SCOPED_LIVE_TRANSITION : LEGACY_TRANSITION) : null,
      // M10.2: a continuation of a started mission names the plan it continues (only then: an ordinary plan's content is unchanged).
      ...(entries.some((e) => e.continuation) ? { continuation: { fromEnvelopeId: entries[0].continuation.fromEnvelopeId || null, missionId: entries[0].missionId } } : {}),
      // M11 L5 (§2, §4): the card's step 0 (lines and „Detalii tehnice”), from the first mission that has it ahead — only then.
      ...(firstTestFirst ? { testFirst: { ...firstTestFirst.testFirst, missionId: firstTestFirst.missionId } } : {}),
    };
    return body;
  }

  function summaryOf(body, readinessInfo, previous = null) {
    const m = body.missions;
    const repairs = Object.values(body.limits.maxRepairCycles);
    const cont = body.continuation ? m[0]?.continuation || null : null;
    // M10.2.1 (D21): the steps end where the plan really ends — the same facts as allowedEffects (the hashed body), never a promise of
    // a preview or an E2E the spec does not have.
    const effects = Array.isArray(body.allowedEffects) ? body.allowedEffects : [];
    const preview = effects.includes("preview local");
    const e2e = effects.includes("E2E local");
    const tail = preview && e2e ? "QA, preview și E2E local." : preview ? "QA și preview local (fără E2E: specificația nu are criterii E2E)."
      : "QA și pachetul de livrare (fără preview sau E2E: specificația nu le cere).";
    // M11 L5 (§2): a plan with step 0 says it first — the Hub writes and checks the acceptance test, then the usual steps — and who writes
    // and reviews the test (both read-only). The test's path is never in these lines (only the card's „Detalii tehnice” shows it).
    const tfEntries = m.filter((e) => e.testFirst);
    const tfCriteria = tfEntries.flatMap((e) => (e.testFirst.criteria || []).map((c) => ({ id: tfEntries.length > 1 ? `${c.id} (${e.title})` : c.id, text: c.text })));
    return {
      // M10.2: a continuation shows only the difference — what remains and what changed since the plan it continues.
      ...(cont ? { continuation: {
        from: cont.fromEnvelopeId || null, stage: cont.stage,
        remaining: `Rămân: ${cont.remainingCycles} ${cont.remainingCycles === 1 ? "ciclu" : "cicluri"} de remediere, ${body.limits.maxAttemptsPerStage} încercări pe etapă${cont.extraAttempt ? ` (plus o încercare pentru etapa „${factoryStageLabel(cont.extraAttempt.stage)}”, ale cărei încercări s-au epuizat)` : ""}, cel mult ${body.limits.maxDurationMin} min.`,
        changed: previous ? changedParts(previous, body).filter((p) => p !== "conținutul planului" && p !== labelOf("missions")) : [],
        rebind: (cont.rebind || []).map((role) => `${role}: ${bindingLabel(m[0].bindings?.[role])}`),
      } } : {}),
      headline: cont ? `Continuare: „${m[0].title}” pe ${body.projectName} (din etapa „${factoryStageLabel(cont.stage)}”)` : body.objective ? `Obiectiv „${body.objective.title}”: ${m.length === 1 ? `sarcina „${m[0].title}”` : `${m.length} sarcini, una după alta`} pe ${body.projectName}` : m.length === 1 ? `„${m[0].title}” pe ${body.projectName}` : `${m.length} misiuni pe ${body.projectName}, una după alta`,
      where: `Lucrez numai în ${body.projectName} (${body.workspaceScope.route}); ${body.filesystemScope}.`,
      steps: `${cont ? "Reiau de unde a rămas: " : ""}${tfEntries.length ? `${T_STEPS_PREFIX}implementare` : "Implementare"} (Codex), verificări, review (Claude, doar citire), ${repairs.every((r) => r === 0) ? "fără cicluri de remediere în plan (o remediere îți cere confirmarea diferenței)" : `până la ${Math.max(...repairs)} cicluri de remediere incluse în această confirmare`}, ${tail}`,
      // M09: the exact models and efforts the steps run with (the bindings; checked again before every start and at the provider's report).
      models: `Modele: ${[...new Set(m.map((e) => `writer ${bindingLabel(e.bindings?.writer)}; reviewer ${bindingLabel(e.bindings?.reviewer)}`))].join(" | ")}${tfEntries.length ? T_MODELS_SUFFIX : ""}. Verificate din nou înainte de fiecare pornire; o schimbare oprește execuția înainte de model.`,
      // M11 L5 (§2): the step-0 lines of the card (the same words the page builds from the hashed body.testFirst) and what the test proves.
      ...(tfEntries.length ? { testFirst: { step0: tfEntries.every((e) => e.testFirst.reauthorMax === 0) ? T_CARD_STEP0_NO_REWRITE : T_CARD_STEP0, proves: T_CARD_PROVES(tfCriteria), criteria: tfCriteria, missions: tfEntries.map((e) => e.missionId) } } : {}),
      never: "Fără deploy, commit, push, mesaje, bani, schimbări de acces sau izolare, instalări, ștergeri de date reale.",
      stops: `Mă opresc la ${body.limits.maxDurationMin} min, ${body.limits.maxAttemptsPerStage} încercări pe etapă, sau când livrarea e gata de verificarea ta (nu accept singur). Continui și dacă închizi pagina, dar numai în aceste limite; nu încep alte misiuni${body.continuationPolicy.nextMissionWithoutConfirmation ? " decât pe cele din acest plan" : ""}.`,
      // 2.12.2 (P0-R3): the per-turn limits (hashed in body.limits.turnTimeoutMin), next to the mission's own deadline.
      limits: turnLimitsLine(body),
      cost: "Doar din abonamentele incluse; niciun API plătit, nicio extra usage.",
      mode: body.modeTransition === SCOPED_LIVE_TRANSITION ? "Doar pașii acestui plan rulează live; Hub-ul rămâne în BUILD_SAFE (execuțiile manuale rămân refuzate)."
        : body.modeTransition ? "Hub-ul trece din BUILD_SAFE în LIVE_VALIDATION pe durata misiunii și revine apoi." : null,
      files: m.flatMap((e) => e.estimatedFiles).length ? `Estimare (nu promisiune): ${m.flatMap((e) => e.estimatedFiles).slice(0, 6).join(", ")}` : "Fișierele modificate nu sunt identificate încă (estimarea vine după implementare).",
      autonomy: AUTONOMY_LABELS[body.autonomyLevel],
      // Review #31: a plan blocked only by automatic readiness shows its pre-steps (done after the confirmation), not disabling blockers.
      blockers: readinessInfo.afterReadiness ? [] : readinessInfo.blockers.map((b) => b.detail),
      ...(readinessInfo.afterReadiness ? { preSteps: readinessInfo.preSteps || [] } : {}),
      state: stateOf(readinessInfo),
    };
  }

  // ---------- M10.2 (U11): continuation of a started mission ----------
  /** The last plan the owner confirmed for this mission (any status now), or null: a continuation always names the plan it continues. */
  const lastConfirmedOf = (missionId) => rowTo(db.prepare("SELECT * FROM mission_envelopes WHERE confirmed_at IS NOT NULL AND EXISTS (SELECT 1 FROM json_each(mission_envelopes.mission_ids_json) WHERE value = ?) ORDER BY confirmed_at DESC LIMIT 1").get(String(missionId || "")));

  /**
   * The view a CONTINUATION plan covers: a started mission that waits (PAUSED / BLOCKED / NEEDS_OWNER_DECISION) after its plan
   * closed (expired, revoked, failed to continue) or whose binding / route changed (MATERIAL_CHANGE). Its scope is the approved one
   * with the bindings re-resolved now; the plan authorizes only what REMAINS (cycles, an exhausted step's one more attempt, a fresh
   * time window). Refused for a mission that never ran under a plan (it keeps the factory's own Resume) and for a mission whose plan is
   * still in force with the same bindings (that one continues with „Continuă” / a confirmed difference, not with a new plan).
   */
  function continuationView(v, { forConfirm = false } = {}) {
    const missionId = v.mission.id;
    const previous = lastConfirmedOf(missionId);
    if (!previous) throw new HubError("policy", `„${v.mission.title}” a pornit în afara unui plan (fluxul vechi); o reiei din Fabrică, cu „Reia”, ca până acum`);
    const cont = factory.continuationScope(missionId);
    const open = envelopeOfMission(missionId);
    if (open && !forConfirm && !(cont.changedRoles || []).length) {
      throw new HubError("conflict", `„${v.mission.title}” e deja în planul tău confirmat (${open.status}); o reiau în aceleași limite când spui „Continuă” sau confirmi diferența, nu printr-un plan nou`, { code: "PLAN_IN_FORCE", data: { envelopeId: open.id } });
    }
    return { ...v, scope: cont.scope, scopeProblems: cont.problems || [],
      continuation: { fromEnvelopeId: previous.id, stage: cont.stage, repairCyclesUsed: cont.repairCycles ?? 0, remainingCycles: cont.remainingCycles ?? 0,
        extraAttempt: cont.exhausted ? { stage: cont.exhausted.stage, counted: cont.exhausted.counted } : null, rebind: cont.changedRoles || [] } };
  }

  /** The factory views a plan covers: SPEC_DRAFT missions as shown by the factory, or ONE started mission as a continuation. */
  function planViews(project, ids, { auto = true, continuation = false, forConfirm = false } = {}) {
    const views = ids.map((id) => {
      const v = factory.view(id);
      if (!v) throw new HubError("not_found", `Misiunea ${id} nu e o misiune Software Factory`);
      if (v.project?.id !== project.id) throw new HubError("policy", "O misiune din alt proiect nu intră în acest plan");
      return v;
    });
    const wanted = continuation || (auto && ids.length === 1 && CONTINUABLE.has(views[0].factory.stage));
    if (!wanted) return views;
    if (ids.length !== 1) throw new HubError("policy", "O continuare acoperă o singură misiune");
    return [continuationView(views[0], { forConfirm })];
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
    const views = planViews(project, ids, { auto: !objectiveRef });
    const ready = await withAutomaticReadiness(project, readiness(project, views));
    if (views.some((v) => !v.scope)) {
      return { envelope: null, readiness: ready, summary: { headline: views[0].mission.title, blockers: ready.blockers.map((b) => b.detail), state: "PLAN_INCOMPLETE" } };
    }
    const body = await buildBody(project, views, autonomy, constraints, objectiveRef);
    const hash = hashCanonical(body);
    const previous = body.continuation?.fromEnvelopeId ? get(body.continuation.fromEnvelopeId) : null;
    const summary = summaryOf(body, ready, previous?.body || null);
    const id = insertProposal({ project, ids, body, hash, summary, autonomy, actor, via, eligible: ready.eligible });
    return { envelope: view(id), readiness: ready, summary };
  }

  /** Records a preview (PROPOSED, consumable nonce, confirm-by window) and supersedes the project's older previews: one shared path. */
  function insertProposal({ project, ids, body, hash, summary, autonomy, actor, via, eligible, extra = {} }) {
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
      bus.append({ type: "envelope.proposed", scopeType: "envelope", scopeId: id, projectId: project.id, source: actor, payload: { via, missions: ids, hash: hash.slice(0, 16), level: autonomy, eligible, ...extra } });
    });
    return id;
  }

  // ---------- M10.2 (U12): run envelopes ----------
  let runsApi = null;
  let conversationsApi = null;
  /** Late-bound by hub.mjs (the run manager and conversations exist before the envelopes, but are not part of the M06 contract). */
  function attachRuns({ runs = null, conversations = null } = {}) { runsApi = runs; conversationsApi = conversations; }
  const isHubProject = (project) => Boolean(project) && (project.slug === "ifrim-agent-hub" || (Boolean(config?.hubRoot) && path.resolve(project.path).toLowerCase() === path.resolve(config.hubRoot).toLowerCase()));
  const runRequestOf = (body) => ({ provider: body.run.provider, access: body.run.access, task: body.run.task, model: body.run.request?.model || "", effort: body.run.request?.effort || "" });

  /**
   * What a run plan may ask for, decided before readiness (policy, not state): null, or { code, detail } in the owner's words. Read-only
   * is always askable; workspace-write only for Codex, only on a sanitized hub-test project or on a route to an execution environment
   * (the gate then requires its valid attestation and the owner's approval (b)). The Hub's own repository (decision 10) and a real project
   * on the Windows route (R2 open; a time-boxed R2 acceptance is a risk accepted, not an isolation, so it does not count here) never get
   * a writing agent from a plan; Claude has no boundary for writes and shell on native Windows, so it only reads.
   */
  function runAccessProblem(project, { provider, access }) {
    if (!project) return { code: "PROJECT", detail: "Proiect necunoscut" };
    if (!RUN_PROVIDERS.has(provider)) return { code: "PROVIDER", detail: `Provider necunoscut: ${String(provider || "—").slice(0, 20)}` };
    if (!RUN_ACCESS.has(access)) return { code: "ACCESS", detail: "Acces necunoscut (doar citire sau scriere în proiect)" };
    if (access !== "workspace-write") return null;
    if (provider === "claude") return { code: "CLAUDE_READ_ONLY", detail: "Claude rulează într-un plan doar cu citire: pe Windows nativ nu are o graniță pentru scriere și comenzi shell" };
    if (isHubProject(project)) return { code: "HUB_SELF_TARGET", detail: "Hub-ul nu se modifică singur: un agent Codex cu scriere pe depozitul Hub-ului este refuzat (o analiză doar-citire, cu Claude, se poate)" };
    const route = environments ? environments.routeFor(project.id, provider) : "windows";
    if (project.source !== "hub-test" && route === "windows") return { code: "HOST_R2_OPEN", detail: `Pe ruta Windows, comenzile Codex ar putea citi prin cale absolută alte proiecte; ${project.name} primește un agent cu scriere doar într-un mediu izolat atestat` };
    return null;
  }

  /** The run's binding resolved NOW against the route and installation that will run it (explicit model; never the account default). */
  function runBinding(project, { provider, model, effort }) {
    if (!runsApi?.bindingContext) return { ok: false, binding: null, problem: "execuțiile nu sunt disponibile pe acest server" };
    const ctx = runsApi.bindingContext(project.id, provider);
    return resolveBinding({ role: "run", provider, environment: ctx.environment, requestedModel: model, requestedEffort: effort, providerState: ctx.providerState, now: now() });
  }

  /** What would block the run if the owner confirmed now (the checks the plan arranges itself — ENVELOPE_RESOLVES — are not blockers). */
  function runReadiness(project, req, bindingResult = null) {
    if (!project) return { eligible: false, isTest: false, blockers: [{ id: "project", kind: "plan", detail: "Proiect necunoscut" }], stageMap: null };
    const blockers = [];
    const refusal = runAccessProblem(project, req);
    if (refusal) blockers.push({ id: `run:${refusal.code}`, kind: "refused", code: refusal.code, detail: refusal.detail });
    else {
      const who = req.provider === "claude" ? "Claude" : "Codex";
      for (const c of gate.evaluate({ provider: req.provider, projectId: project.id, access: req.access }).checks) {
        if (!c.ok && !ENVELOPE_RESOLVES.has(c.id)) blockers.push({ id: `run:${c.id}`, kind: ["isolation", "host_isolation", "environment_route"].includes(c.id) ? "isolation" : "gate", detail: `Execuția (${who}) · ${c.id}: ${c.detail}` });
      }
    }
    if (bindingResult && !bindingResult.ok) blockers.push({ id: "run:model", kind: "plan", detail: `Modelul nu poate fi fixat: ${bindingResult.problem}` });
    return { eligible: blockers.length === 0, isTest: project.source === "hub-test", blockers, stageMap: null };
  }

  /** The run plan's content (hashed): what the one confirmation covers. */
  async function buildRunBody(project, req, binding, level, constraints = {}) {
    const route = environments ? environments.routeFor(project.id, req.provider) : "windows";
    const write = req.access === "workspace-write";
    const run = { provider: req.provider, access: req.access, task: req.task, request: { model: req.model, effort: req.effort }, binding: bodyBinding(binding),
      conversation: "nouă, doar pentru această sarcină", attempts: RUN_ENVELOPE_LIMITS.attempts };
    return {
      schemaVersion: ENVELOPE_SCHEMA_VERSION, kind: "run", projectId: project.id, projectName: project.name, autonomyLevel: level,
      // `missions` stays an empty list: readers written for mission plans iterate it and find nothing.
      missions: [], run, planHash: hashCanonical(run),
      workspaceScope: { projectId: project.id, route, kind: project.source === "hub-test" ? "test" : "real" },
      // A writing turn is bound to the repository state the owner saw; a read-only one changes nothing, so it is not.
      ...(write ? { baseSnapshot: await repoState(project) } : {}),
      eligibleEnvironments: [route], attestationRefs: attestationRefs(project, route),
      allowedRoles: ["run"], providers: [req.provider],
      models: { run: bindingLabel(binding) }, effortPolicy: { run: `${binding.effort} (${binding.effortSource})` },
      allowedTools: { run: req.provider === "claude" ? "Claude: Read/Glob/Grep în proiect, fără scriere" : write ? "Codex: fișierele proiectului (scriere), comenzile din sandbox" : "Codex: citire în proiect (sandbox doar-citire)" },
      filesystemScope: route === "windows"
        ? (req.provider === "claude" ? "proiectul, doar citire (citirile în afara lui sunt refuzate de Claude Code)" : write ? "proiectul de test, prin sandbox-ul Codex de pe Windows" : "proiectul, prin sandbox-ul Codex doar-citire")
        : `o copie a proiectului în ${route}${write ? "; exportul validat (C14) se aplică după verificarea conflictelor" : ""}`,
      networkScope: { run: "doar furnizorul modelului (abonament)" },
      limits: { maxDurationMin: RUN_ENVELOPE_LIMITS.maxDurationMin, maxAttemptsPerStage: RUN_ENVELOPE_LIMITS.attempts, maxRepairCycles: {}, maxRuns: 1, maxConcurrency: 1,
        turnTimeoutMin: runTurnTimeoutMin(req.access, binding) },
      allowedEffects: write ? ["workspace.write (proiectul de mai sus)", "un singur turn de model"] : ["citire în proiect", "un singur turn de model"],
      deniedEffects: [...DENIED_EFFECTS], ownerConstraints: Object.keys(constraints).filter((k) => constraints[k]).sort(),
      subscriptionPolicy: "INCLUDED_SUBSCRIPTION_ONLY",
      continuationPolicy: { afterPanelClosed: true, repairsWithoutConfirmation: false, nextMissionWithoutConfirmation: false, stopAt: "sfârșitul turnului (rezultatul rămâne în conversație; nimic nu se aplică sau se livrează singur)" },
      objective: null,
      modeTransition: settings.get("mode") === "BUILD_SAFE" ? (scopedLive() ? SCOPED_LIVE_TRANSITION : LEGACY_TRANSITION) : null,
    };
  }

  function runSummaryOf(body, readinessInfo) {
    const r = body.run;
    const write = r.access === "workspace-write";
    const who = r.provider === "claude" ? "Claude" : "Codex";
    return {
      kind: "run",
      headline: `${write ? "O execuție cu scriere" : "O analiză doar-citire"} pe ${body.projectName}: „${clipText(r.task, 80)}”`,
      task: r.task,
      where: `Lucrez numai în ${body.projectName} (${body.workspaceScope.route}); ${body.filesystemScope}.`,
      steps: `Un singur turn ${who} (${write ? "poate modifica fișierele proiectului" : "doar citește"}), într-o conversație nouă; fără cicluri de remediere și fără alți pași.`,
      models: `Model: ${body.models.run}. Verificat din nou înainte de pornire; o schimbare oprește execuția înainte de model.`,
      never: "Fără deploy, commit, push, mesaje, bani, schimbări de acces sau izolare, instalări, ștergeri de date reale.",
      stops: `Mă opresc după un singur turn sau la ${body.limits.maxDurationMin} min; rezultatul rămâne în conversație, nimic nu se aplică sau se livrează singur.`,
      // 2.12.2 (P0-R3): the turn's own limit (hashed in body.limits.turnTimeoutMin); a turn cut there is not retried (one turn per plan).
      limits: body.limits.turnTimeoutMin ? `Limită pe tură: ${body.limits.turnTimeoutMin} min; termen plan ${body.limits.maxDurationMin} min. O tură care depășește limita e oprită și nu se reia singură.` : null,
      cost: "Doar din abonamentele incluse; niciun API plătit, nicio extra usage.",
      mode: body.modeTransition === SCOPED_LIVE_TRANSITION ? "Doar pasul acestui plan rulează live; Hub-ul rămâne în BUILD_SAFE (execuțiile manuale rămân refuzate)."
        : body.modeTransition ? "Hub-ul trece din BUILD_SAFE în LIVE_VALIDATION pe durata execuției și revine apoi." : null,
      files: write ? "Fișierele modificate se văd după turn (nu le estimez dinainte)." : "Nu modific niciun fișier.",
      autonomy: AUTONOMY_LABELS[body.autonomyLevel],
      blockers: readinessInfo.afterReadiness ? [] : readinessInfo.blockers.map((b) => b.detail),
      ...(readinessInfo.afterReadiness ? { preSteps: readinessInfo.preSteps || [] } : {}),
      state: stateOf(readinessInfo, true),
    };
  }

  /**
   * Preview of ONE bounded model step (nothing runs, nothing is granted). A refused access or an unresolvable model gives no card
   * ({ envelope: null } + the reason): a plan that can never run is not shown as if it could.
   */
  async function proposeRun({ projectId, provider = "claude", access = "read-only", task = "", model = "", effort = "", level = null, constraints = {}, actor = "owner", via = "ui" }) {
    const project = projects.get(projectId);
    if (!project) throw new HubError("not_found", "Proiect necunoscut");
    const projectLevel = autonomyOf(project.id).level;
    if (level && AUTONOMY_LEVELS.includes(level) && LEVEL_RANK[level] > LEVEL_RANK[projectLevel]) throw new HubError("policy", `Planul nu poate cere nivelul ${level} peste nivelul proiectului (${projectLevel}); ridică întâi autonomia proiectului`);
    const autonomy = level && AUTONOMY_LEVELS.includes(level) ? level : projectLevel;
    const text = String(task || "").replace(/\s+/g, " ").trim();
    if (text.length < RUN_ENVELOPE_LIMITS.taskMin) throw new HubError("validation", "Sarcina este prea scurtă");
    if (text.length > RUN_ENVELOPE_LIMITS.taskMax) throw new HubError("validation", `Sarcina are peste ${RUN_ENVELOPE_LIMITS.taskMax} caractere; formuleaz-o mai scurt`);
    // What the owner sees is exactly what runs: nothing the redactor would hide may be in it.
    if (redactText(text) !== text) throw new HubError("policy", "Sarcina conține ceva ce pare un secret; scrie-o tu în cockpit, fără el");
    const req = { provider, access, task: text, model: String(model || "").trim(), effort: String(effort || "").trim().toLowerCase() };
    const refusal = runAccessProblem(project, req);
    const bound = refusal ? null : runBinding(project, req);
    const ready = await withAutomaticReadiness(project, runReadiness(project, req, bound), { kind: "run", req });
    if (refusal || !bound?.ok) {
      return { envelope: null, readiness: ready, refusal: refusal || null,
        summary: { kind: "run", headline: `„${clipText(text, 80)}” pe ${project.name}`, blockers: ready.blockers.map((b) => b.detail), state: refusal ? "PLAN_REFUSED" : "PLAN_INCOMPLETE" } };
    }
    const body = await buildRunBody(project, req, bound.binding, autonomy, constraints);
    const hash = hashCanonical(body);
    const summary = runSummaryOf(body, ready);
    const id = insertProposal({ project, ids: [], body, hash, summary, autonomy, actor, via, eligible: ready.eligible, extra: { kind: "run", provider: req.provider, access: req.access } });
    return { envelope: view(id), readiness: ready, summary };
  }

  /** At confirmation: the run plan rebuilt from the facts as they are NOW (a plan that can no longer be bound is superseded). */
  async function runBodyNow(env, project) {
    const req = runRequestOf(env.body);
    const bound = project ? runBinding(project, req) : { ok: false, problem: "proiect necunoscut" };
    if (!bound.ok) {
      bus.transaction(() => setStatus(env.id, "SUPERSEDED", { reason: `Modelul nu mai poate fi fixat: ${bound.problem}`, from: ["PROPOSED"] }));
      throw new HubError("conflict", `Planul nu mai e valabil: modelul nu mai poate fi fixat (${bound.problem})`);
    }
    return buildRunBody(project, req, bound.binding, env.autonomyLevel, Object.fromEntries((env.body.ownerConstraints || []).map((k) => [k, true])));
  }

  /** Refuses a run grant wider than its plan (provider, access, binding, project, attempts, duration, expiry). */
  function assertRunWithin(env, spec, projectId) {
    const r = env.body.run;
    const problems = [];
    if (projectId !== env.projectId) problems.push("alt proiect");
    if (spec.provider !== r.provider) problems.push(`provider ${spec.provider} în afara planului`);
    if (spec.access !== r.access) problems.push(`acces ${spec.access} în afara planului`);
    if (!spec.binding?.bindingHash || spec.binding.bindingHash !== r.binding?.bindingHash) problems.push("model în afara planului");
    if (spec.maxAttempts !== RUN_ENVELOPE_LIMITS.attempts) problems.push("încercări peste plan");
    if (spec.maxDurationS > env.body.limits.maxDurationMin * 60) problems.push("durată peste plan");
    if (now().getTime() + spec.ttlMinutes * 60000 > Date.parse(env.expiresAt) + 1000) problems.push("expiră după plan");
    if (problems.length) throw new HubError("policy", `Grant derivat refuzat (mai larg decât planul): ${problems.join(", ")}`);
  }

  /** The ONE grant of a run plan: bound to its binding and to the plan itself (binding.envelopeRunId), never topped up. */
  function issueRunGrant(env, binding) {
    const r = env.body.run;
    const remainingMin = Math.floor((Date.parse(env.expiresAt) - now().getTime()) / 60000);
    if (remainingMin < 5) throw new HubError("gate", "Autoritatea planului a expirat");
    const spec = { provider: r.provider, access: r.access, maxAttempts: RUN_ENVELOPE_LIMITS.attempts, ttlMinutes: Math.min(480, remainingMin),
      maxDurationS: Math.min(7200, Math.max(60, env.body.limits.maxDurationMin * 60)), binding: grantBindingOf(binding) };
    assertRunWithin(env, spec, env.projectId);
    return bus.transaction(() => {
      if (grants.ofEnvelope(env.id).some((g) => g.kind === "run")) throw new HubError("conflict", "Planul și-a derivat deja grantul execuției");
      const g = grants.create({ provider: spec.provider, projectId: env.projectId, access: spec.access, maxAttempts: spec.maxAttempts, maxDurationS: spec.maxDurationS,
        ttlMinutes: Math.max(5, spec.ttlMinutes), expiresAt: env.expiresAt, envelopeId: env.id, binding: { ...spec.binding, envelopeRunId: env.id },
        note: `Derivat din planul ${env.id} (o execuție ${spec.provider} ${spec.access}, ${spec.binding.model} · ${spec.binding.effort})` }, `envelope:${env.id}`);
      const issued = { grantId: g.id, role: "run", provider: g.provider, access: g.access, maxAttempts: g.maxAttempts, expiresAt: g.expiresAt, model: spec.binding.model, effort: spec.binding.effort, bindingHash: spec.binding.bindingHash };
      const derived = get(env.id).derived || {};
      db.prepare("UPDATE mission_envelopes SET derived_json = ?, updated_at = ? WHERE id = ?").run(json({ ...derived, grants: [...(derived.grants || []), issued] }), iso(), env.id);
      bus.append({ type: "envelope.grants_derived", scopeType: "envelope", scopeId: env.id, projectId: env.projectId, source: "envelopes", payload: { run: true, topUp: false, budget: RUN_ENVELOPE_LIMITS.attempts,
        grants: [{ id: g.id, role: "run", provider: g.provider, access: g.access, attempts: g.maxAttempts, model: issued.model, effort: issued.effort }] } });
      return issued;
    });
  }

  /**
   * Starts the confirmed run plan's ONE step: its bound grant, a new conversation holding exactly the task the card showed, then the
   * ordinary run manager (gate → lease → grant attempt → backup → provider). No approval row and no factory; the gate admits the step
   * through this plan only (scope "envrun:<id>"), in BUILD_SAFE.
   */
  async function startRun(env, session) {
    if (!runsApi?.start || !conversationsApi?.create) throw new HubError("internal", "Execuțiile nu sunt disponibile pe acest server");
    const project = projects.get(env.projectId);
    const r = env.body.run;
    const fresh = runBinding(project, runRequestOf(env.body));
    if (!fresh.ok || fresh.binding.bindingHash !== r.binding?.bindingHash) throw new HubError("conflict", `Modelul execuției s-a schimbat după confirmare (${fresh.problem || "altă legătură"}); nimic nu a pornit`);
    const current = get(env.id);
    if (!current || !OPEN.has(current.status)) throw new HubError("conflict", "Planul s-a închis între timp; execuția nu mai pornește");
    issueRunGrant(current, fresh.binding);
    const actor = `envelope:${env.id}`;
    const conversation = bus.transaction(() => conversationsApi.create({ projectId: project.id, title: `Plan · ${clipText(r.task, 60)}` }, actor));
    bus.transaction(() => conversationsApi.addMessage({ conversationId: conversation.id, role: "user", content: r.task }, `owner:${session.id}`));
    const setDerived = (patch) => bus.transaction(() => db.prepare("UPDATE mission_envelopes SET derived_json = ?, updated_at = ? WHERE id = ?").run(json({ ...(get(env.id).derived || {}), ...patch }), iso(), env.id));
    setDerived({ conversationId: conversation.id });
    // 2.12.2 (P0-R3): the per-turn limit the owner confirmed (body.limits.turnTimeoutMin); a plan without it (confirmed before) keeps none.
    const turnMin = Number(env.body.limits?.turnTimeoutMin) || 0;
    const started = await runsApi.start({ conversationId: conversation.id, provider: r.provider, access: r.access, binding: { ...fresh.binding, envelopeRunId: env.id },
      actor: `owner:${session.id}`, correlationId: env.id, ...(turnMin > 0 ? { turnTimeoutMs: turnMin * 60000 } : {}) });
    setDerived({ runId: started.run.id });
    bus.emit({ type: "envelope.run_started", scopeType: "envelope", scopeId: env.id, projectId: env.projectId, source: "envelopes",
      payload: { runId: started.run.id, conversationId: conversation.id, provider: r.provider, access: r.access, model: r.binding?.resolvedAlias || null, effort: r.binding?.effort || null } });
    // A turn that already ended before its id was recorded (a very fast provider) closes the plan here (the listener found no plan then).
    const status = runsApi.getRun ? runsApi.getRun(started.run.id)?.status : null;
    if (RUN_END.has(status)) later(() => finishRun(env.id, status));
    return started;
  }

  /** The run's turn ended (any outcome): the plan is complete and its grant revoked — one step, one confirmation, nothing after it. */
  function finishRun(envelopeId, status) {
    const env = get(envelopeId);
    if (!env || env.body?.kind !== "run" || !OPEN.has(env.status)) return null;
    return close(env.id, "COMPLETED", status === "completed" ? "Execuția s-a încheiat; rezultatul e în conversație (nimic nu se aplică singur)" : `Execuția s-a încheiat (${status}); grantul planului e revocat`);
  }

  /**
   * Review #10, boot reconciliation (hub.boot, right after recoverOnBoot): a run plan whose ONE turn died with the previous Hub process
   * (recoverOnBoot marks it interrupted_unknown / orphaned and emits only run.recovered) stayed ACTIVE until tick() expired it — up to
   * an hour holding the project's only open-plan slot (ux_mission_envelopes_active), so every new plan there was refused. Each open
   * run plan whose run is missing, not active in this process, or terminal is closed now; its grant is revoked in the same transaction.
   * Never resumes anything (a new turn is a new plan).
   */
  function recoverRuns() {
    const out = [];
    const active = new Set((runsApi?.activeRuns?.() || []).map((r) => r.runId));
    const rows = db.prepare("SELECT * FROM mission_envelopes WHERE status IN ('CONFIRMED','ACTIVE','WAITING_OWNER') AND json_extract(body_json, '$.kind') = 'run'").all().map(rowTo);
    for (const env of rows) {
      const runId = env.derived?.runId || null;
      const status = runId ? db.prepare("SELECT status FROM agent_runs WHERE id = ?").get(runId)?.status || null : null;
      if (runId && active.has(runId) && !["interrupted_unknown", "orphaned", "completed", "failed", "interrupted", "blocked"].includes(status)) continue;
      const closed = runId
        ? close(env.id, "COMPLETED", `Hub-ul a repornit în timpul execuției (${status || "stare necunoscută"}); grantul planului e revocat, nimic nu se reia singur`)
        : close(env.id, "FAILED_TO_START", "Hub-ul a repornit înainte ca execuția planului să pornească; grantul planului e revocat");
      out.push({ envelopeId: env.id, runId, runStatus: status, status: closed?.status || null });
    }
    return out;
  }

  /** A revoked or expired run plan interrupts its turn in flight (fail-safe, like Stop for that one run). */
  function interruptRunOf(env, status) {
    const runId = env.derived?.runId || null;
    if (!runId || !runsApi?.interrupt) return;
    Promise.resolve().then(() => runsApi.interrupt(runId, `plan ${status}`)).catch(() => { /* already finished: nothing to stop */ });
  }

  /** M10.2 (U12): the live authority of a run plan for its own step (scope "envrun:<id>"); same rules as a mission plan's. */
  function runLiveAuthority(envelopeId, bindingHash, { provider = null, projectId = null, access = "read-only" } = {}) {
    const env = get(envelopeId);
    if (!env || env.body?.kind !== "run") return { envelopeId, grantId: null, problem: "planul execuției nu există" };
    const refuse = (problem) => ({ envelopeId: env.id, grantId: null, problem });
    if (!env.confirmedAt) return refuse("planul nu a fost confirmat");
    if (!OPEN.has(env.status)) return refuse(`planul este ${env.status}`);
    if (new Date(env.expiresAt) <= now()) return refuse("timpul autorizat al planului s-a terminat");
    if (!trust.policy().active) return refuse("politica voice-first nu mai este activă");
    if (projectId && projectId !== env.projectId) return refuse("pasul este pe alt proiect decât planul");
    if (provider && provider !== env.body.run.provider) return refuse(`pasul cere ${provider}, planul a confirmat ${env.body.run.provider}`);
    if (access === "workspace-write" && env.body.run.access !== "workspace-write") return refuse("planul a confirmat doar citire");
    const t = now();
    const scope = runScopeKey(env.id);
    const ctx = (g) => ({ provider: provider || g.provider, projectId: projectId || env.projectId, access, now: t, bindingHash, missionId: scope, planRun: true });
    const candidates = grants.ofEnvelope(env.id).filter((g) => g.kind === "run" && g.status === "active" && g.binding?.bindingHash === bindingHash && g.binding?.envelopeRunId === env.id);
    const usable = candidates.find((g) => !grants.problem(g, ctx(g)));
    if (!usable) return refuse(candidates.length ? `grantul derivat nu admite pasul (${grants.problem(candidates[0], ctx(candidates[0]))})` : "planul nu are un grant derivat activ pentru acest model");
    return { envelopeId: env.id, grantId: usable.id };
  }

  // ---------- armed spoken confirmation (M08 §17; M10.2 U13: one shared helper, owner/armed-window.mjs) ----------
  /*
   * After the exact plan is presented (spoken by Lega, or shown on the owner's cockpit) inside a LIVE Lega session derived from the
   * owner session, with the local voice gate running, the Hub opens a short window for THAT plan (its hash and nonce) in THAT Lega
   * session. A spoken "Da, execută planul" the Hub itself heard (speaker MATCH, local final transcript naming the plan, gate segment the
   * SERVER bound to the armed plan) then confirms without a button. Nothing arms because a model asked "ești de acord?": arming is a
   * server decision over the plan state, the Lega session (read from Lega, never from the page), the policy, the voice profile, the
   * gate and local transcription. Windows live in memory: a restart closes them (fail-safe).
   */
  armedWindows.registerKind("envelope", { waiting: (id, hash) => { const e = get(id); return Boolean(e && e.status === "PROPOSED" && e.envelopeHash === hash && new Date(e.confirmBy) > now()); } });
  /**
   * The checks of THIS plan for a window (the Lega / voice side is `armedWindows.lega`). Throws the reason in the owner's words.
   * `ownerSession` is the owner session the derived Lega session came from (server-resolved).
   */
  function armable(env, ownerSession) {
    if (!env || env.status !== "PROPOSED" || new Date(env.confirmBy) <= now()) throw new HubError("conflict", "Planul nu mai așteaptă confirmarea");
    // Review #1/#31: a plan whose only blockers are automatic readiness steps is confirmable (its confirmation runs them first).
    if (!CONFIRMABLE_STATES.has(env.summary?.state)) throw new HubError("conflict", "Planul nu e eligibil acum; nu deschid o fereastră de confirmare");
    // The plan would be refused at confirmation anyway: OBSERVE never runs, and a plan never runs above the project's level now.
    const projectLevel = autonomyOf(env.projectId).level;
    if (env.autonomyLevel === "OBSERVE" || projectLevel === "OBSERVE") throw new HubError("policy", "Nivelul OBSERVE nu permite execuții: nu deschid o fereastră vocală");
    if (LEVEL_RANK[env.autonomyLevel] > LEVEL_RANK[projectLevel]) throw new HubError("policy", `Planul are nivelul ${env.autonomyLevel}, peste nivelul proiectului (${projectLevel}): nu deschid o fereastră vocală`);
    // A plan with high autonomy is confirmed only right after Windows Hello: by voice only while the session is still fresh.
    if (env.autonomyLevel === "HIGH_AUTONOMY_BOUNDED") trust.requireFresh(ownerSession, "confirmarea vocală a unui plan cu autonomie mare (altfel confirmă cu butonul și Windows Hello)");
  }
  /**
   * Arms the window for a plan presented in a Lega session. `session` (optional) is the owner session of the request that showed the
   * card (owner channel): it must be the one the Lega session was derived from. `dryRun` checks without opening (Lega's spoken hint).
   */
  function armForLega({ envelopeId, legaSessionId, session = null, dryRun = false, via = "lega" }) {
    if (!trust.policy().active) throw new HubError("policy", "Politica voice-first nu este activă");
    const env = get(envelopeId);
    const check = armedWindows.lega(legaSessionId, session?.id || null);
    if (!check.ok) throw new HubError("policy", `Nu deschid fereastra vocală: ${check.reason}`);
    const s = trust.requireSession({ id: check.ownerSessionId }, "fereastra de confirmare vocală");
    armable(env, s);
    if (dryRun) return { envelopeId: env.id, armed: false, eligible: true };
    const w = armedWindows.arm({ kind: "envelope", planId: env.id, projectId: env.projectId, ownerSessionId: s.id, legaSessionId, hash: env.envelopeHash, nonce: env.nonce, via });
    return { envelopeId: env.id, armed: true, armedAt: w.armedAt, expiresAt: w.expiresAt, say: w.say };
  }
  /** M08 API (envelope.arm, the cockpit's owner.intent): the same rules — a live derived Lega session of THIS owner session. */
  function armConfirmation({ envelopeId, session, legaSessionId = null }) {
    const s = trust.requireSession(session, "fereastra de confirmare vocală");
    return armForLega({ envelopeId, legaSessionId, session: s, via: "cockpit" });
  }
  function disarm(envelopeId, reason) { return armedWindows.disarm(envelopeId, reason); }
  /** The armed window for this plan and session (null when none, expired, used, or the plan changed since). */
  function armedFor(envelopeId, sessionId, legaSessionId = null) {
    const w = armedWindows.armedFor(envelopeId, sessionId, legaSessionId);
    return w ? { ...w, env: get(envelopeId) } : null;
  }
  /**
   * Called when a gate segment's local transcript is final: confirms the armed plan if every check holds; otherwise does nothing.
   * The idempotency key is the utterance (voice:<utteranceId>, derived in confirm()), so the page path and this one never conflict.
   */
  async function confirmFromArmed({ utteranceId, envelopeId, sessionId, legaSessionId = null }) {
    // Review #15: the segment was bound by the SERVER to exactly this armed plan, so another project's plan still waiting for its own
    // confirmation cannot turn "Da, execută planul" into "Care plan?". The flag is internal (no command or route can pass it).
    const out = await armedWindows.confirmFrom({ planId: envelopeId, utteranceId, sessionId, legaSessionId },
      (w) => confirmImpl({ envelopeId, nonce: w.nonce, displayedHash: w.hash, session: { id: sessionId }, modality: "voice", utteranceId }, { armedBound: true }));
    return out.confirmed ? { confirmed: true, duplicate: out.duplicate, envelope: out.result?.envelope || view(envelopeId) } : out;
  }

  // ---------- confirm ----------
  /**
   * The owner's one confirmation. `modality`: "click" | "keyboard" | "typed" | "voice". Voice counts only with local
   * verification evidence (speaker gate + local transcription); a provider transcript or an LLM's claim never does.
   */
  async function confirm(args) { return confirmImpl(args, {}); }
  /** `internal.armedBound`: only confirmFromArmed sets it (the server bound the spoken segment to this plan's armed window). */
  async function confirmImpl({ envelopeId, nonce, displayedHash, session, modality = "click", utteranceId = null, idempotencyKey = null }, { armedBound = false } = {}) {
    const policy = trust.policy();
    if (!policy.active) throw new HubError("policy", "Politica voice-first nu este activă: confirmarea trece prin Aprobări, ca până acum (modul legacy)");
    const s = trust.requireSession(session, "confirmarea unei misiuni");
    // M10.2 U13: a spoken confirmation is keyed by its utterance, whoever forwards it (the armed window, the page's owner.intent, the
    // plan's mic button): the second path finds the same key on the consent and gets { duplicate: true }, never a conflict.
    if (modality === "voice" && utteranceId) idempotencyKey = `voice:${String(utteranceId).slice(0, 80)}`;
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
      // Review #15: an armed segment is scoped to its armed plan (claimForConfirmation still checks row.envelopeId === env.id and purpose
      // gate); a page-tagged or mic-button segment keeps the M07 rule over every pending plan (m07-voice).
      const candidates = armedBound ? [{ id: env.id, title: env.summary?.headline || "" }] : pending().map((e) => ({ id: e.id, title: e.summary?.headline || "" }));
      spoken = voice.claimForConfirmation({ utteranceId, session: s, envelope: env, pendingEnvelopes: candidates, notBefore: env.createdAt });
    }
    // Nothing may have changed since the owner saw it.
    const project = projects.get(env.projectId);
    // M10.2 (U12): a run plan (one bounded model step) is rebuilt from its own request; everything after (the same-status recheck, the
    // hash, readiness, the consumable confirmation) is the same code as for a mission plan.
    const isRun = env.body.kind === "run";
    const isContinuation = !isRun && Boolean(env.body.continuation);
    let views = null;
    let body;
    if (isRun) body = await runBodyNow(env, project);
    else {
      try { views = isContinuation ? planViews(project, env.missionIds, { continuation: true, forConfirm: true }) : env.missionIds.map((id) => factory.view(id)); }
      catch (error) { bus.transaction(() => setStatus(env.id, "SUPERSEDED", { reason: error.message, from: ["PROPOSED"] })); throw new HubError("conflict", `Planul nu mai e valabil: ${error.message}`); }
      if (views.some((v) => !v?.scope)) { bus.transaction(() => setStatus(env.id, "SUPERSEDED", { reason: "O misiune nu mai are un scope complet", from: ["PROPOSED"] })); throw new HubError("conflict", "Planul nu mai e valabil: o misiune s-a schimbat"); }
      // An objective's plan is rebuilt from the objective as it is NOW: an amended (superseded) objective is no longer this plan.
      let objectiveNow = null;
      if (env.body.objective?.id) {
        try { objectiveNow = objectiveRefFor(env.body.objective.id, env.projectId, env.missionIds); }
        catch (error) { bus.transaction(() => setStatus(env.id, "SUPERSEDED", { reason: error.message, from: ["PROPOSED"] })); throw new HubError("conflict", `Planul nu mai e valabil: ${error.message}`); }
      }
      body = await buildBody(project, views, env.autonomyLevel, Object.fromEntries((env.body.ownerConstraints || []).map((k) => [k, true])), objectiveNow);
    }
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
    const recheck = () => (isRun ? runReadiness(project, runRequestOf(env.body)) : readiness(project, views));
    // Review #1/#3/#31: a plan blocked ONLY by automatic readiness (same verified explanation as at proposal, re-read now) is
    // confirmable: the consent is recorded, the pre-steps run under it (readiness.afterConfirmation: the plan is OPEN and confirmed in
    // the owner session, which is the authority owner decision 3 requires for a same-fingerprint re-attestation), readiness is
    // checked again and the mission starts under the SAME consent — or the plan closes FAILED_TO_START with the honest cause.
    const ready = await withAutomaticReadiness(project, recheck(), isRun ? { kind: "run", req: runRequestOf(env.body) } : {});
    if (!ready.eligible && !ready.afterReadiness) throw new HubError("gate", `Nu pot porni: ${ready.blockers.map((b) => b.detail).slice(0, 4).join(" · ")}`, { data: { blockers: ready.blockers } });

    const consent = { channel: "owner_session", modality, sessionId: s.id, credential: s.credentialId.slice(0, 10), policyVersion: policy.version, envelopeHash: env.envelopeHash,
      confirmedAt: iso(), idempotencyKey: idempotencyKey ? String(idempotencyKey).slice(0, 120) : null, voice: spoken ? spoken.evidence : null,
      ...(ready.afterReadiness ? { afterReadiness: { preSteps: ready.preSteps || [], causes: ready.explanation?.causes || [] } } : {}) };
    // M10.2 (U11): the authorized time starts when the owner CONFIRMS (not when the plan was shown): up to 15 minutes of reading the
    // card no longer eat the window. A continuation's window is the fresh one its card showed.
    const expiresAt = new Date(Date.parse(consent.confirmedAt) + (env.body.limits.maxDurationMin + ENVELOPE_LIMITS.slackMin) * 60000).toISOString();
    // A continuation replaces the plan still in force for its mission (a binding / route change while it waited): that plan is
    // superseded and its grants revoked in the SAME transaction, so there is never a moment with two authorities for one mission.
    let replaced = null;
    // Atomic, consumable: a second tab, a double "yes" or a reconnect finds it no longer PROPOSED (and the unique index refuses
    // a second open authority on the same project).
    try {
      const changed = bus.transaction(() => {
        // The spoken "yes" counts once: a replay, a second tab or a reconnect finds it consumed.
        if (spoken && spoken.consume(env.id) !== 1) throw new HubError("conflict", "Fraza vocală a fost deja folosită pentru o confirmare");
        const prior = isContinuation ? envelopeOfMission(env.body.continuation.missionId) : null;
        if (prior && prior.id !== env.id) {
          setStatus(prior.id, "SUPERSEDED", { reason: `Continuat de planul ${env.id} (confirmat în sesiunea ${s.id})`, from: [...OPEN] });
          for (const g of grants.ofEnvelope(prior.id).filter((x) => x.status === "active")) grants.revoke(g.id, `envelope:${prior.id}`);
          replaced = prior.id;
        }
        const n = setStatus(env.id, "CONFIRMED", { reason: `Confirmat (${modality}) în sesiunea ${s.id}`, from: ["PROPOSED"], extra: { owner_session_id: s.id, consent_json: json(consent), confirmed_at: consent.confirmedAt, idempotency_key: consent.idempotencyKey, current_mission_id: env.missionIds[0] || null, expires_at: expiresAt } });
        if (n) bus.append({ type: "envelope.confirmed", scopeType: "envelope", scopeId: env.id, projectId: env.projectId, source: "owner", payload: { channel: "owner_session", modality, session: s.id, hash: env.envelopeHash.slice(0, 16) } });
        return n;
      });
      if (changed !== 1) throw new HubError("conflict", "Planul a fost deja confirmat (altă filă sau o confirmare dublă)");
    } catch (error) {
      if (/UNIQUE|constraint/i.test(String(error.message))) throw new HubError("conflict", "Proiectul are deja o misiune autorizată în curs; oprește-o sau așteaptă să se termine");
      throw error;
    }
    if (replaced) releaseMode(replaced);
    env = get(env.id);
    let prevHold = null;
    try {
      if (ready.afterReadiness) {
        // The pre-steps the card showed, under this consent (inference-free; at most one automatic attestation per version).
        let pass = await readinessApi.afterConfirmation(env.id);
        if (pass?.busy) { await Promise.resolve(pass.pending).catch(() => null); pass = await readinessApi.afterConfirmation(env.id); }
        const now_ = recheck();
        if (!now_.eligible) {
          const failed = (pass?.steps || []).filter((x) => !x.ok).map((x) => `${x.command}: ${x.reason || x.error || x.status || "nereușit"}`).slice(0, 3);
          throw new HubError("gate", `pașii de pregătire nu au deblocat planul (${[...failed, ...now_.blockers.map((b) => b.detail)].slice(0, 4).join(" · ")})`);
        }
        bus.emit({ type: "envelope.readiness_cleared", scopeType: "envelope", scopeId: env.id, projectId: env.projectId, source: "envelopes",
          payload: { steps: (pass?.steps || []).map((x) => ({ command: x.command, ok: x.ok })), causes: ready.explanation?.causes || [] } });
      }
      // M10.2: under envelope-scoped authority (the hashed SCOPED_LIVE_TRANSITION) nothing here writes settings.mode or the hold:
      // the plan admits its own steps at the gate. Only the legacy wording (flag off) still enters or joins LIVE_VALIDATION.
      const legacyHold = !scopedLive();
      if (legacyHold && body.modeTransition === LEGACY_TRANSITION && settings.get("mode") === "BUILD_SAFE") {
        // Only this plan holds the LIVE_VALIDATION it enters. Plans whose hold a boot suspended stay suspended beside it: only an
        // explicit resume of one of them makes it a holder again (M07 review round 3), and when this plan ends the suspended hold
        // comes back as it was.
        prevHold = settings.get("envelopeModeHold") || {};
        const suspended = prevHold.suspendedByBoot ? prevHold : prevHold.suspended || null;
        bus.transaction(() => {
          settings.set("mode", "LIVE_VALIDATION", "owner", `Envelope ${env.id}: LIVE_VALIDATION pe durata misiunii`);
          settings.set("envelopeModeHold", { envelopeId: env.id, holders: [env.id], since: iso(), ...(suspended ? { suspended } : {}) }, "owner", "Mode held by an envelope");
        });
      } else if (legacyHold && settings.get("mode") === "LIVE_VALIDATION" && (settings.get("envelopeModeHold") || {}).envelopeId) {
        // Confirmed while the plans hold LIVE_VALIDATION: it relies on that mode too, so it holds it until it closes.
        const hold = settings.get("envelopeModeHold");
        bus.transaction(() => settings.set("envelopeModeHold", { ...hold, holders: [...new Set([...holdersOf(hold), env.id])] }, "envelopes", `Plan ${env.id} joins the mode hold`));
      }
      if (isRun) await startRun(env, s);
      else if (isContinuation) await continueMission(env, env.missionIds[0], s);
      else await startMission(env, env.missionIds[0], s);
      bus.transaction(() => setStatus(env.id, "ACTIVE", { reason: isRun ? "Execuția a pornit" : isContinuation ? "Misiunea continuă de unde a rămas" : "Prima misiune a pornit", from: ["CONFIRMED"], extra: { current_mission_id: env.missionIds[0] || null } }));
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
      throw new HubError(error.category || "gate", `Confirmarea a fost înregistrată, dar ${isRun ? "execuția" : "misiunea"} nu a pornit: ${error.message}. Nimic nu rulează; granturile derivate au fost revocate.`, { data: { envelopeId: env.id } });
    }
    return { envelope: view(env.id), duplicate: false };
  }

  function changedParts(before, after) {
    const keys = ["missions", "run", "baseSnapshot", "attestationRefs", "workspaceScope", "limits", "modeTransition", "models", "effortPolicy", "autonomyLevel"];
    const labels = CHANGE_LABELS;
    const out = keys.filter((k) => hashCanonical(before?.[k] ?? null) !== hashCanonical(after?.[k] ?? null)).map((k) => labels[k]);
    // M10.2 (U12): a run plan's binding changed under the same label (CLI version, model list) is named like a mission's.
    if ((before?.run || after?.run) && (before?.run?.binding?.bindingHash || null) !== (after?.run?.binding?.bindingHash || null) && !out.includes(labels.models)) out.push("legătura modelului (lista de modele sau versiunea Claude Code)");
    // M09: a binding that changed under the same model label (e.g. the Claude CLI version or the model list behind it) is named too.
    const bindingsOf = (body) => (body?.missions || []).map((e) => [e.missionId, e.bindings?.writer?.bindingHash || null, e.bindings?.reviewer?.bindingHash || null]);
    if (hashCanonical(bindingsOf(before)) !== hashCanonical(bindingsOf(after)) && !out.includes(labels.models)) out.push("legătura modelelor (lista de modele sau versiunea Claude Code)");
    return out.length ? out : ["conținutul planului"];
  }

  // ---------- CapabilityIssuer ----------
  /**
   * M10.2 (U11): the attempts the plan authorizes for ONE role of ONE mission, over all its grants: (1 + the repair cycles shown on
   * the card + the extra cycles the owner confirmed as deltas + M11 L5 the author cycles of step 0 the card showed) × attempts per stage,
   * plus the confirmed extra attempts (and, for a continuation, the one more attempt of the exhausted step its card showed). Never more
   * than what the owner saw. With the defaults a test-first plan gives (1 + 2 + 0 + 2) × 2 = 10 attempts per role (6 without step 0):
   * each author cycle is one Claude turn (the reviewer's binding) and one Codex test review (the writer's, read-only).
   */
  function budgetOf(env, missionId) {
    const entry = env.body.missions.find((m) => m.missionId === missionId);
    if (!entry) return 0;
    const cycles = env.body.limits.maxRepairCycles?.[missionId] ?? 0;
    const extraCycles = env.derived?.extraCycles?.[missionId] || 0;
    const authoring = Number(entry.testFirst?.remainingAuthoring) || 0;
    const extraAttempts = (env.derived?.extraAttempts?.[missionId] || 0) + (entry.continuation?.extraAttempt ? 1 : 0);
    return (1 + cycles + extraCycles + authoring) * entry.limits.maxAttemptsPerStage + extraAttempts;
  }
  /**
   * What this plan's grants for (mission, role) already hold: the attempts spent by grants that are closed (exhausted, revoked,
   * expired) plus the full allowance of the active ones. A refund (pre-inference) lowers it again, exactly as it lowers the grant.
   */
  function allocatedOf(envelopeId, missionId, role) {
    return grants.ofEnvelope(envelopeId).filter((g) => g.kind === "run" && g.binding?.missionId === missionId && g.binding?.role === role)
      .reduce((n, g) => n + (g.status === "active" ? g.maxAttempts : g.attemptsUsed), 0);
  }
  /**
   * Review #2/#9: was this derived grant revoked by someone other than its own plan (the Integrations "Revocă", grant.revoke from voice,
   * the companion or a delegated agent — a fail-safe)? Decided on the FIRST grant.revoked event of the grant (a later click on an already
   * revoked grant changes nothing). The plan's own revocations (close, the next mission, a hold) are recorded as `envelope:<id>`.
   */
  function externallyRevoked(g, envelopeId = g?.envelopeId) {
    if (!g || g.status !== "revoked" || !envelopeId) return false;
    const first = db.prepare("SELECT source FROM events WHERE type = 'grant.revoked' AND scope_id = ? ORDER BY seq LIMIT 1").get(g.id);
    return Boolean(first) && first.source !== `envelope:${envelopeId}`;
  }

  /** The grants one mission of the envelope needs (only `roles`), each no wider than the envelope and inside its remaining budget. */
  function deriveGrants(env, missionId, roles = ["writer", "reviewer"]) {
    const entry = env.body.missions.find((m) => m.missionId === missionId);
    if (!entry) throw new HubError("policy", "Misiunea nu face parte din plan");
    const budget = budgetOf(env, missionId);
    const remainingMin = Math.floor((Date.parse(env.expiresAt) - now().getTime()) / 60000);
    if (remainingMin < 5) throw new HubError("gate", "Autoritatea planului a expirat");
    const ttlMinutes = Math.min(480, remainingMin);
    const maxDurationS = Math.min(7200, Math.max(60, entry.limits.maxDurationMin * 60));
    // M09: each grant names the binding (model, effort, hash) of its role: it serves only a run dispatched under that binding.
    return roles.map((role) => {
      const allocated = allocatedOf(env.id, missionId, role);
      const attempts = Math.min(ENVELOPE_LIMITS.grantMaxAttempts, budget - allocated);
      return attempts >= 1 ? { role, provider: entry.routes[role].provider, access: entry.routes[role].access, maxAttempts: attempts, ttlMinutes, maxDurationS, binding: grantBindingOf(entry.bindings?.[role]), allocated } : null;
    }).filter(Boolean);
  }

  /** Refuses any derived grant that would exceed the envelope (provider, access, project, attempts, duration, expiry, binding). */
  function assertWithin(env, spec, { projectId, missionId = null, allocated = 0 }) {
    const problems = [];
    if (projectId !== env.projectId) problems.push("alt proiect");
    // M09: the grant's binding must be exactly one the plan confirmed for that role (of the given mission, or of any mission).
    const confirmed = env.body.missions.filter((m) => !missionId || m.missionId === missionId).map((m) => m.bindings?.[spec.role]?.bindingHash).filter(Boolean);
    if (!spec.binding?.bindingHash) problems.push("fără modelul confirmat");
    else if (!confirmed.includes(spec.binding.bindingHash)) problems.push(`model ${spec.binding.model || "?"} în afara planului`);
    else if (spec.binding.provider && spec.binding.provider !== spec.provider) problems.push("legătura e pentru alt provider");
    if (!env.body.providers.includes(spec.provider)) problems.push(`provider ${spec.provider} în afara planului`);
    const role = spec.role === "writer" ? "writer" : spec.role === "reviewer" ? "reviewer" : null;
    if (!role || !env.body.allowedRoles.includes(role)) problems.push(`rol ${spec.role} în afara planului`);
    if (role === "reviewer" && spec.access !== "read-only") problems.push("reviewer-ul poate doar citi");
    if (role === "writer" && !["workspace-write", "read-only"].includes(spec.access)) problems.push("acces necunoscut");
    if (!(spec.maxAttempts >= 1 && spec.maxAttempts <= ENVELOPE_LIMITS.grantMaxAttempts)) problems.push("încercări peste limită");
    // Cumulative (M10.2): with a mission named, what the plan's grants for this role already hold plus this grant may not exceed
    // the mission's budget; without one, a single grant may not exceed the largest mission budget.
    if (missionId) { if (allocated + spec.maxAttempts > budgetOf(env, missionId)) problems.push("încercări peste plan"); }
    else if (spec.maxAttempts > Math.max(...env.body.missions.map((m) => budgetOf(env, m.missionId)))) problems.push("încercări peste plan");
    if (spec.maxDurationS > env.body.limits.maxDurationMin * 60) problems.push("durată peste plan");
    if (now().getTime() + spec.ttlMinutes * 60000 > Date.parse(env.expiresAt) + 1000) problems.push("expiră după plan");
    if (problems.length) throw new HubError("policy", `Grant derivat refuzat (mai larg decât planul): ${problems.join(", ")}`);
    return true;
  }

  function issueGrants(env, missionId, roles = ["writer", "reviewer"], { topUp = false } = {}) {
    // Counted and created in ONE transaction (node:sqlite is synchronous): two dispatches can never both see the same remainder.
    const issued = bus.transaction(() => deriveGrants(env, missionId, roles).map((spec) => {
      assertWithin(env, spec, { projectId: env.projectId, missionId, allocated: spec.allocated });
      const g = grants.create({ provider: spec.provider, projectId: env.projectId, access: spec.access, maxAttempts: spec.maxAttempts, maxDurationS: spec.maxDurationS,
        ttlMinutes: Math.max(5, spec.ttlMinutes), expiresAt: env.expiresAt, envelopeId: env.id, binding: { ...spec.binding, missionId }, note: `Derivat din planul ${env.id} (${spec.role}, misiunea ${missionId}, ${spec.binding.model} · ${spec.binding.effort})` }, `envelope:${env.id}`);
      return { grantId: g.id, role: spec.role, provider: g.provider, access: g.access, maxAttempts: g.maxAttempts, expiresAt: g.expiresAt, model: spec.binding.model, effort: spec.binding.effort, bindingHash: spec.binding.bindingHash };
    }));
    if (!issued.length) return issued;
    bus.transaction(() => {
      const derived = get(env.id).derived || {};
      db.prepare("UPDATE mission_envelopes SET derived_json = ?, updated_at = ? WHERE id = ?").run(json({ ...derived, grants: [...(derived.grants || []), ...issued.map((g) => ({ ...g, missionId }))] }), iso(), env.id);
      bus.append({ type: "envelope.grants_derived", scopeType: "envelope", scopeId: env.id, projectId: env.projectId, source: "envelopes", payload: { missionId, topUp, budget: budgetOf(get(env.id), missionId),
        grants: issued.map((g) => ({ id: g.grantId, role: g.role, provider: g.provider, access: g.access, attempts: g.maxAttempts, model: g.model, effort: g.effort })) } });
    });
    return issued;
  }

  /**
   * M10.2 (U11) cumulative top-up: called before a plan step starts (factory dispatch) and after a confirmed delta. When the role has
   * no active grant with an attempt left, the plan derives a new bound grant for the REST of its budget (≤ 5 per grant), same binding,
   * same mission, never past the plan's expiry. Beyond the budget nothing is issued (the gate then refuses, as for any step the plan
   * does not cover). Returns { grantId } | { exhausted: true } | null (nothing to do / not a plan step).
   */
  function topUp(missionId, role, bindingHash) {
    const env = envelopeOfMission(missionId);
    if (!env || !["writer", "reviewer"].includes(role) || !bindingHash) return null;
    if (new Date(env.expiresAt) <= now() || !trust.policy().active) return null;
    const entry = env.body.missions.find((m) => m.missionId === missionId);
    if (!entry?.bindings?.[role]?.bindingHash || entry.bindings[role].bindingHash !== bindingHash) return null;
    if (env.status === "WAITING_OWNER" && env.derived?.hold) return null;
    return bus.transaction(() => {
      const fresh = get(env.id);
      if (!fresh || !OPEN.has(fresh.status)) return null;
      const mine = grants.ofEnvelope(env.id).filter((g) => g.kind === "run" && g.binding?.missionId === missionId && g.binding?.role === role);
      const usable = mine.some((g) => g.status === "active" && g.binding?.bindingHash === bindingHash && g.attemptsUsed < g.maxAttempts);
      if (usable) return null;
      // Review #2/#9 (defence in depth; the bus listener closes such a plan right after the commit): a derived grant the owner revoked
      // is the owner withdrawing the plan, never a "spent" grant to top up — refundAttempt never revives a revoked grant, and neither
      // does this. The step is held with the reason; the gate then refuses it (no active plan grant).
      if (mine.some((g) => externallyRevoked(g, env.id))) {
        const hold = "Ai revocat un grant derivat al planului; planul nu mai pornește pași noi (cere un plan nou ca să continui)";
        db.prepare("UPDATE mission_envelopes SET derived_json = ?, updated_at = ? WHERE id = ?").run(json({ ...(fresh.derived || {}), hold }), iso(), env.id);
        bus.append({ type: "envelope.topup_refused", scopeType: "envelope", scopeId: env.id, projectId: env.projectId, source: "envelopes", payload: { missionId, role, reason: "grant_revoked_externally" } });
        return { held: true };
      }
      const before = allocatedOf(env.id, missionId, role);
      if (budgetOf(fresh, missionId) - before < 1) {
        bus.append({ type: "envelope.budget_exhausted", scopeType: "envelope", scopeId: env.id, projectId: env.projectId, source: "envelopes", payload: { missionId, role, budget: budgetOf(fresh, missionId), allocated: before } });
        return { exhausted: true };
      }
      const [g] = issueGrants(fresh, missionId, [role], { topUp: true });
      return g ? { grantId: g.grantId, attempts: g.maxAttempts } : null;
    });
  }

  /**
   * Review #11: the factory does not count a step it interrupted (Pause, Stop, „Oprește Codex”, the plan's own pause) as an attempt
   * (modelAttempts skips INTERRUPTED), but the grant attempt was consumed and — the turn having been sent — never refunded, so the
   * plan's budget ((1 + cycles) × attempts per role) ran out after a few pause/resume rounds while the card still showed room. The plan
   * gives that one attempt back to the grant it came from (grants.refundAttempt: never revives a revoked or expired grant) — at most
   * ENVELOPE_LIMITS.maxForgivenAttempts times per mission and role per plan, each recorded, so pause loops cannot buy unlimited turns.
   * A start stopped before the turn was already refunded by the run manager (refundPreInference): never twice.
   */
  function forgiveInterrupted(missionId, grantId, runId) {
    const env = envelopeOfMission(missionId);
    if (!env || !grantId || !runId) return null;
    const g = grants.get(grantId);
    if (!g || g.envelopeId !== env.id || g.binding?.missionId !== missionId || !["writer", "reviewer"].includes(g.binding?.role)) return null;
    const run = db.prepare("SELECT status, pre_inference, timeline_json FROM agent_runs WHERE id = ? AND grant_id = ?").get(String(runId), g.id);
    if (!run || run.status !== "interrupted") return null;
    const turnSent = Boolean(parse(run.timeline_json, {}).turn_sent);
    if (run.pre_inference && !turnSent) return null; // refunded already (runs.mjs refundPreInference)
    return bus.transaction(() => {
      const already = db.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'envelope.attempt_forgiven' AND scope_id = ? AND json_extract(payload_json, '$.missionId') = ? AND json_extract(payload_json, '$.role') = ?").get(env.id, missionId, g.binding.role).n;
      if (db.prepare("SELECT 1 FROM events WHERE type = 'envelope.attempt_forgiven' AND scope_id = ? AND json_extract(payload_json, '$.runId') = ? LIMIT 1").get(env.id, String(runId))) return null;
      if (already >= ENVELOPE_LIMITS.maxForgivenAttempts) {
        bus.append({ type: "envelope.attempt_forgive_refused", scopeType: "envelope", scopeId: env.id, projectId: env.projectId, source: "envelopes", payload: { missionId, role: g.binding.role, runId, cap: ENVELOPE_LIMITS.maxForgivenAttempts } });
        return null;
      }
      const before = g.attemptsUsed;
      const after = grants.refundAttempt(g.id, `envelope:${env.id}`, `${runId} întrerupt după trimiterea turnului (nu e o încercare pentru fabrică)`);
      if (!after || after.attemptsUsed === before) return null; // a revoked / expired grant gives nothing back
      bus.append({ type: "envelope.attempt_forgiven", scopeType: "envelope", scopeId: env.id, projectId: env.projectId, source: "envelopes", payload: { missionId, role: g.binding.role, runId, grantId: g.id, count: already + 1 } });
      return { grantId: g.id, attemptsUsed: after.attemptsUsed };
    });
  }

  /**
   * Continues ONE started mission under a confirmed continuation plan: the confirmed bindings replace the old ones (audited rebind,
   * scope hash recomputed), an exhausted step gets the one attempt the card showed, the plan derives its bound grants and the mission
   * resumes through the ordinary factory.resume — no factory.start, no new factory.scope approval (the scope is the approved one).
   */
  async function continueMission(env, missionId, session) {
    const entry = env.body.missions.find((m) => m.missionId === missionId);
    const cont = factory.continuationScope(missionId);
    if (!entry?.continuation || !cont.scope || hashCanonical(cont.scope) !== entry.scopeHash) throw new HubError("conflict", `Starea misiunii „${entry?.title || missionId}” s-a schimbat după confirmare`);
    const now_ = get(env.id);
    if (!now_ || !OPEN.has(now_.status)) throw new HubError("conflict", "Planul s-a închis între timp; misiunea nu continuă");
    const actor = `envelope:${env.id}`;
    if ((entry.continuation.rebind || []).length) factory.rebindForPlan(missionId, { bindings: entry.bindings, actor, envelopeId: env.id });
    if (entry.continuation.extraAttempt) factory.raiseLimits(missionId, { attempt: true, actor, envelopeId: env.id });
    issueGrants(get(env.id), missionId);
    const resumed = await factory.resume(missionId, { actor: `owner:${session.id}` });
    bus.emit({ type: "envelope.mission_continued", scopeType: "envelope", scopeId: env.id, projectId: env.projectId, source: "envelopes",
      payload: { missionId, from: entry.continuation.fromEnvelopeId, stage: resumed?.factory?.stage || null, rebind: entry.continuation.rebind || [], extraAttempt: Boolean(entry.continuation.extraAttempt) } });
    return resumed;
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
  /**
   * Returns null (allowed) or { reason } (the step waits for the owner). Only missions under an envelope are affected. `access` is the
   * access the step really runs with (factory dispatchRun, M11 L5 S4).
   */
  function authorityFor(missionId, { stage, cycle, role = null, bindingHash = null, grantId = null, runId = null, access = null }) {
    // M10.2 (U11): "GRANT" tops up the role's derived grant inside the plan's budget (never holds the step); "RESUME" tells the
    // factory which plan a resume runs under ({ plan: { envelopeId, expiresAt, maxCycles } }) so it never widens it by itself.
    if (stage === "GRANT") { try { topUp(missionId, role, bindingHash); } catch { /* the gate decides: no grant → refused, never a manual one */ } return null; }
    // Review #11: a plan step the owner (or the plan) interrupted after its turn was sent is not an attempt for the factory; the plan
    // gives the grant attempt back, bounded, so pause/resume rounds inside the card's limits never end at BLOCKED "grant".
    if (stage === "INTERRUPTED") { try { forgiveInterrupted(missionId, grantId, runId); } catch { /* never breaks the factory's bookkeeping */ } return null; }
    const env = envelopeOfMission(missionId);
    if (!env) return null;
    if (stage === "RESUME") {
      const allowed = env.body.limits.maxRepairCycles?.[missionId] ?? 0;
      const extra = (env.derived?.extraCycles || {})[missionId] || 0;
      return { plan: { envelopeId: env.id, status: env.status, expiresAt: env.expiresAt, maxCycles: allowed + extra + (env.body.missions.find((m) => m.missionId === missionId)?.continuation?.repairCyclesUsed || 0) } };
    }
    // M09: a model change (resume with another reviewer) is never inside a confirmed plan: its grants are bound to the confirmed model.
    if (stage === "MODEL_OVERRIDE") return { reason: `misiunea rulează sub planul ${env.id} (${env.status}), confirmat cu ${bindingLabel(env.body.missions.find((m) => m.missionId === missionId)?.bindings?.[role || "reviewer"])}` };
    if (new Date(env.expiresAt) <= now()) return { reason: "Autoritatea planului a expirat; confirmă un plan nou ca să continui" };
    // M09: the step's binding must be the one the owner confirmed for that role of this mission.
    if (role) {
      const confirmed = env.body.missions.find((m) => m.missionId === missionId)?.bindings?.[role] || null;
      if (!confirmed?.bindingHash || confirmed.bindingHash !== bindingHash) return { reason: `Modelul pasului (${role}) nu este cel confirmat în plan (${bindingLabel(confirmed)}); confirmă un plan nou` };
    }
    if (env.status === "WAITING_OWNER" && env.derived?.hold) return { reason: env.derived.hold };
    // M11 L5 (§4 S4): step 0 runs only read-only (the Hub writes the test itself) and only as the card showed it. Without this refusal the
    // writer's derived workspace-write grant would admit a writing test review (a grant admits a narrower step, never a wider one); a
    // rewrite beyond reauthorMax is outside the plan, like a repair cycle beyond the confirmed ones.
    if (STAGE_ZERO.has(stage)) {
      const label = factoryStageLabel(stage);
      const tf = env.body.missions.find((m) => m.missionId === missionId)?.testFirst || null;
      if (access !== "read-only") return { reason: `${label}: pasul 0 rulează doar în citire (testul îl scrie Hub-ul); planul confirmat nu admite ${access === "workspace-write" ? "un pas care scrie în proiect" : "un pas cu acces nedeclarat"}` };
      if (!tf) return { reason: `${label}: planul confirmat nu are pasul 0 (testul scris de Hub); cere un plan nou ca să-l vezi și să-l confirmi` };
      if (Number(cycle) > Number(tf.reauthorMax)) return { reason: `${label}: rescrierea ${cycle} depășește planul confirmat (cel mult ${tf.reauthorMax}); testul nu se mai rescrie, decizia e a ta` };
    }
    const allowed = env.body.limits.maxRepairCycles?.[missionId] ?? 0;
    const extra = (env.derived?.extraCycles || {})[missionId] || 0;
    // A continuation counts the cycles the mission already used before it (its card authorizes only the ones that remain).
    const before = env.body.missions.find((m) => m.missionId === missionId)?.continuation?.repairCyclesUsed || 0;
    if (stage === "REPAIRING" && cycle > before + allowed + extra) return { reason: `Ciclul ${cycle} depășește planul confirmat (${before + allowed + extra}); confirmă diferența: un ciclu de remediere în plus` };
    return null;
  }

  // ---------- M10.2: envelope-scoped live authority (asked by the gate for a bound plan step in BUILD_SAFE) ----------
  /**
   * null when no plan of this mission is in force (or the flag is off): the gate then decides exactly as before. Otherwise
   * { envelopeId, grantId } only for an OPEN (CONFIRMED / ACTIVE / WAITING_OWNER), unexpired envelope, under the active
   * voice-first policy, whose ACTIVE derived grant is bound to exactly this binding and this mission and passes every grant
   * check; { envelopeId, grantId: null, problem } names why a plan in force does not admit the step. Read-only: the attempt is
   * consumed by the run manager after the whole gate passed (runs.mjs), as for any grant.
   */
  function liveAuthority(missionId, bindingHash, { provider = null, projectId = null, access = "read-only" } = {}) {
    if (!scopedLive() || !missionId || !bindingHash) return null;
    // M10.2 (U12): the step of a run plan names its plan as its scope ("envrun:<id>"), never a mission.
    const runEnvelopeId = runEnvelopeIdOf(missionId);
    if (runEnvelopeId) return runLiveAuthority(runEnvelopeId, bindingHash, { provider, projectId, access });
    // The open plan of the mission; failing that, the last plan that was confirmed for it (closed now: revoked, expired, completed),
    // only so the refusal names it — a closed plan never admits anything.
    const env = envelopeOfMission(missionId) || rowTo(db.prepare("SELECT * FROM mission_envelopes WHERE confirmed_at IS NOT NULL AND EXISTS (SELECT 1 FROM json_each(mission_envelopes.mission_ids_json) WHERE value = ?) ORDER BY created_at DESC LIMIT 1").get(String(missionId)));
    if (!env) return null;
    const refuse = (problem) => ({ envelopeId: env.id, grantId: null, problem });
    if (!OPEN.has(env.status)) return refuse(`planul este ${env.status}`);
    if (new Date(env.expiresAt) <= now()) return refuse("timpul autorizat al planului s-a terminat");
    // Back to the legacy policy is the owner's fail-safe: no plan admits a step in BUILD_SAFE after it.
    if (!trust.policy().active) return refuse("politica voice-first nu mai este activă");
    if (projectId && projectId !== env.projectId) return refuse("pasul este pe alt proiect decât planul");
    const t = now();
    const candidates = grants.ofEnvelope(env.id).filter((g) => g.kind === "run" && g.status === "active" && g.binding?.bindingHash === bindingHash && g.binding?.missionId === missionId);
    const usable = candidates.find((g) => !grants.problem(g, { provider: provider || g.provider, projectId: projectId || env.projectId, access, now: t, bindingHash, missionId, planRun: true }));
    if (!usable) return refuse(candidates.length ? `grantul derivat nu admite pasul (${grants.problem(candidates[0], { provider: provider || candidates[0].provider, projectId: projectId || env.projectId, access, now: t, bindingHash, missionId, planRun: true })})` : "planul nu are un grant derivat activ pentru acest model și această misiune");
    return { envelopeId: env.id, grantId: usable.id };
  }

  /** The plans whose steps may run live right now (read-only, for /api/state: "BUILD_SAFE + 1 plan activ"). */
  function liveScopes() {
    const t = now();
    return db.prepare("SELECT * FROM mission_envelopes WHERE status IN ('CONFIRMED','ACTIVE','WAITING_OWNER') ORDER BY created_at").all().map(rowTo)
      .filter((e) => new Date(e.expiresAt) > t)
      .map((e) => ({ envelopeId: e.id, projectId: e.projectId, status: e.status, missionId: e.currentMissionId || e.missionIds[0] || null, missionIds: e.missionIds, expiresAt: e.expiresAt,
        scoped: scopedLive(), kind: e.body?.kind === "run" ? "run" : "missions", ...(e.body?.kind === "run" ? { runId: e.derived?.runId || null } : {}) }));
  }

  /**
   * The difference a plan would need to go on for this mission, as the Hub sees it (read-only; what the card shows before the owner
   * confirms it): one more attempt of the step whose confirmed attempts are spent, otherwise one more repair cycle.
   */
  function deltaOf(envelopeId, missionId) {
    const env = get(envelopeId);
    if (!env || !OPEN.has(env.status) || !env.missionIds.includes(missionId)) return null;
    // Review #12: a plan held by advance() (an objective's dependency not delivered, the next mission that did not start) has no
    // difference to confirm — its hold IS the answer; and a mission that is not waiting (running, delivered) has nothing to continue.
    if (env.derived?.hold) return null;
    const f = factory.list().find((x) => x.missionId === missionId) || null;
    if (!f || !CONTINUABLE.has(f.stage)) return null;
    // M11 L5 (§4 S5): the stage is named in the owner's words (factoryStageLabel), never as its code.
    const step = factory.exhaustedStep ? factory.exhaustedStep(missionId) : null;
    if (step) return { kind: "attempt", stage: step.stage, text: `O încercare în plus pentru etapa „${factoryStageLabel(step.stage)}” (${step.counted}/${step.limit} folosite), în același plan și aceleași limite de timp.` };
    // Review #11: the PLAN's attempt budget is spent while the factory's own limit is not (the gate refused the step: BLOCKED) — the
    // difference is one more attempt of the plan, never a repair cycle the owner was not stuck on.
    const spent = budgetSpent(env, missionId, f);
    if (spent) return { kind: "attempt", stage: spent.stage, budget: true, text: `O încercare în plus pentru etapa „${factoryStageLabel(spent.stage)}” (încercările confirmate în plan s-au epuizat), în același plan și aceleași limite de timp.` };
    // M11 L5 (§4 S5): step 0 has no repair cycle to add — its only difference is one more attempt (above); otherwise there is none (a
    // step-0 outcome a resume cannot change stays the owner's decision: stop, or a new plan with the request said otherwise).
    if (factory.inStageZero?.(missionId)) return null;
    const cycle = (f?.repairCycles ?? 0) + 1;
    return { kind: "cycle", cycle, text: `Un ciclu de remediere în plus (ciclul ${cycle}), în același plan și aceleași limite de timp.` };
  }

  /**
   * Review #11: the plan's attempts for the role of the mission's last step are all spent (no usable active grant, nothing left in the
   * budget) while the mission waits at BLOCKED (the gate refused the step) — { stage, role } or null. Read-only.
   */
  function budgetSpent(env, missionId, f) {
    if (f?.stage !== "BLOCKED") return null;
    const last = db.prepare("SELECT stage FROM factory_dispatches WHERE mission_id = ? ORDER BY created_at DESC LIMIT 1").get(missionId);
    if (!last) return null;
    // M11 L5 (§4): the role whose binding the stage runs under (the factory's own map: the test's author under the reviewer's, its review
    // under the writer's); before it, every stage but REVIEWING counted as the writer's.
    const role = ROLE_OF_STAGE[last.stage] || "writer";
    const usable = grants.ofEnvelope(env.id).some((g) => g.kind === "run" && g.status === "active" && g.binding?.missionId === missionId && g.binding?.role === role && g.attemptsUsed < g.maxAttempts);
    return !usable && budgetOf(env, missionId) - allocatedOf(env.id, missionId, role) < 1 ? { stage: last.stage, role } : null;
  }

  /**
   * A confirmed delta inside the same plan; only the difference is presented to the owner (deltaOf). M10.2 (U11): the plan's limit AND
   * the mission's own factory limit are raised in ONE transaction (the M06 version raised only the plan's, so a mission at its
   * factory limit waited for a plan delta that refused it: a deadlock), the role grants are topped up inside the new budget, and the
   * mission resumes by itself after the commit (the confirmation IS the decision to go on). Bounded: at most maxDeltaCycles extra
   * cycles and maxDeltaAttempts extra attempts per mission per plan, each one confirmed on its own; never past the plan's expiry.
   */
  function confirmDelta({ envelopeId, missionId, session, modality = "click", kind = null }) {
    if (!trust.policy().active) throw new HubError("policy", "Politica voice-first nu este activă");
    const s = trust.requireSession(session, "confirmarea unei remedieri");
    const env = get(envelopeId);
    if (!env || !OPEN.has(env.status)) throw new HubError("conflict", "Planul nu mai este în vigoare");
    if (!env.missionIds.includes(missionId)) throw new HubError("policy", "Misiunea nu face parte din plan");
    if (new Date(env.expiresAt) <= now()) throw new HubError("conflict", "Timpul planului s-a terminat; confirmă continuarea (îți arăt doar ce rămâne)");
    if (!["click", "keyboard", "typed", "voice"].includes(modality)) throw new HubError("validation", "Modalitate necunoscută");
    // Review #12: a plan advance() held (dependency not delivered, next mission not started) is not waiting for a difference: confirming
    // one cleared the hold, raised the limit of a delivered mission and topped up idle grants while the next task never started.
    if (env.derived?.hold) throw new HubError("conflict", `Planul nu așteaptă o diferență: ${String(env.derived.hold).slice(0, 200)}`, { code: "NO_DELTA" });
    const stageNow = factory.list().find((x) => x.missionId === missionId)?.stage || null;
    if (!CONTINUABLE.has(stageNow)) throw new HubError("conflict", `Misiunea e în etapa ${stageNow || "necunoscută"}; nu e nicio diferență de confirmat`, { code: "NO_DELTA" });
    const shown = deltaOf(env.id, missionId);
    const k = kind || shown?.kind || "cycle";
    if (!["cycle", "attempt"].includes(k)) throw new HubError("validation", "Diferență necunoscută");
    // M11 L5 (§4 S5): step 0 has no repair cycles (the test is rewritten at most reauthorMax times, then the owner decides) — refused
    // before anything changes, whatever the client asked for.
    if (k === "cycle" && factory.inStageZero?.(missionId)) throw new HubError("conflict", "Etapa 0 nu are cicluri de remediere: testul de acceptanță se rescrie cel mult o dată, apoi decizia e a ta", { code: "NO_DELTA" });
    const extraCycles = { ...(env.derived?.extraCycles || {}) };
    const extraAttempts = { ...(env.derived?.extraAttempts || {}) };
    if (k === "cycle") {
      if ((extraCycles[missionId] || 0) + 1 > ENVELOPE_LIMITS.maxDeltaCycles) throw new HubError("policy", `Planul a primit deja ${ENVELOPE_LIMITS.maxDeltaCycles} cicluri de remediere în plus pentru această misiune; oprește-o sau decide asupra rezultatului`, { code: "DELTA_LIMIT" });
      extraCycles[missionId] = (extraCycles[missionId] || 0) + 1;
    }
    // Review #11: an "attempt" is either the factory's exhausted step (its own limit is raised for THAT stage only) or the plan's spent
    // budget while the factory's limit still has room (only the plan's budget grows, by exactly the one attempt shown).
    let factoryExhausted = false;
    if (k === "attempt") {
      factoryExhausted = Boolean(factory.exhaustedStep?.(missionId));
      if (!factoryExhausted && !budgetSpent(env, missionId, factory.list().find((x) => x.missionId === missionId))) throw new HubError("conflict", "Nicio etapă nu și-a epuizat încercările; nu e nicio diferență de confirmat", { code: "NO_DELTA" });
      if ((extraAttempts[missionId] || 0) + 1 > ENVELOPE_LIMITS.maxDeltaAttempts) throw new HubError("policy", `Planul a primit deja ${ENVELOPE_LIMITS.maxDeltaAttempts} încercări în plus pentru această misiune; oprește-o sau decide asupra rezultatului`, { code: "DELTA_LIMIT" });
      extraAttempts[missionId] = (extraAttempts[missionId] || 0) + 1;
    }
    const raised = bus.transaction(() => {
      db.prepare("UPDATE mission_envelopes SET derived_json = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(json({ ...env.derived, extraCycles, extraAttempts, hold: null }), iso(), env.id);
      const out = factory.raiseLimits && (k === "cycle" || factoryExhausted) ? factory.raiseLimits(missionId, { cycle: k === "cycle", attempt: k === "attempt", actor: `owner:${s.id}`, envelopeId: env.id }) : {};
      bus.append({ type: "envelope.delta_confirmed", scopeType: "envelope", scopeId: env.id, projectId: env.projectId, source: "owner",
        payload: { missionId, kind: k, extraCycles: extraCycles[missionId] || 0, extraAttempts: extraAttempts[missionId] || 0, factoryLimits: out, session: s.id, modality, channel: "owner_session" } });
      if (env.status === "WAITING_OWNER") setStatus(env.id, "ACTIVE", { reason: k === "cycle" ? "Remediere confirmată" : "Încercare în plus confirmată", from: ["WAITING_OWNER"] });
      return out;
    });
    // The difference needs writer/reviewer attempts beyond the grants already derived: a top-up, still inside the (new) budget.
    const entry = env.body.missions.find((m) => m.missionId === missionId);
    for (const role of ["writer", "reviewer"]) { try { topUp(missionId, role, entry?.bindings?.[role]?.bindingHash || null); } catch { /* the gate decides at dispatch */ } }
    // The confirmation is the decision to go on: a mission waiting for exactly this resumes after the commit (never inside it).
    const stage = factory.list().find((x) => x.missionId === missionId)?.stage || null;
    const resuming = CONTINUABLE.has(stage);
    if (resuming) later(() => factory.resume(missionId, { actor: `owner:${s.id}`, allowExtraCycle: k === "cycle", planDelta: env.id }));
    return { ...view(env.id), delta: { kind: k, missionId, text: shown?.text || null, factoryLimits: raised }, resuming };
  }

  // ---------- lifecycle ----------
  function close(id, status, reason, { pauseMission = true } = {}) {
    const env = get(id);
    if (!env) return null;
    bus.transaction(() => {
      setStatus(id, status, { reason });
      for (const g of grants.ofEnvelope(id).filter((x) => x.status === "active")) grants.revoke(g.id, `envelope:${id}`);
    });
    releaseMode(id);
    // M10.2 (U11): a revoked or expired plan also PAUSES its mission, like a freeze or „Preiau eu”: the runner stages (checks, QA,
    // preview, E2E) and a model turn already in flight stop now, and nothing new starts until the owner continues it (a new plan or
    // a confirmed continuation). Revoking the grants alone stopped only the NEXT model step.
    if (pauseMission && (status === "REVOKED" || status === "EXPIRED")) pauseMissionsOf(env, status);
    // M10.2 (U12): a run plan has no mission to pause: its one turn in flight is interrupted instead (fail-safe).
    if (env.body?.kind === "run" && (status === "REVOKED" || status === "EXPIRED")) interruptRunOf(env, status);
    return view(id);
  }
  function pauseMissionsOf(env, status) {
    const active = factory.list().filter((f) => env.missionIds.includes(f.missionId) && PAUSABLE.has(f.stage));
    for (const f of active) {
      // factory.pause moves the stage to PAUSED synchronously (before its first await); the interruptions follow asynchronously.
      factory.pause(f.missionId, { actor: `envelope:${env.id}` })
        .then(() => bus.emit({ type: "envelope.mission_paused", scopeType: "envelope", scopeId: env.id, projectId: env.projectId, source: "envelopes", payload: { missionId: f.missionId, from: f.stage, because: status } }))
        .catch(() => { /* already settled or stopping: nothing new starts under a closed plan anyway (the gate refuses) */ });
    }
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
    // M10.2: under envelope-scoped authority a resumed plan needs no LIVE_VALIDATION (its steps are admitted by the plan in
    // BUILD_SAFE), so a hold a boot suspended is never turned back into a Hub-wide mode; it is only released when its plans close.
    if (scopedLive()) return null;
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
  /** `pauseMission: false` only for a caller that pauses the missions itself right after (freeze, „Preiau eu”). */
  function revoke(id, { actor = "owner", reason = "Revocat", pauseMission = true } = {}) {
    const env = get(id);
    if (!env) throw new HubError("not_found", "Plan necunoscut");
    if (env.status === "PROPOSED") { bus.transaction(() => setStatus(id, "CANCELLED", { reason, from: ["PROPOSED"] })); return view(id); }
    if (!OPEN.has(env.status)) return view(id);
    bus.emit({ type: "envelope.revoked", scopeType: "envelope", scopeId: id, projectId: env.projectId, source: actor, payload: { reason: String(reason).slice(0, 200) } });
    return close(id, "REVOKED", reason, { pauseMission });
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
    // M11 L5 (§6): a mission resumed into step 0 (the test's author, proof or review) brings its plan back to ACTIVE too.
    if (["TEST_AUTHORING", "TEST_PROVING", "TEST_REVIEW", "BASELINE", "IMPLEMENTING", "CHECKING", "REVIEWING", "REPAIRING", "QA", "PREVIEW"].includes(stage) && env.status === "WAITING_OWNER") {
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
      // M10.2 (U12): the one turn of a run plan ended (any outcome): the plan completes and its grant is revoked.
      if (event.runId && (event.type === "run.completed" || event.type === "run.failed" || event.type === "run.interrupted")) {
        const row = db.prepare("SELECT id FROM mission_envelopes WHERE status IN ('CONFIRMED','ACTIVE','WAITING_OWNER') AND json_extract(derived_json, '$.runId') = ? LIMIT 1").get(String(event.runId));
        if (row) later(() => finishRun(row.id, event.payload?.status || event.type.slice(4)));
      }
      // Review #2/#9: revoking ONE derived grant from outside its plan (Integrations "Revocă", grant.revoke from voice / companion / a
      // delegated agent: a fail-safe) is the owner withdrawing the plan. Before, the cumulative top-up minted a fresh bound grant at the
      // next dispatch and the revocation achieved nothing. Now the plan closes REVOKED: its other grants are revoked, its mission
      // paused (a run plan's turn interrupted), the mode hold released — and topUp issues nothing for a closed plan. Only the FIRST
      // revocation of the grant counts (a second click on an already revoked grant is not a new decision).
      if (event.type === "grant.revoked" && event.scopeType === "grant" && !String(event.source || "").startsWith("envelope:")) {
        const g = grants.get(event.scopeId);
        const first = g?.envelopeId ? db.prepare("SELECT seq FROM events WHERE type = 'grant.revoked' AND scope_id = ? ORDER BY seq LIMIT 1").get(g.id) : null;
        if (g?.envelopeId && first?.seq === event.seq) {
          later(() => { const e = get(g.envelopeId); if (e && OPEN.has(e.status)) revoke(e.id, { actor: event.source || "owner", reason: "Grantul derivat al planului a fost revocat" }); });
        }
      }
      if (event.type === "grant.revoked_all" || event.type === "system.stop_all") {
        later(() => { for (const row of db.prepare("SELECT id FROM mission_envelopes WHERE status IN ('CONFIRMED','ACTIVE','WAITING_OWNER')").all()) close(row.id, "REVOKED", "Stop All"); });
      }
      // M10.2.1 (D15): Stop All also closes the plans still waiting for a confirmation, as REVOKED („Stop All”, an owner closure: their
      // preserved requests go back to OPEN and are not re-proposed). A card shown before the stop never becomes confirmable after the
      // gate is rearmed; nothing old restarts. Compare-and-set on PROPOSED; an armed voice window of such a plan closes with it.
      if (event.type === "system.stop_all") {
        // Only the cards that existed at the stop: this write is deferred, and a plan proposed right after it (the card a rearm
        // re-proposes) must never be closed by the stop it came after.
        const stoppedAt = event.createdAt || iso();
        later(() => {
          for (const row of db.prepare("SELECT id FROM mission_envelopes WHERE status = 'PROPOSED' AND created_at <= ?").all(stoppedAt)) {
            const n = bus.transaction(() => setStatus(row.id, "REVOKED", { reason: "Stop All", from: ["PROPOSED"] }));
            if (n) { try { disarm(row.id, "Stop All"); } catch { /* the window is in memory; a restart closes it anyway */ } }
          }
        });
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
    return { ...env, derivedGrants: grants.ofEnvelope(env.id).map((g) => ({ id: g.id, provider: g.provider, access: g.access, status: g.status, attemptsUsed: g.attemptsUsed, maxAttempts: g.maxAttempts, expiresAt: g.expiresAt,
      model: g.binding?.model || null, effort: g.binding?.effort || null })),
      awaitingConfirmation: env.status === "PROPOSED" && new Date(env.confirmBy) > now(),
      // M10.2 U13: until when the plan is armed for a spoken confirmation (ISO, or null); never the window's nonces.
      armedUntil: env.status === "PROPOSED" ? armedWindows.armedUntil(env.id) : null,
      // Review #12: the difference the plan really needs now (deltaOf), or null — a held plan or a mission that is not waiting shows its
      // blocker, never a "confirm the difference" button (the cockpit renders DeltaOffer only when this is set).
      delta: env.status === "WAITING_OWNER" && env.body?.kind !== "run" ? (() => { try { return deltaOf(env.id, env.currentMissionId || env.missionIds[0]); } catch { return null; } })() : null };
  }

  return { propose, confirm, confirmDelta, deltaOf, revoke, view, get, forProject, openFor, pending, autonomyOf, setAutonomy, readiness, deriveGrants, assertWithin, authorityFor, liveAuthority, liveScopes, tick, envelopeOfMission, restoreModeHold, undoRestore, armConfirmation, armForLega, disarm, armedFor, confirmFromArmed,
    topUp, budgetOf: (id, missionId) => { const env = get(id); return env ? budgetOf(env, missionId) : 0; }, lastConfirmedOf,
    // M10.2 (U12): run envelopes (one bounded model step).
    proposeRun, attachRuns, runAccessProblem, runReadiness: (projectId, req) => runReadiness(projects.get(projectId), req), isHubProject,
    // Review #1/#31 (readiness pre-steps under the one confirmation), #10 (boot reconciliation of run plans).
    attachReadiness, recoverRuns,
    close: () => { stopped = true; } };
}
