# OpenClaw - Ifrim Agent Hub

## Active Override - 2026-09-26

Read `.ifrim/MODEL_POLICY.md`. New Hub packets use explicit GPT-6 model/reasoning overrides and OpenAI OAuth through Codex. Luna defaults to Max, not Ultra. Global defaults are unchanged. Do not reuse GPT-5.6 entitlement probes as GPT-6 proof. GPT-6 bridge execution remains unverified until a separately approved live probe succeeds. No automatic launch or external delivery is allowed.

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

Reasoning is selected per task. `max` is reserved for critical/P0 work. `ultra` is allowed only when a critical/P0 packet explicitly requests it and the selected model is Sol or Terra. Luna is capped at `max`; no agent stores `max` or `ultra` as a permanent default.

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
