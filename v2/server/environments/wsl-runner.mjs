import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { HubError } from "../core/errors.mjs";
import { newId } from "../core/ids.mjs";
import { json, parse } from "../storage/db.mjs";
import { createCodexAdapter, MCP_NAME_ADDRESSABLE } from "../providers/codex.mjs";
import { CLAUDE_KNOWN_FLAGS } from "../providers/claude.mjs";
import { ENV_POLICY_TEXT } from "../policy/isolation.mjs";
import { WSL_RUNNER, resolveWsl, wslArgs, runInDistro, runScript, parseKeyValues, assertWorkspacePath, cleanWslText } from "./wsl.mjs";
import { BWRAP, reviewerArgs, CLAUDE_IN_SANDBOX, CLAUDE_PKG } from "./sandbox-profiles.mjs";
import { writeTar, createTarReader, EXPORT_LIMITS } from "./tar.mjs";
import { selectTransferFiles, transferStream, validateExport, stageExportFile, applyChanges, ignoreCandidates, EXPORT_POLICY, RUN_TMP_DIR, TRANSFER_LIMITS } from "./workspace.mjs";
import { gitCheckIgnored } from "../tools/git.mjs";
import { runCanary, CANARY_VERSION, CANARY_OPTIONAL_IDS } from "./canary.mjs";
import { exerciseExportValidator } from "./c14.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = Object.fromEntries(["inspect", "prepare", "reap", "release", "reviewer-cleanup"].map((name) => [name, fs.readFileSync(path.join(here, "scripts", `${name}.sh`), "utf8")]));
const sha16 = (text) => crypto.createHash("sha256").update(text).digest("hex").slice(0, 16);

/**
 * Fields that define the environment an attestation belongs to (M05 §12). Any change invalidates it. M07 adds the E2E browser
 * (Playwright version, headless-shell build and binary hash) and the reviewer (Claude Code version and binary hash, the
 * presence and modes of its dedicated config dir and credentials file — never their content).
 */
export const FINGERPRINT_FIELDS = Object.freeze(["distro", "wslconf", "codex", "codexSha", "config", "codexExtras", "kernel", "profiles", "bwrap", "tar",
  "pwVersion", "pwChromium", "pwSha", "claude", "claudeSha", "reviewerConfig"]);
/** An attestation is evidence for a limited time even when nothing changed (a weekly re-run catches what the fingerprint cannot). */
export const ATTESTATION_MAX_AGE_DAYS = 14;

export function fingerprintOf(facts, env = WSL_RUNNER) {
  const fp = { distro: env.distro, wslconf: facts.wslconf || "", codex: facts.codex_version || "", codexSha: facts.codex_sha || "", config: facts.config || "",
    kernel: facts.kernel || "", profiles: String(facts.profiles || "").split(",").filter(Boolean).sort().join(","), bwrap: facts.bwrap || "", tar: facts.tar || "", codexExtras: facts.codex_extras || "",
    pwVersion: facts.pw_version || "", pwChromium: facts.pw_chromium || "", pwSha: facts.pw_sha || "", claude: facts.claude_cli || "", claudeSha: facts.claude_sha || "",
    reviewerConfig: facts.reviewer_config ? `${facts.reviewer_config};creds=${facts.reviewer_creds || "absent"}` : "" };
  return { ...fp, hash: sha16(JSON.stringify(FINGERPRINT_FIELDS.map((k) => [k, fp[k]]))),
    line: `distro=${fp.distro} wslconf=${fp.wslconf} codex=${fp.codex} config=${fp.config} kernel=${fp.kernel}` };
}

/** A probe of the environment's account is usable for 24 h and only for the fingerprint it was taken on. */
export const PROBE_MAX_AGE_H = 24;
export function probeProblem(probe, state, now = new Date()) {
  if (!probe) return "contul nu a fost verificat prin mediu";
  if (probe.ok === false) return `verificarea contului a eșuat: ${probe.error || "—"}`;
  const ageH = (now.getTime() - new Date(probe.probedAt).getTime()) / 3600000;
  if (!(ageH <= PROBE_MAX_AGE_H)) return `verificarea contului e mai veche de ${PROBE_MAX_AGE_H} h`;
  if (!state?.fingerprint?.hash || probe.fingerprintHash !== state.fingerprint.hash) return `verificarea contului a fost făcută pentru altă amprentă (${probe.fingerprintHash || "—"})`;
  return null;
}

/**
 * Status of one canary result (shared by the Hub attestation and the manual driver): PASS_LOCAL only when every check
 * passed on an unchanged real environment; PASS_SIMULATED when the distro is the test fixture; INCOMPLETE when a check did
 * not run; FAIL otherwise.
 */
