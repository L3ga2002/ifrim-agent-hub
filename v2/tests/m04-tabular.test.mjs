// Milestone 04 §2.1 — tabular.mjs: CSV/XLSX readers and writers without dependencies. Pure functions; the only files read
// are the committed synthetic fixtures in v2/fixtures/sales/imports (all fictitious, .test domains).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { HubError } from "../server/core/errors.mjs";
import {
  parseCsv, parseXlsx, writeXlsx, writeZip, readZip, toCsvCell, toCsv, crc32, columnName,
} from "../server/sales/tabular.mjs";
import { buildFixtures, HEADERS } from "../fixtures/sales/imports/make-fixtures.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const IMPORTS = path.join(here, "..", "fixtures", "sales", "imports");
const fixture = (name) => fs.readFileSync(path.join(IMPORTS, name));
const BOM = String.fromCharCode(0xfeff);
const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG = "http://schemas.openxmlformats.org/package/2006/relationships";

/** Asserts a HubError("validation") with the given code (and optional message pattern). */
function refuses(fn, code, pattern) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof HubError, `expected HubError, got ${error?.name}: ${error?.message}`);
    assert.equal(error.category, "validation");
    assert.equal(error.code, code, error.message);
    if (pattern) assert.match(error.message, pattern);
    return true;
  });
}

/** Re-packs an archive (optionally deflated, with entries added or dropped). */
function rezip(buffer, { method, add = [], drop = [] } = {}) {
  const zip = readZip(buffer);
  const kept = zip.names.filter((name) => !drop.includes(name)).map((name) => ({ name, data: zip.read(name), method }));
  return writeZip([...kept, ...add]);
}

/** Edits the central-directory record of one entry in place (on a copy). */
function patchCentral(buffer, name, edit) {
  const out = Buffer.from(buffer);
  for (let p = 0; p + 46 <= out.length; p += 1) {
    if (out.readUInt32LE(p) !== 0x02014b50) continue;
    const len = out.readUInt16LE(p + 28);
    if (out.subarray(p + 46, p + 46 + len).toString("utf8") === name) { edit(out, p); return out; }
  }
  throw new Error(`central record not found: ${name}`);
}

/** Replaces every occurrence of a same-length byte string (used to forge names writeZip itself refuses to write). */
function replaceBytes(buffer, from, to) {
  assert.equal(Buffer.byteLength(from), Buffer.byteLength(to));
  const out = Buffer.from(buffer);
  const needle = Buffer.from(from);
  for (let i = out.indexOf(needle); i !== -1; i = out.indexOf(needle, i + 1)) Buffer.from(to).copy(out, i);
  return out;
}

