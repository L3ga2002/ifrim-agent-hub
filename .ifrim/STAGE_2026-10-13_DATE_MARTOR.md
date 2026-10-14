# Etapa „Lipsurile de conținut și proba §25” (2026-10-13 16:55 UTC → 2026-10-14)

Prompturile proprietarului din thread-ul „Lipsuri de conținut și proba §25”: 2026-10-13 16:54 UTC (R-DATASET, R-VALUES, R-IDS, context
complet, coduri stabile, o repetiție izolată, diagnosticul celor 8 eșecuri, release și un singur card §25 numai după toate porțile) și
2026-10-13 21:32 UTC (aprobarea limitei de ieșire 64000 doar pentru autorul de la pasul 0, cu opt condiții, și a unei singure repetiții noi).

**Rezultat pe scurt.** Codul e gata, revizuit și testat, dar repetiția nu a produs niciun candidat, așa că **nu am făcut release și nu am
creat cardul §25**.
- 2.14.13: contractul experimentului (datele martor), `values` complet, ambele id-uri API și coduri stabile pentru findings.
- 2.14.14: limita de ieșire 64000 delimitată pentru autor.
- Autorul Claude (sonnet, medium) nu a livrat test în nicio lansare. Cu brief-ul 2.14.13 a atins de două ori limita CLI de 32 000 de
  tokeni de ieșire. Cu 64000, prima lansare a murit odată cu conexiunea Remote Control. Singura lansare completă s-a încheiat cu eroare
  de transport după 10 reîncercări API.
- Constatare nouă: în Hub, autorul are limita pe tură a rolului „reviewer”, 15 min la profilul BALANCED. Toate lansările eșuate au durat
  30–58 min, deci live ar fi fost oprite ca `turn_timeout`. Timeout-urile nu le-am schimbat, cum a cerut proprietarul.

Codul stă în clona izolată `C:\Users\mihai\hub-rc`, neîmbinat în `v2-milestone-01`. Hub-ul live rămâne pe 2.14.10-m11.

Roluri:
- Claude (această sesiune) coordonează, scrie specificațiile, rulează QA, repetiția și predarea.
- Codex (`codex exec`, gpt-6-astra, efort high, workspace-write) a implementat și a reparat.
- Claude într-o sesiune separată (agentul doar-citire `ifrim-claude-code-reviewer`) a făcut două review-uri independente, a câte două runde.
- QA determinist: suitele V2, regresia, matricea de calibrare.
- În repetiție autorul a fost Claude (sonnet, medium, doar citire), lansat prin adaptorul Claude al Hub-ului. Verificatorul Codex nu a fost
  atins, pentru că nu a existat candidat.

## 1. Baseline (2026-10-13 16:56–17:00 UTC, fără reset sau curățenie)

| Element | Constatare |
|---|---|
| Ramuri | `v2-milestone-01` = `origin` = `c1db213`; `claude/project-thread-wn8xqf` = `origin` = `53fe75e` (cod 2.14.12 = `614c42e`); `main` = `17921ac` |
| Fișierele proprietarului | aceleași 20 de fișiere, diferă doar prin CRLF; neatinse |
| Live | `/api/health` 2.14.10-m11, contract 13, BUILD_SAFE, gate open; schema 12; nicio rulare activă, nicio lease, niciun plan activ (`env_mv4a7832` CANCELLED, `env_mv49pmjs` EXPIRED); ultimul backup verificat `bkp_mv49psdx_af1941990e` (2026-10-11) |
| Sesiunea anterioară din thread | oprită după câteva secunde; scratchpad gol, nicio urmă de continuat |
| Node / CLI | Node 24.14.0 (Program Files); Claude Code CLI 2.1.175 (același binar pe care îl rezolvă Hub-ul: npm global `@anthropic-ai/claude-code/bin/claude.exe`) |

