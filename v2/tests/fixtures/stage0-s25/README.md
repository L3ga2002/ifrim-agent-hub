# §25 step-0 candidates (2026-10-11, live, rejected by the Codex test review)

Byte-exact copies of the six acceptance-test candidates the Hub assembled (header + author body) for the §25 privacy revision,
rebuilt from the Hub database with `parseAuthorOutput` + `assembleTestFile`; the 12-hex prefix in each name is the sha256 the
reviews recorded (`factory_reviews.change_set_sha`). Stored as `.txt` so `node --test` never collects them.

| File | Mission | Author run | Review run | Verdict |
|---|---|---|---|---|
| c1 | mis_mv2ql0fp_ee35f8071e | run_mv3a33nl_e0cb900fda | run_mv3aa7rz_e56e12ce71 | CHANGES_REQUESTED |
| c2 | mis_mv2ql0fp_ee35f8071e | run_mv3ab9pm_76730c2024 | run_mv3aioqe_79d35d999a | CHANGES_REQUESTED |
| c3 | mis_mv3b251g_754a6a2159 | run_mv3b5ikj_e82d988fa6 | run_mv3bc9le_6c12baf12e | CHANGES_REQUESTED |
| c4 | mis_mv3b251g_754a6a2159 | run_mv3bd8h9_4485154d23 | run_mv3bn58k_b5918f4157 | CHANGES_REQUESTED |

| c5 | mis_mv3wfpyy_d440c4ec5c | — | run_mv3zitzf_987830bb1c | PROVEN; CHANGES_REQUESTED (insufficient literal checks) |
| c6 | mis_mv3wfpyy_d440c4ec5c | — | run_mv3zpvpq_224f49de21 | CHANGES_REQUESTED (lost P77/P100) |
| amend-reference | synthetic amendment of c5 | no provider | deterministic matrix | keeps c5 checks; passes correct app, rejects 16 defective variants |
| r1-a26a0bca8061 (+ manifest) | isolated rehearsal, synthetic app | Claude cycle-1 amendment | independent Codex review | CHANGES_REQUESTED; keeps all c5 checks but completes only part of the findings |
| r1-review0.parsed.json | isolated rehearsal, c5 cycle-0 review | — | Codex, parsed review with checks | P75–P77, P98–P100, P124 classified insufficient |

The coordinator supplied the r1 test, manifest and parsed cycle-0 review byte-exact; these files are immutable rehearsal evidence.
T-AMEND-04 confirms c5 → r1 has `removed = []`. r1 passes the correct app and the defective **escaped value other key** variant;
it fails the original app and the other 15 variants in the `r-amend.test.mjs` matrix (assertion failures).
The decoded `Object.hasOwn(b, "phone")` check catches escaped keys, but does not detect an escaped phone value under another key.

## Fourth live §25 attempt (2.14.9, 2026-10-11 20:20–20:34 UTC, mission mis_mv49pj8t_91920fa038)

| File | Author run | Review run | Verdict |
|---|---|---|---|
| c7-be8da1183055 | run_mv49psd4_31e803e58f (Claude sonnet, cycle 0) | run_mv49y4o4_8b0b592117 (Codex) | CHANGES_REQUESTED, 12 checks `insufficient` |
| c8-c8068c3b9b1a | run_mv49zhjw_cb71c8ba84 (Claude sonnet, cycle 1, amends c7) | run_mv4a5t9v_a0f21baa5c (Codex) | CHANGES_REQUESTED: nothing removed, every check `kept`; AC-1/AC-2 open |

Byte-exact copies of the Hub blobs (sha256 prefix in the name). c8 passes the correct app and rejects the 16 variants of
`r-amend.test.mjs`, but passes `variant-escape-in-text-other-key.js.txt` (the phone escaped inside a longer text under another key):
its decoded helper compares strings by exact equality, as the reviewer found. Not used by a test yet (evidence for the next stage).

## Referința R-JSON / R-EXISTING (2.14.10-m11, date sintetice)

