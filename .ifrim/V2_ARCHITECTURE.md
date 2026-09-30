# Ifrim Agent Hub V2 — Arhitectură

Stare: Milestone 01 (fundația AI Company OS), 2026-09-30. Decizii și clasificarea V1: `.ifrim/REBUILD_DECISIONS.md`. Ownership: `.ifrim/V2_OWNERSHIP_MAP.md`.

## Milestone 01 — AI Company Operating System (strat nou peste fundația BUILD_READY)

```
Cătălin (owner) → Chief of Staff (rol + workflow + politici, nu model permanent)
  → Company Control Plane = Hub V2 (UN SINGUR plan de control, SQLite + evenimente)
      company → departments → goals → objectives → missions → tasks (+ task_dependencies)
      command bus → approval policy → router → execution surface → execution → events → persistence
  → Agent runtime: suprafețe de execuție OpenAI + Anthropic (programatice, asistate, oglindite)
  → Specialist layer: frameworkuri doar unde aduc valoare unică (V2_FRAMEWORK_EVALUATION)
  → Tools / memory / computer: registre Hub + capabilități native
```

| Strat | Module (`v2/server/`) | Document |
|---|---|---|
| Company runtime | `domain/company.mjs`, `domain/chief-of-staff.mjs`, `domain/missions.mjs` (șabloane noi: research, operations_routine, executive_review) | `V2_DATA_MODEL.md` |
| Command → Policy → Routing → Surface | `runtime/commands.mjs`, `runtime/command-catalog.mjs` (≈60 comenzi), `policy/approval-policy.mjs`, `runtime/router.mjs` | `V2_ROUTING.md`, `V2_SECURITY_MODEL.md` |
| Execution surfaces & capabilities | `domain/surfaces.mjs`, `providers/native-sessions.mjs`, `config/ecosystem/*.json` | `V2_EXECUTION_SURFACES.md`, `V2_PROVIDER_ARCHITECTURE.md` |
| State machines | `runtime/lifecycles.mjs` (+ `state-machine.mjs` pentru task) | mai jos |
| Evenimente v2 | `events/bus.mjs` (envelope cu company/department/project/mission/task/run/correlation, `raw_ref`, context ambiental AsyncLocalStorage) | mai jos |
| Checkpoints / handoff | `runtime/checkpoints.mjs`, `runtime/handoff.mjs` | `V2_HANDOFF_PROTOCOL.md` |
| Memorie / skills | `domain/memory.mjs`, `domain/skills.mjs`, `v2/skills/*/SKILL.md` | `V2_MEMORY_AND_SKILLS.md` |
| Programări | `domain/schedules.mjs`, tick în `runtime/recovery.mjs` | `V2_SCHEDULING.md` |
| Computer runtime | `domain/computer.mjs` | `V2_COMPUTER_RUNTIME.md` |
| Unelte / connectori | `domain/integrations.mjs`, `tools/registry.mjs` | `V2_EXECUTION_SURFACES.md` |
| Artefacte | `domain/artifacts.mjs` | `V2_DATA_MODEL.md` |
| Telemetrie | `runtime/telemetry.mjs` | `V2_TELEMETRY.md` |
| UI de diagnostic | `web/src/screens/Company.jsx`, `Ecosystem.jsx`, `System.jsx` | `DESIGN_SYSTEM.md` |

Fluxul de comandă: orice schimbare de stare venită din UI, voce, programări sau companion este o comandă numită (`POST /api/commands` sau adaptoarele REST) → validare pe schemă → canal permis → decizia politicii de aprobare (AUTO_ALLOWED / ASK_ONCE_FOR_TASK / ALWAYS_ASK / DENIED) → rutare opțională (decizie persistată) → execuție (în aceeași tranzacție cu jurnalul comenzii și evenimentul, pentru comenzile sincrone) → evenimente cu același `correlation_id`. UI-ul nu scrie direct starea.

Mașini de stare aplicate: task (12 stări), goal, objective, mission (derivată, tranzițiile imposibile sunt respinse și semnalate), agentRun, providerSession, handoff, approval, schedule, nativeScheduleRef. `GET /api/lifecycles` le expune.

## Principii

- **O singură sursă autoritativă**: `.ifrim/private/hub-v2.sqlite` (proiecții + log de evenimente append-only). Modelele nu dețin lista de taskuri.
- **Un singur coordonator**: Hub-ul. Providerii (Codex, Claude Code) sunt clienți oficiali nemodificați, porniți ca procese copil. OpenClaw nu mai este pe traseul de execuție.
- **Politicile sunt cod**: BillingPolicy, poarta de execuție, aprobările legate de acțiune, lease-urile de scriere și backup gate sunt aplicate în backend, nu în prompturi.
- **Siguranță la pornire**: fiecare boot revine în BUILD_SAFE, nu repornește nimic și marchează onest execuțiile întrerupte.
- **Fără dependențe runtime noi**: Node 24 (`node:sqlite`, `node:http`, `zlib`), React 18 + Vite 8 deja existente în repo.

## Structură (`v2/`)