/** A hand-written workbook (namespace prefixes, absolute targets, custom part names) to exercise the reader beyond writeXlsx. */
function handmadeXlsx({ sheets, sharedXml = null, relsXml = null, contentTypes = null, extra = [] }) {
  const resolve = (target) => (target.startsWith("/") ? target.slice(1) : `xl/${target}`);
  return writeZip([
    { name: "[Content_Types].xml", data: contentTypes ?? `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>` },
    { name: "_rels/.rels", data: `<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", data: `<x:workbook xmlns:x="${MAIN}" xmlns:r="${REL}"><x:sheets>${sheets.map((s, i) => `<x:sheet name="${s.name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</x:sheets></x:workbook>` },
    { name: "xl/_rels/workbook.xml.rels", data: relsXml ?? `<Relationships xmlns="${PKG}">${sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="${s.target}"/>`).join("")}${sharedXml ? `<Relationship Id="rIdS" Type="${REL}/sharedStrings" Target="/xl/strings.xml"/>` : ""}</Relationships>` },
    ...sheets.map((s) => ({ name: resolve(s.target), data: s.xml })),
    ...(sharedXml ? [{ name: "xl/strings.xml", data: sharedXml }] : []),
    ...extra,
  ]);
}

const DATA_SHEET = `<?xml version="1.0" encoding="UTF-8"?><x:worksheet xmlns:x="${MAIN}"><x:dimension ref="A2:D7"/><x:sheetData>
<x:row r="2"><x:c r="A2" t="s"/></x:row>
<x:row r="3" spans="1:4"><x:c r="A3" t="s"><x:v>0</x:v></x:c><x:c r="B3" t="inlineStr"><x:is><x:t>Activ</x:t></x:is></x:c><x:c r="C3" t="s"><x:v>1</x:v></x:c><x:c r="D3" t="s"><x:v>2</x:v></x:c></x:row>
<x:row r="4"><x:c t="s"><x:v>3</x:v></x:c><x:c t="b"><x:v>1</x:v></x:c><x:c><x:v>1250.50</x:v></x:c><x:c t="e"><x:v>#N/A</x:v></x:c></x:row>
<x:row r="5"><x:c r="A5" t="s"><x:v>4</x:v></x:c><x:c r="B5" t="b"><x:v>0</x:v></x:c><x:c r="C5"><x:f>1+1</x:f><x:v>7</x:v></x:c><x:c r="D5" t="str"><x:f>NOW()</x:f><x:v>calculat anterior</x:v></x:c></x:row>
<x:row r="6"></x:row>
<x:row r="7"><x:c r="A7" t="s"><x:v>99</x:v></x:c><x:c r="B7"><x:f>SUM(A1:A2)</x:f></x:c><x:c r="C7" t="inlineStr"><x:is><x:r><x:t>Ab</x:t></x:r><x:r><x:t xml:space="preserve"> cd</x:t></x:r></x:is></x:c></x:row>
</x:sheetData></x:worksheet>`;
const SHARED = `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="${MAIN}" count="5" uniqueCount="5">`
  + `<si><r><t>Denumire</t></r><r><t xml:space="preserve"> firmă</t></r><rPh sb="0" eb="1"><t>FONETIC</t></rPh></si>`
  + "<si><t>Cifră de afaceri</t></si><si><t>Stare</t></si><si><t>Zâmbet &amp; Co &lt;SRL&gt;</t></si>"
  + "<si><t>Linia 1_x000D_\nLinia 2</t></si></sst>";
const SECOND_SHEET = `<worksheet xmlns="${MAIN}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Cheie</t></is></c></row><row r="2"><c r="A2"><v>42</v></c></row></sheetData></worksheet>`;
const twoSheets = () => handmadeXlsx({
  sheets: [{ name: "Date", target: "worksheets/data.xml", xml: DATA_SHEET }, { name: "Ascunsă", target: "worksheets/sheet1.xml", xml: SECOND_SHEET }],
  sharedXml: SHARED,
});

// ---------------------------------------------------------------------------------------------------------------------------
// Fixtures for scenario A
// ---------------------------------------------------------------------------------------------------------------------------

test("fixtures: the committed files are exactly what make-fixtures.mjs generates", () => {
  for (const [name, bytes] of Object.entries(buildFixtures())) assert.ok(fixture(name).equals(bytes), `${name} differs from its generator`);
  assert.ok(fixture("firme-mici-cp1250.csv").includes(Buffer.from("\r\n")), "the cp1250 file keeps CRLF line ends");
  for (const name of ["firme-mici.csv", "firme-mici-cp1250.csv"]) {
    const text = fixture(name).toString("latin1");
    for (const domain of text.match(/@[\w.-]+|https?:\/\/[\w.-]+|www\.[\w.-]+/g)) assert.match(domain, /\.test$/i, `${name}: ${domain}`);
  }
});

test("parseCsv: firme-mici.csv (UTF-8, ';', quotes, ragged row, blank line, raw values)", () => {
  const out = parseCsv(fixture("firme-mici.csv"));
  assert.equal(out.encoding, "utf-8");
  assert.equal(out.delimiter, ";");
  assert.deepEqual(out.headers, HEADERS);
  assert.equal(out.rows.length, 26, "the blank line is skipped");
  assert.deepEqual(out.rows[0], out.rows[7], "exact duplicate kept for the identity layer");
  assert.equal(out.rows[1][3], "0722000102", "leading zero kept");
  assert.equal(out.rows[1][1], "RO9900010227");
  assert.equal(out.rows[2][7], "Program: L–V 9–17; S 10–14\nIntrare din curte, \"Poarta 2\"");
  assert.equal(out.rows[6][1], "9900010708", "invalid CUI stays as text");
  assert.equal(out.rows[8][0], "", "empty name kept");
  assert.equal(out.rows[9][7], "=HYPERLINK(\"https://capcana.test\";\"Apasă aici\")", "formula text is data, never evaluated");
  assert.equal(out.rows[17].length, 7);
  assert.deepEqual(out.warnings, ["Linia 20 are 7 coloane în loc de 8; rândul a fost păstrat așa cum este."]);
  assert.ok(out.rows.flat().every((value) => typeof value === "string"));
});

test("parseCsv: windows-1250 fallback reads the cp1250 fixture with cedilla diacritics", () => {
  const utf8 = parseCsv(fixture("firme-mici.csv"));
  const legacy = parseCsv(fixture("firme-mici-cp1250.csv"));
  assert.equal(legacy.encoding, "windows-1250");
  assert.equal(legacy.delimiter, ";");
  assert.match(legacy.warnings[0], /windows-1250/);
  assert.equal(legacy.headers[6], "Judeţ");
  const cedilla = (text) => text.replace(/ș/g, "ş").replace(/Ș/g, "Ş").replace(/ț/g, "ţ").replace(/Ț/g, "Ţ");
  assert.deepEqual(legacy.headers, utf8.headers.map(cedilla));
  assert.deepEqual(legacy.rows, utf8.rows.map((row) => row.map(cedilla)), "same values, CRLF records, LF inside the quoted field");
  assert.equal(legacy.rows[0][0], "Atelierul Mărţişor SRL");
});

// ---------------------------------------------------------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------------------------------------------------------

test("parseCsv: UTF-8 BOM, UTF-16LE BOM and UTF-16LE without BOM", () => {
  const withBom = parseCsv(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("Nume,Oraș\nIon,Brașov\n")]));
  assert.equal(withBom.encoding, "utf-8");
  assert.deepEqual(withBom.headers, ["Nume", "Oraș"]);
  assert.deepEqual(withBom.rows, [["Ion", "Brașov"]]);
  assert.deepEqual(withBom.warnings, []);

  const utf16 = parseCsv(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("Nume;Oraș\r\nȘtefan;Iași\r\n", "utf16le")]));
  assert.equal(utf16.encoding, "utf-16le");
  assert.equal(utf16.delimiter, ";");
  assert.deepEqual(utf16.rows, [["Ștefan", "Iași"]]);

  const noBom = parseCsv(Buffer.from("Nume\tOras\nIon\tCluj\n", "utf16le"));
  assert.equal(noBom.encoding, "utf-16le");
  assert.equal(noBom.delimiter, "\t");
  assert.match(noBom.warnings[0], /UTF-16LE/);
});

