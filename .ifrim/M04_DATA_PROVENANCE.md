# M04 — Proveniența datelor în Vânzări

Versiune: `2.5.0-m04` · 2026-10-01 · Cod: `v2/server/sales/`

Toate datele de mai jos sunt **sintetice** în M04: fișiere generate, domenii `.test` și site-uri fixture locale. Niciun fișier, nicio firmă și niciun site real nu au fost citite.

## 1. Regula

Fiecare valoare din fișa unei firme are o dovadă (`sales_evidence`). Dovada spune:

- de unde vine valoarea;
- cum a fost obținută;
- când a fost obținută;
- cât de sigură este.

O valoare fără dovadă nu poate apărea într-o propunere sau într-o ciornă ca fapt. Poate apărea doar ca întrebare către client.

## 2. Etichete

| Etichetă | Sens | Exemplu |
|---|---|---|
| `USER_PROVIDED` | Venită din fișierul importat de tine sau introdusă manual de tine | Coloana „CUI” din `firme.csv`, rândul 12 |
| `OBSERVED` | Văzută direct în HTML-ul static al unei pagini | `<meta name="viewport">` lipsește |
| `SOURCE_REPORTED` | Declarată de o sursă externă numită | Rezervată; nicio sursă externă nu e activă în M04 |
| `INFERRED` | Dedusă printr-o euristică | „Pagina pare un articol, nu site-ul firmei” |
| `UNKNOWN` | Nu se știe | Cifra de afaceri lipsește |

`UNKNOWN` nu înseamnă 0 sau fals:

- la calificare, o componentă necunoscută are scorul `null`, nu 0;
- o dată financiară lipsă nu exclude firma.

## 3. Tipuri de sursă

| `source_kind` | Ce înseamnă | Referința păstrată |
|---|---|---|
| `file` | Fișier importat (CSV/XLSX) | Numele fișierului, rândul, sha256-ul fișierului (în lot) |
| `fixture` | Site local sintetic din `v2/fixtures/sales/sites/` | URL-ul `.test` cu mențiunea „fixture sintetic” |
| `manual` | Introdus de tine în fișă | Actorul și motivul |
| `url` | Pagină web reală | **Dezactivat în M04** (`LIVE_COLLECTION_DISABLED`) |

### Actualitatea dovezilor (`freshness`)

Nimic nu se șterge și nu se rescrie. Fiecare dovadă primește o stare la citire:

| Stare | Când | Folosită la calificare, propuneri și hand-off |
|---|---|---|
| `CURRENT` | Citirea cea mai nouă din sursa ei, în termen | Da |
| `NEEDS_RECHECK` | A trecut termenul de reverificare: audit 90 de zile; import sau introducere manuală 365 de zile. Sau cifra financiară e din urmă cu peste 2 ani ori fără perioadă | Da, marcată „necesită reverificare” |
| `SUPERSEDED` | Există o citire mai nouă a aceleiași afirmații din aceeași sursă | Nu (rămâne în istoric) |
| `ROLLED_BACK` | Lotul de import din care vine a fost anulat | Nu (rămâne în istoric) |

Două citiri actuale ale aceleiași afirmații și perioade, din surse diferite, cu valori diferite:

- rămân amândouă;
- fiecare arată spre cealaltă (`conflictsWith`);
- fișa firmei arată „Ultima verificare” și numărul de contradicții.

## 4. Fișierele importate

- Fișierul original se păstrează în `<dataDir>/sales-imports/<sha256>.<ext>`. Al doilea upload al aceluiași conținut deschide același lot și nu creează o copie.
- Fiecare rând are o înregistrare în `sales_import_rows`:
  - valorile brute;
  - valorile normalizate;
  - avertismentele;
  - candidații de potrivire;
  - decizia luată.
- Rollback-ul arhivează firmele create de lot și nu le șterge. Firmele editate după import rămân și apar ca **conflicte**.
  - Lucrează pe **id-ul lotului** (`batch_id` pe fiecare dovadă), nu pe numele fișierului. Două fișiere cu același nume nu se încurcă.
  - Contactele aduse de lot pe firme existente devin `ROLLED_BACK`.
  - Dovezile lotului nu mai sunt folosite.
  - Rândurile care așteptau o decizie se închid (`SKIPPED`).
  - Motivul rollback-ului se păstrează.
