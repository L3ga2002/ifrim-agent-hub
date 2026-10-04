// M09 media tools (ffmpeg / ffprobe). Every call is an argv array started by the supervisor (no shell, hidden window, allowlisted
// environment, whole-tree kill), with a timeout and a cancel key. Inputs are local files only: each input gets
// `-protocol_whitelist file,pipe` (a crafted playlist cannot make ffmpeg open http/tcp/udp), filter graphs that open files or
// sockets on their own (movie/amovie/zmq) are refused, and an output that looks like a URL is refused.
// Production resolves the binaries on PATH (where.exe) unless config names them, and pins version + sha256 in
// settings.mediaToolPins at the first verified use; a changed binary is reported as `tool_changed` until acknowledged, never
// silently re-trusted. Test mode uses config.mediaTools.launcher ({ executable, prefixArgs, env } per tool).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { HubError } from "../core/errors.mjs";
import { newId } from "../core/ids.mjs";
import { normalizeProbe } from "./probe.mjs";

export const MEDIA_TOOL_NAMES = Object.freeze(["ffmpeg", "ffprobe"]);
export const PROTOCOL_WHITELIST = "file,pipe";
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
  const identityCache = new Map(); // file → { sig, sha256 }
  const lookupCache = new Map(); // tool → absolute path found on PATH (production)
  let resolved = null; // last resolve() result (production run() relies on it)
  let resolving = null;

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

  function writePin(tool, pin, event, payload) {
    if (!settings || !bus) return;
    bus.transaction(() => {
      const pins = settings.get("mediaToolPins") || {};
      settings.set("mediaToolPins", { ...pins, [tool]: pin }, "media-tools", event);
      bus.append({ type: event, scopeType: "media_tool", scopeId: tool, source: "media-tools", payload });
    });
  }

  /**
   * Verifies both tools: present, version readable, sha256 (+ shared libraries). Pins at the first verified use; a different
   * binary later is recorded (previous identity kept) and reported as `tool_changed` until acknowledgeChange().
   */
  async function resolve() {
    if (resolving) return resolving;
    resolving = (async () => {
      const out = { ok: true, problems: [], warnings: [] };
      const pins = settings ? settings.get("mediaToolPins") || {} : {};
      for (const tool of MEDIA_TOOL_NAMES) {
        const launcher = launcherFor(tool);
        if (!launcher) { out[tool] = null; out.ok = false; out.problems.push(`${tool}_missing`); continue; }
        let sha256 = null; let libs = null;
        try { sha256 = cachedSha(launcher.identityFile); libs = libsSha(launcher.identityFile); }
        catch { out[tool] = null; out.ok = false; out.problems.push(`${tool}_missing`); continue; }
        let version = null;
        try { version = await readVersion(tool, launcher); } catch (error) { if (error?.code === "TOOL_MISSING") { out[tool] = null; out.ok = false; out.problems.push(`${tool}_missing`); continue; } }
        const info = { path: launcher.identityFile, version, sha256, libsSha256: libs };
        out[tool] = info;
        if (!version) { out.warnings.push(`${tool}_version_unreadable`); continue; } // not verified → never pinned
        const pin = pins[tool];
        const now = clock().toISOString();
        if (!pin?.sha256) {
          writePin(tool, { ...info, pinnedAt: now }, "media.tool.pinned", { tool, version, sha256, libsSha256: libs });
        } else if (pin.sha256 !== sha256 || (pin.libsSha256 || null) !== libs || pin.version !== version) {
          const previous = { path: pin.path, version: pin.version, sha256: pin.sha256, libsSha256: pin.libsSha256 || null, pinnedAt: pin.pinnedAt };
          writePin(tool, { ...info, pinnedAt: now, previous, changedAt: now, acknowledged: false }, "media.tool.changed",
            { tool, from: { version: previous.version, sha256: previous.sha256 }, to: { version, sha256 } });
          out.problems.push("tool_changed");
        } else if (pin.changedAt && !pin.acknowledged) {
          out.problems.push("tool_changed");
        }
      }
      out.problems = [...new Set(out.problems)];
      resolved = out;
      return out;
    })();
    try { return await resolving; } finally { resolving = null; }
  }

  /** The owner acknowledges a changed binary (the warning stops; the new identity stays pinned). */
  function acknowledgeChange(tool, actor = "owner") {
    if (!MEDIA_TOOL_NAMES.includes(tool)) throw new HubError("validation", `Unealtă media necunoscută: ${tool}.`);
    if (!settings || !bus) throw new HubError("internal", "Setările nu sunt disponibile.");
    return bus.transaction(() => {
      const pins = settings.get("mediaToolPins") || {};
      const pin = pins[tool];
      if (!pin?.changedAt || pin.acknowledged) return { acknowledged: false, reason: "nothing_to_acknowledge" };
      settings.set("mediaToolPins", { ...pins, [tool]: { ...pin, acknowledged: true, acknowledgedAt: clock().toISOString(), acknowledgedBy: actor } }, actor, "media.tool.acknowledged");
      bus.append({ type: "media.tool.acknowledged", scopeType: "media_tool", scopeId: tool, source: actor, payload: { tool, version: pin.version, sha256: pin.sha256 } });
      return { acknowledged: true };
    });
  }

  /** Production: verify once per process, and again when the binary on disk changes (size/mtime). */
  async function ensureLauncher(tool) {
    const launcher = launcherFor(tool);
    if (!launcher) throw new HubError("tool", `${tool} nu este disponibil (instalează-l sau verifică PATH).`, { code: "TOOL_MISSING" });
    if (!launcherConfig()) {
      let sig;
      try { const st = fs.statSync(launcher.identityFile); sig = `${st.size}:${st.mtimeMs}`; } catch { throw new HubError("tool", `${tool} nu este disponibil.`, { code: "TOOL_MISSING" }); }
      const known = identityCache.get(launcher.identityFile);
      if (!resolved || !resolved[tool] || resolved[tool].path !== launcher.identityFile || !known || known.sig !== sig) await resolve();
      if (!resolved?.[tool]) throw new HubError("tool", `${tool} nu este disponibil.`, { code: "TOOL_MISSING" });
    }
    return launcher;
  }

  function spawnTool({ tool, launcher, argv, cwd, timeoutMs, key, onProgress = null, collectStderr = true, onStderrLine = null, maxStdoutLines = 50000 }) {
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

  return { resolve, acknowledgeChange, run, cancel, probe, inputArgs, outputArg, prepareArgs, running: () => [...running.keys()], lastResolved: () => resolved };
}
