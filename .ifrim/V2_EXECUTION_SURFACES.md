# Suprafețe de execuție (ExecutionSurface)

> Generat din `v2/config/ecosystem/` de `v2/scripts/gen-ecosystem-docs.mjs`. Verificat: 2026-09-30. Nu edita manual: modifică JSON-ul și regenerează.

Același provider oferă mai multe suprafețe. Routerul alege PROVIDER + MODEL + SUPRAFAȚĂ + UNELTE + MEDIU. Nivel de control: PROGRAMMATIC (Hub-ul o conduce prin CLI/protocol oficial), ASSISTED (tu o rulezi în aplicația vendorului; Hub-ul pregătește și înregistrează), NATIVE_INTERACTIVE, MIRROR (Hub-ul doar observă), NONE.

| ID | Provider | Tip | Control | Facturare | Locație | Disponibilitate (bază) | Decizie Hub |
|---|---|---|---|---|---|---|---|
| `hub.local` | hub | HubLocalTools | PROGRAMMATIC | none | local | available | REIMPLEMENT |
| `openai.codex_app_server` | openai | CodexAppServer | PROGRAMMATIC | subscription | local | unknown | WRAP |
| `openai.codex_wsl_runner` | openai | CodexAppServer | PROGRAMMATIC | subscription | local | unknown | WRAP |
| `openai.codex_cli` | openai | CodexCLI | ASSISTED | subscription | local | assisted | ASSISTED |
| `openai.codex_desktop` | openai | CodexDesktop | NATIVE_INTERACTIVE | subscription | local | assisted | ASSISTED |
| `openai.codex_cloud` | openai | CodexCloud | PROGRAMMATIC | subscription | cloud | needs_setup | ASSISTED |
| `openai.codex_review` | openai | CodexReview | ASSISTED | subscription | hybrid | assisted | ASSISTED |
| `openai.codex_security` | openai | CodexSecurityCloud | ASSISTED | unknown | cloud | needs_setup | ASSISTED |
| `openai.chatgpt_work` | openai | ChatGPTWork | NATIVE_INTERACTIVE | subscription | cloud | assisted | ASSISTED |
| `openai.chatgpt_chat` | openai | ChatGPTChat | NATIVE_INTERACTIVE | subscription | cloud | assisted | ASSISTED |
| `openai.dots` | openai | Dot | NATIVE_INTERACTIVE | subscription | cloud | unknown | ASSISTED |
| `openai.plugins` | openai | ChatGPTPlugin | NONE | subscription | cloud | blocked | REFERENCE |
| `openai.space_pages` | openai | ChatGPTSpace | NATIVE_INTERACTIVE | subscription | cloud | unknown | ASSISTED |
| `openai.agents_api` | openai | AgentsAPI | PROGRAMMATIC | api | cloud | blocked | REJECT |
| `openai.decisions_api` | openai | DecisionsAPI | PROGRAMMATIC | api | cloud | blocked | REJECT |
| `anthropic.claude_code_headless` | anthropic | ClaudeCode | PROGRAMMATIC | subscription | local | unknown | WRAP |
| `anthropic.claude_code_interactive` | anthropic | ClaudeCodeInteractive | ASSISTED | subscription | local | assisted | REUSE_NATIVE |
| `anthropic.claude_code_background` | anthropic | ClaudeCodeSessions | MIRROR | none | local | unknown | MIRROR_STATE |
| `anthropic.claude_code_web` | anthropic | ClaudeCodeWeb | ASSISTED | subscription | cloud | unknown | ASSISTED |
| `anthropic.claude_chat` | anthropic | ClaudeChat | NATIVE_INTERACTIVE | subscription | cloud | assisted | ASSISTED |
| `anthropic.claude_cowork` | anthropic | ClaudeCowork | NATIVE_INTERACTIVE | subscription | hybrid | unknown | ASSISTED |
| `anthropic.claude_research` | anthropic | ClaudeResearch | NATIVE_INTERACTIVE | subscription | cloud | assisted | ASSISTED |
| `anthropic.claude_computer_use` | anthropic | ClaudeComputerUse | NATIVE_INTERACTIVE | subscription | local | needs_setup | ASSISTED |
| `anthropic.claude_in_chrome` | anthropic | ClaudeInChrome | NATIVE_INTERACTIVE | subscription | local | needs_setup | ASSISTED |
| `anthropic.claude_desktop_browser` | anthropic | ClaudeDesktopBrowser | NATIVE_INTERACTIVE | subscription | local | assisted | ASSISTED |
| `anthropic.claude_projects` | anthropic | ClaudeProject | NATIVE_INTERACTIVE | subscription | cloud | assisted | ASSISTED |
| `anthropic.claude_scheduled_desktop` | anthropic | ClaudeScheduledTask | NATIVE_INTERACTIVE | subscription | local | assisted | MIRROR_STATE |
| `anthropic.claude_routines_cloud` | anthropic | ClaudeRoutine | NATIVE_INTERACTIVE | subscription | cloud | unknown | ASSISTED |
| `anthropic.claude_artifacts` | anthropic | ClaudeArtifacts | NATIVE_INTERACTIVE | subscription | cloud | assisted | ASSISTED |
| `anthropic.claude_connectors` | anthropic | ClaudeConnectors | NATIVE_INTERACTIVE | subscription | hybrid | assisted | REUSE_NATIVE |
| `anthropic.claude_plugins` | anthropic | ClaudePlugins | ASSISTED | subscription | local | assisted | WRAP |
| `anthropic.claude_skills` | anthropic | ClaudeSkills | ASSISTED | subscription | hybrid | assisted | REUSE_NATIVE |
| `anthropic.claude_mobile_remote` | anthropic | ClaudeRemote | NATIVE_INTERACTIVE | subscription | hybrid | assisted | REUSE_NATIVE |
| `openclaw.gateway` | openclaw | OpenClawGateway | NONE | unknown | local | blocked | REJECT |

