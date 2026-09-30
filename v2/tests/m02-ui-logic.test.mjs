import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deriveCoreState, CORE_STATE_IDS, CORE_VISUALS } from "../web/src/lib/coreState.js";
import { parseMarkdown, parseInline } from "../web/src/lib/markdown.js";
import { validateAttachment, attachmentMime, ATTACHMENT_MAX_BYTES, ATTACHMENT_TYPES, errorStage, fitLayout, DEFAULT_LAYOUT, missionProgress, classifyCapability, parseLocalCommand,
  acceptEvent, acceptHello, createEventGate, STREAM_UNKNOWN_SEQ, appShortcutKey, isAppShortcut, composerOptions, RUN_EFFORTS, CLAUDE_MODEL_ALIASES,
  ATTACHMENT_NAME_MAX, streamStartSeq, isCommandApproval, approvedNotStarted } from "../web/src/lib/uiLogic.js";
import { openStream } from "../web/src/api.js";
import { CLAUDE_REFUSED_MODELS } from "../server/providers/claude.mjs";

const V2 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = (rel) => fs.readFileSync(path.join(V2, rel), "utf8");
/** Evaluates a constant product such as `10 * 1024 * 1024` read from server source (the server does not export it). */
const product = (expr) => expr.split("*").map((f) => Number(f.replace(/[_\s]/g, ""))).reduce((a, b) => a * b, 1);
const quoted = (list) => [...list.matchAll(/"([^"]+)"/g)].map((m) => m[1]);

const baseHub = { mode: "BUILD_SAFE", executionGate: { status: "suspended", reason: "BUILD_SAFE" }, pendingApprovals: 0, activeRuns: [], recentFailures: [], breakers: {}, verifyingTasks: 0, backupRunning: 0 };

test("M02-UI-01 core state: every one of the 10 states comes from a real signal, with a reason", () => {
  assert.deepEqual(CORE_STATE_IDS.slice().sort(), Object.keys(CORE_VISUALS).sort());
  const s = (patch, extra = {}) => deriveCoreState({ hub: { ...baseHub, ...patch }, connection: "live", voicePhase: "idle", ...extra });
  assert.equal(s({}).state, "IDLE");
  assert.match(s({}).reason, /BUILD_SAFE/);
  assert.equal(deriveCoreState({ hub: baseHub, connection: "reconnecting" }).state, "OFFLINE");
  assert.equal(deriveCoreState({ hub: null, connection: "reconnecting" }).state, "OFFLINE");
  assert.equal(s({}, { voicePhase: "listening" }).state, "LISTENING");
  assert.equal(s({}, { voicePhase: "transcribing" }).state, "TRANSCRIBING");
  assert.equal(s({ pendingApprovals: 2 }).state, "WAITING_APPROVAL");
  const waiting = s({ activeRuns: [{ runId: "r1", phase: "waiting_provider" }] });
  assert.equal(waiting.state, "WAITING_PROVIDER");
  assert.match(waiting.reason, /nu este progres măsurat/);
  assert.equal(s({ activeRuns: [{ runId: "r1", phase: "streaming" }] }).state, "EXECUTING");
  assert.equal(s({ verifyingTasks: 1 }).state, "VERIFYING");
  assert.equal(s({ backupRunning: 1 }).state, "VERIFYING");
  assert.equal(s({ recentFailures: [{ id: "x" }] }).state, "ERROR");
  assert.equal(s({ breakers: { codex: { state: "open" } } }).state, "ERROR");
  assert.equal(s({ mode: "LIVE_VALIDATION", executionGate: { status: "suspended", reason: "Stop All" } }).state, "PAUSED");
  assert.equal(s({ mode: "LIVE_VALIDATION", executionGate: { status: "open" } }).state, "IDLE");
  // Approvals outrank running work: the owner must see what needs a decision.
  assert.equal(s({ pendingApprovals: 1, activeRuns: [{ runId: "r", phase: "streaming" }] }).state, "WAITING_APPROVAL");
  // ...and outrank voice (M03): a long Lega session never hides a pending approval.
  assert.equal(s({ pendingApprovals: 1 }, { voicePhase: "listening" }).state, "WAITING_APPROVAL");
  assert.equal(s({ pendingApprovals: 1 }, { legaPhase: "speaking" }).state, "WAITING_APPROVAL");
  // Lega phases map onto the same 10 states, with their own honest labels.
  assert.deepEqual([s({}, { legaPhase: "connecting" }), s({}, { legaPhase: "listening" }), s({}, { legaPhase: "user-speaking" }), s({}, { legaPhase: "speaking" }), s({}, { legaPhase: "delegating" })]
    .map((c) => [c.state, c.label]), [["WAITING_PROVIDER", "Lega se conectează"], ["LISTENING", "Lega ascultă"], ["LISTENING", "Lega te ascultă"], ["TRANSCRIBING", "Lega vorbește"], ["EXECUTING", "Lega lucrează"]]);
  assert.match(s({}, { legaPhase: "connecting" }).reason, /nu este progres măsurat/);
  assert.equal(s({}).label, CORE_VISUALS.IDLE.label, "without Lega the label is the state's own");
});

