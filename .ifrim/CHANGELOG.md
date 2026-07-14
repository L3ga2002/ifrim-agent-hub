# Changelog - Ifrim Agent Hub

## 2026-07-14

- Promoted OpenClaw from `2026.7.1-beta.2` to stable `2026.7.1` after local recovery backups.
- Pinned the visible gateway and Agent Hub tray services to compatible Node `24.16.0` while the system Node remains below the new minimum.
- Ran `doctor --fix`, migrated 230 Codex bindings, archived the conflicting legacy `@openclaw/codex@2026.5.27` install index and retained the current SQLite `2026.7.1` record.
- Refreshed the Codex app-server path to CLI `0.144.2`.
- Verified Sol/Ultra, Terra/Ultra and Luna/Max through ChatGPT OAuth and the Codex harness with no fallback.
- Added router v2 support for coordinator-gated Ultra on explicit critical/P0 Sol/Terra tasks; permanent agent defaults remain below Max.
- Separated task-risk text from agent role names so `ifrim-prompt-architect` no longer triggers a false architecture-risk escalation.
- Added `Workflow stage: OWNER` to initial packets and bumped controlled packets to `workflow-orchestrator-v2`.
- Completed live owner -> independent reviewer -> QA verification with separate approvals on Terra/medium, Terra/high and Luna/low; all stages passed without fallback or automatic launch.
- Excluded `.ifrim` backup/runtime files from Vite watching to prevent OneDrive `EBUSY` ZIP locks from terminating preview port 3004.
- Added tray self-healing with a 30-second cooldown and verified automatic frontend recovery after a controlled Vite process stop.

## 2026-07-13

- Synchronized central and project memory with the operational v1 state, approval-gated OpenClaw execution and adaptive 30-minute/2-hour/6-hour profiles.
- Created a pre-change local recovery archive excluding secrets, private SQLite state, dependencies and generated folders.
- Initialized the separate private GitHub repository `L3ga2002/ifrim-agent-hub`, committed the v1 source and pushed `main`.
- Added Git exclusions for backups, private runtime state, environment files, generated QA output and build artifacts.
- Restarted Agent Hub and verified persistent recovery of 17 tasks, 45 agent runs, 37 recorded backups, 2 snapshots and 29 workflow transitions.
- Restarted OpenClaw visibly, removed one stale paused console and verified exactly one gateway process, one visible launcher and a healthy Telegram connection.

## 2026-07-12

- Restored ChatGPT OAuth as the primary OpenAI auth route and removed the accidentally forced direct API runtime from GPT-5.6 models.
- Verified Terra/medium, Sol/xhigh and Luna/low through the Codex harness with no fallback.
- Enabled Luna for low-risk QA and prototype agents; production implementation remains on Terra and high-risk review remains on Sol.
- Implemented approval-aware owner -> reviewer -> QA/fix orchestration with persisted stage/cycle metadata and workflow transition audit records.
- Added fail-closed verdict parsing, three-cycle repair limit, manual verdict fallback and same-stage retry for provider/timeout failures.
- Added workflow history, stage-aware runner labels, polling, retry controls and correct desktop/mobile stage states to the dashboard.
- Completed the live owner -> reviewer -> fix -> reviewer -> QA workflow smoke test with separate approvals and no automatic launches.
- Fixed continuation after workflow completion so it shows the completed task, all stages complete and the correct next action instead of a stale QA-ready state.
- Updated and synchronized the QA agent contract for Luna/low, read-only browser-oriented verification and correct in-flight QA task semantics.
- Added adaptive normal/complex/deep execution profiles with 30-minute, 2-hour and 6-hour hard limits.
- Persisted execution profile and process heartbeat per attempt, added long-task checkpoint instructions and exposed the policy in the runner UI.

## 2026-07-11