## Operații ExecutionSurfaceAdapter

✔ SUPPORTED · A ASSISTED · P PLANNED · — UNSUPPORTED (valoare reală, întoarsă apelantului)

| Suprafață | start | resume | sendInput | streamEvents | interrupt | stop | prepareHandoff | getStatus | getArtifacts |
|---|---|---|---|---|---|---|---|---|---|
| `hub.local` | ✔ | — | — | ✔ | ✔ | ✔ | — | ✔ | ✔ |
| `openai.codex_app_server` | ✔ | ✔ | — | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `openai.codex_wsl_runner` | ✔ | ✔ | — | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `openai.codex_cli` | A | — | — | — | — | — | — | — | — |
| `openai.codex_desktop` | A | — | — | — | — | — | — | — | — |
| `openai.codex_cloud` | P | — | — | — | — | — | — | P | P |
| `openai.codex_review` | A | — | — | — | — | — | — | — | — |
| `openai.codex_security` | A | — | — | — | — | — | — | — | — |
| `openai.chatgpt_work` | A | — | — | — | — | — | — | — | A |
| `openai.chatgpt_chat` | A | — | — | — | — | — | — | — | — |
| `openai.dots` | A | — | — | — | — | — | — | — | — |
| `openai.plugins` | — | — | — | — | — | — | — | — | — |
| `openai.space_pages` | A | — | — | — | — | — | — | — | A |
| `openai.agents_api` | — | — | — | — | — | — | — | — | — |
| `openai.decisions_api` | — | — | — | — | — | — | — | — | — |
| `anthropic.claude_code_headless` | ✔ | ✔ | P | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `anthropic.claude_code_interactive` | A | — | — | — | — | — | — | — | — |
| `anthropic.claude_code_background` | — | — | — | ✔ | — | — | — | ✔ | — |
| `anthropic.claude_code_web` | A | — | — | — | — | — | — | — | — |
| `anthropic.claude_chat` | A | — | — | — | — | — | — | — | A |
| `anthropic.claude_cowork` | A | — | — | — | — | — | — | — | A |
| `anthropic.claude_research` | A | — | — | — | — | — | — | — | A |
| `anthropic.claude_computer_use` | A | — | — | — | — | — | — | — | — |
| `anthropic.claude_in_chrome` | A | — | — | — | — | — | — | — | — |
| `anthropic.claude_desktop_browser` | A | — | — | — | — | — | — | — | — |
| `anthropic.claude_projects` | A | — | — | — | — | — | — | — | — |
| `anthropic.claude_scheduled_desktop` | A | — | — | — | — | — | — | — | — |
| `anthropic.claude_routines_cloud` | A | — | — | — | — | — | — | — | — |
| `anthropic.claude_artifacts` | A | — | — | — | — | — | — | — | A |
| `anthropic.claude_connectors` | A | — | — | — | — | — | — | — | — |
| `anthropic.claude_plugins` | A | — | — | — | — | — | — | — | — |
| `anthropic.claude_skills` | A | — | — | — | — | — | — | — | — |
| `anthropic.claude_mobile_remote` | A | — | — | — | — | — | — | — | — |
| `openclaw.gateway` | — | — | — | — | — | — | — | — | — |

