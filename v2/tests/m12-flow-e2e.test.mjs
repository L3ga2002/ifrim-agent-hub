// M12 end to end over real HTTP (SPEC §8; S-01..S-08, owner clarifications 1–4; D15): the owner's typed sentence in the cockpit
// („pregătește o ofertă pentru un service auto din Cluj care vrea programări online”) → ONE operation-plan card → the owner confirms it once
// (software authenticator, his session) → the preparation waits for him (WAITING_OWNER) → he approves exactly the offer's id + full SHA →
// the contact draft and „Dosarul ofertei” follow, DERIVED from the same consent (no other confirmation) → the dossier is READY, Word
// APP_NOT_RUN declared (Office COM off), the manifest verified, the draft DRAFT_ONLY. Nothing is sent, contacted, won, handed off, started
// in the Factory or added to the catalog; the probe counts each decision under its true authority (WebAuthn vs the local development
// profile, never presented as the owner's presence). Plus the static guard: no M12 module imports or calls the Factory, missions, the
// hand-off, sending, an import rollback or a merge revert. Fully synthetic acceptance hubs; no model, no network.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { waitFor } from "./helpers.mjs";
import { prepHub, approveSalesHttp, countRows, SALES_REQUEST } from "./sales-helpers.mjs";
import { machineIdentity } from "../server/owner/dev-profile.mjs";
import { verifyPackageFolder } from "../server/delivery/office-executors.mjs";
import { findCommercialFigures } from "../server/sales/figures.mjs";
import { hashCanonical } from "../server/core/canonical.mjs";
import { PREPARE_KIND, DOSSIER_KIND } from "../server/sales/preparation.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const untouched = (t) => ({ sends: countRows(t, "SELECT COUNT(*) AS n FROM sales_sends"), contacts: countRows(t, "SELECT COUNT(*) AS n FROM sales_contact_events"),
  acceptances: countRows(t, "SELECT COUNT(*) AS n FROM sales_client_acceptances"), handoffs: countRows(t, "SELECT COUNT(*) AS n FROM sales_handoffs"), missions: countRows(t, "SELECT COUNT(*) AS n FROM missions"),
  factory: countRows(t, "SELECT COUNT(*) AS n FROM factory_missions"), runs: countRows(t, "SELECT COUNT(*) AS n FROM agent_runs"),
  services: hashCanonical(t.hub.db.prepare("SELECT * FROM sales_services ORDER BY rowid").all()) });

/** The whole flow over HTTP, as the owner does it; `dev`: the local development profile instead of the authenticator. */
async function ownerFlow(t, { dev = false } = {}) {
  await t.authenticate(dev ? { dev: true } : {});
  const say = async (text) => { const r = await t.request("/api/owner/intent", { body: { text, source: "typed" } }); assert.equal(r.status, 200, JSON.stringify(r.json)); return r.json; };
  // 1. The typed intent → ONE card, nothing else (no question, no other plan), nothing run.
  const intent = await say(SALES_REQUEST);
  assert.equal(intent.resolved.clarification, null);
  assert.deepEqual(intent.resolved.steps.map((s) => s.intent), ["sales_prepare"]);
  assert.equal(intent.results.length, 1);
  const card = intent.results[0].opsPlan;
  assert.ok(card?.id && card.kind === PREPARE_KIND, JSON.stringify(intent.results));
  assert.equal(card.summary.model, "fără model");
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM ops_plans"), 1);
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM sales_orgs"), 0, "nothing before the confirmation");
  // 2. The owner's one confirmation (his session; the exact nonce + hash shown).
  const confirmed = await t.request(`/api/ops/plans/${card.id}/confirm`, { body: { nonce: card.nonce, displayedHash: card.hash } });
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.json));
  // 3. „Arată-mi oferta” (HTTP): the offer it waits for — its opportunity, id, version and full SHA.
  const shown = await waitFor(async () => { const r = (await say("Arată-mi oferta")).results[0]; return r.sales?.preparationStatus === "WAITING_OWNER" ? r : null; }, 30000, 100);
  const { opportunityId, proposal } = shown.sales;
  assert.match(proposal.sha, /^[0-9a-f]{64}$/);
  const read1 = await t.request(`/api/sales/opportunities/${opportunityId}/dossiers`, { method: "GET" });
  assert.equal(read1.status, 200);
  assert.equal(read1.json.preparations[0].status, "WAITING_OWNER");
  assert.deepEqual(read1.json.preparations[0].awaited, { proposalId: proposal.id, proposalSha: proposal.sha });
  assert.equal(read1.json.dossiers.length, 0);
  const opp1 = await t.request(`/api/sales/opportunities/${opportunityId}`, { method: "GET" });
  assert.equal(opp1.json.opportunity.status, "READY_FOR_OWNER_REVIEW");
  assert.equal(opp1.json.proposals[0].contentSha, proposal.sha);
  assert.equal(opp1.json.proposals[0].approvedSha, null, "confirming the plan never approved the offer");
  assert.equal(opp1.json.opportunity.synthetic, true);
  // 4. The owner approves exactly this id + full SHA (request → owner_decide → execute, his session).
  const consents = countRows(t, "SELECT COUNT(*) AS n FROM events WHERE type = 'ops.plan.consent'");
  const approved = await approveSalesHttp(t, { route: `/api/sales/proposals/${proposal.id}/approve`, body: { displayedSha: proposal.sha } });
  assert.equal(approved.status, 200, JSON.stringify(approved.json));
  // 5. Phase B follows by itself (derived; no second confirmation) to a READY dossier — read over HTTP.
  const read2 = await waitFor(async () => { const r = await t.request(`/api/sales/opportunities/${opportunityId}/dossiers`, { method: "GET" }); return r.json.preparations[0]?.status === "READY" ? r.json : null; }, 60000, 200);
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM events WHERE type = 'ops.plan.consent'"), consents, "no other confirmation");
  const phaseB = t.hub.db.prepare("SELECT id FROM ops_plans WHERE kind = ?").all(DOSSIER_KIND);
  assert.equal(phaseB.length, 1);
  assert.equal(t.hub.opsPlans.view(phaseB[0].id).consent.modality, "derived");
  return { card, opportunityId, proposal, read2 };
}

