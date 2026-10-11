# Etapa „Completarea testelor fără pierderea verificărilor” (2026-10-11 16:19 → 20:45 UTC)

Prompt al proprietarului din 2026-10-11 16:18 UTC (thread „Completarea testelor fără pierderi”). Nu începe M12; M12 rămâne DRAFT.
Roluri: Claude coordonator (diagnostic, specificație, repetiție, release), Codex implementare (`codex exec`, gpt-6-astra, efort high,
sandbox workspace-write; o corecție mică la efort medium), Claude într-o sesiune separată pentru review (agent read-only), QA determinist.
În Software Factory rolurile rămân: Claude (sonnet, medium) autor read-only, Hub-ul scrie și rulează, Codex (gpt-6.1-sol, medium) verifică.

## Baseline

| Element | Inițial (16:19 UTC) | Final |
|---|---|---|
| HEAD / origin | `d6c9a45` = `origin/v2-milestone-01` (push-ul anterior era deja făcut) | `8a91d3f` (cod 2.14.9) = origin (push făcut de proprietar ~20:20 UTC, după refuzul agentului) + commitul de docs (local) |
| Live | `2.14.8-m11`, contract 13, schema 12, BUILD_SAFE, gate open | `2.14.9-m11`, contract 13, schema 12, BUILD_SAFE (boot `boot_mv487m8t_785496ca26`) |
| Fișierele proprietarului | 20 fișiere doar CRLF | neatinse (commiturile includ doar căile etapei) |

## R-S25 — cazul concret (local, fără apeluri live)

Candidații live recuperați din `hub-data/work/factory/mis_mv3wfpyy_d440c4ec5c/blobs`, sha complete egale cu `factory_reviews.change_set_sha`:
c5 `8b940d9b147627780defb9c246e7a63d28090c73b802e90b5c6ad9cf5ef26e5d` (review `run_mv3zitzf_987830bb1c`) și c6
`8a4fd87d09086bd569faa9a5858bf68b38a7966cd4f44a4518fcb03d4fd52ce2` (review `run_mv3zpvpq_224f49de21`, P77/P100 `lost`). Copii byte-exacte,
manifeste și review-uri în `v2/tests/fixtures/stage0-s25/` (originalele din Hub neatinse).

Matricea (aplicația sintetică `v2/tests/fixtures/r-priv-booking`, date fictive; FAIL = respins pe aserțiuni, niciodată pe setup):

| Variantă de aplicație | c5 (live 1) | c6 (live 2) | r1 (repetiție) | amend-reference |
|---|---|---|---|---|
| originală (expune telefonul) | FAIL AC-1,2 | FAIL AC-1,2 | FAIL AC-1,2 | FAIL AC-1,2 |
| corectă (fără `phone` în lista publică) | PASS | PASS | PASS | PASS |
| refuză tot | FAIL AC-1,2,4,5 | FAIL AC-1,2,4,5 | FAIL AC-1,2,4,5 | FAIL AC-1,2,4,5 |
| telefon pierdut la salvare | FAIL AC-4 | FAIL AC-4 | FAIL AC-4 | FAIL AC-4 |
| validare doar în browser / proprietate lipsă acceptată / cerere invalidă salvată | FAIL AC-3 | FAIL AC-3 | FAIL AC-3 | FAIL AC-3 |
| valoare mascată / listă goală | FAIL AC-1,2 | FAIL AC-1,2 | FAIL AC-1,2 | FAIL AC-1,2 |
| id doar în metadate | **PASS** | FAIL | FAIL | FAIL |
| includePhone / debug / fields=phone sub altă cheie | FAIL AC-2 | FAIL AC-2 | FAIL AC-2 | FAIL AC-2 |
| telefon în text mai lung | FAIL | **PASS** (P77/P100 pierdute) | FAIL | FAIL |
| telefon ca cheie JSON | FAIL | **PASS** (P77/P100 pierdute) | FAIL | FAIL |
| cheie și valoare JSON escape | **PASS** | FAIL | FAIL | FAIL |
| valoare JSON escape sub altă cheie | **PASS** | FAIL | **PASS** | FAIL |
| scurgere doar pentru înregistrările existente | **PASS** | FAIL | FAIL | FAIL |