```
v2/
  server/
    main.mjs            pornire: config → hub → recovery → HTTP (127.0.0.1:8011)
    hub.mjs             asamblarea modulelor (fără efecte la import)
    config.mjs          căi, port, mod test (date izolate în .ifrim/tmp)
    core/               ids, erori (taxonomie), JSON canonic + SHA-256, validare
    storage/            db.mjs (WAL, tranzacții), migrations.mjs (schema v1), v1-import.mjs
    events/bus.mjs      bus versionat: seq monoton, dedupe_key, publicare după COMMIT
    policy/             billing.mjs, approvals.mjs, gate.mjs (+ circuit breakers)
    runtime/            state-machine, leases, supervisor (arbore de procese), runs, handoff, prompt, recovery (+ scheduler)
    providers/          jsonrpc.mjs, codex.mjs (app-server), claude.mjs (claude -p stream-json), classify.mjs
    backup/             zip.mjs (writer/reader), backup.mjs (colectare, snapshot SQLite, verificare restaurare)
    domain/             projects, conversations, missions, backups, grants, usage, memory (FTS5), leads, voice, briefing, settings
    tools/              registry.mjs (instrumente declarate), git.mjs
    http/               server.mjs (securitate, static, SSE), routes.mjs
  web/                  React + Vite: Control Room, Focus, ecrane, nucleu procedural (WebGL2/Canvas2D/SVG)
  config/               roles.json (15 roluri), skills.json (11 skill-uri), capabilities.json (registru DevDay)
  scripts/              start/stop/status (proces de fundal, nu serviciu Windows)
  tests/                node:test, fixture-uri provider simulate (fake-codex, fake-claude), teste manuale
```

## Flux critic

`mesaj` → `POST /api/conversations/:id/runs` → **poartă** (mod, poartă suspendată, grant live, scope proiect, BillingPolicy, circuit breaker, concurență ≤2, lease liber, backup) → **lease** exclusiv pe workspace → consum o încercare din grant → **backup verificat** (creat și restaurat în test dacă cel existent are >30 min) → înregistrare run + mesaj „streaming” → **prompt** din conversația canonică (reguli, pachet handoff dacă există, decizii, transcript mărginit) → **adaptor provider** → evenimente (delta efemere prin SSE, activitate/notice persistate) → **finalizare**: mesaj final imutabil, sesiune nativă atașată, lease eliberat (sau reținut dacă procesul nu confirmă ieșirea), task → VERIFYING (niciodată direct COMPLETED), breaker actualizat → **review/QA** ca run-uri separate cu dovezi separate.

Eșecurile înainte de model (gate, autentificare, facturare, politică, validare) sunt marcate `pre_inference` și nu declanșează alt provider.

## Adaptoare (contract intern)

| Metodă Hub | Codex (app-server) | Claude Code |
|---|---|---|
| inspectInstallation | `codex.exe --version` (bundle Codex desktop) | binarul real din pachetul npm + `--version`/`--help` |
| inspectAuthentication | `initialize` + `account/read` (+ `account/rateLimits/read`) — fără turn | `claude auth status --json` în același mediu controlat |
| inspectCapabilities | `model/list` (opțional) | flaguri detectate din `--help` |
| startSession / resumeSession | `thread/start` / `thread/resume` | `--session-id <uuid>` pre-alocat / `--resume` |
| sendInput + streamEvents | `turn/start` + notificări `item/*`, `turn/*` | prompt pe stdin, `--output-format stream-json` |
| requestInterrupt | `turn/interrupt`, apoi oprirea arborelui | oprirea arborelui (taskkill /T); turn marcat neterminat, sesiune reluabilă |
| inspectUsage | `account/rateLimits/read` + `account/rateLimits/updated` | necunoscut (CLI nu expune cote); `result.usage` + estimare client |
| prepareHandoff | thread id | session id |

Codex: allowlist de metode (`initialize`, `thread/start|resume|read`, `turn/start|interrupt`, `model/list`, `account/read`, `account/rateLimits/read`). Metodele care consumă credite, schimbă autentificarea sau configurația sunt refuzate în client. Cererile server→client de aprobare sunt transformate în aprobări Hub.

Claude: niciodată `--bare`, `--fallback-model`, `--dangerously-skip-permissions`, `--max-budget-usd`. `--strict-mcp-config` cu config gol; workspace-urile cu hooks/MCP proprii sunt refuzate dacă proiectul nu e marcat de încredere.

## Evenimente și UI

- `events.seq` ordonează totul; SSE trimite `id: seq`, reconectarea reia din `Last-Event-ID` (fără goluri, fără duplicate). Deltele de text sunt efemere; conținutul persistat se reîncarcă din API.
- Backpressure: dacă scrierea SSE se blochează, conexiunea se închide, iar clientul reia din SQLite.
- UI-ul pornește fluxul de la `lastSeq` curent (istoricul nu devine notificări noi) și eliberează conexiunea la `pagehide`.

## Porturi și procese

- V2: `127.0.0.1:8011` (API + UI build), dev UI `127.0.0.1:3011` (proxy către 8011). Perechea 3004/8004 rămâne a V1 până la cutover aprobat.
- Procesul V2 este unul singur (API + scheduler + supervisor). Închiderea browserului nu oprește munca pornită.
- Pornire/oprire: `npm run v2`, `npm run v2:stop`, `npm run v2:status` (vezi `.ifrim/RUNBOOK.md`).
