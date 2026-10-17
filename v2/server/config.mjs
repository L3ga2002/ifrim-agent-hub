import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const V2_ROOT = path.resolve(here, "..");
export const HUB_ROOT = path.resolve(V2_ROOT, "..");
export const PROJECTS_ROOT = path.resolve(HUB_ROOT, "..");

export const HUB_VERSION = "2.15.0-m12"; // M12 Sales (in this code: the owner's decisions and the preparation building blocks): internal offer approval as a reserved owner decision (decided only in the owner session, exact id + full sha down to the service, session re-read, same credential, revoke-all boundary, compare-and-swap in the final transaction, one decision on repeats, a decision refused for good retired) and the qualification override bound to the displayed row; schema 13 (migration 13 m12-sales-prep, additive: evidence data kinds FIXTURE / STATEMENT / INFERENCE, the preparation, its C-01 operation ledger and the dossier); q-v2 qualification (inferences listed, never scored), the brief-v1 parser and the commercial-figures gate for preparation-bound offers; the Sales preparation as ONE confirmed operation plan (sales.prepare: synthetic client, fixture research, q-v2, the offer up to the owner's review — never approved by the plan) whose contact draft and „Dosarul ofertei” (sales.dossier) are DERIVED from that consent after the owner's own approval of the exact offer id + sha, a preparation-bound offer STALE when its inputs change, and the ops-plan expiry counted from the confirmation (D11); the owner’s offer words in the cockpit and in Lega (prepare = one card, show, what is missing, „aprobă oferta” only explained, send / contact / publish refused with OUTREACH_DISABLED on every path), the preparation and „Dosarul ofertei” on the Opportunity screen, the q-v2 notes on the org sheet, real / synthetic split counts and the probe per authority. 2.14.19: owner acceptance binds the displayed bundle; accept and delivery share byte-proven integrity (schema 12).
// 2.14.17 (M11 part A, schema 12, additive contract 13): frozen presentations bind claims to criterion fingerprints and per-method proof, with factual QA and capture/revision/lineage fixes. 2.14.15: dedicated step-0 author turn limit and admission/turn deadline parity evidence. 2.14.14: bounded step-0 author output limit and terminal output_token_limit evidence. 2.14.13 (M11, no migration, contract 13): R-DATASET fixes synthetic witness facts to baseline sources, R-VALUES and R-IDS expose content gaps to independent review, R-CODES keeps one Factory finding code across completion and review. 2.14.12 (M11, no migration, contract 13): R-NEEDS the Hub completes needs deterministically from the free uses of the six permitted built-ins before lint and assembly (a repairable omission no longer consumes the rewrite), R-CLEANUP the versioned header v2 registers every resource returned by setup() and closes it at the end of the case on pass and on fail (HUB_CLEANUP report in TAP; cleanup errors and bounds are blocking, never PROVEN), R-BASELINE the baseline admits the writer only after a complete, normally terminated run (timeout, interruption, incomplete summary, missing or cancelled cases, cleanup error → owner decision, even on a matching signature). 2.14.11 (M11, no migration, contract 13): R-EXISTING v2 / R-COVERAGE — the step-0 "does not expose" check covers every relevant record of the tested day (the app's own initial data at its normal start, the record kept across a restart, the new record), proven in storage and present by id in the public list for the base request and every anonymous parameter; controls compare storage before/after a refusal instead of requiring an empty table; new reference existing-reference; calibration r-existing (29 defective variants). 2.14.8 (M11, no migration, API contract 13): step-0 setup provenance, coverage-preserving rewrites, deferred retirement with verified recovery, and audited Hub-only delivery reconciliation. 2.14.7 (closure of the M11 corrections, no migration, contract 13 — additive: spec supersedes[].contract, acceptance[].kind, protected_json.historic, events factory.retire_restored, delivery manifest reused[] by local path): R-HIST an earlier mission's Hub-written test still active is protected from a later writer (changed / deleted / replaced → critical), a retired copy and its old path too (altered, recreated, its bytes under another name), re-checked on disk before the bundle and the acceptance; R-SUP a test is retired only with its provenance (the approved spec of THIS project that protected exactly those bytes) and an explicit contract difference (the case reads the field from an anonymous GET on a route the public page reads; every other case covered by a check of its own kind), verified again on the server right before the move; R-ROLL the whole list is checked before the first move, a journal records the intent and the end, copies go through a verified temporary name, a failed start puts every moved file back and verifies it (an incomplete restore stops the start), a start that died before its record is restored at boot; R-PACK a workbook kept by proof is copied, same bytes, into the new delivery folder, listed locally with its provenance, and the folder verifies on its own. 2.14.6 (corrections after M11, no migration, contract 13 — additive: IR clip `holds`, spec `supersedes`, delivery template `reused`): R-MEDIA a capture records its planned pauses (highlight, proof hold, settle, wait, typing, end) as measured intervals with provenance (asset version, session, steps sha, step, cap, verified postcondition); the montage carries them in source frames, cuts / speed / variants remap them, and QA justifies ONLY a freeze inside them (never black, decode errors or legibility); R-PRIV a request „Y rămâne obligatoriu, dar lista publică nu afișează și nu transmite Y” derives distinct checks (public list and anonymous parameters; required, internal persistence, valid accepted as controls) and an earlier Hub test that read Y back is superseded — moved unchanged to .ifrim-hub/retired at the start, never rewritten; R-REV a refresh keeps the Excel workbook only when the generator rebuilds its exact bytes from today's data (sha256), else regenerates it. 2.14.5 (no migration, contract 13): the automatic test refinement runs only for a delivery revision whose test the independent review rejected for insufficient checks (never after a timeout or a crash). 2.14.4 (no migration, contract 13): a derived delivery plan binds its id to the delivery in the same transaction, before step 1 can run (live §25: step 1 was refused as not bound); a derived start refused before any step did work is retried once per version. 2.14.3 (no migration, contract 13): a delivery derived from an envelope may run its Word / Excel checks (office.verify in the delivery phase) and a derived start the Hub refused is retried once; „Nu publica nimic” alone is answered; derived criteria read the value back from the saved data. 2.14.2 (closure of the stage before M12, no migration, API contract 13 — additive: intent `corrections`, command factory.refine_test, office item state): criteria derived from a natural request (a required field: the labelled field and its refusal checked in the browser, the server enforcing it when called directly, the value kept, a valid request still accepted as a „păstrare” control, the existing flows with the field filled), the bounded recovery of a revision stopped at step 0 (one new card, same effects, only the checks), tolerant understanding of typos (never into a stop, a confirmation, a negation or a publication), plan cards kept 24 h in the local development profile and refreshed in every page, office artifacts with their software dependency. 2.14.1 (stage before M12 „Lega: autonomie și lucru pe PC”, no migration, API contract 13 — additive: GET /api/knowledge, the delivery view's `office`): a delivery may carry the Word document, the Excel workbook with demo data and the local campaign package the owner asked for in the same sentence (generated by the Hub, verified in Word / Excel through COM, one folder with a sha256 manifest, resume reuses identical files); Lega's system knowledge (system_knowledge intent and voice tool, built from the Hub's real state; a controlled inventory of installed apps). 2.14.0 (M11 „Ifrim Delivery”, migration 12 m11-deliveries, API contract 13): ONE envelope confirmation covers the mission and the delivery (hashed delivery section; the package plan is derived from that consent at DELIVERY_READY: capture desktop + phone width of the verified preview, 16:9 clip, 9:16 variant, QA, local export, commercial summary — no model); the delivery graph marks exactly what a change affects (code → STALE, clip → SUPERSEDED, copy → a new summary version); Delivery Room (#/livrare) and „Deciziile mele”; Lega intents delivery_prepare / revise / open; a reboot no longer applies an unreleased migration (boot guard). 2.13.2 (M11 voice, no migration, API contract 12, additive routes): the filter's worklet keeps a 300 ms pre-roll, an absolute -70 dBFS floor, a noise estimate that also rises, and drops clicks; refusal causes and a local in-memory voice diagnostic (GET/POST /api/voice/diagnostics) that can never confirm, resume or release anything. 2.13.1 (L5 pilot fixes, no migration, API contract 12): a code request names its project after „în” too (the pilot drafted on the cockpit's project); the fixture script checks the right source file. 2.13.0 (M11 first item L5 + 2.12.3 probe fixes, no migration, API contract 12, additive fields): L5 test-first engineering plans (step 0: Claude writes the acceptance test read-only, the Hub writes it to a staging area, proves twice that it fails for the right reason, Codex reviews it read-only, the Hub protects it before the writer; hub-test projects on the Windows route only, ProDelivery and real projects refused; a test that already passes is not kept; the planner never asks the owner to name or pick a test file); probe fixes D1 (unknown-intent counter closed by a Lega turn that spoke), D2 (leading acknowledgements), D3 (a preview request never becomes a model analysis), D4 (Lega never denies a Hub action it just saw), D6 (folder import with „în Studio” / full paths), D7 (one path for a Studio correction: patch + render + QA). 2.12.2 (M10.2 P0 round, no migration, API contract 12 — every new request/response field is additive): R1 retained-lease reconciliation in the rearm (a lease of a finished run is released by a bounded follow-up, the boot pass and the scheduler only when this Hub process proves its provider process gone — its own supervised child exited, or an environment reap confirmed; a dead PID after a restart is no proof: the boot keeps those leases retained and, when the gate is open, suspends it (kind shutdown, channel recovery) so the owner's rearm card shows them; what cannot be proven is a step of that card — the Hub-tied orphan stopped, or released with ackLeases — never a dead end, never a relaunch; system.stop_all also records the stop's own stopKind); R2 imperative stop intent (Stop All, a pause, „Oprește Codex”, „Preiau eu”, „Îngheață” run only on a clear imperative; a question, negation, condition, reported speech or quotation becomes explain_stop, answered by the Hub; the real stop path is unchanged); R3 per-turn timeout (a wall-clock limit per Software Factory model turn and per run-plan turn, hashed in the plan and shown on the card, separate from the mission deadline; a timed-out turn is failed/turn_timeout, one re-dispatch after ≥ 60 s within the plan's attempts, then the owner decides); R4 probe counters (the owner's §7 list under his names: NAVIGATION_TO_ADVANCED … UNKNOWN_INTENTS, read-only; STOP_ALL from the stop's own kind, UNKNOWN_INTENTS exact from owner.intent_outcome); R5–R8 fixes from the owner's live Lega session of 2026-10-06 (a neutral holding phrase, the Hub's tail saying what is kept, the same request not re-planned within 2 minutes of the Hub's question, face sentences shown by voice (lega.face), Lega's thread at effort low, plain answers for a missing test, a mode change („Treci pe live”, said by the Hub) and a plan without a project, the voice filter applied to a running session, the WSL adapters' turn_settled); R9 review fixes of that batch (a Stop All after „dar / însă / ci” stops and the request the owner negated never runs; a lease retained while the Hub runs suspends the open gate once its follow-up ends unproven, so the rearm card releases it; the single offered test picked in plain words or by its button; the „filter on” text and the panel no longer claim a session started without the filter; a conditional stop next to a request answered; no raw wait reason on any Lega surface; a face heard by voice opens the Lega screen). 2.12.1 (M10.2 probe fixes, no migration): every gate suspension records its origin (suspendedBy, one classifier, precedence); the gate is reopened contextually in the cockpit (rearm card, owner session + fresh Windows Hello, bound to the exact suspension, nothing old restarts, BUILD_SAFE kept); Stop All also closes proposed plans; spoken „Continuă” only from the locally verified voice; probe-blocking fixes. 2.12.0 (M10.2): one command path for voice/text/UI with server-side effect classes; Lega proposals become one-confirmation plans (envelope / ops / run) instead of approval cards + manual mode/grant; plan steps admitted in BUILD_SAFE by envelope-scoped authority with bound-only derived grants; honest one-time blocker explanations with preserved requests and automatic readiness; auto-armed spoken confirmation; server-side live web-search guard; skills reconcile; media tools GET without mutation; probe counters; migration 11 work_requests. 2.11.1: Lega zero-form start (voice authority derived from the owner session for one voice session; no mode or grant by hand). M10: Desktop Operator (authenticated UIA helper, observe → act → verify, Stop / Preiau eu), zero-form operation plans (one confirmation, internal derived authority), Studio completion (project import, import folders, text target, legibility, enforced pre-migration backup). Before: 2.10.0-m09 — M09: Content / Media / Growth department (library, edit plans, local renders, QA, reviews, variants, distribution packs, analytics, Content → Sales) + core corrections (model binding, billing evidence, skill composer, voice path hardening)
/**
 * The UI–API contract (M07): a built UI carries the number it was built against (vite define __UI_CONTRACT__) and sends it on
 * every mutating request; the server answers 409 UI_STALE when they differ, so new assets never drive an older backend (or the
 * reverse). Bump it whenever a request or response shape the UI depends on changes.
 */
