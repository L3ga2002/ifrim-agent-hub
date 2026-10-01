// Generates the synthetic import fixtures for M04 scenario A from ONE source table, so the three files stay consistent:
//   firme-mici.csv         UTF-8, ';', LF (as committed under v2/fixtures/** eol=lf)
//   firme-mici-cp1250.csv  the same content in windows-1250 with CRLF, as legacy Romanian Excel exports it (ș/ț have no
//                          cp1250 code point, so they become the cedilla forms ş/ţ, which is exactly what such files contain)
//   firme-mici.xlsx        the same rows via writeXlsx, plus a numeric phone that lost its leading zero, a formula cell with a
//                          cached value and an inline string
// Every name, CUI, phone, e-mail and site is fictitious: domains are .test, phones are in the 7xx 000 xxx style range and CUIs
// are 10-digit codes with a computed check digit, far above the range ANAF has allocated.
// Run from the project root: node v2/fixtures/sales/imports/make-fixtures.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { writeXlsx } from "../../../server/sales/tabular.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

export const HEADERS = ["Denumire firmă", "CUI", "Site web", "Telefon", "E-mail", "Localitate", "Județ", "Observații"];

// `null` marks the empty line the CSV keeps between records (it must be skipped by the reader).
export const RECORDS = [
  ["Atelierul Mărțișor SRL", "9900010111", "https://atelierul-martisor.test", "0721 000 101", "contact@atelierul-martisor.test", "Brașov", "Brașov", "Bijuterii lucrate manual"],
  ["Brutăria Dulce Pâine S.R.L.", "RO9900010227", "www.dulce-paine.test", "0722000102", "office@dulce-paine.test", "Iași", "Iași", ""],
  ["Cofetăria Țăndărică SRL", "9900010332", "http://cofetaria-tandarica.test/", "+40 723 000 103", "comenzi@cofetaria-tandarica.test", "Timișoara", "Timiș", "Program: L–V 9–17; S 10–14\nIntrare din curte, \"Poarta 2\""],
  ["Florăria Ghiocel PFA", "9900010448", "", "0724 000 104", "florariaghiocel@posta.test", "Constanța", "Constanța", "Doar pagină de socializare"],
  ["Service Auto Bârsan & Fiii SRL", "9900010553", "https://service-barsan.test", "0268 000 105", "service@service-barsan.test", "Brașov", "Brașov", ""],
  ["Pensiunea Dor de Munte SRL", "9900010669", "https://dor-de-munte.test", "0745 000 106", "rezervari@dor-de-munte.test", "Bran", "Brașov", ""],
  ["Croitoria Ițe și Ace II", "9900010708", "https://ite-si-ace.test", "0746 000 107", "", "Pitești", "Argeș", "CUI cu cifră de control greșită"],
  ["Atelierul Mărțișor SRL", "9900010111", "https://atelierul-martisor.test", "0721 000 101", "contact@atelierul-martisor.test", "Brașov", "Brașov", "Bijuterii lucrate manual"],
  ["", "9900010812", "https://fara-nume.test", "0747 000 108", "info@fara-nume.test", "Sibiu", "Sibiu", "Denumire lipsă"],
  ["Tâmplăria Stejarul SA", "9900010928", "https://tamplaria-stejarul.test", "0748 000 109", "office@tamplaria-stejarul.test", "Suceava", "Suceava", "=HYPERLINK(\"https://capcana.test\";\"Apasă aici\")"],
  ["Cabinet Stomatologic Zâmbet SRL", "9900011036", "https://zambet-dental.test", "0749 000 110", "programari@zambet-dental.test", "Cluj-Napoca", "Cluj", ""],
  ["Librăria Cărți Vechi SRL", "9900011141", "https://carti-vechi.test", "0750 000 111", "librar@carti-vechi.test", "București", "București", "Sector 3"],
  ["Salon Frumusețe Ilinca SRL", "9900011257", "", "0751 000 112", "ilinca@salon-ilinca.test", "Galați", "Galați", "Fără site"],
  ["Instalații Termice Șerban SRL", "9900011362", "https://instalatii-serban.test", "0752 000 113", "office@instalatii-serban.test", "Târgu Mureș", "Mureș", ""],
  ["Agenția de Turism Hoinarul SRL", "9900011400", "https://hoinarul.test", "0753 000 114", "hello@hoinarul.test", "Oradea", "Bihor", ""],
  ["Brutaria Dulce Paine SRL", "9900010227", "https://dulce-paine.test", "0722 000 102", "OFFICE@DULCE-PAINE.TEST", "Iasi", "Iasi", "Duplicat scris fără diacritice"],
  ["Ferma Bunicii Ana SRL", "9900011516", "https://ferma-bunicii.test", "0754 000 115", "ana@ferma-bunicii.test", "Bistrița", "Bistrița-Năsăud", ""],
  ["Spălătoria Auto Spumă SRL", "9900011621", "https://spuma-auto.test", "0755 000 116", "", "Ploiești", "Prahova"],
  ["Gelateria Înghețată Rece SRL", "9900011737", "https://inghetata-rece.test", "0756 000 117", "comenzi@inghetata-rece.test", "Craiova", "Dolj", ""],
  null,
  ["Atelier Foto Clipă SRL", "9900011842", "https://clipa-foto.test", "0757 000 118", "foto@clipa-foto.test", "Arad", "Arad", ""],
  ["Mobila Nucului SNC", "9900011958", "http://mobila-nucului.test", "0758 000 119", "vanzari@mobila-nucului.test", "Bacău", "Bacău", ""],
  ["Clinica Veterinară Lăbuța SRL", "9900012066", "https://labuta-vet.test", "0759 000 120", "contact@labuta-vet.test", "Constanța", "Constanța", ""],
  ["Tipografia Literă cu Literă SRL", "9900012104", "https://litera-cu-litera.test", "0760 000 121", "office@litera-cu-litera.test", "Brăila", "Brăila", ""],
  ["Mărțișor Accesorii SRL", "9900012210", "https://atelierul-martisor.test/accesorii", "0721 000 122", "accesorii@atelierul-martisor.test", "Cluj-Napoca", "Cluj", "Același site, altă firmă"],
  ["Grădinița Albinuța SRL", "9900012325", "https://albinuta.test", "0762 000 123", "secretariat@albinuta.test", "Deva", "Hunedoara", ""],
  ["Cafeneaua Boabe Prăjite SRL", "RO 9900012430", "https://boabe-prajite.test", "0763 000 124", "salut@boabe-prajite.test", "Alba Iulia", "Alba", ""],
];

