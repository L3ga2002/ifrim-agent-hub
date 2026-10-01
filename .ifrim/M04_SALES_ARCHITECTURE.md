# M04 · Sales & Lead Generation: arhitectură și contracte

Data: 2026-10-01. Bază: `v2-milestone-01` @ `3c5d202` (pe GitHub), versiunea Hub `2.4.0-m03` → M04 `2.5.0-m04`.

Acest document e contractul comun pentru implementare: modulele pure, schema, comenzile și API-ul. Codul urmează acest contract.

## 1. Principii

- **Infrastructura e cea existentă.** Sales folosește magistrala de comenzi, aprobările, evenimentele, scheduler-ul, backup-ul, memoria și Lega. Nu există un orchestrator Sales separat și nici autentificări proprii.
- **Firma ta nu se amestecă cu firmele prospectate.** Ifrim Digital rămâne control plane-ul. Firmele prospectate sunt `sales_orgs`.
- **Comunicarea e DRAFT_ONLY**, iar research-ul e SIMULATED/LOCAL. Adaptorul real de trimitere e dezactivat, iar colectarea live e dezactivată.
- **Fără model pentru validări deterministe:** formate, potriviri exacte, formule. M04 nu pornește niciun model.
- **Starea comercială e separată de starea execuției.** Un task COMPLETED nu face o oportunitate WON și nu marchează un mesaj SENT.
- **Proveniență obligatorie.** Fiecare afirmație folosită la calificare, audit sau propunere are o dovadă (`sales_evidence`) cu una din etichetele USER_PROVIDED, OBSERVED, SOURCE_REPORTED, INFERRED, UNKNOWN.
- **Datele sintetice sunt marcate peste tot.** Au `synthetic = 1` și o etichetă persistentă în UI.
- **Registrul `leads` din M01 rămâne neschimbat** (0 rânduri live). M04 îl înlocuiește cu `sales_*`; vechile endpoint-uri continuă să funcționeze.

## 2. Module pure (fără bază de date, fără rețea), în `v2/server/sales/`

Toate sunt ESM. Comentariile din cod sunt în engleză; textele afișate proprietarului sunt în română. Fiecare modul are un fișier de test `v2/tests/m04-<modul>.test.mjs` (node:test, fără rețea; foldere temporare prin `tempDir` din `v2/tests/helpers.mjs`).

### 2.1 `tabular.mjs`: CSV/XLSX fără dependențe noi

- `parseCsv(buffer, { maxBytes = 20 * 1024 * 1024, maxRows = 50000 } = {})` → `{ encoding, delimiter, headers: string[], rows: string[][], warnings: string[] }`
  - Detectează BOM-ul (UTF-8 sau UTF-16LE).
  - Un UTF-8 invalid e decodat ca `windows-1250` (TextDecoder).
  - Delimitatorul se detectează dintre `, ; \t |`.
  - Ghilimelele urmează RFC 4180 (`""` pentru ghilimele, linii noi în câmpuri).
  - Liniile goale sunt sărite. Rândurile cu alt număr de coloane rămân, cu avertisment.
  - Valorile rămân **text exact**: nimic nu e convertit în număr.
  - Dacă se depășesc limitele → `HubError("validation", …)`.
- `parseXlsx(buffer, { sheet = null, maxBytes = 20 MB, maxUncompressed = 100 MB, maxCells = 2_000_000 } = {})` → `{ sheets: string[], sheet, headers, rows: string[][], cellFlags: { numeric: [[r,c]...], formula: [[r,c]...] }, warnings }`
  - Are propriul cititor ZIP (EOCD, central directory, metodele 0 și 8 prin `zlib.inflateRawSync` cu `maxOutputLength`).
  - Refuză:
    - ZIP-urile criptate;
    - arhivele cu `xl/vbaProject.bin` (eroarea „conține macro-uri”);
    - raporturile de compresie suspecte (zip bomb);
    - căile cu `..` sau absolute.
  - Formulele **nu se evaluează niciodată**: se ia valoarea din cache `<v>` și se marchează în `cellFlags.formula`.
  - Celulele numerice păstrează textul exact din `<v>` și sunt marcate în `cellFlags.numeric`.
  - Tipurile de celulă suportate: `s` (shared), `inlineStr`, `str`, `b`, `e`, `n`.
  - Rândul de antet e primul rând nevid.
