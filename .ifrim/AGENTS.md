# Agent Workflow - Ifrim Agent Hub

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