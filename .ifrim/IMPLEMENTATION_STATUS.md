# Stadiul implementării V2 — 2026-09-30

Nivel global: **BUILD_READY** (versiunea `2.1.0-m01`, schema 2). Nu LIVE_VALIDATED (niciun model pornit), nu RELEASE_CANDIDATE, nu RELEASED (niciun commit/push/deploy).

## Milestone 01 — Dual-Ecosystem Intelligence + Company Runtime + AI Runtime + Core Foundation

| Zonă (§ spec M01) | Stare | Ce funcționează | Ce lipsește / blocat |
|---|---|---|---|
| Audit OpenAI / Anthropic / standarde (§8–§33) | Complet (documentat + verificat adversarial) | `v2/config/ecosystem/{openai,anthropic,standards}.json` → `V2_*_CAPABILITY_AUDIT.md`, `V2_STANDARDS_AUDIT.md` | verificările pe cont care cer inferență sau setări (`model/list`, Codex account/read): LIVE_VALIDATION |
| Matrice cross-ecosistem (§34) | Complet | `matrix.json` → `V2_AI_ECOSYSTEM_MATRIX.md`; tabelul de rutare derivat (`routing.json`) | — |
| Framework-uri (§36–§41) | Complet (fără instalare) | Paperclip/Hermes/Agent Zero/JARVIS UI/OpenJarvis REFERENCE, OpenClaw RETIRE, Playwright REUSE, Playwright MCP INTEGRATE ulterior | Playwright: instalarea cere aprobare |
| ONE CONTROL PLANE + ownership (§42–§43) | Complet | `V2_OWNERSHIP_MAP.md`; Hub = singurul owner al ciclului de viață | — |
| Company Runtime (§44–§47) | Complet | companie, 12 departamente (4 active: executive, engineering, sales, operations), goals/objectives cu tranziții, misiuni legate, 18 roluri cu `reportsTo`, Chief of Staff determinist (fără model) | departamentele inactive: doar structură |
| ExecutionSurface + adaptoare (§48–§51) | Complet | 33 de suprafețe, 9 operații cu SUPPORTED/ASSISTED/PLANNED/UNSUPPORTED real, brief asistat, oglindire read-only `claude agents --json` | adaptoare Codex Cloud / Claude web: PLANNED (cloud_task.start = ALWAYS_ASK) |
| State machines + event envelope v2 (§52–§53) | Complet | 10 cicluri de viață aplicate; envelope cu company/department/project/mission/task/run/correlation + `raw_ref` | — |
| Command → Policy → Routing → Surface (§54) | Complet | ~65 comenzi, canale, validare, idempotency, corelare, jurnal `commands` | — |
| Approval engine (§59) | Complet | AUTO_ALLOWED / ASK_ONCE_FOR_TASK / ALWAYS_ASK / DENIED, reguli doar de înăsprire, scope per task revocat la final și la Stop All | — |
| Checkpoint / backup / lock-uri (§56–§58) | Complet, exercitat real | checkpoint Hub cu referințe native, backup real verificat după migrare, lease-uri computer/window | — |
| Tool/connector registry (§60) | Complet | unelte Hub + integrări observate, fiecare cu politica Hub | conectori reali: doar documentați |
| Memorie (§61) | Fundație | 8 scope-uri, sursă, direcție de sincronizare, export/import asistat cu marcaj anti-buclă | sincronizare automată cu memoria vendorilor: intenționat absentă |
| Skill-uri (§62) | Complet | 11 skill-uri Agent Skills, versiuni imutabile SHA-256, export bundle, un skill nu acordă permisiuni | publicarea pluginului: cere acord |
| Programări (§63) | Complet | un owner per intenție, runner local idempotent pe slot, referințe native (create de tine) | programările native Claude/OpenAI: le creezi tu |
| Computer runtime (§64) | Contract + registru | 10 medii, plan structured_api → dom → visual, lease-uri | Playwright neinstalat; control vizual doar nativ/asistat |
| Telemetrie (§65) | Complet | câmpuri etichetate MEASURED / PROVIDER_REPORTED / DERIVED / UNKNOWN, rezultate per tip de task | — |
| Router (§66) | Complet | departament/rol, provider, model, suprafață, unelte, mediu; factori persistați; `planned_only` în BUILD_SAFE | — |
| Billing guard (§7) | Întărit | credite > 0 blochează Codex; Fable refuzat; `--setting-sources user`; advisor oprit; oprire la `init` | atestările le înregistrezi tu |
| UI de diagnostic (§67) | Complet | ecranele Companie, Ecosisteme, Sistem + Agenți/Memorie actualizate | experiența JARVIS: Milestone 02 |
| Teste (§70) | 169 teste: 168 pass, 1 NOT_RUN | vezi `V2_TEST_REPORT.md` | PASS_LIVE: necesită aprobare |

