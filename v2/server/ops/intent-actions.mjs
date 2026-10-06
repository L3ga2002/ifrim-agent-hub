// M10: what Lega does with the desktop / plan intents — the SAME code path for typed text and voice (local or provider); only the
// authority differs, and it comes from the session and the source, never from the words or from a channel label in the request.
// - LOCAL_DIRECT (open / bring forward / show an approved folder): executed at once in the owner's session and verified.
//   An app not yet authorized becomes a plan card with that ONE decision (no settings page, no manual grant).
// - Anything that types, saves, records, imports or spans apps: a plan card (one confirmation); nothing starts before it.
// - "Continuă": resumes the ONE stopped plan within its original limits (uncertain steps are reconciled first).
// - "Preiau eu" / "Oprește tot": the operator stops at once (fail-safe, any channel); applications are never force-closed.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { HubError } from "../core/errors.mjs";
import { explain } from "../owner/blockers.mjs";
import { secretsNeeded } from "./plans.mjs";

/** Where the Studio's Unelte panel lives (Studio.jsx → ToolsPanel): „Fixează” and „Confirmă schimbarea”. */
export const STUDIO_TOOLS_PATH = "/studio?panel=tools";

/**
 * M10.2 (#28) — ONE readiness check for every Studio plan that renders (studio_create, the vertical variant, a correction card, the
 * capture plan): a read-only inspection of ffmpeg/ffprobe (nothing is pinned by a read) →
 *  - UNPINNED → { prepend: [media.tools.pin with the identity seen now] }: the pin is the FIRST step of the same card (automatic
 *    readiness inside the one confirmation), so a plan no longer derives a variant / applies a correction / records a demo and only
 *    then stops at the render with TOOLS_NOT_PINNED;
 *  - CHANGED / MISSING → { blocker }: the server's own explanation (blockers.mjs) — a changed binary is the owner's separate decision
 *    (Studio → Unelte), a missing one is installed outside the Hub; no plan is proposed;
 *  - PINNED (or no media service / an inspection that failed: the run itself re-verifies) → nothing to add.
 * `identity` per tool = { version, sha256, libsSha256 } (#30: the shared libraries are part of what the card shows and the pin checks).
 * `inspect: false` reads the last inspection only (the preserved-request explainer must not spawn processes).
 */
export async function studioRenderReadiness(hub, { inspect = true } = {}) {
  let t = null;
  try { t = inspect && hub?.media?.tools?.inspect ? await hub.media.tools.inspect() : hub?.media?.tools?.lastResolved?.() || null; } catch { t = null; }
  const states = Object.values(t?.states || {});
  const tools = !states.length ? null : states.includes("MISSING") ? "MISSING" : states.includes("CHANGED") ? "CHANGED" : states.includes("UNPINNED") ? "UNPINNED" : "PINNED";
  const identity = t ? Object.fromEntries(["ffmpeg", "ffprobe"].filter((k) => t[k]?.sha256).map((k) => [k, { version: t[k].version || null, sha256: t[k].sha256, libsSha256: t[k].libsSha256 || null }])) : null;
  if (tools === "UNPINNED") return { tools, identity, prepend: [{ kind: "media.tools.pin", params: { expect: identity } }], blocker: null };
  if (tools === "CHANGED" || tools === "MISSING") {
    // The plan targets an existing edit, so material exists by construction: only the tools' cause is asked of the explainer.
    const ex = explain({ intent: "studio", media: { assets: 1, editProjects: 1, tools } });
    return { tools, identity, prepend: [], blocker: ex.blocked ? ex : null };
  }
  return { tools, identity, prepend: [], blocker: null };
}

/**
 * A readiness blocker as a step answer (no work request is kept for these direct Studio actions, so the explainer's "cererea ta rămâne
 * păstrată" sentence is not repeated): the causes, the real ways out, and the Unelte panel for a changed binary.
 */
