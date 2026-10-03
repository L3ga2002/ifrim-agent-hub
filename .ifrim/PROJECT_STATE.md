# Project State - Ifrim Agent Hub

## 2026-10-03 — M07: activation, local voice, live validation (current; read `M07_ACTIVATION_REPORT.md` first)

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

## Current State - 2026-10-01 (Milestone 04, version `2.5.0-m04`, Sales simulated end to end, committed `2301dcd` and pushed by the owner)

M04 adds the Sales department on the existing Hub. It reuses the command bus, approvals, events, the scheduler, missions, the Software Factory and Lega; there is no second orchestrator.

- **Data:** 20 additive `sales_*` tables (migration 4):
  - organizations, aliases, contacts;
  - evidence with labels and freshness;
  - import batches and rows;
  - merges, audits, qualifications;
  - services catalog;
  - opportunities, transitions, versioned proposals and drafts, sends, contact events, client acceptances;
  - follow-ups, suppressions, hand-offs.
- **Import:** CSV (UTF-8/UTF-16/CP1250) and XLSX without new dependencies.
  - Mapping, preview without writes, row report.
  - Chunked idempotent import; same file → same batch.
  - Controlled rollback that archives and keeps orgs edited since.
- **Identity:** CUI checksum, domain classification, matching with reasons and conflicts, owner review for ambiguity, aliases, reversible merges. Different valid CUIs never merge.
- **Research/audit:** live collection disabled. A static audit of local `.test` fixtures gives 14 checks with selector + excerpt; page text is untrusted.
- **Qualification:** deterministic `q-v1` with contributions; unknown ≠ 0; override with a reason.
- **CRM:** validated transitions with actor and reason. CONTACTED/WON come only from events. DO_NOT_CONTACT applies immediately and on re-import.
- **Texts:** versioned proposals without invented prices; drafts with `claimsToVerify`. Approvals are bound to content hashes. Outreach is disabled (fake transport only in tests).
- **Hand-off:** client acceptance (exact sentence) → Software Factory SPEC_DRAFT. No grant, no run. A later proposal marks the hand-off outdated.
- **UI:** Vânzări screen in JARVIS (overview, imports, companies, sheet, pipeline, opportunity, follow-ups, catalog). Lega gets summaries only.

## Previous State - 2026-10-01 (Milestone 03, version `2.4.0-m03`, simulated end to end, not live-validated)

M03 adds the Engineering department on top of M02 + Lega. It reuses the existing missions, runs, grants, approvals, handoff and Lega; no parallel system.