## Detalii

### Unelte locale Hub (`hub.local`)

Fișiere, Git, preview HTTP local, scripturi npm aprobate; fără model.

- Capabilități: files.read, git.status, git.diff, preview.check, process.run
- Platformă: Windows (proces Hub) · Plan: niciunul · Auth: none
- Disponibilitate de bază: available — Parte din Hub
- Restricții de siguranță: Doar în proiecte activate; Scripturi npm doar cu aprobare legată de comandă; Fără shell universal

### Codex app-server (local) (`openai.codex_app_server`)

JSON-RPC pe stdio al binarului oficial Codex; turn-uri cu fir nativ, aprobări, rate limits.

- Capabilități: coding, long_running_coding, architecture, code_review, security_review, local_development, testing_qa, documents
- Platformă: Windows (codex.exe din Codex desktop) · Plan: Plan ChatGPT cu Codex · Auth: chatgpt
- Disponibilitate de bază: unknown — Se confirmă cu Verifică contul (account/read)
- Restricții de siguranță: Allowlist de metode JSON-RPC; Cont API key refuzat; Metodele de credite blocate; Aprobările de comenzi/fișiere trec prin politica Hub; Mediu controlat fără chei

### Codex app-server în ifrim-runner (WSL2) (`openai.codex_wsl_runner`)

Același app-server Codex, pornit în distribuția WSL2 dedicată ifrim-runner (utilizator runner, fără discuri Windows, interop oprit), pe o copie a proiectului; exportul e validat (C14) înainte de aplicare.

- Capabilități: coding, long_running_coding, architecture, code_review, security_review, local_development, testing_qa, documents
- Platformă: WSL2 ifrim-runner (Codex CLI Linux fixat) · Plan: Plan ChatGPT cu Codex · Auth: chatgpt
- Disponibilitate de bază: unknown — Se confirmă cu inspecția, verificarea contului prin mediu (C16) și atestarea C1–C17 (Sistem → Medii de execuție)
- Restricții de siguranță: Allowlist de metode JSON-RPC; Cont API key refuzat; Metodele de credite blocate; Aprobările de comenzi/fișiere trec prin politica Hub; Mediu controlat fără chei; env -i (fără variabile Windows); Profil ifrim_runner_rw/ro (:root refuzat); Export validat C14 înainte de aplicare; Fără trecere pe Windows dacă mediul refuză

### Codex CLI (TUI) (`openai.codex_cli`)

CLI interactiv: voce, /agents, worktrees, resume/fork/queue.

- Capabilități: coding, long_running_coding, subagents, worktrees, voice
- Platformă: Terminal · Plan: Plan ChatGPT · Auth: chatgpt
- Disponibilitate de bază: assisted — Folosit de tine direct; Hub-ul automatizează prin app-server, nu prin TUI
- Restricții de siguranță: Nu se dublează ownership-ul taskului cu Hub-ul

### Codex desktop (`openai.codex_desktop`)

Aplicația Codex: browser integrat, computer use, automatizări locale, revizuire cod.

- Capabilități: coding, browser, computer_use, code_review, documents, slides, spreadsheets
- Platformă: Windows desktop · Plan: Plan ChatGPT · Auth: chatgpt
- Disponibilitate de bază: assisted — Instalat local; controlat de tine
- Restricții de siguranță: Computer use și browser rulează pe desktopul tău: un singur controller

### Codex Cloud (`openai.codex_cloud`)

Taskuri în medii cloud pe repository GitHub; codex cloud exec/list/status/diff/apply.

- Capabilități: cloud_development, long_running_coding
- Platformă: Cloud + GitHub · Plan: Plan ChatGPT (vezi auditul) · Auth: chatgpt
- Disponibilitate de bază: needs_setup — Necesită mediu cloud și repository conectat; Hub-ul nu publică cod
- Restricții de siguranță: Pornire = cloud_task.start (ALWAYS_ASK); Vede doar commituri publicate

### Codex Code Review (`openai.codex_review`)

Revizuire în desktop + revizuiri automate în cloud (GitHub PR / GitLab MR).

