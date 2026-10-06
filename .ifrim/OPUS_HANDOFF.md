# Ifrim Agent Hub - Opus Handoff

## 2026-10-05 — P0 closure of M10.2 (current; read `.ifrim/HANDOFF_2026-10-05_P0.md` first)

- **Version and state.** Code `2.12.1-m10.2`, API contract 12, schema 11 (no migration). **Uncommitted at writing** on `v2-milestone-01` over `e8a55ce`, in the same files as M10.2. **The live Hub still runs `2.12.0-m10.2`** (contract 11). Nothing live was run for `2.12.1`: no upgrade, no model, no Lega session. Reading order: the handoff above, then `.ifrim/M10_2_REPORT.md` §11, `.ifrim/M10_2_PROBE_SHEET.md` and the first section of `OPEN_ISSUES.md`.
- **What it adds: reopening the gate (D14–D17).**
  - **D14.** After „Oprește tot”, or any suspension that is not the owner's own pause, the gate is reopened from a card in the cockpit: owner session + fresh Windows Hello (≤ 5 min), bound to the exact stop (nonce + hash, compare-and-set). Click, Enter or typed only; never voice, phone, agent or a timer. The typed OPEN GATE in Integrări → Avansat stays only as a diagnostic path and refuses a stop next to a security event.
  - **D15.** The rearm reopens the whole gate, puts the Hub back in BUILD_SAFE if needed and restarts nothing. Only the request that showed the card is re-proposed, as a plan that still needs its own confirmation. Stop All also closes the engineering and run plan cards (envelopes) that were still waiting. Operation-plan cards (Studio, desktop) are not closed: they still need their own confirmation and expire.
  - **D16.** Security events from 15 min before the stop (a Lega session violation, a voice-filter bypass, a revoked authenticator) are listed on the card, newest first, and must be acknowledged. The acknowledgement is bound to them.
  - **D17.** Every suspension records who or what stopped the gate (kind, channel, time, the credential as a hash prefix), with a precedence order and one classifier (`v2/server/policy/gate-state.mjs`).
- **What it adds: „Continuă” and pause (D18–D20, D22).**
  - **D18.** A spoken „Continuă” resumes only as the owner's locally verified voice: speaker check + local whisper, in a Lega session started from the owner session with the voice filter on, the whole sentence, used once. It runs the same executor as the typed word. The provider transcript never resumes; it only vetoes (a provider „Continuă?” stops the local one).
  - **D19.** A pause addressed to Lega in a Lega session started from the owner session is the owner's own pause (affirmative, addressed or explicit forms only). Unlike D18, it does not need the voice filter.
  - **D20.** „Continuă?” asked as a question never resumes. After an expired plan, „Continuă” points to „Reia misiunea X”.
  - **D22.** What a Stop All, a shutdown or a security stop itself paused (operation plans, the desktop session, missions) resumes only after the rearm, on every path: typed or spoken „Continuă”, the plan card's button, the desktop resume. Work paused for another reason resumes as before.
- **What it adds: probe fixes and the Lega start (D21, D23).**
  - **D21.** Project names with a dot resolve. The single acceptance test is picked and protected without a question (not for "write/add a test" requests, and not when another test is named). The plan card mentions preview/E2E only when the spec has them. The setup's automatic attestation re-attests only the same fingerprint (`environment.attest` forwards `expectFingerprint`).
  - **D23.** A Lega start from the owner session refreshes a stale Codex account check by itself, once per start, with the same inference-free check as „Verifică contul”. The preview stays read-only and shows such checks as „verific singur la pornire”. Failures are shown honestly. Tests: `v2/tests/m10-2-p0-lega-autoprobe.test.mjs`. 17 tests (LA-01…LA-12); its focused runs passed 115 + 154 and it is included in the full regression below.
  - **Also fixed.** A run still being admitted when Stop All lands never reaches its model (an old kill-switch gap in `v2/server/runtime/runs.mjs`). A readiness pass no longer resumes work after a rearm. A shutdown that interrupts a run (active or still in admission) also closes the waiting plan cards; a shutdown with no run in flight records no stop and closes nothing. The rearm card is one-shot in the UI (no replay on remount) and is always shown before the decision.
- **Tests.** The adversarial review had 46 findings over 6 dimensions: 19 confirmed, 19 partly, 8 refuted. New suites: 10 files `v2/tests/m10-2-p0-*.test.mjs`, 119 tests. Integration set (all 34 `m10-2-*` files and 17 older suites): 506/506 twice, plus 132/132 extra. PASS_SIMULATED; the browser E2Es ran in headless Chromium against throwaway test Hubs. Full regression: V2 **1246 tests · 1245 PASS · 0 FAIL · 1 SKIP** (T25 symlink, unchanged; 128 files without `m11-*`, UI built separately, 55 min, 2026-10-06 00:21–01:17 UTC); V1 **552 · 551 PASS · 0 FAIL · 1 SKIP**. Live: NOT_RUN.
- **Owner's approval.** On 2026-10-05 (~16:30 UTC) the owner approved the probe sheet `.ifrim/M10_2_PROBE_SHEET.md`. It covers the sheet and nothing wider: one local commit (M10.2 + P0), the upgrade to `2.12.1-m10.2`, the test project, one Lega session of at most 20 min, one Engineering plan, the Studio import and one edit. Limits: no push, no M11 pilot, no decision on the historical bundles.
- **Next action.** Full regression → one local commit with explicit paths (the M11 files stay out) → `node v2/scripts/upgrade.mjs --plan`, then `--apply` (verify `2.12.1-m10.2`, contract 12, BUILD_SAFE) → the test project „Factory Demo M10.2” → `node v2/scripts/probe-m10-2.mjs --mark` → the owner's probe A–G. M10 closes only after that probe. Open items: `OPEN_ISSUES.md`, first section.
- **M11 wave 0.** New, unwired files only: the booking demo fixture, `v2/server/delivery/*`, the Delivery Room screens and the `m11-*` tests. They are uncommitted, not loaded by the Hub and not part of the P0 commit. Design and file lists: `.ifrim/M11_DESIGN.md` (appendices A and B). Rule: new files only until the owner's probe is done; M11 work in shared files starts after it.

## 2026-10-05 — M10.2: zero-form voice/text/UI flow (superseded by the P0 closure above where they overlap; read `.ifrim/M10_2_REPORT.md` first)

- **Version and state.** Code `2.12.0-m10.2`, API contract 11, migration 11 `m10-2-work-requests`. **Uncommitted** on `v2-milestone-01` over `e8a55ce`, which the owner pushed. **Live since 2026-10-05 04:57 UTC**: run `upg_muus3hq2`, verified pre-migration backup v10→v11, BUILD_SAFE, verified on the served runtime.
- **What it is.** One command path for voice, text and UI (`owner/intake.mjs`, server-side effect classes). Lega proposals become one-confirmation plans: envelope, ops or run. Plan steps are admitted in BUILD_SAFE by envelope-scoped authority with bound-only derived grants. Blockers are explained once and the request is preserved (`work_requests`). Automatic readiness covers probe, inspect, skill reconcile and a same-fingerprint re-attestation after the plan confirmation. Spoken confirmation arms automatically. The live web-search guard is on the server. Skills are reconciled. `GET /api/media/tools` is pure. The probe counters are `GET /api/owner/probe` and `v2/scripts/probe-m10-2.mjs`.
- **Tests.** V2 1110 · 1109 PASS · 0 FAIL · 1 SKIP; V1 552 · 551 PASS. The 60-agent review confirmed 42 findings; all are fixed with regression tests.
- **M10 is not closed** until the owner's guided live probe (A–G). The sheet is in the closure report and in OPEN_ISSUES (M10.2 section).

## 2026-10-04 — M10: PC operator + zero-form plans + usable Studio (current; read `M10_REPORT.md` first, then `M10_ACTIVATION_SHEET.md`)

