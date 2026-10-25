import { bucharestParts } from "./roText.js";
import { hasChord } from "./uiLogic.js";
export const VIEWS = Object.freeze(["idle", "recap", "company", "department", "sheet", "funnel", "trace", "result", "system"]);
export const VIEW_LABELS = Object.freeze({ idle: "Repaus", recap: "Rezumat", company: "Companie", department: "Departament", sheet: "Fișă de proces", funnel: "Vânzări", trace: "Traseul lucrării", result: "Rezultat", system: "Sistem" });
export const VIEW_OF_QUERY = Object.freeze({ repaus: "idle", rezumat: "recap", companie: "company", departament: "department", fisa: "sheet", palnie: "funnel", traseu: "trace", rezultat: "result", sistem: "system" });
export function visibleRecapContext(command, hash = "") {
  const r = command?.recap, route = hash.split("?")[0];
  const visible = route === "#/comanda" ? command?.view === "recap" && command.recapShownOn === "command" : route === "#/lega" && command?.recapShownOn === "lega";
  return visible && r && !r.stopped ? { snapshotId: r.snapshotId, index: r.index } : undefined;
}
export function recapPlayback(state = {}, event) {
  const key = event.recap && !event.recap.stopped ? `${event.recap.snapshotId}:${event.recap.index}` : null;
  if (event.type === "select") return key === state.key ? state : { key, armed: false, playback: false };
  if (event.type === "reset" || event.type === "stop") return { key: event.type === "stop" ? null : key, armed: false, playback: false };
  if (event.type === "handoff") return event.key === state.key ? { key: state.key, armed: event.handedOff === true, playback: false } : state;
  if (event.type === "level" && state.armed && event.active && event.level > .02) return { ...state, playback: true };
  return state;
}
export function lastSentence(text) { return text ? `Ultima ta frază: „${text}”` : "Ultima ta frază: —"; }
export function recapExit(command, leaving) {
  const r = command?.recap;
  return r && !r.stopped && r.snapshotId === leaving?.snapshotId ? { ...r, stopped: true } : null;
}
export function indicatorText(ind, { hideNumbers = false } = {}) {
  if (!ind) return null;
  const raw = String(ind.display ?? ind.value ?? "necunoscut");
  const hidden = hideNumbers && /\d/.test(`${raw}${ind.value ?? ""}`);
  const text = hidden ? "•••" : raw;
  const source = `${ind.source} · ${ind.applies === "now" ? `acum (${bucharestParts(ind.readAt).time})` : "în perioada aleasă"}`;
  return { label: ind.label, text, srText: hidden ? "cifră ascunsă" : text, tone: ({ unknown: "unknown", unavailable: "error", disabled: "muted" })[ind.state] || "neutral", note: hideNumbers && /\d/.test(ind.note || "") ? "•••" : ind.note, source: hideNumbers ? source.replace(/\d[\d:.,]*/g, "•••") : source };
}
const find = (s, id) => s?.chapters?.flatMap((c) => c.indicators || []).find((i) => i.id === id);
export function idleFigures(s) { return { decisions: find(s, "waiting.decisions"), works: find(s, "work.active"), blockers: find(s, "waiting.blocked") }; }
export function freshness({ snapshot, connection, lastHubSeq = 0, now = Date.now() }) {
  const stamp = snapshot?.readAt || snapshot?.generatedAt;
  const age = Number(now) - Date.parse(stamp);
  const time = bucharestParts(stamp).time;
  const stale = lastHubSeq > (snapshot?.lastSeq ?? Infinity) && age > 15000;
  const live = connection === "live" && age >= 0 && age < 120000 && !stale;
  const label = connection !== "live" ? `Legătura cu Hub-ul s-a pierdut · reîncerc · Ultima citire ${time}` : stale ? `Datele s-au schimbat de la ${time} · Actualizează` : live ? `LIVE · citit la ${time}` : `Ultima citire ${time}`;
  return { live, label, stale };
}
export function recapStep(state, action, chapters = 6) {
  const last = Math.max(0, chapters - 1), index = Math.max(0, Math.min(last, (state?.index || 0) + (action === "next" ? 1 : action === "back" || action === "prev" ? -1 : 0)));
  return { snapshotId: state?.snapshotId, index, stopped: action === "stop" || Boolean(state?.stopped), atEnd: index === last };
}
export function keyAction(event, { view, typing = false, dialogOpen = false } = {}) {
  const t = event?.target;
  if (!event || typing || dialogOpen || hasChord(event) || event.isComposing || event.keyCode === 229 || event.repeat || event.defaultPrevented || /^(INPUT|TEXTAREA|SELECT)$/i.test(t?.tagName || "") || t?.isContentEditable || t?.closest?.('[contenteditable="true"], [role="dialog"]')) return null;
  if (event.key === "ArrowRight") return "next";
  if (event.key === "ArrowLeft") return "prev";
  if (event.key === "Enter" && ["recap", "company", "department"].includes(view)) return "open";
  if (event.key === "Escape") return "exit";
  const v = ["idle", "recap", "company", "funnel", "trace", "result", "system"][Number(event.key) - 1];
  return /^[1-7]$/.test(event.key) ? `view:${v}` : null;
}
export function newDecisionNotice(prev, next) { return Boolean(prev && next && prev.bootId && prev.bootId === next.bootId && typeof find(prev, "waiting.decisions")?.value === "number" && find(next, "waiting.decisions")?.value > find(prev, "waiting.decisions").value); }
export function chapterVoice(voiceState, snapshotId, index) {
  if (voiceState?.off || voiceState?.status === "off") return "Doar pe ecran: vocea e oprită";
  const v = voiceState?.[`${snapshotId}:${index}`] || voiceState || {};
  if (v.heard != null && v.heard !== false) return `Rostit: transcriptul providerului se potrivește ${Math.round((typeof v.heard === "number" ? v.heard : v.heard.match ?? 0) * 100)}%`;
  if (v.playback) return "Redare detectată în pagină";
  if (v.handedOff) return "Predat vocii";
  if (v.reason && v.reason !== "voice_off") return `Vocea nu a preluat capitolul (${v.reason})`;
  return "Doar pe ecran: vocea e oprită";
}

