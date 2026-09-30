# M02 — Revizie vizuală (§25, §28)

Data: 2026-09-30. Capturile sunt reale și provin din aplicația care rulează, prin panoul de browser Claude (Chromium), la viewport emulat. Nu sunt mockupuri.

- Hub real: `http://127.0.0.1:8011/`, `2.2.0-m02`, BUILD_SAFE.
- Simulator: `http://127.0.0.1:8012/`, cu bannerul permanent „SIMULARE — FĂRĂ MODELE REALE”; conține doar date sintetice și fixture-uri.

Capturile se află în `.ifrim/M02_EVIDENCE/`. Nu conțin secrete sau date de client. Capturile Hub-ului real arată titluri de conversații interne ale Hub-ului, tipul de plan și căi locale.

## Dovezile minime §28

| Cerință §28 | Captură | Stare |
|---|---|---|
| Control Room fără execuții reale | `m02-06-control-room-real-1440.jpg` („În așteptare”, „Nicio execuție activă”, BUILD_SAFE) | PASS_LOCAL |
| Control Room cu scenariu simulat etichetat | `m02-01-control-room-sim-1440.jpg` (WAITING_APPROVAL, banner), `m02-09-control-room-sim-390.jpg` | PASS_SIMULATED |
| Focus cu conversație și diff | `m02-03-focus-diff-sim-1440.jpg` (thread, evenimente tehnice pliate, inspector Diff pe proiectul demo git) | PASS_SIMULATED |
| Misiune cu blocaj/aprobare | `m02-02-mission-graph-sim-1440.jpg` (graf 4 taskuri, 1/4 finalizate, 1 blocat „Cotă simulată”), `m02-04-approval-sim-1440.jpg` (aprobare exactă `npm test`) | PASS_SIMULATED |
| Catalog OpenAI/Anthropic cu statusuri distincte | `m02-07-catalog-real-1440.jpg`; date reale: 324 înregistrări → 49 utilizabile acum, 101 necesită setup, 75 asistate, 50 risc de cost/blocat | PASS_LOCAL |
| Voce configurată sau NEEDS_SETUP real | `m02-15-voice-needs-setup-real.jpg`: motorul browserului trimite audio online → în mod local strict NEEDS_SETUP, cu pași | PASS_LOCAL (NEEDS_SETUP real) |
| Browser workspace în starea verificată | `m02-05-tools-browser-real-1440.jpg`: Playwright neinstalat → NEEDS_INSTALL_APPROVAL, cu cererea exactă | PASS_LOCAL (fără E2E: browserul Playwright nu a rulat) |
| Variantă mobilă | `m02-09`, `m02-11`, `m02-16` (390×844) | PASS_LOCAL |
| Fallback fără WebGL | `m02-13-core-svg-after-3-context-losses.jpg` (pierderile 1 și 2 recuperate în WebGL, a 3-a → SVG), `m02-14-core-fault-boundary-svg.jpg` (eroare injectată în nucleu → SVG, pagina intactă) | PASS_LOCAL |
| Reduced motion | ramura `prefers-reduced-motion` a rulat fără eroare, prin suprascrierea `matchMedia` înainte de remontare; tokenii de motion devin 0 în CSS | PARȚIAL: oprirea animației nu poate fi măsurată aici (panoul e ascuns, rAF suspendat); emularea setării OS = NOT_RUN |
| Izolare (suplimentar) | `m02-08-isolation-real.jpg` | PASS_LOCAL |

## Probleme găsite la inspecție și corectate

