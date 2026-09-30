# Checkpoint — Milestone 02 done (local), 2026-09-30

- Branch `v2-milestone-01`, M02 committed on top of `f31240b` with the owner's explicit approval ("da și commit", 2026-09-30). Push, PR, merge and deploy were not executed by Claude (push is the owner's).
- Hub real: `http://127.0.0.1:8011/`, `2.2.0-m02`. At commit time: LIVE_VALIDATION with the gate open for the owner's pending Codex test (1-attempt grant, expires 16:09Z); return to BUILD_SAFE after it. Simulator: `http://127.0.0.1:8012/` (left running for your visual review; stop with `npm run v2:sim:stop`).
- Live: one Claude read-only turn on the sanitized test project (`Ifrim Digital Proiecte/ifrim-hub-live-test`) — PASS_LIVE. Codex not started by Claude: the real ACL pre-flight was refused by the Claude Code auto-mode classifier and not worked around. No real ACL was changed by Claude.
- Tests: V2 197 (196 PASS, 1 SKIPPED_ENV); V1 552 (551 PASS, 1 SKIPPED_ENV); `npm run build:v2` OK; `npm audit` 0. Codex canary 46/46 PASS_LOCAL.
- Start checkpoint: `2026-09-30-milestone-02-start.json`.

## Files

Modified:
- `package.json`
- `v2/scripts/common.mjs`
- `v2/server/`:
  - `config.mjs`, `hub.mjs`, `main.mjs`
  - `domain/{artifacts,integrations,projects,settings}.mjs`
  - `http/routes.mjs`
  - `policy/{approval-policy,gate}.mjs`
  - `providers/{claude,codex}.mjs`
  - `runtime/{command-catalog,runs}.mjs`
  - `security/paths.mjs`
  - `tools/registry.mjs`
- `v2/tests/`:
  - `fixtures/fake-codex.mjs`
  - `helpers.mjs`
  - `m01-integrations-artifacts.test.mjs`
  - `providers.test.mjs`
- `v2/web/src/`:
  - `api.js`, `store.js`, `main.jsx`
  - `components/Core.jsx`
  - `screens/{Approvals,ControlRoom,Ecosystem,Focus,Integrations,Missions,Settings,Tools}.jsx`
  - `shell/{Shell,Voice}.jsx`

New:
- `v2/server/policy/isolation.mjs`
- `v2/server/sim/simulation.mjs`
- `v2/server/tools/browser.mjs`
- `v2/scripts/{sim,sim-stop,sim-demo,create-test-project}.mjs`
- `v2/tests/m02-{security,runtime,ui-logic}.test.mjs`
- `v2/tests/manual/{codex-sandbox-canary,codex-real-profile-preflight}.mjs`
- `v2/web/src/`:
  - `components/{ErrorBoundary,Layout,Markdown}.jsx`
  - `components/core/Core3D.jsx`
  - `lib/{coreState,markdown,uiLogic}.js`
  - `screens/focus/{FocusScreen,Inspector,Composer}.jsx`
  - `screens/ecosystem/Catalog.jsx`
  - `styles/m02.css`
- `.ifrim/`:
  - `M02_{IMPLEMENTATION_STATUS,DESIGN_SYSTEM,SECURITY_READINESS,TEST_REPORT,VISUAL_REVIEW,LIVE_VALIDATION_PLAN}.md`
  - `M02_EVIDENCE/` (17 screenshots)
  - `CHECKPOINTS/2026-09-30-milestone-02-{start.json,done.md}`

Updated docs (history kept): `.ifrim/{RUNBOOK,OPEN_ISSUES,NEXT_SESSION,PROJECT_STATE,OPUS_HANDOFF}.md`.

## Proposed commit message (NOT executed)

```
Build Agent Hub V2 Milestone 02: JARVIS experience and security readiness

- Codex isolation enforced by the OS: per-process permission profiles on the
  Windows elevated sandbox, absolute denies for the Hub's private data, ~/.codex
  denied only for auth/transcripts, pre-turn stops, gate check with owner
  consent to the persistent sandbox ACEs (fingerprinted deny list)
- Claude read-only runs with absolute Read denials; shell/write stays a
  SECURITY_BLOCKER on native Windows
- Server-side file protection: realpath/junction checks, paged reads,
  redacted search, project-relative artifact checks
- New UI: shell with palette, mini-assistant and phone navigation; Control
  Room; WebGL2 procedural core with 10 state-driven visuals, SVG fallback and
  error boundaries; resizable Focus with inspector, bottom panel and composer;
  missions graph; OpenAI/Anthropic catalog; isolation panel; Browser
  Workspace (NEEDS_INSTALL_APPROVAL); strict-local voice (NEEDS_SETUP)
- Separate labelled simulator (8012) with fixture providers only
- Sanitized test projects: create script + project.register_test/retire_test
- Live: Claude read-only PASS_LIVE on the test project; Codex pending
- Tests: V2 196 pass + 1 skipped (env), V1 551 pass + 1 skipped (env);
  Codex canary 46/46 on fictive files

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

Before committing, check the following:
- `git status` shows no `.ifrim/private`, `.ifrim/tmp`, `.ifrim/BACKUPS` or `.env` files; they are ignored.
- `.ifrim/M02_EVIDENCE/` should be included only if you accept that its screenshots show internal conversation titles, the plan type and local paths.