Locul de lucru: o clonă nouă la cale scurtă în afara AppData, `C:\Users\mihai\hub-rc`:
- clonată din `53fe75e` cu `core.autocrlf=false`, deci octeții sunt cei ai blob-urilor;
- `node_modules` e joncțiune spre instalarea proprietarului;
- ramura locală `v2-dev`.

## 2. Cele opt eșecuri ale regresiei anterioare — diagnostic pe același arbore

Aceleași trei suite (`m10-2-content-planner`, `m10-studio`, `m10-2-probe-e2e`), rulate pe **același arbore** `53fe75e` (tree `4cee0fa8…`):
- Node: `C:\Program Files\nodejs\node.exe` v24.14.0;
- locația: `C:\Users\mihai\hub-rc`, cu `TEMP=C:\Users\mihai\AppData\Local\Temp`, `USERPROFILE=C:\Users\mihai`, `NODE_OPTIONS` nesetat;
- rezultat: **26/26** (6/6, 13/13, 7/7), cu toate cele 8 teste care picaseră.

Cauza: `v2/server/media/import-access.mjs` refuză orice folder din `%USERPROFILE%\AppData`. Clona veche era sub
`AppData\Local\Temp\hub-dev`, deci și directoarele de test din `.ifrim/tmp/v2-tests` cădeau sub AppData. `config.mjs` și `helpers.mjs`
au rămas neschimbate.

## 3. 2.14.13-m11 (fără migrare, contract 13) — commit `53132ed` în clonă

Specificația: `SPEC_2.14.13.md` (scratchpad). Codex a implementat-o în sesiunea `01a1363b-…`, 17:06–17:36 UTC, și a reparat-o în
`01a13667-…`, 17:55–18:04 UTC.

- **R-DATASET.** Contractul experimentului e în `v2/server/factory/dataset.mjs`, registrul `EXPERIMENT_DATASETS["booking-demo"]` v1.
  - Ceas `2026-10-11T08:00:00` (local), ziua `2026-10-11`.
  - Trei înregistrări inițiale, cu valorile exacte: `seed-2026-10-11-1000` / `-1130` / `-1500`, telefon `0700 123 456`, `synthetic` 1.
  - Tipurile.
  - Domeniul: telefonul nevid e proprietatea datelor demo ale acestui fixture, nu o regulă pentru înregistrările istorice.
  - Controlul pozitiv `hist-2026-10-11-1300`: fără telefon, cu valoarea implicită a schemei `''`, ca la migrarea aplicației.
  - Proveniența: cale, sha256 și linii exacte din `catalog.js` 13–20, `server-app.js` 103–109 / 134–149 / 283 și `slots.js` 4–7 / 33.
    Sursele proiectului hub-test §25 sunt identice octet cu octet cu fixture-ul.

  Cum se folosește contractul:
  - plannerul îl atașează la spec numai pentru hide_public pe un proiect hub-test cu marker real și numai pe câmpul declarat;
  - `checkSpec` îl validează strict;
  - la pasul 0, pentru autor și pentru verificator, Hub-ul reverifică sha-ul surselor și reconstruiește fiecare extras din octeții
    verificați. O nepotrivire, un extras falsificat sau un proiect lipsă opresc pasul 0 cu tipul `dataset` („precondiție invalidă”);
  - faptele nu se recalculează niciodată din codul schimbat.

  Identitatea contractului: `76c76ccd28ff67c3…`.
- **Brief-uri.** Autorul și verificatorul primesc secțiunea „Contractul experimentului”:
  - faptele și proveniența, cu extrasele numerotate;
  - obligațiile R-DATASET, R-VALUES, R-IDS și CONTROL ISTORIC;
  - tiparele validate din existing-reference.

  Fără dataset, brief-urile sunt identice octet cu octet cu 2.14.12.
