# Etapa „Închiderea verificabilă a corecțiilor M11” (2026-10-10, cod `2.14.7-m11`)

Prompt al proprietarului din 2026-10-10 15:18 UTC (thread „Închidere verificabilă corecții M11”). Nu începe M12; nu reia reparațiile
media, Lega sau Office deja demonstrate. Continuă `.ifrim/STAGE_2026-10-10_CORECTII_M11.md`.

## Baseline (verificat la 15:25 UTC)

| Element | Valoare | Sursă |
|---|---|---|
| HEAD / remote | `27e6dd2` = `origin/v2-milestone-01` | VERIFICAT ACUM (`git fetch`) |
| Live | **`2.14.6-m11`** (contract 13, BUILD_SAFE, poarta deschisă, boot 13:55:46 UTC) — promptul spunea 2.14.5, depășit | VERIFICAT ACUM LIVE (`/api/health`) |
| Modificări necomise ale proprietarului | 20 fișiere, **octet cu octet identice cu blob-urile din HEAD** (hash comparat), apar „M” doar din `core.autocrlf=true` | VERIFICAT ACUM; neatinse |
| §25 | proiectul `prj_muz7pfsl_fa3678479c` („Demo Livrare — Detailing (programări)”, `source = hub-test`); livrarea `dlv_mv1eo8oo_d120460140` READY; nicio revizie de confidențialitate, card sau plan în așteptare | VERIFICAT ACUM (citire SQLite) |

## R-HIST — testele Hub istorice

- `factory.mjs historicHubTests`: la pornire, testele scrise și protejate de pasul 0 al ALTOR misiuni aprobate ale proiectului (încă
  active, cu octeții de atunci) și toate testele retrase de misiunile proiectului sunt fixate în `protected_json.historic`
  (întotdeauna, și gol). Un test istoric care nu mai are octeții protejați oprește pornirea (`HISTORIC_DRIFT`).
- `integrity.mjs`: `historic_test_changed` (modificat / șters / înlocuit), `retired_test_changed` (copia păstrată), `retired_test_recreated`
  (aceeași cale sau aceiași octeți sub alt nume, și în snapshot-urile git) — toate **critical** → misiunea se oprește înaintea verificărilor.
- `historicViolations` (pe disc, determinist): reverificat înainte de pachet (`buildBundle` → NEEDS_OWNER_DECISION) și la acceptare.
- Retragerea făcută de Hub se face înaintea snapshot-ului de bază, deci nu apare ca modificare (R-HIST-03).
- O misiune pornită înainte de 2.14.7 nu are înregistrarea: nimic nu se derivă retroactiv, pachetul o spune la „Limitări”.

## R-SUP — proveniență și contract

- `factory/supersede.mjs` (nou, funcții pure + citirea clientului public): o retragere cere `contract` = cazurile testului vechi:
  conflictul doar când un assert citește câmpul dintr-un GET **anonim** pe o rută pe care o citește pagina publică a proiectului
  (`public/`); un GET cu credențiale, cu opțiuni printr-o variabilă, prin helper-ul fișierului care adaugă credențiale, sau pe o rută
  necitită de pagina publică NU e conflict (citire internă compatibilă); fiecare alt caz trebuie acoperit de o verificare nouă de același tip.
- `spec.mjs`: `supersedes[]` cere `missionId`, `specVersion` și `contract`; `replacedBy` = exact public_omits + anon_params +
  internal_persistence, `coveredBy` = același tip (`acceptance[].kind`, în specificația hash-uită). Contractul e în `specSha` → în scope.
- `factory.mjs verifySupersedes` (server, înaintea mutării): același proiect, misiunea originală și versiunea, aprobată, pasul ei 0 a
  protejat exact calea și sha-ul, fișierul are acei octeți, iar contractul încă descrie fișierul și clientul public de azi (`contractDrift`).
- Planificatorul (`engineering.mjs`): euristica doar propune; fără contract testul rămâne activ și cardul spune de ce.
- Proba pe proiectul real (doar citire, 2026-10-10 16:0x UTC): fraza autorizată produce o singură retragere, cu contractul
  AC-2 (citea `phone` din `/api/bookings`) → AC-1, AC-2, AC-4; AC-1 (refuz) → AC-3; AC-3 (control) → AC-5; zero probleme; proiectul neatins.

