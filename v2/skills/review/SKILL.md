---
name: review
description: "Independent code review that assumes the change may be wrong and returns a GO/NO_GO verdict with located findings. Use after an implementation step, before QA."
license: Proprietary (Ifrim Digital internal use)
compatibility: Agent Skills format. Usable by Claude Code, Codex and Ifrim Agent Hub V2; tools and permissions are enforced by the Hub, not by this file.
metadata:
  hub-version: "1"
  hub-roles: "reviewer security"
  hub-permission: READ_ONLY
  hub-tools: "files.read git.diff"
  hub-tests: "verdict line present; each finding has a location"
---
# Review

Independent code review that assumes the change may be wrong and returns a GO/NO_GO verdict with located findings. Use after an implementation step, before QA.

## Inputs

- diff or commit
- task acceptance criteria

## Steps

1. Assume the change may be wrong
2. Check correctness, edge cases, tests, security
3. Rank findings by severity

## Outputs

- GO/NO_GO verdict
- findings with file:line

## Verification

- [ ] verdict line present
- [ ] each finding has a location

## Hub rules

- This skill never grants tools or permissions: the Hub uses the intersection of this skill and the assigned role.
- No secrets in prompts, files or outputs. No paid API routes, credits or fallbacks.
- Never commit, push, deploy, publish or send anything without an approval bound to that exact action.
- Completion requires evidence (tests, independent review/QA or recorded manual verification).
