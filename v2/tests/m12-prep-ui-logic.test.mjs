// M12 WP11 — the Opportunity screen's preparation panel and „Dosarul ofertei” list, the org sheet's q-v2 notes (pure UI logic, no DOM, no
// Hub). The status of a preparation and a dossier is always said in words; the manifest SHA is shown whole (never a prefix); the contact
// draft is DRAFT_ONLY and never sent; the Word check is said truthfully (APP_NOT_RUN is never „verified in Word”); who confirmed the plan
// is said truthfully (Windows Hello only for a WebAuthn session, a local development session never as the owner's presence). No new Sales
// tab: the eight tabs and the mobile order are the M04 ones (BR-01).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { PREPARATION_STATUS_META, DOSSIER_STATUS_META, preparationStatusMeta, dossierStatusMeta, consentAuthorityText, preparationView, dossierView, appVerificationText,
  preparationPanel, qualificationNotes, PREPARATION_CONTINUABLE, continuationOffer, continuationPath, activationWindowText, awaitedOfferLabel, COCKPIT_HREF } from "../web/src/lib/salesPrepLogic.js";
import { SALES_TABS, MOBILE_TAB_ORDER } from "../web/src/lib/salesLogic.js";
import { PREPARATION_STATUSES, DOSSIER_STATUSES } from "../server/sales/sales.mjs";
import { CONTINUABLE } from "../server/sales/preparation.mjs";
import { qualify } from "../server/sales/qualify.mjs";

const source = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const SHA = (c) => c.repeat(64);

test("M12-PREPUI-01 every preparation and dossier status has a Romanian label and a tone (the server's lists, D6); unknown ones are shown, never hidden", () => {
  assert.deepEqual(Object.keys(PREPARATION_STATUS_META).sort(), [...PREPARATION_STATUSES].sort());
  assert.deepEqual(Object.keys(DOSSIER_STATUS_META).sort(), [...DOSSIER_STATUSES].sort());
  for (const s of PREPARATION_STATUSES) { const m = preparationStatusMeta(s); assert.ok(m.label.length > 3 && m.label !== s, s); assert.ok(["neutral", "info", "approval", "ok", "warn", "error"].includes(m.tone), s); }
  for (const s of DOSSIER_STATUSES) { const m = dossierStatusMeta(s); assert.ok(m.label.length > 3 && m.label !== s, s); }
  assert.deepEqual(preparationStatusMeta("ALTCEVA"), { label: "ALTCEVA", tone: "neutral" });
  assert.deepEqual([...PREPARATION_CONTINUABLE], [...CONTINUABLE], "the continuation hint follows the server's CONTINUABLE");
});

test("M12-PREPUI-02 who confirmed the plan is said truthfully: Windows Hello only for WebAuthn; the dev profile is never the owner's presence", () => {
  assert.match(consentAuthorityText("webauthn"), /Windows Hello/);
  const dev = consentAuthorityText("local_dev_profile");
  assert.doesNotMatch(dev, /Windows Hello/);
  assert.match(dev, /sesiune locală de dezvoltare/);
  assert.match(dev, /nu dovada prezenței tale/);
  for (const a of [null, undefined, "test", "owner"]) assert.doesNotMatch(consentAuthorityText(a), /Windows Hello|confirmat de tine/);
  const p = preparationView({ id: "spp_1", status: "WAITING_OWNER", authority: "forged", awaited: { proposalId: "spr_a_1", proposalSha: SHA("a") }, decisionsLeft: ["Aprobarea ta"] });
  assert.equal(p.authority, null, "an authority the server does not name is not shown as one");
  assert.equal(p.awaitedComplete, true);
  for (const sha of ["", " ", SHA("a").slice(0, 12), SHA("A"), `${SHA("a")} `]) assert.equal(preparationView({ awaited: { proposalId: "spr_a_1", proposalSha: sha } }).awaitedComplete, false, JSON.stringify(sha));
  // Final review F10 (adapted: this asserted the status-only rule the review found to be the defect): continuable is the server's flag.
  assert.equal(preparationView({ status: "STOPPED", continuable: true }).continuable, true);
  assert.equal(preparationView({ status: "STOPPED" }).continuable, false, "without the server's flag nothing is offered");
  assert.equal(preparationView({ status: "WAITING_OWNER", continuable: true }).continuable, false);
});

