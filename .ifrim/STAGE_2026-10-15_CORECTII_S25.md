# Etapa „Corecții §25 și repetiția nouă” (2026-10-15 06:31 → 21:15 UTC)

Promptul proprietarului: thread-ul „Corecții §25 și repetiția nouă”, 2026-10-15 06:31 UTC (R-CONTENT, R-BRIEF, R-CLEANUP, R-REGRESSION,
R-PARITY, o singură repetiție, integrare și release gestionat, un card §25). Regulă nouă: Opus la raționament maxim, cu ultracode
(workflow-uri de investigare, review adversarial și critic de completitudine).

**Rezultat pe scurt.** Codul 2.14.16-m11 (contract 13, schema 12, fără migrare) trece poarta finală și singura repetiție pe traseul
real (INTENTIONAL_STOP_BEFORE_WRITER, toate porțile pasului 0). E îmbinat în `v2-milestone-01` (`abc5a8d`); upgrade-ul gestionat și
push-ul le-a rulat proprietarul (20:20 UTC, `upg_mv9zgbrl`). Cardul §25, confirmat de proprietar la 20:43 UTC, a mers singur până la
livrarea READY verificată (20:51 UTC): pasul 0 din primul ciclu, codul, verificările, review-ul, QA, preview-ul, browserul, capturile,
clipurile și rezumatul. Defect găsit în livrare: rezumatul și textele tehnice din clip citează criteriile specificației vechi (§9).

## 1. Baseline (06:40–06:50 UTC)
- GitHub: `v2-milestone-01` = `fd14c0f`, `claude/project-thread-5c9bak` = `b111d1c` (verificat cu `git ls-remote`).
- Live: 2.14.10-m11, contract 13, schema 12 (`/api/diagnostics`), BUILD_SAFE, poarta deschisă; PID 22076 pornit 05:46:29Z de sarcina de
  logon după repornirea PC-ului de la 05:45:11Z (o pornire necontrolată în plus); 0 rulări, 0 lease-uri, 0 granturi.
- Clona `C:\Users\mihai\hub-rc` = `b111d1c`, curată. Cele 20 de fișiere ale proprietarului: neatinse.

## 2. Roluri
- Claude (această sesiune, Opus): coordonare, specificații, QA, repetiție, integrare.
- Codex (`codex exec`, gpt-6-astra, efort high, workspace-write) a implementat totul, în clone separate (hub-rc, hub-rc2, hub-rc3).
- Review independent: Claude în sesiuni separate (agenți doar-citire `ifrim-claude-code-reviewer`, Opus), cu fiecare constatare
  verificată de 2–3 sceptici, plus un critic de completitudine. Patru runde: A 8 constatări confirmate; B 20; finală 28; R3 15; R4 6.
  Toate reparate (sau eliminate odată cu codul retras), apoi încă o reparație măsurată (ceasul Windows, ±32 ms).
- Investigarea inițială: 6 agenți în paralel + critic (rapoarte în `C:\Users\mihai\s25-inputs\*.md`).

## 3. Cod (ramura `claude/project-thread-tjpzls` = `cc15765`, îmbinată în `abc5a8d`)
- **R-CONTENT / R-BRIEF (A):** scheletul validat de Hub și fragmentele F1–F5 (date după repornire filtrate la id-urile seed + recitirea
  primei programări după id; rândul istoric comparat imediat după FIECARE cerere; slots cu 13:00 liber ÎNAINTE de inserare; load() în
  test; nume fără coliziuni), generate din criteriile misiunii, doar pentru FEATURE + dataset + json-exposure; gate obligatoriu
  înaintea autorului: scheletul din brief-ul generat trece prin același lint (altfel pas 0 oprit cu tipul `brief`, fără model);
  probe de corecție separate (T-001, T-002) și precondiția T-003; `s25-calibrate`; dovada derivată `h2d-ebecb7bf6241`.
