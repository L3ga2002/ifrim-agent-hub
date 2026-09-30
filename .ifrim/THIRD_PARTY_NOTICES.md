# Componente terțe — Ifrim Agent Hub V2

## Dependențe folosite (deja prezente în repo, nimic nou adăugat de V2)

| Pachet | Versiune | Licență | Folosire |
|---|---|---|---|
| react, react-dom | 18.3.1 | MIT | UI V2 |
| vite | 8.1.3 | MIT | build/dev UI V2 |
| @vitejs/plugin-react | 6.0.3 | MIT | build UI |
| lucide-react | 0.468.0 | ISC | iconițe |
| smol-toml | 1.9.0 | BSD-3-Clause | citirea `~/.codex/config.toml` (doar chei relevante pentru facturare) |
| postcss (transitiv) | 8.5.28 (actualizat de la 8.5.16) | MIT | via Vite; fix advisories GHSA-fxqj-rqcc-2cmp, GHSA-r28c-9q8g-f849 |
| nanoid (transitiv) | 3.3.19 (actualizat de la 3.3.15) | MIT | via PostCSS; fix GHSA-28wg-ghj8-5hjv, GHSA-2v37-7h3g-55p8 |

Runtime server: doar module Node 24 încorporate (`node:sqlite`, `node:http`, `node:zlib`, `node:child_process`).

## Clienți externi (neincluși, nemodificați)

- **Codex CLI** (OpenAI), rulat din bundle-ul Codex desktop instalat de utilizator. Schema protocolului a fost generată local cu `codex app-server generate-json-schema` în `.ifrim/tmp` (ignorat, nedistribuit).
- **Claude Code** (Anthropic), binarul npm oficial nemodificat, cu autentificarea utilizatorului prin fluxul Anthropic. Hub-ul nu colectează și nu intermediază tokenuri.

## Referințe JARVIS (S16)

La rebuild (2026-09-29) `jincocodev/openclaw-jarvis-ui` și `open-jarvis/OpenJarvis` nu fuseseră inspectate. În Milestone 01 au fost citite doar ca documentație și cod sursă pe GitHub (vezi mai jos), **fără să fie folosite**. Nu s-a importat cod, font, imagine, sunet, shader sau model vocal. Nucleul procedural, iconița și identitatea vizuală sunt originale.

## Fonturi și voci

Nu se încarcă fonturi externe (Segoe UI / Cascadia sunt fonturi de sistem Windows). Vocile TTS sunt cele ale sistemului/browserului; UI-ul arată pentru fiecare dacă este locală sau online.

## Milestone 01 — framework-uri evaluate (2026-09-30)

Evaluare doar prin documentație și citirea codului sursă pe GitHub; **nimic clonat, instalat, rulat sau copiat**. Nu este necesară nicio notiță de licență, pentru că nu există cod preluat.

| Proiect | Licență constatată | Decizie |
|---|---|---|
| paperclipai/paperclip | MIT | REFERENCE |
| NousResearch/hermes-agent | MIT (componente opționale cu alte licențe, ex. OpenViking AGPL-3.0) | REFERENCE |
| openclaw/openclaw | MIT | RETIRE din runtime-ul V2 (instalarea locală 2026.9.6 rămâne neatinsă) |
| agent0ai/agent-zero | MIT | REFERENCE |
| microsoft/playwright | Apache-2.0 | REUSE — neinstalat; instalarea cere aprobare |
| microsoft/playwright-mcp | Apache-2.0 | INTEGRATE ulterior, condiționat |
| jincocodev/openclaw-jarvis-ui | ISC (proveniență CodePen/MIT neconfirmată; GSAP cu licență Webflow; font fără licență) | REFERENCE doar pentru pattern-uri UX; niciun asset folosit |
| open-jarvis/OpenJarvis | Apache-2.0 | REFERENCE doar pentru arhitectură |

Formatul Agent Skills (`SKILL.md`) este un standard deschis; skill-urile din `v2/skills/` sunt scrise pentru acest proiect.
