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
 */
export const SETUP_STATUSES = Object.freeze(["DONE_AUTO", "DONE_OWNER", "IN_PROGRESS", "AUTO_PENDING", "NEEDS_OWNER", "BLOCKED", "RECOVERABLE_ERROR", "OPTIONAL"]);
const AUTO_STEPS = ["backup", "env_inspected", "env_account", "env_attested"];
const BACKUP_MAX_AGE_H = 24;

export function createSetup(hub) {
  const { db, settings, projects, trust, voice, envelopes, backups, commands, bus, config } = hub;
  let run = null; // { startedAt, finishedAt, current, results: { stepId: { status, detail, at } }, channel }

  const iso = () => config.now().toISOString();
  const ageH = (when) => (when ? (config.now().getTime() - new Date(when).getTime()) / 3600000 : Infinity);

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
    add({ id: "env_account", title: "Contul Codex din mediu (C16, fără model)", auto: true,
      status: running("env_account") ? "IN_PROGRESS" : accountOk ? "DONE_AUTO" : lastRun("env_account")?.status === "error" ? "RECOVERABLE_ERROR" : "AUTO_PENDING",
      detail: accountOk ? `${account.accountType || "cont"} · ${account.planType || "—"} · ${account.probedAt}` : lastRun("env_account")?.detail || notRun("env_account") || account?.error || "neverificat pe amprenta curentă" });
    const att = env?.attestation || null;
    const byId = att?.latest?.byId || att?.latest?.checks?.byId || {};
    const cover = (id) => byId[id] === "PASS" ? "trecut" : byId[id] === "FAIL" ? "EȘUAT" : "nerulat";
    add({ id: "env_attested", title: "Atestarea mediului (canary C1–C20)", auto: true,
      status: running("env_attested") ? "IN_PROGRESS" : att?.valid ? "DONE_AUTO" : lastRun("env_attested")?.status === "error" ? "RECOVERABLE_ERROR" : "AUTO_PENDING",
      detail: att?.valid ? `${att.latest?.status} · preview C18 ${cover("C18")} · E2E C19 ${cover("C19")} · review C20 ${cover("C20")}` : lastRun("env_attested")?.detail || notRun("env_attested") || att?.reason || "neatestat" });

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
    add({ id: "voice_gate", title: "Filtrul vocal înainte de Lega", status: vs.gate.enabled ? "DONE_OWNER" : vs.profile ? "OPTIONAL" : "BLOCKED", detail: vs.gate.enabled ? "strict: doar vocea ta ajunge la Lega" : "pornește-l după profil" });
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
    const hubProject = projects.hub();
    const exec = { backup: { type: "backup.run", payload: { projectId: hubProject?.id } }, env_inspected: { type: "environment.inspect", payload: {} },
      env_account: { type: "environment.probe", payload: {} }, env_attested: { type: "environment.attest", payload: { allowRestart: true } } };
    bus.emit({ type: "setup.automatic_started", scopeType: "system", scopeId: "setup", source: actor, payload: { steps: plan, channel } });
    (async () => {
      for (const id of plan) {
        run.current = id;
        try {
          const r = await commands.dispatch({ ...exec[id], channel, actor, delegation, ownerSession });
          const result = r.result || {};
          const failed = id === "backup" ? result.status !== "verified"
            : id === "env_attested" ? !/^PASS/.test(String(result.status || result.attestation?.status || ""))
              : id === "env_inspected" ? result.ok === false : id === "env_account" ? result.ok === false : false;
          run.results[id] = { status: failed ? "error" : "ok", detail: failed ? String(result.summary || result.error || result.reason || (result.status ? `stare ${result.status}` : "") || "verificarea a eșuat").slice(0, 300) : null, at: iso() };
          if (failed) break;
        } catch (error) { run.results[id] = { status: "error", detail: String(error.message).slice(0, 300), at: iso() }; break; }
      }
      run.current = null;
      run.finishedAt = iso();
      bus.emit({ type: "setup.automatic_finished", scopeType: "system", scopeId: "setup", source: actor, payload: { results: Object.fromEntries(Object.entries(run.results).map(([k, v]) => [k, v.status])) } });
    })();
    return { started: true, steps: plan };
  }

  return { steps, runAutomatic };
}
