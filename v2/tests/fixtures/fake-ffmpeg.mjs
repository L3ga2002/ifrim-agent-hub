#!/usr/bin/env node
// M09 fake ffmpeg/ffprobe for failure injection (never a real encode). Mode from FAKE_FFMPEG_MODE:
//   hang      — prints progress lines and waits until killed (cancel / timeout tests)
//   crash     — writes a partial output file, prints a few progress lines, exits 1
//   diskfull  — prints "No space left on device" on stderr, exits 1
//   corrupt   — writes garbage to the output path, exits 0 (validation must refuse it)
//   copy      — copies FAKE_FFMPEG_SOURCE to the output path, exits 0
//   probe     — prints FAKE_FFPROBE_JSON (a JSON document) on stdout, exits 0
// The output path is the last argv entry. Every invocation appends its argv (JSON) to FAKE_FFMPEG_LOG when set.
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const mode = process.env.FAKE_FFMPEG_MODE || "copy";
if (process.env.FAKE_FFMPEG_LOG) fs.appendFileSync(process.env.FAKE_FFMPEG_LOG, `${JSON.stringify({ mode, args, cwd: process.cwd() })}\n`);
const out = args[args.length - 1];
const resolved = out && !out.startsWith("-") ? path.resolve(process.cwd(), out) : null;
const progress = (n) => { for (let i = 1; i <= n; i += 1) process.stdout.write(`frame=${i * 10}\nout_time_ms=${i * 1000000}\nprogress=continue\n`); };

if (mode === "probe") {
  process.stdout.write(process.env.FAKE_FFPROBE_JSON || "{}");
  process.exit(0);
} else if (mode === "hang") {
  progress(2);
  setInterval(() => process.stdout.write("progress=continue\n"), 200);
} else if (mode === "crash") {
  if (resolved) { fs.mkdirSync(path.dirname(resolved), { recursive: true }); fs.writeFileSync(resolved, Buffer.alloc(1024, 7)); }
  progress(3);
  process.stderr.write("Conversion failed! (simulated crash)\n");
  process.exit(1);
} else if (mode === "diskfull") {
  process.stderr.write("av_interleaved_write_frame(): No space left on device\n");
  process.exit(1);
} else if (mode === "corrupt") {
  if (resolved) { fs.mkdirSync(path.dirname(resolved), { recursive: true }); fs.writeFileSync(resolved, Buffer.from("not a media file")); }
  progress(1);
  process.stdout.write("progress=end\n");
  process.exit(0);
} else {
  const source = process.env.FAKE_FFMPEG_SOURCE;
  if (resolved && source && fs.existsSync(source)) { fs.mkdirSync(path.dirname(resolved), { recursive: true }); fs.copyFileSync(source, resolved); }
  progress(1);
  process.stdout.write("progress=end\n");
  process.exit(0);
}
