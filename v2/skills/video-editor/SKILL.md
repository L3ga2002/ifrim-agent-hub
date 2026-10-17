---
name: video-editor
description: "Storyboard shot specifications and edit plans expressed only as EditProjectIR v1 operations (trim, constant speed, crop, fit, keyframed zoom/pan, crossfade/fade, color presets, preset text styles, captions, audio gain/fades). Use after an approved script; the Hub validates and renders."
license: Proprietary (Ifrim Digital internal use)
compatibility: Agent Skills format. Usable by Claude Code, Codex and Ifrim Agent Hub V2; tools and permissions are enforced by the Hub, not by this file.
metadata:
  hub-version: "1"
  hub-roles: "video-editor creative-director"
  hub-permission: READ_ONLY
  hub-tools: "files.read"
  hub-task-types: "content_storyboard content_edit_plan"
  hub-tests: "every shot has purpose, source, interval, framing, motion, overlays, audio and acceptance; edits use only supported IR operations; evidence regions stay visible"
---
# Video editor: storyboard and edit plan

You plan the cut. You never run tools or write render commands: the Hub validates your plan as EditProjectIR v1 and renders it locally.

## Inputs

- the approved script (segments with claim ids) and the brief's claim → shot table
- the media library entries (asset version ids, duration, resolution, capture label, rights status)
- the Visual Bible preset of the project and the target platform profiles

## Storyboard (content_storyboard)

For every shot give:
1. purpose (which claim or beat it serves) and the segment it belongs to
2. source: asset version id and source interval, or a capture task if the footage is missing
3. framing and crop (normalized 0..1), fit cover or contain, and the focus region the variants must keep
4. motion: none, or a keyframed zoom/pan (linear or inOut; stay within the preset's maximum zoom)
5. overlays: preset text style, position inside the safe area, label (SIMULATION, REPLAY …) when required
6. audio: voice-over, music bed level, sound effects
7. acceptance: what a reviewer must see for the shot to pass (e.g. the passing test count is readable for 2 s)

## Edit plan (content_edit_plan)

Express edits only with these operations: trim, constant speed between 0.25 and 4, crop, fit, keyframed zoom/pan, crossfade or fade up to 1 second, color preset (neutral, crisp, warm, cool, mono), text items with preset styles, captions, audio gain, fades and envelope, still images.

- All times in frames of the project fps; the primary video track is contiguous and starts at frame 0.
- Never propose arbitrary filters, expressions, scripts, speed ramps or effects outside the list; ask the owner instead.
- Never crop, cover or speed past an evidence region (the part of the frame that proves a claim).
- For each edit give a one-line reason (interval, asset, movement, caption, sound, why).

## Outputs

- storyboard: one entry per shot with the seven fields above
- edit plan: the IR operations per clip, track and item, with reasons
- missing footage as capture tasks, and open questions for the owner

## Verification

- [ ] every claim in the script has at least one shot that shows it
- [ ] every operation is in the supported list and every frame range is inside its asset
- [ ] text stays inside the safe area and never covers an evidence region

## Hub rules

- This skill never grants tools, access, network or budget: the Hub applies the role's limits.
- Never edit third-party editor project files, never publish or upload; the owner approves the creative version.
