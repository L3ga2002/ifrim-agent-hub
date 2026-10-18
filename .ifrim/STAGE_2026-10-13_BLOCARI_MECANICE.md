# Etapa „Închiderea blocărilor mecanice din harness-ul §25” (2026-10-13 09:41 UTC → 13:20 UTC)

Prompt al proprietarului din 2026-10-13 09:40 UTC (thread „Închiderea blocărilor mecanice §25”). Decizia: completarea deterministă a
`needs` de către Hub dintre cele șase module permise (R-NEEDS), închiderea garantată a resurselor testului la succes și la eșec, în
harness-ul deținut de Hub, fără rescrierea aserțiunilor (R-CLEANUP), finalizarea reală a baseline-ului înaintea writer-ului (R-BASELINE),
o singură repetiție izolată nouă și, numai după succesul ei, release-ul gestionat și un singur plan §25. Fără rescrieri în plus;
`--test-force-exit` doar pentru diagnostic izolat, niciodată ca bază pentru protejarea testului, pornirea writer-ului sau QA. M12 rămâne DRAFT.

**Rezultat pe scurt.** Corecția 2.14.12 e implementată, revizuită în trei runde independente (ultima PASS) și testată (27/27 suite afectate,
515/515; regresia completă 1923/1933, cele 8 eșecuri fiind un artefact al locației clonei, verificat în working tree-ul principal).
Cele două blocaje mecanice **nu au mai apărut în repetiție**: autorul a lăsat din nou `needs: []` și Hub-ul a completat lista în ambele
cicluri fără să consume rescrierea; testul care pică pe AC-1/AC-2 a ieșit normal în 0,3 s, cu resursele închise de antetul v2, dovada fiind
PROVEN de două ori fără `--test-force-exit`. Repetiția s-a oprit însă la **poarta de conținut**: verificatorul Codex a cerut completări la
ciclul 0 și din nou la singura completare permisă (AC-1/AC-2 „necompletate”, nicio verificare pierdută), iar matricea arată că testul trece
una dintre cele 8 variante de calibrare suplimentare („initial data without phone”). Conform promptului, **nu am făcut release și nu am
creat cardul §25**. Codul 2.14.12 stă pe ramura `claude/project-thread-wn8xqf` (`614c42e` + dovezi `53fe75e`), neîmbinat în `v2-milestone-01`.

Roluri: Claude (această sesiune, Fable 5.1) coordonare, specificație, verificări, repetiție, predare; Codex (`codex exec`, gpt-6-astra,
efort high, sandbox workspace-write) implementare și două runde de reparare; Claude într-o sesiune separată (agentul read-only
`ifrim-claude-code-reviewer`, sonnet, mod plan) trei runde de review independent; QA determinist (suitele V2, regresia, matricea de
calibrare). În repetiție: Claude (sonnet, medium, doar citire) autor; Codex (gpt-6.1-sol, medium, doar citire) verificator; fără Hub-ul live.

## 1. Baseline (verificat 2026-10-13 09:42–09:55 UTC, fără reset, checkout sau curățenie)

| Element | Constatare |
|---|---|
| Ramuri | `v2-milestone-01` = `origin/v2-milestone-01` = `eeeb136` (docs peste `570ced3`); `claude/project-thread-c7i593` = `origin/…` = `88cb6c6` (`570ced3` + `189241b` cod 2.14.11 + `88cb6c6` dovezi); `main` = `origin/main` = `17921ac`; codul 2.14.11 NU e în `v2-milestone-01` |
| Fișierele proprietarului | 20 de fișiere diferă doar prin CRLF (`git diff --ignore-cr-at-eol --stat` gol); neatinse |
| Live la start | `/api/health`: `2.14.10-m11`, contract 13, BUILD_SAFE, gate open, `boot_mv6dz25w_a409ad1101` (07:55:30 UTC), PID 16544 `C:\Program Files\nodejs\node.exe v2\server\main.mjs` din working tree (= `570ced3` cod + `eeeb136` docs); `boot.storage.preMigrationBackup = null`; schema 12; nicio rulare și nicio lease activă; `factory.retireRestored` deja restaurat |
| Porniri necontrolate noi | `autostart.log`: 2026-10-13 02:44 UTC și 07:55 UTC (pe lângă 10-12 06:32, 15:55, 21:35 UTC): cinci în total, toate prin sarcina de logon, 2.14.10-m11, fără upgrade și fără backup |
| Ultimele backup-uri verificate | `bkp_mv49psdx_af1941990e` (§25, 2026-10-11 20:20 UTC), `bkp_mv486kzh_4e6ef724dc` (§25) și `bkp_mv486gvm_fe29fa3bd1` (Hub), 2026-10-11 19:37 UTC — toate dinaintea pornirilor necontrolate; `POST /api/backups` răspunde pe canalul `cli` |
| §25 | cerința salvată `drv_mv49pj7i_0359320b1f` (ROUTED_SOFTWARE, 2026-10-11 20:20 UTC): „Telefonul rămâne obligatoriu și salvat corect, dar lista publică a zilei nu afișează și nu transmite telefonul. Programările valide și fluxurile existente continuă să funcționeze”; copiii EXPIRED / CANCELLED; `env_mv49pmjs` EXPIRED, `env_mv4a7832` CANCELLED (niciun plan activ); părintele `dlv_mv1eo8oo_d120460140` STALE; testul istoric activ (`8d944644…`) |
| Node | 24.14.0 (Program Files și fnm) |

