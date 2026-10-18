# Etapa 2026-10-16 seara — Verificarea finală a stabilității și pregătirea M12

Cerută de proprietar la 17:59 UTC, după închiderea §25. Scop: (1) închiderea diferenței dintre poarta cerută și rezultatul efectiv al
regresiei; (2) actualizarea `.ifrim/M12_PROMPT.md` la starea reală. Fără funcționalități M12, fără upgrade live, fără modele, fără
reluarea acceptării §25, a writer-ului, a filmărilor sau a aprobărilor.

Baseline verificat la pornire: `v2-milestone-01` local = `origin/v2-milestone-01` = `ee6c93ac69cf4a31e65e72ef0e77aace4bb09a6a`.
Codul executabil din `ee6c93a` este identic cu `7074ab5` (arborele `7074ab5` = arborele merge-ului `f1a3845`; `ee6c93a` diferă doar în
`.ifrim/` și `CLAUDE.md`). Modificările necomise ale proprietarului din arborele de lucru sunt doar de capăt de linie (`git diff` gol);
au rămas neatinse.

## 1. Dovada existentă: poarta finală pe `7074ab5`, clarificată

Formularea rămâne exact cea din istoric: **2311 teste V2 = 2306 PASS, 4 FAIL, 0 anulări, 1 SKIP. Ulterior, testele afectate au trecut
izolat.** Rularea completă nu a fost verde și nu devine verde retrospectiv.