- **Lint.** Două semnale consultative: `dataset_unfixed` și `values_filtered`.
- **R-CODES.** `findingCode` și `codedReviewFindings` sunt comune Factory-ului și repetiției. Un finding păstrează același cod (`T-001`…)
  în lista de completat a autorului, în `completes`, în findings-urile deschise ale verificatorului și în `previousFindings`. Nu mai apare
  `undefined`.
- **Referința nouă `dataset-reference`** are aserțiuni etichetate DATE MARTOR, ID API, CONTROL ISTORIC și EXPUNERE. AC-3, AC-4 și AC-5
  sunt identice octet cu octet cu existing-reference (snapshotul complet după fiecare refuz e păstrat). Sha-ul asamblat e `81e7ef5a…`.
  - Pe aplicația corectă: PASS 6/6.
  - Pe original: PROVEN în două rulări. Pică numai AC-1, AC-1 istoric și AC-2, pe `exposes`.
  - Respinge cu `ERR_ASSERTION`, fără `HUB_`, toate cele **41** de surse defecte: 29 din inventar, cele 8 suplimentare și 4 noi.
- **Categoriile celor 8 suplimentare:**
  - „initial data not created” și „initial data without phone” → `dataset`: regresie de inițializare sau precondiție invalidă, nu o
    scurgere JSON;
  - „initial rows omitted” și „kept row omitted” → `ids`, plus controlul istoric;
  - „new row omitted” → `ids`;
  - cele trei variante cu parametri → `exposure` pe AC-2 și pe controlul istoric.
- **Cele 4 variante noi:**
  - „returned id differs” și „second returned id differs” → `ids`;
  - „historical phone filled” și „historical row omitted” → `historical`.

  Comparativ, f1 trece „initial data without phone” și „second returned id differs”, iar existing-reference trece variantele istorice.
- Suita nouă e `r-dataset` (T-DATASET-01…07, MATRIX, AC3).

**Review independent 2.14.13:**
- runda 1 (17:37–17:52 UTC): CHANGES_REQUESTED — mediu: un extras falsificat cu forma corectă trecea în brief; mici: proiect lipsă fără
  gardă, ambiguitatea `values` din controlul istoric, nota din README;
- runda 2: PASS.

## 4. 2.14.14-m11 (fără migrare, contract 13) — commit `6a9d174` în clonă

Specificația: `SPEC_2.14.14.md`. Codex a implementat-o în sesiunea `01a13733-…`, 21:37–22:23 UTC, și a reparat-o în `01a13794-…`,
23:23–23:49 UTC.

- **Configurația delimitată.** Un plan nou scris de Hub conține
  `spec.authoring.authorLimits = { maxOutputTokens: 64000, provenance: "decizia proprietarului 2026-10-13 21:32 UTC: …" }`.
  - `checkSpec` acceptă numai valoarea 64000.
  - Specurile aprobate înainte rămân neschimbate, iar hash-urile lor la fel.
  - Cardul afișează o singură linie despre limită.
- **Transmiterea.** Factory-ul trimite limita numai pentru un dispatch `TEST_AUTHORING`. `runs.start` o transmite numai dacă sunt
  îndeplinite toate condițiile: actor `factory`, provider `claude`, ruta Windows și un rând `factory_dispatches` CLAIMED pentru
  TEST_AUTHORING care o conține.
- **Lansarea.** `claudeTurnLaunch` (folosit de `startTurn` și de repetiție) adaugă `CLAUDE_CODE_MAX_OUTPUT_TOKENS=64000` numai în
  mediul acelui proces.
  - Nu atinge `process.env`, fișierele de setări, reviewerii, QA, writer-ul, chat-ul, Lega sau lansatorul WSL.
  - Pentru orice altă rulare, env-ul și argv-ul sunt identice octet cu octet cu 2.14.13.
  - `MAX_THINKING_TOKENS`, timeout-urile, încercările, `reauthorMax`, permisiunile și gărzile de facturare rămân neschimbate.