- Capabilități: code_review
- Platformă: ChatGPT desktop / cloud · Plan: Toate abonamentele (recap) · Auth: chatgpt
- Disponibilitate de bază: assisted — Revizuirea locală o pornești tu; reviewer-ul Hub folosește app-server
- Restricții de siguranță: Doar citire

### Codex Security Cloud (`openai.codex_security`)

Scanări de securitate ale repository-urilor GitHub (la cerere/programat), remedieri în cloud.

- Capabilități: security_review
- Platformă: Plugin Codex desktop/web · Plan: Utilizatori Codex (recap) · Auth: chatgpt
- Disponibilitate de bază: needs_setup — Cere conectarea repository-ului privat (decizia ta)
- Restricții de siguranță: Lipsa constatărilor nu dovedește securitatea

### ChatGPT Work (`openai.chatgpt_work`)

Taskuri agentice în ChatGPT (GPT-6.1 Sol disponibil în Work).

- Capabilități: research, documents, slides, spreadsheets, workflow
- Platformă: ChatGPT web/desktop · Plan: Plus/Pro/Business/Enterprise/Edu · Auth: chatgpt
- Disponibilitate de bază: assisted — Folosit de tine în ChatGPT
- Restricții de siguranță: Rezultatele se înregistrează în Hub ca artefacte

### ChatGPT (chat) (`openai.chatgpt_chat`)

Conversații ChatGPT, memorie și proiecte ChatGPT.

- Capabilități: research, memory, project_knowledge
- Platformă: web/desktop/mobile · Plan: Plan ChatGPT · Auth: chatgpt
- Disponibilitate de bază: assisted — Folosit de tine
- Restricții de siguranță: Memoria ChatGPT nu este memoria Hub

### dots (agenți mereu activi) (`openai.dots`)

Agent cu computer cloud propriu, aplicații conectate, lucru proactiv.

- Capabilități: cloud_autonomous_work, computer_use, browser, scheduled
- Platformă: ChatGPT · Plan: Pro, Business Premium, Enterprise · Auth: chatgpt
- Disponibilitate de bază: unknown — Eligibilitatea planului tău nu este confirmată; fără API documentat
- Restricții de siguranță: Acces la laptop doar dacă îl conectezi tu; Hub-ul nu pornește dots

### Pluginuri / extensii ChatGPT (`openai.plugins`)

Aplicații MCP în ChatGPT: bară laterală, panouri, vizualizatoare; MCP Events.

- Capabilități: plugins, mcp, app_connectors
- Platformă: ChatGPT · Plan: Toate abonamentele (recap) · Auth: chatgpt
- Disponibilitate de bază: blocked — Un companion ar cere endpoint public; expunerea în rețea nu este autorizată
- Restricții de siguranță: Publicarea cere aprobarea ta

### Space / Pages / Slides (`openai.space_pages`)

Spațiu de echipă, pagini dinamice, prezentări colaborative.

- Capabilități: documents, slides, team_collaboration, project_knowledge
- Platformă: ChatGPT desktop/web · Plan: Pro, Business, Enterprise · Auth: chatgpt
- Disponibilitate de bază: unknown — Depinde de planul ChatGPT (neconfirmat)
- Restricții de siguranță: Hub-ul rămâne sursa autoritativă

### Agents API (`openai.agents_api`)

Harness Codex gestionat prin API (facturare API).

- Capabilități: cloud_autonomous_work, computer_use, subagents
- Platformă: API · Plan: Cont API · Auth: api_key
- Disponibilitate de bază: blocked — Facturare API: refuzată de BillingPolicy
- Restricții de siguranță: paid_api_inference: deny

### Decisions API (`openai.decisions_api`)

Clasificare/decizii cu răspunsuri finite (preview, API).

- Capabilități: routing
- Platformă: API · Plan: Cont API (preview) · Auth: api_key
- Disponibilitate de bază: blocked — Facturare API: refuzată; routerul Hub este determinist
- Restricții de siguranță: paid_api_inference: deny

### Claude Code headless (-p) (`anthropic.claude_code_headless`)

Binarul oficial Claude Code în mod print cu stream-json; sesiune reluabilă.