/** The READY dossier, verified on disk: the manifest's own SHA, every file's SHA, APP_NOT_RUN declared, the draft DRAFT_ONLY. */
function verifyDossier(t, d) {
  assert.equal(d.status, "READY");
  assert.equal(d.inputsCurrent, true);
  assert.deepEqual([d.verification.proposalDocx.file, d.verification.proposalDocx.app], ["FILE_CHECKED", "APP_NOT_RUN"]);
  assert.deepEqual(d.labels, ["SYNTHETIC_DATA", "LOCAL_ONLY", "DRAFT_ONLY"]);
  assert.equal(d.sent, false);
  assert.equal(sha256(fs.readFileSync(path.join(d.folder, "manifest.json"))), d.manifestSha256, "the manifest is the one recorded");
  const check = verifyPackageFolder(d.folder);
  assert.equal(check.ok, true, check.problems.join("; "));
  const manifest = JSON.parse(fs.readFileSync(path.join(d.folder, "manifest.json"), "utf8"));
  for (const f of manifest.files) assert.equal(sha256(fs.readFileSync(path.join(d.folder, f.path))), f.sha256, f.path);
  assert.deepEqual([manifest.sent, manifest.published, manifest.spent, manifest.synthetic], [false, false, false, true]);
  const draft = fs.readFileSync(path.join(d.folder, "ciorna-mesaj.md"), "utf8");
  assert.match(draft, /DRAFT_ONLY/);
  assert.match(draft, /sent: false/);
  const offer = fs.readFileSync(path.join(d.folder, "oferta-v1.md"), "utf8");
  assert.match(offer, /De stabilit \(neconfigurat\)/);
  assert.deepEqual(findCommercialFigures(offer.split("## Proveniență")[0]), [], "no invented amount, term or ROI");
  assert.match(offer, /programări online/, "„Ce s-a cerut”: the owner's own words");
  assert.ok(!path.relative(t.root, d.folder).startsWith(".."), "inside the test root");
}

test("M12-E2E-01 typed intent → ONE card → confirmed once (WebAuthn) → WAITING_OWNER → the owner approves id + full SHA → derived draft + dossier READY (APP_NOT_RUN); nothing sent, no Factory, catalog unchanged; the probe counts webauthn", async (c) => {
  const t = await prepHub(c);
  const seq = t.hub.bus.lastSeq();
  const before = untouched(t);
  const { opportunityId, proposal, read2 } = await ownerFlow(t);
  verifyDossier(t, read2.dossiers[0]);
  const opp = (await t.request(`/api/sales/opportunities/${opportunityId}`, { method: "GET" })).json;
  assert.equal(opp.opportunity.status, "APPROVED_INTERNAL");
  assert.deepEqual([opp.proposals[0].id, opp.proposals[0].status, opp.proposals[0].approvedSha], [proposal.id, "APPROVED_INTERNAL", proposal.sha]);
  assert.deepEqual(opp.drafts.map((d) => d.status), ["DRAFT"]);
  // S-08 / clarification 4: 0 sends, 0 CONTACTED / WON, 0 hand-offs, 0 missions, no Factory, no model, the catalog unchanged.
  assert.deepEqual(untouched(t), before);
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM sales_opportunities WHERE status IN ('CONTACTED','IN_DISCUSSION','WON')"), 0);
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM events WHERE seq > ? AND (type LIKE 'factory.%' OR type LIKE 'mission.%' OR type = 'sales.handoff.created' OR type = 'sales.draft.send')", seq), 0);
  // The decision is the owner's, recorded truthfully: the approval event names the owner session and WebAuthn.
  const decided = t.hub.db.prepare("SELECT payload_json FROM events WHERE type = 'sales.proposal.approved'").all().map((r) => JSON.parse(r.payload_json));
  assert.deepEqual(decided.map((p) => [p.proposalId, p.contentSha, p.decidedVia, p.authority]), [[proposal.id, proposal.sha, "owner_session", "webauthn"]]);
  // D15: the probe counts the owner_decide and the plan consent under their authority (additive; nothing else changes).
  const probe = await t.request(`/api/owner/probe?sinceSeq=${seq}`, { method: "GET" });
  assert.equal(probe.status, 200, JSON.stringify(probe.json));
  const by = probe.json.breakdown.decisionsByAuthority;
  assert.deepEqual(by.ownerDecide, { webauthn: 1, local_dev_profile: 0, test: 0, other: 0 });
  assert.deepEqual(by.planConsent, { webauthn: 1, local_dev_profile: 0, other: 0 });
  assert.match(by.note, /nu dovada prezenței proprietarului/);
  assert.equal(probe.json.counters.planConfirmations, 1, "one plan confirmation (the derived phase B adds none)");
  t.assertPaths();
});

