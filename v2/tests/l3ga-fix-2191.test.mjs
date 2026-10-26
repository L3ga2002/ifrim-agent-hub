// 2.19.1 — the owner's L3ga session of 2026-10-25 (18:12–18:19, Romania): every sentence he said, read again; the wishlist he asked for
// („trece asta pe un wishlist”, „fă un wishlist nou”); the map he wanted bigger and the conversation he wanted to minimize; and the agent
// turn that stayed silent for four minutes until Stop All. Fake app-server and synthetic hubs only: no network, no model.
import test from "node:test";
import assert from "node:assert/strict";
import { acceptanceHub } from "./accept-helpers.mjs";
import { makeTestHub, enrolOwner, prepareLiveWithoutGrants, waitFor } from "./helpers.mjs";
import { resolveIntent, wishlistMatch, viewMatch, clauseCovered } from "../server/owner/intents.mjs";
import { LEGA_CONSENT_VERSION } from "../server/policy/lega-policy.mjs";
import { TURN_STALL_TEXT } from "../server/runtime/lega.mjs";
import { MIGRATIONS } from "../server/storage/migrations.mjs";
import { HUB_VERSION, API_CONTRACT } from "../server/config.mjs";

const steps = (text, ctx = {}) => resolveIntent(text, { projects: [], processSheets: [], ...ctx }).steps.map((s) => [s.intent, s.args]);
const count = (hub, table) => hub.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
const work = (hub) => Object.fromEntries(["agent_runs", "mission_envelopes", "ops_plans", "approvals", "live_grants"].map((x) => [x, count(hub, x)]));
const ask = (t, text) => t.request("/api/owner/intent", { body: { text } });
const one = (r, intent) => { assert.equal(r.status, 200, JSON.stringify(r.json)); const out = r.json.results.find((x) => x.intent === intent); assert.ok(out, JSON.stringify(r.json)); return out; };

test("L3-01 the owner's own sentences of 2026-10-25 resolve to what he meant", () => {
  const table = [
    // The acceptance step copied with its quotes (open and closed, or only open): the M16 screen, never „Nu am înțeles”.
    ["„L3ga, mod comandă", [["command_mode", {}]]],
    ["„L3ga, mod comandă”", [["command_mode", {}]]],
    ["Poți să o mărești", [["map_view", { action: "bigger" }]]],
    ["Ok, trece asta pe un wishlist", [["wishlist_add", { ref: "last" }]]],
    ["Și mai vreau pe wishlist acest chat cu tine să-l pot minimiza ca să văd harta completă", [["wishlist_add", { text: "acest chat cu tine să-l pot minimiza ca să văd harta completă" }]]],
    ["Ai trecut pe wishlist", [["wishlist_list", { asked: true }]]],
    ["Păi ce verifici, fă un wishlist nou", [["wishlist_add", { ref: "last", create: true }]]],
    ["Harta companiei din nou", [["show_company", { again: true }]]],
    ["La vânzări", [["department_show", { departmentKey: "sales" }]]],
  ];
  for (const [text, expected] of table) assert.deepEqual(steps(text), expected, text);
  // The same family, said differently.
  const more = [
    ["Pune pe wishlist: mărirea hărții.", "wishlist_add", { text: "mărirea hărții" }],
    ["Pune mărirea hărții pe wishlist", "wishlist_add", { text: "mărirea hărții" }],
    ["Vreau pe wishlist: un buton de export PDF, și unul de print", "wishlist_add", { text: "un buton de export PDF, și unul de print" }],
    ["pune-o pe wishlist", "wishlist_add", { ref: "last" }],
    ["Ce e pe wishlist?", "wishlist_list", { asked: true }],
    ["Arată-mi wishlist-ul", "wishlist_list", { asked: false }],
    ["Vreau să văd ce am pe wishlist", "wishlist_list", { asked: false }], ["Aș vrea să știu ce e pe wishlist", "wishlist_list", { asked: false }],
    ["Mărește harta", "map_view", { action: "bigger" }], ["Fă harta mai mare", "map_view", { action: "bigger" }],
    ["Micșorează harta", "map_view", { action: "smaller" }], ["Harta pe tot ecranul", "map_view", { action: "full" }],
    ["Harta normală", "map_view", { action: "reset" }], ["Închide harta", "map_view", { action: "close" }],
    ["Ascunde chatul", "chat_view", { hidden: true }], ["Minimizează conversația", "chat_view", { hidden: true }], ["Arată conversația", "chat_view", { hidden: false }],
    ["Mergi la vânzări", "department_show", { departmentKey: "sales" }], ["Du-mă la Engineering", "department_show", { departmentKey: "engineering" }],
  ];
  for (const [text, intent, args] of more) assert.deepEqual(steps(text), [[intent, args]], text);
  // Never a wishlist: a negation, a sentence without the word, a quoted stop stays its own rule.
  assert.deepEqual(steps("Nu pune asta pe wishlist").map(([i]) => i), ["unknown"]);
  assert.equal(wishlistMatch("Arată harta companiei"), null);
  assert.deepEqual(steps("Lega, oprește tot"), [["stop_all", {}]]);
  // A wishlist sentence from a document is content, never a note.
  const doc = resolveIntent("Pune pe wishlist: export PDF", { projects: [], source: "document" });
  assert.equal(doc.steps[0].effectClass, "REFUSED"); assert.ok(doc.refused.length);
  // Effect classes: the view is a read, the note a local action (from the provider transcript only under the derived owner authority).
  assert.equal(resolveIntent("Mărește harta", { projects: [] }).steps[0].effectClass, "READ_NAVIGATE");
  assert.equal(resolveIntent("Pune pe wishlist: export PDF", { projects: [] }).steps[0].effectClass, "SIMPLE_LOCAL_ACTION");
  // A whole wishlist / view sentence is covered by its step (the voice bridge then withholds the agent's second answer).
  assert.equal(clauseCovered("wishlist_add", "si mai vreau pe wishlist acest chat cu tine"), true);
  assert.equal(viewMatch("o maresti")?.intent, "map_view");
  // A quoted confirmation or plan is still a quotation (the quoted re-read is only for reads and screens).
  assert.notDeepEqual(steps("„Da, execută planul”").map(([i]) => i), ["confirm"]);
});

