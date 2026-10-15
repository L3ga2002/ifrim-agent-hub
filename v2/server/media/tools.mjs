// M09 media tools (ffmpeg / ffprobe). Every call is an argv array started by the supervisor (no shell, hidden window, allowlisted
// environment, whole-tree kill), with a timeout and a cancel key. Inputs are local files only: each input gets
// `-protocol_whitelist file,pipe` (a crafted playlist cannot make ffmpeg open http/tcp/udp), filter graphs that open files or
// sockets on their own (movie/amovie/zmq) are refused, and an output that looks like a URL is refused.
// Production resolves the binaries on PATH (where.exe) unless config names them. Identity (version + sha256 + shared libraries)
// is split in three (M10.2):
// - inspect(): reads the identity and compares it with settings.mediaToolPins → PINNED | UNPINNED | CHANGED | MISSING per tool.
//   It NEVER writes (no setting, no row, no event): GET /api/media/tools, the editors' registry and the Studio status call it, and
//   a read must not be the moment a binary becomes trusted. Version reads are cached by size+mtime for 60 s.
// - pin({ actor, reason }): the explicit act (the owner's command, the MEDIA_A ceremony, or an automatic readiness step listed in
//   a confirmed plan) that records the first identity, or records a different binary as CHANGED (previous kept, unacknowledged).
// - resolve(): the render path. It inspects and refuses UNPINNED (TOOLS_NOT_PINNED) or an unacknowledged change (TOOL_CHANGED)
//   before the real job spawns anything, so a binary identity change is never adopted silently.
// Test mode uses config.mediaTools.launcher ({ executable, prefixArgs, env } per tool).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { HubError } from "../core/errors.mjs";
import { newId } from "../core/ids.mjs";
import { normalizeProbe } from "./probe.mjs";

export const MEDIA_TOOL_NAMES = Object.freeze(["ffmpeg", "ffprobe"]);
/** Per-tool identity state reported by inspect(). */
export const MEDIA_TOOL_STATES = Object.freeze(["PINNED", "UNPINNED", "CHANGED", "MISSING"]);
export const PROTOCOL_WHITELIST = "file,pipe";
// How long a `-version` read stays valid for an unchanged file (size + mtime): repeated GETs within it spawn nothing.
const INSPECT_TTL_MS = 60 * 1000;
const DEFAULT_TIMEOUT_MS = { ffmpeg: 30 * 60 * 1000, ffprobe: 60 * 1000 };
const MAX_TIMEOUT_MS = 6 * 60 * 60 * 1000;
const VERSION_TIMEOUT_MS = 15 * 1000;
const MAX_STDERR_LINES = 20000;
const MAX_ARGS = 4000;
const MAX_ARG_CHARS = 32 * 1024;
// Filters that open a file, a URL or a socket by themselves (bypassing the input whitelist). Text/subtitle files are read by
// drawtext/subtitles from the job folder and stay allowed.
// `zmq` without options still listens on tcp://localhost:5555, so a bare name is refused too ("name@instance" included).
const FORBIDDEN_FILTER = /(^|[^a-z0-9_])(a?movie|a?zmq)(@[a-z0-9_]+)?\s*(=|$|[,;[])/im;
const URL_LIKE = /^[a-z][a-z0-9+.-]+:/i; // at least two characters before ":" (a drive letter "C:" is not a scheme)
const VERSION_LINE = /^(ffmpeg|ffprobe) version (\S+)/i;

/** Library DLLs of a shared ffmpeg build (the code that actually decodes lives there, so they are part of the identity). */
const SHARED_LIB = /^(av(codec|device|filter|format|util)|sw(resample|scale)|postproc)[-.].*\.(dll|so(\.\d+)*|dylib)$/i;

function sha256File(file) {
  const hash = crypto.createHash("sha256");
  const fd = fs.openSync(file, "r");
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let read;
    while ((read = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, read));
  } finally { fs.closeSync(fd); }
  return hash.digest("hex");
}

/**
 * The argv fragment for one local input: `-protocol_whitelist file,pipe -i <path>`. URL-like values are refused; a relative
 * name starting with "-" is prefixed with "./" so it can never be read as an option.
 */
export function inputArgs(p, { format = null } = {}) {
  const value = safeFileArg(p, "intrare");
  const out = [];
  if (format) {
    if (!/^[a-z0-9_,]{1,32}$/i.test(format) || /^lavfi$/i.test(format)) throw new HubError("validation", "Format de intrare nepermis.", { code: "MEDIA_ARG_REFUSED" });
    out.push("-f", format);
  }
  out.push("-protocol_whitelist", PROTOCOL_WHITELIST, "-i", value);
  return out;
}

/** A safe output file argument (same rules as inputs). */
export function outputArg(p) { return safeFileArg(p, "ieșire"); }

function safeFileArg(p, label) {
  if (typeof p !== "string" || !p.trim() || p.includes("\0") || /[\r\n]/.test(p)) throw new HubError("validation", `Cale de ${label} invalidă.`, { code: "MEDIA_ARG_REFUSED" });
  if (URL_LIKE.test(p)) throw new HubError("policy", `Fișierele media de ${label} trebuie să fie locale; adresele (http:, tcp:, file: etc.) sunt refuzate.`, { code: "MEDIA_URL_REFUSED" });
  if (!path.isAbsolute(p) && p.startsWith("-")) return `.${path.sep}${p}`;
  return p;
}