// 12 (2.12.1): the gate rearm routes (POST /api/owner/gate/rearm/card, /api/owner/gate/rearm), the intake fields gateRearm / gateStopped /
// expiredPlans, executionGate.suspendedBy, the blocker option kind 'rearm', the security list newest first. 11 (M10.2): plan cards
// (lega.plan), intake choice/clarification, work requests, liveScopes, media tools pin/acknowledge.
// 2.12.2 keeps 12: its fields are additive (gate.rearm ackLeases, the card's leases / scope, reopened:false for scope "leases", the plan
// summary's limits line, the factory view's turnLimits / turnRetry, the probe's ownerList / breakdown / aliases).
// 15 (2.15.0-m12) changes these shapes: POST /api/sales/proposals/:id/approve goes through the owner dispatcher (401 needSession without a
// session, agent / cli refused) and takes only displayedSha (exact lowercase 64-hex; the sha / contentSha aliases are gone); the approve
// result carries status and the CURRENT opportunity status (also on a duplicate). POST /api/sales/orgs/:id/qualification/override goes
// through the owner dispatcher and needs displayedQualificationId (a repeat answers duplicate: true). POST /api/approvals/:id/owner_decide
// is new, and POST /api/approvals/:id/decide for the reserved kind sales.proposal_approve now goes through it (fresh owner session, 64-hex
// displayedHash); GET /api/approvals rows of that kind carry sessionId / credentialId / authority with decisionNote unpacked. POST
// /api/commands/:id/execute passes the owner session; for an owner decision only, a replay returns the original result (duplicate: true),
// a missing or stale executing session is 401 (the approval kept), and a refusal that can never succeed (OWNER_CREDENTIAL_MISMATCH,
// OWNER_DECISION_REVOKED, OWNER_DECISION_CHANNEL, a refused final check) ends the approval (invalidated) and the command (failed).
// 15 also carries additive M12 Sales fields (schema 13): sales.evidence.add dataKind / basis / reasoning, evidence rows dataKind / basis /
// reasoning, sales.org.qualify formula (q-v1 default) with q-v2 results' inferences / unproven / missing, and on the preparation path only
// (a brief given) proposal content pricing[] and section "request".
// 15 (part 3, additive): GET /api/sales/opportunities/:id/dossiers ({ opportunityId, preparations, dossiers }; read only), the commands
// sales.preparation.cancel (fail-safe) and sales.preparation.continue (proposes a card), the intake planner kind "sales" with its ops
// card (preparationId, brief, then, decisionsLeft, never), the proposal status STALE (preparation-bound offers only) and the refusal
// code SALES_PROPOSAL_STALE on the approval of such an offer.
// 15 (part 4, additive): the resolver intents sales_prepare / sales_show / sales_missing / sales_approve_talk / sales_send (REFUSED,
// OUTREACH_DISABLED) with an intent result's `sales` facts and a /sales navigation; intake.plan refuses outreach words (refused +
// outreach: true); GET /api/sales/overview `split` { real, synthetic, note }; Lega's request_work kind_hint "sales" and the voice-first
// read tool sales_preparation; the probe's breakdown.decisionsByAuthority (approval.owner_decide and ops.plan.consent per authority).
// 15 (review fixes of parts 2-3, additive): GET dossiers preparations[].continuable / waitsForRearm and dossiers[].partial; qualification
// rows inputsSha / orgId; the offer basis qualificationInputsSha / org; brief problem.stated / problem.rule (rules R-TYPO@1, R-NEED-CUT@1);
// sales.preparation.continue may answer GATE_REARM_REQUIRED (category gate); new codes SALES_SYNTHETIC_TAKEN, SALES_DOSSIER_FORBIDDEN_ROOT,
// SALES_PROPOSAL_STALE.
// 15 (final review, group B, additive): POST /api/sales/preparations/:id/continue (new; owner dispatcher: 401 needSession without the owner
// session, agent / cli refused; answers { plan, preparation, decisionsLeft, never } — ONE PROPOSED sales.prepare card the owner confirms through
// POST /api/ops/plans/:id/confirm — or 409 GATE_REARM_REQUIRED / SALES_PREPARATION_STATE); GET dossiers preparations[].awaitedCurrent; the
// preparation transition PREPARING → STOPPED; POST /api/ops/plans/:id/resume (and ops.plan.reconfirm) of a Sales preparation's plan may answer
// GATE_REARM_REQUIRED while a Stop All since its last confirmation still holds the gate; GET /api/decisions/inbox items of kind sales_offer
// (target { proposalId, version, proposalSha }, preparationId, opportunityId, activateBy, remainingMin, synthetic, acceptLabel / rejectLabel);
// GET /api/sales/overview split.detail { real, synthetic } (company statuses, audits, follow-ups, missing site / contact, active do-not-contact);
// the board's Sales item: real-only figures plus totals / syntheticFigures while synthetic data exists; the work-request intent "sales" (an
// offer request kept for SALES_DOSSIER_NO_EXPORTS_DIR, re-proposed once the exports folder exists).
// 15 (final review fixes, group A, additive): intent sales_continue (effect plan; args {} or { again: true }); system_knowledge args
// may carry about: "offers"; planner results may carry outreachNote; a continuation card carries opsPlan.continues / opsPlan.preparationId;
// intake.plan() may return outreach { partial, refused[{kind, text}], reason }, quotedOutreach, outreachNote; event intake.outreach_refused
// may carry partial: true; knowledge answer(topic, {about}), locations.offers, locations.screens.vanzari, blocked.offers[]; conversation
// entries may carry links[].
export const API_CONTRACT = 15;
export const DEFAULT_PORT = 8011;
export const DEFAULT_HOST = "127.0.0.1";

