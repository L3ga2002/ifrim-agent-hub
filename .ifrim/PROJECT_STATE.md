# Project State - Ifrim Agent Hub

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

Billing guards were hardened from audit findings. Version `2.1.0-m01`, schema 2, BUILD_SAFE, gate suspended. No model was started through the Hub, nothing was committed or pushed. Evidence: `.ifrim/V2_TEST_REPORT.md` (Milestone 01), `.ifrim/IMPLEMENTATION_STATUS.md`, `.ifrim/REBUILD_DECISIONS.md` (Milestone 01 decisions). Next: attestations + LIVE_VALIDATION approval (NEXT_SESSION), then Milestone 02 (JARVIS experience).

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
