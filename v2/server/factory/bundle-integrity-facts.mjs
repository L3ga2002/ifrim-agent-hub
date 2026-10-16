import fs from "node:fs";
import path from "node:path";
import { hashCanonical, sha256 } from "../core/canonical.mjs";
import { parse } from "../storage/db.mjs";
import { isSecretLikeName } from "../security/paths.mjs";
import { takeSnapshot, diffManifests, gitEntryHash } from "./snapshot.mjs";
import { readRetireJournal, retirementPlan } from "./factory.mjs";

// No service construction, writes or blob store: also used by the pre-upgrade preflight.
function shaAt(root, ref) {
  try {
    if (isSecretLikeName(path.basename(ref))) return null;
    const file = path.resolve(root, ref), rel = path.relative(root, file);
    if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
    let cursor = root;
    for (const part of rel.split(path.sep)) { cursor = path.join(cursor, part); if (fs.lstatSync(cursor).isSymbolicLink()) return null; }
    return fs.statSync(file).isFile() ? sha256(fs.readFileSync(file)) : null;
  } catch { return null; }
}

export function gatherHistoricProblems(db, project, protectedRecord) {
  const h = protectedRecord?.historic || {}, out = [];
  const digest = (ref) => shaAt(project.path, ref);
  const restored = (r) => {
    const missionId = r.retiredBy || r.to?.split("/")[2], j = readRetireJournal(project, missionId);
    const match = (x) => x.from === r.from && x.to === r.to && x.sha256 === r.sha256;
    const recorded = db.prepare("SELECT protected_json FROM factory_specs WHERE mission_id = ?").all(missionId)
      .some(row => (parse(row.protected_json, {}).restored || []).some(match));
    return (recorded || j?.status === "RESTORED" && j.items.some(match)) && digest(r.from) === r.sha256;
  };
  for (const a of h.active || []) if (digest(a.ref) !== a.sha256) out.push(`testul Hub anterior ${a.ref} (misiunea ${a.missionId}) a fost ${digest(a.ref) === null ? "șters" : "modificat"}`);
  const retired = (h.retired || []).filter(r => !restored(r));
  for (const r of retired) {
    if (digest(r.to) !== r.sha256) out.push(`copia retrasă ${r.to} a fost ${digest(r.to) === null ? "ștearsă" : "modificată"}`);
    if (digest(r.from) !== null) out.push(`testul retras ${r.from} a fost recreat`);
  }
  if (retired.length) {
    const folder = path.join(project.path, "test/hub");
    let names = [];
    try { if (!fs.lstatSync(folder).isSymbolicLink() && fs.realpathSync(folder).toLowerCase() === folder.toLowerCase()) names = fs.readdirSync(folder); } catch { /* no suite */ }
    for (const name of names.filter(n => /\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(n)).slice(0, 200)) {
      const ref = `test/hub/${name}`, r = retired.find(r => r.sha256 === digest(ref));
      if (r && ref.toLowerCase() !== r.from.toLowerCase()) out.push(`octeții testului retras ${r.from} au reapărut ca ${ref}`);
    }
  }
  return out;
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
    const p = parse(row.protected_json, {}), s = parse(row.spec_json, {}), j = readRetireJournal(project, row.mission_id);
    const plan = retirementPlan(row.mission_id, s), ref = `.ifrim-hub/retired/${row.mission_id}/journal.json`;
    const matches = (x, r) => x.from === r.from && x.to === r.to && x.sha256 === r.sha256;
    const samePlan = items => Array.isArray(items) && items.length === plan.length && plan.every(r => items.some(x => matches(x, r)));
    const recorded = (records, r) => (records || []).some(x => matches(x, r) && (x.cycle || 1) === (j?.cycle || 1));
    const valid = j && row.status === "APPROVED" && samePlan(j.items) && (!p.pendingRetire || samePlan(p.pendingRetire))
      && (j.status === "MOVED" ? plan.every(r => recorded(p.retired, r) && !recorded(p.restored, r)) : j.status === "RESTORED" && plan.every(r => recorded(p.restored, r)));
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
  for (const [ref, sha] of Object.entries(protectedRecord.files || {})) if (digest(ref) !== sha) protectedProblems.push(`testul protejat ${ref} nu mai are octeții verificați`);
  return { target: { missionId, bundleId: bundleId || bundle?.id, bundleSha: bundleSha || bundle?.sha256 }, bundle, manifest, changeSet, approvedSpecVersion: f?.approved_spec_version,
    changeSetSha: hashCanonical({ snapshot: snapshot?.sha256, changes: parse(changeSet?.changes_json, []).map(c => [c.path, c.status, c.after?.sha256 || null]) }),
    spec, specBody, snapshot, originalManifest, current, changes, provenance, protectedProblems, historicProblems: gatherHistoricProblems(db, project, protectedRecord) };
}
