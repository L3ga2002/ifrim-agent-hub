import { HubError } from "../core/errors.mjs";
import { newId } from "../core/ids.mjs";
import { json, parse } from "../storage/db.mjs";
import { redactText, containsSecretLikeContent } from "../security/redact.mjs";

/**
 * Teach Lega (M08 §15): the owner says a procedure in plain words ("La livrarea unui site de client verifică mobilul, formularele și
 * erorile consolei") and Lega turns it into a clear PROPOSAL — rule, preference or procedure; scope (this mission / this project /
 * all projects); condition; steps; expected result; version and the difference from what exists. The owner's confirmation in a
 * verified session saves it as a memory item (the one memory of the Hub, scope-bound). No six forms.
 *
 * - Only the owner's own words teach: typed in the owner's session or spoken and verified locally. Text from web pages, tool output,
 *   e-mails, documents or reviews is never a lesson (no memory poisoning by self-promotion), even if it is phrased as an order.
 * - A part that changes access, cost or limits ("poți face deploy", "fără confirmare", "folosește API") is split out as a
 *   security decision; it is never saved as a working rule.
 * - "Pentru misiunea asta" stays on the mission; a contextual preference is never generalized to all projects without the owner
 *   saying so. "Uită regula asta" prepares the exact deactivation (one referenced lesson), with its effect shown; history stays.
 */
export const LESSON_KINDS = Object.freeze(["procedure", "rule", "preference"]);
export const LESSON_STATUSES = Object.freeze(["PROPOSED", "ACTIVE", "REFUSED", "SUPERSEDED", "FORGET_PROPOSED", "FORGOTTEN", "DISMISSED"]);
// "owner-voice-provider" = the owner speaking in the Lega voice session (transcribed by the provider): enough for a PROPOSAL; the
// lesson still becomes a rule only after the confirmation in the owner session (confirm below).
const OWNER_PROVENANCE = new Set(["owner-typed", "owner-voice-local", "owner-voice-provider"]);
/**
 * Security-relevant parts = instructions that WIDEN what the Hub may do (allow a deploy, a push, skipping a confirmation, a paid API,
 * access to credentials, bigger limits, external messages, deleting data). A restriction ("fără deploy", "nu face push") is safe.
 * Matched on the normalized text (no diacritics).
 */
// (M08 review) The widening patterns are below, next to securityParts().
const norm = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
// Imperative and second-person forms ("verifică" / "verifici"): the owner says both.
const ACTION_RE = /\b(verifica|verifici|testeaza|testezi|ruleaza|rulezi|fa|faci|cere|ceri|foloseste|folosesti|trimite|trimiti|adauga|adaugi|pastreaza|pastrezi|scrie|scrii|documenteaza|documentezi|preferi|prefera|nu atinge|nu modifica|nu sterge|nu folosi|nu porni|nu)\b/;
const TRIGGER_START = /^(la|cand|inainte de|dupa|daca|in|pe|pentru)\b/;

/** Turns a sentence into { kind, trigger, steps, expected, scopeHint } without a model. */
export function parseLesson(text) {
  // Prefixes ("Lega,", "ține minte:", "de acum") are matched on the normalized text and cut from the original at the same length.
  let raw = String(text || "").trim();
  const prefix = norm(raw).match(/^(lega[,!.: ]+)?((tine minte|retine|invata|de acum (inainte|incolo)|de acum)[:,]?\s*)?/);
  if (prefix?.[0]) raw = raw.slice(prefix[0].length).trim();
  const n = norm(raw);
  const scopeHint = /\bpentru (misiunea|sarcina) (asta|aceasta|curenta)\b|\bdoar (acum|aici|pe misiunea asta)\b/.test(n) ? "MISSION"
    : /\b(pentru|la|in) toate proiectele\b|\b(mereu|intotdeauna|de fiecare data|la orice proiect)\b/.test(n) ? "GLOBAL"
      : /\b(pe|la|pentru) (proiectul )?(asta|acesta|acest proiect)\b/.test(n) ? "PROJECT" : null;
  // The condition is what comes before the first action verb, when it starts like a condition ("La livrarea…", "Când…").
  const m = n.match(ACTION_RE);
  let trigger = null; let action = null; let listText = raw;
  if (m) {
    const at = m.index;
    const before = raw.slice(0, at).replace(/[,:;\s]+$/, "").trim();
    action = raw.slice(at, at + m[0].length);
    listText = raw.slice(at + m[0].length).trim();
    if (before && TRIGGER_START.test(norm(before))) trigger = before;
    else if (before) listText = raw.slice(at).trim(), action = null;
  }
  // "verifici și viteza paginii": a "și" right after the verb means "also", not a second step.
  const also = listText.match(/^(și|si)\s+/i);
  if (action && also) { action = `${action} ${also[1]}`; listText = listText.slice(also[0].length); }
  const items = listText.replace(/[.!]+$/, "").split(/,\s*|\s+și\s+|\s+si\s+|;\s*/).map((x) => x.trim()).filter((x) => x.length > 1).slice(0, 12);
  // An item that has its own verb keeps its own words ("Nu face deploy, rulează testele" must not become "nu face rulează…").
  const steps = items.length ? items.map((x) => (action && !ACTION_RE.test(norm(x)) ? `${action} ${x}` : x)) : [raw.slice(0, 300)];
  const kind = /\b(prefer|preferi|prefera|as vrea|imi place)\b/.test(n) ? "preference" : steps.length > 1 || /\b(verifica|testeaza|ruleaza)\b/.test(n) ? "procedure" : "rule";
  return { kind, trigger, steps, expected: kind === "procedure" ? "Pașii sunt bifați înainte de livrare; ce nu trece e raportat." : null, scopeHint, text: raw };
}