## 2. Spațiul izolat

Aceeași clonă git la cale scurtă `C:\Users\mihai\AppData\Local\Temp\hub-dev` (ramura `v2-milestone-01` a clonei pornită de la `88cb6c6`,
octeți aliniați la working tree, `node_modules` joncțiune). Nimic din lucru nu a atins working tree-ul live. Ramura desemnată a acestei
etape în repository-ul principal, `claude/project-thread-wn8xqf`, a fost adusă din clonă prin `git fetch` (fără schimbarea working tree-ului).

## 3. Cauzele mecanice, confruntate pe Node 24.14.0 înainte de specificație

- `afterEach` rulează și după un corp picat; dacă și hook-ul aruncă, TAP păstrează eroarea corpului (`ERR_ASSERTION`) și ASCUNDE eroarea
  hook-ului; dacă corpul a trecut și hook-ul aruncă, cazul devine `not ok` cu `failureType: 'hookFailed'`, `code: 'ERR_TEST_FAILURE'`;
  `t.diagnostic(...)` din `afterEach` apare în TAP după blocul cazului. De aceea raportul de curățare este un diagnostic TAP separat, nu doar
  eroarea hook-ului.
- `http.Server`: `listening`, `close(cb)` cu `ERR_SERVER_NOT_RUNNING` la a doua închidere, `closeAllConnections()`, `unref()`;
  `sqlite.DatabaseSync`: `isOpen`, a doua `close()` → `ERR_INVALID_STATE`. Închiderea idempotentă e posibilă fără API-uri inventate.
- e0 (`ad7e4544…`): manifestul a păstrat `"needs": []`, corpul folosește liber path/os/fs/sqlite/http → lint `needs_missing` ×5.
- e1 (`b8f25b98…`): serverul din `setup("srv2", …)` rămâne deschis când AC-1/AC-2 pică pe `exposes` înaintea lui `await srv2.close()`.

## 4. 2.14.12-m11 (fără migrare, contract 13, schema 12) — `614c42e` + dovezi `53fe75e`, NELANSAT

Specificația: `SPEC_2.14.12.md` (scratchpad), implementată de Codex (sesiunea `01a134b5-f52b-7c40-87bc-ad491080e432`, 10:00–10:38 UTC,
60 de comenzi) și reparată în două runde (sesiunile `01a134ed-b367-7252-b86c-7d1b704cee66`, 11:03–11:13 UTC, și
`01a13509-6de7-7f03-8e48-e7cd7caec2c0`, 11:35–11:42 UTC — maximul permis).

