# IFRIM AGENT HUB — M12 SALES: FLUX INTERN DELIMITAT (PROMPT DE PORNIRE) — **DRAFT**

> **STARE: DRAFT.** Nu se trimite și nu se execută până când proprietarul îl revizuiește și îl trimite el însuși. Etapa din 2026-10-16
> seara („Verificarea finală a stabilității și pregătirea M12”) l-a actualizat; nu l-a pornit. Corecțiile cerute de proprietar în
> 2026-10-10 sunt în §4b și sunt cerințe, nu sugestii. Ce s-a schimbat față de versiunea din 2026-10-10 este marcat „(actualizat
> 2026-10-16)”; constatările noi din cod care cer decizia proprietarului sunt în §4c și nu sunt cerințe până nu le confirmă el.

Pregătit la 2026-10-10 din documentele și modulele reale ale repository-ului (`.ifrim/M04_SALES_ARCHITECTURE.md`, `.ifrim/M04_REPORT.md`,
`.ifrim/M04_CONTACT_POLICY.md`, `.ifrim/M04_DATA_PROVENANCE.md`, `v2/server/sales/*`, `v2/tests/m04-*`); actualizat la 2026-10-16 după
verificarea fiecărei afirmații în codul de la `ee6c93a` (detaliu: `.ifrim/STAGE_2026-10-16_STABILITATE_M12.md` §3). Numele
milestone-ului rămâne M12. Părțile marcate **BLOCAT DE DOVEZI** depind de informații care nu există încă; restul e executabil.

## 1. Rol și obiectiv

Ești Claude Code, coordonatorul etapei M12 în repository-ul local Ifrim Agent Hub. Rolurile rămân: Codex implementarea principală;
Claude Code în sesiune separată review independent; QA determinist; în fluxurile test-first, Claude propune testul, Codex îl verifică.
Regula curentă de lucru (din 2026-10-15): Opus + ultracode pentru fiecare etapă (investigare, review adversarial, critic), fără a consuma
capacitatea Claude necesară repetițiilor. Folosește integrările existente (magistrala de comenzi, planurile cu o confirmare, aprobările,
evenimentele, backup-ul, Lega, livrările M11, Office-ul local). Nu instala alt orchestrator; nu schimba furnizorii, modelele sau nivelurile
de raționament.

Obiectiv M12 (primul scop): un flux Sales **intern**, cu date sintetice, de la brief la pachetul de predare:

brief → oportunitate sintetică → cercetare cu proveniență → calificare explicată → ofertă în ciornă → pachet de predare.

Pregătirea materialelor e separată de contactare, publicare și buget. M12 nu contactează, nu publică și nu cheltuie nimic.

## 2. Baseline de verificat la pornire (actualizat 2026-10-16)

- ramura `v2-milestone-01`: la 2026-10-16 seara `origin/v2-milestone-01` = `ee6c93ac69cf4a31e65e72ef0e77aace4bb09a6a` (închiderea §25),
  urmat de commitul de documentație al etapei de stabilitate (`.ifrim/STAGE_2026-10-16_STABILITATE_M12.md`, §5 pentru starea push-ului).
  Verifică HEAD, `origin/v2-milestone-01` și `git ls-remote`; nu presupune.
- cod `2.14.19-m11` (`v2/server/config.mjs:10`), contract API **14** (`config.mjs:22`), schema 12 (ultima migrare: 12 `m11-deliveries`,
  `v2/server/storage/migrations.mjs`); M12 poate adăuga o migrare doar declarată, cu backup verificat și upgrade gestionat;
- versiunea live din `GET http://localhost:8011/api/health` (la 2026-10-16 18:18 UTC: `2.14.19-m11`, contract 14, `BUILD_SAFE`,
  `boot_mvb9cm9z`); citirile live doar prin API-ul GET al instanței pornite (§2a);
- modificările necomise ale proprietarului (la 2026-10-16: 20 de fișiere, doar capăt de linie, `git diff` gol): nu le atinge;
- §25 este **închis** și nu se redeschide: software-ul acceptat de proprietar în camera livrării la 2026-10-16 17:49:43 UTC (un singur
  `OWNER_ACCEPTED` pentru `bnd_mva0hc23_b3d65a8da9`, canal `owner`), misiunea `mis_mva09tjh_7692421b52` COMPLETED, ambele clipuri v2
  aprobate și rezumatul v2 aprobat la 11:19 UTC (READY de prezentat). M12 nu reia acceptarea, writer-ul, filmările sau aprobările;
