# Etapa 2026-10-19 — Catalog minim și o ofertă Sales utilă (cod `2.15.5-m12`, API contract 17, schema 13, fără migrare)

## 1. Activare și reguli
- Mesajul proprietarului din 2026-10-18 22:27 UTC (thread-ul „Catalog minim și ofertă Sales”): un singur serviciu în catalog („Programări
  online pe site”), apoi O singură revizie a pregătirii existente pentru Lăstărel Auto Service Tăunel SRL prin continuarea oficială; versiunea 1,
  dosarul și aprobarea ei rămân în istoric; aprobarea veche nu se refolosește. Fără M13, fără regresia completă, fără reluarea pilotului.
- Stare verificată la start (doar GET, 22:32 UTC): live `2.15.4-m12`, contract 17, schema 13, BUILD_SAFE, poarta deschisă, boot
  `boot_mvedo9xq_69194966b6`; folderul Hub = `origin/v2-milestone-01` = `6cba12e`, arbore curat. `f8296f9` (docs de închidere) exista doar
  în clona `hub-ui`; a fost dus mai departe ca bază a acestei etape. Catalog: 0 servicii. Oportunitatea `opp_mvds4ouj_c6949c345f`
  APPROVED_INTERNAL, `serviceId` null; oferta `spr_mvds4ow4_707666fdb3` v1 APPROVED_INTERNAL (SHA `6a23d454…f28b`); pregătirea
  `spp_mvds47w1_d37ec6dc82` READY, `continuable: false`; dosarul `sdo_12cec46b1e_7ce44b92b4` revizia 1 READY (manifest `84b4b211…c0df`).
