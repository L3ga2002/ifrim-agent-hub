# M14 — Raport final: stabilizare, optimizare și acceptarea versiunii interne L3ga (2026-10-22)

Cod `2.17.0-m14`, migrarea 15 `m14-backup-owner` (aditivă), schema 15, API contract 19. Clona de lucru `C:\Users\mihai\m14-stage`,
ramura `claude/project-thread-ljsgik`. **Nu e încă live**: live rămâne `2.16.0-m13` până rulezi comanda de release. Detaliul tehnic:
`.ifrim/STAGE_2026-10-22_M14.md`; dovezile: `C:\Users\mihai\m14-evidence\`.

## 1. Ce poți cere și obține repetat din L3ga (`#/lega`)
- **Engineering (doar citire):** „Hai la Demo Livrare”, „Care e ultima livrare?” → livrarea §25 READY, pachetul acceptat de tine;
  „Arată-mi ce ai pregătit” → Camera de livrare; „Status”.
- **Sales:** „Arată-mi oferta” → oferta v2 aprobată intern (id + SHA), pregătirea și dosarul revizia 2 STALE **cu motivul**
  („statusul ciornei s-a schimbat (conținut aprobat)”) și continuarea disponibilă („Continuă pregătirea ofertei”); „Ce lipsește din ofertă?”.
  Nu se face automat revizia 3 și starea nu se schimbă.
- **Birou intern:** „Arată dosarul de pornire OPS-0001”, „Arată cazul de suport SUP-0001”, „Arată devizul DVZ-0001”, doar „OPS-0001”,
  „Arată devizul”, „Ce lipsește din devizul DVZ-0001?”, „Arată dosarul OPS-0001 și devizul DVZ-0001” → starea, motivul, decizia care te
  așteaptă, exportul și următoarea acțiune; înregistrarea se deschide și se marchează în panoul „Birou intern”. Nu se creează nimic.
  Un număr inexistent îți oferă alegerile existente.
- **Continuitate:** conversația și textul netrimis rămân după reîncărcare (în browserul tău; se șterg când blochezi sesiunea); proiectul și
  înregistrarea deschisă rămân; Nucleu / Față / Hartă și „Ecran complet” nu pierd nimic.
- **Oprire:** Stop All, Pauză, Oprește agentul, Îngheață și Preiau eu sunt pe ecran în toate modurile; pe ecran îngust (telefon) bara e fixă
  jos, Stop All primul, iar confirmarea Stop All acoperă tot ecranul.

## 2. Scenarii demonstrate și măsurători
- **Live, doar GET (16:58–17:35 UTC):** cele trei circuite găsite din înregistrările existente (§25 READY + OWNER_ACCEPTED; oferta v2
  APPROVED_INTERNAL; dosarul rev. 2 STALE continuabil; OPS/SUP/DVZ READY cu următoarea acțiune). Hub-ul live: repaus 0,05 % dintr-un nucleu,
  132 MB; citirile ecranului 2–18 ms (`/api/state` mediană 18 ms). Încărcarea PC-ului în acel moment 77–91 % (regresia rula).
- **Hub sintetic (browser real):** ecranul `#/lega` pornește în 1,11 s (mediană, 5 rulări); o citire apare în conversație în 0,31 s;
  un card de plan în 0,41 s; pe server o citire 8 ms, detaliul unei înregistrări 5 ms; Hub-ul în repaus 1,2 % dintr-un nucleu, ~160 MB.
  Niciun blocaj observabil; nu am inventat praguri.
- **Reîncărcare / repornire (hub-uri sintetice):** conversația, textul, proiectul și înregistrarea revin; o repornire cu dosarul READY și
  aprobarea devizului **decisă dar neexecutată** păstrează tot (nicio reexecutare, niciun eveniment scris de pornire), iar decizia se
  execută apoi o singură dată, cu exportul o singură dată.
- **Backup întrerupt:** la pornire, proprietarul înregistrat decide: proces dispărut → „întrerupt”; instanță vie → neatins; incert → „proprietar
  necunoscut (nu e backup)”. Fișierele rămase sunt listate, nu șterse.
- **RM-10:** nereprodus (3/3 PASS singur la 72–83 % CPU; tastarea max 684 ms față de plafonul 880 ms) și trecut în regresia completă la 84 %
  încărcare medie. Eșecul istoric e refuzul corect al produsului la suprasarcină, nu un defect demonstrat; nimic slăbit.