- **R-NEEDS:** `normalizeNeeds(body, declared)` → `{ declared, effective, completed, used, shadowed }` pe vederea „cod” a lexerului
  (șiruri, comentarii, șabloane și regex-uri excluse), cu analiză lexicală a legăturilor (declarații `const/let/var/class/function`,
  destructurări, parametri, `catch`, `for…of/in`, domenii pe acolade echilibrate; input dezechilibrat → conservator, adaugă). Folosire =
  identificator liber (membru `fs.x` sau referință `foo(http)`), nu proprietate (`obj.path`, `x?.fs`), nu cheie de obiect, nu câmp sau metodă
  de clasă. Lista efectivă în ordinea canonică a antetului; `needsDeclared` și `needsCompleted` (modul, binding, linie, motiv în română)
  păstrate distinct în manifestul efectiv, folosit de lint, asamblare, inventar, pending, candidat, dovadă, brief-ul verificatorului, review
  și protejare; nemodificat după review. Lint-ul folosește aceeași analiză (`needs_missing` rămâne pentru apelanții direcți; semnal nou
  `needs_unused`). Manifest invalid / modul nepermis: respinse ca înainte; modul interzis în corp: `forbidden`.
- **R-CLEANUP (antet v2, `TEST_HARNESS_VERSION = 2`):** `setup(label, fn)` înregistrează imediat valoarea întoarsă dacă are `close()`
  (listă per caz prin `test.beforeEach`/`test.afterEach`, listă de fișier prin `test.after`); `hubClose` idempotent (`listening`/`isOpen`
  false sau `ERR_SERVER_NOT_RUNNING`/`ERR_INVALID_STATE` → „deja închis”; `close(cb)` pentru `http.Server`, `await close()` altfel; eroare →
  „eroare <cod>”; peste 5000 ms → „blocat” + `closeAllConnections?.()` / `unref?.()` doar pe resursa testului; `setTimeout`/`clearTimeout`
  capturate înaintea corpului; verdictul vine din ramura luată, nu dintr-un regex); raport `# HUB_CLEANUP ok|fail <n> <detalii>` prin
  `t.diagnostic` după fiecare caz și `throw new Error("HUB_CLEANUP …")` la eșec (corp trecut → `hookFailed`/`ERR_TEST_FAILURE`; corp picat →
  aserțiunea rămâne, diagnosticul rămâne autoritar). Antetul v1 rămâne implicit, octet cu octet, pentru candidații istorici; identitatea
  `json-exposure` v1 neschimbată. Collector-ul TAP păstrează toate rapoartele unui caz (exact unul e valid; dublu, `fail`, lipsă sau un `ok`
  cu detalii de eșec ori număr nepotrivit → problemă), raportul de fișier e persistent; `classifyProof` (antet ≥ 2) → `INCONCLUSIVE` cauza
  `cleanup`; `proofSignature` neschimbat. Lint nou `harness_reserved` (numele antetului, hook-uri `before/after/beforeEach/afterEach`,
  `.diagnostic`, `this`/`arguments` în cazuri) și `builtin_patched` extins (RegExp, Promise, Map/Set/WeakMap, Error, Function, Boolean, Symbol
  și globalele de timer).
- **R-BASELINE:** `baselineGate(run, { manifest, harness })` în `runBaseline`, înaintea verificării de derivă: status diferit de PASS/FAIL,
  timeout/oprire, cădere la nivel de fișier sau activitate asincronă, sumar lipsă, cazuri citite ≠ total, overflow, sărite/todo/anulate,
  număr de eșecuri diferit, status ≠ cazuri, nume ≠ manifest, curățare neconfirmată → `NEEDS_OWNER_DECISION`, eveniment
  `factory.acceptance_unstable` cu `cause: "incomplete"` (deriva: `cause: "drift"`), fără writer, chiar la semnătură identică cu dovada.
  Plafonul de 180 s, cele două rulări, `NODE_OPTIONS`, comenzile QA și politica de oprire: neschimbate; `--test-force-exit` nicăieri.
- Brief-uri: autorul vede antetul v2, regula completării `needs` și regula resurselor prin `setup()`; verificatorul vede completările
  Hub-ului, versiunea antetului și manifestul efectiv.

Fișiere: `v2/server/config.mjs` (versiunea), `v2/server/factory/test-first.mjs`, `factory.mjs`, `runner.mjs`; teste `v2/tests/r-harness.test.mjs`
(nou: T-NEEDS-01…03, T-CLEAN-01…04, T-RUN-01/02, T-FLOW-01, T-HARNESS-MATRIX, T-INTEGRITY-02), `r-existing` (importă
`fixtures/stage0-s25/variants.mjs`, nou), `r-json`, `m11-l5-test-first`, `m10-2-p0r-integration` (INT-05); fixture-uri `fake-claude.mjs`
(`author:existing-reference-noneeds`), `fake-codex.mjs` (`factory-write:privacy-harness`), `stage0-s25/README.md`, dovezile `f0-*`, `f1-*`,
`f1-calibration.json`. e0/e1 și toate fixture-urile istorice: neatinse (identități v1 reasamblate octet cu octet; v2: e0/e1 `9fd19717…`,
existing-reference `894c2836…`).