- **M10.1 — Lega one-click start (code `2.11.1-m10`, contract 10, no migration, committed in `72d6964`; **live since 2026-10-04 18:12 UTC** — owner-approved `upgrade.mjs --apply`, run `upg_muu51x09`, 2026-10-04 18:12 UTC, verified 2.11.1-m10 / BUILD_SAFE / 0 grants; the PC had rebooted; the Hub now autostarts at logon through the per-user task "Ifrim Agent Hub V2", `v2/scripts/autostart.ps1`).** The Lega voice starts from the owner session with one click, or with the phrase „Pornește Lega”. The Hub derives a one-session voice authority: a Codex voice grant, read-only, created and consumed in one transaction (born exhausted), revoked at the end, bounded by the owner session, at most 6 starts per 15 min, audited as `lega.authority_derived` / `lega.authority_released`. The mode is never written; runs stay refused in BUILD_SAFE. The gate, consent, billing, realtime, isolation, breaker and concurrency checks still decide. The old path (ui + LIVE_VALIDATION + a hand grant) is kept. A Codex billing withdrawal now also stops an old-path session (a deliberate fail-safe). Detail: `.ifrim/M10_LEGA_ZERO_FORM.md`; tests `v2/tests/m10-lega-owner-start.test.mjs` (16) + `m10-lega-stage-e2e.test.mjs` (1, real Chromium); full V2 929 · 928 PASS · 0 FAIL · 1 SKIP. Also: an owner re-authentication in the last 10 min of a session now rotates it (new session; see OPEN_ISSUES item 0).
- **Version and state.** Code `2.11.0-m10`, API contract 10, migration 10 `m10-operator-plans`. It adds 7 tables: `ops_plans`, `ops_plan_steps`, `desktop_apps`, `desktop_sessions`, `desktop_actions`, `media_project_imports`, `media_import_grants`.
  - **Committed** on 2026-10-04 at the owner's request as `72d6964` on `v2-milestone-01` (M09 + M10 + M10.1 together, over `ae3aa48`; 221 files); the push of `v2-milestone-01` was refused by the session's permission layer: the owner runs `git push origin v2-milestone-01`. `main` is untouched (`17921ac`).
  - **The live Hub runs `2.11.0-m10` (contract 10) since 2026-10-04 13:53 UTC**: Claude ran `node v2/scripts/upgrade.mjs --apply` at the owner's request ("aprob upgrade ul la m10"), run `upg_mutvrr79`: preflight (0 runs, 0 active grants) → dry run 9 → 10 (integrity ok, rows unchanged) → stop → UI + desktop helper build → start → verify. The server took the verified pre-migration backup `hub-data\private\pre-upgrade\hub-v2.pre-migration.v9-to-v10.2026-10-04T13-53-14-962Z.sqlite` (sha256 `bef36396…fb50`, integrity ok, manifest); the pre-M09 backup is untouched. After: BUILD_SAFE, gate `open` as before, 0 grants, 0 runs, log clean, desktop apps NOT_FOUND until the owner's discovery (none authorized). Before applying, two upgrade-runner defects were fixed: the dry-run copy of the live DB went to `.ifrim/tmp` inside OneDrive (now `<dataDir>/upgrade/dry-run`; the M09 manual dry run had done the same, copy deleted right after), and the start step waited only 40 s. No GUI action on the owner's desktop, no model, no commit or push.
- **Upgrade.** The upgrade is now one command: `node v2/scripts/upgrade.mjs --plan | --apply | --resume`.
  - **The server itself** takes and verifies the pre-migration backup (`VACUUM INTO` + integrity + manifest). It refuses to migrate without it (`PRE_MIGRATION_BACKUP_FAILED`).
  - The `--apply` build step also rebuilds the desktop helper.
- **Desktop Operator.**
  - The C# helper (`v2/desktop/operator/IfrimOperator.cs`) is built with the Windows `csc.exe` (`/codepage:65001`) into `<workDir>\desktop`, with a manifest that binds the binary to the source.
  - The helper speaks HMAC-signed stdio JSON with nonce + timestamp + `auth.exp` + `auth.apps`. Its scope is **fail-closed**.
  - It refuses protected processes, the Hub's own window, sensitive buttons and secure desktops. It stops on the owner's input.
  - The single gate is `server/desktop/operator.mjs` (`perform`). Profiles: Notepad edit/Save As, CapCut inspect / new project + import.
  - Real read-only discovery on this PC: Notepad 11.2607.14.0, Explorer, OBS 32.2.2, CapCut 9.3.0.3970. All four are DISCOVERED with trusted signers and **none is authorized** yet.
- **Zero-form plans.** `server/policy/action-policy.mjs` defines the classes LOCAL_DIRECT / PLAN_STEP / SENSITIVE / REFUSED, decided by effect.
  - `server/ops/plans.mjs` gives ONE confirmation in the owner session (typed, click, or local voice evidence for THAT plan). The plan is rebuilt and must match its hash.
  - The derived authority is checked at every operation. A pause / stop / takeover is fail-safe. „Continuă” reconciles uncertain steps first. A boot never resumes a plan.
  - The only decisions allowed inside a card are a new app or a new folder (step-up).
  - Lega intents, the same for text and voice: „Deschide CapCut / OBS / Notepad / Explorer”, „Adu X în față”, „Arată folderul exporturilor”, „Importă din folderul acesta”, „Pregătește varianta verticală”, „Înregistrează demonstrația … fără să publici”, „Continuă”.
  - „La secunda N …” now also yields a plan card (apply + draft render + QA).
- **Studio.**
  - A project bundle `proiect-studio.json`: export → preview → ONE import. Ids are remapped, labels are kept, approvals are never imported, re-import is idempotent; an older delivery can be reconstructed.
  - The M09 clip folder now holds its bundle. It was verified by importing it into a test hub: 2 sources hash-OK, 8 versions, SIMULATION kept.
  - Contextual import folders (once / persistent).
  - `preferredTextTarget` is implemented: the selection wins and labels are never guessed.
  - Narrow variants plate content text at ≥ 0.9 opacity (guaranteed in the ffmpeg filter) with a legible minimum size; this fixes the M09 LinkedIn ~21 s issue. Legibility QA runs on the real frame.
  - Local export without overwrite; `media.capture.scope.approve`; `media.policy.obs` (no password stored).
- **UI.**
  - The plan card (`screens/lega/OpsPlanCard.jsx`).
  - A permanent desktop activity bar with Stop / Preiau eu (`shell/DesktopBar.jsx`).
  - The Operator page `#/desktop` (apps, OBS, folders, plans, actions).
  - The Studio „Importă un proiect” panel and the correction's text target + clarification options.
- **Tests.** M10 adds 53 tests (upgrade 8, desktop 15, operator-real 3, plans 13, studio 13, browser E2E 1). Full V2 suite: 912 · 911 PASS · 0 FAIL · 1 SKIP; V1: 552 · 551 PASS · 1 SKIP.
  - M10 found and fixed 8 real defects, among them the helper's JSON arrays, which made the app scope fail-open. List: `OPEN_ISSUES.md` (M10 #9).
- **Next.**
  - The owner continues `M10_ACTIVATION_SHEET.md` from step 2: discover + authorize the apps (Windows Hello), D1/D2/D3/D4/D6, then OBS + MB1 if wanted.
  - Commit / push only on the owner's exact request.

## 2026-10-04 — M09: Content / Media / Growth studio + core fixes (superseded by M10 above where they overlap; read `M09_REPORT.md`)

- **Code `2.10.0-m09`, API contract 9, migration 9 `m09-media-growth`** (27 tables + columns on `agent_runs`, `factory_missions`, `live_grants`). **Committed** in `72d6964` (with M10) on `v2-milestone-01` over `ae3aa48`; `M08_SESSION_REPORT.md` is still uncommitted too. Commit/push need the owner's exact approval. Never stage `.ifrim/data-location.json`, hub-data, raw media, voice profiles, backups or ProDelivery files.
- **The live Hub runs `2.10.0-m09` (contract 9) since 2026-10-04 07:23 UTC.** Claude did the upgrade at the owner's request ("fă tu pașii de trecere pe M09"):
  1. read-only pre-flight (0 runs, 0 grants);
  2. `migration-dry-run.mjs` 8 → 9 clean (integrity ok, rows unchanged);
  3. `stop.mjs`;
  4. coherent DB backup `C:\Users\mihai\IfrimHub\hub-data\private\pre-upgrade\hub-v2.pre-m09.2026-10-04T07-23-05-815Z.sqlite` (sha256 `3f90d2bc…5651`, schema 8, integrity ok; the Hub does not back up by itself before a migration);
  5. `npm run build:v2` (same bundle hashes as the tested build);
  6. `start-detached.ps1`;
  7. GET-only checks: BUILD_SAFE, 0 grants, 5 media presets seeded, billing converted, Claude `reverify_required`, media policy off, log clean.

  The execution gate stayed `open` as before. Rollback: `M09_LIVE_VALIDATION_PLAN.md` §1.
- **Claude inference is blocked until the owner re-declares billing** (live: `reverify_required`) (owner session + fresh Hello + probe ≤ 24 h). Codex stays valid until its declaration expires.
- **Track A (core fixes, PASS_SIMULATED):**
  - A1: explicit model + effort binding from proposal to dispatch, re-checked before any process and at Claude init (`policy/model-binding.mjs`);
  - A2: Claude billing from evidence with a salted account pseudonym and 30-day expiry (`policy/billing-evidence.mjs`);
  - A3: approved skill bodies injected and recorded per run (`domain/skill-composer.mjs`, `run_skill_usage`);
  - whisper-server listener checks (`owner/voice-worker-lib.mjs`). Media transcription never confirms commands.
