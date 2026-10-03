/**
 * IntentResolver (M06 §11): the owner's words (typed, or a transcript) → ordered steps, resolved locally without a model.
 *
 * - Chained commands are split into steps ("…; apoi …"), each with an effect class: none | read | navigate | plan | effect |
 *   interrupt. Reading and planning never start work; an `effect` step only becomes a request that the backend validates
 *   against the session, the policy and the pending envelope.
 * - Negations and conditions are kept ("nu porni", "doar arată", "fără deploy"): they remove effects, never add them.
 * - A confirmation ("da", "execută planul") counts only when exactly one plan waits for it; with two it asks which one; a
 *   word inside quotes is a quotation, not consent. A model may PROPOSE an intent elsewhere; it never confirms through here.
 * - Project and mission references are matched without diacritics; two plausible matches produce one useful question.
 *
 * Pure function; the caller supplies the context (projects, current project, missions, pending envelopes).
 */
export const INTENT_EFFECTS = Object.freeze({
  open_project: "navigate", switch_project: "navigate", continue_last: "read", show_changes: "read", show_review: "read", show_tests: "read",
  show_preview: "read", show_plan: "plan", continue_work: "plan", confirm: "effect", not_yet: "none", reject_plan: "none", reorder: "none",
  status: "read", why_blocked: "read", why_route: "read", replay: "read", back: "navigate", live: "navigate", show_company: "navigate",
  zoom: "navigate", face_show: "none", face_core: "none", face_discreet: "none", face_hide: "none", focus: "none", mute: "interrupt",
  pause: "interrupt", stop_worker: "interrupt", freeze_project: "interrupt", unfreeze_project: "effect", stop_all: "interrupt", takeover: "interrupt",
  quiet: "none", notify_normal: "none", briefing: "read", autonomy: "effect", recommendations: "read", help: "read", unknown: "none",
});

