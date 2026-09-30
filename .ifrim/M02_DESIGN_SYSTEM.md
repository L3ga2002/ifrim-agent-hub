# M02 — Design system (JARVIS experience)

Construit peste stack-ul M01: React 18, Vite 8, lucide-react, CSS propriu.

- Fără biblioteci UI noi, fonturi externe sau CDN-uri.
- Fără Three.js: nucleul este un shader WebGL2 propriu, iar fallback-ul e SVG.

Fișiere:
- `v2/web/src/styles/tokens.css` (tokeni);
- `v2/web/src/styles/app.css` (bază);
- `v2/web/src/styles/m02.css` (stratul M02).

## Direcție

- Suprafețe carbon/grafit și lumină rece, controlată.
- **Ambra (`--approval`) nu e rezervată aprobărilor și, alături de roșul pentru eroare/Stop, este una dintre cele două culori calde.** O folosesc aprobările (butonul „Aprobă”, carduri, insigne, starea WAITING_APPROVAL), dar și: cipul „Reconectare” al conexiunii, butoanele de configurare (`.btn.setup`), evidențierea rezultatelor căutării, bannerul simulatorului, avertismentele (`.notice.warn`, `.chip.warn`, toast-uri) și accentul stării LISTENING din nucleu. Ambra înseamnă deci „atenție”, iar aprobarea se recunoaște după text și buton, nu doar după culoare.
- Roșu pentru eroare/Stop, verde pentru verificat.
- Fără neon, scanlines sau „glitch”.
- Culoarea nu e niciodată singurul semnal: fiecare stare are și text sau icon.
- Interfața e în română cu diacritice; termenii tehnici consacrați (BUILD_SAFE, Focus, diff, grant) rămân în engleză.

## Tokeni

| Grup | Tokeni |
|---|---|
| Suprafețe | `--bg #080b10`, `--bg-rail`, `--surface #101722`, `--surface-2`, `--raised #172231`, `--raised-2`, `--line`, `--line-strong` |
| Text | `--text #eaf2fa`, `--text-2 #a8b7c7`, `--text-3 #8797a9` |
| Semantic | `--accent #65d9ff` (+strong/soft/ink), `--approval #e9b56d` (+soft/ink), `--danger #ff8f85`, `--ok #86dcbb`, `--info #b7c6ff` |
| Tipografie | `--font` Segoe UI Variable Text → system-ui; `--font-display` Segoe UI Variable Display; `--mono` Cascadia Code → Consolas; scara `--fs-xs 12` … `--fs-2xl 24`, `--lh 1.5` |
| Spațiere | `--sp-1 4` · `--sp-2 8` · `--sp-3 12` · `--sp-4 16` · `--sp-5 20` · `--sp-6 24` · `--sp-8 32` |
| Raze | `--r-s 4`, `--r 6`, `--r-l 8` |
| Straturi | `--z-rail 10`, `--z-drawer 40`, `--z-overlay 60`, `--z-toast 80` |
| Focus | `--focus-ring: 0 0 0 2px bg, 0 0 0 4px accent` (vizibil pe toate controalele) |
| Motion | `--ease cubic-bezier(.2,.7,.2,1)`, `--d-1 120ms`, `--d-2 200ms`, `--d-3 320ms`, `--d-nav 140ms`; toate devin 0 la `prefers-reduced-motion: reduce` |
| Layout | `--rail-w 84`, `--top-h 56`, `--bottom-h 62` |

**Contrast măsurat** (WCAG, pe `--bg`, `--surface`, `--raised`):

| Element | Raport |
|---|---|
| text | 14.19–17.43 |
| text-2 | 7.84–9.63 |
| text-3 | 5.37–6.60 |
| accent | ≥9.87 |
| approval | ≥8.62 |
| danger | ≥7.27 |
| ok | ≥9.90 |
| banner simulare | 9.83 |

Toate trec AA pentru text normal.

## Componente

