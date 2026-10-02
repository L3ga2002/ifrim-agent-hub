// Milestone 06 — the Lega voice agent (GPT-Live through the fake Codex app-server) opens the owner's cockpit of a project
// from anywhere in the Hub ("Lega, hai să lucrăm la …"): it navigates to #/lega/<project> and reads back the project's notes;
// nothing starts and no grant or envelope is created. Fake app-server only: no network, no audio, no model.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeTestHub, enableLive, waitFor } from "./helpers.mjs";
import { LEGA_CONSENT_VERSION, LEGA_SCREENS } from "../server/policy/lega-policy.mjs";

const OFFER = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n";
const dispatch = async (hub, type, payload = {}, channel = "ui") => (await hub.commands.dispatch({ type, payload, actor: channel === "voice" ? "voice" : "user", channel })).result;
const calls = (list) => `lega-calls:${Buffer.from(JSON.stringify(list)).toString("base64url")}`;

test("M06-LV-01 the voice agent opens the project cockpit (context only): navigation to #/lega/<id>, notes read back, nothing started", async () => {
  const t = await makeTestHub({ codex: calls([{ tool: "open_cockpit", args: { project: "Client Site" } }, { tool: "open_cockpit", args: { project: "Nu există" } }, { tool: "navigate", args: { screen: "lega" } }]) });
  try {
    const { hub } = t;
    const dir = path.join(t.dataDir, "client-site");
    fs.mkdirSync(path.join(dir, ".ifrim"), { recursive: true });
    fs.writeFileSync(path.join(dir, "README.md"), "# Client landing\nSite de prezentare.\n");
    fs.writeFileSync(path.join(dir, ".ifrim", "NEXT_SESSION.md"), "- Pagina de contact cu formular validat\n");
    fs.writeFileSync(t.config.registryPath, `# Projects\n\n## Client Site\n- Path: ${dir}\n- Stack: Next.js\n- Status: activ\n`);
    hub.projects.syncFromRegistry();
    const project = hub.projects.list().find((p) => p.name === "Client Site");
    await enableLive(hub, { provider: "codex" });
    hub.bus.transaction(() => hub.settings.set("legaConsent", { version: LEGA_CONSENT_VERSION, confirmedAt: new Date().toISOString() }, "test"));
    hub.bus.transaction(() => hub.grants.create({ provider: "codex", projectId: hub.projects.hub().id, access: "read-only", maxAttempts: 3, maxDurationS: 600, ttlMinutes: 30, kind: "voice" }, "test"));
    const events = []; hub.live.subscribe((e) => events.push(e));
    const runsBefore = hub.db.prepare("SELECT COUNT(*) AS n FROM agent_runs").get().n;
    const s = await dispatch(hub, "lega.session.start", { sdp: OFFER });
    await dispatch(hub, "lega.session.connected", { sessionId: s.sessionId });
    await waitFor(() => t.readLog("codex").some((l) => l.callsDone), 15000);
    const replies = t.readLog("codex").filter((l) => l.toolReply).map((l) => ({ tool: l.tool, ok: l.toolReply.success, text: l.toolReply.contentItems?.[0]?.text || "" }));
    const open = replies.filter((r) => r.tool === "open_cockpit");
    assert.equal(open[0].ok, true, open[0].text);
    assert.match(open[0].text, /cockpitul pentru Client Site \(doar context; nimic nu pornește\)/);
    assert.match(open[0].text, /Pagina de contact/);
    assert.equal(open[1].ok, false, "an unknown project is not guessed");
    const nav = events.filter((e) => e.type === "lega.navigate").map((e) => e.path);
    assert.ok(nav.includes(`/lega/${project.id}`), JSON.stringify(nav));
    assert.ok(nav.includes(LEGA_SCREENS.lega));
    assert.equal(hub.db.prepare("SELECT COUNT(*) AS n FROM agent_runs").get().n, runsBefore, "opening context starts no run");
    assert.equal(hub.db.prepare("SELECT COUNT(*) AS n FROM mission_envelopes").get().n, 0, "and proposes no plan by itself");
    await dispatch(hub, "lega.session.stop", { sessionId: s.sessionId });
  } finally { await t.cleanup(); }
});
