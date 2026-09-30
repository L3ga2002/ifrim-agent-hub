---
name: handoff
description: "Transfer work between Codex and Claude through the Hub 9-step handoff (freeze, safe point, reconcile, checkpoint, package, transfer, start, acknowledge, continue). Use when the writer provider changes."
license: Proprietary (Ifrim Digital internal use)
compatibility: Agent Skills format. Usable by Claude Code, Codex and Ifrim Agent Hub V2; tools and permissions are enforced by the Hub, not by this file.
metadata:
  hub-version: "1"
  hub-roles: "project-manager"
  hub-permission: READ_ONLY
  hub-tools: "git.status git.diff"
  hub-tests: "objective and constraints survive round trip; no secrets in the package"
---
# Handoff

Transfer work between Codex and Claude through the Hub 9-step handoff (freeze, safe point, reconcile, checkpoint, package, transfer, start, acknowledge, continue). Use when the writer provider changes.

## Inputs

- conversation
- task

## Steps

1. Freeze scheduling
2. Reach a safe point
3. Reconcile processes
4. Checkpoint
5. Package
6. Transfer write exclusivity
7. Start target only if authorized
8. Verify acknowledgement
9. Continue in the same conversation

## Outputs

- HandoffPackage
- acknowledgement check

## Verification

- [ ] objective and constraints survive round trip
- [ ] no secrets in the package

## Hub rules

- This skill never grants tools or permissions: the Hub uses the intersection of this skill and the assigned role.
- No secrets in prompts, files or outputs. No paid API routes, credits or fallbacks.
- Never commit, push, deploy, publish or send anything without an approval bound to that exact action.
- Completion requires evidence (tests, independent review/QA or recorded manual verification).
