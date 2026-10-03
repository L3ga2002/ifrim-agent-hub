# M07 · Pregătirea de securitate

Data: 2026-10-03. Cod: `2.8.0-m07`, contract API 7.

Pe scurt:
- Identitatea ta rămâne sesiunea WebAuthn (Windows Hello). Vocea e un filtru și forma vorbită a unei confirmări pe care sesiunea o poate face oricum; nu te autentifică.
- Etapele cu cod ale fabricii rulează în `ifrim-runner`, atestat C1–C20, și sunt verificate live: writer, verificări/QA, review cu refuzurile uneltelor, preview și E2E.
- Un agent care lucrează pe delegarea ta e înregistrat ca agent. După revizie, poate crea autoritate sau porni lucru numai pe proiecte de test.

Mai jos: ce s-a schimbat față de M06 și ce rămâne deschis.

## 1. Cine poate face ce

| Acțiune | Cine | Cum e înregistrată |
|---|---|---|
| Confirmarea unui plan (envelope) | doar tu, în sesiunea WebAuthn | canal `owner`, `decided_via owner_session`; la confirmarea vocală, `consent.voice.utteranceId` plus transcrierea locală |
| Politica voice-first, ridicarea autonomiei | doar tu, cu sesiune proaspătă (Windows Hello în ultimele 5 minute) | canal `owner` |
| Profilul vocal (mostre, finalizare, ștergere, filtru) | doar tu, în sesiunea de proprietar, fără reautentificare proaspătă | canal `owner` |
| Operații delegate: backup, inspecție, atestare, mod, revocarea politicii (b), înregistrarea proiectelor de test, granturi, rută, aprobarea `factory.scope`, pornirea, pauza, reluarea și oprirea misiunilor și rulărilor | agentul, cu referința de delegare |
| Aprobarea politicii (b) | doar tu (după revizie; am aprobat-o o dată, pe delegarea M07) | canal `ui` | **canal `agent`**, actor `agent`, `[delegat] …` în `intent_text` și în nota deciziei |
| Același lucru din UI-ul tău | tu | canal `ui` |

**Canalul `agent` (nou în M07).** Înainte, operațiile delegate unui agent prin API apăreau ca „user/ui”, adică un click fictiv al tău. Excepții existau doar pentru verificările fără model declarate `cli` (din M05) și pentru acțiunile din sesiunea de proprietar, înregistrate ca `owner` (din M06).

Acum agentul se declară (`X-Hub-Channel: agent` + `X-Hub-Delegation`) și e înregistrat ca agent. Regulile canalului:
- Doar comenzile dintr-o listă fixă (`AGENT_COMMANDS`). Lista `channels` a comenzii nu se verifică pe acest canal.
- Confirmarea planurilor, politica voice-first, autonomia, profilul vocal și deschiderea gate-ului nu sunt delegabile.
- **Numai pe proiecte de test** (după revizie): `grant.create`, `project.environment.set`, `factory.prepare/limits/start/resume`, `approval.decide`, `conversation.*` și `run.start` cer ca **fiecare** câmp care numește un proiect (`projectId` sau slug, `missionId`, `conversationId`, `taskId`, aprobarea prin scope) să fie un proiect cu `source = hub-test`. Un câmp fals adăugat nu acoperă ținta reală. Verificarea se repetă când agentul execută o comandă aprobată. Un proiect real, sau o comandă fără proiect, e refuzat. Fail-safe-urile (pauză, stop, întrerupere, revocări, Stop All) sunt permise oriunde.
- **Pe orice canal:** `run.start` refuză un `taskId` din alt proiect decât conversația.
- `approval.decide` e limitat la `factory.scope`.
- `factory.resume` prin agent e permis numai în limitele confirmate (după revizie). Agentul reia doar o oprire de infrastructură (BLOCKED) sau o pauză pusă de el. Refuză:
  - orice NEEDS_OWNER_DECISION (încercări epuizate, baseline care nu reproduce, integritate critică, export refuzat, limita de cicluri);
  - un ciclu suplimentar, trecerea la QA sau alt model;
  - o fereastră nouă de timp;
  - reluarea unei pauze pe care ai pus-o tu.
- Rutele de proprietar care trec prin `dispatch` refuză un apel declarat `agent` sau `cli`.
- `POST /api/setup/run` acceptă `agent` (cu delegare, înregistrat ca agent) și refuză orice alt canal declarat (după revizie: înainte, `cli` era înregistrat ca `ui`/`user`).
- Rutele audio (`/api/voice/utterances`, `/api/voice/enroll/sample`) nu verifică antetul, dar cer sesiunea de proprietar.

