import path from "node:path";
import { HubError } from "../core/errors.mjs";
import { CANARY_VERSION } from "../environments/canary.mjs";
import { ATTESTATION_MAX_AGE_DAYS } from "../environments/wsl-runner.mjs";
import { ENV_POLICY_TEXT } from "../policy/isolation.mjs";
import { PILOT_MODELS } from "../intel/packages.mjs";
import { explain, attestationCode, reattestEligibility, PLAN_RESOLVED_CHECKS } from "./blockers.mjs";
import { classifySuspension } from "../policy/gate-state.mjs";

/**
 * M10.2 automatic readiness runner. It runs ONLY the steps the blocker explainer marks automatic_readiness, on the `automation`
 * channel with actor `readiness:<workRequestId|envelopeId>`, through the ordinary commands (same checks, same audit):
 *
 *   environment.inspect, environment.probe (C16 + the reviewer's check), provider.probe, skill.reconcile, and a media tools
 *   inspection (read-only; pinning is a step of a confirmed ops plan, media.tools.pin checks that itself).
 *
 * environment.attest runs only under owner decision 3: as a pre-step AFTER a plan's one confirmation in the owner session (an open
 * envelope confirmed through owner_session, or a work request the owner confirmed), only when a FRESH inspection shows the same
 * fingerprint as the approval (b) and as the latest PASS attestation, only while the environment is idle, at most once per
 * (attestation, canary version), and never at boot. A new fingerprint is never approved here: (b) stays the owner's decision.
 *
 * Never touched: r2Acceptance, environmentPolicy, project routes, projectAutonomy, mode, grants, billing, consents, media packages.
 * Every step is inference-free; nothing reaches a model.
 */
export const READINESS_COMMANDS = Object.freeze(["environment.inspect", "environment.attest", "environment.probe", "provider.probe", "skill.reconcile"]);
const ORDER = new Map(READINESS_COMMANDS.map((c, i) => [c, i]));
const OPEN_ENVELOPE = new Set(["CONFIRMED", "ACTIVE", "WAITING_OWNER"]);
const samePath = (a, b) => Boolean(a && b) && path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const ageH = (when, now) => (when ? Math.round(((now.getTime() - new Date(when).getTime()) / 3600000) * 10) / 10 : null);

/** The verified state of one execution environment, in the shape blockers.explain() reads. Read-only. */
export function environmentFacts(hub, envId, now = hub.config.now()) {
  const { environments, settings, providerState, config, runs } = hub;
  const svc = environments?.get(envId);
  if (!svc) return { id: envId, unavailable: `Ruta ${envId} nu există în acest Hub; execuția nu trece pe Windows` };
  const st = svc.state();
  if (st && !st.installed) return { id: envId, unavailable: `${st.error || "mediul nu a fost găsit"} (fără trecere pe Windows)` };
  const status = svc.attestationStatus(now);
  const attestation = attestationCode({ valid: status.valid, latest: status.latest, currentCanary: CANARY_VERSION, currentFingerprint: st?.fingerprint?.hash || null,
    inspectionOk: st ? st.ok !== false : true, now, maxAgeDays: ATTESTATION_MAX_AGE_DAYS, acceptSimulated: Boolean(config.testMode) });
  const codexProbe = providerState.get(svc.probeKey);
  const reviewerProbe = svc.reviewerKey ? providerState.get(svc.reviewerKey) : null;
  const pol = settings.get("environmentPolicy")?.[envId] || null;
  const busy = (runs?.activeRuns?.() || []).some((r) => r.environment === envId) || (svc.inUse?.() || []).length > 0;
  return {
    id: envId, inspectedAt: st?.inspectedAt || null, attesting: Boolean(svc.attesting?.()), idle: !busy,
    boundaryDetail: (st?.problems || []).filter((p) => p.blocking).map((p) => p.detail).slice(0, 3).join("; ") || null,
    attestation,
    probes: {
      codex: { problem: st ? svc.probeProblem(codexProbe, st, now) : "mediul nu a fost inspectat", ageH: ageH(codexProbe?.probedAt, now) },
      reviewer: { applicable: Boolean(st?.facts?.claude_cli), problem: st?.facts?.claude_cli ? svc.probeProblem(reviewerProbe, st, now) : null, ageH: ageH(reviewerProbe?.probedAt, now) },
    },
    policyB: { approved: Boolean(pol?.approvedAt && pol.text === ENV_POLICY_TEXT), fingerprintSame: Boolean(pol?.fingerprintHash) && pol.fingerprintHash === st?.fingerprint?.hash, fingerprintHash: pol?.fingerprintHash || null },
  };
}

