# M03 · Planul validării live (fiecare pas cere aprobarea ta separată)

Data: 2026-10-01. Toți pașii fără model din §0 sunt făcuți (0.2 și 0.3 de tine, din UI), cu excepția `--real-profile`. Instalarea Playwright (§1) e făcută. Nicio inferență nu a rulat. Aprobările pentru instalări, ACL/OS și inferență sunt separate. O aprobare Playwright nu autorizează un task Codex, iar primul test aprobat nu le autorizează pe celelalte.

## 0. Pregătire fără model

| # | Acțiune | Cine | Efect | Revenire |
|---|---|---|---|---|
| 0.1 | **Făcut 2026-10-01:** Hub-ul repornit pe `2.4.0-m03` (`npm run v2:stop`, apoi `npm run v2`) | eu | aplică migrarea 3 (aditivă: 2 coloane, 8 tabele) în baza Hub; modul revine la BUILD_SAFE | backup verificat înainte (`backup.run`) |
| 0.2 | **Făcut de tine 2026-10-01, 06:46 UTC:** „Verifică contul” Codex în Integrări (`model/list` salvat: `gpt-6.1-sol` implicit) | tu (click) | salvează `model/list` (fără inferență), necesar pentru planul model/efort | — |
| 0.3 | **Făcut de tine 2026-10-01, 06:46 UTC:** acordul pe lista nouă de căi negate (R3: `config.toml`, `config.toml.*`, `history.jsonl`), amprenta `0f5b7efee0143fa8` | tu (text exact) | **ACL:** sandbox-ul scrie DENY pe cele 3 intrări noi la prima execuție Codex; afectează doar comenzile sandbox din Codex desktop | `icacls "<cale>" /remove:d CodexSandboxUsers` |
| 0.4 | **Făcut 2026-10-01, la cererea ta:** canary pe arbore fictiv, `node v2/tests/manual/codex-sandbox-canary.mjs` → **PASS_LOCAL 50 verificări**, `KNOWN_GAP_R2` 4, arbore șters | eu, în terminalul meu | ACL doar în `%TEMP%` (arborele e șters la final) | — |
| 0.5 | **`--fictive` făcut 2026-10-01:** `node v2/tests/manual/codex-sandbox-timing.mjs --fictive` → prima comandă 4,7 s, următoarele 3,7–6,4 s (N = 6). **Rămâne:** `--real-profile` | `--fictive`: eu; `--real-profile`: tu, în terminalul tău | `--real-profile` reaplică DENY-urile la care ai consimțit | — |
| 0.6 | **Făcut 2026-10-01:** `ifrim-factory-demo-a` (`prj_mup6nfto_6214f5f782`, baseline 4/5, pică AC-1 cum trebuie) și `ifrim-factory-demo-b` (`prj_mup6nqd7_57f7ba5b4b`), ambele `hub-test` | eu | creează `ifrim-factory-demo-a` / `-b` lângă Hub (date fictive), le înregistrează ca proiecte de test | ștergi folderele; în Hub: „Retrage” |

**Rezultat la 0.4 (obținut exact așa):**
- PASS pe toate verificările;
- `config.toml`, `config.toml.bak` și `history.jsonl` DENIED;
- `KNOWN_GAP_R2` pe proiectul „alt client” (R2 rămâne deschis).

**Rezultat la 0.5 (`--fictive`):** secunde, nu minute. Pe un profil mic, sandbox-ul costă ~4–6 s pe comandă. Rămâne de văzut `--real-profile` (lista ta reală de căi negate, cu arbori mari) și un turn live `medium`.

## 1. Instalare: Playwright pentru E2E și preview în browser — **FĂCUT 2026-10-01, la cererea ta**

- **Ce:** `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --save-dev playwright@1.61.0`, în rădăcina Hub-ului.
- **De ce versiunea asta:** 1.61.0 folosește Chromium revizia 1228, deja prezentă în `%LOCALAPPDATA%\ms-playwright` (`chromium-1228`, `chromium_headless_shell-1228`). **Nu se descarcă niciun browser.**
- **Ce nu se instalează:** nimic global, Firefox, WebKit.
- **Licență:** Apache-2.0.
- **Efecte:**
  - `package.json` și `package-lock.json` primesc o devDependency;
  - Browser Workspace trece din NEEDS_INSTALL_APPROVAL în disponibil;
  - fiecare inspecție cere în continuare aprobare pe URL-ul exact.
- **Făcut după:**
  - Chromium pornește cu sandbox-ul OS activ (`chromiumSandbox: true`);
  - runner-ul E2E e scris: criteriile `e2e` cu pași declarați rulează pe preview-ul versiunii verificate și intră în pachet ca dovadă;
  - teste cu browserul real: M03-BR-00…03 și FAC-02 (Demo B, 12 pași pe mobil 390 px) → PASS_LOCAL / PASS_SIMULATED.
