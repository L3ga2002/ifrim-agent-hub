import fs from "node:fs";
import path from "node:path";
import { newId } from "../core/ids.mjs";
import { isInside } from "../security/paths.mjs";

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
    if (!hubPresent) registry.push({ name: "Ifrim Agent Hub", slug: "ifrim-agent-hub", path: config.hubRoot, stack: "Node.js + SQLite + React/Vite", status: "", frontendUrl: "", backendUrl: "", repo: "" });
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
        }
      }
    });
    return list();
  }

  const list = () => db.prepare("SELECT * FROM projects ORDER BY execution_allowed DESC, name").all().map(rowToProject);
  const get = (id) => { const row = db.prepare("SELECT * FROM projects WHERE id = ? OR slug = ?").get(id, id); return row ? rowToProject(row) : null; };
  const hub = () => get("ifrim-agent-hub");
  return { syncFromRegistry, list, get, hub };
}

const isSame = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
