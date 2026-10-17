# M09 · Raport de teste

Data: 2026-10-04. Cod `2.10.0-m09` (necomis).

**Mediul:**
- Node 24.14.0;
- ffmpeg 8.1.2 (gyan.dev full build), pe PATH;
- Playwright 1.61.0, cu Chromium 1228 local;
- Windows 11.

Nicio inferență, nicio rețea externă, Hub-ul live neatins. Toți providerii sunt fixture-uri.

## 1. Suitele complete

| Suită | Baseline M08 (raportat) | M09, 2026-10-04 | Observații |
|---|---|---|---|
| V2 completă (`node --test --test-concurrency=1 v2/tests/*.test.mjs`, UI din `.ifrim/tmp/m09-web-dist-final`) | 650 · 649 PASS · 0 FAIL · 1 SKIP | **858 · 856 PASS · 1 FAIL · 1 SKIP** (29 min 58 s) | Eșecul: M09-AS-09 (vezi mai jos), reparat după rulare. SKIP: T25 (symlink de fișier, privilegiu Windows) |
| Toate fișierele `m09-*`, după reparare | — | **208 · 208 PASS · 0 SKIP** | Testele cu ffmpeg și Chromium reale au rulat toate (0 SKIPPED_ENV) |
| Fișierele `m09-*`, după corectura zoom-ului (QA-18) | — | **209 · 209 PASS · 0 SKIP** (4 min 22 s) | Ultima rulare, după ultima modificare de cod |
| V1 (`node --test tests/*.test.mjs`) | 552 · 551 PASS · 1 SKIP | **552 · 551 PASS · 0 FAIL · 1 SKIP** | SKIP: legătura de bază de date (privilegiu de symlink pe Windows), ca înainte |

**Eșecul din rularea completă (M09-AS-09).** Precheck-ul textual adăugat pentru R16 (căile UNC refuzate înainte de orice acces la disc) folosea codul `MEDIA_PATH_OUTSIDE` în loc de codul contractului, `MEDIA_OUTSIDE_ALLOWED_ROOTS`. Codul a fost aliniat, iar testul a primit o regresie R16: o cale UNC e refuzată fără niciun `lstat` pe ea, verificat cu un spion pe `fs.lstatSync`.

Testul sărit nu devine PASS prin alte probe (T25 rămâne NOT_RUN, cu motivul).

### 1.1 Rularea finală completă (pe codul final)

`node --test --test-concurrency=1 v2/tests/*.test.mjs`, cu UI-ul din `.ifrim/tmp/m09-web-dist-final`: **859 teste · 858 PASS · 0 FAIL · 0 cancelled · 1 SKIP** (29 min 48 s). Testul sărit e T25 (NOT_RUN: crearea unui symlink de fișier e refuzată, EPERM). M09 adaugă 209 teste față de baseline-ul M08, iar M01–M08 trec toate.

## 2. Testele M09 pe zone (rularea completă)

| Fișier | ID-uri | Teste | Ce acoperă |
|---|---|---|---|
| `m09-model-binding` | MB | 15 | T01: modelul prezentat = autorizat = trimis; implicitul schimbat; `requestedModel` gol; retry/resume; alias neeligibil; conflict UI–cerere; mismatch la init |
| `m09-billing-evidence` | BE | 12 | T02: identitate, expirare, conversia veche, declarare/retragere, `rate_limit_event`, fără identificatori în clar |
| `m09-skill-composer` | SK | 12 | T03: corpul aprobat ajunge în prompt, versiune stabilă, buget, monitorul (R31) |
| `m09-media-transcribe` | MT, VS | 15 | T04: whisper-cli, anulare, integritate, transcrierea media nu confirmă comenzi; verificarea listenerilor |
| `m09-media-assets` | AS | 26 | T05: căi/joncțiuni/UNC, fișiere goale, prea mari, secrete, executabile, arhive; deduplicare; cotă |
| `m09-media-ir` | IR | 26 | T07/T08: timeline invalid, fps raționale, viteze, keyframes, operații nesuportate; subtitrări RO, SRT/VTT/ASS |
| `m09-media-render` | RN | 19 | T09: randare reală, cache, anulare/crash/disc plin, amprenta IR (R24), ASS cu zona sigură (R18); exporturi |
| `m09-media-qa` | QA | 18 | T08/T14: QA tehnic real, justificare pe cadru, layout, factual, variante, corecturi la timecode, R20, R23, focus (QA-18) |
| `m09-content` | CT | 10 | T15: idei din evenimente, brief/script/storyboard, afirmații cu dovezi, readiness, Sales fără contacte |
| `m09-distribution` | DS | 16 | T06/T10–T13: manifeste, invalidare, pachete, reconciliere, DST, programări pierdute, metrici, experimente, R5/R6 |
| `m09-media-capture` | CP | 11 | T04: OBS v5 (simulat), Public Demo Mode real (Chromium + ffmpeg), refuzul Hub-ului live (R7/R8) |
| `m09-integration` | IN | 5 | comenzi și canale, rute HTTP, Range, UI_STALE, producție reală prin comenzi, boot |
| `m09-lega-studio` | LG | 8 | intențiile Studio, refuzul publicării, liga (R30), telefonul |
| `m09-review-fixes` | RF | 7 | R26, R10/R15, R12, R35, R37, R27, R6 prin Hub |
| `m09-ui-logic` | UI | 9 | logica UI Studio, comenzi cu model explicit |
| `m09-studio-browser` | SB | 1 | Studio în browser real |

