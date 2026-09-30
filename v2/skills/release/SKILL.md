---
name: release
description: "Prepare a release checklist and the exact commit/tag/deploy commands without executing them; each external step needs an approval bound to that exact command. Use before shipping."
license: Proprietary (Ifrim Digital internal use)
compatibility: Agent Skills format. Usable by Claude Code, Codex and Ifrim Agent Hub V2; tools and permissions are enforced by the Hub, not by this file.
metadata:
  hub-version: "1"
  hub-roles: "devops"
  hub-permission: EXTERNAL_ACTIONS
  hub-tools: "git.status git.diff"
  hub-tests: "no push/deploy without an approval bound to the exact command"
---
# Release

Prepare a release checklist and the exact commit/tag/deploy commands without executing them; each external step needs an approval bound to that exact command. Use before shipping.

## Inputs

- verified build
- release notes

## Steps

1. Verify tests/build/restore
2. Prepare commit/tag/deploy commands
3. Request action-bound approval for each external step

## Outputs

- release checklist
- prepared commands (not executed)

## Verification

- [ ] no push/deploy without an approval bound to the exact command

## Hub rules

- This skill never grants tools or permissions: the Hub uses the intersection of this skill and the assigned role.
- No secrets in prompts, files or outputs. No paid API routes, credits or fallbacks.
- Never commit, push, deploy, publish or send anything without an approval bound to that exact action.
- Completion requires evidence (tests, independent review/QA or recorded manual verification).
