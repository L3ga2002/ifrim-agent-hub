# M03 · Software Factory (departamentul Engineering)

Data: 2026-10-01. Versiune: `2.4.0-m03`. Statut: **BUILD_READY + SIMULATED_E2E_VERIFIED**. LIVE_SANDBOX_VALIDATED și REAL_PROJECT_READY nu sunt atinse.

## 1. Ce este

O cerință devine:
1. specificație versionată;
2. plan validat;
3. implementare de un singur writer (Codex);
4. verificări locale (runner Hub);
5. review independent doar-citire (Claude);
6. remediere limitată;
7. QA pe teste de acceptanță protejate;
8. preview + E2E în browser (criteriile `e2e` cu pași declarați);
9. pachet de livrare;
10. decizia ta.

Sub fabrică nu există un runtime nou. O misiune Software Factory e o misiune obișnuită (șabloanele `eng_bugfix`, `eng_feature`, `eng_refactor`) plus un rând de stare (`factory_missions`). Fiecare pas cu model e o execuție obișnuită prin `runs.start`, cu:
- poartă;
- lease (un singur writer);
- grant;
- backup;
- verificări MCP;
- model și efort explicite;
- cronologie.

Conductorul (`v2/server/factory/factory.mjs`) e determinist: decide pasul următor din rezultatele înregistrate, niciodată dintr-un model. Chief of Staff rămâne determinist; niciun LLM nu stă pornit permanent.

## 2. Etape și ce așteaptă misiunea

`SPEC_DRAFT` → **(aprobi scope-ul)** → `BASELINE` → `IMPLEMENTING` → `CHECKING` → `REVIEWING` → [`REPAIRING` → `CHECKING` → `REVIEWING`] × ≤ 2 → `QA` → `PREVIEW` → `DELIVERY_READY` → `ACCEPTED` | `REJECTED`

Stări laterale: `PAUSED`, `BLOCKED`, `NEEDS_OWNER_DECISION`, `CANCEL_REQUESTED` → `CANCELLED`.

`wait_reason` spune pe cine așteaptă misiunea:
- `approval`: tu;
- `grant`;
- `gate`;
- `provider`: modelul lucrează;
- `runner`: testele rulează, fără model;
- `owner_decision`;
- `cancel`: confirmarea opririi.

Interfața nu scrie „AI lucrează” când misiunea așteaptă backup-ul sau decizia ta.

## 3. Conceptele adăugate (doar ce lipsea)

| Concept | Tabel | Garanții |
|---|---|---|
| Specificație versionată | `factory_specs` | DRAFT poate avea probleme listate; doar o versiune fără probleme se aprobă; versiunea aprobată nu se editează; înainte de pornire, un scope schimbat = versiune nouă + aprobare nouă (aprobarea veche nu mai pornește nimic); după pornire, un scope nou = misiune nouă, ca diff-ul revizuit să conțină toată munca writer-ului |
| Snapshot de workspace | `factory_snapshots` | manifest complet (cale → sha256), copii text în `.ifrim/tmp/v2/factory/<misiune>/blobs`; fără git mutant, fără commit; fără linkuri, `.git`, `node_modules`, căi protejate; secretele doar după mărime/dată |
| Change set | `factory_change_sets` | cumulativ față de baza aprobată, plus delta față de cel anterior; diff calculat de Hub (Myers), redactat; hash; integritate; unul singur `CURRENT` |
| Review + findings | `factory_reviews`, `factory_findings` | verdict validat structural, legat de hash-ul change set-ului; findings cu dovadă; un review mai vechi devine `STALE` |
| Dovezi | `factory_evidence` | comandă, runner, izolare, exit code, număr de teste, durată, ieșire; dovezile unui change set mai vechi devin `stale` |
| Dispatch durabil | `factory_dispatches` | cheie de idempotență unică (misiune:etapă:ciclu:change set:încercare), revendicare atomică: dublu click, două taburi sau reconectare nu pornesc două execuții |
| Pachet de livrare | `factory_bundles` | Markdown + JSON cu hash; legat de change set-ul testat; `STALE` dacă workspace-ul s-a schimbat |

Plus două coloane noi pe `agent_runs`: `timeline_json` și `plan_json`.

## 4. Reguli impuse de cod

