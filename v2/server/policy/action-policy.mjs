// M10 action policy: the class of an action is decided by its EFFECT (the app, the file, the destination, the control it touches),
// never by its verb or by who claims to ask. Four classes:
//   LOCAL_DIRECT — a local, reversible, already-eligible operation (open an authorized app, bring a window forward, show an allowed
//                  folder, status, stop): the owner's authentic command is the instruction; no extra confirmation.
//   PLAN_STEP    — a step of a multi-step local workflow (type, click, save, capture, import, edit, render, export): runs only under
//                  ONE confirmed operation plan whose derived authority covers it, checked again at every dispatch.
//   SENSITIVE    — a material change (new app or folder access, a cost or model run, an overwrite, live capture without the policy,
//                  anything external): the exact difference is shown and the owner decides; never inside an ordinary plan.
//   REFUSED      — never by the operator: publishing / sending / paying / deleting externally, the Hub's own administration (Hello,
//                  grants, settings), credential stores and secure-desktop dialogs, arbitrary scripts or shells.
import path from "node:path";

export const ACTION_CLASSES = Object.freeze(["LOCAL_DIRECT", "PLAN_STEP", "SENSITIVE", "REFUSED"]);

/** The base class of each operation; `classifyAction` refines it with the target. */
export const OPERATIONS = Object.freeze({
  status: "LOCAL_DIRECT", stop: "LOCAL_DIRECT", pause: "LOCAL_DIRECT", takeover: "LOCAL_DIRECT", resume: "LOCAL_DIRECT",
  "app.launch": "LOCAL_DIRECT", "app.focus": "LOCAL_DIRECT", "window.move": "LOCAL_DIRECT", "folder.show": "LOCAL_DIRECT", "studio.open": "LOCAL_DIRECT",
  "export.local": "LOCAL_DIRECT",
  "desktop.observe": "PLAN_STEP", "ui.setText": "PLAN_STEP", "ui.type": "PLAN_STEP", "ui.invoke": "PLAN_STEP", "ui.keys": "PLAN_STEP", "ui.select": "PLAN_STEP",
  "file.open": "PLAN_STEP", "file.saveAs": "PLAN_STEP",
  "media.import": "PLAN_STEP", "media.project.import": "PLAN_STEP", "media.edit.apply": "PLAN_STEP", "media.render": "PLAN_STEP", "media.variant": "PLAN_STEP",
  "media.qa": "PLAN_STEP", "capture.browser": "PLAN_STEP", "capture.obs": "PLAN_STEP", "capcut.operate": "PLAN_STEP",
  // M11 delivery steps (derived from the one envelope confirmation): check the verified version, its local preview, bind evidence,
  // write the commercial summary, film the demo preview. Owner decisions (accept, creative approval, rights) stay unknown → SENSITIVE.
  "delivery.verify": "PLAN_STEP", "delivery.preview": "PLAN_STEP", "delivery.bind": "PLAN_STEP", "delivery.summary": "PLAN_STEP", "capture.preview": "PLAN_STEP",
  // Stage before M12: Word / Excel opened by the Hub (own invisible instance, read-only) to verify a file the plan generated.
  "office.verify": "PLAN_STEP",
  // M12 Sales preparation (one owner-confirmed plan; the contact draft and the dossier derived from it after the owner's approval of
  // the exact offer): synthetic client, fixture research, q-v2 qualification, the offer up to review, the draft, „Dosarul ofertei”.
  // The owner's decisions (offer approval, qualification override), the hand-off, sending and deletion are NOT operations: unknown
  // → SENSITIVE → a plan that names them is refused.
  "sales.synthetic": "PLAN_STEP", "sales.research": "PLAN_STEP", "sales.qualify": "PLAN_STEP", "sales.proposal.draft": "PLAN_STEP", "sales.draft": "PLAN_STEP", "sales.dossier": "PLAN_STEP",
  // M13 „Birou intern”: the internal start dossier, the support case and its draft reply, the deviz in draft, and their local exports
  // (one owner-confirmed card each; the exports of the reply and the deviz derived after the owner's approval of the exact text).
  "desk.ops.record": "PLAN_STEP", "desk.ops.export": "PLAN_STEP", "desk.support.case": "PLAN_STEP", "desk.support.reply": "PLAN_STEP", "desk.support.export": "PLAN_STEP",
  "desk.finance.document": "PLAN_STEP", "desk.finance.export": "PLAN_STEP",
  "access.newApp": "SENSITIVE", "access.newFolder": "SENSITIVE", "model.run": "SENSITIVE", "file.overwrite": "SENSITIVE", "capture.live.enable": "SENSITIVE",
  publish: "REFUSED", upload: "REFUSED", send: "REFUSED", purchase: "REFUSED", "delete.external": "REFUSED", "hub.admin": "REFUSED", "shell.exec": "REFUSED",
});

/** Processes the operator never observes, focuses or types into (credential stores, secure desktop, consent / sign-in dialogs). */
export const PROTECTED_PROCESSES = Object.freeze(["consent.exe", "credentialuibroker.exe", "logonui.exe", "lockapp.exe", "securityhealthsystray.exe", "windowsdefender.exe",
  "1password.exe", "keepass.exe", "keepassxc.exe", "bitwarden.exe", "lastpass.exe", "dashlane.exe", "authy desktop.exe", "taskmgr.exe", "regedit.exe",
  "mmc.exe", "cmd.exe", "powershell.exe", "pwsh.exe", "windowsterminal.exe", "wt.exe", "conhost.exe", "openconsole.exe", "wsl.exe", "bash.exe"]);

