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

## Round D — review-B fixes (2026-10-16)

Implemented on `c190a88`, branch `claude/project-thread-98qmet`, without committing. Hub version remains 2.14.17-m11, schema 12, API contract 13 additive. Existing stored templates, plan bodies, specs, bundles and edit IRs are not rewritten. This round supersedes the part B decisions about counting orphan correction records and suppressing all expired/superseded re-offers.

| Spec D item | Change | Regression proof |
| --- | --- | --- |
| 1 — recovery after summary | A started FAILED/CANCELLED correction keeps the Room recovery action available even with no audit defects. A new continuation freezes the current item/document references and runs prepare, Office rebuild-or-keep checks, index and finish. It restores READY. Pending continuations are idempotent; another late failure can also be retried. | `r-correct` RCO-04 injects a campaign failure after the real summary and Office document, checks zero defects and the recovery reason, confirms the new card, proves the completed document is kept by byte proof and reaches READY. `r-correct-review` RCD-01 proves tick offers the zero-defect continuation, pending idempotence, repeated late failure and successful confirmation. `m11-ui-logic` M11-UI-16 renders the reason and retry button with zero defects. |
| 2 — cancellation before execution | An unstarted cancelled/declined card marks its revision CANCELLED while keeping READY. Started plans move to NEEDS_OWNER. Automatic proposals remain suppressed after owner cancellation; an explicit owner request can propose again. | RCD-02 covers PROPOSED and CONFIRMED cards whose steps were all PENDING, cancellation after a step started, tick after the throttle window, and the owner's retry. |
| 3 — delivery scope and re-offer | `opsPlans.propose` scopes correction supersession by step `params.deliveryId`. The automatic re-offer guard reads actual plan status and permits one replacement after EXPIRED/SUPERSEDED on the current Hub version. | RCD-03 seeds two defective READY deliveries, runs tick, checks both cards remain PROPOSED, checks one replacement for each terminal state and no replacement loop, and checks direct same-delivery supersession preserves the other card. RCO-09 checks same-version expiry re-offer. |
| 4 — preserve active plans | CONFIRMED/RUNNING/PAUSED corrections return their existing plan before auditing changed facts. The ops supersede helper also refuses to stop or supersede those plans. Only PROPOSED cards can be replaced. | RCD-04 checks CONFIRMED/PAUSED states and holds an actual running executor while changing current facts and proposing again. The running plan and revision remain unchanged. |
| 5 — failed proposals | A proposal exception cancels the orphan revision; revisions without a plan are hidden from the Room correction history and excluded from the correction ordinal. | RCD-05 injects a propose failure, checks CANCELLED/no plan/no Room row, restores proposal and checks its version is 1. |
| 6 — base guards during execution | Edit build, export and finish re-check the frozen master, vertical, summary and capture references. New references are accepted only when bound by this plan; capture file bytes are checked too. Refusal is `CORRECTION_BASE_CHANGED` before writes. | RCD-06 covers each of the three executors against changed master, vertical, summary and capture refs (12 refusal combinations), and accepts this plan's new binding while refusing a foreign plan. RCO-04 exercises the successful real execution with new capture/edit/variant/summary bindings. |
| 7 — accumulated capture history | Effective templates fold every APPLIED correction in row order, then the current plan's record. New records also freeze effective capture scripts for reused roles, preserving a failed plan's successful recapture through recovery. | RCD-07 folds two APPLIED records and a third plan overlay, including a legacy reuse record without copied steps, and checks unchanged stored template JSON/hash. RCO-04 checks the first recapture's steps and stepsSha survive a later correction and its continuation. |
| 8 — audit counts/order | Defects are deduplicated by code, location, item and text with the leading bullet removed. Clip/capture findings precede summary findings. The Room receives the complete deduplicated list and additive `defectCount`. | RCD-08 checks bullet/plain duplicates, distinct keys, ordering and equality between audit, correction record and Room counts. RCD-13 checks dry-run deduplication. |
| 9 — proposal scan | Tick uses an in-memory per-delivery ten-minute throttle. Correction checks use the read-only snapshot comparison, never `verify()`. The old periodic verification write was removed from this path. | RCD-09 counts snapshot scans at 0, 599999 and 600000 ms and on a second delivery; `updated_at` and `verified_json` remain byte-identical. |
| 10 — claim lineage | Same-role claims remain CURRENT until `bindItem` supersedes them, preserving `supersedes_id`. Only roles omitted from the replacement set are explicitly retired, with a reason and timestamp. | RCD-10 checks the replacement's lineage link and the absent role's SUPERSEDED status/reason. RC-17 retains atomic claim replacement coverage. |
| 11 — capture typing | The recorder clears only a nonempty fillable input, textarea or contenteditable before animated typing. Empty and custom/non-fillable targets skip the clear. | `m09-media-capture` M09-CP-12 checks nonempty/empty inputs, textareas, contenteditable elements, a custom div and a button input. RCO-04 still checks exactly one phone value per real capture. |
| 12 — RP-13 isolation | RP-13 uses `fs.mkdtempSync(path.join(os.tmpdir(), ...))` with registered cleanup. The verification runner points TEMP/TMP inside this workspace to respect the edit boundary. | `r-priv-rev` RP-13 asserts the temp parent, executes both inherited-flow cases and asserts removal after cleanup. |
| 13 — readable cards and dry-run | Each changed slot has one line for the actual selected tone/vertical override, plus the other tone only when different. Unchanged CTA text is omitted. Summary changes are computed with the real renderer/regenerator in memory, retain owner text, and list only changed sections with reasons. Dry-run includes ordered `summaryPreview` sections and deduplicated defects. | RCD-13 checks both/business/technical tones in both formats, alternate-tone annotations, unchanged CTA omission, changed-section/output equality, all requested summary sections, video placeholder, no DB writes, and changed preview/omitted hook when current evidence becomes stale. RCO-08 retains read-only dry-run/file checks. |

