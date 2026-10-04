// M09 media test helpers. Deliberately independent of helpers.mjs / createHub so the media modules can be tested on their own:
// a migrated temporary database, an event bus, settings, a test-mode supervisor and launchers for the media tools.
// Real-tool tests run ffmpeg/ffprobe through tests/fixtures/ffmpeg-proxy.mjs (the supervisor refuses real binaries in test mode);
// when the binary is absent they must report SKIPPED_ENV via `t.skip(...)`, never pass silently.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openDatabase, migrate } from "../server/storage/db.mjs";
import { createEventBus } from "../server/events/bus.mjs";
import { createSettings } from "../server/domain/settings.mjs";
import { createSupervisor } from "../server/runtime/supervisor.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURES = path.join(here, "fixtures");
export const HUB_ROOT = path.resolve(here, "..", "..");
export const MEDIA_TEST_TMP = path.join(HUB_ROOT, ".ifrim", "tmp", "v2-tests");
export const FFMPEG_PROXY = path.join(FIXTURES, "ffmpeg-proxy.mjs");
export const FAKE_FFMPEG = path.join(FIXTURES, "fake-ffmpeg.mjs");

export function mediaTempDir(label = "media") {
  const dir = path.join(MEDIA_TEST_TMP, `${label}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Absolute path of a real tool (ffmpeg, ffprobe) or null. IFRIM_REAL_<NAME> overrides the PATH lookup. */
export function realTool(name) {
  const override = process.env[`IFRIM_REAL_${name.toUpperCase()}`];
  if (override) return fs.existsSync(override) ? override : null;
  try {
    const finder = process.platform === "win32" ? "where.exe" : "which";
    const out = execFileSync(finder, [name], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
    const first = out.split(/\r?\n/).map((s) => s.trim()).find((s) => s && fs.existsSync(s));
    return first || null;
  } catch { return null; }
}

/**
 * Launchers in the shape media/tools.mjs consumes: { executable, prefixArgs, env }.
 * - real: node + ffmpeg-proxy.mjs + IFRIM_REAL_TOOL=<binary>
 * - fake: node + fake-ffmpeg.mjs + FAKE_FFMPEG_* env
 */
export function realLaunchers() {
  const ffmpeg = realTool("ffmpeg");
  const ffprobe = realTool("ffprobe");
  return {
    available: Boolean(ffmpeg && ffprobe),
    ffmpeg: { executable: process.execPath, prefixArgs: [FFMPEG_PROXY], env: { IFRIM_REAL_TOOL: ffmpeg || "" } },
    ffprobe: { executable: process.execPath, prefixArgs: [FFMPEG_PROXY], env: { IFRIM_REAL_TOOL: ffprobe || "" } },
    paths: { ffmpeg, ffprobe },
  };
}
export function fakeLaunchers(env = {}) {
  return {
    available: true,
    ffmpeg: { executable: process.execPath, prefixArgs: [FAKE_FFMPEG], env },
    ffprobe: { executable: process.execPath, prefixArgs: [FAKE_FFMPEG], env: { FAKE_FFMPEG_MODE: "probe", ...env } },
    paths: { ffmpeg: FAKE_FFMPEG, ffprobe: FAKE_FFMPEG },
  };
}

/**
 * A self-contained media environment: temp data dir inside .ifrim/tmp, migrated DB, bus, settings, test-mode supervisor.
 * `launchers` defaults to the real tools through the proxy.
 */
export function makeMediaEnv({ launchers = realLaunchers(), clock = () => new Date() } = {}) {
  const dir = mediaTempDir("media");
  const dataDir = path.join(dir, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const db = openDatabase(path.join(dataDir, "hub-v2.sqlite"));
  migrate(db);
  const bus = createEventBus(db, clock);
  const settings = createSettings(db, bus, clock);
  const config = Object.freeze({
    testMode: true,
    dataDir,
    workDir: path.join(dataDir, "work"),
    mediaDir: path.join(dataDir, "v2-media"),
    mediaWorkDir: path.join(dataDir, "work", "media"),
    allowedTestBinaryDir: FIXTURES,
    hubRoot: HUB_ROOT,
    mediaTools: Object.freeze({ ffmpeg: null, ffprobe: null, launcher: launchers }),
  });
  const supervisor = createSupervisor({ config });
  return {
    dir, dataDir, db, bus, settings, config, supervisor, clock, launchers,
    hasRealTools: Boolean(launchers.available && launchers.paths?.ffmpeg && launchers.paths.ffmpeg !== FAKE_FFMPEG),
    cleanup() { try { supervisor.stopAll?.(); } catch { /* ignore */ } try { db.close(); } catch { /* ignore */ } },
  };
}

/** Generates a small synthetic media file with the REAL ffmpeg (test harness only; never the Hub). Returns the path or null. */
export function makeSyntheticMedia(dir, { name = "clip.mp4", seconds = 2, width = 640, height = 360, fps = 30, audio = true, kind = "video", text = null } = {}) {
  const ffmpeg = realTool("ffmpeg");
  if (!ffmpeg) return null;
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, name);
  const args = ["-hide_banner", "-nostdin", "-y", "-loglevel", "error"];
  if (kind === "audio") {
    args.push("-f", "lavfi", "-i", `sine=frequency=440:sample_rate=48000:duration=${seconds}`, "-c:a", name.endsWith(".wav") ? "pcm_s16le" : "aac", out);
  } else if (kind === "image") {
    args.push("-f", "lavfi", "-i", `testsrc2=size=${width}x${height}:rate=1`, "-frames:v", "1", out);
  } else {
    args.push("-f", "lavfi", "-i", `testsrc2=size=${width}x${height}:rate=${fps}:duration=${seconds}`);
    if (audio) args.push("-f", "lavfi", "-i", `sine=frequency=330:sample_rate=48000:duration=${seconds}`);
    if (text) args.push("-vf", `drawbox=x=0:y=0:w=iw:h=40:color=black@0.6:t=fill`);
    args.push("-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "ultrafast");
    if (audio) args.push("-c:a", "aac", "-shortest");
    args.push(out);
  }
  execFileSync(ffmpeg, args, { stdio: "ignore", windowsHide: true });
  return out;
}

/** ffprobe JSON of a file with the REAL ffprobe (test assertions only). */
export function probeJson(file) {
  const ffprobe = realTool("ffprobe");
  if (!ffprobe) return null;
  const out = execFileSync(ffprobe, ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file], { encoding: "utf8", windowsHide: true });
  return JSON.parse(out);
}