- **R-CLEANUP (B, redus la minim după review):** supervisor cu stare de închidere (nicio lansare după începutul close), oprire în
  paralel, taskkill /T fără pre-verificare WMI, fallback pe handle, supraviețuitori raportați după PID + CreationDate doar pe calea de
  eșec; runs close/drain cu refuz la recheck-ul dinaintea modelului (fără rânduri „running” orfane); hub.close idempotent, fiecare pas
  separat, erori agregate; închiderea de producție prinde eroarea, șterge fișierul pid și iese ca înainte; etapele tăiate de oprire nu
  se evaluează și nu consumă încercarea; lease-ul runner-ului eliberat; media/ops/livrări revenite la comportamentul b111d1c, cu un
  singur gard pentru callback-urile întârziate; captura se termină la final_hold verificat; raportarea separată a erorilor de cleanup în
  toate suitele (`NODE_TEST_CONTEXT`), eroarea originală păstrată.
- **Defect de producție reparat:** fallback-ul din registry pentru calea Codex CLI era mort (`HKCU\Environment` și regex-ul pierduseră
  backslash-urile).
- **R-PARITY (C, numai cod de test):** driverul real rulează dintr-un export exact într-o rădăcină dedicată, cu adaptorul Codex
  app-server, runner-ul codex sandbox și autorul Claude reale, planul prin envelope (sesiune de proprietar simulată, etichetată), oprire
  intenționată înaintea writer-ului, preflight fără model (P1–P12), dovezi complete.

## 4. Diagnosticul regresiei (R-REGRESSION)
- Mediul acum: CPU 54–100 %, principalul consumator WmiPrvSE (~2,6 nuclee), apoi Defender; IObit oprit și dezactivat. Afirmația
  „UninstallMonitor principal consumator” era o observație cu punct orb (Get-Process nu vede procesele SYSTEM/PPL).
- Pe `d096459` regresia a rulat suprapusă cu repetiția h2 (din aceeași clonă) — încetinire măsurată mediană 1,81x, ultimul decil 5,07x.
- Rulări țintite pe `b111d1c` (07:37–07:44Z): RM-10 3/3, OFF-06 (derivat + oficial), DP-07, DP-06, S0R-27 — toate PASS.
- Clasificare: r-turn = defect de cleanup demonstrat (reparat); RM-10 „255 vs 256 cadre” = defect de test demonstrat (sourceOut din
  durata sondată); RM-10 coada după end_hold = imprecizie de produs demonstrată sub sarcină (reparată: captura se oprește la end_hold);
  RM-10 latența holds, OFF-06, DP-06, DP-07, S0R-27 = limitare a mediului (încetinire 5–24x și suprapunere proprie), nedemonstrată
  individual; Office nu e lansat în modul de test. V1 din clonă: 2 eșecuri de locație (registrul de proiecte V1), trec din folderul Hub.

## 5. Poarta finală (pe `f454909`, 17:36–19:07 UTC, CPU mediană 60 %, p90 75 %)
| Comandă | Rezultat |
|---|---|
| `npm run build` | 0 |
| `npm run build:v2` | 0 |
| `npm run test:v2` | 2133 teste: 2132 PASS, 0 FAIL, 0 anulate, 1 SKIP (T25, privilegiu symlink) |
| `npm run test` (V1, folderul Hub) | 552 teste: 551 PASS, 0 FAIL, 1 SKIP (privilegiu symlink) |
| procese rămase / activitate după test | 0 / 0 |

## 6. Repetiția unică (19:20:13–19:25:57 UTC, `C:\Users\mihai\s25-real\rehearsal-r4`)
- Preflight-uri: `preflight-r4` oprit corect la verificarea exportului (fișierul de log al coordonatorului ajunsese în export; niciun
  model, nicio probă, niciun ACL); `preflight-r5` PREFLIGHT_ONLY_PASSED (runner sandbox real 108 s rece; ACL doar în rădăcina dedicată
  și pe `~/.claude`, `~/.openclaw`, aprobate de proprietar la 10:52:29Z).
