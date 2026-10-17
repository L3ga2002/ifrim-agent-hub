# M08 · Raportul de teste

**Cadrul de test:**
- toate testele rulează pe Hub-uri de test (`makeTestHub`) cu date în `.ifrim/tmp`;
- provideri fixture (`fake-codex`, `fake-claude`), worker vocal fixture (voce sintetică, niciodată vocea cuiva), autentificator WebAuthn software;
- nivel: **PASS_SIMULATED**;
- nu a pornit niciun model și nu s-a folosit Hub-ul live.

## 1. Testele M08 noi (54 = 38 + 16 regresii din revizuire)

| Fișier | Teste | Ce acoperă |
|---|---|---|
| `m08-autopilot.test.mjs` | D3-01…05 | validarea planului (ordine, cicluri, buget, duplicate); **cap-coadă: 2 sarcini dependente, o singură confirmare (TRUSTED) → ambele DELIVERY_READY → plan COMPLETED, nimic acceptat**; ASSISTED = doar sarcina următoare; obiectiv modificat → plan vechi SUPERSEDED, neconfirmabil; nicio comandă de reluare; canalele agent/CLI/voce refuzate; Pauza → WAITING_OWNER, fără reluare |
| `m08-company.test.mjs` | D1-01/02, D2-01, D4-01, D5-01, D6-01, D7-01 | Twin (sursă și tip pe fiecare relație, voce → ipoteză, observație fără sursă refuzată, „de ce am ales”, „ce s-a schimbat” cu pornirile Hub-ului); War Room (PROPUS, dovezile de la model refuzate, ipoteza modelului neconfirmată, RESOLVED fără dovadă refuzat, tranziții ilegale refuzate); Ședința (agendă, decizii doar cu sesiunea ta, amânare reportată, nimic activat); Simulare (INSUFFICIENT_DATA, intervale, SIMULARE, propunere = ciornă); Liga (fără câștigător); Skilluri (evaluare, frontmatter, aprobare, activare limitată, revenire din orice canal) |
| `m08-lega.test.mjs` | D8-01/02, D9-01…05 | parsarea lecțiilor; doar cuvintele tale, documentele refuzate, securitatea separată, confirmare → memorie, înlocuire, „uită” exact; intențiile noi și efectele lor; `owner.intent` (incident, scenariu cu estimările tale, lecție, ecranul de pornire, „ecran complet”, „ce avem azi”, vocea provider fără autoritate); **fereastra armată: confirmare din vocea verificată local fără click; altă voce, alt Lega, un „da” vag → nimic**; armarea refuzată fără sesiune Lega sau fără filtrul vocal; **fiecare intenție M08 rulează fără eroare** (D9-05) |
| `m08-mobile-packages.test.mjs` | D10-01/02, PK-01 | asociere (cod de la proprietar, 5 încercări, cookie HttpOnly / SameSite=Strict / Path=/api, cod de unică folosință); comenzi idempotente, imagine veche refuzată, doar opriri, fail-safe la contract UI vechi, revocare de pe PC, „uită acest telefon”; pachete A→B, sesiune proaspătă, „executată” din realitate, B3 exact `python3 -m unittest` |
| `m08-relocation.test.mjs` | D-A1 ×6 | doar intrările V2, plan și dry-run fără efect, apply verificat (integritate, rânduri, sha), căi rescrise doar în copie, pointer + `V2_MOVED.json` (un Hub refuză folderul vechi), rollback simplu și `--copy-back`, refuzuri (Hub pornit, țintă suprapusă, relativă sau sincronizată) |
| `m08-adversarial.test.mjs` | ADV-01…05 | 16 comenzi M08 refuzate pe canalele agent/CLI; rutele M08 refuză `X-Hub-Channel: agent|cli`; UI vechi refuzat la scriere (409 UI_STALE), dar nu la oprirea de pe telefon; textul din document, tool, web, e-mail, review, model sau telefon nu devine lecție; fereastra armată se închide după 3 fraze refuzate; proiect înghețat între două sarcini → sarcina următoare nu pornește |
| `m08-ui-logic.test.mjs` | UI-01…05 | rute, prospețimea pe telefon (30 s, offline, ceas înghețat), intrările simulării, chei de idempotență, liniile de răspuns din cockpit, lista fail-safe identică între client și server |

| `m08-review-fixes.test.mjs` | RF-01…RF-16 | regresiile celor două runde de revizuire (§1b) |

Toate trec, inclusiv în rularea completă finală (§5).

## 1b. Revizuirea adversarială înainte de commit (două runde)

