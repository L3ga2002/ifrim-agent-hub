# Ifrim Agent Hub V2 — raport pentru următorul prompt

Data: 2026-10-01, ~20:30 UTC (23:30 ora României).

- **Proiect:** `C:\Users\mihai\OneDrive\Desktop\Ifrim Digital Proiecte\Ifrim Agent Hub`, V2 în `v2/`, Hub pe 127.0.0.1:8011.
- **Detalii:** `.ifrim/M04_REPORT.md`, `.ifrim/M03_CLOSURE_RESULTS.md`, `.ifrim/M04_R2_ISOLATION_OPTIONS.md`.
- **Fapte verificate** contra git, a documentației și a Hub-ului live, de un agent separat, doar citire.

## 1. Starea la zi

**Git:**
- `v2-milestone-01` = commit-ul local care conține acest raport, **neîmpins**. Sub el: `715cb33` (probele de închidere, corecturile factory și diff, canary-ul R2); commit-ul raportului adaugă rezultatele Demo B și Lega.
- `origin/v2-milestone-01` = `402cd76`.
- `main` a avansat **local** prin fast-forward de la `e9ab563` la același commit. `origin/main` e încă `e9ab563`.
- Push-ul îl face proprietarul:

  ```
  git push origin v2-milestone-01 main
  ```


**Hub:**
- Versiunea `2.5.0-m04`, mod **BUILD_SAFE**, poarta de execuție **open**. Inferența e blocată doar de BUILD_SAFE: trecerea în LIVE_VALIDATION plus un grant ar permite rulări.
- 0 granturi active, 0 execuții active.
- Singurul proces pornit de Hub e preview-ul Demo B (4610). Se oprește la decizia pe pachet, fie accept, fie reject.
- Pe mașină mai ascultă V1 (3004/8004) și gateway-ul OpenClaw.
- Corecturile de după M04 sunt pe disc, dar intră doar la următoarea repornire a Hub-ului. **Procedura de repornire:**
  1. backup verificat;
  2. migrare probată pe o copie, dacă schema se schimbă;
  3. oprire grațioasă, fără `--force`, de preferat după decizia pe Demo B.

  După pornire: BUILD_SAFE, cu poarta „open”. LIVE_VALIDATION îl repune doar proprietarul.

**Proiecte reale cu execuția activată:** Ifrim Agent Hub și **ProDelivery** (activat azi, 2026-10-01 ~15:30 UTC).

**Teste:**
- V2: **450 de teste, 449 PASS, 0 FAIL, 1 SKIPPED_ENV** (symlink fără privilegiu Windows).
- V1: 552 de teste, 551 PASS, 0 FAIL, 1 SKIPPED_ENV.

## 2. Ce există (M01–M04)

| Milestone | Conținut | Stare |
|---|---|---|
| M01 `f31240b` | Runtime-ul companiei: command bus, politica de aprobări, router, programări, skill-uri | Comis |
| M02 `0fb71d2` + Lega | Experiența JARVIS, securitate, asistentul vocal Lega (GPT-Live prin abonamentul ChatGPT, prin `codex app-server`) | Comis, Lega PASS_LIVE |
| M03 `b4b5cdb`, `294a677`, `3c5d202` | Software Factory: spec → plan → writer Codex → verificări → review Claude read-only → remediere limitată → QA → preview → E2E în Chromium → pachet de livrare | Comis; probele live 2.1, 2.2, 2.3, 2.5 și 2.6 sunt **PASS_LIVE** |
| M04 `2301dcd` | Departamentul de Vânzări: import CSV/XLSX → identitate → proveniență → audit pe fixture-uri → calificare → oportunitate → propunere → ciornă → decizia proprietarului → ciornă Software Factory | Comis; BUILD_READY + SIMULATED_SALES_FLOW_VERIFIED, doar pe date sintetice |