`json-reference.body.mjs.txt` și `json-reference.manifest.json` au o identitate nouă; candidații istorici rămân neschimbați.
Prima programare este creată prin POST într-o sesiune anterioară, apoi serverul este repornit pe același `dbPath`.
Pentru ambele programări se verifică în SQLite id-ul, ziua și telefonul exact, iar în răspunsul public ambele id-uri trebuie
să apară în `bookings`, inclusiv pentru fiecare dintre cei cinci parametri anonimi. Corpul brut integral este verificat
cu `exposes`; controalele de refuz, absența salvării după fiecare refuz, persistență exactă și creare validă sunt păstrate.

- Helper: `json-exposure`, versiunea 1, SHA-256 `984e7cf2876ddbf514b1a6b6c86741736946f64adf8edf0ef0215369b136704f`.
- SHA-256 se calculează pe `HUB_HELPERS["json-exposure"].lines.join("\n")`. Comentariul cu identitatea este adăugat
  separat înaintea liniilor canonice pentru a evita o amprentă autoreferențială; verificarea integrității include și comentariul.
- Referința asamblată cu manifestul, `helpers: ["json-exposure"]` și metadatele implicite ale antetului:
  SHA-256 `88459488ee36ddde0e152778998d18ed27f2881e791a414057180d70518f5346`.
- Valorile sunt căutate atât exact cum sunt date, cât și fără spații la capete; validarea cere în continuare minimum trei
  caractere după trim. `values` conține telefoanele exacte citite din stocare / trimise în cerere, nu variante reintroduse manual.
- Aserțiunile `exposes` rulează după curățarea resurselor, în callback-ul cazului; pentru parametri, într-un `for…of`
  peste cei cinci parametri anonimi. Nicio aserțiune sau limită a referinței nu a fost eliminată ori slăbită.
- `r-json.test.mjs` verifică aplicația corectă, originalul, cele 16 defecte din `r-amend`, scăparea prin text JSON-escaped
  și variantele cu înregistrare absentă, altă zi, telefon nepăstrat sau listă incompletă. Rezultatele c8 sunt dovezi comparative.
- c7 și c8 nu au manifeste separate în acest director; testul reconstituie `needs` din importurile lor și verifică
  reasamblarea octet cu octet, inclusiv amprentele din numele fișierelor.

## Repetiția izolată 2.14.10 (2026-10-12, aplicația sintetică, fără Hub-ul live)

| Fișier | Rulare | Rezultat |
|---|---|---|
| rh0-528c5d61e2bd (+ manifest) | autor Claude sonnet medium, doar citire, sesiunea `c80e3c56-87de-4ef8-8ae0-7f151c78dedc` | lint curat, PROVEN (AC-1/AC-2 pe aserțiunile `exposes`), helper `json-exposure` v1 `984e7cf2…` |
| rh0-review.parsed.json | verificator Codex gpt-6.1-sol medium, doar citire, sesiunea `01a12eea-5aa9-73e3-8b61-6abfc96179dd` | CHANGES_REQUESTED: telefonul salvat nu e comparat cu cel trimis; refuzul numără doar ziua testată |
| rh1-c57c518694c7 (+ manifest) | completare Claude, `amends` = rh0, sesiunea `f27f77f2-a170-44db-8202-8d5c62057a83` | lint curat, nimic eliminat, PROVEN |
| rh1-review.parsed.json | Codex, sesiunea `01a12eed-e994-7c91-9676-7ecb725980a5` | PASS, toate verificările anterioare `kept` |

Calibrarea rh1 (29 de variante): trece pe aplicația corectă și pică pe cea inițială; respinge cele 16 defecte din `r-amend`
(refuză-tot prin controale; AC-1/AC-2 pică acolo la pregătire, pentru că nicio programare nu se poate crea), scăparea c8 și variantele noi
de existență și listă, dar **trece** pe „existing records only” (telefon doar pentru programările de la 11:00 încolo) și pe o variantă
suplimentară „doar programările sintetice (seed)”: testul își creează înregistrarea existentă la 09:00, cu `seed: false`. Referința
`json-reference` are aceeași limită pentru seed. Repetiția e incompletă; dovezi pentru etapa următoare.

## Referința R-EXISTING v2 (2.14.11-m11)

