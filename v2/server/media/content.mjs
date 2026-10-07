import { HubError } from "../core/errors.mjs";
import { newId, nowIso } from "../core/ids.mjs";
import { hashCanonical, sha256 } from "../core/canonical.mjs";
import { json, parse } from "../storage/db.mjs";

/**
 * M09 Content department — the editorial chain before any media is cut: idea → project → brief → script → storyboard,
 * with claims bound to evidence and a readiness verdict (READY | NO_GO | NEEDS_CAPTURE) computed from real rows.
 *
 * Rules kept here (contract §5.7):
 * - Event ideas come ONLY from a Software Factory mission that is ACCEPTED (event + current DB state); DELIVERY_READY,
 *   REJECTED and every other stage never produce a public idea. One idea per mission (dedupe_key).
 * - Brief, script and storyboard are versioned (sha256 of the canonical body, `author_kind` recorded); saving the same body
 *   again creates no version.
 * - A claim is SUPPORTED only with ≥ 1 evidence reference of a known kind; run/bundle references must exist. Changing the
 *   text of a SUPPORTED claim sends it back to UNCERTAIN (the evidence was for the old text).
 * - The board shows real states only: progress is a checklist of facts read from the database, never a guessed percentage.
 * - CONTENT_ROLES carry an explicit binding request per role; tasks store it; nothing is dispatched from this module.
 */

export const CONTENT_STAGES = Object.freeze(["IDEAS", "RESEARCH", "SCRIPT", "STORYBOARD", "PRODUCTION", "EDITING", "REVIEW", "SCHEDULED", "PUBLISHED", "ANALYTICS", "ARCHIVED"]);
export const BOARD_COLUMNS = Object.freeze(CONTENT_STAGES.filter((s) => s !== "ARCHIVED"));
export const STAGE_LABELS = Object.freeze({
  IDEAS: "Idei", RESEARCH: "Documentare", SCRIPT: "Scenariu", STORYBOARD: "Storyboard", PRODUCTION: "Producție", EDITING: "Montaj",
  REVIEW: "Revizie", SCHEDULED: "Programat", PUBLISHED: "Publicat", ANALYTICS: "Analiză", ARCHIVED: "Arhivat",
});
// Forward one step, back one step (rework), archive from anywhere. PUBLISHED/ANALYTICS never go back: a publication happened.
export const STAGE_TRANSITIONS = Object.freeze({
  IDEAS: ["RESEARCH", "ARCHIVED"],
  RESEARCH: ["SCRIPT", "IDEAS", "ARCHIVED"],
  SCRIPT: ["STORYBOARD", "RESEARCH", "ARCHIVED"],
  STORYBOARD: ["PRODUCTION", "SCRIPT", "ARCHIVED"],
  PRODUCTION: ["EDITING", "STORYBOARD", "ARCHIVED"],
  EDITING: ["REVIEW", "PRODUCTION", "ARCHIVED"],
  REVIEW: ["SCHEDULED", "EDITING", "ARCHIVED"],
  SCHEDULED: ["PUBLISHED", "REVIEW", "ARCHIVED"],
  PUBLISHED: ["ANALYTICS", "ARCHIVED"],
  ANALYTICS: ["ARCHIVED"],
  ARCHIVED: [],
});
export const IDEA_STATUSES = Object.freeze(["NEW", "SHORTLISTED", "DISCARDED", "PROMOTED"]);
// PROMOTED is reached only through promoteIdea and is final.
const IDEA_TRANSITIONS = Object.freeze({ NEW: ["SHORTLISTED", "DISCARDED"], SHORTLISTED: ["NEW", "DISCARDED"], DISCARDED: ["NEW"], PROMOTED: [] });
export const IDEA_SOURCE_KINDS = Object.freeze(["event", "owner", "twin", "manual", "dev_session"]);
export const AUDIENCES = Object.freeze(["technical", "business", "both"]);
export const AUTHOR_KINDS = Object.freeze(["owner", "agent", "dev_session", "template"]);
export const CLAIM_STATUSES = Object.freeze(["SUPPORTED", "UNCERTAIN", "BLOCKED"]);
export const EVIDENCE_KINDS = Object.freeze(["run", "test", "snapshot", "document", "bundle", "commit"]);
const IDEA_EVIDENCE_KINDS = Object.freeze([...EVIDENCE_KINDS, "mission", "event"]);
export const CONTENT_PLATFORMS = Object.freeze(["instagram", "tiktok", "youtube", "x", "linkedin"]);
export const SCRIPT_LANGUAGES = Object.freeze(["ro", "en"]);
export const SHOT_SOURCE_KINDS = Object.freeze(["asset", "capture", "generated", "text_only"]);
export const CAPTURE_KINDS = Object.freeze(["screen_recording", "browser_demo", "obs", "interview", "b_roll"]);
const BINDING_PROVIDERS = Object.freeze(["claude", "codex"]);
const BINDING_EFFORTS = Object.freeze(["minimal", "low", "medium", "high", "xhigh"]);

/**
 * Media roles (ids match config/roles.json and v2/skills/*). The binding is an explicit REQUEST shown to the owner and stored
 * with the task; model-binding resolution and dispatch happen elsewhere, after an approval. Never an account default.
 */
export const CONTENT_ROLES = Object.freeze({
  "creative-director": Object.freeze({ label: "Director de creație", taskTypes: Object.freeze(["content_brief", "content_storyboard"]), binding: Object.freeze({ provider: "claude", model: "sonnet", effort: "medium" }) }),
  scriptwriter: Object.freeze({ label: "Scenarist", taskTypes: Object.freeze(["content_script"]), binding: Object.freeze({ provider: "claude", model: "sonnet", effort: "medium" }) }),
  "video-editor": Object.freeze({ label: "Editor video", taskTypes: Object.freeze(["content_edit_plan"]), binding: Object.freeze({ provider: "claude", model: "sonnet", effort: "medium" }) }),
  "media-qa": Object.freeze({ label: "QA media", taskTypes: Object.freeze(["content_qa"]), binding: Object.freeze({ provider: "claude", model: "sonnet", effort: "medium" }) }),
  "distribution-planner": Object.freeze({ label: "Planificator distribuție", taskTypes: Object.freeze(["content_distribution"]), binding: Object.freeze({ provider: "claude", model: "sonnet", effort: "low" }) }),
  "growth-analyst": Object.freeze({ label: "Analist creștere", taskTypes: Object.freeze(["content_analysis"]), binding: Object.freeze({ provider: "claude", model: "sonnet", effort: "medium" }) }),
});

// ---------- small pure helpers ----------
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
/** Romanian text with comma-below ș/ț (cedilla forms are normalized). */
export const normalizeRo = (text) => String(text ?? "").replace(/ş/g, "ș").replace(/ţ/g, "ț").replace(/Ş/g, "Ș").replace(/Ţ/g, "Ț");
const clean = (value) => String(value ?? "").replace(CONTROL, "").trim();
const clip = (value, max) => { const s = clean(value); return s.length > max ? s.slice(0, max) : s; };
const bad = (message, code = "VALIDATION") => new HubError("validation", message, { code });
const foldKey = (text) => normalizeRo(text).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function requireText(value, { field, min = 1, max = 500 }) {
  const s = clean(value);
  if (s.length < min) throw bad(min > 1 ? `${field}: minimum ${min} caractere` : `${field} lipsește`);
  if (s.length > max) throw bad(`${field}: maximum ${max} caractere`);
  return s;
}
function optionalText(value, { field, max = 500 }) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw bad(`${field} trebuie să fie text`);
  const s = clean(value);
  if (s.length > max) throw bad(`${field}: maximum ${max} caractere`);
  return s;
}
function textList(value, { field, maxItems = 20, maxChars = 300 }) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw bad(`${field} trebuie să fie o listă`);
  if (value.length > maxItems) throw bad(`${field}: maximum ${maxItems} elemente`);
  return value.map((v, i) => requireText(v, { field: `${field}[${i}]`, max: maxChars }));
}
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
function intIn(value, { field, min, max, optional = false }) {
  if ((value === undefined || value === null) && optional) return null;
  if (!Number.isInteger(value) || value < min || value > max) throw bad(`${field}: întreg între ${min} și ${max}`);
  return value;
}
const shortId = (value, field) => {
  const s = clean(value);
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(s)) throw bad(`${field}: identificator invalid (litere, cifre, - și _, maximum 40)`);
  return s;
};

