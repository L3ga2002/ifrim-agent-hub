// M09 first clip — step 2: PRODUCE (manual tool, not part of the suite).
// Takes the step-1 capture (a TEST hub filmed by the department's own Public Demo Mode capture) and runs the whole production
// through the M09 services on a test hub: content project (brief / script / storyboard / claims with evidence, authored in the
// development session and labelled so), library import + rights, EditProjectIR, local renders (real ffmpeg), QA, one timecode
// correction (before/after, original kept), three native platform variants, a controlled render interruption + recovery, and
// the exports (OTIO / EDL / CapCut assisted pack / on-screen text SRT). Deliverables are copied to the output folder.
// No model, no upload, no publication, no live Hub, no owner approval is fabricated (the manifest stays DRAFT).
//   node v2/tests/manual/m09-clip-produce.mjs <captureDir> <deliveryDir>
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { makeTestHub, waitFor } from "../helpers.mjs";
import { realLaunchers, realTool, probeJson } from "../media-helpers.mjs";
import { toSrt } from "../../server/media/captions.mjs";
import { insertEditVersion } from "../../server/media/review.mjs";

const CAP = path.resolve(process.argv[2] || "m09-clip-work");
const OUT = path.resolve(process.argv[3] || path.join(CAP, "delivery"));
fs.mkdirSync(OUT, { recursive: true });
const capture = JSON.parse(fs.readFileSync(path.join(CAP, "capture.json"), "utf8"));
const launchers = realLaunchers();
if (!launchers.available) { console.error("ffmpeg/ffprobe absent"); process.exit(1); }
const FPS = 30;
const fr = (ms) => Math.round((ms * FPS) / 1000);
const marker = (kind, nth = 0) => capture.markers.filter((m) => m.kind === kind)[nth]?.atMs;
const log = (...a) => console.log("[clip]", ...a);
const AUTHOR = "Claude (sesiunea de dezvoltare M09)";

