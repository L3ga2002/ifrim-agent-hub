# M08 · Project Autopilot & Company Intelligence — raport

Data: 2026-10-03. Cod `2.9.0-m08`, contract API 8, migrația 8 (13 tabele noi). Totul e **comis** pe `v2-milestone-01` peste `17921ac` (vezi `git log`).

Detalii în:
- `M08_IMPLEMENTATION_STATUS.md`: ce s-a construit, fișier cu fișier, și ce s-a reparat pe parcurs;
- `M08_FEATURE_MATRIX.md`: cele 10 funcții, cu nivelul de verificare al fiecăreia;
- `M08_AUTOPILOT_CONTRACT.md`: ce are voie autopilotul și unde se oprește;
- `M08_DATA_PRIVACY_PLAN.md`: pachetul A (datele din OneDrive, profilul vocal);
- `M08_LIVE_PILOT_PLAN.md`: pachetul B (pilotul ProDelivery, pregătit, nepornit);
- `M08_TEST_REPORT.md`: testele D1–D10, cele adversariale, mutanții, suitele complete;
- `M08_UX_MEASUREMENTS.md`: capturile din aplicația reală și măsurătorile;
- capturile: `.ifrim/m08-screens/` (24 PNG + `report.json`).

## 1. Ce poți face acum (în ordine)

1. **Hub-ul live rulează încă M07** (`2.8.0-m07`, contract 7), sănătos, în BUILD_SAFE. Nu l-am repornit și nu i-am migrat baza.
2. **Treci pe M08 când vrei.** Pașii sunt în §6. Durează câteva minute și nu pornește niciun model.
3. **Decizi pachetul A** (protecția datelor) în Pilot → Decizii. Fiecare opțiune are execuție, revenire și limite.
4. **Pachetul B** (pilotul ProDelivery) se deblochează după A. E pregătit, dar nu e pornit.
5. **Te așteaptă în continuare** pachetele de livrare D6 `bnd_murl82o1_00afe726c3` și Demo B `bnd_mupwze7b_e03f70f2d7`. Nu le-am atins.

## 2. Ce s-a construit (un singur sistem, nu zece module izolate)

Toate cele zece funcții citesc și scriu prin aceleași piese: o singură bază de date, o singură memorie, aceeași magistrală de comenzi, aceleași plicuri de autorizare (envelopes) și granturi derivate. Nu există un orchestrator nou și nici o bază de grafuri separată.

