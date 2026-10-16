# 2.14.17-m11 part A implementation and verification

Implemented against `bedda1d196fd424d5e73e6ca1e966d2861921794`, on `claude/project-thread-98qmet`. API contract remains 13; no migration changed. The package version is `0.1.0`, independent of the Hub version, so only `HUB_VERSION` changes.

The repeated phone entry came from **two revision generations**: the required-field revision augmented the inherited flow, then the privacy revision augmented it again. It was not a double merge. Browser E2E `fill` replaces a value; capture typing appends, which made the duplicated steps visible as a doubled phone number. Planner composition is now idempotent, and capture compilation collapses equal fills separated only by observations. Approved specs remain unchanged.

## Verification

Run from the repository root with system Node:

```powershell
& 'C:\Program Files\nodejs\node.exe' v2/tests/run-claims-offline.mjs
```

The runner invokes `--test --test-concurrency=1 --test-reporter=tap` once per file, sequentially, with the documented name filters. Its preload blocks Node socket connections/listeners, fetch, browser/model binaries and git subprocesses. Temporary databases, TAP logs and exact invocation/count JSON files are under `.tmp-s25-a/part-a-results/`. This is a test safeguard, not a general operating-system sandbox.

Final results (filtered-out cases are excluded, not reported by Node as skipped):

| File in `v2/tests/` | Tests | Pass | Fail | Skipped | Cancelled |
| --- | ---: | ---: | ---: | ---: | ---: |
| r-claims.test.mjs | 19 | 19 | 0 | 0 | 0 |
| m11-template.test.mjs | 16 | 16 | 0 | 0 | 0 |
| m11-clip-ir.test.mjs | 14 | 14 | 0 | 0 | 0 |
| m11-summary.test.mjs | 7 | 7 | 0 | 0 | 0 |
| m11-fixture.test.mjs | 6 | 6 | 0 | 0 | 0 |
| m09-media-ir.test.mjs | 27 | 27 | 0 | 0 | 0 |
| m09-media-qa.test.mjs | 19 | 19 | 0 | 0 | 0 |
| m09-content.test.mjs | 11 | 11 | 0 | 0 | 0 |
| m11-ui-logic.test.mjs | 18 | 18 | 0 | 0 | 0 |
| stage-finalizare.test.mjs | 11 | 11 | 0 | 0 | 0 |
| r-priv-rev.test.mjs | 9 | 9 | 0 | 0 | 0 |
| r-media-holds.test.mjs | 9 | 9 | 0 | 0 | 0 |
| m11-revision-parse.test.mjs | 15 | 15 | 0 | 0 | 0 |
| m10-studio.test.mjs | 3 | 3 | 0 | 0 | 0 |
| Total | 184 | 184 | 0 | 0 | 0 |

The media checks include real local ffmpeg/ffprobe work; claims integration uses migrated temporary databases and real content/QA/delivery services. RC-18 compares the original booking prose and full summary byte for byte. Planner pins were captured before editing. The legacy IR hash was separately computed using the pristine `bedda1d` normalizer. Syntax checks passed for 35 changed JavaScript files and `git diff --check` passed. No timing failure was classified as a product defect.

Excluded from the final offline run:

- `m11-fixture`: FX-02–05 and FX-08–12 start servers or execute fixture tests that do so.
- `m11-ui-logic`: UI-17 launches a browser and temporary HTTP server.
- `stage-finalizare`: FZ-07 launches a browser and temporary HTTP server.
- `r-priv-rev`: RP-07, RP-08 and RP-10 use local servers; RP-10 also launches a browser.
- `r-media-holds`: RM-10 and RM-11 use real browser capture.
- `m10-studio`: ST-01–03, ST-06–12 use the Hub harness, including state-changing git setup; only ST-04, ST-05 and ST-13 were selected.
- The whole repository suite, live Hub, production delivery execution, Office COM and Brave visual QA were not run under the task's restrictions.

