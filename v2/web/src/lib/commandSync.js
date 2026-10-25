import { VIEWS } from "./commandModel.js";
export const CHANNEL = "ifrim-hub-command-v1";
export function sanitizeState(s) {
  if (!s || typeof s !== "object") return {};
  const out = {};
  if (Object.hasOwn(s, "from") && (s.from === null || VIEWS.includes(s.from))) out.from = s.from;
  if (Object.hasOwn(s, "view") && VIEWS.includes(s.view)) out.view = s.view;
  if (Object.hasOwn(s, "recap") && /^rcp_[A-Za-z0-9_-]{1,80}$/.test(s.recap?.snapshotId || "") && Number.isInteger(s.recap.index) && s.recap.index >= 0 && s.recap.index <= 5 && typeof s.recap.stopped === "boolean") out.recap = { snapshotId: s.recap.snapshotId, index: s.recap.index, stopped: s.recap.stopped };
  for (const [k, re] of Object.entries({ departmentKey: /^[a-z-]{1,40}$/, sheetId: /^(flow|skill):[a-z0-9-]{1,40}$/, missionId: /^[A-Za-z0-9_-]{1,80}$/, deliveryId: /^[A-Za-z0-9_-]{1,80}$/ })) if (Object.hasOwn(s, k) && typeof s[k] === "string" && re.test(s[k])) out[k] = s[k];
  for (const k of ["hideNumbers", "decor"]) if (Object.hasOwn(s, k) && typeof s[k] === "boolean") out[k] = s[k];
  if (Object.hasOwn(s,"resultShotIndex") && Number.isInteger(s.resultShotIndex) && s.resultShotIndex>=0 && s.resultShotIndex<=10000) out.resultShotIndex=s.resultShotIndex;
  if (Object.hasOwn(s,"coolingDays") && Number.isInteger(s.coolingDays) && s.coolingDays>=1 && s.coolingDays<=365) out.coolingDays=s.coolingDays;
  return out;
}
export function acceptMessage(local, msg) {
  const no = (reason) => ({ accept: false, reason, next: local });
  if (!msg || msg.v !== 1 || !["state", "hello", "bye"].includes(msg.kind) || !["main", "tv"].includes(msg.role) || typeof msg.from !== "string" || !Number.isSafeInteger(msg.rev) || msg.rev < 0) return no("invalid");
  if (msg.from === local.from) return no("own");
  if (local.role === "tv" && msg.kind !== "hello" && msg.role !== "main") return no("non_main");
  if (msg.rev <= (local.lastRev?.[msg.from] ?? -1)) return no("stale");
  const at = typeof msg.at === "number" ? msg.at : Date.parse(msg.at), now = local.now ?? Date.now();
  if (!Number.isFinite(at) || now - at > 300000 || at - now > 300000) return no("old");
  if (local.bootId && msg.bootId !== local.bootId) return no("other_boot");
  const next = { ...local, lastRev: { ...local.lastRev, [msg.from]: msg.rev } };
  if (msg.role === "main" && msg.kind === "state" && at >= (local.leaderAt ?? -Infinity)) Object.assign(next, { leader: msg.from, leaderAt: at, mainClosed: false, state: sanitizeState(msg.state) });
  if (msg.kind === "bye" && msg.from === local.leader) next.mainClosed = true;
  return { accept: true, reason: null, next };
}
export function openCommandChannel({ role, onState, onPeer }) {
  const from = globalThis.crypto?.randomUUID?.() || `w_${Math.random().toString(36).slice(2)}`;
  let local = { from, role, lastRev: {}, bootId: null }, rev = 0, state = {};
  let bc = null;
  try { if (typeof globalThis.BroadcastChannel === "function") bc = new globalThis.BroadcastChannel(CHANNEL); } catch { /* independent Hub reads remain available */ }
  const post = (kind) => bc?.postMessage({ v: 1, kind, from, role, rev: ++rev, at: Date.now(), bootId: local.bootId, ...(kind === "state" ? { state } : {}) });
  if (bc) bc.onmessage = ({ data }) => {
    const result = acceptMessage(local, data);
    if (!result.accept) { if (result.reason === "other_boot") onPeer?.({ otherBoot: true }); return; }
    local = result.next;
    if (data.kind === "hello" && role === "main") post("state");
    if (data.kind === "state" && data.from === local.leader && role === "tv") onState?.(local.state);
    onPeer?.({ mainClosed: Boolean(local.mainClosed) });
  };
  const hide = () => { if (role === "main") post("bye"); };
  const show = () => post(role === "main" ? "state" : "hello");
  globalThis.addEventListener?.("pagehide", hide);
  globalThis.addEventListener?.("pageshow", show);
  if (role === "tv") post("hello");
  return { publish(s) { state = sanitizeState(s); if (role === "main") post("state"); }, hello() { post("hello"); }, setBootId(bootId) { local = { ...local, bootId }; }, close() { hide(); bc?.close(); globalThis.removeEventListener?.("pagehide", hide); globalThis.removeEventListener?.("pageshow", show); } };
}
