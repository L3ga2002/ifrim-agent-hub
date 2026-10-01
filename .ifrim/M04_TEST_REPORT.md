# M04 — Raportul de teste (Vânzări)

Versiune `2.5.0-m04` · 2026-10-01 · Windows 11 Home, Node 24.14.0 · Branch `v2-milestone-01`, commit `2301dcd`

Niciun test nu pornește modele, nu trimite e-mailuri, nu face commit și nu accesează internetul. Datele sunt sintetice: domenii `.test`, CUI-uri 99… generate cu cifră de control validă, site-uri fixture locale.

Etichete: PASS_LOCAL (logică locală), PASS_SIMULATED (flux cap-coadă pe fixture-uri), SKIPPED_ENV (mediul nu permite).

## 1. Rezultate pe suite

| Suită | Comandă | Rezultat | Etichetă |
|---|---|---|---|
| V2 completă (inclusiv M04) | `npm run test:v2` | 448 teste: **447 PASS, 0 FAIL, 1 SKIPPED_ENV** (T25 symlink) | PASS_LOCAL / PASS_SIMULATED |
| V1 | `npm test` | 552 teste: **551 PASS, 0 FAIL, 1 SKIPPED_ENV** (symlink fără privilegiu Windows) | PASS_LOCAL |
| Build UI | `npm run build:v2` | OK (Vite, ~1,7 s) | PASS_LOCAL |

Despre V1:

- Baseline-ul raportat era 548 PASS, 3 timeout-uri și 1 omis din 552. În această rulare cele 3 timeout-uri nu au apărut.
- M04 nu a modificat niciun fișier V1 (`src/`, `apps/`, `tools/`, `tests/`). Nu le consider reparate: au fost doar absente acum.

### 1.1 V2 completă

Prima rulare, pe codul de dinainte de revizia de securitate: **422 teste, 420 PASS, 1 FAIL, 1 SKIPPED_ENV**.

- Eșecul era `M03-LEGA-01`: lista fixă a uneltelor Lega nu includea noile unelte `sales_overview`, `sales_lead`, `sales_drafts`. Lista din test a fost actualizată.
- SKIPPED_ENV: `T25 file symlink branch` (privilegiu Windows).

Rularea finală (după revizie și corecturi): **448 teste, 447 PASS, 0 FAIL, 1 SKIPPED_ENV**, în ~16 min.

Ultima corectură (observațiile propunerilor, eticheta din simulator) a intrat în timpul rulării. Am reluat apoi `m02-ui-logic`, `m03-review-fixes` și toate `m04-*`: **158/158 PASS**.

## 2. Testele M04 (139)

| Fișier | Teste | Ce acoperă |
|---|---|---|
| `m04-tabular` | 20 | CSV UTF-8/UTF-16/CP1250, delimitatori, ghilimele RFC 4180, rânduri inegale, limite; XLSX fără dependențe, cu formule neevaluate, macro refuzate, zip-slip și zip-bomb refuzate; export neutralizat |
| `m04-identity` | 28 | CUI cu cifră de control, nume și forme juridice, diacritice, domenii de identitate față de platforme, telefoane păstrate ca text, e-mailuri generice, potriviri cu motive și conflicte, filiale nepotrivite automat, 3.700 de rânduri sub 2 s |
| `m04-audit` | 12 | 14 verificări pe 10 site-uri fixture, dovezi (selector + fragment ≤ 200), prompt injection fără efect, articol și marketplace, date contradictorii, HTML care nu se execută |
| `m04-research` | 13 | Registrul de surse: timeout, rate limit, cache versionat, cereri simultane deduplicate; live refuzat; `validateCollectorUrl` refuză localhost, IP-uri private, metadata, IPv6 mapat |
| `m04-qualify` | 12 | Formula `q-v1`, necunoscut ≠ 0, filtre financiare pe perioade compatibile, override cu motiv |
| `m04-proposal` | 13 | Propuneri fără preț inventat („De stabilit”), observații doar OBSERVED/USER_PROVIDED, ciorne care nu pretind analize inexistente, placeholder-e refuzate |
| `m04-sales-flow` | 13 | Scenariile A–H prin command bus (vezi §3) |
| `m04-review-fixes` | 12 | Regresii pentru constatările reviziei adversariale (vezi §4) |
| `m04-ui-logic` | 15 | Logica UI și verificările sursei: fără `dangerouslySetInnerHTML`, Trimite dezactivat, regulile de ciornă, contact real, banner |
| `m04-browser` | 1 | E2E în Chromium real (Playwright 1.61, sandbox OS): fluxul complet, rollback cu motiv, 360 px fără scroll orizontal, nicio cerere în afara Hub-ului de test |

## 3. Scenariile de acceptanță (§25)