- Izolare: clona `C:\Users\mihai\hub-cat` (ramura `claude/project-thread-buj7tz`, bază `f8296f9`, `core.autocrlf=false`, joncțiune
  `node_modules`), Node 24.14.0, doar hub-uri de test sintetice create de la zero. Live: doar GET. Dovezile: `C:\Users\mihai\catalog-stage\`.

## 2. Defecte găsite (blocau fluxul cerut) și reparația
1. **Serviciul salvat nu ajungea în oferta M12 și revizia nu se putea cere.** Pregătirea M12 creează oportunitatea fără serviciu;
   `createProposal` folosea doar `opp.serviceId`, `preparationBasis` hashuia doar serviciul oportunității, iar `saveService` nu invalida nimic.
   După salvarea serviciului: oferta v1 rămânea APPROVED_INTERNAL, pregătirea READY (necontinuabilă), iar o versiune nouă tot fără serviciu.
   Reparație (`v2/server/sales/sales.mjs`): `offerService(opp, { bound })` — serviciul oportunității; pentru o ofertă legată de o pregătire
   fără serviciu, SINGURUL serviciu activ din catalog (regula existentă din `renderProposal`; niciodată o alegere între mai multe). Ofertele
   M04 neschimbate. `saveService` cheamă `invalidateBound` pe firmele cu oportunități: ofertele legate ale căror intrări s-au schimbat devin
   STALE, cu pregătirea și dosarul lor (istoricul și aprobarea înregistrată rămân), deci continuarea oficială se aplică.
2. **Formularul de serviciu nu avea „materiale”** (ce trebuie să primim de la client), deși catalogul și oferta îl suportă („Materiale necesare
   de la dumneavoastră”), iar o editare din UI le ștergea. Reparație: câmpul „Ce trebuie să primim de la client” în editor și în listă
   (`v2/web/src/lib/salesLogic.js`, `v2/web/src/screens/sales/Services.jsx`), păstrat la editare.
3. Cardul planului ofertei spunea „catalogul tău (gol…)” și după ce catalogul are servicii — text corectat (`plan-executors.mjs`).
- Commit cod: `db7cc0c` + corecția de review (versiunea `2.15.5-m12`). Teste noi `v2/tests/r-catalog-revision.test.mjs`: R-CAT-01 (READY pe catalog gol →
  serviciu salvat → v1/pregătire/dosar STALE, revizia 1 neatinsă pe disc, aprobarea v1 refuzată pentru noua ofertă → un card de continuare →
  v2 din serviciu, preț/termen UNKNOWN, 0 cifre comerciale → aprobarea v2 → dosar revizia 2 READY, ciornă DRAFT, nimic trimis), R-CAT-02
  (două servicii active → niciunul ales; M04 neatins), R-CAT-03 (materialele păstrate de editor). Înainte de reparație: 3/3 FAIL
  (`catalog-stage\before-fix.txt`); după: 3/3 PASS.
- Review independent doar-citire (agent separat, medium): 0 critice, 0 importante; 2 minore — (1) o salvare neschimbată creștea versiunea și
  invalida oferta degeaba → reparat (commit `a20d77f`, verificat în R-CAT-01); (2) după upgrade, o ofertă legată randată fără serviciu
  într-un catalog cu exact un serviciu activ apare imediat ne-curentă — pe live catalogul e gol, deci fără efect; comportament corect, notat.
- Teste ale zonelor afectate (Sales, M12, M04, UI-ul vânzărilor, browser, versiunea; 42 de fișiere, build UI nou): **412/412**
  (`catalog-stage\run-1`). Suita completă nu s-a rulat: schimbarea e limitată la Sales; baseline-ul 2565/2566 rămâne.

## 3. Fișa serviciului (pregătită pentru proprietar; o salvează el, Vânzări → Servicii)
Textul exact e în `C:\Users\mihai\catalog-stage\service-card.json` (verificat: 0 cifre comerciale, 0 promisiuni de venit / ROI, preț și termen
neconfigurate). Capabilități folosite: doar cele dovedite în demo-ul de programări acceptat (§25 și fixture-ul `booking-demo`): alegerea
serviciului, a zilei și a unui interval liber pe telefon și desktop; intervalul ocupat indisponibil; refuzul intervalului ocupat / trecut /
datelor invalide; programările păstrate după repornire; telefonul obligatoriu, salvat exact, absent din lista publică; teste și verificare în
browser. Ce nu e dovedit e trecut la „Ce nu include” (pagină internă cu parolă, SMS / e-mail, anulare / mutare, mai multe mașini pe interval,
plată, sincronizare calendar, găzduire / întreținere) și la deciziile proprietarului.

## 4. Release și pașii proprietarului
- Release: `C:\Users\mihai\catalog-stage\release\owner-release.cmd` (BASE `6cba12e`, CODE `a20d77f`, RELEASE = commitul de documentație
  de deasupra; backup verificat prin API, fast-forward, `upgrade.mjs --plan/--apply`, `verify.mjs` doar GET, push `v2-milestone-01` +
  `claude/project-thread-buj7tz`; se oprește la primul pas eșuat). Fără migrare.
- Apoi, în sesiunea lui: salvează serviciul (Vânzări → Servicii), „Pregătește continuarea” pe oportunitate, confirmă cardul, inspectează
  oferta v2 și apasă „Aprob intern” pe ID-ul și SHA-ul afișate. Dosarul revizia 2 urmează derivat.

## 5. Rezultat live (verificat doar prin GET și pe disc, 2026-10-20 00:33–00:40 UTC)
- **2.15.5 LIVE**: proprietarul a rulat `owner-release.cmd`; `2.15.5-m12` / 17 / schema 13 / BUILD_SAFE, boot `boot_mvfy5813_c620e596e0`,
  `VERIFY OK` (inclusiv câmpul „Ce trebuie să primim de la client” servit). `origin/v2-milestone-01` = `origin/claude/project-thread-buj7tz` = `3a3abdb`.
- Pașii proprietarului (autoritate `local_dev_profile`, profilul de dezvoltare neschimbat): serviciul `svc_mvfy6xjo_0a4dbd077d` v1 salvat
  00:31:25 UTC — câmpurile identice cu `service-card.json` (9 / 7 / 7 rânduri, preț și termen NOT_CONFIGURED); cardul de continuare confirmat
  00:31:58 (planul `opp_mvfy7lcl_e196afa7ca`); „Aprob intern” pe `spr_mvfy7mq5_9ffac33cbc` v2, SHA
  `458681c2b78a6f36091c944d07d6f513feb2f21fbe87ac96a1137b7f6f4bc637`, la 00:33:28 UTC.
- Oferta v2: `serviceIds` = `svc_mvfy6xjo_0a4dbd077d@1`, baza o leagă de același serviciu; secțiunile Soluție / Ce include / Ce nu include /
  Materiale conțin toate rândurile fișei; preț și termen UNKNOWN („De stabilit (neconfigurat)”, motiv „catalog neconfigurat”); 0 cifre comerciale.
- Istoric: v1 `spr_mvds4ow4_707666fdb3` SUPERSEDED, cu aprobarea `6a23d454…f28b` păstrată; ciorna v1 SUPERSEDED; dosarul revizia 1 STALE
  („catalogul de servicii s-a schimbat”), 10/10 fișiere = manifestul pe disc, neatinse.
- Dosarul revizia 2 `sdo_b0b208ad82_5b5c17a433` READY, intrări curente: `…\vanzari\oferta-sintetic-lastarel-auto-service-taunel-srl-c6949c345f\revizia-2-5b5c17a433\`
  — 10/10 fișiere cu SHA = manifest (manifest `76a5753a…ffaf`); Word APP_VERIFIED (Word 16.0, 3 pagini, PDF `oferta-v2.pdf`); textul din .docx,
  .md și PDF conține serviciul, toate rândurile și „De stabilit (neconfigurat)”. Ciorna `sdr_mvfy9kp7_55e71f32b3` v2 DRAFT_ONLY — NETRIMISĂ
  (OUTREACH_DISABLED), legată de SHA-ul v2, numește serviciul. 0 contacte, 0 acceptări, 0 handoff Engineering; nimic trimis sau publicat.
- Limite rămase: oferta e utilizabilă pentru o discuție internă, dar nu e finală — prețul și termenul sunt neconfigurate; „Observații” e gol
  (firma sintetică nu are un site fixture auditat); o pagină internă pentru echipă și mai multe mașini pe interval nu sunt construite.
  Cu două servicii active, o ofertă M12 fără serviciu pe oportunitate nu alege niciunul (alegerea per oportunitate e lucru ulterior).
- Intervenții: 1 tehnică (comanda de release), 3 decizii de produs (salvarea serviciului, cardul de continuare, aprobarea v2).
- Următorul: propunerea M13 (`.ifrim/M13_PROPOSAL.md`), neîncepută.
