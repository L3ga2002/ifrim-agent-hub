# Agent Workflow - Ifrim Agent Hub

## Active Override - 2026-09-27

Catalin approved the Agent Hub multi-provider Codex + Claude implementation and local worker execution for the selected project after a verified backup. This supersedes the OpenAI-only restriction below for the new unified conversation runtime only. The existing OpenClaw packet policy remains unchanged. No automatic API-key billing, broad system access, commit, push, deploy or external messages. Codex coordinates; owner, reviewer and QA remain separate.

## Active Override - 2026-09-26

Read `.ifrim/MODEL_POLICY.md`. Use OpenAI only, normally GPT-6 Luna at Max for implementation/review/QA; Sol/Astra handle complexity/risk. Luna does not support Ultra. Claude is disabled. Older model guidance below is historical. Keep owner, reviewer and QA separate; Codex remains coordinator.

Codex is the coordinator.
OpenClaw agents are IfrimDigital specialist engineers.
Claude Code is an external specialist for independent review, deep audits, and selected implementation.

## Production Implementation Rule

Before any implementation task, read and apply this rule:

Do not implement as a demo. Implement as a real production feature, with validations, edge cases, error handling, loading states, duplicate-request protection, useful logs, and without breaking existing flows.

## Review Flow

1. Codex reads project memory.
2. Codex asks OpenClaw or Claude Code specialists for focused analysis when useful.
3. Review agents report findings only.
4. Fix agents implement only assigned issues.
5. QA verifies with project-specific commands.
6. Agent Hub stores task packets, locks, snapshots, and loop reports.

## Required Finding Shape

- severity
- file/line
- evidence
- impact
- owner/fixer agent
- fix recipe
- verification command
