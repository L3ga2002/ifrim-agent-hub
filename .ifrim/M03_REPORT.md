# Raport Milestone 03 — Software Factory și pregătirea execuțiilor

Data: 2026-10-01. Versiune: `2.4.0-m03`. Branch `v2-milestone-01`. Baza a fost `6432c5e`. Munca M03 e **comisă la cererea ta** (commit-ul de după `6432c5e`). Înainte de commit au rulat trei verificări cu mai mulți agenți (§9). `main` e neatins.
Raportul M01 + M02 + Lega rămâne în `M01_M02_REPORT.md`, cu limitările lui.

## 1. Pe scurt

- **Departamentul Engineering există:** o cerință devine specificație versionată → plan validat → implementare (un writer) → verificări → review independent → remediere limitată → QA → preview → pachet de livrare → decizia ta.
- **Hub-ul conduce pașii singur după un singur click al tău** (aprobarea scope-ului). Rămân la tine: granturile, acceptarea, ciclurile în plus și orice abatere.
- **Nivel atins: BUILD_READY + SIMULATED_E2E_VERIFIED.** Demonstrațiile A, B și C trec complet cu provideri falși.
  - **LIVE_SANDBOX_VALIDATED: NOT_RUN.** N-am pornit niciun model.
  - **REAL_PROJECT_READY: NU.** R2 e încă deschis.
- **Cele ~8 minute:** Hub-ul ia 4–7 s. Restul e între trimiterea turnului și prima comandă.
  - Sandbox-ul singur, măsurat fără model pe un profil fictiv: ~4–6 s pe comandă, nu minute.
  - Cauza probabilă rămâne raționamentul la efort `max`, reparat acum (implicit `medium`).
  - Nu e dovedit până la `--real-profile` și un turn live `medium`.
- **R3 e reparat și verificat pe arbore fictiv** (canary PASS_LOCAL, 50 de verificări). Ți-ai dat acordul pe lista nouă din UI.
- **R2 e blocat în poartă, dar nu e rezolvat.** Canary-ul îl confirmă (4 citiri ALLOWED). Pentru un proiect real propun un mediu separat (WSL2 sau VM).
- **Playwright 1.61.0 e instalat**, fără descărcare de browser. Fabrica rulează acum E2E în browser real pe preview; testat cu Chromium real.
- **Probe live 2.1 + 2.2: PASS_LIVE** (2026-10-01).
  - Demo A a parcurs live tot fluxul fabricii: Codex a reparat bug-ul, Claude (sonnet) a dat PASS, QA 2/2, pachet gata de acceptare.
  - Proba 2.3 (Demo B) e pregătită și așteaptă clicul tău „Aprobă și pornește”.
  - Detalii: `M03_LIVE_VALIDATION_PLAN.md`.
- **Proba live 2.1 (detalii):** Codex a reparat bug-ul din Demo A prin fabrică: baseline roșu, writer, verificări 6/6, apoi oprire curată la review (fără grant Claude). La efort `medium`, turn → prima comandă a durat **14 s**, față de 290–467 s înainte. Detalii: `M03_PERFORMANCE_REPORT.md` §4.
- **Înainte de probă:** proiectele demo A și B există. Poarta pentru Codex pe Demo A mai cere doar modul LIVE_VALIDATION și grantul (pachetul exact: `M03_LIVE_VALIDATION_PLAN.md` §2.1).

## 2. Baseline-ul verificat și ce am refolosit

- **Verificat la începutul sesiunii:**
  - HEAD `6432c5e`, sincron cu GitHub, arbore curat;
  - Hub-ul rula (`2.3.0-m03`, BUILD_SAFE, poarta deschisă, 0 granturi);
  - Codex CLI 0.159.2, Claude Code 2.1.175;
  - Playwright neinstalat atunci (instalat ulterior, la cererea ta, 1.61.0).
- **Refolosit fără sisteme paralele:**
  - misiunile, taskurile și mașina de stări (COMPLETED numai cu dovezi);
  - execuțiile (poartă, lease, grant, backup);
  - aprobările, plus magistrala de comenzi cu idempotență;
  - handoff-ul în 9 pași;
  - Lega;
  - simulatorul;
  - protecțiile MCP;
  - profilurile de sandbox Codex;
  - cele 11 skill-uri (5 actualizate).
