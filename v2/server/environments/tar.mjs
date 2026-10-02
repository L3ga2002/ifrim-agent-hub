import crypto from "node:crypto";

/**
 * Minimal tar (POSIX ustar + pax extended headers) for the wsl-runner workspace transfer (M05 §15, §16).
 *
 * Writer: the Hub builds the archive that enters the environment (regular files only, names as pax `path` records when they
 * do not fit ustar). Reader: the archive that LEAVES the environment is untrusted input. The reader never touches the disk:
 * it reports every entry (type, normalized name, size, sha256) and hands each regular file's bytes to a callback, under hard
 * limits (entries, bytes per file, bytes in total). Anything it does not understand is reported as a problem, never guessed.
 */
export const BLOCK = 512;

const enc = new TextEncoder();

function octal(value, width) {
  const text = value.toString(8);
  if (text.length > width - 1) throw new Error(`tar: value ${value} does not fit ${width} octal digits`);
  return `${text.padStart(width - 1, "0")}\0`;
}

function writeString(buf, offset, width, text) {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length > width) throw new Error("tar: header field overflow");
  bytes.copy(buf, offset);
}

function header({ name, size = 0, mode = 0o644, mtime = 0, type = "0", linkname = "" }) {
  const buf = Buffer.alloc(BLOCK, 0);
  writeString(buf, 0, 100, name);
  writeString(buf, 100, 8, octal(mode & 0o7777, 8));
  writeString(buf, 108, 8, octal(0, 8));
  writeString(buf, 116, 8, octal(0, 8));
  writeString(buf, 124, 12, octal(size, 12));
  writeString(buf, 136, 12, octal(Math.max(0, Math.floor(mtime)), 12));
  buf.fill(0x20, 148, 156); // checksum placeholder (spaces)
  writeString(buf, 156, 1, type);
  writeString(buf, 157, 100, linkname);
  writeString(buf, 257, 6, "ustar\0");
  writeString(buf, 263, 2, "00");
  let sum = 0;
  for (const byte of buf) sum += byte;
  writeString(buf, 148, 8, `${sum.toString(8).padStart(6, "0")}\0 `);
  return buf;
}

function paxRecord(key, value) {
  const body = ` ${key}=${value}\n`;
  let length = Buffer.byteLength(body, "utf8");
  let total = length + String(length).length;
  if (String(total).length !== String(length).length) total = length + String(total).length;
  return `${total}${body}`;
}

const padding = (size) => Buffer.alloc((BLOCK - (size % BLOCK)) % BLOCK, 0);

/** ASCII-only names up to 100 bytes go into the ustar header; anything else gets a pax `path` record. */
const fitsUstar = (name) => /^[\x20-\x7e]{1,100}$/.test(name);

/**
 * Header (+ pax header when needed) and padded data for one entry. Used by the writer and by tests that need hand-made
 * hostile archives (links, devices, traversal names): `type` is the raw ustar type flag.
 */
export function tarEntry({ name, data = Buffer.alloc(0), mode = 0o644, mtime = 0, type = "0", linkname = "", pax = null }) {
  const parts = [];
  const records = { ...(pax || {}) };
  if (!fitsUstar(name)) records.path = name;
  if (linkname && !fitsUstar(linkname)) records.linkpath = linkname;
  if (Object.keys(records).length) {
    const body = Buffer.from(Object.entries(records).map(([k, v]) => paxRecord(k, v)).join(""), "utf8");
    parts.push(header({ name: "PaxHeader/entry", size: body.length, type: "x", mtime }), body, padding(body.length));
  }
  const size = type === "0" || type === "\0" ? data.length : 0;
  parts.push(header({ name: fitsUstar(name) ? name : name.replace(/[^\x20-\x7e]/g, "_").slice(-99), size, mode, mtime, type, linkname: fitsUstar(linkname) ? linkname : "" }));
  if (size) parts.push(data, padding(size));
  return Buffer.concat(parts);
}

export const tarEnd = () => Buffer.alloc(BLOCK * 2, 0);

/**
 * Streams regular files into `out` (a Writable), honouring backpressure. `files`: async iterable of { name, data, mode }.
 * Returns { entries, bytes }.
 */
export async function writeTar(out, files) {
  let entries = 0;
  let bytes = 0;
  const write = (chunk) => new Promise((resolve, reject) => {
    if (out.destroyed || out.writableEnded) { reject(Object.assign(new Error("tar: destination closed"), { code: "EPIPE" })); return; }
    const ok = out.write(chunk, (error) => { if (error) reject(error); });
    if (ok) resolve(); else out.once("drain", resolve);
  });
  for await (const file of files) {
    await write(tarEntry({ name: file.name, data: file.data, mode: file.mode ?? 0o644, mtime: file.mtime ?? 0 }));
    entries += 1;
    bytes += file.data.length;
  }
  await write(tarEnd());
  return { entries, bytes };
}

