// M09 editor adapters and interchange exports.
// - EDITOR_ADAPTERS: what each backend can do HERE, inspected (never assumed): `ffmpeg` (the real render backend, availability
//   from tools.inspect(), read-only: listing editors never pins a binary), `premiere` (detects an installation; nothing is
//   automated), `capcut` (detects an installation and its version; ASSISTED only: the Hub prepares a folder for the owner and never opens, writes or patches CapCut project files),
//   `otio` and `edl` (file exports).
// - exportOtio(ir, assetsMap): OpenTimelineIO JSON (Timeline.1 → Stack.1 → Track.1 with Clip.2 / Transition.1 / Gap.1,
//   ExternalReference.1 with file:// URLs). Cuts and dissolves are native; everything OTIO has no schema for (zoom/pan
//   keyframes, crop, fit, colour preset, text, captions, gain envelopes, loudness target, labels) travels as `metadata.ifrim`.
// - exportEdl(ir, opts): CMX3600, primary video track only, NON-DROP-FRAME timecodes at the nominal rate; transitions become
//   cuts at the middle of the overlap and every lost operation is listed as a comment (EDL has cuts only).
// - explainEdit(ir, opts): a human-readable account of the edit (interval, asset, movement, caption, sound, reason) in Romanian.
// - createEditors(deps).exportAssistedPack({ editVersionId }): folder packs/<id>/ with the rights-cleared media (content-addressed
//   names, never the imported file names), captions.srt, timeline.csv/.md with timecodes, steps.md, explain.md and manifest.json
//   (sha256 of every file). Media whose rights are not cleared is left out and listed; Windows system fonts are never copied.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { HubError } from "../core/errors.mjs";
import { newId } from "../core/ids.mjs";
import { parse } from "../storage/db.mjs";
import { CAPABILITIES, checkBackend, clipDuration, timelineDuration, framesToMs, framesToTimecode, fpsValue, validateIR, irHash, isStillVersion, primaryVideoTrack } from "./ir.mjs";
import { toSrt, toVtt, normalizeRo } from "./captions.mjs";
import { PRESETS } from "./visual-bible.mjs";

export const OTIO_SCHEMA_VERSION = "Timeline.1";
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

const clean = (s, max = 200) => String(s ?? "").replace(CONTROL, " ").replace(/[\r\n]+/g, " ").trim().slice(0, max);
const decimal = (v, digits = 2) => (Number.isFinite(v) ? v.toFixed(digits).replace(".", ",") : "—");
const secondsLabel = (ms) => `${decimal(ms / 1000, 2)} s`;

function assertIR(ir) {
  const v = validateIR(ir, {});
  if (!v.ok) {
    const first = v.errors.slice(0, 3).map((e) => `${e.path || "IR"}: ${e.message}`).join(" · ");
    throw new HubError("validation", `IR invalid (${v.errors.length} erori): ${first}`, { code: "IR_INVALID", data: { errors: v.errors.slice(0, 50) } });
  }
  return v.ir;
}

// ---------------------------------------------------------------------------------------------------------------------
// adapters

function listDir(dir) { try { return fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; } }
function fileExists(p) { try { const st = fs.lstatSync(p); return st.isFile() && !st.isSymbolicLink(); } catch { return false; } }

/** Adobe Premiere Pro: `<ProgramFiles>/Adobe/Adobe Premiere Pro <year>/Adobe Premiere Pro.exe`. */
export function detectPremiere({ programFiles = process.env.ProgramFiles || "C:/Program Files" } = {}) {
  const base = path.join(programFiles, "Adobe");
  const found = listDir(base).filter((d) => d.isDirectory() && /^Adobe Premiere Pro/i.test(d.name))
    .map((d) => ({ dir: path.join(base, d.name), version: (/(\d{4}|\d+(\.\d+)*)\s*$/.exec(d.name) || [])[1] || null }))
    .filter((d) => fileExists(path.join(d.dir, "Adobe Premiere Pro.exe")));
  if (!found.length) return { installed: false, status: "NOT_INSTALLED", version: null };
  found.sort((a, b) => String(b.version).localeCompare(String(a.version), "en", { numeric: true }));
  return { installed: true, status: "INSTALLED", version: found[0].version };
}

/** CapCut desktop: `<LocalAppData>/CapCut/Apps/<version>/CapCut.exe` (per-user install) or `<ProgramFiles>/CapCut`. */
export function detectCapCut({ localAppData = process.env.LOCALAPPDATA || "", programFiles = process.env.ProgramFiles || "C:/Program Files" } = {}) {
  const candidates = [];
  if (localAppData) {
    const apps = path.join(localAppData, "CapCut", "Apps");
    for (const d of listDir(apps)) {
      if (d.isDirectory() && /^\d+(\.\d+){1,4}$/.test(d.name) && fileExists(path.join(apps, d.name, "CapCut.exe"))) candidates.push({ version: d.name });
    }
  }
  const pf = path.join(programFiles, "CapCut");
  if (fileExists(path.join(pf, "CapCut.exe"))) candidates.push({ version: null });
  for (const d of listDir(pf)) {
    if (d.isDirectory() && /^\d+(\.\d+){1,4}$/.test(d.name) && fileExists(path.join(pf, d.name, "CapCut.exe"))) candidates.push({ version: d.name });
  }
  if (!candidates.length) return { installed: false, status: "NOT_INSTALLED", version: null, mode: "ASSISTED" };
  candidates.sort((a, b) => String(b.version || "").localeCompare(String(a.version || ""), "en", { numeric: true }));
  return { installed: true, status: "INSTALLED", version: candidates[0].version, mode: "ASSISTED" };
}

