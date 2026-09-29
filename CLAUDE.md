# IfrimDigital Ifrim Agent Hub - Claude Code Context

## Current Handoff - 2026-09-29

Read `.ifrim/OPUS_HANDOFF.md` first, then the project memory and current Git/SQLite state. HUB-018 remains in progress: native Codex passed, but Claude acceptance and cancellation did not. The last Claude request failed before model admission at the backup gate; the execution gate is suspended. A backup-filter correction is in the local source but requires final review, an idle-API reload and a complete real backup before any new execution. Treat the older notes below as historical when they conflict with current evidence. This handoff alone does not authorize a model launch, data deletion, commit, push or deployment.

## Active Override - 2026-09-27

Catalin approved Claude Code as a local worker in the Agent Hub unified conversation runtime. The 2026-09-26 disabled note below is historical for the existing OpenClaw packet route. Work only in the selected Agent Hub workspace after Hub backup/lease checks. Never read or send secrets, modify another project, commit, push, deploy, delete important data, or send external messages without a separate explicit request. On handoff, inspect current Git state and continue rather than restarting.

## Disabled - 2026-09-26

Catalin selected OpenAI-only operation for this project. Do not invoke Claude. This file is retained as historical context; active routing is in `.ifrim/MODEL_POLICY.md`.

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