**Guardrail incident:** an initial unfiltered UI run completed UI-17 against its temporary local HTTP server using the suite's browser before the mistake was caught. That initial file reported 18 tests / 17 pass / 1 fail / 0 skipped / 0 cancelled. The batch was stopped, the incident disclosed, and browser/server cases were subsequently filtered with the offline preload enabled. FZ-07 was later blocked at `listen` by the preload before opening a server and then excluded. No call to the live Hub at `localhost:8011` was made. No Brave QA is claimed.

## Decisions requiring coordinator review

1. The spec requires both byte-identical original booking summaries and citation suffixes for every shown summary line. The original booking problem and flow keep their exact existing wording without new suffixes; the checker recognizes only the shown, exact booking claims for that exception. Phone/privacy lines receive resolved suffixes.
2. `displayedSha` is optional for API-13 compatibility. When present it must match; callers omitting it retain the previous edit behavior. The current UI already sends it.
3. Schema 12 reviews have no `stale` column. Their status/verdict/problems and change-set association are validated; an explicitly supplied nonzero `stale` is rejected. The acceptance-test reviewer is validated as its test review, without incorrectly requiring the code-review change-set prefix.
4. Legacy templates also need generated vertical overrides, because their stored plans retain old fixture prose. A runtime resolver uses the delivery's own spec for bound legacy plans; it never rewrites stored parameters, template JSON or plan hashes. Curated plans and unrelated Studio operations retain their supplied overrides.
5. `renderSummary` retains its old pure `block` argument for compatibility with existing callers and tests. Delivery runtime exclusively supplies the frozen/generated presentation and proofs.
6. Owner-authored summary sections are exempt from template citation checks. They retain owner provenance, factual notices and `needsReview` on changed bases. The citation checker rejects unexpected `AC-n` references in generated sections; dynamic issue titles and other prose without citations still use the existing generation/fact guards.
7. Generated capture claims bind directly to the selected own capture criterion, even if another own criterion has the same fingerprint. Ambiguity blocks curated resolution; generated identity is established by construction.
8. Capture collapse metadata uses one-based source-step numbers and `REPEATED_FILL` / `REPEATED_LABEL` reasons. Invalid scripts report `collapsed: []`.
9. Proof checks compare both manifest and stored QA counts and require manifest/stored commands to agree, in addition to the method-specific rules. Failed proof details map to `CLAIM_CRITERION_NOT_PASS` in factual QA, with the complete proof retained in enriched evidence.

## Changed files