### Round D verification

Each file ran separately with `C:\Program Files\nodejs\node.exe --test --test-concurrency=1 --test-reporter=tap`. Exact command arguments, filters, counts and TAP output are in `.tmp-s25-a/round-d-run.mjs` and `.tmp-s25-a/round-d-results/`. All tests except `r-correct` used the strict `claims-offline-guard.mjs`; `r-correct` used `correction-local-guard.mjs` for the explicitly requested RCO-04 loopback/Chromium exception. No external network, live Hub or port 8011 was contacted.

Final selected results (name-filtered exclusions are not Node skips):

| File in `v2/tests/` | Tests | Pass | Fail | Skipped | Cancelled |
| --- | ---: | ---: | ---: | ---: | ---: |
| r-correct.test.mjs | 11 | 11 | 0 | 0 | 0 |
| r-correct-review.test.mjs | 11 | 11 | 0 | 0 | 0 |
| r-claims.test.mjs | 19 | 19 | 0 | 0 | 0 |
| r-claims-review.test.mjs | 6 | 6 | 0 | 0 | 0 |
| r-closure.test.mjs | 15 | 15 | 0 | 0 | 0 |
| r-priv-rev.test.mjs | 11 | 11 | 0 | 0 | 0 |
| m09-media-capture.test.mjs | 5 | 5 | 0 | 0 | 0 |
| m11-stale-graph.test.mjs | 12 | 12 | 0 | 0 | 0 |
| m11-ui-logic.test.mjs | 18 | 18 | 0 | 0 | 0 |
| stage-office-delivery.test.mjs | 5 | 5 | 0 | 0 | 0 |
| m11-template.test.mjs | 16 | 16 | 0 | 0 | 0 |
| m11-clip-ir.test.mjs | 14 | 14 | 0 | 0 | 0 |
| m11-summary.test.mjs | 7 | 7 | 0 | 0 | 0 |
| Total | 150 | 150 | 0 | 0 | 0 |

RCO-04 ran real installed Chromium and ffmpeg/ffprobe, with synthetic approved bundle facts, a temporary demo page and no Hub HTTP server/provider/model. It exercised recapture, reuse, rendering, exports, summary, Office generation, a late failure and recovery. Office checks were FILE_CHECKED, not Word/Excel COM verification. RCD-01 uses synthetic render/QA slots to test tick and repeat recovery separately; it does not claim real rendering. Existing planner/legacy hash pins pass. Thirteen changed/new JavaScript modules passed `node --check`; the UI suite compiled and rendered the JSX change. `git diff --check` passed.

Initial verification found RC-07's delivery test double lacked `revisionOfPlan`, now consulted by the executor's correction guard; the double was updated and all 19 claims tests passed on rerun. CP-05 was attempted under the strict guard, which rejected its fake-OBS `listen()` before a server started. It was then excluded and the five permitted capture cases passed. Initial TAP failures are retained separately. No timing failure was classified as a product defect.

Not run:

