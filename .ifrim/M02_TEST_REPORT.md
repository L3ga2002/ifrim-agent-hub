# M02 — Test report (§27)

Data: 2026-09-30, actualizat 2026-10-01 · Node 24 · Windows 11 · suitele rulează fără modele (fixture-uri și canary-uri fictive). Hub `2.3.0-m03`.

Statusurile rămân separate. **Omisiunile nu se adună la „trecute”.**

## Validare live — 2026-09-30 (aprobată explicit de utilizator; ore UTC)

| Provider | Rezultat | Detalii |
|---|---|---|
| Claude Code (read-only, `sonnet` pe CLI 2.1.175) | **PASS_LIVE** | 14:06, run `run_muo6i9og_50c329673c`: poarta a admis (grant 1 încercare), backup verificat automat înainte, 15 s, răspuns corect (a găsit cazul lipsă: nume format doar din spații), proiectul de test nemodificat (`git status` curat în afară de backupul Hub), cost: estimare client 0,028 USD — nu taxare, ruta e abonamentul |
| Codex (read-only) | **FAIL (transport, înainte de inferență)** → corectat | pornit de utilizator din UI la 14:41 (run `run_muo7r9bp_d1b50893f7`, efort low): autentificare OK (ChatGPT, `prolite`), backup verificat, apoi `thread/start timed out after 120000 ms`. Niciun turn, nicio inferență, nimic consumat. După eșec, ACE-urile DENY aprobate există pe toate căile protejate, iar `~/.codex/.sandbox-bin` nu are niciunul. Grant epuizat, poarta suspendată, înapoi în BUILD_SAFE. Fără retry automat. **Cauza găsită și corectată în `30bfbef`:** la `thread/start`, Codex căuta `AGENTS.md`, iar cu negările din profilul Hub fiecare căutare trecea prin sandbox-ul Windows (codex-rs 0.159.2). Acum `project_doc_max_bytes=0` și `project_root_markers=[]`; Hub-ul trimite singur `AGENTS.md` al proiectului |
| Codex (workspace-write) | **PASS_LIVE** | 20:14–20:27, run `run_muojnivb_b113ce0591`, propus de Lega și aprobat de proprietar: formular de contact cu validatorul existent. Execuția s-a terminat; `npm test` 4/4 PASS; Claude a verificat pagina în browser (erori pe câmpuri în română și starea de succes „mesajul nu a fost trimis”). **Constatare:** execuția a apelat de 3 ori serverul MCP `cua_repl/js` (pluginul Computer Use). Serverele MCP rulează în afara sandbox-ului Codex → corectat pentru fiecare proces Codex al Hub-ului (M03-MCP-01..09) |
| Codex (read-only, după corecția MCP) | **PASS_LIVE** | 21:39–21:48, run `run_muomogfu_f3b3dcccd7`, Hub `2.3.0-m03`: rezumat corect în română, verificarea MCP trecută, niciun apel MCP, nicio cerere de escaladare. Notă: ~8 min până la prima comandă din sandbox (costul primei comenzi în sandbox-ul Windows) |
| Lega (voce, GPT-Live prin Codex) | **PASS_LIVE** | 18:18–19:49, mai multe sesiuni, română în ambele sensuri, inclusiv versiunea cu acces complet (sesiunea `lega_muoic63s_69b4539e26`, 11,4 min, vocea `sol`, căutare web `cached`). Detalii în `LEGA.md` |

Proiectul de test: `Ifrim Digital Proiecte/ifrim-hub-live-test` (validator de formular, 4 teste, git propriu), creat cu `npm run v2:test-project` și înregistrat prin comanda nouă `project.register_test` (M02-SEC-13).

## Suite automate

| Suită | Comandă | Teste | PASS | FAIL | SKIPPED | Durată |
|---|---|---|---|---|---|---|
| V2 (M01 + M02 + Lega/M03) | `npm run test:v2` | 249 | 248 | 0 | 1 | NEVERIFICAT |
| V1 (regresie) | `npm test` | 552 | 549 | 2 (timeout 30 s, doar în suita completă) | 1 | NEVERIFICAT |
| Build UI | `npm run build:v2` | — | OK | — | — | — |
| Dependențe | `npm audit` | — | 0 vulnerabilități | — | — | — |

La livrarea M02 (2026-09-30): V2 197 de teste (196 PASS, 1 omis), V1 552 (551 PASS, 1 omis).

V2 acum: rularea completă finală (2026-10-01) are 249 de teste: 248 PASS, 0 FAIL, 1 SKIPPED_ENV.

V1: cele 2 timeout-uri sunt `tests/continuation-api-contract.test.mjs` și `tests/model-policy-api.test.mjs`. Ambele apelează API-ul V1 **live** de pe 127.0.0.1:8004. Singure trec (16 s și 0,2 s). Codul V1 nu a fost schimbat.

Cele două omisiuni sunt același caz de mediu: **SKIPPED_ENV**, pentru că symlink-ul de fișier dă EPERM fără Developer Mode, iar Developer Mode nu a fost activat.

- V2 T25 „file symlink branch”;
- V1 „database link is rejected…”.

