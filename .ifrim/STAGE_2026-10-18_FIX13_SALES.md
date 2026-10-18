# Etapa 2026-10-18 — 13 defecte verificate + deciziile Sales legate de sesiunea proprietarului (cod `2.15.2-m12`, API contract 17, schema 13)

## 1. Activare și reguli
- Mesajul proprietarului „Da porneste” (2026-10-17 23:37 UTC) aprobă etapa scurtă propusă de coordonator în chat-ul proiectului: cele 13
  defecte verificate (înghețarea conversației B2 prima), fiecare cu testul ei de regresie, și în aceeași etapă cele 4 aprobări Sales legate
  de sesiunea proprietarului, cu poarta completă o singură dată, la final.
- Stare verificată la start: local și `origin/v2-milestone-01` = `3d9b3e8`, arbore curat; live `2.15.1-m12` / contract 16 / schema 13,
  BUILD_SAFE, 0 aprobări în așteptare (GET). Catalogul live raporta `sales.import.rollback`, `sales.suppression.lift`,
  `sales.draft.approve_content` și `sales.service.save` pe `["ui","test"]` (defectul).
- Izolare: dezvoltare în clona `C:\Users\mihai\hub-fix` (ramura `claude/project-thread-pcocmw`, fără remote, `core.autocrlf=false`,
  joncțiune `node_modules`); verificarea pe codul vechi în `C:\Users\mihai\hub-fix-base` (3d9b3e8); poarta în clona nouă
  `C:\Users\mihai\hub-fix-gate`. Node de sistem 24.14.0, fără `HUB_*` moștenite, fără pointer de date. Folderul live nu a fost modificat.
  Niciun agent nu a pornit Hub-ul peste date reale sau copii; citirile live doar prin GET. Dovezile: `C:\Users\mihai\fix-stage\`.
- Roluri: implementarea a făcut-o thread-ul Claude (high). Review-ul independent l-a făcut un agent separat, doar-citire, pe medium.
  Fără Codex (limită până la 2026-10-22).

## 2. Cele 13 defecte (liniile la 3d9b3e8) și reparația
| # | Defect | Reparație |
|---|---|---|
| B2 | `markdown.js:35/56`: „```js title” (fence cu text după limbaj) → buclă infinită, tab-ul conversației îngheța la fiecare deschidere | fence-ul acceptă orice info string (limbajul = primul cuvânt); paragraful consumă mereu cel puțin o linie, deci orice intrare se termină |
| B9 | `uiLogic.js:449-464`: id-urile AC-n pe poziție; după ștergerea unei linii, pașii E2E / eșecul așteptat treceau la criteriul următor | editorul scrie „AC-n: text \| verificare \| cale”; o linie își păstrează id-ul, o linie nouă primește un id nefolosit de nimeni (cel mult AC-999) |
| B22 | `uiLogic.js`: „\|” în textul criteriului îl rupea | verificarea și calea se citesc de la capătul liniei; tipul scris ultimul câștigă |
| A16 | `review.mjs:69`: un review PASS care citează cod cu ``` era citit INCONCLUSIVE | blocul ```json de la început de linie, închis de un fence pe linie proprie; niciodată un bloc anterior în locul unui ultim bloc stricat; același cititor și pentru review-ul testului de la pasul 0 |
| A26 | `redact.mjs:16`: secret între ghilimele cu spații neascuns | valoarea între ghilimele (cu spații și ghilimele escapate) e ascunsă întreagă; ghilimelele rămân (JSON-ul rămâne JSON) |
| A27 | `redact.mjs:26`: secrete în liste sub o cheie sensibilă | într-o listă sub o cheie sensibilă toate valorile sunt ascunse; un obiect direct sub cheie e judecat după cheile lui |
| A36 | `intake.mjs:1128` + `intents.mjs:2359`: autonomia pe proiectul deschis în locul celui numit (nume negăsit) | autonomia, înghețarea și dezghețarea acționează doar pe proiectul numit, pe cel deschis doar când nu s-a numit niciunul („proiectul acesta”, „aici” = cel deschis) |
| A35 + A3 | `intake.mjs:1124-1125,1585`: nume necunoscut / ambiguu → acțiunea pe proiectul deschis, întrebarea după; „nu dezgheța X”, „Dezgheață X?”, „Dacă…, dezgheață X” dezghețau | nimic nu se îngheață / dezgheață până nu e clar proiectul (întrebarea vine înainte); dezghețarea rulează doar ca imperativ clar (întrebare, condiție, negație, relatare, mențiune → răspuns, nimic dezghețat); regula Lega de a nu corecta niciodată spre stop / confirmare / negație / publicare neatinsă (tabel separat `MOOD_FORMS`) |
| A12 | `backups.mjs:31-41`: un backup eșuat rămânea „running” | orice pas care aruncă eroare încheie backup-ul `failed`, cu motivul și evenimentul `backup.failed` |
| A10 | `registry.mjs:65`: un fișier ilizibil (EBUSY) strica toată căutarea | fișierul e sărit și numărat |
| A38 | `handoff.mjs:152`: rezultatele testelor din toate proiectele | doar ale proiectului (apelurile `process.test` / `process.build` își înregistrează `projectId`); la fel la checkpoint (`checkpoints.mjs:60`, aceeași cauză) |
| B42 | `FocusScreen.jsx:139/179`: „Reîncearcă” pierdea task-ul și efortul | reîncercarea trimite exact provider, acces, model, efort și task-ul execuției reluate (`retryRunBody`) |
| B39 | `Missions.jsx:125`: nota de verificare scrisă la task-ul A se putea salva pe B | panoul de acțiuni e cheiat după task (`key={task.id}`) |