/**
 * Registry. `inspectCapabilities(ctx)` → `{ id, kind, status, mode, version, note, ops }`; ctx = { tools, env }.
 * Statuses: AVAILABLE | MISSING (ffmpeg), INSTALLED | NOT_INSTALLED (editors), AVAILABLE (file exports).
 */
export const EDITOR_ADAPTERS = Object.freeze({
  ffmpeg: Object.freeze({
    id: "ffmpeg", kind: "render_backend", label: "ffmpeg (randare locală)",
    async inspectCapabilities({ tools } = {}) {
      let r = null;
      // M10.2: inspect() never writes (no pin, no event); whether a render may run (pinned, unchanged) is reported beside it.
      try { r = tools ? await (tools.inspect || tools.resolve)() : null; } catch { r = null; }
      const ok = Boolean(r?.ffmpeg && r?.ffprobe);
      const note = !ok ? "ffmpeg/ffprobe nu sunt disponibile." : r.usable === false
        ? (r.problems?.includes("tool_changed") ? "Randare reală, locală — un binar s-a schimbat; confirmă schimbarea înainte de randare." : "Randare reală, locală — fixează întâi ffmpeg/ffprobe (versiune + sha256).")
        : "Randare reală, locală.";
      return { id: "ffmpeg", kind: "render_backend", status: ok ? "AVAILABLE" : "MISSING", mode: "RENDER", version: r?.ffmpeg?.version || null,
        states: r?.states || null, problems: r?.problems || ["ffmpeg_missing"], note, ops: CAPABILITIES.ffmpeg.ops };
    },
  }),
  premiere: Object.freeze({
    id: "premiere", kind: "editor", label: "Adobe Premiere Pro",
    inspectCapabilities({ env } = {}) {
      const d = detectPremiere(env || {});
      return { id: "premiere", kind: "editor", status: d.status, mode: d.installed ? "MANUAL" : "NONE", version: d.version,
        note: d.installed ? "Instalat; Hub-ul nu automatizează Premiere (importă OTIO/EDL manual)." : CAPABILITIES.premiere.note, ops: CAPABILITIES.premiere.ops };
    },
  }),
  capcut: Object.freeze({
    id: "capcut", kind: "editor", label: "CapCut (asistat)",
    inspectCapabilities({ env } = {}) {
      const d = detectCapCut(env || {});
      return { id: "capcut", kind: "editor", status: d.status, mode: "ASSISTED", version: d.version,
        note: `${CAPABILITIES.capcut_assisted.note}${d.installed ? "" : " CapCut nu este instalat pe acest sistem; pachetul poate fi folosit pe alt calculator."}`, ops: CAPABILITIES.capcut_assisted.ops };
    },
  }),
  otio: Object.freeze({
    id: "otio", kind: "export", label: "OpenTimelineIO (.otio)",
    inspectCapabilities() { return { id: "otio", kind: "export", status: "AVAILABLE", mode: "EXPORT", version: OTIO_SCHEMA_VERSION, note: CAPABILITIES.otio.note, ops: CAPABILITIES.otio.ops }; },
  }),
  edl: Object.freeze({
    id: "edl", kind: "export", label: "EDL CMX3600",
    inspectCapabilities() { return { id: "edl", kind: "export", status: "AVAILABLE", mode: "EXPORT", version: "CMX3600", note: CAPABILITIES.edl.note, ops: CAPABILITIES.edl.ops }; },
  }),
});

// ---------------------------------------------------------------------------------------------------------------------
// OTIO

const rt = (value, rate) => ({ OTIO_SCHEMA: "RationalTime.1", rate, value });
const range = (start, duration, rate) => ({ OTIO_SCHEMA: "TimeRange.1", start_time: rt(start, rate), duration: rt(duration, rate) });

/** Cut point inside an overlap of `t` frames: the outgoing clip keeps `t - h`, the incoming one `h` (h = floor(t/2)). */
const split = (t) => ({ inOffset: Math.floor(t / 2), outOffset: t - Math.floor(t / 2) });

function mediaReference(versionId, asset, rate) {
  if (!asset || typeof asset.absPath !== "string" || !asset.absPath) {
    return { OTIO_SCHEMA: "MissingReference.1", name: versionId, available_range: null, metadata: { ifrim: { assetVersionId: versionId } } };
  }
  const durationMs = Number(asset.probe?.durationMs);
  const still = isStillVersion({ kind: asset.kind, probe: asset.probe });
  return {
    OTIO_SCHEMA: "ExternalReference.1", name: clean(asset.title || versionId, 120), target_url: pathToFileURL(path.resolve(asset.absPath)).href,
    available_range: !still && Number.isFinite(durationMs) && durationMs > 0 ? range(0, Math.floor((durationMs * rate) / 1000 + 1e-9), rate) : null,
    metadata: { ifrim: { assetVersionId: versionId, sha256: asset.sha256 || null, still } },
  };
}

