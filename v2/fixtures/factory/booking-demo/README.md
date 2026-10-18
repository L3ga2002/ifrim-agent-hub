# Demo Livrare — Detailing (programări)

Mini-aplicație de test (fixture Software Factory): un atelier fictiv de detailing primește programări online. Clientul alege
serviciul, ziua (azi, mâine sau poimâine) și un interval liber din grilă, apoi confirmă cu un nume și un vehicul.

## Ce este și ce nu este

- **Date sintetice.** Serviciile, numele („Client Demo A/B/C”) și vehiculul („Autoturism test”) sunt inventate. Banda de sus
  a paginii spune mereu „Date sintetice · demo local”.
- **Fără rețea.** Serverul ascultă doar pe `127.0.0.1` și nu apelează niciun serviciu extern. Fără dependențe npm.
- **Fără prețuri și fără date de contact.** Un serviciu are doar nume și durată; o programare are doar nume și vehicul.
  Nu introduce date reale.
- Atelierul are un singur post de lucru: o programare ocupă intervalul pentru toate serviciile.

## Problema convenită

**Pe telefon, intervalele ocupate apar libere.** La lățimea unui telefon (390 px), un interval deja ocupat arată ca unul
liber și poate fi ales; la confirmare, serverul refuză cu „Intervalul tocmai a fost ocupat”. Pe desktop afișarea este
corectă: intervalul ocupat este gri, scrie „Ocupat” și nu poate fi ales.

Testul independent `test/acceptance.test.mjs` descrie comportamentul corect și eșuează înainte de fix doar din acest motiv
(AC-1). AC-2 (desktop) și AC-3 (API) trec și înainte, și după.

## Rulare

- Teste: `node --test` (unitare + acceptanță; integrare reală: server local pe un port liber + bază de test în `data/`)
- Doar acceptanța: `node --test test/acceptance.test.mjs`
- Preview: `node server.js` → http://127.0.0.1:4620/ (portul din `config.json`)
- Cerință: Node.js 22.13 sau mai nou (`node:sqlite`).

## Date și resetare

- Programările se păstrează în `data/bookings.db` (folder ignorat de git și de Software Factory).
- La fiecare pornire și la fiecare afișare a grilei, serverul se asigură că fiecare dintre cele trei zile afișate are cele
  trei programări sintetice (10:00, 11:30, 15:00), fără dubluri — și după miezul nopții.
- Programările făcute la verificări se adună în `data/`. Resetare: oprește serverul și șterge folderul `data/` (acțiune a
  proprietarului); la următoarea pornire se reface doar setul sintetic.

## Structură

- `server.js` — pornește serverul local pe portul din `config.json`
- `src/server-app.js` — fișierele statice permise și API-ul (`/api/services`, `/api/slots`, `/api/bookings`)
- `src/slots.js` — logica pură a intervalelor (grilă, suprapuneri, stări)
- `src/catalog.js` — serviciile și programările sintetice
- `public/` — pagina (`index.html`, `styles.css`, `js/app.mjs`, `js/slots-view.mjs`)
- `test/` — `acceptance.test.mjs` (protejat) și `unit.test.mjs`
