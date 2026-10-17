// M12 manual check (not part of the suite: the v2/tests/*.test.mjs glob never reaches v2/tests/manual) — „Dosarul ofertei” verified in
// Word itself. ONE synthetic TEST hub (test mode, its own folder under .ifrim/tmp/v2-tests, fake providers, no model, never port 8011,
// never the owner's data), one preparation card confirmed in the owner session (the software test authenticator), the owner's approval
// of the exact offer (request → owner_decide → execute), then the derived draft + dossier with HUB_V2_OFFICE_COM=1: Word opens the
// generated .docx read-only in its OWN invisible instance, the Hub compares its headings and lists, Word exports a PDF into the Hub's work
// folder and the bytes are copied exclusively into the dossier → APP_VERIFIED. Prints one JSON report; exit 0 only for APP_VERIFIED.
//   set HUB_V2_OFFICE_COM=1 && node v2/tests/manual/m12-dossier-word.mjs
import fs from "node:fs";
import path from "node:path";
import { makeTestHub, enrolOwner, tempDir, waitFor } from "../helpers.mjs";
import { verifyPackageFolder } from "../../server/delivery/office-executors.mjs";
import { officeExe } from "../../server/office/office.mjs";

const REQUEST = "pregătește o ofertă pentru un service auto din Cluj care vrea programări online";
if (process.env.HUB_V2_OFFICE_COM !== "1") {
  console.error("Setează HUB_V2_OFFICE_COM=1: verificarea în Word rulează doar explicit (manual), niciodată în suita de teste.");
  process.exit(2);
}
const started = Date.now();
const t = await makeTestHub();
const exportsDir = tempDir("m12-word-exports");
let report = { result: "APP_NOT_RUN", word: officeExe("docx") ? "instalat (App Paths)" : "absent", exportsDir };
try {
  if (t.config.port === 8011) throw new Error("portul 8011 e al Hub-ului live");
  const owner = await enrolOwner(t);
  t.hub.bus.transaction(() => t.hub.settings.set("mediaPolicy", { ...(t.hub.settings.get("mediaPolicy") || {}), exportsDir }, "manual", "Folderul de exporturi al verificării manuale"));
  const actor = `owner:${owner.session.id}`;
  const as = (type, payload, session = owner.session) => t.hub.commands.dispatch({ type, payload, channel: "owner", actor, ownerSession: session });
  const planned = await t.hub.intake.plan({ kind: "sales", text: REQUEST, source: "typed" }, { channel: "test", actor: "manual" });
  const card = planned.opsPlan;
  if (!card?.id) throw new Error(`cardul nu a fost propus: ${JSON.stringify(planned).slice(0, 300)}`);
  await as("ops.plan.confirm", { planId: card.id, nonce: card.nonce, displayedHash: card.hash });
  await t.hub.opsPlans.idle(card.id);
  const prep = t.hub.salesPreparations.get(card.preparationId);
  if (prep.status !== "WAITING_OWNER") throw new Error(`pregătirea e ${prep.status}: ${prep.statusReason}`);
  // The owner's own decision on the exact offer (reserved kind, owner session), then its execution.
  const requested = await as("sales.proposal.approve", { proposalId: prep.awaited.proposalId, displayedSha: prep.awaited.proposalSha });
  await as("approval.owner_decide", { approvalId: requested.approval.id, decision: "approved", displayedHash: requested.approval.payloadHash }, owner.reauth());
  await t.hub.commands.executeApproved(requested.command.id, actor, { ownerSession: owner.session });
  const done = await waitFor(() => { const p = t.hub.salesPreparations.get(prep.id); return ["READY", "FAILED", "STALE", "STOPPED", "EXPIRED"].includes(p.status) ? p : null; }, 600000, 500);
  await t.hub.salesPreparations.idle(prep.id);
  const d = t.hub.salesPreparations.forOpportunity(prep.opportunityId).dossiers[0] || null;
  const v = d?.verification?.proposalDocx || null;
  const pdf = v?.pdf && d ? path.join(d.folder, v.pdf) : null;
  report = { result: v?.app || "APP_NOT_RUN", word: report.word, preparation: { status: done.status, reason: done.statusReason },
    dossier: d && { id: d.id, revision: d.revision, status: d.status, folder: d.folder, manifestSha256: d.manifestSha256, files: d.files.map((f) => `${f.path} ${f.sha256.slice(0, 16)}`) },
    verification: v, pdf: pdf && fs.existsSync(pdf) ? { file: pdf, bytes: fs.statSync(pdf).size } : null, selfCheck: d ? verifyPackageFolder(d.folder) : null,
    sent: false, models: t.hub.db.prepare("SELECT COUNT(*) AS n FROM agent_runs").get().n, durationMs: Date.now() - started };
} catch (error) {
  report = { ...report, result: report.result || "APP_NOT_RUN", error: String(error?.message || error).slice(0, 500), durationMs: Date.now() - started };
} finally {
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.result === "APP_VERIFIED" && report.selfCheck?.ok ? 0 : 1;
  // The synthetic hub's data folder goes; the exports folder (the dossier and its PDF) stays under .ifrim/tmp as evidence.
  await t.cleanup();
}
