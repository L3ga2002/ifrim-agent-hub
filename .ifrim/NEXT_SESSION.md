# Next Session - Ifrim Agent Hub

## Central Rules

- Read C:\Users\mihai\OneDrive\Desktop\Ifrim Digital Proiecte\PROJECTS.md.
- Read C:\Users\mihai\OneDrive\Desktop\Ifrim Digital Proiecte\.ifrim-system\THREAD_BOOTSTRAP.md.
- Read C:\Users\mihai\OneDrive\Desktop\Ifrim Digital Proiecte\.ifrim-system\AGENT_HUB.md.
- Read C:\Users\mihai\OneDrive\Desktop\Ifrim Digital Proiecte\.ifrim-system\AGENT_CATALOG.md.
- Read C:\Users\mihai\OneDrive\Desktop\Ifrim Digital Proiecte\.ifrim-system\AGENT_TEAM_V2.json.
- Read C:\Users\mihai\OneDrive\Desktop\Ifrim Digital Proiecte\.ifrim-system\MODEL_ROUTING.md.
- Read C:\Users\mihai\OneDrive\Desktop\Ifrim Digital Proiecte\.ifrim-system\OPENCLAW_GPT56_RUNBOOK.md before OpenClaw/model work.
- Read C:\Users\mihai\OneDrive\Desktop\Ifrim Digital Proiecte\.ifrim-system\PROMPT_ARCHITECT.md before compiling broad Catalin requests.
- Read C:\Users\mihai\OneDrive\Desktop\Ifrim Digital Proiecte\.ifrim-system\DESIGN_SYSTEM.md before UI/design/frontend work.
- Read C:\Users\mihai\OneDrive\Desktop\Ifrim Digital Proiecte\.ifrim-system\REGRESSION_QA.md before non-trivial work.

## Read First

- .ifrim/PROJECT_STATE.md
- .ifrim/OPEN_ISSUES.md
- .ifrim/PREVIEW.md
- .ifrim/AGENTS.md
- .ifrim/OPENCLAW.md
- .ifrim/AGENT_HUB_RULES.md

## Current Focus

- Agent Hub v1 is operational; current work is hardening, recovery verification and normal use on real projects.
- Approved OpenClaw execution is live through a fail-closed, one-task-at-a-time launcher. Generated packets never launch automatically.
- Owner -> independent reviewer -> QA/fix orchestration is implemented and verified end to end.
- Source edits in another project are allowed only through an explicit task, valid backup, exact approval, fresh preflight and the project's own safety rules.
- Backup gate is live: new agent packets create a local zip backup before work.
- Prompt Architect / Task Compiler turns Catalin's natural-language requests into reviewable professional task packets.
- Design System governance prevents generic basic UI and routes meaningful visual work through `ifrim-design` and frontend review/QA.
- `HUB-006` - Design System enforcement in Hub packets and UI is implemented and verified.
- `HUB-007` - Prompt Architect / Task Compiler flow is implemented and locally verified.
- `HUB-008` - Agent Directory / full agent catalog is implemented with all 23 registered agents and configuration drift detection.
- Snapshot/version tracking, approval gate, preflight and manual one-task OpenClaw launcher are implemented.
- Windows tray launcher and logon autostart are implemented and live.
- Read-only continuation and the approval-aware owner -> reviewer -> QA/fix workflow are implemented and verified end to end.
- Runner timeout routing is adaptive: normal 30m, complex 2h, deep 6h. Never describe the process heartbeat as proof that an agent is making semantic progress.

## Implemented V1 Scope

- Load central `PROJECTS.md`.
- Load `.ifrim-system/PORTS.md`.
- Load each project's `.ifrim/PROJECT_STATE.md`, `.ifrim/NEXT_SESSION.md`, `.ifrim/OPEN_ISSUES.md`, `.ifrim/PREVIEW.md`, and latest `.ifrim/LOOP_REPORTS`.
- Show project status, preview URLs, phase/stage, open issues, and next task.
- Create task packets and advisory locks locally.
- Persist tasks/locks/events in `.ifrim/private/agent-hub.sqlite`.
- Persist agent packets in `agent_runs`.
- Generate command previews and launch approved OpenClaw packets only after exact approval and fresh preflight.
- Show bridge diagnostics for OpenClaw and Claude Code availability. Automatic Claude/Codex invocation remains disabled.
- Persist backups in `backups` and create archives under target project `.ifrim/BACKUPS/`.
- Show Prompt Compiler / Design System status in the Hub UI.
- Include Design System and Prompt Architect rules in generated agent packets when relevant.

