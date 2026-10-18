import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildDocx, expectedDocxShape } from "./docx.mjs";
import { buildXlsx, formulaCells } from "./xlsx.mjs";
import { unzip } from "./zip.mjs";

/**
 * Office documents (the stage before M12): the Hub GENERATES .docx/.xlsx itself (reproducible, no model) and VERIFIES them in three
 * separate levels, never merged:
 *  - FILE_CHECKED: the saved file is read back (ZIP + XML): headings, tables, rows, formulas, filter, the declared-demo note;
 *  - APP_VERIFIED: the real application (Word / Excel through COM, an own invisible instance, read-only) opens it, reports its structure,
 *    recalculates the formulas with Excel's own engine (values compared with the expected ones) and exports a PDF of the layout;
 *  - OPENED_FOR_OWNER: the file is opened in the application on the desktop (a separate capability: "opening" is not "using").
 * Writing a file is never reported as "Word control verified".
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const COM_SCRIPT = path.join(HERE, "office-com.ps1");
const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

export const OFFICE_APPS = Object.freeze({ docx: { id: "word", exe: "winword.exe", name: "Microsoft Word" }, xlsx: { id: "excel", exe: "excel.exe", name: "Microsoft Excel" } });

/** The executable registered for an Office app (App Paths, HKLM then HKCU), or null. Windows only. */
export function officeExe(kind) {
  const app = OFFICE_APPS[kind];
  if (!app || process.platform !== "win32") return null;
  for (const hive of ["HKLM", "HKCU"]) {
    try {
      const outp = execFileSync("reg.exe", ["query", `${hive}\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${app.exe}`, "/ve"], { encoding: "utf8", windowsHide: true, timeout: 5000 });
      const m = outp.match(/REG_SZ\s+(.+)\s*$/m);
      if (m && fs.existsSync(m[1].trim().replace(/^"|"$/g, ""))) return m[1].trim().replace(/^"|"$/g, "");
    } catch { /* next hive */ }
  }
  return null;
}

/** Writes a file without ever overwriting: an existing name gets " (2)", " (3)"… */
export function freePath(dir, name) {
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  let p = path.join(dir, name);
  for (let i = 2; fs.existsSync(p); i += 1) p = path.join(dir, `${base} (${i})${ext}`);
  return p;
}

