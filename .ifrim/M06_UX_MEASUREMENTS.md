# M06 · Măsurători UX

Data: 2026-10-02. Calculatorul acesta: Windows 11, 12 CPU logice. Măsurătorile 1–6 au rulat **în timp ce suita completă V2 rula în paralel**, deci valorile sunt mai mari decât pe un sistem liber. Toate sunt PASS_SIMULATED: Hub de test, provideri fixture, fără modele reale. Nu e niciun procent de îmbunătățire: nu există un baseline măsurat cu aceeași metodă pentru UI-ul vechi.

**Metoda:** scriptul de măsurare din scratchpad (performance.now în Node, peste command bus și serviciile reale), `face-perf.mjs` (Chromium headless prin Playwright, timpul CPU per cadru raportat de randare), M06-UI-E2E-01 (fluxul în UI-ul real).

## 1. Fricțiunea zilnică (după configurarea unică)

| Indicator | Țintă (§29) | Măsurat |
|---|---|---|
| Formulare de grant pentru o misiune normală eligibilă | 0 | **0** (M06-EN-02, M06-UI-E2E-01: singurele comenzi ale proprietarului sunt `envelope.confirm`; granturile au `envelope_id`) |
| Confirmări pentru un scope nou | 1 | **1** (plus Windows Hello dacă sesiunea e blocată sau expirată) |
| Confirmări între writer, review, QA, remedieri deja permise | 0 | **0 la TRUSTED**; la ASSISTED o remediere cere o confirmare de diferență (intenționat) |
| Acțiuni locale simple fără apel AI | imediat | intenție 0,06 ms p50 / 0,57 ms p95; cockpit 37 ms p50 / 178 ms p95 |
| Detaliile la o comandă distanță | da | „Arată-mi ce a schimbat Codex”, „Testele?”, „Claude ce a găsit?” deschid cardul |

**Comparație cu M05** (din `M05_LIVE_RESULTS.md`, pașii proprietarului în proba (c)): rută, LIVE_VALIDATION tastat, grant Codex, grant Claude, misiune, „Aprobă și pornește”, „Reviewer: sonnet” + „Reia”. Rezultă 6–7 acțiuni în 4 ecrane. În M06, pentru aceeași misiune după configurare: 1 propoziție (opțională) + 1 confirmare. Configurarea unică (autentificator, politică, autonomie) e separată și nu se repetă.

## 2. Latențe (separate, cum cere §29)

| Pas | p50 | p95 | Max | Eșantioane |
|---|---|---|---|---|
| Rezolvarea intenției (local, fără I/O) | 0,06 ms | 0,57 ms | 20,4 ms | 400 |
| „Hai să lucrăm la …” prin command bus (rezolvare + cockpit din DB + notițe + repository) | 36,6 ms | 178 ms | 201 ms | 10 |
| Construirea cockpitului singur | 49,3 ms | 90,3 ms | 112,8 ms | 10 |
| Plan (envelope: scope-uri, poarta pentru writer și reviewer, starea repository-ului) | 15,0 ms | 16,2 ms | 16,5 ms | 5 |
| Confirmare → ACTIVE (granturi derivate + aprobarea scope-ului + pornirea fabricii) | 192 ms | — | — | 1 |
| Confirmare → prima execuție (backup verificat + pornirea providerului fixture) | 3,39 s | — | — | 1 |
| Confirmare → DELIVERY_READY (fixtures, toată bucla) | 5,8 s | — | — | 1 |
| Caracteristici vocale pentru 3 s de audio la 48 kHz (în pagină) | 149 ms | 242 ms | 415 ms | 5 |
| Verificarea vorbitorului (Hub, cosinus pe 38 de numere) | < 1 ms (nemăsurat separat; un vector) | — | — | — |

**Ce nu e măsurat aici:** latența providerului real (GPT-Live, Codex, Claude); transcrierea (nu există local); întârzierea modului strict pe vocea ta, care e durata propoziției + ~150 ms + redarea.

## 3. Randarea feței

| Formă | CPU / cadru | Particule | Canvas |
|---|---|---|---|
| Nucleu | 0,16 ms | 2.200 | 362×320 |
| Față | 0,16 ms | 2.200 | 362×320 |
| Hartă | 0,17 ms | 2.200 | 362×320 |

- **Ce înseamnă CPU / cadru:** timpul JavaScript plus emiterea comenzilor WebGL, raportat de componentă (`data-cpu-ms`). Timpul GPU nu e inclus; renderer-ul Chromium headless e „WebKit WebGL”.
- **Limitări puse:** pixel ratio ≤ 1,5 (1,25 în modul discret); 900 de particule în modul discret.
- **Când se oprește randarea:** când pagina nu e vizibilă. Observat: cu panoul browserului ascuns, canvasul n-a desenat niciun cadru.
- **Reduced motion:** un singur cadru la schimbare.
- **Ce n-a fost profilat încă:** memoria la schimbări repetate de proiect. Fiecare geometrie nouă creează un canvas nou și eliberează contextul vechi, deci nu se refolosește un context pierdut. Profilarea de durată rămâne de făcut în sesiunea live.

## 4. Ce rămâne de măsurat live (cu tine)

- Windows Hello real: timpul până la sesiune.
- Vocea ta: înscrierea și latența filtrului strict pe propoziții reale.
- Fluxul D3/D4 cu modele reale: timpul până la prima comandă a writer-ului prin `codex@wsl-runner`, deja măsurat în M05 (13 s).