Limita rămâne aceeași: canalul e o etichetă declarată, nu o graniță de încredere. Orice proces local care citește `/api/session` putea deja acționa pe `ui`. Canalul face auditul corect, iar limitele de mai sus îngustează ce poate face un agent care se declară.

## 2. Vocea: ce dovedește și ce nu

| Element | M06 | M07 |
|---|---|---|
| Unde se decide vorbitorul | în browser (caracteristici MFCC trimise de pagină) | **pe Hub**: modelul CAM++ analizează audio-ul PCM primit; pagina trimite doar indicatori care pot coborî rezultatul |
| Transcriere | lipsă (confirmarea vocală era blocată) | **locală**: whisper.cpp large-v3-turbo, română, pe GPU, ~0,5–1,5 s |
| Dovada confirmării vocale | un obiect `voice` trimis de client (falsificabil) | un rând `voice_utterances` creat de Hub, legat de sesiune și de plan, consumat o singură dată în tranzacția confirmării |
| Vorbirea altor persoane | se trimitea spre verificare | la gate, confirmare și probă se decide întâi vorbitorul, iar vorbirea care nu e a ta **nu e transcrisă** (testat pentru confirmare și probă: M07-VO-11; la gate, transcrierea pornește doar după MATCH). Excepție: mostrele de înscriere se transcriu fără decizie de vorbitor, pentru că încă nu există profil; textul se întoarce doar paginii și nu se salvează |
| Audio | nu ajungea la Hub | ajunge la Hub, **nu se stochează niciodată** (doar SHA-256) |

**Refuzuri testate:**
- un segment din altă sesiune;
- un segment pentru alt plan;
- un vorbitor necunoscut sau o voce incertă;
- vocea Lega redată (corelație);
- un dispozitiv virtual;
- „Da, dar nu porni” și „Da?”;
- un simplu „Da” spus lui Lega (acolo fraza trebuie să numească planul);
- două planuri în așteptare;
- un segment expirat (2 minute);
- profilul schimbat între timp;
- reutilizarea segmentului.

**Ce NU se pretinde:**
- Vocea se poate imita. MATCH nu e autentificare (NIST SP 800-63B-4).
- Pragul e calibrat **doar pe mostrele tale**, fără voci negative autorizate: rata de acceptare a altor voci e nemăsurată.
- Scorul nu e afișat ca procent.

**Reglat live, pe vocea ta:**
- Liniștea făcea mostrele să pară inconsecvente (0,13–0,39); după decupare, consecvența a ajuns la 0,81.
- Pragul de MATCH e plafonat la 0,55, pentru că frazele scurte de confirmare au scoruri mai mici. Pagina afișează pragul efectiv; profilul păstrează valoarea calibrată, 0,7.

**Filtrul dinaintea rutei cloud Lega:**
- Fiecare propoziție e reținută în browser până când Hub-ul răspunde MATCH; altfel e aruncată.
- Pe server, dacă filtrul e activ și cloud-ul trimite o transcriere fără niciun segment acceptat în 30 s, sesiunea Lega se oprește. Cuvintele nu sunt nici executate, nici salvate (M07-VO-06).
- Limită: Hub-ul nu poate împiedica un alt browser să deschidă o sesiune WebRTC fără filtru. Detectarea e post-factum, iar reacția e oprirea sesiunii.

**Transcrierea OpenAI** (GPT-Live) rămâne pentru conversație și **nu poate confirma** nimic (M07 §15).

## 3. Lanțul de execuție izolat (`ifrim-runner`)

| Etapă | Graniță | Dovadă |
|---|---|---|
| Writer (Codex) | `codex sandbox` cu profilul `ifrim_runner_rw`, copie, export validat C14 | C7–C14 PASS; live: o rulare de scriere aplicată (2 fișiere), Stop live C3, D6 |
| Verificări / QA | `codex sandbox` (rețea oprită). **Nou în M07:** când testele cer un socket local, comanda se reia pe o copie nouă în profilul doar-local bwrap (rețea proprie, doar loopback) | C18 PASS; live: baseline, verificările și QA din D6 în `bwrap-local-only@wsl-runner` |
| Preview | bwrap, namespace de rețea propriu (doar loopback) | C18 PASS (9/9); live: D6 |
| E2E | Playwright 1.61.0 + Chromium 1228 **în namespace-ul preview-ului**, cu sandbox-ul Chromium măsurat la fiecare rulare (seccomp 2, user namespace imbricat, fără `--no-sandbox`) | C19 PASS (9/9); live: D6, sandbox măsurat activ înainte și după pași |
| Review (Claude) | Claude Code 2.1.285 în bwrap: `/work` doar-citire, config dedicat, unelte Read/Glob/Grep, reguli de refuz pe căi | C20 PASS (11/11); live: 5/5 căi interzise refuzate de unealtă; review-ul din D6 |

