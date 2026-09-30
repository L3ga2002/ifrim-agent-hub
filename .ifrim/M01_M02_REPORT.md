# Raport de finalizare: Milestone 1, Milestone 2 și Lega

- Perioada: 2026-09-30 – 2026-10-01.
- Branch: `v2-milestone-01`. Pe GitHub până la `bbe8757`. `main` a rămas la `e9ab563`.
- Versiunea Hub-ului: `2.3.0-m03` (înainte era `2.2.0-m02`).
- Scris pentru tine, proprietarul. Detaliile tehnice sunt în fișierele indicate la fiecare secțiune.

Cum citești etichetele:
- **PASS_LIVE**: verificat cu un model sau provider real.
- **PASS_LOCAL**: verificat pe calculatorul tău, cu componente reale, dar fără model.
- **PASS_SIMULATED**: verificat cu un provider simulat (fixture), fără rețea.
- **FAIL**: a eșuat. **BLOCKED**: nu se poate face acum. **NOT_RUN**: nu a fost rulat.
- **NEEDS_INSTALL_APPROVAL**: cere o instalare pe care trebuie s-o aprobi tu.
- **NEVERIFICAT**: nu am dovezi, deci nu afirm nimic.

## 1. Pe scurt

- **Ce există acum:** Hub-ul V2 pe `127.0.0.1:8011`. Are fundația companiei (Milestone 1), interfața „JARVIS” cu izolarea agenților (Milestone 2) și pe Lega, asistentul vocal care vede compania și pregătește muncă.
- **Dovedit live (PASS_LIVE):** un turn Claude Code doar-citire, sesiuni vocale Lega în română și două execuții Codex pe proiectul de test „Ifrim Hub Test”: una cu scriere (formular de contact, `npm test` 4/4) și una doar-citire după reparația MCP.
- **Găsit live și reparat:** aprobarea unei propuneri nu pornea execuția. Apoi o execuție Codex a folosit un server MCP care rulează în afara sandbox-ului. Ambele au acum reparație și teste.
- **Teste:** V2 are 249 de teste: 248 trec, 0 eșuează, 1 omis din cauza mediului Windows. Codul V1 nu a fost modificat.
- **Încă nedovedit live:** căutarea web a Lega, `propose_mission`, predarea Codex ↔ Claude, un Stop în timpul unui turn real și Browser Workspace (Playwright nu e instalat).
- **Nu e gata de autonomie:** fiecare acțiune live cere modul LIVE_VALIDATION, poarta deschisă și un grant. La fiecare repornire Hub-ul revine în BUILD_SAFE.
- **Tu trebuie să decizi:** R2 (Codex poate citi fișierele neprotejate ale altor proiecte) înainte de orice proiect real, R3, merge-ul în `main`, HUB-018 și cele trei instalări.
- **Nimic nu e în `main` și nimic nu e publicat.** Reparațiile de azi sunt în commit-ul care conține acest raport (primul după `bbe8757`), pe `v2-milestone-01`. Push-ul îl faci tu (`git push`).

## 2. Milestone 1 (`f31240b`)

Commit din 2026-09-30. Este fundația „dual-ecosystem”: Hub-ul lucrează atât cu OpenAI (Codex), cât și cu Anthropic (Claude Code), și are structura unei companii.

În Milestone 1 nu a pornit niciun model. De aceea nu există PASS_LIVE în acest milestone. Teste la final: 169, dintre care 168 trec și 1 NOT_RUN (symlink de fișier pe Windows).

### Compania
- Compania cu 12 departamente, dintre care 4 active (executive, engineering, sales, operations). Celelalte sunt doar structură. **PASS_LOCAL**
- 18 roluri cu ierarhie (`reportsTo`), obiective și misiuni legate de ele. **PASS_LOCAL**
- „Chief of Staff” determinist: rezumă starea fără să pornească un model. **PASS_LOCAL**

