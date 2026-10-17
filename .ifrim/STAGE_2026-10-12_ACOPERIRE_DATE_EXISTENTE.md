# Etapa „Acoperirea datelor existente și închiderea §25” (2026-10-12 13:12 UTC → 2026-10-13 01:10 UTC)

Prompt al proprietarului din 2026-10-12 13:08 UTC (thread „Acoperirea datelor existente și §25”). Decizia: R-EXISTING se corectează astfel
încât verificarea neexpunerii să acopere datele existente proprii aplicației, programarea păstrată după repornire și programarea nouă;
helper-ul `json-exposure` v1, R-AMEND, R-INVENTORY, porțile independente și limita de o rescriere rămân. M12 nu începe; M12 rămâne DRAFT.

**Rezultat pe scurt.** Corecția 2.14.11 e implementată, revizuită de două ori (PASS) și testată (26/26 suite afectate, 502/502), dar
**repetiția izolată nu a trecut porțile**. Autorul real a scris un test al cărui conținut respinge toate cele 29 de variante defecte, însă
Hub-ul l-a oprit corect de două ori, din motive mecanice: în ciclul 0 `needs` a rămas gol și lint-ul l-a respins; în ciclul 1 (rescrierea
unică) serverul rămâne deschis când aserțiunea așteptată pică, deci dovada expiră și devine INCONCLUSIVE. Conform promptului m-am oprit
înaintea release-ului și a cardului §25. Codul 2.14.11 stă pe ramura locală `claude/project-thread-c7i593`, nu în `v2-milestone-01`, ca
autostart-ul să nu-l pornească necontrolat.

Roluri: Claude (această sesiune; a pornit pe Fable 5.1 și, după cele două limite de utilizare, a continuat pe modelul de rezervă configurat)
coordonare, diagnostic, repetiție, predare; Codex (`codex exec`, gpt-6-astra, efort high, sandbox workspace-write) implementare; Claude într-o
sesiune separată (agentul read-only `ifrim-claude-code-reviewer`, sonnet) review independent; QA determinist (matricea `r-existing`). În
repetiție: Claude (sonnet, medium) autor doar citire; verificatorul Codex (gpt-6.1-sol, medium, doar citire) nu a mai fost atins.

## 1. Baseline (verificat 2026-10-12 13:13–13:40 UTC)

| Element | Constatare |
|---|---|
| Repository / ramuri | `L3ga2002/ifrim-agent-hub`; `v2-milestone-01` = `origin/v2-milestone-01` = `570ced3` (`1c1dee5` cod 2.14.10 + `570ced3` docs, ambele deja pe origin, verificat prin `git fetch`); `main` = `origin/main` = `17921ac`, neatins |
| Fișierele proprietarului | 20 de fișiere diferă doar prin CRLF (`git diff --ignore-cr-at-eol --stat` gol); neatinse |
| Live la start | `/api/health`: `2.14.10-m11`, contract 13, BUILD_SAFE, gate open, boot `boot_mv4vkfky_7af02bd59b`, PID 15828 `C:\Program Files\nodejs\node.exe v2\server\main.mjs`, pornit la 06:32 UTC de sarcina de logon din working tree (atunci cu 2.14.10 necomis, după runda 1 de review a etapei precedente); `boot.storage.preMigrationBackup = null`; schema 12 = ultima; nicio misiune activă |
| Preflight `upgrade.mjs --plan` | 13:40 UTC și 00:39 UTC: ok, fără blocaje; dry-run cu integritate ok, rânduri neschimbate, `pending []` |
| Ultimul release oficial | `2.14.9-m11`, `upg_mv487hiw` (2026-10-11 19:38 UTC), backup-uri verificate `bkp_mv486gvm_fe29fa3bd1` (Hub) și `bkp_mv486kzh_4e6ef724dc` (§25) |
| §25 în registrul Hub | `prj_muz7pfsl_fa3678479c` (`…\ifrim-delivery-demo-detailing`, marker `booking-demo`, date sintetice); `src/server-app.js`, `catalog.js`, `slots.js` identice octet cu octet cu fixture-ul `v2/tests/fixtures/r-priv-booking` (sha `5cd66295…`, `28f44825…`, `6e624d8d…`) |

