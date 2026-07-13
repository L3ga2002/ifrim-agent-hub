# OpenClaw - Ifrim Agent Hub

OpenClaw is the local IfrimDigital specialist-agent runtime.

Codex remains the coordinator. Use OpenClaw for focused specialist review, QA, backend/frontend/devops/security checks, and narrow implementation tasks when useful.

## Standard CLI Pattern

~~~powershell
openclaw agent --agent <agent-id> --message "<task>" --json --timeout 1800
~~~

Agent Hub selects one adaptive ceiling from task risk and complexity:

- `normal`: 30 minutes (`--timeout 1800`)
- `complex`: 2 hours (`--timeout 7200`)
- `deep`: 6 hours (`--timeout 21600`)

The outer shell/tool timeout must exceed the selected ceiling by at least 5 minutes. A ceiling does not force the agent to run for that duration.

## Common Agents

- ifrim-product
- ifrim-architect
- ifrim-frontend
- ifrim-backend
- ifrim-integrations
- ifrim-devops
- ifrim-reviewer
- ifrim-backend-reviewer
- ifrim-frontend-reviewer
- ifrim-security-reviewer
- ifrim-quality-reviewer
- ifrim-qa

## Rule

Do not ask every agent everything. Use the right agent for the right task, then verify locally.