test("M12-PREPUI-03 the Word check is said truthfully: APP_VERIFIED only when Word opened it; APP_NOT_RUN is a file check, never „verified in Word”; APP_FAILED is a failure", () => {
  const verified = appVerificationText({ proposalDocx: { file: "FILE_CHECKED", app: "APP_VERIFIED", appName: "Microsoft Word", appVersion: "16.0", pages: 2 } });
  assert.equal(verified.app, "APP_VERIFIED");
  assert.match(verified.label, /Deschis și verificat în Word \(Microsoft Word 16\.0, 2 pagini\)/);
  const notRun = appVerificationText({ proposalDocx: { file: "FILE_CHECKED", app: "APP_NOT_RUN", note: "Verificarea în Word nu rulează în acest mediu (fără Office)" } });
  assert.equal(notRun.app, "APP_NOT_RUN");
  assert.match(notRun.label, /APP_NOT_RUN/);
  assert.match(notRun.label, /verificat doar ca fișier, nu în Word/);
  assert.doesNotMatch(notRun.label, /Deschis și verificat în Word/);
  assert.match(notRun.file, /Fișierul Word e verificat/);
  assert.match(notRun.note, /fără Office/);
  assert.equal(appVerificationText({ proposalDocx: { file: "FILE_CHECKED", app: "APP_FAILED" } }).tone, "error");
  assert.equal(appVerificationText(null).app, null);
  assert.match(appVerificationText({}).file, /nu e verificat/);
});

test("M12-PREPUI-04 a dossier row: the FULL manifest SHA (a prefix or an uppercase one is not shown as the SHA), DRAFT_ONLY, not sent, reuse counted, a changed input said", () => {
  const raw = { id: "sdo_x_1", revision: 2, status: "READY", folderName: "revizia-2-abc", manifestSha256: SHA("b"), labels: ["SYNTHETIC_DATA", "LOCAL_ONLY", "DRAFT_ONLY"], sent: false,
    inputsCurrent: true, files: [{ path: "oferta-v1.md", sha256: SHA("c"), bytes: 10, reusedFrom: { dossierId: "sdo_x_0", revision: 1 } }, { path: "ciorna-mesaj.md", sha256: SHA("d"), bytes: 5 }],
    verification: { proposalDocx: { file: "FILE_CHECKED", app: "APP_NOT_RUN" } } };
  const d = dossierView(raw);
  assert.equal(d.manifestSha256, SHA("b"));
  assert.deepEqual([d.draftOnly, d.localOnly, d.syntheticData, d.sent], [true, true, true, false]);
  assert.equal(d.fileCount, 2);
  assert.equal(d.files.filter((f) => f.reused).length, 1);
  assert.equal(d.verification.app, "APP_NOT_RUN");
  assert.equal(d.inputsCurrent, true);
  assert.equal(dossierView({ ...raw, inputsCurrent: false }).inputsCurrent, false);
  assert.equal(dossierView({ ...raw, status: "STALE" }).inputsCurrent, null, "only a READY revision is checked against its inputs");
  for (const sha of [SHA("b").slice(0, 12), SHA("B"), "", null]) assert.equal(dossierView({ ...raw, manifestSha256: sha }).manifestSha256, "", String(sha));
  assert.equal(dossierView({ ...raw, sent: "true" }).sent, false, "only the server's own boolean");
});

test("M12-PREPUI-05 the panel: shown only with a preparation or a dossier; the newest preparation, the older ones counted; dossiers newest first", () => {
  assert.equal(preparationPanel(null).show, false);
  assert.equal(preparationPanel({ preparations: [], dossiers: [] }).show, false);
  const panel = preparationPanel({ preparations: [{ id: "spp_new", status: "READY" }, { id: "spp_old", status: "CANCELLED" }],
    dossiers: [{ id: "sdo_1", revision: 1, status: "SUPERSEDED" }, { id: "sdo_2", revision: 2, status: "READY" }] });
  assert.equal(panel.show, true);
  assert.equal(panel.current.id, "spp_new");
  assert.equal(panel.older, 1);
  assert.deepEqual(panel.dossiers.map((d) => d.revision), [2, 1]);
});

test("M12-PREPUI-06 the org sheet's q-v2 notes come from the stored qualification: inferences (no points) and „fără dovadă” items; nothing for a q-v1 row without them", () => {
  const input = { org: { id: "org_1", displayName: "Firma Sintetică SRL", fiscalCode: "9900000001", fiscalCodeValid: true, website: "https://firma-sintetica.test", domain: "firma-sintetica.test",
    city: "Cluj-Napoca", synthetic: true, contacts: [] },
    evidence: [{ id: "sev_city", claim: "city", value: "Cluj-Napoca", label: "INFERRED", sourceKind: "manual", sourceRef: "brief:spp_1#place", dataKind: "INFERENCE", basis: ["brief:spp_1#place"], reasoning: "reședința județului" }],
    audit: null, opportunities: [], catalog: [], filters: {} };
  const q2 = qualify(input, { formula: "q-v2" });
  const notes = qualificationNotes({ id: "squ_1", formulaVersion: "q-v2", result: q2 });
  assert.equal(notes.show, true);
  assert.equal(notes.formula, "q-v2");
  assert.ok(notes.inferences.length > 0, "the city backed only by an inference is listed, without points");
  assert.ok(notes.unproven.length > 0, "the name and the other fields present without evidence are listed");
  assert.ok([...notes.inferences, ...notes.unproven].every((x) => x.claim && x.why));
  assert.deepEqual(qualificationNotes({ formula_version: "q-v2", result_json: JSON.stringify(q2) }).unproven, notes.unproven, "raw SQLite columns read the same");
  const q1 = qualify(input);
  assert.equal(qualificationNotes({ formulaVersion: "q-v1", result: q1 }).show, false, "a q-v1 row has no q-v2 notes");
  assert.equal(qualificationNotes(null).show, false);
});

