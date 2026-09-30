/**
 * Local voice command parser (Romanian first, English technical terms accepted). Only safe-direction
 * commands are recognized. A transcript can never approve, deploy, delete or grant anything: those
 * words are detected and explicitly refused so a misheard phrase cannot authorize an action.
 * With `legaPrefix`, an optional leading "Lega" (the assistant's name) is accepted: "Lega, oprește tot".
 */
const normalize = (text) => String(text || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();

const COMMANDS = [
  { id: "stop_all", patterns: [/^(opreste|stop|opreste tot|stop all|opriti tot)( tot| totul)?$/] },
  { id: "pause", patterns: [/^(pauza|pune pe pauza|pause)$/] },
  { id: "show_approvals", path: "/approvals", patterns: [/^(arata|deschide)( mi)? aprobarile$/, /^show approvals$/] },
  { id: "open_focus", path: "/conversations", patterns: [/^(intra|treci|deschide)( in)? focus$/, /^deschide conversatiile$/] },
  { id: "open_control", path: "/control", patterns: [/^(deschide|arata)( mi)? (camera de control|control room|controlul)$/] },
  { id: "open_missions", path: "/missions", patterns: [/^(deschide|arata)( mi)? misiunile$/] },
  { id: "mute", patterns: [/^(taci|liniste|mute)$/] },
];

const FORBIDDEN = /\b(aprob|aproba|approve|confirm|deploy|publica|publish|push|sterge|delete|sterge tot|trimite|send|plateste|cumpara|buy)\b/;

/** Unambiguous global forms that stop everything even without the assistant's name. */
const EXPLICIT = new Set(["opreste tot", "opreste totul", "opriti tot", "stop all", "pune pe pauza"]);

export function parseVoiceCommand(transcript, { legaPrefix = false } = {}) {
  let text = normalize(transcript);
  let addressed = false;
  if (legaPrefix) {
    const stripped = text.replace(/^(hei |hey |buna )?lega( |$)/, "").trim();
    addressed = stripped !== text;
    text = stripped;
  }
  if (!text) return { kind: "empty" };
  for (const command of COMMANDS) {
    if (command.patterns.some((pattern) => pattern.test(text))) return { kind: "command", command: command.id, normalized: text, addressed, explicit: EXPLICIT.has(text), ...(command.path ? { path: command.path } : {}) };
  }
  if (FORBIDDEN.test(text)) {
    return { kind: "refused", normalized: text, reason: "Voice cannot approve, publish, delete, send or pay. Use the Approvals screen." };
  }
  return { kind: "message", normalized: text, note: "Shown as an editable draft; nothing is sent until you press Send." };
}