`existing-reference.body.mjs.txt` și `existing-reference.manifest.json` au identitate nouă.
Fișierul asamblat cu metadatele implicite ale antetului și `helpers: ["json-exposure"]` are
SHA-256 `8bf1d3f7465e45e8621385d5cc5bfd54b774751bf6575a6ddfc8db51d7648245`.
Helperul rămâne `json-exposure`, versiunea 1,
SHA-256 `984e7cf2876ddbf514b1a6b6c86741736946f64adf8edf0ef0215369b136704f`.

Aplicația pornește cu inițializarea normală, pe stocare temporară și cu ora injectată fixă.
Referința citește toate programările zilei din SQLite, verifică id-ul, ziua și telefonul exact,
apoi creează prin API o programare pe un interval liber oferit de API-ul slots, repornește pe
aceeași stocare și creează încă una pe un interval liber recitit. Toate programările inițiale,
cea păstrată și cea nouă trebuie să rămână în tabloul listei, fără rânduri suplimentare, atât la
cererea de bază, cât și pentru fiecare parametru anonim. Toate telefoanele lor intră în `values`;
`exposes` verifică întregul corp brut după curățarea resurselor. Fiecare refuz compară toate
rândurile și coloanele din stocare cu cele de dinainte, fără să ceară o tabelă goală.

Cele cinci criterii pentru telefon au 478 / 451 / 322 / 323 / 126 caractere și rămân identice
prin `checkSpec`; AC-1 este comprimat față de șablonul de 510 caractere, fără pierderea obligațiilor.
Specificația 2.14.10 are un hash diferit: schimbarea textelor definește un contract nou.

Rezultate înregistrate de `T-EXIST-MATRIX` din `r-existing.test.mjs`, fără furnizori de modele:
aplicația corectă trece 5/5 cu fiecare dintre cele trei teste. Inventarul fix, în ordinea din cod:

| Nr. | Variantă defectă | json-reference | rh1 | existing-reference |
|---|---|---|---|---|
| 1 | original | FAIL | FAIL | FAIL |
| 2 | refuse-all | FAIL | FAIL¹ | FAIL |
| 3 | phone lost on save | FAIL | FAIL | FAIL |
| 4 | browser-only validation | FAIL | FAIL | FAIL |
| 5 | masked value | FAIL | FAIL | FAIL |
| 6 | includePhone bypass | FAIL | FAIL | FAIL |
| 7 | debug other key | FAIL | FAIL | FAIL |
| 8 | empty list | FAIL | FAIL | FAIL |
| 9 | invalid request saved | FAIL | FAIL | FAIL |
| 10 | missing-property accepted | FAIL | FAIL | FAIL |
| 11 | id only in metadata | FAIL | FAIL | FAIL |
| 12 | fields=phone other key | FAIL | FAIL | FAIL |
| 13 | phone in text | FAIL | FAIL | FAIL |
| 14 | phone as key | FAIL | FAIL | FAIL |
| 15 | escaped key and value | FAIL | FAIL | FAIL |
| 16 | escaped value other key | FAIL | FAIL | FAIL |
| 17 | existing records only | FAIL | PASS | FAIL |
| 18 | escape in text other key | FAIL | FAIL | FAIL |
| 19 | seed ignored, leak only before restart | FAIL | FAIL | FAIL |
| 20 | existing record absent after restart | FAIL | FAIL | FAIL |
| 21 | existing record on another day | FAIL | FAIL | FAIL |
| 22 | existing phone not persisted | FAIL | FAIL | FAIL |
| 23 | empty list, base | FAIL | FAIL | FAIL |
| 24 | empty list, debug | FAIL | FAIL | FAIL |
| 25 | existing omitted, base | FAIL | FAIL | FAIL |
| 26 | existing omitted, debug | FAIL | FAIL | FAIL |
| 27 | ids only in metadata, base | FAIL | FAIL | FAIL |
| 28 | ids only in metadata, debug | FAIL | FAIL | FAIL |
| 29 | seed rows only | PASS | PASS | FAIL |

¹ Pentru `refuse-all`, rh1 pică la AC-1/AC-2 cu `HUB_SETUP idA/idC: Error`, iar controalele
AC-4/AC-5 pică prin aserțiuni. Noua referință pică prin `ERR_ASSERTION` la POST-ul care trebuia
să răspundă 201 și la AC-4/AC-5. Toate eșecurile noii referințe pe cele 29 de variante sunt
`ERR_ASSERTION`, fără mesaje `HUB_`; json-reference respinge celelalte 28 de variante,
iar rh1 respinge celelalte 27. Testele istorice rulează cu octeții lor originali.

