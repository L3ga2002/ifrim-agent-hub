# M06 · Raport: Lega 2.0 (voice-first) + pregătirea pipeline-ului

Data: 2026-10-02. Versiunea codului: `2.7.0-m06`, pe disc pe `v2-milestone-01` peste `c8ff6f4`, **necomisă**. Nu am făcut commit, push, merge sau deploy și nu am pornit niciun model. Detaliile sunt în:
- `M06_LEGA_EXPERIENCE.md`, `M06_MISSION_ENVELOPES.md`, `M06_VOICE_TRUST_MODEL.md`;
- `M06_PIPELINE_READINESS.md`, `M06_IMPLEMENTATION_STATUS.md`;
- `M06_TEST_REPORT.md`, `M06_UX_MEASUREMENTS.md`.

## 1. Experiența, pe scurt

**Câți pași faci pentru o misiune obișnuită.** O singură dată, în Lega → Configurare:
1. Înregistrezi Windows Hello.
2. Activezi politica voice-first.
3. Alegi autonomia proiectelor.

După aceea, pentru fiecare misiune: o propoziție („Arată-mi înainte să faci”) și **o confirmare** („Da, execută planul”, cu Enter, butonul sau Windows Hello dacă sesiunea s-a blocat).
- **Fără:** formulare de grant, LIVE_VALIDATION tastat, „Aprobă și pornește”.
- **Măsurat** în UI-ul real, cu autentificator virtual: 1 confirmare, 0 formulare de grant, 0 clicuri în Aprobări, până la „Gata pentru verificare”.
- **În proba (c) din M05:** 6–7 acțiuni în 4 ecrane.

**Ce poate Lega acum:**
- deschide contextul unui proiect („Hai să lucrăm la …”) din datele Hub-ului, fără să pornească nimic și fără status inventat;
- arată planul exact, cu tot ce nu face niciodată;
- arată ce a schimbat Codex, ce a găsit Claude, testele, de ce e ceva blocat, de ce Claude e reviewer;
- reia istoric (doar citire) până la prima eroare;
- arată harta companiei;
- se transformă din nucleu în față și în hartă;
- tace, pune pauză, oprește un agent, îngheață un proiect, oprește tot, sau îți predă controlul cu checkpoint;
- te întrerupe doar pentru decizii, dacă îi ceri asta;
- dă recomandări din deciziile tale;
- face un review shadow când îl autorizezi.

**Unde cere încă intervenția ta, și de ce:**
- **Configurarea unică.** Un autentificator nu se poate înregistra fără tine, iar politica nu se activează singură.
- **Confirmarea fiecărui plan nou.** Un plan schimbat cere o nouă confirmare.
- **O remediere la nivelul ASSISTED.** Așa ai ales nivelul; la TRUSTED dispare.
- **Livrarea.** Hub-ul nu acceptă și nu livrează singur.
- **Confirmarea vocală.** E **blocată** până există transcriere locală, pentru că transcrierea providerului nu e dovada răspunsului tău.
- **Proiectele reale.** Rămân **blocate de izolare** (E2E și review încă în afara mediului atestat).

## 2. Nivelurile (§36)

| Nivel | Stare |
|---|---|
| `M06_A_PIPELINE_READY` | **neatins.** Preview-ul izolat e gata: bwrap doar-loopback, C18 9/9 PASS_LOCAL, calea reală a gazdei PASS_LOCAL. E2E (Chromium Linux) și review (Claude Linux) sunt BLOCKED, iar C3 e NOT_RUN |
| `M06_B_UX_READY` | **atins în simulare.** Cockpit, intenții, carduri, față, hartă, întreruperi, replay, briefing: PASS_SIMULATED și verificat vizual în simulator și în Chromium. Pe Hub-ul live așteaptă repornirea |
| `VOICE_FILTER_VALIDATED_LOCAL` | **parțial.** Mecanica e PASS_SIMULATED pe voci sintetice; nu e validat pe vocea ta; verificatorul de bază e necalibrat și nu autorizează nimic |
| `TRUSTED_SESSION_READY` | **PASS_SIMULATED** (autentificator software + virtual Chromium); Windows Hello real NOT_RUN |
| `VOICE_MISSION_FLOW_VERIFIED` | **PASS_SIMULATED pentru confirmarea tastată sau prin clic** (cerere → plan → confirmare → grant derivat → buclă → DELIVERY_READY). Confirmarea vocală: BLOCKED |
| `REAL_PROJECT_PILOT_ELIGIBLE` | **fals.** `PIPELINE_ISOLATION_VERIFIED` e fals și nicio confirmare nu compensează asta |
| `OWNER_ACCEPTED` | decizia ta |

## 3. Ce s-a schimbat în produs (deliberat)