**Specificația (`spec.mjs`):**
- fiecare criteriu are `id`, text și mod de verificare (`test`, `review`, `manual`, `e2e`, `preview`);
- un criteriu `test` numește fișierul testului de acceptanță;
- cel puțin un criteriu se verifică prin test;
- comenzile acceptate sunt doar: `node --test [căi]`, `npm test`, `npm run build|lint|typecheck|test`;
- preview-ul acceptă doar `node <fișier>.js` sau `npm run start|dev|preview`, pe `http://127.0.0.1:<port>`, nu pe porturile Hub-ului;
- un criteriu `e2e` poate avea pași declarativi (cel mult 25): `viewport`, `goto` (doar căi relative), `fill`, `select`, `click`, `expectText`, `expectSelector`, `noHorizontalOverflow`. Fără scripturi și fără URL-uri. Pașii fac parte din specificația aprobată, deci writer-ul nu îi poate schimba. Un criteriu cu pași cere un preview;
- cerințele utilizatorului, observațiile din cod și presupunerile sunt păstrate separat.

**Planul (`plan.mjs`):**
- un singur writer (Codex, scriere în workspace);
- reviewer doar-citire pe **alt** provider (Claude);
- runner Hub fără model;
- se verifică: DAG fără ciclu, un singur început, dependențe cunoscute;
- limite: ≤ 2 cicluri de remediere, 10–480 min, 1–3 încercări pe etapă, concurență 1.

**Aprobarea scope-ului:**
- e ALWAYS_ASK, legată de specificație (versiune + hash), plan, rute, model/efort, limite și comenzi;
- la pornire, Hub-ul recompară scope-ul: dacă s-a schimbat după aprobare, pornirea e refuzată;
- aprobarea e de unică folosință;
- nu creează granturi și nu deschide poarta.

**Testele de acceptanță protejate:**
- hash-urile lor se fixează la aprobare;
- dacă writer-ul le modifică sau le șterge, apare un finding critic → `NEEDS_OWNER_DECISION`, iar verificările nu rulează;
- QA reverifică hash-urile.

**Integritate (`integrity.mjs`), findings pe tipuri:**
- critic: fișiere de control (`.codex/`, `.claude/`, `.mcp.json`, `AGENTS.md`, `CLAUDE.md`, markerul de test);
- ridicat: test șters; `skip`, `only` sau `todo` adăugat; fișier secret atins;
- mediu: test existent modificat (cere review separat); `catch` gol; lint sau tipuri dezactivate.

**Runner-ul (`runner.mjs`):**
- comenzile rulează prin `codex sandbox`, cu profilul `ifrim_hub_rw` și rețeaua oprită, niciodată cu drepturile backend-ului;
- dacă sandbox-ul nu e gata sau acordul ACL lipsește → `BLOCKED`, fără alt mod de rulare;
- 0 teste descoperite sau o ieșire fără sumar → INCONCLUSIVE, nu PASS;
- un test sărit sau `todo` nu e PASS;
- timeout 180 s.

**Remedierea:**
- fiecare finding blocant sau test eșuat devine un task de remediere legat de cauza exactă;
- brief-ul remedierii conține codurile findings-urilor și testele care pică;
- după 2 cicluri, sau dacă un ciclu nu reduce problemele (fără progres măsurabil) → `NEEDS_OWNER_DECISION`;
- un ciclu în plus se acordă doar prin decizia ta din UI și consumă încercări din grant;
- un eșec de securitate, acces sau facturare nu se ocolește prin schimbarea providerului: rămâne blocaj.

**Review-ul (`review.mjs`):**
- brief-ul conține specificația, change set-ul exact (`CHANGE_SET <sha12>`), fișierele, diff-ul și verificările;
- răspunsul trebuie să fie un singur bloc JSON validat;
- PASS e refuzat când există findings critice sau ridicate, context lipsă sau un finding anterior încă deschis;
- CHANGES_REQUESTED fără findings, sau un review pe alt change set → INCONCLUSIVE;
- dacă fișierele s-au schimbat în timpul review-ului, review-ul devine `STALE` și se creează un change set nou.

**Stop, pauză, recuperare:**
- **Stop:** marchează imediat misiunea; nicio etapă nouă nu pornește. Se întrerup doar execuția și procesele misiunii. `CANCELLED` apare doar când nu mai rulează nimic.
- **Pauză:** etapa curentă se întrerupe, cea următoare nu pornește; reluarea repetă același pas ca încercare nouă, fără un ciclu nou.
- **Restart Hub:** dispatch-urile în curs devin `INTERRUPTED_UNKNOWN`, misiunea devine `BLOCKED`, nimic nu se reia singur.
- **Rezultate întârziate:** ce sosește după oprire e arhivat (`factory.late_result`) și nu declanșează nimic.

**Livrarea:**
- `READY_FOR_OWNER_ACCEPTANCE` ≠ RELEASED;
- „Accept local” reverifică workspace-ul față de change set; fără commit, push sau deploy;
- respingerea cere un motiv și oprește preview-ul.