- **Track B (Content Studio, `v2/server/media/`, 24 files):** library + rights, EditProjectIR + local ffmpeg renderer, QA, variants, timecode reviews, manifests + manual packs, analytics/experiments/campaigns, Public Demo Mode capture, local transcription. UI `#/studio`. Decision packages MEDIA_A/B/C.
- **No social API, OBS recording, live capture or AI media run exists or ran.** `AUTO_PUBLISH=OFF`, `LIVE_UPLOAD_DISABLED`, `LIVE_MEDIA_CAPTURE_DISABLED`.
- **First clip** "Un plan. O singură confirmare." (25.6 s + Reels/LinkedIn/X variants + edit and recovery proofs, QA PASS):
  - location: `C:\Users\mihai\Videos\Ifrim Studio\M09 - Un plan, o confirmare\`;
  - produced on a TEST hub from a Public Demo Mode capture (SIMULATION label); sources in `surse/`;
  - creative acceptance not recorded; its manifest is DRAFT. Re-creating the project on the live Hub needs an asset-id remapping helper (OPEN_ISSUES M09 §5).
- **Tests** (2026-10-04, final code): V2 full **859 · 858 PASS · 0 FAIL · 1 SKIP** (T25 symlink); M09 files 209/209; V1 552 · 551 · 1 SKIP. (A first full run had 1 FAIL, AS-09, fixed.)
- **Adversarial review:** 39 findings; all 19 confirmed fixed + 8 more. 11 low residuals are in OPEN_ISSUES M09 §12. Numbers R1–R39 = the session's `review/findings.json`.
- **Untouched:** ProDelivery pilot `bnd_musqo7xj_1a204a2e55` + F-001, D6 `bnd_murl82o1_00afe726c3`, Demo B `bnd_mupwze7b_e03f70f2d7`, V1, OpenClaw, A3 copies, WSL profiles, `main`/origin.

## 2026-10-03 — M08: project autopilot & company intelligence (current; read `M08_SESSION_REPORT.md` first, then `M08_REPORT.md`)

> **Update 2026-10-03 ~18:45 UTC:** the owner pushed `ae3aa48` to `origin/v2-milestone-01` (`origin/main` still `17921ac`), re-consented R3 (18:29), decided packages A and B (18:30), and confirmed the ProDelivery pilot plan (18:36). The pilot reached DELIVERY_READY (bundle `bnd_musqo7xj_1a204a2e55`, awaiting the owner; review finding F-001 medium; the reviewer ran on `claude-opus-5-5` instead of the approved `sonnet`, a defect to fix). A Windows reboot at 18:19 UTC stopped the Hub; Claude restarted it (pid 5764, BUILD_SAFE). The lines below that say push pending, pid 8104, R3/packages undecided or pilot not started are superseded; **`M08_SESSION_REPORT.md` takes precedence.**

- **Code `2.9.0-m08`, API contract 8, migration 8** (13 tables). **Committed as `8b277c5`** on `v2-milestone-01` over `17921ac` (2026-10-03, at the owner's request "fă tu"), plus a docs commit after the live upgrade. **The push was refused by the session's permission layer** (not retried through another channel): the owner runs `git push origin v2-milestone-01`. Origin and local `main` are still at `17921ac`.
- **The live Hub runs `2.9.0-m08` (contract 8)** since 2026-10-03 16:26 UTC (pid 8104, BUILD_SAFE, migration 8 applied, 0 grants, 0 runs). Upgrade done by Claude at the owner's request, in this order:
  1. `node v2/scripts/stop.mjs` (0 active grants/runs/supervised processes before);
  2. **A1 executed:** `relocate-data.mjs --apply --to C:\Users\mihai\IfrimHub\hub-data` — integrity ok, 100 tables, 5,935 rows, sha256 `bb0ee89f…0153`, 120 backup files (186 MB) + 175 work files sha-verified, 34 stored paths rewritten; new root ACL = owner + SYSTEM; `V2_MOVED.json` in the old `.ifrim/private`; pointer `.ifrim/data-location.json` (git-ignored);
  3. **A2 executed:** `voice-acl.ps1 -Apply` then `-Verify` on `C:\Users\mihai\IfrimHub\voice\profiles` — only SYSTEM + the owner, 0 inherited, no wide groups (`CodexSandboxUsers` RX removed), no DENY; backup `profiles.acl-backup.txt`; rollback `-Rollback`;
  4. `npm run build:v2` (the M08 UI is now `v2/web/dist`); `migration-dry-run.mjs` on the moved DB: 7 → 8, `m08Complete`, integrity ok, rows unchanged;
  5. `v2\scripts\start-detached.ps1`.
- **A3:** nothing to execute; the old local copies and the OneDrive cloud copies were NOT deleted. The owner still records the package A decision in the UI (Pilot → Decizii, Windows Hello); A1/A2 show as executed from reality.
- **Owner's next steps:** Ctrl+F5 on `#/lega`; unlock the session; **re-consent to workspace isolation (R3)** — the Codex deny list now contains the new data paths, so Codex on Windows and Lega voice stay blocked until then; decide package A; then package B (pilot) with Windows Hello; the voice filter is off (`gate.enabled: false`, unchanged by the upgrade).
- **M08 docs:** `M08_REPORT.md`, `M08_IMPLEMENTATION_STATUS.md`, `M08_FEATURE_MATRIX.md`, `M08_DATA_PRIVACY_PLAN.md`, `M08_AUTOPILOT_CONTRACT.md`, `M08_TEST_REPORT.md`, `M08_LIVE_PILOT_PLAN.md`, `M08_UX_MEASUREMENTS.md`; screenshots in `.ifrim/m08-screens/`.
- **New code:**
  - `v2/server/intel/`: twin, warroom, autopilot, board, simulation, league, skill-evolution, teach, devices, packages, intel-commands, intel-routes;
  - `v2/scripts/relocate-data.mjs`, `v2/scripts/voice-acl.ps1`;
  - UI: `screens/Intel.jsx` and `screens/intel/*`, `screens/Mobile.jsx` (`#/m`), `screens/lega/IntelCard.jsx`, `lib/intelLogic.js`.
- **Envelopes and the Lega gate:**
  - plans over an objective: the objective is re-read from the DB at propose and at confirm; an amended objective supersedes the old plan;
  - the armed voice window: 90 s, single use on success, closes after 3 refused sentences; `voice.gate_final` → `confirmFromArmed`, which re-checks everything through `confirm()` / `claimForConfirmation()`.
- **Data location:**
  - `.ifrim/data-location.json` (pointer) → `<root>/private`, `backups/v2`, `work`;
  - the old folder gets `V2_MOVED.json` and a V2 Hub refuses to open it;
  - only V2 entries move (`isV2DataEntry`): V1 shares `.ifrim/private` and keeps running there.
  - **Executed live on 2026-10-03** (A1, see above); rollback: `relocate-data.mjs --rollback` with the Hub stopped.
- **Packages:**
  - A (A1 relocation, A2 voice-profile ACL, A3 acknowledge cloud copies) and B (ProDelivery pilot: `driver_ranking` unit tests; B1 route, B2 ASSISTED, B3 `python3 -m unittest`, B4 task);
  - B is blocked until A is decided and executed;
  - "executed" is read from reality.
- **Tests:**
  - 54 new M08 tests pass (38 + 16 review regressions RF-01…RF-16); 7/7 mutants killed;
  - browser tests follow `HUB_V2_WEB_DIST` (with the old dist, M04-BR-01 and M06-UI-E2E-01 fail with UI_STALE by design);
  - full V2 suite with the M08 build: 650 tests, 649 pass, 0 fail, 1 skipped (T25 symlink); V1: 551/552 (1 symlink skip).
- **Untouched:**
  - bundles D6 `bnd_murl82o1_00afe726c3` and Demo B `bnd_mupwze7b_e03f70f2d7`;
  - V1 (3004/8004, still on `.ifrim/private`), OpenClaw, WSL, scheduled tasks;
  - no model was started, and the M07 grants were not reused.
- **Definition of Done:**
  - BUILD_READY yes; SIMULATED_INTEGRATION_VERIFIED yes;
  - PRIVACY_READINESS executed locally (A1 + A2; cloud copies remain, A3);
  - VOICE_UX not live; LIVE_PROJECT_PILOT no; CROSS_DEVICE BLOCKED;
  - OWNER_ACCEPTED pending.

## 2026-10-03 — M07: activation, local voice, live validation (superseded by M08 above where they overlap)

