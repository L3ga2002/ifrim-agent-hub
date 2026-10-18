import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { HubError } from "../core/errors.mjs";
import { json, parse } from "../storage/db.mjs";
import { containsSecretLikeContent } from "../security/redact.mjs";
import { PERMISSION_TIERS } from "../policy/approvals.mjs";
import { gitChangedPathsSync, gitHeadSync, gitIndexEntriesSync } from "../tools/git.mjs";

const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
// M09-A3 opt-in selection metadata: `hub-task-types` = Hub task types (optionally qualified by the Software Factory work type,
// e.g. "coding:BUGFIX"); `hub-clients` = Hub client ids. Space- or comma-separated tokens.
const TASK_TYPE_RE = /^[a-z][a-z0-9_]{0,63}(:[A-Z][A-Z0-9_]{0,31})?$/;
const CLIENT_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
export const splitTokens = (value) => String(value || "").split(/[\s,]+/).filter(Boolean);
const sha256Text = (text) => crypto.createHash("sha256").update(String(text ?? ""), "utf8").digest("hex");
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
  const taskTypes = splitTokens(meta["hub-task-types"]);
  const clients = splitTokens(meta["hub-clients"]);
  if (meta["hub-task-types"] !== undefined && !taskTypes.length) errors.push("hub-task-types este gol: omite cheia sau listează tipurile de sarcină");
  for (const t of taskTypes) if (!TASK_TYPE_RE.test(t)) errors.push(`hub-task-types: „${t.slice(0, 40)}” nu e un tip de sarcină valid (ex.: content_script sau coding:BUGFIX)`);
  if (meta["hub-clients"] !== undefined && !clients.length) errors.push("hub-clients este gol: omite cheia (skill global) sau listează clienții");
  for (const c of clients) if (!CLIENT_ID_RE.test(c)) errors.push(`hub-clients: „${c.slice(0, 40)}” nu e un id de client valid`);
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
    hub: { roles: hubRoles, tools: hubTools, permission: hubPermission, effective, tests: String(meta["hub-tests"] || "").split(/\s*;\s*/).filter(Boolean),
      ...(meta["hub-task-types"] !== undefined ? { taskTypes } : {}), ...(meta["hub-clients"] !== undefined ? { clients } : {}) } };
}

