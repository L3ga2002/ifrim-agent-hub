// Stage before M12 — what Lega knows about the system, built ONLY from the Hub's real state (registries, tables, files on disk), never
// from a fixed text: installed applications and what the Hub can do in each (with the level actually demonstrated), accounts and models,
// projects and where their results are, what is active, what Codex produced, what Claude found, what is blocked and why. Read-only.
// Every answer names the screen route where the owner sees the same thing (#/…). Content read from projects, documents or videos is
// shown as data and can never authorize anything.
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { officeExe } from "../office/office.mjs";

export const KNOWLEDGE_TOPICS = Object.freeze(["apps", "accounts", "capabilities", "locations", "active", "codex", "claude", "blocked", "overview"]);
const LEVEL_WORDS = Object.freeze({ VERIFIED_API: "verificat prin API", VERIFIED_GUI: "verificat în interfață", IMPLEMENTED_API: "implementat prin API (neverificat încă aici)",
  IMPLEMENTED: "implementat (neverificat încă aici)", ASSISTED_ONLY: "doar asistat (pasul îl faci tu)", UNSUPPORTED: "nesuportat", BLOCKED_BY_OS: "blocat de Windows", UNVERIFIED: "neverificat" });
const safe = (fn, fallback) => { try { const v = fn(); return v === undefined ? fallback : v; } catch { return fallback; } };

/**
 * A controlled inventory of installed applications from the STANDARD sources only (the Uninstall registry keys of the machine and the
 * user): name, version, publisher, install folder. No disk scan, nothing launched. Windows only. Read asynchronously (the registry walk
 * takes seconds) and cached for 10 minutes; `installedInventory()` returns the cache at once and refreshes it in the background.
 */
let inventoryCache = null;
let inventoryLoading = null;
const regQuery = (root) => new Promise((resolve) => execFile("reg.exe", ["query", root, "/s"], { encoding: "utf8", windowsHide: true, timeout: 30000, maxBuffer: 32 * 1024 * 1024 }, (error, out) => resolve(error ? "" : out)));
export function parseUninstall(out, apps = new Map()) {
  let cur = null;
  const flush = () => { if (cur?.name && !cur.system && !/^(KB\d+|Security Update|Update for)/i.test(cur.name)) { const k = cur.name.toLowerCase(); if (!apps.has(k)) apps.set(k, { name: cur.name, version: cur.version || null, publisher: cur.publisher || null, location: cur.location || null }); } };
  for (const line of String(out).split(/\r?\n/)) {
    if (/^HKEY_/.test(line)) { flush(); cur = {}; continue; }
    const m = line.match(/^\s+(\S+)\s+REG_\w+\s+(.*)$/);
    if (!m || !cur) continue;
    if (m[1] === "DisplayName") cur.name = m[2].trim();
    else if (m[1] === "DisplayVersion") cur.version = m[2].trim();
    else if (m[1] === "Publisher") cur.publisher = m[2].trim();
    else if (m[1] === "InstallLocation") cur.location = m[2].trim() || null;
    else if (m[1] === "SystemComponent" && /0x1/.test(m[2])) cur.system = true;
  }
  flush();
  return apps;
}
export async function refreshInventory() {
  if (process.platform !== "win32") return { apps: [], source: "unsupported-platform" };
  if (inventoryLoading) return inventoryLoading;
  inventoryLoading = (async () => {
    const roots = ["HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall", "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall", "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall"];
    const apps = new Map();
    for (const out of await Promise.all(roots.map(regQuery))) parseUninstall(out, apps);
    const value = { apps: [...apps.values()].sort((x, y) => x.name.localeCompare(y.name)), source: "registry:Uninstall", at: new Date().toISOString() };
    inventoryCache = { at: Date.now(), value };
    return value;
  })().finally(() => { inventoryLoading = null; });
  return inventoryLoading;
}
export function installedInventory({ now = Date.now() } = {}) {
  if (!inventoryCache || now - inventoryCache.at > 600000) refreshInventory().catch(() => {});
  return inventoryCache?.value || { apps: [], source: "loading" };
}