/**
 * The gate facts the explainer reads (M10.2.1 D14/D17): the class from the ONE classifier (policy/gate-state.mjs; only a pause that
 * recorded the owner's credential is "owner_pause", the one „Continuă” reopens) and, for every other suspension, whether the rearm
 * card can reopen it now (owner/gate-rearm.mjs eligibility: ELIGIBLE / SECURITY, or why not yet). Never inferred from the reason text.
 */
function gateFacts(hub, g) {
  const c = classifySuspension(g);
  const out = { status: g?.status || "suspended", reason: g?.reason || "", suspendedBy: c.cls === "open" ? null : c.cls, at: c.at, channel: c.channel, rearm: null };
  if (c.cls !== "open" && c.cls !== "owner_pause" && hub.gateRearm?.eligibility) {
    try { const e = hub.gateRearm.eligibility(); out.rearm = { eligible: e.eligible, code: e.code, reason: e.reason, security: Boolean(e.security) }; } catch { out.rearm = null; }
  }
  return out;
}

/**
 * Gathers the verified facts the explainer needs for one request (read-only: gate evaluations, attestation status, probes, settings,
 * factory drafts, media counts). `plan: false` skips the draft checks (a plan already running is not a plan to confirm).
 */
export async function collectFacts(hub, { projectId = null, intent = "engineering", missionIds = [], plan = true, checkSkills = false, checkMediaTools = false } = {}) {
  const { projects, settings, environments, envelopes, gate, factory, factoryRunner, config, db } = hub;
  const now = config.now();
  const project = projectId ? projects.get(projectId) : null;
  const route = project && environments ? environments.routeFor(project.id, "codex") : "windows";
  const isHub = Boolean(project) && (project.slug === "ifrim-agent-hub" || samePath(project.path, config.hubRoot));
  const g = settings.get("executionGate");
  const facts = {
    intent, project: project ? { id: project.id, name: project.name, source: project.source, isHub, route } : null,
    // The Software Factory refuses the Hub itself outside test mode (factory.mjs projectProblem); the explanation says the same.
    hubSelfRefused: isHub && !config.testMode,
    gate: gateFacts(hub, g),
    frozen: Boolean(project && settings.get("projectFreeze")?.[project.id]),
    autonomy: project && envelopes ? envelopes.autonomyOf(project.id).level : null,
    decisions: { reattestAfterConfirmation: settings.get("readinessAutoReattest") !== false },
    checks: [], environment: null, stage: null, plan: null, media: null, skills: null,
  };
  if (project && route !== "windows") facts.environment = environmentFacts(hub, route, now);
  if (project && intent === "engineering") {
    for (const [role, provider, access] of [["writer", "codex", "workspace-write"], ["reviewer", "claude", "read-only"]]) {
      const evaluated = gate.evaluate({ provider, projectId: project.id, access });
      for (const c of evaluated.checks) {
        if (c.ok || PLAN_RESOLVED_CHECKS.has(c.id)) continue;
        facts.checks.push({ role, provider, id: c.id, ok: false, detail: c.detail, ...(c.route?.checks ? { billing: c.route.checks.map((b) => ({ id: b.id, status: b.status, detail: b.detail })) } : {}) });
      }
    }
    if (project.source !== "hub-test" && factoryRunner?.stageMap) { const map = factoryRunner.stageMap(project); facts.stage = { realProjectEligible: Boolean(map?.realProjectEligible), blockers: map?.blockers || [] }; }
    if (plan && factory) {
      const ids = missionIds.filter(Boolean).length ? missionIds.filter(Boolean) : factory.list().filter((f) => f.projectId === project.id && f.stage === "SPEC_DRAFT").slice(0, 1).map((f) => f.missionId);
      const views = ids.map((id) => factory.view(id)).filter(Boolean);
      facts.plan = {
        started: views.filter((v) => v.factory.stage !== "SPEC_DRAFT").map((v) => v.mission.title),
        specProblems: views.filter((v) => v.factory.stage === "SPEC_DRAFT" && !v.scope && (v.spec?.protected?.problems || []).length).map((v) => `„${v.mission.title}”: ${(v.spec.protected.problems || []).slice(0, 3).join("; ")}`),
        incompleteModels: views.filter((v) => v.factory.stage === "SPEC_DRAFT" && !v.scope && !(v.spec?.protected?.problems || []).length).map((v) => v.mission.title),
        // D4: the role defaults an engineering plan is built with (shown and hashed in the plan card); never the account default.
        defaults: { writer: `${PILOT_MODELS.writer.model} · ${PILOT_MODELS.writer.effort}`, reviewer: `${PILOT_MODELS.reviewer.model} · ${PILOT_MODELS.reviewer.effort}` },
      };
    }
  }
  if (intent === "studio") {
    let tools = null;
    try {
      const t = checkMediaTools && hub.media?.tools?.inspect ? await hub.media.tools.inspect() : hub.media?.tools?.lastResolved?.() || null;
      const states = Object.values(t?.states || {});
      tools = !states.length ? null : states.includes("MISSING") ? "MISSING" : states.includes("CHANGED") ? "CHANGED" : states.includes("UNPINNED") ? "UNPINNED" : "PINNED";
    } catch { tools = null; }
    const count = (sql) => { try { return db.prepare(sql).get().n; } catch { return 0; } };
    // Usable source material = an original version READY (status lives on media_asset_versions, not media_assets), excluding
    // Hub outputs (renders, exports, proxies, thumbnails): the same count the content planner uses (planners/content.mjs mediaFacts).
    facts.media = { assets: count(`SELECT COUNT(DISTINCT a.id) AS n FROM media_assets a JOIN media_asset_versions v ON v.asset_id = a.id
      WHERE v.status = 'READY' AND v.is_original = 1 AND a.category NOT IN ('render','export','proxy','thumbnail')`), editProjects: count("SELECT COUNT(*) AS n FROM media_edit_projects"), tools };
  }
  if (checkSkills && hub.skills?.reconcile) { try { facts.skills = { stale: hub.skills.reconcile({ dryRun: true }).drift }; } catch { facts.skills = null; } }
  return facts;
}

