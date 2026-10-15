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