const TYPE_NAMES = { "0": "file", "\0": "file", "1": "hardlink", "2": "symlink", "3": "chardev", "4": "blockdev", "5": "directory", "6": "fifo", "7": "contiguous",
  x: "pax", g: "pax-global", L: "gnu-longname", K: "gnu-longlink", S: "gnu-sparse", V: "gnu-volume", M: "gnu-multivolume" };

function readString(buf, offset, width) {
  const slice = buf.subarray(offset, offset + width);
  const end = slice.indexOf(0);
  return slice.subarray(0, end < 0 ? width : end).toString("utf8");
}

function readOctal(buf, offset, width) {
  const first = buf[offset];
  if (first & 0x80) return NaN; // base-256 (GNU) sizes are never produced for files the Hub accepts
  const text = readString(buf, offset, width).trim();
  if (!text) return 0;
  if (!/^[0-7]+$/.test(text)) return NaN;
  return parseInt(text, 8);
}

function checksumOk(buf) {
  const stored = readOctal(buf, 148, 8);
  let sum = 0;
  for (let i = 0; i < BLOCK; i += 1) sum += i >= 148 && i < 156 ? 0x20 : buf[i];
  return stored === sum;
}

function parsePax(body) {
  const out = {};
  let rest = body;
  while (rest.length) {
    const space = rest.indexOf(0x20);
    if (space <= 0) throw new Error("malformed pax record");
    const length = Number(rest.subarray(0, space).toString("ascii"));
    if (!Number.isInteger(length) || length <= space + 1 || length > rest.length) throw new Error("malformed pax length");
    const record = rest.subarray(space + 1, length - 1).toString("utf8");
    const eq = record.indexOf("=");
    if (eq <= 0) throw new Error("malformed pax record");
    out[record.slice(0, eq)] = record.slice(eq + 1);
    rest = rest.subarray(length);
  }
  return out;
}

/** pax keys the reader understands; any other key (sparse maps, xattrs, ACLs…) makes the entry unsupported. */
const PAX_KNOWN = new Set(["path", "linkpath", "size", "mtime", "atime", "ctime", "uid", "gid", "uname", "gname", "charset", "hdrcharset", "comment"]);

export const EXPORT_LIMITS = Object.freeze({ maxEntries: 50000, maxFileBytes: 16 * 1024 * 1024, maxTotalBytes: 512 * 1024 * 1024, maxPaxBytes: 64 * 1024 });

/**
 * Incremental, strict tar reader. `push(chunk)` as data arrives; `end()` when the stream finishes. `onFile(entry, data)` is
 * called for each complete regular file within the per-file limit (data is a Buffer). Returns from `end()`:
 * { entries:[{ name, rawName, type, typeName, size, mode, sha256, linkname, problems[] }], problems[], complete, bytes }.
 * When a hard limit is crossed `aborted` is set and further input is ignored (the caller kills the producer).
 */
