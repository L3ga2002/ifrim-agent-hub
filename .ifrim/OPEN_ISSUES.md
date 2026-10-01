# Open Issues - Ifrim Agent Hub

## 2026-10-01 (evening) - Open items after Milestone 04 (version `2.5.0-m04`; supersede every section below where they overlap)

State: M04 Sales is built and verified on synthetic data (BUILD_READY + SIMULATED_SALES_FLOW_VERIFIED). It is not committed. Report: `M04_REPORT.md`.

Owner decisions:
- **M04 commit** (push stays the owner's).
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
