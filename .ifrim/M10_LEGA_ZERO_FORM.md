# M10.1 — Lega pornește dintr-un click (fără mod, poartă manuală sau grant)

Data: 2026-10-04 · cod `2.11.1-m10` · contract API 10 (neschimbat) · fără migrare · **comis în `72d6964`** (push: `git push origin v2-milestone-01`, îl rulezi tu) · **Hub-ul live rulează `2.11.1-m10` din 2026-10-04 18:12 UTC**. Upgrade-ul l-a făcut Claude, la aprobarea ta („abrob upgrade la 2 11 1”): `upgrade.mjs --apply`, rularea `upg_muu51x09`.

## Problema

Vocea Lega cerea, înainte de fiecare pornire:
- modul `LIVE_VALIDATION`;
- un grant „Lega (voce)” creat de mână în Integrări → Validare live.

Ai cerut: „nu pot porni vocea iar trebuie să pornesc granturi și etc nu mai vreau așa ceva”.

## Ce s-a schimbat

**Calea nouă (politica voice-first activă, sesiunea de proprietar deschisă):**

1. Apeși „Pornește Lega” (în panou, pe ecranul complet sau în cockpit), sau scrii / spui „Pornește Lega”.
2. Dacă sesiunea nu e deschisă (sau a expirat), browserul cere **o singură dată** Windows Hello / cheia ta.
3. Hub-ul derivă singur autorizarea, **doar pentru acea sesiune vocală**:
   - un grant de voce Codex, doar citire, pe proiectul Hub;
   - grantul se creează și i se consumă singura încercare în **aceeași tranzacție**, deci se naște epuizat: nicio altă pornire și nicio execuție nu-l poate folosi;
   - durata e cel mult min(30 min, „durata maximă a sesiunii” din setări, timpul rămas din sesiunea de proprietar − 20 s);
   - sub un minut rămas, cere redeschiderea sesiunii;
   - la finalul sesiunii vocale grantul se revocă, cu evenimentele de audit `lega.authority_derived` / `lega.authority_released`.
4. **Modul Hub-ului nu se schimbă** (rămâne BUILD_SAFE). `envelopeModeHold` nu se atinge. Execuțiile cu model rămân refuzate în BUILD_SAFE: autorizarea derivată e doar pentru voce.

**Ce verifică poarta în continuare, neschimbat:**
- poarta de execuție (după Stop All rămâne suspendată și o redeschizi tu);
- acordul Lega;
- declarația de abonament Codex;
- configurația realtime;
- izolarea;
- circuit breaker-ul;
- o singură sesiune;
- concurența.

Autorizarea derivată nu ocolește niciuna dintre ele.

**Limite:** cel mult 6 porniri derivate în 15 minute pentru o sesiune de proprietar. Numărul se citește din audit, deci o repornire a Hub-ului nu îl resetează. Panoul arată limita înainte de click (verificarea `derived_rate`).

**Calea veche** (fără sesiune de proprietar, sau politica `legacy`): LIVE_VALIDATION + un grant „Lega (voce)” de mână. A rămas neschimbată, cu o singură diferență, descrisă mai jos.

**Sesiunea de proprietar aproape de sfârșit:**
- O reautentificare în ultimele 10 minute ale sesiunii (de 8 ore) deschide acum o **sesiune nouă**, cu cookie nou și durată completă.
- Sesiunea veche se închide, auditat cu `owner.session_ended`, motivul `rotated`.
- Înainte se reînnoia aceeași sesiune, iar „redeschide sesiunea” nu ajuta: două cereri Windows Hello și același refuz.
- Mai departe de sfârșit, reautentificarea reînnoiește aceeași sesiune, ca până acum.
- Ce era legat de sesiunea veche se oprește, ca la expirarea ei naturală, dar cu cel mult 10 minute mai devreme: o sesiune Lega derivată, un plan de operare care rulează (trece pe NEEDS_OWNER) sau continuarea unui plan.

**Durata vocii derivate** e fixată la derivare (`authorityEndsAt`), nu numărată de la conectare. Vocea nu poate depăși sesiunea de proprietar nici dacă negocierea WebRTC durează.

## Ce oprește o sesiune pornită din sesiunea ta

- Stop All și revocarea acordului („Taci” oprește doar sunetul, ca înainte);
- închiderea sesiunii de proprietar (logout), „revocă toate sesiunile”, revocarea autentificatorului;
- expirarea sesiunii din inactivitate sau din durata maximă (verificată la fiecare ~15 s și înaintea fiecărei unelte Lega);
- dezactivarea politicii voice-first;
- retragerea declarației de abonament Codex;
- o schimbare explicită de mod (de exemplu înapoi la BUILD_SAFE din Integrări).

