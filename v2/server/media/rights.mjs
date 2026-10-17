// M09 media rights. Origin (who made the material: OWNED, LICENSED, CLIENT_PROVIDED, AI_GENERATED, UNKNOWN) is separate from the
// effective right to use it for a scope (platform × use × time window). Rights records are additive grants; a RESTRICTED record
// covering the scope denies, a revoked record grants nothing. Public use needs a CLEARED_FOR_SCOPE record for every original
// the material comes from: derivatives inherit by walking derived_from_json back to the originals (all must be allowed), so a
// revoked or expired source blocks every render, variant and export built on it. Nothing here deletes or unpublishes anything:
// revocationImpact() is an inventory plus a correction plan for the owner.
import { HubError } from "../core/errors.mjs";
import { newId } from "../core/ids.mjs";
import { json, parse } from "../storage/db.mjs";

export const RIGHTS_STATUSES = Object.freeze(["PENDING", "CLEARED_FOR_SCOPE", "RESTRICTED", "EXPIRED", "REVOKED"]);
export const RIGHTS_PLATFORMS = Object.freeze(["instagram", "tiktok", "youtube", "x", "linkedin", "facebook", "website", "*"]);
export const RIGHTS_USES = Object.freeze(["organic", "paid", "case_study", "portfolio", "internal", "*"]);
const ACTIVE_RENDER = new Set(["REQUESTED", "CLAIMED", "RUNNING", "VALIDATING", "CANCEL_REQUESTED"]);
const LIVE_ATTEMPT = new Set(["UPLOADING", "PROCESSING", "DRAFT_EXTERNAL", "SCHEDULED", "PUBLISHED", "OUTCOME_UNKNOWN"]);
const MAX_DEPTH = 50;

const REASON_TEXT = {
  ORIGIN_UNKNOWN: "Originea materialului este necunoscută; nu poate intra într-un export public până nu e clarificată.",
  RIGHTS_MISSING: "Nu există niciun drept înregistrat pentru acest material.",
  RIGHTS_PENDING: "Drepturile sunt încă în așteptare (PENDING).",
  RIGHTS_REVOKED: "Dreptul de folosire a fost revocat.",
  RIGHTS_EXPIRED: "Dreptul de folosire a expirat.",
  NOT_YET_VALID: "Dreptul de folosire nu a intrat încă în vigoare.",
  PLATFORM_NOT_COVERED: "Platforma nu este acoperită de drepturile înregistrate.",
  USE_NOT_COVERED: "Tipul de folosire nu este acoperit de drepturile înregistrate.",
  RESTRICTED: "Există o restricție înregistrată pentru acest scop.",
  MARKETING_CONSENT_MISSING: "Lipsește acordul de marketing al clientului (necesar pentru folosire publică sau studiu de caz).",
  VERSION_QUARANTINED: "Fișierul este în carantină (nu a putut fi decodat).",
  VERSION_MISSING: "Fișierul lipsește din bibliotecă.",
  INPUT_MISSING: "O sursă a derivatului nu mai există în bibliotecă.",
  ASSET_MISSING: "Assetul nu există.",
  CHAIN_TOO_DEEP: "Lanțul de derivate este prea lung pentru a fi verificat.",
};
const STATUS_OF_REASON = {
  ORIGIN_UNKNOWN: "ORIGIN_UNKNOWN", RIGHTS_MISSING: "MISSING", RIGHTS_PENDING: "PENDING", RIGHTS_REVOKED: "REVOKED", RIGHTS_EXPIRED: "EXPIRED",
  NOT_YET_VALID: "NOT_YET_VALID", PLATFORM_NOT_COVERED: "OUT_OF_SCOPE", USE_NOT_COVERED: "OUT_OF_SCOPE", RESTRICTED: "RESTRICTED",
  MARKETING_CONSENT_MISSING: "CONSENT_MISSING", VERSION_QUARANTINED: "QUARANTINED", VERSION_MISSING: "MISSING", INPUT_MISSING: "MISSING",
  ASSET_MISSING: "MISSING", CHAIN_TOO_DEEP: "BLOCKED",
};
const reason = (code, assetId = null, extra = {}) => ({ code, message: REASON_TEXT[code] || code, ...(assetId ? { assetId } : {}), ...extra });