| Scenariu | Test | Rezultat |
|---|---|---|
| A. Import: duplicate, diacritice, coloane variate, rânduri invalide, mapare, preview fără scrieri, reimport idempotent, întrerupere și reluare, rollback controlat, XLSX cu formule și telefon numeric | M04-A, M04-A2, RV-08 | PASS_SIMULATED |
| B. Identitate: nume asemănătoare, filiale, pagină care nu e afacere; nimic unit automat; CUI-uri diferite niciodată unite; merge reversibil | M04-B, ID-15…19 | PASS_SIMULATED |
| C. Audit pe fixture-uri și surse contradictorii: dovezi cu selector, live refuzat, domenii reale refuzate, prompt injection fără efect | M04-C, AUD-01…09 | PASS_SIMULATED |
| D. Calificare: formulă explicabilă, necunoscute, override cu motiv și istoric | M04-D, Q-* | PASS_LOCAL |
| E. Propunere: fără preț inventat, preț configurat folosit exact, versiune nouă = aprobare invalidată | M04-E, RV-06 | PASS_SIMULATED |
| F. Contact: OUTREACH_DISABLED, transport fals, idempotență, dublu-clic, suppression, opoziție, reimport suprimat, follow-up fără mesaje | M04-F, M04-F2, RV-01/02/05/12 | PASS_SIMULATED |
| G. Hand-off: acceptare cu text exact → WON → misiune SPEC_DRAFT, fără grant și fără rulare; propunere nouă → hand-off depășit; idempotent | M04-G, RV-04, RV-10 | PASS_SIMULATED |
| H. UI/Lega: 3.700 de rânduri în tranșe, paginare și căutare, restart fără acțiuni automate, Lega doar rezumate, voce doar „nu contacta”, mobil 360/390 px | M04-H, M04-L, m04-browser | PASS_SIMULATED |
| Proveniență în timp: reverificare, înlocuire, contradicții, rollback | M04-P, RV-08 | PASS_LOCAL |
| Simulator: demo de Vânzări sintetic, idempotent, fără rulări | M04-S | PASS_SIMULATED |

## 4. Revizia adversarială și corecturile

Un agent separat, read-only, a încercat să încalce invariantele contractului. A găsit 15 probleme, fiecare reprodusă pe un Hub de test. Toate sunt reparate și acoperite de `m04-review-fixes`.

| # | Severitate | Problema | Test |
|---|---|---|---|
| 1 | HIGH | DO_NOT_CONTACT ocolit prin e-mail pe domeniul suprimat, URL de blog pe același domeniu sau reimport | RV-01, RV-02 |
| 2 | HIGH | Unirea de firme ocolea DO_NOT_CONTACT, în ambele sensuri | RV-03 |
| 3 | HIGH | WON fără contact real (ocol prin `ON_HOLD → IN_DISCUSSION`) | RV-04 |
| 4 | HIGH | Aceeași ciornă trimisă de două ori cu două chei de idempotență | RV-05 (plus index unic) |
| 5 | MEDIUM | Un audit terminat după DO_NOT_CONTACT îl suprascria | RV-07 |
| 6 | MEDIUM | Rollback-ul lucra după numele fișierului și atingea alt lot | RV-08 |
| 7 | MEDIUM | Rândurile unui lot anulat se mai puteau rezolva; suppression ignorată; CUI valid duplicat la „create” | RV-08, RV-09 |
| 8 | MEDIUM | Previzualizarea și rollback-ul blocau event loop-ul la volum mare | indexuri + preview async + tranșe de 500 |
| 9 | MEDIUM | Ciornă din propunere neaprobată sau înlocuită | RV-06 |
| 10 | LOW | Hand-off neidempotent (două misiuni) | RV-10 |
| 11 | LOW | Jurnalul comenzilor păstra e-mailuri și telefoane | RV-11 |
| 12 | LOW | Evenimentele ajungeau la ascultători înainte de COMMIT (problemă veche în bus, reparată în nucleu) | RV-11 |
| 13 | LOW | Follow-up-ul 201+ nu era găsit | RV-10 |
| 14 | LOW | Secțiuni de propunere goale sau cu placeholder-e acceptate | RV-06 |
| 15 | LOW | Reluarea follow-up-ului pentru WON/LOST, ridicare fără suprimare, contact inactiv la trimitere | RV-12 |

**Verificare prin mutație:** am scos pe rând patru corecturi (#1, #3, #4, #12). De fiecare dată testul corespunzător a picat. Fișierele au fost restaurate.

## 5. Probe locale în afara suitelor

| Probă | Rezultat |
|---|---|
| Migrarea 4 pe o copie a bazei live, cu `migration-on-copy.mjs` (backup API, doar citire) | 3 → 4, `integrity_check ok`, 0 încălcări FK, 20 de tabele noi, niciun tabel cu mai puține rânduri. Copia a fost ștearsă |
| Simulatorul (8012) cu acțiunea `sales` | 65 de firme create, 3 duplicate în fișier, 8 audituri fixture, o propunere în așteptarea reviziei |
| Capturi Playwright pe simulator (1280 px și 390 px, 8 ecrane) | Fără scroll orizontal pe niciun ecran |
| Reproducerile agentului de revizie, rulate din nou după corecturi | Toate refuzate sau corecte |

## 6. Ce nu a fost testat

- Nicio sursă live, niciun site real, niciun transport real (`NOT_RUN`, intenționat).
- Hub-ul live a rulat doar migrarea pe copie. Starea repornirii e în `M04_REPORT.md` §A.
- Nicio sesiune vocală nouă. Uneltele Lega de Vânzări au fost testate local, prin apeluri structurate.
