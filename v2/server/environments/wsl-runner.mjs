import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { HubError } from "../core/errors.mjs";
import { newId } from "../core/ids.mjs";
import { json, parse } from "../storage/db.mjs";
import { createCodexAdapter, MCP_NAME_ADDRESSABLE } from "../providers/codex.mjs";
import { WSL_RUNNER, resolveWsl, wslArgs, runInDistro, runScript, parseKeyValues, assertWorkspacePath } from "./wsl.mjs";
import { writeTar, createTarReader, EXPORT_LIMITS } from "./tar.mjs";
import { selectTransferFiles, transferStream, validateExport, stageExportFile, applyChanges, EXPORT_POLICY, RUN_TMP_DIR, TRANSFER_LIMITS } from "./workspace.mjs";
import { runCanary, CANARY_VERSION, CANARY_OPTIONAL_IDS } from "./canary.mjs";
import { exerciseExportValidator } from "./c14.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = Object.fromEntries(["inspect", "prepare", "reap", "release"].map((name) => [name, fs.readFileSync(path.join(here, "scripts", `${name}.sh`), "utf8")]));
const sha16 = (text) => crypto.createHash("sha256").update(text).digest("hex").slice(0, 16);

/** Fields that define the environment an attestation belongs to (M05 §12). Any change invalidates it. */
export const FINGERPRINT_FIELDS = Object.freeze(["distro", "wslconf", "codex", "codexSha", "config", "codexExtras", "kernel", "profiles", "bwrap", "tar"]);
/** An attestation is evidence for a limited time even when nothing changed (a weekly re-run catches what the fingerprint cannot). */
export const ATTESTATION_MAX_AGE_DAYS = 14;

export function fingerprintOf(facts, env = WSL_RUNNER) {
  const fp = { distro: env.distro, wslconf: facts.wslconf || "", codex: facts.codex_version || "", codexSha: facts.codex_sha || "", config: facts.config || "",
    kernel: facts.kernel || "", profiles: String(facts.profiles || "").split(",").filter(Boolean).sort().join(","), bwrap: facts.bwrap || "", tar: facts.tar || "", codexExtras: facts.codex_extras || "" };
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
  // M06-A: C18 (the local-only profile) only ADDS coverage (the preview); a failing or missing C18 never invalidates the
  // boundary that C1–C17 attest for the writer, checks, QA and export.
  const optional = (id) => CANARY_OPTIONAL_IDS.includes(String(id).split("/")[0].replace(/[a-z]+$/, ""));
  const failed = canary.lines.filter((l) => l.status === "FAIL" && !optional(l.id));
  const notRun = Object.entries(canary.byId).filter(([k, s]) => s === "NOT_RUN" && !optional(k)).map(([k]) => k);
  const status = !sameEnvironment || failed.length || !before?.ok ? "FAIL" : notRun.length ? "INCOMPLETE" : simulated ? "PASS_SIMULATED" : "PASS_LOCAL";
  const summary = !sameEnvironment ? "amprenta s-a schimbat în timpul atestării" : !before?.ok ? "inspecția raportează probleme de graniță"
    : failed.length ? `${failed.length} verificări eșuate: ${failed.slice(0, 4).map((l) => l.sub).join(", ")}` : notRun.length ? `nerulate: ${notRun.join(", ")}`
      : `C1–C17 trecute (${canary.lines.length} verificări)${simulated ? "; distribuție SIMULATĂ (fixture), nu o dovadă WSL" : "; local, fără model (nu PASS_LIVE)"}; profilul doar-local C18: ${canary.byId.C18 === "PASS" ? "trecut" : canary.byId.C18 === "FAIL" ? "EȘUAT (preview-ul nu rulează în mediu)" : "nerulat"}`;
  // What the evidence covers, derived from the checks that passed (declared, never assumed): the model-command sandbox
  // (C7–C13) is the boundary of the writer profile and of the checks/QA commands; C14 the export path; C16 the account.
  const passed = (ids) => ids.every((id) => canary.byId[id] === "PASS");
  const stages = status === "PASS_LOCAL" || status === "PASS_SIMULATED"
    ? [...(passed(["C7", "C8", "C9", "C10", "C11", "C12", "C13"]) ? ["writer-profile", "checks", "qa"] : []), ...(passed(["C14"]) ? ["export"] : []), ...(passed(["C16"]) ? ["account"] : []), ...(passed(["C18"]) ? ["preview-local-only"] : [])]
    : [];
  return { status, summary, stages, failed: failed.length, notRun };
}

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
  async function collectExport(id, { protectedPaths = [] } = {}) {
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
    const validation = validateExport({ read, baseline, staged, protectedPaths, policy: { ...EXPORT_POLICY, maxFileBytes: EXPORT_LIMITS.maxFileBytes } });
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

  /** Ends the processes of one workspace (Stop/cleanup). Targets only this user's processes in this workspace. */
  async function reap(id, { marker = "", all = false } = {}) {
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

  const service = {
    config, env, codex, simulated, writerReadiness, probeProblem, launcher, stateKey, probeKey, state, inspect, probeAccount, c16Lines, attest, attestationStatus, latestAttestation, attestation,
    prepareWorkspace, collectExport, applyExport, reap, release, recover, getWorkspace, listWorkspaces, setWorkspace,
    markInUse: (id, label) => users.set(id, label), markIdle: (id) => users.delete(id), inUse: () => [...users.entries()].map(([id, label]) => ({ id, label })),
    attesting: () => attesting,
  };
  return service;
}
