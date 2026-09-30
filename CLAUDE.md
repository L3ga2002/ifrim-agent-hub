# IfrimDigital Ifrim Agent Hub - Claude Code Context

## V2 - 2026-09-30

V2 is in `v2/` (see `.ifrim/OPUS_HANDOFF.md` → V2 section and `.ifrim/RUNBOOK.md`). It runs on 127.0.0.1:8011 and starts in BUILD_SAFE. Tests: `npm run test:v2` (no models). Milestone 01 (2026-09-30, version `2.1.0-m01`, commit `f31240b`) added the company runtime, execution surfaces, command bus, approval policy, router, schedules, skills and the OpenAI/Anthropic audit (`v2/config/ecosystem/*.json` → `node v2/scripts/gen-ecosystem-docs.mjs` → `.ifrim/V2_*`). Milestone 02 (commit `0fb71d2`) added the JARVIS experience and security readiness; the Lega voice assistant followed (`30bfbef`, `dac2db4`, `ce819b9`, `bbe8757`; see `.ifrim/LEGA.md`). Current version `2.3.0-m03` (2026-10-01): branch `v2-milestone-01` is pushed up to `bbe8757`, `main` is still `e9ab563`, nothing is merged or deployed. Live validation on the sanitized test project (2026-09-30): Claude Code read-only PASS_LIVE; Codex FAIL at 14:41 (thread/start timeout, fixed in `30bfbef`), then PASS_LIVE twice (workspace-write and read-only); Lega voice PASS_LIVE. Every Hub Codex process runs with plugins off and every MCP server of the owner's config disabled by name (checked before the turn); Claude runs stop before the model if init reports an MCP server. Hub runs of Claude Code refuse Fable models and load only user settings (`--setting-sources user`); do not loosen the billing guards in `v2/server/policy/billing.mjs` or `v2/server/providers/claude.mjs`. Never start a model, open the execution gate, create live grants, commit, push or deploy without the user's explicit approval for that exact action. V1 files (`src/`, `apps/api/`, `tools/`, `tests/`) are kept and still serve V1 on 3004/8004; do not delete them without approval.

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
