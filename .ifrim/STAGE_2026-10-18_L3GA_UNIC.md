# Etapa 2026-10-18 — O singură interfață L3ga și prima utilizare completă a M12 (cod `2.15.3-m12`, API contract 17, schema 13)

## 1. Activare și reguli
- Mesajul proprietarului din 2026-10-18 10:13 UTC (thread-ul etapei) definește etapa: o singură interfață L3ga la `#/lega`, apoi O singură
  probă Sales sintetică prin interfața mare, cu cele două decizii ale lui (confirmarea planului `sales.prepare`, „Aprob intern” pe ID + SHA).
- Stare verificată la start (doar GET): live `2.15.2-m12`, contract 17, schema 13, BUILD_SAFE, poarta deschisă, boot `boot_mvdmq414_86fd1ce2b9`;
  folderul Hub și `origin/v2-milestone-01` = `b51c839`, arbore curat. Scriptul vechi `fix-stage\release\owner-release.cmd` NU a fost refolosit
  (precondiția lui era HEAD `3d9b3e8`; 2.15.2 era deja instalată). Live Sales: 0 firme, 0 servicii, trimiterea și colectarea dezactivate.
- Izolare: dezvoltare în clona `C:\Users\mihai\hub-ui` (ramura `claude/project-thread-dx5843`, fără remote, `core.autocrlf=false`, joncțiune
  `node_modules`), Node de sistem 24.14.0. Hub-uri doar sintetice: simulatorul din clonă (port 8012, date noi în `.ifrim\tmp\v2-sim` al clonei,
  profil de dezvoltare activat doar acolo) și hub-urile de test create de la zero. Niciun Hub / Fabrică peste date reale sau copii.
  Live: doar GET. Dovezile: `C:\Users\mihai\lega-one-stage\`.
- Roluri: implementarea — thread-ul Claude; review-ul independent — agent separat, doar-citire, pe medium. Fără Codex (limită până la 22.10).

## 2. Inventarul (ce exista și unde a ajuns)
| Funcție | Înainte | Acum (ecranul `#/lega`) |
|---|---|---|
| Harta 3D a companiei | modalul „Ecran complet” (`LegaStage`) | fundalul ecranului (`StageCanvas`, același renderer, aceleași date) |
| Compania (departamente) | coloana stângă a modalului | panoul „Compania”; un departament deschide cardul lui în ecran |
| Decizii și execuții | coloana dreaptă a modalului (tipuri brute) | panoul „Decizii și execuții”: „Deciziile mele” (cu SHA complet), aprobări, execuții, misiuni |
| Selectorul de proiect + contextul | antetul cockpitului | antetul ecranului (+ starea proiectului, înghețat, modul, poarta) |
| Fața Legăi: Nucleu / Față / Hartă | coloana mică a cockpitului | figura din centrul hărții, aceleași trei forme |
| Discret / Ascunde | coloana mică | figura mică / doar harta („Arată fața” o readuce) |
| Conversația + răspunsuri, clarificări, blocaje, linkuri | coloana mică, pierdută la orice remontare | centrul ecranului, păstrată per proiect |
| Text, trimitere, microfon | compozitorul coloanei mici | compozitorul din centru (+ „?” cu exemple) |
| Taci, Pauză, Oprește agentul, Îngheață, Preiau eu, Stop All | bara coloanei mici | bara „Întreruperi” din centru, aceleași comenzi `/api/owner/interrupt` și `/api/stop-all` |
| Vocea Lega (pornire, contor, nivele, microfon/sunet oprit, filtru, transcriere, propuneri vechi, săgeata, erori de pornire) | panoul plutitor al barei de sus | același component, randat în ecran („Vocea Lega”); plutitor doar în afara `#/lega` |
| Subtitrările vocii | modalul | sub figură |
| „Ecran complet”, Alt+J, ecranul de pornire „stage” | modal peste orice ecran | același ecran fără barele Hub-ului; Esc / „Ieși din ecran complet” revine |
| Planuri (DecisionCard, OpsPlanCard), redeschiderea porții, cereri păstrate, livrări, carduri | coloana mare a cockpitului | coloana de lucru, neschimbate |
| Oferta Sales în așteptare + dosarul | doar în Vânzări → Oportunitate | și cardul „Oferta” din ecran (aceleași componente: „Aprob intern” pe ID + SHA, „Pregătirea ofertei și dosarul”) |

