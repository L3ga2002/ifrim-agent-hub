import { useEffect, useRef } from "react";
import { api, serverInfo, onServerInfo } from "../api.js";
import { useHub, getState, setState, onLive, onHubEvent } from "../store.js";
import { openCommandChannel, sanitizeState } from "../lib/commandSync.js";
import { carousel } from "../lib/companyGraph.js";
import { recapStep, visibleRecapContext, recapPlayback, recapExit, commandTransition, intentSheetPatch, playbackSampling, relevantCommandEvent } from "../lib/commandModel.js";
import { legaLevels } from "../lib/legaLevels.js";

export function cacheRecap(snapshot) {
  if (!snapshot?.id) return;
  setState((s) => ({ recapSnapshots: Object.fromEntries([...Object.entries(s.recapSnapshots || {}).filter(([id]) => id !== snapshot.id), [snapshot.id, snapshot]].slice(-10)) }));
}
export function setCommand(patch) { setState((s) => {
  const command = commandTransition(s.command, patch), playback = recapPlayback(s.recapPlayback, { type: "select", recap: command.recap });
  const key = playback.key;
  return { command, recapPlayback: playback, ...(key && playback !== s.recapPlayback ? { recapVoice: { ...s.recapVoice, [key]: {} } } : {}) };
}); }
export function recapContext() { return visibleRecapContext(getState().command, location.hash); }
export function stopLocalRecap(leaving = getState().command?.recap) {
  const r = recapExit(getState().command, leaving);
  if (!r) return;
  setCommand({ recap: r });
  void presentRecap(r, "stop");
}
export function useRecapVisibility(surface, visible) {
  const generation = useRef(0);
  useEffect(() => {
    if (!visible) return;
    const instance = ++generation.current;
    setCommand({ recapShownOn: surface });
    return () => {
      const leaving = getState().command?.recap;
      // React development effect replay remounts the same surface immediately.
      queueMicrotask(() => {
        if (generation.current !== instance) return;
        if (getState().command?.recapShownOn === surface) setCommand({ recapShownOn: null });
        stopLocalRecap(leaving);
      });
    };
  }, [surface, visible]);
}
export async function presentRecap(recap, action = "show") {
  const s = getState();
  if (location.hash.includes("ecran=tv")) return;
  setState({ recapPlayback: recapPlayback(s.recapPlayback, { type: action === "stop" ? "stop" : "reset", recap }) });
  if (!recap || s.legaStatus !== "active") return;
  const key = `${recap.snapshotId}:${recap.index}`;
  setState((s) => ({ recapVoice: { ...s.recapVoice, [key]: {} } }));
  try {
    const r = await api(`/api/recap/${encodeURIComponent(recap.snapshotId)}/present`, { method: "POST", body: { index: recap.index, legaSessionId: s.legaSessionId, action } });
    setState((s) => ({ recapVoice: { ...s.recapVoice, [key]: { ...s.recapVoice?.[key], ...r.voice } } }));
  } catch { setState((s) => ({ recapVoice: { ...s.recapVoice, [key]: { reason: "provider_refused" } } })); }
}
export async function controlRecap(action, go) {
  const s = getState(), recap = s.command?.recap;
  if (!recap) return;
  if (action === "open") {
    const open = s.recapSnapshots?.[recap.snapshotId]?.chapters?.[recap.index]?.open;
    if (location.hash.startsWith("#/comanda") && open?.view) setCommand({ view: open.view });
    else if (open?.path) go(open.path);
    return;
  }
  const next = recapStep(recap, action);
  setCommand({ recap: next, ...(next.stopped ? { view: "idle" } : {}) });
  await presentRecap(next, next.stopped ? "stop" : "show");
}
export async function applyCommandResult(r, { go, typed = true } = {}) {
  setCommand(intentSheetPatch(r, Date.now()));
  if (r.recap?.snapshot) { cacheRecap(r.recap.snapshot); const recap = { snapshotId: r.recap.snapshot.id, index: 0, stopped: false }; setCommand({ view: "recap", recap }); if (typed) await presentRecap(recap); }
  if (r.recapControl) {
    const c = r.recapControl, recap = { snapshotId: c.snapshotId, index: c.index, stopped: Boolean(c.stopped) };
    setCommand({ recap, ...(c.stopped ? { view: "idle" } : {}) });
    if (c.action === "open") { if (location.hash.startsWith("#/comanda") && c.open?.view) setCommand({ view: c.open.view }); else if (c.open?.path) go?.(c.open.path); }
    if (typed && c.action !== "open") await presentRecap(recap, c.stopped ? "stop" : "show");
  }
  if (r.commandView) {
    const c = r.commandView, prev = getState().command || {};
    let departmentKey = c.departmentKey;
    if (c.relative) { const graph = await api("/api/company/graph"); departmentKey = carousel(graph.departments, departmentKey || prev.departmentKey, c.relative); }
    setCommand({ ...sanitizeState(c), ...(departmentKey ? { departmentKey } : {}), ...(c.view === "sheet" ? { from: prev.view || null } : {}) });
    if (typeof c.hideNumbers === "boolean") { try { localStorage.setItem("hub.v2.command.hideNumbers", JSON.stringify(c.hideNumbers)); } catch { /* optional persistence */ } }
  }
  if (r.processSheet) setCommand({ view: "sheet", sheetId: r.processSheet.id, from: r.commandView ? getState().command.from : getState().command?.view || null, sheetShownAt: Date.now() });
  if (r.recapStopped && getState().command?.recap) { const recap = { ...getState().command.recap, stopped: true }; setCommand({ recap }); if (typed) await presentRecap(recap, "stop"); }
  if (r.navigate?.startsWith("/comanda")) go?.(r.navigate);
}