- **Telefon:** rezoluție simulată 390×844 și 820/1000 px în Chromium. Nu e o probă pe dispozitiv fizic (Hub-ul ascultă doar pe 127.0.0.1).
- **Regresie completă** pe codul final `8368a78`, clonă nouă: **V2 2608/2609 PASS, 0 FAIL, 1 SKIP (T25)**; **V1 552/553 PASS, 0 FAIL, 1 SKIP**.

## 3. Probleme reparate
1. „Deschide cazul de suport SUP-0001” crea un caz nou; „Arată devizul DVZ-0001” arăta oferta; „Arată cazul…” nu era înțeles.
2. Dosarul ofertei STALE nu spunea de ce.
3. Ghilimeaua finală rămasă în cererea Support (cazul SUP-0001 existent rămâne neschimbat și e găsit în continuare).
4. Conversația L3ga se pierdea la reîncărcare.
5. Selectorul de proiect dispărea sub 1100 px.
6. Pauză / Preiau eu / Stop All ajungeau sub ecran pe telefon.
7. Backup-ul întrerupt rămânea „în curs” pentru totdeauna.
8. Cele 2 teste V1 citeau registrul tău real (și scriau un backup al folderului Hub + foldere `.env.hub016-*` în el).
Plus 10 corecții din două review-uri independente (dialogul Stop All pe telefon, suprapunerea barei cu navigația / indicatorul /
notificările / bara laterală, ștergerea conversației la blocare, mai multe file, focus vechi, butoane expirate, citiri cu „pentru …” și
„Da, …”, două numere într-o întrebare, semnul de inch, rezultatul târziu al unui backup).

## 4. Componente active și retrase
- **Active:** V2 Hub (8011, task `\Ifrim Agent Hub V2`); OpenClaw gateway (18789, legătură activă spre Telegram — separat de V1/V2).
- **Pregătit pentru retragere reversibilă (o rulezi tu):** V1 — task `\Ifrim Agent Hub` (tray) + API 8004 + UI 3004; nefolosite din 29.09
  (singurul client al 8004 e verificarea tray-ului; V2 nu depinde de V1). `m14-evidence\v1-retire\retire-v1.ps1` / `revert-v1.ps1`.
  Baza V1 rămâne pe loc (backup-urile V2 o includ).
- **Păstrate, cu statut:** n8n (5678, fără clienți, posibil folosit de OpenClaw — neconfirmat), Opportunity Monitor (inactiv), taskul
  DisplayFusion (duplicat, în afara V1/OpenClaw).

## 5. Limite păstrate
- Fluxurile Sales și Birou intern rămân **sintetice**; trimiterea / publicarea / contactarea reală rămân **dezactivate** (OUTREACH_DISABLED).
- **Profilul local de dezvoltare** rămâne activ: deciziile se înregistrează `local_dev_profile`; oricine folosește browserul pe acest PC cât
  timp e activ decide ca tine. Windows Hello rămâne decizia ta.
- Conversația păstrată e doar în browserul acestui PC; Hub-ul nu e accesibil din rețea.

## 6. Intervenții tehnice încă necesare (ale tale)
1. Comanda de release: `C:\Users\mihai\m14-evidence\release\owner-release.cmd` (o singură comandă, se oprește la eroare, push inclus).
2. Verificarea zilnică din L3ga după instalare (`m14-evidence\PASII_PROPRIETAR.md` §2).
3. Opțional: retragerea V1 (un script, reversibil).

## 7. Lista scurtă pentru acceptarea versiunii interne (o bifezi tu)
- [ ] Release-ul a rulat cu „VERIFY OK” și push făcut.
- [ ] „Arată dosarul de pornire OPS-0001”, „Arată cazul de suport SUP-0001”, „Arată devizul DVZ-0001” deschid înregistrările existente, fără nimic nou.
- [ ] „Arată-mi oferta” explică de ce dosarul revizia 2 e STALE și ce poți face.
- [ ] „Care e ultima livrare?” pe Demo Livrare arată §25 READY.
- [ ] După F5 conversația e tot acolo; Stop All e vizibil în toate modurile.
- [ ] Decizi separat: retragerea V1, OpenClaw, profilul local.
Acceptarea e a ta; nu o declar eu și nu adaug alte milestone-uri.

## Acceptare
**M14 acceptat de proprietar** pe 2026-10-24 la 23:26 ora României („accept si m14”), separat de M15 (acceptat la 23:25). Live la acel moment: 2.18.1-m15.