- **Revenire:** `npm uninstall playwright`.

## 2. Inferență: în ordine, fiecare cu grantul ei, oprindu-ne după fiecare

Condiții comune:
- proiect de test (`hub-test`), deci R2 nu cere acceptare;
- mod LIVE_VALIDATION, poartă deschisă, acord ACL curent;
- „Verifică contul” cu modele, făcut în ultimele 24 h;
- după fiecare pas: reconciliem procesele și granturile, iar modul revine cum hotărăști tu.

| # | Probă | Proiect | Rută | Model / efort | Grant | Durată max | Date trimise | Condiții de oprire | Artefacte | Stare finală dorită |
|---|---|---|---|---|---|---|---|---|---|---|
| 2.1 | **PASS_LIVE (2026-10-01, 11:55–11:59 UTC)**: Smoke Codex RW prin Software Factory (Demo A); detalii în §2.1 rezultat | `ifrim-factory-demo-a` | Codex app-server, profil `ifrim_hub_rw`, rețea oprită | implicitul contului din `model/list` / `medium` (BALANCED) | Codex · workspace-write · 2 încercări · 60 min | 30 min (limita misiunii) | fixture-ul (fictiv) + specificația | apel MCP; model sau efort diferit de cel cerut; cerere de aprobare în afara workspace-ului; termen | run id, cronologie, change set, diff, dovezi baseline/verificări | `REVIEWING` sau `BLOCKED` cu motiv clar |
| 2.2 | Review Claude RO pe change set-ul de la 2.1 | același | Claude Code `-p`, Read/Glob/Grep, `dontAsk`, fără MCP | implicitul Claude Code (raportat la init; Fable refuzat) / `medium` | Claude · read-only · 2 încercări · 60 min | 15 min | pachetul de review (diff redactat ≤ 40 000 caractere) | init cu MCP; apiKeySource; model refuzat | review validat, findings | `QA` → `DELIVERY_READY` sau `NEEDS_OWNER_DECISION` |
| 2.3 | Un round-trip de remediere (Demo B sau C) | `ifrim-factory-demo-b` | ca 2.1 + 2.2 | ca mai sus | Codex RW · 3 · 90 min; Claude RO · 3 · 90 min | 60 min | ca mai sus | ca mai sus + limita de 2 cicluri | toate dovezile + preview | `DELIVERY_READY` |
| 2.4 | „Aprobă și pornește” din UI pentru misiunea aprobată | (inclus în 2.1–2.3: aprobarea scope-ului e chiar acest click) | — | — | — | — | — | — | aprobarea + dispatch-ul (idempotent) | — |
| 2.5 | Stop în timpul unui turn real | `ifrim-factory-demo-a` | Codex read-only | `medium` | Codex · read-only · 1 încercare · 30 min | 10 min | o cerere de analiză lungă | apeși Stop la ~30 s după `turn_acknowledged` | cronologie, `CANCEL_REQUESTED` → `CANCELLED`, fără etapă următoare | `CANCELLED`, nicio execuție activă |
| 2.6 | Lega propune o misiune de engineering | Hub | sesiune vocală (grant de voce separat) | GPT-Live | voce · 1 sesiune · 10 min | 10 min | conversația vocală | „Lega, oprește tot” | propunerea + click-ul tău + specificația v1 | `SPEC_DRAFT` (nimic nu rulează) |

### 2.1 în detaliu: pachetul exact de aprobare (pregătit 2026-10-01)

**Stare verificată în Hub (previzualizarea porții, Codex RW pe Demo A, fără model):**
- deja OK:
  - poarta: deschisă;
  - proiectul: test;
  - ruta de facturare: verificată;
  - izolarea: acordul ACL curent, amprenta `0f5b7efee0143fa8`, dat de tine din UI pe 2026-10-01 la 06:46 UTC;
  - `host_isolation`: OK (proiect de test);
  - `run_plan`: `gpt-6.1-sol` · `medium` (BALANCED), din „Verifică contul” făcut de tine la 06:46 UTC;
  - concurență 0/2, lease liber;
- lipsesc doar:
  - modul (BUILD_SAFE);
  - grantul;
- backup-ul proiectului se face și se verifică automat înainte de admitere.

**Ce aprobi:**

