# M06 · Statusul implementării (cerință → cod → test → dovadă → status)

Data: 2026-10-02. Cod `2.7.0-m06`, pe disc, **necomis**. Hub-ul live (8011) rulează încă `2.6.0-m05`; `v2/web/dist` conține deja UI-ul M06, așa că până la repornire ecranul Lega arată „Hub-ul rulează o versiune mai veche”.

Statusuri: PASS_LOCAL (real pe acest PC, fără model) · PASS_SIMULATED (fixture, autentificator software/virtual, voci sintetice) · PASS_LIVE (cu model real) · BLOCKED · NOT_RUN.

## Ideile aprobate (§36)

| Idee | Cod | Teste | Status |
|---|---|---|---|
| Voce principală (Lega conduce Hub-ul) | `screens/Lega.jsx` (ecran de start), `shell/Lega.jsx` (GPT-Live), unealta vocală `lega.open_cockpit`, `owner/intents.mjs`; transcrierile tale trec prin resolver ca `voice-provider` | IN-01…04, EN-05, EN-13, LV-01 | PASS_SIMULATED; vocea live NOT_RUN în M06 |
| Mission Authorization Envelope | `owner/envelopes.mjs`, migrarea 6 | EN-01…13, UI-E2E-01; MU-04…07 | PASS_SIMULATED |
| O singură confirmare, granturi interne | `envelopes.confirm`, `issueGrants`, `approvals.decideByEnvelope` | EN-02, EN-03, UI-E2E-01 | PASS_SIMULATED |
| Autonomie per proiect (4 niveluri) | `envelopes.setAutonomy`, `authorityFor`, `factory.attachAuthority` | EN-07, EN-10, EN-13; MU-10 | PASS_SIMULATED |
| Engineering loop (M03 extins, nu dublat) | cârligul de autoritate din fabrică; restul neschimbat | EN-02, EN-07, PL-05 | PASS_SIMULATED |
| Project Cockpit | `owner/cockpit.mjs`, `screens/Lega.jsx` + `lega/cards.jsx` | CK-01, CK-03, CK-04, UI-E2E-01 | PASS_SIMULATED + verificare vizuală în simulator |
| Fața 3D: morph | `lib/faceGeometry.js`, `components/face/LegaFace.jsx` | UI-03, UI-04; capturi | **PASS_LOCAL** (randat în Chromium și în panoul browserului; morph-ul surprins în mijlocul tranziției) |
| Lip-sync (amplitudine audio redată) | `mouthFollower`, `legaLevels.lega/muted` | UI-04 | PASS_SIMULATED; pe audio real Lega NOT_RUN; viseme: BLOCKED (ruta nu le oferă) |
| Speaker gate local (înaintea transportului) | `voice-gate-worklet.js`, `lib/voiceGate.js`, `lib/voiceFeatures.js`, `owner/voice.mjs`, integrat în `shell/Lega.jsx` | VO-01…04; MU-12 | PASS_SIMULATED (voci sintetice); pe vocea ta NOT_RUN; verificator de bază necalibrat |
| Anti-replay / liveness | flag-uri locale (vocea Lega în microfon, dispozitiv virtual, spectru de difuzor) | VO-03 | PASS_SIMULATED pentru mecanică; provocarea cu frază aleatorie **BLOCKED** (fără transcriere locală) |
| Hartă spațială a companiei | `cockpit.companyMap`, card `CompanyMap`, fața în forma HARTĂ | CK-06; capturi | PASS_SIMULATED + vizual |
| Live execution graph | `cockpitLogic.missionGraph`, card `AgentGraph` | UI-05 | PASS_SIMULATED |
| Status instant („ce face acum”) | `cockpit.status` | CK-03 | PASS_SIMULATED |
| Replay (READ_ONLY, HISTORICAL) | `cockpit.replay`, card `Replay` | CK-02 | PASS_SIMULATED |
| Plan preview („Arată-mi înainte să faci”) | `envelopes.propose`, `DecisionCard` | EN-01, UI-E2E-01 | PASS_SIMULATED + vizual |
| Carduri contextuale | `owner/layout.mjs` (catalog, validare, `layoutForIntent`), `lega/cards.jsx` | CK-05 | PASS_SIMULATED |
| Comenzi înlănțuite, negații | `intents.mjs` | IN-01, IN-03; MU-09 | PASS_SIMULATED |
| Continuitate („ce făceam ieri”) | `cockpit.delta`, `owner_visits` | CK-04 | PASS_SIMULATED |
| Explicații (de ce blocat, de ce Claude, estimări oneste) | `cockpit.whyBlocked/whyRoute/estimate` | CK-03 | PASS_SIMULATED |
| Shadow Mode | `advisor.requestShadowReview`, `shadow_evaluations` | CK-10 | PASS_SIMULATED |
| Recomandări de autonomie și politici | `advisor.recommendations` | CK-09 | PASS_SIMULATED |
| Ierarhia întreruperilor | `owner/interrupts.mjs`, verificarea porții `project_frozen` | CK-07, EN-08; MU-11 | PASS_SIMULATED |
| Proactiv liniștit | `advisor.attention`, `ownerPrefs` | CK-08 | PASS_SIMULATED |
| Daily briefing / „ce s-a schimbat” | `cockpit.delta("__company__")`, card `Briefing` | CK-04 | PASS_SIMULATED |
| Vederi multimodale | cockpit, hartă, față; text/tastatură; mobil | capturi desktop și mobil | PASS_LOCAL (vizual, simulator) |
| O singură personalitate Lega, context per proiect | o conversație în cockpit; schimbarea proiectului nu transferă aprobări (planul e legat de proiect, indexul unic) | EN-03, CK-01 | PASS_SIMULATED |
| O propoziție → buclă | „Arată-mi înainte să faci” → confirmare → DELIVERY_READY | UI-E2E-01 | PASS_SIMULATED |
| Compunere UI sigură | catalog + validare; fără eval și fără HTML de la model | CK-05 | PASS_SIMULATED |
| Contractul întreruperilor | `interrupts.mjs` + `M06_LEGA_EXPERIENCE.md` §2 | CK-07 | PASS_SIMULATED |
| Trusted Session (WebAuthn) | `owner/webauthn.mjs`, `trust.mjs`, `owner-routes.mjs`, `lib/ownerSession.js`, `lega/OwnerSetup.jsx` | TR-01…07, UI-E2E-01; MU-01…03 | PASS_SIMULATED; Windows Hello real NOT_RUN |
| Politică versionată, legacy implicit | `ownerPolicy`, `owner.policy.activate/deactivate`; `decided_via = owner_session` | TR-04, EN-01 | PASS_SIMULATED |
| Costul: doar abonamentul inclus | `body.subscriptionPolicy`; ghidajele de facturare neatinse | EN-12 | PASS_SIMULATED |