/** Where the relocated data root is recorded (a path pointer only; no data). Written by v2/scripts/relocate-data.mjs. */
export const DATA_LOCATION_FILE = path.join(HUB_ROOT, ".ifrim", "data-location.json");
/**
 * Marker the relocation leaves in the OLD data folder: a V2 Hub that would open it refuses to start (never two active databases).
 * V2-specific name: `.ifrim/private` is shared with V1, which keeps running there and ignores this file.
 */
export const MOVED_MARKER = "V2_MOVED.json";
/**
 * The entries of the data folder that belong to V2 (moved by the relocation). Everything else in `.ifrim/private` — the V1
 * database and its files, OpenClaw state — is not V2's and is never moved, opened or listed by content.
 */
export function isV2DataEntry(name) {
  return /^hub-v2\.sqlite(-wal|-shm|-journal)?$/.test(name) || /^v2-/.test(name) || ["browser-evidence", "sales-imports", "voice"].includes(name);
}

/**
 * Resolves where the Hub keeps its data (M08 §05). Precedence: an explicit override, HUB_V2_DATA_DIR, the relocation pointer
 * (.ifrim/data-location.json → a data root outside the synced folder, with private/, backups/v2 and work/ under it), then the
 * historical default (.ifrim/private, .ifrim/BACKUPS/v2, .ifrim/tmp/v2). Returns the three folders and where they came from.
 */