const t = await makeTestHub({ configOverrides: { mediaTools: { launcher: launchers } } });
const { media } = t.hub;
const d = (type, payload) => t.hub.commands.dispatch({ type, payload, channel: "test", actor: "owner:test" }).then((r) => r.result);
const report = { startedAt: new Date().toISOString(), steps: [] };
const step = (name, data) => { report.steps.push({ name, at: new Date().toISOString(), ...data }); log(name, JSON.stringify(data).slice(0, 400)); };
try {
  // ---------- inputs: the capture + a brand end card (generated graphic, OWNED) ----------
  const inbox = path.join(CAP, "inbox");
  fs.mkdirSync(inbox, { recursive: true });
  // The inbox copy of a previous run may be read-only: it is a working copy (the capture itself stays in CAP), so it is replaced.
  const inboxCapture = path.join(inbox, "capture.mp4");
  if (fs.existsSync(inboxCapture)) { fs.chmodSync(inboxCapture, 0o644); fs.rmSync(inboxCapture); }
  fs.copyFileSync(path.join(CAP, "capture.mp4"), inboxCapture);
  execFileSync(realTool("ffmpeg"), ["-hide_banner", "-nostdin", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=0x0B0D10:s=1920x1080:d=1",
    "-vf", "format=rgb24,geq=r='11+30*exp(-((X-W/2)*(X-W/2)+(Y-H*0.45)*(Y-H*0.45))/(2*(W*0.26)*(W*0.26)))':g='13+36*exp(-((X-W/2)*(X-W/2)+(Y-H*0.45)*(Y-H*0.45))/(2*(W*0.26)*(W*0.26)))':b='16+44*exp(-((X-W/2)*(X-W/2)+(Y-H*0.45)*(Y-H*0.45))/(2*(W*0.26)*(W*0.26)))',drawbox=x=iw*0.3:y=ih*0.62:w=iw*0.4:h=2:color=0x2FD3B5@0.85:t=fill", "-frames:v", "1", path.join(inbox, "end-card.png")], { stdio: "ignore" });
  t.hub.bus.transaction(() => t.hub.settings.set("mediaPolicy", { ...t.hub.settings.get("mediaPolicy"), importRoots: [inbox], diskReserveGb: 0, interactivePriority: false }, "harness"));

  // ---------- content project, brief, claims, script, storyboard (dev-session authored, never "owner") ----------
  const project = media.content.createProject({ title: "Un plan. O singură confirmare.", format: "short", platforms: ["youtube", "instagram", "linkedin", "x"], audience: "business" }, "harness");
  const projectId = project.id || project.project?.id;
  media.content.saveBrief(projectId, { authorKind: "dev_session", author: AUTHOR, body: {
    objective: "Arăt, pe UI-ul real al Hub-ului, că agentul nu pornește nimic până nu îți arată planul și că o singură confirmare pornește lucrul în limite stricte.",
    audience: "business",
    angles: {
      business: "Pentru un client: AI care lucrează fără surprize — vezi planul, limitele și costul înainte, confirmi o dată, iar rezultatul te așteaptă pe tine.",
      technical: "Pentru tehnicieni: planul exact (envelope) cu modele fixate, granturi derivate intern, etape izolate, revenire la BUILD_SAFE, nimic acceptat automat.",
    },
    keyMessage: "Planul întâi. O singură confirmare. Nimic nu se acceptă în locul tău.",
    cta: "Ifrim Digital — automatizări cu control.", format: "short 16:9 + variante native", durationTargetS: 26,
    platforms: ["youtube", "instagram", "linkedin", "x"],
    constraints: ["Doar UI real, filmat pe un Hub de test cu date sintetice; etichetă vizibilă", "Fără voce sintetică și fără muzică nelicențiată", "Timpul comprimat e marcat pe ecran"],
    mustAvoid: ["Pilotul ProDelivery (neacceptat)", "Promisiuni de ROI", "„23 de agenți lucrează simultan”"],
    references: [{ kind: "test", ref: "v2/tests/m06-ui-e2e.test.mjs#M06-UI-E2E-01" }, { kind: "test", ref: "v2/tests/m09-model-binding.test.mjs" }],
  } });
  const claim = (text, evidence, note) => media.content.saveClaim(projectId, { text, evidence, shot: { note }, conditions: "Demonstrație pe date de test cu provideri simulați", status: "SUPPORTED" }, "harness");
  const cl = {
    noStart: claim("Agentul nu pornește nimic până nu îți arată planul.", [{ kind: "test", ref: "v2/tests/m06-ui-e2e.test.mjs#M06-UI-E2E-01 (0 rulări și 0 granturi după afișarea planului)" }, { kind: "snapshot", ref: `capture:${capture.sessionId}@${marker("demo", 0)}ms` }], "răspunsul Lega: nimic nu a pornit"),
    plan: claim("Planul arată unde lucrează, ce nu face niciodată, limitele și modelele exacte.", [{ kind: "test", ref: "v2/tests/m09-model-binding.test.mjs (modelele din plan = modelele trimise)" }, { kind: "snapshot", ref: `capture:${capture.sessionId}@${marker("demo", 0) + 1500}ms` }], "cardul „Arată-mi înainte să faci”"),
    oneConfirm: claim("O singură confirmare pornește lucrul.", [{ kind: "test", ref: "v2/tests/m06-ui-e2e.test.mjs#M06-UI-E2E-01 (doar envelope.confirm, fără formulare de granturi)" }], "butonul „Da, execută planul”"),
    limits: claim("Lucrul rulează în limitele aprobate și Hub-ul revine apoi la BUILD_SAFE.", [{ kind: "test", ref: "v2/tests/m06-envelopes.test.mjs" }, { kind: "snapshot", ref: `capture:${capture.sessionId}@${marker("proof", 0)}ms` }], "chip LIVE_VALIDATION → BUILD_SAFE"),
    backup: claim("Înainte de lucru se face un backup verificat.", [{ kind: "document", ref: "v2/server/runtime/runs.mjs (backup înainte de pornirea modelului)" }, { kind: "snapshot", ref: `capture:${capture.sessionId}@${marker("proof", 0) + 800}ms` }], "notificarea „Backup verificat”"),
    noAccept: claim("Nimic nu se acceptă în locul tău.", [{ kind: "document", ref: "v2/server/factory/factory.mjs accept() (doar proprietarul)" }, { kind: "snapshot", ref: `capture:${capture.sessionId}@${marker("proof", 0)}ms` }], "„nimic nu e acceptat sau livrat automat”"),
  };
  const cid = (c) => c.id || c.claim?.id;
  step("claims", { count: Object.keys(cl).length, ids: Object.values(cl).map(cid) });

  // ---------- library: import + rights ----------
  const cap = await d("media.asset.import", { sourcePath: path.join(inbox, "capture.mp4"), title: "Demo cockpit (Hub de test, date sintetice)", category: "screen_recording",
    origin: "OWNED", captureLabel: "SIMULATION", contentProjectId: projectId, description: capture.note, tags: ["demo", "cockpit", "plan", "simulare"] });
  const card = await d("media.asset.import", { sourcePath: path.join(inbox, "end-card.png"), title: "Card final grafit (generat local)", category: "brand", origin: "OWNED", contentProjectId: projectId });
  for (const a of [cap, card]) await d("media.rights.record", { right: { assetId: a.asset.id, status: "CLEARED_FOR_SCOPE", holder: "Ifrim Digital", platforms: ["*"], uses: ["organic"], sourceKind: "manual", sourceRef: "material propriu (captură UI de test / grafic generat local)" } });
  step("library", { capture: cap.version.id, endCard: card.version.id, probe: { w: cap.version.probe?.video?.width, h: cap.version.probe?.video?.height, ms: cap.version.probe?.durationMs } });

  // ---------- the edit plan (frames at 30 fps, from the capture markers) ----------
  const hook = marker("hook"); const planAt = marker("demo", 0); const confirmAt = marker("demo", 1); const proofAt = marker("proof");
  const end = capture.durationMs - 120;
  const V = cap.version.id; const E = card.version.id;
  const clipsSpec = [
    { id: "c1", in: fr(hook - 1000), out: fr(hook + 2000), kf: [[1, 0.5, 0.5], [1.08, 0.45, 0.55]], focus: { x: 0.07, y: 0.15, w: 0.28, h: 0.78 }, shot: "s1" },
    { id: "c2", in: fr(hook + 2000), out: fr(planAt + 600), kf: [[1.7, 0.2, 0.82], [1.9, 0.2, 0.8]], focus: { x: 0.07, y: 0.7, w: 0.28, h: 0.2 }, shot: "s2", tr: 8 },
    { id: "c3", in: fr(planAt + 600), out: fr(confirmAt - 100), kf: [[1.3, 0.66, 0.5], [1.7, 0.63, 0.45]], focus: { x: 0.35, y: 0.2, w: 0.63, h: 0.65 }, shot: "s3", tr: 8 },
    { id: "c4", in: fr(confirmAt - 400), out: fr(confirmAt + 1200), kf: [[1.9, 0.43, 0.74], [2.1, 0.43, 0.74]], focus: { x: 0.35, y: 0.68, w: 0.2, h: 0.1 }, shot: "s4", tr: 6 },
    { id: "c5", in: fr(confirmAt + 1200), out: fr(confirmAt + 7200), speed: 1.5, kf: [[1, 0.5, 0.5], [1.12, 0.62, 0.35]], focus: { x: 0.35, y: 0.02, w: 0.63, h: 0.32 }, shot: "s5", tr: 8 },
    { id: "c6", hold: true, in: fr(proofAt - 8000), out: fr(proofAt), speed: 4, kf: [[1.12, 0.62, 0.35], [1.12, 0.62, 0.35]], focus: { x: 0.35, y: 0.02, w: 0.63, h: 0.32 }, shot: "s5", tr: 6 },
    { id: "c7", in: fr(proofAt), out: fr(end), kf: [[1, 0.5, 0.5], [1.3, 0.45, 0.45]], focus: { x: 0.25, y: 0.08, w: 0.7, h: 0.7 }, shot: "s6", tr: 8 },
    { id: "c8", in: fr(proofAt + 500), out: fr(proofAt + 3500), kf: [[2.1, 0.82, 0.9], [2.2, 0.82, 0.9]], focus: { x: 0.72, y: 0.82, w: 0.27, h: 0.16 }, shot: "s7", tr: 8 },
  ];
  const clips = []; let cursor = 0;
  for (const s of clipsSpec) {
    const dur = Math.round((s.out - s.in) / (s.speed || 1));
    const start = clips.length ? cursor - (s.tr || 0) : 0;
    clips.push({ id: s.id, assetVersionId: V, sourceIn: s.in, sourceOut: s.out, start, speed: s.speed || 1, fit: "cover", crop: { x: 0, y: 0, w: 1, h: 1 },
      keyframes: [{ frame: 0, scale: s.kf[0][0], cx: s.kf[0][1], cy: s.kf[0][2] }, { frame: dur - 1, scale: s.kf[1][0], cx: s.kf[1][1], cy: s.kf[1][2], ease: "inOut" }],
      ...(s.tr ? { transitionIn: { kind: "crossfade", frames: s.tr } } : {}), focus: s.focus, shotId: s.shot, label: "SIMULATION", color: { preset: "crisp" }, ...(s.hold ? { holdIntentional: true } : {}) });
    cursor = start + dur;
  }
  const cardStart = cursor - 12;
  clips.push({ id: "c9", assetVersionId: E, sourceIn: 0, sourceOut: 120, start: cardStart, speed: 1, fit: "cover", crop: { x: 0, y: 0, w: 1, h: 1 },
    transitionIn: { kind: "fade", frames: 12 }, focus: { x: 0.2, y: 0.3, w: 0.6, h: 0.4 }, shotId: "s8", holdIntentional: true });
  const total = cardStart + 120;
  const at = (id) => clips.find((c) => c.id === id);
  const span = (id) => [at(id).start, at(id).start + Math.round((at(id).sourceOut - at(id).sourceIn) / at(id).speed)];
  const steps = [
    ["x1", 0, span("c2")[0], "Agentul nu pornește nimic fără planul tău.", "hook"],
    ["x2", span("c2")[0], span("c3")[0], "1 · Îi spui ce vrei.", "lower_third"],
    ["x3", span("c3")[0], span("c4")[0], "2 · Îți arată planul exact.", "lower_third"],
    ["x4", span("c4")[0], span("c5")[0], "3 · O singură confirmare.", "lower_third"],
    ["x5", span("c5")[0], span("c7")[0], "4 · Lucrează doar în limitele aprobate.", "lower_third"],
    ["x6", span("c7")[0], span("c8")[0], "5 · Gata pentru verificarea ta.", "lower_third"],
    ["x7", span("c8")[0], cardStart, "Nimic nu se acceptă în locul tău.", "lower_third"],
  ];
  const ir = {
    irVersion: 1, fps: { num: FPS, den: 1 }, canvas: { width: 1920, height: 1080, background: "#0B0D10" }, preset: { id: "ifrim-tech", version: 1 }, language: "ro",
    tracks: [
      { id: "v1", kind: "video", clips },
      { id: "lbl", kind: "text", items: [{ id: "l1", start: 0, end: cardStart + 12, text: "SIMULARE · Hub de test cu date sintetice", style: "label", anchor: "top", x: 0.5, y: 0.06, maxWidth: 0.8, animation: "none" }] },
      { id: "txt", kind: "text", items: steps.map(([id, s, e, text, style]) => ({ id, start: s, end: e, text, style, anchor: id === "x7" ? "top" : "bottom", x: 0.5, y: id === "x7" ? 0.16 : 0.9, maxWidth: 0.82, animation: "fade" })) },
      { id: "spd", kind: "text", items: [
        { id: "s1", start: span("c5")[0], end: span("c6")[0], text: "Accelerat ×1,5", style: "label", anchor: "top", x: 0.5, y: 0.105, maxWidth: 0.4, animation: "none" },
        { id: "s2", start: span("c6")[0], end: span("c7")[0], text: "Accelerat ×4", style: "label", anchor: "top", x: 0.5, y: 0.105, maxWidth: 0.4, animation: "none" }] },
      { id: "cta", kind: "text", items: [{ id: "k1", start: cardStart + 6, end: total, text: "Ifrim Digital", style: "hook", anchor: "center", x: 0.5, y: 0.46, maxWidth: 0.8, animation: "fade" }] },
      { id: "cta2", kind: "text", items: [{ id: "k2", start: cardStart + 14, end: total, text: "Automatizare cu control: planul întâi, apoi lucrul.", style: "body", anchor: "top", x: 0.5, y: 0.66, maxWidth: 0.8, animation: "fade" }] },
    ],
    markers: [{ frame: 0, kind: "hook", note: "cererea" }, { frame: 15, kind: "demo", note: "cockpit-ul real (date de test)" }, { frame: span("c3")[0], kind: "evidence", note: "planul" }, { frame: span("c4")[0], kind: "beat", note: "confirmarea" },
      { frame: span("c7")[0], kind: "evidence", note: "rezultatul" }, { frame: cardStart, kind: "cta", note: "final" }],
    evidenceRegions: [
      { clipId: "c3", from: span("c3")[0], to: span("c3")[1] - 1, rect: { x: 0.36, y: 0.4, w: 0.6, h: 0.08 }, claimId: cid(cl.plan) },
      { clipId: "c7", from: span("c7")[0], to: span("c7")[1] - 1, rect: { x: 0.27, y: 0.1, w: 0.12, h: 0.04 }, claimId: cid(cl.noAccept) },
    ],
    loudness: { targetLufs: -14, maxTruePeakDb: -1 },
    meta: { title: "Un plan. O singură confirmare.", labels: ["SIMULATION"], author: AUTHOR, notes: "Fără voce (nu există o voce autorizată) și fără muzică (nicio piesă licențiată); textul pe ecran poartă povestea." },
  };
  const edit = await d("media.edit.create", { contentProjectId: projectId, title: "Un plan. O singură confirmare. — master 16:9", ir });
  const v1 = edit.version.id;
  step("edit", { version: v1, frames: total, seconds: +(total / FPS).toFixed(2), clips: clips.length });

  // ---------- storyboard + script (versioned, dev-session) ----------
  media.content.saveScript(projectId, { language: "ro", title: "Un plan. O singură confirmare.", authorKind: "dev_session", author: AUTHOR, notes: "Fără voce; textul pe ecran e scenariul.",
    segments: steps.map(([id, , , text]) => ({ id, vo: "", onScreen: text, captions: text })).concat([{ id: "k1", vo: "", onScreen: "Ifrim Digital · Automatizare cu control: planul întâi, apoi lucrul.", captions: "" }]) });
  media.content.saveStoryboard(projectId, { authorKind: "dev_session", author: AUTHOR, notes: "Cadre din captura demo (date de test), încadrări pe dovadă.",
    shots: clipsSpec.map((s) => ({ id: s.id, purpose: { c1: "cererea către Lega", c2: "cererea scrisă și răspunsul „nimic nu a pornit”", c3: "planul exact cu modele și limite", c4: "confirmarea unică",
      c5: "lucrul în execuție (LIVE_VALIDATION)", c6: "execuția, comprimată", c7: "gata pentru verificare, BUILD_SAFE", c8: "backup verificat, execuție terminată" }[s.id],
      source: { kind: "asset", assetVersionId: cap.version.id, description: "captura demo a cockpit-ului (Hub de test, date sintetice)" }, interval: { fromMs: Math.round((s.in * 1000) / FPS), toMs: Math.round((s.out * 1000) / FPS) }, durationMs: Math.round(((s.out - s.in) / (s.speed || 1)) * 1000 / FPS),
      framing: "zoom pe dovadă", motion: "push-in lent", overlays: [], audio: "fără", acceptance: "textul UI e lizibil și dovada nu e acoperită" })) });

  // ---------- render draft → QA ----------
  const render = async (versionId, profile) => {
    const job = await d("media.render.request", { editVersionId: versionId, profile });
    await waitFor(() => ["DONE", "FAILED", "CANCELLED"].includes(media.render.get(job.id)?.status), 600000, 300);
    const j = media.render.get(job.id);
    if (j.status !== "DONE") throw new Error(`render ${profile} ${versionId}: ${j.status} ${JSON.stringify(j.error)}`);
    return j;
  };
  const t0 = Date.now();
  const draft = await render(v1, "draft");
  step("render.draft", { job: draft.id, ms: Date.now() - t0, segments: draft.segments?.length });
  const qaRun = async (versionId, assetVersionId, platform) => {
    const r = await d("media.qa.run", { editVersionId: versionId, assetVersionId, platform });
    const findings = Object.values(r.reports || {}).flatMap((x) => (x?.findings || []).map((f) => ({ kind: x.kind, severity: f.severity, code: f.code, justified: f.justified || false, message: String(f.message || "").slice(0, 160), at: f.range || f.frame || null })));
    return { status: r.status, kinds: Object.fromEntries(Object.entries(r.reports || {}).map(([k, x]) => [k, x?.status])), findings };
  };
  const qaDraft = await qaRun(v1, draft.outputAssetVersionId);
  step("qa.draft", { status: qaDraft.status, kinds: qaDraft.kinds, findings: qaDraft.findings.filter((f) => f.severity !== "info").slice(0, 25) });
  report.qaDraft = qaDraft;
  fs.writeFileSync(path.join(CAP, "produce-report.json"), JSON.stringify(report, null, 2));
  if (process.env.STOP_AFTER_DRAFT === "1") { log("STOP_AFTER_DRAFT"); fs.copyFileSync(media.assets.versionPath(draft.outputAssetVersionId), path.join(OUT, "draft_master.mp4")); process.exit(0); }

  // ---------- final master ----------
  const t1 = Date.now();
  const final = await render(v1, "final");
  step("render.final", { job: final.id, ms: Date.now() - t1 });
  const qaFinal = await qaRun(v1, final.outputAssetVersionId, "youtube_16x9");
  step("qa.final", { status: qaFinal.status, kinds: qaFinal.kinds });
  report.qaFinal = qaFinal;

  // ---------- one timecode correction: original kept, dependencies re-rendered ----------
  const atMs = Math.round(((span("c5")[0] + 30) * 1000) / FPS);
  const proposed = await d("media.edit.patch.propose", { editVersionId: v1, timecodeMs: atMs, text: `la secunda ${(atMs / 1000).toFixed(1).replace(".", ",")} mută textul «4 · Lucrează doar în limitele aprobate.» mai sus și ține demonstrația mai mult` });
  step("review.proposed", { review: proposed.id || proposed.review?.id, ops: (proposed.patch?.ops || proposed.ops || proposed.review?.patch?.ops || []).map((o) => o.op), diff: proposed.diff?.summary || proposed.review?.patch?.diff?.summary || null });
  const reviewId = proposed.id || proposed.review?.id;
  const applied = await d("media.edit.patch.apply", { reviewId });
  const v2 = applied.version.id;
  step("review.applied", { version: v2, diff: applied.diff?.summary || null, durationDelta: applied.diff?.durationMs ?? null, originalKept: Boolean(media.edits.getVersion(v1)) });
  const t2 = Date.now();
  const draft2 = await render(v2, "draft");
  const cacheHits = draft2.progress?.cacheHits ?? null; const cacheMisses = draft2.progress?.cacheMisses ?? null;
  step("render.after_patch", { job: draft2.id, ms: Date.now() - t2, segments: draft2.segments?.length, cacheHits, cacheMisses, firstDraftCache: { hits: draft.progress?.cacheHits ?? null, misses: draft.progress?.cacheMisses ?? null } });
  const final2 = await render(v2, "final");

  // ---------- three native variants (reframed around the evidence, own hook / CTA) ----------
  const variantDefs = [
    ["reels_9x16", { hookText: "Nimic nu pornește fără planul tău." }],
    ["linkedin_4x5", { hookText: "AI care lucrează fără surprize." }],
    ["x_1x1", { hookText: "Planul întâi. Apoi lucrul." }],
  ];
  const variants = [];
  for (const [platformKey, overrides] of variantDefs) {
    const v = await d("media.variant.derive", { masterVersionId: v1, platformKey, overrides });
    let renderVersionId = v.version.id;
    if (platformKey.endsWith("9x16")) {
      const vir = structuredClone(media.edits.getVersion(v.version.id).ir);
      for (const tr of vir.tracks) {
        if (tr.id === "txt") for (const it of tr.items) if (it.style === "lower_third") Object.assign(it, { anchor: "top", x: 0.46, y: 0.195, maxWidth: 0.78 });
        if (tr.id === "txt") for (const it of tr.items) if (it.style === "hook") Object.assign(it, { anchor: "top", x: 0.46, y: 0.2, maxWidth: 0.78 });
        if (tr.id === "spd") for (const it of tr.items) Object.assign(it, { anchor: "top", x: 0.46, y: 0.148, maxWidth: 0.6 });
        if (tr.id === "lbl") for (const it of tr.items) Object.assign(it, { anchor: "bottom", x: 0.46, y: 0.772, maxWidth: 0.78 });
      }
      const check = media.edits.validate(vir);
      if (!check.ok) throw new Error("vertical adjustment invalid: " + JSON.stringify(check.errors.slice(0, 3)));
      const adjusted = insertEditVersion(t.hub.db, t.hub.bus, () => new Date(), { editProjectId: media.edits.getVersion(v.version.id).editProjectId, parentVersionId: v.version.id, ir: check.ir || vir,
        changeKind: "variant", variantKey: platformKey, change: { reason: "ajustare editorială verticală: titlul pasului în zona liberă de sus, eticheta de viteză sub eticheta de simulare" }, validation: { ok: true }, actor: "harness:dev-session" });
      renderVersionId = adjusted.id;
      // The variant now points at the adjusted version (the derived one stays in history), with an audit event.
      t.hub.bus.transaction(() => {
        t.hub.db.prepare("UPDATE media_variants SET variant_version_id = ?, updated_at = ? WHERE id = ?").run(adjusted.id, new Date().toISOString(), v.variant.id);
        t.hub.bus.append({ type: "media.variant.adjusted", scopeType: "media_variant", scopeId: v.variant.id, source: "harness:dev-session", payload: { from: v.version.id, to: adjusted.id, reason: "ajustare verticală" } });
      });
    }
    if (!platformKey.endsWith("9x16")) {
      const vir = structuredClone(media.edits.getVersion(v.version.id).ir);
      const lbl = vir.tracks.find((tr) => tr.id === "lbl")?.items[0];
      for (const tr of vir.tracks) if (tr.id === "spd") for (const it of tr.items) Object.assign(it, { anchor: "top", y: +((lbl?.y ?? 0.06) + 0.09).toFixed(3) });
      const check = media.edits.validate(vir);
      if (!check.ok) throw new Error("square adjustment invalid: " + JSON.stringify(check.errors.slice(0, 3)));
      const adjusted = insertEditVersion(t.hub.db, t.hub.bus, () => new Date(), { editProjectId: media.edits.getVersion(v.version.id).editProjectId, parentVersionId: v.version.id, ir: check.ir || vir,
        changeKind: "variant", variantKey: platformKey, change: { reason: "eticheta de viteză sub eticheta de simulare" }, validation: { ok: true }, actor: "harness:dev-session" });
      renderVersionId = adjusted.id;
      t.hub.bus.transaction(() => { t.hub.db.prepare("UPDATE media_variants SET variant_version_id = ?, updated_at = ? WHERE id = ?").run(adjusted.id, new Date().toISOString(), v.variant.id);
        t.hub.bus.append({ type: "media.variant.adjusted", scopeType: "media_variant", scopeId: v.variant.id, source: "harness:dev-session", payload: { from: v.version.id, to: adjusted.id, reason: "etichete" } }); });
    }
    const job = await render(renderVersionId, "final");
    const qa = await qaRun(renderVersionId, job.outputAssetVersionId, platformKey);
    variants.push({ platformKey, variantId: v.variant?.id, versionId: renderVersionId, derivedVersionId: v.version.id, job: job.id, asset: job.outputAssetVersionId, changes: (v.changes || []).length, findings: (v.findings || []).length, qa: qa.status, qaKinds: qa.kinds });
    report[`qa_${platformKey}`] = qa;
  }
  step("variants", { variants });

  // ---------- controlled interruption + recovery (no raw lost, nothing published) ----------
  const big = await d("media.render.request", { editVersionId: variants[0].versionId, profile: "draft" });
  await waitFor(() => ["RUNNING", "DONE"].includes(media.render.get(big.id)?.status), 60000, 50).catch(() => {});
  const cancelled = await d("media.render.cancel", { jobId: big.id });
  await waitFor(() => ["CANCELLED", "DONE"].includes(media.render.get(big.id)?.status), 60000, 100);
  const retry = await d("media.render.retry", { jobId: big.id });
  await waitFor(() => ["DONE", "FAILED"].includes(media.render.get(retry.id)?.status), 600000, 300);
  step("recovery", { cancelledStatus: media.render.get(big.id).status, retryStatus: media.render.get(retry.id).status, rawStillReady: media.assets.getVersion(V).status, cancelChanged: cancelled?.changed ?? null });

  // ---------- exports ----------
  const otio = await d("media.export.otio", { editVersionId: v1 });
  const edl = await d("media.export.edl", { editVersionId: v1 });
  const pack = await d("media.export.capcut_pack", { editVersionId: v1 });
  const explain = media.editors.explainEdit(media.edits.getVersion(v1).ir, {});
  // On-screen text as an SRT sidecar (accessibility / silent autoplay); there is no spoken audio to caption.
  const textCues = ir.tracks.filter((tr) => tr.kind === "text" && tr.id === "txt").flatMap((tr) => tr.items).map((it) => ({ id: it.id, start: it.start, end: it.end, text: it.text }));
  const srt = toSrt(textCues, ir.fps);
  // Manifest (DRAFT): the exact package for the owner's later decision in the live Hub; not approved here.
  let manifest = null;
  try {
    manifest = await d("content.manifest.build", { contentProjectId: projectId, variants: variants.map((v) => ({ variantId: v.variantId, platform: { reels_9x16: "instagram", linkedin_4x5: "linkedin", x_1x1: "x" }[v.platformKey],
      account: "contul tău (de ales)", caption: "Agentul nu pornește nimic până nu îți arată planul. Demonstrație pe date de test.", timezone: "Europe/Bucharest", disclosure: { aiGenerated: false, paidPartnership: false, text: "Demonstrație pe date de test" } })) });
  } catch (error) { manifest = { error: error.message }; }
  step("exports", { otio: otio.relPath || otio.id, edl: edl.relPath || edl.id, capcutComplete: pack.complete, manifest: manifest?.id || manifest?.manifest?.id || manifest?.error });

  // ---------- deliverables ----------
  const copy = (versionId, name) => { const src = media.assets.versionPath(versionId); const dst = path.join(OUT, name); fs.copyFileSync(src, dst); fs.chmodSync(dst, 0o644); return dst; };
  const files = {
    master: copy(final.outputAssetVersionId, "01_master_16x9_youtube.mp4"),
    reels: copy(variants[0].asset, "02_reels_9x16.mp4"),
    linkedin: copy(variants[1].asset, "03_linkedin_4x5.mp4"),
    x: copy(variants[2].asset, "04_x_1x1.mp4"),
    afterPatch: copy(final2.outputAssetVersionId, "05_master_dupa_corectura.mp4"),
  };
  const ff = realTool("ffmpeg");
  const still = (src, sec, name) => execFileSync(ff, ["-hide_banner", "-nostdin", "-y", "-loglevel", "error", "-ss", String(sec), "-i", src, "-frames:v", "1", path.join(OUT, name)], { stdio: "ignore" });
  still(files.master, ((span("c3")[0] + 60) / FPS).toFixed(2), "coperta_16x9.png");
  still(files.reels, ((span("c3")[0] + 60) / FPS).toFixed(2), "coperta_9x16.png");
  still(files.master, (atMs / 1000).toFixed(2), "inainte_corectura.png");
  still(files.afterPatch, (atMs / 1000).toFixed(2), "dupa_corectura.png");
  fs.writeFileSync(path.join(OUT, "text-pe-ecran.srt"), srt);
  fs.writeFileSync(path.join(OUT, "plan-de-montaj_v1.json"), JSON.stringify(media.edits.getVersion(v1).ir, null, 2));
  fs.writeFileSync(path.join(OUT, "plan-de-montaj_v2_dupa_corectura.json"), JSON.stringify(media.edits.getVersion(v2).ir, null, 2));
  fs.writeFileSync(path.join(OUT, "montaj-explicat.txt"), (explain.lines || []).join("\n"));
  for (const [rel, name] of [[otio.relPath, "montaj.otio.json"], [edl.relPath, "montaj.edl"]]) if (rel) fs.copyFileSync(media.paths.resolveRel(rel), path.join(OUT, name));
  if (pack.dir) fs.cpSync(pack.dir, path.join(OUT, "pachet-capcut"), { recursive: true });
  const probes = Object.fromEntries(Object.entries(files).map(([k, f]) => { const p = probeJson(f); const v = p.streams.find((s) => s.codec_type === "video"); return [k, { w: v.width, h: v.height, fps: v.avg_frame_rate, codec: v.codec_name, pix: v.pix_fmt, seconds: Number(p.format.duration), audio: p.streams.some((s) => s.codec_type === "audio"), bytes: Number(p.format.size) }]; }));
  report.files = probes;
  // M10: the Studio project itself (brief, script, storyboard, claims, every edit version, variants, sources + rights) as a hash-bound
  // bundle, so the owner's Studio imports the PROJECT (not just MP4s). The sources sit in surse/ under their original names; the
  // export reuses an identical file already there instead of copying it again.
  fs.mkdirSync(path.join(OUT, "surse"), { recursive: true });
  for (const [src, name] of [[path.join(CAP, "capture.mp4"), "capture.mp4"], [path.join(CAP, "capture.json"), "capture.json"], [path.join(inbox, "end-card.png"), "end-card.png"]]) {
    const dst = path.join(OUT, "surse", name);
    if (!fs.existsSync(dst)) { fs.copyFileSync(src, dst); fs.chmodSync(dst, 0o644); }
  }
  const bundle = media.bundles.exportProject({ contentProjectId: projectId, dir: OUT, actor: "harness" });
  step("bundle", { file: path.basename(bundle.file), sha256: bundle.sha256.slice(0, 16), assets: bundle.assets, edits: bundle.edits, versions: bundle.versions });
  report.claims = media.content.listClaims(projectId).map((c) => ({ text: c.text, status: c.status, evidence: c.evidence }));
  report.rights = [cap.asset.id, card.asset.id].map((id) => ({ assetId: id, evaluation: media.rights.evaluate({ assetId: id, platform: "*", use: "organic" }) }));
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(OUT, "qa-si-productie.json"), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(CAP, "produce-report.json"), JSON.stringify(report, null, 2));
  step("delivered", { out: OUT, files: Object.keys(probes) });
} finally {
  await t.cleanup();
}