Confruntarea mecanismului: aplicația își creează la pornirea normală (`createApp({ seed = true })`, `ensureSeeds` la pornire și înaintea
fiecărui răspuns API) 3 programări sintetice pe fiecare zi afișată (10:00, 11:30, 15:00, telefon `0700 123 456`, `synthetic = 1`). Baza live a
proiectului are 25 de rânduri (15 sintetice, 10 manuale; seed-urile din 2026-10-11 au telefonul gol, create de codul dinaintea câmpului).
Corecția nu presupune seed-uri: vorbește despre „datele pe care aplicația și le creează la pornirea normală”.

## 2. Spațiul izolat

Autostart-ul pornește Hub-ul din working tree. Mecanisme existente găsite: worktree-ul `.ifrim/tmp/wt-exist` (inaccesibil acestei sesiuni,
pentru că `.claude/settings.json` interzice `Read(./.ifrim/tmp/**)`) și `codex exec --worktree`. Folosit: o clonă git locală la cale scurtă,
`C:\Users\mihai\AppData\Local\Temp\hub-dev`, cu `node_modules` ca junction către instalarea proprietarului. Clona din scratchpad avea calea
prea lungă: harness-ul de teste creează repo-uri git imbricate și `git add` pica cu „Filename too long”. Clona a fost apoi aliniată octet cu
octet la working tree-ul real, pentru că o clonă cu `autocrlf=true` scrisese CRLF, iar testele de mutație caută text LF. Sarcina Windows și
configurațiile globale nu au fost modificate.

## 3. 2.14.11-m11 (fără migrare, contract 13, schema 12) — commit local `189241b`, NELANSAT

- **R-EXISTING v2 / R-COVERAGE (criteriile):** `public_omits` (478 de caractere) și `anon_params` (451) cer pornirea normală a aplicației și
  TOATE înregistrările zilei testate din stocare (puse de aplicație, creată prin API înainte de repornire pe aceeași stocare, nouă), fiecare cu
  id, zi și valoare exactă verificate intern și id-ul în tabloul listei, la cererea de bază și la fiecare parametru anonim; lista goală și
  id-urile doar în metadate nu trec. `required_refusal` (322): stocarea rămâne neschimbată după fiecare refuz, fără cerința unei baze goale.
  Textele rămân identice prin `checkSpec` (limita de 500) și sunt ≤ 480.
- **Brief-urile autorului și reviewer-ului:** nu dezactiva și nu șterge datele inițiale; toate telefoanele nevide ale înregistrărilor relevante
  intră în `values`; fără rânduri în plus; intervalele noi vin din contractul aplicației (grila sau lista de intervale libere); un control de
  refuz compară stocarea înainte și după. Fără reguli dependente de „seed”, `synthetic` sau ora 11:00.
- **Referința nouă `existing-reference`** (identitate nouă; `json-reference`, `rh0`, `rh1` neschimbate): sha asamblat
  `8bf1d3f7465e45e8621385d5cc5bfd54b774751bf6575a6ddfc8db51d7648245`.
- **Defect R-INVENTORY găsit și reparat:** o aserțiune dintr-un helper de nivel superior (în afara unui `test(...)`) nu se potrivea niciodată
  și apărea „eliminată” la fiecare ciclu 1, chiar pe text identic; reviewer-ul ar fi fost întrebat de verificări care încă există. Acum se
  potrivește după cheie între intrările de nivel superior și poartă contextul helper-ului (`T-INVENTORY-TOPLEVEL`).
- Neschimbate: helper-ul `exposes` (sha `984e7cf2876ddbf514b1a6b6c86741736946f64adf8edf0ef0215369b136704f`, verificat), `reauthorMax` ≤ 1,
  R-AMEND, lint-ul `exposure_helper_*`, independența reviewer-ului.