**E2E în browser (după preview, pe versiunea verificată):**
- browserul e cel al Browser Workspace: Playwright 1.61.0, Chromium 1228 cu sandbox-ul OS, context nou fără profil, doar originea preview-ului;
- se oprește la primul pas care pică și raportează pasul exact (de exemplu „pasul 3 (expectText)”); păstrează o captură ca dovadă;
- un pas care pică devine finding QA (severitate ridicată) și intră în remedierea limitată, ca orice verificare eșuată;
- fără Playwright, criteriul rămâne NEEDS_INSTALL_APPROVAL în pachet; nu se pretinde nimic.

**Infrastructura de control:**
- Software Factory refuză Hub-ul însuși ca proiect (în afara testelor automate), deci o misiune nu-și poate modifica supraveghetorul;
- un singur proiect are cel mult o misiune activă (un singur writer).

## 5. Roluri reale (fără simetrie inventată)

- **Codex:** writer, cu scriere în workspace, sub sandbox OS. E candidat pentru live după revalidare. Ultima validare live de scriere (`run_muojnivb`) a fost făcută înainte de reparația MCP, deci nu dovedește traseul actual.
- **Claude:** reviewer doar-citire, la nivel de unealtă. Shell-ul și scrierea rămân BLOCKED pe Windows nativ. Poate propune text de patch, dar nu îl aplică nimeni sub identitatea Hub-ului.
- **QA:** runner-ul Hub plus teste deterministe, fără model.
- **Lega:** intrarea vocală (vezi `LEGA.md`):
  - propune o misiune `eng_*` → specificație v1 ca ciornă, după click-ul tău;
  - raportează etapa prin `mission_detail`;
  - nu poate porni, aproba, accepta, respinge sau marca findings (canal `voice` refuzat).

## 6. Demonstrații (fixture-uri în `v2/fixtures/factory`)

| Demo | Fixture | Ce dovedește | Simulat | Live |
|---|---|---|---|---|
| A — bug cu regresie | `bug-demo` (nume din spații acceptat; testul `test/acceptance.test.mjs` pică înainte de fix) | baseline roșu din motivul așteptat → fix → test de regresie → verificări → review PASS → QA → pachet → acceptare | **PASS_SIMULATED** (M03-FAC-01) | NOT_RUN |
| B — feature frontend + backend | `service-request` (formular + `POST/GET /api/requests` + node:sqlite de test + deduplicare + listă) | verificări eșuate → remediere limitată → review → QA de integrare (server real, bază de test) → preview din versiunea verificată → **E2E în Chromium real** (12 pași, mobil 390 px) → AC-7 PASS_EVIDENCE | **PASS_SIMULATED** + browser real (M03-FAC-02) | NOT_RUN |
| C — review, handoff, Stop | `bug-demo` | CHANGES_REQUESTED → remediere → re-review PASS (FAC-03); INCONCLUSIVE fără aprobare inventată (FAC-04); Stop în turn (FAC-07), Stop All (FAC-08), pauză (FAC-09), restart (FAC-10); handoff cu context (FI-01/02) | **PASS_SIMULATED** | NOT_RUN |

**Simulatorul (8012):** butoanele „Fabrica A/B/C” pregătesc misiunea; scope-ul îl aprobi tu.

**Live:** proiectele de test se creează cu `npm run v2:factory-fixture -- bug-demo` și `-- service-request`. Scriptul îl rulezi tu: creează foldere lângă Hub.

## 7. Interfață

**Misiuni:**
- „Lucrare de engineering” creează misiunea și specificația v1;
- pe pagina misiunii, panoul Software Factory arată:
  - etapele și motivul așteptării;
  - limitele, granturile necesare și starea runner-ului;
  - specificația, editabilă doar ca versiune nouă;
  - „Cere aprobarea scope-ului” → „Aprobă și pornește” (hash afișat);
  - execuțiile, cu model, efort, sursa lor și timpul pe faze;
  - change set-urile și diff-ul;
  - review-urile și findings (marcare fals pozitiv / contestat, cu motiv);
  - dovezile;
  - pachetul (acceptare sau respingere locală);
  - butoanele Pauză / Stop / Reia (+ „încă un ciclu” / „QA după review neconcludent”, decizii ale tale).
- **Inspector (Focus):** planul de model și efort plus cronologia fiecărei execuții.
- **Integrări → Izolare:** R2 pe proiecte, cu acceptarea limitată în timp.

Scurtăturile (Alt+J, Alt+M, Ctrl+K), protecțiile AltGr/IME, limitele atașamentelor și SSE cu backpressure sunt neschimbate.
