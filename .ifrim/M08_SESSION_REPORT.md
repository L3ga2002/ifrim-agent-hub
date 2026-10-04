# M08: raportul sesiunii (2026-10-03)

**Pentru cine scrie promptul următor.** Ce s-a făcut, ce rulează acum, ce e deschis și ce rămâne decizia proprietarului.

- Orele sunt UTC; în România e UTC+3.
- Sursa: `git`, API-ul Hub-ului live (`localhost:8011`, doar citiri) și codul.
- Verificare: înainte de predare, raportul a fost verificat de 5 agenți independenți, read-only, iar corecturile lor au fost reverificate direct.
- **Unde se contrazice cu `CLAUDE.md`, `OPUS_HANDOFF.md`, `OPEN_ISSUES.md`, `M08_REPORT.md` sau `M08_LIVE_PILOT_PLAN.md`, acest raport are prioritate**: acelea descriu în parte starea de dinainte de pilot.

---

## 0. Pe scurt

| | Stare |
|---|---|
| **M08 (cod)** | `2.9.0-m08`, contract API 8, migrația 8. Comis `8b277c5` + docs `ae3aa48` pe `v2-milestone-01`. |
| **GitHub** | `origin/v2-milestone-01` = `ae3aa48` (push făcut de proprietar la 18:23 UTC). **`origin/main` e încă `17921ac` (M07)**: o sesiune care pornește din `main` nu vede M08. |
| **Acest raport** | `.ifrim/M08_SESSION_REPORT.md` **nu e comis**. O sesiune în cloud îl vede doar după commit și push. |
| **Hub-ul live** | `2.9.0-m08`, BUILD_SAFE, rulează pe `http://localhost:8011` (pid 5764). Nu are granturi active și nu rulează niciun model. |
| **Datele V2** | Mutate în afara OneDrive, în `C:\Users\mihai\IfrimHub\hub-data` (A1). |
| **Profilul vocal** | Accesul e restrâns la contul proprietarului și SYSTEM (A2). |
| **Pilotul ProDelivery** | A rulat real, cap-coadă, în ~6 minute, și a ajuns la **DELIVERY_READY**. Pachetul `bnd_musqo7xj_1a204a2e55` **așteaptă decizia proprietarului**. Review PASS, dar cu o observație medie (F-001): o schimbare de comportament în calculul scorului. |
| **Abatere de corectat** | Pachetul B promitea review cu **Claude sonnet**. Planul nu a fixat modelul, așa că review-ul a rulat pe modelul implicit al contului, **`claude-opus-5-5`** (§5.3). |
| **Pachete istorice** | D6 `bnd_murl82o1_00afe726c3` și Demo B `bnd_mupwze7b_e03f70f2d7` așteaptă în continuare. Nu au fost atinse. |

---

## 1. Ce conține M08

Zece funcții, construite peste baza de date, memoria, magistrala de comenzi și „envelope”-urile existente (planuri confirmate o singură dată, cu granturi derivate intern):

1. **Digital Twin:** relații cu sursă (OBSERVED / DECLARED / HYPOTHESIS), „de ce e blocat”, „ce s-a schimbat de ieri”, impactul unei schimbări, „de ce am ales”.
2. **War Room:** un raport deschide un incident PROPUS; ce spune un model rămâne ipoteză; RESOLVED cere dovadă confirmată; remedierea e o ciornă BUGFIX.
3. **Project Autopilot:** obiective finite cu sarcini dependente, sub **o singură** confirmare (nivel TRUSTED). Se opresc la DELIVERY_READY și nu au drept de reluare. Un obiectiv modificat înlocuiește planul vechi.
4. **Ședința (board):** agendă deterministă; decizii doar cu sesiunea proprietarului; punctele amânate se reportează.
5. **Simulare:** model determinist de capacitate; dă INSUFFICIENT_DATA în loc de cifre inventate.
6. **Liga agenților:** nu desemnează un câștigător fără dovezi suficiente.
7. **Evoluția skill-urilor:** propunere → evaluare → aprobare → activare limitată → revenire. Limita actuală: corpul skill-urilor nu intră în prompturi, deci se gestionează doar versiunile.
8. **Teach Lega:** lecții doar din cuvintele proprietarului, confirmate în memorie. Lărgirile de securitate nu devin niciodată reguli.
9. **Zero-Menu:** ecran complet, ecran de pornire, intenții noi, fereastră vocală armată de 90 s.
10. **Telefon (`#/m`):** asociere proprie, revocabilă; doar vizualizare și opriri fail-safe.

