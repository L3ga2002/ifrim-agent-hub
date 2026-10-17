# Etapa 2026-10-16/17 — M12 Sales: flux intern delimitat (brief → ofertă → „Dosarul ofertei”)

## 1. Activare și reguli
- Proprietarul a activat `.ifrim/M12_PROMPT.md` (commit `2fa81a9`, antet încă „DRAFT”) prin mesajul din 2026-10-16 20:21 UTC, cu precizările
  obligatorii 1–6 (copiate integral în notițele etapei, `C:\Users\mihai\m12-sales\OWNER_PROMPT.md`). Mesajul activează documentul; antetul
  DRAFT nu a fost modificat de agent.
- §25 neatins; baseline-ul nu a fost repetat înaintea dezvoltării.
- Izolare: dezvoltare în clone scurte (`C:\Users\mihai\hub-m12*`, `core.autocrlf=false`, joncțiune `node_modules`), Node de sistem 24.14.0;
  niciun agent nu a pornit Hub-ul / Fabrica peste date reale sau copii; citiri live doar prin API-ul GET.
- Roluri: Codex a implementat partea 1 (20:10–20:29 UTC). La 21:41 UTC contul Codex a atins limita de utilizare („try again at Oct 22nd,
  2026 1:54 PM”); rularea 2 s-a oprit după 2 minute, modificările ei parțiale au fost salvate separat și scoase. La 21:45 UTC proprietarul
  a decis: „muta pe claude pana resetez limita”. Părțile 2–4 și corecțiile au fost implementate de agenți Claude separați; review-urile
  au rămas independente (alți agenți, doar-citire). Regula de raționament (proprietar, 2026-10-17 07:44 UTC): coordonatorul pe extra,
  thread-ul pe high, agenții porniți de thread pe medium.

## 2. Ce s-a construit (cod `2.15.0-m12`, API contract 15, schema 13)
- **Autoritatea deciziilor (precizarea 1, §4c):** `sales.proposal.approve` și `sales.qualification.override` pe canale `owner`/`test`
  prin dispatcherul de proprietar; tipul de aprobare `sales.proposal_approve` e rezervat și se decide doar prin `approval.owner_decide`
  într-o sesiune de proprietar proaspătă (decided_via `owner_session`, credențial și autoritate înregistrate); `executeApproved` primește
  sesiunea și o reverifică (aceeași credențială, decidentul nerevocat, inclusiv granița revoke-all) ÎNAINTE de consumarea aprobării;
  ID `spr_` + SHA complet (64 hex, `trim:false`) până în serviciu; în tranzacția finală: sesiune recitită, versiune, stare, hash, CAS;
  o singură decizie la repetare/concurență; un refuz definitiv retrage aprobarea (nu cere Windows Hello degeaba); ALWAYS_ASK și legarea
  de payload păstrate. Nicio operație nouă de ștergere.
- **Pregătirea cu un singur plan (precizările 2–3):** plan ops `sales.prepare` (fără model): firmă + oportunitate sintetică (identitate
  `.test` unică, dovezi FIXTURE), cercetare doar fixture (gazdă fără pagină → UNKNOWN; live refuzat), calificare q-v2, ofertă legată de
  intrări → READY_FOR_OWNER_REVIEW; pregătirea așteaptă WAITING_OWNER cu id + SHA exact. Confirmarea planului NU aprobă oferta. Aprobarea
  reală a proprietarului a exact id + SHA activează faza B derivată (`sales.dossier`, fără altă confirmare): ciorna de contact
  (`createDraft` neschimbat, DRAFT_ONLY) și dosarul. Schimbarea intrărilor / expirarea / revocarea / „Oprește tot” → STALE / EXPIRED /
  STOPPED cu motiv și card de continuare (regula existentă de reconfirmare; după „Oprește tot” doar după redeschiderea porții).
- **C-01:** registrul `sales_plan_ops`, cheia = planul rădăcină confirmat (id + hash) + operație + parametri normalizați; două apeluri
  concurente → un rând, un eveniment, același id; două planuri cu același text nu se unifică; reluarea reconciliază din registru.
