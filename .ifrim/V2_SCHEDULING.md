# Programări (V2, Milestone 01)

Scheduler-e potențiale: Hub local, taskuri programate Claude (desktop), rutine Claude în cloud, automatizări OpenAI/ChatGPT, OpenClaw. **Regula: o intenție are un singur proprietar.** Hub-ul deține intenția + metadatele de ownership; backend-ul de execuție este unul singur.

## Model

- `schedules`: `intent_key` = `comandă:payload canonic@cadență canonică` (ex.: `hourly` și `every 060m` devin `every 60m`), unic printre programările care nu sunt RETIRED (index parțial) — o programare retrasă eliberează intenția; un duplicat întoarce `conflict`, nu o eroare SQL brută; `backend` ∈ LOCAL_HUB | CLAUDE_NATIVE | OPENAI_NATIVE | OPENCLAW, `uses_ai`, `external_effects`, stare DRAFT → ACTIVE ↔ PAUSED → RETIRED.
- `native_schedule_refs` (NativeScheduledTaskReference): PROPOSED → PENDING_USER_SETUP → LINKED → ACTIVE ↔ PAUSED → ORPHANED → DETACHED. Hub-ul **nu creează** programări native: tu le creezi în produsul vendorului (acțiunea `native_schedule.create` este ALWAYS_ASK), apoi înregistrezi ID-ul (`schedule.link_native`).
- `schedule_runs`: UNIQUE(`schedule_id`, `slot`) → cel mult o rulare per slot, chiar după restart sau două tick-uri concurente.

## Reguli de activare

| Backend | Poate fi ACTIVE când |
|---|---|
| LOCAL_HUB | comanda este în lista permisă pe canalul `schedule` (`backup.run`, `native.mirror`, `surface.refresh`, `briefing.generate`, `checkpoint.create`), fără efecte externe; o programare cu model (`uses_ai`) nu poate fi activă în BUILD_SAFE |
| CLAUDE_NATIVE / OPENAI_NATIVE | referința nativă este LINKED (ID înregistrat de tine); Hub-ul doar o urmărește |
| OPENCLAW | niciodată în V2 (OpenClaw retras din runtime) |

Cadențe (ora locală a mașinii): `hourly`, `every Nm` (5–1440), `daily HH:MM`, `weekdays HH:MM`, `weekly mon HH:MM`. Activarea marchează slotul curent ca tratat (fără rulare imediată); după o oprire lungă rulează **o singură** recuperare pentru ultimul slot, nu o rafală.

## Execuție locală

Scheduler-ul de housekeeping (la 15 s) apelează `schedules.tick()`; comanda rulează prin command bus pe canalul `schedule` cu `correlation_id = sch:<id>:<slot>`, deci are politică, jurnal și evenimente ca orice comandă. Eșecurile se înregistrează (`schedule.run_failed`), fără reîncercări automate în buclă.

## Taskuri native Claude

Convenția de acțiune pentru o programare nativă (folosită de UI): `{ command: "native.prompt", prompt, payload: { prompt } }`. `native.prompt` nu este o comandă Hub executabilă: descrie promptul pe care îl configurezi tu în produsul vendorului; intenția rămâne unică prin același `intent_key`. Programările cu model (`uses_ai`) care rulează local sunt sărite în BUILD_SAFE (`schedule.skipped`), inclusiv după un restart.

Instrucțiunile de configurare (`GET /api/schedules/:id` → `setup`, primul rând: „Hub-ul nu creează și nu pornește programarea: o creezi tu.”) spun unde se creează (Claude Desktop → Scheduled tasks pentru local; Claude Code `/schedule` pentru rutine cloud), ce prompt, ce cadență și că rularea consumă din allowance-ul planului. Contul are taskuri programate disponibile în Claude desktop (0 taskuri la verificare, 2026-09-30).

Cod: `v2/server/domain/schedules.mjs`, `runtime/recovery.mjs` (tick), `runtime/command-catalog.mjs` (`SCHEDULE_COMMANDS`).
