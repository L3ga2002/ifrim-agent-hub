# Etapa „Verificări deterministe pentru neexpunere și proba completă §25” (2026-10-11 21:42 → 2026-10-12)

Prompt al proprietarului din 2026-10-11 21:42 UTC (thread „Neexpunere JSON și proba §25”). Nu începe M12; M12 rămâne DRAFT.
Roluri: Claude coordonator (diagnostic, specificație, repetiție, predare); Codex implementare (`codex exec`, gpt-6-astra, efort high,
sandbox workspace-write); Claude într-o sesiune separată pentru review (agent read-only); QA determinist. În repetiție: Claude (sonnet,
medium) autor doar citire, Codex (gpt-6.1-sol, medium) verificator doar citire. Modelele și configurațiile selectate nu s-au schimbat.

## Baseline

| Element | Inițial (2026-10-11 21:43 UTC) | Final |
|---|---|---|
| HEAD / origin | `c168283` = `origin/v2-milestone-01` (ambele commituri deja pe origin) | `c168283` + commitul local al etapei (vezi `git log`), push la proprietar |
| Live | `2.14.9-m11`, contract 13, schema 12, BUILD_SAFE, gate open | `2.14.10-m11` raportat după repornirea PC-ului (06:31 UTC): autostart-ul a încărcat codul necomis din working tree (vezi „Release”) |
| Fișierele proprietarului | 20 fișiere doar CRLF | neatinse |
| Cardul §25 | `env_mv49pmjs_74958c8740` WAITING_OWNER (expira 23:50:46 UTC), livrarea-copil `dlv_mv49pm32_a9ef4ac194` ARMED | EXPIRED (închis la boot, 06:32:43 UTC); nimic reanimat |

## 2.14.10-m11 (fără migrare, contract 13, schema 12)

- **R-JSON — helper `exposes` (`json-exposure` v1, sha256 `984e7cf2876ddbf514b1a6b6c86741736946f64adf8edf0ef0215369b136704f`)**, în
  `HUB_HELPERS` (`v2/server/factory/test-first.mjs`), pus de Hub în antetul testelor noi doar când spec-ul are `hubHelpers: ["json-exposure"]`
  (setat de planner pentru cererile `hide_public`; spec-urile vechi nu îl au). Contract: `exposes(text, { keys, values })` primește corpul
  HTTP brut (string), îl decodează o singură dată cu `JSON.parse`, parcurge tot răspunsul (obiecte imbricate, array-uri), raportează cheile
  sensibile prin egalitate exactă la orice adâncime și valorile cunoscute ca subșir (valoarea dată și forma ei fără spații la capete) în valori
  text, numere și nume de chei — deci și telefonul cu escape JSON într-un text mai lung sub altă cheie și telefonul folosit drept cheie.
  Întoarce constatări (cale + tip + indexul valorii, niciodată valoarea), cel mult 50; `[]` = nimic găsit în acel răspuns. Text care nu e
  string, JSON invalid, chei/valori lipsă sau goale, o valoare sub 3 caractere, o eroare la parcurgere → `HUB_SETUP exposes: …` (eșec de
  pregătire din antet, niciodată „absent”). Verifică doar răspunsul dat; nu e o certificare generală a datelor personale; nu se aplică
  stocării interne sau răspunsului la creare.
- **R-PROOF**: helper-ul e pur; scurgerea pică pe aserțiunea din corp (`assert.deepEqual(exposes(res.body, …), [])`) → `behaviour`.
  Clasificarea antetului e neschimbată (eșecurile din helper rămân `setup`). `classifyProof` verifică liniile canonice ale helper-ului în
  antet (lipsă / modificat → INCONCLUSIVE, cauza nouă `helper`) și întoarce `helpers: [{ name, version, sha256 }]`, salvat în dovada
  autorului și în evenimentul `factory.test_proof`.
