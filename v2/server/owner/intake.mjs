// M10.2 intake: ONE command path for the owner's words. Typed text in the cockpit, a locally verified spoken sentence, a provider
// transcript (the browser forwarder today, the server voice bridge in U08) and a clarification button all run THIS executor; the
// source changes only what the effect-class matrix (policy/effect-class.mjs) allows, never the code that executes a step.
//
// - Authority never comes from words or client fields. A provider transcript may run a simple local action only under the derived
//   Lega owner-session authority the SERVER verified (the running Lega session is the one named, it was derived from a valid owner
//   session, that session is active, not idle, its credential active and the voice-first policy on) — a client's legaSessionId alone
//   is a claim, not an authority.
// - Conversation state (the last target the owner acted on, the open clarification, a pending verb) lives in memory per owner
//   session: lost on restart (fail-safe), written only from EXECUTED results, never accepted from a payload.
// - Bounded work (a clip, a mission start or resume, engineering, a run) goes through planners: each returns ONE plan card, a
//   blocker kept as a work request, a question or a message — never an effect. Every plan is announced as the live event lega.plan.
// - A confirmation happens only on the owner channel, for the presented id + nonce + hash, from typed or locally verified voice.
// - M10.2.1 (D14–D20): a request that meets a suspended gate gets the contextual rearm card (owner session) or the honest reason —
//   never an administration pointer; the owner's verified spoken „Continuă” runs the SAME executor as the typed one (continueFromVoice).
// - 2.12.1 (D22): „Continuă” holds only what the current suspension's own stop stopped (owner/stop-scope.mjs: a Stop All, the shutdown,
//   a security stop) and the missions, which need the open gate; work stopped for any other reason resumes as before, gate or not.
import { HubError } from "../core/errors.mjs";
import { parse } from "../storage/db.mjs";
import { resolveIntent, matchRef, normalize, stripFillers, INTENT_EFFECTS, CONTINUE_QUESTION, stopTalkAnswer, modeAnswer, PREVIEW_START, stripOutreach, SALES_SEND_REASON,
  QUOTED_OUTREACH_NOTE, OWN_OUTREACH_TEXT, outreachCutNote } from "./intents.mjs";
import { layoutForIntent } from "./layout.mjs";
import { localDayStart } from "../intel/twin.mjs";
import { PACKAGE_KINDS } from "../intel/packages.mjs";
import { createOpsIntentActions, parseImportFolder, importWithoutFolder, IMPORT_FOLDER_HELP } from "../ops/intent-actions.mjs";
import { classOfIntent, refusalReason } from "../policy/effect-class.mjs";
import { classifySuspension, credentialTag, STOPPED_BY } from "../policy/gate-state.mjs";
import { createStopScope, STOP_HOLD_CLASSES } from "./stop-scope.mjs";
import { createContentPlanner } from "./planners/content.mjs";
import { collectFacts } from "./readiness-runner.mjs";
import { explain } from "./blockers.mjs";
import { ARMED_LIMITS } from "./armed-window.mjs";
import { createSalesKeptRequests, SALES_KEPT_INTENT } from "./sales-kept.mjs";

/** Content stages whose clip is no longer being edited (a correction or "the open clip" never targets them). */
const STUDIO_CLOSED_STAGES = new Set(["ARCHIVED", "PUBLISHED", "ANALYTICS"]);
/** An open clarification (its options) is answerable for 2 minutes; a bare verb waits 5 s for its object. */
export const INTAKE_LIMITS = Object.freeze({ clarificationTtlMs: 2 * 60 * 1000, verbSlotMs: 5000, transcriptTtlMs: 10 * 60 * 1000, transcriptMax: 500, conversationMax: 50 });
/** Planner kinds the intake knows (U09/U10/U11 register theirs in their own files; a kind with no planner answers honestly). */
export const PLANNER_KINDS = Object.freeze(["studio_create", "start_mission", "resume_mission", "engineering", "run", "delivery", "sales", "desk"]);
/** The resolver intents that become ONE plan through a registered planner (intent → planner kind). */
export const PLANNER_FOR_INTENT = Object.freeze({ studio_create: "studio_create", start_mission: "start_mission", resume_mission: "resume_mission",
  engineering_request: "engineering", analysis_request: "run",
  // M11: preparing / revising / opening a delivery (owner/planners/delivery.mjs).
  delivery_prepare: "delivery", delivery_revise: "delivery", delivery_open: "delivery", delivery_status: "delivery", delivery_decisions: "delivery",
  // M12: preparing a synthetic offer (owner/planners/sales.mjs): one card, the offer's approval stays the owner's decision.
  sales_prepare: "sales",
  // M12 final review: „Continuă pregătirea ofertei” — the Sales planner proposes ONE continuation card (or says truthfully why not).
  sales_continue: "sales",
  // M13 „Birou intern”: the start dossier, a support case and the deviz (owner/planners/desk.mjs): one card each, no model.
  desk_ops_prepare: "desk", desk_support_prepare: "desk", desk_finance_prepare: "desk",
  // A planner question asked through lega.request_work has no resolver step: its answer (choice forIntent engineering/run) comes back here.
  engineering: "engineering", run: "run", sales: "sales" });
/**
 * Intents that only REDUCE what reaches the owner and are therefore accepted from every live source, like the interruptions:
 * „Nu mă deranja” (only decisions interrupt) changes no work and adds no authority. Its class stays SIMPLE_LOCAL_ACTION in the
 * matrix (it writes a preference); the reverse („Poți să mă anunți”) and the start screen still need typed input or the derived
 * authority.
 */
const FAIL_SAFE_INTENTS = new Set(["quiet"]);
/** A bare verb with no object („Deschide”, a provider transcript cut in two) → the ONE question asked while the slot waits. */
const BARE_VERBS = Object.freeze({ deschide: "Ce să deschid?", "arata-mi": "Ce să-ți arăt?", arata: "Ce să-ți arăt?", lanseaza: "Ce să lansez?", adu: "Ce să aduc în față?",
  "treci pe": "Pe ce să trec?", "du-ma la": "Unde să te duc?", "mergi la": "Unde să merg?" });
const LEGA_PREFIX = /^(hei |hey |buna )?lega[,!. ]+/;
/** "Anulează planul" withdraws the plan (CANCELLED); "Nu" / "Nu acum" / "Nu vreau planul" only hold it (nothing starts, the card stays). */
const CANCEL_WORDS = /\b(anuleaza|anulati|renunta|renunt|abandoneaza|arunca)\b/;
// P0-R6 (L11): „Ce a rămas în …” with two plausible project names asks which one (the resolver's question, forIntent status).
// D3: „Rulează preview-ul …” the same (the resolver's question, or the intake's „Pe ce proiect să-ți arăt preview-ul?”).
const PROJECT_CHOICE = new Set(["open_project", "switch_project", "freeze_project", "unfreeze_project", "autonomy", "status", "show_preview"]);
const MISSION_CHOICE = new Set(["continue_work", "start_mission", "resume_mission", "show_plan"]);
/**
 * The project a freeze / unfreeze / autonomy step acts on: the one its words named (resolved), the open one only when the words named
 * none. A name that matched nothing or several projects gives null, never the open project.
 */
const namedProject = (step, openProjectId) => step.args.projectId || (step.args.projectRef ? null : openProjectId || null);
/** What the Hub says when namedProject found nothing: the name it could not find, the question it asked, or its own question. */
const unnamedProject = (step, question, nothingDone) => (step.args.unknownRef ? `Nu găsesc proiectul „${step.args.unknownRef}”; ${nothingDone}.`
  : step.args.projectRef ? `Spune-mi exact proiectul; până atunci ${nothingDone}.` : question);
/**
 * D3 review: the planner kinds whose request is answered as the preview read when the words are a pure preview read (a model run or a
 * mission: the live defect, „Rulează preview-ul Pro Delivery” → two Claude analyses). A Studio request („Fă un preview video…”) is a clip.
 */
const PREVIEW_OVERRIDE_KINDS = new Set(["run", "engineering", "start_mission", "resume_mission"]);
/** D3 review: a work verb anywhere in the words makes them work, never a pure preview read (on normalized words). */
const PREVIEW_WORK_VERBS = /\b(?:creeaza|construieste|implementeaza|analizeaza|repara|rezolva|corecteaza|adauga|scrie|refactorizeaza|citeste|rezuma|revizuieste|evalueaza|explica|investigheaza|modifica|genereaza|optimizeaza|actualizeaza|sterge|fa|faceti|face)\b/;
/** D3 review: a show verb on the preview („Arată-mi / Vreau să văd / Deschide preview-ul”), on the prepared clause. */
const PREVIEW_SHOW_VERB = /^(?:arata|vreau sa vad|deschide|pune|da)(?:-mi)?\b/;
/** Bounded requests whose open question was about the PROJECT (review #5): the choice id is a project id. */
const REQUEST_PROJECT_CHOICE = new Set(["engineering_request", "analysis_request"]);
const NAV_KINDS = new Set(["project", "clip", "screen", "plan", "mission"]);
/**
 * M10.2.1 (D19): the explicit spoken pause — „pune (totul) pe pauză” — counts as the owner's like an addressed one („Lega, …”); the
 * fast path's explicit form, with „tot / totul / toate”. A bare „pauză”, „pauză acum”, „ia o pauză” without Lega's name is not.
 */
const EXPLICIT_PAUSE = /^pune (?:(?:totul|tot|toate) )?pe pauza(?: (?:totul|tot|toate))?(?: acum| imediat)?$/;
/** D20: a confirmed plan that expired this recently is the likely reason a „Continuă” finds nothing to resume. */
const EXPIRED_POINTER_MS = 24 * 3600000;
/** D18: the voice path's idempotency memory (per utterance id), bounded; the database consumption is the durable guard. */
const VOICE_CONTINUE_MAX = 200;
/** VOICE-01: how long the owner's verified spoken „Continuă” waits for Lega's provider copy of the same sentence (a veto, never more). */
const VOICE_COPY_WAIT_MS = 2500;
/** VOICE-01: how long a vetoed resume waits for the bridge's own answer to that copy before saying the clarification itself. */
const VOICE_COPY_SETTLE_MS = 4000;
const VOICE_COPY_POLL_MS = 40;
/** VOICE-02: the same refusal of a spoken „Continuă” is said at most once in this window per Lega session (one sentence, one answer). */
const VOICE_REFUSAL_REPEAT_MS = 10000;
/** VOICE-06: a pause said under a negation or a condition is never the owner's credential-bound pause (D19 attributes only an affirmative one). */
const PAUSE_CONDITION = /\b(?:daca|cand|dupa ce|doar daca)\b/;
/** VOICE-04: the not-yet answers of a suspension the owner rearms later, in the cockpit (never by voice). */
const REARM_LATER = new Set(["OWNER_SESSION", "LEGA_ACTIVE", "RUNS_ACTIVE", "CANCEL_PENDING"]);
/** SM-07: the cause of a pause another authenticator of the owner recorded (not this session's own pause: the rearm card reopens it). */
const OTHER_PAUSE_BY = "printr-o pauză din altă sesiune a ta (alt autentificator)";
/** The owner's own pause that this answer did not reopen (a clarification choice never reopens the gate). */
const OWN_PAUSE_AGAIN = "Ai pus Hub-ul pe pauză din sesiunea ta: spune sau scrie „Continuă” și îl reiau în aceleași limite.";
/** VOICE-04: where the gate IS reopened, said by voice (the card in the cockpit, a fresh Windows Hello; nothing reopens by itself). */
const REOPEN_SPOKEN = "o redeschizi în cockpit, pe cardul „Redeschide poarta”, cu Windows Hello — nu prin voce; nimic nu se redeschide singur";
/** VOICE-01: the veto of a copy that carried the resume among other words (the question has the resolver's own CONTINUE_QUESTION). */
const VETO_MIXED = "Lega a auzit „Continuă” împreună cu alte cuvinte, așa că nu reiau nimic acum; ca să reiau, spune „Continuă” singur.";
const NOTHING_HELD = Object.freeze({ cls: "open", ops: new Set(), desktop: false, missions: new Set() });
const capitalize = (text) => (text ? `${text.charAt(0).toLocaleUpperCase("ro-RO")}${text.slice(1)}` : text);
/**
 * 2.12.2 (P0-R6, L7): the reads and plans that need a project and ask for it when none is known. The question is remembered like the
 * planners' (rememberProjectQuestion), so a following sentence that only names a project completes it within the clarification TTL.
 */
const PROJECT_QUESTION_TEXT = Object.freeze({ show_plan: "Pe ce proiect să-ți arăt planul?", continue_work: "Pe ce proiect continui?", status: "Pe ce proiect să mă uit?",
  show_preview: "Pe ce proiect să-ți arăt preview-ul?" });
/** R4-F8: the owner's own Stop All in the event log — its own stop kind when recorded, else any stop that is not the Hub's shutdown. */
const OWNER_STOP_ALL_SQL = `SELECT created_at, source FROM events WHERE scope_type = 'system' AND scope_id = 'hub' AND type = 'system.stop_all'
  AND (json_extract(payload_json, '$.stopKind') = 'stop_all' OR (json_extract(payload_json, '$.stopKind') IS NULL AND source <> 'system')) ORDER BY seq DESC LIMIT 1`;
/** R2-F7: the channel a Stop All came from, from its event source (runs.stopAll stamps the command's actor); enum keys only. */
const stopVia = (source) => {
  const s = String(source || "");
  if (s === "voice" || s.startsWith("voice:")) return "voice";
  if (s.startsWith("owner:")) return "owner";
  if (s.startsWith("device:")) return "companion";
  return s === "user" ? "ui" : null;
};
/**
 * R4 (UNKNOWN_INTENTS, exact): whether the Hub answered an unknown step — with its own words (a message, a question, a refusal, an error,
 * an explanation) or with the resolver's refusal / question for it (a confirmation it could not take, „Continuă?”, a plan start it could
 * not read, a bare verb's question). A step left with none of these is a sentence the Hub did not understand and said nothing about.
 */
const answeredUnknown = (step, r, resolved) => Boolean(step?.args?.refusedConfirmation || step?.args?.pendingVerb
  || ((step?.args?.continueQuestion || step?.args?.planStartUnclear) && resolved?.clarification)
  || r?.message || r?.clarification || r?.refused || r?.error || r?.explain);
/** VOICE-05: the owner's own words, quoted as heard (bounded; the closing punctuation dropped). */
const heardQuote = (heard) => String(heard || "").replace(/[\s.!…]+$/u, "").slice(0, 120) || "Continuă";
/**
 * Review F2 (L4): the planner questions a plain pick may answer — any planner question with exactly ONE option (the run / analysis
 * planner's, or the request it was asked for; since M11 L5 the engineering planner offers no test to pick).
 */
const PICK_FOR = new Set(["engineering", "run", "engineering_request", "analysis_request"]);
/** „Alege-l”, „Folosește-l”, „Primul”, „Pe acela”, „Da, alege-l” (normalized). Never a bare „Da”: that word confirms a plan. */
const PLAIN_PICK = /^(?:(?:da|ok|okay|bine|sigur)[\s,]+)?(?:alege(?:-l|-o)?|foloseste(?:-l|-o)?|ia(?:-l|-o)|primul|prima|pe primul|pe prima|acela|acesta|pe acela|pe acesta|pe el|pe ala|asta|pe asta)(?:[\s,]+(?:pe el|pe ea|pe acela|pe acesta|pe asta|te rog|ca dovada))*$/;
const PICK_WORDS = /\b(?:alege-l|alege-o|alege|foloseste-l|foloseste-o|foloseste|testul|test|fisierul|fisier|pe|cel|da|ok|te rog)\b/g;
const flatWords = (v) => normalize(v).replace(/[^a-z0-9]/g, "");
/**
 * Review F2 (L4): the choice a plain sentence makes for the ONE option the open planner question offered — { forIntent, id } — or null.
 * The option's own name counts too: its label („test/acceptance.test.mjs”), its file name, or the name before the first dot
 * („testul acceptance”). It only names the option the Hub itself offered (answerChoice re-checks it); it never confirms a plan. A project
 * named alone keeps its own path (`isProject`: the request waiting for its project, review #5), so only „Alege-l” picks a project here.
 */
function singleOptionPick(pending, text, nowMs, isProject = () => false) {
  if (!pending || !PICK_FOR.has(pending.forIntent) || !Array.isArray(pending.options) || pending.options.length !== 1) return null;
  if (nowMs - Number(pending.at || 0) > INTAKE_LIMITS.clarificationTtlMs) return null;
  const bare = stripFillers(stripFillers(normalize(text)).replace(LEGA_PREFIX, "")).replace(/[.,!?]+$/g, "").trim();
  if (!bare) return null;
  const option = pending.options[0];
  const pick = { forIntent: pending.forIntent, id: String(option.id) };
  if (PLAIN_PICK.test(bare)) return pick;
  if (isProject(pick.id)) return null;
  const label = String(option.label || option.id || "");
  const file = label.split(/[\\/]/).pop() || "";
  const names = new Set([label, file, file.split(".")[0]].map(flatWords).filter(Boolean));
  // As said („acceptance.test.mjs”) or without the pick words around it („testul acceptance”, „folosește acceptance”).
  return [flatWords(bare), flatWords(bare.replace(PICK_WORDS, " "))].some((said) => said && names.has(said)) ? pick : null;
}