Pe aplicația originală, noua referință este `PROVEN` în două rulări identice: numai AC-1 și AC-2
pică, exclusiv pe aserțiunile directe `assert.deepEqual(exposes(`, cu originea `behaviour`.
Controalele trec. Lintul nu are încălcări și nici semnalul `existing_record_unproven`.

Variantele suplimentare enumerate pentru calibrare în T-EXIST-ALL-01/02/05 sunt opt (2 + 3 + 3),
în afara inventarului de 29; nu se adaugă variante nespecificate pentru a ajunge la unsprezece:

| Test | Variantă suplimentară | existing-reference | Criterii care pică |
|---|---|---|---|
| T-EXIST-ALL-01 | initial data not created | FAIL | AC-1, AC-2: datele inițiale lipsesc |
| T-EXIST-ALL-01 | initial data without phone | FAIL | AC-1, AC-2: telefonul inițial lipsește |
| T-EXIST-ALL-02 | initial rows omitted | FAIL | AC-1, AC-2 |
| T-EXIST-ALL-02 | kept row omitted | FAIL | AC-1, AC-2 |
| T-EXIST-ALL-02 | new row omitted | FAIL | AC-1, AC-2 |
| T-EXIST-ALL-05 | seed rows only under any parameter | FAIL | numai AC-2; AC-1 trece |
| T-EXIST-ALL-05 | threshold only under any parameter | FAIL | numai AC-2; AC-1 trece |
| T-EXIST-ALL-05 | seed rows only under all=1 | FAIL | numai AC-2; AC-1 trece |

T-EXIST-ALL-03/04 reiau cele două diferențe documentate față de referințele vechi;
T-EXIST-ALL-06 reia cele șase variante de listă și `empty list`, fără a mări inventarul.
Pragul orar și marcajul intern apar numai în variantele defecte de calibrare, nu sunt reguli de produs.

Fișierele imuabile rămân identice octet cu octet: `json-reference.*`, `rh0-*`, `rh1-*`,
c1–c8 (inclusiv manifestele și review-urile), `r1-*`, `amend-reference.body.mjs.txt`,
`variant-*.js.txt` și `new-protocol.*`. În acest director se adaugă doar noua pereche de referință
și această secțiune din README; nimic din dovezile anterioare nu este rescris.

## Repetiția izolată 2.14.11 (2026-10-13, aplicația sintetică, fără Hub-ul live)

Spec-ul repetiției = cel produs de `buildEngineeringSpec` pentru cerința salvată (aceleași 5 criterii, `hubHelpers`); brief-urile din codul
2.14.11 (criteriile și brief-urile R-EXISTING v2). Fluxul urmează `factory.mjs`: un candidat respins de lint consumă rescrierea unică.

| Fișier | Rulare | Rezultat |
|---|---|---|
| e0-ad7e4544c066 (+ manifest) | autor Claude sonnet medium, doar citire, sesiunea `2541f7ba-feed-44f6-8a9b-41e98d818f6b` (încercarea 3; încercările 1–2 au primit HTTP 429 de la furnizor, fără test) | respins de lint înainte de rulare: `needs_missing` × 5 (manifestul a păstrat `"needs": []` din șablon) |
| e1-b8f25b9882ac (+ manifest) | aceeași conversație Claude, ciclul 1 (`amends` = e0), corp identic, doar `needs` completat | lint curat, nimic eliminat; dovada Hub-ului: INCONCLUSIVE (timeout) — cele 5 cazuri raportează rezultatul așteptat, dar procesul nu se închide cât timp AC-1/AC-2 pică (serverul e închis după aserțiunea care pică, fără `try/finally`); ciclul 1 = `reauthorMax` → pasul 0 epuizat, fără review Codex |
| e1-calibration.json | diagnostic, NU dovada Hub-ului: același fișier rulat cu `node --test --test-force-exit` | PASS 5/5 pe aplicația corectă; respinge pe aserțiuni aplicația inițială, toate cele 29 de variante din inventar și cele 8 variante de calibrare (38/38) |