export function attestationStatusOf({ canary, before, after, simulated = false }) {
  const sameEnvironment = Boolean(before?.fingerprint?.hash) && before.fingerprint.hash === after?.fingerprint?.hash;
  // M06-A / M07: C18 (the local-only profile), C19 (Chromium with its own sandbox in it) and C20 (the reviewer boundary) only
  // ADD coverage; a failing or missing one never invalidates the boundary that C1–C17 attest for the writer, checks, QA and export.
  const optional = (id) => CANARY_OPTIONAL_IDS.includes(String(id).split("/")[0].replace(/[a-z]+$/, ""));
  const failed = canary.lines.filter((l) => l.status === "FAIL" && !optional(l.id));
  const notRun = Object.entries(canary.byId).filter(([k, s]) => s === "NOT_RUN" && !optional(k)).map(([k]) => k);
  const status = !sameEnvironment || failed.length || !before?.ok ? "FAIL" : notRun.length ? "INCOMPLETE" : simulated ? "PASS_SIMULATED" : "PASS_LOCAL";
  const word = (id, failText) => (canary.byId[id] === "PASS" ? "trecut" : canary.byId[id] === "FAIL" ? `EȘUAT (${failText})` : "nerulat");
  const summary = !sameEnvironment ? "amprenta s-a schimbat în timpul atestării" : !before?.ok ? "inspecția raportează probleme de graniță"
    : failed.length ? `${failed.length} verificări eșuate: ${failed.slice(0, 4).map((l) => l.sub).join(", ")}` : notRun.length ? `nerulate: ${notRun.join(", ")}`
      : `C1–C17 trecute (${canary.lines.length} verificări)${simulated ? "; distribuție SIMULATĂ (fixture), nu o dovadă WSL" : "; local, fără model (nu PASS_LIVE)"}; profilul doar-local C18: ${word("C18", "preview-ul nu rulează în mediu")}; E2E Chromium C19: ${word("C19", "E2E nu rulează în mediu")}; reviewer C20: ${word("C20", "review-ul rămâne pe Windows")}`;
  // What the evidence covers, derived from the checks that passed (declared, never assumed): the model-command sandbox
  // (C7–C13) is the boundary of the writer profile and of the checks/QA commands; C14 the export path; C16 the account;
  // C18 the preview profile, C19 its browser E2E, C20 the reviewer's sandbox.
  const passed = (ids) => ids.every((id) => canary.byId[id] === "PASS");
  const stages = status === "PASS_LOCAL" || status === "PASS_SIMULATED"
    ? [...(passed(["C7", "C8", "C9", "C10", "C11", "C12", "C13"]) ? ["writer-profile", "checks", "qa"] : []), ...(passed(["C14"]) ? ["export"] : []), ...(passed(["C16"]) ? ["account"] : []),
      ...(passed(["C18"]) ? ["preview-local-only"] : []), ...(passed(["C18", "C19"]) ? ["e2e-local-only"] : []), ...(passed(["C20"]) ? ["review-environment"] : [])]
    : [];
  return { status, summary, stages, failed: failed.length, notRun };
}

/**
 * The reviewer's own settings (the only ones a Hub run of Claude Code loads, --setting-sources user), from the inspection's
 * key NAMES: anything that could select another billing route, switch the model by itself or run commands refuses the
 * reviewer in the environment (the same rules as the Windows reviewer's inspectClaudeConfig).
 */
export function reviewerSettingsProblem(facts = {}) {
  if (facts.reviewer_settings === "unreadable") return "setările reviewer-ului (settings.json) nu pot fi citite";
  if (facts.reviewer_api_key_helper === "yes") return "setările reviewer-ului definesc apiKeyHelper (rută facturată separat)";
  if (facts.reviewer_fallback === "yes") return "setările reviewer-ului definesc fallbackModel: Claude ar putea comuta singur pe alt model";
  if (facts.reviewer_risky_env) return `setările reviewer-ului definesc ${String(facts.reviewer_risky_env).split(",").filter(Boolean).slice(0, 4).join(", ")}`;
  if (facts.reviewer_hooks === "yes") return "setările reviewer-ului definesc hooks (comenzi rulate de client)";
  return null;
}
/** The reviewer settings as the billing check reads them (inspectClaudeConfig's shape, from names only). */
export const reviewerConfigFacts = (facts = {}) => ({ inspectedFiles: facts.reviewer_settings === "present" ? 1 : 0, apiKeyHelper: facts.reviewer_api_key_helper === "yes",
  fallbackModelSet: facts.reviewer_fallback === "yes", riskyEnvInSettings: String(facts.reviewer_risky_env || "").split(",").filter(Boolean), hooks: facts.reviewer_hooks === "yes",
  anthropicActiveProfilePresent: false, environment: "linux" });

/** What the inspection says about the boundary itself. `blocking` problems stop every dispatch through the environment. */
export function boundaryProblems(facts, env = WSL_RUNNER) {
  const out = [];
  const p = (code, detail, blocking = true) => out.push({ code, detail, blocking });
  if (facts.user !== env.user) p("user", `procesele rulează ca ${facts.user || "?"}, nu ca ${env.user}`);
  if (facts.uid === "0") p("root", "procesele rulează ca root");
  if (facts.privileged_group === "yes" || facts.sudo === "allowed") p("sudo", `${env.user} are drepturi administrative (sudo/grup privilegiat)`);
  if (facts.mnt_drives) p("drives", `discuri Windows montate în /mnt: ${facts.mnt_drives}`);
  if (facts.drvfs_mounts && facts.drvfs_mounts !== "0") p("drvfs", `${facts.drvfs_mounts} montări drvfs/9p (discuri Windows)`);
  if (facts.interop_cmd === "found") p("interop", "cmd.exe este accesibil (interop Windows activ)");
  if (facts.path_windows === "yes") p("path", "PATH conține căi Windows");
  for (const [key, want] of [["wslconf.automount.enabled", "false"], ["wslconf.interop.enabled", "false"], ["wslconf.interop.appendWindowsPath", "false"]]) {
    if (facts[key] !== want) p("wslconf", `/etc/wsl.conf: ${key.slice(8)}=${facts[key] || "nesetat"} (așteptat ${want})`);
  }
  const profiles = String(facts.profiles || "").split(",").filter(Boolean);
  for (const profile of Object.values(env.profiles)) if (!profiles.includes(profile)) p("profile", `profilul de permisiuni ${profile} lipsește din configurația Codex a mediului`);
  const mcp = String(facts.mcp_servers || "").split(",").filter(Boolean);
  if (mcp.length) p("mcp", `configurația mediului definește servere MCP (${mcp.slice(0, 5).join(", ")}); sunt oprite per proces, dar nu ar trebui să existe`, false);
  if (facts.mcp_inline && facts.mcp_inline !== "0") p("mcp_inline", "mcp_servers definit inline (nu poate fi oprit per proces)");
  const keys = String(facts.config_keys || "").split(",").filter(Boolean);
  if (keys.includes("model_provider") || keys.includes("model_providers")) p("custom_provider", "configurația mediului alege alt provider de model (rută posibil facturată separat)");
  if (keys.includes("preferred_auth_method") || facts.forced_login_method === "api") p("api_login", "configurația mediului preferă autentificarea cu cheie API");
  if (facts.auth_present !== "yes") p("needs_auth", "NEEDS_AUTH: clientul Codex din mediu nu are login (fă login ChatGPT în ifrim-runner)");
  else if (facts.auth_mode && facts.auth_mode !== "600") p("auth_mode", `fișierul de autentificare are permisiunile ${facts.auth_mode} (așteptat 600)`);
  if (!facts.codex_version) p("codex_missing", "clientul Codex nu este instalat în mediu");
  else if (facts.codex_owner && facts.codex_owner !== "root") p("codex_owner", `binarul Codex aparține lui ${facts.codex_owner}: ar putea fi înlocuit din mediu`);
  // M07: the E2E browser and the reviewer's client were installed by the runner user. Their hashes are in the fingerprint, so
  // a replaced binary voids the attestation (and with it the E2E/review stages); owned by root they could not be replaced.
  for (const [key, label] of [["pw_owner", "Chromium-ul pentru E2E"], ["claude_owner", "clientul Claude Code al reviewer-ului"]]) {
    if (facts[key] && facts[key] !== "root") p(key, `${label} aparține lui ${facts[key]}: o înlocuire schimbă amprenta (atestarea cade), dar nu e împiedicată`, false);
  }
  return out;
}

