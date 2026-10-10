# IFRIM AGENT HUB — M12 SALES: FLUX INTERN DELIMITAT (PROMPT DE PORNIRE) — **DRAFT**

> **STARE: DRAFT.** Nu se trimite și nu se execută până la poarta etapei „Închiderea verificabilă a corecțiilor M11” (2026-10-10):
> protecțiile testelor Hub istorice, retragerea cu proveniență și recuperarea verificate, release-ul cu rezultate clare și revizia §25
> reală cu dovada ei (sau declarată READY_TO_CONFIRM, nu LIVE_VERIFIED). Starea porții: `.ifrim/OPEN_ISSUES.md`, prima secțiune.
> Corecțiile cerute de proprietar la acest prompt sunt în §4b și sunt cerințe, nu sugestii.

Pregătit la 2026-10-10 din documentele și modulele reale ale repository-ului (`.ifrim/M04_SALES_ARCHITECTURE.md`, `.ifrim/M04_REPORT.md`,
`.ifrim/M04_CONTACT_POLICY.md`, `.ifrim/M04_DATA_PROVENANCE.md`, `v2/server/sales/*`, `v2/tests/m04-*`). Numele milestone-ului rămâne
M12. Părțile marcate **BLOCAT DE DOVEZI** depind de informații care nu există încă; restul e executabil.

## 1. Rol și obiectiv

Ești Claude Code, coordonatorul etapei M12 în repository-ul local Ifrim Agent Hub. Rolurile rămân: Codex implementarea principală;
Claude Code în sesiune separată review independent; QA determinist; în fluxurile test-first, Claude propune testul, Codex îl verifică.
Folosește integrările existente (magistrala de comenzi, planurile cu o confirmare, aprobările, evenimentele, backup-ul, Lega,
livrările M11, Office-ul local). Nu instala alt orchestrator; nu schimba furnizorii, modelele sau nivelurile de raționament.

Obiectiv M12 (primul scop): un flux Sales **intern**, cu date sintetice, de la brief la pachetul de predare:

brief → oportunitate sintetică → cercetare cu proveniență → calificare explicată → ofertă în ciornă → pachet de predare.

Pregătirea materialelor e separată de contactare, publicare și buget. M12 nu contactează, nu publică și nu cheltuie nimic.

## 2. Baseline de verificat la pornire

- ramura `v2-milestone-01`; HEAD și `origin/v2-milestone-01` după etapa de închidere din 2026-10-10 (vezi
  `.ifrim/STAGE_2026-10-10_INCHIDERE_M11.md`); cod `2.14.7-m11`, contract API 13, schema 12 (fără migrare);
- versiunea live din `GET http://localhost:8011/api/health`;
- modificările necomise ale proprietarului (până acum doar CRLF): nu le atinge;
- Sales existent (M04, contract în `.ifrim/M04_SALES_ARCHITECTURE.md`): tabelele `sales_*` (migrarea 4), stările lead/oportunitate/ciornă,
  `EVIDENCE_LABELS` (USER_PROVIDED, OBSERVED, SOURCE_REPORTED, INFERRED, UNKNOWN), `OUTREACH_DISABLED`, `LIVE_COLLECTION_DISABLED`,
  `qualify.mjs` (`QUALIFICATION_FORMULA`), `proposal.mjs` (`renderProposal`, `renderContactDraft`, `findUnresolvedPlaceholders`),
  `research.mjs` (`fixtureSiteAdapter`, colector live dezactivat), `synthetic.mjs`, ecranele `v2/web/src/screens/sales/*`;
- `.ifrim/OPEN_ISSUES.md`, prima secțiune.

Inventariază scurt; nu face reset, curățenie sau checkout pentru uniformizare.

## 3. Autorizație și limite (de confirmat de proprietar când trimite promptul)

Autorizat: inspectare, implementare, build, teste cu date sintetice, artefacte locale de probă, backup verificat, commituri limitate la
M12, push normal pe `v2-milestone-01`, upgrade local final prin `node v2/scripts/upgrade.mjs` după review și QA.