export function createKnowledge(hub) {
  const { db, projects, providerState, factory, deliveries, opsPlans, desktop, media, missions, cockpit, settings } = hub;

  function apps({ withInventory = true } = {}) {
    const operable = safe(() => desktop.apps.list(), []).map((a) => ({ id: a.id, name: a.displayName, status: a.status, version: a.version, authorized: a.authorized,
      operations: Object.entries(a.capabilities || {}).map(([op, level]) => ({ op, level, words: LEVEL_WORDS[level] || level, verifiedAt: a.verification?.[op]?.at || null })) }));
    const office = [
      { id: "word", name: "Microsoft Word", route: "COM (instanță proprie, invizibilă, doar citire)", operations: [{ op: "generare .docx", level: "IMPLEMENTED", words: "Hub-ul scrie fișierul" }, { op: "deschidere + verificare structură + export PDF", level: "VERIFIED_API", words: "verificat prin API" }] },
      { id: "excel", name: "Microsoft Excel", route: "COM (instanță proprie, invizibilă, doar citire)", operations: [{ op: "generare .xlsx", level: "IMPLEMENTED", words: "Hub-ul scrie fișierul" }, { op: "recalculare formule + citire valori + export PDF", level: "VERIFIED_API", words: "verificat prin API" }] },
    ];
    const inv = withInventory ? safe(() => installedInventory(), { apps: [] }) : { apps: [], source: "skipped" };
    return { operable, office: office.filter((o) => Boolean(safe(() => officeExe(o.id === "word" ? "docx" : "xlsx"), null))), installedCount: inv.apps.length, inventorySource: inv.source,
      installed: inv.apps.slice(0, 400), screen: "#/system" };
  }

  function accounts() {
    const list = ["codex", "claude"].map((p) => {
      const s = safe(() => providerState.get(p), null) || {};
      return { provider: p, status: s.status || s.state || "necunoscut", account: s.account?.email ? "conectat" : s.account ? "conectat" : null, checkedAt: s.checkedAt || s.updatedAt || null,
        models: safe(() => (settings.get("factoryDefaultBindings") || {}), {}) && null };
    });
    const bindings = safe(() => settings.get("factoryDefaultBindings") || {}, {});
    return { providers: list, projectModels: Object.entries(bindings).map(([projectId, b]) => ({ project: safe(() => projects.get(projectId)?.name, projectId), writer: b.writer ? `${b.writer.model} · ${b.writer.effort}` : null, reviewer: b.reviewer ? `${b.reviewer.model} · ${b.reviewer.effort}` : null })),
      billing: "doar abonamentele (fără API billing / extra usage)", screen: "#/integrations" };
  }

  function capabilities() {
    const verified = safe(() => db.prepare("SELECT method, label, summary, created_at FROM capability_verifications ORDER BY created_at DESC LIMIT 20").all(), []);
    return {
      flows: [
        { name: "Software Factory (cod, teste, review, QA, preview)", route: "Codex scrie, Claude verifică doar citind, Hub-ul rulează testele", screen: "#/lega" },
        { name: "Livrare demo (capturi, clip 16:9 + 9:16, QA, export, rezumat)", route: "Chromium + ffmpeg, fără model", screen: "#/livrare" },
        { name: "Document Word / registru Excel", route: "generate de Hub, verificate în Word / Excel prin COM", screen: "#/livrare" },
        { name: "Pachet de campanie (local, nepublicat)", route: "fișiere în dosarul livrării; publicarea nu e activă: nimic nu se publică", screen: "#/livrare" },
        // M12 final review C5: the offer preparation (Vânzări): local, synthetic, never sent.
        { name: "Pregătirea ofertelor (Vânzări, firme sintetice): brief, calificare, oferta până la aprobarea ta, apoi ciorna netrimisă și „Dosarul ofertei”", route: "local, fără model; nimic nu se trimite, nu se contactează și nu se publică (OUTREACH_DISABLED)", screen: "#/sales" },
        { name: "Studio video (import, montaj, corecții, variante, QA, export)", route: "ffmpeg local", screen: "#/studio" },
        { name: "Operator desktop (deschide, citește, tastează verificat, salvează)", route: "UI Automation, un singur controller, Stop / Preiau eu", screen: "#/system" },
      ],
      verified: verified.map((v) => ({ label: v.label, method: v.method, at: v.created_at, summary: String(v.summary || "").slice(0, 160) })),
    };
  }

  /**
   * M12 final review C5: where the offers' dossiers are (<exports>\vanzari\oferta-…\revizia-N), the newest one and its state. Local only:
   * an offer is prepared here and never sent.
   */
  function offers() {
    const exportsDir = safe(() => media.exportsDir(), null);
    const dossier = safe(() => db.prepare("SELECT d.folder, d.status, d.revision, d.manifest_sha256, d.opportunity_id FROM sales_dossiers d ORDER BY d.created_at DESC LIMIT 1").get(), null);
    const blockedPreps = safe(() => db.prepare("SELECT id, status, status_reason FROM sales_preparations WHERE status IN ('STALE','STOPPED','EXPIRED','FAILED') ORDER BY updated_at DESC LIMIT 5").all(), []);
    const waiting = safe(() => db.prepare("SELECT id FROM sales_preparations WHERE status = 'WAITING_OWNER' ORDER BY updated_at DESC LIMIT 5").all(), []);
    return { root: exportsDir ? path.join(exportsDir, "vanzari") : null,
      latest: dossier ? { folder: dossier.folder, status: dossier.status, revision: dossier.revision, manifestSha256: dossier.manifest_sha256 || null, exists: fs.existsSync(dossier.folder),
        screen: `#/sales?tab=opp&id=${encodeURIComponent(dossier.opportunity_id)}` } : null,
      blocked: blockedPreps.map((p) => ({ id: p.id, status: p.status, reason: p.status_reason || "" })), waitingForOwner: waiting.length, sent: false };
  }

  function locations() {
    const exportsDir = safe(() => media.exportsDir(), null);
    const recent = safe(() => deliveries.list().slice(0, 5), []).map((d) => ({ title: d.title, status: d.status, folder: d.template?.exports ? path.join(d.template.exports.dir, d.template.exports.folder) : null, screen: `#/livrare/${d.id}` }));
    return {
      projects: safe(() => projects.list(), []).map((p) => ({ name: p.name, path: p.path, test: p.source === "hub-test", screen: `#/lega/${p.id}` })),
      exportsDir, deliveries: recent.map((r) => ({ ...r, exists: r.folder ? fs.existsSync(r.folder) : false })), offers: offers(),
      screens: { lega: "#/lega", livrare: "#/livrare", decizii: "#/livrare/decizii", studio: "#/studio", sistem: "#/system", telefon: "#/m", vanzari: "#/sales" },
    };
  }

  function active() {
    const running = safe(() => factory.list(), []).filter((f) => !["SPEC_DRAFT", "DELIVERY_READY", "ACCEPTED", "CANCELLED", "REJECTED", "FAILED"].includes(f.stage)).map((f) => ({ title: f.title, stage: f.stage, project: safe(() => projects.get(f.projectId)?.name, f.projectId) }));
    const plans = safe(() => db.prepare("SELECT id, title, status FROM ops_plans WHERE status IN ('CONFIRMED','RUNNING','PAUSED','NEEDS_OWNER') ORDER BY updated_at DESC LIMIT 10").all(), []);
    const deliveriesOpen = safe(() => deliveries.list().filter((d) => ["ARMED", "ACTIVE", "NEEDS_OWNER"].includes(d.status)), []).map((d) => ({ title: d.title, status: d.status, screen: `#/livrare/${d.id}` }));
    const waiting = safe(() => deliveries.list().filter((d) => d.status === "READY"), []).length;
    return { missions: running, plans: plans.map((p) => ({ title: p.title, status: p.status })), deliveries: deliveriesOpen, waitingForOwner: waiting, gate: safe(() => settings.get("executionGate")?.status, null), mode: safe(() => settings.get("mode"), null) };
  }

  function codex() {
    const sets = safe(() => db.prepare(`SELECT cs.mission_id, cs.seq, cs.changes_json, cs.created_at, m.title FROM factory_change_sets cs JOIN missions m ON m.id = cs.mission_id ORDER BY cs.created_at DESC LIMIT 3`).all(), []);
    const runs = safe(() => db.prepare("SELECT provider, model, status, created_at FROM agent_runs WHERE provider = 'codex' ORDER BY created_at DESC LIMIT 3").all(), []);
    return { changeSets: sets.map((s) => { const ch = safe(() => JSON.parse(s.changes_json), []); return { mission: s.title, seq: s.seq, at: s.created_at, files: (Array.isArray(ch) ? ch : []).slice(0, 8).map((c) => c.path || c.file || String(c)).filter(Boolean) }; }),
      runs: runs.map((r) => ({ model: r.model, status: r.status, at: r.created_at })) };
  }

  function claude() {
    const reviews = safe(() => db.prepare(`SELECT r.verdict, r.summary, r.created_at, m.title FROM factory_reviews r JOIN missions m ON m.id = r.mission_id ORDER BY r.created_at DESC LIMIT 3`).all(), []);
    const findings = safe(() => db.prepare("SELECT severity, observation, file, status, created_at FROM factory_findings ORDER BY created_at DESC LIMIT 6").all(), []);
    return { reviews: reviews.map((r) => ({ mission: r.title, verdict: r.verdict, summary: String(r.summary || "").slice(0, 200), at: r.created_at })),
      findings: findings.map((f) => ({ severity: f.severity, text: String(f.observation).slice(0, 200), file: f.file, status: f.status })) };
  }

  async function blocked() {
    const why = await Promise.resolve(safe(() => cockpit.whyBlocked({}), null)).catch(() => null);
    const waiting = safe(() => db.prepare("SELECT title, status, status_reason FROM deliveries WHERE status IN ('NEEDS_OWNER','STALE') ORDER BY updated_at DESC LIMIT 5").all(), []);
    return { gate: safe(() => settings.get("executionGate"), null), explanation: why, deliveries: waiting.map((d) => ({ title: d.title, status: d.status, reason: d.status_reason })),
      // C5: an offer's preparation stopped by a change, a Stop All, an expiry or an error (it continues with ONE new card).
      offers: offers().blocked };
  }

  /** The offers' dossier answer (C5): where it is, its state, and that nothing was sent. */
  function offersText(o) {
    if (o.latest) return `Ultimul dosar al ofertei (revizia ${o.latest.revision}, ${o.latest.status}${o.latest.exists ? "" : ", folderul nu mai e pe disc"}) e în ${o.latest.folder}. Ofertele se pregătesc local și nu se trimit: ciorna rămâne netrimisă.`;
    return o.root ? `Dosarele ofertelor merg în ${o.root} (încă nu am niciunul). Ofertele se pregătesc local și nu se trimit.` : "Dosarele ofertelor merg în folderul de exporturi, sub „vanzari” (folderul de exporturi nu e ales încă). Ofertele se pregătesc local și nu se trimit.";
  }

  async function snapshot(topic = "overview") {
    const t = KNOWLEDGE_TOPICS.includes(topic) ? topic : "overview";
    if (t === "apps") return { topic: t, apps: apps() };
    if (t === "accounts") return { topic: t, accounts: accounts() };
    if (t === "capabilities") return { topic: t, capabilities: capabilities() };
    if (t === "locations") return { topic: t, locations: locations() };
    if (t === "active") return { topic: t, active: active() };
    if (t === "codex") return { topic: t, codex: codex() };
    if (t === "claude") return { topic: t, claude: claude() };
    if (t === "blocked") return { topic: t, blocked: await blocked() };
    return { topic: "overview", active: active(), apps: apps({ withInventory: false }), capabilities: capabilities(), locations: locations() };
  }

  /** The same facts as one or two spoken sentences (Romanian), with the screen to open. */
  async function answer(topic, { about = null } = {}) {
    const s = await snapshot(topic);
    // C5: „Unde e dosarul ofertei?” — the offers' dossier, not the last delivery folder.
    if (s.topic === "locations" && about === "offers") return { text: offersText(s.locations.offers), screen: s.locations.offers.latest?.screen || "#/sales", data: s };
    if (s.topic === "apps") {
      const ops = s.apps.operable.map((a) => `${a.name}${a.status === "NOT_FOUND" ? " (negăsit)" : a.authorized ? "" : " (neautorizat încă)"}`).join(", ");
      const office = s.apps.office.map((o) => o.name).join(" și ");
      return { text: `${s.apps.installedCount ? `Pe calculator văd ${s.apps.installedCount} aplicații instalate.` : "Inventarul aplicațiilor se citește încă."} Le pot opera direct pe ${ops || "niciuna"}${office ? `; în ${office} generez și verific documente prin automatizarea lor` : ""}. Deschiderea unei aplicații și lucrul în ea le verific separat.`, screen: s.apps.screen, data: s };
    }
    if (s.topic === "accounts") return { text: `${s.accounts.providers.map((p) => `${p.provider === "codex" ? "Codex" : "Claude"}: ${p.status}`).join("; ")}. Folosesc doar abonamentele.${s.accounts.projectModels.length ? ` Modele pe proiecte: ${s.accounts.projectModels.slice(0, 2).map((m) => `${m.project} (scrie ${m.writer || "implicit"}, verifică ${m.reviewer || "implicit"})`).join("; ")}.` : ""}`, screen: s.accounts.screen, data: s };
    if (s.topic === "locations") {
      const d = s.locations.deliveries.find((x) => x.exists);
      // C5: the offers' newest dossier is named too (a separate place: <exports>\vanzari\…).
      const o = s.locations.offers?.latest ? ` ${offersText(s.locations.offers)}` : "";
      return { text: `${d ? `Ultimul dosar de livrare („${d.title}”, ${d.status}) e în ${d.folder}. Îl vezi și în camera de livrare.` : `Exporturile merg în ${s.locations.exportsDir || "folderul de exporturi (neales încă)"}.`}${o}`, screen: d?.screen || "#/livrare", data: s };
    }
    if (s.topic === "active") {
      const a = s.active;
      const parts = [];
      if (a.missions.length) parts.push(`lucrez la ${a.missions.map((m) => `„${m.title}” (${m.stage})`).slice(0, 3).join(", ")}`);
      if (a.plans.length) parts.push(`${a.plans.length} ${a.plans.length === 1 ? "plan" : "planuri"} în curs`);
      if (a.deliveries.length) parts.push(`${a.deliveries.length} ${a.deliveries.length === 1 ? "livrare" : "livrări"} în lucru`);
      if (a.waitingForOwner) parts.push(`${a.waitingForOwner} ${a.waitingForOwner === 1 ? "livrare așteaptă" : "livrări așteaptă"} decizia ta`);
      return { text: parts.length ? `Acum ${parts.join("; ")}.` : "Acum nu rulează nimic.", screen: "#/lega", data: s };
    }
    if (s.topic === "codex") {
      const c = s.codex.changeSets[0];
      return { text: c ? `Ultima schimbare scrisă de Codex: „${c.mission}”, setul ${c.seq}, fișierele ${c.files.slice(0, 4).join(", ") || "(nicio listă)"}.` : "Codex nu a scris încă nimic înregistrat.", screen: "#/lega", data: s };
    }
    if (s.topic === "claude") {
      const r = s.claude.reviews[0];
      const open = s.claude.findings.filter((f) => f.status === "OPEN");
      return { text: r ? `Ultimul review Claude („${r.mission}”): ${r.verdict}.${open.length ? ` Observații deschise: ${open.slice(0, 2).map((f) => f.text).join("; ")}.` : " Nicio observație deschisă."}` : "Claude nu a făcut încă un review înregistrat.", screen: "#/lega", data: s };
    }
    if (s.topic === "blocked") {
      const g = s.blocked.gate;
      const ex = s.blocked.explanation;
      const lines = [];
      if (g && g.status !== "open") lines.push(`poarta e ${g.status}${g.reason ? ` (${String(g.reason).slice(0, 100)})` : ""}`);
      if (ex?.text) lines.push(String(ex.text).slice(0, 200));
      for (const d of s.blocked.deliveries) lines.push(`„${d.title}”: ${d.status}${d.reason ? ` — ${String(d.reason).slice(0, 100)}` : ""}`);
      for (const p of s.blocked.offers || []) lines.push(`pregătirea ofertei ${p.id}: ${p.status}${p.reason ? ` — ${String(p.reason).slice(0, 100)}` : ""} (o continuare e un card nou: „Continuă pregătirea ofertei”)`);
      return { text: lines.length ? `Blocat: ${lines.join("; ")}.` : "Nimic nu e blocat acum.", screen: "#/lega", data: s };
    }
    if (s.topic === "capabilities") return { text: `Pot face: ${s.capabilities.flows.map((f) => f.name).join("; ")}.`, screen: "#/system", data: s };
    const a = s.active;
    return { text: `${a.missions.length ? `Lucrez la ${a.missions.length} ${a.missions.length === 1 ? "misiune" : "misiuni"}.` : "Nu rulează nicio misiune."} Pot lucra cu software, livrări demo, Word, Excel, campanii locale, video, oferte pregătite local (netrimise) și aplicațiile autorizate.`, screen: "#/lega", data: s };
  }

  // Warm the inventory once in the background on a real Hub (never in tests: no registry walk there).
  if (!hub.config?.testMode) setTimeout(() => refreshInventory().catch(() => {}), 15000).unref?.();
  return { snapshot, answer, apps, accounts, capabilities, locations, active, codex, claude, blocked, inventory: installedInventory, refreshInventory };
}

// The question grammar lives in intents.mjs (tests copy that module alone); re-exported here for callers of the knowledge service.
export { knowledgeTopic, KNOWLEDGE_QUESTION } from "./intents.mjs";
