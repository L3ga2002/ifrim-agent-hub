import fs from "node:fs";
import path from "node:path";
import { newId } from "../core/ids.mjs";
import { HubError } from "../core/errors.mjs";
import { isInside, isSecretLikeName } from "../security/paths.mjs";

/** Parses the central PROJECTS.md registry (read-only) into project descriptors. */
export function parseRegistry(markdown, projectsRoot) {
  const out = [];
  const sections = markdown.split(/^## /m).slice(1);
  for (const section of sections) {
    const [titleLine, ...rest] = section.split("\n");
    const body = rest.join("\n");
    const field = (label) => {
      const match = body.match(new RegExp(`^- ${label}:\\s*(.+)$`, "mi"));
      return match ? match[1].trim().replace(/^`|`$/g, "") : "";
    };
    const projectPath = field("Path");
    if (!projectPath) continue;
    const resolved = path.resolve(projectPath);
    if (!isInside(projectsRoot, resolved)) continue;
    const name = titleLine.trim();
    out.push({
      name, slug: slugify(name), path: resolved, stack: field("Stack"), status: field("Status"),
      frontendUrl: field("Frontend preview"), backendUrl: field("Backend API"),
      repo: field("GitHub repo") || field("Planned GitHub repo"),
    });
  }
  return out;
}

export const slugify = (name) => name.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, "and")
  .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function createProjects({ db, bus, config, clock }) {
  function rowToProject(row) {
    return { id: row.id, slug: row.slug, name: row.name, path: row.path, clientId: row.client_id, repo: row.repo, frontendUrl: row.frontend_url,
      backendUrl: row.backend_url, stack: row.stack, status: row.status, executionAllowed: Boolean(row.execution_allowed),
      trustedConfig: Boolean(row.trusted_config), source: row.source, createdAt: row.created_at, updatedAt: row.updated_at, version: row.version };
  }

  /**
   * Syncs projects from the registry. Only Ifrim Agent Hub is enabled for V2 execution/backups in this
   * phase; every other project is read-only context until you enable it explicitly.
   */
  function syncFromRegistry() {
    let registry = [];
    try { registry = parseRegistry(fs.readFileSync(config.registryPath, "utf8"), config.projectsRoot); } catch { registry = []; }
    const hubPresent = registry.some((p) => isSame(p.path, config.hubRoot));
    if (!hubPresent) registry.push({ name: config.hubProjectName || "Ifrim Agent Hub", slug: "ifrim-agent-hub", path: config.hubRoot, stack: "Node.js + SQLite + React/Vite", status: "", frontendUrl: "", backendUrl: "", repo: "" });
    const now = clock().toISOString();
    bus.transaction(() => {
      for (const project of registry) {
        const existing = db.prepare("SELECT * FROM projects WHERE slug = ?").get(project.slug);
        const isHub = isSame(project.path, config.hubRoot);
        if (!existing) {
          const id = newId("prj");
          db.prepare(`INSERT INTO projects (id, slug, name, path, repo, frontend_url, backend_url, stack, status, execution_allowed, trusted_config, source, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'registry', ?, ?)`)
            .run(id, project.slug, project.name, project.path, project.repo, project.frontendUrl, project.backendUrl, project.stack, project.status,
              isHub ? 1 : 0, isHub ? 1 : 0, now, now);
          bus.append({ type: "project.registered", scopeType: "project", scopeId: id, projectId: id, source: "registry", payload: { slug: project.slug, executionAllowed: isHub } });
        } else if (existing.path !== project.path || existing.stack !== project.stack || existing.status !== project.status) {
          db.prepare("UPDATE projects SET path = ?, stack = ?, status = ?, frontend_url = ?, backend_url = ?, repo = ?, updated_at = ?, version = version + 1 WHERE id = ?")
            .run(project.path, project.stack, project.status, project.frontendUrl, project.backendUrl, project.repo, now, existing.id);
          // Runs were enabled for the folder the owner checked; a new path from the registry needs a new decision.
          if (existing.path !== project.path && existing.execution_allowed && !isHub) {
            db.prepare("UPDATE projects SET execution_allowed = 0 WHERE id = ?").run(existing.id);
            bus.append({ type: "project.execution_disabled", scopeType: "project", scopeId: existing.id, projectId: existing.id, source: "registry",
              payload: { slug: existing.slug, name: existing.name, reason: "Calea din registru s-a schimbat; permite din nou execuțiile dacă vrei" } });
          }
        }
      }
    });
    return list();
  }

  const list = () => db.prepare("SELECT * FROM projects ORDER BY execution_allowed DESC, name").all().map(rowToProject);
  const get = (id) => { const row = db.prepare("SELECT * FROM projects WHERE id = ? OR slug = ?").get(id, id); return row ? rowToProject(row) : null; };
  const hub = () => get("ifrim-agent-hub");

  /**
   * Registers a sanitized TEST project for live validation (M02 §29). Only a directory created by
   * `v2/scripts/create-test-project.mjs` qualifies: it carries the TEST_PROJECT_MARKER, lives directly in the
   * projects root (never inside the Hub or another project), and holds no secret-like files, links/junctions or
   * .ifrim/private anywhere in its tree (see testProjectTreeProblem). Real client projects stay read-only context; this
   * never edits PROJECTS.md. Idempotent for the same path.
   */
  function registerTest({ path: requested, name }, actor = "user") {
    const dir = path.resolve(String(requested || ""));
    if (!isInside(config.projectsRoot, dir) || isSame(dir, config.projectsRoot)) throw new HubError("policy", "A test project must live inside the projects root");
    if (!isSame(path.dirname(dir), config.projectsRoot)) throw new HubError("policy", "A test project must be a direct child of the projects root (not nested in another project)");
    if (isInside(dir, config.hubRoot) || isInside(config.hubRoot, dir)) throw new HubError("policy", "The Hub itself cannot be registered as a test project");
    let stat;
    try { stat = fs.lstatSync(dir); } catch { throw new HubError("not_found", "Test project directory not found"); }
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new HubError("policy", "The test project must be a real directory (no link or junction)");
    const marker = readMarker(dir);
    if (!marker) throw new HubError("policy", `Missing ${TEST_PROJECT_MARKER}: only projects created by the Hub test script can be registered`);
    const problem = testProjectTreeProblem(dir);
    if (problem) throw new HubError("policy", problem);
    const existing = db.prepare("SELECT * FROM projects WHERE lower(path) = lower(?)").get(dir);
    if (existing) {
      if (existing.source !== "hub-test") throw new HubError("conflict", "This directory is already registered as a regular project");
      return { ...rowToProject(existing), alreadyRegistered: true };
    }
    const title = String(name || marker.name || "").trim();
    if (title.length < 2 || title.length > 80) throw new HubError("validation", "Name must have 2–80 characters");
    const slug = slugify(title);
    if (!slug || db.prepare("SELECT 1 FROM projects WHERE slug = ?").get(slug)) throw new HubError("conflict", `Slug ${slug || "(empty)"} is already used`);
    const id = newId("prj");
    const now = clock().toISOString();
    bus.transaction(() => {
      db.prepare(`INSERT INTO projects (id, slug, name, path, repo, frontend_url, backend_url, stack, status, execution_allowed, trusted_config, source, created_at, updated_at)
        VALUES (?, ?, ?, ?, '', '', '', ?, 'test', 1, 0, 'hub-test', ?, ?)`).run(id, slug, title, dir, String(marker.stack || "Node.js"), now, now);
      bus.append({ type: "project.registered", scopeType: "project", scopeId: id, projectId: id, source: actor, payload: { slug, executionAllowed: true, test: true } });
    });
    return get(id);
  }

  /** Withdraws execution from a test project (history and files stay). Regular projects are refused. */
  function retireTest(projectId, actor = "user") {
    const row = db.prepare("SELECT * FROM projects WHERE id = ? OR slug = ?").get(projectId, projectId);
    if (!row) throw new HubError("not_found", "Project not found");
    if (row.source !== "hub-test") throw new HubError("policy", "Only test projects can be retired here");
    bus.transaction(() => {
      db.prepare("UPDATE projects SET execution_allowed = 0, status = 'retired', updated_at = ?, version = version + 1 WHERE id = ?").run(clock().toISOString(), row.id);
      bus.append({ type: "project.retired", scopeType: "project", scopeId: row.id, projectId: row.id, source: actor, payload: { slug: row.slug } });
    });
    return get(row.id);
  }

  /**
   * Why a project folder may not host agent runs, or null: it must be a real directory inside the projects root, outside
   * the Hub, with no link or junction on the way (checked on the real path too). Used when the owner enables runs and
   * again by the gate before every run, so a folder swapped afterwards is caught.
   */
  function folderProblem(projectPath) {
    const dir = path.resolve(String(projectPath || ""));
    if (!isInside(config.projectsRoot, dir) || isSame(dir, config.projectsRoot)) return { category: "policy", message: "Proiectul trebuie să fie în folderul de proiecte" };
    if (isInside(dir, config.hubRoot) || isInside(config.hubRoot, dir)) return { category: "policy", message: "Un proiect din Hub (sau care conține Hub-ul) nu poate fi activat separat" };
    let stat;
    try { stat = fs.lstatSync(dir); } catch { return { category: "not_found", message: "Folderul proiectului nu există" }; }
    if (!stat.isDirectory() || stat.isSymbolicLink()) return { category: "policy", message: "Proiectul trebuie să fie un folder real (fără link sau junction)" };
    let real;
    try { real = fs.realpathSync.native(dir); } catch { return { category: "not_found", message: "Folderul proiectului nu poate fi citit" }; }
    let root;
    try { root = fs.realpathSync.native(config.projectsRoot); } catch { return { category: "not_found", message: "Folderul de proiecte nu poate fi citit" }; }
    if (!isInside(root, real) || isInside(real, config.hubRoot)) return { category: "policy", message: "Un link sau junction pe drum duce proiectul în afara folderului de proiecte" };
    return null;
  }

  /** For the gate: null for the Hub (always enabled) or a sound folder; otherwise the reason runs must not start there. */
  const executionProblem = (project) => {
    if (!project || project.slug === "ifrim-agent-hub" || isSame(project.path, config.hubRoot)) return null;
    return folderProblem(project.path)?.message || null;
  };

  /**
   * Enables or withdraws agent runs on a company project (the owner's decision; the command layer keeps enabling UI-only
   * with the exact project name typed). Enabling requires a real directory directly under the projects root's tree,
   * outside the Hub (no link or junction on the way), and not a retired test project. The Hub itself cannot be toggled:
   * Stop All and the execution gate halt it. Idempotent: the same state returns the project unchanged.
   */
  function setExecution(projectRef, enabled, { confirmName = "", actor = "user", reason = "" } = {}) {
    const row = db.prepare("SELECT * FROM projects WHERE id = ? OR slug = ?").get(projectRef, projectRef);
    if (!row) throw new HubError("not_found", "Project not found");
    if (row.slug === "ifrim-agent-hub" || isSame(row.path, config.hubRoot)) throw new HubError("policy", "Hub-ul rămâne activat; oprește-l cu Stop All sau suspendă poarta");
    if (Boolean(row.execution_allowed) === Boolean(enabled)) return rowToProject(row);
    if (enabled) {
      if (String(confirmName) !== row.name) throw new HubError("validation", "Tastează numele exact al proiectului ca să permiți execuții pe el");
      if (row.source === "hub-test" && row.status === "retired") throw new HubError("policy", "Proiectul de test a fost retras; creează unul nou cu scriptul de test");
      const problem = folderProblem(row.path);
      if (problem) throw new HubError(problem.category, problem.message);
    }
    const now = clock().toISOString();
    bus.transaction(() => {
      db.prepare("UPDATE projects SET execution_allowed = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(enabled ? 1 : 0, now, row.id);
      bus.append({ type: enabled ? "project.execution_enabled" : "project.execution_disabled", scopeType: "project", scopeId: row.id, projectId: row.id, source: actor,
        payload: { slug: row.slug, name: row.name, reason: String(reason || "").slice(0, 300) } });
    });
    return get(row.id);
  }

  return { syncFromRegistry, list, get, hub, registerTest, retireTest, setExecution, executionProblem };
}

/** Marker file written by v2/scripts/create-test-project.mjs; its presence is what makes a directory a test project. */
export const TEST_PROJECT_MARKER = ".ifrim-hub-test.json";

function readMarker(dir) {
  try {
    const file = path.join(dir, TEST_PROJECT_MARKER);
    // A marker that is a link would be read from wherever it points; only a real file written by the script counts.
    if (!fs.lstatSync(file).isFile()) return null;
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return data && data.createdBy === "ifrim-agent-hub" && data.purpose === "live-validation" ? data : null;
  } catch { return null; }
}

/** Bounds of the tree walk: a sanitized test project is a small repository, so anything bigger is refused, never sampled. */
export const TEST_PROJECT_LIMITS = Object.freeze({ maxDepth: 8, maxEntries: 5000 });

/**
 * Why a candidate test project's tree is not sanitized, or null. The whole tree is walked breadth-first (.git and Hub
 * backups included, nothing skipped) without ever following a link: a symlink/junction anywhere, a secret-like name
 * anywhere (src/.env, config/id_rsa…), .ifrim/private, an unreadable folder or an entry that is neither file nor folder
 * refuses it. A tree with entries deeper than maxDepth levels or more than maxEntries entries is refused as too large
 * instead of being checked only in part.
 */
export function testProjectTreeProblem(root, { maxDepth = TEST_PROJECT_LIMITS.maxDepth, maxEntries = TEST_PROJECT_LIMITS.maxEntries } = {}) {
  const tooLarge = `Too large for a sanitized test project (over ${maxEntries} entries or ${maxDepth} folder levels); remove dependencies and build output, or create a fresh one with the script`;
  const queue = [{ dir: root, rel: "", depth: 0 }];
  let seen = 0;
  for (let i = 0; i < queue.length; i += 1) {
    const { dir, rel, depth } = queue[i];
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return `Cannot read ${rel || "the project folder"}; every folder of a test project must be readable to be checked`; }
    if (entries.length && depth >= maxDepth) return tooLarge;
    for (const entry of entries) {
      seen += 1;
      if (seen > maxEntries) return tooLarge;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) return `A test project must not contain links or junctions (${childRel})`;
      if (isSecretLikeName(entry.name)) return `A test project must not contain secret-like files (${childRel})`;
      if (/(?:^|\/)\.ifrim\/private$/i.test(childRel)) return `A test project must not contain .ifrim/private (${childRel})`;
      if (entry.isDirectory()) queue.push({ dir: path.join(dir, entry.name), rel: childRel, depth: depth + 1 });
      else if (!entry.isFile()) return `A test project may contain only files and folders (${childRel})`;
    }
  }
  return null;
}

const isSame = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