| Element | Valoare |
|---|---|
| Mod | BUILD_SAFE → LIVE_VALIDATION (pe durata probei) |
| Grant | Codex · workspace-write · `prj_mup6nfto_6214f5f782` (Factory Demo A) · 2 încercări · 30 min pe execuție · valabil 120 min |
| Fără | grant Claude, Lega, alte proiecte |
| Misiune | Software Factory BUGFIX „Numele din spații trebuie refuzat” (specificația demo A: AC-1/AC-2 prin `test/acceptance.test.mjs`, protejat; AC-3 prin review) |
| Limite | 1 ciclu de remediere, 120 min pe misiune |
| Model / efort | `gpt-6.1-sol` (implicitul contului din `model/list`) / `medium`; orice alt model sau efort raportat oprește execuția înainte de turn |
| Sandbox | profilul `ifrim_hub_rw`, rețea oprită; baseline-ul și verificările rulează prin `codex sandbox` (fără model) |
| Date trimise la OpenAI | fișierele fixture-ului (fictive), specificația, promptul Hub-ului |
| Risc acceptat | R2: comenzile modelului pot citi prin cale absolută fișiere din afara proiectului, în afara căilor negate. Pe proiect de test, poarta admite asta. **Nu e izolare.** |
| Oprire automată | apel MCP sau server MCP raportat; model/efort diferit; cerere de aprobare în afara workspace-ului; fișiere de control sau teste protejate modificate (finding critic); încercări epuizate; 30 min pe execuție; termenul misiunii |
| Oprire manuală | Stop pe misiune, Stop All, „Lega, oprește tot” |
| Stare finală dorită | `REVIEWING`, cu așteptarea „grant” (Claude, nu e creat), sau `BLOCKED` / `NEEDS_OWNER_DECISION` cu motiv clar |
| Dovezi | id-ul execuției, cronologia (turn → prima comandă, durata primei comenzi), planul trimis/raportat, change set-ul și diff-ul, dovezile baseline/verificări, findings |
| După probă | grantul rămas e revocat; Hub-ul revine în BUILD_SAFE; misiunea rămâne în așteptare pentru 2.2 sau o oprești |

**Cine face ce:**
1. Eu, prin API-ul local, după aprobarea ta: modul, grantul, pregătirea misiunii (ciornă).
2. Tu, în UI: Misiuni → misiunea → „Cere aprobarea scope-ului” → „Aprobă și pornește” (hash afișat). Abia acesta pornește ceva.
3. Eu: urmăresc, opresc la abatere, adun dovezile, revoc grantul, revin în BUILD_SAFE și raportez.

**Textul de aprobare (îl copiezi exact):**

> Aprob proba live 2.1: treci Hub-ul în LIVE_VALIDATION, creează grantul Codex workspace-write pe Factory Demo A (prj_mup6nfto_6214f5f782), 2 încercări, 30 min pe execuție, valabil 120 min, și pregătește misiunea Software Factory „Numele din spații trebuie refuzat” cu 1 ciclu de remediere și 120 min. Eu apăs „Aprobă și pornește”. Fără grant Claude. După probă revoci grantul rămas și revii la BUILD_SAFE.

## 3. Ce nu se cere aici

- REAL_PROJECT_READY: cere întâi rezolvarea R2 printr-un mediu separat (vezi `M03_RUNTIME_READINESS.md` §3, opțiunea A).
- Upgrade-ul Claude Code CLI: verifici tu dacă e necesar; azi `--effort` e listat de 2.1.175.
- Commit, push, merge sau deploy: acțiuni separate, aprobate pe comanda exactă.

### 2.1 Rezultat: PASS_LIVE (2026-10-01)

Aprobată de proprietar cu textul exact. Pași: mod LIVE_VALIDATION, grant `grant_muph73xv_86e66f49e4`, misiunea `mis_muph73y3_9c2c87061c`; „Aprobă și pornește” apăsat de proprietar la 11:55:04 UTC.

**Desfășurare:**
- **11:55:04 BASELINE:** `node --test test/acceptance.test.mjs` → FAIL 1/2, adică bug-ul e reprodus (151,3 s, prima comandă din sandbox).
- **11:57:35 IMPLEMENTING:** Codex `gpt-6.1-sol` · `medium`, execuția `run_muphc63x_ef0699abd6` → completed în 130 s; fără niciun eveniment MCP, fără cereri de aprobare.
- **Change set 1:**
  - `src/requests.js`: validarea folosește `name.trim()`;
  - un test nou de regresie (`test/requests.regression.test.mjs`).
- **11:59:46 CHECKING:** `node --test` → PASS 6/6 (5,2 s).
- **11:59:51 REVIEWING → BLOCKED (grant):** review-ul Claude a fost refuzat de poartă înainte de orice model (fără grant Claude, cum s-a cerut); turn netrimis.

**După probă:**
- grantul revocat (1 din 2 încercări folosite);
- modul readus la BUILD_SAFE;
- 0 granturi active;
- arborele Hub-ului neschimbat; în Demo A s-au schimbat doar cele 2 fișiere.