Cerință → verificare (amend-reference = c5 neschimbat + completări): întregul răspuns public (P75–P77, P98–P100 păstrate); cheia sensibilă
și valoarea în JSON-ul decodat, la orice adâncime, în text, ca cheie, prin escape (`leaks()`); înregistrarea existentă (inserată în stocarea
internă înainte de test) și programarea creată, identificată prin id-ul exact în `bookings`; fiecare dintre cei 5 parametri anonimi din
specificație; controalele AC-3 (lipsă / gol / spații, nimic salvat după fiecare refuz), AC-4 (telefonul exact în stocarea internă), AC-5
neschimbate. Interdicția nu se extinde la stocarea internă sau la răspunsul de creare. Fără rute sau exporturi inventate.

## 2.14.9-m11 (commit `8a91d3f`, fără migrare, contract 13, schema 12)

- **R-AMEND**: la ciclul > 0 autorul repară varianta anterioară identificată prin sha (textul numerotat, manifestul, dovada, review-ul,
  findings, inventarul), cu regula proprietarului citată exact; manifestul numește `amends` = sha-ul anterior (lipsă / altul → răspuns
  respins); `removed` doar cu `basis: wrong`, `why`, `by`; o verificare eliminată pe care reviewer-ul a clasificat-o `insufficient` →
  încălcare lint dură `coverage_insufficient_removed` (calea existentă, fără rescriere în plus); varianta anterioară lipsă sau cu alți octeți
  → oprire `previous_missing`. Lista numerotată „Ce trebuie completat” (fiecare finding, fiecare verificare insuficientă, fiecare criteriu
  din poartă) înaintea textului anterior; maparea `completes` a autorului e opțională, doar semnal (`completion_unmapped`), arătată
  reviewer-ului ca „afirmația autorului (nu e dovadă)”; intrările invalide se ignoră cu notă (nu consumă încercări).
- **R-INVENTORY**: id unic `P<linie>` sau `P<linie>.<k>` când sunt mai multe pe linie (id-urile live P77/P100 rămân valabile); cheia
  ignoră mesajul aserțiunii; potrivire pe caz + criteriu + tip (redenumirea unică a unui caz e tolerată; mutarea în alt caz = eliminare);
  inventar legat de sha; `contextChanged` pentru textul păstrat când fluxul cazului, un helper (închidere tranzitivă) sau setup-ul de nivel
  superior s-au schimbat.
- **Reviewer**: clasifică verificările criticate `insufficient | wrong` (`checks`); la ciclul > 0 judecă fiecare verificare eliminată sau cu
  context schimbat cu `{ verdict, by, why }` — `replaced_correctly` (și `kept` pentru o eliminare) cere verificarea nouă numită; `lost`
  rămâne blocant; răspuns lipsă → INCONCLUSIVE. Comparația textuală nu certifică echivalența; răspunsul autorului nu o certifică.
- Neschimbate: `reauthorMax` (≤ 1), limitele de încercări, poarta Codex, criteriile, retragerea întârziată și recuperarea 2.14.8.

Review Claude separat: runda 1 CHANGES_REQUESTED (F1 helper indirect și setup global nesemnalate; F2 text românesc; F3 regula dură doar
pentru `insufficient` explicit — decizie coordonator: păstrată, iar brief-ul reviewer-ului spune că o verificare criticată și eliminată fără
dovada că era greșită e `lost`; F4 fixture), runda 2 PASS; verificarea listei de completare PASS (R-1 minor rezolvat: intrări ignorate).

## Teste

| Id | Ce dovedește | Rezultat |
|---|---|---|
| T-AMEND-01 | c5 → amend-reference: nimic eliminat; c5 → c6: P75–P77, P98–P100 eliminate, P77/P100 `insufficient` → încălcare dură | PASS |
| T-AMEND-02 | verificare greșită înlocuită cu basis/why/by + `replaced_correctly` cu `by` → PASS; fără `by` → INCONCLUSIVE; amends greșit → respins | PASS |
| T-AMEND-03 | lista „Ce trebuie completat” înaintea textului; `completes` valid / ignorat; semnal `completion_unmapped` fără respingere | PASS |
| T-AMEND-04 | r1 (repetiția): nimic eliminat; trece pe „valoare escape sub altă cheie”, pică pe originală | PASS |
| T-INV-01 | două aserțiuni pe aceeași linie: id-uri distincte | PASS |
| T-INV-02 | aceeași aserțiune în alt caz = eliminată; caz redenumit = păstrată | PASS |
| T-INV-03 | text păstrat, helper direct / tranzitiv, flux sau setup schimbat → `contextChanged`; răspuns lipsă → INCONCLUSIVE, `lost` → CHANGES_REQUESTED | PASS |
| T-S25-01…04 | amend-reference: lint curat, PROVEN pe originală, PASS pe corectă; respinge toate cele 16 variante defecte pe aserțiuni | PASS |
| T-GATE-01 | `lost`, setup invalid, review INCONCLUSIVE, insuficient eliminat (flux complet cu furnizori falși) → nicio protecție, nimic retras, writer nepornit | PASS |