- `m09-media-capture` CP-02–06/10–11: socket/server/browser harnesses outside RCO-04's exception. CP-05 was guard-blocked as described above; its body did not execute successfully.
- `m11-ui-logic` UI-17 and `r-priv-rev` RP-07/08/10: server/browser integration harnesses outside that exception.
- `r-closure` HIST-01, FAC-01–07, REV-05 and `stage-office-delivery` OFF-06: broader Hub/git/server/runner/model harnesses. The selected package, revision, rollback, supersession and Office cases ran.
- `m10-ops-plans`: RCD-03/04 exercise the real ops-plan proposal/supersession service in the isolated correction harness instead, as allowed by the spec's alternative suite clause.
- Full repository suite, live Hub/data, production-copy dry-run, external network, models, npm installation, Word/Excel COM/PDF application verification and Brave visual QA. Chromium was used only for the explicitly requested RCO-04; no Brave QA is claimed.

### Round D implementation decisions

1. A new continuation record is additive and freezes the current base. Office steps are rechecked even if already DONE in the failed plan, so only identical rebuilt bytes are kept. A pending continuation and a continuation that itself fails retain this mode. Existing records/hashes are unchanged.
2. `opsPlans.cancel()` marks untouched steps CANCELLED as well as stopping running ones. Start detection therefore uses the existing attempt/start fields for CANCELLED steps; otherwise cancelling an untouched card would still look started. Cancelled correction history continues to suppress Hub proposals for that delivery; the owner can explicitly request another card.
3. One automatic replacement is allowed after EXPIRED/SUPERSEDED per equivalent correction work and Hub version. The event's additive `reoffer` flag prevents repeated expiry loops; the comparison continues to ignore only correction ordinal/derived Office filenames. The ten-minute scan cache is process-local and resets on restart; explicit owner requests bypass it.
4. `summaryPreview` is an ordered section array, including preserved owner sections. Prospective media is represented by `(după randare)` when rendering is planned; continuations retain current media text because they do not render it again. Comparison reuses the current summary's generation timestamp to avoid a clock-only provenance difference. Runtime generation still records its real time. Unchanged owner text is omitted from the card's change list; execution still adds its review notice where required.
5. The requested real Chromium/ffmpeg RCO-04 is treated as the narrow loopback/browser exception to the offline rule. Other network/browser tests remain excluded. The UI change was checked through compilation and static rendering, without substituting Chromium for Brave visual QA.

No edits to `v2/tests/helpers.mjs`, `DecisionInbox.jsx`, migrations, the node_modules junction or files outside the repository. No credential-folder read, model invocation, installation, live-data access or git state-changing command was used. No commit was created.

## Round E — summary wording polish (2026-10-16)

Implemented on `112764c`, branch `claude/project-thread-98qmet`, without committing. Version remains 2.14.17-m11, schema 12, API contract 13 additive. Stored documents, templates, correction records, plan bodies, specs, bundles and edit IRs are not rewritten.

| Spec E item | Change | Regression proof |
| --- | --- | --- |
| 1 — problem is a requirement | The curated problem ends with `(criteriile: <resolved ids>)`. The fact checker accepts only that text and suffix; it refuses verified/evidence suffixes, different text, foreign ids and reordered ids. Booking keeps its unsuffixed problem. | `r-claims` RCE-01 checks normal and renumbered specs, all rejected forms, missing evidence and booking compatibility. RC-18 pins the entire booking summary to the pre-E renderer. |
| 2 — one flow citation | Curated flow bullets contain the exact uncited claim lines, followed by one `Flux verificat: <resolved ids>.` line. The fact checker accepts exact lines and the closing citation only for the shown flow claim. Booking keeps its previous output. | `r-claims` RCE-02 checks exact output, renumbering, rejected per-line citations/foreign prose/wrong closing ids or punctuation, missing proof and booking compatibility; RC-18 covers the full booking summary. |
| 3 — whole-word truncation | Provenance, passed-criterion fallbacks (including the legacy block path), failed-criterion prose and claims-to-verify use the same word-boundary truncator. | `m11-summary` RCE-03 covers long passed/failed texts, generated/legacy paths, provenance, whitespace, an exact-boundary word and an oversized single token. |
| 4 — distinct affected texts | Room defects group by `where + itemId + text` after removing a leading `- `. Each text appears once with every reason in additive `reasons` and in its Romanian `plain` text. `defectCount` is the grouped length. The correction inbox card consumes those same rows. | `r-correct-review` RCE-04 checks grouping keys, bullet normalization, both codes/reasons, one occurrence, Room count, actual inbox-card effects and unchanged audit input. RCD-08 retains audit ordering coverage. `m11-ui-logic` UI-16 statically renders one problem with both reasons. |
| 5 — dry-run generation time | Only the returned dry-run provenance preview replaces `Generat <time>` with `Generat (la rulare)`. | `r-correct-review` RCE-05 checks the exact placeholder, unchanged persisted v1 rows and unchanged correction hash/output comparison. RCD-13 still checks the rest of the preview and section-change output. |

