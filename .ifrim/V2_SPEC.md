# Ifrim Agent Hub V2 — Cerințe persistente și condiția de finalizare

Sursă: `C:\Users\mihai\Downloads\Ifrim_Agent_Hub_V2_Opus_5_5_REBUILD_COMPLET.md` (specificația completă, 29.09.2026). Această listă este condensarea operațională; specificația originală rămâne autoritativă.

## Condiția de finalizare (Definition of Done)

| Nivel | Condiție | Stare 2026-09-30 |
|---|---|---|
| BUILD_READY | Cod + teste locale deterministe, build UI, pornire/oprire documentate | **Atins** (vezi TEST_REPORT) |
| LIVE_VALIDATED | Cel puțin un turn real Codex și unul Claude, cu întrerupere reală, executate cu acordul tău și dovezi | **Nu** — așteaptă aprobarea ta (vezi „Aprobări necesare”) |
| RELEASE_CANDIDATE | Integrare, restaurare și UX verificate după LIVE_VALIDATED | Nu |
| RELEASED | Publicare aprobată | Nu (niciun commit/push/deploy făcut) |

## Cerințe (rezumat, cu trimitere la secțiunile specificației)

1. Datele, istoricul și secretele V1 se păstrează; V1 nu este modificat (§01, §10). → import versionat din snapshot, V1 neatins.
2. Moduri BUILD_SAFE / LIVE_VALIDATION / OPERATIONAL; niciun model pornit fără grant explicit (§03). → implementat în poartă.
3. Backup gate cu snapshot SQLite coerent, fără recursie, restaurare verificată (§05). → implementat și exercitat pe date reale.
4. BillingPolicy în backend; mediu controlat pentru procese copil (§06). → implementat.
5. Registru capabilități DevDay cu stări separate (§07). → `v2/config/capabilities.json`.
6. Arhitectură modulară, un coordonator, UI separat de worker (§08).
7. Adaptoare Codex app-server și Claude Code nemodificat, erori clasificate (§09).
8. Conversație canonică, entități cu ID stabile, mesaje originale imutabile, reconstrucție după restart (§10).
9. Handoff în 9 pași cu HandoffPackage complet (§11).
10. Memorie cu tipuri/scope/sursă, căutare locală, fără embeddings cloud (§12); skill-uri versionate.
11. Roluri evaluate, owner → reviewer → QA cu dovezi separate, concurență ≤2 (§13).
12. Scheduler cu stări validate, recuperare fără repornire automată (§14).
13. Un singur writer per workspace; Git doar pregătit, fără commit/push (§15).
14. Misiuni Ifrim Digital utilizabile, date demo etichetate, nimic trimis automat (§16).
15. Registru de instrumente cu permisiuni; desktop/browser blocate fără aprobare (§17).
16. Voce română: push-to-talk, transcriere editabilă, comenzi locale, vocea nu aprobă (§18).
17. Identitate vizuală originală, nucleu legat de stări reale, fără statistici false (§19–§21).
18. Responsive 360–1920, reduced motion, fallback fără WebGL (§22).
19. Utilizarea abonamentelor: doar cifre raportate, rezervă configurabilă, fără fallback plătit (§23).
20. Bus de evenimente versionat, dedupe, replay (§24); companion/MCP doar cu expunere aprobată.
21. Securitate: loopback, Host/Origin, token de sesiune, redaction, path scope (§25).
22. Pornire/oprire repetabile, loguri cu retenție, backup/restaurare (§26).
23. Matrice T01–T28 cu etichete PASS_LIVE/PASS_LOCAL/PASS_SIMULATED/FAIL/BLOCKED/NOT_RUN (§27).

## Aprobări necesare pentru LIVE_VALIDATED (cerere concretă)

Vezi `.ifrim/NEXT_SESSION.md` → „Aprobare live propusă”. Nimic din acestea nu a fost pornit.