- Implemented HUB-014 Windows system-tray launcher with online/offline health, open, restart, stop, single-instance protection and logon autostart.
- Implemented HUB-015 read-only project continuation endpoint and dashboard panel for `continua <project>` context recovery.
- Implemented HUB-016 fail-closed owner -> independent reviewer -> QA workflow state with backup/approval/provider gates and no automatic model launch.
- Added the central `.ifrim-system/CONTINUATION_PROTOCOL.md` contract and connected it to thread bootstrap rules.
- Verified all five project continuation endpoints, invalid-slug rejection, build, npm audit, API/web health, Windows task/tray state and desktop browser rendering.
- Implemented HUB-013 per-task Sol/Terra/Luna model and reasoning routing.
- Added explicit OpenClaw `--model`, `--thinking` and `--message-file` overrides to packet previews and the manual launcher.
- Added visible desired/effective model, Luna fallback reason and persisted execution model/reasoning.
- Verified Terra/high, Sol/xhigh and Luna/low desired routing without invoking a model; Luna correctly falls back to Terra while entitlement is blocked.
- Implemented HUB-012 manually triggered, one-task-at-a-time OpenClaw execution launcher.
- Added exact approval/revision binding, confirmation requirement, second preflight, global concurrency guard and 30-minute process-tree timeout.
- Added persisted/redacted output and errors, interrupted-run recovery and responsive manual launch controls.
- Verified fail-closed behavior without launching a model or consuming AI usage: no confirmation returns 400; pending approval returns 409; no manual run record is created.
- Implemented HUB-011 controlled execution preflight with a fail-closed seven-check audit.
- Preflight validates current approval, packet state, task/project binding, on-disk backup, managed project boundary and conflicting exclusive locks.
- Added execution-attempt audit trail and responsive Runner control panel.
- Runtime remains hard-disabled in `preflight_only` mode; no process launch endpoint exists.
- Implemented HUB-010 explicit execution approval gate with persistent pending/approved/changes-requested/rejected decisions.
- Added 24-hour expiry, optimistic revision checks, exact packet binding, duplicate-request protection and audit events.
- Added responsive approval UI with Aprobă, Cere modificări and Respinge controls; change/reject require a reason.
- Kept agent execution disabled even after approval; no decision was recorded on Catalin's behalf during verification.
- Implemented HUB-009 snapshot/version tracking with real backup archives, candidate/approved states and one approved version per project.
- Added sequential and concurrent duplicate-request protection so retries reuse one snapshot and one backup.
- Added a non-executable restore plan that requires explicit approval and never modifies project files.
- Added responsive snapshot creation, approval and restore-plan controls to the Hub dashboard.
- Verified API, build, backup creation, duplicate protection, desktop/mobile layout and clean browser console.
- Implemented HUB-006 Design System Governance across task classification, agent routing, packet generation, API and dashboard.
- Added project-specific visual direction, mandatory premium UI checks and pattern-inspiration anti-copy rule.
- UI tasks now route through `ifrim-design + ifrim-frontend`, independent frontend review and QA without enabling automatic execution.
- Added `GET /api/design-governance` and a responsive Design System Governance panel.
- Verified a real HUB-006 packet, automatic backup, desktop/mobile rendering and clean browser console.
- Implemented HUB-007 Prompt Compiler with persistent drafts, explicit review, clarification gates, and explicit task conversion.
- Added atomic/idempotent draft conversion, optimistic revision checks, project-switch isolation, full payload preservation, and duplicate-request protection.
- Added secret-like input blocking and isolated Prompt Architect with `tools.allow: []` in both the central registry and live OpenClaw config.
- Added complete editable scope, non-goals, assumptions, risks, lock, approval, acceptance, and regression fields to the Hub UI.
- Verified concurrent conversion, packet fidelity, automatic backup, desktop/mobile layout, and clean browser console.
- Revalidated global routing after subscription reset: Terra/medium and fail-closed Sol/xhigh both passed without fallback.
- Migrated the existing main Telegram session in place from GPT-5.5 to Terra/medium without external delivery or history deletion.
- Added durable Sol/Terra live-verification metadata to the central agent registry and Agent Hub UI.
- Fixed Agent Directory Luna label overflow and translated the live-verification note into Romanian.
- Fixed page-level horizontal overflow at 390px mobile width while keeping the wide agent table locally scrollable.
- Fixed React root reuse during Vite hot reload and verified a fresh browser tab with no console warnings/errors.
- Rebuilt successfully and verified 23 configured agents, zero drift, API/preview health, visible gateway, and connected Telegram.

## 2026-07-10