| File | Purpose |
| --- | --- |
| `v2/server/config.mjs` | Set Hub version and prepend the release summary. |
| `v2/server/media/claims.mjs` | Pure criterion fingerprints, refs, display hashes and evidence proofs. |
| `v2/server/delivery/presentation.mjs` | Validate, resolve, freeze and prove curated/generated presentations. |
| `v2/server/factory/booking-demo-def.mjs` | Pin the original and phone/privacy presentation catalogs. |
| `v2/server/factory/factory.mjs` | Read the delivery's own claim facts and expose additive fingerprints. |
| `v2/server/delivery/template.mjs` | Freeze presentations, derive story text and collapse repeated capture steps. |
| `v2/server/delivery/executors.mjs` | Build proven slot/capture claims and enforce revision delivery status. |
| `v2/server/delivery/clip-ir.mjs` | Bind text items and footage to their separate claim maps. |
| `v2/server/media/ir.mjs` | Validate optional text claim IDs without normalization defaults. |
| `v2/server/media/content.mjs` | Validate criterion/display/method-specific evidence kinds. |
| `v2/server/media/qa.mjs` | Enrich own-bundle proofs and check every claim occurrence with timecodes. |
| `v2/server/media/variants.mjs` | Warn instead of recreating absent claim-bound override targets. |
| `v2/server/delivery/summary.mjs` | Render proven claims, check citations and preserve owner sections. |
| `v2/server/delivery/delivery.mjs` | Integrate own facts, summary checks, atomic claims and descendant lookup. |
| `v2/server/delivery/delivery-commands.mjs` | Accept displayed SHA and reject foreign revision proposals. |
| `v2/server/delivery/office-executors.mjs` | Route executor template reads through the effective-template seam. |
| `v2/server/owner/planners/criteria.mjs` | Make field augmentation idempotent across revision generations. |
| `v2/server/owner/planners/delivery.mjs` | Use effective templates for tone and revision planning. |
| `v2/server/ops/executors.mjs` | Resolve legacy variant overrides at execution without mutating parameters. |
| `v2/server/hub.mjs` | Wire the legacy override resolver to generic media execution. |
| `v2/web/src/lib/deliveryLogic.js` | Share status-aware replacement links across all three UI paths. |
| `v2/tests/r-claims.test.mjs` | Cover fingerprint binding, proofs, freeze, QA and database integration. |
| `v2/tests/m11-template.test.mjs` | Validate the presentation shape and additive output line. |
| `v2/tests/m11-clip-ir.test.mjs` | Check legacy builder behavior and distinct text/footage links. |
| `v2/tests/m11-summary.test.mjs` | Preserve historical summary fixtures and method-correct statuses. |
| `v2/tests/m11-fixture.test.mjs` | Validate resolved fixture prose instead of removed block fields. |
| `v2/tests/m09-media-ir.test.mjs` | Check optional text IDs and the pristine legacy IR hash. |
| `v2/tests/m09-media-qa.test.mjs` | Check independent text occurrences, timecodes and label exclusion. |
| `v2/tests/m09-content.test.mjs` | Exercise new evidence kinds against a real temporary database. |
| `v2/tests/m11-ui-logic.test.mjs` | Validate child status and all replacement-link states. |
| `v2/tests/stage-finalizare.test.mjs` | Check repeated typing collapse across observations and mutations. |
| `v2/tests/r-priv-rev.test.mjs` | Check two-generation field composition and refusal-flow removal. |
| `v2/tests/fixtures/claim-presentations.mjs` | Adapt historical test fixtures to curated presentations. |
| `v2/tests/fixtures/claims-baseline.json` | Preserve pre-edit planner pins, historical prose/spec and old IR hash. |
| `v2/tests/fixtures/s25-spec-a69b8e9f.json` | Store the exact approved reference spec for fingerprint tests. |
| `v2/tests/fixtures/m11-delivery-view.json` | Add only `childStatus` to both view examples. |
| `v2/tests/fixtures/claims-offline-guard.mjs` | Block prohibited test-time network and subprocess operations. |
| `v2/tests/run-claims-offline.mjs` | Run selected test files sequentially and record exact results. |
| `v2/docs/claims-2.14.17.md` | Record the cause, decisions, changed files and verification limits. |

The pre-existing `.tmp-s25-a` directory is preserved; this task's final verification artifacts are in its `part-a-results` subdirectory. No changes were made to `v2/tests/helpers.mjs`, `DecisionInbox.jsx`, migrations or the node_modules junction. No git state-changing command, installation or model invocation was used.

## Part B — explicit presentation correction (2026-10-16)

Implemented on part A `ca8b42e`, branch `claude/project-thread-98qmet`, without committing. Hub version remains 2.14.17-m11, schema 12 and API contract 13. Changes are additive; stored templates, specs, plan bodies, IR versions, claims, approvals and export bytes are not rewritten.

The pure audit resolves the approved specification against the current presentation catalog and checks both IRs, generated summary lines, compiled capture scripts, typing postconditions and capture bytes. A correction is an immutable `delivery_revisions` record and a separate `delivery.correct` owner-confirmed plan. Preparation checks the frozen base again. Execution creates a master patch in the same edit project, renders both formats with factual QA gates, regenerates the summary while retaining owner sections, versions the Office artifacts/index and marks APPLIED only after the finish checks. The effective template supplies corrected text and overrides to subsequent revisions. Failure retains history and moves the delivery to NEEDS_OWNER.

The critic's follow-ups are included: explicit supersession of claim items (content_claims history stays intact), fresh revision metadata from the saved IR, clear-before-type capture semantics, inherited-flow deduplication and overflow refusal, correct fallback reasons and word boundaries, every criterion in traceability, refusal of defective summary approval, Hub attribution/cockpit correction row, STALE history observation and current-delivery link, curated spoken delivery copy, and event-guarded re-offers. The unrelated package-plan binding defect is recorded in `.ifrim/OPEN_ISSUES.md`.

