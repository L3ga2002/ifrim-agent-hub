# M07 · Experiența proprietarului

Data: 2026-10-03. Hub `2.8.0-m07` pe `http://localhost:8011`.

## 1. Pornire

- **Dublu-click pe `Ifrim Hub V2.cmd`** (rădăcina proiectului). Pornește Hub-ul dacă nu rulează, ca proces separat de fereastră, și deschide `http://localhost:8011/#/lega`.
- Dacă intri pe `127.0.0.1:8011`, pagina te mută singură pe `localhost` (sesiunea Windows Hello e legată de `localhost`).
- Banner-ul de sus îți spune dacă pagina e mai veche decât serverul („Reîncarcă”). Până la reîncărcare, comenzile obișnuite sunt refuzate. Butoanele de oprire (Stop, Pauză, Taci, Oprește agentul, Îngheață, Preiau eu, Stop All) merg mereu.

## 2. Configurarea unică (făcută pe 2026-10-02)

Lega → Configurare arată pașii, calculați din starea reală:
1. **Pașii automați** (backup, inspecție, probă, atestare): butonul „Rulează pașii automați”, fără tine.
2. **Windows Hello**: înregistrat (o credențială, „Autentificatorul calculatorului”).
3. **Politica voice-first**: activată (v1), prin „Accept și activez (Windows Hello)”.
4. **Autonomia**:
   - „Factory Demo M07 (voce)” e TRUSTED;
   - Factory Demo A e ASSISTED (setat explicit), iar celelalte proiecte de test sunt ASSISTED implicit;
   - proiectele reale rămân OBSERVE.
5. **Profilul vocal**: 7 fraze ghidate, înregistrate pe microfonul ales (alegerea se ține minte), cu consimțământ.
   - Primele încercări au eșuat, pentru că liniștea domina. După reparația de decupare, consecvența a ajuns la 0,81.
   - Profilul se poate șterge oricând din același panou.

## 3. O misiune, de la cap la coadă

| Pas | Ce spui sau faci | Ce se întâmplă |
|---|---|---|
| 1 | „Hai să lucrăm la Factory Demo M07 (voce)” (scris sau spus lui Lega) | Cockpit-ul deschide proiectul, doar citire, din datele Hub-ului |
| 2 | În sesiunea vocală Lega, spui ce vrei construit; sau, fără Lega: Misiuni → „Lucrare de engineering” → „Pregătește misiunea” | Lega propune misiunea și o aprobi pe ecran (un click); misiunea se creează doar ca ciornă (SPEC_DRAFT), fără execuții |
| 3 | „Arată-mi înainte să faci” | Cardul planului: ce face, cu ce modele, limite, cost (abonamente incluse), ce nu face niciodată |
| 4 | Apeși „Confirmă cu vocea” și spui **„Da, execută planul”** | Hub-ul verifică întâi vocea (MATCH), apoi transcrie local. Planul pornește și granturile se derivă singure |
| 5 | nimic | Codex scrie; verificările, review-ul Claude, QA, preview-ul și E2E rulează în `ifrim-runner` |
| 6 | Decizia de livrare | Hub-ul nu acceptă și nu livrează niciodată singur |

**Confirmări după configurare: una pe plan** (pasul 4). Crearea misiunii (aprobarea propunerii Lega sau formularul din Misiuni) e un click care nu pornește nimic.

**Remedieri:**
- La TRUSTED, remedierile din limita de cicluri a planului nu mai cer nimic. Când limita e atinsă, misiunea se oprește și decizia e a ta: reiei cu un ciclu în plus sau oprești.
- La ASSISTED, fiecare remediere cere confirmarea diferenței, cel mult până la limita de cicluri a misiunii.

**Când reluarea e decizia ta:** orice oprire care îți cere decizia (o încercare în plus, un baseline care nu reproduce, o problemă de integritate, un export refuzat, limita de cicluri), o fereastră nouă de timp și sfârșitul unei pauze puse de tine. Un agent nu le mai poate decide în locul tău (corectat după revizie); poate relua doar o oprire de infrastructură sau o pauză pusă de el.

**Dovada vie** (2026-10-02, 22:48 UTC):
- segmentul `utt_murk0j9d_bbaa6f83cd`, transcriere „Da, execută planul.”, MATCH, consumat de planul `env_murk09m2_9d707406cf`;
- granturi derivate: Codex scriere și Claude doar-citire, câte 2 încercări.
- În D6, misiunea a fost creată de mine prin canalul agent, nu din propunerea Lega. Două reluări (după defectele reparate) au fost făcute tot de mine; detalii în `M07_LIVE_VALIDATION_RESULTS.md`.

**Alternative de confirmare, la fel de valide:** Enter sau butonul de pe card, în sesiunea Windows Hello. Dacă sesiunea s-a blocat, Windows Hello o redeschide.