**M04 pe scurt:**
- trimiterea reală e dezactivată (`OUTREACH_DISABLED`);
- colectarea live e dezactivată (`LIVE_COLLECTION_DISABLED`);
- catalogul de servicii pornește gol (nimic inventat);
- DO_NOT_CONTACT se aplică după firmă, firmele unite cu ea, CUI, domeniu, e-mail și domeniul e-mailului;
- WON cere un contact real și acceptarea înregistrată de proprietar;
- o revizie adversarială a găsit 15 defecte, toate reparate. 14 au teste de regresie dedicate (M04-RV-01…12). Defectul #8, blocarea event loop-ului la volum, e acoperit indirect de testele cu 3.700 de rânduri.

**Limitări M04:**
- **Audit:** doar HTML static, pe fixture-uri.
- **XLSX:** fără ZIP64, `.xls`, `.xlsb` sau `.ods`; datele vin ca numere seriale.
- **Trimiteri:** o trimitere `ATTEMPTED` rămasă blochează retrimiterea.
- **UI:** lipsesc unirea firmelor, corecturile manuale, dovezile manuale și profilul firmei proprietarului. API-ul există.
- **Metrici:** ratele de răspuns, conversie și venit nu sunt calculate.
- **Date:** lista istorică de ~3.700 de firme nu a fost găsită în proiect.

## 3. Probele live M03 (2026-10-01)

Probele au fost aprobate de proprietar în conversație. Conform `M03_CLOSURE_RESULTS.md`, pornirea, „Reia”, „Întrerupe”, aprobările și acceptările au fost clicurile lui. Hub-ul înregistrează doar „actor user, canal ui”. Modul și granturile au fost setate prin API după aprobarea lui.

| Probă | Rezultat | Dovezi cheie |
|---|---|---|
| 2.1 Codex RW pe Demo A prin factory | PASS_LIVE | `gpt-6.1-sol` · medium, 14 s de la turn la prima comandă |
| 2.2 Review Claude read-only | PASS_LIVE | `sonnet` explicit; implicitul contului `fable[1m]` e refuzat înainte de model |
| 2.3 Demo B funcționalitate + remediere + E2E | PASS_LIVE | Primul writer nu a schimbat nimic: sandbox-ul rece a cerut 145 s la prima comandă. Remediere reală → verificări, review, QA, preview și E2E PASS. Pachet `bnd_mupwze7b_e03f70f2d7` |
| 2.5 Stop în timpul unui turn real | PASS_LIVE | Stop la ~20 s după confirmarea turnului, oprire în **11,2 s**, 0 procese rămase, Demo A neschimbat |
| 2.6 Lega propune o misiune | PASS_LIVE | Propunere pe canalul voce → clicul proprietarului → misiunea `mis_mupy0no5_922d2614b0` în SPEC_DRAFT, 0 execuții |

**Pachetele de livrare:**
- **Demo A:** **acceptat** de proprietar.
- **Demo B:**
  - verificare independentă cu 3 recenzori read-only (consemnată în `M03_CLOSURE_RESULTS.md`), **recomandare ACCEPT**;
  - rămân OPEN constatările Claude F-002 (low) și F-003 (info, parțial greșită);
  - **decizia proprietarului e încă în așteptare.**
- Codul livrat rămâne necomis în proiectele demo; commit-ul acolo e o decizie separată.

**Niveluri M03:** BUILD_READY + SIMULATED_E2E_VERIFIED + probe live PASS_LIVE pe proiecte de test. **REAL_PROJECT_READY nu e atins.**

## 4. R2: izolarea mediului de execuție

**Problema:**
- Pe Windows, comenzile modelului Codex pot citi aproape tot hostul în afara căilor negate.
- Poarta R2 limitează **doar Codex**: rulează pe proiecte `hub-test` sau cu acceptarea de risc a proprietarului, per proiect, legată de cale și de maximum 7 zile (azi nu există niciuna). Acceptarea nu e izolare.
- Claude read-only și Lega nu sunt limitate de R2.
- Pe lângă writer, rulează tot pe Windows, cu `:root` citibil:
  - runner-ul factory (verificări, QA și preview prin `codex sandbox`, `v2/server/factory/runner.mjs`);
  - E2E-ul în Chromium.