test("M02-UI-02 markdown: tokens only (no HTML pass-through), unsafe links degrade to text, code fences keep their language", () => {
  const blocks = parseMarkdown("# Titlu\n\nText cu **bold**, `cod` și [link](https://example.com).\n\n```js\nconst a = '<script>';\n```\n- unu\n- doi\n\n> citat\n\n<img src=x onerror=alert(1)>");
  assert.deepEqual(blocks.map((b) => b.t), ["heading", "p", "code", "list", "quote", "p"]);
  assert.equal(blocks[2].lang, "js");
  assert.equal(blocks[2].v, "const a = '<script>';");
  assert.equal(blocks[5].c[0].t, "text", "raw HTML stays literal text");
  assert.ok(parseInline("[x](javascript:alert(1))").every((t) => t.t === "text"), "a javascript: link is never a link token");
  assert.equal(parseInline("[ok](https://a.b)")[0].t, "link");
  assert.equal(parseMarkdown("```\nunterminated")[0].open, true);
});

test("M02-UI-03 attachments: type, size and secret-like names are checked before upload", () => {
  assert.equal(validateAttachment({ name: "notes.md", size: 10, type: "text/markdown" }).ok, true);
  assert.equal(validateAttachment({ name: "shot.png", size: 1000, type: "image/png" }).ok, true);
  assert.match(validateAttachment({ name: ".env", size: 10, type: "text/plain" }).reason, /secret/);
  assert.match(validateAttachment({ name: "id_rsa", size: 10, type: "" }).reason, /secret/);
  assert.match(validateAttachment({ name: "big.pdf", size: 16 * 1024 * 1024, type: "application/pdf" }).reason, /MB/);
  assert.match(validateAttachment({ name: "app.exe", size: 10, type: "application/x-msdownload" }).reason, /Tip/);
  assert.match(validateAttachment({ name: "empty.txt", size: 0, type: "text/plain" }).reason, /gol/);
  // The real limit is the decoded 10 MB the server stores (a 12 MB file used to pass here and fail after the upload).
  assert.equal(validateAttachment({ name: "max.pdf", size: 10 * 1024 * 1024, type: "application/pdf" }).ok, true);
  const tooBig = validateAttachment({ name: "scan.pdf", size: 12 * 1024 * 1024, type: "application/pdf" });
  assert.equal(tooBig.ok, false);
  assert.equal(tooBig.reason, "Fișierul are 12 MB; limita Hub-ului este 10 MB pe fișier");
  assert.match(validateAttachment({ name: "scan.pdf", size: 10 * 1024 * 1024 + 1, type: "application/pdf" }).reason, /^Fișierul are 10,1 MB;/, "1 byte over never reads as 10 MB");
  assert.equal(attachmentMime({ name: "x", type: "toString" }), null, "inherited object keys are not MIME types");
  // The MIME sent is one the server accepts: the extension decides when the browser reports "" or a foreign type.
  assert.equal(validateAttachment({ name: "date.csv", size: 10, type: "application/vnd.ms-excel" }).mime, "text/csv");
  assert.equal(attachmentMime({ name: "note.md", type: "" }), "text/markdown");
  assert.equal(attachmentMime({ name: "server.log", type: "" }), "text/plain");
  assert.equal(attachmentMime({ name: "FOTO.JPG", type: "" }), "image/jpeg");
  assert.equal(attachmentMime({ name: "shot.png", type: "image/png" }), "image/png");
  assert.equal(attachmentMime({ name: "setup.exe", type: "application/x-msdownload" }), null);
  assert.equal(attachmentMime({ name: "fără-extensie", type: "" }), null);
});