Ramura cu junction este testată real (junction-urile se pot crea fără privilegii).

### Regresii găsite de suita M01 în timpul M02 și corectate

| Test | Cauză | Corecție |
|---|---|---|
| M01-NG1 (serverul nu rulează git mutant) | simulatorul crea proiectul demo cu `git commit` din `v2/server/sim` | mutat în `v2/scripts/sim-demo.mjs`; serverul doar verifică existența (`assertDemoProject`) |
| M01-INT-01 (unelte blocate) | `browser.inspect` a devenit dinamic | contract nou: `needs_setup` fără Playwright, `ALWAYS_ASK`; registrul nu mai raportează „available” fără instalare |
| M01-ART-01 (artefacte) | verificarea zonelor protejate folosea calea absolută; hub-ul de test stă în `.ifrim/tmp` | verificare relativă la proiect + pe calea reală (junction) |

## Teste M02 noi (28 la livrare, 39 acum)

Adăugate după livrare, în verificarea M02: SEC-14, RT-06..09, UI-10, UI-10b, UI-11..14. Întărite: SEC-09 (listarea junction-urilor), RT-05 (redactarea), UI-09 (calea reală de cod).

**SECURITY** — `v2/tests/m02-security.test.mjs` (15): toate PASS_LOCAL.

| ID | Ce dovedește |
|---|---|
| SEC-01 | Profilul Codex neagă zonele protejate, `.env`, credențialele; `~/.codex` nu e negat întreg; căile Hub sunt negate absolut; rețeaua e oprită |
| SEC-01b | Căi Hub absolute, deduplicate, fără intrări imbricate; amprenta urmează lista exactă |
| SEC-02 | Claude primește negări absolute `//c/…`, pentru proiect și pentru Hub |
| SEC-03 | Matricea de izolare, inclusiv acord lipsă sau amprentă schimbată → NEEDS_LIVE_APPROVAL |
| SEC-04/05 | Poarta blochează Codex fără sandbox „ready” sau fără profil permis (fake app-server) |
| SEC-06 | Thread cu full access → oprire înainte de turn; rulările poartă profilul, nu parametri vechi |
| SEC-07 | Claude cu shell pe Windows nativ → SECURITY_BLOCKER |
| SEC-08 | Argumentele reale `claude -p` conțin negările |
| SEC-09 | Rutele de fișiere refuză zonele protejate, numele secrete și junction-urile (canary fictiv) |
| SEC-10 | Artefacte: zone protejate relativ la proiect; junction spre zonă protejată sau în afara proiectului refuzat |
| SEC-11 | O unealtă care cere aprobare de instalare nu apare „available” |
| SEC-12 | Acord ACL: text exact + amprentă curentă; vocea refuzată; poarta blochează fără acord și după retragere |
| SEC-13 | Proiecte de test: doar un director marcat, copil direct al rădăcinii proiectelor, fără secrete și fără link-uri; idempotent; vocea refuzată; retragerea scoate execuția |
| SEC-14 | Proiecte de test: tot arborele e verificat (secrete imbricate, junction-uri interioare, `.ifrim/private`, limite de mărime) |

**RUNTIME** — `v2/tests/m02-runtime.test.mjs` (9): toate PASS_LOCAL.
- RT-01: citire paginată, fișiere binare refuzate.
- RT-02: căutare literală, redactată, fără zone protejate.
- RT-03: browser doar pe URL local cu port, niciodată Hub-ul; NEEDS_INSTALL_APPROVAL.
- RT-04: starea conține flag-ul de simulare, conversațiile/rezultatele recente, structura companiei; `/api/sim` răspunde 404 în afara simulatorului.
- RT-05: istoricul uneltelor, redactat.
- RT-06..09: Browser Workspace cu browser fals: allowlist doar pentru originea locală aprobată, sub-resurse externe, redirecționări și WebSocket-uri străine refuzate, stratul de rețea blochează ce nu văd rutele.

**UI logic** — `v2/tests/m02-ui-logic.test.mjs` (15): toate PASS_LOCAL.
- UI-01: cele 10 stări ale nucleului vin din semnale reale.
- UI-02: Markdown fără HTML, linkuri nesigure transformate în text.
- UI-03: atașamente — tip, dimensiune, nume secrete.
- UI-04: etapa erorii.
- UI-05: layout Focus, conversația ≥360 px.
- UI-06: progres numărat, nu estimat.
- UI-07: catalog cu fapte separate.
- UI-08: comenzi vocale locale; aprobările, ștergerile și deploy-ul refuzate.
- UI-09: poarta de evenimente: duplicate, secvențe vechi sau în dezordine respinse; un jurnal aflat în urma marcajului declanșează resincronizarea.
- UI-10 / UI-10b: clientul fluxului live folosește poarta: reluare cu `?after=<ultimul seq>` pe un `EventSource` nou (nu Last-Event-ID), deduplicare, repornire, resincronizare după resetarea bazei de date, backoff; fără marcaj cunoscut, îl învață din `hello`.
- UI-11: scurtăturile Alt ignoră AltGr, codurile Alt, IME, repetarea și alte combinații.
- UI-12: modele și efort în compozitor: Codex din `model/list`, aliasurile Claude etichetate neverificat.
- UI-13 / UI-14: limitele și tipurile de atașamente sunt cele ale serverului (10 MB, nume ≤200); fluxul live pornește de la snapshot. UI-14 verifică și aprobările: o comandă propusă pornește în același click („Aprobă și pornește”, toast dacă pornirea eșuează), iar cele aprobate, dar nepornite (inclusiv scripturi npm și verificări de browser) rămân vizibile în Aprobări și în panoul Lega.