- Capabilități: coding, long_running_coding, architecture, code_review, security_review, local_development, testing_qa, documents, design_ui
- Platformă: Windows (Claude Code CLI) · Plan: Pro/Max · Auth: claude.ai
- Disponibilitate de bază: unknown — Se confirmă cu Verifică contul (claude auth status)
- Restricții de siguranță: Fără --bare/--fallback-model/--max-budget-usd/--dangerously-skip-permissions; Mediu controlat fără ANTHROPIC_*; --strict-mcp-config; Unelte limitate per acces

### Claude Code interactiv (terminal/IDE/desktop) (`anthropic.claude_code_interactive`)

Sesiuni conduse de tine: subagenți, hooks, checkpoints/rewind, skills, pluginuri, worktrees.

- Capabilități: coding, subagents, hooks, checkpoints, background_tasks, worktrees
- Platformă: Terminal, VS Code, JetBrains, Claude desktop · Plan: Pro/Max · Auth: claude.ai
- Disponibilitate de bază: assisted — Folosit de tine; Hub-ul oglindește sesiunile prin claude agents --json
- Restricții de siguranță: Orchestrarea nativă (subagenți) aparține sesiunii Claude; Hub-ul nu dublează ownership-ul

### Sesiuni Claude Code (oglindă) (`anthropic.claude_code_background`)

Listă read-only a sesiunilor locale prin „claude agents --json”.

- Capabilități: background_tasks, mobile_control
- Platformă: Claude Code CLI · Plan: Pro/Max · Auth: claude.ai
- Disponibilitate de bază: unknown — Se confirmă la prima oglindire
- Restricții de siguranță: Doar citire; Sesiunile din afara proiectelor înregistrate sunt doar numărate

### Claude Code în cloud (web) (`anthropic.claude_code_web`)

Sesiuni Claude Code în cloud / pe web.

- Capabilități: cloud_development, long_running_coding
- Platformă: claude.ai · Plan: vezi auditul Anthropic · Auth: claude.ai
- Disponibilitate de bază: unknown — Necesită repository conectat; nepornit de Hub
- Restricții de siguranță: cloud_task.start: ALWAYS_ASK

### Claude (chat web/desktop/mobil) (`anthropic.claude_chat`)

Chat Claude cu memorie, proiecte, artefacte, fișiere.

- Capabilități: research, documents, memory, project_knowledge
- Platformă: web/desktop/mobile · Plan: Pro/Max · Auth: claude.ai
- Disponibilitate de bază: assisted — Plan Max verificat; folosit de tine
- Restricții de siguranță: Memoria Claude nu este memoria Hub

### Claude Cowork / taskuri agentice (`anthropic.claude_cowork`)

Taskuri agentice lungi pe fișiere și aplicații, în experiența Claude unificată.

- Capabilități: workflow, documents, cloud_autonomous_work
- Platformă: Claude desktop · Plan: vezi auditul Anthropic · Auth: claude.ai
- Disponibilitate de bază: unknown — Confirmare în auditul Anthropic
- Restricții de siguranță: Fără control programatic oficial presupus

### Claude Research (`anthropic.claude_research`)

Cercetare agentică multi-sursă cu citări.

- Capabilități: research, lead_research, site_audit
- Platformă: claude.ai · Plan: Pro/Max · Auth: claude.ai
- Disponibilitate de bază: assisted — Plan Max; rulezi tu, rezultatul se înregistrează cu surse
- Restricții de siguranță: Proveniența se păstrează în Hub

### Claude computer use (desktop) (`anthropic.claude_computer_use`)

Control al desktopului prin aplicația Claude.

- Capabilități: computer_use
- Platformă: Claude desktop · Plan: vezi auditul Anthropic · Auth: claude.ai
- Disponibilitate de bază: needs_setup — Research preview în Claude Desktop pe Windows: îl activezi tu în Settings; controlat de tine (ASSISTED). Nu există în -p.
- Restricții de siguranță: computer.visual_control: ALWAYS_ASK; Un singur controller pe fereastră

### Claude in Chrome (`anthropic.claude_in_chrome`)

Extensie care acționează în Chrome-ul tău (cu autentificările tale).

- Capabilități: browser, authenticated_web
- Platformă: Chrome · Plan: vezi auditul Anthropic · Auth: claude.ai
- Disponibilitate de bază: needs_setup — Cere extensia Claude in Chrome instalată și conectată de tine; conturile reale → browser.native ALWAYS_ASK. Rulările Hub folosesc --no-chrome.
- Restricții de siguranță: Date de autentificare reale; Protecții prompt-injection ale vendorului + politica Hub

### Browser integrat Claude desktop (`anthropic.claude_desktop_browser`)

