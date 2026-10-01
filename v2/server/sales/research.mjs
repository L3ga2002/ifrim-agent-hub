import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { HubError } from "../core/errors.mjs";
import { redactText } from "../security/redact.mjs";

/**
 * Sales research sources (M04 §2.3).
 *
 * Why a registry: every page the audit reads goes through one place that enforces the same limits whatever the source —
 * a timeout, a 2 MB body cap, text/html only, a per-source rate limit — and caches by adapter@version|target so a repeated
 * audit does not re-read the source, while simultaneous requests for the same target share one read.
 *
 * M04 is SIMULATED/LOCAL: the only working adapter reads fictitious fixture sites (`<dir>/<host>.html`, `.test` hosts).
 * The live HTTP adapter exists so the contract is explicit; every call to it is refused (LIVE_COLLECTION_DISABLED), and this
 * module contains no network code at all. `validateCollectorUrl` is the URL policy a future live collector must pass; it is
 * stricter than the Browser Workspace policy (localhost is allowed there for local E2E, refused here).
 */

export const MAX_BODY_BYTES = 2 * 1024 * 1024;
export const LIVE_COLLECTION_DISABLED = "LIVE_COLLECTION_DISABLED";
export const DEFAULT_FIXTURE_SITES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "fixtures", "sales", "sites");
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_MAX_CACHE_ENTRIES = 500;
const WINDOW_MS = 60_000;

const liveDisabled = () => new HubError("policy", "Colectarea live e dezactivată în M04 (LIVE_COLLECTION_DISABLED)", { code: LIVE_COLLECTION_DISABLED });
const clipText = (value, max = 200) => redactText(String(value ?? "").replace(/[\u0000-\u001F\u007F]/g, " ").trim()).slice(0, max);

/* ------------------------------------------------------------------ registry */

function toMs(value) {
  if (value instanceof Date) return value.getTime();
  const n = typeof value === "string" ? Date.parse(value) : Number(value);
  return Number.isFinite(n) ? n : Date.now();
}

function listAdapters(adapters) {
  if (Array.isArray(adapters)) return adapters.map((adapter) => [adapter?.id, adapter]);
  if (adapters && typeof adapters === "object") return Object.entries(adapters);
  return [];
}

function decodeBody(buffer, contentType) {
  const charset = /charset\s*=\s*"?([\w-]+)"?/i.exec(contentType)?.[1]?.toLowerCase() || "utf-8";
  try {
    return new TextDecoder(charset).decode(buffer);
  } catch {
    return new TextDecoder("utf-8").decode(buffer); // unknown charset label: UTF-8 with replacement characters
  }
}

/**
 * @param {{ adapters: Array<Adapter> | Record<string, Adapter>, clock?: () => Date | number, cache?: Map<string, any>,
 *   rateLimitPerMinute?: number, timeoutMs?: number, cacheTtlMs?: number, maxCacheEntries?: number, maxBodyBytes?: number }} options
 *   Adapter: `{ id, version, kind: "fixture" | "live" | string, normalize?(target) → string, fetch(target, { signal }) →
 *   Promise<{ status?, contentType, contentLength?, body: string | Buffer | Uint8Array | null, url? }> }`. In the map form the
 *   key is the adapter id. `maxBodyBytes` can only lower MAX_BODY_BYTES.
 * @returns {{ fetch(adapterId: string, target: string): Promise<{ adapterId, adapterVersion, sourceKind, target, finalUrl,
 *   contentType, body: string, bytes: number, fetchedAt: string, cached: boolean }> }}
 */