/**
 * Codex launcher for the environment: `wsl.exe --exec /usr/bin/env -i … /usr/local/bin/codex <Hub overrides> -c
 * default_permissions=<profile> app-server`. The profiles live in the distro's own Codex config (attested by the canary);
 * the Windows profile, the Windows deny list and `windows.sandbox` do not apply there.
 */
export function wslCodexLauncher({ config, env = WSL_RUNNER, state }) {
  const names = () => String(state()?.facts?.mcp_servers || "").split(",").filter(Boolean);
  return {
    environment: env.id,
    platform: "linux",
    probeCwd: env.home,
    profiles: env.profiles,
    declineEscalations: true,
    spawn({ cwd, access, base, extraArgs, vars = {} }) {
      const invocation = resolveWsl(config);
      if (!invocation) throw Object.assign(new Error("wsl.exe nu este disponibil"), { category: "transport", preInference: true });
      const profile = env.profiles[access] || env.profiles["read-only"];
      const argv = [env.codex, ...base, ...extraArgs, "-c", `default_permissions="${profile}"`, "app-server"];
      return { executable: invocation.executable, args: [...invocation.prefixArgs, ...wslArgs(env, { cwd, argv, vars })], cwd: config.hubRoot };
    },
    mcpLaunchPlan() {
      const current = state();
      if (!current?.facts) return { names: [], problem: "Mediul ifrim-runner nu a fost inspectat: serverele MCP din configurația lui nu pot fi verificate; oprit înainte de pornire" };
      if (current.facts.mcp_inline && current.facts.mcp_inline !== "0") return { names: [], problem: "Configurația Codex a mediului definește mcp_servers inline (nu poate fi oprit per proces); oprit înainte de pornire" };
      const list = names();
      if (list.some((n) => !MCP_NAME_ADDRESSABLE.test(n))) return { names: [], problem: "Un server MCP din configurația mediului nu poate fi oprit per proces; oprit înainte de pornire" };
      return { names: list, problem: null };
    },
    inspectConfig() {
      const facts = state()?.facts;
      if (!facts) return { present: false, environment: env.id };
      const keys = String(facts.config_keys || "").split(",").filter(Boolean);
      return { present: true, environment: env.id, configHash: facts.config || null,
        customProvider: keys.includes("model_provider") ? "configurat în mediu" : null, definesProviders: keys.includes("model_providers"),
        apiKeyAuthPreferred: keys.includes("preferred_auth_method") || facts.forced_login_method === "api",
        realtime: { riskyKeys: [], overriddenPerProcess: [], mcpServers: names().length, mcpServerNames: names() } };
    },
  };
}

/**
 * The wsl-runner environment service: inspection and fingerprint, the account check through the environment's own client
 * (C16), the attestation (canary C1–C17), and the per-run workspace lifecycle (prepare → export → validate → apply → reap →
 * release). Never a model: no thread or turn is started here.
 */
