# M09 · Drepturi media și capabilitățile platformelor

Data: 2026-10-04. Cod `2.10.0-m09` (necomis). Acoperă ce cerea §38 ca ASSET_RIGHTS și PLATFORM_CAPABILITIES (adaptat: un singur document), plus §13–§14 și §24–§27 din promptul M09.

**Regula de bază:** nimic din M09 nu încarcă, nu publică, nu programează extern și nu filmează ecranul tău. Stările implicite sunt `AUTO_PUBLISH=OFF`, `LIVE_UPLOAD_DISABLED`, `LIVE_MEDIA_CAPTURE_DISABLED` (`settings.mediaPolicy`). Sunt verificate de teste: IN-02, DS-13.

## 1. Biblioteca media

**Unde stau fișierele:**
- `<dataDir>/v2-media`, adică `C:\Users\mihai\IfrimHub\hub-data\v2-media` pe Hub-ul live, prin pointer. Nu sunt nici în repo, nici în OneDrive;
- lucrul temporar stă în `<workDir>/media`.

**Numele fizice** vin din hash sau din id (`originals/<sha[0..2]>/<sha>.<ext>`), niciodată din numele fișierului importat. Căile sunt rezolvate de modulul `paths`, care refuză:
- orice e în afara rădăcinii;
- linkurile simbolice și junction-urile.

**Importul:**
- doar din folderele permise (`media.policy.import_roots`, decizia ta). Implicit, cât timp nu e setat nimic, e permis doar `%USERPROFILE%\Videos`. Nu se poate alege un folder în repo, în datele Hub-ului sau deasupra lor;
- un folder de pe alt disc e acceptat (corectura R12, test RF-03);
- căile UNC sunt refuzate textual, înainte de orice acces la disc (review R16).

**Încărcarea din browser** (`POST /api/media/upload`):
1. Fișierul vine în flux spre folderul de lucru, fără să fie ținut în memorie.
2. E importat de aceeași comandă validată: hash, tip detectat din conținut, ffprobe.
3. Fișierul temporar e șters întotdeauna, inclusiv la refuz sau la abandonul clientului.

Corecturi R10/R15, test RF-02.

**Originalele sunt imuabile:**
- crop-urile, redactările, subtitrările și randările sunt derivate legate de sursă (`derived_from_json`);
- același hash refolosește fișierul, dar creează un rând nou, cu contextul și drepturile proprii.

**Spațiul pe disc:**
- cota și rezerva liberă sunt verificate înainte de randare;
- curățarea atinge doar derivatele regenerabile și pornește implicit ca simulare (`dryRun`);
- originalele și copiile A3 nu se șterg niciodată.

**Căutarea** întoarce intervale cu timecode din transcriere, markeri și metadate. Nu există index cloud și nici embeddings.

## 2. Drepturi

**Originea și dreptul efectiv sunt separate:**
- originea: `OWNED`, `LICENSED`, `CLIENT_PROVIDED`, `AI_GENERATED`, `UNKNOWN`;
- dreptul efectiv: `PENDING`, `CLEARED_FOR_SCOPE`, `RESTRICTED`, `EXPIRED`, `REVOKED`.

Un drept are titular, document, platforme, perioadă, teritoriu, uz (organic/plătit), atribuire și restricții.

**Evaluarea** (`rights.evaluate`):
- `UNKNOWN` nu intră în exportul final;
- un drept e valabil doar dacă e `CLEARED_FOR_SCOPE`, pentru platforma și uzul cerute, în fereastra de timp;
- `CLIENT_PROVIDED` folosit public cere acord de marketing;
- `AI_GENERATED` sau eticheta `GENERATED` cere declarare (disclosure);
- derivatele moștenesc: toate sursele trebuie să fie permise.

**Revocarea** (`media.rights.revoke`) e fail-safe și disponibilă pe orice canal al tău, inclusiv vocea și telefonul:
1. Întoarce inventarul a tot ce e afectat: derivate, versiuni de montaj, variante, randări, manifeste, încercări de publicare.
2. Întoarce un plan de corectare: refă, înlocuiește clipul, aruncă pachetul, retrage manual postarea de pe platformă.
3. **Nu șterge nimic.**
4. **Reverifică imediat fiecare manifest aprobat** care folosește materialul: manifestul devine INVALIDATED, iar pachetele lui deschise sunt retrase.

Prima versiune a acestei reverificări (corectura R6) nu rula niciodată, din cauza unei citiri greșite a rezultatului revocării. Testul RF-07 a prins asta, iar codul e reparat.

**Înregistrarea manuală a unei postări:**
- reverifică întâi manifestul (corectura R5, test DS-16);
- o postare făcută **înainte** de retragerea pachetului se poate înregistra, dar doar cu momentul postării spus explicit;
- dovada spune `recordedAfterWithdrawal`, cu data și motivul retragerii;
- o postare „acum”, de după retragere, e refuzată.

**Muzica pe platforme:** M09 nu are muzică. Masterul rămâne fără muzică specifică unei platforme.

**QA-ul de drepturi** semnalează riscuri, nu e o garanție juridică.

## 3. Profilurile platformelor (variante)

`PLATFORM_PROFILES` (versiunea 1) sunt **estimări interne**: `source: "estimare internă — verifică regulile actuale"`, `verifiedAt: null`. Nu sunt reguli confirmate ale platformelor.

