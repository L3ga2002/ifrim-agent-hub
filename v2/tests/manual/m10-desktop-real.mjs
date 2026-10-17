// M10 Desktop Operator against the REAL helper and the REAL desktop (manual tool, not part of the suite; Windows only).
// Builds the helper from source into a temp folder (manifest bound to the source), starts it as the current user (no admin) and:
//   --discover                read-only: the catalog's apps from the standard sources + their Authenticode signer (nothing opened)
//   --open <app> --watching   D1: open / reuse the app's window and bring it forward (verified); nothing typed, nothing clicked
//   --capcut-inspect --watching  D6 (inspect only): open/focus CapCut and read its window structure (no values, nothing clicked)
//   --notepad --watching      D2: a SYNTHETIC file in a temp folder → open in Notepad → precondition → type Romanian text → verify →
//                             Save As (a new file, never an overwrite) → verify on disk → move + re-identify the window
// GUI modes need --watching (you are at the computer: your keyboard/mouse stops the helper at once; Stop = Ctrl+C here).
// No Hub database, no model, no network; the policy (action-policy.mjs) is applied to every operation like in the Hub.
//   node v2/tests/manual/m10-desktop-real.mjs --discover
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildOperator } from "../../scripts/build-operator.mjs";
import { createOperatorClient } from "../../server/desktop/operator-client.mjs";
import { createSupervisor } from "../../server/runtime/supervisor.mjs";
import { loadCatalog } from "../../server/desktop/apps.mjs";
import { classifyAction } from "../../server/policy/action-policy.mjs";
import { notepadEditSave, capcutInspect } from "../../server/desktop/profiles.mjs";

const V2 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const valueOf = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
if (process.platform !== "win32") { console.error("Doar pe Windows."); process.exit(1); }
if ((has("--open") || has("--notepad") || has("--capcut-inspect")) && !has("--watching")) { console.error("Modurile cu interfață cer --watching (ești la calculator; tastatura/mouse-ul tău opresc helperul)."); process.exit(2); }

const work = fs.mkdtempSync(path.join(os.tmpdir(), "ifrim-m10-desktop-"));
const manifest = buildOperator(path.join(work, "desktop"));
console.log(JSON.stringify({ helper: manifest.exe, sha256: manifest.sha256.slice(0, 16), sourceSha256: manifest.sourceSha256.slice(0, 16) }));
const config = { testMode: false, desktop: { operatorExe: manifest.exe, launcher: null } };
const supervisor = createSupervisor({ config });
const client = createOperatorClient({ config, supervisor, onEvent: (e) => { if (e.type !== "desktop.operator.started") console.log("[event]", JSON.stringify(e)); } });
const catalog = loadCatalog(V2);
const exp = () => new Date(Date.now() + 120000).toISOString();

async function discover() {
  const candidates = catalog.map((a) => ({ id: a.id, appPaths: a.discover?.appPaths || [], startMenu: a.discover?.startMenu || [], knownPaths: a.discover?.knownPaths || [], versionedDir: a.discover?.versionedDir || null, versionedExe: a.discover?.versionedExe || null }));
  const res = await client.request("discoverApps", { candidates, timeoutMs: 30000 }, { plan: "discovery", step: "discover", apps: [], exp: exp() });
  return res.apps.map((d) => {
    const cat = catalog.find((c) => c.id === d.id);
    const verified = (d.found || []).find((f) => f.signed && f.trusted && String(f.signer || "").toLowerCase().includes(cat.publisher.toLowerCase()));
    return { id: d.id, status: !(d.found || []).length ? "NOT_FOUND" : verified ? "DISCOVERED" : "INSTALLED", found: (d.found || []).map((f) => ({ path: f.path, source: f.source, version: f.fileVersion || f.productVersion, signer: String(f.signer || "").split(",")[0], trusted: f.trusted })) };
  });
}

/** The operator gate in miniature: policy class first (REFUSED / SENSITIVE stop), then the signed request with a short authority. */
function gate(app, { allowedFolders = [] } = {}) {
  const entry = { ...app, authorized: true, privileged: false };
  return async (action) => {
    const v = classifyAction(action.op, { app: entry, path: action.path, destination: action.destination, overwrite: Boolean(action.overwrite), controlName: action.controlName,
      allowedFolders: action.path || action.destination ? allowedFolders : undefined, forbiddenFolders: [V2, path.join(os.homedir(), ".codex"), path.join(os.homedir(), ".claude")] });
    if (v.class === "REFUSED" || v.class === "SENSITIVE") throw new Error(`Politica oprește ${action.op}: ${v.reasons.join("; ")}`);
    const r = await client.request(action.helperOp, action.args || {}, { plan: "manual", step: action.op, apps: app.processNames, exp: exp() });
    console.log("[op]", action.op, action.helperOp, JSON.stringify(r).slice(0, 160));
    return r;
  };
}