export function createWslRunnerEnvironment({ config, db, bus, clock, providerState, supervisor, env = WSL_RUNNER, homeDir }) {
  const stateKey = `env:${env.id}`;
  const probeKey = `codex@${env.id}`;
  const reviewerKey = `claude@${env.id}`;
  const workRoot = path.join(config.workDir, "environments", env.id);
  const users = new Map(); // operation id → label: runs, runner commands, attestation (C15 must not restart under them)
  let attesting = false;
  const state = () => providerState.get(stateKey);
  const launcher = wslCodexLauncher({ config, env, state });
  // The test fixture stands in for wsl.exe: everything it produces is labelled simulated, never a WSL proof.
  const simulated = Boolean(resolveWsl(config)?.fixture);
  const codex = createCodexAdapter({ config, supervisor, homeDir, launcher });

  const store = (value) => { providerState.set(stateKey, value); return value; };
  const now = () => clock().toISOString();

  async function inspect() {
    const started = Date.now();
    let result;
    try { result = await runScript(config, env, SCRIPTS.inspect, [], { timeoutMs: 180000 }); }
    catch (error) { return store({ environment: env.id, inspectedAt: now(), ok: false, installed: null, error: String(error.message).slice(0, 300), durationMs: Date.now() - started }); }
    const facts = parseKeyValues(result.text);
    if (result.code !== 0 || facts.done !== "1") {
      const missing = /no distribution|DISTRO_NOT_FOUND|WSL_E_DISTRO|nu există nicio distribuție/i.test(result.stderr);
      return store({ environment: env.id, inspectedAt: now(), ok: false, installed: missing ? false : null, durationMs: Date.now() - started,
        error: missing ? `Distribuția ${env.distro} nu este instalată` : `inspecția a eșuat (exit ${result.code}): ${result.stderr.slice(0, 200)}` });
    }
    const fingerprint = fingerprintOf(facts, env);
    const problems = boundaryProblems(facts, env);
    return store({ environment: env.id, inspectedAt: now(), ok: !problems.some((p) => p.blocking), installed: true, facts, fingerprint, problems, durationMs: Date.now() - started });
  }

  /** C16 as check lines, from a probe result (no inference happened: no thread, no turn). */
  function c16Lines(probe) {
    const auth = probe.auth || {};
    const models = Array.isArray(probe.models) ? probe.models : [];
    const profiles = probe.sandbox?.profiles || [];
    const allowed = (id) => profiles.some((p) => p.id === id && p.allowed);
    return [
      `C16a ${probe.ok && auth.accountType === "chatgpt" ? "PASS" : "FAIL"} contul prin clientul din ${env.distro}: tip ${auth.accountType || "—"}, plan ${auth.planType || "—"}`,
      // requiresOpenaiAuth only says the active provider is OpenAI's (true for the ChatGPT route too); it is not "login missing".
      `C16b ${auth.accountType === "chatgpt" && !probe.config?.apiKeyAuthPreferred && !probe.config?.customProvider && !probe.config?.definesProviders ? "PASS" : "FAIL"} fără cheie API: cont ${auth.accountType || "—"}, configurația mediului fără preferință de cheie API sau alt provider`,
      `C16c ${models.length ? "PASS" : "FAIL"} model/list: ${models.length} modele raportate (catalog, nu dovadă de eligibilitate)`,
      `C16d ${allowed(env.profiles["workspace-write"]) && allowed(env.profiles["read-only"]) ? "PASS" : "FAIL"} profilurile ${Object.values(env.profiles).join(", ")} raportate permise`,
      `C16e ${probe.usage && !probe.usage.error ? "PASS" : "FAIL"} limitele planului citite prin account/rateLimits/read (nu pornește un model)`,
    ];
  }

  /** The account check through the environment (C16). Stored as the provider state of `codex@wsl-runner`. */
  async function probeAccount() {
    users.set("probe", "account check");
    try { return await probeAccountInner(); } finally { users.delete("probe"); }
  }
  async function probeAccountInner() {
    const inspected = await inspect();
    if (!inspected.installed) throw new HubError("transport", inspected.error || "Mediul nu este disponibil");
    const result = await codex.probe({ withModels: true, withUsage: true });
    const installation = { installed: Boolean(inspected.facts?.codex_version), binary: `wsl:${env.distro}:${env.codex}`, source: env.id,
      version: inspected.facts?.codex_version ? `codex-cli ${inspected.facts.codex_version}` : null };
    const value = { ...result, installation, config: launcher.inspectConfig(), environment: env.id, fingerprintHash: inspected.fingerprint?.hash || null };
    providerState.set(probeKey, value);
    return { ...value, c16: c16Lines(value) };
  }

  // ---------- attestation ----------
  const attestationRow = (row) => row && ({ id: row.id, environmentId: row.environment_id, status: row.status, fingerprintHash: row.fingerprint_hash,
    fingerprint: parse(row.fingerprint_json, {}), canaryVersion: row.canary_version, checks: parse(row.checks_json, {}), stages: parse(row.stages_json, []),
    summary: row.summary, actor: row.actor, channel: row.channel, startedAt: row.started_at, finishedAt: row.finished_at });
  const latestAttestation = () => attestationRow(db.prepare("SELECT * FROM environment_attestations WHERE environment_id = ? ORDER BY started_at DESC LIMIT 1").get(env.id));
  const attestation = (id) => attestationRow(db.prepare("SELECT * FROM environment_attestations WHERE id = ?").get(id));

  /** Whether the latest attestation still covers the environment as last inspected (fingerprint, canary version, age). */
  function attestationStatus(at = clock()) {
    const latest = latestAttestation();
    const current = state();
    if (!latest) return { valid: false, reason: "Mediul nu a fost atestat (canary C1–C17 nerulat)", latest: null };
    const acceptable = latest.status === "PASS_LOCAL" || (latest.status === "PASS_SIMULATED" && config.testMode);
    if (!acceptable) return { valid: false, reason: `Ultima atestare: ${latest.status} (${latest.summary})`, latest };
    if (latest.canaryVersion !== CANARY_VERSION) return { valid: false, reason: `Atestarea folosește canary ${latest.canaryVersion}; versiunea curentă e ${CANARY_VERSION}`, latest };
    const ageDays = (at.getTime() - new Date(latest.finishedAt || latest.startedAt).getTime()) / 86400000;
    if (ageDays > ATTESTATION_MAX_AGE_DAYS) return { valid: false, reason: `Atestarea are ${Math.floor(ageDays)} zile (maxim ${ATTESTATION_MAX_AGE_DAYS}); rulează-o din nou`, latest };
    if (!current?.fingerprint?.hash) return { valid: false, reason: "Mediul nu a fost inspectat de la pornire", latest };
    if (current.fingerprint.hash !== latest.fingerprintHash) return { valid: false, reason: `Amprenta mediului s-a schimbat (${latest.fingerprintHash} → ${current.fingerprint.hash}); atestarea nu mai e valabilă`, latest, changed: true };
    if (!current.ok) return { valid: false, reason: `Inspecția curentă raportează probleme: ${(current.problems || []).filter((p) => p.blocking).map((p) => p.detail).join("; ")}`, latest };
    return { valid: true, reason: `Atestat ${latest.finishedAt} pe amprenta ${latest.fingerprintHash}`, latest };
  }

  async function attest({ actor = "user", channel = "ui", allowRestart = true } = {}) {
    if (attesting) throw new HubError("conflict", "O atestare rulează deja");
    attesting = true;
    const id = newId("att");
    const startedAt = now();
    try {
      const before = await inspect();
      if (!before.installed) throw new HubError("transport", before.error || "Mediul nu este disponibil");
      const canary = await runCanary({ config, env,
        c14: () => exerciseExportValidator({ service, workDir: workRoot }),
        c16: async () => (await probeAccount()).c16,
        allowRestart: () => allowRestart && users.size === 0 });
      const after = await inspect();
      const { status, summary, stages } = attestationStatusOf({ canary, before, after, simulated });
      bus.transaction(() => {
        db.prepare(`INSERT INTO environment_attestations (id, environment_id, status, fingerprint_hash, fingerprint_json, canary_version, checks_json, stages_json, summary, actor, channel, started_at, finished_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, env.id, status, before.fingerprint?.hash || "", json({ ...before.fingerprint, after: after.fingerprint?.hash || null }),
          CANARY_VERSION, json({ byId: canary.byId, lines: canary.lines, info: canary.info, fingerprintLine: canary.fingerprintLine }), json(stages), summary, actor, channel, startedAt, now(), now());
        bus.append({ type: "environment.attested", scopeType: "environment", scopeId: env.id, source: actor, payload: { attestationId: id, status, fingerprintHash: before.fingerprint?.hash || null, summary } });
      });
      return attestation(id);
    } finally { attesting = false; }
  }

  // ---------- workspaces ----------
  const wsRow = (row) => row && ({ id: row.id, environmentId: row.environment_id, runId: row.run_id, projectId: row.project_id, purpose: row.purpose, linuxPath: row.linux_path,
    fingerprintHash: row.fingerprint_hash, stats: parse(row.stats_json, {}), export: parse(row.export_json, {}), status: row.status, createdAt: row.created_at, updatedAt: row.updated_at });
  const getWorkspace = (id) => wsRow(db.prepare("SELECT * FROM environment_workspaces WHERE id = ?").get(id));
  const listWorkspaces = (limit = 30) => db.prepare("SELECT * FROM environment_workspaces WHERE environment_id = ? ORDER BY created_at DESC LIMIT ?").all(env.id, limit).map(wsRow);
  const setWorkspace = (id, fields, event = null) => bus.transaction(() => {
    const sets = Object.keys(fields).map((k) => `${k} = ?`).join(", ");
    db.prepare(`UPDATE environment_workspaces SET ${sets}, updated_at = ? WHERE id = ?`).run(...Object.values(fields), now(), id);
    if (event) bus.append({ type: event.type, scopeType: "environment", scopeId: env.id, source: "hub", runId: event.runId || null, payload: { workspaceId: id, ...event.payload } });
  });
  const manifestFile = (id) => path.join(workRoot, id, "manifest.json");

  /**
   * Copies the project into a fresh workspace in the distro (tar over stdin, nothing mounted) and records exactly what was
   * sent. The copy is verified by counting files and bytes inside the distro.
   */
  async function prepareWorkspace({ id = newId("ews"), projectRoot, projectId, runId = null, purpose = "run", fingerprintHash = "", signal = null }) {
    if (!/^[a-z0-9_-]{4,80}$/.test(id)) throw new HubError("validation", "Identificator de workspace invalid");
    // The attestation restarts the distro (C15): no other work may start in it meanwhile.
    if (attesting && purpose !== "attestation") throw Object.assign(new HubError("conflict", "Atestarea mediului rulează (repornește distribuția); încearcă după ce se termină"), { preInference: true });
    if (signal?.aborted) throw Object.assign(new HubError("conflict", "Oprit înainte de copiere"), { preInference: true });
    const ws = assertWorkspacePath(`${env.workspaceRoot}/${id}`, env);
    const started = Date.now();
    fs.mkdirSync(path.join(workRoot, id), { recursive: true });
    bus.transaction(() => db.prepare(`INSERT INTO environment_workspaces (id, environment_id, run_id, project_id, purpose, linux_path, fingerprint_hash, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'preparing', ?, ?)`).run(id, env.id, runId, projectId || "", purpose, ws, fingerprintHash, now(), now()));
    users.set(id, purpose);
    try {
      const prep = await runScript(config, env, SCRIPTS.prepare, [ws], { timeoutMs: 120000, signal });
      if (prep.code !== 0) throw new HubError("transport", `Workspace-ul nu a putut fi creat în mediu: ${parseKeyValues(prep.text).error || prep.stderr.slice(0, 200) || `exit ${prep.code}`}`);
      const selection = await selectTransferFiles(projectRoot, { limits: TRANSFER_LIMITS });
      const manifest = {};
      const skipped = { ...selection.skipped };
      const sent = await runInDistro(config, env, { cwd: ws, argv: ["/usr/bin/tar", "-x", "-f", "-", "-C", `${ws}/repo`, "--no-same-owner", "--no-same-permissions"],
        input: async (stdin) => { await writeTar(stdin, transferStream(selection, manifest, skipped)); stdin.end(); }, timeoutMs: 600000, signal });
      if (signal?.aborted) throw Object.assign(new HubError("conflict", "Oprit în timpul copierii în mediu"), { preInference: true });
      if (sent.code !== 0) throw new HubError("transport", `Transferul în mediu a eșuat (exit ${sent.code}): ${sent.stderr.slice(0, 200)}`);
      const counted = await runInDistro(config, env, { cwd: ws, argv: ["/usr/bin/find", `${ws}/repo`, "-type", "f", "-not", "-path", `${ws}/repo/${RUN_TMP_DIR}/*`, "-printf", "%s\\n"], timeoutMs: 120000, signal });
      const sizes = counted.stdout.toString("utf8").split("\n").filter(Boolean).map(Number);
      const expectedBytes = Object.values(manifest).reduce((s, f) => s + f.size, 0);
      const bytes = sizes.reduce((s, n) => s + n, 0);
      if (counted.code !== 0 || sizes.length !== Object.keys(manifest).length || bytes !== expectedBytes) {
        throw new HubError("integrity", `Copia din mediu nu corespunde transferului (${sizes.length}/${Object.keys(manifest).length} fișiere, ${bytes}/${expectedBytes} octeți)`);
      }
      fs.writeFileSync(manifestFile(id), json(manifest));
      const stats = { files: sizes.length, bytes, skipped, source: selection.source, durationMs: Date.now() - started, manifestSha: sha16(json(manifest)) };
      setWorkspace(id, { status: "prepared", stats_json: json(stats) }, { type: "environment.workspace_prepared", runId, payload: { files: stats.files, bytes, source: stats.source, durationMs: stats.durationMs } });
      return { id, ws, repo: `${ws}/repo`, tmp: `${ws}/repo/${RUN_TMP_DIR}`, stats };
    } catch (error) {
      setWorkspace(id, { status: "failed", stats_json: json({ error: String(error.message).slice(0, 300), durationMs: Date.now() - started }) },
        { type: "environment.workspace_failed", runId, payload: { error: String(error.message).slice(0, 300) } });
      await release(id).catch(() => {});
      throw error;
    }
  }

  /** Reads the workspace back as a tar stream and validates it against the transfer manifest (C14). Nothing is applied here. */
  async function collectExport(id, { protectedPaths = [], projectRoot = null } = {}) {
    const row = getWorkspace(id);
    if (!row) throw new HubError("not_found", "Workspace necunoscut");
    const ws = assertWorkspacePath(row.linuxPath, env);
    const baseline = parse(fs.readFileSync(manifestFile(id), "utf8"), {});
    const stagingDir = path.join(workRoot, id, "staging");
    fs.mkdirSync(stagingDir, { recursive: true });
    const staged = {};
    const reader = createTarReader({ limits: EXPORT_LIMITS, onFile: stageExportFile({ stagingDir, baseline, staged }) });
    const started = Date.now();
    const out = await runInDistro(config, env, { cwd: ws, argv: ["/usr/bin/tar", "-c", "-f", "-", "--format=pax", "--one-file-system", "--anchored", `--exclude=./${RUN_TMP_DIR}`, "-C", `${ws}/repo`, "."],
      onStdout: (chunk) => { reader.push(chunk); return !reader.aborted; }, timeoutMs: 600000 });
    const read = reader.end();
    if (out.code !== 0 && !read.aborted) read.problems.push(`tar a ieșit cu ${out.code}: ${out.stderr.slice(0, 200)}`);
    // New binary files the project's ignore rules exclude (asked of the project on Windows, never of the copy): left out, not
    // applied, listed in the evidence. Only for a writer turn (the caller passes projectRoot); a git failure leaves nothing out.
    const rules = projectRoot ? await gitCheckIgnored(projectRoot, ignoreCandidates({ read, baseline, staged })) : { ignored: new Set(), error: null };
    const validation = validateExport({ read, baseline, staged, protectedPaths, projectIgnored: rules.ignored, policy: { ...EXPORT_POLICY, maxFileBytes: EXPORT_LIMITS.maxFileBytes } });
    if (rules.error) validation.stats.ignoreRulesError = rules.error;
    const report = { ok: validation.ok, stats: validation.stats, refused: validation.refused.slice(0, 50), problems: validation.problems.slice(0, 20),
      changes: validation.changes.map((c) => ({ path: c.path, status: c.status, before: c.before?.sha256 || null, after: c.after?.sha256 || null })).slice(0, 500), durationMs: Date.now() - started };
    fs.writeFileSync(path.join(workRoot, id, "export.json"), json(report));
    setWorkspace(id, { status: validation.ok ? "exported" : "refused", export_json: json(report) },
      { type: validation.ok ? "environment.export_validated" : "environment.export_refused", runId: row.runId, payload: { ...validation.stats, refused: validation.refused.length, problems: validation.problems.slice(0, 3) } });
    return { ...validation, stagingDir, durationMs: report.durationMs };
  }

  /** Applies a validated export to the project (conflicts with human edits refuse the whole apply). */
  function applyExport(id, { projectRoot, validation }) {
    const row = getWorkspace(id);
    if (!row) throw new HubError("not_found", "Workspace necunoscut");
    if (!validation?.ok) throw new HubError("policy", "Exportul nu a fost validat; nu se aplică");
    const result = applyChanges({ projectRoot, changes: validation.changes, stagingDir: validation.stagingDir });
    const report = { ...row.export, applied: result.applied, conflicts: result.conflicts, rolledBack: result.rolledBack };
    setWorkspace(id, { status: result.conflicts.length ? "conflict" : "applied", export_json: json(report) },
      { type: result.conflicts.length ? "environment.export_conflict" : "environment.export_applied", runId: row.runId, payload: { applied: result.applied, conflicts: result.conflicts.slice(0, 5) } });
    return result;
  }

  /**
   * Reaps run one at a time for the whole environment (M07, the PLAUSIBLE reap race): a Stop's interrupt-path reap and the
   * post-turn "all"-mode reap used to run together, and the "all" reaper (which ends every process of the runner user but
   * its own) counted the other reaper's shell → remaining ≥ 1 → the run ended as an environment error with its lease
   * retained. A reaper that never overlaps another one never sees one. Each reap is bounded (60 s), so the queue is too.
   */
  let reapChain = Promise.resolve();
  function reap(id, options = {}) {
    const run = reapChain.then(() => reapOnce(id, options));
    reapChain = run.catch(() => {});
    return run;
  }

  /** Ends the processes of one workspace (Stop/cleanup). Targets only this user's processes in this workspace. */
  async function reapOnce(id, { marker = "", all = false } = {}) {
    const row = getWorkspace(id);
    const ws = assertWorkspacePath(row?.linuxPath || `${env.workspaceRoot}/${id}`, env);
    const result = await runScript(config, env, SCRIPTS.reap, [ws, marker || "-", ...(all ? ["all"] : [])], { timeoutMs: 60000 });
    const facts = parseKeyValues(result.text);
    return { ok: result.code === 0 && facts.remaining === "0", found: Number(facts.found || 0), forced: Number(facts.killed_forced || 0), remaining: Number(facts.remaining ?? -1), error: facts.error || null };
  }

  /** Removes a workspace after its processes are gone; a workspace still in use is kept (status retained). */
  async function release(id) {
    const row = getWorkspace(id);
    const ws = assertWorkspacePath(row?.linuxPath || `${env.workspaceRoot}/${id}`, env);
    try {
      const reaped = await reap(id).catch((error) => ({ ok: false, error: error.message }));
      const result = await runScript(config, env, SCRIPTS.release, [ws], { timeoutMs: 120000 });
      const facts = parseKeyValues(result.text);
      const ok = result.code === 0 && facts.ok === "1";
      if (row) {
        // The outcome (applied / refused / conflict / exported) stays the status; "released" is recorded next to it.
        const outcome = ["applied", "refused", "conflict", "exported"].includes(row.status);
        const stats = { ...row.stats, releasedAt: ok ? now() : null, retained: !ok };
        setWorkspace(id, { status: outcome ? row.status : ok ? "released" : "retained", stats_json: json(stats) },
          { type: ok ? "environment.workspace_released" : "environment.workspace_retained", runId: row.runId, payload: { reaped: reaped.found || 0, error: ok ? null : facts.error || result.stderr.slice(0, 200) } });
        // An applied result is in the project already: its staging copy goes. Refused/conflicting exports stay in
        // quarantine (bounded below) for the owner to inspect.
        if (ok && row.status === "applied") fs.rmSync(path.join(workRoot, id, "staging"), { recursive: true, force: true });
        pruneQuarantine();
      }
      return { ok, reaped, error: ok ? null : facts.error || `exit ${result.code}` };
    } finally {
      // A workspace that could not be released (a process still in it) stays "in use": C15 never restarts under it.
      if (getWorkspace(id)?.status !== "retained") users.delete(id);
    }
  }

  /** Keeps the staging (quarantine) of at most 30 workspaces; older ones are removed (their reports stay in the database). */
  function pruneQuarantine(keep = 30) {
    let dirs = [];
    try { dirs = fs.readdirSync(workRoot, { withFileTypes: true }).filter((d) => d.isDirectory() && fs.existsSync(path.join(workRoot, d.name, "staging"))).map((d) => d.name); } catch { return; }
    const rows = dirs.map((id) => ({ id, at: getWorkspace(id)?.updatedAt || "" })).sort((a, b) => b.at.localeCompare(a.at));
    for (const { id } of rows.slice(keep)) fs.rmSync(path.join(workRoot, id, "staging"), { recursive: true, force: true });
  }

  /** At boot: workspaces left by a crash are marked orphaned (kept for inspection; the owner releases them). */
  function recover() {
    const rows = db.prepare("SELECT id FROM environment_workspaces WHERE environment_id = ? AND status IN ('preparing','prepared','running','exported')").all(env.id);
    for (const { id } of rows) setWorkspace(id, { status: "orphaned" }, { type: "environment.workspace_orphaned", payload: {} });
    return { orphaned: rows.length };
  }

  /**
   * Whether the WRITER may use the environment for this project now: the same facts the gate checks (attestation on the
   * current fingerprint, a fresh account check for this fingerprint with the profile allowed, (b) for a real project).
   */
  function writerReadiness(project, settings, at = clock()) {
    const st = state();
    if (!st?.installed || !st.ok) return { ok: false, detail: st?.error || "mediul nu e inspectat sau are probleme de graniță" };
    const att = attestationStatus(at);
    if (!att.valid) return { ok: false, detail: att.reason };
    const probe = providerState.get(probeKey);
    const pp = probeProblem(probe, st, at);
    if (pp) return { ok: false, detail: pp };
    const profile = (probe.sandbox?.profiles || []).find((p) => p.id === env.profiles["workspace-write"]);
    if (!profile?.allowed) return { ok: false, detail: `profilul ${env.profiles["workspace-write"]} nu e raportat permis` };
    if (project && project.source !== "hub-test") {
      const policy = settings.get("environmentPolicy")?.[env.id];
      if (!policy?.approvedAt || policy.fingerprintHash !== st.fingerprint?.hash) return { ok: false, detail: "proiectul real cere aprobarea (b) pentru amprenta curentă" };
    }
    return { ok: true, detail: null };
  }

  // ---------- reviewer (M07: claude@wsl-runner) ----------
  const projectRow = (id) => (id ? db.prepare("SELECT id, source FROM projects WHERE id = ?").get(id) || null : null);

  /**
   * Whether the read-only reviewer may run in this environment for a project: Claude Code installed at the fixed path
   * (version + binary hash in the fingerprint), its dedicated config dir (700) with a login (credentials 600, stat only), no
   * billing-relevant key in its settings, the environment as attested, a canary that measured the reviewer's sandbox (C20),
   * and (b) for a real project. Not ready → the reviewer stays on Windows (tool boundary, as before M07); the route, the
   * stage map and the gate all say which. The account check is NOT part of it: a stale one blocks at the gate (billing_route)
   * instead of silently changing the boundary.
   */
  function reviewerReadiness(projectOrId = null, settings = null, at = clock()) {
    const st = state();
    if (!st?.installed || !st.ok) return { ok: false, detail: st?.error || `mediul ${env.id} nu e inspectat sau are probleme de graniță` };
    const f = st.facts || {};
    if (!f.claude_cli || !f.claude_sha) return { ok: false, detail: `Claude Code nu este instalat în ${env.id} (${CLAUDE_PKG})` };
    if (f.reviewer_config !== "present:700") return { ok: false, detail: `directorul de configurare al reviewer-ului ${f.reviewer_config && f.reviewer_config !== "absent" ? `are ${f.reviewer_config}` : "lipsește"} (așteptat 700)` };
    if (f.reviewer_creds !== "present:600") return { ok: false, detail: !f.reviewer_creds || f.reviewer_creds === "absent" ? "NEEDS_AUTH: reviewer-ul din mediu nu are login (claude login cu directorul de configurare dedicat)" : `fișierul de autentificare al reviewer-ului are ${f.reviewer_creds} (așteptat 600)` };
    const settingsProblem = reviewerSettingsProblem(f);
    if (settingsProblem) return { ok: false, detail: settingsProblem };
    const att = attestationStatus(at);
    if (!att.valid) return { ok: false, detail: att.reason };
    const c20 = att.latest?.checks?.byId?.C20;
    if (c20 !== "PASS") return { ok: false, detail: `granița reviewer-ului nu e atestată: canary C20 ${c20 || "NOT_RUN"}; refă atestarea mediului` };
    const project = typeof projectOrId === "string" ? projectRow(projectOrId) : projectOrId;
    if (project && project.source !== "hub-test") {
      const policy = settings?.get("environmentPolicy")?.[env.id];
      if (!policy?.approvedAt || policy.text !== ENV_POLICY_TEXT || policy.fingerprintHash !== st.fingerprint?.hash) return { ok: false, detail: "proiectul real cere aprobarea (b) pentru amprenta curentă" };
    }
    return { ok: true, detail: null };
  }

  /** Check lines of the reviewer's account check (like C16 for Codex), shown with the probe and in the overview. */
  function reviewerLines(probe) {
    const auth = probe?.auth || {};
    const cfg = probe?.config || {};
    return [
      `R1 ${probe?.ok && probe.installation?.installed ? "PASS" : "FAIL"} Claude Code în sandbox-ul reviewer-ului din ${env.distro}: ${probe?.installation?.version || probe?.error || "—"}`,
      `R2 ${auth.loggedIn && auth.authMethod === "claude.ai" && auth.apiProvider === "firstParty" ? "PASS" : "FAIL"} login prin abonament: ${auth.authMethod || "—"}/${auth.apiProvider || "—"}, plan ${auth.subscriptionType || "—"} (fără cheie API)`,
      `R3 ${!cfg.apiKeyHelper && !cfg.fallbackModelSet && !(cfg.riskyEnvInSettings || []).length && !cfg.hooks ? "PASS" : "FAIL"} setările reviewer-ului fără apiKeyHelper, fallbackModel, variabile de facturare sau hooks`,
    ];
  }

  /**
   * The reviewer's account check through the environment (M07; the reviewer's C16): `claude --version`, `--help` (which of
   * the flags the Hub passes it lists) and `claude auth status --json`, each inside the EXACT production reviewer sandbox
   * (reviewerArgs), in an empty workspace — no prompt, no model. Only loggedIn/authMethod/apiProvider/subscriptionType are
   * kept. Stored as the provider state of `claude@wsl-runner`, bound to the fingerprint (probeProblem: 24 h).
   */
  async function probeReviewer() {
    users.set("reviewer-probe", "reviewer account check");
    const id = `rp-${crypto.randomBytes(6).toString("hex")}`;
    const ws = `${env.workspaceRoot}/${id}`;
    let created = false;
    try {
      const inspected = await inspect();
      if (!inspected.installed) throw new HubError("transport", inspected.error || "Mediul nu este disponibil");
      const facts = inspected.facts || {};
      const value = { provider: "claude", environment: env.id, probedAt: now(), fingerprintHash: inspected.fingerprint?.hash || null, config: reviewerConfigFacts(facts),
        installation: { installed: Boolean(facts.claude_cli && facts.claude_sha), binary: `wsl:${env.distro}:${CLAUDE_PKG}`, source: env.id, version: facts.claude_cli ? `${facts.claude_cli} (Claude Code)` : null } };
      const store = (extra) => { const v = { ...value, ...extra }; providerState.set(reviewerKey, v); return { ...v, lines: reviewerLines(v) }; };
      if (!value.installation.installed) return store({ ok: false, error: `Claude Code nu este instalat în ${env.id}` });
      const prep = await runScript(config, env, SCRIPTS.prepare, [ws], { timeoutMs: 120000 });
      if (prep.code !== 0) throw new HubError("transport", `Workspace-ul de verificare nu a putut fi creat: ${parseKeyValues(prep.text).error || prep.stderr.slice(0, 200)}`);
      created = true;
      const inSandbox = (args, timeoutMs = 90000) => runInDistro(config, env, { cwd: `${ws}/repo`, vars: { IFRIM_RUN: id }, timeoutMs, maxStdout: 512 * 1024,
        argv: [BWRAP, ...reviewerArgs({ repo: `${ws}/repo`, marker: id }), CLAUDE_IN_SANDBOX, ...args] });
      const text = (r) => cleanWslText(r.stdout.toString("utf8"));
      const version = await inSandbox(["--version"], 60000);
      const help = await inSandbox(["--help"], 60000);
      const status = await inSandbox(["auth", "status", "--json"]);
      let parsed = null;
      try { parsed = JSON.parse(text(status)); } catch { /* reported below */ }
      value.installation.version = text(version).trim().split("\n")[0].slice(0, 80) || value.installation.version;
      value.installation.flags = CLAUDE_KNOWN_FLAGS.filter((flag) => text(help).includes(flag));
      if (version.code !== 0 || !parsed) return store({ ok: false, error: `claude în sandbox-ul reviewer-ului: exit ${version.code}/${status.code} ${status.stderr.slice(0, 160)}` });
      return store({ ok: true, auth: { loggedIn: Boolean(parsed.loggedIn), authMethod: parsed.authMethod || null, apiProvider: parsed.apiProvider || null, subscriptionType: parsed.subscriptionType || null } });
    } finally {
      if (created) await release(id).catch(() => {});
      users.delete("reviewer-probe");
    }
  }

  /** Deletes one reviewer session's files (transcript, per-session state) from the reviewer's config dir after a run. */
  async function cleanupReviewerSession(sessionId) {
    if (!/^[0-9a-f-]{36}$/.test(String(sessionId || ""))) return { ok: false, error: "id de sesiune invalid" };
    const result = await runScript(config, env, SCRIPTS["reviewer-cleanup"], [sessionId], { timeoutMs: 60000 });
    const facts = parseKeyValues(result.text);
    return { ok: result.code === 0 && facts.left === "0", removed: Number(facts.removed || 0), historyLines: Number(facts.history_lines || 0), left: Number(facts.left ?? -1), error: facts.error || null };
  }

  const service = {
    config, env, codex, simulated, writerReadiness, probeProblem, launcher, stateKey, probeKey, state, inspect, probeAccount, c16Lines, attest, attestationStatus, latestAttestation, attestation,
    prepareWorkspace, collectExport, applyExport, reap, release, recover, getWorkspace, listWorkspaces, setWorkspace,
    markInUse: (id, label) => users.set(id, label), markIdle: (id) => users.delete(id), inUse: () => [...users.entries()].map(([id, label]) => ({ id, label })),
    attesting: () => attesting,
    reviewerKey, reviewerReadiness, probeReviewer, reviewerLines, cleanupReviewerSession,
  };
  return service;
}