- **Evidența limitei.** Se înregistrează separat:
  - limita cerută;
  - override-ul din setările utilizatorului (mărginit, altfel `"invalid"`);
  - limita efectivă: numai din mesajul terminal al CLI („exceeded the N output token maximum”) sau dintr-un mesaj cu peste 32 000 de
    tokeni, altfel „nedemonstrat”.

  Datele ajung în evidența rulării și în evenimentul `factory.author_output_limit`.
- **Cauza `output_token_limit`.**
  - Apare numai din eroarea terminală a CLI sau, pentru autorul care a cerut limita, dintr-un ultim `stop_reason=max_tokens`. Orice altă
    rulare păstrează rezultatul din 2.14.13.
  - Se păstrează și când expiră termenul turei.
  - E separată de timeout, quota, transport, billing și limita de context.
  - Încercarea se numără și nu primește automat alta: decide proprietarul.
- **Revenire:** se elimină tratarea `authorLimits` și singura linie de env. Nu există stare globală de curățat.

**Review independent 2.14.14:**
- runda 1: PASS, cu două constatări mici (`TIMEOUT_KEEPS`, override nevalidat) și o notă: reîncadrarea `max_tokens` atingea toate
  rulările Claude. Toate trei au fost reparate;
- runda 2: PASS, fără constatări.

## 5. Teste (rezultate brute, Node 24.14.0, `C:\Program Files\nodejs\node.exe`)

| Rulare | Cod | Rezultat |
|---|---|---|
| Suitele afectate, runda 1 (17:37–17:55 UTC) | 2.14.13 înainte de reparare | 28/28 suite, 526/526 |
| Suitele afectate, runda 2 (18:04–18:31 UTC; review-ul rula în paralel) | 2.14.13 reparat | 27/28 suite: `r-harness` T-RUN-02 a picat pe `spawnSync ETIMEDOUT` la 188 s sub sarcină paralelă; reluat izolat 13/13; `r-json` 64/64 izolat |
| Regresia V2 completă (18:54–20:16 UTC, CPU mediu 80 %) | `53132ed` | 1947 teste: 1933 PASS, 2 FAIL (M03-BR-01 captură de ecran Chromium, RM-10 captură reală — ambele trec reluate izolat pe același cod), 12 SKIP (11 pentru UI neconstruit în clonă — după `vite build` toate trec; T25 NOT_RUN: privilegiul Windows pentru symlink) |
| Suitele afectate (35, 07:50–08:16 UTC, CPU 97 %) | `6a9d174` | 35/35 |
| **Regresia V2 completă (detașată, 08:16–09:30 UTC, CPU mediu 80 %, UI construit, `HUB_V2_STUDIO_DIST` nesetat)** | **`6a9d174` (codul final)** | **1956 teste: 1955 PASS, 0 FAIL, 0 anulate, 1 SKIP (T25 NOT_RUN: privilegiul Windows pentru symlink; ramura acoperită de testul cu joncțiune)** |

## 6. Repetiția (aplicația sintetică, fără Hub-ul live)

Brief-ul și specificația sunt cele produse de generatorii Hub-ului (`buildEngineeringSpec` → `checkSpec` → `specHash`,
`buildAuthorBrief`), pe o copie a aplicației cu marker hub-test. Dovezile sunt în `v2/tests/fixtures/stage0-s25/g-author-launches.json`.