Linkuri vechi: `#/lega/<proiect>`, `#/lega/setup`, `stageOpen` (voce „Ecran complet”, butonul „Modul Lega” din Control, toasturile care
închideau scena) duc toate la ecranul unic. Datele nu s-au schimbat (preferințele `hub.v2.lega.*` din browser rămân).

## 3. Continuitate și stare reală
- Conversația și textul netrimis stau în store-ul aplicației, separat pe proiect (`v2/web/src/lib/legaConversation.js`): schimbarea formei,
  „Ecran complet”, o vizită pe alt ecran și înapoi nu le pierd și nu le dublează. Butoanele de opțiuni ale unui răspuns rămân doar în ecranul
  care l-a primit (după o remontare nu se mai oferă o opțiune expirată).
- O singură captură audio: doar componentul vocii din bara de sus deschide microfonul / peer-ul; ecranul oferă doar locul. Butonul local
  „Ține apăsat” refuză cât rulează sesiunea Lega, iar Lega refuză să pornească cât e apăsat butonul local.
- Linia de activitate arată doar date reale: eroare, cerere în curs, voce (conectare, ascult, te aud, vorbește, predă), plan / decizie în
  așteptare, execuții, liniște.
- Autoritatea nu s-a schimbat: confirmarea planului (nonce + hash afișat), sesiunea de proprietar, deciziile Sales rezervate, regula
  „căutarea live doar după ce ai văzut setarea”, cardul de redeschidere și fereastra vocală armată.

## 4. Fișiere
- Noi: `v2/web/src/lib/legaConversation.js`, `v2/web/src/lib/legaOneScreen.js`, `v2/web/src/screens/lega/OneScreen.jsx`,
  `v2/web/src/styles/lega-one.css`, `v2/tests/r-lega-one.test.mjs`.
- Schimbate: `screens/Lega.jsx`, `shell/Lega.jsx`, `shell/Shell.jsx`, `shell/Voice.jsx`, `screens/stage/LegaStage.jsx`,
  `screens/sales/Opportunity.jsx` (export `ProposalView`), `main.jsx`, `nav.js`, `server/config.mjs` (doar versiunea).