test("parseCsv: delimiter detection among , ; TAB |", () => {
  assert.equal(parseCsv("a,b,c\n1,2,3\n").delimiter, ",");
  assert.equal(parseCsv("a\tb\tc\n1\t2\t3\n").delimiter, "\t");
  assert.equal(parseCsv("a|b|c\n1|2|3\n").delimiter, "|");
  const semi = parseCsv("Denumire;Oraș\nAlfa, Beta & Co SRL;Cluj\nGama, Delta SRL;Iași\n");
  assert.equal(semi.delimiter, ";", "commas inside names do not win");
  assert.deepEqual(semi.rows[0], ["Alfa, Beta & Co SRL", "Cluj"]);
  const comma = parseCsv("a,b\n\"x;y;z\",1\n\"p;q\",2\n");
  assert.equal(comma.delimiter, ",", "delimiters inside quotes are ignored");
  assert.deepEqual(comma.rows, [["x;y;z", "1"], ["p;q", "2"]]);
  assert.equal(parseCsv("Nume\nIon\n").delimiter, ",", "single column falls back to the comma");
});

test("parseCsv: RFC 4180 quotes, escaped quotes, newlines in fields, malformed quotes", () => {
  const out = parseCsv("a,b,c\r\n\"x \"\"citat\"\"\",\"linia1\r\nlinia2\",\"\"\r\nz,,\r\n");
  assert.deepEqual(out.rows, [["x \"citat\"", "linia1\r\nlinia2", ""], ["z", "", ""]]);
  assert.deepEqual(out.warnings, []);

  const unterminated = parseCsv("a,b\n\"deschis,1\n2,3\n");
  assert.deepEqual(unterminated.rows, [["deschis,1\n2,3\n"]]);
  assert.ok(unterminated.warnings.some((w) => /Ghilimele neînchise/.test(w)));

  const trailing = parseCsv("h1,h2\n\"ab\"cd,e\n");
  assert.deepEqual(trailing.rows, [["abcd", "e"]]);
  assert.ok(trailing.warnings.some((w) => /după ghilimelele de închidere la linia 2/.test(w)));

  const oldMac = parseCsv("a;b\r1;2\r3;4");
  assert.deepEqual(oldMac.rows, [["1", "2"], ["3", "4"]], "CR alone ends a record, no final newline needed");
});

