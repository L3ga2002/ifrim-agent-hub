import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { HubError } from "../core/errors.mjs";
import { createMediaPaths } from "./paths.mjs";
import { createMediaTools } from "./tools.mjs";
import { createMediaAssets } from "./assets.mjs";
import { createMediaRights } from "./rights.mjs";
import { createEdits } from "./edits.mjs";
import { createRenderQueue } from "./render.mjs";
import { createEditors } from "./editors.mjs";
import { createMediaQa } from "./qa.mjs";
import { createVariantService, PLATFORM_PROFILES, PROFILES_VERSION } from "./variants.mjs";
import { createReviews } from "./review.mjs";
import { createContent } from "./content.mjs";
import { createDistribution, PLATFORM_REGISTRY } from "./distribution.mjs";
import { createAnalytics } from "./analytics.mjs";
import { createCampaigns } from "./campaigns.mjs";
import { createCapture } from "./capture.mjs";
import { createMediaTranscriber } from "./transcribe.mjs";
import { seedPresets, listPresets, getPreset, resolveFonts } from "./visual-bible.mjs";
import { createImportAccess } from "./import-access.mjs";
import { createProjectBundles } from "./project-bundle.mjs";

/**
 * M09 Content / Media / Growth department — one composition over the same database, bus, supervisor and settings as the rest of
 * the Hub. Nothing here starts a model, records the owner's screen, uploads or publishes by itself:
 * - production (library → edit plan → render → QA → review → variants) is local and deterministic;
 * - distribution builds hash-bound manifests and manual packs; the API route refuses in M09 (mediaPolicy.liveUpload is off and no
 *   platform is VERIFIED_LIVE);
 * - capture of the live Hub or the desktop refuses while mediaPolicy.liveCapture is off;
 * - renders yield to interactive work (an AI run or the voice engine) when mediaPolicy.interactivePriority is on.
 * Boot never resumes a render, a capture or a release: interrupted work is marked and waits for the owner.
 */
