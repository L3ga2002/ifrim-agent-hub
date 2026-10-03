import { HubError } from "../core/errors.mjs";
import { newId } from "../core/ids.mjs";
import { sha256 } from "../core/canonical.mjs";
import { json, parse } from "../storage/db.mjs";
import { containsSecretLikeContent, redactText } from "../security/redact.mjs";
import { RISKY_PATTERNS } from "../domain/skills.mjs";

/**
 * Skill Evolution (M08 §14) on the existing catalog and its immutable versions: a verified repeated problem → a proposed change →
 * diff → evaluation → the owner's approval → limited activation → monitoring → rollback.
 *
 * - A candidate carries its reason, the evidence behind it, the cases that could regress and its compatibility (frontmatter —
 *   tools, permission, roles — is never widened by a candidate; a candidate cannot grant itself access, tools or budget).
 * - Evaluation here is deterministic: static checks plus regression cases (each case must hold on the candidate; a case that held
 *   on the base and fails on the candidate is a regression). A model-based evaluation would consume allowance: NOT_RUN unless
 *   budgeted, and never a permanent shadow in the background.
 * - Approval creates a new immutable skill version; activation is an overlay (limited to listed projects, or all) that the run
 *   launcher reads — an active run stays bound to the exact versions recorded when it started. The files in v2/skills stay the
 *   git source of truth; promoting a candidate to them is a separate, reviewed commit. A reformulation is not "learning".
 */
export const CANDIDATE_STATUSES = Object.freeze(["PROPOSED", "EVALUATED", "APPROVED", "ACTIVE_LIMITED", "ACTIVE", "ROLLED_BACK", "REJECTED"]);

/** A small line diff (LCS) between two texts: [{ op: "=", "+", "-", line }]. */
export function lineDiff(a, b) {
  const x = String(a || "").split(/\r?\n/); const y = String(b || "").split(/\r?\n/);
  const n = x.length; const m = y.length;
  if (n * m > 400000) return [{ op: "-", line: `(${n} rânduri)` }, { op: "+", line: `(${m} rânduri)` }];
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) for (let j = m - 1; j >= 0; j -= 1) dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  let i = 0; let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) { out.push({ op: "=", line: x[i] }); i += 1; j += 1; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ op: "-", line: x[i] }); i += 1; }
    else { out.push({ op: "+", line: y[j] }); j += 1; }
  }
  while (i < n) out.push({ op: "-", line: x[i++] });
  while (j < m) out.push({ op: "+", line: y[j++] });
  return out;
}

const caseHolds = (body, c) => {
  const t = String(body || "").toLowerCase();
  return (c.mustInclude || []).every((s) => t.includes(String(s).toLowerCase())) && !(c.mustNotInclude || []).some((s) => t.includes(String(s).toLowerCase()));
};