### Part B verification

Run from the repository using the system Node:

```powershell
& 'C:\Program Files\nodejs\node.exe' v2/tests/run-correction-offline.mjs
```

The runner invokes one file at a time with `--test --test-concurrency=1 --test-reporter=tap`. Each invocation, name filter, counts and TAP output are recorded in `.tmp-s25-a/part-b-results/`. All ordinary regression files use the offline preload. Only `r-correct` uses the loopback-only preload for the specification's explicit RCO-04 exception; port 8011 and external destinations are refused. Filters exclude prohibited harness/server/browser cases; excluded cases do not count as Node skips.

| File in `v2/tests/` | Tests | Pass | Fail | Skipped | Cancelled |
| --- | ---: | ---: | ---: | ---: | ---: |
| r-correct.test.mjs | 11 | 11 | 0 | 0 | 0 |
| r-claims.test.mjs | 19 | 19 | 0 | 0 | 0 |
| m11-template.test.mjs | 16 | 16 | 0 | 0 | 0 |
| m11-clip-ir.test.mjs | 14 | 14 | 0 | 0 | 0 |
| m11-summary.test.mjs | 7 | 7 | 0 | 0 | 0 |
| m11-revision-parse.test.mjs | 15 | 15 | 0 | 0 | 0 |
| m11-stale-graph.test.mjs | 12 | 12 | 0 | 0 | 0 |
| m09-media-ir.test.mjs | 27 | 27 | 0 | 0 | 0 |
| m09-media-qa.test.mjs | 19 | 19 | 0 | 0 | 0 |
| m09-content.test.mjs | 11 | 11 | 0 | 0 | 0 |
| m11-ui-logic.test.mjs | 18 | 18 | 0 | 0 | 0 |
| stage-finalizare.test.mjs | 11 | 11 | 0 | 0 | 0 |
| r-priv-rev.test.mjs | 11 | 11 | 0 | 0 | 0 |
| r-media-holds.test.mjs | 9 | 9 | 0 | 0 | 0 |
| m11-fixture.test.mjs | 6 | 6 | 0 | 0 | 0 |
| stage-office-delivery.test.mjs | 5 | 5 | 0 | 0 | 0 |
| r-closure.test.mjs | 15 | 15 | 0 | 0 | 0 |
| m09-media-capture.test.mjs | 4 | 4 | 0 | 0 | 0 |
| Total | 230 | 230 | 0 | 0 | 0 |

RCO-04 actually ran with installed Chromium and real ffmpeg/ffprobe. Its temporary SQLite Hub services use synthetic approved facts and a temporary loopback demo page, with no HTTP Hub or providers. It confirms through the test owner session and exercises actual capture/render/export twice: first recapture, then byte-identical capture reuse without a new capture session. Assertions cover one phone value submitted per capture, same-project parent links, unchanged v1 bytes/approval/software hashes, factual PASS for both formats and summary, owner-section review reasons, NEEDS_OWNER recovery, versioned Office output, workbook byte proof, newest-manifest verification, and zero agent_runs/factory_dispatches. Office verification in this harness is FILE_CHECKED, not APP_VERIFIED.

RCO-06 applies a real subsequent tone patch and verifies the Room metadata from its saved IR. RCO-10 tests factual export refusal for either format in package/revision/correction contexts. RCO-11 proves identical Office bytes cause no write authorization or COM call, exposes old clip references, and refuses a foreign bundle. RCO-08 runs the manual dry-run against synthetic data and checks that database rows/export bytes stay unchanged. UI verification includes static rendering of correction notices, button availability, disabled approvals, Hub attribution, summary history/review reasons and the historical-delivery link. Twenty-seven changed JS/MJS files passed `node --check`; JSX was compiled/rendered by the UI suite. `git diff --check` passed.

Earlier runs exposed stale test expectations and one implementation defect: `media.reviews.apply()` returns version metadata without IR, so revision metadata must load the saved version through `media.edits.getVersion()`. These were fixed and the affected tests rerun. No timing failure was classified as a product defect.

