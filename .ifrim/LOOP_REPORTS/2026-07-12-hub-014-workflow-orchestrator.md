# HUB-014 Workflow Orchestrator v1

Date: 2026-07-12

## Result

- Added persisted `owner`, `reviewer`, `qa` and `fix` workflow stages.
- Each stage gets a separate packet, model route, approval and execution attempt.
- A completed stage prepares the next packet but never launches it automatically.
- Reviewer/QA PASS advances; FAIL creates a fix packet and fresh backup.
- A maximum of three fix cycles prevents runaway loops.
- Missing verdict or summary enters `awaiting_verdict` and requires confirmed evidence.
- Provider failure/timeout can create a same-stage retry without restarting earlier stages.

## Live Evidence

- `HUB-014-SMOKE` exposed a real fail-closed validation defect and routed reviewer FAIL to fix cycle 1.
- The defect was fixed: all stages now require both machine-readable result lines; owner/fix FAIL blocks instead of advancing.
- `HUB-014-SMOKE-2` owner PASS created reviewer packet automatically.
- Independent reviewer PASS created QA packet automatically.
- The first QA launch was blocked by subscription usage and the controlled retry preserved the same stage without inheriting approval.
- QA then exposed an in-flight task-state assumption and routed the workflow to fix cycle 1 instead of approving uncertain evidence.
- Fix PASS created a fresh reviewer packet; reviewer PASS created a fresh QA packet. Neither stage auto-launched.
- Final QA `run-mrhtxuu3-frtjxe` passed on `openai/gpt-5.6-luna` with `low` reasoning and no fallback.
- `HUB-014-SMOKE-2` is `done`; the final run is `workflow_complete` and six workflow transitions are persisted.

## Verification

- `node --check apps/api/src/server.mjs`: pass.
- `npm run build`: pass.
- `npm audit --audit-level=moderate`: 0 vulnerabilities.
- API health and workflow endpoints: pass.
- Agent registry: 23 agents, zero drift, Sol/Terra/Luna verified.
- Desktop browser QA: no horizontal overflow; Owner complete, Reviewer complete, QA blocked pending approval.
- Mobile 390x844 QA: no horizontal overflow; controls fit viewport; workflow/history collapse to one column.
- Browser console warning/error check: none.
- Final continuation check: phase `done`, Owner/Reviewer/QA `complete`, next action `define_next_task`, `automaticLaunch: false`.
- Final `node --check`, production build and npm audit passed; npm reported 0 vulnerabilities.

## Remaining Risk

The OpenClaw QA session could not directly use browser automation, so interactive desktop/mobile evidence remains supplied by the independent coordinator browser QA. This limitation is recorded and did not bypass the mandatory agent verdict or approval gates.
