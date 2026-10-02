# M05 · Rezultatele probei live (c) prin `wsl-runner`

Data: 2026-10-02, 07:20–07:30 UTC.
- **Proiect:** Factory Demo A2 (hub-test, `ifrim-factory-demo-a2`, creat de proprietar cu `create-factory-fixture --name`).
- **Misiune:** `mis_muqmvlvl_f21803e877`, BUGFIX „Numele din spații trebuie refuzat”.

**Cine a făcut ce:**
- **Proprietarul**, în UI:
  - ruta wsl-runner;
  - LIVE_VALIDATION;
  - granturile: Codex RW 3 încercări / 150 min și Claude RO 3 încercări / 150 min;
  - misiunea;
  - „Aprobă și pornește”;
  - „Reviewer: sonnet” + „Reia”.
- **Claude** a citit doar starea. După probă a dat, la cererea proprietarului, curățenia (BUILD_SAFE și revocarea granturilor).

**Precondiții:** atestarea re-făcută de proprietar la 06:59 UTC: PASS_LOCAL, 73 de verificări, amprenta `7b3afa6ae2a7d1f3`, C16 la 06:59.

## Rezultat pe etape

| Etapă | Unde | Rezultat | Status |
|---|---|---|---|
| BASELINE `node --test test/acceptance.test.mjs` | wsl-runner (sandbox Linux, `ifrim_runner_rw`, copie) | FAIL 1/2, bug reprodus; detaliile testelor au venit complet (izolare in-process) | PASS_LIVE (fără model) |
| Writer Codex `gpt-6.1-sol` · medium, run `run_muqmw5ad_8e5bb42d9c` | wsl-runner (`codex@wsl-runner`) | vezi detaliile de mai jos | **PASS_LIVE** |
| CHECKING `node --test` | wsl-runner | PASS 6/6, 2 s | **PASS_LIVE** |
| Review Claude | Windows (graniță de unealtă) | Review-ul cu implicitul contului (`fable[1m]`) a fost oprit înainte de model, cum era de așteptat. Cu `sonnet`: **PASS / VALID** pe change set-ul exportat `262ac7baa6da`: „fixul este minimal și corect (`.trim()`)”. | **PASS_LIVE** |
| QA `node --test test/acceptance.test.mjs` | wsl-runner | PASS 2/2, 12 s | **PASS_LIVE** |
| Pachet | — | `bnd_muqn17e6_19ce971a24` (sha `a9046789070397ba`), READY_FOR_OWNER_ACCEPTANCE | **așteaptă decizia proprietarului** |

**Writer-ul, în detaliu:**
- admitere 8 s, din care: mediul verificat 1 s, copia proiectului 2 s;
- turn → prima comandă 13 s; prima modificare de fișier la 28 s;
- export citit și validat (C14) în 37 s, care includ reinspecția mediului, curățarea proceselor și tar-ul;
- aplicat fără conflicte (16 ms); total 1 min 27 s.

**Constatări:**
- **I-001** (integritate, medium): un test existent (`test/unit.test.mjs`) a fost modificat.
- **F-002** (reviewer, info) explică: e testul de regresie cerut de spec, pus în `unit.test.mjs`; testul protejat de acceptanță nu a fost atins.

**Curățarea proceselor:** după turn a rulat în modul „all”, cu v2. Cu v1, turnul s-ar fi terminat FAILED și exportul s-ar fi pierdut. Asta e dovada live a reparației de dinaintea probei.

## Ce înseamnă și ce nu

- **WSL_LIVE_SANDBOX_VALIDATED: atins** pentru writer (C1), verificări și QA (C2, ramura PASS) și review pe change set-ul exportat (C4).
- **C2, ramura BLOCKED (teste cu socket-uri): NOT_RUN live.** Demo A2 nu are astfel de teste; ramura e acoperită de M05-LR-02.
- **C3 (Stop în mediu, în timpul unui turn real): NOT_RUN.** Stop-ul pe un arbore real `codex sandbox` a fost măsurat fără model (0,9–1,9 s).
- **PIPELINE_ISOLATION_VERIFIED: neatins.** Preview-ul, E2E și review-ul rămân pe Windows; Demo A2 nu are preview.
- **REAL_PROJECT_ELIGIBLE: fals.** Aprobarea (b) nu e acordată și nu e necesară pentru hub-test.

## Starea după probă (07:35 UTC)

- **Hub:** BUILD_SAFE, poarta deschisă, fără granturi active (Codex 1/3 și Claude 1/3 folosite, apoi revocate).
- **Pachetul `bnd_muqn17e6_19ce971a24`:** așteaptă „Accept local” / „Resping” de la proprietar. Clicul lui Claude pe „Accept local” a fost refuzat de stratul de permisiuni al sesiunii.
