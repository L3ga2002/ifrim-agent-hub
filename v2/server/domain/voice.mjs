/**
 * Local voice command parser (Romanian first, English technical terms accepted). Only safe-direction
 * commands are recognized. A transcript can never approve, deploy, delete or grant anything: those
 * words are detected and explicitly refused so a misheard phrase cannot authorize an action.
 * With `legaPrefix`, an optional leading "Lega" (the assistant's name) is accepted: "Lega, oprește tot".
 *
 * M10.2: the same normalization and the same polite-word stripper as the owner's intent resolver (owner/intents.mjs), so "Te rog,
 * oprește tot", "Oprește tot, te rog", "Lega, oprește tot acum", "Stop, oprește tot" and "Oprește tot ce rulează" stop on voice
 * exactly as they do typed (live, each was an ordinary message and nothing stopped). Stop stays deterministic and model-free; the
 * open-mic rule is unchanged: a bare "stop" / "oprește" is `explicit: false`, and without the name Lega only goes quiet.
 */
import { normalize as normalizeIntentText, stripFillers } from "../owner/intents.mjs";

/** Intent normalization (diacritics incl. ș/ț, quotes) → polite words removed → punctuation as spaces (the patterns below are word-only). */
const words = (text) => String(text || "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
const normalize = (text) => words(stripFillers(normalizeIntentText(text)));

const COMMANDS = [
  { id: "stop_all", patterns: [/^(opreste|stop|opreste tot|stop all|opriti tot)( tot| totul)?$/, /^(?:stop )?(?:opreste|opriti|stop) (?:tot|totul|toate)(?: acum| imediat| ce (?:ruleaza|merge|lucreaza|porneste))?$/,
    // 2.12.2 (P0-R2): „Stop all now” is the same command (anchored like the others).
    /^stop all (?:now|acum|imediat)$/] },
  { id: "pause", patterns: [/^(pauza|pune pe pauza|pause)$/] },
  { id: "show_approvals", path: "/approvals", patterns: [/^(arata|deschide)( mi)? aprobarile$/, /^show approvals$/] },
  { id: "open_focus", path: "/conversations", patterns: [/^(intra|treci|deschide)( in)? focus$/, /^deschide conversatiile$/] },
  { id: "open_control", path: "/control", patterns: [/^(deschide|arata)( mi)? (camera de control|control room|controlul)$/] },
  { id: "open_missions", path: "/missions", patterns: [/^(deschide|arata)( mi)? misiunile$/] },
  { id: "mute", patterns: [/^(taci|liniste|mute)$/] },
];

// M10.2: running files or installers is refused like approving or deleting (a misheard "execută" must not reach anything).
const FORBIDDEN = /\b(aprob|aproba|approve|confirm|deploy|publica|publish|push|sterge|delete|sterge tot|trimite|send|plateste|cumpara|buy|executa|ruleaza|instaleaza)\b/;

/**
 * Unambiguous global forms that stop everything even without the assistant's name: "oprește tot" in any of its polite or extended
 * forms (the word "tot / totul / toate" makes it explicit), "stop all", "pune pe pauză". A bare "oprește" / "stop" never is.
 */
const EXPLICIT = new Set(["stop all", "pune pe pauza"]);
const isExplicit = (command, text) => EXPLICIT.has(text) || (command === "stop_all" && /\b(tot|totul|toate|all)\b/.test(text));
/**
 * 2.12.2 (P0-R2): the normalization above drops punctuation, so „Oprește tot?” and a quoted „„Oprește tot”” read like the command. A stop
 * or a pause is a command only when it IS one: with a question mark or quotation marks in the transcript it is never taken here — it goes
 * on as an ordinary message (under voice-first the intake answers it; nothing stops). Mute and the fixed screens are unaffected.
 */
const TALK_MARKS = /[?„“”«»"]/;
const GLOBAL = new Set(["stop_all", "pause"]);

export function parseVoiceCommand(transcript, { legaPrefix = false } = {}) {
  const talk = TALK_MARKS.test(String(transcript || ""));
  let text = normalize(transcript);
  let addressed = false;
  if (legaPrefix) {
    const stripped = text.replace(/^(hei |hey |buna )?lega( |$)/, "").trim();
    addressed = stripped !== text;
    // "Lega, te rog, oprește tot": the polite words may also follow her name.
    text = addressed ? words(stripFillers(stripped)) : stripped;
  }
  if (!text) return { kind: "empty" };
  for (const command of COMMANDS) {
    if (talk && GLOBAL.has(command.id)) continue;
    if (command.patterns.some((pattern) => pattern.test(text))) return { kind: "command", command: command.id, normalized: text, addressed, explicit: isExplicit(command.id, text), ...(command.path ? { path: command.path } : {}) };
  }
  if (FORBIDDEN.test(text)) {
    return { kind: "refused", normalized: text, reason: "Voice cannot approve, publish, delete, send or pay. Use the Approvals screen." };
  }
  return { kind: "message", normalized: text, note: "Shown as an editable draft; nothing is sent until you press Send." };
}
