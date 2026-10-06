import fs from "node:fs";
import path from "node:path";
import { readProjectNotes } from "../domain/project-notes.mjs";
import { gitState } from "../tools/git.mjs";
import { parse } from "../storage/db.mjs";
import { redactText } from "../security/redact.mjs";
import { ACTIVE_STAGES } from "../factory/factory.mjs";
import { ROUTES } from "../factory/plan.mjs";
import { AUTONOMY_LABELS } from "./envelopes.mjs";
import { classifySuspension, STOPPED_BY } from "../policy/gate-state.mjs";

/**
 * ProjectContextService + ExplainService (M06 §06, §12, §23, §24, §26).
 *
 * Everything comes from what the Hub already persisted (missions, factory state, runs, evidence, reviews, bundles,
 * decisions, checkpoints, events, the project's own notes through the bounded notes reader) and carries its source and
 * time. Opening a project reads context; it never starts a worker, never loads the project's source files and never
 * invents progress, tests or problems. What is missing is said as missing, with the smallest step to complete it.
 */
export const PROJECT_STATES = Object.freeze({
  NO_CONTEXT: "Fără context încă",
  CONTEXT_AVAILABLE: "Context disponibil",
  PLAN_READY: "Plan pregătit",
  PLAN_READY_AFTER_READINESS: "Plan pregătit (fac singur pregătirea după confirmare)",
  PLAN_BLOCKED: "Plan blocat",
  BLOCKED_BY_ISOLATION: "Execuție blocată de izolare",
  AUTHORIZED: "Autorizat",
  RUNNING: "În execuție",
  WAITING_OWNER: "Așteaptă decizia ta",
  READY_FOR_REVIEW: "Gata pentru verificare",
});
const FINISHED_MISSION = new Set(["COMPLETED", "CANCELLED", "FAILED"]);
const STALE_MS = 2 * 60000;

