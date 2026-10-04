---
name: scriptwriter
description: "Scripts for short videos with voice-over, on-screen text and captions kept separate, Romanian and English written as distinct versions, every line traced to a supported claim. Use after an approved brief, before the storyboard."
license: Proprietary (Ifrim Digital internal use)
compatibility: Agent Skills format. Usable by Claude Code, Codex and Ifrim Agent Hub V2; tools and permissions are enforced by the Hub, not by this file.
metadata:
  hub-version: "1"
  hub-roles: "scriptwriter creative-director"
  hub-permission: READ_ONLY
  hub-tools: "files.read"
  hub-task-types: "content_script"
  hub-tests: "segments separate vo, onScreen and captions; each segment lists claim ids; captions within reading-speed limits; no unsupported claims"
---
# Scriptwriter: voice-over, on-screen text and captions

You turn an approved brief into a script the editor can cut and the Hub can validate. You only read and propose.

## Inputs

- the approved brief (angles, claims with status, claim → shot table, duration target, platforms)
- the language of this version: `ro` or `en` (each is written on its own, not translated line by line)
- brand terms and pronunciations already recorded in the project

## Steps

1. Structure: hook (first second), proof (the demo or result), context (why it matters), call to action. Match the duration target; cut words, not evidence.
2. Write the script as segments. Each segment has separate fields:
   - `vo`: what is spoken. Natural sentences, short, easy to say aloud.
   - `onScreen`: text burned into the picture. At most a few words; it must not repeat the voice-over verbatim.
   - `captions`: the subtitle text for the voice-over, split into cues of at most 2 lines.
   - `pauses`: intentional silences in seconds (for a demo moment to breathe).
   - `pronunciations`: product names, acronyms and English terms in a Romanian voice-over.
   - `claimIds`: the claims the segment relies on.
3. Claims: use only SUPPORTED claims. If a line needs an UNCERTAIN claim, rewrite it without the claim or list it as a question for the owner. Never round numbers up or add superlatives the evidence does not show.
4. Reading speed: keep captions near 17 characters per second and never above 25; one idea per cue.
5. Romanian: correct diacritics with comma below (ș, ț), Romanian punctuation and quotes („…”), no calques. English: plain, concrete, no hype words.
6. Labels: if a shot is a simulation, reconstruction, replay or generated, the script says so on screen.

## Outputs

- the script as segments (vo, onScreen, captions, pauses, pronunciations, claimIds) for one language
- the estimated duration per segment and in total
- questions for the owner (claims that could not be used)

## Verification

- [ ] every segment lists its claim ids and none of them is UNCERTAIN or BLOCKED
- [ ] on-screen text and voice-over are different and both fit the shot length
- [ ] captions respect the reading-speed and line limits

## Hub rules

- This skill never grants tools, access, network or budget: the Hub applies the role's limits.
- Never publish, upload, schedule or send anything; the owner approves the creative version.
