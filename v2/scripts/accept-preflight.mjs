import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { resolveDataLocation, MOVED_MARKER } from "../server/config.mjs";
import { gatherBundleIntegrityFacts } from "../server/factory/bundle-integrity-facts.mjs";
import { integrityDecision } from "../server/factory/bundle-integrity.mjs";
import { captureBlockers } from "../server/delivery/capture-blockers.mjs";

process.exitCode = 2;

// This is a reader, not a Hub boot. The release script owns the upgrade and its data location.
export function runPreflight({ args = process.argv.slice(2), env = process.env, locationFile, resolveLocation = resolveDataLocation } = {}) {
  process.exitCode = 2;
  let db, dbPath = null, dataLocationSource = null;
  const report = { deliveryId: null, deliveryStatus: null, bundleId: null, bundleStatus: null, missionId: null, missionStatus: null, missionStage: null,
    expectedSha: null, actualSha: null, accepted: [], unproven: [], problems: [], ok: false };
  try {
    const options = {};
    for (let i = 0; i < args.length; i += 2) {
      if (!["--delivery", "--data-dir"].includes(args[i]) || !args[i + 1]) throw new Error("Utilizare: accept-preflight.mjs --delivery <id> [--data-dir <dir>]");
      options[args[i]] = args[i + 1];
    }
    if (!options["--delivery"]) throw new Error("Lipsește --delivery");
    report.deliveryId = options["--delivery"];
    const { dataDir, source } = resolveLocation({ env, ...(locationFile === undefined ? {} : { locationFile }), overrides: options["--data-dir"] ? { dataDir: options["--data-dir"] } : {} });
    dbPath = path.resolve(dataDir, "hub-v2.sqlite"); dataLocationSource = source;
    if (source === "default") throw new Error("Locația implicită este refuzată; folosește --data-dir sau o locație configurată");
    if (fs.existsSync(path.join(dataDir, MOVED_MARKER))) throw new Error(`Datele au fost mutate: ${MOVED_MARKER}`);
    db = new DatabaseSync(dbPath, { readOnly: true });
    db.exec("PRAGMA query_only=ON");
    const d = db.prepare("SELECT * FROM deliveries WHERE id = ?").get(options["--delivery"]);
    if (!d) throw new Error("Livrarea nu există");
    Object.assign(report, { deliveryStatus: d.status, bundleId: d.bundle_id, missionId: d.mission_id });
    if (!d?.mission_id || !d.bundle_id) throw new Error("Livrarea nu are un pachet legat");
    const bundle = db.prepare("SELECT * FROM factory_bundles WHERE id = ?").get(d.bundle_id);
    const mission = db.prepare("SELECT * FROM missions WHERE id = ?").get(d.mission_id);
    const factory = db.prepare("SELECT * FROM factory_missions WHERE mission_id = ?").get(d.mission_id);
    const latest = db.prepare("SELECT id FROM factory_bundles WHERE mission_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1").get(d.mission_id);
    Object.assign(report, { bundleStatus: bundle?.status || null, missionStatus: mission?.status || null, missionStage: factory?.stage || null });
    if (!bundle || !mission || !factory) throw new Error("Pachetul sau misiunea legată nu există");
    const blockers = captureBlockers(db, { missionId: d.mission_id, projectId: mission.project_id });
    report.captureBlockers = blockers;
    const facts = gatherBundleIntegrityFacts(db, d.mission_id, { bundleId: d.bundle_id, bundleSha: d.bundle_sha });
    const decision = integrityDecision(facts);
    Object.assign(report, decision);
    const problems = [...decision.identityProblems, ...decision.protectedProblems, ...decision.historicProblems, ...decision.unproven.map(p => `${p.path}: ${p.reason}`)];
    if (d.status !== "READY") problems.push("Livrarea nu este READY");
    if (bundle.mission_id !== d.mission_id || bundle.id !== d.bundle_id || bundle.sha256 !== d.bundle_sha) problems.push("Identitatea pachetului legat nu corespunde");
    if (bundle.status !== "READY_FOR_OWNER_ACCEPTANCE") problems.push("Pachetul nu este READY_FOR_OWNER_ACCEPTANCE");
    if (latest?.id !== bundle.id) problems.push("Pachetul legat nu este ultimul pachet al misiunii");
    if (factory.stage !== "DELIVERY_READY" || mission.status === "CANCELLED") problems.push("Misiunea nu este DELIVERY_READY sau este anulată");
    if (!d.snapshot_sha || d.snapshot_sha !== decision.expectedSha || d.change_set_id && d.change_set_id !== bundle.change_set_id) problems.push("Snapshot-ul sau change set-ul livrării nu corespunde");
    if (blockers.planId || blockers.sessionId) problems.push("Captură în curs");
    Object.assign(report, { problems, ok: decision.ok && problems.length === 0 });
  } catch (error) {
    report.ok = false; report.problems.push(String(error.message));
  } finally {
    try { db?.close(); } catch (error) { report.ok = false; report.problems.push(String(error.message)); }
  }
  console.log(JSON.stringify({ dbPath, dataLocationSource, ...report, reasons: report.problems }));
  process.exitCode = report.ok ? 0 : 2;
}
try {
  const real = file => { const resolved = fs.realpathSync(file); return process.platform === "win32" ? resolved.toLowerCase() : resolved; };
  if (process.argv[1] && real(process.argv[1]) === real(fileURLToPath(import.meta.url))) runPreflight();
} catch { /* An unmatched or unreadable entry point keeps exitCode 2. */ }
