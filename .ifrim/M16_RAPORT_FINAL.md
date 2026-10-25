# M16 „Ecranul de comandă L3ga” — raport final (P0 + P1, 2.19.0-m16)

**Stare: READY_FOR_OWNER_ACCEPTANCE după release (lipsește doar sesiunea și decizia ta „Accept M16”).** Orele sunt ora României (din 2026-10-25 01:00 UTC ora de iarnă, UTC+2; înainte UTC+3).
Etichete: CONFIRMAT ÎN COD · RAPORTAT ÎN DOCUMENTAȚIE · TESTAT ACUM ÎN MEDIU IZOLAT · VERIFICAT ACUM LIVE · IPOTEZĂ · PROPUNERE · NEVERIFICAT.

## 0. Ce poți face acum
- Deschizi **Modul Comandă** din L3ga („Mai mult” → „Mod Comandă (Alt+C)”), cu **Alt+C** sau spunând „L3ga, mod comandă”; Esc te întoarce.
  Pe ecranul mare vezi repausul (figura L3ga, ce te așteaptă, lucrări, livrări, vânzări), cu „Ascunde cifrele”.
- **Al doilea ecran** (televizor / monitor): butonul „Al doilea ecran” deschide o fereastră care doar afișează, sincronizată cu cea
  principală; nu are microfon și nu trimite nimic.
- **„Ce s-a întâmplat azi?”** (sau „de la ultima vizită”, „acum”): rezumat în 6 capitole, cu cel mult 4 cifre pe capitol, sursa și ora
  citirii; „următorul”, „repetă”, „înapoi”, „oprește”. Opririle adresate („L3ga, stop”, „Oprește tot”) au prioritate.
- **Harta companiei** (tasta 3 sau „Arată harta companiei”), „Arată Vânzările”, ← → între departamente, abilitățile cu **fișe de proces**
  („Arată fișa ofertei”, „Cum funcționează devizul?”).
- **Vânzări** (pâlnia cu pragul de 21 de zile pentru „Se răcesc”), **Traseul lucrării** din Fabrică, **Rezultatul** pe ecranul mare și
  **Harta sistemului** cu căutare (tastele 4–7).
- Nimic din M16 nu aprobă, nu trimite, nu pornește lucrări: rutele noi doar citesc, singura comandă nouă rostește rezumatul Hub-ului în
  vocea pornită de tine.

## 1. Baseline și commituri
- Baseline (2026-10-25 ~00:55, VERIFICAT LIVE prin GET / `git ls-remote`): GitHub `v2-milestone-01` = `9b91bca`, `main` = `17921ac`;
  folderul Hub pe `v2-milestone-01` @ `9b91bca`, curat; live `2.18.1-m15`, contract 20, BUILD_SAFE, boot `boot_mvmsluum_a50caf329a`.
- Cod (clona `C:\Users\mihai\m16-stage`, ramura `claude/project-thread-54wjea`): `288f1d7` (etapa), `ae1de92` (corecturile după
  poarta 1, varianta A, harta companiei) și `357dce0` (harta pe ecrane 4:3 / 5:4, legenda contoarelor, etichetele pâlniei).
  Documentație: commitul care conține acest raport (= RELEASE; arborele executabil = `357dce0`).
- Țintă: 2.19.0-m16, schema 15, **fără migrare**, contract API 21 (aditiv: 7 rute GET + `POST /api/recap/:id/present`). CONFIRMAT ÎN COD
  (`v2/server/config.mjs`).

## 2. Ce s-a schimbat și cine
- Implementare: Codex `gpt-6.1-sol` · medium, 7 rulări din bugetul de 8 (`m16-evidence\BUDGET.md`), după specificațiile
  `m16-evidence\spec\SPEC-R*.md`. Coordonare, QA și corecturi delimitate: Claude (această sesiune): ruta unică `/api/owner/intent`,
  `faceGeometry` (figura tăiată), fișele cerute la genitiv / articulat, dimensiunea hărții, testul browser pe Chromium-ul proiectului,
  cele 2 eșecuri ale porții 1, varianta A, cardurile hărții companiei și scalarea lor.