Tot în M08:
- **pachetele de decizie A** (protecția datelor) **și B** (pilotul ProDelivery);
- scripturile `v2/scripts/relocate-data.mjs` și `v2/scripts/voice-acl.ps1`;
- `v2/server/intel/pilot-acceptance.mjs`, testul de acceptanță independent al pilotului.

Codul nou e în `v2/server/intel/` și în UI (`screens/Intel.jsx`, `screens/intel/*`, `screens/Mobile.jsx`, `screens/lega/IntelCard.jsx`). Documentele: `.ifrim/M08_*.md`.

---

## 2. Revizuire și teste înainte de commit

**Două runde de revizuire adversarială read-only:** 24 de agenți, apoi 5. Fiecare constatare a fost verificată separat: 16 defecte confirmate în runda 1, plus cazuri-limită noi în runda 2 (aproximativ 20, după mesajul de commit). Toate au fost reparate, cu regresii în `v2/tests/m08-review-fixes.test.mjs` (RF-01…RF-16). Cele mai importante:
- o sarcină respinsă nu oprea sarcina dependentă;
- „uită” ștergea reguli fără confirmare;
- fereastra vocală armată nu se deschidea prin HTTP;
- `factory.prepare` refuza canalul `owner`;
- `python3 -m unittest` nu putea rula, așa că B4 nu pregătea nimic. Pilotul a fost reproiectat în jurul unui test de acceptanță independent.
- rollback-ul mutării ignora WAL-ul SQLite;
- lipsea garda pentru module Python care umbresc biblioteca standard (acum `stdlib_shadowed`, critică).

**Teste:**

| Ce | Rezultat |
|---|---|
| Teste M08 noi | 54 (38 + 16 RF), toate trec |
| Mutanți pe gărzile cheie | 7/7 omorâți |
| V2 complet (cu UI-ul M08) | **650 de teste: 649 trec, 0 pică, 1 sărit** (T25, cere privilegiul Windows de simlink) |
| V1 | 551 din 552 trec. 1 test sărit (alt test, dar același motiv: privilegiul de simlink) |

---

## 3. Upgrade-ul live și pachetul A (făcute de Claude, la cererea proprietarului: „fă tu”)

1. **Commit** `8b277c5` (16:24 UTC). Push-ul încercat de Claude a fost refuzat de stratul de permisiuni al sesiunii și nu a fost reîncercat; proprietarul a făcut push-ul după aceea.
2. **Oprirea Hub-ului.** Înainte: 0 granturi, 0 rulări, 0 procese supravegheate.
3. **A1, mutarea datelor:** `relocate-data.mjs --apply --to C:\Users\mihai\IfrimHub\hub-data`.
   - Baza: integritate ok, 100 de tabele, 5.935 de rânduri, sha256 `bb0ee89f…0153`.
   - Fișiere verificate cu sha256: 120 de backup-uri (186 MB) și 175 de fișiere de lucru.
   - 34 de căi salvate rescrise.
   - Pe noul folder au acces doar proprietarul și SYSTEM.
   - Pointerul `.ifrim/data-location.json` e ignorat de git. Folderul vechi `.ifrim/private` are `V2_MOVED.json`.
   - **V1 rămâne în `.ifrim/private`.**
4. **A2, ACL-ul profilului vocal:** `voice-acl.ps1 -Apply` + `-Verify` pe `C:\Users\mihai\IfrimHub\voice\profiles`.
   - Au rămas doar SYSTEM și proprietarul; citirea `CodexSandboxUsers` a fost eliminată.
   - Nu s-au adăugat reguli DENY.
   - ACL-ul vechi e salvat în `profiles.acl-backup.txt`.
5. **Build și dry-run:** `npm run build:v2`. Dry-run-ul migrației pe baza mutată: 7 → 8, integritate ok, număr de rânduri neschimbat.
6. **Pornirea:** `start-detached.ps1` → `2.9.0-m08`, BUILD_SAFE, migrația 8 aplicată (16:26 UTC).
7. **A3:** nu s-a șters nimic. Copiile vechi locale (`.ifrim/private`, `.ifrim/BACKUPS/v2`, `.ifrim/tmp/v2`) și copiile din cloud-ul OneDrive rămân, inclusiv baza veche cu istoricul confirmărilor vocale.
8. **Revenire:** cu Hub-ul oprit, rulezi `relocate-data.mjs --rollback --copy-back`. Baza nouă s-a schimbat după mutare (pilot, decizii), deci un `--rollback` simplu e refuzat, iar `--discard-new` ar pierde pilotul și deciziile. Pentru ACL: `voice-acl.ps1 -Rollback`.