### Cum circulă munca
- 33 de suprafețe de execuție (locurile unde poate rula munca). Fiecare operație are o stare reală: SUPPORTED, ASSISTED, PLANNED sau UNSUPPORTED. **PASS_LOCAL**. Codex Cloud și Claude web sunt doar PLANNED.
- 10 cicluri de viață (stările prin care trece o misiune, un task, o execuție etc.) și un format comun de eveniment. **PASS_LOCAL**
- Magistrala de comenzi (aprox. 65 de comenzi) cu canale, validare, protecție la dublă trimitere și jurnal. **PASS_LOCAL**
- Motorul de aprobări: AUTO_ALLOWED, ASK_ONCE_FOR_TASK, ALWAYS_ASK, DENIED. Regulile pot doar să înăsprească, nu să relaxeze. **PASS_LOCAL / PASS_SIMULATED**
- Router cu 11 factori: alege departament, rol, provider, model, suprafață, unelte și mediu. În BUILD_SAFE doar planifică. **PASS_LOCAL**
- Programări cu un singur „owner” per intenție și un runner local care nu rulează de două ori același slot. **PASS_LOCAL**. Programările native Claude/OpenAI le creezi tu.

### Cunoaștere
- 11 skill-uri versionate (amprentă SHA-256). Un skill nu dă permisiuni. **PASS_LOCAL**
- Memorie cu 8 zone (scope-uri). Nu se sincronizează automat cu memoria vendorilor, intenționat. **PASS_LOCAL**
- Auditul capabilităților OpenAI și Anthropic, standardele și matricea comună, generate în fișierele `V2_*`. **PASS_LOCAL** (verificat adversarial). Verificările de cont le-ai făcut tu în UI: Codex `prolite`, fără credite; Claude `max`.

### Siguranță și date
- Backup verificat și restaurare de test. **PASS_LOCAL**
- Import V1 reversibil (snapshot → dry-run → apply → revert), rulat pe datele reale. **PASS_LOCAL**
- Gărzi de facturare: creditele peste 0 blochează Codex, modelele Fable sunt refuzate, Claude pornește cu `--setting-sources user`. **PASS_LOCAL / PASS_SIMULATED**
- Telemetrie cu etichete clare: MEASURED, PROVIDER_REPORTED, DERIVED sau UNKNOWN. **PASS_SIMULATED** (turn Codex simulat, `M01-telemetry-01`).
- Runtime pentru calculator: contract și registru (10 medii). Control real prin browser: **NEEDS_INSTALL_APPROVAL** (Playwright).

Poarta, grant-urile și backup-ul automat din Milestone 1 au funcționat apoi și în validările live (secțiunea 6).

Detalii: `IMPLEMENTATION_STATUS.md`, `V2_TEST_REPORT.md`.

## 3. Milestone 2 (`0fb71d2`)

Commit din 2026-09-30. Adaugă experiența „JARVIS” și pregătirea de securitate pentru rulări reale. Teste la final: 197, dintre care 196 trec și 1 SKIPPED_ENV.

### Securitate și izolare
- Codex e izolat de sistemul de operare: sandbox Windows `elevated`, profilurile `ifrim_hub_ro` și `ifrim_hub_rw`, negări pentru Hub, `.env` și credențiale. Test canary: 46/46, **PASS_LOCAL**. Folosit apoi în execuțiile live (secțiunea 6).
- Claude Code e limitat la doar-citire, prin reguli la nivel de unealtă. **PASS_LOCAL**; turn real **PASS_LIVE**.
- Claude Code cu shell sau scriere pe Windows nativ: **BLOCKED**. Nu există sandbox de sistem pentru el pe Windows.
- Serverul nu dă prin API fișierele protejate: zone protejate, junction-uri, căutare redactată. **PASS_LOCAL**

### Shell și Control Room
- Bara laterală, bara de sus, căutare, Stop All peste tot, paleta de comenzi (Ctrl+K), mini-asistentul (Alt+M), navigare jos pe telefon. **PASS_LOCAL**
- Control Room răspunde la trei întrebări: ce se întâmplă, ce trebuie să decizi, unde continui. Nu inventează agenți care lucrează. **PASS_LOCAL / PASS_SIMULATED**

### Nucleul WebGL
- Nucleul animat are 10 stări, luate din semnale reale ale Hub-ului. Dacă WebGL cade, trece pe SVG (testat: la 3 pierderi ale contextului WebGL, primele 2 recuperate, a 3-a → SVG; plus o eroare injectată în nucleu → SVG). **PASS_LOCAL**
- Oprirea animației când sistemul cere „reduced motion”: **NOT_RUN** (nemăsurabil în panoul de test).

