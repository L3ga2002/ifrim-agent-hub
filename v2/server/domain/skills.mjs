import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { HubError } from "../core/errors.mjs";
import { json, parse } from "../storage/db.mjs";
import { containsSecretLikeContent } from "../security/redact.mjs";
import { PERMISSION_TIERS } from "../policy/approvals.mjs";

const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_FILES = 200;
const MAX_FILE_BYTES = 512 * 1024;
export const RISKY_PATTERNS = [
  { re: /--dangerously-skip-permissions|bypassPermissions|--allow-dangerously-skip-permissions/i, message: "instrucțiune de ocolire a permisiunilor" },
  { re: /ignore (all|any|the) (previous|prior|above) instructions/i, message: "instrucțiune de tip prompt-injection" },
  { re: /\bgit\s+push\b|\bnpm\s+publish\b|\bgh\s+pr\s+(create|merge)\b/i, message: "efect extern (push/publish/PR) fără aprobare legată de acțiune" },
  { re: /curl[^|\n]*\|\s*(ba)?sh|iwr[^|\n]*\|\s*iex/i, message: "descărcare și execuție de cod" },
  { re: /\bOPENAI_API_KEY\b|\bANTHROPIC_API_KEY\b|--bare\b/, message: "rută de facturare API (interzisă de BillingPolicy)" },
  { re: /\brm\s+-rf\s+[\/~]|Remove-Item\s+-Recurse\s+-Force\s+[A-Z]:\\/i, message: "ștergere distructivă" },
];

/**
 * Minimal YAML frontmatter parser for SKILL.md: `key: value`, quoted strings, one-level maps
 * (`metadata:` with indented `key: value`) and `- item` lists. Anything else is a validation error;
 * no YAML dependency and no code execution.
 */
export function parseFrontmatter(text) {
  const match = String(text).replace(/^\uFEFF/, "").match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { ok: false, error: "SKILL.md trebuie să înceapă cu frontmatter YAML între ---" };
  const data = {}; const errors = [];
  let currentKey = null;
  for (const raw of match[1].split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    const nested = raw.match(/^\s{2,}([A-Za-z0-9_.-]+):\s*(.*)$/);
    const item = raw.match(/^\s*-\s+(.*)$/);
    const top = raw.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (top) {
      currentKey = top[1];
      data[currentKey] = top[2] === "" ? {} : unquote(top[2]);
    } else if (nested && currentKey && typeof data[currentKey] === "object" && !Array.isArray(data[currentKey])) {
      data[currentKey][nested[1]] = unquote(nested[2]);
    } else if (item && currentKey) {
      if (!Array.isArray(data[currentKey])) data[currentKey] = Object.keys(data[currentKey] || {}).length ? data[currentKey] : [];
      if (Array.isArray(data[currentKey])) data[currentKey].push(unquote(item[1]));
      else errors.push(`listă neașteptată sub ${currentKey}`);
    } else errors.push(`linie nerecunoscută: ${raw.slice(0, 60)}`);
  }
  return { ok: errors.length === 0, error: errors.join("; "), data, body: match[2] };
}

const unquote = (v) => {
  const s = String(v).trim();
  if ((s.startsWith("\"") && s.endsWith("\"")) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1);
  return s;
};

/**
 * Validates a skill directory against the Agent Skills format (name/description required, name
 * matches the folder, limits on description/compatibility, metadata string map, optional
 * allowed-tools) plus Hub rules: declared Hub permission and tools may never exceed the roles that
 * use the skill (a skill cannot grant permissions), no secrets, no policy-bypass instructions.
 */
