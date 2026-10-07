# M11 „Ifrim Delivery”: raport (2026-10-07)

Starea: **M11_BUILD_READY local**. Codul, testele și integrarea sunt făcute. Nimic din M11 nu e live. Pilotul și proba vocală așteaptă aprobarea ta (`.ifrim/M11_PILOT_SHEET.md`).

## Commituri locale pe `v2-milestone-01` (nepublicate)

| Commit | Ce conține |
|---|---|
| `f65f0d8` | Vocea: pre-roll în segmentare, prag absolut, clickuri ignorate, diagnostic local (fără audio stocat) |
| `cf29428` | Versiunea `2.13.2-m11` (doar vocea, fără migrare) |
| `5f3bea2` | U1 fixture-ul de programări detailing; U2 migrarea 12; protecția la repornire (`boot-guard.mjs`); U3 rezumatul comercial |
| `db58277` | U4 extensiile media; U5 legăturile din Factory și planurile derivate |
| `2a58e9d` | U6–U9: serviciul de livrare, planul unic, planificatorul Lega, camera de livrare, „Deciziile mele” |
| (următorul) | Cardul din cockpit, lista „terminat” corectată, versiunea `2.14.0-m11` / contract 13, documentele |

## Fluxul cerut, cum e acum

1. **Cererea naturală.** „Pregătește demo-ul … pentru prezentare … Nu publica nimic” devine un singur pas `delivery_prepare`. Frazele de detaliu intră în el, iar „nu publica” e o constrângere.
2. **Contextul.** Proiectul e cel numit sau deschis în cockpit. Dacă nu e niciunul, e singurul proiect de test cu șablon de livrare; altfel Hub-ul pune o singură întrebare. Un proiect real e refuzat în cuvinte simple.
3. **Un singur plan.** Planul de livrare (Outcome Contract) e compilat în plicul existent. `body.delivery` e inclus în hash și conține:
   - șablonul înghețat, pașii exacți și hash-ul lor;
   - preview-ul și capturile;
   - ce produce, ce nu face niciodată și ce decizii rămân ale tale.

   Planurile obișnuite au același hash ca înainte, până la ultimul byte.
4. **O singură confirmare.** Livrarea e armată în tranzacția confirmării. La DELIVERY_READY, planul ei e derivat din acea confirmare (`opsPlans.adoptDerived`), fără altă întrebare.
5. **Engineering, teste, review, QA, preview.** Software Factory e neschimbat. L5 e pasul 0 când lipsește testul.
6. **Captura, Content Studio, clipul.** Totul rulează fără model:
   - Chromium izolat, doar pe preview-ul verificat;
   - toate condițiile sunt verificate înainte de lansarea browserului;
   - snapshot verificat înainte și după captură;
   - bannerul de date sintetice e obligatoriu;
   - urmează montajul 16:9, randarea, varianta 9:16 și QA.
7. **Rezumatul comercial.** Are secțiunile cerute de tine:
   - problema;
   - ce demonstrăm;
   - cum funcționează;
   - beneficii;
   - ce nu putem afirma;
   - întrebări;
   - următorul pas.

   Un beneficiu apare doar dacă au trecut criteriile lui. Fără prețuri, ROI sau termene inventate (fact guard).
8. **Camera de livrare și „Deciziile mele”.** Fiecare artefact e legat de snapshot-ul exact. Cockpitul arată fraza Lega despre rezultat.
9. **Feedback-ul tău** reface doar componentele afectate. Graful de dependențe folosește snapshot și legături reale, nu timestamp.

## Dovezi (teste)

- `m11-delivery-flow` (184 s) rulează cap-coadă pe un Hub de test, cu providerii simulați și Chromium și ffmpeg reale:
  - o confirmare → READY, fără nicio rulare de model după DELIVERY_READY;
  - §24: se refac doar montajul, randarea, varianta, QA, exportul și secțiunea video;
  - T13: o editare de text dă doar o versiune nouă a rezumatului;
  - §25: diferența e arătată, nimic nu rulează;
  - T11: o schimbare în cod face totul STALE, varianta devine INVALIDATED, iar aprobarea rezumatului e refuzată.
- `m11-delivery-intake`: fraza ta → un singur card (misiune + livrare), 0 granturi, 0 schimbări de mod; un proiect real e refuzat.
- `m11-summary` 7, `m11-migration` 3, `m11-voice-segmentation` 9, plus suitele valului 0 (249 cu skip-urile eliberate).

### Cele două skip-uri M11

Testele M11-FX-13 și FX-14 așteptau înregistrarea fixture-ului, nu o probă a ta. Acum rulează: 249/249, 0 skip.

### Maparea T01–T20

| Test | Dovada |
|---|---|
| T01 | `m11-l5-pilot-fixes` |
| T02 | întrebarea planificatorului (`DI-02`, planner) |
| T03 | `adoptDerived` refuză orice altă listă de pași (`PLAN_DERIVED_CHANGED`) |
| T04, T05 | L5 și patch-ul de manipulare |
| T06 | M09, legarea modelului |
| T07 | `SU-03` |
| T08, T09 | `DF-01` |
| T10 | `SU-02` și `CLAIM_EVIDENCE_STALE` |
| T11–T14 | `DF-01` |
| T15 | `DF-01` și politica |
| T16 | Room-ul arată software „PENDING”; lista „terminat” din cockpit numără doar OWNER_ACCEPTED |
| T17 | „Deciziile mele” e doar citire |
| T18, T19 | M07/M10.2 și `VS-01…12` |
| T20 | `DI-02` |

## Vocea

Unde se pierdea vocea (măsurat live pe 6 oct.): 176 din 213 segmente au fost aruncate ca „audio insuficient”, înainte de verificarea vorbitorului.

Cauzele, confirmate pe semnale sintetice cu vechiul worklet:
- consoana inițială se pierdea complet (0% din „D”, „T”, „P”); acum se păstrează 98–100%;
- o voce încet era ignorată în primele secunde;
- un click deschidea segmente false.

Ce s-a schimbat:
- **segmentarea:** pre-roll de 300 ms, prag absolut de −70 dBFS, estimarea zgomotului urcă 2 dB/s, clickurile sub 80 ms de voce sunt ignorate;
- **verificarea vocii:** neschimbată (aceleași praguri, același profil).

Diagnosticul (Lega → Configurare → Voce):
- arată fiecare frază pe etape și scorul rotunjit, doar pentru tine;
- nu stochează audio și nu scrie rânduri;
- nu poate confirma, relua sau trimite nimic.

Fixul vocal e LIVE din 2026-10-07 16:01 UTC (`2.13.2-m11`, `upg_muyaojn4`). **M11_VOICE_READY: NU încă.** Cere proba ta.

## Ce NU e declarat

- **M11_DELIVERY_VERIFIED / M11_REVISION_VERIFIED / M11_ZERO_FORM_VERIFIED:** doar după pilotul live aprobat.
- **OWNER_ACCEPTED:** doar tu.
- **Nu e implementat** (alegeri din design lăsate pentru tine):
  - Room-ul nu are încă buton de aprobare creativă propriu: decizia rămâne în Studio;
  - legarea unui serviciu din catalog există pe server; în UI e butonul din Room;
  - revizia software (§25) propune planul de engineering, dar nu face încă automat o „livrare refresh” legată de părinte. După noul DELIVERY_READY spui din nou „pregătește demo-ul”, iar vechea livrare e deja STALE.