export function resolveDataLocation({ overrides = {}, env = process.env, locationFile = DATA_LOCATION_FILE, testMode = false } = {}) {
  const tmpRoot = path.join(HUB_ROOT, ".ifrim", "tmp");
  if (overrides.dataDir || env.HUB_V2_DATA_DIR) {
    const dataDir = path.resolve(overrides.dataDir || env.HUB_V2_DATA_DIR);
    return { source: overrides.dataDir ? "override" : "env", dataDir, backupDir: null, workDir: null, dataRoot: null };
  }
  if (!testMode && locationFile && fs.existsSync(locationFile)) {
    let pointer = null;
    try { pointer = JSON.parse(fs.readFileSync(locationFile, "utf8")); } catch { throw new Error(`${locationFile} nu este JSON valid; corectează-l sau rulează relocate-data --rollback`); }
    const root = String(pointer?.dataRoot || "");
    if (!root || !path.isAbsolute(root)) throw new Error(`${locationFile}: dataRoot trebuie să fie o cale absolută`);
    return { source: "pointer", dataRoot: path.resolve(root), dataDir: path.join(root, "private"), backupDir: path.join(root, "backups", "v2"), workDir: path.join(root, "work") };
  }
  return { source: "default", dataRoot: null, dataDir: path.join(HUB_ROOT, ".ifrim", "private"), backupDir: path.join(HUB_ROOT, ".ifrim", "BACKUPS", "v2"), workDir: path.join(tmpRoot, "v2") };
}