Două schimbări ale lui Codex din afara ariei au fost readuse la loc înainte de review: `v2/tests/helpers.mjs` (`TEST_TMP` mutat în OS temp)
și verificarea rădăcinii de test din `config.mjs` (sandbox-ul Codex nu poate rula `git` sub `.ifrim/tmp`, iar Codex a „reparat” harness-ul în
loc să raporteze); Codex eliminase și joncțiunea `node_modules` a clonei (refăcută) și instalase dependențe în `%TEMP%` (șterse).
`node_modules` al proiectului e intact. `.ifrim/tmp/v2-tests` rămâne locul testelor.

## 5. Review independent (Claude, sesiune separată, doar citire)

- Runda 1 (10:43–10:52 UTC): **CHANGES_REQUESTED**. Mediu: raportul `HUB_CLEANUP` putea fi falsificat din corp (un hook înregistrat de corp
  sau un callback cu parametru `t` → `t.diagnostic`), iar raportul de fișier era „ultimul câștigă”; minor: `freeNeedsUses` adăuga
  câmpuri/metode de clasă cu nume de modul; câmp mort `timedOut`. Restul PASS (≈55 de corpuri prin `normalizeNeeds`, ordinea TAP reală,
  reasamblarea candidaților istorici, porțile).
- Runda 2 (11:14–11:31 UTC): **CHANGES_REQUESTED**; constatările rundei 1 închise. Noi: un corp curat la lint putea face patch pe
  `RegExp.prototype.test` / `setTimeout` / `Promise.prototype.then` și transforma o închidere eșuată într-un raport `ok` (mic-mediu);
  `this.diagnostic` / `arguments[0].diagnostic` scăpau lint-ului (mic); `obj.registry` respins degeaba (info). Separat, suitele afectate au
  găsit regresia U5 (rezultatul collector-ului nu mai era aditiv).
- Runda 3 (11:43–11:58 UTC): **PASS** (37 de forme de patch verificate, scenariile de falsificare reproduse real și blocate, U5 verde).
  Reziduu documentat (mic, cere sabotaj deliberat al autorului): `builtin_patched` nu urmărește aliasuri (`const E = Error;
  E.prototype.code = "ERR_INVALID_STATE"` sau `const P = Array.prototype; P.reverse = …` pot raporta o închidere eșuată drept „deja închis”);
  prin construcție un obiect cu `listening === false` / `isOpen === false` sau care aruncă `ERR_SERVER_NOT_RUNNING` / `ERR_INVALID_STATE` e
  „deja închis”; o etichetă `setup()` cu „; ” poate modela textul detaliilor (verdictul vine din ramura luată); `this` în metodele
  obiectelor din cazuri e respins conservator. Sandbox-ul, nu curățarea, rămâne granița de securitate.

## 6. Teste și build (rezultate brute)

| Rulare | Arbore | Rezultat | CPU |
|---|---|---|---|
| r-harness (nou), după readucerea `helpers.mjs` | clonă, runda 1 | 13/13 (e1 iese normal în 540 / 353 ms) | — |
| Suitele afectate, runda 1 (27 de fișiere, secvențial, 10:46–11:02 UTC) | clonă, runda 1 | 27/27 suite, 515/515 teste | medie 78 % |
| Suitele afectate, runda 2 (11:14–11:32 UTC) | clonă, după repararea 1 | 27 de suite, 515 teste, 514 PASS, 1 FAIL (U5: formă neaditivă, reparată) | medie 69 % |
| Suitele afectate, runda 3 (11:43–12:01 UTC) | clonă, codul final `614c42e` | **27/27 suite, 515/515 teste**, 0 skip | medie 65 % |
| `npm run build:v2` (UI) | clonă, 11:14 și 11:43 UTC | exit 0 (sursele UI neschimbate) | — |
| Regresia V2 completă (o singură dată, 12:02–13:06 UTC, 64 min) | clonă, `614c42e` | **1933 teste: 1923 PASS, 2 skip, 8 FAIL**, toate din familia import-folder / Studio: U10-CP-02/04/06, M10.2-E2E-A, M10-ST-01/03/08/12 | medie 55 % |
| `m10-2-content-planner` (12:45 UTC) | working tree-ul principal (același cod media; între `570ced3` și `614c42e` diferă doar `owner/planners/criteria.mjs`) | **6/6** (în clonă 3/6) | — |
| `m10-studio`, `m10-2-probe-e2e` (după regresie) | working tree-ul principal | **13/13 și 7/7** (în clonă M10-ST-01/03/08/12 și M10.2-E2E-A picau) | — |