test("M02-UI-13 attachment limit and types are the server's: decoded size, route body room, accepted MIME types", () => {
  const conversations = source("server/domain/conversations.mjs");
  const decoded = conversations.match(/const ATTACHMENT_MAX_BYTES\s*=\s*([\d_\s*]+);/);
  assert.ok(decoded, "server/domain/conversations.mjs must define ATTACHMENT_MAX_BYTES");
  assert.equal(ATTACHMENT_MAX_BYTES, product(decoded[1]), "client limit = decoded size the server stores");
  const serverTypes = conversations.match(/const ATTACHMENT_TYPES\s*=\s*new Set\(\[([^\]]*)\]\)/);
  assert.ok(serverTypes, "server/domain/conversations.mjs must define ATTACHMENT_TYPES");
  assert.deepEqual(Object.keys(ATTACHMENT_TYPES).sort(), quoted(serverTypes[1]).sort());
  // Every MIME the client can send is accepted by the server.
  for (const name of ["a.txt", "a.log", "a.md", "a.json", "a.csv", "a.png", "a.jpg", "a.jpeg", "a.webp", "a.pdf"]) assert.ok(quoted(serverTypes[1]).includes(attachmentMime({ name })), name);
  // The route limit is the JSON body: a maximum-size file, base64-encoded with a 200-char name, still fits.
  const route = source("server/http/routes.mjs").split("\n").find((l) => l.includes('"/api/conversations/:id/attachments"'));
  const body = route?.match(/maxBytes:\s*([\d_\s*]+)/);
  assert.ok(body, "the attachments route declares maxBytes");
  assert.ok(4 * Math.ceil(ATTACHMENT_MAX_BYTES / 3) + 1024 <= product(body[1]), "base64 of the largest accepted file fits the route body limit");
});

test("M02-UI-04 error stage names where a run stopped (policy, backup, auth, quota, transport, tool, task)", () => {
  for (const [cat, label] of [["policy", "Politică"], ["backup", "Backup"], ["authentication", "Autentificare"], ["quota", "Cotă"], ["transport", "Transport"], ["tool", "Unealtă"], ["task", "Task"], ["gate", "Poartă"]]) {
    assert.equal(errorStage(cat), label);
  }
  assert.equal(errorStage("quota", { preInference: true }), "Cotă · înainte de model");
  assert.equal(errorStage(null), "Necunoscut");
});

test("M02-UI-05 Focus layout: clamped sizes, panes collapse before the conversation gets narrower than 360 px", () => {
  const wide = fitLayout(DEFAULT_LAYOUT, { width: 1920, height: 1080 });
  assert.equal(wide.showLeft && wide.showRight, true);
  const laptop = fitLayout({ ...DEFAULT_LAYOUT, left: 400, right: 760 }, { width: 1280, height: 800 });
  assert.ok(1280 - (laptop.showLeft ? laptop.left : 0) - (laptop.showRight ? laptop.right : 0) >= 360);
  const tablet = fitLayout(DEFAULT_LAYOUT, { width: 768, height: 1024 });
  assert.equal(tablet.showLeft, false);
  assert.equal(tablet.compact, true);
  const garbage = fitLayout({ left: -5, right: 99999, bottom: "x" }, { width: 1440, height: 900 });
  assert.ok(garbage.left >= 200 && garbage.right <= 760 && garbage.bottom >= 140);
});

test("M02-UI-06 mission progress is counted, never estimated", () => {
  const p = missionProgress([{ status: "COMPLETED" }, { status: "BLOCKED" }, { status: "WAITING_APPROVAL" }, { status: "CANCELLED" }, { status: "DRAFT" }]);
  assert.deepEqual({ c: p.completed, t: p.total, b: p.blocked, w: p.waitingApproval, pct: p.percent }, { c: 1, t: 4, b: 1, w: 1, pct: 25 });
  assert.equal(missionProgress([]).percent, null);
});

