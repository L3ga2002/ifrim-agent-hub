# Ifrim Agent Hub V2 - Rebuild Decisions

Date: 2026-09-29. Author: Claude Opus 5.5 session (BUILD_SAFE). Start checkpoint: `.ifrim/CHECKPOINTS/2026-09-29-v2-rebuild-start.json`.

## Evidence used

- Git: `main` at `e9ab563`, clean, equal to `origin/main` at start. No commit, tag or push is made by this rebuild.
- Live processes observed (not stopped): V1 Vite `node` PID 18364 on 127.0.0.1:3004, V1 API `node` PID 28392 on 127.0.0.1:8004, isolated OpenClaw Gateway `node` PID 23596 on 127.0.0.1:18790.
- V1 database: consistent online-backup snapshot `.ifrim/BACKUPS/v2-rebuild/agent-hub-v1-2026-09-29T20-41-58-179Z.sqlite`, `integrity_check = ok`, 18 tables (26 tasks, 38 messages, 20 provider runs, 514 events, 81 backup records).
- Installed clients: Codex CLI `0.158.0-alpha.2.1` (Codex desktop bundle, `AppData/Local/OpenAI/Codex/bin/.../codex.exe`, not on PATH); Claude Code `2.1.175` (npm global). `claude auth status --json`: `loggedIn: true`, `authMethod: claude.ai`, `apiProvider: firstParty`, `subscriptionType: max` (identity fields not recorded).
- V1 history: `.ifrim/NEXT_SESSION.md`, `OPUS_HANDOFF.md`, `OPEN_ISSUES.md`, loop reports 2026-09-28/29.

## Critical path traced in V1

message → `POST /api/conversations/:id/execute` → `launchConversationRun` (server.mjs) → route/model policy → OpenClaw subscription gate (`openclaw-subscription-gate.mjs`, certificate + receipt) → workspace lease → PowerShell ZIP backup + SQLite checkpoint (`createVerifiedRunBackup`) → context envelope → `startOpenClawProvider` (Gateway RPC `sessions.create` → native Codex/Claude inside OpenClaw) → deltas over SSE → run finalization → owner/reviewer/QA packets (separate V1 packet workflow).

Observed failure modes: Gateway `sessions.create` 80 s to 30 min or timeouts, 23-process console bursts, OpenClaw bootstrap writing files into the workspace despite read-only, ambient setup probes to the paid OpenAI API route (403), backup gate > 120 s (PowerShell recursion on OneDrive), full-regression latency timeout. HUB-017 (before OpenClaw routing) proved the direct official-client path live: Codex → Claude → Codex in one persisted conversation.

## Classification

| Area | Decision | Reason |
|---|---|---|
| `server.mjs` monolith (3.6k lines, 180 KB) | REIMPLEMENT | Mixes 60 routes, packets, gates, backup and execution; hard to test in isolation. V2 splits storage/policy/runtime/providers/api. |
| OpenClaw Gateway execution route (`openclaw-*.mjs`, subscription certificate/receipt, 20+ maintenance tools) | RETIRE from V2 runtime | Adds a second orchestrator (Hub → Gateway → client), the source of most HUB-018 blockers and the ambient paid-API probe. V2 talks to the unmodified official clients directly. Gateway PID 23596 and its private state are left untouched; any stop/uninstall needs your approval. |
| Direct `startCodex` / `startClaude` (provider-runtime.mjs, HUB-017) | ADAPT | Correct protocol shape, proven live. V2 adds env allowlist, Windows tree kill, 9-way error taxonomy, approval routing, schema check, pre-assigned Claude session ids. |
| Context envelope + sanitizer (context-engine.mjs) | ADAPT | Good redaction and envelope; V2 turns it into the full versioned `HandoffPackage`. |
| Conversation store schema (conversation-store.mjs) | REFERENCE_ONLY + MIGRATE_DATA | V2 needs versioned entities and an append-only event log; data is imported. |
| Backup gate (PowerShell ZIP) | REIMPLEMENT | Node-native walker/ZIP with pruning before traversal, per-file SHA-256 manifest, SQLite online backup, restore verification. Guarantee kept: no write-capable run without a verified, complete backup. |
| Snapshot/approval/preflight concepts | ADAPT (concepts) | Approval binding to exact revision is correct; V2 binds to a canonical action hash + code version + expiry. |
| Model policy (GPT-6 role defaults) | REFERENCE_ONLY | V2 routes by capability + discovered models; no universal model. |
| Continuation selection | REFERENCE_ONLY | Re-expressed through the scheduler state machine and briefing. |
| 23 roles (`.ifrim-system/AGENT_TEAM_V2.json`) | MIGRATE_DATA (evaluated) | Mapped into 15 V2 roles; mapping recorded in `v2/config/roles.json`. |
| V1 React dashboard (`src/main.jsx`, 93 KB single file) | RETIRE (after cutover) | New design system and screens; V1 UI keeps running on 3004 until you decide cutover. |
| V1 tests (38 files) | REFERENCE_ONLY | Most target OpenClaw internals that V2 does not run; the requirements they encode (no API fallback, lease retention on unknown remote state, pre-admission classification, backup filter) are re-covered by V2 tests. V1 tests are not deleted. |
| V1 tools (`tools/*.mjs`, tray) | RETIRE for V2 / keep for V1 | Tray and autostart still start V1; V2 has its own start/stop scripts. No global service is installed. |
| V1 data (tasks, conversations, messages, runs, backups, approvals, events, locks) | MIGRATE_DATA | Versioned import from a consistent snapshot with dry-run, report and batch revert. The V1 database is never modified. |