### Focus și compozitor
- Ecran Focus cu panouri redimensionabile și salvate, conversație cu streaming, Stop, retry controlat, inspector și ciornă păstrată. **PASS_SIMULATED**
- Compozitorul ia modelele și efortul Codex din capabilitățile verificate (`model/list`); aliasurile Claude sunt fixe și marcate „neverificat”. Acceptă fișiere prin drag-drop și, în BUILD_SAFE, arată ce ar cere poarta. **PASS_LOCAL**
- Terminal interactiv real: nu există. E etichetat „neimplementat”.

### Misiuni
- Listă și graf, lanțul owner → reviewer → QA, criterii, dovezi și progres numărat (nu estimat). **PASS_SIMULATED**

### Catalog
- Catalog OpenAI/Anthropic filtrabil, cu 6 fapte separate pentru fiecare capabilitate. **PASS_LOCAL**

### Unelte și browser
- Browser Workspace cu stare reală, doar pentru adrese locale, niciodată Hub-ul. **PASS_LOCAL**. Test end-to-end cu browser real: **NEEDS_INSTALL_APPROVAL** (Playwright).
- Panoul Calculator și comenzile controlate. **PASS_LOCAL**. Controlul desktopului: **BLOCKED**.

### Voce (înainte de Lega)
- Vocea e separată de model, are mod local strict și arată NEEDS_SETUP când lipsește motorul. Comenzile vocale locale sunt deterministe, iar vocea nu poate aproba. **PASS_LOCAL**
- Transcriere locală în română: **NEEDS_INSTALL_APPROVAL**.

### Stare live
- Flux SSE cu reluare de la ultimul eveniment, deduplicare, „Reconectare” și ora ultimei actualizări. **PASS_LOCAL / PASS_SIMULATED**. Întărit azi (secțiunea 5).

### Simulator
- Simulator separat pe portul 8012, cu scenarii trecute prin API-urile reale, fără provideri reali și fără poarta reală. **PASS_SIMULATED**

### Responsive și accesibilitate
- 360–1920 px și zoom 200%, fără depășiri. Etichete, focus vizibil, contrast AA, listă ca alternativă la graf. **PASS_LOCAL**
- FPS real, sesiune de mai multe ore, screen reader real: **NOT_RUN**.

Detalii: `M02_IMPLEMENTATION_STATUS.md`, `M02_TEST_REPORT.md`, `M02_SECURITY_READINESS.md`.

## 4. După Milestone 2: Lega

Lega este asistentul vocal al Hub-ului. Folosește GPT-Live (vocea ChatGPT) prin abonamentul tău ChatGPT, trecând prin Codex-ul instalat (`codex app-server`, metodele experimentale `thread/realtime`). Nu folosește cheie API. Sunetul merge direct între browser și OpenAI: nu trece prin Hub și nu se salvează.

### Cele patru commit-uri
- **`30bfbef`**: vocea Lega și reparația Codex `thread/start` (`project_doc_max_bytes=0`, `project_root_markers=[]`). Aceasta a reparat eșecul Codex de la 14:41 UTC.
- **`dac2db4`**: Modul Lega, pe ecran complet (Alt+J). Rețeaua vie a companiei e desenată din starea reală a Hub-ului.
- **`ce819b9`**: pluginurile oprite pentru procesul vocal (serverul `cua_repl` al pluginului Computer Use bloca pornirea). Dacă pornirea eșuează înainte de voce, încercarea se returnează în grant.
- **`bbe8757`**: acces complet, sub controlul tău: unelte de citire, săgeata `point`, `how_to`, `prepare_grant`, `propose_mission`, butonul „Permite execuții” pe fiecare proiect și căutare web doar pentru Lega (implicit `cached`).

### Ce poate face Lega acum
- **Vede** (doar citire): `hub_status`, `company_briefing`, `list_projects`, `project_brief`, `list_missions`, `mission_detail`, `pending_approvals`, `recent_runs`. Notițele unui proiect sunt 4 fișiere fixe, redactate, niciodată din `.ifrim/private`.
- **Arată**: `navigate` deschide un ecran. `point` desenează un contur și o săgeată pe buton, timp de 12 s. `how_to` dă pașii exacți dintr-o hartă fixă.
- **Pregătește**:
  - `propose_run` face un card de propunere; execuția pornește doar după click-ul tău.
  - `propose_mission` creează o misiune ciornă, tot după click.
  - `prepare_grant` doar completează formularul; grantul îl creezi tu.
