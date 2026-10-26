# Stage 2026-10-26 — L3ga fixes after the owner's session of 2026-10-25 (`2.19.1-m16`)

## Why

On 2026-10-25 (18:12–18:19 Romania, 16:12–16:19 UTC) the owner used L3ga by voice right after M16 went live and did not accept M16.
Read back from the live journal (GET `/api/events/query?type=lega.`, `/api/commands`), nothing written:

| Time (UTC) | Owner | What happened |
| --- | --- | --- |
| 16:12:50 | typed „„L3ga, mod comandă” (copied with its quote from the acceptance steps) | `unknown`, no answer |
| 16:13:47–16:14:47 | „Ce s-a întâmplat azi”, „Următorul”, „Repetă”, „Ok, oprește” | worked (recap) |
| 16:14:55 | „Arată harta companiei” | the figure became the particle graph (~80 px); the readable map stayed behind the chat |
| 16:15:21 | „Poți să o mărești” | `unknown`; Lega: „Hub-ul nu poate mări harta încă.” |
| 16:15:35 | „Ok, trece asta pe un wishlist” | `unknown`; the agent turn started and never answered nor called a tool |
| 16:15:59–16:17:48 | „Și mai vreau pe wishlist acest chat … să-l pot minimiza ca să văd harta completă”, „Ai trecut pe wishlist”, „Păi ce verifici, fă un wishlist nou”, „Harta companiei din nou”, „La vânzări” | every one: „O clipă, verific.” and nothing more |
| 16:19:39 | Stop All (UI) | the silent turn was interrupted only now |

## What changed (code `d3d1412` + `434999b` + `7d821ae`, base `dd831d3`)

- **Silent turn** (`runtime/lega.mjs`, `providers/codex-realtime.mjs`): a delegated turn's watchdog is re-armed on every sign of work (turn
  start, item started / completed, tool call, web search); after 45 s of silence (3 min cap) the turn alone is interrupted
  (`turn/interrupt`) and the Hub says `TURN_STALL_TEXT`, unless it already answered that sentence itself; a new, different request
  supersedes a turn silent for 20 s (no speech). Journal: `lega.turn_stalled` (ids and numbers only).
- **Wishlist** (`owner/wishlist.mjs`, migration 16 `l3ga-wishlist`, schema 16): intents `wishlist_add` (SIMPLE_LOCAL_ACTION: typed, or a
  provider transcript under the derived owner authority) and `wishlist_list` (read), whole-sentence matcher `wishlistMatch` (the item keeps
  the owner's raw words); „asta” = the last sentence the Hub could not do in this owner session (memory, 15 min, never a greeting, never a
  sentence the Hub answered, never document / media text). Routes GET `/api/wishlist`, POST `/api/wishlist`, `/api/wishlist/:id/status`
  (commands `wishlist.add`, `wishlist.status`); agent and cli refused. The Hub answers itself (text and voice); the agent's answer is withheld.
- **Map and conversation** (`web/src/lib/legaMapView.js`, `screens/lega/MapPanel.jsx`): the M16 readable map (`CompanyGraph`, `Department`)
  in the L3ga center; „Mărește” = open → whole screen (conversation minimized, side columns hidden) → zoom 125…250%; buttons, mouse wheel,
  drag; „La vânzări” opens the department on that map (typed or voice); intents `map_view`, `chat_view` (view only; live event `lega.view`).
- **Wishlist panel** (`screens/lega/WishlistPanel.jsx`) in the L3ga side column; a wishlist answer brings it into view.
- Quoted examples: `QUOTED_NAVIGATE_READS` includes the M16 screens; an unknown sentence's reply names „Pune asta pe wishlist”.
- API contract 22 (additive). `m16-voice.test.mjs` used a fixed clock of 2026-10-25 and failed after that day on M16 too: real clock now.

## Evidence

- New tests `l3ga-fix-2191.test.mjs` (L3-01…06: the owner's sentences, wishlist through text / screen / voice, silent turn, superseded turn,
  long working turn not cut, agent/cli refused) and `l3ga-fix-2191-ui.test.mjs` (view logic + real Chromium: map, full screen, zoom by
  words / button / wheel, no overlapping cards at 1920×1080 / 1280×800 / 1024×768, department on the map, wishlist panel, quoted
  „L3ga, mod comandă”). Mutation checks: without the watchdog L3-03/04 fail; without the activity re-arm L3-05 fails.
- One independent read-only review (3 major + 6 minor findings, all fixed: inactivity instead of age, supersede only silent + different
  turns, agent/cli guard, no speech after a real answer, `lastUnknown` conditions, negation only before the wishlist word, exact item offsets,
  relative department by voice on the map).
- The touched suites (59 files) green after fixes. Full gate in a clean clone (`l3ga-gate`) on `d3d1412`: V2 2760/2762, 1 skip (T25), 1 fail
  = the structural check M12-FA-ANS-09 (a declaration placed between two lines it pins), fixed in `7d821ae`. The delta after the gate
  (`434999b`: a stalled turn no longer counts as busy for the idle stop, more read phrasings, from a second independent review; `7d821ae`)
  was re-run on the affected suites: 87/87 (proportional rule: no second full gate for this delta).
- The owner chose line A (this one) on 2026-10-26 12:09 UTC („ok” to the A/B question); `m17-stage` stays local and unreleased.
- Synthetic demo Hub on port 8012 (`l3ga-evidence\demo`), screenshots in `l3ga-evidence\shots`.