**Incident, 18:19:59 UTC.** Windows a repornit și Hub-ul s-a oprit odată cu el; jurnalul nu are linie de oprire, deci nu a fost o eroare a Hub-ului. Claude a verificat baza (`quick_check` ok, schema 8, 0 granturi) și a repornit Hub-ul (18:25 UTC); recuperarea nu a avut nimic de reluat.
- **Hub-ul V2 nu pornește singur la logare.** După un restart: dublu-click pe `Ifrim Hub V2.cmd` din folderul Ifrim Agent Hub (sau `powershell -ExecutionPolicy Bypass -File v2\scripts\start-detached.ps1`). Apoi `http://localhost:8011/#/lega`, deblocare cu Windows Hello și, dacă e nevoie, pornirea vocii din UI.
- Hub-ul pornește mereu în BUILD_SAFE și nu reia nimic singur.
- **OpenClaw:** după restart, gateway-ul global (18789) nu ascultă. Proprietarul l-a mai oprit intenționat în trecut. Hub-ul V2 nu depinde de el, deci nu e o defecțiune. Pornirea lui e decizia proprietarului.

---

## 4. Ce a făcut proprietarul în UI (18:29–18:36 UTC)

| Ora | Acțiune |
|---|---|
| 18:29:02 | A reconfirmat izolarea R3 pe noile căi (amprenta `0b85ddbd40f8b446`). |
| 18:30:31 | **Pachetul A decis:** A1 și A2 apar EXECUTED (citite din realitate); A3 aprobat (doar recunoaștere). |
| 18:30:45 | **Pachetul B decis** (detaliile mai jos). |
| 18:36:31 | **Planul confirmat** prin click, cu sesiunea Windows Hello (`env_musqgtr6_dbbf39dbbe`, nivel ASSISTED). Hub-ul a trecut din BUILD_SAFE în LIVE_VALIDATION pe durata misiunii. |

Ce a aplicat pachetul B:
- **B1:** ruta `wsl-runner` pentru ProDelivery;
- **B2:** autonomie ASSISTED;
- **B3:** comanda `python3 -m unittest` permisă;
- **B4:** testul de acceptanță scris în proiect și misiunea `mis_musq9hl4_1e9726b3fd` creată.

---

## 5. Pilotul ProDelivery: rezultatul

**Misiunea:** „Teste unitare pentru clasamentul curierilor (driver_ranking) și remedierea problemelor găsite”.
- Tip FEATURE, profil BALANCED, limită de 45 de minute.
- Planul confirmat (ASSISTED) nu permitea nicio remediere fără o nouă confirmare. Limita misiunii era de 1 ciclu, cea a planului de 0.
- Tot pipeline-ul a rulat în `ifrim-runner` (WSL).

### 5.1 Etape

| Ora (UTC) | Etapă | Rezultat |
|---|---|---|
| 18:36:43 | Baseline: testul de acceptanță înainte de modificare | **0/3**, cum trebuia (suita unitară nu exista) |
| 18:36:48 → ~18:40 | Writer: Codex `gpt-6.1-sol`, efort medium | Change set 1, fără probleme de integritate |
| 18:40:33 | Verificări: `python3 -m unittest` pe suita nouă | **27/27 PASS** |
| 18:40:33 → ~18:42 | Review: Claude `claude-opus-5-5`, efort medium, doar citire | **PASS**, cu 5 observații |
| 18:42:13 | QA: testul de acceptanță | **3/3 PASS** |
| 18:42:13 | Livrare | **DELIVERY_READY**, pachetul `bnd_musqo7xj_1a204a2e55` |

**După misiune:**
- planul e COMPLETED;
- cele două granturi derivate au folosit fiecare 1 din 2 încercări și sunt revocate;
- Hub-ul a revenit singur în BUILD_SAFE;
- nu au rămas procese AI. Singurul proces supravegheat e motorul vocal local (whisper.cpp + CAM++), pornit la 18:32 din UI.

### 5.2 Ce s-a schimbat în ProDelivery

Fabrica a aplicat change set-ul **direct în folderul de lucru real** `C:\Users\mihai\OneDrive\Desktop\Ifrim Digital Proiecte\ProDelivery`. Nu s-a făcut niciun commit.