## 3. Deciziile Sales legate de sesiunea proprietarului
- `sales.draft.approve_content`, `sales.suppression.lift`, `sales.import.rollback` devin decizii rezervate ale proprietarului, ca
  `sales.proposal.approve` (M12):
  - canalele `owner` / `test` (testul doar în modul de test); cererea pe ruta proprietarului (401 fără sesiune; agent / cli refuzate);
  - aprobarea se decide doar prin `owner_decide` (sesiune proaspătă; `/decide` o trimite acolo); execuția cere sesiunea proaspătă a
    aceleiași credențiale, cu limita revoke-all (helperul comun `authorizeReserved`);
  - în tranzacția finală serviciul recitește sesiunea și aprobarea consumată a exact acestei acțiuni (`approvedDecision`), apoi scrie
    evenimentul cu autoritatea (`authority`, `sessionId`, `credentialId`, `channel`, `approvalId`, `decidedVia`).
- Textul ciornei se aprobă doar pentru SHA-ul complet afișat (64 hex); un SHA gol, din spații sau trunchiat e refuzat (400).
- `sales.service.save` (catalogul): canalele `owner` / `test`, sesiune proaspătă la comandă, recitită în tranzacție; autoritatea în
  `sales.service.saved`.
- Ecranele: rollback, ridicarea „Nu contacta”, aprobarea textului și salvarea unui serviciu cer deblocarea (Windows Hello / cheia) când
  sesiunea lipsește; cardul de aprobare are text și buton pe fiecare tip. Profilul local de dezvoltare rămâne înregistrat ca atare.

## 4. Schimbări de contract
- API contract 16 → **17** (ruptă pentru cinci rute: rollback, lift, approve-content, `POST /api/sales/services[/:id]`; approve-content
  ia doar `displayedSha`). Aditive: câmpurile de autoritate pe cele patru evenimente; `projectId` pe apelurile `process.test` / `process.build`.
- Versiunea `2.15.2-m12`, schema 13, fără migrare.
- Teste existente schimbate doar pentru contractul nou: INT-05 și R1-10 (versiune / contract), M12-UI (tipurile rezervate și textele
  cardului), M12-CORE-02 (lista `OWNER_DECIDED`). Nicio aserțiune nu a fost slăbită.

## 5. Teste
- **`v2/tests/r-fix13.test.mjs`, 14 teste** (cel puțin unul pe defect; B2 rulează parserul într-un proces copil cu limită de timp).
- **`v2/tests/r-sales-owner.test.mjs`, 13 teste** prin rutele HTTP ale unui hub sintetic: sesiune absentă / falsă / expirată / revocată /
  revoke-all → 401 fără scrieri; agent, cli, `/api/commands`, canalele interne și serviciul fără autoritate → refuz fără scrieri; fluxul
  complet pe fiecare decizie, cu autoritatea în eveniment și repetare `duplicate`; sesiune neproaspătă → 401 apoi reauth; SHA greșit;
  catalogul în sesiune proaspătă; profilul local.
- **Pe codul vechi `3d9b3e8`** (clona `hub-fix-base`): toate cele 27 pică (B2 prin depășirea limitei de 15 s = bucla); pe codul nou trec.
- **Teste apropiate** (115 fișiere, clona de dezvoltare): 1338 = 1326 pass, 4 fail, 8 skip. Cele 4: două pinuri de contract actualizate
  apoi (R1-10, M12-CORE-02, trec 11/11) și două teste de browser M12 care cer build-ul UI (absent în clona de dezvoltare; poarta îl face).

