# M11 „Ifrim Delivery” — engineering design (blueprint)

Status (2026-10-05): design only. Produced by a read-only panel (three independent designs + a judge) and reviewed by the coordinator.
Nothing here is live. The M11 live pilot has its own approval sheet (see LIVE PILOT below); it is NOT covered by the M10.2 probe approval.

Working rules while the M10.2 probe (P0) is still open:
- The live Hub runs from this working tree. Until the owner's probe A–G is finished, M11 work adds NEW files only (inert: not imported
  by hub.mjs, not in the UI import graph). No existing tracked file is modified for M11 before that, and no M11 file goes into the
  P0 commit.
- Units that need shared files (migration 12, factory hooks, derived ops plans, media extensions, envelopes, intents, intake, hub
  wiring, UI routes) start after the probe.
- Pre-probe deviations from the unit list below: the booking fixture's spec + delivery block live in the new file
  `v2/server/factory/booking-demo-def.mjs` (registered in `fixtures.mjs` after the probe); `delivery/summary.mjs` waits for the
  export-only change in `sales/proposal.mjs`.

Decisions: every item under OPEN DECISIONS is implemented with its DEFAULT. They are the owner's to change; the pilot sheet lists them.

Panel note: the judge saw design 1 (reuse lens) in full and design 2 (safety lens) in part; design 3 (owner lens) did not reach the
judge and is applied by the implementers of the clip and the Delivery Room as an extra input, without changing the contracts below.

---

# M11 „Ifrim Delivery” — final design (judge synthesis) · 2.13.0-m11 · migration 12 m11-deliveries · API contract 13

## SCORES
INPUT NOTE: the payload held Design 1 (reuse lens) complete and Design 2 (safety lens) truncated at capturePolicy point 7. Design 2 is missing its fixture, clip, summary, UI, stale, revision, tests, pilot and units. Design 3 (owner lens) was not in the payload at all, so it is not scored; its brief (owner requirements) was applied directly by the judge.

VERIFIED IN CODE (static reading; no HTTP, models or WSL):
- Ops plans call trust.requireSession at every operation (plans.mjs:277-278).
- requireSession checks only status and absolute expiry (trust.mjs:202-206); idle expiry (30 min) is applied lazily when a cookie is presented (trust.mjs:173, 24).
- Envelopes:
  - continue after the panel is closed (afterPanelClosed, envelopes.mjs:320) and close COMPLETED at DELIVERY_READY, with grants revoked (envelopes.mjs:1521, 1359-1365);
  - compute expiresAt from limits.maxDurationMin (envelopes.mjs:876).
- runBaseline matches expectFailure lower-case against outputTail (factory.mjs:540-551); runner outputTail = last 120 lines (runner.mjs:140).
- accept/reject stop factory-preview-<mission> (factory.mjs:1139, 1162). E2E failure also stops it (1047, 1052); DELIVERY_READY leaves it running.
- factory.change_set event exists (factory.mjs:470). No event exists for bundle status changes.
- capture.mjs:
  - DEMO_STEP_KINDS has no select (capture.mjs:37); highlight records no marker;
  - live ports are relaxed in test mode (capture.mjs:357-358);
  - contextSetup is harness-only;
  - the browser_demo executor self-approves its scope (executors.mjs:269-283).
