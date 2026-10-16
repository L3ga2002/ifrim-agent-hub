import { hashCanonical } from "../core/canonical.mjs";

/** One read-only decision; raw snapshot hashes remain evidence, not a normalized replacement snapshot. */
export function integrityDecision(facts) {
  const { bundle: b, manifest: m, changeSet: cs, spec, snapshot, current, target } = facts;
  const identityProblems = [];
  if (!b || b.id !== target.bundleId || b.mission_id !== target.missionId || b.sha256 !== target.bundleSha) identityProblems.push("bundle_target");
  if (!b || hashCanonical(m) !== b.sha256) identityProblems.push("bundle_manifest_sha");
  if (!cs || cs.mission_id !== target.missionId || cs.status !== "CURRENT" || b?.change_set_id !== cs.id || b?.change_set_sha !== cs.sha256
    || m?.changeSet?.id !== cs.id || m?.changeSet?.sha256 !== cs.sha256 || facts.changeSetSha !== cs.sha256) identityProblems.push("change_set_identity");
  if (!spec || spec.status !== "APPROVED" || spec.mission_id !== target.missionId || hashCanonical(facts.specBody) !== spec.sha256
    || m?.spec?.sha256 !== spec.sha256 || b?.spec_version !== spec.version || facts.approvedSpecVersion !== spec.version) identityProblems.push("approved_spec_chain");
  if (!snapshot || snapshot.mission_id !== target.missionId || hashCanonical(facts.originalManifest) !== snapshot.sha256
    || m?.changeSet?.snapshot !== snapshot.sha256) identityProblems.push("snapshot_identity");
  const changed = facts.changes.map(({ path, status }) => ({ path, status }));
  const accepted = [], unproven = [];
  for (const change of changed) {
    const proof = facts.provenance[change.path];
    if (proof?.valid && proof.record?.sha256) accepted.push({ path: change.path, provenance: proof.provenance, record: proof.record });
    else unproven.push({ path: change.path, reason: proof?.reason || "fără proveniență Hub pentru octeții curenți" });
  }
  const protectedProblems = facts.protectedProblems || [], historicProblems = facts.historicProblems || [];
  const record = { ok: !identityProblems.length && !unproven.length && !protectedProblems.length && !historicProblems.length,
    identityProblems, expectedSha: snapshot?.sha256 || null, actualSha: current.sha256, changed, accepted, unproven,
    protectedProblems, historicProblems, hubOnlyScope: unproven.every(({ path }) => path.startsWith(".ifrim-hub/")) };
  return { ...record, decisionSha: hashCanonical(record) };
}