export function studioBlockedAnswer(blocker) {
  const lines = (blocker.blockers || []).map((b) => `${b.title}. ${b.detail}`.replace(/\.\./g, "."));
  const ways = (blocker.options || []).filter((o) => o.kind !== "refused").map((o) => o.label);
  const message = `Nu pregătesc planul acum: ${lines.join(" ")}${ways.length ? ` Ce se poate face: ${ways.join("; ")}.` : ""} Nimic nu a pornit.`;
  return { message, blockedBy: { signature: blocker.signature, cause: blocker.cause, text: message, options: blocker.options || [] },
    ...(blocker.cause === "MEDIA_TOOLS_CHANGED" ? { navigate: STUDIO_TOOLS_PATH } : {}) };
}

/** Spoken names of the usual Windows user folders (diacritics and case folded) → the folder's name under the profile. */
const USER_FOLDER_WORDS = Object.freeze({ videos: "Videos", video: "Videos", videoclipuri: "Videos", clipuri: "Videos", descarcari: "Downloads", downloads: "Downloads",
  documente: "Documents", documents: "Documents", desktop: "Desktop", desktopul: "Desktop", imagini: "Pictures", poze: "Pictures", pictures: "Pictures", muzica: "Music", music: "Music" });
const USER_FOLDER_NAMES = new Set(Object.values(USER_FOLDER_WORDS).map((n) => n.toLowerCase()));
const DEICTIC = /^(acesta|asta|aceasta|deschis|curent|de aici|aici|din fata|din fata mea)$/;
const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const sameDir = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const insideDir = (root, p) => { const rel = path.relative(path.resolve(root).toLowerCase(), path.resolve(p).toLowerCase()); return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel)); };

/**
 * M10.2 „Importă din <folder>” (Videos/Ifrim Studio, „folderul Ifrim Studio”, a full path) → { folderRef } read from the RAW words:
 * the resolver's normalization drops path separators, so the folder is taken from what the owner said, verbatim. A deictic
 * („din folderul acesta”) is the Explorer path (importHere), not a name, and returns null. Pure.
 */