- `writeXlsx(rows, { sheetName = "Firme", numericCells = [], formulaCells = [] } = {})` → `Buffer`: un XLSX minimal valid, folosit pentru fixture-uri și teste.
- `writeZip(entries: [{ name, data: Buffer }])` → `Buffer` (metoda store, CRC32).
- `toCsvCell(value)` → text sigur pentru export. Neutralizează formula injection: un text care începe cu `= + - @ \t \r` primește prefixul `'`. Adaugă ghilimele când e nevoie.
- `toCsv(headers, rows)` → `string` (CRLF, cu BOM UTF-8).

### 2.2 `identity.mjs`: normalizare, identitate, potrivire

- `foldDiacritics(text)` și `normalizeName(name)` → `{ normalized, legalForm, tokens }`
  - Elimină: SRL / S.R.L., SA, PFA, II, IF, SNC, SCS, SCA.
  - Diacriticele (ș/ş, ț/ţ, ă, â, î) devin litere simple, `&` devine „si”, iar punctuația devine spațiu.
- `normalizeFiscalCode(raw)` → `{ value: "12345678" | null, prefixRO: bool, valid: true | false | null, reason }`
  - Validează CUI-ul românesc cu cifra de control (cheia `753217532`).
  - Gol → `valid: null`.
- `normalizeDomain(urlOrEmail)` → `host` sau `""` (lowercase, fără `www.`).
- `classifyUrl(url)` → `{ kind: "organization_site" | "social_profile" | "marketplace_listing" | "directory" | "article" | "shared_hosting" | "invalid", reason }`.
- `isIdentityDomain(host)`: `false` pentru platformele comune (facebook, instagram, linkedin, tiktok, youtube, olx, emag, wikipedia, google, `*.wixsite.com`, `*.blogspot.com`, `*.business.site`, `sites.google.com`, listafirme, termene, risco și altele similare).
- `normalizePhone(raw, { wasNumeric = false } = {})` → `{ value: string | null, raw, warnings }`
  - Rămâne text, format `+40…` doar când e sigur.
  - O celulă numerică cu 9 cifre primește avertismentul „0 inițial posibil pierdut”.
- `checkEmail(raw)` → `{ value, valid, generic, reason }`. `generic` e adevărat pentru adrese ca info@, office@, contact@, sales@, hello@, comenzi@.
- `nameSimilarity(a, b)` → număr între 0 și 1 (Dice pe bigrame, după normalizare).
- `matchCandidates(record, existing)` → `[{ existingId, strength: "STRONG" | "CANDIDATE" | "CONFLICT", reasons: string[], conflicts: string[] }]`
  - `record` și fiecare element din `existing` au forma `{ id?, name, fiscalCode, domain, city, emails: [] }`.
  - Reguli:
    - același CUI valid → STRONG;
    - CUI-uri valide diferite → niciodată potrivire (CONFLICT dacă numele sunt foarte apropiate);
    - același domeniu de identitate și nume apropiate → CANDIDATE;
    - același domeniu și nume diferite → CONFLICT (filiale sau branduri);
    - același nume normalizat și același oraș → CANDIDATE.
- `decideImportAction(matches)` → `"CREATE" | "MATCH_EXISTING" | "NEEDS_REVIEW"`:
  - exact un STRONG fără CONFLICT → MATCH_EXISTING;
  - orice CANDIDATE sau CONFLICT → NEEDS_REVIEW;
  - nimic → CREATE.