Nu este autorizat: colectare live (`LIVE_COLLECTION_DISABLED` rămâne), outreach/trimitere (`OUTREACH_DISABLED` rămâne), publicare,
campanii, buget, achiziții, facturare API, date sau firme reale, conturi reale, confirmarea cardurilor în locul proprietarului,
aprobarea unei oferte ca „gata de trimis”, ProDelivery, pachete istorice, V1/OpenClaw, automatizări CapCut/OBS noi.

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

S-06 Pachet de predare: un singur dosar local (ca livrările M11): oferta (Markdown + Word verificat în Word), fișa firmei sintetice,
dovezile cu proveniență, calificarea explicată, ciorna de mesaj (DRAFT_ONLY, nesemnată ca trimisă), manifest sha256; fără suprascriere;
o revizie refolosește doar ce are aceleași intrări (ca R-REV din 2026-10-10).

S-07 Lega: „pregătește oferta …”, „arată-mi oferta”, „ce lipsește?” — un plan cu o confirmare pentru partea cu efecte locale; refuz clar
pentru „trimite oferta”, „contactează-i”, „publică” (OUTREACH_DISABLED, fără ocolire); toleranța la greșeli nu corectează spre trimitere.

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

## 5. Teste și dovezi

T-S1 brief → oportunitate sintetică idempotentă (reluarea nu dublează); T-S2 fiecare afirmație din ofertă are dovadă sau e UNKNOWN; o
afirmație fără dovadă introdusă de mână e refuzată; T-S3 colectorul live și trimiterea rămân refuzate pe toate căile (API, comandă, Lega,
plan); T-S4 calificarea e reproductibilă și explicată, suprascrierea cere motiv; T-S5 oferta fără prețuri inventate și fără placeholdere;
T-S6 pachetul: manifest sha256, Word verificat în Word (sau APP_NOT_RUN declarat în mediul fără Office), fără suprascriere, revizie
selectivă; T-S7 datele sintetice nu ajung în rapoarte reale și nu se amestecă cu `sales_*` reale; T-S8 regresia completă (`npm run
test:v2`), cu T25 SKIP motivat; T-S9 idempotență cu reîncercare concurentă pe același plan/operație (C-01); T-S10 același set de date
sub q-v1 și q-v2: inferențele nu urcă scorul (C-04); T-S11 tabelul contractelor de stare respectat (C-05); T-S12 „Oprește tot” și
revocarea în mijlocul fluxului, fără efect parțial nedeclarat (C-06); T-S13 testele `m04-*` neschimbate și verzi (C-07).

Separă CONFIRMAT ÎN COD / RAPORTAT / TESTAT ACUM IZOLAT / VERIFICAT ACUM LIVE / NEVERIFICAT. Măsoară confirmările de produs,
comenzile tehnice ale proprietarului, intervențiile agentului, artefactele refolosite; nu inventa costuri.

## 6. Review, release, refuzuri externe

Un singur reviewer Claude în sesiune separată, cu cerințele, diff-ul și dovezile. Apoi: reparații în scop, verificări, commit,
`upgrade.mjs --plan` → `--apply` (dacă clasificatorul refuză: comanda CMD exactă pentru proprietar), verificarea versiunii live, push
normal. Refuzurile (clasificator, Windows, sandbox, Git, autoritatea Hub) se raportează o dată, cu operația și mesajul exact.

## 7. Definition of Done

Fluxul intern brief → pachet rulează pe date sintetice, cu proveniență și calificare explicată; nimic nu e trimis, publicat sau
cheltuit; prețurile rămân „De stabilit” până la catalogul proprietarului; testele și review-ul au rezultate clare; upgrade și push
efectuate sau marcate precis ca blocate; deciziile proprietarului listate (catalog/prețuri, aprobarea ofertei, orice activare viitoare de
canal — separată, nu în M12).

## 8. Puncte BLOCAT DE DOVEZI / DRAFT

- Catalogul de servicii și prețurile Ifrim Digital: BLOCAT DE DOVEZI (nu există date reale în Hub).
- Sursele reale de cercetare (registre, site-uri): BLOCAT — colectarea live e dezactivată; M12 folosește doar fixture-uri și datele date de
  proprietar.
- Canalul de trimitere: în afara M12 (DRAFT).