function checkFilterValue(value) {
  if (FORBIDDEN_FILTER.test(value)) throw new HubError("policy", "Filtrele care deschid singure fișiere sau conexiuni (movie, amovie, zmq) sunt refuzate.", { code: "MEDIA_FILTER_REFUSED" });
}

/**
 * Normalises and checks an ffmpeg/ffprobe argv. Returns the final argv (prefix + whitelists inserted before each -i).
 * Refuses: non-string args, a different protocol whitelist, URL inputs/outputs, lavfi inputs with file-opening filters,
 * filter scripts that cannot be inspected, and forbidden filters anywhere.
 */
export function prepareArgs(tool, args, { cwd = null, progress = false } = {}) {
  if (!MEDIA_TOOL_NAMES.includes(tool)) throw new HubError("validation", `Unealtă media necunoscută: ${tool}.`, { code: "MEDIA_TOOL_UNKNOWN" });
  if (!Array.isArray(args) || args.length > MAX_ARGS) throw new HubError("validation", "Argumentele uneltei media trebuie să fie o listă.", { code: "MEDIA_ARG_REFUSED" });
  for (const a of args) {
    if (typeof a !== "string" || a.includes("\0") || a.length > MAX_ARG_CHARS) throw new HubError("validation", "Argument invalid pentru unealta media.", { code: "MEDIA_ARG_REFUSED" });
  }
  const out = tool === "ffmpeg" ? ["-hide_banner", "-nostdin"] : ["-hide_banner"];
  if (progress && tool === "ffmpeg" && !args.includes("-progress")) out.push("-progress", "pipe:1", "-nostats");
  let inputs = 0;
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "-hide_banner" || a === "-nostdin") continue;
    if (a === "-protocol_whitelist") {
      if (args[i + 1] !== PROTOCOL_WHITELIST) throw new HubError("policy", `Lista de protocoale pentru intrări este fixă: ${PROTOCOL_WHITELIST}.`, { code: "MEDIA_WHITELIST_REFUSED" });
      if (args[i + 2] !== "-i") throw new HubError("validation", "-protocol_whitelist trebuie să stea imediat înaintea lui -i.", { code: "MEDIA_ARG_REFUSED" });
      i += 1; // skip its value; both are re-emitted together with the -i below
      continue;
    }
    if (/^-(protocol_blacklist|rtsp_transport|listen|http_proxy|cookies|headers|user_agent)$/.test(a)) throw new HubError("policy", `Opțiunea ${a} este refuzată pentru unelte media locale.`, { code: "MEDIA_ARG_REFUSED" });
    if (a === "-i") {
      const value = args[i + 1];
      if (value === undefined) throw new HubError("validation", "-i fără fișier de intrare.", { code: "MEDIA_ARG_REFUSED" });
      const fmt = formatBefore(args, i);
      let safe;
      if (fmt && /^lavfi$/i.test(fmt)) { checkFilterValue(value); safe = value; } // a generated source (testsrc, color, sine)
      else if (value === "pipe:0" || value === "-") safe = value; // stdin (the supervisor's pipe)
      else safe = safeFileArg(value, "intrare");
      out.push("-protocol_whitelist", PROTOCOL_WHITELIST, "-i", safe);
      inputs += 1;
      i += 1;
      continue;
    }
    if (/^-(filter_complex|lavfi|vf|af|filter(:[va])?(:\d+)?|filter_complex_threads)$/.test(a) && args[i + 1] !== undefined) {
      if (a !== "-filter_complex_threads") checkFilterValue(args[i + 1]);
      out.push(a, args[i + 1]);
      i += 1;
      continue;
    }
    if (/^-(\/filter_complex|\/vf|\/af|\/filter(:[va])?|filter_complex_script|filter_script(:[va])?)$/.test(a) && args[i + 1] !== undefined) {
      // A graph read from a file: inspect the file itself (relative to the job folder), otherwise refuse.
      const file = path.resolve(cwd || process.cwd(), args[i + 1]);
      let text;
      try { text = fs.readFileSync(file, "utf8"); } catch { throw new HubError("validation", "Fișierul de filtre nu poate fi citit pentru verificare.", { code: "MEDIA_ARG_REFUSED" }); }
      checkFilterValue(text);
      out.push(a, args[i + 1]);
      i += 1;
      continue;
    }
    out.push(a);
  }
  if (tool === "ffmpeg" && inputs > 0) {
    // The last argument of an ffmpeg encode is the output: never a URL (rtmp:, http:, tcp:…).
    const last = args[args.length - 1];
    if (last && !last.startsWith("-") && URL_LIKE.test(last) && !/^pipe:\d?$/.test(last)) throw new HubError("policy", "Ieșirea media trebuie să fie un fișier local.", { code: "MEDIA_URL_REFUSED" });
  }
  return out;
}

function formatBefore(args, inputIndex) {
  // The -f that applies to this input: the nearest -f after the previous -i.
  for (let j = inputIndex - 1; j >= 0; j -= 1) {
    if (args[j] === "-i") return null;
    if (args[j] === "-f") return args[j + 1] || null;
  }
  return null;
}

