# Fișa pilotului M11: „Demo Livrare — Detailing (programări)”

Starea: **pregătită, neaprobată**. Nimic de aici nu a rulat pe Hub-ul live.

## O singură decizie: „Aprob pilotul M11”

Aprobarea acoperă exact pașii de mai jos, în ordinea lor:

1. **Upgrade-ul Hub-ului la `2.14.0-m11`** (voce + M11): `node v2/scripts/upgrade.mjs --apply`.
   - Migrarea 12 `m11-deliveries` adaugă 4 tabele goale. Nu schimbă nimic existent.
   - Upgrade-ul face backup-ul verificat al bazei înainte de migrare. Fără backup reușit, Hub-ul nu pornește.
   - Hub-ul rămâne în BUILD_SAFE. Poarta rămâne suspendată până o redeschizi tu din cockpit, cu Windows Hello.
2. **Proiectul de test.** Comanda: `node v2/scripts/create-factory-fixture.mjs booking-demo`.
   - Folderul: `C:\Users\mihai\OneDrive\Desktop\Ifrim Digital Proiecte\ifrim-delivery-demo-detailing`.
   - Portul preview-ului: 4620. Date doar sintetice, cu bannerul „Date sintetice · demo local”.
   - Proiectul se înregistrează în Hub ca proiect de test.
3. **Cererea ta**, spusă sau tastată în cockpit:
   > „Lega, pregătește demo-ul de detailing pentru prezentare. Verifică programările pe mobil, repară problema convenită, fă un clip și pregătește-mi rezumatul comercial. Nu publica nimic.”

   Hub-ul îți arată **un singur card**. Îl confirmi o dată.

## Ce face Hub-ul după confirmare (fără altă întrebare)

**Engineering** (problema convenită: „Pe telefon, intervalele ocupate apar libere”):
- Modele: writer Codex `gpt-6.1-sol` · medium și reviewer Claude `sonnet` · medium (doar citire). Sunt fixate în card și verificate înainte de fiecare pornire. Nu există fallback.
- Testul de acceptanță există deja în fixture (AC-1) și e protejat. Writerul nu îl poate modifica.
- Sunt incluse cel mult 2 cicluri de remediere. Urmează QA, preview-ul local și verificarea în browser pe desktop (1280×800) și la lățimea unui telefon (390 px, Chromium).

**Livrarea** (fără model, după ce software-ul e gata):
- Două capturi, fiecare de cel mult 60 s, doar din `http://127.0.0.1:4620`, într-un browser izolat:
  - desktop, 1280×720;
  - lățimea unui telefon, 390×844.
- Clipul 16:9 și varianta verticală 9:16, fiecare cu QA automat.
- Rezumatul comercial v1, în Markdown și HTML:
  - problema;
  - ce demonstrăm;
  - cum funcționează;
  - ce beneficii putem afirma;
  - ce nu putem afirma;
  - întrebări pentru client;
  - următorul pas.
- Exportul local în `Videos\Ifrim Studio\Exporturi\demo-programari-…-<data>`. Nu suprascrie nimic.

## Limite

- **Buget AI:** cel mult 6 ture de model (1 writer, 1 review, plus cel mult 2 cicluri de remediere). Doar din abonamentele incluse.
- **Timp:**
  - misiunea durează cel mult 60 de minute;
  - livrarea, cel mult 30 de minute după ce software-ul e gata.
- **Ce nu face:**
  - publicare, upload, mesaje;
  - commit, push sau deploy;
  - acceptarea software-ului, aprobarea creativă, drepturile, aprobarea rezumatului;
  - date reale, ProDelivery sau alte proiecte;
  - OBS, ecranul tău, CapCut;
  - prețuri, ROI sau termene inventate;
  - niciun model după ce software-ul e gata.

## Deciziile care rămân ale tale (în camera de livrare)

- „Accept local” pentru software.
- Aprobarea creativă a clipului 16:9 și a variantei verticale.
- Rezumatul „gata de prezentare”.

## După prima livrare: cele două probe de revizie

Le spui tu, pe rând. Fiecare are rezultatul așteptat scris dedesubt.

1. „Site-ul e bine, dar clipul e prea tehnic. După secunda 10 arată direct programarea.”
   - Rezultatul așteptat: un card mic, o confirmare.
   - Se refac doar montajul, randarea, varianta verticală, QA și secțiunea video a rezumatului.
   - Fără Codex, fără test nou, fără model.
2. „Butonul de programare trebuie să facă altceva.”
   - Rezultatul așteptat: diferența explicată (cerința se schimbă, testele, preview-ul, capturile, clipul și afirmațiile devin învechite).
   - Un plan de engineering propus. Nimic nu pornește până nu confirmi.

## Proba vocală (separată, după upgrade)

Pașii sunt în Lega → Configurare → Voce → „Pornește diagnosticul (1 min)”.

- **Pozitive:**
  - o propoziție normală;
  - „Da, execută planul”;
  - „Pauză”;
  - „Continuă”;
  - „Oprește tot”.
- **Negative:**
  - un clip redat din difuzor;
  - vocea Lega;
  - „Nu executa”;
  - „Ce se întâmplă dacă spun Oprește tot?”;
  - „Continuă?”.

Raportul împarte rezultatul pe etape: AUDIO_CAPTURED, VAD_OK, SPEAKER_MATCH, TRANSCRIPT_FINAL, INTENT, AUTHORIZED_EFFECT.