test("M02-UI-07 ecosystem catalog keeps documented / eligible / authenticated / implemented / verified-live / verified-simulated apart", () => {
  const usable = classifyCapability({ status: "AVAILABLE", hubDecision: "WRAP", apiBillingRisk: "none", officialSource: "x" }, { surface: { availability: "available", programmaticControl: "PROGRAMMATIC" }, verifications: [{ result: "PASS_SIMULATED" }] });
  assert.equal(usable.bucket, "usable");
  assert.equal(usable.facts.verifiedLive, false, "simulated evidence is never shown as live");
  assert.equal(usable.facts.verifiedSimulated, true);
  assert.equal(classifyCapability({ status: "BLOCKED", apiBillingRisk: "high" }).bucket, "blocked");
  assert.equal(classifyCapability({ status: "ASSISTED_ONLY", hubDecision: "ASSISTED" }).bucket, "assisted");
  assert.equal(classifyCapability({ status: "NEEDS_SETUP", hubDecision: "WRAP" }).bucket, "setup");
  assert.equal(classifyCapability({ status: "AVAILABLE", hubDecision: "WRAP", apiBillingRisk: "none" }, { surface: { availability: "needs_setup", programmaticControl: "PROGRAMMATIC" } }).bucket, "setup", "not authenticated locally → not usable now");
  assert.equal(classifyCapability({ status: "AVAILABLE", apiBillingRisk: "low" }).cost, "poate depăși planul");
});

test("M02-UI-08 local voice commands are deterministic; approvals, deletions and deploys are refused", () => {
  const projects = [{ id: "prj_1", name: "Ifrim Agent Hub", slug: "ifrim-agent-hub" }, { id: "prj_2", name: "Site Restaurant", slug: "site-restaurant" }];
  assert.deepEqual(parseLocalCommand("Oprește!"), { kind: "hub", command: "stop" });
  assert.deepEqual(parseLocalCommand("Pauză"), { kind: "hub", command: "pause" });
  assert.equal(parseLocalCommand("Deschide aprobările").path, "/approvals");
  assert.equal(parseLocalCommand("Intră în Focus").path, "/conversations");
  assert.equal(parseLocalCommand("deschide proiectul site restaurant", { projects }).path, "/projects/prj_2");
  assert.equal(parseLocalCommand("deschide proiectul inexistent", { projects }).kind, "unknown");
  for (const t of ["Aprobă tot", "șterge baza", "deploy pe producție", "trimite emailul"]) assert.equal(parseLocalCommand(t).kind, "refused", t);
  assert.equal(parseLocalCommand("scrie un rezumat al misiunii"), null, "free text becomes an editable draft, not a command");
});

const ev = (seq, type = "task.updated") => ({ seq, type, createdAt: `t${seq}` });

test("M02-UI-09 event gate: duplicates, stale and out-of-order sequences dropped; a log behind our mark resyncs", () => {
  let st = { lastSeq: 10, bootId: null, lastEventAt: null };
  let r = acceptEvent(st, ev(11)); assert.equal(r.accept, true); st = r.state;
  assert.equal(acceptEvent(st, ev(11)).accept, false, "duplicate");
  assert.equal(acceptEvent(st, ev(9)).accept, false, "late event already covered by replay");
  assert.equal(acceptEvent(st, { type: "x" }).accept, false, "no seq");
  assert.equal(acceptEvent(st, { seq: 12 }).accept, false, "no type: listeners read event.type");
  assert.equal(acceptEvent(st, { seq: 12.5, type: "x" }).accept, false, "not an integer");
  assert.equal(acceptEvent(st, null).accept, false);
  assert.equal(st.lastEventAt, "t11");

  const gate = createEventGate({ after: 10 });
  assert.equal(gate.known, true);
  assert.deepEqual([11, 13, 12, 13, 14].map((seq) => gate.accept(ev(seq))), [true, true, false, false, true], "12 after 13 is out of order");
  assert.equal(gate.lastSeq, 14);
  // Restart over the same log: the mark stays, ?after replays exactly the gap.
  assert.deepEqual(gate.hello({ lastSeq: 20, bootId: "boot_a" }), { valid: true, resync: false, restarted: false, after: 14 });
  assert.deepEqual(gate.hello({ lastSeq: 22, bootId: "boot_b" }), { valid: true, resync: false, restarted: true, after: 14 });
  // Reset database: the server's log is behind our mark, so the mark drops and the stream must reopen from there;
  // the new log's reused numbers are then accepted (a seen-set that outlived the reset used to drop them).
  assert.deepEqual(gate.hello({ lastSeq: 3, bootId: "boot_c" }), { valid: true, resync: true, restarted: true, after: 3 });
  assert.equal(gate.accept(ev(4)), true);
  assert.equal(gate.bootId, "boot_c");
  // Malformed hello: nothing changes.
  assert.deepEqual(gate.hello({ bootId: 7 }), { valid: false, resync: false, restarted: false, after: 4 });
  assert.equal(acceptHello({ lastSeq: 5, bootId: null }, null).valid, false);

  // Unknown start (no state snapshot): accept nothing until hello, then resync to the server's mark, never replay from 0.
  for (const after of [null, undefined, -1, Number.NaN, "12"]) assert.equal(createEventGate({ after }).known, false, String(after));
  const unknown = createEventGate();
  assert.equal(unknown.lastSeq, STREAM_UNKNOWN_SEQ);
  assert.equal(unknown.accept(ev(1)), false);
  assert.deepEqual(unknown.hello({ lastSeq: 50, bootId: "boot_a" }), { valid: true, resync: true, restarted: false, after: 50 });
  assert.equal(unknown.known, true);
  assert.equal(unknown.accept(ev(50)), false);
  assert.equal(unknown.accept(ev(51)), true);
});

