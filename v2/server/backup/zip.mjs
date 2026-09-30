import fs from "node:fs/promises";
import zlib from "node:zlib";
import { promisify } from "node:util";

const deflateRaw = promisify(zlib.deflateRaw);
const MAX_ENTRIES = 65534;
const MAX_32 = 0xfffffffe;

function dosDateTime(date) {
  const d = new Date(date);
  const year = Math.max(1980, d.getFullYear());
  return {
    time: ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | (Math.floor(d.getSeconds() / 2) & 31),
    date: (((year - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31),
  };
}

/**
 * Minimal streaming ZIP writer (deflate or store, UTF-8 names, no ZIP64). Refuses inputs beyond
 * classic ZIP limits instead of producing a corrupt archive.
 */
export async function createZipWriter(filePath) {
  const handle = await fs.open(filePath, "wx");
  const central = [];
  let offset = 0;

  async function write(buffer) {
    await handle.write(buffer, 0, buffer.length, offset);
    offset += buffer.length;
  }

  async function addFile(entryName, data, mtime = new Date()) {
    if (central.length >= MAX_ENTRIES) throw new Error("ZIP entry limit reached (ZIP64 not supported)");
    if (data.length > MAX_32) throw new Error(`File too large for classic ZIP: ${entryName}`);
    const name = Buffer.from(entryName.replaceAll("\\", "/"), "utf8");
    const crc = zlib.crc32(data) >>> 0;
    const deflated = data.length ? await deflateRaw(data, { level: 6 }) : Buffer.alloc(0);
    const useDeflate = deflated.length < data.length;
    const payload = useDeflate ? deflated : data;
    const method = useDeflate ? 8 : 0;
    const { time, date } = dosDateTime(mtime);
    if (offset > MAX_32) throw new Error("Archive exceeds classic ZIP size limit");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(method, 8); local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(payload.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    const headerOffset = offset;
    await write(local); await write(name); await write(payload);
    central.push({ name, crc, method, time, date, compressed: payload.length, size: data.length, headerOffset });
  }

  async function close() {
    const start = offset;
    for (const entry of central) {
      const header = Buffer.alloc(46);
      header.writeUInt32LE(0x02014b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(20, 6); header.writeUInt16LE(0x0800, 8);
      header.writeUInt16LE(entry.method, 10); header.writeUInt16LE(entry.time, 12); header.writeUInt16LE(entry.date, 14);
      header.writeUInt32LE(entry.crc, 16); header.writeUInt32LE(entry.compressed, 20); header.writeUInt32LE(entry.size, 24);
      header.writeUInt16LE(entry.name.length, 28); header.writeUInt16LE(0, 30); header.writeUInt16LE(0, 32);
      header.writeUInt16LE(0, 34); header.writeUInt16LE(0, 36); header.writeUInt32LE(0, 38); header.writeUInt32LE(entry.headerOffset, 42);
      await write(header); await write(entry.name);
    }
    const size = offset - start;
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6);
    end.writeUInt16LE(central.length, 8); end.writeUInt16LE(central.length, 10);
    end.writeUInt32LE(size, 12); end.writeUInt32LE(start, 16); end.writeUInt16LE(0, 20);
    await write(end);
    await handle.sync();
    await handle.close();
    return { entries: central.length, bytes: offset };
  }

  async function abort() {
    try { await handle.close(); } catch { /* already closed */ }
  }

  return { addFile, close, abort };
}

/** Reads a ZIP produced by `createZipWriter` (or any non-ZIP64 archive) and verifies CRC32 per entry. */
export async function readZip(filePath) {
  const data = await fs.readFile(filePath);
  let eocd = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 65557); i -= 1) {
    if (data.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Not a ZIP archive (end of central directory missing)");
  const count = data.readUInt16LE(eocd + 10);
  let pointer = data.readUInt32LE(eocd + 16);
  const entries = [];
  for (let i = 0; i < count; i += 1) {
    if (data.readUInt32LE(pointer) !== 0x02014b50) throw new Error("Corrupt central directory");
    const method = data.readUInt16LE(pointer + 10);
    const crc = data.readUInt32LE(pointer + 16);
    const compressed = data.readUInt32LE(pointer + 20);
    const size = data.readUInt32LE(pointer + 24);
    const nameLength = data.readUInt16LE(pointer + 28);
    const extraLength = data.readUInt16LE(pointer + 30);
    const commentLength = data.readUInt16LE(pointer + 32);
    const localOffset = data.readUInt32LE(pointer + 42);
    const name = data.subarray(pointer + 46, pointer + 46 + nameLength).toString("utf8");
    pointer += 46 + nameLength + extraLength + commentLength;
    const localNameLength = data.readUInt16LE(localOffset + 26);
    const localExtraLength = data.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const raw = data.subarray(start, start + compressed);
    entries.push({
      name, size, method,
      read() {
        const content = method === 8 ? zlib.inflateRawSync(raw) : method === 0 ? Buffer.from(raw) : null;
        if (!content) throw new Error(`Unsupported compression method ${method} for ${name}`);
        if (content.length !== size || (zlib.crc32(content) >>> 0) !== crc) throw new Error(`CRC/size mismatch for ${name}`);
        return content;
      },
    });
  }
  return entries;
}
