# M04 — Raport: Vânzări & lead generation

Versiune `2.5.0-m04` · 2026-10-01 · Niveluri atinse: **BUILD_READY + SIMULATED_SALES_FLOW_VERIFIED**

Pe scurt: Hub-ul are acum un departament de Vânzări funcțional local, verificat cap-coadă doar pe date sintetice. Nu a contactat nicio firmă, nu a colectat nimic de pe internet și nu a rulat niciun model. Nu e un departament care vinde deja: e circuitul intern, cu dovezi și cu deciziile tale la fiecare pas spre exterior.

## A. Baseline Git/runtime și munca nouă

- **Git:**
  - Branch `v2-milestone-01`, HEAD `3c5d202`, împins de tine. `main` e tot `e9ab563`.
  - Munca M04 e **comisă local** ca `2301dcd`: 22 de fișiere existente modificate, plus fișiere noi (`v2/server/sales/`, `v2/fixtures/sales/`, 10 fișiere de test `m04-*`, ecranul Vânzări, documentele `.ifrim/M04_*` și `M03_CLOSURE_PACKAGES.md`).
  - Commit-ul l-am făcut pe baza permisiunii tale generale din conversație („îți permit tot ce interzice promptul”).
  - Actualizările de documentație de după commit (care consemnează commit-ul, repornirea și cifrele finale) sunt **necomise**. Al doilea commit a fost refuzat de clasificatorul de siguranță al sesiunii; îl faci tu.
  - **Nu am făcut push, merge sau deploy.** Push-ul îl faci tu: `git push origin v2-milestone-01`.
- **Hub-ul live (8011):**
  - Înainte: `2.4.0-m03`, pid 23532, LIVE_VALIDATION, poarta deschisă (setate de tine). Inactiv: 0 rulări active, 0 granturi active (toate expirate sau epuizate), sesiunea Lega încheiată la 15:47 UTC.
  - Pașii repornirii:
    1. Migrarea 4 probată pe o copie a bazei (`migration-on-copy.mjs`): 3 → 4, integritate ok, 0 încălcări FK, 20 de tabele noi, niciun rând pierdut. Copia a fost ștearsă.
    2. Backup verificat `bkp_mups0uoj_cd6d3f5269`: `hub-v2` și `hub-v1` sqlite ok, 511 fișiere, 0 omise, restaurare verificată.
    3. Oprire grațioasă, fără `--force`.
    4. Pornire pe **`2.5.0-m04`** (pid 22644), cu migrarea 4 aplicată.
  - **Efect de reținut:** Hub-ul pornește mereu în **BUILD_SAFE**, deci LIVE_VALIDATION nu mai e activ. Poarta a rămas „open”, dar BUILD_SAFE blochează inferența. Pentru proba 2.3 trebuie să repui tu LIVE_VALIDATION.
- **Simulatorul (8012):** pornit de mine pentru capturi (pid 13792), cu date sintetice. Îl oprești cu `npm run v2:sim:stop`.

## B. Demo A

Bundle-ul `bnd_mupj3diq_d386324921` e tot **READY_FOR_OWNER_ACCEPTANCE** (misiunea `mis_muph73y3_9c2c87061c`). Nu l-am acceptat și nu l-am atins. Dovezile istorice (2.1 și 2.2 PASS_LIVE) rămân cele din `M03_REPORT.md`.

## C. Probele 2.3, 2.5 și 2.6

| Probă | Stare (fapte) |
|---|---|
| 2.3 Demo B | **BLOCKED**. Misiunea `mis_mupj3zl4_9970bdd58b`; rularea `run_mupoq32y_ada25635d1` a fost oprită la poartă la 15:24 UTC (modul era BUILD_SAFE atunci). Nu am relansat-o. Pachetul complet e în `M03_CLOSURE_PACKAGES.md` |
| 2.5 Stop în timpul unui turn real | **NOT_RUN**, pachet pregătit |
| 2.6 Lega propune o misiune de engineering | **NOT_RUN** ca probă. Notă: în sesiunea ta Lega (15:27–15:47 UTC) a apărut o misiune DRAFT „AROBS — prospect pentru vânzarea Ifrim Agent Hub” (`mis_muppcs5g_f67355777c`). E acțiunea ta; nu o clasific drept 2.6 |

## D. R2: izolarea mediului de execuție