- Added GPT-5.6 routing registry integration from `.ifrim-system/AGENT_TEAM_V2.json`.
- Added `GET /api/agent-directory` with all 23 agents, model, reasoning, fallback/fail-closed policy, and OpenClaw config drift detection.
- Added Agent Directory dashboard table and routing summary.
- Hardened diagnostic redaction for bearer tokens, JWTs, API keys, OAuth values, secrets, and passwords.
- Clarified that CLI/config readiness does not prove model entitlement or available subscription usage.
- Recorded OpenClaw beta `2026.7.1-beta.2`, Luna disabled status, verified backups, canary results, and rollback runbook.
- Marked `HUB-008` complete without enabling automatic agent execution.

## 2026-07-08

- Added `GET/POST /api/bridge-diagnostics` for safe OpenClaw/Claude availability diagnostics.
- Added dashboard `Bridge diagnostics` panel with OpenClaw/Claude provider status, blocker details, manual command previews, and closed auto-execution gate.
- Fixed Windows `.cmd` shim execution for safe CLI version checks.
- Added `opus` profile support to `tools/claude-review.ps1` so generated high-priority Claude review commands are valid.
- Improved backup gate so locked files are recorded as manifest warnings instead of failing the whole backup.
- Marked `HUB-004` done and added `HUB-008` for Agent Directory / full agent catalog.
- Added central `.ifrim-system/DESIGN_SYSTEM.md` to define premium IfrimDigital UI/UX standards.
- Added central `.ifrim-system/PROMPT_ARCHITECT.md` to turn Catalin's natural-language requests into professional task packets.
- Updated central thread bootstrap so UI/design work must read the Design System and vague/broad requests must use Prompt Architect.
- Added `ifrim-prompt-architect` to the agent catalog.
- Expanded `ifrim-design` responsibilities with palette, typography, visual QA, and inspiration-source rules.
- Updated Agent Hub architecture with Prompt Intake / Task Compiler and Design System Governance layers.
- Added Agent Hub queue task `HUB-006` for Design System enforcement in packets and UI.
- Added Agent Hub queue task `HUB-007` for Prompt Architect / Task Compiler flow.

## 2026-07-07

- Added automatic backup gate before new agent packets.
- Added `backups` table and `GET/POST /api/backups`.
- Added backup metadata to `GET /api/hub-state`.
- Added UI backup panel and packet backup banner.
- Updated packet prompt to include `Backup gate` and block implementation if backup is missing/failed.
- Tested on `IfrimDigital Website` with `WEB-HUB-001`; backup `backup-mrb2v7wf-9dpi7k` created 163 files before packet generation.
- Added manual Agent Run packet flow with persistent `agent_runs`.
- Added API endpoints for `GET/POST /api/agent-runs` and `GET /api/agent-runs/:id`.
- Added packet generation from tasks with memory checklist, safety checklist, active locks, verification checklist, and command previews.
- Added dashboard Agent Runs and Packet preview panels.
- Generated packet for `PD-HUB-001` showing OpenClaw owner/reviewer commands and Claude review command.
- Marked `HUB-003` done and queued `HUB-004` for safe OpenClaw/Claude bridge diagnostics.
- Added persistent local SQLite storage at `.ifrim/private/agent-hub.sqlite`.
- Added `tasks`, `locks`, and `hub_events` tables.
- Added API endpoints for hub state, task create/update, lock create/release, validation, duplicate active lock protection, and audit trail.
- Added dashboard Task Queue, Locks, Task nou, Lock nou, and Audit trail sections.
- Seeded `PD-HUB-001` and advisory lock `LOCK-PD-RESTAURANT-PANEL` for ProDelivery Phase 2 restaurant panel.
- Added next queued task `HUB-003` for Manual Agent Run packet flow.
- Verified `npm run build`, `npm audit`, API validation, duplicate lock protection, frontend HTTP 200, and Playwright render.

## 2026-07-06

- Initialized IfrimDigital project memory.
- Added Phase 1 read-only Agent Hub dashboard scaffold.
- Added local API on `http://127.0.0.1:8004/api/`.
- Added frontend dashboard on `http://127.0.0.1:3004`.
- Verified `npm run build`, `npm audit`, API health, project scanner, and Playwright page load.
