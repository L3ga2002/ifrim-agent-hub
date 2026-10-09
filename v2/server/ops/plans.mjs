// M10 operation plans — the zero-form path for multi-step work across apps and the Studio.
// propose: every step's executor DESCRIBES what it will touch (apps, folders, data observed / transmitted, operations, outputs, model);
//   each operation is classified (policy/action-policy.mjs). REFUSED → no plan. SENSITIVE → listed as an explicit decision INSIDE the
//   same card (the exact difference), applied only by the confirmation, with a fresh re-authentication (step-up).
// confirm: ONE consumable confirmation in the owner's authenticated session (click / typed / a spoken "Da, execută planul" with local
//   evidence — never a provider transcript, TTS or clip audio): the plan is rebuilt and must hash the same as what was shown; the
//   derived authority (apps, folders, operations, expiry, action budget) is stored with the consent.
// run: steps execute in order; EVERY operation asks authorize() first (status, expiry, owner session still open, step, op, app, folder,
//   budget). A pause / Stop / "Preiau eu" / an intervention stops new operations; "Continuă" reconciles uncertain steps first and never
//   widens the limits. Grants are internal: the owner never creates, times or opens anything by hand.
import crypto from "node:crypto";
import { HubError } from "../core/errors.mjs";
import { newId } from "../core/ids.mjs";
import { hashCanonical } from "../core/canonical.mjs";
import { json, parse } from "../storage/db.mjs";
import { classifyAction, insideAny } from "../policy/action-policy.mjs";
import { createArmedWindows } from "../owner/armed-window.mjs";
import { createStopScope, STOP_HOLD_CLASSES } from "../owner/stop-scope.mjs";
import { classifySuspension } from "../policy/gate-state.mjs";

export const PLAN_LIMITS = Object.freeze({ confirmWindowMin: 15, slackMin: 30, maxSteps: 16, defaultMaxDurationMin: 30, maxDurationMin: 240, maxActionsPerStep: 200 });
export const NEVER_IN_PLANS = Object.freeze(["publicare pe platforme", "încărcare (upload)", "trimiterea de mesaje", "plăți sau cumpărături", "ștergeri externe", "schimbarea setărilor de securitate"]);
const ACTIVE = new Set(["CONFIRMED", "RUNNING"]);
/**
 * M10.2 review #40: the secrets a step needs at confirmation (typed in the plan card, memory only, never in the body, hash, DB or a log),
 * derived from the step kinds — the same list for the plan view, the card shape and confirm(), so a typed, spoken or armed-window
 * „Da” without them is refused BEFORE the confirmation is used up (the OBS step would otherwise fail mid-plan with no password).
 */
export const SECRETS_BY_STEP = Object.freeze({ "capture.obs_record": "obsPassword" });
export const secretsNeeded = (steps = []) => [...new Set((Array.isArray(steps) ? steps : []).map((s) => SECRETS_BY_STEP[s?.kind]).filter(Boolean))];
const missingSecrets = (steps, given) => secretsNeeded(steps).filter((k) => !(given && typeof given === "object" && typeof given[k] === "string" && given[k].length > 0 && given[k].length <= 1024));

