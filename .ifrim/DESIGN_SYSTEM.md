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
