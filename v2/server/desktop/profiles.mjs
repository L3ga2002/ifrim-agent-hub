// M10 app profiles: plan steps as observe → act → verify sequences on STRUCTURAL selectors (UI Automation control type, automation id,
// class, name pattern) — never fixed coordinates. Each step checks a precondition before acting and a postcondition after; a step
// whose result cannot be read back is reported as uncertain, never as done.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { HubError } from "../core/errors.mjs";

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const norm = (s) => String(s || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const fail = (code, message, data = {}) => new HubError("conflict", message, { code, data });

/** Finds the first node of an observation matching a selector (same semantics as the helper's selector). */
export function pick(nodes, sel) {
  return (nodes || []).find((n) => (!sel.controlType || String(n.controlType).toLowerCase() === sel.controlType.toLowerCase())
    && (!sel.automationId || n.automationId === sel.automationId) && (!sel.className || n.className === sel.className)
    && (!sel.name || n.name === sel.name) && (!sel.nameRegex || new RegExp(sel.nameRegex, "i").test(n.name || ""))) || null;
}

/**
 * D2 — Notepad: open a synthetic file, check the tab is that file with its exact content, type Romanian text (diacritics), verify the
 * document, Save As into an approved folder (never over an existing file), verify the file on disk, then move/resize the window and
 * re-identify it (process + start time + structure, not title or coordinates). `run(action)` is the operator gate bound to the plan step.
 */
export async function notepadEditSave(run, { app, sourceFile, text, mode = "append", saveAs, moveTo = { x: 160, y: 120, w: 980, h: 720 } }) {
  const evidence = [];
  if (!fs.existsSync(sourceFile)) throw fail("PRECONDITION_FAILED", "Fișierul de lucru nu există.");
  if (fs.existsSync(saveAs)) throw new HubError("policy", "Destinația există deja: nu suprascriu un fișier (alege alt nume).", { code: "NEEDS_DECISION" });
  const initial = norm(fs.readFileSync(sourceFile, "utf8"));
  const base = path.basename(sourceFile);
  // 1. open the file in its own tab (the file is the argument: never a guess about which tab is active)
  await run({ op: "app.launch", helperOp: "launch", appId: app.id, path: sourceFile, args: { kind: "aumid", aumid: app.launch.aumid, arguments: `"${sourceFile}"` } });
  const win = (await run({ op: "app.focus", helperOp: "waitWindow", appId: app.id, args: { processNames: app.processNames, titleRegex: escapeRe(base), timeoutMs: 20000 } })).window;
  const id = { hwnd: win.hwnd, pid: win.pid, procStart: win.procStart };
  evidence.push({ step: "window", title: String(win.title).slice(0, 80), pid: win.pid });
  // 2. precondition: the active document holds exactly the file's content
  const obs = await run({ op: "desktop.observe", helperOp: "observe", appId: app.id, args: { ...id, maxNodes: 300 } });
  const doc = pick(obs.nodes, { controlType: "Document" }) || pick(obs.nodes, { controlType: "Edit" });
  if (!doc) throw fail("ELEMENT_NOT_FOUND", "Nu găsesc zona de text a documentului (interfața Notepad s-a schimbat?).");
  const before = norm((await run({ op: "desktop.observe", helperOp: "getText", appId: app.id, args: { ...id, ref: doc.ref } })).text);
  if (before.replace(/\n$/, "") !== initial.replace(/\n$/, "")) throw fail("PRECONDITION_FAILED", "Fila activă nu are conținutul fișierului de lucru; nu tastez nimic.", { expectedChars: initial.length, foundChars: before.length });
  evidence.push({ step: "precondition", chars: before.length, sha: sha(before).slice(0, 16) });
  // 3. focus + type (the helper types only into the verified foreground window)
  const f = await run({ op: "app.focus", helperOp: "focus", appId: app.id, args: { hwnd: win.hwnd } });
  if (!f.foreground) throw fail("NOT_FOREGROUND", "Notepad nu a putut fi adus în prim-plan; nu tastez.");
  await run({ op: "ui.setText", helperOp: "setFocus", appId: app.id, args: { ...id, ref: doc.ref } });
  if (mode === "replace") await run({ op: "ui.keys", helperOp: "keys", appId: app.id, args: { hwnd: win.hwnd, combo: "ctrl+a" } });
  else await run({ op: "ui.keys", helperOp: "keys", appId: app.id, args: { hwnd: win.hwnd, combo: "ctrl+end" } }).catch(() => null);
  await run({ op: "ui.type", helperOp: "typeText", appId: app.id, args: { hwnd: win.hwnd, text, timeoutMs: 60000 } });
  const expected = mode === "replace" ? norm(text) : initial + norm(text);
  const after = norm((await run({ op: "desktop.observe", helperOp: "getText", appId: app.id, args: { ...id, ref: doc.ref } })).text);
  if (after.replace(/\n$/, "") !== expected.replace(/\n$/, "")) throw fail("POSTCONDITION_FAILED", "Textul din document nu e cel tastat (o tastă pierdută sau altă fereastră).", { expectedChars: expected.length, foundChars: after.length });
  evidence.push({ step: "typed", chars: norm(text).length, documentSha: sha(after).slice(0, 16) });
  // 4. Save As into the approved folder
  await run({ op: "ui.keys", helperOp: "keys", appId: app.id, args: { hwnd: win.hwnd, combo: "ctrl+shift+s" } });
  const dialog = (await run({ op: "file.saveAs", helperOp: "waitWindow", appId: app.id, destination: saveAs, args: { processNames: app.processNames, className: "#32770", timeoutMs: 15000 } })).window;
  if (dialog.owner && dialog.owner !== win.hwnd) throw fail("IDENTITY_CHANGED", "Dialogul de salvare nu aparține ferestrei verificate.");
  await run({ op: "file.saveAs", helperOp: "setValue", appId: app.id, destination: saveAs, args: { hwnd: dialog.hwnd, selector: { automationId: "1001" }, text: saveAs } });
  const saveBtn = await run({ op: "ui.invoke", helperOp: "invoke", appId: app.id, controlName: "Save", args: { hwnd: dialog.hwnd, selector: { automationId: "1" } } });
  if (saveBtn.confirmOpened) throw fail("POSTCONDITION_FAILED", "Windows cere confirmarea suprascrierii; nu confirm (destinația a apărut între timp).");
  // 5. postcondition on disk: the file exists with exactly the document's content
  let saved = null;
  for (let i = 0; i < 40 && !saved; i += 1) { if (fs.existsSync(saveAs)) saved = fs.readFileSync(saveAs); else await new Promise((r) => setTimeout(r, 150)); }
  if (!saved) throw fail("POSTCONDITION_FAILED", "Fișierul salvat nu a apărut pe disc.");
  const savedText = norm(saved.toString("utf8").replace(/^﻿/, ""));
  if (savedText.replace(/\n$/, "") !== expected.replace(/\n$/, "")) throw fail("POSTCONDITION_FAILED", "Fișierul salvat nu are conținutul documentului.");
  evidence.push({ step: "saved", file: saveAs, bytes: saved.length, sha256: sha(saved) });
  // 6. move/resize, then re-identify by process + start time + structure (never by title or old coordinates)
  const moved = (await run({ op: "window.move", helperOp: "move", appId: app.id, args: { ...id, ...moveTo } })).window;
  const again = (await run({ op: "app.focus", helperOp: "listWindows", appId: app.id, args: { processNames: app.processNames } })).windows.find((w) => w.hwnd === win.hwnd);
  if (!again || again.pid !== win.pid || again.procStart !== win.procStart) throw fail("IDENTITY_CHANGED", "După mutare fereastra nu mai e aceeași (proces sau pornire diferită).");
  const reobs = await run({ op: "desktop.observe", helperOp: "observe", appId: app.id, args: { ...id, maxNodes: 300 } });
  const doc2 = pick(reobs.nodes, { controlType: "Document" }) || pick(reobs.nodes, { controlType: "Edit" });
  if (!doc2) throw fail("ELEMENT_NOT_FOUND", "După mutare nu mai găsesc documentul structural.");
  evidence.push({ step: "moved", rect: moved.rect, sameProcess: true, documentFound: true, title: String(again.title).slice(0, 80) });
  return { file: saveAs, sha256: sha(saved), bytes: saved.length, typedChars: norm(text).length, window: { ...id, rect: moved.rect }, evidence };
}

/**
 * D6 — CapCut, inspect only: open/focus, read the structural tree (bounded, no values), and report which controls are reachable through
 * UI Automation. The capability verdict is evidence: GUI operations are declared only for controls actually exposed with a pattern.
 */
export async function capcutInspect(run, { app }) {
  const list = (await run({ op: "app.focus", helperOp: "listWindows", appId: app.id, args: { processNames: app.processNames } })).windows || [];
  let win = list.filter((w) => w.visible).at(-1);
  if (!win) {
    await run({ op: "app.launch", helperOp: "launch", appId: app.id, args: { kind: "exe", exe: app.launch.exe || app.exePath } });
    win = (await run({ op: "app.focus", helperOp: "waitWindow", appId: app.id, args: { processNames: app.processNames, timeoutMs: 45000 } })).window;
  }
  const id = { hwnd: win.hwnd, pid: win.pid, procStart: win.procStart };
  const obs = await run({ op: "desktop.observe", helperOp: "observe", appId: app.id, args: { ...id, maxNodes: 600, maxDepth: 14 } });
  const byType = {};
  for (const n of obs.nodes || []) byType[n.controlType] = (byType[n.controlType] || 0) + 1;
  const invokable = (obs.nodes || []).filter((n) => (n.patterns || []).some((p) => ["Invoke", "Toggle", "SelectionItem", "ExpandCollapse"].includes(p)) && n.name).map((n) => ({ name: n.name, controlType: n.controlType }));
  const verdict = invokable.length >= 3 ? "STRUCTURAL_CONTROLS" : (obs.nodes || []).length <= 5 ? "CANVAS_ONLY" : "LIMITED";
  return { window: { ...id, title: String(win.title).slice(0, 80) }, nodes: (obs.nodes || []).length, truncated: obs.truncated, byType, invokable: invokable.slice(0, 40), verdict };
}

/**
 * D6 — CapCut: create a NEW local test project and import one synthetic file, if (and only if) the controls are structurally exposed.
 * Every name pattern is a candidate (English / Romanian UI); a step that does not find its control stops with the exact assisted step.
 */
export async function capcutNewProjectImport(run, { app, file }) {
  const insp = await capcutInspect(run, { app });
  const id = { hwnd: insp.window.hwnd, pid: insp.window.pid, procStart: insp.window.procStart };
  const steps = [];
  const tryInvoke = async (label, nameRegex) => {
    const found = (await run({ op: "desktop.observe", helperOp: "find", appId: app.id, args: { ...id, selector: { nameRegex }, max: 3 } })).elements || [];
    if (!found.length) { steps.push({ step: label, ok: false, assisted: `Apasă tu „${label}” în CapCut (controlul nu e expus prin UI Automation).` }); return null; }
    const r = await run({ op: "ui.invoke", helperOp: "invoke", appId: app.id, controlName: found[0].name, args: { ...id, ref: found[0].ref } });
    steps.push({ step: label, ok: true, how: r.how, control: found[0].name });
    return r;
  };
  if (!(await tryInvoke("Proiect nou", "^(create project|new project|proiect nou|creează proiect|start creating)"))) return { ...insp, steps, completed: false };
  if (!(await tryInvoke("Import", "^(import|importă)$"))) return { ...insp, steps, completed: false };
  const dialog = (await run({ op: "file.open", helperOp: "waitWindow", appId: app.id, path: file, args: { processNames: app.processNames, className: "#32770", timeoutMs: 15000 } }).catch(() => null))?.window;
  if (!dialog) { steps.push({ step: "Dialog import", ok: false, assisted: "Alege tu fișierul de test în dialogul CapCut (dialogul nu a apărut sau nu e standard)." }); return { ...insp, steps, completed: false }; }
  await run({ op: "file.open", helperOp: "setValue", appId: app.id, path: file, args: { hwnd: dialog.hwnd, selector: { automationId: "1148" }, text: file } }).catch(async () =>
    run({ op: "file.open", helperOp: "setValue", appId: app.id, path: file, args: { hwnd: dialog.hwnd, selector: { automationId: "1001" }, text: file } }));
  await run({ op: "ui.invoke", helperOp: "invoke", appId: app.id, controlName: "Open", args: { hwnd: dialog.hwnd, selector: { automationId: "1" } } });
  // postcondition: the media item named like the file appears in the window's structure
  const name = path.basename(file);
  let seen = null;
  for (let i = 0; i < 20 && !seen; i += 1) {
    const f = (await run({ op: "desktop.observe", helperOp: "find", appId: app.id, args: { ...id, selector: { nameRegex: escapeRe(name.replace(/\.[^.]+$/, "")) }, max: 2 } })).elements || [];
    seen = f[0] || null;
    if (!seen) await new Promise((r) => setTimeout(r, 500));
  }
  steps.push({ step: "Verificare import", ok: Boolean(seen), detail: seen ? `„${seen.name}” apare în fereastră` : "materialul nu apare în structura ferestrei (poate fi pe canvas, neexpus)" });
  return { ...insp, steps, completed: Boolean(seen) };
}
