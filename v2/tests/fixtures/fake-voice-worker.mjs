// Test fixture for the local voice worker (M07): the same JSON-lines protocol as server/owner/voice-worker.mjs, with no model.
// "Transcript" = the text encoded in the segment (fixtures/voice-pcm.mjs); "speaker embedding" = a Gaussian bump over 32 bins at
// the speaker index read from the tone, so the same speaker gives cosine 1, a neighbour three bins away ~0.37 (UNCERTAIN) and a
// distant one ~0 (NON_MATCH). Environment switches for failure tests: FAKE_VOICE_FATAL=1 (start-up failure),
// FAKE_VOICE_STT_FAIL=1 (transcription error), FAKE_VOICE_TAMPER=1 (M09: after "ready", reports a model-load log line the way
// the real worker does when someone calls whisper-server's /load), FAKE_VOICE_CFG_LOG=<file> (M09: writes the start-up flags
// the Hub passed — only `randomInferencePath`, never paths).
import readline from "node:readline";
import { appendFileSync } from "node:fs";
import { readVoicePcm } from "./voice-pcm.mjs";

const say = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
if (process.env.FAKE_VOICE_FATAL === "1") { say({ kind: "fatal", error: "fixture: start-up failure" }); process.exit(1); }
const DIMS = 32;
const embed = (speaker) => Array.from({ length: DIMS }, (_, i) => Math.exp(-((i - speaker) ** 2) / (2 * 1.5 * 1.5)));

if (process.env.FAKE_VOICE_CFG_LOG) {
  let cfg = null;
  const i = process.argv.indexOf("--config");
  try { cfg = JSON.parse(Buffer.from(process.argv[i + 1] || "", "base64").toString("utf8")); } catch { cfg = null; }
  appendFileSync(process.env.FAKE_VOICE_CFG_LOG, `${JSON.stringify({ randomInferencePath: cfg ? cfg.randomInferencePath === true : null })}\n`);
}

say({ kind: "ready", sv: { dim: DIMS, loadMs: 1 }, stt: { gpu: false, startupMs: 1, port: 0, listenerChecked: false } });
if (process.env.FAKE_VOICE_TAMPER === "1") setTimeout(() => say({ kind: "tamper_suspected", line: "whisper_init_from_file_with_params_no_state: loading model from 'fixture.bin'", count: 1 }), 20);
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  let msg; try { msg = JSON.parse(line); } catch { return; }
  if (msg.op !== "analyze") { say({ id: msg.id, ok: false, error: "unknown op" }); return; }
  const decoded = readVoicePcm(Buffer.from(String(msg.pcm || ""), "base64"));
  // FAKE_VOICE_LOG: one line per request, so a test can prove which segments were sent for transcription.
  if (process.env.FAKE_VOICE_LOG) appendFileSync(process.env.FAKE_VOICE_LOG, `${JSON.stringify({ transcribe: Boolean(msg.transcribe), embed: msg.embed !== false, speaker: decoded.speaker })}
`);
  const out = { id: msg.id, ok: true, svMs: 1 };
  if (msg.embed !== false) out.embedding = decoded.speaker === null ? null : embed(decoded.speaker);
  if (msg.transcribe) {
    if (process.env.FAKE_VOICE_STT_FAIL === "1") { say({ id: msg.id, ok: false, error: "fixture: transcription failed" }); return; }
    out.transcript = decoded.text; out.sttMs = 1; out.sttEngine = "fixture (fără model)";
  }
  say(out);
});
process.stdin.on("end", () => process.exit(0));