- **Siguranță**: „Lega, oprește tot” oprește tot. Uneltele `pause` și `stop_all` ale agentului acționează doar dacă ai spus-o tu în ultimele 20 s.
- **Niciodată din voce**: aprobări, deschiderea porții, granturi, facturare, deploy, push, ștergeri, mesaje externe.
- **Căutare pe internet**: doar procesul Lega o are, implicit `cached` (fără pagini live). Execuțiile agenților rămân fără internet.

### Ce ai folosit live
Sesiunea cu acces complet `lega_muoic63s_69b4539e26`: 11,4 minute, vocea `sol`, căutare web `cached`. **PASS_LIVE**.

- Folosite: `hub_status` 6, `how_to` 5, `recent_runs` 5, `propose_run` 4, `point` 3, `navigate` 3, `project_brief` 3, `company_briefing` 2, `pending_approvals` 2, `prepare_grant` 1 (apoi ai creat grantul cu click), `list_missions` 1, `list_projects` 1.
- Nefolosite live: căutarea web, `propose_mission`, `mission_detail`. **NOT_RUN** live; trec în testele simulate.
- `pause` și `stop_all` ale agentului nu apar în numărătoarea acestei sesiuni: **NEVERIFICAT** live.
- Verdictul tău: „pare să fie bine pentru început”.

Primul test live, dinainte de `ce819b9`: ambele încercări au fost oprite de verificarea MCP, înainte de orice apel vocal. Verificarea și-a făcut treaba, iar cauza a fost reparată în `ce819b9`.

Teste Lega: `M03-LEGA-01..17`, `M03-ACCESS-01..08`, `M03-STAGE-01..02`, toate trec (fixture, fără rețea).

Costul real al vocii în abonament: **NEVERIFICAT** (nemăsurat).

Detalii: `LEGA.md`.

## 5. Verificarea de azi și ce am reparat

### Verificarea adversarială
- Am inventariat 49 de livrabile din Milestone 2. Apoi am verificat independent 48 de afirmații că ceva e „gata”.
- Rezultat: **25 CONFIRMED** și **23 PARTIAL**.
- PARTIAL a însemnat, de cele mai multe ori, că dovada era doar într-un document, nu într-un test sau în cod. Golurile reale sunt reparate mai jos.

### Reparații, fiecare cu testul ei (toate PASS_LOCAL)
- **Stare live:** o singură „poartă” de evenimente folosită de aplicație. Elimină duplicatele, respinge evenimentele vechi sau venite în altă ordine și se resincronizează după resetarea bazei de date. Teste: `M02-UI-09`, `M02-UI-10`, `M02-UI-10b`.
- **Stare live:** fluxul SSE golește cozile mari cu backpressure, în loc să închidă conexiunea. Test: `T17b`.
- **Tastatură:** scurtăturile Alt ignoră AltGr, IME și tastatura numerică. Scrisul pe tastatura românească nu mai schimbă ecranul. Test: `M02-UI-11`.
- **Compozitor:** limita de atașament e 10 MB, ca pe server; numele de fișier are maximum 200 de caractere; tipurile acceptate sunt cele ale serverului. Aliasurile de model Claude sunt marcate „neverificat”. Teste: `M02-UI-12`, `M02-UI-13`, `M02-UI-14`.
- **Fișiere pe server:** listarea ascunde link-urile și junction-urile care duc în zone protejate sau în afara proiectului. Test: `M02-SEC-09`.
- **Proiecte de test:** tot arborele e verificat (secrete adânci, junction-uri interne, `.ifrim/private`). Test: `M02-SEC-14`.
- **Browser Workspace:** listă de adrese permise, verificarea redirecționărilor și un strat de rețea (proxy mort în afara adresei aprobate, DNS doar pentru localhost, fără QUIC). Teste: `M02-RT-06..09`. Doar cod: cu browser real e NOT_RUN, Playwright nu e instalat.
- **Codex:**
  - modelul cerut trebuie să fie exact cel primit (`M03-RF-01`);
  - o execuție doar-citire care primește drept de scriere se oprește înainte de turn (`M03-RF-02`);
  - `externalSandbox` e refuzat (`M03-MCP-04`);
  - un Stop înainte de turn nu mai e urmat niciodată de un apel la model (`M03-MCP-07`).