## R-ROLL — mutări parțiale și recuperare

- Toată lista e verificată înaintea primei mutări; jurnal `.ifrim-hub/retired/<misiune>/journal.json` (MOVING → MOVED; RESTORED /
  RESTORE_INCOMPLETE), înlocuit atomic; copierea prin nume temporar verificat, apoi rename; trei stări per fișier (nemutat, ambele, mutat).
- `startApproved`: mutarea, snapshot-ul și înregistrarea pornirii în același `try`; la eșec, restaurarea pornește din specificația
  confirmată (nu din ce a întors apelul eșuat) și e VERIFICATĂ; restaurare incompletă → `RETIRE_RESTORE_INCOMPLETE`, pornirea se oprește.
- `recover()` la boot: o pornire moartă după mutare și înaintea înregistrării (spec neaprobat) → testele se pun înapoi, verificat.
- `restoreRetired` nu șterge niciodată un fișier străin de la calea retrasă (doar copia cu octeții confirmați).

## R-PACK — pachet autonom

- `delivery.package.index`: registrul refolosit prin dovadă e copiat (aceiași octeți, fără regenerare) în dosarul nou; manifestul îl
  listează local, cu sha256, `source` (livrarea și fișierul original) și motivul; `verifyPackageFolder` verifică dosarul singur (inclusiv
  fișiere nelistate, trimiteri în afara dosarului). Reluarea folosește copia locală dacă sursa a dispărut. Pachetul vechi rămâne neatins.

## U06-BL-06 (diagnostic, fără modificare de cod)

Vezi raportul din thread. Concluzie: test sensibil la încărcare, nu blocaj; durata urmărește încărcarea (alt test din același fișier,
fără așteptarea respectivă, a avut aceeași încetinire în rularea eșuată).

## Teste, review, release, §25

- `v2/tests/r-closure.test.mjs`: 24/24 (SUP-01…06, HIST-01, ROLL-01…03, FAC-01…07, PACK-01…03, REV-01/02/03/05); împreună cu
  `r-priv-rev.test.mjs` 35/35. RP-05 ajustat pentru schimbarea de contract (intrarea de dinainte rămâne cazul negativ); INT-05 versiunea.
- Mutații (o protecție scoasă pe rând, fișierul restaurat): 10/10 prinse (M1 HIST-01, M2 FAC-01, M3 FAC-02, M4 PACK-01, M5 SUP-04/REV-02,
  M7 ROLL-01, M8 REV-03, M9 REV-01, M10 REV-05, M11 FAC-07).
- Review independent (sesiune separată, doar citire): NU BLOCHEAZĂ; 6 constatări „should-fix” + 5 nituri, reparate (REV-01…05; #4 și #6
  prin înregistrarea istorică mereu salvată și sha-ul conținutului pentru snapshot-urile git).
- Regresia completă pe codul final (build + `npm run test:v2`, 16:25 → 18:22 UTC, CPU 100 % aproape tot timpul, eșantionat la 5 s):
  1757 teste, 1753 PASS, 1 SKIP (T25), 3 FAIL: D4-02 (timeout 121 s; trece singur), RM-10 (pauze de captură peste plafonul de latență cu
  CPU 100 %; pică și la reluare cât timp CPU-ul rămâne la 100 %), OFF-06 (DISK_RESERVE: C: are 14,7 GiB liberi < rezerva de 15 GiB).
  U06-BL-06 a trecut (24,9 s). Regresia NU e verde; niciun eșec nu e în codul etapei.
- Commit `8b2a76b`; push refuzat agentului de stratul de permisiuni al sesiunii; upgrade `upg_mv2qfbs5` (2.14.6 → 2.14.7, fără migrare,
  verificat: versiune, contract, numărători); backup verificat după upgrade (integrity ok, sha în manifest).
- §25: cardul `env_mv2ql6ls_9f08b50ab6` (PROPOSED, de confirmat până la 2026-10-11 18:37 UTC), misiunea `mis_mv2ql0fp_ee35f8071e`
  (spec v1 fără probleme, `supersedes` cu contractul de mai sus, criterii cu tip), livrarea-copil `dlv_mv2ql6ie_75da58271a` (refresh,
  Word + campanie, Excel refolosit prin dovadă). READY_TO_CONFIRM; nimic nu a rulat.