Fișiere: `v2/server/config.mjs`, `v2/server/factory/test-first.mjs`, `v2/server/owner/planners/criteria.mjs`; teste `v2/tests/r-existing.test.mjs`
(nou), `r-json`, `r-priv-rev`, `m10-2-p0r-integration`; fixture-uri `fake-claude.mjs`, `stage0-s25/existing-reference.*`, `stage0-s25/README.md`.
Autor: Codex (implementare 13:29–13:39 UTC, sesiunea `01a1304d-9977-75d2-b655-547000a0665f`; reparare 14:01–14:07 UTC, sesiunea
`01a1306b-58ca-7ba1-8dca-91452153bc4d`). Commitul de dovezi `88cb6c6` adaugă candidații repetiției (`e0-*`, `e1-*`, `e1-calibration.json`).

## 4. Review independent (Claude, sesiune separată, doar citire)

- Runda 1: **PASS**. Observații low/info: un telefon reformatat (doar cifre) nu e detectat, limita cunoscută a `json-exposure` v1, iar
  helper-ul nu are voie să se schimbe; semnalul `existing_record_unproven` verifică doar o citire sqlite, iar acoperirea datelor inițiale e
  impusă intenționat de brief-uri și de reviewer.
- Runda 2 (verificarea reparației R-INVENTORY și a RP-01): **PASS**. Reviewer-ul a încercat să ascundă o eliminare reală: două aserțiuni
  identice cu una ștearsă au fost detectate, iar neutralizarea cu `if (false)` a fost detectată.

## 5. Matricea cerință → test → rezultat → dovadă

| Cerință din prompt | Test | Rezultat | Dovadă |
|---|---|---|---|
| §3 datele inițiale reale identificate și verificate | T-EXIST-ALL-01 | PASS | `existing-reference` PROVEN pe aplicația inițială (AC-1/AC-2 pică doar pe `assert.deepEqual(exposes(`), lint curat; „initial data not created / without phone” respinse |
| §3 programările inițiale, păstrate și noi rămân în listă | T-EXIST-ALL-02 | PASS | „initial / kept / new row omitted” → AC-1 și AC-2 pică |
| §4 expunere doar după pragul temporal | T-EXIST-ALL-03 | PASS | `existing-reference` respinge; `rh1` trecea |
| §4 expunere doar pentru programările sintetice | T-EXIST-ALL-04 | PASS | `existing-reference` respinge; `json-reference` și `rh1` treceau |
| §4 aceleași verificări pentru fiecare parametru anonim | T-EXIST-ALL-05 | PASS | 3 scurgeri doar sub parametru → pică doar AC-2 |
| §4 listă goală sau rânduri omise | T-EXIST-ALL-06 | PASS | 6 variante de listă și „empty list” respinse |
| §5 inventarul fix de 29 de variante și diferențele | T-EXIST-MATRIX | PASS | `json-reference` trece exact „seed rows only”; `rh1` exact „existing records only” și „seed rows only”; `existing-reference` respinge 29/29 pe aserțiuni |
| §4 criterii concise, fără trunchiere | T-JSON-SPEC-BRIEFS | PASS | 478/451/322/323/126 ≤ 480, identice după `checkSpec` |
| §4 refuz fără bază goală | RP-01 și AC-3 din referință | PASS | stocarea comparată înainte și după fiecare refuz |
| R-INVENTORY la helper-ele de nivel superior | T-INVENTORY-TOPLEVEL | PASS | text identic → `removed []`; helper schimbat → `helper:freeStart` |
| Calea reală a fabricii cu referința nouă | T-JSON-FACTORY | PASS | cycle 1, două dovezi PROVEN cu identitatea helper-ului, `exhausted` |
| Helper neschimbat | T-INTEGRITY-01 | PASS | sha `984e7cf2…` |
| §6 repetiția izolată | repetiția | **NU trece porțile** | vezi §7 |

### Rezultatul fiecărei variante defecte

Coloana `e1` = testul final al repetiției, rulat ca diagnostic cu `--test-force-exit`; nu e dovada Hub-ului.