- Sales existent (M04, contract în `.ifrim/M04_SALES_ARCHITECTURE.md`), verificat în cod la 2026-10-16: tabelele `sales_*` (migrarea 4
  `m04-sales-lead-generation`, coloana `synthetic` pe loturi, organizații, dovezi, audituri, servicii, oportunități); `EVIDENCE_LABELS`
  (USER_PROVIDED, OBSERVED, SOURCE_REPORTED, INFERRED, UNKNOWN; `v2/server/sales/sales.mjs:28`); `OUTREACH_DISABLED` (`sales.mjs:64`,
  `sendDraft` refuză) și `LIVE_COLLECTION_DISABLED` (`research.mjs:22`; registrul refuză adaptoarele `live`, `liveHttpAdapter` aruncă
  mereu), ambele în vigoare; `qualify.mjs` (`QUALIFICATION_FORMULA` = `q-v1`, ponderi 0,5/0,3/0,2; versiunea stocată în
  `formula_version`); `proposal.mjs` (`renderProposal`, `renderContactDraft`, `findUnresolvedPlaceholders`; prețul lipsă se scrie
  „De stabilit (neconfigurat)”); `research.mjs` (`fixtureSiteAdapter` `fixture-v1`, 10 site-uri `.test` în `v2/fixtures/sales/sites/`);
  `synthetic.mjs` (domenii `.test`, coduri fiscale fictive `99…`); `OPPORTUNITY_TRANSITIONS` (`sales.mjs:50–60`; APPROVED_INTERNAL,
  CONTACTED și WON doar prin evenimente); ecranele `v2/web/src/screens/sales/*` (Followups, ImportRows, Imports, Opportunity, OrgSheet,
  Orgs, Overview, Pipeline, Services, common; banda „sintetic” în `common.jsx`); testele `m04-*` (10 fișiere);
- catalogul de servicii: în cod pornește gol (migrarea nu seamănă nimic; prețul implicit `{"status":"NOT_CONFIGURED"}`); catalogul live
  avea **0 servicii** la 2026-10-16 18:19 UTC (`GET /api/sales/services?all=1`). Singurele sume din cod sunt sintetice (simulatorul, doar
  în modul test, și fișierele de test); nu sunt prețuri Ifrim Digital și nu se folosesc ca atare;
- rezultatul verificării de stabilitate (§5, T-S8) și `.ifrim/OPEN_ISSUES.md`, prima secțiune.

Inventariază scurt; nu face reset, curățenie sau checkout pentru uniformizare.

## 2a. Izolarea dezvoltării și a verificărilor (actualizat 2026-10-16; regula de după incidentul din 2026-10-16 00:48 UTC)

- Niciun agent de dezvoltare sau review nu inițializează și nu pornește Hub-ul / Fabrica peste baza reală ori copii ale ei: căile
  absolute dintr-o copie pot indica proiectele reale; eticheta „dry-run” nu oferă izolare. Un gard doar pentru rețea sau modele nu
  ajunge pentru accesul la fișiere.
- Citirile live doar prin API-ul GET al instanței deja pornite; citirea directă a bazei live e refuzată (și de clasificator).
- Testele construiesc baza și proiectele sintetice de la zero, în directoare temporare proprii (`v2/tests/helpers.mjs`: `TEST_TMP` =
  `<rădăcina codului>/.ifrim/tmp/v2-tests`; în modul test `config.mjs:73–77` cere `dataDir` sub `.ifrim/tmp`, iar pointerul
  `.ifrim/data-location.json` e ignorat). Pentru fluxuri cu decizii ale proprietarului, modelul este `v2/tests/accept-helpers.mjs`:
  rădăcină per test, `realpath` fără legături, toate rădăcinile efective (date, bază, backup, work) în rădăcina testului, baza inexistentă
  înainte, port ≠ 8011, Office COM oprit, gard de scriere și recitirea căilor stocate după seed. M12 adaugă aceste verificări și pentru
  testele Sales noi care pornesc Hub-ul.
- Codul nou se dezvoltă într-o clonă scurtă, în afara AppData și OneDrive (de ex. `C:\Users\mihai\hub-rc`, `core.autocrlf=false`,
  `node_modules` ca joncțiune), cu Node-ul de sistem 24.14.0 (fără fnm/nvm). Autostartul de la logon pornește Hub-ul din arborele de lucru
  al folderului Hub, deci acolo intră doar un release validat.
- Rulările lungi pornesc detașat (WMI), cu încărcarea mașinii înregistrată; PC-ul proprietarului e des la 84–100 % CPU din aplicațiile
  lui, care nu se opresc.