| Lansare | Configurație | Rezultat |
|---|---|---|
| 2.14.13, încercarea 1 (18:22–18:53 UTC) | `claude -p` din scriptul repetiției, sonnet, medium, Read/Glob/Grep, fără limită pe tură, limită de ieșire implicită 32 000 | 4 mesaje doar de gândire cu `stop_reason=max_tokens`, eroare CLI „exceeded the 32000 output token maximum”, 128 278 de tokeni de ieșire, 30 min, cost afișat de CLI 2,10 $, niciun test |
| 2.14.13, încercarea 2 (18:53–19:25 UTC) | identic, sesiune nouă | identic: 4 × `max_tokens`, 129 062 de tokeni, 31 min, cost afișat 2,08 $, niciun test |
| 2.14.14, lansarea 1 (00:12 UTC) | adaptorul Claude al Hub-ului (`createClaudeAdapter.startTurn` → `claudeTurnLaunch`, env de gardă, reguli de deny, stream-json), spec `a4b52eed0547` cu authorLimits 64000, sesiune nouă `d226aa7a…` | a citit 3 fișiere; ultimul eveniment la 00:13:04; procesul a murit cu sesiunea coordonatoare la căderea Remote Control (~00:15); niciun rezultat. Înregistrată ca **întreruptă**, nu ca output_token_limit |
| 2.14.14, lansarea unică (07:51:17–08:49:54 UTC) | identic, detașat de sesiune, sesiune nouă `4189afb6…` | a citit 3 fișiere; apoi 10 reîncercări API ale CLI (9 „unknown”, 1 „authentication_failed”) și „Request timed out” → `failed`, categoria `transport`; limita cerută 64000, override niciunul, efectivă **nedemonstrată**; 1 583 de tokeni de ieșire, text final de 89 de caractere (mesajul de eroare); cost estimat de CLI 0,16 $ |

Relansarea de la 07:51 e decizia mea, pe baza mesajului proprietarului „continuă” (07:47:59 UTC). Mesajul a fost scris înaintea
întrebării mele Da/Nu (07:50 UTC), deci nu e o aprobare explicită a relansării.

Porțile: lint, două rulări PROVEN, cleanup, baseline, review Codex PASS și calibrare — **niciuna atinsă, pentru că nu a existat
candidat**. Experimentul e oprit, conform condiției 7 (fără a doua lansare automată, fără 128000, fără schimbarea modelului sau a
efortului).

**Limitele repetiției față de fluxul live:**
- Scriptul nu a aplicat limita pe tură a Hub-ului. Pentru TEST_AUTHORING ea este rolul „reviewer”: 15 min la BALANCED, 8 la ECONOMIC,
  25 la DEEP.
- Toate lansările eșuate au durat 30–58 min, deci live s-ar fi oprit întâi ca `turn_timeout`, cu o reluare automată după R3-F3.
- Singura reușită istorică a autorului (etapa trecută, 2.14.12) a durat 8 min.
- Prin urmare, limita de 64000 singură nu ajunge pentru fluxul live, dacă autorul nu răspunde mai repede.

Costurile din tabel sunt cifrele estimate de CLI, nu facturi verificate. Ruta a fost abonamentul: `claude auth status` arată
`claude.ai` / `max`.

## 7. Release, backup, §25

- **Release: nu.** 2.14.13 și 2.14.14 nu sunt îmbinate în `v2-milestone-01`. Stau în clonă (`53132ed`, `6a9d174` + dovezi) și pe ramura
  `claude/project-thread-5c9bak`, adusă în repository-ul principal prin `git fetch`, fără schimbarea working tree-ului.
- **Backup: nu**, pentru că nimic nu s-a schimbat live.
- **Porniri necontrolate noi.** După repornirea PC-ului, sarcina de logon a pornit Hub-ul de două ori: 2026-10-14 06:39 și 06:49 UTC, pe
  2.14.10-m11, BUILD_SAFE, fără upgrade și fără backup. Totalul ajunge la șapte.
- **§25:** niciun card nou, niciun plan. Părintele `dlv_mv1eo8oo_d120460140` rămâne STALE. Testul istoric și aprobarea creativă rămân
  protejate. M12 rămâne DRAFT. Autostart-ul pentru release-uri validate rămâne DRAFT separat.

## 8. Ce rămâne (decizia proprietarului)

1. Termenul pe tură al autorului: 15 min la BALANCED, față de 30–58 min observate. E o decizie a proprietarului (limită dedicată
   autorului, alt profil al planului sau oprire). Fără ea, nici 64000 nu poate fi validat live.