| Componentă | Fișier | Rol |
|---|---|---|
| Shell (rail, top bar, bottom nav, drawer „Mai mult”) | `shell/Shell.jsx` | navigare; proiect; conexiune + ultima actualizare; mod; căutare; Stop All mereu vizibil |
| CommandPalette | `shell/Shell.jsx` | Ctrl+K: navigare, proiect, misiune, aprobări, pauză, mod; scurtături afișate în subsol; nu interceptează tastarea în câmpuri |
| MiniAssistant | `shell/Shell.jsx` | Alt+M: stare, microfon, misiune, aprobări; nu este overlay global (nu există suport nativ) |
| ActiveControl | `shell/Shell.jsx` | indicator flotant de execuție (Deschide / Întrerupe); `main.has-indicator` rezervă spațiu dedesubt |
| ErrorBoundary | `components/ErrorBoundary.jsx` | eroarea unui ecran sau a nucleului nu golește aplicația |
| Core3D / CoreSvg | `components/core/Core3D.jsx` | nucleu procedural (vezi mai jos) |
| Layout / Splitter / useViewport | `components/Layout.jsx` | panouri redimensionabile, cu tastatură și pointer |
| Markdown | `components/Markdown.jsx` + `lib/markdown.js` | parser de tokeni, fără HTML |
| Panel, Chip, StatusChip, Checks, Notice, ErrorNotice, Empty, Loading, Dialog | `components/ui.jsx` | panouri, stări, empty/error/loading |
| ApprovalCard | `screens/Approvals.jsx` | acțiune exactă, țintă, versiune, expirare, amprentă; aprobare o singură dată |
| Focus: ConversationList, Thread, RunCard, BottomPanel, Inspector, Composer | `screens/focus/*` | spațiul de lucru |
| CatalogTab | `screens/ecosystem/Catalog.jsx` | fapte separate per capabilitate |
| IsolationPanel | `screens/Integrations.jsx` | limitele reale ale uneltelor modelului + acordul ACL Codex |

## Nucleul (Core3D)

- **Randare**: volum raymarched cu cochilii dintr-o rețea giroidă și un nucleu central, într-un shader WebGL2 propriu.
- **10 stări**, fiecare derivată dintr-un semnal real (`lib/coreState.js`, testat în M02-UI-01):

| Stare | Semnal | Culoare |
|---|---|---|
| IDLE | nimic activ / BUILD_SAFE | accent rece |
| LISTENING | microfon activ (push-to-talk) | rece + ambră |
| TRANSCRIBING | transcriere în curs | rece + indigo |
| WAITING_PROVIDER | execuție fără primul răspuns („nu este progres măsurat”) | albastru stins |
| EXECUTING | execuție care primește stream | accent intens |
| VERIFYING | backup cu restaurare sau task în verificare | verde |
| WAITING_APPROVAL | aprobări în așteptare | ambră |
| PAUSED | mod live cu poarta suspendată | gri |
| ERROR | breaker deschis sau eșecuri în ultimele 30 min | roșu |
| OFFLINE | fluxul SSE întrerupt | gri închis |

- **Calitate adaptivă**: calibrare GPU periodică și sincronă (draw + `readPixels` pe 1 px). Pașii de raymarching și rezoluția se ajustează după costul măsurat. Pixel ratio e limitat.
- **Suspendare**: la tab ascuns, off-screen sau reduced motion (atunci desenează un singur cadru static per stare).
- **Pierderea contextului WebGL**: remontare. După mai mult de 2 pierderi trece pe SVG. Orice eroare de randare trece pe SVG prin ErrorBoundary.
- **Dimensiuni**: compact în Focus și în mini-asistent; nu blochează conversația sau aprobările.

## Motion și sunet

- Tranziții de navigare de 140 ms. Fără animații decorative în liste.
- Puls doar pentru „așteaptă decizia ta” și microfonul activ.
- Fără sunete.

## Responsive

- **Puncte de rupere**: <768 (telefon: bottom nav Conversații / Misiuni / Aprobări / Stop / Mai mult), 768–1023 (tabletă: inspector ca drawer), ≥1024 (desktop).
- **Focus**: conversația nu scade niciodată sub 360 px (`fitLayout`); layoutul se salvează per utilizator (`focus.layout.v2`).
- **Telefon**: ținte touch ≥40 px, compozitor compact, drawer pentru conversații.