export function validateSkillDirectory(dir, { roles = [] } = {}) {
  const errors = []; const warnings = [];
  const folder = path.basename(dir);
  const file = path.join(dir, "SKILL.md");
  const empty = { frontmatter: {}, body: "", hub: { roles: [], tools: [], permission: "READ_ONLY", effective: {}, tests: [] } };
  if (!fs.existsSync(file)) return { ok: false, errors: ["lipsește SKILL.md"], warnings, files: listFiles(dir), ...empty };
  const files = listFiles(dir);
  if (files.length > MAX_FILES) errors.push(`prea multe fișiere (${files.length} > ${MAX_FILES})`);
  const text = fs.readFileSync(file, "utf8");
  const fm = parseFrontmatter(text);
  if (!fm.ok) errors.push(fm.error);
  const d = fm.data || {};
  if (typeof d.name !== "string" || !d.name) errors.push("name lipsește");
  else {
    if (d.name.length > 64) errors.push("name are peste 64 de caractere");
    if (!NAME_RE.test(d.name)) errors.push("name: doar litere mici, cifre și cratime simple, fără cratimă la capete");
    if (d.name !== folder) errors.push(`name (${d.name}) trebuie să coincidă cu directorul (${folder})`);
  }
  if (typeof d.description !== "string" || !d.description.trim()) errors.push("description lipsește");
  else if (d.description.length > 1024) errors.push("description are peste 1024 de caractere");
  if (d.compatibility !== undefined && (typeof d.compatibility !== "string" || d.compatibility.length > 500)) errors.push("compatibility: text de maximum 500 de caractere");
  if (d.metadata !== undefined && (typeof d.metadata !== "object" || Array.isArray(d.metadata) || Object.values(d.metadata).some((v) => typeof v !== "string"))) errors.push("metadata trebuie să fie o hartă text → text");
  if (d["allowed-tools"] !== undefined && typeof d["allowed-tools"] !== "string") errors.push("allowed-tools trebuie să fie o listă separată prin spații");
  const known = new Set(["name", "description", "license", "compatibility", "metadata", "allowed-tools"]);
  for (const key of Object.keys(d)) if (!known.has(key)) warnings.push(`câmp necunoscut în frontmatter: ${key}`);
  const bodyLines = (fm.body || "").split(/\r?\n/).length;
  if (bodyLines > 500) warnings.push(`corpul are ${bodyLines} de linii (recomandat < 500; mută detaliile în references/)`);

  const meta = d.metadata || {};
  const hubRoles = String(meta["hub-roles"] || "").split(/\s+/).filter(Boolean);
  const hubTools = String(meta["hub-tools"] || "").split(/\s+/).filter(Boolean);
  const hubPermission = meta["hub-permission"] || "READ_ONLY";
  if (!PERMISSION_TIERS.includes(hubPermission)) errors.push(`hub-permission necunoscut: ${hubPermission}`);
  const roleDefs = hubRoles.map((id) => roles.find((r) => r.id === id));
  hubRoles.forEach((id, i) => { if (!roleDefs[i]) errors.push(`rol necunoscut în hub-roles: ${id}`); });
  if (!hubRoles.length) warnings.push("metadata.hub-roles lipsește: skill-ul nu este atribuit niciunui rol");
  const effective = {};
  for (const role of roleDefs.filter(Boolean)) {
    const eff = effectiveFor(role, { tools: hubTools, permission: hubPermission });
    effective[role.id] = eff;
    if (eff.droppedTools.length) warnings.push(`${role.id}: skill-ul nu adaugă unelte rolului; ignorate: ${eff.droppedTools.join(", ")}`);
    if (eff.cappedPermission) warnings.push(`${role.id}: permisiunea efectivă rămâne ${eff.permission} (skill-ul declară ${hubPermission})`);
    if (hubTools.length && !eff.tools.length) errors.push(`${role.id}: nicio unealtă a skill-ului nu este permisă rolului; skill inutilizabil pentru acest rol`);
  }

  for (const rel of files) {
    const abs = path.join(dir, rel);
    const stat = fs.statSync(abs);
    if (stat.size > MAX_FILE_BYTES) { errors.push(`${rel}: peste ${MAX_FILE_BYTES / 1024} KB`); continue; }
    const content = fs.readFileSync(abs, "utf8");
    if (containsSecretLikeContent(content)) errors.push(`${rel}: conține ceva ce seamănă cu un secret`);
    for (const p of RISKY_PATTERNS) if (p.re.test(content)) errors.push(`${rel}: ${p.message}`);
  }
  return { ok: errors.length === 0, errors, warnings, files, frontmatter: d, body: fm.body || "",
    hub: { roles: hubRoles, tools: hubTools, permission: hubPermission, effective, tests: String(meta["hub-tests"] || "").split(/\s*;\s*/).filter(Boolean) } };
}

/**
 * A skill never grants permissions: the effective tool set is the intersection of skill and role
 * tools, and the effective tier is the lower of the two. Anything a skill asks beyond the role is
 * dropped (and any attempt to use it at runtime is the DENIED action skill.permission_escalation).
 */
export function effectiveFor(role, skill) {
  const roleTools = new Set(role.tools || []);
  const tools = (skill.tools || []).filter((t) => roleTools.has(t));
  const droppedTools = (skill.tools || []).filter((t) => !roleTools.has(t));
  const skillTier = Math.max(0, PERMISSION_TIERS.indexOf(skill.permission || "READ_ONLY"));
  const roleTier = Math.max(0, PERMISSION_TIERS.indexOf(role.authority || "READ_ONLY"));
  return { tools, droppedTools, permission: PERMISSION_TIERS[Math.min(skillTier, roleTier)], cappedPermission: skillTier > roleTier };
}