| Nr. | Variantă | json-reference | rh1 | existing-reference | e1 (diagnostic) |
|---|---|---|---|---|---|
| 1 | original | FAIL | FAIL | FAIL | FAIL (AC-1,AC-2) |
| 2 | refuse-all | FAIL | FAIL | FAIL | FAIL (AC-1,AC-2,AC-4 control,AC-5 control) |
| 3 | phone lost on save | FAIL | FAIL | FAIL | FAIL (AC-1,AC-2,AC-4 control) |
| 4 | browser-only validation | FAIL | FAIL | FAIL | FAIL (AC-3 control) |
| 5 | masked value | FAIL | FAIL | FAIL | FAIL (AC-1,AC-2) |
| 6 | includePhone bypass | FAIL | FAIL | FAIL | FAIL (AC-2) |
| 7 | debug other key | FAIL | FAIL | FAIL | FAIL (AC-2) |
| 8 | empty list | FAIL | FAIL | FAIL | FAIL (AC-1,AC-2) |
| 9 | invalid request saved | FAIL | FAIL | FAIL | FAIL (AC-3 control) |
| 10 | missing-property accepted | FAIL | FAIL | FAIL | FAIL (AC-3 control) |
| 11 | id only in metadata | FAIL | FAIL | FAIL | FAIL (AC-1,AC-2) |
| 12 | fields=phone other key | FAIL | FAIL | FAIL | FAIL (AC-2) |
| 13 | phone in text | FAIL | FAIL | FAIL | FAIL (AC-1,AC-2) |
| 14 | phone as key | FAIL | FAIL | FAIL | FAIL (AC-1,AC-2) |
| 15 | escaped key and value | FAIL | FAIL | FAIL | FAIL (AC-1,AC-2) |
| 16 | escaped value other key | FAIL | FAIL | FAIL | FAIL (AC-1,AC-2) |
| 17 | existing records only | FAIL | **PASS** | FAIL | FAIL (AC-1,AC-2) |
| 18 | escape in text other key | FAIL | FAIL | FAIL | FAIL (AC-1,AC-2) |
| 19 | seed ignored, leak only before restart | FAIL | FAIL | FAIL | FAIL (AC-1,AC-2,AC-3 control) |
| 20 | existing record absent after restart | FAIL | FAIL | FAIL | FAIL (AC-1,AC-2) |
| 21 | existing record on another day | FAIL | FAIL | FAIL | FAIL (AC-1,AC-2) |
| 22 | existing phone not persisted | FAIL | FAIL | FAIL | FAIL (AC-1,AC-2) |
| 23 | empty list, base | FAIL | FAIL | FAIL | FAIL (AC-1,AC-2) |
| 24 | empty list, debug | FAIL | FAIL | FAIL | FAIL (AC-2) |
| 25 | existing omitted, base | FAIL | FAIL | FAIL | FAIL (AC-1,AC-2) |
| 26 | existing omitted, debug | FAIL | FAIL | FAIL | FAIL (AC-2) |
| 27 | ids only in metadata, base | FAIL | FAIL | FAIL | FAIL (AC-1,AC-2) |
| 28 | ids only in metadata, debug | FAIL | FAIL | FAIL | FAIL (AC-2) |
| 29 | seed rows only | **PASS** | **PASS** | FAIL | FAIL (AC-1,AC-2) |

Aplicația corectă: PASS 5/5 cu toate cele patru teste. Cele 8 variante de calibrare din afara inventarului (initial data not created /
without phone; initial / kept / new row omitted; seed rows only under any parameter / under all=1; threshold only under any parameter) sunt
respinse și de `existing-reference`, și de `e1`. Matricea nu dovedește acoperire universală; de exemplu un telefon reformatat nu e detectat
de `json-exposure` v1.

## 6. Teste și build (rezultate brute)

| Rulare | Arbore | Rezultat | CPU |
|---|---|---|---|
| Suitele afectate, runda 1 (26 de fișiere, secvențial) | clonă, 2.14.11 inițial | 501 teste, 499 PASS, 2 FAIL: T-JSON-FACTORY (defectul R-INVENTORY de mai sus) și RP-01 (regex pe textul 2.14.10) | medie 72 % |
| Suitele afectate, runda 2 | clonă, după reparare | **26/26 suite, 502/502 PASS** | medie 93 % |
| Suitele afectate, runda 3 | clonă aliniată octet cu octet la working tree-ul real, `88cb6c6` | **26/26 suite, 502/502 PASS**, 0 skip | medie 85 % |
| `vite build` (UI) | clonă | exit 0 | — |
| Regresia V2 completă | — | **nerulată până la capăt**. O rulare pornită în clonă a fost oprită după ce am găsit artefactul CRLF al clonei: testele de mutație `D1-06`, `D2-08`, `D3-07` și `U10-CP-*` picau doar din cauza lui, iar `D2-08` trece pe clona aliniată. Promptul cere regresia pentru release-ul final; release-ul nu are loc, deci nu am reluat-o. V1 nu a fost reluat (nicio dependență). | — |