## Safety Gates Still Active

- No source edits without an approved project task, backup and preflight.
- No destructive file operations or broad data replacement without Catalin's explicit approval.
- No automatic Git commit/push/deploy.
- No real email/outreach/Telegram send.
- No unattended database modifications in other projects.

## Required Implementation Rule

- Before implementation, do not build demo-only behavior. Build real production features with validations, edge cases, error handling, loading states, duplicate-request protection, useful logs, and no broken existing flows.

## Safe First Commands

git status --short --branch

## Current Verification

- `npm run build` passed on 2026-07-07.
- `npm audit --audit-level=moderate` passed with 0 vulnerabilities on 2026-07-07.
- API health passed on `http://127.0.0.1:8004/api/health`.
- Task validation returns 400 for invalid title/goal.
- Duplicate active lock protection returns 409 for ProDelivery `restaurant-panel`.
- Playwright snapshot verified Task Queue, Locks, forms, and ProDelivery `PD-HUB-001` render.
- Agent packet POST works for `HUB-003` and `PD-HUB-001`.
- Duplicate packet request reuses the existing packet when the task has not changed.
- Playwright verified Agent Runs, Packet preview, memory checklist, verification checklist, OpenClaw command preview, and Claude command preview.
- Website test `WEB-HUB-001` created backup `backup-mrb2v7wf-9dpi7k` with 163 files and generated packet version `backup-gate-v1`.
- `node --check apps/api/src/server.mjs` passed on 2026-07-08.
- `npm run build` passed on 2026-07-08.
- `npm audit --audit-level=moderate` passed with 0 vulnerabilities on 2026-07-08.
- Bridge diagnostics endpoint passed: `GET /api/bridge-diagnostics?projectSlug=ifrim-agent-hub` returned OpenClaw `ready`, Claude Code `ready`, auto execution `false`.
- `GET /api/agent-directory` exposes only allowlisted routing metadata, never raw auth profiles or secrets.
- Global Prompt Architect passed on `gpt-5.6-terra`/`medium` without fallback on 2026-07-11.
- Global Security Reviewer passed fail-closed on `gpt-5.6-sol`/`xhigh` without fallback on 2026-07-11.
- Main Telegram session now records `gpt-5.6-terra`/`medium`; migration preserved history and did not deliver the internal probe.
- Agent Hub frontend/API are running at `http://127.0.0.1:3004` and `http://127.0.0.1:8004/api/`.
- Final build and `npm audit --audit-level=moderate` passed on 2026-07-11 with 0 vulnerabilities.
- Browser QA passed with 23 visible agent rows, 23 sync states, zero config drift, no fresh console errors, and no page-level horizontal overflow at 390px mobile width.
- Agent directory records fresh Terra/Sol/Luna OAuth verification from 2026-07-12.
- Latest npm tags checked on 2026-07-11: stable remains `2026.6.11`; GPT-5.6 build remains beta `2026.7.1-beta.2`.
- Invalid bridge diagnostics project slug returns HTTP 400.
- Backup gate for Ifrim Agent Hub no longer fails when SQLite is locked; it creates backup with skipped locked SQLite files recorded in manifest.
- Playwright screenshots verified Bridge diagnostics loaded on desktop and mobile at `http://127.0.0.1:3004`.
- Prompt Compiler build and API health passed on 2026-07-11.
- Secret-like input is rejected before draft persistence; same owner/reviewer is rejected.
- Two concurrent conversions produced exactly one task and returned the same task ID.
- Generated agent packet preserved scope, non-goals, assumptions, regression checklist, lock gate, and automatic backup.
- Browser QA passed on desktop and 390px mobile with no horizontal overflow or console errors.
- Independent OpenClaw re-review was attempted twice but blocked by the configured OpenAI project's missing access to Sol/Terra and unavailable fallback; local verification completed and the external blocker remains recorded.
- `GET /api/design-governance` returns project-specific direction, routing and five required visual checks.
- `HUB-006` packet version `design-governance-v1` routed through `ifrim-design + ifrim-frontend`, included independent reviewers, Design System memory and automatic backup.
- Design Governance browser QA passed on desktop and 390px mobile with no overflow or console errors.
- Snapshot creation creates a real backup and reuses the same snapshot/backup for sequential and concurrent duplicate requests.
- Snapshot restore planning returns `executable: false`, `approvalRequired: true` and five controlled restore steps.
- Browser QA verified candidate snapshots, approval control and blocked restore plan on desktop/mobile without console errors.
- Execution approval requests require a packet-ready run and valid backup, expire after 24 hours and bind to the exact packet update timestamp.
- Duplicate approval requests reuse the same record; invalid decisions return 400 and stale revisions return 409.
- Browser QA verified pending status, approve/change/reject controls, mandatory rejection note, mobile layout and explicit auto-execution-off notice.
- Controlled preflight records seven checks for approval, packet state, task binding, archive, project boundary and locks.
- Pending approval correctly produces a blocked preflight with `ExecutionStarted: false`; only the separately confirmed manual OpenClaw launch path is armed.
- Manual launcher requires `confirmExecution=true`, exact approval ID/revision and a second preflight immediately before spawn.
- Fail-closed tests returned HTTP 400 without confirmation and HTTP 409 for pending approval, with zero `manual_launch` records and no model usage.
- Launcher allows one active task globally, records output/error safely, redacts secrets and terminates the process tree at the selected adaptive ceiling: 30 minutes, 2 hours or 6 hours.
- Model guidance: Sol/high or xhigh for architecture, security and critical engineering; Terra/medium or high for normal production work; Luna/low for low-risk QA, classification and prototypes.
- Per-task router is implemented and visible in packets/runner. Fresh live probes passed through ChatGPT OAuth and the Codex harness for Terra/medium, Sol/xhigh and Luna/low with no fallback.
- Stable OpenClaw `2026.7.1` is live on Node `24.16.0`; strict Sol/Ultra, Terra/Ultra and Luna/Max probes passed through OAuth/Codex with no fallback on 2026-07-14.
- Router v2 permits Ultra only for an explicit critical/P0 task on Sol/Terra. P0 defaults to Max when Ultra is not explicitly requested; no agent stores Max/Ultra as its default.
- Workflow packet v2 includes the initial OWNER stage explicitly and the live `HUB-STABLE-FLOW-2-20260714` owner/reviewer/QA sequence completed with separate approvals and no fallback.
- Preview watcher survival and tray self-healing were verified after a real backup: port 3004 stayed HTTP 200, then recovered automatically after a controlled Vite process stop.
- Workflow Orchestrator v1 is implemented and live. It prepares but never auto-launches owner -> reviewer -> QA/fix stages, requires a new approval per stage, and stops after three failed fix cycles.
- Structured verdicts require both `IFRIM_WORKFLOW_VERDICT` and `IFRIM_WORKFLOW_SUMMARY`; incomplete output enters `awaiting_verdict` instead of advancing.
- Provider failures create a controlled same-stage retry instead of restarting the owner. The final `HUB-014-SMOKE-2` run completed after one fix cycle; QA passed on Luna/low and marked the task `done`.
- Continuation correctly preserves the latest completed task when no active task exists, reports all workflow stages complete and proposes `define_next_task`.
- Browser QA passed for workflow history, stage labels, retry state, desktop/mobile layout and console errors.
- Scheduled Task `Ifrim Agent Hub` is running with one visible tray process; frontend/API health passed on ports 3004/8004.
- All five registered projects return a read-only continuation payload with three workflow steps and `automaticLaunch: false`; invalid project slug returns 400.
- Browser QA verified `Continuare coordonata`, ProDelivery `PD-HUB-001`, backup gate and owner/reviewer/QA routing without console errors.
- `openclaw agent --help` confirms per-run `--model` and `--thinking` overrides, plus `--message-file`; launcher uses these explicit controls.
- Private GitHub repository `L3ga2002/ifrim-agent-hub` is active on `main`; initial v1 commit is `af29e4e`.
- Restart recovery passed on 2026-07-13 with unchanged persistent counts: 17 tasks, 45 agent runs, 37 recorded backups, 2 snapshots and 29 workflow transitions.
- Runtime singleton checks passed after restart: one Hub API, one Hub frontend, one visible OpenClaw console and one gateway process.
- `openclaw health --json --timeout 15000` returned `ok: true`; Telegram is connected and plugin errors are empty.
