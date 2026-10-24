# STAGE 2026-10-24 — M15 corecții finale și sesiune integrată de acceptare (2.18.1-m15)

Promptul proprietarului: 2026-10-24 19:35 ora României (thread „Închidere M15 prin utilizare reală”). Scop finit: două corecții de
prezentare a stării (R-STATE, R-ERROR), release-ul gestionat și sesiunea integrată deja prevăzută. Niciun milestone nou.

## 1. Baseline verificat (2026-10-24, ~19:40 ora României)
- GitHub: `v2-milestone-01` = `claude/project-thread-c0q8ro` = `6fbb104` (`git ls-remote`).
- Folderul Hub: ramura `v2-milestone-01`, HEAD `6fbb104`, fișiere urmărite curate.
- Live (doar GET): `2.18.0-m15`, contract 20, schema 15, BUILD_SAFE, boot `boot_mvmk5t0a_ea3ec4ee97`; `verify.mjs` din release-ul M15: VERIFY OK.
  Proprietarul rulase deja comanda M15 pe 2026-10-23 seara: proiectul de test „M15 Demo Livrare” (`prj_mvlfn3qb_c0695f3628`) există din 23:38.
- Engineering real, deja rulat pe live (2026-10-23 23:41–23:48 ora României, după confirmarea planului de către proprietar = D1):
  misiunea `mis_mvlfr8xr_f2968d4432` → Codex `gpt-6.1-sol` · medium (writer, `run_mvlfvjkh_f789d4983a`, completed) → verificări PASS →
  Claude `sonnet` · medium (review doar-citire, `run_mvlfy0da_9efa939fbb`, PASS / VALID) → QA 6/6, preview, E2E AC-6 (390 px) + AC-7
  (1280×800) PASS → DELIVERY_READY; pachet `bnd_mvlfzq1v_c9c7ec2a96` (sha `9cc538d35eb8e130aaeb343671b5c16a62168f1a7ac88a77b5763161c65e83f4`)
  READY_FOR_OWNER_ACCEPTANCE. Livrarea `dlv_mvlfr937_2c5f367d16` READY: capturi, clip 16:9 și vertical (QA WARN vizibil), rezumat v1;
  deciziile software / creativ 16:9 / creativ vertical / rezumat = PENDING (ale proprietarului).

## 2. Corecțiile (cod `1832977`, clona `C:\Users\mihai\m15-stage`, ramura `claude/project-thread-q6x9qp`, bază `6fbb104`)
Autor: Codex `gpt-6.1-sol` · medium (`codex exec -s workspace-write`, 3 runde după specificațiile coordonatorului din
`C:\Users\mihai\m15-evidence\fix\SPEC*.md`, jurnale `codex-run1..3.log`). Review: două sesiuni Claude separate, doar citire
(runda 1: 1 defect blocant + 7 observații, toate tratate; runda 2: nimic blocant, 5 observații minore, tratate în runda 3). QA
(testul în browser `m15-fixes-e2e`): coordonatorul.
- **R-STATE** (`lib/stateVocab.js`, `components/StatePill.jsx`, `styles/m15.css`): toate cele 19 etape `FACTORY_STAGES` au o stare
  explicită — cele zece etape de lucru (TEST_AUTHORING … PREVIEW) „În lucru”, CANCEL_REQUESTED „Se oprește”, PAUSED „În pauză”,
  BLOCKED „Lipsește ceva”, SPEC_DRAFT / NEEDS_OWNER_DECISION / DELIVERY_READY „Decizia ta”, ACCEPTED / REJECTED / CANCELLED „Încheiat”.
  Trei stări noi: `paused`, `stopping`, `unknown`. O stare necunoscută sau goală e „Stare necunoscută · <valoarea Hub-ului>”, niciodată
  „Pregătit”. Statusurile celorlalte domenii sunt mapate din listele serverului (desk, livrare, pregătire, dosar, ofertă, oportunitate —
  CONTACTED / IN_DISCUSSION „Pregătit”, așteaptă clientul —, plan, operație, rulare, randare; INTERRUPTED = eroare, STOPPED = în pauză).
  Istoricul păstrează motivul etapei (`stageReason`); „Ce te așteaptă” listează și stările necunoscute.
- **R-ERROR** (`lib/errorOutcome.js` nou, `components/ui.jsx`, `api.js`, `lib/stateVocab.js` currentActivity, `screens/Lega.jsx`):
  „nu s-a schimbat nimic” apare doar când e dovedit: pagina nu a trimis cererea (refuzul local UI_STALE), politica a refuzat-o înainte de
  execuție (category policy + decision deny; s-a consemnat doar refuzul), serverul a refuzat-o la verificarea contractului sau a tokenului,
  înainte de rută. O citire eșuată e o citire. Conexiune pierdută / 5xx: „Nu știu dacă cererea a fost executată. Verifică starea salvată
  înainte să repeți”; ecranul L3ga recitește starea cu citirile existente (cockpit, inbox, birou, livrări, `/api/state`) și oferă
  „Verifică starea salvată”, nu „Scrie din nou cererea”. Fără protocol nou.