- Configurație: autor Claude sonnet · medium · read-only, 64000, 45 min; verificator Codex gpt-6.1-sol · medium (app-server, read-only);
  maxAttemptsPerStage 1, reauthorMax 1, maxDurationMin 180 (valoarea planului live), runner 180 s; granturi din envelope (claude ro 5,
  codex ws 5); grant-uri de abonament (Codex prolite 29 % săptămânal; Claude 24 %).
- Rezultat: **INTENTIONAL_STOP_BEFORE_WRITER**, poarta repetiției `true`: lint valid; PROVEN în două rulări; review Codex PASS (0
  constatări); baseline normal; aplicația corectă trece; 41/41 surse defecte respinse prin ERR_ASSERTION; probele T-001/T-002 respinse;
  T-003 oprit la precondiție; nicio verificare pierdută; writer-ul nu a pornit (o singură atingere a limitei, niciun dispatch
  IMPLEMENTING); termenul de 45 min nu s-a declanșat; 0 reîncercări; procesele înregistrate oprite; binarul Codex neschimbat.
- **Limită a dovezii:** corpul candidatului este scheletul Hub-ului fără comentarii — autorul nu a adăugat verificări proprii;
  independența vine din review-ul Codex și din calibrarea deterministă. `stop_reason` lipsește pentru o parte din mesaje („nedemonstrat”).
  Procesele utilizatorilor CodexSandbox nu pot fi identificate fără elevare (înregistrat ca limitare).

## 7. Integrare, release, §25
- Îmbinare: `abc5a8d` (merge --no-ff) pe `v2-milestone-01`; arborele v2 = cel verificat + doar fixture-urile repetiției.
- Backup verificat înainte de schimbarea live: `bkp_mv9xo51k_96494a32dd` (2026-10-15 19:30:11Z).
- Upgrade-ul gestionat („[Production Deploy]”) și push-ul („Permission to use Bash with command … git push … has been denied.”) au
  fost refuzate agentului de stratul de permisiuni. Proprietarul le-a rulat la 20:20 UTC: `upg_mv9zgbrl` DONE (2.14.10 → 2.14.16,
  schema 12 → 12, integritate ok, numărătorile neschimbate). Verificat: `/api/health` 2.14.16-m11, contract 13, BUILD_SAFE, poarta
  deschisă, `boot_mv9zgg11_ebe5510cca`; origin `v2-milestone-01` = `6642a14`, `claude/project-thread-tjpzls` = `cc15765`.
- Cardul §25: §8. Părintele `dlv_mv1eo8oo_d120460140` rămâne STALE (legitim; acum îl înlocuiește livrarea READY din §8), iar
  aprobarea creativă a părintelui e neatinsă. M12 rămâne DRAFT.
- Revenire: `git revert -m 1 abc5a8d` + `node v2/scripts/upgrade.mjs --apply`, sau restaurarea backup-ului de mai sus.

## 8. Cardul §25 live (20:35–20:51 UTC)
- Locul: cerința se trimite din camera livrării-părinte (panoul „4 · Clipul”, caseta „Spune ce schimbi”, activă pentru READY / STALE /
  NEEDS_OWNER). Butonul roșu „Deschide livrarea care o înlocuiește” ducea la încercarea a patra, `dlv_mv49pm32_a9ef4ac194`, EXPIRED din
  2026-10-12 (afișare înșelătoare, §9). Înainte, citit doar din baza de date: 0 plicuri și 0 planuri deschise.
- 20:43:02 UTC: proprietarul a trimis cerința salvată (revizia `drv_mva09tik_52bbb6a3e5`, ROUTED_SOFTWARE; textul are în plus „”.” la
  final, fără efect asupra criteriilor). 20:43:12 UTC: a confirmat cardul — plicul `env_mva09x4g_5e4b294b66` (sesiunea de proprietar
  `osn_mv9zy3yk_21177dac68`, click), misiunea `mis_mva09tjh_7692421b52` (FEATURE, BALANCED, termen 23:43 UTC), livrarea-copil
  `dlv_mva09x21_b0b0cbfb2a`. Specificația v1 APPROVED: aceleași 5 criterii de test ca în repetiție (AC-1…AC-5, `json-exposure`, date
  martor booking-demo), preview AC-6, browser AC-7…AC-10, review AC-11.