| Fișier | Modificare |
|---|---|
| `backend/tests/test_driver_ranking_unit.py` | nou, +343 de linii (27 de teste) |
| `backend/utils/driver_ranking.py` | **+3 / −1** (cod de producție) |
| `backend/tests/acceptance/test_driver_ranking_acceptance.py` | nou, scris de B4 înainte de misiune |
| `.ifrim/BACKUPS/v2/…bkp_musqh5hy_7dd0d21d67.zip` (+ manifest) | backup verificat, făcut automat înainte de rularea writer-ului (~5 MB). E ignorat de git-ul ProDelivery, dar e sincronizat în OneDrive. |

- **Verificat:** diferența lui `driver_ranking.py` față de HEAD e exact cele 4 linii ale writer-ului. Proprietarul nu avea alte modificări în acest fișier.
- ProDelivery are alte ~18 fișiere modificate necomise ale proprietarului (de exemplu `routers/orders.py`, `stats.py`, `models/order.py`, fișiere `.ifrim/`). Hub-ul nu le-a modificat.
- **Atenție:** pipeline-ul a copiat întreg arborele de lucru, inclusiv aceste modificări, în mediul izolat din WSL, și l-a salvat în backup.

**Observațiile review-ului** (toate deschise):
- **F-001 (medie), `fnd_musqo6mo_45dd614ca3`, `calculate_driver_score`.**
  - Ce s-a schimbat: înainte, `punctuality_rate = 0` era înlocuit cu 0.85. Acum 0 contează ca 0, iar 0.85 se aplică doar pentru `None`, șirul gol sau câmp lipsă.
  - Efectul: un curier cu 0 pierde 12,75 puncte și poate coborî de tier, deci și ora la care își alege programul.
  - Riscul: dacă 0 înseamnă „încă nemăsurat”, e o regresie.
  - Criteriul AC-3 al pilotului cere ca remedierile să nu schimbe contractul public al funcțiilor. F-001 e la limita acestui criteriu, deși review-ul a dat PASS. **Cere decizia proprietarului.**
- **F-002 (mică):** `_safe_parse_iso` presupune că primește un string. O dată BSON din MongoDB ar arunca `TypeError`. Riscul e ipotetic.
- **F-003 (mică):** testul de schimbare a orei (DST) de primăvară folosește o oră care nu există în acea zi.
- **F-004 (info):** un test fixează un comportament ciudat: `get_next_tier_for_score(-1)` întoarce `start`.
- **F-005 (info):** review-ul a văzut doar suita unitară. Testul de acceptanță a rulat după aceea, în QA, cu 3/3 PASS.

### 5.3 Abatere de la pachetul aprobat (defect M08, de reparat)

- **Ce promitea pachetul B (B4):** writer Codex `gpt-6.1-sol · medium` și reviewer **Claude `sonnet · medium`**.
- **Ce s-a întâmplat:**
  - `preparePilot` (`v2/server/intel/intel-commands.mjs`) transmite către `factory.prepare` doar limitele, nu și modelele;
  - planul a pornit cu `requestedModel` gol;
  - reviewer-ul a primit modelul implicit al contului Claude Code: **`claude-opus-5-5`**;
  - writer-ul a primit tot modelul implicit al contului, care din întâmplare era chiar `gpt-6.1-sol`.
- **Efect:** opus consumă mai mult din limita săptămânală decât sonnet.
- **Reparație propusă:** pilotul (și orice pachet care numește modele) trebuie să fixeze explicit modelul și efortul pentru writer și reviewer. Planul afișat la confirmare trebuie să arate exact aceste modele, iar o neconcordanță trebuie să blocheze confirmarea.

### 5.4 Ce înseamnă deciziile pe pachet

- **„Acceptă”:**
  - face întâi un snapshot nou al proiectului. Dacă ceva din zona testată s-a schimbat între timp, acceptarea e refuzată și pachetul devine STALE. **Nu edita ProDelivery înainte să decizi.**
  - apoi înregistrează OWNER_ACCEPTED. Commit, push și deploy rămân acțiuni separate.
  - un commit în ProDelivery trebuie să ia doar fișierele pilotului (`git add <fișier>`), nu tot.
- **„Respinge”:**
  - doar marchează misiunea REJECTED și **nu readuce fișierele**.
  - revenirea manuală e sigură: `git checkout -- backend/utils/driver_ranking.py` anulează doar modificarea writer-ului. Cele două fișiere de test noi se șterg separat, dacă vrei.
  - Hub-ul păstrează și backup-ul de dinainte și snapshot-ul de bază.
