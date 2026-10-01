import zlib from "node:zlib";
import { HubError } from "../core/errors.mjs";

/**
 * CSV and XLSX without new dependencies (M04 §2.1). Imports arrive as untrusted bytes from the API, so every reader here is
 * bounded (input size, rows, cells, uncompressed bytes), never evaluates anything (no formulas, no macros, no external
 * entities) and keeps values as exact text: a phone "0722…" or a CUI "00123" must reach the identity layer untouched, and the
 * numeric/formula origin of an XLSX cell is reported as a flag instead of being "fixed" here.
 *
 * Writers exist for fixtures, tests and exports: `writeZip` is a deterministic store-only ZIP (fixed timestamps, so a fixture
 * committed to Git is reproducible byte for byte) and `toCsvCell` neutralises spreadsheet formula injection on export.
 */

const MB = 1024 * 1024;
export const TABULAR_LIMITS = Object.freeze({
  maxBytes: 20 * MB,
  maxRows: 50000,
  maxUncompressed: 100 * MB,
  maxCells: 2_000_000,
  maxZipEntries: 10000,
  // Deflate tops out near 1032:1. Real sheet XML stays far below this; a larger entry above the ratio is refused as a bomb.
  maxRatio: 500,
  ratioMinBytes: 2 * MB,
  maxWarnings: 50,
});
export const CSV_DELIMITERS = Object.freeze([",", ";", "\t", "|"]);

const fail = (code, message) => { throw new HubError("validation", message, { code }); };
// Romanian counts take "de" from 20 on, except when the last two digits are 01-19 (101 rânduri, 120 de rânduri).
const amount = (n, one, many) => (n === 1 ? `1 ${one}` : `${n} ${n >= 20 && (n % 100 === 0 || n % 100 >= 20) ? "de " : ""}${many}`);
const formatMb = (bytes) => `${Math.round((bytes / MB) * 10) / 10} MB`;
// Names and values from the file are untrusted: shown to the owner only shortened and without control characters.
const shown = (text, max = 80) => {
  const clean = String(text ?? "").replace(/[\u0000-\u001f\u007f]/g, " ");
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
};

function toBuffer(input) {
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof Uint8Array) return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (input instanceof ArrayBuffer) return Buffer.from(input);
  if (typeof input === "string") return Buffer.from(input, "utf8");
  fail("TABULAR_INPUT", "Conținutul fișierului lipsește sau are un tip nesuportat.");
}

/** Collects owner-facing warnings with a cap, so a file with 40 000 ragged rows yields a readable list, not a flood. */
function warningList(limit = TABULAR_LIMITS.maxWarnings) {
  const items = [];
  let dropped = 0;
  return {
    push(text) { if (items.length < limit) items.push(text); else dropped += 1; },
    done() { return dropped ? [...items, `… și încă ${amount(dropped, "avertisment", "avertismente")} de același fel.`] : items; },
  };
}

/** Header names become mapping keys, so they are trimmed, never empty and unique (case-insensitive). */
function normalizeHeaders(raw, warn) {
  const seen = new Set();
  return raw.map((value, index) => {
    let name = String(value ?? "").replace(/^\uFEFF/, "").replace(/\s+/g, " ").trim();
    if (!name) {
      name = `Coloana ${index + 1}`;
      warn.push(`Coloana ${index + 1} nu are antet; a fost numită „${name}”.`);
    }
    let unique = name;
    for (let k = 2; seen.has(unique.toLocaleLowerCase("ro")); k += 1) unique = `${name} (${k})`;
    if (unique !== name) warn.push(`Antet duplicat „${shown(name)}”; coloana ${index + 1} a fost numită „${shown(unique)}”.`);
    seen.add(unique.toLocaleLowerCase("ro"));
    return unique;
  });
}

const isBlankRow = (row) => row.every((value) => String(value ?? "").trim() === "");
const lastFilledIndex = (row) => {
  for (let i = row.length - 1; i >= 0; i -= 1) if (String(row[i] ?? "").trim() !== "") return i;
  return -1;
};

// ---------------------------------------------------------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------------------------------------------------------