- **Simulator:** butonul „Eroare auth” produce acum o eroare reală de autentificare, nu una de cotă. Test: `M03-RF-03`.
- **Granturi expirate:** apar și sunt tratate ca expirate, niciodată ca active. Test: `M03-RF-10`.
- **Teste întărite:** `M02-SEC-09` (listarea junction-urilor), `M02-RT-05` (redactare), `M02-UI-09` (rulează pe codul real al aplicației).

### Bug live 1: aprobările nu porneau nimic
- **Ce s-a întâmplat:** la 19:45 și 19:46 ai aprobat două propuneri de execuție ale Lega pe ecranul Aprobări. Nu a rulat nimic.
- **De ce:** aprobarea doar înregistra decizia. Butonul de pornire apărea doar sub filtrul „Aprobate”.
- **Reparat:**
  - propunerile de comenzi au acum „Aprobă și pornește”, într-un singur click;
  - există secțiunea vizibilă „Aprobate, încă nepornite”, și pentru scripturi npm și verificări de browser;
  - apare un mesaj (toast) dacă pornirea eșuează;
  - Lega îți spune când ai aprobări nepornite.
- **Teste:** `M02-UI-14` (aprobările nepornite rămân vizibile; aprobarea pornește în același click). Mesajul Lega despre aprobările nepornite nu are un test dedicat.
- **Ce s-a întâmplat apoi:** la instrucțiunea ta „fă tu tot”, Claude a pornit a doua propunere aprobată (cea mai recentă): `run_muojnivb_b113ce0591`.
- **Status:** reparația e PASS_LOCAL. Butonul nou nu a fost încă folosit live: **NEVERIFICAT**.

### Bug live 2: servere MCP în afara sandbox-ului
- **Ce s-a întâmplat:** execuția `run_muojnivb_b113ce0591` a apelat de 3 ori serverul `cua_repl/js` al pluginului Computer Use.
- **De ce contează:** un server MCP rulează în afara sandbox-ului Codex, cu drepturile tale de utilizator. Un apel prin el ocolește limitele puse de Hub.
- **Cauza:** execuțiile Codex ale Hub-ului aveau pornite pluginurile și serverele MCP din config-ul tău (5 Cloudflare și `node_repl`).
- **Reparat, pentru orice proces Codex al Hub-ului:**
  - `features.plugins=false` și `features.remote_plugin=false`;
  - fiecare server din config e oprit pe nume;
  - execuția e refuzată înainte de pornirea procesului dacă un nume nu poate fi oprit sau dacă proiectul are `.codex/config.toml`;
  - înainte de turn se verifică toate paginile din `mcpServerStatus/list`; orice răspuns necunoscut oprește execuția;
  - un apel MCP în timpul unui turn oprește execuția.
- **Reparat pentru Claude:** execuția se oprește înainte de model dacă la pornire apare vreun server MCP sau vreo unealtă `mcp__`.
- **Teste:** `M03-MCP-01..09`.
- **Verificat live după reparație:** `run_muomogfu_f3b3dcccd7`, **PASS_LIVE**. Verificarea MCP a trecut și nu a existat niciun apel MCP.

## 6. Validări live

Toate au avut loc pe 2026-09-30. „Ifrim Hub Test” este proiectul de test sanitizat, cu git propriu.

| Ora (UTC) | Ce | Run / sesiune | Rezultat | Dovadă |
|---|---|---|---|---|
| 14:06 | Turn Claude Code doar-citire pe „Ifrim Hub Test” (model `sonnet`, CLI 2.1.175) | `run_muo6i9og_50c329673c` | PASS_LIVE | Poarta a admis cu grant de 1 încercare, backup verificat automat, 15 s. A găsit cazul lipsă (nume format doar din spații). Proiect nemodificat. |
| 14:41 | Turn Codex doar-citire | `run_muo7r9bp_d1b50893f7` | FAIL | `thread/start` a depășit 120 s, înainte de inferență. Nimic consumat. Reparat în `30bfbef`. |
| 18:18–19:49 | Sesiuni vocale Lega, română în ambele sensuri, inclusiv versiunea cu acces complet | `lega_muoic63s_69b4539e26` (sesiunea cu acces complet) | PASS_LIVE | 11,4 min, vocea `sol`, căutare `cached`. Uneltele folosite sunt în secțiunea 4. |
| 20:14–20:27 | Execuție Codex cu scriere pe „Ifrim Hub Test”: formular de contact cu validatorul existent, propusă de Lega și aprobată de tine | `run_muojnivb_b113ce0591` | PASS_LIVE | Terminată, `npm test` 4/4. Claude a verificat pagina în browser: erori în română pe câmpuri și starea de succes „mesajul nu a fost trimis”. Constatare: 3 apeluri MCP `cua_repl/js`, apoi reparate. |
| 21:39–21:48 | Execuție Codex doar-citire pe „Ifrim Hub Test”, după reparația MCP (Hub `2.3.0-m03`) | `run_muomogfu_f3b3dcccd7` | PASS_LIVE | Rezumat corect în română, verificarea MCP trecută, niciun apel MCP, nicio cerere de escaladare. Aprox. 8 min până la prima comandă în sandbox. |