export function createSourceRegistry({ adapters, clock = () => new Date(), cache = new Map(), rateLimitPerMinute = 30, timeoutMs = DEFAULT_TIMEOUT_MS,
  cacheTtlMs = DEFAULT_CACHE_TTL_MS, maxCacheEntries = DEFAULT_MAX_CACHE_ENTRIES, maxBodyBytes = MAX_BODY_BYTES } = {}) {
  const table = new Map();
  for (const [key, adapter] of listAdapters(adapters)) {
    const id = String(key ?? "").trim();
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(id)) throw new HubError("validation", `Id de adaptor invalid: „${clipText(id, 64)}”.`);
    if (!adapter || typeof adapter.fetch !== "function") throw new HubError("validation", `Adaptorul „${id}” nu are o funcție fetch.`);
    if (table.has(id)) throw new HubError("conflict", `Adaptorul „${id}” e înregistrat de două ori.`);
    table.set(id, { adapter, id, version: String(adapter.version || "1").slice(0, 40), kind: String(adapter.kind || "custom").slice(0, 30) });
  }
  if (!table.size) throw new HubError("validation", "Registrul de surse are nevoie de cel puțin un adaptor.");
  if (!(cache instanceof Map)) throw new HubError("validation", "Cache-ul registrului de surse trebuie să fie un Map.");
  const limit = Math.max(1, Math.floor(Number(rateLimitPerMinute) || 30));
  const timeout = Math.max(1, Math.floor(Number(timeoutMs) || DEFAULT_TIMEOUT_MS));
  const ttl = Math.max(0, Number(cacheTtlMs) || 0);
  const maxEntries = Math.max(1, Math.floor(Number(maxCacheEntries) || DEFAULT_MAX_CACHE_ENTRIES));
  const maxBytes = Math.min(MAX_BODY_BYTES, Math.max(1, Math.floor(Number(maxBodyBytes) || MAX_BODY_BYTES)));
  const nowMs = () => toMs(clock());
  const inflight = new Map();
  const windows = new Map();

  function normalizeTarget(entry, target) {
    const value = typeof entry.adapter.normalize === "function" ? entry.adapter.normalize(target) : String(target ?? "").trim();
    const text = String(value ?? "").trim();
    if (!text) throw new HubError("validation", "Ținta cererii de sursă lipsește.");
    if (text.length > 2048) throw new HubError("validation", "Ținta cererii de sursă e prea lungă.");
    return text;
  }

  function takeRateSlot(entry) {
    const now = nowMs();
    const recent = (windows.get(entry.id) || []).filter((t) => now - t < WINDOW_MS);
    if (recent.length >= limit) {
      windows.set(entry.id, recent);
      throw new HubError("quota", `Limita de ${limit} cereri pe minut pentru sursa „${entry.id}” a fost atinsă; reîncearcă peste un minut.`, { code: "RATE_LIMITED" });
    }
    recent.push(now);
    windows.set(entry.id, recent);
  }

  function finalize(entry, target, response) {
    if (!response || typeof response !== "object") throw new HubError("transport", `Sursa „${entry.id}” a întors un răspuns invalid.`, { code: "SOURCE_INVALID_RESPONSE" });
    if (response.status !== undefined && response.status !== null && !(Number(response.status) >= 200 && Number(response.status) < 300)) {
      throw new HubError("transport", `Sursa „${entry.id}” a răspuns cu statusul ${clipText(response.status, 10)}.`, { code: "SOURCE_HTTP_STATUS" });
    }
    const declared = Number(response.contentLength);
    if (Number.isFinite(declared) && declared > maxBytes) throw new HubError("validation", `Pagina depășește limita de ${maxBytes} octeți.`, { code: "BODY_TOO_LARGE" });
    const contentType = String(response.contentType || "").trim();
    const mime = contentType.split(";")[0].trim().toLowerCase();
    if (mime !== "text/html") throw new HubError("validation", `Tip de conținut neacceptat: „${clipText(mime || "lipsă", 80)}”; se acceptă doar text/html.`, { code: "UNSUPPORTED_CONTENT_TYPE" });
    let buffer;
    if (typeof response.body === "string") buffer = Buffer.from(response.body, "utf8");
    else if (response.body instanceof Uint8Array) buffer = Buffer.from(response.body.buffer, response.body.byteOffset, response.body.byteLength);
    else throw new HubError("transport", `Sursa „${entry.id}” nu a întors conținut.`, { code: "SOURCE_EMPTY_BODY" });
    if (buffer.length > maxBytes) throw new HubError("validation", `Pagina depășește limita de ${maxBytes} octeți.`, { code: "BODY_TOO_LARGE" });
    return {
      adapterId: entry.id,
      adapterVersion: entry.version,
      sourceKind: entry.kind,
      target,
      finalUrl: clipText(response.url || target, 2048),
      contentType: clipText(contentType, 120),
      body: decodeBody(buffer, contentType),
      bytes: buffer.length,
      fetchedAt: new Date(nowMs()).toISOString(),
    };
  }

  async function read(entry, target) {
    const controller = new AbortController();
    let timer = null;
    const timedOut = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new HubError("transport", `Sursa „${entry.id}” nu a răspuns în ${timeout} ms.`, { code: "SOURCE_TIMEOUT" }));
      }, timeout);
    });
    try {
      const response = await Promise.race([Promise.resolve().then(() => entry.adapter.fetch(target, { signal: controller.signal })), timedOut]);
      return finalize(entry, target, response);
    } finally {
      clearTimeout(timer);
    }
  }

  function remember(key, value) {
    cache.delete(key);
    cache.set(key, { storedAt: nowMs(), value });
    while (cache.size > maxEntries) cache.delete(cache.keys().next().value); // oldest first (insertion order)
  }

  /** Reads `target` through adapter `adapterId`. Failures are never cached. */
  async function fetchSource(adapterId, target) {
    const id = String(adapterId ?? "").trim();
    const entry = table.get(id);
    if (!entry) {
      if (/^live/i.test(id)) throw liveDisabled();
      throw new HubError("not_found", `Sursa „${clipText(id, 64)}” nu e înregistrată.`);
    }
    // Live collection is refused before anything else: no normalization, no rate slot, no cache lookup.
    if (entry.kind === "live") throw liveDisabled();
    const normalized = normalizeTarget(entry, target);
    const key = `${entry.id}@${entry.version}|${normalized}`;
    const hit = cache.get(key);
    if (hit && hit.value && nowMs() - hit.storedAt < ttl) return { ...hit.value, cached: true };
    if (inflight.has(key)) return inflight.get(key);
    takeRateSlot(entry);
    const pending = read(entry, normalized)
      .then((value) => { remember(key, value); return { ...value, cached: false }; })
      .finally(() => inflight.delete(key));
    inflight.set(key, pending);
    return pending;
  }

  return { fetch: fetchSource };
}

