import { parse } from "../storage/db.mjs";

/**
 * Agent Performance League (M08 §13) — measured outcomes per role, provider, model, environment and skill version, without false
 * rankings. Only comparable groups are compared (same role, work type and environment); a writer is never compared with a reviewer
 * through one raw rate, and infrastructure trouble (cold starts, environment, transport, quota, gate) is not the model's fault:
 * those runs are excluded and counted separately, like cancelled runs, simulations and (unless asked) test projects. Failures are
 * never deleted to improve a number. Below MIN_EVIDENCE observations a group shows its distribution and INSUFFICIENT_EVIDENCE,
 * never a winner. Routing suggestions are testable proposals; nothing here changes a policy, a model or an effort.
 */
export const MIN_EVIDENCE = 5;
const INFRA_ERRORS = new Set(["environment", "transport", "quota", "gate", "export", "auth", "process", "startup", "backup", "billing", "breaker"]);
const ROLE_OF_STAGE = { IMPLEMENTING: "writer", REPAIRING: "writer", REVIEWING: "reviewer" };
const median = (list) => { const s = list.filter((n) => Number.isFinite(n)).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);

export function createLeague({ db, config }) {
  /** One row per factory model run with what is known about it; unknown stays null. */
  function observations({ includeSimulated = false } = {}) {
    const rows = db.prepare(`SELECT r.id, r.provider, r.model, r.effort, r.status, r.error_category, r.started_at, r.finished_at, r.usage_json, r.skill_versions_json, r.environment,
        d.stage, d.mission_id, fm.work_type, fm.repair_cycles, fm.stage AS mission_stage, p.source AS project_source
      FROM agent_runs r JOIN factory_dispatches d ON d.run_id = r.id JOIN factory_missions fm ON fm.mission_id = d.mission_id JOIN missions m ON m.id = d.mission_id JOIN projects p ON p.id = m.project_id
      WHERE d.stage IN ('IMPLEMENTING','REPAIRING','REVIEWING')`).all();
    const firstReview = new Map();
    // The first CODE review of a mission. M11 L5's step 0 stores the review of the Hub-written test in the same table under
    // change_set_id "acceptance:<sha12>" (no change set exists yet): it says nothing about the writer and never counts here.
    for (const r of db.prepare("SELECT mission_id, verdict, created_at FROM factory_reviews WHERE change_set_id NOT LIKE 'acceptance:%' ORDER BY created_at").all()) if (!firstReview.has(r.mission_id)) firstReview.set(r.mission_id, r.verdict);
    const ownerDecisions = new Map();
    for (const r of db.prepare("SELECT scope_id, COUNT(*) AS n FROM events WHERE type = 'factory.stage' AND json_extract(payload_json, '$.stage') = 'NEEDS_OWNER_DECISION' GROUP BY scope_id").all()) ownerDecisions.set(r.scope_id, r.n);
    return rows.map((r) => {
      const usage = parse(r.usage_json, {});
      const tokens = usage?.tokens?.total?.totalTokens ?? (usage?.tokens?.input_tokens !== undefined ? (usage.tokens.input_tokens || 0) + (usage.tokens.output_tokens || 0) + (usage.tokens.cache_read_input_tokens || 0) + (usage.tokens.cache_creation_input_tokens || 0) : null);
      let excluded = null;
      const simulated = Boolean(config?.simulation || config?.testMode);
      if (simulated && !includeSimulated) excluded = "simulare";
      else if (["interrupted", "cancelled", "interrupted_unknown", "orphaned"].includes(r.status)) excluded = "anulată / întreruptă";
      else if (r.status !== "completed" && INFRA_ERRORS.has(String(r.error_category || ""))) excluded = "infrastructură";
      return { runId: r.id, role: ROLE_OF_STAGE[r.stage] || "other", stage: r.stage, provider: r.provider, model: r.model || "implicit", effort: r.effort || "", environment: r.environment || "windows",
        workType: r.work_type, missionId: r.mission_id, missionStage: r.mission_stage, repairCycles: r.repair_cycles, test: r.project_source === "hub-test", status: r.status, errorCategory: r.error_category,
        durationMs: r.started_at && r.finished_at ? new Date(r.finished_at) - new Date(r.started_at) : null, tokens: Number.isFinite(tokens) ? tokens : null,
        skillVersions: parse(r.skill_versions_json, []), firstReview: firstReview.get(r.mission_id) || null, ownerDecisions: ownerDecisions.get(r.mission_id) || 0, excluded, simulated };
    });
  }

  function summarize(list) {
    const writers = list.filter((o) => o.role === "writer");
    const reviewers = list.filter((o) => o.role === "reviewer");
    const missions = [...new Set(writers.map((o) => o.missionId))];
    const missionRow = (id) => writers.find((o) => o.missionId === id);
    const delivered = missions.filter((id) => ["DELIVERY_READY", "ACCEPTED"].includes(missionRow(id).missionStage));
    const firstPass = missions.filter((id) => missionRow(id).firstReview === "PASS" && missionRow(id).repairCycles === 0);
    return {
      runs: list.length, completed: list.filter((o) => o.status === "completed").length, failed: list.filter((o) => o.status !== "completed").length,
      missions: missions.length || null,
      criteriaMetPct: writers.length ? pct(delivered.length, missions.length) : null,
      firstPassVerifiedPct: writers.length ? pct(firstPass.length, missions.length) : null,
      medianRepairs: writers.length ? median(missions.map((id) => missionRow(id).repairCycles)) : null,
      reviewVerdicts: reviewers.length ? reviewers.reduce((acc, o) => { const v = o.firstReview || "necunoscut"; acc[v] = (acc[v] || 0) + 1; return acc; }, {}) : null,
      ownerInterventions: missions.reduce((sum, id) => sum + (missionRow(id)?.ownerDecisions || 0), 0),
      medianDurationMin: median(list.map((o) => (o.durationMs === null ? NaN : o.durationMs / 60000))) !== null ? Math.round(median(list.map((o) => (o.durationMs === null ? NaN : o.durationMs / 60000))) * 10) / 10 : null,
      medianTokens: median(list.map((o) => (o.tokens === null ? NaN : o.tokens))),
      confirmedRegressions: null, // not measured by the Hub yet: unknown stays unknown
    };
  }

  /** The league report. `includeTest`: count test projects (labelled) — by default only real projects are compared. */
  function report({ includeTest = false, includeSimulated = false } = {}) {
    const all = observations({ includeSimulated });
    const exclusions = {};
    for (const o of all) {
      const reason = o.excluded || (!includeTest && o.test ? "proiect de test" : null);
      if (reason) exclusions[reason] = (exclusions[reason] || 0) + 1;
    }
    const eligible = all.filter((o) => !o.excluded && (includeTest || !o.test));
    const groups = new Map();
    for (const o of eligible) {
      const key = [o.role, o.provider, o.model, o.environment, o.workType].join("|");
      groups.set(key, [...(groups.get(key) || []), o]);
    }
    const rows = [...groups.entries()].map(([key, list]) => {
      const [role, provider, model, environment, workType] = key.split("|");
      const s = summarize(list);
      return { key, role, provider, model, environment, workType, observations: list.length, testProjects: list.filter((o) => o.test).length, metrics: s,
        evidence: list.length >= MIN_EVIDENCE ? "SUFFICIENT" : "INSUFFICIENT_EVIDENCE", distribution: list.map((o) => ({ runId: o.runId, status: o.status, minutes: o.durationMs === null ? null : Math.round(o.durationMs / 6000) / 10 })) };
    }).sort((a, b) => a.role.localeCompare(b.role) || b.observations - a.observations);
    // Comparisons only within comparable cohorts (role + work type + environment), only with enough evidence on both sides.
    const cohorts = new Map();
    for (const r of rows) { const c = [r.role, r.workType, r.environment].join("|"); cohorts.set(c, [...(cohorts.get(c) || []), r]); }
    const proposals = [];
    for (const [cohort, list] of cohorts) {
      const ready = list.filter((r) => r.evidence === "SUFFICIENT" && r.metrics.firstPassVerifiedPct !== null);
      if (ready.length < 2) continue;
      ready.sort((a, b) => b.metrics.firstPassVerifiedPct - a.metrics.firstPassVerifiedPct);
      const [best, next] = ready;
      if (best.metrics.firstPassVerifiedPct - next.metrics.firstPassVerifiedPct >= 20) {
        proposals.push({ cohort, proposal: `De testat: ${best.provider}/${best.model} pare mai bun decât ${next.provider}/${next.model} la prima trecere (${best.metrics.firstPassVerifiedPct}% vs ${next.metrics.firstPassVerifiedPct}%, ${best.observations}/${next.observations} observații)`, applied: false });
      }
    }
    // M09: an outcome is attributed only to skills the run ACTUALLY received. The composer's usage rows (run_skill_usage, applied = 1)
    // are the only evidence. A run without usage rows (before M09) is not attributed at all: its skill_versions_json listed the
    // role's skills, but before M09 they were not injected into the prompt, so crediting them would be a false measurement.
    // A skill listed for the role but not injected (inactive, unapproved, over budget) never collects a run's success or failure.
    const usage = new Map();
    for (const u of db.prepare("SELECT run_id, skill_id, version, applied FROM run_skill_usage").all()) {
      usage.set(u.run_id, [...(usage.get(u.run_id) || []), { id: u.skill_id, version: u.version, applied: u.applied === 1 }]);
    }
    const unattributed = eligible.filter((o) => !usage.has(o.runId) && o.skillVersions.length).length;
    const bySkill = new Map();
    for (const o of eligible) for (const sv of (usage.get(o.runId) || []).filter((u) => u.applied)) {
      const k = `${sv.id}@v${sv.version}`;
      const cur = bySkill.get(k) || { skill: sv.id, version: sv.version, runs: 0, completed: 0, failedNonInfra: 0, evidenceSource: "usage" };
      cur.runs += 1;
      if (o.status === "completed") cur.completed += 1; else cur.failedNonInfra += 1;
      bySkill.set(k, cur);
    }
    return { generatedAt: new Date().toISOString(), minEvidence: MIN_EVIDENCE, includeTest, includeSimulated, simulatedData: all.some((o) => o.simulated), totals: { observations: all.length, eligible: eligible.length }, exclusions, groups: rows, proposals,
      skills: [...bySkill.values()].map((s) => ({ ...s, evidence: s.runs >= MIN_EVIDENCE ? "SUFFICIENT" : "INSUFFICIENT_EVIDENCE" })),
      skillAttribution: { source: "run_skill_usage", runsWithoutUsageEvidence: unattributed },
      verdict: rows.some((r) => r.evidence === "SUFFICIENT") ? null : "INSUFFICIENT_EVIDENCE",
      note: "Fără scoruri de inteligență și fără câștigător pe date insuficiente. Rularea ca simulare, anulările, erorile de infrastructură și (implicit) proiectele de test sunt excluse și numărate separat; regresiile confirmate nu sunt încă măsurate." };
  }

  return { report, observations };
}