2. Eroarea de transport din singura lansare cu 64000 (reîncercări API, „Request timed out”). E nedeterminat dacă vine de la furnizor sau de
   la cererile foarte lungi. **Inferență, nedemonstrată.**
3. Reziduurile mici din etapa trecută rămân: `builtin_patched` fără aliasuri.

Revenire: nimic nu s-a schimbat live. Revenirea validată a Hub-ului rămâne `c168283` + `node v2/scripts/upgrade.mjs --apply`. Revenirea
pentru 2.14.14 înseamnă eliminarea opțiunii, iar pentru 2.14.13 ramura de bază `53fe75e`.


## 9. Continuare 2026-10-14: limita dedicată de 45 de minute (2.14.15) și repetiția completă

Deciziile proprietarului:
- 2026-10-14 10:09 UTC: varianta 1 — o limită pe tură de 45 min, numai pentru autorul de la pasul 0 al planului §25 hub-test, și o
  singură repetiție izolată completă, prin dispatch-ul și runtime-ul Hub-ului;
- 2026-10-14 16:24 UTC: corecția driverului (grant-uri dimensionate după bugetul planului) și o singură repetiție nouă, completă.

### 9.1 Cod (clona `C:\Users\mihai\hub-rc`, ramura `claude/project-thread-5c9bak` = `b111d1c`, NEÎMBINAT, nelansat)

| Commit | Conținut |
|---|---|
| `015d266` 2.14.15-m11 | R-TURN, R-PARITY, card, testele r-turn și driverul repetiției izolate (detalii sub tabel) |
| `cf6b55f` | driverul ia faptele Codex (cont, plan, modele) din probe-ul real al Hub-ului (app-server, fără thread, tură sau comandă), fără fișiere de credențiale |
| `0bf94aa`, `d096459` | grant-urile pasului 0 dimensionate ca un plan confirmat (ciclul 0 + rescrierea unică); scenariul simulat „amend” care o dovedește determinist |
| `b111d1c` | dovezile repetițiilor (`h-rehearsals.json`, candidații `h1-*`, `h2-*`, calibrările) |

Ce aduce `015d266`:
- **R-TURN.** `authoring.authorLimits.turnTimeoutMin` e acceptat numai cu valoarea 45 și numai împreună cu contractul de date §25.
  - Plannerul îl atașează doar planului care are dataset.
  - Un singur resolver (`dispatchTurnLimit`) îl aplică dispatch-ului TEST_AUTHORING al unui spec APROBAT. Nu identifică niciodată autorul după rolul „reviewer” sau după etapa „qa”.
  - Dispatch-ul înregistrează `turnTimeoutMin: 45` și `turnTimeoutSource: "authorLimits"`.
  - `runs.start` acceptă limita numai pentru dispatch-ul TEST_AUTHORING CLAIMED al Factory-ului.
- **R-PARITY.** Evidența `turnDeadline` și evenimentul `run.turn_deadline` înregistrează: armarea la admitere, `turn_sent`, rearmarea, deadline-ul efectiv, dacă s-a declanșat sau cine l-a curățat, plus notificările și reîncercările CLI de după `turn_sent`. Semantica termenului rămâne neschimbată.
- **Card.** Cele 45 de minute apar în `summary.limits` și la pasul 0, numai pentru acest plan.
- Testele r-turn și driverul repetiției izolate.

Roluri:
- Codex (gpt-6-astra, high) a implementat.
- Claude, în sesiuni separate (agentul doar-citire `ifrim-claude-code-reviewer`), a revizuit:
  - runda 1: un flux de 5 recenzenți pe unghiuri diferite, cu fiecare constatare verificată de 2 sceptici. Au rezultat 6 constatări confirmate; între ele, driverul citea `~/.codex/auth.json` (un fișier de credențiale) și putea lăsa procese orfane;
  - runda 2: toate cele 6 închise;
  - ultima rundă (doar driverul) și corectura probe-ului Codex: PASS.