**Teste M03 noi, din verificarea M02** — toate PASS_LOCAL.
- `v2/tests/m03-mcp-runs.test.mjs` (9): MCP-01..08 pentru Codex (pluginuri oprite, servere dezactivate pe nume, niciunul activ înainte de turn, refuz înainte de pornire, verificare pe toate paginile, apel MCP în turn → oprire, `externalSandbox` refuzat, Stop în timpul `thread/start` → niciun turn); MCP-09 pentru Claude (server MCP sau unealtă `mcp__` la `init` → oprire înainte de model).
- `v2/tests/m03-review-fixes.test.mjs` (4): RF-01 model Codex exact; RF-02 thread read-only care raportează `workspaceWrite` → oprire înainte de turn; RF-03 „Eroare auth” din simulator dă eroare de autentificare; RF-10 grant expirat afișat și judecat ca expirat.
- Testele Lega (`m03-lega*`, `m03-lega-access`, `m03-stage`) sunt descrise în `LEGA.md`.

## Verificări manuale, fără model

| Verificare | Rezultat | Status |
|---|---|---|
| Canary sandbox Codex (`v2/tests/manual/codex-sandbox-canary.mjs`) | 46/46 | PASS_LOCAL |
| Probe ACL (persistență, excepție pe copil, glob-uri absolute, căi reale neatinse) | F1–F7 în Security readiness | PASS_LOCAL |
| Preflight profil real (`codex-real-profile-preflight.mjs`) | refuză fără amprentă (verificat). Rularea completă a fost refuzată pentru Claude de stratul local de permisiuni. Acordul ACL e înregistrat, iar ACE-urile DENY există deja pe căile protejate | NOT_RUN (acțiune opțională a proprietarului, în terminalul lui) |
| Pre-flight MCP Lega (`lega-mcp-preflight.mjs`) | cele 6 servere din config dezactivate pe nume, niciun server de plugin | PASS_LOCAL |
| Simulator (`npm run v2:sim`): seed complet, scenarii, banner | vizual + API | PASS_SIMULATED |
| Pierdere de context WebGL ×3 → SVG | 1 și 2 recuperate, a 3-a → SVG | PASS_LOCAL |
| Eroare injectată în nucleu → boundary | nucleu SVG, pagina și Stop All intacte | PASS_LOCAL |
| Reduced motion (ramura de cod) | rulează fără eroare; oprirea animației nemăsurabilă în panoul ascuns | PARȚIAL / NOT_RUN |
| Overflow 360/390/768/1024/1440/1920 + 720×450 (zoom 200%) | 0 | PASS_LOCAL |
| Latență UI | paletă 6,7–36,6 ms; ecran 3,9–20 ms | PASS_LOCAL |

## Plan §27 — acoperire

| Arie | Acoperit | Neacoperit (status) |
|---|---|---|
| SECURITY | fișiere private pe rutele efective, canary, subprocess (argumente reale), traversare/junction, redactare, BUILD_SAFE, fără inferență neautorizată, invalidarea aprobării (M01) | symlink de fișier (SKIPPED_ENV) |
| UI | navigare, layout, draft, conversație, atașamente, erori, empty states, graf/listă, căutare, accesibilitate (audit), responsive | screen reader real (NOT_RUN) |
| RUNTIME | snapshot/reconectare, deduplicare, evenimente întârziate, cotă simulată, handoff simulat și eșecul lui, Stop All și „Întrerupe” (indicatorul de execuție) cu confirmare backend | resetarea DB cu jurnal nou deja peste marcajul clientului (nedetectată; limită cunoscută) |
| TOOLS | preview fișier/diff autorizat, output vs terminal, browser izolat (static), lipsa bridge-ului | screenshot/consolă Playwright (BLOCKED, NEEDS_INSTALL_APPROVAL) |
| VOICE | motor lipsă → NEEDS_SETUP, permisiune refuzată, dispozitiv schimbat (cod), mute, fără fallback cloud ascuns, comenzi locale | transcriere locală reală (BLOCKED, NEEDS_INSTALL_APPROVAL) |
| PERFORMANCE | WebGL pierdut/indisponibil, cost GPU, memorie pe o sesiune scurtă, bundle | FPS real și sesiune prelungită (NOT_RUN) |
| LIVE | PASS_LIVE: Claude read-only; Codex workspace-write și read-only (după FAIL-ul de la 14:41, corectat); Lega voce | handoff Codex ↔ Claude, Stop/întrerupere live a unui turn în curs, căutarea web și `propose_mission` ale Lega (NOT_RUN) |