const clip = (text, n) => { const s = redactText(String(text ?? "")).replace(/\s+/g, " ").trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
/**
 * Who suspended the execution gate (review M10.2 #4; M10.2.1 D17): the class from the ONE classifier (policy/gate-state.mjs), read from
 * the recorded suspension, never from the reason text. Only a pause that recorded the owner's credential is "owner_pause" — the one
 * „Continuă” reopens; every other class (stop_all, suspend, pause_unowned, shutdown, security, first_start, legacy_unknown) is
 * reopened by the rearm card in the cockpit. null when the gate is open.
 */
export function gateSuspendedBy(gate) {
  const cls = classifySuspension(gate).cls;
  return cls === "open" ? null : cls;
}

export function createCockpit({ db, bus, clock, settings, projects, missions, runs, factory, factoryRunner, envelopes, environments, providerState, company }) {
  const iso = () => clock().toISOString();
  // M10.2.1: the rearm service (owner/gate-rearm.mjs) is created after the cockpit (it needs the preserved requests); hub.mjs attaches it.
  let gateRearm = null;
  const attachGateRearm = (service) => { gateRearm = service && typeof service.eligibility === "function" ? service : null; };

  /** Next-step lines found in the project's own notes (NEXT_SESSION / OPEN_ISSUES), quoted as notes, never as facts. */
  function roadmapFromNotes(project) {
    if (!project?.path) return { items: [], files: [], skipped: [] };
    const { notes, skipped } = readProjectNotes(project.path, { perFile: 1800, total: 5000 });
    const items = [];
    for (const note of notes.filter((n) => /NEXT_SESSION|OPEN_ISSUES/.test(n.file))) {
      for (const line of note.text.split("\n")) {
        const m = line.match(/^\s*(?:[-*]|\d+[.)])\s+(.{6,200})$/);
        if (m && items.length < 6) items.push({ text: clip(m[1], 180), source: note.file });
      }
    }
    return { items, files: notes.map((n) => ({ file: n.file, truncated: n.truncated })), skipped };
  }

  async function repo(project) {
    // Only the project's own repository: a folder inside another repository would report the PARENT's branch and changes.
    if (!fs.existsSync(path.join(project.path, ".git"))) return { available: false, reason: "proiectul nu are un repository propriu", readAt: iso() };
    try {
      const st = await gitState(project.path);
      if (!st.isRepo) return { available: false, reason: "nu este un repository git", readAt: iso() };
      return { available: true, branch: st.branch, head: st.head.slice(0, 10), dirty: st.dirty.length, untracked: st.untracked.length, readAt: iso(), source: "git (doar citire)" };
    } catch { return { available: false, reason: "git indisponibil", readAt: iso() }; }
  }

  function bundlesOf(projectId) {
    return db.prepare(`SELECT b.id, b.mission_id, b.status, b.created_at, b.decided_at, b.spec_version, b.change_set_sha, m.title FROM factory_bundles b JOIN missions m ON m.id = b.mission_id
      WHERE m.project_id = ? ORDER BY b.created_at DESC LIMIT 20`).all(projectId);
  }

  function lastSessionOf(projectId) {
    const conv = db.prepare("SELECT id, title, updated_at FROM conversations WHERE project_id = ? ORDER BY updated_at DESC LIMIT 1").get(projectId);
    const run = db.prepare(`SELECT r.id, r.provider, r.status, r.stage, r.model, r.created_at, r.finished_at, r.environment FROM agent_runs r JOIN conversations c ON c.id = r.conversation_id
      WHERE c.project_id = ? ORDER BY r.created_at DESC LIMIT 1`).get(projectId);
    const checkpoint = db.prepare("SELECT id, kind, git_head, created_at FROM checkpoints WHERE scope_type = 'project' AND scope_id = ? ORDER BY created_at DESC LIMIT 1").get(projectId);
    return {
      conversation: conv ? { id: conv.id, title: conv.title, at: conv.updated_at } : null,
      lastRun: run ? { id: run.id, provider: run.provider, status: run.status, stage: run.stage, model: run.model, environment: run.environment || "windows", at: run.finished_at || run.created_at } : null,
      checkpoint: checkpoint ? { id: checkpoint.id, kind: checkpoint.kind, head: String(checkpoint.git_head || "").slice(0, 10), at: checkpoint.created_at } : null,
    };
  }

  function decisionsOf(projectId) {
    return db.prepare("SELECT id, title, decision, author, created_at FROM decisions WHERE project_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 5").all(projectId)
      .map((d) => ({ id: d.id, title: clip(d.title, 120), decision: clip(d.decision, 240), author: d.author, at: d.created_at, source: "decizii înregistrate în Hub" }));
  }

  function agentsOf() {
    const now = clock().getTime();
    const describe = (id) => {
      const st = providerState.get(id) || null;
      const probedAgeH = st?.probedAt ? (now - Date.parse(st.probedAt)) / 3600000 : null;
      return { provider: id, installed: st?.installation ? st.installation.installed !== false : null, version: st?.installation?.version || null,
        account: st?.ok === false ? "eroare la ultima verificare" : st?.probedAt ? (probedAgeH <= 24 ? "verificat" : `verificat acum ${Math.round(probedAgeH)} h (peste 24 h: se reverifică înainte de execuție)`) : "neverificat",
        probedAt: st?.probedAt || null };
    };
    return { codex: { ...describe("codex"), role: "writer", why: "Writer-ul unic (scriere în workspace prin sandbox)" }, claude: { ...describe("claude"), role: "reviewer", why: "Reviewer independent, doar citire" } };
  }

  // ---------- M10.2 (U15): what a reload / the end of the voice session must not lose ----------
  // Read-only. The ops plans and the preserved requests are read straight from their tables (the cockpit is built before those
  // services in hub.mjs); the armed windows live in memory in their own service, so the cockpit reports only what the envelopes
  // service says for an envelope and, for an operation plan, the last window event recorded SINCE THIS BOOT (a restart closes every
  // window, so an older "armed" event never counts). Nothing here opens, extends or confirms anything.
  const tableExists = (name) => { try { return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)); } catch { return false; } };
  function armedEnvelopeUntil(envelopeId) {
    try { return envelopes.view(envelopeId)?.armedUntil || null; } catch { return null; }
  }
  const ARMED_OPS_EVENTS = ["ops.plan.confirmation_armed", "ops.plan.confirmation_disarmed", "ops.plan.armed_refused", "ops.plan.consent"];
  // One boot per process: the boot marker is looked up once it exists (the events table has no index on type), then cached.
  let bootSeq = null;
  const bootMarker = () => {
    if (bootSeq !== null) return bootSeq;
    const s = db.prepare("SELECT MAX(seq) AS s FROM events WHERE type = 'system.booted'").get()?.s || 0;
    if (s) bootSeq = s;
    return s;
  };
  function armedOpsUntil(planId) {
    try {
      const rows = db.prepare(`SELECT type, payload_json FROM events WHERE scope_type = 'ops_plan' AND scope_id = ? AND seq > ? AND type IN (${ARMED_OPS_EVENTS.map(() => "?").join(",")}) ORDER BY seq DESC LIMIT 8`).all(planId, bootMarker(), ...ARMED_OPS_EVENTS);
      for (const r of rows) {
        const p = parse(r.payload_json, {});
        // A refused sentence that did not close the window (an unclear "Da?") leaves the window as it was: look further back.
        if (r.type === "ops.plan.armed_refused" && !p.closed) continue;
        if (r.type !== "ops.plan.confirmation_armed") return null;
        return p.expiresAt && new Date(p.expiresAt) > clock() ? p.expiresAt : null;
      }
      return null;
    } catch { return null; }
  }
  /** The newest operation plan still waiting for the owner (company-wide: an ops plan has no project), or null. */
  function proposedOpsPlan() {
    if (!tableExists("ops_plans")) return null;
    const r = db.prepare("SELECT id, kind, title, confirm_by FROM ops_plans WHERE status = 'PROPOSED' AND confirm_by > ? ORDER BY created_at DESC LIMIT 1").get(iso());
    return r ? { planId: r.id, kind: r.kind, title: clip(r.title, 200), confirmBy: r.confirm_by, armedUntil: armedOpsUntil(r.id) } : null;
  }
  const LIVE_REQUESTS = ["OPEN", "BLOCKED", "PLANNED", "CONFIRMED"];
  /**
   * The requests the Hub kept for this project (and the company-wide ones, e.g. a Studio clip), still live and unexpired: the
   * owner's words (already redacted when stored), the cause codes and the options as kind/code/label — the page maps each option to
   * ONE next action (web/src/lib/uiLogic.js blockerAction). Never the consent body or anything the owner did not say.
   */
  function workRequestsOf(projectId) {
    if (!tableExists("work_requests")) return [];
    return db.prepare(`SELECT id, text_redacted, intent, status, project_id, explanation_json, plan_ref, created_at, expires_at FROM work_requests
      WHERE status IN (${LIVE_REQUESTS.map(() => "?").join(",")}) AND expires_at > ? AND (project_id = ? OR project_id IS NULL) ORDER BY updated_at DESC LIMIT 5`)
      .all(...LIVE_REQUESTS, iso(), projectId).map((r) => {
        const ex = parse(r.explanation_json, {});
        const ref = parse(r.plan_ref, null);
        return { id: r.id, text: clip(r.text_redacted, 300), intent: r.intent, status: r.status, company: !r.project_id, cause: ex.cause || null, causes: Array.isArray(ex.causes) ? ex.causes.slice(0, 8) : [],
          options: (Array.isArray(ex.options) ? ex.options : []).slice(0, 8).map((o) => ({ kind: String(o.kind || ""), code: String(o.code || ""), label: clip(o.label, 240) })),
          automaticOnly: Boolean(ex.automaticOnly), planRef: ref && /^(envelope|ops)$/.test(ref.kind) ? { kind: ref.kind, id: ref.id } : null, createdAt: r.created_at, expiresAt: r.expires_at };
      });
  }

  /**
   * The cockpit of one project: what is done (with evidence), what is open or blocked, the last session, the recommended
   * next step separated from what is already approved or running, the agents and environments really available and the
   * isolation state. `state` is one of PROJECT_STATES.
   */
  async function projectCockpit(projectId) {
    const project = projects.get(projectId);
    if (!project) return null;
    const all = missions.list(project.id);
    const factories = new Map(factory.list().filter((f) => f.projectId === project.id).map((f) => [f.missionId, f]));
    const active = runs.activeRuns().filter((r) => {
      const conv = db.prepare("SELECT project_id FROM conversations WHERE id = ?").get(r.conversationId);
      return conv?.project_id === project.id;
    });
    const bundles = bundlesOf(project.id);
    const done = [
      ...bundles.filter((b) => b.status === "ACCEPTED" || b.decided_at).map((b) => ({ kind: "bundle", id: b.id, missionId: b.mission_id, title: b.title, status: b.status, at: b.decided_at || b.created_at,
        evidence: `pachet ${b.id} · spec v${b.spec_version} · change set ${String(b.change_set_sha || "").slice(0, 12)}`, source: "factory_bundles" })),
      ...all.filter((m) => m.status === "COMPLETED" && !factories.has(m.id)).slice(0, 10).map((m) => ({ kind: "mission", id: m.id, title: m.title, status: m.status, at: m.updatedAt, evidence: `${missions.progress(m.id).completed}/${missions.progress(m.id).total} sarcini verificate`, source: "missions" })),
    ].sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 12);
    const open = []; const blocked = []; const readyForReview = [];
    for (const m of all.filter((x) => !FINISHED_MISSION.has(x.status))) {
      const f = factories.get(m.id);
      const item = { missionId: m.id, title: m.title, status: m.status, stage: f?.stage || null, waitReason: f?.waitReason || null, reason: clip(f?.stageReason || "", 240), at: f?.updatedAt || m.updatedAt, source: f ? "factory_missions" : "missions" };
      if (f?.stage === "DELIVERY_READY") readyForReview.push(item);
      else if (f && ["BLOCKED", "NEEDS_OWNER_DECISION", "PAUSED"].includes(f.stage)) blocked.push(item);
      else if (!f && m.status === "BLOCKED") blocked.push(item);
      else if (!(f && ["ACCEPTED", "REJECTED", "CANCELLED"].includes(f.stage))) open.push(item);
    }
    const runningFactory = [...factories.values()].filter((f) => ACTIVE_STAGES.has(f.stage));
    const open_envelope = envelopes.openFor(project.id);
    const proposed = envelopes.forProject(project.id, 5).find((e) => e.status === "PROPOSED" && new Date(e.confirmBy) > clock()) || null;
    const draftViews = [...factories.values()].filter((f) => f.stage === "SPEC_DRAFT").map((f) => factory.view(f.missionId)).filter(Boolean);
    const readiness = envelopes.readiness(project, draftViews.slice(0, 1));
    const roadmap = roadmapFromNotes(project);
    const repoState = await repo(project);
    const stageMap = factoryRunner?.stageMap ? factoryRunner.stageMap(project) : null;
    const autonomy = envelopes.autonomyOf(project.id);

    let state = "CONTEXT_AVAILABLE";
    if (runningFactory.length || active.length) state = "RUNNING";
    else if (readyForReview.length) state = "READY_FOR_REVIEW";
    else if (open_envelope?.status === "WAITING_OWNER" || blocked.length) state = "WAITING_OWNER";
    else if (open_envelope) state = "AUTHORIZED";
    else if (draftViews.some((v) => v.scope)) state = readiness.eligible ? "PLAN_READY" : readiness.afterReadiness ? "PLAN_READY_AFTER_READINESS" : readiness.blockers.some((b) => b.kind === "isolation") ? "BLOCKED_BY_ISOLATION" : "PLAN_BLOCKED";
    else if (!all.length && !roadmap.files.length && !done.length) state = "NO_CONTEXT";

    const missing = [];
    if (!all.length) missing.push("Nicio misiune înregistrată în Hub pentru acest proiect");
    if (!roadmap.files.length) missing.push("Proiectul nu are README sau notițe .ifrim citibile");
    if (!repoState.available) missing.push(`Starea repository-ului: ${repoState.reason}`);

    const next = recommendNext({ project, readyForReview, open_envelope, runningFactory, active, draftViews, readiness, blocked, roadmap, all });
    return {
      generatedAt: iso(),
      project: { id: project.id, name: project.name, slug: project.slug, kind: project.source === "hub-test" ? "test" : "real", source: project.source, stack: project.stack, status: project.status, executionAllowed: project.executionAllowed },
      state: { code: state, label: PROJECT_STATES[state] },
      done, open, blocked, readyForReview,
      running: { runs: active.map((r) => ({ runId: r.runId, provider: r.provider, environment: r.environment, phase: r.phase, startedAt: r.startedAt, lastEventAt: r.lastEventAt })),
        missions: runningFactory.map((f) => ({ missionId: f.missionId, title: f.title, stage: f.stage, reason: clip(f.stageReason, 200), at: f.updatedAt })) },
      approved: open_envelope ? { envelopeId: open_envelope.id, status: open_envelope.status, level: open_envelope.autonomyLevel, missions: open_envelope.missionIds, confirmedAt: open_envelope.confirmedAt, expiresAt: open_envelope.expiresAt } : null,
      // M10.2 (U15): a plan waiting for the owner survives a reload and the end of the voice session — including its armed window
      // (until when, never its nonces) — and so do the operation plan on screen and the requests the Hub kept while blocked.
      proposedPlan: proposed ? { envelopeId: proposed.id, headline: proposed.summary.headline, confirmBy: proposed.confirmBy, armedUntil: armedEnvelopeUntil(proposed.id) } : null,
      proposedOpsPlan: proposedOpsPlan(),
      workRequests: workRequestsOf(project.id),
      next, lastSession: lastSessionOf(project.id), repo: repoState, decisions: decisionsOf(project.id), roadmap,
      agents: agentsOf(), environments: stageMap ? { route: stageMap.route, realProjectEligible: stageMap.realProjectEligible, stages: stageMap.stages.map((s) => ({ stage: s.stage, label: s.label, where: s.where, boundary: s.boundary, boundaryLabel: s.boundaryLabel })), blockers: stageMap.blockers } : null,
      isolation: { realProjectEligible: Boolean(stageMap?.realProjectEligible), testProject: project.source === "hub-test", blockers: readiness.blockers.filter((b) => b.kind === "isolation").map((b) => b.detail) },
      autonomy: { ...autonomy, label: AUTONOMY_LABELS[autonomy.level] },
      frozen: Boolean(settings.get("projectFreeze")?.[project.id]),
      missing,
    };
  }

  /** One recommended next step (plus alternatives), each with its reason and source; no invented commercial priority. */
  function recommendNext({ project, readyForReview, open_envelope, runningFactory, active, draftViews, readiness, blocked, roadmap, all }) {
    const options = [];
    for (const r of readyForReview) options.push({ kind: "review_delivery", missionId: r.missionId, text: `Verifică livrarea „${r.title}” (accepți sau respingi)`, why: "Un pachet de livrare așteaptă decizia ta", source: "factory" });
    if (open_envelope?.status === "WAITING_OWNER") options.push({ kind: "decide", envelopeId: open_envelope.id, text: "Decide cum continuă misiunea autorizată", why: open_envelope.closeReason || "Misiunea așteaptă o decizie", source: "envelope" });
    if (runningFactory.length || active.length) options.push({ kind: "watch", text: "Urmărește execuția; nimic de decis acum", why: `${runningFactory.length || active.length} pas(uri) rulează`, source: "runs" });
    for (const v of draftViews) {
      if (v.scope) options.push(readiness.eligible
        ? { kind: "confirm_plan", missionId: v.mission.id, text: `Vezi și confirmă planul pentru „${v.mission.title}”`, why: "Specificația e completă", source: "factory" }
        : { kind: "unblock", missionId: v.mission.id, text: `Planul pentru „${v.mission.title}” e gata, dar execuția e blocată`, why: readiness.blockers.map((b) => b.detail).slice(0, 2).join(" · "), source: "gate" });
      else options.push({ kind: "complete_spec", missionId: v.mission.id, text: `Completează specificația pentru „${v.mission.title}”`, why: (v.spec?.protected?.problems || []).slice(0, 2).join("; ") || "specificație incompletă", source: "factory" });
    }
    for (const b of blocked.slice(0, 3)) options.push({ kind: "unblock", missionId: b.missionId, text: `Deblochează „${b.title}”`, why: b.reason || b.stage || b.status, source: b.source });
    for (const item of roadmap.items.slice(0, 2)) options.push({ kind: "from_notes", text: item.text, why: `Din notițele proiectului (${item.source}); nu e verificat de Hub`, source: item.source });
    if (!options.length) options.push({ kind: "describe", text: `Spune-mi ce vrei să facem pe ${project.name} și pregătesc specificația (nimic nu pornește fără confirmarea ta)`, why: all.length ? "Nicio misiune deschisă" : "Nu există context suficient în Hub", source: "hub" });
    return { recommended: options[0], alternatives: options.slice(1, 5) };
  }

  // ---------- delta briefing ("ce s-a schimbat de la ultima vizită") ----------
  function lastVisit(projectId) { return db.prepare("SELECT * FROM owner_visits WHERE project_id = ?").get(projectId) || null; }
  function markVisit(projectId) {
    const seq = bus.lastSeq();
    db.prepare("INSERT INTO owner_visits (project_id, last_seen_at, last_seq) VALUES (?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET last_seen_at = excluded.last_seen_at, last_seq = excluded.last_seq").run(projectId, iso(), seq);
    return { projectId, at: iso(), seq };
  }
  /** Changes since the owner's last visit (project id, or "__company__"): counted from the event log, with times in UTC. */
  function delta(projectId, { limit = 2000 } = {}) {
    const visit = lastVisit(projectId);
    const after = visit?.last_seq || 0;
    const rows = projectId === "__company__"
      ? db.prepare("SELECT type, scope_id, project_id, payload_json, created_at FROM events WHERE seq > ? ORDER BY seq DESC LIMIT ?").all(after, limit)
      : db.prepare("SELECT type, scope_id, project_id, payload_json, created_at FROM events WHERE seq > ? AND project_id = ? ORDER BY seq DESC LIMIT ?").all(after, projectId, limit);
    const count = (prefix) => rows.filter((r) => r.type.startsWith(prefix)).length;
    const stages = rows.filter((r) => r.type === "factory.stage").map((r) => ({ missionId: r.scope_id, stage: parse(r.payload_json, {}).stage, at: r.created_at }));
    return {
      since: visit?.last_seen_at || null, firstVisit: !visit, events: rows.length,
      runs: { completed: count("run.completed"), failed: count("run.failed"), interrupted: count("run.interrupted") },
      deliveries: stages.filter((s) => s.stage === "DELIVERY_READY").length, blocked: stages.filter((s) => ["BLOCKED", "NEEDS_OWNER_DECISION"].includes(s.stage)).length,
      accepted: stages.filter((s) => s.stage === "ACCEPTED").length, envelopes: count("envelope."), approvals: count("approval.requested"),
      lastStages: stages.slice(0, 8), timezoneNote: "Orele din Hub sunt UTC; interfața le afișează în ora ta locală.",
    };
  }

  // ---------- explain ----------
  /** "Ce face acum?": phase, last confirmed action, environment, worker, elapsed time, staleness. No invented progress. */
  function status({ projectId = null, worker = null } = {}) {
    const t = clock().getTime();
    const list = runs.activeRuns().filter((r) => !worker || r.provider === worker).filter((r) => {
      if (!projectId) return true;
      const conv = db.prepare("SELECT project_id FROM conversations WHERE id = ?").get(r.conversationId);
      return conv?.project_id === projectId;
    });
    const items = list.map((r) => {
      const last = r.lastEventAt || r.startedAt;
      const quietMs = last ? t - Date.parse(last) : null;
      const run = runs.getRun(r.runId);
      const lastEvent = db.prepare("SELECT type, created_at FROM events WHERE run_id = ? ORDER BY seq DESC LIMIT 1").get(r.runId);
      return { runId: r.runId, provider: r.provider, environment: r.environment, stage: run?.stage || null, model: run?.model || null,
        phase: r.phase === "streaming" ? "modelul lucrează (ieșire primită)" : "aștept primul răspuns al providerului",
        startedAt: r.startedAt, elapsedS: r.startedAt ? Math.round((t - Date.parse(r.startedAt)) / 1000) : null,
        lastConfirmed: lastEvent ? { type: lastEvent.type, at: lastEvent.created_at } : null,
        stale: quietMs !== null && quietMs > STALE_MS, quietS: quietMs === null ? null : Math.round(quietMs / 1000),
        progress: "nemăsurat per test (providerul nu raportează progresul pe teste)" };
    });
    const missionsActive = factory.list().filter((f) => ACTIVE_STAGES.has(f.stage) && (!projectId || f.projectId === projectId))
      .map((f) => ({ missionId: f.missionId, title: f.title, stage: f.stage, waitReason: f.waitReason, reason: clip(f.stageReason, 220), updatedAt: f.updatedAt }));
    return { at: iso(), runs: items, missions: missionsActive, idle: !items.length && !missionsActive.length };
  }

  /** "De ce e blocat?": the concrete rule, the dependency and the smallest action that unblocks it. */
  function whyBlocked({ missionId = null, projectId = null } = {}) {
    const target = missionId ? factory.view(missionId) : null;
    const out = [];
    if (target) {
      const f = target.factory;
      out.push({ what: `„${target.mission.title}” · ${f.stage}${f.waitReason ? ` (așteaptă: ${f.waitReason})` : ""}`, rule: clip(f.stageReason, 400), source: "factory_missions", at: f.updatedAt,
        action: f.waitReason === "grant" ? "Planul confirmat a rămas fără autoritate: confirmă din nou planul (granturile se derivă singure)"
          : f.waitReason === "gate" ? "Poarta de execuție e suspendată sau o verificare a porții eșuează: vezi lista de mai jos"
            : f.stage === "NEEDS_OWNER_DECISION" ? "Decizia ta: reia (eventual cu un ciclu în plus) sau oprește" : f.stage === "PAUSED" ? "Spune „Continuă”: o reiau în limitele planului confirmat (fără plan în vigoare, „Continuă misiunea …” pregătește un plan de continuare)" : "Verifică motivul de mai sus" });
    }
    // „De ce e blocat?” asked outside a project (voice, the company view) still explains the gate instead of failing on a missing id.
    const pid = projectId || target?.project?.id || null;
    const project = pid ? projects.get(pid) : null;
    if (project) {
      const r = envelopes.readiness(project, []);
      for (const b of r.blockers) out.push({ what: b.id, rule: b.detail, source: "poarta de execuție", at: iso(), action: b.kind === "isolation" ? "Izolarea se închide prin pașii M06-A (mediu atestat + politica (b)); nu o ocolește nicio confirmare" : "Rezolvă verificarea porții indicată" });
    }
    const gateState = settings.get("executionGate");
    if (gateState.status !== "open") {
      // Review M10.2 #4 / M10.2.1 D14: who suspended the gate decides the smallest action, read from the recorded suspension (never the
      // reason text), with the same classifier and words as the readiness facts / blockers.mjs GATE_SUSPENDED: after the owner's OWN
      // pause „Continuă” reopens it (interrupts.resumeOwnPause); anything else is reopened here, in the cockpit, by the rearm card (owner
      // session + a fresh Windows Hello) once the stop is confirmed — never an administration pointer.
      const by = gateSuspendedBy(gateState);
      let rearm = null;
      try { rearm = gateRearm ? gateRearm.eligibility() : null; } catch { rearm = null; }
      const unowned = by === "pause_unowned" ? "Hub-ul a fost pus pe pauză fără sesiunea ta de proprietar. " : "";
      const action = by === "owner_pause" ? "Spune sau scrie „Continuă”: redeschid poarta după pauza ta"
        : rearm && !rearm.eligible && rearm.code !== "OPEN" ? `${unowned}${rearm.reason}`
          : `${unowned}Poarta e oprită ${STOPPED_BY[by] || STOPPED_BY.legacy_unknown}: o redeschid aici, în cockpit, cu Windows Hello (cardul „Redeschide poarta”); nimic vechi nu repornește singur${rearm?.code === "SECURITY" ? ". Cardul îți arată întâi evenimentele de securitate din jurul opririi" : ""}`;
      out.push({ what: "Poarta de execuție", rule: `Suspendată: ${gateState.reason}`, source: "settings", at: gateState.changedAt, suspendedBy: by,
        rearm: rearm ? { eligible: rearm.eligible, code: rearm.code } : null, action });
    }
    return { at: iso(), items: out, blocked: out.length > 0 };
  }

  /** "De ce Claude aici?": the route reason and the capability, from the factory routes and the run's recorded plan. */
  function whyRoute({ worker = "claude", missionId = null } = {}) {
    const role = worker === "claude" ? "reviewer" : "writer";
    const route = ROUTES[role];
    const reason = worker === "claude"
      ? "Claude Code este reviewer-ul independent: citește change set-ul cu Read/Glob/Grep, fără scriere, ca rezultatul să nu fie verificat de același model care l-a scris."
      : "Codex este writer-ul unic: singurul care modifică workspace-ul, în sandbox, ca să existe un singur autor al change set-ului.";
    let plan = null;
    if (missionId) {
      const v = factory.view(missionId);
      const run = v?.runs?.filter((r) => r.provider === worker).slice(-1)[0];
      if (run) plan = { runId: run.id, model: run.model || run.plan?.model || null, effort: run.effort || run.plan?.effort || null, environment: run.environment || null };
    }
    return { worker, role, route, reason, plan, source: "factory/plan.mjs ROUTES + planul execuției" };
  }

  /** A duration estimate only from comparable measured runs (≥ 3); otherwise it says there is none. */
  function estimate({ stage, provider }) {
    const rows = db.prepare("SELECT duration_ms FROM execution_telemetry WHERE task_type = ? AND provider = ? AND duration_ms IS NOT NULL ORDER BY created_at DESC LIMIT 30").all(stage, provider).map((r) => r.duration_ms).sort((a, b) => a - b);
    if (rows.length < 3) return { available: false, samples: rows.length, text: "Nu există o estimare suficientă (sub 3 execuții comparabile măsurate)" };
    const q = (p) => rows[Math.min(rows.length - 1, Math.floor(p * (rows.length - 1)))];
    return { available: true, samples: rows.length, p25Ms: q(0.25), p75Ms: q(0.75), text: `Între ${Math.round(q(0.25) / 60000)} și ${Math.round(q(0.75) / 60000)} min (interval din ${rows.length} execuții măsurate; nu e o promisiune)` };
  }

  // ---------- replay (read-only, historical) ----------
  /**
   * "Arată-mi de ce a picat": the mission's history as frames (snapshot → command/test → result → finding → repair →
   * verification). READ_ONLY and HISTORICAL: nothing here is re-executed, no grant or tool call is created, and no frame
   * reaches the live scheduler.
   */
  function replay(missionId) {
    const v = factory.view(missionId);
    if (!v) return null;
    const frames = [];
    const push = (at, kind, title, detail, refs = {}) => frames.push({ at, kind, title: clip(title, 160), detail: clip(detail, 400), refs });
    for (const e of db.prepare("SELECT type, payload_json, created_at FROM events WHERE mission_id = ? AND type IN ('factory.stage','factory.spec_version','envelope.confirmed') ORDER BY seq").all(missionId)) {
      const p = parse(e.payload_json, {});
      if (e.type === "factory.stage") push(e.created_at, "stage", `Etapa ${p.stage}`, p.reason || "", { stage: p.stage });
      else if (e.type === "factory.spec_version") push(e.created_at, "spec", `Specificația v${p.version}`, `${p.problems || 0} probleme`, {});
    }
    for (const s of db.prepare("SELECT id, seq, kind, created_at, sha256 FROM factory_snapshots WHERE mission_id = ? ORDER BY seq").all(missionId)) push(s.created_at, "snapshot", `Snapshot ${s.kind} #${s.seq}`, `sha ${String(s.sha256).slice(0, 12)}`, { snapshotId: s.id });
    for (const c of v.changeSets) push(c.createdAt, "change_set", `Change set ${c.seq} (${c.status})`, `${c.changes.length} fișiere`, { changeSetId: c.id });
    for (const e of v.evidence) push(e.createdAt, "evidence", `${e.stage} · ${e.command}`, `${e.status}${e.counts?.failed ? ` · ${e.counts.failed} eșuate` : ""}${e.stale ? " · depășit de un change set nou" : ""}${e.outputTail ? ` — ${e.outputTail.split("\n").slice(-2).join(" ")}` : ""}`, { evidenceId: e.id, status: e.status, stale: e.stale });
    for (const f of v.findings) push(f.createdAt, "finding", `${f.code} [${f.severity}] ${f.file || ""}`, `${f.observation} — ${f.status}`, { findingId: f.id, status: f.status });
    for (const r of v.reviews) push(r.createdAt, "review", `Review ${r.verdict} (${r.status})`, r.summary, { reviewId: r.id });
    for (const r of v.runs) push(r.timeline?.startedAt || r.timeline?.requestedAt || v.factory.createdAt, "run", `${r.provider} · ${r.stage} · ${r.status}`, `${r.model || ""} ${r.errorMessage ? `— ${r.errorMessage}` : ""}`, { runId: r.id });
    frames.sort((a, b) => String(a.at).localeCompare(String(b.at)));
    const failures = frames.filter((f) => (f.kind === "evidence" && f.refs.status === "FAIL") || (f.kind === "run" && /failed/.test(f.title)));
    return { mode: "READ_ONLY", historical: true, missionId, title: v.mission.title, stage: v.factory.stage, generatedAt: iso(), frames, firstFailure: failures[0] || null,
      note: "Reluare istorică: nimic nu se re-execută, nu se creează granturi și niciun cadru nu ajunge în execuția live." };
  }

  // ---------- company map (spatial levels; real counts only) ----------
  function companyMap() {
    const depts = company?.departments ? company.departments() : [];
    const roles = db.prepare("SELECT definition_json FROM agent_roles").all().map((r) => parse(r.definition_json, {}));
    const activeRuns = runs.activeRuns();
    const missionsByDept = new Map();
    for (const m of missions.list()) {
      const dept = db.prepare("SELECT d.key FROM missions m LEFT JOIN departments d ON d.id = m.department_id WHERE m.id = ?").get(m.id)?.key || "fără departament";
      if (!missionsByDept.has(dept)) missionsByDept.set(dept, []);
      missionsByDept.get(dept).push(m);
    }
    const runsByMission = new Map();
    for (const r of activeRuns) {
      const mid = r.taskId ? db.prepare("SELECT mission_id FROM tasks WHERE id = ?").get(r.taskId)?.mission_id : null;
      if (mid) runsByMission.set(mid, [...(runsByMission.get(mid) || []), r]);
    }
    return {
      at: iso(), activeRuns: activeRuns.length,
      departments: depts.map((d) => {
        const ms = missionsByDept.get(d.key) || [];
        return { key: d.key, name: d.name, status: d.status, rolesConfigured: roles.filter((r) => r.department === d.key).length,
          missions: ms.slice(0, 30).map((m) => {
            const f = factory.view(m.id)?.factory || null;
            const mr = runsByMission.get(m.id) || [];
            return { id: m.id, title: m.title, status: m.status, projectId: m.projectId, stage: f?.stage || null, waitReason: f?.waitReason || null,
              executions: mr.map((r) => ({ runId: r.runId, provider: r.provider, environment: r.environment, phase: r.phase })) };
          }),
          activeExecutions: ms.reduce((n, m) => n + (runsByMission.get(m.id)?.length || 0), 0) };
      }),
      note: "Un rol configurat nu e un worker activ: doar execuțiile din „executions” rulează acum.",
    };
  }

  return { projectCockpit, delta, markVisit, status, whyBlocked, whyRoute, estimate, replay, companyMap, roadmapFromNotes, attachGateRearm };
}