/**
 * OpenTimelineIO JSON (string-ready object). assetsMap: { [versionId]: { absPath, probe, sha256, title, kind } } (optional
 * entries → MissingReference). Times use rate = fps.num / fps.den (frames of the IR).
 */
export function exportOtio(irInput, assetsMap = {}) {
  const ir = assertIR(irInput);
  const rate = fpsValue(ir.fps);
  const video = primaryVideoTrack(ir);
  const children = [];
  video.clips.forEach((clip, i) => {
    const dur = clipDuration(clip);
    const next = video.clips[i + 1];
    const tIn = i > 0 && clip.transitionIn ? clip.transitionIn.frames : 0;
    const tOut = next?.transitionIn ? next.transitionIn.frames : 0;
    const headCut = tIn ? split(tIn).inOffset : 0; // frames of this clip before the previous cut point
    const tailCut = tOut ? split(tOut).outOffset : 0; // frames of this clip after the next cut point
    const speed = clip.speed ?? 1;
    const trackDur = dur - headCut - tailCut;
    if (tIn) {
      const s = split(tIn);
      children.push({ OTIO_SCHEMA: "Transition.1", name: `${clip.id}-in`, transition_type: clip.transitionIn.kind === "crossfade" ? "SMPTE_Dissolve" : "Custom_Transition",
        in_offset: rt(s.inOffset, rate), out_offset: rt(s.outOffset, rate), metadata: { ifrim: { kind: clip.transitionIn.kind, frames: tIn, background: ir.canvas.background || null } } });
    }
    const effects = speed !== 1 ? [{ OTIO_SCHEMA: "LinearTimeWarp.1", name: "speed", effect_name: "LinearTimeWarp", time_scalar: speed, metadata: {} }] : [];
    children.push({
      OTIO_SCHEMA: "Clip.2", name: clean(assetsMap[clip.assetVersionId]?.title || clip.id, 120),
      source_range: range(clip.sourceIn + Math.round(headCut * speed), trackDur, rate),
      media_references: { DEFAULT_MEDIA: mediaReference(clip.assetVersionId, assetsMap[clip.assetVersionId], rate) }, active_media_reference_key: "DEFAULT_MEDIA",
      effects, markers: [], enabled: true,
      metadata: { ifrim: { clipId: clip.id, assetVersionId: clip.assetVersionId, timelineStart: clip.start, timelineFrames: dur, sourceIn: clip.sourceIn, sourceOut: clip.sourceOut,
        speed, fit: clip.fit, crop: clip.crop, keyframes: clip.keyframes, focus: clip.focus, color: clip.color, label: clip.label, shotId: clip.shotId,
        claimIds: clip.claimIds, holdIntentional: clip.holdIntentional, firstClipFadeIn: i === 0 && clip.transitionIn ? clip.transitionIn : undefined } },
    });
  });
  const tracks = [{ OTIO_SCHEMA: "Track.1", name: video.id, kind: "Video", children, markers: [], effects: [], enabled: true, source_range: null, metadata: {} }];
  for (const track of ir.tracks.filter((t) => t.kind === "audio")) {
    const kids = [];
    let cursor = 0;
    for (const c of [...track.clips].sort((a, b) => a.start - b.start)) {
      if (c.start > cursor) kids.push({ OTIO_SCHEMA: "Gap.1", name: "gap", source_range: range(0, c.start - cursor, rate), effects: [], markers: [], enabled: true, metadata: {} });
      const len = c.sourceOut - c.sourceIn;
      kids.push({ OTIO_SCHEMA: "Clip.2", name: clean(assetsMap[c.assetVersionId]?.title || c.id, 120), source_range: range(c.sourceIn, len, rate),
        media_references: { DEFAULT_MEDIA: mediaReference(c.assetVersionId, assetsMap[c.assetVersionId], rate) }, active_media_reference_key: "DEFAULT_MEDIA",
        effects: [], markers: [], enabled: true,
        metadata: { ifrim: { clipId: c.id, assetVersionId: c.assetVersionId, role: c.role, gainDb: c.gainDb, fadeIn: c.fadeIn, fadeOut: c.fadeOut, envelope: c.envelope } } });
      cursor = c.start + len;
    }
    tracks.push({ OTIO_SCHEMA: "Track.1", name: track.id, kind: "Audio", children: kids, markers: [], effects: [], enabled: true, source_range: null, metadata: {} });
  }
  const markers = (ir.markers || []).map((m, i) => ({ OTIO_SCHEMA: "Marker.2", name: `${m.kind}-${i + 1}`, color: m.kind === "cta" ? "GREEN" : m.kind === "evidence" ? "ORANGE" : "RED",
    marked_range: range(m.frame, 0, rate), comment: clean(m.note, 500), metadata: { ifrim: { kind: m.kind } } }));
  const texts = ir.tracks.filter((t) => t.kind === "text").flatMap((t) => t.items.map((it) => ({ trackId: t.id, ...it })));
  const caps = ir.tracks.find((t) => t.kind === "captions") || null;
  return {
    OTIO_SCHEMA: OTIO_SCHEMA_VERSION, name: clean(ir.meta?.title || "Editare Ifrim", 200), global_start_time: rt(0, rate),
    metadata: { ifrim: { irVersion: ir.irVersion, irSha256: irHash(ir), fps: ir.fps, canvas: ir.canvas, preset: ir.preset, language: ir.language,
      loudness: ir.loudness, labels: ir.meta?.labels || [], durationFrames: timelineDuration(ir), text: texts, captions: caps ? { burnIn: caps.burnIn, cues: caps.cues } : null,
      evidenceRegions: ir.evidenceRegions || [], capabilities: checkBackend(ir, "otio"), note: "Efectele fără schemă OTIO (zoom, crop, culoare, text, subtitrări, anvelope) sunt metadate." } },
    tracks: { OTIO_SCHEMA: "Stack.1", name: "tracks", children: tracks, markers, effects: [], enabled: true, source_range: null, metadata: {} },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// EDL

const edlText = (s) => clean(s, 120).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7e]/g, "?");

