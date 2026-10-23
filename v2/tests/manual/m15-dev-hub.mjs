// M15 (manual, development only): a synthetic acceptance hub created from zero inside .ifrim/tmp/v2-tests (never the real database or a
// copy of it), with the local development profile and fixture providers, seeded with one of each owner state the L3ga screen shows: a
// delivery READY (software package waiting), an accepted package with a support case WAITING_OWNER, a Sales preparation READY with its
// dossier, an Operations start dossier READY and a deviz WAITING_OWNER. It listens on a free port (printed) until Ctrl+C.
//   node v2/tests/manual/m15-dev-hub.mjs
import fs from "node:fs";
import path from "node:path";
import { acceptanceHub, settle, seedReady } from "../accept-helpers.mjs";
import { proposePreparation, confirmCard, approveAwaited, settlePreparation, salesCommand } from "../sales-helpers.mjs";
import { machineIdentity } from "../../server/owner/dev-profile.mjs";


const FLOW = { desk_ops_prepare: "ops_start", desk_support_prepare: "support_case", desk_finance_prepare: "finance_doc" };
const propose = (t, text, intent) => t.hub.intake.plan({ kind: "desk", text, source: "typed", args: { flow: FLOW[intent] } }, { channel: "test", actor: "test", ownerSession: null });
async function settleRecord(t, id) { for (let i = 0; i < 6; i += 1) { await settle(); await t.hub.desk.idle(id); } return t.hub.desk.get(id); }

const t = await acceptanceHub({ seedProject: true, fakeProviders: { codex: "ok", claude: "ok" }, devProfile: () => ({ enabled: true, version: 1, id: "dev_m15", ...machineIdentity() }) });
const stop = async () => { try { await t.cleanup(); } finally { process.exit(0); } };
process.on("SIGINT", stop); process.on("SIGTERM", stop);
try {
  t.exportsDir = path.join(t.root, "exports");
  t.hub.bus.transaction(() => t.hub.settings.set("mediaPolicy", { ...(t.hub.settings.get("mediaPolicy") || {}), exportsDir: t.exportsDir }, "test", "Folderul de exporturi al testului"));
  // An accepted package first (the support case reads only an accepted one), then a second one waiting for the owner.
  const first = await seedReady(t);
  t.hub.db.prepare("UPDATE factory_bundles SET status = 'OWNER_ACCEPTED' WHERE id = ?").run(first.bundleId);
  await t.authenticate({ dev: true });
  await salesCommand(t, "sales.service.save", { name: "Programări online pe site", description: "Modul de programări (sintetic).", scope: ["Pagină de programare"], exclusions: ["Plata online"],
    materials: ["Programul de lucru", "Lista serviciilor"], price: { status: "NOT_CONFIGURED" }, leadTime: { status: "NOT_CONFIGURED" }, active: true });
  const { card, preparationId } = await proposePreparation(t);
  await confirmCard(t, card);
  await approveAwaited(t, t.hub.salesPreparations.get(preparationId));
  await settlePreparation(t, preparationId);
  const ops = await propose(t, "Pregătește dosarul de pornire a proiectului din oferta aprobată", "desk_ops_prepare");
  await confirmCard(t, ops.opsPlan); await settleRecord(t, ops.opsPlan.recordId);
  const fin = await propose(t, "Pregătește devizul din oferta aprobată", "desk_finance_prepare");
  await confirmCard(t, fin.opsPlan); await settleRecord(t, fin.opsPlan.recordId);
  const sup = await propose(t, "Caz de suport pentru Accept synthetic: un client (sintetic) întreabă dacă un nume format doar din spații este acceptat?", "desk_support_prepare");
  await confirmCard(t, sup.opsPlan); await settleRecord(t, sup.opsPlan.recordId);
  await seedReady(t);
} catch (error) { console.error("seed failed:", error); }
const url = `http://localhost:${t.config.port}`;
console.log(`M15 dev hub (SINTETIC): ${url}/#/lega/${t.project.id}  root ${t.root}`);
// The tripwire refuses writes outside the synthetic root: the address is printed only.
setInterval(() => {}, 1 << 30);