function isoOrNull(value, label) {
  if (value === undefined || value === null || value === "") return null;
  const d = new Date(value);
  if (typeof value !== "string" || Number.isNaN(d.getTime())) throw new HubError("validation", `Data „${label}” este invalidă (format ISO așteptat).`, { code: "FIELD_INVALID" });
  return d.toISOString();
}
function listOf(value, allowed, label) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 20) throw new HubError("validation", `„${label}” trebuie să fie o listă.`, { code: "FIELD_INVALID" });
  const out = [];
  for (const v of value) {
    if (!allowed.includes(v)) throw new HubError("validation", `Valoare necunoscută în „${label}”: ${String(v).slice(0, 30)}.`, { code: "FIELD_INVALID" });
    if (!out.includes(v)) out.push(v);
  }
  return out;
}
function text(value, label, max) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new HubError("validation", `„${label}” trebuie să fie text.`, { code: "FIELD_INVALID" });
  const t = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  if (t.length > max) throw new HubError("validation", `„${label}” depășește ${max} de caractere.`, { code: "FIELD_TOO_LONG" });
  return t;
}

/**
 * `createMediaRights({ db, bus, clock })`.
 */
export function createMediaRights({ db, bus, clock = () => new Date() }) {
  if (!db || !bus) throw new Error("createMediaRights requires db and bus");
  const selAsset = db.prepare("SELECT * FROM media_assets WHERE id = ?");
  const selRights = db.prepare("SELECT * FROM media_rights WHERE asset_id = ? ORDER BY recorded_at DESC, rowid DESC");
  const selRight = db.prepare("SELECT * FROM media_rights WHERE id = ?");
  const selVersion = db.prepare(`SELECT v.id, v.asset_id, v.status, v.is_original, v.derived_from_json, a.origin, a.capture_label, a.current_version
    FROM media_asset_versions v JOIN media_assets a ON a.id = v.asset_id WHERE v.id = ?`);
  const selCurrent = db.prepare("SELECT v.id FROM media_asset_versions v JOIN media_assets a ON a.id = v.asset_id AND v.version = a.current_version WHERE a.id = ?");

  const mapRight = (r) => r && ({ id: r.id, assetId: r.asset_id, status: r.status, holder: r.holder, licenseRef: r.license_ref, documentRef: r.document_ref,
    platforms: parse(r.platforms_json, []), uses: parse(r.uses_json, []), territory: r.territory, startsAt: r.starts_at, endsAt: r.ends_at,
    attribution: r.attribution, restrictions: parse(r.restrictions_json, []), marketingConsent: r.marketing_consent === 1, sourceKind: r.source_kind,
    sourceRef: r.source_ref, recordedBy: r.recorded_by, recordedAt: r.recorded_at, revokedAt: r.revoked_at, revokeReason: r.revoke_reason });

  /** Records a right for an asset (PENDING, CLEARED_FOR_SCOPE, RESTRICTED or EXPIRED; revocation goes through revoke()). */
  function record(input = {}) {
    const actor = typeof input.actor === "string" && input.actor.trim() ? input.actor.trim().slice(0, 120) : null;
    if (!actor) throw new HubError("validation", "Lipsește autorul operației (actor).", { code: "ACTOR_REQUIRED" });
    const asset = selAsset.get(String(input.assetId || ""));
    if (!asset) throw new HubError("not_found", "Assetul media nu există.", { code: "MEDIA_ASSET_MISSING" });
    const status = input.status === undefined ? "CLEARED_FOR_SCOPE" : input.status;
    if (!["PENDING", "CLEARED_FOR_SCOPE", "RESTRICTED", "EXPIRED"].includes(status)) {
      throw new HubError("validation", status === "REVOKED" ? "Revocarea se face prin acțiunea de revocare a dreptului existent." : "Stare de drepturi invalidă.", { code: "FIELD_INVALID" });
    }
    const platforms = listOf(input.platforms, RIGHTS_PLATFORMS, "platforme");
    const uses = listOf(input.uses, RIGHTS_USES, "folosiri");
    const startsAt = isoOrNull(input.startsAt, "început");
    const endsAt = isoOrNull(input.endsAt, "sfârșit");
    if (startsAt && endsAt && endsAt <= startsAt) throw new HubError("validation", "Sfârșitul dreptului trebuie să fie după început.", { code: "FIELD_INVALID" });
    const licenseRef = text(input.licenseRef, "referință licență", 500);
    const documentRef = text(input.documentRef, "document", 500);
    const sourceRef = text(input.sourceRef, "sursă", 500);
    const marketingConsent = input.marketingConsent === true;
    if (status === "CLEARED_FOR_SCOPE" && (!platforms.length || !uses.length)) throw new HubError("validation", "Un drept acordat trebuie să numească platformele și folosirile acoperite („*” = toate).", { code: "RIGHTS_SCOPE_REQUIRED" });
    if (status === "CLEARED_FOR_SCOPE" && asset.origin === "LICENSED" && !licenseRef && !documentRef) throw new HubError("validation", "Pentru un material licențiat este nevoie de referința licenței sau a documentului.", { code: "RIGHTS_EVIDENCE_REQUIRED" });
    if (marketingConsent && !documentRef && !sourceRef) throw new HubError("validation", "Acordul de marketing are nevoie de o dovadă (document sau sursă).", { code: "RIGHTS_EVIDENCE_REQUIRED" });
    const sourceKind = input.sourceKind === undefined ? "manual" : input.sourceKind;
    if (typeof sourceKind !== "string" || !/^[a-z_]{1,32}$/.test(sourceKind)) throw new HubError("validation", "Tipul sursei este invalid.", { code: "FIELD_INVALID" });
    const restrictions = input.restrictions === undefined ? [] : input.restrictions;
    if (!Array.isArray(restrictions) || restrictions.length > 20 || restrictions.some((r) => typeof r !== "string" || r.length > 300)) throw new HubError("validation", "Restricțiile trebuie să fie o listă de texte scurte.", { code: "FIELD_INVALID" });
    const id = newId("mrt");
    const at = clock().toISOString();
    bus.transaction(() => {
      db.prepare(`INSERT INTO media_rights (id, asset_id, status, holder, license_ref, document_ref, platforms_json, uses_json, territory, starts_at, ends_at, attribution,
        restrictions_json, marketing_consent, source_kind, source_ref, recorded_by, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, asset.id, status, text(input.holder, "titular", 200), licenseRef, documentRef, json(platforms), json(uses), text(input.territory, "teritoriu", 100),
          startsAt, endsAt, text(input.attribution, "atribuire", 500), json(restrictions), marketingConsent ? 1 : 0, sourceKind, sourceRef, actor, at);
      bus.append({ type: "media.rights.recorded", scopeType: "media_asset", scopeId: asset.id, source: actor,
        payload: { rightId: id, status, platforms, uses, startsAt, endsAt, marketingConsent } });
    });
    return mapRight(selRight.get(id));
  }

  /** Revokes one right (fail-safe: always allowed, idempotent). Returns the record and the impact inventory. */
  function revoke(rightId, why = "", actor = "owner") {
    const row = selRight.get(String(rightId || ""));
    if (!row) throw new HubError("not_found", "Dreptul nu există.", { code: "MEDIA_RIGHT_MISSING" });
    const who = typeof actor === "string" && actor.trim() ? actor.trim().slice(0, 120) : "owner";
    if (row.status === "REVOKED") return { right: mapRight(row), alreadyRevoked: true, impact: revocationImpact(row.asset_id) };
    const at = clock().toISOString();
    const note = text(typeof why === "string" ? why : "", "motiv", 1000);
    bus.transaction(() => {
      db.prepare("UPDATE media_rights SET status = 'REVOKED', revoked_at = ?, revoke_reason = ? WHERE id = ? AND status != 'REVOKED'").run(at, note, row.id);
      bus.append({ type: "media.rights.revoked", scopeType: "media_asset", scopeId: row.asset_id, source: who, payload: { rightId: row.id, previousStatus: row.status, reason: note } });
    });
    const impact = revocationImpact(row.asset_id);
    return { right: mapRight(selRight.get(row.id)), alreadyRevoked: false, impact };
  }

  /** `{ assetId, origin, captureLabel, active, history }`: active = not revoked and not ended at `at`. */
  function current(assetId, { at = null } = {}) {
    const asset = selAsset.get(String(assetId || ""));
    if (!asset) throw new HubError("not_found", "Assetul media nu există.", { code: "MEDIA_ASSET_MISSING" });
    const when = at ? new Date(at).toISOString() : clock().toISOString();
    const history = selRights.all(asset.id).map(mapRight);
    const active = history.filter((r) => r.status !== "REVOKED" && r.status !== "EXPIRED" && !(r.endsAt && r.endsAt <= when));
    return { assetId: asset.id, origin: asset.origin, captureLabel: asset.capture_label, active, history };
  }

  const covers = (list, value) => list.includes("*") || (value !== null && value !== undefined && list.includes(value));
  const inWindow = (r, at) => (!r.startsAt || at >= r.startsAt) && (!r.endsAt || at < r.endsAt);

  /** Rights of ONE original asset for a scope. */
  function evaluateOriginal(asset, { platform, use, at, publicUse }) {
    const records = selRights.all(asset.id).map(mapRight);
    const requiresDisclosure = asset.origin === "AI_GENERATED" || asset.capture_label === "GENERATED";
    const base = { assetId: asset.id, origin: asset.origin, requiresDisclosure };
    const restricted = records.find((r) => r.status === "RESTRICTED" && !r.revokedAt && inWindow(r, at)
      && (!r.platforms.length || covers(r.platforms, platform)) && (!r.uses.length || covers(r.uses, use)));
    if (restricted) return { ...base, allowed: false, reasons: [reason("RESTRICTED", asset.id, { rightId: restricted.id })], warnings: [] };
    if (!publicUse) {
      // Internal drafts and reviews: allowed unless the material's newest right is a revocation with nothing still granted.
      const live = records.filter((r) => r.status !== "REVOKED");
      if (records.length && !live.some((r) => r.status === "CLEARED_FOR_SCOPE") && records[0].status === "REVOKED") {
        return { ...base, allowed: false, reasons: [reason("RIGHTS_REVOKED", asset.id, { rightId: records[0].id })], warnings: [] };
      }
      const warnings = asset.origin === "UNKNOWN" ? [reason("ORIGIN_UNKNOWN", asset.id)] : [];
      return { ...base, allowed: true, reasons: [], warnings };
    }
    if (asset.origin === "UNKNOWN") return { ...base, allowed: false, reasons: [reason("ORIGIN_UNKNOWN", asset.id)], warnings: [] };
    const needsConsent = asset.origin === "CLIENT_PROVIDED" || use === "case_study";
    const cleared = records.filter((r) => r.status === "CLEARED_FOR_SCOPE" && !r.revokedAt);
    const matching = cleared.filter((r) => covers(r.platforms, platform) && covers(r.uses, use) && inWindow(r, at));
    if (matching.length) {
      if (needsConsent && !matching.some((r) => r.marketingConsent)) return { ...base, allowed: false, reasons: [reason("MARKETING_CONSENT_MISSING", asset.id)], warnings: [] };
      return { ...base, allowed: true, reasons: [], warnings: [], rightIds: matching.map((r) => r.id) };
    }
    // Not granted: explain with the most specific reason.
    let code;
    const scoped = cleared.filter((r) => covers(r.platforms, platform) && covers(r.uses, use));
    if (scoped.length) code = scoped.some((r) => r.startsAt && at < r.startsAt) && !scoped.some((r) => r.endsAt && at >= r.endsAt) ? "NOT_YET_VALID" : "RIGHTS_EXPIRED";
    else if (cleared.some((r) => covers(r.uses, use))) code = "PLATFORM_NOT_COVERED";
    else if (cleared.some((r) => covers(r.platforms, platform))) code = "USE_NOT_COVERED";
    else if (cleared.length) code = "PLATFORM_NOT_COVERED";
    else if (records.some((r) => r.status === "REVOKED")) code = "RIGHTS_REVOKED";
    else if (records.some((r) => r.status === "EXPIRED")) code = "RIGHTS_EXPIRED";
    else if (records.some((r) => r.status === "PENDING")) code = "RIGHTS_PENDING";
    else code = "RIGHTS_MISSING";
    return { ...base, allowed: false, reasons: [reason(code, asset.id)], warnings: [] };
  }

  /** Walks a version back to its originals; every original must be allowed and the derivative's own restrictions apply too. */
  function evaluateVersionInner(versionId, scope, visited, depth) {
    if (depth > MAX_DEPTH) return { allowed: false, requiresDisclosure: false, reasons: [reason("CHAIN_TOO_DEEP")], warnings: [], originals: [] };
    const v = selVersion.get(String(versionId || ""));
    if (!v) return { allowed: false, requiresDisclosure: false, reasons: [reason("INPUT_MISSING", null, { versionId })], warnings: [], originals: [] };
    if (visited.has(v.id)) return { allowed: true, requiresDisclosure: false, reasons: [], warnings: [], originals: [] };
    visited.add(v.id);
    const reasons = []; const warnings = []; const originals = [];
    let requiresDisclosure = false;
    if (v.status === "QUARANTINED") reasons.push(reason("VERSION_QUARANTINED", v.asset_id, { versionId: v.id }));
    if (v.status === "MISSING") reasons.push(reason("VERSION_MISSING", v.asset_id, { versionId: v.id }));
    const asset = selAsset.get(v.asset_id);
    if (v.is_original === 1) {
      const r = evaluateOriginal(asset, scope);
      reasons.push(...r.reasons); warnings.push(...r.warnings); originals.push(asset.id);
      requiresDisclosure = r.requiresDisclosure;
    } else {
      // The derivative's own records may restrict it further (never widen what its sources allow).
      const own = selRights.all(asset.id).map(mapRight).find((r) => r.status === "RESTRICTED" && !r.revokedAt && inWindow(r, scope.at)
        && (!r.platforms.length || covers(r.platforms, scope.platform)) && (!r.uses.length || covers(r.uses, scope.use)));
      if (own) reasons.push(reason("RESTRICTED", asset.id, { rightId: own.id }));
      if (asset.capture_label === "GENERATED" || asset.origin === "AI_GENERATED") requiresDisclosure = true;
      const inputs = parse(v.derived_from_json, []);
      if (!Array.isArray(inputs) || !inputs.length) reasons.push(reason("INPUT_MISSING", asset.id, { versionId: v.id }));
      for (const input of Array.isArray(inputs) ? inputs : []) {
        const r = evaluateVersionInner(input?.versionId, scope, visited, depth + 1);
        reasons.push(...r.reasons); warnings.push(...r.warnings); originals.push(...r.originals);
        requiresDisclosure = requiresDisclosure || r.requiresDisclosure;
      }
    }
    return { allowed: reasons.length === 0, requiresDisclosure, reasons, warnings, originals };
  }

  function normalizeScope({ platform = null, use = "organic", at = null, publicUse = true } = {}) {
    if (platform !== null && platform !== undefined && !RIGHTS_PLATFORMS.includes(platform)) throw new HubError("validation", `Platformă necunoscută: ${String(platform).slice(0, 30)}.`, { code: "FIELD_INVALID" });
    if (!RIGHTS_USES.includes(use) || use === "*") throw new HubError("validation", `Tip de folosire necunoscut: ${String(use).slice(0, 30)}.`, { code: "FIELD_INVALID" });
    const when = at ? new Date(at) : clock();
    if (Number.isNaN(when.getTime())) throw new HubError("validation", "Momentul evaluării este invalid.", { code: "FIELD_INVALID" });
    return { platform: platform || null, use, at: when.toISOString(), publicUse: publicUse !== false && use !== "internal" };
  }

  function shape(r, asset, scope) {
    const first = r.reasons[0];
    return { allowed: r.allowed, status: r.allowed ? "CLEARED_FOR_SCOPE" : STATUS_OF_REASON[first?.code] || "BLOCKED", origin: asset?.origin || null,
      requiresDisclosure: r.requiresDisclosure, reasons: dedupeReasons(r.reasons), warnings: dedupeReasons(r.warnings), originals: [...new Set(r.originals)],
      scope: { platform: scope.platform, use: scope.use, at: scope.at, publicUse: scope.publicUse } };
  }
  const dedupeReasons = (list) => {
    const seen = new Set();
    return list.filter((x) => { const k = `${x.code}:${x.assetId || ""}:${x.versionId || ""}`; if (seen.has(k)) return false; seen.add(k); return true; });
  };

  /** `{ allowed, status, origin, requiresDisclosure, reasons[], warnings[], originals[] }` for the asset's current version. */
  function evaluate({ assetId, ...rest } = {}) {
    const scope = normalizeScope(rest);
    const asset = selAsset.get(String(assetId || ""));
    if (!asset) return shape({ allowed: false, requiresDisclosure: false, reasons: [reason("ASSET_MISSING")], warnings: [], originals: [] }, null, scope);
    const cur = selCurrent.get(asset.id);
    if (!cur) return shape({ allowed: false, requiresDisclosure: false, reasons: [reason("VERSION_MISSING", asset.id)], warnings: [], originals: [] }, asset, scope);
    return shape(evaluateVersionInner(cur.id, scope, new Set(), 0), asset, scope);
  }

  /** Same evaluation for one specific version (renders and variants are evaluated by the version they use). */
  function evaluateVersion({ versionId, ...rest } = {}) {
    const scope = normalizeScope(rest);
    const v = selVersion.get(String(versionId || ""));
    const asset = v ? selAsset.get(v.asset_id) : null;
    return shape(evaluateVersionInner(versionId, scope, new Set(), 0), asset, scope);
  }

  /** Aggregate over several versions (an edit's dependencies): allowed only when every one is. */
  function evaluateAssets({ versionIds, ...rest } = {}) {
    if (!Array.isArray(versionIds) || versionIds.length > 1000) throw new HubError("validation", "Lista de versiuni este invalidă.", { code: "FIELD_INVALID" });
    const scope = normalizeScope(rest);
    const items = [...new Set(versionIds)].map((versionId) => ({ versionId, ...evaluateVersion({ versionId, ...scope }) }));
    return { allowed: items.every((i) => i.allowed), requiresDisclosure: items.some((i) => i.requiresDisclosure),
      blocking: items.filter((i) => !i.allowed).map((i) => ({ versionId: i.versionId, status: i.status, reasons: i.reasons })), items, scope };
  }

  /**
   * Everything built on an asset (transitively): derivative versions, edit versions whose IR references them, variants, render
   * jobs, manifests and release attempts — with a correction plan. Inventory only: nothing is changed or deleted.
   */
  function revocationImpact(assetId) {
    const asset = selAsset.get(String(assetId || ""));
    if (!asset) throw new HubError("not_found", "Assetul media nu există.", { code: "MEDIA_ASSET_MISSING" });
    const own = db.prepare("SELECT id FROM media_asset_versions WHERE asset_id = ?").all(asset.id).map((r) => r.id);
    const affected = new Set(own);
    const derivedRows = db.prepare(`SELECT v.id, v.asset_id, v.status, v.derived_from_json, a.category, a.title FROM media_asset_versions v
      JOIN media_assets a ON a.id = v.asset_id WHERE v.is_original = 0`).all().map((r) => ({ ...r, inputs: (parse(r.derived_from_json, []) || []).map((x) => x?.versionId).filter(Boolean) }));
    const derivatives = [];
    for (let changed = true; changed;) {
      changed = false;
      for (const r of derivedRows) {
        if (affected.has(r.id) || !r.inputs.some((id) => affected.has(id))) continue;
        affected.add(r.id); changed = true;
        derivatives.push({ versionId: r.id, assetId: r.asset_id, category: r.category, title: r.title, status: r.status });
      }
    }
    const ids = [...affected];
    const mentions = (textValue, list) => list.some((id) => textValue.includes(`"${id}"`));
    const editVersions = db.prepare(`SELECT e.id, e.edit_project_id, e.version, e.change_kind, e.ir_json, p.title FROM media_edit_versions e
      JOIN media_edit_projects p ON p.id = e.edit_project_id`).all().filter((e) => mentions(e.ir_json, ids))
      .map((e) => ({ editVersionId: e.id, editProjectId: e.edit_project_id, version: e.version, changeKind: e.change_kind, title: e.title }));
    const editIds = new Set(editVersions.map((e) => e.editVersionId));
    const variants = db.prepare("SELECT id, edit_project_id, master_version_id, platform_key, variant_version_id, status FROM media_variants").all()
      .filter((v) => editIds.has(v.master_version_id) || (v.variant_version_id && editIds.has(v.variant_version_id)))
      .map((v) => ({ variantId: v.id, platformKey: v.platform_key, status: v.status, masterVersionId: v.master_version_id, variantVersionId: v.variant_version_id }));
    const renderJobs = db.prepare("SELECT id, edit_version_id, status, profile, output_asset_version_id FROM media_render_jobs").all()
      .filter((j) => editIds.has(j.edit_version_id) || (j.output_asset_version_id && affected.has(j.output_asset_version_id)))
      .map((j) => ({ jobId: j.id, editVersionId: j.edit_version_id, status: j.status, profile: j.profile, outputVersionId: j.output_asset_version_id }));
    const refs = [...ids, ...editIds, ...variants.map((v) => v.variantId)];
    const manifests = db.prepare("SELECT id, content_project_id, status, body_json FROM content_manifests").all()
      .filter((m) => mentions(m.body_json, refs)).map((m) => ({ manifestId: m.id, contentProjectId: m.content_project_id, status: m.status }));
    const manifestIds = new Set(manifests.map((m) => m.manifestId));
    const releaseAttempts = db.prepare("SELECT id, manifest_id, platform, route, status, scheduled_for FROM content_release_attempts").all()
      .filter((a) => manifestIds.has(a.manifest_id))
      .map((a) => ({ attemptId: a.id, manifestId: a.manifest_id, platform: a.platform, route: a.route, status: a.status, scheduledFor: a.scheduled_for }));

    const plan = [];
    for (const d of derivatives) if (d.status === "READY") plan.push({ action: "replace_or_rerender", target: d.versionId, message: `Derivatul „${d.title}” (${d.category}) folosește materialul; refă-l fără el sau înlocuiește sursa.` });
    for (const e of editVersions) plan.push({ action: "replace_clip", target: e.editVersionId, message: `Înlocuiește sau scoate clipurile cu materialul din „${e.title}” v${e.version} (se creează o versiune nouă; cea veche rămâne în istoric).` });
    for (const j of renderJobs) if (ACTIVE_RENDER.has(j.status)) plan.push({ action: "cancel_render", target: j.jobId, message: `Anulează randarea ${j.jobId} (${j.status}).` });
    for (const v of variants) if (v.status !== "INVALIDATED") plan.push({ action: "invalidate_variant", target: v.variantId, message: `Varianta ${v.platformKey} trebuie refăcută.` });
    for (const m of manifests) if (m.status === "APPROVED" || m.status === "DRAFT") plan.push({ action: "invalidate_manifest", target: m.manifestId, message: `Manifestul ${m.manifestId} (${m.status}) nu mai poate fi folosit; construiește unul nou după corectare.` });
    for (const a of releaseAttempts) {
      if (LIVE_ATTEMPT.has(a.status)) plan.push({ action: "take_down_manual", target: a.attemptId, message: `Postarea de pe ${a.platform} (${a.status}) folosește materialul: retrage-o manual din platformă; Hub-ul nu șterge și nu modifică nimic extern.` });
      else if (a.status === "PACK_READY" || a.status === "PREPARED") plan.push({ action: "discard_pack", target: a.attemptId, message: `Pachetul pentru ${a.platform} nu mai trebuie folosit.` });
    }
    const out = { assetId: asset.id, generatedAt: clock().toISOString(), deletesNothing: true,
      affected: { assetVersions: own, derivatives, editVersions, variants, renderJobs, manifests, releaseAttempts },
      counts: { derivatives: derivatives.length, editVersions: editVersions.length, variants: variants.length, renderJobs: renderJobs.length, manifests: manifests.length, releaseAttempts: releaseAttempts.length },
      plan };
    return out;
  }

  return { record, revoke, current, evaluate, evaluateVersion, evaluateAssets, revocationImpact };
}
