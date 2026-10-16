import fs from "node:fs";
import path from "node:path";
import { hashCanonical, sha256 } from "../core/canonical.mjs";
import { parse } from "../storage/db.mjs";
import { isSecretLikeName } from "../security/paths.mjs";
import { takeSnapshot, diffManifests, gitEntryHash } from "./snapshot.mjs";
import { retirementEvidence, historicViolations } from "./factory.mjs";

// No service construction, writes or blob store: also used by the pre-upgrade preflight.
function shaAt(root, ref) {
  try {
    if (isSecretLikeName(path.basename(ref))) return undefined;
    const file = path.resolve(root, ref), rel = path.relative(root, file);
    if (rel.startsWith("..") || path.isAbsolute(rel)) return undefined;
    let cursor = root;
    for (const part of rel.split(path.sep)) {
      cursor = path.join(cursor, part);
      let stat;
      try { stat = fs.lstatSync(cursor); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
      if (stat.isSymbolicLink()) return undefined;
    }
    return fs.statSync(file).isFile() ? sha256(fs.readFileSync(file)) : undefined;
  } catch { return undefined; }
}

export function gatherBundleIntegrityFacts(db, missionId, { bundleId, bundleSha } = {}) {
  const mission = db.prepare("SELECT * FROM missions WHERE id = ?").get(missionId);
  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(mission?.project_id);
  const f = db.prepare("SELECT * FROM factory_missions WHERE mission_id = ?").get(missionId);
  const bundle = bundleId ? db.prepare("SELECT * FROM factory_bundles WHERE id = ?").get(bundleId)
    : db.prepare("SELECT * FROM factory_bundles WHERE mission_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1").get(missionId);
  const manifest = parse(bundle?.manifest_json, {});
  const changeSet = db.prepare("SELECT * FROM factory_change_sets WHERE id = ?").get(bundle?.change_set_id || "");
  const snapshot = db.prepare("SELECT * FROM factory_snapshots WHERE id = ?").get(changeSet?.snapshot_id || "");
  const base = db.prepare("SELECT stats_json FROM factory_snapshots WHERE id = ?").get(f?.base_snapshot_id || "");
  const spec = db.prepare("SELECT * FROM factory_specs WHERE mission_id = ? AND version = ?").get(missionId, bundle?.spec_version || 0);
  const specBody = parse(spec?.spec_json, {}), protectedRecord = parse(spec?.protected_json, {});
  const originalManifest = parse(snapshot?.manifest_json, {});
  const current = takeSnapshot(project.path, { mode: base ? parse(base.stats_json, {}).mode || "walk" : null, ignore: specBody.workspace?.ignore || [] });
  const changes = diffManifests(originalManifest, current.files, { resolve: sha => gitEntryHash(project.path, sha) });
  const provenance = {}, digest = ref => shaAt(project.path, ref);
  const proof = (ref, provenanceName, kind, recordRef, sha) => { provenance[ref] = { valid: true, provenance: provenanceName, record: { kind, ref: recordRef, sha256: sha } }; };
  const rows = db.prepare("SELECT fs.* FROM factory_specs fs JOIN missions m ON m.id = fs.mission_id WHERE m.project_id = ? ORDER BY fs.created_at, fs.rowid").all(project.id);
  const writes = new Map();
  for (const row of rows) { const w = parse(row.protected_json, {}).authoring?.lastHubWrite; if (w?.path && /^[0-9a-f]{64}$/.test(w.sha || "")) writes.set(w.path, { ...w, ref: row.id }); }
  for (const [ref, w] of writes) if (/^\.ifrim-hub\/staging\/[^/]+$/.test(ref) && digest(ref) === w.sha) proof(ref, "hub_staging_write", "factory_specs", w.ref, w.sha);
  for (const row of rows) {
    const p = parse(row.protected_json, {}), s = parse(row.spec_json, {}), { journal: j, valid } = retirementEvidence(row, project);
    const ref = `.ifrim-hub/retired/${row.mission_id}/journal.json`;
    if (changes.some(c => c.path === ref)) {
      provenance[ref] = { valid: false, reason: "jurnal fără conținut valid legat de planul aprobat" };
      if (valid) {
        const event = db.prepare("SELECT * FROM events WHERE type = 'factory.retire_restored' AND scope_id = ? AND json_extract(payload_json, '$.state') IN ('repaired_after_later_retirement','restored','restore_incomplete') ORDER BY seq DESC LIMIT 1").get(row.mission_id);
        const payload = parse(event?.payload_json, {}), bytes = digest(ref);
        const baseRow = j.status === "MOVED" ? db.prepare("SELECT s.* FROM factory_snapshots s JOIN factory_missions f ON f.base_snapshot_id = s.id WHERE f.mission_id = ?").get(row.mission_id) : null;
        const baseFiles = parse(baseRow?.manifest_json, {});
        if (baseRow && hashCanonical(baseFiles) === baseRow.sha256 && baseFiles[ref]?.sha256 === bytes) proof(ref, "hub_retire_journal", "factory_snapshots", baseRow.id, bytes);
        else if (!event) provenance[ref].reason = "jurnal fără înregistrare Hub de scriere (atestarea nu dovedește scrierea)";
        else if (event.created_at <= snapshot?.created_at) provenance[ref].reason = "scrierea jurnalului nu este ulterioară snapshot-ului";
        else if (payload.sha256 !== bytes) provenance[ref].reason = "octeții jurnalului diferă de ultima scriere Hub";
        else proof(ref, "hub_retire_journal", "factory.retire_restored", String(event.seq), bytes);
      }
    }
    if (row.status !== "APPROVED") continue;
    if (p.authoring?.status === "PROTECTED" && p.files?.[p.authoring.testRef] === p.authoring.protectedSha && digest(p.authoring.testRef) === p.authoring.protectedSha)
      proof(p.authoring.testRef, "hub_test_protected", "factory_specs", row.id, p.authoring.protectedSha);
    for (const x of valid && j.status === "MOVED" ? j.items : []) {
      if (!s.supersedes?.some(r => r.testRef === x.from && r.sha256 === x.sha256) || digest(x.to) !== x.sha256) continue;
      proof(x.to, "retired_by_hub", "factory_specs", row.id, x.sha256);
      if (digest(x.from) === null) proof(x.from, "retired_by_hub", "factory_specs", row.id, x.sha256);
    }
  }
  const protectedProblems = [];
  for (const [ref, sha] of Object.entries(protectedRecord.files || {})) if (digest(ref) !== sha && !(provenance[ref]?.valid && provenance[ref].provenance === "retired_by_hub" && provenance[ref].record.sha256 === sha)) protectedProblems.push(`testul protejat ${ref} nu mai are octeții verificați`);
  return { target: { missionId, bundleId: bundleId || bundle?.id, bundleSha: bundleSha || bundle?.sha256 }, bundle, manifest, changeSet, approvedSpecVersion: f?.approved_spec_version,
    changeSetSha: hashCanonical({ snapshot: snapshot?.sha256, changes: parse(changeSet?.changes_json, []).map(c => [c.path, c.status, c.after?.sha256 || null]) }),
    spec, specBody, snapshot, originalManifest, current, changes, provenance, protectedProblems, historicProblems: historicViolations(db, project, protectedRecord, provenance) };
}