- `synthetic.mjs` (același autor): `generateSyntheticOrgs(n, { seed = 42 } = {})` → rânduri de import cu:
  - nume fictive românești, cu diacritice;
  - domenii `.test`, e-mailuri `@<domeniu>.test`, telefoane din intervalul fictiv `+40 7xx 000 xxx`;
  - CUI-uri cu cifră de control validă (generate, nu copiate), orașe și CAEN;
  - duplicate și rânduri invalide controlate (`{ duplicateRate, invalidRate }`).
  - Determinist pentru același seed.

### 2.3 `audit.mjs` + `research.mjs`: audit de site și sursa de date

- `auditHtml({ html, url, orgName = "", fetchedAt, sourceKind = "fixture" })` → `{ version: "audit-v1", url, sourceKind, checks: [...], limits: string[] }`
  - Fiecare verificare are forma `{ id, area, status: "PASS" | "ISSUE" | "UNKNOWN" | "NOT_APPLICABLE", observation, evidence: { selector, excerpt, method: "static-html" }, label: "OBSERVED" | "INFERRED" }`.
  - Verificările:
    - `identity_name`: numele firmei apare în title, h1 sau footer;
    - `title_present`;
    - `services_described`;
    - `navigation`;
    - `contact_phone`, `contact_email`, `contact_address`;
    - `contact_form`, `form_labels`;
    - `mobile_viewport`;
    - `https`;
    - `lang_attr`;
    - `images_alt`;
    - `internal_anchors`.
  - Parsare HTML minimă, fără dependențe. Nu execută nimic. Fragmentele sunt tăiate la 200 de caractere și redactate.
  - Textul din pagină e dată neîncrezătoare: instrucțiunile din pagină nu influențează nimic.
- `opportunitiesFromAudit(audit, catalog)` → `[{ checkId, observation, possibleEffect, serviceId | null, conditionsToConfirm: string[] }]`
  - Mapare prin etichetele serviciilor din catalog (`tags`): `responsive`, `contact`, `website`, `seo-basic`, `accessibility`.
  - Fără serviciu configurat → `serviceId: null`, cu mesajul „niciun serviciu configurat”.
- `research.mjs`:
  - `createSourceRegistry({ adapters, clock, cache = new Map(), rateLimitPerMinute = 30 })` → `{ fetch(adapterId, target) }`
    - Timeout, limită de mărime (`MAX_BODY_BYTES = 2 MB`) și content-type `text/html`.
    - Cache-ul are cheia adaptor@versiune|țintă. Deduplică cererile simultane.
  - `fixtureSiteAdapter({ dir })`: citește `<dir>/<host>.html` (doar host-uri `.test`).
  - `liveHttpAdapter()`: aruncă mereu `HubError("policy", "Colectarea live e dezactivată în M04 (LIVE_COLLECTION_DISABLED)")`.
  - `validateCollectorUrl(url, { resolve })` (asincron) → `{ ok, reason }`. Refuză:
    - altă schemă decât http/https;
    - credențialele în URL;
    - localhost, `*.local`, IP-urile private, loopback și link-local (inclusiv 169.254.169.254);
    - host-urile care se rezolvă în adrese private.
  - Collectorul **nu** folosește politica Browser Workspace: localhost e permis acolo pentru E2E, aici e refuzat.
- Fixture-uri: `v2/fixtures/sales/sites/<host>.html`, 8–10 firme fictive pe domenii `.test`:
  - un site bun;
  - unul fără viewport;
  - unul fără contact;
  - unul cu formular fără etichete;
  - un articol (nu e o afacere);
  - o listare de marketplace;
  - un site cu date contradictorii (două telefoane diferite, două nume);
  - un site cu text de prompt injection;
  - diacritice.

### 2.4 `qualify.mjs` + `proposal.mjs`: calificare explicabilă și texte