/** Decodes bytes: BOM first (UTF-8, UTF-16LE/BE), then strict UTF-8, then windows-1250 (legacy Romanian Excel exports). */
function decodeText(buf, warn) {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return { encoding: "utf-8", text: strictUtf8(buf.subarray(3)) ?? lossyUtf8(buf.subarray(3), warn) };
  }
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    if ((buf.length - 2) % 2) warn.push("Fișierul UTF-16 are un număr impar de octeți; ultimul octet a fost ignorat.");
    return { encoding: "utf-16le", text: new TextDecoder("utf-16le").decode(buf.subarray(2, buf.length - ((buf.length - 2) % 2))) };
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const body = Buffer.from(buf.subarray(2, buf.length - ((buf.length - 2) % 2)));
    body.swap16();
    return { encoding: "utf-16be", text: new TextDecoder("utf-16le").decode(body) };
  }
  if (buf.length >= 4 && buf.readUInt32LE(0) === 0x04034b50) fail("CSV_LOOKS_LIKE_XLSX", "Fișierul pare a fi XLSX (arhivă ZIP), nu CSV.");
  if (buf.length >= 4 && buf.readUInt32BE(0) === 0xd0cf11e0) fail("CSV_LOOKS_LIKE_XLS", "Fișierul pare a fi în formatul vechi .xls sau protejat cu parolă; salvează-l ca CSV sau .xlsx.");
  const head = buf.subarray(0, Math.min(buf.length, 4096));
  if (head.includes(0)) {
    // UTF-16LE without BOM: ASCII text has a zero in (almost) every odd byte. Anything else with NUL bytes is binary.
    let oddZero = 0;
    for (let i = 1; i < head.length; i += 2) if (head[i] === 0) oddZero += 1;
    if (oddZero >= Math.floor(head.length / 2) * 0.6) {
      warn.push("Fișierul nu are BOM, dar pare UTF-16LE; a fost citit ca UTF-16LE.");
      return { encoding: "utf-16le", text: new TextDecoder("utf-16le").decode(buf.subarray(0, buf.length - (buf.length % 2))) };
    }
    fail("CSV_BINARY", "Fișierul pare binar, nu un CSV text.");
  }
  const utf8 = strictUtf8(buf);
  if (utf8 !== null) return { encoding: "utf-8", text: utf8 };
  warn.push("Fișierul nu e UTF-8 valid; a fost citit ca windows-1250 (codificarea veche Excel pentru română).");
  return { encoding: "windows-1250", text: new TextDecoder("windows-1250").decode(buf) };
}
function strictUtf8(buf) {
  try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buf); } catch { return null; }
}
function lossyUtf8(buf, warn) {
  warn.push("Fișierul are BOM UTF-8, dar conține octeți invalizi; aceștia au fost înlocuiți cu „\uFFFD”.");
  return new TextDecoder("utf-8", { ignoreBOM: true }).decode(buf);
}

/** Picks the delimiter whose per-record count is most consistent with the header (quote-aware, on a sample). */
function detectDelimiter(text) {
  const sample = text.slice(0, 64 * 1024);
  let best = { delimiter: ",", consistency: -1, headerCount: 0 };
  for (const delimiter of CSV_DELIMITERS) {
    const counts = [];
    let count = 0;
    let inQuotes = false;
    let filled = false;
    for (let i = 0; i < sample.length && counts.length < 30; i += 1) {
      const ch = sample[i];
      if (ch === '"') { inQuotes = !inQuotes; filled = true; continue; }
      if (inQuotes) continue;
      if (ch === "\n" || ch === "\r") {
        if (filled) counts.push(count);
        count = 0;
        filled = false;
        continue;
      }
      if (ch === delimiter) count += 1;
      if (ch.trim()) filled = true;
    }
    if (filled && counts.length < 30) counts.push(count);
    if (!counts.length || counts[0] === 0) continue;
    const consistency = counts.filter((c) => c === counts[0]).length / counts.length;
    if (consistency > best.consistency || (consistency === best.consistency && counts[0] > best.headerCount)) {
      best = { delimiter, consistency, headerCount: counts[0] };
    }
  }
  return best.delimiter;
}

/**
 * RFC 4180 records: `""` inside quotes is a quote, newlines and delimiters inside quotes belong to the field, CRLF/LF/CR all end
 * a record. Lenient on malformed input (text after a closing quote, an unterminated quote) with a warning instead of a failure.
 */
function parseRecords(text, delimiter, { warn, maxCells, onRecord }) {
  const n = text.length;
  let i = 0;
  let line = 1;
  let record = [];
  let recordLine = 1;
  let cells = 0;
  const isEnd = (ch) => ch === delimiter || ch === "\n" || ch === "\r";
  for (;;) {
    let value;
    if (text[i] === '"') {
      let out = "";
      let j = i + 1;
      for (;;) {
        const q = text.indexOf('"', j);
        if (q === -1) {
          out += text.slice(j);
          warn.push(`Ghilimele neînchise începând cu linia ${line}; restul fișierului a fost citit ca un singur câmp.`);
          i = n;
          break;
        }
        out += text.slice(j, q);
        if (text[q + 1] === '"') { out += '"'; j = q + 2; continue; }
        i = q + 1;
        break;
      }
      for (let k = out.indexOf("\n"); k !== -1; k = out.indexOf("\n", k + 1)) line += 1;
      if (i < n && !isEnd(text[i])) {
        let j = i;
        while (j < n && !isEnd(text[j])) j += 1;
        warn.push(`Text după ghilimelele de închidere la linia ${line}; a fost păstrat în câmp.`);
        out += text.slice(i, j);
        i = j;
      }
      value = out;
    } else {
      let j = i;
      while (j < n && !isEnd(text[j])) j += 1;
      value = text.slice(i, j);
      i = j;
    }
    record.push(value);
    cells += 1;
    if (cells > maxCells) fail("TABULAR_TOO_MANY_CELLS", `Fișierul are peste ${amount(maxCells, "celulă", "celule")} (limita de import).`);
    if (i >= n) { onRecord(record, recordLine); return; }
    if (text[i] === delimiter) { i += 1; continue; }
    i += text[i] === "\r" && text[i + 1] === "\n" ? 2 : 1;
    line += 1;
    onRecord(record, recordLine);
    record = [];
    recordLine = line;
    if (i >= n) return;
  }
}

/**
 * Parses a CSV upload. Values stay exact text (nothing becomes a number, nothing is trimmed); only header names are cleaned.
 * Blank records are skipped; records with another column count are kept with a warning (a trailing empty cell beyond the
 * header is dropped, it carries nothing).
 * @param {Buffer|Uint8Array|string} buffer
 * @returns {{ encoding: string, delimiter: string, headers: string[], rows: string[][], warnings: string[] }}
 */