- O decizie luată mai târziu pe un rând ambiguu:
  - aplică lista DO_NOT_CONTACT de atunci;
  - nu poate crea a doua firmă cu un CUI valid deja folosit (se alege „match”).
- Fișierele `.xlsm` și `.xls` sunt refuzate. La XLSX:
  - formulele nu sunt evaluate; se citește doar valoarea salvată și se raportează un avertisment;
  - un telefon salvat ca număr (fără 0 inițial) primește un avertisment;
  - diacriticele și codificarea CP1250 sunt suportate.
- La exportul CSV, celulele care încep cu `=`, `+`, `-`, `@`, tab sau CR primesc un apostrof în față (neutralizarea formulelor).

## 5. Identitate și combinări

- Codul fiscal (CUI) se verifică cu cifra de control (cheia `753217532`). Un CUI valid identic înseamnă aceeași firmă.
- Două firme cu CUI-uri valide **diferite** nu se pot combina niciodată.
- Același nume în orașe diferite nu e duplicat (filiale, omonime).
- Când identitatea e ambiguă, rândul ajunge în coada de revizuire `NEEDS_REVIEW` și nu se combină automat. Exemple:
  - același nume și același oraș;
  - același domeniu sub alt nume;
  - un nume foarte asemănător.
- Fiecare candidat de potrivire arată **motivele** potrivirii.
- Domeniile de identitate se separă de profilurile sociale, marketplace-uri și site-urile de știri. Un profil de Facebook nu e domeniul firmei.
- O combinare:
  - păstrează celălalt nume ca alias;
  - se înregistrează în `sales_merges`;
  - poate fi anulată.

## 6. Auditul de site

- În M04 rulează **doar pe fixture-uri locale** și doar pentru domenii `.test`.
- Orice cerere de colectare live e refuzată cu `LIVE_COLLECTION_DISABLED`.
- Colectorul (pregătit pentru mai târziu) refuză:
  - alte scheme decât http/https;
  - credențialele în URL;
  - `localhost`, `*.local`, IP-urile private, loopback și link-local (inclusiv `169.254.169.254`);
  - host-urile care se rezolvă în adrese private.
- Auditul citește HTML-ul static, fără să execute nimic.
- Fiecare verificare are:
  - selectorul;
  - un fragment de cel mult 200 de caractere, redactat;
  - metoda `static-html`;
  - eticheta `OBSERVED` sau `INFERRED`.
- Textul paginii e dată neîncrezătoare. Instrucțiunile din pagină (prompt injection) nu schimbă nimic; apar doar ca notă în `limits`.
- Limitele auditului se salvează împreună cu el: o singură pagină, fără JavaScript, fără viteză sau contrast.

## 7. Calificarea

- Formula `q-v1`, cu ponderile serviceFit 0,5 · evidence 0,3 · completeness 0,2. E deterministă și explicabilă: fiecare componentă își arată valorile de intrare.
- Componentele necunoscute rămân `null` și sunt listate în `unknowns`.
- O suprascriere manuală cere un motiv (minimum 5 caractere) și păstrează istoricul. Calificarea veche nu se șterge.

## 8. Ce ajunge în propuneri și ciorne

- **Prețul:**
  - doar din catalog și doar când e `CONFIGURED`, cu o sumă;
  - altfel apare „De stabilit”;
  - nu se inventează niciodată un preț sau un termen.
- **Observațiile din audit:** doar cele `OBSERVED` cu dovadă. Cele `INFERRED` devin întrebări.
- **Ciornele:** fără audit, nu pretind „am analizat site-ul”. Lista `claimsToVerify` arată ce trebuie confirmat înainte de trimitere.

## 9. Ce citește Lega

- Lega primește doar rezumate: numărători, stări și nume de firme.
- Nu primește adrese de e-mail, telefoane sau textul ciornelor în clar.
- Din voce se poate doar marca o firmă `DO_NOT_CONTACT`. Restul acțiunilor de vânzări nu sunt disponibile din voce.