/** CMX3600 EDL of the primary video track. opts: { title, assetsMap } → string (CRLF line ends). */
export function exportEdl(irInput, { title = null, assetsMap = {} } = {}) {
  const ir = assertIR(irInput);
  const video = primaryVideoTrack(ir);
  const fps = ir.fps;
  const lines = [`TITLE: ${edlText(title || ir.meta?.title || "IFRIM EDIT").toUpperCase().slice(0, 70) || "IFRIM EDIT"}`, "FCM: NON-DROP FRAME"];
  if (fps.den !== 1) lines.push(`* IFRIM: CADENTA ${fps.num}/${fps.den}; TIMECODE NDF LA ${Math.round(fpsValue(fps))} FPS NOMINAL (RULEAZA CU 0,1% INAINTEA CEASULUI).`);
  let record = 0;
  video.clips.forEach((clip, i) => {
    const dur = clipDuration(clip);
    const next = video.clips[i + 1];
    const tIn = i > 0 && clip.transitionIn ? clip.transitionIn.frames : 0;
    const tOut = next?.transitionIn ? next.transitionIn.frames : 0;
    const head = tIn ? split(tIn).inOffset : 0;
    const tail = tOut ? split(tOut).outOffset : 0;
    const speed = clip.speed ?? 1;
    const recDur = dur - head - tail;
    const srcIn = clip.sourceIn + Math.round(head * speed);
    const srcOut = srcIn + Math.round(recDur * speed);
    const num3 = String(i + 1).padStart(3, "0");
    lines.push("");
    lines.push(`${num3}  AX       V     C        ${framesToTimecode(srcIn, fps)} ${framesToTimecode(srcOut, fps)} ${framesToTimecode(record, fps)} ${framesToTimecode(record + recDur, fps)}`);
    lines.push(`* FROM CLIP NAME: ${edlText(assetsMap[clip.assetVersionId]?.title || clip.id)}`);
    lines.push(`* IFRIM ASSET: ${edlText(clip.assetVersionId)} CLIP: ${edlText(clip.id)}`);
    const lost = [];
    if (tIn) lost.push(`${clip.transitionIn.kind === "crossfade" ? "CROSSFADE" : "FADE"} ${tIn} CADRE REDAT CA TAIETURA`);
    if (i === 0 && clip.transitionIn) lost.push(`FADE-IN ${clip.transitionIn.frames} CADRE OMIS`);
    if (speed !== 1) lost.push(`VITEZA ${speed}X OMISA (SURSA ${srcIn}-${srcOut})`);
    if ((clip.keyframes || []).length) lost.push(`ZOOM/PAN ${clip.keyframes.length} KEYFRAME-URI OMISE`);
    const c = clip.crop;
    if (c && (c.x || c.y || c.w !== 1 || c.h !== 1)) lost.push("CROP OMIS");
    if (clip.color?.preset && clip.color.preset !== "neutral") lost.push(`CULOARE ${clip.color.preset.toUpperCase()} OMISA`);
    for (const l of lost) lines.push(`* IFRIM PIERDUT: ${l}`);
    record += recDur;
  });
  const others = [];
  if (ir.tracks.some((t) => t.kind === "text" && t.items.length)) others.push("TEXT");
  if (ir.tracks.some((t) => t.kind === "captions" && t.cues.length)) others.push("SUBTITRARI");
  if (ir.tracks.some((t) => t.kind === "audio" && t.clips.length)) others.push("AUDIO");
  if (others.length) { lines.push(""); lines.push(`* IFRIM PIERDUT: PISTELE ${others.join(", ")} NU EXISTA IN EDL (FOLOSESTE OTIO SAU PACHETUL ASISTAT).`); }
  return `${lines.join("\r\n")}\r\n`;
}

// ---------------------------------------------------------------------------------------------------------------------
// explain