export function createMedia({ db, bus, live = null, clock = () => new Date(), config, settings, supervisor, sales = null, runs = null, voiceEngine = null }) {
  const paths = createMediaPaths({ config });
  const tools = createMediaTools({ config, supervisor, settings, bus, clock });
  const assets = createMediaAssets({ db, bus, clock, paths, tools, settings });
  const rights = createMediaRights({ db, bus, clock });
  const edits = createEdits({ db, bus, clock, assets });
  const interactiveBusy = () => {
    if (settings.get("mediaPolicy")?.interactivePriority === false) return false;
    try { return (runs?.activeCount?.() || 0) > 0 || Boolean(voiceEngine?.activity?.()?.pending); } catch { return false; }
  };
  const render = createRenderQueue({ db, bus, live, clock, paths, tools, assets, settings, isInteractiveBusy: interactiveBusy });
  const editors = createEditors({ db, bus, clock, paths, assets, rights, tools, env: process.env });
  const qa = createMediaQa({ db, bus, clock, tools, paths, assets, rights });
  const variants = createVariantService({ db, bus, clock, assets });
  const reviews = createReviews({ db, bus, clock, assets });
  const content = createContent({ db, bus, clock, settings, sales });
  const distribution = createDistribution({ db, bus, clock, paths, assets, rights, settings, qa });
  const analytics = createAnalytics({ db, bus, clock });
  const campaigns = createCampaigns({ db, bus, clock, sales });
  const capture = createCapture({ db, bus, clock, settings, config, paths, assets, tools });
  const transcriber = createMediaTranscriber({ db, bus, clock, config, supervisor, voiceEngine, paths, tools, settings });

  const importAccess = createImportAccess({ db, bus, clock, settings, config });
  /**
   * Folders the owner may import local media from (never the repo, the data root or OneDrive by default): the configured roots (or
   * %USERPROFILE%\Videos when none) plus the one-time accesses still valid (M10: an explicit, expiring choice for one folder).
   */
  function importRoots() {
    const configured = settings.get("mediaPolicy")?.importRoots;
    const base = Array.isArray(configured) && configured.length ? configured.map((p) => path.resolve(String(p))) : config.testMode ? [] : [path.join(os.homedir(), "Videos")];
    let once = [];
    try { once = importAccess.activeOnceRoots(); } catch { once = []; }
    return [...new Set([...base, ...once])];
  }
  const bundles = createProjectBundles({ db, bus, clock, assets, rights, content, edits, paths, importRoots });

  /** The approved local exports folder: mediaPolicy.exportsDir, or <first import root>\Ifrim Studio\Exporturi. */
  function exportsDir() {
    const configured = settings.get("mediaPolicy")?.exportsDir;
    if (configured) return path.resolve(configured);
    const roots = importRoots();
    return roots[0] ? path.join(roots[0], "Ifrim Studio", "Exporturi") : null;
  }
  /**
   * M10 local export (not a publication): copies a READY render to the approved exports folder. Never overwrites: an existing name
   * with OTHER content gets the next free version suffix; the same content is reported as already exported. The copy is verified.
   */
  function exportLocal({ assetVersionId, name = null, actor = "owner" }) {
    const v = assets.getVersion(assetVersionId);
    if (!v) throw new HubError("not_found", "Materialul nu există.");
    if (v.status !== "READY") throw new HubError("conflict", `Materialul nu e gata de export (${v.status}).`);
    const dir = exportsDir();
    if (!dir) throw new HubError("validation", "Nu există un folder de exporturi aprobat (alege întâi un folder de import).");
    const roots = importRoots().map((r) => path.resolve(r).toLowerCase());
    const rd = path.resolve(dir).toLowerCase();
    if (!roots.some((r) => rd === r || rd.startsWith(`${r}${path.sep}`))) throw new HubError("policy", "Folderul de exporturi trebuie să fie într-un folder aprobat.", { code: "EXPORT_DIR_NOT_APPROVED" });
    fs.mkdirSync(dir, { recursive: true });
    const src = assets.versionPath(v.id);
    const ext = path.extname(src) || ".mp4";
    const base = String(name || v.title || "export").normalize("NFC").replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 80).replace(/\.[a-z0-9]{2,4}$/i, "") || "export";
    for (let i = 1; i < 1000; i += 1) {
      const target = path.join(dir, `${base}${i > 1 ? ` (${i})` : ""}${ext}`);
      if (fs.existsSync(target)) {
        const same = crypto.createHash("sha256").update(fs.readFileSync(target)).digest("hex") === v.sha256;
        if (same) return { file: target, existing: true, sha256: v.sha256 };
        continue; // another file with this name: never overwritten
      }
      fs.copyFileSync(src, target, fs.constants.COPYFILE_EXCL);
      const sha = crypto.createHash("sha256").update(fs.readFileSync(target)).digest("hex");
      if (sha !== v.sha256) { fs.rmSync(target, { force: true }); throw new HubError("tool", "Copia exportată nu corespunde originalului; am șters-o."); }
      bus.transaction(() => bus.append({ type: "media.export.local", scopeType: "media_asset", scopeId: v.assetId, source: actor, payload: { versionId: v.id, file: path.basename(target), version: i } }));
      return { file: target, existing: false, sha256: sha, versioned: i > 1 };
    }
    throw new HubError("conflict", "Prea multe exporturi cu același nume.");
  }

  let detach = null;
  /** Boot: folders, pinned presets, and recovery that only MARKS interrupted work (never resumes it). */
  function boot() {
    paths.ensure();
    const presets = seedPresets(db, clock, { bus, actor: "system:seed" });
    const report = {
      presets: { inserted: presets.inserted.length, conflicts: presets.conflicts.length },
      render: render.recover(),
      distribution: distribution.recover(),
      capture: capture.recover(),
      transcripts: transcriber.recover(),
    };
    if (!detach) detach = content.attach();
    return report;
  }

  /** Scheduler tick: claim the next render when allowed; check schedules (never dispatches anything external). */
  function tick() {
    try {
      const r = render.tick();
      if (r?.done && typeof r.done.catch === "function") r.done.catch(() => { /* the job row records the failure */ });
    } catch { /* a render tick never breaks the Hub tick */ }
    try { distribution.tick(); } catch { /* idem */ }
  }

  function close() {
    try { detach?.(); } catch { /* ignore */ }
    detach = null;
    return transcriber.stopAll("hub:close").catch(() => {});
  }

  /** Read-only state for the Studio header: storage, tools, policy (what is off and why). */
  function status() {
    const policy = settings.get("mediaPolicy") || {};
    return {
      storage: paths.status(),
      quota: assets.quota(),
      tools: tools.lastResolved?.() || null,
      policy: { autoPublish: Boolean(policy.autoPublish), liveUpload: Boolean(policy.liveUpload), liveCapture: Boolean(policy.liveCapture),
        interactivePriority: policy.interactivePriority !== false, renderConcurrency: policy.renderConcurrency || 1 },
      importRoots: importRoots(),
      renders: { active: render.activeJobs?.() || [] },
      transcription: transcriber.status(),
      platforms: { profilesVersion: PROFILES_VERSION, profiles: Object.keys(PLATFORM_PROFILES) },
      presets: listPresets(db),
    };
  }

  return {
    paths, tools, assets, rights, edits, render, editors, qa, variants, reviews, content, distribution, analytics, campaigns, capture, transcriber,
    importRoots, importAccess, bundles, exportsDir, exportLocal, boot, tick, close, status, PLATFORM_REGISTRY, PLATFORM_PROFILES,
    presets: { list: () => listPresets(db), get: (id, version) => getPreset(db, id, version), fonts: (preset) => resolveFonts(preset) },
  };
}
