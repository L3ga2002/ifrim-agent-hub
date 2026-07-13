# Preview - Ifrim Agent Hub

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
