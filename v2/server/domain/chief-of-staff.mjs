import { HubError } from "../core/errors.mjs";
import { MISSION_TEMPLATES } from "./missions.mjs";

/**
 * Chief of Staff = ROLE + WORKFLOW + POLICIES, not a model that runs permanently. In BUILD_SAFE the
 * workflow is deterministic (keyword routing + mission templates) and every output is a proposal the
 * owner confirms; after live approval a model may refine the same proposal through the normal gate.
 * Workflow: intake → decompose → route → prioritize → blockers → escalations → aggregate → brief.
 */
const NORMALIZE = (text) => String(text || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");

/**
 * Keywords are matched as WHOLE words/phrases on diacritic-free lowercase text (a word boundary is any
 * non-alphanumeric character), so "ui" never matches inside "magazinului" and "bug" never matches
 * "bugetul". Romanian inflections that matter are listed explicitly.
 */
export const ROUTING_KEYWORDS = Object.freeze([
  { department: "engineering", kind: "incident", words: ["bug", "buguri", "bugul", "bugurile", "eroare", "erori", "eroarea", "crash", "incident", "nu merge", "defect", "defectul", "regresie", "broken", "fix", "repara", "reparat"] },
  { department: "engineering", kind: "site_premium", words: ["site nou", "website nou", "site premium", "landing", "landing page", "redesign site", "pagina de prezentare"] },
  { department: "engineering", kind: "development", words: ["cod", "codul", "feature", "functionalitate", "functionalitatea", "api", "backend", "frontend", "aplicatie", "aplicatia", "app", "refactor", "implementeaza", "implementare", "integrare", "dashboard", "ui", "interfata"] },
  { department: "sales", kind: "site_audit", words: ["audit site", "audit de site", "auditeaza", "analiza site", "website audit"] },
  { department: "sales", kind: "outreach", words: ["oferta", "oferte", "propunere comerciala", "outreach", "follow-up", "email catre client"] },
  { department: "sales", kind: "leads", words: ["lead", "leaduri", "lead-uri", "prospect", "prospecti", "clienti noi", "vanzari", "sales", "firme din"] },
  { department: "operations", kind: "operations_routine", words: ["backup", "backupuri", "monitorizare", "sanatate", "mentenanta", "programare", "rutina", "allowance", "procese"] },
  { department: "operations", kind: "briefing", words: ["briefing", "raport zilnic", "raport saptamanal", "rezumat", "status"] },
  { department: "research", kind: "research", words: ["cercetare", "research", "piata", "competitor", "competitori", "concurenta", "analiza de piata", "studiu"] },
  { department: "executive", kind: "executive_review", words: ["strategie", "prioritati", "obiectiv trimestrial", "decizie", "plan anual", "roadmap companie"] },
  { department: "project-management", kind: "project_management", words: ["plan de proiect", "termene", "termen limita", "dependente", "milestone", "planificare"] },
  { department: "qa-security", kind: "development", words: ["securitate", "vulnerabil", "vulnerabilitate", "vulnerabilitati", "pentest", "qa", "testare"] },
  { department: "devops", kind: "development", words: ["deploy", "server", "servere", "infrastructura", "ci/cd", "pipeline", "hosting"] },
  { department: "marketing", kind: "project_management", words: ["marketing", "campanie", "campania", "campaniei", "social media", "continut", "seo"] },
  { department: "customer-success", kind: "project_management", words: ["suport", "client existent", "feedback client", "reclamatie"] },
  { department: "finance-admin", kind: "project_management", words: ["factura", "facturi", "buget", "bugetul", "bugete", "contabil", "contabilitate", "plata", "cost", "costuri"] },
]);

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const keywordRegex = (word) => new RegExp(`(^|[^a-z0-9])${escapeRe(NORMALIZE(word)).replace(/\s+/g, "\\s+")}(?=$|[^a-z0-9])`);
const COMPILED = ROUTING_KEYWORDS.map((rule) => ({ ...rule, patterns: rule.words.map((w) => ({ word: w, re: keywordRegex(w) })) }));

export function createChiefOfStaff({ db, company, missions, projects, approvals, clock }) {
  /** Deterministic decomposition proposal. Nothing is created here. */
  function analyze({ objective, departmentHint = null, projectId = null }) {
    const text = NORMALIZE(objective);
    if (text.trim().length < 5) throw new HubError("validation", "Descrie obiectivul în cel puțin 5 caractere");
    const hits = [];
    for (const rule of COMPILED) {
      const matched = rule.patterns.filter((p) => p.re.test(text)).map((p) => p.word);
      if (matched.length) hits.push({ department: rule.department, kind: rule.kind, matched });
    }
    const byDept = new Map();
    for (const hit of hits) {
      const current = byDept.get(hit.department);
      if (!current || hit.matched.length > current.matched.length) byDept.set(hit.department, hit);
    }
    if (departmentHint && !byDept.has(departmentHint)) byDept.set(departmentHint, { department: departmentHint, kind: defaultKind(departmentHint), matched: ["alegerea ta"] });
    if (!byDept.size) byDept.set("executive", { department: "executive", kind: "executive_review", matched: [] });
    const hub = projects.hub();
    const project = projectId ? projects.get(projectId) : hub;
    const proposals = [...byDept.values()].map((hit) => {
      const dept = company.department(hit.department);
      const active = dept?.status === "active";
      const fallback = active ? null : nearestActive(hit.department);
      const kind = MISSION_TEMPLATES[hit.kind] ? hit.kind : defaultKind(hit.department);
      return {
        departmentKey: hit.department, departmentName: dept?.name || hit.department, departmentStatus: dept?.status || "unknown",
        missionKind: kind, missionLabel: MISSION_TEMPLATES[kind].label, title: titleFrom(objective, MISSION_TEMPLATES[kind].label),
        projectId: project?.id || null, matchedKeywords: hit.matched, ownerRoleId: dept?.headRoleId || "chief-of-staff",
        taskCount: MISSION_TEMPLATES[kind].tasks.length,
        warning: active ? null : `Departamentul ${dept?.name || hit.department} este „${dept?.status || "necunoscut"}”: misiunea rămâne DRAFT; alternativa activă cea mai apropiată: ${fallback}`,
      };
    });
    return {
      method: "deterministic-keywords-v1",
      note: "Propunere fără model: cuvinte-cheie → departament → șablon de misiune. Confirmi înainte de a crea ceva; un model o poate rafina doar după aprobarea live.",
      goal: { title: titleFrom(objective, "Obiectiv"), description: String(objective).trim().slice(0, 4000) },
      objectives: proposals.map((p) => ({ title: `${p.departmentName}: ${p.missionLabel}`, keyResult: "Misiune finalizată cu dovezi de verificare", targetValue: 1, unit: "misiune", departmentKey: p.departmentKey })),
      missions: proposals,
    };
  }

  function nearestActive(key) {
    const map = { product: "executive", "qa-security": "engineering", devops: "operations", marketing: "sales", "customer-success": "sales", "project-management": "operations", research: "sales", "finance-admin": "operations" };
    return map[key] || "executive";
  }

  function defaultKind(key) {
    return { engineering: "development", sales: "leads", operations: "operations_routine", executive: "executive_review", research: "research" }[key] || "project_management";
  }

  function titleFrom(objective, prefix) {
    const clean = String(objective).replace(/\s+/g, " ").trim();
    return `${prefix}: ${clean.length > 90 ? `${clean.slice(0, 87)}…` : clean}`.slice(0, 160);
  }

  /** Priorities: open goals and missions ordered by priority, due date and attention. */
  function priorities() {
    return db.prepare(`SELECT g.id, g.title, g.status, g.priority, g.due_at AS dueAt, d.name AS department,
        (SELECT COUNT(*) FROM missions m WHERE m.goal_id = g.id AND m.status NOT IN ('COMPLETED','CANCELLED')) AS openMissions,
        (SELECT COUNT(*) FROM tasks t JOIN missions m ON m.id = t.mission_id WHERE m.goal_id = g.id AND t.status IN ('BLOCKED','FAILED','WAITING_APPROVAL','WAITING_PROVIDER')) AS attention
      FROM goals g LEFT JOIN departments d ON d.id = g.department_id WHERE g.status NOT IN ('ACHIEVED','ABANDONED')
      ORDER BY g.priority, COALESCE(g.due_at, '9999'), attention DESC LIMIT 50`).all();
  }

  /** Blockers grouped by department, from real state only. */
  function blockers() {
    const tasks = db.prepare(`SELECT t.id, t.title, t.status, t.status_reason AS reason, COALESCE(d.name, 'Fără departament') AS department
      FROM tasks t LEFT JOIN departments d ON d.id = t.department_id WHERE t.status IN ('BLOCKED','FAILED','WAITING_APPROVAL','WAITING_PROVIDER')
      ORDER BY t.updated_at DESC LIMIT 100`).all();
    const leases = db.prepare("SELECT id, resource, holder, release_reason AS reason FROM leases WHERE status = 'retained'").all();
    const grouped = {};
    for (const t of tasks) (grouped[t.department] ||= []).push(t);
    return { byDepartment: grouped, retainedLeases: leases, pendingApprovals: approvals.list("pending").length };
  }

  /** Escalations: what needs the owner now. */
  function escalations() {
    return {
      approvals: approvals.list("pending").map((a) => ({ id: a.id, actionKind: a.actionKind, tier: a.permissionTier, expiresAt: a.expiresAt })),
      goalsAtRisk: db.prepare("SELECT id, title, status, status_reason AS reason FROM goals WHERE status IN ('AT_RISK','BLOCKED')").all(),
      draftPlans: db.prepare("SELECT id, title FROM goals WHERE status = 'DRAFT' AND source = 'chief-of-staff' ORDER BY created_at DESC LIMIT 20").all(),
    };
  }

  /** Aggregated results of a goal across departments (evidence-based completion only). */
  function aggregate(goalId) {
    const goal = company.goal(goalId);
    if (!goal) throw new HubError("not_found", "Goal not found");
    const rows = db.prepare(`SELECT m.id, m.title, m.status, COALESCE(d.name, '—') AS department FROM missions m LEFT JOIN departments d ON d.id = m.department_id WHERE m.goal_id = ?`).all(goalId);
    const missionsOut = rows.map((m) => ({ ...m, progress: missions.progress(m.id),
      verified: db.prepare("SELECT title FROM tasks WHERE mission_id = ? AND status = 'COMPLETED'").all(m.id).map((t) => t.title) }));
    return { goal, objectives: company.objectivesOf(goalId), missions: missionsOut,
      method: "Doar taskurile COMPLETED (cu dovadă de verificare) contează; nu se estimează procente." };
  }

  return { analyze, priorities, blockers, escalations, aggregate, now: () => clock().toISOString() };
}
