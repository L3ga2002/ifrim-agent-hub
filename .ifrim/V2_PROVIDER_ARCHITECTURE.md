# Arhitectura providerilor și a suprafețelor de execuție (V2, Milestone 01)

Hub-ul nu tratează un vendor ca platformă principală: OpenAI și Anthropic sunt ecosisteme de prim rang. Un **provider** (OpenAI, Anthropic) oferă mai multe **suprafețe de execuție** (Codex app-server, Codex Cloud, Claude Code headless, Claude Research, Claude in Chrome…). Routerul alege suprafața, nu doar modelul. Registrul complet: `.ifrim/V2_EXECUTION_SURFACES.md` (generat din `v2/config/ecosystem/surfaces.json`).

## Două contracte

### ProviderAdapter (inspecție, fără inferență)

| Operație | OpenAI (Codex) | Anthropic (Claude Code) |
|---|---|---|
| inspectInstallation | `codex.exe --version` din bundle-ul Codex desktop | binarul real `claude.exe` din pachetul npm (`--version`, `--help`) |
| inspectAuthentication | `codex app-server`: `initialize` + `account/read` (fără turn) | `claude auth status --json` în mediul controlat |
| inspectAvailableSurfaces | `surfaces.refreshAvailability()`: `openai.codex_app_server` devine `available` doar cu cont ChatGPT verificat | `anthropic.claude_code_headless` devine `available` doar cu `claude.ai`/`firstParty`; `anthropic.claude_code_background` după o oglindire reușită |
| inspectCapabilities | `model/list` (la cerere) + registrul de capabilități | flaguri din `--help` + registrul de capabilități |
| inspectUsage | `account/rateLimits/read` + `account/rateLimits/updated` | **UNSUPPORTED** în CLI: rămâne necunoscut până raportează o execuție |
| healthCheck | vârsta verificării (<24 h), circuit breaker, poartă | idem |

Codul: `v2/server/providers/codex.mjs`, `claude.mjs`, `native-sessions.mjs`, `domain/surfaces.mjs`.

### ExecutionSurfaceAdapter (execuție)

`start, resume, sendInput, streamEvents, interrupt, stop, prepareHandoff, getStatus, getArtifacts`. Fiecare suprafață declară pentru fiecare operație **SUPPORTED**, **ASSISTED**, **PLANNED** sau **UNSUPPORTED**. `surfaces.requireOperation()` întoarce eroarea „UNSUPPORTED: …” cu `details.support` — o valoare reală, nu un no-op tăcut.

| Suprafață | Cum execută Hub-ul |
|---|---|
| `openai.codex_app_server` | PROGRAMMATIC: `thread/start|resume` + `turn/start`, evenimente `item/*`, `turn/interrupt`; aprobările server→client devin aprobări Hub |
| `anthropic.claude_code_headless` | PROGRAMMATIC: `claude -p --output-format stream-json`, prompt pe stdin, `--session-id`/`--resume`; `sendInput` PLANNED (`--input-format stream-json`) |
| `anthropic.claude_code_background` | MIRROR: `claude agents --json` (read-only); evenimente `provider.native_task_started|updated|completed` |
| suprafețe ASSISTED (Claude Research, Cowork, Projects, Artifacts, Chrome, computer use; ChatGPT Work, Space/Pages, Codex desktop/Review/Security) | `assisted.prepare`: brief (obiectiv, criterii, constrângeri, referințe, cum returnezi rezultatul) salvat ca artefact; taskul intră în `WAITING_PROVIDER`; rezultatul se înregistrează ca `ArtifactReference` și se verifică de tine |
| `openai.codex_cloud`, `anthropic.claude_code_web`, rutine Claude | pornirea este `cloud_task.start` / `native_schedule.create` (ALWAYS_ASK); fără adaptor în acest build (PLANNED/ASSISTED) |
| `openai.agents_api`, `openai.decisions_api` | respinse: facturare API (`paid_api_inference: deny`) |
| `openclaw.gateway` | respins din runtime-ul V2 (vezi `V2_FRAMEWORK_EVALUATION.md`) |

## Reguli comune

- Doar binarele oficiale, nemodificate; mediu de proces controlat (allowlist), fără `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`, proxy-uri sau token-uri; numele variabilelor riscante din procesul Hub sunt raportate, valorile niciodată.
- Claude: niciodată `--bare`, `--fallback-model`, `--dangerously-skip-permissions`, `--allow-dangerously-skip-permissions`, `--max-budget-usd`; `--strict-mcp-config` cu config gol; `--setting-sources user` (setările unui repository nu pot schimba facturarea în `-p`); `CLAUDE_CODE_DISABLE_ADVISOR_TOOL=1`; modelele `fable`/`best` refuzate înainte de proces; evenimentul `init` cu `apiKeySource ≠ none` sau model Fable oprește procesul înainte de model (vezi `V2_SUBSCRIPTION_POLICY.md`).
- Codex: un sold de credite > 0 (sau nelimitat) raportat de `account/rateLimits/read` blochează ruta — după alocare, Codex consumă soldul automat.
- Codex: allowlist de metode JSON-RPC; conturile API key sunt refuzate; metodele de credite/login/config sunt blocate în client.
- Orice pornire trece prin poarta de execuție (mod, poartă, grant live, BillingPolicy, circuit breaker, concurență, lease, backup verificat).
- **Un singur owner al ciclului de viață al taskului.** Când Claude Code folosește subagenți, hooks sau taskuri de fundal *în interiorul* unei execuții pornite de Hub, acestea aparțin execuției părinte (același lease, aceeași telemetrie); Hub-ul nu le creează taskuri paralele. Sesiunile pornite de tine direct în Claude Code sunt doar oglindite.
- Aprobările vendorului (dialoguri de permisiuni Claude/Codex, pluginuri) sunt un strat suplimentar; decizia Hub (`approval-policy.mjs`) se aplică oricum.

## Checkpointuri native vs. checkpoint Hub

Checkpointurile Claude Code (`/rewind`) sunt locale sesiunii și acoperă editările ei; firul Codex păstrează istoricul nativ. Checkpointul Hub (`runtime/checkpoints.mjs`) conține starea cross-provider (misiuni/taskuri, aprobări, lock-uri, sesiuni, teste, artefacte, efecte externe, următoarea acțiune) și **referențiază** sesiunile/checkpointurile native (`native_refs_json`), fără să le copieze. Handoff-ul folosește același checkpoint (pasul 4) și pune referințele în pachet (`native_checkpoint_refs`).

## Evenimente provider-native normalizate

`provider.native_task_started`, `provider.native_task_updated`, `provider.native_task_completed`, `provider.native_task_prepared` (brief asistat), `provider.native_mirror_failed`. Fiecare poartă `raw_ref` (ex.: `claude agents --json @ <timp>`) și envelope-ul v2 (company, department, project, mission, task, run, correlation).