/** The parts of an instruction that would change access, cost or limits. */
/**
 * Widening objects (review M08: the verb lists missed "dă push", "publică pe producție", "emailul", ".env", "timeout").
 * Each pattern names what would widen access; a clause where it is negated BEFORE the object ("nu fă deploy", "fără push",
 * "nu citi .env") is a restriction and is safe. Skipping a confirmation is itself the widening, so it is never "negated away",
 * except a negated action guarded by a confirmation ("nu face deploy fără confirmare").
 */
const WIDENING = [
  [/\b(da|dai|fa|faci|ruleaza|rulezi|executa|executi|poti|ai voie)\b[^,.;]{0,25}\b(push|merge|commit|force)\w*|\b(push|merge|commit)\w*\b[^,.;]{0,20}\b(automat|singur|direct)\b/, "git (commit / push)"],
  [/\b(da|dai|fa|faci|ruleaza|rulezi|executa|poti|ai voie|lanseaza|publica|publici|pune|pui|urca|urci)\b[^,.;]{0,30}\b(deploy\w*|productie|production|live|server\w*)\b|\b(deploy\w*|publicare)\b.{0,20}\b(automat|singur|direct)\b/, "deploy / producție"],
  [/\b(trimite|trimiti|scrie|scrii|raspunde|raspunzi|contacteaza|contactezi)\b[^.;]{0,30}\b(e-?mail\w*|mesaj\w*|sms\w*|client\w*)\b/, "mesaje externe"],
  [/\.env\b|\b(parol\w*|credential\w*|token\w*|ssh|sudo|secret\w*)\b|\bchei\w* (mea|mele|api|openai|anthropic)\b|\b(api key|openai_api_key|anthropic_api_key)\b/, "acces / credențiale"],
  [/\b(foloseste|folosesti|activeaza|activezi|plateste|platesti|cumpara|cumperi|treci pe)\b[^.;]{0,25}\b(api|abonament\w*|credit\w*|extra usage|plan platit)\b/, "cost / facturare"],
  [/\b(mareste|maresti|creste|cresti|ridica|ridici|dubleaza|dublezi)\b[^.;]{0,20}\b(limit\w*|buget\w*|timp\w*|timeout\w*|incercar\w*|durat\w*)\b|\bnelimitat\b|\bfara limita\b/, "limite / buget"],
  [/\b(sterge|stergi|delete|drop|goleste|golesti)\b[^.;]{0,30}\b(date|datele|baz\w*|fisier\w*|productie|backup\w*|tabel\w*)\b/, "ștergere de date"],
];
const SKIP_CONFIRMATION = /\bfara (confirmar\w*|aprobar\w*|acordul\w*|sa (ma )?(mai )?(intrebi|intreb|ceri voie|confirm\w*|aprob\w*))\b|\bnu (ma )?(mai )?(ma )?intreba\b|\bnu (mai )?(cere|astepta|ceri|astepti) (confirmar|aprobar|voie|acord)\w*|\bnu (e|este) nevoie de (confirmar|aprobar|acord)\w*|\bsari (peste )?(confirmar|aprobar|review|verificar)\w*/;
// A negation counts only when it governs the matched verb/object (within two words before it), not anywhere earlier in the clause;
// "nu uita", "nu ezita" and "nu mai aștepta" are not restrictions (review M08 round 2).
const NEGATED_BEFORE = /\b(nu|niciodata|fara|interzis|evita|eviti)\s+(sa\s+)?(mai\s+)?(\S+\s+)?$/;
const NOT_A_RESTRICTION = /\b(nu|niciodata)\s+(mai\s+)?(uita|ezita|astepta|astepti)\b/;
const negatedAt = (clause, index) => { const before = clause.slice(0, index); return NEGATED_BEFORE.test(before) && !NOT_A_RESTRICTION.test(before.split(/\s+/).slice(-4).join(" ")); };
export function securityParts(text) {
  const out = new Set();
  // Sentence punctuation only when followed by a space or the end (".env", "v1.2" stay inside their clause); commas, colons, "dar",
  // "iar", "apoi" and "și" also start a new clause, so "nu fă deploy, dă push" is one restriction and one widening.
  for (const clause of norm(text).split(/[.;!?]+(?=\s|$)|[,:]\s*|\s+(?:iar|apoi|dar|si)\s+/).map((c) => c.trim()).filter(Boolean)) {
    for (const [re, label] of WIDENING) {
      const m = clause.match(re);
      if (m && !negatedAt(clause, m.index)) out.add(label);
    }
    if (SKIP_CONFIRMATION.test(clause) && !/\b(nu|niciodata)\s+(sa\s+)?\S+\b[^.;]*\bfara (confirmar|aprobar)\w*/.test(clause)) out.add("renunțare la confirmare");
  }
  return [...out];
}