/**
 * The facts of ONE bounded model step (a run plan) on a project: collectFacts (gate state, autonomy, frozen, environment) plus the
 * run's OWN gate checks (its provider and access, not the factory's writer/reviewer pair). Shared by the run planner (explanation
 * before a proposal), the envelope service (is a run plan blocked only by automatic causes?) and the readiness pass after a run
 * plan's confirmation, so the three never disagree about what blocks the same step. Read-only.
 */
export async function collectRunFacts(hub, { projectId, provider = "claude", access = "read-only", hubSelfRefused = false } = {}) {
  const facts = await collectFacts(hub, { projectId, intent: "run", plan: false });
  // The explainer's engineering branch holds the causes a model step shares with a factory step (the Hub itself, R2 on the Windows
  // route, autonomy OBSERVE); its draft and stage-map causes do not apply to one turn, so they are left empty.
  facts.intent = "engineering";
  facts.plan = null;
  facts.stage = null;
  facts.hubSelfRefused = Boolean(hubSelfRefused);
  const role = provider === "claude" ? "reviewer" : "writer";
  facts.checks = facts.project ? hub.gate.evaluate({ provider, projectId: facts.project.id, access }).checks
    .filter((c) => !c.ok && !PLAN_RESOLVED_CHECKS.has(c.id))
    .map((c) => ({ role, provider, id: c.id, ok: false, detail: c.detail, ...(c.route?.checks ? { billing: c.route.checks.map((b) => ({ id: b.id, status: b.status, detail: b.detail })) } : {}) })) : [];
  // A Claude read-only turn on the Windows route is fenced by Claude Code itself (isolation.mjs): R2 is not its blocker. Only the
  // "real project on Windows" cause reads `source`; on the Windows route no environment cause applies, so nothing else changes.
  if (provider === "claude" && access === "read-only" && (facts.project?.route || "windows") === "windows" && facts.project) facts.project = { ...facts.project, source: "hub-test" };
  return facts;
}

