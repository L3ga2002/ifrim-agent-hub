# M06 · Modelul de încredere: sesiunea de proprietar și vocea

Data: 2026-10-02. Cod: `v2/server/owner/webauthn.mjs`, `trust.mjs`, `voice.mjs`, `owner-routes.mjs`; `v2/web/src/lib/ownerSession.js`, `voiceFeatures.js`, `voiceGate.js`, `web/public/voice-gate-worklet.js`.

## 1. Cine ești: autentificatorul, nu vocea

- **WebAuthn:** autentificatorul platformei (Windows Hello: PIN, amprentă, față) sau o cheie de securitate. Ceremonia o rulează browserul și Windows. Hub-ul nu simulează niciun PIN și nu stochează nimic din el.
- **Ce verifică backend-ul:**
  - provocarea emisă de el, de unică folosință și valabilă 120 s;
  - `type`, `origin` și `crossOrigin` din `clientDataJSON`;
  - hash-ul RP ID (`localhost`);
  - flag-urile UP și **UV** (verificarea persoanei e obligatorie);
  - semnătura (ES256, RS256 frecvent la Windows Hello, EdDSA) cu cheia publică înregistrată;
  - contorul (un contor care nu crește e refuzat: posibilă clonare).
- **Atestarea:** e cerută ca `none`. Hub-ul nu pretinde că știe marca sau certificarea autentificatorului.
- **Originea:** `http://localhost:8011`. WebAuthn nu acceptă o adresă IP ca RP ID; pe `127.0.0.1`, interfața îți arată legătura spre localhost.
- **Bootstrap:**
  - primul autentificator cere textul de configurare tastat în UI, același nivel de încredere ca orice acord anterior din UI;
  - orice autentificator următor cere o sesiune reautentificată, deci un proces care cunoaște doar token-ul API per boot nu își poate adăuga propriul autentificator după ce există unul;
  - fereastra de bootstrap rămâne o limită documentată.
- **Sesiunea:**
  - cookie HttpOnly, SameSite=Strict, `Path=/api`; baza de date păstrează doar hash-ul token-ului;
  - expirare absolută după 8 h, închidere după 30 min de inactivitate;
  - pașii sensibili cer o reautentificare mai nouă de 5 min (activarea politicii, ridicarea autonomiei, autentificatoare, HIGH_AUTONOMY);
  - revocare: logout, „revocă toate sesiunile”, sau revocarea autentificatorului, care închide sesiunile lui.
- **Canalul `owner`:** command bus-ul refuză acest canal fără o sesiune rezolvată din bază (MU-01 prins). Comenzile care adaugă autoritate acceptă numai `owner`; cele care reduc activitatea acceptă orice canal al tău.
- **Activarea politicii voice-first:**
  - sesiune proaspătă + textul exact;
  - dezactivarea e fail-safe din orice canal, inclusiv vocea;
  - politica e versionată (`OWNER_POLICY_VERSION = 1`).

**NIST SP 800-63B-4:** comparația biometrică a vocii nu e acceptată ca autentificator. În Hub, vocea nu e factor de autentificare și nu există „MFA prin voce”.

## 2. Filtrul vocal local: ce face și ce nu

**Flux:**
1. Microfonul, cu acordul browserului, intră într-un AudioWorklet.
2. Worklet-ul reține propoziția întreagă; în locul ei trimite liniște.
3. În pagină se calculează local un rezumat MFCC: 38 de numere, plus durata vorbirii, SNR și saturația.
4. Hub-ul primește rezumatul pe loopback (fără audio) și compară 1:1 cu profilul tău.
5. Rezultatul e MATCH, NON_MATCH, INSUFFICIENT_AUDIO sau UNCERTAIN.
6. Numai la MATCH propoziția e redată în pista care merge la GPT-Live; altfel e aruncată.

