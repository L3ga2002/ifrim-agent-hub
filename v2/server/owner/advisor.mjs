import { HubError } from "../core/errors.mjs";
import { newId } from "../core/ids.mjs";
import { json, parse } from "../storage/db.mjs";
import { catalogEntry } from "../policy/approval-policy.mjs";
import { buildReviewBrief, parseReview } from "../factory/review.mjs";

/**
 * Quiet proactivity, recommendations and Shadow Mode (M06 §27, §28).
 *
 * - Every interruption has a reason: USER_REQUESTED, DECISION_REQUIRED, BLOCKED, RISK or MISSION_COMPLETE. Frequent events
 *   are aggregated per mission; quiet hours and "only decisions" filter what may speak or pop up (never what is recorded).
 * - Recommendations come from the owner's own recorded decisions (approvals, confirmed repair cycles), with the evidence and
 *   the exact change; they are never applied automatically and never promote an agent because it rated itself well.
 * - Shadow Mode: a second reviewer reads the same change set read-only; its verdict is stored as a proposal for comparison
 *   and never feeds the mission. It is a model run, so it needs an authorization (a grant) like any other: shadow is not
 *   free inference.
 */
export const ATTENTION_REASONS = Object.freeze(["USER_REQUESTED", "DECISION_REQUIRED", "BLOCKED", "RISK", "MISSION_COMPLETE"]);

export function classifyEvent(event) {
  const p = event.payload || {};
  if (event.type === "approval.requested") return { reason: "DECISION_REQUIRED", title: `Aprobare: ${p.actionKind}`, key: `approval:${p.approvalId}` };
  if (event.type === "envelope.proposed") return { reason: "USER_REQUESTED", title: "Plan pregătit; așteaptă confirmarea ta", key: `envelope:${event.scopeId}` };
  if (event.type === "envelope.status" && p.status === "WAITING_OWNER") return { reason: "DECISION_REQUIRED", title: `Misiunea autorizată așteaptă: ${p.reason || ""}`, key: `envelope:${event.scopeId}` };
  if (event.type === "factory.stage") {
    if (p.stage === "DELIVERY_READY") return { reason: "MISSION_COMPLETE", title: "Livrare gata de verificarea ta", key: `mission:${event.scopeId}` };
    if (p.stage === "NEEDS_OWNER_DECISION") return { reason: "DECISION_REQUIRED", title: `Decizie necesară: ${p.reason || ""}`, key: `mission:${event.scopeId}` };
    if (p.stage === "BLOCKED") return { reason: "BLOCKED", title: `Blocat: ${p.reason || ""}`, key: `mission:${event.scopeId}` };
  }
  if (event.type === "run.failed" && !event.taskId) return { reason: "BLOCKED", title: "O execuție a eșuat", key: `run:${event.runId || event.scopeId}` };
  if (["system.stop_all", "lega.session.violation", "backup.failed", "owner.credential_registered", "owner.credential_revoked"].includes(event.type)) return { reason: "RISK", title: event.type, key: `${event.type}:${event.scopeId}` };
  if (event.type === "environment.attestation" && p.status && !/^PASS/.test(p.status)) return { reason: "RISK", title: `Atestarea mediului: ${p.status}`, key: `env:${event.scopeId}` };
  return null;
}

function inQuietHours(quiet, at) {
  if (!quiet || typeof quiet.from !== "string" || typeof quiet.to !== "string") return false;
  const minutes = (s) => { const [h, m] = s.split(":").map(Number); return h * 60 + (m || 0); };
  const d = new Date(at);
  const local = d.getHours() * 60 + d.getMinutes();
  const from = minutes(quiet.from); const to = minutes(quiet.to);
  return from <= to ? local >= from && local < to : local >= from || local < to;
}

