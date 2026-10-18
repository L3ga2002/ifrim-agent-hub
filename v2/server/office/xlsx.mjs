import { zip } from "./zip.mjs";

/**
 * An .xlsx writer (SpreadsheetML, ECMA-376) for the workbooks the Hub prepares: typed columns (text, integer, decimal, percent, date),
 * real formulas (no cached values: the workbook asks for a full calculation on load, so the numbers shown are the engine's, never ours),
 * a styled header, an AutoFilter, a frozen header row, column widths, total rows and a note row.
 *
 * Model: { title?, sheets: [ { name, columns: [{ header, type, width }], rows: [[cell…]], totals?: [[cell…]], notes?: [string], autoFilter?, freeze? } ] }
 * A cell is a string, a number, null, { date: "YYYY-MM-DD" } or { f: "SUM(C2:C9)" } (a formula, written without the leading "=").
 */
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const colName = (i) => { let n = i + 1; let s = ""; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
export const dateSerial = (iso) => { const [y, m, d] = String(iso).split("-").map(Number); return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000); };

const BODY = { text: 2, int: 3, decimal: 4, percent: 5, date: 6, wrap: 12 };
const TOTAL = { text: 7, int: 8, decimal: 9, percent: 10, date: 7, wrap: 7 };

function cellXml(ref, value, style) {
  if (value === null || value === undefined || value === "") return `<c r="${ref}" s="${style}"/>`;
  if (typeof value === "number") return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
  if (typeof value === "object" && value.f) return `<c r="${ref}" s="${style}"><f>${esc(value.f)}</f></c>`;
  if (typeof value === "object" && value.date) return `<c r="${ref}" s="${style}"><v>${dateSerial(value.date)}</v></c>`;
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
}

export function sheetXml(sheet) {
  const cols = sheet.columns || [];
  const rows = [];
  rows.push(`<row r="1" ht="22" customHeight="1">${cols.map((c, i) => cellXml(`${colName(i)}1`, c.header, 1)).join("")}</row>`);
  let r = 2;
  for (const data of sheet.rows || []) {
    rows.push(`<row r="${r}">${cols.map((c, i) => cellXml(`${colName(i)}${r}`, data[i], BODY[c.type] ?? 2)).join("")}</row>`);
    r += 1;
  }
  const lastData = r - 1;
  for (const data of sheet.totals || []) {
    rows.push(`<row r="${r}">${cols.map((c, i) => cellXml(`${colName(i)}${r}`, data[i], TOTAL[c.type] ?? 7)).join("")}</row>`);
    r += 1;
  }
  for (const note of sheet.notes || []) { r += 1; rows.push(`<row r="${r}">${cellXml(`A${r}`, note, 11)}</row>`); }
  const last = colName(Math.max(0, cols.length - 1));
  const freeze = sheet.freeze !== false ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>' : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>';
  const widths = `<cols>${cols.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${Number(c.width) || 14}" customWidth="1"/>`).join("")}</cols>`;
  const filter = sheet.autoFilter !== false && lastData >= 2 ? `<autoFilter ref="A1:${last}${lastData}"/>` : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><dimension ref="A1:${last}${Math.max(r - 1, 1)}"/>${freeze}<sheetFormatPr defaultRowHeight="15"/>${widths}<sheetData>${rows.join("")}</sheetData>${filter}<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>`;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="dd.mm.yyyy"/></numFmts>
<fonts count="4"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><i/><sz val="10"/><color rgb="FF5A6B7D"/><name val="Calibri"/><family val="2"/></font></fonts>
<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F3A5F"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8EEF5"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFB7C3D0"/></left><right style="thin"><color rgb="FFB7C3D0"/></right><top style="thin"><color rgb="FFB7C3D0"/></top><bottom style="thin"><color rgb="FFB7C3D0"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="13">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>
<xf numFmtId="1" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="4" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="10" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="1" fontId="2" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="4" fontId="2" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="10" fontId="2" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

export function buildXlsx(model, { created = new Date() } = {}) {
  const sheets = model.sheets || [];
  if (!sheets.length) throw new Error("Un registru are cel puțin o foaie");
  const names = sheets.map((s, i) => String(s.name || `Foaie${i + 1}`).replace(/[\\/?*[\]:]/g, " ").slice(0, 31));
  if (new Set(names.map((n) => n.toLowerCase())).size !== names.length) throw new Error("Numele foilor trebuie să fie unice");
  const defined = sheets.map((s, i) => {
    const last = colName(Math.max(0, (s.columns || []).length - 1));
    const lastData = 1 + (s.rows || []).length;
    return s.autoFilter !== false && lastData >= 2 ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${names[i].replace(/'/g, "''")}'!$A$1:$${last}$${lastData}</definedName>` : "";
  }).join("");
  const iso = new Date(created).toISOString().replace(/\.\d+Z$/, "Z");
  return zip([
    { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>` },
    { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>` },
    { name: "xl/workbook.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>${defined ? `<definedNames>${defined}</definedNames>` : ""}<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s) })),
    { name: "xl/styles.xml", data: STYLES },
    { name: "docProps/core.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(model.title || "")}</dc:title><dc:creator>Ifrim Agent Hub</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${iso}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${iso}</dcterms:modified></cp:coreProperties>` },
  ]);
}

/** Every formula cell of the model with its address (for the engine check). */
export function formulaCells(model) {
  const out = [];
  for (const s of model.sheets || []) {
    const all = [...(s.rows || []), ...(s.totals || [])];
    all.forEach((row, ri) => row.forEach((v, ci) => { if (v && typeof v === "object" && v.f) out.push({ sheet: s.name, ref: `${colName(ci)}${ri + 2}`, formula: v.f }); }));
  }
  return out;
}