test("parseCsv: values stay exact text; header names are cleaned and made unique", () => {
  const out = parseCsv("cod,valoare\n007, 1e3 \n-5,=1+1\n0040721000101,TRUE\n");
  assert.deepEqual(out.rows, [["007", " 1e3 "], ["-5", "=1+1"], ["0040721000101", "TRUE"]]);
  const headers = parseCsv(" Nume ;;nume;Nume\nIon;x;y;z\n");
  assert.deepEqual(headers.headers, ["Nume", "Coloana 2", "nume (2)", "Nume (3)"]);
  assert.equal(headers.warnings.length, 3);
});

test("parseCsv: ragged rows are kept with a warning; blank lines and empty-only rows are skipped", () => {
  const out = parseCsv("a;b;c\n1;2\n\n;;\n1;2;3;4\n1;2;3;\n   \n");
  assert.deepEqual(out.rows, [["1", "2"], ["1", "2", "3", "4"], ["1", "2", "3"]]);
  assert.deepEqual(out.warnings, [
    "Linia 2 are 2 coloane în loc de 3; rândul a fost păstrat așa cum este.",
    "Linia 5 are 4 coloane în loc de 3; rândul a fost păstrat așa cum este.",
  ]);
  const many = parseCsv(`a;b\n${"1\n".repeat(120)}`);
  assert.equal(many.rows.length, 120);
  assert.equal(many.warnings.length, 51, "warnings are capped");
  assert.equal(many.warnings.at(-1), "… și încă 70 de avertismente de același fel.");
  const headerOnly = parseCsv("a;b\n");
  assert.deepEqual(headerOnly.rows, []);
  assert.match(headerOnly.warnings[0], /doar rândul de antet/);
});

test("parseCsv: size, row and cell limits; empty and binary input refused", () => {
  refuses(() => parseCsv(Buffer.alloc(2048, 0x61), { maxBytes: 1024 }), "TABULAR_TOO_LARGE", /depășește limita/);
  refuses(() => parseCsv("a\n1\n2\n3\n", { maxRows: 2 }), "TABULAR_TOO_MANY_ROWS", /peste 2 rânduri/);
  assert.equal(parseCsv("a\n1\n2\n", { maxRows: 2 }).rows.length, 2);
  refuses(() => parseCsv("a;b;c\n1;2;3\n", { maxCells: 5 }), "TABULAR_TOO_MANY_CELLS");
  refuses(() => parseCsv(""), "TABULAR_EMPTY");
  refuses(() => parseCsv("\n \n;;\n"), "TABULAR_EMPTY");
  refuses(() => parseCsv(writeZip([{ name: "a.txt", data: "x" }])), "CSV_LOOKS_LIKE_XLSX");
  refuses(() => parseCsv(Buffer.from([0x41, 0x00, 0x00, 0x00, 0x42, 0x07, 0x00, 0x43])), "CSV_BINARY");
});

// ---------------------------------------------------------------------------------------------------------------------------
// XLSX
// ---------------------------------------------------------------------------------------------------------------------------