## 7. Repetiția izolată (o singură repetiție, modele reale, aplicația sintetică, fără Hub-ul live)

Spec-ul este cel produs de `buildEngineeringSpec` pentru cerința salvată („Telefonul rămâne obligatoriu și salvat corect, dar lista publică
a zilei nu afișează și nu transmite telefonul. Programările valide și fluxurile existente continuă să funcționeze”, aceeași ca în misiunea
live `mis_mv49pj8t_91920fa038`); brief-urile vin din 2.14.11; fluxul urmează `factory.mjs`: un candidat respins de lint consumă rescrierea
unică, în aceeași conversație a autorului.

| Pas | Furnizor / model / acces | Sesiune | Rezultat |
|---|---|---|---|
| Autor ciclul 0, încercările 1–2 | Claude sonnet (claude-sonnet-4-6), Read/Glob/Grep | `2f4fd77a-f213-409b-91d9-e83e7e2eedb4`, `1afdc99e-9f30-4cec-8904-7963c9ff1d21` | HTTP 429 de la furnizor (limita de sesiune, apoi cea săptămânală), niciun test; nu sunt respingeri |
| Autor ciclul 0, încercarea 3 | idem | `2541f7ba-feed-44f6-8a9b-41e98d818f6b` (5 ture, 846 s) | `e0` `ad7e4544…`: **respins de lint** înainte de rulare (`needs_missing` × 5: manifestul a păstrat `"needs": []` din șablon) |
| Autor ciclul 1 (rescrierea unică) | aceeași conversație (`--resume`) | idem | `e1` `b8f25b98…`: corp identic, `needs` completat; lint curat, nimic eliminat |
| Dovada ciclului 1 | runner local, ca runner-ul Hub-ului | — | cele 5 cazuri raportează ce trebuie (AC-1/AC-2 pică pe aserțiuni, controalele trec), dar **procesul nu se închide**: serverul e închis după aserțiunea care pică, fără `try/finally`; runner-ul Hub-ului oprește la 180 s → **INCONCLUSIVE (timeout)** → pasul 0 epuizat |
| Review Codex | — | — | **neatins**: Hub-ul trimite la review doar un test PROVEN |

Porțile cerute înainte de live:
- PROVEN comportamental: **nu**.
- PASS pe aplicația corectă: da (ieșire normală în ~1 s).
- Respingerea tuturor variantelor: da, dar doar ca diagnostic cu ieșire forțată.
- Review Codex PASS: **nu** (neatins).
- Datele relevante dovedite în stocare și în listă: da (testul citește seed-urile după id, toate rândurile zilei, toate telefoanele și toate
  id-urile, fără rânduri în plus).
- Nicio verificare validă pierdută: da.

**Repetiția e incompletă; m-am oprit înaintea release-ului și a cardului §25.**

## 8. Backup, release și reconcilierea pornirilor

- **Release: nu.** Promptul condiționează release-ul de succesul izolat. 2.14.11 nu a fost îmbinat în `v2-milestone-01`, pentru că s-ar fi
  încărcat necontrolat la următoarea repornire. Codul stă pe ramura locală `claude/project-thread-c7i593` (`570ced3` + `189241b` + `88cb6c6`).
- **Backup: nu**, pentru că nu există nicio schimbare live. Următorul release face backup verificat înainte de upgrade.
- **Pornirile fără upgrade și fără backup, consemnate separat:**
  1. 2026-10-12 06:32 UTC, `boot_mv4vkfky_7af02bd59b`: working tree cu 2.14.10 necomis (după runda 1 de review a etapei precedente);
  2. 2026-10-12 15:55 UTC, `boot_mv5fop1z_315dc90235`, PID 1236: `570ced3` (2.14.10 comis), după repornirea PC-ului de la 15:54 UTC;
  3. 2026-10-12 21:35 UTC, `boot_mv5rtp1n_293018570e`, PID 21888: `570ced3`, după repornirea de la 21:34 UTC.
  Toate trei au venit din sarcina de logon (`autostart.log`: „pornesc Hub-ul V2”, `start-detached` cod 0), în BUILD_SAFE, fără migrare.
