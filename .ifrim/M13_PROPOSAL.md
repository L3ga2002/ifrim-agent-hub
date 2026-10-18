# M13 — Operations / Customer Support / Finance-Admin (PROPUNERE, neîncepută)

Stare: propunere pentru decizia proprietarului (2026-10-19). Nimic implementat. Pornește doar după ce proprietarul aprobă scopul de mai jos.

## Scop (finit)
Trei fluxuri interne, fiecare cu un singur pilot sintetic condus din L3ga (`#/lega`), cu același tipar ca M12: cerere → un card de plan →
confirmarea proprietarului → execuție fără model unde se poate → rezultat local verificabil. Nimic nu pleacă din calculator.

1. **Operations — predarea după o ofertă aprobată.** Din oferta aprobată intern (M12) se pregătește „Dosarul de pornire a proiectului”:
   lista materialelor de cerut clientului (din catalog), checklist-ul de pornire, riscurile și întrebările deschise, misiunea Engineering
   ca SPEC_DRAFT (fără să ruleze). Decizia proprietarului: confirmarea planului; pornirea misiunii rămâne separată.
2. **Customer Support — o cerere de suport.** O cerere sintetică (tastată sau importată) e clasificată (întrebare / defect / cerere nouă),
   primește un răspuns DRAFT_ONLY bazat doar pe surse confirmate (catalog, README-ul și dovezile proiectului livrat) și, pentru un defect,
   o propunere de corecție către Fabrică (SPEC_DRAFT). Decizia proprietarului: aprobarea textului răspunsului; nimic trimis.
3. **Finance-Admin — documentul comercial.** Din oferta aprobată se generează o proformă / un deviz în Word + PDF, cu prețul doar din
   catalogul configurat (altfel „De stabilit”), un registru local al documentelor și termene interne de urmărire. Decizia proprietarului:
   aprobarea documentului pe ID + SHA.

## Criterii de acceptare
- Fiecare flux: un pilot sintetic live, cu cel mult două decizii ale proprietarului, rezultat în `Exporturi\<flux>\…` cu manifest și SHA.
- Aceleași garanții ca M12: date marcate FIXTURE / STATEMENT / INFERENCE, fără cifre inventate, versiuni păstrate, invalidare la schimbarea
  intrărilor, deciziile rezervate doar în sesiunea de proprietar, 0 trimiteri / publicări.
- Teste țintite per flux + o rulare completă la final (schimbă mecanisme comune: planuri, dosare).

## În afara scopului
Trimiterea de e-mail / SMS, e-Factura / ANAF, bănci și plăți, programe de contabilitate, date reale ale clienților, colectare live,
agenți noi plătiți. Fiecare cere o etapă și o autorizare separată.

## Ordinea propusă și decizii pentru proprietar
- Ordine recomandată: Operations (continuă direct M12), apoi Support, apoi Finance-Admin.
- Decizii: (a) aprobi scopul și ordinea; (b) pentru Finance-Admin, configurezi prețul / termenul serviciului din catalog sau pilotul
  rămâne cu „De stabilit”; (c) profilul de dezvoltare pe live rămâne pornit sau treci la Windows Hello pentru deciziile M13.
- Resurse: Claude (Codex după resetarea din 2026-10-22, dacă îl vrei), agenți pe medium, fără costuri suplimentare.
