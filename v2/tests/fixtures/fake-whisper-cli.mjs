#!/usr/bin/env node
// M09 fake whisper-cli (no model, never a real transcription). Reads the same argv the Hub gives the real whisper-cli.exe
// (-m <model> -f <input> -l <lang> -t N -np -oj -ojf -osrt -of <base> -d <ms> [-ng]) and writes <base>.json / <base>.srt in the
// shape whisper.cpp's output_json produces (transcription[].{timestamps, offsets, text, tokens[]}, result.language) — that shape is
// itself unverified on a real file; this fixture only exercises the Hub's defensive parser.
// Environment switches:
//   FAKE_WCLI_LOG=<file>     append {event:"start", args, cwd, t} and {event:"end", t} (JSON lines)
//   FAKE_WCLI_TEXT=<text>    the "transcript" (default: "Transcriere de test fără model.")
//   FAKE_WCLI_SLEEP=<ms>     write a partial out.srt, then wait before finishing (timeout / cancel / serialization tests)
//   FAKE_WCLI_EXIT=<code>    exit with this code after writing nothing
//   FAKE_WCLI_BADJSON=1      out.json is not JSON
//   FAKE_WCLI_HUGE=json      out.json padded to FAKE_WCLI_HUGE_BYTES (default 2 MiB)
//   FAKE_WCLI_HUGE=segments  FAKE_WCLI_SEGMENTS segments (default 50000)
//   FAKE_WCLI_HUGE=stdout    floods stdout, then waits (the Hub must stop it)
//   FAKE_WCLI_SHAPE=odd      transcription entries with missing/wrong fields mixed with good ones
import fs from "node:fs";

const args = process.argv.slice(2);
const env = process.env;
const log = (o) => { if (env.FAKE_WCLI_LOG) fs.appendFileSync(env.FAKE_WCLI_LOG, `${JSON.stringify({ ...o, t: Date.now() })}\n`); };
log({ event: "start", args, cwd: process.cwd() });
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const input = opt("-f");
const base = opt("-of");
const maxMs = Number(opt("-d")) || 60000;
if (!input || !base) { process.stderr.write("fake-whisper-cli: lipsește -f sau -of\n"); process.exit(2); }
let head;
try { const fd = fs.openSync(input, "r"); head = Buffer.alloc(12); fs.readSync(fd, head, 0, 12, 0); fs.closeSync(fd); }
catch (e) { process.stderr.write(`fake-whisper-cli: nu pot citi ${input}: ${e.code}\n`); process.exit(3); }
const magic = (head.toString("ascii", 0, 4) === "RIFF" && head.toString("ascii", 8, 12) === "WAVE") || ["fLaC", "OggS"].includes(head.toString("ascii", 0, 4))
  || head.toString("ascii", 0, 3) === "ID3" || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0);
if (!magic) { process.stderr.write("fake-whisper-cli: format audio necunoscut\n"); process.exit(4); }
if (env.FAKE_WCLI_EXIT) { process.stderr.write("fake-whisper-cli: eșec simulat\n"); process.exit(Number(env.FAKE_WCLI_EXIT) || 1); }

const pad = (n, w = 2) => String(n).padStart(w, "0");
const stamp = (ms) => `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
const text = env.FAKE_WCLI_TEXT || "Transcriere de test fără model.";
const end = Math.min(maxMs, 2000);

function tokensOf(sentence, from, to) {
  const words = sentence.trim().split(/\s+/).filter(Boolean);
  const out = [{ text: "[_BEG_]", offsets: { from, to: from }, id: 50365, p: 1, t_dtw: -1 }];
  const step = Math.max(1, Math.floor((to - from) / Math.max(1, words.length)));
  words.forEach((w, i) => {
    const a = from + i * step; const b = Math.min(to, a + step);
    // Long words are split in two tokens (the second without a leading space), as BPE does: the Hub must merge them.
    if (w.length > 5) { const cut = Math.ceil(w.length / 2); out.push({ text: ` ${w.slice(0, cut)}`, offsets: { from: a, to: a + Math.floor(step / 2) }, id: 1000 + i, p: 0.9, t_dtw: -1 }, { text: w.slice(cut), offsets: { from: a + Math.floor(step / 2), to: b }, id: 2000 + i, p: 0.8, t_dtw: -1 }); }
    else out.push({ text: ` ${w}`, offsets: { from: a, to: b }, id: 1000 + i, p: 0.95, t_dtw: -1 });
  });
  out.push({ text: `[_TT_${Math.round(to / 20)}]`, offsets: { from: to, to }, id: 50400, p: 1, t_dtw: -1 });
  return out;
}
const segment = (sentence, from, to) => ({ timestamps: { from: stamp(from), to: stamp(to) }, offsets: { from, to }, text: ` ${sentence}`, tokens: tokensOf(sentence, from, to) });

function finish() {
  let doc;
  if (env.FAKE_WCLI_HUGE === "segments") {
    const n = Number(env.FAKE_WCLI_SEGMENTS) || 50000;
    doc = { result: { language: "ro" }, transcription: Array.from({ length: n }, (_, i) => ({ offsets: { from: i, to: i + 1 }, text: " a" })) };
  } else if (env.FAKE_WCLI_SHAPE === "odd") {
    doc = { result: { language: 7 }, transcription: [null, 42, { text: 5 }, { offsets: { from: "x", to: -3 }, text: " fără timp" }, { timestamps: { from: "00:00:01,000", to: "00:00:02,500" }, text: ` ${text}` }] };
  } else {
    doc = { systeminfo: "fixture", model: { type: "fixture" }, params: { language: opt("-l") }, result: { language: opt("-l") === "auto" ? "ro" : opt("-l") }, transcription: [segment(text, 0, end)] };
  }
  let body = JSON.stringify(doc, null, 1);
  if (env.FAKE_WCLI_HUGE === "json") body = JSON.stringify({ ...doc, padding: "x".repeat(Number(env.FAKE_WCLI_HUGE_BYTES) || 2 * 1024 * 1024) });
  if (env.FAKE_WCLI_BADJSON === "1") body = "{ \"transcription\": [ nu e json";
  if (args.includes("-oj") || args.includes("-ojf")) fs.writeFileSync(`${base}.json`, body);
  if (args.includes("-osrt")) fs.writeFileSync(`${base}.srt`, `1\n${stamp(0)} --> ${stamp(end)}\n${text}\n\n`);
  process.stdout.write(`[${stamp(0)} --> ${stamp(end)}]  ${text}\n`);
  log({ event: "end" });
  process.exit(0);
}

if (env.FAKE_WCLI_HUGE === "stdout") {
  const line = `${"y".repeat(1023)}\n`;
  for (let i = 0; i < 4096; i += 1) process.stdout.write(line);
  setInterval(() => process.stdout.write(line), 5);
} else if (env.FAKE_WCLI_SLEEP) {
  if (args.includes("-osrt")) fs.writeFileSync(`${base}.srt`, "1\n00:00:00,000 --> 00:00:01,000\nparțial\n");
  setTimeout(finish, Number(env.FAKE_WCLI_SLEEP));
} else finish();