- Review-ul Claude are doar o graniță la nivel de unealtă (`dontAsk`), nu de sistem de operare.

**Făcut azi:** distribuția WSL2 dedicată **`ifrim-runner`**:
- Ubuntu 24.04.5, în `C:\Users\mihai\AppData\Local\IfrimRunner\wsl`, VHD max 40 GB;
- discurile Windows nemontate, interop-ul oprit, GPU oprit;
- utilizatorul `runner`, fără sudo;
- Codex 0.159.2 fixat în `/usr/local/lib/codex`, Node 24 în `/usr/local/lib/nodejs`;
- profiluri Codex cu `:root` negat, `:minimal` doar citire, `~/.codex`, `/tmp` și `.env*` negate, rețeaua oprită pentru comenzile modelului;
- login ChatGPT prin abonament. Codul de dispozitiv a dat 503, așa că s-a folosit loginul prin browser, cu redirecționarea localhost Windows → WSL.

**Canary-ul** `v2/tests/manual/r2-wsl-canary.mjs`:
- **PASS_LOCAL, 40/40** pe C1–C13, C15 și C17, cu tokenul real prezent;
- **C14** (validatorul de export) și **C16** (contul prin `wsl-runner`) cer codul Hub și nu au rulat;
- amprenta completă: `distro=ifrim-runner wslconf=b8890b2f40e0327e codex=0.159.2 config=4a7c12306a171922 kernel=6.6.114.1-microsoft-standard-WSL2`.

**Limite rămase:**
- Kernelul WSL e comun cu `Ubuntu` (care are `/mnt/c`) și cu `docker-desktop`: izolare de tip container, nu VM.
- Windows poate accesa distribuția prin `\\wsl$` și `wsl -u root`.
- Clientul Codex are rețea spre OpenAI, fără filtrare pe domenii.
- Profilurile de permisiuni Codex sunt Beta.
- `.wslconfig` e global și nu se creează fără aprobare.
- Rețeaua `mirrored` nu se activează, fiindcă ar expune Hub-ul de pe 127.0.0.1.
- Mașina: Windows 11 Home build 26300, fără Hyper-V sau Windows Sandbox. O graniță de VM ar cere upgrade la Pro.
- Codex desktop pe Windows se actualizează singur, iar copia din WSL rămâne fixată pe 0.159.2.

**Lipsește pentru a închide R2.** Fiecare punct e o aprobare **separată**, pentru acțiunea exactă:
- **(a) Implementarea `wsl-runner` în Hub, cu teste:**
  - `codex app-server` pornit în distribuție cu `env -i`;
  - workspace-ul copiat (git bundle sau tar), nu montat;
  - rezultatul exportat ca patch validat pe Windows (C14);
  - aceleași gărzi (pluginuri oprite, MCP fail-closed, `model/list`, garda de facturare);
  - verificarea contului prin mediu (C16);
  - TMPDIR per rulare.
- **(b) Schimbarea porții `host_isolation = environment`**, legată de amprentă: numele distribuției, `wsl.conf`, versiunea Codex, hash-ul profilului și kernelul. Orice schimbare a uneia închide poarta până la un canary nou.
- **(c) Prima probă live** pe un proiect hub-test prin `wsl-runner`.
- **(d) Opțional, `.wslconfig`.**

Sunt deja făcute: instalarea, `wsl.conf`, loginul și canary-ul.

**Revenire**, doar cu aprobarea proprietarului:
1. `wsl -d ifrim-runner -- codex logout`;
2. `wsl --terminate ifrim-runner`;
3. `wsl --unregister ifrim-runner`, care **șterge definitiv** distribuția (export înainte, dacă e nevoie);
4. opțional, dezactivarea codului de dispozitiv în ChatGPT.

## 5. Constatări din probele live