Concluzie: conținutul testului scris de autorul real acoperă datele inițiale ale aplicației, programarea păstrată și cea nouă și respinge
toate variantele defecte; repetiția nu trece porțile din cauza a două greșeli mecanice ale autorului, prinse corect de Hub (lint și timeout).

## Antet v2 / R-NEEDS (2.14.12-m11)

Antetul 1 și toate dovezile istorice rămân identice octet cu octet. Identitățile de mai jos folosesc
metadatele implicite ale antetului, `harness: 2`, `helpers: ["json-exposure"]` și corpul original:

- e0, `normalizeNeeds(body, [])`: SHA-256 `9fd197172c5c896df2a6ee578cb6e77f10e9ae73ff4ee375f6a65f76c435de44`.
- e1, manifestul original: SHA-256 `9fd197172c5c896df2a6ee578cb6e77f10e9ae73ff4ee375f6a65f76c435de44`.
- existing-reference, manifestul original: SHA-256 `894c2836be1b37d51abedbc420a409b6bf69a96e1e8d77cb794eee48599f5536`.
- Lista completată pentru e0, exact în ordinea antetului: `node:path, node:os, node:fs, node:sqlite, node:http`.
  Primele folosiri libere sunt la liniile 37, 37, 37, 69, respectiv 3 ale corpului. Corpurile e0 și e1 sunt identice; după normalizare au aceeași identitate v2.
- Helperul `json-exposure` rămâne v1, SHA-256 `984e7cf2876ddbf514b1a6b6c86741736946f64adf8edf0ef0215369b136704f`.

Calibrare fără model pe Node v24.14.0, `node --test --test-reporter=tap`, timeout 20000 ms.
Fiecare proces a ieșit singur (`error === undefined`, `signal === null`); fiecare caz are `cleanup.ok === true`.
Toate eșecurile matricei sunt `ERR_ASSERTION`, fără mesaje `HUB_`. Coloanele arată teste/trecute/picate.

| Variantă | existing-reference / antet 2 | e1 / antet 2 |
|---|---|---|
| corect | PASS (5/5/0) | PASS (5/5/0) |
| original | FAIL (5/3/2) | FAIL (5/3/2) |
| refuse-all | FAIL (5/1/4) | FAIL (5/1/4) |
| phone lost on save | FAIL (5/2/3) | FAIL (5/2/3) |
| browser-only validation | FAIL (5/4/1) | FAIL (5/4/1) |
| masked value | FAIL (5/3/2) | FAIL (5/3/2) |
| includePhone bypass | FAIL (5/4/1) | FAIL (5/4/1) |
| debug other key | FAIL (5/4/1) | FAIL (5/4/1) |
| empty list | FAIL (5/3/2) | FAIL (5/3/2) |
| invalid request saved | FAIL (5/4/1) | FAIL (5/4/1) |
| missing-property accepted | FAIL (5/4/1) | FAIL (5/4/1) |
| id only in metadata | FAIL (5/3/2) | FAIL (5/3/2) |
| fields=phone other key | FAIL (5/4/1) | FAIL (5/4/1) |
| phone in text | FAIL (5/3/2) | FAIL (5/3/2) |
| phone as key | FAIL (5/3/2) | FAIL (5/3/2) |
| escaped key and value | FAIL (5/3/2) | FAIL (5/3/2) |
| escaped value other key | FAIL (5/3/2) | FAIL (5/3/2) |
| existing records only | FAIL (5/3/2) | FAIL (5/3/2) |
| escape in text other key | FAIL (5/3/2) | FAIL (5/3/2) |
| seed ignored, leak only before restart | FAIL (5/3/2) | FAIL (5/2/3) |
| existing record absent after restart | FAIL (5/3/2) | FAIL (5/3/2) |
| existing record on another day | FAIL (5/3/2) | FAIL (5/3/2) |
| existing phone not persisted | FAIL (5/3/2) | FAIL (5/3/2) |
| empty list, base | FAIL (5/3/2) | FAIL (5/3/2) |
| empty list, debug | FAIL (5/4/1) | FAIL (5/4/1) |
| existing omitted, base | FAIL (5/3/2) | FAIL (5/3/2) |
| existing omitted, debug | FAIL (5/4/1) | FAIL (5/4/1) |
| ids only in metadata, base | FAIL (5/3/2) | FAIL (5/3/2) |
| ids only in metadata, debug | FAIL (5/4/1) | FAIL (5/4/1) |
| seed rows only | FAIL (5/3/2) | FAIL (5/3/2) |
| initial data not created | FAIL (5/3/2) | FAIL (5/2/3) |
| initial data without phone | FAIL (5/3/2) | FAIL (5/3/2) |
| initial rows omitted | FAIL (5/3/2) | FAIL (5/3/2) |
| kept row omitted | FAIL (5/3/2) | FAIL (5/3/2) |
| new row omitted | FAIL (5/3/2) | FAIL (5/3/2) |
| seed rows only under any parameter | FAIL (5/4/1) | FAIL (5/4/1) |
| threshold only under any parameter | FAIL (5/4/1) | FAIL (5/4/1) |
| seed rows only under all=1 | FAIL (5/4/1) | FAIL (5/4/1) |