/** Drives the app's real stream client (openStream in api.js) with a scripted EventSource and manual timers. */
function streamHarness(options = {}) {
  const sources = [];
  class FakeEventSource {
    constructor(url) { this.url = url; this.handlers = {}; this.closed = false; this.onerror = null; sources.push(this); }
    addEventListener(type, fn) { (this.handlers[type] ||= []).push(fn); }
    close() { this.closed = true; }
    send(type, data) { for (const fn of this.handlers[type] || []) fn({ data: typeof data === "string" ? data : JSON.stringify(data) }); }
    fail() { this.onerror?.({ type: "error" }); }
  }
  const pending = new Map(); let nextId = 1;
  const timers = { setTimeout(fn, ms) { const id = nextId++; pending.set(id, { fn, ms }); return id; }, clearTimeout(id) { pending.delete(id); } };
  const runTimers = () => { const due = [...pending.values()]; pending.clear(); for (const t of due) t.fn(); return due.map((t) => t.ms); };
  const got = { events: [], live: [], statuses: [] };
  const stream = openStream({ ...options, onEvent: (e) => got.events.push(e.seq), onLive: (e) => got.live.push(e), onStatus: (s) => got.statuses.push(s), EventSourceImpl: FakeEventSource, timers });
  return { sources, stream, got, pending, runTimers, last: () => sources.at(-1) };
}

test("M02-UI-10 the live stream client uses the gate: ?after replay, dedup, restart, reset-database resync, backoff, close", () => {
  const h = streamHarness({ after: 10 });
  assert.match(h.last().url, /^\/api\/stream\?after=10$/);
  h.last().send("hello", { lastSeq: 12, bootId: "boot_a" });
  assert.deepEqual(h.got.statuses, ["live"]);
  for (const e of [ev(11), ev(11), ev(12), ev(9)]) h.last().send("hub", e);
  h.last().send("hub", "{not json");
  h.last().send("hub", { type: "no.seq" });
  assert.deepEqual(h.got.events, [11, 12]);
  h.last().send("live", { type: "run.delta", text: "a" });
  h.last().send("live", "{garbage");
  assert.equal(h.got.live.length, 1, "a malformed live frame is dropped, not thrown");
  assert.equal(h.stream.lastSeq, 12);

  // Transport drop: status first, then a NEW EventSource after the backoff with ?after = last accepted seq.
  const first = h.last();
  first.fail();
  assert.equal(first.closed, true, "the browser's own retry (Last-Event-ID) is cancelled");
  assert.equal(h.got.statuses.at(-1), "reconnecting");
  assert.equal(h.sources.length, 1, "nothing reopens before the backoff");
  assert.deepEqual(h.runTimers(), [1000]);
  assert.match(h.last().url, /after=12$/);
  first.send("hub", ev(13));
  assert.deepEqual(h.got.events, [11, 12], "a frame from the dropped source is ignored");

  // Restart over the same log (new bootId): replay of the gap is delivered once, overlap dropped.
  h.last().send("hello", { lastSeq: 14, bootId: "boot_b" });
  for (const e of [ev(12), ev(13), ev(14), ev(14)]) h.last().send("hub", e);
  assert.deepEqual(h.got.events, [11, 12, 13, 14]);

  // Reset database: hello shows the server's log behind our mark → reopen at once from the server's lastSeq.
  h.last().fail(); h.runTimers();
  const stale = h.last();
  assert.match(stale.url, /after=14$/);
  stale.send("hello", { lastSeq: 3, bootId: "boot_c" });
  assert.equal(stale.closed, true);
  assert.notEqual(h.last(), stale);
  assert.match(h.last().url, /after=3$/);
  assert.equal(h.got.statuses.at(-1), "reconnecting", "not live until the reopened stream says hello");
  stale.send("hub", ev(15));
  h.last().send("hello", { lastSeq: 3, bootId: "boot_c" });
  h.last().send("hub", ev(4));
  assert.deepEqual(h.got.events, [11, 12, 13, 14, 4], "the new log's seq 4 is delivered; the stale source's frame is not");
  assert.equal(h.got.statuses.at(-1), "live");

  // Backoff doubles up to 15 s while the Hub is down, and resets after a hello.
  const delays = [];
  for (let i = 0; i < 6; i += 1) { h.last().fail(); delays.push(...h.runTimers()); }
  assert.deepEqual(delays, [1000, 2000, 4000, 8000, 15000, 15000]);
  h.last().send("hello", { lastSeq: 4, bootId: "boot_c" });
  h.last().fail();
  assert.deepEqual(h.runTimers(), [1000]);

  // close(): the pending reconnect is cancelled and nothing reopens.
  h.last().fail();
  assert.equal(h.pending.size, 1);
  const count = h.sources.length;
  h.stream.close();
  assert.equal(h.pending.size, 0);
  assert.equal(h.sources.length, count);
  assert.equal(h.last().closed, true);
});