| # | Funcție | Ce face, pe scurt |
|---|---|---|
| 1 | **Digital Twin** | Relații din datele Hub-ului: proiect → misiuni → change set-uri → componente → pachete, decizii, incidente. Fiecare relație are sursă și tip: OBSERVAT, DECLARAT de tine sau IPOTEZĂ. Răspunde la „de ce e blocat”, „ce s-a schimbat de ieri”, „ce afectează schimbarea” și „de ce am ales”. Spune ce nu știe. |
| 2 | **War Room** | „X a picat” deschide un incident PROPUS. Nimic nu se oprește și nu se modifică. Ce spune un model rămâne ipoteză neconfirmată. Impactul îl confirmi tu, separat de prioritatea recomandată. „Rezolvat” cere o dovadă confirmată. Remedierea e o misiune BUGFIX ca ciornă. |
| 3 | **Project Autopilot** | Un obiectiv finit (cel mult 5 sarcini dependente, criterii, limite). Toate sarcinile rulează sub **un singur plan confirmat de tine** (TRUSTED), una după alta, până la DELIVERY_READY, unde se oprește. În ASSISTED planul acoperă doar sarcina următoare. Nu are drept de reluare propriu. |
| 4 | **AI Board Meeting** | Agenda e deterministă, calculată din date. Livrările acceptate apar separat de pachetele neacceptate („un pachet neacceptat nu e o livrare”). Decid/Resping cer sesiunea ta. „Amână” mută punctul la ședința următoare. O decizie se înregistrează, nu activează nimic. Rezumatul cu model e dezactivat. |
| 5 | **Simulation Mode** | „Ce se întâmplă dacă luăm încă cinci clienți?” pe estimările tale. Dacă lipsesc date, primești INSUFFICIENT_DATA și lista lor, fără cifre inventate. Intervalele dau un rezultat optimist și unul pesimist. Formula e afișată. Totul e etichetat SIMULARE și nu atinge datele reale. |
| 6 | **Agent Performance League** | Grupare pe rol, provider, model, mediu și tip de lucru. Sub 5 observații: „date insuficiente”, fără câștigător. Testele, simulările, anulările și erorile de infrastructură sunt excluse și numărate separat. Propunerile nu se aplică niciodată singure. |
| 7 | **Skill Evolution** | Propunere (cu dovezi) → evaluare deterministă (tipare riscante, secrete, frontmatter neschimbat, cazuri de regresie) → aprobarea ta → activare limitată la proiecte → revenire imediată. Git rămâne sursa de adevăr. **Limită reală:** conținutul skill-urilor (nici al celor de bază) nu e încă injectat în instrucțiunile agenților, deci activarea doar înregistrează versiunea și nu schimbă singură ce face un agent; liga și revenirea automată nu-i atribuie rezultate. |
| 8 | **Teach Lega** | „Ține minte că…” sau „La livrarea unui site… verifică…” devine o propunere de regulă sau procedură (declanșator + pași). Devine regulă doar după confirmarea ta în sesiune și intră în memoria unică, cu scope. Textul din documente, pagini, tool-uri sau review-uri e refuzat. O parte care lărgește accesul (deploy, push, „fără confirmare”) nu devine niciodată regulă de lucru. |
| 9 | **Zero-Menu Mode** | Aceeași Lega, două vederi. Butonul „Ecran complet” în cockpit, comanda vocală „Ecran complet” și preferința „La pornire: cockpit / ecran complet”. Răspunsurile apar ca un card în cockpit. **Fereastra vocală armată:** un plan arătat într-o sesiune Lega se confirmă spunând „Da, execută planul”, fără butonul redundant. Fereastra are ~90 s, e legată de sesiunea ta, de sesiunea Lega și de hash-ul planului. Trece prin verificarea locală a vocii și transcrierea locală și se închide după 3 fraze care nu sunt o confirmare. |
| 10 | **Personal Mission Control** | Ecranul `#/m` pentru telefon. Asociere cu cod de 6 cifre (10 minute, cel mult 5 încercări), cookie HttpOnly separat, revocabil de pe PC sau de pe telefon. Telefonul doar vede starea și oprește (Stop tot, pauză, oprire misiune). Comenzile sunt idempotente și refuzate dacă imaginea pe care se bazează e veche. Confirmările rămân pe PC. |

Pe lângă cele zece:
- **Pachetele de decizie A și B** (Pilot → Decizii). Starea „executată” se citește din realitate, nu se declară.
- **Scripturile pachetului A:** `v2/scripts/relocate-data.mjs` și `v2/scripts/voice-acl.ps1`, testate doar pe foldere temporare.
- **Intențiile noi** în resolver-ul local, fără model.
- **Lecțiile confirmate** intră în instrucțiunile agenților, sub regulile Hub-ului.

## 3. Ce am verificat (rezumat; detalii în `M08_TEST_REPORT.md`)

- **54 de teste M08 noi** (D1–D10, pachete, mutare de date, UI, adversariale și 16 regresii din revizuire, RF-01…RF-16): toate trec. Unul dintre ele rulează fiecare intenție M08 prin `owner.intent` și verifică să nu apară erori.
- **D3 rulează cap-coadă prin fabrică**, cu provideri fixture: un obiectiv cu două sarcini dependente, **o singură confirmare** (zero formulare de grant), ambele sarcini ajung la DELIVERY_READY, planul se închide, nimic nu e acceptat automat.
- **Fereastra armată** confirmă din vocea sintetică a proprietarului (prin worker-ul vocal fixture) fără niciun click. Refuză o altă voce, altă sesiune Lega, un „da” vag și o frază după închiderea ferestrei.
- **7 mutanți pe gărzile cheie: toți prinși.** Gărzile verificate: proveniența lecțiilor, plafonul de eșecuri al ferestrei armate, dovezile venite de la model în War Room, planul unui obiectiv înlocuit, B înaintea lui A, confirmarea unei lecții fără sesiune.
- **UI-ul real**, pe un Hub de test cu date sintetice (24 de capturi): 0 erori în consolă, 0 scroll orizontal la 360/390 px, navigare cu tastatura pe tab-uri, reduced motion.
- **Suita V2 completă**, cu UI-ul M08: **650 de teste, 649 trecute, 0 eșuate, 1 sărit** (simlinkul care cere privilegiu Windows, ca înainte). **V1: 551/552**, cu același simlink sărit.

## 4. Defecte reale găsite și reparate în M08 (înainte să ajungă la tine)