### Round E verification

Each file ran separately and sequentially with `C:\Program Files\nodejs\node.exe --test --test-concurrency=1 --test-reporter=tap`, preloading `claims-offline-guard.mjs`. TEMP/TMP point inside the workspace. Commands, exact name filters, counts and TAP logs are in `.tmp-s25-a/round-e-run.mjs` and `.tmp-s25-a/round-e-results/`.

| File in `v2/tests/` | Tests | Pass | Fail | Skipped | Cancelled | Todo |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| r-claims.test.mjs | 21 | 21 | 0 | 0 | 0 | 0 |
| r-claims-review.test.mjs | 6 | 6 | 0 | 0 | 0 | 0 |
| r-correct.test.mjs | 10 | 10 | 0 | 0 | 0 | 0 |
| r-correct-review.test.mjs | 13 | 13 | 0 | 0 | 0 | 0 |
| m11-summary.test.mjs | 8 | 8 | 0 | 0 | 0 | 0 |
| m11-ui-logic.test.mjs | 18 | 18 | 0 | 0 | 0 | 0 |
| Total selected | 76 | 76 | 0 | 0 | 0 | 0 |

Name-filtered exclusions are not counted as Node skips. The eight changed JavaScript modules passed `node --check`; `git diff --check` passed. UI verification compiled the actual components and rendered static markup; no browser was launched.

The booking renderer was also compared directly with source read from commit `112764c` for identical inputs: full output is byte-identical, with content SHA `7c6d1b429b7959baadcdf37b349e62830f91035f89cf096d9b364147b3c781d0`. This value is now pinned in RC-18; the comparison script/result are `.tmp-s25-a/round-e-compat.mjs` and `round-e-results/booking-compat.json`. Existing first-generation planner and legacy-template hash assertions pass.

Two test-setup mistakes were corrected during verification: the new inbox test initially passed `source` instead of the proposal API's `actor`, and the standalone booking-pin setup initially omitted proof fingerprints, producing a hash for omitted claims. After fixing those setups, correction-review passed 13/13 and claims passed 21/21. Initial failing TAP files are retained. No timing failure occurred.

Not run:

- RCO-04: the user explicitly requested it but also prohibited all network. This test starts a temporary loopback HTTP server and browser. A narrow loopback exception using Brave was requested; no approval was received during this round. The earlier round D Chromium exception was not assumed to override the current guardrails/browser preference. The other ten RCO tests passed.
- M11-UI-17: browser/loopback integration, excluded under the strict offline rule. Brave's executable exists, but no Brave visual QA is claimed.
- Full repository suite, live Hub/port 8011, live-data access, production-copy dry-run, network, models, npm install, media recapture/rendering, Word/Excel COM and PDF application verification. These were outside the permitted offline scope; the dry-run regression used a synthetic temporary database.

### Round E implementation decisions

1. Grouping is a read-only owner-facing projection. Raw audit findings and correction-record defects retain their existing per-code shape; grouped Room rows retain the first `code` for compatibility and add all `reasons`. This preserves existing audit consumers and stored correction hashes while fixing Room/card counts and wording.
2. The new flow closing citation is a separate unbulleted line immediately after the flow bullets. Demonstration/benefit citation rules and owner-authored section exemptions remain unchanged.
3. Whitespace is normalized before criterion truncation. If the first token alone exceeds the length budget, it is omitted and only `…` remains; no token is split. Criterion ids/status/verification labels remain visible outside the shortened text.
4. The dry-run placeholder is applied after correction-plan comparison, only to returned preview sections. Comparison retains the previous generation timestamp to avoid a timestamp-only change; real execution still records the actual generation time.

Changed implementation files: `server/delivery/summary.mjs` (wording, matching, truncation), `server/delivery/correction.mjs` (owner-facing grouping), `server/delivery/delivery.mjs` (grouped Room projection), and `tests/manual/correction-dry-run.mjs` (preview timestamp). Regression changes are in `r-claims`, `r-correct-review`, `m11-summary` and `m11-ui-logic`.

No edits to `v2/tests/helpers.mjs`, `DecisionInbox.jsx`, migrations, the node_modules junction or files outside the repository. No credential-folder read, model invocation, network request, installation, live-data access or git state-changing command was used. No commit was created.

## Round F — final review fixes (2026-10-16)