test("M02-UI-10b unknown start learns the server's mark from hello; a hello without lastSeq retries with backoff", () => {
  const h = streamHarness({ after: null });
  assert.match(h.last().url, new RegExp(`after=${STREAM_UNKNOWN_SEQ}$`), "asks for nothing instead of replaying from 0");
  h.last().send("hello", { lastSeq: 50, bootId: "boot_a" });
  assert.match(h.last().url, /after=50$/);
  assert.equal(h.sources.length, 2);
  h.last().send("hello", { lastSeq: 50, bootId: "boot_a" });
  h.last().send("hub", ev(51));
  assert.deepEqual(h.got.events, [51]);
  assert.deepEqual(h.got.statuses, ["live"]);

  const bad = streamHarness({});
  bad.last().send("hello", "{}");
  assert.equal(bad.last().closed, true);
  assert.equal(bad.got.statuses.at(-1), "reconnecting");
  assert.deepEqual(bad.runTimers(), [1000]);
  assert.equal(bad.sources.length, 2);
  bad.stream.close();
  h.stream.close();
});

test("M02-UI-11 global Alt shortcuts ignore AltGr, Alt codes, IME, repeat and other chords; every Alt handler uses the helper", () => {
  const k = (key, extra = {}) => ({ key, code: /^[0-9]$/.test(key) ? `Digit${key}` : `Key${String(key).toUpperCase()}`, altKey: true, ctrlKey: false, metaKey: false,
    shiftKey: false, repeat: false, isComposing: false, defaultPrevented: false, location: 0, keyCode: 0, ...extra });
  assert.equal(appShortcutKey(k("1")), "1");
  assert.equal(appShortcutKey(k("m")), "m");
  assert.equal(appShortcutKey(k("J")), "j", "Caps Lock");
  assert.equal(appShortcutKey(k("1", { ctrlKey: true })), null, "AltGr on Windows = Ctrl+Alt");
  assert.equal(appShortcutKey(k("~", { ctrlKey: true, code: "Digit1" })), null, "AltGr+1 on the Romanian layout types a character");
  assert.equal(appShortcutKey(k("l", { getModifierState: (m) => m === "AltGraph" })), null, "AltGraph modifier");
  assert.equal(appShortcutKey(k("2", { code: "Numpad2", location: 3 })), null, "Alt+numpad digits are Windows Alt codes (Alt+0226 = â)");
  assert.equal(appShortcutKey(k("m", { isComposing: true })), null, "IME composition");
  assert.equal(appShortcutKey(k("m", { keyCode: 229 })), null, "IME composition (legacy signal)");
  assert.equal(appShortcutKey(k("j", { repeat: true })), null, "auto-repeat must not flip a toggle back and forth");
  assert.equal(appShortcutKey(k("m", { metaKey: true })), null);
  assert.equal(appShortcutKey(k("M", { shiftKey: true })), null, "Alt+Shift is the Windows layout switch");
  assert.equal(appShortcutKey(k("m", { defaultPrevented: true })), null);
  assert.equal(appShortcutKey(k("ș")), null, "only ASCII letters and digits");
  assert.equal(appShortcutKey(k("F4")), null);
  assert.equal(appShortcutKey({ ...k("1"), altKey: false }), null);
  assert.equal(appShortcutKey({ altKey: true }), null, "a keydown without key (autofill) does not throw");
  assert.equal(appShortcutKey(null), null);
  assert.equal(isAppShortcut(k("J"), "j"), true);
  assert.equal(isAppShortcut(k("j", { ctrlKey: true }), "j"), false);
  assert.equal(isAppShortcut(k("l"), "j"), false);

  // The app's global handlers go through the helper: no raw altKey test is left in the web sources.
  const files = [];
  const walk = (dir) => { for (const d of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, d.name); if (d.isDirectory()) walk(p); else if (/\.(jsx?|mjs)$/.test(d.name)) files.push(p); } };
  walk(path.join(V2, "web", "src"));
  const raw = files.filter((f) => !f.endsWith(path.join("lib", "uiLogic.js")) && /\.altKey\b/.test(fs.readFileSync(f, "utf8")));
  assert.deepEqual(raw.map((f) => path.relative(V2, f)), [], "use appShortcutKey / isAppShortcut from lib/uiLogic.js");
  assert.match(source("web/src/shell/Shell.jsx"), /appShortcutKey\(e\)/);
  assert.match(source("web/src/shell/Lega.jsx"), /isAppShortcut\(e, "l"\)/);
  assert.match(source("web/src/screens/stage/LegaStage.jsx"), /isAppShortcut\(e, "j"\)/);
});

