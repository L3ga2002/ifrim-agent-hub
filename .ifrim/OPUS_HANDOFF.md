# Ifrim Agent Hub - Opus Handoff

## 2026-10-02 — M05: wsl-runner, R2 work and execution robustness (current; read `M05_REPORT.md` first)

- **Code `2.6.0-m05`:** on disk on `v2-milestone-01` over `895c215`, **uncommitted**.
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
  - WSL_LIVE_SANDBOX_VALIDATED, PIPELINE_ISOLATION_VERIFIED and REAL_PROJECT_ELIGIBLE not reached.

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
- **Live probe (c) NOT run.** The session's permission layer refused further live-Hub actions (reason "Production Deploy"), and Claude stopped there. To run it, the owner does the steps in `M05_LIVE_VALIDATION_PLAN.md` ("Precondiții").
- **Unchanged:** Demo B bundle `bnd_mupwze7b_e03f70f2d7` awaits the owner; the Demo B draft `mis_mupy0no5_922d2614b0` is SPEC_DRAFT; AROBS, ProDelivery and Sales live untouched.
- **Next (state 2026-10-02 ~04:30 UTC):**
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