Implemented on `2d52350`, branch `claude/project-thread-98qmet`, without committing. Version remains 2.14.17-m11, schema 12 and API contract 13. Existing stored template/IR/spec/bundle/plan/correction hashes are not rewritten.

| Spec F item | Change | Regression proof |
| --- | --- | --- |
| 1 — ended continuations | A NEEDS_OWNER delivery's latest non-APPLIED correction remains unfinished if its plan started or its revision is a continuation, regardless of the card's terminal state. Existing cancellation and once-per-version reoffer rules remain in force. | `r-correct-review` RCF-01 has three cases: EXPIRED and SUPERSEDED receive one automatic replacement; unstarted CANCELLED receives none. In all three the owner can request a new continuation, confirm it and reach READY. A second expiry does not loop automatically. |
| 2 — periodic drift verification | Restored the separate `lastVerify` loop from 2.14.16: READY deliveries are verified by Hub when more than 600000 ms have elapsed. Correction scans retain their independent per-delivery throttle and read-only snapshot check. | RCF-02 changes a real file in the temporary project, with file-derived snapshot facts, while a live correction excludes proposal scanning. No check runs at 599999 ms; the tick at 600001 ms records the drift and makes the delivery STALE. RCD-09 isolates the proposal scan below the legacy verifier's boundary and still proves no timestamp/verification writes. |
| 3 — capture audit and historical observations | Compiler hash differences alone no longer trigger CAPTURE_STEPS_OUTDATED. A current REPEATED_FILL collapse must correspond to extra typing of that selector/value in the frozen capture; current-script captures are accepted. Pacing/markers are ignored. Postcondition and file-provenance checks remain. STALE observations use the actual TEXT_/SUMMARY_, CAPTURE_ and narrative defect kinds. | RCF-03 constructs original-booking-spec STALE history with single typing and older pacing/markers: zero defects and no correction observation. It checks capture-only and mixed observations. RCF-03b covers real collapsed duplicate typing, already-deduplicated scripts, a different value on the same selector, postcondition failure and changed file provenance. |
| 4 — inbox coexistence and status | A Hub correction is an additional row; the delivery's ordinary pending decisions remain visible. PROPOSED waits for confirmation; CONFIRMED/RUNNING/PAUSED say `Corectura rulează` in why/ifReject. | RCF-04 covers all four statuses and asserts the inbox read writes no rows. RCD-04 also holds a real Hub-source executor RUNNING and checks both rows and running wording. The visible chip label is pending the narrowly requested exception for the explicitly protected `DecisionInbox.jsx`; that file is untouched. |
| 5 — portable RCC-06 | Temporary runner output uses `fs.mkdtempSync(path.join(os.tmpdir(), ...))`, with registered cleanup and explicit removal verification. No repository-relative parent is needed. | RCC-06 asserts its parent is os.tmpdir(), exercises the zero/missing/partial TAP guards, then asserts removal. The parent assertion fails with the old location. TEMP/TMP are redirected inside this workspace during verification. |
| 6 — required-phone citation | Phone-privacy's problem now needs AC-1, AC-2 and AC-3, matching its already-present mandatory-phone requirement. | `r-claims` RCF-06 pins the exact `(criteriile: AC-1, AC-2, AC-3)` output and refuses the statement without AC-3 proof. RCE-01 retains resolved-id and renumbering coverage. |
| 7 — bounded flow wording | Phone-privacy now says `Primește mesajul „Programare confirmată”.` and `Telefonul nu apare în pagină, nici în lista zilei.` | RCF-07 pins all four flow lines and the entire unchanged booking presentation. RC-18 retains the complete booking summary hash and byte comparison. |

### Round F verification

Tests run sequentially, one file at a time, using `C:\Program Files\nodejs\node.exe --test --test-concurrency=1 --test-reporter=tap`. Exact arguments, name filters and TAP logs are in `.tmp-s25-a/round-f-run.mjs` and `.tmp-s25-a/round-f-results/`. Offline selections preload `claims-offline-guard.mjs`. RCO-04 is selected separately at the end with `correction-local-guard.mjs`, under the user's explicit temporary-loopback/Chromium/ffmpeg exception. TEMP/TMP point inside the repository.