| # | Găsit | Corecție | Dovadă |
|---|---|---|---|
| V1 | Top bar suprapus la 800 px | reguli de colaps în `m02.css` | overflow 0 |
| V2 | Indicatorul de execuție peste top bar/banner | mutat jos-stânga | captura 01 |
| V3 | Nucleul prea întunecat și mic în cadru | cameră și luminozitate ajustate în shader | 01, 06 |
| V4 | Calitatea adaptivă măsura timpul CPU de submit, nu costul GPU | calibrare periodică cu `readPixels` pe 1 px | `data-gpu-ms` |
| V5 | Nucleu deformat pe mobil (canvas blocat la 300×150) | comparare lățime+înălțime, `ResizeObserver`, primul cadru imediat | 09 |
| V6 | Catalog: „utilizabil” includea rânduri neautentificate | regula cere `authenticated ≠ nu` | 07 (65 → 49) |
| V7 | Ecranul Sistem: 109 px overflow orizontal (`.sr-only` scăpa în `.main`) | `position: relative` pe containerele de scroll | overflow 0 |
| V8 | Compozitor prea înalt pe telefon | compactat | 12 |
| V9 | Pe 390 px, indicatorul flotant acoperea finalul paginii | `main.has-indicator` rezervă 76 px | 10 (înainte) → 11 (după) |
| V10 | O eroare aruncată de nucleu golea toată aplicația (inclusiv Stop All) | `ErrorBoundary` pe nucleu (→ SVG) și pe ecran (shell-ul rămâne) | 14 |
| V11 | Ținte touch de 30–36 px pe telefon | ≥40 px pe `pointer: coarse` | 0 controale sub 40 px în Focus la 390 |
| V12 | Compozitorul ocupa ~40% din telefon | opțiunile de rută se pliază după un buton-rezumat („Codex · doar citire”) | 16 (164 px în loc de ~350) |
| V13 | Registrul de integrări marca `browser.inspect` „available” fără Playwright | status `needs_setup` | test M02-SEC-11 |
| V14 | Scenariile simulatorului erau accesibile doar prin API | butoane în bannerul simulatorului (doar în procesul de simulare) | `m02-17-sim-scenario-quota-from-banner.jpg` |

## Măsurători (hardware: acest PC, Chromium din panoul Claude)

| Ce | Rezultat | Metodă |
|---|---|---|
| Overflow orizontal | 0 la 360, 390, 768, 1024, 1440 și 1920 pe ecranele testate; 0 pe 10 ecrane la 720×450 (≈ zoom 200% al unui 1440×900) | `scrollWidth - innerWidth`, per ecran |
| Feedback UI | paleta de comenzi deschisă în 36,6 ms la rece, apoi 6,7–12,2 ms; tranziție de ecran (chunk încărcat) 3,9–20 ms | `performance.now()` de la eveniment la commit-ul DOM |
| Cost GPU nucleu | ~2 ms/cadru desktop (canvas 340 px), 1,1–3,6 ms mobil (200 px CSS, 40 pași) | calibrare `readPixels` sincronă |
| Memorie | heap JS 12,4 → 14,9 MB după 80 de navigări, fără GC forțat; un singur canvas (fără contexte WebGL scurse) | `performance.memory`; sesiune scurtă, nu prelungită |
| Bundle | JS inițial 186,6 kB (63,2 kB gzip) + CSS 42,6 kB (9,5 kB gzip); ecranele se încarcă lazy (Focus 51,6 kB, System 86,8 kB) | `npm run build:v2` |
| FPS | nemăsurabil în panou (rAF redus la ~2 fps când panoul nu e în prim-plan) | înlocuit cu costul GPU per cadru |
| Accesibilitate | audit automat curat pe 7 ecrane (etichete, roluri, nume accesibile); contrast AA pe toți tokenii de text; focus vizibil; graful are alternativă listă | audit DOM + calcul WCAG |

## Ce nu a fost verificat vizual

- Emularea `prefers-reduced-motion` la nivel OS și FPS real: NOT_RUN (limitele panoului).
- Sesiune prelungită, de ore: NOT_RUN.
- Screen reader real (NVDA/Narrator): NOT_RUN. S-au verificat doar structura și etichetele.
- Playwright E2E: BLOCKED (NEEDS_INSTALL_APPROVAL).
- Voce cu motor local: BLOCKED (NEEDS_SETUP / aprobare instalare).
