# Ifrim Agent Hub

Local-first coordination control plane for IfrimDigital projects. It keeps project context, task packets, backups, approvals, model routing, specialist-agent runs, reviewer verdicts and QA evidence in one persistent workflow.

## Runtime

- Frontend: `http://127.0.0.1:3004`
- API: `http://127.0.0.1:8004/api/`
- Stack: React, Vite, Node.js and SQLite
- Coordinator: Codex
- Specialist runtime: OpenClaw
- Optional independent review: Claude Code

## Local Start

```powershell
npm install
npm run dev
```

Install the visible Windows tray launcher and logon startup:

```powershell
npm run hub:install-startup
```

## Verification

```powershell
npm run build
npm audit --audit-level=moderate
```

Health endpoint:

```text
http://127.0.0.1:8004/api/health
```

## Safety

- Agent packets never launch automatically.
- OpenClaw execution requires a valid backup, exact approval and a fresh preflight.
- Important work follows owner -> independent reviewer -> QA/fix routing.
- Private SQLite state, backups, generated output and environment files are excluded from Git.
- Destructive operations, real external sends, deploys and unattended Git actions remain blocked without explicit approval.