export function createTarReader({ limits = EXPORT_LIMITS, onFile = () => {} } = {}) {
  const entries = [];
  const problems = [];
  let pending = Buffer.alloc(0);
  let state = "header";
  let current = null;
  let need = BLOCK;
  let paxNext = null;
  let zeroBlocks = 0;
  let bytes = 0;
  let aborted = null;
  let complete = false;
  let chunks = [];
  let hash = null;
  let kept = 0;

  const abort = (why) => { if (!aborted) { aborted = why; problems.push(why); } };

  function startEntry(block) {
    if (block.every((b) => b === 0)) { zeroBlocks += 1; if (zeroBlocks >= 2) complete = true; return; }
    if (zeroBlocks) { problems.push("bloc gol izolat în arhivă"); zeroBlocks = 0; }
    if (!checksumOk(block)) { abort("antet tar cu checksum invalid"); return; }
    const magic = readString(block, 257, 6);
    if (magic !== "ustar") { abort(`antet tar fără magic ustar (${JSON.stringify(magic)})`); return; }
    const type = String.fromCharCode(block[156] || 0x30);
    const size = readOctal(block, 124, 12);
    if (!Number.isFinite(size)) { abort("mărime tar ilizibilă"); return; }
    const prefix = readString(block, 345, 155);
    const shortName = readString(block, 0, 100);
    const entry = { rawName: prefix ? `${prefix}/${shortName}` : shortName, type, typeName: TYPE_NAMES[type] || `unknown(${JSON.stringify(type)})`, size,
      mode: readOctal(block, 100, 8), linkname: readString(block, 157, 100), problems: [] };
    if (type === "x") {
      if (size > limits.maxPaxBytes) { abort("antet pax prea mare"); return; }
      if (paxNext) { abort("două antete pax consecutive"); return; }
      if (size === 0) { paxNext = {}; return; }
      current = { ...entry, pax: true };
      state = "pax"; need = size + ((BLOCK - (size % BLOCK)) % BLOCK); chunks = []; return;
    }
    // Global pax headers, GNU long names, sparse and multi-volume entries change how LATER entries are read; GNU tar does
    // not produce them with --format=pax for the files the Hub exports, so they end the read instead of being guessed.
    if (["g", "L", "K", "S", "V", "M"].includes(type)) { abort(`tip de intrare tar nesuportat (${TYPE_NAMES[type]})`); return; }
    if (paxNext) {
      if (paxNext.path !== undefined) entry.rawName = paxNext.path;
      if (paxNext.linkpath !== undefined) entry.linkname = paxNext.linkpath;
      if (paxNext.size !== undefined) {
        const s = Number(paxNext.size);
        // The data length decides where the next header starts: an unreadable size cannot be skipped safely.
        if (!/^\d+$/.test(String(paxNext.size)) || !Number.isSafeInteger(s)) { abort("mărime pax invalidă"); return; }
        entry.size = s;
      }
      const unknown = Object.keys(paxNext).filter((k) => !PAX_KNOWN.has(k));
      if (unknown.length) entry.problems.push(`chei pax nesuportate: ${unknown.slice(0, 5).join(", ")}`);
      paxNext = null;
    }
    // Links, directories and devices carry no data blocks; a non-zero size would make the rest of the archive ambiguous.
    if (["1", "2", "3", "4", "5", "6"].includes(type) && entry.size !== 0) { abort(`intrare ${TYPE_NAMES[type]} cu mărime nenulă (arhivă ambiguă)`); return; }
    if (entries.length >= limits.maxEntries) { abort(`peste ${limits.maxEntries} intrări în arhivă`); return; }
    entries.push(entry);
    current = entry;
    const dataBytes = ["1", "2", "3", "4", "5", "6"].includes(type) ? 0 : entry.size;
    if (dataBytes > 0) {
      if (entry.size > limits.maxFileBytes) entry.problems.push(`fișier peste limita de ${limits.maxFileBytes} octeți`);
      state = "data"; need = dataBytes + ((BLOCK - (dataBytes % BLOCK)) % BLOCK);
      hash = crypto.createHash("sha256"); chunks = []; kept = 0;
    } else if (type === "0" || type === "\0") {
      entry.sha256 = crypto.createHash("sha256").digest("hex");
      try { onFile(entry, Buffer.alloc(0)); } catch (error) { entry.problems.push(String(error.message || error).slice(0, 200)); }
    }
  }

  function consume(buf) {
    if (state === "header") { startEntry(buf); return; }
    if (state === "pax") {
      chunks.push(buf);
      if (need === 0) {
        const body = Buffer.concat(chunks).subarray(0, current.size);
        try { paxNext = parsePax(body); } catch (error) { abort(`antet pax invalid: ${error.message}`); }
        state = "header"; need = BLOCK; chunks = [];
      }
      return;
    }
    if (state === "data") {
      const remainingData = current.size - (current._read || 0);
      const dataPart = buf.subarray(0, Math.max(0, Math.min(buf.length, remainingData)));
      current._read = (current._read || 0) + dataPart.length;
      if (dataPart.length) {
        hash.update(dataPart);
        if (current.size <= limits.maxFileBytes) { chunks.push(dataPart); kept += dataPart.length; }
      }
      if (need === 0) {
        current.sha256 = hash.digest("hex");
        delete current._read;
        if ((current.type === "0" || current.type === "\0") && current.size <= limits.maxFileBytes) {
          try { onFile(current, Buffer.concat(chunks, kept)); } catch (error) { current.problems.push(String(error.message || error).slice(0, 200)); }
        }
        state = "header"; need = BLOCK; chunks = []; hash = null;
      }
    }
  }

  function push(chunk) {
    if (aborted || complete) return;
    bytes += chunk.length;
    if (bytes > limits.maxTotalBytes + BLOCK * 4) { abort(`arhiva depășește ${limits.maxTotalBytes} octeți`); return; }
    pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
    while (!aborted && !complete) {
      const take = state === "header" ? BLOCK : Math.min(need, pending.length);
      if (state === "header" && pending.length < BLOCK) break;
      if (state !== "header" && take === 0) break;
      const piece = pending.subarray(0, take);
      pending = pending.subarray(take);
      if (state !== "header") need -= take;
      consume(piece);
      if (state !== "header" && need > 0 && pending.length === 0) break;
    }
  }

  function end() {
    if (!complete && !aborted) problems.push(state === "header" && zeroBlocks === 0 ? "arhiva s-a terminat fără blocurile finale (trunchiată)" : "arhiva s-a terminat în mijlocul unei intrări (trunchiată)");
    return { entries: entries.map(({ _read, ...e }) => e), problems, complete: complete && !aborted, aborted, bytes };
  }

  return { push, end, get aborted() { return aborted; } };
}