- **Lint** (doar cu `hubHelpers`): `exposure_helper_unused` (fiecare criteriu `public_omits` / `anon_params` are un caz check cu
  `deepEqual/deepStrictEqual(X, [])` sau `equal/strictEqual(X.length, 0)`, X = apelul direct sau un const legat direct; acceptat ca
  instrucțiune directă, în blocuri simple, în `try { } finally { }` fără catch, în `for…of` peste o listă literală nevidă, sau într-o funcție
  locală pe care cazul o așteaptă/apelează; nu contează sub `if`, `catch`, `.map`/`Promise.all`, după `return`/`throw`),
  `exposure_helper_vacuous` (`assert.ok`, `notDeepEqual`, `throws`, `doesNotThrow`, `rejects` … sau un `try` cu `catch`),
  `exposure_helper_shadowed`, `exposure_helper_literal` (literal, obiect/array literal, `JSON.stringify(` ca prim argument),
  `exposure_helper_unavailable` (fără `hubHelpers`), `builtin_patched` (modificarea `JSON`, a prototipurilor sau `Object.entries/keys`);
  semnal `existing_record_unproven`. Restul (corp filtrat, răspuns fără legătură, valori greșite) îl judecă reviewer-ul.
- **R-EXISTING**: criteriile `public_omits` (491 caractere) și `anon_params` (479) cer înregistrarea existentă creată determinist prin API
  înainte de repornire pe aceeași stocare sau identificată; pentru ea și cea nouă: id, ziua testată, telefonul exact verificate intern; ambele
  id-uri în tabloul listei, pentru fiecare parametru anonim; lista goală / id-uri doar în metadate nu trec; `seed: true` + o constantă nu e
  dovadă. Lista parametrilor anonimi și criteriile de păstrare sunt neschimbate. Brief-urile autorului și reviewer-ului au secțiunea
  „Verificări puse de Hub” (contract, forme acceptate, R-EXISTING; reviewer-ul verifică apelul, argumentele, aserțiunea și legătura cu
  răspunsul real; simpla prezență a numelui nu e acoperire).
- **R-INTEGRITY**: helper-ul face parte din octeții testului (sha-ul fișierului protejat îl include; writer-ul nu îl poate schimba fără să
  invalideze protecția); fără `hubHelpers` antetul e identic octet cu octet (c5–c8, amend-reference, r1 reasamblate dau aceleași sha).
  Referința nouă `json-reference` (identitate nouă, sha asamblat în README); candidații istorici neschimbați.
- Neschimbate: `reauthorMax` ≤ 1, R-AMEND, R-INVENTORY, independența reviewer-ului, retragerea întârziată și recuperarea, protecția
  testelor istorice, politica fără facturare API suplimentară.

Fișiere: `v2/server/factory/test-first.mjs`, `factory.mjs`, `spec.mjs`, `v2/server/owner/planners/criteria.mjs`, `engineering.mjs`,
`v2/server/config.mjs`; teste `v2/tests/r-json.test.mjs` (nou, 64 de teste), `r-amend` / `r-stage0-repair` (reiau spec-ul istoric fără
helper, cu aserțiunea că planner-ul îl pune acum), `m10-2-p0r-integration` (versiunea), `fixtures/fake-claude.mjs` (răspunsul
`json-reference`), fixture-uri în `v2/tests/fixtures/stage0-s25/`. Autor: Codex (3 rulări); coordonare și calibrare: Claude.

## Review independent (Claude, sesiune separată, doar citire)

- Runda 1: CHANGES_REQUESTED — major: lint-ul număra drept acoperire orice aserțiune care conține apelul (`assert.ok(exposes(…))` mereu
  adevărat, `notDeepEqual`, try/catch, `if (false)` …); minore: built-in-uri modificabile, valori cu spații, criterii scurtate, test lipsă
  pentru amendarea antet vechi → antet nou. Reparate (Codex, sesiunea `01a12d2f-ff51-7081-a776-f4d4e2d1ec8b`).
- Runda 2: CHANGES_REQUESTED — major: lint-ul devenise prea rigid (respingea `try { } finally { }`, funcții locale, `for…of` obișnuit),
  ceea ce ar fi blocat un test corect la pasul 0. Reparat (Codex, `01a12ed7-6e1c-75e3-bfb3-23eb502dd189`); verificarea reparației: PASS.
  Limita de două runde respectată.

