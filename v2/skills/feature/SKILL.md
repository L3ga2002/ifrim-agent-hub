---
name: feature
description: "Software Factory feature procedure: intake to a versioned spec, a validated plan, implementation with errors and validation, local checks, independent review, QA on protected acceptance tests and a delivery bundle. Use for new functionality or behaviour changes in an Ifrim Digital project."
license: Proprietary (Ifrim Digital internal use)
compatibility: Agent Skills format. Usable by Claude Code, Codex and Ifrim Agent Hub V2; tools and permissions are enforced by the Hub, not by this file.
metadata:
  hub-version: "2"
  hub-roles: "planner frontend backend reviewer qa"
  hub-permission: WORKSPACE_EDIT
  hub-tools: "files.read files.edit process.build process.test preview.check"
  hub-tests: "every acceptance criterion has evidence or an explicit status; the bundle names the tested change set"
---
# Feature

From a request to a verified local delivery. The owner approves the scope once; the Hub conducts the steps and stops on any doubt.

## Inputs

- request (owner's words), separated from observations in the code and from assumptions
- acceptance criteria with how each is verified (test file, review, manual, e2e, preview)
- the exact verification commands and, optionally, a local preview command and URL

## Steps

1. Intake: write spec v1 (objective, in/out of scope, criteria, constraints, risks, data, artifacts, verification). Ask only what changes the result.
2. Plan: one writer, one read-only reviewer on another provider, the Hub runner for checks/QA; limits (≤ 2 repair cycles, duration, attempts).
3. Implement the complete behaviour: validation, loading/error/success states, duplicate protection, real integration (not only mocks).
4. Local checks by the Hub runner on the exact change set; failures become findings.
5. Independent review; bounded repair linked to the findings; re-review.
6. QA on the protected acceptance tests, then the preview from the verified version.
7. Delivery bundle: spec, change set, files, review, QA, preview, limits, rollback. The owner accepts locally.

## Outputs

- implementation and tests
- change set (hash) and diff
- review verdict and findings
- QA evidence and preview
- delivery bundle

## Verification

- [ ] every acceptance criterion has a status backed by evidence (or NEVERIFICAT / NEEDS_INSTALL_APPROVAL)
- [ ] protected acceptance tests unchanged; zero tests is never a pass
- [ ] the bundle names the exact change set that was tested

## Hub rules

- This skill never grants tools or permissions: the Hub uses the intersection of this skill and the assigned role.
- No secrets in prompts, files or outputs. No paid API routes, credits or fallbacks.
- Never commit, push, deploy, publish or send anything without an approval bound to that exact action.
- READY_FOR_OWNER_ACCEPTANCE is not RELEASED.