T-NEEDS-01 și T-CLEAN-01: originalul este PROVEN în două rulări identice, numai AC-1/AC-2 pică
pe aserțiunile `exposes`; controalele trec. T-CLEAN-04 verifică închiderea dublă, SQLite deja închis,
închideri care aruncă, corp eșuat urmat de cleanup eșuat, ordinea inversă și izolarea între cazuri,
resurse la nivel de fișier și închiderea blocată limitată la 5000 ms. Diagnosticul rămâne autoritar
chiar când Node păstrează eroarea aserțiunii și ascunde eroarea hook-ului. T-RUN-02 păstrează raportul
de activitate asincronă după test (`file_crash`).

T-RUN-01 folosește obiectul public `hub.factoryRunner.run` numai în test: după execuția reală a
UNUI baseline, păstrează cazurile și semnătura și întoarce `reason: "timeout", timedOut: true`.
Poarta oprește writerul, cu `factory.acceptance_unstable.cause: "incomplete"`; nu se schimbă timeout-ul
runnerului. T-FLOW-01 pornește de la copia sintetică §25 (fără testele altui contract din booking-demo),
folosește numai furnizorii falși, completează cele cinci imports fără rescriere, păstrează manifestul
și sha din pending până la protejare/baseline, apoi trece prin CHECKING, review și QA la DELIVERY_READY.
Comenzile QA și protecția testelor istorice sunt neschimbate.

Liniile exacte care înlocuiesc `setup` în antetul 2:

```js
// Antet Hub v2: resursele întoarse de setup() se înregistrează pe cazul curent și sunt închise de Hub la sfârșitul lui, la succes și la eșec (raport HUB_CLEANUP în TAP).
const hubTimer = setTimeout, hubClear = clearTimeout;
const registry = { current: null, file: [] }; const hubAdd = (label, value) => { if (value && (typeof value === "object" || typeof value === "function") && typeof value.close === "function") (registry.current?.items || registry.file).push({ label: String(label).replace(/\s+/g, " ").slice(0, 60), target: value }); return value; };
const setup = async (label, fn) => { let value; try { value = await fn(); } catch (e) { assert.fail(`HUB_SETUP ${label}: ${e?.code || e?.name || "eroare"}`); } return hubAdd(label, value); };
const hubClose = ({ target }) => new Promise((resolve) => { let settled = false; const finish = (ok, status) => { if (!settled) { settled = true; hubClear(timer); resolve({ ok, status }); } }; const timer = hubTimer(() => { try { target.closeAllConnections?.(); } catch {} try { target.unref?.(); } catch {} finish(false, "blocat"); }, 5000); timer.unref(); (async () => { try { if (target.listening === false || target.isOpen === false) { finish(true, "deja închis"); return; } if (typeof target.listening === "boolean") await new Promise((done, fail) => target.close((e) => e ? fail(e) : done())); else await target.close(); finish(true, "închis"); } catch (e) { if (e?.code === "ERR_SERVER_NOT_RUNNING" || e?.code === "ERR_INVALID_STATE") finish(true, "deja închis"); else finish(false, `eroare ${String(e?.code || e?.name || "necunoscută").replace(/\s+/g, " ").slice(0, 60)}`); } })(); });
const hubCleanup = async (t, items) => { const details = [], bad = []; for (const item of [...items].reverse()) { const { ok, status } = await hubClose(item), detail = `${item.label}: ${status}`; details.push(detail); if (!ok) bad.push(detail); } t.diagnostic(`HUB_CLEANUP ${bad.length ? "fail" : "ok"} ${items.length}${details.length ? ` ${details.join("; ")}` : ""}`); if (bad.length) throw new Error(`HUB_CLEANUP ${bad.join("; ")}`); };
test.beforeEach(() => { registry.current = { items: [] }; });
test.afterEach(async (t) => { const items = registry.current?.items || []; registry.current = null; await hubCleanup(t, items); });
test.after(async (t) => { await hubCleanup(t, registry.file.splice(0)); });
```