Logurile originale: `C:\Users\mihai\s25-accept\gate-final\` (în `STAGE_2026-10-16_ACCEPTARE_LOCALA_S25.md` §6 calea apare fără
backslash-uri). `summary.txt`: commit `7074ab50ef…`, node v24.14.0, build 0, build:v2 0, test:v2 exit 1 (15:30:11–17:23:11 UTC,
6780 s), V1 exit 0 (rulat în folderul Hub). `test-v2.log` este în formatul implicit `spec` al Node 24 (nu TAP); totalurile la L2893–2900:
`tests 2311, pass 2306, fail 4, cancelled 0, skipped 1, duration_ms 6778955.844`. Rularea a fost în clona `C:\Users\mihai\hub-rc`,
lansată detașat prin WMI (`C:\Users\mihai\s25-accept\detach.ps1` → `gate.ps1 -Tag final`), fără `HUB_V2_STUDIO_DIST`.

### Cele trei teste de oprire (`v2/tests/r-shutdown-consumers.test.mjs`)

| test | durată | eroare (log) |
|---|---|---|
| `round5 production shutdown consumer: transcribe-extract` | 18220 ms (L2717) | copil omorât: `killed: true`, `SIGTERM`, `code: null`, `stdout: ''` |
| `round5 production shutdown consumer: ops-shutdown` | 18462 ms (L2719) | idem |
| `round5 production shutdown consumer: ops-db-closed` | 19073 ms (L2720) | idem |

Limitele din test: `execFile` `timeout: 18000` (L13) și testul `timeout: 20000` (L10). Al patrulea caz, `transcribe-launch`, a trecut
în 17847 ms, chiar sub limită.

- **DEMONSTRAT:** procesul copil `fixtures/shutdown-consumers.mjs <mod>` a fost omorât de limita de 18 s a `execFile`. Reluarea izolată
  pe același commit (17:24:57 UTC, `node --test v2/tests/r-shutdown-consumers.test.mjs`, `gate-final/rerun-shutdown.log`): 4/4 PASS în
  3323–4534 ms.
- **PRESUPUS:** că încărcarea CPU a cauzat depășirea. `stdout` gol nu arată progresul, deci o rulare lentă nu se poate deosebi de un
  blocaj. Încărcarea înregistrată (`cpu.txt`, un eșantion pe minut) a fost între 48 și 100 %, la 97–100 % doar între 16:57–17:09 și
  17:18–17:23 UTC; fișierul a rulat estimativ în jurul 17:07–17:09 (estimare din duratele de după el, nu un timestamp). În timpul
  reluărilor nu s-a înregistrat CPU.
- **Corecție:** „CPU 97–100 %” pentru toată poarta, din documentul etapei precedente, este inexact; intervalul real a fost 48–100 %.

### M09-SB-01 (`v2/tests/m09-studio-browser.test.mjs:38`)

Eșec la L975 (19920 ms): `locator.waitFor: Timeout 15000ms exceeded` așteptând `.studio-proposal` „Propunere (neaplicată)” (test L157,
după clicul „Propune corectura”).

- **Diagnosticul anterior „clona nu are build-ul Studio la calea implicită” este CONTRAZIS de dovezi.** Un build lipsă face testul
  `SKIPPED_ENV` (L19–22), nu FAIL. Build-ul exista: `C:\Users\mihai\hub-rc\.ifrim\tmp\m09-web-dist-studio\index.html` (02:35 UTC), dar
  era **învechit**: asset-ul său încorporează `2.14.17-m11` / `contract:13` (verificat), iar serverul era `2.14.19-m11` / contract 14.
- **SUSȚINUT PUTERNIC de fișiere și cod, nedemonstrat printr-o linie de execuție:** primii pași ai testului sunt citiri și trec; prima
  scriere din pagină („Propune corectura”) este refuzată ca 409 `UI_STALE` (client `v2/web/src/api.js:74`, server
  `v2/server/http/server.mjs:97`), deci propunerea nu apare și locatorul expiră. Același eșec, la aceeași linie, apare și în poarta
  preliminară pe `8a52f06` (`gate-r1/test-v2.log` L2875–2883), la o încărcare de 66–87 % (estimare), deci nu ține de CPU.
- Reluarea izolată (17:25:20 UTC) a folosit `HUB_V2_STUDIO_DIST=C:/Users/mihai/hub-rc/v2/web/dist` (construit de poartă pe `7074ab5`,
  contract 14): 1/1 PASS în 18,7 s.

T25 (SKIP): „NOT_RUN: file symlink creation denied (EPERM)” (L18), excepția documentată. V1: 552 = 551 PASS, 0 FAIL, 1 SKIP (legătura
simbolică de fișier, privilegiu Windows indisponibil).

## 2. Regresia completă unică, pe codul final

Mediu (pregătit și verificat înainte de inițializare):
- clonă nouă `C:\Users\mihai\hub-gate` din depozitul local, `core.autocrlf=false`, la `ee6c93a` detașat, fără remote (nu poate împinge
  sau trage nimic din folderul Hub), `node_modules` = joncțiune spre `node_modules` din folderul Hub; `git status` gol, inclusiv
  fișierele neurmărite;
- fără pointerul `.ifrim/data-location.json` în clonă; nicio variabilă `HUB_*` moștenită (curățate explicit); `NODE_OPTIONS` de sistem
  `--dns-result-order=ipv4first` păstrat; Node de sistem `C:\Program Files\nodejs\node.exe` v24.14.0, npm 11.12.0, fără fnm/nvm în PATH;
- citit înainte de execuție: `v2/server/config.mjs:46–78` (în modul test pointerul e ignorat, iar `dataDir` trebuie să fie sub
  `.ifrim/tmp` al clonei), `v2/tests/helpers.mjs:30–90` (`TEST_TMP` = `<clonă>\.ifrim\tmp\v2-tests`, bază și proiect create de la zero,
  port liber, furnizori falși), `v2/tests/accept-helpers.mjs` (rădăcini verificate, gard de scriere);
- Studio construit pentru test în `<clonă>\.ifrim\tmp\m09-web-dist-studio` și `HUB_V2_STUDIO_DIST` setat explicit spre el; identitate
  verificată înainte de suită: `index.html` sha256 `FC24E0D1…7CDF`, 77 fișiere (manifest în folderul rulării), asset-ul
  `jsx-runtime-BN8wY5RB.js` conține `2.14.19-m11` / `contract:14`;
- lansare detașată prin WMI (`C:\Users\mihai\hub-gate-logs\run-gate.ps1`), PID 24508; folderul rulării
  `C:\Users\mihai\hub-gate-logs\run-20261016T1809Z\` (`summary.txt`, `build-*.log`, `test-v2.log`, `test-v1.log`, `cpu.csv` la 15 s,
  `procs-*.txt`).

Pași, fiecare o singură dată, fără nicio relansare: `npm run build` 0 (2 s); `npm run build:v2` 0 (5 s); build Studio 0 (3 s);
`npm run test:v2` 18:10:13–19:53:10 UTC; `npm run test` (V1) 19:53:10–19:53:22 UTC, în aceeași clonă. Niciun timeout, prag, așteptare
sau skip modificat; codul testelor e cel din `ee6c93a`.

### Rezultat V2 — poarta îndeplinită

`npm run test:v2`, exit **0**, 6177 s; totaluri (`test-v2.log`, ultimele linii): **2311 teste = 2310 PASS, 0 FAIL, 0 anulări, 1 SKIP**,
`duration_ms 6175220.9486`. Singurul SKIP este T25 (L18: „NOT_RUN: file symlink creation denied (EPERM); branch covered by the
junction test and source review”), excepția documentată. Logul e în formatul implicit `spec` al Node 24 (comanda porții, nemodificată,
nu emite TAP; același format ca poarta pe `7074ab5`).

Testele care picaseră pe `7074ab5` au trecut în această rulare completă: M09-SB-01 PASS în 10192 ms (L975, cu Studio-ul construit
pentru test); `r-shutdown-consumers` 4/4 PASS în 2744–3031 ms (L2717–2720), departe de limita de 18 s.

Încărcarea mașinii (diagnostic, nu motiv de reluare): 381 de eșantioane la 15 s, media 71,8 %, minim 36 %, maxim 100 %, 23 de eșantioane
≥ 97 %; memorie liberă între 1324 și 7952 MB.

Cleanup: 0 procese proprii identificabile înainte, după V2 și la final (`procs-before/after-v2/after.txt`: linia de comandă cu clona
sau folderul rulării, browserele Playwright, ffmpeg/ffprobe); `git status --untracked-files=all` în clonă: 0 linii; niciun raport
`Cleanup failures` în log.

### Rezultat V1 în clona izolată — nu e verde

`npm run test`, exit **1**, 12 s: **552 = 549 PASS, 2 FAIL, 0 anulări, 1 SKIP** (`test-v1.log` L570–577; SKIP la L274, excepția symlink
V1 documentată).
- `tests/conversation-api.test.mjs:23` — 404 `Project not found` la `POST /api/conversations` cu `projectSlug: "ifrim-agent-hub"`;
- `tests/workflow-refresh-api.test.mjs:113` — 400 `Project slug invalid sau lipsa.` cu același slug.

Diagnostic **DEMONSTRAT în cod și fișiere:** API-ul V1 citește registrul proiectelor din folderul părinte al depozitului
(`apps/api/src/server.mjs:21–22`: `projectsRoot = path.resolve(projectRoot, "..")`, `registryPath = <părinte>\PROJECTS.md`, citit de
`loadProjects` L973–974). În clonă, părintele este `C:\Users\mihai`, unde nu există `PROJECTS.md` (verificat), deci slug-ul
`ifrim-agent-hub` nu se rezolvă. În folderul Hub, părintele este „Ifrim Digital Proiecte”, cu registrul real al proprietarului, de aceea
aceleași teste, pe același cod, au trecut în poarta pe `7074ab5` (rulată acolo: 551/552). Cele două teste V1 nu sunt deci sintetice: depind
de registrul real din afara rădăcinii testului.

Limita dovezii: testele nu au fost reluate (regula etapei); nu există o rulare V1 complet izolată și verde pe acest cod. Lipsa
registrului explică ambele erori la nivel de cod; nu am instrumentat o rulare care să arate ramura exactă. Corecția (un registru de
fixture pentru aceste teste) e o modificare de test, pentru o etapă separată.

Rest: al doilea test lasă la eșec folderul de fixture `.env.hub016-ea13fab6-…` în rădăcina clonei (curățarea e doar pe calea de succes,
nu în `finally`, `workflow-refresh-api.test.mjs:122–124, 252–254`; conține doar `marker.txt`, „no secrets”); același tip de resturi
există și în `hub-rc`. Nu e un proces; a rămas în clona de unică folosință.

## 3. `M12_PROMPT.md` actualizat (rămâne DRAFT)

Fiecare afirmație din §2, §4 și §4b a fost verificată în codul de la `ee6c93a` (cercetare doar-citire în clona `hub-gate`, fără Hub
pornit). Toate premisele M04 sunt încă adevărate: tabelele `sales_*` (migrarea 4), `EVIDENCE_LABELS`, `OUTREACH_DISABLED` și
`LIVE_COLLECTION_DISABLED` în vigoare, `q-v1` cu INFERRED = 25, `applyOverride` cu motiv, funcțiile din `proposal.mjs`, adaptorul de
fixture, `synthetic.mjs`, `OPPORTUNITY_TRANSITIONS`, cele 10 teste `m04-*` și ecranele Sales. C-01–C-07 sunt păstrate neschimbate.

Schimbări:
- antetul: DRAFT până la revizuirea și trimiterea de către proprietar (poarta din 2026-10-10 e depășită de închiderea §25);
- §2 baseline: `2.14.19-m11`, contract 14, schema 12, `origin` = `ee6c93a` + commitul acestei etape; §25 închis, cu aprobările lui;
  catalogul live citit prin GET: **0 servicii** (`GET /api/sales/services?all=1`, 18:19 UTC); prețurile rămân necunoscute;
- §2a nou: regula de izolare de după incidentul de la 00:48 UTC, citiri live doar prin GET, dezvoltare în clonă, Node de sistem;
- §2b nou: mecanismele actuale de autoritate (sesiune recitită, canale declarate, dispatcher de proprietar), plan cu o confirmare,
  ținta afișată exactă, decizia unică de integritate cu proveniență, R-HIST / R-REV / `delivery.correct`, profilul local;
- §3 și §6: push-ul și upgrade-ul gestionat le rulează proprietarul printr-un singur script CMD (refuzate agentului); review Opus +
  ultracode;
- precizări din cod (fără a schimba cerințele): stările `PROPOSAL_DRAFT` / `READY_FOR_OWNER_REVIEW` / `APPROVED_INTERNAL` sunt ale
  oportunității; `sales_handoffs` / `sales.handoff.create` există deja cu alt sens (predarea către Engineering); uneltele Sales ale Legei
  sunt doar de citire;
- §4c nou, constatare de confirmat de proprietar: comenzile `sales.*` rulează pe `ui`/`test` fără sesiune de proprietar;
  `sales.proposal.approve` cere `displayedSha` și o aprobare ALWAYS_ASK, dar `approveProposal` verifică sha-ul doar dacă e transmis
  (`sales.mjs:1080`); propunerea: deciziile proprietarului din M12 urmează modelul `factory.accept`;
- §5 T-S8: rularea unică, coerentă, cu Studio construit pentru test și `HUB_V2_STUDIO_DIST`, plus rezultatul acestei etape;
- §8: `factory.reject` fără sesiune ca precondiție recomandată înaintea proiectelor noi prin Fabrică; celelalte probleme separate.

## 4. Probleme separate (nu redeschid acceptarea §25)

1. **`factory.reject` fără sesiune** — corecție separată a unei decizii terminale, cu prioritate înainte de folosirea pe proiecte noi.
   Confirmat în cod: comanda nu își declară canalele (implicit `ui`/`test`, `command-catalog.mjs:235–236`), ruta folosește dispatch-ul
   generic `ui` (`routes.mjs:337`), iar handlerul (`factory.mjs:2330–2345`) marchează pachetele și stadiul REJECTED fără nicio verificare
   de sesiune.
2. **Profilul local de dezvoltare** — încredere acordată apelanților locali fără dovada prezenței proprietarului: cu profilul activ,
   `POST /api/owner/dev-session` deschide o sesiune de proprietar pentru orice proces loopback cu Origin canonic; sesiunile au
   `user_verified = 0` și sunt mereu „proaspete” (`trust.mjs`, `owner-routes.mjs:54–60`). Comportamentul aprobat rămâne neschimbat aici.
3. **Media și afirmațiile Word/campanie** — banda subțire în varianta 9:16, textul tehnic înaintea cadrului de dovadă, ID-urile AC afișate
   în tonul „both”, înghețările QA WARN; Word/campanie cu „fără suprapuneri”, 5 servicii față de 3 în filmare, criterii tăiate la 160 de
   caractere (`OPEN_ISSUES.md`, secțiunea 2026-10-16 (live), punctele 1–3).
4. **Simplificarea autorului pasului 0** — designul `.ifrim/DESIGN_2026-10-16_AUTOR_PAS0_HUB_TEMPLATE.md`, neimplementat.
5. **Observațiile minore de afișare** — camera arată „snapshot identic ✓” fără diferența acceptată prin proveniență; problemele
   ne-legate de căi apar ca diferență de workspace; preflight-ul nu citește `cancel_requested_at` / `decided_at`; textele Windows Hello sub
   profilul local; README-v2 fără coloana CURRENT/SUPERSEDED; `status_reason` neactualizat după corecție; evenimente
   `delivery.stale_reconcile_refused` duplicate; `delivery.package.propose` nu își leagă planul; câteva aserțiuni de test fără precondiții;
   RL-06.
6. **Nou în această etapă: două teste V1 nesintetice** — `tests/conversation-api.test.mjs` și `tests/workflow-refresh-api.test.mjs`
   depind de registrul real `..\PROJECTS.md` din folderul părinte (§2); al doilea își lasă fixture-ul `.env.hub016-*` la eșec. Corecția
   (registru de fixture, curățare în `finally`) e o modificare de test pentru o etapă separată; codul V1 nu se atinge fără aprobare.

## 5. Ce este închis, ce demonstrează regresia, ce rămâne

- **Închis:** §25 (software acceptat, misiune COMPLETED, clipurile v2 și rezumatul v2 aprobate) — neatins în această etapă.
- **Demonstrat de regresia completă unică** (`ee6c93a`, cod = `7074ab5`, clonă sintetică): `npm run test:v2` 2311 = 2310 PASS, 0 FAIL,
  0 anulări, 1 SKIP (T25), exit 0, 0 procese rămase → **poarta V2 cerută este îndeplinită**, cu excepția T25 documentată. Rularea din
  după-amiaza (2306/2311) rămâne în istoric așa cum a fost.
- **Nedemonstrat verde:** V1 în mediul complet izolat (2 FAIL, cauza în §2). Rularea V1 din poarta precedentă (551/552) a fost în folderul
  Hub, cu registrul real; cele două rulări nu se combină.
- **Rămâne pentru etape separate:** §4 (1–6); M12 rămâne DRAFT până îl trimite proprietarul.
