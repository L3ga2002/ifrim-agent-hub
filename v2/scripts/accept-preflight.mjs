import { pathToFileURL } from "node:url";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { resolveDataLocation, MOVED_MARKER } from "../server/config.mjs";
import { gatherBundleIntegrityFacts } from "../server/factory/bundle-integrity-facts.mjs";
import { integrityDecision } from "../server/factory/bundle-integrity.mjs";

// This is a reader, not a Hub boot. The release script owns the upgrade and its data location.
export function runPreflight({ args = process.argv.slice(2), env = process.env, locationFile } = {}) {
  let db, dbPath = null, dataLocationSource = null;
  try {
    const options = {};
    for (let i = 0; i < args.length; i += 2) {
      if (!["--delivery", "--data-dir"].includes(args[i]) || !args[i + 1]) throw new Error("Utilizare: accept-preflight.mjs --delivery <id> [--data-dir <dir>]");
      options[args[i]] = args[i + 1];
    }
    if (!options["--delivery"]) throw new Error("Lipsește --delivery");
    const { dataDir, source } = resolveDataLocation({ env, ...(locationFile === undefined ? {} : { locationFile }), overrides: options["--data-dir"] ? { dataDir: options["--data-dir"] } : {} });
    dbPath = path.resolve(dataDir, "hub-v2.sqlite"); dataLocationSource = source;
    if (source === "default") throw new Error("Locația implicită este refuzată; folosește --data-dir sau o locație configurată");
    if (fs.existsSync(path.join(dataDir, MOVED_MARKER))) throw new Error(`Datele au fost mutate: ${MOVED_MARKER}`);
    db = new DatabaseSync(dbPath, { readOnly: true });
    db.exec("PRAGMA query_only=ON");
    const d = db.prepare("SELECT * FROM deliveries WHERE id = ?").get(options["--delivery"]);
    if (!d?.mission_id || !d.bundle_id) throw new Error("Livrarea nu are un pachet legat");
    const facts = gatherBundleIntegrityFacts(db, d.mission_id, { bundleId: d.bundle_id, bundleSha: d.bundle_sha });
    const decision = integrityDecision(facts);
    const ready = facts.bundle?.status === "READY_FOR_OWNER_ACCEPTANCE";
    const reasons = [...decision.identityProblems, ...decision.protectedProblems, ...decision.historicProblems,
      ...decision.unproven.map(p => `${p.path}: ${p.reason}`), ...(ready ? [] : ["Pachetul nu este READY_FOR_OWNER_ACCEPTANCE"])];
    console.log(JSON.stringify({ dbPath, dataLocationSource, ...decision, bundleStatus: facts.bundle?.status || null, reasons }, null, 2));
    process.exitCode = decision.ok && ready ? 0 : 2;
  } catch (error) {
    console.log(JSON.stringify({ dbPath, dataLocationSource, ok: false, reasons: [String(error.message)] }));
    process.exitCode = 2;
  } finally { db?.close(); }

}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) runPreflight();
