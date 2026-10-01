# Ifrim Agent Hub V2 — raport pentru următorul prompt

Data: 2026-10-01, noaptea (UTC). Proiect: `C:\Users\mihai\OneDrive\Desktop\Ifrim Digital Proiecte\Ifrim Agent Hub`, V2 în `v2/`, Hub pe 127.0.0.1:8011. Detaliile complete sunt în `.ifrim/M04_REPORT.md`, `.ifrim/M03_CLOSURE_RESULTS.md` și `.ifrim/M04_R2_ISOLATION_OPTIONS.md`.

## 1. Starea la zi

- **Git:**
  - branch `v2-milestone-01`: M04 `2301dcd` și documentația M04 `402cd76`, ambele împinse de proprietar;
  - lucrul de după M04 (corecturi factory și diff, canary-ul R2, documentația probelor) e **[GIT_STATUS]**;
  - `main`: **[MAIN_STATUS]**;
  - push-ul îl face proprietarul.
- **Hub:**
  - versiunea `2.5.0-m04`, mod **BUILD_SAFE**, 0 granturi active, 0 execuții active;
  - corecturile de după M04 intră la următoarea repornire a Hub-ului, făcută când e inactiv;
  - singurul proces rămas e preview-ul Demo B (4610), care se oprește la acceptarea pachetului.
- **Teste:**
  - V2: **[V2_RESULT]**;
  - V1 (ultima rulare): 552 de teste, 551 PASS, 0 FAIL, 1 SKIPPED_ENV (symlink).

## 2. Ce există (M01–M04)

| Milestone | Conținut | Stare |
|---|---|---|
| M01 `f31240b` | Runtime-ul companiei: command bus, politica de aprobări, router, programări, skill-uri | Comis |
| M02 `0fb71d2` + Lega | Experiența JARVIS, securitate, asistentul vocal Lega (GPT-Live prin abonamentul ChatGPT) | Comis, Lega PASS_LIVE |
| M03 `b4b5cdb`, `294a677`, `3c5d202` | Software Factory: spec → plan → writer Codex → verificări → review Claude read-only → remediere limitată → QA → preview → E2E în Chromium → pachet de livrare | Comis; **toate probele live PASS_LIVE** (2.1, 2.2, 2.3, 2.5, 2.6) |
| M04 `2301dcd` | Departamentul de Vânzări: import CSV/XLSX → identitate → proveniență → audit pe fixture-uri → calificare → oportunitate → propunere → ciornă → decizia proprietarului → ciornă Software Factory | Comis; BUILD_READY + SIMULATED_SALES_FLOW_VERIFIED, doar pe date sintetice |

**M04 pe scurt:**
- trimiterea reală e dezactivată (`OUTREACH_DISABLED`);
- colectarea live e dezactivată (`LIVE_COLLECTION_DISABLED`);
- catalogul de servicii pornește gol (nimic inventat);
- DO_NOT_CONTACT se aplică după firmă, firmele unite cu ea, CUI, domeniu, e-mail și domeniul e-mailului;
- WON cere un contact real și acceptarea înregistrată de proprietar;
- o revizie adversarială a găsit 15 defecte, toate reparate și acoperite de teste de regresie.

## 3. Probele live M03 (2026-10-01; aprobate de proprietar, iar fiecare clic de pornire, oprire sau aprobare a fost al lui)

| Probă | Rezultat | Dovezi cheie |
|---|---|---|
| 2.1 Codex RW pe Demo A prin factory | PASS_LIVE | `gpt-6.1-sol` · medium, 14 s de la turn la prima comandă |
| 2.2 Review Claude read-only | PASS_LIVE | `sonnet` explicit; implicitul contului `fable[1m]` e refuzat înainte de model |
| 2.3 Demo B funcționalitate + remediere + E2E | PASS_LIVE | Primul writer nu a schimbat nimic (sandbox rece, 145 s); remediere reală → verificări, review, QA, preview și E2E PASS; pachet `bnd_mupwze7b_e03f70f2d7` |
| 2.5 Stop în timpul unui turn real | PASS_LIVE | Stop la ~20 s după confirmarea turnului, oprire în **11,2 s**, 0 procese rămase, Demo A neschimbat |
| 2.6 Lega propune o misiune | PASS_LIVE | Propunere pe canalul voce, apoi clicul proprietarului; misiunea `mis_mupy0no5_922d2614b0` în SPEC_DRAFT, 0 execuții |

**Pachetele de livrare:**
- Demo A: **acceptat** de proprietar.
- Demo B: verificare independentă cu 3 recenzori read-only, **recomandare ACCEPT**; decizia e a proprietarului: **[DEMO_B_STATUS]**.
- Codul livrat rămâne necomis în proiectele demo; commit-ul acolo e o decizie separată.

## 4. R2: izolarea mediului de execuție

- **Problema:** pe Windows, comenzile modelului Codex pot citi aproape tot hostul în afara căilor negate. Din acest motiv **REAL_PROJECT_READY nu e atins**: Hub-ul lucrează doar pe proiecte de test.
- **Făcut azi:** distribuția WSL2 dedicată **`ifrim-runner`** (Ubuntu 24.04), cu:
  - discurile Windows nemontate și interop-ul oprit;
  - utilizatorul `runner` fără sudo;
  - Codex 0.159.2 fixat în `/usr/local/lib/codex` și Node 24 în `/usr/local/lib/nodejs`;
  - profiluri Codex cu `:root` negat și `~/.codex`, `/tmp`, `.env*` negate, rețeaua oprită pentru comenzile modelului;
  - login ChatGPT prin abonament.