/**
 * M10.2 review #3/#31: after the inference-free pass that needs no confirmation (probe, inspect, skills) the request may still be
 * blocked ONLY by what needs the plan's confirmation (a same-fingerprint re-attestation, owner decision 3) — then a plan is proposed
 * and its one confirmation runs that pre-step. Anything else that remains (a probe that failed, a cause that is not automatic) is the
 * honest blocker of the request: proposing a plan for it would only fail at the confirmation.
 */
export function onlyAfterConfirmation(ex) {
  if (!ex?.blocked) return false;
  return ex.blockers.every((b) => b.options.some((o) => o.kind === "automatic_readiness" && o.step?.afterConfirmation));
}

/** One readiness pass without a plan reference (never attests); a pass already running on the project is awaited, then run again once. */
export async function readinessPassFor(hub, args) {
  if (!hub.readiness?.run) return null;
  let out = await hub.readiness.run({ ...args, ref: null });
  if (out?.busy) { await Promise.resolve(out.pending).catch(() => null); out = await hub.readiness.run({ ...args, ref: null }); }
  return out?.busy ? null : out;
}

export function createReadinessRunner(hub, { workRequests }) {
  const { bus, settings, envelopes, environments, commands, config, projects } = hub;
  const running = new Map(); // project/global key → promise (one runner pass at a time per project)
  const triedAttest = new Set(); // `${envId}:${attestationId}:${canary}`: an automatic re-attestation is attempted once per version
  const triedEvent = new Set(); // `${envelopeId}:${signature}`: an event-triggered pass runs once per blocker signature
  const decisionOn = () => settings.get("readinessAutoReattest") !== false;

  /**
   * The owner's confirmation a readiness reference stands for, read from the database: "envelope:<id>" = an OPEN plan confirmed
   * in the owner session; "work_request:<id>" = a preserved request the owner confirmed (work.request.confirm_readiness).
   */
  function authorityFor(ref) {
    const [kind, id] = String(ref || "").split(":");
    if (kind === "envelope") {
      const env = envelopes.get(id);
      if (!env || !OPEN_ENVELOPE.has(env.status)) return { ok: false, why: "planul nu e confirmat și în curs" };
      if (env.consent?.channel !== "owner_session" || !env.confirmedAt) return { ok: false, why: "planul nu a fost confirmat în sesiunea ta" };
      if (new Date(env.expiresAt) <= config.now()) return { ok: false, why: "autoritatea planului a expirat" };
      return { ok: true, kind, id, projectId: env.projectId };
    }
    if (kind === "work_request") {
      const r = workRequests.confirmedForReadiness(id);
      return r ? { ok: true, kind, id, projectId: r.projectId } : { ok: false, why: "cererea nu a fost confirmată de tine" };
    }
    return { ok: false, why: "referință de pregătire necunoscută" };
  }

  /** Checked again by environment.attest on the automation channel (authority from the database, never from the channel label). */
  function reattestAllowed(ref, envId = "wsl-runner") {
    if (!decisionOn()) return { ok: false, why: "re-atestarea automată este oprită (decizia 3)" };
    const a = authorityFor(ref);
    if (!a.ok) return a;
    if (!a.projectId || environments.routeFor(a.projectId, "codex") !== envId) return { ok: false, why: `proiectul planului nu e pe ruta ${envId}` };
    return a;
  }

  const resultOk = (command, result) => (command === "environment.attest" ? /^PASS/.test(String(result?.status || "")) : command === "skill.reconcile" ? !(result?.failed || []).length : result?.ok !== false);

  /**
   * One readiness pass for a project: explain → run the automatic steps (in order, stop at a failed attestation) → explain again.
   * Emits one `readiness.completed` (a clearing event: preserved requests are explained again and re-proposed when free).
   */
  async function run({ ref = null, projectId = null, intent = "engineering", missionIds = [], plan = true, trigger = "work_request", onceKey = null, explainWith = null } = {}) {
    const key = projectId || "global";
    if (running.has(key)) return { busy: true, pending: running.get(key) };
    // M10.2 review #3/#31: a run plan (one model step) is explained from ITS provider/access (collectRunFacts), not from the
    // factory's writer/reviewer pair: `explainWith(first)` gives that explanation; without it, the request's own facts as before.
    const explainNow = (first) => (explainWith ? explainWith(first) : collectFacts(hub, { projectId, intent, missionIds, plan, checkSkills: first }).then(explain));
    const pass = (async () => {
      const actor = `readiness:${ref ? String(ref).split(":")[1] : "hub"}`;
      const before = await explainNow(true);
      if (onceKey) { const k = `${onceKey}:${before.signature}`; if (triedEvent.has(k)) return { before, after: before, steps: [], skipped: "already tried for this signature" }; triedEvent.add(k); }
      const authority = ref ? reattestAllowed(ref) : { ok: false, why: "fără confirmarea unui plan" };
      let wanted = before.steps.filter((s) => ORDER.has(s.command) && !s.inPlan);
      const skipped = [];
      if (!authority.ok) {
        for (const s of wanted.filter((x) => x.command === "environment.attest")) skipped.push({ command: s.command, reason: authority.why });
        wanted = wanted.filter((s) => s.command !== "environment.attest");
      }
      // A fresh inspection first: the attestation decision compares the INSPECTED fingerprint, and probes bind to it.
      for (const envId of new Set(wanted.filter((s) => s.command.startsWith("environment.")).map((s) => s.payload?.environmentId || "wsl-runner"))) {
        if (!wanted.some((s) => s.command === "environment.inspect" && (s.payload?.environmentId || "wsl-runner") === envId)) wanted.push({ code: "ENV_INSPECT_FIRST", command: "environment.inspect", payload: { environmentId: envId } });
      }
      // De-duplicated by command + payload, in a fixed order (inspect → attest → probe → provider → skills).
      const unique = new Map();
      for (const s of wanted) unique.set(`${s.command}:${JSON.stringify(s.payload || {})}`, s);
      wanted = [...unique.values()].sort((a, b) => ORDER.get(a.command) - ORDER.get(b.command));
      const steps = [];
      for (const step of wanted) {
        const payload = { ...(step.payload || {}) };
        if (step.command === "environment.attest") {
          const envId = payload.environmentId || "wsl-runner";
          const ef = environmentFacts(hub, envId);
          const elig = reattestEligibility(ef, { decisionOn: decisionOn() });
          const tried = `${envId}:${ef.attestation?.attestationId}:${ef.attestation?.currentCanary}`;
          if (!elig.eligible || !ef.idle) { steps.push({ command: step.command, ok: false, skipped: true, reason: [...elig.why, ...(ef.idle ? [] : ["mediul e folosit acum"])].join("; ") }); continue; }
          if (triedAttest.has(tried)) { steps.push({ command: step.command, ok: false, skipped: true, reason: "o re-atestare automată a fost deja încercată pentru această versiune" }); continue; }
          triedAttest.add(tried);
          payload.allowRestart = true;
          payload.readinessFor = String(ref);
        }
        try {
          const r = await commands.dispatch({ type: step.command, payload, channel: "automation", actor, intentText: `pas automat de pregătire (${step.code || step.command})` });
          const ok = resultOk(step.command, r.result);
          steps.push({ command: step.command, ok, commandId: r.command?.id || null, status: r.result?.status || null });
          if (!ok && step.command === "environment.attest") break; // never loop on a failed attestation
        } catch (error) {
          steps.push({ command: step.command, ok: false, error: String(error?.message || error).slice(0, 300) });
          if (step.command === "environment.attest") break;
        }
      }
      // Nothing to do (no automatic cause): nothing is recorded, so a blocked mission's event never produces an empty pass record.
      if (!steps.length && !skipped.length) return { before, after: before, steps, skipped };
      const after = await explainNow(false);
      bus.emit({ type: "readiness.completed", scopeType: ref ? String(ref).split(":")[0] : "project", scopeId: ref ? String(ref).split(":")[1] : (projectId || "global"), projectId: projectId || null, source: actor,
        payload: { trigger, steps: steps.map((s) => ({ command: s.command, ok: s.ok, skipped: Boolean(s.skipped), reason: s.reason || s.error || null })), skipped, before: before.signature, after: after.signature, cleared: !after.blocked } });
      return { before, after, steps, skipped };
    })();
    running.set(key, pass);
    try { return await pass; } finally { running.delete(key); }
  }

  /** The pre-steps of a preserved request the owner confirmed, then its re-plan (a proposal; the lifecycle decides the rest). */
  async function runForRequest(workRequestId) {
    const r = workRequests.get(workRequestId);
    if (!r) throw new HubError("not_found", "Cerere necunoscută");
    const out = await run({ ref: `work_request:${r.id}`, projectId: r.projectId, intent: r.intent, missionIds: r.planRef?.missionId ? [r.planRef.missionId] : [], trigger: "work_request" });
    const replanned = await workRequests.replan(r.id).catch((error) => ({ error: error.message }));
    return { ...out, replanned };
  }

  /** A confirmed plan whose step is blocked by something automatic (C16 older than 24 h, the canary version after an upgrade). */
  async function afterConfirmation(envelopeId, { onceKey = null } = {}) {
    const env = envelopes.get(envelopeId);
    if (!env || !OPEN_ENVELOPE.has(env.status)) return { skipped: "plan not open" };
    // 2.12.1 (SM-02): the gate as this pass found it. A pass that started under a suspended gate (or whose first explanation named
    // it) never resumes anything: it did not clear the gate — the owner's rearm did, and after a rearm only the owner's „Continuă”
    // restarts old work (D15). The seq lets resumeCleared see a gate change that landed while the pass ran.
    const gateAtStart = settings.get("executionGate") || {};
    const startSeq = Number(hub.db.prepare("SELECT COALESCE(MAX(seq), 0) AS seq FROM events").get().seq || 0);
    // A run plan's step is ONE provider/access pair: its readiness is explained from that pair (review #3/#31), never the factory's.
    const r = env.body?.kind === "run" ? env.body.run : null;
    const explainWith = r ? () => collectRunFacts(hub, { projectId: env.projectId, provider: r.provider, access: r.access }).then(explain) : null;
    const out = await run({ ref: `envelope:${env.id}`, projectId: env.projectId, plan: false, trigger: "plan_confirmed", onceKey, explainWith });
    const gateCaused = gateAtStart.status !== "open" || (out?.before?.causes || []).includes("GATE_SUSPENDED");
    if (!out?.busy && out?.steps?.length && out.after && !out.after.blocked && !gateCaused) resumeCleared(env.id, { sinceSeq: startSeq });
    return out;
  }

  /**
   * M10.2 review #34: a confirmed plan's mission refused at dispatch by something the pass just cleared (an account check older than
   * 24 h, the canary version after an upgrade) waited at BLOCKED "gate"/"grant" for ever — nothing listened for readiness.completed
   * but the preserved requests. It resumes now, under the SAME plan: factory.resume asks the plan (RESUME) and refuses any widening
   * (no extra cycle, no extra attempt, never past the plan's time); the gate still decides the step. A mission waiting for the
   * owner's decision (a restart's "reia manual", exhausted attempts) is never touched. Deferred after the commit, like envelopes.later.
   * 2.12.1 (SM-02): only blocks the pass cleared ITSELF — never when the gate is not open now, nor when the gate was suspended or
   * reopened after the pass started (`sinceSeq`): a reopening never restarts old work by itself.
   */
  function resumeCleared(envelopeId, { sinceSeq = null } = {}) {
    setImmediate(() => {
      const env = envelopes.get(envelopeId);
      if (!env || !OPEN_ENVELOPE.has(env.status) || new Date(env.expiresAt) <= config.now() || !hub.factory) return;
      if ((settings.get("executionGate") || {}).status !== "open") return;
      if (sinceSeq !== null && hub.db.prepare("SELECT 1 FROM events WHERE scope_type = 'settings' AND scope_id = 'executionGate' AND seq > ? LIMIT 1").get(Number(sinceSeq))) return;
      for (const f of hub.factory.list().filter((x) => env.missionIds.includes(x.missionId) && x.stage === "BLOCKED" && ["gate", "grant"].includes(x.waitReason))) {
        Promise.resolve().then(() => hub.factory.resume(f.missionId, { actor: `envelope:${env.id}` }))
          .then(() => bus.emit({ type: "readiness.mission_resumed", scopeType: "envelope", scopeId: env.id, projectId: env.projectId, source: `readiness:${env.id}`, payload: { missionId: f.missionId, waitReason: f.waitReason } }))
          .catch(() => { /* refused (plan expired, a run still active): the mission stays BLOCKED with its own reason */ });
      }
    });
  }

  /**
   * M10.2 review #1/#3/#31: is what blocks this plan ONLY automatic readiness (inference-free steps the Hub runs itself, and a
   * same-fingerprint re-attestation that needs the plan's confirmation)? Read-only; the envelope service asks it at proposal (the
   * card then says PLAN_READY_AFTER_READINESS and is confirmable) and again at confirmation, from verified state only.
   */
  async function automaticFor({ projectId, kind = "missions", provider = null, access = null } = {}) {
    const facts = kind === "run" ? await collectRunFacts(hub, { projectId, provider, access }) : await collectFacts(hub, { projectId, intent: "engineering", plan: false });
    const ex = explain(facts);
    return { ok: ex.blocked && ex.automaticOnly, explanation: ex, labels: ex.options.filter((o) => o.kind === "automatic_readiness").map((o) => o.label) };
  }

  /** Post-commit: a mission of a confirmed plan blocked (or waiting) on the environment → one pre-step pass per blocker signature. */
  function onEvent(event) {
    if (event.type === "factory.stage" && event.payload?.stage === "BLOCKED") {
      const env = envelopes.envelopeOfMission(event.scopeId);
      if (env && environments.routeFor(env.projectId, "codex") !== "windows") setImmediate(() => { afterConfirmation(env.id, { onceKey: env.id }).catch(() => {}); });
    }
  }

  /**
   * At boot: says it when an environment's attestation is no longer valid because the canary version changed (an upgrade) or it
   * aged out, or when its account check is older than 24 h. One event per cause and version (a dedupe key survives restarts), which
   * the attention feed and the cockpit show. Nothing runs here: no inspection, no probe, no attestation (owner decision 3).
   */
  function announceAtBoot() {
    const out = [];
    for (const envId of environments.ids()) {
      const svc = environments.get(envId);
      const latest = svc.latestAttestation ? svc.latestAttestation() : null;
      if (!latest) continue; // never attested: nothing became invalid (the setup lists the first attestation)
      const ef = environmentFacts(hub, envId);
      if (ef.unavailable) continue;
      const att = ef.attestation || {};
      const probeStale = Boolean(ef.probes?.codex?.problem) || Boolean(ef.probes?.reviewer?.applicable && ef.probes.reviewer.problem);
      const code = att.code === "canary_changed" || att.code === "expired" ? att.code : !att.code && probeStale ? "account_check_stale" : null;
      if (!code) continue;
      const routed = Object.entries(settings.get("projectEnvironments") || {}).filter(([, v]) => v?.environment === envId).map(([id]) => id).filter((id) => projects.get(id));
      const elig = reattestEligibility(ef, { decisionOn: decisionOn() });
      const codexProbe = hub.providerState.get(svc.probeKey);
      const dedupeKey = code === "account_check_stale" ? `env-account-stale:${envId}:${codexProbe?.probedAt || "none"}` : `env-invalid:${envId}:${att.attestationId}:${code}:${att.currentCanary}`;
      const payload = { code, environmentId: envId, attestationId: att.attestationId, attestedCanary: att.attestedCanary, currentCanary: att.currentCanary, fingerprintSame: att.fingerprintSame,
        probeAgeH: ef.probes?.codex?.ageH ?? null, reviewerProbeAgeH: ef.probes?.reviewer?.ageH ?? null, affectedProjects: routed.slice(0, 20),
        maintenanceEligible: code !== "account_check_stale" ? elig.eligible : true, why: code !== "account_check_stale" ? elig.why : [],
        note: code === "account_check_stale" ? "Verificarea contului prin mediu e mai veche de 24 h; o refac automat (fără model) când un plan are nevoie de ea."
          : elig.eligible ? "Nu re-atestez la pornire: o fac automat ca pas de pregătire după ce confirmi un plan pe acest mediu (aceeași amprentă, fără model, ~2 min)."
            : `Atestarea trebuie refăcută de tine din Sistem → Medii: ${elig.why.join("; ")}.` };
      const ev = bus.transaction(() => bus.append({ type: "environment.attestation_invalid", scopeType: "environment", scopeId: envId, source: "hub", payload, dedupeKey }));
      out.push({ environmentId: envId, code, duplicate: Boolean(ev?.duplicate) });
    }
    return out;
  }

  /** Cockpit notices for one project: its environment's invalidation (live facts, not the boot event) and its preserved requests. */
  function noticesFor(projectId) {
    const project = projects.get(projectId);
    if (!project) return [];
    const notices = [];
    const route = environments.routeFor(project.id, "codex");
    if (route !== "windows") {
      const ef = environmentFacts(hub, route);
      const ex = explain({ intent: "environment", project: { id: project.id, name: project.name, source: project.source, route }, environment: ef, decisions: { reattestAfterConfirmation: decisionOn() } });
      for (const b of ex.blockers) notices.push({ kind: "environment", code: b.code, title: b.title, text: `${b.title}. ${b.detail}`, options: b.options.map((o) => ({ kind: o.kind, label: o.label })) });
    }
    for (const r of workRequests.openFor(project.id)) {
      notices.push({ kind: "work_request", id: r.id, status: r.status, text: r.status === "PLANNED" ? "Cererea ta păstrată are un plan pregătit; așteaptă confirmarea ta." : `Cerere păstrată (${r.status === "BLOCKED" ? "blocată" : r.status === "CONFIRMED" ? "confirmată, pregătire în curs" : "deschisă"}): ${r.text.slice(0, 120)}` });
    }
    return notices;
  }

  /** The explanation for a preserved request (the work-request service's explainer). */
  const explainRequest = async (r) => explain(await collectFacts(hub, { projectId: r.projectId, intent: r.intent, missionIds: r.planRef?.missionId ? [r.planRef.missionId] : [] }));

  const api = { run, runForRequest, afterConfirmation, automaticFor, onEvent, announceAtBoot, noticesFor, authorityFor, reattestAllowed, explainRequest, running: () => [...running.keys()] };
  // The envelope service exists before this runner (hub.mjs): it is late-bound here, so a plan's ONE confirmation can run its own
  // readiness pre-steps (review #1/#31) without a second wiring site. A standalone envelope service has none and refuses as before.
  envelopes?.attachReadiness?.(api);
  return api;
}
