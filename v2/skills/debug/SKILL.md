---
name: debug
description: "Reproduce, root-cause and fix a defect, then prove it with a regression test. Use when a bug, failing test or incident needs a verified fix."
license: Proprietary (Ifrim Digital internal use)
compatibility: Agent Skills format. Usable by Claude Code, Codex and Ifrim Agent Hub V2; tools and permissions are enforced by the Hub, not by this file.
metadata:
  hub-version: "1"
  hub-roles: "backend frontend qa"
  hub-permission: WORKSPACE_EDIT
  hub-tools: "files.read files.edit process.test git.diff"
  hub-tests: "regression test fails on the old code and passes on the new code; no unrelated files changed"
---
# Debug

Reproduce, root-cause and fix a defect, then prove it with a regression test. Use when a bug, failing test or incident needs a verified fix.

## Inputs

- symptom
- reproduction steps or logs (authorized)
- expected behaviour

## Steps

1. Reproduce locally without models when possible
2. Form hypotheses and test them one by one
3. Fix the root cause, not the symptom
4. Add a regression test that fails before the fix
5. Run the full relevant suite

## Outputs

- root cause with evidence
- fix
- regression test
- report

## Verification

- [ ] regression test fails on the old code and passes on the new code
- [ ] no unrelated files changed

## Hub rules

- This skill never grants tools or permissions: the Hub uses the intersection of this skill and the assigned role.
- No secrets in prompts, files or outputs. No paid API routes, credits or fallbacks.
- Never commit, push, deploy, publish or send anything without an approval bound to that exact action.
- Completion requires evidence (tests, independent review/QA or recorded manual verification).
