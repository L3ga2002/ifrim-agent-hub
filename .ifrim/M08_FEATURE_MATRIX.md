# M08 · Matricea funcțiilor

**Legendă:**
- **SIM** = verificat în teste cu date sintetice și provideri fixture (PASS_SIMULATED);
- **UI** = văzut în aplicația reală, pe un Hub de test (capturi în `.ifrim/m08-screens/`);
- **LIVE** = verificat pe Hub-ul live, cu tine. Nicio funcție nu e încă LIVE: Hub-ul live rulează M07 până la trecere.

| # | Funcție | Voce / intenție | Ecran | Ce nu poate face niciodată | Teste | SIM | UI | LIVE |
|---|---|---|---|---|---|---|---|---|
| 1 | Digital Twin | „De ce e blocat?”, „Ce s-a schimbat de ieri?”, „Ce afectează modificarea în X?”, „De ce am ales X?” | Pilot → Digital Twin | să declare o relație din partea unui model (doar ipoteză); să umple ce nu știe | M08-D1-01/02 | ✔ | ✔ | — |
| 2 | War Room | „X a picat”, „Nu merge X” | Pilot → War Room; card în cockpit | să oprească sau să modifice ceva; să confirme o ipoteză de model; „rezolvat” fără dovadă | M08-D2-01, ADV (verify pe voce) | ✔ | ✔ | — |
| 3 | Project Autopilot | „Arată obiectivele”, „Pregătește planul pentru obiectivul X” | Pilot → Autopilot; DecisionCard în cockpit | să se reia sau să se aprobe singur; să treacă de DELIVERY_READY; să acopere un scope modificat | M08-D3-01…05, ADV-05 | ✔ (cap-coadă, 2 sarcini) | ✔ | — |
| 4 | AI Board Meeting | „Deschide ședința”, „Următorul punct”, „Amână punctul” | Pilot → Ședința | să decidă fără sesiunea ta; să activeze ceva; să trateze un pachet neacceptat ca livrare | M08-D4-01 | ✔ | ✔ | — |
| 5 | Simulation Mode | „Ce se întâmplă dacă luăm încă cinci clienți?” | Pilot → Simulare; card în cockpit | să inventeze o cifră; să atingă datele reale | M08-D5-01, D9-02 | ✔ | ✔ | — |
| 6 | Agent Performance League | „Cine lucrează cel mai bine?” | Pilot → Liga agenților | să numească un câștigător pe date insuficiente; să aplice singură o schimbare | M08-D6-01 | ✔ | ✔ | — |
| 7 | Skill Evolution | — (decizie în ecran) | Pilot → Skilluri | să schimbe un skill fără evaluare și aprobarea ta; să schimbe frontmatter-ul (unelte, permisiuni) | M08-D7-01 | ✔ | ✔ | — |
| 8 | Teach Lega | „Ține minte că…”, „La livrarea… verifică…”, „Uită regula…” | Pilot → Lecții; card în cockpit | să învețe din documente, pagini, tool-uri sau review-uri; să salveze ca regulă o lărgire de acces | M08-D8-01/02, ADV-03 | ✔ | ✔ | — |
| 9 | Zero-Menu Mode | „Ce avem azi?”, „Ecran complet”, „Pornește direct în ecran complet”, „Detalii”, „Da, execută planul” (fereastra armată) | cockpit: „Ecran complet”, „La pornire”; ecranul mare | să confirme din vocea transcrisă de provider; să confirme fără verificarea locală a vocii | M08-D9-01…04, ADV-04 | ✔ (voce sintetică) | ✔ | — |
| 10 | Personal Mission Control | — | `#/m`; Pilot → Telefon | să confirme un plan; să decidă un pachet; să trimită o comandă construită pe o imagine veche | M08-D10-01/02, ADV-02 | ✔ (HTTP pe localhost) | ✔ (390/360 px) | BLOCKED (telefon real) |
| — | Pachetele A/B | „Ce decizii am?” | Pilot → Decizii | să declare „executată” fără ca realitatea să o arate; să decidă B înaintea lui A | M08-PK-01, M08-D-A1 (mutare) | ✔ | ✔ | — |

**Integrarea cu ce exista:**
- **Lega și cockpit:** intențiile M08 trec prin același `owner.intent`, iar răspunsurile apar ca un card în cockpit.
- **Engineering Loop:** War Room → misiune BUGFIX; Autopilot → misiuni ale fabricii sub un plan.
- **Memorie:** lecțiile intră în `memory_items`.
- **Vânzări:** în agenda ședinței.
- **Mediul izolat:** sarcinile autopilotului rulează pe ruta proiectului; pachetul B1 mută ProDelivery pe `wsl-runner`.
