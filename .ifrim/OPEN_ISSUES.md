# Open Issues - Ifrim Agent Hub

## 2026-10-22 — M13 „Birou intern”: Operations / Customer Support / Finance-Admin (code `2.16.0-m13`, migration 14, API contract 18; detail: `.ifrim/STAGE_2026-10-22_M13.md`)

This section takes precedence over the next ones where they overlap. Built in the dev clone C:\Users\mihai\m13-stage (branch
`claude/project-thread-nslsrr`, code `fb7e3f2`..`8f93909`): the start dossier (Operations), the support case with a DRAFT_ONLY reply
(Customer Support) and the deviz in draft with an internal register (Finance-Admin), each ONE card in L3ga; the reply / deviz approved
on its exact id + SHA in the owner session; derived exports; nothing sent / issued / handed off / run. Gate on `8f93909`: V2 2595/2596 0 fail
(T25 skip); V1 549/552 (the 2 known registry tests).

Open:
1. Done: 2.16.0 LIVE 2026-10-22 16:43 UTC (GET VERIFY OK, boot boot_mvjrrvw0_cbcb393952, backup bkp_mvjrqvre_68afc3be84; origin = f328c3a). Probes done
   16:46–16:47 UTC with the owner's 5 decisions: OPS-0001 READY, SUP-0001 READY (reply approved, unsent, case open), DVZ-0001 READY (Word
   APP_VERIFIED + PDF); every export = its manifest; 0 sends / contacts / handoffs / missions / runs. Closing docs only in m13-stage (next release).
   Minor: the support request text keeps an unmatched closing „”” when the owner quotes the sentence (strip unmatched quotes in supportRequestOf).
   Not M13: the M12 dossier revision 2 is STALE since 2026-10-20 00:34 UTC (the owner approved the contact draft's text); a continuation makes rev 3.
2. Known limits (not defects): flows are synthetic-only in M13 (CHECK synthetic = 1); the support reply cites the accepted package's
   criteria by shared words (no model: a question the criteria do not cover is answered „verificăm și revenim”); no Factory mission is
   created from a start dossier (the SPEC_DRAFT sketch stays text until the client's acceptance); a Lega read („arată dosarul de pornire”)
   is not added — the L3ga panel shows the records; the departments Customer Success / Finance-Admin keep their seeded „planned” status.
3. Unchanged: the live dev profile is ON (decisions recorded local_dev_profile); RM-10 intermittent under load; 2 V1 tests on the real registry.

## 2026-10-19 — catalog minim și o ofertă Sales utilă (code `2.15.5-m12`, no migration; detail: `.ifrim/STAGE_2026-10-19_CATALOG_OFERTA.md`)

This section takes precedence over the next ones where they overlap. Two defects blocked the requested flow and are fixed in `db7cc0c` + `a20d77f`
(dev clone C:Usersmihaihub-cat): a saved catalog service never reached the M12 offer and never made the READY preparation continuable;
the service editor had no materials field and an edit dropped them. Tests: R-CAT-01..03 (3/3 FAIL before, PASS after) + 42 affected files 412/412.

Open:
1. Done: 2.15.5 LIVE (GET VERIFY OK 2026-10-20 00:33 UTC, boot boot_mvfy5813_c620e596e0; origin v2-milestone-01 = 3a3abdb).
2. Done: service svc_mvfy6xjo_0a4dbd077d saved by the owner; offer v2 spr_mvfy7mq5_9ffac33cbc approved (sha 458681c2…c637); dossier
   revision 2 sdo_b0b208ad82_5b5c17a433 READY (10/10 = manifest, Word APP_VERIFIED, draft unsent); v1 + revision 1 kept. M13 = proposal only.
3. Known limit (not a defect): with two or more active services a bound offer without a service on its opportunity uses none (no guess);
   choosing a service per opportunity in M12 is later work. Price and term stay „De stabilit” until the owner configures them.
4. Unchanged: the live dev profile is ON (decisions recorded local_dev_profile); RM-10 intermittent under load; 2 V1 tests on the real registry.

## 2026-10-18 afternoon (2) — the full Lega screen (code `2.15.4-m12`, UI only) + the live M12 probe (detail: `.ifrim/STAGE_2026-10-18_L3GA_UNIC.md` §7–§8)

This section takes precedence over the next one where they overlap. 2.15.3 is LIVE (owner's CMD ~12:00 UTC, GET VERIFY OK). The single live M12
probe ran through #/lega with the owner's two decisions: dossier `sdo_12cec46b1e_7ce44b92b4` READY (Word APP_VERIFIED, 10/10 files = manifest,
draft DRAFT_ONLY unsent, nothing sent / CONTACTED / WON / handed off); both decisions recorded as `local_dev_profile` (the live dev profile is on).
2.15.4 (commit `533cb57`): „Ecran complet” like the old stage (remembered, „Tot monitorul”) + a fix for a plan announced before the layout loaded
(no card); 13 test files 86/86.

Open:
1. Done: 2.15.4 LIVE (GET VERIFY OK 2026-10-18 22:15 UTC, boot boot_mvedo9xq_69194966b6; origin = 6cba12e).
2. Owner decision: the offer explains no concrete benefit while the service catalog is empty — define the service (Vânzări → Servicii,
   owner session) or decide another rule; then a new revision through the continuation card.
3. Owner decision: turn the local dev profile off on live (`node v2\scripts\dev-profile.mjs off`) if decisions must be Windows Hello.

## 2026-10-18 afternoon — one L3ga screen (code `2.15.3-m12`, UI only, API contract 17, schema 13, no migration; detail: `.ifrim/STAGE_2026-10-18_L3GA_UNIC.md`)

This section takes precedence over every older one where they overlap. Closed in code (commit `289dc63` on `claude/project-thread-dx5843`,
dev clone C:\Users\mihai\hub-ui): `#/lega` is the one Lega interface (company map behind; figure, conversation + unsent text per project,
docked voice panel of the one session, controls, decisions / executions, plan cards, Sales offer + dossier card); the cockpit's small column
and the modal stage are retired; „Ecran complet” = the same screen without the bars; old links land on it; one audio capture at a time.
Independent read-only review: 0 critical; 2 important (immersive z-order / hidden bars; Esc in a dialog left the full screen) and 5 medium
(dismissed offers taking turns, stale option buttons after a remount, the copy of an exchange into another project, controls out of view
in a short window, duplicate Stop All target) — all fixed or covered, with browser checks in R-LEGA-ONE-04. Tests: the 66 files that read
the web UI or drive a browser, on the pre-review build: 630 = 627 pass, 3 fail (R3-UI-09/10 pinned the work column's class name → kept;
R-LEGA-ONE-04's new checks on the pre-fix build → expected; RM-10 real capture under 97 % CPU → intermittent, as before); rerun on the
final build: 290/290 (31 files incl. every browser suite, RM-10 passed) + 66/66 (8 UI-logic files). No full suite: no server code changed.

Open:
1. Owner: run C:\Users\mihai\lega-one-stage\release\owner-release.cmd (verified backup → ff v2-milestone-01 → managed upgrade, which
   rebuilds the UI → GET verify 2.15.3-m12 / 17 / schema 13 + the served UI's one-screen markers → push). Until then live stays 2.15.2-m12.
2. Then the single live M12 Sales probe through #/lega (the owner types or says the request, confirms the sales.prepare card, inspects and
   approves the exact offer id + SHA); result and files recorded in the stage document §7.
3. Unchanged, separate: the backup interrupted by a Hub stop; the local dev profile; real prices / services; RM-10 intermittent under load;
   the 2 V1 real-registry tests; the Mini-asistent (Alt+M) stays a separate compact view (not the cockpit column).

## 2026-10-18 — 13 defects fixed + Sales decisions bound to the owner session (code `2.15.2-m12`, API contract 17, schema 13, no migration; detail: `.ifrim/STAGE_2026-10-18_FIX13_SALES.md`)

This section takes precedence over every older one where they overlap. Closed in code (branch `claude/project-thread-pcocmw` in the dev clone
C:\Users\mihai\hub-fix, commits `f56d64b` … `b461eb2` + docs): the 13 verified defects (B2 conversation freeze on "```js title"; B9/B22 Factory
spec editor; A16 PASS review quoting code; A26/A27 redaction; A36/A35/A3 Lega autonomy / freeze / unfreeze on the wrong project and unfreeze
on a question / condition / negation; A12 failed backup left running; A10 one unreadable file failing the search; A38 handoff / checkpoint
test results of every project; B42 retry dropping task and effort; B39 verification note on another task), each with a regression test
(`v2/tests/r-fix13.test.mjs`, all failing on 3d9b3e8). Sales: sales.draft.approve_content, sales.suppression.lift and sales.import.rollback are
reserved owner decisions like sales.proposal.approve; sales.service.save only in a fresh owner session re-read in the transaction
(`v2/tests/r-sales-owner.test.mjs`). Independent review: 0 critical / 0 important; its 5 minor findings fixed (`b1a2bdb`). Final gate on
`b461eb2` (fresh clone C:\Users\mihai\hub-fix-gate, logs C:\Users\mihai\fix-stage\gate\run-final): test:v2 exit 0, **2566 = 2565 pass, 0 fail,
1 skip (T25)**; V1 552 = 549 pass, 2 fail (the 2 real-registry tests), 1 skip. The first gate run (5134314) had 1 fail caused by the stage
(M04-BR-01 looked for the old button), fixed in b461eb2.

Open:
1. Owner: run C:\Users\mihai\fix-stage\release\owner-release.cmd (verified backup → ff v2-milestone-01 → managed upgrade → GET verify
   2.15.2-m12 / 17 / schema 13 → push v2-milestone-01 + claude/project-thread-pcocmw). Until then live stays 2.15.1-m12, where the four Sales
   commands still accept ui (live Sales is empty: 0 orgs, 0 services, 0 pending approvals).
2. Unchanged, separate: a backup interrupted by a Hub stop (process killed, not an error) is not reconciled at boot; the local dev profile;
   real prices / services; RM-10 intermittent; the 2 V1 real-registry tests; the remaining ~70 report items (cosmetic, unreachable, not bugs, V1).

## 2026-10-17 evening — factory.reject owner authority (code `2.15.1-m12`, API contract 16, schema 13, no migration; LIVE since 2026-10-17 ~18:01 UTC; detail: `.ifrim/STAGE_2026-10-17_FACTORY_REJECT.md`)

This section takes precedence over every older one where they overlap. Closed in code (commit `6aa8575` on `claude/project-thread-esyt99`,
dev clone C:\Users\mihai\hub-reject): `factory.reject` only on the owner channel (fresh session at the command, re-read before and after
the preview stop) or the bounded test channel; POST /api/factory/:id/reject moved to the owner routes (no idempotency replay); the exact
displayed target (`view.rejectTarget`: mission factory version + waiting bundle id and full sha, or none) checked by compare-and-swap in the
final transaction; one recorded decision (event `factory.rejected`, authority webauthn / local_dev_profile / test); repeats return it,
another reason or target is refused. Synthetic reproduction on 161fdf2: sessionless reject → 200 REJECTED; on 6aa8575 → 401/401/403, nothing
written. Gate on 6aa8575 (fresh clone C:\Users\mihai\hub-reject-gate, logs C:\Users\mihai\reject-stage\gate\run-final): test:v2 exit 0,
**2539 = 2538 pass, 0 fail, 0 cancelled, 1 skip (T25)**; V1 552 = 549 pass, 2 fail (the 2 real-registry tests), 1 skip. Independent
read-only review: 0 critical / 0 important (1 medium: the preview stops before the final check, as for accept).

Open:
1. Done: the owner ran C:\Users\mihai\reject-stage\release\owner-release.cmd (~18:01 UTC): verified backup bkp_mvcpdvsa_450d87ca39,
   fast-forward of v2-milestone-01 to 5b08866, managed upgrade (boot boot_mvcpeczj_834544baf3, BUILD_SAFE), GET verify 2.15.1-m12 / 16 /
   schema 13 / factory.reject channels owner + test with displayedVersion required, push v2-milestone-01 + claude/project-thread-esyt99
   (both 5b08866). Live missions unchanged (3 DELIVERY_READY, 4 NEEDS_OWNER_DECISION, 0 factory.rejected events); nothing was rejected.
2. Unchanged, separate: M04 sessionless approvals and the catalog, real prices / services, the local dev profile (a loopback process can
   open a session; a rejection made so is recorded local_dev_profile), RM-10 (passed in this gate), the 2 V1 real-registry tests, step-0
   author and minor display items.

## 2026-10-17 — M12 Sales LIVE (code and live `2.15.0-m12`, API contract 15, schema 13; detail: `.ifrim/STAGE_2026-10-17_M12_SALES.md`)

This section takes precedence over every older one where they overlap. The owner activated `.ifrim/M12_PROMPT.md` (2fa81a9) with
clarifications 1–6 on 2026-10-16 20:21 UTC. Part 1 by Codex; Codex usage limit at 21:41 UTC (reset 2026-10-22); the owner moved parts 2–4
to Claude at 21:45 UTC. Merge `dc4500f` on `v2-milestone-01` (tree = gated `d311980`); verified backup `bkp_mvcejgzd_fb1915d20d`.
Final gate on `d311980` (fresh clone C:\Users\mihai\hub-m12-gate, logs C:\Users\mihai\m12-sales\gate\run-final2): test:v2
2512 = 2510 pass, **1 fail (RM-10, real capture, outside M12; passes alone 11/11)**, 1 skip (T25); V1 549/552 (the 2 real-registry tests).
LIVE since 2026-10-17 13:29 UTC: the owner ran owner-release.cmd (managed upgrade, boot boot_mvcfoc6g_ecc68eea7c, BUILD_SAFE; storage.pre_migration_backup event 8710; GET /api/health 2.15.0-m12 / contract 15, /api/diagnostics schemaVersion 13; pushed v2-milestone-01 = 5a6082e and claude/project-thread-azwsjr = d311980). Boot events: only the 6 known delivery.stale_reconcile_refused, no sales.* event; live Sales: 0 orgs, 0 services, outreach and live research DISABLED.

Open:
1. Owner: run C:\Users\mihai\m12-sales\owner-release.cmd (plan → apply upgrade → GET verify 2.15.0-m12 / 15 / schema 13 → push
   v2-milestone-01 + claude/project-thread-azwsjr), or ask for a new full gate first because of RM-10.
2. Catalog and real prices: BLOCKED BY EVIDENCE (offers say "De stabilit (neconfigurat)").
3. factory.reject without an owner session — still the priority fix before any new Factory project (M12 never calls the Factory).
4. M04 approvals not used by M12 still sessionless on ui: sales.draft_content (also accepts a whitespace-only sha),
   sales.suppression_lift, sales.import_rollback, catalog writes.
5. Local dev profile: any loopback process can open an owner session (approved; not redesigned). New consequence: such a process can
   retire an owner's WebAuthn Sales decision (no authority gained).
6. Outreach refusal rule: known residual phrasings (C:\Users\mihai\m12-sales\impl\last-report.md); sending stays impossible
   (OUTREACH_DISABLED transport).
7. No owner route / button for sales.preparation.cancel; RM-10 intermittent under load; the 2 V1 real-registry tests; media, step-0
   author and minor display items as in the sections below.

## 2026-10-16 night — one coherent full regression on the final code; M12 prompt updated, still DRAFT (live `2.14.19-m11`, contract 14, schema 12; detail: `.ifrim/STAGE_2026-10-16_STABILITATE_M12.md`)

This section takes precedence over every older one where they overlap. No code change, no live upgrade. One run on a fresh synthetic
clone `C:\Users\mihai\hub-gate` at `ee6c93a` (executable tree = `7074ab5`), Studio built for the test with `HUB_V2_STUDIO_DIST`,
logs in `C:\Users\mihai\hub-gate-logs\run-20261016T1809Z\`: `npm run test:v2` exit 0, **2311 = 2310 pass, 0 fail, 0 cancelled, 1 skip
(T25)**, 0 own processes left → the V2 gate is met. The 7074ab5 gate stays recorded as it was (2311 = 2306 pass, 4 fail, 0 cancelled,
1 skip; the affected tests passed later alone). Its M09-SB-01 cause was a stale Studio build (2.14.17 / contract 13 → `UI_STALE`), not a
missing one; the shutdown failures were the 18 s `execFile` limit (CPU cause presumed, not demonstrated).

Open:
1. V1 in the isolated clone: 552 = 549 pass, **2 fail**, 1 skip. `tests/conversation-api.test.mjs` and `tests/workflow-refresh-api.test.mjs`
   resolve `projectSlug: "ifrim-agent-hub"` through `..\PROJECTS.md` (`apps/api/src/server.mjs:21–22`), the owner's real registry in the
   parent folder; the clone's parent has none. Not synthetic; a fixture registry (and cleanup of `.env.hub016-*` in `finally`) is a test
   change for a separate stage. No green fully isolated V1 run exists on this code.
2. `factory.reject` has no owner session (default `ui`/`test`, `command-catalog.mjs:235–236`; handler `factory.mjs:2330–2345`): a terminal
   decision; separate fix, priority before any new project goes through the Factory.
3. Local development profile: any loopback process with the canonical Origin can open an owner session (`user_verified = 0`, always
   fresh); approved behaviour unchanged.
4. Unchanged, separate: media follow-ups and Word / campaign claims (next sections), step-0 author simplification, the minor display items
   (section 2026-10-16 evening, item 3; next section, item 4). None reopens the §25 acceptance.
5. M12: `.ifrim/M12_PROMPT.md` updated to the real state (baseline, §25 closure, isolation rule, authority / provenance / integrity
   mechanisms, this regression); still DRAFT. New finding for the owner (§4c): all `sales.*` commands run on `ui`/`test` without an owner
   session, and `approveProposal` checks the sha only when one is passed (`sales.mjs:1080`). Live catalog: 0 services; prices unknown.

## 2026-10-16 evening (live) — 2.14.19 live; §25 software ACCEPTED by the owner (17:49:43 UTC); mission COMPLETED (live `2.14.19-m11`, contract 14, schema 12; detail: `.ifrim/STAGE_2026-10-16_ACCEPTARE_LOCALA_S25.md` §9)

This section takes precedence over every older one where they overlap. Closed in code (2.14.19-m11, contract 14, schema 12): the
acceptance authority (owner channel refused since M11; Factory route sessionless on `ui`), the displayed-bundle identity, the race /
repeat behaviour and the two divergent integrity rules (item 1 of the next section). Gate on `7074ab5`: build 0, build:v2 0, test:v2
2306/2311 (3 shutdown timing + M09-SB-01 clone dist, all passing alone on the same commit; T25 skip), V1 551/552 (0 fail). Backups
`bkp_mvb8o87f_4e43830bff` (Hub) and `bkp_mvb8ovp1_05f5adebd7` (demo project), 17:26 UTC.

Open:
1. Done: the owner ran `owner-release.cmd` (17:44 UTC: preflight exit 0, upgrade, push `1e72aca` / `7074ab5`) and clicked „Accept local”
   once in `dlv_mva09x21_b0b0cbfb2a` (17:49:43 UTC): one OWNER_ACCEPTED for `bnd_mva0hc23_b3d65a8da9` (sha `43ad3531…`, channel owner,
   `local_dev_profile`, integrity decision `842fd89a…`), mission COMPLETED, the clip / summary approvals unchanged. Push of the closing
   docs commit is the owner's.
2. Pre-existing residuals for the owner's decision: with the local dev profile on, `POST /api/owner/dev-session` opens an owner session for
   any loopback process with the canonical Origin (acceptances are still recorded as `local_dev_profile`); `factory.reject` stays on
   `ui` without a session (a reject is terminal for the bundle and stales the delivery).
3. Low follow-ups (documented, not fixed to avoid a new gate): the Room shows „snapshot identic ✓” without listing the provenance-accepted
   difference; non-path integrity problems are recorded but displayed as a workspace difference; the preflight does not read
   `cancel_requested_at` / `decided_at`; the off-localhost notice and revision answers still mention Windows Hello under the dev profile;
   some new test assertions lack preconditions. RL-06: an attestation alone no longer heals a repair whose DB event was lost.
4. Unchanged from the next section: media QA follow-ups (9:16 desktop band, text timing), uncurated Word / campaign phrases, README-v2
   status column, step-0 author simplification; M12 stays DRAFT.

## 2026-10-16 (live) — 2.14.18 live; §25 corrected; clips v2 + summary v2 approved by the owner (11:19 UTC); software acceptance blocked by a Hub defect (live `2.14.18-m11`, contract 13, schema 12; detail: `.ifrim/STAGE_2026-10-16_AFIRMATII_DOVEZI_S25.md` §10–§12)

This section takes precedence over every older one where they overlap. Closed: claims bound to the approved spec (2.14.17), the retire-journal
STALE defect (2.14.18), the correction of `dlv_mva09x21_b0b0cbfb2a` (owner-confirmed card `opp_mvarvq2w_d8aaea73a9`, 13/13 DONE 09:48 UTC).

Open:
1. **Software acceptance blocked by two Hub defects (stage doc §12).** The owner approved both v2 clips and summary v2 at 11:19 UTC, but
   `delivery.software.accept` failed twice: it forwards `factory.accept` on the `owner` channel, which `factory.accept` (default `ui`/`test`)
   refuses (since M11, `2a58e9d`; tests use `test`). The Factory-panel „Accept local” is NOT a safe workaround: `factory.accept`
   compares snapshots strictly, and the Hub-repaired journal `.ifrim-hub/retired/mis_mv2ql0fp_ee35f8071e/journal.json` differs, so it would
   mark `bnd_mva0hc23_b3d65a8da9` STALE. Fix (2.14.19, owner's decision): channel of the delivery acceptance + the same Hub-provenance
   exception the delivery verification already applies, with `owner`-channel tests. Push of `79abea2` and later docs is the owner's.
   QA WARN as listed in the stage doc §11 (unjustified freezes with timecodes; rights: platform unspecified; 9:16 layout: 4-line caption).
2. **9:16 desktop segment** renders the desktop capture as a thin band (~15 % of the height, left edge cropped) and QA does not flag it;
   technical texts claiming „programare confirmată” appear before the confirmation frame; tone „both” shows AC ids on screen. Follow-up:
   variant framing for landscape captures, text placement on the proof shot, a QA check for content height in variants.
3. Word / campaign keep uncurated phrases („fără suprapuneri”, five services vs three in the footage) and cut criteria at 160 chars.
4. Low: README-v2 has no CURRENT/SUPERSEDED column; delivery `status_reason` not updated after a correction; new claim items have no
   supersedes link; boot emits duplicate `delivery.stale_reconcile_refused` events; `delivery.package.propose` never binds its plan.
5. Unchanged: step-0 author design (`.ifrim/DESIGN_2026-10-16_AUTOR_PAS0_HUB_TEMPLATE.md`, not implemented); sandbox-user processes not
   identifiable without elevation; M12 stays DRAFT.

## 2026-10-16 — 2.14.17 live (owner, 06:38 UTC); 2.14.18 merged (`3e887c4`), NOT yet live: the §25 delivery went STALE through a retire-journal defect (detail: `.ifrim/STAGE_2026-10-16_AFIRMATII_DOVEZI_S25.md` §10)

This section takes precedence over every older one where they overlap. Closed in code (not yet live): items 1 and 4 of the 2026-10-15
night section — clip and summary claims are bound to the approved spec's criteria by canonical fingerprint and proven per method on the
delivery's own bundle; the presentation is frozen in the template; factual QA checks every displayed text; the replacement link shows only
a valid descendant; the AC-7/AC-8 duplicate clause is fixed at its source (two revision generations, not a double merge). Item 3 (step-0
author) is documented as a design for a separate stage: `.ifrim/DESIGN_2026-10-16_AUTOR_PAS0_HUB_TEMPLATE.md` (not implemented).

Open:
1. **Release 2.14.18 (owner):** run `C:\Users\mihai\s25-claims\owner-release-2.cmd` (managed upgrade + push; both refused to the agent).
   2.14.17 is live since 06:38 UTC (`upg_mvalk291`). `dlv_mva09x21_b0b0cbfb2a` is STALE since 00:50 UTC: every boot rewrote the retire journal
   of the old final mission `mis_mv2ql0fp_ee35f8071e` after §25 legitimately retired the same test (first triggered at 00:48 UTC by a
   review agent that booted Hub code over a copy of the live DB whose project paths point to the real folders). 2.14.18 repairs the
   journal at boot and the audited reconciliation returns the delivery to READY. Verified backup `bkp_mvaq511v_2b957e0eff`.
2. **Correction of `dlv_mva09x21_b0b0cbfb2a` (owner):** after the upgrade the Hub proposes the card „Corectură afirmații (clip + rezumat)”
   (once per version). Confirm it in the Delivery Room. It re-captures both flows (the v1 footage shows the phone typed twice), builds
   master v2 + vertical v2, `rezumat-v2`, Word/campaign v2 (or kept by proof), `manifest-v2`. Then: creative approvals, summary approval
   and software acceptance stay the owner's. Do NOT approve the v1 summary/clips (the Room now blocks it).
3. Curated claims exist only for the fixture's own spec and the exact §25 spec (pinned fingerprints, including the per-request test path);
   any other refresh spec gets generated, criterion-bound texts (honest but plain). Follow-up: per-kind phrase table for Hub-derived
   criteria.
4. Word / campaign keep constant, uncurated phrases („fără suprapuneri”) and cut criteria at 160 chars; the campaign lists only the first 6
   PASS criteria. Owner's decision whether these generators get the same claim binding.
5. Low: `delivery.package.propose` never binds its plan to the delivery, so a confirmed re-package card would fail at step 1
   (CAPTURE_NOT_BOUND); with the new replacement link no live delivery shows that offer. The Inbox chip for the correction row shows the raw
   kind (`DecisionInbox.jsx` is the owner's locally modified file; untouched).
6. Unchanged: sandbox-user processes not identifiable without elevation; M12 stays DRAFT.

## 2026-10-15 night — 2.14.16 live; §25 delivered READY and verified; summary/clip criterion citations wrong (live `2.14.16-m11`, contract 13, schema 12; detail: `.ifrim/STAGE_2026-10-15_CORECTII_S25.md` §8–§10)

This section takes precedence over every older one where they overlap. Closed: items 1–4 of the 2026-10-14 evening section (release,
§25 card, author limits: the live author finished in 92 s; the r-turn hang was the cleanup defect fixed in 2.14.16; the live Hub now runs
the managed 2.14.16 upgrade `upg_mv9zgbrl`, so the working tree and the live code match).

Open:
1. **Refresh delivery cites the original spec's criterion ids (medium, owner's decision for the fix).** The summary's „Ce demonstrăm” /
   „Ce beneficii putem afirma” and the clip's technical texts come from the fixture's delivery block
   (`v2/server/factory/booking-demo-def.mjs:94-113`), gated on AC ids written for the original booking spec. The §25 spec renumbers its
   criteria, so every gate passes and the texts cite unrelated checks (e.g. „Corectura a fost verificată de un reviewer independent.
   (verificat: AC-4)” while AC-4 is now „telefon salvat exact”; clip „AC-1 + AC-6: interval ocupat → indisponibil (390 px)”). The
   factual QA only checks that the ids exist. The Word/PDF document and the campaign list the new criteria correctly. Fix direction:
   map gated texts by criterion meaning (or regenerate them from the delivery's spec) and make factual QA refuse a citation whose
   criterion text changed from the fixture's reference spec. Until then the owner should not approve the summary / clip of
   `dlv_mva09x21_b0b0cbfb2a`.
2. **Owner decisions pending in the Delivery Room** of `dlv_mva09x21_b0b0cbfb2a`: local acceptance of bundle `bnd_mva0hc23_b3d65a8da9`,
   creative approval (PENDING), summary approval. Media QA WARN: 16:9 has 8 frozen-image segments not covered by capture holds and a
   rights warning (platform unspecified); 9:16 has 5 frozen segments.
3. **The step-0 author adds nothing to the Hub skeleton** (rehearsal and live: 150 lines, 0 added, 0 removed when comments and blank
   lines are ignored). The test's strength comes from the Hub-owned skeleton (calibrated) and the Codex review, not from the author.
   Design question for the owner (keep the author step, or let the Hub write the skeleton directly for dataset FEATURE plans).
4. Low: the red banner's „Deschide livrarea care o înlocuiește” links the newest child even when it is EXPIRED / CANCELLED; AC-7 and
   AC-8 repeat the clause „câmpul „Telefon” are etichetă și se completează” (inherited demo criteria merged twice).
5. Unchanged: sandbox-user processes cannot be identified without elevation (limitation); M12 stays DRAFT.

## 2026-10-14 evening — 2.14.15 author turn limit; real isolated rehearsal reached a PROVEN rewrite but not Codex PASS (code on `claude/project-thread-5c9bak` = `b111d1c`, NOT released; live `2.14.10-m11`; detail: `.ifrim/STAGE_2026-10-13_DATE_MARTOR.md` §9)

This section takes precedence over every older one where they overlap. 2.14.15 (`015d266`) adds the 45-min turn limit only for the step-0
author of the §25 hub-test plan (`authoring.authorLimits.turnTimeoutMin`, dispatch-recorded, runtime-checked, card-visible) and R-PARITY deadline
evidence; the manual driver `v2/tests/manual/s25-isolated-rehearsal.mjs` runs a real rehearsal through the Factory dispatch + runtime in a
throwaway test Hub (grants sized like the plan, real Hub probes, Codex review via codex exec read-only, no credential reads, CreationDate-checked
process cleanup). Independent reviews PASS.

Open:
1. **No release, no §25 card**: rehearsal h2 (16:38–17:09 UTC) — cycle 0 rejected by lint (reserved `hubAdd`, project load outside a test)
   consumed the rewrite; the rewrite was PROVEN and calibrated 41/41 by assertions, but Codex stayed CHANGES_REQUESTED (post-restart full-set
   revalidation, historical row per anonymous parameter, slots check for 13:00). Rewrite exhausted; owner's decision.
2. **64000**: a message of 58 417 output tokens (h1) proves the old 32 000 cap was exceeded; a message reached 64 000 (h2); the exact cap is not
   observed separately (no stop_reason recorded for that message).
3. **Regression on `d096459` stuck** in r-turn since 19:17 UTC: under 84–100 % CPU 7 r-turn tests timed out and one left its fake "hang" child
   alive (PID 30364), keeping the suite open; the agent's kill was refused by the permission layer. Test defect to fix (kill fake children on a
   timeout failure). Previous full regression on `0bf94aa`: 1979/1981 (RF-02 flaky under load, 1 skip T25).
4. Live Hub started seven times without upgrade/backup (logon task); parent delivery STALE; historic §25 test protected; M12 DRAFT.

## 2026-10-14 — Content gaps closed in code, step-0 author still blocked (code `2.14.14-m11` on branch `claude/project-thread-5c9bak` = `854e3fc`, NOT released; live `2.14.10-m11`, contract 13, schema 12; detail: `.ifrim/STAGE_2026-10-13_DATE_MARTOR.md`)

This section takes precedence over every older one where they overlap. Baseline: `v2-milestone-01` = `c1db213` (+ this docs commit);
2.14.13 `53132ed` + 2.14.14 `6a9d174` + evidence `854e3fc` over `53fe75e` (2.14.12) on `claude/project-thread-5c9bak`, fetched from the
isolated clone `C:Usersmihaihub-rc` (outside AppData), not merged (the logon autostart loads the working tree).

Closed (in code, not released): items 1 (content part) and 3 of the section below — R-DATASET (Hub-owned experiment contract for the
booking-demo fixture, sha-bound provenance, step-0 hold kind `dataset`), R-VALUES / R-IDS / historical positive control in the briefs and the
new reference `dataset-reference` (rejects all 41 defective sources with categories; the two initial-data variants are initialisation
regressions, not leaks), R-CODES (one finding code end to end), R-OUTPUT (`CLAUDE_CODE_MAX_OUTPUT_TOKENS=64000` only for the TEST_AUTHORING
Claude process of a new plan carrying `authoring.authorLimits`, cause `output_token_limit`, requested / override / effective recorded apart).
Two independent reviews (two rounds each, final PASS); affected 35/35; full V2 regression on `6a9d174`: 1956 tests, 1955 pass, 0 fail,
1 skip (T25 symlink privilege). The 8 clone-location failures of the previous stage: 26/26 on the same tree outside AppData (cause:
import-access refuses %USERPROFILE%AppData).

Open:
1. **No step-0 candidate → no release, no §25 card.** The author (Claude sonnet, medium) produced no test in any launch: 2.14.13 twice hit
   the CLI's 32000 output-token maximum (thinking only); with 64000 one launch died with the Remote Control session, the single relaunch
   (my decision on the owner's "continuă", written before my Da/Nu question) ended in a transport failure after 10 API retries; effective
   limit not demonstrated.
2. **Author turn limit (new, owner's decision)**: TEST_AUTHORING uses the reviewer role's per-turn limit (15 min BALANCED); every failed
   author launch ran 30–58 min (the one success 8 min), so live the Hub would stop them as `turn_timeout` first; the rehearsal scripts did
   not apply that limit. 64000 alone cannot make the live flow pass.
3. **Live Hub started seven times without upgrade/backup** (now also 2026-10-14 06:39 and 06:49 UTC after a reboot), all 2.14.10-m11 by
   the logon task. Parent delivery STALE; historic §25 test protected; M12 stays DRAFT; validated-release autostart stays DRAFT.

## 2026-10-13 (afternoon) — Mechanical step-0 blockers closed (code `2.14.12-m11` on local branch `claude/project-thread-wn8xqf`, NOT released; live `2.14.10-m11`, contract 13, schema 12; detail: `.ifrim/STAGE_2026-10-13_BLOCARI_MECANICE.md`)

This section takes precedence over every older one where they overlap. Baseline: HEAD = origin = `eeeb136` on `v2-milestone-01`; 2.14.12 is
`614c42e` + evidence `53fe75e` on the local branch `claude/project-thread-wn8xqf` (base `88cb6c6` = 2.14.11), fetched from the isolated clone,
not merged (the logon autostart loads the working tree; five unmanaged starts recorded by 2026-10-13 07:55 UTC); push by the owner.

Closed (in code, not released):
- **Item 1 of the section below, the mechanical part**: R-NEEDS (the Hub completes `needs` deterministically from the free uses of the six
  permitted built-ins before lint and assembly; declared / completed / effective kept apart in one manifest), R-CLEANUP (test header v2:
  resources returned by `setup()` are registered at once and closed on pass and on fail, `# HUB_CLEANUP` TAP report per case, forgery-
  resistant collector, `classifyProof` INCONCLUSIVE `cleanup`, lint `harness_reserved` + extended `builtin_patched`; header v1 byte-identical
  for historic candidates), R-BASELINE (`baselineGate` refuses the writer after a timeout, stop, crash, incomplete summary, missing or
  cancelled cases, name mismatch or unconfirmed cleanup, even on a matching signature). Three independent review rounds (last PASS),
  affected 27/27 suites 515/515, full V2 regression 1923/1933 (8 clone-location failures of the folder-import / Studio family, 26/26 in the
  main tree). Demonstrated in the rehearsal: `needs: []` completed twice without consuming the rewrite; the failing test exited normally in
  0.3 s with the resources closed (proof PROVEN without `--test-force-exit`).

Open:
1. **Isolated rehearsal stopped at the content gate → no release, no §25 card.** The Codex review (gpt-6.1-sol) was CHANGES_REQUESTED at
   cycle 0 and again after the one completion (every previous check `kept`, none lost; AC-1/AC-2 open: non-string phones excluded from the
   assertion and from `values`, the initial rows' identity and phones not fixed before the restart, the second created id not captured);
   the matrix rejects 29/29 inventory variants but the test passes the extra calibration variant "initial data without phone". Candidate
   fix (owner's approval, no new rewrites, same models): the author brief / criteria state explicitly that every initial record has a
   non-empty phone that enters `values`, that both created records are identified by the id the API returned, and that every refusal
   compares a full storage snapshot; then one new rehearsal, release (backup + upgrade), one §25 card.
2. **Residual, low (documented by review round 3)**: `builtin_patched` does not follow aliases (`const E = Error; E.prototype.code = …`);
   a body may misreport its own resource as already closed by construction; the sandbox, not the cleanup, stays the security boundary.
3. **Author model loop**: the first rehearsal author attempt (sonnet, medium) looped in thinking (4 × max_tokens, no text, $2.09); the Hub
   would count it as an unreadable answer (new attempt). Observed once; no Hub change (the Hub passes only `--effort`).
4. **Live Hub started five times without upgrade/backup** (10-12 06:32, 15:55, 21:35 UTC; 10-13 02:44, 07:55 UTC), all by the logon task;
   provenance `570ced3` + docs. DRAFT: autostart starts only a validated release. Parent delivery `dlv_mv1eo8oo_d120460140` stays STALE;
   historic §25 test active; M12 stays DRAFT.

## 2026-10-13 — Existing-data coverage (code `2.14.11-m11` on local branch `claude/project-thread-c7i593`, NOT released; live `2.14.10-m11`, contract 13, schema 12; detail: `.ifrim/STAGE_2026-10-12_ACOPERIRE_DATE_EXISTENTE.md`)

This section takes precedence over every older one where they overlap. Baseline: HEAD = origin = `570ced3` on `v2-milestone-01`; 2.14.11 is
`189241b` + evidence `88cb6c6` on the local branch `claude/project-thread-c7i593` (not merged into `v2-milestone-01`, so the logon autostart
cannot load unreleased code); push by the owner.

Closed (in code, not released):
- **Item 1 below, the R-EXISTING part**: criteria and briefs require the app's own initial data (normal start), the record kept across a
  restart and the new record, proven in storage and present by id in the list for every anonymous parameter; the new reference
  `existing-reference` rejects all 29 defective variants of the fixed inventory (json-reference passes "seed rows only", rh1 also
  "existing records only"); T-EXIST-ALL-01…06. R-INVENTORY defect fixed: assertions in a top-level helper were always "removed" at cycle 1.
  Two independent Claude reviews PASS; affected suites 26/26, 502/502 on the clone aligned byte for byte with the working tree.

Open:
1. **Isolated rehearsal did not pass the gates → no release, no §25 card.** The real author's test (Claude sonnet) has the right content
   (diagnostic with forced exit: correct app PASS, 29/29 + 8 calibration variants rejected), but the Hub stopped it twice for mechanical
   reasons: cycle 0 lint `needs_missing` (the manifest kept `"needs": []` from the template), cycle 1 (the one rewrite) proof INCONCLUSIVE
   timeout (servers closed after the expected failing assertion without try/finally, so the test process never exits; runner limit 180 s).
   Codex review never reached. Candidate fix (owner's approval, no new rewrites): proof runs with `--test-force-exit` (open handle = reviewer
   signal) and `needs` completed by the Hub from the body; then one new rehearsal, release (backup + upgrade), one §25 card.
2. **Live Hub started three times without upgrade/backup** (06:32 UTC uncommitted 2.14.10; 15:55 and 21:35 UTC committed `570ced3`), all by the
   logon task. Provenance now clear (`570ced3`, UI built 2026-10-12 07:05 UTC). DRAFT: autostart starts only a validated release.
3. **Full V2 regression not run** (no release); an attempt in the clone was stopped on a CRLF clone artifact. Parent delivery
   `dlv_mv1eo8oo_d120460140` stays STALE; historic §25 test active; M12 stays DRAFT.

## 2026-10-12 — Deterministic "does not expose" checks (code `2.14.10-m11`, contract 13, schema 12; detail: `.ifrim/STAGE_2026-10-12_NEEXPUNERE_JSON.md`)

This section takes precedence over every older one where they overlap. Baseline: HEAD = origin = `c168283`; the 2.14.10 commit is local (push by the owner).

Closed:
- **Item 1 below, the helper part**: the Hub-owned header helper `exposes` (decoded JSON, keys at any depth, values as substrings incl. escaped text and keys; invalid input = setup) detects the c8 miss; lint rejects vacuous/shadowed/literal uses and patched built-ins; the proof records the helper identity. Two review rounds (Claude, separate session), final verification PASS. Affected suites 494/494, build green.
- The plan `env_mv49pmjs_74958c8740` expired (closed at the 06:32 UTC boot); nothing revived.

Open:
1. **Isolated rehearsal incomplete → §25 not released or probed**: Claude cycle 0 PROVEN, Codex CHANGES_REQUESTED (saved phone not compared to the sent one), cycle-1 completion PROVEN with nothing lost and Codex PASS; but the test passes two defective variants (phone exposed only for 11:00+ bookings / only for seeded synthetic bookings) because R-EXISTING lets the test create its own existing record with `seed: false`. Candidate fix (owner's approval): R-EXISTING also covers the app's own existing data (seeded bookings identified in storage and found in the list) + the "seed only" variant in the matrix and the reference; then one new rehearsal.
2. **Live Hub on unreleased code**: the 06:31 UTC reboot autostarted the Hub from the working tree (`2.14.10-m11` with the round-1 lint; no upgrade run, no backup). No migration, no active mission. The next restart loads the committed code; a formal upgrade/backup belongs to the next release.
3. **Parent delivery `dlv_mv1eo8oo_d120460140` stays STALE**; `git push` stays the owner's. M12 stays DRAFT.

## 2026-10-11 (evening) — Test completion without losing checks (code and live `2.14.9-m11`, contract 13, schema 12; detail: `.ifrim/STAGE_2026-10-11_COMPLETARE_TESTE.md`)

This section takes precedence over every older one where they overlap. `8a91d3f` (2.14.9) pushed by the owner (origin verified 20:21 UTC); live upgrade `upg_mv487hiw` (19:38 UTC) after verified backups `bkp_mv486gvm_fe29fa3bd1` (Hub) and `bkp_mv486kzh_4e6ef724dc` (§25 project). Full `test:v2`: 1848, 1847 pass, 1 skip (T25), 0 fail (CPU avg 93 %).

Closed:
- **Item 1 below (rewrite replaced insufficient checks)**: R-AMEND / R-INVENTORY in 2.14.9; live fourth attempt kept every previous check (reviewer: all `kept`, no `lost`).
- **Item 3 below (regression not green)**: final regression green on 2.14.9 (RM-10 passed in this run; still load-sensitive by nature).
- The 15:28 plan `env_mv3wfqmy_e139f9baef` expired by itself at 18:58 UTC.

Open:
1. **§25 still not past step 0** (fourth attempt, `env_mv49pmjs_74958c8740` / `mis_mv49pj8t_91920fa038`, stopped 20:34 UTC, exhausted): the cycle-1 completion kept everything but stayed incomplete — its decoded helper compares strings exactly (the phone escaped inside a longer text under another key passes; verified locally), and existing records rely on `seed: true` without proof. Candidate fix (needs the owner's approval): Hub-provided header helpers for "does not expose" checks (decoded keys/values, substring) + an explicit "create or prove the existing record" rule. A second completion would be one more rewrite (not done). The plan expires by itself 23:50 UTC; the automatic refinement cancelled itself (same criteria).
2. **Parent delivery `dlv_mv1eo8oo_d120460140` stays STALE** (reconciliation refused again at the 2.14.9 boot: no path inventory, no byte hashes).
3. **Agent refusals**: `git push` stays the owner's (refused again); `upgrade.mjs --apply` was NOT refused this time. M12 stays DRAFT.

## 2026-10-11 (afternoon) — Step-0 repair and §25 recovery (code and live `2.14.8-m11`, contract 13, schema 12; detail: `.ifrim/STAGE_2026-10-11_REPARARE_PAS0.md`)

This section takes precedence over every older one where they overlap. Push of `529cb83` DONE by the owner (origin verified 14:08 UTC).

Closed:
- **Item 2 below (§25 step-0 rejections)**: causes reproduced locally (invented export accepted as proof; rewrite without the previous candidate; R-SUP retirement at start). Fixed in 2.14.8 (R-PROOF, R-REWRITE, R-LIFECYCLE, R-STALE).
- **Item 3 below (retirement not undone)**: the old §25 test was restored at the 2.14.8 boot (sha `8d944644…`, journal RESTORED with history).
- **LightingService**: Running / Automatic after the 08:02 UTC reboot; nothing to restore.

Open:
1. **§25 still not executed past step 0** (third live attempt, `env_mv3wfqmy_e139f9baef` / `mis_mv3wfpyy_d440c4ec5c`, confirmed 15:28 UTC): both candidates PROVEN on behaviour; the rewrite replaced substring value checks with exact-value checks and the Codex review marked two of them `lost` (confirmed locally: phone leaked in a text field or as a key passes the rewrite). Nothing retired, no code touched. Candidate fix (needs the owner's approval before any new plan): a check criticised as insufficient is supplemented, not replaced. The plan expires by itself 18:58 UTC.
2. **Parent delivery `dlv_mv1eo8oo_d120460140` stays STALE**: audited reconciliation refused (legacy bundle and E2E screenshots have no recorded byte hash; legacy STALE event has no path inventory), although its software drift is now zero.
3. **Final V2 regression not green**: 1836 tests, 1832 pass, 1 skip (T25), 3 fail — two fixtures fixed afterwards (14/14), RM-10 load-sensitive (fails under load, passes alone). V1 not rerun.
4. **Agent refusals**: `upgrade.mjs --apply` ([Production Deploy]) and `git push` stay the owner's. CPU: WmiPrvSE ≈ 2.7 cores, source unidentified. M12 stays DRAFT.

## 2026-10-11 — Finalizing the M11 probes (no code change; code and live `2.14.7-m11`, HEAD = origin = `d7aeeb5`; detail: `.ifrim/STAGE_2026-10-11_FINALIZARE_PROBE_M11.md`)

This section takes precedence over every older one where they overlap. The push of `8b2a76b` + `d7aeeb5` is DONE (origin verified 2026-10-10 21:18 UTC); item 1 below is closed.

Closed:
- **D4-02, RM-10, OFF-06**: all PASS in the final regression. RM-10 fails only above ~99 % CPU (correct `HOLD_LATENCY_EXCEEDED` refusal, cap kept); OFF-06 failed only on the disk reserve (C: now ~400 GiB free, reserve 15 GiB kept).

Open:
1. **Final regression not green** (2026-10-10 23:59 → 2026-10-11 02:06 UTC, CPU 99.6 % in the first hour): V1 `npm run test` 549/552 (2 API timeouts), V2 `test:v2` 1752/1757 + 1 SKIP T25, 4 FAIL (M03-FAC-04/06/07, RF-02). All six pass in isolation (0.4–6 s). Load, not code; rerun after a PC restart.
2. **§25 privacy revision not executed past step 0** (twice, owner-confirmed): Codex's test review rejected Claude's acceptance test 4/4 times; auto refinement correctly refused (same criteria); no "one more attempt" exists in step 0. Plan `env_mv3b262d_3d5e47db62` expires by itself 2026-10-11 07:43 UTC. Needs a diagnosis of the step-0 proof/review before another try.
3. **R-SUP retirement not undone after a stopped step 0**: the old §25 test sits in `.ifrim-hub/retired/mis_mv2ql0fp_ee35f8071e/`; parent delivery `dlv_mv1eo8oo_d120460140` is STALE although no code changed (`restoreRetired` only on a failed start / boot recovery).
4. **CPU**: WmiPrvSE ~4 cores constantly (CIMWin32 + nettcpip providers), source unidentified (not the uninstaller, LightingService or the V1 tray). `LightingService` was stopped by the owner during the diagnosis (`net start LightingService` restores it).
5. M12 prompt stays DRAFT (probes not closed). `.ifrim/tmp/v2-tests` holds ~8.1 GB of test leftovers (not removed; not needed for space).

## 2026-10-10 (evening) — Closure of the M11 corrections (code and live `2.14.7-m11`, contract 13, schema 12; detail: `.ifrim/STAGE_2026-10-10_INCHIDERE_M11.md`)

This section takes precedence over every older one where they overlap. Closed in code and tested (R-HIST, R-SUP, R-ROLL, R-PACK; 24 new tests, 10/10 mutations killed; full regression 1757: 1753 PASS, 1 SKIP T25, 3 FAIL from the environment, see the stage report). Live upgrade `upg_mv2qfbs5` done; verified backup `hub-dataackups2hub-v2.closure-2.14.7.2026-10-10T18-34-21-868Z.sqlite`.

Open:
1. **Push** of `8b2a76b` and the docs commit: refused to the agent by the session permission layer; the owner runs `git push origin v2-milestone-01`.
2. **§25 privacy revision live**: card `env_mv2ql6ls_9f08b50ab6` PROPOSED (confirm by 2026-10-11 18:37 UTC); the owner confirms it once. Before that, free space on C: (14.7 GiB free < the 15 GiB media reserve: the capture step fails with DISK_RESERVE).
3. **Load-sensitive tests**: D4-02 (Lega, 121 s timeout under 100 % CPU, passes alone) and RM-10 (real capture holds over their latency cap under 100 % CPU, fails again while the CPU stays at 100 %); OFF-06 fails on the same disk reserve as item 2.
4. Earlier missions started before 2.14.7 have no historic record (their bundle says so); the Excel proof still covers the generic demo workbook only.
5. Items 3–5 of the section below are unchanged (CapCut/OBS, voice probe, old bundles).

## 2026-10-10 — Corrections after M11 + M12 handoff (code `2.14.6-m11`, contract 13, schema 12; detail: `.ifrim/STAGE_2026-10-10_CORECTII_M11.md`)

This section takes precedence over every older one where they overlap. Baseline at start: HEAD = `origin/v2-milestone-01` = `49a6032`;
live `2.14.5-m11` (the owner had already upgraded); the owner's uncommitted changes are line endings only.

Closed in code (tested in isolation, full regression 1731/1733 PASS + 1 SKIP + 1 load timeout that passes alone):
- **Frozen-frame warnings in the delivery clips** (item 2 of the 10-09 section): captures now record measured holds; QA justifies only a
  freeze inside holds the capture session stored. Old clips keep their reports (nothing retroactive).
- **Phone in the public list of the §25 demo** (owner's product observation of 10-09): the Hub now plans that revision with distinct
  checks and supersedes the old §25 test without rewriting it.
- **Selective revision**: the Excel workbook of a refresh is kept only by proof (live data check: `Programari demo.xlsx` of
  `dlv_mv16dsp8_491116ae10`, sha `9ce060d8…`, reusable).

Open:
1. **Upgrade to `2.14.6-m11` and push of the stage commit**: see the thread report (the Claude Code classifier refused them before).
2. **The §25 privacy revision live**: after the upgrade, the sentence goes to the §25 delivery; the owner confirms the card; Codex
   implements; the refresh delivery then films the new version and keeps the Excel by proof. Not run yet.
3. Limits stated by the review: the Excel proof covers the generic demo workbook (not project data); the reused file stays in the source
   delivery's folder; the conflicting-test detection is a heuristic shown on the card; earlier Hub tests of other missions are still not
   protected from a later writer (integrity reports `test_modified` medium / `test_deleted` high) — candidate for M12+.
4. U06-BL-06 can time out under heavy CPU load (130 s in the full run, 9,9 s alone).
5. Items 3–4 of the 10-09 section (CapCut/OBS, the owner's voice probe, old bundles) are unchanged.

## 2026-10-09 (evening) — Closure of the stage before M12 (code `2.14.5-m11`, commits `b15f3d6`…`bff5c68`, live `2.14.4-m11`; detail: `.ifrim/STAGE_2026-10-09_LEGA_AUTONOMIE.md` → „Închiderea etapei”)

This section takes precedence over every older one where they overlap. Reconciled facts (checked 2026-10-09 18:05 UTC): `origin/v2-milestone-01`
= `7407301` (= local HEAD then), so 62f5788 / 95465c8 / 7407301 are pushed; the live Hub served `2.14.1-m11` (contract 13, BUILD_SAFE, upgrade
`upg_mv0yn13c`) with the local development profile on.

Closed (with evidence in the stage report):
- **Plans stopping when the confirming page closes** (item 1 of the 10-09 section below): fixed in `62f5788` (`trust.confirmedAuthority`,
  `ops/plans.mjs`); DP-06 PASS (one confirmation, session closed at once, mission → review → QA → derived delivery → READY).
- **Windows Hello in local development** (item 2 below): the local development profile is live (`dev_fc41496f2663`); the §24 and combined
  confirmations of 2026-10-09 needed 0 Hello prompts.
- **§24 and the combined delivery** (item 3 below): DONE live (`opp_mv123umo_a22d4eeb67`, `opp_mv16dspo_101aa9677c` / `dlv_mv16dsp8_491116ae10`).
- **§25 test rejected twice**: cause = one criterion (the owner's sentence) proven by a server test; fixed by derived criteria + guard criteria
  + browser checks + bounded refinement (`b15f3d6`). The stuck mission `mis_mv16l212_a6e1053492` waited at NEEDS_OWNER_DECISION; its plan
  `env_mv16l8fa_e03c6bdee4` EXPIRED at 19:59:59 UTC (its 3.5 h authority) and its child delivery `dlv_mv16l88c_f3ffac3ae1` EXPIRED with it.
- **V1 blank page on 3004** („504 Outdated Optimize Dep” after the node_modules accident): `dev:web` restarted, 0 console errors.
- **Office artifacts without their own state** (item 4 below): each office file now carries its dependency and state in the delivery view.

Open:
1. **Push and the last upgrade**: the Claude Code auto-mode classifier refuses `node v2/scripts/upgrade.mjs --apply` („[Production Deploy]”)
   and `git push origin v2-milestone-01` from the agent; the owner ran the upgrades (live `2.14.4-m11`) and runs the push. Code `2.14.5-m11`
   only narrows the automatic refinement; it goes live with the next upgrade. §25 itself is DONE live (stage report, „Probe live”).
2. **Frozen-frame warnings in the delivery clips**: analysed against the capture markers (stage report): every freeze ≥ 1 s of the desktop
   part lies in a highlight hold, the typing or the proof hold; no stalled capture found. The QA verdict stays WARN because the clip IR does not
   mark those holds `holdIntentional` (QA justifies only marked clips); marking them from the capture markers is the remaining fix.
3. **CapCut / OBS**: discovered, never authorized or operated live (only Notepad was operated live, 2026-10-04 and 10-06). Operating them needs
   the owner's app authorization card. The FFmpeg route stays the editor path.
4. **The owner's real voice probe** and the old bundles (ProDelivery, Factory Demo M07, the accidental Factory Demo M10.2 mission): owner's.

## 2026-10-09 — Etapa „Lega: autonomie și lucru pe PC” (ISTORIC: items 1–4 superseded by the section above)

This section takes precedence over the older ones where they overlap. Reconciled facts: M11 is pushed (`origin/v2-milestone-01` = `209b020`
on 2026-10-09) and live (`2.14.0-m11`); the detailing pilot RAN on 2026-10-08 (software 7/7, accepted; clips approved; summary ready; nothing
published). Items 1, 3 of the M11 section below are closed; item 2 (voice probe) stays open.

1. **Plans stop when the confirming owner session closes** (`v2/server/ops/plans.mjs:324`, `:292`): an idle browser (30 min) stops a running
   plan (SESSION_CLOSED → NEEDS_OWNER) and refuses the derived delivery plan. Contradicts the owner's requirement that a confirmed mission
   continues when he leaves. The fix was refused by the session's permission layer ([Security Weaken]); open.
2. **Windows Hello in local development**: the local development profile was refused by the same layer; open (design in the stage report).
3. **§24 / §25 live**: pass end to end on the test Hub (DF-01); the live cards need the owner's confirmation until item 2 exists.
4. **Office artifacts are not delivery items**: Word / Excel / campaign are recorded as package-plan step results (the `delivery_items` kind
   CHECK has no `office` kind); a software change makes the whole delivery STALE, but the Room does not mark each office file stale on its own.

## 2026-10-07 — M11 „Ifrim Delivery” (code `2.14.0-m11`, contract 13, migration 12; LOCAL commits on `v2-milestone-01`, not pushed, not live). Detail: `.ifrim/HANDOFF_2026-10-07_M11.md`, `.ifrim/M11_REPORT.md`

This section takes precedence over the older ones where they overlap.

1. **Not live.** The live Hub serves `2.13.1-m11`. The upgrade to `2.14.0`, the detailing test project and the pilot need the owner's ONE approval of `.ifrim/M11_PILOT_SHEET.md`. The logon autostart now refuses to start the Hub while the code holds migration 12 and the database does not (`v2/scripts/boot-guard.mjs`); after a reboot, start through the approved upgrade.
2. **Voice: M11_VOICE_READY not declared.** Segmentation fixed and the local diagnostic built (PASS on synthetic signals); the owner's probe (positives and negatives) is NOT_RUN. The filter stays off until the owner turns it on.
3. **Software revision (§25) does not yet create a parent-linked „refresh” delivery.** The planner shows the difference and proposes the engineering plan; when the new mission starts, the old delivery becomes STALE (software_revision); after its DELIVERY_READY the owner says „pregătește demo-ul” again. Decide whether the refresh section should ride on the engineering envelope (design: mode 'refresh', parentDeliveryId).
4. **Delivery Room creative approval** stays the existing Studio decision (fresh Windows Hello); the Room links to it.
5. **Open design decisions kept at their defaults** (`.ifrim/M11_DESIGN.md` OPEN DECISIONS): session-bound delivery phase, one card per clip revision, „Accept local” needs the displayed bundle sha, Windows route only, phone width = 390 px viewport in Chromium (no device emulation), first tone „both”, CTA „Hai să discutăm”, price/term „De stabilit (neconfigurat)” until a CONFIGURED catalog service is bound.

## 2026-10-05 — P0 closure of M10.2 (code `2.12.1-m10.2`, contract 12, no migration; **committed locally as `e1a2d0d`, not pushed**; **live since 2026-10-06 03:03 UTC**, run `upg_muw3g5tp`; test project `prj_muw3gnxo_52bfc7470f`; probe marker S0 = 4522). Detail: `.ifrim/M10_2_REPORT.md` §11, `.ifrim/HANDOFF_2026-10-05_P0.md`

This section takes precedence over the M10.2 section below where they overlap. The code is on `v2-milestone-01` over `e8a55ce`, in the same files as M10.2. Decisions D14–D23 are described in the report.

Evidence:
- Integration set: 506/506 twice, plus 132/132 extra. PASS_SIMULATED: throwaway test Hubs, fixture providers, simulated distro; the browser E2Es ran in headless Chromium.
- Full regression: V2 **1246 tests · 1245 PASS · 0 FAIL · 1 SKIP** (T25 symlink, unchanged; 128 files without `m11-*`, UI built separately, 55 min, 2026-10-06 00:21–01:17 UTC); V1 **552 · 551 PASS · 0 FAIL · 1 SKIP**.
- Live: NOT_RUN. Nothing live was run for `2.12.1`: no upgrade, no model, no Lega session.

1. **M10 still closes only after the owner's guided probe A–G.** Sheet: `.ifrim/M10_2_PROBE_SHEET.md`, approved by the owner on 2026-10-05 (~16:30 UTC).
   - Nothing of the probe has run yet. Steps A–G are NOT_RUN.
   - The approval covers the sheet and nothing wider: one local commit (M10.2 + P0), the upgrade to `2.12.1-m10.2`, the test project „Factory Demo M10.2”, one Lega session of at most 20 min, one Engineering plan, the Studio import and one edit.
   - It does not cover a push, the M11 pilot or the historical bundles (ProDelivery, D6, Demo B).
   - Order: full regression → local commit → `upgrade.mjs --plan`, then `--apply` → test project → `probe-m10-2.mjs --mark` → the owner's steps A–G.
2. **Closed from the M10.2 list: the two leftovers of the old flow.**
   - **Reopening after „Oprește tot” was an admin path** (the typed OPEN GATE in Integrări → Avansat; M10.2's D13). Now it is the rearm card in the cockpit (D14–D17, `v2/server/owner/gate-rearm.mjs`). With it, Stop All closes the waiting engineering and run plan cards (envelopes; D15, `v2/server/owner/envelopes.mjs:1565-1575`; also at a shutdown that interrupts a run, and at boot while the gate is still suspended by a stop, `v2/server/owner/stop-scope.mjs:162-196`; operation-plan cards are not closed, they still need their own confirmation and expire), and what the stop itself paused resumes only after the rearm, on every path (D22, `stop-scope.mjs:125-133`; `v2/server/ops/plans.mjs:384`; `v2/server/desktop/operator.mjs:269`).
   - **„Continuă” worked only typed.** No client sent the locally verified segment, and Lega refused the provider's word (voice-path map). Now the owner's locally verified spoken „Continuă” runs the same executor as the typed one, once per utterance, and the provider transcript can only veto (D18, `v2/server/owner/intake.mjs:1345-1404`; `v2/server/owner/voice.mjs:53`, `:394`). PASS_SIMULATED only: live it needs the voice filter on.
3. **Open, not fixed in this closure.**
   - **A retained lease blocks every reopening path and has no release in the cockpit (SM-04; older than P0).**
     - A lease is retained when a stopped run's provider process does not confirm its exit (`v2/server/runtime/runs.mjs:516`) or when the Hub restarts mid-run (`v2/server/runtime/recovery.mjs:30`).
     - While one exists, the rearm card answers LEASES (`v2/server/owner/gate-rearm.mjs:175-176`), „Continuă” after the owner's own pause is refused (`v2/server/owner/interrupts.mjs:143-144`) and the typed OPEN GATE is refused (`v2/server/runtime/command-catalog.mjs:318-319`).
     - The only release command is `computer.release` (`command-catalog.mjs:589-590`). Its only caller in the UI is the computer-locks panel (`v2/web/src/screens/Tools.jsx:55`).
     - **Decide:** a reconcile step on the rearm card (run ended and process gone → release, under the same fresh verification).
   - **Sentences that name Stop All after „după” without a reopen verb still resolve to `stop_all`.**
     - Checked with the pure resolver: „Ce urmează după Stop All?” and „Ce s-a oprit după Stop All” both give `stop_all`.
     - The round-2 defence applies only when the clause also holds a reopen or resume verb (`v2/server/owner/intents.mjs:278-279`, pattern at `:287`).
     - The effect is one more Stop All: it closes the waiting plan cards and makes a shown rearm card stale. Nothing starts.
     - **Decide:** should „stop all” right after „după” never be read as the command?
   - **The legacy typed OPEN GATE needs only the per-boot token for a non-security stop (AS-03; owner decision).**
     - `gate.set open` takes the `ui` channel and the typed `OPEN GATE` (`command-catalog.mjs:312-317`). A request without `X-Hub-Channel` counts as `ui` (`v2/server/http/routes.mjs:35`), and its only credential is the per-boot token (`v2/server/http/server.mjs:63`, `:89`).
     - It has no owner session, no fresh Windows Hello, no compare-and-set and no BUILD_SAFE reset. It records `via: "open_gate"` (`command-catalog.mjs:341`), so the sweep of preserved requests is not skipped (`v2/server/owner/work-requests.mjs:313` skips only a rearm).
     - It does refuse retained leases and a stop next to a security event (`command-catalog.mjs:318-333`). D14 keeps it as the diagnostic path.
     - **Decide:** require the owner session there under voice-first, or leave it as it is.
   - **The agent channel can attest a new WSL fingerprint (PF-07; owner decision).**
     - `environment.attest` is delegated to agents (`v2/server/runtime/commands.mjs:14`). Outside the `automation` channel the fingerprint pin is optional (`v2/server/environments/environment-commands.mjs:61`). A delegated call, or the manual UI button, therefore attests whatever a fresh inspection finds.
     - It cannot approve (b): that command is owner-only (`environment-commands.mjs:85`). For a hub-test project, though, a valid attestation alone satisfies the environment route (`v2/server/policy/isolation.mjs:264-266`).
     - D21 guards only the setup's automatic step and the `automation` channel.
     - **Decide:** on `agent`, require the fingerprint of the latest PASS, or remove the delegation.
   - **No per-turn wall-clock timeout for writer or reviewer turns.** A turn is bounded only by the mission deadline (set at `v2/server/factory/factory.mjs:416-418`, enforced at dispatch `:587`, `:695` and by the tick `:1469-1474`) and by the plan's expiry. `run.stale` is only a flag after 10 min without provider events (`v2/server/runtime/recovery.mjs:54`, `:71-73`). In the probe a hung turn ends at the 120-min deadline or at the owner's Stop (sheet §3).
   - **Two labels for the same closure.** The boot defence closes a stale PROPOSED plan through `envelopes.revoke` (`stop-scope.mjs:189`), which records CANCELLED (`envelopes.mjs:1455`). The live stop records REVOKED (`envelopes.mjs:1574`). Both are owner closures for the preserved requests (`work-requests.mjs:46`), so only the history label differs. A fix needs a closure helper in `envelopes.mjs`.
   - **A restart with only a no-model operation plan running records no stop (observation on D17/D22).** `stopForShutdown` calls `runs.stopAll` only when a model run is active or in admission (`stop-scope.mjs:164`; `runs.mjs:602`). Otherwise no `shutdown` suspension is written; the boot sets the plan to NEEDS_OWNER (`v2/server/ops/plans.mjs:508-513`) and nothing holds it. **Decide:** should a shutdown without model runs count as a stop too?
   - **The voice filter is off on the live Hub** (last recorded state, not re-read for this section; the default is off, `v2/server/domain/settings.mjs:51`). The verified spoken „Continuă” (D18) and the spoken plan confirmation therefore cannot be validated live until the filter is on. The owner's spoken pause (D19) does not need the filter, only a Lega session started from the owner session. All three are NOT_RUN live and PASS_SIMULATED in tests (fixture voice worker). The owner approved turning the filter on for the probe (sheet option V) and does it himself; without it, the spoken „Continuă” of step F1 stays NOT_RUN.
4. **WSL attestation: still invalid (`canary_changed`, same fingerprint `8f9e9eeb934b6c01` as last recorded).** The probe does not need it.
   - **Real cause.** M09 added an opt-in `streamPaths` option to the request guard in `v2/server/tools/browser-core.mjs` (`:44-48`, `:78-82`). That file is one of the preview-host files copied into the sandbox (`v2/server/environments/sandbox-profiles.mjs:93-97`), and their contents are hashed into `CANARY_VERSION` (`v2/server/environments/canary.mjs:30-33`).
     - Attested version: `m05-canary-1+e1fde725` (the inputs of `09f50b4`…`ae3aa48`, as measured by the attestation analysis). Current version: `m05-canary-1+0491ff30` (`72d6964` and `e8a55ce` in the same analysis; re-computed from the working tree for this section, so `2.12.1` does not change it again).
     - The only caller that passes `streamPaths` is the Windows Studio capture (`v2/server/media/capture.mjs:844`). The sandboxed E2E path does not (`browser-core.mjs:231`), so the new branch is not reached inside ifrim-runner.
   - **What a re-attestation needs.** The same fingerprint, no model and no new approval (b): (b) is bound to the fingerprint, not to the canary version (`isolation.mjs:267`).
     - By hand, in System → Medii: first „Inspectează” and check that the fingerprint is unchanged (the manual route passes no fingerprint pin, `v2/server/http/routes.mjs:432`), then „Rulează atestarea C1–C17”, then „Verifică contul prin mediu (C16)” (`v2/web/src/screens/system/Environments.jsx:46`, `:70`, `:67`). The attestation's own C16 refreshes only the Codex check (`v2/server/environments/wsl-runner.mjs:283`).
     - Or automatically (D3), as a pre-step of the first plan confirmed on a wsl-routed project.
     - It restarts the distro at C15 and is a live-Hub operation of its own. The probe sheet does not cover it (sheet §6).
     - The current attestation would also expire around 2026-10-16 (14 days, `wsl-runner.mjs:31`).
   - **Known weaknesses.**
     - **The `CANARY_VERSION` scope is narrower than the launch path.** It hashes `canary.sh`, `c14.mjs`, `reap.sh`, `canary.mjs`, `sandbox-profiles.mjs`, the three host files and the generated prelude (`canary.mjs:30-33`). It does not hash `wsl.mjs`, `wsl-runner.mjs`, `wsl-factory-runner.mjs`, `tar.mjs`, `workspace.mjs` or the other scripts (`inspect.sh`, `prepare.sh`, `release.sh`, `reviewer-cleanup.sh`). A change there neither invalidates the attestation nor is measured again. Example: this closure edited `wsl-runner.mjs` and the version did not move.
     - **C18–C20 are optional** (`canary.mjs:39`, `:214`; `wsl-runner.mjs:60-65`). A failure there still gives PASS_LOCAL with fewer stages, and the automatic re-attestation accepts any `PASS*` status (`v2/server/owner/readiness-runner.mjs:210`). Coverage can shrink without a new decision. Real-project factory plans are then blocked by the stage check (`v2/server/factory/routed-runner.mjs:88`, `envelopes.mjs:171`); hub-test projects are not.
     - **Line endings.** The hash is over raw bytes. This machine has `core.autocrlf=true`, and `.gitattributes` pins only the fixtures and `*.sh` to LF (`.gitattributes:1-6`), not the hashed `.mjs` files. They are LF in the working tree now. A re-checkout could flip them to CRLF and change the version with no code change.
     - **TOCTOU between the label and the scripts.** The version label and the host files are fixed when the module loads (`canary.mjs:30-33`, `sandbox-profiles.mjs:93-97`), but `canary.sh` and `reap.sh` are read again from disk at attestation time (`canary.mjs:63`, `:90`). The live Hub runs from the working tree, so an edit made after the Hub started is attested under the old label until the next restart.
   - **The probe runs on the Windows route.** A new hub-test project has no environment route, so `routeFor` returns `windows` (`v2/server/environments/registry.mjs:14-21`). It needs neither the attestation nor C16. That route is the weaker boundary (R2 open; test data only).
5. **M11 wave 0 exists as new, unwired files.** They are uncommitted, not loaded by the Hub or the built UI, and not part of the P0 commit: the booking demo fixture, `v2/server/delivery/*`, the Delivery Room screens and the `m11-*` tests. Design, file list and the post-probe checklist: `.ifrim/M11_DESIGN.md` (appendices A and B). M11 units that change existing files start only after the owner's probe A–G.

## 2026-10-05 — M10.2 (code `2.12.0-m10.2`, contract 11, migration 11; **uncommitted**; **live since 2026-10-05 04:57 UTC**, run `upg_muus3hq2`). Detail: `.ifrim/M10_2_REPORT.md`

1. **M10 closes only after the owner's live probe** (prompt §14–§15). The automated suites pass: V2 1110 · 1109 PASS · 0 FAIL · 1 SKIP; V1 552 · 551 PASS. The single guided probe sheet (A–G, scope, budget) is in the closure report.
2. **WSL attestation is invalid (`canary_changed`, same fingerprint).** Since M10.2 it is announced at boot. The re-attestation runs automatically as a pre-step after the owner confirms a plan on a wsl-runner project (D3), or by hand through System → Medii → „Rulează atestarea C1–C17”. Corrected on 2026-10-05: the button „Rulează pașii automați” is on Lega → Configurare (`#/lega/setup`), not in System → Medii, and from `2.12.1` it re-attests only the same fingerprint (D21). A new fingerprint is never approved automatically. Cause, steps and known weaknesses: the P0 closure section above, item 4.
3. **The voice filter is off.** With it off, spoken confirmation („Da, execută planul”) is unavailable, so plans are confirmed by click, Enter or typed „Da”. Enabling it is one owner decision. From `2.12.1` the spoken „Continuă” (D18) needs it too. The spoken pause counted as the owner's own (D19) does not: it needs only a Lega session started from the owner session. See the P0 closure section above, item 3.
4. **Lega web search is `live`** (owner setting). Every start now needs the server-side confirmation (D9). The setting was not changed.
5. **Dead drafts from the old flow**, left for the owner (D11): `mis_muu64evt` (promo video, project_management on the Hub), `mis_muppcs5g` (AROBS) and `mis_mupy0no5` (phone validation, SPEC_DRAFT).
6. **Not done (documented):**
   - an expiring owner-only live-search setting and the taint rule (decision 9 follow-up);
   - the media AI role / generated plates (D5);
   - a plan offer drawn inside the Lega stage for plans from another tab;
   - a MEDIA_A card button for acknowledging a changed tool (the Studio → Unelte panel has it).

## 2026-10-04 — Open items after M10 (code `2.11.1-m10`, contract 10, migration 10; **committed as `72d6964`** on `v2-milestone-01`, together with M09, over `ae3aa48`; push pending: the owner runs `git push origin v2-milestone-01`; **the live Hub runs `2.11.0-m10` since 2026-10-04 13:53 UTC**). Detail: `.ifrim/M10_REPORT.md` (takes precedence over the M09 section below where they overlap)

0. **M10.1 — Lega one-click start (`2.11.1-m10`, no migration) is LIVE since 2026-10-04 18:12 UTC.** Owner's approval: "abrob upgrade la 2 11 1". Claude ran `upgrade.mjs --apply`, run `upg_muu51x09`, verified: `2.11.1-m10`, BUILD_SAFE, 0 active grants, 0 runs.
   - The PC had rebooted at 18:07 UTC and the Hub was down, so it was an offline upgrade.
   - **Done (owner's request):** the per-user logon task "Ifrim Agent Hub V2" (`v2/scripts/autostart.ps1 -Install`, action `autostart-run.ps1`) starts the Hub 45 s after logon when nothing answers on 8011.
     - Verified: run while up → "deja pornit"; run after `stop.mjs` → up in ~6 s, BUILD_SAFE.
     - The real logon trigger is confirmed at the next restart (log: `%USERPROFILE%\IfrimHub\autostart.log`).
     - The V1 tray task is separate.
   - **The owner's Lega web-search setting is `live`** (higher risk). A stage or cockpit start opens the panel first and asks for one more click (by design).
   - **Deliberate behaviour change on the old path:** withdrawing the Codex billing declaration now also stops a voice session started with a hand grant. Before, only the derived path stopped. This is fail-safe: a new start would be refused anyway.
   - **Left by design:**
     - hand-made "Lega (voce)" grants from the old path stay valid until they expire (nothing deletes them);
     - a voice session's `maxDurationS` is fixed at start, from the owner session's time left. Activity during the voice session does not extend it; the owner session idling out stops it (tick ~15 s and before every Lega tool).
   - **Owner session rotation (`v2/server/owner/trust.mjs`):** a re-authentication in the last 10 minutes of an owner session now opens a new session (new cookie, full 8 h) and ends the old one (`rotated`). Before, it renewed the same session in place. Whatever was bound to the old session stops as it would at expiry, at most 10 min earlier: a derived Lega voice, a running ops plan (→ NEEDS_OWNER, "confirmed in another session") or an envelope continuation. A plan confirmed in those last minutes now gets the new session instead of dying minutes later.
   - Detail: `.ifrim/M10_LEGA_ZERO_FORM.md`.
1. **Done 2026-10-04 13:53 UTC (owner's approval "aprob upgrade ul la m10"):** `node v2/scripts/upgrade.mjs --apply` by Claude, run `upg_mutvrr79`. Verified backup `hub-v2.pre-migration.v9-to-v10.2026-10-04T13-53-14-962Z.sqlite` (sha256 `bef36396…fb50`, integrity ok); BUILD_SAFE, 0 grants, 0 runs, log clean; the helper is built in `hub-data\work\desktop`. Two runner defects were fixed first (dry-run copy inside OneDrive; 40 s start wait). The M09 manual dry run had also copied the live DB into `.ifrim/tmp` (OneDrive) for a moment before deleting it.
   - The server now takes and verifies the pre-migration backup itself.
   - No GUI action on the owner's desktop and no model were run.
   - The only real-desktop contact was a **read-only** discovery with the real helper: all four apps DISCOVERED, trusted signatures.
2. **M09 items closed by M10:**
   - **M09 #5** (the clip's project could not be imported): a project bundle `proiect-studio.json` + preview + ONE import + reconstruction from an older delivery. The bundle now sits in the clip folder.
   - **M09 #6** (capture scope approval): `media.capture.scope.approve` (owner, fresh re-auth) + plan steps that approve the exact scope.
   - **M09 #8, partly** (import roots without UI): contextual folders (once / persistent with fresh re-auth) from the Studio import panel, the Operator page and „Importă din folderul acesta”.
3. **Live GUI verification is pending:**
   - D1 (open / focus) and D2 (Notepad edit + Save As) are verified against the deterministic helper fixture.
   - The real helper is verified automatically only through non-desktop operations (protocol, MAC, replay, authority, fail-closed scope, JSON arrays).
   - The owner runs the real GUI demos (`m10-desktop-real.mjs --open / --notepad / --capcut-inspect --watching`).
4. **CapCut's real UI Automation exposure is unknown** until the first `--capcut-inspect`. Until then:
   - `invokeControl` and `import` stay UNVERIFIED;
   - export stays ASSISTED_ONLY;
   - publishing / exporting to platforms is refused (sensitive control).
5. **Windows may refuse to bring a window to the foreground** (focus-stealing prevention). The result then says „open but not in front”; it is never reported as success. No `AllowSetForegroundWindow` / `AttachThreadInput` tricks are used.
6. **A failed project import leaves the partially created content project.** The import row is marked FAILED; a retry creates a new project.
   - **Decide:** archive the partial project automatically on failure, or keep it for inspection.
7. **`ops.plan.propose` accepts any registered step kind from the owner-facing channels** (UI included). It only proposes: confirmation needs the owner session. No UI exists yet for composing arbitrary plans (only Lega's intents build them).
8. **OBS through a plan needs:** MB1 (live capture), OBS WebSocket enabled with a password, and the Hub's OBS configuration (Operator page → OBS). The password is typed at each plan's confirmation and never stored.
9. **Defects found and fixed during M10** (each with a test; detail in `M10_TEST_REPORT.md`):
   - **helper arrays + fail-open scope:** the C# helper read JSON arrays only as `ArrayList`. Real discovery returned nothing, `listWindows`/`waitWindow` never matched, and the `auth.apps` scope check was skipped (fail-open). Now arrays are read through one function and the scope is fail-closed.
   - **helper build encoding:** the C# source was compiled without UTF-8; now `/codepage:65001`.
   - **policy diacritics:** JavaScript's ASCII `\b` let „Postează” / „Șterge” slip past the sensitive-control check.
   - **protected process names:** compared with „.exe”, while the helper reports them without it.
   - **plan desktop session:** left ACTIVE after the plan ended.
   - **implicitly approved folders:** folders a step merely described were treated as approved, so there was no step-up decision.
   - **bundle export:** refused a destination that did not exist yet.
   - **translucent plates:** a style box at 0.75 opacity let busy UI text show through (the M09 LinkedIn ~21 s issue), and QA could not see it. Now the plate is reinforced (≥ 0.9, guaranteed in the ffmpeg filter, test M10-ST-13) in narrow variants, and the legibility QA measures around the real glyphs. A frame-based „plate too transparent” check was tried and removed: anti-aliased glyph edges made it fire falsely on the real clip.
10. **Unchanged and still the owner's:**
    - pilot ProDelivery/F-001, D6, Demo B;
    - MEDIA_A / MB1 / MEDIA_C;
    - the clip's creative approval;
    - Claude billing re-declaration (M09 #2).
    - Autostart, remote access and permanent listening stay off; M10 adds none of them.

## 2026-10-04 — Open items after M09 (code `2.10.0-m09`, contract 9, migration 9; **committed in `72d6964`** with M10 on `v2-milestone-01` over `ae3aa48`; **the live Hub runs `2.10.0-m09` since 2026-10-04 07:23 UTC**). Detail: `.ifrim/M09_REPORT.md` (takes precedence over the M08 section below where they overlap)

1. **Done 2026-10-04 07:20–07:24 UTC (owner's request "fă tu pașii de trecere pe M09"):** live upgrade to M09.
   - Steps: dry run 8 → 9 clean → stop → coherent DB backup → `npm run build:v2` → start → read-only checks.
   - The backup: `hub-data\private\pre-upgrade\hub-v2.pre-m09.2026-10-04T07-23-05-815Z.sqlite`, sha256 `3f90d2bc…5651`, integrity ok. The Hub does not back up by itself before a migration.
   - State after: BUILD_SAFE, 0 grants, 0 runs, log clean.
   - The execution gate stayed `open` as before (BUILD_SAFE blocks inference anyway).
   - Rollback: `M09_LIVE_VALIDATION_PLAN.md` §1.
2. **Claude inference is blocked until the owner re-declares billing.** Live state confirmed after the upgrade: `reverify_required`, `latched` + `legacy_unbound`, route blocked. This is intended.
   - Codex stays valid until its declaration expires.
   - Re-declaring needs the owner session + fresh Windows Hello + a probe ≤ 24 h (plan §2).
   - The Hub still cannot verify Claude credits automatically and does not try.
3. **M08 items closed by M09** (as code, PASS_SIMULATED; live after the upgrade):
   - M08 #2, package/autopilot plans now pin models end to end (`policy/model-binding.mjs`);
   - M08 #7, skill bodies are injected through the composer and recorded per run (`run_skill_usage`).
   - The skill-evolution league and monitor now count only runs that actually received a skill (review R30/R31).
4. **Unchanged and still waiting for the owner:**
   - pilot bundle `bnd_musqo7xj_1a204a2e55` + F-001;
   - D6 `bnd_murl82o1_00afe726c3`, Demo B `bnd_mupwze7b_e03f70f2d7`;
   - the ProDelivery working tree (not touched by M09).
5. **First clip awaits the owner's creative decision.** Files: `C:\Users\mihai\Videos\Ifrim Studio\M09 - Un plan, o confirmare\`. CREATIVE_OWNER_ACCEPTED is not recorded (it needs the Studio on the live Hub + Windows Hello). Its manifest stays DRAFT.
   - The edit project exists only on the test hub that produced it.
   - To approve it in the live Studio, the project must be re-created there:
     1. import `surse/capture.mp4` + `surse/end-card.png` (+ rights);
     2. `media.edit.create` with `plan-de-montaj_v1.json`, its `assetVersionId`s remapped to the new library ids;
     3. final render.
   - **Missing:** a small import helper (OWNER/test command or manual script) that remaps the plan's asset ids; today it would be a manual JSON edit.
   - The sources were copied out of the session scratchpad into `surse/` (sha of `capture.mp4` verified).
6. **Live capture cannot be approved yet even with MB1.** `captureBrowserDemo` on the live Hub (8011 or the 3011 dev proxy) and OBS recording both require the owner's approval of the session's exact scope (`consent_json.scopeApproval`, via `owner_session`). M09 has no command or screen that writes it.
   - **Next step:** an OWNER command `media.capture.scope.approve` (fresh re-auth, scope sha bound, expiry) + a Studio button.
7. **`media.capture.demo` (the command) always refuses** (review R9, unverified). `mediaPolicy.demoOrigins` has no writer.
   - The manual harness (`tests/manual/m09-clip-capture.mjs`) calls the capture service directly with its own `allowOrigin`.
   - **Decide:** add an OWNER `media.policy.demo_origins` writer limited to loopback test ports, or drop the command.
8. **Import roots have no form in the UI.**
   - Only `POST /api/media/policy/import-roots` (owner session) exists.
   - Unset, the default is `%USERPROFILE%\Videos` (production only; tests use none).
   - Browser upload works without import roots.
9. **No media AI runs exist.** Brief, script and storyboard of the first clip were written by the development session and labelled `dev_session`. MB2 (max 4 runs, Claude `sonnet · medium`, no fallback) is a budget decision only.
10. **Simplifications stated in `M09_IMPLEMENTATION_STATUS.md` §4:** circular capture buffer, AI generation/TTS, Remotion/Blender/Computer Use/Premiere UXP, speed ramps, noise cleanup and live social connectors are not implemented. The render queue has no separate heartbeat.
11. **whisper-server `--inference-path` is implemented but OFF and unverified on the real binary** (needs starting whisper-server). The port is still callable by another local process while the server runs. The restriction is verifiable (listener check, 127.0.0.1, bounded reads), not authentication.
12. **Residual review findings, documented, not fixed** (numbers = `review/findings.json`, R1..R39; none was confirmed by a verifier; R1 was rejected):
    - **R4:** re-requesting a transcription after cancelling returns the cancelled job; cancelled queued jobs count toward the queue cap.
    - **R25:** preset tamper detection is self-consistency only. A code/DB preset conflict is reported at boot, but the DB body is still used.
    - **R28:** a withdrawal or overage latch does not touch the retained legacy `billingAttestations`. Rolling back to M08 code would re-admit Claude on the old declaration. Withdraw in M08's UI too, or clear it, before any rollback.
    - **R29:** an overage report latches the provider but stops only the run that reported it. Concurrent Claude runs (max 2) continue to their end.
    - **R32–R34:** skill approval facts are cached per content hash (a restore of older approved content is not re-checked against git); `importAll` reuses one git snapshot (TOCTOU); a `SKILL.md` symlink is read through but left out of the hash.
    - **R36:** after MATERIAL_CHANGE a started mission cannot be re-bound to the same model. Under an envelope it can only be stopped and re-proposed.
    - **R38:** the gate preview omits the composer's model/effort and shows a Claude refusal the real run would not hit.
    - **R39:** the Focus screen's run retry drops the original effort (profile default used).
13. **Review fixes made in this session** (all with regression tests):
    - the 19 confirmed findings: R2, R3, R5, R6, R10–R14, R17–R23, R26, R27, R37;
    - additionally: R7, R8, R15, R16, R24, R30, R31, R35;
    - the regression tests themselves caught two more defects: the first R6 fix never ran (it read `rights.revoke`'s result wrongly, RF-07), and R5 accepted a default "now" as "before the withdrawal" (DS-16).
    - Details: `M09_TEST_REPORT.md` §3.

## 2026-10-03 — Open items after M08 (code `2.9.0-m08`, `8b277c5` + `ae3aa48` pushed to `origin/v2-milestone-01`; `origin/main` still `17921ac`; the live Hub runs `2.9.0-m08`). Current detail: `.ifrim/M08_SESSION_REPORT.md` (takes precedence)

1. **Pilot bundle `bnd_musqo7xj_1a204a2e55` awaits the owner.** ProDelivery mission `mis_musq9hl4_1e9726b3fd` reached DELIVERY_READY live on 2026-10-03 (18:36–18:42 UTC; baseline 0/3, checks 27/27, review PASS, QA 3/3).
   - Review finding F-001 (medium) is a behaviour change in `driver_ranking.py`: `punctuality_rate = 0` no longer defaults to 0.85. It needs the owner's decision (AC-3: no public contract change).
   - Accept re-snapshots and goes STALE if the tree changed. Reject does not restore files.
2. **Defect: package/autopilot plans do not pin models.** B4 promised reviewer Claude `sonnet · medium`, but `preparePilot` (`v2/server/intel/intel-commands.mjs`) passes only limits. The plan had an empty `requestedModel`, and the reviewer ran on the account default `claude-opus-5-5`.
   - Fix: pin writer/reviewer model and effort, show them in the plan, and refuse a mismatch.
3. **A pre-run backup is written inside the project.** `ProDelivery/.ifrim/BACKUPS/v2/…bkp_musqh5hy_7dd0d21d67.zip` (~5 MB) is git-ignored there but synced by OneDrive. It contains the owner's uncommitted work too.
4. **Billing declaration vs the owner's $100.** The Claude declaration (2026-09-30) says usage credits are disabled. If extra usage is enabled on claude.ai, Hub Claude reviews could consume it after the weekly limit. The Hub checks credits automatically only for Codex.
5. **Still on after the pilot:** ProDelivery ASSISTED + `wsl-runner`, `factoryExtraCommands: ["python-unittest"]`, policy `voice_first`. One plan confirmation starts models again.
6. **Attestation `att_murgupen_3459ee8157` expires ~2026-10-16** (14 days). After that, wsl-runner missions are refused until re-attested.
7. **Done on 2026-10-03:** push (owner); R3 re-consent 18:29 UTC; package A decided (A1/A2 executed by Claude, A3 acknowledged, nothing deleted); package B decided.
   - Rollback of the relocation now needs `--rollback --copy-back` (Hub stopped): the new DB changed after the move.
8. **The Hub does not start at logon.** After a Windows restart: `Ifrim Hub V2.cmd` or `v2\scripts\start-detached.ps1`. OpenClaw's global gateway (18789) did not come back after the reboot; owner decision.
4. **Voice UX is verified only with synthetic voice** (the armed window included). To verify live after the upgrade, with the owner's voice.
5. **Personal Mission Control on a real phone is BLOCKED.**
   - The Hub binds 127.0.0.1 only; no remote exposure is configured.
   - A LAN or tunnel connection would be a separate security decision (TLS, origin, pairing over that channel).
6. **The board's AI summary is not enabled.** The agenda is deterministic. A model summary would consume the subscription and needs its own budget decision.
7. **Skill bodies are not injected into worker prompts** (neither base nor candidate versions; skills are a registry since M01). Skill evolution therefore manages versions only: an activated candidate is recorded, not applied, and the league/auto-rollback no longer attribute outcomes to it. Injecting skill content would change every existing prompt, so it needs its own decision. There is no model evaluation either (`modelEvaluation: NOT_RUN`).
9. **Python stdlib shadowing guard is heuristic** (integrity finding `stdlib_shadowed` for writer-created top-level `.py` modules named like standard-library modules; `__init__.py` on the protected test path is HIGH, not blocking). The reviewer still reads every change set.
10. **A conditional sentence without a teach prefix that contains "oprește tot" is treated as Stop All** (M06 fail-safe bias: stopping only reduces activity).
8. **Lessons reach worker prompts as text** under the Hub rules. A lesson that widens access is refused at confirmation (security parts), but the parser is heuristic: the owner reviews every proposal before confirming.

## 2026-10-03 — Open items after M07 (version `2.8.0-m07`; superseded by M08 above where they overlap)

1. **OneDrive sync (pre-existing; owner decision).** The project lives under OneDrive Desktop, including `.ifrim/private` (Hub database, logs, V1/V2 backups), and is synced to the cloud. Voice confirmation transcripts and history land there.
   - Options: move `HUB_V2_DATA_DIR` outside OneDrive, or exclude the folder from sync.
   - The voice profile and models are already outside (`C:\Users\mihai\IfrimHub\voice`).
2. **Voice profile ACL on Windows (owner decision).** The code asks for mode 600, but Node does not apply it on Windows.
   - The profile files inherit read access from `C:\Users\mihai\IfrimHub`: the `CodexSandboxUsers` group, SYSTEM and Administrators.
   - The path is not in the Codex deny list.
   - Restricting it needs an explicit ACL or a deny rule in the Codex profile. Not changed automatically, given the persistent-DENY-ACE behaviour of Codex profiles.
3. **whisper-server has no authentication and sends `Access-Control-Allow-Origin: *`** (v1.9.4; `--request-path` breaks every route in this build).
   - It listens on loopback only, on a random port, with a one-time, best-effort PID check at start.
   - A local process or web page that guesses the port can use it or `/load` another model (DoS until the next request). It cannot inject text into the Hub.
4. **Chromium (Playwright) and Claude binaries in ifrim-runner are owned by `runner`.** A replacement changes the fingerprint, so the attestation falls and runs are refused, but the write itself is not prevented. Fix: move them under root-owned `/opt` (owner's root step).
5. **E2E evidence can be forged by the project under test** (same uid and network namespace as the E2E host). This is the same limit as parsing test output; the host boundary is unaffected.
6. **Reviewer network = the distro's network.** Not domain-filtered; the reviewer's tools have no network access.
7. **Reviewer runs through `claude@wsl-runner` record `surface_id` null.** Cosmetic; affects the audit only.
8. **Leftover workspace directories in ifrim-runner:**
   - `ws/hub/stop-kill-wsl-only-muq4as4j` (M05);
   - `ws/hub/pv-deb603de5c6be589` (D6's preview), marked orphaned by the restart, with no processes and its files kept for inspection.

   Remove both in the next maintenance window (Environments → the trash icon on the orphaned row).
9. **D8 not validated live.** No Lega cloud session ran with the voice filter (0/2 used). No spoken taci / pauză / oprește on the live Hub, and "Hai să lucrăm la ProDelivery" was not spoken in the live cockpit (resolver and cockpit read verified separately). All PASS_SIMULATED or PASS_LOCAL.
10. **Voice threshold calibrated on the owner's samples only.** With no authorized negative voices, the false-accept rate is unmeasured. Voice is a filter and the spoken form of a session confirmation, never authentication.
11. **The C14 attestation does not exercise the project-ignore drop** (the C14 fixture is not a git repository). M07-EXP-08/09 and M07-ENV-12 cover it; add a C14 case at the next canary version.
12. **(Closed in M07.)** The voice-first-policy check in `restoreModeHold` is tested in M07-EN-16 (mutant MM-9).
13. **What D6 relied on that is no longer possible for an agent.** D6's second writer attempt was granted by an agent resume (`factory.extra_attempt`) under the pre-review code, within the M07 budget of 2 attempts per probe. After review round 2 an agent resumes only BLOCKED or its own pause. Future agent-driven probes need the owner's click for any NEEDS_OWNER_DECISION (an extra attempt included), a new time window or the end of the owner's pause. Policy (b) re-approval (e.g. after a fingerprint change) is the owner's.
14. **Lega screens.** The full-screen stage (Alt+J) and the cockpit coexist. The owner asked whether the big screen should be the start screen or open from the cockpit card. Proposal pending.
15. **Residuals from review round 2 (rejected as defects, mechanisms real):**
    - **The 'hub-test' label.** A real directory could be registered as a test project through an 8.3 short-path duplicate; this needs write access to the project already.
    - **Agent pause/resume loop.** On a test project, an agent can loop pause/resume and get model turns not counted per stage, bounded by the grant's attempts.
    - **Writer-chosen file names.** They reach the stage reason, Lega's context and the bundle markdown unfiltered (bidi, U+2028). This is pre-existing.
    - **Malformed `mission_ids_json`.** One such row makes `envelopeOfMission` throw; this fails closed.
    - **No two-Hub restart test.** No test opens a second Hub over the same database; a real restart was exercised live in D6 (restore worked).

## 2026-10-02 — M06: Lega 2.0 (voice-first cockpit) + M06-A pipeline readiness (current; read `M06_REPORT.md` first)

- **Code `2.7.0-m06`:** on disk on `v2-milestone-01` over `c8ff6f4`, **uncommitted**. No commit, push, merge, deploy, model, install or download.
- **Live Hub (8011):** still runs `2.6.0-m05` (BUILD_SAFE). `v2/web/dist` already holds the M06 UI, so the Lega screen says "Hub-ul rulează o versiune mai veche" until the owner restarts. Run `node v2/scripts/migration-dry-run.mjs` (schema 5→6) first.
- **M06-B built** (`v2/server/owner/`):
  - owner session: WebAuthn `webauthn.mjs` + `trust.mjs`; HttpOnly cookie `ifrim_owner`; only the token hash stored; UV required; re-authentication window 5 min;
  - versioned product policy `ownerPolicy`: legacy by default; voice-first activated only by the owner (fresh session + exact text);
  - Mission Authorization Envelopes (`envelopes.mjs`): one consumable confirmation of the exact plan; derived grants (`live_grants.envelope_id`) never wider than the plan; `approvals.decideByEnvelope` with decided_via `owner_session`;
  - autonomy OBSERVE / ASSISTED / TRUSTED / HIGH_AUTONOMY_BOUNDED through `factory.attachAuthority`;
  - project cockpit, explain, read-only replay, delta, company map (`cockpit.mjs`);
  - local intent resolver (`intents.mjs`); safe layout catalog (`layout.mjs`); interruptions (`interrupts.mjs`, new gate check `project_frozen`);
  - quiet attention, recommendations, shadow reviews (`advisor.mjs`);
  - local voice gate baseline (`voice.mjs` + `web/src/lib/voiceFeatures.js`, `voiceGate.js`, `web/public/voice-gate-worklet.js`);
  - the `owner` command channel; migration 6 (additive).
- **Voice agent:** the new Lega tool `lega.open_cockpit` opens a project's cockpit from anywhere (context only).
- **M06-B UI:** `#/lega` is the start screen (`screens/Lega.jsx`, `lega/cards.jsx`, `lega/OwnerSetup.jsx`); WebGL2 face with morph targets and an audio-driven mouth (`components/face/LegaFace.jsx`, `lib/faceGeometry.js`).
- **M06-A built:**
  - local-only preview profile: bwrap, own network namespace with loopback only (`wsl-factory-runner.mjs localOnlyArgs`, `scripts/preview-host.mjs`);
  - canary C18, optional coverage `preview-local-only`; canary version changed, so re-attest;
  - the preview goes into the environment when C18 is attested;
  - E2E in the namespace is BLOCKED (no Chromium Linux); the review stays on Windows (tool boundary).
- **Tests:** V2 on the final code 550 / 549 PASS / 0 FAIL / 1 skipped; V1 552 / 551 / 0 / 1. 13 mutants: 12 caught, 1 equivalent (documented). Real-browser E2E with a Chromium virtual authenticator (PASS_SIMULATED). See `M06_TEST_REPORT.md`.
- **Real, no model, no install:**
  - bwrap 0.9.0 present in ifrim-runner; Chromium and Claude absent;
  - C18a–i 9/9 PASS_LOCAL;
  - real preview host in bwrap: HTTP 200, isolation ok, 0 leftovers.
- **Levels:**
  - M06_B_UX_READY in simulation;
  - TRUSTED_SESSION_READY and VOICE_MISSION_FLOW_VERIFIED: PASS_SIMULATED (typed/click; voice confirmation BLOCKED: no local STT);
  - VOICE_FILTER partial (synthetic voices, uncalibrated baseline);
  - M06_A_PIPELINE_READY, PIPELINE_ISOLATION_VERIFIED and REAL_PROJECT_PILOT_ELIGIBLE: not reached.
- **Owner next steps:** dry run → restart → re-attest → `http://localhost:8011/#/lega/setup` (Windows Hello, policy, autonomy) → D3/D4 on a test project → install package decision (`M06_PIPELINE_READINESS.md` §5: A1 apt libs (owner, root), A2 Chromium Linux, A3 Claude Linux + owner login, B1 local STT, B2 ONNX speaker model, C the C3 live Stop probe, D approval (b) last).
- **Unchanged:** Demo B bundle `bnd_mupwze7b_e03f70f2d7` awaits the owner; no merge into `main`; ProDelivery, AROBS and Sales live untouched.

## 2026-10-02 — M05: wsl-runner, R2 work and execution robustness (closed; superseded by M06 above where they overlap)

- **Code `2.6.0-m05`:** committed as `d33e207` (code) + `c8ff6f4` (live results) and pushed by the owner (`origin/v2-milestone-01` = `c8ff6f4`). Lines below that say "uncommitted" are historical.
  - Staged: one `git mv`, `v2/tests/manual/r2-wsl-canary.sh` → `v2/server/environments/scripts/canary.sh`.
  - No commit, push, merge or deploy.
  - The owner ran `migration-dry-run.mjs` (schema 4→5, integrity ok, row counts unchanged) and restarted the Hub from their own terminal on 2026-10-02 02:08 UTC: pid 26992, `2.6.0-m05`, BUILD_SAFE, migration 5 applied. In the live Hub the owner then clicked Inspect, C16 and the attestation (System → Medii de execuție, 2026-10-02 ~02:13 UTC): C16 chatgpt `prolite`, 8 models; attestation **PASS_LOCAL, 71 checks, fingerprint `7b3afa6ae2a7d1f3`** (recorded). (b) not approved, (c) NOT_RUN.
- **Approvals used:**
  - (a): M05 code, no model;
  - real WSL checks without a model: canary, `codex sandbox` on dummy trees, app-server for account and models only;
  - Hub start (2026-10-01 20:55 UTC);
  - read-only subagents.

  **Not granted:** (b) `host_isolation=environment`; (c) live WSL probes; (d) `.wslconfig`.
- **Built:** `v2/server/environments/`:
  - `wsl.mjs`: `wsl.exe -d ifrim-runner -u runner --exec /usr/bin/env -i …`, argv-validated, no shell;
  - `wsl-runner.mjs`: inspect, fingerprint, C16 account, attestation, workspace prepare/export/apply/reap/release/recover;
  - `canary.mjs` + `c14.mjs` (C1–C17);
  - `workspace.mjs` + `tar.mjs`: copy-in, strict tar reader, C14 export validator, conflict-checked apply with rollback;
  - `registry.mjs`: per-project route, never falls back to Windows;
  - `wsl-factory-runner.mjs`;
  - `environment-commands.mjs`, `overview.mjs`.

  Plus:
  - `providers/codex-wsl.mjs` (adapter `codex@wsl-runner`);
  - gate checks `environment_route` and environment-bound `host_isolation`;
  - migration 5 `m05-execution-environments` (additive);
  - git snapshots for projects over 4000 files / 64 MB;
  - Stop during QA commands;
  - RT-07 PRG in browser E2E;
  - warm-up and preflight (off at boot);
  - Lega diagnostics and the attempt rule;
  - the `cli` command channel;
  - UI: System → „Medii de execuție” and „Unde rulează” in the mission panel.
- **Real checks (no model):**
  - canary PASS_LOCAL 71/71 on fingerprint `7b3afa6ae2a7d1f3` (comparable line identical to 2026-10-01);
  - C14 26/26 on real GNU tar archives;
  - C16 PASS (chatgpt `prolite`, 8 models, profiles allowed);
  - Stop of a real `codex sandbox` tree: 0 survivors in 0.9–1.9 s;
  - sandbox sockets: EPERM, so preview/E2E cannot run in the environment and stay on Windows.
- **Found and closed:** a repository `core.fsmonitor` made the Hub's own git calls run a repo program on the host (`tools/git.mjs` now forces it off; test EXP-06 with a positive control). An adversarial review (3 read-only agents) found 2 HIGH and 19 MEDIUM; all fixed with tests, except two documented items (UI nonce for (b), workspace disk quota).
- **Levels:**
  - BUILD_READY reached;
  - LOCAL_ENVIRONMENT_ATTESTED reached and recorded in the live Hub (2026-10-02 ~02:13 UTC, PASS_LOCAL 71 checks), then invalidated on purpose by the new canary version (C15r/C15s reaper check, ~03:50 UTC): re-attest from the UI;
  - WSL_LIVE_SANDBOX_VALIDATED reached live on 2026-10-02 07:20-07:30 UTC (owner clicks, Factory Demo A2, mission `mis_muqmvlvl_f21803e877`): Codex gpt-6.1-sol writer through `codex@wsl-runner`, C14 export applied, checks 6/6 and QA 2/2 in the environment, sonnet review PASS; bundle `bnd_muqn17e6_19ce971a24` OWNER_ACCEPTED by the owner (2026-10-02); C3 live Stop NOT_RUN; see `M05_LIVE_RESULTS.md`. Hub back in BUILD_SAFE, grants revoked;
  - PIPELINE_ISOLATION_VERIFIED and REAL_PROJECT_ELIGIBLE not reached.

  **R2 stays open.** Real projects keep the R2 refusal on every route.
- **Pre-probe review (2026-10-02 ~03:00–04:30 UTC).** The owner said in chat that Claude should do every approval. A read-only workflow (35 agents) checked whether the first live probe (c) could waste an attempt. Verified against the real `ifrim-runner` without a model:
  - **BLOCKER, fixed: `reap.sh` counted itself.** In "all" mode the reaper found its own subshells. v1 gave `found=3 remaining=3` on an empty workspace, so every real writer turn would have ended FAILED after inference: export discarded, lease retained, attempt spent. v2 skips its own ancestors and descendants, and the attestation now exercises it for real (C15r/C15s: decoy processes, `remaining=0`).
  - **BLOCKER, not code: Demo A.** It already contains the accepted fix, so a BUGFIX baseline passes. The probe needs a fresh fixture project: `node v2/scripts/create-factory-fixture.mjs bug-demo --dir ifrim-factory-demo-a2 --name "Factory Demo A2"` (`--name` is new).
  - **Fixed: test output.** `node --test` in the network-off sandbox lost the child processes' output; only `not ok 1 - <file>` came back. Checks now run with `NODE_OPTIONS=--test-isolation=none`, verified for real, including `npm test`. BLOCKED now needs every failing test to show the socket refusal.
  - **Fixed:** every command or file-change approval is auto-declined on the environment route.
  - **Fixed:** tar directory entries. An env-made `.git/` is ignored, and an unchanged sent-in `.github/` passes.
  - **Fixed:** the worker prompt on the environment route names the Linux copy, not the Windows path.
  - **Tests:** new `v2/tests/m05-live-readiness.test.mjs` (LR-01…06); 5/5 mutants killed.
- **Hub restart on the fixes.** Claude restarted the live Hub at ~03:50 UTC from an app terminal tab (`npm run v2:stop; npm run v2`): pid 32192, BUILD_SAFE. The 02:13 attestation is **no longer valid**: the canary version changed because `reap.sh` and `canary.mjs` are now hashed into it. Re-attest from System → Medii de execuție.
- **Live probe (c):** ran 2026-10-02 07:20–07:30 UTC with the owner's clicks (see the levels above and `M05_LIVE_RESULTS.md`). The earlier note that it had not run is superseded.
- **Unchanged:** Demo B bundle `bnd_mupwze7b_e03f70f2d7` awaits the owner; the Demo B draft `mis_mupy0no5_922d2614b0` is SPEC_DRAFT; AROBS, ProDelivery and Sales live untouched.
- **Next (historical, state 2026-10-02 ~04:30 UTC; done since: (c) ran, M05 pushed, Demo A2 accepted):**
  1. **Done:** the migration dry run, the restart onto `2.6.0-m05`, the first attestation, the pre-probe fixes, and the restart onto the fixes.
  2. Re-attest from System → Medii de execuție (Inspect → C16 → attestation). Expect PASS_LOCAL with C15r/C15s.
  3. Run (c) per `M05_LIVE_VALIDATION_PLAN.md` "Precondiții" on Factory Demo A2:
     - create the project with `create-factory-fixture --name`;
     - put it on the route;
     - set LIVE_VALIDATION;
     - create the Codex RW and Claude RO grants (3 attempts, 150 min each);
     - set the mission limits through the API;
     - start the mission.

     It needs the owner's clicks in the UI.
  4. (b) only after the preview/E2E/review isolation decision.
  5. Push of M05: the owner's step if Claude's push is refused.

## 2026-10-01 (night) — M03 closure probes and the R2 environment (current; see `M03_CLOSURE_RESULTS.md`)

- **Probes (owner-approved, owner clicks):** 2.3 PASS_LIVE, 2.5 PASS_LIVE, 2.6 PASS_LIVE. Demo A bundle accepted by the owner. Demo B bundle `bnd_mupwze7b_e03f70f2d7` awaits the owner's decision.
- **Hub:** BUILD_SAFE, no active grants. Two fixes are on disk and load at the next Hub restart:
  - resume after an empty writer turn re-runs IMPLEMENTING (test M03-FAC-28);
  - the diff renderer: no phantom line for added files, /dev/null headers, the no-EOL marker (M03-DIFF-02).
- **R2:** `ifrim-runner` (Ubuntu 24.04, WSL2) is installed:
  - no Windows drives, interop off, `runner` without sudo;
  - Codex 0.159.2 pinned in `/usr/local/lib/codex`, Node 24 in `/usr/local/lib/nodejs`;
  - profiles with `:root` denied and `~/.codex`, `/tmp`, `.env*` denied;
  - ChatGPT login done through the browser flow (device code returned 503).

  The canary passes PASS_LOCAL 40/40 with the real token present.
- **R2 still open:**
  - the Hub `wsl-runner` (clean env, copied workspace, verified patch, C14/C16);
  - the `host_isolation` gate change bound to the environment fingerprint;
  - a live probe through it.
- **Next:** the owner decides on the Demo B bundle; then the `wsl-runner` milestone; merge `v2-milestone-01` → `main` when the owner wants.

## 2026-10-01 (evening) - Open items after Milestone 04 (version `2.5.0-m04`; supersede every section below where they overlap)

State: M04 Sales is built and verified on synthetic data (BUILD_READY + SIMULATED_SALES_FLOW_VERIFIED). Committed locally as `2301dcd` (not pushed). Report: `M04_REPORT.md`.

Owner decisions:
- **M04 push:** committed as `2301dcd`; push stays the owner's.
- **Sales catalog:** empty on purpose; no services, prices or lead times were invented. Fill it in Vânzări → Catalog.
- **Real data:** the historical ~3,700-company list was not found in scope. Importing a real file is the owner's decision. Before any real data: retention/erasure rules and the legal basis (`M04_CONTACT_POLICY.md` §6).
- **Live research:** needs a separate authorization (sources/domains, volume, duration, methods, kept data, stop conditions). `validateCollectorUrl` is ready; the live adapter refuses everything.
- **Outreach:** OUTREACH_DISABLED. Enabling needs a configured channel, a legal review and an explicit authorization.
- **Sales inference** (AI-written proposals/drafts): needs a future authorization and a route compatible with the subscription and isolation.
- **Unchanged from M03:**
  - Demo A bundle `bnd_mupj3diq_d386324921` awaiting acceptance;
  - probe 2.3 (Demo B `mis_mupj3zl4_9970bdd58b`, BLOCKED at the gate since the 15:24 UTC attempt in BUILD_SAFE);
  - 2.5 and 2.6 NOT_RUN (packages in `M03_CLOSURE_PACKAGES.md`);
  - R2 open (options in `M04_R2_ISOLATION_OPTIONS.md`);
  - `--real-profile` timing; merge to `main`; HUB-018.

Known M04 limitations:
- **Audit:** only static HTML of one fixture page. No speed, contrast, keyboard or full accessibility checks.
- **XLSX:** dates come as serial numbers; merged cells are not expanded; ZIP64 / `.xls` / `.xlsb` / `.ods` are not supported. A 50,000-row workbook parses in ~1.7 s synchronously.
- **Identity:** the same name in another city goes to owner review (it may be a branch); it is never auto-merged.
- **Metrics:** reply/conversion rates and revenue are not computed (they need real events).

## 2026-10-01 (later) - Open items after Milestone 03 (version `2.4.0-m03`; supersede every section below where they overlap)

State: M03 (runtime readiness + Software Factory) is built and tested with fixture providers. It is committed on `v2-milestone-01` on 2026-10-01 at the owner's request (the commit right after `6432c5e`; push: see `git status`/GitHub). `main` is still `e9ab563`. Report: `M03_REPORT.md`. Levels: BUILD_READY + SIMULATED_E2E_VERIFIED. LIVE_SANDBOX_VALIDATED is NOT_RUN; REAL_PROJECT_READY is not reached.

Live 2026-10-01 (owner-approved): probe 2.1 PASS_LIVE (Codex gpt-6.1-sol · medium fixed Demo A through the factory; turn → first command 14 s) and probe 2.2 PASS_LIVE (Claude review with an explicit `sonnet` after the account default `fable[1m]` was refused before the model; PASS, QA 2/2, bundle `bnd_mupj3diq_d386324921` awaiting the owner's acceptance). Probe 2.3 (Demo B, `mis_mupj3zl4_9970bdd58b`) is prepared and needs the owner's „Aprobă și pornește” (the session safety classifier refuses an agent approving the scope on the owner's behalf); 2.5 and 2.6 NOT_RUN.

Owner decisions:
- **Demo A bundle:** accept or reject `bnd_mupj3diq_d386324921` (Misiuni → „Numele din spații trebuie refuzat”).
- **Probe 2.3:** LIVE_VALIDATION + Codex RW × 3 and Claude RO × 3 grants on Demo B, then „Aprobă și pornește” on `mis_mupj3zl4_9970bdd58b`.
- **R2 (P0, open):** the Codex Windows sandbox reads the whole host outside the denied paths.
  - The gate now admits Codex only on hub-test projects, or on a project with the owner's time-limited acceptance. That acceptance is not isolation.
  - Real fix: a separate environment (WSL2 / VM) with only the workspace mounted. Needs install approval. See `M03_RUNTIME_READINESS.md` §3.
- **R3 (P0, code done):** `~/.codex/config.toml`, `config.toml.*` and `history.jsonl` are now denied to model commands.
  - The deny-list fingerprint changed; the owner re-consented on 2026-10-01 (fingerprint `0f5b7efee0143fa8`).
  - Candidate, owner decision: `~/.codex/plugins` (live evidence: the 2026-09-30 RW run read plugin cache files).
- **Commit:** done on 2026-10-01 at the owner's request, after three verification rounds (`M03_TEST_REPORT.md` §6).
- **Known limitation (E2E):** a form that answers a POST with a redirect (post-redirect-get) is not followed by the Hub's request guard (deliberate M02 policy, RT-07); the E2E step fails and `network.blocked` shows why.
- **Merge** `v2-milestone-01` → `main` and **HUB-018**: unchanged from below.

Pre-live steps without a model:
- (Done 2026-10-01) Hub restarted on `2.4.0-m03` after a verified backup (`bkp_muox3o1y_de8f59b508`); migration 3 applied.
- (Done 2026-10-01, owner's request) Canary on a fictive tree: PASS_LOCAL, 50 checks; `config.toml`, `config.toml.bak`, `history.jsonl` DENIED; R2 confirmed open (4 reads ALLOWED, `KNOWN_GAP_R2`).
- (Done 2026-10-01) `codex-sandbox-timing.mjs --fictive`: first command 4.7 s, later 3.7–6.4 s (N=6). The sandbox costs seconds per command on a small profile, not minutes.
- (Done 2026-10-01) Demo projects: `ifrim-factory-demo-a` (`prj_mup6nfto_6214f5f782`) and `ifrim-factory-demo-b` (`prj_mup6nqd7_57f7ba5b4b`), both hub-test.
- (Done by the owner in the UI, 2026-10-01 06:46 UTC) „Verifică contul” with models (`gpt-6.1-sol` default) and the R3 ACL re-consent (fingerprint `0f5b7efee0143fa8`). The real DENY ACEs on the new entries are written at the first real Codex sandbox command.
- Owner, still open: `codex-sandbox-timing.mjs --real-profile` (own terminal).

Installs:
- (Done 2026-10-01, owner's request) Playwright 1.61.0 devDependency, no browser download (Chromium 1228 from the cache). Chromium runs with the OS sandbox. The factory E2E runner is built: e2e criteria with declared steps run on the verified preview; real-browser tests M03-BR-00…03 and FAC-02 pass.
- Local Romanian speech engine and Claude Code CLI upgrade: unchanged.

Not live-verified (NOT_RUN):
- Software Factory with real models: Codex writer on the current (post-MCP-fix) route, Claude review, the repair round-trip, Stop during a real turn, Lega engineering proposal.
- The runner and preview under the real `codex sandbox` (localhost listening under the offline sandbox user is unverified).

Performance (P1): mostly attributed by live probe 2.1 (n=1): effort `max` was the main cause (turn → first command 14 s at `medium` vs 290–467 s at `max`); the first sandbox command with the real profile costs ~150 s once (ACL application), later commands ~5 s. See `M03_PERFORMANCE_REPORT.md` §4.
- Measured before (n=2): Hub ≤ 7 s; turn → first command 290–467 s; both threads at effort `max`.
- Fixed: explicit effort (`medium` by default, verified before the turn).
- Sandbox-only timing on a fictive profile: ~4–6 s per command. Missing: `--real-profile` (large real deny list) and a live `medium` turn. See `M03_PERFORMANCE_REPORT.md`.

Known limitations (M03):
- Stop during a QA command uses the same code as the other stops but has no dedicated test (NEVERIFICAT).
- The plan is deterministic (from the template); a model-proposed plan is not implemented.
- Snapshots refuse workspaces over 4 000 files / 64 MB (excluding node_modules, dist, .git): large real projects need a git-based change set (future).
- Claude Code does not report its effective effort; `permissions.blockReadsOutsideWorkingDirectories` is documented but not applied (version support on 2.1.175 unverified).
- Tests (2026-10-01): V2 286 = 283 pass + 2 rechecked clean (15/15) + 1 SKIPPED_ENV. V1 552 = 548 pass, 1 skipped, 3 time out against the slow live V1 API on 8004 (`/api/health` 5.6 s), today also when run alone; V1 code unchanged, timeouts not widened.

## 2026-10-01 - Open items after M02 + Lega (version `2.3.0-m03`; supersede every section below where they overlap)

State: branch `v2-milestone-01` pushed up to `bbe8757` (M01 `f31240b`, M02 `0fb71d2`, Lega `30bfbef`, `dac2db4`, `ce819b9`, `bbe8757`); `main` still `e9ab563`; nothing merged or deployed. The M02 verification fixes, MCP isolation, one-click approvals, expired-grant display, version `2.3.0-m03` and these docs are in the commit after `bbe8757` (local until the owner pushes). Hub on 127.0.0.1:8011 runs `2.3.0-m03`, BUILD_SAFE, execution gate open (as the owner left it for Lega), 0 active grants, no active run or Lega session; simulator 8012 separate.

Owner decisions:
- R2 (P1, decision before real projects): Codex can read non-protected files of other projects (including their `.env`) by absolute path. Decide before enabling runs on real projects such as ProDelivery.
- R3 (P2, decision): `~/.codex/config.toml*` stays readable by the Codex sandbox and may contain MCP env values.
- Merge (decision): merge `v2-milestone-01` into `main` through a PR. Nothing is merged or deployed.
- HUB-018 (decision): close it as superseded by the V2 live validation, or keep it open.

Owner actions (optional):
- Real Codex ACL pre-flight in your own terminal (`node v2/tests/manual/codex-real-profile-preflight.mjs`). The local permission layer refused it for Claude. The DENY ACEs already exist on the protected paths.

Install approvals (NEEDS_INSTALL_APPROVAL):
- Playwright (Browser Workspace E2E).
- Local Romanian speech engine.
- Claude Code CLI update 2.1.175 → ≥ 2.1.284 (global change).

Not live-verified (NOT_RUN):
- Lega web search and `propose_mission` (also `mission_detail` was not used live).
- Codex ↔ Claude handoff.
- Live Stop/interrupt of a running model turn.
- Codex workspace-write through the rw profile beyond the one run `run_muojnivb_b113ce0591`.

Performance (P2):
- The Windows Codex sandbox takes ~8 minutes before the first command of a run (ACL setup).
- Runs used reasoning effort `max` from the owner's Codex config, which uses more of the plan.

Known limitations:
- Live stream: a database reset whose new log already grew past the client's mark is not detected (`hello` has no stable log identity).
- Lega uses experimental `codex thread/realtime` methods: a Codex update can break it. Real plan consumption of voice is not measured (NEVERIFICAT).
- V1 live-API tests time out inside the full V1 suite (`tests/continuation-api-contract.test.mjs`, `tests/model-policy-api.test.mjs` call the live V1 API on 8004, which answers slowly); alone they pass (16 s and 0.2 s). V1 code was not changed.
- Platform limits: real interactive terminal, always-on-top overlay, desktop control, phone access (binding stays 127.0.0.1).
- Not implemented on purpose: wake word, PWA/service worker, sounds, historical replay, log virtualization.
- Unmeasured: real FPS, OS reduced motion, multi-hour session, real screen reader.

Leftovers (P3):
- Empty conversation with a broken title from an earlier curl (harmless; there is no delete/rename command).
- The Ifrim Hub Test project has uncommitted files created by Codex (the contact form); kept for the owner.

Outside V2:
- The OpenClaw scheduled Windows task is still Ready (not disabled).

Risks:
- Not ready for autonomy: every live action needs LIVE_VALIDATION + OPEN GATE + a grant; every restart returns to BUILD_SAFE.
- Codex isolation on Windows rests on persistent DENY ACEs that also affect Codex desktop sessions.
- Claude read-only is limited at tool level only (no OS sandbox on native Windows); Claude shell/write stays blocked.
- Prompt injection: project notes and (when on) web pages reach Lega's agent. Effects still need the owner's click. Web search `live` keeps a leak path, so the default is `cached`.

Resolved on 2026-09-30 / 2026-10-01 (details in the marked items below):
- Codex thread/start timeout: fixed in `30bfbef`; confirmed by two Codex PASS_LIVE runs.
- Codex live validation: PASS_LIVE twice (`run_muojnivb_b113ce0591` workspace-write, `run_muomogfu_f3b3dcccd7` read-only).
- LEGA-ACCESS: the full-access build was used live by the owner (session `lega_muoic63s_69b4539e26`).
- One-click approvals (live bug: two approved Lega proposals did not run): fixed with "Aprobă și pornește", the "Aprobate, încă nepornite" section (also for npm scripts and browser checks), a toast when the start fails, and Lega mentioning approved-but-not-started items.
- MCP outside the sandbox (live finding: a run called `cua_repl/js` 3 times): fixed for every Hub Codex process (plugins off, config servers disabled by name, refusal before start, `mcpServerStatus/list` fail-closed over every page, MCP call during a turn stops the run) and for Claude (stop before the model if init reports an MCP server or `mcp__` tool).
- Codex ACL consent recorded; Codex account check done (the gate admitted the Codex runs).
- Uncommitted M01/M02/Lega work: committed and pushed on `v2-milestone-01` (the latest fixes are in the commit after `bbe8757`, see State).
- Expired grants are shown and judged as expired.

## Milestone 02 Open Items - 2026-09-30 (superseded by the 2026-10-01 section above where they overlap)

- LEGA (P1): live session PASSED on 2026-09-30 (Romanian ASR/TTS, hub_status, navigate). See `.ifrim/LEGA.md`.
- RESOLVED 2026-09-30 (live): LEGA-ACCESS. The owner used the full-access build live (session `lega_muoic63s_69b4539e26`, 11.4 min, web search `cached`): hub_status 6, how_to 5, recent_runs 5, propose_run 4, point 3, navigate 3, project_brief 3, company_briefing 2, pending_approvals 2, prepare_grant 1, list_missions 1, list_projects 1. Still not used live: web search, propose_mission, mission_detail (see top). History: "full access under control" was first verified only in simulation (8 `M03-ACCESS-*` tests, two independent reviews fixed). It covers the read tools, the arrow (`point`), the grant prefill, missions by approval, per-project run enablement and web search for Lega (default `cached` = OpenAI index, no live page fetch; `indexed`/`live` selectable in the Lega panel).
- V1 flaky test (P3): `tests/ordered-fingerprint-io.test.mjs` "inverse completion" failed once under full-suite load on 2026-09-30 and passed 3/3 alone; V1 code untouched.
- RESOLVED 2026-09-30: CODEX-THREAD-START fix. `project_doc_max_bytes=0` + `project_root_markers=[]` remove sandboxed AGENTS.md discovery from thread/start (root cause per codex-rs 0.159.2); the Hub now sends the project AGENTS.md itself. Confirmed by two owner-approved Codex runs: `run_muojnivb_b113ce0591` (workspace-write, PASS_LIVE) and `run_muomogfu_f3b3dcccd7` (read-only, PASS_LIVE).
- RESOLVED 2026-09-30 (history): CODEX-THREAD-START. The first live Codex run (14:41Z) failed pre-inference with `thread/start timed out after 120000 ms` under the elevated sandbox + Hub profile. The DENY ACEs are present on all protected paths. The root cause was the AGENTS.md discovery at thread/start: with the Hub deny entries every discovery probe ran through the Windows sandbox (setup refresh + ACL sync per probe, no timeout); fixed above. There was no retry and nothing was consumed.
- RESOLVED 2026-09-30: M02-LIVE. Claude read-only PASS_LIVE on the sanitized test project (run `run_muo6i9og_50c329673c`). Codex: FAIL at 14:41 (fixed), then PASS_LIVE twice (see above). The real ACL pre-flight was refused for Claude by the Claude Code auto-mode permission classifier (not worked around) and was not run; it stays an optional owner action. The Hub gate is now open as the owner left it for Lega (see top), not in the per-test state described earlier.
- Leftover (P3): an empty conversation titled with a broken character ("Validare live M02 � Claude") was created when curl sent non-UTF-8 text; there is no delete/rename command, it is harmless.
- RESOLVED 2026-09-30: Codex ACL consent recorded. Details: `M02_SECURITY_READINESS.md` F2–F4.
  - The Windows elevated sandbox enforces the Hub deny list by writing persistent DENY-read ACEs for `CodexSandboxUsers`; they also apply to Codex desktop sessions (still a risk, see top).
  - The gate blocks Codex on Windows without consent for the exact list (Integrations → Izolare, 16 paths, fingerprint `9cab02fd58238507` at the time). Consent was recorded and the DENY ACEs now exist on the protected paths.
  - The real pre-flight (no model) was not run; it is optional (see top).
  - Reversal per path: `icacls "<path>" /remove:d CodexSandboxUsers`.
- RESOLVED 2026-09-30: Codex account check after M02. The gate admitted the Codex runs, so the sandbox readiness was read after a new "Verifică contul".
- Other projects under `Ifrim Digital Proiecte` (P2, decision).
  - With `:root = read`, Codex can read non-protected files of other projects by absolute path.
  - Absolute `**` globs work (F5) but would write ACEs into other projects, so they are prepared, not enabled.
- `~/.codex/config.toml*` (P2): readable by the sandbox and may hold MCP env values. Verify the runner with it denied during the pre-flight before extending the list (new fingerprint, new consent).
- Claude Code with shell/write on native Windows (P2, platform): SECURITY_BLOCKER (no OS sandbox). Read-only is tool-level only.
- Playwright (P2, NEEDS_INSTALL_APPROVAL): devDependency with `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`, reusing Chromium 1223/1228 from `%LOCALAPPDATA%\ms-playwright`. Browser Workspace E2E is not run.
- Local Romanian speech engine (P3, NEEDS_INSTALL_APPROVAL): strict local mode shows NEEDS_SETUP; the browser engine sends audio online and is not used.
- Not measurable in the test pane (P3): real FPS, OS reduced-motion emulation, long sessions, screen reader. Measured instead: GPU cost per frame, short-session heap, DOM audit.
- File symlink test (P3, SKIPPED_ENV): unchanged; Developer Mode not enabled.
- RESOLVED: uncommitted M02 work. M02 is commit `0fb71d2` on `v2-milestone-01`, pushed (branch now up to `bbe8757`); `main` is still `e9ab563`. The merge is an open decision (see top).


## Milestone 01 Open Items - 2026-09-30 (supersede the V2 items below where they overlap)

- RESOLVED 2026-09-30 (see top: Claude and Codex PASS_LIVE on the test project). V2-LIVE (P1, blocked by a local permission): on 2026-09-30 the owner approved the live validation, recorded both billing attestations and ran the account checks. The Claude Code auto-mode permission classifier refused to let the session drive it (classified as a production deploy); it was not worked around. No PASS_LIVE label exists yet; see NEXT_SESSION for how to run it.
- Codex read access to private paths (P2): Codex has no per-path read denial; `.ifrim/private` and `.ifrim/BACKUPS` are protected for Codex only by the prompt rule. Evaluate permission profiles or a work tree without these directories during LIVE_VALIDATION.
- Billing attestations (P1, user action): Codex — credit balance 0 and automatic reload off (ChatGPT Settings → Usage); Claude — usage credits (formerly extra usage) off and auto-reload off. The claude.ai usage page read on 2026-09-30 showed Max plan with usage credits disabled; the formal attestation is still yours to record in Integrations.
- Codex account check not run (P1, user action): `account/read` + `account/rateLimits/read` + `model/list` contact OpenAI with your account (no inference). Needed to verify the plan (V1 reported `prolite`, unverified in V2), the credit balance and the GPT-6.x models available.
- Claude Code CLI 2.1.175 is older than the audited models (P2, your decision, global change): Opus 5.5 needs ≥ 2.1.280, Sonnet 5.5 ≥ 2.1.284, Fable 5.1 ≥ 2.1.257. On 2.1.175 `opus` = Opus 4.8 and `sonnet` = Sonnet 4.6. The Hub does not update global tools.
- Codex desktop auto-updated to 0.159.0 after the PC restart (P3, informative): the protocol schema was regenerated locally and the 9 allowlisted methods exist; fast mode is disabled per Hub process.
- `.claude/settings.json` `fallbackModel` (P3, downgraded): no longer applies to Hub runs (`--setting-sources user`); it still applies to your interactive sessions.
- OpenClaw gateway (P3, decision): not listening after the PC restart (18790 free), while V1 came back on 3004/8004. V2 does not start it; whether its scheduled task stays is your decision.
- Playwright (P2, approval): REUSE decided; installation needs approval. Computer runtime visual control stays native/assisted.
- Temporary local artifacts (P3, cleanup on your OK): `.ifrim/tmp/migration-check/` (coherent copy of the Hub DB used for the migration test, private data), `.ifrim/tmp/v2-tests/hub-*` left by a test agent, `.ifrim/tmp/regression/*.log`. All git-ignored.
- RESOLVED: uncommitted V2 + Milestone 01 work. Committed as `f31240b` and pushed on `v2-milestone-01`; `main` is still `e9ab563` (merge decision at the top).

## V2 Open Items - 2026-09-30

- PARTLY RESOLVED 2026-09-30: live Codex and Claude turns PASS_LIVE (see top); live interruption and handoff are still NOT_RUN. V2-LIVE (P1, blocked on approval): no live Codex/Claude turn, interruption or handoff executed yet. Proposal in NEXT_SESSION. Successor of HUB-018's acceptance criteria.
- HUB-018 (P1, historical, kept open): V1 criteria not met; V1 retired from execution in V2. Do not close without your decision. Open V1 locks imported as information only: `LOCK-mumsn13e-2kew8n` (HUB-018, exclusive) and `LOCK-PD-RESTAURANT-PANEL` (advisory).
- Billing attestations (P1, user action): extra usage (Claude) and automatic credit consumption (Codex) cannot be read by the Hub; routes stay blocked until you confirm in Integrations.
- Codex account check not run (P2, user action): contacts OpenAI with your account (no inference).
- `.claude/settings.json` of this project sets `fallbackModel: ["opus","haiku"]` (P2): automatic in-plan fallback; V2 records the actual model per turn. Remove it if you want to forbid fallback.
- `ANTHROPIC_BASE_URL` present in the Hub process environment when started from the Claude session (P3): stripped from all provider children; check your user environment if it is unexpected.
- Windows file-symlink test NOT_RUN (P3): EPERM without Developer Mode/admin; the junction branch is tested for real.
- V1 continuation latency (P3, historical): 3.3 s cold / 0.16 s warm in isolation; the 30 s timeout appears only under concurrent full-suite load. V2 equivalents respond in 35–45 ms.
- Browser automation (Playwright) and desktop control (P2): blocked until you approve installation/bridge.
- Voice (P3): transcription locality depends on the browser engine (labelled in UI); Romanian local TTS voices not verified on this machine.
- Plugin companion / MCP Events (P3): need a public HTTPS endpoint; not authorized.
- Cutover (decision): V1 tray/autostart and ports 3004/8004; OpenClaw gateway 23596 and the scheduled task.
- RESOLVED: uncommitted V2 work. V2 is committed and pushed on `v2-milestone-01` (up to `bbe8757`); `main` is still `e9ab563`; nothing merged or deployed.

## Current Open Items - 2026-09-29

- HUB-018 P1: automatic Hub backup timed out before Claude admission. Local exclusion/reparse-point source fix requires final focused/full QA, independent review, exact idle-API reload and a valid complete real backup; preserve the failed partial ZIP.
- HUB-018 P1: native Claude turn and actual cancellation/browser acceptance remain unverified. Keep the execution gate suspended and do not retry until backup evidence and approval are current.
- HUB-018 P2: continuation API contract timed out at30s in a full serial run; it passed separately in24.5s. Investigate latency without masking the timeout.
- GitHub handoff was pushed as a WIP snapshot to the private Agent Hub `main`; this does not close HUB-018 or authorize a release. Continue excluding `.ifrim/private`, backups, `.env`, output and credentials from future commits.
- Dependency audit: `nanoid` and `postcss` each have `high` advisories reported by `npm audit --audit-level=moderate`. This handoff is WIP, not a release. Assess supported updates and verify tests before release.


## Authoritative Checkpoint - 2026-09-29, Native Readiness Unknown

- Supersedes older PID/readiness notes below. HUB-018 is NOT operationally accepted. Isolated Gateway23596/18790 remains source-receipted; API22828/8004 replaced30808 through existing hidden supervisor4852 after SQLite leases0/runs0. Frontend3004 is Vite dev, not production preview.
- Backup backup-mululwl8-9lomtj123files0skipped and consistent isolated checkpoint2026-09-28T22-58-34.718Z integrityOK protect this work. No other project/global/vendor/Git history edits or PC restart.
- Owner full serial regression186/186 PASS and production build PASS. Reviewer source GO; independent transport QA48/48 PASS, connection classification5 persistent plus4 additional simulated checks PASS. New connection helper is now loaded by API22828.
- Native creation-only request6:dfcb6fab-d660-49f5-ad5d-949386c36410 SUCCEEDED after1780436ms (~29m40s), sessionId6273c92f-f187-48ea-a7df-a13d78f2b543, exact key agent:ifrim-backend:ifrim-hub:d79b32fc58d1542d5d5439f8edd1d8a2. runStarted:false; no agent/model submitted.
- Read-only describe/chat.metadata confirm the same session, Hub cwd, Luna/max, read-only, native Codex, user-pinned approved subscription and webSearch:false. Actual transport observer coverage confirmed:66 records/8 PIDs,8 initialize OK,7 model/list OK. These are not executed task acceptance.
- Fresh subscription certification PASS for Codex+Claude/all23 roles. A single reviewed120s existing-session ensure was stopped BEFORE send by its readiness guard: health/status omitted modelRuntime. This means UNKNOWN, not demonstrated degradation/auth failure. Official success publishes degraded:false/pendingAgents:[]; undefined projection can also follow runtime invalidation or closure. No create/agent request was sent by that ensure.
- Execution gate re-suspended; certificate evidence preserved. No reuse branch implemented: sessions.create has an official existing-session ensure path, not necessarily recreation. Do not bypass idle/binding checks, increase timeout blindly or treat omitted modelRuntime as ready.
- Remaining: diagnose why publication readiness disappears and severe cold preparation takes~30m; then one bounded Hub-native Codex turn, Claude turn, real cancellation and clicked actual Hub-session visibility. Main Luna/max chat and pure tests do not satisfy these gates. No automatic retry or API billing fallback.
- Owner, reviewer and QA evidence is in LOOP_REPORTS/2026-09-29-hub-018-finalization-plan.md. Preserve existing session/history; reconcile before any next native action.

## Current Override - 2026-09-29

- Latest override: Gateway29340 readiness is resolved; real native sessions.create still fails80420ms with codex app-server request timeout. Exact session key absent after failure; official runtime health/status ready. No model turn submitted. Fresh-home ephemeral/stdio initialize1657ms PASS only narrows the issue; actual account/runtime/session preparation remains unverified. No blind retry or vendor/global patch.
- Final owner serial171/171/build PASS; separate QA16/16 contract/BOM PASS after writer correction. Native Codex/Claude execution, cancellation and clicked Hub-session visibility remain open. Gate stays suspended.

- Native Codex acceptance57d9e6e3 failed before agent admission. Authoritative old Gateway response at00:23:57EEST: sessions.create973187ms UNAVAILABLE, Codex app-server initialize timed out CODEX_APP_SERVER_STARTUP_CANCELLED. Gate suspended; no inference retry loop.
- Clean-home binary initialize-only passed928ms, child24828 closed, no auth/model. Real backend home/runtime/catalog preparation remains unverified; login success is not task readiness.
- Diagnostic SDK startup PID19068 failed state lease heartbeat after5000ms, onlineObservedtrue/entry-not-observed. Native constant has no verified config override. Process/children/listeners are absent; lease was not deleted or disabled. Worker-preload inheritance hypothesis was disproven. SDK diagnostic bootstrap rolled back for a single controlled comparison; pure sanitizer remains staged and receipt-bound, not loaded.
- Full regression169/169 PASS and build PASS; independent focused67/67 PASS do not resolve native startup, provider turn, cancellation or clicked-session visibility. Latest comparative startup in progress; update evidence before claiming availability.

## Current operational override - 2026-09-28

- HUB-018 native acceptance blocker: sessions.create timed out120s before an agent turn was submitted. Read-only reconciliation found no Hub session, but timeout does not cancel server-side creation. Trace lifecycle/catalog/runtime preparation and reconcile before retry; no vendor edits or blind retries.
- Isolated OAuth/auth-source audits and certification now passed for all23 roles and both providers; historical expired-login and unisolated API-profile blockers below do not describe the isolated runtime. Gate is suspended because native acceptance failed, not because login failed.
- Real Codex/Claude turn, cancellation and native clicked-session visibility remain unverified despite pure tests/build passing. No uniform Astra default;6 Luna/max,13 Sol/high,4 Astra/xhigh role defaults remain.
- Global scheduled Gateway task was stopped but not permanently disabled. PC reboot auto-start risk remains. Windows mini dump establishes bugcheck0xA in nt!MiUseSlabAllocator during python.exe cached file read, not a proven third-party/root cause.

## P0

- None recorded yet.

## P1

- Gateway startup is now blocked before spawn when effective stores contain API/token/unknown-provider credentials; actual audit rejects preserved openai:manual. This is prevention, not completed subscription-runtime isolation. Do not remove credentials or restart to bypass it.
- Scheduled Windows OpenClaw Gateway task remains Ready, not disabled (Access denied; elevation cancelled). Current process is stopped, but automatic startup risk remains until administrator disable/isolation is verified.
- Native acceptance remains incomplete despite 107 owner / 22 independent pure tests passing; static legacy environment contract and API health do not prove live session creation, cancellation, recovery, visibility or billing.

- HUB-018 SAFETY STOP: installed OpenClaw setup-inference probes attempted the historical OpenAI API route (observed 403 at api.openai.com/v1/responses) outside the pinned Hub run path. Controlled Gateway stopped and subscription gate suspended; no restart/reactivation until independent ambient no-API audit. Existing API profiles were NOT deleted. Native acceptance third attempt also timed out at sessions.create after 120s. No verified native Hub turn; billing outcome unverified. OAuth device login was cancelled, not completed.

- HUB-018 acceptance: approved global role defaults are applied. OpenAI OAuth is expired (refresh 401); user reconnection is required. Claude native subscription certification passed, but acceptance has not produced a verified turn: sessions.create first rejected creation idempotency (reviewed fix applied), then timed out (latest bounded timeout 120s). Recertify after controlled Gateway restart. Real provider/model/effort evidence, cancellation/lease settlement and OpenClaw visibility remain acceptance gates. Do not present this integration as live-complete.

## P2/P3

- Reviewer P2: generic ZIP backups with skipped files are still recorded as created and can pass the backup gate (pre-existing behavior). Do not approve live GPT-6 execution until skipped-file handling and recovery evidence are hardened. This upgrade has separate complete source and consistent SQLite checkpoints; that does not fix the generic contract.
- GPT-6 OpenClaw live verification is pending. Luna Max works through Codex subagents, but this does not verify the separate bridge. Require explicit approval for any live bridge probe; keep OAuth and no-fallback metadata checks.
- Global OpenClaw and the central role registry still contain GPT-5.6 defaults. Hub overrides them per invocation; no global migration was authorized in HUB-016.
- Backup enumeration now prunes dependency/cache directories before traversing them and excludes all `.env*`. A new packet backup succeeded on 2026-09-26. Locked SQLite files still require a separate consistent SQLite checkpoint; the pre-upgrade checkpoint passed integrity checks. Failed archives are preserved.
- Claude is disabled under the current OpenAI-only policy. Re-enabling it requires an explicit new request.
- Optional: add scheduled read-only loops only when Catalin explicitly wants them; do not enable recurring model calls by default.
- Add design inspiration notes field for UI tasks, with source URL/category and no-copy rule.