test("M12-E2E-02 the same flow under the local development profile: allowed and recorded as local_dev_profile everywhere — never counted or labelled as WebAuthn", async (c) => {
  const profile = { enabled: true, version: 1, id: "dev_m12e2e", ...machineIdentity() };
  const t = await prepHub(c, { devProfile: () => profile });
  const seq = t.hub.bus.lastSeq();
  const { read2 } = await ownerFlow(t, { dev: true });
  verifyDossier(t, read2.dossiers[0]);
  assert.equal(read2.preparations[0].authority, "local_dev_profile");
  const decided = t.hub.db.prepare("SELECT payload_json FROM events WHERE type = 'sales.proposal.approved'").all().map((r) => JSON.parse(r.payload_json));
  assert.deepEqual(decided.map((p) => [p.decidedVia, p.authority]), [["owner_session", "local_dev_profile"]]);
  const by = (await t.request(`/api/owner/probe?sinceSeq=${seq}`, { method: "GET" })).json.breakdown.decisionsByAuthority;
  assert.deepEqual(by.ownerDecide, { webauthn: 0, local_dev_profile: 1, test: 0, other: 0 });
  assert.deepEqual(by.planConsent, { webauthn: 0, local_dev_profile: 1, other: 0 });
  assert.equal(countRows(t, "SELECT COUNT(*) AS n FROM sales_sends"), 0);
});

test("M12-E2E-03 static guard: no M12 module imports or calls the Factory, missions, the hand-off, sending, an import rollback or a merge revert", () => {
  const server = path.join(here, "..", "server");
  const code = (rel) => fs.readFileSync(path.join(server, rel), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/(^|\s)\/\/.*$/, "")).join("\n");
  const modules = ["sales/brief.mjs", "sales/figures.mjs", "sales/plan-ledger.mjs", "sales/preparation.mjs", "sales/plan-executors.mjs", "sales/dossier.mjs", "sales/sales-answers.mjs", "owner/planners/sales.mjs"];
  const forbidden = [/from\s+["'][^"']*(?:factory|missions|handoff)[^"']*["']/, /\bfactory\b/i, /\bcreateMission\b/, /\bmissions\.(?:create|start)\b/, /["'`]sales\.handoff\.create["'`]/, /\bbuildHandoffPackage\b/,
    /\brecordHandoff\b/, /\bsendDraft\b/, /["'`]sales\.draft\.send["'`]/, /["'`]sales\.import\.rollback["'`]/, /\brollback\s*\(/, /["'`]sales\.merge\.revert["'`]/, /\brevertMerge\b/, /["'`]sales\.org\.merge["'`]/, /\bmergeOrgs\b/,
    /["'`](?:factory|mission)\.[a-z_.]+["'`]/];
  for (const rel of modules) {
    const text = code(rel);
    for (const re of forbidden) assert.equal(re.test(text), false, `${rel}: ${re}`);
  }
  // The state-contract table (data) names these writers only to say they are never the flow's: it imports nothing.
  assert.doesNotMatch(code("sales/state-contracts.mjs"), /^\s*import\s/m);
  // The UI pieces of M12 only read (no send endpoint, no POST).
  for (const rel of ["../web/src/screens/sales/Preparation.jsx", "../web/src/screens/sales/Dossier.jsx", "../web/src/screens/sales/QualificationNotes.jsx", "../web/src/lib/salesPrepLogic.js"]) {
    assert.doesNotMatch(code(rel), /\/send["`]|method:\s*"POST"|handoff|factory/i, rel);
  }
});