test("L3-02 the wishlist through the conversation and the screen: „asta” is the last request the Hub could not do; nothing starts", { timeout: 120000 }, async (c) => {
  const t = await acceptanceHub(); c.after(() => t.cleanup());
  assert.equal(MIGRATIONS.at(-1).version, 16); assert.equal(count(t.hub, "wishlist_items"), 0);
  assert.equal(HUB_VERSION, "2.19.1-m16"); assert.equal(API_CONTRACT, 22);
  const before = work(t.hub);
  // Nothing to name yet: one question, nothing written.
  assert.match(one(await ask(t, "Păi ce verifici, fă un wishlist nou"), "wishlist_add").message, /Wishlist-ul există deja/);
  assert.equal(count(t.hub, "wishlist_items"), 0);
  // A request the Hub cannot do, then „trece asta pe un wishlist”: that request is the item, in the owner's words.
  one(await ask(t, "Poți să-mi faci graficul vânzărilor pe trei ani?"), "unknown");
  const added = one(await ask(t, "Ok, trece asta pe un wishlist"), "wishlist_add");
  assert.equal(added.wishlist.item.text, "Poți să-mi faci graficul vânzărilor pe trei ani");
  assert.match(added.message, /^Am trecut pe wishlist: „Poți să-mi faci graficul vânzărilor pe trei ani”/);
  // „asta” is used once; a greeting never becomes „the last request”.
  one(await ask(t, "Salut"), "unknown");
  assert.match(one(await ask(t, "pune-o pe wishlist"), "wishlist_add").message, /^Ce pun pe wishlist\?/);
  // An explicit item; the same words again are not added twice.
  one(await ask(t, "Și mai vreau pe wishlist acest chat cu tine să-l pot minimiza ca să văd harta completă"), "wishlist_add");
  const dup = one(await ask(t, "Pune pe wishlist: acest chat cu tine să-l pot minimiza ca să văd harta completă."), "wishlist_add");
  assert.equal(dup.wishlist.duplicate, true); assert.match(dup.message, /e deja pe wishlist/);
  const list = one(await ask(t, "Ai trecut pe wishlist"), "wishlist_list");
  assert.equal(list.wishlist.open, 2); assert.match(list.message, /^Da\. Pe wishlist sunt 2 idei: 1\) Poți să-mi faci graficul .*; 2\) acest chat cu tine/);
  // The screen: read, mark done, reopen, remove; agent / cli channels refused; a REMOVED item stays in the journal, off the list.
  const read = await t.request("/api/wishlist", { method: "GET" });
  assert.equal(read.status, 200); assert.equal(read.json.items.length, 2);
  const id = read.json.items[0].id;
  assert.equal((await t.request(`/api/wishlist/${id}/status`, { body: { status: "DONE" } })).json.item.status, "DONE");
  assert.equal((await t.request("/api/wishlist?status=OPEN", { method: "GET" })).json.items.length, 1);
  assert.equal((await t.request(`/api/wishlist/${id}/status`, { body: { status: "OPEN" } })).json.item.status, "OPEN");
  assert.equal((await t.request(`/api/wishlist/${id}/status`, { body: { status: "REMOVED" } })).json.item.status, "REMOVED");
  assert.equal((await t.request(`/api/wishlist/${id}/status`, { body: { status: "OPEN" } })).status, 409);
  assert.equal((await t.request(`/api/wishlist/${id}/status`, { body: { status: "MAYBE" } })).status, 400);
  const fromUi = await t.request("/api/wishlist", { body: { text: "Tema albă pentru ecranul L3ga" } });
  assert.equal(fromUi.status, 200, JSON.stringify(fromUi.json)); assert.equal(fromUi.json.item.source, "ui");
  for (const channel of ["agent", "cli"]) assert.equal((await t.request("/api/wishlist", { body: { text: "x y z" }, headers: { "X-Hub-Channel": channel } })).status, 403);
  assert.equal((await t.request("/api/wishlist", { body: { text: "ab" } })).status, 400);
  assert.deepEqual((await t.request("/api/wishlist", { method: "GET" })).json.items.map((x) => x.status), ["OPEN", "OPEN"]);
  assert.equal(t.hub.db.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'wishlist.status'").get().n, 3);
  // The view sentences answer with a view command and the Hub's words; the M16 screen copied with its quotes is understood.
  assert.deepEqual(one(await ask(t, "Poți să o mărești"), "map_view").mapView, { action: "bigger" });
  assert.deepEqual(one(await ask(t, "Ascunde chatul"), "chat_view").chatView, { hidden: true });
  one(await ask(t, "„L3ga, mod comandă"), "command_mode");
  // Nothing started, planned or approved by any of it.
  assert.deepEqual(work(t.hub), before);
});