export function parseCsv(buffer, { maxBytes = TABULAR_LIMITS.maxBytes, maxRows = TABULAR_LIMITS.maxRows, maxCells = TABULAR_LIMITS.maxCells } = {}) {
  const buf = toBuffer(buffer);
  if (buf.length > maxBytes) fail("TABULAR_TOO_LARGE", `Fișierul are ${formatMb(buf.length)} și depășește limita de ${formatMb(maxBytes)}.`);
  const warn = warningList();
  const { encoding, text } = decodeText(buf, warn);
  const delimiter = detectDelimiter(text);
  let rawHeader = null;
  let width = 0;
  const rows = [];
  parseRecords(text, delimiter, {
    warn,
    maxCells,
    onRecord(record, line) {
      if (isBlankRow(record)) return;
      if (!rawHeader) {
        rawHeader = record.slice(0, lastFilledIndex(record) + 1);
        width = rawHeader.length;
        return;
      }
      if (rows.length >= maxRows) fail("TABULAR_TOO_MANY_ROWS", `Fișierul are peste ${amount(maxRows, "rând", "rânduri")} de date (limita de import).`);
      const row = record.length > width ? record.slice(0, Math.max(width, lastFilledIndex(record) + 1)) : record;
      if (row.length !== width) warn.push(`Linia ${line} are ${amount(row.length, "coloană", "coloane")} în loc de ${width}; rândul a fost păstrat așa cum este.`);
      rows.push(row);
    },
  });
  if (!rawHeader) fail("TABULAR_EMPTY", "Fișierul nu conține date (lipsește rândul de antet).");
  if (!rows.length) warn.push("Fișierul are doar rândul de antet, fără date.");
  const headers = normalizeHeaders(rawHeader, warn);
  return { encoding, delimiter, headers, rows, warnings: warn.done() };
}

// ---------------------------------------------------------------------------------------------------------------------------
// ZIP (reader and store-only writer)
// ---------------------------------------------------------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 (ISO-HDLC, as used by ZIP). */
export function crc32(data) {
  const buf = toBuffer(data);
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Zip-slip guard shared by reader and writer: relative, forward-only paths without drive letters or NUL. */
function unsafeEntryName(name) {
  if (!name || name.includes("\0")) return true;
  if (/^[\\/]/.test(name) || /^[a-z]:/i.test(name)) return true;
  return name.split(/[\\/]/).some((part) => part === "..");
}

/**
 * Reads a ZIP central directory and returns lazy, bounded access to its entries. Refuses: encryption, ZIP64/multi-disk,
 * unsafe or duplicate names, declared totals above `maxUncompressed`, suspicious ratios; each read is inflated with
 * `maxOutputLength` equal to the declared size and checked against its CRC, so a lying header cannot expand further.
 * @returns {{ names: string[], entries: object[], has(name: string): boolean, read(name: string): Buffer|null }}
 */
export function readZip(buffer, {
  maxUncompressed = TABULAR_LIMITS.maxUncompressed, maxEntries = TABULAR_LIMITS.maxZipEntries,
  maxRatio = TABULAR_LIMITS.maxRatio, ratioMinBytes = TABULAR_LIMITS.ratioMinBytes,
} = {}) {
  const buf = toBuffer(buffer);
  const invalid = () => fail("ZIP_INVALID", "Fișierul nu este un XLSX valid (arhiva ZIP lipsește sau e deteriorată).");
  if (buf.length >= 4 && buf.readUInt32BE(0) === 0xd0cf11e0) {
    fail("XLSX_ENCRYPTED", "Fișierul e protejat cu parolă sau e în formatul vechi .xls; salvează-l ca .xlsx fără parolă și reîncearcă.");
  }
  if (buf.length < 22) invalid();
  let eocd = -1;
  for (let i = buf.length - 22, min = Math.max(0, buf.length - 22 - 0xffff); i >= min; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) invalid();
  const disk = buf.readUInt16LE(eocd + 4);
  const cdDisk = buf.readUInt16LE(eocd + 6);
  const onDisk = buf.readUInt16LE(eocd + 8);
  const total = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) fail("ZIP_UNSUPPORTED", "Arhivele ZIP64 nu sunt acceptate la import.");
  if (disk !== 0 || cdDisk !== 0 || onDisk !== total) fail("ZIP_UNSUPPORTED", "Arhivele ZIP împărțite pe mai multe volume nu sunt acceptate.");
  if (total > maxEntries) fail("ZIP_TOO_MANY_ENTRIES", `Arhiva are ${amount(total, "intrare", "intrări")} (limita este ${maxEntries}).`);
  if (cdOffset + cdSize > eocd) invalid();

  const entries = [];
  const byName = new Map();
  let declaredTotal = 0;
  let p = cdOffset;
  for (let k = 0; k < total; k += 1) {
    if (p + 46 > eocd || buf.readUInt32LE(p) !== 0x02014b50) invalid();
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const compressedSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    if (p + 46 + nameLen > eocd) invalid();
    const nameBytes = buf.subarray(p + 46, p + 46 + nameLen);
    const name = nameBytes.toString(flags & 0x800 ? "utf8" : "latin1");
    p += 46 + nameLen + extraLen + commentLen;
    if (flags & 0x1 || flags & 0x40 || method === 99) fail("ZIP_ENCRYPTED", "Fișierul XLSX e criptat; salvează-l fără parolă și reîncearcă.");
    if (unsafeEntryName(name)) fail("ZIP_UNSAFE_PATH", `Arhiva conține o cale nesigură („${shown(name)}”) și a fost refuzată.`);
    const key = name.toLowerCase();
    if (byName.has(key)) fail("ZIP_DUPLICATE_ENTRY", `Arhiva conține de două ori intrarea „${shown(name)}” și a fost refuzată.`);
    if (size === 0xffffffff || compressedSize === 0xffffffff) fail("ZIP_UNSUPPORTED", "Arhivele ZIP64 nu sunt acceptate la import.");
    if (localOffset + 30 > cdOffset) invalid();
    declaredTotal += size;
    if (declaredTotal > maxUncompressed) {
      fail("ZIP_BOMB", `Conținutul dezarhivat ar depăși limita de ${formatMb(maxUncompressed)}; fișierul a fost refuzat (posibil zip bomb).`);
    }
    if (size >= ratioMinBytes && size / Math.max(1, compressedSize) > maxRatio) {
      fail("ZIP_BOMB", "Arhiva are un raport de compresie suspect (posibil zip bomb) și a fost refuzată.");
    }
    const entry = { name, method, flags, crc, compressedSize, size, localOffset };
    entries.push(entry);
    byName.set(key, entry);
  }

  let inflatedTotal = 0;
  return {
    names: entries.map((e) => e.name),
    entries: entries.map(({ name, method, compressedSize, size }) => ({ name, method, compressedSize, size })),
    has: (name) => byName.has(String(name).toLowerCase()),
    read(name) {
      const entry = byName.get(String(name).toLowerCase());
      if (!entry) return null;
      const off = entry.localOffset;
      if (buf.readUInt32LE(off) !== 0x04034b50) invalid();
      const start = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
      const end = start + entry.compressedSize;
      if (end > cdOffset) invalid();
      const raw = buf.subarray(start, end);
      let data;
      if (entry.method === 0) {
        if (entry.compressedSize !== entry.size) invalid();
        data = raw;
      } else if (entry.method === 8) {
        try {
          data = zlib.inflateRawSync(raw, { maxOutputLength: Math.max(1, entry.size) });
        } catch (error) {
          if (error?.code === "ERR_BUFFER_TOO_LARGE") {
            fail("ZIP_BOMB", `Intrarea „${shown(entry.name)}” se dezarhivează peste dimensiunea declarată (posibil zip bomb); fișierul a fost refuzat.`);
          }
          invalid();
        }
      } else {
        fail("ZIP_UNSUPPORTED", `Metodă de compresie nesuportată (${entry.method}) pentru „${shown(entry.name)}”.`);
      }
      if (data.length !== entry.size || crc32(data) !== entry.crc) invalid();
      inflatedTotal += data.length;
      if (inflatedTotal > maxUncompressed) fail("ZIP_BOMB", `Conținutul dezarhivat depășește limita de ${formatMb(maxUncompressed)}.`);
      return data;
    },
  };
}

