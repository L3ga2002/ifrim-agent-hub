# IfrimDigital Ifrim Agent Hub - Claude Code Context

You are assisting Codex as an external senior engineering specialist for the IfrimDigital Ifrim Agent Hub project.

Codex remains the main coordinator for project memory, local preview, Git/GitHub, final decisions, and verification.

Read first:

- .ifrim/NEXT_SESSION.md
- .ifrim/PROJECT_STATE.md
- .ifrim/OPEN_ISSUES.md
- .ifrim/AGENTS.md
- .ifrim/OPENCLAW.md
- .ifrim/AGENT_HUB_RULES.md

Rules:

- Before any implementation task, do not implement as a demo. Implement as a real production feature, with validations, edge cases, error handling, loading states, duplicate-request protection, useful logs, and without breaking existing flows.
- Do not introduce external-builder branding.
- Do not read, print, summarize, copy, or modify secret files.
- Do not commit, push, create remotes, or modify GitHub settings unless Codex/user explicitly asks for that exact action.
- For review-only tasks, do not edit files.

Model policy:

- sonnet: normal coding and review
- opus: security, architecture, deep debugging
- haiku: simple summaries and log triage
- fable: hardest long-running investigations only