# Preview - Ifrim Agent Hub

## V2 Preview - 2026-09-30

- V2 UI + API: http://127.0.0.1:8011/ (built UI served by the Hub). Dev UI: http://127.0.0.1:3011/ (`npm run dev:v2:web`, proxy to 8011).
- Start/stop: `npm run v2` / `npm run v2:stop` / `npm run v2:status`. Log `.ifrim/private/v2-hub.log`.
- Pair 3011/8011 was free on 2026-09-29 and is not in the global `PORTS.md` (global file not edited). After a cutover, V2 can take 3004/8004.
- Observed at the checkpoint (not controlled by V2): V1 Vite PID 18364 on 3004, V1 API PID 28392 on 8004, OpenClaw gateway PID 23596 on 18790.
- Visual QA on real captures: 360, 390, 768, 1024, 1440, 1920 px without horizontal overflow; static core fallback checked.

## Authoritative Runtime Checkpoint - 2026-09-29

- Frontend127.0.0.1:3004 is Vite dev/PID18364. API127.0.0.1:8004 is now PID22828, identity-controlled reload via existing supervisor4852 after zero SQLite provider runs/leases; health HTTP200. Connection classification helper is loaded.
- Isolated Gateway127.0.0.1:18790/PID23596 has a valid receipt. Exact Hub-native session6273c92f-f187-48ea-a7df-a13d78f2b543 exists and its Luna/max/read-only/Codex/approved-account selection was verified read-only. No actual model turn or clicked Hub-session browser acceptance.
- Gate suspended: latest health/status omit modelRuntime, meaning readiness UNKNOWN, not proven degraded or healthy. Fresh subscription certification passed both providers/all23; this is not operational acceptance. Main blank Luna/max chat is not task visibility proof.
- Owner186/186 serial tests and production build PASS; build is not installed as this dev preview. No PC restart or other project service change.


## Current Runtime Override - 2026-09-29

- Frontend3004 currently runs Vite development (PID18364), not the historical production preview below. API8004 PID30808 is healthy; isolated OpenClaw Gateway18790 PID29340 is ready. Production build PASS does not mean this dev server serves that build.
- User completed local Gateway browser authentication. Actual Hub native task session visibility is not accepted because sessions.create failed before model admission. Execution gate is suspended; do not send a task from main chat as an acceptance substitute.

## Verified 2026-09-27

- Frontend currently serves the verified production build via Vite preview on port 3004. API remains on port 8004. This avoids slow/unstable OneDrive development watching during this session.
- GPT-6 directory checked at 1440x960 and 390x844: 23 roles, no page errors or document overflow. Screenshots are in `output/playwright/hub-gpt6-final-*.png`.
- For future source edits, rebuild before checking this preview or deliberately switch back to the documented development command.

## Live Preview Rule

For app/frontend work, keep local preview available whenever practical.

Workflow:

1. Start or verify preview before user-facing frontend changes.
2. Use the URLs below and the reserved ports from .ifrim-system/PORTS.md.
3. After UI changes, open/check the affected route in the browser.
4. Tell Catalin the exact URL tested.
5. If preview cannot run, record the blocker here or in OPEN_ISSUES.md.

- Frontend: http://127.0.0.1:3004
- Backend API: http://127.0.0.1:8004/api/

## Commands

Install dependencies:

```powershell
npm install
```

Start both API and frontend:

```powershell
npm run dev
```

Install and start the visible Windows tray launcher:

```powershell
npm run hub:install-startup
```

Or start separately:

```powershell
npm run dev:api
npm run dev:web
```

Health checks:

- API: `http://127.0.0.1:8004/api/health`
- Projects: `http://127.0.0.1:8004/api/projects`
- Project continuation: `http://127.0.0.1:8004/api/projects/<slug>/continuation`
- Hub state: `http://127.0.0.1:8004/api/hub-state`
- Tasks: `http://127.0.0.1:8004/api/tasks`
- Locks: `http://127.0.0.1:8004/api/locks`
- Agent runs: `http://127.0.0.1:8004/api/agent-runs`
- Agent directory: `http://127.0.0.1:8004/api/agent-directory`
- Design governance: `http://127.0.0.1:8004/api/design-governance?projectSlug=ifrim-agent-hub`
- Task drafts: `http://127.0.0.1:8004/api/task-drafts`
- Compile draft: `POST http://127.0.0.1:8004/api/task-drafts/compile`
- Review/update draft: `GET/PATCH http://127.0.0.1:8004/api/task-drafts/:id`
- Explicit task conversion: `POST http://127.0.0.1:8004/api/task-drafts/:id/create-task`
- Backups: `http://127.0.0.1:8004/api/backups`
- Snapshots: `GET/POST http://127.0.0.1:8004/api/snapshots`
- Approve version: `POST http://127.0.0.1:8004/api/snapshots/:id/approve`
- Non-executable restore plan: `GET http://127.0.0.1:8004/api/snapshots/:id/restore-plan`
- Execution approvals: `GET http://127.0.0.1:8004/api/execution-approvals`
- Request approval: `POST http://127.0.0.1:8004/api/agent-runs/:id/approval-request`
- Decide approval: `POST http://127.0.0.1:8004/api/execution-approvals/:id/decision`
- Execution preflight only: `POST http://127.0.0.1:8004/api/agent-runs/:id/preflight`
- Execution attempt audit: `GET http://127.0.0.1:8004/api/execution-attempts`
- Workflow transition audit: `GET http://127.0.0.1:8004/api/workflow-transitions`
- Confirm ambiguous verdict: `POST http://127.0.0.1:8004/api/execution-attempts/:id/workflow-verdict`
- Prepare same-stage retry: `POST http://127.0.0.1:8004/api/agent-runs/:id/retry`
- Manual approved launch: `POST http://127.0.0.1:8004/api/agent-runs/:id/execute`
- Read-only model route preview: `POST http://127.0.0.1:8004/api/model-routing/preview`
- Frontend: `http://127.0.0.1:3004`
