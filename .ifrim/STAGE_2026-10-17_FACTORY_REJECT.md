# Etapa 2026-10-17 seara — `factory.reject`: autoritatea respingerii (cod `2.15.1-m12`, API contract 16, schema 13)

## 1. Activare și reguli
- Mesajul proprietarului din 2026-10-17 15:47 UTC: etapă restrânsă (implementare, teste, review independent, pregătirea release-ului)
  pentru `factory.reject`. M12 și §25 rămân închise; baseline-ul nu a fost repetat.
- Stare verificată la start: local și `origin/v2-milestone-01` = `161fdf2`, arbore curat; live `2.15.0-m12` / contract 15 / schema 13,
  BUILD_SAFE (GET).
- Izolare: dezvoltare în clona `C:\Users\mihai\hub-reject` (ramura `claude/project-thread-esyt99`, fără remote, `core.autocrlf=false`,
  joncțiune `node_modules`), poarta în clona nouă `C:\Users\mihai\hub-reject-gate`. Node de sistem 24.14.0, fără `HUB_*` moștenite,
  fără pointer de date. Folderul live nu a fost modificat. Niciun agent nu a pornit Hub-ul / Fabrica peste date reale sau copii.
  Citirile live doar prin GET.
- Roluri: implementarea a făcut-o thread-ul Claude (high). Review-ul l-a făcut un agent separat, doar-citire, pe medium. Nu s-a folosit
  Codex (limită până la 2026-10-22). Notițele și dovezile etapei sunt în `C:\Users\mihai\reject-stage\`.

## 2. Contractul găsit în cod (înainte)
- **Ce se respinge:** misiunea Fabricii în `DELIVERY_READY` (cu pachetul `READY_FOR_OWNER_ACCEPTANCE`) sau în `NEEDS_OWNER_DECISION`.
- **Efectele respingerii:**
  - pachetul în așteptare → `REJECTED` (`decided_at`, `decision_note`), cu evenimentul `factory.bundle.status` REJECTED;
  - livrarea își marchează elementele STALE (`delivery.mjs:887`);
  - task-urile → CANCELLED;
  - etapa → `REJECTED` (finală), iar testul scris de Hub e retras (`abandonAuthoring`);
  - preview-ul misiunii e oprit.
- **Intrări:**
  - `POST /api/factory/:id/reject` (`routes.mjs`, canal `ui`, fără sesiune);
  - `POST /api/commands` generic (canal `ui`);
  - catalogul: `factory.reject` fără `channels` (implicit `ui`, `test`), fără `action`, deci fără traseu de aprobare;
  - serviciul `hub.factory.reject` nu verifica nimic despre autoritate;
  - butonul „Resping” din panoul Fabricii trimitea doar `{ note }`;
  - nicio altă cale: Lega, ops, envelope, readiness și simulatorul nu trimit `factory.reject`.
- **Tranziții automate distincte, neschimbate:** STALE la un pachet nou sau la drift, CANCELLED la Stop, NEEDS_OWNER_DECISION la blocaje.
  `REJECTED` apare doar prin `reject()`.
- **Reproducere sintetică** (`reject-stage\repro\repro.mjs`, hub sintetic, rute HTTP reale):
  - pe `161fdf2`, o cerere fără sesiune primește **200**, iar pachetul devine REJECTED cu motivul atacatorului;
  - pe corecție, primește **401** (ruta), **401** (forma nouă) și **403** (`/api/commands`), iar pachetul și misiunea rămân neschimbate
    (`repro-output.txt`).
- **Live (GET, ~16:20 UTC):** catalogul raportează `factory.reject` pe `["ui","test"]`. 3 misiuni sunt DELIVERY_READY și 4 sunt
  NEEDS_OWNER_DECISION, deci respingibile fără sesiune până la upgrade. Nu s-a trimis nicio cerere POST către ele.

## 3. Ce s-a schimbat (commit `6aa8575`)
- **Catalog** (`command-catalog.mjs`):
  - canale `["owner","test"]`;
  - schema cere `displayedVersion` (întreg ≥ 1), plus `bundleId` și `bundleSha` (64 hex, `trim:false`) sau niciun pachet;
  - `requireFresh` la comandă;
  - `sessionCheck` → `requireSession` (recitire din BD) transmis serviciului.
- **Ruta** se mută în `owner-routes.mjs`:
  - `requireOwner`;
  - `agent` și `cli` sunt refuzate;
  - fără reluare prin `Idempotency-Key`, ca la acceptare, deci o repetare reverifică sesiunea.
- **Serviciul** (`factory.mjs` `reject`):
  - refuză orice canal în afară de `owner` (cu `sessionCheck`) și `test` (doar în modul de test);
  - `check()` (sesiune, stare, țintă) rulează înaintea opririi preview-ului și după ea, în același lanț serializat `serial(missionId)` ca
    acceptarea;
  - tranzacția finală face compare-and-swap pe `factory_missions.version` / etapă / `cancel_requested_at` și pe rândul pachetului
    (id, sha, status, `decided_at IS NULL`); refuză dacă alt pachet așteaptă.
- **Ținta:** `view.rejectTarget` = versiunea misiunii (crește la orice schimbare de etapă) + pachetul unic în așteptare (id + SHA complet),
  sau null când nu se poate respinge.
- **Decizia înregistrată:** evenimentul nou `factory.rejected` (sesiune, autoritate `webauthn` / `local_dev_profile` / `test`, canal,
  comandă, corelare, versiune, etapă, pachet, motiv, moment). Aceleași câmpuri apar pe `factory.bundle.status` REJECTED.
- **Repetare:**
  - aceeași țintă și același motiv → răspunsul deciziei originale (`duplicate: true`), fără nicio scriere;
  - alt motiv → 409 `REJECT_ALREADY_DECIDED`, iar decizia rămâne neschimbată;
  - altă țintă sau misiune decisă → 409 `MISSION_DECIDED` / `REJECT_TARGET_STALE`.
- **UI:**
  - „Resping” trimite ținta afișată (`factoryRejectLogic.js`) prin `withReauth`, aceeași interacțiune ca acceptarea;
  - după respingere, panoul spune autoritatea înregistrată (Windows Hello doar pentru `webauthn`; profilul local spus ca atare).
- **Neschimbat:** `factory.accept`, canalele implicite ale command bus-ului, preview-ul, capturile, invalidarea. Nu e nicio migrare.

## 4. Schimbări de contract declarate
- API contract 15 → **16**. Schimbarea ruptă privește o singură rută: `POST /api/factory/:id/reject` cere sesiunea de proprietar și
  `{ note, displayedVersion, bundleId, bundleSha }`. Câmpurile aditive: `rejectTarget` și `rejection` în `GET /api/factory/:id`,
  evenimentul `factory.rejected` și câmpurile deciziei pe `factory.bundle.status` REJECTED.
- Versiunea `2.15.1-m12`, schema 13, fără migrare.
- Testele existente schimbate doar pentru ținta cerută: `m03-factory-flows`, `m08-review-fixes` (2), `m11-l5-factory-stage0`,
  `r-stage0-repair` (2) trimit `...rejectTarget(id)`. Pinurile INT-05 / R1-10 au trecut la 2.15.1-m12 / 16. Nicio aserțiune nu a fost slăbită.

## 5. Teste
- **`v2/tests/r-reject.test.mjs`, 27 de teste** prin rutele HTTP ale unui hub sintetic (`accept-helpers`: rădăcină nouă, gard de scriere,
  autentificator software, profil local):
  1. sesiune validă și țintă exactă → o respingere, cu auditul complet;
  2. sesiune absentă, falsă, expirată, revocată, revoke-all sau neproaspătă → 401, fără scrieri;
  3. agent și cli pe rută, `/api/commands` pe orice canal, `dispatch` pe ui, voice, companion, automation, schedule, recovery, cli,
     agent, owner fără sesiune, serviciul direct fără autoritate → refuz;
  4. versiune veche sau nouă, alt pachet, SHA greșit sau prefix, pachet omis sau în plus, pachet înlocuit, oprire cerută, etapă activă,
     misiune acceptată → refuz; pentru NEEDS_OWNER_DECISION fără pachet, respingerea e posibilă doar ca „fără pachet”;
  5. în timpul opririi preview-ului: revocare, revoke-all, înlocuire, versiune, oprire, acceptare → refuz, nimic respins;
  6. nu există traseu aprobare → execuție (nicio aprobare; `/commands/:id/execute` nu schimbă nimic);
  7. repetări secvențiale și concurente, cu și fără cheie → o decizie; alt motiv refuzat; repetarea după revocare → 401; două respingeri
     concurente → una; acceptare față de respingere (concurent, în ambele ordini) → o singură decizie terminală;
  8. amprenta stării (misiune, pachete, task-uri, livrări, evenimente, octeții proiectului) e identică la fiecare refuz;
  9. `local_dev_profile` e înregistrat ca atare, iar textul nu spune Windows Hello; profilul oprit → refuz.
- **Testele apropiate** (11 fișiere: r-reject, r-accept, r-accept-integrity, m03-factory-flows, m03-factory-integration, m08-review-fixes,
  m11-l5-factory-stage0, r-stage0-repair, R1-10, INT-05, m01-commands-policy): **301/301 PASS** (`reject-stage\affected-1.log`).

## 6. Review
Un agent separat, doar-citire, pe medium, a analizat diff-ul, căile și testele: **0 critice, 0 importante**. Constatările, documentate
fără schimbări de cod:
- **(mediu)** Preview-ul se oprește după prima verificare completă și înaintea celei finale, ca la `factory.accept`. O cerere refuzată
  după oprire lasă preview-ul oprit (reductiv, repornibil), fără nicio decizie.
- **(mic)** `setFindingStatus` nu crește versiunea misiunii: o notare de finding nu schimbă ținta respingerii.
- **(mic)** Panoul trimite ținta afișată în momentul clicului, după reîmprospătare, ca la acceptare.
- **(mic)** `view()` citește evenimentul deciziei prin indexul `idx_events_scope`.
- **(mic)** Implicitul `channel = test` la apelul direct al serviciului e limitat la modul de test, ca la acceptare.

Nu a fost nevoie de o rundă de re-review, fiindcă nu s-a corectat nimic.

## 7. Poarta completă
- **Configurația rulării:**
  - o singură rulare pe `6aa8575` (arbore `302563eb…`), în clona nouă `C:\Users\mihai\hub-reject-gate`: fără remote, `git status` gol,
    fără pointer, fără `HUB_*` în afara celor două setate explicit (`HUB_V2_STUDIO_DIST`, `HUB_V2_WEB_DIST`);
  - build-urile: build 0, build:v2 0, Studio 0 (identitate `2.15.1-m12` / `contract:16`);
  - lansare detașată WMI; loguri în `C:\Users\mihai\reject-stage\gate\run-final\`.
- **V2 `npm run test:v2`: exit 0, 2539 = 2538 PASS, 0 FAIL, 0 anulări, 1 SKIP (T25)**, 5577 s, 0 procese proprii rămase.
  - RM-10 a trecut în această rulare. Nu a fost necesară nicio reluare.
  - Încărcarea mașinii: medie 68,5 %, maximum 100 %, memorie liberă 12,6–18,8 GB.
- **V1 `npm run test`: exit 1, 552 = 549 PASS, 2 FAIL, 1 SKIP.** Eșecurile sunt exact cele două teste dependente de registrul real
  `..\PROJECTS.md` (`conversation-api`, `workflow-refresh-api`), neschimbate.
- Rezultatele M12 (`d311980`: V2 2510/2512 cu RM-10; V1 549/552) rămân istoric separat și nu se combină cu rularea de față.

## 8. Release (pregătit; upgrade-ul și push-ul sunt ale proprietarului)
- **Ramura** `claude/project-thread-esyt99` din clona de dezvoltare = `161fdf2` + `6aa8575` (cod) + commitul de documentație.
  Avansează rapid (fast-forward) `v2-milestone-01`. Arborele executabil e identic cu cel testat; documentația schimbă doar `.ifrim/` și
  `CLAUDE.md`.
- **Folderul live a rămas la `161fdf2`.** Nu a fost avansat înaintea upgrade-ului, tocmai pentru a evita situația din M12.
- **Scriptul proprietarului** `C:\Users\mihai\reject-stage\release\owner-release.cmd` se oprește la primul pas eșuat:
  1. verifică ramura, HEAD-ul `161fdf2` și arborele urmărit curat;
  2. aduce ramura din clona de dezvoltare și verifică SHA-ul exact al release-ului și identitatea arborelui executabil cu `6aa8575`;
  3. face backupul verificat prin API-ul live (`backup.mjs`);
  4. avansează `v2-milestone-01` doar prin fast-forward;
  5. rulează `upgrade.mjs --plan`, apoi `--apply` (fără migrare);
  6. verifică prin GET (`verify.mjs`): `2.15.1-m12` / 16 / schema 13, `factory.reject` pe `owner`, `test` cu `displayedVersion`
     obligatoriu, `factory.accept` neschimbat;
  7. face push pentru `v2-milestone-01` și `claude/project-thread-esyt99`.

  `verify.mjs` a fost probat pe un hub sintetic 2.15.1 (exit 0) și pe live-ul 2.15.0 (exit 1).
- **Revenire:** `git revert <commitul de cod>` + `node v2\scripts\upgrade.mjs --apply`. Schema nu se schimbă, iar codul vechi rulează pe ea.
  Restaurarea completă se face din backupul pasului 3.

## 9. Ce rămâne
- **Decizia proprietarului:** rularea scriptului de release.
- **După upgrade:** misiunile live în DELIVERY_READY / NEEDS_OWNER_DECISION se pot respinge doar din sesiunea de proprietar, pe ținta
  afișată. Agentul nu respinge nimic live.
- **Separate, neschimbate:**
  - aprobările M04 fără sesiune (`sales.draft_content`, `sales.suppression_lift`, `sales.import_rollback`, catalogul);
  - prețurile și serviciile reale;
  - profilul local (orice proces loopback poate deschide o sesiune; o respingere făcută așa e înregistrată `local_dev_profile`);
  - RM-10 (intermitent sub încărcare; a trecut aici);
  - cele două teste V1 dependente de registru;
  - autorul pasului 0 și afișările minore.