export function createAdvisor({ db, bus, clock, settings, approvals, envelopes, runs, factory, conversations, projects, grants }) {
  const iso = () => clock().toISOString();

  /** Aggregated items that may interrupt the owner since `afterSeq` (one per mission/approval key, the latest wins). */
  function attention({ afterSeq = 0, limit = 1000 } = {}) {
    const prefs = settings.get("ownerPrefs") || {};
    const rows = bus.since(afterSeq, limit);
    const byKey = new Map();
    for (const event of rows) {
      const c = classifyEvent(event);
      if (!c) continue;
      const prev = byKey.get(c.key);
      byKey.set(c.key, { ...c, seq: event.seq, at: event.createdAt, projectId: event.projectId, missionId: event.missionId, count: (prev?.count || 0) + 1 });
    }
    let items = [...byKey.values()].sort((a, b) => b.seq - a.seq);
    const quiet = inQuietHours(prefs.quietHours, iso());
    const allowed = prefs.onlyDecisions ? new Set(["DECISION_REQUIRED", "RISK", "MISSION_COMPLETE"]) : new Set(ATTENTION_REASONS);
    items = items.map((i) => ({ ...i, interrupt: allowed.has(i.reason) && !(quiet && i.reason !== "RISK"), voice: Boolean(prefs.voiceNotifications) && allowed.has(i.reason) && !quiet }));
    return { at: iso(), lastSeq: bus.lastSeq(), quietHours: quiet, onlyDecisions: Boolean(prefs.onlyDecisions), items: items.slice(0, 50),
      note: "Agregat: un singur rând per misiune sau aprobare; nimic nu se pierde din jurnal." };
  }

  function setPrefs(patch, actor = "owner") {
    const current = settings.get("ownerPrefs") || {};
    const next = { ...current };
    if (patch.onlyDecisions !== undefined) next.onlyDecisions = Boolean(patch.onlyDecisions);
    if (patch.voiceNotifications !== undefined) next.voiceNotifications = Boolean(patch.voiceNotifications);
    if (patch.quietHours !== undefined) {
      const q = patch.quietHours;
      if (q !== null && !(q && /^\d{2}:\d{2}$/.test(q.from) && /^\d{2}:\d{2}$/.test(q.to))) throw new HubError("validation", "Orele de liniște au forma { from: \"22:00\", to: \"08:00\" }");
      next.quietHours = q;
    }
    bus.transaction(() => settings.set("ownerPrefs", next, actor, "Owner interruption preferences"));
    return next;
  }

  /**
   * Proposals with evidence and the exact change; each is applied only by the owner (policy rule through the UI, autonomy
   * level through a re-authenticated session).
   */
  function recommendations() {
    const since = new Date(clock().getTime() - 30 * 86400000).toISOString();
    const out = [];
    const decided = db.prepare("SELECT action_kind, target, status, decided_at, scope_type, scope_id FROM approvals WHERE decided_at IS NOT NULL AND decided_at >= ?").all(since);
    const groups = new Map();
    for (const a of decided) {
      const entry = catalogEntry(a.action_kind);
      if (!entry || entry.locked || entry.loosest === "ALWAYS_ASK") continue;
      const key = a.action_kind;
      const g = groups.get(key) || { actionKind: key, approved: 0, rejected: 0, last: null, loosest: entry.loosest, label: entry.label };
      if (["approved", "consumed"].includes(a.status)) g.approved += 1; else if (a.status === "rejected") g.rejected += 1;
      g.last = !g.last || a.decided_at > g.last ? a.decided_at : g.last;
      groups.set(key, g);
    }
    for (const g of groups.values()) {
      if (g.approved >= 5 && g.rejected === 0) out.push({ kind: "policy_rule", title: `${g.label}: aprobat de ${g.approved} ori în 30 de zile, niciun refuz`,
        evidence: { approved: g.approved, rejected: g.rejected, last: g.last, window: "30 de zile" },
        change: { command: "policy.set_rule", payload: { actionKind: g.actionKind, policy: g.loosest, reason: "Recomandare din istoricul aprobărilor tale" } },
        effect: g.loosest === "ASK_ONCE_FOR_TASK" ? "O singură aprobare per task în loc de una la fiecare acțiune" : "Permis automat", appliesOnlyWhen: "o aplici tu (Politici)" });
    }
    for (const p of projects.list()) {
      const deltas = db.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'envelope.delta_confirmed' AND project_id = ? AND created_at >= ?").get(p.id, since).n;
      const refusedRepairs = db.prepare("SELECT COUNT(*) AS n FROM mission_envelopes WHERE project_id = ? AND status = 'REVOKED' AND created_at >= ?").get(p.id, since).n;
      const level = envelopes.autonomyOf(p.id).level;
      if (level === "ASSISTED" && deltas >= 3 && refusedRepairs === 0) out.push({ kind: "autonomy", projectId: p.id, title: `${p.name}: ai confirmat fiecare remediere (${deltas}) fără să revoci vreun plan`,
        evidence: { confirmedRepairs: deltas, revokedPlans: refusedRepairs, window: "30 de zile" }, change: { command: "owner.autonomy.set", payload: { projectId: p.id, level: "TRUSTED" } },
        effect: "Remedierile din limita misiunii nu ți-ar mai cere confirmare separată", appliesOnlyWhen: "o confirmi tu, cu autentificatorul (ridicare de autonomie)" });
    }
    return { at: iso(), items: out, note: "Recomandările vin din deciziile tale înregistrate; nimic nu se aplică automat." };
  }

  // ---------- Shadow Mode ----------
  const rowToShadow = (r) => r && ({ id: r.id, missionId: r.mission_id, changeSetId: r.change_set_id, changeSetSha: r.change_set_sha, primaryReviewId: r.primary_review_id,
    runId: r.run_id, conversationId: r.conversation_id, provider: r.provider, model: r.model, status: r.status, verdict: r.verdict, findings: parse(r.findings_json, []),
    metrics: parse(r.metrics_json, {}), requestedBy: r.requested_by, createdAt: r.created_at, updatedAt: r.updated_at });
  const shadowsOf = (missionId) => db.prepare("SELECT * FROM shadow_evaluations WHERE mission_id = ? ORDER BY created_at DESC").all(missionId).map(rowToShadow);

  /** Starts a read-only shadow review of the mission's current change set (needs a usable grant for that provider). */
  async function requestShadowReview({ missionId, provider = "claude", model = "", actor = "owner" }) {
    if (!["claude", "codex"].includes(provider)) throw new HubError("validation", "Provider necunoscut");
    const v = factory.view(missionId);
    if (!v) throw new HubError("not_found", "Misiune necunoscută");
    const cs = v.changeSets.find((c) => c.status === "CURRENT");
    if (!cs) throw new HubError("conflict", "Misiunea nu are încă un change set de evaluat");
    const grant = grants.findUsable(provider, v.project.id, "read-only");
    if (!grant || grants.problem(grant, { provider, projectId: v.project.id, access: "read-only", now: clock() })) {
      throw new HubError("gate", "Shadow folosește un model: are nevoie de un grant doar-citire pentru acest provider și proiect (nu e inferență gratuită)");
    }
    const primary = v.reviews.filter((r) => r.changeSetId === cs.id).slice(-1)[0] || null;
    const conversation = bus.transaction(() => conversations.create({ projectId: v.project.id, title: `Shadow · ${v.mission.title}`.slice(0, 160) }, actor));
    const brief = [
      "SHADOW (evaluare paralelă, doar citire): rezultatul tău NU are niciun efect asupra misiunii; e comparat cu review-ul principal.",
      buildReviewBrief({ mission: v.mission, spec: v.spec.spec, specVersion: v.spec.version, changeSet: cs, checks: v.evidence.filter((e) => e.changeSetId === cs.id && e.stage === "CHECKING" && !e.stale), openFindings: [], cycle: v.factory.repairCycles }),
    ].join("\n\n");
    bus.transaction(() => conversations.addMessage({ conversationId: conversation.id, role: "user", content: brief }, actor));
    const id = newId("shd");
    db.prepare(`INSERT INTO shadow_evaluations (id, mission_id, change_set_id, change_set_sha, primary_review_id, conversation_id, provider, model, status, requested_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'REQUESTED', ?, ?, ?)`).run(id, missionId, cs.id, cs.sha256, primary?.id || null, conversation.id, provider, model, actor, iso(), iso());
    try {
      const { run } = await runs.start({ conversationId: conversation.id, provider, access: "read-only", model, actor: `shadow:${actor}`, stage: "review", roleId: "reviewer", correlationId: id });
      db.prepare("UPDATE shadow_evaluations SET run_id = ?, status = 'RUNNING', updated_at = ? WHERE id = ?").run(run.id, iso(), id);
      bus.emit({ type: "shadow.started", scopeType: "mission", scopeId: missionId, source: actor, payload: { shadowId: id, runId: run.id, provider } });
    } catch (error) {
      db.prepare("UPDATE shadow_evaluations SET status = 'FAILED', metrics_json = ?, updated_at = ? WHERE id = ?").run(json({ error: String(error.message).slice(0, 300) }), iso(), id);
      throw error;
    }
    return rowToShadow(db.prepare("SELECT * FROM shadow_evaluations WHERE id = ?").get(id));
  }

  /** Called when a run ends: a shadow run's answer is parsed and compared; nothing else happens. */
  function onRunFinished(runId) {
    const row = db.prepare("SELECT * FROM shadow_evaluations WHERE run_id = ? AND status = 'RUNNING'").get(runId);
    if (!row) return null;
    const run = runs.getRun(runId);
    const text = run?.outputMessageId ? db.prepare("SELECT content FROM messages WHERE id = ?").get(run.outputMessageId)?.content || "" : "";
    const parsed = run?.status === "completed" ? parseReview(text, { changeSetSha: row.change_set_sha }) : null;
    const primary = row.primary_review_id ? db.prepare("SELECT verdict FROM factory_reviews WHERE id = ?").get(row.primary_review_id) : null;
    const primaryFiles = new Set(row.primary_review_id ? db.prepare("SELECT file FROM factory_findings WHERE review_id = ?").all(row.primary_review_id).map((f) => f.file) : []);
    const shadowFiles = new Set((parsed?.findings || []).map((f) => f.file));
    const overlap = [...shadowFiles].filter((f) => primaryFiles.has(f)).length;
    const metrics = { primaryVerdict: primary?.verdict || null, shadowVerdict: parsed?.verdict || null, verdictAgrees: Boolean(primary && parsed && primary.verdict === parsed.verdict),
      valid: Boolean(parsed?.valid), findings: { primary: primaryFiles.size, shadow: shadowFiles.size, sameFiles: overlap }, runStatus: run?.status || null };
    db.prepare("UPDATE shadow_evaluations SET status = ?, verdict = ?, findings_json = ?, metrics_json = ?, updated_at = ? WHERE id = ?")
      .run(run?.status === "completed" ? "DONE" : "FAILED", parsed?.verdict || null, json((parsed?.findings || []).slice(0, 30)), json(metrics), iso(), row.id);
    bus.emit({ type: "shadow.finished", scopeType: "mission", scopeId: row.mission_id, source: "shadow", payload: { shadowId: row.id, ...metrics } });
    return rowToShadow(db.prepare("SELECT * FROM shadow_evaluations WHERE id = ?").get(row.id));
  }

  return { attention, setPrefs, recommendations, requestShadowReview, onRunFinished, shadowsOf };
}