/**
 * Control names whose activation is an external, destructive or paying effect (Romanian + English). Matched on the name folded to ASCII
 * (diacritics removed): JavaScript's \b is ASCII-only, so "Postează" or "Șterge" would otherwise slip past the word boundaries.
 */
const SENSITIVE_CONTROL = /\b(publish|post|share|upload|send|submit|delete|remove|erase|pay|buy|purchase|checkout|subscribe|upgrade|sign\s*in|log\s*in|publica|posteaza|distribuie|incarca|trimite|sterge|elimina|plateste|cumpara|aboneaza|autentifica|conecteaza|export\s+to\s+(tiktok|youtube|instagram|x|facebook))\b/;
const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** File types that execute or carry macros: opening one is never a trivial "open". */
const ACTIVE_FILE = /\.(exe|com|bat|cmd|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|msi|msp|scr|pif|lnk|url|hta|cpl|reg|jar|docm|dotm|xlsm|xltm|xlsb|pptm|potm|ppsm|sldm|accdb|mdb)$/i;
/** Names that look like secrets: never opened, saved over, imported or shown through the GUI either. */
const SECRET_NAME = /(^|[\\/])(\.env(\.[^\\/]*)?|id_rsa|id_ed25519|.*\.pem|.*\.key|.*\.pfx|.*\.p12|credentials(\.json)?|auth\.json|token(s)?\.json|secrets?(\.[a-z]+)?|.*\.kdbx)$/i;

export const isSensitiveControlName = (name) => SENSITIVE_CONTROL.test(fold(name));
export const isActiveFile = (p) => ACTIVE_FILE.test(String(p || ""));
export const isSecretPath = (p) => SECRET_NAME.test(String(p || "").replace(/\\/g, "/"));
// The helper reports process names without the extension ("consent"); the list is kept with it for readability.
const PROTECTED_BASE = new Set(PROTECTED_PROCESSES.map((p) => p.replace(/\.exe$/i, "")));
export const isProtectedProcess = (name) => PROTECTED_BASE.has(String(name || "").toLowerCase().replace(/\.exe$/i, ""));

/**
 * `insideAny(paths, p)` with case-insensitive comparison on Windows; `p` and the roots must already be real paths (the caller resolves
 * links and junctions first — a textual check alone is not enough).
 */
export function insideAny(roots, p) {
  const norm = (x) => (process.platform === "win32" ? path.resolve(x).toLowerCase() : path.resolve(x));
  const target = norm(p);
  return (roots || []).some((r) => { const root = norm(r); const rel = path.relative(root, target); return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel)); });
}

/**
 * The class of one action. `ctx`: { app: registry entry | null, path, destination, overwrite, controlName, allowedFolders[], forbiddenFolders[],
 * liveCapture: boolean, processName }. Returns { class, op, reasons[] } — the strictest class any rule produces.
 */
export function classifyAction(op, ctx = {}) {
  const reasons = [];
  let cls = OPERATIONS[op] || "SENSITIVE";
  if (!OPERATIONS[op]) reasons.push(`operație necunoscută „${op}”: tratată ca schimbare sensibilă`);
  const raise = (to, why) => { if (ACTION_CLASSES.indexOf(to) > ACTION_CLASSES.indexOf(cls)) cls = to; reasons.push(why); };
  if (ctx.processName && isProtectedProcess(ctx.processName)) raise("REFUSED", `${ctx.processName} e o aplicație protejată (credențiale, consolă sau dialog de sistem)`);
  if (["app.launch", "app.focus", "desktop.observe", "ui.setText", "ui.type", "ui.invoke", "ui.keys", "ui.select", "file.open", "file.saveAs", "capcut.operate", "window.move"].includes(op)) {
    if (!ctx.app) raise("SENSITIVE", "aplicația nu e în registrul Hub-ului (acces nou)");
    else if (ctx.app.privileged) raise("REFUSED", `${ctx.app.displayName} e o aplicație privilegiată`);
    else if (!ctx.app.authorized) raise("SENSITIVE", `${ctx.app.displayName} nu e autorizată încă pentru operator (acces nou la aplicație)`);
  }
  if (op === "ui.invoke" && isSensitiveControlName(ctx.controlName)) raise("REFUSED", `butonul „${String(ctx.controlName).slice(0, 40)}” are un efect extern, destructiv sau de plată`);
  for (const p of [ctx.path, ctx.destination].filter(Boolean)) {
    if (isSecretPath(p)) raise("REFUSED", "fișier de tip secret (cheie, token, .env)");
    if (ctx.forbiddenFolders?.length && insideAny(ctx.forbiddenFolders, p)) raise("REFUSED", "în datele Hub-ului, repo sau alt folder protejat");
    if (ctx.allowedFolders && !insideAny(ctx.allowedFolders, p)) raise("SENSITIVE", "în afara folderelor aprobate (acces nou la folder)");
  }
  if (["file.open", "folder.show"].includes(op) && isActiveFile(ctx.path)) raise("SENSITIVE", "fișier executabil sau cu macro-uri: deschiderea nu e o acțiune banală");
  if (ctx.overwrite) raise("SENSITIVE", "ar suprascrie un fișier existent");
  if (["capture.obs"].includes(op) && ctx.liveCapture !== true) raise("SENSITIVE", "captura ecranului real cere politica de captură live (MB1)");
  return { class: cls, op, reasons };
}