- `QUALIFICATION_FORMULA = { version: "q-v1", weights: { serviceFit: 0.5, evidence: 0.3, completeness: 0.2 } }`
- `qualify({ org, evidence, audit, opportunities, catalog, financials = [], filters = {} })` → `{ version, components: { serviceFit, evidence, completeness }, priority: number | null, unknowns: string[], explanation: string[], financialFilter: { status: "PASS" | "FAIL" | "UNKNOWN", reason } }`
  - Fiecare componentă are forma `{ score: 0..100 | null, contributions: [{ factor, points, evidenceIds }] }`.
  - O componentă necunoscută are `score: null`, nu 0. Prioritatea se calculează doar pe componentele cunoscute (ponderile renormalizate). Dacă nicio componentă nu e cunoscută → `priority: null`.
  - Filtrul financiar compară doar același indicator, perioadă și monedă, cu sursă. Altfel rezultatul e UNKNOWN, nu excludere.
  - Prioritatea e internă. Nu e o probabilitate de vânzare.
- `applyOverride(result, { priority, reason, actor, at })`: motivul e obligatoriu (cel puțin 5 caractere); istoricul se păstrează.
- `renderProposal({ org, opportunity, services, evidence, audit, owner })` → `{ title, sections: [{ id, heading, text }], claimsToVerify: string[], usedEvidenceIds: string[], warnings: string[], text }`
  - Secțiunile: context verificat, observații (doar OBSERVED și USER_PROVIDED, cu sursa), soluție propusă, scope, excluderi, materiale necesare, întrebări, următorul pas, preț și termen.
  - Prețul și termenul vin **doar** din `service.price` / `service.leadTime` cu `status: "CONFIGURED"`. Altfel apare „De stabilit (neconfigurat)”.
  - Fără portofoliu, testimoniale, rezultate SEO sau reduceri, decât dacă există în `owner.materials`.
- `renderContactDraft({ org, contact, proposal, audit, owner })` → `{ subject, body, claimsToVerify, personalizationBasis: [{ text, evidenceId }] }`
  - „Am analizat site-ul” apare doar dacă există un audit cu verificări OBSERVED; altfel textul e o introducere fără această afirmație.
  - Adresarea e generică pentru o adresă generică. Nu inventează nume.

## 3. Schema (migrarea 4, `m04-sales-lead-generation`, doar adăugări)

Tabele noi:
- `sales_import_batches`, `sales_import_rows`;
- `sales_orgs`, `sales_org_aliases`, `sales_contacts`;
- `sales_evidence`, `sales_merges`;
- `sales_audits`, `sales_qualifications`;
- `sales_services`;
- `sales_opportunities`, `sales_transitions`;
- `sales_proposals`, `sales_drafts`, `sales_sends`;
- `sales_contact_events`, `sales_client_acceptances`;
- `sales_followups`, `sales_suppressions`;
- `sales_handoffs`.

Fiecare are id stabil, timestamps și, unde e cazul, `version` și `synthetic`. Detaliile sunt în `v2/server/storage/migrations.mjs`.

## 4. Stări

**Lead (`sales_orgs.status`):**
- `NEW → NEEDS_RESEARCH → QUALIFIED → AUDITED → OPPORTUNITY`
- laterale: `ON_HOLD`, `DISQUALIFIED`, `DO_NOT_CONTACT`

**Oportunitate:**
- `IDENTIFIED → PROPOSAL_DRAFT → READY_FOR_OWNER_REVIEW → APPROVED_INTERNAL → CONTACTED → IN_DISCUSSION → WON | LOST | ON_HOLD`
- `DO_NOT_CONTACT` se aplică la nivel de organizație.

**Reguli:**
- CONTACTED cere un eveniment de contact real: SENT_VIA_HUB (imposibil în M04) sau MANUAL_RECORDED, cu textul de confirmare.
- WON cere o acceptare a clientului înregistrată de proprietar.