test("XLSX round trip: writeXlsx → parseXlsx keeps text, flags numeric and formula cells, uses shared and inline strings", () => {
  const ctrl = `a${String.fromCharCode(1)}b`;
  const rows = [
    ["Denumire firmă", "Telefon", "Notă", "CUI", "Total"],
    ["Șantierul Naval Mic SRL", "722000102", "  spații  ", "9900011036", "12"],
    ["A & B <C> \"D\" 'E'", "0722 000 103", "Linia 1\nLinia 2\r\nLinia 3", "", "3.5"],
    ["Text _x000D_ literal", "", ctrl, "RO9900010227", ""],
  ];
  const xlsx = writeXlsx(rows, {
    numericCells: [[1, 1], [1, 4], [2, 4]],
    formulaCells: [[1, 3], [2, 4, "SUM(1;2.5)"]],
    inlineCells: [[3, 0]],
  });
  const out = parseXlsx(xlsx);
  assert.deepEqual(out.sheets, ["Firme"]);
  assert.equal(out.sheet, "Firme");
  assert.deepEqual(out.headers, rows[0]);
  assert.deepEqual(out.rows, rows.slice(1));
  assert.deepEqual(out.cellFlags, { numeric: [[0, 1], [0, 4], [1, 4]], formula: [[0, 3], [1, 4]] });
  assert.ok(out.warnings.some((w) => /2 celule provin din formule/.test(w)));

  const zip = readZip(xlsx);
  assert.ok(zip.entries.every((entry) => entry.method === 0), "writeZip stores");
  const sheetXml = zip.read("xl/worksheets/sheet1.xml").toString("utf8");
  assert.match(sheetXml, /<c r="A2" t="s"><v>\d+<\/v><\/c>/);
  assert.match(sheetXml, /<c r="A4" t="inlineStr"><is><t>Text _x005F_x000D_ literal<\/t><\/is><\/c>/);
  assert.match(sheetXml, /<c r="D2" t="str"><f>"9900011036"<\/f><v>9900011036<\/v><\/c>/);
  assert.match(sheetXml, /<c r="E3"><f>SUM\(1;2\.5\)<\/f><v>3\.5<\/v><\/c>/);
  assert.match(sheetXml, /<c r="B2"><v>722000102<\/v><\/c>/);
  assert.match(zip.read("xl/sharedStrings.xml").toString("utf8"), /<si><t>a_x0001_b<\/t><\/si>/);
  assert.match(zip.read("xl/sharedStrings.xml").toString("utf8"), /<si><t>Șantierul Naval Mic SRL<\/t><\/si>/);
  assert.ok(writeXlsx(rows).equals(writeXlsx(rows)), "deterministic bytes");
  assert.deepEqual(parseXlsx(rezip(xlsx, { method: "deflate" })), out, "deflated archive reads the same");
});

test("parseXlsx: firme-mici.xlsx keeps the lost leading zero visible, the cached formula value and the inline string", () => {
  const csv = parseCsv(fixture("firme-mici.csv"));
  const out = parseXlsx(fixture("firme-mici.xlsx"));
  assert.deepEqual(out.sheets, ["Firme"]);
  assert.deepEqual(out.headers, HEADERS);
  assert.equal(out.rows.length, 26);
  assert.deepEqual(out.cellFlags, { numeric: [[5, 3]], formula: [[10, 1]] });
  assert.equal(out.rows[5][3], "745000106", "numeric phone: exact <v> text, the identity layer warns about the zero");
  assert.equal(out.rows[10][1], "9900011036", "formula: cached value");
  assert.equal(out.rows[18][0], "Gelateria Înghețată Rece SRL");
  const padded = csv.rows.map((row) => Array.from({ length: 8 }, (_, c) => row[c] ?? ""));
  padded[5][3] = "745000106";
  assert.deepEqual(out.rows, padded, "same data as the CSV otherwise");
});