const STRIP = new Map(Object.entries({ "ă": "a", "â": "a", "î": "i", "ș": "s", "ş": "s", "ț": "t", "ţ": "t", "Ă": "a", "Â": "a", "Î": "i", "Ș": "s", "Ş": "s", "Ț": "t", "Ţ": "t" }));
/** Lower case, no diacritics, punctuation → spaces (quotes kept as markers so quoted words can be excluded). */
export function normalize(text) {
  return String(text || "").replace(/[ăâîșşțţĂÂÎȘŞȚŢ]/g, (c) => STRIP.get(c) || c).toLowerCase()
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[„“”«»"]/g, " \u0001 ").replace(/[^a-z0-9\u0001;.!?,\s-]/g, " ").replace(/\s+/g, " ").trim();
}

/** Removes quoted passages (a "confirm" quoted from a document or a page is not the owner's consent). */
function unquote(norm) {
  const parts = norm.split("\u0001");
  return parts.filter((_, i) => i % 2 === 0).join(" ").replace(/\s+/g, " ").trim();
}

const STOP_WORDS = new Set(["la", "pe", "cu", "de", "si", "in", "din", "pentru", "proiectul", "proiect", "misiunea", "problema", "lucram", "hai", "sa", "ne", "mai", "un", "o", "al", "ale", "a"]);
const stem = (w) => w.replace(/(urilor|urile|elor|ilor|ului|ele|ile|uri|lor|ul|le|ii|ei|ea|a|e|i)$/, "") || w;
const tokens = (s) => normalize(s).replace(/\u0001/g, " ").split(/[\s.,;!?-]+/).filter((w) => w && !STOP_WORDS.has(w));

/** Best matches of a free reference among named items (projects or missions): full-name hits first, then token overlap. */
export function matchRef(ref, items, { name = (x) => x.name, extra = () => [] } = {}) {
  const want = tokens(ref).map(stem).filter((w) => w.length >= 2);
  if (!want.length) return [];
  const scored = items.map((item) => {
    const names = [name(item), ...extra(item)].filter(Boolean);
    let best = 0;
    for (const n of names) {
      const nn = normalize(n).replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
      const words = tokens(n).map(stem);
      const compact = nn.replace(/ /g, "");
      const refCompact = want.join("");
      if (compact && (compact === refCompact || nn === want.join(" "))) { best = Math.max(best, 100); continue; }
      const hits = want.filter((w) => words.some((x) => x === w || (w.length >= 4 && (x.startsWith(w) || w.startsWith(x))))).length;
      if (hits) best = Math.max(best, Math.round((hits / Math.max(want.length, words.length)) * 80) + (hits === want.length ? 10 : 0));
      if (refCompact.length >= 5 && compact.includes(refCompact)) best = Math.max(best, 70);
    }
    return { item, score: best };
  }).filter((x) => x.score >= 30).sort((a, b) => b.score - a.score);
  if (!scored.length) return [];
  const top = scored[0].score;
  return scored.filter((x) => x.score >= top - 5).map((x) => x.item);
}

// Pattern table: [intent, regex on the normalized clause, (match, clause) => args]. First match wins per clause.
const P = [
  ["stop_all", /\b(opreste|stop|opriti) (tot|totul|toate)\b|\bstop all\b/],
  ["takeover", /\bpreiau eu\b|\blas(a|ati)[- ]ma pe mine\b|\bpreiau (controlul|de aici)\b/],
  ["freeze_project", /\bingheata (?<ref>.+)/, (m) => ({ projectRef: m.groups.ref })],
  ["unfreeze_project", /\bdezgheata (?<ref>.+)/, (m) => ({ projectRef: m.groups.ref })],
  ["stop_worker", /\bopreste (?<who>codex|claude|writerul|writer|reviewerul|reviewer|agentul|workerul)\b/, (m) => ({ worker: /claude|review/.test(m.groups.who) ? "claude" : /codex|writer/.test(m.groups.who) ? "codex" : "any" })],
  ["mute", /^(taci|liniste|nu mai vorbi|gata cu vorba|opreste vocea|mut)\b|\bnu mai vorbi\b|\btaci\b/],
  // A confirmation is an answer, anchored at the start ("da", "execută planul"); "nu porni" or "doar planul" never match it.
  ["confirm", /^(da|da,? (fa-l|fa-o|fa|porneste|executa|te rog)|confirm|confirma|confirmat|executa planul|porneste|da,? executa planul|ok,? porneste|da,? porneste)( planul)?$/],
  ["pause", /^(pauza|pune pe pauza|pune pauza)\b|\bpune (totul )?pe pauza\b|\bia o pauza\b/],
  ["quiet", /\bnu ma deranja\b|\bfara notificari\b|\bmod linistit\b/, (m, c) => ({ onlyDecisions: /\bdecat (pentru|daca|la) (o )?decizi/.test(c) || /\bdoar (pentru|la) decizi/.test(c) })],
  ["notify_normal", /\b(poti sa ma (anunti|deranjezi)|notificari normale|anunta-ma)\b/],
  ["face_show", /\barata(-ti|ti)? fata\b|\barata-te\b|\bfata ta\b/],
  ["face_core", /\brevino la nucleu\b|\binapoi la nucleu\b|\bnucleul\b/],
  ["face_discreet", /\bmai discret\b|\bmai mic\b|\bcompact\b/],
  ["face_hide", /\bascunde (fata|avatarul)\b/],
  ["live", /\b(revino|inapoi) la (acum|live|prezent)\b|\bmod live\b/],
  ["replay", /\b(arata|explica)(-mi)? (de ce|cum) a (picat|esuat|cazut)\b|\bde ce a picat\b|\breplay\b|\barata(-mi)? momentul\b/, (m, c) => ({ subject: /\btest/.test(c) ? "test" : "mission" })],
  ["why_blocked", /\bde ce (e|este|a ramas|s-a|sa) (blocat|oprit|in asteptare)|\bde ce nu (porneste|merge|continua)\b|\bce (il|o) blocheaza\b/],
  ["why_route", /\bde ce (?<who>claude|codex)\b/, (m) => ({ worker: m.groups.who })],
  ["status", /\bce face (acum|codex|claude)\b|\bce se intampla\b|\bunde (suntem|am ajuns)\b|\bcum merge\b|\bce faci acum\b|\bstatus\b/, (m, c) => ({ worker: /codex/.test(c) ? "codex" : /claude/.test(c) ? "claude" : null })],
  ["show_review", /\b(claude|reviewerul|review-ul|reviewul) ce (a gasit|zice|spune)\b|\bce (a gasit|zice|spune) (claude|reviewerul)\b|\bce zice review\b|\barata(-mi)? review/],
  ["show_changes", /\bce a schimbat\b|\barata(-mi)? (ce a schimbat|diff|modificarile|schimbarile)\b|\bce (fisiere|modificari) (a|au)\b/],
  ["show_tests", /\btestele\b|\bau trecut testele\b|\bce teste\b|\barata(-mi)? test/],
  ["show_preview", /\bpreview\b|\barata(-mi)? (aplicatia|rezultatul)\b/],
  ["show_company", /\barata(-mi)? compania\b|\bharta (companiei|firmei)\b|\bcompania\b/],
  ["recommendations", /\bce recomanzi\b|\bce (putem|pot) simplifica\b|\brecomandari(le)?\b/],
  ["briefing", /\bce s-a schimbat\b|\bbuna dimineata\b|\bbriefing\b|\bce e nou\b|\brezumatul zilei\b/],
  ["continue_last", /\bcontinua ce faceam\b|\bunde am ramas\b|\bce faceam (ieri|azi|aseara|data trecuta)\b/],
  ["show_plan", /\barata(-mi)? (mai intai |inainte )?(planul|ce (ai de gand|vrei sa faci))\b|\barata(-mi)? inainte (sa faci?|de a face)\b|\bplanul\b/],
  ["focus", /\bdoar ce conteaza\b|\bmod(ul)? focus\b|\bfara detalii\b/],
  ["continue_work", /\bcontinua (?<what>.+)$|\bfa (?<what2>.+) pana e gata/, (m, c) => ({ topic: cleanTopic(String(m.groups.what || m.groups.what2 || "").replace(/\bpana (e|este|cand e) gata.*$/, "")), untilReady: /\bpana (e|este|cand e) gata\b/.test(c) })],
  ["reorder", /\bschimba ordinea\b|\bmai intai (?<first>.+?) (apoi|si dupa) (?<second>.+)/, (m) => ({ first: m.groups?.first || null, second: m.groups?.second || null })],
  ["not_yet", /\bnu (porni|incepe|rula|executa)( inca| nimic)?\b|\bnu inca\b|\basteapta\b|\bmai tarziu\b/],
  ["reject_plan", /^(nu|nu,? (multumesc|renunt))$|\brenunt la plan\b|\banuleaza planul\b/],
  ["autonomy", /\b(seteaza|pune|schimba) (nivelul de )?autonomi(a|e) (pe|la) (?<level>observe|assisted|trusted|high)\b(?: (pe|la|pentru) (?<ref>.+))?/, (m) => ({ level: { observe: "OBSERVE", assisted: "ASSISTED", trusted: "TRUSTED", high: "HIGH_AUTONOMY_BOUNDED" }[m.groups.level], projectRef: m.groups.ref || null })],
  ["back", /^(inapoi|revino|back)$/],
  ["help", /\bce (poti|stii sa) (face|faci)\b|\bajutor\b/],
  ["open_project", /\b(hai sa lucram|lucram|hai la|deschide|treci pe|schimba pe|comuta pe|mergi pe|du-ma la|arata-mi) (la |pe )?(proiectul )?(?<ref>[a-z0-9 -]{2,60})$/, (m) => ({ projectRef: m.groups.ref })],
];

function cleanTopic(text) {
  return String(text).replace(/\b(problema|misiunea|lucrul|treaba|task(ul)?|cu)\b/g, " ").replace(/\bdar\b.*$/, " ").replace(/\s+/g, " ").trim();
}

/** Constraints carried by a clause; they only narrow what the step may do. */
function constraintsOf(clause) {
  const c = {};
  if (/\bfara (deploy|publicare|productie)\b/.test(clause)) c.noDeploy = true;
  if (/\bfara (commit|push)\b/.test(clause)) c.noGit = true;
  if (/\bfara (mesaje|email|trimitere)\b/.test(clause)) c.noMessages = true;
  if (/\bnu (porni|incepe|rula|executa)\b|\bdoar (arata|spune|explica|planul)\b|\bfara sa (pornesti|incepi)\b/.test(clause)) c.noStart = true;
  if (/\bdoar (citire|citeste)\b|\bfara modificari\b/.test(clause)) c.readOnly = true;
  return c;
}

/**
 * @param {string} text
 * @param {{ projects?: Array, currentProjectId?: string|null, missions?: Array, pendingEnvelopes?: Array, awaiting?: string|null, source?: string }} context
 *   `source`: "typed" | "voice-local" | "voice-provider" | "document". Only typed or locally verified voice may produce a
 *   confirmation; a provider transcript or document text never does.
 */
export function resolveIntent(text, context = {}) {
  const raw = String(text || "").slice(0, 2000);
  const source = context.source || "typed";
  let norm = normalize(raw).replace(/^(hei |hey |buna )?lega[,!. ]+/, "");
  const quotedParts = norm.split("\u0001").filter((_, i) => i % 2 === 1).join(" ");
  const quotedConfirm = /\b(da|confirm|confirma|executa|porneste)\b/.test(quotedParts);
  norm = unquote(norm);
  const clauses = norm.split(/;|\. |!|\? | (?:si )?apoi | dupa aceea | dupa care | iar apoi /).map((s) => s.replace(/[.,!?]+$/g, "").trim()).filter(Boolean);
  const steps = [];
  const globalConstraints = constraintsOf(norm);
  for (const clause of clauses) {
    const matchedConstraints = constraintsOf(clause);
    let found = null;
    for (const [intent, re, argsOf] of P) {
      const m = clause.match(re);
      if (m) { found = { intent, args: argsOf ? argsOf(m, clause) : {} }; break; }
    }
    // A clause that is only a constraint ("dar fără deploy") attaches to the previous step instead of being a step itself.
    if (!found && Object.keys(matchedConstraints).length && steps.length) { Object.assign(steps[steps.length - 1].constraints, matchedConstraints); continue; }
    if (!found) found = { intent: "unknown", args: {} };
    steps.push({ intent: found.intent, args: found.args, constraints: { ...matchedConstraints }, effect: INTENT_EFFECTS[found.intent] || "none", text: clause });
  }
  if (!steps.length) steps.push({ intent: "unknown", args: {}, constraints: {}, effect: "none", text: "" });
  for (const step of steps) Object.assign(step.constraints, globalConstraints);

  const out = { utterance: raw, normalized: norm, source, quotedConfirm, steps: [], clarification: null, refused: [] };
  if (quotedConfirm) out.refused.push({ intent: "confirm", reason: "O confirmare între ghilimele este un citat, nu răspunsul tău; am ignorat-o" });
  for (const step of steps) {
    const resolved = resolveRefs(step, context);
    if (resolved.clarification && !out.clarification) out.clarification = resolved.clarification;
    // Negations remove effects: "nu porni" / "doar arată" turn a plan or a confirmation into a preview only.
    if (step.constraints.noStart && (step.intent === "confirm" || step.intent === "continue_work")) {
      if (step.intent === "confirm") { out.refused.push({ intent: "confirm", reason: "Ai spus să nu pornească nimic" }); step.intent = "not_yet"; step.effect = "none"; }
      else step.args.previewOnly = true;
    }
    if (step.intent === "confirm") {
      const confirm = checkConfirmation(context, source);
      if (!confirm.ok) {
        out.refused.push({ intent: "confirm", reason: confirm.reason });
        if (confirm.clarification && !out.clarification) out.clarification = confirm.clarification;
        step.intent = "unknown"; step.effect = "none"; step.args = { refusedConfirmation: confirm.reason };
      } else step.args.envelopeId = confirm.envelopeId;
    }
    if (step.intent === "unknown" && !step.args.refusedConfirmation && step.text) {
      const flat = (v) => normalize(v).replace(/[^a-z0-9]/g, "");
      const dept = (context.departments || []).find((d) => flat(d.name) === flat(step.text) || flat(d.key) === flat(step.text));
      const exact = dept ? [] : (context.projects || []).filter((p) => flat(p.name) === flat(step.text) || flat(p.slug) === flat(step.text));
      if (dept) { step.intent = "zoom"; step.effect = "navigate"; step.args = { departmentKey: dept.key }; }
      else if (exact.length === 1) { step.intent = "open_project"; step.effect = "navigate"; step.args = { projectId: exact[0].id, projectRef: step.text }; }
    }
    out.steps.push(step);
  }
  return out;
}

function resolveRefs(step, context) {
  const projects = context.projects || [];
  const needsProject = ["open_project", "freeze_project", "unfreeze_project"].includes(step.intent) || (step.intent === "autonomy" && step.args.projectRef);
  if (needsProject) {
    const ref = step.args.projectRef;
    const matches = ref ? matchRef(ref, projects, { extra: (p) => [p.slug] }) : [];
    if (matches.length === 1) step.args.projectId = matches[0].id;
    else if (matches.length > 1) return { clarification: { question: `La care proiect te referi: ${matches.slice(0, 4).map((p) => p.name).join(" sau ")}?`, options: matches.slice(0, 4).map((p) => ({ id: p.id, label: p.name })), forIntent: step.intent } };
    else if (ref) step.args.unknownRef = ref;
  }
  if (step.intent === "autonomy" && !step.args.projectId) step.args.projectId = context.currentProjectId || null;
  if (step.intent === "freeze_project" && !step.args.projectId && /^(proiectul|tot proiectul|asta|acesta)$/.test(String(step.args.projectRef || "").trim())) step.args.projectId = context.currentProjectId || null;
  if (step.intent === "continue_work" && step.args.topic) {
    const missions = (context.missions || []).filter((m) => !context.currentProjectId || m.projectId === context.currentProjectId);
    const matches = matchRef(step.args.topic, missions, { name: (m) => m.title });
    if (matches.length === 1) step.args.missionId = matches[0].id;
    else if (matches.length > 1) return { clarification: { question: `Care misiune: ${matches.slice(0, 4).map((m) => `„${m.title}”`).join(" sau ")}?`, options: matches.slice(0, 4).map((m) => ({ id: m.id, label: m.title })), forIntent: "continue_work" } };
  }
  return {};
}

/**
 * A "yes" is consent only for one presented plan, from the owner's own input (typed in the session, or voice verified
 * locally), while the cockpit waits for exactly that answer.
 */
function checkConfirmation(context, source) {
  if (!["typed", "voice-local"].includes(source)) return { ok: false, reason: source === "voice-provider" ? "O transcriere făcută de provider nu poate confirma; confirmă în cockpit (tastă sau buton) sau cu verificarea locală a vocii" : "Textul nu vine de la tine în sesiune (document, unealtă sau pagină)" };
  const pending = context.pendingEnvelopes || [];
  if (context.awaiting !== "envelope_confirmation" && pending.length !== 1) return { ok: false, reason: "Nu aștept acum o confirmare (întrebarea anterioară nu era despre un plan)" };
  if (pending.length === 0) return { ok: false, reason: "Niciun plan nu așteaptă confirmarea" };
  if (pending.length > 1) return { ok: false, reason: "Sunt mai multe planuri în așteptare", clarification: { question: `Care plan: ${pending.slice(0, 4).map((e) => `„${e.title}”`).join(" sau ")}?`, options: pending.slice(0, 4).map((e) => ({ id: e.id, label: e.title })), forIntent: "confirm" } };
  if (context.awaiting !== "envelope_confirmation") return { ok: false, reason: "Planul nu a fost prezentat în această conversație; deschide-l și confirmă-l acolo" };
  return { ok: true, envelopeId: pending[0].id };
}