export const relevantCommandEvent = e => /^(approval|sales|factory|delivery|envelope|ops|mission|desk|backup|run|task|system|role|skill|tool|project|schedule|settings)\./.test(e.type || "");
export function commandTransition(previous = {}, patch = {}) {
 const next = { ...previous, ...patch };
 if (patch.view === "sheet") next.from = Object.hasOwn(patch, "from") ? patch.from : previous.view || null;
 if (patch.view && patch.view !== "sheet") { next.sheetId = null; next.from = null; next.sheetShownAt = null; }
 return next;
}
export function sheetReturn(command) {
 const from = command.from;
 return from === "department" && !command.departmentKey ? "company" : VIEWS.includes(from) && from !== "sheet" ? from : "company";
}
export function intentSheetPatch(result, at) {
 const id = result.processSheet?.id || (result.commandView?.view === "sheet" && result.commandView.sheetId);
 return { sheetShownAt: id ? at : null, ...(id ? { sheetId: id } : {}) };
}
export function playbackSampling(playback, hidden) { return Boolean(playback?.armed && !playback.playback && !hidden); }
export function scheduleCommandRead(read, { doc, subscribe, timers = globalThis }) {
 let interval, debounce, stopped = false;
 const run = () => { if (!stopped && !doc.hidden) read(); };
 const visible = () => { timers.clearInterval(interval); timers.clearTimeout(debounce); if (!doc.hidden) { run(); interval = timers.setInterval(run, 60000); } };
 const off = subscribe(e => { if (!relevantCommandEvent(e) || doc.hidden) return; timers.clearTimeout(debounce); debounce = timers.setTimeout(run, 1500); });
 doc.addEventListener("visibilitychange", visible); visible();
 return () => { stopped = true; timers.clearInterval(interval); timers.clearTimeout(debounce); off(); doc.removeEventListener("visibilitychange", visible); };
}