## Architecture choices

- Node 24 ESM + built-in `node:sqlite` (FTS5 available, SQLite 3.51.2), React 18 + Vite 8 already in the repo. No new runtime dependencies for the server. No Electron/Tauri/Docker/vector DB.
- V2 lives in `v2/` inside this repository while V1 keeps running. V2 API+UI on `127.0.0.1:8011` (dev UI 3011). The pair is free and outside the registry; `PORTS.md` is global and was not edited. Cutover to 3004/8004 is a separate approved step.
- One process: API + scheduler/supervisor. The browser UI is separate, so closing it does not stop background work. Provider runs are child processes owned by the supervisor.
- Single source of truth: `.ifrim/private/hub-v2.sqlite` (projections + append-only `events` with monotonic `seq`). The Hub is the only coordinator. Model sessions never own the task list.
- Modes: `BUILD_SAFE` (default, persisted), `LIVE_VALIDATION` (only through a scoped, expiring grant you create), `OPERATIONAL` (disabled until you enable it).

## Milestone 01 decisions (2026-09-30)

Start checkpoint: `.ifrim/CHECKPOINTS/2026-09-30-milestone-01-start.json`. Native ecosystems were audited first (`V2_OPENAI_CAPABILITY_AUDIT.md`, `V2_ANTHROPIC_CAPABILITY_AUDIT.md`, `V2_AI_ECOSYSTEM_MATRIX.md`); frameworks were evaluated after them, from source/docs only (nothing cloned, installed or run). Details: `V2_FRAMEWORK_EVALUATION.md`, ownership: `V2_OWNERSHIP_MAP.md`.

| Area | Decision | Reason |
|---|---|---|
| Control plane | ONE CONTROL PLANE = the Hub | Owns company, missions, tasks, approvals, routing, memory, schedules, locks, checkpoints, telemetry. Vendor products are execution surfaces (REUSE_NATIVE / WRAP / MIRROR_STATE / ASSISTED), never a second task owner. |
| Paperclip | REFERENCE | Company/org-chart ideas only. Its default engines leak host API keys to local agents and add a second orchestrator; would violate `paid_api_inference: deny` and single task ownership. |
| Hermes Agent | REFERENCE | Memory/skills loop as design input only. No inference path compatible with included-subscription billing; optional components have other licences (OpenViking AGPL-3.0). Hub skills use the Agent Skills format instead. |
| OpenClaw | RETIRE (from V2 runtime) | Source of most HUB-018 blockers (80 s–30 min session creation, paid-API probe, bootstrap writes). Gateway PID/state untouched; any stop/uninstall needs approval. May later own only channels/integrations under a Hub grant, never task lifecycle. |
| Agent Zero | REFERENCE | "Computer worker" need is ≥80 % covered natively (Claude computer use/Chrome, Codex app-server, ChatGPT computer use). The gap (deterministic browser) is covered by Playwright. |
| Playwright | REUSE (after install approval) | Deterministic structured browser for the ComputerRuntime; not an agent. |
| Playwright MCP | INTEGRATE later, conditional | Only under a grant, after the deterministic worker, compared first with `@playwright/cli` + skills. |
| OpenClaw JARVIS UI, OpenJarvis | REFERENCE (UX / architecture only) | Stack mismatch, competing control plane, unauthenticated servers or paid API engines. Milestone 02 builds its own JARVIS UI. |
| Skills | Agent Skills (`SKILL.md`) is canonical | Both Codex and Claude Code read it; a skill never grants permissions. |
| Scheduling | One owner per intent | Hub owns the intent; one backend executes; native schedules are created by the user and linked. |
| Claude `-p` billing | Fable refused; `--setting-sources user`; advisor off; init `apiKeySource` stop | Audit: in `-p` Fable can bill usage credits silently; repository settings apply without a trust dialog. |
| Codex credits | Positive/unlimited credit balance blocks the route | Audit: after the allowance Codex/Work consume an existing balance automatically, with no toggle. |