1. **Sandbox-ul Windows e rece după repornirea PC-ului:** prima comandă durează ~145 s, următoarele ~2,7 s.
   - Un writer își poate abandona comenzile și întoarce un change set gol.
   - Corectura „Reia relansează implementarea” e făcută (M03-FAC-28).
   - Încălzirea sandbox-ului la pornirea Hub-ului încă nu e făcută.
2. **Latența Stop:** 11,2 s de la cerere până la oprirea execuției, fiindcă Codex își închide turnul activ.
3. **Prima sesiune Lega** a pornit din panoul de browser al aplicației Claude.
   - A transcris „Lega”, apoi s-a închis cu „closed: error” la ~7 s după conectare. Grantul s-a consumat.
   - **Microfonul a funcționat; cauza reală e necunoscută**, pentru că UI-ul și API-ul nu arată detaliul.
   - Reluarea din Chrome a mers.
4. **Loginul ChatGPT cu cod de dispozitiv** a dat 503. Loginul prin browser a mers.
5. **Transcrierea vocală** a auzit „Factory D-Mobi” în loc de „Demo B”. Lega a găsit totuși proiectul corect.
6. **Diff-ul afișat de Hub** avea un rând gol fantomă la fișierele noi. E reparat (M03-DIFF-02) și intră la repornire.
7. **Constatarea Claude F-003 pe Demo B e parțial greșită:**
   - adresele cu două „@” sunt respinse;
   - un TLD de un caracter trece.

   Verificarea independentă în mai mulți pași e utilă înainte de acceptări.
8. **Lega:** riscuri structurale.
   - Folosește metode experimentale `codex thread/realtime`, deci un update al Codex desktop o poate strica.
   - Consumul real de voce din plan nu e măsurat; există doar o estimare (~0,08 USD pe 1,5 min).
   - Notițele proiectului și paginile web pot încerca prompt injection, dar efectele cer tot clicul proprietarului.
   - Procesul vocal rulează pe Windows, nu prin `wsl-runner`.
9. **Limite factory relevante pentru proiecte reale:**
   - snapshot-ul refuză peste 4000 de fișiere sau 64 MB (fără `node_modules`, `dist` și `.git`), deci e nevoie de un change set bazat pe git;
   - E2E nu urmează post-redirect-get (RT-07);
   - Stop în timpul unei comenzi QA nu are test dedicat;
   - planul e determinist, din șablon;
   - Claude CLI 2.1.175 (`sonnet` = Sonnet 4.6) nu raportează efortul efectiv. Un upgrade e o schimbare globală, cu aprobare separată.

## 6. Decizii deschise ale proprietarului

**Imediate:**
- Pachetul Demo B: accept sau reject.
- Push-ul `v2-milestone-01` și `main`.
- Commit în proiectele demo (opțional).
- Misiunile rămase în draft:
  - `mis_mupy0no5_922d2614b0` (Demo B, SPEC_DRAFT, 5 probleme de completat; candidat natural pentru proba live prin `wsl-runner`);
  - `mis_muppcs5g_f67355777c` („AROBS — prospect…”, DRAFT, creată în sesiunea ta cu Lega).

  Pentru fiecare: continui, arhivezi sau le lași.
- Proiectul Ifrim Hub Test are fișiere necomise scrise de Codex.

**R2:** aprobările (a)–(d) din §4, fiecare separat.

**Vânzări:**
- catalogul real de servicii;
- un fișier real de firme (temei legal, retenție, ștergere);
- **research live:** surse și domenii, volum, durată, metode, date păstrate, condiții de oprire;
- **outreach:** canal (Gmail/SMTP), verificare legală din surse actuale, dezabonare, activare explicită;
- **inferență pentru Vânzări:** o rută compatibilă cu abonamentul și cu izolarea, deci după R2.