| Cheie | Canvas | Zona sigură (sus · jos · stânga · dreapta) | Durată max (estimare) |
|---|---|---|---|
| `reels_9x16` | 1080×1920 | 0,14 · 0,22 · 0,06 · 0,14 | 90 s |
| `tiktok_9x16` | 1080×1920 | 0,12 · 0,24 · 0,06 · 0,15 | 600 s |
| `shorts_9x16` | 1080×1920 | 0,10 · 0,20 · 0,06 · 0,13 | 180 s |
| `youtube_16x9` | 1920×1080 | 0,06 · 0,10 · 0,05 · 0,05 | — |
| `x_16x9` | 1920×1080 | 0,05 · 0,10 · 0,05 · 0,05 | 140 s |
| `x_1x1` | 1080×1080 | 0,05 · 0,10 · 0,05 · 0,05 | 140 s |
| `linkedin_1x1` | 1080×1080 | 0,05 · 0,10 · 0,05 · 0,05 | 600 s |
| `linkedin_4x5` | 1080×1350 | 0,06 · 0,10 · 0,05 · 0,05 | 600 s |

**O variantă** (`deriveVariant`):
- reîncadrează fiecare clip în jurul zonei de interes (`focus`);
- păstrează mișcarea camerei a masterului în coordonatele sursei;
- mută textele și subtitrările în zona sigură;
- poate avea alt hook, alt CTA și altă durată;
- nu taie zonele de dovadă: altfel apare un finding.

**Corecturi după review:**
- **R17/R21:** fereastra de încadrare a variantei nu era centrată pe zona de interes ca la randare, iar keyframe-urile se mutau greșit;
- **R18:** subtitrările variantei nu purtau zona sigură a platformei până în fișierul ASS (test RN-13b);
- **R22:** lățimea textelor era subestimată (test QA-02);
- **R20:** o corectură aplicată pe o variantă nu muta varianta pe versiunea corectată (test QA-16).

## 4. Registrul platformelor (ce se poate face azi)

Statusuri posibile: DOCUMENTED, NEEDS_AUTH, NEEDS_REVIEW, VERIFIED_LIVE, ASSISTED_ONLY, COST_BLOCKED, POLICY_UNSUPPORTED, NOT_TESTED. **Nimic nu e VERIFIED_LIVE** (test DS-01).

| Platformă | Pachet manual | Upload prin API | Programare | Metrici |
|---|---|---|---|---|
| Instagram | ASSISTED_ONLY | NEEDS_AUTH (cont profesional, aplicație Meta aprobată, token) | NOT_TESTED | NEEDS_AUTH |
| TikTok | ASSISTED_ONLY | POLICY_UNSUPPORTED (Direct Post cere audit; până atunci postările sunt private) | — (schiță în inbox: NEEDS_REVIEW) | NOT_TESTED |
| YouTube | ASSISTED_ONLY | DOCUMENTED (`videos.insert`; proiectele neverificate încarcă privat) | DOCUMENTED (`publishAt`) | DOCUMENTED (Analytics API) |
| X | ASSISTED_ONLY | COST_BLOCKED (plan plătit, fără buget aprobat) | — | COST_BLOCKED |
| LinkedIn | ASSISTED_ONLY | NEEDS_REVIEW (produs aprobat de LinkedIn) | — | NEEDS_REVIEW |

**Calea reală în M09 este pachetul manual:**
1. Manifestul fixează conturile, hash-urile video/caption/copertă, declararea AI și programul (Europe/Bucharest, cu DST explicit).
2. Aprobarea manifestului se face doar din sesiunea ta de proprietar, cu re-autentificare proaspătă.
3. Aprobarea cere:
   - o randare finală;
   - QA fără FAIL, **legat de fișierul exact randat** (corectura R19: un QA PASS pe alt fișier nu mai contează);
   - drepturi valabile pe fiecare platformă.
4. Orice schimbare invalidează aprobarea: caption, copertă, cont, variantă, program, fișier.
5. Pachetul conține video, `caption.txt`, coperta, `checklist.md` (declarare, drepturi, pași) și `manifest.json` cu hash-uri. E idempotent, iar o modificare a lui e refuzată.
6. Tu postezi manual. Hub-ul înregistrează URL-ul validat pentru platformă, cu dovada manuală.

`apiRelease` refuză întotdeauna în M09 și listează exact condițiile lipsă (test DS-13).

**Programarea:** o programare scadentă nu pleacă singură (`AUTO_PUBLISH=OFF`). Devine `MISSED_NEEDS_DECISION`, iar o repornire nu trimite niciodată un backlog (test DS-12).

**Rezultatul incert:** `OUTCOME_UNKNOWN` se rezolvă doar prin interogare (published / not_found / unknown / token expirat → NEEDS_AUTH), niciodată prin a doua postare (test DS-09).

## 5. Metrici

`METRIC_REGISTRY` are definiții pe platformă: unitate, granularitate, latență, sursă și disponibilitate (`documented` doar la YouTube; restul „de verificat”).

Importul manual CSV:
- o celulă lipsă devine NULL, cu motiv, niciodată 0;
- definițiile nu se amestecă între ele;
- datele de test sunt etichetate (test DS-14).

Experimentele sunt preînregistrate cu hash și imuabile. Sub eșantionul minim sau cu date lipsă rezultatul e INCONCLUSIVE (test DS-15).

**ANALYTICS_CONNECTED: NU.** Nu există date reale.
