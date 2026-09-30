---
name: audit-site
description: "Audit a business website: confirm the business and domain with dated sources, measure instead of guessing, separate findings from suggestions. Use for sales-side website audits."
license: Proprietary (Ifrim Digital internal use)
compatibility: Agent Skills format. Usable by Claude Code, Codex and Ifrim Agent Hub V2; tools and permissions are enforced by the Hub, not by this file.
metadata:
  hub-version: "1"
  hub-roles: "website-auditor"
  hub-permission: READ_ONLY
  hub-tools: "browser.inspect memory.search"
  hub-tests: "domain confirmation has a source; no invented metrics"
---
# Site audit

Audit a business website: confirm the business and domain with dated sources, measure instead of guessing, separate findings from suggestions. Use for sales-side website audits.

## Inputs

- business name
- candidate domain

## Steps

1. Identify the business and confirm the domain with a dated source
2. Measure, do not guess
3. Separate findings from suggestions

## Outputs

- verified business + domain with source/date
- findings
- separate suggestions

## Verification

- [ ] domain confirmation has a source
- [ ] no invented metrics

## Hub rules

- This skill never grants tools or permissions: the Hub uses the intersection of this skill and the assigned role.
- No secrets in prompts, files or outputs. No paid API routes, credits or fallbacks.
- Never commit, push, deploy, publish or send anything without an approval bound to that exact action.
- Completion requires evidence (tests, independent review/QA or recorded manual verification).