**Exportul (C14) și fișierele de rulare** (M07, restrâns după revizie):
- Un fișier **nou, binar, non-asset**, pe care C14 oricum l-ar refuza (de ex. o bază SQLite lăsată de teste), e lăsat deoparte, listat și neaplicat, dacă regulile de ignorare ale proiectului îl exclud.
- Regulile sunt cele aplicate de git pe acest calculator: fișierele `.gitignore`, `.git/info/exclude` și excluderile globale ale utilizatorului Windows. Sunt aceleași reguli pe care le folosește transferul în mediu și sunt citite din proiectul de pe Windows, niciodată din copie.
- Fișierele text, numele de control, `.env*`, linkurile și orice fișier trimis în mediu își păstrează verificările.
- Numele cu `[` sau `]` nu sunt trimise lui git.
- Întrebarea către git e asincronă (maximum 1000 de nume). O eroare git sau un proiect fără depozit git propriu nu lasă nimic deoparte. Motivul apare în dovezi, în eroarea execuției și în motivul fabricii.
- Se aplică numai turelor de scriere.
- Ce a fost lăsat deoparte apare în rândul din „Medii de execuție”, în dovezile fabricii și în pachet.

**Amprenta** `8f9e9eeb934b6c01` include versiunile și hash-urile Playwright/Chromium/Claude. Atestarea curentă: `att_murgupen_3459ee8157`, PASS_LOCAL, C1–C20. Politica (b) e aprobată pe această amprentă.

**Riscuri reziduale ale lanțului:**
1. **Binarele Chromium și Claude aparțin lui `runner`.** O înlocuire schimbă amprenta, atestarea cade și rularea e refuzată, dar scrierea în sine nu e împiedicată. Remediere: mutarea lor sub `/opt` (root).
2. **E2E poate fi falsificat de codul proiectului testat** (același uid și același namespace ca gazda E2E). E aceeași limită ca la parsarea ieșirii testelor; granița gazdei nu e afectată.
3. **Rețeaua reviewer-ului** e rețeaua distribuției, nefiltrată pe domeniu; uneltele lui nu au acces la rețea.
4. **Review-ul și writer-ul trimit codul proiectului** la OpenAI și Anthropic, prin clienții oficiali, pe abonament.
5. **C14 din atestare nu exercită regula fișierelor ignorate** (fixtura C14 nu e un repository git). E acoperită de testele M07-EXP-08/09 și M07-ENV-12.

## 4. Sesiune, origine, versiune, mod

- **Originea canonică** e `http://localhost:8011`. O navigare pe `127.0.0.1` primește 307 spre localhost. API-ul, scripturile și iframe-urile nu sunt redirecționate.
- **Handshake UI–API (contract 7):** o pagină construită pentru alt contract nu poate trimite comenzi (409 `UI_STALE`).
  - Merg mereu: Stop All, întreruperea unei rulări, oprirea sesiunii Lega, întreruperile din cockpit (Taci, Pauză, Oprește agentul, Îngheață, Preiau eu), Stop și Pauză pe misiune, revocarea unui plan, a unui grant și a tuturor sesiunilor, revenirea la politica legacy, logout și **suspendarea** gate-ului.
  - Nu sunt scutite: deschiderea gate-ului și celelalte revocări (autentificator, R2, politica (b), consimțământul Lega, izolarea).
- **Modul și planurile** (reproiectat după revizie):
  - LIVE_VALIDATION intrat printr-un plan aparține planurilor care îl țin (`holders`): planul care a intrat în LIVE și cele confirmate cât îl țineau. Modul revine la BUILD_SAFE când se închide **ultimul** dintre ele. Un plan care nu pornește readuce legătura de dinainte.
  - Planurile suspendate de o repornire rămân suspendate lângă un plan confirmat după ea și revin, tot suspendate, când acesta se încheie. Doar reluarea lor explicită le face din nou deținătoare.
  - O schimbare manuală a modului (`mode.set`) îl ia de la planuri în aceeași tranzacție.
  - O repornire doar suspendă legătura: o reluare explicită a unei misiuni dintr-un plan deschis, neexpirat, sub politica voice-first, reface modul de dinainte. Dacă reluarea e refuzată, modul revine la BUILD_SAFE.