- QA and rights: qa.run defaults use='organic' (qa.mjs:734), and rights treat only 'internal' as non-public (rights.mjs:229), so a qaUse parameter is necessary.
- media_variants INVALIDATED is in the CHECK (migrations.mjs:939), but only DRAFT is ever written (variants.mjs:684).
- content.verifyEvidence checks bundle existence only (content.mjs:556-562).
- Review: cut_range refuses a cut touching a transition (review.mjs:471); NUM_WORDS includes zece (review.mjs:41).
- Cockpit done-list filters 'ACCEPTED' (cockpit.mjs:183): a real bug.
- Fixtures: fake-codex already supports factory-write:<patch> (fake-codex.mjs:151, 214); create-factory-fixture maps any non-bug fixture to demo-b (create-factory-fixture.mjs:15).
- exportLocal flattens names into exportsDir = Videos\Ifrim Studio\Exporturi by default (media/index.mjs:63-112).
- resolveIntent splits sentences on '. ' before matching (intents.mjs:683). „nu publica nimic” matches no pattern and no constraint (constraintsOf, intents.mjs:516-527), and an unmatched clause becomes an 'unknown' step (intents.mjs:709-711).
- p0-files.txt lists the following, but not factory.mjs, plans.mjs, media/*, migrations.mjs or layout.mjs:
  - envelopes, intake, intents, cockpit, hub, command-catalog
  - owner-commands, engineering, work-requests, lega.mjs, cards/Lega/RearmCard UI
- Working tree already shows HUB_VERSION 2.12.1-m10.2 and API_CONTRACT 12 (config.mjs:10, 19); last migration is v11 (migrations.mjs:1022).

DESIGN 1 (reuse lens). Correctness 8/10, safety 8/10, owner value 9/10, implementation risk 6/10 (higher = safer), size: large but realistic.
- Correct: nearly every load-bearing claim checks out (session semantics, baseline rule, capture gaps, QA use, variants, cockpit bug, cut_range plus hard cuts, exports, PILOT_MODELS).
- Errors:
  - E1: noPublish read as an argument of the delivery pattern cannot work. The sentence is split at '. ', and „Nu publica nimic.” becomes an 'unknown' step. It must be a constraint.
  - E2: delivery minutes summed into envelope limits.maxDurationMin extend the MODEL authority window (expiresAt, envelopes.mjs:876) by about 25 minutes. Rejected.
  - E3: changing parseInstruction for „arată direct X” couples the Studio parser to delivery markers. Better kept in delivery/revision.mjs.
  - E4: adoption bound to templateSha plus rebuilt steps is weaker than binding the exact ops body hash.
- Strong ideas kept:
  - derived-plan adoption with authorize() unchanged and same-credential reconfirm;
  - capture steps derived from the approved E2E steps;
  - snapshot bracket around each capture;
  - tone 'both' so „prea tehnic” is meaningful;
  - revision via an OPEN review with explicit ops;
  - stale graph;
  - the full fixture and pilot sheet.

DESIGN 2 (safety lens, truncated). Correctness 7/10, safety 9/10, owner value 7/10 (only partly visible), implementation risk 5/10, size: larger (4 tables, an in-project profile file).
- Strong ideas grafted:
  - the exact ops body sha hashed into the envelope's delivery section and re-checked at activation;
  - a separate phase window, so the envelope limits are untouched;
  - an activation checklist: credential, policy, Stop All since confirmation, tools identity, origin = bundle start.url;
  - LIVE_PORTS refused even in test mode;
  - a not-a-Hub probe (X-Hub-Version header) and a page text guard;
  - delivery_documents and delivery_revisions tables, and snapshot_sha on every item;
  - a Room accept wrapper bound to the displayed bundle sha;
  - a continuation that carries the delivery section;
  - content.verifyEvidence refusing a STALE or REJECTED bundle for SUPPORTED claims.
- Errors and risks:
  - It calls factory.mjs and plans.mjs P0 files; they are not.
  - It requires a fake-codex change; that is unnecessary.
  - `$dlv:` references plus sessionBound:false add a session-free branch to the central authorize(). Kept only as an owner decision.
  - Included clip revisions run renders without a confirmation, which widens authority. Kept as an owner decision.
  - capture.preview 'REFUSED unless ctx.deliveryBound' needs classifier plumbing. It is replaced by executor-side guards.

SYNTHESIS
- Base: Design 1.
- Grafts from Design 2: listed above.
- Judge additions:
  - the noPublish constraint fix;
  - envelope limits untouched;
  - a session-bound default with a one-click reconfirm;
  - jump-to-marker parsing in delivery/revision.mjs;
  - a delivery-scoped export subfolder;
  - fixture seeds re-established per day, so a run across midnight stays valid;
  - an acceptance sequencing guard while captures run.

## ARCHITECTURE
PRINCIPLE: no new department and no new engine.

M11 adds:
- one coordinator folder, v2/server/delivery/ (a service plus pure modules);
- one planner, owner/planners/delivery.mjs;
- one screen, the Delivery Room;
- small additive hooks in factory, ops, media and envelopes.

It links outputs that already exist to ONE software snapshot and shows them in one room.

THE SIX PARTS

1) ENGINEERING. The existing Software Factory runs unchanged + Etapa 0 (L5): spec → [L5, only when the project has no test that proves the request: step 0 of the same plan, the Hub writes the acceptance test — TEST_AUTHORING (Claude, read-only) → TEST_PROVING (2 runs, must fail today) → TEST_REVIEW (Codex, read-only) → protected; .ifrim/M11_L5_DESIGN.md §2–§3] → BASELINE → Codex writer → checks → Claude review (read-only) → up to 2 repair cycles → QA → preview → E2E → bundle bnd_* → DELIVERY_READY.
- It runs under ONE envelope:
  - derived bound grants;
  - BUILD_SAFE with SCOPED_LIVE_TRANSITION (envelopes.mjs:68, 320-323);
  - the repair cycles shown on the card are pre-authorized (envelopes.mjs:292-295).
- At DELIVERY_READY the envelope closes COMPLETED and its grants are revoked (envelopes.mjs:1521, 1359-1365). No model runs after this point.

2) DELIVERY PHASE. This is ONE ops plan of kind 'delivery.package', with at most 12 steps.
- Its exact body, opsPlans.buildBody(steps) (plans.mjs:83-141), is computed at proposal time. Its sha is HASHED inside the envelope's new `delivery` section.
- At activation the Hub rebuilds the body and requires the same sha. It then inserts the plan CONFIRMED, with consent derived from the envelope (modality 'derived').
- The plan runs through the ordinary ops engine: authorize() at every operation, plus pause, Stop, „Preiau eu”, „Continuă” and reconcile (plans.mjs:266-441).
- The phase has its own time window (30 min planned, hard stop at 60). The envelope's model window is never extended.

3) MEDIA. Only existing Studio services:
- Public Demo Mode capture (capture.mjs:759)
- EditProjectIR + edits.create (edits.mjs:33)
- the durable ffmpeg render queue with pinned tools
- variants.derive (variants.mjs:672)
- QA in six kinds, with use 'internal'
- reviews and patch versions (review.mjs:769-850)
- rights
- exportLocal (media/index.mjs:83)
No CapCut, OBS, Computer Use or media AI role.

4) COMMERCIAL SUMMARY. A pure, deterministic renderer (delivery/summary.mjs) that reuses the sales/proposal.mjs helpers. No model. Versions are stored in delivery_documents.

5) PROVENANCE. Four tables: deliveries, delivery_items, delivery_documents and delivery_revisions.
- Every item records the snapshot sha it is evidence of and its upstream items.
- Stale propagation walks those links, driven by existing bus events plus one new factory.bundle.status event.

6) DELIVERY ROOM. The route #/livrare/:id plus a DeliveryRoom card in the Lega cockpit.
- One aggregated GET view feeds it.
- Every owner decision goes through its own command.

FLOW FOR THE REFERENCE REQUEST
1. Intake and intents:
   - The first sentence („pregătește demo-ul pentru prezentare: … rezumat comercial”) resolves to ONE delivery_prepare step (NEVER_SPLIT).
   - „Nu publica nimic.” becomes the constraint noPublish, attached to that step. This needs a new constraintsOf rule, because the sentence is split at '. ' (intents.mjs:683, 708-717).
2. The delivery planner resolves:
   - The project: the cockpit project, or the only eligible synthetic hub-test project, or ONE question.
   - The agreed problem: the project's single SPEC_DRAFT, or the fixture's declared issue prepared as a no-effect draft via hub.prepareFactoryMission (command-catalog.mjs:168-183). Two drafts → ONE clarification.
   - Eligibility and readiness. Blockers are explained once and the request is preserved.
   It then creates the delivery row PLANNED, with the frozen template and the exact package steps, and calls envelopes.propose({ missionIds:[m], deliveryId, constraints:{ noPublish:true } }). The result is ONE card.
3. ONE confirmation, by click, Enter, typed text or the armed local voice („Da, execută planul”).
   - confirmImpl rebuilds the body including the delivery section. Any difference supersedes the card, which then names „pașii de după livrare”.
   - In the SAME transaction that writes CONFIRMED (envelopes.mjs:883-895), the delivery is armed (compare-and-set PLANNED→ARMED, envelope consent copied). If that throws, the confirmation rolls back.
4. The mission runs exactly as today.
5. The envelope status becomes COMPLETED at DELIVERY_READY. delivery.activate runs the activation checklist, binds the bundle and E2E items, and calls opsPlans.adoptDerived. The plan then runs:
   1. prepare
   2. preview.ensure
   3. capture desktop
   4. capture mobile
   5. edit.build
   6. media.render (final, QA internal)
   7. media.variant.render (shorts_9x16, QA internal)
   8. export
   9. summary.render
   10. finish
6. The delivery is READY. The owner's decisions stay open, and the Room shows the six deliverables.
7. Revisions go through delivery_revise:
   - a media or summary change uses no code and no model;
   - a software change starts a new envelope and a child delivery, and marks old items stale with real links.

FIVE SEPARATE RECORDS, NEVER DERIVED FROM EACH OTHER
1. Software acceptance: delivery.software.accept, which calls ONLY factory.accept (factory.mjs:1127).
2. Creative approval, per version: media.review.decide CREATIVE_APPROVED, in the owner session (review.mjs:858-866).
3. Rights for public use: media.rights.record.
4. Summary „gata de prezentare”: delivery.summary.approve, bound to the sha.
5. Publishing: off.
   - NEVER_IN_PLANS (plans.mjs:20)
   - publish/upload REFUSED (action-policy.mjs:25)
   - DENIED_EFFECTS (envelopes.mjs:46)
   - apiRelease always refuses (distribution.mjs:659)
   - mediaPolicy autoPublish/liveUpload stay false
   - no M11 command publishes.

INVARIANTS (all tested)
- I1. One confirmation covers engineering and the derived package. The envelope hash covers the delivery section, including the ops body sha.
- I2. Derived authority never widens:
  - the rebuilt body sha must equal the confirmed one;
  - zero decisions, no model;
  - ops only from DELIVERY_PHASE_OPS, no desktop or app ops;
  - a fixed window and budget;
  - adoption is reachable only from the delivery service (no command, route, agent or Lega tool).
- I3. The five decisions stay separate.
- I4. Nothing is published, uploaded or sent.
- I5. Capture reaches only the Hub-started, snapshot-verified loopback preview of a synthetic hub-test project. MB1 is unchanged.
- I6. Every item carries a snapshot_sha. An item whose snapshot differs from the delivery's verified snapshot is never shown as current evidence.
- I7. Honest labels:
  - capture label SIMULATION in test mode or for SIMULARE bundles, otherwise ORIGINAL_RECORDING;
  - on-screen „DATE SINTETICE · DEMO LOCAL” always;
  - „lățimea unui telefon (390 px) în Chromium” wherever mobile is mentioned;
  - evidence labels PASS_LOCAL / PASS_SIMULATED / PASS_LIVE / FAIL / BLOCKED / NOT_RUN / SKIPPED_ENV.
- I8. BUILD_SAFE throughout. No manual grant. No mode write.

LIVE FACTS RESPECTED
- Windows route only: the wsl-runner attestation is invalid, and its bwrap preview cannot be reached by the Windows capture (routed-runner.mjs:33-47).
- ffmpeg/ffprobe are pinned, so there is no pin step. A media.tools.pin step is prepended only when the tools are UNPINNED (intent-actions.mjs:30-44).
- The Studio library is empty, so the delivery creates its own content project.
- liveCapture stays false and is not needed.
- voice_first is active, so the envelope path is used.
- Desktop apps are authorized but not used.

PLACEMENT AROUND THE P0 TEAM
- Wave A (order 1-2) touches only new files and files outside p0-files.txt:
  - factory.mjs, ops/plans.mjs, ops/executors.mjs, action-policy.mjs, media/*, migrations.mjs, fixtures.mjs, layout-free UI files.
- Wave B (order 3-5) starts only after the P0 commit lands:
  - envelopes.mjs, intents.mjs, intake.mjs, work-requests.mjs, cockpit.mjs, layout.mjs, hub.mjs, command-catalog.mjs, routes.mjs, cards.jsx, main.jsx, api.js.
- config.mjs is last.

## DATA MODEL
MIGRATION 12 `m11-deliveries`

Purely additive: 4 new tables, no ALTER, and no CHECK change on any existing table. The last migration is v11 m10-2-work-requests (migrations.mjs:1022). The pre-migration backup comes from upgrade.mjs.

CREATE TABLE deliveries (
  id TEXT PRIMARY KEY,                                   -- dlv_*
  project_id TEXT NOT NULL REFERENCES projects(id),
  parent_id TEXT REFERENCES deliveries(id),              -- software revision: the delivery this one replaces
  lineage INTEGER NOT NULL DEFAULT 1,                    -- v1, v2 … per project lineage
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PLANNED','ARMED','ACTIVE','READY','NEEDS_OWNER','STALE','CLOSED','CANCELLED','EXPIRED','FAILED')),
  status_reason TEXT NOT NULL DEFAULT '',
  mission_id TEXT, envelope_id TEXT, envelope_hash TEXT, ops_plan_id TEXT,
  template_json TEXT NOT NULL, template_sha TEXT NOT NULL,   -- frozen at PLANNED (capture scripts, story, variant, summary template, tools identity, export folder)
  ops_steps_json TEXT NOT NULL, ops_body_sha TEXT NOT NULL,  -- the exact package steps + hashCanonical(opsPlans.buildBody(steps))
  consent_json TEXT,                                     -- copy of the envelope consent at ARM {channel, modality, sessionId, credential(10), envelopeHash, confirmedAt, policyVersion}
  activate_by TEXT, activated_at TEXT, phase_expires_at TEXT,
  bundle_id TEXT, bundle_sha TEXT, change_set_id TEXT, change_set_sha TEXT, snapshot_sha TEXT, spec_version INTEGER, spec_sha TEXT,
  binding_sha TEXT,                                      -- hashCanonical({templateSha, opsBodySha, bundleSha, changeSetSha, snapshotSha, specSha})
  generation INTEGER NOT NULL DEFAULT 0,                 -- software generation (bumped only by a new bundle)
  content_project_id TEXT, edit_project_id TEXT,
  labels_json TEXT NOT NULL DEFAULT '[]',                -- SYNTHETIC_DATA, LOCAL_ONLY, SIMULATION when applicable
  verified_json TEXT NOT NULL DEFAULT '{}',              -- last snapshot check {at, by, expected, actual, equal, changedFiles[<=20]}
  created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, closed_at TEXT, version INTEGER NOT NULL DEFAULT 1);
CREATE INDEX idx_deliveries_project ON deliveries(project_id, updated_at);
CREATE INDEX idx_deliveries_mission ON deliveries(mission_id);
CREATE UNIQUE INDEX ux_deliveries_envelope ON deliveries(envelope_id) WHERE envelope_id IS NOT NULL;
CREATE UNIQUE INDEX ux_deliveries_open_project ON deliveries(project_id) WHERE status IN ('ARMED','ACTIVE');

CREATE TABLE delivery_items (
  id TEXT PRIMARY KEY,                                   -- dli_*
  delivery_id TEXT NOT NULL REFERENCES deliveries(id),
  kind TEXT NOT NULL CHECK (kind IN ('bundle','e2e_shot','preview','capture','brief','claim','edit','render','variant','qa','export')),
  role TEXT NOT NULL DEFAULT '',                         -- desktop | mobile | master | vertical | AC-6 | AC-7 …
  ref_table TEXT NOT NULL, ref_id TEXT NOT NULL, ref_sha TEXT NOT NULL DEFAULT '',
  snapshot_sha TEXT NOT NULL DEFAULT '',                 -- the software snapshot this item is evidence of ('' only for brief)
  generation INTEGER NOT NULL DEFAULT 1,
  upstream_json TEXT NOT NULL DEFAULT '[]',              -- delivery_items ids it derives from (real links)
  supersedes_id TEXT,                                    -- the previous item of the same kind+role
  status TEXT NOT NULL DEFAULT 'CURRENT' CHECK (status IN ('CURRENT','SUPERSEDED','STALE')),
  stale_code TEXT NOT NULL DEFAULT '',                   -- SOFTWARE_CHANGED | RIGHTS_REVOKED | FILE_MISSING | STUDIO_CORRECTED
  status_reason TEXT NOT NULL DEFAULT '',
  meta_json TEXT NOT NULL DEFAULT '{}',                  -- viewport, dsf, captureLabel, snapshotBefore/After, qa summary, creative state, brief prefs {tone, jump}
  created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX idx_delivery_items_delivery ON delivery_items(delivery_id, kind, status);
CREATE INDEX idx_delivery_items_ref ON delivery_items(ref_table, ref_id);

CREATE TABLE delivery_documents (
  id TEXT PRIMARY KEY,                                   -- ddoc_*
  delivery_id TEXT NOT NULL REFERENCES deliveries(id),
  kind TEXT NOT NULL CHECK (kind IN ('commercial_summary')),
  version INTEGER NOT NULL, parent_id TEXT,
  sections_json TEXT NOT NULL, text TEXT NOT NULL, content_sha TEXT NOT NULL,
  basis_json TEXT NOT NULL, basis_sha TEXT NOT NULL,     -- bundle sha, criteria statuses, the item ids used by the video section, serviceRefs id@version, owner profile hash
  claims_to_verify_json TEXT NOT NULL DEFAULT '[]', warnings_json TEXT NOT NULL DEFAULT '[]',
  author_kind TEXT NOT NULL CHECK (author_kind IN ('template','owner','mixed')),
  status TEXT NOT NULL CHECK (status IN ('CURRENT','SUPERSEDED','STALE')),
  stale_reason TEXT NOT NULL DEFAULT '',
  approval_json TEXT,                                    -- {kind:'PRESENTATION_READY', sha, sessionId, at}; never carried to a new version
  export_json TEXT NOT NULL DEFAULT '{}',                -- {md:{file, sha256}, html:{file, sha256}}
  created_by TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE (delivery_id, kind, version));

CREATE TABLE delivery_revisions (
  id TEXT PRIMARY KEY,                                   -- drv_*
  delivery_id TEXT NOT NULL REFERENCES deliveries(id),
  text_redacted TEXT NOT NULL,
  classes_json TEXT NOT NULL DEFAULT '[]',               -- feedback | tone | clip | vertical | summary | software
  target_json TEXT NOT NULL DEFAULT '{}',                -- {kind, id, versionId, timecodeMs, selection}
  delta_json TEXT NOT NULL DEFAULT '{}',                 -- brief delta, prefs, ops, reviewId
  clarification_json TEXT,                               -- the ONE question + options while CLARIFY
  status TEXT NOT NULL CHECK (status IN ('NOTED','CLARIFY','PROPOSED','APPLIED','ROUTED_SOFTWARE','REFUSED','CANCELLED')),
  ops_plan_id TEXT, review_id TEXT, document_id TEXT, child_delivery_id TEXT,
  source TEXT NOT NULL, channel TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX idx_delivery_revisions_delivery ON delivery_revisions(delivery_id, created_at);

WHAT EACH ITEM KIND POINTS TO (ref_table / ref_id)
- bundle → factory_bundles (ref_sha = bundle sha256)
- e2e_shot → factory_evidence (meta: criterion, viewport, screenshot file name)
- preview → supervisor key + factory_evidence PREVIEW id
- capture → media asset version (ref_sha = file sha256; meta: capture session id, origin, viewport, dsf, label, snapshot before/after, markers)
- brief → content_briefs
- claim → content_claims
- edit → media_edit_versions (ref_sha = ir_sha256)
- render → asset version (meta: renderJobId)
- variant → media_variants (+ the variant's edit version id in meta)
- qa → QA runId
- export → absolute file (ref_sha = sha256)

JSON-ONLY ADDITIONS IN EXISTING COLUMNS (API contract 13)

1. mission_envelopes.body_json.delivery. It is hashed, and absent on every ordinary plan, so their hash is unchanged (golden test). Shape:
{ schema:1, deliveryId, mode:'new'|'refresh', parentDeliveryId, missionId, issueTitle,
  data:{ kind:'synthetic', marker:'.ifrim-hub-test.json', banner:'Date sintetice · demo local' },
  route:'windows', preview:{ origin, command },
  captures:[{ role:'desktop'|'mobile', viewport, dsf, fps:30, maxDurationMs:60000, stepsSha }],
  story:{ template:'delivery-presentation-v1', tone:'both', canvas:'1920x1080', fps:'30/1', variant:{ platformKey:'shorts_9x16', overridesSha } },
  summary:{ template:'commercial-summary-v1', serviceRefs:[] },
  tools:{ ffmpeg:{version, sha256, libsSha256}, ffprobe:{…}, chromium:{version} },
  exports:{ dir, folder }, limits:{ phaseMinutes:30, maxActions:120 },
  ops:{ kind:'delivery.package', stepTitles:[…], bodySha },
  outputs:[…], never:[…], decisionsLeft:[…] }

2. mission_envelopes.summary_json.delivery holds the card lines. One sentence is also appended to summary.steps and summary.stops, so M10.2 cards show the delivery before the UI change.

3. ops_plans for derived plans (kind 'delivery.package'):
   - consent_json = { channel:'owner_session', modality:'derived', derivedFrom:{ kind:'envelope', id, hash, confirmedAt, deliveryId }, sessionId, credential, planHash };
   - authority_json = authorityOf(plan, sessionId) with its own expiresAt. No new column.

4. media_capture_sessions.scope_json carries { kind:'delivery_preview', deliveryId, bundleSha, snapshotSha, origin, role, dataKind:'synthetic' }. Free-form fields are allowed (capture.mjs:475-489).

5. Capture markers of kind 'highlight' carry rect {x,y,w,h}, normalized to the viewport.

6. media_variants.status 'INVALIDATED' is now written, with notes_json.invalidated {reason, at, by}.

7. content_claims.evidence gains {kind:'bundle', ref, sha256} and {kind:'test', ref:evidenceId} entries (existing kinds, content.mjs:48).

DELIVERY STATUS MACHINE
- PLANNED → ARMED: inside the envelope confirm transaction.
- PLANNED → CANCELLED: the envelope is SUPERSEDED, EXPIRED, CANCELLED or REVOKED before confirmation, or propose returned no envelope.
- PLANNED → ACTIVE: a delivery-only package confirmed through opsPlans.confirm (no envelope).
- ARMED → ARMED: a continuation envelope re-arms the same row (envelope_id replaced in that confirm transaction).
- ARMED → ACTIVE: activation.
- ARMED → CANCELLED: the envelope is REVOKED, CANCELLED or FAILED_TO_START; the mission is REJECTED or CANCELLED; or Stop All.
- ARMED → EXPIRED: the envelope EXPIRED, or activate_by passed.
- ARMED → FAILED: the activation checklist failed. The reason is kept and a re-package card is offered.
- ACTIVE → READY: finish.
- ACTIVE → NEEDS_OWNER: the plan is PAUSED, NEEDS_OWNER or FAILED (also after a Hub restart: ops recover() → NEEDS_OWNER).
- NEEDS_OWNER → ACTIVE: the plan is resumed.
- READY or NEEDS_OWNER → STALE: the software binding changed.
- READY, STALE or NEEDS_OWNER → CLOSED: the owner closes it, or a child delivery becomes READY („înlocuită de …”).

ITEM STATUSES
- CURRENT
- SUPERSEDED: a newer version of the same role exists; the old one is still valid for what it was made from.
- STALE: its software basis, rights or source file changed, so it no longer proves anything. It never returns to CURRENT.
- A document version follows the same CURRENT / SUPERSEDED / STALE rules.

## MODULES
- v2/server/storage/migrations.mjs [changed (wave A)] Append migration 12 `m11-deliveries` with exactly the DDL in dataModel. No data rewrites. | reuses: Migration list pattern migrations.mjs:980-1036 (v10/v11); the server-side pre-migration backup of the upgrade runner (v2/scripts/upgrade.mjs)
- v2/scripts/migration-dry-run.mjs [changed (wave A)] Add the M11 table group (deliveries, delivery_items, delivery_documents, delivery_revisions) to the counts and schemaAfter check. | reuses: Existing table groups in migration-dry-run.mjs
- v2/server/config.mjs [changed (last unit)] Set HUB_VERSION to '2.13.0-m11' and API_CONTRACT to 13, after P0's 2.12.1 / 12. | reuses: config.mjs:10, 19
- v2/server/delivery/template.mjs [new (pure)] buildTemplate({ project, marker, missionView, demo, tools, chromium, exportsDir, simulation }) returns the frozen template, sectionOf(template) the hashed envelope block, and packageSteps(template, deliveryId) the ≤12 ops steps. Their params hold only deliveryId, role and `$pas:` refs, so the ops body is deterministic at proposal.

captureScriptFrom(e2eSteps, { noun, role, proofSelector }) maps the APPROVED E2E steps to demo steps:
- viewport → the context viewport (desktop 1280x720@1.5, mobile 390x844@2)
- goto → goto, then marker chapter
- fill → type ({run} → 'Prezentare')
- click → highlight + click (the first click gets a marker demo '<noun> <role>')
- expectSelector → waitFor + highlight
- expectText → waitFor(proofSelector) + marker proof (note = the text)
- noHorizontalOverflow → dropped
- select → REFUSED (eligibility blocker; the booking fixture uses none)
The output must pass validateDemoSteps.

eligibility(ctx) returns blockers when:
- the project is not hub-test, or its marker is not data:'synthetic';
- the route is not windows;
- the spec has no preview, or lacks an E2E criterion at width ≤ 480 and one at ≥ 1024;
- the preview port is in LIVE_PORTS;
- the plan has more than one mission;
- exportsDir is not inside the approved folders;
- Playwright is missing;
- ffmpeg/ffprobe are CHANGED or MISSING (UNPINNED → pin pre-step). | reuses: factory/spec.mjs:112-123 (preview rule); tools/browser-core.mjs:170-198 validateE2ESteps; media/capture.mjs:297-342 validateDemoSteps, 348-362 checkDemoOrigin; ops/intent-actions.mjs:30-44 studioRenderReadiness; tools/browser.mjs:62 browserStatus; core/canonical.mjs hashCanonical; factory/fixtures.mjs FACTORY_DEMOS[*].delivery
- v2/server/delivery/capture-guard.mjs [new (pure + one loopback probe)] - LIVE_PORTS = {8011, 8012, 3011, 3004, 8004, config.port, ports of config.allowedOrigins}, applied REGARDLESS of test mode; this closes the test-mode relaxation at capture.mjs:357-358.
- assertSyntheticProject(project, marker): source 'hub-test'; marker createdBy 'ifrim-agent-hub', fixture known, data 'synthetic'; the path is a direct child of PROJECTS_ROOT and is neither the Hub root nor a data dir.
- checkPreviewTarget({ origin, delivery, supervisor }) requires all of:
  - the origin equals the template origin and the bundle manifest start.url origin;
  - http on 127.0.0.1/localhost with an explicit port;
  - the port is not in LIVE_PORTS and checkDemoOrigin reports liveHub false;
  - supervisor.get('factory-preview-<mission>') or supervisor.get('delivery-preview-<dlv>') is alive.
- probeNotHub(origin): GET / and /api/session; refuses with CAPTURE_TARGET_IS_HUB when an X-Hub-Version or X-Hub-Contract header is present.
- pageGuard({ bannerSelector }): an async (page) check. The synthetic banner must be visible; redactText(innerText) === innerText; there are no absolute user paths (C:\\Users\\, /home/) and no e-mail outside example domains. | reuses: capture.mjs:348-362 checkDemoOrigin (first filter); http/server.mjs:85-86 X-Hub-Version header; domain/projects.mjs:188 TEST_PROJECT_MARKER; security/redact.mjs redactText; factory/runner.mjs:220-235 probeUrl
- v2/server/delivery/clip-ir.mjs [new (pure)] buildMasterIR({ captures:[{ role, assetVersionId, durationMs, width, height, captureLabel, markers }], texts, tone, claimIdsByCriterion, passed, prefs, fps:{30,1}, canvas 1920x1080 }) returns a valid EditProjectIR v1.

Contents:
- Video track: c-desktop then c-mobile, both fit 'contain', with HARD CUTS only, so a later cut_range can never touch a transition (review.mjs:471).
- Focus comes from the first highlight rect.
- Clip labels are SIMULATION when the capture label is.
- A label text track covers 100% of the timeline: 'DATE SINTETICE · DEMO LOCAL', or 'SIMULARE · DATE SINTETICE · DEMO LOCAL' (LABEL_WORDS whole word).
- Tone text items have stable ids t-hook, t-desktop, t-mobile, t-cta. Each is included only when all its criteria are PASS.
- IR markers: chapter 'intro', demo 'programare desktop', demo 'programare mobil', evidence 'interval ocupat pe telefon', cta. Frame = round(ms·30/1000) + the clip offset.
- evidenceRegions come from highlight rects mapped through contain-fit, each with its claimId.
- meta: labels, author 'delivery:<id>', notes 'fără model'.

Other exports:
- toneOps(ir, texts, tone): replace_text ops on t-* items only.
- applyPrefs(ir, prefs): the jump {afterSec, markerNote} becomes cut_range [afterSec, first matching marker); used when regenerating after a software change. | reuses: media/ir.mjs validateIR (382), irHash (277), msToFrames (140), timelineDuration (178), MARKER_KINDS (57), DISCLOSURE_LABELS (61); visual-bible.mjs preset 'ifrim-business'; qa.mjs:56-61 LABEL_WORDS; variants.mjs FULL_RECT for the contain mapping
- v2/server/delivery/summary.mjs [new (pure)] Exports:
- renderDeliverySummary({ project, synthetic, simulation, bundle:{id, sha, manifest}, e2e[], media:{master, vertical, exports}, services, owner, generatedAt }) → { title, sections, claimsToVerify, warnings, basis, basisSha, text, contentSha }
- applySectionEdits(prev, edits, actor)
- regenerate(prev, fresh, { only:['video'] | 'all' })
- assertNoInventedFacts(text, allowedFacts)
- toMarkdown / toHtml (escaped, self-contained, no script, no external URL)
Section rules and texts are in summaryRenderer. | reuses: sales/proposal.mjs:18 NOT_CONFIGURED, 33 clean, 47 findUnresolvedPlaceholders, 80 priceText, 90 leadTimeText, 97 materialLines (exported, unchanged); section-edit rules mirrored from sales/sales.mjs:1037-1073 and the displayedSha approval from sales.mjs:1075-1089
- v2/server/sales/proposal.mjs [changed (exports only, wave A)] Add named exports for NOT_CONFIGURED, clean, priceText, leadTimeText and materialLines. No behaviour change; the proposal tests stay green. | reuses: —
- v2/server/delivery/stale.mjs [new (pure)] - RULES: a table of trigger → affected kinds → status (STALE | SUPERSEDED) + stale_code + reason.
- cascade(items, rootIds, { mode, code, reason }): BFS over upstream_json. Idempotent; never revives an item.
- currentView(items, delivery): an item is current only when status is CURRENT, its snapshot_sha equals delivery.snapshot_sha (brief excepted) and the delivery is not STALE or CLOSED.
- variantsToInvalidate(updates) and documentsToStale(updates).
- slotsComplete(items): bundle, capture desktop + mobile, edit master, render master, variant, render vertical, qa ×2, export ×2. | reuses: The walk idea of rights.revocationImpact (rights.mjs:274-326)
- v2/server/delivery/revision.mjs [new (pure)] classify(text, ctx) → clauses [{ class: feedback|tone|clip|vertical|summary|software|unknown, target, ops, brief, prefs }].

Target order:
1. the Room selection {kind, id, versionId};
2. a timecode → the clip;
3. artifact words (clip/video/secunda/montaj → master; vertical/9:16 → variant; rezumat/ofertă/secțiunea → summary; site/aplicația/butonul/formularul/pagina + a change verb → software);
4. the artifact last revised in this delivery within 10 min;
5. otherwise ONE clarification, only when ≥2 targets are plausible.

Rules:
- toneFrom: 'prea tehnic' → business; 'prea comercial' → technical.
- jumpToMarker: „după/de la secunda N arată direct|sari la|treci la X” → cut_range{ from: frame(N), to: the first IR marker after N whose normalized note contains X }. No match, or two markers at the same frame → ONE question listing the markers with their times.
- Text edits are delegated to parseInstruction with the selection valid on the current version only.
- 'Site-ul e bine' → feedback only; never acceptance.
- software needs a software noun AND a change verb, so a text change never becomes coding. | reuses: media/review.mjs:180 parseInstruction, 167 preferredTextTarget, 41 NUM_WORDS (via parseInstruction); delivery/clip-ir.mjs toneOps; owner/intents.mjs normalize
- v2/server/delivery/delivery.mjs [new (service)] Owns every write to the four tables.

Row lifecycle:
- createPlanned / reusePlanned (same mission and same template sha);
- sectionFor(id, { forConfirm }): recomputes template + ops body sha from current state;
- sectionForMission(missionId): for continuations of an ARMED delivery;
- arm(id, { envelopeId, envelopeHash, consent, expiresAt }): compare-and-set inside the envelope confirm transaction; throws to roll back;
- activate(envelopeId): the activation checklist in planAndAuthority, then bind bundle + e2e_shot items (generation 1), then opsPlans.adoptDerived;
- proposePackage(id): the delivery-only / re-package card via opsPlans.propose.

Items and versions:
- bindItem / supersede / markStale (stale.mjs + variants.invalidate + distribution.checkInvalidation);
- verify(id, by): factory.snapshotCheck; drift → cascade;
- documents: render / edit / approve / bindService, all versioned;
- revisions: record / propose / apply / route.

Other:
- view(id), list(projectId), latestForProject;
- close / cancel;
- tick(): activation retry within activate_by after a restart; verify READY deliveries every 10 min.

Bus listeners, all post-commit and deferred like envelopes.mjs:1534-1537: envelope.status, factory.stage, factory.change_set, factory.bundle.status, ops.plan.*, system.stop_all, project freeze, media.review.applied, media.variant.corrected, media.rights.revoked, media.asset.missing, sales.service.saved.

It registers parent kind 'envelope' on opsPlans with verify() and DELIVERY_PHASE_OPS. | reuses: factory.view (factory.mjs:1491-1534) + new snapshotCheck/deliveryBinding/previewStatus; envelopes.get; opsPlans.propose (plans.mjs:148) + new adoptDerived; content.createProject/saveBrief/saveClaim (content.mjs:320, 433, 566); rights.revocationImpact (rights.mjs:274); distribution.checkInvalidation (distribution.mjs:373); sales services + ownerProfile (sales.mjs:1032); trust credential/policy reads; bus.transaction/append
- v2/server/delivery/executors.mjs [new] Ops step executors, each with describe (pure, deterministic), run (authorize at every op) and reconcile. They are merged into hub.executors, the same object opsPlans reads lazily.

- delivery.prepare (ops delivery.verify, delivery.bind): the bundle is READY_FOR_OWNER_ACCEPTANCE or OWNER_ACCEPTED; every test and preview criterion PASS; snapshotCheck equal. Creates or reuses the content project „Livrare: <proiect> — demo” and brief v1 (audience both, template texts).
- delivery.preview.ensure (op delivery.preview): reuse factory-preview-<mission> when alive and probeUrl answers 2xx/3xx; otherwise snapshot check, then runner.startPreview with key delivery-preview-<dlv> (Windows route only; an occupied port is refused by the runner).
- delivery.capture {role} (op capture.preview): see capturePolicy. It re-ensures the preview first, so it is idempotent after an acceptance stopped the factory preview.
- delivery.edit.build (ops media.edit.apply, delivery.bind): claims SUPPORTED only for PASS criteria (evidence bundle + test), then buildMasterIR, then media.edits.create, then bind edit/brief/claim items. Result {editVersionId}.
- delivery.revise.apply (ops media.edit.apply, delivery.bind): brief v+1 if the tone changed; media.reviews.apply(reviewId) of the precomputed OPEN review; supersede links. Result {editVersionId}.
- delivery.export (op export.local, destination exportsDir/<folder>): media.exportLocal of master and vertical with folder 'demo-programari-<slug>-<yyyymmdd>' and names demo-16x9-v<n>.mp4 / demo-9x16-v<n>.mp4; never overwrites; sha verified.
- delivery.summary.render (ops delivery.summary, export.local): renders or regenerates a document version; files.writeNew rezumat-v<n>.md/.html in the same folder.
- delivery.finish (ops delivery.bind, delivery.preview): binds render, variant, qa and export items from the `$pas:` result params with upstream links; marks the previous items SUPERSEDED; stops only delivery-preview-<dlv> (never factory-preview-*); slotsComplete + verify equal → READY.

Reconcile:
- capture → done if its session is STOPPED with an output asset; otherwise retry.
- edit, summary, export and finish are idempotent by item or content sha. | reuses: factory/runner.mjs:146-180 startPreview, 205-217 portInUse, 220-235 probeUrl; runtime/supervisor get; media/capture.mjs:494 planSession, 759 captureBrowserDemo; media/edits.mjs:33 create; media/review.mjs:801 apply; media/index.mjs:83 exportLocal (+folder); content.mjs saveBrief/saveClaim
- v2/server/delivery/files.mjs [new] writeNew(dir, name, buffer): a single-segment name; open with flag 'wx' (never overwrite; the next free suffix on a clash); read back and verify the sha256; the target must stay inside exportsDir (realpath). Used for the summary .md/.html. | reuses: The no-overwrite/sha rules of media/index.mjs:83-112; action-policy insideAny
- v2/server/delivery/delivery-commands.mjs [new] Commands:
- delivery.verify: ANY; fail-safe, it can only mark stale.
- delivery.package.propose: OWNER_UI + owner session; the delivery-only / re-package card.
- delivery.revise: OWNER + owner session; Lega reaches it through the intake.
- delivery.summary.edit: OWNER_UI + session; creates a new version.
- delivery.summary.approve: OWNER_UI + session; displayedSha must equal the CURRENT version.
- delivery.summary.service: OWNER_UI + session; binds a CONFIGURED catalog service only, which creates a new version.
- delivery.software.accept: OWNER_UI + session. displayedBundleSha must equal the delivery's bundle and the mission's current READY bundle. It refuses while a capture step is RUNNING („aștept capturile sau oprește planul”), then dispatches ONLY factory.accept.
- delivery.preview.start: OWNER_UI + session; synthetic hub-test, snapshot equal.
- delivery.preview.stop: ANY.
- delivery.close: OWNER_UI.
- delivery.cancel: ANY; pauses or cancels the package plan, nothing else.

None is on the agent, schedule or cli channel except the fail-safe verify, stop and cancel. None writes a creative approval, a rights record or a manifest. | reuses: ops/ops-commands.mjs:11-18 channel sets and session helpers; runtime/command-catalog.mjs:225 factory.accept; trust.requireSession
- v2/server/delivery/delivery-routes.mjs [new] Routes:
- GET /api/deliveries?projectId=
- GET /api/deliveries/:id: the aggregated view (contract in deliveryRoomUI).
- GET /api/deliveries/:id/evidence/:evidenceId/screenshot: the row must be a non-stale E2E evidence of the delivery's mission; name /^e2e_[A-Za-z0-9_-]+\.png$/; realpath inside workRoot(mission)/e2e; image/png.
- GET /api/deliveries/:id/summary/:version.(md|html): text/markdown or escaped text/html with CSP default-src 'none'.
- POST /api/deliveries/:id/:action: an allowlist mapped to commands, owner session cookie; agent and cli get 403.
Videos reuse GET /api/media/files/:versionId (media-routes.mjs:101). | reuses: ops/ops-routes.mjs dispatch/sessionOf pattern; factory.e2eShotPath (new)
- v2/server/owner/planners/delivery.mjs [new (wave B)] prepare(step, ctx) for delivery_prepare:
1. Project: the cockpit project, or the only synthetic hub-test project with a fixture delivery block, or ONE question.
2. Agreed issue: the single SPEC_DRAFT; else FACTORY_DEMOS[marker.fixture].issue prepared as a draft via hub.prepareFactoryMission (provenance 'delivery-planner', explicit roles = PILOT_MODELS); two drafts → ONE question. A started mission of that issue → continuation.
3. An existing READY or OWNER_ACCEPTED bundle that needs no repair → delivery-only ops card.
4. Blockers (template.eligibility + collectFacts) are explained once and the request is kept as a work request with intent 'delivery'.
5. Otherwise createPlanned, then envelopes.propose({ missionIds:[m], deliveryId, constraints }), returning { kind:'envelope' }.

revise(step, ctx) for delivery_revise: revision.classify, then:
- feedback → NOTED + message;
- summary → direct new document version (owner session);
- clip/tone/vertical → media.reviews.proposeOps (OPEN review with a validated preview), then ONE ops card 'delivery.revise';
- software → engineering draft (buildEngineeringSpec) + envelope whose delivery section is mode 'refresh' with parentDeliveryId (new delivery row);
- ambiguous → ONE question.
Never accepts, approves or publishes. | reuses: owner/planners/engineering.mjs:145 buildEngineeringSpec, 196 createBlockedRecorder, 230 defaultsFor; owner/readiness-runner.mjs:75 collectFacts, 161 onlyAfterConfirmation; owner/blockers.mjs:253 explain; envelopes.propose (envelopes.mjs:409); runtime/command-catalog.mjs:168 prepareFactoryMission; intel/packages.mjs:58 PILOT_MODELS
- v2/server/factory/factory.mjs [changed (additive, wave A; not a P0 file)] Read-only additions:
- snapshotCheck(missionId) → { bundleId, bundleStatus, changeSetId, expected, actual, equal, changedFiles≤20 }: takeSnapshot(project.path, { ignore: ignoreOf, mode: baseMode }), exactly as accept; no status write.
- deliveryBinding(missionId) → { bundleId, bundleSha, bundleStatus, changeSetId, changeSetSha, snapshotSha, specVersion, specSha, startUrl, criteria, e2e:[{ criterion, evidenceId, status, screenshot, viewport }] }.
- previewStatus(missionId) → { key, running, pid, url }.
- e2eShotPath(missionId, evidenceId).

Events: emit `factory.bundle.status` {bundleId, status, reason} at the STALE writes (new bundle 1119, accept drift 1135), OWNER_ACCEPTED (1142) and REJECTED (1165), inside the same transactions.

Add these to the return object. | reuses: factory.mjs:431-433 ignoreOf/baseMode, 1127-1137 accept computation, 1060-1125 buildBundle manifest, 53 workRoot; snapshot.mjs takeSnapshot/diffManifests
- v2/server/ops/plans.mjs [changed (additive, wave A; not a P0 file)] registerParent(kind, { verify, allowedOps }).

adoptDerived({ kind, title, steps, limits, parent:{ kind, id, hash, confirmedAt, deliveryId }, expectedBodySha, sessionId, credential }) builds the body with the SAME buildBody/classifier and refuses with:
- PLAN_DERIVED_CHANGED: the hash differs from expectedBodySha;
- a non-empty decisions list;
- body.model;
- any step with apps;
- any op outside allowedOps;
- the parent kind is not registered, or its verify fails;
- the expiry would already have passed.

Otherwise it inserts the plan CONFIRMED with its steps, the derived consent, authority = authorityOf(p, sessionId) and expires_at = now + (limits.maxDurationMin + PLAN_LIMITS.slackMin), the same formula as propose (plans.mjs:159). It emits ops.plan.derived and calls start().

authorize(), resume() and reconfirm() are UNCHANGED (default; see openDecisions). adoptDerived is not exposed by any command. | reuses: plans.mjs:83-141 buildBody, 254-263 authorityOf, 266-294 authorize, 297-341 start, 368-441 resume/reconfirm (same-credential delta), 446-456 recover
- v2/server/policy/action-policy.mjs [changed (wave A)] OPERATIONS += 'delivery.verify', 'delivery.preview', 'delivery.bind', 'delivery.summary', 'capture.preview', all PLAN_STEP. Owner decisions (owner.accept, creative.approve, rights.record, summary.approve, manifest.approve) stay unknown ops, so they are SENSITIVE and refused inside any plan. | reuses: action-policy.mjs:16-26 OPERATIONS, 72-87 classifyAction
- v2/server/ops/executors.mjs [changed (additive, wave A)] media.render and media.variant.render accept an optional qaUse, forwarded to media.qa.run({ use }). media.variant.render also accepts optional overrides, forwarded to variants.derive. Params are emitted by describe ONLY when given, so existing plan bodies hash identically (regression test). | reuses: executors.mjs:189-215; qa.mjs:734 run({use}); variants.mjs:672 derive({overrides})
- v2/server/media/capture.mjs [changed (additive, wave A)] - The highlight step also records a marker {kind:'highlight', atMs, note: selector, rect}, where rect = locator.boundingBox() / viewport, clamped to 0..1.
- An optional input.pageGuard(page) runs after the redaction check of every navigation and after every step. A throw becomes CAPTURE_PRIVACY_REFUSED, and the existing failure path wipes the frames (1010-1033).
- No change to checkDemoOrigin, the live-Hub refusal (759-768), OBS/MB1 or contextSetup. | reuses: capture.mjs:853-889 navigate/redaction, 935-943 highlight, 1010-1033 failure cleanup
- v2/server/media/review.mjs [changed (additive, wave A)] createReviews.proposeOps({ editVersionId, ops, text, provenance, actor, sessionId }): explicit REVIEW_OPS only. It runs the same applyOps + validate + diffIR preview as propose and records an OPEN review (kind CHANGES_REQUESTED). apply() is unchanged. | reuses: review.mjs:31 REVIEW_OPS, 572 applyOps, 632 diffIR, 769-799 propose, 801 apply
- v2/server/media/qa.mjs [changed (wave A)] run() enriches the 'bundle' evidence of each claim with factory_bundles.status. factualCheck adds an error CLAIM_EVIDENCE_STALE when a SUPPORTED claim cites a STALE or REJECTED bundle, so an old clip can never pass factual QA as evidence of new code. | reuses: qa.mjs:388-439 factualCheck, 734-760 run
- v2/server/media/content.mjs [changed (wave A)] saveClaim and setClaimStatus refuse status SUPPORTED when a cited bundle is STALE or REJECTED (CLAIM_EVIDENCE_STALE). verifyEvidence keeps its existence check. | reuses: content.mjs:556-562 verifyEvidence, 566-614 saveClaim/setClaimStatus
- v2/server/media/variants.mjs [changed (wave A)] createVariantService.invalidate(variantId, { reason, actor }) sets status INVALIDATED (idempotent), records notes_json.invalidated and emits media.variant.invalidated. This makes distribution's INVALIDATED branches reachable (distribution.mjs:266, 381). | reuses: variants.mjs:666-696
- v2/server/media/index.mjs [changed (additive, wave A)] exportLocal({ …, folder }): an optional single-segment folder /^[a-z0-9][a-z0-9-]{2,80}$/ created under exportsDir, with the same never-overwrite and sha-verify rules. Callers without folder are unchanged. | reuses: media/index.mjs:63-112
- v2/server/owner/envelopes.mjs [changed (wave B, after the P0 commit)] - attachDelivery(api): late-bound like attachRuns (463).
- propose({…, deliveryId}) and continuation proposals for a mission with an ARMED delivery: buildBody gets extras.delivery = sectionFor(…), spread only when present.
- summaryOf: summary.delivery lines plus one sentence appended to steps and stops.
- changedParts keys += 'delivery'; CHANGE_LABELS.delivery = „pașii de după livrare (captură, clip, rezumat)”.
- confirmImpl rebuilds with sectionFor(forConfirm) and calls deliveryApi.arm(...) INSIDE the CONFIRMED transaction (a throw rolls it back).
- limits.maxDurationMin, DENIED_EFFECTS, advance() and close() are unchanged. | reuses: envelopes.mjs:285-328 buildBody, 330-366 summaryOf, 409-457 propose/insertProposal, 799-958 confirmImpl, 960-970 changedParts, 71 CHANGE_LABELS
- v2/server/owner/intents.mjs [changed (wave B)] - Intents delivery_prepare (plan), delivery_revise (plan, only with a delivery context), delivery_open (navigate) and delivery_status (read). The patterns are placed before ops_capture_vertical, studio_create and engineering_request.
- NEVER_SPLIT += delivery_prepare, delivery_revise; START_LIKE += delivery_prepare.
- constraintsOf gains noPublish for /\bnu (publica|posta|urca|incarca)\b|\bfara (publicare|postare|upload|incarcare)\b/. The clause „Nu publica nimic.” therefore attaches as a constraint (intents.mjs:708-717) instead of becoming an 'unknown' step.
- noStart → previewOnly also applies to delivery_prepare. | reuses: intents.mjs:29-63 INTENT_EFFECTS, 340-390 pattern table, 516-527 constraintsOf, 553 START_LIKE, 609 NEVER_SPLIT, 748 noStart
- v2/server/owner/intake.mjs + v2/server/owner/work-requests.mjs [changed (wave B, ~10 lines)] - PLANNER_KINDS += 'delivery'.
- PLANNER_FOR_INTENT { delivery_prepare:'delivery', delivery_revise:'delivery' }.
- delivery_open navigates to /livrare/<id>.
- lastTarget kind 'delivery' is recorded.
- work-requests INTENTS += 'delivery', so a blocked delivery request is preserved and re-proposed when ready. | reuses: intake.mjs:36-41, 241-248 registerPlanner, 320 applyPlannerOutcome (envelope/ops/question/blocked kinds unchanged); work-requests.mjs:30
- v2/server/owner/layout.mjs [changed (wave B)] - CARD_TYPES.DeliveryRoom { refs:['delivery','project'], label:'Camera de livrare' }.
- exists() answers for kind 'delivery' within the project.
- layoutForIntent handles delivery_open and delivery_status. | reuses: layout.mjs:9-25, 34-96
- v2/server/owner/cockpit.mjs [changed (wave B)] - projectCockpit gains `deliveries` (open + latest 3: status, labels, stale reason, pending decisions) via attachDelivery.
- Fix the done list: b.status === 'OWNER_ACCEPTED' instead of 'ACCEPTED' || decided_at. Today REJECTED bundles are listed as done. | reuses: cockpit.mjs:171-200
- v2/server/hub.mjs + v2/server/runtime/command-catalog.mjs + v2/server/http/routes.mjs [changed (wave B wiring)] - Create the delivery service after media and opsPlans (hub.mjs:290-296).
- Object.assign(executors, createDeliveryExecutors(...)): buildBody reads the map lazily.
- opsPlans.registerParent('envelope', …).
- envelopes.attachDelivery; cockpit attach.
- registerDeliveryPlanner(hub, hub.intake), next to the run planner (hub.mjs:315).
- delivery.tick in extraTick (hub.mjs:356).
- registerDeliveryCommands next to 482-483; registerDeliveryRoutes next to routes.mjs:78-80. | reuses: hub.mjs:290-316, 356; command-catalog.mjs:478-483; routes.mjs:75-80
- v2/server/factory/fixtures.mjs + v2/scripts/create-factory-fixture.mjs + v2/fixtures/factory/booking-demo/** [new fixture + changed registry (wave A)] - FACTORY_DEMOS['booking-demo']: the spec plus a separate `delivery` block (noun, issue, texts per tone, proofSelector, bannerSelector, variant overrides).
- materializeFixture writes marker.data = 'synthetic'.
- The script uses DIR_MAP { bug-demo: ifrim-factory-demo-a, service-request: ifrim-factory-demo-b, booking-demo: ifrim-delivery-demo-detailing } and CHECK_FILE per fixture, replacing the binary choice at :15 and :24.
Details are in the fixture field. | reuses: fixtures.mjs:14-82; create-factory-fixture.mjs:12-42; Demo B conventions (node:http, node:sqlite, node:test, config.json port, workspace.ignore data)
- v2/tests/fixtures/factory-patches/booking-{fix,partial,tamper}.json + v2/tests/fixtures/factory-solutions/booking-demo/** [new test fixtures] Writer patches consumed by the EXISTING fake-codex scenario factory-write:<name> (fake-codex.mjs:151, 214):
- fix: the reference fix;
- partial: fixes the label only, so AC-1 still fails and a repair cycle is forced;
- tamper: edits the protected test, giving NEEDS_OWNER_DECISION.
No change to fake-codex.mjs. | reuses: fake-codex.mjs:29, 151, 214
- v2/web/src/screens/DeliveryRoom.jsx + v2/web/src/screens/delivery/{SoftwarePanel,PreviewPanel,ClipPanel,SummaryEditor,DecisionsPanel,ObservationsPanel}.jsx + v2/web/src/lib/deliveryLogic.js + v2/web/src/styles/m11.css [new UI (wave A, no shared files)] The Delivery Room, coded against the view contract in deliveryRoomUI. deliveryLogic.js is pure: chips, decision-to-command map, enable states, stale banners, timecodes and the summary diff. | reuses: screens/studio/Player.jsx, Variants.jsx, common.jsx; lib/markdown.js; lib/opsLogic.js and OpsPlanCard.jsx for plan progress; lib/ownerSession.js
- v2/web/src/main.jsx + v2/web/src/api.js + v2/web/src/screens/lega/cards.jsx [changed (wave B UI)] - The route livrare: lazy(DeliveryRoom) (main.jsx:36-40 pattern).
- The api client calls.
- DecisionCard renders summary.delivery.
- A compact DeliveryRoom cockpit card linking to #/livrare/:id. | reuses: main.jsx:21-50 screens/parseRoute; cards.jsx DecisionCard

## PLAN & AUTHORITY
ONE PLAN, ONE CONFIRMATION, ONE DERIVATION DIRECTION: the weaker ops-plan authority is derived from the stronger envelope consent, never the reverse. This extends the M10.2 zero-form pattern: no form, no manual grant, no mode change, BUILD_SAFE throughout.

1) PROPOSAL (no effect)

The planner first creates the delivery row PLANNED. It stores template_json/template_sha and the exact package steps; their params are deliveryId, role and `$pas:N.field` references, so the ops body is fully deterministic. It also stores ops_body_sha = hashCanonical(await opsPlans.buildBody({ kind:'delivery.package', title, steps, limits:{ maxDurationMin:30, maxActions:120 } })).

It then calls envelopes.propose({ projectId, missionIds:[m], deliveryId, constraints:{ noPublish:true } }). body.delivery = sectionFor(deliveryId) is hashed with the rest of the envelope.

The card shows the finite scope:
- Project / snapshot: project name, Windows route, baseSnapshot (repoState), spec sha, issue title.
- Data: only the project's synthetic data, with the marker and the visible banner. No real data.
- Environments:
  - the Codex Windows sandbox (network off) for the writer, runner and preview;
  - isolated headless Chromium (fresh context, only the preview origin) for E2E and capture;
  - local ffmpeg/ffprobe with their pinned identity.
- Tools: Codex writer, Claude reviewer (read-only), Playwright Chromium <version>, the Studio renderer.
- Models: writer Codex gpt-6.1-sol · medium and reviewer Claude sonnet · medium (PILOT_MODELS, explicit bindings, re-checked before every start). The delivery phase uses no model.
- Duration: mission ≤ 60 min (the envelope window is unchanged), then the delivery phase ≤ 30 min (hard stop 60) after DELIVERY_READY, if DELIVERY_READY arrives before the envelope expires.
  - L5 note: a test-first mission (step 0, the Hub-written acceptance test) has a 180-minute deadline (.ifrim/M11_L5_DESIGN.md §4), so it does not fit a 60-minute Delivery mission. A Delivery whose request no existing test proves needs its own decision on the duration; a request bound to the project's acceptance test keeps the 60 minutes.
- Repairs: up to 2 cycles included.
- Capture: only http://127.0.0.1:4620. Desktop 1280×720@1.5 and phone width 390×844@2, each ≤ 60 s. No audio, no Hub UI, no screen. The steps are those of the approved E2E criteria AC-7 and AC-6.
- Outputs: clip 16:9 + vertical 9:16, each with automated QA; commercial summary v1 (MD + HTML); a local folder in Videos\Ifrim Studio\Exporturi.
- Forbidden: publishing, upload, messages, commit/push/deploy, software acceptance, creative approval, rights records, summary approval, real data, other projects, invented prices or deadlines, OBS / screen / CapCut, any model after DELIVERY_READY.
- Decisions left to the owner: Accept local, creative approval (master, vertical), rights for public use, summary „gata de prezentare”.

2) CONFIRMATION

envelopes.confirmImpl (voice_first + owner session; click / Enter / typed / armed local voice) rebuilds the body, including sectionFor(deliveryId, forConfirm). Any change (spec, tools identity, Chromium version, port, route, template, exports folder, ops body sha) supersedes the card, naming „pașii de după livrare”.

In the SAME transaction that sets CONFIRMED, delivery.arm(deliveryId, { envelopeId, envelopeHash, consent, expiresAt }) runs:
- compare-and-set PLANNED→ARMED (or ARMED→ARMED for a continuation);
- consent_json = a copy of the envelope consent;
- activate_by = the envelope's expiresAt.
If arm throws, the confirmation rolls back and nothing starts.

startMission then runs as today:
- derived bound grants;
- the factory.start approval decided by the envelope (envelopes.mjs:1166-1195);
- BUILD_SAFE kept;
- no manual grant, no mode write.

3) ENGINEERING (unchanged)

The factory reaches DELIVERY_READY and builds the bundle. advance() closes the envelope COMPLETED and revokes its grants (envelopes.mjs:1485-1521). A NEEDS_OWNER_DECISION or an extra repair stays the existing contextual delta (envelopes.confirmDelta), never a form.

4) ACTIVATION (internal only)

Triggers: the envelope.status COMPLETED event of an envelope with body.delivery, and delivery.tick (retry after a Hub restart, until activate_by).

delivery.activate checks, in order; the first failure stops it:
1. Delivery ARMED, and delivery.envelope_id equals this envelope.
2. Now ≤ activate_by.
3. Factory stage DELIVERY_READY.
4. The bundle is the latest READY_FOR_OWNER_ACCEPTANCE of the mission, and its spec sha equals section.specSha.
5. snapshotCheck(mission).equal.
6. Tools identity (ffmpeg/ffprobe pin, Chromium version) equals section.tools.
7. The consent credential is still active and the voice_first policy is active.
8. No system.stop_all event after consent.confirmedAt.
9. The preview origin equals the bundle manifest start.url origin, equals the template origin.
10. The rebuilt ops body sha equals ops_body_sha.

If all pass, in one transaction:
- write the binding (bundle, change set, snapshot, binding_sha, generation 1);
- bind the bundle and e2e_shot items;
- status ACTIVE, with activated_at.

Then it calls opsPlans.adoptDerived({ kind:'delivery.package', steps, limits, parent:{ kind:'envelope', id, hash, confirmedAt, deliveryId }, expectedBodySha, sessionId: consent.sessionId, credential: consent.credential }).

On failure: FAILED or EXPIRED with the reason, ONE honest explanation, and the request kept as a work request. The Room offers the difference card: only the delivery phase, re-proposed with what changed (for example new tools), ONE confirmation in the owner session via opsPlans.propose/confirm.

adoptDerived:
- builds the body with the same classifier;
- refuses on a hash mismatch, any decision, a model, any app, an op outside DELIVERY_PHASE_OPS = {delivery.verify, delivery.bind, delivery.preview, capture.preview, media.edit.apply, media.render, media.variant, media.qa, export.local, delivery.summary}, an unregistered parent or a failing verify;
- inserts the plan CONFIRMED with consent { channel:'owner_session', modality:'derived', derivedFrom, sessionId, credential, planHash } and authority = authorityOf(per-step ops), expiresAt = now + 30 + 30 min;
- calls start().
No command, route, agent, cli or Lega tool can reach it (a catalog-scan test).

5) RUN

Every operation passes plans.authorize: status, expiry, the owner session still active, step, op, budget. Pause, Stop All, „Preiau eu” and a project freeze pause the plan; „Continuă” resumes it with the existing reconcile.

SESSION RULE (default, authorize() untouched). requireSession checks status and absolute expiry only; idle expiry is applied lazily when a cookie is presented (trust.mjs:173, 202-206). So:
- the phase continues when the page is closed;
- it stops at its next operation (SESSION_CLOSED → NEEDS_OWNER) only if the confirming session ended: logout, revoke, 8 h, or an idle expiry triggered by the owner returning after more than 30 min;
- „Continuă” then shows the existing same-credential delta (plans.mjs:368-441): one click, same limits, never a new plan.
The alternative (a parent-bound phase that never needs a live session) is an owner decision.

6) PACKAGE STEPS (10, or 11 with a pin pre-step)
1. delivery.prepare {deliveryId}
2. delivery.preview.ensure {deliveryId}
3. delivery.capture {deliveryId, role:'desktop'}
4. delivery.capture {deliveryId, role:'mobile'}
5. delivery.edit.build {deliveryId}, returning {editVersionId}
6. media.render {editVersionId:'$pas:5.editVersionId', profile:'final', qaUse:'internal'}
7. media.variant.render {masterVersionId:'$pas:5.editVersionId', platformKey:'shorts_9x16', qaUse:'internal', overrides}
8. delivery.export {deliveryId, master:'$pas:6.assetVersionId', vertical:'$pas:7.assetVersionId'}
9. delivery.summary.render {deliveryId}
10. delivery.finish {deliveryId, render:'$pas:6.renderJobId', variant:'$pas:7.variantId', verticalEdit:'$pas:7.editVersionId'}
A media.tools.pin {expect} step is prepended only when the tools are UNPINNED; it is not the live case.

7) DELIVERY-ONLY, RE-PACKAGE AND REVISIONS

These are ordinary ops plans: opsPlans.propose, then ONE confirmation in the owner session (click, or the armed voice window), with kind 'delivery.package' or 'delivery.revise'. A revision card shows only the difference: what changes, what is redone, and what stays.

8) WHAT IS DENIED, AND WHERE IT IS ENFORCED
- Publish, upload, send, purchase: action-policy REFUSED (:25), NEVER_IN_PLANS (plans.mjs:20), envelope DENIED_EFFECTS (:46-47), apiRelease always refuses; no delivery command publishes.
- owner.accept, creative approval, rights, summary approval: unknown ops, so SENSITIVE and refused in plans (plans.mjs:105-121, 134). No executor exists for them. They exist only as owner-session commands. reviews.decide refuses CREATIVE_APPROVED without a session (review.mjs:862-865).
- model.run: SENSITIVE and refused; adoptDerived also refuses body.model.
- capture.obs: SENSITIVE without MB1, and not in any delivery template.
- Live origins: refused by the capture guard regardless of test mode, and again by checkDemoOrigin.
- Another or a real project: refused by template eligibility (hub-test + synthetic marker).
- New folders or apps: a decision inside a derived plan is refused.
- Cost: subscription-only models, none after DELIVERY_READY.

9) LIMITS BEYOND THE CARD

These are contextual decisions on the difference, never a form:
- an extra repair cycle or attempt → envelopes.confirmDelta;
- a longer phase, a new folder, another project, real data or cost → a new plan showing only the difference, or refused.
A repair inside the card needs no new grant.

The M11 pilot has its own owner approval; nothing in the code reads the P0 probe approval.

## CAPTURE POLICY
MB1 (mediaPolicy.liveCapture=false) stays UNCHANGED, and M11 neither reads it as permission nor writes it.

MB1 keeps governing every capture of the owner's real environment:
- OBS / screen: capture.obs is SENSITIVE without liveCapture (action-policy.mjs:85), and startObsRecording refuses.
- The live Hub UI: 8011, 3011, config.port, allowedOrigins (capture.mjs:759-768).
- Any non-test origin.

THE DELIVERY CAPTURE IS NEITHER. It is a new, narrower class (op capture.preview, PLAN_STEP), reachable only through the delivery.capture executor of a delivery plan. It is a headless, fresh Chromium context on a Hub-started, snapshot-verified loopback preview of a sanitized hub-test project with synthetic data. The owner's screen, apps, cookies, Hub session and desktop are never in frame.

CONDITIONS
Every condition is checked BEFORE the browser launches. Tests count launches: a refusal means 0 launches.
1. Plan binding: the running plan id equals delivery.ops_plan_id, and the delivery is ACTIVE with an unchanged binding_sha. delivery.capture inside any other plan fails CAPTURE_NOT_BOUND.
2. Project: source 'hub-test'; marker .ifrim-hub-test.json parseable, createdBy 'ifrim-agent-hub', fixture known, data 'synthetic'; the path is a direct child of PROJECTS_ROOT and is neither the Hub repository nor a Hub data directory. A real project is BLOCKED: „captura unui proiect real cere decizia MB1 și o verificare a datelor — nu în M11”.
3. Route: windows only. A wsl-runner preview lives in a bwrap network namespace that the Windows capture cannot reach (routed-runner.mjs:33-47).
4. Origin: exactly the template origin, which equals the bundle manifest start.url origin (from the approved spec).
   - http; host 127.0.0.1 or localhost; explicit port; origin only.
   - The port is not in LIVE_PORTS {8011, 8012, 3011, 3004, 8004, config.port, allowedOrigins ports}. This applies even in test mode, closing the relaxation at capture.mjs:357-358.
   - checkDemoOrigin must report liveHub false.
   - allowOrigin is a closure accepting only that origin (as executors.mjs:278).
5. Process provenance:
   - supervisor.get('factory-preview-<mission>') (only while the mission is this delivery's, at DELIVERY_READY or ACCEPTED) or supervisor.get('delivery-preview-<dlv>') must be alive, and probeUrl must answer 2xx/3xx;
   - the delivery preview is started only by runner.startPreview from the project path with the approved command, and the runner refuses an occupied port (runner.mjs:151-158);
   - a foreign process on the port is refused.
6. Not a Hub: a preflight GET {origin}/ and {origin}/api/session must carry no X-Hub-Version or X-Hub-Contract header (any Hub sets them, http/server.mjs:85-86). Otherwise CAPTURE_TARGET_IS_HUB.
7. Snapshot bracket: factory.snapshotCheck(mission).equal must hold BEFORE launch and AFTER encode.
   - Drift before: nothing launches (SNAPSHOT_DRIFT).
   - Drift after: the asset stays in the library but is NOT bound; its session scope is marked unbound; the step FAILs with SNAPSHOT_DRIFT; the delivery goes NEEDS_OWNER with up to 20 changed files.
   - data/ is excluded by spec.workspace.ignore, so bookings made by the capture are not drift.
8. Scope binding: planSession with scope { kind:'delivery_preview', origin, deliveryId, bundleId, bundleSha, snapshotSha, role, viewport, steps:n, purpose:'record', audio:false, destination:'library', retention:'library', dataKind:'synthetic' } and contentProjectId = the delivery's content project. No approval keys (cleanScope refuses them), and no approveScope call: it is not needed for a non-live origin.
9. Steps: only the template's demo steps.
   - They are derived from the APPROVED, protected E2E steps and validated by validateDemoSteps: relative goto, CSS selectors, typed synthetic text.
   - No URLs, scripts, contextSetup, cookies or virtual authenticator; tested.
10. Masking and privacy:
   - DEFAULT_REDACT_SELECTORS ([data-sensitive], input[type=password]) plus the template's selectors. Redaction is verified after every navigation before any frame is kept (capture.mjs:883-888).
   - Service workers blocked, downloads refused, the request guard admits only the origin, dead proxy.
   - NEW pageGuard after every navigation and step:
     - the banner [data-demo-banner] („Date sintetice · demo local”) is visible;
     - redactText(visible text) === visible text;
     - no absolute user paths (C:\Users\…, /home/…);
     - no e-mail outside example/test domains.
   - A violation gives CAPTURE_PRIVACY_REFUSED and the frames are wiped (capture.mjs:1010-1033).
11. Label, honestly:
   - captureLabel = 'SIMULATION' when config.testMode or the bundle limitations contain 'SIMULARE';
   - otherwise 'ORIGINAL_RECORDING' (a real run of the verified code, with synthetic data);
   - the clip always carries the on-screen text 'DATE SINTETICE · DEMO LOCAL', and QA factual enforces the disclosure label for SIMULATION.
12. Size and time:
   - maxDurationMs 60 000 per capture; one capture at a time (capture.mjs:788);
   - the assets.quota and disk reserve checks run first.
13. Mobile: viewport 390×844 at deviceScaleFactor 2 only. No isMobile, hasTouch or UA emulation in E2E or capture. Every text says „lățimea unui telefon (390 px) în Chromium”.

NEVER FILMED: credentials, owner cookies or sessions, private configs (no file:// or non-origin navigation), client or real data (synthetic hub-test only), the Hub UI, the desktop.

UNCHANGED: the capture.browser_demo executor (executors.mjs:269-283) and the MB1-gated captureVertical path (intent-actions.mjs:239-262) are not used by M11.

WHEN THE CAPTURE HAPPENS: during DELIVERY_READY, before acceptance, on the factory preview. Or, after an acceptance or after the owner opens the Room later, on a delivery-scoped preview restarted after a snapshot check. Accepting does not invalidate the captures: the snapshot is the same.

## FIXTURE
LOCATION AND NAME
- Folder: C:\Users\mihai\OneDrive\Desktop\Ifrim Digital Proiecte\ifrim-delivery-demo-detailing. It sits outside the Hub repo, as a direct child of PROJECTS_ROOT, like ifrim-factory-demo-a/b.
- Hub name: „Demo Livrare — Detailing (programări)”. Fixture key: 'booking-demo'.
- Created by the owner, or by Claude with an explicit approval: node v2/scripts/create-factory-fixture.mjs booking-demo (DIR_MAP gives the folder). The script does git init + one commit inside the folder and registers the project as a TEST project.
- Route: windows. Default autonomy: ASSISTED.
- Preview port 4620. Demo B uses 4610; 3004, 3011, 3012, 8004, 8011 and 8012 are avoided.

FILES (v2/fixtures/factory/booking-demo/)
- README.md: synthetic data, no network, no prices; the agreed problem; reset = delete data/ (owner action).
- package.json: type module; scripts test = node --test, start = node server.js; no dependencies.
- config.json: {"port":4620}.
- server.js: createApp; listens on 127.0.0.1 only; DB at data/bookings.db.
- src/server-app.js: node:http + node:sqlite DatabaseSync; createApp({ dbPath, now, seed }).
  - Static allowlist: /, /styles.css, /js/app.mjs, /js/slots-view.mjs.
  - GET /api/services.
  - GET /api/slots?date&service: slots 09:00–16:30 every 30 min (16 per day), status free | booked | past.
  - POST /api/bookings {serviceId, start, name, vehicle}: 201; 400 with field errors; 400 for a past slot; 409 for an overlap.
  - GET /api/bookings?date.
- src/catalog.js: synthetic services spalare-exterior 30 min, curatare-interior 60 min, polish-faruri 30 min. NO prices, NO deadlines.
- src/slots.js: pure slot generation and overlap logic.
- public/index.html: title „Programări detailing — demo”.
  - Banner <p data-demo-banner>Date sintetice · demo local</p>.
  - Services as radio cards label.svc[data-service=…].
  - Day tabs button[data-day=0|1|2] (today, tomorrow, the day after).
  - Slot grid #slots .slot[data-slot][data-booked][aria-disabled].
  - Form: input[name=name], input[name=vehicle], button[type=submit] „Confirmă programarea”.
  - States [data-state=loading|error|success] with „Se încarcă…”, „Corectează câmpurile marcate.”, „Programare confirmată”.
  - List #day-list.
- public/styles.css: desktop grid of 6 columns; @media (max-width:600px) 2 columns; .slot[aria-disabled=true] grey with „Ocupat”.
- public/js/app.mjs:
  - compact = matchMedia('(max-width: 600px)').matches;
  - renders layoutSlots(slots, {compact});
  - sets data-booked from s.status (always correct) and aria-disabled from !available;
  - double-click guard; 409 message „Intervalul tocmai a fost ocupat”.
- public/js/slots-view.mjs: the bug (below).
- test/acceptance.test.mjs: PROTECTED.
- test/unit.test.mjs: slots.js.
- .gitignore: data/.

SYNTHETIC DATA
- On every start and on every slots request, the server makes sure that each of the days 0..2 relative to the server clock has the 3 seed bookings, idempotent and flagged synthetic=1. Seeds: 10:00 spălare, 11:30 interior, 15:00 polish. So a run across midnight still has booked slots on „mâine”.
- Names „Client Demo A/B/C”, vehicle „Autoturism test”.
- No phone, e-mail, plate or price fields.

THE AGREED PROBLEM: visibly wrong on a phone, correct on desktop
In public/js/slots-view.mjs, layoutSlots has two branches:
- the desktop branch: available = s.status === 'free', label „Ocupat” for booked;
- the compact branch: available = s.state !== 'booked' (wrong field, always true) and no „Ocupat” label.
On a 390 px width, booked slots therefore look free, green and clickable, and a tap gets 409 „Intervalul tocmai a fost ocupat”. The desktop is correct. Owner-facing title: „Pe telefon, intervalele ocupate apar libere”.

SPEC: FACTORY_DEMOS['booking-demo'], workType BUGFIX
- Objective: repair the phone display without changing the desktop or the API.
- inScope: public/js/slots-view.mjs, and public/styles.css only if needed.
- outOfScope: API, real data, auth / payments / SMS / e-mail, new dependencies.
- Acceptance:
  - AC-1 test „Pe telefon un interval ocupat apare indisponibil și nu poate fi ales”: testRef test/acceptance.test.mjs, expectFailure 'interval_ocupat_liber_pe_mobil'.
  - AC-2 test „Pe desktop afișarea intervalelor rămâne aceeași”.
  - AC-3 test „API: 201 + listă + persistență după repornire; 409 pe interval ocupat; 400 pe interval trecut / date invalide”.
  - AC-4 review: cause and fix explained and reviewed independently.
  - AC-5 preview.
  - AC-6 e2e, phone width:
    1. viewport 390×844
    2. goto /
    3. noHorizontalOverflow
    4. click label[data-service='spalare-exterior']
    5. click button[data-day='1']
    6. expectSelector .slot[data-booked='true'][aria-disabled='true']
    7. click .slot[data-booked='false'][aria-disabled='false']
    8. fill input[name='name'] „Client Demo {run}”
    9. fill input[name='vehicle'] „Autoturism test”
    10. click button[type='submit']
    11. expectText „Programare confirmată”
  - AC-7 e2e, desktop: the same steps at 1280×800.
- verification: checks ['node --test']; acceptance ['node --test test/acceptance.test.mjs']; preview { command:'node server.js', url:'http://127.0.0.1:4620/' }.
- workspace.ignore ['data']. limits: maxDurationMin 60, maxRepairCycles 2, PILOT_MODELS.

DELIVERY BLOCK (Hub-side; not part of the spec, so it does not change the spec hash)
- noun 'programare'; proofSelector "[data-state='success']"; bannerSelector '[data-demo-banner]'.
- Tone texts per slot, each with its criteria (business / technical):
  - hook [AC-1]: „Programări online pentru detailing — demo” / „Fix verificat: intervalele ocupate pe telefon (AC-1, AC-6)”.
  - desktop [AC-7]: „Clientul alege serviciul și ora” / „E2E desktop 1280×800: PASS”.
  - mobile [AC-1, AC-6]: „Pe telefon, orele ocupate nu mai pot fi alese” / „AC-1 + AC-6: interval ocupat → indisponibil (390 px)”.
  - cta: „Hai să discutăm” / „Pachet local, gata de verificare”.
- variant overrides: hookText and ctaText (shorter).

BASELINE FAILS FOR THE RIGHT REASON
AC-1 asserts:
  assert.equal(layoutSlots(slots,{compact:true}).find(isBooked).available, false, 'INTERVAL_OCUPAT_LIBER_PE_MOBIL: intervalul ocupat apare liber pe telefon')
The TAP failure prints that message, and runBaseline matches the expectFailure text lower-cased against outputTail, the last 120 lines (factory.mjs:540-551, runner.mjs:140); the file is small, so it stays inside the tail. AC-2 and AC-3 pass at baseline, so the command fails ONLY because of the phone bug. A fixture that already passed, or that failed for another reason, would go NEEDS_OWNER_DECISION (factory.mjs:546-550).

AFTER THE FIX
The compact branch uses s.status and the „Ocupat” label, so AC-1, AC-2 and AC-3 pass. In real Chromium, AC-6 passes its expectSelector step, where it fails at baseline because aria-disabled='false'. AC-7 passes before and after.

TEST PATCHES (outside the fixture copy; existing fake-codex factory-write:<name>)
- booking-fix.json: the reference fix.
- booking-partial.json: label only; AC-1 still fails, so one repair cycle is forced.
- booking-tamper.json: edits the protected test, giving NEEDS_OWNER_DECISION.

E2E CRITERIA
- Desktop 1280×800 and phone 390×844 are separate criteria, each with its own e2e_*.png screenshot.
- No horizontal overflow at 390 px.
- A booked slot is disabled; a free slot books successfully; the success text is visible.

SLOT USE
- Each E2E or capture run books one slot of day 1.
- 13 free slots per day: a pilot needs at most 6 E2E bookings (3 E2E stages) + 2 capture bookings.
- Local tests use temp copies, so the live folder only fills during the pilot.

## CLIP PIPELINE
INPUTS: only authorized sources
- The two captures produced under the confirmed plan: origin OWNED, synthetic data, bound to the bundle and snapshot sha.
- The Hub template texts.
- Bundle facts (PASS criteria only).
No library stock, music, generated media or model.

1) CAPTURES (delivery.capture ×2)
- Desktop: 1280×720 at dsf 1.5 → 1920×1080, 30 fps. Mobile: 390×844 at dsf 2 → 780×1688, 30 fps.
- Steps are derived from AC-7 and AC-6.
- Markers:
  - chapter at start;
  - demo 'programare desktop' or 'programare mobil' before the first service click;
  - highlight markers with rects (slot grid, booked slot, success state);
  - proof 'confirmare'.
- Each capture becomes item capture/<role>, with meta { viewport, dsf, label, snapshotBefore, snapshotAfter, markers }.

2) EDIT (delivery.edit.build)
- Content project „Livrare: <proiect> — demo”; brief v1 with audience both and angles technical/business.
- Claims: one SUPPORTED claim per PASS criterion used by a text, with evidence [{kind:'bundle', ref, sha256}, {kind:'test', ref:evidenceId}]. A non-PASS criterion produces no claim and no text.
- buildMasterIR: 16:9, 1920×1080, 30/1 fps, preset ifrim-business, tone 'both' by default.
  - Video: c-desktop (contain; focus = the slot-grid rect; claimIds [AC-7]), then c-mobile (contain, pillarbox; claimIds [AC-1, AC-6]). Hard cuts only.
  - Text:
    - a label track over 100% of the timeline;
    - t-hook from 0 to 3 s;
    - t-desktop at the desktop demo marker;
    - t-mobile at the booked-slot highlight;
    - t-cta for the last 2.5 s.
  - IR markers: chapter intro, demo programare desktop, demo programare mobil, evidence interval ocupat pe telefon, cta.
  - evidenceRegions from the highlight rects.
- validateIR with getVersion, then media.edits.create. The edit item has role master.

3) MASTER: media.render { profile:'final', qaUse:'internal' }
- The durable queue with output validation, followed by six QA kinds with use 'internal':
  - rights: allowed for OWNED material without a record;
  - factual: labels, claims and bundle status (new CLAIM_EVIDENCE_STALE).

4) VERTICAL: media.variant.render { platformKey:'shorts_9x16', qaUse:'internal', overrides }
- deriveVariant reframes around focus and protects evidence regions. The fallback is a letterbox, never silent; a finding is shown.
- The phone segment fills 9:16 naturally.
- The result is a new edit version (change_kind 'variant'), a final render, then QA.
- The profile is an internal estimate, not a publishing target.

5) EXPORT: delivery.export
- media.exportLocal(folder: demo-programari-<slug>-<yyyymmdd>) of both renders, as demo-16x9-v1.mp4 and demo-9x16-v1.mp4.
- Never overwrites; copies are sha-verified.

6) GATES SHOWN, NEVER MERGED
- Automated QA PASS / WARN / FAIL is shown per kind. Creative review stays PENDING until the owner decides, per version (reviewState, executors.mjs:42-45).
- A QA FAIL does not hide the clip: it is shown with its findings and counted as an observation, and the clip never counts as evidence.

7) MARKERS FOR THE REVISION
The IR markers carry the domain noun, so „după secunda zece arată direct programarea” resolves to cut_range[frame 300, the first marker after 10 s whose note contains 'programare'). With the fixture timing that is 'programare mobil'. Hard cuts make the cut always valid (review.mjs:471).

The brief keeps prefs { tone, jump:{ afterSec:10, markerNote:'programare' } }, so a clip regenerated after a software change keeps the owner's choices (applyPrefs).

NOT USED: CapCut, OBS, Computer Use, the media AI roles. Everything goes through the structured IR and the ffmpeg renderer.

## SUMMARY RENDERER
delivery/summary.mjs is pure and deterministic: no model, no clock (generatedAt is passed in), no network. Every sentence is either fixed template text or a value with provenance.

INPUTS
- Bundle manifest: criteria with status and evidence, changeSet {id, sha256, snapshot, files}, start, limitations (factory.mjs:1081-1110).
- E2E rows: criterion, viewport, status, evidence id.
- CURRENT media items: master and vertical renders, durations, labels, QA status, export file names.
- Catalog services the owner bound, as id@version, CONFIGURED only.
- Owner profile: companyName, signatureName, materials (sales.mjs:1032).
- synthetic (marker data) and simulation (testMode or SIMULARE).

SECTIONS (id → heading)
- context „Ce am pregătit”: „Demo local pentru prezentare, cu date sintetice; nu este un sistem în producție.”
- delivered „Ce funcționează (verificat)”: only PASS_EVIDENCE / PASS_REVIEW criteria. Each line is the spec text plus how it was verified: „test automat AC-1”, „în browser, lățimea unui telefon 390 px (AC-6)”, „review independent”.
- fixed „Problema rezolvată”: the approved spec title and objective plus the changed file names. No reviewer prose.
- not_verified „Ce nu am verificat”: every non-PASS criterion with its status and note, plus the fixed lines „doar Chromium la lățimea unui telefon (fără telefoane reale sau touch)” and „date sintetice”. Manifest limitations are translated, never invented.
- video „Materiale video”: an auto section that is always regenerated. It lists file names, durations, label („ÎNREGISTRARE ORIGINALĂ a demo-ului local” or „SIMULARE”) and QA status, CURRENT items only.
- scope „Ce include” and exclusions „Ce nu include”: from a bound CONFIGURED service, otherwise NOT_CONFIGURED.
- price_terms „Preț și termen”: priceText / leadTimeText only from CONFIGURED services, otherwise „De stabilit (neconfigurat)”. The live catalog is empty, so this is the expected live text.
- next_step „Următorul pas”: fixed text „O discuție scurtă în care stabilim ce vă este util; oferta finală vine după.” No promise, no date.
- provenance „Trasabilitate”: bundle id; sha prefixes of the bundle, change set and snapshot; spec version; generatedAt.

Title: „[DATE SINTETICE] Rezumat: <proiect>”, prefixed „[SIMULARE]” in test mode.

FACT GUARD
assertNoInventedFacts runs over every template-generated line. It refuses currency or price patterns (lei|ron|eur|€|$|\d+[.,]?\d*\s?(lei|ron|eur)), percentages, deadline phrases (în \d+ (zile|săptămâni)|până (la|pe)|garant\w*) and calendar dates, unless the line's source is a CONFIGURED service field.

Owner edits that contain such facts are kept (they are the owner's) but flagged as ownerAsserted in claimsToVerify.

Untrusted strings (spec text, file names) pass through clean(): redaction plus placeholder neutralization.

OUTPUTS
- claimsToVerify: owner-edited sentences, non-PASS criteria, material lines.
- warnings: price/term not configured, no company name, synthetic data, placeholders (findUnresolvedPlaceholders).
- basis and basisSha, per section.
- text and contentSha.

VERSIONING (delivery_documents)
- v1 comes from delivery.summary.render.
- delivery.summary.edit({ sections:[{id,text}] }) creates v+1 under the sales rules: empty text refused, placeholders refused, at most 4000 characters per section, source 'owner', editedBy, owner session.
- Regeneration after a media revision replaces only the video section.
- A software generation replaces template sections and keeps owner sections, flagged needsReview when their basis changed.
- delivery.summary.approve({ displayedSha }) writes approval_json PRESENTATION_READY. Any new version starts unapproved.
- delivery.summary.service binds a CONFIGURED service and creates a new version.
- Export and approval are refused while any referenced item is STALE.

EXPORT
rezumat-v<n>.md and an escaped, self-contained rezumat-v<n>.html go into the delivery's export folder through files.writeNew (never overwrite; sha recorded in export_json). PDF and DOCX are not in M11 (open decision).

## DELIVERY ROOM UI
ROUTE
- #/livrare/:id. #/livrare without an id opens the latest delivery of the cockpit project.
- A compact DeliveryRoom card in the Lega cockpit (layout card type) shows status, labels, pending decisions, any stale reason, and a link.

DATA CONTRACT (one GET /api/deliveries/:id)
{ delivery:{ id, title, status, statusReason, projectId, projectName, labels, generation, parentId, childId, verified:{ at, equal, changedFiles } },
  software:{ bundle:{ id, shaPrefix, status }, spec:{ version, shaPrefix }, changeSet:{ seq, shaPrefix, files:[{path,status}] }, diff:{ text, truncated }, review:{ id, verdict }, tests:[{ command, status, counts, isolation, runner }], criteria:[{ id, text, verify, status, note }] },
  preview:{ url, running, key, startCommand, shots:[{ criterion, viewportLabel, status, src }] },
  clip:{ master:{ editVersionId, assetVersionId, src, durationMs, label, qa:{ status, kinds, unjustified }, creative, markers:[{kind, note, ms}], textItems:[{id, text, start, end}] }, vertical:{ … }, rights:{ internal:'allowed', public:[{ scope, state }] } },
  summary:{ documentId, version, sha, status, sections:[{ id, heading, text, source, needsReview }], warnings, claimsToVerify, basis, approval, exports },
  observations:[{ kind, severity, text, ref }],
  decisions:{ software, creativeMaster, creativeVertical, rightsPublic, summaryReady, publishing:'OFF' },
  plans:[{ id, kind, status, steps:[{seq, title, status}] }],
  revisions:[{ id, text, status, classes, planId }],
  history:[{ kind, role, id, status, staleReason, supersedesId, createdAt }] }
The UI holds no business logic; deliveryLogic.js stays pure.

HEADER
- Title, project, status chip (ACTIVE / READY / NEEDS_OWNER / STALE), a SIMULARE badge when simulated, and „DATE SINTETICE”.
- „Verifică acum” calls delivery.verify and shows snapshot equal ✓, or different ✗ with up to 20 changed files.
- When STALE: a red banner with the reason and a link to the replacing version. Stale players are collapsed behind „Clip pentru versiunea veche (bnd_…) — nu dovedește codul nou”.

THE SIX DELIVERABLES (the owner's list)
1. Demo local (PreviewPanel, top):
   - the preview URL with „Deschide preview-ul” (new tab) while it is running;
   - otherwise „Pornește preview-ul versiunii verificate” (delivery.preview.start: owner session, snapshot equal);
   - the start command from the bundle.
2. Software (SoftwarePanel), bound to the exact snapshot:
   - bundle id/sha/status, spec version, change set seq/sha, snapshot sha;
   - changed files and a collapsible diff;
   - review verdict;
   - tests table;
   - criteria with PASS_EVIDENCE / PASS_REVIEW / NEVERIFICAT.
3. Preview pe telefon și desktop: the E2E screenshot per criterion via the screenshot route. Each is labeled with criterion, status and „lățimea unui telefon 390 px, Chromium (fără touch)” or „desktop 1280×800”.
4. Clipul (ClipPanel):
   - master 16:9 and vertical 9:16 <video> players from /api/media/files/:versionId;
   - label chip and QA chips for the six kinds, with unjustified findings;
   - a clickable marker list (timecode, seeks the player);
   - text-item selection, which sets the Room selection;
   - the revision box „Spune ce schimbi”, posting { text, selection, timecodeMs }. The answer renders inline as a plan card, ONE question or a message.
5. Rezumat comercial (SummaryEditor):
   - editable sections (save → delivery.summary.edit), each showing source (template / owner) and needsReview;
   - warnings and claimsToVerify;
   - basis (bundle sha; service id@version or „neconfigurat”);
   - export file links;
   - „Leagă un serviciu din catalog” (CONFIGURED only);
   - „Gata de prezentare” (delivery.summary.approve with the displayed sha).
6. Observații și decizii (ObservationsPanel + DecisionsPanel):
   - Observations: open findings, non-PASS criteria, QA warnings, claimsToVerify, and plan progress via ops live events.
   - Six independent decision rows:
     - „Accept local” → delivery.software.accept with the displayed bundle sha. Disabled while a capture runs, with the reason shown.
     - Creative master → media.review.decide CREATIVE_APPROVED (owner session, fresh Windows Hello).
     - Creative vertical → the same, on the variant version.
     - Public rights → state per scope; „Înregistrează dreptul” opens the existing Studio rights UI. Internal use is shown as permitted for owned material.
     - Summary ready.
     - A fixed row „Publicare: oprită (politica media; nu se face din Hub în M11)” with no button.
   - History: the versions of each item with supersedes links and STALE reasons.

ACCESSIBILITY AND MOBILE
- Panels stack below 900 px.
- Buttons that need the owner session show „deschide sesiunea (Windows Hello)” instead of failing.
- Nothing auto-approves on view.
- Keyboard: Enter submits the revision box; the players have labelled controls.

## STALE RULES
ITEM GRAPH (upstream → downstream)
- bundle → e2e_shot, preview, capture, claim, summary (whole document)
- capture → edit(master)
- brief → edit(master)
- claim → edit(master)
- edit(master) → render(master), variant
- variant → render(vertical)
- render → qa, export, summary (video section)

STALE means the basis no longer proves anything. SUPERSEDED means a newer version of the same role exists; the old one is still valid for what it was made from.

A current view additionally requires item.snapshot_sha === delivery.snapshot_sha (brief excepted). An old clip is therefore never current evidence for different code, even if a status write were missed.

TRIGGERS
Each rule is a listener in delivery.mjs and has its own mutation-checked test.

1. SOFTWARE CHANGE
   Sources:
   - factory.bundle.status STALE or REJECTED for the delivery's bundle;
   - a new factory.change_set or a factory.stage of BASELINE, IMPLEMENTING, REPAIRING or CHECKING on the delivery's mission after READY (resume or new cycle);
   - a new bundle on the same mission;
   - snapshotCheck.equal = false from verify (Room, tick, the first step of any delivery plan). This covers a workspace change after acceptance, which the factory itself never re-checks.
   Effect:
   - the bundle item and the whole software-bound cascade become STALE (stale_code SOFTWARE_CHANGED, reason „software-ul s-a schimbat: <cauza>”);
   - media_variants become INVALIDATED (variants.invalidate), and distribution.checkInvalidation runs on any manifest using them;
   - the summary document becomes STALE;
   - the delivery becomes STALE.
   The brief stays CURRENT, so tone and prefs are reused.
   Nothing is deleted. Old players appear only behind the banner. Summary export and approval are refused. QA factual fails a SUPPORTED claim whose bundle is STALE or REJECTED (CLAIM_EVIDENCE_STALE).

2. SOFTWARE REVISION BY THE OWNER
   - A child delivery D2 (parent_id D1) is ARMED by its envelope.
   - When D2's mission enters BASELINE, D1's software-bound items become STALE („revizie software în curs: misiunea m2”) and D1 becomes STALE.
   - At D2's DELIVERY_READY, the derived plan builds generation 2. Every new item has supersedes_id set to D1's item of the same kind and role (real links).
   - When D2 is READY, D1 is CLOSED („înlocuită de D2”).

3. MEDIA REVISION (clip or tone)
   - A new master edit version makes the old edit, render(master), variant, render(vertical), qa and export items SUPERSEDED, with links.
   - Captures, bundle, e2e, claims and tests stay CURRENT.
   - The summary gets a new version with only the video section recomputed; owner sections are kept.
   - The delivery stays READY.
   - Creative approval of v1 does not carry over: v2 shows PENDING.

4. VERTICAL-ONLY REVISION: only variant, render(vertical), qa(vertical) and export(vertical) become SUPERSEDED.

5. STUDIO CORRECTION OUTSIDE THE DELIVERY (media.review.applied or media.variant.corrected on a CURRENT delivery edit version)
   - The old chain becomes SUPERSEDED (stale_code STUDIO_CORRECTED on the render), and the new edit item is CURRENT without a render.
   - The delivery goes NEEDS_OWNER: „clipul a fost corectat în Studio; randez din nou?”. A revision plan is offered and never auto-run.

6. RIGHTS REVOKED (media.rights.revoked): items whose source asset appears in revocationImpact(assetId) become STALE (RIGHTS_REVOKED), and their variants INVALIDATED.

7. FILE MISSING (media.asset.missing): items referencing that version become STALE (FILE_MISSING).

8. CATALOG CHANGE (sales.service.saved for a service id@version in the summary basis): only the summary document becomes STALE („serviciul X s-a schimbat”).

9. ACCEPTANCE (OWNER_ACCEPTED): the bundle item's meta status is updated. Nothing becomes stale, and nothing else is approved.

10. PLAN STOPPED (ops.plan paused / needs_owner / failed / cancelled for a delivery plan; Hub restart; project freeze): the delivery goes NEEDS_OWNER. Bound items keep their status.

11. ENVELOPE CLOSED before activation (SUPERSEDED / EXPIRED / CANCELLED / REVOKED / FAILED_TO_START, and delivery.envelope_id is that envelope): the delivery becomes CANCELLED or EXPIRED and nothing is captured. A continuation that re-armed the row first is not cancelled.

INVARIANTS (tested)
- STALE never reverts to CURRENT; only new items are created.
- READY requires slotsComplete() with CURRENT items and verify equal.
- The cascade is idempotent.
- generation increments only with a new bundle.
- A variant becomes INVALIDATED only for software or rights triggers.

## REVISION FLOW
ENTRY POINTS: one planner function behind every channel
- The Room's revision box.
- Typed or spoken Lega: intent delivery_revise. The delivery is resolved from lastTarget, the open Room, or the project's single READY or STALE delivery; otherwise ONE question.
- Every revision is recorded in delivery_revisions: redacted text, classes, target, delta, status.

REFERENCE: „Site-ul e bine. Clipul este prea tehnic; după secunda zece arată direct programarea.”

1. revision.classify splits it into clauses:
   - „Site-ul e bine.” → feedback(software, positive) → NOTED. This is NEVER acceptance. Lega: „Notat că site-ul e bine. Acceptarea software rămâne butonul „Accept local” din camera de livrare.”
   - „Clipul este prea tehnic” → tone business, target the master clip (the word „clipul”).
   - „după secunda zece arată direct programarea” → jump: from frame 300 (secunda zece, NUM_WORDS) to the first IR marker after 10 s whose note contains „programare”, which is 'programare mobil'.
2. Ops = toneOps(master IR, template texts, 'business'), which replaces the text of t-hook, t-desktop, t-mobile and t-cta, plus cut_range[300, marker frame).
   - media.reviews.proposeOps records ONE OPEN review on the current master version, with a validated preview and diff.
   - Delta: brief audience both → business, prefs.jump {afterSec:10, markerNote:'programare'}.
3. The planner proposes ONE ops plan, kind 'delivery.revise', confirmed once (owner session; voice through the armed window):
   1. delivery.revise.apply {deliveryId, revisionId}
   2. media.render {editVersionId:'$pas:1.editVersionId', profile:'final', qaUse:'internal'}
   3. media.variant.render {masterVersionId:'$pas:1.editVersionId', platformKey:'shorts_9x16', qaUse:'internal', overrides}
   4. delivery.export (v2 names, never overwrite)
   5. delivery.summary.render (video section only)
   6. delivery.finish (mode revision)
   The card says:
   - what changes: „brief v2 (public: business), montaj v2 (taie 0:10–0:18,4, salt la «programare mobil»), 4 texte de ton”;
   - what is redone: „randarea master, varianta verticală, QA pe ambele, secțiunea video a rezumatului”;
   - what stays: „software-ul bnd_…, testele, capturile, celelalte secțiuni ale rezumatului — fără cod nou, fără model”.
4. After DONE:
   - new edit, render, variant, QA and export items with supersedes links; the old ones become SUPERSEDED (not stale);
   - the delivery stays READY;
   - v2 creative approval is PENDING;
   - software acceptance is unaffected.

OTHER CASES
- Vertical only („În varianta verticală mută titlul mai sus”): parseInstruction runs on the variant version. review.apply moves the variant row (review.mjs:833-838). Then render(vertical), QA, export, video section. The master is untouched.
- Summary only („În rezumat, la Următorul pas scrie «…»”): no plan. delivery.summary.edit creates v+1 directly in the owner session; it is reversible and the old version is kept. Lega answers with the diff.
- Ambiguous target („schimbă titlul” with no selection, no timecode, no artifact word, and both the clip hook and the summary title plausible): ONE clarification, „Titlul clipului sau titlul rezumatului?”, with two options. With a selection or a timecode there is no question, and preferredTextTarget (review.mjs:167) picks the item from the selection, the timecode, or the item last corrected on this version line.
- No matching marker: ONE question listing the markers with their times.
- Software change words („Adaugă câmpul număr de înmatriculare în formular”, „Butonul să fie verde”): class software.
  - Engineering draft via buildEngineeringSpec, which binds the project's protected acceptance test or writes it (L5: step 0 of the same plan, .ifrim/M11_L5_DESIGN.md §2; no question with file names). The revision takes over the parent's preview and E2E criteria (delivery/template.mjs:273, :289-290): a draft without them cannot be captured.
  - ONE envelope whose delivery section has mode 'refresh' and parentDeliveryId, for a new delivery D2.
  - The card shows only the difference: the new mission, re-capture, a clip rebuilt with the kept tone and jump prefs, and summary regeneration that keeps owner sections.
  - Repairs on the card need no grant.
  - Another project, new or real data, cost, or limits beyond the card go through the contextual delta or a plan showing only the difference.
- A text change NEVER becomes coding: the software class needs a software noun AND a change verb.

## PHRASES
NEW INTENTS (owner/intents.mjs; Wave B, after P0)
- delivery_prepare and delivery_revise: plan, so BOUNDED_WORKFLOW via the effect-class matrix.
- delivery_open: navigate. delivery_status: read.
- A provider transcript may PROPOSE, as for any plan, but can never confirm.

DELIVERY_PREPARE (NEVER_SPLIT, START_LIKE)
- Pattern: ^(pregateste|fa|construieste|pune la punct)(-mi)? (demo-ul|demoul|demonstratia|livrarea|prezentarea|pachetul de prezentare)\b
- Optional clauses inside the same sentence are read as args:
  - checkMobile: „pe mobil / pe telefon”;
  - repair: „repara problema (conventa|convenita)? | bug-ul | problema”;
  - clip: „clip | video | filmulet”;
  - summary: „rezumat (comercial)?”.
- „Nu publica nimic.” is a separate sentence after the '. ' split. It becomes the constraint noPublish through the new constraintsOf rule /\bnu (publica|posta|urca|incarca)\b|\bfara (publicare|postare|upload|incarcare)\b/. The rule attaches it to the delivery step (intents.mjs:708-717) instead of producing an 'unknown' step.
- „Fără reparații” → delivery-only. „Nu porni” / „doar arată” → previewOnly (noStart).
- Examples:
  - „Lega, pregătește demo-ul pentru prezentare: verifică programările pe mobil, repară problema convenită, pregătește un clip și un rezumat comercial. Nu publica nimic.”
  - „Pregătește livrarea pentru Demo Livrare Detailing.”
  - „Fă pachetul de prezentare, fără reparații.”

DELIVERY_REVISE: only with a delivery context (lastTarget delivery, or the Room open); otherwise studio_edit or engineering_request win as today.
- „Clipul e prea tehnic.”
- „După secunda zece arată direct programarea.”
- „Site-ul e bine.” (feedback)
- „În varianta verticală mută titlul mai sus.”
- „În rezumat, la Următorul pas scrie «…».”
- „Fă textul de final mai scurt.”
- „Adaugă câmpul număr de înmatriculare.” (software → engineering card)

DELIVERY_OPEN: „Arată livrarea”, „Deschide camera de livrare”, „Arată demo-ul pregătit”, „Unde e clipul pentru prezentare?”

DELIVERY_STATUS: „Ce mai e de decis la demo?”, „E gata demo-ul?”. Lega reads the five decision states and any stale reason.

EXISTING, REUSED
- „Da, execută planul”: the armed voice window or typed.
- „Nu acum” / „Anulează planul”.
- „Pauză”, „Oprește tot”, „Preiau eu”: interrupts; the derived plan pauses.
- „Continuă”: resumes the stopped delivery plan, or shows the same-credential delta.

DECISIONS LEGA NEVER TAKES
- „Accept software-ul” → navigates to the button („Acceptarea e decizia ta, din camera de livrare”).
- „Aprob clipul” → the creative-approval button (Windows Hello).
- „Publică clipul” → studio_publish stays REFUSED, with the explanation.

LEGA'S TYPICAL ANSWERS
- Plan: „Un singur plan: repar problema convenită pe Demo Livrare (până la 2 remedieri incluse), apoi captură pe desktop și la lățimea unui telefon, clip 16:9 și vertical, rezumat comercial. Nimic nu se publică; acceptarea, aprobarea creativă și drepturile rămân ale tale. Confirmi?”
- Ready: „Livrarea e gata în camera de livrare: software verificat (bnd_…), clip 16:9 și vertical cu QA, rezumat v1. Ai patru decizii separate.”
- Stale: „Clipul nu mai dovedește codul: workspace-ul s-a schimbat după versiunea testată (2 fișiere). Pot pregăti un plan nou de captură.”
- Session ended: „Sesiunea în care ai confirmat s-a închis; confirm doar diferența (sesiunea nouă), cu aceleași limite.”

## TESTS
- m11-fixture.test.mjs — PASS_LOCAL (real node, no browser). Proves:
- the booking-demo unit tests pass;
- `node --test test/acceptance.test.mjs` FAILS at baseline with output containing INTERVAL_OCUPAT_LIBER_PE_MOBIL, while AC-2 and AC-3 pass;
- with booking-fix applied in a temp copy, all acceptance tests pass, and booking-partial keeps AC-1 failing;
- API 201/400/409 and persistence across restart;
- seeds re-established per day across a simulated midnight;
- no price fields anywhere;
- materializeFixture writes data:'synthetic';
- create-factory-fixture maps booking-demo to ifrim-delivery-demo-detailing and refuses an existing folder.
- m11-fixture-e2e.test.mjs — PASS_LOCAL with real Playwright Chromium, else SKIPPED_ENV. Real E2E against the fixture server:
- AC-6 (390×844) FAILS at baseline exactly at the expectSelector step and PASSES after booking-fix;
- AC-7 desktop passes both times;
- no horizontal overflow at 390 px.
- m11-migration.test.mjs — PASS_LOCAL.
- Migration 12 is additive on a schema-11 DB: 4 tables, indexes, CHECKs.
- ux_deliveries_open_project rejects a second ARMED/ACTIVE delivery.
- migration-dry-run reports schemaAfter 12 and the M11 tables.
- m11-template.test.mjs — pure, PASS_LOCAL.
- Template, section and packageSteps are deterministic (stable sha).
- Capture scripts derived from the approved E2E steps (fill→type, click→highlight+click, expectSelector→waitFor+highlight, expectText→waitFor(proof)+marker, overflow dropped) pass validateDemoSteps; a select step gives a blocker.
- eligibility refuses: not hub-test, not synthetic, wsl route, no preview, a preview port in LIVE_PORTS, two missions, exportsDir outside the approved folders.
- The pin step is prepended only when UNPINNED.
- m11-capture-guard.test.mjs — PASS_LOCAL.
- LIVE_PORTS are refused even with testMode=true (mutation: removing the test-mode-independent set fails the test).
- probeNotHub refuses a server sending X-Hub-Version.
- pageGuard refuses a missing banner, a redactable secret, an absolute user path and a foreign e-mail.
- assertSyntheticProject refuses the Hub root and a marker without data:'synthetic'.
- m11-clip-ir.test.mjs — pure, PASS_LOCAL.
- buildMasterIR passes validateIR; hard cuts only.
- The label covers 100% of the timeline, so no LABEL_MISSING for SIMULATION.
- Capture markers are mapped to frames; evidence rects go through contain-fit.
- Texts appear only for PASS criteria (mutation: AC-1 NEVERIFICAT removes t-mobile and its claim).
- toneOps touches only t-* items; applyPrefs reproduces the jump; deterministic.
- m11-summary.test.mjs — pure, PASS_LOCAL.
- Deterministic.
- „Ce funcționează” lists only PASS criteria; NEVERIFICAT goes to „Ce nu am verificat”.
- Price and term only from CONFIGURED, else „De stabilit (neconfigurat)” (mutation on the CONFIGURED check).
- The fact guard refuses template text with lei/€/dates/„în 5 zile”; owner-asserted facts are flagged.
- No unresolved placeholders; [DATE SINTETICE] / [SIMULARE] titles.
- Section edits: empty or placeholder text refused, new version, approval voided; owner sections kept on regenerate and flagged needsReview.
- m11-stale-graph.test.mjs — pure, PASS_LOCAL.
- The cascade follows upstream links; STALE vs SUPERSEDED are distinct; brief is not software-bound.
- Idempotent; never revives an item.
- currentView hides items with a different snapshot_sha.
- The variants-to-invalidate list and slotsComplete are correct.
- m11-revision-parse.test.mjs — pure, PASS_LOCAL.
- The reference sentence gives [feedback (not acceptance), tone business + brief audience, cut_range from frame 300 to the first 'programare' marker after 10 s].
- „prea tehnic” alone gives tone ops only.
- „schimbă titlul” with clip and summary both plausible and no selection gives exactly ONE clarification; with a selection or a timecode, no question.
- Software noun + verb gives class software; „Site-ul e bine” gives no action.
- No marker gives a question listing the markers.
- m11-media-extensions.test.mjs — PASS_LOCAL.
- The highlight step records a normalized-rect marker (fake launcher).
- pageGuard failure wipes the frames.
- proposeOps creates an OPEN review with a validated preview.
- qa factual CLAIM_EVIDENCE_STALE for STALE/REJECTED bundle evidence (mutation-checked).
- saveClaim refuses SUPPORTED with a REJECTED bundle.
- variants.invalidate writes INVALIDATED + event, and distribution refuses that variant.
- exportLocal(folder) never overwrites and verifies the sha.
- Executors forward qaUse/overrides; regression: existing plan bodies hash identically without them.
- m11-factory-hooks.test.mjs — PASS_LOCAL (test mode).
- snapshotCheck equals accept()'s computation; a post-acceptance file change gives equal=false with the changed files.
- factory.bundle.status is emitted on new-bundle STALE, accept-drift STALE, OWNER_ACCEPTED and REJECTED.
- deliveryBinding lists e2e shots; e2eShotPath refuses traversal and foreign evidence; previewStatus reflects the supervisor.
- m11-derived-plan.test.mjs — PASS_LOCAL. adoptDerived works only through a registered parent and refuses:
- a hash mismatch;
- decisions;
- a model step;
- an app op;
- an op outside allowedOps;
- a failing parent verify;
- an expired window.
It also proves:
- consent carries derivedFrom, sessionId and credential;
- authorize still runs per op and per step;
- Stop All / pause stop the plan;
- after the session ends, „Continuă” gives RECONFIRM_DELTA and the same credential resumes it;
- a catalog scan finds no command/route/agent/Lega path to adoptDerived.
- m11-delivery-binding.test.mjs — PASS_SIMULATED (service level).
- createPlanned only for an eligible project; arm only inside the envelope-confirm transaction (a forced arm failure rolls the confirmation back).
- activate runs the full checklist; each check has a mutation case: stale bundle, snapshot drift, tools change, revoked credential, Stop All after confirm, origin mismatch, ops-sha mismatch, activate_by passed.
- Idempotent after a simulated restart (tick).
- An envelope REVOKED/EXPIRED before DELIVERY_READY gives CANCELLED/EXPIRED with nothing captured.
- A continuation re-arms the same row and is not cancelled by the old envelope's SUPERSEDED.
- m11-delivery-capture.test.mjs — PASS_LOCAL (fake launchers). delivery.capture refuses BEFORE launch (launch counter 0) for:
- an origin other than the template origin;
- 8011/3011/config.port, also in test mode;
- not hub-test, or not synthetic;
- no Hub-supervised preview;
- a server answering with X-Hub-Version;
- a plan id that is not the delivery's plan;
- snapshot drift before launch.
Other checks:
- drift after encode: the asset is ingested but not bound, and the step fails SNAPSHOT_DRIFT;
- label SIMULATION in test mode;
- scope_json carries deliveryId/bundleSha/snapshotSha;
- contextSetup is never passed.
- m11-delivery-stale.test.mjs — PASS_SIMULATED. Each trigger produces the expected STALE or SUPERSEDED, reason and delivery status, mutation-checked per trigger:
- new bundle, reject, mission resumed;
- post-acceptance workspace change via verify;
- media revision (supersede), Studio correction;
- rights revoke, asset missing, catalog service change;
- envelope closed before activation.
Variants become INVALIDATED only for software/rights triggers.
- m11-delivery-real.test.mjs — PASS_LOCAL when Playwright + ffmpeg/ffprobe exist, else SKIPPED_ENV.
- Real fixed-fixture server; real Chromium capture desktop + mobile; buildMasterIR.
- Real final 16:9 render + derived 9:16 render.
- QA: technical PASS, factual PASS, rights internal allowed.
- Summary rendered and written to a temp exports dir; a second run never overwrites.
- m11-envelope-delivery.test.mjs — PASS_LOCAL.
- Golden: an ordinary envelope's body and hash are byte-identical with and without M11, including limits.maxDurationMin.
- The delivery section is hashed; summary.delivery lines and the steps sentence appear only with a section.
- Confirm supersedes with the label „pașii de după livrare” when spec, tools, port, exports folder or ops sha change.
- DENIED_EFFECTS and advance() unchanged.
- One confirmation covers engineering + the derived package (no second confirm call in the flow).
- m11-delivery-planner.test.mjs — PASS_LOCAL.
- The reference sentence gives ONE envelope card; the agreed problem is the single SPEC_DRAFT, or the fixture issue prepared as a draft.
- Two drafts give ONE clarification; an already-delivered bundle gives the delivery-only ops card.
- Blockers (no Playwright, tools CHANGED, live port, wsl route, not synthetic, exports folder not approved) are explained once and the request is preserved as a work request 'delivery'.
- noPublish shown; a provider transcript can propose but not confirm.
- m11-intents.test.mjs — PASS_LOCAL.
- The reference sentence resolves to exactly one delivery_prepare step with constraints.noPublish, and no 'unknown' step (regression for the '. ' split).
- Revise, open and status phrases resolve; studio_edit still wins outside a delivery context.
- „publică clipul” stays REFUSED; „Accept software-ul” only navigates.
- m11-cockpit.test.mjs — PASS_LOCAL.
- projectCockpit lists deliveries.
- The done list excludes REJECTED bundles (regression for cockpit.mjs:183).
- The DeliveryRoom card validates; another project's delivery is refused.
- m11-routes.test.mjs — PASS_LOCAL.
- The screenshot route serves only e2e_*.png of the delivery's own mission, non-stale; it refuses traversal, foreign evidence and bad names.
- The summary HTML is escaped and carries CSP.
- POST allowlist: owner-only actions without a session give needSession; agent/cli give 403; GET view shape.
- m11-decisions-separation.test.mjs — PASS_LOCAL.
- delivery.software.accept writes only OWNER_ACCEPTED: no creative approval, rights record, manifest or summary approval, and vice versa.
- It refuses a displayed bundle sha that is not current, and refuses while a capture runs.
- CREATIVE_APPROVED without an owner session is refused; summary approval is sha-bound and voided by a new version.
- No executor exists for accept/approve/rights/publish; publishing stays refused (NEVER_IN_PLANS, apiRelease, DENIED_EFFECTS).
- m11-integration.test.mjs — PASS_SIMULATED. Test hub with fake codex factory-write:booking-fix, fake claude PASS, injected browser launcher and fake ffmpeg. Full flow:
1. fixture project → planner → envelope → ONE confirm (owner session);
2. BASELINE fails for the right reason → writer → checks → review → QA → preview → E2E → DELIVERY_READY → envelope COMPLETED;
3. the derived plan runs WITHOUT a second confirmation: captures → edit → render → variant → QA → export → summary → READY, all labels SIMULATION;
4. the revision sentence → one revision card → master v2 + vertical v2, with bundle/capture/test ids unchanged and old items SUPERSEDED;
5. a workspace edit → verify → STALE;
6. accept and creative approval stay independent.
A second scenario: booking-partial → one repair cycle within the card (no delta).
- m11-ui-logic.test.mjs — pure, PASS_LOCAL.
- deliveryLogic: independent decision chips, decision-to-command map (5 distinct commands, no publish), STALE banner and hiding of stale players.
- Enabled states per session; accept disabled during capture; marker timecodes; summary section diff.
- m11-ui-e2e.test.mjs — Playwright against the built UI and test hub, else SKIPPED_ENV.
- The Room renders the six deliverables, players and screenshots.
- A summary edit creates v2; the STALE banner appears after verify.
- Decision buttons dispatch distinct commands; publishing has no button; layout at 390 px has no horizontal overflow.
- Regression gate — npm run test:v2 green (SKIPPED_ENV listed by name) and npm run build:v2 green. The m06/m07/m09/m10/m10-2 suites unchanged, in particular: envelope golden hashes, ops plan hashes, studio distribution, capture refusal (M09-CP-09) and cockpit.

## LIVE PILOT
FIȘA PILOTULUI M11 (2.13.0-m11). A separate approval, NOT covered by the M10.2 / P0 probe approval. Live steps start only after P0 is closed.

PRECONDITIONS (verified read-only before asking)
- The P0 probe result is recorded, and P0 + M10.2 are committed locally.
- M11 is implemented. npm run test:v2 is green, with the SKIPPED_ENV list stated. npm run build:v2 is green.
- On this machine, m11-fixture-e2e and m11-delivery-real are PASS_LOCAL (real Chromium 1228, pinned ffmpeg).
- node v2/scripts/migration-dry-run.mjs is clean on a copy: schema 11→12, M11 tables present, counts unchanged.
- Port 4620 is free. Exports folder: Videos\Ifrim Studio\Exporturi.

APPROVAL PHRASE: „Aprob pilotul M11 după fișa 2.13.0”, plus codes.
- U (default): live upgrade to 2.13.0-m11.
  1. upgrade.mjs --plan (read-only);
  2. --apply: migration 12 with a verified pre-migration backup in hub-data\private\pre-upgrade;
  3. check: version 2.13.0-m11, apiContract 13, BUILD_SAFE, 0 grants.
- C (option): local commit of M11 on v2-milestone-01, no push (the owner pushes).
- P (default): fixture project.
  1. create-factory-fixture.mjs booking-demo creates C:\Users\mihai\OneDrive\Desktop\Ifrim Digital Proiecte\ifrim-delivery-demo-detailing (git init + 1 commit inside it);
  2. registration as a TEST project;
  3. Windows route; autonomy ASSISTED.
- D (default): ONE delivery plan from the reference sentence (envelope + derived delivery package).
- R (default): ONE media revision from the reference revision sentence.
- V (option): spoken confirmation, only if the local voice gate is active in the owner session; otherwise click or Enter.
- X (option, owner action): after acceptance the owner edits one tracked file in the fixture (for example README.md), then presses „Verifică acum” to prove STALE. Claude does not edit it.

BUDGETS (fixed, shown and hashed on the card)
- Models:
  - writer Codex gpt-6.1-sol · medium: Windows sandbox, profile ifrim_hub_rw, network off, writes only to the fixture;
  - reviewer Claude sonnet · medium, read-only.
- Turns: ≤ 3 writer turns (1 + 2 repairs), ≤ 3 review turns. Anything beyond is a contextual delta.
- Time: mission ≤ 60 min (+30 envelope slack); delivery phase ≤ 30 min (hard stop 60); revision plan ≤ 15 min; total wall clock ≤ 2.5 h.
- Lega (only if used): one session ≤ 20 min.
- Capture: 2 × ≤ 60 s. Renders are local. Disk ≤ 1 GB across media and exports.
- Cost: subscriptions only; no paid API, no extra usage.

NOTHING ELSE
- No publish, upload, message, deploy or push.
- No commit except C and the fixture's own init commit.
- No real data, no other project, no desktop app.
- No manual grant; no mode change (BUILD_SAFE throughout).

STEPS AND EXPECTED EVIDENCE (each labelled PASS_LIVE / FAIL / BLOCKED / NOT_RUN)
1. U. Upgrade, then health: 2.13.0-m11, contract 13, BUILD_SAFE, 0 grants, migration 12 recorded.
2. P. The project is registered; the cockpit shows it as test, Windows route, synthetic.
3. Account checks if older than 24 h: the owner presses „Verifică contul” for Codex and Claude (no inference). If the Claude billing re-declaration blocker shows, the owner re-declares in session.
4. Probe counters: mark S0 (read-only).
5. D. The owner types or says the reference sentence. Expected: ONE card with engineering + delivery section (the finite scope in planAndAuthority), noPublish shown, no question. The owner confirms once.
   Evidence: envelope CONFIRMED and delivery ARMED in the same transaction; no approval card; no grant form.
6. Engineering. Expected:
   - BASELINE fails with INTERVAL_OCUPAT_LIBER_PE_MOBIL;
   - the writer changes public/js/slots-view.mjs; the protected test is untouched;
   - checks and review PASS; QA PASS; preview on 4620 PASS;
   - E2E AC-6 and AC-7 PASS; bundle READY;
   - repairs within 2 cycles;
   - envelope COMPLETED with grants revoked.
7. Delivery package, derived (NO second confirmation). Expected:
   - activation checklist PASS;
   - the plan runs: prepare, preview reused, 2 captures, edit, master render + QA, vertical + QA, export to Videos\Ifrim Studio\Exporturi\demo-programari-…, summary v1;
   - delivery READY;
   - capture labels ORIGINAL_RECORDING plus on-screen „DATE SINTETICE · DEMO LOCAL”;
   - snapshot equal before and after both captures.
8. Room check, read-only:
   - the six deliverables;
   - E2E screenshots desktop + phone width; players play; QA chips;
   - the summary has no price and no deadline („De stabilit (neconfigurat)”);
   - five decisions pending; publishing shown OFF.
9. R. The owner says or types the revision sentence. Expected:
   - feedback noted (not acceptance);
   - ONE revision card, confirmed once;
   - master v2 (cut at 10 s to „programare mobil”, business texts), vertical v2, QA on both, summary v2 (video section only);
   - bundle, capture and test ids unchanged; v1 items SUPERSEDED;
   - no model.
10. Owner-only decisions (optional, independent):
    - „Accept local” → OWNER_ACCEPTED; the delivery items stay CURRENT;
    - creative approval of master v2 with Windows Hello;
    - „Gata de prezentare” on summary v2.
    Verify that none implies another.
11. X (if chosen): the owner edits README.md, then „Verifică acum”. Expected:
    - delivery STALE with the file listed;
    - the old clip hidden as evidence; the variant INVALIDATED;
    - summary export and approval refused.
12. Closure, read-only:
    - probe counters since S0;
    - events show no publish, upload, send or manifest approval;
    - BUILD_SAFE throughout; settings drift none (mediaPolicy liveCapture / autoPublish / liveUpload still false);
    - 0 manual grants; envelope COMPLETED; ops plans DONE.
    The report goes to .ifrim/M11_PILOT_RESULTS.md.

STOP CRITERIA (stop and report FAIL)
- A second confirmation is needed for the package (except the documented same-credential delta after a session ended, which is reported as such).
- A capture origin other than 127.0.0.1:4620.
- A manual grant or mode change.
- A model other than the card's.
- Any publish or upload event.
- Undetected snapshot drift.
- A summary with an invented price or deadline.
- A modified protected test.

ROLLBACK
- Hub: upgrade.mjs back to the 2.12.1 commit with the pre-migration backup. The M11 tables are additive; delivery features are inert without a delivery row.
- The fixture folder stays; no deletion without explicit approval.
- Exports stay in Videos.

## RISKS
- New authority path (adoptDerived). Risk: a derived plan runs without a real owner decision. Mitigations:
- internal-only API;
- the exact ops body sha is hashed in the confirmed envelope and re-checked;
- an activation checklist (credential, policy, Stop All, tools, origin, snapshot);
- no decisions, models, apps or ops outside DELIVERY_PHASE_OPS;
- authorize() unchanged; a catalog-scan test; a mutation test per refusal.
- Ops body determinism. Any non-deterministic describe() (a timestamp, a changing path) would make activation fail with PLAN_DERIVED_CHANGED. Mitigations: describe is pure by contract; the template test hashes the body twice across clock changes; a failure falls back honestly to the difference card, never to a silent widening.
- Owner session ended between confirmation and the end of the delivery phase (logout, revoke, 8 h, or an idle expiry triggered when the owner returns after 30 min). The phase stops at its next op (NEEDS_OWNER) and needs one same-credential reconfirm click. This is honest, but not zero-click in that case; the parent-bound alternative is an owner decision.
- P0 concurrency. envelopes, intents, intake, work-requests, cockpit, hub, command-catalog, owner-commands, cards.jsx and others are in the P0 diff. Mitigations: every M11 edit to them is in Wave B (order 3-5), starts only after the P0 commit, and is kept small and additive; Wave A touches none of them (verified against p0-files.txt).
- Preview lifecycle. factory.accept/reject stop factory-preview-<mission> (factory.mjs:1139, 1162). Mitigations: the Room's accept wrapper refuses while a capture runs; an accept from FactoryPanel mid-capture fails that step (NEEDS_OWNER), and „Continuă” restarts a delivery-scoped preview after a snapshot check.
- Port 4620 occupied by a foreign process: the preview is BLOCKED honestly (the runner refuses an occupied port) and is explained once.
- OneDrive sync on the fixture folder (data/bookings.db locks or delays), the same profile as Demo B. Exports go to Videos, not OneDrive.
- Capture timing nondeterminism: marker times vary between runs. Revision cut points therefore come from markers, never from fixed seconds, and hard cuts make every cut valid. Slot exhaustion is bounded (13 free per day, per-day reseed) and documented (reset = delete data/).
- 'Mobile' is viewport-only (390×844, dsf 2, no touch or UA). The wording must stay honest everywhere (summary, card, clip, Room); this is enforced by template texts and a test.
- Windows sandbox first-command latency after a reboot (145 s observed in M03) eats into the 60-min mission budget. It still fits; the pilot sheet asks for a warm-up via the existing preflight if needed.
- Vertical reframing of desktop segments may letterbox and produce legibility WARN findings. This is shown, never silent, and acceptable for an internal presentation.
- Snapshot false positives on projects that write runtime files outside workspace.ignore would make deliveries STALE constantly. The fixture declares data/; verify always lists the changed files.
- Writing media_variants INVALIDATED and refusing SUPPORTED claims on STALE/REJECTED bundles activates code paths that never fired. Old Studio claims citing REJECTED bundles would newly fail factual QA. This is intended, covered by the m09 distribution/QA regression suites, and listed in the M11 report.
- Golden-hash drift. Any accidental field in envelopes.buildBody or in the executors' describe would supersede live proposed cards and change ops plan hashes after the upgrade. Golden tests protect both.
- The writer may fix the bug differently (for example by touching the desktop branch). The protected AC-2/AC-3 tests and the independent review catch regressions; repairs stay within the card.
- Disk / media quota: captures + 2 final renders + exports are a few hundred MB. assets.quota and the disk reserve are checked before capture.
- The exports folder is not approved (folderContext): the phase would need a folder decision, which a derived plan refuses. Mitigation: eligibility checks it at proposal and explains it once.

## UNITS
### 1. U1 Booking fixture (programări detailing) (deps: )
FILES: v2/fixtures/factory/booking-demo/**; v2/server/factory/fixtures.mjs; v2/scripts/create-factory-fixture.mjs; v2/tests/fixtures/factory-patches/booking-fix.json; v2/tests/fixtures/factory-patches/booking-partial.json; v2/tests/fixtures/factory-patches/booking-tamper.json; v2/tests/fixtures/factory-solutions/booking-demo/**; v2/tests/m11-fixture.test.mjs; v2/tests/m11-fixture-e2e.test.mjs
WORK: - Build the synthetic booking app exactly as in the fixture field: the mobile-only availability bug in public/js/slots-view.mjs; the protected test/acceptance.test.mjs with the INTERVAL_OCUPAT_LIBER_PE_MOBIL message; port 4620; data/ ignored; per-day idempotent seeds; no prices.
- Register FACTORY_DEMOS['booking-demo'] with the spec plus the separate `delivery` block (noun, issue, tone texts with criteria, proofSelector, bannerSelector, variant overrides). The marker gets data:'synthetic'.
- DIR_MAP and CHECK_FILE in the script.
- Patch JSONs for the existing fake-codex factory-write scenario.
- Tests prove the baseline fails for the right reason, passes after the fix, and the real-Chromium AC-6/AC-7 behaviour (SKIPPED_ENV without Playwright).
- Touches no P0 file.

### 1. U2 Migration 12 (deps: )
FILES: v2/server/storage/migrations.mjs; v2/scripts/migration-dry-run.mjs; v2/tests/m11-migration.test.mjs
WORK: - Append migration 12 `m11-deliveries` with exactly the DDL in dataModel (4 tables, indexes, no ALTER).
- Add the M11 table group to the dry run.
- Tests: additive on schema 11; CHECKs; the partial unique indexes.

### 1. U3 Pure delivery modules (deps: )
FILES: v2/server/delivery/template.mjs; v2/server/delivery/capture-guard.mjs; v2/server/delivery/clip-ir.mjs; v2/server/delivery/summary.mjs; v2/server/delivery/stale.mjs; v2/server/delivery/revision.mjs; v2/server/sales/proposal.mjs; v2/tests/m11-template.test.mjs; v2/tests/m11-capture-guard.test.mjs; v2/tests/m11-clip-ir.test.mjs; v2/tests/m11-summary.test.mjs; v2/tests/m11-stale-graph.test.mjs; v2/tests/m11-revision-parse.test.mjs
WORK: - Implement the pure functions specified in modules / clipPipeline / summaryRenderer / staleRules / revisionFlow / capturePolicy: template + eligibility + packageSteps, capture guard (LIVE_PORTS regardless of test mode, probeNotHub, pageGuard), master IR + toneOps + applyPrefs, summary + fact guard, stale graph, revision classifier with jump-to-marker.
- Export the helpers from sales/proposal.mjs (export-only change).
- Golden and mutation tests use inline fixture objects (the FACTORY_DEMOS delivery block shape documented in fixture), so this unit does not wait for U1.

### 1. U4 Media extensions + executor params (deps: )
FILES: v2/server/media/capture.mjs; v2/server/media/review.mjs; v2/server/media/qa.mjs; v2/server/media/content.mjs; v2/server/media/variants.mjs; v2/server/media/index.mjs; v2/server/ops/executors.mjs; v2/tests/m11-media-extensions.test.mjs
WORK: - capture: highlight rect marker; optional pageGuard callback.
- review: createReviews.proposeOps.
- qa: bundle-status enrichment and CLAIM_EVIDENCE_STALE.
- content: refuse SUPPORTED with a STALE/REJECTED bundle.
- variants: invalidate().
- index: exportLocal optional folder.
- ops/executors: optional qaUse/overrides on media.render and media.variant.render, emitted only when given (hash regression test).
- No change to checkDemoOrigin, MB1, OBS or the live-Hub refusal.

### 1. U5 Factory hooks + derived ops plans + action policy (deps: )
FILES: v2/server/factory/factory.mjs; v2/server/ops/plans.mjs; v2/server/policy/action-policy.mjs; v2/tests/m11-factory-hooks.test.mjs; v2/tests/m11-derived-plan.test.mjs
WORK: - factory: snapshotCheck, deliveryBinding, previewStatus and e2eShotPath (read-only); emit factory.bundle.status at the 4 bundle status writes inside their transactions.
- plans: registerParent and adoptDerived with every refusal and the derived consent/authority. authorize/resume/reconfirm are untouched; no command exposure.
- action-policy: delivery.verify, delivery.preview, delivery.bind, delivery.summary and capture.preview as PLAN_STEP.
- Tests include a catalog scan, the same-credential reconfirm, Stop All, and golden hashes of existing plans.

### 2. U6 Delivery service, executors, files, commands, routes (deps: U1 Booking fixture (programări detailing), U2 Migration 12, U3 Pure delivery modules, U4 Media extensions + executor params, U5 Factory hooks + derived ops plans + action policy)
FILES: v2/server/delivery/delivery.mjs; v2/server/delivery/executors.mjs; v2/server/delivery/files.mjs; v2/server/delivery/delivery-commands.mjs; v2/server/delivery/delivery-routes.mjs; v2/tests/delivery-helpers.mjs; v2/tests/m11-delivery-binding.test.mjs; v2/tests/m11-delivery-capture.test.mjs; v2/tests/m11-delivery-stale.test.mjs; v2/tests/m11-delivery-real.test.mjs
WORK: - The service: rows and documents/revisions; createPlanned/sectionFor/sectionForMission/arm/activate (full checklist)/proposePackage; bind/supersede/markStale; verify; view (the exact deliveryRoomUI contract); document edit/approve/service; close/cancel; tick; all bus listeners; parent registration.
- The step executors with the exact capture policy (pre-launch refusals, plan binding, snapshot bracket, scope binding, labels, pageGuard) and reconcile.
- files.writeNew.
- Commands (incl. delivery.software.accept with the displayed-bundle check and the capture guard) and the route patterns, as exported register functions not yet wired into hub.mjs.
- Service-level tests on test-hub parts; the real-tool test is SKIPPED_ENV-aware.

### 2. U9a Delivery Room UI (new files only) (deps: )
FILES: v2/web/src/screens/DeliveryRoom.jsx; v2/web/src/screens/delivery/SoftwarePanel.jsx; v2/web/src/screens/delivery/PreviewPanel.jsx; v2/web/src/screens/delivery/ClipPanel.jsx; v2/web/src/screens/delivery/SummaryEditor.jsx; v2/web/src/screens/delivery/DecisionsPanel.jsx; v2/web/src/screens/delivery/ObservationsPanel.jsx; v2/web/src/lib/deliveryLogic.js; v2/web/src/styles/m11.css; v2/tests/m11-ui-logic.test.mjs
WORK: - Build the Room against the documented GET view contract (deliveryRoomUI), with a JSON fixture of the contract in the test: the six deliverables, players, screenshots, summary editor, independent decision rows, STALE banner and hidden stale players.
- Pure logic in deliveryLogic.js with unit tests.
- No shared-file edits; it can run in parallel with U6.

### 3. U7 Envelope delivery section + delivery planner (deps: U6 Delivery service, executors, files, commands, routes)
FILES: v2/server/owner/envelopes.mjs; v2/server/owner/planners/delivery.mjs; v2/tests/m11-envelope-delivery.test.mjs; v2/tests/m11-delivery-planner.test.mjs
WORK: - envelopes: attachDelivery; propose(deliveryId) and continuation carry; buildBody extras.delivery (spread only when present; limits untouched); summaryOf delivery lines + steps/stops sentence; changedParts key + CHANGE_LABELS.delivery; confirm rebuild with sectionFor(forConfirm) and arm inside the CONFIRMED transaction.
- Golden test that ordinary hashes are unchanged.
- Planner prepare/revise as specified, reusing the engineering planner helpers, readiness facts and the blocked recorder.
- START ONLY AFTER THE P0 COMMIT LANDS (envelopes.mjs is a P0 file).

### 4. U8 Wiring: intents, intake, work requests, layout, cockpit, hub, catalog, routes (deps: U6 Delivery service, executors, files, commands, routes, U7 Envelope delivery section + delivery planner)
FILES: v2/server/owner/intents.mjs; v2/server/owner/intake.mjs; v2/server/owner/work-requests.mjs; v2/server/owner/layout.mjs; v2/server/owner/cockpit.mjs; v2/server/hub.mjs; v2/server/runtime/command-catalog.mjs; v2/server/http/routes.mjs; v2/tests/m11-intents.test.mjs; v2/tests/m11-cockpit.test.mjs; v2/tests/m11-routes.test.mjs; v2/tests/m11-decisions-separation.test.mjs; v2/tests/m11-integration.test.mjs
WORK: - The delivery_* intents, NEVER_SPLIT/START_LIKE, and the noPublish constraint in constraintsOf.
- PLANNER_KINDS/PLANNER_FOR_INTENT, delivery_open navigation, lastTarget kind delivery; work-request intent 'delivery'.
- DeliveryRoom card type; cockpit deliveries + the OWNER_ACCEPTED done-list fix.
- hub.mjs: create the delivery service; Object.assign the executors; registerParent; attachDelivery (envelopes, cockpit); register the planner next to the run planner; delivery.tick in extraTick.
- registerDeliveryCommands / registerDeliveryRoutes.
- The full PASS_SIMULATED integration test.
- After the P0 commit only.

### 5. U9b UI integration (shared files) (deps: U8 Wiring: intents, intake, work requests, layout, cockpit, hub, catalog, routes, U9a Delivery Room UI (new files only))
FILES: v2/web/src/main.jsx; v2/web/src/api.js; v2/web/src/screens/lega/cards.jsx; v2/tests/m11-ui-e2e.test.mjs
WORK: - Route livrare (lazy DeliveryRoom); API client calls.
- DecisionCard renders the hashed summary.delivery lines.
- A compact DeliveryRoom cockpit card linking to #/livrare/:id.
- Playwright UI E2E (SKIPPED_ENV without a browser).
- After the P0 UI commit.

### 6. U10 Release, regression, review, pilot sheet (deps: U1 Booking fixture (programări detailing), U2 Migration 12, U3 Pure delivery modules, U4 Media extensions + executor params, U5 Factory hooks + derived ops plans + action policy, U6 Delivery service, executors, files, commands, routes, U9a Delivery Room UI (new files only), U7 Envelope delivery section + delivery planner, U8 Wiring: intents, intake, work requests, layout, cockpit, hub, catalog, routes, U9b UI integration (shared files))
FILES: v2/server/config.mjs; .ifrim/M11_REPORT.md; .ifrim/M11_PILOT_SHEET.md; .ifrim/M11_TEST_REPORT.md
WORK: - HUB_VERSION 2.13.0-m11 and API_CONTRACT 13.
- Full npm run test:v2 + build:v2, listing SKIPPED_ENV.
- migration-dry-run on a copy of the live schema 11 (read-only).
- A read-only multi-agent review round with regression and mutation checks.
- Write the pilot sheet from livePilot.
- No commit, push, upgrade, model, HTTP to 8011 or fixture creation without the owner's exact approval.

## OPEN DECISIONS
- Delivery-phase continuity when the confirming owner session has ended (logout, revoke, 8 h, or an idle expiry triggered on return). DEFAULT: session-bound; authorize() is unchanged and the phase stops with NEEDS_OWNER, then one same-credential reconfirm click. ALTERNATIVE: parent-bound. A delivery plan with only DELIVERY_PHASE_OPS would be authorized by its envelope consent instead: credential active, policy active, no Stop All, binding unchanged, its own expiry. This matches the envelope's „Continui și dacă închizi pagina”, but adds a session-free branch to authorize().
- Clip revisions. DEFAULT: each media revision is ONE small plan card confirmed once (no code, no model). ALTERNATIVE: the original card pre-authorizes N (for example 2) clip revisions within 7 days, applied from an authentic owner request without another confirmation.
- Software acceptance from the Delivery Room. DEFAULT: delivery.software.accept requires the owner session and the displayed bundle sha, then calls factory.accept; FactoryPanel's existing accept is unchanged. ALTERNATIVES: also require a fresh Windows Hello, like creative approval; or tighten factory.accept everywhere.
- Route. DEFAULT: M11 delivery capture runs only on the Windows route for synthetic hub-test projects. Capture inside ifrim-runner is deferred to M12, because the attestation is invalid and the bwrap preview is unreachable.
- Mobile meaning. DEFAULT: viewport 390×844 at dsf 2 in Chromium, labelled honestly as „lățimea unui telefon”. ALTERNATIVE: device emulation (isMobile, hasTouch, mobile UA), which touches browser-core, the WSL E2E host and the spec schema.
- First clip tone. DEFAULT: 'both' (business hook + technical evidence texts), so „prea tehnic” is meaningful. ALTERNATIVE: 'business' from the start.
- Vertical profile. DEFAULT: shorts_9x16, used as an internal estimate (not a publishing target). ALTERNATIVE: a neutral „vertical presentation” profile, which needs PLATFORM_PROFILES version 2.
- CTA in a client demo. DEFAULT: „Hai să discutăm” (no promise). ALTERNATIVE: no CTA.
- Commercial basis. DEFAULT: „De stabilit (neconfigurat)”, since the live catalog is empty. ALTERNATIVE: the owner configures a detailing service (price and term CONFIGURED) and binds it in the Room.
- Summary formats. DEFAULT: Markdown + escaped HTML. ALTERNATIVE: a PDF or DOCX export, which needs a renderer that does not exist today.
- Rights for the presentation clip. DEFAULT: internal use only (owned material, no record). Portfolio, website or case_study use needs media.rights.record per scope, and case_study also needs marketing consent.
- Fixture location and name. DEFAULT: C:\Users\mihai\OneDrive\Desktop\Ifrim Digital Proiecte\ifrim-delivery-demo-detailing, „Demo Livrare — Detailing (programări)”, port 4620. The owner may choose another folder name or port, but not 3011, 8011 or 8012.
- Export folder. DEFAULT: Videos\Ifrim Studio\Exporturi\demo-programari-<proiect>-<data> under the approved exports dir. ALTERNATIVE: another approved folder.
- Fixture data reset. DEFAULT: bookings created by E2E and capture accumulate in data/ and are reset by the owner (delete data/). ALTERNATIVE: a reset step inside the delivery plan, which writes to the project's data folder.
- When to capture. DEFAULT: during DELIVERY_READY, on the verified (not yet accepted) change set, so one confirmation covers it; acceptance stays independent. ALTERNATIVE: capture only after OWNER_ACCEPTED, through a delivery-scoped preview, which needs a second action.
---

## APPENDIX A — Wave 0 (2026-10-05, pre-probe, new files only)

Result: 45 new untracked files, no existing tracked file modified. `node --test --test-concurrency=1 v2/tests/m11-*.test.mjs`: 97 tests, 95 pass, 0 fail, 2 skipped (M11-FX-13/14 wait for the fixture registration in `fixtures.mjs`). Real Chromium ran (no SKIPPED_ENV on this machine). Labels: PASS_LOCAL for the pure modules and the fixture; nothing live.

### Files created

- `v2\fixtures\factory\booking-demo\.gitignore`
- `v2\fixtures\factory\booking-demo\README.md`
- `v2\fixtures\factory\booking-demo\config.json`
- `v2\fixtures\factory\booking-demo\package.json`
- `v2\fixtures\factory\booking-demo\server.js`
- `v2\fixtures\factory\booking-demo\src\server-app.js`
- `v2\fixtures\factory\booking-demo\src\catalog.js`
- `v2\fixtures\factory\booking-demo\src\slots.js`
- `v2\fixtures\factory\booking-demo\public\index.html`
- `v2\fixtures\factory\booking-demo\public\styles.css`
- `v2\fixtures\factory\booking-demo\public\js\app.mjs`
- `v2\fixtures\factory\booking-demo\public\js\slots-view.mjs`
- `v2\fixtures\factory\booking-demo\test\acceptance.test.mjs`
- `v2\fixtures\factory\booking-demo\test\unit.test.mjs`
- `v2\server\factory\booking-demo-def.mjs`
- `v2\tests\fixtures\factory-patches\booking-fix.json`
- `v2\tests\fixtures\factory-patches\booking-partial.json`
- `v2\tests\fixtures\factory-patches\booking-tamper.json`
- `v2\tests\fixtures\factory-solutions\booking-demo\slots-view.mjs`
- `v2\tests\fixtures\factory-solutions\booking-demo\slots-view.partial.mjs`
- `v2\tests\fixtures\factory-solutions\booking-demo\regression.test.mjs`
- `v2\tests\fixtures\factory-solutions\booking-demo\make-patches.mjs`
- `v2\tests\m11-fixture.test.mjs`
- `v2\tests\m11-fixture-e2e.test.mjs`
- `v2\server\delivery\template.mjs`
- `v2\server\delivery\capture-guard.mjs`
- `v2\server\delivery\clip-ir.mjs`
- `v2\server\delivery\stale.mjs`
- `v2\server\delivery\revision.mjs`
- `v2\tests\m11-template.test.mjs`
- `v2\tests\m11-capture-guard.test.mjs`
- `v2\tests\m11-clip-ir.test.mjs`
- `v2\tests\m11-stale-graph.test.mjs`
- `v2\tests\m11-revision-parse.test.mjs`
- `v2\web\src\screens\DeliveryRoom.jsx`
- `v2\web\src\screens\delivery\SoftwarePanel.jsx`
- `v2\web\src\screens\delivery\PreviewPanel.jsx`
- `v2\web\src\screens\delivery\ClipPanel.jsx`
- `v2\web\src\screens\delivery\SummaryEditor.jsx`
- `v2\web\src\screens\delivery\DecisionsPanel.jsx`
- `v2\web\src\screens\delivery\ObservationsPanel.jsx`
- `v2\web\src\lib\deliveryLogic.js`
- `v2\web\src\styles\m11.css`
- `v2\tests\m11-ui-logic.test.mjs`
- `v2\tests\fixtures\m11-delivery-view.json`

### Contract notes between the units (for U4/U6)

- LINES UP (A1 -> A3): BOOKING_DEMO.delivery passes template.normalizeDeliveryBlock with 0 problems and every key is consumed (noun, issue, proofSelector, bannerSelector, evidenceNote, exportPrefix, texts{hook,desktop,mobile,cta}{criteria,business,technical}, variant{platformKey,overrides{hookText,ctaText}}). The override keys are the real deriveVariant keys (v2\server\media\variants.mjs:364). The spec passes the real normalizeSpec + checkSpec with no problems.
- LINES UP (E2E -> capture): AC-6 and AC-7 map through template.captureScriptFrom to 20 demo steps each, a fixed point of the real validateDemoSteps (kinds: goto, marker, wait, highlight, click, waitFor, type). Run in real Chromium against the fixture with the reference fix (scratch copy, random loopback port): both scripts complete (desktop 1280x720@1.5, mobile 390x844@2), A3's pageGuard passes after each of 15 actions per capture, probeNotHub passes (/ 200, /api/session 404, no Hub headers), no horizontal overflow, all six highlights fully inside the viewport, the sticky banner is in frame.
- LINES UP (template -> ops engine): sectionOf has every key of the blueprint's delivery section; packageSteps gives 10 steps whose `$pas:N.field` refs match plans.mjs resolveRefs and name fields the existing executors return (media.render: renderJobId, assetVersionId; media.variant.render: variantId, editVersionId, assetVersionId). Export folder = demo-programari-<slug>-<yyyymmdd>. The master IR built from simulated capture markers is valid (real validateIR) with the 5 blueprint markers; the golden sentence gives classes [feedback, tone, clip], replace_text x2 + cut_range[300, 'programare mobil'), brief {audience: business}, prefs {tone, jump{10,'programare'}}.
- LINES UP (stale.mjs -> DATA MODEL -> UI fixture): ITEM_KINDS, ITEM_STATUSES, STALE_CODES and DELIVERY_STATUSES equal the migration CHECK lists; both variants of v2\tests\fixtures\m11-delivery-view.json use only those kinds/statuses, and the roles match REQUIRED_SLOTS; linkProblems is empty and slotsComplete is true on the fixture's v1 item set; the software_changed reason equals the fixture's STALE statusReason; revision statuses/classes and the 10 summary section ids + headings are identical in revision.mjs and the fixture. Endpoints the Room calls exist (POST /api/media/edit-versions/:id/decision, GET /api/media/files/:id, /api/owner/status, /api/sales/services).
- MISMATCH A3 <-> A9a, running capture: the view contract gives plan steps as {seq,title,status}; the UI detects a capture step by title regex /captur|filmez|inregistrez/ (v2\web\src\lib\deliveryLogic.js:575), but A3's real titles are 'Filmează demo-ul ...' (v2\server\delivery\template.mjs:512-513). See defect 1. Fix: U6 view adds steps[].kind (the UI already reads it) and widen the regex.
- MISMATCH A3 <-> A9a, selection: the Room sends selection {kind:'text', id, versionId} (deliveryLogic.js:493, ClipPanel.jsx:184); classify accepts kinds master|clip|edit|vertical|variant|summary|document (v2\server\delivery\revision.mjs:139,159) and silently drops anything else. See defect 2. Also the body has no player for timecodeMs, so classify's playerKind defaults to master (revision.mjs:170): a moment taken in the 9:16 player targets the 16:9 clip.
- MISMATCH A3 <-> A9a, summary 'provenance' section: revision.mjs marks video AND provenance as generated and refuses a sentence edit (SUMMARY_SECTION_AUTO); the UI locks only video (deliveryLogic.js:754) and builds a summary-edit body for provenance. The blueprint names only video as auto. U6 must choose and send sections[].auto / editable (the UI honours both).
- CONTRACT GAP, software acceptance: the view carries only software.bundle.shaPrefix, so the UI posts displayedBundleSha = the 12-character prefix (deliveryLogic.js:624-628) while the blueprint compares it with the bundle sha. U6 must add software.bundle.sha (the UI prefers it) or compare by prefix.
- CONTRACT GAP, delivery.finish inputs: its params (template.mjs:519) carry only render=$pas:6.renderJobId, variant and verticalEdit. Missing: the vertical renderJobId, both QA run ids, the export results. Existing executors drop the QA runId (v2\server\ops\executors.mjs:39-40) although qa.run returns it (v2\server\media\qa.mjs:797). U6 must look these up by edit version, or U4 adds qa.runId to step results / A3 adds refs before any body is hashed.
- ORDERING RISK, existing executors: media.render and media.variant.render describe() rebuild params without qaUse / overrides (executors.mjs:190, 206). Until the U4 edit, a body built from packageSteps silently loses qaUse:'internal' and the 9:16 overrides, and QA would run with use 'organic'. The U4 edit must land before the first delivery body sha is computed.
- A1 <-> blueprint (A1's open issue, now shown): the hook's technical text cites AC-6 but is gated on [AC-1] (v2\server\factory\booking-demo-def.mjs:92). With AC-6 not PASS and tone 'technical' the master keeps 'Fix verificat: ... (AC-1, AC-6)' while t-mobile is omitted. Gate on both criteria or drop AC-6 from the text.
- A1 <-> A3: variant overrides are tone-agnostic. After the business revision the 9:16 keeps 'Programări online — demo' / 'Hai să vorbim' (fine); after a technical revision it would still show business wording.
- A9a fixture is illustrative, not derived from A1/A3 output (shape is fine): label item id 't-label' (real IR: 'l-data'; the UI still detects the label by its text), cta marker note '' (real: 'final'), plan step titles, startCommand 'node server.mjs' (real: 'node server.js'), changed files public/app.js + src/slots.mjs (real: public/js/slots-view.mjs), AC-8 manual (real spec: AC-1..AC-7). Refresh it from a real U6 view once one exists.
- A3 vs the blueprint status machine: stale.mjs adds READY -> NEEDS_OWNER (studio_correction, rights_revoked, file_missing), needed by STALE RULES #5 but absent from the DATA MODEL list. STALE and FAILED are terminal, while the Room offers 'plan nou de împachetare' for FAILED/STALE/NEEDS_OWNER (deliveryLogic.js:959), so U6's package.propose must create a new delivery row there. plan_stopped applies only from ACTIVE: a failed delivery.revise plan on a READY delivery leaves it READY.
- A3 media_revision rule roots at edit:master and never touches the brief, while the UI fixture expects brief v1 SUPERSEDED after a tone revision. U6 must pass the old brief in rootIds or supersede it itself.
- A3 sectionOf adds specSha and templateSha to the hashed delivery section (not in the blueprint shape). Additive; document it in API contract 13.
- Coupling to P0-owned files: v2\server\delivery\clip-ir.mjs:31 and revision.mjs:26 import normalize / numberOf from v2\server\owner\intents.mjs (changed today by P0); the Room components import OpsPlanCard.jsx, cards.jsx and store.js (P0-edited). The m11 tests sit in the `npm run test:v2` glob, so a P0 rename would fail M11 tests inside P0's own full run. Re-run m11-revision-parse, m11-clip-ir and m11-ui-logic after the P0 commit.
- Naming collision for U2: v2\scripts\migration-dry-run.mjs:45-46 already uses M11 / m11Tables / m11Complete for migration 11 (work_requests). The delivery tables of migration 12 need another group name (M12 / m12Tables).
- UI gap: the Room has no action for delivery.close or delivery.cancel (DELIVERY_ACTIONS has 9 actions), though the blueprint defines both commands.
- Confirmed from A1: a 30-minute service has 12 free slots per day, not 13 (the seeds occupy 10:00, 11:30, 12:00, 15:00). Observed in the browser run: the phone-width capture's evidence highlight lands on the slot the desktop capture has just booked (09:00), not on a seed. Honest, but it is what the clip will show.

### Ordered checklist for the post-probe wave

- 0. Before the P0 commit (no M11 edit): stage P0 files by explicit path, never `git add -A` — 45 untracked M11 files share the tree and must not enter the P0 commit. Refresh p0-files.txt first (it misses plans.mjs, operator.mjs, OpsPlanCard.jsx, Shell.jsx, DesktopBar.jsx, Desktop.jsx, m10.css, wsl-runner.mjs and has .js for five .jsx files). Expect +97 tests (about 40 s, 2 skips) in `npm run test:v2`.
- 1. Allowed now (M11's own new files, no shared file): fix defects 1-6 below — capture-step detection in deliveryLogic.js, selection kind 'text' in revision.mjs (or a documented mapping), trimmed evidenceSelectors in template.mjs, one rule for the provenance section, the tone target when the clause names the site/app, the hook's AC-6 gating in booking-demo-def.mjs.
- 2. After the probe and the P0 commit — v2\server\factory\fixtures.mjs (A1): after the TEST_PROJECT_MARKER import (line 4) add `import { BOOKING_DEMO } from "./booking-demo-def.mjs";`; add `"booking-demo": BOOKING_DEMO,` as the last FACTORY_DEMOS entry (before line 58); change the marker line (67) to include `...(demo.data ? { data: demo.data } : {})` before createdAt. Unblocks M11-FX-13, capture-guard's default knownFixtures and template.eligibility (today: DELIVERY_FIXTURE_UNKNOWN). Demo A/B markers stay byte-identical. Then re-run the m03/m05 factory suites and m11-fixture.
- 3. v2\scripts\create-factory-fixture.mjs (A1): usage comment line 4 -> bug-demo|service-request|booking-demo; replace line 15 with DIR_MAP {bug-demo: ifrim-factory-demo-a, service-request: ifrim-factory-demo-b, booking-demo: ifrim-delivery-demo-detailing} + CHECK_FILE {bug-demo: src/requests.js, service-request: src/server-app.js, booking-demo: src/server-app.js}, exit 2 when a fixture has no mapping; use CHECK_FILE[fixture] in the `--check` call. CORRECTION to A1's report: that call is on line 26 (line 24 is materializeFixture). Unblocks M11-FX-14. Optional: a test-only projects-root override or exported maps so the test can execute the script; a one-line pointer in v2\tests\fixtures\factory-patches\make-patches.mjs to the booking generator.
- 4. U2 — v2\server\storage\migrations.mjs: append migration 12 `m11-deliveries` with the blueprint DDL; add a test that its CHECK lists equal stale.mjs ITEM_KINDS / ITEM_STATUSES / DELIVERY_STATUSES and revision.mjs REVISION_RECORD_STATUS values. v2\scripts\migration-dry-run.mjs: add the four delivery tables under a NEW group name (M12 / m12Tables / m12Complete), because M11 / m11Tables there already mean migration 11.
- 5. U4 — v2\server\ops\executors.mjs: media.render and media.variant.render accept optional qaUse (-> media.qa.run({use})) and overrides (-> variants.derive({overrides})), emitted by describe only when given (hash regression test). Also expose the QA run id in the step result (qa.runId) so delivery.finish can bind qa items. Must land before any delivery body sha is computed.
- 6. U4 — v2\server\media\capture.mjs: the highlight step (lines 935-940) also records {kind:'highlight', atMs, note: <the step's normalized selector, untruncated>, rect: boundingBox / viewport clamped to 0..1, source:'step', step}; clip-ir.mjs matches note against the template's evidenceSelectors / proofSelector by exact string. Add the optional input.pageGuard(page) after the redaction check of every navigation and after every step (throw -> CAPTURE_PRIVACY_REFUSED, frames wiped). No change to checkDemoOrigin, MB1 or contextSetup.
- 7. U4 — v2\server\media\index.mjs exportLocal({folder}) with /^[a-z0-9][a-z0-9-]{2,80}$/ (same rule as template.mjs FOLDER_RE); review.mjs proposeOps (takes classify().media.ops: replace_text + cut_range); variants.mjs invalidate (ids from stale.variantsToInvalidate = item.refId); qa.mjs + content.mjs CLAIM_EVIDENCE_STALE.
- 8. U3 remainder — v2\server\sales\proposal.mjs: export-only (NOT_CONFIGURED, clean, priceText, leadTimeText, materialLines). Then the new files v2\server\delivery\summary.mjs + v2\tests\m11-summary.test.mjs, with section ids equal to revision.mjs SUMMARY_SECTIONS.
- 9. U5 — v2\server\policy\action-policy.mjs: OPERATIONS += delivery.verify, delivery.preview, delivery.bind, delivery.summary, capture.preview (PLAN_STEP). v2\server\factory\factory.mjs: snapshotCheck, deliveryBinding, previewStatus, e2eShotPath and the factory.bundle.status events. v2\server\ops\plans.mjs: registerParent + adoptDerived — only after the P0 commit, since P0 round 2 is editing this file.
- 10. U6 (new files: delivery.mjs, executors.mjs, files.mjs, delivery-commands.mjs, delivery-routes.mjs) with what the Room already reads: plans[].steps[].kind; software.bundle.sha (or prefix compare in delivery.software.accept); summary.sections[].auto / editable; clip.<slot>.fps; delivery.contentProjectId and snapshotShaPrefix; POST action slugs exactly verify, package-propose, revise, summary-edit, summary-approve, summary-service, software-accept, preview-start, preview-stop; map the Room's selection and player into classify's ctx; supersede the old brief on a tone revision; create a new delivery row when re-packaging a FAILED or STALE one; pass captureBrowserDemo `deviceScaleFactor` from the template's `dsf`.
- 11. Wave B server (after the P0 commit): v2\server\owner\envelopes.mjs (attachDelivery, delivery section, arm inside the CONFIRMED transaction), new v2\server\owner\planners\delivery.mjs, intents.mjs (delivery_* intents, noPublish constraint), intake.mjs + work-requests.mjs, layout.mjs, cockpit.mjs (deliveries + the OWNER_ACCEPTED done-list fix), hub.mjs + runtime\command-catalog.mjs + http\routes.mjs wiring.
- 12. Wave B UI (after the P0 UI commit): v2\web\src\main.jsx add `livrare: lazy(() => import("./screens/DeliveryRoom.jsx"))` and render it with id, query, go (parseRoute already returns {name,id,query}; m11.css is imported by DeliveryRoom.jsx itself); v2\web\src\screens\lega\cards.jsx: DecisionCard shows summary.delivery and the compact cockpit card from deliveryLogic.cockpitDeliveryCard; api.js only if helper calls are wanted (the Room uses `api` directly); add close / cancel controls if the owner should close a delivery from the Room.
- 13. Last: v2\server\config.mjs HUB_VERSION 2.13.0-m11 and API_CONTRACT 13. Then the full `npm run test:v2` + `build:v2`; M11-FX-13/14 must run un-skipped; re-run m11-revision-parse, m11-clip-ir and m11-ui-logic against the committed P0 versions of intents.mjs, OpsPlanCard.jsx, cards.jsx and store.js.

### Defects found by the cross-check (1–7 are in M11's own new files)

- 1 (medium, A9a x A3) v2\web\src\lib\deliveryLogic.js:575-577 — captureRunning() does not recognise A3's real capture steps. Scenario: a view shaped as the contract says (steps {seq,title,status}) with step 3 RUNNING and A3's title 'Filmează demo-ul pe desktop (1280×720, date sintetice, browser izolat)' (v2\server\delivery\template.mjs:512) returns false, and the 'Accept local' row comes back enabled with no reason. The blueprint requires it disabled while a capture runs. With steps[].kind = 'delivery.capture' it returns true and shows 'Aștept capturile sau oprește planul…'. The unit's own test passes only because its fixture title is 'Captură desktop (1280×720)'. The server-side refusal planned for delivery.software.accept would still protect acceptance.
- 2 (medium, A9a x A3) v2\server\delivery\revision.mjs:139 and 159-168 vs v2\web\src\lib\deliveryLogic.js:490-494 — the Room's selection is ignored. Scenario: hook t-hook selected on the current master, sentence 'Schimbă titlul în «Programări simple»'; with the body the UI really sends (selection {kind:'text', id:'t-hook', versionId}) classify returns CLARIFY 'Titlul clipului sau titlul rezumatului?'; with kind 'master' it returns PROPOSE, targetBy 'selection', replace_text on t-hook. The blueprint says a selection means no question.
- 3 (low, A3) v2\server\delivery\template.mjs:203-204 — evidenceSelectors keeps the raw E2E selector while the emitted demo steps are trimmed by validateDemoSteps (v2\server\media\capture.mjs:272). Scenario: an approved expectSelector " .slot[data-booked='true'][aria-disabled='true'] " (validateE2ESteps accepts it): captureScriptFrom is ok, but the selector is not among the highlight selectors; buildMaster then has no 'evidence' marker, one mobile evidence region instead of two, and the note 'Captura … nu are o evidențiere de dovadă cunoscută'. BOOKING_DEMO itself is not affected.
- 4 (low, A9a x A3) v2\web\src\lib\deliveryLogic.js:754 vs v2\server\delivery\revision.mjs:40-45 — the 'provenance' (Trasabilitate) section. Scenario: summaryEditBody(view, {provenance: 'Pachet verificat de mine'}) returns a valid edit body, while classify('În rezumat, la Trasabilitate scrie «…»') returns REFUSED / SUMMARY_SECTION_AUTO. The two units disagree on whether the owner may hand-edit traceability.
- 5 (medium-low, A3) v2\server\delivery\revision.mjs:381-387 — a tone word in a clause about the software becomes a clip revision. Scenario: 'Site-ul e prea tehnic.' -> classes [tone], status PROPOSE, replace_text on t-desktop and t-mobile of the master; 'Aplicația e prea comercială.' -> replace_text on t-hook and t-cta. Neither clause names the clip. Expected: a note about the software or ONE clarification. Nothing runs without the owner's confirmation of the card.
- 6 (low, A1 / blueprint) v2\server\factory\booking-demo-def.mjs:92 — hook technical text cites AC-6 but its criteria are ['AC-1']. Scenario: buildMaster with tone 'technical' and passed = all but AC-6 includes t-hook = 'Fix verificat: intervalele ocupate pe telefon (AC-1, AC-6)' while t-mobile is omitted as CRITERIA_NOT_PASS — an on-screen text naming a criterion that did not pass.
- 7 (low, A3) v2\server\delivery\revision.mjs, clause handling — odd answers to non-revision sentences: 'Fă commit și push.' -> CLARIFY 'Clipul 16:9 sau rezumatul comercial? Spune și textul nou, între ghilimele.'; 'Aprob clipul și publică-l pe YouTube.' -> REFUSED with only the creative-approval message (the publishing half gets no answer). Nothing is executed in either case.
- 8 (report accuracy, A1) neededSharedEdits item for v2\scripts\create-factory-fixture.mjs says 'on line 24 replace path.join(dir, fixture === "bug-demo" ? …)'; that expression is on line 26 (line 24 is the materializeFixture call).
- No defect found in: the fixture server and slot logic (Host/Origin checks, allowlist, per-day seeds), capture-guard (a test-mode Hub port and allowed-origin ports are refused with 0 requests sent; https, [::1], LAN and path origins refused), the stale cascade (idempotent, STALE never revives, brief kept on a software change, vertical-only and Studio-correction rules as in the blueprint), and the template (steps and refs deterministic, section complete).

## APPENDIX B — Wave 0 fixes (2026-10-05) and what is left for the post-probe wave

The seven cross-check defects of Appendix A were fixed inside M11's own files and verified independently. `node --test --test-concurrency=1 v2/tests/m11-*.test.mjs`: 104 tests, 102 pass, 0 fail, 2 skipped (M11-FX-13/14, pending the fixture registration). PASS_LOCAL; nothing live.

Contract decisions taken with the fixes (binding for U3/U4/U6):

- `plans[].steps[].kind` is part of the Room's view; the Room detects a running capture by kind `delivery.capture` first.
- The revise body is `{ text, selection: { kind:'text', id, versionId, player }, timecodeMs, player }` and goes straight into `revision.classify`'s ctx.
- The summary sections `video` and `provenance` are generated and locked on both sides; `delivery.summary.edit` must refuse a hand edit of either, and `summary.mjs` regenerates `provenance` from bundle facts.
- A tone text may cite only criteria it is gated on (`normalizeDeliveryBlock` refuses otherwise: `DELIVERY_TEMPLATE_INVALID`).

### Open after the fixes (from the fixer)

- Not fixable without a shared file — `.ifrim/M11_DESIGN.md` (not on my list, not edited). The DATA CONTRACT should add `plans[].steps[].kind` and the revise body `{ text, selection: { kind:'text', id, versionId, player }, timecodeMs, player }`. The blueprint should mark 'provenance' as generated alongside 'video'. Appendix A still lists defects 1–7 as open.
- For U6 (delivery service and view, not written yet): send `steps[].kind`; pass `body.selection`, `body.timecodeMs` and `body.player` straight into the classify ctx; send `sections[].auto` for video and provenance and refuse a hand edit of both in `delivery.summary.edit`; show every entry of `messages` for a REFUSED or NOTED answer, since two clauses give two messages. New result fields to carry: `clause.refused` 'NOT_PART_OF_DELIVERY', `feedback[].decisions`, feedback subjects 'publishing' and `about: 'tone'`.
- For U3 (`summary.mjs`): 'provenance' must be regenerated from bundle facts and never kept from an owner edit, in line with decision 4.
- For U4 (`v2/server/media/capture.mjs`, shared, checklist item 6): the highlight marker's note must be the step's normalized selector. M11-TP-14 simulates exactly that; the real capture does not record highlight markers yet.
- The fixture still has illustrative values that were not on the cross-check list and that I left alone: the clip's on-screen texts and frame times, the vertical's item set (3 items; a real variant has 5), the test rows ('node --test test/unit.test.mjs' 9/9 and 7/7; the real check is `node --test`), and the summary section bodies. Refresh from a real U6 view.
- Existing behaviour I did not change: a decision and a revision in one clause with no splitting conjunction ('Aprob clipul, dar e prea tehnic') answers only the decision; the tone half gets no answer.
- 'Schimbă titlul paginii, e prea tehnic' is NOTED with the hint under decision 5, not routed as a software request. Say if an imperative software verb should win over the tone rule.
- Unchanged from Appendix A: variant overrides are tone-agnostic; `delivery.finish` inputs and `software.bundle.sha` are U6/U4 work; M11-FX-13/14 stay skipped until `fixtures.mjs` and `create-factory-fixture.mjs` are edited (checklist items 2–3).
- Dependencies on P0-owned code are unchanged in kind: `revision.mjs` imports `normalize` / `numberOf` from `owner/intents.mjs` and now also `isDisclosureItem` from `media/review.mjs`. `m11-revision-parse.test.mjs` now imports `web/src/lib/deliveryLogic.js` and `m11-ui-logic.test.mjs` imports the server template, spec and clip-ir modules. Re-run the m11 set after the P0 commit.

### Regressions introduced by the fix of defect 7 (to resolve in the post-probe wave, before U6 uses the classifier)

Rule-based clause handling in `v2/server/delivery/revision.mjs` became too eager. Resolve them together, with one principle: a decision or repository operation is recognised only when it is the clause's own imperative addressed to the Hub (clause start, second person), never as a word inside a description.

- 1 (medium-low) Repository words anywhere in a clause now refuse real revisions and software requests. File: v2\server\delivery\revision.mjs — REPO_OPS (lines 112–116) is tested on the whole clause in decisionsIn (line 332, exempting only a clause that names the summary), and that step (lines 475–484) runs before the tone, jump, software and clip rules. Orig vs fixed, same context: 'În clip, taie partea cu push de la 10 la 14' PROPOSE cut 300–420 → REFUSED 'Push-ul nu face parte din livrare…'; 'În clip, schimbă textul de final în «Sunați-ne» după commit' PROPOSE replace_text t-cta → REFUSED; 'Taie de la 10 la 14 partea despre deploy' PROPOSE → REFUSED; 'Clipul e prea tehnic când vorbește despre commit' PROPOSE (2 tone texts) → REFUSED; 'Butonul de notificări push nu merge', 'Adaugă în aplicație un link către pagina de pe GitHub', 'Adaugă în meniu un buton de deploy' ROUTE_SOFTWARE → REFUSED (the software request is not routed); 'Site-ul e bine, dar pe GitHub lipsește un fișier' NOTED (positive feedback) → REFUSED. Nothing is executed, but a valid request gets a refusal with an unrelated message. Quoted text is not affected. No m11 test covers a repo word inside a clip or software clause.
- 2 (medium-low) The new clause split before a decision verb cuts software requests in two. File: revision.mjs DECISION_START / CONJ_SPLIT (lines 140–143): a clause now starts at 'trimite', 'publică', 'accept(ă)', 'aprob(ă)', 'postează' after 'și / iar / apoi / dar' or after a comma, also when the word is the third-person verb of a bug report. Orig vs fixed: 'Formularul nu merge și trimite programarea de două ori' ROUTE_SOFTWARE with the whole sentence → software.request = 'Formularul nu merge' plus the message 'Publicarea este oprită…'; same truncation for 'Formularul nu validează numele și trimite date goale', 'Butonul nu merge, trimite de două ori', 'Butonul nu merge și apoi trimite de două ori', 'Pagina nu merge și acceptă orice dată', 'Pagina afișează greșit și acceptă intervale ocupate' (answer: 'Acceptarea software-ului este decizia ta…'), 'Site-ul nu merge și publică programările tuturor', 'Pagina trebuie să afișeze și intervalele trecute, apoi trimite confirmarea', 'Adaugă în aplicație un buton, trimite apoi formularul'. The routed software request loses its second half and the owner gets an off-topic decision answer. textRedacted still holds the full sentence, so U6 could use it instead of software.request, but as classified the request is incomplete.
- 3 (low) Same cause as 2, cosmetic: an ordinary word read as a decision adds an unrelated message. 'Clipul e bun pentru prezentarea internă și publică' (adjective) and 'Clipul e bine, dar publică prea puțin despre servicii' stay NOTED but gain 'Publicarea este oprită…'; 'În clip, mută titlul mai sus, acceptă și varianta scurtă' stays PROPOSE but gains 'Acceptarea software-ului este decizia ta…'. Also from the new NO_PUBLISH rule: 'Nu trimite formularul datele' (a bug report) was UNKNOWN and is now NOTED 'Notat: nu public, nu urc și nu trimit nimic…'.
- 4 (low, disclosed in part by the report) The 'nothing to change' guard (revision.mjs line 592) runs before the 'named earlier in the sentence' and 'last revised within 10 minutes' target rules (lines 593–594), so those two rules no longer apply to a bare change verb — the file's header comment still lists them as targets. With a clip revised a minute earlier and recentItemId set, 12 of 17 follow-ups ('Șterge-l', 'Mărește-l', 'Ascunde-l', 'Schimbă-l', 'Pune-l în centru', 'Elimină-l'…) went from the clip parser's own question (for example 'Spune intervalul de tăiat…', 'Pune textul nou între ghilimele…') to UNKNOWN 'Nu am înțeles ce să schimb…'; with the summary as recent artifact 3 of 5 did the same. In a multi-clause sentence the unclear half is now a note and the rest is proposed ('În clip, schimbă textul de final în «Gata» și pune-l în centru' CLARIFY → PROPOSE + note), which the report states as its decision. No operation was lost in 28 probes (every original answer was a question), and the same verbs with a selection are unchanged (0 of 17).
- No regression found around defects 1–6 beyond the notes in their verdicts: the golden sentence is byte-identical before and after; BOOKING_DEMO's capture scripts and template sha are unchanged; clip-ir.mjs, stale.mjs and capture-guard.mjs were not modified; sentences with a selection, a moment, a quoted text or the summary named behave as before in every probe.
