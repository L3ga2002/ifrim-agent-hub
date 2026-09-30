---
name: offer
description: "Draft a commercial offer from verified client context, labelled DRAFT and never sent. Use when preparing a proposal for the owner to review."
license: Proprietary (Ifrim Digital internal use)
compatibility: Agent Skills format. Usable by Claude Code, Codex and Ifrim Agent Hub V2; tools and permissions are enforced by the Hub, not by this file.
metadata:
  hub-version: "1"
  hub-roles: "sales-assistant"
  hub-permission: READ_ONLY
  hub-tools: "memory.search"
  hub-tests: "draft is labelled DRAFT; nothing is sent"
---
# Offer draft

Draft a commercial offer from verified client context, labelled DRAFT and never sent. Use when preparing a proposal for the owner to review.

## Inputs

- scope
- verified client context

## Steps

1. Draft from verified context
2. Flag assumptions
3. Hand to the user for review

## Outputs

- offer draft (not sent)

## Verification

- [ ] draft is labelled DRAFT
- [ ] nothing is sent

## Hub rules

- This skill never grants tools or permissions: the Hub uses the intersection of this skill and the assigned role.
- No secrets in prompts, files or outputs. No paid API routes, credits or fallbacks.
- Never commit, push, deploy, publish or send anything without an approval bound to that exact action.
- Completion requires evidence (tests, independent review/QA or recorded manual verification).