- **Adăugat doar ce lipsea** (8 tabele noi, migrare aditivă):
  - specificații;
  - snapshot-uri;
  - change set-uri;
  - review-uri și findings;
  - dovezi;
  - dispatch durabil;
  - pachete;
  - cronologia și planul fiecărei execuții.

## 3. Izolare: R2, R3, MCP și impactul asupra Codex desktop

Detalii în `M03_RUNTIME_READINESS.md`.

**R3** (`~/.codex/config.toml`, copiile lui și `history.jsonl`):
- Sunt negate acum pentru comenzile modelului.
- Codex desktop: doar comenzile lui din sandbox nu le mai pot citi. Aplicația le citește ca tine, deci nu e afectată.
- Amprenta listei s-a schimbat; ți-ai dat acordul pe lista nouă din UI (2026-10-01, 06:46 UTC, `0f5b7efee0143fa8`).
- **Canary pe arbore fictiv: PASS_LOCAL** (50 de verificări). Cele trei intrări sunt DENIED pentru comenzile din sandbox, iar comenzile normale merg.
- Revenire: `icacls … /remove:d CodexSandboxUsers`.
- Dovadă live că `~/.codex` era citibil: execuția din 2026-09-30 a citit fișiere din `~/.codex/plugins/cache`.

**R2:**
- Sandbox-ul Windows citește tot calculatorul în afara căilor negate. Documentația oficială nu oferă rădăcini de citire restrânse.
- Poarta nouă (`host_isolation`):
  - Codex rulează fără condiții doar pe proiecte de test;
  - pe un proiect real, numai cu acceptarea ta, doar din UI, cel mult 7 zile. Asta e o acceptare a riscului, nu o izolare.
- Canary-ul confirmă empiric: 4 citiri ale proiectului fictiv „alt client” au fost ALLOWED (`KNOWN_GAP_R2`).
- Remedierea reală pentru proiecte de clienți: un mediu separat. Cere instalare, deci aprobarea ta.

**MCP:**
- Regulile din `6432c5e` sunt păstrate.
- Toate drumurile noi trec prin aceleași verificări: Software Factory, reluarea unui thread, ținta unui handoff.
- Un test nou dovedește verificarea MCP și la reluare (M03-MCP-01).
- Fișierele de control scrise de writer (`.codex/`, `.mcp.json`, `AGENTS.md` …) opresc misiunea.

## 4. Cele ~8 minute

Detalii în `M03_PERFORMANCE_REPORT.md`.

| Execuție live (2026-09-30) | Hub (cerere → turn) | Turn → prima comandă | Efort raportat |
|---|---|---|---|
| `run_muojnivb` (scriere) | 7,0 s | 289,5 s | `max` |
| `run_muomogfu` (citire) | 4,4 s | 466,8 s | `max` |

**Ce s-a schimbat:**
- **Cronologie pe faze** pentru fiecare execuție. Se vede separat prima comandă începută / terminată, iar timpul e atribuit: om, Hub, provider, model-sau-sandbox.
- **Efort explicit:** implicit `medium`. Un `max` moștenit oprește execuția înainte de turn.
- **Sandbox-ul fără model, profil fictiv (PASS_LOCAL):** prima comandă 4,7 s, următoarele 3,7–6,4 s (N = 6). Sandbox-ul costă secunde pe comandă, nu minute.
- **Lipsesc încă:** `--real-profile` (lista ta reală, cu arbori mari), rulat de tine, și un turn live `medium` (proba 2.1).

Nu promit o durată finală înainte de ele.

## 5. Model, efort și protecția abonamentelor

**Ce se trimite:**
- **Modelul:** din `model/list`.
- **Efortul:** profilurile ECONOMIC (`low`), BALANCED (`medium`, implicit) și DEEP (`high`); `max` doar dacă îl alegi tu.
- **Ce se înregistrează:** cerut, trimis, sursa și ce a raportat providerul.
- **Fără căderi tăcute:** o valoare nesuportată nu e înlocuită, iar fără `model/list` poarta refuză.

**Gărzile rămân:**
- credit peste zero → Codex blocat;
- Fable refuzat;
- `--setting-sources user`;
- fără chei API, fără moduri fast, fără extra usage.