## 2b. Mecanismele actuale de autoritate, proveniență și integritate (actualizat 2026-10-16; de refolosit, nu de duplicat)

- **Sesiunea proprietarului recitită:** `hub.trust.requireSession` recitește rândul din bază, `requireFresh` adaugă fereastra de
  reautentificare (`v2/server/owner/trust.mjs:212–224`); existența unui `ownerSession.id` nu e suficientă.
- **Canale declarate per comandă:** implicit `ui`/`test` (`v2/server/runtime/commands.mjs:100`); deciziile proprietarului își declară
  canalele explicit (ex. `factory.accept`: `owner`/`test`, `requireFresh` + `sessionCheck` în secțiunea serializată,
  `command-catalog.mjs:226–234`; seturile `OWNER` / `OWNER_UI` / `ANY` din `delivery-commands.mjs:9–16`). Dispatcherul de proprietar
  (`owner-routes.mjs:27–38`) dă canalul `owner` doar cu sesiune și refuză un canal declarat agent/cli.
- **O confirmare per plan:** Mission Authorization Envelopes (`v2/server/owner/envelopes.mjs`) și planurile de operații
  (`v2/server/ops/plans.mjs`; `NEVER_IN_PLANS` include trimiterea de mesaje). Canalul `agent` cere `X-Hub-Delegation` și e limitat la
  proiecte de test (`commands.mjs:7–85`).
- **Ținta exactă afișată:** id + sha complet până la tranziția finală, compare-and-swap într-o secțiune serializată, repetarea întoarce
  decizia originală fără scrieri (modelul `factory.accept`, 2.14.19).
- **Integritate cu proveniență:** o singură decizie (`v2/server/factory/bundle-integrity.mjs`) folosită de acceptare și de verificarea
  livrării; o diferență scrisă de Hub e acceptată doar prin conținut validat ȘI octeți egali cu înregistrarea Hub-ului
  (`bundle-integrity-facts.mjs`); snapshot-ul și hash-urile brute rămân neatinse. Testele Hub istorice sunt protejate (R-HIST), o
  revizie refolosește doar ce are aceleași intrări (R-REV), corecțiile propuse de Hub trec prin `delivery.correct` confirmat de
  proprietar.
- **Profilul local de dezvoltare** (`local_dev_profile`, `owner/dev-profile.mjs`): sesiuni `user_verified = 0`, mereu „proaspete”,
  deschise de orice proces local loopback cu Origin canonic. Comportamentul aprobat rămâne; M12 nu îl folosește ca dovadă a prezenței
  proprietarului (§8).

## 3. Autorizație și limite (de confirmat de proprietar când trimite promptul) (actualizat 2026-10-16)

Autorizat: inspectare, implementare în clonă, build, teste cu date sintetice, artefacte locale de probă, backup verificat, commituri
limitate la M12 pe `v2-milestone-01`. Push-ul și upgrade-ul gestionat (`node v2/scripts/upgrade.mjs --plan` → `--apply`) sunt refuzate
agentului de stratul de permisiuni Claude Code de pe PC (`git push` e interzis în `.claude/settings.json`): agentul pregătește și verifică
un singur script CMD pentru proprietar (preflight doar-citire → upgrade → health → push, cu rezultatul așteptat) și verifică după aceea
prin API-ul GET.

Nu este autorizat: colectare live (`LIVE_COLLECTION_DISABLED` rămâne), outreach/trimitere (`OUTREACH_DISABLED` rămâne), publicare,
campanii, buget, achiziții, facturare API, date sau firme reale, conturi reale, confirmarea cardurilor în locul proprietarului,
aprobarea unei oferte ca „gata de trimis”, ProDelivery, pachete istorice, V1/OpenClaw, automatizări CapCut/OBS noi, redeschiderea §25.

## 4. Cerințe

S-01 Brief: o cerere naturală („pregătește o ofertă pentru un service auto din Cluj care vrea programări online”) devine un brief
structurat (client țintă sintetic, problemă, serviciu, constrângeri), cu proveniența fiecărui câmp (USER_PROVIDED / INFERRED) și
ipotezele scrise. Fără model pentru ce e determinist; dacă un model e necesar, prin legarea existentă model+effort.

S-02 Oportunitate sintetică: organizație și oportunitate în `sales_orgs` / `sales_opportunities` marcate `synthetic = 1`, cu eticheta
vizibilă în UI; niciodată amestecate cu date reale; reluarea nu dublează (idempotență pe brief).

