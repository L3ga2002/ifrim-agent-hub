// M11 boot guard for the logon autostart (autostart-run.ps1). The live Hub runs from this working tree, so while a milestone with a
// new migration is being built, a reboot would start the Hub on the unreleased code and apply that migration without the owner's
// approval. This check reads the live database READ-ONLY and exits 3 when the code knows a migration the database has not applied:
// the autostart then does not start the Hub and logs why. The upgrade runner (upgrade.mjs, owner-approved) never calls it.
//   node v2/scripts/boot-guard.mjs        → exit 0 (safe to start), 3 (pending migration: start through the upgrade), 1 (error)
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DATA_DIR } from "./common.mjs";
import { MIGRATIONS } from "../server/storage/migrations.mjs";

const dbPath = path.join(DATA_DIR, "hub-v2.sqlite");
const latest = MIGRATIONS.at(-1).version;
if (!fs.existsSync(dbPath)) { console.log(JSON.stringify({ ok: true, reason: "no database yet", latest })); process.exit(0); }
try {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  let applied = 0;
  try { applied = db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get()?.v || 0; } finally { db.close(); }
  const pending = MIGRATIONS.filter((m) => m.version > applied).map((m) => `${m.version}:${m.name}`);
  console.log(JSON.stringify({ ok: pending.length === 0, applied, latest, pending }));
  process.exit(pending.length ? 3 : 0);
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: error.message }));
  process.exit(1);
}