/* ------------------------------------------------------------------ adapters */

const TEST_HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+test$/;

/** Host of a fixture target ("firma.test" or "https://firma.test/..."); only `.test` hosts, never a path on disk. */
function fixtureHost(target) {
  let raw = String(target ?? "").trim().toLowerCase();
  if (/^[a-z][a-z0-9+.-]*:/.test(raw)) {
    let url;
    try { url = new URL(raw); } catch { throw new HubError("validation", "Adresa site-ului fixture nu e un URL valid."); }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port) {
      throw new HubError("validation", "Adaptorul fixture acceptă doar adrese http(s) fără credențiale și fără port.");
    }
    raw = url.hostname;
  }
  raw = raw.replace(/\.$/, "");
  if (raw.length > 253 || !TEST_HOST.test(raw)) throw new HubError("validation", "Adaptorul fixture acceptă doar host-uri .test (de exemplu firma-exemplu.test).");
  return raw;
}

/**
 * Reads fictitious sites from `<dir>/<host>.html`. The page's scheme is http only when the fixture declares
 * `<meta name="fixture:scheme" content="http">` (to exercise the HTTPS check); otherwise https.
 */
export function fixtureSiteAdapter({ dir = DEFAULT_FIXTURE_SITES_DIR } = {}) {
  if (!dir || typeof dir !== "string") throw new HubError("validation", "Adaptorul fixture are nevoie de folderul cu site-uri fixture.");
  const base = path.resolve(dir);
  return Object.freeze({
    id: "fixture",
    version: "fixture-v1",
    kind: "fixture",
    normalize: fixtureHost,
    async fetch(target) {
      const host = fixtureHost(target);
      const file = path.join(base, `${host}.html`);
      if (path.dirname(file) !== base) throw new HubError("validation", "Calea fixture-ului iese din folderul permis.");
      let stat;
      try { stat = await fs.promises.lstat(file); } catch { stat = null; }
      if (!stat || !stat.isFile()) throw new HubError("not_found", `Nu există un site fixture pentru „${host}”.`); // symlinks are not followed
      const contentType = "text/html; charset=utf-8";
      if (stat.size > MAX_BODY_BYTES) return { status: 200, contentType, contentLength: stat.size, body: null, url: `https://${host}/` };
      const body = await fs.promises.readFile(file);
      const scheme = /<meta\s+name=["']fixture:scheme["']\s+content=["'](https?)["']/i.exec(body.subarray(0, 4096).toString("utf8"))?.[1]?.toLowerCase() || "https";
      return { status: 200, contentType, contentLength: stat.size, body, url: `${scheme}://${host}/` };
    },
  });
}

/**
 * The live HTTP collector of M04: registered so the contract is explicit, but every fetch is refused with
 * HubError("policy", …LIVE_COLLECTION_DISABLED). The registry also refuses any adapter of kind "live" before calling it.
 */
export function liveHttpAdapter() {
  return Object.freeze({
    id: "live-http",
    version: "disabled",
    kind: "live",
    async fetch() { throw liveDisabled(); },
  });
}

/* ------------------------------------------------------------------ collector URL policy */

const V4_BLOCKS = [
  ["0.0.0.0", 8, "o adresă „this network”"],
  ["10.0.0.0", 8, "o adresă privată"],
  ["100.64.0.0", 10, "o adresă CGNAT (rețea partajată)"],
  ["127.0.0.0", 8, "o adresă loopback"],
  ["169.254.0.0", 16, "o adresă link-local"],
  ["172.16.0.0", 12, "o adresă privată"],
  ["192.0.0.0", 24, "o adresă rezervată IETF"],
  ["192.0.2.0", 24, "o adresă de documentație"],
  ["192.88.99.0", 24, "o adresă de releu 6to4"],
  ["192.168.0.0", 16, "o adresă privată"],
  ["198.18.0.0", 15, "o adresă de testare"],
  ["198.51.100.0", 24, "o adresă de documentație"],
  ["203.0.113.0", 24, "o adresă de documentație"],
  ["224.0.0.0", 4, "o adresă multicast"],
  ["240.0.0.0", 4, "o adresă rezervată"],
].map(([base, bits, why]) => [v4ToInt(base), bits, why]);

function v4ToInt(address) {
  const parts = address.split(".").map(Number);
  return (((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]) >>> 0;
}

function v4Reason(address) {
  if (address === "169.254.169.254") return "adresa serviciului de metadate cloud (169.254.169.254)";
  const value = v4ToInt(address);
  for (const [base, bits, why] of V4_BLOCKS) {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    if (((value & mask) >>> 0) === base) return why;
  }
  return null;
}

/** Eight 16-bit groups of an IPv6 address (an embedded dotted IPv4 tail is accepted), or null. */
function v6Groups(address) {
  let text = address.toLowerCase();
  const lastColon = text.lastIndexOf(":");
  const tail = text.slice(lastColon + 1);
  if (tail.includes(".")) {
    if (net.isIP(tail) !== 4) return null;
    const p = tail.split(".").map(Number);
    text = `${text.slice(0, lastColon + 1)}${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const groups = [...head, ...Array(fill).fill("0"), ...rest].map((g) => parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

const groupsToV4 = (hi, lo) => `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;

function v6Reason(address) {
  if (address.includes("%")) return "o adresă IPv6 cu zonă de interfață (link-local)";
  const g = v6Groups(address);
  if (!g) return "o adresă IPv6 invalidă";
  const zeroUntil = (k) => g.slice(0, k).every((x) => x === 0);
  if (g.every((x) => x === 0)) return "adresa nespecificată (::)";
  if (zeroUntil(7) && g[7] === 1) return "adresa loopback (::1)";
  if (zeroUntil(5) && g[5] === 0xffff) { const why = v4Reason(groupsToV4(g[6], g[7])); return why ? `${why} (IPv4 mapată în IPv6)` : null; }
  if (zeroUntil(6)) return "o adresă IPv4-compatibilă (depreciată)";
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) { const why = v4Reason(groupsToV4(g[6], g[7])); return why ? `${why} (prin NAT64)` : null; }
  if (g[0] === 0x2002) { const why = v4Reason(groupsToV4(g[1], g[2])); return why ? `${why} (prin 6to4)` : null; }
  if ((g[0] & 0xfe00) === 0xfc00) return "o adresă IPv6 unică locală (fc00::/7)";
  if ((g[0] & 0xffc0) === 0xfe80) return "o adresă IPv6 link-local (fe80::/10)";
  if ((g[0] & 0xffc0) === 0xfec0) return "o adresă IPv6 site-local (depreciată)";
  if ((g[0] & 0xff00) === 0xff00) return "o adresă IPv6 multicast";
  if (g[0] === 0x2001 && g[1] === 0x0db8) return "o adresă IPv6 de documentație";
  if (g[0] === 0x2001 && g[1] === 0) return "o adresă Teredo (IPv4 ascunsă)";
  if (g[0] === 0x0100 && g.slice(1, 4).every((x) => x === 0)) return "o adresă IPv6 de tip discard";
  if ((g[0] & 0xe000) !== 0x2000) return "o adresă IPv6 în afara spațiului public (2000::/3)";
  return null;
}

/** Why an IP address is not a public destination, or null when it is public. */
function nonPublicReason(address) {
  const kind = net.isIP(address);
  if (kind === 4) return v4Reason(address);
  if (kind === 6) return v6Reason(address);
  return "o adresă IP invalidă";
}

const INTERNAL_SUFFIXES = [".localhost", ".local", ".internal", ".intranet", ".lan", ".home.arpa", ".localdomain", ".corp"];

/**
 * URL policy for a future live collector. `resolve(host)` is injected (async → array of address strings or { address });
 * without it the URL is refused, so this module never performs a DNS lookup itself. A host is accepted only when EVERY
 * resolved address is public (a public name resolving to 10.x is refused: DNS rebinding / SSRF). The connection that follows
 * must use the addresses validated here, not a second lookup.
 * @returns {Promise<{ ok: boolean, reason: string }>}
 */
export async function validateCollectorUrl(url, { resolve } = {}) {
  const refuse = (reason) => ({ ok: false, reason });
  const text = String(url ?? "").trim();
  if (!text) return refuse("URL-ul lipsește.");
  if (text.length > 2048) return refuse("URL-ul e prea lung (peste 2048 de caractere).");
  let parsed;
  try { parsed = new URL(text); } catch { return refuse("URL invalid."); }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return refuse(`Schema „${clipText(parsed.protocol.replace(/:$/, ""), 20)}” nu e permisă; doar http și https.`);
  if (parsed.username || parsed.password) return refuse("URL-ul conține credențiale; nu e permis.");
  if (parsed.port && parsed.port !== "80" && parsed.port !== "443") return refuse(`Portul ${parsed.port} nu e permis; doar 80 și 443.`);
  let host = parsed.hostname.toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  host = host.replace(/\.$/, "");
  if (!host) return refuse("URL-ul nu are host.");
  // The URL parser already turned shorthand IPv4 forms (2130706433, 0x7f.1, 127.1) into dotted quads.
  if (net.isIP(host)) {
    const why = nonPublicReason(host);
    return why ? refuse(`Adresa ${host} este ${why}; nu e permisă.`) : { ok: true, reason: `Adresă IP publică (${host}).` };
  }
  if (host === "localhost" || INTERNAL_SUFFIXES.some((suffix) => host.endsWith(suffix))) return refuse(`Host-ul ${host} e local sau intern; nu e permis.`);
  if (!host.includes(".")) return refuse(`Host-ul ${host} nu are domeniu (nume intern); nu e permis.`);
  if (typeof resolve !== "function") return refuse("Rezolvarea DNS nu e configurată; host-ul nu poate fi verificat.");
  let answer;
  try { answer = await resolve(host); } catch { return refuse(`Host-ul ${host} nu poate fi rezolvat.`); }
  const addresses = (Array.isArray(answer) ? answer : [answer])
    .map((a) => (typeof a === "string" ? a : a?.address))
    .filter((a) => typeof a === "string" && a.trim())
    .map((a) => a.trim().replace(/^\[|\]$/g, ""));
  if (!addresses.length) return refuse(`Host-ul ${host} nu are nicio adresă.`);
  for (const address of addresses) {
    if (!net.isIP(address)) return refuse(`Rezolvarea lui ${host} a întors o adresă invalidă.`);
    const why = nonPublicReason(address);
    if (why) return refuse(`Host-ul ${host} se rezolvă în ${address}, care este ${why}; refuzat (protecție DNS rebinding / SSRF).`);
  }
  return { ok: true, reason: `Host public; ${addresses.length} ${addresses.length === 1 ? "adresă verificată" : "adrese verificate"}.` };
}