- **Code `2.8.0-m07`, API contract 7:** committed as `09f50b4` (plus a docs commit) on `v2-milestone-01`, right after the M06 commit `66487b9`. Local `main` is fast-forwarded to it. The push was refused by the session's permission layer, so the owner runs `git push origin v2-milestone-01 main` (no workflows, hooks or deployments on the private repo).
- **M07 docs:** `M07_ACTIVATION_REPORT.md`, `M07_LIVE_VALIDATION_RESULTS.md`, `M07_INSTALL_MANIFEST.md`, `M07_SECURITY_READINESS.md`, `M07_USER_EXPERIENCE.md`.
- **Live Hub:**
  - runs `2.8.0-m07` on `http://localhost:8011`, the canonical origin (`127.0.0.1` document navigations get a 307);
  - started through WMI with `v2/scripts/start-detached.ps1`; restart with `v2/scripts/restart.ps1`; the launcher is `Ifrim Hub V2.cmd` (`start.mjs`, detached);
  - migration 7 (`voice_utterances`) is applied;
  - left in BUILD_SAFE, with no active grant, no AI run and the microphone closed.
- **Installed (A1–B2, see `M07_INSTALL_MANIFEST.md`):**
  - Chromium libs and Playwright Chromium 1228 in ifrim-runner (no `--no-sandbox`);
  - Claude Code 2.1.285 Linux as an isolated reviewer (bwrap, dedicated config, the owner's login);
  - whisper.cpp 1.9.4 large-v3-turbo (CUDA) and sherpa-onnx CAM++ under `C:\Users\mihai\IfrimHub\voice`, outside the MSIX-virtualized LocalAppData and outside OneDrive. All SHA values are pinned in `voice-engine.mjs`.
- **Attestation:** `att_murgupen_3459ee8157` (2026-10-02 21:21 UTC; valid 14 days), PASS_LOCAL, C1–C20, fingerprint `8f9e9eeb934b6c01`. All 6 stages run in the environment on test projects.
- **Policy D:** approval (b), `host_isolation = environment`, approved 2026-10-02 23:23:35 UTC through the agent channel after D6's live proof. No real project has the `wsl-runner` route; ProDelivery stays OBSERVE.
- **New in code:**
  - **Agent channel:** the `agent` command channel (`X-Hub-Channel: agent` + `X-Hub-Delegation`) records delegated operations as the agent's.
    - Allowlist `AGENT_COMMANDS`; owner-only decisions are not delegable.
    - Authority- and work-creating commands are allowed on test projects only (`AGENT_TEST_PROJECT_ONLY` + `assertAgentScope`). Every project-naming field must be a test project (projectId/slug, missionId, conversationId, taskId, approval scope), and the check is repeated when an approved command is executed. Fail-safes are allowed everywhere.
    - Approving policy (b) is no longer delegable; revoking it is.
    - An agent's `factory.resume` resumes only BLOCKED or an agent pause. It refuses every NEEDS_OWNER_DECISION, a new time window and the end of the owner's pause.
    - On every channel, `run.start` refuses a `taskId` from another project than the conversation's.
  - **UI–API contract handshake:** 409 `UI_STALE`; fail-safe paths exempt.
  - **Setup orchestrator:** `GET/POST /api/setup`. A declared `cli` is refused on `setup/run`.
  - **Server-side local voice decision:** speaker first, then the transcript. A `voice_utterances` row is the only evidence of a voice confirmation. The page shows the effective threshold (0.55 ceiling).
  - **Local-only fallback** for checks and QA when `codex sandbox` refuses sockets.
  - **Mode hold:** it belongs to the plans that hold it (`holders`: the plan that entered LIVE and the plans confirmed while it was held), and the last holder to close returns the Hub to BUILD_SAFE. A plan that fails to start restores the previous hold, and `mode.set` clears the hold in the same transaction. Plans a boot suspended stay suspended beside a newer plan (`hold.suspended`) and come back, still suspended, when it ends; an explicit resume of one of them rejoins the holders.
    - A boot only suspends it (`suspendedByBoot`).
    - An explicit resume restores it (`restoreModeHold`, open + unexpired plan, voice-first policy); `undoRestore` reverts it if the resume is refused.
    - A manual mode change drops it. The listener writes compare-and-set. `envelopeOfMission` uses exact `json_each` matching.
  - **Export:** NEW binary non-asset files that the project's ignore rules exclude are left out, listed and not applied (`ignoreEligible`).
    - The async `gitCheckIgnored` asks the Windows project, for writer turns only.
    - A git error, or a project without its own .git, leaves nothing out. It is recorded in `ignoreRulesError`, in the run error and in the factory reason.
    - The result is visible in Environments, in the factory evidence and in the bundle.
- **Live (see `M07_LIVE_VALIDATION_RESULTS.md`):**
  - D1 and D2: PASS_LOCAL;
  - D4 Stop: PASS_LIVE (attempt 2/2); reviewer in the environment: PASS_LIVE;
  - D5 Windows Hello + voice profile: PASS_LIVE (owner);
  - D3+D6: PASS_LIVE. Voice confirmation → writer → checks 11/11 → review PASS → QA 5/5 → preview → E2E on mobile, all in ifrim-runner, ending DELIVERY_READY. Bundle `bnd_murl82o1_00afe726c3` awaits the owner. The mission was created, and resumed twice, by the agent; the second resume raised the attempt limit, which is no longer allowed for an agent;
  - D7 ProDelivery read-only: PASS_LOCAL (resolver + cockpit read);
  - D8: PASS_SIMULATED (Lega cloud session NOT_RUN, 0/2).
  - AI budget used: 7/8 (Codex 4, Claude 3).
- **Pre-commit adversarial verification:**
  - round 1 (84 subagents): 11 code findings fixed, 3 rejected-but-real mechanisms fixed anyway, 2 gaps found through the docs closed in code, 34 doc corrections;
  - mutants: 16/16 caught;
  - round 2 (37 subagents) re-reviewed the new code: 11 findings, all fixed. Among them, a forged extra field bypassed the test-project limit; now every field is checked;
  - round 3 (12 subagents): nothing new on the agent channel; 2 low findings fixed (suspended plans reactivated by a new plan; the prompt sentence without .git);
  - mutants: 30/30 caught on the final code (MX-1…8, MM-1…14, MS-1…8).
- **Tests:** V2 596 / 595 PASS / 0 FAIL / 1 skipped (T25 NOT_RUN: file symlink EPERM) on the final code; V1 552 / 551 / 0 / 1 (V1 files unchanged); mutants 30/30 caught (MX-1…8, MM-1…14, MS-1…8).
- **Open:** see `OPEN_ISSUES.md` (M07 section). It covers:
  - OneDrive sync of `.ifrim/private`;
  - the voice profile ACL (inherited read for CodexSandboxUsers);
  - whisper-server `/load`;
  - runner-owned Chromium/Claude binaries;
  - E2E output forgeable by the project under test;
  - reviewer `surface_id` null;
  - leftover workspace dirs;
  - the D8 cloud session;
  - the Lega big-screen proposal.
- **Unchanged:** Demo B bundle `bnd_mupwze7b_e03f70f2d7` awaits the owner. ProDelivery, AROBS and Sales live are untouched, and V1 and OpenClaw are untouched and running.

## 2026-10-02 — M06: Lega 2.0 (voice-first cockpit) + M06-A pipeline readiness (current; read `M06_REPORT.md` first)

- **Code `2.7.0-m06`:** on disk on `v2-milestone-01` over `c8ff6f4`, **uncommitted**. No commit, push, merge, deploy, model, install or download.
- **Live Hub (8011):** still runs `2.6.0-m05` (BUILD_SAFE). `v2/web/dist` already holds the M06 UI, so the Lega screen says "Hub-ul rulează o versiune mai veche" until the owner restarts. Run `node v2/scripts/migration-dry-run.mjs` (schema 5→6) first.
- **M06-B built** (`v2/server/owner/`):
  - owner session: WebAuthn `webauthn.mjs` + `trust.mjs`; HttpOnly cookie `ifrim_owner`; only the token hash stored; UV required; re-authentication window 5 min;
  - versioned product policy `ownerPolicy`: legacy by default; voice-first activated only by the owner (fresh session + exact text);
  - Mission Authorization Envelopes (`envelopes.mjs`): one consumable confirmation of the exact plan; derived grants (`live_grants.envelope_id`) never wider than the plan; `approvals.decideByEnvelope` with decided_via `owner_session`;
  - autonomy OBSERVE / ASSISTED / TRUSTED / HIGH_AUTONOMY_BOUNDED through `factory.attachAuthority`;
  - project cockpit, explain, read-only replay, delta, company map (`cockpit.mjs`);
  - local intent resolver (`intents.mjs`); safe layout catalog (`layout.mjs`); interruptions (`interrupts.mjs`, new gate check `project_frozen`);
  - quiet attention, recommendations, shadow reviews (`advisor.mjs`);
  - local voice gate baseline (`voice.mjs` + `web/src/lib/voiceFeatures.js`, `voiceGate.js`, `web/public/voice-gate-worklet.js`);
  - the `owner` command channel; migration 6 (additive).
- **Voice agent:** the new Lega tool `lega.open_cockpit` opens a project's cockpit from anywhere (context only).
- **M06-B UI:** `#/lega` is the start screen (`screens/Lega.jsx`, `lega/cards.jsx`, `lega/OwnerSetup.jsx`); WebGL2 face with morph targets and an audio-driven mouth (`components/face/LegaFace.jsx`, `lib/faceGeometry.js`).
- **M06-A built:**
  - local-only preview profile: bwrap, own network namespace with loopback only (`wsl-factory-runner.mjs localOnlyArgs`, `scripts/preview-host.mjs`);
  - canary C18, optional coverage `preview-local-only`; canary version changed, so re-attest;
  - the preview goes into the environment when C18 is attested;
  - E2E in the namespace is BLOCKED (no Chromium Linux); the review stays on Windows (tool boundary).
- **Tests:** V2 on the final code 550 / 549 PASS / 0 FAIL / 1 skipped; V1 552 / 551 / 0 / 1. 13 mutants: 12 caught, 1 equivalent (documented). Real-browser E2E with a Chromium virtual authenticator (PASS_SIMULATED). See `M06_TEST_REPORT.md`.
- **Real, no model, no install:**
  - bwrap 0.9.0 present in ifrim-runner; Chromium and Claude absent;
  - C18a–i 9/9 PASS_LOCAL;
  - real preview host in bwrap: HTTP 200, isolation ok, 0 leftovers.
- **Levels:**
  - M06_B_UX_READY in simulation;
  - TRUSTED_SESSION_READY and VOICE_MISSION_FLOW_VERIFIED: PASS_SIMULATED (typed/click; voice confirmation BLOCKED: no local STT);
  - VOICE_FILTER partial (synthetic voices, uncalibrated baseline);
  - M06_A_PIPELINE_READY, PIPELINE_ISOLATION_VERIFIED and REAL_PROJECT_PILOT_ELIGIBLE: not reached.
- **Owner next steps:** dry run → restart → re-attest → `http://localhost:8011/#/lega/setup` (Windows Hello, policy, autonomy) → D3/D4 on a test project → install package decision (`M06_PIPELINE_READINESS.md` §5: A1 apt libs (owner, root), A2 Chromium Linux, A3 Claude Linux + owner login, B1 local STT, B2 ONNX speaker model, C the C3 live Stop probe, D approval (b) last).
- **Unchanged:** Demo B bundle `bnd_mupwze7b_e03f70f2d7` awaits the owner; no merge into `main`; ProDelivery, AROBS and Sales live untouched.

## 2026-10-02 — M05: wsl-runner, R2 work and execution robustness (closed; superseded by M06 above where they overlap)

- **Code `2.6.0-m05`:** committed as `d33e207` (code) + `c8ff6f4` (live results) and pushed by the owner (`origin/v2-milestone-01` = `c8ff6f4`). Lines below that say "uncommitted" are historical.
  - Staged: one `git mv`, `v2/tests/manual/r2-wsl-canary.sh` → `v2/server/environments/scripts/canary.sh`.
  - No commit, push, merge or deploy.
  - The owner ran `migration-dry-run.mjs` (schema 4→5, integrity ok, row counts unchanged) and restarted the Hub from their own terminal on 2026-10-02 02:08 UTC: pid 26992, `2.6.0-m05`, BUILD_SAFE, migration 5 applied. In the live Hub the owner then clicked Inspect, C16 and the attestation (System → Medii de execuție, 2026-10-02 ~02:13 UTC): C16 chatgpt `prolite`, 8 models; attestation **PASS_LOCAL, 71 checks, fingerprint `7b3afa6ae2a7d1f3`** (recorded). (b) not approved, (c) NOT_RUN.
- **Approvals used:**
  - (a): M05 code, no model;
  - real WSL checks without a model: canary, `codex sandbox` on dummy trees, app-server for account and models only;
  - Hub start (2026-10-01 20:55 UTC);
  - read-only subagents.

  **Not granted:** (b) `host_isolation=environment`; (c) live WSL probes; (d) `.wslconfig`.
- **Built:** `v2/server/environments/`:
  - `wsl.mjs`: `wsl.exe -d ifrim-runner -u runner --exec /usr/bin/env -i …`, argv-validated, no shell;
  - `wsl-runner.mjs`: inspect, fingerprint, C16 account, attestation, workspace prepare/export/apply/reap/release/recover;
  - `canary.mjs` + `c14.mjs` (C1–C17);
  - `workspace.mjs` + `tar.mjs`: copy-in, strict tar reader, C14 export validator, conflict-checked apply with rollback;
  - `registry.mjs`: per-project route, never falls back to Windows;
  - `wsl-factory-runner.mjs`;
  - `environment-commands.mjs`, `overview.mjs`.

  Plus:
  - `providers/codex-wsl.mjs` (adapter `codex@wsl-runner`);
  - gate checks `environment_route` and environment-bound `host_isolation`;
  - migration 5 `m05-execution-environments` (additive);
  - git snapshots for projects over 4000 files / 64 MB;
  - Stop during QA commands;
  - RT-07 PRG in browser E2E;
  - warm-up and preflight (off at boot);
  - Lega diagnostics and the attempt rule;
  - the `cli` command channel;
  - UI: System → „Medii de execuție” and „Unde rulează” in the mission panel.
- **Real checks (no model):**
  - canary PASS_LOCAL 71/71 on fingerprint `7b3afa6ae2a7d1f3` (comparable line identical to 2026-10-01);
  - C14 26/26 on real GNU tar archives;
  - C16 PASS (chatgpt `prolite`, 8 models, profiles allowed);
  - Stop of a real `codex sandbox` tree: 0 survivors in 0.9–1.9 s;
  - sandbox sockets: EPERM, so preview/E2E cannot run in the environment and stay on Windows.
- **Found and closed:** a repository `core.fsmonitor` made the Hub's own git calls run a repo program on the host (`tools/git.mjs` now forces it off; test EXP-06 with a positive control). An adversarial review (3 read-only agents) found 2 HIGH and 19 MEDIUM; all fixed with tests, except two documented items (UI nonce for (b), workspace disk quota).
- **Levels:**
  - BUILD_READY reached;
  - LOCAL_ENVIRONMENT_ATTESTED reached and recorded in the live Hub (2026-10-02 ~02:13 UTC, PASS_LOCAL 71 checks), then invalidated on purpose by the new canary version (C15r/C15s reaper check, ~03:50 UTC): re-attest from the UI;
  - WSL_LIVE_SANDBOX_VALIDATED reached live on 2026-10-02 07:20-07:30 UTC (owner clicks, Factory Demo A2, mission `mis_muqmvlvl_f21803e877`): Codex gpt-6.1-sol writer through `codex@wsl-runner`, C14 export applied, checks 6/6 and QA 2/2 in the environment, sonnet review PASS; bundle `bnd_muqn17e6_19ce971a24` OWNER_ACCEPTED by the owner (2026-10-02); C3 live Stop NOT_RUN; see `M05_LIVE_RESULTS.md`. Hub back in BUILD_SAFE, grants revoked;
  - PIPELINE_ISOLATION_VERIFIED and REAL_PROJECT_ELIGIBLE not reached.

  **R2 stays open.** Real projects keep the R2 refusal on every route.
- **Pre-probe review (2026-10-02 ~03:00–04:30 UTC).** The owner said in chat that Claude should do every approval. A read-only workflow (35 agents) checked whether the first live probe (c) could waste an attempt. Verified against the real `ifrim-runner` without a model:
  - **BLOCKER, fixed: `reap.sh` counted itself.** In "all" mode the reaper found its own subshells. v1 gave `found=3 remaining=3` on an empty workspace, so every real writer turn would have ended FAILED after inference: export discarded, lease retained, attempt spent. v2 skips its own ancestors and descendants, and the attestation now exercises it for real (C15r/C15s: decoy processes, `remaining=0`).
  - **BLOCKER, not code: Demo A.** It already contains the accepted fix, so a BUGFIX baseline passes. The probe needs a fresh fixture project: `node v2/scripts/create-factory-fixture.mjs bug-demo --dir ifrim-factory-demo-a2 --name "Factory Demo A2"` (`--name` is new).
  - **Fixed: test output.** `node --test` in the network-off sandbox lost the child processes' output; only `not ok 1 - <file>` came back. Checks now run with `NODE_OPTIONS=--test-isolation=none`, verified for real, including `npm test`. BLOCKED now needs every failing test to show the socket refusal.
  - **Fixed:** every command or file-change approval is auto-declined on the environment route.
  - **Fixed:** tar directory entries. An env-made `.git/` is ignored, and an unchanged sent-in `.github/` passes.
  - **Fixed:** the worker prompt on the environment route names the Linux copy, not the Windows path.
  - **Tests:** new `v2/tests/m05-live-readiness.test.mjs` (LR-01…06); 5/5 mutants killed.
- **Hub restart on the fixes.** Claude restarted the live Hub at ~03:50 UTC from an app terminal tab (`npm run v2:stop; npm run v2`): pid 32192, BUILD_SAFE. The 02:13 attestation is **no longer valid**: the canary version changed because `reap.sh` and `canary.mjs` are now hashed into it. Re-attest from System → Medii de execuție.
- **Live probe (c):** ran 2026-10-02 07:20–07:30 UTC with the owner's clicks (see the levels above and `M05_LIVE_RESULTS.md`). The earlier note that it had not run is superseded.
- **Unchanged:** Demo B bundle `bnd_mupwze7b_e03f70f2d7` awaits the owner; the Demo B draft `mis_mupy0no5_922d2614b0` is SPEC_DRAFT; AROBS, ProDelivery and Sales live untouched.
- **Next (historical, state 2026-10-02 ~04:30 UTC; done since: (c) ran, M05 pushed, Demo A2 accepted):**
  1. **Done:** the migration dry run, the restart onto `2.6.0-m05`, the first attestation, the pre-probe fixes, and the restart onto the fixes.
  2. Re-attest from System → Medii de execuție (Inspect → C16 → attestation). Expect PASS_LOCAL with C15r/C15s.
  3. Run (c) per `M05_LIVE_VALIDATION_PLAN.md` "Precondiții" on Factory Demo A2:
     - create the project with `create-factory-fixture --name`;
     - put it on the route;
     - set LIVE_VALIDATION;
     - create the Codex RW and Claude RO grants (3 attempts, 150 min each);
     - set the mission limits through the API;
     - start the mission.

     It needs the owner's clicks in the UI.
  4. (b) only after the preview/E2E/review isolation decision.
  5. Push of M05: the owner's step if Claude's push is refused.

## 2026-10-01 (night) — M03 closure probes and the R2 environment (current; see `M03_CLOSURE_RESULTS.md`)

- **Probes (owner-approved, owner clicks):** 2.3 PASS_LIVE, 2.5 PASS_LIVE, 2.6 PASS_LIVE. Demo A bundle accepted by the owner. Demo B bundle `bnd_mupwze7b_e03f70f2d7` awaits the owner's decision.
- **Hub:** BUILD_SAFE, no active grants. Two fixes are on disk and load at the next Hub restart:
  - resume after an empty writer turn re-runs IMPLEMENTING (test M03-FAC-28);
  - the diff renderer: no phantom line for added files, /dev/null headers, the no-EOL marker (M03-DIFF-02).
- **R2:** `ifrim-runner` (Ubuntu 24.04, WSL2) is installed:
  - no Windows drives, interop off, `runner` without sudo;
  - Codex 0.159.2 pinned in `/usr/local/lib/codex`, Node 24 in `/usr/local/lib/nodejs`;
  - profiles with `:root` denied and `~/.codex`, `/tmp`, `.env*` denied;
  - ChatGPT login done through the browser flow (device code returned 503).

  The canary passes PASS_LOCAL 40/40 with the real token present.
- **R2 still open:**
  - the Hub `wsl-runner` (clean env, copied workspace, verified patch, C14/C16);
  - the `host_isolation` gate change bound to the environment fingerprint;
  - a live probe through it.
- **Next:** the owner decides on the Demo B bundle; then the `wsl-runner` milestone; merge `v2-milestone-01` → `main` when the owner wants.

## Milestone 04 handoff — 2026-10-01 (current; Sales & lead generation, version `2.5.0-m04`)

- **State:** M04 built in BUILD_SAFE terms with no model, no live collection and no external contact. Committed locally as `2301dcd` on `v2-milestone-01` (over `3c5d202`, which the owner pushed); **not pushed** (push stays the owner's). Levels: BUILD_READY + SIMULATED_SALES_FLOW_VERIFIED. LIVE_RESEARCH_VALIDATED, REAL_CLIENT_DATA_READY, OUTREACH_ENABLED and OWNER_ACCEPTED are not reached.
- **Read first:** `M04_REPORT.md`, then:
  - `M04_IMPLEMENTATION_STATUS.md`, `M04_SALES_ARCHITECTURE.md` (the contract);
  - `M04_DATA_PROVENANCE.md`, `M04_CONTACT_POLICY.md`, `M04_TEST_REPORT.md`;
  - `M04_R2_ISOLATION_OPTIONS.md`, `M03_CLOSURE_PACKAGES.md`.
- **Source map:**
  - `v2/server/sales/`:
    - `sales.mjs`: service: import, identity, evidence, audit, qualification, CRM, proposals, drafts, contact, acceptance, hand-off, follow-ups, Lega summaries;
    - `sales-commands.mjs`: command-bus registrations;
    - pure modules `tabular`, `identity`, `synthetic`, `audit`, `research`, `qualify`, `proposal`.
  - Migration 4 `m04-sales-lead-generation`: 20 additive `sales_*` tables.
  - `/api/sales/*` in `routes.mjs`.
  - ALWAYS_ASK entries in `approval-policy.mjs`: import rollback, proposal approve, draft content, suppression lift.
  - Lega tools `sales_overview`, `sales_lead`, `sales_drafts`.
  - `sales.tick` in the scheduler.
  - Simulator action `sales`.
  - UI `v2/web/src/screens/Sales.jsx` + `screens/sales/*`, `lib/salesLogic.js`, `styles/m04.css`.
  - Fixtures `v2/fixtures/sales/{imports,sites}`.
  - Tests `v2/tests/m04-*.test.mjs`.
- **Do not loosen:**
  - `OUTREACH_DISABLED` (a transport exists only in test hubs: `config.salesTransport` is honoured only with `testMode`);
  - live collection refused (`LIVE_COLLECTION_DISABLED`, audits only on `.test` fixtures);
  - APPROVED_INTERNAL / CONTACTED / WON reachable only through their events (approval, real send or the exact manual-contact sentence, the exact client-acceptance sentence);
  - DO_NOT_CONTACT applied by org, fiscal code, domain and e-mail, also on re-import, lifted only with approval;
  - the hand-off creates only a SPEC_DRAFT (no grant, no run);
  - prices only when CONFIGURED;
  - Lega gets summaries without contact values; from voice only `sales.org.suppress`.
- **Live Hub:** restarted on `2.5.0-m04` on 2026-10-01 16:57 UTC (pid 22644) while idle, after the migration-4 dry-run on a copy (3 → 4, integrity ok, 0 FK violations, 20 new tables, no table lost rows) and the verified backup `bkp_mups0uoj_cd6d3f5269`. It booted in BUILD_SAFE (gate status kept "open"), so the owner must set LIVE_VALIDATION again for probe 2.3. Sales on the real Hub: 0 orgs, empty catalog, outreach DISABLED. Simulator left running on 8012 (pid 13792) with the Sales demo.
- **Owner decisions still open:** Demo A bundle `bnd_mupj3diq_d386324921` (READY_FOR_OWNER_ACCEPTANCE), probe 2.3 (Demo B `mis_mupj3zl4_9970bdd58b`, BLOCKED at the gate since 15:24 UTC), 2.5, 2.6, R2, commit of M04, the Sales catalog (empty on purpose: no confirmed services in the project).

## Milestone 03 handoff — 2026-10-01 (superseded by the M04 handoff above where they overlap)

- **State:** version `2.4.0-m03`, committed on `v2-milestone-01` on 2026-10-01 at the owner's request (the commit right after `6432c5e`; push: see `git status`/GitHub). Built in BUILD_SAFE with fixture providers only:
  - no model run (read-only Claude Code subagents were used only for the pre-commit verification, at the owner's request);
  - commit and push only on the owner's explicit request;
  - at the owner's request (2026-10-01): Playwright 1.61.0 installed as a devDependency (no browser download), the fictive-tree canary (ACLs only in `%TEMP%`, removed) and the fictive sandbox timing ran, demo projects A and B were created.
- **Read first:**
  - `.ifrim/M03_REPORT.md`, `M03_IMPLEMENTATION_STATUS.md`, `M03_RUNTIME_READINESS.md`, `M03_SOFTWARE_FACTORY.md`, `M03_LIVE_VALIDATION_PLAN.md`;
  - the checkpoint `.ifrim/CHECKPOINTS/2026-10-01-milestone-03.md`.
- **New source map:**
  - `v2/server/factory/` (conductor `factory.mjs`, spec, plan, snapshot, diff, integrity, review, runner, fixtures);
  - `v2/server/policy/run-plan.mjs`;
  - `v2/server/runtime/timeline.mjs`;
  - `evaluateHostIsolation` and R3 entries in `v2/server/policy/isolation.mjs`;
  - migration 3 in `v2/server/storage/migrations.mjs`;
  - `v2/web/src/screens/factory/FactoryPanel.jsx`;
  - fixtures `v2/fixtures/factory/` and `v2/tests/fixtures/factory-*`;
  - tests `v2/tests/m03-{readiness,factory,factory-flows,factory-integration,guards,browser}.test.mjs`;
  - E2E: `runE2E` / `validateE2ESteps` in `v2/server/tools/browser.mjs`, `runE2ECriteria` in `factory.mjs` (after the preview, before the bundle).
- **Do not loosen (in addition to the lists below):**
  - the `run_plan` and `host_isolation` gate checks;
  - the effort check after thread/start/resume;
  - the R3 deny entries and their fingerprint;
  - the factory runner only through `codex sandbox` (never Hub rights; BLOCKED otherwise);
  - protected acceptance-test hashes;
  - the review JSON validation bound to the change-set hash;
  - the factory decisions being UI-only (start, accept, reject, resume, extra cycle, findings);
  - Stop All marking every factory mission before interrupting;
  - no automatic resume after restart;
  - Software Factory refusing the Hub itself as a project outside test mode;
  - E2E steps only declarative (no scripts, relative paths only), Chromium with the OS sandbox, only the preview origin reachable.
- **Live:** Live 2026-10-01 (owner-approved): probe 2.1 PASS_LIVE (Codex gpt-6.1-sol · medium fixed Demo A through the factory; turn → first command 14 s) and probe 2.2 PASS_LIVE (Claude review with an explicit `sonnet` after the account default `fable[1m]` was refused before the model; PASS, QA 2/2, bundle `bnd_mupj3diq_d386324921` awaiting the owner's acceptance). Probe 2.3 (Demo B, `mis_mupj3zl4_9970bdd58b`) is prepared and needs the owner's „Aprobă și pornește” (the session safety classifier refuses an agent approving the scope on the owner's behalf); 2.5 and 2.6 NOT_RUN.
- **Open:** R2 (needs a separate environment), `--real-profile` timing (owner's terminal), the live validations (approval package in `M03_LIVE_VALIDATION_PLAN.md` §2.1), the commit. See `OPEN_ISSUES.md` (2026-10-01 later).

## Post-M02 handoff: Lega + M02 verification — 2026-10-01 (superseded by the M03 handoff above where they overlap)

- **State:** version `2.3.0-m03`. Branch `v2-milestone-01` pushed up to `bbe8757` (M01 `f31240b`, M02 `0fb71d2`, `30bfbef` Lega voice + Codex thread/start fix, `dac2db4` Lega stage, `ce819b9` plugins off for voice + grant refund, `bbe8757` Lega full access + web search). `main` still `e9ab563`; nothing merged or deployed. Uncommitted, going into one commit after this doc update: M02 verification fixes, MCP isolation for every Hub Codex process and Claude, one-click approvals, expired grants shown as expired, version bump, these docs.
- **Live evidence (2026-09-30, sanitized test project, owner-approved):** Claude read-only PASS_LIVE (`run_muo6i9og_50c329673c`); Codex FAIL at 14:41 (`run_muo7r9bp_d1b50893f7`, thread/start timeout before inference, fixed in `30bfbef`), then PASS_LIVE workspace-write (`run_muojnivb_b113ce0591`) and read-only (`run_muomogfu_f3b3dcccd7`); Lega voice PASS_LIVE (incl. `lega_muoic63s_69b4539e26`). Codex ACL consent recorded; DENY ACEs exist on the protected paths.
- **Hub now:** 127.0.0.1:8011, BUILD_SAFE, execution gate open (as the owner left it for Lega), 0 active grants, no active run or Lega session. Simulator 8012 separate.
- **Tests:** V2 249 (248 pass, 1 SKIPPED_ENV); V1 552 (549 pass, 1 skipped, 2 live-API timeouts only inside the full suite); build OK; `npm audit` 0.
- **Read first:** `.ifrim/OPEN_ISSUES.md` (2026-10-01), `.ifrim/LEGA.md`, `.ifrim/M02_IMPLEMENTATION_STATUS.md` („După M02”), `.ifrim/M02_TEST_REPORT.md`, `.ifrim/RUNBOOK.md`.
- **New source map:**
  - Lega: `v2/server/runtime/lega.mjs`, `v2/server/providers/codex-realtime.mjs`, `v2/server/policy/lega-policy.mjs`, `v2/server/domain/project-notes.mjs`, `v2/web/src/shell/Lega.jsx`, `v2/web/src/screens/stage/LegaStage.jsx`, `v2/web/src/lib/stageGraph.js`;
  - per-project „Permite execuții”: `v2/web/src/screens/Projects.jsx` (command `project.execution.enable`);
  - one-click approvals: `v2/web/src/screens/Approvals.jsx`;
  - MCP isolation: `CODEX_APP_SERVER_OVERRIDES` and `codexMcpLaunchPlan` in `v2/server/providers/codex.mjs`, the init check in `v2/server/providers/claude.mjs`;
  - tests `v2/tests/m03-*.test.mjs`, manual `v2/tests/manual/lega-mcp-preflight.mjs`.
- **Do not loosen (in addition to the lists below):**
  - the 16 per-process Codex overrides (the M01 12 + `project_doc_max_bytes=0`, `project_root_markers=[]`, `features.plugins=false`, `features.remote_plugin=false`);
  - every config MCP server disabled by name, refusal before start (unaddressable name or project `.codex/config.toml`), `mcpServerStatus/list` fail-closed over every page, stop on any MCP call; Claude stop before the model on any MCP server or `mcp__` tool;
  - web search only for Lega's process (default `cached`); runs keep `web_search="disabled"`;
  - Lega's thread without environments (no shell, no files), voice never approves, every effect needs the owner's click.
- **Open decisions:** R2 (Codex reads other projects' non-protected files by absolute path) before real projects; R3 (`~/.codex/config.toml*` readable); merge to `main`; HUB-018 close or keep. Full list: `OPEN_ISSUES.md`.

## Milestone 02 handoff — 2026-09-30 (superseded by 2026-10-01 above where they overlap)

- **Built by:** Claude Opus 5.5, in BUILD_SAFE. At delivery: no model through the Hub, no subagent/team, no install, commit, push or deploy, no real ACL changed. Since then: M02 is commit `0fb71d2`, pushed on `v2-milestone-01`; live runs happened with the owner's approval; the Codex ACL consent was recorded and the DENY ACEs exist on the protected paths.
- **Read first:**
  - `.ifrim/M02_IMPLEMENTATION_STATUS.md`
  - `.ifrim/M02_SECURITY_READINESS.md`
  - `.ifrim/M02_LIVE_VALIDATION_PLAN.md`
  - `.ifrim/CHECKPOINTS/2026-09-30-milestone-02-done.md` (file list and the commit message proposed at the time; M02 is now commit `0fb71d2`)
- **New source map:**
  - `v2/server/policy/isolation.mjs` (Codex/Claude isolation, consent and fingerprint)
  - `v2/server/sim/` + `v2/scripts/sim*.mjs` (simulator)
  - `v2/server/tools/browser.mjs` (Browser Workspace)
  - `v2/web/src/{lib,components/core,screens/focus,screens/ecosystem}`
  - `v2/web/src/styles/m02.css`
  - tests `v2/tests/m02-*.test.mjs`, manual `v2/tests/manual/codex-*.mjs`
- **Do not loosen:**
  - `~/.codex` must never be denied as a directory: the sandbox runner lives in `.sandbox-bin`, and a child cannot re-allow it.
  - The Codex consent fingerprint.
  - The simulator's fixture-only supervisor.
  - `v2/server` must never run mutating git (M01-NG1).
  - Claude write/shell blocked on native Windows.
  - All M01 billing guards.
- **Key facts** (fictive trees, no model):
  - elevated sandbox denies = persistent inheritable DENY-read ACEs for `CodexSandboxUsers`;
  - they survive later runs;
  - absolute `**` globs work.


## Milestone 01 handoff — 2026-09-30 (historical)

- Built by Claude Opus 5.5, BUILD_SAFE: no model through the Hub, no cloud/scheduled task, commit, push, deploy, install or external message at build time. M01 was later committed as `f31240b` and pushed on `v2-milestone-01`. Read-only research ran as Workflow subagents inside the Claude Code session (the user invoked workflow-authoring with Ultracode on).
- Read first: `.ifrim/NEXT_SESSION.md` (Milestone 01 section + live proposal), `.ifrim/IMPLEMENTATION_STATUS.md`, `.ifrim/V2_TEST_REPORT.md`, `.ifrim/V2_OWNERSHIP_MAP.md`, `.ifrim/V2_AI_ECOSYSTEM_MATRIX.md`.
- New source map (M01): `v2/server/runtime/{commands,command-catalog,lifecycles,router,telemetry,checkpoints}.mjs`, `v2/server/policy/approval-policy.mjs`, `v2/server/domain/{company,chief-of-staff,surfaces,schedules,computer,skills,artifacts,integrations}.mjs`, `v2/server/providers/native-sessions.mjs`, `v2/config/ecosystem/*.json` (audit data; docs generated by `v2/scripts/gen-ecosystem-docs.mjs`), `v2/skills/*/SKILL.md`, tests `v2/tests/m01-*.test.mjs`.
- Storage: migration 2 (`m01-company-runtime-surfaces`) applied to the live DB after a verified copy test; backups `bkp_munfsdem_b334f5f4fd` (post-migration) and the M01 end checkpoint.
- Do not loosen: Fable/`[1m]` refusal, `--setting-sources user`, advisor/fast-mode off, init stop, Codex credit-balance block, Codex fast-mode override, approval catalog floors (billing DENIED and locked).

## V2 rebuild handoff — 2026-09-30

- Built by Claude Opus 5.5 in one session, BUILD_SAFE only: no model, subagent, cloud task, commit, push, deploy or external message.
- Read first: `.ifrim/NEXT_SESSION.md` (V2 section and the live-approval proposal), `.ifrim/RUNBOOK.md`, `.ifrim/REBUILD_DECISIONS.md`, `.ifrim/V2_ARCHITECTURE.md`, `.ifrim/V2_TEST_REPORT.md`, `.ifrim/IMPLEMENTATION_STATUS.md`.
- Source map: `v2/server` (Hub, policies, runtime, providers, backup, storage, HTTP), `v2/web` (UI), `v2/config` (roles, skills, capabilities), `v2/tests` (node:test, fake providers), `v2/scripts` (start/stop/status).
- Runtime: V2 on 127.0.0.1:8011, BUILD_SAFE, gate suspended; data in `.ifrim/private/hub-v2.sqlite`; backups in `.ifrim/BACKUPS/v2`; rebuild snapshots in `.ifrim/BACKUPS/v2-rebuild`; start checkpoint in `.ifrim/CHECKPOINTS/2026-09-29-v2-rebuild-start.json`.
- Git at that time: `main` at e9ab563 plus uncommitted V2 changes (new `v2/`, new `.ifrim/*.md`, updated memory files, `package.json` scripts, `package-lock.json` security update). Now: V2 is committed and pushed on `v2-milestone-01` (up to `bbe8757`); `main` is still `e9ab563`; nothing merged or deployed.
- HUB-018 remains open historically. V2 live validation is its successor: it ran on 2026-09-30 (Claude and Codex PASS_LIVE on the test project). Closing HUB-018 as superseded is your decision.

## Historical handoff — 2026-09-29 (V1, HUB-018)

Updated: 2026-09-29. This is a source and state handoff, not a claim that HUB-018 is complete.

## Exact Workspace

- Project: `C:\Users\mihai\OneDrive\Desktop\Ifrim Digital Proiecte\Ifrim Agent Hub`
- Central registry and rules: `C:\Users\mihai\OneDrive\Desktop\Ifrim Digital Proiecte\PROJECTS.md` and `.ifrim-system\`
- Private GitHub repository: `https://github.com/L3ga2002/ifrim-agent-hub`, branch `main`
- Frontend: `http://127.0.0.1:3004/`; API: `http://127.0.0.1:8004/api/`; isolated OpenClaw Gateway: `127.0.0.1:18790`
- Stack: React/Vite frontend, Node.js API, local SQLite. Codex coordinates; OpenClaw and Claude are specialists.

## Source Map

- `src/main.jsx`, `src/styles.css`: dashboard, coordinated conversation and execution display.
- `apps/api/src/server.mjs`: HTTP API, task/backup gates and execution lifecycle.
- `apps/api/src/conversation-*.mjs`, `provider-runtime.mjs`: persistent conversations and provider runs.
- `apps/api/src/openclaw-*.mjs`, `subscription-*.mjs`, `hub-acceptance-scope.mjs`: isolated Gateway routing, certificates and approval scope.
- `tools/`: controlled startup, audit, checkpoint, certification and maintenance helpers.
- `tests/`: focused contracts and regression tests.
- `.ifrim/NEXT_SESSION.md`, `PROJECT_STATE.md`, `OPEN_ISSUES.md`, `PREVIEW.md`, `AGENTS.md`, `OPENCLAW.md`, `AGENT_HUB_RULES.md`: project memory. Read latest report in `.ifrim/LOOP_REPORTS/`.
- `.ifrim/GITHUB.md`: repository boundaries. `.ifrim/private/`: SQLite, credentials and runtime state; `.ifrim/BACKUPS/`: local archives. Never publish or print secrets.

## Current Evidence And Blockers

- HUB-018 is `in_progress`, not accepted. Exclusive owner lock `LOCK-mumsn13e-2kew8n` remains active. Execution gate was suspended after the latest failed Claude attempt. Verify current DB and gate before any action; prose can be stale.
- Native Codex run `provider-run-eb17a87b-2a74-4f4f-a373-b0e17298a060` completed with `HUB018_CODEX_OK`. Actual route: `openai/gpt-6-luna`, `max`, native Codex, no fallback. Its session is visible in OpenClaw.
- Both local subscriptions and all 23 roles were recertified after an internal Gateway recovery. Gateway receipt was reconciled on the same OS process. This is configuration/auth proof, not Claude task acceptance.
- Latest Claude attempt `provider-run-a6812602-d23c-4796-ac46-249d691117ab` failed **before model admission** because the automatic project backup exceeded its 120-second limit. Its partial ZIP and failed DB record must be preserved. No automatic retry.
- The backup filter in `apps/api/src/server.mjs` was corrected to exclude `BACKUPS`, Hub `private`, `.env*`, and file/directory reparse points. The real ZIP fixture passed before the final reparse-point addition; rerun focused and broader tests, get independent review, reload only the exact idle API, then verify one complete real backup and manifest before another approved Claude probe. Do not increase the timeout as a substitute for diagnosis.
- Latest full serial run: 551 tests, 549 pass, 1 skip, 1 timeout in the continuation API contract (30.3 seconds). That test previously passed alone in 24.5 seconds. Treat latency as open, not a clean full-regression pass. The frontend build passed. The backup ZIP fixture passed after the reparse-point guard; Windows did not permit creation of a file-symlink canary (`EPERM`), so that branch is source-reviewed but not exercised here.
- Real Claude completion, real cancellation, and final browser/API acceptance remain open. Do not mark HUB-018 done from login, source tests or the Codex run alone.
- Dependency audit before this handoff found two `high` advisories, in `nanoid` and `postcss`. Do not present this WIP commit as a release. Review supported fixes separately and rerun build/regression before a release.

## Git And Safety

- The WIP source, tests and reports were committed and pushed to the private repository's `main` after the baseline `5e9025c`. Verify `git status`, `git log` and the remote at the start of work; a GitHub sync does not imply a release or HUB-018 acceptance.
- The repo is private. `.ifrim/private/`, `.ifrim/BACKUPS/`, `.ifrim/tmp/`, `.env*`, generated output and dependencies are ignored. Root OpenClaw bootstrap templates are local artifacts, not project policy; use `.ifrim/AGENTS.md` and `CLAUDE.md`.
- Before changing behavior: checkpoint, task lock, owner separate from reviewer, QA, tests/build/API/browser checks. Preserve all project/client data and other repositories. No API billing, external sends, unattended model launch, destructive cleanup, Git history rewrite or deploy.

## Suggested Opus Task

Review the current HUB-018 state and the backup gate fix independently. Identify P1/P2 issues with exact file/line evidence. Confirm the real backup test, no private/archive inclusion, the idle-API reload boundary and the continuation timeout risk. Return a bounded fix plan to Codex; do not execute Claude/OpenClaw models or mutate private runtime state merely from this handoff.
