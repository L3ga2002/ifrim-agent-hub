import test from "node:test";
import assert from "node:assert/strict";
import { deriveCoreState, CORE_STATE_IDS, CORE_VISUALS } from "../web/src/lib/coreState.js";
import { parseMarkdown, parseInline } from "../web/src/lib/markdown.js";
import { validateAttachment, errorStage, fitLayout, DEFAULT_LAYOUT, missionProgress, classifyCapability, parseLocalCommand, acceptEvent } from "../web/src/lib/uiLogic.js";

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

test("M02-UI-09 event stream bookkeeping drops duplicates and stale sequences", () => {
  let st = { lastSeq: 10, seen: new Set([10]), lastEventAt: null };
  let r = acceptEvent(st, { seq: 11, createdAt: "t11" }); assert.equal(r.accept, true); st = r.state;
  assert.equal(acceptEvent(st, { seq: 11 }).accept, false, "duplicate");
  assert.equal(acceptEvent(st, { seq: 9 }).accept, false, "late event already covered by replay");
  assert.equal(acceptEvent(st, { type: "x" }).accept, false, "unknown shape");
  assert.equal(st.lastEventAt, "t11");
});