- Review: 2 review-uri independente Claude, doar citire, effort medium — review 1 (date, perioade, autoritate, intenții, sincronizare,
  voce): 3 MAJOR + 5 MINOR; review 2 (interfață, accesibilitate, performanță, regresii): 3 MAJOR + 8 MINOR. Toate reparate, cu teste de
  regresie (`m16-evidence\reviews\`). O re-verificare independentă (doar citire, effort medium) a
  corecturilor review 2 și a lui `ae1de92`: toate constatările review 2 confirmate reparate, fără BLOCKER / MAJOR, 3 MINOR — reparate în
  `357dce0` (etichetele pâlniei fixate de test, legenda contoarelor, cardurile pe ecrane 4:3 / 5:4).
- Server nou (doar citire): `owner/recap.mjs`, `owner/ro-text.mjs`, `owner/command-routes.mjs`, `owner/process-sheets.mjs` +
  `config/process-sheets.json`, `domain/company-graph.mjs`, `domain/system-map.mjs`, `sales/funnel.mjs`, `factory/trace.mjs`; intenții noi
  `recap`, `recap_control`, `command_mode`, `command_view`, `command_numbers`, `department_show`, `process_sheet` (toate READ_NAVIGATE).
- Interfață: `#/comanda` (Mod Comandă) și `#/comanda?ecran=tv`, `screens/command/*`, `lega/RecapCard.jsx`, `SheetCard.jsx`,
  `shell/CommandBridge.jsx`, `lib/commandModel|commandSync|companyGraph|roText|funnelLogic|factoryTrace|systemMap.js`, `styles/m16.css`.
  Componentele existente rămân (Compania → Structură, Pipeline, Fabrică, Sistem).

## 3. Matricea de acceptare
Teste: `v2/tests/m16-server|m16-intents|m16-hub|m16-voice|m16-ui-logic|m16-ui-e2e.test.mjs`. Toate TESTAT ACUM ÎN MEDIU IZOLAT (Hub
sintetic, furnizori simulați), apoi în poarta 3.

| AC | Cod | Test (exemple) | Rezultat |
| --- | --- | --- | --- |
| 01 Mod Comandă din UI / Alt+C / intenție; Esc | `Command.jsx`, `Shell.jsx`, `intents.mjs command_mode` | e2e (Alt+C, „Mai mult”, Esc), m16-intents | PASS |
| 02 Lizibil la 4K / 1080p / 1440×900 / 1280×800, îngust fără scroll | `m16.css` | e2e: 9 vederi × 5 dimensiuni, 0 scroll orizontal, 0 texte < 22 px la 1080p și 4K, cardurile hărții fără suprapuneri | PASS |
| 03 Repaus + „Ascunde cifrele” în ambele ferestre | `commandModel idleFigures` | e2e (TV), m16-ui-logic | PASS |
| 04 Două ferestre, o captură audio, închidere / reconectare | `commandSync.js` (listă albă, rev / boot / vârstă) | m16-ui-logic (sync), e2e: TV doar GET, 0 apeluri getUserMedia, „Fereastra principală s-a închis” | PASS |
| 05 6 capitole în ordine, ≤ 4 indicatori, metadate | `recap.mjs` | m16-server „exact ordered indicators…”, m16-hub | PASS |
| 06 Card = text = voce; predarea etichetată separat | `recap.mjs speech`, `runtime/lega.mjs presentRecap`, `recap_heard` | m16-voice (un capitol pe tură, „auzit” doar din transcript) | PASS (simulat) |
| 07 Zero / nimic nou / necunoscut / sursă căzută / vechi / sintetic | `recap.mjs`, `commandModel freshness` | m16-server R3/R4, m16-ui-logic R5 | PASS |
| 08 Comenzi contextuale; opririle prioritare; citate / negații / typo | `intents.mjs recap_control`, `intake.mjs` | m16-intents (8), m16-voice (10 opriri) | PASS |
| 09 Proveniența relațiilor; decorul marcat | `company-graph.mjs` | m16-server „registered observations…”, e2e (decor oprit) | PASS |
| 10 Departamente: mouse / tastatură / voce; a11y | `screens/command/Company.jsx` | e2e (Enter, ← →, „Arată Vânzările”), m16-intents | PASS |
| 11 Fișe: inventar, referințe, autonomie din politică | `process-sheets.mjs` | m16-server „every skill folder, every reference…” | PASS |
| 12 Nicio autoritate nouă; Stop All / gărzi | rutele refuză canalele agent / cli | m16-hub (0 rulări / planuri / aprobări noi), e2e (niciun buton de decizie, Stop All vizibil) | PASS |
| 13 ≥ 30 FPS la 1080p; ascuns; mișcare redusă | `LegaFace`, `m16.css` | `shots\perf\perf.json` (cod final): 60 FPS cu 1 și cu 2 ferestre, 0 cadre ascuns, 3 cadre/s statice la mișcare redusă | PASS |
| 14 Build + regresia V2 completă, 0 FAIL | — | poarta 3 (§4) | PASS (poarta 3: 2753 / 2754, 0 FAIL) |
| 15 Varianta = alegerea ta | `m16.css`, `Command.jsx data-variant="A"` | e2e (A, fără selector) | PASS (A, „ok” la 08:31) |
| 16 Probă reală pe live cu vocea ta; acceptarea separată | — | sesiunea ta (§9) | AȘTEPTĂ PROPRIETARUL |
| 17 Pâlnia: numărători, prag, date lipsă, conversie, nicio trimitere | `sales/funnel.mjs` | m16-server „exact 24h boundary…”, e2e | PASS |
| 18 Traseul Fabricii: etape, bucle, actori, durate, dovezi | `factory/trace.mjs` | m16-server „recorded windows, repair loop…”, e2e (CLOSED) | PASS |
| 19 Rezultatul din artefacte, fără acceptare / regenerare | `screens/command/Result.jsx` | e2e (zoom, focus, niciun buton de decizie) | PASS |
| 20 Harta sistemului + căutare: inventar, stare, prospețime | `system-map.mjs` | m16-server, e2e („Codex” → 1 nod; deconectare → fără LIVE) | PASS |

## 4. Rulări
- Codex (TESTAT ÎN CLONĂ): r1 server 01:20–01:53 (33 min), r1 interfață 01:20–01:41, r2 interfață 02:06–02:21 (cu 5 capturi), r3 server
  02:15–02:28, r3 interfață 02:28–02:37, r4 server 02:31–02:37, r5 interfață 02:50–03:02; toate exit 0 (`m16-evidence\runs\r*.meta`).
- Suitele existente atinse (46 de fișiere: L3ga, voce, intenții, M15, Studio din L3ga): 293/293 (`runs\t-affected-1.log`).
- **Poarta 1** pe `288f1d7` (clonă curată `m16-gate-1`, 03:30 EEST → 03:59 EET, 5318 s, CPU 34–100 %): 2754 = 2749 PASS, **2 FAIL**
  (M12-SC-06, M02-UI-11 — verificări de structură încălcate de M16), 3 SKIP (`gate\run1`). Rămâne o rulare cu eșecuri.
- După corecturi (TESTAT ÎN CLONĂ): logică + structură 123/123; Hub + voce + browser 14/14; browser după hartă 1/1; verificarea nouă a
  hărții pică pe vechea dispunere (`runs\mut\t-mutation.log`).
- **Poarta 2** pe `ae1de92`: oprită de mine la 08:59 după 10 minute (428 PASS / 0 FAIL până atunci, `gate\run2`), fiindcă sonda
  hărții a găsit carduri suprapuse pe ecrane 4:3 / 5:4 și urma o schimbare de cod. Nu e o dovadă pentru codul final.
- După corecturile din `357dce0`: sonda hărții curată la 16 dimensiuni; logică + structură 124/124; Hub + voce + browser 14/14;
  verificarea nouă pică fără corectură (`runs\mut\t-mutation-2.log`).
- **Poarta 3** pe `357dce0` (clonă curată `C:\Users\mihai\m16-gate`, build UI + build Studio în clonă, singura variabilă
  `HUB_V2_STUDIO_DIST`, Node 24.14.0, pornită la 09:06): 2754 teste = **2753 PASS, 0 FAIL**, 0 anulate,
  1 SKIP (T25: legătură simbolică de fișier fără privilegiu Windows, cunoscut din etapele anterioare); M09-SB-01 (Studio în browser) PASS;
  5079 s (09:06–10:31), CPU 27–100 % (medie 54 %, 83 de eșantioane, alte procese ale PC-ului incluse); `git status` curat înainte și
  după; jurnal `m16-evidence\gate\test-v2.log`, contextul în `gate.meta`. TESTAT ACUM ÎN MEDIU IZOLAT.
- V1 nu s-a rulat: M16 nu schimbă niciun fișier în afara `v2/` (`git diff --name-only 9b91bca 357dce0`).

## 5. Variante
Capturile A / B / C la 1920×1080 și 1440×900: https://claude.ai/artifact/GoAJmiYXzCX5b5VVWHNpwg (`m16-evidence\shots\r2`). Varianta
aleasă: **A „Carbon și cyan”**; capturile finale ale lui A, 9 vederi × 5 dimensiuni
plus harta la 1100×1080, 1280×1024 și 1600×1200: `m16-evidence\shots\fix5`; harta la 16 dimensiuni: `shots\sizes3`.

## 6. Performanță și două ferestre
Măsurat pe PC (i5-11400H, RTX 3050 Laptop + Intel UHD, Chromium cu GPU prin ANGLE D3D11, Hub sintetic), pe codul final, 2026-10-25
10:39 (`m16-evidence\shots\perf-final\perf.json`; prima măsurare, pe codul rundei 4, în `shots\perf`). TESTAT ACUM ÎN MEDIU IZOLAT.
- O fereastră 1920×1080, animat: pagina 60,1 FPS, figura 59,9 FPS, 0,09 ms CPU pe cadru (CPU-ul PC-ului 57 → 76 % în timpul probei).
- Două ferestre (principală + afișajul deschis cu „Al doilea ecran”): 60 / 59,9 FPS în fiecare.
- Document ascuns: figura 0 cadre. Mișcare redusă: imagine statică redesenată la 500 ms (3 cadre/s), fără animație.
- Ținta de 30 FPS la 1080p e depășită. Pe televizorul tău real nu s-a măsurat (NEVERIFICAT; se vede în sesiunea de acceptare).

## 7. Vocea
- TESTAT ÎN MEDIU IZOLAT, cu furnizor simulat: un capitol pe tură, textul rostit = textul cardului, „Predat vocii” separat de „Rostit”
  (confirmat doar din transcriptul asistentului), răspunsul dublat al agentului reținut, 10 variante de oprire cu prioritate.
- NEVERIFICAT încă live: audio real, recunoașterea comenzilor rostite de tine și lizibilitatea de la 2–3 m. Le verifici în sesiunea ta
  (§9); vocea folosește exclusiv ruta deja aprobată, pornită de tine.

## 8. Release, backup, verificare, remote, revenire
- Scriptul unic `m16-evidence\release\release.mjs <RELEASE>` (pașii 1–7 din §9, se oprește la prima eroare și recunoaște pașii deja
  făcuți): recitește live și folderul Hub (ramura, HEAD = BASE sau RELEASE, fișiere urmărite curate) → aduce RELEASE din clonă și verifică
  SHA-ul, ascendența și că arborele executabil = `357dce0` (testat în poarta 3), plus identitatea 2.19.0-m16 / contract 21 →
  instantaneu doar-citire `live-before.json` → backup prin API-ul Hub-ului (devine „verified” abia după restaurarea arhivei într-un
  folder separat) → fast-forward `v2-milestone-01` (fără reset, fără force, fără commit) → `upgrade.mjs --plan`, apoi `--apply` (fără
  migrare) → `verify.mjs` (doar GET: versiune, contract, schemă, BUILD_SAFE, canalele deciziilor rezervate, rutele și ecranele M16,
  canalul agent refuzat, apoi Birou intern, livrări, Fabrică, Vânzări, aprobări și inbox comparate cu instantaneul).
- Pasul 8, separat: `git push origin v2-milestone-01 claude/project-thread-54wjea` (fără force), apoi verificarea SHA-ului pe GitHub.
- Rezultatul efectiv (ore, backup, verificare, push) e consemnat în commitul de documentație de după release (`STAGE_2026-10-25_M16.md`
  §5) și în mesajul din thread.
- **Revenire** (verificată în izolare pe o clonă: diff gol pe `v2/` și `package*.json`, rezultat 2.18.1-m15 / contract 20): în folderul
  Hub `git revert --no-edit 9b91bca..357dce0`, apoi `node v2\scripts\upgrade.mjs --plan` și `--apply`. Fără migrare și fără date noi în
  bază (rezumatele stau doar în memorie), deci baza nu se restaurează. Punctul de revenire: `9b91bca`.

## 9. Ce rămâne pentru tine
1. Sesiunea scurtă de acceptare (~10 minute): `m16-evidence\PASII_PROPRIETAR_M16.md` (vocea pornită de tine, „Ce s-a întâmplat azi?”,
   următorul / repetă / înapoi / oprește, harta, Vânzările, o fișă, un rezultat, harta sistemului, lizibilitatea pe TV).
2. Scrii „Accept M16” sau ce nu a mers. Până atunci starea rămâne READY_FOR_OWNER_ACCEPTANCE.

## 10. Limitări și observații neblocante
- Probele de audio real și lizibilitate fizică nu se pot face fără tine (vezi §7).
- Sub 1100 px lățime harta companiei e o grilă pe două coloane (fără elipsă), intenționat.
- Pâlnia nu calculează conversii până nu există cel puțin 5 oportunități reale în cohortă („Date insuficiente”), cum cere specificația.
- Poarta 2 (pe `ae1de92`) a fost oprită de mine după 10 minute, fără eșecuri, ca să repar harta; dovada pentru codul final e poarta 3.
- V1 nu s-a rulat: nimic în afara `v2/` nu s-a schimbat.
- NIT: orbitele decorative ale hărții devin ovale pe elipsă (sunt marcate „decor, fără semnificație” și se pot opri).
- O preferință veche `command.variant` rămasă în browser e ignorată (aspectul e fix A).