- **Canary-ul** `v2/tests/manual/r2-wsl-canary.mjs`: **PASS_LOCAL, 40/40**, cu tokenul real prezent. Amprenta mediului: `wslconf=b8890b2f40e0327e codex=0.159.2 config=4a7c12306a171922`.
- **Lipsește pentru a închide R2** (milestone separat):
  1. **suprafața `wsl-runner` în Hub:**
     - pornește `codex app-server` în distribuție cu `env -i`;
     - copiază workspace-ul (git bundle sau tar) în loc să-l monteze;
     - exportă rezultatul ca patch validat de Hub pe Windows (C14: căi, symlink-uri, fișiere de control, mărime);
     - aplică aceleași gărzi ca azi (pluginuri oprite, MCP fail-closed, `model/list`, garda de facturare);
     - verifică contul prin mediu (C16);
     - dă fiecărei rulări TMPDIR propriu în workspace;
  2. **verificarea porții `host_isolation = environment`**, legată de amprenta canary-ului și aprobată de proprietar;
  3. **o probă live** pe un proiect hub-test prin `wsl-runner`.
- **Revenire:** `wsl -d ifrim-runner -- codex logout`, apoi `wsl --unregister ifrim-runner`.

## 5. Constatări din probele live (utile pentru următorul prompt)

1. **Sandbox-ul Windows e rece după repornirea PC-ului:** prima comandă durează ~145 s, următoarele ~2,7 s. Un writer își poate abandona comenzile și întoarce un change set gol. Corectura „Reia relansează implementarea” e făcută (M03-FAC-28). Încălzirea sandbox-ului la pornirea Hub-ului încă nu e făcută.
2. **Latența Stop:** 11,2 s de la cerere până la oprirea execuției, deoarece Codex își închide turnul activ. Funcționează, dar se poate măsura și îmbunătăți.
3. **Lega din panoul de browser al aplicației Claude** s-a închis cu „closed: error” la 5 s, iar grantul s-a consumat. Din Chrome a mers. UI-ul nu arată motivul real al erorii.
4. **Loginul ChatGPT cu cod de dispozitiv** a dat 503. A mers loginul prin browser, cu redirecționarea localhost Windows → WSL.
5. **Transcrierea vocală** a auzit „Factory D-Mobi” în loc de „Demo B”. Lega a găsit totuși proiectul corect prin `list_projects`.
6. **Diff-ul afișat de Hub** avea un rând gol fantomă la fișierele noi. E reparat (M03-DIFF-02) și intră la repornire.
7. **Recenzorul Claude** a dat o constatare greșită (F-003 pe Demo B), infirmată de verificarea independentă. Verificarea în mai mulți pași e utilă înainte de acceptări.

## 6. Decizii deschise ale proprietarului

- Pachetul Demo B: accept sau reject.
- Push-ul commit-urilor locale și merge-ul în `main`, dacă nu sunt deja făcute.
- Commit în proiectele demo (opțional).
- R2: aprobarea milestone-ului `wsl-runner` (cod + teste + schimbarea porții + probă live).
- Vânzări: catalogul de servicii real; un fișier real de firme (temei legal, retenție); research live; outreach. Fiecare cere autorizare separată.

## 7. Propunere pentru următorul milestone (M05)

**Recomandat: M05 = închiderea R2 (`wsl-runner`) + robustețea execuțiilor live.** Deblochează lucrul pe proiecte reale ale clienților, adică ținta de business.

1. Suprafața `wsl-runner`:
   - pornire, copierea workspace-ului și export patch;
   - profilurile Linux, gărzile existente, verificarea contului prin mediu;
   - selecția mediului per proiect, implicit `ifrim-runner` pentru proiectele reale.
2. **Verificarea porții `host_isolation = environment`** legată de amprenta mediului. Orice schimbare a mediului invalidează canary-ul.
3. **Canary-ul complet** C1–C17, plus C14 (validatorul de export) și C16 (contul prin `wsl-runner`), ca teste automate unde se poate.
4. **Încălzirea sandbox-ului** la pornire sau înaintea primului writer, plus timing-ul raportat în cronologie.
5. **Latența Stop:** măsurare și îmbunătățire.
6. **Lega:** motivul real al erorii vizibil în UI, plus o verificare a microfonului înainte de a consuma grantul.
7. **Probe live** pe un proiect hub-test prin `wsl-runner`: Codex RW prin factory, Stop și review, cu aprobarea proprietarului.
8. Abia apoi primul proiect real, ales de proprietar, cu backup și aprobare explicită.

**Alternative**, dacă prioritatea e vânzarea:
- M05 = Vânzări cu date reale: catalogul real, importul listei proprietarului cu temei legal și retenție, research live aprobat pe surse și volum, propuneri scrise de AI pe ruta abonamentului;
- outreach-ul rămâne dezactivat până la o decizie legală.

## 8. Reguli de păstrat în următorul prompt

- Fără model, LIVE_VALIDATION, granturi, commit, push sau deploy fără aprobarea explicită a proprietarului pentru acțiunea exactă. Push-ul îl face proprietarul.
- Gărzile de facturare și izolarea MCP nu se slăbesc: doar abonament, Fable și `[1m]` refuzate pentru Claude, pluginuri oprite.
- Nu se citesc `.ifrim/private`, `.env`, `~/.codex`, `~/.claude` sau backupurile. Nu se copiază `auth.json` între medii.
- Deciziile factory (start, accept, reject) și aprobările rămân clicuri ale proprietarului în UI. Clasificatorul de siguranță al sesiunii refuză ca agentul să le dea în numele proprietarului.
- Vânzări: nimic trimis, nimic colectat live, nimic inventat (prețuri, termene, clienți) fără autorizare separată.
