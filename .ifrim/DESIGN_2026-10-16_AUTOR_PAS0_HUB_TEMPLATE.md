# Design (etapă separată, NEIMPLEMENTAT): sursa „Hub-template” pentru contractele exacte susținute de schelet

Data: 2026-10-16. Stare: propunere pentru o etapă viitoare. În etapa curentă fluxul pasului 0 rămâne cel actual (autor Claude doar
citire → probă dublă → review Codex → protecție → baseline). Nu s-a consumat nicio rulare cu modele pentru acest design.

## 1. Ce s-a constatat (consemnare corectă)
- La cardul §25 (misiunea `mis_mva09tjh_7692421b52`, 2026-10-15) autorul pasului 0 a reutilizat scheletul Hub fără verificări proprii:
  candidatul `9966a943…` are 150 de linii fără comentarii și rânduri goale, 0 adăugate, 0 eliminate față de schelet. La fel în repetiția
  unică (`92e3b040…`).
- Rezultatele validează scheletul, dovada (PROVEN în două rulări), protecția testului, review-ul Codex (PASS, 0 constatări) și calibrarea
  deterministă (aplicația corectă trece, 41/41 surse defecte respinse prin aserțiuni, probele T-001/T-002 respinse). Ele NU dovedesc o
  contribuție a autorului; independența vine din review și din calibrare.
- Nu impunem aserțiuni artificiale doar ca fișierul să difere de schelet: un test identic cu un schelet calibrat este un rezultat valid.

## 2. De ce predicatul actual nu ajunge
`datasetSkeletonPlan(spec)` (`v2/server/factory/dataset.mjs:174`) decide că un schelet POATE fi generat: spec cu `dataset`, `workType`
FEATURE, ajutorul `json-exposure` și criterii de test de tipurile așteptate (`datasetCriteriaProblem`). El se uită la TIPURILE criteriilor
(`kind`), nu demonstrează că cerințele misiunii sunt exact cele pe care scheletul le verifică: un text de criteriu schimbat, un criteriu
în plus sau o regulă nouă cu același `kind` trec predicatul. Deci nu poate fi temei pentru a elimina autorul.

## 3. Propunerea
1. **Sursă explicită** `authoring.source = "hub-template"` (alături de `author`), aleasă de Hub la propunerea planului NUMAI pentru un
   contract recunoscut exact. Registrul Hub versionat de contracte susținute (cod, nu configurare), de exemplu `hide-public-field/1`:
   - identitatea datasetului (`booking-demo` v1 + sha256 al datelor martor fixate),
   - identitatea generatorului de schelet (id, versiune, sha256 al ieșirii pentru parametrii daților),
   - parametrii contractului (câmpul: cheie, etichetă, valoare de test; lista publică; parametrii anonimi),
   - **amprentele canonice ale cerințelor** (funcția `criterionFingerprint` din 2.14.17, pe textul criteriului, metodă, `kind`, `guard`;
     `testRef` exclus aici pentru că e generat per cerere și înlocuit de identitatea scheletului) pentru FIECARE criteriu de test.
2. **Recunoașterea** (deterministă, fără model): criteriile de test ale specificației aprobate au exact amprentele contractului (aceeași
   mulțime, niciuna în plus sau în minus, după substituirea parametrilor), datasetul are identitatea fixată, iar scheletul generat are sha-ul
   așteptat. Orice diferență (cerință nouă, text schimbat, criteriu în plus, dataset sau generator diferit) → traseul cu autor de azi,
   cu scheletul ca exemplu.
3. **Proveniență corectă**: cardul planului (hash-uit) spune „Testul de acceptanță: scheletul Hub <contract>@<versiune> (fără autor)”;
   `protected_json.authoring` înregistrează `source`, contractul, identitățile datasetului, generatorului și scheletului și amprentele
   cerințelor; manifestul pachetului (`acceptanceTest.provenance = "hub_template"`), camera de livrare și Fabrica arată sursa; dovezile
   (evidence, evenimente) o păstrează.
4. **Păstrate neschimbate**: review-ul independent Codex al testului (brief-ul spune sursa), cele două probe (PROVEN de două ori),
   protecția testului înaintea writer-ului, baseline-ul și calibrarea `s25-calibrate`, care devine poarta de release a generatorului
   (orice versiune nouă a generatorului se calibrează înainte de a fi recunoscută).
5. **Erorile scheletului recunoscut opresc fluxul** la pasul 0 (tip `hub_template`: lint, probă INCONCLUSIVE, review CHANGES_REQUESTED,
   baseline anormal) și se raportează proprietarului; nu se trece automat la autor, ca să nu fie mascat un defect al generatorului.
6. **Cerințele noi sau schimbate** merg pe traseul cu autor (fluxul actual), indiferent de `kind`.

## 4. Teste de acceptanță pentru etapa viitoare
- recunoaștere exactă (renumerotare: recunoscut; text schimbat / criteriu în plus / dataset diferit: autor);
- sursa în plan și în hash; proveniența în `protected_json`, manifest, interfață;
- review, cele două probe, protecția și baseline-ul rulează identic pentru `hub-template`;
- o eroare a scheletului recunoscut oprește pasul 0 și e raportată, fără autor;
- calibrarea generatorului ca poartă (o versiune necalibrată nu e recunoscută).

## 5. Câștig și riscuri
- Câștig: o rulare Claude de autor mai puțin pe plan recunoscut (live 92 s, istoric 30–58 min și eșecuri de transport), fără pierdere de
  independență (review + calibrare rămân).
- Riscuri: recunoaștere falsă (atenuată de amprentele exacte), deriva generatorului (atenuată de sha + calibrare), un contract prea
  îngust (orice abatere merge oricum la autor).