Not run:

- `m11-ui-logic` UI-17; `stage-finalizare` FZ-07; `r-media-holds` RM-10–11; `r-priv-rev` RP-07/08/10; `m11-fixture` FX-02–05/08–12: server/browser cases outside the explicit RCO-04 exception.
- `m09-media-capture` CP-02–06/10–11: socket/server/browser harness cases; CP-05 is also omitted by the conservative selection, although its early policy refusal needs no connection.
- `stage-office-delivery` OFF-06 and `r-closure` HIST-01, FAC-01–07, REV-05: integration harnesses with forbidden git setup, runner/model simulation and/or server/browser activity. The pure/planner, rollback and package-index cases were selected instead.
- Live Hub calls, live-data inspection or correction, copied production-data dry-run, external network, providers/models, npm installation, migration changes, full repository suite, Word/Excel COM/PDF application verification and Brave visual QA. Chromium was used only for the explicitly requested RCO-04 test. No Brave QA is claimed.

### Part B implementation decisions

1. New records always use `1 + earlier record count`; an unchanged live card reuses its record/hash. To reconcile that rule with the critic's expired/superseded re-offer rule, tick compares the same frozen work while ignoring only the correction ordinal and its derived Office/index filename lines, then consults proposal events for those records' actual hashes and HUB_VERSION. A re-offer on a new Hub version creates a new ordinal; cancellation suppresses automatic offers until the owner explicitly asks again.
2. Capture bases additionally record `observedSha256`. A missing/corrupt capture can be corrected, but a change to those observed bytes after confirmation refuses preparation. Comparing only the expected recorded SHA would make provenance defects impossible to repair safely.
3. Clip filenames retain the existing generation/export-count rule; summary filenames use their own document version; Office/index filenames use correction version + 1. Failed attempts may leave gaps. Identical existing bytes may be reused, and the existing no-overwrite writer chooses an alternate filename on a collision.
4. The newest manifest lists all older indexes and the new README, but excludes itself because a file cannot contain its own full SHA256. Producers are linked by delivery item, document version, or plan/step. Superseded files retain bytes and link to the replacing correction plan/hash.
5. Campaign per-file hashes are additive `fileProofs: [{path, sha256}]`; the previous `files` string array remains for contract-13 clients. Office result hashes/input hashes/clip hashes and manifest file/hash are additive too. Legacy results without per-file/PDF proof are rebuilt when an identical-byte proof cannot be established.
6. While a correction is available, the Room conservatively disables both creative approvals and summary approval until the correction completes. The Studio creative-decision path remains unchanged, as specified. Owner-authored summary sections remain exempt from generated-prose checks and retain review notices.
7. The no-network guardrail takes precedence over the dry-run specification's health probe: any recorded port is refused without connecting, including a stale port. The operator can remove the stale pid file from a stopped COPY. The tool refuses live pids and lexical/resolved live-root paths, opens SQLite read-only, constrains capture paths to the copy, and writes a new output only inside this workspace and outside the copied export destination.
8. Dry-run plan hashes use the explicit placeholder revision ID `drv_dry_run`; the correctionSha and compilation are the real functions, but a later persisted plan has its real revision ID and therefore a different body hash. Dry-run is an audit/compiler, not runtime snapshot/tool verification or permission to execute.
9. Integration testing seeds approved spec/evidence/bundle facts in a temporary Hub and stubs snapshot/preview supervision. It tests real correction/media/Office file execution without running a software factory, git setup, writer or model. Office COM/PDF checks remain unverified in this task.

### Part B changed files