- Afectate (12 fișiere, secvențial, înaintea rundei 1): 277/277 PASS, CPU mediu 87 %. După runde: r-amend + r-stage0-repair + m11-l5-test-first
  140/140 PASS. Teste existente actualizate doar pentru protocol: S0R-06 (`previousChecks` cu `by`/`why`, mai strict), S0R-22 (formatul id),
  INT-05 (versiunea). `build:v2` exit 0.
- **Regresia V2 completă pe codul final** (17:44 → 19:36 UTC, CPU mediu 93 %, 108 eșantioane): 1848 teste, **1847 PASS, 1 SKIP (T25), 0 FAIL**.
  O singură rulare, nimic combinat. V1 nu a fost reluat (nicio dependență). Codex raportase 6 timeout-uri în rulările lui; nu s-au reprodus
  în rulările secvențiale ale coordonatorului.

## Repetiția izolată (o singură dată, modele reale, aplicația sintetică, fără Hub-ul live)

| Pas | Furnizor / model / acces | Sesiune | Rezultat |
|---|---|---|---|
| Review ciclul 0 al lui c5 (brief nou) | Codex gpt-6.1-sol medium, read-only | `01a12bfe-2912-79b1-9e50-99250a35b46f` | CHANGES_REQUESTED; P75–P77, P98–P100, P124 `insufficient` |
| Autor ciclul 1 (brief nou) | Claude sonnet medium, Read/Glob/Grep | `365e3a67-5b5b-4bec-a796-4d8d76c882fc` | candidat r1 `a26a0bca…`: amends corect, `removed` = [], nimic eliminat |
| Dovada (runner local, 2 rulări) | — | — | PROVEN (AC-1/AC-2 pe aserțiuni) |
| Review ciclul 1 | Codex gpt-6.1-sol medium, read-only | `01a12c02-6435-73f3-b1f9-bc1ba4789bf2` | CHANGES_REQUESTED: toate cele 10 verificări cu context schimbat `kept`, niciun `lost`; escape la valori încă neacoperit |

Concluzie: R-AMEND funcționează (nicio pierdere), dar completarea a fost parțială: r1 trece pe „valoare JSON escape sub altă cheie”.
Cauza locală: constatările ajungeau la autor doar într-un JSON lung. Reparată (lista „Ce trebuie completat”), verificată determinist și
de reviewer; o a doua repetiție cu modele nu a fost făcută (limita „cel mult o repetiție”). Fixture-urile dovedesc comportamentul Hub-ului,
nu garantează că modelul completează totul.

## Release

- Backup verificat înaintea operațiunilor live: `bkp_mv486gvm_fe29fa3bd1` (Hub + hub-v2), `bkp_mv486kzh_4e6ef724dc` (proiectul §25), 19:37 UTC.
- Upgrade `node v2/scripts/upgrade.mjs --apply`, rulare `upg_mv487hiw` DONE 19:38 UTC: 2.14.8 → 2.14.9, contract 13, schema 12 → 12 (fără
  migrare, integritate ok, numărătorile neschimbate). Boot fără misiuni recuperate; părintele `dlv_mv1eo8oo_d120460140` rămâne STALE
  (`delivery.stale_reconcile_refused`: fără inventar de căi, fără hash-uri de octeți) — nimic forțat, nicio dovadă fabricată.
- `git push` refuzat agentului de stratul de permisiuni Claude Code (regula Bash pentru push); rulat de proprietar, origin verificat `8a91d3f` la 20:21 UTC.
- Revenire (dacă e nevoie): codul anterior e `d6c9a45` (2.14.8-m11, aceeași schemă, fără migrare); revenirea înseamnă readucerea codului la
  acel commit și același `upgrade.mjs --apply`, nu „Reia” pe o misiune.

## Cardul vechi și proba §25