## Teste (executate în această etapă; baseline-ul anterior 1848/1847/1 SKIP/0 FAIL era al lui 2.14.9)

| Id | Ce dovedește | Rezultat |
|---|---|---|
| T-JSON-01 | JSON curat, obiecte imbricate și array-uri → [] | PASS |
| T-JSON-02 | telefon ca valoare exactă, subșir în text, cheie → constatări | PASS |
| T-JSON-03 | escape JSON într-un text mai lung sub altă cheie (și pe răspunsul real al variantei ratate de c8) | PASS |
| T-JSON-04 | cheia sensibilă adânc imbricată | PASS |
| T-JSON-05 | JSON invalid, text non-string, liste goale, valori "" / spații / prea scurte, config invalid → HUB_SETUP, niciodată [] | PASS |
| T-EXIST-01 | seed ignorat / scurgere doar pentru înregistrările dinaintea repornirii / înregistrare ștearsă: referința pică, c8 trece | PASS |
| T-EXIST-02 | înregistrarea existentă în altă zi / telefon nepăstrat: referința pică | PASS |
| T-LIST-01 | listă goală, înregistrarea existentă omisă, id-uri doar în metadate (de bază și cu `debug`): referința pică | PASS |
| T-PROOF-01 | scurgere → PROVEN pe aserțiuni din corp, cu identitatea helper-ului; JSON invalid / config goală → setup, nu PROVEN | PASS |
| T-INTEGRITY-01 | helper modificat → INCONCLUSIVE `helper`; sha fișierului se schimbă; c7/c8 reasamblați au aceleași sha; regulile lint | PASS |
| T-JSON-MATRIX | referința: PASS pe aplicația corectă, FAIL pe aserțiuni pe cea inițială și pe cele 16 defecte istorice | PASS |

- Afectate (25 de fișiere, secvențial, după runda 2): **494/494 PASS**, 0 skip, CPU mediu 88 % (16 eșantioane). `build:v2` exit 0.
- **Regresia V2 completă** (o singură rulare, pe codul final, 2026-10-12 07:07 → 08:19 UTC, CPU mediu 84 %, 71 de eșantioane):
  `npm run test:v2` exit 0 — **1912 teste, 1911 PASS, 1 SKIP (T25, privilegiu de symlink), 0 FAIL**. În timpul rulării s-au schimbat
  doar documente (fără cod). V1 nu a fost reluat (nicio dependență).
- Rulările lui Codex în sandbox-ul lui au picat pe harness (git `Permission denied` în `.ifrim/tmp`, `taskkill: Access denied`,
  Chromium închis), nu pe cod; le-am reluat în repository.

## Repetiția izolată (o singură dată, modele reale, aplicația sintetică, fără Hub-ul live)

Spec-ul repetiției = cel produs de `buildEngineeringSpec` pentru cerința salvată (aceleași 5 criterii, `hubHelpers`); brief-urile din codul
2.14.10. Dovezile: `v2/tests/fixtures/stage0-s25/rh0-*`, `rh1-*`.

| Pas | Furnizor / model / acces | Sesiune | Rezultat |
|---|---|---|---|
| Autor ciclul 0 | Claude sonnet medium (claude-sonnet-4-6), Read/Glob/Grep | `c80e3c56-87de-4ef8-8ae0-7f151c78dedc` | rh0 `528c5d61…`: lint curat; înregistrarea existentă creată prin POST, server repornit, stocarea citită |
| Dovada (2 rulări) | runner local | — | PROVEN (AC-1/AC-2 pe `assert.deepEqual(exposes(…), [])`), helper v1 `984e7cf2…` |
| Verificare ciclul 0 | Codex gpt-6.1-sol medium, read-only | `01a12eea-5aa9-73e3-8b61-6abfc96179dd` | CHANGES_REQUESTED: telefonul salvat nu e comparat cu cel trimis; refuzul numără doar ziua testată |
| Completare ciclul 1 | Claude, `amends` = rh0 | `f27f77f2-a170-44db-8202-8d5c62057a83` | rh1 `c57c5186…`: nimic eliminat, lint curat |
| Dovada | runner local | — | PROVEN |
| Verificare ciclul 1 | Codex | `01a12eed-e994-7c91-9676-7ecb725980a5` | **PASS**, toate verificările anterioare `kept`, niciun `lost` |