**Runtime readiness:**
- every run sends an explicit model (from `model/list`) and effort (profile BALANCED = `medium`), verified before the turn;
- a per-run phase timeline;
- the R2 host-isolation gate (Codex only on test projects or with the owner's time-limited acceptance);
- R3 deny entries (`config.toml*`, `history.jsonl`; the owner must re-consent to the ACL list);
- bounded pre-inference refunds.

**Software Factory:**
- versioned spec;
- validated plan (one Codex writer, a read-only Claude reviewer on another provider, the Hub runner);
- workspace snapshots and change sets without git writes;
- integrity checks;
- structured review bound to the change-set hash;
- bounded repair with stagnation detection;
- QA on protected acceptance tests through `codex sandbox`;
- preview, then browser E2E on the verified preview (Playwright 1.61.0, Chromium with the OS sandbox, declarative steps from the approved spec);
- delivery bundle;
- durable idempotent dispatch, Stop/pause/restart recovery;
- Engineering UI, and Lega as the voice entry point.

**Evidence:**
- demos A/B/C PASS_SIMULATED; Demo B's E2E criterion runs in the real browser (FAC-02, M03-BR-00…03 PASS_LOCAL);
- canary on a fictive tree PASS_LOCAL (50 checks; R3 DENIED; R2 confirmed open); sandbox per command ~4–6 s on a fictive profile;
- demo projects A and B created and registered as hub-test;
- Live 2026-10-01 (owner-approved): probe 2.1 PASS_LIVE (Codex gpt-6.1-sol · medium fixed Demo A through the factory; turn → first command 14 s) and probe 2.2 PASS_LIVE (Claude review with an explicit `sonnet` after the account default `fable[1m]` was refused before the model; PASS, QA 2/2, bundle `bnd_mupj3diq_d386324921` awaiting the owner's acceptance). Probe 2.3 (Demo B, `mis_mupj3zl4_9970bdd58b`) is prepared and needs the owner's „Aprobă și pornește” (the session safety classifier refuses an agent approving the scope on the owner's behalf); 2.5 and 2.6 NOT_RUN.
- LIVE_SANDBOX_VALIDATED NOT_RUN;
- REAL_PROJECT_READY not reached (R2 open).

Report: `M03_REPORT.md`; traceability: `M03_IMPLEMENTATION_STATUS.md`.

**Git:** M03 is committed on `v2-milestone-01` on 2026-10-01 at the owner's request (the commit right after `6432c5e`; push: see `git status`/GitHub); `main` is still `e9ab563`.

## Previous State - 2026-10-01 (M02 + Lega, version `2.3.0-m03`, live-validated on the test project)

V2 now has the Lega voice assistant on top of Milestone 02:
- GPT-Live voice through the ChatGPT subscription via the installed Codex (`codex app-server`, experimental `thread/realtime/*` methods), no API key;
- Modul Lega, a full-screen living network of the company (Alt+J);
- full access under the owner's control: read tools, the pointing arrow, `how_to`, grant prefill, missions and runs by approval, per-project „Permite execuții”, web search for Lega only (default `cached`).

The M02 verification fixed the real gaps: one tested live-event gate, SSE backpressure, Alt shortcuts that ignore AltGr/IME/numpad, composer limits equal to the server's, safer file listing, a Browser Workspace network layer (code only, Playwright not installed), exact Codex model check, expired grants shown as expired, a real simulator auth error.

Two bugs were found live and fixed:
- approvals only decided and did not start anything → „Aprobă și pornește” in one click and a visible „Aprobate, încă nepornite” section;
- a Codex run called a plugin MCP server (`cua_repl/js`) outside the sandbox → every Hub Codex process now runs with plugins off and every config MCP server disabled by name, checked fail-closed before the turn; Claude runs stop before the model if an MCP server is reported.

Live validation on the sanitized test project (2026-09-30): Claude Code read-only PASS_LIVE; Codex FAIL at 14:41 (thread/start timeout, fixed in `30bfbef`), then PASS_LIVE twice (workspace-write `run_muojnivb_b113ce0591`, read-only `run_muomogfu_f3b3dcccd7`); Lega voice PASS_LIVE.

Tests: V2 249 (248 pass, 1 SKIPPED_ENV); V1 552 (549 pass, 1 skipped, 2 live-API timeouts only inside the full suite); build OK; `npm audit` 0.

Git: branch `v2-milestone-01` pushed up to `bbe8757` (M01 `f31240b`, M02 `0fb71d2`, Lega `30bfbef`, `dac2db4`, `ce819b9`, `bbe8757`); `main` still `e9ab563`; nothing merged or deployed. The latest fixes and version `2.3.0-m03` go into one commit after this doc update.

Hub now: 127.0.0.1:8011, `2.3.0-m03`, BUILD_SAFE, execution gate open (as the owner left it for Lega), 0 active grants, no active run or Lega session; simulator 8012 separate.

This is still not a version ready for autonomous work on real data: every live action needs LIVE_VALIDATION + OPEN GATE + a grant, and every restart returns to BUILD_SAFE. Open decisions and items: `.ifrim/OPEN_ISSUES.md` (2026-10-01).

## State - 2026-09-30 (Milestone 02 built, local version ready for visual evaluation; superseded by 2026-10-01 above)

Milestone 02 put the JARVIS work experience on the V2 foundation:
- shell with palette, mini-assistant and phone navigation;
- Control Room answering "what is happening / what must I decide / where do I continue";
- an original WebGL2 procedural core with 10 state-driven visuals, SVG fallback, context-loss handling and adaptive quality;
- a resizable Focus workspace with inspector, bottom panel and composer;
- missions list/graph;
- the OpenAI/Anthropic catalog with separate facts;
- Browser Workspace and Computer panel in their verified states;
- strict-local voice (NEEDS_SETUP);
- a separate labelled simulator.

Security readiness replaced the prompt-only protection for Codex with OS-enforced permission profiles:
- verified on fictive canaries, 46/46;
- the gate requires your consent to the persistent sandbox ACEs;
- Claude is limited to read-only tools with absolute denials.

At delivery: version `2.2.0-m02`, BUILD_SAFE, gate suspended, no model started, nothing committed or pushed. Since then: M02 is commit `0fb71d2`, pushed on `v2-milestone-01`; the version is `2.3.0-m03`.

Live validation (`M02_LIVE_VALIDATION_PLAN.md`) was done with your approvals on 2026-09-30 on the sanitized test project (see 2026-10-01 above). This is not a version ready for autonomous work on real data.


## Current State - 2026-09-30 (Milestone 01 built, BUILD_READY)

Milestone 01 turned V2 into the foundation of an AI company operating system with OpenAI and Anthropic as equal first-class ecosystems and the Hub as the one control plane. Native capabilities were audited first (OpenAI, Anthropic, open standards; research plus adversarial verification, no inference on your accounts), then V1 and the frameworks (Paperclip, Hermes, Agent Zero, JARVIS UI, OpenJarvis REFERENCE; OpenClaw RETIRE; Playwright REUSE; Playwright MCP INTEGRATE later). Built:
- company runtime: 12 departments, 4 active; goals/objectives; Chief of Staff;
- execution surfaces with real UNSUPPORTED values;
- lifecycle state machines and event envelope v2;
- command bus → approval policy → router → surface;
- checkpoints with native references;
- tool/connector registry;
- memory scopes;
- Agent Skills;
- schedules with one owner per intent;
- computer runtime contract;
- labelled telemetry;
- diagnostic UI (Companie / Ecosisteme / Sistem).

Billing guards were hardened from audit findings. Version `2.1.0-m01`, schema 2, BUILD_SAFE, gate suspended. At delivery no model was started through the Hub and nothing was committed or pushed; M01 was later committed as `f31240b` and pushed on `v2-milestone-01`. Evidence: `.ifrim/V2_TEST_REPORT.md` (Milestone 01), `.ifrim/IMPLEMENTATION_STATUS.md`, `.ifrim/REBUILD_DECISIONS.md` (Milestone 01 decisions). Next: attestations + LIVE_VALIDATION approval (NEXT_SESSION), then Milestone 02 (JARVIS experience).

## Current State - 2026-09-30 (V2 rebuild, BUILD_READY)

Ifrim Agent Hub V2 was rebuilt in `v2/`: a single-coordinator local control plane that runs the unmodified official Codex app-server and Claude Code clients directly. OpenClaw is no longer on the execution path. The single source of truth is `.ifrim/private/hub-v2.sqlite` with an append-only event log. BillingPolicy, the execution gate, action-bound approvals, single-writer leases and a verified backup gate are enforced in the backend. V2 runs on 127.0.0.1:8011 (UI + API) in BUILD_SAFE with the gate suspended. V1 keeps running on 3004/8004 and was not modified; its data was imported into V2 through a reversible batch. No model was started in this rebuild and nothing was committed or pushed. Evidence: `.ifrim/V2_TEST_REPORT.md`, `.ifrim/IMPLEMENTATION_STATUS.md`, `.ifrim/REBUILD_DECISIONS.md`, `.ifrim/V2_ARCHITECTURE.md`. Next: your approval for live validation (see NEXT_SESSION).

- V2 ports: 8011 (API+UI), 3011 (dev UI). V1: 3004/8004. OpenClaw isolated gateway: 18790 (untouched).
- Stack V2: Node 24 built-ins only on the server; React 18 + Vite 8 + lucide-react for the UI; no new dependencies.

## Current State - 2026-09-29

HUB-018 is in progress, not accepted. Native Codex Luna/max produced the expected marker with no fallback. The isolated Gateway and both subscriptions/all23 roles were recertified, but the latest Claude attempt failed before model admission because the backup gate timed out. Gate is suspended; no general execution activation. Backup filter and reparse-point protections have a reviewed local source fix and passing ZIP fixture, but still need an idle-API reload and complete real backup. The latest broad regression had 549 pass, one continuation API timeout and one Windows privilege skip; build passed. See `.ifrim/OPUS_HANDOFF.md` and the newest HUB-018 report for exact evidence. Older sections below are historical.


## Authoritative Checkpoint - 2026-09-29, Native Readiness Unknown

- Supersedes older PID/readiness notes below. HUB-018 is NOT operationally accepted. Isolated Gateway23596/18790 remains source-receipted; API22828/8004 replaced30808 through existing hidden supervisor4852 after SQLite leases0/runs0. Frontend3004 is Vite dev, not production preview.
- Backup backup-mululwl8-9lomtj123files0skipped and consistent isolated checkpoint2026-09-28T22-58-34.718Z integrityOK protect this work. No other project/global/vendor/Git history edits or PC restart.
- Owner full serial regression186/186 PASS and production build PASS. Reviewer source GO; independent transport QA48/48 PASS, connection classification5 persistent plus4 additional simulated checks PASS. New connection helper is now loaded by API22828.
- Native creation-only request6:dfcb6fab-d660-49f5-ad5d-949386c36410 SUCCEEDED after1780436ms (~29m40s), sessionId6273c92f-f187-48ea-a7df-a13d78f2b543, exact key agent:ifrim-backend:ifrim-hub:d79b32fc58d1542d5d5439f8edd1d8a2. runStarted:false; no agent/model submitted.
- Read-only describe/chat.metadata confirm the same session, Hub cwd, Luna/max, read-only, native Codex, user-pinned approved subscription and webSearch:false. Actual transport observer coverage confirmed:66 records/8 PIDs,8 initialize OK,7 model/list OK. These are not executed task acceptance.
- Fresh subscription certification PASS for Codex+Claude/all23 roles. A single reviewed120s existing-session ensure was stopped BEFORE send by its readiness guard: health/status omitted modelRuntime. This means UNKNOWN, not demonstrated degradation/auth failure. Official success publishes degraded:false/pendingAgents:[]; undefined projection can also follow runtime invalidation or closure. No create/agent request was sent by that ensure.
- Execution gate re-suspended; certificate evidence preserved. No reuse branch implemented: sessions.create has an official existing-session ensure path, not necessarily recreation. Do not bypass idle/binding checks, increase timeout blindly or treat omitted modelRuntime as ready.
- Remaining: diagnose why publication readiness disappears and severe cold preparation takes~30m; then one bounded Hub-native Codex turn, Claude turn, real cancellation and clicked actual Hub-session visibility. Main Luna/max chat and pure tests do not satisfy these gates. No automatic retry or API billing fallback.
- Owner, reviewer and QA evidence is in LOOP_REPORTS/2026-09-29-hub-018-finalization-plan.md. Preserve existing session/history; reconcile before any next native action.

## Current Override - 2026-09-29

Latest verified override: comparative Gateway29340 READY on18790, API30808 healthy, frontend3004 Vite dev. BOM-free receipt writer and original-receipt checkpoint verified. Owner serial171/171 PASS/build PASS; independent QA67/67 and16/16 contract/BOM PASS. Gate remains suspended. Latest native creation-only request6:b05a8477-8082-4515-8b36-38d80e7fe4e9 failed80420ms at01:35:05.941 EEST with codex app-server request timeout; postfailure exact Hub key absent and health/status runtime not degraded. No agent/model submitted. Additional fresh-home initialize-only with ephemeral/stdio arguments PASS1657ms, child11508 closed, no credentials/model. This does NOT resolve the native integration blocker; no further creation retry.

HUB-018 is IN_PROGRESS, not operationally accepted. Hub API8004 recovered as PID30808; frontend3004 remains available. All23 isolated subscription roles previously certified; user browser login completed. Gate remains suspended after native Codex acceptance failed before agent admission.

Owner repaired safe RPC diagnostics including remote-unknown lease path; full regression169/169 PASS and build PASS. Independent focused QA67/67 PASS. Managed Codex0.155.1-win32-x64 initialize-only probe passed928ms in a clean private home, no auth/model, owned child closed. This does not verify the real backend home or an executed task.

Diagnostic-SDK startup experiment PID19068 failed native lease-heartbeat readiness5000ms at entry-not-observed after480084ms process uptime. Process exited, children0 and listeners0 confirmed. Worker inheritance hypothesis was disproven by explicit native execArgv. Only added SDK sink bootstrap was rolled back; isolation/hidden policy/receipt safeguards and API diagnostics remain. Sanitizer is staged, not loaded. Fresh checkpoint2026-09-28T22-08-28.107Z integrityOK; one comparative controlled startup is in progress. Never disable native lease or mark completion from tests/login.

## Current override - post-crash native acceptance, 2026-09-28

Approved isolated settlement/audits and subscription certification passed for both providers/all23 roles. Isolated Gateway18790 actually running with protected receipt/logs; global18789 stopped but scheduled-start risk remains. API8004/frontend3004 recovered. Owner115/115 pure regression and production build PASS; reviewer source-only GO and independent focused QA PASS.

HUB-018 is NOT complete: bounded Codex creation timed out120s before agent submission. Subsequent read-only native list found no Hub session; late creation is not ruled out. Execution gate suspended, credentials/evidence/history preserved. Claude turn, real cancellation, clicked session visibility and provider usage/billing outcome are unverified. Earlier expired-OAuth/gateway-not-started notes below are historical, not current state.

## Final local closeout - 2026-09-28

Local hardening verified: owner 107/107 PASS (outside-project workflow fixture excluded), independent QA 22/22 PASS, reviewer GO source-only, build/diff checks PASS and API reloaded. Pre-start audit rejects the preserved historical API profile; legacy execution/compiler use receipt-bound executable and environment. Backup backup-mul369op-pelx7k contains 93 files with zero skipped. Operational BLOCKED remains: ambient no-API isolation, OpenAI OAuth and native session-create acceptance incomplete. Gateway stopped, gate suspended, scheduled task Ready (disable Access denied/elevation cancelled). Do not claim live completion or zero API billing.


## Current override - HUB-018, 2026-09-28

Final status: BLOCKED. Controlled Gateway stopped and subscription gate suspended after logs exposed automatic setup-inference probes on the historical OpenAI API route (403). All three Hub session-create attempts failed, latest timeout 120s; no verified Hub native turn. OAuth device login cancelled for safety. Local regression 105/105, independent pure QA 20/20 and build passed. Zero active Hub runs/leases; implementation lock released. Audit ambient no-API routing before restart/reactivation; provider billing outcome is unverified.

Global OpenClaw 2026.9.6 now has all 23 GPT-6 role defaults applied (6 Luna/max, 13 Sol/high, 4 Astra/xhigh), with no fallback and zero API directory drift. Actual task routing remains adaptive. Native Claude subscription certification passed for a controlled Gateway; restarts require recertification. OpenAI subscription authentication requires reconnection after OAuth 401. Two bounded acceptance attempts produced no verified model result (creation principal mismatch, then creation timeout). HUB-018 is not live-complete. See NEXT_SESSION and the HUB-018 loop report before launching anything. Existing history and dirty source are preserved; no client-project edits, commit, push or deploy.

- Project: Ifrim Agent Hub
- Path: C:\Users\mihai\OneDrive\Desktop\Ifrim Digital Proiecte\Ifrim Agent Hub
- Stack: Node.js API + SQLite local database + React + Vite dashboard; local-first coordination hub for Codex, OpenClaw, and Claude Code
- Frontend preview: http://127.0.0.1:3004
- Backend API: http://127.0.0.1:8004/api/
- GitHub repo: L3ga2002/ifrim-agent-hub
- Status: v1 operational; hardening and recovery verification
- Last updated: 2026-09-26

## Current Model Policy

- HUB-018 (2026-09-28): conversation gateway integration is implemented locally, but live activation is BLOCKED pending native subscription/noAPIbilling certification and approval of the adaptive global candidate. Requested versus verified provider/model/reasoning is now visible. No global config update was applied; historical packet policy remains unchanged.

- HUB-016 (2026-09-27): GPT-6 OpenAI-only policy. Luna Max is the explicit default; Sol/Astra reasoning is adaptive (low for routine, medium for moderate, high for complex, xhigh for demanding risk), with max/ultra only on explicit request. Model and effort are selected independently.
- Explicit Ultra is accepted for Sol/Astra only. Claude is disabled, not removed.
- All 23 agent roles remain visible. Hub model settings are separate from global runtime defaults; July GPT-5.6 probes do not verify GPT-6.
- See `.ifrim/MODEL_POLICY.md` for active routing and runtime verification limits. Historical V1 evidence below is retained and does not override this policy.

## Purpose

Ifrim Agent Hub is the local coordination dashboard for IfrimDigital projects.

It exists to prevent context loss between Codex threads and specialist agents. It should read project memory, show current project state, create task packets, track locks, save snapshots, and eventually invoke OpenClaw/Claude safely.

## Initial Product Goals

- One dashboard for all IfrimDigital projects.
- ProDelivery-first workflow because ProDelivery is priority.
- Read-only scanner before any automation.
- Persistent task queue and locks before agent implementation.
- Generator/evaluator split for important work.
- Preview/live QA visibility for app changes.
- Snapshot support when Catalin likes a version.

## Phase

Current phase: Local coordination control plane with GPT-6 OpenAI-only routing, persistent continuation, task queue/locks, Prompt Compiler and approval-gated agent packets. OpenClaw GPT-6 live verification is pending.

Current priority screen:

- ProDelivery context + Phase 2 restaurant-panel task queue.
- Persistent local Task Queue + Locks stored in `.ifrim/private/agent-hub.sqlite`.
- Hub audit trail for task/lock create/update/release events.
- Manual Agent Run packet flow stored in `agent_runs`.
- Agent packets include memory checklist, safety rules, active locks, verification checklist, and manual command previews for OpenClaw/Claude.
- Automatic backup gate before new agent packets, stored under each target project's `.ifrim/BACKUPS/`.
- Safe OpenClaw/Claude bridge diagnostics are live in the Hub UI and API.
- Diagnostics verify CLI/script availability and safe version checks only; real agent/review execution remains manual and gated.
- Central agent directory is live through `GET /api/agent-directory` and the Hub UI.
- The directory reads `.ifrim-system/AGENT_TEAM_V2.json`, displays all 23 agents, model/reasoning/fallback, and detects drift against `~/.openclaw/openclaw.json`.
- OpenClaw stable `2026.7.1` is installed and runs visibly through Node `24.16.0`.
- GPT-5.6 Terra, Sol and Luna passed fresh OAuth/Codex harness probes without fallback on 2026-07-12.
- Stable 2026.7.1 probes passed for Sol/Ultra, Terra/Ultra and Luna/Max without fallback on 2026-07-14.
- Per-task routing supports coordinator-gated Ultra only for explicit critical/P0 tasks on Sol/Terra; Luna is capped at Max and no agent has Max/Ultra as a permanent default.
- The stale Codex app-server path and conflicting legacy plugin metadata were repaired without deleting sessions; the active Codex CLI is `0.144.2`.
- Workflow packet v2 exposes `Workflow stage: OWNER` in the initial packet and separates task-risk keywords from agent role names to prevent false Sol/XHigh escalation.
- Stable E2E workflow `HUB-STABLE-FLOW-2-20260714` completed owner -> reviewer -> QA with three separate approvals: Terra/medium, Terra/high and Luna/low, all without fallback and without automatic launch.
- Vite ignores `.ifrim` runtime/backup files, so OneDrive ZIP locks no longer crash preview port 3004 during the mandatory backup gate.
- The Windows tray now self-recovers a missing API or web process with a 30-second retry cooldown; controlled process-stop verification restored port 3004 and HTTP 200 automatically.
- On 2026-07-11 Prompt Architect passed on Terra/medium and Security Reviewer passed fail-closed on Sol/xhigh, both without fallback.
- The existing main Telegram session was migrated in place to Terra/medium without deleting history or delivering the internal test response externally.
- Central Design System rule created at `.ifrim-system/DESIGN_SYSTEM.md`.
- Central Prompt Architect / Task Compiler rule created at `.ifrim-system/PROMPT_ARCHITECT.md`.
- Prompt Compiler is live in the Hub UI and API. It compiles natural-language requests into reviewable drafts and never starts implementation automatically.
- Draft conversion is explicit, revision-safe, idempotent, atomic under concurrent requests, and preserves the complete compiler payload in generated task packets.
- Prompt Architect is configured with no callable tools; secret-like input is rejected before persistence.
- Design System Governance is live in the Hub UI, API, routing and generated task packets.
- UI/design tasks automatically include `ifrim-design` + `ifrim-frontend`, independent frontend review, QA, the central Design System file and project-specific visual direction.
- Snapshot/version tracking is live with candidate and approved states, real backup archives, idempotent creation and blocked restore plans.
- Restore execution does not exist yet; every future restore must require a new current-state backup and Catalin's explicit confirmation.
- Explicit execution approval gate is live with pending/approved/changes-requested/rejected decisions, expiry, revision conflicts and packet-version binding.
- Approval records unlock permission only; they do not invoke agents yet.
- Controlled execution preflight is live and fail-closed: it rechecks approval, packet, task, backup archive, project boundary and locks immediately before any possible launch.
- Preflight-only audits remain available, while actual launching is restricted to the explicit manual OpenClaw endpoint; Claude/Codex launching and unattended execution remain disabled.
- Manual one-task-at-a-time OpenClaw launcher is implemented behind exact approval, confirmation checkbox and a fresh fail-closed preflight.
- Launcher captures and redacts output/errors, applies the selected adaptive 30-minute/2-hour/6-hour ceiling, interrupts stale runs after server restart and prevents parallel executions.
- Codex-owned tasks remain manual; scheduled and unattended execution remain disabled.
- Per-task model routing is live: Agent Hub persists and passes explicit `--model` and `--thinking` overrides to OpenClaw.
- Routing uses Luna/low for eligible low-risk QA/prototype work, Terra for normal implementation and Sol for deep-risk work.
- Windows tray runtime is installed as `Ifrim Agent Hub`, starts at user logon and keeps the local dashboard/API visible and controllable without a console window.
- `GET /api/projects/<slug>/continuation` rebuilds project stage, focus, active task, routing, backup, approval, attempt, snapshot, locks and next action without starting execution.
- Continuation selection is reconciled from persisted task, agent-run and workflow-transition state: a current actionable task wins only when newer than the latest completion or actively running; otherwise the latest completed workflow is shown with `define_next_task`.
- The dashboard exposes a `Continuare coordonata` panel and owner -> independent reviewer -> QA workflow state.
- Workflow launch remains approval-aware and fail-closed for high-risk operations even though OpenClaw model entitlement is now verified.
- Confirmed provider results now drive automatic packet preparation under the existing approval gates; launches remain manual.
- `HUB-014` Workflow Orchestrator v1 is implemented: owner, reviewer, QA and fix stages have separate packets/approvals, structured fail-closed verdicts, audited transitions, maximum three fix cycles and stage retry after provider failure.
- Live E2E evidence: owner -> reviewer -> QA completed after one controlled fix cycle. Every stage used a separate packet and approval, required a structured verdict/summary, and prepared the next stage without auto-launching it.
- `HUB-014-SMOKE-2` is `done`; final QA `run-mrhtxuu3-frtjxe` passed on Luna/low without fallback. Continuation now reports phase `done`, all three stages complete, six audited transitions and `automaticLaunch: false`.
- Local browser QA passed on desktop and 390px mobile with no page overflow or console errors.
- Adaptive execution profiles are live: `normal` 30 minutes, `complex` 2 hours and `deep` 6 hours. Selection is automatic from task priority/risk and is persisted per attempt.
- Long runs record a process-liveness heartbeat every minute and receive 15-minute checkpoint instructions for implementation work. The heartbeat is explicitly not treated as proof of semantic progress.
- `HUB-006` Design System enforcement in Hub packets and UI is implemented.
- `HUB-007` Prompt Architect / Task Compiler flow is implemented.
- `HUB-008` Agent Directory / full agent catalog is implemented.
- Separate private Git repository `L3ga2002/ifrim-agent-hub` was created for this project; private runtime state, backups and environment files are excluded.
- Recovery verification passed on 2026-07-13: Agent Hub preserved 17 tasks, 45 agent runs, 37 recorded backups, 2 snapshots and 29 workflow transitions across restart.
- Runtime singleton verification passed: one Hub API process, one Hub frontend process, one visible OpenClaw launcher and one gateway process; ports 3004, 8004 and 18789 are listening.
- `openclaw health --json` returned `ok: true`; Telegram is configured, running and connected, with no plugin errors.

Not approved yet:

- automatic source edits
- automatic commits/push/deploys
- unattended destructive operations
- real external sends
- automatic Claude/Codex invocation from Hub UI
- automatic agent execution from generated packets

## Agent Hub

- Agent Hub rules: .ifrim/AGENT_HUB_RULES.md
- Loop reports: .ifrim/LOOP_REPORTS/
- Agent reports: .ifrim/AGENT_REPORTS/
- Codex remains coordinator; OpenClaw and Claude Code are specialist tools.

## Notes

- Update this file whenever architecture, ports, scripts, auth, deployment, or product status changes.