test("M12-PREPUI-07 static: the new components are read-only, never wired to send, carry no origin; the owner's files get one import and one mount; no new Sales tab", () => {
  for (const f of ["web/src/screens/sales/Preparation.jsx", "web/src/screens/sales/Dossier.jsx", "web/src/screens/sales/QualificationNotes.jsx"]) {
    const text = source(f);
    assert.doesNotMatch(text, /dangerouslySetInnerHTML/, f);
    assert.doesNotMatch(text, /\/send["`]|method: "POST"|useSalesCommand|api\(/, `${f} only reads`);
    assert.doesNotMatch(text, /localhost|127\.0\.0\.1|https?:\/\//, f);
  }
  assert.match(source("web/src/screens/sales/Preparation.jsx"), /\/api\/sales\/opportunities\/\$\{encodeURIComponent\(oppId\)\}\/dossiers/);
  const opp = source("web/src/screens/sales/Opportunity.jsx");
  assert.equal(opp.match(/<Preparation /g)?.length, 1, "mounted once, for phone and desktop alike");
  assert.match(opp, /import \{ Preparation \} from "\.\/Preparation\.jsx";/);
  const org = source("web/src/screens/sales/OrgSheet.jsx");
  assert.equal(org.match(/<QualificationNotes /g)?.length, 1);
  assert.equal(SALES_TABS.length, 8);
  assert.deepEqual([...MOBILE_TAB_ORDER], ["orgs", "org", "opp", "pipeline", "overview", "followups", "imports", "services"]);
  // The cockpit follows „Arată-mi oferta” to the offer's opportunity; final review C2 (this line used to pin a navigation for EVERY Sales
  // answer, which took „Ce lipsește?” away): the other answers stay in the conversation with the offer's screen as a button (M12-FA-C2).
  assert.match(source("web/src/screens/Lega.jsx"), /const salesNav = salesNavigation\(res\.results\);/);
  assert.doesNotMatch(source("web/src/screens/Lega.jsx"), /if \(r\.navigate\?\.startsWith\("\/sales"\)\) go\(r\.navigate\);/);
});

// ---------------------------------------------------------------- final review (F1/F3/F10, F21)
test("M12-PREPUI-08 (F10) the panel follows the SERVER's flags: the continuation button only when continuable and not held; „Oprește tot” still holding → the rearm first (cockpit link); never confirmed → a new request", () => {
  const p = (x) => preparationView({ id: "spp_1", ...x });
  assert.deepEqual(continuationOffer(p({ status: "STALE", continuable: true, waitsForRearm: false })).kind, "continue");
  const held = continuationOffer(p({ status: "STOPPED", continuable: true, waitsForRearm: true }));
  assert.equal(held.kind, "rearm", "a held preparation gets no button the server would refuse");
  assert.match(held.text, /Redeschide poarta/);
  assert.match(held.text, /cockpit/);
  assert.equal(COCKPIT_HREF, "#/lega");
  // R18: an EXPIRED card that was never confirmed — the server says not continuable; the panel says so instead of promising a card.
  const never = continuationOffer(p({ status: "EXPIRED", continuable: false, waitsForRearm: false }));
  assert.equal(never.kind, "new");
  assert.match(never.text, /nu a fost confirmat niciodată/);
  for (const status of ["PLANNED", "PREPARING", "WAITING_OWNER", "PACKAGING", "READY", "CANCELLED"]) assert.equal(continuationOffer(p({ status, continuable: true })).kind, null, status);
  for (const x of [held, continuationOffer(p({ status: "STALE", continuable: true }))]) assert.doesNotMatch(x.text, /din cockpit\)/, "no „din cockpit” promise without a path");
  assert.equal(preparationView({ status: "STOPPED", continuable: true, waitsForRearm: true }).waitsForRearm, true);
  assert.equal(preparationView({ status: "STOPPED", continuable: true, waitsForRearm: "true" }).waitsForRearm, false, "only the server's own boolean");
  assert.equal(continuationPath("spp_a/b"), "/api/sales/preparations/spp_a%2Fb/continue");
});

test("M12-PREPUI-09 (F1) while it waits for the owner: until when the draft and dossier follow by themselves (activateBy), said in words; nothing for another status", () => {
  const now = Date.parse("2026-10-17T10:00:00Z");
  const v = preparationView({ status: "WAITING_OWNER", activateBy: "2026-10-17T14:30:00Z" });
  assert.equal(v.activateBy, "2026-10-17T14:30:00Z");
  assert.match(activationWindowText(v, now), /în următoarele 4 h 30 min, ciorna și dosarul se fac singure/);
  assert.match(activationWindowText(v, Date.parse("2026-10-17T14:40:00Z")), /Fereastra planului confirmat a trecut/);
  assert.equal(activationWindowText(preparationView({ status: "STALE", activateBy: "2026-10-17T14:30:00Z" }), now), "");
  assert.equal(activationWindowText(preparationView({ status: "WAITING_OWNER" }), now), "");
});

test("M12-PREPUI-10 (F21) the awaited offer is named for what it is (never „Oferta așteptată” for a stale or stopped target); a non-current READY dossier is not the green „Gata”; a STALE offer has a Romanian label", async () => {
  const awaited = { proposalId: "spr_a_1", proposalSha: SHA("a") };
  assert.match(preparationView({ status: "WAITING_OWNER", awaited, awaitedCurrent: true }).awaitedLabel, /^Oferta așteptată/);
  for (const status of ["STALE", "STOPPED", "EXPIRED", "FAILED", "CANCELLED", "PREPARING"]) {
    const label = preparationView({ status, awaited, awaitedCurrent: false }).awaitedLabel;
    assert.doesNotMatch(label, /^Oferta așteptată/, status);
    assert.match(label, /depășită/, status);
  }
  assert.match(preparationView({ status: "STOPPED", awaited, awaitedCurrent: true }).awaitedLabel, /încă versiunea curentă/);
  assert.match(preparationView({ status: "WAITING_OWNER", awaited, awaitedCurrent: false }).awaitedLabel, /depășită/);
  assert.match(awaitedOfferLabel("READY", true), /aprobată/);
  assert.equal(preparationView({ status: "STALE" }).awaitedLabel, "");
  const ready = { status: "READY", manifestSha256: SHA("b"), labels: ["DRAFT_ONLY"], inputsCurrent: true };
  assert.deepEqual(dossierView(ready).display, { label: "Gata (local)", tone: "ok" });
  const stale = dossierView({ ...ready, inputsCurrent: false }).display;
  assert.notEqual(stale.tone, "ok");
  assert.match(stale.label, /Neactual/);
  assert.match(dossierView({ ...ready, status: "SUPERSEDED" }).display.label, /Înlocuit/);
  const { statusMeta, proposalApprovalReadiness } = await import("../web/src/lib/salesLogic.js");
  assert.deepEqual(statusMeta("proposal", "STALE"), { label: "Depășită: intrările s-au schimbat", tone: "warn" });
  const r = proposalApprovalReadiness({ status: "PROPOSAL_DRAFT" }, { id: "spr_a_1", version: 1, status: "STALE", sha: SHA("a"), approvedSha: null }, [{ id: "spr_a_1", version: 1, status: "STALE" }]);
  assert.match(r.reason, /depășită/);
  assert.doesNotMatch(r.reason, /stale/);
});

test("M12-PREPUI-11 (F1) static: the continuation action is its own component — one owner route through withReauth, the card confirmed on the existing plan card; the panel itself still only reads; no send, no origin", () => {
  const text = source("web/src/screens/sales/PreparationContinue.jsx");
  assert.match(text, /withReauth\(\(\) => api\(continuationPath\(p\.id\), \{ method: "POST", body: \{\} \}\)\)/);
  assert.equal(text.match(/api\(/g).length, 1, "one request: the continuation card");
  assert.match(text, /<OpsPlanCard plan=\{card\}/);
  assert.match(text, /rearmRequiredOf\(e\)/);
  assert.doesNotMatch(text, /\/send["`]|dangerouslySetInnerHTML|localhost|127\.0\.0\.1|https?:\/\//);
  assert.doesNotMatch(text, /\/approve|owner_decide/, "it never approves the offer");
  const panel = source("web/src/screens/sales/Preparation.jsx");
  assert.equal(panel.match(/<PreparationContinue /g)?.length, 1);
  assert.doesNotMatch(panel, /din cockpit\)/, "the old „(din cockpit)” promise is gone");
  assert.match(source("web/src/screens/sales/Dossier.jsx"), /d\.display \|\| dossierStatusMeta/);
});