S-03 Cercetare cu proveniență: doar adaptorul de fixture (`fixtureSiteAdapter`) și datele date de proprietar; fiecare afirmație devine
`sales_evidence` cu etichetă, sursă, dată și extras limitat; ce nu are dovadă e UNKNOWN, nu inventat. Colectorul live rămâne refuzat.

S-04 Calificare explicată: `qualify()` cu formula documentată; fiecare punct din scor arată dovada lui; o suprascriere a proprietarului
(`applyOverride`) cere motiv și rămâne în istoric.

S-05 Ofertă în ciornă: `renderProposal` din serviciile catalogului și dovezi; zero placeholdere nerezolvate
(`findUnresolvedPlaceholders`); **prețuri: BLOCAT DE DOVEZI** — catalogul de servicii pornește gol și proprietarul nu a dat încă
prețuri reale; până atunci oferta scrie „De stabilit” și nu inventează sume, ROI sau termene. Starea maximă: `PROPOSAL_DRAFT` →
`READY_FOR_OWNER_REVIEW`; aprobarea (`APPROVED_INTERNAL`) e decizia proprietarului, legată de sha.
*Precizare din cod (2026-10-16):* `PROPOSAL_DRAFT`, `READY_FOR_OWNER_REVIEW` și `APPROVED_INTERNAL` sunt stări ale **oportunității**;
rândurile de propunere au `DRAFT` / `SUPERSEDED` / `APPROVED_INTERNAL` (`sales.mjs:1062–1084`), iar o versiune nouă readuce
oportunitatea în `PROPOSAL_DRAFT`.

S-06 Pachet de predare: un singur dosar local (ca livrările M11): oferta (Markdown + Word verificat în Word), fișa firmei sintetice,
dovezile cu proveniență, calificarea explicată, ciorna de mesaj (DRAFT_ONLY, nesemnată ca trimisă), manifest sha256; fără suprascriere;
o revizie refolosește doar ce are aceleași intrări (ca R-REV din 2026-10-10).
*Precizare din cod (2026-10-16):* tabela existentă `sales_handoffs` și comanda `sales.handoff.create` sunt predarea către Engineering
după acceptarea clientului (M04), nu acest pachet; M12 nu le refolosește sub același nume fără o decizie declarată.

S-07 Lega: „pregătește oferta …”, „arată-mi oferta”, „ce lipsește?” — un plan cu o confirmare pentru partea cu efecte locale; refuz clar
pentru „trimite oferta”, „contactează-i”, „publică” (OUTREACH_DISABLED, fără ocolire); toleranța la greșeli nu corectează spre trimitere.
*Precizare din cod (2026-10-16):* azi uneltele Sales ale Legei sunt doar de citire (`lega-policy.mjs`).

S-08 Separări: starea comercială separată de execuție (un task COMPLETED nu face WON/CONTACTED); CONTACTED și WON rămân doar prin
evenimentele M04 (MANUAL_RECORDED / acceptarea clientului înregistrată de proprietar).

## 4b. Corecții obligatorii (proprietar, 2026-10-10)

C-01 **Idempotență per plan și per operație.** Cheia e derivată din planul confirmat (hash-ul lui) și din operație (tip + parametri
normalizați), nu din text sau din oră. Două reîncercări simultane ale aceleiași operații produc un singur rând și un singur efect; a doua
primește rezultatul primei (sau „în curs”). Test obligatoriu: două apeluri concurente (Promise.all) pe același plan/operație → un rând,
un eveniment, același id; o reluare după întrerupere nu dublează.

C-02 **Prețuri necunoscute = stare explicită.** Un preț lipsă e `UNKNOWN` (cu motivul: catalog neconfigurat), nu 0, nu „aproximativ”, nu
o sumă estimată. Nici termene, ROI sau reduceri inventate. Oferta afișează „De stabilit (neconfigurat)” și nu poate trece de
`READY_FOR_OWNER_REVIEW` cu un preț inventat; un test caută sume și termene în textul generat.

C-03 **Proveniență în trei feluri distincte:** `fixture` (date sintetice ale testului), `afirmație` (ce a spus proprietarul sau o sursă,
cu sursa) și `inferență` (dedusă de Hub sau de un model, cu raționamentul). Se păstrează etichetele M04 (`EVIDENCE_LABELS`), cu felul
datei separat de eticheta de încredere; o inferență nu devine afirmație prin copiere sau rezumare.