/** Parses `-progress pipe:1` blocks. Returns a feeder: feed(line) → progress object at each `progress=` line, else null. */
export function createProgressParser() {
  let block = {};
  return function feed(line) {
    const index = line.indexOf("=");
    if (index <= 0) return null;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    block[key] = value;
    if (key !== "progress") return null;
    const us = Number(block.out_time_us ?? block.out_time_ms); // ffmpeg's out_time_ms is in microseconds (historic name)
    const outTimeMs = Number.isFinite(us) && us >= 0 ? Math.round(us / 1000) : null;
    const result = { outTimeMs, frame: block.frame !== undefined && Number.isFinite(Number(block.frame)) ? Number(block.frame) : null,
      fps: Number.isFinite(Number(block.fps)) ? Number(block.fps) : null, speed: block.speed && block.speed !== "N/A" ? block.speed : null,
      totalSize: Number.isFinite(Number(block.total_size)) ? Number(block.total_size) : null, done: value === "end" };
    block = {};
    return result;
  };
}

/**
 * `createMediaTools({ config, supervisor, settings, bus, clock })`.
 */
export function createMediaTools({ config, supervisor, settings = null, bus = null, clock = () => new Date(), finder = null }) {
  if (!config || !supervisor) throw new Error("createMediaTools requires config and supervisor");
  const running = new Map(); // key → { cancelled, timedOut }
  let closing = false;
  const boot = () => { closing = false; };
  const beginClose = () => { closing = true; };
  const close = async () => {
    beginClose();
    const results = await Promise.all([...running.keys()].map((key) => cancel(key)));
    if (results.some((r) => !r.stopped)) throw new Error("Media tool process survived shutdown");
  };
  const identityCache = new Map(); // file → { sig, sha256 }
  const lookupCache = new Map(); // tool → absolute path found on PATH (production)
  const versionCache = new Map(); // tool → { identityFile, sig, at, version } (a `-version` read, valid INSPECT_TTL_MS)
  let resolved = null; // last inspect() result, in memory only (production run() and the Studio status rely on it)
  let inspecting = null;

  const launcherConfig = () => config.mediaTools?.launcher || null;

  function cachedSha(file) {
    const st = fs.statSync(file);
    const sig = `${st.size}:${st.mtimeMs}`;
    const hit = identityCache.get(file);
    if (hit && hit.sig === sig) return hit.sha256;
    const sha256 = sha256File(file);
    identityCache.set(file, { sig, sha256 });
    return sha256;
  }
  /** sha256 over the sorted (name, sha) of the shared libraries next to the binary; null for a static build. */
  function libsSha(file) {
    let names;
    try { names = fs.readdirSync(path.dirname(file)).filter((n) => SHARED_LIB.test(n)).sort(); } catch { return null; }
    if (!names.length) return null;
    const hash = crypto.createHash("sha256");
    for (const n of names) hash.update(`${n}\0${cachedSha(path.join(path.dirname(file), n))}\n`);
    return hash.digest("hex");
  }

  /** PATH lookup (production only). `.cmd`/`.bat` shims are never accepted. */
  function lookup(tool) {
    const configured = config.mediaTools?.[tool];
    if (configured) return fs.existsSync(configured) && fs.statSync(configured).isFile() ? path.resolve(configured) : null;
    if (finder) return finder(tool);
    try {
      const cmd = process.platform === "win32" ? "where.exe" : "which";
      const out = execFileSync(cmd, [tool], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true, timeout: 10000 });
      const hit = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
        .find((s) => !/\.(cmd|bat|ps1)$/i.test(s) && fs.existsSync(s) && fs.statSync(s).isFile());
      return hit ? path.resolve(hit) : null;
    } catch { return null; }
  }

  /** What to spawn for `tool`: `{ executable, prefixArgs, env, identityFile }` or null when absent. */
  function launcherFor(tool) {
    const launchers = launcherConfig();
    if (launchers) {
      const l = launchers[tool];
      if (!l?.executable) return null;
      // The identity of a test launcher is the real binary behind the proxy, else the fixture script.
      const real = l.env?.IFRIM_REAL_TOOL;
      if (real !== undefined && (!real || !fs.existsSync(real))) return null;
      const identityFile = real || l.prefixArgs?.[0] || l.executable;
      return { executable: l.executable, prefixArgs: [...(l.prefixArgs || [])], env: { ...(l.env || {}) }, identityFile };
    }
    if (config.testMode) return null; // test mode never searches PATH
    // where.exe is synchronous: the hit is cached and looked up again only when the file is gone.
    let file = lookupCache.get(tool);
    if (!file || !fs.existsSync(file)) { file = lookup(tool); if (file) lookupCache.set(tool, file); else lookupCache.delete(tool); }
    return file ? { executable: file, prefixArgs: [], env: {}, identityFile: file } : null;
  }

  async function readVersion(tool, launcher) {
    const r = await spawnTool({ tool, launcher, argv: ["-hide_banner", "-version"], cwd: workCwd(), timeoutMs: VERSION_TIMEOUT_MS, key: `media:${tool}:version:${newId("v")}`, maxStdoutLines: 50 });
    if (r.code !== 0) return null;
    for (const line of r.stdoutLines) { const m = VERSION_LINE.exec(line.trim()); if (m) return m[2]; }
    return null;
  }

  function workCwd() {
    const dir = path.resolve(config.mediaWorkDir || config.workDir || process.cwd());
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  // ---------------------------------------------------------------- identity: inspect (read-only) / pin / acknowledge / resolve

  /** The identity of one tool now: `{ path, version, sha256, libsSha256 }`, or null when absent. Never writes anything. */
  async function identify(tool) {
    const launcher = launcherFor(tool);
    if (!launcher) return null;
    let sig; let sha256; let libs;
    try {
      const st = fs.statSync(launcher.identityFile);
      sig = `${st.size}:${st.mtimeMs}`;
      sha256 = cachedSha(launcher.identityFile);
      libs = libsSha(launcher.identityFile);
    } catch { versionCache.delete(tool); return null; }
    // The `-version` read is the only spawn of an inspection: reused for 60 s while the file (and its libraries) did not change,
    // so a Studio that polls the tools list does not start a process per GET.
    const at = clock().getTime();
    const hit = versionCache.get(tool);
    let version;
    if (hit && hit.identityFile === launcher.identityFile && hit.sig === sig && hit.libsSha256 === libs && at >= hit.at && at - hit.at < INSPECT_TTL_MS) {
      version = hit.version;
    } else {
      try {
        version = await readVersion(tool, launcher);
        versionCache.set(tool, { identityFile: launcher.identityFile, sig, libsSha256: libs, at, version });
      } catch (error) {
        if (error?.code === "TOOL_MISSING") { versionCache.delete(tool); return null; }
        version = null; // e.g. a busy key: unreadable this time, not cached
      }
    }
    return { path: launcher.identityFile, version, sha256, libsSha256: libs };
  }

  async function identifyAll() {
    const ids = {};
    for (const tool of MEDIA_TOOL_NAMES) ids[tool] = await identify(tool);
    return ids;
  }

  const currentPins = () => (settings ? settings.get("mediaToolPins") || {} : {});

  /** PINNED | UNPINNED | CHANGED (recorded = the pin already holds the new identity, awaiting acknowledgement) | MISSING. */
  function stateOf(info, pin) {
    if (!info) return { state: "MISSING", recorded: false };
    if (!pin?.sha256) return { state: "UNPINNED", recorded: false };
    // An unreadable version does not count as a change by itself (the bytes decide); a readable different one does.
    const differs = pin.sha256 !== info.sha256 || (pin.libsSha256 || null) !== (info.libsSha256 || null) || (info.version !== null && pin.version !== info.version);
    if (differs) return { state: "CHANGED", recorded: false };
    if (pin.changedAt && !pin.acknowledged) return { state: "CHANGED", recorded: true };
    return { state: "PINNED", recorded: false };
  }

  /** Builds the inspection result (the M09 resolve() shape + per-tool `state`) and keeps it in memory as lastResolved(). */
  function summarize(ids, pins) {
    const out = { ok: true, usable: true, problems: [], warnings: [], states: {}, inspectedAt: clock().toISOString() };
    for (const tool of MEDIA_TOOL_NAMES) {
      const info = ids[tool];
      const s = stateOf(info, pins[tool]);
      out.states[tool] = s.state;
      out[tool] = info ? { ...info, state: s.state, ...(s.state === "CHANGED" ? { changeRecorded: s.recorded } : {}) } : null;
      if (s.state !== "PINNED") out.usable = false;
      if (s.state === "MISSING") { out.ok = false; out.problems.push(`${tool}_missing`); continue; }
      if (!info.version) out.warnings.push(`${tool}_version_unreadable`);
      if (s.state === "UNPINNED") out.problems.push("tools_not_pinned");
      if (s.state === "CHANGED") out.problems.push("tool_changed");
    }
    out.problems = [...new Set(out.problems)];
    resolved = out;
    return out;
  }

  /**
   * Read-only verification of both tools: present, version, sha256 (+ shared libraries), compared with the pins. Writes NO setting,
   * row or event (a GET calls it); a different binary is reported as CHANGED, never adopted.
   */
  async function inspect() {
    if (inspecting) return inspecting;
    inspecting = (async () => summarize(await identifyAll(), currentPins()))();
    try { return await inspecting; } finally { inspecting = null; }
  }

  const actorOf = (actor) => {
    if (typeof actor !== "string" || !actor.trim() || actor.length > 120) throw new HubError("validation", "Lipsește autorul operației (actor).", { code: "ACTOR_REQUIRED" });
    return actor.trim();
  };
  const identityOf = (info) => ({ path: info.path, version: info.version, sha256: info.sha256, libsSha256: info.libsSha256 || null });
  const previousOf = (pin) => ({ path: pin.path || null, version: pin.version || null, sha256: pin.sha256, libsSha256: pin.libsSha256 || null, pinnedAt: pin.pinnedAt || null });

  /**
   * The explicit pin (the owner's command, the MEDIA_A ceremony, or an automatic step listed in a confirmed plan; `actor` is who,
   * recorded on the pin and its events). All or nothing: both tools must be present and, unless already pinned, have a readable
   * version. First identity → `media.tool.pinned`; a different binary → recorded as CHANGED (`media.tool.changed`, previous kept,
   * unacknowledged): pinning never acknowledges a change. Already pinned / already recorded → nothing is written.
   * `expect` (optional, M10.2 #30): the identity the owner was shown per tool ({ sha256, libsSha256, version }); when given, the pin
   * records ONLY that identity (compared inside the pin transaction) and refuses with TOOL_CHANGED otherwise.
   * → { pinned: [tool], changed: [tool], unchanged: [tool], tools: inspection }.
   */
  async function pin({ actor, reason = "", expect = null } = {}) {
    const who = actorOf(actor);
    if (!settings || !bus) throw new HubError("internal", "Setările nu sunt disponibile.");
    const why = String(reason || "").slice(0, 200);
    const shown = expectedOf(expect);
    const ids = await identifyAll();
    const missing = MEDIA_TOOL_NAMES.filter((t) => !ids[t]);
    if (missing.length) {
      summarize(ids, currentPins());
      throw new HubError("tool", `${missing.join(" și ")} ${missing.length > 1 ? "nu sunt disponibile" : "nu este disponibil"} (instalează-l sau verifică PATH); nu am fixat nimic.`, { code: "TOOL_MISSING", data: { missing } });
    }
    let out;
    try { out = pinInTransaction(ids, who, why, shown); } catch (error) { summarize(ids, currentPins()); throw error; }
    return { ...out, tools: summarize(ids, currentPins()) };
  }

  /**
   * M10.2 (#30): the identity the owner was shown (a plan card, the Studio → Unelte panel) → { tool: { sha256, libsSha256, version } },
   * or null when none was given (the MEDIA_A ceremony, a bare owner command: they pin what is on disk, as before). Validated here so a
   * malformed expectation is refused instead of silently comparing nothing.
   */
  function expectedOf(expect) {
    if (expect === null || expect === undefined) return null;
    if (typeof expect !== "object" || Array.isArray(expect)) throw new HubError("validation", "Identitatea arătată (expect) trebuie să fie un obiect.", { code: "MEDIA_EXPECT_INVALID" });
    const out = {};
    for (const [tool, want] of Object.entries(expect)) {
      if (!MEDIA_TOOL_NAMES.includes(tool)) throw new HubError("validation", `Unealtă media necunoscută: ${tool}.`, { code: "MEDIA_TOOL_UNKNOWN" });
      if (want === null || want === undefined) continue;
      if (typeof want !== "object" || !/^[0-9a-f]{64}$/.test(String(want.sha256 || ""))) throw new HubError("validation", `Identitatea arătată pentru ${tool} nu are un sha256 valid.`, { code: "MEDIA_EXPECT_INVALID" });
      const libs = want.libsSha256 ?? null;
      if (libs !== null && !/^[0-9a-f]{64}$/.test(String(libs))) throw new HubError("validation", `Identitatea arătată pentru ${tool} are o amprentă a bibliotecilor invalidă.`, { code: "MEDIA_EXPECT_INVALID" });
      out[tool] = { sha256: want.sha256, libsSha256: libs, version: want.version == null ? null : String(want.version).slice(0, 80) };
    }
    return out;
  }
  /**
   * Whether the identity about to be recorded is exactly the one shown: sha256, the shared-library set (a missing libs field counts as
   * "no shared libraries shown", so a DLL set swapped in after the card was drawn is refused — fail closed) and the version when both
   * sides know it. Returns the names that differ.
   */
  const differsFromShown = (info, want) => [
    ...(want.sha256 !== info.sha256 ? ["sha256"] : []),
    ...((want.libsSha256 || null) !== (info.libsSha256 || null) ? ["biblioteci"] : []),
    ...(want.version !== null && info.version !== null && want.version !== info.version ? ["versiune"] : []),
  ];

  function pinInTransaction(ids, who, why, shown = null) {
    return bus.transaction(() => {
      const pins = settings.get("mediaToolPins") || {};
      // M10.2 (#30): the comparison with the identity the owner was shown runs HERE, on the same `ids` that are about to be recorded,
      // inside the transaction — not as a separate inspect() before pin() (a binary or DLL swapped between the two was pinned as the
      // shown identity). Any difference refuses before settings.set: nothing is written.
      if (shown) {
        for (const tool of MEDIA_TOOL_NAMES) {
          const s = stateOf(ids[tool], pins[tool]);
          const writes = s.state === "UNPINNED" || (s.state === "CHANGED" && !s.recorded);
          const want = shown[tool];
          if (!want) {
            if (writes) throw new HubError("conflict", `${tool} nu era printre uneltele arătate; nu fixez un binar pe care nu l-ai văzut.`, { code: "TOOL_CHANGED", data: { tools: [tool], reason: "not_shown" } });
            continue;
          }
          const diff = differsFromShown(ids[tool], want);
          if (diff.length) throw new HubError("conflict", `${tool} nu mai e binarul arătat (${diff.join(", ")} diferă de ce ai văzut); nu fixez nimic.`, { code: "TOOL_CHANGED", data: { tools: [tool], differs: diff } });
        }
      }
      // A binary whose version cannot be read is not verified: it is never pinned, and a change to it is not recorded either.
      const unverified = MEDIA_TOOL_NAMES.filter((t) => !ids[t].version && stateOf(ids[t], pins[t]).state !== "PINNED" && !stateOf(ids[t], pins[t]).recorded);
      if (unverified.length) throw new HubError("tool", `Nu pot citi versiunea pentru ${unverified.join(", ")}; un binar neverificat nu se fixează.`, { code: "TOOL_UNVERIFIED", data: { tools: unverified } });
      const next = { ...pins }; const events = [];
      const result = { pinned: [], changed: [], unchanged: [] };
      const at = clock().toISOString();
      for (const tool of MEDIA_TOOL_NAMES) {
        const info = ids[tool]; const cur = pins[tool]; const s = stateOf(info, cur);
        const identity = identityOf(info);
        if (s.state === "UNPINNED") {
          next[tool] = { ...identity, pinnedAt: at, pinnedBy: who, ...(why ? { reason: why } : {}) };
          result.pinned.push(tool);
          events.push({ type: "media.tool.pinned", tool, payload: { tool, version: info.version, sha256: info.sha256, libsSha256: identity.libsSha256, actor: who, reason: why } });
        } else if (s.state === "CHANGED" && !s.recorded) {
          const previous = previousOf(cur);
          next[tool] = { ...identity, pinnedAt: at, pinnedBy: who, previous, changedAt: at, acknowledged: false };
          result.changed.push(tool);
          events.push({ type: "media.tool.changed", tool, payload: { tool, from: { version: previous.version, sha256: previous.sha256 }, to: { version: info.version, sha256: info.sha256 }, actor: who } });
        } else {
          result.unchanged.push(tool);
        }
      }
      if (events.length) {
        settings.set("mediaToolPins", next, who, `media.tools.pin${why ? `: ${why}` : ""}`);
        for (const e of events) bus.append({ type: e.type, scopeType: "media_tool", scopeId: e.tool, source: who, payload: e.payload });
      }
      return result;
    });
  }

  /**
   * The owner acknowledges a changed binary: the identity on disk NOW becomes the pin (previous kept) and the warning stops.
   * `sha256` (optional) is the identity the owner was shown: if the binary changed again since, nothing is acknowledged.
   * M10.2 (#30): `libsSha256` ("none" = a static build was shown) and `version`, when given, are compared the same way — the shared
   * libraries are part of the identity, so a DLL set swapped after the Studio panel was drawn is not acknowledged as what was seen.
   * The comparison uses the same `info` the transaction records (no second read in between).
   */
  async function acknowledgeChange(tool, actor = "owner", { sha256 = null, libsSha256 = undefined, version = undefined } = {}) {
    if (!MEDIA_TOOL_NAMES.includes(tool)) throw new HubError("validation", `Unealtă media necunoscută: ${tool}.`, { code: "MEDIA_TOOL_UNKNOWN" });
    const who = actorOf(actor);
    if (!settings || !bus) throw new HubError("internal", "Setările nu sunt disponibile.");
    const ids = await identifyAll();
    const info = ids[tool];
    if (!info) throw new HubError("tool", `${tool} nu este disponibil; nu am ce confirma.`, { code: "TOOL_MISSING" });
    const again = [
      ...(sha256 && sha256 !== info.sha256 ? ["sha256"] : []),
      ...(libsSha256 !== undefined && libsSha256 !== null && (libsSha256 === "none" ? null : libsSha256) !== (info.libsSha256 || null) ? ["biblioteci"] : []),
      ...(version !== undefined && version !== null && info.version !== null && String(version) !== info.version ? ["versiune"] : []),
    ];
    if (again.length) throw new HubError("conflict", `${tool} s-a schimbat din nou față de ce ți s-a arătat (${again.join(", ")}); reverifică uneltele.`, { code: "TOOL_CHANGED_AGAIN", data: { differs: again } });
    const out = bus.transaction(() => {
      const pins = settings.get("mediaToolPins") || {};
      const cur = pins[tool];
      const s = stateOf(info, cur);
      if (s.state !== "CHANGED") return { acknowledged: false, reason: s.state === "UNPINNED" ? "not_pinned" : "nothing_to_acknowledge", state: s.state };
      const at = clock().toISOString();
      const ack = { acknowledged: true, acknowledgedAt: at, acknowledgedBy: who };
      // A change already recorded by pin() keeps its record; one only seen by an inspection is recorded now, together.
      const next = s.recorded ? { ...cur, ...ack } : { ...identityOf(info), pinnedAt: at, pinnedBy: who, previous: previousOf(cur), changedAt: at, ...ack };
      settings.set("mediaToolPins", { ...pins, [tool]: next }, who, "media.tool.acknowledged");
      if (!s.recorded) bus.append({ type: "media.tool.changed", scopeType: "media_tool", scopeId: tool, source: who,
        payload: { tool, from: { version: next.previous.version, sha256: next.previous.sha256 }, to: { version: info.version, sha256: info.sha256 }, actor: who } });
      bus.append({ type: "media.tool.acknowledged", scopeType: "media_tool", scopeId: tool, source: who,
        payload: { tool, version: info.version, sha256: info.sha256, previous: next.previous ? { version: next.previous.version, sha256: next.previous.sha256 } : null } });
      return { acknowledged: true, tool, version: info.version, sha256: info.sha256 };
    });
    summarize(ids, currentPins());
    return out;
  }

  /** Refusal of a toolset that is not pinned or changed (shared by resolve() and the synchronous request gate). */
  function refuseUnusable(states) {
    const unpinned = MEDIA_TOOL_NAMES.filter((t) => states[t] === "UNPINNED");
    if (unpinned.length) {
      // M10.2 (#28): the two real paths — the pin step a Studio plan card lists (automatic readiness inside the one confirmation) or
      // the Unelte panel of the Studio (#/studio?panel=tools), which exists (Studio.jsx → ToolsPanel).
      throw new HubError("policy", `ffmpeg/ffprobe nu sunt fixate încă (versiune + sha256): ${unpinned.join(", ")}. Le fixez ca pas al planului confirmat (cere din nou randarea prin Lega: cardul listează fixarea), sau le fixezi tu în Studio → Unelte („Fixează”); randarea nu a pornit.`,
        { code: "TOOLS_NOT_PINNED", data: { tools: unpinned } });
    }
    const changed = MEDIA_TOOL_NAMES.filter((t) => states[t] === "CHANGED");
    if (changed.length) {
      throw new HubError("policy", `${changed.join(", ")} s-a schimbat față de binarul fixat (versiune / sha256 / biblioteci). Confirmă schimbarea în Studio → Unelte („Confirmă schimbarea”, o decizie a ta, cu Windows Hello) înainte de randare; randarea nu a pornit.`,
        { code: "TOOL_CHANGED", data: { tools: changed } });
    }
  }

  /**
   * The render path: a fresh inspection that refuses a missing (TOOL_MISSING), unpinned (TOOLS_NOT_PINNED) or changed and not yet
   * acknowledged (TOOL_CHANGED) toolset before the real job spawns anything. Returns the inspection when every tool is PINNED.
   */
  async function resolve() {
    const r = await inspect();
    const missing = MEDIA_TOOL_NAMES.filter((t) => r.states[t] === "MISSING");
    if (missing.length) throw new HubError("tool", `${missing.join(" și ")} ${missing.length > 1 ? "nu sunt disponibile" : "nu este disponibil"} (instalează-l sau verifică PATH).`, { code: "TOOL_MISSING", data: { missing } });
    refuseUnusable(r.states);
    return r;
  }

  /**
   * Synchronous gate for a render request (no spawn): the pins must exist, no recorded change may be unacknowledged, and the last
   * inspection (if any) must not have seen a different binary. The run itself re-verifies through resolve().
   */
  function requirePinned() {
    if (!settings) return;
    const pins = currentPins();
    const states = {};
    for (const tool of MEDIA_TOOL_NAMES) {
      const p = pins[tool];
      states[tool] = !p?.sha256 ? "UNPINNED" : (p.changedAt && !p.acknowledged) || resolved?.states?.[tool] === "CHANGED" ? "CHANGED" : "PINNED";
    }
    refuseUnusable(states);
  }

  /** Production: verify presence once per process, and again when the binary on disk changes (size/mtime). Read-only. */
  async function ensureLauncher(tool) {
    const launcher = launcherFor(tool);
    if (!launcher) throw new HubError("tool", `${tool} nu este disponibil (instalează-l sau verifică PATH).`, { code: "TOOL_MISSING" });
    if (!launcherConfig()) {
      let sig;
      try { const st = fs.statSync(launcher.identityFile); sig = `${st.size}:${st.mtimeMs}`; } catch { throw new HubError("tool", `${tool} nu este disponibil.`, { code: "TOOL_MISSING" }); }
      const known = identityCache.get(launcher.identityFile);
      if (!resolved || !resolved[tool] || resolved[tool].path !== launcher.identityFile || !known || known.sig !== sig) await inspect();
      if (!resolved?.[tool]) throw new HubError("tool", `${tool} nu este disponibil.`, { code: "TOOL_MISSING" });
    }
    return launcher;
  }

  function spawnTool({ tool, launcher, argv, cwd, timeoutMs, key, onProgress = null, collectStderr = true, onStderrLine = null, maxStdoutLines = 50000 }) {
    if (closing) throw new HubError("policy", "Hub shutdown: media tools closed", { code: "HUB_SHUTDOWN" });
    if (supervisor.get(key) && !supervisor.get(key).exited) throw new HubError("conflict", "Există deja un proces media cu această cheie.", { code: "MEDIA_KEY_BUSY" });
    const state = { cancelled: false, timedOut: false };
    running.set(key, state);
    const stdoutLines = []; let stdoutTruncated = false;
    const stderrLines = []; let stderrDropped = 0;
    const progress = onProgress ? createProgressParser() : null;
    const started = Date.now();
    let record;
    try {
      record = supervisor.start({
        key, executable: launcher.executable, args: [...launcher.prefixArgs, ...argv], cwd, env: launcher.env, label: `media:${tool}`,
        onStdoutLine: (line) => {
          if (progress) {
            const p = progress(line);
            if (p) { try { onProgress(p); } catch { /* a faulty progress consumer must not break the encode */ } }
            return;
          }
          if (stdoutLines.length < maxStdoutLines) stdoutLines.push(line); else stdoutTruncated = true;
        },
        onStderrLine: (line) => {
          if (collectStderr) { stderrLines.push(line); if (stderrLines.length > MAX_STDERR_LINES) { stderrLines.shift(); stderrDropped += 1; } }
          if (onStderrLine) { try { onStderrLine(line); } catch { /* ignore */ } }
        },
      });
    } catch (error) {
      running.delete(key);
      if (error instanceof HubError) throw error;
      throw new HubError("tool", `${tool} nu a putut porni: ${error.message}`, { code: /ENOENT/.test(error.message) ? "TOOL_MISSING" : "TOOL_FAILED" });
    }
    const timer = setTimeout(() => { state.timedOut = true; supervisor.stop(key, { graceMs: 500 }).catch(() => {}); }, timeoutMs);
    return record.exit.then(({ code, error }) => {
      clearTimeout(timer);
      running.delete(key);
      supervisor.forget(key);
      if (error && /ENOENT/.test(error)) throw new HubError("tool", `${tool} nu este disponibil.`, { code: "TOOL_MISSING" });
      // The test proxy exits 127 when the real binary is absent.
      if (code === 127 && stderrLines.some((l) => l.includes("REAL_TOOL_MISSING"))) throw new HubError("tool", `${tool} nu este disponibil.`, { code: "TOOL_MISSING" });
      return { code, stdoutLines, stderrLines, timedOut: state.timedOut, cancelled: state.cancelled && !state.timedOut, durationMs: Date.now() - started,
        stdoutTruncated, stderrDropped, key };
    });
  }

  /**
   * Runs ffmpeg/ffprobe. Resolves with `{ code, stdoutLines, stderrLines, timedOut, cancelled, durationMs }` (a non-zero code is a
   * result, not an exception); throws TOOL_MISSING when the binary is absent and policy/validation errors for refused argv.
   */
  async function run({ tool, args, cwd = null, key = null, timeoutMs = null, onProgress = null, collectStderr = true, onStderrLine = null, maxStdoutLines = 50000 }) {
    if (closing) throw new HubError("policy", "Hub shutdown: media tools closed", { code: "HUB_SHUTDOWN" });
    const dir = cwd ? path.resolve(cwd) : workCwd();
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new HubError("validation", "Dosarul de lucru pentru unealta media nu există.", { code: "MEDIA_CWD_MISSING" });
    const argv = prepareArgs(tool, args, { cwd: dir, progress: Boolean(onProgress) });
    const limit = Math.min(MAX_TIMEOUT_MS, Math.max(100, Number(timeoutMs) || DEFAULT_TIMEOUT_MS[tool]));
    const runKey = key ? String(key) : `media:${tool}:${newId("job")}`;
    if (running.has(runKey)) throw new HubError("conflict", "Există deja un proces media cu această cheie.", { code: "MEDIA_KEY_BUSY" });
    const launcher = await ensureLauncher(tool);
    return spawnTool({ tool, launcher, argv, cwd: dir, timeoutMs: limit, key: runKey, onProgress, collectStderr, onStderrLine, maxStdoutLines });
  }

  /** Cancels a running call by key (kills the process tree). */
  async function cancel(key) {
    const state = running.get(key);
    if (!state) return { cancelled: false, found: false };
    state.cancelled = true;
    const r = await supervisor.stop(key, { graceMs: 500 });
    return { cancelled: true, found: true, stopped: r.stopped };
  }

  /** ffprobe → normalizeProbe. Throws HubError(validation, UNDECODABLE) when the file cannot be read as media. */
  async function probe(absPath, { timeoutMs = 60000, key = null } = {}) {
    const r = await run({ tool: "ffprobe", args: ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", ...inputArgs(path.resolve(absPath))],
      cwd: path.dirname(path.resolve(absPath)), timeoutMs, key });
    if (r.timedOut) throw new HubError("tool", "ffprobe a depășit timpul alocat.", { code: "TIMEOUT" });
    if (r.cancelled) throw new HubError("task", "Analiza fișierului a fost anulată.", { code: "CANCELLED" });
    const tail = r.stderrLines.slice(-5).join(" | ").slice(0, 600);
    if (r.code !== 0) throw new HubError("validation", `Fișierul nu poate fi decodat ca media${tail ? `: ${tail}` : "."}`, { code: "UNDECODABLE", data: { stderr: tail } });
    if (r.stdoutTruncated) throw new HubError("validation", "Rezultatul ffprobe este prea mare.", { code: "UNDECODABLE" });
    let parsed;
    try { parsed = JSON.parse(r.stdoutLines.join("\n")); } catch { throw new HubError("validation", "ffprobe nu a returnat un JSON valid.", { code: "UNDECODABLE" }); }
    const normalized = normalizeProbe(parsed);
    if (!normalized.hasVideo && !normalized.hasAudio) throw new HubError("validation", "Fișierul nu conține fluxuri audio sau video decodabile.", { code: "UNDECODABLE" });
    return normalized;
  }

  return { boot, beginClose, close, inspect, pin, resolve, requirePinned, acknowledgeChange, run, cancel, probe, inputArgs, outputArg, prepareArgs, running: () => [...running.keys()], lastResolved: () => resolved };
}