- **Unde vezi diferența:**
  - în Misiuni → misiunea → „Change set-uri (1)” → „Arată diff”;
  - sau în cockpit (`#/lega`), cardul „Ce s-a schimbat”.

---

## 6. Ce NU s-a făcut (constrângeri respectate)

- Nu s-a acceptat sau respins niciun pachet: nici D6, nici Demo B, nici pilotul.
- V1 (3004/8004), OpenClaw, WSL și taskurile programate nu au fost oprite sau modificate.
- Nu s-a șters nicio copie veche, nici locală, nici din OneDrive.
- Nu s-au refolosit granturile M07. Singurele inferențe M08 au fost cele două ale pilotului, pornite de confirmarea proprietarului.
- Nu s-au simulat clicuri, Windows Hello sau vocea proprietarului.
- Nu s-a reîncercat push-ul refuzat pe alt canal.
- Gărzile de facturare nu au fost slăbite. Modelele Fable sunt refuzate în continuare.
- Singura abatere: modelul reviewer-ului (§5.3).

---

## 7. Deschis / de decis

### 7.1 Decizii ale proprietarului

1. **Pilotul `bnd_musqo7xj_1a204a2e55`:** citește diferența, decide F-001 (păstrează sau revino la vechiul 0.85 pentru 0), apoi acceptă sau respinge. O corectură a lui F-001 poate fi o misiune BUGFIX nouă, de o linie.
2. **D6** (`mis_murhhvkm_f4d5af365c` / `bnd_murl82o1_00afe726c3`) și **Demo B** (`mis_mupj3zl4_9970bdd58b` / `bnd_mupwze7b_e03f70f2d7`): în așteptare. Ciorna `mis_mupy0no5_922d2614b0` e încă SPEC_DRAFT.
3. **`main` pe GitHub e la M07.** Fie se aduce `main` la `v2-milestone-01` (fast-forward posibil), fie sesiunile următoare pornesc explicit din `v2-milestone-01`.
4. **Ce rămâne pornit după pilot:**
   - ProDelivery pe autonomie ASSISTED și ruta `wsl-runner`;
   - comanda `python-unittest` permisă;
   - politica `voice_first`.

   O singură confirmare de plan pornește din nou modele pe ProDelivery. Revenire, dacă vrei: autonomia înapoi pe OBSERVE și B3 dezactivat.
5. **Facturare și cei 100 $:**
   - Hub-ul are înregistrată declarația proprietarului din 2026-09-30: „usage credits (extra usage) sunt dezactivate”.
   - Dacă cei 100 $ sunt credite sau „extra usage” activate pe contul claude.ai, declarația nu mai e adevărată. Review-urile Claude pornite de Hub folosesc același cont și ar putea consuma din credite după ce se termină limita săptămânală (resetare marți, 6 oct, 03:00, ora afișată în aplicație).
   - Hub-ul verifică automat creditele doar la Codex, nu și la Claude.
   - Decizie necesară: fie nu porni misiuni în Hub cât timp creditele sunt active, fie actualizează declarația de facturare.
6. **Vocea live (VOICE_UX_VERIFIED):** neverificată cu vocea proprietarului. Filtrul vocal e oprit (`voiceGate.enabled: false`).
7. **Pornirea automată după reboot** (task programat Windows): nu există; e decizia proprietarului.
8. **A3:** ștergerea copiilor vechi (local și OneDrive), inclusiv backup-ul pilotului din `ProDelivery/.ifrim/BACKUPS`.
9. **Telefonul real (CROSS_DEVICE):** BLOCKED, pentru că Hub-ul ascultă doar pe 127.0.0.1.

### 7.2 Termene

- **Atestarea mediului** `att_murgupen_3459ee8157` (amprenta `8f9e9eeb934b6c01`, valabilă 14 zile) expiră în jur de **2026-10-16**. După expirare, orice misiune pe `wsl-runner`, inclusiv ProDelivery, e refuzată până la o nouă atestare (Sistem → Medii de execuție).
- Orice actualizare a Codex sau Claude în `ifrim-runner` schimbă amprenta: trebuie refăcută atestarea și reaprobată politica (b).

### 7.3 Tehnic (candidați pentru M09)