- `env_mv3wfqmy_e139f9baef` a expirat singur la 18:58:48 UTC (EXPIRED), livrarea-copil `dlv_mv3wfqkl_14bc4f88fd` EXPIRED; nimic reanimat.
- `factory.refine_test` pe `mis_mv3wfpyy_d440c4ec5c` (canal cli, 19:38 UTC): refuzat corect — „misiunea e deja rezultatul unei rafinări”.
  Proba nouă pornește din cerința salvată, trimisă de proprietar în camera livrării (`delivery.revise` cere sesiunea lui), apoi o singură
  confirmare a cardului. Rezultatul probei: vezi secțiunea de mai jos (completată la final).

## Proba live §25 (a patra, pe 2.14.9)

Proprietarul a trimis cerința salvată în camera livrării (20:20 UTC) și a confirmat o dată cardul `env_mv49pmjs_74958c8740` (misiunea
`mis_mv49pj8t_91920fa038`, livrarea-copil `dlv_mv49pm32_a9ef4ac194`, părinte `dlv_mv1eo8oo_d120460140`). Push-ul `8a91d3f` făcut de el.

| Pas | Rulare | Rezultat |
|---|---|---|
| Autor ciclul 0 (Claude sonnet medium, doar citire) | `run_mv49psd4_31e803e58f` | candidat c7 `be8da118…` |
| Dovada Hub (2 rulări) | 20:27 UTC | PROVEN |
| Verificare (Codex gpt-6.1-sol medium, doar citire) | `run_mv49y4o4_8b0b592117` | CHANGES_REQUESTED; 12 verificări clasificate `insufficient` (P70–P72, P93–P95, P116, P120, P126, P130, P136, P140) |
| Completare ciclul 1 (Claude, `amends` = c7) | `run_mv49zhjw_cb71c8ba84` | candidat c8 `c8068c3b…`: **nimic eliminat**, 22 verificări cu context schimbat, 5 mapări `completes` |
| Dovada Hub | 20:33 UTC | PROVEN |
| Verificare (Codex) | `run_mv4a5t9v_a0f21baa5c` | CHANGES_REQUESTED: toate verificările anterioare `kept`, **niciun `lost`**; AC-1/AC-2 deschise |

Oprire 20:34:19 UTC (`exhausted`), NEEDS_OWNER_DECISION. Rafinarea automată a încercat o dată și s-a anulat singură („ar repeta aceleași
criterii”: misiunea `mis_mv4a77zi_cafc405384` și cardul `env_mv4a7832_9e709ddf67` CANCELLED în aceeași secundă). Planul confirmat rămâne
WAITING_OWNER și expiră singur la 23:50:46 UTC; livrarea-copil ARMED se închide cu el. 0 change set-uri, nicio implementare, nimic retras
(testul vechi `butonul-de-programare-trebuie-sa-84f571.test.mjs` activ), nicio captură. Aprobarea creativă neatinsă. Nu am cerut alt card.

Verificare independentă (local, aceleași variante): c8 trece pe aplicația corectă și respinge toate cele 16 variante, dar trece pe o variantă
nouă, „telefonul cu escape într-un text mai lung, sub altă cheie” (`variant-escape-in-text-other-key.js.txt`): helper-ul decodat compară
șirurile prin egalitate exactă — exact ce a semnalat reviewer-ul. Al doilea punct al reviewer-ului: `seed: true` și o constantă de telefon
fără dovada că înregistrarea existentă e în ziua testată. amend-reference respinge și varianta nouă. Concluzie: **R-AMEND a funcționat
live** (nicio verificare pierdută, toate judecate `kept`), **§25 nu a ajuns la livrare**: completarea autorului a rămas incompletă, iar
poarta a oprit corect testul mai slab.

## Decizii rămase (proprietar)

1. Corecția candidată (neimplementată, cere aprobarea ta): verificări-helper puse de Hub în antetul testului pentru cazul „nu expune” (ex.
   o căutare în JSON-ul decodat, în chei și valori, ca subșir), ca autorul să nu le mai scrie singur, plus cerința explicită ca înregistrarea
   existentă să fie creată sau dovedită în test. Alternativa — o a doua completare când nu există niciun `lost` — înseamnă o rescriere în plus
   și nu am făcut-o.
2. Planul `env_mv49pmjs_74958c8740` expiră singur la 23:50 UTC; nu cer alt card până la decizia ta.
3. Părintele `dlv_mv1eo8oo` rămâne STALE (refuz pe dovezi, verificat din nou la boot-ul 2.14.9).
4. M12 rămâne DRAFT.