- **Ce lipsește:** sandbox-ul Codex pe Windows poate citi tot hostul în afara căilor interzise. Admiterea doar pe proiecte de test e o limitare, nu izolare.
- **Faptele mașinii:**
  - Windows 11 **Home**, deci fără Hyper-V și fără Windows Sandbox;
  - WSL 2.7.3, cu distribuțiile Ubuntu și docker-desktop.
- **Recomandarea** (`M04_R2_ISOLATION_OPTIONS.md`): o distribuție WSL2 dedicată, `ifrim-runner`, cu:
  - discurile hostului nemontate și interop Windows oprit;
  - un utilizator fără root;
  - login Codex propriu;
  - un profil de permisiuni `:root=deny`;
  - workspace-ul copiat, nu montat; rezultatul iese ca patch verificat pe Windows.
- **Limita onestă:** toate distribuțiile WSL împart același kernel. E izolare de tip container, nu VM separată.
- **Aprobări necesare:** instalarea și configurarea distribuției (componentă de sistem), loginul tău în ea, apoi planul canary pe fișiere fictive.
- **Stare:** nimic instalat. **R2 rămâne deschis.**

## E. M04: ce s-a construit și cum s-a verificat

**Funcții** (detalii în `M04_IMPLEMENTATION_STATUS.md`, `M04_SALES_ARCHITECTURE.md`, `M04_DATA_PROVENANCE.md`, `M04_CONTACT_POLICY.md`):

- **Import CSV/XLSX** fără dependențe noi:
  - mapare, previzualizare fără scrieri, raport pe rând;
  - tranșe idempotente și reluabile; același fișier deschide același lot;
  - rollback pe lot care arhivează, nu șterge, și păstrează firmele editate între timp.
- **Identitate:**
  - CUI verificat cu cifra de control;
  - domenii de identitate separate de rețele sociale și marketplace-uri;
  - potriviri cu motive și conflicte; coada „De revizuit” pentru ambiguități;
  - aliasuri și unire reversibilă. CUI-uri valide diferite nu se unesc niciodată.
- **Proveniență:**
  - fiecare valoare are o dovadă: etichetă, sursă, dată, fragment, metodă;
  - stările CURRENT, NEEDS_RECHECK, SUPERSEDED, ROLLED_BACK, plus contradicții păstrate.
- **Audit de site** doar pe fixture-uri `.test`:
  - 14 verificări cu selector și fragment;
  - textul paginii e tratat ca dată (testat cu prompt injection);
  - colectarea live e refuzată (`LIVE_COLLECTION_DISABLED`);
  - colectorul viitor are validarea anti-SSRF gata.
- **Calificare** deterministă `q-v1`, explicabilă: necunoscut ≠ 0, override cu motiv și istoric.
- **CRM** cu tranziții validate. APPROVED_INTERNAL, CONTACTED și WON vin doar din evenimente. DO_NOT_CONTACT se aplică imediat, la reimport și pe firmele unite.
- **Propuneri versionate:**
  - prețul apare doar dacă e configurat; altfel „De stabilit”;
  - „Observații” conțin doar problemele observate, cu sursă.
- **Ciorne de e-mail:**
  - doar din ultima propunere aprobată;
  - aprobare legată de hash;
  - **trimiterea e dezactivată** (`OUTREACH_DISABLED`).
- **Follow-up-uri locale:** scheduler-ul doar marchează DUE/EXPIRED; nu trimite nimic.
- **Hand-off:** acceptarea clientului (cu textul exact) duce la o misiune Software Factory în SPEC_DRAFT. Fără grant, fără rulare, idempotent; propunerea schimbată după predare marchează hand-off-ul ca depășit.
- **UI:** ecranul **Vânzări** în JARVIS (Prezentare, Importuri, Firme, Fișă firmă, Pipeline, Oportunitate, Follow-up, Servicii), utilizabil la 360/390 px.
- **Lega:** unelte de rezumat (pipeline, firmă, ciorne), fără e-mailuri sau telefoane. Din voce se poate doar marca o firmă „nu contacta”.
- **Simulator:** butonul „Vânzări” încarcă un set sintetic complet.

**Teste** (`M04_TEST_REPORT.md`):

- **139 de teste M04**, toate PASS: scenariile A–H plus proveniență și simulator. PASS_SIMULATED / PASS_LOCAL.
- **E2E în Chromium real:** fluxul complet, rollback, 360 px.
- **Revizie adversarială** făcută de un agent separat: **15 probleme reale**, dintre care 4 HIGH (DO_NOT_CONTACT ocolit prin domeniu sau unire, WON fără contact, dublă trimitere).
  - Toate sunt reparate și au teste de regresie.
  - 4 dintre corecturi au fost verificate prin mutație.
  - Una era o problemă veche în bus-ul de evenimente (evenimente livrate înainte de COMMIT), reparată în nucleu.
