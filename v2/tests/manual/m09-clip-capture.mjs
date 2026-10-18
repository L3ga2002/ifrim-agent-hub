// M09 first clip — step 1: CAPTURE (manual tool, not part of the suite).
// A TEST hub with synthetic data (fixture project, fixture providers, software owner session) serves the contract-9 UI build;
// the media department's own Public Demo Mode capture (media.capture.captureBrowserDemo) films the real UI flow:
// request → plan (with the bound models) → ONE confirmation → stages → ready for review. Nothing here touches the live Hub,
// starts a model or records the owner's screen. The recording is labelled SIMULATION (synthetic data, simulated providers).
//   HUB_V2_WEB_DIST=<contract-9 build> node v2/tests/manual/m09-clip-capture.mjs <outDir>
import fs from "node:fs";
import path from "node:path";
import { makeTestHub, enrolOwner, prepareLiveWithoutGrants, waitFor, WEB_DIST } from "../helpers.mjs";
import { realLaunchers } from "../media-helpers.mjs";
import { createHttpServer } from "../../server/http/server.mjs";
import { materializeFixture, demoSpec } from "../../server/factory/fixtures.mjs";
import { SESSION_COOKIE } from "../../server/owner/trust.mjs";

const OUT = path.resolve(process.argv[2] || "m09-clip-work");
fs.mkdirSync(OUT, { recursive: true });
if (!fs.existsSync(path.join(WEB_DIST, "index.html"))) { console.error(`No UI build at ${WEB_DIST}`); process.exit(1); }
const launchers = realLaunchers();
if (!launchers.available) { console.error("ffmpeg/ffprobe absent"); process.exit(1); }

const t = await makeTestHub({ queues: true, configOverrides: { webDist: WEB_DIST, mediaTools: { launcher: launchers } } });
const { server } = createHttpServer(t.hub);
await new Promise((r) => server.listen(t.config.port, "127.0.0.1", r));
const origin = `http://localhost:${t.config.port}`;
const d = (type, payload, extra = {}) => t.hub.commands.dispatch({ type, payload, channel: "test", actor: "owner:test", ...extra }).then((r) => r.result);
try {
  // ---------- synthetic project (the fixture "formular de solicitare" bug), explicit models, owner session ----------
  await prepareLiveWithoutGrants(t.hub);
  const dir = path.join(t.dataDir, "formular-solicitare");
  materializeFixture("bug-demo", dir);
  const project = await d("project.register_test", { path: dir, name: "Formular solicitare (demo)" });
  await d("factory.prepare", { projectId: project.id, ...demoSpec("bug-demo"), limits: { writerModel: "gpt-fake-sol", writerEffort: "medium", reviewerModel: "sonnet", reviewerEffort: "medium" } });
  const owner = await enrolOwner(t);
  t.hub.bus.transaction(() => t.hub.settings.set("mediaPolicy", { ...t.hub.settings.get("mediaPolicy"), diskReserveGb: 0 }, "harness"));
  // The fixture writer + reviewer answer when the owner confirms the plan.
  t.queue("codex", "factory-write:bug-fix");
  t.queue("claude", "review:pass");

  const steps = [
    { goto: `/#/lega/${project.id}` },
    { wait: 1500 },
    { marker: { kind: "hook", note: "cererea către Lega" } },
    { type: { selector: '[aria-label="Mesaj pentru Lega"]', text: "Arată-mi planul înainte să faci ceva", delayMs: 55 } },
    { wait: 400 },
    { press: "Enter" },
    { waitFor: 'role=button[name="Da, execută planul"]' },
    { marker: { kind: "demo", note: "planul afișat" } },
    { wait: 4500 },
    { marker: { kind: "demo", note: "confirmarea" } },
    { click: 'role=button[name="Da, execută planul"]' },
    { wait: 1200 },
    { marker: { kind: "chapter", note: "etapele rulează" } },
    { waitFor: "text=Gata pentru verificare" },
    { marker: { kind: "proof", note: "gata pentru verificare" } },
    { wait: 3500 },
  ];
  let result;
  try {
    result = await t.hub.media.capture.captureBrowserDemo({
      origin, steps, allowOrigin: (o) => o === origin, captureLabel: "SIMULATION", actor: "harness:m09-first-clip",
      viewport: { width: 1440, height: 810 }, deviceScaleFactor: 2, fps: 30, maxDurationMs: 120000, stepTimeoutMs: 60000,
      title: "Demo cockpit: plan → o confirmare → gata pentru verificare (date de test)",
      contextSetup: { cookies: [{ name: SESSION_COOKIE, value: owner.token, path: "/api", httpOnly: true, sameSite: "Strict" }], virtualAuthenticator: true },
    });
  } catch (error) {
    // Diagnostics: where did the flow stop (mission stage, envelope, last commands, runs).
    const f = t.hub.factory.list().find((m) => m.projectId === project.id);
    console.error("CAPTURE FAILED:", error.message);
    console.error("factory:", f && JSON.stringify({ stage: f.stage, reason: f.stageReason, wait: f.waitReason }));
    console.error("envelopes:", JSON.stringify(t.hub.db.prepare("SELECT id, status, close_reason FROM mission_envelopes ORDER BY created_at DESC LIMIT 3").all()));
    console.error("commands:", JSON.stringify(t.hub.db.prepare("SELECT type, channel, status FROM commands ORDER BY created_at DESC LIMIT 12").all()));
    console.error("runs:", JSON.stringify(t.hub.db.prepare("SELECT provider, status FROM agent_runs ORDER BY created_at DESC LIMIT 5").all()));
    throw error;
  }
  const mission = t.hub.factory.list().find((f) => f.projectId === project.id);
  await waitFor(() => ["DELIVERY_READY", "BLOCKED", "NEEDS_OWNER_DECISION"].includes(t.hub.factory.view(mission.missionId).factory.stage), 60000, 200);
  const src = t.hub.media.assets.versionPath(result.version.id);
  fs.copyFileSync(src, path.join(OUT, "capture.mp4"));
  const meta = { capturedAt: new Date().toISOString(), durationMs: result.durationMs, width: result.width, height: result.height, fps: result.fps,
    frames: result.frames, keptFrames: result.keptFrames, markers: result.markers, steps: result.steps, captureLabel: "SIMULATION", origin: "OWNED",
    missionStage: t.hub.factory.view(mission.missionId).factory.stage, sessionId: result.session.id,
    note: "Hub de test cu date sintetice și provideri simulați; nu este Hub-ul live și nu a rulat niciun model." };
  fs.writeFileSync(path.join(OUT, "capture.json"), JSON.stringify(meta, null, 2));
  console.log(JSON.stringify(meta, null, 2));
} finally {
  server.closeAllConnections?.();
  await new Promise((r) => server.close(r));
  await t.cleanup();
}