- **Proveniența procesului live (00:39 UTC):** PID 21888, `C:\Program Files\nodejs\node.exe`, `main.mjs` din working tree; codul =
  `570ced3` (working tree-ul diferă doar prin CRLF în cele 20 de fișiere ale proprietarului); UI-ul servit = build-ul din 2026-10-12
  07:05 UTC (`assets/index-CM8C-aJ6.js`, conține `version: 2.14.10-m11`; nicio schimbare de surse UI din 2.14.9); contract 13; schema 12.
- **DRAFT (neimplementat):** autostart-ul să pornească doar o release validată. Upgrade-ul gestionat ar scrie amprenta release-ului (commit,
  arbore, build, versiune, contract, schemă) în folderul de date, iar `boot-guard.mjs` ar refuza pornirea la logon când working tree-ul diferă
  de ea; alternativ, autostart-ul ar porni dintr-o copie a release-ului făcută de upgrade. Fără schimbarea sarcinii Windows.

## 9. Stările testului istoric, ale livrărilor și ale §25

- Testul istoric `test/hub/butonul-de-programare-trebuie-sa-84f571.test.mjs`: activ, sha
  `8d944644a304f4cfffd3cf466ab586bb7f57c3957b10507b3ec7d13c957605ca`; boot-ul raportează `already_restored`.
- Părintele `dlv_mv1eo8oo_d120460140`: STALE, fără reconciliere forțată și fără dovezi fabricate. Copiii `dlv_mv49pm32_a9ef4ac194`,
  `dlv_mv3wfqkl_14bc4f88fd` și `dlv_mv3b25gg_b337191620` sunt EXPIRED; `dlv_mv2ql6ie_75da58271a` e CANCELLED.
- Planuri: `env_mv49pmjs_74958c8740` EXPIRED, `env_mv4a7832_9e709ddf67` CANCELLED; nimic reanimat; niciun card nou.
- Aprobarea creativă: neatinsă.
- **§25: proba nu a început**, pentru că porțile din §6 nu sunt îndeplinite.

## 10. Intervenții umane, întreruperi, limitări, revenire

- Proprietarul nu a făcut niciun clic în această etapă. PC-ul a repornit de două ori (15:54 și 21:34 UTC). Sesiunea a fost întreruptă de
  limita de utilizare Claude (14:29 → 18:02 UTC și 18:14 → 00:01 UTC); Remote Control a fost offline de la 15:33 UTC.
- Refuz: `git push -u origin claude/project-thread-c7i593`, refuzat de stratul de permisiuni Claude Code („Permission to use Bash with
  command … has been denied”, regula `Bash(git push *)` din `.claude/settings.json`). Push-ul rămâne al proprietarului.
- Limitări: `json-exposure` v1 caută subșiruri exacte (un telefon reformatat nu e detectat); matricea nu e acoperire universală; regresia
  completă nu a rulat, pentru că nu există release.
- Revenire: nimic nu s-a schimbat live. Pentru Hub-ul live rămâne valabilă revenirea validată: cod `c168283` +
  `node v2/scripts/upgrade.mjs --apply`.

## 11. Ce rămâne (decizia proprietarului)

Corecția candidată (cere aprobarea ta; nu adaugă rescrieri) elimină cele două căi mecanice prin care un test bun pierde pasul 0:
- (a) rulările de dovadă se închid după ce toate cazurile au raportat (`--test-force-exit`, cu aceeași limită de 180 s și aceleași două
  rulări identice), iar o resursă lăsată deschisă devine semnal pentru reviewer;
- (b) `needs` e completat de Hub din folosirea celor șase module permise (antetul e al Hub-ului), în loc de respingere.

Apoi urmează o nouă repetiție izolată, release-ul gestionat (backup + upgrade) și un singur card §25.