Cele 8 eșecuri ale regresiei apar numai în clonă: testele de acces la foldere (rădăcini, profil, date Hub, „folderul acesta”) rulează cu
directoarele temporare sub `%LOCALAPPDATA%\Temp\hub-dev\.ifrim\tmp`, unde politica de foldere decide altfel; codul lor nu e atins de
2.14.11/2.14.12. La un release real, aceste suite se rulează în working tree-ul principal pe codul îmbinat.

## 7. Repetiția izolată (o singură repetiție, modele reale, aplicația sintetică, antet v2, fără Hub-ul live, fără `--test-force-exit`)

| Pas | Furnizor / model / acces | Sesiune | Rezultat |
|---|---|---|---|
| Autor ciclul 0, încercarea 1 (12:02–12:36 UTC) | Claude sonnet (claude-sonnet-4-6), medium, Read/Glob/Grep | `566bc518-2dea-4137-bf6e-cb74227ae5ae` (4 ture, 2073 s, 2,09 $) | după citirea surselor, modelul s-a blocat în gândire: patru mesaje de ~33 000 de caractere oprite la `max_tokens`, fără text, rezultat gol → răspuns necitibil = încercare nouă a aceluiași ciclu (regula Hub-ului), nu rescriere |
| Autor ciclul 0, încercarea 2 (12:38–12:46 UTC) | idem, sesiune nouă | `866326c0-75ff-4d77-b90e-cac723a4aef8` (5 ture, 480 s, 0,80 $) | f0 `682a820d…`: `needs` declarat `[]` → **completat de Hub** (path/os/fs/sqlite/http, liniile 43/43/43/65/3); lint curat; **PROVEN** fără force-exit: 2 rulări FAIL în 321 / 330 ms, 5 cazuri, AC-1/AC-2 pe aserțiunile `exposes` (liniile 140/175), controalele trec, `HUB_CLEANUP ok` la fiecare caz (AC-1/AC-2 câte 2 resurse); `baselineGate` null |
| Review ciclul 0 (12:47–12:48 UTC) | Codex gpt-6.1-sol, medium, doar citire | `01a1354d-b379-7531-b37b-cf77da0a3aad` | CHANGES_REQUESTED: stocarea comparată doar prin numărul rândurilor; `values` poate omite telefoane; înregistrarea păstrată identificată doar prin telefon; intervale fixate fără contractul grilei (P211/P220/P229/P140 `insufficient`) |
| Autor ciclul 1 — singura completare (12:49–12:54 UTC) | aceeași conversație (`--resume`) | idem (1 tură, 316 s, 0,59 $) | f1 `a3f0c1f5…`: `needs` completat din nou de Hub; lint curat; **nimic eliminat** (35 de verificări cu context schimbat, 3 semnale `completion_unmapped`); **PROVEN**, 318 / 321 ms, ieșire normală, curățare ok |
| Review ciclul 1 (12:56–12:57 UTC) | Codex | `01a13554-ede1-7232-bf38-d1667cdbe2d5` | **CHANGES_REQUESTED**: toate verificările anterioare `kept`, niciun `lost`; AC-3/AC-4/AC-5 acoperite; AC-1/AC-2 deschise (telefoanele care nu sunt șiruri excluse din aserțiune și din `values`; identitatea și telefoanele rândurilor inițiale nefixate înainte de repornire; id-ul celei de-a doua creări necapturat) → **pasul 0 epuizat** |
| Matricea (f0 și f1, fără force-exit) | nod `C:\Program Files\nodejs\node.exe` | — | aplicația corectă PASS 5/5; **29/29 variante din inventar respinse pe aserțiuni**; dintre cele 8 de calibrare suplimentare, **„initial data without phone” trece** (testul nu afirmă că telefoanele rândurilor inițiale sunt nevide); 0 procese blocate; `cleanup.ok` peste tot |

