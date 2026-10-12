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
