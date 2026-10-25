# Design system V2 — Ifrim Agent Hub

Cod: `v2/web/src/styles/tokens.css`, `v2/web/src/styles/app.css`, `v2/web/src/components/*`. Respectă regulile globale din `.ifrim-system/DESIGN_SYSTEM.md` (raze ≤ 8 px, fără carduri în carduri, fără letter-spacing negativ, iconițe lucide) și direcția V2 cerută: carbon/grafit, lumină rece, adâncime discretă.

## Tokens

| Rol | Token | Valoare |
|---|---|---|
| Fundal | `--bg` | #080B10 |
| Rail | `--bg-rail` | #0A0F15 |
| Suprafață | `--surface` / `--surface-2` | #101722 / #131C29 |
| Suprafață ridicată | `--raised` / `--raised-2` | #172231 / #1D2A3B |
| Text | `--text` / `--text-2` / `--text-3` | #EAF2FA / #A8B7C7 / #8797A9 (≈6:1 pe suprafață) |
| Accent | `--accent` | #65D9FF |
| Aprobare/avertisment | `--approval` | #E9B56D |
| Pericol | `--danger` | #FF8F85 |
| OK | `--ok` | #86DCBB |
| Linii | `--line` / `--line-strong` | alb-gri 13% / 26% |

Tipografie: Segoe UI Variable (Text/Display) cu fallback sistem; monospace (Cascadia) doar pentru ID-uri, hash-uri, cod și diff-uri, niciodată pentru paragrafe. Dimensiuni 12–24 px; nicio etichetă sub 12 px. Spațiere 4/8/12/16/20/24/32. Raze 4/6/8. Mișcare 120/200/320 ms, `cubic-bezier(.2,.7,.2,1)`, anulată de `prefers-reduced-motion`.

## Componente

Butoane (primary accent, approve amber, danger contur, ghost; nu toate pill), chip de stare (iconiță + text, culoarea nu este singurul semnal), panou cu antet, listă, tabel (carduri pe mobil), segmented control, tabs, câmpuri, dialog cu focus trap, command palette (Ctrl+K), toasts grupate, sertar, indicator de control activ, notice, skeleton, diff.

## Nucleul

Original: inele segmentate luminoase în jurul unui nucleu moale, cu câmp de flux din zgomot (fragment shader WebGL2). Stări legate de date reale: idle, listening, transcribing, processing (backup în curs), executing (run-uri active), verifying (taskuri VERIFYING), approval (aprobări în așteptare), error (eșecuri recente sau breaker deschis; refuzurile porții nu contează). Motivul stării este afișat sub nucleu. Rezoluție plafonată (≤360 px, DPR ≤1,5), ~30 fps, oprit în taburi ascunse sau în afara ecranului. Fallback: Canvas2D, apoi SVG static (și opțiunea „Nucleu animat” off). Fără scanlines, fără gradient mov, fără glow excesiv.

## Layout

- ≥1281 px: Control Room pe 3 coloane (nucleu + blocaje | misiune + graf + execuții | aprobări + sănătate + briefing).
- 1025–1280: 2 coloane, coloana dreaptă devine rând.
- ≤1024: o coloană; panoul contextual Focus devine suprapus.
- ≤767: bara de jos (Control, Conversații, Misiuni, Aprobări, Mai mult); ierarhie refăcută, nu desktop micșorat.
- ≤400: etichete scurtate în bara de sus.

Verificat pe capturi reale la 360, 390, 768, 1024, 1440 și 1920 px, fără overflow orizontal.

## Graful de agenți

Arată taskurile reale ale misiunii și doar dependențele `depends_on`; fiecare nod este un buton accesibil de la tastatură care deschide taskul. Nu există „conexiuni neuronale” sau activitate inventată.

## M16 — Mod Comandă (`#/comanda`, `styles/m16.css`)

