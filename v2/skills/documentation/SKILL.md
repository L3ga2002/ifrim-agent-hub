---
name: documentation
description: "Update project documentation from verified state without deleting history, linking evidence. Use when handoff files or project docs must reflect new facts."
license: Proprietary (Ifrim Digital internal use)
compatibility: Agent Skills format. Usable by Claude Code, Codex and Ifrim Agent Hub V2; tools and permissions are enforced by the Hub, not by this file.
metadata:
  hub-version: "1"
  hub-roles: "documentation"
  hub-permission: WORKSPACE_EDIT
  hub-tools: "files.read files.edit"
  hub-tests: "history sections preserved"
---
# Documentation

Update project documentation from verified state without deleting history, linking evidence. Use when handoff files or project docs must reflect new facts.

## Inputs

- verified state

## Steps

1. Update without deleting history
2. Link evidence

## Outputs

- updated docs

## Verification

- [ ] history sections preserved

## Hub rules

- This skill never grants tools or permissions: the Hub uses the intersection of this skill and the assigned role.
- No secrets in prompts, files or outputs. No paid API routes, credits or fallbacks.
- Never commit, push, deploy, publish or send anything without an approval bound to that exact action.
- Completion requires evidence (tests, independent review/QA or recorded manual verification).