- **Regula legacy** („vocea doar propune, toate aprobările prin meniuri”) rămâne **implicită**.
- **Politica nouă** (`ownerPolicy = voice_first`, v1) se activează doar de tine, într-o sesiune WebAuthn reautentificată, cu textul exact. Revenirea e fail-safe.
- **Auditul istoric** nu se rescrie. Decizia prin plan apare ca `decided_via = owner_session`, cu planul numit, nu ca un clic `ui`.
- **Canalul `owner`** nu există fără o sesiune rezolvată din bază.
- **Granturile** rămân în backend și în modul avansat (Integrări); nu le mai creezi tu pentru munca normală.
- **Ecranul de start** e Lega; Control Room e la un clic.

## 4. Izolarea (M06-A) pe scurt

- **Măsurat real:** în `ifrim-runner`, bwrap 0.9.0 neprivilegiat, cu namespace de rețea propriu (doar loopback), permite preview-ul și blochează internetul, DNS-ul, gazda Windows și Hub-ul. `~/.codex`, `/mnt/c` și celelalte workspace-uri nu se văd, iar `/usr` e doar-citire.
- **Alegerea:** asta am ales în locul relaxării sandbox-ului Codex, care ar fi deschis rețeaua generală. Canary-ul C18 atestă profilul.
- **Cum se leagă de atestare:** C18 doar adaugă acoperire; dacă pică, nu invalidează C1–C17.
- **Proiectele reale:** rămân blocate, fiindcă E2E-ul are nevoie de un browser în același namespace, iar review-ul de Claude în mediu. Pachetul de instalare e în `M06_PIPELINE_READINESS.md` §5.

## 5. Teste și dovezi

Vezi `M06_TEST_REPORT.md`.
- **Fișiere noi M06:** 10 (50 de teste): securitatea sesiunii, envelope-uri, intenții, cockpit, voce, pipeline, logica UI, agentul vocal care deschide cockpitul, plus un E2E în browser real.
- **Mutanți:** 13, dintre care 12 prinși; unul e echivalent și documentat.
- **Regresii:** V2 pe codul final are 550 de teste: 549 PASS, 0 FAIL, 1 omis. Sunt 544 din rularea completă plus 5 rerulate; în rularea completă un fișier n-a putut fi încărcat din cauza unei erori de sintaxă introduse de mine, reparată. V1: 552 / 551 / 0 FAIL / 1 omis, neschimbat.
- **Real fără model:** C18a–i 9/9 și gazda de preview reală.
- **Vizual:** captura cockpitului, a planului, a feței (desktop și mobil), a morph-ului în mijlocul tranziției și a fluxului complet în Chromium.

## 6. Date biometrice și resurse

- **Ce se păstrează:** doar un centroid MFCC de 38 de numere, local, în `.ifrim/private/voice`; nu există audio brut, embedding în audit sau trimitere în cloud. Ștergerea e un clic.
- **Costul feței:** 0,16 ms CPU pe cadru (2.200 de particule), oprită când pagina nu e vizibilă.
- **Filtrul strict:** ~150 ms de calcul pentru 3 s de audio, plus durata propoziției.
- **Fundal:** niciun serviciu nou în fundal, nicio instalare, nicio descărcare.

## 7. Limitări oneste

- **Windows Hello** nu a fost folosit real. L-a înlocuit un autentificator virtual sau software, deci rezultatele sunt PASS_SIMULATED.
- **Vocea ta** nu a fost înscrisă, iar verificatorul de bază nu are rate de eroare. Detectorii de replay sunt euristici; nu fac imposibilă imitarea sau sinteza.
- **Lip-sync-ul** e amplitudine, nu foneme; ruta GPT-Live nu oferă viseme.
- **ProDelivery** n-a fost deschis live în cockpit (D1 doar pe proiect de test). Hub-ul live trebuie repornit pe M06.
- **Pe live** nu au rulat: preview-ul în mediu prin Hub, C3 și orice probă cu model.
- **Mini-asistentul** nu e always-on-top la nivel de OS. Mobilul nu are acces remote.

## 8. Ce urmează (pașii tăi, în ordine)

1. `node v2/scripts/migration-dry-run.mjs` (schema 5→6), apoi repornirea Hub-ului din terminalul tău (`npm run v2:stop`, `npm run v2`).
2. Sistem → Medii → Inspectează → C16 → Atestare (canary v2, cu C18).
3. Deschizi `http://localhost:8011/#/lega/setup`: Windows Hello, politica, autonomia pe proiectele de test.
4. O probă D3/D4 pe un proiect de test: o confirmare; consumul vine din abonament.
5. Decizia pe pachetul de instalare (A1–A3 + C, apoi (b)); B1 și B2 pentru vocea locală.

Neschimbate:
- **Demo B** (`bnd_mupwze7b_e03f70f2d7`) așteaptă decizia ta.
- **Merge-ul în `main`** nu e făcut.
- **ProDelivery, AROBS, Sales live** nu au fost atinse.