**Decizii vechi încă deschise:**
- HUB-018: închis ca înlocuit de validarea V2 sau păstrat (lock-ul V1 `LOCK-mumsn13e-2kew8n` e încă ținut).
- Task-ul programat OpenClaw e încă „Ready”: risc de pornire automată după o repornire.
- V1 rulează pe 3004/8004: decizia de trecere completă pe V2.
- R3: negarea `~/.codex/plugins` (candidat). ACE-urile DENY persistente afectează și Codex desktop.
- `codex-sandbox-timing.mjs --real-profile` trebuie rulat în terminalul proprietarului.
- Instalări neaprobate: Claude CLI ≥ 2.1.284, motorul vocal local românesc.

## 7. Propunere pentru următorul milestone (M05)

**Recomandat: M05 = închiderea R2 (`wsl-runner`) + robustețea execuțiilor live.** Deblochează lucrul pe proiecte reale ale clienților.

1. **Suprafața `wsl-runner`:**
   - pornire cu `env -i`, workspace copiat, export patch validat;
   - profilurile Linux, gărzile existente, verificarea contului prin mediu;
   - selecția mediului per proiect, implicit `ifrim-runner` pentru proiectele reale.
2. **Decizia explicită** dacă runner-ul factory (verificări, QA, preview), E2E-ul și review-ul trec și ele în `ifrim-runner` înainte de primul proiect real.
3. **Poarta `host_isolation = environment`** legată de amprenta completă, cu regula pentru update-uri: un update WSL, de kernel sau de Codex închide poarta și reia canary-ul.
4. **Canary-ul complet:**
   - adaugă C14 (validatorul de export) și C16 (contul prin `wsl-runner`);
   - reia C1–C17 pe amprenta curentă;
   - transformă în teste automate ce se poate.
5. **Change set bazat pe git**, pentru proiectele reale peste limitele snapshot-ului.
6. **Încălzirea sandbox-ului** la pornire sau înaintea primului writer, cu timing-ul raportat în cronologie.
7. **Latența Stop:** măsurată și îmbunătățită; test pentru Stop în timpul unei comenzi QA.
8. **Lega:**
   - motivul real al închiderii capturat și afișat în UI;
   - încercarea nu se consumă când sesiunea cade în primele secunde din motive de transport.
9. **Probe live** pe un proiect hub-test prin `wsl-runner`: writer Codex RW prin factory, Stop, review. Fiecare cu aprobarea proprietarului.
10. Abia apoi **primul proiect real** (de ex. ProDelivery), ales de proprietar, cu backup și aprobare explicită.

**Alternativă, dacă prioritatea e vânzarea: M05 = Vânzări cu date reale.**
- catalogul real;
- importul listei proprietarului, cu temei legal și retenție;
- research live aprobat pe surse, volum, durată și condiții de oprire.

Propunerile scrise de AI vin după R2, iar outreach-ul rămâne dezactivat până la o decizie legală.

## 8. Reguli de păstrat în următorul prompt

- Fără model, LIVE_VALIDATION, granturi, commit, push sau deploy fără aprobarea explicită a proprietarului pentru acțiunea exactă. Push-ul îl face proprietarul.
- Gărzile de facturare și izolarea MCP nu se slăbesc:
  - doar abonament;
  - Fable și `[1m]` refuzate pentru Claude;
  - pluginuri oprite;
  - fiecare server MCP al proprietarului dezactivat după nume.
- Nu se citesc `.ifrim/private`, `.ifrim/tmp`, `.ifrim/BACKUPS`, `.env`, `~/.codex` sau `~/.claude`. Nu se copiază `auth.json` între medii.
- Deciziile factory (start, reia, accept, reject) și aprobările rămân clicuri ale proprietarului în UI. Clasificatorul de siguranță al sesiunii refuză ca agentul să le dea în numele lui.
- Repornirea Hub-ului:
  - doar când e inactiv;
  - cu backup verificat;
  - cu migrarea probată pe o copie;
  - fără `--force`.
- Vânzări: nimic trimis, nimic colectat live și nimic inventat (prețuri, termene, clienți) fără autorizare separată.