Încercarea din grant revine doar când nu s-a trimis niciun turn, cu plafon. Contorul e al Hub-ului, nu un refund de la provider.

## 6. Ce pot face efectiv Codex, Claude și Lega

- **Codex:** writer, cu scriere în workspace, sub sandbox OS (rețea oprită).
  - Validat live pentru scriere doar **înainte** de reparația MCP, deci traseul de acum trebuie revalidat (planul live, 2.1).
- **Claude:** reviewer doar-citire, la nivel de unealtă.
  - Shell și scriere: BLOCKED pe Windows nativ.
  - Poate propune un patch în text, dar nimeni nu îl aplică în locul writer-ului.
- **Lega:** intrarea vocală.
  - Poate: propune o misiune de engineering (ciornă după click-ul tău), raporta etapa, opri sau pune pe pauză.
  - Nu poate: porni, aproba, accepta sau accepta riscul R2.
  - Consumul vocii: UNKNOWN.
- **QA:** runner-ul Hub prin `codex sandbox`, fără model. Testele generate nu rulează niciodată cu drepturile backend-ului.

## 7. Demonstrațiile

| Demo | Simulat | Live |
|---|---|---|
| A — bug cu regresie (baseline roșu din motivul așteptat → fix → test de regresie → review PASS → QA → pachet → acceptare) | PASS_SIMULATED (M03-FAC-01) | NOT_RUN |
| B — „Solicitare serviciu” (formular + endpoint + bază node:sqlite de test + deduplicare; verificări eșuate → remediere → review → QA de integrare → preview din versiunea verificată → **E2E în Chromium real**, 12 pași pe mobil 390 px) | PASS_SIMULATED + browser real (M03-FAC-02) | NOT_RUN |
| C — review, handoff, Stop (CHANGES_REQUESTED → remediere → re-review; INCONCLUSIVE fără aprobare inventată; Stop în turn, Stop All, pauză, restart; handoff cu context; review STALE la fișiere schimbate) | PASS_SIMULATED (FAC-03/04/07/08/09/10, FI-01/02, GRD-01) | NOT_RUN |

Fixture-urile rulează direct și local: baseline-ul pică, iar după fix trec toate testele (A 6/6, B 7/7).

Proiectele de test pentru live există (create pe 2026-10-01): `ifrim-factory-demo-a` (`prj_mup6nfto_6214f5f782`, baseline 4/5, pică AC-1 din motivul așteptat) și `ifrim-factory-demo-b` (`prj_mup6nqd7_57f7ba5b4b`).

## 8. Granturi, „Aprobă și pornește”, handoff, Stop

**Aprobarea scope-ului:**
- e una singură, ALWAYS_ASK, legată de hash-uri;
- e refuzată la pornire dacă ceva s-a schimbat după aprobare;
- dublu click sau două taburi duc la o singură pornire;
- o aprobare salvată nu înseamnă execuție pornită, iar interfața le distinge.

**Dispatch durabil:**
- folosește cheie de idempotență și revendicare atomică;
- reverifică poarta și grantul la fiecare pas;
- un grant revocat produce „așteaptă grant”, fără execuție.

**Handoff:**
- pachetul poartă specificația, change set-ul exact, findings și etapa;
- e refuzat cât timp misiunea e activă, ca să nu existe doi writeri.

**Stop:**
- marchează misiunea imediat;
- întrerupe doar execuția și procesele ei;
- „Oprit” apare doar când nu mai rulează nimic;
- rezultatele întârziate sunt arhivate fără efect;
- la restart nu se reia nimic singur.

Stop în timpul unei comenzi QA: același cod, dar fără test dedicat (NEVERIFICAT).

## 9. QA, preview, livrare și teste

Comenzile, momentul și versiunea sunt în `M03_TEST_REPORT.md`.

- **QA:**
  - comenzi permise strict;
  - 0 teste nu înseamnă PASS;
  - testele sărite nu înseamnă PASS;
  - testele de acceptanță sunt protejate prin hash.
