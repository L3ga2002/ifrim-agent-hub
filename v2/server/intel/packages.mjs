import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { HubError } from "../core/errors.mjs";
import { newId } from "../core/ids.mjs";
import { hashCanonical } from "../core/canonical.mjs";
import { json, parse } from "../storage/db.mjs";
import { isV2DataEntry } from "../config.mjs";
import { PILOT_ACCEPTANCE_PATH, PILOT_UNIT_PATH, PILOT_MIN_TESTS, pilotMissionInput } from "./pilot-acceptance.mjs";
import { PRESETS, PRESET_IDS, getPreset, resolveFonts } from "../media/visual-bible.mjs";
import { PLATFORM_REGISTRY } from "../media/distribution.mjs";

/**
 * The owner's contextual decision packages (M08 §04–§05, §21; M09 §7), each in ONE view with distinct options the owner approves
 * together or separately. Nothing hides under one "yes": every option shows exactly what it changes, how it is executed and how it is
 * undone. The state of an option (approved, executed) is DERIVED from the real system — a relocated data root is executed when the
 * Hub runs from it; the voice ACL is executed when the access list shows it — never from a click alone.
 *
 * A — data protection: the Hub's data under a OneDrive-synced folder, and the voice profile readable through inherited access.
 *     Moving the data does not delete copies already synced (a separate decision, never automatic).
 * B — the real pilot: one small, reversible piece of work on ProDelivery, with project, snapshot, files, environment, models,
 *     limits, outputs and rollback. B can be decided only after A (storage and voice protection come first).
 * MEDIA_A — the Studio's environment: ffmpeg/ffprobe present and pinned (read from the tools' verification), OBS WebSocket enabled
 *     by the owner in OBS (not verifiable without connecting: never "executed"), the presets' fonts present (read from the disk).
 * MEDIA_B — live capture of the owner's screen / the live Hub in Public Demo Mode (approval turns mediaPolicy.liveCapture on; every
 *     capture session still needs its own scope approval; `media.policy.capture_off` is the fail-safe rollback from any channel) and
 *     a limited AI production budget (a decision only: nothing starts).
 * MEDIA_C — per platform: connecting an account / allowing uploads. External, a decision only: a click never connects, uploads or
 *     counts as executed; every upload still needs its own confirmation of the exact manifest.
 * A does not authorize B and B does not authorize C: each waits for the previous one to be decided (and its approved options executed).
 */
export const PACKAGE_KINDS = Object.freeze(["A", "B", "MEDIA_A", "MEDIA_B", "MEDIA_C"]);
export const PACKAGE_TITLES = Object.freeze({
  A: "Protecția datelor și a profilului vocal", B: "Pilotul real pe ProDelivery", MEDIA_A: "Studio: instalări și mediu",
  MEDIA_B: "Studio: captură live și producție AI limitată", MEDIA_C: "Studio: conturi și încărcare pe platforme",
});
/** Which package each kind waits for (decided, with its approved options executed). */
export const PACKAGE_PREREQUISITE = Object.freeze({ B: "A", MEDIA_B: "MEDIA_A", MEDIA_C: "MEDIA_B" });
const DECISIONS = new Set(["approve", "reject", "defer"]);

/**
 * MB2: the limited AI production budget the owner decides on. Recorded with the decision; nothing starts from it — every run still
 * goes through a confirmed plan, the gate and a grant, with exactly this model.
 */
export const MEDIA_AI_BUDGET = Object.freeze({
  maxRuns: 4, roles: Object.freeze(["creative-director", "scriptwriter"]),
  model: Object.freeze({ provider: "claude", model: "sonnet", effort: "medium" }), fallback: false,
});
export const mediaBudgetText = (b = MEDIA_AI_BUDGET) => `max ${b.maxRuns} rulări, ${packageModelText(b.model)}, ${b.fallback ? "cu fallback" : "fără fallback"}`;
/** MEDIA_C: one option per platform, in a fixed order (keys never depend on the registry's iteration order). */
const MEDIA_C_PLATFORMS = Object.freeze([["MC1", "instagram"], ["MC2", "tiktok"], ["MC3", "youtube"], ["MC4", "x"], ["MC5", "linkedin"]]);

/**
 * M09: the pilot's models, structured. B4 prepares the mission with exactly these (limits.{writer,reviewer}{Model,Effort}); the
 * package text is derived from them and B4 counts as executed only when the mission carries them (M08 promised them in text only).
 */
export const PILOT_MODELS = Object.freeze({
  writer: Object.freeze({ provider: "codex", model: "gpt-6.1-sol", effort: "medium" }),
  reviewer: Object.freeze({ provider: "claude", model: "sonnet", effort: "medium" }),
});
const PROVIDER_LABEL = { codex: "Codex", claude: "Claude" };
/** „Codex gpt-6.1-sol · medium (abonament)” — from a structured model entry (an older package stored the text itself). */
export const packageModelText = (m) => (typeof m === "string" ? m : m ? `${PROVIDER_LABEL[m.provider] || m.provider} ${m.model} · ${m.effort} (abonament)` : "—");
/** The mission limits that carry the package's models. */
export const pilotModelLimits = (models = PILOT_MODELS) => ({ writerModel: models.writer.model, writerEffort: models.writer.effort, reviewerModel: models.reviewer.model, reviewerEffort: models.reviewer.effort });