- **Pornire:**
  - `v2\scripts\restart.ps1` și `start-detached.ps1` pornesc Hub-ul prin WMI (`Win32_Process.Create` → `start.mjs`), independent de sesiunea agentului și de containerul MSIX al aplicației desktop. Așa rulează Hub-ul live.
  - Lansatorul `Ifrim Hub V2.cmd` și `npm run v2` rulează direct `start.mjs`, ca proces Node detașat.
  - În BUILD_SAFE la fiecare pornire.

## 5. Componente locale și suprafețe deschise

- **Motorul vocal** rulează ca proces copil al Hub-ului.
  - `whisper-server` ascultă **doar pe loopback, pe un port aleator**.
  - La pornire, worker-ul verifică o singură dată, prin netstat, ce PID ascultă și refuză un alt proces. Dacă netstat nu răspunde clar, verificarea e sărită fără eroare.
  - Fișierele au SHA-256 fixat în cod (arborele binarelor și ambele modele) și sunt verificate la pornirea motorului; o nepotrivire e refuzată.
  - Rezultatul verificării e păstrat cât timp dimensiunea și data fișierelor rămân aceleași, iar un motor deja pornit nu se reverifică.
- **Risc rezidual cunoscut: `whisper-server` nu are autentificare** și trimite `Access-Control-Allow-Origin: *`; opțiunea `--request-path` nu funcționează în v1.9.4. Un proces local sau o pagină web care ghicește portul poate folosi transcrierea sau o poate opri (`/load`). **Nu** poate injecta text în Hub, care folosește doar răspunsurile la propriile cereri. Efectul e întreruperea vocii până la următoarea cerere.
- **Profilul vocal** stă în `C:\Users\mihai\IfrimHub\voice\profiles`, în afara proiectului și a OneDrive.
  - Codul cere modul 600, dar pe Windows Node nu îl aplică. Fișierele moștenesc ACL-ul din `C:\Users\mihai\IfrimHub`: citire pentru grupul `CodexSandboxUsers`, plus SYSTEM și Administrators.
  - Calea nu e în lista de deny a Codex pe Windows. Restrângerea cere un ACL explicit sau o regulă de deny în profilul Codex: decizia ta (`OPEN_ISSUES.md`).

## 6. Problemă preexistentă semnalată (nu din M07)

Întregul proiect e pe Desktop, sub **OneDrive**, inclusiv `.ifrim/private` (baza Hub-ului, jurnalele, backupurile V1/V2), deci se sincronizează în cloud.
- Datele sensibile din bază sunt hash-uri (token-urile sesiunilor) sau metadate.
- Transcrierile tale de confirmare și istoricul ajung însă în OneDrive.
- Decizia îți aparține: muți `HUB_V2_DATA_DIR` în afara OneDrive sau excluzi folderul din sincronizare.

## 7. Revizia adversarială M07

- **Prima revizie** (4 lentile, cu verificatori care încercau să infirme): 42 de constatări confirmate (cu dubluri), toate tratate, cu excepția riscului `/load` (documentat).
- **Agentul pentru lanțul de mediu** a rulat real C18/C19/C20, a reparat un defect real (`release.sh` nu ștergea directorul gazdei preview-ului) și a verificat 6 mutanți.
- **Verificarea dinaintea commit-ului:**
  - prima rundă (84 de subagenți): 11 constatări de cod confirmate și reparate, 3 mecanisme respinse dar reparate, 34 de corecturi de documente, 2 lacune găsite în documente și închise în cod (agentul limitat la proiecte de test, `setup/run` cu `cli`);
  - a doua rundă (37 de subagenți, doar codul nou): 11 constatări confirmate și reparate, printre care un câmp fals care ocolea limita la proiecte de test, `taskId` dintr-un proiect străin, reluarea prin agent din NEEDS_OWNER_DECISION și predarea modului către planuri care nu-l țineau;
  - a treia rundă (12 subagenți): nimic nou pe canalul agent; 2 constatări low (planurile suspendate reactivate de un plan nou, fraza din prompt fără `.git`), reparate;
  - mutanți: 30/30 prinși pe codul final;
  - detalii în `M07_LIVE_VALIDATION_RESULTS.md` §4; mutanții în `M07_ACTIVATION_REPORT.md` §8.