test("M02-UI-12 composer model/effort: Codex from model/list, Claude aliases labelled unverified, only efforts run.start accepts", () => {
  const catalog = source("server/runtime/command-catalog.mjs").match(/reg\("run\.start"[\s\S]*?effort:\s*\{\s*enum:\s*\[([^\]]*)\]/);
  assert.ok(catalog, "run.start declares an effort enum");
  assert.deepEqual([...RUN_EFFORTS], quoted(catalog[1]), "the client offers only what the server accepts");

  const claude = composerOptions({ provider: "claude", providerState: null, effort: "high" });
  assert.equal(claude.modelSource, "unverified");
  assert.deepEqual(claude.models.map((m) => m.id), [...CLAUDE_MODEL_ALIASES]);
  assert.ok(claude.models.every((m) => /nevalidat/.test(m.label)), "the UI says the aliases are not verified");
  assert.ok(CLAUDE_MODEL_ALIASES.every((id) => !CLAUDE_REFUSED_MODELS.test(id)), "never offers a model the adapter refuses");
  assert.match(claude.modelNote, /nevalidate de Hub/);
  assert.equal(claude.effortSource, "unverified");
  assert.equal(claude.effort, "high");
  const noEffortFlag = composerOptions({ provider: "claude", providerState: { installation: { installed: true, flags: ["--output-format", "--tools"] } }, effort: "high" });
  assert.deepEqual([noEffortFlag.effortSource, noEffortFlag.efforts, noEffortFlag.effort], ["unsupported", [], ""], "no --effort in the CLI: nothing is sent");
  assert.equal(composerOptions({ provider: "claude", providerState: { installation: { flags: ["--effort"] } }, effort: "xhigh" }).effort, "xhigh");

  const unread = composerOptions({ provider: "codex", providerState: { models: null }, effort: "low" });
  assert.deepEqual([unread.models, unread.modelSource, unread.effortSource, unread.effort], [null, "unread", "unverified", "low"]);
  const models = [{ id: "gpt-a", displayName: "GPT A", isDefault: true, efforts: ["minimal", "low", "high"], defaultEffort: "low" },
    { id: "gpt-b", efforts: ["none"] }, { id: "gpt-c", efforts: [] }, null, { id: 5 }];
  const codex = composerOptions({ provider: "codex", providerState: { models }, effort: "xhigh" });
  assert.deepEqual(codex.models, [{ id: "gpt-a", label: "GPT A" }, { id: "gpt-b", label: "gpt-b" }, { id: "gpt-c", label: "gpt-c" }]);
  assert.deepEqual([codex.modelSource, codex.efforts, codex.effortSource, codex.defaultEffort], ["verified", ["low", "high"], "verified", "low"], "default model's reported efforts, minus what run.start refuses");
  assert.equal(codex.effort, "", "a stored effort the model does not report is not sent");
  assert.equal(composerOptions({ provider: "codex", providerState: { models }, model: "gpt-a", effort: "high" }).effort, "high");
  assert.deepEqual(composerOptions({ provider: "codex", providerState: { models }, model: "gpt-b", effort: "high" }).efforts, [], "reported efforts, none accepted: offer none");
  assert.equal(composerOptions({ provider: "codex", providerState: { models }, model: "gpt-c" }).effortSource, "unverified");
  for (const o of [claude, unread, codex]) assert.ok(o.efforts.every((x) => RUN_EFFORTS.includes(x)));
});

test("M02-UI-14 review fixes: file-name limit is the server's; the live stream starts at the snapshot or unknown, never 0; approved-but-not-started commands stay visible", () => {
  const schema = source("server/runtime/command-catalog.mjs").split("\n").find((l) => l.includes('reg("conversation.attachment"'));
  assert.equal(Number(schema.match(/filename:\s*\{[^}]*max:\s*(\d+)/)[1]), ATTACHMENT_NAME_MAX, "client file-name limit = server schema");
  assert.equal(validateAttachment({ name: `${"a".repeat(ATTACHMENT_NAME_MAX - 4)}.txt`, size: 10, type: "text/plain" }).ok, true);
  assert.match(validateAttachment({ name: `${"a".repeat(ATTACHMENT_NAME_MAX)}.txt`, size: 10, type: "text/plain" }).reason, /200 de caractere/);
  assert.equal(streamStartSeq({ lastSeq: 42 }), 42);
  assert.equal(streamStartSeq({ lastSeq: 0 }), 0);
  for (const hub of [null, {}, { lastSeq: -1 }, { lastSeq: 1.5 }, { lastSeq: "7" }]) assert.equal(streamStartSeq(hub), null, JSON.stringify(hub));
  assert.match(source("web/src/store.js"), /connect\(streamStartSeq\(state\.hub\)\)/, "the app uses the tested start");
  const future = new Date(Date.now() + 60000).toISOString(); const past = new Date(Date.now() - 1000).toISOString();
  const run = { scopeType: "command", actionKind: "lega.run_request", status: "approved", expiresAt: future };
  assert.equal(isCommandApproval(run), true);
  assert.equal(isCommandApproval({ scopeType: "command", actionKind: "process.run" }), false, "npm scripts keep their own button");
  assert.equal(isCommandApproval({ scopeType: "task", actionKind: "provider.command" }), false);
  assert.deepEqual(approvedNotStarted([run, { ...run, status: "consumed" }, { ...run, expiresAt: past }, { ...run, status: "pending" }]), [run]);
  // Approving a proposed command starts it in the same click (the live bug of 2026-09-30: approved twice, nothing ran).
  const approvals = source("web/src/screens/Approvals.jsx");
  assert.match(approvals, /decision === "approved" && commandScoped\) await startApproved\(approval\)/);
  assert.match(approvals, /async function startApproved[\s\S]{0,200}\/api\/commands\/\$\{approval\.scopeId\}\/execute[\s\S]{0,300}pushToast/, "a failed start stays visible after the card leaves");
  // Local tools approved on the same screen (npm script, browser check) are never lost either.
  const script = { scopeType: "project", actionKind: "process.run", status: "approved", expiresAt: future };
  const check = { scopeType: "project", actionKind: "browser.inspect", status: "approved", expiresAt: future };
  assert.deepEqual(approvedNotStarted([script, check]), [script, check]);
  assert.equal(isCommandApproval(check), false, "a browser check runs through its own approval route, not /api/commands");
  assert.match(approvals, /approvedNotStarted\(/);
  assert.match(source("web/src/shell/Lega.jsx"), /approvedNotStarted\(/);
  assert.doesNotMatch(source("web/src/lib/coreState.js"), /Last-Event-ID/, "the UI does not claim a mechanism the client does not use");
});