**Draft:**
- `DRAFT → CONTENT_APPROVED (aprobare legată de hash) → SEND_AUTHORIZED (dezactivat în M04) → SENT` (doar printr-un eveniment de transport DELIVERED)
- altele: `SUPERSEDED`, `CANCELLED`

## 5. API (`/api/sales/...`)

Mutațiile se fac prin comenzi; canalele sunt `ui`/`test`. Vocea poate doar citi.

| Metodă și cale | Ce face |
|---|---|
| GET `/api/sales/overview` | `{ counts, pipeline, metrics, synthetic, outreach: "DISABLED", catalog }` |
| POST `/api/sales/imports` `{ fileName, contentBase64, synthetic }` | lot nou (UPLOADED), cu anteturi, foi și maparea sugerată |
| GET `/api/sales/imports` · GET `/api/sales/imports/:id?status=&offset=&limit=` | loturi și rânduri |
| POST `/api/sales/imports/:id/mapping` `{ mapping: { "<coloana>": "<camp>" } }` | câmpuri: name, fiscalCode, website, email, phone, city, county, address, caen, contactName, contactRole, turnover, turnoverYear, employees, notes, source, ignore |
| POST `/api/sales/imports/:id/preview` | `{ rows (primele 50), summary }` |
| POST `/api/sales/imports/:id/confirm` | import idempotent și reluabil |
| POST `/api/sales/imports/:id/rollback-preview` · POST `/api/sales/imports/:id/rollback` | rollback-ul e ALWAYS_ASK |
| GET `/api/sales/orgs?q=&status=&city=&synthetic=&needsReview=&offset=&limit=&sort=` | `{ items, total, offset, limit }` |
| GET `/api/sales/orgs/:id` | fișa completă |
| POST `/api/sales/orgs/:id/transition` · `/evidence` · `/audit` · `/qualify` · `/qualification/override` · `/suppress` | acțiuni pe organizație |
| POST `/api/sales/import-rows/:id/resolve` `{ action: "create" \| "match" \| "skip", orgId }` | rezolvarea rândurilor NEEDS_REVIEW |
| POST `/api/sales/orgs/:id/merge` `{ intoId, reason }` · POST `/api/sales/merges/:id/revert` | unire reversibilă |
| GET/POST `/api/sales/opportunities` · GET `/api/sales/opportunities/:id` · POST `/api/sales/opportunities/:id/transition` | oportunități |
| POST `/api/sales/opportunities/:id/proposals` · POST `/api/sales/proposals/:id/approve` | aprobarea e ALWAYS_ASK, legată de sha |
| POST `/api/sales/opportunities/:id/drafts` · POST `/api/sales/drafts/:id/revise` · POST `/api/sales/drafts/:id/approve-content` · POST `/api/sales/drafts/:id/send` | send → refuzat: OUTREACH_DISABLED |
| POST `/api/sales/opportunities/:id/contact-events` · POST `/api/sales/opportunities/:id/acceptance` · POST `/api/sales/opportunities/:id/handoff` | contact, acceptare, handoff |
| GET `/api/sales/followups` · POST `/api/sales/opportunities/:id/followups` · POST `/api/sales/followups/:id/:action` | follow-up-uri |
| GET/POST `/api/sales/services` · POST `/api/sales/services/:id` | catalogul de servicii |
| GET `/api/sales/export/orgs.csv?…` | export cu formula injection neutralizată |

## 6. Siguranță

- Fișierele se citesc doar din conținutul trimis prin API; nu se citesc căi de pe disc.
- Limite de mărime și tip. Nu se execută macro-uri și nu se evaluează formule.
- Exportul neutralizează formulele.
- HTML-ul și fragmentele sunt tratate ca text. UI-ul nu folosește `dangerouslySetInnerHTML` pentru date Sales.
- Collectorul are o politică de URL separată (§2.3).
- Lega primește rezumate limitate, nu baza CRM.
- Nimic nu se trimite în afară.
