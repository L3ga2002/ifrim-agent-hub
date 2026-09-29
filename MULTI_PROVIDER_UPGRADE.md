# Multi-provider upgrade: current state

## Audit (2026-09-27)

Agent Hub is a React/Vite frontend with a Node.js API and local SQLite. The existing task queue, locks, backups, agent packets and approval-gated OpenClaw execution remain unchanged. The central agent registry contains 23 agents. Prior to this change there was no shared chat, canonical transcript, or Codex/Claude native-session map. Existing model policy and Claude diagnostics are still OpenAI-only; this upgrade does not silently change that execution policy.

The installed Codex exposes `app-server --stdio`. The installed Claude Code CLI exposes `--print`, `--output-format stream-json`, `--include-partial-messages`, `--session-id` and `--resume`; Claude login is present locally. OpenClaw ACP/acpx is not configured. None of those observations authorizes automatic model execution or API billing.

## Implemented local foundation

`conversation-store.mjs` creates additive `hub_conversations`, `hub_messages`, `hub_decisions`, `hub_task_state`, `hub_provider_sessions`, `hub_provider_runs`, `hub_leases` and `hub_checkpoints` tables. Existing tables and rows are not modified. The original message text is retained; task summaries and decisions are separate. A run interrupted by API restart retains its lease until liveness is checked, so a second writer cannot start by mistake.

`context-engine.mjs` builds a local ContextEnvelope from task state, decisions, recent messages, selected historical messages, provider sessions, local URLs and read-only Git state. It does not transfer private model reasoning. Sensitive paths and assignment-like secret lines are filtered. The envelope is a checkpoint, not evidence that a provider resumed.

The API provides project-scoped conversation creation/list/detail, user message persistence, decision and task-state updates, and local handoff checkpoint creation. The React panel shows a unified timeline and explicitly states that messages/checkpoints do not start a worker. Its provider selector selects the checkpoint destination only.

## Local execution verified (2026-09-27)

Catalin explicitly approved local Codex/Claude workers for this upgrade, scoped to Ifrim Agent Hub. The conversation API now requires an explicit execute confirmation, verifies a per-run backup and a workspace-write lease before spawning a worker, stores streaming output, usage, run status and native provider sessions, and releases the lease after process completion. Saving a message or preparing a handoff never starts a worker. The existing OpenClaw packet policy remains OpenAI-only and independent of this conversation runtime.

The live HUB-017 read-only smoke completed Codex -> Claude -> Codex in one conversation. Both provider session IDs were reused, the final Codex answer referenced Claude's answer, and no lease remained. Claude initially returned `401 OAuth access token has expired`; Catalin completed `claude auth login`, and `claude auth status --json` then reported `loggedIn=true`, `authMethod=claude.ai`, `subscriptionType=max`. No Anthropic API key or billing route was configured. The CLI process environment explicitly omits Anthropic and OpenAI API key variables.

86 local tests and the Vite build pass. The local browser preview at `127.0.0.1:3004` showed the HUB-017 conversation, provider selector, completed transcript, handoff and run controls; the API at `127.0.0.1:8004` showed the completed runs and zero leases. Source changes remain uncommitted.

## Remaining acceptance gaps

This is not full Codex/Claude desktop parity. Worktree creation, browser/computer gateway, independent reviewer and QA execution, crash recovery of a truly interrupted live worker, strict OS-level filesystem containment for Claude Code on Windows, and a controlled writable edit smoke are not demonstrated. `acceptEdits` and the allowlisted Bash tools are CLI permission controls, not a Windows sandbox. The new conversation route has its own confirmation/backup/lease gate but is not yet integrated with the older task-packet approval state. Until these gaps are resolved, do not present the runtime as fully production-hardened or enable automatic external actions.

### Scope correction, 2026-09-27

A user-initiated Claude Code run in a ProDelivery conversation completed before the project allowlist was enforced. It used `sonnet` with `medium` reasoning and did not route through OpenClaw. The run's `filesChanged` field is a repository dirty-file snapshot, not proof of which files that worker edited. No ProDelivery files were changed by this Hub correction. Future direct provider runs now fail with HTTP 403 outside `ifrim-agent-hub`; a separate project approval gate is required before that restriction can be widened. The conversation UI shows the selected next route, the last run's actual provider/model/reasoning/status/PID, and safe tool-name activity for subsequent runs. Tool activity is not a visible CMD or PowerShell window and does not expose command arguments. Historical runs have no recorded tool activity.

## Verification and rollback

Pre-edit source and SQLite checkpoints are under `.ifrim/BACKUPS/2026-09-27-140509-multiprovider-source.*`. The SQLite checkpoint passed `PRAGMA integrity_check`. Tests run against isolated SQLite databases under `.ifrim/tmp`; browser QA used an isolated API, not the live database. The additive tables may be left in place if the UI/API code is rolled back; existing task, lock and agent-run tables are unaffected. Do not remove tables or restore the live database while writers are active.

The normal preview remains frontend `127.0.0.1:3004`, API `127.0.0.1:8004`. The frontend supports `VITE_API_BASE` and the API supports `HUB_FRONTEND_ORIGIN` for isolated preview pairs.