function movementOf(clip) {
  const kfs = clip.keyframes || [];
  const parts = [];
  if (!kfs.length) parts.push("cadru static");
  else {
    const a = kfs[0], b = kfs[kfs.length - 1];
    if (kfs.length === 1) parts.push(`zoom fix ${decimal(a.scale)}× centrat la (${decimal(a.cx)}, ${decimal(a.cy)})`);
    else {
      const moved = Math.abs(a.cx - b.cx) > 1e-6 || Math.abs(a.cy - b.cy) > 1e-6;
      parts.push(`zoom ${decimal(a.scale)}× → ${decimal(b.scale)}×${b.ease === "inOut" ? " (accelerare/decelerare lină)" : " (liniar)"}`);
      if (moved) parts.push(`centrul se mută de la (${decimal(a.cx)}, ${decimal(a.cy)}) la (${decimal(b.cx)}, ${decimal(b.cy)})`);
    }
  }
  if ((clip.speed ?? 1) !== 1) parts.push(`viteză ${decimal(clip.speed)}×`);
  if (clip.fit === "contain") parts.push("încadrat complet (benzi pe fundal)");
  const c = clip.crop;
  if (c && (c.x || c.y || c.w !== 1 || c.h !== 1)) parts.push(`decupat la ${Math.round(c.w * 100)}% × ${Math.round(c.h * 100)}%`);
  if (clip.color?.preset && clip.color.preset !== "neutral") parts.push(`culoare „${clip.color.preset}”`);
  if (clip.transitionIn) parts.push(`${clip.transitionIn.kind === "crossfade" ? "intrare prin dizolvare" : "intrare prin fade"} de ${clip.transitionIn.frames} cadre`);
  return parts.join("; ");
}

/**
 * Human-readable edit list. opts: { assetsMap } (titles). → { entries: [{ clipId, from, to, fromMs, toMs, asset, movement,
 * text[], captions[], sound[], reason }], lines: string[], durationMs }.
 */
export function explainEdit(irInput, { assetsMap = {} } = {}) {
  const ir = assertIR(irInput);
  const fps = ir.fps;
  const video = primaryVideoTrack(ir);
  const overlaps = (s, e, a, b) => s < b && a < e;
  const entries = video.clips.map((clip) => {
    const s = clip.start, e = clip.start + clipDuration(clip);
    const text = ir.tracks.filter((t) => t.kind === "text").flatMap((t) => t.items).filter((it) => overlaps(s, e, it.start, it.end))
      .map((it) => `„${normalizeRo(it.text).replace(/\n/g, " ").slice(0, 120)}” (stil ${it.style}, ${secondsLabel(framesToMs(it.start, fps))}–${secondsLabel(framesToMs(it.end, fps))})`);
    const captions = ir.tracks.filter((t) => t.kind === "captions").flatMap((t) => t.cues).filter((q) => overlaps(s, e, q.start, q.end))
      .map((q) => `„${normalizeRo(q.text).replace(/\n/g, " ").slice(0, 120)}”`);
    const sound = ir.tracks.filter((t) => t.kind === "audio").flatMap((t) => t.clips).filter((c) => overlaps(s, e, c.start, c.start + (c.sourceOut - c.sourceIn)))
      .map((c) => {
        const bits = [`${c.role} „${clean(assetsMap[c.assetVersionId]?.title || c.assetVersionId, 80)}”`];
        bits.push(c.envelope?.length ? `anvelopă de câștig (${c.envelope.length} puncte)` : `câștig ${decimal(c.gainDb ?? 0, 1)} dB`);
        if (c.fadeIn) bits.push(`fade-in ${c.fadeIn} cadre`);
        if (c.fadeOut) bits.push(`fade-out ${c.fadeOut} cadre`);
        return bits.join(", ");
      });
    const reasons = [];
    const markers = (ir.markers || []).filter((m) => m.frame >= s && m.frame < e);
    const MARKER_TEXT = { hook: "cârlig (deschidere)", demo: "demonstrație", evidence: "dovadă", cta: "îndemn la acțiune", beat: "ritm", chapter: "capitol", note: "notă" };
    for (const m of markers) reasons.push(`${MARKER_TEXT[m.kind] || m.kind}${m.note ? `: ${clean(m.note, 160)}` : ""}`);
    if (clip.claimIds?.length) reasons.push(`susține afirmațiile ${clip.claimIds.join(", ")}`);
    if (clip.label && clip.label !== "ORIGINAL_RECORDING") reasons.push(`material ${clip.label} (etichetă obligatorie pe ecran)`);
    if (clip.holdIntentional) reasons.push("cadru ținut intenționat");
    if ((ir.evidenceRegions || []).some((r) => r.clipId === clip.id)) reasons.push("conține o regiune de dovadă care nu trebuie acoperită");
    return {
      clipId: clip.id, from: framesToTimecode(s, fps), to: framesToTimecode(e, fps), fromMs: Math.round(framesToMs(s, fps)), toMs: Math.round(framesToMs(e, fps)),
      asset: clean(assetsMap[clip.assetVersionId]?.title || clip.assetVersionId, 120), assetVersionId: clip.assetVersionId,
      source: `${secondsLabel(framesToMs(clip.sourceIn, fps))}–${secondsLabel(framesToMs(clip.sourceOut, fps))}`,
      movement: movementOf(clip), text, captions, sound, reason: reasons.length ? reasons.join("; ") : "fără motiv declarat în IR",
    };
  });
  const lines = entries.map((x, i) => `${i + 1}. ${secondsLabel(x.fromMs)}–${secondsLabel(x.toMs)} · ${x.asset} (sursa ${x.source}) · mișcare: ${x.movement}`
    + `${x.text.length ? ` · text: ${x.text.join("; ")}` : ""}${x.captions.length ? ` · subtitrare: ${x.captions.join(" ")}` : ""}`
    + `${x.sound.length ? ` · sunet: ${x.sound.join("; ")}` : ""} · motiv: ${x.reason}`);
  return { entries, lines, durationMs: Math.round(framesToMs(timelineDuration(ir), fps)) };
}

