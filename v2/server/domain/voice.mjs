/**
 * Local voice command parser (Romanian first, English technical terms accepted). Only safe-direction
 * commands are recognized. A transcript can never approve, deploy, delete or grant anything: those
 * words are detected and explicitly refused so a misheard phrase cannot authorize an action.
 */
const normalize = (text) => String(text || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();

const COMMANDS = [
  { id: "stop_all", patterns: [/^(opreste|stop|opreste tot|stop all|opriti tot)( tot| totul)?$/] },
  { id: "pause", patterns: [/^(pauza|pune pe pauza|pause)$/] },
  { id: "show_approvals", patterns: [/^(arata|deschide)( mi)? aprobarile$/, /^show approvals$/] },
  { id: "mute", patterns: [/^(taci|liniste|mute)$/] },
];

const FORBIDDEN = /\b(aprob|aproba|approve|confirm|deploy|publica|publish|push|sterge|delete|sterge tot|trimite|send|plateste|cumpara|buy)\b/;

export function parseVoiceCommand(transcript) {
  const text = normalize(transcript);
  if (!text) return { kind: "empty" };
  for (const command of COMMANDS) {
    if (command.patterns.some((pattern) => pattern.test(text))) return { kind: "command", command: command.id, normalized: text };
  }
  if (FORBIDDEN.test(text)) {
    return { kind: "refused", normalized: text, reason: "Voice cannot approve, publish, delete, send or pay. Use the Approvals screen." };
  }
  return { kind: "message", normalized: text, note: "Shown as an editable draft; nothing is sent until you press Send." };
}