C-04 **Inferențele nu primesc punctaj ca dovezi confirmate.** Azi `qualify.mjs` (formula `q-v1`) dă INFERRED 25 de puncte în calitatea
dovezilor. M12 introduce `q-v2` (versiune nouă, conform regulii din `qualify.mjs`: calificările stocate își păstrează `q-v1`): o inferență
apare în explicație și în „ce lipsește”, dar nu urcă scorul ca o dovadă confirmată. Testul compară același set de date sub q-v1 și q-v2.

C-05 **Contractele stărilor.** Fiecare stare nouă sau atinsă are: cine o poate seta (eveniment, nu mutare liberă — ca
`OPPORTUNITY_TRANSITIONS`), precondiții, ce invalidează (o ofertă aprobată legată de sha devine STALE la orice schimbare), și ce nu
implică (un task COMPLETED nu face CONTACTED/WON; o ofertă gata nu e trimisă). Tabelul stărilor intră în raport și în teste.

C-06 **Oprire, revocare, revenire, predare.** „Oprește tot” oprește pașii Sales în curs (fără efect parțial nedeclarat); revocarea
autorității unui plan oprește pașii rămași; fiecare scriere are revenirea ei documentată (fișiere noi, nesuprascrise; rânduri marcate
sintetic, ștergibile doar cu aprobarea proprietarului); handoff-ul final e complet (comenzile exacte, nu „comanda de mai sus”).

C-07 **Funcțiile M04 rămân.** Importul tabelar, identitatea și unificarea, auditul fixture, calificarea, oportunitățile, propunerile,
ciornele de contact, suprimările, follow-up-urile și ecranele `v2/web/src/screens/sales/*` continuă să funcționeze; testele `m04-*`
rămân verzi fără modificări de așteptări (o schimbare de contract cerută explicit se declară, cu testul vechi păstrat ca negativ).

Verificat în cod la 2026-10-16: premisele C-01–C-07 sunt încă adevărate (INFERRED = 25 de puncte în `q-v1`, `qualify.mjs:30`; nu există
încă un câmp „felul datei” separat de etichetă, deci C-03 îl adaugă; „De stabilit (neconfigurat)” e deja textul prețului lipsă).

## 4c. Constatări din cod la 2026-10-16 (de confirmat de proprietar; nu sunt cerințe până atunci)

- **Autoritatea deciziilor Sales.** Toate comenzile `sales.*` folosesc canalele implicite `ui`/`test`; niciuna nu cere sesiunea
  proprietarului. `sales.proposal.approve` cere `displayedSha` în schemă și o aprobare ALWAYS_ASK (`sales-commands.mjs:89–92`,
  `approval-policy.mjs`), dar `approveProposal` verifică sha-ul doar dacă e transmis (`sales.mjs:1080`). Propunere: deciziile
  proprietarului din M12 (aprobarea internă a ofertei, suprascrierea calificării, ștergerea rândurilor sintetice) urmează modelul
  `factory.accept` (§2b): canale declarate, sesiune recitită, ținta afișată exactă, o singură decizie la repetare.
- **Numele pachetului:** vezi precizarea de la S-06 (`sales_handoffs` există deja cu alt sens).

## 5. Teste și dovezi

T-S1 brief → oportunitate sintetică idempotentă (reluarea nu dublează); T-S2 fiecare afirmație din ofertă are dovadă sau e UNKNOWN; o
afirmație fără dovadă introdusă de mână e refuzată; T-S3 colectorul live și trimiterea rămân refuzate pe toate căile (API, comandă, Lega,
plan); T-S4 calificarea e reproductibilă și explicată, suprascrierea cere motiv; T-S5 oferta fără prețuri inventate și fără placeholdere;
T-S6 pachetul: manifest sha256, Word verificat în Word (sau APP_NOT_RUN declarat în mediul fără Office), fără suprascriere, revizie
selectivă; T-S7 datele sintetice nu ajung în rapoarte reale și nu se amestecă cu `sales_*` reale; T-S8 regresia completă (`npm run
test:v2`), cu T25 SKIP motivat; T-S9 idempotență cu reîncercare concurentă pe același plan/operație (C-01); T-S10 același set de date
sub q-v1 și q-v2: inferențele nu urcă scorul (C-04); T-S11 tabelul contractelor de stare respectat (C-05); T-S12 „Oprește tot” și
revocarea în mijlocul fluxului, fără efect parțial nedeclarat (C-06); T-S13 testele `m04-*` neschimbate și verzi (C-07).

