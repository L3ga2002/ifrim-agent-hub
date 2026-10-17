// Stage before M12 — what Lega knows about the system: questions about apps, accounts, locations, Codex, Claude and blockers are ONE
// read intent answered from the Hub's real state (owner/knowledge.mjs), the same for typed text and voice; nothing runs.
import test from "node:test";
import assert from "node:assert/strict";
import { makeTestHub, enrolOwner } from "./helpers.mjs";
import { resolveIntent } from "../server/owner/intents.mjs";
import { knowledgeTopic, parseUninstall, KNOWLEDGE_TOPICS } from "../server/owner/knowledge.mjs";
import { legaDynamicTools } from "../server/policy/lega-policy.mjs";

const ctx = { projects: [], missions: [], departments: [], pendingEnvelopes: [], source: "typed" };

test("KN-01 natural questions about the system resolve to ONE read intent with the right topic; status, stop and work requests keep theirs", () => {
  const cases = [
    ["Ce aplicații poți folosi?", "apps"], ["ce ai instalat pe calculator", "apps"], ["Ce modele am?", "accounts"], ["Ce știi să faci?", "capabilities"],
    ["Unde ai salvat documentul Word?", "locations"], ["Unde găsesc clipurile?", "locations"], ["Ce a făcut Codex?", "codex"], ["Ce a găsit Claude?", "claude"], ["Ce e blocat?", "blocked"],
  ];
  for (const [text, topic] of cases) {
    const r = resolveIntent(text, ctx);
    assert.deepEqual(r.steps.map((s) => s.intent), ["system_knowledge"], text);
    assert.equal(r.steps[0].args.topic, topic, text);
    assert.equal(r.steps[0].effect, "read");
  }
  assert.equal(resolveIntent("Ce face Codex acum?", ctx).steps[0].intent, "status");
  assert.equal(resolveIntent("Oprește tot", ctx).steps[0].intent, "stop_all");
  assert.equal(resolveIntent("Deschide Notepad", ctx).steps[0].intent, "desktop_open");
  assert.equal(knowledgeTopic("vreau o pizza"), null);
  for (const t of KNOWLEDGE_TOPICS) assert.ok(typeof t === "string");
});

test("KN-02 the inventory parser keeps named applications and drops system components and updates", () => {
  const out = ["HKEY_LOCAL_MACHINE\\SOFTWARE\\X\\Uninstall\\A", "    DisplayName    REG_SZ    OBS Studio", "    DisplayVersion    REG_SZ    32.2.2", "    Publisher    REG_SZ    OBS Project",
    "HKEY_LOCAL_MACHINE\\SOFTWARE\\X\\Uninstall\\B", "    DisplayName    REG_SZ    KB5030219", "HKEY_LOCAL_MACHINE\\SOFTWARE\\X\\Uninstall\\C", "    DisplayName    REG_SZ    Hidden", "    SystemComponent    REG_DWORD    0x1"].join("\r\n");
  const apps = [...parseUninstall(out).values()];
  assert.deepEqual(apps.map((a) => a.name), ["OBS Studio"]);
  assert.equal(apps[0].version, "32.2.2");
});

test("KN-03 the typed question gets the answer from the Hub's state (projects, screens), proposes nothing, and Lega has the same read as a tool", async () => {
  const t = await makeTestHub({});
  try {
    const owner = await enrolOwner(t);
    const before = t.hub.db.prepare("SELECT COUNT(*) AS n FROM ops_plans").get().n + t.hub.db.prepare("SELECT COUNT(*) AS n FROM mission_envelopes").get().n;
    const out = (await t.hub.commands.dispatch({ type: "owner.intent", payload: { text: "Ce e blocat?" }, channel: "owner", actor: `owner:${owner.session.id}`, ownerSession: owner.session })).result;
    const text = JSON.stringify(out);
    assert.match(text, /blocat|Nimic nu e blocat/i, text.slice(0, 400));
    const loc = await t.hub.knowledge.snapshot("locations");
    assert.ok(Array.isArray(loc.locations.projects) && loc.locations.projects.length >= 1, "the Hub's own projects are listed with their paths");
    assert.equal(loc.locations.screens.decizii, "#/livrare/decizii");
    const active = await t.hub.knowledge.answer("active");
    assert.match(active.text, /^Acum /);
    const after = t.hub.db.prepare("SELECT COUNT(*) AS n FROM ops_plans").get().n + t.hub.db.prepare("SELECT COUNT(*) AS n FROM mission_envelopes").get().n;
    assert.equal(after, before, "a question proposes nothing");
    const tools = legaDynamicTools({ voiceFirst: true })[0].tools.map((x) => x.name);
    assert.ok(tools.includes("system_knowledge"));
    assert.ok(!legaDynamicTools({ voiceFirst: false })[0].tools.map((x) => x.name).includes("system_knowledge"), "legacy sessions keep their tool list");
  } finally { await t.cleanup(); }
});