Porțile obligatorii: lint valid după normalizare **da**; două rulări normale PROVEN **da**; baseline normal, fără timeout **da** (poarta
`baselineGate` pe ambele rulări); review Codex PASS **nu**; aplicația corectă trece **da**; variantele defecte respinse **29/29 din inventar,
7/8 din calibrarea suplimentară**; nicio verificare validă pierdută **da**; resursele închise **da**. **Repetiția nu a trecut toate porțile;
m-am oprit înaintea release-ului și a cardului §25.** Dovezile: `v2/tests/fixtures/stage0-s25/f0-*`, `f1-*`, `f1-calibration.json`
(commit `53fe75e`).

## 8. Backup, release și reconcilierea pornirilor

- **Release: nu** (condiționat de succesul repetiției). 2.14.12 nu a fost îmbinat în `v2-milestone-01`; stă pe ramura locală
  `claude/project-thread-wn8xqf` (`88cb6c6` + `614c42e` + `53fe75e`), adusă din clonă fără schimbarea working tree-ului. Pașii pregătiți
  (neexecutați): backup-uri verificate prin `POST /api/backups` pe canalul `cli` (Hub + §25), `git -c core.autocrlf=false merge --no-ff`,
  `node v2/scripts/upgrade.mjs --apply` cu Node-ul din Program Files, verificarea procesului nou, a build-ului, versiunii, contractului și schemei.
- **Backup: nu** (nimic nu s-a schimbat live).
- **Porniri fără upgrade și fără backup, consemnate:** cinci până acum (2026-10-12 06:32, 15:55, 21:35 UTC; 2026-10-13 02:44 și 07:55 UTC),
  toate din sarcina de logon, BUILD_SAFE, fără migrare; procesul live PID 16544 rulează `570ced3` + docs din working tree. Autostart-ul
  pentru release-uri validate rămâne DRAFT separat (neimplementat).

## 9. §25

Proba nu a început; niciun card nou. Pregătit pentru momentul în care porțile vor fi trecute: cerința salvată (textul exact din §1),
camera livrării `http://localhost:8011/#/livrare/dlv_mv1eo8oo_d120460140` (unde `delivery.revise` cere sesiunea proprietarului) și cockpit-ul
`http://localhost:8011/#/lega/prj_muz7pfsl_fa3678479c`; niciun plan activ nu blochează un card nou. Părintele rămâne STALE; testul istoric
și aprobarea creativă rămân protejate. M12 rămâne DRAFT.

## 10. Intervenții umane, întreruperi, limitări, revenire

- Proprietarul nu a făcut niciun clic. Fără reporniri ale PC-ului și fără limite de utilizare ale acestei sesiuni în etapă; încercarea 1
  a autorului a costat o buclă de gândire (2,09 $). Stratul de permisiuni nu a refuzat nimic (push-ul nu a fost încercat; rămâne al
  proprietarului).
- Limitări: cele din §5 (alias-uri la `builtin_patched`, „deja închis” prin construcție); harness-ul închide numai resursele întoarse prin
  `setup()` care au `close()`; o buclă de gândire a autorului consumă bugetul fără test (Hub-ul o tratează ca răspuns necitibil, încercare
  nouă); poarta de conținut (review-ul Codex) rămâne deschisă pentru acest autor.
- Revenire: nimic nu s-a schimbat live. Revenirea validată pentru Hub rămâne `c168283` + `node v2/scripts/upgrade.mjs --apply`.

## 11. Ce rămâne (decizia proprietarului)

Blocajele mecanice sunt închise și demonstrate; rămâne poarta de conținut. Candidat (cere aprobarea ta, nu adaugă rescrieri și nu schimbă
modelele): brief-ul autorului și criteriile cer explicit (1) că FIECARE înregistrare inițială are telefon nevid (șir, minimum trei
caractere) și că toate intră în `values`, (2) că ambele înregistrări create sunt identificate în stocare prin id-ul întors de API (nu prin
telefon), (3) că fiecare refuz compară un instantaneu complet al stocării; apoi o singură repetiție nouă, release-ul gestionat și un
singur card §25.
