#!/usr/bin/env node
// Deterministic Desktop Operator fixture (M10 tests). Speaks the helper's protocol exactly (first line hello with the HMAC key, signed
// requests with nonce/timestamp/authority, signed answers) and enforces the same rules (no authority → refused, replay → refused,
// paused after stop until resume, protected processes, targets outside the authorized apps, sensitive controls, typing only into the
// foreground window, user input suspends). It simulates a small desktop: Notepad (a document without a Value pattern + a real Save As
// dialog that writes the file to disk), CapCut, OBS and Explorer windows. Scenario: env FAKE_OP (JSON); a control file FAKE_OP_CONTROL
// is re-read before every operation so a test can inject events mid-run (user input, a window closing or moving, focus stolen).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import readline from "node:readline";

// The Hub's supervisor gives children an allowlisted environment, so the scenario also arrives as arguments (--scenario=<file|json>,
// --control=<file>, --log=<file>); the env variables remain for direct runs.
const argOf = (name) => { const a = process.argv.find((x) => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : null; };
const scenario = (() => {
  const raw = argOf("scenario") || process.env.FAKE_OP || "{}";
  try { return JSON.parse(raw.trim().startsWith("{") ? raw : fs.readFileSync(raw, "utf8")); } catch { return {}; }
})();
const controlFile = argOf("control") || process.env.FAKE_OP_CONTROL || null;
const logFile = argOf("log") || process.env.FAKE_OP_LOG || null;
const PROTECTED = ["consent", "credentialuibroker", "logonui", "lockapp", "1password", "keepass", "bitwarden", "cmd", "powershell", "pwsh", "windowsterminal", "conhost", "wsl", "bash", "taskmgr", "regedit"];
const SENSITIVE = /\b(publish|post|share|upload|send|submit|delete|remove|pay|buy|purchase|checkout|subscribe|upgrade|sign\s*in|log\s*in|publică|publica|postează|trimite|șterge|sterge|plătește|cumpără|încarcă|incarca|export\s+to\s+(tiktok|youtube|instagram|x|facebook))\b/i;
const OWN_HUB = /Ifrim Agent Hub|localhost:8011|127\.0\.0\.1:8011/i;

let key = null;
let paused = false;
const nonces = new Set();
let nextHwnd = 1000;
let nextPid = 7000;
const windows = new Map();
let foreground = null;
let typedTotal = 0;
const control = () => { if (!controlFile) return {}; try { return JSON.parse(fs.readFileSync(controlFile, "utf8")); } catch { return {}; } };
const consumeControl = (k) => { if (!controlFile) return; const c = control(); delete c[k]; fs.writeFileSync(controlFile, JSON.stringify(c)); };
const log = (entry) => { if (logFile) fs.appendFileSync(logFile, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`); };

class OpError extends Error { constructor(code, message) { super(message); this.code = code; } }

function makeWindow(kind, props = {}) {
  const hwnd = nextHwnd++;
  const pid = props.pid || nextPid++;
  const base = { hwnd, pid, procStart: 133000000000000000 + pid, visible: true, minimized: false, owner: 0, rect: { x: 100, y: 100, w: 900, h: 700 }, dpi: 96, kind };
  const w = { ...base, ...props, hwnd, pid };
  windows.set(hwnd, w);
  return w;
}
// Pre-existing windows of the scenario (e.g. a protected consent dialog, a personal CapCut project, the Hub's own browser window).
for (const pre of scenario.windows || []) makeWindow(pre.kind || "generic", pre);

function describe(w) {
  return { hwnd: w.hwnd, pid: w.pid, processName: w.processName, exePath: w.exePath || `C:\\Fake\\${w.processName}.exe`, procStart: w.procStart, title: w.title, className: w.className,
    rect: w.rect, visible: w.visible, minimized: w.minimized, dpi: w.dpi, owner: w.owner };
}

function nodesOf(w) {
  const root = { ref: `${w.hwnd}.root`, parent: null, controlType: "Window", name: w.title, automationId: "", className: w.className, enabled: true, offscreen: false, isPassword: false, patterns: ["Window"] };
  if (w.kind === "notepad") return [root,
    { ref: `${w.hwnd}.menu.file`, parent: root.ref, controlType: "MenuItem", name: "File", automationId: "File", className: "", enabled: true, offscreen: false, isPassword: false, patterns: ["ExpandCollapse"] },
    { ref: `${w.hwnd}.doc`, parent: root.ref, controlType: "Document", name: "Text editor", automationId: "RichEditBox", className: "RichEditD2DPT", enabled: true, offscreen: false, isPassword: false, patterns: ["Text"] }];
  if (w.kind === "save-dialog") return [root,
    { ref: `${w.hwnd}.filename`, parent: root.ref, controlType: "Edit", name: "File name:", automationId: "1001", className: "Edit", enabled: true, offscreen: false, isPassword: false, patterns: ["Value"], readOnly: false, ...(w.includeValues ? { value: w.filename } : {}) },
    { ref: `${w.hwnd}.save`, parent: root.ref, controlType: "Button", name: "Save", automationId: "1", className: "Button", enabled: true, offscreen: false, isPassword: false, patterns: ["Invoke"] },
    { ref: `${w.hwnd}.cancel`, parent: root.ref, controlType: "Button", name: "Cancel", automationId: "2", className: "Button", enabled: true, offscreen: false, isPassword: false, patterns: ["Invoke"] }];
  if (w.kind === "confirm-overwrite") return [root,
    { ref: `${w.hwnd}.yes`, parent: root.ref, controlType: "Button", name: "Yes", automationId: "6", className: "Button", enabled: true, offscreen: false, isPassword: false, patterns: ["Invoke"] },
    { ref: `${w.hwnd}.no`, parent: root.ref, controlType: "Button", name: "No", automationId: "7", className: "Button", enabled: true, offscreen: false, isPassword: false, patterns: ["Invoke"] }];
  if (w.kind === "capcut") return [root,
    { ref: `${w.hwnd}.new`, parent: root.ref, controlType: "Button", name: "Create project", automationId: "", className: "QPushButton", enabled: true, offscreen: false, isPassword: false, patterns: ["Invoke"] },
    { ref: `${w.hwnd}.import`, parent: root.ref, controlType: "Button", name: "Import", automationId: "", className: "QPushButton", enabled: true, offscreen: false, isPassword: false, patterns: ["Invoke"] },
    { ref: `${w.hwnd}.export`, parent: root.ref, controlType: "Button", name: "Export to TikTok", automationId: "", className: "QPushButton", enabled: true, offscreen: false, isPassword: false, patterns: ["Invoke"] },
    ...(w.media || []).map((m, i) => ({ ref: `${w.hwnd}.media.${i}`, parent: root.ref, controlType: "ListItem", name: m, automationId: "", className: "MediaItem", enabled: true, offscreen: false, isPassword: false, patterns: ["SelectionItem"] }))];
  // The standard Windows Open dialog CapCut shows for "Import" (file name box 1148, Open = 1, Cancel = 2).
  if (w.kind === "open-dialog") return [root,
    { ref: `${w.hwnd}.filename`, parent: root.ref, controlType: "Edit", name: "File name:", automationId: "1148", className: "Edit", enabled: true, offscreen: false, isPassword: false, patterns: ["Value"], readOnly: false },
    { ref: `${w.hwnd}.open`, parent: root.ref, controlType: "Button", name: "Open", automationId: "1", className: "Button", enabled: true, offscreen: false, isPassword: false, patterns: ["Invoke"] },
    { ref: `${w.hwnd}.cancel`, parent: root.ref, controlType: "Button", name: "Cancel", automationId: "2", className: "Button", enabled: true, offscreen: false, isPassword: false, patterns: ["Invoke"] }];
  if (w.kind === "obs") return [root,
    { ref: `${w.hwnd}.rec`, parent: root.ref, controlType: "Button", name: "Start Recording", automationId: "recordButton", className: "QPushButton", enabled: true, offscreen: false, isPassword: false, patterns: ["Invoke"] }];
  if (w.kind === "explorer") return [root,
    { ref: `${w.hwnd}.address`, parent: root.ref, controlType: "ToolBar", name: `Address: ${w.path}`, automationId: "1001", className: "ToolbarWindow32", enabled: true, offscreen: false, isPassword: false, patterns: [] }];
  return [root];
}

function target(hwnd, args, auth) {
  const w = windows.get(Number(hwnd));
  if (!w) throw new OpError("WINDOW_GONE", "Fereastra nu mai există (închisă sau înlocuită).");
  if (PROTECTED.includes(String(w.processName).toLowerCase())) throw new OpError("PROTECTED_TARGET", `${w.processName} e o aplicație protejată; operatorul nu o atinge.`);
  if (OWN_HUB.test(w.title || "")) throw new OpError("PROTECTED_TARGET", "Fereastra Hub-ului nu se operează prin desktop.");
  if (args.pid !== undefined && Number(args.pid) !== w.pid) throw new OpError("IDENTITY_CHANGED", "Fereastra aparține altui proces decât cel verificat (HWND refolosit?).");
  if (args.procStart !== undefined && Number(args.procStart) !== w.procStart) throw new OpError("IDENTITY_CHANGED", "Procesul ferestrei a fost repornit.");
  // Fail-closed like the helper: an operation on a window needs the authority's list of allowed processes.
  if (auth && !Array.isArray(auth.apps)) throw new OpError("OUT_OF_SCOPE", "Autoritatea nu numește aplicațiile permise pentru acest pas.");
  if (auth && !auth.apps.map((x) => String(x).toLowerCase()).includes(String(w.processName).toLowerCase())) throw new OpError("OUT_OF_SCOPE", `${w.processName} nu e în aplicațiile autorizate pentru acest pas.`);
  return w;
}
const elementOf = (w, args) => {
  const nodes = nodesOf(w);
  if (args.ref) { const n = nodes.find((x) => x.ref === args.ref); if (!n) throw new OpError("STALE_REF", "Referința elementului nu mai e validă; observă din nou fereastra."); return n; }
  if (args.selector) {
    const s = args.selector;
    const n = nodes.find((x) => (!s.automationId || x.automationId === s.automationId) && (!s.controlType || x.controlType.toLowerCase() === String(s.controlType).toLowerCase())
      && (!s.name || x.name === s.name) && (!s.className || x.className === s.className) && (!s.nameRegex || new RegExp(s.nameRegex, "i").test(x.name)));
    if (!n) throw new OpError("ELEMENT_NOT_FOUND", "Elementul cerut nu există în fereastră.");
    return n;
  }
  return nodes[0];
};
function requireInteractive() { const c = control(); if (c.secureDesktop || scenario.secureDesktop) throw new OpError("SECURE_DESKTOP", "Ecranul e blocat sau un dialog securizat e activ (Winlogon); controlul interactiv e suspendat."); }
function requireForeground(w) { const c = control(); if (c.stealFocus) { foreground = -1; consumeControl("stealFocus"); } if (foreground !== w.hwnd) throw new OpError("NOT_FOREGROUND", "Fereastra țintă nu e în prim-plan; nu tastez într-o altă fereastră."); }

function saveDocument(dialog, overwriteConfirmed = false) {
  const owner = windows.get(dialog.owner);
  const file = dialog.filename;
  if (!file || !path.isAbsolute(file)) throw new OpError("BAD_PATH", "Numele fișierului nu e o cale absolută.");
  if (fs.existsSync(file) && !overwriteConfirmed) {
    const confirm = makeWindow("confirm-overwrite", { pid: dialog.pid, procStart: dialog.procStart, processName: dialog.processName, title: "Confirm Save As", className: "#32770", owner: dialog.hwnd });
    foreground = confirm.hwnd;
    return { confirmOpened: confirm.hwnd };
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, owner.doc.text, "utf8");
  owner.doc.path = file; owner.doc.dirty = false; owner.title = `${path.basename(file)} - Notepad`;
  windows.delete(dialog.hwnd);
  foreground = owner.hwnd;
  return { saved: file };
}

const ops = {
  resume: () => { paused = false; return { paused: false }; },
  desktopState: () => ({ inputDesktop: control().secureDesktop || scenario.secureDesktop ? "Winlogon" : "Default", interactive: !(control().secureDesktop || scenario.secureDesktop), paused, foregroundProcess: windows.get(foreground)?.processName || null, monitors: 1, virtualScreen: { x: 0, y: 0, w: 1920, h: 1080 } }),
  inputState: () => ({ msSinceInput: 99999, msSinceInjected: 99999, userInputAfterInjected: Boolean(control().userInput) }),
  listWindows: (a) => ({ windows: [...windows.values()].filter((w) => w.visible && (!a.pid || w.pid === Number(a.pid)) && (a.processNames || []).map((x) => x.toLowerCase()).includes(String(w.processName).toLowerCase())).map(describe) }),
  fileInfo: (a) => { const f = (scenario.files || {})[a.path]; if (!f) throw new OpError("NOT_FOUND", "Fișierul nu există."); return { path: a.path, ...f }; },
  discoverApps: (a) => ({ apps: (a.candidates || []).map((c) => ({ id: c.id, found: (scenario.discover || {})[c.id] ? [(scenario.discover || {})[c.id]] : [], tried: ["fake"] })) }),
  launch: (a) => {
    requireInteractive();
    const kind = a.kind || "exe";
    const app = kind === "aumid" ? "notepad" : kind === "explorer" ? "explorer" : String(a.exe || "").toLowerCase().includes("capcut") ? "capcut" : String(a.exe || "").toLowerCase().includes("obs") ? "obs" : "generic";
    if (scenario.launchFails?.includes(app)) throw new OpError("LAUNCH_FAILED", "Lansarea a eșuat (scenariu).");
    let w;
    if (app === "notepad") {
      const file = (a.arguments || "").replace(/^"|"$/g, "");
      const text = file && fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
      w = makeWindow("notepad", { processName: "Notepad", title: `${file ? path.basename(file) : "Untitled"} - Notepad`, className: "Notepad", doc: { text, path: file || null, dirty: false, selectAll: false } });
    } else if (app === "explorer") {
      const folder = (a.args || [])[0];
      w = makeWindow("explorer", { pid: 4242, procStart: 133000000000004242, processName: "explorer", title: path.basename(folder || "Home"), className: "CabinetWClass", path: folder });
    } else if (app === "capcut") w = makeWindow("capcut", { processName: "CapCut", title: "CapCut", className: "Qt5152QWindowIcon" });
    else if (app === "obs") w = makeWindow("obs", { processName: "obs64", title: "OBS 32.2.2 - Profile: Untitled - Scenes: Untitled", className: "Qt5152QWindowIcon" });
    else throw new OpError("NOT_FOUND", "Executabil necunoscut în scenariu.");
    if (!scenario.noAutoForeground) foreground = w.hwnd;
    return { pid: w.pid, launchedTick: 1 };
  },
  waitWindow: (a) => {
    const re = a.titleRegex ? new RegExp(a.titleRegex, "i") : null;
    const found = [...windows.values()].filter((w) => w.visible && (!a.pid || w.pid === Number(a.pid)) && (a.processNames || []).map((x) => x.toLowerCase()).includes(String(w.processName).toLowerCase())
      && (!re || re.test(w.title)) && (!a.className || w.className === a.className) && !(a.excludeHwnds || []).includes(w.hwnd));
    if (!found.length) throw new OpError("WINDOW_NOT_FOUND", `Fereastra așteptată nu a apărut în ${a.timeoutMs || 10000} ms.`);
    return { window: describe(found.at(-1)), waitedMs: 5 };
  },
  focus: (a, auth) => { requireInteractive(); const w = target(a.hwnd, {}, auth); if (!(control().refuseFocus || scenario.refuseFocus)) foreground = w.hwnd; return { foreground: foreground === w.hwnd, window: describe(w) }; },
  move: (a, auth) => { const w = target(a.hwnd, a, auth); w.rect = { x: Number(a.x), y: Number(a.y), w: Number(a.w), h: Number(a.h) }; return { window: describe(w) }; },
  observe: (a, auth) => { const w = target(a.hwnd, a, auth); return { window: describe(w), nodes: nodesOf({ ...w, includeValues: a.includeValues }), truncated: false, focused: w.kind === "notepad" ? `${w.hwnd}.doc` : null, foreground: foreground === w.hwnd }; },
  find: (a, auth) => { const w = target(a.hwnd, a, auth); try { return { elements: [elementOf(w, { selector: a.selector })] }; } catch { return { elements: [] }; } },
  invoke: (a, auth) => {
    requireInteractive();
    const w = target(a.hwnd, a, auth);
    const el = elementOf(w, a);
    if (SENSITIVE.test(el.name)) throw new OpError("SENSITIVE_CONTROL", `„${el.name}” are un efect extern, destructiv sau de plată; operatorul nu îl apasă.`);
    if (w.kind === "save-dialog" && el.automationId === "1") return { how: "invoke", element: el, ...saveDocument(w) };
    if (w.kind === "save-dialog" && el.automationId === "2") { windows.delete(w.hwnd); foreground = w.owner; return { how: "invoke", element: el, cancelled: true }; }
    if (w.kind === "confirm-overwrite" && el.automationId === "6") { const dialog = windows.get(w.owner); windows.delete(w.hwnd); return { how: "invoke", element: el, ...saveDocument(dialog, true) }; }
    if (w.kind === "confirm-overwrite" && el.automationId === "7") { windows.delete(w.hwnd); foreground = w.owner; return { how: "invoke", element: el, declined: true }; }
    if (w.kind === "capcut" && el.name === "Create project") { w.project = true; w.title = "CapCut - Proiect nou"; return { how: "invoke", element: el }; }
    if (w.kind === "capcut" && el.name === "Import") {
      if (!w.project) throw new OpError("NOT_INVOKABLE", "Import e activ doar într-un proiect deschis (scenariu).");
      const d = makeWindow("open-dialog", { pid: w.pid, procStart: w.procStart, processName: w.processName, title: "Open", className: "#32770", owner: w.hwnd, filename: "" });
      foreground = d.hwnd;
      return { how: "invoke", element: el };
    }
    if (w.kind === "open-dialog" && el.automationId === "1") {
      const owner = windows.get(w.owner);
      if (!w.filename || !fs.existsSync(w.filename)) throw new OpError("FILE_NOT_FOUND", "Fișierul ales nu există (dialogul rămâne deschis).");
      owner.media = [...(owner.media || []), path.basename(w.filename)];
      windows.delete(w.hwnd); foreground = owner.hwnd;
      return { how: "invoke", element: el, opened: w.filename };
    }
    if (w.kind === "open-dialog" && el.automationId === "2") { windows.delete(w.hwnd); foreground = w.owner; return { how: "invoke", element: el, cancelled: true }; }
    if (!el.patterns.includes("Invoke") && !el.patterns.includes("ExpandCollapse")) throw new OpError("NOT_INVOKABLE", "Elementul nu expune o acțiune structurală.");
    return { how: "invoke", element: el };
  },
  setValue: (a, auth) => {
    requireInteractive();
    const w = target(a.hwnd, a, auth);
    const el = elementOf(w, a);
    if (el.isPassword) throw new OpError("PROTECTED_FIELD", "Câmp de parolă.");
    if (!el.patterns.includes("Value")) throw new OpError("NO_VALUE_PATTERN", "Câmpul nu acceptă setarea directă a valorii.");
    if (w.kind === "save-dialog" || w.kind === "open-dialog") w.filename = String(a.text);
    return { value: String(a.text).slice(0, 400) };
  },
  setFocus: (a, auth) => { requireInteractive(); const w = target(a.hwnd, a, auth); const el = elementOf(w, a); w.focusedRef = el.ref; return { focused: el }; },
  getText: (a, auth) => {
    const w = target(a.hwnd, a, auth);
    const el = elementOf(w, a);
    if (w.kind === "notepad" && el.ref.endsWith(".doc")) return { text: w.doc.text, source: "Text" };
    if (w.kind === "save-dialog" && el.automationId === "1001") return { text: w.filename || "", source: "Value" };
    return { text: el.name, source: "Name" };
  },
  typeText: (a, auth) => {
    requireInteractive();
    const w = target(a.hwnd, a, auth);
    const text = String(a.text || "");
    let sent = 0;
    for (let i = 0; i < text.length; i += 16) {
      if (paused) throw new OpError("STOPPED", `Oprit în timpul tastării; ${sent} caractere trimise.`);
      requireForeground(w);
      const c = control();
      const after = scenario.userInputAfterChars ?? c.userInputAfterChars;
      if (c.userInput || (after !== undefined && typedTotal + sent >= after)) { paused = true; consumeControl("userInput"); throw new OpError("USER_INPUT", "Ai folosit tastatura sau mouse-ul în timpul operației; m-am oprit și aștept (Preiau eu / Continuă)."); }
      const chunk = text.slice(i, i + 16);
      if (w.kind === "notepad") {
        if (w.doc.selectAll) { w.doc.text = ""; w.doc.selectAll = false; }
        w.doc.text += chunk.replace(/\r/g, ""); w.doc.dirty = true;
      } else if (w.kind === "save-dialog") w.filename = (w.filename || "") + chunk;
      sent += chunk.length;
    }
    typedTotal += sent;
    return { typed: sent };
  },
  keys: (a, auth) => {
    requireInteractive();
    const w = target(a.hwnd, a, auth);
    requireForeground(w);
    const combo = String(a.combo || "").toLowerCase();
    if (w.kind === "notepad" && combo === "ctrl+a") w.doc.selectAll = true;
    else if (w.kind === "notepad" && (combo === "ctrl+shift+s" || (combo === "ctrl+s" && !w.doc.path))) {
      const d = makeWindow("save-dialog", { pid: w.pid, procStart: w.procStart, processName: w.processName, title: "Save as", className: "#32770", owner: w.hwnd, filename: w.doc.path ? path.basename(w.doc.path) : "*.txt" });
      foreground = d.hwnd;
    } else if (w.kind === "notepad" && combo === "ctrl+s") { fs.writeFileSync(w.doc.path, w.doc.text, "utf8"); w.doc.dirty = false; }
    else if (w.kind === "notepad" && combo === "ctrl+w") { if (w.doc.dirty) throw new OpError("UNSAVED", "Documentul are modificări nesalvate (scenariu)."); windows.delete(w.hwnd); foreground = null; }
    else if (combo === "escape" && (w.kind === "save-dialog" || w.kind === "confirm-overwrite")) { windows.delete(w.hwnd); foreground = w.owner; }
    return { combo };
  },
  clickElement: (a, auth) => { requireInteractive(); const w = target(a.hwnd, a, auth); requireForeground(w); const el = elementOf(w, a); if (SENSITIVE.test(el.name)) throw new OpError("SENSITIVE_CONTROL", "Buton sensibil."); return { x: 10, y: 10, element: el }; },
  explorerWindows: () => ({ windows: [...windows.values()].filter((w) => w.kind === "explorer").map((w) => ({ hwnd: w.hwnd, path: w.path, title: w.title })) }),
};

function applyControl() {
  const c = control();
  if (c.closeWindow) { windows.delete(Number(c.closeWindow)); consumeControl("closeWindow"); }
  if (c.replaceWindow) { const old = windows.get(Number(c.replaceWindow)); if (old) { windows.delete(old.hwnd); windows.set(old.hwnd, { ...old, pid: old.pid + 1, procStart: old.procStart + 1 }); } consumeControl("replaceWindow"); }
  if (c.moveWindow) { const w = windows.get(Number(c.moveWindow.hwnd)); if (w) w.rect = c.moveWindow.rect; consumeControl("moveWindow"); }
}

function reply(id, op, payload) {
  const body = JSON.stringify({ ...payload, id, op, ts: new Date().toISOString() });
  const mac = crypto.createHmac("sha256", key || Buffer.alloc(32)).update(body, "utf8").digest("hex");
  process.stdout.write(`${JSON.stringify({ body, mac })}\n`);
}

const rl = readline.createInterface({ input: process.stdin });
let first = true;
rl.on("line", async (line) => {
  if (!line.trim()) return;
  if (first) {
    first = false;
    try { key = Buffer.from(JSON.parse(line).hello.key, "hex"); } catch { process.exit(2); }
    reply(null, "hello", { ok: true, version: "fake-1.0", pid: process.pid, session: "" });
    return;
  }
  let env, body;
  try { env = JSON.parse(line); } catch { return reply(null, "error", { ok: false, error: { code: "BAD_MESSAGE", message: "JSON invalid" } }); }
  const expected = crypto.createHmac("sha256", key).update(String(env.body), "utf8").digest("hex");
  if (expected !== String(env.mac).toLowerCase()) return reply(null, "error", { ok: false, error: { code: "BAD_MAC", message: "semnătura mesajului nu corespunde" } });
  body = JSON.parse(env.body);
  if (nonces.has(body.nonce)) return reply(body.id, body.op, { ok: false, error: { code: "REPLAY", message: "mesaj deja primit (nonce refolosit)" } });
  nonces.add(body.nonce);
  if (Math.abs(Date.now() - Date.parse(body.ts)) > 120000) return reply(body.id, body.op, { ok: false, error: { code: "STALE", message: "mesaj prea vechi" } });
  const open = ["ping", "stop", "releaseAll", "desktopState", "inputState", "resume"].includes(body.op);
  if (!open && (!body.auth?.exp || Date.parse(body.auth.exp) <= Date.now())) return reply(body.id, body.op, { ok: false, error: { code: body.auth?.exp ? "AUTHORITY_EXPIRED" : "NO_AUTHORITY", message: "operația cere autoritatea Hub-ului (nevalidă sau expirată)" } });
  log({ op: body.op, args: { ...body.args, text: body.args?.text !== undefined ? `[${String(body.args.text).length} caractere]` : undefined }, auth: body.auth ? { plan: body.auth.plan, step: body.auth.step, apps: body.auth.apps } : null });
  if (body.op === "stop") { paused = true; return reply(body.id, body.op, { ok: true, result: { paused: true } }); }
  if (body.op === "ping") return reply(body.id, body.op, { ok: true, result: { paused, version: "fake-1.0" } });
  if (body.op === "releaseAll") return reply(body.id, body.op, { ok: true, result: {} });
  if ((scenario.exitOn || control().exitOn) === body.op) process.exit(3);
  if ((scenario.hangOps || control().hangOps || []).includes(body.op)) return; // never answers: the client's timeout decides
  if (paused && !["listWindows", "fileInfo", "resume", "desktopState", "inputState", "discoverApps"].includes(body.op)) return reply(body.id, body.op, { ok: false, error: { code: "PAUSED", message: "Operatorul e pe pauză (Stop / Preiau eu)." } });
  applyControl();
  try {
    const fn = ops[body.op];
    if (!fn) throw new OpError("UNKNOWN_OP", `Operație necunoscută: ${body.op}`);
    reply(body.id, body.op, { ok: true, result: await fn(body.args || {}, body.auth || null) });
  } catch (error) { reply(body.id, body.op, { ok: false, error: { code: error.code || "FAILED", message: error.message } }); }
});
rl.on("close", () => process.exit(0));
