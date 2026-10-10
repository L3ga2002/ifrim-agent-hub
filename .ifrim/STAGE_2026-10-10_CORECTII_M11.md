# Etapa „Corecții M11 + predare M12” (2026-10-10, cod `2.14.6-m11`)

Prompt al proprietarului din 2026-10-10 10:11 UTC (thread „Corecții M11 și predare M12”). Această etapă nu închide M11 sau produsul;
pregătește M12 Sales, fără să-l execute.

## Baseline reconciliat (10:12 UTC)

| Element | Valoare | Sursă |
|---|---|---|
| Ramură / HEAD / remote | `v2-milestone-01` / `49a6032` / `origin/v2-milestone-01` = `49a6032` | VERIFICAT ACUM (`git fetch`) |
| Live | **`2.14.5-m11`** (contract 13, BUILD_SAFE, poarta deschisă) — nu `2.14.4` cum spunea predarea: proprietarul a făcut upgrade-ul între timp | VERIFICAT ACUM LIVE (`/api/health`) |
| Schema bazei | 12 (fără migrare în așteptare), rânduri neschimbate la dry run | VERIFICAT ACUM (`upgrade.mjs --plan`) |
| Modificări necomise ale proprietarului | 20 fișiere (Sales UI, DecisionInbox, scripturi, `.ifrim`, `.claude`) — **doar terminații de linie (CRLF)**, fără conținut diferit | VERIFICAT ACUM (`git diff --ignore-cr-at-eol`); neatinse |

## R-MEDIA — pauze intenționate cu interval și proveniență

- `v2/server/media/holds.mjs` (nou): contractul `ifrim.capture-hold/1` — `id, schema, sessionId, assetVersionId, stepsSha, step, stepKind,
  reason (highlight | proof_hold | settle | wait | typing | end_hold), startMs, endMs, plannedMs, maxMs, postcondition, result: VERIFIED`.
  Plafon = durata planificată + 250 ms; tastarea: +25 % (minim 400 ms), niciodată toată latența.
- `capture.mjs`: fiecare pas planificat (highlight, wait, type, pauza de final) e măsurat pe ceasul capturii; postcondiția e verificată
  (elementul evidențiat vizibil, dovada încă vizibilă, textul tastat chiar în câmp, pagina pe origine). Peste plafon sau fără postcondiție
  → `holdsRejected` cu cod, niciodată dovadă. Pauzele se leagă de versiunea de asset, sesiune și `stepsSha` (= `stepsSha` din șablon).
- `clip-ir.mjs`: montajul verifică fiecare pauză față de captura ei (asset, sesiune, script, plafon) și o pune pe clip ca `holds` în
  cadre-sursă; restul în `holdsRejected`. Clipurile desktop/mobil NU sunt marcate `holdIntentional`.
- `ir.mjs`: validatorul verifică fiecare câmp (chei necunoscute refuzate, proveniența = asset-ul clipului, cadre și plafon re-derivate).
  IR-urile vechi au același hash (nicio valoare implicită nouă).
- `qa.mjs`: DOAR `freeze` acoperit de un șir de pauze ale aceluiași clip (toleranța existentă de 2 cadre) e justificat; finding-ul
  păstrează măsurătoarea și numește pauzele (`justificationBasis: capture_holds`, `justificationHolds`). Negrul, erorile de decodare,
  lipsa cadrelor, timeout-ul și lizibilitatea nu sunt atinse; pragurile QA neschimbate.
- Remapare: tăieturile/trim-ul copiază clipul și mută sourceIn/sourceOut, viteza împarte, variantele copiază clipul → intervalele eliminate
  dispar, cele intersectate se decupează. Markerii vechi (punctuali) nu devin dovezi; rapoartele istorice nu se recalculează.

## R-PRIV — revizia demo-ului §25 (telefonul ascuns din lista publică)

