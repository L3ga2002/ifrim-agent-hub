# Ifrim Agent Hub - Opus Handoff

Updated: 2026-09-29. This is a source and state handoff, not a claim that HUB-018 is complete.

## Exact Workspace

- Project: `C:\Users\mihai\OneDrive\Desktop\Ifrim Digital Proiecte\Ifrim Agent Hub`
- Central registry and rules: `C:\Users\mihai\OneDrive\Desktop\Ifrim Digital Proiecte\PROJECTS.md` and `.ifrim-system\`
- Private GitHub repository: `https://github.com/L3ga2002/ifrim-agent-hub`, branch `main`
- Frontend: `http://127.0.0.1:3004/`; API: `http://127.0.0.1:8004/api/`; isolated OpenClaw Gateway: `127.0.0.1:18790`
- Stack: React/Vite frontend, Node.js API, local SQLite. Codex coordinates; OpenClaw and Claude are specialists.

## Source Map

- `src/main.jsx`, `src/styles.css`: dashboard, coordinated conversation and execution display.
- `apps/api/src/server.mjs`: HTTP API, task/backup gates and execution lifecycle.
- `apps/api/src/conversation-*.mjs`, `provider-runtime.mjs`: persistent conversations and provider runs.
- `apps/api/src/openclaw-*.mjs`, `subscription-*.mjs`, `hub-acceptance-scope.mjs`: isolated Gateway routing, certificates and approval scope.
- `tools/`: controlled startup, audit, checkpoint, certification and maintenance helpers.
- `tests/`: focused contracts and regression tests.
- `.ifrim/NEXT_SESSION.md`, `PROJECT_STATE.md`, `OPEN_ISSUES.md`, `PREVIEW.md`, `AGENTS.md`, `OPENCLAW.md`, `AGENT_HUB_RULES.md`: project memory. Read latest report in `.ifrim/LOOP_REPORTS/`.
- `.ifrim/GITHUB.md`: repository boundaries. `.ifrim/private/`: SQLite, credentials and runtime state; `.ifrim/BACKUPS/`: local archives. Never publish or print secrets.

## Current Evidence And Blockers

- HUB-018 is `in_progress`, not accepted. Exclusive owner lock `LOCK-mumsn13e-2kew8n` remains active. Execution gate was suspended after the latest failed Claude attempt. Verify current DB and gate before any action; prose can be stale.
- Native Codex run `provider-run-eb17a87b-2a74-4f4f-a373-b0e17298a060` completed with `HUB018_CODEX_OK`. Actual route: `openai/gpt-6-luna`, `max`, native Codex, no fallback. Its session is visible in OpenClaw.
- Both local subscriptions and all 23 roles were recertified after an internal Gateway recovery. Gateway receipt was reconciled on the same OS process. This is configuration/auth proof, not Claude task acceptance.
- Latest Claude attempt `provider-run-a6812602-d23c-4796-ac46-249d691117ab` failed **before model admission** because the automatic project backup exceeded its 120-second limit. Its partial ZIP and failed DB record must be preserved. No automatic retry.
- The backup filter in `apps/api/src/server.mjs` was corrected to exclude `BACKUPS`, Hub `private`, `.env*`, and file/directory reparse points. The real ZIP fixture passed before the final reparse-point addition; rerun focused and broader tests, get independent review, reload only the exact idle API, then verify one complete real backup and manifest before another approved Claude probe. Do not increase the timeout as a substitute for diagnosis.
- Latest full serial run: 551 tests, 549 pass, 1 skip, 1 timeout in the continuation API contract (30.3 seconds). That test previously passed alone in 24.5 seconds. Treat latency as open, not a clean full-regression pass. The frontend build passed. The backup ZIP fixture passed after the reparse-point guard; Windows did not permit creation of a file-symlink canary (`EPERM`), so that branch is source-reviewed but not exercised here.
- Real Claude completion, real cancellation, and final browser/API acceptance remain open. Do not mark HUB-018 done from login, source tests or the Codex run alone.
- Dependency audit before this handoff found two `high` advisories, in `nanoid` and `postcss`. Do not present this WIP commit as a release. Review supported fixes separately and rerun build/regression before a release.

## Git And Safety

- The WIP source, tests and reports were committed and pushed to the private repository's `main` after the baseline `5e9025c`. Verify `git status`, `git log` and the remote at the start of work; a GitHub sync does not imply a release or HUB-018 acceptance.
- The repo is private. `.ifrim/private/`, `.ifrim/BACKUPS/`, `.ifrim/tmp/`, `.env*`, generated output and dependencies are ignored. Root OpenClaw bootstrap templates are local artifacts, not project policy; use `.ifrim/AGENTS.md` and `CLAUDE.md`.
- Before changing behavior: checkpoint, task lock, owner separate from reviewer, QA, tests/build/API/browser checks. Preserve all project/client data and other repositories. No API billing, external sends, unattended model launch, destructive cleanup, Git history rewrite or deploy.

## Suggested Opus Task

Review the current HUB-018 state and the backup gate fix independently. Identify P1/P2 issues with exact file/line evidence. Confirm the real backup test, no private/archive inclusion, the idle-API reload boundary and the continuation timeout risk. Return a bounded fix plan to Codex; do not execute Claude/OpenClaw models or mutate private runtime state merely from this handoff.
