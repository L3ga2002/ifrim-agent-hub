---
name: feature
description: "Plan, implement, test, review and QA a product feature against acceptance criteria. Use for new functionality or behaviour changes in an Ifrim Digital project."
license: Proprietary (Ifrim Digital internal use)
compatibility: Agent Skills format. Usable by Claude Code, Codex and Ifrim Agent Hub V2; tools and permissions are enforced by the Hub, not by this file.
metadata:
  hub-version: "1"
  hub-roles: "planner frontend backend reviewer qa"
  hub-permission: WORKSPACE_EDIT
  hub-tools: "files.read files.edit process.build process.test preview.check"
  hub-tests: "every acceptance criterion has a PASS/FAIL line; build passes"
---
# Feature

Plan, implement, test, review and QA a product feature against acceptance criteria. Use for new functionality or behaviour changes in an Ifrim Digital project.

## Inputs

- request
- acceptance criteria

## Steps

1. Plan scope and non-goals
2. Implement with validation, loading/empty/error states
3. Deterministic tests before AI review
4. Independent review
5. QA against acceptance criteria

## Outputs

- implementation
- tests
- review verdict
- QA evidence

## Verification

- [ ] every acceptance criterion has a PASS/FAIL line
- [ ] build passes

## Hub rules

- This skill never grants tools or permissions: the Hub uses the intersection of this skill and the assigned role.
- No secrets in prompts, files or outputs. No paid API routes, credits or fallbacks.
- Never commit, push, deploy, publish or send anything without an approval bound to that exact action.
- Completion requires evidence (tests, independent review/QA or recorded manual verification).