1. **Confirmarea unui plan de obiectiv era refuzată mereu** („planul s-a schimbat”): la confirmare, planul se reconstruia fără obiectiv. Acum referința la obiectiv se derivă identic, din baza de date, la propunere și la confirmare, iar un obiectiv modificat invalidează planul vechi.
2. **Un obiectiv rămânea blocat** după un plan expirat sau, în ASSISTED, după prima sarcină. Acum se poate cere un plan nou.
3. **Fereastra vocală era consumată de o frază refuzată**, iar „Da, execută planul” spus imediat după nu mai avea efect. Acum doar o confirmare reușită consumă fereastra; după 3 fraze refuzate ea se închide.
4. **Trei setări noi lipseau din valorile implicite**: `startView`, `factoryExtraCommands` și `simulationDefaults`. Fără ele, salvarea lor ar fi aruncat o eroare.
5. **Mutarea datelor ar fi lăsat căile salvate** (atașamente, backupuri, pachete de livrare) indicând vechiul folder din OneDrive. Acum se rescriu în copie, cu număr de rânduri și integritate verificate.
6. **`.ifrim/private` e folosit și de V1.** Mutarea ia doar intrările V2. Marcajul se numește `V2_MOVED.json`, iar V1 nu e atins.
7. **Ținta `~/IfrimHub` moștenește accesul `CodexSandboxUsers`.** Scriptul restrânge ținta la contul tău și SYSTEM și verifică rezultatul.
8. **Revenirea ACL cu `icacls /restore` cere un privilegiu** pe care un cont normal nu îl are. Revenirea e acum „înapoi la moștenire”, exactă pentru că `-Apply` refuză un folder cu intrări explicite.
9. **„Ce decizii am?” ar fi stricat cardul din cockpit:** cererea pachetelor în așteptare se făcea fără tipul pachetului. Acum întoarce lista A/B; acoperit de testul care rulează fiecare intenție.
10. **Parserul de lecții** împărțea „verifici **și** viteza paginii” în doi pași și nu recunoștea persoana a II-a („verifici”, „rulezi”). Ambele sunt reparate și testate.
11. **Eveniment greșit** în „ce s-a schimbat” (`hub.booted` → `system.booted`); **focus pierdut** la navigarea cu săgeți între tab-uri; **titlul scenariului** creat din voce apărea fără diacritice.

**Revizuirea adversarială dinainte de commit** (24 de agenți read-only, fiecare constatare verificată separat; 16 confirmate) a găsit și am reparat, fiecare cu test de regresie în `m08-review-fixes.test.mjs`:
- respingerea unei sarcini livrate nu oprea planul: sarcina dependentă continua, iar obiectivul apărea „oprit” deși planul rula — acum planul se închide, sarcina curentă intră pe pauză, iar modificarea obiectivului așteaptă;
- „Uită regula” scotea imediat regula din instrucțiunile agenților, fără confirmare și fără anulare — acum regula se aplică până confirmi, iar propunerea se poate anula;
- fereastra vocală armată nu se putea deschide din UI-ul real (ruta HTTP pierdea sesiunea Lega);
- planul unui obiectiv cerut prin voce era creat, dar nu era afișat;
- `python3 -m unittest` (B3) era acceptat, dar niciun runner nu îl putea rula, iar aprobarea B4 nu pregătea nicio misiune; pilotul e reproiectat (vezi `M08_LIVE_PILOT_PLAN.md`);
- `factory.prepare` refuza canalul sesiunii tale: autopilotul și remedierea din War Room nu mergeau din UI-ul real;
- rollback-ul mutării ignora rândurile rămase în WAL și putea activa o bază veche sau goală;
- „pierdem doi clienți” devenea doi clienți noi; „De acum oprește tot” devenea o lecție; un incident nedovedit apărea ca blocaj; un punct amânat revenea la nesfârșit în ședințe; diff-ul unui skill apărea „undefined”; previzualizarea telefonului ținea sesiunea deschisă la nesfârșit; codul de asociere apărea în jurnalul comenzilor; un cookie malformat dădea eroare 500 pe ruta de oprire de pe telefon.

**A doua rundă** (5 agenți pe reparații) a confirmat că reparațiile țin și a găsit cazuri-limită, reparate și ele, cu teste RF-11…RF-16:
- o sarcină dependentă putea porni într-un plan nou cât timp dependența era doar pe pauză;
- oprirea unei misiuni ulterioare închidea tot planul;
- B4 se executa și cu B1 sau B3 respinse; acum refuză și spune ce lipsește;
- testul de acceptanță al pilotului putea fi păcălit de o suită care doar pomenea funcțiile; acum verifică apelurile reale (urmărire în timpul rulării);
- un modul scris de writer cu nume de bibliotecă standard Python (de exemplu `unittest/`) ar fi putut falsifica rularea testelor; acum oprește misiunea;
- rollback-ul eșua pe o bază deteriorată;
- „Nu face deploy, rulează testele” devenea „nu face rulează testele”;
- un cookie malformat strica rutele de proprietar.