Panou browser izolat în aplicația Claude.

- Capabilități: browser
- Platformă: Claude desktop · Plan: Plan Claude · Auth: claude.ai
- Disponibilitate de bază: assisted — Disponibil în sesiunile Claude desktop
- Restricții de siguranță: Profil separat de Chrome

### Claude Projects (`anthropic.claude_projects`)

Instrucțiuni, fișiere și cunoștințe de proiect (RAG pe planurile plătite).

- Capabilități: project_knowledge
- Platformă: claude.ai · Plan: Pro/Max · Auth: claude.ai
- Disponibilitate de bază: assisted — Asociere HubProject ↔ ClaudeProject doar ca referință
- Restricții de siguranță: Fără sincronizare bidirecțională presupusă

### Taskuri programate Claude (desktop) (`anthropic.claude_scheduled_desktop`)

Taskuri recurente în aplicația Claude desktop.

- Capabilități: scheduled
- Platformă: Claude desktop · Plan: Plan Claude · Auth: claude.ai
- Disponibilitate de bază: assisted — Disponibil (0 taskuri); creezi tu, Hub-ul le referențiază
- Restricții de siguranță: native_schedule.create: ALWAYS_ASK; Consumă allowance la rulare

### Rutine Claude Code (cloud) (`anthropic.claude_routines_cloud`)

Agenți programați în cloud (/schedule).

- Capabilități: scheduled, cloud_autonomous_work
- Platformă: Claude Code / claude.ai · Plan: vezi auditul Anthropic · Auth: claude.ai
- Disponibilitate de bază: unknown — Nu se creează în BUILD_SAFE
- Restricții de siguranță: native_schedule.create: ALWAYS_ASK

### Artefacte Claude (`anthropic.claude_artifacts`)

Documente, pagini, prezentări, instrumente interactive.

- Capabilități: documents, slides, spreadsheets
- Platformă: claude.ai / desktop · Plan: Plan Claude · Auth: claude.ai
- Disponibilitate de bază: assisted — Referințe înregistrate în Hub (ArtifactReference)
- Restricții de siguranță: Fără export automat pretins

### Connectori Claude / MCP (`anthropic.claude_connectors`)

Connectori din director, MCP remote, extensii desktop.

- Capabilități: app_connectors, mcp
- Platformă: claude.ai / desktop · Plan: Plan Claude · Auth: claude.ai
- Disponibilitate de bază: assisted — Conectați: Claude Docs, visualize, scheduled-tasks
- Restricții de siguranță: connector.write: ALWAYS_ASK

### Pluginuri Claude (`anthropic.claude_plugins`)

Pachete de skills, connectori, subagenți, hooks.

- Capabilități: plugins, skills
- Platformă: Claude Code / claude.ai · Plan: Plan Claude · Auth: claude.ai
- Disponibilitate de bază: assisted — Hub-ul exportă un pachet local; instalarea o faci tu
- Restricții de siguranță: Fără publicare; Fără shell nerestricționat

### Claude Skills (`anthropic.claude_skills`)

Skills în format Agent Skills (claude.ai și Claude Code).

- Capabilități: skills
- Platformă: claude.ai / Claude Code · Plan: Plan Claude · Auth: claude.ai
- Disponibilitate de bază: assisted — 13 skills active pe claude.ai; Hub-ul folosește același format
- Restricții de siguranță: Un skill nu acordă permisiuni

### Claude mobil / Remote Control (`anthropic.claude_mobile_remote`)

Continuarea și controlul sesiunilor desktop de pe telefon.

- Capabilități: mobile_control
- Platformă: Claude mobile + desktop · Plan: vezi auditul Anthropic · Auth: claude.ai
- Disponibilitate de bază: assisted — Pentru sesiunile Claude; statusul cross-provider și Stop All rămân în Hub
- Restricții de siguranță: Aprobările Hub nu se dau de pe mobil prin vendor

### OpenClaw gateway (V1) (`openclaw.gateway`)

Gateway izolat folosit de V1 pentru Codex.

- Capabilități: channels, scheduled
- Platformă: Node (global npm) 127.0.0.1:18790 · Plan: n/a · Auth: variază
- Disponibilitate de bază: blocked — Retras din runtime-ul V2 (probă ambientală spre API plătit în V1; al doilea orchestrator)
- Restricții de siguranță: Procesul rămâne neatins până la decizia ta