export function parseImportFolder(raw) {
  const s = String(raw || "").trim().replace(/^(?:(?:hei|hey|bun[ăa])\s+)?lega[\s,!.:-]+/i, "").replace(/^(?:te rog,?\s+|po[țţt]i\s+s[ăa]\s+)+/i, "");
  const m = s.match(/^import[ăa](?:-l|-le|-mi)?\s+(?:(?:proiectul|proiectele|clipul|clipurile|materialele|materialul|fi[șşs]ierele|tot|video-ul|montajul)\s+)?(?:din|de\s+(?:[îi]n|la))\s+(?:(?:folderul|dosarul|directorul)\s+)?(?<ref>.+?)[\s.!?]*$/i);
  if (!m) return null;
  const ref = m.groups.ref.replace(/,?\s+te rog$/i, "").replace(/^["„“'«]+|["”“'»]+$/g, "").trim();
  if (!ref || ref.length > 400 || ref.includes("\0") || DEICTIC.test(fold(ref))) return null;
  return { folderRef: ref };
}

/** "verticală" / "TikTok" / "Reels" / "Shorts" / "LinkedIn" → a platform profile key (vertical defaults to TikTok 9:16). */
export function platformKeyFor(format) {
  const f = String(format || "").toLowerCase();
  if (/reels/.test(f)) return "reels_9x16";
  if (/shorts/.test(f)) return "shorts_9x16";
  if (/linkedin|patrat/.test(f)) return "linkedin_1x1";
  if (/youtube/.test(f)) return "youtube_16x9";
  return "tiktok_9x16";
}
/** The default tour of the Hub for a demonstration recording (Public Demo Mode masks sensitive fields before the first frame). */
export const DEFAULT_DEMO_STEPS = Object.freeze([{ goto: "/#/lega" }, { wait: 2500 }, { goto: "/#/studio" }, { wait: 2500 }, { goto: "/#/lega" }, { wait: 1500 }]);

export function createOpsIntentActions(hub) {
  const { desktop, opsPlans, media, settings, config } = hub;
  const sessionId = (session) => session?.id || null;
  // Review #40: the card names the secrets its confirmation must carry (the OBS password, typed in the card), so the cockpit's typed-„Da”
  // guard sees them without the plan body (names only, never values).
  const planCard = (plan, note) => ({ opsPlan: { id: plan.id, kind: plan.kind, title: plan.title, status: plan.status, summary: plan.summary, hash: plan.hash, nonce: plan.nonce, confirmBy: plan.confirmBy, decisions: plan.body.decisions,
    needsSecrets: Array.isArray(plan.needsSecrets) ? plan.needsSecrets : secretsNeeded(plan.body?.steps) },
    note: note || `Plan afișat: ${plan.summary.steps.length} pași, o singură confirmare. Nimic nu a pornit.` });

  /** „Deschide CapCut” / „Adu OBS în față” / „Arată folderul exporturilor”. */
  async function local(step, { ctx, session }) {
    if (!desktop) return { refused: "Operatorul desktop nu e disponibil pe acest Hub." };
    if (ctx.channel !== "owner" && ctx.channel !== "test") return { refused: "Comenzile pe desktop pornesc din sesiunea ta de proprietar (deschide sesiunea cu Windows Hello în cockpit)." };
    const args = { channel: ctx.channel, actor: ctx.actor, sessionId: sessionId(session) };
    try {
      if (step.intent === "desktop_folder") return { desktop: await desktop.showFolder({ ...args, folder: null }) };
      if (!step.args.app) return { message: "Ce aplicație? Știu CapCut, OBS Studio, Notepad și Explorer." };
      if (step.intent === "desktop_focus") return { desktop: await desktop.focusApp({ ...args, app: step.args.app }) };
      return { desktop: await desktop.openApp({ ...args, app: step.args.app }) };
    } catch (error) {
      // An installed, identity-verified app that is not authorized yet: ONE card with that decision (step-up at confirmation).
      const app = step.args.app ? desktop.apps.get(step.args.app) : null;
      if (error.code === "NEEDS_DECISION" && app && !app.authorized && app.status === "DISCOVERED" && step.intent === "desktop_open") {
        const plan = await opsPlans.propose({ kind: "desktop.open", title: `Deschide ${app.displayName}`, steps: [{ kind: "desktop.app.open", title: `Deschide ${app.displayName} și adu-l în față`, params: { app: app.id } }], actor: ctx.actor, via: ctx.channel });
        return planCard(plan, `${app.displayName} ${app.version || ""} e instalat și semnat (${app.signature?.signer?.split(",")[0] || "verificat"}), dar nu e încă autorizat pentru operator. Confirmi o dată (cu Windows Hello) și îl deschid; după asta „Deschide ${app.displayName}” merge direct.`);
      }
      if (error.code === "NEEDS_DECISION" && app && app.status !== "DISCOVERED") return { message: `${app.displayName} nu e găsit sau nu i-am putut verifica semnătura pe acest calculator (${app.status}). Spune „Caută aplicațiile” după instalare.` };
      throw error;
    }
  }

  /** „Importă din folderul acesta”: the folder of the Explorer window in front → the import card (the project preview inside it). */
  async function importHere({ ctx, session }) {
    if (!desktop) return { refused: "Operatorul desktop nu e disponibil pe acest Hub." };
    if (ctx.channel !== "owner" && ctx.channel !== "test") return { refused: "Citesc folderul deschis doar în sesiunea ta de proprietar." };
    const cur = await desktop.currentFolder({ channel: ctx.channel, actor: ctx.actor, sessionId: sessionId(session) });
    if (!cur.folder) return { message: "Nu văd nicio fereastră Explorer cu un folder. Deschide folderul proiectului în Explorer și spune din nou „Importă din folderul acesta”." };
    const plan = await opsPlans.propose({ kind: "studio.import", title: "Importă proiectul în Studio", steps: [{ kind: "media.project.import", params: { folder: cur.folder } }], actor: ctx.actor, via: ctx.channel });
    return { ...planCard(plan, plan.body.decisions.length ? `Folderul ${cur.folder} nu e printre folderele de import: îți cer o singură dată acces pentru acest import (expiră după el).` : `Folderul ${cur.folder}: îți arăt exact ce se importă; nimic nu s-a importat încă.`), folder: cur.folder };
  }

  /**
   * The real folders a spoken folder name can mean, without an Explorer window: a full path as said; „Videos/Ifrim Studio” under the
   * user folder of that name (the profile's, and the parent of an import root that IS such a folder — %USERPROFILE%\Videos is the
   * default root); otherwise a subfolder of an import root (two levels at most) with that name, compared without diacritics or case.
   * Read-only (names only, bounded), real paths with links resolved; at most 4 candidates (more → the owner names it exactly).
   */
  function findImportFolders(ref) {
    const roots = (() => { try { return media?.importRoots?.() || []; } catch { return []; } })();
    const out = [];
    const add = (p) => {
      try { const real = fs.realpathSync.native(p); if (fs.statSync(real).isDirectory() && !out.some((x) => sameDir(x, real))) out.push(real); } catch { /* not there */ }
    };
    const raw = String(ref || "").trim();
    if (/^[a-z]:[\\/]/i.test(raw) || (path.isAbsolute(raw) && !/^[\\/]{2}/.test(raw))) { add(path.resolve(raw)); return out; }
    if (/^[\\/]{2}/.test(raw)) return out; // a network path is refused by the import itself; never resolved here
    const parts = raw.split(/[\\/]+/).map((x) => x.trim()).filter(Boolean);
    if (!parts.length || parts.some((x) => x === "." || x === "..")) return out;
    const head = USER_FOLDER_WORDS[fold(parts[0])];
    if (head) {
      // Test mode never looks at the real profile (the same rule as media importRoots(): no implicit %USERPROFILE%\Videos there).
      const bases = [...(config?.testMode ? [] : [os.homedir()]), ...roots.filter((r) => USER_FOLDER_NAMES.has(path.basename(r).toLowerCase())).map((r) => path.dirname(r))];
      for (const b of bases) add(path.join(b, head, ...parts.slice(1)));
      if (out.length) return out.slice(0, 4);
    }
    const want = fold(parts.join("/"));
    const last = fold(parts.at(-1));
    for (const r of roots) {
      add(path.join(r, ...parts));
      let level1 = [];
      try { level1 = fs.readdirSync(r, { withFileTypes: true }).filter((e) => e.isDirectory()).slice(0, 400); } catch { continue; }
      for (const e of level1) {
        const abs = path.join(r, e.name);
        if (parts.length === 1 && fold(e.name) === want) add(abs);
        let level2 = [];
        try { level2 = fs.readdirSync(abs, { withFileTypes: true }).filter((x) => x.isDirectory()).slice(0, 200); } catch { continue; }
        for (const x of level2) if (fold(x.name) === last && (parts.length === 1 || fold(e.name) === fold(parts.at(-2)))) add(path.join(abs, x.name));
      }
      if (out.length >= 4) break;
    }
    return out.slice(0, 4);
  }

  /**
   * „Importă din Videos/Ifrim Studio”: the named folder → ONE import card through the existing media.project.import step (a Studio
   * project bundle, or older edit plans reconstructed). Inside the import roots the card carries no decision; outside them it carries
   * ONE folder decision (a one-time access for this import, consumed and expiring with it) confirmed with a fresh Windows Hello —
   * the global allowlist is never widened. Reading a folder OUTSIDE the roots (even names and counts) needs the owner session (or the
   * Lega session derived from it): a cookie-less request or a provider transcript without that authority only reaches the roots.
   */
  async function importFolder(step, { ctx, ownerContext = false }) {
    const ref = step.args.folderRef || "";
    const roots = (() => { try { return media?.importRoots?.() || []; } catch { return []; } })();
    const inRootsOf = (f) => roots.some((r) => insideDir(r, f));
    const outsideRefusal = `Un folder din afara folderelor de import îl citesc doar în sesiunea ta de proprietar (cockpit) sau în sesiunea Lega derivată din ea.`;
    let folder = step.args.chosenFolder || null;
    if (!folder) {
      // Without the owner session only the import roots are looked at, and the answer is the same whether a folder outside them
      // exists or not (a cookie-less request learns nothing about the rest of the disk).
      const found = findImportFolders(ref).filter((f) => ownerContext || inRootsOf(f));
      if (!found.length && !ownerContext) return { refused: `Nu găsesc „${String(ref).slice(0, 120)}” în folderele de import. ${outsideRefusal}` };
      if (!found.length) {
        return { message: `Nu găsesc folderul „${String(ref).slice(0, 120)}”${roots.length ? ` (am căutat în ${roots.slice(0, 3).join(", ")})` : ""}. Spune calea completă, de exemplu C:\\Users\\…\\Videos\\Ifrim Studio\\<proiect>.` };
      }
      if (found.length > 1) {
        return { candidates: found, clarification: { question: `Din care folder import: ${found.map((f) => `„${f}”`).join(" sau ")}?`, options: found.map((f, i) => ({ id: `f${i + 1}`, label: f })), forIntent: "studio_import_folder" } };
      }
      folder = found[0];
    }
    if (!inRootsOf(folder) && !ownerContext) return { refused: outsideRefusal };
    try {
      const plan = await opsPlans.propose({ kind: "studio.import", title: `Importă proiectul din ${path.basename(folder)}`, steps: [{ kind: "media.project.import", params: { folder } }], actor: ctx.actor, via: ctx.channel });
      const note = plan.body.decisions.length
        ? `Folderul ${folder} nu e printre folderele de import: îți cer o singură dată acces doar pentru acest import (îl confirmi cu Windows Hello; se consumă la import și expiră odată cu planul). Nimic nu s-a importat încă.`
        : `Folderul ${folder}: îți arăt exact ce se importă (copii; originalele rămân neatinse). Nimic nu s-a importat încă.`;
      return { ...planCard(plan, note), folder };
    } catch (error) {
      if (error.code === "BUNDLE_MISSING") {
        return { message: `Folderul ${folder} nu conține un proiect Studio (proiect-studio.json) și nici planuri de montaj de reconstruit. Din vorbă import doar proiecte Studio; fișierele video simple le adaugi în Studio → Bibliotecă.`, navigate: "/studio", folder };
      }
      if (["IMPORT_PATH_REFUSED", "IMPORT_PATH_INVALID", "IMPORT_PATH_MISSING", "BUNDLE_PROBLEMS", "BUNDLE_INVALID", "BUNDLE_FORMAT", "IMPORT_ACCESS_CHANGED"].includes(error.code)) return { message: error.message, folder };
      throw error;
    }
  }

  /** The current (non-variant) edit version of a content project's only edit plan, or a question. */
  function masterOf(contentProjectId) {
    const edits = media.edits.list({ contentProjectId }) || [];
    if (edits.length !== 1) return { question: edits.length ? "Clipul are mai multe planuri de montaj; deschide-l pe cel dorit în Studio." : "Clipul nu are încă un plan de montaj." };
    const edit = media.edits.get(edits[0].id);
    return edit?.current ? { edit, version: edit.current } : { question: "Planul de montaj nu are o versiune curentă." };
  }

  /** „Pregătește varianta verticală” for the clip in front of the owner (the one open clip, or the referenced one). */
  async function variant(step, { ctx, target }) {
    if (target.question) return { message: target.question, navigate: target.navigate };
    const m = masterOf(target.project.id);
    if (m.question) return { message: m.question, navigate: `/studio/${target.project.id}` };
    const key = platformKeyFor(step.args.format);
    // #28: the tools' readiness BEFORE proposing — the pin is the card's first step, or an honest blocker (nothing derived).
    const ready = await studioRenderReadiness(hub);
    if (ready.blocker) return studioBlockedAnswer(ready.blocker);
    const plan = await opsPlans.propose({ kind: "studio.variant", title: `Varianta ${key} pentru „${target.project.title}”`, steps: [...ready.prepend, { kind: "media.variant.render", params: { masterVersionId: m.version.id, platformKey: key } }], actor: ctx.actor, via: ctx.channel });
    return { ...planCard(plan, `${ready.prepend.length ? "Întâi fixez ffmpeg/ffprobe (identitatea arătată în card), ca pas al acestui plan. " : ""}Încadrare, texte lizibile, randare finală și QA automat; revizuirea creativă rămâne a ta. Nimic nu se publică.`), navigate: `/studio/${target.project.id}` };
  }

  /** „Înregistrează demonstrația și pregătește varianta verticală, fără să publici” → ONE cross-app / Studio plan. */
  async function captureVertical(step, { ctx }) {
    const policy = settings.get("mediaPolicy") || {};
    if (policy.liveCapture !== true) {
      return { message: "Înregistrarea reală (Hub-ul live sau ecranul prin OBS) cere decizia MB1 din foaia de activare M10 — nu o pornesc fără ea. Până atunci pot pregăti varianta verticală a unui clip existent: spune „Pregătește varianta verticală”.",
        blockedBy: ["MB1"] };
    }
    const key = step.args.vertical ? "tiktok_9x16" : "youtube_16x9";
    const first = step.args.obs
      ? (policy.obs?.recordingRoot
        ? { kind: "capture.obs_record", params: { durationSec: Math.min(120, Number(policy.obs?.defaultDurationSec) || 20), scene: policy.obs?.scene || null, recordingRoot: policy.obs.recordingRoot, obsUrl: policy.obs?.url || "ws://127.0.0.1:4455", title: "Demonstrație OBS" } }
        : null)
      : { kind: "capture.browser_demo", params: { origin: `http://localhost:${config.port}`, steps: DEFAULT_DEMO_STEPS, title: "Demonstrație Hub", captureLabel: "ORIGINAL_RECORDING", maxDurationMs: 60000 } };
    if (!first) return { message: "Pentru înregistrarea cu OBS îmi trebuie folderul înregistrărilor OBS (pasul OBS din foaia de activare M10)." };
    // #28: checked BEFORE the recording — a demo recorded and montaged that then cannot render is a plan stopped after its effects.
    const ready = await studioRenderReadiness(hub);
    if (ready.blocker) return studioBlockedAnswer(ready.blocker);
    // `$pas:N` is 1-based over the final list, so a prepended pin step shifts every reference by its length.
    const at = (n) => n + ready.prepend.length;
    const steps = [...ready.prepend, first,
      { kind: "media.edit.from_capture", params: { assetVersionId: `$pas:${at(1)}.assetVersionId`, title: "Demonstrație", label: step.args.obs ? "ÎNREGISTRARE ORIGINALĂ" : "Demonstrație Hub" } },
      { kind: "media.render", params: { editVersionId: `$pas:${at(2)}.editVersionId`, profile: "final" } },
      { kind: "media.variant.render", params: { masterVersionId: `$pas:${at(2)}.editVersionId`, platformKey: key } }];
    const plan = await opsPlans.propose({ kind: "studio.capture_variant", title: `Înregistrare demonstrație + variantă ${key} (fără publicare)`, steps, actor: ctx.actor, via: ctx.channel });
    return planCard(plan, `Un singur plan: ${ready.prepend.length ? "fixarea uneltelor → " : ""}înregistrare → montaj → randare → variantă → QA. Nu publică și nu încarcă nimic.`);
  }

  /** „La secunda 12 mută textul mai sus”: the correction proposed on the current version becomes ONE edit plan (apply + render + QA). */
  async function editPlan({ review, target, ctx }) {
    if (review.patch?.clarification || !(review.patch?.ops || []).length || review.patch?.preview?.valid === false) return null;
    // #28: the card renders a draft, so the tools' readiness comes first. A blocker is reported as the card's absence (planError,
    // the honest reason); the correction proposal itself stays (it touches nothing until applied).
    const ready = await studioRenderReadiness(hub);
    if (ready.blocker) { const b = studioBlockedAnswer(ready.blocker); return { planError: b.message, blockedBy: b.blockedBy }; }
    const plan = await opsPlans.propose({ kind: "studio.edit", title: `Corectură în „${target.project.title}”`,
      steps: [...ready.prepend, { kind: "media.edit.correct", params: { editVersionId: target.version.id, text: review.text, atSec: review.timecodeMs != null ? review.timecodeMs / 1000 : null, reviewId: review.id, render: "draft" } }], actor: ctx.actor, via: ctx.channel });
    return planCard(plan, `Confirmi o dată: ${ready.prepend.length ? "fixez ffmpeg/ffprobe (identitatea arătată), " : ""}aplic corectura (versiune nouă, originalul rămâne), randez ciorna și rulez QA. Revizuirea creativă rămâne a ta.`);
  }

  /** „Continuă”: the ONE stopped plan (and the paused operator) resumes within the same limits. */
  async function resume({ ctx, session }) {
    if (ctx.channel !== "owner" && ctx.channel !== "test") return { refused: "„Continuă” reia lucrul: îl spui în sesiunea ta de proprietar." };
    const stopped = opsPlans.active().filter((p) => ["PAUSED", "NEEDS_OWNER"].includes(p.status));
    const ds = desktop?.sessionStatus?.();
    if (!stopped.length) {
      if (ds && ds.status === "PAUSED") return { desktop: await desktop.resume({ actor: ctx.actor }), note: "Operatorul poate primi din nou comenzi; nu reiau singur nimic din ce făcea." };
      return { message: "Nu am niciun plan oprit de continuat." };
    }
    if (stopped.length > 1) return { clarification: { question: `Care plan: ${stopped.slice(0, 4).map((p) => `„${p.title}”`).join(" sau ")}?`, options: stopped.slice(0, 4).map((p) => ({ id: p.id, label: p.title })), forIntent: "ops_continue" } };
    if (ds && ds.status === "PAUSED") await desktop.resume({ actor: ctx.actor });
    const plan = await opsPlans.resume(stopped[0].id, { session, actor: ctx.actor });
    return { plan: { id: plan.id, title: plan.title, status: plan.status }, note: "Continui exact planul confirmat (aceleași limite). Pașii incerți i-am verificat întâi." };
  }

  /** „Preiau eu”: the operator stops and leaves the desktop to the owner; running plans pause. */
  async function takeover({ ctx }) {
    const out = desktop ? await desktop.takeover({ actor: ctx.actor }) : null;
    const paused = [];
    for (const p of opsPlans.active().filter((x) => ["RUNNING", "CONFIRMED"].includes(x.status))) { opsPlans.pause(p.id, { reason: "Preiau eu", actor: ctx.actor }); paused.push(p.id); }
    return { desktop: out, plansPaused: paused };
  }
  const busy = () => Boolean(desktop?.sessionStatus?.()) || opsPlans.active().some((p) => ["RUNNING", "CONFIRMED"].includes(p.status));

  /** A "Da" for a presented plan: the exact id + nonce + hash the page showed; voice only with the local evidence for this plan. */
  async function confirm({ presented, ctx, session, source, utteranceId }) {
    if (ctx.channel !== "owner" && ctx.channel !== "test") throw new HubError("authentication", "Confirmarea se face în sesiunea ta autentificată.");
    return opsPlans.confirm({ planId: presented.planId, nonce: presented.nonce, displayedHash: presented.hash, session, modality: source === "voice-local" ? "voice" : "typed",
      utteranceId: source === "voice-local" ? utteranceId : null, idempotencyKey: ctx.commandId });
  }

  return { local, importHere, importFolder, findImportFolders, variant, captureVertical, editPlan, resume, takeover, busy, confirm, masterOf };
}