/** The directory holding `.git` (a folder or a worktree file) above `start`, or null. */
function findRepositoryRoot(start) {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

const normPath = (p) => (process.platform === "win32" ? String(p).toLowerCase() : String(p));

/**
 * M09-A3: one read-only git view of the skills directory, taken from the repository that contains `skillsDir` (never from a
 * repository nested inside a skill folder: its files are untracked here). Uses the Hub's safe git calls (core.fsmonitor=false,
 * no hooks, allowlisted environment). Index paths are relative to skillsDir; status paths are relative to the repository root.
 */
export function gitSnapshotOf(skillsDir) {
  const root = findRepositoryRoot(skillsDir);
  if (!root) return { ok: false, reason: "no_repository" };
  const entries = gitIndexEntriesSync(skillsDir);
  const status = gitChangedPathsSync(skillsDir);
  if (!entries || !status) return { ok: false, reason: "git_unavailable" };
  const prefix = path.relative(root, path.resolve(skillsDir)).replaceAll("\\", "/");
  return { ok: true, prefix, head: gitHeadSync(skillsDir) || "",
    index: new Map(entries.map((e) => [normPath(e.path), e.trusted])),
    dirty: [...status.changed, ...status.untracked].map(normPath) };
}

/**
 * Approval facts of one skill folder at import: every file is tracked in git (no assume-unchanged / skip-worktree entry, which
 * would hide a change), and nothing under the folder is modified, staged, deleted or untracked. Only such a version (or an
 * owner-approved candidate) is ever injected into a worker prompt; an uncommitted edit stays a registry entry.
 */
export function gitFactsFor(snapshot, folder, files) {
  if (!snapshot?.ok) return { tracked: false, clean: false, head: "", reason: snapshot?.reason || "git_unavailable" };
  const inSkills = (rel) => normPath(`${folder}/${rel}`);
  const inRepo = normPath(`${snapshot.prefix ? `${snapshot.prefix}/` : ""}${folder}/`);
  const untracked = files.filter((rel) => !snapshot.index.has(inSkills(rel)));
  const hidden = files.filter((rel) => snapshot.index.get(inSkills(rel)) === false);
  const dirty = snapshot.dirty.filter((p) => p.startsWith(inRepo));
  const tracked = files.length > 0 && untracked.length === 0 && hidden.length === 0;
  const clean = tracked && dirty.length === 0;
  const reason = !files.length ? "empty" : untracked.length ? "untracked" : hidden.length ? "skip_worktree" : dirty.length ? "modified" : "";
  return { tracked, clean, head: snapshot.head, reason };
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

/** The registry id of a skill folder (the folder name when it is a valid skill name, else a slug of it). */
const skillIdOf = (folder) => (NAME_RE.test(folder) && folder.length <= 64 ? folder
  : folder.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "invalid-skill");
const approvedFacts = (git) => git?.tracked === true && git?.clean === true;

/** M10.2 reconcile states: one per skill folder (MISSING_ON_DISK per registry entry whose folder is gone). */
export const RECONCILE_STATES = Object.freeze(["IN_SYNC", "NEW_CONTENT", "FACTS_STALE", "INVALID", "MISSING_ON_DISK"]);

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

  // One git view per import pass, taken only when a version needs approval facts (an already approved version never does).
  const lazySnapshot = () => { let snap = null; return () => (snap ||= gitSnapshotOf(skillsDir)); };

  function importAll(actor = "seed") {
    if (!fs.existsSync(skillsDir)) return { imported: 0, versions: 0, invalid: 0 };
    let versions = 0; let invalid = 0; let imported = 0;
    const snapshot = lazySnapshot();
    for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      let result;
      try { result = importOne(path.join(skillsDir, entry.name), actor, { snapshot }); }
      catch (error) {
        invalid += 1; imported += 1;
        bus.emit({ type: "skill.import_failed", scopeType: "skill", scopeId: entry.name, source: actor, payload: { error: String(error.message || error).slice(0, 300) } });
        continue;
      }
      imported += 1; if (result.newVersion) versions += 1; if (!result.valid) invalid += 1;
    }
    return { imported, versions, invalid };
  }

  /**
   * Imports one skill folder. M09-A3: the version also records its approval facts (`validation.git`: tracked + clean in the
   * repository that holds skillsDir, at import time) and `storedBodySha256` (the composer refuses a stored body that no longer
   * matches it). A known version whose facts are missing or unapproved is re-checked (an owner commit makes it approved without a
   * content change); an approved one is never re-checked. A folder outside skillsDir is registered but never approved.
   */
  function importOne(dir, actor = "user", { snapshot = lazySnapshot() } = {}) {
    const validation = validateSkillDirectory(dir, { roles: roleConfig.roles });
    const folder = path.basename(dir);
    const id = skillIdOf(folder);
    const sha = hashSkillDirectory(dir, validation.files);
    const now = clock().toISOString();
    const body = validation.body.slice(0, 200000);
    const factsNow = () => (normPath(path.dirname(path.resolve(dir))) === normPath(path.resolve(skillsDir))
      ? gitFactsFor(snapshot(), folder, validation.files) : { tracked: false, clean: false, head: "", reason: "outside_skills_dir" });
    const knownVersion = () => db.prepare("SELECT version, validation_json, body FROM skill_versions WHERE skill_id = ? AND sha256 = ?").get(id, sha);
    // git runs before the transaction (never while the database is locked); only when this content still needs approval facts.
    const before = knownVersion();
    const facts = before && approvedFacts(parse(before.validation_json, {}).git) ? null : factsNow();
    return bus.transaction(() => {
      const existing = db.prepare("SELECT * FROM skills WHERE id = ?").get(id);
      const known = knownVersion();
      const status = validation.ok ? "active" : "invalid";
      if (known) {
        if (existing && existing.status !== "deprecated" && (existing.status !== status || existing.current_version !== known.version)) {
          db.prepare("UPDATE skills SET status = ?, current_version = ?, updated_at = ? WHERE id = ?").run(status, known.version, now, id);
        }
        const stored = parse(known.validation_json, {});
        if (!approvedFacts(stored.git) || !stored.storedBodySha256) {
          const git = approvedFacts(stored.git) ? stored.git : facts || factsNow();
          const changed = !stored.git || stored.git.tracked !== git.tracked || stored.git.clean !== git.clean || stored.git.reason !== git.reason || !stored.storedBodySha256;
          if (changed) {
            db.prepare("UPDATE skill_versions SET validation_json = ? WHERE skill_id = ? AND version = ?")
              .run(json({ ...stored, git, storedBodySha256: stored.storedBodySha256 || sha256Text(known.body) }), id, known.version);
            bus.append({ type: "skill.approval_facts", scopeType: "skill", scopeId: id, source: actor,
              payload: { version: known.version, approved: approvedFacts(git), reason: git.reason || null, head: git.head ? git.head.slice(0, 12) : null } });
          }
        }
        return { id, version: known.version, newVersion: false, valid: validation.ok, validation };
      }
      const version = (db.prepare("SELECT MAX(version) AS v FROM skill_versions WHERE skill_id = ?").get(id)?.v || 0) + 1;
      const git = facts || factsNow();
      if (!existing) db.prepare("INSERT INTO skills (id, current_version, status, source, directory, created_at, updated_at) VALUES (?, ?, ?, 'hub', ?, ?, ?)")
        .run(id, version, status, path.relative(config.v2Root, dir).replaceAll("\\", "/"), now, now);
      db.prepare(`INSERT INTO skill_versions (skill_id, version, sha256, frontmatter_json, body, files_json, validation_json, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, version, sha, json(validation.frontmatter || {}), body, json(validation.files),
        json({ ok: validation.ok, errors: validation.errors, warnings: validation.warnings, hub: validation.hub, git, storedBodySha256: sha256Text(body) }), actor, now);
      if (existing) db.prepare("UPDATE skills SET current_version = ?, status = ?, updated_at = ? WHERE id = ?").run(version, status, now, id);
      bus.append({ type: validation.ok ? "skill.versioned" : "skill.invalid", scopeType: "skill", scopeId: id, source: actor,
        payload: { version, sha256: sha, errors: validation.errors.slice(0, 10), warnings: validation.warnings.slice(0, 10), approved: approvedFacts(git), approvalReason: git.reason || null } });
      return { id, version, newVersion: true, valid: validation.ok, validation, git };
    });
  }

  /**
   * How one folder of skillsDir stands against the registry, decided exactly the way importOne would act on it (so a folder
   * reported as drifted is one importOne changes, and an IN_SYNC one is one it leaves alone; that is what keeps reconcile
   * idempotent). Read-only: hashing, validation, one git view per pass, SELECTs.
   * - NEW_CONTENT: the disk content is not the registry's current version (an edit, a new folder, or a revert importOne moves
   *   the registry back to). INVALID instead when that content fails validation (importOne records it as `invalid`).
   * - FACTS_STALE: the content is the current version, but its stored approval facts (validation.git) differ from what git says
   *   now — e.g. the owner committed the folder after the Hub booted. Only importOne's own re-check rewrites them.
   * - IN_SYNC / INVALID (no drift): nothing importOne would change; an unapproved version whose facts are still accurate stays
   *   IN_SYNC (reconcile reports `approved:false`, it never approves).
   */
  function classifyFolder(dir, snapshot) {
    const folder = path.basename(dir);
    const id = skillIdOf(folder);
    const validation = validateSkillDirectory(dir, { roles: roleConfig.roles });
    const sha = hashSkillDirectory(dir, validation.files);
    const skill = db.prepare("SELECT status, current_version FROM skills WHERE id = ?").get(id);
    const known = db.prepare("SELECT version, validation_json FROM skill_versions WHERE skill_id = ? AND sha256 = ?").get(id, sha);
    const status = validation.ok ? "active" : "invalid";
    const base = { id, folder, sha256: sha, valid: validation.ok, currentVersion: skill?.current_version ?? null, deprecated: skill?.status === "deprecated" };
    const contentState = validation.ok ? "NEW_CONTENT" : "INVALID";
    if (!known) return { ...base, state: contentState, drift: true, reason: skill ? "content_changed" : "not_registered", ...(validation.ok ? {} : { errors: validation.errors.slice(0, 5) }) };
    // importOne points a non-deprecated skill at a known version (a revert to older content) and fixes its status.
    if (skill && skill.status !== "deprecated" && (skill.current_version !== known.version || skill.status !== status)) {
      return { ...base, state: contentState, drift: true, reason: skill.current_version !== known.version ? "known_version" : "status", version: known.version };
    }
    const stored = parse(known.validation_json, {});
    const steady = validation.ok ? "IN_SYNC" : "INVALID";
    // An approved version is never re-checked by importOne (only a missing body hash is filled in).
    if (approvedFacts(stored.git) && stored.storedBodySha256) return { ...base, state: steady, drift: false, version: known.version, approved: true };
    const git = approvedFacts(stored.git) ? stored.git : gitFactsFor(snapshot(), folder, validation.files);
    const stale = !stored.git || stored.git.tracked !== git.tracked || stored.git.clean !== git.clean || stored.git.reason !== git.reason || !stored.storedBodySha256;
    return { ...base, state: stale ? "FACTS_STALE" : steady, drift: stale, version: known.version, approved: approvedFacts(stored.git),
      ...(stale ? { approvedAfter: approvedFacts(git) } : {}), approvalReason: (stale ? git.reason : stored.git?.reason) || null };
  }

  /**
   * M10.2 (U05): re-checks the registry against v2/skills on demand. Before, it happened only at boot (hub.mjs) or through the
   * ui-only skill.import, so a skill committed after the Hub started stayed 'untracked' (unapproved, never injected) until the
   * next restart. reconcile classifies every folder (see classifyFolder), plus registry entries whose folder is gone
   * (MISSING_ON_DISK: reported only, nothing is deleted or deprecated), and, without dryRun, runs importOne ONLY for the drifted
   * folders. It decides nothing about approval itself: approval facts still come only from gitFactsFor inside importOne (every
   * file tracked, no skip-worktree/assume-unchanged entry, nothing modified or untracked: the owner's commit), and an owner
   * approval of a candidate stays skill.candidate.approve on the owner channel. It never reads or writes skill candidates,
   * activations or overlays. One `skill.reconciled` summary event, only when something changed (a second pass records nothing).
   * Local and inference-free: file hashes, one read-only git view, SQLite.
   */
  function reconcile({ actor = "reconcile", dryRun = false } = {}) {
    const snapshot = lazySnapshot();
    const items = [];
    if (fs.existsSync(skillsDir)) {
      for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const dir = path.join(skillsDir, entry.name);
        try { items.push(classifyFolder(dir, snapshot)); }
        // A folder that cannot even be read is reported, not imported (importAll would log skill.import_failed every pass).
        catch (error) { items.push({ id: skillIdOf(entry.name), folder: entry.name, state: "INVALID", drift: false, error: String(error.message || error).slice(0, 300) }); }
      }
    }
    const onDisk = new Set(items.map((i) => i.id));
    for (const s of db.prepare("SELECT id, directory FROM skills ORDER BY id").all()) {
      if (onDisk.has(s.id)) continue;
      const abs = folderOf(s.directory);
      if (abs && !fs.existsSync(abs)) items.push({ id: s.id, folder: path.basename(abs), state: "MISSING_ON_DISK", drift: false });
    }
    items.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const counts = Object.fromEntries(RECONCILE_STATES.map((s) => [s, items.filter((i) => i.state === s).length]));
    const drifted = items.filter((i) => i.drift);
    const applied = []; const failed = [];
    if (!dryRun) {
      for (const item of drifted) {
        try {
          const result = importOne(path.join(skillsDir, item.folder), actor, { snapshot });
          const row = db.prepare("SELECT validation_json FROM skill_versions WHERE skill_id = ? AND version = ?").get(result.id, result.version);
          applied.push({ id: result.id, from: item.state, version: result.version, newVersion: result.newVersion, valid: result.valid,
            approved: approvedFacts(parse(row?.validation_json, {}).git) });
        } catch (error) { failed.push({ id: item.id, error: String(error.message || error).slice(0, 300) }); }
      }
      if (applied.length || failed.length) {
        bus.emit({ type: "skill.reconciled", scopeType: "system", scopeId: "skills", source: actor,
          payload: { counts, applied: applied.slice(0, 50), failed: failed.slice(0, 20), missingOnDisk: items.filter((i) => i.state === "MISSING_ON_DISK").map((i) => i.id).slice(0, 50) } });
      }
    }
    const message = !drifted.length ? `Registrul de skill-uri este la zi (${items.length} verificate).`
      : dryRun ? `${drifted.length} skill-uri diferă de registru: ${drifted.map((i) => i.id).slice(0, 8).join(", ")}. Nimic nu a fost scris.`
        : `Am actualizat ${applied.length} skill-uri: ${applied.map((a) => `${a.id} v${a.version}${a.approved ? " (aprobat prin commit)" : " (neaprobat)"}`).slice(0, 8).join(", ")}${failed.length ? `; ${failed.length} au eșuat` : ""}.`;
    return { dryRun: Boolean(dryRun), counts, drift: drifted.length, items, applied, failed, message };
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
  // M08 Skill Evolution: an approved candidate may be active for some projects (an overlay). forRole stays the registry view (base
  // version, candidate named separately, candidateApplied:false). M09-A3: what a run actually RECEIVES is decided by the skill
  // composer (domain/skill-composer.mjs) from Hub rows only, and recorded per run (skill_versions_json + run_skill_usage).
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

  /** The absolute folder of a registered skill (skills.directory is relative to v2Root); null when it lies outside skillsDir. */
  const folderOf = (directory) => {
    if (typeof directory !== "string" || !directory) return null;
    const abs = path.resolve(config.v2Root, directory);
    return normPath(path.dirname(abs)) === normPath(path.resolve(skillsDir)) ? abs : null;
  };

  return { importAll, importOne, reconcile, list, versions, forRole, setOverlay, exportBundle, folderOf, dir: skillsDir };
}
