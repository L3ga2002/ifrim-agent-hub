import { HubError } from "../core/errors.mjs";
import { HUB_VERSION, API_CONTRACT } from "../config.mjs";
import { MIGRATIONS } from "../storage/migrations.mjs";
import { environmentOverview } from "../environments/overview.mjs";
import { checkDelegation } from "../runtime/commands.mjs";

/**
 * The resumable setup (M07 §07, §21). One ordered list of the REAL steps between "the code is on disk" and "a test mission
 * can be confirmed by voice", each derived from the Hub's own state at the moment of the request — never from a timer or
 * a flag the page keeps. A refresh shows the same list; a finished step is not repeated; a failed one names its cause and
 * the exact retry.
 *
 * Statuses: DONE_AUTO (done by the Hub or a delegated agent), DONE_OWNER (done by you), IN_PROGRESS, AUTO_PENDING (the
 * "Rulează pașii automați" button will do it), NEEDS_OWNER (your presence: Windows Hello, login, microphone, voice), BLOCKED
 * (waits for an earlier step), RECOVERABLE_ERROR (failed; retry shown), OPTIONAL.
 *
 * The automatic steps (backup, inspection, account check C16, attestation) run on the Hub, in order, from one request; the
 * personal ones are links to the exact place (#/lega/setup panels, the reviewer login).
 *
 * M10.2.1 (D21): the automatic attestation only RE-attests the fingerprint the latest PASS attestation covers, checked on a fresh
 * inspection right before it (and passed on as expectFingerprint). A first or a changed fingerprint is never attested from this button:
 * it is a separate owner decision in System → Medii (NEEDS_OWNER, with both fingerprints named). The account step refreshes the
 * reviewer's account check too (environment.probe runs both) when only that one is stale. 2.12.1 round 2: a reviewer check that fails or
 * throws is shown with its cause (done with the failure named, or an error with a retry), never left pending and re-probed on each click.
 */
export const SETUP_STATUSES = Object.freeze(["DONE_AUTO", "DONE_OWNER", "IN_PROGRESS", "AUTO_PENDING", "NEEDS_OWNER", "BLOCKED", "RECOVERABLE_ERROR", "OPTIONAL"]);
const AUTO_STEPS = ["backup", "env_inspected", "env_account", "env_attested"];
const BACKUP_MAX_AGE_H = 24;
const PROBE_MAX_AGE_H = 24;
const ENV_ID = "wsl-runner";
const ENVIRONMENTS_LINK = "#/system?tab=environments";

