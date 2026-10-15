# Etapa „Corecții §25 și repetiția nouă” (2026-10-15 06:31 → 19:45 UTC)

Promptul proprietarului: thread-ul „Corecții §25 și repetiția nouă”, 2026-10-15 06:31 UTC (R-CONTENT, R-BRIEF, R-CLEANUP, R-REGRESSION,
R-PARITY, o singură repetiție, integrare și release gestionat, un card §25). Regulă nouă: Opus la raționament maxim, cu ultracode
(workflow-uri de investigare, review adversarial și critic de completitudine).

**Rezultat pe scurt.** Codul 2.14.16-m11 (contract 13, schema 12, fără migrare) trece poarta finală și singura repetiție pe traseul
real (INTENTIONAL_STOP_BEFORE_WRITER, toate porțile pasului 0). E îmbinat în `v2-milestone-01` (`abc5a8d`). Upgrade-ul live și
push-ul au fost refuzate de stratul de permisiuni; le rulează proprietarul. Cardul §25 se pregătește după upgrade.

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
- **Upgrade-ul gestionat a fost refuzat de stratul de permisiuni („[Production Deploy]”)** — îl rulează proprietarul. Până atunci
  live rămâne 2.14.10-m11; atenție: o repornire a PC-ului ar porni 2.14.16 din working tree fără upgrade-ul gestionat (fără migrare).
- **Push refuzat** („Permission to use Bash with command … git push … has been denied.”) — îl rulează proprietarul.
- Cardul §25: se pregătește după upgrade, din cerința salvată. Părintele `dlv_mv1eo8oo_d120460140` rămâne STALE; testele istorice și
  aprobarea creativă sunt neatinse. M12 rămâne DRAFT.
- Revenire: `git revert -m 1 abc5a8d` + `node v2/scripts/upgrade.mjs --apply`, sau restaurarea backup-ului de mai sus.
