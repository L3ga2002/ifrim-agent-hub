# M15 — raport (înainte de sesiunea de acceptare a proprietarului)

Versiunea: cod `2.18.0-m15` (clona `m15-stage`, ramura `claude/project-thread-c0q8ro`, cod final `6eb54e7`). Fără migrare, schema 15, API contract 20.

Starea: implementat și verificat izolat. Instalarea live și push-ul rămân ale proprietarului (o comandă). Acceptarea M15 se face după sesiunea integrată.

Orele sunt în UTC; ora României = UTC+3.

## 1. Ce poți face mai ușor
- **Vezi ce te așteaptă fără să cauți.** În stânga L3ga, „Ce te așteaptă” arată:
  - planul de pe ecran;
  - pachetele;
  - livrările;
  - ofertele;
  - devizele și răspunsurile;
  - blocajele;
  - erorile;
  - execuțiile;
  - rezultatele depășite.

  Fiecare are o stare cu cuvânt, pictogramă și culoare, plus butonul locului unde decizi.
- **Știi unde lucrezi și ce urmează.** Lucrezi într-un singur loc, „Lucrezi la”. În dreapta, „Activitatea deschisă” spune starea activității și are o singură acțiune principală (de exemplu „Vezi planul și confirmă”, „Deschide locul deciziei”, „Cere planul din nou” la un plan expirat).
- **Vezi exact ce aprobi.** Fiecare decizie arată, înaintea confirmării, „Ținta exactă” cu ID și SHA complete și copiere.
  - Locuri noi unde ținta e completă: planul, planul de operație, pachetul din Fabrică, deciziile din Camera de livrare și textul ciornei Sales. Înainte aveau 12–16 caractere.
  - Planul arată în plus aceleași patru rânduri ca restul deciziilor: obiect, versiune, acțiune, consecință și ce nu se întâmplă.
- **Găsești istoricul fără ID-uri.** Ecranul „Rezultate” și tabul „Istoric și rezultate” au căutare după cuvinte, de exemplu „deviz”, „OPS-0001”, „spații”, și dată. Acolo sunt:
  - livrările;
  - lucrările software;
  - ofertele;
  - dosarele;
  - devizele;
  - cazurile de suport.
- **Bara laterală e mai simplă:** L3ga, Decizii, Lucrări, Rezultate; apoi Departamente (Vânzări, Studio, Companie) și „Avansat”, pliat, cu cele 12 ecrane tehnice.
  - Toate linkurile vechi și Alt+1–9 merg.
  - Pe telefon: L3ga, Decizii, Rezultate, Stop, Mai mult.
- **Conversația se citește ușor.** Are fundal opac, bule cu ora, iar harta se estompează cât scrii.
  - Figura 3D și modurile Nucleu / Față / Hartă rămân.
  - „Ecran complet” rămâne ca înainte.
  - Stop All e primul în bara de întreruperi.
- **Erorile spun ce s-a păstrat și cum continui.** Un refuz înseamnă că nu s-a schimbat nimic. O conexiune pierdută lasă datele salvate; verifici starea înainte să repeți.
- **Întrebări înțelese acum:**
  - „Ce decizii am?” numește ce așteaptă (înainte răspundea „Nicio decizie în așteptare” cu 5 decizii pe ecran);
  - „Fă formularul de contact cu validarea emailului”;
  - „Care e starea proiectului?”;
  - „Unde e devizul?”;
  - „Arată-mi rezultatele”;
  - „Ce e gata?”.

