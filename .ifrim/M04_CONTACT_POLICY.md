# M04 — Politica de contact (Vânzări)

Versiune: `2.5.0-m04` · 2026-10-01 · Stare: **DRAFT_ONLY / OUTREACH_DISABLED**

## 1. Pe scurt

În M04 Hub-ul **nu trimite nimic** nimănui. Poate pregăti propuneri și ciorne de mesaj, pe care le revizuiești și le aprobi tu. Trimiterea reală e dezactivată (`OUTREACH_DISABLED`).

Activarea ei cere:

1. configurarea unui canal (Gmail, SMTP etc.). Asta nu se face în M04: nu e conectat niciun cont, inbox sau calendar;
2. o autorizare separată, explicită, a proprietarului;
3. revizuirea legală a textelor (GDPR, informarea, opoziția).

Singurul transport care „trimite” este unul **fals**. Există doar în hub-urile de test (`testMode`) și nu folosește rețeaua.

## 2. Pașii unui contact

1. **Propunere** (`sales_proposals`):
   - e versionată și generată din oportunitate și catalog;
   - o versiune nouă face propunerea veche `SUPERSEDED`, invalidează aprobările vechi și ciornele legate de ea;
   - un hand-off făcut deja devine „depășit”.
2. **Aprobarea internă a propunerii:**
   - e o aprobare explicită (`sales.proposal_approve`, ALWAYS_ASK);
   - e legată de hash-ul exact al conținutului afișat;
   - doar ea duce oportunitatea în `APPROVED_INTERNAL`.
3. **Ciorna de mesaj** (`sales_drafts`):
   - e generată doar din **ultima** versiune a propunerii și doar după aprobarea ei internă;
   - dacă propunerea se schimbă după ciornă, ciorna nu mai poate fi aprobată sau trimisă;
   - nu se fac ciorne pentru oportunități `WON` sau `LOST`;
   - fără audit, nu spune „am analizat site-ul”;
   - lista `claimsToVerify` arată ce trebuie confirmat.
4. **Aprobarea conținutului ciornei:**
   - o aprobare separată (`sales.draft_content`), legată de hash-ul textului;
   - orice modificare a ciornei cere o aprobare nouă.
5. **Trimiterea:**
   - `OUTREACH_DISABLED` în producție;
   - în teste:
     - doar ciorne aprobate și nemodificate;
     - o cheie de idempotență: dublu-clic înseamnă un singur mesaj;
     - o ciornă are cel mult o trimitere deschisă (`ATTEMPTED` sau `DELIVERED`), chiar și cu chei diferite din două taburi. Regula e garantată și de un index unic în baza de date;
     - o trimitere rămasă `ATTEMPTED` după o oprire blochează retrimiterea, fiindcă nu se știe dacă a plecat;
     - contactul ciornei trebuie să fie încă activ;
     - starea `SENT` apare doar când transportul confirmă `DELIVERED`.
6. **Contactul în afara Hub-ului:** îl înregistrezi tu, cu textul exact
   „Confirm că am contactat această firmă în afara Hub-ului”.
   Fără acest text, oportunitatea nu trece în `CONTACTED`.
7. **Acceptarea clientului:** o înregistrezi tu, cu textul exact
   „Confirm că clientul a acceptat această propunere”.
   Condiții:
   - ultima propunere aprobată;
   - un contact real înregistrat (trimis prin Hub sau înregistrat manual). `IN_DISCUSSION` cere și el un astfel de contact, deci ocolul prin `ON_HOLD` nu mai merge.

   Doar atunci oportunitatea devine `WON`.
8. **Hand-off către Inginerie:**
   - creează o misiune `eng_feature` cu specificația Software Factory în stadiul `SPEC_DRAFT`, în proiectul ales de tine. Fără proiect, se înregistrează doar pachetul;
   - e idempotent: aceeași versiune acceptată se predă o singură dată (alt tab sau dublu-clic dau același hand-off);
   - fără grant, fără rulare de model și fără pornire automată.

Stările `APPROVED_INTERNAL`, `CONTACTED` și `WON` nu se pot seta manual. Se ating doar prin evenimentele de mai sus.

## 3. Nu contacta (`DO_NOT_CONTACT`)

O firmă intră în `DO_NOT_CONTACT` când:

- o marchezi tu (inclusiv din voce, prin Lega);
- se înregistrează o opoziție (`OPT_OUT`).

Suprimarea se aplică după:

- organizație, inclusiv firmele unite cu ea, în ambele sensuri;
- cod fiscal;
- domeniul site-ului, oricare ar fi pagina (și un articol sau un blog de pe același domeniu);
- e-mail și domeniul e-mailului. Domeniile de webmail (gmail, yahoo etc.) nu sunt domenii de identitate, deci nu se blochează toți utilizatorii lor.

Verificarea se face la fiecare pas spre exterior:

- oportunitate, ciornă, aprobarea ciornei;
- trimitere;
- follow-up și reluarea lui;
- contact manual;
- decizia pe un rând de import luată mai târziu.

Efecte:

- nu se mai pot crea ciorne sau trimiteri, iar follow-up-urile se anulează;
- o firmă suprimată reimportată (sub alt nume, cu același CUI, domeniu sau doar cu un e-mail pe domeniul ei) intră ca `SUPPRESSED`;
- schimbarea stării firmei e blocată. Un audit terminat după suprimare nu o mai suprascrie;
- o unire cu o firmă suprimată suprimă ambele firme. Interdicția rămâne și după anularea unirii.

Ridicarea suprimării:

- cere o aprobare separată (`sales.suppression_lift`, ALWAYS_ASK) și un motiv;
- se aplică întregii familii de firme unite;
- e refuzată dacă firma nu e suprimată;
- firma trece în `ON_HOLD`, nu direct în contact.

## 4. Follow-up-uri

- Se pot programa doar:
  - după un **contact real** înregistrat (`last_contact`);
  - sau la o dată explicită aleasă de tine.
- Scheduler-ul doar marchează `SCHEDULED → DUE`, apoi `DUE → EXPIRED` după 14 zile. **Nu trimite nimic** și nu creează ciorne singur.
- Un răspuns înregistrat (`REPLY_RECORDED`) suspendă follow-up-urile.
- O opoziție le anulează.
- Același follow-up (aceeași oportunitate, aceeași dată) nu se creează de două ori.

## 5. Ce nu face Hub-ul în M04

- Nu caută firme pe internet și nu colectează date live (`LIVE_COLLECTION_DISABLED`).
- Nu trimite e-mailuri, SMS-uri sau mesaje.
- Nu se conectează la Gmail, SMTP, calendar sau inbox și nu citește mesaje.
- Nu inventează prețuri, termene, rezultate sau referințe.
- Nu pretinde că a analizat un site fără un audit salvat.
- Nu aprobă nimic în numele tău. Vocea nu aprobă operații sensibile.

## 6. Înainte de activarea trimiterii reale (după M04)

- [ ] Temei legal documentat pentru contactarea B2B (interes legitim) și textul de informare GDPR.
- [ ] Mecanism de dezabonare în fiecare mesaj, legat de `OPT_OUT`.
- [ ] Canal configurat de proprietar; credențialele nu trec prin Hub sau prin modele.
- [ ] Limită de volum per zi, plus jurnalul trimiterilor (`sales_sends`, există deja).
- [ ] Autorizare explicită a proprietarului pentru activare.
