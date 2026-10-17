// M11 voice diagnostic: pure view logic (tested in node). One row per sentence the Hub measured, in the owner's words.

export const DIAG_STAGES = Object.freeze([
  { key: "AUDIO_CAPTURED", label: "Audio" },
  { key: "VAD_OK", label: "Segmentare" },
  { key: "SPEAKER_MATCH", label: "Vorbitor" },
  { key: "TRANSCRIPT_FINAL", label: "Transcriere" },
  { key: "INTENT", label: "Intenție" },
  { key: "AUTHORIZED_EFFECT", label: "Efect" },
]);

const SOURCE = { diag: "diagnostic", gate: "filtru Lega", confirm: "confirmare", probe: "probă" };
const CAUSE = {
  QUALITY_SHORT: "prea scurtă",
  QUALITY_QUIET: "voce prea încet (sub -50 dBFS)",
  QUALITY_NOISE: "prea mult zgomot",
  SPEAKER_NON_MATCH: "altă voce",
  SPEAKER_UNCERTAIN: "incert",
  SUSPICIOUS_INPUT: "semnal suspect",
  NO_PROFILE: "fără profil",
  PROFILE_MISMATCH: "profil vechi",
  REPLAY: "înregistrare reluată",
};
const LOST = { VAD_OK: "segmentare", SPEAKER_MATCH: "vorbitor", TRANSCRIPT_FINAL: "transcriere", INTENT: "intenție" };
const yes = (ok) => (ok ? "da" : "nu");
const time = (iso) => { try { return new Date(iso).toLocaleTimeString("ro-RO", { hour: "2-digit", minute: "2-digit", second: "2-digit" }); } catch { return "—"; } };

/** Table rows for the diagnostic entries (newest first). */
export function diagRows(entries) {
  return [...(entries || [])].reverse().map((e) => {
    const q = e.quality || {}; const sp = e.speaker || {}; const seg = e.segmentation || {}; const st = e.stages || {};
    const speaker = sp.result === "MATCH" ? `da (${sp.score ?? "?"} ≥ ${sp.matchAt ?? "?"})`
      : sp.score !== null && sp.score !== undefined ? `nu: ${CAUSE[sp.cause] || sp.reason} (${sp.score} / prag ${sp.matchAt})`
        : `nu: ${CAUSE[sp.cause] || sp.reason || "—"}`;
    return {
      id: e.id,
      time: time(e.at),
      source: SOURCE[e.purpose] || e.purpose,
      segment: `${q.durationMs ?? "?"} ms${seg.preRollMs !== undefined ? ` · pre-roll ${seg.preRollMs} ms` : ""}${seg.endReason && seg.endReason !== "silence" ? ` · ${seg.endReason}` : ""}`,
      speech: `${q.speechMs ?? 0} ms${q.quietSpeechMs ? ` (+${q.quietSpeechMs} ms încet)` : ""}`,
      level: q.speechLevelDb !== null && q.speechLevelDb !== undefined ? `${q.speechLevelDb} dBFS · SNR ${q.snrDb} dB` : `fond ${q.floorDb ?? "?"} dBFS · vârf ${q.peakDb ?? "?"}`,
      stages: {
        AUDIO_CAPTURED: yes(st.AUDIO_CAPTURED),
        VAD_OK: st.VAD_OK ? "da" : `nu: ${CAUSE[sp.cause] || "—"}`,
        SPEAKER_MATCH: st.VAD_OK ? speaker : "—",
        TRANSCRIPT_FINAL: e.transcript?.text ? `„${e.transcript.text}”` : e.transcript?.status === "pending" ? "în curs" : st.SPEAKER_MATCH ? (e.transcript?.status || "—") : "—",
        INTENT: st.INTENT || (e.intent?.clarification ? `întrebare (${e.intent.clarification})` : "—"),
        AUTHORIZED_EFFECT: st.AUTHORIZED_EFFECT || "—",
      },
      lostAt: e.lostAt ? LOST[e.lostAt] || e.lostAt : null,
    };
  });
}

/** One line: how many sentences passed and where the others were lost. */
export function diagSummary(entries) {
  const list = entries || [];
  const total = list.length;
  const passed = list.filter((e) => !e.lostAt).length;
  const lost = {};
  for (const e of list) if (e.lostAt) lost[e.lostAt] = (lost[e.lostAt] || 0) + 1;
  const parts = Object.entries(lost).map(([k, n]) => `${n} la ${LOST[k] || k}`);
  return { total, passed, lost, text: total ? `${passed} din ${total} au trecut${parts.length ? `; pierdute: ${parts.join(", ")}` : ""}` : "" };
}
