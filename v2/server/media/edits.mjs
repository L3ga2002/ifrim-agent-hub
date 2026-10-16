import { HubError } from "../core/errors.mjs";
import { newId } from "../core/ids.mjs";
import { parse } from "../storage/db.mjs";
import { validateIR } from "./ir.mjs";
import { getPreset, resolveFonts } from "./visual-bible.mjs";
import { insertEditVersion } from "./review.mjs";

/**
 * M09 edit projects: the container of EditProjectIR versions (media_edit_projects / media_edit_versions). An edit project starts
 * from a VALIDATED initial IR; every later change (a timecode patch, a platform variant, a manual divergence imported from an
 * editor) is a new version written by review.mjs / variants.mjs through the same insertEditVersion — a version is never edited
 * in place, so a render or a manifest always points at exactly what was reviewed.
 */
export function createEdits({ db, bus, clock = () => new Date(), assets, fontsDir = "C:/Windows/Fonts" }) {
  if (!db || !bus || !assets) throw new Error("createEdits requires db, bus and assets");
  const now = () => clock().toISOString();

  /** The validation context of an IR: the library (status, probe, label, origin), the pinned preset from the DB and its fonts. */
  function validationContext(ir) {
    const preset = ir?.preset?.id ? getPreset(db, ir.preset.id, ir.preset.version) : null;
    return {
      getVersion: (versionId) => { try { return assets.getVersion(versionId); } catch { return null; } },
      presets: (id, version) => getPreset(db, id, version),
      fonts: preset ? resolveFonts(preset, { fontsDir }) : undefined,
    };
  }

  function validate(ir) {
    return validateIR(ir, validationContext(ir));
  }

  /** Creates an edit project with its validated version 1. A content project, when given, must exist. */
  function create({ contentProjectId = null, title, ir, actor }) {
    const cleanTitle = String(title || "").trim().slice(0, 200);
    if (!cleanTitle) throw new HubError("validation", "Dă un titlu proiectului de montaj.", { code: "FIELD_REQUIRED" });
    if (contentProjectId && !db.prepare("SELECT 1 FROM content_projects WHERE id = ?").get(contentProjectId)) {
      throw new HubError("not_found", "Proiectul de conținut nu există.", { code: "CONTENT_PROJECT_MISSING" });
    }
    const result = validate(ir);
    if (!result.ok) throw new HubError("validation", "Planul de montaj nu este valid.", { code: "IR_INVALID", data: { errors: result.errors.slice(0, 50) } });
    return bus.transaction(() => {
      const id = newId("mep");
      const at = now();
      db.prepare(`INSERT INTO media_edit_projects (id, content_project_id, title, current_version, created_by, created_at, updated_at)
        VALUES (?, ?, ?, 0, ?, ?, ?)`).run(id, contentProjectId, cleanTitle, actor, at, at);
      bus.append({ type: "media.edit.project_created", scopeType: "media_edit_project", scopeId: id, source: actor, payload: { contentProjectId, title: cleanTitle } });
      const version = insertEditVersion(db, bus, clock, { editProjectId: id, ir: result.ir || ir, changeKind: "initial",
        change: { reason: "versiunea inițială" }, validation: { ok: true, warnings: result.warnings, durationFrames: result.durationFrames }, actor });
      return { project: get(id), version };
    });
  }

  function addVersion({ editProjectId, parentVersionId, ir, changeKind = 'patch', change, actor }) {
    const parent = getVersion(parentVersionId);
    if (!parent || parent.editProjectId !== editProjectId) throw new HubError('conflict', 'Versiunea părinte nu aparține montajului.', { code: 'EDIT_PARENT' });
    const result = validate(ir);
    if (!result.ok) throw new HubError('validation', 'Planul de montaj nu este valid.', { code: 'IR_INVALID', data: { errors: result.errors } });
    return bus.transaction(() => ({ project: get(editProjectId), version: insertEditVersion(db, bus, clock, { editProjectId, parentVersionId, ir: result.ir || ir, changeKind, change, validation: { ok: true, warnings: result.warnings, durationFrames: result.durationFrames }, actor }) }));
  }
  function mapProject(row) {
    return row ? { id: row.id, contentProjectId: row.content_project_id, title: row.title, currentVersion: row.current_version,
      createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at } : null;
  }
  function mapVersion(row, { withIr = true } = {}) {
    if (!row) return null;
    return { id: row.id, editProjectId: row.edit_project_id, version: row.version, irSha256: row.ir_sha256, parentVersionId: row.parent_version_id,
      changeKind: row.change_kind, change: parse(row.change_json, {}), validation: parse(row.validation_json, {}), variantKey: row.variant_key,
      createdBy: row.created_by, createdAt: row.created_at, ...(withIr ? { ir: parse(row.ir_json, null) } : {}) };
  }

  function get(editProjectId) {
    const project = mapProject(db.prepare("SELECT * FROM media_edit_projects WHERE id = ?").get(String(editProjectId || "")));
    if (!project) return null;
    const versions = db.prepare("SELECT * FROM media_edit_versions WHERE edit_project_id = ? ORDER BY version").all(project.id).map((r) => mapVersion(r, { withIr: false }));
    return { ...project, versions, current: versions.find((v) => v.version === project.currentVersion && !v.variantKey) || null };
  }
  function getVersion(versionId) {
    return mapVersion(db.prepare("SELECT * FROM media_edit_versions WHERE id = ?").get(String(versionId || "")));
  }
  function list({ contentProjectId = null, limit = 50 } = {}) {
    const rows = contentProjectId
      ? db.prepare("SELECT * FROM media_edit_projects WHERE content_project_id = ? ORDER BY updated_at DESC LIMIT ?").all(contentProjectId, Math.min(Number(limit) || 50, 200))
      : db.prepare("SELECT * FROM media_edit_projects ORDER BY updated_at DESC LIMIT ?").all(Math.min(Number(limit) || 50, 200));
    return rows.map(mapProject);
  }

  return { create, addVersion, get, getVersion, list, validate, validationContext };
}
