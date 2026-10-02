# M05 · Planul probelor live prin `wsl-runner` (aprobarea (c))

Data: 2026-10-02. **Nimic de aici nu a rulat.** Fiecare pachet cere aprobarea ta separată, pentru textul exact, și clicurile tale în UI: start, Reia, aprobări, acceptare. Ordinea e propunerea mea; o poți schimba.

## Starea la 2026-10-02 ~04:00 UTC

- **Făcut:**
  - ai repornit Hub-ul pe `2.6.0-m05` (02:08 UTC), cu migrarea 5;
  - atestarea din Hub a dat PASS_LOCAL (02:13 UTC);
  - un review doar-citire înainte de probă a găsit defecte care ar fi irosit proba, iar eu le-am reparat (`M05_TEST_REPORT.md`, „Verificări înainte de proba live”).
- **Atestarea de la 02:13 nu mai e validă:** canary-ul include acum verificarea reală a curățării (C15r/C15s), deci versiunea lui s-a schimbat.
- **Hub-ul rulează codul cu reparații:** repornit la ~03:50 UTC, pid 32192, BUILD_SAFE.
- **Proba nu a rulat.** Stratul de permisiuni al sesiunii a refuzat continuarea pe Hub-ul live (motiv „Production Deploy”).

## Precondiții, toate fără model, în ordine

1. **Sistem → Medii de execuție:**
   - „Inspectează”;
   - „Verifică contul prin mediu (C16)”;
   - „Rulează atestarea C1–C17”.

   Rezultatul trebuie să fie PASS_LOCAL, cu C15r și C15s PASS, pe amprenta `7b3afa6ae2a7d1f3`.
2. **Integrări → Claude Code → „Verifică contul”.** Review-ul cere o verificare mai nouă de 24 h în momentul REVIEWING.
3. **Un proiect hub-test NOU, nu Demo A.** Demo A conține deja reparația acceptată, deci baseline-ul ar trece și misiunea s-ar opri înainte de writer.
   1. Cu Hub-ul pornit, din folderul Hub-ului, creezi și înregistrezi proiectul dintr-o comandă: `node v2/scripts/create-factory-fixture.mjs bug-demo --dir ifrim-factory-demo-a2 --name "Factory Demo A2"`. Opțiunea `--name` e nouă; numele implicit ar da slug-ul `factory-demo-a-bug`, care e deja ocupat.
   2. Verifici că `node --test test/acceptance.test.mjs` eșuează în `ifrim-factory-demo-a2` cu „nume obligatoriu”.
4. **Ruta.** Sistem → Medii → „Ruta Codex pe proiect”: pui Demo A2 pe **wsl-runner** înainte de aprobarea scope-ului și nu o schimbi până la decizia pe pachet.
5. **Validarea live.** Integrări → Validare live:
   - tastezi `LIVE_VALIDATION` și activezi modul; poarta e `open`;
   - creezi două granturi, ambele pe proiectul **Factory Demo A2** (implicit formularul arată Hub-ul):
     - Codex · scriere în workspace · 3 încercări · valabil 150 min;
     - Claude Code · doar citire · 3 încercări · valabil 150 min.
6. **Misiunea.** Missions → „Lucrare de engineering” → BUGFIX, cu spec-ul demo: criteriu `test/acceptance.test.mjs`, comenzi `node --test`.
   - Modelul writer-ului și reviewer-ul nu se aleg din UI. Cât misiunea e în SPEC_DRAFT, le pui prin `POST /api/factory/<id>/limits` cu `{"limits":{"writerModel":"gpt-6.1-sol","writerEffort":"medium","reviewerModel":"sonnet","maxDurationMin":60}}`. Altfel alegi „Reviewer: sonnet” la primul „Reia”.
   - Înainte de „Cere aprobarea scope-ului”, verifici în „Unde rulează” că Writer, Verificări și QA sunt în wsl-runner.
7. **Aprobări în timpul turnului:** pe ruta de mediu sunt refuzate automat. Dacă apare totuși o cerere, o respingi.

Aprobarea (b) **nu e necesară** pentru probele pe proiecte hub-test.

## Pachetul C1 · Writer Codex RW prin `wsl-runner`, cu export C14

| Element | Valoare propusă |
|---|---|
| Proiect | hub-test nou pe ruta `wsl-runner` (Factory Demo A2; **nu** Demo A, care e deja reparat) |
| Mediu | `ifrim-runner`, amprenta afișată la atestare |
| Provider / model / efort | Codex `gpt-6.1-sol` · `medium` (din `model/list` prin mediu) |
| Acces | workspace-write, profil `ifrim_runner_rw` |
| Grant | Codex RW, 3 încercări, valabil 150 min (durata pe execuție nu e o limită reală a grantului) |
| Durată misiune | 60 min |
| Date | doar fișierele proiectului de test (copiate în mediu) |

**Oprire:** Stop din UI oricând; mediul refuză sau amprenta se schimbă → oprire fără trecere pe Windows.

**Dovezi:**
- fazele `environment_checked`, `workspace_prepared`, `turn_sent`, `export_validated`, `export_applied`;
- raportul C14;
- change set-ul;
- 0 procese rămase.

**Curățenie:** grant revocat sau epuizat; BUILD_SAFE.

## Pachetul C2 · Verificări și QA în mediu

Pe aceeași misiune: CHECKING și QA rulează prin `codex-sandbox@wsl-runner`.

**Așteptat:**
- PASS pentru testele unitare fără socket-uri;
- BLOCKED, cu motivul afișat, pentru testele care pornesc servere.

Preview-ul și E2E-ul rulează pe Windows. Proiectul e de test, deci fără acceptare R2.

## Pachetul C3 · Stop în mediu

1. **Stop în timpul turnului:** la ~20 s după `turn_acknowledged`, pe o cerere lungă, doar-citire.
2. **Stop în timpul unei comenzi QA:** pe o misiune cu un test lent.

**Dovezi:**
- `CANCEL_REQUESTED` → `CANCEL_CONFIRMED`, cu timpul fiecărei faze;
- 0 procese în workspace (reaper);
- workspace eliberat;
- export neaplicat.

**Grant:** Codex read-only, 1 încercare, 10 min, valabil 30 min.

## Pachetul C4 · Review pe snapshot-ul exact

Review-ul Claude rămâne pe Windows, la nivel de unealtă. Proba confirmă doar că pachetul se leagă de change set-ul exportat și validat. **Nu este o probă de izolare a review-ului.**

**Grant:** Claude read-only, 2 încercări, `sonnet`.

## Ce NU include (c)

- instalarea Chromium Linux sau a Claude Linux;
- schimbarea profilurilor;
- `.wslconfig`, adică (d);
- proiecte reale;
- ProDelivery;
- misiunea AROBS.
