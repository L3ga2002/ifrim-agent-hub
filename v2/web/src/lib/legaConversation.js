// One L3ga screen (2026-10-18): the conversation and the unsent text of the Lega screen, kept PER PROJECT outside the screen component,
// so a change of view (Nucleu / Față / Hartă, discret, ecran complet), a project switch (which remounts the screen) or a visit to
// another screen and back never loses or doubles them. The company view (no project open) is its own key. Pure helpers; the screen
// binds them to the app store. Never authoritative: the Hub's own data (plans, decisions, executions) is always read back from it.

/** The key of a project's conversation; "" (no project) is the company conversation. */
export const conversationKey = (projectId) => (typeof projectId === "string" && projectId ? projectId : "company");

/** At most this many messages per project (as the cockpit kept before: the last 40 plus the newest answer). */
export const CONVERSATION_MAX = 41;

const EMPTY = Object.freeze([]);

/** The conversation of one project in a conversations map ({ key: messages[] }). */
export function conversationOf(map, projectId) {
  const list = map && Object.hasOwn(map, conversationKey(projectId)) ? map[conversationKey(projectId)] : null;
  return Array.isArray(list) ? list : EMPTY;
}

/**
 * A new conversations map where `update` (a function of the old list, or a list) replaced ONE project's conversation, bounded to the
 * last CONVERSATION_MAX messages. The other projects' conversations are the same objects (never merged, never cleared).
 */
export function withConversation(map, projectId, update) {
  const key = conversationKey(projectId);
  const current = conversationOf(map, projectId);
  const next = typeof update === "function" ? update(current) : update;
  const list = Array.isArray(next) ? next.slice(-CONVERSATION_MAX) : EMPTY;
  return { ...(map || {}), [key]: list };
}

/** The unsent text of one project's composer. */
export function draftOf(drafts, projectId) {
  const value = drafts && Object.hasOwn(drafts, conversationKey(projectId)) ? drafts[conversationKey(projectId)] : "";
  return typeof value === "string" ? value : "";
}

/** A new drafts map with one project's unsent text replaced (an empty text removes the entry). */
export function withDraft(drafts, projectId, text) {
  const key = conversationKey(projectId);
  const next = { ...(drafts || {}) };
  if (typeof text === "string" && text.length) next[key] = text.slice(0, 4000);
  else delete next[key];
  return next;
}

/**
 * Where the exchange of one sentence is recorded: the project it was asked in, or — when the Hub's answer opens another project's
 * Lega screen („Hai să lucrăm la X”) — that project, so the owner finds the question and the answer where the screen goes.
 */
export function exchangeProject(askedIn, results = []) {
  for (const r of Array.isArray(results) ? results : []) {
    const nav = typeof r?.navigate === "string" ? r.navigate : "";
    if (nav.startsWith("/cockpit/")) { const next = nav.split("/")[2]; if (next) return next; }
  }
  return askedIn || "";
}

/** The four views of the one screen: the shape of Lega's figure, plus the hidden figure (the map alone). */
export const VIEW_SHAPES = Object.freeze(["CORE", "FACE", "GRAPH"]);
export const VIEW_LABEL = Object.freeze({ CORE: "Nucleu", FACE: "Față", GRAPH: "Hartă" });

// ---------------------------------------------------------------- M14: the conversation survives a reload
/** Where the browser keeps the conversations and the unsent texts between reloads (this computer's browser only; never the Hub's data). */
export const CONVERSATIONS_STORAGE_KEY = "hub.v2.lega.conversations";
/** At most this many conversations are kept (the most recently used); each keeps its last CONVERSATION_MAX messages. */
export const PERSIST_MAX_CONVERSATIONS = 12;
const PERSIST_TEXT_MAX = 4000;

/** A message as it is kept: who, what, when and its screen links — never the choice or blocker buttons (bound to the screen that showed them). */
const keptMessage = (m) => {
  if (!m || (m.role !== "user" && m.role !== "lega") || typeof m.text !== "string") return null;
  const links = Array.isArray(m.links) ? m.links.filter((l) => l && typeof l.path === "string" && typeof l.label === "string").slice(0, 4).map((l) => ({ path: l.path.slice(0, 300), label: l.label.slice(0, 120) })) : [];
  return { role: m.role, text: m.text.slice(0, PERSIST_TEXT_MAX), at: Number(m.at) || 0, ...(links.length ? { links } : {}) };
};
const lastAt = (list) => (Array.isArray(list) && list.length ? Number(list[list.length - 1]?.at) || 0 : 0);

/** The JSON kept between reloads: { v: 1, conversations: { key: messages[] }, drafts: { key: text } }, bounded. */
export function persistedConversations(conversations, drafts) {
  const keys = Object.keys(conversations || {}).filter((k) => Array.isArray(conversations[k]) && conversations[k].length)
    .sort((a, b) => lastAt(conversations[b]) - lastAt(conversations[a])).slice(0, PERSIST_MAX_CONVERSATIONS);
  const out = {};
  for (const k of keys) { const list = conversations[k].map(keptMessage).filter(Boolean).slice(-CONVERSATION_MAX); if (list.length) out[k] = list; }
  const keptDrafts = {};
  for (const [k, v] of Object.entries(drafts || {})) if (typeof v === "string" && v.length) keptDrafts[k] = v.slice(0, PERSIST_TEXT_MAX);
  return { v: 1, conversations: out, drafts: keptDrafts };
}

/** The conversations and unsent texts read back after a reload; anything unreadable is dropped (an empty start, never an error). */
export function restoredConversations(raw) {
  let data = null;
  try { data = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { data = null; }
  if (!data || data.v !== 1) return { legaConversations: {}, legaDrafts: {} };
  const legaConversations = {};
  for (const [k, list] of Object.entries(data.conversations || {}).slice(0, PERSIST_MAX_CONVERSATIONS)) {
    const kept = Array.isArray(list) ? list.map(keptMessage).filter(Boolean).slice(-CONVERSATION_MAX) : [];
    if (kept.length) legaConversations[k] = kept;
  }
  const legaDrafts = {};
  for (const [k, v] of Object.entries(data.drafts || {})) if (typeof v === "string" && v.length) legaDrafts[k] = v.slice(0, PERSIST_TEXT_MAX);
  return { legaConversations, legaDrafts };
}