## 7. Teste

- **V2:** 249 de teste. **248 PASS, 0 FAIL, 1 SKIPPED_ENV.**
  - Testul omis: symlink de fișier pe Windows dă EPERM fără Developer Mode, care nu e activat.
  - Rularea completă finală (2026-10-01): **249 de teste: 248 PASS, 0 FAIL, 1 SKIPPED_ENV.**
  - Evoluție: Milestone 1 avea 169, Milestone 2 avea 197, după primele teste Lega 214, acum 249.
- **V1:** 552 de teste. **549 PASS, 2 FAIL (timeout 30 s, doar în suita completă), 1 omis.**
  - Cele două (`tests/continuation-api-contract.test.mjs` și `tests/model-policy-api.test.mjs`) apelează API-ul V1 live de pe `127.0.0.1:8004`. Depășesc timpul doar în suita completă.
  - Rulate singure, trec (16 s și 0,2 s). Codul V1 nu a fost modificat.
- **Build UI** (`npm run build:v2`): OK.
- **Dependențe** (`npm audit`): 0 vulnerabilități.

Testele automate folosesc provideri simulați. Ele nu dovedesc comportamentul modelului real; asta o fac doar validările live din secțiunea 6.

## 8. Ce rămâne deschis

### Decizii ale tale
- **R2:** Codex poate citi fișierele neprotejate ale altor proiecte, inclusiv `.env`-urile lor, prin cale absolută. Decide înainte să permiți execuții pe proiecte reale precum ProDelivery. Există o soluție pregătită, dar neactivată, pentru că ar scrie reguli ACL în alte proiecte.
- **R3:** `~/.codex/config.toml*` rămâne citibil din sandbox-ul Codex. Poate conține valori de mediu pentru servere MCP.
- **Merge în `main`:** `v2-milestone-01` nu e unit în `main` (PR). Nimic nu e publicat.
- **HUB-018:** acceptanța V1. Îl închizi ca înlocuit de validarea live V2 sau îl păstrezi deschis.
- **Opțional:** preflight-ul ACL Codex real, rulat de tine în terminalul tău: `node v2/tests/manual/codex-real-profile-preflight.mjs`. Pentru Claude a fost refuzat de stratul local de permisiuni. Regulile DENY există deja pe căile protejate.

### Instalări care cer aprobarea ta
- **Playwright:** necesar ca Browser Workspace să verifice pagini într-un browser real. **NEEDS_INSTALL_APPROVAL**
- **Motor local de transcriere în română:** necesar pentru vocea strict locală. **NEEDS_INSTALL_APPROVAL**
- **Claude Code CLI 2.1.175 → ≥ 2.1.284:** necesar pentru aliasurile noilor modele. E o schimbare globală pe calculator. **NEEDS_INSTALL_APPROVAL**

### Limite de platformă
- **Terminal interactiv real:** nu există un transport sigur. Output-ul și comenzile controlate funcționează. **BLOCKED**
- **Fereastră mereu deasupra (overlay):** cere o componentă nativă care nu există. **BLOCKED**
- **Controlul desktopului:** cere o punte nativă neconstruită. **BLOCKED**
- **Acces de pe telefon:** Hub-ul ascultă doar pe `127.0.0.1`, intenționat. **BLOCKED**

### Neimplementat intenționat
- **Wake word:** opțional și nu a fost cerut acum. Lega pornește doar când apeși „Pornește Lega” (în panoul Lega, deschis cu butonul Lega sau cu Alt+L, ori în Modul Lega).
- **PWA / service worker:** ca să nu se păstreze în cache conversații sau aprobări. Hub-ul nu merge offline.
- **Sunete:** nu au fost construite. Hub-ul nu scoate sunete de notificare.
- **Reluarea istoricului:** nu poți „derula” o execuție veche. Simulatorul acoperă nevoia de design review.
- **Virtualizarea logurilor lungi:** se folosesc limite și paginare, deci logurile foarte lungi se văd pe pagini.