export function createIntake(hub) {
  const { trust, envelopes, cockpit, interrupts, advisor, voice, projects, missions, factory, company, bus, db } = hub;
  const session = (ctx) => (ctx.channel === "owner" ? ctx.ownerSession : ctx.channel === "test" ? ctx.ownerSession || null : null);
  // M10: desktop / plan intents (same path for text and voice; authority from the session and the source).
  const ops = hub.opsPlans ? createOpsIntentActions(hub) : null;
  const nowMs = () => (typeof hub.config?.now === "function" ? hub.config.now() : new Date()).getTime();
  const planners = new Map();
  let workRequests = null;
  const conversations = new Map(); // conversation key → { lastTarget, clarification, verbSlot, projectQuestion, at }
  const transcripts = new Map(); // `${legaSessionId}:${transcriptId}` → { at, promise }
  // Review M10.2 #20: the newest plan this Hub announced inside each Lega session (lega.plan with that sessionId), so a provider
  // transcript is judged against the plan really waiting there — server-held, never the page's `presented`, which the voice route
  // does not carry. Bounded; lost on restart (then only the armed window, also memory, would have counted anyway).
  const announced = new Map(); // legaSessionId → planId
  // Review M10.2 #7: the operation-plan service exists only after the interruptions (hub.mjs order); attaching it here makes
  // interrupts.pause the ONE place every pause path (typed, spoken, UI) stops running operation plans.
  if (hub.opsPlans && typeof interrupts?.attachOpsPlans === "function") interrupts.attachOpsPlans(hub.opsPlans);

  // ---------------------------------------------------------------- derived Lega authority (server-verified)
  /**
   * The derived Lega owner-session authority for a provider transcript, or null. Everything is re-read on the server: the running
   * Lega session must be the one named, admitted with authority "owner_session", its derivation audited (lega.authority_derived,
   * not yet released), and the owner session it came from still active, not idle, its credential active, the voice-first policy on.
   * A request on the owner channel must carry THAT owner session (another session's cookie does not borrow it).
   */
  function verifyLegaAuthority(legaSessionId, ctx) {
    if (!legaSessionId || typeof legaSessionId !== "string" || !hub.lega?.active?.()) return null;
    // Only the server's own voice route or a request carrying the owner session may lean on it: the Lega session id is visible in
    // the Hub state, so on the cookie-less ui / companion channels it would be a claim anyone on the machine could repeat.
    if (!["voice", "owner", "test"].includes(ctx.channel)) return null;
    if (ctx.channel === "owner" && !ctx.ownerSession?.id) return null;
    const st = hub.lega.state();
    if (!st || st.id !== legaSessionId || st.authority !== "owner_session" || st.status === "ended") return null;
    const derived = db.prepare("SELECT payload_json FROM events WHERE type = 'lega.authority_derived' AND json_extract(payload_json, '$.legaSessionId') = ? ORDER BY seq DESC LIMIT 1").get(legaSessionId);
    if (!derived) return null;
    if (db.prepare("SELECT 1 FROM events WHERE type = 'lega.authority_released' AND json_extract(payload_json, '$.legaSessionId') = ? LIMIT 1").get(legaSessionId)) return null;
    let ownerSessionId = null;
    try { ownerSessionId = JSON.parse(derived.payload_json || "{}").ownerSessionId || null; } catch { return null; }
    if (!ownerSessionId) return null;
    const presented = ctx.channel === "owner" || ctx.channel === "test" ? ctx.ownerSession?.id || null : null;
    if (presented && presented !== ownerSessionId) return null;
    let s;
    try { s = trust.requireSession({ id: ownerSessionId }, "comenzile vocale"); } catch { return null; }
    if (!(Date.parse(s.idleExpiresAt) > nowMs())) return null;
    if (typeof trust.credential === "function" && trust.credential(s.credentialId)?.status !== "active") return null;
    if (!trust.policy()?.active) return null;
    return { legaSessionId, ownerSessionId, session: s };
  }

  // ---------------------------------------------------------------- conversation state (memory, per owner session)
  const conversationKey = (ctx, derived) => {
    const own = session(ctx)?.id || derived?.ownerSessionId || null;
    return own ? `owner:${own}` : `channel:${ctx.channel || "?"}`;
  };
  function conversationOf(key) {
    let c = conversations.get(key);
    if (!c) {
      if (conversations.size >= INTAKE_LIMITS.conversationMax) conversations.delete(conversations.keys().next().value);
      c = { lastTarget: null, clarification: null, verbSlot: null, projectQuestion: null, at: nowMs() };
      conversations.set(key, c);
    }
    c.at = nowMs();
    return c;
  }
  /** Only executed results write the last target (an app opened, a project or clip shown, a plan presented, a mission planned). */
  function recordTarget(conv, step, r) {
    if (!conv || r.refused || r.error) return;
    let t = null;
    if ((step.intent === "open_project" || step.intent === "switch_project" || (step.intent === "reopen_last" && step.args.target?.kind === "project")) && r.cockpit?.project?.id) t = { kind: "project", id: r.cockpit.project.id, label: r.cockpit.project.name };
    else if (r.studio?.contentProjectId) t = { kind: "clip", id: r.studio.contentProjectId, label: r.studio.title || null };
    else if (r.desktop?.app?.id && ["desktop_open", "desktop_focus", "reopen_last"].includes(step.intent)) t = { kind: "app", id: r.desktop.app.id, label: r.desktop.app.name || r.desktop.app.id, app: r.desktop.app.id };
    else if (step.args?.missionId && (r.plan?.envelope?.id || ["start_mission", "resume_mission"].includes(step.intent))) {
      const m = missions.get(step.args.missionId);
      if (m) t = { kind: "mission", id: m.id, label: m.title };
    } else if (r.plan?.envelope?.id) t = { kind: "plan", id: r.plan.envelope.id, label: r.plan.envelope.summary?.headline || r.plan.summary?.headline || null };
    else if (r.opsPlan?.id) t = { kind: "plan", id: r.opsPlan.id, label: r.opsPlan.title || null, ...(r.opsPlan.kind === "sales.prepare" ? { sales: true, preparationId: r.opsPlan.preparationId || null } : {}) };
    // M12: an offer shown or answered (its opportunity screen) — a following bare „Ce lipsește?” is about that offer (RR8: that preparation).
    else if (r.sales && ["sales_show", "sales_missing", "sales_approve_talk"].includes(step.intent)) t = { kind: "screen", id: r.navigate || "/sales", label: "Oferta", sales: true, preparationId: r.sales.preparationId || null };
    if (t) conv.lastTarget = { ...t, at: new Date(nowMs()).toISOString() };
  }
  function rememberClarification(conv, clarification, step, projectId) {
    if (!conv || !clarification || !Array.isArray(clarification.options) || !clarification.options.length) return;
    conv.clarification = { question: clarification.question, forIntent: clarification.forIntent, options: clarification.options.map((o) => ({ id: String(o.id), label: o.label })),
      step: step ? { intent: step.intent, effect: step.effect, effectClass: step.effectClass, args: { ...step.args }, constraints: { ...step.constraints }, text: step.text } : null,
      projectId: projectId || null, about: clarification.about === "project" ? "project" : null, at: nowMs() };
  }
  /**
   * Review M10.2 #5: bounded work waiting for its PROJECT („Pe ce proiect lucrez?”, or the one question when the cockpit's project and
   * the one the words named differ). A later sentence that only names a project (open_project, same conversation, within the
   * clarification TTL) completes THIS request instead of just opening the cockpit — by voice there is no choice button, and the
   * engineering planner's own pending question (keyed by the same conversation) is completed through its public answer (chosenId).
   */
  function rememberProjectQuestion(conv, step, text) {
    if (!conv || !step) return;
    conv.projectQuestion = { step: { intent: step.intent, effect: step.effect, effectClass: step.effectClass, args: { ...step.args }, constraints: { ...step.constraints }, text: step.text },
      text: String(text || "").slice(0, 2000), at: nowMs() };
  }
  /**
   * 2.12.2 (P0-R6, L7): „Arată-mi planul” (or „Ce a rămas?”) with no project known — ONE question with the projects as options, remembered
   * twice: as the open clarification (a button answers it with the project's id) and as the request waiting for its project (a sentence
   * that only names one completes it, under the request's own effect-class check). Live, „Pe ce proiect?” was forgotten, so „ProDelivery”
   * only opened the project and the plan was never shown. The Hub's own project and retired ones are not offered; real projects first.
   */
  function askProject(r, step, { conv, input }) {
    const hubId = (() => { try { return projects.hub?.()?.id || null; } catch { return null; } })();
    const options = projects.list().filter((p) => p.id !== hubId && p.status !== "retired")
      .sort((a, b) => Number(a.source === "hub-test") - Number(b.source === "hub-test")).slice(0, 6).map((p) => ({ id: p.id, label: p.name }));
    r.message = PROJECT_QUESTION_TEXT[step.intent] || "Pe ce proiect?";
    r.clarification = { question: r.message, options, forIntent: step.intent, about: "project" };
    rememberClarification(conv, r.clarification, step, null);
    rememberProjectQuestion(conv, step, input?.text);
  }

  /**
   * D3: the Hub's own answer to „Arată-mi / Rulează preview-ul” on a project (read-only: never the runner, the supervisor, an envelope or
   * a planner). A preview exists only as a step of a Software Factory mission whose spec declares one (factory.mjs runPreview, after QA):
   * the newest such mission of the project (at most 20 looked at) with its last current PREVIEW evidence, or the plain reason there is
   * none. `step.args.missionId` is set for the layout's Preview card. Owner-facing text without ids.
   */
  function previewAnswer(projectId, step) {
    const name = projects.get(projectId)?.name || "acest proiect";
    let list = [];
    try { list = (factory?.list?.() || []).filter((f) => f.projectId === projectId).slice(0, 20); } catch { list = []; }
    let found = null;
    for (const f of list) {
      let v = null;
      try { v = factory.view(f.missionId); } catch { v = null; }
      if (!v?.spec?.spec?.verification?.preview) continue;
      const last = (v.evidence || []).filter((e) => e.stage === "PREVIEW" && !e.stale).at(-1) || null;
      found = { missionId: f.missionId, title: v.mission?.title || f.title || "misiunea", status: last?.status || null };
      break;
    }
    if (!found) {
      return { noPreview: true, message: `Pe ${name} nu am un preview pe care să-l pornesc: Hub-ul pornește un preview doar ca pas al unei misiuni Software Factory care are o comandă de preview, iar proiectul acesta nu are o astfel de misiune. Nu am pornit nimic și nu am pregătit niciun plan.` };
    }
    step.args.missionId = found.missionId;
    const last = !found.status ? "încă nu a rulat" : found.status === "PASS" ? "ultima pornire a răspuns" : "ultima pornire nu a răspuns";
    return { preview: { missionId: found.missionId, title: found.title, status: found.status },
      message: `Îți arăt în cockpit preview-ul misiunii „${found.title}”: ${last}.${step.args.start ? " Nu îl pornesc separat: preview-ul rulează ca pas al misiunii, după verificări." : ""}` };
  }
  /**
   * D3: the show_preview step for words a client of the intake sent as WORK (Lega's request_work / propose_run / propose_mission reach
   * plan()), or null. The resolver decides: a sentence whose steps hold a preview read and no planner intent is answered as that read,
   * whatever kind the client named (live, „Rulează preview-ul Pro Delivery” became two confirmed Claude analyses). The client's project,
   * when given, wins over the one the words named.
   */
  function previewStepOf(text, projectId, source, kind = "run") {
    // D3 review: only a model-run planner kind is overridden (a Studio request about a „preview” is a clip, planned as before).
    if (!PREVIEW_OVERRIDE_KINDS.has(kind)) return null;
    const ctxFor = (pid) => ({ projects: projects.list().map((p) => ({ id: p.id, name: p.name, slug: p.slug, source: p.source })), currentProjectId: pid || null,
      missions: [], departments: [], source });
    let resolved = null;
    try { resolved = resolveIntent(text, ctxFor(projectId)); } catch { return null; }
    const steps = resolved?.steps || [];
    if (!steps.length || steps.some((s) => Object.hasOwn(PLANNER_FOR_INTENT, s.intent))) return null;
    // D3 review: a PURE preview read only — every step is the preview read itself or that read held by a condition („Rulează preview-ul X și
    // verifică dacă merge”, „Pornește preview-ul X dacă se poate”: the condition changes nothing, nothing is started); no other step (an
    // unknown clause, „Mod preview pentru comenzi. Clientul vede…”), a run / start or show verb on it, and no work verb anywhere in the words
    // („Analizează preview-ul”, „Creează un preview”, „Rulează preview-ul X și repară bug-ul”: the resolver drops that clause) — those are
    // work and reach their planner as before.
    const isPreview = (s) => s.intent === "show_preview" || (s.intent === "not_yet" && s.args?.held === "show_preview");
    if (!steps.every(isPreview) && !(resolved.clarification?.forIntent === "show_preview" && steps.every((s) => isPreview(s) || s.intent === "unknown"))) return null;
    const words = normalize(text);
    if (PREVIEW_WORK_VERBS.test(words)) return null;
    let step = steps.find((s) => s.intent === "show_preview") || null;
    if (!step) {
      // The held read: the clause without its condition is the read (its project and `start`), else a bare preview read.
      const held = steps.find(isPreview);
      const cut = held && held.args?.conditionWord && held.args?.condition ? String(held.text || "").replace(`${held.args.conditionWord} ${held.args.condition}`, "").replace(/[\s,;:]+$/g, "").replace(/\s+si$/, "").trim() : "";
      let again = null;
      try { again = cut ? resolveIntent(cut, ctxFor(projectId)).steps.find((s) => s.intent === "show_preview") || null : null; } catch { again = null; }
      step = again || { intent: "show_preview", effect: INTENT_EFFECTS.show_preview || "read", args: PREVIEW_START.test(String(held?.text || "")) ? { start: true } : {}, constraints: {}, text: held?.text || "" };
    }
    if (!step.args?.start && !PREVIEW_SHOW_VERB.test(String(step.text || "")) && !PREVIEW_START.test(String(step.text || ""))) return null;
    const args = { ...step.args, ...(projectId ? { projectId } : {}) };
    return { intent: "show_preview", effect: step.effect, effectClass: step.effectClass || classOfIntent("show_preview", step.effect), args, constraints: { ...step.constraints }, text: step.text };
  }

  // ---------------------------------------------------------------- M10.2.1: the suspended gate, answered in context (D14/D15)
  const gateNow = () => hub.settings.get("executionGate") || {};
  /**
   * AS-06 / SM-07: the credential reference of an owner session, re-read from the database (an ended or expired session has none), and
   * whether the gate is suspended by THIS session's own credential-bound pause. A pure comparison: nothing is reopened here (only
   * interrupts.resumeOwnPause reopens, and never from a clarification choice).
   */
  function sessionTag(s) {
    if (!s?.id) return null;
    const row = db.prepare("SELECT credential_id, status, expires_at FROM owner_sessions WHERE id = ?").get(String(s.id));
    return row && row.status === "active" && Date.parse(row.expires_at) > nowMs() ? credentialTag(row.credential_id) : null;
  }
  const isOwnPause = (s, g = gateNow()) => g.status !== "open" && g.suspendedBy?.kind === "pause" && Boolean(g.suspendedBy.credential) && sessionTag(s) === g.suspendedBy.credential;
  /**
   * SM-07: what must end before a rearm, for a pause of ANOTHER authenticator (the session-independent eligibility stops at OWNER_PAUSE
   * for every credential-bound pause): retained leases, runs still stopping or being admitted, missions still cancelling, Lega open — the
   * rearm service's own order. Read-only.
   */
  function notYetCode() {
    try { if (Number(db.prepare("SELECT COUNT(*) AS n FROM leases WHERE status = 'retained'").get().n)) return "LEASES"; } catch { /* the next checks still decide */ }
    if ((hub.runs?.activeRuns?.() || []).length + Number(hub.runs?.admittingCount?.() || 0)) return "RUNS_ACTIVE";
    try { if ((factory.list() || []).some((f) => f.stage === "CANCEL_REQUESTED")) return "CANCEL_PENDING"; } catch { /* idem */ }
    return hub.lega?.active?.() ? "LEGA_ACTIVE" : "ELIGIBLE";
  }
  /**
   * VOICE-04: a not-yet answer said by voice names what ends first and where the OWNER reopens the gate — never „apoi redeschid poarta”
   * (nothing reopens by itself, and never by voice). null when nothing has to end first.
   */
  function laterHow(code) {
    const first = [code === "RUNS_ACTIVE" || code === "CANCEL_PENDING" ? "oprirea e confirmată" : null, hub.lega?.active?.() ? "închizi Lega" : null].filter(Boolean);
    return first.length ? `după ce ${first.join(" și ")}, ${REOPEN_SPOKEN}.` : null;
  }
  /**
   * What the owner can do about a suspended gate, for a request that met it (null when the gate is open):
   *  - the owner channel with an owner session: the rearm card (owner/gate-rearm.mjs — a fresh Windows Hello, bound to that exact
   *    suspension) when it can reopen now, carrying `requestId` (the preserved request it re-proposes after the rearm);
   *  - otherwise { gateStopped: { code, reason } }: why not here or not yet (a voice transcript or the UI without the session, a stop not
   *    yet confirmed, the owner's own pause). Never an administration pointer, never a typed gate command.
   * `card: false` (the spoken „Continuă”): no card is issued; the cockpit shows the rearm through its GATE_SUSPENDED blocker. `spoken`
   * (the verified spoken „Continuă”, which runs on the owner channel) answers in the voice's words, like the voice channel. A pause of
   * another authenticator is judged with the caller's session (SM-07: the rearm, never „spune Continuă”) — on the voice route the owner
   * session the derived Lega authority was verified against (`judge`; it only names the cause, a card is never issued there). `how`
   * (voice answers): the part after „Poarta e oprită …: ”, for a caller that already said what stopped the gate.
   */
  function gateAnswer(ctx, { requestId = null, card = true, spoken = false, judge = null } = {}) {
    const g = gateNow();
    if (g.status === "open") return null;
    const cls = classifySuspension(g).cls;
    const svc = hub.gateRearm || null;
    const voiceChannel = ctx?.channel === "voice" || spoken;
    const ownerS = ctx?.channel === "owner" || ctx?.channel === "test" ? ctx.ownerSession || null : null;
    const judgeS = ownerS || judge || null;
    const otherPause = cls === "owner_pause" && Boolean(judgeS?.id) && !isOwnPause(judgeS, g);
    const by = otherPause ? OTHER_PAUSE_BY : STOPPED_BY[cls] || STOPPED_BY.legacy_unknown;
    const s = card ? ownerS : null;
    if (svc && s?.id) {
      let out = null;
      try { out = svc.cardFor({ ownerSession: s, requestId }); }
      catch (error) {
        // The request closed meanwhile (cancelled, expired): the card without it. An ended session falls to the reason below.
        if (requestId && error?.category !== "authentication") { try { out = svc.cardFor({ ownerSession: s }); } catch { out = null; } }
      }
      if (out?.kind === "gate_rearm" && out.eligible) return { cls, gateRearm: out };
      if (out && out.eligible === false) return { cls, gateStopped: { code: out.code || "NOT_ELIGIBLE", reason: String(out.reason || "") } };
    }
    let e = null;
    try { e = svc ? svc.eligibility() : null; } catch { e = null; }
    if (!e) return { cls, gateStopped: { code: "UNAVAILABLE", reason: `Poarta e oprită ${by}; redeschiderea din cockpit nu e disponibilă pe acest Hub.` } };
    const code = e.code === "OWNER_PAUSE" && otherPause ? notYetCode() : e.code;
    if (code === "OWNER_PAUSE") {
      return { cls, gateStopped: { code: "OWNER_PAUSE", reason: voiceChannel ? "Ai pus Hub-ul pe pauză: „Continuă” îl reia, scris în cockpit sau spus cu vocea ta verificată local." : e.reason } };
    }
    // 2.12.2 (P0-R1): never a dead end — the cockpit card shows the reserved workspace as a step of the same decision (or why it waits);
    // an open Lega session is named first, as laterHow does (the card refuses while it is open).
    if (code === "LEASES" && otherPause) {
      const first = hub.lega?.active?.() ? "după ce închizi Lega, " : "";
      return { cls, gateStopped: { code, reason: `Poarta e oprită ${by} și un spațiu de lucru e încă rezervat după o oprire neconfirmată: ${first}${REOPEN_SPOKEN}. Pe card vezi și ce fac cu spațiul rezervat.` } };
    }
    if (code === "ELIGIBLE" || code === "SECURITY") {
      const how = voiceChannel ? "o redeschizi în cockpit, în sesiunea ta, cu Windows Hello — nu prin voce." : "o redeschizi în cockpit, în sesiunea ta de proprietar, cu Windows Hello (cardul „Redeschide poarta”).";
      return { cls, gateStopped: { code: "OWNER_SESSION", reason: `Poarta e oprită ${by}: ${how}` }, how: voiceChannel ? how : null };
    }
    const later = REARM_LATER.has(code) ? laterHow(code) : null;
    if (later && (voiceChannel || otherPause)) return { cls, gateStopped: { code, reason: `Poarta e oprită ${by}: ${later}` }, how: later };
    return { cls, gateStopped: { code, reason: String(e.reason || "") } };
  }
  /** Puts the answer on a step result (r.gateRearm or r.gateStopped); returns it. */
  function attachGate(r, ctx, opts = {}) {
    const ans = gateAnswer(ctx, opts);
    if (!ans) return null;
    if (ans.gateRearm) r.gateRearm = ans.gateRearm;
    else r.gateStopped = ans.gateStopped;
    return ans;
  }
  /** A planner answer that the suspended gate blocks (its GATE_SUSPENDED cause, or a message that says so). */
  const gateBlocked = (out) => Boolean(out) && (out.gate === true
    || (out.kind === "blocked" && [].concat(out.blocker?.causes || String(out.blocker?.signature || "").split("+")).includes("GATE_SUSPENDED")));
  /**
   * A request the suspended gate blocks: the rearm card bound to its preserved request (D15: the ONE request re-proposed after the
   * rearm), or the honest reason. By voice the first (full) explanation ends with where the gate is reopened (the cockpit, never voice);
   * later mentions keep the one-line reminder (the one-time rule).
   */
  function gateOnRequest(r, ctx, judge = null) {
    const ans = attachGate(r, ctx, { requestId: r.workRequest?.id || null, judge });
    // VOICE-04: by voice the one-liner also follows a not-yet answer (Lega open, a stop still being confirmed) — while Lega runs, that is
    // every voice answer, so the owner always hears where the gate is reopened (the cockpit, with Windows Hello, never by voice).
    if (ans?.gateStopped && ctx.channel === "voice" && ans.how && REARM_LATER.has(ans.gateStopped.code) && r.workRequest?.mode === "full" && r.message) r.message = `${r.message} ${ans.gateStopped.reason}`;
    return ans;
  }
  /** What stays stopped while the gate is (the owner's words; counts read now), or null when nothing is. */
  function stoppedWorkText() {
    let plans = 0; let desk = false; let paused = 0;
    try { plans = ops ? (hub.opsPlans.active() || []).filter((p) => ["PAUSED", "NEEDS_OWNER"].includes(p.status)).length : 0; } catch { plans = 0; }
    try { desk = hub.desktop?.sessionStatus?.()?.status === "PAUSED"; } catch { desk = false; }
    try { paused = (factory.list() || []).filter((f) => f.stage === "PAUSED").length; } catch { paused = 0; }
    const parts = [plans ? (plans === 1 ? "un plan de operare" : `${plans} planuri de operare`) : null, desk ? "sesiunea desktop" : null,
      paused ? (paused === 1 ? "o misiune" : `${paused} misiuni`) : null].filter(Boolean);
    return parts.length ? `ce e pe pauză rămâne pe pauză (${parts.join(", ")})` : null;
  }

  // ---------------------------------------------------------------- 2.12.1 (D22): what a stop itself stopped
  // owner/stop-scope.mjs (hub.stopScope; a private read-only reader when the Hub did not wire one): evidence the stop recorded, never
  // inferred from texts. Nothing here pauses, resumes or reopens.
  let ownScope = null;
  const stopScope = () => hub.stopScope || (ownScope ||= createStopScope(hub));
  /**
   * What the current suspension's own stop holds now: { ops: Set<planId>, desktop, missions }. Only a stop's class holds anything (a
   * palette / gate.set suspension, a pause, the first start never do). Evidence that cannot be read fails closed for such a class:
   * every stopped plan and a paused desktop session wait for the rearm.
   */
  function heldByStopNow(cls) {
    if (!STOP_HOLD_CLASSES.has(cls)) return NOTHING_HELD;
    try { return stopScope().stoppedSet(); } catch {
      let plans = [];
      try { plans = (hub.opsPlans?.active?.() || []).filter((p) => ["PAUSED", "NEEDS_OWNER"].includes(p.status)).map((p) => p.id); } catch { plans = []; }
      let desk = false;
      try { desk = hub.desktop?.sessionStatus?.()?.status === "PAUSED"; } catch { desk = false; }
      return { cls, ops: new Set(plans), desktop: desk, missions: new Set() };
    }
  }

  // ---------------------------------------------------------------- planners
  /** registerPlanner(kind, fn): fn({ step, text, projectId, source, ctx, session, hub }) → { kind: envelope|ops|blocked|question|message, … }. */
  function registerPlanner(kind, fn) {
    if (!PLANNER_KINDS.includes(kind)) throw new HubError("validation", `Tip de planificator necunoscut: ${kind}`);
    if (typeof fn !== "function") throw new HubError("validation", "Planificatorul trebuie să fie o funcție");
    const previous = planners.get(kind) || null;
    planners.set(kind, fn);
    // Unregistering restores the planner it replaced (the built-in Studio / mission planners are never lost to a temporary one).
    return () => { if (planners.get(kind) === fn) { if (previous) planners.set(kind, previous); else planners.delete(kind); } };
  }
  /** The preserved-request service (U06): recordBlocked({ text, source, channel, projectId, intent, effectClass, blocker }) → { id, … }. */
  const attachWorkRequests = (service) => { workRequests = service || null; };
  const workRequestService = () => workRequests || hub.workRequests || null;
  /** The preserved-request service itself (owner/work-requests.mjs), not the recorder wrapper hub.mjs attaches for the blocked seam. */
  const requestStore = () => (workRequests?.replan ? workRequests : hub.workRequests?.replan ? hub.workRequests : null);

  /**
   * „Reia misiunea X” for a mission already under an OPEN plan (review M10.2 #6/#8): in the owner's session (typed or locally verified
   * voice) a mission the plan stopped while the gate stayed open (PAUSED by „Oprește Codex”, a plain BLOCKED, a decision with nothing
   * exhausted) resumes INSIDE that plan (interrupts.resumeStopped → factory.resume, no widening). Anything else gets the accurate
   * pointer — the plan's hold, the difference to confirm, the paused gate („Continuă” reopens it after the owner's own pause), or the
   * owner session — never a promise that „Continuă” does what it would not.
   */
  async function resumeUnderPlan({ mission, open, ctx, source, session: s }) {
    const ownerWords = Boolean(s) && (ctx.channel === "owner" || ctx.channel === "test") && (source === "typed" || source === "voice-local");
    const check = interrupts.planResumeCheck ? interrupts.planResumeCheck(mission.id, s) : { ok: false, why: null };
    if (check.ok && ownerWords) {
      const out = await interrupts.resumeStopped({ session: s, actor: `owner:${s.id}`, missionId: mission.id }).catch((error) => ({ summary: `Nu am putut relua „${mission.title}”: ${error.message}` }));
      return { kind: "message", text: out.summary || `„${mission.title}” nu s-a reluat.`, projectId: mission.projectId };
    }
    if (check.ok) return { kind: "message", projectId: mission.projectId, text: `„${mission.title}” e oprită sub planul tău confirmat: o reiau în aceleași limite când spui „Continuă” în sesiunea ta (tastat sau cu vocea verificată local).` };
    const g = gateNow();
    if (g.status !== "open") {
      // M10.2.1 (D14): after the owner's OWN pause „Continuă” reopens it; any other stop is reopened by the rearm card in the cockpit
      // (`gate: true`: the caller attaches the card or the honest reason). Nothing resumes before that.
      const cls = classifySuspension(g).cls;
      if (cls === "owner_pause") return { kind: "message", projectId: mission.projectId, text: `„${mission.title}” e în planul tău confirmat, dar ai pus Hub-ul pe pauză: „Continuă” (scris sau cu vocea ta verificată local) redeschide poarta și reia misiunea.` };
      return { kind: "message", projectId: mission.projectId, gate: true, text: `„${mission.title}” e în planul tău confirmat, dar poarta de execuție e oprită ${STOPPED_BY[cls] || STOPPED_BY.legacy_unknown}: o redeschizi în cockpit, cu Windows Hello (cardul „Redeschide poarta”); după aceea spui „Continuă” și o reiau în aceleași limite.` };
    }
    if (["CONFIRMED", "ACTIVE"].includes(open.status) && !["PAUSED", "BLOCKED", "NEEDS_OWNER_DECISION"].includes(check.mission?.stage)) return { kind: "message", projectId: mission.projectId, text: `„${mission.title}” rulează deja sub planul tău confirmat (${check.mission?.stage || open.status}); nu e nimic de reluat.` };
    return { kind: "message", projectId: mission.projectId, text: `Nu reiau „${mission.title}”: ${check.why || "nu e oprită sub planul confirmat"}.` };
  }

  /** The default mission-start planner: ONE envelope card for a Software Factory mission; any other kind is said plainly. */
  async function planMissionStart({ step, projectId, ctx, source, session: s }) {
    if (step.args.unknownRef) return { kind: "message", text: `Nu găsesc misiunea „${step.args.unknownRef}”${projectId ? " pe acest proiect" : ""}.` };
    if (!step.args.missionId) return { kind: "message", text: step.intent === "resume_mission" ? "Ce misiune reiau? Spune-mi numele ei." : "Ce misiune pornesc? Spune-mi numele ei." };
    const mission = missions.get(step.args.missionId);
    if (!mission) return { kind: "message", text: "Nu găsesc misiunea." };
    const view = factory.view(mission.id);
    if (!view) return { kind: "message", text: `„${mission.title}” e o misiune de tipul ${mission.kind || "necunoscut"}: acest tip de misiune nu are un flux automat (doar misiunile Software Factory pornesc printr-un plan). Nu am pornit nimic.` };
    if (step.intent === "resume_mission") {
      const open = envelopes.envelopeOfMission?.(mission.id) || null;
      if (open && ["CONFIRMED", "ACTIVE", "WAITING_OWNER"].includes(open.status)) return resumeUnderPlan({ mission, open, ctx, source, session: s });
    }
    // M10.2.1 (D14/D15): the gate stopped by anything but the owner's own pause — no PLAN_BLOCKED card over it (it would turn confirmable
    // the moment the gate reopens). A start is kept as a preserved request with its mission (the rearm card carries it and re-proposes it
    // afterwards: a plan that still needs its own confirmation); a resume of a paused mission is said after the rearm, explicitly.
    const g = gateNow();
    if (g.status !== "open" && classifySuspension(g).cls !== "owner_pause") {
      const by = STOPPED_BY[classifySuspension(g).cls] || STOPPED_BY.legacy_unknown;
      if (step.intent === "resume_mission") {
        return { kind: "message", projectId: mission.projectId, gate: true, text: `„${mission.title}” rămâne oprită: poarta de execuție e oprită ${by}. După ce o redeschizi, spune din nou „Reia misiunea ${mission.title}” și îți pregătesc planul de continuare (îl confirmi o dată).` };
      }
      const planRef = { kind: "mission", missionId: mission.id };
      const ex = await collectFacts(hub, { projectId: mission.projectId, intent: "engineering", missionIds: [mission.id], plan: true }).then((f) => explain(f)).catch(() => null);
      if (ex?.blocked && (ex.causes || []).includes("GATE_SUSPENDED")) return { kind: "blocked", blocker: ex, text: ex.text, projectId: mission.projectId, request: { planRef, explanation: ex } };
    }
    const proposal = await envelopes.propose({ projectId: mission.projectId, missionIds: [mission.id], constraints: step.constraints, actor: ctx.actor, via: ctx.channel }).catch((error) => ({ error: error.message }));
    return { kind: "envelope", proposal, projectId: mission.projectId };
  }
  planners.set("start_mission", planMissionStart);
  planners.set("resume_mission", planMissionStart);
  // M10.2 U10: the Content Studio planner (no model, nothing generated; D5) — blocked with the request kept, or ONE ops plan from
  // the existing Studio executors on the clip the owner means, or one question.
  const content = createContentPlanner(hub, { opsActions: ops });
  planners.set("studio_create", (a) => content.plan(a));

  const opsCard = (plan) => plan && ({ id: plan.id, kind: plan.kind, title: plan.title, status: plan.status, summary: plan.summary, hash: plan.hash, nonce: plan.nonce, confirmBy: plan.confirmBy, decisions: plan.body?.decisions || [] });

  /** Applies a planner's answer to the step result: a card, a preserved blocker, a question or a message — never an effect. */
  function applyPlannerOutcome(out, r, step, { input, ctx, source, conv, state }) {
    if (!out || typeof out !== "object") { r.message = "Nu am putut pregăti un plan pentru asta."; return; }
    if (out.projectId) state.projectId = out.projectId;
    if (out.kind === "envelope") {
      r.plan = out.proposal; r.note = out.note || "Plan afișat; nimic nu a pornit și niciun grant nu a fost creat.";
      if (out.proposal?.envelope?.id) step.args.envelopeId = out.proposal.envelope.id;
      if (out.proposal?.envelope?.id && !step.constraints.noStart && !step.args.previewOnly) r.armed = armFor(out.proposal.envelope.id, input, ctx);
      if (step.args.previewOnly || step.constraints.noStart) r.note = "Doar planul, cum ai cerut; nu pornesc nimic.";
    } else if (out.kind === "ops") {
      r.opsPlan = out.card?.opsPlan || opsCard(out.plan); r.note = out.note || out.card?.note || "Plan afișat; o singură confirmare. Nimic nu a pornit.";
      if (out.navigate) r.navigate = out.navigate;
    } else if (out.kind === "blocked") {
      const blocker = out.blocker || {};
      r.blockedBy = { signature: blocker.signature || out.signature || null, cause: blocker.cause || null, text: blocker.text || out.text || null, options: blocker.options || [] };
      r.message = out.text || blocker.text || "Cererea e blocată acum; o păstrez.";
      const wr = workRequestService();
      const record = wr?.recordBlocked || wr?.record || null;
      // A Studio request belongs to the company's Studio, not to the project the cockpit happens to show.
      const requestProjectId = out.workIntent === "studio" ? null : out.projectId || state.projectId || null;
      if (record) {
        try {
          // The explainer's own causes and one-line reminder travel with the blocker (the one-time rule keys on its signature).
          const full = { ...r.blockedBy, ...(Array.isArray(blocker.causes) ? { causes: blocker.causes } : {}), ...(blocker.short ? { short: blocker.short } : {}), ...(blocker.automaticOnly !== undefined ? { automaticOnly: blocker.automaticOnly } : {}) };
          r.workRequest = record.call(wr, { text: String(input.text || "").slice(0, 2000), source, channel: ctx.channel, projectId: requestProjectId, intent: step.intent,
            effectClass: step.effectClass, blocker: full, actor: ctx.actor, request: out.request || null });
          if (r.workRequest?.text) r.message = r.workRequest.text;
        } catch (error) { r.workRequest = null; r.workRequestError = error.message; }
      } else r.workRequest = null;
    } else if (out.kind === "question") {
      r.message = out.question || out.text || "Poți preciza?";
      r.clarification = { question: r.message, options: Array.isArray(out.options) ? out.options : [], forIntent: out.forIntent || step.intent };
      rememberClarification(conv, r.clarification, step, state.projectId);
    } else {
      r.message = out.text || out.message || "";
      if (out.navigate) r.navigate = out.navigate;
    }
  }
  /**
   * M12 final review F4: a planner's arguments without any send / contact / publish clause (strings and lists of strings). Last review round
   * RR5: also reports what it cut (`refused` / `quoted`), so an instruction said only in an argument (a mission's acceptance criterion)
   * never reaches the planner unannounced.
   */
  function outreachArgsCut(args = {}) {
    const out = { ...args };
    const refused = [];
    const quoted = [];
    let changed = false;
    const one = (x) => { const c = stripOutreach(x); if (!c.changed) return x; changed = true; refused.push(...c.refused); quoted.push(...c.quoted); return c.text; };
    for (const [k, v] of Object.entries(out)) {
      if (typeof v === "string") out[k] = one(v);
      else if (Array.isArray(v) && v.length && v.every((x) => typeof x === "string")) out[k] = v.map(one).filter((x) => String(x).trim());
    }
    return { args: out, refused, quoted, changed };
  }
  /** F4: tells the owner what was kept out of the plan (his own outreach words: OUTREACH_DISABLED; a quoted instruction: content). */
  function noteOutreachCut(r, cut, { refusedShown = false } = {}) {
    if (!cut?.changed) return;
    const notes = [cut.refused.length && !refusedShown ? outreachCutNote(cut.refused) : null, cut.quoted.length ? QUOTED_OUTREACH_NOTE : null].filter(Boolean).join(" ");
    if (!notes) return;
    if (r.plan || r.opsPlan) r.note = r.note ? `${r.note} ${notes}` : notes;
    else r.message = r.message ? `${r.message} ${notes}` : notes;
    r.outreachNote = notes;
  }
  async function runPlannerFor(kind, step, env) {
    const fn = planners.get(kind);
    if (!fn) return null;
    // lastTarget is the server-held conversation state (written only from executed results), never a client field.
    // Pilot 2026-10-08: on the voice route the delivery planner works under the owner session the derived Lega authority was verified
    // against (as local actions do above), so a summary edit said to Lega is not answered with „open your session” mid-conversation.
    const s = session(env.ctx) || (kind === "delivery" ? env.derived?.session || null : null);
    return fn({ step, text: env.input.text, projectId: env.state.projectId, source: env.source, ctx: env.ctx, session: s, hub, lastTarget: env.conv?.lastTarget || null });
  }

  /** Every plan shown is announced (the Lega voice and other screens learn its id from the Hub, not from the model). */
  function publishPlan(r, state, input) {
    const sessionId = input.legaSessionId || null;
    const planId = r.plan?.envelope?.id || r.opsPlan?.id || null;
    if (sessionId && planId) {
      if (announced.size >= INTAKE_LIMITS.conversationMax && !announced.has(sessionId)) announced.delete(announced.keys().next().value);
      announced.set(String(sessionId), planId);
    }
    const live = hub.live;
    if (!live?.publish) return;
    if (r.plan?.envelope?.id) live.publish({ type: "lega.plan", kind: "envelope", id: r.plan.envelope.id, projectId: r.plan.envelope.projectId || state.projectId || null, sessionId });
    else if (r.opsPlan?.id) live.publish({ type: "lega.plan", kind: "ops", id: r.opsPlan.id, projectId: state.projectId || null, sessionId });
  }

  /** Whether a plan still waits for the owner's answer (an envelope awaiting confirmation, an operation plan PROPOSED and unexpired). */
  function planStillWaiting(planId) {
    const id = String(planId || "");
    try {
      if (/^env_/.test(id)) return Boolean(envelopes.view(id)?.awaitingConfirmation);
      if (/^opp_/.test(id) && ops) { const p = hub.opsPlans.view(id); return p?.status === "PROPOSED" && !(Date.parse(p.confirmBy) <= nowMs()); }
    } catch { return false; }
    return false;
  }
  /** The armed plan of this Lega session (the server's own window, bound to the owner session it was derived from), or null. */
  const armedPlanFor = ({ ownerSessionId = null, legaSessionId = null } = {}) => {
    if (!ownerSessionId || !legaSessionId || typeof hub.armedWindows?.planFor !== "function") return null;
    try { return hub.armedWindows.planFor({ ownerSessionId, legaSessionId }) || null; } catch { return null; }
  };
  /**
   * Review M10.2 #20: the plan waiting for the owner's answer in a Lega session, decided on the SERVER — the armed window of the
   * derived session, else the newest plan announced in that session while it still waits. The voice route carries no `presented`, so
   * without this a provider transcript ("Da, pornește misiunea") proposed a new envelope that superseded the card being answered.
   * A claimed legaSessionId can only make this stricter (it refuses more), never grant anything.
   */
  function waitingInLega(legaSessionId, derived) {
    if (!legaSessionId) return null;
    const armed = derived ? armedPlanFor({ ownerSessionId: derived.ownerSessionId, legaSessionId: derived.legaSessionId }) : null;
    if (armed) return armed;
    const last = announced.get(String(legaSessionId)) || null;
    if (last && planStillWaiting(last)) return last;
    if (last) announced.delete(String(legaSessionId));
    return null;
  }

  // ---------------------------------------------------------------- armed voice window
  /**
   * Opens the armed voice window for a plan just shown on the owner's cockpit, when (and only when) every condition holds; otherwise says
   * why not. M10.2 U13: the Lega session named by the page must be the LIVE session derived from THIS owner session (checked by the
   * plan's service over Lega's own state, never the client's id alone), for envelopes and operation plans alike. On the voice route the
   * Hub arms after Lega has SPOKEN the plan (runtime/lega.mjs), not here.
   */
  function armFor(planId, input, ctx) {
    if (ctx.channel === "voice") return { armed: false, pending: true, reason: "Lega deschide fereastra vocală după ce îți citește planul" };
    const s = session(ctx);
    if (!s || !input.legaSessionId) return { armed: false, reason: "Confirmă în cockpit (fereastra vocală se deschide doar într-o sesiune Lega cu vocea ta verificată local)" };
    try {
      const w = /^opp_/.test(String(planId))
        ? hub.opsPlans.armForLega({ planId, legaSessionId: input.legaSessionId, session: s, via: "cockpit" })
        : envelopes.armForLega({ envelopeId: planId, legaSessionId: input.legaSessionId, session: s, via: "cockpit" });
      return { armed: true, expiresAt: w.expiresAt };
    } catch (error) { return { armed: false, reason: error.message }; }
  }

  // ---------- M09 Content Studio helpers (reads only; the one write is a review PROPOSAL) ----------
  /** Content projects by title (never archived ones); a free reference is matched like a project name. */
  function findContentProject(ref) {
    let list = [];
    try { list = (hub.media?.content?.listProjects({ limit: 200 }) || []).filter((p) => p.stage !== "ARCHIVED"); } catch { list = []; }
    return { list, matches: ref ? matchRef(ref, list, { name: (p) => p.title }) : [] };
  }
  /**
   * The edit version a spoken correction applies to: the referenced clip, or the only open one — or, when several are open, the clip
   * the owner last acted on (the server-held lastTarget, M10.2) instead of a question; its ONE edit plan; its CURRENT version.
   */
  function studioEditTarget(ref, lastTarget = null) {
    const editsOf = (p) => { try { return hub.media.edits.list({ contentProjectId: p.id }) || []; } catch { return []; } };
    const { list, matches } = findContentProject(ref);
    let project = null;
    if (ref) {
      if (matches.length !== 1) return { question: matches.length ? `Care clip: ${matches.slice(0, 4).map((p) => `„${p.title}”`).join(" sau ")}?` : `Nu găsesc clipul „${ref}”. Pe care clip fac corectura?`, navigate: "/studio" };
      project = matches[0];
    } else {
      const open = list.filter((p) => !STUDIO_CLOSED_STAGES.has(p.stage) && editsOf(p).length);
      const last = lastTarget?.kind === "clip" && open.length > 1 ? open.find((p) => p.id === lastTarget.id) || null : null;
      if (open.length !== 1 && !last) return { question: open.length ? `Pe care clip: ${open.slice(0, 4).map((p) => `„${p.title}”`).join(" sau ")}?` : "Nu am niciun clip cu plan de montaj deschis; creează planul în Studio.", navigate: "/studio" };
      project = last || open[0];
    }
    const edits = editsOf(project);
    if (!edits.length) return { question: `„${project.title}” nu are încă un plan de montaj; îl creezi în Studio.`, navigate: `/studio/${project.id}` };
    if (edits.length > 1) return { question: `„${project.title}” are ${edits.length} planuri de montaj (${edits.slice(0, 4).map((e) => `„${e.title}”`).join(", ")}); deschide-l pe cel dorit în Studio și spune din nou.`, navigate: `/studio/${project.id}` };
    const edit = hub.media.edits.get(edits[0].id);
    if (!edit?.current) return { question: `Planul „${edits[0].title}” nu are o versiune curentă.`, navigate: `/studio/${project.id}` };
    return { project, edit, version: edit.current };
  }
  /** M10: the clip a whole-clip request is about (the referenced one, or the only open one), or the question to ask. */
  function studioClipTarget(ref, lastTarget = null) {
    const { list, matches } = findContentProject(ref);
    if (ref) return matches.length === 1 ? { project: matches[0] } : { question: matches.length ? `Care clip: ${matches.slice(0, 4).map((p) => `„${p.title}”`).join(" sau ")}?` : `Nu găsesc clipul „${ref}”.`, navigate: "/studio" };
    const open = list.filter((p) => !STUDIO_CLOSED_STAGES.has(p.stage));
    const last = lastTarget?.kind === "clip" && open.length > 1 ? open.find((p) => p.id === lastTarget.id) || null : null;
    if (last) return { project: last };
    return open.length === 1 ? { project: open[0] } : { question: open.length ? `Pentru care clip: ${open.slice(0, 4).map((p) => `„${p.title}”`).join(" sau ")}?` : "Nu am niciun clip deschis în Studio.", navigate: "/studio" };
  }
  /** Who proposed a correction: the source of the words (a provider transcript stays "voice-provider" even with the owner cookie). */
  const studioProvenance = (source, ctx) => (source === "voice-local" ? "owner-voice-local" : source === "voice-provider" || ctx.channel === "voice" ? "voice-provider"
    : ctx.channel === "companion" ? "companion" : ctx.channel === "owner" ? "owner-typed" : ctx.channel === "test" ? "test" : "ui");
  const studioVoiceFilterOff = () => { try { return !voice?.status?.()?.gate?.enabled; } catch { return true; } };

  // ---------------------------------------------------------------- reads added in M10.2
  function lastRuns(projectId) {
    const rows = db.prepare(`SELECT r.id, r.provider, r.status, r.stage, r.model, r.environment, r.created_at, r.finished_at, p.id AS project_id, p.name AS project_name
      FROM agent_runs r LEFT JOIN conversations c ON c.id = r.conversation_id LEFT JOIN projects p ON p.id = c.project_id ${projectId ? "WHERE c.project_id = ?" : ""} ORDER BY r.created_at DESC LIMIT 5`).all(...(projectId ? [projectId] : []));
    return rows.map((x) => ({ id: x.id, provider: x.provider, status: x.status, stage: x.stage || null, model: x.model || null, environment: x.environment || "windows", at: x.finished_at || x.created_at, projectId: x.project_id || null, projectName: x.project_name || null }));
  }
  function deliveries(projectId) {
    const rows = db.prepare(`SELECT b.id, b.mission_id, b.status, b.created_at, b.decided_at, m.title, m.project_id FROM factory_bundles b JOIN missions m ON m.id = b.mission_id
      ${projectId ? "WHERE m.project_id = ?" : ""} ORDER BY b.created_at DESC LIMIT 8`).all(...(projectId ? [projectId] : []));
    return rows.map((x) => ({ id: x.id, missionId: x.mission_id, title: x.title, status: x.status, at: x.decided_at || x.created_at, projectId: x.project_id, awaitingOwner: x.status === "READY_FOR_OWNER_ACCEPTANCE" }));
  }

  /** The plan a "nu" / "anulează" answers: the one presented, else (fail-safe direction only) the ONE plan waiting. */
  function planToAnswer(env, { allowOnly = false } = {}) {
    if (env.planWaiting) return { kind: "ops", id: env.planWaiting.id };
    if (env.presented?.envelopeId && env.pendingForProject.some((e) => e.id === env.presented.envelopeId)) return { kind: "envelope", id: env.presented.envelopeId };
    if (!allowOnly) return null;
    const waitingOps = ops ? (hub.opsPlans.list({ status: "PROPOSED" }) || []).filter((p) => p.status === "PROPOSED" && !(Date.parse(p.confirmBy) <= nowMs())) : [];
    const all = [...env.pendingForProject.map((e) => ({ kind: "envelope", id: e.id })), ...waitingOps.map((p) => ({ kind: "ops", id: p.id }))];
    return all.length === 1 ? all[0] : null;
  }

  // ---------------------------------------------------------------- „Continuă” (M10.2 U11 / review #6–#8; M10.2.1 D14/D15/D18/D20)
  /**
   * D20: the missions whose CONFIRMED plan expired in the last 24 h and that are still stopped, with no plan in force and no continuation
   * waiting (≤ 3): the honest reason a „Continuă” finds nothing to resume. Read-only.
   */
  function expiredPlanMissions() {
    const since = new Date(nowMs() - EXPIRED_POINTER_MS).toISOString();
    let rows = [];
    try { rows = db.prepare("SELECT mission_ids_json FROM mission_envelopes WHERE status = 'EXPIRED' AND confirmed_at IS NOT NULL AND closed_at >= ? ORDER BY closed_at DESC LIMIT 20").all(since); } catch { rows = []; }
    let waiting = [];
    try { waiting = envelopes.pending().flatMap((e) => e.missionIds || []); } catch { waiting = []; }
    const out = []; const seen = new Set();
    for (const row of rows) {
      for (const id of parse(row.mission_ids_json, [])) {
        if (out.length >= 3 || seen.has(id)) continue;
        seen.add(id);
        const f = factory.list().find((x) => x.missionId === id);
        if (!f || !["PAUSED", "BLOCKED", "NEEDS_OWNER_DECISION"].includes(f.stage)) continue;
        if (envelopes.envelopeOfMission?.(id) || waiting.includes(id)) continue;
        out.push({ missionId: id, title: f.title });
      }
    }
    return out;
  }
  /** D20: the pointer to the continuation plan (one confirmation of only what remains) — never „Nu am niciun plan oprit”. */
  function expiredPointer(list) {
    const names = list.map((m) => `„${m.title}”`).join(", ");
    return list.length === 1
      ? `Planul confirmat pentru ${names} a expirat, așa că „Continuă” nu o mai poate relua (n-o mai acoperă niciun plan în vigoare). Spune: Reia misiunea „${list[0].title}” — îți pregătesc un plan de continuare doar cu ce a rămas, pe care îl confirmi o dată.`
      : `Planurile confirmate pentru ${names} au expirat, așa că „Continuă” nu le mai poate relua. Pentru fiecare spune, de exemplu: Reia misiunea „${list[0].title}” — îți pregătesc un plan de continuare doar cu ce a rămas, pe care îl confirmi o dată.`;
  }
  /**
   * D14/D15 (+ D22): the gate stays stopped by something that is not the owner's own pause and „Continuă” (or a clarification choice)
   * resumed nothing — what the stop itself holds and the missions wait for the rearm — and answers once: what stopped the gate, what stays
   * stopped, the rearm card (or, by voice and without the session, where and when it is reopened). `other` (SM-07): a pause another
   * authenticator of the owner recorded — the cockpit card reopens it, never „spune Continuă”.
   */
  function holdContinue(r, { ctx, cls, card, other = false, choice = false, spoken = false }) {
    const ans = attachGate(r, ctx, { card, spoken });
    const by = other ? OTHER_PAUSE_BY : STOPPED_BY[cls] || STOPPED_BY.legacy_unknown;
    const what = stoppedWorkText();
    const head = what ? `Poarta e oprită ${by}, așa că ${choice ? "alegerea" : "„Continuă”"} nu reia nimic acum: ${what}.` : `Poarta e oprită ${by}; nu e nimic pe pauză de reluat.`;
    const how = r.gateRearm ? `O redeschizi aici, cu Windows Hello (cardul „Redeschide poarta”)${what ? "; după aceea spui din nou „Continuă”." : "."}`
      : ans?.how ? capitalize(ans.how) : r.gateStopped?.reason || "";
    r.message = `${head} ${how}`.trim();
    return r;
  }
  /**
   * D22: something stopped for another reason resumed, but the gate stays stopped by a suspension the rearm reopens: what is still
   * stopped — what the stop itself holds, the missions (they need the open gate) — is said once, with the card (or where it is
   * reopened). The owner's own pause keeps its own words (no tail).
   */
  function stillStoppedTail(r, { ctx, cls, card, other, spoken, held }) {
    if (cls === "owner_pause" && !other) return;
    let paused = 0;
    try { paused = (factory.list() || []).filter((f) => f.stage === "PAUSED").length; } catch { paused = 0; }
    const parts = [held.ops.size ? (held.ops.size === 1 ? "un plan de operare" : `${held.ops.size} planuri de operare`) : null, held.desktop ? "sesiunea desktop" : null,
      paused ? (paused === 1 ? "o misiune" : `${paused} misiuni`) : null].filter(Boolean);
    if (!parts.length) return;
    const ans = attachGate(r, ctx, { card, spoken });
    const by = other ? OTHER_PAUSE_BY : STOPPED_BY[cls] || STOPPED_BY.legacy_unknown;
    const how = r.gateRearm ? "O redeschizi aici, cu Windows Hello (cardul „Redeschide poarta”); după aceea spui din nou „Continuă”."
      : ans?.how ? capitalize(ans.how) : r.gateStopped?.reason || "";
    r.message = `Ce a rămas oprit (${parts.join(", ")}) așteaptă redeschiderea porții, oprită ${by}. ${how}`.trim();
  }
  /**
   * D22: an item the current suspension's own stop paused, named by a clarification choice: it waits for the rearm (the same hold as the
   * plan card's own resume and the desktop resume) — { code: GATE_REARM_REQUIRED } with the reason and the card.
   */
  function stopHold(r, { kind, id, ctx, card, spoken }) {
    let h = null;
    try { h = stopScope().heldByStop({ kind, id }); } catch { h = null; }
    const reason = h?.reason || "Ce a oprit Stop All se reia doar după ce redeschizi poarta aici, în cockpit, cu Windows Hello.";
    r.stopHold = { code: "GATE_REARM_REQUIRED", kind, id, reason };
    attachGate(r, ctx, { card, spoken });
    r.message = reason;
  }
  /**
   * D22: „Continuă” while the current stop holds some work — what it paused waits for the rearm; everything stopped for another reason
   * resumes exactly as before (the ONE stopped plan with the paused desktop operator, else the operator alone; several → ONE question).
   * The same steps and words as the operation actions' resume (ops/intent-actions.mjs), over what is not held.
   */
  async function resumeNotHeld({ ctx, session: s, held }) {
    const stopped = (hub.opsPlans.active() || []).filter((p) => ["PAUSED", "NEEDS_OWNER"].includes(p.status) && !held.ops.has(p.id));
    let ds = null;
    try { ds = hub.desktop?.sessionStatus?.() || null; } catch { ds = null; }
    const desktopFree = ds?.status === "PAUSED" && !held.desktop && typeof hub.desktop?.resume === "function";
    if (!stopped.length) {
      if (desktopFree) return { desktop: await hub.desktop.resume({ actor: ctx.actor }), note: "Operatorul poate primi din nou comenzi; nu reiau singur nimic din ce făcea." };
      return { message: "Nu am niciun plan oprit de continuat." };
    }
    if (stopped.length > 1) return { clarification: { question: `Care plan: ${stopped.slice(0, 4).map((p) => `„${p.title}”`).join(" sau ")}?`, options: stopped.slice(0, 4).map((p) => ({ id: p.id, label: p.title })), forIntent: "ops_continue" } };
    if (desktopFree) await hub.desktop.resume({ actor: ctx.actor });
    const plan = await hub.opsPlans.resume(stopped[0].id, { session: s, actor: ctx.actor });
    return { plan: { id: plan.id, title: plan.title, status: plan.status }, note: "Continui exact planul confirmat (aceleași limite). Pașii incerți i-am verificat întâi." };
  }
  /**
   * D18: THE „Continuă” executor. The typed sentence (owner channel), a locally verified utterance sent as owner.intent {utteranceId}
   * (claimed and consumed by the caller first) and the owner's verified spoken „Continuă” in a gated Lega session (continueFromVoice)
   * all run this, as the owner session; a provider transcript never reaches it (effect class; Lega's bridge stays silent or says how).
   *  - after the owner's OWN pause (same credential): reopens the gate and resumes what that pause stopped (D13, unchanged) — never from a
   *    clarification choice (a choice picks work, not the gate);
   *  - D22 / REG-01: while the gate stays stopped, only what the current suspension's own stop stopped (a Stop All, the shutdown, a
   *    security stop: owner/stop-scope.mjs) waits for the rearm, together with the missions (they need the open gate, D14). Anything
   *    stopped for another reason — the owner's own „Pauză”, a desktop intervention (USER_INPUT), „Preiau eu”, a plan's own stop — resumes
   *    exactly as before, under a palette suspension, a pause of another authenticator, a legacy row or the first start alike;
   *  - AS-06: what is held is decided the same way whatever the path (typed, spoken, a choice's planId), with a pure credential comparison;
   *  - then the ONE stopped operation plan (and the paused desktop operator), else — gate open — the missions their open plans stopped;
   *    nothing resumed under a stopped gate → holdContinue (the card, or where and when it is reopened);
   *  - D20: nothing stopped, but a confirmed plan expired in the last 24 h → the continuation pointer.
   * Returns the fields of the step result.
   */
  async function continueAsOwner(step, { ctx, conv = null, projectId = null, card = true, spoken = false }) {
    const r = {};
    const ownerChannel = ctx.channel === "owner" || ctx.channel === "test";
    const s = session(ctx);
    const choice = Boolean(step.args.planId);
    const own = ownerChannel && !choice && interrupts.resumeOwnPause
      ? await interrupts.resumeOwnPause({ session: s, actor: ctx.actor }).catch((error) => ({ reopened: false, reason: error.message })) : null;
    if (own?.reopened) r.interrupt = own;
    // What stays stopped now, decided without reopening anything: the class, whether a pause is another authenticator's (a pure
    // comparison of credential references) and what this suspension's own stop holds.
    const g0 = gateNow();
    const suspended = ownerChannel && g0.status !== "open";
    const cls = suspended ? classifySuspension(g0).cls : "open";
    const other = suspended && cls === "owner_pause" && Boolean(s?.id) && !isOwnPause(s, g0);
    const held = suspended ? heldByStopNow(cls) : NOTHING_HELD;
    // A choice among several stopped MISSIONS of open plans (review #6/#8) names the mission the Hub itself offered.
    const chosenMission = step.args.planId && !/^opp_/.test(String(step.args.planId)) && missions.get(step.args.planId) ? step.args.planId : null;
    // Last review round RC6: a plan whose resume guard refuses „Continuă” (a Sales preparation's plan a Stop All since its confirmation still
    // holds, GATE_REARM_REQUIRED) answers as the existing rearm hold — the reason and the card — never as a bare step error.
    try {
    if (chosenMission) {
      if (!ownerChannel || !s) r.refused = "„Continuă” reia lucrul: îl spui în sesiunea ta de proprietar.";
      // D14: a mission needs the open gate (one a Stop All cancelled stays cancelled): nothing resumes before the reopening.
      else if (suspended) return holdContinue(r, { ctx, cls, card, other, choice: true, spoken });
      else { const out = await interrupts.resumeStopped({ session: s, actor: `owner:${s.id}`, missionId: chosenMission }); r.interrupt = out; r.message = out.summary || "Nu am reluat nimic."; }
    // A choice among several stopped plans names the plan (the option the Hub itself offered); otherwise the ONE stopped plan.
    } else if (step.args.planId && ops) {
      const planId = String(step.args.planId);
      if (!ownerChannel) r.refused = "„Continuă” reia lucrul: îl spui în sesiunea ta de proprietar.";
      else if (held.ops.has(planId)) stopHold(r, { kind: "ops", id: planId, ctx, card, spoken });
      else { const plan = await hub.opsPlans.resume(planId, { session: s, actor: ctx.actor }); r.plan = { id: plan.id, title: plan.title, status: plan.status }; r.note = "Continui exact planul confirmat (aceleași limite). Pașii incerți i-am verificat întâi."; }
    } else if (ops && (held.ops.size || held.desktop)) Object.assign(r, await resumeNotHeld({ ctx, session: s, held }));
    else Object.assign(r, ops ? await ops.resume({ ctx, session: s }) : { message: "Nu am niciun plan oprit." });
    } catch (error) {
      if (error?.code !== "GATE_REARM_REQUIRED") throw error;
      const reason = String(error.message || "Ce a oprit „Oprește tot” se reia doar după ce redeschizi poarta aici, în cockpit, cu Windows Hello.");
      r.stopHold = { code: "GATE_REARM_REQUIRED", kind: error.details?.kind || "ops", id: step.args.planId ? String(step.args.planId) : null, reason };
      attachGate(r, ctx, { card, spoken });
      r.message = reason;
      return r;
    }
    // Review M10.2 #6/#8: the gate was already open (nothing to reopen) and no operation plan was stopped — a mission its OPEN plan
    // stopped while the gate stayed open („Oprește Codex”, a plain BLOCKED, a decision with nothing exhausted) resumes here, in the
    // owner session only, through factory.resume within the unchanged plan (never allowExtraCycle / proceedToQa / another model);
    // several → ONE question; one that needs a difference or is held → the honest pointer, not „no stopped plan”.
    const gateOpen = gateNow().status === "open";
    let nothing = false;
    if (!own?.reopened && !chosenMission && !step.args.planId && ownerChannel && s && gateOpen && interrupts.resumeStopped && !r.plan && !r.clarification && !r.desktop && !r.refused) {
      const out = await interrupts.resumeStopped({ session: s, actor: `owner:${s.id}` }).catch((error) => ({ summary: error.message, missions: [], waiting: [] }));
      if (out.question) { r.clarification = out.question; r.message = out.question.question; }
      else if (out.summary) { r.interrupt = out; r.message = out.summary; }
      else nothing = true;
    }
    // The gate reopened and nothing else was stopped: say what happened, not "no stopped plan".
    if (own?.reopened && !r.plan && !r.clarification && !r.desktop) r.message = own.summary;
    else if (suspended && !gateOpen && !r.refused && !r.error && !r.stopHold && !r.clarification) {
      if (r.plan || r.desktop) stillStoppedTail(r, { ctx, cls, card, other, spoken, held });
      else if (cls === "owner_pause" && !other) {
        // The owner's own pause that did not reopen (a retained lease, a state that changed, a choice): its own words, never a card.
        r.message = own?.reason || OWN_PAUSE_AGAIN;
        if (own?.rearm) attachGate(r, ctx, { card, spoken });
      } else holdContinue(r, { ctx, cls, card, other, spoken });
    }
    // D20: nothing was stopped, but a confirmed plan expired recently — the continuation pointer, not „Nu am niciun plan oprit”.
    if (nothing && !r.plan && !r.desktop && !r.clarification && !r.refused) {
      const expired = expiredPlanMissions();
      if (expired.length) { r.message = expiredPointer(expired); r.expiredPlans = expired; }
    }
    if (r.clarification) rememberClarification(conv, r.clarification, step, projectId);
    return r;
  }
  /**
   * D18: a locally verified spoken „Continuă” sent as owner.intent {utteranceId} counts only as the WHOLE sentence („Da. Continuă.”
   * never), from a gate or confirm segment of THIS session (probe never), MATCH with the active profile, unconsumed — and is consumed
   * (`continue:<utteranceId>`) before anything runs. Returns the refusal, or null.
   */
  function claimVoiceContinue(utteranceId, s) {
    if (!utteranceId || !s?.id || typeof voice?.claimForContinue !== "function") return "„Continuă” spus cu vocea ta se ia doar din fraza verificată local, în sesiunea ta de proprietar";
    try {
      const claim = voice.claimForContinue({ utteranceId, session: s, purposes: ["gate", "confirm"] });
      return claim.consume(`continue:${utteranceId}`) === 1 ? null : "„Continuă” spus nu se ia în seamă: fraza a fost deja folosită. Scrie „Continuă” în cockpit sau repetă-l.";
    } catch (error) { return error.message; }
  }

  // ---------------------------------------------------------------- the step executor
  async function executeStep(step, env) {
    const { input, ctx, source, presented, presentedPlanId, planWaiting, awaiting, voiceWaiting = null, derived, conv, state } = env;
    const r = { intent: step.intent, effect: step.effect, constraints: step.constraints, args: step.args, effectClass: step.effectClass };
    // „Pornește Lega” while Lega already runs is a status answer, not an effect: say so instead of a refusal.
    // D23: a start waiting for its automatic account check is active too (Stop reaches it) but has no session yet: say what is happening.
    if (step.intent === "lega_start" && hub.lega?.active()) {
      const s = hub.lega.state();
      r.message = s && s.status !== "ended" ? "Lega e deja pornită." : "Lega pornește deja: verific contul Codex (câteva secunde).";
      return r;
    }
    // Review M10.2 #20: „Da, pornește misiunea” from a provider transcript while a plan waits in this Lega session is an answer to THAT
    // plan, said in words the provider cannot confirm with: a short hint, never a new card over it (the effect class refuses one).
    if (voiceWaiting && step.intent === "start_mission" && /^(?:da|ok|okay|bine|sigur|hai)\b/.test(env.cleanText || "")) {
      r.message = "Planul afișat așteaptă răspunsul tău: spune „Da, execută planul” ca să pornească, sau „Nu acum”; nu pregătesc alt plan peste el.";
      return r;
    }
    // M10.2 effect classes (one matrix for every source): words transcribed by the provider (or arriving on the voice route) may
    // read, navigate, stop and PROPOSE; a plan proposal never replaces a plan on screen; a local action only under the server-verified
    // derived Lega authority; consent, authority and scope never — even when the HTTP request carries the owner's session cookie.
    const cls = step.effectClass || classOfIntent(step.intent, step.effect);
    if (cls === "REFUSED") {
      r.refused = step.args?.inert ? (step.args.reason || "Textul vine dintr-un document sau dintr-o transcriere media: e conținut, nu o comandă de la tine")
        : step.intent === "studio_publish" ? "Publicarea nu pornește dintr-o frază: conturile și încărcarea pe platforme sunt pachetul MEDIA_C (decis în sesiunea ta, Windows Hello), iar fiecare încărcare cere confirmarea ei separată pe manifestul exact. Până atunci pregătesc pachete manuale în Studio."
          : step.args?.reason || refusalReason(cls, source);
      return r;
    }
    const why = FAIL_SAFE_INTENTS.has(step.intent) ? null : refusalReason(cls, source, { derivedOwnerSession: Boolean(derived), planPresented: Boolean(awaiting || voiceWaiting) });
    if (why) { r.refused = why; return r; }
    // The context a local action runs in: the owner's session from the request, or — for a provider transcript on the voice route —
    // the owner session the derived Lega authority was verified against (the desktop gate re-checks that session itself).
    const localCtx = derived && !session(ctx) ? { ...ctx, channel: "owner", ownerSession: derived.session } : ctx;
    const localSession = session(ctx) || derived?.session || null;
    let projectId = state.projectId;
    // Review M10.2 #5: a sentence that only names a project answers the bounded request still waiting for its project (asked moments
    // ago in this conversation), under that request's own effect-class check for this source; otherwise it just opens the project.
    const pq = conv?.projectQuestion || null;
    if (pq && (step.intent === "open_project" || step.intent === "switch_project") && step.args.projectId && env.stepCount === 1) {
      conv.projectQuestion = null;
      const pending = { ...pq.step, args: { ...pq.step.args, projectId: step.args.projectId, chosenId: step.args.projectId }, constraints: { ...pq.step.constraints }, projectConfirmed: true };
      pending.effectClass = pending.effectClass || classOfIntent(pending.intent, pending.effect);
      if (nowMs() - pq.at <= INTAKE_LIMITS.clarificationTtlMs && projects.get(step.args.projectId)
        && !refusalReason(pending.effectClass, source, { derivedOwnerSession: Boolean(derived), planPresented: Boolean(awaiting || voiceWaiting) })) {
        state.projectId = step.args.projectId;
        return executeStep(pending, { ...env, input: { ...input, text: pq.text || input.text } });
      }
    }
    try {
      if (step.intent === "open_project" || step.intent === "switch_project") {
        if (step.args.projectId) { projectId = step.args.projectId; r.cockpit = await cockpit.projectCockpit(projectId); r.navigate = `/cockpit/${projectId}`; }
        else r.message = step.args.unknownRef ? `Nu găsesc proiectul „${step.args.unknownRef}”.` : "Spune-mi proiectul.";
      } else if (["show_plan", "continue_work"].includes(step.intent)) {
        if (source === "voice-local" && awaiting) { r.refused = "Planul afișat așteaptă răspunsul tău; spune „Da, execută planul” sau „Nu acum” (nu pregătesc alt plan peste el)"; }
        else if (!projectId) askProject(r, step, env);
        else {
          const proposal = await envelopes.propose({ projectId, missionIds: step.args.missionId ? [step.args.missionId] : [], constraints: step.constraints, actor: ctx.actor, via: ctx.channel })
            .catch((error) => ({ error: error.message }));
          r.plan = proposal; r.note = "Plan afișat; nimic nu a pornit și niciun grant nu a fost creat.";
          if (proposal.envelope?.id) step.args.envelopeId = proposal.envelope.id;
          if (proposal.envelope?.id && !step.constraints.noStart && !step.args.previewOnly) r.armed = armFor(proposal.envelope.id, input, ctx);
          if (step.args.previewOnly || step.constraints.noStart) r.note = "Doar planul, cum ai cerut; nu pornesc nimic.";
          if (step.args.untilReady) r.note += " „Până e gata” înseamnă până la livrarea gata de verificarea ta, în limitele planului — nu execuție nelimitată.";
        }
      } else if (step.intent === "confirm") {
        if (ctx.channel !== "owner" && ctx.channel !== "test") r.refused = "Confirmarea se face în sesiunea ta autentificată (cockpit, tastă sau buton)";
        else if (planWaiting && presentedPlanId === step.args.envelopeId) r.confirmed = await ops.confirm({ presented: { ...presented, planId: presentedPlanId }, ctx, session: session(ctx), source, utteranceId: input.utteranceId || null });
        else if (!presented || presented.envelopeId !== step.args.envelopeId) r.refused = "Confirm doar planul afișat acum în cockpit";
        else r.confirmed = await envelopes.confirm({ envelopeId: presented.envelopeId, nonce: presented.nonce, displayedHash: presented.hash, session: session(ctx), modality: source === "voice-local" ? "voice" : "typed", utteranceId: source === "voice-local" ? input.utteranceId : null, idempotencyKey: ctx.commandId });
      } else if (step.intent === "not_yet" || step.intent === "reject_plan") {
        // M10.2: a "no" holds or withdraws, never starts. "Nu acum" closes the armed voice window of the plan on screen (the card stays,
        // PROPOSED, for a later click); "Anulează planul" withdraws it (CANCELLED / the operation plan cancelled). Both are fail-safe.
        const cancel = step.intent === "reject_plan" && CANCEL_WORDS.test(String(step.text || ""));
        const target = planToAnswer(env, { allowOnly: cancel });
        if (step.constraints.conditional) {
          r.held = { intent: step.args.held || null, condition: step.args.condition || null };
          r.message = "Nu pornesc nimic acum: ai pus o condiție pe care nu o verific singur.";
        } else if (cancel) {
          if (!target) r.message = "Nu am un plan afișat de anulat.";
          else if (target.kind === "envelope") { envelopes.disarm(target.id); r.cancelled = { kind: "envelope", id: target.id, status: envelopes.revoke(target.id, { actor: ctx.actor, reason: "Anulat de proprietar (Lega)" })?.status || null }; r.message = "Am anulat planul; nimic nu a pornit."; }
          else { hub.opsPlans.disarm?.(target.id, "planul a fost anulat"); r.cancelled = { kind: "ops", id: target.id, status: hub.opsPlans.cancel(target.id, { reason: "Anulat de proprietar (Lega)", actor: ctx.actor })?.status || null }; r.message = "Am anulat planul; nimic nu a pornit."; }
        } else {
          // Every armed window of the plans waiting here closes (fail-safe: closing a window only removes a way to confirm).
          const toDisarm = target?.kind === "envelope" ? [target.id] : env.pendingForProject.map((e) => e.id);
          for (const id of toDisarm) envelopes.disarm(id);
          // M10.2 U13: an operation plan's window closes the same way (one helper for both kinds).
          if (target?.kind === "ops" && hub.opsPlans?.disarm) { hub.opsPlans.disarm(target.id, "ai spus „nu”"); toDisarm.push(target.id); }
          if (toDisarm.length) r.disarmed = toDisarm;
          // Review #20: after „Nu acum” the card no longer waits for a spoken answer in this Lega session (it stays clickable), so the
          // owner's next request by voice is not refused as "a plan is waiting".
          if (input.legaSessionId) announced.delete(String(input.legaSessionId));
          r.message = target ? "Bine, nu pornesc nimic. Planul rămâne afișat; îl confirmi când vrei sau spui „Anulează planul”." : "Bine, nu pornesc nimic.";
        }
      } else if (step.intent === "reorder") r.message = "Nu pot reordona pașii unui plan dintr-o frază. Spune ce faci întâi, pregătesc planul pentru acel pas, apoi pe următorul.";
      // D6: „Importă …” with no folder the Hub can read — ONE plain explanation (a read, from every source), never a silent unknown. The
      // step stays `unknown` for the probe, counted as answered.
      else if (step.intent === "unknown" && step.args?.importNoFolder) r.message = IMPORT_FOLDER_HELP;
      // Stage before M12 (§5): a sentence that is only a restriction („Nu publica nimic”) is understood and said back, never silence.
      else if (step.intent === "unknown" && (step.constraints?.noPublish || step.constraints?.noDeploy || step.constraints?.noMessages || step.constraints?.noGit)) {
        const said = [step.constraints.noPublish && "nu public nimic", step.constraints.noDeploy && "nu fac deploy", step.constraints.noMessages && "nu trimit mesaje", step.constraints.noGit && "nu fac commit sau push"].filter(Boolean);
        r.message = `Bine: ${said.join(", ")}. Oricum nimic nu se publică și nu pleacă din PC fără o decizie separată a ta.`;
      }
      else if (step.intent === "status") {
        // P0-R6 (L11): „Ești în build safe?” is answered with the mode the server reads; „Ce a rămas în ProDelivery?” is the status of the
        // project it names (shown, with its next step), or ONE question when no project is known. Reads only: nothing changes.
        if (step.args.unknownRef) r.message = `Nu găsesc proiectul „${step.args.unknownRef}”.`;
        else if (step.args.remaining && !step.args.projectId && !projectId) askProject(r, step, env);
        else {
          if (step.args.projectId && projects.get(step.args.projectId)) {
            if (step.args.projectId !== projectId) r.navigate = `/cockpit/${step.args.projectId}`;
            projectId = step.args.projectId;
          }
          r.explain = cockpit.status({ projectId, worker: step.args.worker || null });
          if (step.args.modeQuestion) r.message = modeAnswer({ question: true }, { mode: hub.settings.get("mode") });
          else if (step.args.remaining && projectId) { r.cockpit = await cockpit.projectCockpit(projectId); r.next = r.cockpit?.next || null; }
        }
      }
      // P0-R6 (L11): a request to change the Hub's mode („Treci pe live”, „Activează LIVE_VALIDATION”) — answered, never done.
      else if (step.intent === "explain_mode") r.message = modeAnswer({}, { mode: hub.settings.get("mode"), spoken: source === "voice-provider" || source === "voice-local" });
      else if (step.intent === "why_blocked") r.explain = cockpit.whyBlocked({ projectId, missionId: step.args.missionId || null });
      else if (step.intent === "why_route") r.explain = cockpit.whyRoute({ worker: step.args.worker });
      else if (step.intent === "replay") { const mid = step.args.missionId || (projectId && factory.list().find((f) => f.projectId === projectId)?.missionId); r.replay = mid ? cockpit.replay(mid) : null; if (!mid) r.message = "Nu am o misiune de reluat pe acest proiect."; }
      // D3: „Arată-mi / Rulează preview-ul [X]” — answered by the Hub itself (a read): the project the words named, else the open one, else
      // ONE question (remembered, so a following „ProDelivery” completes it). Nothing is started; the layout block below adds the Preview card.
      else if (step.intent === "show_preview") {
        const pid = step.args.projectId && projects.get(step.args.projectId) ? step.args.projectId : projectId;
        if (!pid) askProject(r, step, env);
        else {
          Object.assign(r, previewAnswer(pid, step));
          if (r.preview) { if (pid !== projectId) r.navigate = `/cockpit/${pid}`; projectId = pid; }
        }
      }
      else if (step.intent === "briefing" || step.intent === "continue_last") r.delta = cockpit.delta(projectId || "__company__");
      else if (step.intent === "show_company" || step.intent === "zoom") { r.companyMap = cockpit.companyMap(); r.navigate = step.args.departmentKey ? `/company-map/${step.args.departmentKey}` : "/company-map"; }
      else if (step.intent === "recommendations") r.recommendations = advisor.recommendations();
      else if (step.intent === "mute") r.interrupt = interrupts.mute({ actor: ctx.actor });
      else if (step.intent === "pause") {
        // M10.2 (U11): the session that said „Pauză” is recorded with the suspension, so „Continuă” in the same credential can reopen it.
        // M10 / review #7: the same call also stops new operations of running operation plans (fail-safe; nothing is undone or closed)
        // — inside interrupts.pause, so the spoken and UI pauses do exactly the same.
        // M10.2.1 (D19): a pause the voice bridge carries from a Lega session the SERVER verified as derived from the owner session, said
        // to Lega („Lega, pune totul pe pauză”) or in the explicit form („pune totul pe pauză”), is the owner's credential-bound pause —
        // exactly like the fast path (legaLate.ownerPause), audited the same way. An unaddressed phrasing („pauză acum”, „ia o pauză”,
        // a TV in the room) stays a pause without the owner's session (the rearm card reopens it, never „Continuă”).
        // 2.12.1 (VOICE-06): only an AFFIRMATIVE pause is the owner's — „Lega, nu pune totul pe pauză” or „Lega, dacă pică testele, pune
        // totul pe pauză” (a negation, a condition) is never recorded as the owner's credential-bound pause.
        const said = String(env.cleanText || "");
        const affirmative = !/^nu\b/.test(said) && !/^nu\b/.test(normalize(String(step.text || ""))) && !PAUSE_CONDITION.test(said);
        const spokenOwner = ctx.channel === "voice" && derived && affirmative && (env.addressed || EXPLICIT_PAUSE.test(String(step.text || ""))) ? derived : null;
        if (spokenOwner) bus.emit({ type: "lega.owner_pause", scopeType: "system", scopeId: spokenOwner.legaSessionId, source: "voice", payload: { ownerSessionId: spokenOwner.ownerSessionId, via: "bridge" } });
        r.interrupt = spokenOwner
          ? await interrupts.pause({ projectId: null, actor: `voice:${spokenOwner.legaSessionId}`, reason: "Pauză (spusă către Lega)", session: spokenOwner.session, channel: "voice" })
          : await interrupts.pause({ projectId: null, actor: ctx.actor, session: session(ctx) });
        if (r.interrupt?.plansPaused?.length) r.plansPaused = r.interrupt.plansPaused;
      }
      // Review #6: the owner session that said „Oprește Codex” is recorded with the stop, so „Continuă” in that credential resumes it.
      else if (step.intent === "stop_worker") r.interrupt = await interrupts.stopWorker({ provider: step.args.worker, actor: ctx.actor, session: session(ctx) });
      // A project the words named but the Hub could not identify (none or several matched) is never replaced by the open one: nothing is
      // frozen, unfrozen or changed until the name is clear (the resolver's question, when it asked one, is answered with its options).
      else if (step.intent === "freeze_project") {
        const target = namedProject(step, projectId);
        r.interrupt = target ? await interrupts.freeze({ projectId: target, actor: ctx.actor }) : { summary: unnamedProject(step, "Ce proiect îngheț?", "nu am înghețat nimic") };
      }
      else if (step.intent === "unfreeze_project") {
        const target = namedProject(step, projectId);
        if (ctx.channel === "voice") r.refused = "Dezghețarea se face din cockpit (permite din nou munca)";
        else r.interrupt = target ? interrupts.unfreeze({ projectId: target, actor: ctx.actor }) : { summary: unnamedProject(step, "Ce proiect dezgheț?", "nu am dezghețat nimic") };
      }
      else if (step.intent === "takeover") {
        // M10: "Preiau eu" first stops the desktop operator (and pauses its plans) when it is working; then the project, if any.
        const desk = ops && ops.busy() ? await ops.takeover({ ctx }) : null;
        if (desk) { r.desktop = desk.desktop; r.plansPaused = desk.plansPaused; }
        r.interrupt = projectId ? await interrupts.takeover({ projectId, actor: ctx.actor }) : desk ? { summary: "Operatorul s-a oprit; controlul desktopului e al tău. Spune „Continuă” când vrei să reiau." } : { summary: "Ce proiect preiei?" };
      }
      else if (step.intent === "stop_all") r.interrupt = (await hub.commands.dispatch({ type: "system.stop_all", channel: ctx.channel === "owner" ? "owner" : ctx.channel === "voice" ? "voice" : ctx.channel === "test" ? "test" : "ui", ownerSession: ctx.ownerSession, actor: ctx.actor, payload: { reason: "Oprește tot (Lega)" } })).result;
      else if (step.intent === "quiet") r.prefs = advisor.setPrefs({ onlyDecisions: true }, ctx.actor);
      else if (step.intent === "notify_normal") r.prefs = advisor.setPrefs({ onlyDecisions: false }, ctx.actor);
      else if (step.intent === "autonomy") {
        const target = namedProject(step, projectId);
        if (target) r.autonomy = envelopes.setAutonomy({ projectId: target, level: step.args.level, session: session(ctx), actor: ctx.actor });
        else r.message = unnamedProject(step, "Pe ce proiect schimb autonomia?", "nu am schimbat autonomia");
      }
      // ---------- M08: company intelligence (read, propose, navigate; never start work) ----------
      else if (step.intent === "incident_open") {
        if (!projectId) r.message = "Pe ce proiect a apărut problema? Spune „Hai la <proiect>” și apoi ce nu merge.";
        else { const out = hub.warroom.propose({ projectId, text: input.text, reportedBy: ctx.actor, source: source === "typed" && ctx.channel !== "voice" ? "owner" : "lega" }); r.incident = out; r.navigate = `/intel/warroom?id=${out.incident.id}`; r.note = out.note; }
      } else if (step.intent === "twin_changes") {
        // "de ieri" / "de aseară" means since the start of yesterday (local time), not since the last cockpit visit.
        const nowDate = typeof hub.clock === "function" ? hub.clock() : new Date();
        const since = /\b(ieri|aseara)\b/.test(step.text || "") ? localDayStart(nowDate, -1).toISOString() : /\b(azi|astazi|de dimineata)\b/.test(step.text || "") ? localDayStart(nowDate, 0).toISOString() : null;
        r.changes = hub.twin.changesSince(projectId, { since });
      }
      else if (step.intent === "twin_impact") {
        if (!projectId) r.message = "Pe ce proiect?";
        else { const component = String(step.args.what || "").replace(/^(modificarea|schimbarea|modificarile|schimbarile)( (in|la|din|pe))? /, "").replace(/ /g, "_"); r.impact = hub.twin.impact(projectId, { component }); }
      } else if (step.intent === "twin_why") r.why = hub.twin.why(projectId, step.args.what || "");
      else if (step.intent === "board_open") { r.board = hub.board.open({ actor: ctx.actor }); r.navigate = "/intel/board"; }
      else if (step.intent === "board_next" || step.intent === "board_defer") {
        const m = hub.board.current();
        if (!m) r.message = "Nu e nicio ședință deschisă. Spune „Deschide ședința”.";
        else if (step.intent === "board_next") r.board = hub.board.move(m.id, 1, ctx.actor);
        else if (!m.current) r.message = "Niciun subiect curent.";
        else r.board = hub.board.decide(m.current.id, { decision: "defer", note: "amânat (Lega)", actor: ctx.actor, ownerSession: session(ctx) }).meeting || hub.board.view(m.id);
      } else if (step.intent === "simulate" && step.args.unsupported) {
        r.message = "Scenariile cu mai puțini clienți sau mai puține ore nu le ghicesc din frază: deschide Pilot → Simulare și pune valorile exacte (le calculez acolo, etichetat SIMULARE).";
        r.navigate = "/intel/simulation";
      } else if (step.intent === "simulate") {
        // The owner's own saved estimates (never invented numbers); what is still missing comes back as a question.
        const saved = hub.settings.get("simulationDefaults") || {};
        const inputs = { ...saved, ...Object.fromEntries(Object.entries(step.args).filter(([k]) => Object.hasOwn(hub.simulations.fields, k))) };
        r.simulation = hub.simulations.run({ title: String(input.text || step.args.scenario || "Scenariu").replace(/^\s*(?:(?:hei|hey|bun[ăa])\s+)?lega[\s,!.:-]+/i, "").slice(0, 160), inputs, actor: ctx.actor });
        r.navigate = `/intel/simulation?id=${r.simulation.id}`; r.note = "SIMULARE — nu schimbă nimic real.";
      } else if (step.intent === "league") r.league = hub.league.report({});
      else if (step.intent === "teach") {
        // Provenance from the channel (never from the words); the lesson becomes a rule only after the owner's confirmation.
        const provenance = source === "voice-local" ? "owner-voice-local" : source === "voice-provider" || ctx.channel === "voice" ? "owner-voice-provider" : ctx.channel === "companion" ? "device" : "owner-typed";
        r.lesson = hub.teach.propose({ text: step.args.text, provenance, projectId, actor: ctx.actor }); r.navigate = "/intel/lessons";
      } else if (step.intent === "forget") { r.forget = hub.teach.proposeForget({ ref: step.args.ref, actor: ctx.actor }); r.navigate = "/intel/lessons"; }
      else if (step.intent === "today") r.today = hub.board.today();
      else if (step.intent === "decisions") { const a = hub.board.agenda({}); r.decisions = a.items.filter((i) => i.section === "decisions" && i.kind !== "info");
        r.packages = PACKAGE_KINDS.map((k) => hub.packages.pending(k)).filter(Boolean).map((p) => ({ id: p.id, kind: p.kind, title: p.title, blockedBy: p.blockedBy || [] })); }
      // ---------- M09: Content Studio (navigate, show, PROPOSE a correction; never apply, render, capture or publish) ----------
      else if (step.intent === "studio_open") {
        const { matches } = findContentProject(step.args.clipRef);
        if (step.args.clipRef && matches.length === 1) { r.studio = { op: "open", contentProjectId: matches[0].id, title: matches[0].title }; r.navigate = `/studio/${matches[0].id}`; }
        else {
          r.studio = { op: "open", contentProjectId: null }; r.navigate = "/studio";
          if (step.args.clipRef) r.message = matches.length > 1 ? `Care clip: ${matches.slice(0, 4).map((p) => `„${p.title}”`).join(" sau ")}? Deschid Studio.` : `Nu găsesc clipul „${step.args.clipRef}”; deschid Studio.`;
        }
      } else if (step.intent === "studio_show_clip") {
        const { list, matches } = findContentProject(step.args.clipRef);
        const active = list.filter((p) => !STUDIO_CLOSED_STAGES.has(p.stage));
        // M10.2 „ultimul clip / cel creat acum”: the newest clip by its own timestamps (never a guess by name).
        const newest = step.args.latest ? [...list].sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")))[0] || null : null;
        const pick = step.args.latest ? newest : step.args.clipRef ? (matches.length === 1 ? matches[0] : null) : (active.length === 1 ? active[0] : null);
        if (pick) { r.studio = { op: "show", contentProjectId: pick.id, title: pick.title, stage: pick.stage, stageLabel: pick.stageLabel || pick.stage }; r.navigate = `/studio/${pick.id}`; }
        else {
          r.studio = { op: "show", contentProjectId: null }; r.navigate = "/studio";
          r.message = step.args.latest ? "Nu am încă niciun clip în Studio."
            : matches.length > 1 ? `Care clip: ${matches.slice(0, 4).map((p) => `„${p.title}”`).join(" sau ")}?`
              : step.args.clipRef ? `Nu găsesc clipul „${step.args.clipRef}”. Care clip? Îl poți alege în Studio.` : "Ce clip? Spune-mi titlul sau alege-l în Studio.";
        }
      } else if (step.intent === "studio_edit") {
        if (step.args.atSec == null) r.message = "La ce secundă? Spune, de exemplu, „la secunda 12 mută textul mai sus” (momentul nu îl ghicesc).";
        else {
          const target = studioEditTarget(step.args.clipRef, conv?.lastTarget);
          if (target.question) { r.message = target.question; if (target.navigate) r.navigate = target.navigate; }
          else {
            // A PROPOSAL on the current edit version: a review row with its patch and preview (a new version when applied; the original
            // stays). Provenance comes from the source, never the words. D7: when the plan card below exists, applying is that plan's ONE
            // confirmation (the cockpit card or the same card in the Studio: apply → draft render → QA); the Studio's direct apply refuses a
            // review bound to a live plan (REVIEW_IN_PLAN). The M09 Studio apply is the path only when no plan exists.
            const provenance = studioProvenance(source, ctx);
            const voiceFilterOff = studioVoiceFilterOff();
            const sentence = String(input.text || "").replace(/^\s*(?:(?:hei|hey|bun[ăa])\s+)?lega[\s,!.:-]+/i, "").slice(0, 1000) || step.text;
            const review = hub.media.reviews.propose({ editVersionId: target.version.id, text: sentence, timecodeMs: Math.round(step.args.atSec * 1000), provenance, actor: ctx.actor, sessionId: session(ctx)?.id || null });
            r.studio = { op: "propose", applied: false, contentProjectId: target.project.id, title: target.project.title, editProjectId: target.edit.id, editVersionId: target.version.id,
              version: target.version.version, reviewId: review.id, kind: review.kind, status: review.status, atSec: step.args.atSec, ops: (review.patch?.ops || []).map((o) => o.op),
              clarification: review.patch?.clarification || null, previewValid: review.patch?.preview?.valid ?? null, provenance, voiceFilterOff };
            r.navigate = `/studio/${target.project.id}?t=${step.args.atSec}&review=${review.id}`;
            r.note = `Propunere de corectură pe versiunea curentă (v${target.version.version}); nu am aplicat nimic. O aplici tu din Studio: rezultă o versiune nouă, originalul rămâne.${voiceFilterOff && provenance === "voice-provider" ? " Filtrul vocal e oprit: fraza vine ca transcriere de provider." : ""}`;
            // M10: the same correction as ONE plan card (apply → draft render → QA) — one confirmation, no Studio form.
            const card = ops && !(source === "voice-local" && awaiting) ? await ops.editPlan({ review, target, ctx }).catch((error) => ({ planError: error.message })) : null;
            if (card?.opsPlan) { r.opsPlan = card.opsPlan; r.note = `Propunere pe v${target.version.version}. ${card.note}${voiceFilterOff && provenance === "voice-provider" ? " Filtrul vocal e oprit: fraza vine ca transcriere de provider (confirmarea rămâne a ta, în cockpit)." : ""}`; }
            else if (card?.planError) r.planError = card.planError;
          }
        }
      } else if (step.intent === "capture_off") {
        r.interrupt = (await hub.commands.dispatch({ type: "media.policy.capture_off", channel: ctx.channel, ownerSession: ctx.ownerSession, actor: ctx.actor, payload: { reason: "Oprește captura (Lega)" } })).result;
      }
      // ---------- M10: Desktop Operator + zero-form plans (same path for text and voice) ----------
      else if (["desktop_open", "desktop_focus", "desktop_folder"].includes(step.intent)) Object.assign(r, ops ? await ops.local(step, { ctx: localCtx, session: localSession }) : { refused: "Operatorul desktop nu e disponibil." });
      else if (["studio_import_here", "studio_variant", "ops_capture_vertical"].includes(step.intent)) {
        if (!ops) r.refused = "Planurile de operare nu sunt disponibile.";
        else if (source === "voice-local" && awaiting) r.refused = "Planul afișat așteaptă răspunsul tău; spune „Da, execută planul” sau „Nu acum” (nu pregătesc alt plan peste el)";
        else if (step.intent === "studio_import_here") Object.assign(r, await ops.importHere({ ctx, session: session(ctx) }));
        else if (step.intent === "studio_variant") Object.assign(r, await ops.variant(step, { ctx, target: studioClipTarget(step.args.clipRef || null, conv?.lastTarget) }));
        else Object.assign(r, await ops.captureVertical(step, { ctx }));
      } else if (step.intent === "studio_import_folder") {
        // M10.2 „Importă din <folder numit>”: ONE import card (no Explorer window); a choice among several folders picks one of the
        // candidates the Hub itself found (kept in the server-held step), never a path from the client.
        if (!ops) r.refused = "Planurile de operare nu sunt disponibile.";
        else if (source === "voice-local" && awaiting) r.refused = "Planul afișat așteaptă răspunsul tău; spune „Da, execută planul” sau „Nu acum” (nu pregătesc alt plan peste el)";
        else {
          delete step.args.chosenFolder;
          if (step.args.chosenId && Array.isArray(step.args.candidates)) step.args.chosenFolder = step.args.candidates[Number(String(step.args.chosenId).replace(/^f/, "")) - 1] || null;
          const out = await ops.importFolder(step, { ctx, ownerContext: Boolean(localSession) });
          if (out.candidates) step.args.candidates = out.candidates;
          delete out.candidates;
          Object.assign(r, out);
          if (r.clarification) rememberClarification(conv, r.clarification, step, projectId);
        }
      } else if (step.intent === "ops_continue") {
        // M10.2 (U11, owner decision 13) + M10.2.1 (D14/D15/D18/D20): ONE executor for the typed „Continuă”, the locally verified spoken
        // one (owner.intent {utteranceId}: the whole sentence only, consumed once) and the Lega gate segment (continueFromVoice).
        const refusedVoice = source === "voice-local" ? claimVoiceContinue(input.utteranceId, session(ctx)) : null;
        if (refusedVoice) r.refused = refusedVoice;
        else Object.assign(r, await continueAsOwner(step, { ctx, conv, projectId }));
      }
      // ---------- M10: „Pornește Lega” (a check only: nothing is written, created or started here) ----------
      else if (step.intent === "lega_start") {
        if (!hub.lega) r.refused = "Lega nu e disponibilă pe acest Hub.";
        else if (hub.lega.active()) r.message = "Lega e deja pornită."; // answered earlier in executeStep (kept as the defensive default)
        else {
          const sid = session(ctx)?.id || null;
          const p = hub.lega.preview({ ownerSessionId: sid });
          // When the start will derive (voice-first policy, and no session yet or one to reopen), the authority checks only
          // mean "open your session": not blockers. Under the legacy policy they stay real blockers.
          const willDerive = p.policyActive && (!sid || p.needSession);
          const ignore = willDerive ? new Set(["mode", "voice_grant"]) : new Set();
          // D23: a check marked `auto` fails only for want of a fresh Codex account check, and the derived start runs that check itself
          // (lega.mjs; the preview marks it only on the one-click path): not a blocker, and never a pointer to Integrări. Nothing is
          // refreshed here — this answer is still a read. Once the automatic check's limit is reached those checks are `limited`
          // instead: left out here too (their own texts would point the wrong way), while the preview's synthetic `account_refresh_rate`
          // check is the one blocker named — with when the Hub checks again.
          const auto = p.checks.filter((c) => !c.ok && c.auto === true);
          const autoNote = auto.length ? " Verific singur contul Codex la pornire (câteva secunde, fără inferență)." : "";
          const blockers = p.checks.filter((c) => !c.ok && !ignore.has(c.id) && c.auto !== true && c.limited !== true);
          // M10.2 (owner decision 9): live search is named plainly, because this answer is what the owner saw before the start
          // carries expectWebSearch 'live' (the Hub refuses a live start without it).
          const ws = p.webSearch === "live" ? " Căutarea pe internet e live: Lega poate deschide orice pagină."
            : p.webSearch && p.webSearch !== "disabled" ? ` Căutare pe internet: ${p.webSearch}.` : "";
          const g = gateNow();
          if (g.status !== "open") {
            // M10.2.1 (D14): Lega needs the execution gate open. The answer is where the gate IS reopened — the rearm card in the cockpit
            // (or why not yet), after the owner's own pause „Continuă” — never the gate check's own text; the other checks still show.
            attachGate(r, ctx, { judge: localSession });
            const cls = classifySuspension(g).cls;
            const rest = blockers.filter((c) => c.id !== "execution_gate").map((c) => c.detail).filter(Boolean);
            const after = rest.length ? ` După aceea mai rămâne: ${rest.slice(0, 4).join(" · ")}.` : "";
            r.message = r.gateRearm ? `Lega nu pornește cât timp poarta de execuție e oprită ${STOPPED_BY[cls] || STOPPED_BY.legacy_unknown}: o redeschizi aici, cu Windows Hello (cardul „Redeschide poarta”), apoi spui din nou „Pornește Lega”.${after}`
              : `Lega nu pornește cât timp poarta de execuție e oprită ${STOPPED_BY[cls] || STOPPED_BY.legacy_unknown}. ${r.gateStopped?.reason || ""}${after}`.replace(/\s+$/, "");
          } else if (blockers.length) r.message = `Lega nu poate porni încă: ${blockers.map((c) => c.detail).join(" · ")}`;
          else {
            r.legaStart = true;
            // The page passes this to the start, so a setting changed after this answer is refused (LEGA_TERMS_CHANGED).
            r.legaStartWebSearch = p.webSearch || "disabled";
            // The wording follows what the start will actually do: derive from the session, open the session first, or the old grant.
            // D23: only a derived start checks the account itself, so with an auto check and no session yet the click opens the session.
            const needsUnlock = willDerive && (p.needSession || auto.length > 0 || p.checks.some((c) => ["mode", "voice_grant"].includes(c.id) && !c.ok));
            r.message = (p.authority === "owner_session" ? `Pornesc Lega în sesiunea ta (o singură sesiune, cel mult ${Math.max(1, Math.floor(p.maxDurationS / 60))} min; se oprește singură).`
              : needsUnlock ? "Pornesc Lega: confirmă o dată cu Windows Hello / cheia ta."
                : "Pornesc Lega cu grantul „Lega (voce)” din Integrări (calea fără sesiune).") + autoNote + ws;
          }
        }
      }
      // ---------- M10.2.1 (D14): „Redeschide poarta” only SHOWS the rearm card (a read); the rearm is its own owner-session command ----------
      else if (step.intent === "gate_rearm") {
        // The card needs the owner session (a fresh Windows Hello at its confirmation, click / Enter / typed — never voice); from a
        // provider transcript or the UI without the session the honest reason, said once by the Hub.
        if (!attachGate(r, ctx, { judge: localSession })) r.message = "Poarta de execuție e deschisă; nu e nimic de redeschis.";
        else r.message = r.gateRearm ? r.gateRearm.headline : r.gateStopped?.reason || "Poarta e oprită; o redeschizi în cockpit, în sesiunea ta, cu Windows Hello.";
      }
      // ---------- 2.12.2 (P0-R2): words that only TALK about an interruption (a question, a negation, a condition, reported speech, a
      // quotation) — the Hub's own answer, a read: nothing is stopped, paused or reopened, and no question is asked (no clarification).
      // For reported speech (and R2-F7's „De ce ai oprit tot?”), the newest owner Stop All in the event log, where it came from and whether
      // a Stop All still holds the gate. R4-F8: the stop's own kind (payload.stopKind, runs.stopAll) decides, never the suspension record's
      // precedence kind; a stop recorded before that field counts unless the Hub's shutdown wrote it (source "system").
      else if (step.intent === "explain_stop") {
        let facts = {};
        if (step.args?.mood === "reported") {
          let row = null;
          try { row = db.prepare(OWNER_STOP_ALL_SQL).get(); } catch { row = null; }
          const g = gateNow();
          facts = { lastStopAt: row?.created_at || null, lastStopVia: stopVia(row?.source), gate: g.status === "open" ? "open" : classifySuspension(g).cls === "stop_all" ? "stop_all" : "other" };
        }
        r.message = stopTalkAnswer(step.args || {}, facts);
      }
      else if (step.intent === "fullscreen") r.view = "stage";
      else if (step.intent === "cockpit_view") r.view = "cockpit";
      else if (step.intent === "details") r.view = "details";
      else if (step.intent === "start_view") { bus.transaction(() => hub.settings.set("startView", step.args.startView, ctx.actor, `Ecranul de pornire: ${step.args.startView}`)); r.startView = step.args.startView; }
      else if (step.intent === "objectives") r.objectives = hub.autopilot.list(projectId);
      else if (step.intent === "objective_plan") {
        const list = hub.autopilot.list(projectId).filter((o) => ["PREPARED", "PROPOSED", "WAITING_OWNER"].includes(o.status));
        const matches = step.args.objectiveRef ? matchRef(step.args.objectiveRef, list, { name: (o) => o.title }) : list;
        if (matches.length !== 1) r.message = matches.length ? `Care obiectiv: ${matches.slice(0, 4).map((o) => `„${o.title}”`).join(" sau ")}?` : "Nu găsesc un obiectiv pregătit cu acest nume.";
        else if (source === "voice-local" && awaiting) r.refused = "Planul afișat așteaptă răspunsul tău; nu pregătesc alt plan peste el";
        else {
          const out = await hub.autopilot.propose(matches[0].id, { actor: ctx.actor, via: ctx.channel, constraints: step.constraints }).catch((error) => ({ error: error.message }));
          r.plan = out.plan || out; r.objective = out.objective || null; r.note = "Plan peste obiectiv afișat; nimic nu a pornit.";
          if (out.plan?.envelope?.id) { step.args.envelopeId = out.plan.envelope.id; if (!step.constraints.noStart) r.armed = armFor(out.plan.envelope.id, input, ctx); }
        }
      }
      // ---------- M10.2: reads, the last target, and bounded work through the planners ----------
      else if (step.intent === "last_run") {
        r.lastRuns = lastRuns(projectId);
        const first = r.lastRuns[0];
        r.message = first ? `Ultima execuție: ${first.provider}${first.stage ? ` · ${first.stage}` : ""} · ${first.status}${first.projectName ? ` (${first.projectName})` : ""}.` : `Nu am nicio execuție înregistrată${projectId ? " pe acest proiect" : ""}.`;
      } else if (step.intent === "last_delivery") {
        r.deliveries = deliveries(projectId);
        const waiting = r.deliveries.filter((d) => d.awaitingOwner);
        r.message = waiting.length ? `${waiting.length === 1 ? "O livrare așteaptă" : `${waiting.length} livrări așteaptă`} decizia ta: ${waiting.slice(0, 3).map((d) => `„${d.title}”`).join(", ")}.`
          : r.deliveries[0] ? `Ultima livrare: „${r.deliveries[0].title}” (${r.deliveries[0].status}).` : `Nu am nicio livrare înregistrată${projectId ? " pe acest proiect" : ""}.`;
      } else if (step.intent === "sales_show" || step.intent === "sales_missing" || step.intent === "sales_approve_talk") {
        // M12 (S-07): reads the Hub answers from the latest synthetic preparation (sales/sales-answers.mjs). „Aprobă oferta” says WHERE the
        // owner approves the exact offer (id + full SHA, Vânzări → Oportunitate): nothing is approved, requested or created here.
        const answers = hub.salesAnswers || null;
        if (!answers) r.message = "Departamentul Sales nu e disponibil pe acest Hub.";
        else {
          // RR8: about the preparation the owner is working on (the conversation's last Sales target), else the most recently changed one.
          const target = conv?.lastTarget?.sales === true ? { preparationId: conv.lastTarget.preparationId || null } : {};
          const a = step.intent === "sales_show" ? answers.show(target) : step.intent === "sales_missing" ? answers.missing(target) : answers.approveTalk(target);
          r.message = a.message; r.sales = a.sales || null;
          if (a.navigate) r.navigate = a.navigate;
          // RR7 / RR12: the Stop All that stopped it still holds the gate — the rearm card with the answer (the rearm comes first).
          if (a.waitsForRearm) attachGate(r, ctx);
        }
      } else if (step.intent === "system_knowledge") {
        // Stage before M12: built from the Hub's real state; content read from projects or media is data, never an instruction.
        const a = hub.knowledge ? await hub.knowledge.answer(step.args?.topic || "overview", { about: step.args?.about || null }).catch((error) => ({ text: `Nu pot citi starea acum: ${error.message}` })) : { text: "Nu am încă registrul sistemului pe acest Hub." };
        r.message = a.text; r.knowledge = { topic: step.args?.topic || "overview", screen: a.screen || null };
      } else if (step.intent === "next_step") {
        if (!projectId) r.message = "Pe ce proiect? Spune „Hai la <proiect>” și apoi „ce urmează”.";
        else {
          const cp = await cockpit.projectCockpit(projectId);
          r.cockpit = cp; r.next = cp?.next || null;
          r.message = r.next?.recommended ? `${r.next.recommended.text}${r.next.recommended.why ? ` (${r.next.recommended.why})` : ""}.` : "Nu am un pas următor recomandat.";
        }
      } else if (step.intent === "reopen_last") {
        const t = step.args.target;
        if (!t) r.message = "Ce să deschid din nou? Spune-mi numele (aplicația, proiectul sau clipul).";
        else if (t.kind === "app") Object.assign(r, ops ? await ops.local({ intent: "desktop_open", args: { app: t.app || t.id } }, { ctx: localCtx, session: localSession }) : { refused: "Operatorul desktop nu e disponibil." });
        else if (t.kind === "project" && projects.get(t.id)) { projectId = t.id; r.cockpit = await cockpit.projectCockpit(t.id); r.navigate = `/cockpit/${t.id}`; }
        else if (t.kind === "clip") { r.studio = { op: "show", contentProjectId: t.id, title: t.label || null }; r.navigate = `/studio/${t.id}`; }
        else if (t.kind === "mission") { const m = missions.get(t.id); if (m) { projectId = m.projectId; r.navigate = `/cockpit/${m.projectId}`; r.message = `„${m.title}”.`; } else r.message = "Misiunea nu mai există."; }
        else if (t.kind === "plan") {
          const env0 = /^env_/.test(String(t.id)) ? envelopes.view(t.id) : null;
          const op0 = !env0 && ops ? hub.opsPlans.view(t.id) : null;
          if (env0?.awaitingConfirmation) r.plan = { envelope: env0, summary: env0.summary };
          else if (op0?.status === "PROPOSED") r.opsPlan = opsCard(op0);
          else r.message = `Planul${t.label ? ` „${t.label}”` : ""} nu mai așteaptă confirmarea (${env0?.status || op0?.status || "necunoscut"}).`;
        } else if (t.kind === "screen" && /^\//.test(String(t.id || ""))) r.navigate = t.id;
        else r.message = "Nu mai găsesc ce ai deschis ultima dată.";
      } else if (Object.hasOwn(PLANNER_FOR_INTENT, step.intent)) {
        if (source === "voice-local" && awaiting) r.refused = "Planul afișat așteaptă răspunsul tău; spune „Da, execută planul” sau „Nu acum” (nu pregătesc alt plan peste el)";
        else {
          // Review M10.2 #5: the project the words named („Repară testul X din Factory Demo A2”, resolved by the server) wins over the
          // cockpit's; when both exist and differ, ONE question (never a silent draft on the project that happens to be open).
          const named = REQUEST_PROJECT_CHOICE.has(step.intent) && step.args.projectId && projects.get(step.args.projectId) ? step.args.projectId : null;
          // The resolver already asked which project the words meant (several matched): that ONE question stands — no draft on the
          // cockpit's project and no second „Pe ce proiect lucrez?” from the planner.
          if (!named && !step.projectConfirmed && env.projectClarification === step.intent) r.message = env.projectClarificationText || "La care proiect te referi?";
          else if (named && projectId && named !== projectId && !step.projectConfirmed) {
            const a = projects.get(projectId); const b = projects.get(named);
            r.message = `Pe ce proiect lucrez: „${b.name}” (cel numit) sau „${a?.name || projectId}” (cel deschis acum)?`;
            r.clarification = { question: r.message, options: [{ id: b.id, label: b.name }, { id: projectId, label: a?.name || projectId }], forIntent: step.intent };
            rememberClarification(conv, r.clarification, step, projectId);
            rememberProjectQuestion(conv, step, input.text);
          } else {
            const usePid = named || projectId;
            // M12 final review F4: the planner (and a kept request) gets the owner's words WITHOUT a send / contact / publish clause or a
            // quoted instruction; the refusal itself is this sentence's own sales_send step.
            const cut = stripOutreach(input.text, { salesContext: conv?.lastTarget?.sales === true });
            const plannerInput = cut.changed ? { ...input, text: cut.text } : input;
            const out = await runPlannerFor(PLANNER_FOR_INTENT[step.intent], step, { input: plannerInput, ctx, source, conv, state: { ...state, projectId: usePid } });
            if (!out && step.intent === "studio_create") { r.message = "Încă nu pot pregăti singur un clip nou dintr-o frază pe acest Hub; deschid Studio."; r.navigate = "/studio"; }
            else {
              const local = { projectId: usePid };
              applyPlannerOutcome(out, r, step, { input: plannerInput, ctx, source, conv, state: local });
              if (gateBlocked(out)) gateOnRequest(r, ctx, localSession);
              noteOutreachCut(r, cut, { refusedShown: env.outreachStep === true });
              projectId = local.projectId;
              // The planner asked for the project (none known): a following sentence that only names one completes this request.
              if (out?.kind === "question" && !usePid && !out.projectId && /\bproiect/.test(normalize(out.question || out.text || "")) && step.intent !== "studio_create") rememberProjectQuestion(conv, step, input.text);
            }
          }
        }
      }
      if (step.intent === "why_blocked" && projectId) r.blocked = hub.twin.blocked(projectId);
      if (projectId && ["show_changes", "show_tests", "show_review", "show_preview", "replay", "status", "why_blocked", "why_route", "show_plan", "continue_work", "objective_plan", "briefing", "continue_last", "focus"].includes(step.intent)) {
        const cp = r.cockpit || await cockpit.projectCockpit(projectId);
        const next = layoutForIntent(step, cp, state.layout);
        if (next) { state.layout = next; r.layout = next; }
      }
    } catch (error) { r.error = { category: error.category || "internal", message: error.message }; }
    state.projectId = projectId;
    recordTarget(conv, step, r);
    // M10.2 U13: an operation plan card shown on the cockpit inside a Lega session is armed like an envelope (same helper, same rules).
    if (!r.refused && !r.error && r.opsPlan?.id && r.opsPlan.status === "PROPOSED" && r.armed === undefined && input.legaSessionId && !step.constraints?.noStart) r.armed = armFor(r.opsPlan.id, input, ctx);
    if (!r.refused && !r.error) publishPlan(r, state, input);
    return r;
  }

  // ---------------------------------------------------------------- choice (a clarification button)
  /** The step a choice answers, re-executed with the chosen id; a choice for a confirmation only PRESENTS that plan. */
  async function answerChoice(choice, env) {
    const pending = env.conv.clarification;
    const forIntent = String(choice?.forIntent || "").slice(0, 40);
    const id = String(choice?.id || "").slice(0, 80);
    if (!pending || nowMs() - pending.at > INTAKE_LIMITS.clarificationTtlMs || pending.forIntent !== forIntent || !pending.options.some((o) => o.id === id)) {
      throw new HubError("conflict", "Alegerea nu mai corespunde unei întrebări deschise; spune din nou ce vrei");
    }
    env.conv.clarification = null;
    if (forIntent === "confirm") {
      const r = { intent: "show_plan", effect: "plan", constraints: {}, args: { chosen: id }, effectClass: "READ_NAVIGATE" };
      const e = /^env_/.test(id) ? envelopes.view(id) : null;
      const p = !e && ops ? hub.opsPlans.view(id) : null;
      if (e?.awaitingConfirmation) { r.plan = { envelope: e, summary: e.summary }; r.note = "Planul ales e afișat; nimic nu a pornit. Îl confirmi în cockpit (buton, Enter sau „Da”)."; }
      else if (p?.status === "PROPOSED") { r.opsPlan = opsCard(p); r.note = "Planul ales e afișat; nimic nu a pornit. Îl confirmi în cockpit (buton, Enter sau „Da”)."; }
      else r.message = "Planul ales nu mai așteaptă confirmarea.";
      recordTarget(env.conv, r, r);
      return { steps: [{ intent: "show_plan", effect: "plan", args: { chosen: id }, constraints: {} }], results: [r] };
    }
    const base = pending.step || { intent: forIntent, effect: "none", args: {}, constraints: {}, text: "" };
    const step = { ...base, args: { ...base.args }, constraints: { ...base.constraints } };
    // P0-R6 (L7): the project asked for „Arată-mi planul” / „Ce a rămas?” (askProject) — an offered project id, re-read here; the request
    // then runs on it exactly as if it had been open (never as a mission id: show_plan is also a mission choice elsewhere).
    if (pending.about === "project" && projects.get(id)) {
      env.state.projectId = id; step.projectConfirmed = true;
      if (step.intent === "status") step.args.projectId = id;
      if (env.conv) env.conv.projectQuestion = null;
    }
    else if (PROJECT_CHOICE.has(forIntent)) { step.args.projectId = id; delete step.args.unknownRef; }
    // Review M10.2 #5: a code / analysis request whose project was asked (several matched the name, or the named one differs from
    // the cockpit's) runs on the project chosen — an offered id, re-read here — not on the cockpit's project.
    else if (REQUEST_PROJECT_CHOICE.has(forIntent) && projects.get(id)) {
      step.args.projectId = id; step.projectConfirmed = true; env.state.projectId = id;
      if (env.conv) env.conv.projectQuestion = null;
      // A choice carries no words: the planner reads the request the question was asked for (server-held step), not an empty text.
      if (!String(env.input.text || "").trim()) env.input.text = String(step.args.request || step.text || "").slice(0, 2000);
    }
    else if (MISSION_CHOICE.has(forIntent)) {
      step.args.missionId = id; delete step.args.unknownRef;
      const m = missions.get(id);
      if (m) env.state.projectId = m.projectId;
    } else if (forIntent === "ops_continue") step.args.planId = id;
    else step.args.chosenId = id;
    step.effectClass = step.effectClass || classOfIntent(step.intent, step.effect);
    const r = await executeStep(step, env);
    return { steps: [step], results: [r] };
  }

  // ---------------------------------------------------------------- handle
  async function run(rawInput, ctx) {
    const input = { ...rawInput };
    const derived = verifyLegaAuthority(input.legaSessionId, ctx);
    const conv = conversationOf(conversationKey(ctx, derived));
    const projectList = projects.list().map((p) => ({ id: p.id, name: p.name, slug: p.slug, source: p.source }));
    const current = input.projectId ? projects.get(input.projectId) : null;
    const presented = input.presented && typeof input.presented === "object" ? input.presented : null;
    const pendingForProject = envelopes.pending().filter((e) => !current || e.projectId === current.id);
    // M10: an operation plan card on screen (id + nonce + hash) is answered exactly like an envelope: "Da" confirms THAT plan.
    // The voice path tags the plan on screen as `envelopeId` (one field for whatever card waits): an "opp_" id is an operation plan.
    const presentedPlanId = presented?.planId || (/^opp_/.test(String(presented?.envelopeId || "")) ? presented.envelopeId : null);
    const presentedPlan = presentedPlanId && ops ? hub.opsPlans.view(presentedPlanId) : null;
    const planWaiting = presentedPlan && presentedPlan.status === "PROPOSED" ? presentedPlan : null;
    // A confirmation is valid only for the plan the cockpit reports it showed (id + nonce + hash); voice-provider never.
    const awaiting = (presented?.envelopeId && pendingForProject.some((e) => e.id === presented.envelopeId)) || planWaiting ? "envelope_confirmation" : null;
    let source = ctx.channel === "voice" ? "voice-provider" : input.source;
    if (input.utteranceId) {
      if (ctx.channel !== "owner" && ctx.channel !== "test") throw new HubError("authentication", "Fraza vocală locală se folosește doar în sesiunea ta de proprietar");
      const spoken = voice.utteranceForIntent({ utteranceId: input.utteranceId, session: session(ctx) });
      input.text = spoken.transcript;
      source = "voice-local";
    }
    const state = { projectId: current?.id || null, layout: input.layout || null };
    // Review M10.2 #20: for a provider transcript the plan waiting in its Lega session is decided here (armed window, or the newest plan
    // announced there and still waiting) — the voice route sends no `presented`, and a page's claim could only be weaker than this.
    const voiceWaiting = source === "voice-provider" ? waitingInLega(input.legaSessionId, derived) : null;
    const env = { input, ctx, source, presented, presentedPlanId, planWaiting, awaiting, voiceWaiting, derived, conv, state, pendingForProject, stepCount: 0, cleanText: "" };
    const reply = (resolvedOut, results) => ({ projectId: state.projectId, resolved: resolvedOut, results, layout: state.layout, channel: ctx.channel, source });

    // Review F2 (L4): „Alege-l” (or the option's name) answers the ONE option a planner question offered — the owner never names a file. It picks;
    // the plan card that follows still needs its own one confirmation, and the step keeps its own effect-class check for this source.
    if (!(input.choice && typeof input.choice === "object")) {
      const pick = singleOptionPick(conv.clarification, input.text, nowMs(), (id) => { try { return Boolean(projects.get(id)); } catch { return false; } });
      if (pick) input.choice = pick;
    }
    if (input.choice && typeof input.choice === "object") {
      const out = await answerChoice(input.choice, env);
      bus.emit({ type: "owner.intent", scopeType: "owner", scopeId: current?.id || "global", source: ctx.actor, payload: { channel: ctx.channel, source, steps: out.steps.map((s) => s.intent), clarification: false, refused: 0, choice: true } });
      return reply({ steps: out.steps.map((s) => ({ intent: s.intent, effect: s.effect, args: s.args, constraints: s.constraints })), clarification: null, refused: [] }, out.results);
    }
    if (!String(input.text || "").trim()) throw new HubError("validation", "Text gol");

    const resolveContext = () => ({ projects: projectList, currentProjectId: current?.id || null,
      missions: missions.list(current?.id || null).map((m) => ({ id: m.id, projectId: m.projectId, title: m.title, status: m.status, kind: m.kind })),
      departments: company.departments().map((d) => ({ key: d.key, name: d.name })),
      pendingEnvelopes: planWaiting ? [{ id: planWaiting.id, title: planWaiting.title }]
        : awaiting ? pendingForProject.filter((e) => e.id === presented.envelopeId).map((e) => ({ id: e.id, title: e.summary.headline })) : pendingForProject.map((e) => ({ id: e.id, title: e.summary.headline })),
      awaiting, source, lastTarget: conv.lastTarget || null, salesContext: conv.lastTarget?.sales === true });

    // M10.2 pending verb: a provider transcript cut in two („Deschide” … „Notepad”) is joined when the object follows within 5 s; a
    // bare verb alone gets ONE question. Only a fragment that means nothing by itself is joined (a full command keeps its meaning).
    const bare = stripFillers(stripFillers(normalize(input.text)).replace(LEGA_PREFIX, "")).replace(/[.,!?]+$/g, "").trim();
    if (conv.verbSlot && nowMs() - conv.verbSlot.at <= INTAKE_LIMITS.verbSlotMs && !BARE_VERBS[bare]) {
      const alone = resolveIntent(input.text, resolveContext());
      // Review M10.2 #26: joined only when the fragment really meant nothing alone — a refused confirmation („Da” with no plan waiting)
      // or a refusal keeps its own answer instead of becoming "Deschide Da" (a project named „da”).
      if (alone.steps.every((s) => s.intent === "unknown" && !s.args?.refusedConfirmation) && !alone.clarification && !(alone.refused || []).length) input.text = `${conv.verbSlot.text} ${String(input.text).trim()}`;
      conv.verbSlot = null;
    } else if (conv.verbSlot) conv.verbSlot = null;
    if (BARE_VERBS[bare]) {
      const alone = resolveIntent(input.text, resolveContext());
      if (alone.steps.length === 1 && alone.steps[0].intent === "unknown") {
        conv.verbSlot = { text: String(input.text).trim().replace(/[.,!?]+$/g, ""), verb: bare, at: nowMs() };
        const question = BARE_VERBS[bare];
        bus.emit({ type: "owner.intent", scopeType: "owner", scopeId: current?.id || "global", source: ctx.actor, payload: { channel: ctx.channel, source, steps: ["unknown"], clarification: true, refused: 0 } });
        return reply({ steps: [{ intent: "unknown", effect: "none", args: { pendingVerb: bare }, constraints: {} }], clarification: { question, options: [], forIntent: "pending_verb" }, refused: [] },
          [{ intent: "unknown", effect: "none", constraints: {}, args: { pendingVerb: bare }, effectClass: "READ_NAVIGATE", message: question }]);
      }
    }

    const resolved = resolveIntent(input.text, resolveContext());
    // M10.2 U10 „Importă din Videos/Ifrim Studio”: the resolver's normalization drops path separators, so a named-folder import is read
    // from the raw words here — only when the resolver found nothing else (a deictic „din folderul acesta” stays studio_import_here).
    const loneUnknown = resolved.steps.length === 1 && resolved.steps[0].intent === "unknown" && !resolved.clarification && !resolved.refused.length;
    const folderImport = loneUnknown ? parseImportFolder(input.text) : null;
    if (folderImport) resolved.steps = [{ intent: "studio_import_folder", effect: "plan", effectClass: "BOUNDED_WORKFLOW", args: { folderRef: folderImport.folderRef }, constraints: {}, text: String(input.text).slice(0, 400) }];
    // D6: „Importă …” with no folder the Hub can read → ONE plain explanation, never a silent unknown (the step stays `unknown` for the probe).
    else if (loneUnknown && importWithoutFolder(input.text)) resolved.steps[0].args = { ...resolved.steps[0].args, importNoFolder: true };
    // R4 (UNKNOWN_INTENTS, exact): a sentence with an unknown step announces (`outcome: true`) the owner.intent_outcome written after its
    // steps ran, with how many unknown steps the Hub left without any answer (probe.mjs counts that number; older events stay estimated).
    const unknownSteps = resolved.steps.filter((s) => s.intent === "unknown").length;
    const intentEvent = bus.emit({ type: "owner.intent", scopeType: "owner", scopeId: current?.id || "global", source: ctx.actor, payload: { channel: ctx.channel, source, steps: resolved.steps.map((s) => s.intent), clarification: Boolean(resolved.clarification), refused: resolved.refused.length, ...(unknownSteps ? { outcome: true } : {}),
      // Stage before M12 (§5): the slips Lega corrected (word → word only, never the sentence), so the interpretation can be audited.
      ...(resolved.corrections?.length ? { corrections: resolved.corrections.slice(0, 10) } : {}) } });
    if (resolved.clarification) rememberClarification(conv, resolved.clarification, resolved.steps.find((s) => s.intent === resolved.clarification.forIntent) || null, state.projectId);
    // Review #5: a resolver question about a request's PROJECT (several projects match the name) is answerable by naming one, too.
    if (resolved.clarification && REQUEST_PROJECT_CHOICE.has(resolved.clarification.forIntent)) {
      rememberProjectQuestion(conv, resolved.steps.find((s) => s.intent === resolved.clarification.forIntent) || null, input.text);
      env.projectClarification = resolved.clarification.forIntent; env.projectClarificationText = resolved.clarification.question;
    }
    env.stepCount = resolved.steps.length;
    // F4: the sentence's own sales_send step already says the refusal; a planner's note then only names a quoted instruction it left out.
    env.outreachStep = resolved.steps.some((s) => s.intent === "sales_send");
    env.cleanText = stripFillers(normalize(input.text)).replace(LEGA_PREFIX, "").trim();
    // D19: the sentence names Lega („Lega, …”, „Te rog, Lega, …”) — the address rule of the voice fast path, from the words themselves.
    env.addressed = LEGA_PREFIX.test(stripFillers(normalize(input.text)));
    const results = [];
    for (const step of resolved.steps) {
      const r = await executeStep(step, env);
      // A question the Hub asks from a step's own result (several stopped plans, a planner's question) is counted once here; the
      // resolver's own clarification is already counted on owner.intent.
      if (r.clarification) bus.emit({ type: "intake.question", scopeType: "owner", scopeId: current?.id || "global", source: ctx.actor, payload: { intent: step.intent, options: (r.clarification.options || []).length } });
      results.push(r);
    }
    if (unknownSteps) {
      const unanswered = resolved.steps.filter((s, i) => s.intent === "unknown" && !answeredUnknown(s, results[i], resolved)).length;
      // Enum fields and counts only (never the words); a failure here never changes the answer the owner gets.
      // D1: a sentence the voice bridge carried names its Lega session and the owner's transcript event (ids only, never words), so the
      // probe can see whether Lega answered what the Hub left unanswered (probe.mjs legaAnswers). The HTTP routes never send a transcript id.
      const link = input.legaSessionId && input.transcriptId ? { legaSessionId: String(input.legaSessionId).slice(0, 80), transcriptId: String(input.transcriptId).slice(0, 80) } : {};
      try {
        bus.emit({ type: "owner.intent_outcome", scopeType: "owner", scopeId: current?.id || "global", source: ctx.actor,
          payload: { intentEventId: intentEvent?.id || null, channel: ctx.channel, source, unknown: unknownSteps, unknownUnanswered: unanswered, ...link } });
      } catch { /* observability only */ }
    }
    return reply({ steps: resolved.steps.map((s) => ({ intent: s.intent, effect: s.effect, args: s.args, constraints: s.constraints })), clarification: resolved.clarification, refused: resolved.refused }, results);
  }

  /**
   * intake.handle({ text | utteranceId, source, projectId, presented, layout, choice, legaSessionId, transcriptId }, ctx). The same
   * transcript (the voice bridge's id) executes at most once: a repeat returns the first answer, marked duplicate.
   */
  async function handle(input, ctx) {
    const tid = input?.transcriptId ? `${input.legaSessionId || ""}:${String(input.transcriptId).slice(0, 80)}` : null;
    if (!tid) return run(input, ctx);
    const t = nowMs();
    for (const [k, v] of transcripts) if (t - v.at > INTAKE_LIMITS.transcriptTtlMs) transcripts.delete(k);
    const seen = transcripts.get(tid);
    if (seen) return { ...(await seen.promise), duplicate: true };
    if (transcripts.size >= INTAKE_LIMITS.transcriptMax) transcripts.delete(transcripts.keys().next().value);
    const promise = run(input, ctx);
    transcripts.set(tid, { at: t, promise });
    promise.catch(() => {});
    return promise;
  }

  /**
   * Bounded work named by a client of the intake (Lega's request tool, U08/U09): the same planner, the same effect-class gate
   * (BOUNDED_WORKFLOW from that source), the same card / blocker / question handling and the same lega.plan announcement.
   */
  async function plan({ kind, text = "", projectId = null, args = {}, constraints = {}, source = "typed", legaSessionId = null }, ctx) {
    if (!PLANNER_KINDS.includes(kind)) throw new HubError("validation", `Tip de planificator necunoscut: ${kind}`);
    const input = { text: String(text || "").slice(0, 2000), legaSessionId, source };
    const derived = verifyLegaAuthority(legaSessionId, ctx);
    const conv = conversationOf(conversationKey(ctx, derived));
    const src = ctx.channel === "voice" ? "voice-provider" : source;
    const step = { intent: kind, effect: "plan", effectClass: "BOUNDED_WORKFLOW", args: { ...args }, constraints: { ...constraints }, text: input.text };
    const state = { projectId: projectId ? projects.get(projectId)?.id || null : null, layout: null };
    const r = { intent: kind, effect: "plan", constraints: step.constraints, args: step.args, effectClass: step.effectClass };
    const why = refusalReason("BOUNDED_WORKFLOW", src, { derivedOwnerSession: Boolean(derived), planPresented: false });
    if (why) { r.refused = why; return r; }
    // M12 (T-S3) choke point, final review F2/F4: an instruction to the Hub to send, contact or publish (the ONE rule, intents.mjs) never
    // reaches a planner — Lega's request_work / propose_*, a kept request, any client of the intake. A request that is only that is refused
    // (OUTREACH_DISABLED); one that also asks for something else is planned WITHOUT the outreach clause (the planner never receives those
    // words) and the owner is told what was cut. A description („butonul care trimite oferta”) is no instruction; a quoted instruction is
    // content — never refused, never a planner's words either (noted).
    const cut = stripOutreach(input.text, { salesContext: conv.lastTarget?.sales === true });
    // RR5: the arguments are cut on their own too (an acceptance criterion „Trimite oferta clientului” with a clean title and objective).
    const argCut = outreachArgsCut(step.args);
    for (const x of argCut.refused) if (!cut.refused.some((y) => y.text === x.text)) cut.refused.push(x);
    for (const x of argCut.quoted) if (!cut.quoted.some((y) => y.text === x.text)) cut.quoted.push(x);
    if (argCut.changed) cut.changed = true;
    // RR10: the owner's own statement and nothing else („Contactez eu firma”): not a request to the Hub — nothing planned, nothing refused.
    if (!cut.refused.length && cut.own?.length && !cut.meaningful) {
      r.message = OWN_OUTREACH_TEXT;
      return r;
    }
    if (cut.refused.length && !cut.meaningful) {
      r.refused = SALES_SEND_REASON; r.outreach = true;
      try { bus.emit({ type: "intake.outreach_refused", scopeType: "owner", scopeId: "global", source: ctx.actor, payload: { kind, channel: ctx.channel, source: src } }); } catch { /* audit only */ }
      return r;
    }
    if (cut.changed) {
      input.text = cut.text.slice(0, 2000);
      step.text = input.text;
      step.args = argCut.args;
      r.args = step.args;
      if (cut.refused.length) {
        r.outreach = { partial: true, refused: cut.refused, reason: SALES_SEND_REASON };
        try { bus.emit({ type: "intake.outreach_refused", scopeType: "owner", scopeId: "global", source: ctx.actor, payload: { kind, channel: ctx.channel, source: src, partial: true } }); } catch { /* audit only */ }
      }
      if (cut.quoted.length) r.quotedOutreach = true;
    }
    // D3: words that ask to run, start or show a preview are a READ the Hub answers itself when the client named a model-run kind — they
    // never reach a planner (the resolver's verdict decides; a sentence that also holds a planner intent, another clause or a work verb is
    // planned as before — D3 review).
    const previewStep = previewStepOf(input.text, state.projectId, src, kind);
    if (previewStep) {
      return executeStep(previewStep, { input, ctx, source: src, presented: null, presentedPlanId: null, planWaiting: null, awaiting: null, voiceWaiting: null, derived, conv, state,
        pendingForProject: [], stepCount: 1, cleanText: "" });
    }
    const out = await runPlannerFor(kind, step, { input, ctx, source: src, conv, state });
    if (!out) { r.message = "Nu am încă un planificator pentru acest tip de lucru pe acest Hub."; return r; }
    applyPlannerOutcome(out, r, step, { input, ctx, source: src, conv, state });
    if (gateBlocked(out)) gateOnRequest(r, ctx, derived?.session || null);
    noteOutreachCut(r, cut);
    // Review #5: a planner question about the project (none given) is answerable by a sentence that only names the project.
    if (out.kind === "question" && !state.projectId && !out.projectId && /\bproiect/.test(normalize(out.question || out.text || "")) && kind !== "studio_create") rememberProjectQuestion(conv, step, input.text);
    recordTarget(conv, step, r);
    if (!r.refused && !r.error) publishPlan(r, state, input);
    return r;
  }

  // ---------------------------------------------------------------- M10.2.1 (D18): the owner's verified spoken „Continuă”
  const voiceContinues = new Map(); // utteranceId → { at, promise } (idempotent per utterance; bounded; lost on restart, the DB guards)
  /**
   * A gate segment of a Lega session whose final LOCAL transcript is exactly the resume (voice.continue_heard, emitted by owner/voice.mjs
   * for the owner's own MATCH speech). Everything is re-checked HERE, on the server: the Lega session is live, derived from THAT owner
   * session (audited, not released), started with the local filter which still runs, the voice-first policy is on, the owner session is
   * active (re-read); the utterance is this session's gate segment, MATCH with the active profile, a final local transcript of the whole
   * sentence, not flagged (Lega's voice in the microphone), said during this Lega session and recently, never used — then it is consumed
   * ONCE (`continue:<id>`) and the SAME executor as the typed „Continuă” runs as the owner session (owner channel, source voice-local).
   * A plan armed in this Lega session is answered first (its window is left untouched). Audited as owner.continue_voice. Reachable only
   * from the owner's own verified voice: never from a provider transcript, a Lega tool call, an agent or the cli.
   * 2.12.1: Lega's provider copy of the same sentence is a VETO only (VOICE-01: „Continuă?” or the resume among other words → nothing
   * resumes, one answer); a refused claim is said once (VOICE-02); a question the voice cannot answer becomes a pointer to the cockpit
   * (VOICE-03); the answer quotes what was heard (VOICE-05).
   * → { outcome, result?, heard?, prefix?, say?, silent?, duplicate? }: hub.mjs has the Hub say `say`, or `prefix` + its own description of
   * `result`; nothing when silent.
   */
  async function continueFromVoice({ utteranceId, ownerSessionId = null, legaSessionId = null } = {}) {
    const id = String(utteranceId || "").slice(0, 80);
    if (!id) return { outcome: "refused", reason: "segment vocal lipsă", silent: true };
    const t = nowMs();
    for (const [k, v] of voiceContinues) if (t - v.at > INTAKE_LIMITS.transcriptTtlMs) voiceContinues.delete(k);
    const seen = voiceContinues.get(id);
    if (seen) return { ...(await seen.promise), duplicate: true };
    if (voiceContinues.size >= VOICE_CONTINUE_MAX) voiceContinues.delete(voiceContinues.keys().next().value);
    const promise = continueFromVoiceOnce({ id, ownerSessionId: ownerSessionId ? String(ownerSessionId) : null, legaSessionId: legaSessionId ? String(legaSessionId) : null })
      .catch((error) => ({ outcome: "error", reason: String(error?.message || error).slice(0, 300), silent: true }));
    voiceContinues.set(id, { at: t, promise });
    return promise;
  }
  async function continueFromVoiceOnce({ id, ownerSessionId, legaSessionId }) {
    const audit = (outcome, extra = {}) => {
      try { bus.emit({ type: "owner.continue_voice", scopeType: "owner", scopeId: legaSessionId || "voice", source: "voice-local", payload: { utteranceId: id, legaSessionId, outcome, ...extra } }); } catch { /* closing */ }
    };
    const refuse = (reason) => { audit("refused", { reason: String(reason).slice(0, 200) }); return { outcome: "refused", reason, silent: true }; };
    // 1. The Lega session and the owner session behind it (the derived authority the bridge uses, re-read now). These refusals stay
    // silent: Lega's own line for the provider copy of the sentence answers them (it is silenced only while all of them hold).
    const derived = verifyLegaAuthority(legaSessionId, { channel: "voice" });
    if (!derived || !ownerSessionId || derived.ownerSessionId !== ownerSessionId) return refuse("sesiunea Lega nu (mai) e cea derivată din sesiunea ta de proprietar");
    const a = typeof hub.lega?.authorityOf === "function" ? hub.lega.authorityOf(legaSessionId) : null;
    if (!a || a.status !== "active" || a.stopping || a.authority !== "owner_session" || a.ownerSessionId !== ownerSessionId) return refuse("sesiunea Lega nu e activă");
    if (!a.gated) return refuse("sesiunea Lega nu a pornit cu filtrul vocal local");
    if (!hub.settings.get("voiceGate")?.enabled) return refuse("filtrul vocal local e oprit acum");
    // 2. The utterance: the owner's own verified words, during this Lega session, the whole sentence, never used before. VOICE-02: Lega
    // silenced its provider copy of this sentence (the local segment decides), so a refusal here is said once — never total silence.
    let claim;
    try {
      claim = voice.claimForContinue({ utteranceId: id, session: derived.session, purposes: ["gate"], legaSessionId, notBefore: hub.lega.state?.()?.startedAt || null, maxAgeMs: ARMED_LIMITS.transcriptDelayMs });
    } catch (error) { return { ...refuse(error.message), ...refusalLine(legaSessionId, error.message) }; }
    // 2b. VOICE-01: Lega's provider copy of the same sentence, waited for a short bounded time — a VETO only, never more authority. „Continuă?”
    // (a resume asked) or the resume among other words means the owner did not say a clean „Continuă”: nothing resumes.
    const recordedAt = Date.parse(claim.evidence.recordedAt);
    const copy = await providerCopyFor(legaSessionId, recordedAt, id);
    const still = verifyLegaAuthority(legaSessionId, { channel: "voice" });
    if (!still || still.ownerSessionId !== ownerSessionId) return refuse("sesiunea Lega nu (mai) e cea derivată din sesiunea ta de proprietar");
    // 3. Consumed ONCE, before anything runs (a second delivery of the same segment, or the page path, finds it used).
    if (claim.consume(`continue:${id}`) !== 1) { audit("duplicate"); return { outcome: "duplicate", silent: true, duplicate: true }; }
    const heard = claim.evidence.heard;
    const prefix = `Am auzit „${heardQuote(heard)}” (vocea ta, verificată local): `;
    if (copy?.veto) {
      audit("vetoed", { copy: copy.kind });
      // ONE answer for the sentence: the bridge's own (the resolver's question, or its refusal of the provider copy); this line only when
      // the bridge said nothing.
      const bridgeSpoke = await bridgeAnswered(legaSessionId, copy.id);
      return { outcome: "vetoed", heard, copy: copy.kind, ...(bridgeSpoke ? { silent: true } : { say: copy.kind === "question" ? CONTINUE_QUESTION : VETO_MIXED }) };
    }
    // Lega stays quiet about a late provider copy of this sentence (a resume already said once is not contradicted).
    try { hub.lega?.voiceContinueExecuted?.(legaSessionId, { recordedAt, copyId: copy?.id ?? null }); } catch { /* speech bookkeeping only */ }
    // 4. A plan waiting for its spoken answer in this Lega session comes first: its window is left as it is.
    const armed = armedPlanFor({ ownerSessionId, legaSessionId });
    if (armed) {
      audit("plan_waiting", { planId: armed });
      return { outcome: "plan_waiting", heard, say: `Am auzit „${heardQuote(heard)}”, dar planul afișat așteaptă întâi răspunsul tău: spune „Da, execută planul” sau „Nu acum”. Nu am reluat nimic.` };
    }
    // 5. The SAME executor as the typed „Continuă”, as the owner session (re-read: an ended or expired session refuses).
    let owner;
    try { owner = trust.requireSession({ id: ownerSessionId }, "„Continuă” spus cu vocea ta"); } catch (error) { return refuse(error.message); }
    const ctx = { channel: "owner", ownerSession: owner, actor: `owner:${owner.id}`, commandId: null };
    const conv = conversationOf(conversationKey(ctx, null));
    const step = { intent: "ops_continue", effect: INTENT_EFFECTS.ops_continue, effectClass: classOfIntent("ops_continue", INTENT_EFFECTS.ops_continue), args: {}, constraints: {}, text: "continua" };
    const r = { intent: step.intent, effect: step.effect, constraints: step.constraints, args: step.args, effectClass: step.effectClass };
    // The voice path never issues a rearm card (nothing would show it; the cockpit's GATE_SUSPENDED blocker does): the honest reason,
    // in the voice's words.
    try { Object.assign(r, await continueAsOwner(step, { ctx, conv, projectId: null, card: false, spoken: true })); }
    catch (error) { r.error = { category: error.category || "internal", message: error.message }; }
    if (r.clarification) bus.emit({ type: "intake.question", scopeType: "owner", scopeId: "global", source: ctx.actor, payload: { intent: "ops_continue", options: (r.clarification.options || []).length, via: "voice-local" } });
    const resumed = Boolean(r.interrupt?.reopened || r.plan?.id || r.desktop || (r.interrupt?.missions || []).some((m) => m.resumed));
    const outcome = r.error ? "error" : r.refused ? "refused" : r.clarification ? "question" : resumed ? "resumed" : r.gateRearm || r.gateStopped || r.stopHold ? "held" : "nothing";
    // UI-04: what still holds the gate travels with the audit (the page says the same reason as the Hub, never a different first step).
    const gate = r.gateStopped || r.stopHold ? { code: r.stopHold?.code || r.gateStopped.code, reason: String(r.message || r.gateStopped?.reason || "").slice(0, 300) } : null;
    audit(outcome, { sessionId: owner.id, ...(gate ? { gate } : {}) });
    // VOICE-03: a choice the voice cannot make (several stopped plans or missions) is a pointer to the cockpit — after what was reopened.
    if (r.clarification) return { outcome, result: r, heard, say: `${prefix}${voicePointer(r)}` };
    // VOICE-05: nothing stopped and the gate open — one short line, not a report.
    if (outcome === "nothing" && gateNow().status === "open" && !r.expiredPlans) return { outcome, result: r, heard, say: `${prefix}nu e nimic oprit de reluat.` };
    return { outcome, result: r, heard, prefix };
  }
  /**
   * VOICE-01: Lega's provider copy of the sentence spoken at `recordedAt` (the first continue-related copy at or after it, not yet used —
   * hub.lega keeps them per session), waited for at most VOICE_COPY_WAIT_MS of real time. null when none came: the local evidence alone
   * decides, as before. The copy is claimed for this utterance (one copy, one sentence).
   */
  async function providerCopyFor(legaSessionId, recordedAt, utteranceId) {
    if (typeof hub.lega?.providerCopyAfter !== "function" || !Number.isFinite(recordedAt)) return null;
    const deadline = Date.now() + VOICE_COPY_WAIT_MS;
    for (;;) {
      let copy = null;
      try { copy = hub.lega.providerCopyAfter(legaSessionId, recordedAt, { claimFor: utteranceId }); } catch { copy = null; }
      if (copy || Date.now() >= deadline) return copy;
      await new Promise((resolve) => setTimeout(resolve, VOICE_COPY_POLL_MS));
    }
  }
  /** VOICE-01: whether the bridge spoke its own answer to a vetoing copy (waited for at most VOICE_COPY_SETTLE_MS: one line, never two). */
  async function bridgeAnswered(legaSessionId, copyId) {
    const deadline = Date.now() + VOICE_COPY_SETTLE_MS;
    for (;;) {
      let st = null;
      try { st = hub.lega?.providerCopyState?.(legaSessionId, copyId) || null; } catch { st = null; }
      if (!st) return false;
      if (st.settled) return Boolean(st.spoke);
      if (Date.now() >= deadline) return false;
      await new Promise((resolve) => setTimeout(resolve, VOICE_COPY_POLL_MS));
    }
  }
  /** VOICE-02: a refused spoken „Continuă” is said, once per Lega session and reason in a short window (two segments, one answer). */
  const refusalsSaid = new Map(); // legaSessionId → { text, at }
  function refusalLine(legaSessionId, reason) {
    const text = String(reason || "").replace(/\s+/g, " ").trim().slice(0, 300);
    if (!text || !legaSessionId) return { silent: true };
    const last = refusalsSaid.get(legaSessionId);
    if (last && last.text === text && Date.now() - last.at < VOICE_REFUSAL_REPEAT_MS) return { silent: true };
    if (refusalsSaid.size >= INTAKE_LIMITS.conversationMax && !refusalsSaid.has(legaSessionId)) refusalsSaid.delete(refusalsSaid.keys().next().value);
    refusalsSaid.set(legaSessionId, { text, at: Date.now() });
    return { silent: false, say: text };
  }
  /**
   * VOICE-03: the voice cannot pick one of several stopped plans or missions (no spoken answer is matched to the options, and a provider
   * transcript never resumes): what the „Continuă” already did (the gate reopened after the owner's pause), then where the choice is made.
   */
  function voicePointer(r) {
    const opts = (r.clarification?.options || []).slice(0, 4);
    const names = opts.map((o) => `„${String(o.label || o.id).slice(0, 80)}”`).join(", ");
    const lead = r.interrupt?.reopened && r.interrupt.summary ? `${r.interrupt.summary} ` : "";
    const plans = opts.length && opts.every((o) => /^opp_/.test(String(o.id)));
    const body = plans
      ? `Am ${opts.length} planuri de operare oprite (${names}); pe care îl reiau alegi în cockpit, cu butonul „Continuă” al planului.`
      : `Am ${opts.length === 1 ? "o misiune oprită" : `${opts.length} misiuni oprite`} (${names}); pe care o reiau alegi în cockpit: scrie „Continuă” și apasă pe ea, sau scrie „Reia misiunea …”.`;
    return `${lead}${body}`;
  }

  // ---------------------------------------------------------------- preserved requests → planners (U06 ↔ U10 bridge)
  /**
   * The work-request service's re-planner (owner/work-requests.mjs replan, a proposal only): a preserved Studio request goes back
   * through the Content Studio planner — after an import the newest clip is taken instead of asking, since nobody is there to answer —
   * and returns { planRef, headline } for ONE ops plan; still nothing renderable → { blocked } (the request stays as it is). An
   * engineering request keeps the service's own default (a PROPOSED envelope over the request's draft), unchanged.
   */
  async function replanRequest(r) {
    // M12 (T-S3), final review F2/F4: a preserved request that is ONLY an instruction to send, contact or publish is never turned into work
    // by a later re-plan; a mixed one is re-planned without those words (a description of a feature was never one).
    const cut = stripOutreach(String(r?.text || ""));
    if ((cut.refused.length || cut.own?.length) && !cut.meaningful) return { blocked: true };
    if (cut.changed) r = { ...r, text: cut.text };
    if (r?.intent === "studio") {
      const words = String(r.text || "");
      const resolvedArgs = (() => { try { return resolveIntent(words, { projects: [], missions: [], departments: [], pendingEnvelopes: [] }).steps.find((s) => s.intent === "studio_create")?.args || {}; } catch { return {}; } })();
      const step = { intent: "studio_create", effect: "plan", effectClass: "BOUNDED_WORKFLOW", args: { ...resolvedArgs }, constraints: {}, text: words };
      const out = await content.plan({ step, text: words, ctx: { channel: "automation", actor: `readiness:${r.id}` }, prefer: "newest" });
      if (out?.kind === "ops" && out.plan?.id) return { planRef: { kind: "ops", id: out.plan.id, contentProjectId: out.contentProjectId || null }, headline: out.plan.title, eligible: true };
      return { blocked: true };
    }
    if (r?.intent === "run" && r.projectId && planners.has("run")) {
      // A kept analysis request is re-proposed as its ONE run plan when the blocker clears (proposal only; the owner still confirms).
      const words = String(r.text || "");
      const out = await planners.get("run")({ step: { intent: "run", effect: "plan", args: { task: words }, constraints: {} }, text: words, projectId: r.projectId,
        source: "typed", ctx: { channel: "automation", actor: `readiness:${r.id}` }, session: null, hub, lastTarget: null });
      if (out?.kind === "envelope" && out.proposal?.envelope) return { planRef: { kind: "envelope", id: out.proposal.envelope.id, missionId: null }, headline: out.proposal.summary?.headline || "", eligible: true };
      return { blocked: true };
    }

    // M12 final review (F7): a kept offer request (no exports folder yet) → the same Sales planner once the folder exists (ONE card, a proposal).
    if (r?.intent === SALES_KEPT_INTENT) return salesKept.replan(r);
    if (r?.intent !== "engineering" || !envelopes || !r.projectId) return null;
    const missionId = r.planRef?.missionId || null;
    const out = await envelopes.propose({ projectId: r.projectId, missionIds: missionId ? [missionId] : [], actor: `readiness:${r.id}`, via: "work_request" });
    if (!out?.envelope) return { blocked: true, readiness: out?.readiness || null };
    return { planRef: { kind: "envelope", id: out.envelope.id, missionId: out.envelope.missionIds?.[0] || missionId }, headline: out.summary?.headline || "", eligible: Boolean(out.readiness?.eligible), body: out.envelope.body || null };
  }
  /**
   * Binds the bridge to the work-request service (created after the intake in hub.mjs; bound on the next microtask). A Studio request
   * is explained with the Studio facts only (material, edit plans, tools): the execution gate, autonomy, isolation and billing gate
   * model runs, never a local render plan; every other request keeps the readiness runner's explanation.
   */
  let bound = null;
  function bindWorkRequests(service = requestStore()) {
    if (!service || typeof service.attachPlanner !== "function") return false;
    if (bound === service) return true;
    service.attachPlanner((r) => replanRequest(r));
    if (typeof service.attachExplainer === "function") service.attachExplainer(async (r) => (r?.intent === "studio" ? content.explainRequest()
      // M12 final review (F7): a kept offer request is explained by its own blocker (the exports folder), never by the model-run readiness.
      : r?.intent === SALES_KEPT_INTENT ? salesKept.explain(r)
        : hub.readiness?.explainRequest ? hub.readiness.explainRequest(r) : null));
    bound = service;
    return true;
  }
  queueMicrotask(() => { try { bindWorkRequests(); } catch { /* the service may be absent in a partial hub */ } });
  // A Studio project import finishes AFTER its assets (each asset event is a clearing event while the edit plans do not exist yet):
  // the end of the import re-plans the preserved Studio requests once more (bounded retries while another re-plan is in flight).
  bus.subscribe?.((event) => {
    if (event?.type !== "media.project.imported") return;
    const service = requestStore();
    if (!service?.replan || !service.list) return;
    let rows = [];
    try { rows = service.list({ status: ["BLOCKED"], limit: 20 }).filter((w) => w.intent === "studio"); } catch { rows = []; }
    for (const w of rows) {
      let tries = 0;
      // The asset events' re-plan may still be running (a first tools inspection hashes ffmpeg and its libraries: seconds), so a
      // busy answer is retried for up to ~15 s; the service serializes re-plans per request, so this never plans twice.
      const attempt = () => { tries += 1; service.replan(w.id).then((res) => { if (res?.status === "busy" && tries < 30) setTimeout(attempt, 500).unref?.(); }).catch(() => {}); };
      setImmediate(attempt);
    }
  });
  // M12 final review (F7): choosing the exports folder (media policy, a folder access, an import) re-plans the kept offer requests.
  const salesKept = createSalesKeptRequests({ hub, plannerOf: () => planners.get("sales"), requestStore });
  bus.subscribe?.((event) => { try { salesKept.onEvent(event); } catch { /* a listener never breaks the publisher */ } });

  return { handle, plan, registerPlanner, attachWorkRequests, verifyLegaAuthority, conversationOf: (key) => conversations.get(key) || null, conversationKey,
    planners: () => [...planners.keys()], replanRequest, bindWorkRequests,
    /** Lega (runtime/lega.mjs) asks whether its session has an armed plan (review #13: a spoken yes is then the local gate's to decide). */
    armedPlanFor,
    /** Review #7: a pause that had no owner session (Lega's gate-suspension fallback) stops running operation plans the same way. */
    pauseOpsPlans: (opts = {}) => (typeof interrupts?.pauseOpsPlans === "function" ? interrupts.pauseOpsPlans(opts) : []),
    /** M10.2.1 (D18): the owner's verified spoken „Continuă” of a gated Lega session (hub.mjs routes voice.continue_heard here). */
    continueFromVoice,
    /** lega.studio_overview data (U08): bounded counts, the newest render and clip, titles redacted; no model, no tool spawned. */
    studioOverview: () => content.overview(), contentPlanner: content };
}