/** Bounded recursive size (files, bytes) of a folder; metadata only. */
export function folderStats(dir, { maxFiles = 200000, topFilter = null } = {}) {
  let files = 0; let bytes = 0; let truncated = false;
  const walk = (d) => {
    let list = [];
    try { list = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of list) {
      if (files >= maxFiles) { truncated = true; return; }
      if (topFilter && d === dir && !topFilter(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) { files += 1; try { bytes += fs.statSync(p).size; } catch { /* gone */ } }
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return { exists: fs.existsSync(dir), files, bytes, truncated };
}

/** Whether a path lives under a folder OneDrive syncs (the user's OneDrive roots, or a path segment named OneDrive). */
export function isOneDrivePath(p, env = process.env) {
  const norm = path.resolve(String(p || "")).toLowerCase();
  const roots = [env.OneDrive, env.OneDriveConsumer, env.OneDriveCommercial].filter(Boolean).map((r) => path.resolve(r).toLowerCase());
  return roots.some((r) => norm === r || norm.startsWith(`${r}${path.sep}`)) || /[\\/]onedrive([\\/]|$)/i.test(norm);
}

/**
 * The access list of a folder, read with icacls (metadata only, never the content). Returns the entries and two findings: inherited
 * entries, and entries for groups wider than the user (CodexSandboxUsers, Users, Everyone, Authenticated Users).
 */
export function readAcl(dir) {
  if (process.platform !== "win32") return { available: false, reason: "doar pe Windows", entries: [] };
  if (!fs.existsSync(dir)) return { available: false, reason: "folderul nu există", entries: [] };
  let out = "";
  try { out = execFileSync("icacls", [dir], { encoding: "utf8", windowsHide: true, timeout: 15000 }); } catch (error) { return { available: false, reason: `icacls: ${String(error.message).slice(0, 120)}`, entries: [] }; }
  const lines = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).filter((l) => !/^Successfully processed|^S-a procesat/i.test(l));
  const entries = lines.map((l, i) => (i === 0 ? l.slice(dir.length).trim() : l)).filter((l) => /:\(/.test(l)).map((l) => ({ raw: l, principal: l.split(":(")[0].trim(), inherited: /\(I\)/.test(l) }));
  const wide = entries.filter((e) => /codexsandboxusers|\\users$|^users$|everyone|authenticated users|toți|utilizatori/i.test(e.principal));
  return { available: true, entries, inherited: entries.filter((e) => e.inherited).length, wide: wide.map((e) => e.raw), restricted: wide.length === 0 && entries.every((e) => !e.inherited) };
}

export function createPackages({ db, bus, clock, config, settings, projects, environments, voiceProfilesDir = null, media: mediaService = null }) {
  const iso = (d = clock()) => d.toISOString();
  // The Studio's services (tools verification) are created after the packages; the command layer attaches them (MEDIA_A reads
  // the last verification of ffmpeg/ffprobe from them; without them only the stored pins are known and MA1 stays unexecuted).
  let media = mediaService;
  const attachMedia = (m) => { media = m || null; };
  // Where MA3 looks for the presets' font files: the Windows fonts folder (the same default as the Studio's presets); tests point it
  // at a fixture folder. Only file names are checked, never a font's content.
  let fontsDir = "C:/Windows/Fonts";
  const useFontsDir = (dir) => { fontsDir = dir ? String(dir) : "C:/Windows/Fonts"; };
  const rowTo = (r) => r && ({ id: r.id, kind: r.kind, title: r.title, body: parse(r.body_json, {}), options: parse(r.options_json, []), hash: r.hash, status: r.status, decisions: parse(r.decisions_json, {}),
    decidedBy: r.decided_by, createdAt: r.created_at, decidedAt: r.decided_at, version: r.version });

  function inventoryA() {
    const dataLoc = config.dataLocation || { source: "default" };
    const profilesDir = voiceProfilesDir || null;
    const parts = [
      // Only V2's entries: .ifrim/private also holds V1 and OpenClaw files, which stay where they are (and are not counted).
      { name: "Baza activă și atașamentele (doar V2)", path: config.dataDir, ...folderStats(config.dataDir, { topFilter: isV2DataEntry }) },
      { name: "Backupuri V2", path: config.backupDir, ...folderStats(config.backupDir) },
      { name: "Artefacte de lucru (copii, exporturi, pachete)", path: config.workDir, ...folderStats(config.workDir) },
    ].map((p) => ({ ...p, synced: isOneDrivePath(p.path) }));
    return {
      dataLocation: dataLoc, parts, anySynced: parts.some((p) => p.synced),
      voice: profilesDir ? { profilesDir, synced: isOneDrivePath(profilesDir), acl: readAcl(profilesDir) } : { profilesDir: null, acl: { available: false, reason: "motorul vocal nu e configurat", entries: [] } },
      codeInRepo: config.hubRoot, note: "Codul proiectului rămâne unde e; se mută doar datele (bază, backupuri, artefacte). Profilul vocal e deja în afara OneDrive.",
    };
  }

  function optionsA(inv) {
    const target = path.join(os.homedir(), "IfrimHub", "hub-data");
    return [
      { key: "A1", title: `Mută datele Hub-ului în ${target} (în afara OneDrive)`,
        changes: ["baza activă, atașamentele, backupurile și artefactele de lucru se copiază acolo, verificat (integritate SQLite, număr de rânduri, sha)", "pointerul .ifrim/data-location.json indică noua locație", "folderul vechi primește V2_MOVED.json: un Hub V2 care l-ar deschide refuză să pornească (niciodată două baze active)", "căile salvate în copie (atașamente, backupuri, pachete) sunt rescrise spre noua locație; ținta primește acces doar pentru contul tău și SYSTEM", "fișierele V1 și OpenClaw din .ifrim/private NU se mută"],
        execution: [`Oprește Hub-ul (Stop în UI sau node v2/scripts/stop.mjs)`, `node v2/scripts/relocate-data.mjs --plan`, `node v2/scripts/relocate-data.mjs --dry-run --to "${target}"`, `node v2/scripts/relocate-data.mjs --apply --to "${target}"`, "pornește Hub-ul; verifică integritatea în Sistem"],
        rollback: ["oprește Hub-ul", "node v2/scripts/relocate-data.mjs --rollback (pointerul devine o arhivă, marcajul trece pe copia nouă; dacă baza nouă s-a schimbat, alegi --copy-back sau --discard-new)", "pornește Hub-ul"],
        limits: ["copiile deja sincronizate în OneDrive NU se șterg prin mutare (vezi A3)", "o bază e activă într-un singur loc", "lista de negare Codex include noile căi: Hub-ul îți cere din nou consimțământul de izolare (R3) înainte de o rulare Codex pe Windows"],
        executed: (config.dataLocation?.source === "pointer"), applicable: inv.anySynced || config.dataLocation?.source === "pointer" },
      { key: "A2", title: "Restrânge accesul la profilul vocal la contul tău și SYSTEM",
        changes: ["folderul profiles nu mai moștenește drepturile din IfrimHub (de ex. citirea pentru CodexSandboxUsers)", "rămân doar contul tău (control total) și SYSTEM"],
        execution: [`powershell -ExecutionPolicy Bypass -File v2/scripts/voice-acl.ps1 -Plan`, `powershell -ExecutionPolicy Bypass -File v2/scripts/voice-acl.ps1 -Apply   (salvează întâi ACL-ul curent; refuză un folder cu intrări explicite)`, `powershell -ExecutionPolicy Bypass -File v2/scripts/voice-acl.ps1 -Verify  (listare ca tine: permisă; grupuri largi și moștenire: absente)`],
        rollback: ["powershell -ExecutionPolicy Bypass -File v2/scripts/voice-acl.ps1 -Rollback (folderul revine la moștenire = starea dinainte)"],
        limits: ["nu atinge ~/.codex și nu adaugă reguli DENY globale (care ar rupe vocea sau Codex)"],
        executed: Boolean(inv.voice.acl?.restricted), applicable: Boolean(inv.voice.profilesDir) },
      { key: "A3", title: "Copiile istorice din OneDrive (cloud): doar le recunoști, nu le șterg",
        changes: ["nimic nu se șterge automat; păstrarea sau ștergerea lor în OneDrive (Coș, istoric versiuni) e decizia ta separată"],
        execution: ["fără execuție în Hub"], rollback: ["—"], limits: ["mutarea locală nu șterge ce s-a sincronizat deja"], executed: null, applicable: true },
    ];
  }

  function inventoryB() {
    const p = projects.get("prodelivery");
    if (!p) return { available: false, reason: "ProDelivery nu e înregistrat în Hub" };
    let head = null;
    try { head = fs.existsSync(path.join(p.path, ".git", "HEAD")) ? fs.readFileSync(path.join(p.path, ".git", "HEAD"), "utf8").trim() : null; } catch { head = null; }
    const att = environments?.get?.("wsl-runner")?.attestationStatus?.(clock()) || null;
    const route = environments?.routeFor ? environments.routeFor(p.id, "codex") : "windows";
    return {
      available: true, projectId: p.id, name: p.name, path: p.path, stack: p.stack, headRef: head, route,
      environment: { id: "wsl-runner", attested: Boolean(att?.valid), fingerprint: att?.latest?.fingerprintHash || null, attestationId: att?.latest?.id || null },
      task: {
        title: "Teste unitare pentru clasamentul curierilor (driver_ranking) și remedierea problemelor găsite",
        why: "Modul pur (doar datetime și zoneinfo), testabil fără MongoDB, FastAPI sau rețea; reversibil; fără date reale.",
        inScope: ["backend/utils/driver_ranking.py", `${PILOT_UNIT_PATH} (nou, scris de Codex)`],
        outOfScope: ["routere, modele, baza de date, frontend", "dependențe noi", "deploy, commit, push, mesaje", "credențiale sau date de producție"],
        acceptanceTest: { path: PILOT_ACCEPTANCE_PATH, written: Boolean(p.path && fs.existsSync(path.join(p.path, PILOT_ACCEPTANCE_PATH))),
          what: `testul independent (scris de Hub la aprobarea B4, protejat): suita unitară există, trece doar cu biblioteca standard, are cel puțin ${PILOT_MIN_TESTS} teste și apelează fiecare funcție publică` },
        acceptance: [
          `AC-1 (test independent): suita ${PILOT_UNIT_PATH} există, trece, are ≥ ${PILOT_MIN_TESTS} teste și apelează fiecare funcție publică`,
          "AC-2 (review): pragurile TIER_CONFIG la limite (inclusiv egalitate), fereastra de ciclu în jurul CLOSE_HOUR și la schimbarea orei de vară/iarnă, lipsa datelor și anulările",
          "AC-3 (review): orice remediere din driver_ranking.py e minimă, explicată și fără schimbare de contract public",
        ],
        verification: `verificări: python3 -m unittest ${PILOT_UNIT_PATH} · acceptanță: python3 -m unittest ${PILOT_ACCEPTANCE_PATH}`,
      },
      dataExposure: { copiedIntoEnvironment: "fișierele urmărite de git + cele neurmărite neignorate (fără .ifrim, .claude, .env*, node_modules)", toProviders: "Codex (OpenAI) citește ce are nevoie din copie; Claude (Anthropic) citește change set-ul și contextul, doar citire", excluded: [".ifrim/", ".claude/", ".env*", "fișiere de tip secret", "node_modules/ și artefacte de build"] },
      // M09: structured (the mission is prepared with exactly these; every text below is derived from them).
      models: PILOT_MODELS,
      limits: { maxDurationMin: 45, maxAttemptsPerStage: 2, maxRepairCycles: 1 },
      outputs: ["pachet de livrare (diff + dovezi), gata de verificarea ta; nimic nu se acceptă sau se publică singur"],
      rollback: ["pachetul se respinge; schimbările se pot reveni din diff (git checkout pe driver_ranking.py, ștergerea celor 2 fișiere de test noi)"],
      prerequisites: [
        "comanda de verificare python3 -m unittest e permisă doar cu opțiunea B3 (implicit refuzată)",
        "python3 3.12 cu baza de fusuri orare (Europe/Bucharest) există în ifrim-runner; pytest nu e necesar",
        "rulează doar pe ruta izolată wsl-runner (B1); pe Windows comanda e refuzată",
      ],
    };
  }

  /** B4 executed = the pilot mission exists on ProDelivery (any stage) and its acceptance test is in the project. */
  function pilotPrepared(inv) {
    if (!inv?.available) return false;
    const row = db.prepare("SELECT m.id FROM missions m JOIN factory_missions fm ON fm.mission_id = m.id WHERE m.project_id = ? AND m.title = ? LIMIT 1").get(inv.projectId, inv.task.title);
    if (!row || !inv.task.acceptanceTest?.written) return false;
    // Prepared = a mission whose spec is complete and carries both python commands (the draft could otherwise never run).
    const spec = db.prepare("SELECT spec_json, protected_json FROM factory_specs WHERE mission_id = ? ORDER BY version DESC LIMIT 1").get(row.id);
    const s = parse(spec?.spec_json, {});
    const problems = parse(spec?.protected_json, {}).problems || [];
    const cmds = [...(s.verification?.checks || []), ...(s.verification?.acceptance || [])].join(" ");
    // M09: and the mission carries exactly the models the package promises (otherwise B4 stays APPROVED_PENDING_EXECUTION).
    const limits = parse(db.prepare("SELECT limits_json FROM factory_missions WHERE mission_id = ?").get(row.id)?.limits_json, {}) || {};
    const want = pilotModelLimits(inv.models);
    const modelsMatch = Object.entries(want).every(([k, v]) => String(limits[k] || "").toLowerCase() === String(v).toLowerCase());
    return problems.length === 0 && /python3 -m unittest/.test(cmds) && cmds.includes(PILOT_ACCEPTANCE_PATH) && modelsMatch;
  }

  function optionsB(inv) {
    if (!inv.available) return [];
    return [
      { key: "B1", title: `Pune ${inv.name} pe ruta izolată wsl-runner`, changes: ["writer-ul, verificările, review-ul, QA rulează în ifrim-runner pe o copie (politica (b) e deja aprobată pe amprenta curentă)"], execution: ["se aplică la aprobare, prin comanda obișnuită project.environment.set"], rollback: ["ruta înapoi pe implicit (Proiecte → Mediu)"], executed: inv.route === "wsl-runner", applicable: true },
      { key: "B2", title: "Autonomie ASSISTED pe ProDelivery pentru pilot", changes: ["planul se confirmă de tine; fiecare remediere îți cere confirmarea diferenței"], execution: ["se aplică la aprobare (sesiune proaspătă)"], rollback: ["autonomia înapoi pe OBSERVE"], executed: null, applicable: true },
      { key: "B3", title: "Permite comanda de verificare „python3 -m unittest <fișiere .py>”", changes: ["fabrica acceptă și această comandă exactă (fără shell, fără rețea, căi relative fără ..)"], execution: ["se activează la aprobare (setare factoryExtraCommands)"], rollback: ["dezactivezi opțiunea; comanda e refuzată din nou"], executed: (settings.get("factoryExtraCommands") || []).includes("python-unittest"), applicable: true },
      { key: "B4", title: `Lucrarea: ${inv.task.title}`, changes: [`scope: ${inv.task.inScope.join(", ")}`, `Hub-ul adaugă în proiect un singur fișier: testul de acceptanță independent ${PILOT_ACCEPTANCE_PATH} (protejat în misiune)`, `limite: ${inv.limits.maxDurationMin} min, ${inv.limits.maxAttemptsPerStage} încercări pe etapă, ${inv.limits.maxRepairCycles} remediere`, `modele: ${packageModelText(inv.models.writer)}; ${packageModelText(inv.models.reviewer)}`],
        execution: ["la aprobare: Hub-ul scrie testul de acceptanță și pregătește misiunea ca ciornă (SPEC_DRAFT) pe ruta izolată", "pornește doar după planul confirmat de tine în cockpit („Hai să lucrăm la ProDelivery” → „Arată-mi planul”)"],
        rollback: ["ciorna se anulează din Misiuni; testul de acceptanță se șterge (un singur fișier nou)"], executed: pilotPrepared(inv) ? true : false, applicable: true },
    ];
  }

  // ---------------------------------------------------------------- MEDIA_A: the Studio's environment
  /**
   * ffmpeg/ffprobe: the pins (version + sha256, written by the tools' first verified use) and the last verification since boot;
   * fonts: every preset's font files looked up on disk now. Paths and hashes only — never a file's content.
   */
  function inventoryMediaA() {
    const pins = settings.get("mediaToolPins") || {};
    let last = null;
    try { last = media?.tools?.lastResolved?.() || null; } catch { last = null; }
    const tools = ["ffmpeg", "ffprobe"].map((name) => {
      const pin = pins[name] || null;
      const seen = last?.[name] || null;
      // M10.2 (#27): a change seen only by the last inspection counts too, and the card names the one place that acknowledges it.
      const changed = Boolean(pin?.changedAt && !pin?.acknowledged) || last?.states?.[name] === "CHANGED";
      return { name, pinned: Boolean(pin?.sha256), version: pin?.version || seen?.version || null, sha256: String(pin?.sha256 || seen?.sha256 || "").slice(0, 16) || null,
        path: seen?.path || pin?.path || null, changed, verifiedSinceBoot: Boolean(seen?.sha256 && pin?.sha256 && seen.sha256 === pin.sha256),
        ...(changed ? { action: { label: "Confirmă schimbarea (Studio → Unelte)", where: "#/studio?panel=tools" } } : {}) };
    });
    const fonts = PRESET_IDS.map((id) => {
      let preset = null;
      try { preset = getPreset(db, id) || PRESETS[id]; } catch { preset = PRESETS[id]; }
      let r = null;
      try { r = resolveFonts(preset, { fontsDir }); } catch (error) { r = { ok: false, missing: [{ role: "?", family: String(error.message).slice(0, 80), file: "?" }], substitutions: [] }; }
      return { id, version: preset?.version ?? null, ok: Boolean(r.ok), missing: r.missing.map((m) => `${m.family} (${m.file})`), substitutions: r.substitutions.length };
    });
    return {
      tools, toolsChecked: Boolean(last), toolProblems: last?.problems || [], toolsOk: tools.every((t) => t.pinned && t.verifiedSinceBoot && !t.changed),
      obs: { url: "ws://127.0.0.1:4455", verifiable: false, note: "Hub-ul nu se conectează la OBS ca să verifice; o conexiune are loc doar într-o captură aprobată (MEDIA_B)." },
      fonts, fontsDir, fontsOk: fonts.every((f) => f.ok),
      note: "Instalările le faci tu; Hub-ul nu instalează și nu descarcă nimic. „Executat” se citește din verificarea uneltelor și de pe disc, nu dintr-un click.",
    };
  }

  function optionsMediaA(inv) {
    return [
      { key: "MA1", title: "ffmpeg și ffprobe prezente și fixate (versiune + sha256)",
        changes: ["randările locale folosesc doar binarele verificate; un binar schimbat e raportat (tool_changed) până îl confirmi", "Hub-ul fixează versiunea și sha256 doar printr-o acțiune explicită: decizia acestui pachet, butonul „Fixează” sau un pas listat într-un plan confirmat (o citire nu fixează nimic)"],
        execution: ["instalarea o faci tu (pe acest PC ffmpeg e deja instalat)", "Studio → Unelte: Hub-ul citește versiunea și sha256 (doar citire); le fixează la decizia ta (acest pachet, „Fixează” sau un pas de plan)"],
        rollback: ["înlocuiești sau dezinstalezi binarul; schimbarea e raportată, nu adoptată în tăcere"],
        limits: ["fără rețea în timpul randării", "Hub-ul nu instalează și nu descarcă nimic"], executed: Boolean(inv.toolsOk), applicable: true, external: false },
      { key: "MA2", title: "Serverul OBS WebSocket activat de tine în OBS (local, cu parolă)",
        changes: ["OBS ascultă pe ws://127.0.0.1:4455 cu parolă; Hub-ul nu păstrează și nu înregistrează parola"],
        execution: ["în OBS: Instrumente → Setări server WebSocket → Activează serverul, portul 4455, autentificare cu parolă", "nu deschide portul în rețea"],
        rollback: ["dezactivezi serverul WebSocket din OBS"],
        limits: ["nu se poate verifica fără o conexiune: rămâne „aprobată”, niciodată „executată” dintr-un click", "o înregistrare OBS pornește doar cu MB1 aprobat și scopul sesiunii aprobat"],
        executed: null, applicable: true, external: false },
      { key: "MA3", title: "Fonturile presetelor Studio prezente pe acest PC",
        changes: ["presetele folosesc fonturile din folderul de fonturi Windows (fonturile de sistem doar în imagini randate; Cascadia Code e SIL OFL)"],
        execution: ["Hub-ul caută fișierele de font la fiecare inventar", "un font lipsă îl instalezi tu (Windows sau Microsoft Store)"],
        rollback: ["—; un font lipsă oprește doar presetul care îl folosește"], limits: ["Hub-ul nu instalează fonturi"],
        executed: Boolean(inv.fontsOk), applicable: true, external: false },
    ];
  }

  // ---------------------------------------------------------------- MEDIA_B: live capture scope + a limited AI budget
  function inventoryMediaB() {
    const policy = settings.get("mediaPolicy") || {};
    return {
      liveCapture: policy.liveCapture === true, liveCaptureDecision: policy.liveCaptureDecision || null, budget: MEDIA_AI_BUDGET, budgetText: mediaBudgetText(),
      note: "Aprobarea lui MB1 pornește doar politica; fiecare sesiune de captură își cere aprobarea propriului scop. MB2 înregistrează un buget: nu pornește nicio rulare.",
    };
  }

  function optionsMediaB() {
    const policy = settings.get("mediaPolicy") || {};
    return [
      { key: "MB1", title: "Captură live a ecranului tău și a Hub-ului live, în Public Demo Mode",
        changes: ["politica mediaPolicy.liveCapture devine activă la aprobare (din sesiunea ta proaspătă)", "fiecare sesiune de captură cere în continuare aprobarea propriului scop (ce, unde, cât)", "Public Demo Mode: zone redactate, eticheta capturii vizibilă"],
        execution: ["se aplică la aprobare: mediaPolicy.liveCapture = activă"],
        rollback: ["„Oprește captura” (media.policy.capture_off): fail-safe, din orice canal al tău (interfață, voce, telefon); o demonstrație filmată în browser se oprește"],
        limits: ["fără încărcare și fără publicare (acelea sunt MEDIA_C)", "parola OBS nu se păstrează"], executed: policy.liveCapture === true, applicable: true, external: false },
      { key: "MB2", title: "Producție AI limitată: o decizie de buget, nu pornește nimic",
        changes: [`buget: ${mediaBudgetText()}`, `roluri: ${MEDIA_AI_BUDGET.roles.join(", ")} (doar citire)`],
        execution: ["la aprobare se înregistrează doar decizia și bugetul", "fiecare rulare trece prin planul confirmat de tine, poartă și grant, cu exact acest model"],
        rollback: ["Resping sau Amân la o nouă prezentare; bugetul nu mai e valabil"],
        limits: ["nicio rulare nu pornește din această decizie", "fără model implicit și fără fallback pe alt model"], executed: null, applicable: true, external: false },
    ];
  }

  // ---------------------------------------------------------------- MEDIA_C: accounts and uploads (external, decision only)
  function inventoryMediaC() {
    const policy = settings.get("mediaPolicy") || {};
    return {
      liveUpload: policy.liveUpload === true, autoPublish: policy.autoPublish === true, registryVersion: PLATFORM_REGISTRY.registryVersion, source: PLATFORM_REGISTRY.source,
      platforms: MEDIA_C_PLATFORMS.map(([key, id]) => { const p = PLATFORM_REGISTRY.platforms[id]; return { key, id, label: p.label, apiUpload: p.operations.api_upload?.status || null, apiNote: p.operations.api_upload?.note || "" }; }),
      note: "O decizie aici nu conectează niciun cont și nu încarcă nimic. Fiecare încărcare cere confirmarea ei separată, pe manifestul exact (Windows Hello).",
    };
  }

  function optionsMediaC() {
    return MEDIA_C_PLATFORMS.map(([key, id]) => {
      const p = PLATFORM_REGISTRY.platforms[id];
      const api = p.operations.api_upload || {};
      const limits = ["nu se aplică dintr-un click și nu contează niciodată ca executată", "fiecare încărcare cere confirmarea ei separată (manifestul exact, Windows Hello)"];
      if (api.status === "COST_BLOCKED") limits.push("API-ul X e COST_BLOCKED (cere plan plătit; fără buget aprobat): rămâne postarea manuală din pachet");
      else if (api.status === "POLICY_UNSUPPORTED") limits.push("Direct Post e POLICY_UNSUPPORTED până la auditul aplicației: rămâne încărcarea manuală");
      return { key, title: `${p.label}: permiți conectarea contului și încărcarea`,
        changes: ["decizie de principiu: contul poate fi conectat ulterior, într-un pas separat al tău", `stare API încărcare: ${api.status || "necunoscută"} — ${api.note || ""}`.trim()],
        execution: ["nimic la aprobare: Hub-ul nu conectează contul și nu încarcă", "până atunci: pachet manual (video, text, copertă, checklist)"],
        rollback: ["Resping la o nouă prezentare; un cont conectat se deconectează din setările platformei"],
        limits, executed: null, applicable: true, external: true };
    });
  }

  /** The kind registry: inventory, options, and whether the body is re-read live (cheap) or kept as presented (A's folder sizes). */
  const KINDS = {
    A: { inventory: inventoryA, options: optionsA, liveBody: false },
    B: { inventory: inventoryB, options: optionsB, liveBody: false },
    MEDIA_A: { inventory: inventoryMediaA, options: optionsMediaA, liveBody: true },
    MEDIA_B: { inventory: inventoryMediaB, options: optionsMediaB, liveBody: true },
    MEDIA_C: { inventory: inventoryMediaC, options: optionsMediaC, liveBody: true },
  };
  const kindOf = (kind) => { const k = KINDS[kind]; if (!k) throw new HubError("validation", "Pachet necunoscut"); return k; };

  /** Builds (or returns the current) package of a kind from the real state. */
  function present(kind, { actor = "hub" } = {}) {
    if (!PACKAGE_KINDS.includes(kind)) throw new HubError("validation", "Pachet necunoscut");
    const k = kindOf(kind);
    const body = k.inventory();
    const options = k.options(body);
    const hash = hashCanonical({ kind, options: options.map(({ executed, ...o }) => o) }).slice(0, 24);
    const current = db.prepare("SELECT * FROM decision_packages WHERE kind = ? AND status = 'PRESENTED' ORDER BY created_at DESC LIMIT 1").get(kind);
    if (current && current.hash === hash) return view(current.id);
    const id = newId("pkg");
    bus.transaction(() => {
      if (current) db.prepare("UPDATE decision_packages SET status = 'SUPERSEDED' WHERE id = ?").run(current.id);
      db.prepare("INSERT INTO decision_packages (id, kind, title, body_json, options_json, hash, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'PRESENTED', ?)")
        .run(id, kind, PACKAGE_TITLES[kind], json(body), json(options.map(({ executed, ...o }) => o)), hash, iso());
      bus.append({ type: "package.presented", scopeType: "package", scopeId: id, source: actor, payload: { kind } });
    });
    return view(id);
  }

  /** The package with each option's decision and its EXECUTION state recomputed from the system now. */
  function view(id, { withBlockers = true } = {}) {
    const p = rowTo(db.prepare("SELECT * FROM decision_packages WHERE id = ?").get(id));
    if (!p) throw new HubError("not_found", "Pachet necunoscut");
    const k = KINDS[p.kind];
    const liveBody = k ? k.inventory() : null;
    const live = k ? k.options(liveBody) : [];
    const options = p.options.map((o) => {
      const now = live.find((x) => x.key === o.key);
      const d = p.decisions[o.key] || null;
      // An external option is a decision only: it never reads as executed, whatever the system says.
      const executed = o.external ? null : now ? now.executed : null;
      return { ...o, decision: d?.decision || null, decidedAt: d?.at || null, executed,
        state: !d ? "UNDECIDED" : d.decision === "approve" ? (executed === true ? "EXECUTED" : executed === null ? "APPROVED" : "APPROVED_PENDING_EXECUTION") : d.decision === "reject" ? "REJECTED" : "DEFERRED" };
    });
    const blockedBy = withBlockers ? blockersFor(p.kind) : [];
    return { ...p, body: k?.liveBody ? liveBody : p.body, options, blockedBy, prerequisite: PACKAGE_PREREQUISITE[p.kind] || null };
  }

  /**
   * A kind waits for its prerequisite: presented, every option decided (not deferred), and every approved option executed (an
   * option whose execution cannot be read — executed null — counts as done once approved). B keeps M08's rule (A1 and A2 only).
   */
  function blockersFor(kind) {
    const pre = PACKAGE_PREREQUISITE[kind];
    if (!pre) return [];
    const row = db.prepare("SELECT id FROM decision_packages WHERE kind = ? AND status IN ('PRESENTED','DECIDED') ORDER BY created_at DESC LIMIT 1").get(pre);
    if (!row) return [`Pachetul ${pre} (${PACKAGE_TITLES[pre]}) nu a fost prezentat`];
    const v = view(row.id, { withBlockers: false });
    const relevant = kind === "B" ? v.options.filter((x) => ["A1", "A2"].includes(x.key)) : v.options;
    // MEDIA_C waits for MEDIA_B to be DECIDED only: switching live capture off (the fail-safe) must not turn into a reason to
    // re-decide accounts; and nothing in C depends on capture running.
    const needExecuted = kind !== "MEDIA_C";
    const out = [];
    for (const o of relevant) {
      if (o.state === "UNDECIDED" || o.state === "DEFERRED") out.push(`${o.key} nu e decisă`);
      else if (needExecuted && o.state === "APPROVED_PENDING_EXECUTION") out.push(`${o.key} e aprobată, dar nu e executată încă`);
    }
    return out;
  }
  const blockersForB = () => blockersFor("B");

  /**
   * The owner's decision, option by option, in a fresh session. B1/B3 are applied here through the ordinary mechanisms (the owner's
   * own decision in this view); A1/A2 are executed by their scripts (they act outside the project and need the Hub stopped). MB1 turns
   * the live-capture policy on (its rollback is the fail-safe capture_off); MB2 records a budget; MEDIA_C options are external and
   * are never applied. Every decision records how it was taken (owner session, credential prefix, click).
   */
  async function decide(id, { decisions = {}, ownerSession, trust, actor, apply = {} }) {
    if (!ownerSession) throw new HubError("authentication", "Decizia se ia în sesiunea ta de proprietar");
    const fresh = trust.requireFresh(ownerSession, "un pachet de decizie");
    const p = view(id);
    if (p.status !== "PRESENTED") throw new HubError("conflict", "Pachetul nu mai e cel prezentat; deschide-l din nou");
    if (p.blockedBy.length) {
      if (p.kind === "B") throw new HubError("conflict", `Pilotul se decide după protecția datelor: ${p.blockedBy.join("; ")}`);
      throw new HubError("conflict", `${PACKAGE_TITLES[p.kind]} se decide după pachetul ${p.prerequisite}: ${p.blockedBy.join("; ")}`);
    }
    const keys = new Set(p.options.map((o) => o.key));
    const clean = {};
    const via = { via: "owner_session", sessionId: fresh?.id || ownerSession.id || null, credential: String(fresh?.credentialId || ownerSession.credentialId || "").slice(0, 10) || null,
      freshUntil: fresh?.freshUntil || null, modality: "click" };
    for (const [k, v] of Object.entries(decisions || {})) {
      if (!keys.has(k)) throw new HubError("validation", `Opțiune necunoscută: ${k}`);
      if (!DECISIONS.has(v)) throw new HubError("validation", "Decizie: approve, reject sau defer");
      clean[k] = { decision: v, at: iso(), by: actor, ...via };
      if (k === "MB2" && v === "approve") clean[k].budget = MEDIA_AI_BUDGET;
      if (p.options.find((o) => o.key === k)?.external) clean[k].external = true;
    }
    if (!Object.keys(clean).length) throw new HubError("validation", "Nicio opțiune decisă");
    const merged = { ...p.decisions, ...clean };
    const allDecided = p.options.every((o) => merged[o.key] && merged[o.key].decision !== "defer");
    bus.transaction(() => {
      db.prepare("UPDATE decision_packages SET decisions_json = ?, status = ?, decided_by = ?, decided_at = ?, version = version + 1 WHERE id = ?").run(json(merged), allDecided ? "DECIDED" : "PRESENTED", String(actor).slice(0, 80), iso(), id);
      bus.append({ type: "package.decided", scopeType: "package", scopeId: id, source: actor, payload: { kind: p.kind, decisions: Object.fromEntries(Object.entries(clean).map(([k, v]) => [k, v.decision])) } });
    });
    const applied = [];
    if (p.kind === "B") {
      if (clean.B3?.decision === "approve") { bus.transaction(() => settings.set("factoryExtraCommands", [...new Set([...(settings.get("factoryExtraCommands") || []), "python-unittest"])], actor, "Pachetul B: python3 -m unittest permis")); applied.push("B3"); }
      if (clean.B3?.decision === "reject") bus.transaction(() => settings.set("factoryExtraCommands", (settings.get("factoryExtraCommands") || []).filter((x) => x !== "python-unittest"), actor, "Pachetul B: python3 -m unittest refuzat"));
      if (clean.B1?.decision === "approve" && apply.setRoute) { await apply.setRoute(p.body.projectId); applied.push("B1"); }
      if (clean.B2?.decision === "approve" && apply.setAutonomy) { await apply.setAutonomy(p.body.projectId, "ASSISTED"); applied.push("B2"); }
      // B4 last: the route (B1) and the command (B3) it needs are in place; the mission only becomes a draft (nothing runs).
      if (clean.B4?.decision === "approve" && apply.preparePilot) {
        // The pilot can only run with its verification command allowed (B3) on the isolated route (B1): without both, nothing is
        // written to the project and B4 waits (review M08 round 2: it ran with B1/B3 rejected and showed EXECUTED).
        const inv = inventoryB();
        const missing = [...((settings.get("factoryExtraCommands") || []).includes("python-unittest") ? [] : ["B3 (comanda python3 -m unittest)"]), ...(inv.route === "wsl-runner" ? [] : ["B1 (ruta izolată wsl-runner)"])];
        if (missing.length) applied.push(`B4 neexecutat: lipsește ${missing.join(" și ")}`);
        else { await apply.preparePilot(inv); applied.push("B4"); }
      }
    }
    if (p.kind === "MEDIA_B") {
      // MB1: the policy only (each capture session still needs its own scope approval). A rejection only removes authority.
      if (clean.MB1?.decision === "approve") {
        bus.transaction(() => settings.set("mediaPolicy", { ...(settings.get("mediaPolicy") || {}), liveCapture: true,
          liveCaptureDecision: { packageId: id, decidedAt: clean.MB1.at, sessionId: via.sessionId, credential: via.credential, via: "owner_session" } }, actor, "Pachetul MEDIA_B: captura live permisă (fiecare sesiune cere aprobarea scopului)"));
        applied.push("MB1");
      }
      if (clean.MB1?.decision === "reject" && (settings.get("mediaPolicy") || {}).liveCapture === true) {
        bus.transaction(() => settings.set("mediaPolicy", { ...(settings.get("mediaPolicy") || {}), liveCapture: false }, actor, "Pachetul MEDIA_B: captura live refuzată"));
      }
      // MB2 is recorded with its budget in the decision; nothing starts.
    }
    // MEDIA_A (installs by the owner) and MEDIA_C (external) have no apply step at all.
    return { package: view(id), applied };
  }

  const list = () => db.prepare("SELECT id FROM decision_packages WHERE status IN ('PRESENTED','DECIDED') ORDER BY created_at DESC LIMIT 20").all().map((r) => view(r.id));
  const pending = (kind) => { const r = db.prepare("SELECT id FROM decision_packages WHERE kind = ? AND status = 'PRESENTED' ORDER BY created_at DESC LIMIT 1").get(kind); return r ? view(r.id) : null; };
  return { present, view, decide, list, pending, inventoryA, inventoryB, inventoryMediaA, inventoryMediaB, inventoryMediaC, pilotMissionInput, pilotModelLimits, attachMedia, useFontsDir, blockersForB, kinds: PACKAGE_KINDS };
}
