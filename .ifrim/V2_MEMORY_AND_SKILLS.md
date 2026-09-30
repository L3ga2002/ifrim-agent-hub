# Memorie și skills (V2, Milestone 01)

## Memoria canonică Hub

Independentă de provider, auditabilă, pe scope, cu sursă. Memoria nativă Claude (memorie de cont, căutare în chat, Projects) și memoria ChatGPT **nu sunt** memoria Hub.

- Scope-uri: GLOBAL, COMPANY, DEPARTMENT, CLIENT, PROJECT, MISSION, TASK, AGENT_ROLE (toate cu `scope_ref`, în afară de GLOBAL/COMPANY).
- Tipuri: FACT, USER_PREFERENCE, DECISION, ASSUMPTION, HYPOTHESIS, OUTDATED. Un agent sau un import scrie doar ASSUMPTION/HYPOTHESIS până le confirmi tu.
- Sursă: `source_kind` ∈ hub, user, claude_native, openai_native, hermes, import, v1; direcție: `sync_direction` ∈ none, import_only, export_only.
- Corecțiile creează versiuni noi (vechea devine OUTDATED); ștergerea autorizată păstrează un tombstone; secretele sunt refuzate înainte de indexare; căutare FTS5 fără diacritice.

### Sincronizare controlată cu vendorii (asistată, fără bucle)

- **Export** (`GET /api/memory/export/claude|openai`): text pe care îl lipești tu în memoria vendorului sau în instrucțiunile unui proiect. Fiecare linie are marcajul `hub-memory-id:<id>`; elementele venite deja de la acel vendor nu se exportă înapoi.
- **Import** (`memory.import`): text lipit de tine din exportul vendorului. Liniile cu marcaj Hub sunt **ecouri** și se ignoră (fără Hub → Claude → Hub → duplicat); duplicatele exacte se ignoră; restul intră ca ASSUMPTION cu `source_kind` al vendorului.
- Hub-ul nu citește și nu scrie direct memoria vendorilor (nu există API oficial folosit; fără scraping).
- În rulările pornite de Hub, memoriile native sunt oprite per proces: Codex `-c features.memories=false`, Claude `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`. Contextul vine doar din pachetul Hub. În sesiunile tale interactive, memoriile vendorilor rămân active și sunt ale tale.

## Skills: format canonic Agent Skills

Decizie: formatul canonic al Hub-ului este **Agent Skills** (`SKILL.md` cu frontmatter YAML + `scripts/`, `references/`, `assets/` opționale), ca un skill creat în Hub să fie folosibil în Claude, Claude Code și alte runtime-uri compatibile. Detalii despre standard și suport: `V2_ANTHROPIC_CAPABILITY_AUDIT.md` și anexa de standarde din `V2_AI_ECOSYSTEM_MATRIX.md`.

- Locație: `v2/skills/<nume>/SKILL.md` (11 skills convertite din `config/skills.json`: debug, feature, review, test-browser, audit-site, site-premium, company-research, offer, documentation, release, handoff).
- Frontmatter: `name` (= numele directorului; litere mici, cifre, cratime simple, ≤64), `description` (≤1024), `license`, `compatibility` (≤500), `metadata` (hartă text→text) cu cheile Hub `hub-version`, `hub-roles`, `hub-permission`, `hub-tools`, `hub-tests`; `allowed-tools` opțional.
- Versionare: SHA-256 peste toate fișierele; conținut schimbat → versiune nouă imutabilă (`skill_versions`); același conținut → aceeași versiune (idempotent).
- Validare la import: structură, limite, secrete, instrucțiuni de ocolire a permisiunilor, push/publish, rute API plătite, ștergeri distructive. Un skill invalid este marcat `invalid` și nu se folosește.
- **Un skill nu acordă permisiuni**: pentru fiecare rol, uneltele efective sunt intersecția skill ∩ rol, iar nivelul efectiv este minimul dintre cele două (`effectiveFor`). Ce cere peste rol se ignoră (avertisment la validare); încercarea de folosire la rulare este acțiunea DENIED `skill.permission_escalation`.
- Execuțiile înregistrează versiunile skills ale rolului (`agent_runs.skill_versions_json`) pentru telemetrie.
- Export: `skill.export` scrie un pachet local Claude Code plugin (`.claude-plugin/plugin.json` + `skills/`) sau Agent Skills în `.ifrim/tmp/v2/exports/`. Instalarea în `~/.claude` sau publicarea sunt configurări globale: cer acordul tău.

Adaptoare viitoare: OpenClaw (ClawHub) și Hermes se evaluează în `V2_FRAMEWORK_EVALUATION.md`; conversia se face din formatul canonic, nu prin patru copii manuale.