Duratele celor două rulări e1 din T-CLEAN-01: 349 ms și 331 ms (ieșire normală, fără timeout).

## Repetiția izolată 2.14.12 (2026-10-13, aplicația sintetică, antet v2, fără Hub-ul live, fără `--test-force-exit`)

| Fișier | Rulare | Rezultat |
|---|---|---|
| f0-682a820d4e17 (+ manifest) | autor Claude sonnet medium, doar citire, sesiunea `866326c0-75ff-4d77-b90e-cac723a4aef8` (încercarea 2 a ciclului 0; încercarea 1, sesiunea `566bc518-…`, s-a blocat în gândire: patru mesaje oprite la `max_tokens`, fără text → răspuns necitibil, încercare nouă, nu rescriere) | `needs` declarat `[]`, completat de Hub cu `node:path, node:os, node:fs, node:sqlite, node:http`; lint curat; dovadă PROVEN, 2 rulări a câte 321 / 330 ms, ieșire normală, fiecare caz cu raport `HUB_CLEANUP ok` |
| f0-review.parsed.json | verificator Codex gpt-6.1-sol medium, doar citire, sesiunea `01a1354d-b379-7531-b37b-cf77da0a3aad` | CHANGES_REQUESTED: stocarea comparată doar prin numărul rândurilor; `values` poate omite telefoane; înregistrarea păstrată identificată doar prin telefon; intervalele fixate fără contractul grilei; P211/P220/P229/P140 `insufficient` |
| f1-a3f0c1f5b54d (+ manifest) | completare Claude, `amends` = f0, aceeași conversație (`--resume`) | `needs` completat din nou de Hub; lint curat; nimic eliminat (35 de verificări cu context schimbat, 3 semnale `completion_unmapped`); PROVEN, 318 / 321 ms, ieșire normală |
| f1-review.parsed.json | Codex, sesiunea `01a13554-ede1-7232-bf38-d1667cdbe2d5` | CHANGES_REQUESTED: toate verificările anterioare `kept`, niciun `lost`; AC-3/AC-4/AC-5 acoperite; AC-1/AC-2 deschise (telefoanele care nu sunt șiruri excluse din aserțiune și din `values`; identitatea și telefoanele rândurilor inițiale nefixate înainte de repornire; id-ul celei de-a doua creări necapturat) → pasul 0 epuizat |
| f1-calibration.json | matricea fără `--test-force-exit` (29 + 8 variante + aplicația corectă), nod `C:\Program Files\nodejs\node.exe` v24.14.0 | f0 și f1: aplicația corectă PASS 5/5; cele 29 de variante din inventar respinse pe aserțiuni; dintre cele 8 de calibrare suplimentare, **„initial data without phone” trece** (testul nu afirmă că telefoanele rândurilor inițiale sunt nevide); 0 procese blocate, `cleanup.ok` la fiecare caz |

Cele două blocaje mecanice ale repetiției 2.14.11 nu au mai apărut: omisiunea `needs` a fost completată de Hub în ambele cicluri, fără să
consume rescrierea, iar testul care pică pe AC-1/AC-2 a ieșit normal în sub o secundă, cu resursele închise de antetul v2. Oprirea s-a
făcut la poarta de conținut (review-ul Codex al completării), nu la cea mecanică; release-ul și cardul §25 nu au fost făcute.