try {
  await client.start({ session: "manual" });
  const state = await client.request("desktopState", {});
  console.log(JSON.stringify({ desktop: state }));
  const apps = await discover();
  console.log(JSON.stringify({ discovered: apps }, null, 2));
  if (has("--open")) {
    const id = valueOf("--open");
    const d = apps.find((a) => a.id === id);
    if (!d || d.status !== "DISCOVERED") throw new Error(`${id}: ${d?.status || "necunoscută"} — nu o deschid (identitate neverificată).`);
    const cat = catalog.find((c) => c.id === id);
    const exe = d.found.sort((a, b) => (b.source === "versioned_dir") - (a.source === "versioned_dir"))[0].path;
    const app = { ...cat, exePath: exe, launch: { ...cat.launch, exe } };
    const run = gate(app);
    const before = (await run({ op: "app.focus", helperOp: "listWindows", args: { processNames: app.processNames } })).windows.filter((w) => w.visible);
    if (!before.length) await run({ op: "app.launch", helperOp: "launch", args: app.launch.kind === "aumid" ? { kind: "aumid", aumid: app.launch.aumid } : { kind: app.launch.kind, exe } });
    const win = before.length ? before.at(-1) : (await run({ op: "app.focus", helperOp: "waitWindow", args: { processNames: app.processNames, timeoutMs: 45000, excludeHwnds: before.map((w) => w.hwnd) } })).window;
    const f = await run({ op: "app.focus", helperOp: "focus", args: { hwnd: win.hwnd } });
    console.log(JSON.stringify({ D1: { app: id, launched: !before.length, window: { hwnd: win.hwnd, pid: win.pid, title: String(win.title).slice(0, 60) }, foreground: f.foreground } }));
  }
  if (has("--capcut-inspect")) {
    const d = apps.find((a) => a.id === "capcut");
    if (!d || d.status !== "DISCOVERED") throw new Error(`CapCut: ${d?.status || "negăsit"}`);
    const cat = catalog.find((c) => c.id === "capcut");
    const exe = d.found.sort((a, b) => (b.source === "versioned_dir") - (a.source === "versioned_dir"))[0].path;
    const r = await capcutInspect(gate({ ...cat, exePath: exe, launch: { ...cat.launch, exe } }), { app: { ...cat, exePath: exe, launch: { ...cat.launch, exe } } });
    console.log(JSON.stringify({ D6: { verdict: r.verdict, nodes: r.nodes, truncated: r.truncated, byType: r.byType, invokable: r.invokable.slice(0, 25) } }, null, 2));
  }
  if (has("--notepad")) {
    const d = apps.find((a) => a.id === "notepad");
    if (!d || d.status !== "DISCOVERED") throw new Error(`Notepad: ${d?.status || "negăsit"}`);
    const cat = catalog.find((c) => c.id === "notepad");
    const dir = path.join(work, "lucru-notepad");
    fs.mkdirSync(dir, { recursive: true });
    const src = path.join(dir, "nota-test-m10.txt");
    fs.writeFileSync(src, "Fișier de test M10 (sintetic).\n", "utf8");
    const saveAs = path.join(dir, `nota-salvata-${Date.now().toString(36)}.txt`);
    const r = await notepadEditSave(gate(cat, { allowedFolders: [dir] }), { app: cat, sourceFile: src, text: "Știință, țară, înțelegere — ăâîșț ĂÂÎȘȚ. Scris de operatorul Hub-ului (M10).", mode: "append", saveAs });
    console.log(JSON.stringify({ D2: { file: r.file, bytes: r.bytes, sha256: r.sha256.slice(0, 16), typedChars: r.typedChars, evidence: r.evidence.map((e) => e.step) } }));
    console.log("Notepad rămâne deschis (nimic nu se închide forțat). Fișierele de test sunt în", dir);
  }
} catch (error) {
  console.error("EROARE:", error.code || "", error.message);
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
  supervisor.stopAll?.();
}