Vederea L3ga pentru televizor / al doilea monitor. Folosește aceleași tokenuri și aceleași culori de stare (chihlimbar = decizia ta, roșu =
eroare, verde = gata), mereu cu un cuvânt sau o iconiță. Excepții documentate, valabile DOAR sub `.command`:

- **Scara textului.** Fontul rădăcinii e `clamp(16px, calc(100vh * 22 / 1080), 60px)` și totul în `em`: exact 22 px la 1080p, 44 px la
  2160p; niciun text sub 1 em la 1080p (verificat pe capturi reale: 0 texte sub 22 px la 1920×1080 și 3840×2160). Sub 1080 px înălțime textul
  scade proporțional (≈ 18 px la 900, 16 px minim), fără scroll orizontal (verificat la 1440×900, 1280×800, 390×844). Etichetele uppercase
  au 0,04 em spațiere (niciodată negativă).
- **Figura.** Nucleul / fața L3ga e mare: o cutie pătrată `min(46vh, 100%)` în repaus (32 vh în rezumat), peste plafonul din L3ga
  (280–420 px). DPR rămâne plafonat la 1,5 (1,25 compact), deci canvasul are ~497 px la 1080p. Măsurat pe PC (i5-11400H, RTX 3050 / Intel
  UHD, Chromium cu GPU ANGLE D3D11, CPU 59–99 % ocupat de alte procese): 60 FPS cu o fereastră și cu două ferestre (principală + afișaj);
  0 cadre cu documentul ascuns; la „mișcare redusă” un cadru static redesenat la 500 ms. Sursa: `m16-evidence\shots\perf\perf.json`.
- **Culorile departamentelor.** 12 culori `--dept-1…12`, niciuna chihlimbar / roșu / verde, contrast ≥ 3:1 pe fundalurile Modului Comandă (testul păstrează și fundalurile B / C);
  codul de două litere și numele rămân semnalul principal (culoarea nu e singurul semnal).
- **Decor.** Orbitele și punctele din harta companiei sunt marcate „decor, fără semnificație”, se pot opri și sunt statice la mișcare redusă
  sau cu fereastra ascunsă. Liniile reale (L3ga → departament) sunt pline pentru departamentele active și întrerupte pentru cele planificate.
- **Harta companiei (≥ 1100 px).** Elipsă pe toată lățimea scenei (rx 38 %, ry 40 %), ordinea din configurație; fiecare departament e un
  card opac (cod, contoare, nume, stare), chenar plin = activ, întrerupt = planificat. Lista „Departamente” din dreapta e ascunsă doar în
  această vedere (harta are aceleași date). Cardurile au textul paginii (22 px la 1080p) și se micșorează cu harta pe ecrane 4:3 / 5:4
  sau înalte (`min(1em, 100cqw / 66, 100cqh / 26)`, ~16 px la 1100 px lățime). Contoarele au legendă vizibilă (lucrări · blocaje ·
  decizii) în bara hărții și sub lista departamentelor. Testul browser verifică la 1920, 1440, 1280, 3840, 1100×1080, 1280×1024 și
  1600×1200 că niciun card nu atinge alt card, nucleul L3ga sau marginea hărții (sonda `m16-evidence\shots\map-sizes.mjs`: 16 dimensiuni curate);
  sub 1100 px rămâne grila pe două coloane.
- **Variantă.** Se livrează doar A „Carbon și cyan” (continuarea stilului actual), aleasă de proprietar pe 2026-10-25 la 08:31 ora
  României (AC-15). B „Noapte albastră” și C „Grilă tehnică” au fost doar capturi de comparație (`m16-evidence\shots\r2`); CSS-ul și
  selectorul lor au fost scoase. `.command` poartă fix `data-variant="A"`, iar aspectul nu se mai sincronizează între ferestre.
- **Fereastra secundară** (`#/comanda?ecran=tv`): aceeași compoziție, fără butoane de acțiune; nicio relaxare globală a designului pentru
  restul Hub-ului.