| Pas | Rulare / dovadă | Rezultat |
|---|---|---|
| Autor pasul 0 (Claude sonnet · medium · doar citire) | `run_mva0a193_bd89a8a912`, 92 s | candidat c0 `9966a943…`, harness 2 |
| Dovada Hub (codex-sandbox, de două ori) | `evd_mva0c3nd`, `evd_mva0c4uu` | PROVEN: 6 teste, 3 controale PASS, 3 verificări de confidențialitate FAIL, identic |
| Verificarea testului (Codex gpt-6.1-sol · medium · doar citire) | `run_mva0c4w9_8070f356c2`, 18 s | PASS, 0 lipsuri (`rev_mva0ciik_2392da1875`) |
| Baseline | `evd_mva0cjz5_06daa40046` | FAIL cu aceeași semnătură (normal) |
| Protejare și retragerea testului istoric | `.ifrim-hub/retired/mis_mva09tjh_7692421b52/journal.json` | `butonul-de-programare-trebuie-sa-84f571.test.mjs` mutat neschimbat (sha256 `8d944644…`), MOVED |
| Writer (Codex gpt-6.1-sol · medium · workspace-write) | `run_mva0cjzv_60f06cef9b`, 103 s | `src/server-app.js`, `README.md`; integritate 0 constatări |
| Verificări (`node --test`) | `evd_mva0eudn_eca68b93ff` | 21/21 PASS |
| Review independent (Claude sonnet · medium · doar citire) | `run_mva0eue4_2ea3e7bdae`, 102 s | PASS, 3 note informative (`rev_mva0h1gj_537e5528e7`) |
| QA: testul de acceptanță | `evd_mva0h3vg_a79dbfa279` | 6/6 PASS |
| Preview | `evd_mva0h5je_b2c4c5b12c` | HTTP 200 pe 127.0.0.1:4620 |
| Browser AC-7…AC-10 (Playwright) | `evd_mva0h6ko`, `evd_mva0h7ek`, `evd_mva0h9jk`, `evd_mva0hc1f` | 4/4 PASS |
| Pachet | `bnd_mva0hc23_b3d65a8da9` | DELIVERY_READY 20:48:53, READY_FOR_OWNER_ACCEPTANCE |
| Livrarea (13 pași, fără model) | `opp_mva0hc8d_ee831d8b7c` | DONE 20:51:10; livrarea READY, verificată (snapshot `696cb23e…` așteptat = actual, 0 fișiere schimbate) |