Eliberarea modului de către un plan (sursa `envelopes`) **nu** oprește o sesiune derivată: ea nu depindea de LIVE_VALIDATION. Pe calea veche o oprește în continuare.

**Schimbare deliberată pe calea veche:** retragerea declarației Codex oprește acum vocea și acolo. E mai sigur: o pornire nouă ar fi oricum refuzată.

## Reguli de securitate păstrate

- Autoritatea vine **doar** din sesiunea de proprietar rezolvată de server (cookie HttpOnly pe canalul `owner`). Canalele `voice`, `companion`, `agent` și `cli`, precum și un `ownerSession` falsificat, nu derivă nimic.
- O transcriere de provider nu pornește și nu confirmă nimic. „Pornește Lega” e o intenție de tip `effect`: din vocea providerului e refuzată. Dacă Lega rulează deja, răspunsul e doar „Lega e deja pornită.”. Pe server intenția doar verifică (nu scrie nimic). Pagina pornește vocea cu microfonul ei și cu cookie-ul tău.
- Nicio regulă specială după canal=voice, actor=owner sau isTest.
- Gărzile de facturare (`billing.mjs`, `billing-evidence.mjs`, `providers/claude.mjs`) și `gate.evaluate()` pentru execuții sunt neatinse.
- Nimic nu pornește la boot. `recover()` doar închide în audit o autorizare derivată rămasă de la un proces căzut (revocă grantul, `reason: "hub-restart"`).
- Căutarea pe internet: pornirea trimite modul pe care l-ai văzut (panoul sau răspunsul din cockpit). Dacă setarea s-a schimbat între timp, Hub-ul refuză cu `LEGA_TERMS_CHANGED`. Modul `live` nu pornește niciodată nevăzut: panoul se deschide și ceri pornirea cu încă un click.

## Fișiere

| Fișier | Ce face |
|---|---|
| `v2/server/runtime/lega.mjs` | `resolveAuthority`, `preview` (nu aruncă, nu scrie), limita derivată, grantul născut epuizat, revocarea la final, ascultătorul (sesiune / politică / facturare / mod), `tick`, `recover` |
| `v2/server/hub.mjs` | `legaOwnerAuthority(sessionId, { assumeTouched })`: sesiunea validă, ne-inactivă, autentificator activ, politica voice-first; tick-ul planificatorului și `recover` la boot |
| `v2/server/policy/gate.mjs` | `evaluateVoice({ ownerAuthority })`: modul și `voice_grant` sunt satisfăcute doar cu autoritate derivată |
| `v2/server/runtime/command-catalog.mjs` | `lega.session.start` pe canalele `ui` / `owner` / `test`; `ownerSessionId` doar din `ctx.ownerSession`; `expectWebSearch` |
| `v2/server/http/routes.mjs`, `owner/owner-routes.mjs` | `GET /api/lega` (previzualizare cu cookie-ul, fără să atingă sesiunea), `POST /api/lega/sessions` prin dispecerul owner (201) |
| `v2/server/owner/intents.mjs`, `owner-commands.mjs` | intenția `lega_start` (verificare, `legaStart: true` + `legaStartWebSearch`) |
| `v2/server/owner/trust.mjs` | rotirea sesiunii la reautentificare în ultimele `rotateMinutes` (10) minute |
| `v2/web/src/shell/Lega.jsx`, `lib/uiLogic.js`, `lib/legaLevels.js` | un click: întâi blocările reale, apoi Windows Hello dacă trebuie, apoi microfonul; motivul unui eșec apare ca toast și în panou |
| `v2/web/src/shell/Shell.jsx`, `screens/Integrations.jsx`, `screens/Lega.jsx` | eticheta „Lega activă”, explicația din Integrări (în funcție de politică), pornirea din cockpit |

## Verificare

- Designul a fost ales printr-un workflow (trei variante independente, cu judecători).
- Implementarea a trecut printr-un review multi-agent: 21 de constatări, 19 confirmate și reparate, 2 infirmate.
- Constatările reparate:
  - eșecul pornirii era invizibil când porneai din ecranul complet sau din cockpit;
  - blocările reale erau amestecate cu „mod / grant”;
  - previzualizarea nu ținea cont că click-ul reîmprospătează sesiunea;
  - limita de porniri nu apărea înainte de click;
  - verificarea căutării pe internet nu era efectivă pe căile fără panou;
  - eticheta și textul din Integrări nu țineau cont de politică;
  - „Deschide Lega” în timp ce rulează era refuzat în loc să răspundă;
  - opt teste erau prea slabe.
