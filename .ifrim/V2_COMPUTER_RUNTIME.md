# Computer Runtime (V2, Milestone 01)

Întrebarea: cât din Computer Runtime trebuie construit de Hub dacă Claude și Codex oferă deja computer use și browser prin abonament? Răspuns pentru acest milestone: **Hub-ul deține contractul, registrul și lock-ul; execuția vizuală rămâne nativă și asistată.** Un bridge desktop propriu nu se construiește cât timp computer use nativ acoperă nevoia (comparație în `V2_FRAMEWORK_EVALUATION.md`, secțiunea Agent Zero).

## Ce deține Hub-ul

1. **Registrul mediilor** (`computer_environments`, `v2/config/ecosystem/computer.json`): tip, provider, suprafață proprietară, izolare, mod de control (`structured_api` | `dom` | `visual`), stare (`available` | `assisted` | `blocked` | `planned`), restricții.
2. **Unealta principală per caz de utilizare**: ordinea este mereu connector/API structurat → DOM în browser → control vizual. `GET /api/computer/plan/:useCase` întoarce principalul, fallback-urile și excluderile cu motiv.
3. **Controller unic**: `computer.acquire` ia un lease pe `computer:<mediu>` și, opțional, pe `window:<ref>`; un al doilea sistem pe același mediu sau pe aceeași fereastră primește conflict. Lease-urile sunt aceleași ca pentru workspace (index unic parțial).
4. **Aprobare**: controlul vizual al unui mediu condus de Hub este `computer.visual_control` (ALWAYS_ASK); browserul real cu conturile tale este `browser.native` (ALWAYS_ASK). Dialogul vendorului nu înlocuiește decizia Hub.

5. **Nicio unealtă de control ascunsă în rulările de coding** (implementat după auditul M01): firele Codex pornite de Hub au `computer_use`, `browser_use`, `browser_use_external`, `browser_use_full_cdp_access` și `in_app_browser` dezactivate per proces. Pe binarul 0.159.0 sunt active implicit, iar pluginurile computer-use și chrome sunt instalate local. Rulările Claude `-p` primesc `--no-chrome`. Controlul vizual se face doar printr-un mediu din registru, cu lease și aprobarea Hub.

## Medii (stare la 2026-09-30)

| Mediu | Control | Stare | Rol |
|---|---|---|---|
| `hub.preview_http` | structured_api | available | verificări HTTP locale |
| `hub.playwright` | dom | blocked | unealta structurată principală după aprobarea instalării (browsere ~150 MB+) |
| `hub.desktop_bridge` | visual | planned | nu se construiește acum |
| `anthropic.claude_builtin_browser` | dom | assisted | browser izolat în Claude desktop |
| `anthropic.claude_in_chrome` | dom | assisted (suprafața: needs_setup) | Chrome-ul tău, conturi reale |
| `anthropic.claude_computer_use` | visual | assisted (suprafața: needs_setup, research preview activat de tine) | aplicații desktop |
| `openai.codex_browser` | dom | assisted | pluginul browser din Codex |
| `openai.codex_computer_use` | visual | assisted | pluginul computer-use din Codex |
| `openai.dots_cloud_computer` | visual | planned | eligibilitatea planului neconfirmată |
| `agent_zero.docker` | visual | blocked | referință (modele prin chei API) |

## Cazuri de utilizare

`local-preview-check`, `web-app-e2e-test`, `authenticated-web-task`, `public-web-research`, `desktop-app-task` — cu preferințele din `computer.json`. Routerul atașează planul de computer la decizia de rutare când tipul de task îl cere.

Cod: `v2/server/domain/computer.mjs`, `runtime/leases.mjs`, `policy/approval-policy.mjs`.