| File in `v2/tests/` | Tests | Pass | Fail | Skipped | Cancelled | Todo |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| r-claims.test.mjs | 23 | 23 | 0 | 0 | 0 | 0 |
| r-claims-review.test.mjs | 6 | 6 | 0 | 0 | 0 | 0 |
| r-correct.test.mjs (10 offline + RCO-04 last) | 11 | 11 | 0 | 0 | 0 | 0 |
| r-correct-review.test.mjs | 20 | 20 | 0 | 0 | 0 | 0 |
| m11-summary.test.mjs | 8 | 8 | 0 | 0 | 0 | 0 |
| m11-ui-logic.test.mjs | 18 | 18 | 0 | 0 | 0 | 0 |
| m11-fixture.test.mjs | 6 | 6 | 0 | 0 | 0 | 0 |
| m11-template.test.mjs | 16 | 16 | 0 | 0 | 0 | 0 |
| r-closure.test.mjs | 15 | 15 | 0 | 0 | 0 | 0 |
| stage-office-delivery.test.mjs | 5 | 5 | 0 | 0 | 0 | 0 |
| m11-stale-graph.test.mjs | 12 | 12 | 0 | 0 | 0 | 0 |
| Total selected | 140 | 140 | 0 | 0 | 0 | 0 |

RCO-04 passed (1 test, 1 pass, 0 fail/skipped/cancelled/todo), and was the last test run. It used real installed Chromium, ffmpeg/ffprobe, a temporary services/database environment and a demo HTTP server on an OS-selected loopback port. It exercised recapture, byte-identical capture reuse, renders, exports, Office history, a late failure and a confirmed continuation to READY, with no agent run or factory dispatch. It does not start the live Hub or a Hub HTTP server; Office checks are FILE_CHECKED, not COM verification. Its separate TAP/count files are `r-correct-real.tap` and `r-correct-real.json`. The `delivery/inbox.mjs` coverage is in `r-correct-review` RCF-04/RCD-04/RCE-04. Name-filtered exclusions are not counted as Node skips.

The seven changed JavaScript modules passed `node --check`; `git diff --check` passed. The entire booking presentation was compared with the definition read from `git show HEAD:v2/server/factory/booking-demo-def.mjs`: JSON bytes are identical, hash `49ee3ec3a4cb9dad2dbeef0cfe26dd9ccdd0e31da86020e0374d669e3626307b`. The existing booking summary pin `7c6d1b429b7959baadcdf37b349e62830f91035f89cf096d9b364147b3c781d0`, first-generation planner pins and legacy hash checks pass.

The new behavioral regressions were run against the pre-fix implementation and failed on the reported conditions before passing with the fixes. Early test setup errors (wrong revisionOfPlan arguments, capture-role object treated as an array, missing updated test IR hash) were corrected before the corresponding pre-fix failures were established. A supplemental RCC-06 invocation from an empty working directory initially failed in Node's loader because its absolute Windows `--import` argument lacked a file URL; no test body executed in that invocation. No timing failure has occurred.

Not run / remaining:

- The F4 visible chip-label edit is blocked by the explicit prohibition on editing `v2/web/src/screens/delivery/DecisionInbox.jsx`. A one-entry exception was requested; no response has been received. No alternative UI or global-component workaround was introduced.
- M11-UI-17 and M11-FX-02–05/08–12: browser or loopback-server harnesses outside the RCO-04 exception.
- `r-closure` HIST-01, FAC-01–07, REV-05; `stage-office-delivery` OFF-06; legacy `m11-delivery-guards`: broader Hub/git/runner/server harnesses outside the guardrails. The permitted correction-review suite directly tests the changed inbox service.
- Full repository suite, live Hub/port 8011, live hub-data, external network, models, npm installation, Word/Excel COM, PDF application verification and Brave visual QA. RCO-04's explicitly requested Chromium is not Brave QA.

No migration, protected helpers, node_modules junction or credential-folder edits/reads; no edits outside the repository and no state-changing git command. No commit was created.

## 2.14.18-m11 — round G: later legitimate retirement (2026-10-16)

Implemented without committing. API contract remains 13, with no migration and no change to stored spec/template/bundle hashing. All recovery tests construct synthetic project files and a newly migrated temporary database inside this repository; none constructs the Hub or the factory over real data or a copy of real data.