**Când vocea refuză**, motivul apare în scris, pe cardul planului sau ca notificare (Lega nu îl rostește), și nimic nu pornește. Pe card, refuzul începe cu „Confirmarea vocală nu e valabilă: …” și se încheie cu „Confirmă cu tasta sau butonul, ori repetă „Da, execută planul”.”. Exemple:
- vocea nu e recunoscută: „Nu te-am recunoscut (UNCERTAIN: zonă de incertitudine); nimic nu a pornit.”;
- „Da?”: „am auzit o întrebare („Da?”), nu o confirmare”;
- „Da, dar nu porni”: „am auzit „Da, dar nu porni”, nu o confirmare clară a acestui plan”;
- două planuri în așteptare: „Care plan: „…” sau „…”?”.

## 4. Ce spui și ce face

| Spui | Rezultat |
|---|---|
| „Hai să lucrăm la ProDelivery” | Contextul proiectului, doar citire. Verificat 2026-10-02 prin rezolvitorul local și citirea cockpit-ului: git `main@9229618062`, 17 fișiere modificate, 246 neurmărite, nimic inventat, autonomie OBSERVE, „Spune-mi ce vrei să facem…” |
| „Arată-mi înainte să faci”, „Arată-mi înainte să fac”, „Doar arată-mi planul” | Planul, fără să pornească nimic |
| „Ce face Codex?” / „De ce e blocat?” | Starea reală a execuției și dovezile |
| „Arată-mi compania” | Harta (rețeaua companiei) |
| „Taci” / „Pauză” / „Oprește agentul” / „Îngheață proiectul” / „Oprește tot” / „Preiau eu” | Acțiunile de întrerupere |

Despre întreruperi:
- Butoanele lor din cockpit (Taci, Pauză, Oprește agentul, Îngheață, Preiau eu, Stop All) merg mereu, chiar și cu pagina mai veche.
- Aceleași fraze scrise sau spuse în cockpit trec prin `/api/owner/intent`. Cu o pagină mai veche sunt refuzate (409 UI_STALE) până o reîncarci.
- Într-o sesiune Lega deja pornită, serverul tratează direct „Oprește tot”, „Lega, pauză” (sau „Pune pe pauză”) și „Taci”. „Taci” doar liniștește vocea.

## 5. Ecranele Lega (întrebarea ta din 2026-10-03)

E aceeași Lega, în două vederi:
- **Cockpit-ul** (`#/lega`, ecranul de start din M06) pune în centru proiectul la care lucrezi. Arată:
  - fața Lega (Nucleu / Față / Hartă / Discret / Ascunde);
  - cardurile proiectului, deciziile și următorul pas;
  - butoanele de întrerupere.
- **Ecranul mare** (din M02) e compania ca rețea vie, pe tot ecranul, cu „Pornește Lega” jos. Îl deschizi:
  - cu **Alt+J**;
  - din butonul Lega din bara de sus → „Ecran complet”;
  - cu „Modul Lega” din Control Room.

**Propunere pentru promptul următor** (nefăcută): un buton „Ecran complet” direct pe cardul Lega din cockpit și/sau ecranul mare ca ecran de start, dacă îl preferi.

## 6. Vocea, pe două rute

- **Conversația cu Lega (GPT-Live, în cloud)** rămâne pentru dialog: e rapidă și naturală.
  - Cu filtrul vocal activ, fiecare propoziție trece întâi printr-o verificare locală și pleacă în cloud doar dacă Hub-ul a recunoscut vocea ta.
  - Ce spune altcineva nu ajunge în cloud.
- **Confirmarea** e mereu locală: verificare de vorbitor plus Whisper local, pe placa video, ~0,5–1,5 s.
  - Transcrierea OpenAI e text produs de un serviciu extern. Dacă ar putea aproba, oricine ar face acel serviciu să „audă” un „da” ar putea porni o execuție.
  - Local, Hub-ul leagă textul de segmentul tău verificat și de planul afișat.

**Microfonul nu se deschide niciodată singur, ci doar la un gest al tău:**
- când apeși „Confirmă cu vocea”, cât durează fraza (cel mult 6 s; se oprește la ~0,9 s după ce taci);
- când înregistrezi frazele profilului vocal sau „Probă” în Configurare;
- cât e pornită sesiunea Lega;
- cât ții apăsat butonul vocal din bara de sus, dacă activezi vocea în Setări → Voce (acum e oprită).

## 7. Ce nu s-a validat live în M07

- **O sesiune Lega cloud cu filtrul vocal** (0 din cele 2 sesiuni permise).
  - Filtrul e PASS_SIMULATED (M07-VO-04…06).
  - Confirmarea vocală locală e PASS_SIMULATED (M07-VO-07, M07-VO-10) și PASS_LIVE (D6).
- **Fața, harta, reluarea și „taci / pauză / oprește” rostite live:** PASS_SIMULATED în testele M06. Ecranele există și se afișează (capturile tale din 2026-10-03).
- **„Hai să lucrăm la ProDelivery” rostit de tine în cockpit-ul live:** nerulat. Am verificat rezolvitorul și cockpit-ul separat (PASS_LOCAL).