export function createSetup(hub) {
  const { db, settings, projects, trust, voice, envelopes, backups, commands, bus, config } = hub;
  let run = null; // { startedAt, finishedAt, current, results: { stepId: { status, detail, at } }, channel }

  const iso = () => config.now().toISOString();
  const ageH = (when) => (when ? (config.now().getTime() - new Date(when).getTime()) / 3600000 : Infinity);
  const envService = () => { try { return hub.environments?.get(ENV_ID) || null; } catch { return null; } };
  const short = (fp) => String(fp || "—").slice(0, 16);

  /** The fingerprint of the latest PASS attestation (PASS_LOCAL; PASS_SIMULATED only in test mode, as attestationStatus), or null. */
  function latestPassFingerprint() {
    const statuses = config.testMode ? ["PASS_LOCAL", "PASS_SIMULATED"] : ["PASS_LOCAL"];
    try {
      return db.prepare(`SELECT fingerprint_hash AS fp FROM environment_attestations WHERE environment_id = ? AND status IN (${statuses.map(() => "?").join(",")}) AND fingerprint_hash <> ''
        ORDER BY started_at DESC LIMIT 1`).get(ENV_ID, ...statuses)?.fp || null;
    } catch { return null; }
  }
  /**
   * Whether the automatic step may (re-)attest the environment as inspected now: only the fingerprint the latest PASS covers. Otherwise
   * the honest reason, naming both fingerprints; the attestation of a new configuration is the owner's decision (System → Medii).
   */
  function reattestDecision(fingerprint) {
    if (!fingerprint) return { ok: false, text: "Mediul nu e inspectat: nu știu ce amprentă aș atesta. Inspecția rulează întâi." };
    const passed = latestPassFingerprint();
    if (!passed) return { ok: false, owner: true, text: `Mediul nu are încă o atestare trecută (amprenta ${short(fingerprint)}): prima atestare e o decizie separată (Sistem → Medii).` };
    if (passed !== fingerprint) return { ok: false, owner: true, text: `Amprenta mediului s-a schimbat (${short(passed)} → ${short(fingerprint)}): atestarea unei configurații noi e o decizie separată (Sistem → Medii).` };
    return { ok: true, fingerprint };
  }
  /** The reviewer's account check through the environment is due: Claude Code installed there and no check for this fingerprint ≤ 24 h. */
  function reviewerProbeState(state) {
    const svc = envService();
    if (!svc?.reviewerKey || !state?.facts?.claude_cli) return { installed: false, stale: false, probe: null };
    let probe = null;
    try { probe = hub.providerState.get(svc.reviewerKey); } catch { probe = null; }
    const stale = !probe || !(ageH(probe.probedAt) < PROBE_MAX_AGE_H) || probe.fingerprintHash !== state?.fingerprint?.hash;
    return { installed: true, stale, probe };
  }

  function steps({ origin = "", uiContract = null, session = null } = {}) {
    const out = [];
    const add = (step) => { out.push(step); return step; };
    const done = (id) => out.find((s) => s.id === id && (s.status === "DONE_AUTO" || s.status === "DONE_OWNER"));
    const running = (id) => run && !run.finishedAt && run.current === id;
    const lastRun = (id) => run?.results?.[id] || null;
    // After a failed automatic step the later ones were not run: they say so (and stay retryable), never "pending" silently.
    const failedAt = run?.finishedAt ? Object.entries(run.results).find(([, v]) => v.status === "error")?.[0] || null : null;
    const notRun = (id) => (failedAt && failedAt !== id && !run.results[id] ? `nerulat: oprit după eroarea la „${failedAt}”; reia pașii automați după remediere` : null);
    const canonical = `http://localhost:${config.port}`;

    // 1. The page and the server speak the same contract.
    const ui = uiContract === null || uiContract === undefined || uiContract === "" ? null : Number(uiContract);
    add({ id: "version_match", title: "Interfața și serverul au aceeași versiune", status: ui === null || ui === API_CONTRACT ? "DONE_AUTO" : "RECOVERABLE_ERROR",
      detail: ui === null || ui === API_CONTRACT ? `Server ${HUB_VERSION}, contract ${API_CONTRACT}` : ui < API_CONTRACT ? `Pagina e mai veche (contract ${ui}); reîncarcă pagina` : `Serverul e mai vechi (contract ${API_CONTRACT}); repornește Hub-ul (v2\\scripts\\restart.ps1)`,
      action: ui !== null && ui !== API_CONTRACT ? { kind: ui < API_CONTRACT ? "reload" : "owner_terminal", command: "v2\\scripts\\restart.ps1" } : null });
    // 2. The canonical origin (the owner session and Windows Hello exist only there).
    const onCanonical = String(origin).toLowerCase() === canonical;
    add({ id: "canonical_origin", title: "Adresa corectă: http://localhost:8011", status: onCanonical ? "DONE_AUTO" : "NEEDS_OWNER",
      detail: onCanonical ? canonical : `Pagina e deschisă pe ${origin || "altă adresă"}; sesiunea de proprietar merge doar pe ${canonical}`, action: onCanonical ? null : { kind: "ui_link", href: `${canonical}/#/lega/setup` } });
    // 3. The database schema (migrations run at start-up; a running server is migrated or did not start).
    const schema = db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get().v;
    const latest = MIGRATIONS.at(-1).version;
    add({ id: "migration", title: "Baza de date migrată", status: schema === latest ? "DONE_AUTO" : "RECOVERABLE_ERROR", detail: `schema ${schema} / ${latest}` });
    // 4. A verified backup of the Hub, recent.
    const hubProject = projects.hub();
    const lastBackup = hubProject ? backups.list(hubProject.id, 5).find((b) => b.status === "verified") : null;
    // A 'running' row left by a crash must not keep the step "in progress" forever: only a recent one counts.
    const backupRunning = db.prepare("SELECT COUNT(*) AS n FROM backups WHERE status = 'running' AND created_at >= ?").get(new Date(config.now().getTime() - 30 * 60000).toISOString()).n > 0;
    add({ id: "backup", title: "Backup verificat al Hub-ului", auto: true,
      status: backupRunning || running("backup") ? "IN_PROGRESS" : lastBackup && ageH(lastBackup.createdAt) <= BACKUP_MAX_AGE_H ? "DONE_AUTO" : lastRun("backup")?.status === "error" ? "RECOVERABLE_ERROR" : "AUTO_PENDING",
      detail: lastBackup ? `ultimul: ${lastBackup.id} (${lastBackup.createdAt})` : lastRun("backup")?.detail || "niciun backup verificat în ultimele 24 h" });

    // 5–7. The isolated environment: inspected, account checked (C16), attested (canary) — with the optional coverages.
    let env = null;
    try { env = environmentOverview(hub).environments?.find((e) => e.id === "wsl-runner") || null; } catch { env = null; }
    const state = env?.inspection || null;
    // The raw facts (component versions) come from the service itself; the public overview shows only a safe subset.
    let rawFacts = {};
    try { rawFacts = hub.environments.get("wsl-runner")?.state()?.facts || {}; } catch { rawFacts = {}; }
    const inspected = Boolean(state?.installed && state?.ok);
    add({ id: "env_inspected", title: "Mediul izolat ifrim-runner inspectat", auto: true,
      status: running("env_inspected") ? "IN_PROGRESS" : inspected && ageH(state?.inspectedAt) < 24 ? "DONE_AUTO" : lastRun("env_inspected")?.status === "error" ? "RECOVERABLE_ERROR" : "AUTO_PENDING",
      detail: inspected ? `amprenta ${state?.fingerprint?.hash || "—"} · inspectat ${state?.inspectedAt || "—"}` : lastRun("env_inspected")?.detail || notRun("env_inspected") || state?.error || "neinspectat" });
    const account = env?.account || null;
    const accountOk = Boolean(account?.ok) && !account?.error && ageH(account?.probedAt) < 24;
    // M10.2.1: the same environment.probe also checks the reviewer's account (claude@wsl-runner) when Claude Code is installed there; a
    // reviewer check that alone is stale keeps the step pending, so the automatic steps refresh it. A failed but fresh one is shown,
    // not retried in a loop (the reviewer is optional coverage; without it the review stays on Windows).
    const rawState = (() => { try { return envService()?.state() || null; } catch { return null; } })();
    const reviewerAccount = reviewerProbeState({ facts: { ...(state?.facts || {}), ...rawFacts }, fingerprint: rawState?.fingerprint || state?.fingerprint || null });
    // 2.12.1 round 2 (PF-06): a reviewer check that failed in the last automatic run without leaving a fresh state names its cause.
    const runReviewerError = lastRun("env_account")?.reviewerError && ageH(lastRun("env_account").at) < PROBE_MAX_AGE_H ? lastRun("env_account").reviewerError : null;
    const reviewerLine = !reviewerAccount.installed ? "" : reviewerAccount.stale ? (runReviewerError ? ` · ${runReviewerError}` : " · reviewer Claude: verificarea contului e mai veche de 24 h sau pe altă amprentă")
      : reviewerAccount.probe?.ok ? ` · reviewer Claude: ${reviewerAccount.probe.auth?.subscriptionType || "abonament"} · ${reviewerAccount.probe.probedAt}`
        : ` · reviewer Claude: verificarea a eșuat (${String(reviewerAccount.probe?.error || "—").slice(0, 120)})`;
    const accountDone = accountOk && !reviewerAccount.stale;
    add({ id: "env_account", title: "Conturile din mediu: Codex (C16) și reviewer-ul Claude (fără model)", auto: true,
      status: running("env_account") ? "IN_PROGRESS" : accountDone ? "DONE_AUTO" : lastRun("env_account")?.status === "error" ? "RECOVERABLE_ERROR" : "AUTO_PENDING",
      detail: accountOk ? `${account.accountType || "cont"} · ${account.planType || "—"} · ${account.probedAt}${reviewerLine}` : lastRun("env_account")?.detail || notRun("env_account") || account?.error || "neverificat pe amprenta curentă" });
    const att = env?.attestation || null;
    const byId = att?.latest?.byId || att?.latest?.checks?.byId || {};
    const cover = (id) => byId[id] === "PASS" ? "trecut" : byId[id] === "FAIL" ? "EȘUAT" : "nerulat";
    // M10.2.1 (D21): an invalid attestation on a fingerprint no PASS covers is the owner's decision, said before the click; the run decides
    // again on a fresh inspection (the environment may change in between).
    const ownerAttest = !att?.valid && inspected ? reattestDecision(rawState?.fingerprint?.hash || state?.fingerprint?.hash || null) : null;
    // The current inspection decides; the last run's answer only while there is none (a fingerprint back to the PASS one is pending again).
    const attestOwner = ownerAttest ? Boolean(ownerAttest.owner) : lastRun("env_attested")?.status === "owner";
    const attestRun = lastRun("env_attested")?.status === "owner" && !attestOwner ? null : lastRun("env_attested");
    const attestStatus = running("env_attested") ? "IN_PROGRESS" : att?.valid ? "DONE_AUTO" : attestOwner ? "NEEDS_OWNER" : attestRun?.status === "error" ? "RECOVERABLE_ERROR" : "AUTO_PENDING";
    add({ id: "env_attested", title: "Atestarea mediului (canary C1–C20)", auto: true, status: attestStatus,
      detail: att?.valid ? `${att.latest?.status} · preview C18 ${cover("C18")} · E2E C19 ${cover("C19")} · review C20 ${cover("C20")}`
        : (attestOwner ? ownerAttest?.text : null) || attestRun?.detail || notRun("env_attested") || att?.reason || "neatestat",
      action: attestStatus === "NEEDS_OWNER" ? { kind: "ui_link", href: ENVIRONMENTS_LINK } : null });

    // 8. Installed components (A2/A3 in the environment, B1/B2 on this computer).
    const facts = { ...(state?.facts || {}), ...rawFacts };
    const reviewer = facts.claude_cli || facts.claude || null;
    add({ id: "deps_pipeline", title: "Chromium și Claude Code în mediu (A1–A3)", status: facts.pw_chromium && reviewer ? "DONE_AUTO" : inspected ? "RECOVERABLE_ERROR" : "BLOCKED",
      detail: inspected ? `Chromium: ${facts.pw_chromium || "lipsește"} · Claude: ${reviewer || "lipsește"}` : "după inspecția mediului", blockedBy: inspected ? [] : ["env_inspected"] });
    const vs = voice.status(session);
    add({ id: "deps_voice", title: "Transcriere locală și verificator vocal (B1, B2)", status: vs.localTranscription.available ? "DONE_AUTO" : "RECOVERABLE_ERROR",
      detail: vs.localTranscription.available ? `${vs.engine.components.stt} · ${vs.engine.components.sv}${vs.engine.gpu === true ? " · GPU" : ""}` : vs.localTranscription.reason });

    // 9–13. The owner: authenticator, policy, voice profile, autonomy of the test projects.
    const owner = trust.status(session);
    const credential = !owner.bootstrapNeeded;
    add({ id: "owner_credential", title: "Windows Hello / cheia ta înregistrată", status: credential ? "DONE_OWNER" : onCanonical ? "NEEDS_OWNER" : "BLOCKED",
      detail: credential ? `${owner.credentials.length} autentificator(i) activ(i)` : "o singură ceremonie Windows Hello", blockedBy: onCanonical ? [] : ["canonical_origin"],
      action: credential ? null : { kind: "ui_panel", panel: "identity" } });
    add({ id: "owner_session", title: "Sesiunea ta deschisă", status: owner.session ? "DONE_OWNER" : credential ? "NEEDS_OWNER" : "BLOCKED",
      detail: owner.session ? `expiră ${owner.session.expiresAt}` : "Windows Hello deschide sesiunea (8 h, 30 min inactivitate)", action: owner.session ? null : { kind: "ui_panel", panel: "identity" } });
    const policy = trust.policy();
    add({ id: "policy_active", title: "Politica voice-first activă", status: policy.active ? "DONE_OWNER" : owner.session ? "NEEDS_OWNER" : "BLOCKED",
      detail: policy.active ? `versiunea ${policy.version}` : "textul politicii + Windows Hello (5 minute)", action: policy.active ? null : { kind: "ui_panel", panel: "policy" } });
    add({ id: "voice_profile", title: "Profilul tău vocal (mostrele tale)", status: vs.profile ? "DONE_OWNER" : !vs.localTranscription.available ? "BLOCKED" : owner.session ? "NEEDS_OWNER" : "BLOCKED",
      detail: vs.profile ? `versiunea ${vs.profile.version} · ${vs.profile.samples} mostre · prag ${vs.profile.calibration?.matchAt ?? "—"}` : "5 fraze citite de tine, apoi o probă de recunoaștere", action: vs.profile ? null : { kind: "ui_panel", panel: "voice" } });
    // M10.2 U13 (owner decision 8: one global switch): under voice-first, a spoken "Da, execută planul" confirms only through the local
    // filter, so with a profile the step is the owner's to do (one click in the owner session), not optional. Without local transcription
    // the filter cannot be turned on (voice.setGate refuses), so the step waits for the engine instead of asking for a click that fails.
    const gateStatus = vs.gate.enabled ? "DONE_OWNER" : !vs.profile ? "BLOCKED" : !policy.active ? "OPTIONAL" : !vs.localTranscription.available ? "BLOCKED" : owner.session ? "NEEDS_OWNER" : "BLOCKED";
    add({ id: "voice_gate", title: "Filtrul vocal înainte de Lega", status: gateStatus,
      detail: vs.gate.enabled ? "strict: doar vocea ta ajunge la Lega" : !vs.profile ? "pornește-l după profil"
        : policy.active ? (vs.localTranscription.available ? "un click în sesiunea ta: fără el, „Da, execută planul” spus către Lega nu confirmă nimic (butonul rămâne)" : "așteaptă transcrierea locală (motorul vocal)") : "pornește-l după profil",
      blockedBy: gateStatus === "BLOCKED" && vs.profile && !vs.localTranscription.available ? ["deps_voice"] : gateStatus === "BLOCKED" && vs.profile && !owner.session ? ["owner_session"] : [],
      action: gateStatus === "NEEDS_OWNER" ? { kind: "ui_panel", panel: "voice" } : null });
    const testProjects = projects.list().filter((p) => p.source === "hub-test" && p.executionAllowed !== false);
    const trusted = testProjects.filter((p) => envelopes.autonomyOf(p.id)?.level === "TRUSTED");
    add({ id: "test_project_trusted", title: "Proiect de test cu autonomie TRUSTED", status: trusted.length ? "DONE_OWNER" : policy.active ? "NEEDS_OWNER" : "BLOCKED",
      detail: trusted.length ? trusted.map((p) => p.name).join(", ") : `${testProjects.length} proiecte de test; ridicarea cere sesiunea reautentificată`, action: trusted.length ? null : { kind: "ui_panel", panel: "autonomy" } });

    // 14–15. The isolation policy (b) for real projects and the first voice-confirmed mission.
    const pol = env?.policy || null;
    add({ id: "isolation_policy", title: "Politica de izolare (b) pentru proiecte reale", status: pol?.valid ? "DONE_AUTO" : "OPTIONAL",
      detail: pol?.valid ? `aprobată pentru amprenta ${pol.approval?.fingerprintHash || "—"} (${pol.approval?.approvedBy || "—"})` : "doar pentru proiecte reale; proiectele de test nu au nevoie de ea" });
    const voiced = db.prepare("SELECT COUNT(*) AS n FROM mission_envelopes WHERE status IN ('ACTIVE','WAITING_OWNER','COMPLETED','CLOSED') AND consent_json LIKE '%\"modality\":\"voice\"%'").get().n;
    add({ id: "voice_mission", title: "O misiune de test confirmată prin voce", status: voiced ? "DONE_OWNER" : trusted.length && vs.profile ? "NEEDS_OWNER" : "BLOCKED",
      detail: voiced ? `${voiced} misiun${voiced === 1 ? "e" : "i"}` : "„Arată-mi planul” → „Da, execută planul”", action: voiced ? null : { kind: "ui_link", href: trusted[0] ? `#/lega/${trusted[0].id}` : "#/lega" } });

    for (const s of out) if (!s.blockedBy) s.blockedBy = [];
    const next = out.find((s) => ["NEEDS_OWNER", "RECOVERABLE_ERROR", "AUTO_PENDING", "IN_PROGRESS"].includes(s.status)) || null;
    const counted = out.filter((s) => s.status !== "OPTIONAL");
    return { hubVersion: HUB_VERSION, apiContract: API_CONTRACT, generatedAt: iso(), next: next?.id || null, steps: out,
      progress: { done: counted.filter((s) => s.status.startsWith("DONE")).length, total: counted.length },
      automatic: run ? { startedAt: run.startedAt, finishedAt: run.finishedAt, current: run.current, channel: run.channel } : null,
      pendingAutomatic: out.filter((s) => s.auto && (s.status === "AUTO_PENDING" || s.status === "RECOVERABLE_ERROR")).map((s) => s.id), done };
  }

  /**
   * Runs the automatic steps that are not done, in order, on the Hub (backup → inspection → C16 → attestation). Each is the
   * ordinary command (same checks, same audit) dispatched on the caller's channel: the owner's page ("ui"), or an agent with a
   * recorded delegation ("agent"). Returns at once; progress is read from GET /api/setup.
   */
  function runAutomatic({ channel = "ui", actor = "user", delegation = null, ownerSession = null } = {}) {
    if (run && !run.finishedAt) throw new HubError("conflict", "Pașii automați rulează deja");
    if (channel === "agent") delegation = checkDelegation(delegation);
    const plan = steps({}).steps.filter((s) => AUTO_STEPS.includes(s.id) && s.status !== "DONE_AUTO").map((s) => s.id);
    run = { startedAt: iso(), finishedAt: null, current: null, results: {}, channel };
    const self = run;
    const hubProject = projects.hub();
    const exec = { backup: { type: "backup.run", payload: { projectId: hubProject?.id } }, env_inspected: { type: "environment.inspect", payload: {} },
      env_account: { type: "environment.probe", payload: {} }, env_attested: { type: "environment.attest", payload: { allowRestart: true } } };
    bus.emit({ type: "setup.automatic_started", scopeType: "system", scopeId: "setup", source: actor, payload: { steps: plan, channel } });
    (async () => {
      for (const id of plan) {
        run.current = id;
        try {
          let payload = exec[id].payload;
          if (id === "env_attested") {
            // M10.2.1 (D21): decided on a FRESH inspection (this run's own, or one more inspection now, inference-free); only the
            // fingerprint of the latest PASS is re-attested, and attest() is told which one (expectFingerprint: refused before the
            // canary if the distro changes in between, once the command forwards it). Anything else stops here as the owner's decision.
            // (environment.probe inspects first: an account step that only lost the optional reviewer check still inspected.)
            if (!["env_inspected", "env_account"].some((step) => run.results[step]?.status === "ok" || run.results[step]?.reviewerError)) {
              const fresh = (await commands.dispatch({ type: "environment.inspect", payload: {}, channel, actor, delegation, ownerSession })).result || {};
              if (fresh.ok === false || !fresh.fingerprint?.hash) { run.results[id] = { status: "error", detail: String(fresh.error || "inspecția mediului a eșuat înainte de atestare").slice(0, 300), at: iso() }; break; }
            }
            const decision = reattestDecision(envService()?.state()?.fingerprint?.hash || null);
            if (!decision.ok) {
              run.results[id] = { status: decision.owner ? "owner" : "error", detail: decision.text, at: iso() };
              if (decision.owner) bus.emit({ type: "setup.attestation_needs_owner", scopeType: "environment", scopeId: ENV_ID, source: actor, payload: { reason: decision.text } });
              break;
            }
            payload = { ...payload, expectFingerprint: decision.fingerprint };
          }
          const r = await commands.dispatch({ ...exec[id], payload, channel, actor, delegation, ownerSession });
          const result = r.result || {};
          const failed = id === "backup" ? result.status !== "verified"
            : id === "env_attested" ? !/^PASS/.test(String(result.status || result.attestation?.status || ""))
              : id === "env_inspected" ? result.ok === false : id === "env_account" ? result.ok === false : false;
          run.results[id] = { status: failed ? "error" : "ok", detail: failed ? String(result.summary || result.error || result.reason || (result.status ? `stare ${result.status}` : "") || "verificarea a eșuat").slice(0, 300) : null, at: iso() };
          // 2.12.1 round 2 (PF-06): the reviewer's account check failed or threw in this run. Its cause is kept with the step; when no fresh
          // failure could be stored for the current fingerprint (it threw before the inspection), the step is an error with that cause
          // (retry shown), never „pending, older than 24 h” re-probed on every click. The reviewer is optional coverage: the Codex
          // check (C16) passed, so the attestation step still runs.
          if (id === "env_account" && !failed && result.reviewer && result.reviewer.ok === false) {
            const cause = `reviewer Claude: ${String(result.reviewer.error || "verificarea a eșuat").slice(0, 240)}`;
            const fresh = !reviewerProbeState({ facts: envService()?.state()?.facts || {}, fingerprint: envService()?.state()?.fingerprint || null }).stale;
            run.results[id] = fresh ? { status: "ok", detail: null, reviewerError: cause, at: iso() } : { status: "error", detail: cause, reviewerError: cause, at: iso() };
          }
          if (failed) break;
        } catch (error) { run.results[id] = { status: "error", detail: String(error.message).slice(0, 300), at: iso() }; break; }
      }
      run.current = null;
      run.finishedAt = iso();
      bus.emit({ type: "setup.automatic_finished", scopeType: "system", scopeId: "setup", source: actor, payload: { results: Object.fromEntries(Object.entries(run.results).map(([k, v]) => [k, v.status])) } });
    })().catch((error) => {
      // Never an unhandled rejection from the background run: the step in progress records the cause and the run ends.
      if (self.current && !self.results[self.current]) self.results[self.current] = { status: "error", detail: String(error?.message || error).slice(0, 300), at: iso() };
      self.current = null;
      if (!self.finishedAt) self.finishedAt = iso();
    });
    return { started: true, steps: plan };
  }

  return { steps, runAutomatic };
}