/** Validates an explicit binding request (syntax only; resolution against the provider's model list happens at plan time). */
export function validateBindingRequest(binding, field = "binding") {
  if (!binding || typeof binding !== "object") throw bad(`${field}: lipsește cererea explicită de model (provider, model, effort)`);
  const provider = clean(binding.provider);
  const model = clean(binding.model);
  const effort = clean(binding.effort);
  if (!BINDING_PROVIDERS.includes(provider)) throw bad(`${field}: provider necunoscut „${provider}”`);
  if (!model) throw bad(`${field}: modelul trebuie ales explicit (fără model implicit al contului)`);
  if (/fable/i.test(model) || /\[1m\]/i.test(model)) throw bad(`${field}: modelul „${model}” nu e permis pentru rulările Hub`);
  if (!/^[A-Za-z0-9._:-]{1,80}$/.test(model)) throw bad(`${field}: nume de model invalid`);
  if (!BINDING_EFFORTS.includes(effort)) throw bad(`${field}: effort necunoscut „${effort}”`);
  return { provider, model, effort };
}

/** Evidence references `{ kind, ref }` — kinds are a closed list; refs are short opaque strings (no free text payloads). */
function normalizeEvidence(list, { kinds = EVIDENCE_KINDS, field = "evidence" } = {}) {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) throw bad(`${field} trebuie să fie o listă de dovezi { kind, ref }`);
  if (list.length > 20) throw bad(`${field}: maximum 20 de dovezi`);
  const seen = new Set();
  const out = [];
  for (const [i, item] of list.entries()) {
    const kind = clean(item?.kind);
    const ref = clean(item?.ref);
    if (!kinds.includes(kind)) throw bad(`${field}[${i}]: tip de dovadă necunoscut „${kind}” (permise: ${kinds.join(", ")})`);
    if (!ref || ref.length > 300) throw bad(`${field}[${i}]: referința dovezii lipsește sau e prea lungă`);
    const key = `${kind}:${ref}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const entry = { kind, ref };
    if (item.sha256 && /^[a-f0-9]{64}$/i.test(String(item.sha256))) entry.sha256 = String(item.sha256).toLowerCase();
    if (item.note) entry.note = clip(item.note, 200);
    out.push(entry);
  }
  return out;
}

export function createContent({ db, bus, clock = () => new Date(), settings = null, sales = null }) {
  const now = () => nowIso(clock);
  void settings; void sales; // accepted for wiring symmetry; the Sales link lives in campaigns.mjs (through the sales service)

  // ---------- rows ----------
  const rowToIdea = (r) => r && ({ id: r.id, title: r.title, angle: r.angle, audience: r.audience, sourceKind: r.source_kind, sourceRef: r.source_ref,
    evidence: parse(r.evidence_json, []), reason: r.reason, publicEligible: Boolean(r.public_eligible), status: r.status, dedupeKey: r.dedupe_key,
    createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at });
  const rowToProject = (r) => r && ({ id: r.id, ideaId: r.idea_id, title: r.title, stage: r.stage, stageLabel: STAGE_LABELS[r.stage] || r.stage,
    readiness: r.readiness, readinessDetail: parse(r.readiness_json, {}), format: r.format, platforms: parse(r.platforms_json, []), audience: r.audience,
    presetId: r.preset_id, presetVersion: r.preset_version, campaignId: r.campaign_id, opportunityId: r.opportunity_id, scope: parse(r.scope_json, {}),
    deadline: r.deadline, responsible: r.responsible, createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at, version: r.version });
  const rowToVersioned = (r) => r && ({ id: r.id, contentProjectId: r.content_project_id, version: r.version, ...(r.language ? { language: r.language } : {}),
    body: parse(r.body_json, {}), sha256: r.sha256, authorKind: r.author_kind, author: r.author, createdAt: r.created_at });
  const rowToClaim = (r) => r && ({ id: r.id, contentProjectId: r.content_project_id, text: r.text, status: r.status, evidence: parse(r.evidence_json, []),
    shot: parse(r.shot_json, {}), conditions: r.conditions, createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at });

  const emit = (type, scopeId, payload, source = "content") => bus.append({ type, scopeType: "content", scopeId, source, payload });
  const getIdeaRow = (id) => rowToIdea(db.prepare("SELECT * FROM content_ideas WHERE id = ?").get(id));
  const needIdea = (id) => { const i = getIdeaRow(id); if (!i) throw new HubError("not_found", "Ideea nu există"); return i; };
  const getProjectRow = (id) => rowToProject(db.prepare("SELECT * FROM content_projects WHERE id = ?").get(id));
  const needProject = (id) => { const p = getProjectRow(id); if (!p) throw new HubError("not_found", "Proiectul de conținut nu există"); return p; };
  const needActiveProject = (id) => {
    const p = needProject(id);
    if (p.stage === "ARCHIVED") throw new HubError("conflict", "Proiectul e arhivat: nu se mai modifică");
    return p;
  };
  const latestBrief = (pid) => rowToVersioned(db.prepare("SELECT * FROM content_briefs WHERE content_project_id = ? ORDER BY version DESC LIMIT 1").get(pid));
  const latestStoryboard = (pid) => rowToVersioned(db.prepare("SELECT * FROM content_storyboards WHERE content_project_id = ? ORDER BY version DESC LIMIT 1").get(pid));
  const latestScripts = (pid) => SCRIPT_LANGUAGES.map((lang) => rowToVersioned(db.prepare("SELECT * FROM content_scripts WHERE content_project_id = ? AND language = ? ORDER BY version DESC LIMIT 1").get(pid, lang))).filter(Boolean);
  const claimsOf = (pid) => db.prepare("SELECT * FROM content_claims WHERE content_project_id = ? ORDER BY created_at, id").all(pid).map(rowToClaim);

  // ---------- ideas ----------
  function insertIdea({ title, angle = "", audience = "both", sourceKind, sourceRef = "", evidence = [], reason = "", publicEligible = false, dedupeKey, actor }) {
    const existing = rowToIdea(db.prepare("SELECT * FROM content_ideas WHERE dedupe_key = ?").get(dedupeKey));
    if (existing) return { idea: existing, duplicate: true };
    const id = newId("cid");
    const at = now();
    db.prepare(`INSERT INTO content_ideas (id, title, angle, audience, source_kind, source_ref, evidence_json, reason, public_eligible, status, dedupe_key, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'NEW', ?, ?, ?, ?)`).run(id, title, angle, audience, sourceKind, sourceRef, json(evidence), reason, publicEligible ? 1 : 0, dedupeKey, actor, at, at);
    emit("content.idea.created", id, { sourceKind, sourceRef, publicEligible: Boolean(publicEligible), dedupeKey }, actor);
    return { idea: getIdeaRow(id), duplicate: false };
  }

  /**
   * Owner/manual/twin/dev-session ideas. `event` ideas are refused here: they come only from onEvent (an ACCEPTED mission).
   * The dedupe key defaults to the folded title per source, so the same idea typed twice is one row.
   */
  function createIdea({ title, angle = "", audience = "both", sourceKind = "manual", sourceRef = "", evidence = [], reason = "", publicEligible = false, dedupeKey = null, actor = "owner" } = {}) {
    const t = normalizeRo(requireText(title, { field: "Titlul ideii", min: 3, max: 200 }));
    if (!IDEA_SOURCE_KINDS.includes(sourceKind)) throw bad(`Sursă de idee necunoscută: ${sourceKind}`);
    if (sourceKind === "event") throw new HubError("policy", "Ideile din evenimente se creează doar automat, dintr-o misiune acceptată (ACCEPTED) în Software Factory", { code: "EVENT_IDEA_MANUAL" });
    if (!AUDIENCES.includes(audience)) throw bad(`Public necunoscut: ${audience}`);
    const ev = normalizeEvidence(evidence, { kinds: IDEA_EVIDENCE_KINDS });
    const key = dedupeKey ? clip(dedupeKey, 200) : `${sourceKind}:${sha256(foldKey(t)).slice(0, 24)}`;
    if (!foldKey(t)) throw bad("Titlul ideii trebuie să conțină litere sau cifre");
    return bus.transaction(() => insertIdea({ title: t, angle: normalizeRo(optionalText(angle, { field: "Unghiul", max: 1000 })), audience, sourceKind,
      sourceRef: optionalText(sourceRef, { field: "Sursa", max: 300 }), evidence: ev, reason: normalizeRo(optionalText(reason, { field: "Motivul", max: 1000 })),
      publicEligible: Boolean(publicEligible), dedupeKey: key, actor }));
  }

  function listIdeas({ status = null, sourceKind = null, limit = 100 } = {}) {
    const where = []; const args = [];
    if (status) { if (!IDEA_STATUSES.includes(status)) throw bad(`Stare de idee necunoscută: ${status}`); where.push("status = ?"); args.push(status); }
    if (sourceKind) { if (!IDEA_SOURCE_KINDS.includes(sourceKind)) throw bad(`Sursă de idee necunoscută: ${sourceKind}`); where.push("source_kind = ?"); args.push(sourceKind); }
    const lim = Math.min(Math.max(Number(limit) || 100, 1), 500);
    return db.prepare(`SELECT * FROM content_ideas ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC, id DESC LIMIT ?`).all(...args, lim).map(rowToIdea);
  }

  function setIdeaStatus(ideaId, status, actor = "owner", reason = "") {
    const idea = needIdea(ideaId);
    if (!IDEA_STATUSES.includes(status)) throw bad(`Stare de idee necunoscută: ${status}`);
    if (status === "PROMOTED") throw new HubError("conflict", "O idee devine PROMOTED doar prin promovarea într-un proiect");
    if (idea.status === status) return idea;
    if (!(IDEA_TRANSITIONS[idea.status] || []).includes(status)) throw new HubError("conflict", `Tranziție nepermisă pentru idee: ${idea.status} → ${status}`);
    return bus.transaction(() => {
      db.prepare("UPDATE content_ideas SET status = ?, updated_at = ? WHERE id = ? AND status = ?").run(status, now(), ideaId, idea.status);
      emit("content.idea.status", ideaId, { from: idea.status, to: status, reason: clip(reason, 300) }, actor);
      return getIdeaRow(ideaId);
    });
  }

  /** Idempotent: a promoted idea returns its project. A discarded idea must be restored first. */
  function promoteIdea(ideaId, fields = {}, actor = "owner") {
    const idea = needIdea(ideaId);
    if (idea.status === "PROMOTED") {
      const existing = getProjectRow(db.prepare("SELECT id FROM content_projects WHERE idea_id = ? ORDER BY created_at LIMIT 1").get(ideaId)?.id);
      if (existing) return { project: existing, idea, existing: true };
    }
    if (idea.status === "DISCARDED") throw new HubError("conflict", "Ideea e respinsă (DISCARDED): readu-o la NEW înainte de promovare");
    return bus.transaction(() => {
      const project = insertProject({ ...fields, title: fields.title || idea.title, audience: fields.audience || idea.audience, ideaId }, actor);
      db.prepare("UPDATE content_ideas SET status = 'PROMOTED', updated_at = ? WHERE id = ?").run(now(), ideaId);
      emit("content.idea.status", ideaId, { from: idea.status, to: "PROMOTED", projectId: project.id }, actor);
      return { project, idea: getIdeaRow(ideaId), existing: false };
    });
  }

  /**
   * Bus listener: `factory.stage` with stage ACCEPTED → one idea per mission. The current factory row must also be ACCEPTED
   * (an event alone is not trusted). Every other stage returns null. Never throws (a listener must not break the writer).
   */
  function onEvent(event) {
    try {
      if (!event || event.type !== "factory.stage" || event.scopeType !== "mission") return null;
      if (event.payload?.stage !== "ACCEPTED") return null;
      const missionId = String(event.scopeId || "");
      const fm = db.prepare("SELECT stage FROM factory_missions WHERE mission_id = ?").get(missionId);
      if (!fm || fm.stage !== "ACCEPTED") return null;
      const mission = db.prepare("SELECT m.id, m.title, m.objective, m.project_id, p.name AS project_name, p.client_id FROM missions m LEFT JOIN projects p ON p.id = m.project_id WHERE m.id = ?").get(missionId);
      if (!mission) return null;
      const bundle = db.prepare("SELECT id, sha256, status FROM factory_bundles WHERE mission_id = ? ORDER BY created_at DESC LIMIT 1").get(missionId);
      const evidence = [{ kind: "mission", ref: missionId }];
      if (bundle) evidence.push({ kind: "bundle", ref: bundle.id, sha256: bundle.sha256 });
      if (event.id) evidence.push({ kind: "event", ref: String(event.id) });
      const reason = `Misiune acceptată de proprietar în Software Factory${mission.project_name ? ` (proiect ${clip(mission.project_name, 80)})` : ""}.`
        + (mission.client_id ? " Proiect de client: confirmă acordul clientului înainte de orice material public." : "");
      return bus.transaction(() => insertIdea({
        title: normalizeRo(clip(`Livrare acceptată: ${mission.title}`, 200)), angle: normalizeRo(clip(mission.objective, 1000)), audience: "both",
        sourceKind: "event", sourceRef: `factory:${missionId}`, evidence, reason, publicEligible: true,
        dedupeKey: `event:factory-accepted:${missionId}`, actor: "system:content",
      }));
    } catch {
      return null;
    }
  }
  /** Subscribes onEvent to the bus; returns the unsubscribe function (the coordinator wires it once). */
  const attach = () => bus.subscribe((event) => { onEvent(event); });

  // ---------- projects ----------
  function projectFields(fields, partial = false) {
    const out = {};
    if (!partial || fields.title !== undefined) out.title = normalizeRo(requireText(fields.title, { field: "Titlul proiectului", min: 3, max: 200 }));
    if (!partial || fields.format !== undefined) out.format = optionalText(fields.format ?? "", { field: "Formatul", max: 60 });
    if (!partial || fields.platforms !== undefined) {
      const platforms = fields.platforms ?? [];
      if (!Array.isArray(platforms)) throw bad("Platformele trebuie să fie o listă");
      for (const p of platforms) if (!CONTENT_PLATFORMS.includes(p)) throw bad(`Platformă necunoscută: ${p}`);
      out.platforms = [...new Set(platforms)];
    }
    if (!partial || fields.audience !== undefined) {
      const a = fields.audience ?? "both";
      if (!AUDIENCES.includes(a)) throw bad(`Public necunoscut: ${a}`);
      out.audience = a;
    }
    if (!partial || fields.deadline !== undefined) {
      const d = fields.deadline ?? null;
      if (d !== null && (typeof d !== "string" || Number.isNaN(Date.parse(d)))) throw bad("Termenul trebuie să fie o dată ISO validă");
      out.deadline = d;
    }
    if (!partial || fields.responsible !== undefined) out.responsible = optionalText(fields.responsible ?? "", { field: "Responsabilul", max: 80 });
    if (!partial || fields.presetId !== undefined) out.presetId = fields.presetId ? shortId(fields.presetId, "Presetul") : null;
    if (!partial || fields.presetVersion !== undefined) out.presetVersion = fields.presetVersion == null ? null : intIn(fields.presetVersion, { field: "Versiunea presetului", min: 1, max: 1000 });
    return out;
  }

  function insertProject(fields, actor) {
    const f = projectFields(fields);
    let campaignId = null;
    if (fields.campaignId) {
      if (!db.prepare("SELECT 1 FROM content_campaigns WHERE id = ?").get(fields.campaignId)) throw new HubError("not_found", "Campania nu există");
      campaignId = fields.campaignId;
    }
    const id = newId("cpr");
    const at = now();
    db.prepare(`INSERT INTO content_projects (id, idea_id, title, stage, readiness, format, platforms_json, audience, preset_id, preset_version, campaign_id, scope_json, deadline, responsible, created_by, created_at, updated_at)
      VALUES (?, ?, ?, 'IDEAS', 'UNKNOWN', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, fields.ideaId || null, f.title, f.format, json(f.platforms), f.audience, f.presetId, f.presetVersion, campaignId, json({ tasks: [] }), f.deadline, f.responsible, actor, at, at);
    emit("content.project.created", id, { ideaId: fields.ideaId || null, platforms: f.platforms }, actor);
    return getProjectRow(id);
  }

  /** A project without an idea is allowed (owner brief); with `ideaId` use promoteIdea so the idea's state follows. */
  function createProject(fields = {}, actor = "owner") {
    if (fields.ideaId) return promoteIdea(fields.ideaId, fields, actor).project;
    return bus.transaction(() => insertProject(fields, actor));
  }

  function updateProject(projectId, fields = {}, actor = "owner", { expectedVersion = null } = {}) {
    const p = needActiveProject(projectId);
    if (expectedVersion !== null && expectedVersion !== p.version) throw new HubError("conflict", "Proiectul a fost modificat între timp; reîncarcă și încearcă din nou", { code: "STALE_VERSION" });
    const f = projectFields(fields, true);
    const cols = { title: "title", format: "format", platforms: "platforms_json", audience: "audience", deadline: "deadline", responsible: "responsible", presetId: "preset_id", presetVersion: "preset_version" };
    const entries = Object.entries(f);
    if (!entries.length) return p;
    return bus.transaction(() => {
      const res = db.prepare(`UPDATE content_projects SET ${entries.map(([k]) => `${cols[k]} = ?`).join(", ")}, updated_at = ?, version = version + 1 WHERE id = ? AND version = ?`)
        .run(...entries.map(([k, v]) => (k === "platforms" ? json(v) : v)), now(), projectId, p.version);
      if (!res.changes) throw new HubError("conflict", "Proiectul a fost modificat între timp; reîncarcă și încearcă din nou", { code: "STALE_VERSION" });
      emit("content.project.updated", projectId, { fields: entries.map(([k]) => k) }, actor);
      return getProjectRow(projectId);
    });
  }

  // Facts read from the database (never set by hand) — used by stage guards and the board checklist.
  function facts(projectId) {
    const editVersions = db.prepare("SELECT v.id FROM media_edit_versions v JOIN media_edit_projects e ON e.id = v.edit_project_id WHERE e.content_project_id = ?").all(projectId).map((r) => r.id);
    const ph = editVersions.map(() => "?").join(",");
    const renders = editVersions.length ? db.prepare(`SELECT id, output_asset_version_id, finished_at FROM media_render_jobs WHERE status = 'DONE' AND edit_version_id IN (${ph}) ORDER BY finished_at DESC, created_at DESC, rowid DESC`).all(...editVersions) : [];
    const qa = editVersions.length ? db.prepare(`SELECT kind, status FROM media_qa_reports WHERE edit_version_id IN (${ph}) ORDER BY created_at DESC`).all(...editVersions) : [];
    const manifests = db.prepare("SELECT status FROM content_manifests WHERE content_project_id = ?").all(projectId);
    const attempts = db.prepare("SELECT a.status FROM content_release_attempts a JOIN content_manifests m ON m.id = a.manifest_id WHERE m.content_project_id = ?").all(projectId);
    const claims = db.prepare("SELECT status FROM content_claims WHERE content_project_id = ?").all(projectId);
    return {
      brief: Boolean(db.prepare("SELECT 1 FROM content_briefs WHERE content_project_id = ? LIMIT 1").get(projectId)),
      scripts: db.prepare("SELECT language, MAX(version) AS v FROM content_scripts WHERE content_project_id = ? GROUP BY language").all(projectId).map((r) => ({ language: r.language, version: r.v })),
      storyboard: Boolean(db.prepare("SELECT 1 FROM content_storyboards WHERE content_project_id = ? LIMIT 1").get(projectId)),
      editVersions: editVersions.length,
      renders: renders.length,
      previewAssetVersionId: renders.find((r) => r.output_asset_version_id)?.output_asset_version_id || null,
      qaReports: qa.length, qaFail: qa.some((r) => r.status === "FAIL"),
      manifestsApproved: manifests.filter((m) => m.status === "APPROVED").length,
      releasesPublished: attempts.filter((a) => a.status === "PUBLISHED").length, releasesTotal: attempts.length,
      claims: { total: claims.length, supported: claims.filter((c) => c.status === "SUPPORTED").length, blocked: claims.filter((c) => c.status === "BLOCKED").length },
    };
  }

  /** Stage guards: a stage is reached only when its precondition exists in the data (no fake progress). */
  function stageProblem(p, to, f) {
    switch (to) {
      case "SCRIPT": return f.brief ? null : "Scenariul începe după un brief salvat";
      case "STORYBOARD": return f.scripts.length ? null : "Storyboard-ul începe după un scenariu salvat";
      case "PRODUCTION": {
        if (!f.storyboard) return "Producția începe după un storyboard salvat";
        const r = evaluateReadiness(p.id, "system:stage-guard"); // persisted, so the board shows the verdict that decided
        return r.status === "READY" ? null : `Producția cere pregătire READY (acum ${r.status}: ${r.reasons.map((x) => x.message).concat(r.captureTasks.map((c) => c.title)).slice(0, 3).join("; ")})`;
      }
      case "EDITING": return null;
      case "REVIEW": return f.renders ? null : "Revizia cere cel puțin o randare reușită";
      case "SCHEDULED": return f.manifestsApproved ? null : "Programarea cere un manifest de distribuție aprobat";
      case "PUBLISHED": return f.releasesPublished ? null : "PUBLISHED cere o publicare înregistrată (URL confirmat) pentru cel puțin o platformă";
      case "ANALYTICS": return null;
      default: return null;
    }
  }

  function setStage(projectId, stage, { actor = "owner", reason = "", expectedVersion = null } = {}) {
    const p = needProject(projectId);
    if (!CONTENT_STAGES.includes(stage)) throw bad(`Etapă necunoscută: ${stage}`);
    if (p.stage === stage) return p;
    if (expectedVersion !== null && expectedVersion !== p.version) throw new HubError("conflict", "Proiectul a fost modificat între timp; reîncarcă și încearcă din nou", { code: "STALE_VERSION" });
    if (!(STAGE_TRANSITIONS[p.stage] || []).includes(stage)) throw new HubError("conflict", `Tranziție nepermisă: ${STAGE_LABELS[p.stage]} → ${STAGE_LABELS[stage]}`, { code: "STAGE_TRANSITION" });
    const problem = stageProblem(p, stage, facts(projectId));
    if (problem) throw new HubError("conflict", problem, { code: "STAGE_PRECONDITION" });
    const version = stage === "PRODUCTION" ? needProject(projectId).version : p.version; // the readiness write bumped it
    return bus.transaction(() => {
      const res = db.prepare("UPDATE content_projects SET stage = ?, updated_at = ?, version = version + 1 WHERE id = ? AND version = ?").run(stage, now(), projectId, version);
      if (!res.changes) throw new HubError("conflict", "Proiectul a fost modificat între timp; reîncarcă și încearcă din nou", { code: "STALE_VERSION" });
      emit("content.project.stage", projectId, { from: p.stage, to: stage, reason: clip(reason, 300) }, actor);
      return getProjectRow(projectId);
    });
  }

  // ---------- versioned documents ----------
  function saveVersioned(table, projectId, body, { authorKind, author }, { language = null } = {}) {
    if (!AUTHOR_KINDS.includes(authorKind)) throw bad(`Tip de autor necunoscut: ${authorKind} (permise: ${AUTHOR_KINDS.join(", ")})`);
    const who = requireText(author, { field: "Autorul", max: 120 });
    const sha = hashCanonical(body);
    const latest = language
      ? db.prepare(`SELECT * FROM ${table} WHERE content_project_id = ? AND language = ? ORDER BY version DESC LIMIT 1`).get(projectId, language)
      : db.prepare(`SELECT * FROM ${table} WHERE content_project_id = ? ORDER BY version DESC LIMIT 1`).get(projectId);
    if (latest && latest.sha256 === sha) return { ...rowToVersioned(latest), unchanged: true };
    const version = (latest?.version || 0) + 1;
    const id = newId(table === "content_briefs" ? "cbr" : table === "content_scripts" ? "csc" : "csb");
    const at = now();
    if (language) {
      db.prepare(`INSERT INTO ${table} (id, content_project_id, version, language, body_json, sha256, author_kind, author, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, projectId, version, language, json(body), sha, authorKind, who, at);
    } else {
      db.prepare(`INSERT INTO ${table} (id, content_project_id, version, body_json, sha256, author_kind, author, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, projectId, version, json(body), sha, authorKind, who, at);
    }
    db.prepare("UPDATE content_projects SET updated_at = ?, version = version + 1 WHERE id = ?").run(at, projectId);
    return { ...rowToVersioned(db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id)), unchanged: false };
  }

  const knownClaimIds = (projectId) => new Set(db.prepare("SELECT id FROM content_claims WHERE content_project_id = ?").all(projectId).map((r) => r.id));
  function claimRefs(list, known, field) {
    if (list === undefined || list === null) return [];
    if (!Array.isArray(list)) throw bad(`${field} trebuie să fie o listă de afirmații`);
    const out = [...new Set(list.map((c) => clean(c)))];
    for (const c of out) if (!known.has(c)) throw bad(`${field}: afirmația ${c} nu aparține proiectului`);
    return out;
  }

  /** Brief with two explicit angles (technical / business); at least one is required. */
  function saveBrief(projectId, { body, authorKind, author } = {}) {
    needActiveProject(projectId);
    if (!body || typeof body !== "object") throw bad("Brief-ul lipsește");
    const angles = body.angles || {};
    const technical = normalizeRo(optionalText(angles.technical, { field: "Unghiul tehnic", max: 1500 }));
    const business = normalizeRo(optionalText(angles.business, { field: "Unghiul de business", max: 1500 }));
    if (technical.length < 10 && business.length < 10) throw bad("Brief-ul cere cel puțin un unghi (tehnic sau de business) de minimum 10 caractere");
    const platforms = body.platforms ?? [];
    if (!Array.isArray(platforms) || platforms.some((p) => !CONTENT_PLATFORMS.includes(p))) throw bad("Platformele brief-ului sunt invalide");
    const audience = body.audience ?? "both";
    if (!AUDIENCES.includes(audience)) throw bad(`Public necunoscut: ${audience}`);
    const clean_ = {
      objective: normalizeRo(requireText(body.objective, { field: "Obiectivul", min: 10, max: 1000 })),
      audience,
      angles: { technical, business },
      keyMessage: normalizeRo(optionalText(body.keyMessage, { field: "Mesajul cheie", max: 300 })),
      cta: normalizeRo(optionalText(body.cta, { field: "Îndemnul (CTA)", max: 200 })),
      format: optionalText(body.format, { field: "Formatul", max: 60 }),
      durationTargetS: intIn(body.durationTargetS, { field: "Durata țintă (s)", min: 3, max: 3600, optional: true }),
      platforms: [...new Set(platforms)],
      constraints: textList(body.constraints, { field: "Constrângeri" }).map(normalizeRo),
      mustAvoid: textList(body.mustAvoid, { field: "De evitat" }).map(normalizeRo),
      references: normalizeEvidence(body.references, { kinds: IDEA_EVIDENCE_KINDS, field: "Referințe" }),
    };
    return bus.transaction(() => {
      const saved = saveVersioned("content_briefs", projectId, clean_, { authorKind, author });
      if (!saved.unchanged) emit("content.brief.saved", projectId, { version: saved.version, sha256: saved.sha256, authorKind }, saved.author);
      return saved;
    });
  }

  /** Script per language (ro and en are separate version chains). Segments: vo, onScreen, captions, pauses, pronunciations. */
  function saveScript(projectId, { language = "ro", segments, title = "", notes = "", authorKind, author } = {}) {
    needActiveProject(projectId);
    if (!SCRIPT_LANGUAGES.includes(language)) throw bad(`Limbă de scenariu necunoscută: ${language} (permise: ro, en)`);
    if (!Array.isArray(segments) || !segments.length) throw bad("Scenariul are nevoie de cel puțin un segment");
    if (segments.length > 200) throw bad("Scenariul are maximum 200 de segmente");
    const norm = language === "ro" ? normalizeRo : (s) => s;
    const known = knownClaimIds(projectId);
    const ids = new Set();
    const out = segments.map((seg, i) => {
      const id = shortId(seg?.id ?? `s${i + 1}`, `Segmentul ${i + 1}`);
      if (ids.has(id)) throw bad(`Segment duplicat: ${id}`);
      ids.add(id);
      const vo = norm(optionalText(seg.vo, { field: `Voce (${id})`, max: 2000 }));
      const onScreen = norm(optionalText(seg.onScreen, { field: `Text pe ecran (${id})`, max: 300 }));
      if (!vo && !onScreen) throw bad(`Segmentul ${id} nu are nici voce, nici text pe ecran`);
      const captions = norm(optionalText(seg.captions ?? "", { field: `Subtitrare (${id})`, max: 2000 }));
      const pauses = seg.pauses == null ? [] : (() => {
        if (!Array.isArray(seg.pauses) || seg.pauses.length > 20) throw bad(`Pauzele segmentului ${id} trebuie să fie o listă (maximum 20)`);
        return seg.pauses.map((p, k) => ({ at: norm(optionalText(p?.at ?? "", { field: `Pauza ${k + 1} (${id})`, max: 120 })), ms: intIn(p?.ms, { field: `Pauza ${k + 1} (${id}) ms`, min: 50, max: 10000 }) }));
      })();
      const pronunciations = seg.pronunciations == null ? [] : (() => {
        if (!Array.isArray(seg.pronunciations) || seg.pronunciations.length > 30) throw bad(`Pronunțiile segmentului ${id} trebuie să fie o listă (maximum 30)`);
        return seg.pronunciations.map((p, k) => ({ term: requireText(p?.term, { field: `Termen ${k + 1} (${id})`, max: 60 }), say: norm(requireText(p?.say, { field: `Pronunție ${k + 1} (${id})`, max: 120 })) }));
      })();
      return { id, vo, onScreen, captions, pauses, pronunciations, claimIds: claimRefs(seg.claimIds, known, `Afirmațiile segmentului ${id}`) };
    });
    const body = { language, title: norm(optionalText(title, { field: "Titlul scenariului", max: 200 })), notes: norm(optionalText(notes, { field: "Note", max: 2000 })), segments: out };
    return bus.transaction(() => {
      const saved = saveVersioned("content_scripts", projectId, body, { authorKind, author }, { language });
      if (!saved.unchanged) emit("content.script.saved", projectId, { version: saved.version, language, sha256: saved.sha256, authorKind }, saved.author);
      return saved;
    });
  }

  function normalizeShot(shot, i, known, ids) {
    const id = shortId(shot?.id ?? `sh${i + 1}`, `Cadrul ${i + 1}`);
    if (ids.has(id)) throw bad(`Cadru duplicat: ${id}`);
    ids.add(id);
    const src = shot.source || {};
    const kind = clean(src.kind);
    if (!SHOT_SOURCE_KINDS.includes(kind)) throw bad(`Cadrul ${id}: sursă necunoscută „${kind}” (permise: ${SHOT_SOURCE_KINDS.join(", ")})`);
    const source = { kind, description: normalizeRo(optionalText(src.description, { field: `Descrierea sursei (${id})`, max: 500 })) };
    if (kind === "asset") source.assetVersionId = requireText(src.assetVersionId, { field: `Versiunea materialului (${id})`, max: 80 });
    if (kind === "capture") {
      source.captureKind = src.captureKind || "screen_recording";
      if (!CAPTURE_KINDS.includes(source.captureKind)) throw bad(`Cadrul ${id}: tip de înregistrare necunoscut „${source.captureKind}”`);
      if (source.description.length < 5) throw bad(`Cadrul ${id}: descrie ce trebuie înregistrat (minimum 5 caractere)`);
    }
    let interval = null;
    if (shot.interval != null) {
      const { fromMs, toMs } = shot.interval;
      if (!isNum(fromMs) || !isNum(toMs) || fromMs < 0 || toMs <= fromMs) throw bad(`Cadrul ${id}: intervalul sursei trebuie să aibă 0 ≤ fromMs < toMs`);
      interval = { fromMs: Math.round(fromMs), toMs: Math.round(toMs) };
    }
    let crop = null;
    if (shot.crop != null) {
      const { x, y, w, h } = shot.crop;
      if (![x, y, w, h].every((v) => isNum(v) && v >= 0 && v <= 1) || w <= 0 || h <= 0 || x + w > 1.0001 || y + h > 1.0001) throw bad(`Cadrul ${id}: decupajul trebuie normalizat 0..1 și să rămână în cadru`);
      crop = { x, y, w, h };
    }
    return {
      id,
      purpose: normalizeRo(requireText(shot.purpose, { field: `Scopul cadrului ${id}`, min: 3, max: 300 })),
      source, interval,
      durationMs: intIn(shot.durationMs, { field: `Durata cadrului ${id} (ms)`, min: 200, max: 600000 }),
      framing: optionalText(shot.framing, { field: `Încadrarea (${id})`, max: 120 }),
      crop,
      motion: normalizeRo(optionalText(shot.motion, { field: `Mișcarea (${id})`, max: 200 })),
      overlays: textList(shot.overlays, { field: `Suprapuneri (${id})`, maxItems: 10, maxChars: 200 }).map(normalizeRo),
      audio: normalizeRo(optionalText(shot.audio, { field: `Sunetul (${id})`, max: 200 })),
      acceptance: normalizeRo(requireText(shot.acceptance, { field: `Criteriul de acceptare (${id})`, min: 5, max: 500 })),
      claimIds: claimRefs(shot.claimIds, known, `Afirmațiile cadrului ${id}`),
    };
  }

  function saveStoryboard(projectId, { shots, notes = "", authorKind, author } = {}) {
    needActiveProject(projectId);
    if (!Array.isArray(shots) || !shots.length) throw bad("Storyboard-ul are nevoie de cel puțin un cadru");
    if (shots.length > 300) throw bad("Storyboard-ul are maximum 300 de cadre");
    const known = knownClaimIds(projectId);
    const ids = new Set();
    const body = { shots: shots.map((s, i) => normalizeShot(s, i, known, ids)), notes: normalizeRo(optionalText(notes, { field: "Note", max: 2000 })) };
    return bus.transaction(() => {
      const saved = saveVersioned("content_storyboards", projectId, body, { authorKind, author });
      if (!saved.unchanged) emit("content.storyboard.saved", projectId, { version: saved.version, sha256: saved.sha256, shots: body.shots.length, authorKind }, saved.author);
      return saved;
    });
  }

  // ---------- claims ----------
  /** Evidence that points into the Hub must exist (run, bundle); a commit is a hex id; other kinds are references the owner gave. */
  function verifyEvidence(evidence) {
    for (const e of evidence) {
      if (e.kind === "run" && !db.prepare("SELECT 1 FROM agent_runs WHERE id = ?").get(e.ref)) throw bad(`Dovada run „${e.ref}” nu există în Hub`, "EVIDENCE_NOT_FOUND");
      if (e.kind === "bundle" && !db.prepare("SELECT 1 FROM factory_bundles WHERE id = ?").get(e.ref)) throw bad(`Dovada bundle „${e.ref}” nu există în Hub`, "EVIDENCE_NOT_FOUND");
      if (e.kind === "commit" && !/^[0-9a-f]{7,40}$/i.test(e.ref)) throw bad(`Dovada commit „${e.ref}” nu e un identificator de commit valid`);
    }
    return evidence;
  }
  /**
   * M11: a SUPPORTED claim cannot rest on a package that no longer proves anything (STALE: newer code; REJECTED by the owner) — an old
   * clip would otherwise present new code as verified. UNCERTAIN / BLOCKED claims may still cite it.
   */
  function assertEvidenceCurrent(evidence, status) {
    if (status !== "SUPPORTED") return;
    for (const e of evidence || []) {
      if (e.kind !== "bundle") continue;
      const b = db.prepare("SELECT status FROM factory_bundles WHERE id = ?").get(e.ref);
      if (b && ["STALE", "REJECTED"].includes(b.status)) throw bad(`Dovada bundle „${e.ref}” nu mai e valabilă (${b.status}); afirmația nu poate fi SUPPORTED`, "CLAIM_EVIDENCE_STALE");
    }
  }

  /** Creates (no `id`) or edits a claim. A text change on a SUPPORTED claim resets it to UNCERTAIN. */
  function saveClaim(projectId, { id = null, text, evidence, shot, conditions, status = null } = {}, actor = "owner") {
    needActiveProject(projectId);
    const t = normalizeRo(requireText(text, { field: "Afirmația", min: 5, max: 500 }));
    const ev = evidence === undefined ? undefined : verifyEvidence(normalizeEvidence(evidence));
    const shotRef = shot === undefined ? undefined : (shot && typeof shot === "object" ? { shotId: shot.shotId ? shortId(shot.shotId, "Cadrul afirmației") : null, note: normalizeRo(optionalText(shot.note, { field: "Nota cadrului", max: 300 })) } : {});
    const cond = conditions === undefined ? undefined : normalizeRo(optionalText(conditions, { field: "Condițiile", max: 500 }));
    if (status !== null && !CLAIM_STATUSES.includes(status)) throw bad(`Stare de afirmație necunoscută: ${status}`);
    return bus.transaction(() => {
      const at = now();
      if (!id) {
        const st = status || "UNCERTAIN";
        const evid = ev || [];
        if (st === "SUPPORTED" && !evid.length) throw bad("O afirmație SUPPORTED are nevoie de cel puțin o dovadă (run, test, snapshot, document, bundle, commit)", "CLAIM_NEEDS_EVIDENCE");
        assertEvidenceCurrent(evid, st);
        const cid = newId("ccl");
        db.prepare(`INSERT INTO content_claims (id, content_project_id, text, status, evidence_json, shot_json, conditions, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(cid, projectId, t, st, json(evid), json(shotRef || {}), cond || "", actor, at, at);
        emit("content.claim.saved", projectId, { claimId: cid, status: st, evidence: evid.length, created: true }, actor);
        return rowToClaim(db.prepare("SELECT * FROM content_claims WHERE id = ?").get(cid));
      }
      const cur = rowToClaim(db.prepare("SELECT * FROM content_claims WHERE id = ? AND content_project_id = ?").get(id, projectId));
      if (!cur) throw new HubError("not_found", "Afirmația nu există în acest proiect");
      const evid = ev ?? cur.evidence;
      const textChanged = t !== cur.text;
      let st = status || cur.status;
      if (textChanged && cur.status === "SUPPORTED" && status !== "BLOCKED") st = status === "SUPPORTED" && ev?.length ? "SUPPORTED" : "UNCERTAIN";
      if (st === "SUPPORTED" && !evid.length) throw bad("O afirmație SUPPORTED are nevoie de cel puțin o dovadă", "CLAIM_NEEDS_EVIDENCE");
      assertEvidenceCurrent(evid, st);
      db.prepare("UPDATE content_claims SET text = ?, status = ?, evidence_json = ?, shot_json = ?, conditions = ?, updated_at = ? WHERE id = ?")
        .run(t, st, json(evid), json(shotRef ?? cur.shot), cond ?? cur.conditions, at, id);
      emit("content.claim.saved", projectId, { claimId: id, status: st, from: cur.status, textChanged, evidence: evid.length }, actor);
      return rowToClaim(db.prepare("SELECT * FROM content_claims WHERE id = ?").get(id));
    });
  }

  function setClaimStatus(claimId, status, { evidence = undefined, actor = "owner", reason = "" } = {}) {
    const cur = rowToClaim(db.prepare("SELECT * FROM content_claims WHERE id = ?").get(claimId));
    if (!cur) throw new HubError("not_found", "Afirmația nu există");
    needActiveProject(cur.contentProjectId);
    if (!CLAIM_STATUSES.includes(status)) throw bad(`Stare de afirmație necunoscută: ${status}`);
    const evid = evidence === undefined ? cur.evidence : verifyEvidence(normalizeEvidence(evidence));
    if (status === "SUPPORTED" && !evid.length) throw bad("O afirmație SUPPORTED are nevoie de cel puțin o dovadă (run, test, snapshot, document, bundle, commit)", "CLAIM_NEEDS_EVIDENCE");
    if (status === "BLOCKED" && clean(reason).length < 3) throw bad("Spune pe scurt de ce blochezi afirmația (minimum 3 caractere)");
    assertEvidenceCurrent(evid, status);
    return bus.transaction(() => {
      db.prepare("UPDATE content_claims SET status = ?, evidence_json = ?, conditions = CASE WHEN ? <> '' THEN ? ELSE conditions END, updated_at = ? WHERE id = ?")
        .run(status, json(evid), status === "BLOCKED" ? clip(reason, 500) : "", clip(reason, 500), now(), claimId);
      emit("content.claim.status", cur.contentProjectId, { claimId, from: cur.status, to: status, evidence: evid.length, reason: clip(reason, 300) }, actor);
      return rowToClaim(db.prepare("SELECT * FROM content_claims WHERE id = ?").get(claimId));
    });
  }

  // ---------- readiness ----------
  function computeReadiness(projectId) {
    const p = needProject(projectId);
    const reasons = [];
    const warnings = [];
    const captureTasks = [];
    const brief = latestBrief(projectId);
    const scripts = latestScripts(projectId);
    const storyboard = latestStoryboard(projectId);
    if (!brief) reasons.push({ code: "NO_BRIEF", message: "Lipsește brief-ul" });
    if (!scripts.length) reasons.push({ code: "NO_SCRIPT", message: "Lipsește scenariul" });
    if (!storyboard) reasons.push({ code: "NO_STORYBOARD", message: "Lipsește storyboard-ul" });
    if (p.ideaId) {
      const idea = getIdeaRow(p.ideaId);
      if (idea && !idea.publicEligible) reasons.push({ code: "NOT_PUBLIC_ELIGIBLE", message: "Ideea nu e marcată eligibilă pentru public: confirmă confidențialitatea înainte de producție" });
    }
    const claims = new Map(claimsOf(projectId).map((c) => [c.id, c]));
    const referenced = new Map();
    for (const s of scripts) for (const seg of s.body.segments || []) for (const c of seg.claimIds || []) referenced.set(c, `segmentul ${seg.id} (${s.language})`);
    for (const shot of storyboard?.body.shots || []) for (const c of shot.claimIds || []) referenced.set(c, `cadrul ${shot.id}`);
    for (const [cid, where] of referenced) {
      const c = claims.get(cid);
      if (!c) reasons.push({ code: "CLAIM_UNKNOWN", message: `Afirmația ${cid} folosită în ${where} nu mai există`, claimId: cid });
      else if (c.status === "BLOCKED") reasons.push({ code: "CLAIM_BLOCKED", message: `Afirmația „${clip(c.text, 80)}” e blocată și apare în ${where}`, claimId: cid });
      else if (c.status === "UNCERTAIN") reasons.push({ code: "CLAIM_UNCERTAIN", message: `Afirmația „${clip(c.text, 80)}” din ${where} nu are dovezi: marcheaz-o SUPPORTED cu dovezi sau scoate-o`, claimId: cid });
    }
    for (const shot of storyboard?.body.shots || []) {
      const src = shot.source || {};
      const task = (kind, why) => captureTasks.push({
        id: `cap_${shot.id}`, shotId: shot.id, kind, status: "OPEN", why,
        title: `Înregistrează cadrul ${shot.id}: ${clip(shot.purpose, 120)}`,
        details: { what: src.description || shot.purpose, durationMs: shot.durationMs, framing: shot.framing || "", interval: shot.interval, acceptance: shot.acceptance, claimIds: shot.claimIds || [] },
      });
      if (src.kind === "capture") task(src.captureKind || "screen_recording", "Cadrul e planificat pentru înregistrare și nu există încă material");
      else if (src.kind === "asset") {
        const v = db.prepare("SELECT v.status, a.capture_label, a.origin FROM media_asset_versions v JOIN media_assets a ON a.id = v.asset_id WHERE v.id = ?").get(src.assetVersionId);
        if (!v) task("screen_recording", `Materialul ${src.assetVersionId} nu există în bibliotecă`);
        else if (v.status !== "READY") task("screen_recording", `Materialul ${src.assetVersionId} are starea ${v.status}`);
        else {
          if ((shot.claimIds || []).length && ["SIMULATION", "RECONSTRUCTION", "GENERATED", "REPLAY"].includes(v.capture_label)) {
            warnings.push({ code: "LABEL_REQUIRED", message: `Cadrul ${shot.id} susține o afirmație cu material ${v.capture_label}: eticheta trebuie să fie vizibilă pe ecran`, shotId: shot.id });
          }
          if (v.origin === "UNKNOWN") warnings.push({ code: "ORIGIN_UNKNOWN", message: `Materialul cadrului ${shot.id} are origine necunoscută: nu poate intra în exportul final`, shotId: shot.id });
        }
      } else if (src.kind === "generated") warnings.push({ code: "AI_DISCLOSURE", message: `Cadrul ${shot.id} e generat: necesită etichetă și declarare AI la publicare`, shotId: shot.id });
    }
    const status = reasons.length ? "NO_GO" : captureTasks.length ? "NEEDS_CAPTURE" : "READY";
    return { status, reasons, warnings, captureTasks,
      inputs: { briefVersion: brief?.version || null, scripts: scripts.map((s) => ({ language: s.language, version: s.version })), storyboardVersion: storyboard?.version || null } };
  }

  /** Computes and persists READY | NO_GO | NEEDS_CAPTURE with reasons and concrete capture tasks. */
  function evaluateReadiness(projectId, actor = "system") {
    needActiveProject(projectId);
    const result = { ...computeReadiness(projectId), evaluatedAt: now() };
    return bus.transaction(() => {
      db.prepare("UPDATE content_projects SET readiness = ?, readiness_json = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(result.status, json(result), result.evaluatedAt, projectId);
      emit("content.readiness.evaluated", projectId, { status: result.status, reasons: result.reasons.map((r) => r.code), captureTasks: result.captureTasks.length }, actor);
      return result;
    });
  }

  // ---------- tasks (planned work with an explicit binding request; never dispatched here) ----------
  function addTask(projectId, { role, taskType = null, title, binding = null } = {}, actor = "owner") {
    const p = needActiveProject(projectId);
    const def = CONTENT_ROLES[role];
    if (!def) throw bad(`Rol media necunoscut: ${role} (permise: ${Object.keys(CONTENT_ROLES).join(", ")})`);
    const type = taskType || def.taskTypes[0];
    if (!def.taskTypes.includes(type)) throw bad(`Rolul ${role} nu face sarcini de tip ${type}`);
    const b = validateBindingRequest(binding || def.binding, "Modelul sarcinii");
    const task = { id: newId("ctk"), role, taskType: type, title: normalizeRo(requireText(title, { field: "Titlul sarcinii", min: 3, max: 200 })), binding: b,
      bindingSource: binding ? "explicit" : "role_default_request", status: "PLANNED", dispatched: false, createdBy: actor, createdAt: now() };
    return bus.transaction(() => {
      const scope = { ...p.scope, tasks: [...(p.scope.tasks || []), task] };
      const res = db.prepare("UPDATE content_projects SET scope_json = ?, updated_at = ?, version = version + 1 WHERE id = ? AND version = ?").run(json(scope), now(), projectId, p.version);
      if (!res.changes) throw new HubError("conflict", "Proiectul a fost modificat între timp; reîncearcă", { code: "STALE_VERSION" });
      emit("content.task.planned", projectId, { taskId: task.id, role, taskType: type, binding: b }, actor);
      return task;
    });
  }

  // ---------- board / detail ----------
  function checklist(f, readiness) {
    const steps = [
      { key: "brief", label: "Brief", done: f.brief },
      { key: "script", label: "Scenariu", done: f.scripts.length > 0 },
      { key: "storyboard", label: "Storyboard", done: f.storyboard },
      { key: "readiness", label: "Pregătire READY", done: readiness === "READY" },
      { key: "edit", label: "Versiune de montaj", done: f.editVersions > 0 },
      { key: "render", label: "Randare reușită", done: f.renders > 0 },
      { key: "qa", label: "QA fără FAIL", done: f.qaReports > 0 && !f.qaFail },
      { key: "manifest", label: "Manifest aprobat", done: f.manifestsApproved > 0 },
      { key: "release", label: "Publicare înregistrată", done: f.releasesPublished > 0 },
    ];
    return { done: steps.filter((s) => s.done).length, total: steps.length, steps };
  }

  function card(p) {
    const f = facts(p.id);
    const tasks = p.scope.tasks || [];
    const models = [...new Set(tasks.map((t) => `${t.binding.provider} · ${t.binding.model} · ${t.binding.effort}`))];
    const finished = ["PUBLISHED", "ANALYTICS", "ARCHIVED"].includes(p.stage);
    return {
      id: p.id, title: p.title, format: p.format, platforms: p.platforms, responsible: p.responsible || null, stage: p.stage, stageLabel: p.stageLabel,
      deadline: p.deadline, overdue: Boolean(p.deadline && !finished && Date.parse(p.deadline) < clock().getTime()),
      readiness: p.readiness, models: models.length ? models : null, previewAssetVersionId: f.previewAssetVersionId,
      claims: f.claims, releases: { published: f.releasesPublished, total: f.releasesTotal },
      progress: checklist(f, p.readiness), updatedAt: p.updatedAt,
    };
  }

  /** Kanban over real states only. ARCHIVED projects are counted, not shown. */
  function board({ campaignId = null } = {}) {
    const rows = campaignId
      ? db.prepare("SELECT * FROM content_projects WHERE campaign_id = ? ORDER BY updated_at DESC LIMIT 500").all(campaignId)
      : db.prepare("SELECT * FROM content_projects ORDER BY updated_at DESC LIMIT 500").all();
    const projects = rows.map(rowToProject);
    return {
      columns: BOARD_COLUMNS.map((stage) => ({ stage, label: STAGE_LABELS[stage], cards: projects.filter((p) => p.stage === stage).map(card) })),
      archived: projects.filter((p) => p.stage === "ARCHIVED").length,
      note: "Progresul e o listă de fapte verificate în date (brief, scenariu, randare, QA, publicare), nu un procent estimat.",
    };
  }

  function detail(projectId) {
    const p = needProject(projectId);
    const scripts = latestScripts(projectId);
    return {
      project: p, idea: p.ideaId ? getIdeaRow(p.ideaId) : null, card: card(p),
      brief: latestBrief(projectId), scripts, storyboard: latestStoryboard(projectId), claims: claimsOf(projectId),
      versions: {
        briefs: db.prepare("SELECT version, sha256, author_kind, author, created_at FROM content_briefs WHERE content_project_id = ? ORDER BY version DESC").all(projectId),
        scripts: db.prepare("SELECT language, version, sha256, author_kind, author, created_at FROM content_scripts WHERE content_project_id = ? ORDER BY language, version DESC").all(projectId),
        storyboards: db.prepare("SELECT version, sha256, author_kind, author, created_at FROM content_storyboards WHERE content_project_id = ? ORDER BY version DESC").all(projectId),
      },
      tasks: p.scope.tasks || [],
      editProjects: db.prepare("SELECT id, title, current_version, updated_at FROM media_edit_projects WHERE content_project_id = ? ORDER BY created_at").all(projectId),
      manifests: db.prepare("SELECT id, status, manifest_sha256, approved_at, created_at FROM content_manifests WHERE content_project_id = ? ORDER BY created_at DESC").all(projectId),
    };
  }

  const getVersion = (kind, projectId, version, language = "ro") => {
    const table = { brief: "content_briefs", script: "content_scripts", storyboard: "content_storyboards" }[kind];
    if (!table) throw bad(`Tip de document necunoscut: ${kind}`);
    const row = kind === "script"
      ? db.prepare("SELECT * FROM content_scripts WHERE content_project_id = ? AND language = ? AND version = ?").get(projectId, language, version)
      : db.prepare(`SELECT * FROM ${table} WHERE content_project_id = ? AND version = ?`).get(projectId, version);
    if (!row) throw new HubError("not_found", "Versiunea nu există");
    return rowToVersioned(row);
  };

  return {
    createIdea, listIdeas, setIdeaStatus, promoteIdea, getIdea: needIdea, onEvent, attach,
    createProject, updateProject, setStage, getProject: needProject, evaluateReadiness, computeReadiness,
    saveBrief, saveScript, saveStoryboard, getVersion, latestBrief, latestScripts, latestStoryboard,
    saveClaim, setClaimStatus, listClaims: (projectId) => { needProject(projectId); return claimsOf(projectId); },
    addTask, board, detail, facts,
    listProjects: ({ stage = null, limit = 200 } = {}) => {
      if (stage && !CONTENT_STAGES.includes(stage)) throw bad(`Etapă necunoscută: ${stage}`);
      const lim = Math.min(Math.max(Number(limit) || 200, 1), 500);
      return (stage ? db.prepare("SELECT * FROM content_projects WHERE stage = ? ORDER BY updated_at DESC LIMIT ?").all(stage, lim) : db.prepare("SELECT * FROM content_projects ORDER BY updated_at DESC LIMIT ?").all(lim)).map(rowToProject);
    },
    CONTENT_ROLES,
  };
}