- **Runda 1:** 7 dimensiuni (autoritate, suprafața HTTP, mutarea datelor, upgrade pe baza reală, logica, UI, fabrica), 24 de agenți read-only. Fiecare constatare semnificativă a fost verificată de un sceptic separat: **16 confirmate**, 1 respinsă.
- **Runda 2:** 5 agenți, doar pe reparații. Au confirmat că reparațiile țin și au găsit cazuri-limită noi, reparate și ele.
- **Testele de regresie** sunt în `m08-review-fixes.test.mjs`: 16 teste, RF-01…RF-16, câte unul pe defect sau grup. Toate trec.
- **Testul de acceptanță al pilotului B4** a fost verificat direct în `ifrim-runner` (Python 3.12.3), pe o copie sintetică. Pică fără suită, cu 5 teste, cu o funcție neapelată, cu o suită goală (apeluri sub `if False:`) și cu o suită care pică. Trece cu o suită bună.
- **Dry-run-ul mutării pe datele reale:** 100 de tabele, 5.935 de rânduri, integritate ok, 186 MB verificați cu sha, căi rescrise (15 + 15 backup-uri, 4 pachete). Copia de probă a fost ștearsă.

## 2. Mutanți (gărzile cheie)

`7/7 KILLED`:
- proveniență non-proprietar acceptată la lecții;
- fereastra armată fără plafon de eșecuri;
- fereastra consumată de o frază refuzată (defectul vechi);
- dovezi de la model acceptate în War Room;
- plan de obiectiv înlocuit încă confirmabil;
- B decis înaintea lui A;
- lecție confirmată fără sesiune.

Sursele au fost restaurate după fiecare mutant (verificat).

## 3. Testele vechi atinse de M08

- `m04-browser` și `m06-ui-e2e` servesc UI-ul construit din `HUB_V2_WEB_DIST` (`helpers.WEB_DIST`).
  - Cu `v2/web/dist` vechi (contract 7) față de serverul M08 (contract 8), cele două pică prin UI_STALE, exact cum e proiectat contractul M07. Așa s-a întâmplat în prima rulare completă.
  - Cu build-ul M08 trec.
- Protecțiile M01–M07 rămân acoperite de suitele lor, care trec: facturare și MCP, modele Fable refuzate, ruta WSL fără fallback pe Windows, granturi mai largi decât planul, nonce reutilizat, două file, plan schimbat după confirmare, sesiune expirată, vocea TTS sau a altcuiva.

## 4. Scripturi verificate pe date temporare

- `relocate-data.mjs`: 6 teste automate (mai sus).
- `voice-acl.ps1`, pe un folder temporar:
  - `-Plan` arată 9 intrări moștenite (inclusiv `CodexSandboxUsers`);
  - `-Apply` lasă doar SYSTEM și contul tău, iar `-Verify` confirmă restrângerea;
  - un al doilea `-Apply` e refuzat;
  - `-Rollback` revine la exact 9 intrări moștenite;
  - folderul temporar a fost șters.
- `migration-dry-run.mjs`, pe o bază sintetică cu schema M07: 7 → 8, `m08Complete: true`, integritate ok, număr de rânduri neschimbat.

## 5. Suitele complete

| Suită | Comandă | Rezultat |
|---|---|---|
| **V2 completă**, cu UI-ul M08 | `HUB_V2_WEB_DIST=.ifrim/tmp/m08-web-dist node --test --test-concurrency=1 "v2/tests/*.test.mjs"` | **650 teste: 649 trecute, 0 eșuate, 1 sărit**. Testul sărit e T25 (simlink de fișier, cere privilegiul Windows de simlink), la fel ca în milestone-urile anterioare. Durată ~26 min. |
| **V1** | `node --test tests/*.test.mjs` | **552 teste: 551 trecute, 0 eșuate, 1 sărit** (simlink) |
| M08 pe codul final | inclus în rularea completă | **54/54** (16 RF incluse) |
| Browser pe build-ul final | `m04-browser`, `m06-ui-e2e` | **2/2** |

- **Prima rulare V2 completă** (înainte ca testele de browser să urmeze `HUB_V2_WEB_DIST`): 602 teste, 599 trecute, 1 sărit, **2 eșuate**: M04-BR-01 și M06-UI-E2E-01. Cauza era `v2/web/dist` construit pentru contractul 7, refuzat corect de serverul M08 cu UI_STALE.
- **Rularea completă finală** a fost făcută după ambele runde de reparații, pe codul care se commite: 650/649/0/1 pentru V2 și 551/552 pentru V1.

## 6. Inspecția UI

Vezi `M08_UX_MEASUREMENTS.md`: 24 de capturi, 0 erori în consolă, 0 scroll orizontal, navigarea cu tastatura reparată și verificată.
