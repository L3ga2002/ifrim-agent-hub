# HUB-013 Loop Report - Per-Task Model Routing

- Date: 2026-07-11
- Status: implemented and locally verified
- Project: Ifrim Agent Hub

## Delivered

- Task/agent/risk-based Sol, Terra and Luna selection.
- Explicit reasoning selection from low through max.
- OpenClaw per-run `--model` and `--thinking` overrides.
- Desired/effective model visibility and Luna fallback explanation.
- Model/reasoning persisted in execution audit records.
- Read-only model routing preview API.

## Verified Routes

- complex frontend task: Terra/high.
- security reviewer: Sol/xhigh.
- normal low-risk QA: Luna/low desired; Terra/low effective while Luna is unavailable.
- current OpenClaw CLI supports model/thinking overrides and message files.

## Safety

- Luna is never launched until the central entitlement status passes.
- High/critical tasks are not eligible for Luna.
- Security, migration, auth, payment and data-integrity work is strict/fail-closed.
- No model was invoked during routing verification.

## Next Work

Restore OpenClaw entitlement, then implement thread-to-Hub continuation intake and owner-to-reviewer-to-QA orchestration. Keep scheduled loops disabled.