- Exporturi: `C:\Users\mihai\Videos\Ifrim Studio\Exporturi\demo-programari-demo-livrare-detailing-programari-20261015\` — clipurile
  16:9 și 9:16 (0:39), rezumatul v1 (md, html), „Prezentare demo” (docx APP_VERIFIED în Word 16.0, pdf), Excelul refolosit cu dovadă
  sha256 (din `dlv_mv16dsp8_491116ae10`), campania, manifestul.
- QA media: 16:9 WARN (tehnic: 8 segmente de imagine înghețată nejustificate de pauzele capturii; drepturi: platformă nespecificată),
  9:16 WARN (tehnic: 5 segmente); layout, editorial, lizibilitate și factual PASS. Aprobarea creativă: PENDING (a proprietarului).
- Candidatul live este exact scheletul Hub-ului (150 de linii fără comentarii și rânduri goale: 0 adăugate, 0 eliminate). Ca în
  repetiție, autorul nu a adăugat verificări proprii.
- După livrare: 0 lease-uri active, 0 erori în jurnalul Hub-ului, același boot. ACL pe `~/.claude` și `~/.openclaw`: DENY (R) + DENY
  moștenibil pentru CodexSandboxUsers, conform aprobării de la 10:52:29 UTC.

## 9. Defect găsit în livrare: citările criteriilor (deschis)
- Rezumatul (secțiunile „Ce demonstrăm” și „Ce beneficii putem afirma”) și textele tehnice din clip vin din blocul de livrare al
  fixture-ului (`v2/server/factory/booking-demo-def.mjs:94-113`), condiționat de id-uri de criterii scrise pentru specificația inițială
  (AC-1 ore ocupate pe telefon, AC-3 oră ocupată refuzată, AC-4 review). Specificația §25 își renumerotează criteriile (AC-1 lista publică
  fără telefon, AC-3 telefon obligatoriu, AC-4 telefon salvat exact, AC-11 review). Toate trec, deci textele apar, dar citează dovezi
  greșite: „Corectura a fost verificată de un reviewer independent. (verificat: AC-4)”; clipul afișează „AC-1 + AC-6: interval ocupat →
  indisponibil (390 px)”. Afirmațiile despre programare sunt adevărate (le acoperă AC-7 și AC-8), trimiterile nu; „Problema” descrie
  povestea veche, iar schimbarea de confidențialitate lipsește din narațiune. QA factual trece pentru că verifică doar existența id-urilor.
  Documentul Word/PDF și campania listează corect criteriile noi.
- Consecință: rezumatul și clipul acestei livrări nu se aprobă înainte de reparație; software-ul nu e afectat.
- Direcția reparației (decizia proprietarului): la o livrare de reîmprospătare cu specificație schimbată, textele condiționate se
  mapează după sensul criteriului (sau se regenerează din specificația livrării), iar QA factual refuză o citare al cărei criteriu și-a
  schimbat textul față de specificația de referință a fixture-ului.
- Minor: linkul „Deschide livrarea care o înlocuiește” arată cel mai nou copil chiar dacă e expirat; AC-7 și AC-8 repetă propoziția
  „câmpul „Telefon” are etichetă și se completează”.

## 10. Raport final

**CONFIRMAT ÎN COD**
- 2.14.16-m11 pe `v2-milestone-01` (`abc5a8d`): scheletul și fragmentele derivate din criterii, gate-ul de lint dinaintea autorului,
  probele de corecție, `s25-calibrate` (partea A); R-CLEANUP minim (B); fallback-ul din registry pentru Codex CLI; driverul R-PARITY
  (C) — §3.
- Cauza defectului din §9: blocul de livrare al fixture-ului, condiționat de id-uri fixe (`v2/server/factory/booking-demo-def.mjs:94-113`;
  regula de condiționare în `v2/server/delivery/template.mjs:86-110`).

**TESTAT IZOLAT**
- Poarta finală pe `f454909` (§5) și repetiția unică pe traseul real (§6).
- Calibrarea candidatului live `9966a943…` (`s25-calibrate`, fără model, 21:01 UTC): lint ok, PROVEN, aplicația corectă 6/6,
  originalul respins de două ori (3/6), 41/41 surse defecte respinse prin aserțiuni, probele T-001 și T-002 respinse, T-003 oprit la
  precondiție, curățenie completă, procese dispărute. Dovada: `C:\Users\mihai\s25-inputs\calib-live-9966a943.json` (sha256 `fd05e314…`).

**VERIFICAT LIVE**
- 2.14.16-m11 după upgrade-ul gestionat rulat de proprietar (§7).
- Cardul §25 de la confirmare până la livrarea READY verificată (§8): pasul 0 din primul ciclu, verificări 21/21, testul de acceptanță
  6/6, browser 4/4, review PASS, pachetul și exporturile; testul istoric retras neschimbat; părintele STALE neatins; 0 lease-uri active;
  0 erori în jurnal.

**NEVERIFICAT**
- Calitatea creativă a clipurilor și a rezumatului (QA WARN) și acceptarea locală a software-ului: decizii ale proprietarului.
- Citările din rezumat și din clip: constatate greșite (§9), nereparate.
- Procesele utilizatorilor CodexSandbox: neidentificabile fără elevare (limitare).
- O contribuție proprie a autorului pasului 0: nu există; testul e scheletul Hub-ului (§8), iar puterea lui vine din schelet și din
  review-ul Codex.