export function createSkillEvolution({ db, bus, clock }) {
  const iso = (d = clock()) => d.toISOString();
  const rowTo = (r) => r && ({ id: r.id, skillId: r.skill_id, baseVersion: r.base_version, candidateVersion: r.candidate_version, reason: r.reason, evidence: parse(r.evidence_json, []), body: r.body,
    diff: parse(r.diff_json, []), regressionCases: parse(r.regression_cases_json, []), evaluation: parse(r.eval_json, null), status: r.status, activation: parse(r.activation_json, {}),
    createdBy: r.created_by, decidedBy: r.decided_by, version: r.version, createdAt: r.created_at, updatedAt: r.updated_at });
  const need = (id) => { const r = rowTo(db.prepare("SELECT * FROM skill_candidates WHERE id = ?").get(id)); if (!r) throw new HubError("not_found", "Candidat necunoscut"); return r; };
  const versionRow = (skillId, version) => db.prepare("SELECT * FROM skill_versions WHERE skill_id = ? AND version = ?").get(skillId, version);
  const setStatus = (id, status, extra = {}, actor = "hub") => {
    const cols = Object.entries(extra);
    db.prepare(`UPDATE skill_candidates SET status = ?, version = version + 1, updated_at = ?${cols.map(([c]) => `, ${c} = ?`).join("")} WHERE id = ?`).run(status, iso(), ...cols.map(([, v]) => v), id);
    bus.append({ type: "skill.candidate_status", scopeType: "skill", scopeId: id, source: actor, payload: { status } });
  };

  /** A proposal: the new body of an existing skill, why, the evidence and the cases that must keep holding. */
  function propose({ skillId, body, reason, evidence = [], regressionCases = [], actor }) {
    const skill = db.prepare("SELECT * FROM skills WHERE id = ?").get(skillId);
    if (!skill) throw new HubError("not_found", "Skill necunoscut");
    const base = versionRow(skillId, skill.current_version);
    const text = String(body || "");
    if (text.trim().length < 20) throw new HubError("validation", "Corpul propus e prea scurt");
    if (!String(reason || "").trim()) throw new HubError("validation", "Spune ce problemă repetată rezolvă");
    if (!(Array.isArray(evidence) && evidence.length)) throw new HubError("validation", "O propunere cere cel puțin o dovadă (run, finding, review) a problemei repetate");
    if (text.trim() === String(base?.body || "").trim()) throw new HubError("validation", "Corpul propus e identic cu versiunea curentă");
    const id = newId("skc");
    const t = iso();
    const cases = (Array.isArray(regressionCases) ? regressionCases : []).slice(0, 30).map((c, i) => ({ name: String(c?.name || `caz-${i + 1}`).slice(0, 80), mustInclude: (c?.mustInclude || []).map(String).slice(0, 10), mustNotInclude: (c?.mustNotInclude || []).map(String).slice(0, 10) }));
    bus.transaction(() => {
      db.prepare(`INSERT INTO skill_candidates (id, skill_id, base_version, reason, evidence_json, body, diff_json, regression_cases_json, status, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PROPOSED', ?, ?, ?)`).run(id, skillId, skill.current_version, redactText(String(reason)).slice(0, 1000), json(evidence.map((e) => String(e).slice(0, 300)).slice(0, 20)),
          text.slice(0, 200000), json(lineDiff(base?.body || "", text).filter((d) => d.op !== "=").slice(0, 400)), json(cases), String(actor).slice(0, 80), t, t);
      bus.append({ type: "skill.candidate_proposed", scopeType: "skill", scopeId: id, source: actor, payload: { skillId, baseVersion: skill.current_version } });
    });
    return need(id);
  }

  /** Deterministic evaluation: static safety/compatibility checks + regression cases on base vs candidate. */
  function evaluate(id, { actor }) {
    const c = need(id);
    if (!["PROPOSED", "EVALUATED"].includes(c.status)) throw new HubError("conflict", `Candidatul e în ${c.status}`);
    const base = versionRow(c.skillId, c.baseVersion);
    const problems = [];
    for (const p of RISKY_PATTERNS) if (p.re.test(c.body)) problems.push(`tipar periculos: ${p.message}`);
    if (containsSecretLikeContent(c.body)) problems.push("conține ceva ce pare un secret");
    if (/^---\r?\n/.test(c.body)) problems.push("corpul nu poate schimba frontmatter-ul (unelte, permisiuni, roluri): compatibilitatea se păstrează");
    const cases = c.regressionCases.map((rc) => {
      const onBase = caseHolds(base?.body || "", rc); const onCandidate = caseHolds(c.body, rc);
      return { name: rc.name, onBase, onCandidate, regression: onBase && !onCandidate };
    });
    const regressions = cases.filter((x) => x.regression).map((x) => x.name);
    const failing = cases.filter((x) => !x.onCandidate).map((x) => x.name);
    const evaluation = { at: iso(), static: { ok: problems.length === 0, problems }, cases, regressions, failing, pass: problems.length === 0 && failing.length === 0,
      compatibility: "frontmatter neschimbat (aceleași unelte, permisiune și roluri ca versiunea de bază)", modelEvaluation: "NOT_RUN (ar consuma din abonament; cere buget separat)" };
    bus.transaction(() => setStatus(id, "EVALUATED", { eval_json: json(evaluation) }, actor));
    return need(id);
  }

  /** The owner's approval: a new immutable skill version (not active yet). Needs a passing evaluation. */
  function approve(id, { actor, ownerSession }) {
    if (!ownerSession) throw new HubError("authentication", "Aprobarea unui skill se face în sesiunea ta de proprietar");
    const c = need(id);
    if (c.status !== "EVALUATED" || !c.evaluation?.pass) throw new HubError("conflict", "Doar un candidat evaluat, fără regresii și fără probleme, poate fi aprobat");
    const base = versionRow(c.skillId, c.baseVersion);
    const version = (db.prepare("SELECT MAX(version) AS v FROM skill_versions WHERE skill_id = ?").get(c.skillId)?.v || 0) + 1;
    bus.transaction(() => {
      db.prepare(`INSERT INTO skill_versions (skill_id, version, sha256, frontmatter_json, body, files_json, validation_json, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(c.skillId, version, sha256(`${base?.frontmatter_json || ""}\n${c.body}`), base?.frontmatter_json || "{}", c.body, base?.files_json || "[]", json({ ok: true, candidate: id, errors: [], warnings: [] }), `candidate:${id}`, iso());
      setStatus(id, "APPROVED", { candidate_version: version, decided_by: String(actor).slice(0, 80) }, actor);
    });
    return need(id);
  }

  /** Activation overlay: limited to projects (ACTIVE_LIMITED) or everywhere (ACTIVE). Never changes the active runs. */
  function activate(id, { projectIds = [], all = false, autoRollback = false, actor, ownerSession }) {
    if (!ownerSession) throw new HubError("authentication", "Activarea unui skill se face în sesiunea ta de proprietar");
    const c = need(id);
    if (!["APPROVED", "ACTIVE_LIMITED"].includes(c.status)) throw new HubError("conflict", "Doar un candidat aprobat poate fi activat");
    const scope = all ? ["*"] : [...new Set((Array.isArray(projectIds) ? projectIds : []).map(String))].slice(0, 20);
    if (!scope.length) throw new HubError("validation", "Activarea limitată cere cel puțin un proiect (sau „toate”)");
    // One active candidate per skill: another active overlay of the same skill is rolled back first (no stacked overlays).
    for (const other of db.prepare("SELECT id FROM skill_candidates WHERE skill_id = ? AND id <> ? AND status IN ('ACTIVE_LIMITED','ACTIVE')").all(c.skillId, id)) bus.transaction(() => setStatus(other.id, "ROLLED_BACK", { activation_json: json({ rolledBackAt: iso(), reason: `înlocuit de ${id}` }) }, actor));
    bus.transaction(() => setStatus(id, all ? "ACTIVE" : "ACTIVE_LIMITED", { activation_json: json({ projectIds: scope, at: iso(), by: actor, autoRollback: Boolean(autoRollback) }) }, actor));
    return need(id);
  }

  function rollback(id, { reason = "", actor }) {
    const c = need(id);
    if (!["ACTIVE_LIMITED", "ACTIVE", "APPROVED"].includes(c.status)) throw new HubError("conflict", `Candidatul e în ${c.status}`);
    bus.transaction(() => setStatus(id, "ROLLED_BACK", { activation_json: json({ ...c.activation, rolledBackAt: iso(), reason: redactText(String(reason || "revenire")).slice(0, 300) }) }, actor));
    return need(id);
  }

  function reject(id, { reason = "", actor }) {
    const c = need(id);
    if (!["PROPOSED", "EVALUATED"].includes(c.status)) throw new HubError("conflict", `Candidatul e în ${c.status}`);
    bus.transaction(() => setStatus(id, "REJECTED", { decided_by: String(actor).slice(0, 80), activation_json: json({ reason: String(reason).slice(0, 300) }) }, actor));
    return need(id);
  }

  /**
   * Monitoring with a pre-approved rule: when the owner enabled autoRollback at activation, a candidate whose runs show at least two
   * non-infrastructure failures and no success is disabled. It never gets more tools, access or budget.
   */
  function monitor(id, { actor = "hub" } = {}) {
    const c = need(id);
    if (!["ACTIVE_LIMITED", "ACTIVE"].includes(c.status) || !c.candidateVersion) return { candidate: c, action: "none" };
    // Only runs that actually received the candidate's content count. Skill bodies are not injected into worker prompts yet, so no
    // run qualifies and nothing is rolled back (or kept) on outcomes the candidate could not have caused (review M08).
    const runs = db.prepare("SELECT status, error_category, skill_versions_json FROM agent_runs WHERE skill_versions_json LIKE ?").all(`%"${c.skillId}"%`)
      .filter((r) => parse(r.skill_versions_json, []).some((v) => v.id === c.skillId && v.candidateActive === c.candidateVersion && v.candidateApplied === true));
    if (!runs.length) return { candidate: c, action: "none", verdict: { runs: 0, measurable: false, reason: "Conținutul skill-urilor nu e încă injectat în instrucțiunile agenților: efectul candidatului nu se poate măsura" } };
    const infra = new Set(["environment", "transport", "quota", "gate", "export", "auth"]);
    const failures = runs.filter((r) => r.status !== "completed" && !infra.has(String(r.error_category || ""))).length;
    const successes = runs.filter((r) => r.status === "completed").length;
    const verdict = { runs: runs.length, failures, successes };
    if (c.activation.autoRollback && failures >= 2 && successes === 0) { rollback(id, { reason: `regulă aprobată: ${failures} eșecuri, 0 reușite`, actor }); return { candidate: need(id), action: "rolled_back", verdict }; }
    return { candidate: c, action: "none", verdict };
  }

  /** The overlay the run launcher applies: { skillId: version } for this project. */
  function overlayFor(projectId) {
    const out = {};
    for (const r of db.prepare("SELECT skill_id, candidate_version, activation_json FROM skill_candidates WHERE status IN ('ACTIVE_LIMITED','ACTIVE') AND candidate_version IS NOT NULL").all()) {
      const scope = parse(r.activation_json, {}).projectIds || [];
      if (scope.includes("*") || (projectId && scope.includes(projectId))) out[r.skill_id] = r.candidate_version;
    }
    return out;
  }

  const list = (skillId = null) => db.prepare(`SELECT * FROM skill_candidates ${skillId ? "WHERE skill_id = ?" : ""} ORDER BY created_at DESC LIMIT 100`).all(...(skillId ? [skillId] : [])).map(rowTo);
  /** The current version body of a skill (the starting text for a candidate; skills live in the repository, nothing secret). */
  function baseBody(skillId) {
    const skill = db.prepare("SELECT * FROM skills WHERE id = ?").get(String(skillId || ""));
    if (!skill) throw new HubError("not_found", "Skill necunoscut");
    const v = versionRow(skill.id, skill.current_version);
    return { skillId: skill.id, version: skill.current_version, body: v?.body || "" };
  }

  return { baseBody, propose, evaluate, approve, activate, rollback, reject, monitor, overlayFor, list, get: need };
}