- **Integritate:** sunt detectate testele modificate sau șterse, `skip/only`, `catch` gol, lint dezactivat și fișierele de control.
- **Preview:** URL local real, proces urmărit, legat de change set-ul verificat; oprit la acceptare sau respingere.
- **E2E în browser (nou):** pașii declarativi din specificația aprobată rulează în Chromium (sandbox OS, context nou, doar originea preview-ului). Un pas care pică devine finding și intră în remediere; captura rămâne ca dovadă.
- **Pachet:** Markdown + JSON cu hash. Conține criteriile cu status, fișierele, review-ul, dovezile, limitele, migrarea și revenirea. Devine STALE dacă workspace-ul s-a schimbat.
- **Verificarea dinainte de commit:** trei runde cu mai mulți agenți, doar citire, cu verificare adversarială.
  - **Rezultat pentru commit:** fără secrete sau date personale, set de fișiere curat.
  - **Probleme reale găsite în codul M03, toate reparate, fiecare cu test de regresie și verificare prin mutație:** pauza putea porni totuși o execuție cu model; reluarea putea sări baseline-ul sau verificări incomplete; E2E fără limită de timp; o pornire refuzată imediat nu era văzută; pauzele consumau încercările.
  - Detalii: `M03_TEST_REPORT.md` §6.
- **Teste V2 (rularea finală, după toate reparațiile):** 307 teste: **306 PASS, 0 FAIL, 1 SKIPPED_ENV** (symlink).
  - 58 de teste în fișierele M03. Dintre ele, 8 sunt teste de browser: 4 rulează în Chromium real, plus FAC-02, care rulează E2E-ul real în fabrică.
- **Teste V1:** 552 de teste: 548 PASS, 1 omis, 3 FAIL. Cele 3 sunt timeout-uri la API-ul V1 live de pe 8004, lent azi (`/api/health` în 5,6 s). Codul V1 e neschimbat și n-am lărgit timeout-urile.
- **Build UI:** OK. **npm audit:** 0 vulnerabilități (și după Playwright).
- **Hub-ul live:** repornit pe codul final după backupul verificat `bkp_mup7k806_6a6c984ce2`; BUILD_SAFE, 0 granturi, 0 execuții.
- **Verificare în browser:** fluxul complet al fabricii din UI, în simulator; afișare corectă la 280 px și 1280 px, după 2 reparații de UI.

## 10. Ce lipsește și ce aprobări sunt necesare

Ordinea exactă e în `M03_LIVE_VALIDATION_PLAN.md`.

1. **Fără model, făcut:**
   - repornirea Hub-ului pe 2.4.0-m03;
   - „Verifică contul” cu modele și acordul ACL pe lista nouă (de tine, din UI);
   - canary-ul (PASS_LOCAL);
   - măsurarea sandbox-ului pe profil fictiv (PASS_LOCAL);
   - proiectele demo A și B.
2. **Fără model, rămas:** `codex-sandbox-timing.mjs --real-profile`, rulat de tine.
3. **Instalare: făcută.** Playwright 1.61.0, fără descărcare de browser.
4. **Inferență, pe rând, fiecare cu grantul ei** (pachetul pentru prima: `M03_LIVE_VALIDATION_PLAN.md` §2.1):
   - smoke Codex RW (Demo A);
   - review Claude RO;
   - un round-trip de remediere;
   - Stop într-un turn real;
   - Lega, misiune de engineering.
5. **Decizii:**
   - R2 (mediu separat);
   - merge în `main`;
   - (făcut) commit-ul M03, la cererea ta.

## 11. Pornire, oprire, dovezi

```bash
npm run v2          # Hub (8011, BUILD_SAFE)
npm run v2:stop
npm run v2:sim      # simulator (8012): butoanele „Fabrica A/B/C”
npm run test:v2
npm run build:v2
```

Dovezile:
- **în Hub:** Misiuni → misiunea → panoul Software Factory; Inspector → execuția;
- **pe disc:** pachetele în `.ifrim/tmp/v2/factory/<misiune>/delivery/`.

## 12. Pregătirea pentru Sales & Lead Generation

Ce se poate refolosi:
- misiunile, aprobările și dispatch-ul durabil;
- pachetul cu dovezi;
- regulile „ciornă, nu trimitere”;
- separarea cerință / observație / presupunere.

Ce lipsește încă:
- validarea live a writer-ului pe traseul actual (proba 2.1);
- R2, pentru orice proiect cu date reale.

Nu promit câți clienți sau câte proiecte poate livra sistemul pe baza demonstrațiilor simulate.