| File | Purpose |
| --- | --- |
| `v2/server/delivery/correction.mjs` | Pure audit, frozen correction record, overlays, IR metadata and deterministic steps. |
| `v2/server/delivery/delivery.mjs` | Proposal/base guards, tick/re-offers, lifecycle, effective templates, summary/history and Office views. |
| `v2/server/delivery/executors.mjs` | Prepare/execute correction, same-project patch, fresh revision metadata and factual export gates. |
| `v2/server/delivery/office-executors.mjs` | Own-bundle guards, byte-proven reuse, versioned Office/index files and latest-manifest verification. |
| `v2/server/delivery/summary.mjs` | Exact generated-line checks, honest fallback copy and complete traceability. |
| `v2/server/delivery/clip-ir.mjs` | Use CLAIM_UNBOUND for omitted unbound slots. |
| `v2/server/delivery/stale.mjs` | Permit guarded correction recovery from NEEDS_OWNER. |
| `v2/server/delivery/delivery-commands.mjs` | Owner-session correction proposal command. |
| `v2/server/delivery/delivery-routes.mjs` | Add the correction-propose route mapping. |
| `v2/server/delivery/inbox.mjs` | Show one Hub correction row in the cockpit. |
| `v2/server/media/capture.mjs` | Clear the field before animated typing. |
| `v2/server/media/edits.mjs` | Validate and insert a patch under the existing edit project/parent. |
| `v2/server/media/qa.mjs` | Match factual vocabulary as whole words. |
| `v2/server/ops/plans.mjs` | Supersede a delivery's obsolete correction without changing confirmation. |
| `v2/server/owner/planners/criteria.mjs` | Collapse inherited duplicate field pairs and clauses. |
| `v2/server/owner/planners/engineering.mjs` | Keep all inherited flows and refuse criterion overflow. |
| `v2/server/owner/planners/delivery.mjs` | Use the proven effective hook in spoken/cockpit copy. |
| `v2/web/src/lib/deliveryLogic.js` | Correction command/labels, source attribution, review reasons and historical link. |
| `v2/web/src/screens/DeliveryRoom.jsx` | Correction notice, defects and owner proposal/retry button. |
| `v2/web/src/screens/delivery/ClipPanel.jsx` | Separate Hub corrections from owner requests. |
| `v2/web/src/screens/delivery/DecisionsPanel.jsx` | Disable defective-presentation approvals with a reason. |
| `v2/web/src/screens/delivery/SummaryEditor.jsx` | Show correction provenance, review reasons and version approvals. |
| `v2/web/src/screens/delivery/ObservationsPanel.jsx` | Link historical citation defects to the current delivery. |
| `v2/tests/r-correct.test.mjs` | Eleven audit, authority, execution, recovery, provenance and Office regression cases. |
| `v2/tests/correction-helpers.mjs` | Isolated synthetic Hub services with no provider or shared helper changes. |
| `v2/tests/manual/correction-dry-run.mjs` | Read-only audit/plan compiler for a stopped data copy. |
| `v2/tests/fixtures/correction-local-guard.mjs` | Restrict the permitted integration test to loopback, excluding the live port. |
| `v2/tests/run-correction-offline.mjs` | Sequential system-Node verification with saved exact counts/filters. |
| `v2/tests/m11-ui-logic.test.mjs` | Additive contract and static-render correction UI coverage. |
| `v2/tests/fixtures/m11-delivery-view.json` | Add correction, revision source and summary-version fixture fields. |
| `v2/tests/r-claims.test.mjs` | Expect separate citation and curation findings. |
| `v2/tests/r-closure.test.mjs` | Supply the existing effective-template hook in the package stub. |
| `v2/tests/r-priv-rev.test.mjs` | Cover doubled inherited flows and criterion overflow refusal. |
| `.ifrim/OPEN_ISSUES.md` | Record the explicitly out-of-scope package-plan binding issue. |
| `v2/docs/claims-2.14.17.md` | Preserve part A and append part B verification and decisions. |

No changes to `v2/tests/helpers.mjs`, `DecisionInbox.jsx`, migrations or the node_modules junction. No state-changing git command, commit, model invocation or live-data access was used for part B. Temporary scripts/logs stay under the pre-existing `.tmp-s25-a/` workspace directory.

## Round C — review fixes (2026-10-16)

Implemented on parts A/B (`ca8b42e`, `bb8b6c6`) on `claude/project-thread-98qmet`, without committing. Hub version remains 2.14.17-m11, schema 12 and API contract 13. Stored template JSON/hashes, plan bodies, specs, bundles and edit IRs are not rewritten. **This round supersedes part A decision 4:** execution no longer substitutes legacy overrides after confirmation.