Citirea de credențiale exista doar în modul real al driverului, care nu fusese încă rulat, și a fost eliminată înainte de orice rulare reală.

### 9.2 Teste

| Rulare | Cod | Rezultat |
|---|---|---|
| Suite afectate (36, 13:02–13:35 UTC) | `cf6b55f` | 36/36 |
| r-turn izolat | `d096459` | 26/26, inclusiv „amend”: grant-urile admit ciclul 0, rescrierea și ambele review-uri, iar writer-ul rămâne refuzat |
| Regresia V2 completă (13:34–14:53 UTC) | `0bf94aa` | 1981 teste: 1979 PASS, 1 FAIL (RF-02 lease/heartbeat sub CPU 100 %; reluat izolat, 10/10 de două ori), 1 SKIP (T25) |
| Regresia V2 completă (din 16:38 UTC, CPU 84–100 %) | `d096459` | **blocată** din 19:17 UTC în r-turn — detalii sub tabel |

De ce s-a blocat regresia pe `d096459`:
- Sub sarcină, 7 teste r-turn au picat pe timeout. Unul a lăsat în viață copilul simulat „hang” (PID 30364), care ține deschis procesul suitei.
- Au rămas neatinse 5 suite: runs-handoff și stage-*.
- Până acolo: 9 FAIL (7 r-turn, RM-10, S0R-27, toate timeout-uri sub sarcină) și 1 SKIP (T25).
- Oprirea procesului de test a fost refuzată de stratul de permisiuni („Interfere With Workloads”); comanda e la proprietar.
- **Defect de test:** r-turn trebuie să-și oprească procesele copil simulate și atunci când un test pică prin timeout.

### 9.3 Repetițiile reale (Hub izolat de unică folosință, Factory dispatch + runtime reale)

Configurația comună:
- **Autor:** Claude Code CLI 2.1.175, `sonnet` · `medium`, doar citire, `CLAUDE_CODE_MAX_OUTPUT_TOKENS=64000` cerut.
- **Termen:** 45 min, armat la admitere și rearmat o singură dată la `turn_sent`; reîncercările CLI intră în același termen.
- **Încercări:** `maxAttemptsPerStage: 1`, numai pentru misiunea izolată.
- **Verificator:** Codex `gpt-6.1-sol` · `medium`, prin `codex exec -s read-only`. Ruta reală a Hub-ului (app-server) ar fi scris ACL-uri DENY persistente pe căi noi, ceea ce nu era autorizat.
- **Probe de dovadă:** în runner-ul simulat al modului de test (fără sandbox), ca în toate repetițiile anterioare.
- **Probe reale:** Claude (`claude.ai`, `firstParty`, `max`) și Codex (`chatgpt`, plan `prolite`).
- **Fixture-uri:** etichetate `test:fixture`, numai în baza de unică folosință (mod, poartă, consimțământ de izolare, declarația de facturare).

**Pregătire (12:44 UTC).** Poarta izolată a refuzat Codex, pentru că planul nu era raportat (`codex login status` nu îl afișează). Oprirea s-a produs înaintea oricărui model; am corectat-o folosind probe-ul real Codex.

**h1 (12:58–13:13 UTC, grant-uri 1/1)**
- Autorul a produs candidatul `c30a5d98` în 14 min 19 s.
- Un mesaj a avut **58 417 tokeni de ieșire** (total 63 574). Asta demonstrează depășirea plafonului vechi de 32 000; limita cerută e 64 000, dar plafonul exact nu a fost observat.
- Lint valid; dovada PROVEN.
- Review Codex (1 min): CHANGES_REQUESTED — AC-2: rândul istoric după fiecare parametru; AC-3: `created_at` lipsea din snapshot.
- Rescrierea permisă a fost refuzată la `live_grant`, înaintea modelului, din cauza grant-urilor driverului (o singură încercare).
- Driverul a închis apoi misiunea (CANCELLED); n-am mai atins-o după aceea.
- Calibrare: aplicația corectă 5/5; 41/41 variante defecte respinse. Una dintre ele („returned id differs”) e respinsă printr-un TypeError în AC-4, nu printr-o aserțiune.