/**
 * Deterministic ZIP writer: method store (or deflate when an entry asks for `method: "deflate"`), UTF-8 names, CRC-32,
 * fixed DOS timestamp 1980-01-01 00:00 so the same entries always give the same bytes.
 * @param {{ name: string, data: Buffer|string, method?: "store"|"deflate" }[]} entries
 * @returns {Buffer}
 */
export function writeZip(entries) {
  if (!Array.isArray(entries)) fail("ZIP_INPUT", "Intrările arhivei trebuie date ca listă.");
  if (entries.length > 0xfffe) fail("ZIP_TOO_MANY_ENTRIES", "Prea multe intrări pentru o arhivă ZIP simplă.");
  const DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01
  const seen = new Set();
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const name = String(entry?.name ?? "");
    if (unsafeEntryName(name)) fail("ZIP_UNSAFE_PATH", `Nume de intrare nesigur în arhivă: „${shown(name)}”.`);
    if (seen.has(name.toLowerCase())) fail("ZIP_DUPLICATE_ENTRY", `Intrare duplicată în arhivă: „${shown(name)}”.`);
    seen.add(name.toLowerCase());
    const nameBuf = Buffer.from(name, "utf8");
    const data = Buffer.isBuffer(entry.data) || entry.data instanceof Uint8Array ? toBuffer(entry.data) : Buffer.from(String(entry.data ?? ""), "utf8");
    const deflate = entry.method === "deflate";
    const body = deflate ? zlib.deflateRawSync(data, { level: 9 }) : data;
    if (data.length >= 0xffffffff || offset + body.length >= 0xffffffff) fail("ZIP_TOO_LARGE", "Arhiva ar depăși 4 GB.");
    const crc = crc32(data);
    const method = deflate ? 8 : 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, body);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

// ---------------------------------------------------------------------------------------------------------------------------
// XLSX
// ---------------------------------------------------------------------------------------------------------------------------

const NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