| Spec G item | Change | Regression proof |
| --- | --- | --- |
| 1 — later retirement evidence | `compensateRetirementNow` queries other missions created strictly later in the same project with an APPROVED spec. It requires a readable MOVED journal, matching `protected.retired` path/hash/cycle evidence, and the exact SHA-256 at that mission's own retired path. Only verified records reach the DB-independent `restoreRetired` helper. | `r-retire-later` RL-01 covers missing and different original bytes with valid later evidence. RL-03 rejects missing/unapproved/older/same-time/foreign-project evidence, absent or non-MOVED journals, missing records, mismatched hashes and missing/changed retired copies. |
| 2 — preserve or repair the old restore | An explained item is `retired_later` with `by`. A valid RESTORED journal returns `already_restored` without rewriting the journal. After G2, DB/event writes are skipped only when restore records are complete for the cycle and `restoreBlocked` is falsy; otherwise recovery adds missing records, clears the flag and emits a complete `already_restored` event with the journal SHA. A false RESTORE_INCOMPLETE is repaired only with restore records for every item in the journal's cycle and no unexplained item. Its history retains prior entries and adds `repairedAt`, `laterRetiredBy` and the specified Romanian cause. Recovery clears `restoreBlocked` and emits the complete `repaired_after_later_retirement` event with the new journal `sha256`. Mixed failures remain refused, without resurrecting any later-retired test. | RL-01 asserts identical journal/protected JSON, unchanged SQLite `total_changes()`, no restore/refusal event and READY after real snapshot verification in steady state. RL-02 exercises the actual boot entry point `factory.recover()`, legacy problem/history bytes, the live delivery listener, boot event replay and multi-item repair; it asserts STALE → READY, provenance evidence, stable spec hashes and a second recovery with zero writes. RL-03 covers wrong restore cycles, missing restore records, unexplained original bytes and mixed failures, including an old copy that must not trigger a partial restore. G2 adds RL-05/06 for missing DB records and a lost repair transaction. |
| 3 — journal drift provenance | Existing `driftProvenance` rules already classify a consistent RESTORED journal as Hub-owned even when its bytes differ from the delivery snapshot; no production change was needed there. | RL-04 checks the same path before and after repair: RESTORE_INCOMPLETE is software, repaired RESTORED is `hub_retire_journal`, and the real snapshot still reports the changed journal bytes. RL-02 verifies that classification is recorded in delivery reconciliation evidence. |
| 4 — version | `HUB_VERSION` is `2.14.18-m11` with a one-sentence comment; API contract stays 13. INT-05 pins both constants independently of its HTTP fixture. The preserved HTTP test is named INT-05-HTTP and its response assertion also pins 2.14.18-m11. | `m10-2-p0r-integration` INT-05 passes; the HTTP fixture remains unrun under the Git guardrail. |

### Round G verification

Executed one test file at a time with `C:\Program Files\nodejs\node.exe --test --test-concurrency=1 --test-reporter=tap`. The sequential runner, exact name filters, TAP logs and per-file JSON counts are in `.tmp-round-g/run.mjs` and `.tmp-round-g/results/`. TEMP/TMP point inside the repository. Each process preloads the existing `claims-offline-guard.mjs`, which rejects network, browser/model binaries and Git subprocesses. Selected exclusions are not Node skips.

| File in `v2/tests/` | Tests | Pass | Fail | Skipped | Cancelled | Todo |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| r-retire-later.test.mjs | 25 | 25 | 0 | 0 | 0 | 0 |
| r-closure.test.mjs (HIST, SUP, ROLL, PACK, REV-01–03) | 16 | 16 | 0 | 0 | 0 | 0 |
| m11-stale-graph.test.mjs | 12 | 12 | 0 | 0 | 0 | 0 |
| r-correct.test.mjs (RCO-04 excluded) | 10 | 10 | 0 | 0 | 0 | 0 |
| r-correct-review.test.mjs | 20 | 20 | 0 | 0 | 0 | 0 |
| m10-2-p0r-integration.test.mjs (INT-05 constant pin) | 1 | 1 | 0 | 0 | 0 | 0 |
| Total selected | 84 | 84 | 0 | 0 | 0 | 0 |

All four changed JavaScript modules passed `node --check`; `git diff --check` passed. No timing failure occurred. The first new-suite invocation reported 20 pass / 2 fail out of 22 (the cross-project fixture setup and its parent test); correcting when the fixture changes project ownership produced 22/22, then expanded coverage passed 25/25. The original combined INT-05 passed its constant assertions but its fixture attempted Git creation; the preload rejected it before any Git process launched (1 test / 0 pass / 1 fail). The constant check was then separated from the unchanged HTTP scenario and passed 1/1. The guarded INT-05 TAP remains in the results directory.

Not run / not completed:

- `r-closure` FAC-01–07 and REV-05, all four `m11-delivery-guards` tests, and `m10-2-p0r-integration` INT-01–04 / INT-05-HTTP: their shared `makeTestHub` setup uses `git init`, `git add` and `git commit`. The explicit ban on state-changing Git commands takes precedence; `v2/tests/helpers.mjs` was not changed. Retirement HIST/SUP/ROLL coverage is consolidated in `r-closure`, not separate r-hist/r-sup/r-roll files.
- RCO-04: the existing real-media harness explicitly launches Chromium. The session requires Brave and does not authorize a Chromium exception. No browser was launched and no Brave QA is claimed.
- Full repository suite, live Hub/port 8011, real project folders, live hub-data, external network, models, package installation and production deployment: outside this isolated implementation/verification scope or explicitly prohibited.