### Probleme cunoscute
- **Nedovedit live:** căutarea web a Lega, `propose_mission`, predarea Codex ↔ Claude, un Stop sau o întrerupere în timpul unui turn real și scrierea Codex prin profilul `rw` dincolo de această singură execuție.
- **Viteză:** sandbox-ul Codex pe Windows are nevoie de aprox. 8 minute înainte de prima comandă a unei execuții (pregătirea ACL).
- **Consum:** execuțiile au folosit efortul de raționament `max` din config-ul tău Codex, deci consumă mai mult din abonament.
- **Nemăsurat:** FPS real, „reduced motion” din sistem, o sesiune de mai multe ore, un screen reader real.
- **Teste V1:** cele 2 teste care apelează API-ul V1 live depășesc timpul în suita completă, pentru că API-ul de pe 8004 răspunde lent.
- **Resturi minore (P3):** o conversație goală cu titlu stricat, dintr-un `curl` mai vechi. Proiectul „Ifrim Hub Test” are fișiere necomise create de Codex (formularul de contact), păstrate pentru tine.
- **Lega pe API experimental:** metodele `thread/realtime` pot fi schimbate de o actualizare Codex. Consumul real al vocii din abonament nu e măsurat.
- **În afara V2:** sarcina programată OpenClaw din Windows e încă „Ready” (nu e dezactivată).

## 9. Riscuri

- Hub-ul nu e pregătit pentru autonomie. Orice acțiune live cere LIVE_VALIDATION, poarta deschisă și un grant. La fiecare repornire revine în BUILD_SAFE.
- Izolarea Codex pe Windows se bazează pe reguli DENY permanente în ACL-uri. Aceleași reguli afectează și sesiunile din aplicația Codex desktop.
- Claude doar-citire e limitat numai la nivel de unealtă, fără sandbox de sistem pe Windows. Shell-ul și scrierea pentru Claude rămân blocate.
- Injectare de instrucțiuni: notițele proiectelor și, când e pornită, căutarea web ajung la agentul Lega. Orice efect cere în continuare click-ul tău.
- Căutarea web în modul `live` păstrează o cale de scurgere a textului din Hub. De aceea implicit e `cached`.
- Lega depinde de un API Codex experimental.

## 10. Starea Hub-ului acum

- Hub-ul rulează pe `127.0.0.1:8011`, versiunea `2.3.0-m03`.
- Mod BUILD_SAFE. Poarta de execuție e deschisă, așa cum ai lăsat-o pentru Lega.
- 0 granturi active. Nicio execuție activă și nicio sesiune Lega activă. Fără LIVE_VALIDATION și fără grant nu poate porni nimic.
- Simulatorul rulează separat, pe portul 8012.
- Git: branch-ul `v2-milestone-01` e pe GitHub până la `bbe8757`. `main` e la `e9ab563`. Nimic unit și nimic publicat.
- În commit-ul de după `bbe8757` (local, până îl urci tu): reparațiile din verificarea de azi, izolarea MCP pentru Codex și Claude, aprobările într-un click, granturile expirate, versiunea `2.3.0-m03` și aceste documente.

## Cum continui

1. **Push:** commit-ul reparațiilor de azi e făcut local, la cererea ta („fă tu tot”). Urcă-l pe GitHub cu `git push` (push-ul e blocat pentru mine de setările locale).
2. **Decizia R2:** hotărăște înainte de a apăsa „Permite execuții” pe un proiect real (de exemplu ProDelivery). Până atunci, rămâi pe „Ifrim Hub Test”.
3. **Ce lipsește live:** pe „Ifrim Hub Test”, câte un test, fiecare cu grantul lui: căutarea web a Lega (`cached`), `propose_mission`, butonul nou „Aprobă și pornește” și un Stop în timpul unui turn Codex.
4. **Instalările:** decide Playwright (verificare în browser real) și actualizarea Claude Code CLI. Poți decide și dacă scazi efortul de raționament din config-ul Codex, ca să consumi mai puțin.
5. **Curățenie și merge:** decide ce faci cu formularul de contact necomis din „Ifrim Hub Test”, cu HUB-018 și dacă deschizi un PR `v2-milestone-01` → `main`.