- **„Dosarul ofertei”** (`sales_dossiers`, `sdo_`; `sales_handoffs` / `sales.handoff.create` rămân predarea către Engineering):
  `<exports>\vanzari\oferta-sintetic-…\revizia-N-…\` creat exclusiv; oferta .md + .docx (+ .pdf doar dacă a rulat Word), fișa firmei,
  dovezi cu proveniență (etichetă + fel), calificarea explicată, ciorna DRAFT_ONLY (sent: false), README, manifest sha256 scris ultimul;
  octeți identici la reluare; Word: APP_VERIFIED / APP_NOT_RUN / APP_FAILED declarat; revizie selectivă (R-REV / R-PACK).
- **Proveniență și calificare:** C-03 felul datei FIXTURE / STATEMENT / INFERENCE separat de eticheta M04; C-04 `q-v2` (strict: niciun
  punct fără dovadă non-inferență cu id; inferențele în explicație și „ce lipsește”); `q-v1` rămâne implicit pentru M04.
- **Brief și prețuri (S-01, C-02):** parser determinist `brief-v1` (câmpuri USER_PROVIDED verbatim / INFERRED cu regulă, ipoteze,
  ce lipsește); sumele, termenele, ROI și reducerile (și în cuvinte) sunt tăiate din textul pentru client și blocate de scanner;
  prețul lipsă = UNKNOWN „De stabilit (neconfigurat)”. Catalogul și prețurile reale rămân necunoscute.
- **Lega (S-07):** „pregătește o ofertă…” → un card; „arată-mi oferta”, „ce lipsește?” → citiri; „aprobă oferta” → explică unde, nu aprobă;
  „continuă pregătirea ofertei” → un card de continuare sau refuzul adevărat; trimiterea / contactarea / publicarea către client sunt
  refuzate (OUTREACH_DISABLED) pe toate căile, cu regulă pe rădăcini de verb; o cerere mixtă își păstrează partea legitimă.
- **UI:** ținta exactă (id, versiune, SHA complet), „Aprob intern” cu cel mult o confirmare WebAuthn și text după autoritate (Windows
  Hello doar pentru webauthn; profilul local spus ca atare), panoul pregătirii + continuare, lista dosarelor, cifre reale separate de
  cele sintetice, decizia ofertei în „Deciziile mele”.
- **S-08:** o ofertă aprobată nu înseamnă trimisă / CONTACTED / WON; un task COMPLETED nu schimbă starea comercială; CONTACTED / WON doar
  prin evenimentele M04 (test structural).

## 3. Schimbări de contract declarate (excepția C-07)
- API contract 14 → 15 (formele aprobării, suprascrierii, owner_decide, execute; rutele noi: GET dosare, POST continuare; câmpuri aditive
  listate în `v2/server/config.mjs`).
- M04-BR-01 pasul 5: aprobarea cere sesiunea de proprietar (localhost + autentificator virtual); cererea veche fără sesiune păstrată ca
  test negativ (401, oferta neschimbată).
- Pinuri de release: INT-05, R1-10 (REG-04) → 2.15.0-m12 / 15; `PLANNER_KINDS` + `sales`; M11-MG-01 limitat la migrările ≤ 12.
- Migrarea 13 `m12-sales-prep` (aditivă; codul vechi rulează pe ea).
- Motor comun: expirarea planurilor ops numărată de la confirmare (D11, conform `proposal-window.mjs`); `confirmedAuthority`: revoke-all
  încheie și autoritatea purtată de o sesiune deja închisă (regula DP-05); supersede limitat la aceeași pregătire pentru `sales.prepare`;
  `registerResumeGuard` (aditiv) pentru reluarea planurilor Sales după „Oprește tot”.

## 4. Review și corecții
Toate review-urile au fost doar-citire, pe clone sintetice, fără Hub peste date reale; fiecare constatare a fost verificată de doi
sceptici. Dovezile complete sunt în `C:\Users\mihai\m12-sales\` (REVIEW_*.json, FIXES_*.md, impl\*-report.md).

| rundă | ce a acoperit | rezultat | corecții |
|---|---|---|---|
| investigare (6 agenți) | codul existent vs. cerințe | design D1–D16 (SPEC_M12.md) | — |
| review partea 1 (30 agenți) | autoritatea ofertei / suprascrierii | 0 critice; 1 pin de release, 3 medii, 7 mici | FIXES_P1 (`006f02a`) |
| review părțile 2–3 (53 agenți) | schema 13, q-v2, brief, plan, dosar | 0 critice / 0 importante; 12 medii, 16 mici | FIXES_P23 (`b787039`) |
| review final (51 agenți) | partea 4 + integrare + M12 întreg | 0 critice; 3 importante (continuarea neaccesibilă din UI, refuzul trimiterii prea larg), 10 medii | FIXES_FINAL A/B (`191de0c`, `686cb6b`) |
| re-review țintit (29 agenți) | corecțiile finale | 0 critice / 0 importante; 6 medii pe regula de refuz | FIXES_RR (`b82523b`) |
| verificare scurtă (7 agenți, medium) | ultima rundă | 5 importante: formulări de trimitere scăpate | FIXES_LAST: regulă pe rădăcini de verb (`d311980`) |

Coordonatorul a prins și reparat o regresie reală în partea 1 (misiunile pornite din plan cereau o sesiune nouă) și o cursă de afișare
în Lega.jsx (cardul de redeschidere apărea înaintea răspunsului). Testele existente schimbate sunt doar cele declarate în §3, plus teste M12
care codificau defectele raportate (listate în rapoartele implementatorilor).

## 5. Poarta completă (T-S8)
O singură rulare completă pe codul final `d311980` (arbore `8de1d5e7` = arborele merge-ului `dc4500f`), în clona nouă
`C:\Users\mihai\hub-m12-gate`, fără remote, cu `git status` gol, fără pointer de date și fără `HUB_*` moștenite, pe Node 24.14.0 de sistem.
Build 0, build:v2 0, Studio construit în clonă, cu `HUB_V2_STUDIO_DIST` și `HUB_V2_WEB_DIST` setate explicit (identitate verificată:
`2.15.0-m12` / `contract:15`). Lansare detașată WMI; loguri în `C:\Users\mihai\m12-sales\gate\run-final2\`.

- **V2 `npm run test:v2`: exit 1, 2512 = 2510 PASS, 1 FAIL, 0 anulări, 1 SKIP (T25)**, 5151 s, 0 procese rămase.
  - Eșecul: **RM-10** (`v2/tests/r-media-holds.test.mjs:302`, filmare reală Chromium + ffmpeg din M11): pauza planificată `proof_hold`
    lipsea din captură.
  - M12 nu modifică niciun fișier de media sau captură. Același test a trecut în rularea completă precedentă pe `b82523b`, care diferă
    doar prin regula de refuz.
  - Reluat singur, ca diagnostic, pe același cod (12:5x UTC): `r-media-holds` 11/11 (`rerun-rm10.log`).
  - **Poarta V2 nu e complet verde.** Nu a fost relansată, iar rulările nu se combină.
  - Încărcarea mașinii: medie 57,6 %, maximum 99 %, memorie liberă 14–16 GB.
- **V1 `npm run test`** (aceeași clonă): exit 1, 552 = 549 PASS, 2 FAIL, 1 SKIP. Sunt exact cele două teste dependente de registrul real
  `..\PROJECTS.md` (`conversation-api`, `workflow-refresh-api`). Nu sunt reparate în M12 și nu sunt prezentate ca PASS.
- Rularea completă precedentă (`b82523b`, `gate\run-final`): V2 exit 0, 2509 = 2508 PASS, 0 FAIL, 1 SKIP (T25); V1 la fel ca mai sus.
- Rulările intermediare (`7fc6c89`: 2334/2336; `f0aa6fb`: 2467/2469) au prins pinul contractului și cursa din Lega.jsx; ambele reparate.

## 6. Dovezi ale fluxului
- **Testul cap-coadă `M12-E2E-01`** (HTTP, hub sintetic): cerere scrisă → UN card → confirmare (autentificator software) →
  WAITING_OWNER → aprobarea exactă id + SHA → faza B derivată fără altă confirmare → dosar READY (APP_NOT_RUN), manifest verificat,
  ciornă DRAFT_ONLY. Rezultat: 0 trimiteri, 0 CONTACTED/WON, 0 `sales_handoffs`, 0 misiuni, catalog neschimbat.
- **`E2E-02`:** același flux sub profilul local, înregistrat ca `local_dev_profile`, niciodată ca Windows Hello.
- **Rularea manuală Word** (`v2/tests/manual/m12-dossier-word.mjs`, hub sintetic, COM pornit): **APP_VERIFIED** (Word 16.0, 2 pagini).
  - Dosarul `sdo_80b2fd6f96_4bea48a74e`, revizia 1, READY, manifest `57a08301…721d`, 10 fișiere inclusiv PDF-ul.
  - Copiat ca dovadă în `C:\Users\mihai\m12-sales\evidence\word-run-1\`.
  - Oferta sintetică are „Ce s-a cerut: programări online (USER_PROVIDED)”, prețul și termenul „De stabilit (neconfigurat) (UNKNOWN:
    catalog neconfigurat)” și ciorna „DRAFT_ONLY — NETRIMISĂ (OUTREACH_DISABLED)”.
- **Măsurători (D15):** fluxul cere proprietarului exact două acțiuni: confirmarea planului și aprobarea internă a ofertei. `probe` le
  numără pe autoritate (webauthn / local_dev_profile). Agentul nu a simulat nicio acțiune a proprietarului.

## 7. Revenire (C-06)
| Scriere | Revenire |
|---|---|
| rânduri Sales M12 | marcate `synthetic = 1`, păstrate ca istoric; nicio ștergere nouă (precizarea 1) |
| dosarele | foldere noi, create exclusiv, niciodată suprascrise; un dosar întrerupt rămâne INCOMPLETE cu fișierele parțiale listate |
| registrul C-01 | doar adăugare / actualizare; IN_PROGRESS fără efect = reluare sigură |
| schema 13 | aditivă: `git revert -m 1 <merge>` + `node v2\scripts\upgrade.mjs --apply`; restaurare completă din backup-ul pre-migrare verificat |

## 8. Release
- **Backup verificat** prin API-ul live, înainte de merge: `bkp_mvcejgzd_fb1915d20d` (Hub, integritate ok, 2026-10-17 12:57 UTC).
- **Merge `dc4500f`** (`--no-ff`, părinți `2fa81a9` + `d311980`) în `v2-milestone-01`, în folderul Hub. Arborele lui este identic cu cel
  testat (`8de1d5e7`). Revenirea a fost verificată într-o clonă: `git revert -m 1 dc4500f` dă exact arborele `2fa81a9`.
- **Cele 20 de fișiere ale proprietarului** (modificate doar la capăt de linie): prima încercare de merge a fost refuzată („commit your
  changes”), a doua a trecut după reîmprospătarea indexului. Conținutul lor era identic cu indexul (`git diff` gol), deci nu s-a pierdut
  nimic. Acum `git status` e gol.
- **Atenție:** cu merge-ul în folderul Hub, o repornire a PC-ului înainte de upgrade lasă Hub-ul oprit. Garda de pornire refuză să pornească
  peste migrarea 13 neaplicată. Upgrade-ul gestionat o aplică, cu backup pre-migrare verificat de server.
- **Scriptul proprietarului** `C:\Users\mihai\m12-sales\owner-release.cmd`, care se oprește la primul pas eșuat:
  1. starea locală (HEAD);
  2. `upgrade.mjs --plan`, doar citire: versiuni și migrarea 13 încercată pe o copie din folderul de date;
  3. `upgrade.mjs --apply`;
  4. verificarea versiunii `2.15.0-m12`, a contractului 15 și a schemei 13 prin GET;
  5. push pentru `v2-milestone-01` și `claude/project-thread-azwsjr`.
  Push-ul și upgrade-ul sunt refuzate agentului de stratul de permisiuni; le rulează proprietarul.

## 9. Ce rămâne (decizii și probleme separate)
Decizii ale proprietarului:
1. Rularea scriptului de release, știind că poarta V2 are 1 eșec în afara M12 (RM-10), care trece singur. Alternativa este o nouă poartă
   completă pe același cod.
2. Catalogul de servicii și prețurile reale: BLOCAT DE DOVEZI. Rămân „De stabilit (neconfigurat)” până le dă proprietarul.
3. O probă live opțională după upgrade: o cerere „pregătește o ofertă…” în cockpit, apoi confirmarea cardului și aprobarea ofertei de
   către proprietar. Scrie rânduri sintetice în baza live; agentul nu confirmă nimic în locul lui.
4. Când se resetează limita Codex: un review independent Codex al codului scris de Claude, opțional, pentru rolurile inițiale.

Probleme separate, deschise:
- `factory.reject` fără sesiune: prioritar înaintea oricărui proiect nou prin Fabrică. Fluxul M12 nu atinge Fabrica.
- Aprobările M04 nefolosite de M12 rămân pe `ui` fără sesiune: `sales.draft_content`, `sales.suppression_lift`, `sales.import_rollback` și
  catalogul. `approveDraftContent` acceptă și un SHA format doar din spații.
- Profilul local de dezvoltare: orice proces loopback poate deschide o sesiune de proprietar. Comportament aprobat, nereproiectat în M12.
  Consecință nouă: un astfel de proces poate retrage o decizie WebAuthn executând-o cu o sesiune dev, fără să câștige autoritate.
- Autoritatea în serviciu se bazează pe `sessionCheck` primit de la apelant; executorii sunt păziți de un test static.
- Regula de refuz a trimiterii are reziduuri cunoscute (lista în `impl\last-report.md`). Trimiterea rămâne oricum imposibilă:
  `OUTREACH_DISABLED` în transport.
- `sales.preparation.cancel` nu are rută sau buton pentru proprietar.
- RM-10 (captură reală): eșec intermitent sub încărcare, de urmărit separat.
- Cele două teste V1 dependente de registrul real; media, autorul pasului 0 și afișările minore (secțiunile precedente).