test("parseXlsx: namespaces, rich text, rPh, booleans, errors, missing refs, first non-empty row as header, sheet choice", () => {
  const xlsx = twoSheets();
  const out = parseXlsx(xlsx);
  assert.deepEqual(out.sheets, ["Date", "Ascunsă"]);
  assert.equal(out.sheet, "Date");
  assert.deepEqual(out.headers, ["Denumire firmă", "Activ", "Cifră de afaceri", "Stare"], "rich runs joined, phonetic run dropped");
  assert.deepEqual(out.rows, [
    ["Zâmbet & Co <SRL>", "TRUE", "1250.50", "#N/A"],
    ["Linia 1\r\nLinia 2", "FALSE", "7", "calculat anterior"],
    ["", "", "Ab cd", ""],
  ]);
  assert.deepEqual(out.cellFlags.numeric, [[0, 2], [1, 2]]);
  assert.deepEqual(out.cellFlags.formula, [[1, 2], [1, 3], [2, 1]]);
  assert.ok(out.warnings.some((w) => /D4 conține eroarea Excel „#N\/A”/.test(w)));
  assert.ok(out.warnings.some((w) => /A7 trimite la un text partajat inexistent/.test(w)));

  const second = parseXlsx(xlsx, { sheet: 1 });
  assert.equal(second.sheet, "Ascunsă");
  assert.deepEqual(second.headers, ["Cheie"]);
  assert.deepEqual(second.rows, [["42"]]);
  assert.deepEqual(second.cellFlags.numeric, [[0, 0]]);
  assert.equal(parseXlsx(xlsx, { sheet: "ascunsă" }).sheet, "Ascunsă");
  refuses(() => parseXlsx(xlsx, { sheet: "Lipsă" }), "XLSX_SHEET_NOT_FOUND", /Foi disponibile: Date, Ascunsă/);
  refuses(() => parseXlsx(xlsx, { sheet: 5 }), "XLSX_SHEET_NOT_FOUND");
});

test("parseXlsx: formulas are never evaluated (cached value or empty, always flagged)", () => {
  const sheet = `<worksheet xmlns="${MAIN}"><sheetData>
<row r="1"><c r="A1" t="inlineStr"><is><t>Calcul</t></is></c><c r="B1" t="inlineStr"><is><t>Text</t></is></c><c r="C1" t="inlineStr"><is><t>Fără cache</t></is></c></row>
<row r="2"><c r="A2"><f>1+1</f><v>7</v></c><c r="B2" t="str"><f>CMD|' /C calc'!A0</f><v>sigur</v></c><c r="C2"><f>NOW()</f></c></row>
<row r="3"><c r="A3"><f t="shared" si="0"/><v>8</v></c></row>
</sheetData></worksheet>`;
  const out = parseXlsx(handmadeXlsx({ sheets: [{ name: "F", target: "worksheets/f.xml", xml: sheet }] }));
  assert.deepEqual(out.rows, [["7", "sigur", ""], ["8", "", ""]], "7, not 2: the cached value wins");
  assert.deepEqual(out.cellFlags.formula, [[0, 0], [0, 1], [0, 2], [1, 0]]);
  assert.deepEqual(out.cellFlags.numeric, [[0, 0], [1, 0]]);
  assert.ok(out.warnings.some((w) => /C2 are o formulă fără valoare salvată/.test(w)));
  for (const formulaText of ["1+1", "CMD", "NOW("]) assert.ok(!JSON.stringify(out.rows).includes(formulaText), "formula text never reaches the rows");
});

test("parseXlsx: refuses macros (vbaProject.bin, macro sheets, .xlsm content type)", () => {
  const base = writeXlsx([["Nume"], ["Ion"]]);
  const vba = rezip(base, { add: [{ name: "xl/vbaProject.bin", data: Buffer.from([0xd0, 0xcf, 0x11, 0xe0]) }] });
  refuses(() => parseXlsx(vba), "XLSX_MACROS", /conține macro-uri/);
  refuses(() => parseXlsx(rezip(base, { add: [{ name: "xl/macrosheets/sheet1.xml", data: "<xm/>" }] })), "XLSX_MACROS");
  const xlsm = handmadeXlsx({
    sheets: [{ name: "A", target: "worksheets/sheet1.xml", xml: SECOND_SHEET }],
    contentTypes: `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.ms-excel.sheet.macroEnabled.main+xml"/></Types>`,
  });
  refuses(() => parseXlsx(xlsm), "XLSX_MACROS", /\.xlsm/);
  const printer = rezip(base, { add: [{ name: "xl/printerSettings/printerSettings1.bin", data: Buffer.from([1, 2, 3]) }] });
  assert.deepEqual(parseXlsx(printer).rows, [["Ion"]], "inert .bin parts stay allowed");
});

test("readZip/parseXlsx: refuse zip-slip and absolute paths (entries and relationship targets)", () => {
  const base = writeXlsx([["Nume"], ["Ion"]]);
  const forge = (from, to) => replaceBytes(rezip(base, { add: [{ name: from, data: "x" }] }), from, to);
  refuses(() => parseXlsx(forge("aa/evil.xml", "../evil.xml")), "ZIP_UNSAFE_PATH", /cale nesigură/);
  refuses(() => parseXlsx(forge("aa_evil.xml", "..\\evil.xml")), "ZIP_UNSAFE_PATH");
  refuses(() => parseXlsx(forge("xabs/x.xml", "/abs/x.xml")), "ZIP_UNSAFE_PATH");
  refuses(() => parseXlsx(forge("Cx/x.xml", "C:/x.xml")), "ZIP_UNSAFE_PATH");
  refuses(() => parseXlsx(forge("xl/abcde/c.xml", "xl/../../c.xml")), "ZIP_UNSAFE_PATH");
  refuses(() => writeZip([{ name: "../evil.xml", data: "x" }]), "ZIP_UNSAFE_PATH");
  refuses(() => writeZip([{ name: "a.xml", data: "x" }, { name: "A.xml", data: "y" }]), "ZIP_DUPLICATE_ENTRY");
  refuses(() => parseXlsx(forge("xl/Workbook.xml", "XL/workbook.xml")), "ZIP_DUPLICATE_ENTRY");
  const escaping = handmadeXlsx({
    sheets: [{ name: "A", target: "worksheets/sheet1.xml", xml: SECOND_SHEET }],
    relsXml: `<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/worksheet" Target="../../evil.xml"/></Relationships>`,
  });
  refuses(() => parseXlsx(escaping), "ZIP_UNSAFE_PATH", /din afara fișierului/);
});

test("readZip/parseXlsx: zip bombs are refused (ratio, declared total, lying header)", () => {
  const base = writeXlsx([["Nume"], ["Ion"]]);
  const zeros = rezip(base, { add: [{ name: "xl/media/zeros.bin", data: Buffer.alloc(20 * 1024 * 1024), method: "deflate" }] });
  refuses(() => parseXlsx(zeros), "ZIP_BOMB", /raport de compresie suspect/);
  refuses(() => parseXlsx(base, { maxUncompressed: 1000 }), "ZIP_BOMB", /depăși limita/);
  const deflated = rezip(base, { method: "deflate" });
  const actual = readZip(deflated).entries.find((e) => e.name === "xl/worksheets/sheet1.xml").size;
  const lying = patchCentral(deflated, "xl/worksheets/sheet1.xml", (buf, p) => buf.writeUInt32LE(10, p + 24));
  assert.ok(actual > 10);
  refuses(() => parseXlsx(lying), "ZIP_BOMB", /peste dimensiunea declarată/);
  const shortStore = patchCentral(base, "xl/worksheets/sheet1.xml", (buf, p) => buf.writeUInt32LE(10, p + 24));
  refuses(() => parseXlsx(shortStore), "ZIP_INVALID");
});

test("readZip/parseXlsx: encryption, corruption, non-ZIP input, unsafe XML and limits", () => {
  const base = writeXlsx([["Nume", "Oraș"], ["Ion", "Cluj"], ["Ana", "Iași"]]);
  const encrypted = patchCentral(base, "xl/workbook.xml", (buf, p) => buf.writeUInt16LE(buf.readUInt16LE(p + 8) | 1, p + 8));
  refuses(() => parseXlsx(encrypted), "ZIP_ENCRYPTED", /criptat/);
  refuses(() => parseXlsx(Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(600)])), "XLSX_ENCRYPTED", /parolă/);
  const at = base.indexOf("<sheetData>");
  const corrupt = Buffer.from(base);
  corrupt[at + 1] = "S".charCodeAt(0);
  refuses(() => parseXlsx(corrupt), "ZIP_INVALID", /deteriorată/);
  refuses(() => parseXlsx(Buffer.from("Nume;Oraș\nIon;Cluj\n")), "ZIP_INVALID");
  refuses(() => parseXlsx(base.subarray(0, base.length - 30)), "ZIP_INVALID");
  refuses(() => parseXlsx(rezip(base, { drop: ["xl/workbook.xml"] })), "XLSX_INVALID", /xl\/workbook\.xml lipsește/);
  const doctype = handmadeXlsx({ sheets: [{ name: "A", target: "worksheets/sheet1.xml", xml: `<!DOCTYPE x [<!ENTITY a "aaaa">]>${SECOND_SHEET}` }] });
  refuses(() => parseXlsx(doctype), "XLSX_UNSAFE_XML", /DOCTYPE/);
  refuses(() => parseXlsx(base, { maxBytes: 100 }), "TABULAR_TOO_LARGE");
  refuses(() => parseXlsx(base, { maxCells: 5 }), "TABULAR_TOO_MANY_CELLS");
  refuses(() => parseXlsx(base, { maxRows: 1 }), "TABULAR_TOO_MANY_ROWS");
  refuses(() => parseXlsx(writeXlsx([[""], []])), "TABULAR_EMPTY");
  refuses(() => readZip(base, { maxEntries: 3 }), "ZIP_TOO_MANY_ENTRIES");
  refuses(() => writeXlsx([["Telefon"], ["0722 000 101"]], { numericCells: [[1, 0]] }), "XLSX_WRITE_INPUT", /nu e un număr/);
});