export function createOpsPlans({ db, bus, clock, settings, trust, voice = null, apps = null, executors = {}, folderContext = () => ({ allowed: [], forbidden: [] }), live = null, desktop = null,
  // M10.2 U13: the armed-window registry shared with the envelopes (hub.mjs); standalone → its own, with no Lega check (never arms).
  armedWindows = createArmedWindows({ clock, bus }),
  // 2.12.1 (D22): what the current Stop All / shutdown / security suspension itself stopped (owner/stop-scope.mjs) — the reader, or a
  // function returning it (hub.stopScope once wired); without one a private read-only reader over the same database.
  stopScope = null }) {
  const now = () => clock().toISOString();
  const runs = new Map(); // planId → { promise, abort }
  const used = new Map(); // planId → actions used (also persisted in progress_json)
  // Transient secrets a step needs (e.g. the OBS WebSocket password the owner typed at confirmation): memory only, never in the plan
  // body, its hash, the database or a log; dropped when the plan ends.
  const secrets = new Map();
  /** "$pas:<seq>.<path>" → the value from an earlier step's verified result (resolved at run time, never guessed at proposal). */
  function resolveRefs(value, done) {
    if (typeof value === "string") {
      const m = value.match(/^\$pas:(\d+)\.([\w.]+)$/);
      if (!m) return value;
      const src = done.find((st) => st.seq === Number(m[1]));
      if (!src || src.status !== "DONE") throw new HubError("conflict", `Pasul ${m[1]} nu are încă un rezultat verificat.`, { code: "STEP_REF_MISSING" });
      const v = m[2].split(".").reduce((o, k) => (o == null ? undefined : o[k]), src.result);
      if (v === undefined) throw new HubError("conflict", `Rezultatul pasului ${m[1]} nu are ${m[2]}.`, { code: "STEP_REF_MISSING" });
      return v;
    }
    if (Array.isArray(value)) return value.map((v) => resolveRefs(v, done));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveRefs(v, done)]));
    return value;
  }

  const row = (id) => db.prepare("SELECT * FROM ops_plans WHERE id = ?").get(String(id || ""));
  const stepsOf = (id) => db.prepare("SELECT * FROM ops_plan_steps WHERE plan_id = ? ORDER BY seq").all(id).map(stepView);
  const stepView = (r) => ({ id: r.id, planId: r.plan_id, seq: r.seq, kind: r.kind, title: r.title, params: parse(r.params_json, {}), status: r.status, attempts: r.attempts,
    result: parse(r.result_json, {}), evidence: parse(r.evidence_json, []), error: r.error, startedAt: r.started_at, finishedAt: r.finished_at });
  function view(id) {
    const r = row(id);
    if (!r) return null;
    const body = parse(r.body_json, {});
    return { id: r.id, kind: r.kind, title: r.title, status: r.status, statusReason: r.status_reason, body, summary: parse(r.summary_json, {}), hash: r.plan_hash,
      // Review #40: which secrets the confirmation must carry (names only, never values), for every shape of the card.
      needsSecrets: secretsNeeded(body.steps),
      nonce: r.status === "PROPOSED" ? r.nonce : undefined, confirmBy: r.confirm_by, expiresAt: r.expires_at, consent: parse(r.consent_json, null), authority: parse(r.authority_json, null),
      progress: parse(r.progress_json, {}), steps: stepsOf(r.id), proposedBy: r.proposed_by, proposedVia: r.proposed_via, createdAt: r.created_at, updatedAt: r.updated_at,
      // M10.2 U13: until when the plan is armed for a spoken confirmation (ISO, or null); never the window's nonces.
      armedUntil: r.status === "PROPOSED" ? armedWindows.armedUntil(r.id) : null };
  }
  function setStatus(id, status, reason = "", extra = {}, from = null) {
    const sets = ["status = ?", "status_reason = ?", "updated_at = ?", "version = version + 1", ...Object.keys(extra).map((k) => `${k} = ?`)];
    const args = [status, String(reason).slice(0, 500), now(), ...Object.values(extra)];
    const where = from ? ` AND status IN (${from.map(() => "?").join(",")})` : "";
    const n = db.prepare(`UPDATE ops_plans SET ${sets.join(", ")} WHERE id = ?${where}`).run(...args, id, ...(from || [])).changes;
    if (n) bus.append({ type: `ops.plan.${status.toLowerCase()}`, scopeType: "ops_plan", scopeId: id, source: "ops", payload: { reason: String(reason).slice(0, 200) } });
    return n;
  }

  // ---------------------------------------------------------------- describe + classify
  /** The plan body: deterministic from the steps' descriptions (rebuilt at confirmation; any difference supersedes the shown plan). */
  async function buildBody({ kind, title, steps, limits = {} }) {
    if (!Array.isArray(steps) || !steps.length) throw new HubError("validation", "Planul nu are pași.");
    if (steps.length > PLAN_LIMITS.maxSteps) throw new HubError("validation", `Cel mult ${PLAN_LIMITS.maxSteps} pași într-un plan.`);
    const folders = folderContext();
    const described = [];
    const decisions = [];
    const refused = [];
    const appIds = new Set(), folderSet = new Set(), observed = new Set(), transmitted = new Set(), outputs = [];
    let model = null;
    for (const [i, s] of steps.entries()) {
      const ex = executors[s.kind];
      if (!ex) throw new HubError("validation", `Tip de pas necunoscut: ${s.kind}`);
      const d = await ex.describe(s.params || {});
      const ops = [];
      for (const o of d.ops || []) {
        const app = o.appId && apps ? apps.get(o.appId) : null;
        // Only the already-approved folders (import roots, exports) count as allowed here: a folder the step merely DESCRIBES is a new
        // access, so it becomes an explicit decision in the card (step-up at confirmation), never an implicit widening.
        const v = classifyAction(o.op, { app, path: o.path, destination: o.destination, overwrite: o.overwrite, controlName: o.controlName,
          allowedFolders: (o.path || o.destination) ? folders.allowed : undefined, forbiddenFolders: folders.forbidden, liveCapture: settings.get("mediaPolicy")?.liveCapture === true });
        ops.push({ op: o.op, appId: o.appId || null, class: v.class, path: o.path || null, destination: o.destination || null });
        if (v.class === "REFUSED") refused.push(`${s.title || s.kind}: ${v.reasons.join("; ")}`);
        if (v.class === "SENSITIVE") {
          // The decisions a plan may carry (applied by its confirmation, with a fresh re-authentication): authorize an installed,
          // identity-verified app; open a folder for this plan only. EVERY sensitive reason must be one of these; anything else
          // (an overwrite, an unknown operation, live capture without MB1, an executable file, cost, publication) is not decided in a plan.
          const unresolved = [];
          for (const why of v.reasons) {
            if (why.includes("nu e autorizată încă pentru operator") && app && app.status === "DISCOVERED") {
              decisions.push({ kind: "app.authorize", appId: app.id, label: `Autorizezi ${app.displayName} ${app.version || ""} (semnătură ${app.signature?.signer ? app.signature.signer.split(",")[0] : "verificată"}) pentru operator` });
            } else if (why.startsWith("în afara folderelor aprobate")) {
              for (const target of [o.path, o.destination].filter(Boolean).filter((p) => !insideAny(folders.allowed, p))) {
                const folder = (d.folders || []).find((f) => insideAny([f], target)) || target;
                decisions.push({ kind: "folder.plan", folder, label: `Acces la folderul ${folder} doar pentru acest plan` });
              }
            } else unresolved.push(why);
          }
          if (unresolved.length) refused.push(`${s.title || s.kind}: ${unresolved.join("; ")} (decizie separată, nu intră într-un plan)`);
        }
      }
      for (const a of d.apps || []) appIds.add(a);
      for (const f of d.folders || []) folderSet.add(f);
      for (const x of d.observed || []) observed.add(x);
      for (const x of d.transmitted || []) transmitted.add(x);
      outputs.push(...(d.outputs || []));
      if (d.model) model = d.model;
      // M10.2 (U11): each step keeps its OWN apps and folders, so the authority derived at confirmation is per step (an operation of
      // step 2 attempted while step 1 runs is out of plan, even though the plan as a whole includes it).
      described.push({ seq: i + 1, kind: s.kind, title: String(s.title || d.title || s.kind).slice(0, 160), params: d.params || s.params || {}, ops,
        apps: [...new Set([...(d.apps || []), ...ops.map((o) => o.appId).filter(Boolean)])], folders: [...new Set(d.folders || [])] });
    }
    if (refused.length) throw new HubError("policy", `Planul conține operații pe care nu le fac: ${refused.join(" · ")}`, { code: "PLAN_REFUSED", data: { refused } });
    const appList = [...appIds].map((id) => { const a = apps?.get(id); return a ? { id: a.id, name: a.displayName, version: a.version, exeSha256: a.exeSha256, authorized: a.authorized } : { id }; });
    const uniqDecisions = [...new Map(decisions.map((x) => [`${x.kind}:${x.appId || x.folder}`, x])).values()];
    const maxDurationMin = Math.min(PLAN_LIMITS.maxDurationMin, Math.max(5, Number(limits.maxDurationMin) || PLAN_LIMITS.defaultMaxDurationMin));
    return { schema: 1, kind, title: String(title).slice(0, 200), steps: described, apps: appList, folders: [...folderSet], observed: [...observed], transmitted: [...transmitted],
      outputs, model, decisions: uniqDecisions, limits: { maxDurationMin, maxActions: Math.min(PLAN_LIMITS.maxActionsPerStep * described.length, Number(limits.maxActions) || 400) },
      never: NEVER_IN_PLANS };
  }
  function summaryOf(body) {
    return { headline: body.title, steps: body.steps.map((s) => s.title), apps: body.apps.map((a) => a.name || a.id), folders: body.folders, observed: body.observed,
      transmitted: body.transmitted.length ? body.transmitted : ["nimic nu pleacă din calculator"], outputs: body.outputs, model: body.model ? `${body.model.provider} ${body.model.model} · ${body.model.effort}` : "fără model",
      limits: `cel mult ${body.limits.maxDurationMin} min, ${body.limits.maxActions} operații`, decisions: body.decisions.map((d) => d.label), never: body.never, confirmations: 1 };
  }

  async function propose({ kind, title, steps, limits = {}, actor = "owner", via = "ui" }) {
    const body = await buildBody({ kind, title, steps, limits });
    const hash = hashCanonical(body);
    const id = newId("opp");
    const nonce = crypto.randomBytes(12).toString("hex");
    const t = clock();
    bus.transaction(() => {
      // Only the latest proposal can be confirmed (an older card of the same kind is superseded).
      for (const old of db.prepare("SELECT id FROM ops_plans WHERE status = 'PROPOSED' AND kind = ?").all(kind)) setStatus(old.id, "SUPERSEDED", "Un plan mai nou a fost prezentat", {}, ["PROPOSED"]);
      db.prepare(`INSERT INTO ops_plans (id, kind, title, status, body_json, summary_json, plan_hash, nonce, proposed_by, proposed_via, confirm_by, expires_at, created_at, updated_at)
        VALUES (?, ?, ?, 'PROPOSED', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, kind, body.title, json(body), json(summaryOf(body)), hash, nonce, String(actor).slice(0, 80), String(via).slice(0, 40),
        new Date(t.getTime() + PLAN_LIMITS.confirmWindowMin * 60000).toISOString(), new Date(t.getTime() + (body.limits.maxDurationMin + PLAN_LIMITS.slackMin) * 60000).toISOString(), now(), now());
      for (const s of body.steps) db.prepare("INSERT INTO ops_plan_steps (id, plan_id, seq, kind, title, params_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(newId("ops"), id, s.seq, s.kind, s.title, json(s.params), now());
      bus.append({ type: "ops.plan.proposed", scopeType: "ops_plan", scopeId: id, source: actor, payload: { kind, via, steps: body.steps.length, decisions: body.decisions.length, hash: hash.slice(0, 16) } });
    });
    return view(id);
  }

  // ---------------------------------------------------------------- confirm
  async function confirm({ planId, nonce, displayedHash, session, modality = "click", utteranceId = null, idempotencyKey = null, secrets: given = null }) {
    const s = trust.requireSession(session, "confirmarea planului");
    // M10.2 U13: a spoken confirmation is keyed by its utterance (the armed window and the page path find the same key → duplicate).
    if (modality === "voice" && utteranceId) idempotencyKey = `voice:${String(utteranceId).slice(0, 80)}`;
    let p = view(planId);
    if (!p) throw new HubError("not_found", "Plan necunoscut");
    if (p.status !== "PROPOSED") {
      if (idempotencyKey && p.consent?.idempotencyKey === idempotencyKey) return { plan: p, duplicate: true };
      throw new HubError("conflict", `Planul nu mai așteaptă confirmarea (${p.status})`);
    }
    if (new Date(p.confirmBy) <= clock()) { bus.transaction(() => setStatus(planId, "EXPIRED", "Confirmarea a venit după termen", {}, ["PROPOSED"])); throw new HubError("conflict", "Planul a expirat; cere-l din nou ca să vezi starea actuală."); }
    if (nonce !== row(planId).nonce || displayedHash !== p.hash) throw new HubError("conflict", "Confirmarea nu corespunde planului afișat (altă versiune); reîncarcă planul.");
    if (!["click", "keyboard", "typed", "voice"].includes(modality)) throw new HubError("validation", "Modalitate necunoscută");
    // Review #40: a step that needs a secret typed in the card (the OBS WebSocket password) cannot run without it: refused here, before
    // the spoken segment is claimed and before CONFIRMED — the plan stays PROPOSED and the owner's one confirmation is not used up.
    const missing = missingSecrets(p.body.steps, given);
    if (missing.length) throw new HubError("validation", "Planul are nevoie de parola OBS WebSocket: scrie-o în card și apasă Enter sau „Confirmă planul” (parola nu trece prin conversație). Planul rămâne afișat; nimic nu a pornit.",
      { code: "OBS_PASSWORD_NEEDED", data: { needsSecrets: missing } });
    // Decisions inside the card (new app / folder) widen access: they need a fresh re-authentication (step-up), not a new form.
    if (p.body.decisions.length) trust.requireFresh(s, "planul care autorizează o aplicație sau un folder nou");
    let spoken = null;
    if (modality === "voice") {
      if (!voice?.claimForConfirmation) throw new HubError("policy", "Confirmarea vocală nu e disponibilă; confirmă cu tasta sau butonul.");
      if (!utteranceId) throw new HubError("validation", "Confirmarea vocală trebuie să indice segmentul vocal înregistrat pentru plan.");
      spoken = voice.claimForConfirmation({ utteranceId, session: s, envelope: { id: planId }, pendingEnvelopes: [{ id: planId, title: p.title }], notBefore: p.createdAt });
    }
    // Nothing may have changed since it was shown (apps, binaries, folders, policy).
    const rebuilt = await buildBody({ kind: p.kind, title: p.body.title, steps: p.steps.map((st) => ({ kind: st.kind, title: st.title, params: st.params })), limits: p.body.limits }).catch((error) => ({ error }));
    if (rebuilt.error || hashCanonical(rebuilt) !== p.hash) {
      const diff = rebuilt.error ? [rebuilt.error.message] : changed(p.body, rebuilt);
      bus.transaction(() => setStatus(planId, "SUPERSEDED", `S-a schimbat: ${diff.join(", ")}`, {}, ["PROPOSED"]));
      throw new HubError("conflict", `Planul s-a schimbat după ce l-ai văzut (${diff.join(", ")}); îți arăt diferența și confirmi din nou.`, { data: { changed: diff } });
    }
    const consent = { channel: "owner_session", modality, sessionId: s.id, credential: String(s.credentialId || "").slice(0, 10), planHash: p.hash, confirmedAt: now(),
      idempotencyKey: idempotencyKey ? String(idempotencyKey).slice(0, 120) : null, voice: spoken ? spoken.evidence : null, decisions: p.body.decisions.map((d) => d.label) };
    const authority = authorityOf(p, s.id);
    bus.transaction(() => {
      if (spoken && spoken.consume(planId) !== 1) throw new HubError("conflict", "Fraza vocală a fost deja folosită pentru o confirmare");
      const n = setStatus(planId, "CONFIRMED", `Confirmat (${modality}) în sesiunea ${s.id}`, { consent_json: json(consent), authority_json: json(authority), owner_session_id: s.id }, ["PROPOSED"]);
      if (n !== 1) throw new HubError("conflict", "Planul a fost deja confirmat (altă filă sau o confirmare dublă)");
      for (const d of p.body.decisions) if (d.kind === "app.authorize") apps.authorize([d.appId], { sessionId: s.id, via: `plan:${planId}`, actor: "owner" });
      bus.append({ type: "ops.plan.consent", scopeType: "ops_plan", scopeId: planId, source: "owner", payload: { modality, session: s.id, decisions: consent.decisions.length, hash: p.hash.slice(0, 16) } });
    });
    if (given && typeof given === "object") secrets.set(planId, Object.fromEntries(Object.entries(given).filter(([, v]) => typeof v === "string" && v.length <= 1024)));
    start(planId);
    return { plan: view(planId), duplicate: false };
  }
  function changed(before, after) {
    const keys = ["steps", "apps", "folders", "observed", "transmitted", "outputs", "model", "decisions", "limits"];
    return keys.filter((k) => hashCanonical(before[k] ?? null) !== hashCanonical(after[k] ?? null));
  }

  // ---------------------------------------------------------------- M10.2 U13: the armed spoken confirmation (shared helper)
  // The same window as the envelopes (owner/armed-window.mjs): opened by the SERVER when the plan was presented in a live Lega session
  // derived from the owner session, with the local gate running; a spoken "Da, execută planul" (speaker MATCH, local final transcript,
  // segment bound by the server to THIS plan) then confirms through confirm() with modality "voice" — never a provider transcript.
  armedWindows.registerKind("ops", { waiting: (id, hash) => { const r = row(id); return Boolean(r && r.status === "PROPOSED" && r.plan_hash === hash && new Date(r.confirm_by) > clock()); } });
  /** Arms a presented plan (`session`: the owner session of the cockpit request, which must be the Lega session's own). */
  function armForLega({ planId, legaSessionId, session = null, dryRun = false, via = "lega" }) {
    if (!trust.policy?.()?.active) throw new HubError("policy", "Politica voice-first nu este activă");
    const r = row(planId);
    if (!r || r.status !== "PROPOSED" || new Date(r.confirm_by) <= clock()) throw new HubError("conflict", "Planul nu mai așteaptă confirmarea");
    // Review #40: a spoken „Da” can never carry the OBS password (it is typed in the card), so such a plan is not armed for the voice.
    if (secretsNeeded(parse(r.body_json, {}).steps).length) throw new HubError("policy", "Nu deschid fereastra vocală: planul are nevoie de parola OBS, pe care o scrii în card (apoi Enter sau „Confirmă planul”)", { code: "OBS_PASSWORD_NEEDED" });
    const check = armedWindows.lega(legaSessionId, session?.id || null);
    if (!check.ok) throw new HubError("policy", `Nu deschid fereastra vocală: ${check.reason}`);
    const s = trust.requireSession({ id: check.ownerSessionId }, "fereastra de confirmare vocală");
    // A plan that authorizes a new app or folder needs a fresh re-authentication at confirmation (step-up): by voice only while the
    // session is still fresh from Windows Hello; otherwise the click (with Windows Hello) stays the way.
    if (parse(r.body_json, {}).decisions?.length) trust.requireFresh(s, "confirmarea vocală a unui plan care autorizează o aplicație sau un folder nou (altfel confirmă cu butonul și Windows Hello)");
    if (dryRun) return { planId: r.id, armed: false, eligible: true };
    const w = armedWindows.arm({ kind: "ops", planId: r.id, projectId: null, ownerSessionId: s.id, legaSessionId, hash: r.plan_hash, nonce: r.nonce, via });
    return { planId: r.id, armed: true, armedAt: w.armedAt, expiresAt: w.expiresAt, say: w.say };
  }
  async function confirmFromArmed({ utteranceId, planId, sessionId, legaSessionId = null }) {
    const out = await armedWindows.confirmFrom({ planId, utteranceId, sessionId, legaSessionId },
      (w) => confirm({ planId, nonce: w.nonce, displayedHash: w.hash, session: { id: sessionId }, modality: "voice", utteranceId }));
    return out.confirmed ? { confirmed: true, duplicate: out.duplicate, plan: out.result?.plan || view(planId) } : out;
  }
  const armedFor = (planId, sessionId, legaSessionId = null) => armedWindows.armedFor(planId, sessionId, legaSessionId);

  /**
   * The authority a confirmation derives (M10.2 U11): the plan-wide lists stay (older readers, the union), plus `steps`: what EACH step
   * may touch (its operations, its apps, its folders), keyed by seq — authorize() checks the running step's own entry. A folder the
   * owner opened for this plan in the card (a folder.plan decision) is part of the folders of the plan and of the step that touches it
   * (M10 refused it at run time because only body.folders was stored).
   */
  function authorityOf(p, sessionId) {
    const decided = (p.body.decisions || []).filter((d) => d.kind === "folder.plan" && d.folder).map((d) => d.folder);
    const steps = Object.fromEntries(p.body.steps.map((st) => {
      const targets = st.ops.flatMap((o) => [o.path, o.destination]).filter(Boolean);
      const folders = [...new Set([...(st.folders || []), ...decided.filter((f) => targets.some((t) => insideAny([f], t)))])];
      return [String(st.seq), { ops: [...new Set(st.ops.map((o) => o.op))], apps: [...new Set([...(st.apps || []), ...st.ops.map((o) => o.appId).filter(Boolean)])], folders }];
    }));
    return { planId: p.id, sessionId, expiresAt: p.expiresAt, apps: p.body.apps.map((a) => a.id), folders: [...new Set([...(p.body.folders || []), ...decided])],
      ops: [...new Set(p.body.steps.flatMap((st) => st.ops.map((o) => o.op)))], maxActions: p.body.limits.maxActions, steps };
  }

  // ---------------------------------------------------------------- M11: plans derived from a stronger confirmation
  // A delivery's package (capture → clip → summary) is not confirmed again: it is DERIVED from the envelope the owner confirmed once,
  // whose hashed body already listed these exact steps (ops body sha). The derivation runs one way only: the weaker ops authority comes
  // from the stronger envelope consent, never the reverse. authorize(), resume() and reconfirm() are unchanged.
  const parents = new Map(); // kind → { verify(parent) → { ok, reason }, allowedOps: Set }
  function registerParent(kind, { verify, allowedOps }) {
    if (typeof verify !== "function" || !Array.isArray(allowedOps) || !allowedOps.length) throw new Error("registerParent needs verify() and allowedOps");
    parents.set(String(kind), { verify, allowedOps: new Set(allowedOps) });
  }
  async function adoptDerived({ kind, title, steps, limits = {}, parent, expectedBodySha, sessionId, credential = "" }) {
    const reg = parents.get(String(parent?.kind || ""));
    if (!reg) throw new HubError("policy", "Planul derivat nu are un părinte cunoscut.", { code: "PLAN_DERIVED_PARENT" });
    const body = await buildBody({ kind, title, steps, limits });
    const bodySha = hashCanonical(body);
    if (bodySha !== expectedBodySha) throw new HubError("conflict", "Pașii livrării s-au schimbat față de planul confirmat.", { code: "PLAN_DERIVED_CHANGED", data: { expected: String(expectedBodySha || "").slice(0, 16), actual: bodySha.slice(0, 16) } });
    if (body.decisions.length) throw new HubError("policy", "Un plan derivat nu poate conține decizii (aplicație sau folder nou).", { code: "PLAN_DERIVED_DECISION" });
    if (body.model) throw new HubError("policy", "Un plan derivat nu pornește modele.", { code: "PLAN_DERIVED_MODEL" });
    if (body.steps.some((st) => (st.apps || []).length)) throw new HubError("policy", "Un plan derivat nu operează aplicații de pe desktop.", { code: "PLAN_DERIVED_APP" });
    const outside = [...new Set(body.steps.flatMap((st) => st.ops.map((o) => o.op)).filter((op) => !reg.allowedOps.has(op)))];
    if (outside.length) throw new HubError("policy", "Operații în afara livrării: " + outside.join(", "), { code: "PLAN_DERIVED_OP" });
    const check = await reg.verify(parent);
    if (!check?.ok) throw new HubError("policy", "Confirmarea de la care derivă planul nu mai e valabilă: " + (check?.reason || "necunoscut"), { code: "PLAN_DERIVED_PARENT" });
    // Stage before M12: the derived plan (the delivery after DELIVERY_READY) rides on the confirmation's authority, which outlives a
    // closed browser; only a revocation refuses it.
    const held = trust.confirmedAuthority ? trust.confirmedAuthority(sessionId) : null;
    if (held && !held.ok) throw new HubError("authentication", `Autorizarea confirmării tale a fost revocată (${held.reason}); planul derivat nu pornește.`, { code: "SESSION_CLOSED" });
    const s = held ? { id: String(sessionId), credentialId: credential || "" } : trust.requireSession({ id: sessionId }, "planul derivat din confirmarea ta");
    const hash = bodySha;
    const id = newId("opp");
    const t = clock();
    const expiresAt = new Date(t.getTime() + (body.limits.maxDurationMin + PLAN_LIMITS.slackMin) * 60000).toISOString();
    if (new Date(expiresAt) <= clock()) throw new HubError("conflict", "Planul derivat ar fi deja expirat.", { code: "PLAN_DERIVED_EXPIRED" });
    const consent = { channel: "owner_session", modality: "derived", derivedFrom: { kind: parent.kind, id: parent.id, hash: parent.hash, confirmedAt: parent.confirmedAt, deliveryId: parent.deliveryId || null },
      sessionId: s.id, credential: String(credential || s.credentialId || "").slice(0, 10), planHash: hash, confirmedAt: now() };
    bus.transaction(() => {
      db.prepare(`INSERT INTO ops_plans (id, kind, title, status, body_json, summary_json, plan_hash, nonce, proposed_by, proposed_via, confirm_by, expires_at, created_at, updated_at, consent_json, owner_session_id)
        VALUES (?, ?, ?, 'CONFIRMED', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, kind, body.title, json(body), json(summaryOf(body)), hash, crypto.randomBytes(12).toString("hex"), "derived:" + parent.kind, "derived",
        now(), expiresAt, now(), now(), json(consent), s.id);
      for (const st of body.steps) db.prepare("INSERT INTO ops_plan_steps (id, plan_id, seq, kind, title, params_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(newId("ops"), id, st.seq, st.kind, st.title, json(st.params), now());
      db.prepare("UPDATE ops_plans SET authority_json = ? WHERE id = ?").run(json(authorityOf({ id, body, expiresAt }, s.id)), id);
      bus.append({ type: "ops.plan.derived", scopeType: "ops_plan", scopeId: id, source: "hub", payload: { kind, parentKind: parent.kind, parentId: parent.id, deliveryId: parent.deliveryId || null, steps: body.steps.length, hash: hash.slice(0, 16) } });
    });
    start(id);
    return view(id);
  }

  // ---------------------------------------------------------------- authority (checked at EVERY operation)
  function authorize(planId, stepId, action = {}) {
    const r = row(planId);
    if (!r) throw new HubError("not_found", "Plan necunoscut", { code: "PLAN_GONE" });
    const a = parse(r.authority_json, null);
    const stop = (why, code, status = null) => {
      if (status) bus.transaction(() => setStatus(planId, status, why, {}, ["RUNNING", "CONFIRMED"]));
      throw new HubError("policy", why, { code });
    };
    if (!a) stop("Planul nu are autoritate (neconfirmat).", "PLAN_NOT_CONFIRMED");
    if (r.status !== "RUNNING") stop(`Planul nu rulează (${r.status}); niciun pas nou.`, "PLAN_NOT_RUNNING");
    if (new Date(a.expiresAt) <= clock()) stop("Limita de timp a planului a trecut; pașii noi s-au oprit.", "PLAN_EXPIRED", "NEEDS_OWNER");
    // Stage before M12: the confirmation's authority outlives the page (idle, expiry, logout); a security revocation still stops it.
    const held = trust.confirmedAuthority ? trust.confirmedAuthority(a.sessionId) : (() => { try { trust.requireSession({ id: a.sessionId }, "planul confirmat"); return { ok: true }; } catch { return { ok: false }; } })();
    if (!held.ok) stop("Autorizarea în care ai confirmat planul a fost revocată; pașii noi s-au oprit.", "SESSION_CLOSED", "NEEDS_OWNER");
    const st = db.prepare("SELECT * FROM ops_plan_steps WHERE id = ? AND plan_id = ?").get(String(stepId || ""), planId);
    if (!st || st.status !== "RUNNING") stop("Pasul nu e în execuție.", "STEP_NOT_RUNNING");
    // Per step (M10.2): the running step's own operations, apps and folders; a plan confirmed before M10.2 has only the union.
    const own = a.steps ? a.steps[String(st.seq)] || { ops: [], apps: [], folders: [] } : null;
    if (action.op && !a.ops.includes(action.op)) stop(`Operația „${action.op}” nu e în planul confirmat.`, "OUT_OF_PLAN");
    if (action.op && own && !own.ops.includes(action.op)) stop(`Operația „${action.op}” nu face parte din pasul ${st.seq} al planului confirmat.`, "OUT_OF_PLAN");
    if (action.appId && !a.apps.includes(action.appId)) stop(`Aplicația „${action.appId}” nu e în planul confirmat.`, "OUT_OF_PLAN");
    if (action.appId && own && !own.apps.includes(action.appId)) stop(`Aplicația „${action.appId}” nu face parte din pasul ${st.seq} al planului confirmat.`, "OUT_OF_PLAN");
    const folders = [...folderContext().allowed, ...(own ? own.folders : a.folders || [])];
    for (const p of [action.path, action.destination].filter(Boolean)) if (!insideAny(folders, p)) stop("Fișierul e în afara folderelor planului.", "OUT_OF_PLAN");
    const n = (used.get(planId) ?? parse(r.progress_json, {}).actionsUsed ?? 0) + 1;
    if (n > a.maxActions) stop(`Planul și-a folosit toate cele ${a.maxActions} operații; pașii noi s-au oprit.`, "PLAN_BUDGET", "NEEDS_OWNER");
    used.set(planId, n);
    if (n % 10 === 0) db.prepare("UPDATE ops_plans SET progress_json = json_set(progress_json, '$.actionsUsed', ?) WHERE id = ?").run(n, planId);
    return { planId, stepId, expiresAt: a.expiresAt, actionsUsed: n };
  }

  // ---------------------------------------------------------------- run
  function start(planId) {
    if (runs.has(planId)) return runs.get(planId).promise;
    const abort = { aborted: false, reason: "" };
    const promise = (async () => {
      bus.transaction(() => setStatus(planId, "RUNNING", "Rulează", {}, ["CONFIRMED", "PAUSED", "NEEDS_OWNER"]));
      for (const st of stepsOf(planId)) {
        if (st.status === "DONE" || st.status === "SKIPPED") continue;
        if (abort.aborted) break;
        if (row(planId).status !== "RUNNING") break;
        const ex = executors[st.kind];
        bus.transaction(() => db.prepare("UPDATE ops_plan_steps SET status = 'RUNNING', attempts = attempts + 1, started_at = COALESCE(started_at, ?), error = NULL, updated_at = ? WHERE id = ?").run(now(), now(), st.id));
        live?.publish?.({ type: "ops.step", data: { planId, stepId: st.id, seq: st.seq, title: st.title, status: "RUNNING" } });
        try {
          const params = resolveRefs(st.params, stepsOf(planId));
          const result = await ex.run({ planId, stepId: st.id, params, authorize: (action) => authorize(planId, st.id, action), abort, plan: view(planId), secrets: secrets.get(planId) || {} });
          bus.transaction(() => {
            db.prepare("UPDATE ops_plan_steps SET status = 'DONE', result_json = ?, evidence_json = ?, finished_at = ?, updated_at = ? WHERE id = ?").run(json(result?.result ?? result ?? {}), json(result?.evidence || []), now(), now(), st.id);
            bus.append({ type: "ops.step.done", scopeType: "ops_plan", scopeId: planId, source: "ops", payload: { seq: st.seq, kind: st.kind } });
          });
        } catch (error) {
          const code = error.code || "FAILED";
          const uncertain = ["OPERATOR_TIMEOUT", "OPERATOR_EXITED", "OUTCOME_UNKNOWN"].includes(code);
          const owner = ["USER_INPUT", "SECURE_DESKTOP", "STOPPED", "PAUSED", "NOT_FOREGROUND", "IDENTITY_CHANGED", "DESKTOP_PAUSED", "PLAN_NOT_RUNNING", "SESSION_CLOSED", "PLAN_EXPIRED", "PLAN_BUDGET", "NEEDS_DECISION", "OCCLUDED"].includes(code);
          bus.transaction(() => {
            db.prepare("UPDATE ops_plan_steps SET status = ?, error = ?, updated_at = ? WHERE id = ?").run(uncertain ? "UNCERTAIN" : owner ? "BLOCKED" : "FAILED", `${code}: ${String(error.message).slice(0, 800)}`, now(), st.id);
            const cur = row(planId).status;
            if (cur === "RUNNING") setStatus(planId, uncertain || owner ? "NEEDS_OWNER" : "FAILED", `Pasul ${st.seq} (${st.title}): ${String(error.message).slice(0, 300)}`, {}, ["RUNNING"]);
          });
          live?.publish?.({ type: "ops.step", data: { planId, stepId: st.id, seq: st.seq, status: "STOPPED", code } });
          break;
        }
      }
      if (row(planId).status === "RUNNING") {
        const left = stepsOf(planId).filter((x) => !["DONE", "SKIPPED"].includes(x.status));
        if (!left.length) bus.transaction(() => setStatus(planId, "DONE", "Toți pașii au rezultat verificat", {}, ["RUNNING"]));
      }
      db.prepare("UPDATE ops_plans SET progress_json = json_set(progress_json, '$.actionsUsed', ?) WHERE id = ?").run(used.get(planId) || 0, planId);
      if (["DONE", "FAILED", "CANCELLED"].includes(row(planId).status)) secrets.delete(planId);
      // The plan's desktop session ends with its run (a PAUSED one — an intervention — stays for the owner to see and resume).
      try { const ds = desktop?.sessionStatus?.(); if (ds && ds.planId === planId && ds.status === "ACTIVE") desktop.endSession(`plan ${row(planId).status}`, "ops"); } catch { /* reported by status */ }
      live?.publish?.({ type: "ops.plan", data: { planId, status: row(planId).status } });
    })().finally(() => runs.delete(planId));
    runs.set(planId, { promise, abort });
    return promise;
  }

  /** Pause / Stop: no new operation (the running step stops at its next authorization or helper check). Fail-safe from any channel. */
  function pause(planId, { reason = "Pauză", actor = "owner" } = {}) {
    const r = row(planId);
    if (!r) throw new HubError("not_found", "Plan necunoscut");
    if (!["RUNNING", "CONFIRMED"].includes(r.status)) return view(planId);
    const run = runs.get(planId);
    if (run) { run.abort.aborted = true; run.abort.reason = reason; }
    bus.transaction(() => setStatus(planId, "PAUSED", `${reason} (${actor})`, {}, ["RUNNING", "CONFIRMED"]));
    return view(planId);
  }
  function cancel(planId, { reason = "Anulat", actor = "owner" } = {}) {
    const r = row(planId);
    if (!r) throw new HubError("not_found", "Plan necunoscut");
    const run = runs.get(planId);
    if (run) { run.abort.aborted = true; run.abort.reason = reason; }
    bus.transaction(() => {
      setStatus(planId, "CANCELLED", `${reason} (${actor})`, {}, ["PROPOSED", "CONFIRMED", "RUNNING", "PAUSED", "NEEDS_OWNER"]);
      db.prepare("UPDATE ops_plan_steps SET status = 'CANCELLED', updated_at = ? WHERE plan_id = ? AND status IN ('PENDING','RUNNING','BLOCKED')").run(now(), planId);
    });
    return view(planId);
  }
  // ---------------------------------------------------------------- 2.12.1 (D22): what a Stop All itself paused waits for the rearm
  let ownScope = null;
  const scope = () => (typeof stopScope === "function" ? stopScope() : stopScope) || (ownScope ||= createStopScope({ db, settings }));
  const REARM_FIRST = "după ce redeschizi poarta aici, în cockpit, pe cardul „Redeschide poarta”, cu Windows Hello, îl reiei cu „Continuă”";
  const rearmRequired = (reason, cls) => new HubError("gate", reason, { code: "GATE_REARM_REQUIRED", data: { code: "GATE_REARM_REQUIRED", rearm: true, kind: "ops", cls: cls || null } });
  /** The latest Stop All / shutdown / security stop recorded (index-backed: scope system/hub); 0 when there was none. */
  const lastStopSeq = () => Number(db.prepare("SELECT COALESCE(MAX(seq), 0) AS seq FROM events WHERE scope_type = 'system' AND scope_id = 'hub' AND type = 'system.stop_all'").get()?.seq || 0);
  /**
   * Every resume path (the plan card's „Continuă”, the typed or spoken „Continuă”, a clarification choice, the re-confirmation of a new
   * session) refuses a plan the CURRENT Stop All / shutdown / security suspension itself paused (or interrupted) until the owner rearms
   * the gate in the cockpit: { code GATE_REARM_REQUIRED, rearm: true } — the page shows the rearm card. A plan paused for any other
   * reason (the owner's own pause, „Preiau eu”, an intervention, its own NEEDS_OWNER) keeps its resume, also under a suspended gate;
   * new plans after a Stop All stay allowed (M10-OP-12). Evidence only (the stop's own record, owner/stop-scope.mjs); when it cannot be
   * read while a stop holds the gate, the resume is refused (fail-closed), never guessed.
   */
  function holdIfStopped(planId) {
    let h = null;
    try { h = scope().heldByStop({ kind: "ops", id: planId }); }
    catch {
      const cls = classifySuspension(settings.get("executionGate") || {}).cls;
      if (STOP_HOLD_CLASSES.has(cls)) throw rearmRequired(`Nu pot verifica dacă planul a fost oprit de oprirea porții; ${REARM_FIRST}.`, cls);
      return;
    }
    if (h?.held) throw rearmRequired(h.reason || `Planul a fost oprit de Stop All; ${REARM_FIRST}.`, h.cls);
  }
  /**
   * Taken before an await of a resume path: the latest recorded stop and the gate's last change. A Stop All writes the gate FIRST and
   * records its event LAST (after it paused what was running), so both are compared: whichever shows it first refuses the resume.
   */
  const stopMark = () => ({ seq: lastStopSeq(), gateAt: String(settings.get("executionGate")?.changedAt || "") });
  /** The gate was stopped (a Stop All, or any new suspension) since `mark`: nothing starts after it — a stop asks for the rearm first. */
  function noStopSince(mark, p) {
    const g = settings.get("executionGate") || {};
    const stopped = lastStopSeq() > mark.seq;
    const suspendedSince = g.status !== "open" && String(g.changedAt || "") !== mark.gateAt;
    if (!stopped && !suspendedSince) return;
    const cls = classifySuspension(g).cls;
    if (cls !== "open" && (stopped || STOP_HOLD_CLASSES.has(cls))) {
      throw rearmRequired(`Între timp ai oprit tot (Stop All), așa că nu reiau planul „${String(p?.title || p?.id || "").slice(0, 120)}”; ${REARM_FIRST}.`, cls);
    }
    throw new HubError("conflict", "Între timp s-a schimbat starea porții, așa că nu am reluat planul; spune din nou „Continuă” ca să verific starea lui.", { code: "STOPPED_DURING_RESUME" });
  }

  /**
   * „Continuă”: resumes the EXACT plan while its session, authority and limits still hold. An uncertain step is reconciled first by its
   * executor (did StartRecord / Save / Import actually happen?) — never repeated blindly. Nothing is widened: same expiry, same budget.
   * 2.12.1 (D22): a plan the current Stop All itself paused waits for the rearm (holdIfStopped), and a Stop All that lands while the
   * uncertain steps are being reconciled stops this resume too (nothing starts after it).
   */
  async function resume(planId, { session, actor = "owner" } = {}) {
    const p = view(planId);
    if (!p) throw new HubError("not_found", "Plan necunoscut");
    if (!["PAUSED", "NEEDS_OWNER"].includes(p.status)) throw new HubError("conflict", `Planul nu e oprit (${p.status}).`);
    const s = trust.requireSession(session, "reluarea planului");
    if (new Date(p.expiresAt) <= clock()) throw new HubError("conflict", "Limita de timp a planului a trecut; cere planul din nou (confirmi doar diferența).", { code: "PLAN_EXPIRED" });
    // Before the session-delta card: a re-confirmation would only move the authority of a plan that still could not resume.
    holdIfStopped(planId);
    const mark = stopMark();
    if (p.authority?.sessionId !== s.id) {
      // M10.2 (U11): the session the plan was confirmed in closed (idle, logout). The SAME credential confirms only the difference —
      // the new session — with the same expiry, budget and steps; another credential asks for the plan again.
      if (!sameCredential(p, s)) throw new HubError("policy", "Planul a fost confirmat cu altă cheie; cere planul din nou.", { code: "SESSION_CHANGED" });
      throw new HubError("policy", "Sesiunea în care ai confirmat planul s-a închis; confirmă doar diferența (sesiunea nouă), cu aceleași limite.", { code: "RECONFIRM_DELTA", data: { reconfirm: reconfirmCard(p, s) } });
    }
    for (const st of p.steps.filter((x) => x.status === "UNCERTAIN" || x.status === "BLOCKED")) {
      const ex = executors[st.kind];
      const rec = ex?.reconcile ? await ex.reconcile({ planId, stepId: st.id, params: st.params, plan: p }).catch((error) => ({ outcome: "unknown", detail: error.message })) : { outcome: "retry" };
      bus.transaction(() => {
        if (rec.outcome === "done") db.prepare("UPDATE ops_plan_steps SET status = 'DONE', result_json = ?, evidence_json = ?, finished_at = ?, updated_at = ? WHERE id = ?").run(json(rec.result || {}), json([{ reconciled: true, detail: rec.detail || "" }]), now(), now(), st.id);
        else if (rec.outcome === "retry") db.prepare("UPDATE ops_plan_steps SET status = 'PENDING', updated_at = ? WHERE id = ?").run(now(), st.id);
        else throw new HubError("conflict", `Nu pot stabili ce s-a întâmplat la pasul ${st.seq} (${rec.detail || "rezultat incert"}); verifică în aplicație și spune-mi.`, { code: "OUTCOME_UNKNOWN" });
      });
    }
    // A Stop All while the steps were being reconciled (the plan was not running, so that stop did not pause it): it still stops this
    // resume — what was reconciled stays recorded, nothing starts. Synchronous from here to start(): nothing else can land in between.
    noStopSince(mark, p);
    bus.transaction(() => bus.append({ type: "ops.plan.resumed", scopeType: "ops_plan", scopeId: planId, source: actor, payload: { session: s.id } }));
    start(planId);
    return view(planId);
  }
  // ---------------------------------------------------------------- M10.2 (U11): delta re-confirmation in a new owner session
  // Memory only (a restart drops it: fail-safe, the owner asks again): planId → { nonce, sessionId, hash, until }.
  const reconfirms = new Map();
  const RECONFIRM_WINDOW_MS = PLAN_LIMITS.confirmWindowMin * 60000;
  /** Same credential (the consent keeps the credential's first 10 characters, as every M06+ consent does). */
  const sameCredential = (p, s) => Boolean(p.consent?.credential) && p.consent.credential === String(s.credentialId || "").slice(0, 10);
  /** The difference shown for a re-confirmation: only the session changes; expiry, budget and steps stay exactly as confirmed. */
  function reconfirmCard(p, s) {
    const nonce = crypto.randomBytes(12).toString("hex");
    const until = new Date(clock().getTime() + RECONFIRM_WINDOW_MS).toISOString();
    reconfirms.set(p.id, { nonce, sessionId: s.id, hash: p.hash, until });
    return { planId: p.id, nonce, hash: p.hash, confirmBy: until, changed: ["sesiunea de proprietar (aceeași cheie, sesiune nouă)"],
      unchanged: { expiresAt: p.expiresAt, maxActions: p.authority?.maxActions ?? p.body.limits.maxActions, actionsUsed: used.get(p.id) ?? p.progress?.actionsUsed ?? 0, steps: p.steps.map((st) => st.title) },
      text: `Continui „${p.title}” în sesiunea nouă: aceleași limite (expiră ${p.expiresAt}), același buget de operații; nimic nu se lărgește.` };
  }
  /**
   * The owner confirms the difference (the new session) of a stopped plan: the authority moves to this session — same expiry, same
   * action budget, same per-step lists — and the plan resumes through the ordinary resume (uncertain steps reconciled first). Only the
   * same credential, only for the card the Hub itself showed in THIS session (nonce, hash, 15 minutes), never widened.
   */
  async function reconfirm({ planId, nonce, displayedHash, session, modality = "click", actor = "owner" }) {
    const s = trust.requireSession(session, "reconfirmarea planului");
    const p = view(planId);
    if (!p) throw new HubError("not_found", "Plan necunoscut");
    if (!["PAUSED", "NEEDS_OWNER"].includes(p.status)) throw new HubError("conflict", `Planul nu e oprit (${p.status}).`);
    if (!["click", "keyboard", "typed"].includes(modality)) throw new HubError("validation", "Modalitate necunoscută pentru o reconfirmare");
    if (!sameCredential(p, s)) throw new HubError("policy", "Planul a fost confirmat cu altă cheie; cere planul din nou.", { code: "SESSION_CHANGED" });
    const pending = reconfirms.get(planId);
    if (!pending || pending.nonce !== nonce || pending.sessionId !== s.id || new Date(pending.until) <= clock() || displayedHash !== p.hash || pending.hash !== p.hash) {
      throw new HubError("conflict", "Reconfirmarea nu corespunde diferenței afișate în această sesiune; cere din nou „Continuă”.");
    }
    if (new Date(p.expiresAt) <= clock()) throw new HubError("conflict", "Limita de timp a planului a trecut; cere planul din nou.", { code: "PLAN_EXPIRED" });
    // 2.12.1 (D22): a plan the current Stop All itself paused waits for the rearm — checked BEFORE the authority moves to this session.
    // The card stays valid (its nonce is used only by a successful re-confirmation), so after the rearm the same card confirms it.
    holdIfStopped(planId);
    const mark = stopMark();
    if (p.body.decisions.length) trust.requireFresh(s, "planul care autorizează o aplicație sau un folder nou");
    // Nothing else may have changed since the plan was confirmed (apps, binaries, folders, policy): otherwise it is a new plan.
    const rebuilt = await buildBody({ kind: p.kind, title: p.body.title, steps: p.steps.map((st) => ({ kind: st.kind, title: st.title, params: st.params })), limits: p.body.limits }).catch((error) => ({ error }));
    if (rebuilt.error || hashCanonical(rebuilt) !== p.hash) {
      const diff = rebuilt.error ? [rebuilt.error.message] : changed(p.body, rebuilt);
      throw new HubError("conflict", `Planul s-a schimbat de la confirmare (${diff.join(", ")}); cere-l din nou.`, { data: { changed: diff } });
    }
    // A Stop All while the plan was being rebuilt: the authority does not move and nothing resumes.
    noStopSince(mark, p);
    const authority = { ...(p.authority || authorityOf(p, s.id)), sessionId: s.id };
    bus.transaction(() => {
      const n = db.prepare("UPDATE ops_plans SET authority_json = ?, consent_json = ?, owner_session_id = ?, updated_at = ?, version = version + 1 WHERE id = ? AND status IN ('PAUSED','NEEDS_OWNER')")
        .run(json(authority), json({ ...p.consent, reconfirmations: [...(p.consent?.reconfirmations || []), { sessionId: s.id, modality, at: now() }].slice(-10) }), s.id, now(), planId).changes;
      if (n !== 1) throw new HubError("conflict", "Planul și-a schimbat starea între timp.");
      bus.append({ type: "ops.plan.reconfirmed", scopeType: "ops_plan", scopeId: planId, source: "owner", payload: { session: s.id, previousSession: p.authority?.sessionId || null, modality, expiresAt: p.expiresAt } });
    });
    reconfirms.delete(planId);
    return resume(planId, { session: s, actor });
  }

  const list = ({ limit = 20, status = null } = {}) => db.prepare(`SELECT id FROM ops_plans ${status ? "WHERE status = ?" : ""} ORDER BY created_at DESC LIMIT ?`).all(...(status ? [status] : []), Math.min(100, limit)).map((r) => view(r.id));
  const active = () => db.prepare("SELECT id FROM ops_plans WHERE status IN ('CONFIRMED','RUNNING','PAUSED','NEEDS_OWNER') ORDER BY updated_at DESC").all().map((r) => view(r.id));
  /** Boot: a plan that was running when the Hub stopped is NOT resumed: it waits for the owner (its running step is uncertain). */
  function recover() {
    const left = db.prepare("SELECT id FROM ops_plans WHERE status IN ('CONFIRMED','RUNNING')").all();
    bus.transaction(() => {
      for (const r of left) {
        db.prepare("UPDATE ops_plan_steps SET status = 'UNCERTAIN', error = COALESCE(error, 'Hub repornit în timpul pasului'), updated_at = ? WHERE plan_id = ? AND status = 'RUNNING'").run(now(), r.id);
        setStatus(r.id, "NEEDS_OWNER", "Hub-ul a repornit în timpul planului: nu reiau singur; spune „Continuă” după ce verific starea.", {}, ["CONFIRMED", "RUNNING"]);
      }
      for (const r of db.prepare("SELECT id FROM ops_plans WHERE status = 'PROPOSED' AND confirm_by <= ?").all(now())) setStatus(r.id, "EXPIRED", "Neconfirmat la timp", {}, ["PROPOSED"]);
    });
    return { waitingOwner: left.map((r) => r.id) };
  }
  async function idle(planId) { await runs.get(planId)?.promise; return view(planId); }

  // ---------------------------------------------------------------- D7 (2.12.3): a Studio correction and the plan it is bound to
  /** The plan states in which a correction plan still decides what happens to its review (expired PROPOSED rows are flagged, see below). */
  const LIVE_PLAN = ["PROPOSED", "CONFIRMED", "RUNNING", "PAUSED", "NEEDS_OWNER"];
  /**
   * The live studio.edit plans (a media.edit.correct step) on a review or on an edit version → [{ id, status, reviewId, editVersionId,
   * expired }], newest first. `expired`: PROPOSED past its confirmation window (EXPIRED lazily, at confirm or boot) — no longer live. Read
   * only (a GET must never write); never the nonce or the hash.
   */
  function correctionPlans({ reviewId = null, editVersionId = null } = {}) {
    if (!reviewId && !editVersionId) return [];
    const t = clock();
    return db.prepare(`SELECT p.id, p.status, p.confirm_by, json_extract(s.params_json, '$.reviewId') AS review_id, json_extract(s.params_json, '$.editVersionId') AS edit_version_id
      FROM ops_plans p JOIN ops_plan_steps s ON s.plan_id = p.id WHERE s.kind = 'media.edit.correct' AND p.status IN (${LIVE_PLAN.map(() => "?").join(",")})
      AND (json_extract(s.params_json, '$.reviewId') = ? OR json_extract(s.params_json, '$.editVersionId') = ?) ORDER BY p.created_at DESC`)
      .all(...LIVE_PLAN, reviewId ? String(reviewId) : null, editVersionId ? String(editVersionId) : null)
      .map((r) => ({ id: r.id, status: r.status, reviewId: r.review_id || null, editVersionId: r.edit_version_id || null, expired: r.status === "PROPOSED" && new Date(r.confirm_by) <= t }));
  }
  /**
   * Closes the PROPOSED correction plans (expired ones included) that a direct apply or a dismissal in the Studio made obsolete → their ids.
   * Inside the caller's transaction (bus.transaction joins it); each emits ops.plan.superseded. An armed voice window for such a plan is
   * inert by itself (its check requires PROPOSED and the same hash).
   */
  function supersedeCorrections({ reviewId = null, editVersionId = null, reason }) {
    const ids = [...new Set(correctionPlans({ reviewId, editVersionId }).filter((p) => p.status === "PROPOSED").map((p) => p.id))];
    if (!ids.length) return [];
    return bus.transaction(() => ids.filter((id) => setStatus(id, "SUPERSEDED", reason || "Corectura a fost rezolvată în Studio", {}, ["PROPOSED"]) === 1));
  }

  return { propose, confirm, authorize, pause, cancel, resume, reconfirm, view, list, active, recover, idle, buildBody, armForLega, confirmFromArmed, armedFor, registerParent, adoptDerived,
    disarm: (planId, reason) => armedWindows.disarm(planId, reason), correctionPlans, supersedeCorrections };
}