## 6. Review independent
Agent separat, doar-citire, pe medium: **0 critice, 0 importante**. Observații, toate corectate în `b1a2bdb`, cu teste:
- **(mediu)** „acest proiect”, „aici” nu mai însemnau proiectul deschis → listă deictică lărgită;
- **(mic)** un ultim bloc ```json stricat putea fi înlocuit de un bloc anterior → doar ultimul bloc de la început de linie;
- **(mic)** ghilimelele valorii ascunse dispăreau → păstrate;
- **(mic)** un text de criteriu terminat în „| test” nu făcea dus-întors; id-uri peste AC-999 / cu zerouri → normalizate, în limită;
- **(mic)** o eroare la scrierea eșecului backup-ului putea ascunde eroarea originală → prinsă.
- Verificat fără defect: nicio cale spre cele patru comenzi fără sesiune (rute, `/api/commands`, AGENT_COMMANDS, simulator doar în test,
  niciun apelant intern); fără backtracking catastrofal în expresia de ascundere; SQL-ul `json_extract` din handoff / checkpoint.

## 7. Poarta completă
- **Prima rulare** (pe `5134314`, clona nouă `C:\Users\mihai\hub-fix-gate`, loguri `C:\Users\mihai\fix-stage\gate\run-1-m04br\`):
  V2 2566 = 2564 PASS, **1 FAIL**, 1 SKIP. Eșecul era cauzat de etapă: testul de browser M04-BR-01 căuta butonul vechi „Aprobă și pornește”
  la aprobarea textului ciornei și la rollback, care acum sunt decizii ale proprietarului. Testul a fost adaptat (commit `b461eb2`: cardul
  numește decizia, sesiunea de proprietar deschisă la pasul 5); M04-BR-01 și celelalte 20 de teste de browser / UI e2e trec cu UI-ul construit.
- **Rularea finală** (o singură dată pe `b461eb2`, arbore `88d1f513…`, clonă nouă recreată: fără remote, `git status` gol, fără pointer,
  fără `HUB_*` în afara `HUB_V2_STUDIO_DIST` / `HUB_V2_WEB_DIST`; build 0, build:v2 0, Studio 0 cu identitatea `2.15.2-m12` / `contract:17`;
  lansare detașată WMI; loguri `C:\Users\mihai\fix-stage\gate\run-final\`):
  - **V2 `npm run test:v2`: exit 0, 2566 = 2565 PASS, 0 FAIL, 0 anulări, 1 SKIP (T25)**, 4202 s, 0 procese proprii rămase. RM-10 a trecut.
  - **V1 `npm run test`: 552 = 549 PASS, 2 FAIL, 1 SKIP** — exact cele două teste pe registrul real `..\PROJECTS.md` (`conversation-api`,
    `workflow-refresh-api`), neschimbate.
  - Încărcarea mașinii: medie 46,9 %, maximum 97 %, memorie liberă 14,8–17,1 GB (262 de eșantioane).

## 8. Release (pregătit; upgrade-ul și push-ul sunt ale proprietarului)
- **Ramura** `claude/project-thread-pcocmw` din clona de dezvoltare = `3d9b3e8` + `f56d64b` (defecte + Sales) + `b1a2bdb` (observațiile
  review-ului) + `5134314` (pinuri) + `b461eb2` (testul M04) + commitul de documentație. Avansează rapid `v2-milestone-01`; arborele executabil
  e identic cu cel testat (`b461eb2`); documentația schimbă doar `.ifrim/` și `CLAUDE.md`. Folderul live a rămas la `3d9b3e8`.
- **Scriptul proprietarului** `C:\Users\mihai\fix-stage\release\owner-release.cmd` (același model ca 2.15.1), oprit la primul pas eșuat:
  1. verifică ramura, HEAD-ul `3d9b3e8` și arborele urmărit curat;
  2. aduce ramura din clona de dezvoltare, verifică SHA-ul exact al release-ului și identitatea arborelui executabil cu `b461eb2`;
  3. backup verificat prin API-ul live (`backup.mjs`);
  4. fast-forward `v2-milestone-01`;
  5. `upgrade.mjs --plan`, apoi `--apply` (fără migrare);
  6. verificare GET (`verify.mjs`): `2.15.2-m12` / 17 / schema 13 / BUILD_SAFE, cele patru comenzi Sales și aprobarea ofertei pe `owner`,`test`,
     `factory.accept` / `factory.reject` neschimbate (probat pe live-ul 2.15.1: exit 1, cum trebuie);
  7. push `v2-milestone-01` și `claude/project-thread-pcocmw`.
- **Revenire:** `git revert` al commiturilor de cod + `node v2\scripts\upgrade.mjs --apply` (schema neschimbată); restaurare completă din
  backupul pasului 3. Live: 0 aprobări în așteptare și 0 firme Sales, deci nicio cerere veche nu e retrasă la upgrade.

## 9. Ce rămâne (separat, neschimbat)
- Backup întrerupt de o oprire a Hub-ului în timpul lui (proces oprit, nu eroare): rândul ar rămâne `running` până la o curățare; nu e
  reconciliat la pornire (ar putea marca greșit un backup al altei instanțe). Neschimbat, de decis separat.
- Profilul local (orice proces loopback poate deschide o sesiune; deciziile făcute așa sunt înregistrate `local_dev_profile`).
- Prețurile și serviciile reale; RM-10 intermitent; cele 2 teste V1 pe registrul real; restul celor ~70 de puncte din raport (cosmetice,
  inaccesibile, nu sunt defecte sau sunt V1).