| Spec C item | Change | Regression proof |
| --- | --- | --- |
| 1 — hashed execution authority | Removed `variantOverridesFor` and its executor/Hub wiring. `media.variant.render` passes the supplied hashed overrides unchanged. `effectiveTemplate` derives a legacy generated presentation from the delivery's own `claimFacts`, plus story texts, overrides and their SHA. Revision, correction and re-package proposal paths use the effective template; correction records retain precedence. Descriptions read frozen export paths without needing a bundle. Legacy ARMED activation still compares/adopts the stored package body. | `r-claims-review`: RCC-01 uses real command proposals and the real variant service to check card params and stored variant text; RCC-03 checks correction precedence; RCC-04 activates an ARMED legacy delivery without resolving presentation facts and checks the original body/overrides. `r-claims`: RC-17 checks own-bundle legacy derivation and unchanged stored JSON/body hash; RC-19 checks exact parameter execution. |
| 2 — legacy tone classification | The existing revision planner's effective-template lookup now supplies generated legacy texts instead of old fixture prose. | `r-claims-review`: RCC-02 invokes the real registered planner, checks the proposed text operations against generated business texts, checks the card overrides and verifies unchanged stored hashes. |
| 3 — factual QA compatibility | `TEXT_CLAIM_MISSING` remains an error for explicit `AC-n` citations and delivery-authored factual vocabulary. Vocabulary alone is a warning for other IRs. `QA_VERSION` is now 2. Explicit citations are checked even in disclosure-styled/prefixed text; ordinary disclosure labels retain their exemption. | `r-claims-review`: RCC-05 covers absent author, Studio author and delivery author; testat/verificat/PASS/E2E/revizuit; plain, label-styled and disclosure-prefixed citations; severity, report status/version, item ranges and unchanged IR hashes. |
| 4 — actual vertical override coverage | Extended RC-08 with `deriveVariant` using the presentation's real hook/CTA overrides. | `r-claims`: RC-08 proves the hook text actually changed, accepts its vertical display SHA, then reports `CLAIM_TEXT_UNBOUND` with hook claim/item/time range when that evidence is removed or the override text changes. |
| 5 — empty test-run failure | The claims runner returns failure for zero tests, any missing summary count (`-1`), nonzero child exit, failures or cancellations. CLI propagates the aggregate exit code; the new review suite is in its default selection. | `r-claims-review`: RCC-06 injects process results through the same runner used by the CLI, checking zero/absent/partial summaries, ordinary success/failure, saved missing counts and a bad file followed by a good file. |

### Round C verification

All files ran separately using `C:\Program Files\nodejs\node.exe --test --test-concurrency=1 --test-reporter=tap`, with `claims-offline-guard.mjs` preloaded. No loopback exception was used. The sequential command and exact per-file arguments/counts/TAP logs are saved in `.tmp-s25-a/round-c-run.mjs` and `.tmp-s25-a/round-c-results/`. The new suite also passed an initial standalone run (6/6). After extending explicit-citation coverage to disclosure text, the review, claims, clip-IR and media-QA files were rerun individually in sequence.

Final results (name-filtered cases are excluded, not counted as Node skips):

| File in `v2/tests/` | Tests | Pass | Fail | Skipped | Cancelled |
| --- | ---: | ---: | ---: | ---: | ---: |
| r-claims-review.test.mjs | 6 | 6 | 0 | 0 | 0 |
| r-claims.test.mjs | 19 | 19 | 0 | 0 | 0 |
| m11-template.test.mjs | 16 | 16 | 0 | 0 | 0 |
| m11-clip-ir.test.mjs | 14 | 14 | 0 | 0 | 0 |
| m11-summary.test.mjs | 7 | 7 | 0 | 0 | 0 |
| m09-media-ir.test.mjs | 27 | 27 | 0 | 0 | 0 |
| m09-media-qa.test.mjs | 19 | 19 | 0 | 0 | 0 |
| m09-content.test.mjs | 11 | 11 | 0 | 0 | 0 |
| m11-revision-parse.test.mjs | 15 | 15 | 0 | 0 | 0 |
| m10-studio.test.mjs | 3 | 3 | 0 | 0 | 0 |
| r-correct.test.mjs | 10 | 10 | 0 | 0 | 0 |
| r-closure.test.mjs | 15 | 15 | 0 | 0 | 0 |
| stage-office-delivery.test.mjs | 5 | 5 | 0 | 0 | 0 |
| Total | 167 | 167 | 0 | 0 | 0 |

