// M10: what Lega does with the desktop / plan intents — the SAME code path for typed text and voice (local or provider); only the
// authority differs, and it comes from the session and the source, never from the words or from a channel label in the request.
// - LOCAL_DIRECT (open / bring forward / show an approved folder): executed at once in the owner's session and verified.
//   An app not yet authorized becomes a plan card with that ONE decision (no settings page, no manual grant).
// - Anything that types, saves, records, imports or spans apps: a plan card (one confirmation); nothing starts before it.
// - "Continuă": resumes the ONE stopped plan within its original limits (uncertain steps are reconciled first).
// - "Preiau eu" / "Oprește tot": the operator stops at once (fail-safe, any channel); applications are never force-closed.
import { HubError } from "../core/errors.mjs";

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
  const planCard = (plan, note) => ({ opsPlan: { id: plan.id, kind: plan.kind, title: plan.title, status: plan.status, summary: plan.summary, hash: plan.hash, nonce: plan.nonce, confirmBy: plan.confirmBy, decisions: plan.body.decisions },
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
    const plan = await opsPlans.propose({ kind: "studio.variant", title: `Varianta ${key} pentru „${target.project.title}”`, steps: [{ kind: "media.variant.render", params: { masterVersionId: m.version.id, platformKey: key } }], actor: ctx.actor, via: ctx.channel });
    return { ...planCard(plan, "Încadrare, texte lizibile, randare finală și QA automat; revizuirea creativă rămâne a ta. Nimic nu se publică."), navigate: `/studio/${target.project.id}` };
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
    const steps = [first,
      { kind: "media.edit.from_capture", params: { assetVersionId: "$pas:1.assetVersionId", title: "Demonstrație", label: step.args.obs ? "ÎNREGISTRARE ORIGINALĂ" : "Demonstrație Hub" } },
      { kind: "media.render", params: { editVersionId: "$pas:2.editVersionId", profile: "final" } },
      { kind: "media.variant.render", params: { masterVersionId: "$pas:2.editVersionId", platformKey: key } }];
    const plan = await opsPlans.propose({ kind: "studio.capture_variant", title: `Înregistrare demonstrație + variantă ${key} (fără publicare)`, steps, actor: ctx.actor, via: ctx.channel });
    return planCard(plan, "Un singur plan: înregistrare → montaj → randare → variantă → QA. Nu publică și nu încarcă nimic.");
  }

  /** „La secunda 12 mută textul mai sus”: the correction proposed on the current version becomes ONE edit plan (apply + render + QA). */
  async function editPlan({ review, target, ctx }) {
    if (review.patch?.clarification || !(review.patch?.ops || []).length || review.patch?.preview?.valid === false) return null;
    const plan = await opsPlans.propose({ kind: "studio.edit", title: `Corectură în „${target.project.title}”`,
      steps: [{ kind: "media.edit.correct", params: { editVersionId: target.version.id, text: review.text, atSec: review.timecodeMs != null ? review.timecodeMs / 1000 : null, reviewId: review.id, render: "draft" } }], actor: ctx.actor, via: ctx.channel });
    return planCard(plan, "Confirmi o dată: aplic corectura (versiune nouă, originalul rămâne), randez ciorna și rulez QA. Revizuirea creativă rămâne a ta.");
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

  return { local, importHere, variant, captureVertical, editPlan, resume, takeover, busy, confirm, masterOf };
}