**Pentru 2.2:**
- misiunea așteaptă un grant Claude read-only și „Reia”;
- termenul misiunii (13:55 UTC) se prelungește la reluare;
- observație pentru reviewer: fixul validează numele curățat, dar păstrează în `value.name` valoarea necurățată (fix minim; decizia rămâne la review).

### 2.2 Prima încercare: garda de facturare a oprit review-ul înainte de model (2026-10-01, 12:04 UTC)

Aprobată de proprietar cu textul exact:
- mod LIVE_VALIDATION;
- grant Claude read-only `grant_muphjoe1_ab9ba5ee01`, 2 încercări;
- „Reia” apăsat de proprietar la 12:04:05.

**Ce s-a întâmplat:**
- Claude Code a pornit (`run_muphkh0k_2b2e92f412`) și a raportat la init modelul implicit al contului: **`fable[1m]`**.
- Hub-ul l-a oprit **înainte de model**: Fable e refuzat, iar varianta 1M poate factura credite de utilizare pe Max.
- Turn netrimis, nicio inferență. Încercarea a fost returnată automat (`grant.refunded`).

**Rezultat:**
- **garda de facturare: PASS_LIVE**;
- review-ul: NOT_RUN.

**După probă:**
- grant revocat (0 din 2 folosite);
- BUILD_SAFE;
- misiunea în BLOCKED (decizia ta).

**Remediere în cod** (necomisă; testul M03-FAC-26):
- la „Reia” poți alege modelul reviewer-ului (`sonnet`, `opus`, `haiku`; Fable, `best` și `[1m]` sunt refuzate). Alegerea e înregistrată ca eveniment și trimisă explicit cu `--model`;
- o pornire oprită înainte de model (poartă, grant, gardă de facturare, MCP la init) nu mai consumă o încercare a etapei.

### 2.2 Reluare cu reviewer `sonnet`: PASS_LIVE (2026-10-01, 12:46 UTC)

Înainte de reluare, verificarea doar-citire a schimbării a confirmat un risc: Claude Code poate comuta singur modelul în timpul execuției dacă setările utilizatorului au `fallbackModel`. Reparat și testat (FAC-27, verificare prin mutație):
- refuz la pornire dacă există `fallbackModel`;
- oprire la orice comutare de model;
- verificarea `modelUsage` din rezultat;
- listă permisă strictă pentru modelul reviewer-ului.

**Desfășurare:**
- grant Claude read-only `grant_mupj2kdh_4d8df15823`;
- reluare cu `reviewerModel: sonnet`, alegere înregistrată ca `factory.model_override`;
- execuția `run_mupj2kys_c24485b26f`: sonnet · medium, init acceptat, 30 s, fără MCP;
- verdictul **PASS (VALID)**, legat de change set-ul 1, plus 2 findings informative;
- **QA** `node --test test/acceptance.test.mjs` → PASS 2/2;
- pachetul **`bnd_mupj3diq_d386324921` READY_FOR_OWNER_ACCEPTANCE**.

**După probă:** grant revocat (1 din 2 încercări folosite), BUILD_SAFE.

**Rezultat:** Demo A a parcurs live întregul flux al fabricii: spec → baseline roșu → Codex → verificări → review Claude → QA → pachet. **Acceptarea rămâne la proprietar** („Accept local”).

### Verificare fără model: un server sub sandbox-ul Codex real ascultă pe 127.0.0.1 (PASS_LOCAL, 2026-10-01)

Un `node server.js` pornit cu `codex sandbox` (profil `ifrim_hub_rw`, rețea oprită), într-un folder temporar, a răspuns Hub-ului pe `127.0.0.1` după 6,2 s. Rezolvă întrebarea deschisă despre preview-ul sub sandbox.

### 2.3 Pregătită, nepornită: așteaptă clicul proprietarului

Misiunea `mis_mupj3zl4_9970bdd58b` (Demo B, reviewer `sonnet`, 2 cicluri, 120 min) e în SPEC_DRAFT, cu specificația completă.

Aprobarea scope-ului în numele proprietarului a fost **refuzată de clasificatorul de siguranță al sesiunii**: un agent nu își aprobă singur acțiunile care cer aprobarea proprietarului. Granturile create pentru probă au fost revocate nefolosite (0/3 fiecare), iar Hub-ul e în BUILD_SAFE.

**Pentru pornire:**
1. mod LIVE_VALIDATION;
2. grant Codex workspace-write × 3 și grant Claude read-only × 3 pe Demo B;
3. proprietarul apasă „Cere aprobarea scope-ului” → „Aprobă și pornește”.

### 2.5 (Stop într-un turn real) și 2.6 (Lega): NOT_RUN

- **2.5** cere aprobarea unei execuții noi: același clic al proprietarului.
- **2.6** cere vocea proprietarului.