T-S8 (actualizat 2026-10-16): o singură rulare completă, coerentă, pe codul final, în clonă sintetică (§2a), cu Studio construit pentru
test și `HUB_V2_STUDIO_DIST` setat explicit spre el (un build Studio vechi face M09-SB-01 să pice cu `UI_STALE`); se păstrează commitul,
arborele, configurația, logul complet, codul de ieșire, totalurile și verificarea proceselor rămase. Fără modificări de timeout-uri,
praguri sau așteptări, fără skip-uri noi, fără relansare până devine verde și fără combinarea rulărilor. Baseline-ul de comparat
(2026-10-16, o singură rulare pe `ee6c93a`, cod = `7074ab5`, clonă sintetică `C:\Users\mihai\hub-gate`): `npm run test:v2` exit 0,
**2311 = 2310 PASS, 0 FAIL, 0 anulări, 1 SKIP (T25)**, 0 procese rămase. Istoric, poarta pe `7074ab5` din 2026-10-16 după-amiaza a fost
2311 = 2306 PASS, 4 FAIL, 0 anulări, 1 SKIP, iar testele afectate au trecut ulterior izolat. V1 (`npm run test`) în aceeași clonă:
552 = 549 PASS, 2 FAIL, 1 SKIP; cele două eșecuri (`conversation-api`, `workflow-refresh-api`) depind de registrul real
`..\PROJECTS.md` din folderul părinte al depozitului și nu pot trece într-o clonă izolată până când nu primesc un registru de fixture
(etapă separată); M12 nu le prezintă ca regresii proprii și nici ca verzi.

Separă CONFIRMAT ÎN COD / RAPORTAT / TESTAT ACUM IZOLAT / VERIFICAT ACUM LIVE / NEVERIFICAT. Măsoară confirmările de produs,
comenzile tehnice ale proprietarului, intervențiile agentului, artefactele refolosite; nu inventa costuri.

## 6. Review, release, refuzuri externe (actualizat 2026-10-16)

Review independent Claude (Opus + ultracode) în sesiune separată, cu cerințele, diff-ul și dovezile; agenții de review sunt doar-citire și
nu pornesc Hub-ul peste date reale. Apoi: reparații în scop, poarta completă (§5, T-S8), commit în clonă și merge în `v2-milestone-01`
doar după poartă, backup verificat. Upgrade-ul gestionat și push-ul le rulează proprietarul printr-un singur script CMD pregătit și
verificat de agent (§3); agentul verifică apoi versiunea live și integritatea prin API-ul GET. Refuzurile (clasificator, Windows,
sandbox, Git, autoritatea Hub) se raportează o dată, cu operația și mesajul exact.

## 7. Definition of Done

Fluxul intern brief → pachet rulează pe date sintetice, cu proveniență și calificare explicată; nimic nu e trimis, publicat sau
cheltuit; prețurile rămân „De stabilit” până la catalogul proprietarului; testele și review-ul au rezultate clare; upgrade și push
efectuate sau marcate precis ca blocate; deciziile proprietarului listate (catalog/prețuri, aprobarea ofertei, orice activare viitoare de
canal — separată, nu în M12).

## 8. Puncte BLOCAT DE DOVEZI / DRAFT / separate (actualizat 2026-10-16)

- Catalogul de servicii și prețurile Ifrim Digital: BLOCAT DE DOVEZI (0 servicii în catalogul live la 2026-10-16; nu există prețuri
  reale în Hub). Rămân necunoscute; nu se completează din presupuneri.
- Sursele reale de cercetare (registre, site-uri): BLOCAT — colectarea live e dezactivată; M12 folosește doar fixture-uri și datele date de
  proprietar.
- Canalul de trimitere: în afara M12 (DRAFT).
- **Precondiție recomandată înainte de folosirea pe proiecte noi:** `factory.reject` fără sesiune (corecție separată a unei decizii
  terminale; `OPEN_ISSUES.md`, prima secțiune). Fluxul Sales poate crea un SPEC_DRAFT în Fabrică, deci această corecție are prioritate
  înaintea oricărui proiect nou trimis prin Fabrică.
- Separate, în afara M12 și fără a redeschide §25: profilul local de dezvoltare (încredere acordată apelanților locali, fără dovada
  prezenței proprietarului; comportamentul aprobat rămâne), problemele media, afirmațiile Word/campanie, simplificarea autorului pasului 0,
  observațiile minore de afișare, cele două teste V1 dependente de registrul real `..\PROJECTS.md` (lista în `OPEN_ISSUES.md`, prima
  secțiune).