- **Suita V2 completă** (`npm run test:v2`, rularea finală): **448 de teste, 447 PASS, 0 FAIL, 1 SKIPPED_ENV** (symlink fără privilegiu Windows). Ultima corectură a intrat în timpul rulării, așa că am reluat fișierele care o ating (`m02-ui-logic`, `m03-review-fixes` și toate `m04-*`): **158/158 PASS**.
- **Suita V1:** 552 de teste, 551 PASS, 0 FAIL, 1 SKIPPED_ENV. Cele 3 timeout-uri din baseline nu au apărut acum; V1 nu a fost modificat.

**Capturi:** 8 ecrane din simulator, cu date sintetice marcate (1280 px și 390 px), fără scroll orizontal. Le-am trimis în conversație. Nu sunt salvate în repo.

**Usage:**

- **Hub:** 0 rulări de model, 0 tokeni de inferență; voce nefolosită de mine.
- **Agenții Claude Code din această sesiune**, după contorul harness-ului:
  - workflow-ul de construcție: ~1,43 M tokeni;
  - agentul UI: ~0,49 M;
  - agentul de revizie: ~0,29 M.
- Consumul sesiunii principale nu e măsurat aici: **UNKNOWN**.

**Limitări:**

- **Audit:** doar HTML static al unei pagini (fără viteză, contrast sau tastatură).
- **XLSX:** fără ZIP64, `.xls`, `.xlsb`, `.ods`.
- **Identitate:** același nume în alt oraș merge la revizie, nu se creează automat.
- **Trimiteri blocate:** un `ATTEMPTED` rămas după o cădere blochează retrimiterea, fiindcă nu se știe dacă a plecat.
- **Lipsă din UI:** unirea de firme, corecturile manuale, dovezile adăugate manual și profilul firmei tale. API-ul există.

## F. Cum îl folosești local

1. **Simulator** (date fictive, fără riscuri):
   - `npm run v2:sim`, apoi deschide http://127.0.0.1:8012/ și apasă „Vânzări” în bannerul SIMULARE;
   - sau Vânzări → Importuri → încarcă `v2/fixtures/sales/imports/firme-mici.csv` și bifează „Date sintetice” → mapare → previzualizare → confirmare.
2. **Fișă firmă:**
   - „Audit nou (fixture)”, care merge doar pe domenii `.test`;
   - vezi dovezile și calificarea.
3. **Oportunitate:**
   1. „Oportunitate nouă” → „Versiune nouă” a propunerii → „Marchează gata de revizuire”.
   2. Aprobi propunerea din cardul de aprobare.
   3. „Pregătește o ciornă”, apoi aprobi conținutul. **Trimite rămâne dezactivat.**
4. **Contact și acceptare:**
   - după ce ai vorbit cu firma în afara Hub-ului, scrii exact „Confirm că am contactat această firmă în afara Hub-ului”;
   - la acceptarea clientului, scrii exact „Confirm că clientul a acceptat această propunere”.
5. **Hand-off:** alegi proiectul → „Creează misiunea” → Misiuni. Spec-ul e în SPEC_DRAFT și nimic nu rulează până nu aprobi scope-ul acolo.
6. **Pe Hub-ul real:** completează întâi **Catalogul de servicii** (Vânzări → Servicii). E gol intenționat, pentru că în proiect nu există servicii confirmate.

## G. Ce cere o autorizare viitoare

- **Inferență pentru Vânzări** (propuneri și ciorne scrise de AI): o rută compatibilă cu abonamentul și cu izolarea.
- **Research live:** surse și domenii, volum, durată, metode, ce date se păstrează, condiții de oprire. Grantul Demo A nu se folosește.
- **Date reale de clienți:**
  - importul unui fișier real (lista istorică de ~3.700 de firme nu a fost găsită în scope);
  - reguli de retenție și ștergere;
  - temeiul legal.
- **Contacte externe:**
  - configurarea unui canal (Gmail, SMTP);
  - verificarea cerințelor legale din surse actuale;
  - mecanism de dezabonare;
  - activarea explicită a trimiterii.
- **Integrarea proiectelor clientului** în Software Factory: după R2, cu un mediu izolat.
- Commit-ul documentației rămase și **push-ul** (le faci tu), merge-ul în `main` și **decizia OWNER_ACCEPTED**.