**h2 (16:38–17:09 UTC, grant-uri 2/2 după bugetul planului)**
- Ciclul 0 (24 min 34 s): un mesaj a atins **64 000** de tokeni (usage; total 104 755). Plafonul cerut a fost deci atins, dar `stop_reason` al acelui mesaj nu e înregistrat separat.
- Candidatul `8ec8618e` a fost **respins de lint**: folosea numele rezervat `hubAdd` și încărca `../../src/server-app.js` în afara unui test. Respingerea a consumat rescrierea unică.
- Rescrierea (3 min 22 s): candidatul `87a6755f`, lint valid, nicio verificare pierdută, dovada PROVEN.
- Review Codex (1 min 16 s): **CHANGES_REQUESTED** (`created_at` rezolvat):
  - T-001: setul complet nu e revalidat după repornire;
  - T-002: rândul istoric e comparat înainte și după toată bucla, nu la fiecare parametru;
  - T-003: lipsește confirmarea prin slots a intervalului de la 13:00.
- Rescrierea e epuizată, iar misiunea e în NEEDS_OWNER_DECISION. Am oprit experimentul.
- Calibrare pe `87a6755f`: aplicația corectă 5/5; **41/41 variante respinse, toate prin aserțiuni comportamentale** (niciun TypeError, niciun eșec de pregătire).

Pentru ambele repetiții:
- Termenul nu s-a declanșat în nicio tură. În h2: `turn_sent` la 16:39:05 cu deadline la 17:24:05; la rescriere, `turn_sent` la 17:03:28 cu deadline la 17:48:28.
- Reîncercări CLI după `turn_sent`: 0.
- Toate procesele înregistrate (probe, autor, runner, verificator) s-au oprit. Verificarea după PID și CreationDate nu a găsit niciun proces rămas.
- Costuri afișate de CLI (estimări ale clientului, nu facturi verificate): h1 autor 1,46 $; h2 autor 1,74 $ și 0,58 $.

### 9.4 Porți, release, §25

Porțile cerute înainte de live:

| Poartă | Rezultat |
|---|---|
| Lint valid | da, la rescriere |
| Două rulări PROVEN | da |
| Cleanup | da |
| Baseline normal | neatins |
| **Review Codex PASS** | **nu** |
| Calibrare | da, 41/41 |

**Nu am făcut release și nu am creat cardul §25.**
- Hub-ul live rămâne pe 2.14.10-m11; nimic nu e îmbinat în `v2-milestone-01`.
- Misiunea CANCELLED din h1 și dovezile ei au rămas nemodificate.
- M12 rămâne DRAFT.

### 9.5 Ce rămâne

1. Autorul nu atinge pragul verificatorului în rescrierea unică. În h1 și h2 constatările sunt mici și precise (comparația integrală a rândului istoric la fiecare parametru, revalidarea setului complet după repornire, confirmarea prin slots), dar cer o a doua completare. Decizia e a proprietarului: o regulă suplimentară în brief (tiparul exact al acestor verificări în contractul experimentului) sau oprirea.
2. Defectul testelor r-turn sub sarcină: procesul copil simulat rămâne viu după un timeout, iar regresia completă pe `d096459` rămâne neîncheiată.
3. Ciclul 0 din h2 a fost respins de lint pentru o greșeală mecanică a autorului (`hubAdd`, încărcare în afara testului), care a consumat rescrierea. R-NEEDS completează automat `needs`, dar aceste două reguli rămân respingeri dure.