Proiectul exact: livrarea `dlv_mv1eo8oo_d120460140` → `prj_muz7pfsl_fa3678479c` „Demo Livrare — Detailing (programări)”,
`C:\Users\mihai\OneDrive\Desktop\Ifrim Digital Proiecte\ifrim-delivery-demo-detailing`, `source = hub-test`, marker
`.ifrim-hub-test.json` (`fixture: booking-demo`, `data: synthetic`); git HEAD `93bffa8` + modificările misiunii §25. Fixture-ul versionat
`v2/fixtures/factory/booking-demo` nu are telefon și NU a fost atins. Testul protejat §25
(`test/hub/butonul-de-programare-trebuie-sa-84f571.test.mjs`, sha `8d944644…`) citește telefonul din `GET /api/bookings` (AC-2) →
**incompatibil** cu contractul nou; rămâne neschimbat.

Ce face Hub-ul acum (planificarea reviziei; implementarea în proiect o face Codex prin Software Factory, după confirmarea cardului):
- `revision.mjs`: „lista publică” e o parte a aplicației; propoziția „… continuă să funcționeze” rămâne în cererea software.
- `criteria.mjs` (forma `hide_public`): 2 verificări NOI (lista publică fără proprietatea și valoarea telefonului; parametri anonimi
  `includePhone=1`, `phone=1`, `fields=phone`, `debug=1`, `all=1` nu o aduc) + 3 de păstrare (obligatoriu: refuz fără salvare; persistență
  exactă citită prin stocarea internă, fără rută publică nouă; programare validă acceptată) + verificarea în browser (valoarea nu apare
  în pagină). Ipoteze: opțiunea e a proiectului, ascunsă implicit; fără CSS ca soluție; fără login/admin/RBAC.
- `conflictingHubTests` + `spec.supersedes`: testul Hub anterior care citește valoarea înapoi apare pe card cu misiunea și versiunea lui;
  la pornire `factory.retireSuperseded` îl mută, octet cu octet (sha verificat, idempotent), în `.ifrim-hub/retired/<misiune>/…retired`,
  eveniment `factory.test_superseded`, legat de versiunea originală. Writer-ul primește în brief că testul e retras și nu îl recreează.

## R-REV — revizie selectivă

- `office-executors.mjs workbookReuse`: Excel-ul se păstrează DOAR dacă fișierul de pe disc are sha-ul înregistrat ȘI generatorul rulat
  azi pe datele demonstrative, cu data livrării-sursă, produce exact aceiași octeți; altfel se regenerează. Înregistrarea: sursa,
  fișierul, sha256, `inputsSha` (hash-ul modelului), nivelul verificării, motivul.
- `planners/delivery.mjs refreshOffice`: Word și campania se refac (depind de software); Excel-ul se caută în linia livrărilor (părintele
  §25 nu avea Excel, bunicul `dlv_mv16dsp8_491116ae10` da). Șablonul (`reused`), vederea office (`REUSED`) și manifestul dosarului îl arată.
- Dovada pe datele live (citire, 2026-10-10): `Programari demo.xlsx` al `dlv_mv16dsp8_491116ae10`, sha
  `9ce060d8480d1f2470e4a1046735eaf790568aa1a2f87d68d0b836362dc37db4`, `inputsSha` `f734db94…`, APP_VERIFIED → **refolosibil**.
- Capturile, clipurile, varianta, rezumatul, Word-ul și campania noii livrări se refac (mecanismul existent: livrare-copil legată de
  părinte, fișiere noi fără suprascriere, aprobarea creativă PENDING).

## Teste (TESTAT ACUM IZOLAT, Windows 11, Node 24.14.0 de sistem, ffmpeg + Playwright Chromium reale)

- `v2/tests/r-media-holds.test.mjs` 11/11 după review (RM-01…RM-11; RM-10 = captură reală Chromium: pauze `settle, typing, highlight ×2, proof_hold,
  end_hold`, goluri între pauze 3 ms; QA real: 4 înghețări justificate, cea accidentală de 1,6 s rămâne semnalată).
- `v2/tests/r-priv-rev.test.mjs` 11/11 după review (RP-01…RP-10, RR-01; RP-07: azi pică exact cele 2 verificări noi; varianta corectă trece toate;
  „doar CSS”, „parametru includePhone”, „nu mai salvează”, „refuză tot”, „nu mai e obligatoriu” sunt respinse de verificarea potrivită;
  RP-10: Chromium real desktop + 390 px, cu refresh).