## M06-A

| Componentă | Cod | Dovadă | Status |
|---|---|---|---|
| Profilul doar-local (bwrap, netns doar loopback) | `wsl-factory-runner.mjs localOnlyArgs` | C18a–i real 9/9; calea reală a gazdei de preview (HTTP 200, izolare `ok`, 0 procese rămase) | **PASS_LOCAL** |
| Preview în mediu prin Hub | `startPreview`, `routed-runner.previewRunner` | PL-04, PL-05 (fake-wsl) | PASS_SIMULATED; prin Hub-ul live NOT_RUN (repornire + reatestare) |
| E2E în namespace | `e2eReadiness`, `factory.runE2ECriteria` (calea mediului) | PL-02, PL-05 | **BLOCKED**: Chromium Linux lipsește |
| Review în mediu | — | — | **BLOCKED**: Claude Linux și loginul tău |
| C18 opțional (nu invalidează C1–C17) | `CANARY_OPTIONAL_IDS`, `attestationStatusOf` | PL-03, M05-RT-06 | PASS_SIMULATED |
| C3 Stop în turn real WSL | — | — | NOT_RUN (probă live aprobată) |

## Demonstrațiile §33

| Demo | Status | Dovadă |
|---|---|---|
| D1 „Hai să lucrăm la …”: cockpit fără pornire, fără status inventat | PASS_SIMULATED (proiect de test); ProDelivery live NOT_RUN | CK-01; captura simulatorului |
| D2 „Arată-ți fața”: morph, audio, întrerupere, revenire | PASS_LOCAL vizual (morph); audio real NOT_RUN | UI-03/04; capturi `m06-face.png`, mobil |
| D3 „Arată-mi înainte să faci” + o confirmare | PASS_SIMULATED în UI real (autentificator virtual) | UI-E2E-01 (`m06-plan.png`, `m06-ready.png`) |
| D4 „Continuă până e gata de verificarea mea” | PASS_SIMULATED (buclă până la DELIVERY_READY, 0 formulare) | EN-02, UI-E2E-01 |
| D5 „Ce face Codex? Claude ce zice?” | PASS_SIMULATED | IN-01, CK-03, cardurile Review/Explain |
| D6 Companie → Engineering → proiect → înapoi | PASS_SIMULATED (intenții + card) + captura formei HARTĂ | IN-04, CK-06 |
| D7 „Arată de ce a picat testul” | PASS_SIMULATED | CK-02 |
| D8 altă voce/TTS spune „confirmă” | PASS_SIMULATED (transcrierea providerului refuzată; flag-urile filtrului) | EN-05, EN-13, VO-03 |
| D9 Pauză, Stop worker, Freeze, Stop All, Preiau eu | PASS_SIMULATED (Stop worker pe un worker activ: acoperit de pauza misiunii în EN-08 / CK-07, nu separat) | CK-07, EN-08 |
| D10 Shadow + recomandare de autonomie | PASS_SIMULATED | CK-09, CK-10 |