- Teste existente schimbate doar pentru contractul nou al interfeței: `m10-lega-stage-e2e` (pornirea din ecranul complet: motivul apare în
  ecran, nu mai e modal / panou plutitor), `m10-2-review-g5` (#41: ecranul complet nu mai acoperă cardurile), INT-05 (versiunea).

## 5. Verificări
- **Build**: `vite build` în clonă (0 erori); identitatea `2.15.3-m12` în bundle; simulatorul clonei servește build-ul nou (markerii verificați
  cu `release\verify.mjs http://localhost:8012`: versiune, panoul vocii în ecran, „Ieși din ecran complet”, fără modalul vechi).
- **Regresii noi** `v2/tests/r-lega-one.test.mjs` (4): continuitatea per proiect și limitele ei; panourile (oferta afișată, oferte închise,
  linia de activitate doar din date reale); static: fără modal, un singur proprietar al microfonului și al player-ului, refuzul celei de-a doua
  capturi, aceleași comenzi de întrerupere; **în browser real** (hub sintetic, profil local — PASS_SIMULATED): ajutorul nu trimite nimic; textul
  netrimis supraviețuiește formelor, Discret / Ascunde, „Ecran complet” (buton, Alt+J, Esc) și unei vizite pe alt ecran; cererea M12 scrisă →
  UN card, o singură cerere; formele / ecranul complet / revenirea nu dublează cererea, planul sau conversația; confirmarea planului → WAITING_OWNER;
  decizia apare în „Decizii” (SHA complet) și în cardul ofertei (ID + SHA + „De stabilit”); „Aprob intern” din ecran → dosar READY afișat în ecran
  (manifest SHA complet, DRAFT_ONLY netrimisă, APP_NOT_RUN spus ca atare, autoritatea „sesiune locală de dezvoltare”); 0 handoff, 0 misiuni,
  0 CONTACTED/WON, o aprobare, o confirmare; în ecranul complet barele Hub-ului sunt ascunse, paleta Ctrl+K e deasupra, Esc într-un dialog nu
  iese din ecran, la 1280×650 comenzile și caseta sunt vizibile; 800 px și 360 px fără scroll orizontal, Stop All accesibil.
  Pe build-ul dinainte de reparațiile review-ului, R-LEGA-ONE-04 pică (bara de sus focalizabilă în spatele ecranului).
- **Teste existente** (rularea 1, cele 66 de fișiere care citesc sursele UI sau pornesc un browser; build-ul de dinainte de review; încărcare
  medie 96,6 %, maxim 100 %; loguri `C:\Users\mihai\lega-one-stage\run-affected-1`): 630 = 627 pass, 3 fail: R3-UI-09/10 (căuta clasa exactă
  a coloanei de lucru → clasa păstrată), R-LEGA-ONE-04 (verificările noi pe build-ul vechi, așteptat), RM-10 (captură reală, `HOLD_LATENCY_EXCEEDED`
  la tastare sub încărcare; intermitent cunoscut). **Rularea 2 pe build-ul final** (31 de fișiere: toate suitele de browser + cele care citesc
  ecranul Lega + versiunea; încărcare medie 97,9 %; `run-affected-2`): **290/290**, RM-10 trecut; plus 8 fișiere de logică UI: **66/66**.
- **Suita completă nu s-a rulat**: nu s-a schimbat niciun cod de server (doar `HUB_VERSION`), migrare sau mecanism comun; baseline 2565/2566 rămâne.
  V1 neatins (cele 2 eșecuri pe registrul real rămân consemnate separat).
- **Review independent** (agent separat, doar-citire, medium): 0 critice, 2 importante, 5 medii, 7 minore; reparate: z-order / bare ascunse
  în ecranul complet, Esc cu captură, lista ofertelor închise, butoanele de opțiuni doar în ecranul care a primit răspunsul, o singură linie
  neutră în celălalt proiect, coloana centrală cu zona derulantă separată de voce / casetă / comenzi, „Oprește Lega” în antetul ecranului
  complet, pagina de configurare iese din ecranul complet, panoul plutitor se închide când e andocat. Rămase (minore, documentate): starea
  locală a cardului de propunere vechi se resetează la schimbarea proiectului (serverul decide); `shownWebSearch` la montare (ca înainte).

## 6. Release
- Ramura `claude/project-thread-dx5843` din clona `C:\Users\mihai\hub-ui` = `b51c839` + `289dc63` (cod) + commitul de documentație;
  avansează rapid `v2-milestone-01` (folderul Hub și origin sunt la `b51c839`). Arborele executabil al release-ului = `289dc63`.
- Scriptul proprietarului `C:\Users\mihai\lega-one-stage\release\owner-release.cmd` (modelul 2.15.2, oprit la primul pas eșuat):
  ramură / HEAD `b51c839` / arbore curat → aducerea release-ului din clonă cu SHA-ul exact și arborele executabil = `289dc63` → backup
  verificat prin API-ul live → fast-forward → `upgrade.mjs --plan`, apoi `--apply` (fără migrare; reconstruiește UI-ul) → `verify.mjs`
  (GET: 2.15.3-m12 / 17 / schema 13 / BUILD_SAFE, deciziile Sales pe owner+test, markerii ecranului unic în UI-ul servit) → push.
- Revenire: `git revert 289dc63` + `node v2\scripts\upgrade.mjs --apply` (schema neschimbată); nicio dată nu se schimbă la upgrade.

## 7. Pilotul M12 live
(completat la final)