export function createTeach({ db, bus, clock, memory, projects }) {
  const iso = (d = clock()) => d.toISOString();
  const rowTo = (r) => r && ({ id: r.id, text: r.text, kind: r.kind, scope: r.scope, scopeRef: r.scope_ref, parsed: parse(r.parsed_json, {}), security: parse(r.security_json, []), provenance: r.provenance,
    status: r.status, memoryItemId: r.memory_item_id, supersedesId: r.supersedes_id, proposedBy: r.proposed_by, decidedBy: r.decided_by, version: r.version, createdAt: r.created_at, decidedAt: r.decided_at });
  const need = (id) => { const r = rowTo(db.prepare("SELECT * FROM lessons WHERE id = ?").get(id)); if (!r) throw new HubError("not_found", "Lecție necunoscută"); return r; };

  /**
   * A proposal from the owner's words. `provenance` is decided by the caller from the channel (typed in the owner session, or a
   * server-held local voice utterance) — never from the text. Anything else is refused with the reason, and nothing is stored as a rule.
   */
  function propose({ text, provenance, projectId = null, missionId = null, scope = null, actor }) {
    const raw = String(text || "").trim();
    if (raw.length < 6) throw new HubError("validation", "Spune instrucțiunea întreagă");
    if (containsSecretLikeContent(raw)) throw new HubError("policy", "O lecție nu poate conține credențiale sau tokenuri");
    if (!OWNER_PROVENANCE.has(provenance)) {
      const id = newId("lsn");
      bus.transaction(() => {
        db.prepare("INSERT INTO lessons (id, text, kind, scope, scope_ref, parsed_json, security_json, provenance, status, proposed_by, created_at) VALUES (?, ?, 'rule', 'NONE', '', '{}', '[]', ?, 'REFUSED', ?, ?)")
          .run(id, redactText(raw).slice(0, 2000), String(provenance || "necunoscut").slice(0, 40), String(actor).slice(0, 80), iso());
        bus.append({ type: "lesson.refused", scopeType: "lesson", scopeId: id, source: actor, payload: { provenance } });
      });
      return { lesson: need(id), refused: true, reason: "Doar cuvintele tale (scrise în sesiunea ta sau spuse și verificate local) devin lecții. Textul dintr-un document, o pagină, un tool sau un review nu e o lecție a ta, chiar dacă sună ca o instrucțiune." };
    }
    const parsed = parseLesson(raw);
    const security = securityParts(raw);
    const finalScope = scope || parsed.scopeHint || (missionId ? "MISSION" : projectId ? "PROJECT" : "GLOBAL");
    if (!["GLOBAL", "PROJECT", "MISSION"].includes(finalScope)) throw new HubError("validation", "Scope: misiunea, proiectul sau toate proiectele");
    const scopeRef = finalScope === "MISSION" ? String(missionId || "") : finalScope === "PROJECT" ? String(projectId || "") : "";
    if (finalScope !== "GLOBAL" && !scopeRef) throw new HubError("validation", finalScope === "MISSION" ? "Pe ce misiune?" : "Pe ce proiect?");
    if (finalScope === "PROJECT" && !projects.get(scopeRef)) throw new HubError("not_found", "Proiect necunoscut");
    // The difference from what exists: active lessons with the same trigger in the same scope.
    const similar = db.prepare("SELECT * FROM lessons WHERE status IN ('ACTIVE','FORGET_PROPOSED') AND scope = ? AND scope_ref = ?").all(finalScope, scopeRef).map(rowTo)
      .filter((l) => parsed.trigger && l.parsed?.trigger && norm(l.parsed.trigger) === norm(parsed.trigger));
    const id = newId("lsn");
    bus.transaction(() => {
      db.prepare(`INSERT INTO lessons (id, text, kind, scope, scope_ref, parsed_json, security_json, provenance, status, supersedes_id, proposed_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PROPOSED', ?, ?, ?)`)
        .run(id, redactText(raw).slice(0, 2000), parsed.kind, finalScope, scopeRef, json(parsed), json(security), provenance, similar[0]?.id || null, String(actor).slice(0, 80), iso());
      bus.append({ type: "lesson.proposed", scopeType: "lesson", scopeId: id, source: actor, payload: { kind: parsed.kind, scope: finalScope, security: security.length } });
    });
    return { lesson: need(id), refused: false, replaces: similar[0] || null,
      securityDecision: security.length ? { parts: security, note: "Partea asta schimbă accesul, costul sau limitele: nu o salvez ca regulă de lucru. Dacă o vrei, e o decizie de securitate separată (politici)." } : null,
      generalization: parsed.scopeHint ? null : `Am presupus scope-ul „${finalScope === "GLOBAL" ? "toate proiectele" : finalScope === "PROJECT" ? "acest proiect" : "această misiune"}”; schimbă-l dacă nu e așa.` };
  }

  /** The owner's confirmation in a verified session: the lesson becomes a memory item (USER_PREFERENCE) bound to its scope. */
  function confirm(id, { ownerSession, actor }) {
    if (!ownerSession) throw new HubError("authentication", "Confirmă lecția în sesiunea ta de proprietar");
    const l = need(id);
    if (l.status !== "PROPOSED") throw new HubError("conflict", `Lecția e în ${l.status}`);
    if (l.security.length) throw new HubError("policy", `Lecția conține o schimbare de securitate (${l.security.join(", ")}); reformuleaz-o fără acea parte sau decide-o separat în politici`);
    const title = `${l.kind === "procedure" ? "Procedură" : l.kind === "preference" ? "Preferință" : "Regulă"}: ${l.parsed.trigger || l.parsed.steps[0]}`.slice(0, 160);
    const body = [l.parsed.trigger ? `Când: ${l.parsed.trigger}` : null, "Pași:", ...l.parsed.steps.map((s, i) => `${i + 1}. ${s}`), l.parsed.expected ? `Rezultat: ${l.parsed.expected}` : null, `(Lecție ${l.id}, de la proprietar)`].filter(Boolean).join("\n");
    const result = bus.transaction(() => {
      let item;
      const prev = l.supersedesId ? need(l.supersedesId) : null;
      if (prev?.memoryItemId && memory.get(prev.memoryItemId)?.status === "active") {
        item = memory.revise(prev.memoryItemId, { title, body, sourceRef: `lesson:${l.id}` }, "user");
        db.prepare("UPDATE lessons SET status = 'SUPERSEDED' WHERE id = ?").run(prev.id);
      } else item = memory.add({ scope: l.scope, scopeRef: l.scopeRef, type: "USER_PREFERENCE", title, body, sourceRef: `lesson:${l.id}`, author: "user", sourceKind: "user" });
      db.prepare("UPDATE lessons SET status = 'ACTIVE', memory_item_id = ?, decided_by = ?, decided_at = ?, version = version + 1 WHERE id = ?").run(item.id, String(actor).slice(0, 80), iso(), id);
      bus.append({ type: "lesson.confirmed", scopeType: "lesson", scopeId: id, source: actor, payload: { memoryItemId: item.id, scope: l.scope } });
      return item;
    });
    return { lesson: need(id), memoryItem: result };
  }

  function dismiss(id, { actor }) {
    const l = need(id);
    if (l.status !== "PROPOSED") throw new HubError("conflict", `Lecția e în ${l.status}`);
    bus.transaction(() => { db.prepare("UPDATE lessons SET status = 'DISMISSED', decided_by = ?, decided_at = ? WHERE id = ?").run(String(actor).slice(0, 80), iso(), id); });
    return need(id);
  }

  /** "Uită regula asta": finds the exact active lesson(s) and prepares the deactivation; nothing is deleted yet. */
  function proposeForget({ ref = "", lessonId = null, actor }) {
    let matches;
    if (lessonId) matches = [need(lessonId)].filter((l) => l.status === "ACTIVE");
    else {
      const words = norm(ref).match(/[a-z0-9]{4,}/g) || [];
      matches = db.prepare("SELECT * FROM lessons WHERE status = 'ACTIVE' ORDER BY created_at DESC").all().map(rowTo)
        .map((l) => ({ l, score: words.filter((w) => norm(`${l.text} ${l.parsed?.trigger || ""}`).includes(w)).length })).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).map((x) => x.l);
    }
    if (!matches.length) return { matches: [], note: "Nu găsesc o lecție activă care să corespundă; spune-mi mai exact sau alege din listă." };
    if (matches.length > 1) return { matches: matches.slice(0, 5), question: "Care dintre ele? Uit doar regula aleasă, nu toate cele asemănătoare." };
    const l = matches[0];
    bus.transaction(() => {
      db.prepare("UPDATE lessons SET status = 'FORGET_PROPOSED', version = version + 1 WHERE id = ?").run(l.id);
      bus.append({ type: "lesson.forget_proposed", scopeType: "lesson", scopeId: l.id, source: actor, payload: {} });
    });
    return { matches: [need(l.id)], effect: `Regula „${l.parsed?.trigger || l.text.slice(0, 80)}” nu se mai aplică misiunilor noi; istoricul deciziilor rămâne. Confirmă în sesiunea ta.` };
  }

  function confirmForget(id, { ownerSession, actor }) {
    if (!ownerSession) throw new HubError("authentication", "Confirmă în sesiunea ta de proprietar");
    const l = need(id);
    if (l.status !== "FORGET_PROPOSED") throw new HubError("conflict", "Uitarea nu a fost pregătită pentru această lecție");
    bus.transaction(() => {
      if (l.memoryItemId) memory.remove(l.memoryItemId, actor);
      db.prepare("UPDATE lessons SET status = 'FORGOTTEN', decided_by = ?, decided_at = ?, version = version + 1 WHERE id = ?").run(String(actor).slice(0, 80), iso(), id);
      bus.append({ type: "lesson.forgotten", scopeType: "lesson", scopeId: id, source: actor, payload: { memoryItemId: l.memoryItemId } });
    });
    return need(id);
  }

  /** Active lessons that apply to a project/mission (global + project + mission), for the worker prompt and the cockpit. */
  function rulesFor({ projectId = null, missionId = null } = {}) {
    // A rule whose deactivation is only PROPOSED still applies: it stops applying when the owner confirms the forget (review M08).
    return db.prepare("SELECT * FROM lessons WHERE status IN ('ACTIVE','FORGET_PROPOSED') AND (scope = 'GLOBAL' OR (scope = 'PROJECT' AND scope_ref = ?) OR (scope = 'MISSION' AND scope_ref = ?)) ORDER BY created_at").all(projectId || "", missionId || "").map(rowTo);
  }

  const list = ({ status = null } = {}) => db.prepare(`SELECT * FROM lessons ${status ? "WHERE status = ?" : ""} ORDER BY created_at DESC LIMIT 100`).all(...(status ? [status] : [])).map(rowTo);
  /** Withdraws a forget proposal: the rule stays exactly as it was (it never stopped applying). */
  function cancelForget(id, { actor }) {
    const l = need(id);
    if (l.status !== "FORGET_PROPOSED") throw new HubError("conflict", "Nu e nicio dezactivare propusă pentru această lecție");
    bus.transaction(() => {
      db.prepare("UPDATE lessons SET status = 'ACTIVE', version = version + 1 WHERE id = ?").run(id);
      bus.append({ type: "lesson.forget_cancelled", scopeType: "lesson", scopeId: id, source: actor, payload: {} });
    });
    return need(id);
  }

  return { propose, confirm, dismiss, proposeForget, confirmForget, cancelForget, rulesFor, list, get: need };
}