## 3. Review-ul adversarial și ce a schimbat

Lista: 39 de constatări (`review/findings.json`, R1–R39).

**Verificarea:** 19 confirmate, 1 respinsă (R1), 19 neverificate. Agenții de verificare s-au oprit la limita săptămânală, iar o parte erau minore neverificate din start.

**Reparate, toate cu test de regresie** (`M09_CORE_FIXES.md`, `M09_MEDIA_RIGHTS_AND_PLATFORMS.md`):
- toate cele 19 confirmate: R2, R3, R5, R6, R10–R14, R17–R23, R26, R27, R37;
- 8 dintre cele neverificate: R7, R8, R15, R16, R24, R30, R31, R35.

**Documentate, nereparate** (OPEN_ISSUES M09 §12): R4, R9, R25, R28, R29, R32–R34, R36, R38, R39.

**Defecte găsite de testele de regresie ale corecturilor:**
1. **R6:** prima corectură (revocarea reverifică manifestele) nu rula niciodată. Destructura greșit rezultatul `rights.revoke`, iar manifestele erau la `impact.affected.manifests`. A fost prins de RF-07, care trece prin comanda reală.
2. **R5:** fără `postedAt`, momentul implicit „acum” era egal cu momentul retragerii făcute chiar de acel apel, deci o postare de după retragere era acceptată. A fost prins de DS-16.
3. **R16:** codul de eroare nealiniat (AS-09, mai sus).
4. **Producția reală a clipului** (nu un test) a arătat că varianta verticală tăia notificările-dovadă.
   - **Cauza:** zoom-ul masterului nu era limitat de zona de interes.
   - **Prima reparare** (plafon pe fiecare keyframe) a înghețat cadrul, iar QA-ul tehnic a semnalat imagine înghețată nejustificată.
   - **Repararea finală:** un singur factor de reducere pe clip, care păstrează mișcarea. Test: QA-18. Verificare prin mutație: fără corectură, QA-18 pică; cu corectura, trece.

## 4. Testele cerute de prompt (§36, T01–T17)

| T | Cerință | Unde | Status |
|---|---|---|---|
| T01 | model/efort prezentat = autorizat = transmis | MB-01..15, RF-04, RF-05 | PASS_SIMULATED |
| T02 | billing Claude: necunoscut, expirat, extra usage, fără fallback | BE-01..12, RF-01, RF-06 | PASS_SIMULATED |
| T03 | skill aprobat inclus efectiv, versiune stabilă | SK-01..12 | PASS_SIMULATED |
| T04 | whisper/OBS/editor autorizat; transcrierea nu confirmă | MT, VS, CP | PASS_SIMULATED (OBS); whisper fixture |
| T05 | ingest corupt, căi/URL-uri nepermise, limite | AS | PASS_LOCAL |
| T06 | manifest, drepturi UNKNOWN/expirate/revocate, propagare | AS (drepturi), DS-05, RF-07 | PASS_SIMULATED |
| T07 | timeline invalid, fps, viteze, keyframes, nesuportat | IR | PASS_LOCAL |
| T08 | subtitrări RO, sync, zone sigure, text peste dovadă | IR, QA-01/02, RN-13b | PASS_LOCAL |
| T09 | randare deterministă, cancel/crash/disc plin, cache | RN | PASS_LOCAL |
| T10 | aprobare invalidată la schimbări | DS-04 | PASS_SIMULATED |
| T11 | rezultat incert, deduplicare, succes parțial, token expirat | DS-09/10 | PASS_SIMULATED |
| T12 | programare pierdută, DST, fără dispatch la repornire | DS-11/12 | PASS_SIMULATED |
| T13 | metrici lipsă, definiții diferite, experimente insuficiente | DS-14/15 | PASS_SIMULATED |
| T14 | scope client, afirmații false, scurgere de date, prompt injection | QA-06 (factual), CP (redactare), SK (tipare riscante), MT (transcriere ≠ comandă), drepturi CLIENT_PROVIDED | PASS_SIMULATED, parțial: nu există un test dedicat „scurgere de date” pe randări |
| T15 | Content → Sales fără contacte sau venituri inventate | CT | PASS_SIMULATED |
| T16 | regresie M08 și pachete istorice | suita V2 completă (M01–M08: 573 de teste) | PASS |
| T17 | zero inferențe, capturi, uploaduri, Git în suite | IN-03 (0 `agent_runs`), DS-13, CP-09, IN-01 (nicio comandă commit/push/deploy/publish) | PASS |

## 5. Ce nu a rulat

- **Mutation testing amplu:** NOT_RUN. S-a făcut doar o verificare țintită prin mutație, pentru QA-18.
- **Orice probă live:** NOT_RUN (planul e în `M09_LIVE_VALIDATION_PLAN.md`).
- **`--inference-path` pe whisper-server real:** NOT_RUN.
- **T25 și testul V1 cu symlink:** NOT_RUN (privilegiu Windows).