## Rebuild (2026-09-29), păstrat ca istoric

| Zonă (§ spec) | Stare | Ce funcționează | Ce lipsește / blocat |
|---|---|---|---|
| Storage, schema, migrări (§10) | Complet | 30+ tabele, tranzacții, WAL, migrări versionate | — |
| Import V1 (§10) | Complet, aplicat | snapshot → dry-run → apply → revert, rulat pe datele reale | tabelele de referință V1 doar prin browserul legacy |
| Bus de evenimente + SSE (§24) | Complet | seq, dedupe, replay, backpressure prin reconectare | — |
| Moduri, poartă, grant-uri (§03, §25) | Complet | BUILD_SAFE implicit, LIVE_VALIDATION cu grant, OPERATIONAL refuzat | Politicile OPERATIONAL per misiune: neimplementate intenționat |
| BillingPolicy (§06) | Complet | verificări separate, mediu controlat, confirmări 30 de zile, plafon rezervă | setările de cost ale providerilor nu pot fi citite (confirmare manuală) |
| Backup gate + restaurare (§05) | Complet, exercitat real | backup verificat real, restaurare de test | corecția V1 nereîncărcată în API-ul V1 (V1 retras) |
| Adaptor Codex (§09) | Implementat, simulat + handshake real | app-server, allowlist, aprobări, cote, întrerupere | turn real: aprobarea ta |
| Adaptor Claude (§09) | Implementat, simulat + auth real | stream-json, stdin, session id, flaguri interzise, workspace neîncrezător | turn real: aprobarea ta |
| Conversație canonică (§10) | Complet | fir unic, mesaje imutabile, atașamente cu hash, ciornă locală, sesiuni native atașate | — |
| Handoff 9 pași (§11) | Complet (simulat) | pachet complet, ACK verificat, punct sigur | validare live cu ambii provideri |
| Memorie + căutare (§12) | Complet | FTS5 fără diacritice, tipuri, versiuni, contradicții, export, ștergere autorizată | retrieval automat în prompt: nu (doar decizii/rezumat); embeddings locale: nu |
| Skill-uri (§12) | Registru | 11 skill-uri versionate, propuneri doar de la agenți | editor UI pentru propuneri: nu |
| Roluri, owner/reviewer/QA (§13) | Complet | 15 roluri (din 23 V1), etape separate, concurență ≤2 | — |
| Scheduler + recuperare (§14) | Complet | 12 stări, tranziții validate, lease-uri, heartbeat, breaker, recuperare la boot, detecție inactivitate | dispatch automat din coadă: intenționat absent (fără OPERATIONAL) |
| Worktrees, Git (§15) | Parțial | un writer per workspace, diff/status/log, propunere commit | manager de worktree-uri paralele: nu |
| Misiuni Ifrim Digital (§16) | Complet ca fluxuri | 8 tipuri, taskuri cu dependențe, lead-uri cu dovezi, briefing + export MD | inbox/calendar neconectate (corect) |
| Instrumente (§17) | Parțial | registru; files/git/preview/process.run cu aprobare | browser (Playwright) și desktop: BLOCKED până la aprobare |
| Voce (§18) | Implementat (browser) | push-to-talk, transcriere editabilă, comenzi locale, TTS cu etichetă local/online | transcriere locală garantată: depinde de browser; wake word: nu |
| UI / design (§19–22) | Complet | Control Room, Focus, 12 ecrane, palette, notificări, nucleu procedural, responsive | JARVIS repos de referință: neinspectate (opționale) |
| Utilizare (§23) | Complet | doar cifre raportate, rezervă configurabilă | cotele Claude: necunoscute prin CLI |
| Plugin/MCP companion (§24) | BLOCKED | bus intern compatibil ca formă | endpoint public neaprobat |
| Mobil/remote (§26) | UI responsive | UI mobil funcțional pe loopback | acces remote: neactivat (necesită pairing/aprobare) |
| Operare (§26) | Complet | start/stop/status, log rotit la 5 MB × 3, health, export | instalator/serviciu: nu (intenționat) |
| Documentație (§28) | Complet | toate fișierele cerute în `.ifrim/` | — |