No migration, protected helper or DecisionInbox.jsx edits, node_modules junction changes, private credential-directory reads, edits outside the repository, or state-changing Git command execution. No commit was created.

### Round G2 — RESTORED journal / DB reconciliation (2026-10-16)

Implemented on `4ce54a7`, branch `claude/project-thread-98qmet`, without committing. `compensateRetirementNow` now reconciles `already_restored` before deciding whether recovery is read-only: append missing restore records for the journal's cycle, clear `restoreBlocked`, and emit `factory.retire_restored` with `complete: true`, `state: already_restored` and the on-disk journal SHA whenever records were added or the flag was truthy. If records are complete and the flag is falsy, return without DB/event writes. The journal is not rewritten in either case. Later-retirement recognition and RESTORE_INCOMPLETE repair remain unchanged. Version remains 2.14.18-m11, contract 13, with no migration or stored-hash changes.

Regression proof in `r-retire-later.test.mjs`:

- RL-05: RESTORED with original bytes present and missing records (absent array, empty array, partial list, older-cycle records, and missing records with the flag already false). Recovery records each item exactly once for cycle 2, preserves existing records and journal bytes, clears the flag and emits one complete event with the exact journal SHA. A repeated recovery changes no DB rows and emits nothing more.
- RL-06: the real repair runs inside an event-bus transaction that deliberately rolls back after the journal write. The journal remains RESTORED, protected JSON still has `restoreBlocked: true`, and no restore event is committed. Next recovery clears the flag without duplicating the existing records, emits `already_restored` with the SHA, and reconciles STALE → READY through both live delivery subscription and boot replay, recording `hub_retire_journal` evidence. Another recovery writes no DB rows or events and preserves journal bytes.
- RL-01 now checks fully reconciled steady state, as required by G2, instead of requiring a stale true flag to survive. RL-01–04 retain later-retirement, refusal, repair, provenance and repeated-boot coverage.

Each file ran separately and sequentially with `C:\Program Files\nodejs\node.exe --test --test-concurrency=1 --test-reporter=tap`, preloading the existing offline guard. TEMP/TMP point inside the repository. Exact selections, commands, TAP logs and JSON counts are in `.tmp-round-g2/run.mjs` and `.tmp-round-g2/results/`.

| File in `v2/tests/` | Tests | Pass | Fail | Skipped | Cancelled | Todo |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| r-retire-later.test.mjs | 34 | 34 | 0 | 0 | 0 | 0 |
| r-closure.test.mjs (HIST, SUP, ROLL, PACK, REV-01–03) | 16 | 16 | 0 | 0 | 0 | 0 |
| m11-stale-graph.test.mjs | 12 | 12 | 0 | 0 | 0 | 0 |
| r-stage0-repair.test.mjs (S0R-05–08, S0R-22) | 5 | 5 | 0 | 0 | 0 | 0 |
| Total selected | 67 | 67 | 0 | 0 | 0 | 0 |

Name-filtered exclusions are not Node skips; counts include parent tests and subtests. Before the implementation fix, the expanded retirement suite produced 34 tests / 25 pass / 9 fail (seven new subtests plus their two parent tests). An earlier setup run had the same counts but RL-06 used a nonexistent DB transaction API; switching it to the existing event-bus transaction API established the actual flag-clearing regression before the fix. Both earlier TAP files are retained. No timing failure occurred. The changed production/test modules and verification runner pass `node --check`; `git diff --check` passes.

Not run in G2:

- `r-closure` FAC-01–07 and REV-05: shared `makeTestHub` creates Git state, prohibited by the guardrails.
- The remaining `r-stage0-repair` tests: selection is limited to offline static checks and the direct retirement restore test S0R-08. Hub scenarios call `makeTestHub` (Git changes); application protocol scenarios include loopback HTTP. Other protocol-only coverage outside this retirement fix was not selected. No helper edits or loopback exception were used.
- Other round G suites and the full repository suite: outside the focused G2 validation request. No browser/Brave QA, model, network, live Hub/8011, real-project or live-data access, installation or deployment was performed.

Only the factory implementation, retirement regression tests and this claims document changed among tracked files. Temporary verification artifacts remain in `.tmp-round-g2/`. Protected files, the node_modules junction and Git state were not changed; no commit was created.