const XML_ENTITIES = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
/** Predefined and numeric entities only: custom entities are never expanded (DOCTYPE is refused before this runs). */
function decodeXml(text) {
  if (!text) return "";
  if (!text.includes("&") && !text.includes("_x")) return text;
  const decoded = text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|lt|gt|amp|quot|apos);/g, (_, ref) => {
    if (ref[0] !== "#") return XML_ENTITIES[ref];
    const code = ref[1] === "x" ? Number.parseInt(ref.slice(2), 16) : Number.parseInt(ref.slice(1), 10);
    return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "\uFFFD";
  });
  // OOXML escapes characters XML cannot carry as _xHHHH_ (e.g. _x000D_); `_x005F_` escapes a literal underscore.
  return decoded.replace(/_x([0-9A-Fa-f]{4})_/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
}
function escapeXmlText(value) {
  return String(value)
    .replace(/_x([0-9A-Fa-f]{4})_/g, "_x005F_x$1_")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/[\u0000-\u0008\u000b-\u001f\uFFFE\uFFFF]/g, (ch) => `_x${ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}_`);
}
const escapeXmlAttr = (value) => escapeXmlText(value).replace(/"/g, "&quot;");

function parseAttrs(text) {
  const attrs = {};
  for (const m of String(text || "").matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[m[1]] = decodeXml(m[2] ?? m[3] ?? "");
  return attrs;
}
// One element (any namespace prefix): group 1 = attributes, group 2 = content (undefined when self-closing). Compiled once;
// matchAll clones the regex, so sharing these global instances is safe.
const tagRe = (name) => new RegExp(`<(?:[\\w.-]+:)?${name}\\b([^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${name}>)`, "g");
const TAG = Object.freeze(Object.fromEntries(["t", "si", "sheet", "Relationship", "row", "c"].map((name) => [name, tagRe(name)])));

/** Text of all <t> runs, phonetic runs (<rPh>) excluded, as Excel displays it. */
function runText(fragment) {
  if (!fragment) return "";
  const cleaned = fragment.replace(/<(?:[\w.-]+:)?rPh\b[\s\S]*?<\/(?:[\w.-]+:)?rPh>/g, "");
  let out = "";
  for (const m of cleaned.matchAll(TAG.t)) out += decodeXml(m[2] ?? "");
  return out;
}

function guardXml(xml, part) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) fail("XLSX_UNSAFE_XML", `Fișierul conține declarații XML nepermise (DOCTYPE/ENTITY) în „${shown(part)}” și a fost refuzat.`);
  return xml;
}
function readXml(zip, part) {
  const data = zip.read(part);
  if (data === null) return null;
  let xml = data.toString("utf8");
  if (xml.charCodeAt(0) === 0xfeff) xml = xml.slice(1);
  return guardXml(xml, part);
}

/** Resolves an OPC relationship target against the folder of its source part; null when it would leave the package. */
function resolvePart(baseDir, target) {
  const t = String(target || "").replace(/\\/g, "/");
  const parts = (t.startsWith("/") ? t.slice(1) : `${baseDir}${t}`).split("/");
  const out = [];
  for (const part of parts) {
    if (part === "..") { if (!out.length) return null; out.pop(); } else if (part && part !== ".") out.push(part);
  }
  return out.join("/");
}