## 2. Prototip și capturi
- **Prototipul** (date demonstrative): https://claude.ai/artifact/GTBdrNxoJMr2w3EQQaE7jk
- **Capturile interfeței implementate** (Hub sintetic, `C:\Users\mihai\m15-evidence\shots\`):
  - L3ga la 1440 / 1280 / 1024 px și pe telefon simulat 390×844: `m15-lega-*.png`, `m15-lega-b-*.png`;
  - Rezultate: `m15-rezultate-1440.png`;
  - Deciziile mele: `m15-decizii-1440.png`;
  - probele E2E (`m15-evidence\e2e\`): planul cu ținta completă `m15-A-plan.png`, pachetul în „Ce te așteaptă” `m15-A-ready.png`, istoricul `m15-A-history.png`.
- Nicio captură nu are derulare orizontală.

## 3. Matricea traseelor E2E
| traseu | izolat (browser real, Hub sintetic, furnizori simulați) | dovada | real (sesiunea ta) |
|---|---|---|---|
| A Engineering | PASS: cerere tastată în L3ga → plan cu ținta completă → o confirmare → writer, verificări, review, QA → „Ce te așteaptă” → „Accept local” pe SHA-ul complet → istoric; o singură confirmare, 0 granturi / moduri / porți | `m15-e2e` A; `m10-2-probe-e2e`, `m06-ui-e2e` (poarta) | „M15 Demo Livrare”: Codex writer + Claude reviewer reali, preview, E2E — de făcut |
| B Media | PASS: o confirmare → misiunea → livrarea derivată: capturi, clip 16:9 + 9:16, QA, exporturi, rezumat → READY, fără model după software | `m11-delivery-flow` DF-01/02 (re-rulat pe `6eb54e7`, 230 s) | captura reală a aplicației, montajul, QA, exportul, aprobările creative — de făcut |
| C Sales | PASS: cererea în L3ga → un card → confirmarea → oferta → „Aprob intern” pe ID + SHA → dosar READY, ciornă DRAFT_ONLY netrimisă | `r-lega-one` (prin „Ce te așteaptă”), `m12-browser` | o ofertă sintetică nouă; Lăstărel rămâne revizia 3 READY (verificat prin GET) |
| D Operations / Support / Finance | PASS: citirile deschid OPS-0001 / SUP-0001 / DVZ-0001 în panou, exporturi + Word/PDF + registru; nimic creat | `m13-desk-ui`, `m14-lega-ui`, `m13-desk` | doar citiri ale înregistrărilor existente |
| E Oprire / recuperare | PASS: F5 (planul revine din Hub, textul netrimis și conversația revin, nicio cerere și niciun plan dublu), ecran complet, navigare, expirarea planului („Expirat” + „Cere planul din nou”, nimic rulat), istoricul deschis când vine un plan (planul e afișat și focalizat), repornire cu decizie neexecutată (o singură execuție) | `m15-e2e` E, `m14-recovery`, `r-lega-one` | — (doar sintetic, cum cere etapa) |

## 4. Furnizori reali, simulări, voce, dispozitive
- Furnizori reali în M15 până acum: niciunul. Toate probele izolate au folosit fixture-uri (fake Codex / Claude / WSL), adică PASS_SIMULATED. O simulare nu dovedește writer-ul, reviewer-ul sau captura reală.
- Furnizorii reali (Codex `gpt-6.1-sol`, Claude `sonnet`, din configurația autorizată) rulează doar în sesiunea ta.
  - Ultimele sonde live de cont sunt vechi (Codex 18.10, Claude 15.10); planul le reverifică singur.
  - Dacă un cont e indisponibil, pasul se consemnează blocat; nu se activează nimic plătit.
- Voce: nefolosită. Toate comenzile au fost tastate.
- Viewport: simulat (1440×900, 1280×800, 1100×800, 1024×768, 390×844, Chromium headless).
- Dispozitiv fizic: niciunul. Hub-ul ascultă doar pe 127.0.0.1; expunerea în rețea nu s-a schimbat.

## 5. Teste
- **Fișierele M15:** `m15-ui-logic` (8), `m15-intents` (2), `m15-e2e` (2).
- **Setul atins:** 107 fișiere, toate exit 0.
- **Poarta completă pe `a1d427f`:**
  - V2: 2624 = 2620 PASS, 3 FAIL, 1 SKIP (T25), 6778 s, încărcare medie 87 %;
  - V1: 553 = 552 PASS, 0 FAIL, 1 SKIP.
- **Cele 3 eșecuri** (RCF-04, RCD-04, RCE-04) au fost un defect M15 real: inbox-ul citea proiectele într-o vedere fără proiecte. Reparat în `6eb54e7`.
- **Re-rularea țintită pe `6eb54e7`:** 17 fișiere, 128/128 PASS.
- **Review independent:** 2 agenți (autoritate / intenții și design / funcții pierdute). Toate constatările au fost reparate cu teste.

## 6. Probleme reparate în M15
1. „Ce decizii am?” răspundea „Nicio decizie în așteptare” cu decizii pe ecran.
2. Ținta trunchiată la plan, la planul de operație, la pachetul din Fabrică, în Camera de livrare și la ciorna Sales.
3. Rândul „delivery_correction” nu avea nume.
4. Rândurile de livrare apăreau „proiect de test” și pentru un proiect real.
5. Formulări firești neînțelese (§1).
6. Constatările review-urilor: cardul de redeschidere și focusul planului ascunse în spatele tabului de istoric; planul expirat rămânea „Decizia ta”; ora fără dată în istoric; cardurile tăiate la 901–1280 px; insigna „Decizii” fără listă; starea Hub-ului ascundea modul; inbox-ul pe canalele agent/cli; tiparele prea largi.

## 7. Limite rămase
- La 1024×768 conversația e scurtă. Soluții: „Ecran complet” sau o fereastră mai mare.
- „Unde e oferta?” și „Unde e dosarul de pornire?” dau încă ajutorul general.
- „Ce lipsește?” nu e înțeles fără o ofertă deschisă.
- Fluxurile Sales / Birou rămân sintetice; trimiterea și publicarea rămân dezactivate.
- Telefonul a fost doar simulat.

## 8. Pașii tăi
1. Rulezi `C:\Users\mihai\m15-evidence\release\owner-release.cmd`.
2. Apoi urmezi `C:\Users\mihai\m15-evidence\PASII_PROPRIETAR.md`: 7 decizii, toate în L3ga.
3. La final scrii „Accept M15” sau ce nu merge.

Rezultatele sesiunii se adaugă aici (§9).

## 9. Sesiunea de acceptare (rulări reale, live)

Toate deciziile sunt ale tale, luate în sesiunea ta de proprietar (`osn_mvlfo3hx_8448c7a513`, profilul local de dezvoltare). Orele sunt ale României.

| Decizie | Când | Ce s-a decis | Rezultat verificat prin citire |
|---|---|---|---|
| D1 | 23.10, 23:41 | Planul pentru „M15 Demo Livrare” (o confirmare) | Codex `gpt-6.1-sol` · medium a scris corectura (`run_mvlfvjkh_f789d4983a`); baseline FAIL, verificări PASS; Claude `sonnet` · medium review doar-citire PASS (`run_mvlfy0da_9efa939fbb`); QA 6/6, preview, E2E AC-6 (390 px) și AC-7 (1280×800) PASS; misiunea `mis_mvlfr8xr_f2968d4432` DELIVERY_READY la 23:48; livrarea `dlv_mvlfr937_2c5f367d16` cu capturi, clip 16:9, vertical și rezumat |
| D2 | 24.10, 23:02 | „Accept local” pe `bnd_mvlfzq1v_c9c7ec2a96` (sha `9cc538d3…83f4`) | pachet OWNER_ACCEPTED, misiune ACCEPTED; nimic comis sau publicat |
| D3 | 24.10, 23:02 | Aprobarea creativă a clipului 16:9 | APPROVED (avertizările QA tehnic / drepturi au rămas vizibile) |
| D4 | 24.10, 23:02 | Aprobarea creativă a variantei verticale | APPROVED |
| D5 | 24.10, 23:02 | Rezumatul „gata de prezentare” | READY; publicarea OFF |
| D6 | 24.10, 23:09 | Cardul de pregătire a ofertei sintetice (salon de înfrumusețare) | planul `opp_mvmu1s6t_2c66de95ad` DONE (4/4 pași); oferta `spr_mvmu1x5e_6bb63a2197` v1 la revizia ta |
| D7 | 24.10, 23:16 | „Aprob intern” pe `spr_mvmu1x5e_6bb63a2197` (sha `fbef6372…de09`) | APPROVED_INTERNAL; dosarul rev. 1 READY (Word + Markdown în `Videos\Ifrim Studio\Exporturi\vanzari\…`), ciorna de contact `sdr_mvmu9xl2_9c99b3cddc` DRAFT, 0 contacte, outreach DISABLED, nicio misiune Engineering nouă |

Citiri D (23:03): „Arată dosarul de pornire OPS-0001”, „Arată cazul de suport SUP-0001”, „Unde e devizul?” s-au deschis în panoul Birou intern; nimic creat (tot 3 înregistrări, toate READY).

Intervenții tehnice (separat de decizii):
- 2026-10-23 seara: tu ai rulat comanda de instalare 2.18.0-m15.
- 2026-10-24 22:28–22:29: Claude a instalat 2.18.1-m15 (backup verificat `bkp_mvmsk7k5_859bf1d048`, fast-forward, upgrade gestionat `upg_mvmslprc`, VERIFY OK, boot `boot_mvmsluum_a50caf329a`).
- 2026-10-24, înainte de 23:04: tu ai rulat `push.cmd` (push-ul e refuzat sesiunii de setările proiectului); GitHub `v2-milestone-01` = `claude/project-thread-q6x9qp` = `c64593f`.
- Ți s-au cerut doar deciziile D1–D7 și cele două comenzi; nicio alegere de granturi, agenți sau moduri.

După sesiune, citire GET: `verify.mjs` VERIFY OK (2.18.1-m15, contract 20, schema 15, BUILD_SAFE; §25, Lăstărel și Birou intern neschimbate).

Observații mărunte, neblocante: răspunsul pentru deviz spune „Devizul DVZ-0001 (SINTETIC): pregătită” (acord de gen); numele firmei sintetice generate („Lăstărel Iepuraș SRL”) amintește de Lăstărel, deși e o ofertă nouă.

**M15 acceptat de tine** pe 2026-10-24 la 23:25 („accept m15”). **M14 acceptat de tine**, separat, pe 2026-10-24 la 23:26 („accept si m14”).

## 10. Corecții finale 2.18.1-m15 (2026-10-24)

Ce se schimbă pentru tine:
- O lucrare software care scrie cod, își scrie testul, e verificată sau reparată apare „În lucru”, nu „Pregătit”. Pauza apare „În pauză”, oprirea în curs „Se oprește”, blocajul „Lipsește ceva”, iar specificația sau pachetul care te așteaptă apar „Decizia ta”.
- O stare pe care interfața nu o cunoaște apare „Stare necunoscută”, împreună cu valoarea primită de la Hub. Nu mai apare ca „Pregătit”.
- Dacă legătura cade sau Hub-ul răspunde cu o eroare internă, L3ga spune că nu știe dacă cererea a fost executată. Recitește singur starea salvată și îți oferă „Verifică starea salvată”, nu „Scrie din nou cererea”.
- Mesajul „nu s-a schimbat nimic” apare doar când e dovedit: cererea nu a plecat din pagină sau Hub-ul a refuzat-o înainte de execuție.

Autori și verificări:
- Codul `1832977` a fost scris de Codex `gpt-6.1-sol` · medium, în 3 runde. Review-ul l-au făcut două sesiuni Claude separate, doar citire: primul a găsit un defect blocant (o ofertă contactată apărea „Decizia ta”) și 7 observații, al doilea nimic blocant. Toate au fost tratate.
- Teste pe codul final:
  - 18 fișiere afectate, inclusiv în browser: 152/152;
  - poarta V2 completă: 2637/2638, 0 eșecuri, 1 omis (T25);
  - V1 nu s-a schimbat față de `a1d427f`, unde a trecut 552/553.
- Rulările anterioare rămân separate: `a1d427f` (V2 2620/2624, 3 eșecuri = defectul reparat) și re-rularea țintită 128/128 pe `6eb54e7`.

Sesiunea reală, până acum:
- D1 (planul) confirmată de tine pe 2026-10-23, la 23:41.
- Codex real a scris corectura, iar Claude real a făcut review-ul: PASS. QA, preview și E2E pe mobil și desktop au trecut.
- Livrarea e gata, cu clip 16:9, variantă verticală și rezumat.
- D2–D7 și citirile Birou intern sunt încă ale tale.