function writeAtomic(file, buf) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(3).toString("hex")}.tmp`;
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, file);
}

// ---------------------------------------------------------------- generation
export function generateDocx(model, { dir, fileName, created = new Date() }) {
  const buf = buildDocx(model, { created });
  const file = freePath(dir, fileName);
  writeAtomic(file, buf);
  return { file, bytes: buf.length, sha256: sha(buf), shape: expectedDocxShape(model) };
}

export function generateXlsx(model, { dir, fileName, created = new Date() }) {
  const buf = buildXlsx(model, { created });
  const file = freePath(dir, fileName);
  writeAtomic(file, buf);
  return { file, bytes: buf.length, sha256: sha(buf), formulas: formulaCells(model) };
}

// ---------------------------------------------------------------- level 1: the file read back
const xmlText = (s) => s.replace(/<[^>]+>/g, "");

export function checkDocxFile(file, expected) {
  const parts = unzip(fs.readFileSync(file));
  const doc = parts.get("word/document.xml")?.toString("utf8");
  const problems = [];
  if (!doc) return { ok: false, problems: ["lipsește word/document.xml"] };
  if (!parts.get("word/styles.xml")) problems.push("lipsește word/styles.xml");
  const paras = doc.match(/<w:p>[\s\S]*?<\/w:p>/g) || [];
  const headings = paras.filter((p) => /w:pStyle w:val="Heading[12]"/.test(p)).map((p) => xmlText(p).trim());
  const tables = (doc.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g) || []).map((t) => ({ rows: (t.match(/<w:tr>/g) || []).length }));
  if (expected) {
    if (JSON.stringify(headings) !== JSON.stringify(expected.headings)) problems.push(`titlurile diferă (${headings.length} găsite, ${expected.headings.length} așteptate)`);
    if (tables.length !== expected.tables.length) problems.push(`tabele: ${tables.length} găsite, ${expected.tables.length} așteptate`);
    expected.tables.forEach((t, i) => { if (tables[i] && tables[i].rows !== t.rows) problems.push(`tabelul ${i + 1}: ${tables[i].rows} rânduri, ${t.rows} așteptate`); });
  }
  return { ok: problems.length === 0, level: "FILE_CHECKED", headings, tables, paragraphs: paras.length, problems };
}

export function checkXlsxFile(file, { formulas = [], sheets = [] } = {}) {
  const parts = unzip(fs.readFileSync(file));
  const wb = parts.get("xl/workbook.xml")?.toString("utf8") || "";
  const problems = [];
  if (!/fullCalcOnLoad="1"/.test(wb)) problems.push("registrul nu cere recalcularea la deschidere");
  const found = [];
  sheets.forEach((s, i) => {
    const xml = parts.get(`xl/worksheets/sheet${i + 1}.xml`)?.toString("utf8") || "";
    if (!xml) { problems.push(`lipsește foaia ${s.name}`); return; }
    if (s.autoFilter !== false && !/<autoFilter ref=/.test(xml)) problems.push(`foaia ${s.name} nu are filtru`);
    for (const m of xml.matchAll(/<c r="([A-Z]+\d+)"[^>]*><f>([^<]*)<\/f>/g)) found.push({ sheet: s.name, ref: m[1], formula: m[2].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"') });
  });
  for (const f of formulas) if (!found.some((x) => x.sheet === f.sheet && x.ref === f.ref && x.formula === f.formula)) problems.push(`formula ${f.sheet}!${f.ref} lipsește`);
  return { ok: problems.length === 0, level: "FILE_CHECKED", formulas: found.length, problems };
}

// ---------------------------------------------------------------- level 2: the real application
/** Runs the COM check (own invisible instance; killed after `timeoutMs`). Resolves { ok, …report } or { ok:false, error }. */
export function runComCheck(args, { timeoutMs = 180000, workDir = os.tmpdir() } = {}) {
  return new Promise((resolve) => {
    fs.mkdirSync(workDir, { recursive: true });
    const argFile = path.join(workDir, `office-com-${process.pid}-${crypto.randomBytes(4).toString("hex")}.json`);
    fs.writeFileSync(argFile, JSON.stringify(args), "utf8");
    // No execution-policy override: the owner's policy (CurrentUser Unrestricted on this machine) decides; a stricter one fails visibly.
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-File", COM_SCRIPT, "-ArgsFile", argFile], { windowsHide: true });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    const started = Date.now();
    const timer = setTimeout(() => { try { execFileSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true }); } catch { /* already gone */ } }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      try { fs.rmSync(argFile, { force: true }); } catch { /* temp */ }
      const line = stdout.trim().split(/\r?\n/).filter(Boolean).pop() || "";
      let report = null;
      try { report = JSON.parse(line); } catch { report = null; }
      if (!report) return resolve({ ok: false, error: `Verificarea în aplicație nu a răspuns (cod ${code}${Date.now() - started >= timeoutMs ? ", timp depășit" : ""}): ${stderr.trim().slice(0, 300)}`, durationMs: Date.now() - started });
      resolve({ ...report, durationMs: Date.now() - started });
    });
  });
}

export async function verifyDocxInWord(file, expected, { pdfOut = null, timeoutMs, workDir } = {}) {
  const r = await runComCheck({ kind: "docx", path: file, pdfOut }, { timeoutMs, workDir });
  if (!r.ok) return { ok: false, level: "APP_FAILED", error: r.error, durationMs: r.durationMs };
  const problems = [];
  const heads = (r.headings || []).map((h) => h[1]);
  if (expected && JSON.stringify(heads) !== JSON.stringify(expected.headings)) problems.push(`Word vede alte titluri (${heads.length} față de ${expected.headings.length})`);
  if (expected && (r.tables || []).length !== expected.tables.length) problems.push(`Word vede ${(r.tables || []).length} tabele, ${expected.tables.length} așteptate`);
  (expected?.tables || []).forEach((t, i) => {
    const w = (r.tables || [])[i];
    if (w && (w.rows !== t.rows || w.cols !== t.cols)) problems.push(`tabelul ${i + 1} în Word: ${w.rows}×${w.cols}, așteptat ${t.rows}×${t.cols}`);
    if (w && !w.headerRepeats) problems.push(`tabelul ${i + 1}: antetul nu se repetă pe pagini noi`);
  });
  if (expected && r.listParagraphs < expected.bullets) problems.push(`Word vede ${r.listParagraphs} elemente de listă, ${expected.bullets} așteptate`);
  if (pdfOut && !(fs.existsSync(pdfOut) && fs.statSync(pdfOut).size > 1000)) problems.push("exportul PDF din Word lipsește");
  return { ok: problems.length === 0, level: problems.length ? "APP_MISMATCH" : "APP_VERIFIED", app: r.app, version: r.version, pages: r.pages, words: r.words, paragraphs: r.paragraphs,
    headings: heads, tables: r.tables, pdf: pdfOut && fs.existsSync(pdfOut) ? pdfOut : null, problems, durationMs: r.durationMs };
}

/** `expect`: [{ sheet, ref, value }] — the values the formulas must give (Excel's engine decides, compared within 1e-9). */
export async function verifyXlsxInExcel(file, expect, { pdfOut = null, timeoutMs, workDir } = {}) {
  const r = await runComCheck({ kind: "xlsx", path: file, pdfOut, cells: expect.map((e) => ({ sheet: e.sheet, ref: e.ref })) }, { timeoutMs, workDir });
  if (!r.ok) return { ok: false, level: "APP_FAILED", error: r.error, durationMs: r.durationMs };
  const problems = [];
  const cells = (r.cells || []).map((c, i) => {
    const want = expect[i];
    const got = typeof c.value === "number" ? c.value : Number(c.value);
    const okv = !c.error && c.hasFormula && Number.isFinite(got) && Math.abs(got - want.value) <= 1e-9 * Math.max(1, Math.abs(want.value));
    if (!okv) problems.push(`${want.sheet}!${want.ref}: Excel dă ${c.error || c.text || c.value}, așteptat ${want.value}${c.hasFormula ? "" : " (nu e formulă)"}`);
    return { sheet: want.sheet, ref: want.ref, formula: c.formula, value: got, text: c.text, expected: want.value, ok: okv };
  });
  for (const s of r.sheets || []) if (!s.autoFilter && s.name !== "Note") problems.push(`foaia ${s.name}: filtrul automat nu e activ în Excel`);
  return { ok: problems.length === 0, level: problems.length ? "APP_MISMATCH" : "APP_VERIFIED", app: r.app, version: r.version, sheets: r.sheets, cells,
    pdf: pdfOut && fs.existsSync(pdfOut) ? pdfOut : null, problems, durationMs: r.durationMs };
}

// ---------------------------------------------------------------- level 3: opened for the owner
/** Opens the file in the registered application on the desktop (a new window; nothing typed into it). Returns the pid. */
export function openForOwner(file, kind) {
  const exe = officeExe(kind);
  if (!exe) return { opened: false, reason: `${OFFICE_APPS[kind]?.name || kind} nu este instalat (App Paths)` };
  const child = spawn(exe, [file], { detached: true, stdio: "ignore", windowsHide: false });
  child.unref();
  return { opened: true, exe, pid: child.pid };
}