- `store.js usePref`: o valoare simplă se scrie imediat (alegerea „Ecran complet” a proprietarului supraviețuiește unei reîncărcări
  imediate; testul R-LEGA-ONE-04 eșua 3 din 6 cu corecțiile, 0 din 4 pe bază; după reparație 6 din 6 trec).
- Versiune `2.18.1-m15`, contract 20, schema 15, fără migrare; doar UI (serverul: numai linia HUB_VERSION).

## 3. Teste (rulări distincte; nu se combină)
- **Istoric, neschimbat:** poarta completă pe `a1d427f` — V2 2620/2624 (3 FAIL = defectul M15 reparat în `6eb54e7`, 1 SKIP), V1 552/553
  0 FAIL (`m15-evidence\gate`); re-rularea țintită pe `6eb54e7`: 17 fișiere 128/128 (`m15-evidence\setINBOX-1.log`).
- **Acum, pe codul final `1832977`:**
  - logica pură `m15-ui-logic` + `m15-fixes`: 19/19;
  - 18 fișiere afectate (UI, L3ga, M15 inclusiv `m15-e2e` A/E și `m15-fixes-e2e`, `r-lega-one`, `m10-2-ui-e2e`, INT-05): 152/152
    (`m15-evidence\fix\affected-run3.log`);
  - **poarta V2 completă** în clona `C:\Users\mihai\m15-gate` pe `1832977` (status curat, UI construit în clonă, fără `HUB_*`):
    **2638 = 2637 PASS, 0 FAIL, 1 SKIP (T25, privilegiul de symlink)**, 7206 s, încărcare medie 89 %, maximum 100 %
    (`m15-evidence\gate-2.18.1`);
  - V1 nu s-a re-rulat: niciun fișier V1 nu s-a schimbat față de `a1d427f` (`git diff --stat a1d427f 1832977 -- . ":(exclude)v2"`: doar
    `.ifrim` și `CLAUDE.md`), deci dovada V1 552/553 de pe `a1d427f` rămâne valabilă pentru același cod.
- Dovezile cerute (`m15-fixes-e2e`, browser real, Hub sintetic, furnizori simulați = PASS_SIMULATED; capturi în `m15-evidence\fix\e2e`):
  etapele reale ale Factory în „Rezultate” și în istoricul L3ga (12 etape, inclusiv pauză, oprire, blocaj, decizie și o etapă necunoscută
  cu valoarea brută); răspuns pierdut după o operație reușită → mesajul „Nu știu…”, recitire, planul regăsit, o singură cerere și un
  singur plan, păstrate după F5; refuz demonstrat înaintea execuției (contract vechi → UI_STALE de la server: 0 comenzi, 0 planuri,
  „nu s-a schimbat nimic”); refuzul politicii prin HTTP (handler-ul nu rulează, comanda `rejected`). Planul, istoricul și deciziile după
  reîncărcare: `m15-e2e` E + `m15-fixes-e2e` pasul 3.

## 4. Release
`C:\Users\mihai\m15-evidence\release-2.18.1\owner-release.cmd` (CRLF): BASE `6fbb104`, CODE `1832977`, RELEASE = commitul de documentație
de deasupra; starea live → fetch din clonă (SHA exact, arbore executabil = CODE) → backup verificat prin API → fast-forward →
`upgrade.mjs --plan` / `--apply` (fără migrare) → `verify.mjs` (doar GET: 2.18.1-m15, contract 20, schema 15, BUILD_SAFE, canalele
deciziilor rezervate, OPS/SUP/DVZ READY, §25, oferta și dosarul Lăstărel neschimbate, markerii UI noi) → push fără force. Punct de
revenire: `6fbb104` (`git revert 6fbb104..1832977` + `upgrade.mjs --apply`).

## 5. Sesiunea integrată (făcută)
D1 2026-10-23 23:41; D2–D5 2026-10-24 23:02; citirile Birou intern 23:03; D6 23:09; D7 23:16 — toate în sesiunea proprietarului, verificate prin GET (detaliu: `M15_RAPORT_FINAL.md` §9). Push `c64593f` de proprietar (`push.cmd`). Acceptarea M15 și acceptarea M14 rămân deciziile lui explicite.

## 6. Acceptare
**M15 acceptat de proprietar** pe 2026-10-24 la 23:25 ora României („accept m15” în thread). Acceptarea M14 nu a fost declarată și rămâne separată.