## 5. Ce NU am făcut (limitele cerute)

- **Hub-ul live, datele reale, ProDelivery:** nu am repornit sau migrat Hub-ul live și nu am reconstruit `v2/web/dist`, pe care Hub-ul live îl servește. Nu am mutat date reale și nu am schimbat ACL-uri reale. Din ProDelivery doar am citit, fără să modific nimic: structura, HEAD-ul git și modulul `backend/utils/driver_ranking.py`, ca să pregătesc pilotul. Niciun fișier privat sau de configurare cu credențiale.
- **Modele și automatizări:** nu am pornit modele, subagenți, colectare comercială, taskuri cloud sau automatizări externe. Nu am refolosit granturile M07.
- **Ce rămâne decizia ta:** nu am apăsat Accept/Reject pe pachete. Nu am simulat clicurile, Windows Hello sau vocea ta: în teste există doar un autentificator software și voce sintetică, marcate PASS_SIMULATED.
- **V1, OpenClaw, WSL:** nu am atins V1, OpenClaw, taskurile programate sau WSL.
- **Git:** nu am făcut commit sau push. Mesajul de commit e pregătit în `.ifrim/M08_COMMIT_MESSAGE.txt`.

## 6. Trecerea Hub-ului live pe M08

**Făcută pe 2026-10-03, 16:26 UTC, de Claude, la cererea ta („fă tu”).** Hub-ul rulează `2.9.0-m08`, contract 8, BUILD_SAFE, cu migrația 8 aplicată, 0 granturi și 0 rulări. Pachetele D6 și Demo B au rămas READY_FOR_OWNER_ACCEPTANCE. Ordinea a fost:

1. oprire, fără execuții active;
2. A1, mutarea datelor în `C:\Users\mihai\IfrimHub\hub-data`, cu integritate ok și totul verificat cu sha;
3. A2, ACL-ul profilului vocal, cu `-Apply` și `-Verify`;
4. build-ul UI și dry-run-ul migrației pe baza mutată;
5. pornirea.

Detaliile sunt în `OPUS_HANDOFF.md`. Copiile vechi și cele din OneDrive nu au fost șterse (A3).

Pașii folosiți, pentru o repetare:

1. `node v2/scripts/migration-dry-run.mjs` — pe o copie a bazei: schema 7 → 8, `m08Complete: true`, integritate ok, număr de rânduri neschimbat.
2. `node v2/scripts/stop.mjs`
3. `npm run build:v2` — reconstruiește `v2/web/dist` pentru contractul 8.
4. `powershell -ExecutionPolicy Bypass -File v2\scripts\start-detached.ps1` — la pornire se aplică migrația 8.
5. Verificare: `node v2/scripts/status.mjs` arată `2.9.0-m08`, contract 8, BUILD_SAFE.

Dacă reconstruiești UI-ul înainte de oprire, pagina deschisă primește 409 UI_STALE pentru scrieri până la repornire. Stop, pauză și revocare merg oricum.

## 7. Niveluri de „gata” (Definition of Done)

| Nivel | Stare |
|---|---|
| BUILD_READY | **DA**: cod, migrație, UI construit, teste; rulează live din 2026-10-03. |
| SIMULATED_INTEGRATION_VERIFIED | **DA**: autopilot cap-coadă, fereastra vocală, telefonul și pachetele, cu provideri fixture și date sintetice. |
| PRIVACY_READINESS_VERIFIED | **EXECUTAT local** (2026-10-03): datele V2 sunt în afara OneDrive (A1) și profilul vocal e restrâns la contul tău și SYSTEM (A2). Copiile deja sincronizate în cloud rămân (A3). |
| VOICE_UX_VERIFIED | **NU (live)**: verificat doar cu voce sintetică. Hub-ul rulează M08; urmează verificarea cu vocea ta, după reconfirmarea izolării (R3). |
| LIVE_PROJECT_PILOT_VERIFIED | **NU**: pilotul ProDelivery e pregătit (pachetul B), blocat până la A și la autorizarea ta. |
| CROSS_DEVICE_VERIFIED | **BLOCKED**: lipsesc un telefon real și o conexiune autorizată (Hub-ul ascultă doar pe 127.0.0.1). |
| OWNER_ACCEPTED | **în așteptare**. |
