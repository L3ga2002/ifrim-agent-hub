# Project State - Ifrim Agent Hub

- Project: Ifrim Agent Hub
- Path: C:\Users\mihai\OneDrive\Desktop\Ifrim Digital Proiecte\Ifrim Agent Hub
- Stack: Node.js API + SQLite local database + React + Vite dashboard; local-first coordination hub for Codex, OpenClaw, and Claude Code
- Frontend preview: http://127.0.0.1:3004
- Backend API: http://127.0.0.1:8004/api/
- GitHub repo: L3ga2002/ifrim-agent-hub
- Status: v1 operational; hardening and recovery verification
- Last updated: 2026-07-13

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

Current phase: Phase 1 - local coordination control plane, Windows tray runtime, persistent continuation, task queue/locks, Prompt Compiler, manual agent packets and GPT-5.6 agent directory.

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
- OpenClaw is on isolated-tested beta `2026.7.1-beta.2` because GPT-5.6 support is not present in stable `2026.6.11`.
- GPT-5.6 Terra, Sol and Luna passed fresh OAuth/Codex harness probes without fallback on 2026-07-12.
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