// XLSX-only quirks (0-based [row, column] in the sheet, header = row 0). Row 6 is "Pensiunea Dor de Munte".
const XLSX_NUMERIC_PHONE = { row: 6, col: 3, value: "745000106" };
const XLSX_FORMULA = { row: 11, col: 1, formula: "CONCATENATE(\"990001\",\"1036\")" }; // cached value: the CUI text itself
const XLSX_INLINE = { row: 19, col: 0 }; // "Gelateria Înghețată Rece SRL"

/** Plain RFC 4180 writer for the fixture: unlike toCsv it must keep "=..." raw, since the import has to see it. */
function csvLine(cells, delimiter) {
  return cells.map((cell) => (/["\n\r]/.test(cell) || cell.includes(delimiter) ? `"${cell.replace(/"/g, "\"\"")}"` : cell)).join(delimiter);
}
export function csvText(eol = "\n") {
  return [csvLine(HEADERS, ";"), ...RECORDS.map((record) => (record ? csvLine(record, ";") : ""))].join(eol) + eol;
}

const toCedilla = (text) => text.replace(/ș/g, "ş").replace(/Ș/g, "Ş").replace(/ț/g, "ţ").replace(/Ț/g, "Ţ");
function encodeCp1250(text) {
  const decoder = new TextDecoder("windows-1250");
  const table = new Map();
  for (let byte = 0; byte < 256; byte += 1) {
    const ch = decoder.decode(Uint8Array.of(byte));
    if (ch !== String.fromCharCode(0xfffd) && !table.has(ch)) table.set(ch, byte);
  }
  return Buffer.from([...text].map((ch) => {
    if (!table.has(ch)) throw new Error(`Character not representable in windows-1250: U+${ch.codePointAt(0).toString(16)}`);
    return table.get(ch);
  }));
}

export function xlsxRows() {
  const rows = [HEADERS.slice(), ...RECORDS.map((record) => (record ? record.slice() : []))];
  rows[XLSX_NUMERIC_PHONE.row][XLSX_NUMERIC_PHONE.col] = XLSX_NUMERIC_PHONE.value;
  return rows;
}

/** All three fixtures as bytes (the test compares them with the committed files, so drift is caught). */
export function buildFixtures() {
  return {
    "firme-mici.csv": Buffer.from(csvText("\n"), "utf8"),
    "firme-mici-cp1250.csv": encodeCp1250(toCedilla(csvText("\r\n"))),
    "firme-mici.xlsx": writeXlsx(xlsxRows(), {
      sheetName: "Firme",
      numericCells: [[XLSX_NUMERIC_PHONE.row, XLSX_NUMERIC_PHONE.col]],
      formulaCells: [[XLSX_FORMULA.row, XLSX_FORMULA.col, XLSX_FORMULA.formula]],
      inlineCells: [[XLSX_INLINE.row, XLSX_INLINE.col]],
    }),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  for (const [name, bytes] of Object.entries(buildFixtures())) {
    fs.writeFileSync(path.join(here, name), bytes);
    console.log(`${name}: ${bytes.length} bytes`);
  }
}