function consent(hub) {
  hub.bus.transaction(() => hub.settings.set("legaConsent", { version: LEGA_CONSENT_VERSION, confirmedAt: new Date().toISOString() }, "test"));
  hub.refreshCodexConfig();
}
const OFFER = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n";
const script = (list) => `lega-script:${Buffer.from(JSON.stringify(list)).toString("base64url")}`;
const spoken = (t) => t.readLog("codex").filter((l) => l.spoke).map((l) => l.spoke);
const events = (t, type) => t.hub.db.prepare("SELECT * FROM events WHERE type = ? ORDER BY seq").all(type).map((e) => ({ ...e, payload: JSON.parse(e.payload_json || "{}") }));
async function voiceSession(list) {
  // legaTimeScale 0.05: the 45 s stall watchdog fires after 2.25 s, a turn is superseded after 1 s (the idle stop after 6 s).
  const t = await makeTestHub({ codex: script(list), configOverrides: { legaTimeScale: 0.05 } });
  const owner = await enrolOwner(t, { activatePolicy: true });
  await prepareLiveWithoutGrants(t.hub);
  consent(t.hub);
  const s = (await t.hub.commands.dispatch({ type: "lega.session.start", channel: "owner", actor: `owner:${owner.session.id}`, ownerSession: owner.session, payload: { sdp: OFFER } })).result;
  assert.equal(s.authority, "owner_session");
  await t.hub.commands.dispatch({ type: "lega.session.connected", channel: "ui", actor: "user", payload: { sessionId: s.sessionId } });
  return { t, s };
}

test("L3-03 a delegated turn that never answers is interrupted and said in the Hub's words; the session goes on", { timeout: 60000 }, async () => {
  const { t } = await voiceSession([{ sleep: 1200 }, { say: "Cât e cursul euro azi?" }, { hang: true, heard: "Cât e cursul euro azi" }, { sleep: 3200 }, { say: "Ce e pe wishlist?" }, { tool: "hub_actions", heard: "Ce e pe wishlist" }, { sleep: 800 }]);
  try {
    await waitFor(() => t.readLog("codex").some((l) => l.scriptDone), 20000);
    await waitFor(() => spoken(t).includes(TURN_STALL_TEXT), 5000);
    const stalled = events(t, "lega.turn_stalled");
    assert.equal(stalled.length, 1); assert.equal(stalled[0].payload.reason, "timeout"); assert.equal(stalled[0].payload.turnId, "turn_lega_1");
    assert.ok(t.readLog("codex").some((l) => l.method === "turn/interrupt"), "the hung turn was interrupted");
    const done = events(t, "lega.turn_completed").find((e) => e.payload.turnId === "turn_lega_1");
    assert.equal(done.payload.stalled, true); assert.equal(done.payload.spoke, false);
    // The next sentence is answered by the Hub itself (one answer; the agent's text for it is withheld).
    await waitFor(() => spoken(t).some((x) => /^Wishlist-ul e gol/.test(x)), 5000);
    assert.equal(t.hub.lega.state().status, "active", "the session goes on");
  } finally { await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }
});