function listFiles(dir) {
  const out = [];
  const walk = (rel) => {
    for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const next = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(next);
      else if (entry.isFile()) out.push(next);
      if (out.length > MAX_FILES) return;
    }
  };
  walk("");
  return out.sort();
}

export function hashSkillDirectory(dir, files) {
  const hash = crypto.createHash("sha256");
  for (const rel of files) { hash.update(rel); hash.update("\0"); hash.update(fs.readFileSync(path.join(dir, rel))); hash.update("\0"); }
  return hash.digest("hex");
}

/**
 * Skill registry. Canonical format = Agent Skills (SKILL.md + optional scripts/, references/,
 * assets/), stored in v2/skills/<name>/. Every content change creates a new immutable version
 * (sha256). Validation runs on import; invalid skills are recorded as `invalid`, never used.
 * Export writes a Claude Code plugin bundle into the Hub work dir — it is never installed globally.
 */
export function createSkills({ db, bus, clock, config, roleConfig }) {
  const skillsDir = config.skillsDir || path.join(config.v2Root, "skills");

  function importAll(actor = "seed") {
    if (!fs.existsSync(skillsDir)) return { imported: 0, versions: 0, invalid: 0 };
    let versions = 0; let invalid = 0; let imported = 0;
    for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      let result;
      try { result = importOne(path.join(skillsDir, entry.name), actor); }
      catch (error) {
        invalid += 1; imported += 1;
        bus.emit({ type: "skill.import_failed", scopeType: "skill", scopeId: entry.name, source: actor, payload: { error: String(error.message || error).slice(0, 300) } });
        continue;
      }
      imported += 1; if (result.newVersion) versions += 1; if (!result.valid) invalid += 1;
    }
    return { imported, versions, invalid };
  }

  function importOne(dir, actor = "user") {
    const validation = validateSkillDirectory(dir, { roles: roleConfig.roles });
    const folder = path.basename(dir);
    const id = NAME_RE.test(folder) && folder.length <= 64 ? folder : folder.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "invalid-skill";
    const sha = hashSkillDirectory(dir, validation.files);
    const now = clock().toISOString();
    return bus.transaction(() => {
      const existing = db.prepare("SELECT * FROM skills WHERE id = ?").get(id);
      const known = db.prepare("SELECT version FROM skill_versions WHERE skill_id = ? AND sha256 = ?").get(id, sha);
      const status = validation.ok ? "active" : "invalid";
      if (known) {
        if (existing && existing.status !== "deprecated" && (existing.status !== status || existing.current_version !== known.version)) {
          db.prepare("UPDATE skills SET status = ?, current_version = ?, updated_at = ? WHERE id = ?").run(status, known.version, now, id);
        }
        return { id, version: known.version, newVersion: false, valid: validation.ok, validation };
      }
      const version = (db.prepare("SELECT MAX(version) AS v FROM skill_versions WHERE skill_id = ?").get(id)?.v || 0) + 1;
      if (!existing) db.prepare("INSERT INTO skills (id, current_version, status, source, directory, created_at, updated_at) VALUES (?, ?, ?, 'hub', ?, ?, ?)")
        .run(id, version, status, path.relative(config.v2Root, dir).replaceAll("\\", "/"), now, now);
      db.prepare(`INSERT INTO skill_versions (skill_id, version, sha256, frontmatter_json, body, files_json, validation_json, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, version, sha, json(validation.frontmatter || {}), validation.body.slice(0, 200000), json(validation.files),
        json({ ok: validation.ok, errors: validation.errors, warnings: validation.warnings, hub: validation.hub }), actor, now);
      if (existing) db.prepare("UPDATE skills SET current_version = ?, status = ?, updated_at = ? WHERE id = ?").run(version, status, now, id);
      bus.append({ type: validation.ok ? "skill.versioned" : "skill.invalid", scopeType: "skill", scopeId: id, source: actor,
        payload: { version, sha256: sha, errors: validation.errors.slice(0, 10), warnings: validation.warnings.slice(0, 10) } });
      return { id, version, newVersion: true, valid: validation.ok, validation };
    });
  }

  function list() {
    return db.prepare("SELECT * FROM skills ORDER BY id").all().map((s) => {
      const v = db.prepare("SELECT * FROM skill_versions WHERE skill_id = ? AND version = ?").get(s.id, s.current_version);
      const fm = parse(v?.frontmatter_json, {});
      return { id: s.id, status: s.status, currentVersion: s.current_version, directory: s.directory, description: fm.description || "",
        license: fm.license || "", compatibility: fm.compatibility || "", metadata: fm.metadata || {}, sha256: v?.sha256 || "",
        validation: parse(v?.validation_json, {}), versions: db.prepare("SELECT COUNT(*) AS n FROM skill_versions WHERE skill_id = ?").get(s.id).n, updatedAt: s.updated_at };
    });
  }

  function versions(id) {
    return db.prepare("SELECT skill_id, version, sha256, validation_json, created_by, created_at FROM skill_versions WHERE skill_id = ? ORDER BY version DESC").all(id)
      .map((v) => ({ skillId: v.skill_id, version: v.version, sha256: v.sha256, validation: parse(v.validation_json, {}), createdBy: v.created_by, createdAt: v.created_at }));
  }

  /** Skills a role may use (only valid, active skills that list the role). */
  // M08 Skill Evolution: an approved candidate may be active for some projects (an overlay). Skill bodies are a registry: no version
  // (base or candidate) is injected into worker prompts today, so the run records the version whose content it could have used (the
  // base) and names the active candidate separately — outcomes are never attributed to content the worker did not receive (review M08).
  let overlay = () => ({});
  const setOverlay = (fn) => { overlay = typeof fn === "function" ? fn : () => ({}); };
  const forRole = (roleId, { projectId = null } = {}) => {
    const over = overlay(projectId) || {};
    return list().filter((s) => s.status === "active" && String(s.metadata["hub-roles"] || "").split(/\s+/).includes(roleId))
      .map((s) => {
        const v = over[s.id] && over[s.id] !== s.currentVersion ? db.prepare("SELECT version, sha256 FROM skill_versions WHERE skill_id = ? AND version = ?").get(s.id, over[s.id]) : null;
        return { id: s.id, version: s.currentVersion, sha256: s.sha256, ...(v ? { candidateActive: v.version, candidateApplied: false } : {}) };
      });
  };

  /** Writes a Claude Code plugin bundle (.claude-plugin/plugin.json + skills/) under the Hub work dir. */
  function exportBundle({ format = "claude-code-plugin" } = {}) {
    if (!["claude-code-plugin", "agent-skills"].includes(format)) throw new HubError("validation", "Unknown export format");
    const active = list().filter((s) => s.status === "active");
    const stamp = clock().toISOString().replace(/[:.]/g, "-");
    const out = path.join(config.workDir, "exports", `skills-${format}-${stamp}`);
    const skillsOut = path.join(out, "skills");
    fs.mkdirSync(skillsOut, { recursive: true });
    const exported = []; const skipped = [];
    for (const s of active) {
      const src = path.join(config.v2Root, s.directory);
      const check = validateSkillDirectory(src, { roles: roleConfig.roles });
      const sha = check.files.length ? hashSkillDirectory(src, check.files) : "";
      if (!check.ok) { skipped.push({ id: s.id, reason: `invalid: ${check.errors.slice(0, 3).join("; ")}` }); continue; }
      if (sha !== s.sha256) { skipped.push({ id: s.id, reason: "conținut modificat după ultima versiune validată; rulează importul" }); continue; }
      fs.cpSync(src, path.join(skillsOut, s.id), { recursive: true, filter: (p) => !fs.lstatSync(p).isSymbolicLink() });
      exported.push({ id: s.id, version: s.currentVersion, sha256: sha });
    }
    if (format === "claude-code-plugin") {
      fs.mkdirSync(path.join(out, ".claude-plugin"), { recursive: true });
      fs.writeFileSync(path.join(out, ".claude-plugin", "plugin.json"), `${JSON.stringify({ name: "ifrim-agent-hub-skills", version: `1.0.${exported.length}`,
        description: "Ifrim Digital Agent Hub skills (Agent Skills format). Local bundle; not published.", author: { name: "Ifrim Digital" } }, null, 2)}\n`);
    }
    bus.emit({ type: "skill.exported", scopeType: "system", scopeId: "skills", source: "user", payload: { format, count: exported.length, skipped: skipped.length, path: out } });
    return { format, path: out, skills: exported, skipped,
      note: "Pachet local în .ifrim/tmp. Instalarea în ~/.claude sau publicarea cer acordul tău (configurare globală)." };
  }

  return { importAll, importOne, list, versions, forRole, setOverlay, exportBundle, dir: skillsDir };
}
