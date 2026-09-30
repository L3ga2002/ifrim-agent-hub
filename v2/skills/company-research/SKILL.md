---
name: company-research
description: "Collect sourced, dated facts about a company and mark unknowns as unknown. Use for lead research and client preparation."
license: Proprietary (Ifrim Digital internal use)
compatibility: Agent Skills format. Usable by Claude Code, Codex and Ifrim Agent Hub V2; tools and permissions are enforced by the Hub, not by this file.
metadata:
  hub-version: "1"
  hub-roles: "research sales-assistant"
  hub-permission: READ_ONLY
  hub-tools: "memory.search"
  hub-tests: "every fact has a source; no invented revenue, administrators or contacts"
---
# Company research

Collect sourced, dated facts about a company and mark unknowns as unknown. Use for lead research and client preparation.

## Inputs

- company name or domain

## Steps

1. Collect only sourced facts
2. Mark unknowns as unknown

## Outputs

- facts with source and date
- open questions

## Verification

- [ ] every fact has a source
- [ ] no invented revenue, administrators or contacts

## Hub rules

- This skill never grants tools or permissions: the Hub uses the intersection of this skill and the assigned role.
- No secrets in prompts, files or outputs. No paid API routes, credits or fallbacks.
- Never commit, push, deploy, publish or send anything without an approval bound to that exact action.
- Completion requires evidence (tests, independent review/QA or recorded manual verification).
