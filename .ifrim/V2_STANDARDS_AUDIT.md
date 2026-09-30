# Standarde deschise (Agent Skills, MCP, AGENTS.md, A2A)

> Generat din `v2/config/ecosystem/` de `v2/scripts/gen-ecosystem-docs.mjs`. Verificat: 2026-09-30. Nu edita manual: modifică JSON-ul și regenerează.

Standardele sunt stratul de portabilitate între ecosisteme; Hub-ul le preferă formatelor proprietare.

## Tabel sintetic

| ID | Capabilitate | Status | Plan | Inclus | Risc API | Control | Decizie Hub | Relevanță |
|---|---|---|---|---|---|---|---|---|
| std-agent-skills-spec | Agent Skills: specificația deschisă SKILL.md (formatul canonic al unu… | AVAILABLE | Niciunul pentru format (standard deschis). Folosirea efecti… | not_applicable | none | PROGRAMMATIC | REIMPLEMENT | HIGH |
| std-agent-skills-allowed-tools | Agent Skills: câmpul experimental allowed-tools și regula „un skill n… | DOCUMENTED | n/a | not_applicable | none | PROGRAMMATIC | REJECT | HIGH |
| std-agent-skills-discovery-paths | Agent Skills: locații de descoperire (convenția cross-client .agents/… | AVAILABLE | n/a | not_applicable | none | PROGRAMMATIC | REUSE_NATIVE | HIGH |
| std-agent-skills-progressive-disclosure | Agent Skills: progressive disclosure (catalog → instrucțiuni → resurs… | DOCUMENTED | n/a | not_applicable | none | PROGRAMMATIC | REIMPLEMENT | MEDIUM |
| std-agent-skills-skills-ref | skills-ref: bibliotecă de referință pentru validarea skill-urilor | NEEDS_SETUP | n/a | not_applicable | none | PROGRAMMATIC | REFERENCE | MEDIUM |
| std-mcp-core-2026-07-28 | Model Context Protocol: revizia curentă 2026-07-28 (nucleu stateless) | DOCUMENTED | n/a (standard deschis) | not_applicable | none | PROGRAMMATIC | REIMPLEMENT | HIGH |
| std-mcp-authorization | MCP: autorizare OAuth 2.1 pentru transporturi HTTP | DOCUMENTED | n/a | not_applicable | none | PROGRAMMATIC | REFERENCE | MEDIUM |
| std-mcp-elicitation | MCP: elicitation (moduri form și URL) | AVAILABLE | n/a | not_applicable | none | PROGRAMMATIC | WRAP | MEDIUM |
| std-mcp-structured-tool-output | MCP: ieșire structurată a tool-urilor (outputSchema / structuredConte… | DOCUMENTED | n/a | not_applicable | none | PROGRAMMATIC | REIMPLEMENT | MEDIUM |
| std-mcp-tasks-extension | MCP Tasks (extensia oficială io.modelcontextprotocol/tasks) | DOCUMENTED | n/a | not_applicable | none | PROGRAMMATIC | REFERENCE | MEDIUM |
| std-mcp-apps | MCP Apps (extensia io.modelcontextprotocol/ui, UI interactiv în conve… | DOCUMENTED | n/a | not_applicable | none | PROGRAMMATIC | REFERENCE | MEDIUM |
| std-mcp-skills-extension | Skills over MCP (extensia io.modelcontextprotocol/skills, SEP-2640) | DOCUMENTED | n/a | not_applicable | none | PROGRAMMATIC | REIMPLEMENT | HIGH |
| std-mcp-triggers-events | MCP Triggers & Events (propunere de working group, extensie experimen… | BLOCKED | n/a pentru standard; ChatGPT: toate abonamentele (conform r… | not_applicable | none | NONE | REFERENCE | MEDIUM |
| std-mcp-registry | MCP Registry oficial (metadate pentru servere MCP publice) | DOCUMENTED | n/a | not_applicable | none | PROGRAMMATIC | REFERENCE | LOW |
| std-agents-md | AGENTS.md (convenție deschisă de instrucțiuni pentru agenți) | AVAILABLE | n/a | not_applicable | none | PROGRAMMATIC | REUSE_NATIVE | HIGH |
| std-a2a | Agent2Agent (A2A) Protocol v1.0 | DOCUMENTED | n/a | not_applicable | none | NONE | REFERENCE | LOW |
| std-acp | Agent Client Protocol (ACP), protocol editor↔agent de cod | DOCUMENTED | n/a | no | high | NONE | REJECT | LOW |
| std-gap-mcpb-bundles | MCP Bundles (MCPB, .mcpb, fost DXT): format deschis de împachetare a … | NEEDS_SETUP | Niciunul pentru format și CLI (open source: MIT pentru codu… | not_applicable | none | PROGRAMMATIC | WRAP | MEDIUM |
| std-gap-mcp-ext-oauth-client-credentials | MCP: extensia OAuth Client Credentials (io.modelcontextprotocol/oauth… | DOCUMENTED | Niciunul (standard deschis). Necesită un authorization serv… | not_applicable | none | PROGRAMMATIC | REFERENCE | LOW |
| std-gap-mcp-ext-enterprise-managed-auth | MCP: extensia Enterprise-Managed Authorization (io.modelcontextprotoc… | PLAN_RESTRICTED | IdP enterprise obligatoriu; la Anthropic, doar Claude Team … | no | high | NONE | NOT_APPLICABLE | NONE |
| std-gap-agent-skills-evals | Agent Skills: evaluarea calității output-ului (evals/evals.json, grad… | NEEDS_SETUP | Niciunul pentru format. Rulările folosesc planul clientului… | yes | low | PROGRAMMATIC | REIMPLEMENT | HIGH |

## skills

### Agent Skills: specificația deschisă SKILL.md (formatul canonic al unui skill) (`std-agent-skills-spec`)

- **Sursă oficială:** https://agentskills.io/specification
- **Documentație tehnică:** https://agentskills.io/client-implementation/adding-skills-support.md
- **Ce face:** Format deschis pentru proceduri reutilizabile: un skill este un director cu SKILL.md (frontmatter YAML + corp Markdown) și, opțional, scripts/, references/, assets/. Frontmatter: name (obligatoriu; 1–64 caractere a-z, 0-9 și cratimă; fără cratimă la capete, fără „--”; identic cu numele directorului), description (obligatoriu; 1–1024; ce face și când se folosește), license, compatibility (1–500 caractere, cerințe de mediu), metadata (map string→string), allowed-tools (experimental). Recomandări: SKILL.md sub 500 de linii și sub ~5000 de tokeni, referințe relative cu un singur nivel de adâncime.
- **Plan necesar:** Niciunul pentru format (standard deschis). Folosirea efectivă depinde de clientul care îl încarcă (Claude Max / planul ChatGPT).
- **Platformă:** Independent de platformă. Clienți listați pe agentskills.io: Claude Code, Claude, ChatGPT & Codex, Gemini CLI, Cursor, VS Code, GitHub Copilot, OpenCode, OpenHands, Goose, Junie, Kiro, OpenClaw și mulți alții.
- **Rollout:** Publicat și adoptat larg; dezvoltat inițial de Anthropic și lansat ca standard deschis; pagina specificației nu afișează număr de versiune sau dată.
- **Eligibilitate cont:** Nu depinde de cont. Local: Claude Code 2.1.175 expune --disable-slash-commands („Disable all skills”), deci are suport de skills; Codex 0.158 raportează skill_search=true și skill_mcp_dependency_install=true.
- **Autentificare:** n/a (fișiere pe disc)
- **Allowance:** n/a; catalogul costă ~50–100 tokeni per skill în contextul clientului, corpul se încarcă doar la activare.
- **Utilizare partajată:** Tokenii consumați când un skill rulează într-un turn se contabilizează în limitele planului clientului (Claude Max sau ChatGPT).
- **Inclus în abonament?:** not_applicable
- **Risc de facturare suplimentară (credite/extra usage):** Formatul nu generează costuri. De evitat: Skills API de pe Claude API (/v1/skills, cu code execution tool) este facturare API și este refuzat de BillingPolicy.
- **Risc de facturare API:** none
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Fișiere citite nativ de clienți. Claude Code: ~/.claude/skills/<nume>/SKILL.md, .claude/skills/ (și în directoarele părinte până la rădăcina repo-ului, plus directoare imbricate), skill-uri de plugin, --add-dir; invocare /nume; --disable-slash-commands dezactivează toate skill-urile. Codex: .agents/skills (REPO), $HOME/.agents/skills (USER), /etc/codex/skills (ADMIN), SYSTEM; invocare $nume; dezactivare prin [[skills.config]] path=… enabled=false în ~/.codex/config.toml; metadate opționale în agents/openai.yaml (interface, policy.allow_implicit_invocation, dependencies.tools). Validare de referință: skills-ref validate <dir>.
- **Suprafață nativă:** Claude Code: meniul / și /skills; claude.ai: Settings > Features (upload zip, individual per utilizator, fără sincronizare cu API-ul); ChatGPT/Codex: @skill în ChatGPT, $skill în Codex, $skill-installer, $skill-creator.
- **Cerințe locale:** Parser YAML strict și validator în Node în v2/server (fără pachete noi instalate fără aprobare). În repo nu există acum .agents/skills sau .claude/skills.
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Formatul canonic de schimb pentru procedurile Hub-ului (v2/config/skills.json și tabelele skills/skill_versions, deja marcate „Agent Skills-compatible” în migrarea m01), exportabil identic către Claude Code și Codex. Hub-ul rămâne sursa de adevăr pentru versiune, aprobare și nivel de permisiune.
- **Suprafață de execuție:** hub.local
- **Echivalent la celălalt ecosistem:** Anthropic: skills Claude Code (superset al standardului) și claude.ai/Skills API (acceptă doar cele 6 câmpuri standard). OpenAI: skills Codex/ChatGPT (standard + agents/openai.yaml). Ambele apar oficial în lista de clienți agentskills.io.
- **Ce face unic / mai bine:** Singurul format de proceduri suportat nativ de ambele ecosisteme; progressive disclosure; portabil prin copierea directorului; schemă minimă (două câmpuri obligatorii), deci risc mic de lock-in.
- **Securitate:** Un skill combină instrucțiuni și cod executabil: poate direcționa agentul spre scripturi, rețea sau exfiltrare; skill-urile de proiect dintr-un repo neîncrezător injectează instrucțiuni în context; allowed-tools poate acorda permisiuni reale în Claude Code (vezi std-agent-skills-allowed-tools). Anthropic recomandă doar skill-uri din surse de încredere și auditarea tuturor fișierelor.
- **Cale de implementare:** 1) Validator Node cu regulile specificației (name, description, compatibility, nume = director, fără „--”), tolerant la import, strict la export. 2) SKILL.md canonic cu exclusiv cheile standard; extensiile Hub (id intern, rol, nivel de permisiune, intrări/ieșiri, teste) într-un fișier lateral (ex. hub.json) și în DB, nu în frontmatter. 3) Manifest per fișier (cale relativă, sha256, dimensiune) în skill_versions.files_json. 4) Conversia celor 11 proceduri din v2/config/skills.json (id-urile existente sunt deja nume valide). 5) Export deterministic către locațiile native doar după aprobarea explicită a versiunii.
- **Test necesar:** Fără modele: fixture-uri valide/invalide (majuscule, „--”, peste 64 de caractere, description goală, name diferit de director, YAML cu „:” neescapat, chei nestandard); round-trip import→export cu sha256 identic; verificare că frontmatter-ul exportat conține doar cheile acceptate de uploadul claude.ai/Skills API.
- **Status:** AVAILABLE
- **Decizie Hub:** REIMPLEMENT
- **Încredere:** high
- **Note:** RECOMANDARE: da, formatul canonic al Hub-ului trebuie să fie compatibil Agent Skills, cu Hub-ul ca plan de control canonic și directoarele native doar ca ținte de export. (a) Frontmatter canonic: name, description, license, compatibility, metadata; Hub-ul nu scrie allowed-tools. Orice cheie în afara celor 6 standard face ca uploadul pe claude.ai/Skills API să eșueze cu eroare. (b) Nume: evită „anthropic” și „claude” (rezervate pe platforma Claude). (c) metadata acceptă doar valori string: folosește chei cu prefix (ex. ifrim-skill-version) numai pentru trasabilitate, nu pentru politici. (d) Câmpurile specifice vendorilor se generează la export și nu intră în canonic: pentru Claude Code disable-model-invocation: true la skill-urile cu efecte; pentru Codex agents/openai.yaml cu policy.allow_implicit_invocation: false; dependencies.tools nu se exportă fără aprobare. (e) Permisiunile nu vin niciodată din skill (vezi std-agent-skills-allowed-tools); nota existentă din v2/config/skills.json („A skill never raises its own permission tier”) este consecventă.
- **Surse citite:** https://agentskills.io/ · https://agentskills.io/specification · https://agentskills.io/llms.txt · https://agentskills.io/client-implementation/adding-skills-support.md · https://agentskills.io/skill-creation/using-scripts.md · https://code.claude.com/docs/en/skills · https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview · https://learn.chatgpt.com/docs/build-skills (redirect de la developers.openai.com/codex/skills) · local: claude --version / claude --help (2.1.175) · local: sources-openai-devday.md (codex features list, 0.158) · local: v2/config/skills.json, v2/server/storage/migrations.mjs
- **Verificare adversarială:** CONFIRMED — Am verificat pe agentskills.io/specification: cele 6 câmpuri și regulile pentru name, description și compatibility; allowed-tools apare ca experimental. Tot acolo: ~100 de tokeni pentru metadate, sub 5000 de tokeni și sub 500 de linii pentru corp, referințe la un singur nivel, skills-ref validate. Pagina principală agentskills.io confirmă originea Anthropic și lista de clienți (Claude Code, Claude, ChatGPT & Codex, Gemini CLI, Cursor, VS Code, GitHub Copilot, OpenCode, OpenHands, Goose, Junie, Kiro, OpenClaw). code.claude.com/docs/en/skills confirmă că uploadul claude.ai, Skills API și package_skill.py acceptă doar cele 6 chei, altfel dau eroare. platform.claude.com confirmă: numele nu pot conține „anthropic” sau „claude”; skill-urile custom pe claude.ai merg pe Pro/Max/Team/Enterprise cu code execution; nu există sincronizare între suprafețe; Skills API cere code execution tool, deci facturare API. learn.chatgpt.com/docs/build-skills confirmă REPO/USER/ADMIN/SYSTEM, [[skills.config]] și agents/openai.yaml. Verificat local: claude 2.1.175 --help are --disable-slash-commands; codex features list arată skill_search și skill_mcp_dependency_install stable true. Completări: Claude Code rezervă și numele de director „synced” și „anthropic-skills”. REIMPLEMENT se justifică doar pentru registrul și validatorul Hub-ului; încărcarea rămâne nativă, în practică REUSE_NATIVE. Observație locală cu încredere scăzută: binarul Codex 0.158 conține un text de validator cu allowed_properties {name, description, license, allowed-tools, metadata}, fără compatibility. Un SKILL.md canonic cu compatibility trebuie deci verificat cu $skill-creator înainte de export.

### Agent Skills: locații de descoperire (convenția cross-client .agents/skills vs. .claude/skills) (`std-agent-skills-discovery-paths`)

- **Sursă oficială:** https://agentskills.io/client-implementation/adding-skills-support.md
- **Documentație tehnică:** https://learn.chatgpt.com/docs/build-skills
- **Ce face:** Specificația nu impune locul skill-urilor. Ghidul pentru clienți recomandă scanarea scopurilor proiect și utilizator, atât în directorul propriu al clientului, cât și în convenția cross-client .agents/skills; unele implementări scanează și .claude/skills. Ghidul mai recomandă (fără să impună) trei lucruri: proiectul are prioritate față de utilizator, coliziunile se jurnalizează, iar skill-urile de proiect se încarcă doar după o verificare de încredere. Clienții reali se abat de la aceste recomandări. Claude Code dă prioritate enterprise > personal > proiect și aplică allowed-tools al unui skill de proiect fără workspace trust. Codex nu îmbină skill-urile cu același nume; ambele pot apărea în selector. Codex citește .agents/skills în scopul REPO ($CWD, $CWD/.. și $REPO_ROOT), apoi $HOME/.agents/skills (USER), /etc/codex/skills (ADMIN) și skill-urile SYSTEM, urmând symlink-urile. Claude Code citește: directorul enterprise managed, ~/.claude/skills, .claude/skills (în părinți până la rădăcina repo-ului și în subdirectoare), --add-dir și skill-urile de plugin. Din v2.1.273 citește și ~/.claude/skills/synced/, cu skill-urile contului claude.ai. Documentația Claude Code citită nu menționează .agents/skills.
- **Plan necesar:** n/a
- **Platformă:** Windows 11: symlink-urile cer drepturi de administrator sau Developer Mode; copiile de fișiere sunt varianta sigură.
- **Rollout:** Convenție de facto, nu cerință a specificației.
- **Eligibilitate cont:** Local, în repo lipsesc .agents/ și .claude/skills (există .claude/agents), iar ~/.claude/skills nu există. În schimb, ~/.agents/skills (scop USER, citit de Codex) conține deja 14 skill-uri terțe instalate în afara Hub-ului, printre care agents-sdk, cloudflare, cloudflare-one, durable-objects, wrangler și sandbox-*. Frontmatter-ul lor are doar name și description; două au și cheia nestandard references, iar unul are scripts/. Rulările Codex lansate de Hub le văd. ~/.codex/skills conține hatch-pet, playwright și cache-ul .system (imagegen, openai-docs, plugin-creator, review-agent, skill-creator, skill-installer). Pagina citită nu spune dacă 0.158 mai citește partea din afara .system. Cele 13 skill-uri ale contului claude.ai nu sunt sincronizate local: sincronizarea în terminal cere Claude Code ≥2.1.273, iar local rulează 2.1.175.
- **Autentificare:** n/a
- **Allowance:** n/a
- **Utilizare partajată:** n/a
- **Inclus în abonament?:** not_applicable
- **Risc de facturare suplimentară (credite/extra usage):** Niciunul.
- **Risc de facturare API:** none
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Scriere/citire de fișiere în .claude/skills/<nume>/ (Claude Code) și .agents/skills/<nume>/ (Codex); inventar read-only al scopurilor utilizator (~/.claude/skills, $HOME/.agents/skills) fără a citi fișiere secrete.
- **Suprafață nativă:** Claude Code /skills; Codex $skill și /skills.
- **Cerințe locale:** Scrierea în repo sau în directoarele utilizatorului cere aprobarea proprietarului.
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Hub-ul materializează versiunile aprobate în ambele locații native (copii, nu symlink-uri), urmărește proveniența prin sha256 în DB și semnalează drift-ul sau skill-urile apărute în afara Hub-ului.
- **Suprafață de execuție:** hub.local
- **Echivalent la celălalt ecosistem:** Anthropic: .claude/skills + skills sincronizate de pe claude.ai; OpenAI: .agents/skills + skill-uri ADMIN/SYSTEM.
- **Ce face unic / mai bine:** Aceeași structură de director funcționează în ambele locații fără conversie de conținut.
- **Securitate:** Skill-uri de proiect dintr-un repo clonat pot injecta instrucțiuni nevăzute; skill-urile sincronizate de pe claude.ai pot intra în rulările Claude ale Hub-ului; un fișier nou adăugat în directorul unui skill nu trebuie considerat aprobat.
- **Cale de implementare:** 1) Export la cerere în ambele locații, cu verificare sha256 post-scriere. 2) Detecție de drift: compară periodic sha256 de pe disc cu versiunea aprobată; diferența blochează rularea. 3) Extinde inspectWorkspaceStartup la .agents/skills. 4) Pentru rulările Claude fără skill aprobat, --disable-slash-commands exclude și skill-urile sincronizate.
- **Test necesar:** Fixture cu același skill în .agents/skills și .claude/skills → export identic; drift simulat (un byte schimbat) → rulare blocată; proiect neîncrezător cu .agents/skills → rulare Codex blocată.
- **Status:** AVAILABLE
- **Decizie Hub:** REUSE_NATIVE
- **Încredere:** medium
- **Note:** Faptul că Claude Code nu citește .agents/skills este dedus din absența mențiunii în documentație (nu din test). Ghidul agentskills.io notează că unii clienți scanează și .claude/skills pentru compatibilitate.
- **Surse citite:** https://agentskills.io/client-implementation/adding-skills-support.md · https://learn.chatgpt.com/docs/build-skills · https://code.claude.com/docs/en/skills · https://code.claude.com/docs/en/memory · local: listare repo (fără .agents/, fără .claude/skills; există .claude/agents/ifrim-claude-code-reviewer.md)
- **Verificare adversarială:** CORRECTED (corectat: whatItDoes (https://agentskills.io/client-implementation/adding-skills-support.md; https://code.claude.com/docs/en/skills; https://learn.chatgpt.com/docs/build-skills), accountEligibility (local: listarea ~/.agents/skills, ~/.codex/skills, ~/.claude; claude --version; https://code.claude.com/docs/en/skills (Syncing in terminal sessions requires v2.1.273)), status (local: codex features list (skill_search stable true); binarul codex 0.158 conține „.agents/skills”; ~/.agents/skills populat; claude --help 2.1.175 (--disable-slash-commands „Disable all skills”))) — Am confirmat trei lucruri. Tabelul Codex include $CWD/../.agents/skills și ADMIN /etc/codex/skills; symlink-urile sunt urmate, iar numele duplicate nu se îmbină. Locațiile Claude Code (enterprise, personal, proiect, imbricat, --add-dir, plugin, cont claude.ai) corespund documentației. Documentația Claude Code nu menționează .agents/skills. Recomandare: inventarul read-only al Hub-ului să includă ~/.agents/skills, ~/.codex/skills și ~/.claude/skills/synced și să trateze ca neaprobat orice skill care nu provine din Hub.

### Agent Skills: progressive disclosure (catalog → instrucțiuni → resurse) (`std-agent-skills-progressive-disclosure`)

- **Sursă oficială:** https://agentskills.io/specification
- **Documentație tehnică:** https://agentskills.io/client-implementation/adding-skills-support.md
- **Ce face:** Trei niveluri de încărcare: (1) catalog name + description la pornire (~50–100 tokeni per skill); (2) corpul SKILL.md la activare (sub 5000 de tokeni recomandat); (3) scripturi, referințe și asset-uri doar când instrucțiunile le cer. Ghidul recomandă activare de către model sau explicită de către utilizator (/nume, $nume), împachetarea conținutului în etichete structurate, protejarea conținutului skill-ului la compactare, deduplicarea activărilor, ascunderea completă din catalog a skill-urilor filtrate și, opțional, rularea într-un subagent.
- **Plan necesar:** n/a
- **Platformă:** Implementat nativ de Claude Code și Codex; necesar în Hub doar pentru injecție mediată.
- **Rollout:** Parte a specificației.
- **Eligibilitate cont:** n/a
- **Autentificare:** n/a
- **Allowance:** Reduce consumul de context din planul clientului.
- **Utilizare partajată:** n/a
- **Inclus în abonament?:** not_applicable
- **Risc de facturare suplimentară (credite/extra usage):** Niciunul.
- **Risc de facturare API:** none
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Claude Code: --append-system-prompt sau prompt pe stdin pentru catalog și conținut (cu --disable-slash-commands când Hub-ul controlează skill-urile). Codex app-server: conținutul intră în turn/start. Format de catalog sugerat de skills-ref: bloc <available_skills>.
- **Suprafață nativă:** n/a
- **Cerințe locale:** Niciuna în plus.
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Pentru rulările în care Hub-ul injectează el însuși skill-ul (Claude cu --disable-slash-commands, handoff între vendori, rute fără suport nativ): catalog filtrat după nivelul de permisiune, corp doar la activare, versiunea înregistrată în agent_runs.skill_versions_json.
- **Suprafață de execuție:** hub.local
- **Echivalent la celălalt ecosistem:** Anthropic și OpenAI implementează nativ aceleași trei niveluri.
- **Ce face unic / mai bine:** Permite multe skill-uri disponibile cu cost mic de context și audit precis al versiunii folosite.
- **Securitate:** Conținutul skill-ului injectat devine instrucțiune de sistem/utilizator; trebuie marcat cu proveniența și versiunea aprobată; resursele nu se preîncarcă.
- **Cale de implementare:** Modul Hub de catalog + activare, cu etichete de proveniență, deduplicare pe run și excludere din sumarizarea de compactare a Hub-ului.
- **Test necesar:** Test fără modele: catalogul conține doar skill-urile permise nivelului rulării; corpul apare o singură dată; resursele nu se citesc până nu sunt cerute.
- **Status:** DOCUMENTED
- **Decizie Hub:** REIMPLEMENT
- **Încredere:** high
- **Note:** Pentru rulările native (skill exportat și aprobat) clienții gestionează singuri progressive disclosure; Hub-ul doar înregistrează ce versiune era disponibilă.
- **Surse citite:** https://agentskills.io/specification · https://agentskills.io/client-implementation/adding-skills-support.md · https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview · https://github.com/agentskills/agentskills/tree/main/skills-ref
- **Verificare adversarială:** CONFIRMED — Confirmat pe specificație (~100 de tokeni pentru metadate) și pe ghidul pentru clienți: ~50–100 de tokeni per skill în catalog, etichete structurate, protecție la compactare, deduplicare, ascunderea skill-urilor filtrate și subagent opțional. README-ul skills-ref confirmă formatul <available_skills> produs de to-prompt. Nuanțe: după compactare, Claude Code reatașează primii 5.000 de tokeni din fiecare skill invocat, într-un buget comun de 25.000. Codex 0.158 nu are un comutator echivalent cu --disable-slash-commands: skip_host_skill_discovery este „under development” și false. Prin urmare, conținutul injectat de Hub coexistă cu skill-urile native SYSTEM și USER (local, ~/.agents/skills are 14). Ele pot fi dezactivate doar prin [[skills.config]], o modificare de configurație care cere aprobare.

### skills-ref: bibliotecă de referință pentru validarea skill-urilor (`std-agent-skills-skills-ref`)

- **Sursă oficială:** https://github.com/agentskills/agentskills/tree/main/skills-ref
- **Documentație tehnică:** https://agentskills.io/specification
- **Ce face:** Bibliotecă Python (Apache-2.0) cu CLI skills-ref: validate (structură și frontmatter), read-properties (metadate JSON), to-prompt (bloc XML <available_skills> pentru prompt). Depozitul precizează că este destinată demonstrației, nu producției.
- **Plan necesar:** n/a
- **Platformă:** Python, instalare prin pip sau uv.
- **Rollout:** Disponibil în depozitul oficial agentskills.
- **Eligibilitate cont:** Neinstalat local.
- **Autentificare:** n/a
- **Allowance:** n/a
- **Utilizare partajată:** n/a
- **Inclus în abonament?:** not_applicable
- **Risc de facturare suplimentară (credite/extra usage):** Niciunul.
- **Risc de facturare API:** none
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** skills-ref validate <dir>; skills-ref read-properties <dir>; skills-ref to-prompt <dir>…
- **Suprafață nativă:** CLI.
- **Cerințe locale:** Python + pip/uv; instalarea și clonarea sunt interzise fără aprobare explicită.
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Oracol de test opțional pentru validatorul Node al Hub-ului, nu dependență de runtime.
- **Suprafață de execuție:** hub.local
- **Echivalent la celălalt ecosistem:** Anthropic: package_skill.py din anthropics/skills validează aceleași 6 chei; OpenAI: $skill-creator.
- **Ce face unic / mai bine:** Implementarea de referință a regulilor specificației.
- **Securitate:** Instalarea de pachete noi este o acțiune care cere aprobare.
- **Cale de implementare:** Reimplementează regulile în Node; dacă proprietarul aprobă instalarea, compară rezultatele pe fixture-uri într-un test local separat.
- **Test necesar:** Paritate validator Node ↔ skills-ref pe același set de fixture-uri (doar după aprobarea instalării).
- **Status:** NEEDS_SETUP
- **Decizie Hub:** REFERENCE
- **Încredere:** medium
- **Note:** Informațiile despre comenzi și statutul „demonstrativ” provin dintr-un rezumat automat al paginii GitHub; README-ul complet nu a fost citit integral.
- **Surse citite:** https://github.com/agentskills/agentskills/tree/main/skills-ref · https://agentskills.io/specification
- **Verificare adversarială:** CONFIRMED — README-ul citit confirmă: Python, licență Apache 2.0, comenzile validate, read-properties și to-prompt, iar în API-ul Python funcțiile validate, read_properties și to_prompt. Confirmă și avertismentul că biblioteca este doar demonstrativă, nu pentru producție. Instalarea documentată este pip install -e . dintr-o copie locală a depozitului, deci presupune clonare, interzisă fără aprobare. Asta e consecvent cu NEEDS_SETUP și REFERENCE.

### Skills over MCP (extensia io.modelcontextprotocol/skills, SEP-2640) (`std-mcp-skills-extension`)

- **Sursă oficială:** https://modelcontextprotocol.io/extensions/skills/overview
- **Documentație tehnică:** https://github.com/modelcontextprotocol/ext-skills
- **Ce face:** Serverele MCP expun skill-uri Agent Skills: skills/list și skills/get întorc frontmatter-ul neschimbat și un manifest complet (URI, sha256 și dimensiune pentru fiecare fișier) sau "dynamic"; conținutul se citește cu resources/read (schema skill:// recomandată) și opțional resources/directory/read. Hostul trebuie să verifice dimensiunea, digestul și frontmatter-ul, să restrângă citirile la manifestul reținut, să lege aprobarea persistentă de setul complet de URI-uri și digesturi (orice schimbare o revocă), să nu preia fișiere înainte de nevoie, să trateze conținutul ca nesigur, să nu permită înlocuirea tăcută a unui skill cu același nume și să ceară aprobare explicită per skill pentru execuție de cod pe host și allowed-tools. Limite recomandate: 512 fișiere / 16 MiB per skill.
- **Plan necesar:** n/a
- **Platformă:** Matrice: ChatGPT (parțial; subset static: max. 5 skill-uri, 100 fișiere/skill, 256 KiB pentru SKILL.md, 5 MiB/skill), fast-agent (parțial), MCP Inspector (parțial, verificare), mcpc (complet). Claude, Claude Code și Codex nu apar.
- **Rollout:** SEP-2640 marcat Final pe modelcontextprotocol.io; suportul în SDK-uri și hosturi este în curs; documentația OpenAI îl numește încă draft.
- **Eligibilitate cont:** Nu există client local verificat care să-l folosească.
- **Autentificare:** Moștenită de la serverul MCP.
- **Allowance:** n/a
- **Utilizare partajată:** n/a
- **Inclus în abonament?:** not_applicable
- **Risc de facturare suplimentară (credite/extra usage):** ChatGPT ar cere endpoint HTTPS public (neautorizat).
- **Risc de facturare API:** none
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** server/discover cu resources + extensions["io.modelcontextprotocol/skills"] { directoryRead }; skills/list (paginat, cu ttlMs/cacheScope), skills/get { uri }, resources/read, resources/directory/read; eroare -32602 pentru skill necunoscut.
- **Suprafață nativă:** Importul de skill-uri din serverul MCP al unui plugin ChatGPT.
- **Cerințe locale:** Depinde de serverul MCP local al Hub-ului.
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Modelul de integritate și aprobare pentru registrul de skill-uri al Hub-ului (manifest sha256 + aprobare legată de manifest), aplicat imediat; ulterior serverul MCP Hub poate expune skills/list/get către clienții compatibili.
- **Suprafață de execuție:** hub.mcp_server
- **Echivalent la celălalt ecosistem:** Anthropic: nu apare suport în matrice. OpenAI: suport parțial în ChatGPT plugins.
- **Ce face unic / mai bine:** Singurul mecanism standard de distribuire a skill-urilor prin protocol, cu reguli explicite de integritate și aprobare.
- **Securitate:** Digesturile dovedesc consistența cu manifestul, nu încrederea în conținut; skill-urile „dynamic” nu pot avea aprobare persistentă; cache-ul pe disc trebuie imutabil și exclus din descoperirea pe sistemul de fișiere.
- **Cale de implementare:** Acum: skill_versions.files_json = listă {path, sha256, size}; aprobarea stochează hash-ul manifestului; orice diferență revocă aprobarea. Mai târziu: implementare skills/list/get în serverul MCP Hub, doar local.
- **Test necesar:** Fără modele: manifest calculat din bytes; schimbarea/adăugarea/ștergerea unui fișier revocă aprobarea; citire în afara manifestului refuzată.
- **Status:** DOCUMENTED
- **Decizie Hub:** REIMPLEMENT
- **Încredere:** high
- **Note:** Regula „allowed-tools și execuția de cod cer aprobare explicită per skill” confirmă din partea standardului MCP recomandarea ca un skill să nu acorde niciodată singur permisiuni.
- **Surse citite:** https://modelcontextprotocol.io/extensions/skills/overview · https://modelcontextprotocol.io/extensions/client-matrix · https://developers.openai.com/plugins/build/mcp-server
- **Verificare adversarială:** CONFIRMED — Confirmat pe pagina extensiei: SEP-2640 este Final; skills/list și skills/get sunt obligatorii, conținutul se citește cu resources/read, iar directoryRead este opțional. Manifestul are URI, SHA-256 și dimensiune pentru fiecare fișier, sau valoarea „dynamic”. Aprobarea este legată de manifest; fișierele nu se preiau anticipat, iar cache-ul trebuie imutabil și exclus din descoperire. Limitele sunt 512 fișiere și 16 MiB per skill, iar un skill necunoscut dă eroarea -32602. Execuția de cod pe host și allowed-tools cer aprobare explicită per skill. Documentația OpenAI îl numește „draft SEP-2640” și importă un subset static: 5 skill-uri per scanare, 100 de fișiere, 256 KiB pentru SKILL.md, 1 MiB per fișier și 5 MiB per skill.

### Agent Skills: evaluarea calității output-ului (evals/evals.json, grading.json, timing.json, benchmark.json) (`std-gap-agent-skills-evals`)

- **Sursă oficială:** https://agentskills.io/skill-creation/evaluating-skills
- **Documentație tehnică:** https://agentskills.io/skill-creation/evaluating-skills.md; schemele skill-creator: https://github.com/anthropics/skills/blob/main/skills/skill-creator/references/schemas.md
- **Ce face:** Ghid nenormativ (secțiunea Skill creation de pe agentskills.io; specificația SKILL.md nu menționează evals) pentru testarea unui skill prin evaluări structurate. Cazurile se scriu manual în evals/evals.json din directorul skill-ului: skill_name și evals[] cu id, prompt (mesaj realist), expected_output (descriere lizibilă a succesului), files (opțional, ex. evals/files/...) și assertions (afirmații verificabile, adăugate după prima rulare). Fiecare caz rulează de două ori, cu skill (with_skill) și fără (without_skill), sau cu versiunea anterioară (old_skill, dintr-un snapshot), în context curat, într-un workspace separat <skill>-workspace/iteration-N/eval-<nume>/{with_skill,without_skill}/ cu outputs/, timing.json (total_tokens, duration_ms) și grading.json (assertion_results[] cu text, passed, evidence; summary cu passed, failed, total, pass_rate). Pe iterație, benchmark.json agregă run_summary.with_skill/without_skill (pass_rate, time_seconds, tokens ca mean/stddev) și delta. Notare: scripturi pentru verificările mecanice, LLM pentru restul, comparație oarbă opțională între versiuni; review uman în feedback.json. Un ghid separat descrie evaluarea declanșării: eval_queries.json cu query și should_trigger (~20 interogări, 3 rulări, prag 0,5, împărțire train/validation 60/40).
- **Plan necesar:** Niciunul pentru format. Rulările folosesc planul clientului: Claude Max prin Claude Code/claude.ai sau planul ChatGPT prin Codex.
- **Platformă:** Format JSON independent de platformă; rulări prin orice client Agent Skills. Automatizări native: skill-creator (Claude.ai, Cowork, plugin Claude Code, repo anthropics/skills) și, cu format diferit, `claude plugin eval` (Claude Code ≥ v2.1.269; pe Windows nativ, cazurile care primesc Bash sunt refuzate din lipsa sandbox-ului, recomandare WSL2).
- **Rollout:** Ghid publicat pe agentskills.io; skill-creator cu evals, benchmark, comparator A/B și optimizarea descrierii anunțat la 3.03.2026; documentația Claude Code trimite la agentskills.io pentru formatul evals.json.
- **Eligibilitate cont:** Format fără cont. skill-creator este activ pe contul claude.ai (ListSkills, 30.09.2026); pluginul Claude Code skill-creator@claude-plugins-official nu este instalat (`claude plugin list`: niciun plugin). CLI-ul npm folosit de Hub (2.1.175) este sub pragul `claude plugin eval` (2.1.269); Claude Desktop are local 2.1.281 și 2.1.284 (neexecutate).
- **Autentificare:** Format: niciuna. Rulări: autentificarea clientului (Claude Code prin claude.ai, firstParty, Max; Codex prin ChatGPT); fără chei API.
- **Allowance:** Fiecare rulare și fiecare notare LLM consumă din limitele planului (fereastra de 5 ore și cea săptămânală). Exemplu: 3 cazuri × 2 configurații × 3 repetări = 18 rulări de agent, plus judecătorul; `claude plugin eval` implicit 3 rulări pe braț și 3 voturi per grader llm; run_eval.py din skill-creator implicit 3 rulări pe interogare, cu 10 workeri paraleli.
- **Utilizare partajată:** Aceeași alocare ca sesiunile Claude Code/claude.ai (Max) sau alocarea comună Codex/ChatGPT Work.
- **Inclus în abonament?:** yes
- **Risc de facturare suplimentară (credite/extra usage):** Loturile repetate pot epuiza fereastra de 5 ore și, dacă usage credits sunt activate pe cont, pot trece în consum plătit; `--max-cost-usd` din `claude plugin eval` limitează doar estimarea list-price, nu consumul planului; în CI cu ANTHROPIC_API_KEY ar deveni facturare API (interzisă).
- **Risc de facturare API:** low
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** În fraza despre alternativa headless, comanda neinteractivă corectă este `claude plugin eval <dir> --json --no-publish --trust-plugin --ablation with-without --runs N --threshold X --max-cost-usd Y`: fără --trust-plugin (sau fără acceptarea anterioară, într-o sesiune interactivă, a promptului de încredere pentru director), prima rulare sub --json, fără TTY sau cu CI=true este refuzată cu exit 1; --trust-plugin se folosește doar pentru pluginuri proprii. Cazurile care primesc Bash/PowerShell rulează numai sub sandbox-ul OS și sunt refuzate pe Windows nativ (WSL2).
- **Suprafață nativă:** skill-creator în claude.ai/Cowork (activ pe cont) și ca plugin Claude Code (`/plugin install skill-creator@claude-plugins-official`), cu viewer HTML pentru review și feedback.
- **Cerințe locale:** Director evals/ în fiecare v2/skills/<nume>/ (lipsește la toate cele 11 skills); workspace de iterații în afara skill-ului (ex. .ifrim/tmp/v2/skill-evals/); fixture-uri sintetice în evals/files/; Node 24 pentru validare și agregare; grant LIVE pentru fiecare lot de rulări.
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Formatul canonic al cazurilor de test pentru skills-urile Hub (câmpul testRequired), legat de skill_versions (SHA-256) pentru detectarea regresiilor; rulările cu și fără skill trec doar prin poarta de execuție.
- **Suprafață de execuție:** hub.local
- **Echivalent la celălalt ecosistem:** OpenAI: articolul Testing Agent Skills Systematically with Evals recomandă `codex exec --json` (trace JSONL), un CSV de prompturi (id, should_trigger, prompt), verificări deterministe pe evenimente și rubrică cu `--output-schema`; nu folosește evals.json. Anthropic: skill-creator (evals.json) și `claude plugin eval`, al cărui format este declarat explicit neinterschimbabil cu evals.json.
- **Ce face unic / mai bine:** Portabil între clienți și ușor de scris manual; baseline explicit (fără skill sau versiunea anterioară); delta arată ce costă (timp, tokeni) și ce aduce (pass_rate) un skill; separă verificările mecanice de judecata LLM și de review-ul uman.
- **Securitate:** Prompturile și fișierele de test nu trebuie să conțină date private sau secrete (doar fixture-uri sintetice); judecătorul LLM poate fi influențat de conținutul evaluat (prompt injection), deci verificările deterministe au prioritate; fiecare rulare în workspace izolat, fără acces la .ifrim/private și cu permisiunile rolului (un skill nu acordă permisiuni); `claude plugin eval` publică implicit raportul ca artifact privat când autentificarea este prin abonament — se folosește `--no-publish`.
- **Cale de implementare:** 1) Adaugă evals/evals.json (2–3 cazuri) pentru skills-urile read-only (review, documentation, company-research). 2) Validator local în `npm run test:v2` care acceptă cheia assertions (agentskills.io) și aliasul expectations (skill-creator) și normalizează grading.json (assertion_results sau expectations). 3) Runner Hub pe poarta de execuție: plan de rulări (cazuri × configurații × repetări) cu consum estimat, grant LIVE_VALIDATION per lot, workspace temporar și context curat; with_skill = skill-ul inclus în rol, without_skill = rolul fără skill sau snapshot-ul versiunii anterioare. 4) Notare: întâi scripturi deterministe, apoi judecător LLM doar cu grant. 5) Agregare locală benchmark.json (mean, stddev, delta) și feedback.json din UI, legate de skill_versions. 6) Opțional ASSISTED: owner-ul rulează skill-creator nativ, iar Hub-ul importă grading/benchmark; pentru pachetele exportate ca plugin, cazurile `claude plugin eval` se pot genera din aceeași sursă.
- **Test necesar:** Fără modele: validarea schemelor evals/grading/timing/benchmark pe fixture-uri; agregare deterministă (mean, stddev, delta) pe valori cunoscute; refuzul oricărei rulări fără grant; normalizarea assertions/expectations. Cu aprobare: un singur caz × 2 configurații × 1 rulare pe un skill read-only, cu înregistrarea consumului (tokeni, durată) înainte de extindere.
- **Status:** NEEDS_SETUP
- **Decizie Hub:** REIMPLEMENT
- **Încredere:** high
- **Note:** Nepotrivire de câmpuri între surse: agentskills.io folosește assertions în evals.json și assertion_results în grading.json, iar schemas.md din skill-creator folosește expectations în ambele (plus execution_metrics, claims, user_notes_summary, eval_feedback) și un benchmark.json cu metadata și runs[] sub benchmarks/<timestamp>/; aggregate_benchmark.py citește expectations și caută run-*/grading.json. Documentația Claude Code spune explicit că formatul `claude plugin eval` și evals.json nu sunt interschimbabile. `claude plugin eval` nu are record propriu în lista existentă.
- **Surse citite:** https://agentskills.io/skill-creation/evaluating-skills · https://agentskills.io/skill-creation/optimizing-descriptions · https://agentskills.io/specification · https://agentskills.io/llms.txt · https://raw.githubusercontent.com/anthropics/skills/main/skills/skill-creator/references/schemas.md · https://raw.githubusercontent.com/anthropics/skills/main/skills/skill-creator/scripts/run_eval.py · https://raw.githubusercontent.com/anthropics/skills/main/skills/skill-creator/scripts/aggregate_benchmark.py · https://raw.githubusercontent.com/anthropics/skills/main/skills/skill-creator/LICENSE.txt · https://api.github.com/repos/anthropics/skills/contents/skills/skill-creator/scripts · https://code.claude.com/docs/en/skills · https://code.claude.com/docs/en/plugin-evals · https://code.claude.com/docs/en/plugins-reference · https://claude.com/blog/improving-skill-creator-test-measure-and-refine-agent-skills · https://developers.openai.com/blog/eval-skills · local: v2/skills/* (11 skills, niciun director evals/), .ifrim/V2_MEMORY_AND_SKILLS.md · local: %APPDATA%/npm/node_modules/@anthropic-ai/claude-code/package.json (2.1.175); %APPDATA%/Claude/claude-code (2.1.281, 2.1.284) · local: scratchpad sources-anthropic-local.md (ListSkills include skill-creator; claude plugin list: niciun plugin)
- **Verificare adversarială:** CORRECTED (corectat: programmaticDetail (https://code.claude.com/docs/en/plugin-evals)) — Rezistă toate cele șase câmpuri. agentskills.io descrie formatul (evals/evals.json cu skill_name, evals[], id, prompt, expected_output, files, assertions; iteration-N cu with_skill/without_skill sau old_skill; timing.json, grading.json, benchmark.json cu run_summary și delta), iar specificația SKILL.md nu conține termenul eval, deci ghidul este nenormativ. code.claude.com confirmă pentru `claude plugin eval`: v2.1.269+, rulările și graderii judecător consumă din limitele planului sau din factura API, --max-cost-usd plafonează doar estimarea list-price, câte trei rulări pe braț și trei apeluri de judecător per grader llm/baseline, raport publicat ca artifact privat la autentificarea prin abonament (local cu --no-publish sau când rularea pornește dintr-o sesiune Claude Code) și formatul neinterschimbabil cu evals.json din skill-creator. Usage credits sunt dezactivate implicit și facturate la tarife API, cu auto-reload opțional, deci apiBillingRisk low este corect. skill-creator este Apache-2.0; run_eval.py are implicit 3 rulări pe interogare, 10 workeri și prag 0,5; anunțul skill-creator din 3.03.2026 este confirmat. REIMPLEMENT rămâne justificat: nu există un runner nativ comun OpenAI/Anthropic, `claude plugin eval` acoperă doar Claude și are alt format, iar articolul OpenAI propune un harness propriu peste `codex exec --json`. Corectura privește doar programmaticDetail (--trust-plugin pentru rulări neinteractive).

## security

### Agent Skills: câmpul experimental allowed-tools și regula „un skill nu acordă permisiuni” (`std-agent-skills-allowed-tools`)

- **Sursă oficială:** https://agentskills.io/specification
- **Documentație tehnică:** https://code.claude.com/docs/en/skills
- **Ce face:** Specificația definește allowed-tools ca listă (separată prin spații) de tool-uri pre-aprobate, marcată experimentală, cu suport variabil. În Claude Code câmpul acordă efectiv permisiune fără prompt pentru tool-urile listate pe durata turului care invocă skill-ul (grantul dispare la mesajul următor), nu restricționează celelalte tool-uri, iar regulile deny/ask au prioritate; documentația avertizează că workspace trust nu blochează câmpul, inclusiv în rulări -p într-un folder neîncrezător. Documentația Codex citită nu menționează câmpul. Extensia Skills over MCP cere aprobare explicită per skill pentru allowed-tools și execuție de cod pe host.
- **Plan necesar:** n/a
- **Platformă:** Claude Code (onorat); claude.ai/Skills API (acceptat ca cheie); Codex (nedocumentat).
- **Rollout:** Experimental în specificație; comportament documentat pentru Claude Code curent; versiunea locală 2.1.175 nu a fost testată.
- **Eligibilitate cont:** n/a
- **Autentificare:** n/a
- **Allowance:** n/a
- **Utilizare partajată:** n/a
- **Inclus în abonament?:** not_applicable
- **Risc de facturare suplimentară (credite/extra usage):** Indirect: un grant larg (ex. Bash) ar permite comenzi care folosesc rețea sau servicii plătite; fără taxare directă.
- **Risc de facturare API:** none
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Claude Code: frontmatter allowed-tools / disallowed-tools; la CLI --tools (restrânge setul), --allowedTools, --disallowedTools, --permission-mode dontAsk\|acceptEdits, --disable-slash-commands (prezent local în 2.1.175). Variabilele ${CLAUDE_SKILL_DIR} și ${CLAUDE_PROJECT_DIR} se substituie și în regulile Bash din allowed-tools. Codex: aprobările și sandbox-ul rămân la nivel de sesiune; skill-urile se activează/dezactivează prin [[skills.config]].
- **Suprafață nativă:** Claude Code: /permissions și dialogurile de aprobare; Codex: politicile de aprobare/sandbox.
- **Cerințe locale:** Adaptorul Claude din V2 NU blochează proiectele neîncrezătoare care au doar .claude/skills, .claude/commands sau .claude/agents. inspectWorkspaceStartup le raportează ca „definitions”, iar startTurn blochează numai elementele de alt tip: hooks în .claude/settings*.json, activarea serverelor MCP din setări și .mcp.json. Prin urmare, un skill de proiect cu allowed-tools poate intra într-o rulare -p; în workspace-write, --tools include Bash, iar --permission-mode este acceptEdits. Garda trebuie extinsă în unul din două moduri: blocare și pentru definitions până la revizuire, sau lansare cu --disable-slash-commands ori --safe-mode (ambele există în 2.1.175). Pentru Codex trebuie adăugate .agents/skills (REPO), ~/.agents/skills (USER, populat local) și AGENTS.override.md.
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Regulă de politică: permisiunile sunt atribuite exclusiv de Hub (nivel aprobat de proprietar în registrul de skill-uri, intersectat cu grantul rulării). allowed-tools din sursă este doar o cerere declarativă, verificată la import și eliminată la export.
- **Suprafață de execuție:** hub.local
- **Echivalent la celălalt ecosistem:** Anthropic: allowed-tools onorat de Claude Code. OpenAI: nicio echivalență documentată pentru skills Codex (politica este la nivel de sesiune).
- **Ce face unic / mai bine:** Pentru Hub nu este un avantaj, ci un vector de escaladare care trebuie neutralizat; singura utilizare acceptabilă este ca listă declarativă a tool-urilor necesare, utilă la validare.
- **Securitate:** Un skill de proiect își poate acorda acces larg (ex. Bash(*)) fără ca workspace trust să intervină; combinat cu injecția dinamică de context din Claude Code (!`comandă` sau blocuri ```!) poate rula comenzi la încărcare; câmpul hooks (doar Claude Code) înregistrează hook-uri active tot restul sesiunii; context: fork/agent, model, effort pot ocoli rutarea Hub-ului; dependencies.tools din agents/openai.yaml poate declanșa instalarea de servere MCP (skill_mcp_dependency_install=true local); skill-urile sincronizate de pe claude.ai pot apărea în rulările Claude lansate de Hub.
- **Cale de implementare:** 1) Nivelul de permisiune (READ_ONLY, WORKSPACE_EDIT, DEVELOPMENT_TOOLS, EXTERNAL_ACTIONS) se stochează în registrul Hub și îl aprobă proprietarul; permisiunea efectivă = minimul dintre grantul misiunii/rolului și nivelul skill-ului, niciodată uniunea. 2) La import: dacă allowed-tools nu este submulțime a nivelului aprobat, versiunea devine invalid și cere aprobare. 3) La export către Claude Code: se elimină allowed-tools; disallowed-tools se poate păstra (doar restrânge). 4) Linter care respinge în canonic: hooks, !`…`, ```!, context/agent, model/effort, shell și dependencies.tools neaprobate. 5) Rulările Claude fără skill aprobat primesc --disable-slash-commands; conținutul skill-ului aprobat îl injectează Hub-ul. 6) Aprobarea se leagă de manifestul complet (căi + sha256 + dimensiune); orice modificare o revocă.
- **Test necesar:** Fără modele: proiect fixture neîncrezător cu .claude/skills/x/SKILL.md (allowed-tools: Bash(*)) → lansarea este blocată; la fel pentru .agents/skills (Codex); exportul nu conține allowed-tools; skill cu hooks sau !`cmd` → validation_json invalid; argumentele CLI conțin --disable-slash-commands când nu există skill aprobat; modificarea unui singur byte revocă aprobarea.
- **Status:** DOCUMENTED
- **Decizie Hub:** REJECT
- **Încredere:** high
- **Note:** REJECT privește folosirea allowed-tools ca sursă de permisiuni; câmpul rămâne citit ca metadată declarativă. Comportamentul exact al versiunii locale 2.1.175 împreună cu --permission-mode dontAsk nu poate fi verificat fără un turn cu model (interzis în BUILD_SAFE). Documentația Claude Code precizează că pentru skill-urile sincronizate de pe claude.ai grantul trece prin fluxul normal de permisiuni.
- **Surse citite:** https://agentskills.io/specification · https://code.claude.com/docs/en/skills · https://code.claude.com/docs/en/cli-reference · https://modelcontextprotocol.io/extensions/skills/overview · https://learn.chatgpt.com/docs/build-skills · https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview · local: claude --help (2.1.175: --disable-slash-commands, --allowedTools, --disallowedTools, --safe-mode, --setting-sources) · local: v2/server/providers/claude.mjs (inspectWorkspaceStartup)
- **Verificare adversarială:** CORRECTED (corectat: localRequirements (local: v2/server/providers/claude.mjs (inspectWorkspaceStartup, liniile 57-69; startTurn, liniile 118-121); claude --help 2.1.175; https://code.claude.com/docs/en/skills)) — Comportamentul documentat este confirmat pe code.claude.com/docs/en/skills. Grantul ține doar pe turul care invocă skill-ul și nu restrânge celelalte tool-uri; regulile deny/ask au prioritate. Workspace trust nu îl blochează, nici în -p. Comenzile !`cmd` rulează la randare fără prompt dacă permisiunea este allow, iar allowed-tools le poate pre-aproba. Hooks rămân active tot restul sesiunii. Nuanțe: sincronizarea skill-urilor claude.ai în terminal cere versiunea ≥2.1.273, deci nu afectează acum versiunea locală 2.1.175. După upgrade, sincronizarea se oprește cu --setting-sources fără user, --safe-mode, bare mode sau syncClaudeAiSkills=false. La skill-urile sincronizate, allowed-tools este onorat, dar !`cmd` nu rulează local. Substituția ${CLAUDE_PROJECT_DIR} cere ≥2.1.196. --safe-mode (local) dezactivează CLAUDE.md, skills, plugins, hooks, MCP, comenzile și agenții custom, dar păstrează autentificarea și permisiunile. În modul read-only V2 (--tools Read,Glob,Grep) Bash nu este disponibil, deci riscul principal apare în workspace-write. Nu am putut verifica fără un turn dacă --tools filtrează și tool-ul Skill. Binarul Codex 0.158 menționează allowed-tools doar ca listă declarativă; nu există documentație că Codex îl tratează ca grant.

### MCP: autorizare OAuth 2.1 pentru transporturi HTTP (`std-mcp-authorization`)

- **Sursă oficială:** https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization
- **Documentație tehnică:** https://modelcontextprotocol.io/specification/2026-07-28/changelog
- **Ce face:** Opțională; se aplică transporturilor HTTP, iar serverele stdio nu trebuie să o urmeze (iau credențialele din mediu). Serverul MCP este resource server OAuth 2.1 și trebuie să publice Protected Resource Metadata (RFC 9728); clientul descoperă serverul de autorizare (RFC 8414 sau OIDC Discovery), obține client_id prin Client ID Metadata Documents (recomandat), preînregistrare sau DCR (depreciat), folosește PKCE și parametrul resource (RFC 8707), validează iss (RFC 9207) înainte de schimbul codului și leagă credențialele de issuer. Serverul validează audiența tokenului și nu acceptă și nu transmite alte tokenuri (fără token passthrough); lipsa de scope → 403 insufficient_scope cu step-up (uniunea scope-urilor). Extensii separate: OAuth Client Credentials și Enterprise-Managed Authorization.
- **Plan necesar:** n/a
- **Platformă:** Streamable HTTP.
- **Rollout:** Current; modificările iss/CIMD/application_type sunt noi în 2026-07-28.
- **Eligibilitate cont:** n/a pentru Hub (stdio/loopback).
- **Autentificare:** OAuth 2.1 + PKCE; tokenuri Bearer doar în antetul Authorization, niciodată în query string.
- **Allowance:** n/a
- **Utilizare partajată:** n/a
- **Inclus în abonament?:** not_applicable
- **Risc de facturare suplimentară (credite/extra usage):** Niciunul pentru Hub; un server de autorizare găzduit ar fi un serviciu nou.
- **Risc de facturare API:** none
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Clienții oficiali gestionează OAuth pentru serverele remote. Documentația curentă Claude Code descrie claude mcp login/logout (cu --no-browser), --client-id, --client-secret, --callback-port, oauth.scopes, authServerMetadataUrl și headersHelper. headersHelper rulează doar după workspace trust pentru serverele din .mcp.json. Local, Claude Code 2.1.175 nu are subcomenzile mcp login/logout; are add, add-from-claude-desktop, add-json, get, list, remove, reset-project-choices și serve. claude mcp add expune însă --client-id, --client-secret și --callback-port. Pe runtime-ul MCP v2 (≥2.1.232), Claude Code respinge autentificarea OAuth dacă răspunsul numește un issuer neașteptat. Hub-ul nu stochează tokenurile acestor servere.
- **Suprafață nativă:** Claude Code /mcp; conectorii claude.ai; configurația MCP Codex.
- **Cerințe locale:** Niciuna cât timp Hub-ul rămâne pe stdio/loopback.
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Referință de securitate: Hub-ul nu expune HTTP MCP; dacă va fi aprobată vreodată expunerea, implementează integral profilul (PRM, audiență, iss, fără passthrough).
- **Suprafață de execuție:** hub.mcp_server
- **Echivalent la celălalt ecosistem:** Ambele ecosisteme implementează partea de client OAuth pentru conectori MCP remote.
- **Ce face unic / mai bine:** Profil OAuth strict și aliniat cu OIDC, cu apărări explicite contra mix-up și confused deputy.
- **Securitate:** Token passthrough, confused deputy, mix-up de issuer, SSRF la preluarea documentelor CIMD, redirect deschis, reutilizarea credențialelor între servere de autorizare diferite.
- **Cale de implementare:** Nicio implementare acum. Regulă: serverul MCP al Hub-ului rulează doar stdio, fără credențiale în mediu; orice acces la servicii terțe rămâne în clienții oficiali.
- **Test necesar:** Test static: serverul Hub nu deschide socket de rețea; variabilele de mediu pasate nu conțin chei.
- **Status:** DOCUMENTED
- **Decizie Hub:** REFERENCE
- **Încredere:** high
- **Note:** Matricea comunitară arată suport pentru extensiile de autorizare doar la câțiva clienți (ex. mcpc, Archestra.AI); Claude și ChatGPT nu apar la aceste coloane.
- **Surse citite:** https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization · https://modelcontextprotocol.io/specification/2026-07-28/changelog · https://modelcontextprotocol.io/extensions/overview · https://modelcontextprotocol.io/extensions/client-matrix · https://code.claude.com/docs/en/mcp
- **Verificare adversarială:** CORRECTED (corectat: programmaticDetail (local: claude mcp --help și claude mcp add --help (2.1.175); https://code.claude.com/docs/en/mcp)) — Pagina de autorizare 2026-07-28 confirmă: autorizarea este opțională și acoperă doar HTTP, iar serverele stdio iau credențialele din mediu. Tot acolo: PRM RFC 9728 obligatoriu; descoperire prin RFC 8414 sau OIDC Discovery; CIMD recomandat, DCR depreciat; PKCE; parametrul resource (RFC 8707); validarea iss (RFC 9207); credențiale legate de issuer. Serverul validează audiența tokenului și nu acceptă alte tokenuri (fără passthrough). La lipsă de scope răspunde 403 insufficient_scope; clientul face step-up cu uniunea scope-urilor. Tokenul circulă doar în antetul Authorization. Extensiile OAuth Client Credentials și Enterprise-Managed Authorization sunt în ext-auth. Matricea le arată la mcpc și Archestra.AI, nu la Claude sau ChatGPT.

## mcp

### Model Context Protocol: revizia curentă 2026-07-28 (nucleu stateless) (`std-mcp-core-2026-07-28`)

- **Sursă oficială:** https://modelcontextprotocol.io/specification/2026-07-28
- **Documentație tehnică:** https://modelcontextprotocol.io/specification/2026-07-28/changelog
- **Ce face:** Protocol deschis JSON-RPC 2.0 între host/client și servere care oferă tools, resources și prompts; clientul oferă elicitation. Revizia 2026-07-28 (publicată 28.07.2026, după 2025-11-25): elimină handshake-ul initialize și Mcp-Session-Id; fiecare cerere poartă în _meta protocolVersion, clientCapabilities și clientInfo; server/discover devine obligatoriu; subscriptions/listen înlocuiește GET-ul HTTP și resources/subscribe; Multi Round-Trip Requests (InputRequiredResult cu inputRequests și requestState) înlocuiesc cererile inițiate de server; resultType obligatoriu; ttlMs/cacheScope pe liste; antete Mcp-Method/Mcp-Name; propagare OpenTelemetry în _meta; tasks mutat într-o extensie oficială. Depreciate: Roots, Sampling, Logging, HTTP+SSE, Dynamic Client Registration.
- **Plan necesar:** n/a (standard deschis)
- **Platformă:** Transporturi stdio și Streamable HTTP; toate cele patru SDK-uri Tier 1 au primit suport la lansare.
- **Rollout:** Current: 2026-07-28, publicată pe 28.07.2026, conform paginii de versionare. Politica de depreciere prevede o fereastră minimă de 12 luni, redusă la 90 de zile în excepția de eliminare accelerată.
- **Eligibilitate cont:** Verificat local cu codex features list: în Codex 0.158, mcp_2026_07_28 și codex_apps_mcp_2026_07_28 sunt „under development” și false. Runtime-ul MCP v2 din Claude Code folosește MCP TypeScript SDK 2.0, care adaugă revizia 2026-07-28. Îl folosește de la v2.1.232 în sesiunile care preiau feature flags. În sesiunile fără feature flags (Bedrock, gateway, telemetrie dezactivată) îl folosește implicit de la v2.1.274. Chiar pe v2, negociază revizia nouă doar cu serverele HTTP și cu conectorii claude.ai. Serverele stdio rămân pe comportamentul v1, cu excepția cazului în care MCP_PROTOCOL_NEGOTIATION=auto. Local rulează 2.1.175, sub 2.1.232, deci doar runtime-ul v1 (2025-11-25). Revizia 2026-07-28 nu este activă local.
- **Autentificare:** stdio: credențiale din mediu; HTTP: OAuth 2.1 (vezi std-mcp-authorization).
- **Allowance:** n/a
- **Utilizare partajată:** Apelurile de tool făcute de Claude Code/Codex consumă din planul clientului care rulează turul.
- **Inclus în abonament?:** not_applicable
- **Risc de facturare suplimentară (credite/extra usage):** Nu pentru protocol. Migrarea recomandată pentru Sampling (integrare directă cu API-ul furnizorului) ar însemna API plătit, deci Hub-ul nu folosește Sampling.
- **Risc de facturare API:** none
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Local: claude mcp add\|add-json\|get\|list\|remove\|serve, --mcp-config, --strict-mcp-config; codex mcp. Adaptorul V2 Claude rulează cu --strict-mcp-config și o configurație mcpServers goală. Un server Hub stdio trebuie să accepte atât handshake-ul initialize (2025-11-25) cât și server/discover + _meta per cerere (2026-07-28).
- **Suprafață nativă:** Claude Code /mcp; Claude Desktop/claude.ai connectors; configurația MCP Codex; ChatGPT plugins (doar HTTPS public).
- **Cerințe locale:** Niciun server MCP nu se adaugă în configurațiile persistente Claude/Codex fără aprobare; pentru rulările Hub se poate pasa per rulare (--mcp-config).
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Stratul portabil de tool-uri: un server MCP stdio local al Hub-ului (la început read-only: stare misiuni/taskuri, memorie aprobată, cereri de aprobare), consumat identic de Claude Code și Codex.
- **Suprafață de execuție:** hub.mcp_server
- **Echivalent la celălalt ecosistem:** Anthropic: client MCP în Claude Code/Desktop/claude.ai și claude mcp serve. OpenAI: client MCP în Codex și în ChatGPT plugins.
- **Ce face unic / mai bine:** Standard neutru (proiect AAIF) implementat de ambii furnizori; nucleul stateless simplifică serverele locale și reîncercările.
- **Securitate:** Tool-urile înseamnă execuție arbitrară de cod; adnotările sunt nesigure dacă serverul nu e de încredere; hostul trebuie să ceară consimțământ înainte de invocare; în claude -p/Agent SDK, .mcp.json de proiect se încarcă fără prompt (V2 blochează deja proiectele neîncrezătoare cu .mcp.json); x-mcp-header nu se pune pe parametri sensibili.
- **Cale de implementare:** Faza 1 (acum): păstrează izolarea MCP (configurație goală, elicitation refuzată). Faza 2 (cu aprobare): server stdio Hub doar local, fără secrete în mediu, tools read-only cu outputSchema, compatibil dublu 2025-11-25/2026-07-28, pasat per rulare cu --strict-mcp-config; audit per apel; fără Sampling/Roots/Logging.
- **Test necesar:** Teste de protocol fără modele: handshake 2025-11-25 și server/discover 2026-07-28 cu un client scriptat; ordonare deterministă în tools/list; resultType prezent; erori -32602 și -32022; niciun tool de scriere în faza 1.
- **Status:** DOCUMENTED
- **Decizie Hub:** REIMPLEMENT
- **Încredere:** high
- **Note:** executionSurface „hub.mcp_server” este un id nou propus (serverul MCP local al Hub-ului). Serverele care depindeau de Mcp-Session-Id trebuie să treacă la handle-uri explicite în argumente. MCP, AGENTS.md și A2A sunt proiecte găzduite de Agentic AI Foundation.
- **Surse citite:** https://modelcontextprotocol.io/specification/latest · https://modelcontextprotocol.io/specification/2026-07-28/changelog · https://modelcontextprotocol.io/specification/versioning · https://modelcontextprotocol.io/extensions/overview · https://blog.modelcontextprotocol.io/posts/2026-07-28/ · https://code.claude.com/docs/en/mcp · local: sources-openai-devday.md (codex features: mcp_2026_07_28 under development) · local: v2/server/providers/claude.mjs
- **Verificare adversarială:** CORRECTED (corectat: accountEligibility (https://code.claude.com/docs/en/mcp; local: codex features list (0.158.0-alpha.2.1), claude --version (2.1.175)), rollout (https://modelcontextprotocol.io/specification/versioning; https://blog.modelcontextprotocol.io/posts/2026-07-28/)) — Changelog-ul, pagina de versionare (Current = 2026-07-28) și articolul de lansare confirmă conținutul din whatItDoes. Articolul datează lansarea pe 28.07.2026 și confirmă actualizarea SDK-urilor Tier 1: TypeScript, Python, Go și C#. De adăugat: au fost eliminate ping, logging/setLevel și reluarea fluxurilor SSE. Eroarea corectată privește pragurile de versiune din Claude Code și regula pentru stdio. Concluzia rămâne corectă: server Hub stdio cu dublă compatibilitate, fără Sampling, Roots sau Logging.

### MCP: elicitation (moduri form și URL) (`std-mcp-elicitation`)

- **Sursă oficială:** https://modelcontextprotocol.io/specification/2026-07-28/client/elicitation
- **Documentație tehnică:** https://modelcontextprotocol.io/specification/2026-07-28/client/elicitation
- **Ce face:** Serverul cere informații utilizatorului prin client. Form mode: schemă JSON restrânsă (obiect plat cu string/number/boolean/enum), date vizibile clientului. URL mode: utilizatorul e trimis la un URL extern pentru interacțiuni sensibile (credențiale, OAuth terț, plăți) care nu trec prin client. Răspuns cu action accept/decline/cancel. În 2026-07-28 cererea vine în InputRequiredResult.inputRequests, iar răspunsul se trimite în inputResponses la reîncercarea cererii inițiale; notificarea elicitation/complete și elicitationId au fost eliminate.
- **Plan necesar:** n/a
- **Platformă:** Clienți care declară capabilitatea elicitation (form și/sau url).
- **Rollout:** Current; URL mode introdus în 2025-11-25.
- **Eligibilitate cont:** Local: Codex are tool_call_mcp_elicitation=true, iar app-server trimite mcpServer/elicitation/request, pe care V2 îl refuză automat. Claude Code headless: mecanismul nu apare în sursele citite.
- **Autentificare:** n/a
- **Allowance:** n/a
- **Utilizare partajată:** n/a
- **Inclus în abonament?:** not_applicable
- **Risc de facturare suplimentară (credite/extra usage):** URL mode poate duce la fluxuri de plată externe; Hub-ul nu le deschide automat.
- **Risc de facturare API:** none
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Codex app-server: cerere JSON-RPC mcpServer/elicitation/request către client; răspuns { action: accept\|decline\|cancel, content }. Adaptorul V2 răspunde acum cu decline.
- **Suprafață nativă:** Dialogurile de elicitation din Codex/Claude interactive.
- **Cerințe locale:** Niciuna.
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Cererile de elicitation devin aprobări Hub vizibile proprietarului; implicit decline în BUILD_SAFE.
- **Suprafață de execuție:** openai.codex_app_server
- **Echivalent la celălalt ecosistem:** Anthropic: suport elicitation în clientul MCP Claude Code (modul headless neverificat). OpenAI: Codex app-server expune cererea către host.
- **Ce face unic / mai bine:** Mecanism standard pentru confirmări umane în mijlocul unui apel de tool.
- **Securitate:** Form mode nu are voie să ceară parole, chei API, tokenuri sau date de plată; URL mode: afișează URL-ul complet și domeniul, fără prefetch, deschidere doar după consimțământ, într-un browser în care clientul/LLM nu pot inspecta conținutul; risc de phishing; identitatea utilizatorului nu se ia din input.
- **Cale de implementare:** Păstrează decline implicit. Ulterior: form → formular de aprobare cu identitatea serverului, câmpuri revizuibile, accept/decline/cancel; decline automat pentru câmpuri de tip parolă/token/cheie; URL → card cu URL complet și domeniul evidențiat, deschis în browserul sistemului doar la acțiunea proprietarului; totul în audit.
- **Test necesar:** Simulat: app-server fals trimite form și URL → Hub creează aprobare, fără accept automat; câmp „password” → decline automat; expirare → cancel.
- **Status:** AVAILABLE
- **Decizie Hub:** WRAP
- **Încredere:** medium
- **Note:** AVAILABLE se referă la ruta Codex app-server observată local; nu s-a rulat nicio cerere reală.
- **Surse citite:** https://modelcontextprotocol.io/specification/2026-07-28/client/elicitation · https://modelcontextprotocol.io/specification/2026-07-28/changelog · local: v2/server/providers/codex.mjs (mcpServer/elicitation/request → decline) · local: sources-openai-devday.md (tool_call_mcp_elicitation=true)
- **Verificare adversarială:** CONFIRMED — Pagina de elicitation 2026-07-28 confirmă modurile form și url și schema plată (string, number, boolean, enum). Form mode nu are voie să ceară parole, chei, tokenuri sau date de plată. Pentru URL mode clientul trebuie să afișeze URL-ul complet și domeniul, să nu facă prefetch, să ceară consimțământ și să deschidă URL-ul într-un context pe care clientul sau LLM-ul nu îl pot inspecta. Răspunsul este accept, decline sau cancel. Cererea circulă prin InputRequiredResult și inputResponses, iar elicitation/complete și elicitationId au fost eliminate. URL mode a apărut în 2025-11-25. Verificat local: tool_call_mcp_elicitation și auth_elicitation sunt stable true; binarul 0.158 conține metoda mcpServer/elicitation/request. În V2, codex.mjs (linia 192) răspunde cu decline. Documentația Claude Code descrie dialoguri de elicitation doar interactiv; pentru -p nu există documentație.

### MCP: ieșire structurată a tool-urilor (outputSchema / structuredContent) (`std-mcp-structured-tool-output`)

- **Sursă oficială:** https://modelcontextprotocol.io/specification/2026-07-28/server/tools
- **Documentație tehnică:** https://modelcontextprotocol.io/specification/2026-07-28/server/tools
- **Ce face:** Tool-urile pot declara outputSchema (JSON Schema, implicit 2020-12; 2026-07-28 permite orice cuvânt-cheie 2020-12 și definește rezolvarea $ref); rezultatul conține structuredContent (orice valoare JSON) conform schemei și, pentru compatibilitate, JSON serializat într-un TextContent. Erorile de execuție se întorc cu isError: true (utile pentru autocorecție), erorile de protocol ca erori JSON-RPC. Ghid pentru tool-uri cu stare: handle-uri opace, autorizate la fiecare apel, cu durată de viață declarată. structuredContent nu are legătură cu structured outputs ale modelului.
- **Plan necesar:** n/a
- **Platformă:** Orice server/client MCP.
- **Rollout:** Current.
- **Eligibilitate cont:** n/a
- **Autentificare:** n/a
- **Allowance:** n/a
- **Utilizare partajată:** n/a
- **Inclus în abonament?:** not_applicable
- **Risc de facturare suplimentară (credite/extra usage):** Niciunul.
- **Risc de facturare API:** none
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** tools/list întoarce inputSchema/outputSchema; tools/call întoarce content + structuredContent + isError. Separat, Claude Code are --json-schema pentru ieșirea validată a agentului în -p (alt concept).
- **Suprafață nativă:** n/a
- **Cerințe locale:** Validator JSON Schema 2020-12 în Node (fără pachete noi fără aprobare).
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Toate tool-urile serverului MCP al Hub-ului declară outputSchema și întorc structuredContent + text; Hub-ul validează rezultatele de la servere terțe înainte de a le transmite modelelor.
- **Suprafață de execuție:** hub.mcp_server
- **Echivalent la celălalt ecosistem:** Anthropic: Claude Code consumă structuredContent ca orice client MCP; OpenAI: Codex la fel. Echivalentul pentru ieșirea agentului: claude -p --json-schema și schemele de ieșire din Codex.
- **Ce face unic / mai bine:** Rezultate verificabile mecanic, potrivite pentru audit și pentru reguli deterministe ale Hub-ului.
- **Securitate:** Rezultatele tool-urilor sunt date nesigure (pot conține injecții de prompt); validarea schemei nu garantează conținut benign; handle-urile nu sunt capabilități și trebuie reautorizate.
- **Cale de implementare:** Definește schemele de ieșire pentru tool-urile Hub în faza 2 a serverului MCP; fallback text obligatoriu; erori de business cu isError.
- **Test necesar:** Contract tests: fiecare tool Hub are outputSchema validă; rezultatele validează; isError pentru intrări invalide.
- **Status:** DOCUMENTED
- **Decizie Hub:** REIMPLEMENT
- **Încredere:** high
- **Note:** Depinde de decizia privind serverul MCP local al Hub-ului (std-mcp-core-2026-07-28).
- **Surse citite:** https://modelcontextprotocol.io/specification/2026-07-28/server/tools · https://modelcontextprotocol.io/specification/2026-07-28/changelog · https://code.claude.com/docs/en/cli-reference
- **Verificare adversarială:** CONFIRMED — Pagina tools 2026-07-28 confirmă următoarele. outputSchema folosește implicit JSON Schema 2020-12, iar structuredContent poate fi orice valoare JSON. Serverul trebuie să respecte schema, iar clientul ar trebui să valideze rezultatul. Pentru compatibilitate se recomandă și JSON-ul serializat într-un TextContent. Erorile de execuție se întorc cu isError. Ghidul non-normativ pentru handle-uri cere autorizare la fiecare apel, opacitate și durată de viață declarată. Clientul trebuie să trateze adnotările tool-urilor ca nesigure dacă serverul nu este de încredere; tools/list ar trebui să aibă ordine deterministă.

### MCP Tasks (extensia oficială io.modelcontextprotocol/tasks) (`std-mcp-tasks-extension`)

- **Sursă oficială:** https://modelcontextprotocol.io/extensions/tasks/overview
- **Documentație tehnică:** https://github.com/modelcontextprotocol/ext-tasks
- **Ce face:** Pentru operații lungi, serverul decide per cerere să întoarcă un CreateTaskResult (resultType "task") cu taskId, stare, ttlMs și pollIntervalMs, creat durabil înainte de răspuns. Clientul face polling cu tasks/get, trimite input prin tasks/update (inputResponses pentru inputRequests) și poate anula cooperativ cu tasks/cancel. Stări: working, input_required, completed, failed, cancelled (ultimele trei terminale). Notificări opționale notifications/tasks prin subscriptions/listen. Față de varianta experimentală din 2025-11-25: dispar tasks/result blocant și tasks/list.
- **Plan necesar:** n/a
- **Platformă:** Opt-in prin extensions în capabilitățile clientului și în server/discover.
- **Rollout:** Extensie oficială din 2026-07-28; suportul în hosturi nu apare în matricea comunitară.
- **Eligibilitate cont:** Suport în Claude Code, Codex sau ChatGPT: necunoscut.
- **Autentificare:** n/a
- **Allowance:** n/a
- **Utilizare partajată:** n/a
- **Inclus în abonament?:** not_applicable
- **Risc de facturare suplimentară (credite/extra usage):** Niciunul.
- **Risc de facturare API:** none
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** _meta io.modelcontextprotocol/clientCapabilities.extensions["io.modelcontextprotocol/tasks"]; metode tasks/get, tasks/update, tasks/cancel; ID-urile de task se persistă pentru reluare după restart.
- **Suprafață nativă:** n/a
- **Cerințe locale:** Niciuna.
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Model de aliniere pentru stările run-urilor Hub (input_required ≈ poarta de aprobare) și pentru eventuale tool-uri lungi ale serverului MCP Hub.
- **Suprafață de execuție:** hub.mcp_server
- **Echivalent la celălalt ecosistem:** Anthropic: sesiuni background în Claude Code (nu MCP Tasks). OpenAI: thread/turn în Codex app-server (nu MCP Tasks).
- **Ce face unic / mai bine:** Handle durabil care supraviețuiește deconectărilor, cu input în mijlocul execuției.
- **Securitate:** Task ID-urile trebuie legate de identitatea apelantului; anularea nu garantează oprirea; inputRequests pot conține elicitation (aceleași reguli).
- **Cale de implementare:** Nicio implementare acum; mapează vocabularul de stări în modelul de date al Hub-ului pentru compatibilitate viitoare.
- **Test necesar:** n/a până la implementare.
- **Status:** DOCUMENTED
- **Decizie Hub:** REFERENCE
- **Încredere:** high
- **Note:** Matricea de extensii nu are coloană pentru Tasks, deci nu există dovadă publică de suport la vreun host important.
- **Surse citite:** https://modelcontextprotocol.io/extensions/tasks/overview · https://modelcontextprotocol.io/specification/2026-07-28/changelog · https://modelcontextprotocol.io/extensions/client-matrix
- **Verificare adversarială:** CONFIRMED — Pagina extensiei confirmă: CreateTaskResult cu resultType „task”, taskId, ttlMs și pollIntervalMs, creat durabil înainte de răspuns. Metodele sunt tasks/get, tasks/update și tasks/cancel, iar anularea este cooperativă. Stările sunt working, input_required, completed, failed și cancelled; notificările vin prin subscriptions/listen. Changelog-ul confirmă eliminarea tasks/result și tasks/list. Matricea de extensii nu are coloană pentru Tasks. Atenție: Claude Code mută automat în fundal apelurile MCP care durează peste 2 minute, dar aceasta este o funcție proprie, nu MCP Tasks.

### MCP Apps (extensia io.modelcontextprotocol/ui, UI interactiv în conversație) (`std-mcp-apps`)

- **Sursă oficială:** https://modelcontextprotocol.io/extensions/apps/overview
- **Documentație tehnică:** https://github.com/modelcontextprotocol/ext-apps
- **Ce face:** Tool-ul declară în _meta.ui.resourceUri o resursă ui:// (HTML, MIME text/html;profile=mcp-app) pe care hostul o poate preîncărca și o randează într-un iframe sandbox; aplicația și hostul comunică prin postMessage, într-un dialect JSON-RPC (ui/initialize, tools/call trimis prin host, actualizare de context). _meta.ui.csp controlează originile externe, _meta.ui.permissions cere capabilități suplimentare. Specificație stabilă 2026-01-26 (SEP-1865); pachet @modelcontextprotocol/ext-apps; clienții pot folosi AppBridge sau @mcp-ui/client.
- **Plan necesar:** n/a
- **Platformă:** Hosturi în matrice: Claude (web), Claude Desktop, ChatGPT, VS Code GitHub Copilot, Microsoft 365 Copilot, Cursor, Goose, Postman, MCPJam, Archestra.AI, PostHog Code.
- **Rollout:** Stabil; suportul variază între hosturi.
- **Eligibilitate cont:** Claude Desktop/claude.ai: suportat conform matricei, neverificat pe cont. Codex 0.158: enable_mcp_apps „under development” (dezactivat).
- **Autentificare:** Moștenită de la serverul MCP.
- **Allowance:** n/a
- **Utilizare partajată:** Interacțiunile care declanșează turnuri consumă din planul hostului.
- **Inclus în abonament?:** not_applicable
- **Risc de facturare suplimentară (credite/extra usage):** claude.ai web și ChatGPT nu pot ajunge la un Hub loopback; expunerea publică ar fi un serviciu nou, neautorizat.
- **Risc de facturare API:** none
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Server: resursă ui:// + _meta.ui pe definiția tool-ului; negociere prin extensions["io.modelcontextprotocol/ui"] cu mimeTypes. Host: iframe sandbox + postMessage JSON-RPC.
- **Suprafață nativă:** Panouri interactive inline în Claude/Claude Desktop/ChatGPT.
- **Cerințe locale:** Conectarea unui server MCP local în Claude Desktop modifică configurația și cere aprobare.
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Opțional ulterior: un panou read-only al Hub-ului (stare misiuni/aprobări) servit ca ui:// de serverul MCP local și afișat în Claude Desktop; alternativ Hub-ul poate găzdui MCP Apps în propria interfață React (instalare cu aprobare).
- **Suprafață de execuție:** hub.mcp_server
- **Echivalent la celălalt ecosistem:** Anthropic: MCP Apps în Claude și Claude Desktop. OpenAI: MCP Apps în ChatGPT și extensiile de plugin (bară laterală, panou, vizualizator).
- **Ce face unic / mai bine:** UI portabil între vendori pentru același server MCP, cu izolare sandbox.
- **Securitate:** Iframe-ul nu accesează DOM-ul, cookie-urile sau stocarea părintelui; hostul limitează ce tool-uri poate apela aplicația; CSP și permisiunile suplimentare (cameră, microfon) trebuie aprobate; conținutul HTML al serverelor terțe este nesigur.
- **Cale de implementare:** Nimic acum; după serverul MCP Hub (faza 2), prototip read-only fără origini externe în CSP și fără permisiuni suplimentare.
- **Test necesar:** Test local cu un host de referință (după aprobare): randare, fără cereri externe, apeluri de tool limitate la read-only.
- **Status:** DOCUMENTED
- **Decizie Hub:** REFERENCE
- **Încredere:** medium
- **Note:** Rezumatul automat al depozitului ext-apps a indicat un identificator diferit; identificatorul folosit aici (io.modelcontextprotocol/ui) provine din matricea oficială și din exemplele de negociere.
- **Surse citite:** https://modelcontextprotocol.io/extensions/apps/overview · https://modelcontextprotocol.io/extensions/client-matrix · https://modelcontextprotocol.io/extensions/overview · https://github.com/modelcontextprotocol/ext-apps · local: sources-openai-devday.md (enable_mcp_apps under development)
- **Verificare adversarială:** CONFIRMED — Pagina MCP Apps și README-ul ext-apps confirmă: _meta.ui.resourceUri cu ui://, preîncărcare și iframe sandbox. Comunicarea folosește un dialect JSON-RPC prin postMessage (ui/initialize, tools/call); _meta.ui.csp controlează originile, iar _meta.ui.permissions cere capabilități suplimentare. Specificația stabilă este 2026-01-26 (SEP-1865). Pachetele sunt @modelcontextprotocol/ext-apps (inclusiv app-bridge) și @mcp-ui/client. Identificatorul io.modelcontextprotocol/ui apare în matrice și în exemplul de negociere. Verificat local: în Codex 0.158, enable_mcp_apps este „under development” și false. Documentația MCP a Claude Code nu menționează MCP Apps.

### MCP Registry oficial (metadate pentru servere MCP publice) (`std-mcp-registry`)

- **Sursă oficială:** https://modelcontextprotocol.io/registry/about
- **Documentație tehnică:** https://github.com/modelcontextprotocol/registry
- **Ce face:** Registru centralizat de metadate (server.json: nume reverse-DNS precum io.github.user/server, pachet npm/PyPI/Docker sau URL remote, argumente, variabile de mediu) cu API REST la registry.modelcontextprotocol.io; autentificarea namespace-ului prin GitHub OAuth/OIDC, DNS sau HTTP; nu găzduiește cod; scanarea de securitate este delegată registrelor de pachete și agregatorilor; nu acceptă servere private; destinat agregatorilor, nu consumului direct de către hosturi; alte registre pot implementa specificația OpenAPI.
- **Plan necesar:** n/a
- **Platformă:** API REST public.
- **Rollout:** Preview (lansat în septembrie 2025); API înghețat la v0.1; pot apărea resetări înainte de GA.
- **Eligibilitate cont:** n/a
- **Autentificare:** Citire publică; publicarea cere autentificarea namespace-ului.
- **Allowance:** n/a
- **Utilizare partajată:** n/a
- **Inclus în abonament?:** not_applicable
- **Risc de facturare suplimentară (credite/extra usage):** Niciunul.
- **Risc de facturare API:** none
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** GET pe API-ul REST v0.1 pentru căutare de metadate; mcp-publisher pentru publicare (irelevant pentru Hub).
- **Suprafață nativă:** Agregatori/marketplace-uri; Anthropic Directory pentru conectori revizuiți.
- **Cerințe locale:** Acces de rețea read-only doar la cererea proprietarului.
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Sursă read-only de metadate la evaluarea unui server MCP înainte de aprobare; nicio instalare automată; catalogul privat al Hub-ului poate refolosi formatul server.json.
- **Suprafață de execuție:** hub.local
- **Echivalent la celălalt ecosistem:** Anthropic: Anthropic Directory (conectori revizuiți); OpenAI: catalogul curat de pluginuri.
- **Ce face unic / mai bine:** Namespace verificat, format standard de instalare.
- **Securitate:** Registrul nu scanează codul; un server listat nu este implicit sigur; instrucțiunile de instalare (npx/uvx) înseamnă cod nou.
- **Cale de implementare:** Nimic acum; eventual un câmp registryRef în fișa de evaluare a unui server MCP.
- **Test necesar:** n/a
- **Status:** DOCUMENTED
- **Decizie Hub:** REFERENCE
- **Încredere:** medium
- **Note:** Detaliile despre API freeze v0.1 provin dintr-un rezumat automat al README-ului GitHub.
- **Surse citite:** https://modelcontextprotocol.io/registry/about · https://github.com/modelcontextprotocol/registry
- **Verificare adversarială:** CONFIRMED — Pagina „About” confirmă: registrul este în preview și pot apărea resetări înainte de GA. Stochează metadate server.json, nu acceptă servere private și este gândit pentru agregatori, nu pentru consum direct de către hosturi. Scanarea de securitate este delegată. Specificația OpenAPI poate fi implementată de alte registre. README-ul GitHub confirmă lansarea preview la 08.09.2025, API freeze la v0.1 și unealta mcp-publisher.

### MCP Bundles (MCPB, .mcpb, fost DXT): format deschis de împachetare a serverelor MCP locale (`std-gap-mcpb-bundles`)

- **Sursă oficială:** https://github.com/modelcontextprotocol/mcpb
- **Documentație tehnică:** https://github.com/modelcontextprotocol/mcpb/blob/main/MANIFEST.md; https://github.com/modelcontextprotocol/mcpb/blob/main/CLI.md
- **Ce face:** Un fișier .mcpb este o arhivă zip cu un server MCP local (stdio), dependențele lui și un manifest.json obligatoriu, după modelul extensiilor .crx/.vsix. Manifestul descrie metadatele (name, version, description, author), serverul (server.type: node, python, binary, plus uv din schema 0.4; entry_point; mcp_config cu command, args, env și platform_overrides pentru win32/darwin/linux), configurarea cerută utilizatorului (user_config: string, number, boolean, directory, file; sensitive pentru valori mascate), compatibilitatea (compatibility.platforms, runtimes și constrângeri per client, ex. claude_desktop), uneltele și prompturile declarate static (tools, prompts, tools_generated, prompts_generated), localizarea, privacy_policies și _meta cu spații de nume reverse-DNS (ex. com.microsoft.windows). Substituții în mcp_config: ${__dirname}, ${HOME}, ${DESKTOP}, ${DOCUMENTS}, ${DOWNLOADS}, ${/}, ${user_config.KEY}. Gazda instalează pachetul cu un clic, generează UI de configurare din user_config și pornește serverul local. Versiunea specificației: manifest_version 0.3 este cea curentă (MANIFEST.md actualizat la 2.12.2025); schema 0.4 adaugă tipul uv (Python gestionat de gazdă, mcp_config opțional); repo-ul conține scheme 0.1–0.4 și un alias latest (= 0.3). Semnătura este opțională: `mcpb sign` anexează după zip o semnătură PKCS#7 SignedData în DER, între markerii MCPB_SIG_V1 și MCPB_SIG_END, cu certificat X.509 PEM cu EKU Code Signing (self-signed doar pentru dezvoltare; lanț intermediar suportat).
- **Plan necesar:** Niciunul pentru format și CLI (open source: MIT pentru codul existent, Apache-2.0 pentru contribuțiile noi). Instalarea în Claude Desktop: orice cont claude.ai autentificat în aplicația desktop; în Team/Enterprise organizația poate dezactiva sau restrânge extensiile.
- **Platformă:** Claude Desktop pe Windows (win32) și macOS (darwin), cu Node.js inclus; Claude Code prin pluginuri (mcpServers către o cale sau un URL https .mcpb/.dxt); CLI Node.js @anthropic-ai/mcpb și CLI .NET (dotnet tool mcpb.cli). MCP on Windows / On-device Agent Registry (preview; build ≥ 26220.7262, Developer Mode, .NET SDK) permite înregistrarea cu `odr mcp add <manifest file path>`, dar Microsoft precizează că pachetele MCPB nu sunt suportate implicit în sesiunea de agent, iar serverele înregistrate astfel nu sunt accesibile din ODR decât după activarea Reduce protections for agent connectors (doar pentru testare).
- **Rollout:** Creat de Anthropic ca Desktop Extensions (.dxt), redenumit .mcpb la 11.09.2025 și adoptat de proiectul MCP la 20–21.11.2025. Ultimul release GitHub: v2.1.2 (4.12.2025); package.json de pe main indică tot 2.1.2, deși main are commituri până la 22.04.2026 (validate extins, pack --manifest, env din platform_overrides îmbinat cu cel de bază). Documentația Claude: listările de extensii desktop din director sunt depreciate, iar directorul nu mai acceptă trimiteri MCPB; un server local ajunge în director doar inclus într-un plugin. MCP Registry (preview) acceptă registryType mcpb.
- **Eligibilitate cont:** Formatul nu depinde de cont. Pe această mașină: Claude Desktop este prezent (sesiunea curentă rulează în el; %APPDATA%/Claude/claude-code există), iar contul verificat local este Max, deci instalarea manuală a unui .mcpb este disponibilă owner-ului (neverificată în UI în această sesiune). CLI-ul mcpb nu este instalat (absent din PATH). Windows ODR indisponibil: odr.exe lipsește, iar build-ul 26200.9457 (25H2) este sub cerința 26220.7262.
- **Autentificare:** Niciuna pentru format. Serverul rulează local prin stdio, fără OAuth (specificația MCP 2026-07-28: la stdio credențialele se iau din mediu). Valorile user_config marcate sensitive sunt păstrate în keychain-ul sistemului (Credential Manager pe Windows).
- **Allowance:** N/A: împachetarea și rularea serverului local nu consumă inferență; doar conversațiile Claude care apelează uneltele consumă din planul Max, ca orice conversație.
- **Utilizare partajată:** N/A
- **Inclus în abonament?:** not_applicable
- **Risc de facturare suplimentară (credite/extra usage):** Niciun cost direct: formatul și uneltele sunt gratuite. Riscuri indirecte: un certificat de code signing emis de o autoritate comercială sau găzduirea publică a pachetului ar fi servicii noi (plătite sau cu expunere externă), nenecesare pentru uz local și interzise fără aprobare.
- **Risc de facturare API:** none
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Împachetarea este programatică prin CLI-ul oficial mcpb (npm @anthropic-ai/mcpb 2.1.2): `mcpb init [--yes] [--manifest-version]`, `mcpb validate <manifest\|dir>`, `mcpb pack <dir> [--manifest]` (exclude fișierele de dezvoltare și respectă .mcpbignore), `mcpb clean`, `mcpb unpack`, `mcpb sign --cert --key [--intermediate] [--self-signed]`, `mcpb verify`, `mcpb info`, `mcpb unsign`; schemele versionate sunt exportate și ca scheme zod (mcpb/browser). Instalarea nu are API: în Claude Desktop se face din UI (dublu-clic, drag-and-drop sau Settings > Extensions > Advanced settings > Install Extension…), cu previzualizare, configurare și permisiuni; în Claude Code, plugin.json poate declara în mcpServers o cale sau un URL https către .mcpb/.dxt, extras în .mcpb-cache/ sub rădăcina pluginului (instalarea pluginului rămâne o modificare de configurare cu aprobare); pe Windows ODR: `odr mcp add <manifest file path>`, cu _meta.com.microsoft.windows.static_responses obligatoriu (initialize și tools/list identice cu răspunsurile la runtime). În MCP Registry: packages[].registryType mcpb, identifier = URL din GitHub/GitLab Releases care conține „mcp”, fileSha256 obligatoriu (verificat de clienți, nu de registry).
- **Suprafață nativă:** Claude Desktop (Windows/macOS): Settings > Extensions, cu ecran de instalare și configurare; Claude Code: pluginuri care referă un .mcpb; Windows: On-device Agent Registry (preview) și odr.exe.
- **Cerințe locale:** Node 24 local (există) pentru serverul Hub; CLI @anthropic-ai/mcpb neinstalat (instalarea globală npm cere aprobare); un server MCP stdio al Hub-ului, care nu există azi (în V2, companion/MCP este permis doar cu expunere aprobată); Claude Desktop pe Windows (prezent). Pentru ODR: build ≥ 26220.7262, Developer Mode și .NET SDK (dotnet există), dar build-ul local este 26200.9457 și odr.exe lipsește.
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Formatul de distribuție pentru un eventual server MCP local, read-only, al Hub-ului (stdio), instalat de owner în Claude Desktop sau inclus în pachetul de plugin Claude Code exportat de Hub; Hub-ul rămâne sursa canonică, iar pachetul expune doar unelte aprobate.
- **Suprafață de execuție:** hub.local
- **Echivalent la celălalt ecosistem:** OpenAI nu documentează suport .mcpb: Codex adaugă servere stdio cu `codex mcp add <nume> -- <comandă>` sau [mcp_servers] în config.toml, ChatGPT Desktop prin Settings > MCP servers > Add server, iar pluginurile portabile declară servere în mcp.json (schema Agent Plugins 1.0.0: stdio, streamable-http, sse; fără .mcpb); pluginurile publicate în director cer un URL HTTPS public. Microsoft (MCP on Windows) folosește MCPB cu _meta.com.microsoft.windows.
- **Ce face unic / mai bine:** Instalare cu un clic fără runtime separat (Node.js inclus în Claude Desktop), UI de configurare generat din user_config, secrete în keychain-ul OS, compatibilitate declarativă pe platforme și runtime-uri, semnătură opțională și același pachet utilizabil în Claude Desktop, pluginuri Claude Code, Windows ODR și MCP Registry (cu fileSha256).
- **Securitate:** Extensia rulează cod local cu permisiunile utilizatorului (poate accesa tot ce accesează owner-ul); nu este un sandbox. Semnătura este opțională, iar self-signed nu dovedește identitatea editorului; paginile oficiale citite nu descriu verificarea semnăturii în Claude Desktop. Riscuri: dependențe incluse (supply chain), zip-slip (corectat la unpack în v0.2.6), includerea accidentală de secrete (.env*, .ifrim/private, baze de date) — obligatoriu .mcpbignore strict și inspecția conținutului înainte de livrare; un URL .mcpb dintr-un plugin poate schimba conținutul după review (un issue public cere pin SHA-256). Pe Windows ODR, pachetele MCPB rulează în sesiunea de agent doar dacă se activează Reduce protections for agent connectors — nu se activează.
- **Cale de implementare:** 1) Decizie separată a owner-ului: expune Hub-ul un server MCP local read-only (stdio)? Fără ea, recordul rămâne referință. 2) Manifest cu manifest_version 0.3, server.type node, entry_point server/index.mjs, mcp_config {command: node, args: [${__dirname}/server/index.mjs]}, compatibility.platforms [win32], user_config pentru portul Hub și un token local (sensitive), tools declarate static. 3) După aprobarea instalării CLI-ului: `mcpb validate` → `mcpb pack` cu .mcpbignore strict → `mcpb info` și listarea conținutului (scanare de secrete) → opțional `mcpb sign --self-signed` doar local și `mcpb verify`; SHA-256 înregistrat în auditul Hub. 4) Livrare ASSISTED: owner-ul instalează în Claude Desktop sau Hub-ul adaugă pachetul în pluginul Claude Code exportat (mcpServers: ./hub.mcpb), instalat tot cu aprobare. 5) Fără publicare în MCP Registry sau GitHub Releases fără aprobare explicită.
- **Test necesar:** Fără modele: validarea manifestului pe schema 0.3 (fixture-uri pozitive și negative), test că arhiva nu conține căi interzise (.env*, .ifrim/private, *.db), pornirea serverului stdio și un handshake MCP local cu un client de test, `mcpb verify` și verificarea SHA-256. Instalarea în Claude Desktop doar cu aprobare, urmată de un smoke test manual (lista uneltelor, un apel read-only).
- **Status:** NEEDS_SETUP
- **Decizie Hub:** WRAP
- **Încredere:** high
- **Note:** Înlocuiește afirmația că versiunea npm curentă nu a putut fi confirmată: registry.npmjs.org returnează pentru @anthropic-ai/mcpb latest = 2.1.2 (verificat la 30.09.2026), aceeași cu release-ul GitHub v2.1.2 și cu package.json de pe main.
- **Surse citite:** https://github.com/modelcontextprotocol/mcpb · https://raw.githubusercontent.com/modelcontextprotocol/mcpb/main/README.md · https://raw.githubusercontent.com/modelcontextprotocol/mcpb/main/MANIFEST.md · https://raw.githubusercontent.com/modelcontextprotocol/mcpb/main/CLI.md · https://raw.githubusercontent.com/modelcontextprotocol/mcpb/main/src/cli/cli.ts · https://raw.githubusercontent.com/modelcontextprotocol/mcpb/main/package.json · https://raw.githubusercontent.com/modelcontextprotocol/mcpb/main/schemas/mcpb-manifest-latest.schema.json · https://raw.githubusercontent.com/modelcontextprotocol/mcpb/main/schemas/mcpb-manifest-v0.4.schema.json · https://api.github.com/repos/modelcontextprotocol/mcpb/releases · https://api.github.com/repos/modelcontextprotocol/mcpb/commits · https://blog.modelcontextprotocol.io/posts/2025-11-20-adopting-mcpb/ · https://www.anthropic.com/engineering/desktop-extensions · https://claude.com/docs/connectors/building/mcpb · https://claude.com/docs/connectors/custom/desktop-extensions · https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop · https://code.claude.com/docs/en/plugins-reference · https://code.claude.com/docs/en/mcp · https://modelcontextprotocol.io/registry/package-types · https://modelcontextprotocol.io/specification/latest/basic/authorization · https://learn.microsoft.com/en-us/windows/ai/mcp/servers/mcp-mcpb · https://learn.microsoft.com/en-us/windows/ai/mcp/overview · https://learn.microsoft.com/en-us/windows/ai/mcp/odr-tool · https://devblogs.microsoft.com/azure-sdk/azure-mcp-server-mcpb-support/ · https://learn.chatgpt.com/docs/extend/mcp · https://developers.openai.com/plugins/build/plugins · https://agent-plugins.org/schemas/1.0.0/mcp.schema.json · https://github.com/anthropics/claude-plugins-official/tree/main/plugins/mcp-server-dev · https://github.com/anthropics/claude-code/issues/96144 (issue comunitar, neoficial) · local: registry HKLM CurrentVersion → build 26200.9457 (25H2); PATH: odr.exe și mcpb absente, dotnet prezent · local: .ifrim/V2_SPEC.md și .ifrim/V2_TEST_REPORT.md (companion/MCP doar cu expunere aprobată, T24)
- **Verificare adversarială:** CORRECTED (corectat: programmaticIntegration (https://raw.githubusercontent.com/modelcontextprotocol/mcpb/main/src/cli/cli.ts; https://raw.githubusercontent.com/modelcontextprotocol/mcpb/main/CLI.md; https://code.claude.com/docs/en/plugins-reference), platform (https://learn.microsoft.com/en-us/windows/ai/mcp/servers/mcp-mcpb; https://learn.microsoft.com/en-us/windows/ai/mcp/odr-tool), notes (https://registry.npmjs.org/@anthropic-ai%2Fmcpb/latest)) — Rezistă: planRequired (README: licență duală, MIT pentru codul existent și Apache-2.0 pentru contribuțiile noi; claude.com: extensia se instalează în aplicația desktop de orice utilizator autentificat în claude.ai, iar organizația o poate dezactiva sau limita), subscriptionIncluded not_applicable, apiBillingRisk none, status NEEDS_SETUP (CLI-ul mcpb lipsește local, iar Hub-ul nu are încă un server MCP stdio) și hubDecision WRAP, condiționat de decizia owner-ului privind expunerea MCP. Corectat programmaticIntegration: CLI-ul oficial rulează local, fără cont și neinteractiv (`mcpb init --yes`, validate, pack, sign, verify, info, unsign, clean, unpack), iar Claude Code încarcă un .mcpb/.dxt declarat în mcpServers al unui plugin; doar instalarea în Claude Desktop rămâne manuală (dublu-clic, drag-and-drop sau Settings > Extensions > Advanced settings > Install Extension…), acoperită de recordul an-desktop-extensions-local-mcp. Valoarea ASSISTED contrazicea și hubDecision WRAP, care presupune un CLI oficial condus de Hub (executionSurface hub.local). Confirmate și: release v2.1.2 (4.12.2025) cu commituri pe main până la 22.04.2026, manifest 0.3 actualizat la 2.12.2025 și tipul uv din 0.4, redenumirea DXT→MCPB la 11.09.2025, blogul MCP din 21.11.2025 (Claude desktop app, Claude Code, MCP for Windows), depreciarea listărilor MCPB din director, registryType mcpb cu fileSha256 verificat de clienți și corectarea zip-slip în v0.2.6. Nuanțe: `claude plugin validate` verifică intrările MCP abia din v2.1.281, iar CLI-ul npm local este 2.1.175; versiunea minimă pentru .mcpb în pluginuri rămâne nedocumentată. Afirmația din uniqueStrengths despre utilizarea aceluiași pachet în Windows ODR trebuie citită cu restricția din corectura platform.

### MCP: extensia OAuth Client Credentials (io.modelcontextprotocol/oauth-client-credentials), autentificare mașină-la-mașină (`std-gap-mcp-ext-oauth-client-credentials`)

- **Sursă oficială:** https://modelcontextprotocol.io/extensions/auth/oauth-client-credentials
- **Documentație tehnică:** https://github.com/modelcontextprotocol/ext-auth/blob/main/specification/draft/oauth-client-credentials.mdx
- **Ce face:** Extensie oficială de autorizare (repo ext-auth) care adaugă la MCP grant-ul OAuth 2.0 client_credentials (RFC 6749 §4.4), pentru procese fără utilizator: servicii de fundal, CI/CD, integrări server-la-server, daemoni. Clientul obține un access token direct de la authorization server cu credențiale de aplicație și îl trimite ca Authorization: Bearer serverului MCP, fără browser și fără consimțământ interactiv. Două metode de autentificare a clientului: JWT bearer assertion (RFC 7523, client_assertion_type urn:ietf:params:oauth:client-assertion-type:jwt-bearer; recomandată) sau client_id + client_secret. Descoperire: 401 cu WWW-Authenticate resource_metadata (RFC 9728), apoi metadatele AS (RFC 8414) cu token_endpoint_auth_methods_supported (private_key_jwt sau client_secret_basic) și token_endpoint_auth_signing_alg_values_supported; cererea de token poartă resource (RFC 8707) și scope. Negociere în nucleul 2026-07-28: clientul declară extensia în _meta['io.modelcontextprotocol/clientCapabilities'].extensions la fiecare cerere, iar serverul o poate anunța în capabilities.extensions din răspunsul server/discover. La insufficient_scope, un client client_credentials poate încerca step-up sau poate abandona cererea.
- **Plan necesar:** Niciunul (standard deschis). Necesită un authorization server OAuth care emite tokenuri client_credentials.
- **Platformă:** Doar transporturi HTTP (Streamable HTTP); specificația MCP spune că la stdio nu se aplică autorizarea OAuth, credențialele venind din mediu.
- **Rollout:** Specificație în stadiul draft (ext-auth/specification/draft, Protocol Revision: draft; în stable există doar enterprise-managed-authorization); extensie opțională, dezactivată implicit. Matricea de suport (întreținută de comunitate) bifează doar mcpc (Apify); Claude (web), Claude Desktop, ChatGPT, Cursor și VS Code nu sunt bifate. SDK-urile oficiale au provideri dedicați: TypeScript v2 (@modelcontextprotocol/client), documentat ca linia stabilă care implementează specificația 2026-07-28 (nu beta), și Python (mcp).
- **Eligibilitate cont:** Independentă de cont. Niciunul dintre clienții owner-ului nu documentează extensia: Claude Code oferă doar clienți OAuth preconfigurați pentru fluxul authorization code, iar Codex doar CIMD/DCR, --oauth-client-id și bearer_token_env_var.
- **Autentificare:** OAuth 2.0 client_credentials: private_key_jwt (RFC 7523) sau client_secret; token Bearer restrâns la serverul MCP prin resource (RFC 8707).
- **Allowance:** N/A (fără inferență).
- **Utilizare partajată:** N/A
- **Inclus în abonament?:** not_applicable
- **Risc de facturare suplimentară (credite/extra usage):** Niciun cost de inferență. Riscul este un authorization server găzduit (IdP comercial) = serviciu nou plătit, interzis fără aprobare; un AS local ar trebui construit și aprobat separat.
- **Risc de facturare API:** none
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** SDK TypeScript v2 (@modelcontextprotocol/client): ClientCredentialsProvider({clientId, clientSecret}) și PrivateKeyJwtProvider({clientId, privateKey, algorithm: RS256}), transmise ca authProvider la StreamableHTTPClientTransport; la 401 providerul reîmprospătează tokenul și reîncearcă o dată. SDK Python (mcp): ClientCredentialsOAuthProvider și PrivateKeyJWTOAuthProvider (mcp.client.auth.extensions.client_credentials; exemplul oficial folosește aserțiuni de 300 s). Declarare client: _meta['io.modelcontextprotocol/clientCapabilities'].extensions['io.modelcontextprotocol/oauth-client-credentials'] = {}. Server: capabilities.extensions în server/discover, Protected Resource Metadata la /.well-known/oauth-protected-resource, validarea JWT prin JWKS, a scope-ului și a audience-ului. Niciun CLI Claude sau OpenAI nu folosește extensia.
- **Suprafață nativă:** Niciuna în produsele Claude sau OpenAI. Echivalente apropiate: Claude Code `claude mcp add --transport http --client-id … --client-secret --callback-port …` (authorization code cu client preînregistrat) și headers/headersHelper; claude.ai: Use your own OAuth client și Request headers (beta, organizații limitate); Codex: bearer_token_env_var, --oauth-client-id, CIMD/DCR.
- **Cerințe locale:** Un endpoint MCP HTTP al Hub-ului (inexistent; în V2 companion/MCP este permis doar cu expunere aprobată), un authorization server cu JWKS, cheia sau secretul păstrate în afara repo-ului (Windows Credential Manager/DPAPI) și SDK-ul MCP (instalare cu aprobare).
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Referință de design pentru o eventuală expunere HTTP a serverului MCP al Hub-ului către procese automate; implicit Hub-ul folosește stdio (credențiale din mediu) sau loopback cu token Hub și verificare Origin/Host (T24).
- **Suprafață de execuție:** hub.local
- **Echivalent la celălalt ecosistem:** OpenAI: Codex are bearer_token_env_var, OAuth cu CIMD/DCR și --oauth-client-id, fără extensia client credentials. Anthropic: Claude Code are --client-id/--client-secret pentru authorization code și headersHelper; claude.ai are client OAuth propriu și Request headers. Niciunul nu implementează extensia.
- **Ce face unic / mai bine:** Singurul mecanism MCP standardizat pentru acces fără utilizator; private_key_jwt evită secretele partajate de lungă durată; se compune cu Protected Resource Metadata, resource indicators și scopuri minime.
- **Securitate:** client_secret este o credențială de lungă durată: secrets manager, rotație, scopuri minime; preferă private_key_jwt cu aserțiuni de scurtă durată. Serverul trebuie să valideze semnătura, aud/resource, exp și scope și să refuze tokenurile emise pentru alt resource; tokenurile nu se pun în query string. Hub-ul nu citește și nu tipărește secrete, iar tokenurile de abonament ale vendorilor nu se folosesc niciodată ca credențiale MCP.
- **Cale de implementare:** 1) Acum: nimic (REFERENCE). 2) Dacă se aprobă un server MCP al Hub-ului: întâi stdio/MCPB, fără OAuth. 3) Dacă apare nevoia de HTTP pe 127.0.0.1 pentru procese proprii: token Hub + verificare Origin/Host (deja testate în T24). 4) Extensia se implementează doar când un client folosit de Hub o suportă: server — PRM (RFC 9728), validare JWT prin JWKS, scope, resource, anunț în server/discover; client — ClientCredentialsProvider/PrivateKeyJwtProvider din SDK și declarare în _meta.
- **Test necesar:** Fără modele: teste negative de token (semnătură invalidă, aud/resource greșit, expirat, scope insuficient → 401/403 cu WWW-Authenticate), cerere fără token → 401 cu resource_metadata, prezența extensiei în server/discover; interoperabilitate locală cu un client SDK.
- **Status:** DOCUMENTED
- **Decizie Hub:** REFERENCE
- **Încredere:** high
- **Note:** Spre deosebire de Enterprise-Managed Authorization (stable), această extensie este încă draft. Matricea de clienți este întreținută de comunitate, deci suportul real poate diferi. Relevanța urcă la MEDIUM doar dacă Hub-ul expune MCP prin HTTP unor procese automate care implementează extensia.
- **Surse citite:** https://modelcontextprotocol.io/extensions/auth/oauth-client-credentials · https://raw.githubusercontent.com/modelcontextprotocol/ext-auth/main/specification/draft/oauth-client-credentials.mdx · https://github.com/modelcontextprotocol/ext-auth · https://api.github.com/repos/modelcontextprotocol/ext-auth/contents/specification · https://modelcontextprotocol.io/extensions/overview · https://modelcontextprotocol.io/extensions/client-matrix · https://modelcontextprotocol.io/specification/latest/basic/authorization · https://ts.sdk.modelcontextprotocol.io/v2/clients/machine-auth · https://code.claude.com/docs/en/mcp · https://learn.chatgpt.com/docs/extend/mcp · https://claude.com/docs/connectors/custom/desktop-extensions · local: .ifrim/V2_SPEC.md (companion/MCP doar cu expunere aprobată), .ifrim/V2_TEST_REPORT.md T24 (token/Origin/Host)
- **Verificare adversarială:** CORRECTED (corectat: rollout (https://ts.sdk.modelcontextprotocol.io/v2/; https://ts.sdk.modelcontextprotocol.io/v2/clients/machine-auth; https://modelcontextprotocol.io/extensions/client-matrix; https://api.github.com/repos/modelcontextprotocol/ext-auth/contents/specification/draft)) — Rezistă toate cele șase câmpuri: planRequired (standard deschis, cere un authorization server), subscriptionIncluded not_applicable, apiBillingRisk none, programmaticIntegration PROGRAMMATIC (ClientCredentialsProvider și PrivateKeyJwtProvider în SDK-ul TypeScript v2, ClientCredentialsOAuthProvider și PrivateKeyJWTOAuthProvider în SDK-ul Python), status DOCUMENTED și hubDecision REFERENCE. Specificația normativă cere private_key_jwt sau client_secret_basic, folosește grant_type=client_credentials cu client_assertion_type jwt-bearer (RFC 7523 §2.2) și parametrul resource și vizează explicit doar transporturile HTTP. Nucleul 2026-07-28 confirmă că implementările STDIO iau credențialele din mediu și că un client client_credentials poate încerca step-up sau abandona cererea; negocierea se face prin _meta clientCapabilities și server/discover. Documentația MCP a Claude Code (--client-id, --client-secret, --callback-port, CIMD, DCR, headersHelper) și cea Codex (bearer_token_env_var, OAuth, --oauth-client-id, CIMD, DCR, headere statice sau helper) nu menționează client_credentials. Singura corectură: SDK-ul TypeScript v2 nu este marcat beta, ci descris ca linie stabilă. Notă de proces: la verificarea paginii machine-auth s-a creat și s-a șters imediat un fișier temporar în %TEMP% (ma.html); niciun fișier al proiectului nu a fost atins.

### MCP: extensia Enterprise-Managed Authorization (io.modelcontextprotocol/enterprise-managed-authorization, ID-JAG) (`std-gap-mcp-ext-enterprise-managed-auth`)

- **Sursă oficială:** https://modelcontextprotocol.io/extensions/auth/enterprise-managed-authorization
- **Documentație tehnică:** https://github.com/modelcontextprotocol/ext-auth/blob/main/specification/stable/enterprise-managed-authorization.mdx
- **Ce face:** Organizația controlează central, prin IdP-ul enterprise (ex. Okta), ce servere MCP pot folosi angajații. Clientul MCP autentifică utilizatorul prin SSO enterprise (OIDC ID Token sau SAML), schimbă aserțiunea de identitate la IdP (RFC 8693 token exchange) pe un ID-JAG (Identity Assertion JWT Authorization Grant, urn:ietf:params:oauth:token-type:id-jag) după evaluarea politicii, apoi prezintă ID-JAG ca JWT bearer grant (urn:ietf:params:oauth:grant-type:jwt-bearer, RFC 7523) authorization server-ului MCP, care emite un access token restrâns la serverul din claim-ul resource. Clientul nu redirecționează utilizatorul spre AS-ul MCP; suportul se descoperă prin authorization_grant_profiles_supported cu urn:ietf:params:oauth:grant-profile:id-jag. Revocarea se face central, la IdP. Se bazează pe drafturile IETF identity-assertion-authz-grant și identity-chaining; originea este SEP-990.
- **Plan necesar:** IdP enterprise obligatoriu; la Anthropic, doar Claude Team și Enterprise (claude.com, 18.06.2026, actualizat la 24.08.2026).
- **Platformă:** Clienți: Claude (chat), Claude Code și Cowork pe Team/Enterprise, plus VS Code; IdP: Okta (Cross App Access); servere la lansare: Asana, Atlassian, Canva, Figma, Granola, Linear, Supabase, ulterior Datadog, Notion și Slack.
- **Rollout:** Stabilă din 18.06.2026 (blog MCP). La Anthropic: beta la lansare, apoi GA conform actualizării din 24.08.2026.
- **Eligibilitate cont:** Neeligibil: owner-ul are Claude Max (plan individual), fără IdP enterprise; pentru ChatGPT/Codex nu există suport documentat (matricea nu bifează ChatGPT).
- **Autentificare:** SSO enterprise (OIDC/SAML) → ID-JAG prin RFC 8693 → JWT bearer grant (RFC 7523) → access token MCP.
- **Allowance:** N/A
- **Utilizare partajată:** N/A
- **Inclus în abonament?:** no
- **Risc de facturare suplimentară (credite/extra usage):** Ar necesita trecerea la Claude Team/Enterprise și un IdP enterprise (Okta Cross App Access): upgrade de plan și serviciu nou plătit, ambele interzise de politica INCLUDED_SUBSCRIPTION_ONLY.
- **Risc de facturare API:** high
- **Integrare programatică:** NONE
- **Detaliu integrare:** Pentru Hub: niciuna. În ecosistem: declarare _meta['io.modelcontextprotocol/clientCapabilities'].extensions['io.modelcontextprotocol/enterprise-managed-authorization']; SDK TypeScript v2 are CrossAppAccessProvider (ID Token → JWT Authorization Grant → access token); la Anthropic, adminul configurează accesul în IdP (grupuri/roluri), iar utilizatorii moștenesc conectorii la prima autentificare.
- **Suprafață nativă:** Claude Team/Enterprise: conectori provizionați de admin prin IdP, fără ecran de consimțământ per utilizator (Claude chat, Claude Code, Cowork).
- **Cerințe locale:** N/A (ar necesita IdP enterprise și plan de organizație).
- **Relevanță pentru Hub:** NONE
- **Rol propus:** Niciun rol în V2: Hub-ul este local, cu un singur owner și fără IdP; recordul există pentru completitudinea catalogului și pentru o eventuală decizie viitoare a owner-ului.
- **Suprafață de execuție:** none
- **Echivalent la celălalt ecosistem:** OpenAI: nicio implementare documentată a extensiei în ChatGPT sau Codex. Anthropic: Enterprise-managed auth pentru conectori (Team/Enterprise, Okta).
- **Ce face unic / mai bine:** Autorizare o singură dată la nivel de organizație, moștenită de utilizatori prin grupuri și roluri; revocare centrală imediată; audit la IdP; fără OAuth per aplicație.
- **Securitate:** Concentrează controlul și riscul în IdP; IdP-ul vede doar emiterea tokenurilor, nu traficul MCP; clientul trebuie probabil preînregistrat la IdP; account linking pe claim-ul subject, cu email doar ca fallback.
- **Cale de implementare:** Niciuna. Reevaluare doar dacă owner-ul aprobă explicit un plan de organizație și un IdP; până atunci Hub-ul nu implementează și nu simulează fluxul.
- **Test necesar:** Niciunul în V2.
- **Status:** PLAN_RESTRICTED
- **Decizie Hub:** NOT_APPLICABLE
- **Încredere:** high
- **Note:** Pentru ruta nativă Claude, statusul ar fi și PLAN_RESTRICTED (doar Team/Enterprise). În matricea comunitară, mcpc bifează ambele extensii de autorizare, iar Archestra.AI bifează Enterprise Auth.
- **Surse citite:** https://modelcontextprotocol.io/extensions/auth/enterprise-managed-authorization · https://raw.githubusercontent.com/modelcontextprotocol/ext-auth/main/specification/stable/enterprise-managed-authorization.mdx · https://github.com/modelcontextprotocol/ext-auth · https://blog.modelcontextprotocol.io/posts/enterprise-managed-auth/ · https://claude.com/blog/enterprise-managed-auth · https://modelcontextprotocol.io/extensions/client-matrix · https://ts.sdk.modelcontextprotocol.io/v2/clients/machine-auth · local: scratchpad sources-anthropic-local.md (claude auth status: subscriptionType max)
- **Verificare adversarială:** CORRECTED (corectat: status (https://claude.com/blog/enterprise-managed-auth (doar Claude Team și Enterprise; GA la 24.08.2026); local: claude auth status → subscriptionType max (scratchpad sources-anthropic-local.md))) — Rezistă planRequired (IdP enterprise; la Anthropic doar Team și Enterprise), subscriptionIncluded no, apiBillingRisk high (upgrade de plan plus IdP enterprise plătit), programmaticIntegration NONE pentru Hub (SDK-ul TypeScript v2 are CrossAppAccessProvider, dar fără IdP enterprise nu poate fi folosit) și hubDecision NOT_APPLICABLE (Hub local cu un singur owner; orice adopție ar cere upgrade de plan și IdP, interzise de INCLUDED_SUBSCRIPTION_ONLY). Blogul claude.com (18.06.2026, actualizat la 24.08.2026) confirmă GA, suprafețele Claude chat, Claude Code și Cowork, Okta la lansare și adăugarea ulterioară a Datadog, Notion și Slack; blogul MCP confirmă statutul stable din 18.06.2026 și suportul în Claude și VS Code; nu am găsit documentație OpenAI despre ID-JAG sau Cross App Access în ChatGPT/Codex, iar matricea comunitară bifează doar Archestra.AI și mcpc. Corectat status: vocabularul definește PLAN_RESTRICTED pentru funcții neincluse în planul owner-ului, iar singura implementare nativă documentată în ecosistemele owner-ului este rezervată Team/Enterprise, în timp ce planul verificat local este Max; NOT_APPLICABLE ascundea această cauză.

## scheduling

### MCP Triggers & Events (propunere de working group, extensie experimentală) (`std-mcp-triggers-events`)

- **Sursă oficială:** https://modelcontextprotocol.io/community/working-groups/triggers-events
- **Documentație tehnică:** https://github.com/modelcontextprotocol/experimental-ext-triggers-events/blob/main/docs/design-sketch-proposal.md
- **Ce face:** Working group-ul (carta din 24.03.2026, lideri de la AWS și Anthropic) definește notificări proactive de la server la client. Schița din 19.02.2026 descrie events/list și trei moduri de livrare: poll (events/poll), push (events/stream, cu heartbeat) și webhook (events/subscribe/unsubscribe, cu TTL acordat de server și refresh). Mai definește notificările de control active, gap, terminated și heartbeat, precum și cursoare opace cu replay limitat prin maxAgeMs. Webhook-urile sunt semnate după Standard Webhooks (HMAC-SHA256, antetele webhook-id, webhook-timestamp și webhook-signature), cu secrete whsec_ furnizate de client. Endpoint-ul se verifică prin challenge; protecția SSRF și TLS sunt obligatorii. Propunerea nu face parte din specificația oficială. ChatGPT plugins implementează doar livrarea prin webhook (events/list, events/subscribe, events/unsubscribe) peste protocolul 2026-07-28, fără poll, stream, gap sau terminated. ChatGPT, ca client MCP, apelează events/subscribe pe serverul MCP al pluginului și îi dă un URL de callback propriu. Serverul pluginului trimite acolo evenimentele semnate (inclusiv antetul X-MCP-Subscription-Id), după un challenge de unică folosință. Blocarea adreselor private, locale sau nepublice și refuzul redirecționărilor sunt cerințe SSRF pentru serverul pluginului, nu o restricție impusă de ChatGPT.
- **Plan necesar:** n/a pentru standard; ChatGPT: toate abonamentele (conform recapitulării DevDay).
- **Platformă:** ChatGPT plugins (webhook HTTPS public).
- **Rollout:** Experimental; SEP-ul „Events in MCP v1” era în stadiul de ideație în cartă.
- **Eligibilitate cont:** Neaplicabil Hub-ului loopback.
- **Autentificare:** Principal autentificat pentru abonamente; HMAC Standard Webhooks pentru livrări.
- **Allowance:** n/a
- **Utilizare partajată:** Automatizările ChatGPT declanșate de evenimente consumă din planul ChatGPT.
- **Inclus în abonament?:** not_applicable
- **Risc de facturare suplimentară (credite/extra usage):** Expunerea unui endpoint HTTPS public (tunel/hosting) ar fi un serviciu nou, posibil plătit — refuzat fără aprobare.
- **Risc de facturare API:** none
- **Integrare programatică:** NONE
- **Detaliu integrare:** Pentru Hub: niciuna. În integrarea ChatGPT, ChatGPT trebuie să poată apela serverul MCP al pluginului prin Streamable HTTP, la un URL HTTPS stabil. Serverul are nevoie de stocare persistentă a abonamentelor și de acces HTTPS de ieșire către callback-urile ChatGPT. Un Hub care rulează doar pe loopback nu poate îndeplini aceste condiții fără expunere publică (tunel sau hosting), care nu este autorizată. Pentru referință: events/list, events/subscribe, events/unsubscribe, events/poll, events/stream; notifications/events/active, gap, terminated și heartbeat.
- **Suprafață nativă:** Automatizări de plugin în ChatGPT.
- **Cerințe locale:** n/a
- **Relevanță pentru Hub:** MEDIUM
- **Rol propus:** Aliniere semantică a busului intern de evenimente al Hub-ului (cursor, deduplicare, gap, terminated, replay limitat de vârstă) cu schița; fără abonări externe.
- **Suprafață de execuție:** openai.plugins
- **Echivalent la celălalt ecosistem:** OpenAI: MCP Events în ChatGPT plugins. Anthropic: co-lider al WG-ului; niciun suport de produs găsit în sursele citite.
- **Ce face unic / mai bine:** Model complet de livrare cu ordonare și reluare, util ca referință pentru busul intern.
- **Securitate:** Payload-urile evenimentelor sunt date nesigure; webhook-urile cer semnare, protecție la replay și SSRF; abonările trebuie revocabile.
- **Cale de implementare:** Nicio integrare externă; documentează maparea stărilor busului intern la gap/terminated.
- **Test necesar:** Busul intern: deduplicare, ordine, replay (deja testat conform auditului anterior); test pentru semantica gap la cursor expirat.
- **Status:** BLOCKED
- **Decizie Hub:** REFERENCE
- **Încredere:** medium
- **Note:** Numele metodelor provin din schița de design și din documentația OpenAI; README-ul depozitului nu le detaliază.
- **Surse citite:** https://modelcontextprotocol.io/community/working-groups/triggers-events · https://github.com/modelcontextprotocol/experimental-ext-triggers-events · https://raw.githubusercontent.com/modelcontextprotocol/experimental-ext-triggers-events/main/README.md · https://github.com/modelcontextprotocol/experimental-ext-triggers-events/blob/main/docs/design-sketch-proposal.md · https://developers.openai.com/plugins/build/mcp-events · local: sources-openai-devday.md (DevDay 29.09.2026, MCP Events for plugin automations)
- **Verificare adversarială:** CORRECTED (corectat: whatItDoes (https://developers.openai.com/plugins/build/mcp-events; https://github.com/modelcontextprotocol/experimental-ext-triggers-events/blob/main/docs/design-sketch-proposal.md; https://modelcontextprotocol.io/community/working-groups/triggers-events), programmaticDetail (https://developers.openai.com/plugins/build/mcp-events; https://developers.openai.com/plugins/build/mcp-server)) — Carta WG confirmă restul înregistrării: 24.03.2026, lideri Clare Liguori (AWS) și Peter Alexander (Anthropic), SEP-ul „Events in MCP v1” în stadiul Ideating. Schița din 19.02.2026 confirmă și ea detaliile tehnice. Eroarea corectată: blocarea adreselor private sau locale este o cerință SSRF pentru serverul pluginului la livrare, nu o restricție a ChatGPT asupra Hub-ului. Motivul pentru BLOCKED rămâne lipsa unui endpoint public aprobat. Aceeași formulare greșită apare în v2/config/capabilities.json (I-mcp-events) și trebuie aliniată.

## knowledge

### AGENTS.md (convenție deschisă de instrucțiuni pentru agenți) (`std-agents-md`)

- **Sursă oficială:** https://agents.md/
- **Documentație tehnică:** https://learn.chatgpt.com/docs/agent-configuration/agents-md
- **Ce face:** Fișier Markdown simplu, fără câmpuri obligatorii („README pentru agenți”); în monorepo, fișierul cel mai apropiat de cod are prioritate; administrat de Agentic AI Foundation (Linux Foundation), folosit de peste 60.000 de proiecte. Codex: la fiecare director de la rădăcina Git spre directorul curent citește AGENTS.override.md, altfel AGENTS.md, altfel numele din project_doc_fallback_filenames (maximum un fișier per director), concatenează de la rădăcină în jos, cu limita project_doc_max_bytes (32 KiB implicit); fișier global în ~/.codex (CODEX_HOME). Claude Code: citește nativ AGENTS.md de la v2.1.277, implicit doar când nu există CLAUDE.md/CLAUDE.local.md (setarea Project instructions: claude-md-or-agents-md \| claude-md-and-agents-md \| claude-md \| managed-only); nu citește AGENTS.local.md, AGENTS.override.md sau .agents/; alternativ import @AGENTS.md din CLAUDE.md.
- **Plan necesar:** n/a
- **Platformă:** Codex CLI/desktop, Claude Code, Cursor, VS Code, GitHub Copilot, Jules, Zed, Warp, Devin, Junie, Aider și alții.
- **Rollout:** Convenție stabilă; suport nativ în Claude Code din v2.1.277.
- **Eligibilitate cont:** Local: Claude Code 2.1.175 (sub 2.1.277) nu citește nativ AGENTS.md, iar repo-ul are CLAUDE.md, deci Claude citește doar CLAUDE.md; Codex 0.158 citește AGENTS.md din rădăcina repo-ului.
- **Autentificare:** n/a
- **Allowance:** Consumă context în fiecare sesiune (Codex: max. 32 KiB combinat implicit; Claude: recomandat sub 200 de linii per fișier).
- **Utilizare partajată:** n/a
- **Inclus în abonament?:** not_applicable
- **Risc de facturare suplimentară (credite/extra usage):** Niciunul.
- **Risc de facturare API:** none
- **Integrare programatică:** PROGRAMMATIC
- **Detaliu integrare:** Fișiere în repo. Codex: project_doc_max_bytes și project_doc_fallback_filenames în ~/.codex/config.toml. Claude Code: pluginConfigs["agents-md@builtin"].options.instructionFiles (doar în setările user, --settings sau managed), import @AGENTS.md în CLAUDE.md, verificare cu /memory și /context. V2 routes.mjs listează deja CLAUDE.md și AGENTS.md printre fișierele de instrucțiuni ale proiectului.
- **Suprafață nativă:** Editor de text; Claude Code /memory, /config, /init; Codex /init.
- **Cerințe locale:** Orice modificare a AGENTS.md sau CLAUDE.md cere aprobarea proprietarului.
- **Relevanță pentru Hub:** HIGH
- **Rol propus:** Sursa comună de instrucțiuni de proiect pentru ambii vendori, generată din instrucțiunile canonice ale Hub-ului: AGENTS.md neutru + CLAUDE.md care începe cu @AGENTS.md și adaugă doar reguli specifice Claude (import, nu symlink, pe Windows).
- **Suprafață de execuție:** hub.local
- **Echivalent la celălalt ecosistem:** Anthropic: CLAUDE.md (+ .claude/rules, auto memory). OpenAI: AGENTS.md nativ în Codex (+ AGENTS.override.md).
- **Ce face unic / mai bine:** Cel mai simplu mecanism portabil de context de proiect; fără schemă; administrare neutră (AAIF).
- **Securitate:** Instrucțiunile sunt context, nu aplicare forțată (blocarea se face prin permisiuni/hooks); un AGENTS.md dintr-un repo neîncrezător influențează agentul; AGENTS.override.md are prioritate tacită în Codex; divergența dintre AGENTS.md și CLAUDE.md produce comportamente diferite pe vendori. Constatare locală: AGENTS.md din rădăcină (6,3 KB) este un șablon de workspace OpenClaw (bootstrap care cere ștergerea BOOTSTRAP.md, automatizări proactive, chaturi de grup, heartbeat), pe când CLAUDE.md conține regulile Hub-ului; Codex încarcă acest AGENTS.md în fiecare thread din repo.
- **Cale de implementare:** 1) Inventar read-only: detectează AGENTS.md, AGENTS.override.md, fallback-uri, CLAUDE.md și CLAUDE.local.md pe drumul rădăcină→cwd și calculează ce încarcă fiecare vendor. 2) Propune (cu aprobare) un AGENTS.md neutru generat din regulile Hub (BUILD_SAFE, fără commit/push/deploy, fără secrete) și un CLAUDE.md cu @AGENTS.md + reguli Claude. 3) Gardă: AGENTS.override.md sau fallback-uri neașteptate blochează rularea Codex până la revizuire. 4) Verifică dimensiunea combinată sub 32 KiB.
- **Test necesar:** Fără modele: fixture de arbore de directoare → lista exactă a fișierelor încărcate de Codex (override > AGENTS.md > fallback, max. 32 KiB) și de Claude (2.1.175 vs. ≥2.1.277); CLAUDE.md exportat începe cu @AGENTS.md; alertă de drift între hash-ul AGENTS.md și sursa canonică.
- **Status:** AVAILABLE
- **Decizie Hub:** REUSE_NATIVE
- **Încredere:** high
- **Note:** Decizia de a înlocui AGENTS.md actual (moștenit din V1/OpenClaw) aparține proprietarului; nu a fost modificat nimic. Actualizarea Claude Code la ≥2.1.277 este o instalare și cere aprobare; importul @path este mai vechi decât suportul nativ, dar efectul pe 2.1.175 trebuie verificat cu /memory.
- **Surse citite:** https://agents.md/ · https://learn.chatgpt.com/docs/agent-configuration/agents-md · https://code.claude.com/docs/en/memory · https://aaif.io/blog/a2a-joins-aaif · local: AGENTS.md și CLAUDE.md din rădăcina repo-ului · local: claude --version (2.1.175) · local: v2/server/http/routes.mjs
- **Verificare adversarială:** CONFIRMED — Confirmat pe agents.md: fără câmpuri obligatorii, fișierul cel mai apropiat de cod are prioritate, administrat de AAIF sub Linux Foundation, peste 60.000 de proiecte. learn.chatgpt.com confirmă ordinea din Codex: AGENTS.override.md, AGENTS.md, apoi fallback; cel mult un fișier per director; limita implicită de 32 KiB. code.claude.com/docs/en/memory confirmă: citire nativă de la v2.1.277, doar dacă nu există CLAUDE.md sau CLAUDE.local.md. Tot acolo: cele 4 valori ale setării Project instructions, pluginConfigs agents-md@builtin și ignorarea AGENTS.local.md, AGENTS.override.md și .agents/. Pe Windows se recomandă importul @AGENTS.md, nu symlink. Constatări locale suplimentare: ~/.codex/AGENTS.md există, dar e gol, deci Codex îl ignoră. Există și un AGENTS.md de 3,6 KB în directorul părinte „Ifrim Digital Proiecte”, deasupra rădăcinii Git. Codex nu îl citește, dar Claude Code ≥2.1.277 l-ar încărca în modul claude-md-and-agents-md. În AGENTS.md din repo, linia 115 permite commit și push fără întrebare, în contradicție directă cu regulile Hub-ului. Codex încarcă acest fișier, ceea ce întărește recomandarea de a-l înlocui după aprobarea proprietarului.

## agents

### Agent2Agent (A2A) Protocol v1.0 (`std-a2a`)

- **Sursă oficială:** https://a2a-protocol.org/latest/
- **Documentație tehnică:** https://a2a-protocol.org/latest/specification/
- **Ce face:** Protocol deschis agent↔agent (MCP rămâne agent↔tool). Descoperire prin Agent Card la /.well-known/agent-card.json (semnabil cu JWS RFC 7515 + JCS RFC 8785; supportedInterfaces[] cu versiune și binding per interfață; card extins autentificat). Operații: SendMessage, SendStreamingMessage, GetTask, ListTasks, CancelTask, SubscribeToTask, CRUD pentru configurări push, GetExtendedAgentCard. Stări de task: SUBMITTED, WORKING, INPUT_REQUIRED, AUTH_REQUIRED, COMPLETED, FAILED, CANCELED, REJECTED. Trei binding-uri echivalente: JSON-RPC 2.0, gRPC, HTTP+JSON. OAuth fără fluxurile implicit/password, cu device code și PKCE; multi-tenancy.
- **Plan necesar:** n/a
- **Platformă:** SDK-uri Python, JavaScript, Java, C#/.NET, Go, Rust; HTTPS obligatoriu.
- **Rollout:** v1.0.0 (12.03.2026), v1.0.1 (28.05.2026); proiect găzduit AAIF din 17.08.2026 (inițial Google, apoi Linux Foundation).
- **Eligibilitate cont:** Claude Code și Codex nu au suport nativ A2A în sursele citite; există doar adaptoare terțe (a2a-adapter, a2acode, a2abridge), neoficiale și neinstalate.
- **Autentificare:** Scheme declarate în Agent Card (API key, OAuth 2.0, OIDC, mTLS).
- **Allowance:** n/a
- **Utilizare partajată:** n/a
- **Inclus în abonament?:** not_applicable
- **Risc de facturare suplimentară (credite/extra usage):** Un endpoint A2A accesibil din afara mașinii ar fi un serviciu nou (hosting/tunel) — neautorizat.
- **Risc de facturare API:** none
- **Integrare programatică:** NONE
- **Detaliu integrare:** Niciun client oficial OpenAI/Anthropic de pe această mașină nu vorbește A2A; integrarea ar cere un gateway propriu al Hub-ului peste SDK-ul A2A (instalare cu aprobare) și expunere de rețea.
- **Suprafață nativă:** Niciuna la cei doi vendori.
- **Cerințe locale:** n/a
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Referință: vocabularul de stări și conceptul de Agent Card pot inspira contractul intern dintre agenții Hub-ului; delegarea Codex↔Claude rămâne în runtime-ul unificat al Hub-ului.
- **Suprafață de execuție:** none
- **Echivalent la celălalt ecosistem:** Anthropic: subagents/agent teams în Claude Code (intern, nu A2A). OpenAI: multi_agent în Codex/Agents API (intern, nu A2A).
- **Ce face unic / mai bine:** Standard neutru pentru interoperabilitate între organizații; Agent Card semnat; stările AUTH_REQUIRED și INPUT_REQUIRED sunt un model util.
- **Securitate:** Endpoint de rețea autentificat, webhook-uri push cu protecție SSRF, încredere în carduri semnate. Tutorialele A2A folosesc termenul „Agent Skills” pentru capabilitățile declarate în Agent Card — concept diferit de SKILL.md, risc de confuzie în modelul de date.
- **Cale de implementare:** Niciuna acum; reevaluare doar dacă un partener extern cere interoperabilitate A2A, cu gateway aprobat explicit și fără ca A2A să devină orchestratorul Hub-ului.
- **Test necesar:** n/a (fără implementare).
- **Status:** DOCUMENTED
- **Decizie Hub:** REFERENCE
- **Încredere:** medium
- **Note:** Datele versiunilor provin din pagina de release-uri GitHub (rezumat automat) și din blogul AAIF (v1.0 în martie 2026). Nu s-a găsit nicio declarație OpenAI sau Anthropic despre suport nativ A2A.
- **Surse citite:** https://a2a-protocol.org/latest/ · https://a2a-protocol.org/latest/whats-new-v1/ · https://a2a-protocol.org/latest/specification/ · https://github.com/a2aproject/A2A/releases · https://aaif.io/blog/a2a-joins-aaif · web search: A2A Agentic AI Foundation August 2026; A2A support Claude Code/Codex
- **Verificare adversarială:** CONFIRMED — Surse care confirmă înregistrarea: specificația 1.0.0 și pagina „What's new in v1”. Pagina v1 confirmă eliminarea fluxurilor implicit și password, device code (RFC 8628), pkce_required, supportedInterfaces cu protocolVersion, câmpul tenant și cardurile semnate JWS+JCS. Release-urile GitHub dau v1.0.0 pe 12.03.2026 și v1.0.1 pe 28.05.2026; blogul AAIF din 17.08.2026 anunță intrarea în fundație. Nuanță: pe fir, stările au forma TASK_STATE_* (de exemplu TASK_STATE_INPUT_REQUIRED). Articolul AAIF nu menționează OpenAI sau Anthropic. Nu am găsit suport nativ A2A în Claude Code sau Codex.

## coding

### Agent Client Protocol (ACP), protocol editor↔agent de cod (`std-acp`)

- **Sursă oficială:** https://agentclientprotocol.com/
- **Documentație tehnică:** https://agentclientprotocol.com/get-started/agents
- **Ce face:** Standardizează comunicarea dintre editoare/IDE și agenți de cod (analog LSP): JSON-RPC peste stdio pentru agenți locali; varianta remote (HTTP/WebSocket) este în lucru. Claude este suportat prin adaptorul Zed claude-agent-acp (bazat pe Claude Agent SDK), Codex CLI prin adaptorul codex-acp al proiectului ACP.
- **Plan necesar:** n/a
- **Platformă:** Editori compatibili ACP (ex. Zed) + adaptoare.
- **Rollout:** Publicat; suport pentru Claude și Codex doar prin adaptoare.
- **Eligibilitate cont:** Adaptoarele nu sunt instalate; instalarea este interzisă fără aprobare.
- **Autentificare:** Moștenită de la agentul adaptat; pentru Claude Agent SDK documentația cere cheie API în produse terțe (login claude.ai permis doar cu aprobarea Anthropic).
- **Allowance:** n/a
- **Utilizare partajată:** n/a
- **Inclus în abonament?:** no
- **Risc de facturare suplimentară (credite/extra usage):** Ruta Claude prin Agent SDK într-un produs terț ar cere cheie API (facturare Console) — interzis de INCLUDED_SUBSCRIPTION_ONLY.
- **Risc de facturare API:** high
- **Integrare programatică:** NONE
- **Detaliu integrare:** Nu există suport ACP nativ oficial în Claude Code sau Codex. V2 are deja adaptoare directe: Codex app-server (JSON-RPC stdio) și claude -p --output-format stream-json.
- **Suprafață nativă:** Editori terți.
- **Cerințe locale:** n/a
- **Relevanță pentru Hub:** LOW
- **Rol propus:** Doar referință pentru modelul de sesiune și cererile de permisiune; nu înlocuiește adaptoarele oficiale existente.
- **Suprafață de execuție:** none
- **Echivalent la celălalt ecosistem:** Anthropic: claude -p stream-json / Agent SDK. OpenAI: Codex app-server.
- **Ce face unic / mai bine:** Interfață unică între editori și mai mulți agenți.
- **Securitate:** Adaptoare terțe care rulează agenți cu acces la fișiere; risc de politică pentru autentificarea cu abonament.
- **Cale de implementare:** Niciuna.
- **Test necesar:** n/a
- **Status:** DOCUMENTED
- **Decizie Hub:** REJECT
- **Încredere:** medium
- **Note:** Pagina principală ACP nu a afișat versiunea sau administratorul; informațiile despre adaptoare provin din lista oficială de agenți.
- **Surse citite:** https://agentclientprotocol.com/ · https://agentclientprotocol.com/get-started/agents · https://code.claude.com/docs/en/agent-sdk/overview
- **Verificare adversarială:** CONFIRMED — agentclientprotocol.com confirmă JSON-RPC peste stdio pentru agenții locali; suportul remote prin HTTP/WebSocket este încă în lucru. Claude este suportat prin claude-agent-acp (Zed), iar Codex prin codex-acp, întreținut de organizația ACP. Nota din Agent SDK overview confirmă că produsele terțe nu pot oferi login claude.ai fără aprobare prealabilă și trebuie să folosească chei API. Pentru ruta Claude, apiBillingRisk high este deci justificat. Nu am verificat cum se autentifică adaptorul codex-acp. Pagina principală ACP nu indică administratorul sau versiunea.

## Întrebări deschise

- Versiunea locală Claude Code 2.1.175 onorează allowed-tools din skill-uri de proiect în rulări claude -p cu --permission-mode dontAsk/acceptEdits și --tools restrâns? Documentația citită descrie versiunea curentă; verificarea cere un turn cu model (interzis în BUILD_SAFE).
- Codex 0.158 onorează sau ignoră allowed-tools și citește și .claude/skills? Documentația build-skills nu menționează nici una, nici alta.
- Ce revizie MCP negociază local Claude Code 2.1.175 și Codex 0.158 cu un server stdio (2025-11-25 sau 2026-07-28)? Documentația Claude spune că stdio rămâne pe v1 implicit; la Codex flag-ul mcp_2026_07_28 este „under development”.
- Cum expune Claude Code headless (-p stream-json) cererile MCP de elicitation către host? Sursele citite nu descriu mecanismul.
- Suportă Claude Code, Codex sau ChatGPT extensia MCP Tasks? Matricea de extensii nu are coloană pentru Tasks.
- Skills over MCP: modelcontextprotocol.io marchează SEP-2640 Final, dar documentația OpenAI îl descrie drept draft cu subset static; care este starea curentă în ChatGPT și există planuri pentru Claude/Codex?
- Ce CODEX_HOME vor folosi turnurile live Codex din V2 (profilul real ~/.codex cu AGENTS.md global și skill-urile din $HOME/.agents/skills sau unul izolat)? Asta decide ce instrucțiuni și skill-uri intră în context.
- Proprietarul dorește înlocuirea AGENTS.md din rădăcină (șablon OpenClaw moștenit din V1, încărcat de Codex în fiecare thread) cu un AGENTS.md neutru generat de Hub și un CLAUDE.md care îl importă?
- Se aprobă actualizarea Claude Code la ≥2.1.277 (suport nativ AGENTS.md, --restricted din 2.1.248) sau se rămâne pe importul @AGENTS.md? Actualizarea este o instalare și cere aprobare.
- Skill-urile activate pe contul claude.ai (13) sunt sincronizate în ~/.claude/skills/synced/ și încărcate în rulările claude -p ale Hub-ului pe versiunea 2.1.175? Dacă da, --disable-slash-commands trebuie folosit implicit.
- Specificația Agent Skills nu are număr de versiune sau changelog vizibil; cum vor fi semnalate schimbările incompatibile (ex. stabilizarea allowed-tools)?
- Se poate pasa un server MCP per thread în Codex app-server (similar cu --mcp-config la Claude) fără a modifica ~/.codex/config.toml?
- Claude Desktop pe Windows verifică semnătura unui .mcpb sau afișează avertisment pentru pachetele nesemnate? Paginile oficiale citite nu descriu acest comportament.
- Versiunea publicată pe npm a @anthropic-ai/mcpb include modificările din martie–aprilie 2026 (validate extins, pack --manifest)? npmjs.com a răspuns 403, iar package.json de pe main indică tot 2.1.2.
- De la ce versiune Claude Code acceptă .mcpb în mcpServers din plugin.json? Documentația nu precizează; CLI-ul npm local este 2.1.175, iar Claude Desktop are local 2.1.281 și 2.1.284.
- Aprobă owner-ul un server MCP local read-only al Hub-ului? De această decizie depind utilitatea MCPB și a extensiei OAuth Client Credentials.
- Ce cheie canonică adoptă Hub-ul pentru aserțiuni: assertions (agentskills.io) sau expectations (schemas.md din skill-creator)? Propunere: assertions canonic, expectations acceptat la import.
- Se adaugă un record Anthropic separat pentru `claude plugin eval` (Claude Code ≥ 2.1.269, format propriu, consum din plan, publicarea implicită a raportului ca artifact privat)?
- Compatibilitatea static_responses din _meta.com.microsoft.windows (bazat pe initialize; exemplul folosește protocolul 2025-06-18) cu nucleul MCP 2026-07-28 (server/discover) nu este documentată.
- Va ajunge MCP on Windows (ODR) pe ramura 26200? Mașina are build 26200.9457, sub cerința 26220.7262, iar odr.exe lipsește.
- OpenAI plănuiește suport .mcpb în Codex sau ChatGPT Desktop? Documentația citită nu îl menționează.

## Surse inaccesibile

- openai.com (HTTP 403 la fetch automat): recapitularea DevDay a fost folosită doar din captura locală sources-openai-devday.md.
- https://aaif.io/ — pagina principală nu a listat proiectele găzduite în conținutul extras; lista a fost luată din articolul aaif.io/blog/a2a-joins-aaif.
- https://agentclientprotocol.com/ — pagina principală nu a afișat versiunea, administratorul sau metodele protocolului.
- https://github.com/modelcontextprotocol/experimental-ext-triggers-events (README) — fără nume de metode; detaliile provin din design-sketch-proposal.md.
- Specificațiile complete din depozitele ext-tasks, ext-skills (specification/stable/skills.mdx) și ext-apps (specification/2026-01-26/apps.mdx) nu au fost citite direct; s-au folosit paginile de prezentare de pe modelcontextprotocol.io.
- https://apps.extensions.modelcontextprotocol.io — documentația API MCP Apps nu a fost citită.
- https://a2a-protocol.org/latest/specification/ — Anexa B (relația cu MCP) nu a fost detaliată în conținutul extras.
- Unele pagini (GitHub releases A2A, README registry, skills-ref) au fost citite prin rezumatul automat al instrumentului de fetch, nu integral; încrederea este redusă corespunzător.
- https://www.npmjs.com/package/@anthropic-ai/mcpb — HTTP 403 la fetch automat (versiunea npm curentă neconfirmată)
- https://support.claude.com/en/articles/12922929-building-desktop-extensions-with-mcpb — HTTP 404 (conținutul pare mutat în claude.com/docs/connectors/building/mcpb)