No test failure or timing failure occurred. The media-QA suite includes real local ffmpeg/ffprobe checks. The new authority test uses real SQLite services, ops-plan compilation and variant derivation, with render/QA responses stubbed; it does not claim end-to-end rendering or capture coverage. Existing planner and legacy IR hash pins passed. All 12 changed/new JavaScript files passed `node --check`; `git diff --check` passed.

Not run:

- `r-correct` RCO-04: starts a server and browser; round C prohibits network and does not authorize the earlier Chromium exception. All other RCO cases ran with the strict offline guard. RCO-08 rejects the forbidden live-root strings lexically before any filesystem access.
- `m10-studio` except ST-04/05/13; `r-closure` except PACK, REV-01/02/03, ROLL and SUP; `stage-office-delivery` OFF-06: excluded Hub/git/server/model harnesses. Exact name filters are in the saved invocation JSON.
- Whole repository suite, live Hub/port 8011, production data or execution, network, models, browser/Brave visual QA, Word/Excel COM and PDF application verification. No UI change required visual QA. Unrelated suites from earlier rounds were not repeated.

### Round C implementation decisions

1. Step descriptions read only the stored export destination, which corrections do not change. Runtime delivery/Office execution still uses `effectiveTemplate`. This keeps descriptions independent of claim facts before an ARMED delivery binds its bundle, and preserves confirmed package body hashes.
2. “Citation anywhere” includes disclosure-styled/prefixed text containing an explicit `AC-n`. Disclosure text without citations keeps the previous exemption; the new warning behavior does not add defaults to old IRs or rewrite old reports.
3. The runner also rejects an incomplete TAP summary and reported failures/cancellations even if a subprocess incorrectly returns zero. Its injectable process runner supports deterministic regression tests without launching fake servers or browsers.
4. The existing re-package plan-binding issue recorded in part B remains outside this review: the re-package regression proves generated card parameters, not successful package execution. No new authority or binding behavior was added.

### Round C changed files

| File | Purpose |
| --- | --- |
| `v2/server/delivery/delivery.mjs` | Generate the derived legacy effective template; remove runtime override resolution. |
| `v2/server/delivery/delivery-commands.mjs` | Build re-package steps from the effective template. |
| `v2/server/owner/planners/delivery.mjs` | Build delivery-only package proposals from the effective template. |
| `v2/server/ops/executors.mjs` | Execute the supplied variant overrides exactly. |
| `v2/server/hub.mjs` | Remove the obsolete override callback wiring. |
| `v2/server/delivery/executors.mjs` | Describe exports from frozen paths without resolving legacy facts. |
| `v2/server/delivery/office-executors.mjs` | Preserve the same frozen-path description behavior for Office steps. |
| `v2/server/media/qa.mjs` | Version 2 factual QA with author-sensitive vocabulary severity and universal explicit citations. |
| `v2/tests/correction-helpers.mjs` | Remove the obsolete executor callback from the isolated harness. |
| `v2/tests/r-claims.test.mjs` | Real vertical-override evidence tests and corrected legacy authority expectations. |
| `v2/tests/r-claims-review.test.mjs` | Six round C regressions for all review findings and activation compatibility. |
| `v2/tests/run-claims-offline.mjs` | Fail empty/incomplete runs; expose a testable sequential runner and select the review suite. |
| `v2/docs/claims-2.14.17.md` | Record round C changes, evidence, limitations and decisions. |

No edits to `v2/tests/helpers.mjs`, `DecisionInbox.jsx`, migrations, the node_modules junction or files outside the repository. No credential-folder read, model invocation, installation, live-data access or git state-changing command was used. No commit was created.