/**
 * Builds an immutable runtime configuration. Tests pass `dataDir` inside `.ifrim/tmp` so they never
 * touch the real database, backups or provider homes.
 */
export function loadConfig(overrides = {}, env = process.env) {
  const testMode = Boolean(overrides.testMode ?? env.HUB_V2_TEST === "1");
  const location = resolveDataLocation({ overrides, env, locationFile: overrides.locationFile ?? DATA_LOCATION_FILE, testMode });
  const dataDir = location.dataDir;
  const tmpRoot = path.join(HUB_ROOT, ".ifrim", "tmp");
  // A folder the relocation left behind is never opened again (its marker names where the data went).
  if (fs.existsSync(path.join(dataDir, MOVED_MARKER))) throw new Error(`Datele Hub-ului au fost mutate din ${dataDir} (vezi ${MOVED_MARKER}); pornește cu pointerul de locație sau rulează relocate-data --rollback`);
  if (testMode) {
    const rel = path.relative(tmpRoot, dataDir);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error("Test mode requires an isolated data directory inside .ifrim/tmp");
    }
  }
  const port = Number(overrides.port ?? env.HUB_V2_PORT ?? DEFAULT_PORT);
  const config = {
    testMode,
    // Simulator process (M02 §23): test mode + synthetic demo project + fixture providers only.
    simulation: Boolean(overrides.simulation) && testMode,
    hubProjectName: overrides.hubProjectName || "Ifrim Agent Hub",
    hubRoot: overrides.hubRoot || HUB_ROOT,
    // M07: the local voice engines live under the user's profile (outside the repo and OneDrive); tests use a fixture worker
    // with the same JSON-lines protocol (deterministic transcripts and embeddings, no model).
    voiceRoot: overrides.voiceRoot || null,
    voiceWorker: testMode ? overrides.voiceWorker || path.join(V2_ROOT, "tests", "fixtures", "fake-voice-worker.mjs") : null,
    voiceWorkerEnv: testMode ? overrides.voiceWorkerEnv || {} : {},
    // M04 Sales: a fake transport is accepted only in test mode (the real outreach transport does not exist in M04).
    salesTransport: overrides.testMode && overrides.salesTransport ? overrides.salesTransport : null,
    salesFixtureSites: overrides.salesFixtureSites || null,
    // Where Playwright is resolved from (Browser Workspace, factory E2E): the Hub itself; a test may point it elsewhere.
    browserRoot: overrides.browserRoot || overrides.hubRoot || HUB_ROOT,
    projectsRoot: overrides.projectsRoot || PROJECTS_ROOT,
    v2Root: V2_ROOT,
    dataDir,
    dataLocation: { source: location.source, dataRoot: location.dataRoot },
    dbPath: path.join(dataDir, overrides.dbFile || "hub-v2.sqlite"),
    legacyDbPath: overrides.legacyDbPath || path.join(HUB_ROOT, ".ifrim", "private", "agent-hub.sqlite"),
    backupDir: overrides.backupDir || (testMode ? path.join(dataDir, "backups") : location.backupDir || path.join(HUB_ROOT, ".ifrim", "BACKUPS", "v2")),
    workDir: overrides.workDir || (testMode ? path.join(dataDir, "work") : location.workDir || path.join(tmpRoot, "v2")),
    attachmentsDir: path.join(dataDir, "v2-attachments"),
    // M09 Content Studio: the media library lives under the data root (outside the repo and OneDrive once relocated; the "v2-" prefix
    // makes it move with relocate-data). The database stores paths RELATIVE to mediaDir. Render scratch goes under the work dir.
    mediaDir: overrides.mediaDir || path.join(dataDir, "v2-media"),
    mediaWorkDir: overrides.mediaWorkDir || path.join(overrides.workDir || (testMode ? path.join(dataDir, "work") : location.workDir || path.join(tmpRoot, "v2")), "media"),
    // M09: ffmpeg/ffprobe (and whisper-cli for media transcription). null = resolved on PATH at first use and pinned by version + sha256.
    // Test mode: a node fixture proxy (tests/fixtures/ffmpeg-proxy.mjs) runs the real binary when present, so the supervisor's
    // fixture-only rule holds; a fake (tests/fixtures/fake-ffmpeg.mjs) injects failures.
    mediaTools: Object.freeze({ ffmpeg: overrides.mediaTools?.ffmpeg || env.HUB_V2_FFMPEG || null, ffprobe: overrides.mediaTools?.ffprobe || env.HUB_V2_FFPROBE || null,
      launcher: overrides.mediaTools?.launcher || null }),
    // M10: the verified copies taken before a schema migration (never overwritten; see storage/db.mjs).
    preUpgradeDir: overrides.preUpgradeDir || path.join(dataDir, "pre-upgrade"),
    // M10 Desktop Operator: the helper binary is built from v2/desktop/operator by `node v2/scripts/build-operator.mjs` into the work
    // dir (outside the repo and OneDrive once relocated; writers cannot reach it). Tests use a node fixture launcher instead.
    desktop: Object.freeze({
      operatorExe: overrides.desktop?.operatorExe || path.join(overrides.workDir || (testMode ? path.join(dataDir, "work") : location.workDir || path.join(tmpRoot, "v2")), "desktop", "IfrimOperator.exe"),
      launcher: overrides.desktop?.launcher || null,
    }),
    // M08: a separate UI build can be served by a side instance (simulator) without touching the live Hub's assets.
    webDist: overrides.webDist || env.HUB_V2_WEB_DIST || path.join(V2_ROOT, "web", "dist"),
    // M09-A3: the skills directory (default v2/skills). Tests point it at a temporary git repository; only versions git-tracked
    // and clean in the repository holding this folder are ever injected into worker prompts.
    skillsDir: overrides.skillsDir ? path.resolve(overrides.skillsDir) : null,
    host: DEFAULT_HOST,
    port,
    // M07: the owner's session (WebAuthn RP ID "localhost") lives only on this origin; page navigations to 127.0.0.1 are sent
    // here (307, documents only — never /api, scripts or iframes). Tests opt in explicitly.
    canonicalOrigin: `http://localhost:${port}`,
    canonicalRedirect: overrides.canonicalRedirect ?? !testMode,
    allowedOrigins: new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`,
      ...(overrides.devOrigins || [`http://127.0.0.1:3011`, `http://localhost:3011`])]),
    maxConcurrentAiRuns: Number(overrides.maxConcurrentAiRuns ?? 2),
    // Test mode refuses to spawn any executable outside this directory (fake providers only).
    allowedTestBinaryDir: path.join(V2_ROOT, "tests", "fixtures"),
    providerBinaries: overrides.providerBinaries || {},
    // M05: the wsl.exe used for the wsl-runner environment; tests point it at the fixture (tests/fixtures/fake-wsl.mjs).
    wsl: overrides.wsl || null,
    // Test mode only: shrinks Lega's idle/max/negotiation timers so they can be exercised quickly.
    legaTimeScale: testMode && Number(overrides.legaTimeScale) > 0 ? Number(overrides.legaTimeScale) : 1,
    registryPath: overrides.registryPath || path.join(PROJECTS_ROOT, "PROJECTS.md"),
    roleRegistryPath: overrides.roleRegistryPath || path.join(PROJECTS_ROOT, ".ifrim-system", "AGENT_TEAM_V2.json"),
    now: overrides.now || (() => new Date()),
    // Stage before M12: tests inject the local development profile ({ enabled, id, machine, user } or a function); a real Hub reads
    // <dataDir>/local-dev-profile.json (written by v2/scripts/dev-profile.mjs). undefined = read the file.
    devProfile: testMode ? overrides.devProfile : undefined,
  };
  return Object.freeze(config);
}