1. **Repararea §5.3:** modelele fixate explicit în planurile pachetelor și ale autopilotului, plus un test care confirmă că modelul afișat e cel folosit.
2. Actualizarea documentelor vechi (`CLAUDE.md`, `OPUS_HANDOFF.md`, `OPEN_ISSUES.md`, `M08_REPORT.md` §7) și comiterea acestui raport.
3. Din `OPEN_ISSUES.md`:
   - corpul skill-urilor nu intră în prompturi (decizie de produs);
   - `whisper-server` fără autentificare;
   - binarele din `ifrim-runner` deținute de `runner` (de mutat sub `/opt`; pas root al proprietarului);
   - două workspace-uri orfane în `ifrim-runner`;
   - cazul C14 pentru fișierele ignorate;
   - D8 (vocea live) nevalidat.
4. Conform raportului M08: R2 rămâne deschis pentru ruta Windows; proiectele reale merg pe `wsl-runner`.

### 7.4 Niveluri după pilot

| Nivel | Stare |
|---|---|
| BUILD_READY | DA |
| SIMULATED_INTEGRATION_VERIFIED | DA |
| PRIVACY_READINESS | executat local (A1 + A2); copiile din cloud rămân |
| LIVE_PROJECT_PILOT_VERIFIED | **atins tehnic**: DELIVERY_READY live pe ProDelivery |
| OWNER_ACCEPTED | în așteptare |
| VOICE_UX_VERIFIED | NU |
| CROSS_DEVICE_VERIFIED | BLOCKED |

---

## 8. Pentru sesiunea următoare

**Ordinea de citire:**
1. `CLAUDE.md`
2. **acest raport**
3. `.ifrim/M08_REPORT.md`
4. `.ifrim/OPEN_ISSUES.md` (secțiunea M08)
5. `.ifrim/M08_LIVE_PILOT_PLAN.md`
6. `.ifrim/RUNBOOK.md`

**Verificări la reluare** (doar citire):
- `git status` și `git log -3`;
- `node v2/scripts/status.mjs`;
- `GET /api/health`, `/api/factory`, `/api/grants`.

**Interdicții, chiar dacă par utile:**
- nu accepta și nu respinge pachete;
- nu confirma planuri și nu simula clicuri, Windows Hello sau vocea;
- nu folosi canalul `agent` pe proiecte reale;
- nu face commit în ProDelivery;
- nu șterge copiile A3;
- nu atinge V1 sau OpenClaw;
- nu porni modele, nu deschide execuția și nu face commit sau push fără aprobarea explicită pentru acea acțiune;
- nu slăbi gărzile de facturare.

---

## 9. Cloud sau PC

**Răspuns scurt: nu.** O sesiune Claude Code în cloud nu lucrează pe PC-ul proprietarului.

**Unde rulează:** pe o mașină virtuală Anthropic (Ubuntu), dintr-o clonă a repo-ului de pe GitHub, pe ramura aleasă. Vede doar ce e urcat acolo, plus `CLAUDE.md` din repo.

**Ce nu poate:**
- să pornească sau să oprească Hub-ul;
- să ruleze scripturile de pe PC;
- să citească baza din `hub-data`;
- să folosească WSL / `ifrim-runner`, Windows Hello sau vocea locală;
- să vadă folderul ProDelivery sau OneDrive;
- să citească memoria locală Claude (`~/.claude/...`).

**Excepție, cu rezervă:** aplicația desktop poate lega o sesiune din cloud de calculator pentru browserul din aplicație și controlul ecranului. Asta nu dă acces la terminal sau la fișiere. Iar regulile proiectului interzic oricum clicurile în locul proprietarului.

**Cum ajunge munca din cloud pe PC:**
1. Rezultatul ajunge doar pe o ramură în GitHub.
2. O sesiune **locală** descarcă ramura, o verifică și o unește în `v2-milestone-01`.
3. Rulează `npm run test:v2`, `migration-dry-run` și `npm run build:v2`.
4. Repornește Hub-ul.

Pe Linux, unele teste care depind de Windows sau WSL nu vor rula.

**Consum:** cloud-ul folosește aceeași limită de utilizare ca sesiunile locale; „extra usage” se plătește la tarife API (vezi §7.1.5).

**Recomandare:**
- lucrul pe Hub-ul live (upgrade, pilot, pachete, voce, acceptări, ACL-uri, reporniri) se face într-o **sesiune locală**, ca aceasta;
- cloud-ul e potrivit pentru lucru pur pe cod, pe ramura `v2-milestone-01`, nu pe `main`;
- pentru a controla o sesiune locală de pe web sau telefon există **Remote Control**: sesiunea rulează tot pe PC.

Surse: https://code.claude.com/docs/en/claude-code-on-the-web, https://code.claude.com/docs/en/cloud-environments, https://code.claude.com/docs/en/remote-control, https://code.claude.com/docs/en/costs