test("L3-04 a new request supersedes a turn still running without an answer; the wishlist by voice keeps the owner's words", { timeout: 60000 }, async () => {
  const { t } = await voiceSession([{ sleep: 1200 }, { say: "Fă-mi graficul vânzărilor pe trei ani" }, { hang: true, heard: "Fă-mi graficul vânzărilor pe trei ani" }, { sleep: 1400 },
    { say: "Ok, trece asta pe un wishlist" }, { tool: "hub_actions", heard: "Ok, trece asta pe un wishlist" }, { sleep: 800 }]);
  try {
    await waitFor(() => t.readLog("codex").some((l) => l.scriptDone), 20000);
    await waitFor(() => spoken(t).some((x) => /^Am trecut pe wishlist: „Fă-mi graficul vânzărilor pe trei ani”/.test(x)), 5000);
    const stalled = events(t, "lega.turn_stalled");
    assert.equal(stalled.length, 1); assert.equal(stalled[0].payload.reason, "superseded");
    assert.ok(!spoken(t).includes(TURN_STALL_TEXT), "a superseded turn says nothing; the new request gets the answer");
    const items = t.hub.wishlist.list();
    assert.deepEqual(items.map((x) => [x.text, x.source, x.status]), [["Fă-mi graficul vânzărilor pe trei ani", "voice", "OPEN"]]);
    assert.ok(events(t, "lega.answer_withheld").length >= 1, "the agent's answer to the wishlist sentence is withheld");
  } finally { await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }
});

test("L3-05 the watchdog measures silence: a turn that keeps working past the stall time is not interrupted and its answer is spoken", { timeout: 60000 }, async () => {
  const { t } = await voiceSession([{ sleep: 1200 }, { say: "Caută-mi trei furnizori de hârtie" }, { slow: { items: 4, every: 1500 }, heard: "Caută-mi trei furnizori de hârtie" }, { sleep: 600 }]);
  try {
    await waitFor(() => t.readLog("codex").some((l) => l.scriptDone), 20000);
    await waitFor(() => spoken(t).some((x) => /Răspuns lung, dar la timp/.test(x)), 5000);
    assert.equal(events(t, "lega.turn_stalled").length, 0, "6 s of work with a sign every 1.5 s (stall 2.25 s) is never „stalled”");
    assert.ok(!spoken(t).includes(TURN_STALL_TEXT));
    assert.ok(!t.readLog("codex").some((l) => l.method === "turn/interrupt"));
  } finally { await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }
});

test("L3-06 the owner's wishlist is not read or written by an agent or a script; an item may say „nu”", { timeout: 120000 }, async (c) => {
  const t = await acceptanceHub(); c.after(() => t.cleanup());
  for (const channel of ["agent", "cli"]) assert.equal((await t.request("/api/wishlist", { method: "GET", headers: { "X-Hub-Channel": channel } })).status, 403);
  for (const channel of ["agent", "cli"]) {
    for (const text of ["Ce e pe wishlist?", "Pune pe wishlist: export PDF"]) {
      const r = await t.hub.commands.dispatch({ type: "owner.intent", channel, actor: channel, payload: { text } }).then((x) => x.result, (e) => ({ error: e }));
      if (r.error) continue; // the channel may not reach the intake at all
      assert.ok(r.results.every((x) => x.refused && !x.wishlist), JSON.stringify(r.results));
    }
  }
  assert.equal(count(t.hub, "wishlist_items"), 0);
  assert.deepEqual(steps("Pune pe wishlist: nu vreau să mai repet comenzile"), [["wishlist_add", { text: "nu vreau să mai repet comenzile" }]]);
  assert.deepEqual(steps("Hai pune hai pe wishlist"), [["wishlist_add", { text: "hai" }]]);
});

test("L3-07 a provider that ignores the interrupt never keeps the session busy: the idle stop still ends it", { timeout: 60000 }, async () => {
  const { t } = await voiceSession([{ sleep: 1200 }, { say: "Cât e cursul euro azi?" }, { hang: true, ignoreInterrupt: true, heard: "Cât e cursul euro azi" }, { sleep: 200 }]);
  try {
    await waitFor(() => t.readLog("codex").some((l) => l.interruptIgnored), 15000);
    await waitFor(() => events(t, "lega.session.stopped").length > 0, 20000);
    assert.equal(events(t, "lega.session.stopped")[0].payload.reason, "idle");
  } finally { await t.hub.lega.stopAll("test").catch(() => {}); await t.cleanup(); }
});
