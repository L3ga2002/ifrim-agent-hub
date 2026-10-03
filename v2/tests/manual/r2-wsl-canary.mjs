// R2 canary for the ifrim-runner WSL2 distro (M04_R2_ISOLATION_OPTIONS.md §6, M05 §23). Run from the Hub root:
//   node v2/tests/manual/r2-wsl-canary.mjs [--no-restart]
// Same code as the Hub attestation (v2/server/environments/canary.mjs): C1–C13 in the distro (scripts/canary.sh), C14 the
// export validator on real archives from the distro, C15 restart + C1–C4 again, C16 the account through the environment's own
// client (initialize, account/read, rate limits, permission profiles, model/list — no thread, no turn), C17 token search.
// Fictive data only; real credentials are never read. Uses a throwaway database under .ifrim/tmp (the live Hub is untouched;
// to record an attestation in the Hub, use Sistem → Medii → "Rulează atestarea" or POST /api/environments/wsl-runner/attest).
import fs from "node:fs";
import path from "node:path";
import { loadConfig, HUB_ROOT } from "../../server/config.mjs";
import { openDatabase } from "../../server/storage/db.mjs";
import { createEventBus } from "../../server/events/bus.mjs";
import { createProviderState } from "../../server/domain/grants.mjs";
import { createSupervisor } from "../../server/runtime/supervisor.mjs";
import { createWslRunnerEnvironment, attestationStatusOf } from "../../server/environments/wsl-runner.mjs";
import { runCanary, CANARY_VERSION } from "../../server/environments/canary.mjs";
import { exerciseExportValidator } from "../../server/environments/c14.mjs";

const allowRestart = !process.argv.includes("--no-restart");
const base = path.join(HUB_ROOT, ".ifrim", "tmp", `r2-canary-${Date.now().toString(36)}`);
const config = loadConfig({ dataDir: path.join(base, "data"), workDir: path.join(base, "work"), port: 18998 });
const db = openDatabase(config.dbPath);
const clock = () => new Date();
const bus = createEventBus(db, clock);
const providerState = createProviderState({ db, clock });
const supervisor = createSupervisor({ config });
const svc = createWslRunnerEnvironment({ config, db, bus, clock, providerState, supervisor, homeDir: base });
const started = Date.now();
try {
  const before = await svc.inspect();
  if (!before.installed) throw new Error(before.error || "ifrim-runner is not available");
  console.log(`INSPECT ok=${before.ok} fingerprint=${before.fingerprint.hash} (${before.durationMs} ms)`);
  for (const p of before.problems || []) console.log(`  ${p.blocking ? "BLOCK" : "warn"} ${p.code}: ${p.detail}`);
  const result = await runCanary({ config, env: svc.env, allowRestart: () => allowRestart,
    c14: () => exerciseExportValidator({ service: svc, workDir: path.join(base, "work") }),
    c16: async () => (await svc.probeAccount()).c16 });
  const after = await svc.inspect();
  for (const l of result.lines) console.log(`${l.sub} ${l.status} ${l.detail}`);
  for (const i of result.info) console.log(i);
  console.log(`FINGERPRINT ${result.fingerprintLine}`);
  console.log(`FINGERPRINT-HASH before=${before.fingerprint.hash} after=${after.fingerprint?.hash}`);
  const { status, summary, stages, notRun } = attestationStatusOf({ canary: result, before, after, simulated: svc.simulated });
  console.log(`BY-ID ${Object.entries(result.byId).map(([k, v]) => `${k}=${v}`).join(" ")}`);
  console.log(`STAGES ${stages.join(",") || "none"} (preview C18, E2E C19, review C20 are optional coverage; voice runs on Windows by design)`);
  console.log(`SUMMARY ${status} · ${summary} · canary ${CANARY_VERSION} · ${result.lines.length} checks · ${result.failed} failed${notRun.length ? ` · not run: ${notRun.join(",")}` : ""} · ${Math.round((Date.now() - started) / 1000)} s · fictive data removed · local only, not recorded in the Hub, not PASS_LIVE`);
} finally {
  await supervisor.stopAll();
  db.close();
  fs.rmSync(base, { recursive: true, force: true });
}