function columnIndex(ref) {
  const m = /^\$?([A-Za-z]{1,3})\$?\d*$/.exec(String(ref || ""));
  if (!m) return -1;
  let n = 0;
  for (const ch of m[1].toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
export function columnName(index) {
  let n = index + 1;
  let out = "";
  while (n > 0) { const r = (n - 1) % 26; out = String.fromCharCode(65 + r) + out; n = Math.floor((n - 1) / 26); }
  return out;
}

// VBA projects and Excel 4.0 macro sheets. Other .bin parts (printer settings) are inert and stay allowed.
const MACRO_PARTS = [/(^|\/)vbaproject\.bin$/i, /^xl\/macrosheets\//i];
const MACRO_CONTENT_TYPE = /macroEnabled|vbaProject|ms-office\.vbaProject/i;

/**
 * Parses an XLSX upload: one sheet (the first, or `sheet` by name or 0-based index), first non-empty row as header.
 * Formulas are never evaluated: the cached <v> is used and the cell is listed in `cellFlags.formula`. Numeric cells keep the
 * exact <v> text and are listed in `cellFlags.numeric`. Flag coordinates are [rowIndex, columnIndex], 0-based, into `rows`
 * (the header is not a data row). Blank rows are skipped; rows are padded to the header width.
 * @returns {{ sheets: string[], sheet: string, headers: string[], rows: string[][], cellFlags: { numeric: number[][], formula: number[][] }, warnings: string[] }}
 */
export function parseXlsx(buffer, {
  sheet = null, maxBytes = TABULAR_LIMITS.maxBytes, maxUncompressed = TABULAR_LIMITS.maxUncompressed,
  maxCells = TABULAR_LIMITS.maxCells, maxRows = TABULAR_LIMITS.maxRows,
} = {}) {
  const buf = toBuffer(buffer);
  if (buf.length > maxBytes) fail("TABULAR_TOO_LARGE", `Fișierul are ${formatMb(buf.length)} și depășește limita de ${formatMb(maxBytes)}.`);
  const zip = readZip(buf, { maxUncompressed });
  const warn = warningList();

  if (zip.names.some((name) => MACRO_PARTS.some((re) => re.test(name)))) {
    fail("XLSX_MACROS", "Fișierul conține macro-uri (de exemplu xl/vbaProject.bin) și a fost refuzat. Salvează-l ca .xlsx fără macro-uri.");
  }
  const contentTypes = readXml(zip, "[Content_Types].xml");
  if (contentTypes && MACRO_CONTENT_TYPE.test(contentTypes)) {
    fail("XLSX_MACROS", "Fișierul conține macro-uri (registru .xlsm) și a fost refuzat. Salvează-l ca .xlsx fără macro-uri.");
  }

  // Workbook part: from the package relationships, falling back to the conventional path.
  let workbookPart = "xl/workbook.xml";
  const rootRels = readXml(zip, "_rels/.rels");
  for (const m of rootRels ? rootRels.matchAll(TAG.Relationship) : []) {
    const a = parseAttrs(m[1]);
    if (/\/officeDocument$/.test(a.Type || "") && a.TargetMode !== "External") workbookPart = resolvePart("", a.Target) || workbookPart;
  }
  const workbook = readXml(zip, workbookPart);
  if (workbook === null) fail("XLSX_INVALID", "Fișierul nu conține un registru Excel (xl/workbook.xml lipsește).");
  const baseDir = workbookPart.includes("/") ? workbookPart.slice(0, workbookPart.lastIndexOf("/") + 1) : "";
  const relsPart = `${baseDir}_rels/${workbookPart.slice(baseDir.length)}.rels`;
  const rels = new Map();
  let sharedPart = null;
  const relsXml = readXml(zip, relsPart);
  for (const m of relsXml ? relsXml.matchAll(TAG.Relationship) : []) {
    const a = parseAttrs(m[1]);
    if (a.TargetMode === "External") continue;
    const target = resolvePart(baseDir, a.Target);
    if (!target) fail("ZIP_UNSAFE_PATH", `Registrul trimite la o cale din afara fișierului („${shown(a.Target)}”).`);
    rels.set(a.Id, target);
    if (/\/sharedStrings$/.test(a.Type || "")) sharedPart = target;
  }
  if (!sharedPart && zip.has(`${baseDir}sharedStrings.xml`)) sharedPart = `${baseDir}sharedStrings.xml`;

  const sheetList = [];
  for (const m of workbook.matchAll(TAG.sheet)) {
    const a = parseAttrs(m[1]);
    const relKey = Object.keys(a).find((k) => /(^|:)id$/.test(k) && k !== "sheetId");
    const part = (relKey && rels.get(a[relKey])) || `${baseDir}worksheets/sheet${sheetList.length + 1}.xml`;
    sheetList.push({ name: a.name ?? `Foaia ${sheetList.length + 1}`, part });
  }
  if (!sheetList.length) fail("XLSX_INVALID", "Registrul Excel nu conține nicio foaie.");
  let chosen;
  if (sheet === null || sheet === undefined || sheet === "") chosen = sheetList[0];
  else if (typeof sheet === "number") chosen = sheetList[sheet];
  else chosen = sheetList.find((s) => s.name === String(sheet)) ?? sheetList.find((s) => s.name.toLowerCase() === String(sheet).toLowerCase());
  if (!chosen) fail("XLSX_SHEET_NOT_FOUND", `Foaia „${shown(sheet)}” nu există în fișier. Foi disponibile: ${sheetList.map((s) => s.name).join(", ")}.`);

  const shared = [];
  const sharedXml = sharedPart ? readXml(zip, sharedPart) : null;
  for (const m of sharedXml ? sharedXml.matchAll(TAG.si) : []) {
    shared.push(runText(m[2]));
    if (shared.length > maxCells) fail("TABULAR_TOO_MANY_CELLS", `Fișierul are peste ${amount(maxCells, "text partajat", "texte partajate")} (limita de import).`);
  }

  const sheetXml = readXml(zip, chosen.part);
  if (sheetXml === null) fail("XLSX_INVALID", `Foaia „${shown(chosen.name)}” lipsește din fișier.`);
  const open = /<(?:[\w.-]+:)?sheetData\b[^>]*?(\/?)>/.exec(sheetXml);
  const closeAt = open && !open[1] ? sheetXml.search(/<\/(?:[\w.-]+:)?sheetData>/) : -1;
  const sheetData = open && !open[1] && closeAt > open.index ? sheetXml.slice(open.index + open[0].length, closeAt) : "";

  // Pass 1: cells as written (sparse), with their origin flags.
  const parsed = [];
  let cellCount = 0;
  let nextRow = 1;
  for (const rm of sheetData.matchAll(TAG.row)) {
    const rowAttrs = parseAttrs(rm[1]);
    const rowNumber = Number.parseInt(rowAttrs.r, 10) || nextRow;
    nextRow = rowNumber + 1;
    const cells = [];
    const numeric = new Set();
    const formula = new Set();
    let nextCol = 0;
    for (const cm of (rm[2] || "").matchAll(TAG.c)) {
      cellCount += 1;
      if (cellCount > maxCells) fail("TABULAR_TOO_MANY_CELLS", `Fișierul are peste ${amount(maxCells, "celulă", "celule")} (limita de import).`);
      // Only r and t matter for a cell; reading just those keeps a 400 000-cell sheet fast.
      const a = { r: /(?:^|\s)r\s*=\s*["']([^"']*)["']/.exec(cm[1])?.[1], t: /(?:^|\s)t\s*=\s*["']([^"']*)["']/.exec(cm[1])?.[1] };
      let col = a.r ? columnIndex(a.r) : nextCol;
      if (col < 0 || col > 16383) { warn.push(`Referință de celulă invalidă „${shown(a.r)}” pe rândul ${rowNumber}; celula a fost ignorată.`); continue; }
      nextCol = col + 1;
      const body = cm[2] || "";
      const hasFormula = /<(?:[\w.-]+:)?f\b/.test(body);
      const vm = /<(?:[\w.-]+:)?v\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:[\w.-]+:)?v>)/.exec(body);
      const raw = vm ? decodeXml(vm[1] ?? "") : null;
      const type = a.t || "n";
      let value = "";
      let isNumeric = false;
      if (type === "s") {
        const index = Number.parseInt(raw ?? "", 10);
        if (raw !== null && Number.isInteger(index) && index >= 0 && index < shared.length) value = shared[index];
        else if (raw !== null) warn.push(`Celula ${columnName(col)}${rowNumber} trimite la un text partajat inexistent; a rămas goală.`);
      } else if (type === "inlineStr") {
        const im = /<(?:[\w.-]+:)?is\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?is>/.exec(body);
        value = im ? runText(im[1]) : raw ?? "";
      } else if (type === "b") {
        value = raw === "1" ? "TRUE" : raw === "0" ? "FALSE" : raw ?? "";
      } else if (type === "e") {
        value = raw ?? "";
        if (value) warn.push(`Celula ${columnName(col)}${rowNumber} conține eroarea Excel „${shown(value, 20)}”; a fost păstrată ca text.`);
      } else if (type === "str" || type === "d") {
        value = raw ?? "";
      } else {
        if (type !== "n") warn.push(`Celula ${columnName(col)}${rowNumber} are un tip necunoscut („${shown(type, 20)}”); valoarea a fost păstrată ca text.`);
        value = raw ?? "";
        isNumeric = type === "n" && value !== "";
      }
      if (hasFormula && raw === null && type !== "inlineStr") {
        warn.push(`Celula ${columnName(col)}${rowNumber} are o formulă fără valoare salvată; formula nu e calculată, celula a rămas goală.`);
      }
      cells[col] = value;
      if (isNumeric) numeric.add(col); else numeric.delete(col);
      if (hasFormula) formula.add(col); else formula.delete(col);
    }
    if (!cells.length) continue; // formatted-but-empty rows cost nothing (a sheet can declare a million of them)
    for (let c = 0; c < cells.length; c += 1) if (cells[c] === undefined) cells[c] = "";
    parsed.push({ rowNumber, cells, numeric, formula });
  }

  // Pass 2: header = first non-empty row; data rows padded to the header width; flags re-indexed into `rows`.
  const headerAt = parsed.findIndex((row) => !isBlankRow(row.cells));
  if (headerAt < 0) fail("TABULAR_EMPTY", `Foaia „${shown(chosen.name)}” nu conține date (lipsește rândul de antet).`);
  const header = parsed[headerAt].cells.slice(0, lastFilledIndex(parsed[headerAt].cells) + 1);
  const width = header.length;
  const rows = [];
  const cellFlags = { numeric: [], formula: [] };
  let total = width;
  for (const row of parsed.slice(headerAt + 1)) {
    if (isBlankRow(row.cells)) continue;
    if (rows.length >= maxRows) fail("TABULAR_TOO_MANY_ROWS", `Foaia are peste ${amount(maxRows, "rând", "rânduri")} de date (limita de import).`);
    const length = Math.max(width, lastFilledIndex(row.cells) + 1);
    total += length;
    if (total > maxCells) fail("TABULAR_TOO_MANY_CELLS", `Fișierul are peste ${amount(maxCells, "celulă", "celule")} (limita de import).`);
    const out = Array.from({ length }, (_, c) => row.cells[c] ?? "");
    if (length > width) warn.push(`Rândul ${row.rowNumber} are valori în afara coloanelor cu antet; au fost păstrate.`);
    const r = rows.length;
    for (const c of [...row.numeric].sort((x, y) => x - y)) if (c < length) cellFlags.numeric.push([r, c]);
    for (const c of [...row.formula].sort((x, y) => x - y)) if (c < length) cellFlags.formula.push([r, c]);
    rows.push(out);
  }
  if (!rows.length) warn.push("Foaia are doar rândul de antet, fără date.");
  if (cellFlags.formula.length) warn.push(cellFlags.formula.length === 1
    ? "1 celulă provine dintr-o formulă; s-a folosit valoarea salvată în fișier, formula nu a fost calculată."
    : `${amount(cellFlags.formula.length, "celulă", "celule")} provin din formule; s-a folosit valoarea salvată în fișier, formulele nu au fost calculate.`);
  const headers = normalizeHeaders(header, warn);
  return { sheets: sheetList.map((s) => s.name), sheet: chosen.name, headers, rows, cellFlags, warnings: warn.done() };
}

const cellKey = (r, c) => `${r}:${c}`;
function cellSet(list, label) {
  const map = new Map();
  for (const item of Array.isArray(list) ? list : []) {
    const [r, c, extra] = Array.isArray(item) ? item : [item?.r, item?.c, item?.formula];
    if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || c < 0) fail("XLSX_WRITE_INPUT", `Coordonată invalidă în ${label}.`);
    map.set(cellKey(r, c), extra ?? null);
  }
  return map;
}
const NUMBER_TEXT = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * Minimal valid XLSX (one sheet) for fixtures and tests. Strings go to the shared-string table, or inline for `inlineCells`;
 * `numericCells` are written as numbers (their text must be a plain number); `formulaCells` ([r, c, formula?]) carry a
 * formula plus the cell value as cached result, so a reader that evaluates nothing still sees the value.
 * @param {Array<Array<string|number|null>>} rows header row first
 * @returns {Buffer}
 */
