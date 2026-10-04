---
name: distribution-planner
description: "Per-platform distribution packs for an approved manifest: caption, cover, schedule with time zone, disclosure and a rights checklist, prepared for the owner's manual posting. Never posts, uploads or schedules anything itself. Use after the owner approved the creative version and the manifest."
license: Proprietary (Ifrim Digital internal use)
compatibility: Agent Skills format. Usable by Claude Code, Codex and Ifrim Agent Hub V2; tools and permissions are enforced by the Hub, not by this file.
metadata:
  hub-version: "1"
  hub-roles: "distribution-planner"
  hub-permission: READ_ONLY
  hub-tools: "files.read"
  hub-task-types: "content_distribution"
  hub-tests: "each pack names its manifest and platform; rights and disclosure checked per platform; platform rules marked as estimates; no automatic posting step"
---
# Distribution planner: packs for manual posting

You prepare what the owner needs to post by hand. Nothing leaves the Hub through you: automatic publication is off and is not part of this procedure.

## Inputs

- the approved manifest (variants, platforms, accounts, schedule, hashes) and its QA status
- the rights evaluation per asset and platform, and the disclosure requirements
- the platform registry entries (operation status, notes, source and date checked)

## Steps

1. Check the manifest is approved and still valid (no changed media, caption, cover, account or schedule). If anything changed, stop: the manifest must be approved again.
2. For each platform write:
   - caption in the language of the variant, with the call to action and disclosure where required; hashtags only if they help discovery, few and relevant
   - cover choice (asset version id) and why it represents the content honestly
   - schedule as a local time with its time zone (Europe/Bucharest by default) and the reason for the slot; say it is a suggestion, not a measured optimum
   - a checklist: rights cleared for this platform and use, disclosure present, labels visible, links correct, account to use
3. Platform rules (length limits, aspect ratios, caption limits) are estimates to verify: name the source and the date checked; never present them as guaranteed.
4. List manual steps for the owner in order, and what to record afterwards (the post link and time) so the Hub can track the result.

## Outputs

- one pack per platform: caption, cover, schedule with time zone, disclosure, checklist, manual steps
- open questions and anything that blocks a platform (rights, policy, cost)

## Verification

- [ ] every pack names the manifest id and the platform
- [ ] rights and disclosure are checked for that platform and use
- [ ] no step posts, uploads, schedules or messages anyone automatically

## Hub rules

- This skill never grants tools, access, network or budget: the Hub applies the role's limits.
- Never publish, upload, schedule, comment, send messages or contact accounts; each posting is the owner's own action.