export default function CommandBridge({ go }) {
  const command = useHub((s) => s.command), channel = useRef(null);
  useEffect(() => {
    const ch = openCommandChannel({ role: "main" }); channel.current = ch;
    const preferences = {};
    for (const [key, fallback] of [["hideNumbers", false], ["variant", "A"], ["decor", true]]) { try { preferences[key] = JSON.parse(localStorage.getItem(`hub.v2.command.${key}`) ?? JSON.stringify(fallback)); } catch { preferences[key] = fallback; } }
    setCommand({ view: "idle", ...preferences, ...getState().command });
    ch.setBootId(serverInfo()?.bootId); ch.publish(getState().command || { view: "idle" });
    let boot = serverInfo()?.bootId;
    const offInfo = onServerInfo((info) => {
      if (boot && info.bootId !== boot) setState({ commandLastHubSeq: 0, recapSnapshots: {}, recapVoice: {} });
      boot = info.bootId; ch.setBootId(info.bootId); ch.publish(getState().command || { view: "idle" });
    });
    const offEvents = onHubEvent((e) => { if (relevantCommandEvent(e)) setState((s) => ({ commandLastHubSeq: Math.max(s.commandLastHubSeq || 0, e.seq || 0) })); });
    const offLive = onLive(async (e) => {
      if (!e.sessionId || e.sessionId !== getState().legaSessionId) return;
      if (e.type === "lega.command_view") {
        await applyCommandResult({ commandView: e }, { go, typed: false });
        if (["department", "company", "sheet"].includes(e.view) && !location.hash.startsWith("#/comanda")) go("/comanda");
      }
      if (!["lega.recap", "lega.recap_heard"].includes(e.type)) return;
      if (e.type === "lega.recap") {
        if (!getState().recapSnapshots?.[e.snapshotId] && e.action !== "stop") { try { const snap = await api(`/api/recap/${encodeURIComponent(e.snapshotId)}`); if (e.sessionId !== getState().legaSessionId) return; cacheRecap(snap); } catch { return; } }
        const current = getState().command?.recap;
        // A late provider event must not reopen a recap that the owner already left.
        if (e.action === "show" && current?.snapshotId === e.snapshotId && current.stopped) return;
        setCommand({ recap: { snapshotId: e.snapshotId, index: e.index, stopped: e.action === "stop" }, ...(e.action === "show" ? { view: "recap" } : {}) });
        setState((s) => ({ recapPlayback: recapPlayback(s.recapPlayback, { type: e.action === "stop" ? "stop" : "handoff", key: `${e.snapshotId}:${e.index}`, handedOff: e.handedOff }) }));
      }
      const key = `${e.snapshotId}:${e.index}`;
      setState((s) => {
        const old = s.recapVoice?.[key] || {};
        const retain = e.type === "lega.recap_heard" || Date.parse(old.heardAt) >= Date.parse(e.at) ? old : {};
        return { recapVoice: { ...s.recapVoice, [key]: { ...retain, ...(e.type === "lega.recap_heard" ? { heard: { match: e.match }, heardAt: e.at } : { handedOff: e.handedOff, reason: e.handedOff ? null : "provider_refused", presentedAt: e.at }) } } };
      });
    });
    return () => { offInfo(); offEvents(); offLive(); ch.close(); channel.current = null; };
  }, [go]);
  const playback = useHub(s => s.recapPlayback);
  useEffect(() => {
    let timer;
    const sync = () => { clearInterval(timer); if (!playbackSampling(playback, document.hidden)) return;
      timer = setInterval(() => {
        const s = getState(), next = recapPlayback(s.recapPlayback, { type: "level", active: s.legaStatus === "active" && Boolean(recapContext()), level: legaLevels.lega });
        if (next !== s.recapPlayback) setState({ recapPlayback: next, recapVoice: { ...s.recapVoice, [next.key]: { ...s.recapVoice?.[next.key], playback: true } } });
      }, 100);
    };
    sync(); document.addEventListener("visibilitychange", sync);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", sync); };
  }, [playback]);
  useEffect(() => { channel.current?.publish(command || { view: "idle" }); }, [command]);
  return null;
}