export function writeXlsx(rows, { sheetName = "Firme", numericCells = [], formulaCells = [], inlineCells = [] } = {}) {
  if (!Array.isArray(rows) || rows.some((row) => !Array.isArray(row))) fail("XLSX_WRITE_INPUT", "Rândurile trebuie date ca listă de liste.");
  const numeric = cellSet(numericCells, "numericCells");
  const formulas = cellSet(formulaCells, "formulaCells");
  const inline = cellSet(inlineCells, "inlineCells");
  const name = String(sheetName ?? "").replace(/[[\]:*?/\\]/g, " ").trim().slice(0, 31) || "Foaia1";
  const sharedIndex = new Map();
  const shared = [];
  const tText = (text) => `<t${/^\s|\s$|\n/.test(text) ? ' xml:space="preserve"' : ""}>${escapeXmlText(text)}</t>`;
  const rowXml = rows.map((row, r) => {
    const cells = row.map((value, c) => {
      const key = cellKey(r, c);
      const text = value === null || value === undefined ? "" : String(value);
      const ref = `${columnName(c)}${r + 1}`;
      const isNumeric = numeric.has(key);
      if (isNumeric && !NUMBER_TEXT.test(text)) fail("XLSX_WRITE_INPUT", `Celula ${ref} e marcată numerică, dar „${shown(text, 30)}” nu e un număr.`);
      if (formulas.has(key)) {
        const formula = formulas.get(key) ?? (isNumeric ? `${text}+0` : `"${text.replace(/"/g, '""')}"`);
        return `<c r="${ref}"${isNumeric ? "" : ' t="str"'}><f>${escapeXmlText(formula)}</f><v>${escapeXmlText(text)}</v></c>`;
      }
      if (text === "") return "";
      if (isNumeric) return `<c r="${ref}"><v>${text}</v></c>`;
      if (inline.has(key)) return `<c r="${ref}" t="inlineStr"><is>${tText(text)}</is></c>`;
      if (!sharedIndex.has(text)) { sharedIndex.set(text, shared.length); shared.push(text); }
      return `<c r="${ref}" t="s"><v>${sharedIndex.get(text)}</v></c>`;
    }).join("");
    return `<row r="${r + 1}">${cells}</row>`;
  }).join("");
  const sharedCount = rows.reduce((n, row, r) => n + row.filter((v, c) => v !== null && v !== undefined && String(v) !== ""
    && !numeric.has(cellKey(r, c)) && !formulas.has(cellKey(r, c)) && !inline.has(cellKey(r, c))).length, 0);
  const files = [
    ["[Content_Types].xml", `${XML_DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      + '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>'
      + "</Types>"],
    ["_rels/.rels", `${XML_DECL}<Relationships xmlns="${NS_PKG_REL}">`
      + `<Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ["xl/workbook.xml", `${XML_DECL}<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">`
      + `<sheets><sheet name="${escapeXmlAttr(name)}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ["xl/_rels/workbook.xml.rels", `${XML_DECL}<Relationships xmlns="${NS_PKG_REL}">`
      + `<Relationship Id="rId1" Type="${NS_REL}/worksheet" Target="worksheets/sheet1.xml"/>`
      + `<Relationship Id="rId2" Type="${NS_REL}/styles" Target="styles.xml"/>`
      + `<Relationship Id="rId3" Type="${NS_REL}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`],
    ["xl/worksheets/sheet1.xml", `${XML_DECL}<worksheet xmlns="${NS_MAIN}"><sheetData>${rowXml}</sheetData></worksheet>`],
    ["xl/styles.xml", `${XML_DECL}<styleSheet xmlns="${NS_MAIN}">`
      + '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>'
      + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
      + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
      + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
      + '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>'
      + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'],
    ["xl/sharedStrings.xml", `${XML_DECL}<sst xmlns="${NS_MAIN}" count="${sharedCount}" uniqueCount="${shared.length}">`
      + `${shared.map((text) => `<si>${tText(text)}</si>`).join("")}</sst>`],
  ];
  return writeZip(files.map(([entryName, xml]) => ({ name: entryName, data: Buffer.from(xml, "utf8") })));
}

// ---------------------------------------------------------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------------------------------------------------------

// = + - @ start a formula in Excel/LibreOffice/Sheets; TAB, CR and leading spaces are stripped by some importers before
// that check. Full-width variants are included because some spreadsheet apps normalise them.
const FORMULA_START = /^[\t\r]|^[\s\u00A0]*[=+\-@\uFF1D\uFF0B\uFF0D\uFF20]/;

/**
 * One CSV cell, safe to open in a spreadsheet: text that could start a formula gets a leading apostrophe, and the cell is
 * quoted when it contains a quote, a newline or any of the delimiters `,` `;` TAB `|` (safe for whichever one Excel picks).
 * Finite numbers are written as numbers (a JS number cannot carry a formula).
 */
export function toCsvCell(value) {
  if (value === null || value === undefined) return "";
  let text;
  if (typeof value === "number") text = Number.isFinite(value) ? String(value) : "";
  else if (typeof value === "boolean" || typeof value === "bigint") text = String(value);
  else if (value instanceof Date) text = Number.isNaN(value.getTime()) ? "" : value.toISOString();
  else {
    text = String(value);
    if (FORMULA_START.test(text)) text = `'${text}`;
  }
  return /[",;\t|\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * A whole CSV export: UTF-8 BOM (so Excel reads the diacritics), CRLF line ends, every cell through `toCsvCell`.
 * @param {string[]} headers
 * @param {Array<Array<unknown>>} rows
 * @param {{ delimiter?: "," | ";" | "\t" | "|" }} [options] default "," (RFC 4180); ";" suits Excel with Romanian settings
 */
export function toCsv(headers, rows, { delimiter = "," } = {}) {
  if (!CSV_DELIMITERS.includes(delimiter)) fail("CSV_DELIMITER", "Delimitator CSV nesuportat.");
  const line = (cells) => (Array.isArray(cells) ? cells : []).map(toCsvCell).join(delimiter);
  return `\uFEFF${[line(headers), ...(Array.isArray(rows) ? rows : []).map(line)].join("\r\n")}\r\n`;
}