// ---------------------------------------------------------------------------------------------------------------------
// factory: adapters bound to the Hub + the CapCut assisted pack and file exports

const sha256File = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const csvCell = (v) => { const s = String(v ?? ""); return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

/**
 * createEditors({ db, bus, clock, paths, assets, rights, tools, env }).
 */
export function createEditors({ db, bus, clock = () => new Date(), paths, assets, rights = null, tools = null, env = null }) {
  if (!db || !bus || !paths || !assets) throw new Error("createEditors requires db, bus, paths and assets");
  const now = () => clock().toISOString();
  const selEdit = db.prepare(`SELECT v.*, p.title AS project_title, p.content_project_id FROM media_edit_versions v
    JOIN media_edit_projects p ON p.id = v.edit_project_id WHERE v.id = ?`);

  const requireActor = (actor) => {
    if (typeof actor !== "string" || !actor.trim() || actor.length > 120) throw new HubError("validation", "Lipsește autorul operației (actor).", { code: "ACTOR_REQUIRED" });
    return actor.trim();
  };
  function loadEdit(editVersionId) {
    if (typeof editVersionId !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(editVersionId)) throw new HubError("validation", "Versiunea de editare este invalidă.", { code: "FIELD_INVALID" });
    const row = selEdit.get(editVersionId);
    if (!row) throw new HubError("not_found", "Versiunea de editare nu există.", { code: "EDIT_VERSION_MISSING" });
    const ir = parse(row.ir_json, null);
    return { row, ir: assertIR(ir) };
  }
  function assetsMapFor(ir) {
    const map = {};
    const ids = new Set();
    for (const t of ir.tracks) if (t.kind === "video" || t.kind === "audio") for (const c of t.clips) ids.add(c.assetVersionId);
    for (const id of ids) {
      const v = assets.getVersion(id);
      if (!v) continue;
      let absPath = null;
      try { absPath = assets.versionPath(id); } catch { absPath = null; }
      map[id] = { absPath, probe: v.probe, sha256: v.sha256, bytes: v.bytes, title: v.title, kind: v.kind, mime: v.mime };
    }
    return map;
  }

  async function inspectAll() {
    const out = {};
    for (const [id, adapter] of Object.entries(EDITOR_ADAPTERS)) out[id] = await adapter.inspectCapabilities({ tools, env });
    return out;
  }

  function writeExport(kind, editVersionId, content, ext, actor) {
    paths.ensure();
    const id = newId(`mex_${kind}`).replace(/[^A-Za-z0-9_-]/g, "");
    const dir = paths.exportsDir();
    const target = path.join(dir, `${id}.${ext}`);
    const tmp = `${target}.partial`;
    fs.writeFileSync(tmp, content, "utf8");
    fs.renameSync(tmp, target);
    const rel = paths.relOf(target);
    const sha = sha256File(target);
    bus.emit({ type: `media.export.${kind}`, scopeType: "media_edit_version", scopeId: editVersionId, source: actor, payload: { editVersionId, relPath: rel, sha256: sha, bytes: fs.statSync(target).size } });
    return { id, relPath: rel, absPath: target, sha256: sha };
  }

  /** Writes exports/<id>.otio for an edit version. */
  function writeOtio({ editVersionId, actor } = {}) {
    const who = requireActor(actor);
    const { ir } = loadEdit(editVersionId);
    const doc = exportOtio(ir, assetsMapFor(ir));
    return { ...writeExport("otio", editVersionId, `${JSON.stringify(doc, null, 2)}\n`, "otio", who), capabilities: doc.metadata.ifrim.capabilities };
  }
  /** Writes exports/<id>.edl for an edit version. */
  function writeEdl({ editVersionId, actor } = {}) {
    const who = requireActor(actor);
    const { row, ir } = loadEdit(editVersionId);
    const text = exportEdl(ir, { title: ir.meta?.title || row.project_title, assetsMap: assetsMapFor(ir) });
    return { ...writeExport("edl", editVersionId, text, "edl", who), capabilities: checkBackend(ir, "edl") };
  }

  /**
   * CapCut assisted pack: packs/<packId>/ with media/, captions.srt (+ .vtt), timeline.csv, timeline.md, steps.md, explain.md,
   * manifest.json. Media is copied only when its rights are cleared for `{ platform, use }` (default: any platform, organic use);
   * the rest is listed as excluded and the pack is marked incomplete. Nothing is sent anywhere; CapCut is never touched.
   */
  function exportAssistedPack({ editVersionId, actor, platform = null, use = "organic" } = {}) {
    const who = requireActor(actor);
    const { row, ir } = loadEdit(editVersionId);
    const fps = ir.fps;
    const map = assetsMapFor(ir);
    const preset = PRESETS[ir.preset.id]?.version === ir.preset.version ? PRESETS[ir.preset.id] : null;
    paths.ensure();
    const packId = newId("mpk").replace(/[^A-Za-z0-9_-]/g, "");
    const finalDir = paths.packDir(packId);
    const work = `${finalDir}.partial`;
    fs.mkdirSync(path.join(work, "media"), { recursive: true });
    const files = {};
    const record = (rel) => { files[rel] = { sha256: sha256File(path.join(work, rel)), bytes: fs.statSync(path.join(work, rel)).size }; };
    const writeFile = (rel, content) => { fs.writeFileSync(path.join(work, rel), content, "utf8"); record(rel); };
    try {
      // Media: content-addressed names; rights checked per version.
      const mediaName = {};
      const excluded = [];
      let idx = 0;
      for (const [versionId, a] of Object.entries(map).sort(([x], [y]) => x.localeCompare(y))) {
        idx += 1;
        const verdict = rights ? rights.evaluateVersion({ versionId, platform, use }) : { allowed: false, status: "BLOCKED", reasons: [{ code: "RIGHTS_UNCHECKED" }] };
        if (!verdict.allowed) { excluded.push({ versionId, status: verdict.status, reasons: (verdict.reasons || []).map((r) => r.code) }); continue; }
        if (!a.absPath) { excluded.push({ versionId, status: "MISSING", reasons: ["INPUT_MISSING"] }); continue; }
        const ext = (path.extname(a.absPath).slice(1) || "bin").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "bin";
        const name = `media/${String(idx).padStart(2, "0")}_${String(a.sha256).slice(0, 12)}.${ext}`;
        fs.copyFileSync(a.absPath, path.join(work, name));
        // The library already holds this file's verified sha256 (content-addressed at import): media of any size is never
        // re-read into memory here (M09 review); the copy is checked by size against the library record.
        const copied = fs.statSync(path.join(work, name)).size;
        const expectedBytes = Number(a.bytes ?? a.probe?.sizeBytes ?? copied);
        if (/^[0-9a-f]{64}$/.test(String(a.sha256)) && copied === expectedBytes) files[name] = { sha256: String(a.sha256), bytes: copied };
        else record(name);
        mediaName[versionId] = name;
      }
      const label = (versionId) => mediaName[versionId] || `(exclus: ${versionId})`;
      const tc = (f) => framesToTimecode(f, fps);
      const caps = ir.tracks.find((t) => t.kind === "captions");
      if (caps?.cues?.length) {
        writeFile("captions.srt", toSrt(caps.cues, fps, { maxChars: preset?.captionStyle?.maxChars || 42, maxLines: preset?.captionStyle?.maxLines || 2 }));
        writeFile("captions.vtt", toVtt(caps.cues, fps, { maxChars: preset?.captionStyle?.maxChars || 42, maxLines: preset?.captionStyle?.maxLines || 2 }));
      }

      // Timeline table.
      const rows = [];
      const video = primaryVideoTrack(ir);
      video.clips.forEach((c, i) => {
        const ops = [];
        if ((c.speed ?? 1) !== 1) ops.push(`viteză ${decimal(c.speed)}×`);
        if (c.fit === "contain") ops.push("încadrare completă");
        const k = c.crop; if (k && (k.x || k.y || k.w !== 1 || k.h !== 1)) ops.push(`crop x=${decimal(k.x)} y=${decimal(k.y)} l=${decimal(k.w)} î=${decimal(k.h)}`);
        if (c.keyframes?.length) ops.push(c.keyframes.map((kf) => `@${tc(c.start + kf.frame)} zoom ${decimal(kf.scale)}× centru (${decimal(kf.cx)}, ${decimal(kf.cy)})`).join(" → "));
        if (c.transitionIn) ops.push(`${c.transitionIn.kind === "crossfade" ? "dizolvare" : "fade"} ${c.transitionIn.frames} cadre la intrare`);
        if (c.color?.preset && c.color.preset !== "neutral") ops.push(`culoare ${c.color.preset}`);
        if (c.label) ops.push(`etichetă ${c.label}`);
        rows.push({ n: rows.length + 1, start: tc(c.start), end: tc(c.start + clipDuration(c)), track: `Video ${video.id}`, element: c.id, file: label(c.assetVersionId),
          srcIn: tc(c.sourceIn), srcOut: tc(c.sourceOut), ops: ops.join("; ") || "—" });
      });
      for (const t of ir.tracks.filter((x) => x.kind === "text")) {
        for (const it of t.items) {
          rows.push({ n: rows.length + 1, start: tc(it.start), end: tc(it.end), track: `Text ${t.id}`, element: it.id, file: "—", srcIn: "—", srcOut: "—",
            ops: `„${normalizeRo(it.text).replace(/\n/g, " / ")}” · stil ${it.style} · ancoră ${it.anchor} (${decimal(it.x)}, ${decimal(it.y)}) · animație ${it.animation}` });
        }
      }
      for (const t of ir.tracks.filter((x) => x.kind === "audio")) {
        for (const c of t.clips) {
          const len = c.sourceOut - c.sourceIn;
          rows.push({ n: rows.length + 1, start: tc(c.start), end: tc(c.start + len), track: `Audio ${t.id}`, element: c.id, file: label(c.assetVersionId), srcIn: tc(c.sourceIn), srcOut: tc(c.sourceOut),
            ops: [`rol ${c.role}`, c.envelope?.length ? `anvelopă ${c.envelope.map((p) => `@${tc(c.start + p.frame)} ${decimal(p.gainDb, 1)} dB`).join(", ")}` : `câștig ${decimal(c.gainDb ?? 0, 1)} dB`,
              c.fadeIn ? `fade-in ${c.fadeIn} cadre` : null, c.fadeOut ? `fade-out ${c.fadeOut} cadre` : null].filter(Boolean).join("; ") });
        }
      }
      const header = ["#", "Start", "Sfârșit", "Pistă", "Element", "Fișier", "Sursă in", "Sursă out", "Operații"];
      writeFile("timeline.csv", `\uFEFF${[header, ...rows.map((r) => [r.n, r.start, r.end, r.track, r.element, r.file, r.srcIn, r.srcOut, r.ops])].map((l) => l.map(csvCell).join(";")).join("\r\n")}\r\n`);
      const mdCell = (s) => String(s).replace(/\|/g, "\\|");
      writeFile("timeline.md", [`# Timeline — ${clean(ir.meta?.title || row.project_title, 200)}`, "",
        `Cadență ${fps.num}/${fps.den} (timecode NDF la ${Math.round(fpsValue(fps))} cadre/s nominal), canvas ${ir.canvas.width}×${ir.canvas.height}, durată ${secondsLabel(framesToMs(timelineDuration(ir), fps))}.`, "",
        `| ${header.join(" | ")} |`, `|${header.map(() => "---").join("|")}|`,
        ...rows.map((r) => `| ${[r.n, r.start, r.end, r.track, r.element, r.file, r.srcIn, r.srcOut, r.ops].map(mdCell).join(" | ")} |`), ""].join("\n"));

      // Steps.
      const fontsNote = preset ? Object.values(preset.fonts).map((f) => f.family).filter((v, i, a) => a.indexOf(v) === i).join(", ") : "—";
      const steps = [
        `# Pași CapCut (asistat) — ${clean(ir.meta?.title || row.project_title, 200)}`, "",
        "Hub-ul NU deschide și NU modifică proiecte CapCut. Pașii de mai jos îi aplici manual; rezultatul nu este verificat automat până nu este reimportat ca divergență manuală.", "",
        `1. Creează un proiect nou: raport ${ir.canvas.width}×${ir.canvas.height}, ${decimal(fpsValue(fps), 3)} cadre/s, fundal ${ir.canvas.background || "#000000"}.`,
        "2. Importă tot conținutul dosarului `media/` (numele fișierelor sunt amprente; legătura cu IR-ul este în `timeline.csv`).",
        "3. Așază clipurile video pe pista principală în ordinea din `timeline.csv`, cu intrarea/ieșirea din coloanele „Sursă in/out”.",
        "4. Aplică pentru fiecare clip operațiile din coloana „Operații” (viteză, crop, zoom pe keyframe-uri, dizolvări, culoare).",
        `5. Adaugă textele din pistele Text cu fonturile presetului „${ir.preset.id}” (${fontsNote}); fonturile de sistem Windows nu sunt incluse în pachet.`,
        caps?.cues?.length ? `6. Importă subtitrările din \`captions.srt\` (${caps.burnIn !== false ? "arse în imagine" : "doar fișier separat"}).` : "6. Editarea nu are subtitrări.",
        "7. Așază pistele audio cu câștigul, fade-urile și anvelopa indicate.",
        `8. Ținta de loudness: ${decimal(ir.loudness.targetLufs, 1)} LUFS integrat, vârf real maxim ${decimal(ir.loudness.maxTruePeakDb, 1)} dBTP (țintă editorială internă).`,
        "9. Exportă H.264, yuv420p, AAC 48 kHz, la rezoluția și cadența proiectului.",
        "10. Reimportă exportul în Studio ca „divergență manuală” pentru QA; nu publica direct din CapCut.",
      ];
      if (excluded.length) {
        steps.push("", "## Media exclusă (drepturi neclarificate sau fișier lipsă)", "", ...excluded.map((e) => `- ${e.versionId}: ${e.status} (${e.reasons.join(", ") || "—"})`));
      }
      const ops = checkBackend(ir, "capcut_assisted");
      steps.push("", "## Capabilități", "", `Operații folosite: ${[...ops.instructions, ...ops.native].sort().join(", ") || "—"} — toate ca instrucțiuni manuale (subtitrările ca fișier).`);
      writeFile("steps.md", `${steps.join("\n")}\n`);
      const ex = explainEdit(ir, { assetsMap: map });
      writeFile("explain.md", `# Explicația editării\n\n${ex.lines.map((l) => `- ${l}`).join("\n")}\n`);

      const complete = excluded.length === 0;
      const manifest = { kind: "capcut_assisted_pack", packId, editVersionId, irSha256: irHash(ir), createdAt: now(), createdBy: who, complete, excluded,
        capabilities: ops, scope: { platform, use }, files };
      fs.writeFileSync(path.join(work, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
      fs.renameSync(work, finalDir);
      const relDir = paths.relOf(finalDir);
      bus.emit({ type: "media.export.capcut_pack", scopeType: "media_edit_version", scopeId: editVersionId, source: who,
        payload: { packId, editVersionId, relDir, complete, excluded: excluded.length, files: Object.keys(files).length + 1 } });
      return { packId, dir: finalDir, relDir, complete, excluded, files: [...Object.keys(files), "manifest.json"].sort(), manifest };
    } catch (error) {
      try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* best effort */ }
      throw error;
    }
  }

  return { adapters: EDITOR_ADAPTERS, inspectAll, exportAssistedPack, writeOtio, writeEdl, exportOtio, exportEdl, explainEdit };
}

