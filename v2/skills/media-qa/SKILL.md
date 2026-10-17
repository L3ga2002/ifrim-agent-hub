---
name: media-qa
description: "Read-only QA of a rendered video against its brief, claims, captions, rights and platform profile. Findings carry timecodes, severity and evidence; measured values come from the Hub QA reports, heuristics are labelled. Use after a render, before the owner's creative decision."
license: Proprietary (Ifrim Digital internal use)
compatibility: Agent Skills format. Usable by Claude Code, Codex and Ifrim Agent Hub V2; tools and permissions are enforced by the Hub, not by this file.
metadata:
  hub-version: "1"
  hub-roles: "media-qa"
  hub-permission: READ_ONLY
  hub-tools: "files.read"
  hub-task-types: "content_qa"
  hub-tests: "every finding has a timecode, severity, observation and evidence; measured vs heuristic separated; no PASS with a blocking finding"
---
# Media QA: findings with timecodes

You check one exact render (edit version and render id). Assume it may be wrong. You only read and report; the creative approval is the owner's.

## Inputs

- the render id, its edit version and the EditProjectIR it came from
- the Hub QA reports for this render (technical, layout, factual, rights, editorial)
- the brief, the script and the claims with their status and evidence
- the target platform profile (canvas, safe area, caption defaults; treated as estimates to verify)

## Steps

1. Technical: read the Hub's measured values (loudness, true peak, silence, black, freeze, duration, resolution). Report them as measured, with the report they come from. A black or silent range inside a shot marked intentional is justified, not a defect.
2. Layout: captions (characters per second, at most 2 lines, overlaps), text inside the safe area, text or captions over an evidence region.
3. Factual: every on-screen statement and voice-over line maps to a SUPPORTED claim; shots labelled SIMULATION, RECONSTRUCTION, REPLAY or GENERATED show that label on screen.
4. Rights: every asset is cleared for the platform and use; AI-generated media carries disclosure.
5. Editorial (heuristic, say so): the hook is honest and clear within the first second, demo shots last long enough to read, the call to action is at the end, no long intro, duration fits the brief.
6. For each finding record: timecode (mm:ss.ff or frame range), severity (blocking, major, minor), category, observation, evidence (report field, frame, cue id), and a concrete correction proposal.

## Outputs

- status: PASS, FAIL or NEEDS_REVIEW
- findings with timecodes, severity, category, observation, evidence and proposal
- what was not checked and why

## Verification

- [ ] every finding has a timecode and evidence a person can reproduce
- [ ] measured values cite the Hub report; heuristics are labelled heuristic
- [ ] no PASS with a blocking finding, an unsupported claim or a missing label

## Hub rules

- This skill never grants tools, access, network or budget: the Hub applies the role's limits.
- Never approve, publish, upload or schedule; never mark a creative decision on the owner's behalf.