test("writeZip: CRC-32, deterministic bytes, store method readable back", () => {
  const sample = Buffer.from("Brașov, Iași și Timișoara\n");
  if (typeof zlib.crc32 === "function") assert.equal(crc32(sample), zlib.crc32(sample));
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
  const entries = [{ name: "a/b.txt", data: sample }, { name: "gol.txt", data: "" }, { name: "c.txt", data: "abc", method: "deflate" }];
  const zip = writeZip(entries);
  assert.ok(zip.equals(writeZip(entries)));
  const back = readZip(zip);
  assert.deepEqual(back.names, ["a/b.txt", "gol.txt", "c.txt"]);
  assert.deepEqual(back.entries.map((e) => e.method), [0, 0, 8]);
  assert.ok(back.read("a/b.txt").equals(sample));
  assert.equal(back.read("gol.txt").length, 0);
  assert.equal(back.read("c.txt").toString(), "abc");
  assert.equal(back.read("lipsă.txt"), null);
  assert.deepEqual([0, 25, 26, 701, 702].map(columnName), ["A", "Z", "AA", "ZZ", "AAA"]);
});

// ---------------------------------------------------------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------------------------------------------------------

test("toCsvCell: neutralises formula injection (= + - @ TAB CR) and quotes when needed", () => {
  const fullWidthEquals = String.fromCharCode(0xff1d);
  const cases = [
    ["=1+1", "'=1+1"],
    ["+40 721 000 101", "'+40 721 000 101"],
    ["-5", "'-5"],
    ["@SUM(A1)", "'@SUM(A1)"],
    ["\tx", "\"'\tx\""],
    ["\rx", "\"'\rx\""],
    [" =1+1", "' =1+1"],
    [`${fullWidthEquals}1+1`, `'${fullWidthEquals}1+1`],
    ["=HYPERLINK(\"https://capcana.test\";\"x\")", "\"'=HYPERLINK(\"\"https://capcana.test\"\";\"\"x\"\")\""],
    ["a\"b", "\"a\"\"b\""],
    ["a,b", "\"a,b\""],
    ["a;b", "\"a;b\""],
    ["x\ny", "\"x\ny\""],
    ["Brașov", "Brașov"],
    ["contact@atelier.test", "contact@atelier.test"],
    ["", ""],
    [null, ""],
    [undefined, ""],
    [-5, "-5"],
    [Number.NaN, ""],
    [true, "true"],
  ];
  for (const [input, expected] of cases) assert.equal(toCsvCell(input), expected, JSON.stringify(input));
});

test("toCsv: UTF-8 BOM, CRLF, neutralised cells, readable back by parseCsv", () => {
  const headers = ["Denumire firmă", "Notă"];
  const rows = [["=1+1", "a;b"], ["Ion", null], ["Ștefan", "-2"]];
  const csv = toCsv(headers, rows);
  assert.equal(csv, `${BOM}Denumire firmă,Notă\r\n'=1+1,"a;b"\r\nIon,\r\nȘtefan,'-2\r\n`);
  assert.equal(toCsv(headers, rows, { delimiter: ";" }), `${BOM}Denumire firmă;Notă\r\n'=1+1;"a;b"\r\nIon;\r\nȘtefan;'-2\r\n`);
  const back = parseCsv(Buffer.from(toCsv(headers, rows, { delimiter: ";" }), "utf8"));
  assert.equal(back.encoding, "utf-8");
  assert.equal(back.delimiter, ";");
  assert.deepEqual(back.headers, headers);
  assert.deepEqual(back.rows, [["'=1+1", "a;b"], ["Ion", ""], ["Ștefan", "'-2"]]);
  refuses(() => toCsv(headers, rows, { delimiter: ":" }), "CSV_DELIMITER");
});
