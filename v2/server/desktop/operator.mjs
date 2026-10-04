// M10 Desktop Operator service — the ONE gate between the Hub and the owner's desktop.
// Every operation: classify its effect (policy/action-policy.mjs) → check the context's authority (a direct local command in the
// owner's authenticated session, or a step of ONE confirmed operation plan, re-authorized at dispatch) → take the exclusive desktop
// session (one controller) → record the action (target, pre/post summaries, never document contents) → call the helper with a
// short-lived authority (plan, step, the app's process names, expiry) → read the result back. Real input from the owner, a lost
// focus, a secure desktop or Stop suspend the session; nothing is retried blindly after an intervention.
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { HubError } from "../core/errors.mjs";
import { newId } from "../core/ids.mjs";
import { json, parse } from "../storage/db.mjs";
import { classifyAction, insideAny, isSecretPath } from "../policy/action-policy.mjs";
import { createOperatorClient } from "./operator-client.mjs";
import { createAppRegistry } from "./apps.mjs";

/** Helper errors that mean "the owner (or the system) intervened": the session pauses and waits for the owner. */
const SUSPEND_CODES = new Set(["USER_INPUT", "SECURE_DESKTOP", "PAUSED", "STOPPED", "NOT_FOREGROUND", "IDENTITY_CHANGED", "OCCLUDED"]);
const DIRECT_CHANNELS = new Set(["owner", "test"]);