- **A doua rundă** (doar citire, adversarială; 19 agenți: 5 recenzori + încercări de infirmare) a confirmat 7 defecte noi, toate reparate:
  - *mediu:* pe ecranul complet, panoul și toast-ul apăreau **sub** scenă. Eșecul pornirii era invizibil, iar paza căutării „live” putea fi ocolită: panoul ascuns înregistra „live” ca văzut. Acum scena se închide la orice eșec, iar doar un panou vizibil înregistrează ce ai văzut;
  - sesiunea de proprietar aproape expirată nu putea fi redeschisă (vezi rotirea de mai sus);
  - eșecurile de după admitere (peer WebRTC eșuat, raportul de conectare eșuat) erau tăcute; acum apar la fel ca un eșec de pornire;
  - în timpul confirmării Windows Hello, o sesiune Lega pornită din alt tab putea fi adoptată și oprită ca a ta;
  - durata vocii derivate se număra de la conectare (vezi `authorityEndsAt`);
  - răspunsul „Pornesc Lega în sesiunea ta, cel mult 1 min” apărea și pe calea veche, cu grant;
  - două teste nu ar fi prins revenirea defectului (ZF-08 accepta „stopping”; ZF-11/12 comparau doar valoarea implicită).
- **Mutații:** 9 mutații (8 pe server și în logica UI, 1 în browser), fiecare readucând un defect reparat. Toate sunt prinse de teste.
- **Teste:**
  - `v2/tests/m10-lega-owner-start.test.mjs`: 16 teste (ZF-01…13, ZF-06b, ZF-08b, UI-01);
  - `v2/tests/m10-lega-stage-e2e.test.mjs`: 1 test în Chromium real, cu autentificator virtual (pornirea de pe ecranul complet: blocare reală și căutare „live”).
- Suita completă V2: **929 teste · 928 PASS · 0 FAIL · 1 SKIP** (detalii în `M10_TEST_REPORT.md` §6).

## Cum o activezi

**Gata din 2026-10-04 18:12 UTC.** Pașii de mai jos rămân pentru referință: așa se aplică un upgrade fără migrare. Hub-ul se repornește pe codul nou: UI-ul se reconstruiește, iar serverul se încarcă din nou.

```
node v2/scripts/upgrade.mjs --plan
node v2/scripts/upgrade.mjs --apply
```

Runner-ul verifică la final că Hub-ul servește `2.11.1-m10`.

După repornire:
1. Deschide `http://localhost:8011`.
2. Apasă „Pornește Lega”.
3. Confirmă o dată cu Windows Hello, dacă ți se cere.

Granturile „Lega (voce)” rămase de la calea veche nu mai sunt necesare. Le poți lăsa să expire.

## Upgrade-ul live (2026-10-04 18:12 UTC)

- **Aprobare:** „abrob upgrade la 2 11 1”.
- **Context:** PC-ul repornise la 21:07, ora României (18:07 UTC), iar Hub-ul nu mai rula. Atunci nu pornea singur după un reboot; acum îl pornește sarcina programată „Ifrim Agent Hub V2”, vezi RUNBOOK. Preflight-ul a raportat deci „upgrade offline”.
- **`node v2/scripts/upgrade.mjs --plan`:** dry run 10 → 10, nicio migrare, integrity ok, numărul de rânduri neschimbat.
- **`node v2/scripts/upgrade.mjs --apply`:** rularea `upg_muu51x09`, preflight → dry run → stop → build (UI + helper) → start → verify. DONE, versiunea `2.11.1-m10`, contract 10.
- **Starea verificată după pornire:**
  - BUILD_SAFE, poarta deschisă (motivul rămas din sesiunea anterioară: „Deschisă pentru validare live”);
  - 0 granturi active, 0 rulări, nimic în așteptare;
  - `recover()` Lega: 0 autorizări de închis;
  - acordul Lega înregistrat;
  - interfața servită conține textele noi.
- **`GET /api/lega` fără sesiune:** eșuează doar `mode` și `voice_grant`, adică în panou: „Pornește din sesiunea ta”, un click și Windows Hello. Facturarea, configurația realtime și izolarea trec.
- **Nu am pornit Lega și niciun model.** Pornirea vocii e click-ul tău, iar GPT-Live consumă din planul ChatGPT.
- **Setarea ta de căutare pe internet e „live” (risc mai mare).** Pornit de pe ecranul complet sau din cockpit, Lega deschide întâi panoul cu avertismentul și cere încă un click; din panou pornește direct. Pentru lucru zilnic, recomandarea din panou e „indexul OpenAI”.