- Suitele afectate: 143/143 (planner, revizie, șablon, L5, finalizare, office, graf, intake) + 73/73 (IR, QA, clip-ir, șablon).
- Regresia completă: vezi „Închiderea etapei”.

## Review independent (sesiune separată, doar citire) și reparațiile

Verdict: NU BLOCHEAZĂ; 7 puncte „should-fix”, toate reparate înainte de commit:

| # | Constatare | Reparație | Test |
|---|---|---|---|
| F1 | O pauză falsificată dar coerentă în IR putea justifica o înghețare (validatorul nu vede captura) | QA folosește doar pauzele pe care sesiunea de captură le-a STOCAT (`holdMatchesStored`); restul sunt numărate `unverified` | RM-09 (falsificată → nejustificat; interval editat → nepotrivit) |
| F2 | Montajul sărea verificarea sesiunii/scriptului dacă apelantul nu le dădea | sesiunea și `stepsSha` sunt obligatorii (`HOLD_PROVENANCE`) | RM-02 |
| F3 | Retragerea testului vechi înaintea punctelor de eșec; mutare întreruptă blocată | retragerea după toate pre-verificările; `restoreRetired` la eșec; două copii identice → mutarea se termină | RP-06 |
| F4 | Forma `hide_public` putea inversa sensul („vreau să apară”), `obligatoriu` negat, câmpul greșit | câmpul din aceeași propoziție cu verbul; dorința de afișare respinsă; `obligatoriu` negat ignorat; „rămâne la fel” doar despre fluxurile aplicației | RP-02, RP-03 |
| F5 | Detecția testului incompatibil: fals pozitive/negative | citirea valorii trebuie să vină dintr-o variabilă legată de un GET, pe instrucțiune (assert pe mai multe linii, paranteze, destructurare) | RP-04 |
| F6 | Așteptarea pe o pagină goală/blocată de pe aceeași origine trecea | `settle`/`wait`/`end_hold` cer pagină încărcată și ne-goală; pauza de final are numărul ei de pas | RM-11 (Chromium real) |
| F7 | Excel-ul refolosit nu era re-verificat la scrierea dosarului | `delivery.package.index` re-verifică sha-ul; schimbat/lipsă → oprește pasul | — (cod) |

Limitări rămase (declarate): dovada Excel arată că registrul demonstrativ GENERIC e neschimbat (nu e legat de datele unui proiect);
fișierul refolosit rămâne în dosarul livrării-sursă (manifestul îl referă, nu îl copiază); legătura testului vechi cu misiunea lui se face
prin sha-ul protejat (un fișier reformatat ar apărea fără misiune pe card); detecția testului incompatibil e euristică și e arătată pe card.

## Închiderea etapei

- Regresia completă pe codul final (după reparațiile review-ului), `npm run build:v2` + `npm run test:v2`, Windows 11, Node 24.14.0 de
  sistem, ffmpeg + Playwright Chromium reale, PC la încărcare mare (2026-10-10 11:02 → 13:11 UTC): **1733 teste, 1731 PASS, 1 SKIP (T25,
  privilegiul Windows de symlink; ramura acoperită de testul cu junction), 1 FAIL**: U06-BL-06 („waitFor timed out” după 130 s, testele de
  pregătire a mediului, fișiere neatinse de etapă) — rulat singur imediat după: 7/7 PASS, U06-BL-06 în 9,9 s → depășire de timp sub
  încărcare, nu regresie. Build: PASS.
- Commit-ul etapei, upgrade-ul și push-ul: vezi `.ifrim/OPEN_ISSUES.md` (prima secțiune) și raportul din thread.
- Revizia R-PRIV pe proiectul §25 NU a rulat live: are nevoie de upgrade-ul la `2.14.6-m11` și apoi de confirmarea cardului de către
  proprietar (agentul nu își confirmă cardul). Testul §25 vechi a rămas neschimbat în proiect.
- Promptul M12: `.ifrim/M12_PROMPT.md`.