Calibrarea rh1 (aplicația sintetică `r-priv-booking`):

| Variantă | Rezultat | Motiv |
|---|---|---|
| corectă | PASS 5/5 | — |
| inițială | FAIL | AC-1, AC-2 pe aserțiuni |
| 16 defecte istorice (`r-amend`), fără cea de mai jos | FAIL | pe aserțiuni; refuză-tot: controalele AC-4/AC-5 (AC-1/AC-2 pică la pregătire: nu se poate crea nimic) |
| scăparea c8 (escape în text, altă cheie) | FAIL | AC-1, AC-2 |
| seed ignorat + scurgere înainte de repornire; înregistrare ștearsă; altă zi; telefon nepăstrat | FAIL | AC-1, AC-2 |
| listă goală / existentă omisă / id-uri în metadate (de bază și `debug`) | FAIL | AC-1, AC-2 sau AC-2 |
| **„existing records only” (telefon doar pentru programările de la 11:00)** | **PASS** | testul folosește 09:00 și 09:30 |
| **doar programările sintetice (seed) expun telefonul** (variantă suplimentară) | **PASS** | testul pornește cu `seed: false` |

**Concluzie: repetiția e incompletă** — cinci dintre cele șase condiții sunt îndeplinite (PROVEN, PASS pe corectă, review Codex PASS,
ambele înregistrări dovedite, nicio verificare pierdută), dar două variante defecte trec. Cauza exactă: R-EXISTING (așa cum l-am scris în
criterii și în brief) se mulțumește cu o înregistrare existentă creată de test; nu cere datele existente proprii aplicației (programările
sintetice puse de `seed`, care există implicit în lista publică reală), iar varianta istorică „existing records only” modela exact acele
programări (seed-urile sunt la 10:00, 11:30, 15:00). Referința `json-reference` are aceeași limită pentru seed. Conform promptului, m-am
oprit înaintea release-ului pentru proba §25 și nu am cerut alt card.

## Release

- Nu am făcut upgrade-ul pentru §25 (repetiție incompletă).
- **Abatere de reținut**: PC-ul a repornit la 06:31 UTC, iar autostart-ul (sarcina de logon) a pornit Hub-ul pe codul din working tree, așa
  că live raportează `2.14.10-m11` (boot `boot_mv4vkfky_7af02bd59b`, contract 13, BUILD_SAFE, fără migrare) fără upgrade-ul cu backup.
  Codul de atunci era cel după runda 1 de review; rundele ulterioare (lint) se încarcă la următoarea repornire. Nicio misiune activă;
  schema neschimbată. Revenire, dacă e nevoie: codul `c168283` (2.14.9-m11, aceeași schemă) și `node v2/scripts/upgrade.mjs --apply`.
- Părintele `dlv_mv1eo8oo_d120460140` rămâne STALE; nicio reconciliere forțată, niciun hash fabricat. Aprobarea creativă neatinsă.
- Testul istoric `butonul-de-programare-trebuie-sa-84f571.test.mjs` rămâne activ (nimic retras).

## Decizii rămase (proprietar)

1. Corecția candidată pentru R-EXISTING (cere aprobarea ta): înregistrările existente includ și datele existente proprii aplicației (pentru
   proiectul §25: programările sintetice puse implicit, identificate în stocare cu id / zi / telefon și găsite în listă), pe lângă cea creată
   prin API; matricea primește varianta „doar sintetice”, iar referința se aliniază. Apoi o nouă repetiție izolată.
2. Proba §25 rămâne neîncepută; nu cer card până la decizia de mai sus.
3. M12 rămâne DRAFT.