export function createDesktopOperator({ db, bus, clock, config, supervisor, settings, trust = null, media = null, live = null }) {
  const now = () => clock().toISOString();
  const apps = createAppRegistry({ db, bus, clock, config });
  const client = createOperatorClient({ config, supervisor, clock, onEvent: (e) => live?.publish?.({ type: e.type, data: e }) });
  let current = null; // { session, plan, step, op, app, startedAt } — what the operator is doing right now (shown permanently)

  // ---------------------------------------------------------------- folders
  const home = os.homedir();
  function forbiddenFolders() {
    return [config.hubRoot, config.dataDir, config.backupDir, config.preUpgradeDir, config.mediaDir, path.join(home, ".codex"), path.join(home, ".claude"), path.join(home, ".ssh"),
      path.join(home, "AppData", "Roaming", "Microsoft", "Credentials"), path.join(home, "AppData", "Local", "Microsoft", "Credentials"), process.env.WINDIR || "C:\\Windows"].filter(Boolean);
  }
  /** Folders the operator may show / save into without a new decision: the media import roots and the exports folder. */
  function allowedFolders(extra = []) {
    let roots = [];
    try { roots = media?.importRoots?.() || []; } catch { roots = []; }
    return [...roots, exportsDir(), ...extra].filter(Boolean);
  }
  function exportsDir() {
    if (typeof media?.exportsDir === "function") return media.exportsDir();
    const configured = settings.get("mediaPolicy")?.exportsDir;
    if (configured) return path.resolve(configured);
    let roots = [];
    try { roots = media?.importRoots?.() || []; } catch { roots = []; }
    return roots[0] ? path.join(roots[0], "Ifrim Studio", "Exporturi") : null;
  }
  /** The real path (links and junctions resolved; for a file that does not exist yet, its parent's real path). */
  function realPath(p) {
    if (!p || !path.isAbsolute(p) || p.includes("\0")) throw new HubError("validation", "Cale invalidă (trebuie să fie absolută).");
    if (/^\\\\/.test(p)) throw new HubError("policy", "Căile de rețea (UNC) nu sunt permise operatorului.");
    try { return fs.realpathSync.native(p); }
    catch { const parent = path.dirname(p); return path.join(fs.existsSync(parent) ? fs.realpathSync.native(parent) : parent, path.basename(p)); }
  }

  // ---------------------------------------------------------------- session (exclusive)
  const sessionRow = () => db.prepare("SELECT * FROM desktop_sessions WHERE status IN ('ACTIVE','PAUSED') LIMIT 1").get();
  const toSession = (r) => (r ? { id: r.id, status: r.status, planId: r.plan_id, controller: r.controller, appId: r.app_id, window: parse(r.window_json, {}), startedAt: r.started_at, endReason: r.end_reason } : null);
  function ensureSession({ planId = null, controller, appId = null }) {
    const s = toSession(sessionRow());
    if (s) {
      if (s.status === "PAUSED") throw new HubError("conflict", `Operatorul e pe pauză (${s.endReason || "oprit"}); spune „Continuă” după ce verifici starea, sau „Oprește tot”.`, { code: "DESKTOP_PAUSED", data: { sessionId: s.id } });
      if (planId && s.planId && s.planId !== planId) throw new HubError("conflict", "Un singur controller al desktopului: alt plan lucrează acum în aplicații.", { code: "DESKTOP_BUSY", data: { sessionId: s.id, planId: s.planId } });
      return s;
    }
    const id = newId("dss");
    bus.transaction(() => {
      db.prepare("INSERT INTO desktop_sessions (id, status, plan_id, controller, app_id, started_at, updated_at) VALUES (?, 'ACTIVE', ?, ?, ?, ?, ?)").run(id, planId, controller, appId, now(), now());
      bus.append({ type: "desktop.session.started", scopeType: "desktop", scopeId: id, source: controller, payload: { planId, appId } });
    });
    return toSession(db.prepare("SELECT * FROM desktop_sessions WHERE id = ?").get(id));
  }
  function setSession(status, reason, actor = "owner") {
    const s = toSession(sessionRow());
    if (!s) return null;
    bus.transaction(() => {
      db.prepare(`UPDATE desktop_sessions SET status = ?, end_reason = ?, updated_at = ?${status === "ENDED" || status === "TAKEN_OVER" ? ", ended_at = ?" : ""} WHERE id = ?`)
        .run(...[status, String(reason).slice(0, 300), now(), ...(status === "ENDED" || status === "TAKEN_OVER" ? [now()] : []), s.id]);
      bus.append({ type: `desktop.session.${status.toLowerCase()}`, scopeType: "desktop", scopeId: s.id, source: actor, payload: { reason: String(reason).slice(0, 200), planId: s.planId } });
    });
    return toSession(db.prepare("SELECT * FROM desktop_sessions WHERE id = ?").get(s.id));
  }
  const endSession = (reason = "terminat", actor = "hub") => setSession("ENDED", reason, actor);

  // ---------------------------------------------------------------- the gate
  /**
   * Performs ONE helper operation under a context. ctx: { kind: "direct", channel, actor, sessionId } | { kind: "plan", planId, stepId,
   * authorize(action) → authority, actor }. `action`: { op (policy op), helperOp, appId, args, path, destination, overwrite, controlName }.
   */
  async function perform(ctx, action) {
    const app = action.appId ? apps.get(action.appId) : null;
    const extraFolders = ctx.kind === "plan" ? (ctx.folders || []) : [];
    const pathReal = action.path ? realPath(action.path) : null;
    const destReal = action.destination ? realPath(action.destination) : null;
    const verdict = classifyAction(action.op, { app, path: pathReal, destination: destReal, overwrite: Boolean(action.overwrite), controlName: action.controlName,
      allowedFolders: (pathReal || destReal) ? allowedFolders(extraFolders) : undefined, forbiddenFolders: forbiddenFolders(), liveCapture: settings.get("mediaPolicy")?.liveCapture === true });
    let authority = null;
    const refuse = (why, code = "DESKTOP_REFUSED") => {
      record({ ctx, action, app, cls: verdict.class, status: "REFUSED", error: why });
      throw new HubError("policy", why, { code, data: { class: verdict.class, reasons: verdict.reasons } });
    };
    if (verdict.class === "REFUSED") refuse(`Refuzat: ${verdict.reasons.join("; ")}`);
    if (verdict.class === "SENSITIVE") refuse(`E nevoie de decizia ta: ${verdict.reasons.join("; ")}`, "NEEDS_DECISION");
    if (verdict.class === "LOCAL_DIRECT") {
      if (ctx.kind === "direct") {
        if (!DIRECT_CHANNELS.has(ctx.channel)) refuse("Comenzile directe pe desktop vin din sesiunea ta autentificată (cockpit, voce locală sau text), nu din alt canal.", "NEEDS_SESSION");
        if (ctx.channel === "owner") trust?.requireSession?.({ id: ctx.sessionId }, "comenzile pe desktop");
      }
    } else if (verdict.class === "PLAN_STEP") {
      if (ctx.kind !== "plan") refuse("Pasul acesta (tastare, click, salvare, captură) rulează doar într-un plan confirmat; îți arăt planul.", "NEEDS_PLAN");
    }
    if (ctx.kind === "plan") authority = ctx.authorize({ op: action.op, appId: action.appId, path: pathReal, destination: destReal }); // throws when outside the plan
    const session = ensureSession({ planId: ctx.planId || null, controller: ctx.actor || "owner", appId: action.appId || null });
    if (!client.running()) await client.start({ session: session.id });
    const exp = authority?.expiresAt || new Date(clock().getTime() + 120000).toISOString();
    const auth = { plan: ctx.planId || "direct", step: ctx.stepId || action.op, apps: app ? app.processNames : (action.processNames || []), exp };
    current = { sessionId: session.id, planId: ctx.planId || null, stepId: ctx.stepId || null, op: action.op, helperOp: action.helperOp, app: app ? { id: app.id, name: app.displayName } : null, startedAt: now() };
    live?.publish?.({ type: "desktop.activity", data: current });
    const started = now();
    try {
      const result = await client.request(action.helperOp, action.args || {}, auth);
      record({ ctx, action, app, cls: verdict.class, status: "DONE", result: summarize(action.helperOp, result), started });
      return result;
    } catch (error) {
      const code = error.code || "FAILED";
      const suspended = SUSPEND_CODES.has(code);
      record({ ctx, action, app, cls: verdict.class, status: suspended ? "SUSPENDED" : code === "OPERATOR_TIMEOUT" || code === "OPERATOR_EXITED" ? "UNCERTAIN" : "FAILED", error: error.message, started });
      if (suspended && code !== "PAUSED") setSession("PAUSED", reasonFor(code, error.message), "desktop");
      throw error;
    } finally {
      current = null;
      live?.publish?.({ type: "desktop.activity", data: null });
    }
  }
  const reasonFor = (code, msg) => ({ USER_INPUT: "ai intervenit (tastatură/mouse)", SECURE_DESKTOP: "ecran blocat sau dialog securizat", NOT_FOREGROUND: "fereastra țintă a pierdut focusul",
    IDENTITY_CHANGED: "fereastra s-a schimbat (alt proces)", OCCLUDED: "o altă fereastră acoperea ținta", STOPPED: "oprit" }[code] || String(msg).slice(0, 120));

  function summarize(op, r) {
    if (!r || typeof r !== "object") return {};
    if (op === "observe") return { nodes: r.nodes?.length || 0, truncated: Boolean(r.truncated), foreground: Boolean(r.foreground), window: r.window ? { title: String(r.window.title || "").slice(0, 80), processName: r.window.processName } : null };
    if (op === "getText") return { chars: String(r.text || "").length, source: r.source };
    if (op === "typeText") return { typed: r.typed };
    if (op === "listWindows" || op === "explorerWindows") return { windows: (r.windows || []).length };
    if (r.window) return { window: { hwnd: r.window.hwnd, processName: r.window.processName, title: String(r.window.title || "").slice(0, 80) }, foreground: r.foreground ?? undefined };
    return Object.fromEntries(Object.entries(r).filter(([k, v]) => ["pid", "how", "combo", "saved", "cancelled", "confirmOpened", "x", "y"].includes(k) && typeof v !== "object"));
  }
  function record({ ctx, action, app, cls, status, result = {}, error = null, started = null }) {
    const s = toSession(sessionRow());
    const target = { app: app?.id || null, hwnd: action.args?.hwnd || null, path: action.path ? path.basename(action.path) : null, destination: action.destination ? path.basename(action.destination) : null, control: action.controlName ? String(action.controlName).slice(0, 60) : null };
    bus.transaction(() => {
      db.prepare(`INSERT INTO desktop_actions (id, session_id, plan_id, step_id, op, app_id, action_class, status, target_json, result_json, error, actor, channel, started_at, finished_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(newId("dac"), s?.id || null, ctx.planId || null, ctx.stepId || null, `${action.op}:${action.helperOp || ""}`, app?.id || null, cls, status,
        json(target), json(result), error ? String(error).slice(0, 500) : null, String(ctx.actor || "owner").slice(0, 80), ctx.kind === "plan" ? "plan" : String(ctx.channel || ""), started || now(), now());
      if (status !== "DONE") bus.append({ type: `desktop.action.${status.toLowerCase()}`, scopeType: "desktop", scopeId: s?.id || "none", source: String(ctx.actor || "owner"), payload: { op: action.op, app: app?.id || null, error: error ? String(error).slice(0, 200) : null } });
    });
  }

  // ---------------------------------------------------------------- windows of an app
  async function windowsOf(ctx, app) {
    const r = await perform(ctx, { op: "app.focus", helperOp: "listWindows", appId: app.id, args: { processNames: app.processNames } });
    return (r.windows || []).filter((w) => w.visible);
  }
  const identity = (w) => ({ hwnd: w.hwnd, pid: w.pid, procStart: w.procStart });

  // ---------------------------------------------------------------- direct commands (LOCAL_DIRECT)
  function directCtx({ channel, actor, sessionId }) { return { kind: "direct", channel, actor, sessionId }; }
  function needApp(ref) {
    const cat = apps.find(ref);
    if (!cat) throw new HubError("not_found", `Nu cunosc aplicația „${ref}”. Aplicațiile operatorului: ${apps.catalog.map((a) => a.displayName).join(", ")}.`, { code: "APP_UNKNOWN" });
    return apps.get(cat.id);
  }
  /** „Deschide CapCut”: launch (or reuse) → wait for its window → bring it forward → verify it is the foreground window. */
  async function openAppImpl({ app: ref, channel, actor, sessionId }) {
    const app = needApp(ref);
    const ctx = directCtx({ channel, actor, sessionId });
    const before = await windowsOf(ctx, app).catch((error) => { throw error; });
    let launched = null;
    if (!before.length) {
      const spec = app.launch.kind === "aumid" ? { kind: "aumid", aumid: app.launch.aumid } : { kind: app.launch.kind, exe: app.launch.exe || app.exePath };
      launched = await perform(ctx, { op: "app.launch", helperOp: "launch", appId: app.id, args: spec });
    }
    const win = launched ? (await perform(ctx, { op: "app.focus", helperOp: "waitWindow", appId: app.id, args: { processNames: app.processNames, timeoutMs: 20000, excludeHwnds: before.map((w) => w.hwnd) } })).window
      : before.at(-1);
    const focused = await perform(ctx, { op: "app.focus", helperOp: "focus", appId: app.id, args: { hwnd: win.hwnd } });
    endSession(`${app.displayName} deschisă`);
    return { app: { id: app.id, name: app.displayName, version: app.version }, launched: Boolean(launched), window: { ...identity(win), title: String(win.title || "").slice(0, 80) },
      verified: Boolean(focused.foreground), note: focused.foreground ? `${app.displayName} e în prim-plan.` : `${app.displayName} e deschisă, dar Windows nu a adus-o în prim-plan (altă aplicație ține focusul).` };
  }
  async function focusAppImpl({ app: ref, channel, actor, sessionId }) {
    const app = needApp(ref);
    const ctx = directCtx({ channel, actor, sessionId });
    const list = await windowsOf(ctx, app);
    if (!list.length) { endSession("nicio fereastră"); return { app: { id: app.id, name: app.displayName }, verified: false, note: `${app.displayName} nu are nicio fereastră deschisă; spune „Deschide ${app.displayName}”.` }; }
    const win = list.at(-1);
    const focused = await perform(ctx, { op: "app.focus", helperOp: "focus", appId: app.id, args: { hwnd: win.hwnd } });
    endSession(`${app.displayName} în față`);
    return { app: { id: app.id, name: app.displayName }, window: { ...identity(win), title: String(win.title || "").slice(0, 80) }, verified: Boolean(focused.foreground) };
  }
  /** „Arată folderul exporturilor”: only an allowed folder (import roots, exports) — never a protected one; verified by Explorer's own location. */
  async function showFolderImpl({ folder = null, channel, actor, sessionId }) {
    const target = folder || exportsDir();
    if (!target) throw new HubError("validation", "Nu am un folder de exporturi configurat.");
    const app = apps.get("explorer");
    const ctx = directCtx({ channel, actor, sessionId });
    const real = realPath(target);
    if (isSecretPath(real) || insideAny(forbiddenFolders(), real)) throw new HubError("policy", "Folderul e protejat (datele Hub-ului, repo, credențiale); nu îl deschid.", { code: "DESKTOP_REFUSED" });
    if (!insideAny(allowedFolders(), real)) throw new HubError("policy", `Folderul nu e printre cele aprobate (${allowedFolders().join(", ")}); îl adaugi întâi ca folder de import.`, { code: "NEEDS_DECISION" });
    fs.mkdirSync(real, { recursive: true });
    await perform(ctx, { op: "folder.show", helperOp: "launch", appId: "explorer", path: real, args: { kind: "explorer", exe: app.launch.exe || app.exePath || path.join(process.env.WINDIR || "C:\\Windows", "explorer.exe"), args: [real] } });
    let shown = null;
    for (let i = 0; i < 20 && !shown; i += 1) {
      const list = (await perform(ctx, { op: "folder.show", helperOp: "explorerWindows", appId: "explorer", path: real, args: {} })).windows || [];
      shown = list.find((w) => w.path && path.resolve(w.path).toLowerCase() === real.toLowerCase()) || null;
      if (!shown) await new Promise((r) => setTimeout(r, 250));
    }
    if (shown) await perform(ctx, { op: "app.focus", helperOp: "focus", appId: "explorer", args: { hwnd: shown.hwnd } }).catch(() => null);
    endSession("folder afișat");
    return { folder: real, verified: Boolean(shown), window: shown ? { hwnd: shown.hwnd } : null };
  }
  /** The folder of the Explorer window in front (for „importă din folderul acesta”): read through Explorer's own location, no file read. */
  async function currentFolderImpl({ channel, actor, sessionId }) {
    const ctx = directCtx({ channel, actor, sessionId });
    const list = (await perform(ctx, { op: "folder.show", helperOp: "explorerWindows", appId: "explorer", args: {} })).windows || [];
    endSession("folder citit");
    const withPath = list.filter((w) => w.path);
    return { folder: withPath.at(-1)?.path || null, windows: withPath.length };
  }

  /** A direct command's desktop session ends with it (success or failure) unless an intervention paused it. */
  async function direct(label, fn) {
    try { return await fn(); }
    finally { const s = toSession(sessionRow()); if (s && s.status === "ACTIVE" && !s.planId) endSession(label); }
  }
  const openApp = (a) => direct("deschidere aplicație", () => openAppImpl(a));
  const focusApp = (a) => direct("aplicație în față", () => focusAppImpl(a));
  const showFolder = (a) => direct("folder afișat", () => showFolderImpl(a));
  const currentFolder = (a) => direct("folder citit", () => currentFolderImpl(a));

  // ---------------------------------------------------------------- stop / takeover / resume
  async function stop({ actor = "owner", reason = "Stop" } = {}) {
    if (!client.running() && !sessionRow()) return { stopped: true, session: null, helperPaused: false, idle: true, note: "Operatorul nu lucra în nicio aplicație." };
    let helper = null;
    if (client.running()) { try { helper = await client.stopInput(); } catch (error) { helper = { error: error.message }; } }
    const s = setSession("PAUSED", reason, actor);
    bus.transaction(() => bus.append({ type: "desktop.stopped", scopeType: "desktop", scopeId: s?.id || "none", source: actor, payload: { reason: String(reason).slice(0, 200), helperPaused: Boolean(helper?.paused) } }));
    return { stopped: true, session: s, helperPaused: Boolean(helper?.paused), note: "Inputul s-a oprit, tastele ținute au fost eliberate. Aplicațiile rămân deschise; nimic nu a fost închis forțat." };
  }
  async function takeover({ actor = "owner" } = {}) {
    if (client.running()) { try { await client.stopInput(); } catch { /* reported by status */ } }
    const s = setSession("TAKEN_OVER", "Preiau eu", actor);
    return { takenOver: true, session: s, note: "Controlul e al tău. Când spui „Continuă”, verific din nou fereastra și documentul înainte de orice pas." };
  }
  /** Resume after Stop / Preiau eu / an intervention: the helper is un-paused only after the caller verified the state again. */
  async function resume({ actor = "owner" } = {}) {
    if (client.running()) await client.request("resume", {});
    const s = toSession(sessionRow());
    if (s && s.status === "PAUSED") bus.transaction(() => db.prepare("UPDATE desktop_sessions SET status = 'ACTIVE', end_reason = NULL, updated_at = ? WHERE id = ?").run(now(), s.id));
    return { resumed: true, session: toSession(db.prepare("SELECT * FROM desktop_sessions WHERE id = ?").get(s?.id || "")) };
  }
  function status() {
    const s = toSession(sessionRow());
    return { helper: client.status(), session: s, current, apps: apps.list().map((a) => ({ id: a.id, name: a.displayName, status: a.status, version: a.version, capabilities: a.capabilities })),
      exportsDir: exportsDir(), allowedFolders: allowedFolders() };
  }
  const recentActions = (limit = 30) => db.prepare("SELECT * FROM desktop_actions ORDER BY started_at DESC LIMIT ?").all(Math.min(200, limit))
    .map((r) => ({ id: r.id, op: r.op, app: r.app_id, class: r.action_class, status: r.status, target: parse(r.target_json, {}), result: parse(r.result_json, {}), error: r.error, planId: r.plan_id, at: r.started_at }));
  async function discover(actor = "hub") { if (!client.running()) await client.start({}); return apps.discover(client, { actor }); }
  async function close() { await client.close(); }
  /** Boot: a session left ACTIVE/PAUSED by a crash ends (the helper is gone): nothing is resumed. */
  function recover() {
    const s = toSession(sessionRow());
    if (s) endSession("Hub repornit: sesiunea desktop s-a încheiat fără reluare", "hub");
    return { endedSession: s ? s.id : null };
  }

  return { perform, openApp, focusApp, showFolder, currentFolder, stop, takeover, resume, status, recentActions, discover, close, recover, apps, client, identity,
    windowsOf, endSession, ensureSession, allowedFolders, forbiddenFolders, exportsDir, realPath, sessionStatus: () => toSession(sessionRow()) };
}
