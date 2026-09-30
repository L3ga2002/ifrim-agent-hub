# Rutare pe suprafețe de capabilitate (V2, Milestone 01)

Routerul (`v2/server/runtime/router.mjs`) nu alege doar „GPT sau Claude”: alege **DEPARTAMENT/ROL, PROVIDER, MODEL, SUPRAFAȚĂ DE EXECUȚIE, UNELTE și MEDIU DE COMPUTER**. Tabelul (`v2/config/ecosystem/routing.json`) este derivat din matricea cross-ecosistem; faptele live vin din registre și inspecții. Routerul nu pornește nimic: execuția trece prin command bus și poarta de execuție.

## Factori (în ordinea evaluării)

1. **Disponibilitate** — `unavailable`, `plan_restricted`, `rollout_pending`, `blocked` exclud; `needs_setup` −30; `unknown` −40.
2. **Adaptor și control** — o suprafață PROGRAMMATIC fără `start` SUPPORTED este exclusă; un task care cere automatizare exclude suprafețele asistate; asistat −10.
3. **Facturare** — `api`, `paid_plan`, `cloud_provider` exclud (BillingPolicy); `unknown` −20.
4. **Ruta providerului** (doar suprafețe programatice) — verificările BillingPolicy: eșec → exclus; neverificat (atestare/cont) −15, cu mențiunea că poarta va bloca.
5. **Rezerva de utilizare** — peste plafon exclus; în ultimele 15 puncte −20.
6. **Restricțiile proiectului** — proiect neactivat pentru execuție exclude suprafețele locale programatice.
7. **Sensibilitatea datelor** — `confidential` exclude cloud; `secret` exclude orice suprafață cu model.
8. **Istoric** — rata de verificare pentru (tip task, suprafață), doar cu ≥3 rezultate.
9. **Preferința ta** (`settings.routingPreferences`) +25; provider cerut explicit +30.
10. **Mod** — în BUILD_SAFE o suprafață cu model primește `planned_only` (planificat, neexecutat); uneltele locale Hub rămân executabile.
11. **Override manual** — acceptat doar dacă nu încalcă facturarea, sensibilitatea, disponibilitatea sau controlul; cere motiv; se persistă cu `manual_override = 1`.

## Model

Fără nume de model hardcodate acolo unde clientul raportează disponibilitatea: pentru Codex, indiciul (ex.: `sol`, `luna`) se potrivește cu `model/list`; fără listă, modelul implicit se raportează la rulare. Pentru Claude, routerul trimite un **alias** (`opus`, `sonnet`, `haiku`) pe care îl rezolvă Claude Code; modelul efectiv se înregistrează din stream (evenimentul `init`). Politica de modele a proiectului rămâne: Sonnet pentru cod și review normal, Opus pentru arhitectură, securitate și depanare profundă, Haiku pentru rezumate și triaj. **Fable nu este rutat de Hub**: adaptorul refuză `fable`/`best` înainte de proces, iar un `init` care rezolvă un model Fable oprește execuția (în `-p`, Fable poate factura usage credits fără confirmare). Investigațiile care cer Fable rămân sesiuni interactive pornite de tine. Deoarece execuțiile Hub folosesc `--setting-sources user`, un `fallbackModel` sau un model setat în `.claude/settings.json` al proiectului nu se aplică.

## Persistență și explicație

Fiecare decizie (`route_decisions`) păstrează factorii, alternativele cu scor și motive de excludere, motivul lizibil, modul de execuție (`programmatic` | `assisted` | `planned_only` | `blocked`), unealta de computer și statusul (`proposed` → `superseded`). `route.task` leagă decizia de task (`tasks.route_decision_id`). UI: Ecosisteme → Rutare.