**Proprietățile filtrului:**
- **Poziția:** stă **înaintea transportului** Lega, nu doar înaintea uneltelor.
- **Acceptarea:** e per propoziție; un MATCH nu deschide microfonul pentru următoarea.
- **Modul strict:** întârzierea = durata propoziției + verificarea (măsurat ~150 ms pentru 3 s la 48 kHz) + redarea. Compromisul e afișat în panoul Lega.
- **Eșecul:** dacă filtrul e activat și nu pornește, Lega nu pornește nefiltrată.
- **Push-to-talk și textul:** rămân alternativa.

**Verificatorul livrat** (`mfcc-stats-baseline-v1`):
- e de **bază**, fără rate de eroare măsurate pe populație;
- calibrarea e leave-one-out pe mostrele tale;
- `eligibleForAuthority: false`: un MATCH nu autorizează nimic;
- scorul nu e afișat ca procent.

Un verificator mai bun (ECAPA/WeSpeaker local, ONNX) intră în spatele aceleiași interfețe, după aprobarea instalării.

**Semnale suspecte** (reduc rezultatul la UNCERTAIN sau NON_MATCH; nu certifică nimic):
- vocea Lega se aude în microfon: suprapunere cu nivelul redat sau corelația anvelopelor > 0,6;
- dispozitiv virtual sau loopback: eticheta pistei (CABLE, VB-Audio, Stereo Mix…);
- spectru tipic unui difuzor: lipsa energiei sub 200 Hz; euristică slabă.

**Ce nu detectează:**
- imitație, sinteză vocală de calitate, relay;
- provocarea cu frază aleatorie: are nevoie de transcriere locală (absentă), deci e **BLOCKED**, nu simulată.

**Confirmarea vocală a unei misiuni** cere ambele, verificate local: vorbitorul (MATCH) **și** fraza (transcriere locală). Transcrierea locală nu e instalată, deci pe ruta GPT-Live confirmarea vocală e **blocată**. Confirmi cu tasta Enter sau butonul din cockpit, în sesiunea ta. O transcriere făcută de provider poate deschide, arăta, planifica și opri; nu poate confirma și nu poate ridica autonomia sau dezgheța (M06-EN-05, EN-13, MU-08).

## 3. Datele și ce se păstrează

| Date | Unde | Retenție / ștergere |
|---|---|---|
| Cheia publică a autentificatorului | `owner_credentials` | revocare; niciodată cheia privată (nu există în Hub) |
| Sesiuni | `owner_sessions`, doar hash-ul token-ului | expiră; revocare |
| Profilul vocal (centroid MFCC) | `config.dataDir/voice/profile-<id>.json` (`.ifrim/private`), plus rândul de metadate `voice_profiles` | „Șterge profilul” șterge fișierul; re-înscrierea înlocuiește profilul vechi și șterge fișierul lui |
| Audio brut | nicăieri; mostrele de înscriere se calculează în browser și se suprascriu imediat | — |
| Decizii vocale | nu sunt scrise în jurnalul general (`/api/voice/verify` nu e o comandă jurnalizată) | — |
| Jurnalul comenzilor de înscriere | doar numărul de mostre | ca orice comandă |

Profilul e separat de memoria LLM (nu e în `memory_items`), nu pleacă de pe calculator și nu se actualizează automat din conversații.

## 4. Statusul pe niveluri

- `TRUSTED_SESSION_READY`: **cod gata, PASS_SIMULATED.** Autentificator software în Node (M06-TR-01…07) și autentificator virtual Chromium în UI-ul real (M06-UI-E2E-01). **NOT_RUN cu Windows Hello real:** îl înregistrezi tu, din Lega → Configurare.
- `VOICE_FILTER_VALIDATED_LOCAL`: **parțial, PASS_SIMULATED pe voci sintetice** (M06-VO-01…04). Nu e validat pe vocea ta (cere înscrierea ta) și nu are rate de eroare. Verificatorul de bază nu e eligibil pentru autoritate.
